import { playSfx } from '../sfx';
import { useEffect, useRef, useState } from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { Upload, Trash2, Image, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWatermarkStore } from '../state/useWatermarkStore';
import SettingSwitch from './SettingSwitch';
import { PositionPicker, SettingSlider } from './SettingsControls';
import { cn } from '../utils';

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
const ACCEPTED_MIME = ['image/png', 'image/jpeg', 'image/svg+xml'];

export function WatermarkSettingsPanel() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inlineMsg, setInlineMsg] = useState<{ key: string; kind: 'error' | 'warn' | 'success' } | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(messageTimer.current), []);
  const [expanded, setExpanded] = useState(true);

  const { config, setWatermarkConfig } = useWatermarkStore();

  const hasLogo = config.logoDataUrl !== null;

  const showMsg = (key: string, kind: 'error' | 'warn' | 'success' = 'error', ms = 3000) => {
    clearTimeout(messageTimer.current);
    setInlineMsg({ key, kind });
    if (kind !== 'warn') playSfx(kind === 'success' ? 'success' : 'error');
    messageTimer.current = setTimeout(() => {
      setInlineMsg(null);
    }, ms);
  };

  const handleSelectLogoClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemoveLogo = () => {
    setWatermarkConfig({ logoDataUrl: null, enabled: false });
    playSfx('delete');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!ACCEPTED_MIME.includes(file.type)) {
      showMsg('watermark.unsupportedFormat');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      showMsg('watermark.fileTooLarge');
      return;
    }

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') resolve(reader.result);
          else reject(new Error('invalid result'));
        };
        reader.onerror = () => reject(reader.error ?? new Error('reader error'));
        reader.readAsDataURL(file);
      });

      setWatermarkConfig({ logoDataUrl: dataUrl });
      showMsg('watermark.uploadSuccess', 'success', 2000);
    } catch {
      showMsg('watermark.uploadError');
    }
  };

  const requireLogo = (msg = 'watermark.requireLogo') => {
    if (!hasLogo) {
      showMsg(msg, 'warn');
      return true;
    }
    return false;
  };

  const disabledControls = !hasLogo;

  const wrapperClick = (e: React.MouseEvent) => {
    if (disabledControls) {
      e.stopPropagation();
      requireLogo();
    }
  };

  return (
    <Collapsible.Root
      open={expanded}
      onOpenChange={(next) => { if (next !== expanded) playSfx(next ? 'expand' : 'collapse'); setExpanded(next); }}
      className="overflow-hidden rounded-xl border border-white/10 bg-surface-raised"
    >
      {/* Collapsible Header */}
      <div className="flex items-center gap-2 p-4">
        <Collapsible.Trigger
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-label={t(expanded ? 'watermark.collapse' : 'watermark.expand')}
        >
          <Image className="h-4 w-4 shrink-0 text-blue-400" aria-hidden="true" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-semibold">{t('watermark.title')}</span>
            <span className="text-sm leading-relaxed text-white/60">
              {hasLogo
                ? (config.enabled ? t('watermark.statusActive') : t('watermark.statusInactive'))
                : t('watermark.statusNoLogo')}
            </span>
          </span>
          <ChevronDown
            className={cn(
              'ml-auto h-4 w-4 shrink-0 text-white/40 transition-transform duration-200',
              expanded && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </Collapsible.Trigger>
        <SettingSwitch
          checked={config.enabled}
          onCheckedChange={(checked) => setWatermarkConfig({ enabled: checked })}
          label={t('watermark.title')}
        />
      </div>

      {/* Collapsible Body */}
      <Collapsible.Panel className="base-collapsible-panel">
        <div className="space-y-4 px-4 pb-4">
          {/* Logo upload + preview */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectLogoClick}
                className={cn(
                  'flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                  'border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white',
                )}
              >
                <Upload className="h-3.5 w-3.5" />
                {hasLogo ? t('watermark.replaceLogo') : t('watermark.uploadLogo')}
              </button>
              {hasLogo && (
                <button
                  type="button"
                  onClick={handleRemoveLogo}
                  className="inline-flex shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 p-2 text-white/40 transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400"
                  title={t('watermark.removeLogo')}
                  aria-label={t('watermark.removeLogo')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            {hasLogo && (
              <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-black/30 p-2">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border border-white/10 bg-black/50">
                  <img src={config.logoDataUrl as string} alt="" className="max-h-full max-w-full object-contain" />
                </div>
                <span className="min-w-0 flex-1 truncate text-xs text-white/60">
                  {t('watermark.logoLoaded')}
                </span>
              </div>
            )}
          </div>

          {/* Inline message */}
          {inlineMsg && (
            <div
              role={inlineMsg.kind === 'error' ? 'alert' : 'status'}
              className={cn(
                'rounded-lg border px-3 py-2 text-[11px]',
                inlineMsg.kind === 'error'
                  ? 'border-red-500/20 bg-red-500/10 text-red-300'
                  : inlineMsg.kind === 'success'
                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                    : 'border-amber-500/20 bg-amber-500/10 text-amber-300',
              )}
            >
              {t(inlineMsg.key)}
            </div>
          )}

          {/* Position selector */}
          <div className="space-y-2" onClick={wrapperClick}>
            <span className="text-xs text-white/65">{t('watermark.position')}</span>
            <PositionPicker
              value={config.position}
              disabled={disabledControls}
              ariaLabel={t('watermark.position')}
              onChange={(position) => {
                if (requireLogo()) return;
                setWatermarkConfig({ position });
              }}
            />
          </div>

          {/* Size + opacity sliders */}
          <div className="grid grid-cols-2 gap-4" onClick={wrapperClick}>
            <SettingSlider
              label={t('watermark.size')}
              value={config.size}
              min={1}
              max={50}
              suffix="%"
              disabled={disabledControls}
              onChange={(size) => {
                if (requireLogo()) return;
                setWatermarkConfig({ size });
              }}
            />
            <SettingSlider
              label={t('watermark.opacity')}
              value={config.opacity}
              min={0}
              max={100}
              suffix="%"
              disabled={disabledControls}
              onChange={(opacity) => {
                if (requireLogo()) return;
                setWatermarkConfig({ opacity });
              }}
            />
          </div>

          {/* Apply checkboxes */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
            <label className="group flex cursor-pointer select-none items-center gap-2">
              <input
                type="checkbox"
                checked={config.applyToHymns}
                onChange={(e) => setWatermarkConfig({ applyToHymns: e.target.checked })}
                className="h-3.5 w-3.5 cursor-pointer rounded border-white/20 bg-white/5 text-blue-500 accent-blue-500"
              />
              <span className="text-xs text-white/70 transition-colors group-hover:text-white">
                {t('watermark.applyToHymns')}
              </span>
            </label>

            <label className="group flex cursor-pointer select-none items-center gap-2">
              <input
                type="checkbox"
                checked={config.applyToScriptures}
                onChange={(e) => setWatermarkConfig({ applyToScriptures: e.target.checked })}
                className="h-3.5 w-3.5 cursor-pointer rounded border-white/20 bg-white/5 text-blue-500 accent-blue-500"
              />
              <span className="text-xs text-white/70 transition-colors group-hover:text-white">
                {t('watermark.applyToScriptures')}
              </span>
            </label>
          </div>
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
