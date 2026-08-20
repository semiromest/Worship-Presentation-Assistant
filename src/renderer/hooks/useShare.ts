import { useCallback, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { useStore } from '../state/useStore';
import { useSttStore } from '../state/useSttStore';
import type { ShareSnapshot } from '../../shared/share';
import { IS_PROJECTOR_MODE } from '../constants';

/** Bound the history pushed to phones (they only need the recent tail). */
const HISTORY_LIMIT = 15;

type SttState = ReturnType<typeof useSttStore.getState>;

/** Normalize the STT store into the single snapshot phones consume. */
function buildSnapshot(s: SttState): ShareSnapshot {
  const original = (s.currentOriginal + s.partialOriginal).trim();
  const translation = (s.currentTranslation + s.partialTranslation).trim();
  return {
    sessionStatus: s.status,
    translationEnabled: s.translationEnabled,
    detectedLanguage: s.detectedLanguage,
    original,
    translation,
    lastOriginal: s.lastOriginal,
    lastTranslation: s.lastTranslation,
    history: s.utterances.slice(-HISTORY_LIMIT).map((u) => ({
      id: u.id,
      original: u.original,
      translation: u.translation,
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
  const setShareActive = useStore((s) => s.setShareActive);
  const setShareUrl = useStore((s) => s.setShareUrl);
  const setShareQr = useStore((s) => s.setShareQr);
  const setShareClientCount = useStore((s) => s.setShareClientCount);
  const setShareNetworkChanged = useStore((s) => s.setShareNetworkChanged);

  // Mirrors shareActive for the STT subscription without re-subscribing on toggle.
  const activeRef = useRef(useStore.getState().shareActive);

  useEffect(() => {
    const unsub = useStore.subscribe((s) => {
      activeRef.current = s.shareActive;
    });
    return unsub;
  }, []);

  // STT state → normalized snapshot → main process.
  useEffect(() => {
    if (IS_PROJECTOR_MODE) return;
    const publish = (s: SttState) => {
      if (!activeRef.current) return;
      window.electronAPI?.sharePublish?.(buildSnapshot(s));
    };
    const unsub = useSttStore.subscribe(publish);
    // Push the current state once so a just-started broadcast has a snapshot.
    publish(useSttStore.getState());
    return unsub;
  }, []);

  // Main → renderer events: client count, network change, status re-hydration.
  useEffect(() => {
    if (IS_PROJECTOR_MODE) return;

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
      if (!status?.active) return;
      setShareActive(true);
      setShareUrl(status.url);
      setShareClientCount(status.clientCount);
      QRCode.toDataURL(status.url)
        .then(setShareQr)
        .catch(() => setShareQr(null));
    });

    return () => {
      offCount?.();
      offNetwork?.();
    };
  }, [setShareActive, setShareUrl, setShareQr, setShareClientCount, setShareNetworkChanged]);

  const startShare = useCallback(async () => {
    const res = await window.electronAPI?.shareStart?.();
    if (!res?.ok || !res.url) return;
    setShareActive(true);
    setShareUrl(res.url);
    setShareClientCount(0);
    setShareNetworkChanged(false);
    QRCode.toDataURL(res.url)
      .then(setShareQr)
      .catch(() => setShareQr(null));
    // Publish the current state immediately (the subscription only fires on change).
    window.electronAPI?.sharePublish?.(buildSnapshot(useSttStore.getState()));
  }, [setShareActive, setShareUrl, setShareQr, setShareClientCount, setShareNetworkChanged]);

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
