import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { NativeImage } from 'electron';
import { IDLE_NDI_STATUS, type NdiStatus } from '../../shared/virtualOutputs';
import type { FromNdiWorker, ToNdiWorker } from './ndiProtocol';

type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'on'>;

export interface NdiSenderOptions {
  name: string;
  fps: number;
  /** Convert Electron's premultiplied alpha to the straight alpha NDI expects (keyed outputs). */
  straightAlpha?: boolean;
  /** Mix program audio sources and send them with the video (NDI Program). */
  audio?: boolean;
  onStatus(status: NdiStatus): void;
  /**
   * The sender is ready but has no frame yet. Offscreen windows only paint on change, so a static
   * slide painted before the sender started (or before a worker restart) must be repainted.
   */
  onNeedFrame?(): void;
  /** Injected in tests; defaults to the bundled worker thread. */
  createWorker?: () => WorkerLike;
  now?: () => number;
}

const MAX_RESTARTS_PER_MINUTE = 3;

/**
 * Main-process side of the NDI program sender. Owns the worker thread, restarts it after a crash
 * (at most three times a minute) and forwards offscreen paints without blocking on the network.
 */
export class NdiSender {
  private worker: WorkerLike | null = null;
  private running = false;
  private started = false;
  private restarts: number[] = [];
  private status: NdiStatus = { ...IDLE_NDI_STATUS, available: true };

  constructor(private readonly options: NdiSenderOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.spawn();
  }

  stop(): void {
    this.running = false;
    this.started = false;
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      try { worker.postMessage({ type: 'stop' } satisfies ToNdiWorker); } catch { /* exited */ }
      // The worker destroys the sender and exits on its own; terminate is the backstop.
      setTimeout(() => { void worker.terminate(); }, 1000).unref?.();
    }
    this.update({ active: false, connections: 0, onProgram: false, onPreview: false });
  }

  /** Forwards one offscreen paint. BGRA, stride = width * 4 (measured on Electron 43). */
  pushImage(image: NativeImage): void {
    if (!this.worker || !this.started) return;
    const size = image.getSize();
    if (!size.width || !size.height) return;
    this.pushBitmap(image.toBitmap(), size.width, size.height);
  }

  pushBitmap(bitmap: Buffer, width: number, height: number): void {
    if (!this.worker || !this.started) return;
    const stride = bitmap.length / height;
    const whole = bitmap.byteOffset === 0 && bitmap.byteLength === bitmap.buffer.byteLength && bitmap.buffer instanceof ArrayBuffer;
    const data = whole ? (bitmap.buffer as ArrayBuffer) : bitmap.buffer.slice(bitmap.byteOffset, bitmap.byteOffset + bitmap.byteLength) as ArrayBuffer;
    const message: ToNdiWorker = { type: 'frame', data, width, height, stride };
    try {
      this.worker.postMessage(message, [data]);
    } catch {
      // Some externally backed buffers cannot be detached; a copy keeps the frame flowing.
      this.worker.postMessage({ ...message, data: data.slice(0) });
    }
  }

  /** One planar stereo 48 kHz block from a program audio source ('video' | 'music'). */
  pushAudio(source: string, block: Float32Array): void {
    if (!this.worker || !this.started || !this.options.audio) return;
    const data = block.byteOffset === 0 && block.byteLength === block.buffer.byteLength && block.buffer instanceof ArrayBuffer
      ? block.buffer : block.slice().buffer;
    try { this.worker.postMessage({ type: 'audio', source, data } satisfies ToNdiWorker, [data]); }
    catch { this.worker.postMessage({ type: 'audio', source, data: data.slice(0) } satisfies ToNdiWorker); }
  }

  getStatus(): NdiStatus { return this.status; }

  private spawn(): void {
    const worker = this.options.createWorker?.() ?? new Worker(path.join(__dirname, 'ndiWorker.js'));
    this.worker = worker;
    worker.on('message', (message: FromNdiWorker) => {
      if (worker !== this.worker) return;
      if (message.type === 'started') {
        this.started = true;
        this.update({ active: true, sourceName: message.sourceName, error: null });
        this.options.onNeedFrame?.();
      } else if (message.type === 'stats') {
        this.update({ connections: message.connections, onProgram: message.onProgram, onPreview: message.onPreview, sent: message.sent, dropped: message.dropped, audio: message.audio });
      } else if (message.type === 'error') {
        if (message.fatal) {
          // The library could not load or create a sender: retrying will not help.
          this.running = false;
          this.started = false;
          this.worker = null;
          void worker.terminate();
          this.update({ available: false, active: false, error: message.message });
        } else {
          this.update({ error: message.message });
        }
      }
    });
    const onGone = (reason: string) => {
      if (worker !== this.worker) return;
      this.worker = null;
      this.started = false;
      this.update({ active: false, connections: 0, onProgram: false, onPreview: false, error: reason });
      if (!this.running) return;
      const now = (this.options.now ?? Date.now)();
      this.restarts = this.restarts.filter((t) => now - t < 60_000);
      if (this.restarts.length >= MAX_RESTARTS_PER_MINUTE) { this.running = false; return; }
      this.restarts.push(now);
      this.spawn();
    };
    worker.on('error', (error: Error) => onGone(error.message));
    worker.on('exit', (code: number) => onGone(`NDI sender exited (${code})`));
    worker.postMessage({ type: 'start', name: this.options.name, fps: this.options.fps, straightAlpha: !!this.options.straightAlpha, audio: !!this.options.audio } satisfies ToNdiWorker);
  }

  private update(patch: Partial<NdiStatus>): void {
    this.status = { ...this.status, ...patch };
    this.options.onStatus(this.status);
  }
}
