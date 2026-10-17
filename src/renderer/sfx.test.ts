import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  initSfx, isSfxEnabled, playSfx, readSfxMuteDuringLive,
  setSfxEnabled, setSfxLiveOutput, setSfxMuteDuringLive, withSfxOutputTransition,
} from './sfx';

// Exercise the installed uisfx runtime and its real synthesis; only the device
// nodes are replaced so these tests never send audio to the operator's speakers.
test('master switch, live mute, transitions and local synthesis', async (t) => {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>([['uiSfxEnabled', '1']]);
  const starts: Source[] = [];
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  class Source extends EventTarget {
    buffer!: { getChannelData: (channel: number) => Float32Array };
    playbackRate = { value: 1 };
    loop = false;
    stopped = false;
    connect() {}
    disconnect() {}
    start() { starts.push(this); }
    stop() { this.stopped = true; this.dispatchEvent(new Event('ended')); }
  }
  class Context {
    state = 'running';
    sampleRate = 8000;
    currentTime = 0;
    destination = {};
    resume() { return Promise.resolve(); }
    createBufferSource() { return new Source(); }
    createBuffer(_channels: number, length: number) {
      const data = [new Float32Array(length), new Float32Array(length)];
      return { getChannelData: (channel: number) => data[channel] };
    }
    createGain() {
      return {
        connect() {}, disconnect() {},
        gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} },
      };
    }
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'window', {
    configurable: true, value: { AudioContext: Context, addEventListener() {} },
  });
  try {
    initSfx();
    await import('uisfx');
    await new Promise(resolve => setTimeout(resolve, 20));

    await t.test('short cues produce finite, non-silent local PCM', () => {
      for (const cue of ['select', 'deselect', 'copy', 'open', 'close', 'expand', 'collapse', 'play', 'pause', 'success', 'error'] as const) {
        assert.ok(playSfx(cue));
        const samples = starts.at(-1)!.buffer.getChannelData(0);
        assert.ok(samples.length < 8000 * 3, `${cue} is short`);
        assert.ok(samples.every(Number.isFinite));
        assert.ok(samples.some(sample => sample !== 0), `${cue} has audio`);
      }
    });
    await t.test('live mute defaults on and stops existing playback', () => {
      assert.equal(readSfxMuteDuringLive(), true);
      const source = starts.at(-1)!;
      setSfxLiveOutput(true);
      assert.equal(source.stopped, true);
      assert.equal(playSfx('success'), null);
      setSfxLiveOutput(false);
      assert.ok(playSfx('success'));
    });
    await t.test('opening and closing stay silent, including overlapping and rejected transitions', async () => {
      let finish!: () => void;
      const first = withSfxOutputTransition(() => new Promise<void>(resolve => { finish = resolve; }));
      await assert.rejects(withSfxOutputTransition(async () => { throw new Error('output failure'); }));
      assert.equal(playSfx('stop'), null);
      finish();
      await first;
      assert.ok(playSfx('select', { cooldownMs: 0 }));
      await withSfxOutputTransition(async () => {
        setSfxLiveOutput(true);
        assert.equal(playSfx('start'), null);
        setSfxLiveOutput(false);
        assert.equal(playSfx('stop'), null);
      });
      const count = starts.length;
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(starts.length, count, 'muted events never replay');
    });
    await t.test('live override persists but master off always wins', () => {
      setSfxMuteDuringLive(false);
      assert.equal(values.get('uiSfxMuteDuringLive'), '0');
      assert.equal(readSfxMuteDuringLive(), false);
      setSfxLiveOutput(true);
      assert.ok(playSfx('select', { cooldownMs: 0 }));
      setSfxEnabled(false);
      assert.equal(isSfxEnabled(), false);
      assert.equal(playSfx('select', { cooldownMs: 0 }), null);
      setSfxEnabled(true);
      setSfxMuteDuringLive(true);
      assert.equal(playSfx('select', { cooldownMs: 0 }), null);
    });
  } finally {
    setSfxLiveOutput(false);
    setSfxEnabled(false);
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (savedStorage) Object.defineProperty(globalThis, 'localStorage', savedStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
