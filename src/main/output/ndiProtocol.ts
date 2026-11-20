/** Messages between main (ndiSender.ts) and the NDI worker thread (ndiWorker.ts). */
export type ToNdiWorker =
  | { type: 'start'; name: string; fps: number; straightAlpha: boolean; audio: boolean }
  /** 20 ms planar stereo Float32 block at 48 kHz from one program audio source. */
  | { type: 'audio'; source: string; data: ArrayBuffer }
  | { type: 'frame'; data: ArrayBuffer; width: number; height: number; stride: number }
  | { type: 'stop' };

export type FromNdiWorker =
  | { type: 'frame-accepted' }
  | { type: 'started'; sourceName: string; ndiVersion: string }
  | { type: 'stats'; connections: number; onProgram: boolean; onPreview: boolean; sent: number; dropped: number; repeated: number;
      audio?: Record<string, { levelMs: number; primed: boolean; corrections: number; underruns: number }> }
  | { type: 'error'; message: string; fatal: boolean };
