import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Palette } from 'lucide-react';
import { cn } from '../../utils';
import { clamp } from '../editorUtils';
import { ColorPalette } from '../ColorPalette';

interface SlideSettingsPanelProps {
  styles: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  gridEnabled?: boolean;
  gridSize?: number;
  gridColor?: string;
  snapEnabled?: boolean;
  onGridToggle?: (enabled: boolean) => void;
  onGridSizeChange?: (size: number) => void;
  onGridColorChange?: (color: string) => void;
  onSnapToggle?: (enabled: boolean) => void;
}

export const SlideSettingsPanel = memo(function SlideSettingsPanel({
  styles,
  onChange,
  gridEnabled,
  gridSize,
  gridColor,
  snapEnabled,
  onGridToggle,
  onGridSizeChange,
  onGridColorChange,
  onSnapToggle,
}: SlideSettingsPanelProps) {
  const { t } = useTranslation();
  const [showBgPalette, setShowBgPalette] = useState(false);
  const [showTextPalette, setShowTextPalette] = useState(false);

  const getStr = (key: string, fallback = '') =>
    (styles[key] as string) || fallback;
  const getNum = (key: string, fallback = 0) =>
    (styles[key] as number) ?? fallback;

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-[#1a1a1a] p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
        <Palette className="h-4 w-4" />
        <span>{t('common.editorSlideSettings')}</span>
      </div>

      {/* Background color */}
      <label className="block space-y-1">
        <span className="block text-[10px] uppercase tracking-wide text-white/40">
          {t('common.editorBgColor')}
        </span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={getStr('backgroundColor', '#000000')}
            onChange={e => onChange({ backgroundColor: e.target.value })}
            className="h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent"
          />
          <input
            type="text"
            value={getStr('backgroundColor')}
            onChange={e => onChange({ backgroundColor: e.target.value })}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
          />
          <button
            type="button"
            onClick={() => setShowBgPalette(!showBgPalette)}
            className="h-8 w-8 shrink-0 rounded-lg border border-white/10 bg-black/20 flex items-center justify-center text-white/60 hover:bg-black/35"
            title={t('common.editorColorPalette')}
            aria-label={t('common.editorColorPalette')}
          >
            <span className="text-xs">🎨</span>
          </button>
        </div>
        {showBgPalette && (
          <div className="mt-1 p-2 rounded-lg border border-white/10 bg-[#1e1e1e]">
            <ColorPalette
              onSelect={color => { onChange({ backgroundColor: color }); setShowBgPalette(false); }}
              currentColor={getStr('backgroundColor', '#000000')}
            />
          </div>
        )}
      </label>

      {/* Text color */}
      <label className="block space-y-1">
        <span className="block text-[10px] uppercase tracking-wide text-white/40">
          {t('common.editorTextColor')}
        </span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={getStr('textColor', '#ffffff')}
            onChange={e => onChange({ textColor: e.target.value })}
            className="h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent"
          />
          <input
            type="text"
            value={getStr('textColor')}
            onChange={e => onChange({ textColor: e.target.value })}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
          />
          <button
            type="button"
            onClick={() => setShowTextPalette(!showTextPalette)}
            className="h-8 w-8 shrink-0 rounded-lg border border-white/10 bg-black/20 flex items-center justify-center text-white/60 hover:bg-black/35"
            title={t('common.editorColorPalette')}
            aria-label={t('common.editorColorPalette')}
          >
            <span className="text-xs">🎨</span>
          </button>
        </div>
        {showTextPalette && (
          <div className="mt-1 p-2 rounded-lg border border-white/10 bg-[#1e1e1e]">
            <ColorPalette
              onSelect={color => { onChange({ textColor: color }); setShowTextPalette(false); }}
              currentColor={getStr('textColor', '#ffffff')}
            />
          </div>
        )}
      </label>

      {/* Default font size */}
      <label className="block space-y-1">
        <span className="block text-[10px] uppercase tracking-wide text-white/40">
          {t('common.editorDefaultFontSize')}
        </span>
        <input
          type="number"
          min={8}
          max={240}
          value={getNum('fontSize', 48)}
          onChange={e => {
            const v = parseInt(e.target.value);
            if (!Number.isNaN(v)) onChange({ fontSize: clamp(v, 8, 240) });
          }}
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
        />
      </label>

      {/* Object fit */}
      <label className="block space-y-1">
        <span className="block text-[10px] uppercase tracking-wide text-white/40">
          {t('common.editorSlideFit')}
        </span>
        <select
          value={getStr('objectFit', 'contain')}
          onChange={e => onChange({ objectFit: e.target.value })}
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
        >
          <option value="contain">{t('common.editorFitContain')}</option>
          <option value="cover">{t('common.editorFitCover')}</option>
          <option value="fill">{t('common.editorFitFill')}</option>
        </select>
      </label>

      {/* Background image */}
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-white/40">
          {t('common.editorBgImage')}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={async () => {
              const file = await (window as unknown as {
                electronAPI?: {
                  selectMediaFile?: (type: string) => Promise<string | null>;
                };
              }).electronAPI?.selectMediaFile?.('image');
              if (!file) return;
              onChange({ backgroundImage: `file://${file.replace(/\\/g, '/')}` });
            }}
            className="flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/80 transition hover:bg-black/30"
          >
            {t('common.editorSelectImage')}
          </button>
          <button
            type="button"
            onClick={() => onChange({ backgroundImage: undefined })}
            className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/60 transition hover:bg-black/30"
          >
            {t('common.editorClear')}
          </button>
        </div>
      </div>

      {/* Background blur */}
      <label className="block space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-white/40">
            {t('common.editorBgBlur')}
          </span>
          <span className="text-[10px] text-white/50">
            {getNum('backgroundBlur', 0).toFixed(1)}px
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={20}
          step={0.5}
          value={getNum('backgroundBlur', 0)}
          onChange={e => onChange({ backgroundBlur: parseFloat(e.target.value) })}
          className="w-full accent-blue-500"
        />
      </label>

      {/* Gradient */}
      <div className="space-y-1">
        <span className="block text-[10px] uppercase tracking-wide text-white/40">
          {t('common.editorBgGradient')}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              onChange({
                backgroundGradient: {
                  type: 'linear',
                  angle: 90,
                  stops: [
                    { color: '#000000', position: 0 },
                    { color: '#1f2937', position: 100 },
                  ],
                },
              })
            }
            className="flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70 transition hover:bg-black/30"
          >
            {t('common.editorAddGradient')}
          </button>
          {!!styles.backgroundGradient && (
            <button
              type="button"
              onClick={() => onChange({ backgroundGradient: undefined })}
              className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/60 transition hover:bg-black/30"
            >
              {t('common.editorRemove')}
            </button>
          )}
        </div>
      </div>

      {/* Grid & Snap settings */}
      {onGridToggle && (
        <div className="space-y-2 pt-1">
          <div className="text-[10px] uppercase tracking-wide text-white/40">
            {t('common.editorGridAndSnap')}
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!gridEnabled}
              onChange={e => onGridToggle(e.target.checked)}
              className="rounded border-white/20 accent-blue-500"
            />
            <span className="text-xs text-white/70">{t('common.editorGridShow')}</span>
          </label>

          {gridEnabled && (
            <>
              <label className="block space-y-1">
                <span className="text-[10px] text-white/40">{t('common.editorGridSize')}</span>
                <input
                  type="number"
                  min={2}
                  max={25}
                  value={gridSize ?? 10}
                  onChange={e => {
                    const v = parseInt(e.target.value);
                    if (!Number.isNaN(v)) onGridSizeChange?.(clamp(v, 2, 25));
                  }}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
                />
              </label>
              {onGridColorChange && (
                <label className="block space-y-1">
                  <span className="text-[10px] text-white/40">{t('common.editorGridColor')}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={gridColor || 'rgba(255,255,255,0.06)'}
                      onChange={e => onGridColorChange(e.target.value)}
                      className="h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent"
                    />
                    <input
                      type="text"
                      value={gridColor || ''}
                      onChange={e => onGridColorChange(e.target.value)}
                      placeholder="rgba(255,255,255,0.06)"
                      className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
                    />
                  </div>
                </label>
              )}
            </>
          )}

          {onSnapToggle && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!snapEnabled}
                onChange={e => onSnapToggle(e.target.checked)}
                className="rounded border-white/20 accent-blue-500"
              />
              <span className="text-xs text-white/70">{t('common.editorSnapEnable')}</span>
            </label>
          )}
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/45">
        {t('common.editorSettingsHint')}
      </div>
    </div>
  );
});
