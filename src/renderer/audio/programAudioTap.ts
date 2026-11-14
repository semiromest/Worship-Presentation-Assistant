import workletUrl from './programAudioWorklet.ts?worker&url';

export type ProgramAudioSource = 'video' | 'music';

/**
 * Captures media elements for the NDI Program audio without touching how they play locally.
 *
 * `captureStream()` is used instead of `createMediaElementSource()` so the element keeps its own
 * output path (music keeps playing on the operator's device exactly as before). Measured on
 * Electron 43, captured audio is taken before the element's volume and mute, so both are applied
 * here from the element itself: fades, slide gain, master volume and mute stay identical to what
 * the audience hears. Track changes (a new song, a new video source) re-attach automatically.
 */
export class ProgramAudioTap {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private node: AudioWorkletNode | null = null;
  private starting: Promise<void> | null = null;
  private readonly elements = new Map<HTMLMediaElement, () => void>();
  private stopped = false;

  constructor(private readonly source: ProgramAudioSource, private readonly send: (source: ProgramAudioSource, block: Float32Array) => void) {}

  private start(): Promise<void> {
    this.starting ??= (async () => {
      const ctx = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' });
      await ctx.audioWorklet.addModule(workletUrl);
      if (this.stopped) { void ctx.close(); return; }
      const node = new AudioWorkletNode(ctx, 'program-audio-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
      node.port.onmessage = (event: MessageEvent<Float32Array>) => this.send(this.source, event.data);
      const bus = ctx.createGain();
      bus.connect(node);
      // Keep the worklet in the rendering graph without making any sound of its own.
      const silent = ctx.createGain();
      silent.gain.value = 0;
      node.connect(silent).connect(ctx.destination);
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      this.ctx = ctx; this.bus = bus; this.node = node;
    })();
    return this.starting;
  }

  async add(element: HTMLMediaElement): Promise<void> {
    if (this.elements.has(element) || this.stopped) return;
    this.elements.set(element, () => {});
    await this.start().catch(() => {});
    const ctx = this.ctx, bus = this.bus;
    if (!ctx || !bus || !this.elements.has(element)) return;

    const gain = ctx.createGain();
    // Short ramp from the current value; earlier automation is cancelled so steps never stack up.
    // volumechange alone is not enough: changing src discards the element's pending media events,
    // so a volume/mute set right before a new track is re-read on load, on play and by a light poll.
    let applied = element.muted ? 0 : element.volume;
    const follow = () => {
      const target = element.muted ? 0 : element.volume;
      if (target === applied) return;
      applied = target;
      const now = ctx.currentTime;
      const param = gain.gain;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(target, now + 0.015);
    };
    const poll = setInterval(follow, 200);
    gain.gain.value = applied;
    gain.connect(bus);
    const sources = new Map<string, MediaStreamAudioSourceNode>();
    let stream: MediaStream | null = null;
    const attach = (track: MediaStreamTrack) => {
      if (track.kind !== 'audio' || sources.has(track.id)) return;
      const node = ctx.createMediaStreamSource(new MediaStream([track]));
      node.connect(gain);
      sources.set(track.id, node);
    };
    const detach = (track: MediaStreamTrack) => { sources.get(track.id)?.disconnect(); sources.delete(track.id); };
    const onAdd = (event: MediaStreamTrackEvent) => attach(event.track);
    const onRemove = (event: MediaStreamTrackEvent) => detach(event.track);
    const release = () => {
      stream?.removeEventListener('addtrack', onAdd);
      stream?.removeEventListener('removetrack', onRemove);
      for (const node of sources.values()) node.disconnect();
      sources.clear();
      stream = null;
    };
    // Measured on Electron 43: after a source change the old capture goes silent, and a capture made
    // at 'loadedmetadata' stays silent too; one made once the element is 'playing' carries sound.
    // So every new source (next song, next video) is captured when it starts playing. A cross-origin
    // source refuses capture; it is retried when a capturable one plays.
    let capturedSrc: string | null = null;
    const capture = () => {
      if (stream && capturedSrc === element.currentSrc) return;
      release();
      try {
        stream = (element as HTMLMediaElement & { captureStream(): MediaStream }).captureStream();
      } catch { return; }
      capturedSrc = element.currentSrc;
      // Video tracks are not needed; stopping them avoids work for the capture.
      for (const track of stream.getVideoTracks()) track.stop();
      stream.getAudioTracks().forEach(attach);
      stream.addEventListener('addtrack', onAdd);
      stream.addEventListener('removetrack', onRemove);
    };
    if (!element.paused) capture();
    const onPlaying = () => { capture(); follow(); };
    // Any reload (even the same URL again) makes the current capture stale.
    const onLoadStart = () => { capturedSrc = null; };
    element.addEventListener('loadstart', onLoadStart);
    element.addEventListener('volumechange', follow);
    element.addEventListener('loadedmetadata', follow);
    element.addEventListener('playing', onPlaying);
    this.elements.set(element, () => {
      element.removeEventListener('volumechange', follow);
      element.removeEventListener('loadedmetadata', follow);
      element.removeEventListener('loadstart', onLoadStart);
      element.removeEventListener('playing', onPlaying);
      clearInterval(poll);
      release();
      gain.disconnect();
    });
  }

  remove(element: HTMLMediaElement): void {
    this.elements.get(element)?.();
    this.elements.delete(element);
  }

  stop(): void {
    this.stopped = true;
    for (const element of [...this.elements.keys()]) this.remove(element);
    if (this.node) this.node.port.onmessage = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = this.bus = this.node = null;
  }
}
