import { memo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { SlideItem, TextStyle } from '../../types';
import { cn } from '../../utils';
import {
  DEFAULT_TEXT_STYLE,
  FONT_PRESETS,
  clamp,
} from '../editorUtils';
import { ColorPalette } from '../ColorPalette';
import { loadGoogleFont } from '../../fontLoader';
import {
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  Bold,
  Italic,
  Underline,
} from 'lucide-react';

interface TextStyleEditorProps {
  item: SlideItem;
  onChange: (styles: TextStyle) => void;
}

export const TextStyleEditor = memo(function TextStyleEditor({
  item,
  onChange,
}: TextStyleEditorProps) {
  const { t } = useTranslation();
  const styles = item.textStyles ?? DEFAULT_TEXT_STYLE;
  const shadow = styles.textShadow ?? {};
  const [showColorPalette, setShowColorPalette] = useState(false);
  const [showBgPalette, setShowBgPalette] = useState(false);

  const update = useCallback((patch: Partial<TextStyle>) => {
    if (patch.fontFamily) loadGoogleFont(patch.fontFamily);
    onChange({ ...styles, ...patch });
  }, [styles, onChange]);

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-[#1a1a1a] p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
        <Type className="h-4 w-4" />
        <span>{t('common.editorTextStyles')}</span>
      </div>

      {/* Font family & size */}
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="block text-[10px] uppercase tracking-wide text-white/40">
            {t('common.editorFontFamily')}
          </span>
          <select
            value={styles.fontFamily || 'inherit'}
            onChange={e => update({ fontFamily: e.target.value })}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
          >
            {FONT_PRESETS.map((font, i) => (
              <option key={font.value} value={font.value}>
                {i === 0 ? t('common.editorFontDefault') : font.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="block text-[10px] uppercase tracking-wide text-white/40">
            {t('common.editorFontSize')}
          </span>
          <input
            type="number"
            min={8}
            max={240}
            value={styles.fontSize ?? 32}
            onChange={e => {
              const v = parseInt(e.target.value);
              if (!Number.isNaN(v))
                update({ fontSize: clamp(Math.round(v), 8, 240) });
            }}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
          />
        </label>
      </div>

      {/* Colors */}
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="block text-[10px] uppercase tracking-wide text-white/40">
            {t('common.editorColor')}
           
          </span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={styles.textColor || '#ffffff'}
              onChange={e => update({ textColor: e.target.value })}
              className="h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent"
            />
            <input
              type="text"
              value={styles.textColor ?? '#ffffff'}
              onChange={e => update({ textColor: e.target.value })}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs outline-none transition focus:border-blue-500"
            />
            <button
              type="button"
              onClick={() => setShowColorPalette(!showColorPalette)}
              className="h-8 w-8 shrink-0 rounded-lg border border-white/10 bg-black/20 flex items-center justify-center text-white/60 hover:bg-black/35"
              title={t('common.editorColorPalette')}
              aria-label={t('common.editorColorPalette')}
            >
              <span className="text-xs">🎨</span>
            </button>
          </div>
          {showColorPalette && (
            <div className="mt-1 p-2 rounded-lg border border-white/10 bg-[#1e1e1e]">
              <ColorPalette
                onSelect={color => { update({ textColor: color }); setShowColorPalette(false); }}
                currentColor={styles.textColor}
              />
            </div>
          )}
        </label>

        <label className="space-y-1">
          <span className="block text-[10px] uppercase tracking-wide text-white/40">
            {t('common.editorBackground')}
          </span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={styles.backgroundColor || '#000000'}
              onChange={e => update({ backgroundColor: e.target.value })}
              className="h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent"
            />
            <button
              type="button"
              onClick={() => {
                const next = { ...styles };
                delete next.backgroundColor;
                onChange(next);
              }}
              className="flex-1 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-white/70 transition hover:bg-black/35"
            >
              {t('common.editorClear')}
            </button>
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
                onSelect={color => { update({ backgroundColor: color }); setShowBgPalette(false); }}
                currentColor={styles.backgroundColor}
              />
            </div>
          )}
        </label>
      </div>

      {/* Alignment */}
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            { icon: AlignLeft, value: 'left' },
            { icon: AlignCenter, value: 'center' },
            { icon: AlignRight, value: 'right' },
          ] as const
        ).map(({ icon: Icon, value }) => (
          <button
            key={value}
            type="button"
            onClick={() => update({ textAlign: value })}
            className={cn(
              'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs transition',
              styles.textAlign === value
                ? 'border-blue-500/50 bg-blue-600/25 text-blue-200'
                : 'border-white/10 bg-black/20 text-white/60 hover:bg-black/35',
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>

      {/* Vertical Alignment */}
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            { icon: AlignVerticalJustifyStart, value: 'top' },
            { icon: AlignVerticalJustifyCenter, value: 'center' },
            { icon: AlignVerticalJustifyEnd, value: 'bottom' },
          ] as const
        ).map(({ icon: Icon, value }) => (
          <button
            key={value}
            type="button"
            onClick={() => update({ verticalAlign: value })}
            className={cn(
              'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs transition',
              styles.verticalAlign === value
                ? 'border-blue-500/50 bg-blue-600/25 text-blue-200'
                : 'border-white/10 bg-black/20 text-white/60 hover:bg-black/35',
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>

      {/* Bold / Italic / Underline */}
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            {
              Icon: Bold,
              labelKey: 'common.editorBold',
              active: styles.fontWeight === 'bold',
              onClick: () =>
                update({
                  fontWeight: styles.fontWeight === 'bold' ? 'normal' : 'bold',
                }),
            },
            {
              Icon: Italic,
              labelKey: 'common.editorItalic',
              active: styles.fontStyle === 'italic',
              onClick: () =>
                update({
                  fontStyle: styles.fontStyle === 'italic' ? 'normal' : 'italic',
                }),
            },
            {
              Icon: Underline,
              labelKey: 'common.editorUnderline',
              active: styles.textDecoration === 'underline',
              onClick: () =>
                update({
                  textDecoration:
                    styles.textDecoration === 'underline' ? '' : 'underline',
                }),
            },
          ] as const
        ).map(({ Icon, labelKey, active, onClick }) => (
          <button
            key={labelKey}
            type="button"
            onClick={onClick}
            className={cn(
              'rounded-lg border px-3 py-2 text-xs transition',
              active
                ? 'border-blue-500/50 bg-blue-600/25 text-blue-200'
                : 'border-white/10 bg-black/20 text-white/60 hover:bg-black/35',
            )}
          >
            <span className="inline-flex items-center gap-1">
              <Icon className="h-4 w-4" /> {t(labelKey)}
            </span>
          </button>
        ))}
      </div>

      {/* Text Transform */}
      <div>
        <span className="block text-[10px] uppercase tracking-wide text-white/40 mb-1">
          {t('common.textTransform')}
        </span>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { label: 'Aa', value: 'none' },
              { label: 'AA', value: 'uppercase' },
              { label: 'aa', value: 'lowercase' },
            ] as const
          ).map(({ label, value }) => (
            <button
              key={value}
              type="button"
              onClick={() => update({ textTransform: value })}
              className={cn(
                'rounded-lg border px-3 py-2 text-xs font-bold transition',
                (styles.textTransform ?? 'none') === value
                  ? 'border-blue-500/50 bg-blue-600/25 text-blue-200'
                  : 'border-white/10 bg-black/20 text-white/60 hover:bg-black/35',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Line height & letter spacing */}
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="block text-[10px] uppercase tracking-wide text-white/40">
            {t('common.editorLineHeight')}
          </span>
          <input
            type="number"
            min={0.7}
            max={4}
            step={0.1}
            value={styles.lineHeight ?? 1.3}
            onChange={e => {
              const v = parseFloat(e.target.value);
              if (!Number.isNaN(v)) update({ lineHeight: v });
            }}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-[10px] uppercase tracking-wide text-white/40">
            {t('common.editorLetterSpacing')}
          </span>
          <input
            type="number"
            step={0.1}
            value={styles.letterSpacing ?? 0}
            onChange={e => {
              const v = parseFloat(e.target.value);
              if (!Number.isNaN(v)) update({ letterSpacing: v });
            }}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none transition focus:border-blue-500"
          />
        </label>
      </div>

      {/* Text shadow */}
      <div className="space-y-1">
        <span className="block text-[10px] uppercase tracking-wide text-white/40">
          {t('common.editorShadow')}
        </span>
        <div className="grid grid-cols-4 gap-2">
          <input
            type="color"
            value={shadow.color || '#000000'}
            onChange={e =>
              onChange({
                ...styles,
                textShadow: { ...shadow, color: e.target.value },
              })
            }
            className="h-8 w-full cursor-pointer rounded-lg border border-white/10 bg-transparent"
          />
          <input
            type="number"
            placeholder={t('common.editorShadowBlur')}
            min={0}
            max={50}
            value={shadow.blur ?? 0}
            onChange={e =>
              onChange({
                ...styles,
                textShadow: {
                  ...shadow,
                  blur: clamp(Math.round(parseInt(e.target.value) || 0), 0, 50),
                },
              })
            }
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs outline-none transition focus:border-blue-500"
          />
          <input
            type="number"
            placeholder="X"
            value={shadow.offsetX ?? 0}
            onChange={e =>
              onChange({
                ...styles,
                textShadow: {
                  ...shadow,
                  offsetX: Math.round(parseInt(e.target.value) || 0),
                },
              })
            }
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs outline-none transition focus:border-blue-500"
          />
          <input
            type="number"
            placeholder="Y"
            value={shadow.offsetY ?? 0}
            onChange={e =>
              onChange({
                ...styles,
                textShadow: {
                  ...shadow,
                  offsetY: Math.round(parseInt(e.target.value) || 0),
                },
              })
            }
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs outline-none transition focus:border-blue-500"
          />
        </div>
      </div>

      {/* Text stroke */}
      <div className="space-y-1">
        <span className="block text-[10px] uppercase tracking-wide text-white/40">
          {t('common.editorStroke')}
        </span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={styles.textStroke?.color || '#000000'}
            onChange={e =>
              onChange({
                ...styles,
                textStroke: { color: e.target.value, width: styles.textStroke?.width ?? 2 },
              })
            }
            className="h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent"
          />
          <input
            type="number"
            min={0}
            max={20}
            value={styles.textStroke?.width ?? 0}
            onChange={e => {
              const v = parseInt(e.target.value);
              if (!Number.isNaN(v)) {
                if (v > 0) {
                  onChange({
                    ...styles,
                    textStroke: { color: styles.textStroke?.color || '#000000', width: clamp(v, 1, 20) },
                  });
                } else {
                  const next = { ...styles };
                  delete next.textStroke;
                  onChange(next);
                }
              }
            }}
            className="flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs outline-none transition focus:border-blue-500"
          />
          {styles.textStroke && (
            <button
              type="button"
              onClick={() => {
                const next = { ...styles };
                delete next.textStroke;
                onChange(next);
              }}
              className="h-8 shrink-0 rounded-lg border border-white/10 bg-black/20 px-2 text-xs text-white/60 hover:bg-black/35"
            >
              {t('common.editorClear')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
