/**
 * AudioWorklet that turns a program audio source into 20 ms planar stereo blocks (48 kHz) for the
 * NDI Program sender. Loaded from its own bundled file: the production CSP (script-src 'self')
 * does not allow blob/data worklet modules.
 */
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

const BLOCK_FRAMES = 960; // 20 ms at 48 kHz

class ProgramAudioTapProcessor extends AudioWorkletProcessor {
  private block = new Float32Array(BLOCK_FRAMES * 2);
  private filled = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const left = input?.[0];
    const right = input?.[1] ?? left;
    const frames = left?.length ?? 128;
    for (let i = 0; i < frames; i++) {
      // No input connected yet (or a silent source): keep the cadence with zeros.
      this.block[this.filled] = left ? left[i] : 0;
      this.block[BLOCK_FRAMES + this.filled] = right ? right[i] : 0;
      if (++this.filled === BLOCK_FRAMES) {
        const full = this.block;
        this.port.postMessage(full, [full.buffer]);
        this.block = new Float32Array(BLOCK_FRAMES * 2);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('program-audio-tap', ProgramAudioTapProcessor);
