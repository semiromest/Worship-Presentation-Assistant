import { useRef, useState } from 'react';
import {
  Upload,
  Trash2,
  CircleDot,
  CircleOff,
  ChevronDown,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Position } from '../types';
import { useWatermarkStore } from '../state/useWatermarkStore';
import { cn } from '../utils';

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
const ACCEPTED_MIME = ['image/png', 'image/jpeg', 'image/svg+xml'];

const POSITION_OPTIONS: { value: Position; label: string }[] = [
  { value: 'top-left', label: '↖' },
  { value: 'top-center', label: '↑' },
  { value: 'top-right', label: '↗' },
  { value: 'bottom-left', label: '↙' },
  { value: 'bottom-center', label: '↓' },
  { value: 'bottom-right', label: '↘' },
];

export function WatermarkSettingsPanel() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inlineMsg, setInlineMsg] = useState<{ text: string; kind: 'error' | 'warn' } | null>(null);
  const [expanded, setExpanded] = useState(true);

  const { config, setWatermarkConfig } = useWatermarkStore();

  const hasLogo = config.logoDataUrl !== null;

  const showMsg = (text: string, kind: 'error' | 'warn' = 'error', ms = 3000) => {
    setInlineMsg({ text, kind });
    window.setTimeout(() => {
      setInlineMsg((current) => (current?.text === text ? null : current));
    }, ms);
  };

  const handleSelectLogoClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemoveLogo = () => {
    setWatermarkConfig({ logoDataUrl: null, enabled: false });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!ACCEPTED_MIME.includes(file.type)) {
      showMsg('Desteklenmeyen dosya formatı. Lütfen PNG, JPG veya SVG seçin.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      showMsg('Dosya boyutu çok büyük. Maksimum 2 MB desteklenmektedir.');
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
      showMsg('Logo başarıyla yüklendi.', 'warn', 2000);
    } catch {
      showMsg('Logo yüklenirken hata oluştu.');
    }
  };

  const requireLogo = (msg = 'Önce bir logo yükleyin.') => {
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
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      {/* Collapsible Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 transition-colors hover:bg-white/5"
        aria-expanded={expanded}
        aria-label={expanded ? 'Logo ayarlarını daralt' : 'Logo ayarlarını genişlet'}
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-blue-600/20 text-blue-400 text-xs shrink-0">
            ◈
          </span>
          <div className="flex flex-col items-start gap-0.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/60 leading-tight">
              {t('watermark.title')}
            </span>
            <span className="text-[10px] text-white/30 leading-tight">
              {hasLogo
                ? (config.enabled ? t('watermark.statusActive') : t('watermark.statusInactive'))
                : t('watermark.statusNoLogo')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setWatermarkConfig({ enabled: !config.enabled });
            }}
            aria-pressed={config.enabled}
            aria-label={config.enabled ? 'Watermark kapat' : 'Watermark aç'}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-colors shrink-0',
              config.enabled
                ? 'bg-emerald-600/15 border-emerald-500/30 text-emerald-300'
                : 'bg-white/5 border-white/10 text-white/40',
            )}
          >
            {config.enabled ? <CircleDot className="w-3 h-3" /> : <CircleOff className="w-3 h-3" />}
            {config.enabled ? t('common.on') : t('common.off')}
          </button>
          <ChevronDown
            className={cn(
              'w-4 h-4 text-white/40 shrink-0 transition-transform duration-200',
              expanded && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </div>
      </button>

      {/* Collapsible Body */}
      <div
        className={cn(
          'grid transition-all duration-200 ease-out',
          expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden">
          <div className="p-4 pt-0 space-y-4">
            {/* Logo upload + preview */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectLogoClick}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border transition-colors',
                    'bg-white/5 hover:bg-white/10 border-white/10 text-white/70 hover:text-white',
                    'text-xs font-medium',
                  )}
                >
                  <Upload className="w-3.5 h-3.5" />
                  {hasLogo ? t('watermark.replaceLogo') : t('watermark.uploadLogo')}
                </button>
                {hasLogo && (
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    className="inline-flex items-center justify-center p-2 rounded-lg bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 text-white/40 hover:text-red-400 transition-colors shrink-0"
                    title={t('watermark.removeLogo')}
                    aria-label={t('watermark.removeLogo')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
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

              {hasLogo && (() => {
                const logoUrl = config.logoDataUrl as string;
                return (
                  <div className="flex items-center gap-3 p-2 rounded-lg bg-black/30 border border-white/5">
                    <div className="w-10 h-10 rounded bg-black/50 border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                      <img
                        src={logoUrl}
                        alt=""
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[10px] text-white/60 truncate">
                        {t('watermark.logoLoaded')}
                      </span>
                      <span className="text-[10px] text-white/30 font-mono truncate">
                        {logoUrl.length > 40
                          ? logoUrl.slice(0, 30) + '…' + logoUrl.slice(-10)
                          : logoUrl}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Inline message */}
            {inlineMsg && (
              <div
                className={cn(
                  'text-[11px] px-3 py-2 rounded-lg border',
                  inlineMsg.kind === 'error'
                    ? 'bg-red-500/10 border-red-500/20 text-red-300'
                    : 'bg-amber-500/10 border-amber-500/20 text-amber-300',
                )}
              >
                {inlineMsg.text}
              </div>
            )}

            {/* Position selector */}
            <div className="space-y-2" onClick={wrapperClick}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/45">
                  {t('watermark.position')}
                </span>
              </div>
              <div
                className={cn(
                  'grid grid-cols-3 gap-1.5',
                  disabledControls && 'opacity-40',
                )}
              >
                {POSITION_OPTIONS.map((opt) => {
                  const active = config.position === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={disabledControls}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (requireLogo()) return;
                        setWatermarkConfig({ position: opt.value });
                      }}
                      className={cn(
                        'h-9 rounded-lg flex items-center justify-center text-sm font-bold border transition-colors',
                        active
                          ? 'bg-blue-600/20 border-blue-500/40 text-blue-300 shadow-inner'
                          : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white',
                        disabledControls && 'pointer-events-none',
                      )}
                      title={opt.value}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Size slider */}
            <div className="space-y-2" onClick={wrapperClick}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/45">
                  {t('watermark.size')}
                </span>
                <span className="text-[10px] font-mono text-white/60 tabular-nums">
                  %{config.size}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={50}
                step={1}
                value={config.size}
                disabled={disabledControls}
                onChange={(e) => {
                  if (requireLogo()) return;
                  setWatermarkConfig({ size: parseInt(e.target.value, 10) });
                }}
                className={cn(
                  'w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500',
                  disabledControls && 'opacity-40 cursor-not-allowed',
                )}
              />
            </div>

            {/* Opacity slider */}
            <div className="space-y-2" onClick={wrapperClick}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/45">
                  {t('watermark.opacity')}
                </span>
                <span className="text-[10px] font-mono text-white/60 tabular-nums">
                  %{config.opacity}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={config.opacity}
                disabled={disabledControls}
                onChange={(e) => {
                  if (requireLogo()) return;
                  setWatermarkConfig({ opacity: parseInt(e.target.value, 10) });
                }}
                className={cn(
                  'w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500',
                  disabledControls && 'opacity-40 cursor-not-allowed',
                )}
              />
            </div>

            {/* Apply checkboxes */}
            <div className="space-y-2 pt-1">
              <label
                className="flex items-center gap-2 cursor-pointer select-none group"
              >
                <input
                  type="checkbox"
                  checked={config.applyToHymns}
                  onChange={(e) =>
                    setWatermarkConfig({ applyToHymns: e.target.checked })
                  }
                  className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-blue-500 accent-blue-500 cursor-pointer"
                />
                <span className="text-xs text-white/70 group-hover:text-white transition-colors">
                  {t('watermark.applyToHymns')}
                </span>
              </label>

              <label
                className="flex items-center gap-2 cursor-pointer select-none group"
              >
                <input
                  type="checkbox"
                  checked={config.applyToScriptures}
                  onChange={(e) =>
                    setWatermarkConfig({ applyToScriptures: e.target.checked })
                  }
                  className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 text-blue-500 accent-blue-500 cursor-pointer"
                />
                <span className="text-xs text-white/70 group-hover:text-white transition-colors">
                  {t('watermark.applyToScriptures')}
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
