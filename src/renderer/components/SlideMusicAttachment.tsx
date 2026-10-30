import ControlTooltip from './ControlTooltip';
import { Music, Pencil, Play, Trash2, Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Slide } from '../types';
import { canAttachSlideMusic, slideMusicAutoPlay } from '../../shared/youtubeMusic';
import { requestSlideMusic, requestSlideMusicPlay } from '../slideMusicEvents';
import { activeMusicSlide } from '../musicSlides';
import { useStore } from '../state/useStore';
import { musicGain } from '../musicCustomization';
import MusicOfflineDownload from './MusicOfflineDownload';

export default function SlideMusicAttachment({ slide, onPatch, volume = true, inline = false, compact = false }: {
  slide: Slide; onPatch: (id: string, patch: Record<string, unknown>) => void; volume?: boolean; inline?: boolean; compact?: boolean;
}) {
  const { t } = useTranslation();
  const isLive = useStore(state => activeMusicSlide(state)?.id === slide.id);
  if (!canAttachSlideMusic(slide)) return null;
  const source = slide.youtubeMusic;
  const control = 'inline-flex min-h-8 min-w-8 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
  return <section data-testid="slide-music-attachment" tabIndex={-1} aria-label={t('settings.backgroundMusic')} className={inline ? 'inline-flex text-xs outline-none' : 'space-y-2 border-b border-white/10 pb-3 text-xs outline-none'}>
    {!source ? <ControlTooltip><button type="button" data-testid="slide-music-add" title={t('slideAudio.add')} className={control + ' gap-1.5 px-2'} onClick={e => requestSlideMusic(slide.id, e.currentTarget)}><Music className="h-3.5 w-3.5" aria-hidden="true" /><span className={compact ? 'sr-only' : undefined}>{t('slideAudio.add')}</span></button></ControlTooltip> : <>
      <div className="flex min-w-0 items-center gap-1.5">
        <Music className="h-3.5 w-3.5 shrink-0 text-sky-300" /><span className="min-w-0 flex-1 truncate text-white/85" title={source.title}>{source.title}</span>
        <ControlTooltip><button type="button" data-testid="slide-music-play" className={control + ' disabled:opacity-30'} disabled={!isLive} title={t(isLive ? 'slideAudio.play' : 'slideAudio.liveFirst')} aria-label={t('slideAudio.play')} onClick={() => requestSlideMusicPlay(slide.id)}><Play className="h-3.5 w-3.5" /></button></ControlTooltip>
        <ControlTooltip><button type="button" data-testid="slide-music-change" className={control} title={t('slideAudio.change')} aria-label={t('slideAudio.change')} onClick={e => requestSlideMusic(slide.id, e.currentTarget)}><Pencil className="h-3.5 w-3.5" /></button></ControlTooltip>
        <ControlTooltip><button type="button" data-testid="slide-music-remove" className={control} title={t('slideAudio.remove')} aria-label={t('slideAudio.remove')} onClick={() => onPatch(slide.id, { youtubeMusic: undefined, musicSettings: undefined })}><Trash2 className="h-3.5 w-3.5" /></button></ControlTooltip>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-white/70" title={t('slideAudio.autoHint')}>
          <input type="checkbox" data-testid="slide-music-autoplay" checked={slideMusicAutoPlay(slide)} className="accent-blue-500" onChange={e => onPatch(slide.id, { musicSettings: { ...slide.musicSettings, autoPlay: e.target.checked } })} />{t('slideAudio.autoPlay')}
        </label>
        <MusicOfflineDownload key={source.id} videoId={source.id} />
      </div>
      {volume && <label className="flex items-center gap-2 text-white/50"><Volume2 className="h-3.5 w-3.5 shrink-0" /><span className="sr-only">{t('musicSlide.volume')}</span><input aria-label={t('musicSlide.volume')} type="range" min={0} max={100} value={Math.round(musicGain(slide.musicSettings?.volume) * 100)} className="min-w-0 flex-1 accent-blue-400" onChange={e => onPatch(slide.id, { musicSettings: { ...slide.musicSettings, volume: Number(e.target.value) / 100 } })} /><span className="w-8 text-right tabular-nums">{Math.round(musicGain(slide.musicSettings?.volume) * 100)}%</span></label>}
    </>}
  </section>;
}
