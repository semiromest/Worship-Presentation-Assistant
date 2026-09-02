import { ipcMain, BrowserWindow } from 'electron';
import { SonioxNodeClient, type RealtimeSttSession } from '@soniox/node';
import crypto from 'node:crypto';
import { getApiKey as keyStoreGetApiKey, hasApiKey as keyStoreHasApiKey, keyHint as keyStoreKeyHint, setApiKey as keyStoreSetApiKey } from './sonioxKeyStore';
import type { SttConfig, SttErrorCode, SttEvent, SttSessionConfig, SttSessionStatus, SttStatus, SttToken } from '../shared/stt';

const MODEL = 'stt-rt-v5';
const MAX_ENDPOINT_DELAY_MS = 800;
const ENDPOINT_LATENCY_ADJUSTMENT_LEVEL = 1;
const ENDPOINT_SENSITIVITY = 0;
const PENDING_AUDIO_LIMIT = 200;
const ORIGINAL_KEY = '__original__';

const sessions = new Map<string, RealtimeSttSession>();
let sessionId: string | null = null;
let sessionConfig: SttSessionConfig | null = null;
let sessionState: SttSessionStatus = 'idle';
let audioSenderId: number | null = null;
const pendingAudio: Uint8Array[] = [];

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
  pendingAudio.length = 0;
  if (closeSessions) {
    for (const s of active) {
      try { s.close(); } catch { /* already closed */ }
    }
  }
}

async function stopSession(broadcastIdle: boolean): Promise<void> {
  const active = [...sessions.values()];
  teardown(false);
  await Promise.all(active.map(async (s) => {
    const timer = setTimeout(() => { try { s.close(); } catch { /* already closed */ } }, 3000);
    await s.finish().catch(() => undefined);
    clearTimeout(timer);
  }));
  if (broadcastIdle) broadcast({ type: 'status', sessionId: null, status: 'idle', config: null });
}

function startSession(config: SttConfig): { ok: boolean; code?: SttErrorCode; message?: string } {
  if (sessions.size > 0) return { ok: false, code: 'SESSION_ACTIVE', message: 'A Soniox session is already running.' };
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

      s.on('connected', () => {
        if (sessions.get(key) !== s) return;
        if ([...sessions.values()].every((candidate) => candidate)) {
          sessionState = 'connected';
          while (pendingAudio.length > 0) {
            const chunk = pendingAudio.shift();
            if (!chunk) break;
            for (const candidate of sessions.values()) {
              try { candidate.sendAudio(chunk); } catch { /* closing */ }
            }
          }
          broadcast({ type: 'status', sessionId: sid, status: 'connected', config: cfg });
        }
      });

      s.on('result', (result) => {
        if (sessions.get(key) !== s) return;
        const tokens: SttToken[] = (result.tokens ?? []).map((token) => ({
          text: token.text,
          isFinal: token.is_final,
          translationStatus: token.translation_status ?? 'none',
          language: token.language ?? null,
          sourceLanguage: token.source_language ?? null,
          targetLanguage: token.translation_status === 'translation' ? key : null,
        }));
        broadcast({ type: 'result', sessionId: sid, targetLanguage: key === ORIGINAL_KEY ? undefined : key, tokens });
      });

      s.on('endpoint', () => {
        if (sessions.get(key) === s) broadcast({ type: 'endpoint', sessionId: sid });
      });

      const fail = (code: SttErrorCode, message: string) => {
        if (sessions.get(key) !== s) return;
        teardown(true);
        sessionState = 'idle';
        broadcast({ type: 'error', code, message: sanitize(message), sessionId: sid });
        broadcast({ type: 'status', sessionId: null, status: 'idle', config: null });
      };
      s.on('error', (err) => {
        const raw = err as { code?: string; message?: string } | undefined;
        fail(mapErrorCode(raw?.code), raw?.message ?? (err instanceof Error ? err.message : 'Soniox session error.'));
      });
      s.on('disconnected', (reason) => fail('CONNECTION_FAILED', reason ?? 'Connection lost.'));
      s.on('finished', () => {
        if (sessions.get(key) !== s) return;
        teardown(false);
        sessionState = 'idle';
        broadcast({ type: 'finished', sessionId: sid });
        broadcast({ type: 'status', sessionId: null, status: 'idle', config: null });
      });
      s.connect().catch(() => undefined);
    }
  } catch (err) {
    teardown(true);
    return { ok: false, code: 'UNKNOWN', message: sanitize(err instanceof Error ? err.message : 'Failed to create session.') };
  }
  return { ok: true };
}

function getStatus(): SttStatus {
  return { hasKey: keyStoreHasApiKey(), keyHint: keyStoreKeyHint(), sessionStatus: sessionState, sessionId, config: sessionConfig };
}

export function registerSttIpc(): void {
  ipcMain.handle('stt:get-status', () => getStatus());
  ipcMain.handle('stt:set-api-key', (_event, key: unknown) => {
    if (typeof key !== 'string' || !key.trim()) return { ok: false, code: 'UNKNOWN' as SttErrorCode, message: 'Empty API key.' };
    if (sessions.size > 0) return { ok: false, code: 'SESSION_ACTIVE' as SttErrorCode, message: 'Stop the current session before changing the key.' };
    keyStoreSetApiKey(key);
    return { ok: true };
  });
  ipcMain.handle('stt:start', (event, config: SttConfig) => {
    audioSenderId = event.sender.id;
    const result = startSession(config);
    if (!result.ok) audioSenderId = null;
    return result;
  });
  ipcMain.on('stt:audio', (event, chunk: unknown) => {
    if (sessions.size === 0 || event.sender.id !== audioSenderId) return;
    const bytes = chunk instanceof Uint8Array ? new Uint8Array(chunk) : chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : null;
    if (!bytes) return;
    if (sessionState === 'connected') {
      for (const s of sessions.values()) {
        try { s.sendAudio(bytes); } catch { /* closing */ }
      }
    } else if (pendingAudio.length < PENDING_AUDIO_LIMIT) {
      pendingAudio.push(bytes);
    }
  });
  ipcMain.handle('stt:stop', async () => { await stopSession(true); return { ok: true }; });
}

export function cleanupStt(): void {
  const active = [...sessions.values()];
  teardown(false);
  for (const s of active) { try { s.close(); } catch { /* already closed */ } }
}
