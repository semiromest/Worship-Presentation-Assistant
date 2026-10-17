import { playSfx } from '../sfx';
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Scissors,
  Volume2,
  Repeat,
  Film,
  ChevronFirst,
  ChevronLast,
} from 'lucide-react';
import type { Slide, VideoTextOverlay } from '../types';
import { VideoOverlayLayer } from '../components/VideoOverlayLayer';
import { overlayVisible } from '../videoOverlays';
import { VideoTextTools } from './VideoTextTools';
import { isEditableTarget, makeItemId } from './editorUtils';
import { RangeVideo } from '../components/RangeVideo';
import { videoAudio, videoRange, type VideoPlaybackSettings } from '../videoPlayback';
import { analyzeVideo, type VideoAnalysis } from './videoAnalysis';
import { timelineTime, trimBoundary, videoTimecode } from './videoTimeline';
import './videoEditor.css';

/* -------------------------------------------------------------------------- */
/* Constants & helpers                                                         */
/* -------------------------------------------------------------------------- */

type Boundary = 'start' | 'end';
type InspectorMode = 'video' | 'text';

type Gesture = {
  kind: Boundary | 'seek';
  start: number;
  end: number;
  pointerId: number;
  offset: number;
  /** Timeline geometry is cached on pointer-down so pointer-move never forces layout. */
  left: number;
  width: number;
};

const FRAME_SLOTS = Array.from({ length: 8 }, (_, index) => index);
const RULER_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4];
const TRIM_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
const VOLUME_KEYS = TRIM_KEYS;
const TAB_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
const TOUCH_NONE = { touchAction: 'none' } as const;
const FIELD_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const CONTROL_SELECTOR = 'button, a[href], [role="slider"], [role="tab"]';
const BOUNDARY_FIELDS = [
  { kind: 'start', label: 'common.videoStart', action: 'common.videoSetStart' },
  { kind: 'end', label: 'common.videoEnd', action: 'common.videoSetEnd' },
] as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const isUsableRange = (from: number, to: number, total: number) =>
  Number.isFinite(from) && Number.isFinite(to) && from >= 0 && from < to && to <= total;

/**
 * Returns a referentially stable function that always calls the latest `fn`.
 * Lets memoized children receive callbacks that never change identity
 * while still seeing fresh props/state.
 */
function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}

/* -------------------------------------------------------------------------- */
/* Memoized building blocks (do not re-render on every playback frame)         */
/* -------------------------------------------------------------------------- */

const IconButton = memo(function IconButton({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: typeof Play;
  onClick: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="ve-icon-button"
      title={t(label)}
      aria-label={t(label)}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={17} />
    </button>
  );
});

const TrimSection = memo(function TrimSection({
  valid,
  duration,
  start,
  end,
  onDraft,
  onCommit,
  onMark,
  onReset,
}: {
  valid: boolean;
  duration: number;
  start: number;
  end: number;
  onDraft: (kind: Boundary, value: number) => void;
  onCommit: () => void;
  onMark: (kind: Boundary) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section>
      <h4>
        <Scissors size={15} />
        {t('common.videoTrim')}
      </h4>
      <fieldset disabled={!valid} className="ve-boundaries">
        {BOUNDARY_FIELDS.map((field) => {
          const value = field.kind === 'start' ? start : end;
          return (
            <label key={field.kind}>
              <span>
                {t(field.label)}
                <small>{videoTimecode(value)}</small>
              </span>
              <div>
                <input
                  type="number"
                  min={0}
                  max={duration || 1}
                  step="0.01"
                  value={Number.isFinite(value) ? Number(value.toFixed(3)) : ''}
                  aria-label={`${t(field.label)} (${t('common.videoSeconds')})`}
                  onChange={(event) => onDraft(field.kind, event.target.value === '' ? NaN : Number(event.target.value))}
                  onBlur={onCommit}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    event.stopPropagation();
                    onCommit();
                  }}
                />
                <span>{t('common.videoSeconds')}</span>
              </div>
              <button type="button" onClick={() => onMark(field.kind)}>
                {t(field.action)}
              </button>
            </label>
          );
        })}
      </fieldset>
      <button type="button" className="ve-reset" disabled={!valid} onClick={onReset}>
        <RotateCcw size={13} />
        {t('common.videoResetTrim')}
      </button>
    </section>
  );
});

