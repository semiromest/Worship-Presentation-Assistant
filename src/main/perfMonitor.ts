/**
 * Main-process performance monitor (Phase 0).
 *
 * - Times every ipcMain.handle / ipcMain.on listener (must be initialized
 *   BEFORE handlers are registered in main.ts).
 * - Estimates request + response payload sizes without serializing copies.
 * - Measures main-thread event-loop lag (a proxy for "main is blocked").
 * - Exposes perf:snapshot / perf:reset IPC so the renderer/devtools can read
 *   the aggregated data.
 *
 * All of this is dev-only by default (`defaultPerfEnabled()`); production
 * builds pay zero overhead.
 */

import { ipcMain } from 'electron';
import { PerfBuffer, estimatePayloadBytes, defaultPerfEnabled } from '../shared/perf';
import type { PerfSample } from '../shared/perf';

export const mainPerf = new PerfBuffer('main');
mainPerf.enabled = defaultPerfEnabled();

const startedAt = Date.now();
let maxEventLoopLagMs = 0;
let eventLoopLagSamples = 0;

function recordIpc(kind: string, channel: string, ms: number, requestBytes: number, responseBytes: number): void {
  mainPerf.push({ kind, label: channel, ms, bytes: requestBytes + responseBytes, t: Date.now() });
}

function wrapHandle(): void {
  const ipc = ipcMain as unknown as {
    handle: (channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void;
    on: (channel: string, listener: (event: Electron.IpcMainEvent, ...args: unknown[]) => void) => void;
  };

  const origHandle = ipc.handle.bind(ipc);
  ipc.handle = ((channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    origHandle(channel, async (event, ...args) => {
      const reqBytes = mainPerf.enabled ? estimatePayloadBytes(args) : 0;
      const t0 = Date.now();
      try {
        const result = await listener(event, ...args);
        const responseBytes = mainPerf.enabled ? estimatePayloadBytes(result) : 0;
        recordIpc('ipc-handle', channel, Date.now() - t0, reqBytes, responseBytes);
        return result;
      } catch (err) {
        recordIpc('ipc-handle', channel, Date.now() - t0, reqBytes, 0);
        throw err;
      }
    });
  }) as typeof ipc.handle;

  const origOn = ipc.on.bind(ipc);
  ipc.on = ((channel: string, listener: (event: Electron.IpcMainEvent, ...args: unknown[]) => void) => {
    origOn(channel, (event, ...args) => {
      const reqBytes = mainPerf.enabled ? estimatePayloadBytes(args) : 0;
      const t0 = Date.now();
      try {
        listener(event, ...args);
        recordIpc('ipc-on', channel, Date.now() - t0, reqBytes, 0);
      } catch (err) {
        recordIpc('ipc-on', channel, Date.now() - t0, reqBytes, 0);
        throw err;
      }
    });
  }) as typeof ipc.on;
}

/** WS broadcast byte counter — call from broadcast() with the serialized size. */
export function recordWs(bytes: number, label = 'broadcast'): void {
  if (!mainPerf.enabled) return;
  mainPerf.push({ kind: 'ws', label, ms: 0, bytes, t: Date.now() });
}

/** Event-loop lag monitor: fires every 100ms, records lag above a threshold. */
function startEventLoopMonitor(): void {
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const lag = now - last - 100;
    last = now;
    if (lag > 15) {
      eventLoopLagSamples++;
      if (lag > maxEventLoopLagMs) maxEventLoopLagMs = lag;
      mainPerf.push({ kind: 'event-loop', label: 'lag', ms: lag, bytes: 0, t: now });
    }
  }, 100);
}

export function initPerfMonitor(): void {
  if (!mainPerf.enabled) {
    // Register the snapshot channels anyway so tooling can detect "disabled".
    ipcMain.handle('perf:snapshot', () => ({ enabled: false as const }));
    ipcMain.handle('perf:reset', () => false);
    return;
  }

  wrapHandle();
  startEventLoopMonitor();

  ipcMain.handle('perf:snapshot', () => ({ enabled: true as const, ...mainPerf.snapshot(), meta: { startedAt, maxEventLoopLagMs, eventLoopLagSamples } }));
  ipcMain.handle('perf:reset', () => {
    mainPerf.reset();
    maxEventLoopLagMs = 0;
    eventLoopLagSamples = 0;
    return true;
  });
}

export { estimatePayloadBytes };
export type { PerfSample };
