import { ipcMain, BrowserWindow } from 'electron';
import { SonioxNodeClient, type RealtimeSttSession } from '@soniox/node';
import crypto from 'node:crypto';
import { CaptionTimeline } from '../shared/captions';
import { SttSessionGroup, finishSttSession } from './sttSessionGroup';
import { getApiKey as keyStoreGetApiKey, hasApiKey as keyStoreHasApiKey, keyHint as keyStoreKeyHint, setApiKey as keyStoreSetApiKey } from './sonioxKeyStore';
import type { SttConfig, SttErrorCode, SttEvent, SttSessionConfig, SttSessionStatus, SttStatus, SttToken } from '../shared/stt';

const MODEL = 'stt-rt-v5';
const MAX_ENDPOINT_DELAY_MS = 800;
const ENDPOINT_LATENCY_ADJUSTMENT_LEVEL = 1;
const ENDPOINT_SENSITIVITY = 0;

const ORIGINAL_KEY = '__original__';

const sessions = new Map<string, RealtimeSttSession>();
let sessionId: string | null = null;
let sessionConfig: SttSessionConfig | null = null;
let sessionState: SttSessionStatus = 'idle';
let audioSenderId: number | null = null;
let audioGroup: SttSessionGroup | null = null;
let timeline: CaptionTimeline | null = null;
let stopping: Promise<void> | null = null;
let closing = false;
let connectTimer: ReturnType<typeof setTimeout> | undefined;
function publishCaptions(): void {
  if (timeline) broadcast({ type: 'captions', sessionId, captions: timeline.snapshot() });
}

function broadcast(event: SttEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('stt:event', event);
  }
}

function mapErrorCode(code?: string): SttErrorCode {
  if (code === 'auth_error') return 'INVALID_API_KEY';
  if (code === 'quota_exceeded') return 'QUOTA_EXCEEDED';
  if (code === 'connection_error' || code === 'network_error') return 'CONNECTION_FAILED';
  return 'UNKNOWN';
}

function sanitize(message: string): string {
  const key = keyStoreGetApiKey();
  return key ? message.split(key).join('[redacted]') : message;
}

function teardown(closeSessions: boolean): void {
  const active = [...sessions.values()];
  sessions.clear();
  sessionId = null;
  sessionConfig = null;
  audioSenderId = null;
  audioGroup = null;
  sessionState = 'idle';
  clearTimeout(connectTimer);
  if (closeSessions) {
    for (const s of active) {
      try { s.close(); } catch { /* already closed */ }
    }
  }
}

function stopSession(broadcastIdle: boolean): Promise<void> {
  if (stopping) return stopping;
  const sid = sessionId;
  const active = [...sessions.entries()];
  const group = audioGroup;
  closing = true;
  audioSenderId = null;
  clearTimeout(connectTimer);
  stopping = Promise.all(active.map(([key, s]) => finishSttSession(s, 3000, group?.waitReady(key)))).then(() => {
    timeline?.finish();
    publishCaptions();
    teardown(true);
    if (sid) broadcast({ type: 'finished', sessionId: sid });
    if (broadcastIdle) broadcast({ type: 'status', sessionId: null, status: 'idle', config: null });
  }).finally(() => { closing = false; stopping = null; });
  return stopping;
}

