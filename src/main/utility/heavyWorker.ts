/**
 * Heavy-work UtilityProcess entry (Phase 7).
 *
 * Runs PPTX import/export and .gpres ZIP build/extract in a separate OS
 * process so the main event loop is never blocked by multi-second CPU work
 * (measured: ~7s resvg warm-up + 28-34ms/slide PPTX import, ~0.8-3s deflate
 * on heavy decks). Spawned lazily by heavyWorkerClient.ts and kept alive for
 * the app lifetime so the resvg warm-up is paid only once.
 *
 * Protocol over process.parentPort (Electron ≥ 27):
 *   request:  { id, type, payload }
 *   progress: { id, type: 'progress', current, total }
 *   response: { id, ok: true, result } | { id, ok: false, error }
 *
 * The worker is a plain Node environment: fs + path work, and media bytes are
 * written content-addressed into the passed mediaDir (same algorithm as main).
 */

import AdmZip from 'adm-zip';
import { getPptxService } from '../pptxService';
import { exportPresentationToPptx } from '../pptxExportService';
import { buildGpresZip } from '../../shared/mediaTree';
import { createMediaLibrary, rewriteGpresMedia } from '../mediaLibrary';

type HeavyRequest =
  | { id: number; type: 'import-pptx'; payload: { filePath: string; mediaDir: string } }
  | { id: number; type: 'export-pptx'; payload: { content: string; filePath: string; mediaDir: string } }
  | { id: number; type: 'build-gpres'; payload: { content: string; mediaDir: string } }
  | { id: number; type: 'extract-gpres'; payload: { buffer: ArrayBuffer; mediaDir: string } };

interface ProgressMsg { id: number; type: 'progress'; current: number; total: number }

// UtilityProcess child side: Electron exposes process.parentPort (a
// MessagePortMain) — not worker_threads' parentPort. @types/node's Process
// lacks the property, so access it through a cast.
interface ParentPortLike {
  on: (event: 'message', cb: (e: { data: HeavyRequest }) => void) => void;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
}
const rawPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (!rawPort) throw new Error('heavyWorker: process.parentPort unavailable — not running in a UtilityProcess');
// Non-optional alias so closures see a narrowed type.
const port: ParentPortLike = rawPort;

function postProgress(id: number, current: number, total: number): void {
  const msg: ProgressMsg = { id, type: 'progress', current, total };
  port.postMessage(msg);
}

async function handle(req: HeavyRequest): Promise<unknown> {
  switch (req.type) {
    case 'import-pptx': {
      // getPptxService() is process-local; the worker is kept alive so the
      // resvg WASM warm-up happens once, not per import.
      return getPptxService().importPptx(
        req.payload.filePath,
        (current, total) => postProgress(req.id, current, total),
        req.payload.mediaDir,
      );
    }
    case 'export-pptx': {
      const data = JSON.parse(req.payload.content);
      return exportPresentationToPptx(
        data,
        req.payload.filePath,
        (current, total) => postProgress(req.id, current, total),
        req.payload.mediaDir,
      );
    }
    case 'build-gpres': {
      const data = JSON.parse(req.payload.content);
      const { zip, embeddedCount } = await buildGpresZip(data, { mediaDir: req.payload.mediaDir });
      const buffer = Buffer.from(zip.toBuffer());
      return { embeddedCount, zipBuffer: buffer };
    }
    case 'extract-gpres': {
      const buffer = Buffer.from(req.payload.buffer);
      const zip = new AdmZip(buffer);
      const jsonEntry = zip.getEntry('presentation.json');
      if (!jsonEntry) throw new Error('Corrupt .gpres file: missing presentation.json');
      const data = JSON.parse(zip.readAsText(jsonEntry));
      const mediaCount = await rewriteGpresMedia(zip, data, createMediaLibrary(req.payload.mediaDir));
      return { data, mediaCount };
    }
    default:
      throw new Error(`Unknown heavy request type: ${(req as HeavyRequest & { type: string }).type}`);
  }
}

port.on('message', (e) => {
  const req = e.data;
  void (async () => {
    try {
      const result = await handle(req);
      // Transfer the zip buffer instead of copying it across processes.
      const zipBuffer = (result as { zipBuffer?: Buffer } | undefined)?.zipBuffer;
      const transfer = zipBuffer ? [zipBuffer.buffer as Transferable] : undefined;
      port.postMessage({ id: req.id, ok: true, result }, transfer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[heavyWorker] ${req.type} failed:`, message);
      port.postMessage({ id: req.id, ok: false, error: message });
    }
  })();
});

console.info('[heavyWorker] ready');
