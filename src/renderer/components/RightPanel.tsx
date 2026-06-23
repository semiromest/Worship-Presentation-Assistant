import { useTranslation } from 'react-i18next';
import {
  ChevronLeft, ChevronRight, Eye, EyeOff, Play, VolumeX, Volume2, Timer, Type,
  Edit3, ChevronUp, ChevronDown, Trash2, Monitor, Repeat, Image as ImageIcon, Video, MousePointer2,
  PanelRightClose, Plus, Settings2
} from 'lucide-react';
import { useStore } from '../state/useStore';
import { cn, toFileUrl } from '../utils';
import { AnimatedPreview } from '../AnimatedPreview';
import { TransitionSelector } from '../TransitionSelector';
import { LivePreview } from '../LivePreview';
import CountdownSlideEditor from '../CountdownSlideEditor';
import SlideStyleEditor from './SlideStyleEditor';
import ImageSlideEditor from './ImageSlideEditor';
import { DEFAULT__TRANSITION, TRANSITION_OPTIONS, DURATION_OPTIONS } from '../constants';
import type { Slide, TransitionType, LoopItem } from '../types';
import type { CountdownSlideData } from '../countdownUtils';

interface RightPanelProps {
  addSlide: () => void;
  removeSlide: (id: string) => void;
  moveSelectedSlide: (direction: -1 | 1) => void;
  updateSlideContent: (content: string) => void;
  updateSlideStyles: (styles: Partial<Slide['styles']>) => void;
  patchSelectedCountdown: (mutate: (data: CountdownSlideData) => CountdownSlideData) => void;
  updateSlideBackgroundImage: () => void;
  removeSlideBackgroundImage: () => void;
  updateSlideBackgroundVideo: () => void;
  removeSlideBackgroundVideo: () => void;
  applyStyleFieldToAll: (pick: Partial<Slide['styles']> | 'all') => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  updateTransition: (update: Partial<{ type: TransitionType; duration: number }>) => void;
  replaceSlideMedia: () => void;
  removeSlideMedia: () => void;
  updateLoopItems: (slideId: string, items: LoopItem[]) => void;
  updateSlideProperty: (slideId: string, props: Record<string, unknown>) => void;
  onClose?: () => void;
}

