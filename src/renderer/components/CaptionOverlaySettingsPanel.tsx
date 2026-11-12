import { useId, type ReactNode } from 'react';
import { Captions, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCaptionOverlayStore } from '../state/useCaptionOverlayStore';
import {
  CAPTION_OVERLAY_FONTS,
  type CaptionOverlayBackground,
  type CaptionOverlayPosition,
  type CaptionOverlaySource,
} from '../captionOverlay';
import { CaptionOverlayView } from './CaptionOverlay';
import SettingSwitch from './SettingSwitch';
import { SettingSlider } from './SettingsControls';
import { playSfx } from '../sfx';
import { cn } from '../utils';

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-2">
      <span className="text-xs text-white/65">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map(option => (
          <button key={option.value} type="button" aria-pressed={value === option.value}
            onClick={() => { if (value !== option.value) { onChange(option.value); playSfx('snap'); } }}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
              value === option.value
                ? 'border-blue-500/40 bg-blue-600/20 text-blue-200'
                : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white',
            )}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <span className="text-xs text-white/65">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-[11px] uppercase text-white/55">{value}</span>
        <input id={id} type="color" value={value} onChange={e => onChange(e.target.value)}
          className="h-7 w-9 cursor-pointer rounded border border-white/15 bg-transparent" />
      </span>
    </label>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-white/45">{title}</h4>
      {children}
    </div>
  );
}

export function CaptionOverlaySettingsPanel() {
  const { t } = useTranslation();
  const config = useCaptionOverlayStore(s => s.config);
  const update = useCaptionOverlayStore(s => s.setCaptionOverlayConfig);
  const resetStyle = useCaptionOverlayStore(s => s.resetCaptionOverlayStyle);
  const fontId = useId();
  const sample = config.source === 'both'
    ? [{ text: t('captionOverlay.sampleOriginal'), secondary: true }, { text: t('captionOverlay.sampleText'), secondary: false }]
    : [{ text: t('captionOverlay.sampleText'), secondary: false }];

  return (
    <section id="settings-item-caption-overlay" tabIndex={-1}
      className="rounded-xl border border-white/10 bg-surface-raised p-4 space-y-5" aria-label={t('captionOverlay.title')}>
      <div className="settings-row flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Captions className="h-4 w-4 shrink-0 text-blue-400" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-semibold">{t('captionOverlay.title')}</h3>
            <p className="text-sm leading-relaxed text-white/60">{t('captionOverlay.description')}</p>
          </div>
        </div>
        <SettingSwitch checked={config.enabled} onCheckedChange={enabled => update({ enabled })} label={t('captionOverlay.title')} />
      </div>

      {/* Live style preview over a stand-in slide */}
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-white/10"
        style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #3b2a5a 55%, #5a2a3a 100%)' }}>
        <div className="absolute inset-0 flex items-center justify-center px-[10%] text-center text-[clamp(14px,3.2vw,28px)] font-bold text-white/85">
          {t('captionOverlay.sampleSlide')}
        </div>
        <CaptionOverlayView blocks={sample} config={config} visible />
        {!config.enabled && (
          <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white/70">{t('captionOverlay.previewOff')}</span>
        )}
      </div>

      <div className={cn('grid gap-5 lg:grid-cols-2', !config.enabled && 'opacity-60')}>
        <Group title={t('captionOverlay.contentGroup')}>
          <Segmented<CaptionOverlaySource> label={t('captionOverlay.source')} value={config.source} onChange={source => update({ source })}
            options={[
              { value: 'auto', label: t('captionOverlay.sourceAuto') },
              { value: 'original', label: t('captionOverlay.sourceOriginal') },
              { value: 'translation', label: t('captionOverlay.sourceTranslation') },
              { value: 'both', label: t('captionOverlay.sourceBoth') },
            ]} />
          <p className="text-xs leading-5 text-white/50">{t('captionOverlay.sourceHint')}</p>
          <Segmented<CaptionOverlayPosition> label={t('captionOverlay.position')} value={config.position} onChange={position => update({ position })}
            options={[
              { value: 'bottom', label: t('captionOverlay.positionBottom') },
              { value: 'top', label: t('captionOverlay.positionTop') },
            ]} />
          <SettingSlider label={t('captionOverlay.margin')} value={config.margin} min={0} max={30} suffix="%" onChange={margin => update({ margin })} />
          <SettingSlider label={t('captionOverlay.maxLines')} value={config.maxLines} min={1} max={5} onChange={maxLines => update({ maxLines })} />
          <SettingSlider label={t('captionOverlay.hideAfter')} value={config.hideAfterSeconds} min={0} max={30}
            suffix={config.hideAfterSeconds ? ` ${t('captionOverlay.secondsShort')}` : ''}
            onChange={hideAfterSeconds => update({ hideAfterSeconds })} />
          <p className="text-xs leading-5 text-white/50">{t('captionOverlay.hideAfterHint')}</p>
        </Group>

        <Group title={t('captionOverlay.styleGroup')}>
          <div className="space-y-2">
            <label htmlFor={fontId} className="text-xs text-white/65">{t('captionOverlay.font')}</label>
            <select id={fontId} value={config.fontFamily} onChange={e => update({ fontFamily: e.target.value })}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none">
              {CAPTION_OVERLAY_FONTS.map(font => (
                <option key={font.value} value={font.value} className="bg-surface-overlay" style={{ fontFamily: font.value }}>{font.label}</option>
              ))}
            </select>
          </div>
          <SettingSlider label={t('captionOverlay.fontSize')} value={config.fontSize} min={20} max={120} suffix=" px" onChange={fontSize => update({ fontSize })} />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-white/65">{t('captionOverlay.bold')}</span>
            <SettingSwitch checked={config.bold} onCheckedChange={bold => update({ bold })} label={t('captionOverlay.bold')} />
          </div>
          <ColorField label={t('captionOverlay.textColor')} value={config.textColor} onChange={textColor => update({ textColor })} />
          <Segmented<CaptionOverlayBackground> label={t('captionOverlay.background')} value={config.backgroundStyle}
            onChange={backgroundStyle => update({ backgroundStyle })}
            options={[
              { value: 'box', label: t('captionOverlay.backgroundBox') },
              { value: 'band', label: t('captionOverlay.backgroundBand') },
              { value: 'none', label: t('captionOverlay.backgroundNone') },
            ]} />
          {config.backgroundStyle !== 'none' && <>
            <ColorField label={t('captionOverlay.backgroundColor')} value={config.backgroundColor} onChange={backgroundColor => update({ backgroundColor })} />
            <SettingSlider label={t('captionOverlay.backgroundOpacity')} value={config.backgroundOpacity} min={0} max={100} suffix="%"
              onChange={backgroundOpacity => update({ backgroundOpacity })} />
          </>}
          <button type="button" onClick={() => { resetStyle(); playSfx('delete'); }}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/65 transition-colors hover:bg-white/10 hover:text-white">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />{t('captionOverlay.resetStyle')}
          </button>
        </Group>
      </div>
    </section>
  );
}
