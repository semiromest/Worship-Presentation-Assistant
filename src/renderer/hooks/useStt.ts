import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSttStore, refreshSttStatus } from '../state/useSttStore';
import { createPcmNode } from '../audio/pcmProcessor';
import type { SttErrorCode, SttEvent } from '../../shared/stt';

/** How long to wait after an endpoint for the delayed translation to arrive
 * before sealing the utterance and letting the captions fall back to the last
 * finalized text. Translation runs on the same stream but is delivered a beat
 * after the original, so we keep the utterance on screen during this window. */
const TRANSLATION_GRACE_MS = 2000;

// ─── Real-time STT + translation (renderer side) ────────────────────────────
// - Captures the microphone in the renderer and streams 16 kHz mono PCM
//   (Int16) chunks to the main process via fire-and-forget IPC.
// - The main process owns the Soniox session and the API key; this hook only
//   forwards audio and applies the broadcasted events to the store.
// - Both the control window and the projector window run this hook so the
//   captions slide can render the same live text on the projection screen.
//
// Mic permission model:
//   - The main process grants the Electron-level 'media' permission (see
//     setupMediaPermissionHandlers in main.ts) and asks macOS for OS consent.
//   - Windows may additionally require the OS privacy toggle; if that is off,
//     getUserMedia rejects with NotAllowedError, which we surface clearly.
//
// Audio pipeline:
//   getUserMedia → AudioContext → AudioWorklet → Int16 PCM @ 16 kHz
//   The AudioContext is opened at 16 kHz when supported. Some platforms
//   refuse non-hardware rates, so the worklet resamples whatever the context
//   actually uses down to 16 kHz (linear interpolation) and always posts
//   1600-sample (100 ms) Int16 chunks that Soniox expects.

function mapMicError(name?: string, message?: string): SttErrorCode {
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'MIC_DENIED';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'MIC_NOT_FOUND';
    case 'NotReadableError':
    case 'AbortError':
      return 'MIC_BUSY';
    default:
      // Unknown failure — keep the raw message so the user sees the real cause.
      return message ? 'UNKNOWN' : 'MIC_DENIED';
  }
}

function errorMessage(t: (key: string) => string, code: SttErrorCode, fallback: string): string {
  switch (code) {
    case 'NO_API_KEY':
      return t('common.sttNoApiKeyDesc');
    case 'INVALID_API_KEY':
      return t('common.sttInvalidApiKey');
    case 'MIC_DENIED':
      return t('common.sttMicDenied');
    case 'MIC_NOT_FOUND':
      return t('common.sttMicNotFound');
    case 'MIC_BUSY':
      return t('common.sttMicBusy');
    case 'CONNECTION_FAILED':
      return t('common.sttConnectionFailed');
    case 'QUOTA_EXCEEDED':
      return t('common.sttQuotaExceeded');
    case 'SESSION_ACTIVE':
      return t('common.sttSessionActive');
    default:
      return fallback || t('common.sttError');
  }
}

/**
 * Enumerates audio input devices (mic, headset, …) and syncs them into the
 * STT store. Labels are empty until the mic permission has been granted, so
 * the UI falls back to a generic name; call this again after a session starts
 * (or on the 'devicechange' event) to refresh them.
 */
export async function refreshSttInputDevices(): Promise<void> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({ id: d.deviceId, label: d.label || '' }));
    useSttStore.getState().setInputDevices(inputs);
  } catch (err) {
    console.warn('[STT] enumerateDevices failed:', err);
  }
}

