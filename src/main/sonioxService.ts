import { ipcMain, BrowserWindow } from 'electron';
import { SonioxNodeClient, type RealtimeSttSession } from '@soniox/node';
import crypto from 'node:crypto';
import { getApiKey as keyStoreGetApiKey, hasApiKey as keyStoreHasApiKey, keyHint as keyStoreKeyHint, setApiKey as keyStoreSetApiKey } from './sonioxKeyStore';
import type { SttConfig, SttErrorCode, SttEvent, SttSessionConfig, SttSessionStatus, SttStatus, SttToken } from '../shared/stt';

// ─── Soniox real-time STT + translation (main process) ──────────────────────
//
// The renderer streams 16 kHz mono PCM s16le audio here over IPC; this module
// owns the Soniox WebSocket session and the API key (read from the encrypted
// key store). Results/status/errors are broadcast to BOTH windows (control +
// projector) so the captions slide can render live on the projection screen.
//
// Security rules:
//  - The API key never leaves this process and is never logged.
//  - Error messages are sanitized against the key before being forwarded.
//  - Only one session can be active at a time.
//  - Audio chunks are accepted only from the window that started the session.

const MODEL = 'stt-rt-v5';

// ─── Endpoint tuning ────────────────────────────────────────────────────────
// Voice commands (slide auto-advance) depend on utterances being finalized
// promptly, so we tighten Soniox's endpoint detection from its defaults:
//   - max_endpoint_delay_ms (default 2000): how long after speech ends the
//     endpoint is emitted. Lower = faster utterance finalization.
//   - endpoint_latency_adjustment_level (default 0, range 0..3): extra
//     latency reduction; higher values finalize sooner but can trim a little
//     word accuracy at utterance boundaries.
//   - endpoint_sensitivity (default 0, range -1..1): left at 0 so utterances
//     are not split too aggressively.
// These apply to every STT session (captions and voice commands share one
// stream), so the trade-off also affects live captions.
const MAX_ENDPOINT_DELAY_MS = 800;
const ENDPOINT_LATENCY_ADJUSTMENT_LEVEL = 1;
const ENDPOINT_SENSITIVITY = 0;

let session: RealtimeSttSession | null = null;
let sessionId: string | null = null;
let sessionConfig: SttSessionConfig | null = null;
let sessionState: SttSessionStatus = 'idle';
let audioSenderId: number | null = null;

// The renderer starts streaming audio immediately after `stt:start` returns,
// but the WebSocket is still connecting (handshake + auth). sendAudio() throws
// a StateError before 'connected' fires, so buffer the first few hundred
// chunks (~20 s at 100 ms) and flush them on connect instead of dropping them.
const PENDING_AUDIO_LIMIT = 200;
const pendingAudio: Uint8Array[] = [];

function broadcast(event: SttEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('stt:event', event);
  }
}

function mapErrorCode(code?: string): SttErrorCode {
  switch (code) {
    case 'auth_error':
      return 'INVALID_API_KEY';
    case 'quota_exceeded':
      return 'QUOTA_EXCEEDED';
    case 'connection_error':
    case 'network_error':
      return 'CONNECTION_FAILED';
    default:
      return 'UNKNOWN';
  }
}

function sanitize(message: string): string {
  const key = keyStoreGetApiKey();
  return key ? message.split(key).join('[redacted]') : message;
}

function teardown(closeSession: boolean): void {
  const s = session;
  session = null;
  sessionId = null;
  sessionConfig = null;
  audioSenderId = null;
  pendingAudio.length = 0;
  if (closeSession && s) {
    try {
      s.close();
    } catch {
      // Already closed.
    }
  }
}

async function stopSession(broadcastIdle: boolean): Promise<void> {
  const s = session;
  teardown(false);
  if (s) {
    // finish() waits for the remaining results so the tail of the last
    // utterance is delivered; fall back to close() if it stalls.
    const finishPromise = s.finish().catch(() => undefined);
    const timer = setTimeout(() => {
      try {
        s.close();
      } catch {
        // Already closed.
      }
    }, 3000);
    await finishPromise;
    clearTimeout(timer);
  }
  if (broadcastIdle) {
    broadcast({ type: 'status', sessionId: null, status: 'idle', config: null });
  }
}

