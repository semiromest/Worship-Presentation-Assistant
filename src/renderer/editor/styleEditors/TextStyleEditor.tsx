import { memo, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Bold,
  Italic,
  Underline,
} from 'lucide-react';
import type { SlideItem, TextStyle } from '../../types';
import { DEFAULT_TEXT_STYLE, FONT_PRESETS, clamp } from '../editorUtils';
import { loadGoogleFont } from '../../fontLoader';
import { ColorField, NumberField, Section, Segmented, SelectField, ToolButton } from '../EditorControls';
import { fieldLabelClass } from '../editorStyles';

interface TextStyleEditorProps {
  item: SlideItem;
  onChange: (styles: TextStyle) => void;
  /** Rendered at the top of the "Text" section (the content field). */
  content?: ReactNode;
}

export const TextStyleEditor = memo(function TextStyleEditor({ item, onChange, content }: TextStyleEditorProps) {
  const { t } = useTranslation();
  const styles = item.textStyles ?? DEFAULT_TEXT_STYLE;
  const shadow = styles.textShadow ?? {};

  const update = useCallback(
    (patch: Partial<TextStyle>) => {
      if (patch.fontFamily) loadGoogleFont(patch.fontFamily);
      onChange({ ...styles, ...patch });
    },
    [styles, onChange]
  );
  const without = (key: keyof TextStyle) => {
    const next = { ...styles };
    delete next[key];
    onChange(next);
  };

  return (
    <>
      <Section id="text" title={t('common.editorTextStyles')}>
        {content}

        <div className="grid grid-cols-[1fr_76px] gap-1.5">
          <SelectField
            label={t('common.editorFontFamily')}
            hideLabel
            value={styles.fontFamily || 'inherit'}
            onChange={(value) => update({ fontFamily: value })}
            options={FONT_PRESETS.map((font, i) => ({
              value: font.value,
              label: i === 0 ? t('common.editorFontDefault') : font.name,
            }))}
          />
          <NumberField
            label={t('common.editorFontSize')}
            prefix="pt"
            min={8}
            max={240}
            value={styles.fontSize ?? 32}
            onChange={(raw) => {
              const value = parseInt(raw);
              if (!Number.isNaN(value)) update({ fontSize: clamp(Math.round(value), 8, 240) });
            }}
          />
        </div>

        <div className="flex items-center gap-1">
          <div className="flex h-7 items-center gap-0.5 rounded-md bg-black/25 p-0.5">
            <ToolButton
              label={t('common.editorBold')}
              icon={Bold}
              pressed={styles.fontWeight === 'bold'}
              active={styles.fontWeight === 'bold'}
              className="h-6 min-w-6"
              onClick={() => update({ fontWeight: styles.fontWeight === 'bold' ? 'normal' : 'bold' })}
            />
            <ToolButton
              label={t('common.editorItalic')}
              icon={Italic}
              pressed={styles.fontStyle === 'italic'}
              active={styles.fontStyle === 'italic'}
              className="h-6 min-w-6"
              onClick={() => update({ fontStyle: styles.fontStyle === 'italic' ? 'normal' : 'italic' })}
            />
            <ToolButton
              label={t('common.editorUnderline')}
              icon={Underline}
              pressed={styles.textDecoration === 'underline'}
              active={styles.textDecoration === 'underline'}
              className="h-6 min-w-6"
              onClick={() => update({ textDecoration: styles.textDecoration === 'underline' ? '' : 'underline' })}
            />
          </div>
          <div className="min-w-0 flex-1">
            <Segmented
              label={t('common.textTransform')}
              value={styles.textTransform ?? 'none'}
              onChange={(value) => update({ textTransform: value })}
              options={[
                { value: 'none', label: t('common.textTransform') + ': Aa', text: 'Aa' },
                { value: 'uppercase', label: t('common.textTransform') + ': AA', text: 'AA' },
                { value: 'lowercase', label: t('common.textTransform') + ': aa', text: 'aa' },
              ]}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <Segmented
            label={t('common.editorTextAlign')}
            value={styles.textAlign}
            onChange={(value) => update({ textAlign: value })}
            options={[
              { value: 'left', label: t('common.editorAlignLeft'), icon: AlignLeft },
              { value: 'center', label: t('common.editorAlignCenterH'), icon: AlignCenter },
              { value: 'right', label: t('common.editorAlignRight'), icon: AlignRight },
            ]}
          />
          <Segmented
            label={t('common.editorVerticalAlign')}
            value={styles.verticalAlign}
            onChange={(value) => update({ verticalAlign: value })}
            options={[
              { value: 'top', label: t('common.editorAlignTop'), icon: AlignVerticalJustifyStart },
              { value: 'center', label: t('common.editorAlignMiddle'), icon: AlignVerticalJustifyCenter },
              { value: 'bottom', label: t('common.editorAlignBottom'), icon: AlignVerticalJustifyEnd },
            ]}
          />
        </div>

        <ColorField
          label={t('common.editorColor')}
          value={styles.textColor}
          fallback="#ffffff"
          onChange={(color) => update({ textColor: color })}
        />

        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-1">
            <span className={fieldLabelClass}>{t('common.editorLineHeight')}</span>
            <NumberField
              label={t('common.editorLineHeight')}
              prefix="↕"
              min={0.7}
              max={4}
              step={0.1}
              value={styles.lineHeight ?? 1.3}
              onChange={(raw) => {
                const value = parseFloat(raw);
                if (!Number.isNaN(value)) update({ lineHeight: value });
              }}
            />
          </div>
          <div className="space-y-1">
            <span className={fieldLabelClass}>{t('common.editorLetterSpacing')}</span>
            <NumberField
              label={t('common.editorLetterSpacing')}
              prefix="↔"
              step={0.1}
              value={styles.letterSpacing ?? 0}
              onChange={(raw) => {
                const value = parseFloat(raw);
                if (!Number.isNaN(value)) update({ letterSpacing: value });
              }}
            />
          </div>
        </div>
      </Section>

      <Section id="text-effects" title={t('common.editorTextEffects')} defaultOpen={false}>
        <div className="grid grid-cols-2 gap-1.5">
          <ColorField
            label={t('common.editorBackground')}
            value={styles.backgroundColor}
            fallback="#000000"
            showText={false}
            onChange={(color) => update({ backgroundColor: color })}
            onClear={styles.backgroundColor ? () => without('backgroundColor') : undefined}
          />
          <ColorField
            label={t('common.editorTextHighlight')}
            value={styles.textHighlight && styles.textHighlight !== 'transparent' ? styles.textHighlight : undefined}
            fallback="#ffff00"
            showText={false}
            onChange={(color) => update({ textHighlight: color })}
            onClear={
              styles.textHighlight && styles.textHighlight !== 'transparent'
                ? () => update({ textHighlight: 'transparent' })
                : undefined
            }
          />
        </div>

        <div className="space-y-1">
          <span className={fieldLabelClass}>{t('common.editorShadow')}</span>
          <div className="grid grid-cols-[28px_1fr_1fr_1fr] gap-1">
            <input
              type="color"
              aria-label={t('common.editorShadow')}
              value={shadow.color || '#000000'}
              onChange={(event) => onChange({ ...styles, textShadow: { ...shadow, color: event.target.value } })}
              className="h-7 w-7 cursor-pointer rounded-md border border-white/[0.08] bg-black/25 p-1 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-0"
            />
            <NumberField
              label={t('common.editorShadowBlur')}
              placeholder={t('common.editorShadowBlur')}
              prefix="◌"
              min={0}
              max={50}
              value={shadow.blur ?? 0}
              onChange={(raw) =>
                onChange({ ...styles, textShadow: { ...shadow, blur: clamp(Math.round(parseInt(raw) || 0), 0, 50) } })
              }
            />
            <NumberField
              label={t('common.editorShadow') + ' X'}
              prefix="X"
              value={shadow.offsetX ?? 0}
              onChange={(raw) => onChange({ ...styles, textShadow: { ...shadow, offsetX: Math.round(parseInt(raw) || 0) } })}
            />
            <NumberField
              label={t('common.editorShadow') + ' Y'}
              prefix="Y"
              value={shadow.offsetY ?? 0}
              onChange={(raw) => onChange({ ...styles, textShadow: { ...shadow, offsetY: Math.round(parseInt(raw) || 0) } })}
            />
          </div>
        </div>

        <div className="space-y-1">
          <span className={fieldLabelClass}>{t('common.editorStroke')}</span>
          <div className="grid grid-cols-[28px_1fr_auto] items-center gap-1">
            <input
              type="color"
              aria-label={t('common.editorStroke')}
              value={styles.textStroke?.color || '#000000'}
              onChange={(event) =>
                onChange({ ...styles, textStroke: { color: event.target.value, width: styles.textStroke?.width ?? 2 } })
              }
              className="h-7 w-7 cursor-pointer rounded-md border border-white/[0.08] bg-black/25 p-1 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-0"
            />
            <NumberField
              label={t('common.editorStroke')}
              prefix="px"
              min={0}
              max={20}
              value={styles.textStroke?.width ?? 0}
              onChange={(raw) => {
                const value = parseInt(raw);
                if (Number.isNaN(value)) return;
                if (value > 0)
                  onChange({
                    ...styles,
                    textStroke: { color: styles.textStroke?.color || '#000000', width: clamp(value, 1, 20) },
                  });
                else without('textStroke');
              }}
            />
            {styles.textStroke && (
              <button
                type="button"
                onClick={() => without('textStroke')}
                className="h-7 rounded-md px-2 text-[11px] text-white/55 transition hover:bg-white/[0.07] hover:text-white"
              >
                {t('common.editorClear')}
              </button>
            )}
          </div>
        </div>
      </Section>
    </>
  );
});
