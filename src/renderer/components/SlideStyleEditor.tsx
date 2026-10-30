import { Menu } from '@base-ui/react/menu';
import ControlTooltip from './ControlTooltip';
import { playSfx } from '../sfx';
import { HexColorPicker } from 'react-colorful';
import { useTranslation } from 'react-i18next';
import { Select } from '@base-ui/react/select';
import { Image as ImageIcon, Video, X, Layers, ChevronDown, Check, Type, Minus, Plus, AlignLeft, AlignCenter, AlignRight, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd } from 'lucide-react';
import { useStore } from '../state/useStore';
import { getActivePartIndex, getPartIndex, getSlideDisplayContent } from '../../shared/slideContent';
import { cn } from '../utils';
import type { Slide } from '../types';
import { FONT_PRESETS } from '../editor/editorUtils';
import { loadGoogleFont } from '../fontLoader';

interface SlideStyleEditorProps {
  selectedSlide: Slide;
  updateSlideStyles: (styles: Partial<Slide['styles']>) => void;
  updateSlideBackgroundImage: () => void;
  removeSlideBackgroundImage: () => void;
  updateSlideBackgroundVideo: () => void;
  removeSlideBackgroundVideo: () => void;
  applyStyleFieldToAll: (pick: Partial<Slide['styles']> | 'all') => void;
  updateSlideContent: (content: string) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  updateSlideProperty: (slideId: string, props: Record<string, unknown>) => void;
}

