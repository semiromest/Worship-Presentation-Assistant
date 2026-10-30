import { usePractice } from '../hooks/usePractice';
import { markTourReady } from '../state/useTourStore';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { useStore } from '../state/useStore';
import type { ShareSnapshot } from '../../shared/share';
import { IS_PROJECTOR_MODE } from '../constants';
import { useSttStore } from '../state/useSttStore';

/** Bound the history pushed to phones (they only need the recent tail). */
const HISTORY_LIMIT = 15;

type SttState = ReturnType<typeof useSttStore.getState>;

/** Normalize the STT store into the single snapshot phones consume. */
function buildSnapshot(s: SttState): ShareSnapshot {
  const translations = Object.fromEntries(s.targetLanguages.map((code) => [
    code,
    s.currentTranslations[code] ?? (code === s.targetLanguage ? s.currentTranslation : ''),
  ]));
  const partialTranslations = Object.fromEntries(s.targetLanguages.map((code) => [
    code,
    s.partialTranslations[code] ?? (code === s.targetLanguage ? s.partialTranslation : ''),
  ]));
  const translation = translations[s.targetLanguage] ?? '';
  return {
    sessionStatus: s.status,
    sessionId: s.sessionId,
    uiMotionEnabled: useStore.getState().uiMotionEnabled,
    translationEnabled: s.translationEnabled,
    detectedLanguage: s.detectedLanguage,
    targetLanguages: s.targetLanguages,
    original: s.currentOriginal,
    translation,
    translations,
    partialOriginal: s.partialOriginal,
    partialTranslation: partialTranslations[s.targetLanguage] ?? '',
    partialTranslations,
    lastOriginal: s.lastOriginal,
    lastTranslation: s.lastTranslation,
    lastTranslations: s.lastTranslations,
    history: s.utterances.slice(-HISTORY_LIMIT).map((u) => ({
      id: u.id,
      original: u.original,
      translation: u.translation,
      translations: u.translations,
    })),
  };
}

/**
 * Phone captions/translation share.
 *
 * A pure subscriber of the STT store: every normalized state change is pushed
 * to the main process (which holds the token, the WebSocket fan-out and the
 * mobile client). The STT/slide-tracking business logic is untouched. Only the
 * control window runs this hook; the projector window is a no-op.
 */
export function useShare(): { startShare: () => Promise<void>; stopShare: () => Promise<void> } {
  const { t } = useTranslation();
  const practice = usePractice();
  const setShareActive = useStore((s) => s.setShareActive);
  const setShareUrl = useStore((s) => s.setShareUrl);
  const setShareQr = useStore((s) => s.setShareQr);
  const setShareClientCount = useStore((s) => s.setShareClientCount);
  const setShareNetworkChanged = useStore((s) => s.setShareNetworkChanged);
  const setToastMessage = useStore((s) => s.setToastMessage);

  // Mirrors shareActive for the STT subscription without re-subscribing on toggle.
  const activeRef = useRef(useStore.getState().shareActive);

  useEffect(() => {
    const unsub = useStore.subscribe(s => s.shareActive, active => { activeRef.current = active; });
    return unsub;
  }, [practice]);

  // STT state → normalized snapshot → main process.
  useEffect(() => {
    if (IS_PROJECTOR_MODE || practice) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const publish = () => {
      if (!activeRef.current || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (activeRef.current) window.electronAPI?.sharePublish?.(buildSnapshot(useSttStore.getState()));
      }, 80);
    };
    const unsub = useSttStore.subscribe(publish);
    const offMotion = useStore.subscribe(state => state.uiMotionEnabled, publish);
    publish();
    return () => { unsub(); offMotion(); clearTimeout(timer); };
  }, [practice]);

  // Main → renderer events: client count, network change, status re-hydration.
  useEffect(() => {
    if (IS_PROJECTOR_MODE || practice) return;

    const offCount = window.electronAPI?.onShareClientCount?.((count) => {
      setShareClientCount(count);
    });

    const offNetwork = window.electronAPI?.onShareNetworkChanged?.(({ url }) => {
      setShareUrl(url);
      setShareNetworkChanged(true);
      QRCode.toDataURL(url)
        .then(setShareQr)
        .catch(() => setShareQr(null));
    });

    // Re-hydrate after a control-window reload while a broadcast is running.
    void window.electronAPI?.shareGetStatus?.().then((status) => {
      if (!status) return;
      if (!status.active) { markTourReady('share'); return; }
      setShareActive(true);
      setShareUrl(status.url);
      setShareClientCount(status.clientCount);
      QRCode.toDataURL(status.url)
        .then(setShareQr)
        .catch(() => setShareQr(null));
      markTourReady('share');
    });

    return () => {
      offCount?.();
      offNetwork?.();
    };
  }, [practice, setShareActive, setShareUrl, setShareQr, setShareClientCount, setShareNetworkChanged]);

  const startShare = useCallback(async () => {
    try {
      const res = await window.electronAPI?.shareStart?.();
      if (!res?.ok || !res.url) {
        setToastMessage(t('common.phoneShareFailed', { detail: res?.error ?? '' }), 'error');
        return;
      }
      setShareActive(true);
      setShareUrl(res.url);
      setShareClientCount(0);
      setShareNetworkChanged(false);
      if ((res as { localOnly?: boolean }).localOnly) {
        setToastMessage('phoneShareLocalOnly', 'info');
      }
      QRCode.toDataURL(res.url)
        .then(setShareQr)
        .catch(() => setShareQr(null));
      // Publish the current state immediately (the subscription only fires on change).
      window.electronAPI?.sharePublish?.(buildSnapshot(useSttStore.getState()));
    } catch (error) {
      setToastMessage(t('common.phoneShareFailed', { detail: error instanceof Error ? error.message : String(error) }), 'error');
    }
  }, [setShareActive, setShareUrl, setShareQr, setShareClientCount, setShareNetworkChanged, setToastMessage, t]);

  const stopShare = useCallback(async () => {
    await window.electronAPI?.shareStop?.();
    setShareActive(false);
    setShareUrl('');
    setShareQr(null);
    setShareClientCount(0);
    setShareNetworkChanged(false);
  }, [setShareActive, setShareUrl, setShareQr, setShareClientCount, setShareNetworkChanged]);

  return { startShare, stopShare };
}
