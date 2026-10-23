import { parentPort, workerData } from 'node:worker_threads';
import { renderPptx } from '../pptxRender';

if (!parentPort) throw new Error('PPTX renderer must run in a worker thread');
const port = parentPort;
const data = workerData as { bytes: Uint8Array; tempDir: string };
renderPptx(Buffer.from(data.bytes), data.tempDir).then(
  result => port.postMessage({ ok: true, result }),
  error => port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }),
).finally(() => port.close());