function startSession(config: SttConfig): { ok: boolean; code?: SttErrorCode; message?: string } {
  if (sessions.size > 0 || closing) return { ok: false, code: 'SESSION_ACTIVE', message: 'A Soniox session is already running.' };
  const apiKey = keyStoreGetApiKey();
  if (!apiKey) return { ok: false, code: 'NO_API_KEY', message: 'Soniox API key is not configured.' };

  const translationEnabled = Boolean(config.translationEnabled);
  const sttLanguage = config.sttLanguage && config.sttLanguage !== 'auto' ? config.sttLanguage : null;
  const targetLanguages = [...new Set((config.targetLanguages?.length ? config.targetLanguages : [config.targetLanguage]).filter(Boolean))];
  if (translationEnabled && targetLanguages.length === 0) return { ok: false, code: 'UNKNOWN', message: 'Missing target language.' };

  const sid = crypto.randomUUID();
  const cfg: SttSessionConfig = {
    sttLanguage: sttLanguage ?? 'auto',
    targetLanguages,
    targetLanguage: targetLanguages[0] ?? config.targetLanguage,
    translationEnabled,
  };
  sessionId = sid;
  sessionConfig = cfg;
  sessionState = 'connecting';
  broadcast({ type: 'status', sessionId: sid, status: 'connecting', config: cfg });

  const client = new SonioxNodeClient({ api_key: apiKey });
  const keys = translationEnabled ? targetLanguages : [ORIGINAL_KEY];
  timeline = new CaptionTimeline(sid, keys[0]);
  publishCaptions();
  const fail = (code: SttErrorCode, message: string) => {
    if (sessionId !== sid || closing) return;
    timeline?.finish();
    publishCaptions();
    teardown(true);
    broadcast({ type: 'error', code, message: sanitize(message), sessionId: sid });
    broadcast({ type: 'status', sessionId: null, status: 'idle', config: null });
  };
  audioGroup = new SttSessionGroup(message => fail('CONNECTION_FAILED', message));
  connectTimer = setTimeout(() => fail('CONNECTION_FAILED', 'Connection timed out.'), 15000);
  try {
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
      sessions.set(key, s);

      audioGroup.add(key, chunk => s.sendAudio(chunk));
      s.on('connected', () => {
        if (sessions.get(key) !== s) return;
        audioGroup?.ready(key);
        if (audioGroup?.connected && !closing) {
          clearTimeout(connectTimer);
          sessionState = 'connected';
          broadcast({ type: 'status', sessionId: sid, status: 'connected', config: cfg });
        }
      });
      s.on('result', (result) => {
        if (sessions.get(key) !== s) return;
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
        if (sessions.get(key) !== s) return;
        timeline?.endpoint(key);
        publishCaptions();
      });
      s.on('error', (err) => {
        const raw = err as { code?: string; message?: string } | undefined;
        fail(mapErrorCode(raw?.code), raw?.message ?? (err instanceof Error ? err.message : 'Soniox session error.'));
      });
      s.on('disconnected', (reason) => fail('CONNECTION_FAILED', reason ?? 'Connection lost.'));
      s.on('finished', () => {
        if (sessions.get(key) !== s) return;
        timeline?.endpoint(key);
        publishCaptions();
        if (!closing) void stopSession(true);
      });
      s.connect().catch(err => fail('CONNECTION_FAILED', String(err)));

    }
  } catch (err) {
    fail('UNKNOWN', err instanceof Error ? err.message : 'Failed to create session.');
    return { ok: false, code: 'UNKNOWN', message: sanitize(err instanceof Error ? err.message : 'Failed to create session.') };
  }
  return { ok: true };
}

function getStatus(): SttStatus {
  return { hasKey: keyStoreHasApiKey(), keyHint: keyStoreKeyHint(), sessionStatus: sessionState, sessionId, config: sessionConfig, captions: timeline?.snapshot() };
}

export function registerSttIpc(): void {
  ipcMain.handle('stt:get-status', () => getStatus());
  ipcMain.handle('stt:clear', () => {
    timeline = new CaptionTimeline(crypto.randomUUID(), sessionConfig?.translationEnabled ? sessionConfig.targetLanguages[0] : ORIGINAL_KEY);
    publishCaptions();
  });
  ipcMain.handle('stt:set-api-key', (_event, key: unknown) => {
    if (typeof key !== 'string' || !key.trim()) return { ok: false, code: 'UNKNOWN' as SttErrorCode, message: 'Empty API key.' };
    if (sessions.size > 0 || closing) return { ok: false, code: 'SESSION_ACTIVE' as SttErrorCode, message: 'Stop the current session before changing the key.' };
    keyStoreSetApiKey(key);
    return { ok: true };
  });
  ipcMain.handle('stt:start', (event, config: SttConfig) => {
    const result = startSession(config);
    if (result.ok) audioSenderId = event.sender.id;
    return result;
  });
  ipcMain.on('stt:audio', (event, chunk: unknown) => {
    if (sessions.size === 0 || event.sender.id !== audioSenderId) return;
    const bytes = chunk instanceof Uint8Array ? new Uint8Array(chunk) : chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : null;
    if (!bytes) return;
    if (!closing) audioGroup?.send(bytes);
  });
  ipcMain.handle('stt:stop', async () => { await stopSession(true); return { ok: true }; });
}

export function cleanupStt(): void {
  const active = [...sessions.values()];
  teardown(false);
  for (const s of active) { try { s.close(); } catch { /* already closed */ } }
}