export default function SlideStyleEditor({
  selectedSlide,
  updateSlideStyles,
  updateSlideBackgroundImage,
  removeSlideBackgroundImage,
  updateSlideBackgroundVideo,
  removeSlideBackgroundVideo,
  applyStyleFieldToAll,
  updateSlideContent,
  handleKeyDown,
  updateSlideProperty,
}: SlideStyleEditorProps) {
  const { t } = useTranslation();
  const activeColorPicker = useStore((s) => s.activeColorPicker);
  const setActiveColorPicker = useStore((s) => s.setActiveColorPicker);
  const panels = useStore((s) => s.panels);
  const setPanels = useStore((s) => s.setPanels);

  const parts = selectedSlide.parts ?? [];
  const activePart = getActivePartIndex(selectedSlide);
  const partsMode = selectedSlide.partsMode ?? false;
  const hasTextHighlight = !!selectedSlide.styles?.textHighlight && selectedSlide.styles.textHighlight !== 'transparent';

  const setActivePart = (index: number) => {
    const nextPart = getPartIndex(selectedSlide, index);
    updateSlideProperty(selectedSlide.id, {
      activePart: nextPart,
      content: getSlideDisplayContent({ ...selectedSlide, activePart: nextPart }),
    });
  };

  const handlePartsKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Modified shortcuts still belong to the existing application commands.
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    // Consume at the ends too: the same key must never also navigate slides.
    e.stopPropagation();
    const next = Math.max(0, Math.min(parts.length - 1, activePart + (e.key === 'ArrowDown' ? 1 : -1)));
    if (next === activePart) return;
    setActivePart(next);
    const button = e.currentTarget.querySelector<HTMLButtonElement>(`[data-hymn-part="${next}"]`);
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  return (
    <>
      <section className="design-edit-section design-content">
      {/* Parts Editor */}
      {partsMode && parts.length > 0 && (
        <div data-guide-anchor="hymns-parts" className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
          {partsMode && (
            <div
              tabIndex={0}
              data-hymn-parts-list=""
              role="group"
              aria-label={t('common.partsMode')}
              onKeyDown={handlePartsKeyDown}
              className="design-parts-list space-y-1 max-h-40 overflow-y-auto outline-none"
            >
              {parts.map((part, idx) => (
                <button
                  key={idx}
                  data-hymn-part={idx}
                  aria-pressed={idx === activePart}
                  onClick={() => { if ((selectedSlide.activePart ?? 0) !== idx) { setActivePart(idx); playSfx('forward'); } }}
                  className={cn(
                    'w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg text-[10px] transition-colors',
                    idx === activePart
                      ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                      : 'bg-black/20 text-white/50 border border-transparent hover:bg-white/5'
                  )}
                >
                  <span className="font-bold w-5 shrink-0 text-center">{idx + 1}</span>
                  <span className="truncate">{part.replace(/\n/g, ' ').substring(0, 60)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="slide-content-textarea" className="sr-only">
          {t('common.slideContentPlaceholder')}
        </label>
        <textarea
          id="slide-content-textarea"
          value={getSlideDisplayContent(selectedSlide)}
          onKeyDown={handleKeyDown}
          onChange={(e) => updateSlideContent(e.target.value)}
          placeholder={t('common.slideContentPlaceholder')}
          className="w-full h-40 bg-black/40 border border-white/10 rounded-xl p-3 text-sm resize-none focus-visible:border-blue-500/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/30 transition-colors placeholder:text-white/20"
        />
      </div>
</section>
      <section className="design-edit-section design-appearance"><h3>{t('slidesWorkspace.appearance')}</h3>      {/* Style Grid */}
      <div className="design-typography-row grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <label htmlFor="slide-font-size" className="block text-[10px] text-white/50 uppercase font-bold tracking-tight">
            {t('common.fontSize')}
          </label>
          <div className="design-font-size" onKeyDown={event => { if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation(); }}>
            <ControlTooltip><button
              type="button"
              aria-label={t('slidesWorkspace.decreaseFontSize')}
              disabled={(selectedSlide.styles?.fontSize ?? 48) <= 1}
              onClick={() => updateSlideStyles({ fontSize: Math.max(1, (selectedSlide.styles?.fontSize ?? 48) - 1) })}
            ><Minus aria-hidden="true" /></button></ControlTooltip>
            <input
              id="slide-font-size"
              data-guide-anchor="hymns-font"
              type="number"
              value={selectedSlide.styles?.fontSize ?? 48}
              onChange={(e) => updateSlideStyles({ fontSize: parseInt(e.target.value) || 48 })}
              className="design-font-size-input"
            />
            <ControlTooltip><button
              type="button"
              aria-label={t('slidesWorkspace.increaseFontSize')}
              onClick={() => updateSlideStyles({ fontSize: (selectedSlide.styles?.fontSize ?? 48) + 1 })}
            ><Plus aria-hidden="true" /></button></ControlTooltip>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 min-w-0">
        <div className="space-y-1.5">
          <span className="block text-[10px] text-white/50 uppercase font-bold tracking-tight">
            {t('common.text')}
          </span>
          <div className="relative">
            <ControlTooltip><button
              onClick={() => setActiveColorPicker(activeColorPicker === 'text' ? null : 'text')}
              aria-label={`${t('common.text')}: ${selectedSlide.styles?.textColor ?? '#ffffff'}`}
              aria-expanded={activeColorPicker === 'text'}
              className="w-full h-[30px] rounded-lg border border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
              style={{ backgroundColor: selectedSlide.styles?.textColor ?? '#ffffff' }}
            /></ControlTooltip>
            {activeColorPicker === 'text' && (
              <div className="absolute top-full right-0 mt-2 z-50 color-picker-container shadow-2xl">
                <HexColorPicker
                  color={selectedSlide.styles?.textColor ?? '#ffffff'}
                  onChange={(c) => updateSlideStyles({ textColor: c })}
                />
              </div>
            )}
          </div>
        </div>
          <div className="space-y-1.5">
          <span className="block text-[10px] text-white/50 uppercase font-bold tracking-tight">
            {t('common.background')}
          </span>
          <div className="relative">
            <ControlTooltip><button
              onClick={() => setActiveColorPicker(activeColorPicker === 'bg' ? null : 'bg')}
              aria-label={`${t('common.background')}: ${selectedSlide.styles?.backgroundColor ?? '#000000'}`}
              aria-expanded={activeColorPicker === 'bg'}
              className="w-full h-[30px] rounded-lg border border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
              style={{ backgroundColor: selectedSlide.styles?.backgroundColor ?? '#000000' }}
            /></ControlTooltip>
            {activeColorPicker === 'bg' && (
              <div className="absolute top-full right-0 mt-2 z-50 color-picker-container shadow-2xl">
                <HexColorPicker
                  color={selectedSlide.styles?.backgroundColor ?? '#000000'}
                  onChange={(c) => updateSlideStyles({ backgroundColor: c })}
                />
              </div>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* Text highlight */}
      <div className="space-y-1.5">
        <span className="block text-[10px] text-white/50 uppercase font-bold tracking-tight">
          {t('common.editorTextHighlight')}
        </span>
        <div className="flex items-center gap-2">
          <div className="relative h-[30px] w-10 rounded-lg border border-white/10 bg-white/5 focus-within:ring-2 focus-within:ring-blue-500">
          {!hasTextHighlight && <span aria-hidden="true" className="pointer-events-none absolute inset-1 rounded bg-[repeating-linear-gradient(135deg,transparent,transparent_5px,rgba(255,255,255,0.08)_5px,rgba(255,255,255,0.08)_6px)]" />}
          <input
            type="color"
            value={hasTextHighlight ? selectedSlide.styles!.textHighlight : '#ffff00'}
            onChange={(e) => updateSlideStyles({ textHighlight: e.target.value })}
            className={cn('absolute inset-0 h-full w-full cursor-pointer rounded-lg border-0 bg-transparent', !hasTextHighlight && 'opacity-0')}
            aria-label={t('common.editorTextHighlight')}
          />
          </div>
          <ControlTooltip><button
            type="button"
            onClick={() => updateSlideStyles({ textHighlight: 'transparent' })}
            title={t('common.editorClear')}
            aria-label={`${t('common.editorTextHighlight')}: ${t('common.editorClear')}`}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button></ControlTooltip>
        </div>
      </div>

      {/* Font Family */}
      <div className="space-y-1.5">
        <label htmlFor="slide-font-family" className="block text-[10px] text-white/50 uppercase font-bold tracking-tight">
          {t('common.fontFamily')}
        </label>
        <Select.Root
          value={selectedSlide.styles?.fontFamily ?? 'inherit'}
          items={FONT_PRESETS.map(font => ({ value: font.value, label: font.value === 'inherit' ? t('common.editorFontDefault') : font.name }))}
          onValueChange={(value) => {
            if (value === null) return;
            const val = value === 'inherit' ? undefined : value;
            if (val) loadGoogleFont(val);
            if (val !== selectedSlide.styles?.fontFamily) { updateSlideStyles({ fontFamily: val }); playSfx('press'); }
          }}
        >
          <Select.Trigger id="slide-font-family" className="design-font-trigger" aria-label={t('common.fontFamily')}>
            <Type className="w-4 h-4 shrink-0 text-white/45" aria-hidden="true" />
            <Select.Value className="min-w-0 flex-1 truncate text-left" style={{ fontFamily: selectedSlide.styles?.fontFamily }} />
            <Select.Icon><ChevronDown className="w-3.5 h-3.5 text-white/50" aria-hidden="true" /></Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner side="bottom" align="start" sideOffset={6} alignItemWithTrigger={false} className="z-[80]">
              <Select.Popup className="design-font-popup">
                <Select.List className="design-font-list">
                  {FONT_PRESETS.map((font) => (
                    <Select.Item key={font.value} value={font.value} label={font.value === 'inherit' ? t('common.editorFontDefault') : font.name} className="design-font-option">
                      <Select.ItemText className="min-w-0 flex-1 truncate" style={{ fontFamily: font.value }}>
                        {font.value === 'inherit' ? t('common.editorFontDefault') : font.name}
                      </Select.ItemText>
                      <Select.ItemIndicator><Check className="w-4 h-4 text-blue-300" aria-hidden="true" /></Select.ItemIndicator>
                    </Select.Item>
                  ))}
                </Select.List>
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      </div>

      <div className="design-alignment-row">
      {/* Horizontal Alignment */}
      <div className="design-alignment-group">
        <span className="block text-[10px] text-white/45 uppercase font-bold tracking-tight mb-2">
          {t('common.alignHorizontal')}
        </span>
        <div className="design-alignment-buttons">
          {(
            [
              { icon: AlignLeft, value: 'left' },
              { icon: AlignCenter, value: 'center' },
              { icon: AlignRight, value: 'right' },
            ] as const
          ).map(({ icon: Icon, value }) => (
            <ControlTooltip key={value}><button
              key={value}
              type="button"
              onClick={() => { if (selectedSlide.styles?.textAlign !== value) { updateSlideStyles({ textAlign: value }); playSfx('snap'); } }}
              aria-pressed={(selectedSlide.styles?.textAlign ?? 'center') === value}
                title={t(value === 'left' ? 'common.editorAlignLeft' : value === 'center' ? 'common.editorAlignCenterH' : 'common.editorAlignRight')}
                aria-label={
                  value === 'left'
                  ? t('common.editorAlignLeft')
                  : value === 'center'
                    ? t('common.editorAlignCenterH')
                    : t('common.editorAlignRight')
              }
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs transition',
                (selectedSlide.styles?.textAlign ?? 'center') === value
                  ? 'border-white/20 bg-white/10 text-white/90'
                  : 'border-white/10 bg-black/20 text-white/60 hover:bg-black/35',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button></ControlTooltip>
          ))}
        </div>
      </div>

      {/* Vertical Alignment */}
      <div className="design-alignment-group">
        <span className="block text-[10px] text-white/45 uppercase font-bold tracking-tight mb-2">
          {t('common.alignVertical')}
        </span>
        <div className="design-alignment-buttons">
          {(
            [
              { icon: AlignVerticalJustifyStart, value: 'top' },
              { icon: AlignVerticalJustifyCenter, value: 'center' },
              { icon: AlignVerticalJustifyEnd, value: 'bottom' },
            ] as const
          ).map(({ icon: Icon, value }) => (
            <ControlTooltip key={value}><button
              key={value}
              type="button"
              onClick={() => { if (selectedSlide.styles?.verticalAlign !== value) { updateSlideStyles({ verticalAlign: value }); playSfx('snap'); } }}
              aria-pressed={(selectedSlide.styles?.verticalAlign ?? 'center') === value}
                title={t(value === 'top' ? 'common.editorAlignTop' : value === 'center' ? 'common.editorAlignMiddle' : 'common.editorAlignBottom')}
                aria-label={
                  value === 'top'
                  ? t('common.editorAlignTop')
                  : value === 'center'
                    ? t('common.editorAlignMiddle')
                    : t('common.editorAlignBottom')
              }
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs transition',
                (selectedSlide.styles?.verticalAlign ?? 'center') === value
                  ? 'border-white/20 bg-white/10 text-white/90'
                  : 'border-white/10 bg-black/20 text-white/60 hover:bg-black/35',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button></ControlTooltip>
          ))}
        </div>
      </div>

      </div>
      {/* Text Transform */}
      <div>
        <span className="block text-[10px] text-white/45 uppercase font-bold tracking-tight mb-2">
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
            <ControlTooltip key={value}><button
              key={value}
              type="button"
              onClick={() => { if (selectedSlide.styles?.textTransform !== value) { updateSlideStyles({ textTransform: value }); playSfx('snap'); } }}
              aria-pressed={(selectedSlide.styles?.textTransform ?? 'none') === value}
              aria-label={
                value === 'none'
                  ? t('slidesWorkspace.textCaseOriginal')
                  : value === 'uppercase'
                    ? t('slidesWorkspace.textCaseUppercase')
                    : t('slidesWorkspace.textCaseLowercase')
              }
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition',
                (selectedSlide.styles?.textTransform ?? 'none') === value
                  ? 'border-white/20 bg-white/10 text-white/90'
                  : 'border-white/10 bg-black/20 text-white/60 hover:bg-black/35',
              )}
            >
              {label}
            </button></ControlTooltip>
          ))}
        </div>
      </div>

</section>
      <section className="design-edit-section design-background"><h3>{t('slidesWorkspace.background')}</h3>
      {/* Media Buttons */}
      <div className="flex flex-wrap gap-2">
        <ControlTooltip><button
          onClick={updateSlideBackgroundImage}
          aria-label={t('common.image')}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[11px] font-semibold transition-[background-color,border-color] border active:scale-[0.96]',
            selectedSlide.styles?.backgroundImage
              ? 'bg-blue-600/20 border-blue-500/40 text-blue-300 hover:bg-blue-600/30'
              : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white'
          )}
        >
          <ImageIcon className="w-3.5 h-3.5" aria-hidden="true" />
          {t('common.image')}
        </button></ControlTooltip>
        {(!selectedSlide.youtubeMusic || selectedSlide.musicSettings?.attachment) && selectedSlide.styles?.backgroundImage && (
          <ControlTooltip><button
            onClick={removeSlideBackgroundImage}
            className="p-2 rounded-lg bg-red-600/20 text-red-400 border border-red-500/20 hover:bg-red-600/30 transition-colors"
            title={t('common.removeImage')}
            aria-label={t('common.removeImage')}
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button></ControlTooltip>
        )}

        <ControlTooltip><button
          onClick={updateSlideBackgroundVideo}
          aria-label={t('common.video')}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[11px] font-semibold transition-[background-color,border-color] border active:scale-[0.96]',
            selectedSlide.styles?.backgroundVideo
              ? 'bg-purple-600/20 border-purple-500/40 text-purple-300 hover:bg-purple-600/30'
              : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white'
          )}
        >
          <Video className="w-3.5 h-3.5" aria-hidden="true" />
          {t('common.video')}
        </button></ControlTooltip>
        {selectedSlide.styles?.backgroundVideo && (
          <ControlTooltip><button
            onClick={removeSlideBackgroundVideo}
            className="p-2 rounded-lg bg-red-600/20 text-red-400 border border-red-500/20 hover:bg-red-600/30 transition-colors"
            title={t('common.removeVideo')}
            aria-label={t('common.removeVideo')}
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button></ControlTooltip>
        )}
      </div>


      {/* Apply to All Dropdown */}
      <Menu.Root open={panels.styles} modal={false} onOpenChange={next => { if (next !== panels.styles) { setPanels(p => ({ ...p, styles: next })); playSfx(next ? 'open' : 'close'); } }}>
      <div className="relative apply-styles-dropdown">
        <ControlTooltip suppress={panels.styles}><Menu.Trigger
          aria-label={t('common.applyToAll')}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[11px] font-semibold text-white/70 hover:bg-white/10 transition-[background-color] active:scale-[0.97] group"
        >
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            {t('common.applyToAll')}
          </div>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'w-3.5 h-3.5 transition-transform opacity-40 group-hover:opacity-100',
              panels.styles && 'rotate-180'
            )}
          />
        </Menu.Trigger></ControlTooltip>
        <Menu.Portal><Menu.Positioner side="bottom" align="start" sideOffset={6} className="z-[80]">
          <Menu.Popup aria-label={t('common.applyToAll')} className="apply-styles-dropdown design-action-menu w-[min(320px,calc(100vw-24px))]" onKeyDown={event => event.stopPropagation()}>
            {[
              {
                label: t('common.applyBackgroundImage'),
                action: () => applyStyleFieldToAll({ backgroundImage: undefined }),
              },
              {
                label: t('common.applyBackgroundVideo'),
                action: () => applyStyleFieldToAll({ backgroundVideo: undefined }),
              },
              {
                label: t('common.applyTextProperties'),
                action: () => applyStyleFieldToAll({ fontSize: undefined, textColor: undefined, fontFamily: undefined }),
              },
              {
                label: t('common.applyBackgroundColor'),
                action: () => applyStyleFieldToAll({ backgroundColor: undefined }),
              },
              {
                label: t('common.applyImageFit'),
                action: () => applyStyleFieldToAll({ objectFit: undefined }),
              },
              {
                label: t('common.applyAllProperties'),
                action: () => applyStyleFieldToAll('all'),
                important: true,
              },
            ].map((item, idx) => (
              <Menu.Item
                key={idx}
                onClick={() => {
                  item.action();
                  setPanels((p) => ({ ...p, styles: false }));
                }}
                className={cn(
                  'w-full text-left px-4 py-2 text-[11px] hover:bg-white/5 transition-colors',
                  item.important ? 'text-blue-400 font-bold border-t border-white/5 mt-1 pt-3' : 'text-white/60'
                )}
              >
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner></Menu.Portal>
      </div>
      </Menu.Root>

</section>
    </>
  );
}
