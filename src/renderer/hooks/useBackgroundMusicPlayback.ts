import { playSfx } from '../sfx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../state/useStore';
import { activeMusicSlide, hasAudienceOutput } from '../musicSlides';
import { musicGain } from '../musicCustomization';
import { MusicEnvelope, MUSIC_FADE_IN_MS, MUSIC_FADE_OUT_MS } from '../audio/musicEnvelope';
import { toFileUrl } from '../utils';
import type { YouTubeMusicResult } from '../../shared/youtubeMusic';

export function useBackgroundMusicPlayback() {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  // Only explicit preview playback requests get sound; slide-driven playback stays silent.
  const manualPlayPending = useRef(false);
  const finishManualPlay = useCallback((failed = false) => {
    if (!manualPlayPending.current) return;
    manualPlayPending.current = false;
    playSfx(failed ? 'error' : 'play');
  }, []);
  const stream = useRef<string>();
  const request = useRef(0);
  const navigation = useRef(0);
  const youtubeActive = useRef(false);
  const playbackOwner = useRef<string | null>(null);
  const lastDesired = useRef<string | null>(null);
  const exiting = useRef(false);
  const fadeInPending = useRef(false);
  const [mixer] = useState(() => new MusicEnvelope(() => audioRef.current));
  const [loading, setLoading] = useState(false);
  const [track, setTrack] = useState<YouTubeMusicResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useStore(state => state.backgroundMusicCurrent);
  const playing = useStore(state => state.backgroundMusicPlaying);
  const volume = useStore(state => state.mediaVolume);
  const muted = useStore(state => state.isMediaMuted);
  const liveSlide = useStore(activeMusicSlide);
  const audienceOpen = useStore(hasAudienceOutput);
  const presentationId = useStore(state => state.presentation.id);
  const setCurrent = useStore(state => state.setBackgroundMusicCurrent);
  const setPlaying = useStore(state => state.setBackgroundMusicPlaying);
  const desiredKey = liveSlide ? JSON.stringify([presentationId, liveSlide.id, liveSlide.youtubeMusic!.id]) : null;
  const desired = useRef({ key: desiredKey, slide: liveSlide });
  desired.current = { key: desiredKey, slide: liveSlide };
  const translate = useRef(t); translate.current = t;

  useEffect(() => () => {
    navigation.current++; request.current++; mixer.cancel(); lastDesired.current = null;
    audioRef.current?.pause();
    void window.electronAPI?.youtubeMusicStop().catch(() => {});
  }, [mixer]);
  useEffect(() => { mixer.update({ master: volume, muted }); }, [volume, muted, mixer]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    if (current) audio.src = /^https?:\/\//i.test(current) ? current : toFileUrl(current);
    else { audio.removeAttribute('src'); audio.load(); }
  }, [current]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    let cancelled = false;
    if (playing) void audio.play().catch(() => {
      if (cancelled) return;
      setPlaying(false); setError(translate.current('settings.backgroundMusicPlayError'));
      finishManualPlay(true);
      void window.electronAPI?.youtubeMusicStop(stream.current).catch(() => {});
    });
    else audio.pause();
    return () => { cancelled = true; };
  }, [current, playing, setPlaying, finishManualPlay]);

  const stop = useCallback(() => {
    manualPlayPending.current = false;
    navigation.current++; request.current++; exiting.current = false;
    fadeInPending.current = false; playbackOwner.current = null;
    audioRef.current?.pause(); setPlaying(false);
    mixer.reset(); setLoading(false); setError(null);
    void window.electronAPI?.youtubeMusicStop().catch(() => {});
    if (youtubeActive.current) { setCurrent(null); youtubeActive.current = false; stream.current = undefined; }
    else if (audioRef.current) audioRef.current.currentTime = 0;
  }, [mixer, setCurrent, setPlaying]);

  const playYouTube = useCallback(async (video: YouTubeMusicResult, owner?: { key: string; gain: number }) => {
    manualPlayPending.current = !owner;
    navigation.current++; exiting.current = false;
    const ownRequest = ++request.current;
    playbackOwner.current = owner?.key ?? null;
    fadeInPending.current = !!owner;
    audioRef.current?.pause();
    mixer.update({ gain: owner?.gain ?? 1 }); mixer.reset(owner ? 0 : 1);
    youtubeActive.current = true; stream.current = undefined;
    setLoading(true); setPlaying(false); setCurrent(null); setTrack(video); setError(null);
    try {
      await window.electronAPI.youtubeMusicStop();
      if (ownRequest !== request.current) return;
      const response = await window.electronAPI.youtubeMusicPlay(video.id);
      if (ownRequest !== request.current || (owner && owner.key !== desired.current.key)) {
        if (response.ok) void window.electronAPI.youtubeMusicStop(response.streamId);
        return;
      }
      if (!response.ok) { setError(translate.current('settings.youtubePlayError')); finishManualPlay(true); return; }
      stream.current = response.streamId;
      setCurrent(response.url); setPlaying(true);
    } catch { if (ownRequest === request.current) { setError(translate.current('settings.youtubePlayError')); finishManualPlay(true); } }
    finally { if (ownRequest === request.current) setLoading(false); }
  }, [mixer, setCurrent, setPlaying, finishManualPlay]);

  useEffect(() => {
    if (!audienceOpen && (playbackOwner.current || exiting.current)) { lastDesired.current = desiredKey; stop(); return; }
    if (lastDesired.current === desiredKey) return;
    const previouslyOwned = playbackOwner.current !== null;
    lastDesired.current = desiredKey;
    request.current++; // A pending old stream must not start during the fade interval.
    const epoch = ++navigation.current;
    const next = () => {
      if (epoch !== navigation.current || desired.current.key !== desiredKey) return;
      exiting.current = false;
      const target = desired.current;
      if (target.key && target.slide?.youtubeMusic) {
        void playYouTube(target.slide.youtubeMusic, { key: target.key, gain: musicGain(target.slide.musicSettings?.volume) });
      } else if (previouslyOwned) stop();
    };
    if (previouslyOwned && audioRef.current && !audioRef.current.paused && audienceOpen) {
      exiting.current = true; fadeInPending.current = false;
      mixer.fadeTo(0, MUSIC_FADE_OUT_MS, next);
    } else next();
  }, [desiredKey, audienceOpen, mixer, playYouTube, stop]);
  useEffect(() => {
    if (desiredKey && playbackOwner.current === desiredKey) mixer.update({ gain: musicGain(liveSlide?.musicSettings?.volume) });
  }, [desiredKey, liveSlide?.musicSettings?.volume, mixer]);

  const playFile = (file: string) => {
    const state = useStore.getState();
    if (!youtubeActive.current && state.backgroundMusicCurrent === file && state.backgroundMusicPlaying) return;
    stop(); manualPlayPending.current = true; mixer.update({ gain: 1 }); mixer.reset(); setTrack(null);
    setCurrent(file); setPlaying(true);
  };
  const playPause = () => {
    if (!current && liveSlide?.youtubeMusic && desiredKey) {
      void playYouTube(liveSlide.youtubeMusic, { key: desiredKey, gain: musicGain(liveSlide.musicSettings?.volume) });
    } else {
      if (!current) return;
      manualPlayPending.current = !playing;
      if (playing) playSfx('pause');
      setPlaying(!playing);
    }
  };
  const onPlaying = () => {
    finishManualPlay();
    if (fadeInPending.current && playbackOwner.current === desired.current.key) {
      fadeInPending.current = false; mixer.fadeTo(1, MUSIC_FADE_IN_MS);
    }
  };
  const ended = () => {
    setPlaying(false);
    if (!exiting.current) mixer.cancel();
    if (stream.current) {
      void window.electronAPI?.youtubeMusicStop(stream.current).catch(() => {});
      stream.current = undefined; setCurrent(null);
    }
  };
  const onError = () => {
    finishManualPlay(true);
    if (!useStore.getState().backgroundMusicCurrent) return;
    setError(translate.current(track ? 'settings.youtubePlayError' : 'settings.backgroundMusicPlayError')); ended();
  };
  return { audioRef, loading, track, error, setError, liveSlide, current, playing, playYouTube, playFile, playPause, stop, onPlaying, ended, onError };
}
