import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { SlideImage } from 'pptx-glimpse';

export async function runPptxImportWorker(buffer: Buffer, timeoutMs = 120_000, workerFile = path.join(__dirname, 'pptxImportWorker.js')): Promise<{ slides: SlideImage[]; warnings: string[] }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'presenter-pptx-'));
  let worker: Worker | undefined;
  try {
    return await new Promise((resolve, reject) => {
      worker = new Worker(workerFile, { workerData: { bytes: buffer, tempDir } });
      const timer = setTimeout(() => {
        reject(new Error('PPTX conversion timed out'));
        void worker?.terminate();
      }, timeoutMs);
      const finish = () => clearTimeout(timer);
      worker.once('error', err => { finish(); reject(err); });
      worker.once('exit', code => { finish(); reject(new Error(`PPTX renderer exited before returning a result (${code})`)); });
      worker.once('message', message => {
        finish();
        if (!message.ok) { reject(new Error(message.error || 'PPTX conversion failed')); return; }
        const result = message.result as { slides: SlideImage[]; warnings: string[] };
        for (const slide of result.slides) slide.png = Buffer.from(slide.png);
        resolve(result);
      });
    });
  } finally {
    // Termination is awaited before removing fonts: even a CPU-bound renderer is stopped.
    if (worker) await worker.terminate();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
