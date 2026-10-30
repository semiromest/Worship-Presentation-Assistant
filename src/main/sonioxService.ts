import { ipcMain, BrowserWindow, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { SonioxNodeClient, type RealtimeSttSession } from '@soniox/node';
import { randomUUID } from 'node:crypto';
import { CaptionTimeline } from '../shared/captions';
import { reportServiceHealth } from './serviceHealth';
import { SttSessionGroup, finishSttSession } from './sttSessionGroup';
import { getApiKey as keyStoreGetApiKey, hasApiKey as keyStoreHasApiKey, keyHint as keyStoreKeyHint, setApiKey as keyStoreSetApiKey, deleteApiKey as keyStoreDeleteApiKey } from './sonioxKeyStore';
import type { SttConfig, SttErrorCode, SttEvent, SttSessionConfig, SttSessionStatus, SttStatus, SttToken } from '../shared/stt';

const MODEL = 'stt-rt-v5';
const MAX_ENDPOINT_DELAY_MS = 800;
const ENDPOINT_LATENCY_ADJUSTMENT_LEVEL = 1;
const ENDPOINT_SENSITIVITY = 0;
const CONNECT_TIMEOUT_MS = 15_000;
const FINISH_TIMEOUT_MS = 3_000;
/** Altyazı anlık görüntüleri en sık bu aralıkla yayımlanır (ilk olay hemen gider). */
const CAPTION_PUBLISH_INTERVAL_MS = 33;
/** 16 kHz s16 mono için ~32 sn; bunun üstü hatalı istemci demektir. */
const MAX_AUDIO_CHUNK_BYTES = 1024 * 1024;
const MAX_API_KEY_LENGTH = 512;
const ORIGINAL_KEY = '__original__';

const ERROR_CODES = new Map<string, SttErrorCode>([
  ['auth_error', 'INVALID_API_KEY'],
  ['quota_exceeded', 'QUOTA_EXCEEDED'],
  ['connection_error', 'CONNECTION_FAILED'],
  ['network_error', 'CONNECTION_FAILED'],
]);
const mapErrorCode = (code?: string): SttErrorCode => ERROR_CODES.get(code ?? '') ?? 'UNKNOWN';

const isLanguage = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

type StartResult = { ok: boolean; code?: SttErrorCode; message?: string };

/** Canlı oturuma ait tüm durum tek yerde; `run === null` boşta demektir. */
interface Run {
  id: string;
  config: SttSessionConfig;
  sessions: Map<string, RealtimeSttSession>;
  group: SttSessionGroup;
  /** Ses kabul edilen pencere; durdurma başlayınca null olur. */
  senderId: number | null;
  connectTimer: ReturnType<typeof setTimeout> | undefined;
}

let run: Run | null = null;
let state: SttSessionStatus = 'idle';
let timeline: CaptionTimeline | null = null;
let stopping: Promise<void> | null = null;
let closing = false;

function broadcast(event: SttEvent): void {
  if (event.type === 'status' && event.status === 'connected') reportServiceHealth('captions', true);
  if (event.type === 'error') reportServiceHealth('captions', false);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('stt:event', event);
  }
}

// ─── Altyazı yayını ─────────────────────────────────────────
// Olay tam anlık görüntü taşıdığı için ara değerler atlanabilir: aralık dolmadan gelen olaylar
// tek bir sonraki gönderimde birleşir. Durum değiştiren yollar (başlat/durdur/hata/temizle) hemen yayımlar.
let lastPublish = 0;
let publishTimer: ReturnType<typeof setTimeout> | undefined;

function flushCaptions(): void {
  clearTimeout(publishTimer);
  publishTimer = undefined;
  lastPublish = Date.now();
  if (timeline) broadcast({ type: 'captions', sessionId: run?.id ?? null, captions: timeline.snapshot() });
}

function publishCaptions(): void {
  if (!timeline || publishTimer) return; // bekleyen gönderim en güncel durumu taşıyacak
  const wait = lastPublish + CAPTION_PUBLISH_INTERVAL_MS - Date.now();
  if (wait <= 0) flushCaptions();
  else publishTimer = setTimeout(flushCaptions, wait);
}

/** Bütün oturumları kapatır ve durumu sıfırlar. Çağıran, gerekiyorsa altyazıyı önceden yayımlamalı. */
function teardown(): void {
  const current = run;
  run = null;
  state = 'idle';
  clearTimeout(publishTimer);
  publishTimer = undefined;
  if (!current) return;
  clearTimeout(current.connectTimer);
  const active = [...current.sessions.values()];
  current.sessions.clear();
  for (const s of active) {
    try { s.close(); } catch { /* already closed */ }
  }
}