export function useStt() {
  const { t } = useTranslation();

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const abortRef = useRef(false);
  const closeGraceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);

  const cleanupMic = useCallback(() => {
    const node = nodeRef.current;
    if (node) {
      try {
        node.disconnect();
      } catch {
        // Already torn down.
      }
      nodeRef.current = null;
    }
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    const ctx = ctxRef.current;
    if (ctx) {
      void ctx.close().catch(() => {});
      ctxRef.current = null;
    }
    useSttStore.getState().setMicActive(false);
  }, []);

  const clearCloseGrace = useCallback(() => {
    if (closeGraceRef.current) {
      clearTimeout(closeGraceRef.current);
      closeGraceRef.current = null;
    }
  }, []);

  // Seals the current utterance (moving it to history + the "last" display
  // fields) and cancels any pending close-grace timer.
  const flushClose = useCallback(() => {
    clearCloseGrace();
    closingRef.current = false;
    useSttStore.getState().sealCurrent();
  }, [clearCloseGrace]);

  // Starts (or restarts) the grace window that keeps a finalized utterance on
  // screen while its translation is still in flight.
  const beginCloseGrace = useCallback(() => {
    closingRef.current = true;
    if (closeGraceRef.current) clearTimeout(closeGraceRef.current);
    closeGraceRef.current = setTimeout(() => {
      closeGraceRef.current = null;
      closingRef.current = false;
      useSttStore.getState().sealCurrent();
    }, TRANSLATION_GRACE_MS);
  }, []);

  // Initial state + event subscription (runs in BOTH windows).
  useEffect(() => {
    void refreshSttStatus();
    const unsubscribe = window.electronAPI?.onSttEvent?.((raw: unknown) => {
      const event = raw as SttEvent;
      const store = useSttStore.getState();

      switch (event.type) {
        case 'status': {
          store.setStatus(event.status);
          store.setSessionId(event.sessionId);
          // Keep language/translation state in sync across windows with the
          // config the running session actually uses.
          store.applySessionConfig(event.config ?? null);
          if (event.status === 'idle') {
            // Session fully over (stop, error, or natural finish) — release the mic.
            cleanupMic();
          }
          break;
        }
        case 'result': {
          if (event.sessionId !== useSttStore.getState().sessionId) break;

          const hasOriginal = event.tokens.some((tok) => tok.translationStatus !== 'translation');
          const hasTranslation = event.tokens.some((tok) => tok.translationStatus === 'translation');

          // A new utterance begins while the previous one is still inside its
          // close-grace window → seal the previous utterance first so its text
          // does not merge into the new utterance.
          if (hasOriginal && closingRef.current) {
            flushClose();
          }

          const state = useSttStore.getState();
          const liveEmpty =
            state.currentOriginal.trim() === '' && state.currentTranslation.trim() === '';

          // Translation final tokens that arrive after the utterance was
          // already sealed (the grace window expired) are re-attached to the
          // last utterance so they are never lost.
          if (hasTranslation && !hasOriginal && !closingRef.current && liveEmpty) {
            for (const tok of event.tokens) {
              if (tok.translationStatus === 'translation' && tok.isFinal && tok.text) {
                useSttStore.getState().appendLateTranslation(tok.text);
              }
            }
            break;
          }

          useSttStore.getState().applyResult(event.tokens);

          // Keep the grace window open while translation is still streaming,
          // so we don't seal mid-translation.
          if (closingRef.current && hasTranslation) {
            beginCloseGrace();
          }
          break;
        }
        case 'endpoint': {
          const state = useSttStore.getState();
          if (event.sessionId !== state.sessionId) break;
          // Don't clear the captions the moment speech ends: when translation
          // is enabled its final tokens arrive slightly after the endpoint, so
          // hold the text on screen for a short grace window. Without
          // translation there is nothing to wait for — seal immediately.
          if (state.translationEnabled) {
            beginCloseGrace();
          } else {
            flushClose();
          }
          break;
        }
        case 'finished': {
          if (event.sessionId !== useSttStore.getState().sessionId) break;
          flushClose();
          useSttStore.getState().setSessionId(null);
          useSttStore.getState().setStatus('idle');
          cleanupMic();
          break;
        }
        case 'error': {
          useSttStore.getState().setError({
            code: event.code,
            message: errorMessage(t, event.code, event.message),
          });
          useSttStore.getState().setSessionId(null);
          useSttStore.getState().setStatus('idle');
          cleanupMic();
          break;
        }
      }
    });
    return () => {
      unsubscribe?.();
      clearCloseGrace();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async () => {
    const store = useSttStore.getState();
    if (store.status !== 'idle') return;
    if (!store.hasKey) {
      useSttStore.getState().setError({
        code: 'NO_API_KEY',
        message: errorMessage(t, 'NO_API_KEY', ''),
      });
      return;
    }

      abortRef.current = false;

      // 1) Microphone. Constraints use ideal (not exact) values so a mic that
      //    only does 44.1/48 kHz still opens; the worklet resamples to 16 kHz.
      //    The selected input device is requested exactly so the user's choice
      //    is honored (an unplugged device surfaces as MIC_NOT_FOUND).
      let stream: MediaStream;
      try {
        const inputDeviceId = useSttStore.getState().inputDeviceId;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: { ideal: 16000 },
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            ...(inputDeviceId ? { deviceId: { exact: inputDeviceId } } : {}),
          },
        });
      } catch (err) {
        const name = err instanceof DOMException ? err.name : undefined;
        const raw = err instanceof Error ? err.message : undefined;
        console.error('[STT] getUserMedia failed:', name, raw);
        const code = mapMicError(name, raw);
        useSttStore.getState().setError({
          code,
          message: errorMessage(t, code, raw ?? ''),
        });
        return;
      }
      if (abortRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      // 2) AudioContext + PCM node. Prefer 16 kHz; fall back to the context's
      //    default rate — the node resamples internally in either case.
      //    createPcmNode tries AudioWorklet (blob + data URL) and finally the
      //    legacy ScriptProcessorNode, so capture works even on Electron
      //    builds where worklet module loading is unavailable.
      let ctx: AudioContext;
      let node: Awaited<ReturnType<typeof createPcmNode>>;
      try {
        let created: AudioContext;
        try {
          created = new AudioContext({ sampleRate: 16000 });
        } catch {
          created = new AudioContext();
        }
        node = await createPcmNode(created, stream, (data) => {
          if (abortRef.current) return;
          window.electronAPI?.sttSendAudio?.(data);
        });
        if (!node) {
          throw new Error('No usable PCM capture node could be created.');
        }
        ctx = created;
      } catch (err) {
        stream.getTracks().forEach((track) => track.stop());
        const raw = err instanceof Error ? err.message : 'Audio setup failed';
        console.error('[STT] AudioContext/PCM setup failed:', raw);
        useSttStore.getState().setError({
          code: 'UNKNOWN',
          message: errorMessage(t, 'UNKNOWN', raw),
        });
        return;
      }
      if (abortRef.current) {
        try {
          node.disconnect();
        } catch {
          // Already closed.
        }
        stream.getTracks().forEach((track) => track.stop());
        void ctx.close().catch(() => {});
        return;
      }

      streamRef.current = stream;
      ctxRef.current = ctx;
      nodeRef.current = node;
      useSttStore.getState().setMicActive(true);
      // Permission is now granted — re-enumerate so device labels populate.
      void refreshSttInputDevices();

      // 3) Tell the main process to open the Soniox session with the current
      //    language/translation configuration (read fresh from the store).
      const { sttLanguage, targetLanguage, translationEnabled } = useSttStore.getState();
      let result: { ok: boolean; code?: string; message?: string } | undefined;
      try {
        result = await window.electronAPI?.sttStart?.({
          sttLanguage,
          targetLanguage,
          translationEnabled,
        });
      } catch (err) {
        const raw = err instanceof Error ? err.message : undefined;
        console.error('[STT] sttStart IPC failed:', raw);
        cleanupMic();
        useSttStore.getState().setError({
          code: 'UNKNOWN',
          message: errorMessage(t, 'UNKNOWN', raw ?? ''),
        });
        return;
      }
      if (!result?.ok) {
        cleanupMic();
        const code = (result?.code ?? 'UNKNOWN') as SttErrorCode;
        useSttStore.getState().setError({
          code,
          message: errorMessage(t, code, result?.message ?? ''),
        });
        return;
      }
      useSttStore.getState().setDetectedLanguage(null);
      useSttStore.getState().setError(null);
    },
    [cleanupMic, t]
  );

  const stop = useCallback(async () => {
    abortRef.current = true;
    // Seal any in-flight text (kept visible via the "last" fields), release
    // the mic, then close the session.
    flushClose();
    cleanupMic();
    await window.electronAPI?.sttStop?.();
  }, [cleanupMic, flushClose]);

  return { start, stop, refreshStatus: refreshSttStatus };
}