function startSession(config: SttConfig): { ok: boolean; code?: SttErrorCode; message?: string } {
  if (session) {
    return { ok: false, code: 'SESSION_ACTIVE', message: 'A Soniox session is already running.' };
  }

  const apiKey = keyStoreGetApiKey();
  if (!apiKey) {
    return { ok: false, code: 'NO_API_KEY', message: 'Soniox API key is not configured.' };
  }

  const translationEnabled = Boolean(config.translationEnabled);
  if (translationEnabled && (!config?.targetLanguage || typeof config.targetLanguage !== 'string')) {
    return { ok: false, code: 'UNKNOWN', message: 'Missing target language.' };
  }
  const sttLanguage = config?.sttLanguage && config.sttLanguage !== 'auto' ? config.sttLanguage : null;

  const client = new SonioxNodeClient({ api_key: apiKey });
  let s: RealtimeSttSession;
  try {
    s = client.realtime.stt({
      model: MODEL,
      audio_format: 'pcm_s16le',
      sample_rate: 16000,
      num_channels: 1,
      enable_language_identification: true,
      enable_endpoint_detection: true,
      max_endpoint_delay_ms: MAX_ENDPOINT_DELAY_MS,
      endpoint_latency_adjustment_level: ENDPOINT_LATENCY_ADJUSTMENT_LEVEL,
      endpoint_sensitivity: ENDPOINT_SENSITIVITY,
      // Bias recognition toward the selected spoken language when the user
      // picked one; auto-detection stays enabled either way (best-effort hint).
      ...(sttLanguage ? { language_hints: [sttLanguage] } : {}),
      // One-way translation on the same stream — only when the user enabled it.
      ...(translationEnabled
        ? { translation: { type: 'one_way', target_language: config.targetLanguage } }
        : {}),
    });
  } catch (err) {
    return { ok: false, code: 'UNKNOWN', message: sanitize(err instanceof Error ? err.message : 'Failed to create session.') };
  }

  const sid = crypto.randomUUID();
  const cfg: SttSessionConfig = {
    sttLanguage: sttLanguage ?? 'auto',
    targetLanguage: config.targetLanguage,
    translationEnabled,
  };
  session = s;
  sessionId = sid;
  sessionConfig = cfg;
  sessionState = 'connecting';
  broadcast({ type: 'status', sessionId: sid, status: 'connecting', config: cfg });

  s.on('connected', () => {
    if (session !== s) return;
    sessionState = 'connected';
    // Flush audio that arrived while the socket was still connecting.
    while (pendingAudio.length > 0) {
      const chunk = pendingAudio.shift();
      if (!chunk) break;
      try {
        s.sendAudio(chunk);
      } catch {
        // Session closed mid-flush — drop the rest.
        pendingAudio.length = 0;
        break;
      }
    }
    broadcast({ type: 'status', sessionId: sid, status: 'connected', config: cfg });
  });

  s.on('result', (result) => {
    if (session !== s) return;
    const tokens: SttToken[] = (result.tokens ?? []).map((t) => ({
      text: t.text,
      isFinal: t.is_final,
      translationStatus: t.translation_status ?? 'none',
      language: t.language ?? null,
      sourceLanguage: t.source_language ?? null,
    }));
    broadcast({ type: 'result', sessionId: sid, tokens });
  });

  s.on('endpoint', () => {
    if (session !== s) return;
    broadcast({ type: 'endpoint', sessionId: sid });
  });

  s.on('finished', () => {
    if (session !== s) return;
    teardown(false);
    sessionState = 'idle';
    broadcast({ type: 'finished', sessionId: sid });
    broadcast({ type: 'status', sessionId: null, status: 'idle', config: null });
  });

  s.on('error', (err) => {
    const raw = err as { code?: string; message?: string } | undefined;
    const code = mapErrorCode(raw?.code);
    const message = sanitize(raw?.message ?? (err instanceof Error ? err.message : 'Soniox session error.'));
    teardown(true);
    sessionState = 'idle';
    broadcast({ type: 'error', code, message, sessionId: sid });
    broadcast({ type: 'status', sessionId: null, status: 'idle', config: null });
  });

  s.on('disconnected', (reason) => {
    if (session !== s) return;
    // Unexpected disconnect (stopSession goes through finish(), which fires
    // 'finished' instead). Treat as a connection error so the UI recovers.
    teardown(true);
    sessionState = 'idle';
    broadcast({ type: 'error', code: 'CONNECTION_FAILED', message: sanitize(reason ?? 'Connection lost.'), sessionId: sid });
    broadcast({ type: 'status', sessionId: null, status: 'idle', config: null });
  });

  // Start connecting immediately; failures surface through the error event.
  s.connect().catch(() => {
    // 'error' / 'disconnected' events already handled above.
  });

  return { ok: true };
}

function getStatus(): SttStatus {
  return {
    hasKey: keyStoreHasApiKey(),
    keyHint: keyStoreKeyHint(),
    sessionStatus: sessionState,
    sessionId,
    config: sessionConfig,
  };
}

export function registerSttIpc(): void {
  ipcMain.handle('stt:get-status', () => getStatus());

  ipcMain.handle('stt:set-api-key', (_event, key: unknown) => {
    if (typeof key !== 'string' || !key.trim()) {
      return { ok: false, code: 'UNKNOWN' as SttErrorCode, message: 'Empty API key.' };
    }
    if (session) {
      return { ok: false, code: 'SESSION_ACTIVE' as SttErrorCode, message: 'Stop the current session before changing the key.' };
    }
    keyStoreSetApiKey(key);
    return { ok: true };
  });

  ipcMain.handle('stt:start', (event, config: SttConfig) => {
    audioSenderId = event.sender.id;
    const result = startSession(config);
    if (!result.ok) {
      audioSenderId = null;
    }
    return result;
  });

  // Fire-and-forget audio streaming (no invoke round-trip).
  ipcMain.on('stt:audio', (event, chunk: unknown) => {
    if (!session || event.sender.id !== audioSenderId) return;
    let bytes: Uint8Array;
    if (chunk instanceof Uint8Array) {
      bytes = new Uint8Array(chunk);
    } else if (chunk instanceof ArrayBuffer) {
      bytes = new Uint8Array(chunk);
    } else {
      return;
    }
    if (sessionState === 'connected') {
      try {
        session.sendAudio(bytes);
      } catch {
        // Session is closing — drop the chunk.
      }
    } else if (pendingAudio.length < PENDING_AUDIO_LIMIT) {
      pendingAudio.push(bytes);
    }
  });

  ipcMain.handle('stt:stop', async () => {
    await stopSession(true);
    return { ok: true };
  });
}

/** Called on app quit — close any live session without broadcasting. */
export function cleanupStt(): void {
  const s = session;
  teardown(false);
  if (s) {
    try {
      s.close();
    } catch {
      // Already closed.
    }
  }
}