const PlaybackSection = memo(function PlaybackSection({
  loop,
  rate,
  span,
  onPatch,
}: {
  loop: boolean;
  rate: number;
  span: number;
  onPatch: (patch: Partial<VideoPlaybackSettings>) => void;
}) {
  const { t } = useTranslation();
  const speeds = useMemo(() => [...new Set([...SPEEDS, rate])].sort((a, b) => a - b), [rate]);
  const length = Number.isFinite(span) && rate > 0 ? Math.max(0, span) / rate : 0;
  return (
    <section>
      <h4>
        <Repeat size={15} />
        {t('common.videoPlayback')}
      </h4>
      <label className="ve-switch">
        <span>{t('common.videoLoop')}</span>
        <input type="checkbox" checked={loop} onChange={(event) => onPatch({ loop: event.target.checked })} />
      </label>
      <label className="ve-select">
        <span>{t('common.videoSpeed')}</span>
        <select
          aria-label={t('common.videoSpeed')}
          value={rate}
          onChange={(event) => onPatch({ playbackRate: Number(event.target.value) })}
        >
          {speeds.map((speed) => (
            <option key={speed} value={speed}>
              {speed}×
            </option>
          ))}
        </select>
      </label>
      <p className="ve-note">{t('common.videoPlaybackLength', { time: videoTimecode(length) })}</p>
    </section>
  );
});

