// ─── Microphone → 16 kHz Int16 PCM (AudioWorklet / ScriptProcessorNode) ───
// The worklet processor code is embedded as a string and loaded from a Blob
// URL (or, as a fallback, a data URL) so it works in dev and packaged builds
// without bundler quirks. Electron has historically had cases where
// audioWorklet.addModule rejects ("The user aborted a request"), so the
// factory below tries the worklet first and falls back to the legacy
// ScriptProcessorNode, which requires no module loading at all.
//
// The AudioContext is opened at 16 kHz when the platform allows it; when not,
// it falls back to its default rate (typically 44.1/48 kHz). Either way the
// audio is resampled down to 16 kHz with linear interpolation, then
// accumulated into ~100 ms (1600-sample) Int16 chunks that exactly match
// Soniox's pcm_s16le@16k config.

const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 1600; // 100 ms at 16 kHz

// ── AudioWorklet processor (off-main-thread) ────────────────────────────────

const PCM_WORKLET_SOURCE = `
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const src = options?.processorOptions?.sourceSampleRate || sampleRate;
    const target = options?.processorOptions?.targetSampleRate || ${TARGET_RATE};
    this._ratio = src / target; // input samples per output sample
    this._pos = 0;              // fractional input position (carried across blocks)
    this._buffer = new Int16Array(0);
    this._target = ${CHUNK_SAMPLES};
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;
    const samples = input[0];
    const len = samples.length;

    const out = new Int16Array(Math.ceil((len + this._pos) / this._ratio) + 2);
    let n = 0;
    while (this._pos < len) {
      const i0 = Math.floor(this._pos);
      const i1 = Math.min(i0 + 1, len - 1);
      const f = this._pos - i0;
      const v = samples[i0] + (samples[i1] - samples[i0]) * f;
      const clamped = Math.max(-1, Math.min(1, v));
      out[n++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      this._pos += this._ratio;
    }
    this._pos -= len;

    if (n === 0) return true;
    const chunk = new Int16Array(n);
    chunk.set(out.subarray(0, n));

    if (this._buffer.length === 0) {
      if (chunk.length >= this._target) {
        this.port.postMessage(chunk.buffer, [chunk.buffer]);
        return true;
      }
      this._buffer = chunk;
      return true;
    }
    const merged = new Int16Array(this._buffer.length + chunk.length);
    merged.set(this._buffer);
    merged.set(chunk, this._buffer.length);
    if (merged.length >= this._target) {
      this.port.postMessage(merged.buffer, [merged.buffer]);
      this._buffer = new Int16Array(0);
    } else {
      this._buffer = merged;
    }
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
`;

let cachedBlobUrl: string | null = null;
let cachedDataUrl: string | null = null;

export function getPcmWorkletUrl(): string {
  if (cachedBlobUrl) return cachedBlobUrl;
  cachedBlobUrl = URL.createObjectURL(
    new Blob([PCM_WORKLET_SOURCE], { type: 'application/javascript' }),
  );
  return cachedBlobUrl;
}

function getPcmWorkletDataUrl(): string {
  if (cachedDataUrl) return cachedDataUrl;
  cachedDataUrl = `data:text/javascript;base64,${btoa(PCM_WORKLET_SOURCE)}`;
  return cachedDataUrl;
}

// ── ScriptProcessorNode fallback (no module loading) ────────────────────────

function createScriptProcessorPcmNode(
  ctx: AudioContext,
  onChunk: (data: ArrayBuffer) => void,
): ScriptProcessorNode {
  // 4096-sample buffer at up to 48 kHz ≈ 85 ms of audio per callback.
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const ratio = ctx.sampleRate / TARGET_RATE;
  let pos = 0; // fractional input position
  let prev = 0;
  let hasPrev = false;
  let buffer: Int16Array<ArrayBuffer> = new Int16Array(new ArrayBuffer(0));

  const push = (int16: Int16Array<ArrayBuffer>) => {
    if (buffer.length === 0) {
      if (int16.length >= CHUNK_SAMPLES) {
        onChunk(int16.buffer);
        return;
      }
      buffer = int16;
      return;
    }
    const merged = new Int16Array(new ArrayBuffer((buffer.length + int16.length) * 2));
    merged.set(buffer);
    merged.set(int16, buffer.length);
    if (merged.length >= CHUNK_SAMPLES) {
      onChunk(merged.buffer);
      buffer = new Int16Array(new ArrayBuffer(0));
    } else {
      buffer = merged;
    }
  };

  node.onaudioprocess = (e) => {
    const samples = e.inputBuffer.getChannelData(0);
    const len = samples.length;
    const out = new Int16Array(Math.ceil((len + pos) / ratio) + 2);
    let n = 0;
    while (pos < len) {
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, len - 1);
      const f = pos - i0;
      const v = hasPrev && i0 === 0 ? prev + (samples[i0] - prev) * f : samples[i0] + (samples[i1] - samples[i0]) * f;
      const clamped = Math.max(-1, Math.min(1, v));
      out[n++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      pos += ratio;
    }
    pos -= len;
    prev = samples[len - 1];
    hasPrev = true;
    if (n > 0) {
      const slice = new Int16Array(new ArrayBuffer(n * 2));
      slice.set(out.subarray(0, n));
      push(slice);
    }
  };
  return node;
}

// ── Public factory ──────────────────────────────────────────────────────────

/**
 * Creates a PCM node for the given mic stream and wires it to the context.
 * Tries AudioWorklet first (blob URL, then data URL) and falls back to the
 * ScriptProcessorNode. Returns null if every path fails.
 */
export async function createPcmNode(
  ctx: AudioContext,
  stream: MediaStream,
  onChunk: (data: ArrayBuffer) => void,
): Promise<AudioWorkletNode | ScriptProcessorNode | null> {
  const source = ctx.createMediaStreamSource(stream);

  // 1) AudioWorklet via Blob URL.
  try {
    await ctx.audioWorklet.addModule(getPcmWorkletUrl());
    const node = new AudioWorkletNode(ctx, 'pcm-processor', {
      processorOptions: {
        sourceSampleRate: ctx.sampleRate,
        targetSampleRate: TARGET_RATE,
      },
    });
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(e.data);
    source.connect(node);
    return node;
  } catch {
    // Fall through.
  }

  // 2) AudioWorklet via data URL (covers odd blob-URL restrictions).
  try {
    await ctx.audioWorklet.addModule(getPcmWorkletDataUrl());
    const node = new AudioWorkletNode(ctx, 'pcm-processor', {
      processorOptions: {
        sourceSampleRate: ctx.sampleRate,
        targetSampleRate: TARGET_RATE,
      },
    });
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(e.data);
    source.connect(node);
    return node;
  } catch {
    // Fall through.
  }

  // 3) Legacy ScriptProcessorNode — deprecated but universally available.
  //    It must stay wired into the rendering graph to keep firing, so route
  //    it through a zero-gain node to avoid audible microphone feedback.
  try {
    const node = createScriptProcessorPcmNode(ctx, onChunk);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
    return node;
  } catch {
    return null;
  }
}
