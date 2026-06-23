import { HexColorPicker } from 'react-colorful';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon, Video, X, Layers, ChevronDown, ChevronUp, AlignLeft, AlignCenter, AlignRight, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd } from 'lucide-react';
import { useStore } from '../state/useStore';
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
  const {
    activeColorPicker,
    setActiveColorPicker,
    panels,
    setPanels,
  } = useStore();

  const parts = selectedSlide.parts ?? [];
  const activePart = selectedSlide.activePart ?? 0;
  const partsMode = selectedSlide.partsMode ?? false;

  const setActivePart = (index: number) => {
    updateSlideProperty(selectedSlide.id, { activePart: index, content: parts[index] });
  };

  const handlePartsKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.max(0, activePart - 1);
      if (next !== activePart) setActivePart(next);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(parts.length - 1, activePart + 1);
      if (next !== activePart) setActivePart(next);
    }
  };

  return (
    <>
      {/* Parts Editor */}
      {parts.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
              {t('common.partsMode')}
            </span>
            <button
              onClick={() => {
                const next = !partsMode;
                if (!next) {
                  updateSlideProperty(selectedSlide.id, { partsMode: next, content: parts.join('\n\n') });
                } else {
                  updateSlideProperty(selectedSlide.id, { partsMode: next, content: parts[activePart] });
                }
              }}
              className={cn(
                'text-[10px] font-bold px-2 py-1 rounded-md border transition-colors',
                partsMode
                  ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                  : 'bg-white/5 border-white/10 text-white/40'
              )}
            >
              {partsMode ? t('common.on') : t('common.off')}
            </button>
          </div>

          {partsMode && (
            <div
              tabIndex={0}
              onKeyDown={handlePartsKeyDown}
              className="space-y-1 max-h-40 overflow-y-auto outline-none"
            >
              {parts.map((part, idx) => (
                <button
                  key={idx}
                  onClick={() => setActivePart(idx)}
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
              <div className="flex items-center justify-center gap-2 pt-1 text-[9px] text-white/20">
                <span>↑ ↓ {t('common.navigateParts')}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Style Grid */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="slide-font-size" className="block text-[10px] text-white/50 uppercase font-bold tracking-tight">
            {t('common.fontSize')}
          </label>
          <div className="relative">
            <input
              id="slide-font-size"
              type="number"
              value={selectedSlide.styles?.fontSize ?? 48}
              onChange={(e) => updateSlideStyles({ fontSize: parseInt(e.target.value) || 48 })}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs focus-visible:border-blue-500/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/30 transition-colors"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <span className="block text-[10px] text-white/50 uppercase font-bold tracking-tight">
            {t('common.background')}
          </span>
          <div className="relative">
            <button
              onClick={() => setActiveColorPicker(activeColorPicker === 'bg' ? null : 'bg')}
              aria-label={`${t('common.background')}: ${selectedSlide.styles?.backgroundColor ?? '#000000'}`}
              aria-expanded={activeColorPicker === 'bg'}
              className="w-full h-[30px] rounded-lg border border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
              style={{ backgroundColor: selectedSlide.styles?.backgroundColor ?? '#000000' }}
            />
            {activeColorPicker === 'bg' && (
              <div className="absolute top-full left-0 mt-2 z-50 color-picker-container shadow-2xl">
                <HexColorPicker
                  color={selectedSlide.styles?.backgroundColor ?? '#000000'}
                  onChange={(c) => updateSlideStyles({ backgroundColor: c })}
                />
              </div>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <span className="block text-[10px] text-white/50 uppercase font-bold tracking-tight">
            {t('common.text')}
          </span>
          <div className="relative">
            <button
              onClick={() => setActiveColorPicker(activeColorPicker === 'text' ? null : 'text')}
              aria-label={`${t('common.text')}: ${selectedSlide.styles?.textColor ?? '#ffffff'}`}
              aria-expanded={activeColorPicker === 'text'}
              className="w-full h-[30px] rounded-lg border border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
              style={{ backgroundColor: selectedSlide.styles?.textColor ?? '#ffffff' }}
            />
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
      </div>

      {/* Font Family */}
      <div className="space-y-1.5">
        <label htmlFor="slide-font-family" className="block text-[10px] text-white/50 uppercase font-bold tracking-tight">
          {t('common.fontFamily')}
        </label>
        <select
          id="slide-font-family"
          value={selectedSlide.styles?.fontFamily ?? 'inherit'}
          onChange={(e) => {
            const val = e.target.value === 'inherit' ? undefined : e.target.value;
            if (val) loadGoogleFont(val);
            updateSlideStyles({ fontFamily: val });
          }}
          className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs focus-visible:border-blue-500/60 focus-visible:outline-none transition-colors"
        >
          {FONT_PRESETS.map((font) => (
            <option key={font.value} value={font.value}>
              {font.name}
            </option>
          ))}
        </select>
      </div>

      {/* Horizontal Alignment */}
      <div>
        <span className="block text-[10px] text-white/45 uppercase font-bold tracking-tight mb-2">
          {t('common.alignHorizontal')}
        </span>
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
              onClick={() => updateSlideStyles({ textAlign: value })}
              aria-label={
                value === 'left'
                  ? t('common.editorAlignLeft')
                  : value === 'center'
                    ? t('common.editorAlignCenterH')
                    : t('common.editorAlignRight')
              }
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs transition',
                selectedSlide.styles?.textAlign === value
                  ? 'border-blue-500/50 bg-blue-600/25 text-blue-200'
                  : 'border-white/10 bg-black/20 text-white/60 hover:bg-black/35',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      {/* Vertical Alignment */}
      <div>
        <span className="block text-[10px] text-white/45 uppercase font-bold tracking-tight mb-2">
          {t('common.alignVertical')}
        </span>
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
              onClick={() => updateSlideStyles({ verticalAlign: value })}
              aria-label={
                value === 'top'
                  ? t('common.editorAlignTop')
                  : value === 'center'
                    ? t('common.editorAlignMiddle')
                    : t('common.editorAlignBottom')
              }
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs transition',
                selectedSlide.styles?.verticalAlign === value
                  ? 'border-blue-500/50 bg-blue-600/25 text-blue-200'
                  : 'border-white/10 bg-black/20 text-white/60 hover:bg-black/35',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </button>
          ))}
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
            <button
              key={value}
              type="button"
              onClick={() => updateSlideStyles({ textTransform: value })}
              aria-label={
                value === 'none'
                  ? 'None'
                  : value === 'uppercase'
                    ? 'Uppercase'
                    : 'Lowercase'
              }
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition',
                (selectedSlide.styles?.textTransform ?? 'none') === value
                  ? 'border-blue-500/50 bg-blue-600/25 text-blue-200'
                  : 'border-white/10 bg-black/20 text-white/60 hover:bg-black/35',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Media Buttons */}
      <div className="flex flex-wrap gap-2">
        <button
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
        </button>
        {selectedSlide.styles?.backgroundImage && (
          <button
            onClick={removeSlideBackgroundImage}
            className="p-2 rounded-lg bg-red-600/20 text-red-400 border border-red-500/20 hover:bg-red-600/30 transition-colors"
            title={t('common.removeImage')}
            aria-label={t('common.removeImage')}
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}

        <button
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
        </button>
        {selectedSlide.styles?.backgroundVideo && (
          <button
            onClick={removeSlideBackgroundVideo}
            className="p-2 rounded-lg bg-red-600/20 text-red-400 border border-red-500/20 hover:bg-red-600/30 transition-colors"
            title={t('common.removeVideo')}
            aria-label={t('common.removeVideo')}
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Apply to All Dropdown */}
      <div className="relative apply-styles-dropdown">
        <button
          onClick={() => setPanels((p) => ({ ...p, styles: !p.styles }))}
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
        </button>
        {panels.styles && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden py-1">
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
              <button
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
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor="slide-content-textarea" className="sr-only">
          {t('common.slideContentPlaceholder')}
        </label>
        <textarea
          id="slide-content-textarea"
          value={selectedSlide.content}
          onKeyDown={handleKeyDown}
          onChange={(e) => updateSlideContent(e.target.value)}
          placeholder={t('common.slideContentPlaceholder')}
          className="w-full h-40 bg-black/40 border border-white/10 rounded-xl p-3 text-sm resize-none focus-visible:border-blue-500/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/30 transition-colors placeholder:text-white/20"
        />
        <div className="flex items-center justify-between px-1">
          <div className="flex gap-3">
            <span className="text-[9px] text-white/20">Alt+Enter: {t('common.split')}</span>
            <span className="text-[9px] text-white/20">Enter: {t('common.goLive')}</span>
          </div>
          <span className="text-[9px] text-white/20 font-mono">
            {selectedSlide.content.length} {t('common.characters')}
          </span>
        </div>
      </div>
    </>
  );
}
