/**
 * NDI sender thread. Runs the native sender and the output clock off the main event loop, so a slow
 * network or receiver never delays IPC, projector updates or slide transitions. Frames arrive as
 * transferred ArrayBuffers (BGRA; premultiplied alpha is straightened for keyed outputs) and are repeated at a constant rate on static slides.
 */
import { parentPort } from 'node:worker_threads';
import { FrameDelay, OutputClock } from './outputClock';
import { unpremultiplyBgra } from './alpha';
import { AudioClock, AudioMixer, MIXER_CHANNELS, MIXER_SAMPLE_RATE } from './audioMixer';
import type { FromNdiWorker, ToNdiWorker } from './ndiProtocol';

type Frame = { data: Buffer; width: number; height: number; stride: number };
type GrandiSender = {
  video(frame: Record<string, unknown>): Promise<void>;
  audio(frame: Record<string, unknown>): Promise<void>;
  connections(): number;
  tally(): { onProgram: boolean; onPreview: boolean };
  sourceName(): string;
  destroy(): boolean;
};

const port = parentPort;
if (!port) throw new Error('ndiWorker must run in a worker thread');
const post = (message: FromNdiWorker) => port.postMessage(message);

let sender: GrandiSender | null = null;
let grandi: any = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;
let fps = 30;
let straightAlpha = false;
// Program audio: mixed here and paid out at wall-clock rate next to the video clock.
let mixer: AudioMixer | null = null;
let audioClock: AudioClock | null = null;
let audioStart = 0;
const clock = new OutputClock<Frame>();
/**
 * Program only: the picture waits for the audio path (capture, 20 ms blocks, jitter buffer). Measured
 * on Windows with the 100 ms buffer, 135 ms left audio 25-48 ms early (flash/beep, 5 minutes); 100 ms
 * centres it. Re-measure if the mixer target changes.
 */
const AV_VIDEO_DELAY_MS = 100;
let videoDelay: FrameDelay<Frame> | null = null;

async function start(name: string, rate: number, straight: boolean, audio: boolean): Promise<void> {
  fps = rate;
  straightAlpha = straight;
  if (audio) { mixer = new AudioMixer(); audioClock = new AudioClock(); audioStart = performance.now(); videoDelay = new FrameDelay(AV_VIDEO_DELAY_MS); }
  const mod = await import('grandi');
  grandi = (mod as any).default ?? mod;
  sender = await grandi.send({ name, clockVideo: false });
  post({ type: 'started', sourceName: sender!.sourceName(), ndiVersion: String(grandi.version?.() ?? '') });
  tickTimer = setInterval(tick, 1000 / fps);
  statsTimer = setInterval(() => {
    if (!sender) return;
    let tally = { onProgram: false, onPreview: false };
    try { tally = sender.tally(); } catch { /* tally is best effort */ }
    post({ type: 'stats', connections: sender.connections(), onProgram: !!tally.onProgram, onPreview: !!tally.onPreview,
      sent: clock.sent, dropped: clock.dropped, repeated: clock.repeated, ...(mixer ? { audio: mixer.stats() } : {}) });
  }, 1000);
}

function sendAudio(): void {
  if (!sender || !mixer || !audioClock) return;
  const now = performance.now() - audioStart;
  const samples = audioClock.due(now);
  if (samples <= 0) return;
  // Silence is sent too, so receivers keep a steady audio clock between songs and videos.
  const planar = mixer.pull(samples, now);
  sender.audio({
    sampleRate: MIXER_SAMPLE_RATE, channels: MIXER_CHANNELS, samples, channelStrideBytes: samples * 4,
    fourCC: grandi.FourCC.FLTp, data: Buffer.from(planar.buffer, planar.byteOffset, planar.byteLength),
  }).catch((error: unknown) => post({ type: 'error', message: String((error as Error)?.message ?? error), fatal: false }));
}

function tick(): void {
  if (!sender) return;
  sendAudio();
  const delayed = videoDelay?.release(performance.now());
  if (delayed) clock.push(delayed);
  const frame = clock.tick();
  if (!frame) return;
  sender.video({
    xres: frame.width, yres: frame.height, frameRateN: fps * 1000, frameRateD: 1000, pictureAspectRatio: frame.width / frame.height,
    fourCC: grandi.FourCC.BGRA, frameFormatType: grandi.FrameType.Progressive, lineStrideBytes: frame.stride, data: frame.data,
  }).then(() => clock.done(true), (error: unknown) => {
    clock.done(false);
    post({ type: 'error', message: String((error as Error)?.message ?? error), fatal: false });
  });
}

function stop(): void {
  if (tickTimer) clearInterval(tickTimer);
  if (statsTimer) clearInterval(statsTimer);
  tickTimer = statsTimer = null;
  clock.clear();
  mixer = null;
  audioClock = null;
  videoDelay?.clear();
  videoDelay = null;
  try { sender?.destroy(); } catch { /* already gone */ }
  sender = null;
}

port.on('message', (message: ToNdiWorker) => {
  if (message.type === 'frame') {
    if (message.width * 4 > message.stride || message.stride * message.height > message.data.byteLength) return;
    const data = Buffer.from(message.data);
    // Converted once per paint; repeated frames on static slides reuse the converted buffer.
    if (straightAlpha) unpremultiplyBgra(data);
    const frame = { data, width: message.width, height: message.height, stride: message.stride };
    if (videoDelay) videoDelay.push(frame, performance.now()); else clock.push(frame);
  } else if (message.type === 'audio') {
    if (mixer && message.data.byteLength <= 8 * 4096 * MIXER_CHANNELS) mixer.push(message.source, new Float32Array(message.data), performance.now() - audioStart);
  } else if (message.type === 'start') {
    start(message.name, message.fps, message.straightAlpha, message.audio).catch((error: unknown) => {
      post({ type: 'error', message: String((error as Error)?.message ?? error), fatal: true });
    });
  } else if (message.type === 'stop') {
    stop();
    port.close();
  }
});
