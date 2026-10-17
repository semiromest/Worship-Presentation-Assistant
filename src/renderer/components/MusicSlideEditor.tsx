import { SettingSlider } from './SettingsControls';
import { useState } from 'react';
import { Image, Music, Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Slide } from '../types';
import { useStore } from '../state/useStore';
import { backgroundDim, musicGain, musicPresetStyles } from '../musicCustomization';
import { applyGeneratedBackground } from '../gradientBackground';
import { toFileUrl } from '../utils';
import { GradientButton } from './GradientGenerator';
import { useMusicPreparationState } from '../hooks/useMusicPreparation';
import { activeMusicSlide } from '../musicSlides';

export default function MusicSlideEditor({ slide, onPatch }: {
  slide: Slide;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const slides = useStore(state => state.presentation.slides);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState(false);
  const source = slide.youtubeMusic!;
  const preparation = useMusicPreparationState(state => state.tracks[source.id]);
  const isLive = useStore(state => activeMusicSlide(state)?.id === slide.id);
  const latest = () => useStore.getState().presentation.slides.find(item => item.id === slide.id);
  const chooseImage = async () => {
    setChoosing(true); setError(false);
    try {
      const file = await window.electronAPI?.selectMediaFile?.('image');
      const current = latest();
      if (current && typeof file === 'string' && file) onPatch(slide.id, { styles: musicPresetStyles(current.styles, toFileUrl(file)) });
    } catch { setError(true); }
    finally { setChoosing(false); }
  };
  const duration = source.duration > 0 ? `${Math.floor(source.duration / 60)}:${String(Math.floor(source.duration % 60)).padStart(2, '0')}` : t('musicSlide.unknownDuration');
  const button = 'flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/85 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-40';
  return <section data-testid="music-slide-editor" aria-label={t('musicSlide.heading')} className="space-y-4 rounded-xl border border-sky-400/25 bg-sky-400/5 p-3">
    <div className="flex items-center gap-2 text-sm font-semibold text-sky-200"><Music className="h-4 w-4" />{t('musicSlide.heading')}</div>
    <div className="space-y-1 text-xs">
      <p className="text-white/50">{t('musicSlide.source')}</p>
      <p className="break-words font-medium text-white/90">{source.title}</p>
      <p className="tabular-nums text-white/50">YouTube · {duration}</p>
      {preparation && !isLive && <p role="status" className={preparation === 'ready' ? 'text-emerald-300' : 'text-white/50'}>
        {t(`musicSlide.connection${preparation === 'ready' ? 'Ready' : preparation === 'preparing' ? 'Preparing' : 'Unavailable'}`)}
      </p>}
      <p className="leading-relaxed text-white/45">{t('musicSlide.independentTitle')}</p>
    </div>
    <div className="space-y-2">
      <p className="text-xs font-semibold text-white/70">{t('musicSlide.appearance')}</p>
      <button type="button" className={button} data-testid="music-preset-simple" onClick={() => { const current = latest(); if (current) onPatch(slide.id, { styles: musicPresetStyles(current.styles) }); }}><Palette className="h-4 w-4" />{t('musicSlide.simple')}</button>
      <GradientButton label={t('musicSlide.gradient')} slides={slides} activeId={slide.id} selectedIds={[slide.id]}
        onApply={(ids, image, recipe, groupDefault) => {
          const state = useStore.getState();
          const next = applyGeneratedBackground(state.presentation, ids, image, recipe, groupDefault);
          const targets = new Set(ids);
          state.dispatchUndo({ type: 'SET', payload: { ...next, slides: next.slides.map(item => targets.has(item.id) && item.youtubeMusic ? { ...item, styles: { ...item.styles!, backgroundDim: 0 } } : item) } });
        }} />
      <button type="button" disabled={choosing} className={button} data-testid="music-preset-photo" onClick={() => void chooseImage()}><Image className="h-4 w-4" />{t('musicSlide.photo')}</button>
      {error && <p role="alert" className="text-xs text-red-300">{t('musicSlide.imageError')}</p>}
    </div>
    {slide.styles?.backgroundImage && <SettingSlider testId="music-background-dim" label={t('musicSlide.dim')}
      value={Math.round(backgroundDim(slide.styles.backgroundDim) * 100)} min={0} max={80} suffix="%"
      onChange={value => { const current = latest(); if (current) onPatch(slide.id, { styles: { ...current.styles, backgroundDim: value / 100 } }); }} />}
    <div className="space-y-2">
      <SettingSlider id="music-slide-volume" testId="music-slide-volume" label={t('musicSlide.volume')}
        value={Math.round(musicGain(slide.musicSettings?.volume) * 100)} min={0} max={100} suffix="%"
        onChange={value => onPatch(slide.id, { musicSettings: { ...slide.musicSettings, volume: value / 100 } })} />
      <p className="text-xs leading-relaxed text-white/45">{t('musicSlide.volumeHint')}</p>
    </div>
    <p className="text-xs leading-relaxed text-white/45">{t('musicSlide.fadeHint')}</p>
  </section>;
}
