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
let stopping = false;
let starting: Promise<void> | null = null;
let videoSend: Promise<void> | null = null;
let audioSend: Promise<void> | null = null;
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
  if (!Number.isFinite(rate) || rate <= 0 || rate > 120) throw new Error('Invalid NDI frame rate');
  fps = rate;
  straightAlpha = straight;
  const mod = await import('grandi');
  grandi = (mod as any).default ?? mod;
  if (stopping) return;
  // Both streams are paced here; SDK audio clocking would introduce a second pacing mechanism.
  sender = await grandi.send({ name, clockVideo: false, clockAudio: false });
  if (stopping) return;
  if (audio) {
    mixer = new AudioMixer();
    audioClock = new AudioClock();
    audioStart = performance.now();
    videoDelay = new FrameDelay(AV_VIDEO_DELAY_MS, Math.ceil(fps * AV_VIDEO_DELAY_MS / 1000) + 2);
  }
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
  if (!sender || !mixer || !audioClock || audioSend) return;
  const now = performance.now() - audioStart;
  const samples = audioClock.due(now);
  if (samples <= 0) return;
  // Silence is sent too, so receivers keep a steady audio clock between songs and videos.
  const planar = mixer.pull(samples, now);
  const activeSender = sender;
  audioSend = Promise.resolve().then(() => activeSender.audio({
    sampleRate: MIXER_SAMPLE_RATE, channels: MIXER_CHANNELS, samples, channelStrideBytes: samples * 4,
    fourCC: grandi.FourCC.FLTp, data: Buffer.from(planar.buffer, planar.byteOffset, planar.byteLength),
  })).catch(reportSendError).finally(() => { audioSend = null; });
}

function tick(): void {
  if (!sender || stopping) return;
  sendAudio();
  const delayed = videoDelay?.release(performance.now());
  if (delayed) clock.push(delayed);
  const frame = clock.tick();
  if (!frame) return;
  const activeSender = sender;
  videoSend = Promise.resolve().then(() => activeSender.video({
    xres: frame.width, yres: frame.height, frameRateN: fps * 1000, frameRateD: 1000, pictureAspectRatio: frame.width / frame.height,
    fourCC: grandi.FourCC.BGRA, frameFormatType: grandi.FrameType.Progressive, lineStrideBytes: frame.stride, data: frame.data,
  })).then(() => clock.done(true), (error: unknown) => {
    clock.done(false);
    reportSendError(error);
  }).finally(() => { videoSend = null; });
}

function reportSendError(error: unknown): void {
  if (!stopping) post({ type: 'error', message: String((error as Error)?.message ?? error), fatal: false });
}

async function stop(): Promise<void> {
  stopping = true;
  if (tickTimer) clearInterval(tickTimer);
  if (statsTimer) clearInterval(statsTimer);
  tickTimer = statsTimer = null;
  clock.clear();
  mixer = null;
  audioClock = null;
  videoDelay?.clear();
  videoDelay = null;
  // Never destroy the native handle while an asynchronous native send still uses it.
  await starting?.catch(() => {});
  await Promise.allSettled([videoSend, audioSend]);
  try { sender?.destroy(); } catch { /* already gone */ }
  sender = null;
  port!.close();
}

port.on('message', (message: ToNdiWorker) => {
  if (stopping) return;
  if (message.type === 'frame') {
    // Acknowledge ingestion, not network delivery: bounds the main-to-worker mailbox independently.
    post({ type: 'frame-accepted' });
    if (!sender || !Number.isSafeInteger(message.width) || message.width <= 0 ||
        !Number.isSafeInteger(message.height) || message.height <= 0 ||
        !Number.isSafeInteger(message.stride) || message.width * 4 > message.stride ||
        message.stride * message.height > message.data.byteLength) return;
    const data = Buffer.from(message.data);
    // Converted once per paint; repeated frames on static slides reuse the converted buffer.
    if (straightAlpha) unpremultiplyBgra(data);
    const frame = { data, width: message.width, height: message.height, stride: message.stride };
    if (videoDelay) videoDelay.push(frame, performance.now()); else clock.push(frame);
  } else if (message.type === 'audio') {
    if (mixer && (message.source === 'video' || message.source === 'music') && message.data.byteLength > 0 &&
        message.data.byteLength % (4 * MIXER_CHANNELS) === 0 && message.data.byteLength <= 4 * 4096 * MIXER_CHANNELS)
      mixer.push(message.source, new Float32Array(message.data), performance.now() - audioStart);
  } else if (message.type === 'start') {
    if (starting) return;
    starting = start(message.name, message.fps, message.straightAlpha, message.audio).catch((error: unknown) => {
      if (!stopping) post({ type: 'error', message: String((error as Error)?.message ?? error), fatal: true });
    });
  } else if (message.type === 'stop') {
    void stop();
  }
});
