import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { attachVideoPlayback, videoAudio, type VideoPlaybackSettings } from '../videoPlayback';

/** Always-current ref: lets effects read fresh values without listing them as dependencies. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function RangeVideo({
  src,
  playback,
  active = true,
  autoplay = false,
  muted = false,
  volume = 1,
  className,
  controls = false,
  onDuration,
  onPosition,
  onError,
  videoRef,
  onPlayingChange,
  allowOutsideRangeWhilePaused = false,
}: {
  src?: string;
  playback?: VideoPlaybackSettings;
  active?: boolean;
  autoplay?: boolean;
  muted?: boolean;
  volume?: number;
  videoRef?: RefObject<HTMLVideoElement>;
  onPlayingChange?: (playing: boolean) => void;
  allowOutsideRangeWhilePaused?: boolean;
  className?: string;
  controls?: boolean;
  onDuration?: (seconds: number) => void;
  onPosition?: (seconds: number) => void;
  onError?: () => void;
}) {
  const internalRef = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? internalRef;

  const start = playback?.startSeconds;
  const end = playback?.endSeconds;
  const loop = playback?.loop;
  const slideMuted = playback?.muted;
  const slideVolume = playback?.volume;
  const playbackRate = playback?.playbackRate;

  const forcedMute = muted || (slideMuted ?? false);
  const audioSettings = videoAudio(playback, volume);
  const audio = useLatest({ muted: forcedMute, ...audioSettings });
  const positionCallback = useLatest(onPosition);

  /* Audio / rate settings. Declared before the attach effect so the element is already
     muted and at the right volume when autoplay starts. */
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = forcedMute;
    const settings = videoAudio({ volume: slideVolume, playbackRate }, volume);
    video.volume = settings.volume;
    video.playbackRate = settings.playbackRate;
    // The load algorithm resets `playbackRate` to `defaultPlaybackRate` whenever `src` changes;
    // setting both keeps the chosen speed when the same element switches sources.
    video.defaultPlaybackRate = settings.playbackRate;
    const enforceMute = () => {
      if (forcedMute && !video.muted) video.muted = true;
    };
    video.addEventListener('volumechange', enforceMute);
    return () => video.removeEventListener('volumechange', enforceMute);
  }, [forcedMute, slideVolume, playbackRate, volume, ref]);

  /* Range / loop / active handling. Speed and audio changes are intentionally not
     dependencies: they are applied by the effect above without re-attaching. */
  useEffect(() => {
    const video = ref.current;
    if (!video || !src) return;
    return attachVideoPlayback(
      video,
      { startSeconds: start, endSeconds: end, loop, playbackRate: audio.current.playbackRate },
      {
        active,
        autoplay,
        ...audio.current,
        allowOutsideRangeWhilePaused,
        onPosition: (seconds) => positionCallback.current?.(seconds),
      }
    );
  }, [src, start, end, loop, active, autoplay, allowOutsideRangeWhilePaused, ref, audio, positionCallback]);

  return (
    <video
      ref={ref}
      src={src}
      controls={controls}
      playsInline
      preload="metadata"
      className={className}
      onPlay={() => onPlayingChange?.(true)}
      onPause={() => onPlayingChange?.(false)}
      onSeeked={(event) => onPosition?.(event.currentTarget.currentTime)}
      onLoadedMetadata={(event) => onDuration?.(event.currentTarget.duration)}
      onDurationChange={(event) => onDuration?.(event.currentTarget.duration)}
      onTimeUpdate={(event) => onPosition?.(event.currentTarget.currentTime)}
      onError={onError}
    />
  );
}