export default function RightPanel({
  removeSlide,
  moveSelectedSlide,
  updateSlideContent,
  updateSlideStyles,
  patchSelectedCountdown,
  updateSlideBackgroundImage,
  removeSlideBackgroundImage,
  updateSlideBackgroundVideo,
  removeSlideBackgroundVideo,
  applyStyleFieldToAll,
  handleKeyDown,
  updateTransition,
  replaceSlideMedia,
  removeSlideMedia,
  updateLoopItems,
  updateSlideProperty,
  onClose,
}: RightPanelProps) {
  const { t } = useTranslation();
  const {
    presentation,
    liveIndex,
    setLiveIndex,
    isBlackout,
    setIsBlackout,
    selectedSlideId,
    isProjectorWindowOpen,
    mediaVolume,
    setMediaVolume,
    isMediaMuted,
    setIsMediaMuted,
    setIsEditorOpen,
    isRightPanelOpen,
    setIsRightPanelOpen,
  } = useStore();

  const transitionType = presentation.transition?.type ?? DEFAULT__TRANSITION.type;
  const transitionDuration = presentation.transition?.duration ?? DEFAULT__TRANSITION.duration;

  const selectedSlide = presentation.slides.find((s) => s.id === selectedSlideId);
  const selectedSlideIndex = presentation.slides.findIndex((s) => s.id === selectedSlideId);
  const liveSlide = presentation.slides[liveIndex] ?? presentation.slides[0];

  const getSlideIndex = (slides: Slide[], id: string): number =>
    slides.findIndex((s) => s.id === id);

  return (
    <>
      {/* Backdrop for mobile/tablet drawer */}
      {isRightPanelOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsRightPanelOpen(false)}
          aria-hidden="true"
        />
      )}
      <div className={cn(
        'fixed top-0 right-0 h-full z-50 w-[380px] max-w-[85vw]',
        'lg:static lg:z-auto lg:w-[380px] lg:max-w-none lg:h-full',
        'border-l border-white/10 bg-surface flex flex-col overflow-hidden flex-shrink-0',
        'transition-transform duration-300 ease-in-out',
        isRightPanelOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0 lg:hidden',
      )}>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* Live preview — animated (TOP) */}
        <div className="bg-black aspect-video relative group">
          <AnimatedPreview
            slide={liveSlide}
            transitionType={transitionType}
            duration={transitionDuration}
            size="preview"
            volume={0}
            muted={true}
          />

          {/* Overlay Info */}
          <div className="absolute top-0 left-0 right-0 p-3 bg-gradient-to-b from-black/80 to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/77">
                  {t('common.livePreview')}
                </span>
              </div>
              <span className="text-[10px] font-mono font-bold bg-black/60 px-2 py-0.5 rounded border border-white/20">
                {liveIndex + 1}/{presentation.slides.length}
              </span>
            </div>
          </div>
        </div>

        {/* Navigation & Status */}
        <div className="p-4 space-y-3 border-b border-white/10 bg-surface-raised">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/45">
                {t('common.navigation')}
              </span>
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-600/20 text-red-300 border border-red-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" aria-hidden="true" />
                  {t('common.liveSlide')}: {liveIndex + 1}
                </span>
                <span className={cn(
                  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border',
                  selectedSlideIndex === liveIndex
                    ? 'bg-white/5 text-white/45 border-white/10'
                    : 'bg-blue-600/15 text-blue-300 border-blue-500/25',
                )}>
                  {t('common.selectedSlide')}: {selectedSlideIndex >= 0 ? selectedSlideIndex + 1 : '—'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {onClose && (
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/45 hover:text-white/70 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                  title={t('common.panelClose')}
                  aria-label={t('common.panelClose')}
                >
                  <PanelRightClose className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => setLiveIndex((p) => Math.max(0, p - 1))}
                disabled={liveIndex === 0}
                title={t('common.prevSlide')}
                aria-label={t('common.prevSlide')}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-30 transition-[background-color,border-color,opacity] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92] disabled:active:scale-100"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <span className="text-xs font-mono font-bold w-12 text-center tabular-nums" aria-live="polite" aria-atomic="true">
                {liveIndex + 1} / {presentation.slides.length}
              </span>
              <button
                onClick={() => setLiveIndex((p) => Math.min(presentation.slides.length - 1, p + 1))}
                disabled={liveIndex === presentation.slides.length - 1}
                title={t('common.nextSlide')}
                aria-label={t('common.nextSlide')}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-30 transition-[background-color,border-color,opacity] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.92] disabled:active:scale-100"
              >
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setIsBlackout((p) => !p)}
              title={isBlackout ? t('common.openBroadcast') : t('common.blackScreen')}
              aria-label={isBlackout ? t('common.openBroadcast') : t('common.blackScreen')}
              aria-pressed={isBlackout}
              className={cn(
                'flex items-center justify-center gap-2 px-3 py-2 rounded-lg font-bold text-xs border transition-[background-color,border-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.97]',
                isBlackout
                  ? 'bg-red-600 text-white border-red-500 shadow-lg shadow-red-900/20'
                  : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
              )}
            >
              {isBlackout ? <Eye className="w-3.5 h-3.5" aria-hidden="true" /> : <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />}
              {/* Show current state label so user knows what the button will DO */}
              {isBlackout ? t('common.openBroadcast') : t('common.blackScreen')}
            </button>
            <button
              onClick={() => {
                const idx = getSlideIndex(presentation.slides, selectedSlideId);
                if (idx >= 0) setLiveIndex(idx);
              }}
              title={t('common.sendSelectedToLive')}
              aria-label={t('common.sendSelectedToLive')}
              className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 font-bold text-xs transition-[background-color,border-color] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.97]"
            >
              <Play className="w-3.5 h-3.5" aria-hidden="true" />
              {t('common.goToSelected')}
            </button>
          </div>
        </div>

        <TransitionSelector
          transitionType={transitionType}
          duration={transitionDuration}
          onChange={updateTransition}
        />

        {/* Volume Controls */}
        {isProjectorWindowOpen && (
          <div className="px-4 py-2 border-b border-white/10 bg-[#161616]">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsMediaMuted((p) => !p)}
                className={cn(
                  'p-1.5 rounded-lg border transition-colors',
                  isMediaMuted
                    ? 'bg-red-600/20 border-red-500/30 text-red-400'
                    : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                )}
                aria-label={isMediaMuted ? t('common.unmute') : t('common.mute')}
              >
                {isMediaMuted ? <VolumeX className="w-3.5 h-3.5" aria-hidden="true" /> : <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={mediaVolume}
                onChange={(e) => setMediaVolume(parseFloat(e.target.value))}
                aria-label={t('common.mediaVolume')}
                className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
              <span className="text-[10px] text-white/40 font-mono w-8 text-right">{Math.round(mediaVolume * 100)}%</span>
            </div>
          </div>
        )}

        <div className="mx-4 border-t border-white/10" aria-hidden="true" />

        {/* Selected slide editor */}
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {selectedSlide?.type === 'countdown' ? (
                <Timer className="w-3.5 h-3.5 text-blue-400" />
              ) : (
                <Type className="w-3.5 h-3.5 text-blue-400" />
              )}
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/60">
                {selectedSlide?.type === 'countdown' ? t('common.countdownEditor') : t('common.selectedSlideEditor')}
              </span>
            </div>
            {selectedSlide && (
              <div className="flex items-center gap-1.5">
                {selectedSlide && !['countdown', 'screen', 'loop'].includes(selectedSlide.type) && (
                  <button
                    onClick={() => setIsEditorOpen(true)}
                    className="p-1.5 rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/20 transition-colors"
                    title={t('common.detailedEdit')}
                    aria-label={t('common.detailedEdit')}
                  >
                    <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
                <button
                  onClick={() => moveSelectedSlide(-1)}
                  disabled={selectedSlideIndex <= 0}
                  className="p-1.5 rounded-lg bg-white/5 text-white hover:bg-white/10 disabled:opacity-20 border border-white/10 transition-colors"
                  aria-label={t('common.moveUp')}
                >
                  <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  onClick={() => moveSelectedSlide(1)}
                  disabled={selectedSlideIndex === presentation.slides.length - 1}
                  className="p-1.5 rounded-lg bg-white/5 text-white hover:bg-white/10 disabled:opacity-20 border border-white/10 transition-colors"
                  aria-label={t('common.moveDown')}
                >
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  onClick={() => removeSlide(selectedSlide.id)}
                  className="p-1.5 text-red-400 hover:bg-red-400/10 rounded-lg border border-red-500/10 transition-colors"
                  aria-label={t('common.delete')}
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {selectedSlide?.type === 'text' && !selectedSlide.items?.length ? (
              <SlideStyleEditor
                selectedSlide={selectedSlide}
                updateSlideStyles={updateSlideStyles}
                updateSlideBackgroundImage={updateSlideBackgroundImage}
                removeSlideBackgroundImage={removeSlideBackgroundImage}
                updateSlideBackgroundVideo={updateSlideBackgroundVideo}
                removeSlideBackgroundVideo={removeSlideBackgroundVideo}
                applyStyleFieldToAll={applyStyleFieldToAll}
                updateSlideContent={updateSlideContent}
                handleKeyDown={handleKeyDown}
                updateSlideProperty={updateSlideProperty}
              />
            ) : selectedSlide?.type === 'countdown' ? (
              <CountdownSlideEditor
                slide={selectedSlide}
                onPatch={patchSelectedCountdown}
                onUpdateStyles={updateSlideStyles}
              />
            ) : selectedSlide?.type === 'screen' ? (
              <div className="space-y-4">
                <div className="aspect-video rounded-xl border border-white/10 overflow-hidden bg-black shadow-inner">
                  <LivePreview slide={selectedSlide} volume={0} muted={true} />
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-blue-400" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
                      {t('common.screenCaptureSource')}
                    </span>
                  </div>
                  <div className="text-xs text-white/80 font-mono bg-black/20 p-2 rounded-lg border border-white/5 truncate">
                    {selectedSlide.content}
                  </div>
                </div>
              </div>
            ) : selectedSlide?.type === 'loop' ? (
              <LoopEditor
                slide={selectedSlide}
                updateLoopItems={updateLoopItems}
                updateSlideProperty={updateSlideProperty}
                t={t}
              />
            ) : selectedSlide?.type === 'image' && !selectedSlide.items?.length ? (
              <ImageSlideEditor
                selectedSlide={selectedSlide}
                updateSlideStyles={updateSlideStyles}
                replaceSlideMedia={replaceSlideMedia}
                removeSlideMedia={removeSlideMedia}
                applyStyleFieldToAll={applyStyleFieldToAll}
              />
            ) : selectedSlide ? (
              <div className="flex flex-col items-center justify-center py-8 text-center space-y-3 opacity-40">
                <MousePointer2 className="w-8 h-8" />
                <div className="text-xs font-medium text-white/60">{t('common.noQuickEdit')}</div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-3 opacity-20">
                <MousePointer2 className="w-10 h-10" />
                <div className="text-sm font-medium">{t('common.selectSlideToEdit')}</div>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
    </>
  );
}

/* ── Loop Editor ────────────────────────────────────────────── */

function detectMediaType(path: string): 'image' | 'video' {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'm4v'].includes(ext)) return 'video';
  return 'image';
}

function LoopEditor({
  slide,
  updateLoopItems,
  updateSlideProperty,
  t,
}: {
  slide: Slide;
  updateLoopItems: (slideId: string, items: LoopItem[]) => void;
  updateSlideProperty: (slideId: string, props: Record<string, unknown>) => void;
  t: (key: string) => string;
}) {
  const items = slide.loopItems ?? [];
  const loopTr = slide.loopTransition;

  const updateItem = (itemId: string, patch: Partial<LoopItem>) => {
    updateLoopItems(
      slide.id,
      items.map((it) => (it.id === itemId ? { ...it, ...patch } : it))
    );
  };

  const removeItem = (itemId: string) => {
    updateLoopItems(slide.id, items.filter((it) => it.id !== itemId));
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    updateLoopItems(slide.id, next);
  };

  const addMedia = async () => {
    const api = (window as any).electronAPI;
    if (!api?.selectMediaFilesAll) return;
    const paths = await api.selectMediaFilesAll();
    if (!paths || paths.length === 0) return;
    const newItems: LoopItem[] = paths.map((p: string) => ({
      id: crypto.randomUUID(),
      type: detectMediaType(p),
      mediaUrl: toFileUrl(p),
      duration: 5000,
    }));
    updateLoopItems(slide.id, [...items, ...newItems]);
  };

  const totalSec = Math.round(items.reduce((acc, i) => acc + i.duration, 0) / 1000);

  const handleLoopTransitionChange = (update: Partial<{ type: TransitionType; duration: number }>) => {
    updateSlideProperty(slide.id, {
      loopTransition: {
        type: loopTr?.type ?? 'fade',
        duration: loopTr?.duration ?? 400,
        ...update,
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Repeat className="w-4 h-4 text-purple-400" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
            {t('common.loopSlide')}
          </span>
        </div>

        <div className="space-y-1.5">
          <div className="text-xs text-white/60">{items.length} {t('common.items')}</div>
          <div className="text-xs text-white/40">
            {t('common.totalDuration')}: {totalSec} {t('common.seconds')}
          </div>
        </div>

        <div className="space-y-1 max-h-48 overflow-y-auto">
          {items.map((item, idx) => (
            <div key={item.id} className="flex items-center gap-1.5 bg-black/20 rounded-lg px-2 py-1.5 group">
              <span className="text-[10px] text-white/45 w-4 shrink-0">{idx + 1}</span>
              {item.type === 'video' ? (
                <Video className="w-3 h-3 text-white/40 shrink-0" />
              ) : (
                <ImageIcon className="w-3 h-3 text-white/40 shrink-0" />
              )}
              <span className="text-[10px] text-white/50 flex-1 truncate">
                {item.fileName ?? (item.type === 'video' ? t('common.video') : t('common.image'))}
              </span>

              <input
                type="number"
                min={1}
                max={999}
                value={Math.round(item.duration / 1000)}
                onChange={(e) => {
                  const sec = Math.max(1, parseInt(e.target.value, 10) || 1);
                  updateItem(item.id, { duration: sec * 1000 });
                }}
                className="w-12 text-[10px] text-white/70 bg-black/40 border border-white/10 rounded px-1 py-0.5 text-center outline-none focus:border-blue-500/50"
              />

              <div className="flex items-center gap-0.5 opacity-60 hover:opacity-100 focus-visible:opacity-100 transition-opacity">
                <button
                  onClick={() => moveItem(idx, -1)}
                  disabled={idx === 0}
                  className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/70 disabled:opacity-20"
                  aria-label={t('common.moveUp')}
                >
                  <ChevronUp className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  onClick={() => moveItem(idx, 1)}
                  disabled={idx === items.length - 1}
                  className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/70 disabled:opacity-20"
                  aria-label={t('common.moveDown')}
                >
                  <ChevronDown className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  onClick={() => removeItem(item.id)}
                  className="p-1 rounded hover:bg-red-400/20 text-red-400"
                  aria-label={t('common.delete')}
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={addMedia}
          className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg border border-dashed border-white/20 text-white/40 hover:text-white/70 hover:border-white/40 text-[10px] font-bold uppercase tracking-widest transition-colors"
        >
          <Plus className="w-3 h-3" />
          {t('common.addMedia')}
        </button>
      </div>

      {/* Loop transition selector */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Settings2 className="w-3 h-3 text-purple-400" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
            {t('transition.settings')}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="relative">
            <select
              value={loopTr?.type ?? 'none'}
              onChange={(e) => handleLoopTransitionChange({ type: e.target.value as TransitionType })}
              aria-label={t('transition.type')}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/80 outline-none hover:bg-white/10 transition-colors appearance-none cursor-pointer"
            >
              {TRANSITION_OPTIONS.map(({ type, label }) => (
                <option key={type} value={type} className="bg-[#181818]">
                  {t(label)}
                </option>
              ))}
            </select>
            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-white/40">
              <ChevronDown className="w-3 h-3" />
            </div>
          </div>

          <div className="relative">
            <select
              value={loopTr?.duration ?? 400}
              onChange={(e) => handleLoopTransitionChange({ duration: parseInt(e.target.value) })}
              aria-label={t('transition.duration')}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/80 outline-none hover:bg-white/10 transition-colors appearance-none cursor-pointer font-mono"
            >
              {DURATION_OPTIONS.map(ms => (
                <option key={ms} value={ms} className="bg-[#181818]">
                  {ms}ms
                </option>
              ))}
            </select>
            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-white/40">
              <ChevronDown className="w-3 h-3" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
