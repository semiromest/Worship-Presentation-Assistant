import { useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

function clock(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export default function AudioSeekBar({ audioRef, trackKey }: { audioRef: RefObject<HTMLAudioElement>; trackKey: string | null }) {
  const { t } = useTranslation();
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekable, setSeekable] = useState(false);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const update = () => {
      setPosition(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      setSeekable(audio.seekable.length > 0 && Number.isFinite(audio.duration) && audio.duration > 0);
    };
    const events = ['timeupdate', 'loadedmetadata', 'durationchange', 'progress', 'seeked', 'emptied', 'ended'];
    update();
    events.forEach(event => audio.addEventListener(event, update));
    return () => events.forEach(event => audio.removeEventListener(event, update));
  }, [audioRef, trackKey]);
  return <div className="space-y-1.5" data-testid="music-seek">
    <input type="range" min={0} max={duration || 1} step={0.1} value={Math.min(position, duration || 1)} disabled={!trackKey || !seekable}
      aria-label={t('settings.musicSeek')} aria-valuetext={`${clock(position)} / ${clock(duration)}`}
      className="w-full cursor-pointer accent-blue-400 disabled:cursor-default disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      onChange={event => {
        const audio = audioRef.current;
        if (!audio || !seekable) return;
        const requested = Number(event.target.value);
        let destination = 0; let distance = Infinity;
        for (let index = 0; index < audio.seekable.length; index++) {
          const candidate = Math.max(audio.seekable.start(index), Math.min(requested, audio.seekable.end(index)));
          if (Math.abs(candidate - requested) < distance) { destination = candidate; distance = Math.abs(candidate - requested); }
        }
        if (!Number.isFinite(distance)) return;
        try { audio.currentTime = destination; setPosition(audio.currentTime); }
        catch { setPosition(audio.currentTime); }
      }} />
    {trackKey && !seekable && <p className="text-xs text-white/45">{t('settings.musicSeekUnavailable')}</p>}
    <div className="flex justify-between text-xs tabular-nums text-white/55"><span>{clock(position)}</span><span>{duration ? clock(duration) : '—:—'}</span></div>
  </div>;
}