const AudioSection = memo(function AudioSection({
  muted,
  volume,
  onVolumeDraft,
  onVolumeCommit,
  onMutedChange,
}: {
  muted: boolean;
  volume: number;
  onVolumeDraft: (value: number) => void;
  onVolumeCommit: (value: number) => void;
  onMutedChange: (muted: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <section>
      <h4>
        <Volume2 size={15} />
        {t('common.videoAudio')}
      </h4>
      <label className="ve-switch">
        <span>{t('common.videoMuted')}</span>
        <input type="checkbox" checked={muted} onChange={(event) => onMutedChange(event.target.checked)} />
      </label>
      <label className="ve-volume">
        <span>
          {t('common.videoVolume')}
          <output>{Math.round(volume * 100)}%</output>
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          aria-label={t('common.videoVolume')}
          disabled={muted}
          onChange={(event) => onVolumeDraft(Number(event.target.value))}
          onPointerUp={(event) => onVolumeCommit(Number(event.currentTarget.value))}
          onKeyUp={(event) => {
            if (VOLUME_KEYS.includes(event.key)) onVolumeCommit(Number(event.currentTarget.value));
          }}
          onBlur={(event) => onVolumeCommit(Number(event.currentTarget.value))}
        />
      </label>
    </section>
  );
});

/* -------------------------------------------------------------------------- */
/* Main component                                                              */
/* -------------------------------------------------------------------------- */

export default function VideoEditor({
  slide,
  playback,
  active,
  onChange,
  onValidityChange,
  overlays = [],
  selectedOverlayId,
  onOverlaysChange,
  onSelectOverlay,
  onAddOverlay,
  onGestureStart,
  onGestureEnd,
}: {
  slide: Slide;
  playback?: VideoPlaybackSettings;
  active: boolean;
  onChange: (settings: VideoPlaybackSettings) => void;
  onValidityChange: (valid: boolean) => void;
  overlays?: VideoTextOverlay[];
  selectedOverlayId?: string;
  onOverlaysChange: (overlays: VideoTextOverlay[], history?: boolean) => void;
  onSelectOverlay: (id: string | undefined) => void;
  onAddOverlay: () => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const videoTabRef = useRef<HTMLButtonElement>(null);
  const textTabRef = useRef<HTMLButtonElement>(null);
  const gesture = useRef<Gesture | undefined>(undefined);

  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const [analysis, setAnalysis] = useState<VideoAnalysis>();
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [textTimingValid, setTextTimingValid] = useState(true);
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>('video');

  /* Reset per-video state when the source changes (adjust-state-during-render pattern,
     so the freshly mounted <RangeVideo> can report its duration without being clobbered). */
  const sourceKey = `${slide.id}:${slide.mediaUrl ?? ''}`;
  const [source, setSource] = useState(sourceKey);
  if (source !== sourceKey) {
    setSource(sourceKey);
    setFailed(false);
    setDuration(0);
    setPosition(0);
    setPlaying(false);
    setAnalysis(undefined);
    setAnalysisFailed(false);
  }

  const range = videoRange(playback, duration);
  const audio = videoAudio(playback);
  const [volumeDraft, setVolumeDraft] = useState(audio.volume);
  const [start, setStart] = useState(range.start);
  const [end, setEnd] = useState(range.end);

  const valid = duration > 0 && !failed;
  const invalid = valid && !isUsableRange(start, end, duration);
  const canPlay = valid && !invalid && textTimingValid;
  const selectedOverlay = overlays.find((item) => item.id === selectedOverlayId);
  const fps = analysis?.fps && Number.isFinite(analysis.fps) ? analysis.fps : 30;
  const frameStep = 1 / fps;

  useEffect(() => {
    if (selectedOverlayId) setInspectorMode('text');
  }, [selectedOverlayId]);

  /* Keep drafts in sync with committed values; drop drafts when the editor is deactivated. */
  useEffect(() => {
    if (!active) gesture.current = undefined;
    setStart(range.start);
    setEnd(range.end);
  }, [active, range.start, range.end]);
  useEffect(() => {
    setVolumeDraft(audio.volume);
  }, [active, audio.volume]);

  /* Preview settings only change when playback or the volume draft changes,
     so <RangeVideo> does not receive a new object on every frame. */
  const previewPlayback = useMemo(() => ({ ...playback, volume: volumeDraft }), [playback, volumeDraft]);

  /* ----------------------------- video analysis ---------------------------- */
  useEffect(() => {
    if (!active || !slide.mediaUrl || !(duration > 0) || failed) return;
    const abort = new AbortController();
    setAnalyzing(true);
    setAnalysisFailed(false);
    analyzeVideo(slide.mediaUrl, duration, abort.signal)
      .then((result) => {
        if (abort.signal.aborted) return;
        setAnalysis(result);
        setAnalysisFailed(!result.frames.some(Boolean));
      })
      .catch(() => {
        if (!abort.signal.aborted) setAnalysisFailed(true);
      })
      .finally(() => {
        if (!abort.signal.aborted) setAnalyzing(false);
      });
    return () => abort.abort();
  }, [active, slide.mediaUrl, duration, failed, retry]);

  /* ------------------------------ validity -------------------------------- */
  const reportValidity = useStableCallback(onValidityChange);
  useEffect(() => {
    reportValidity(!invalid && textTimingValid);
  }, [invalid, textTimingValid, reportValidity]);
  useEffect(() => () => reportValidity(true), [reportValidity]);

  /* ----------------------------- video callbacks --------------------------- */
  const handleDuration = useCallback((seconds: number) => {
    setDuration(Number.isFinite(seconds) && seconds > 0 ? seconds : 0);
  }, []);
  const handleError = useCallback(() => {
    setFailed(true);
    setDuration(0);
  }, []);

  const seek = useStableCallback((seconds: number) => {
    const video = videoRef.current;
    if (!valid || !active || !video || !Number.isFinite(seconds)) return;
    video.pause();
    const time = clamp(seconds, 0, Math.max(0, duration - 0.001));
    video.currentTime = time;
    setPosition(time);
  });

  /* Coalesce seeks produced by pointer-move into at most one per animation frame. */
  const rafId = useRef(0);
  const pendingSeek = useRef<number | undefined>(undefined);
  const scheduleSeek = useStableCallback((time: number) => {
    pendingSeek.current = time;
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = 0;
      const next = pendingSeek.current;
      pendingSeek.current = undefined;
      if (next !== undefined) seek(next);
    });
  });
  const cancelScheduledSeek = useStableCallback((flush = false) => {
    if (rafId.current) cancelAnimationFrame(rafId.current);
    rafId.current = 0;
    const next = pendingSeek.current;
    pendingSeek.current = undefined;
    if (flush && next !== undefined) seek(next);
  });
  useEffect(() => () => cancelScheduledSeek(), [cancelScheduledSeek]);

  const togglePlay = useStableCallback(() => {
    const video = videoRef.current;
    if (!video || !active || !canPlay) return;
    if (video.paused) void video.play().then(() => { if (!video.paused) playSfx('play'); }).catch(() => { setPlaying(false); playSfx('error'); });
    else { video.pause(); playSfx('pause'); }
  });

  /* ------------------------------ trim / settings -------------------------- */
  const patchPlayback = useStableCallback((patch: Partial<VideoPlaybackSettings>) => {
    if (active) onChange({ ...playback, ...patch });
  });

  const commit = useStableCallback((from: number = start, to: number = end) => {
    if (!valid || !isUsableRange(from, to, duration)) return;
    if (from === range.start && to === range.end) return;
    patchPlayback({ startSeconds: from, endSeconds: to });
  });

  /** Updates the drafts immediately and commits, so rapid key repeats never act on stale values. */
  const applyTrim = useStableCallback((from: number, to: number) => {
    setStart(from);
    setEnd(to);
    commit(from, to);
  });

  const draftBoundary = useCallback((kind: Boundary, value: number) => {
    if (kind === 'start') setStart(value);
    else setEnd(value);
  }, []);
  const commitDraft = useStableCallback(() => commit(start, end));
  const markBoundary = useStableCallback((kind: Boundary) => {
    const value = trimBoundary(kind, position, start, end, duration);
    applyTrim(kind === 'start' ? value : start, kind === 'end' ? value : end);
  });
  const resetTrim = useStableCallback(() => applyTrim(0, duration));

  const commitVolume = useStableCallback((value: number) => {
    if (value !== audio.volume) patchPlayback({ volume: value });
  });
  const changeMuted = useStableCallback((muted: boolean) => patchPlayback({ muted }));

  /* ------------------------------ overlays -------------------------------- */
  const overlayGestureOpen = useRef(false);
  const endOverlayGesture = useStableCallback(() => {
    overlayGestureOpen.current = false;
    onGestureEnd();
  });
  const patchOverlay = useStableCallback((id: string, patch: Partial<VideoTextOverlay>, continuous = false) => {
    if (!active) return;
    if (continuous) {
      if (!overlayGestureOpen.current) {
        overlayGestureOpen.current = true;
        onGestureStart();
      }
    } else {
      endOverlayGesture();
    }
    onOverlaysChange(
      overlays.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      !continuous
    );
  });
  const patchOverlayContinuous = useStableCallback((id: string, patch: Partial<VideoTextOverlay>) =>
    patchOverlay(id, patch, true)
  );
  const patchSelectedOverlay = useStableCallback((patch: Partial<VideoTextOverlay>, continuous?: boolean) => {
    if (selectedOverlayId) patchOverlay(selectedOverlayId, patch, continuous);
  });
  const removeOverlay = useStableCallback(() => {
    if (!selectedOverlayId) return;
    endOverlayGesture();
    onOverlaysChange(overlays.filter((item) => item.id !== selectedOverlayId));
    onSelectOverlay(undefined);
  });
  const duplicateOverlay = useStableCallback(() => {
    if (!selectedOverlay) return;
    endOverlayGesture();
    const copy: VideoTextOverlay = {
      ...selectedOverlay,
      id: makeItemId(),
      x: clamp(selectedOverlay.x + 2, 0, Math.max(0, 100 - selectedOverlay.width)),
      y: clamp(selectedOverlay.y + 2, 0, Math.max(0, 100 - selectedOverlay.height)),
      zIndex: overlays.reduce((max, item) => Math.max(max, item.zIndex), selectedOverlay.zIndex) + 1,
    };
    onOverlaysChange([...overlays, copy]);
    onSelectOverlay(copy.id);
  });
  const selectOverlay = useStableCallback((id: string | undefined) => onSelectOverlay(id));
  const addOverlay = useStableCallback(() => onAddOverlay());

  /* ------------------------------ timeline pointer ------------------------- */
  const beginPointer = (event: PointerEvent, kind: Gesture['kind']) => {
    if (!valid || !active || event.button !== 0) return;
    const box = timelineRef.current?.getBoundingClientRect();
    if (!box || !(box.width > 0)) return;
    event.preventDefault();
    event.stopPropagation();
    const pointerTime = timelineTime(event.clientX, box.left, box.width, duration);
    gesture.current = {
      kind,
      start: range.start,
      end: range.end,
      pointerId: event.pointerId,
      offset: kind === 'seek' ? 0 : pointerTime - (kind === 'start' ? range.start : range.end),
      left: box.left,
      width: box.width,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    movePointer(event);
  };

  const movePointer = (event: PointerEvent) => {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const time = timelineTime(event.clientX, drag.left, drag.width, duration) - drag.offset;
    if (drag.kind === 'seek') {
      scheduleSeek(time);
      return;
    }
    const value = trimBoundary(drag.kind, time, drag.start, drag.end, duration);
    if (drag.kind === 'start') {
      drag.start = value;
      setStart(value);
    } else {
      drag.end = value;
      setEnd(value);
    }
    scheduleSeek(value);
  };

  const finishPointer = (event: PointerEvent, cancelled = false) => {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    gesture.current = undefined;
    cancelScheduledSeek(!cancelled);
    if (cancelled) {
      setStart(range.start);
      setEnd(range.end);
    } else if (drag.kind !== 'seek') {
      commit(drag.start, drag.end);
    }
  };

  const trimKey = (event: KeyboardEvent, kind: Boundary) => {
    if (!active || !valid || !TRIM_KEYS.includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const current = kind === 'start' ? start : end;
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? duration
          : current + direction * frameStep * (event.shiftKey ? 10 : 1);
    const value = trimBoundary(kind, next, start, end, duration);
    applyTrim(kind === 'start' ? value : start, kind === 'end' ? value : end);
    seek(value);
  };

  /* ------------------------------ transport -------------------------------- */
  const toStart = useStableCallback(() => seek(start));
  const stepBack = useStableCallback(() => seek(position - frameStep));
  const stepForward = useStableCallback(() => seek(position + frameStep));
  const toEnd = useStableCallback(() => seek(end - 0.001));

  /* ------------------------------ shortcuts -------------------------------- */
  const onWorkspaceKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!active || event.defaultPrevented || isEditableTarget(event.target)) return;
    const el = event.target instanceof Element ? event.target : null;
    if (el?.closest(FIELD_SELECTOR)) return;
    const modifier = event.ctrlKey || event.metaKey;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    if (selectedOverlay) {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        handled();
        removeOverlay();
        return;
      }
      if (modifier && event.key.toLowerCase() === 'd') {
        handled();
        duplicateOverlay();
        return;
      }
    }

    if (modifier || event.altKey || !valid) return;
    const onControl = !!el?.closest(CONTROL_SELECTOR);
    switch (event.key) {
      case ' ':
        if (onControl) return;
        handled();
        togglePlay();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        // Arrow keys belong to the overlay layer while a text layer is selected.
        if (onControl || selectedOverlay) return;
        handled();
        seek(position + (event.key === 'ArrowLeft' ? -1 : 1) * frameStep * (event.shiftKey ? 10 : 1));
        break;
      case 'i':
      case 'I':
        handled();
        markBoundary('start');
        break;
      case 'o':
      case 'O':
        handled();
        markBoundary('end');
        break;
    }
  };

  const onTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!TAB_KEYS.includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const mode: InspectorMode =
      event.key === 'Home' ? 'video' : event.key === 'End' ? 'text' : inspectorMode === 'video' ? 'text' : 'video';
    setInspectorMode(mode);
    (mode === 'video' ? videoTabRef : textTabRef).current?.focus();
  };

  /* ------------------------------ derived view data ------------------------ */
  const toPercent = (time: number) =>
    `${valid && Number.isFinite(time) ? clamp((time / duration) * 100, 0, 100) : 0}%`;
  const rulerLabels = useMemo(() => RULER_FRACTIONS.map((fraction) => videoTimecode(duration * fraction)), [duration]);
  const videoTabId = `${uid}-video-tab`;
  const textTabId = `${uid}-text-tab`;
  const videoPanelId = `${uid}-video-tools`;
  const textPanelId = `${uid}-text-tools`;

  return (
    <div className="ve-workspace" data-video-editor tabIndex={-1} onKeyDown={onWorkspaceKeyDown}>
      <div className="ve-main">
        <header className="ve-heading">
          <div>
            <Film size={17} />
            <h3>{t('common.videoEditorTitle')}</h3>
          </div>
          <span>{t('common.videoOriginalSafe')}</span>
        </header>

        <div className="ve-preview">
          <VideoOverlayLayer
            overlays={overlays}
            position={position}
            selectedId={selectedOverlayId}
            editing={!playing}
            active={active}
            onSelect={selectOverlay}
            onPatch={patchOverlayContinuous}
            onGestureEnd={endOverlayGesture}
          >
            <RangeVideo
              videoRef={videoRef}
              key={sourceKey}
              src={slide.mediaUrl}
              playback={previewPlayback}
              active={active}
              allowOutsideRangeWhilePaused
              className={slide.styles?.objectFit === 'cover' ? 'object-cover' : 'object-contain'}
              onDuration={handleDuration}
              onPosition={setPosition}
              onPlayingChange={setPlaying}
              onError={handleError}
            />
          </VideoOverlayLayer>
          {!playing && valid && !selectedOverlay && (
            <button
              type="button"
              className="ve-preview-play"
              onClick={togglePlay}
              aria-label={t('common.videoPlay')}
              disabled={!canPlay}
            >
              <Play size={24} fill="currentColor" />
            </button>
          )}
        </div>

        <div className="ve-transport">
          <div>
            <IconButton label="common.videoToStart" icon={ChevronFirst} onClick={toStart} disabled={!valid} />
            <IconButton label="common.videoPreviousFrame" icon={SkipBack} onClick={stepBack} disabled={!valid} />
            <button
              type="button"
              className="ve-play-button"
              onClick={togglePlay}
              disabled={!canPlay}
              aria-keyshortcuts="Space"
              aria-label={t(playing ? 'common.videoPause' : 'common.videoPlay')}
            >
              {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            </button>
            <IconButton label="common.videoNextFrame" icon={SkipForward} onClick={stepForward} disabled={!valid} />
            <IconButton label="common.videoToEnd" icon={ChevronLast} onClick={toEnd} disabled={!valid} />
          </div>
          <output className="ve-timecode">
            {videoTimecode(position)}
            <span> / {videoTimecode(duration)}</span>
          </output>
        </div>

        <section className="ve-timeline-panel" aria-label={t('common.videoTimeline')}>
          <div className="ve-timeline-heading">
            <span>
              <Scissors size={14} />
              {t('common.videoSelectedRange')}
            </span>
            <strong>{videoTimecode(Number.isFinite(end - start) ? Math.max(0, end - start) : 0)}</strong>
          </div>
          <div className="ve-ruler">
            {RULER_FRACTIONS.map((fraction, index) => (
              <span key={fraction}>{rulerLabels[index]}</span>
            ))}
          </div>
          <div
            className="ve-filmstrip"
            ref={timelineRef}
            style={TOUCH_NONE}
            onPointerDown={(event) => beginPointer(event, 'seek')}
            onPointerMove={movePointer}
            onPointerUp={(event) => finishPointer(event)}
            onPointerCancel={(event) => finishPointer(event, true)}
            onLostPointerCapture={(event) => finishPointer(event, true)}
          >
            <div className="ve-frames" aria-hidden="true">
              {FRAME_SLOTS.map((index) => {
                const src = analysis?.frames[index] || slide.thumbnailUrl;
                return (
                  <div key={index}>
                    {src ? <img src={src} alt="" draggable={false} decoding="async" /> : <Film size={20} />}
                  </div>
                );
              })}
            </div>
            <div className="ve-excluded ve-excluded-left" style={{ width: toPercent(start) }} />
            <div className="ve-excluded ve-excluded-right" style={{ left: toPercent(end) }} />
            <div className="ve-trim-selection" style={{ left: toPercent(start), right: toPercent(duration - end) }} />
            {(['start', 'end'] as const).map((kind) => {
              const value = kind === 'start' ? start : end;
              return (
                <button
                  key={kind}
                  type="button"
                  role="slider"
                  className={`ve-trim-handle ve-trim-${kind}`}
                  style={{ left: toPercent(value), ...TOUCH_NONE }}
                  aria-label={t(kind === 'start' ? 'common.videoStart' : 'common.videoEnd')}
                  aria-valuemin={kind === 'start' ? 0 : start + 0.01}
                  aria-valuemax={kind === 'start' ? end - 0.01 : duration}
                  aria-valuenow={value}
                  aria-valuetext={videoTimecode(value)}
                  disabled={!valid}
                  onPointerDown={(event) => beginPointer(event, kind)}
                  onKeyDown={(event) => trimKey(event, kind)}
                >
                  <span />
                </button>
              );
            })}
            <div className="ve-playhead" style={{ left: toPercent(position) }} />
          </div>
          <input
            className="ve-seek-accessible"
            type="range"
            min="0"
            max={duration || 1}
            step={frameStep}
            value={Math.min(position, duration)}
            disabled={!valid}
            aria-label={t('common.videoSeek')}
            onChange={(event) => seek(Number(event.target.value))}
          />
          {overlays.length > 0 && (
            <div className="ve-overlay-tracks">
              {overlays.map((item, index) => (
                <button
                  type="button"
                  key={item.id}
                  className="ve-overlay-track"
                  aria-pressed={selectedOverlayId === item.id}
                  title={item.content}
                  aria-label={`${t('common.videoTextLayers')} ${index + 1}`}
                  onClick={() => {
                    selectOverlay(item.id);
                    seek(item.startSeconds ?? range.start);
                  }}
                >
                  <span
                    style={{
                      left: toPercent(item.startSeconds ?? 0),
                      right: toPercent(duration - (item.endSeconds ?? duration)),
                    }}
                  >
                    {item.content || t('common.videoEmptyText')}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="ve-timeline-help">
            <span
              title={t('common.videoShortcutsHint', {
                defaultValue: 'Space: play/pause · ←/→: step frame (Shift ×10) · I / O: set start / end at playhead',
              })}
            >
              {t('common.videoTrimHint')}
            </span>
            {analyzing ? (
              <span>{t('common.videoFramesLoading')}</span>
            ) : analysisFailed ? (
              <button
                type="button"
                onClick={() => setRetry((value) => value + 1)}
                title={t('common.videoFramesUnavailable')}
              >
                {t('common.videoRetryFrames')}
              </button>
            ) : null}
          </div>
        </section>

        {invalid && (
          <p role="alert" className="ve-alert">
            {t('common.videoInvalidRange')}
          </p>
        )}
        {!valid && (
          <p role="status" className="ve-alert">
            {t(failed ? 'common.videoLoadFailed' : 'common.videoDurationPending')}
          </p>
        )}
      </div>

      <aside className="ve-inspector">
        <div
          className="ve-inspector-tabs"
          role="tablist"
          aria-label={t('common.videoEditorTitle')}
          onKeyDown={onTabsKeyDown}
        >
          <button
            ref={videoTabRef}
            type="button"
            role="tab"
            tabIndex={inspectorMode === 'video' ? 0 : -1}
            id={videoTabId}
            aria-controls={videoPanelId}
            aria-selected={inspectorMode === 'video'}
            onClick={() => setInspectorMode('video')}
          >
            {t('common.videoSettingsTab')}
          </button>
          <button
            ref={textTabRef}
            type="button"
            role="tab"
            tabIndex={inspectorMode === 'text' ? 0 : -1}
            id={textTabId}
            aria-controls={textPanelId}
            aria-selected={inspectorMode === 'text'}
            onClick={() => setInspectorMode('text')}
          >
            {t('common.videoTextsTab')}
            {overlays.length > 0 && ` (${overlays.length})`}
          </button>
        </div>

        <div
          className="ve-inspector-panel"
          role="tabpanel"
          id={textPanelId}
          aria-labelledby={textTabId}
          hidden={inspectorMode !== 'text'}
        >
          <VideoTextTools
            overlays={overlays}
            selectedId={selectedOverlayId}
            duration={duration}
            onSelect={selectOverlay}
            onAdd={addOverlay}
            onDuplicate={duplicateOverlay}
            onRemove={removeOverlay}
            onPatch={patchSelectedOverlay}
            onGestureEnd={endOverlayGesture}
            onValidityChange={setTextTimingValid}
          />
          {selectedOverlay && !overlayVisible(selectedOverlay, position) && (
            <p className="ve-note">{t('common.videoTextOutsideRange')}</p>
          )}
        </div>

        <div
          className="ve-inspector-panel"
          role="tabpanel"
          id={videoPanelId}
          aria-labelledby={videoTabId}
          hidden={inspectorMode !== 'video'}
        >
          <TrimSection
            valid={valid}
            duration={duration}
            start={start}
            end={end}
            onDraft={draftBoundary}
            onCommit={commitDraft}
            onMark={markBoundary}
            onReset={resetTrim}
          />
          <PlaybackSection loop={range.loop} rate={audio.playbackRate} span={end - start} onPatch={patchPlayback} />
          <AudioSection
            muted={range.muted}
            volume={volumeDraft}
            onVolumeDraft={setVolumeDraft}
            onVolumeCommit={commitVolume}
            onMutedChange={changeMuted}
          />
          {analysis && (
            <section className="ve-source-info">
              <h4>
                <Film size={15} />
                {t('common.videoSourceInfo')}
              </h4>
              <p>
                {analysis.width} × {analysis.height}
                {analysis.fps > 0 && ` · ${analysis.fps.toFixed(2)} fps`}
                {analysis.codec && ` · ${analysis.codec.toUpperCase()}`}
              </p>
            </section>
          )}
        </div>
        <p className="ve-preserve">{t('common.videoNonDestructive')}</p>
      </aside>
    </div>
  );
}