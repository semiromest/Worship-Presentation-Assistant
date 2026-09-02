/**
 * Main-side client for the heavy-work UtilityProcess (Phase 7).
 *
 * Spawns the worker lazily on first use and keeps it alive for the app
 * lifetime (the PPTX resvg warm-up is paid once, not per import). Requests
 * are id-correlated; a worker crash rejects all in-flight requests and the
 * worker is respawned on the next call — the main process is never affected.
 */

import path from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import type { PptxResult } from './pptxService';
import type { PptxExportResult } from './pptxExportService';
import type { ThumbSlideData } from '../shared/thumbnailConfig';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  onProgress?: (current: number, total: number) => void;
  timer: NodeJS.Timeout;
}

let worker: UtilityProcess | null = null;
let nextId = 1;
const pending = new Map<number, PendingRequest>();

const DEFAULT_TIMEOUT_MS = 120_000;

function ensureWorker(): UtilityProcess {
  if (worker) return worker;
  worker = utilityProcess.fork(path.join(__dirname, 'heavyWorker.js'), [], {
    serviceName: 'presenter-heavy-worker',
    // Silent by default; the worker logs its own errors via console.error.
  });

  worker.on('message', (msg: unknown) => {
    const m = msg as { id?: number; type?: string; ok?: boolean; result?: unknown; error?: string; current?: number; total?: number };
    if (m.type === 'progress' && typeof m.id === 'number') {
      const p = pending.get(m.id);
      if (p?.onProgress && typeof m.current === 'number' && typeof m.total === 'number') {
        p.onProgress(m.current, m.total);
      }
      return;
    }
    if (typeof m.id !== 'number' || !pending.has(m.id)) return;
    const p = pending.get(m.id)!;
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error ?? 'Heavy worker request failed'));
  });

  worker.on('exit', () => {
    // Crash isolation: reject everything in flight; the next call respawns.
    const inflight = [...pending.values()];
    pending.clear();
    for (const p of inflight) {
      clearTimeout(p.timer);
      p.reject(new Error('Heavy worker exited unexpectedly'));
    }
    worker = null;
  });

  return worker;
}

function call<T>(type: string, payload: unknown, onProgress?: (c: number, t: number) => void, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`Heavy worker request timed out after ${timeoutMs}ms (${type})`));
    }, timeoutMs);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress, timer });
    try {
      ensureWorker().postMessage({ id, type, payload });
    } catch (err) {
      clearTimeout(timer);
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export const heavyClient = {
  importPptx(filePath: string, mediaDir: string, onProgress?: (c: number, t: number) => void): Promise<PptxResult> {
    return call<PptxResult>('import-pptx', { filePath, mediaDir }, onProgress);
  },
  exportPptx(content: string, filePath: string, mediaDir: string, onProgress?: (c: number, t: number) => void): Promise<PptxExportResult> {
    return call<PptxExportResult>('export-pptx', { content, filePath, mediaDir }, onProgress);
  },
  async buildGpres(content: string, mediaDir: string): Promise<{ embeddedCount: number; zipBuffer: Buffer }> {
    const res = await call<{ embeddedCount: number; zipBuffer: unknown }>('build-gpres', { content, mediaDir });
    // The transferred ArrayBuffer arrives in the main process as a Uint8Array
    // (not a Buffer) — normalize so callers (fs.writeFile / drive upload)
    // always receive the documented Buffer type.
    return { embeddedCount: res.embeddedCount, zipBuffer: Buffer.from(res.zipBuffer as Uint8Array) };
  },
  extractGpres(buffer: Buffer, mediaDir: string): Promise<{ data: unknown; mediaCount: number }> {
    return call<{ data: unknown; mediaCount: number }>('extract-gpres', { buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer, mediaDir }, undefined, 60_000);
  },
  generateThumbnail(slide: ThumbSlideData): Promise<string | null> {
    return call<string | null>('generate-thumbnail', { slide }, undefined, 30_000);
  },
};