function stopSession(): Promise<void> {
  if (stopping) return stopping;
  const current = run;
  closing = true;
  if (current) {
    current.senderId = null; // yeni ses kabul edilmez
    clearTimeout(current.connectTimer);
  }
  stopping = (async () => {
    try {
      try {
        // Koşulsuz await: oturum yokken bile bir mikro görev beklenir, böylece aşağıdaki `finally`
        // `stopping` atamasından önce çalışıp onu kalıcı olarak dolu bırakamaz.
        await Promise.allSettled(
          current
            ? [...current.sessions].map(async ([key, s]) => finishSttSession(s, FINISH_TIMEOUT_MS, current.group.waitReady(key)))
            : [],
        );
        timeline?.finish();
        flushCaptions();
      } finally {
        teardown(); // bitirme hatası olsa bile oturumlar mutlaka kapanır
      }
      if (current) broadcast({ type: 'finished', sessionId: current.id });
      broadcast({ type: 'status', sessionId: null, status: 'idle', config: null });
    } finally {
      closing = false;
      stopping = null;
    }
  })();
  return stopping;
}

function startSession(input: unknown, senderId: number): StartResult {
  if (run || closing) return { ok: false, code: 'SESSION_ACTIVE', message: 'A Soniox session is already running.' };
  const apiKey = keyStoreGetApiKey();
  if (!apiKey) return { ok: false, code: 'NO_API_KEY', message: 'Soniox API key is not configured.' };
  if (!input || typeof input !== 'object') return { ok: false, code: 'UNKNOWN', message: 'Invalid configuration.' };

  const config = input as SttConfig;
  const translationEnabled = Boolean(config.translationEnabled);
  const sttLanguage = isLanguage(config.sttLanguage) && config.sttLanguage !== 'auto' ? config.sttLanguage : null;
  const requested: unknown[] = Array.isArray(config.targetLanguages) && config.targetLanguages.length
    ? config.targetLanguages
    : [config.targetLanguage];
  const targetLanguages = [...new Set(requested.filter(isLanguage))];
  if (translationEnabled && targetLanguages.length === 0) return { ok: false, code: 'UNKNOWN', message: 'Missing target language.' };

  const sid = randomUUID();
  const cfg: SttSessionConfig = {
    sttLanguage: sttLanguage ?? 'auto',
    targetLanguages,
    targetLanguage: targetLanguages[0] ?? config.targetLanguage,
    translationEnabled,
  };
  const keys = translationEnabled ? targetLanguages : [ORIGINAL_KEY];
  // Anahtar bu oturum için yakalanır: her hatada anahtar deposundan yeniden okunmaz.
  const redact = (text: string) => text.split(apiKey).join('[redacted]');

  const fail = (code: SttErrorCode, message: string) => {
    if (run !== current || closing) return; // eski oturumun gecikmiş olayları yok sayılır
    timeline?.finish();
    flushCaptions();
    teardown();
    broadcast({ type: 'error', code, message: redact(message), sessionId: sid });
    broadcast({ type: 'status', sessionId: null, status: 'idle', config: null });
  };
  const group = new SttSessionGroup(message => fail('CONNECTION_FAILED', message));
  const current: Run = { id: sid, config: cfg, sessions: new Map(), group, senderId, connectTimer: undefined };

  run = current;
  state = 'connecting';
  broadcast({ type: 'status', sessionId: sid, status: 'connecting', config: cfg });

  try {
    const client = new SonioxNodeClient({ api_key: apiKey });
    timeline = new CaptionTimeline(sid, keys[0]);
    flushCaptions();
    current.connectTimer = setTimeout(() => fail('CONNECTION_FAILED', 'Connection timed out.'), CONNECT_TIMEOUT_MS);

    for (const key of keys) {
      const s = client.realtime.stt({
        model: MODEL,
        audio_format: 'pcm_s16le',
        sample_rate: 16000,
        num_channels: 1,
        enable_language_identification: true,
        enable_endpoint_detection: true,
        max_endpoint_delay_ms: MAX_ENDPOINT_DELAY_MS,
        endpoint_latency_adjustment_level: ENDPOINT_LATENCY_ADJUSTMENT_LEVEL,
        endpoint_sensitivity: ENDPOINT_SENSITIVITY,
        ...(sttLanguage ? { language_hints: [sttLanguage] } : {}),
        ...(translationEnabled ? { translation: { type: 'one_way', target_language: key } } : {}),
      });
      current.sessions.set(key, s);
      group.add(key, chunk => s.sendAudio(chunk));

      s.on('connected', () => {
        if (current.sessions.get(key) !== s) return;
        group.ready(key);
        if (group.connected && !closing) {
          clearTimeout(current.connectTimer);
          state = 'connected';
          broadcast({ type: 'status', sessionId: sid, status: 'connected', config: cfg });
        }
      });
      s.on('result', (result) => {
        if (current.sessions.get(key) !== s) return;
        const tokens: SttToken[] = (result.tokens ?? []).map(token => ({
          text: token.text, isFinal: token.is_final,
          translationStatus: token.translation_status ?? 'none',
          language: token.language ?? null, sourceLanguage: token.source_language ?? null,
          targetLanguage: token.translation_status === 'translation' ? key : null,
        }));
        timeline?.result(key, tokens);
        publishCaptions();
      });
      s.on('endpoint', () => {
        if (current.sessions.get(key) !== s) return;
        timeline?.endpoint(key);
        publishCaptions();
      });
      s.on('error', (err) => {
        const raw = err as { code?: string; message?: string } | undefined;
        fail(mapErrorCode(raw?.code), raw?.message ?? (err instanceof Error ? err.message : 'Soniox session error.'));
      });
      s.on('disconnected', (reason) => fail('CONNECTION_FAILED', reason ?? 'Connection lost.'));
      s.on('finished', () => {
        if (current.sessions.get(key) !== s) return;
        timeline?.endpoint(key);
        publishCaptions();
        if (!closing) void stopSession();
      });
      s.connect().catch(err => fail('CONNECTION_FAILED', String(err)));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create session.';
    fail('UNKNOWN', message);
    return { ok: false, code: 'UNKNOWN', message: redact(message) };
  }
  return { ok: true };
}

function getStatus(): SttStatus {
  return {
    hasKey: keyStoreHasApiKey(),
    keyHint: keyStoreKeyHint(),
    sessionStatus: state,
    sessionId: run?.id ?? null,
    config: run?.config ?? null,
    captions: timeline?.snapshot(),
  };
}

// Ses gönderen pencere kapanırsa oturum açık kalıp boşuna bağlantı tutmasın.
const watchedSenders = new WeakSet<WebContents>();
function stopWhenSenderDies(sender: WebContents): void {
  if (watchedSenders.has(sender)) return;
  watchedSenders.add(sender);
  const id = sender.id; // 'destroyed' sonrası özelliğe erişmek yerine baştan yakalanır
  sender.once('destroyed', () => {
    if (run?.senderId === id) void stopSession();
  });
}

export function registerSttIpc(getControlWindow: () => BrowserWindow | null): void {
  const isControlSender = (event: IpcMainInvokeEvent): boolean => {
    const control = getControlWindow();
    return !!control && !control.isDestroyed()
      && event.sender === control.webContents && event.senderFrame === control.webContents.mainFrame;
  };

  ipcMain.handle('stt:delete-api-key', (event) => {
    if (!isControlSender(event)) return { ok: false, code: 'UNKNOWN' as SttErrorCode };
    if (run || closing) return { ok: false, code: 'SESSION_ACTIVE' as SttErrorCode };
    try { keyStoreDeleteApiKey(); return { ok: true }; }
    catch { return { ok: false, code: 'UNKNOWN' as SttErrorCode }; }
  });
  ipcMain.handle('stt:get-status', () => getStatus());
  ipcMain.handle('stt:clear', () => {
    const current = run;
    timeline = new CaptionTimeline(randomUUID(), current?.config.translationEnabled ? current.config.targetLanguages[0] : ORIGINAL_KEY);
    flushCaptions();
  });
  ipcMain.handle('stt:set-api-key', (event, key: unknown) => {
    if (!isControlSender(event)) return { ok: false, code: 'UNKNOWN' as SttErrorCode, message: 'Not allowed.' };
    const trimmed = typeof key === 'string' ? key.trim() : '';
    if (!trimmed) return { ok: false, code: 'UNKNOWN' as SttErrorCode, message: 'Empty API key.' };
    if (trimmed.length > MAX_API_KEY_LENGTH) return { ok: false, code: 'UNKNOWN' as SttErrorCode, message: 'API key is too long.' };
    if (run || closing) return { ok: false, code: 'SESSION_ACTIVE' as SttErrorCode, message: 'Stop the current session before changing the key.' };
    try { keyStoreSetApiKey(trimmed); return { ok: true }; }
    catch { return { ok: false, code: 'UNKNOWN' as SttErrorCode, message: 'Could not store the API key.' }; }
  });
  ipcMain.handle('stt:start', (event, config: unknown) => {
    const result = startSession(config, event.sender.id);
    if (result.ok) stopWhenSenderDies(event.sender);
    return result;
  });
  ipcMain.on('stt:audio', (event, chunk: unknown) => {
    const current = run;
    if (!current || closing || event.sender.id !== current.senderId) return;
    const bytes = chunk instanceof Uint8Array ? new Uint8Array(chunk) : chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : null;
    if (bytes && bytes.byteLength > 0 && bytes.byteLength <= MAX_AUDIO_CHUNK_BYTES) current.group.send(bytes);
  });
  ipcMain.handle('stt:stop', async () => { await stopSession(); return { ok: true }; });
}

/** Uygulama kapanırken: oturumları beklemeden kapatır. */
export function cleanupStt(): void {
  teardown();
}
