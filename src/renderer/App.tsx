import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Layers, Layout, BookOpen, Image as ImageIcon, Music, Timer, Monitor, Calendar,
  PanelRightOpen
} from 'lucide-react';

import ScriptureBrowser from './ScriptureBrowser';
import MediaLoopTab from './MediaLoopTab';
import CountdownTab from './CountdownTab';
import ScreenCaptureTab from './ScreenCaptureTab';
import CalendarTab from './CalendarTab';
import PresentationsTab from './PresentationsTab';
import HymnsTab from './HymnsTab';
import SlideEditor from './SlideEditor';
import { AnimatedPreview } from './AnimatedPreview';

import { IS_PROJECTOR_MODE, DEFAULT__TRANSITION } from './constants';
import { cn } from './utils';

// State & Hooks
import { useStore } from './state/useStore';
import { useRemoteControl } from './state/useRemoteControl';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { useProjectorSync } from './hooks/useProjectorSync';
import { useSlideOperations } from './hooks/useSlideOperations';

// Components
import Toolbar from './components/Toolbar';
import SlideGrid from './components/SlideGrid';
import RightPanel from './components/RightPanel';
import CheatsheetModal from './components/CheatsheetModal';

export default function App() {
  const { t, i18n } = useTranslation();

  // Custom Hooks
  const { openLive, closeLive } = useRemoteControl();
  useKeyboardNavigation();
  useProjectorSync();

  const {
    presentation,
    selectedSlideId,
    liveIndex,
    projectorReady,
    isBlackout,
    mediaVolume,
    isMediaMuted,
    activeTab,
    setActiveTab,
    presets,
    setPresets,
    panels,
    setPanels,
    selectedPresetName,
    setSelectedPresetName,
    isEditorOpen,
    setIsEditorOpen,
    activeColorPicker,
    setActiveColorPicker,
    dispatchUndo,
    isRightPanelOpen,
    setIsRightPanelOpen,
  } = useStore();

  const {
    addSlide,
    removeSlide,
    moveSelectedSlide,
    reorderSlides,
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
    savePresentation,
    handleImportSlides,
    openPresentation,
    applyPreset,
    openSavedPresentationByName,
    createNewPresentation,
    handleSendToLive,
    handleMediaAdd,
    handleScreenAdd,
    handleHymnAdd,
    handleAddCountdownToPresentation,
    handleAddLoopToPresentation,
    handleSlideClick,
    deleteSelectedSlides,
    moveSelectedSlides,
    replaceSlideMedia,
    removeSlideMedia,
    updateLoopItems,
    updateSlideProperty,
  } = useSlideOperations();

  const transitionType = presentation.transition?.type ?? DEFAULT__TRANSITION.type;
  const transitionDuration = presentation.transition?.duration ?? DEFAULT__TRANSITION.duration;
  const liveSlide = presentation.slides[liveIndex] ?? presentation.slides[0];
  const selectedSlide = presentation.slides.find((s) => s.id === selectedSlideId);

  const SIDEBAR_TABS = useMemo(
    () => [
      { id: 'presentations', icon: Layers, title: t('nav.presentations') },
      { id: 'slides', icon: Layout, title: t('nav.slides') },
      { id: 'bible', icon: BookOpen, title: t('nav.bible') },
      { id: 'media', icon: ImageIcon, title: t('nav.media') },
      { id: 'hymns', icon: Music, title: t('nav.hymns') },
      { id: 'countdown', icon: Timer, title: t('nav.countdown') },
      { id: 'screen', icon: Monitor, title: t('nav.screen') },
      { id: 'calendar', icon: Calendar, title: t('nav.calendar') },
    ] as const,
    [t]
  );

  const savedPresentationNames = useMemo(
    () => presets.map((p) => p.name),
    [presets]
  );

  // ─── Sync html lang with i18n ────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.lang = i18n.language?.split('-')[0] ?? 'tr';
  });

  // ─── Effect: Dropdown Click-Outside ───────────────────────────────────────
  useEffect(() => {
    if (!panels.styles && !activeColorPicker) return;

    const handleClick = (e: MouseEvent) => {
      if (
        !(e.target as Element).closest('.apply-styles-dropdown') &&
        !(e.target as Element).closest('.color-picker-container')
      ) {
        setPanels((p) => ({ ...p, styles: false }));
        setActiveColorPicker(null);
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [panels.styles, activeColorPicker, setPanels, setActiveColorPicker]);

  // ─── Projektör Görünümü ──────────────────────────────────────────────────
  if (IS_PROJECTOR_MODE) {
    if (!projectorReady) {
      return (
        <div className="fixed inset-0 flex items-center justify-center overflow-hidden bg-black">
          <AnimatedPreview
            slide={liveSlide}
            transitionType={transitionType}
            duration={transitionDuration}
            size="projector"
            volume={mediaVolume}
            muted={isMediaMuted}
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white text-sm">
            {t('common.loading') || 'Yükleniyor...'}
          </div>
        </div>
      );
    }

    if (isBlackout) {
      return <div className="fixed inset-0 bg-black z-50" />;
    }

    return (
      <div
        className="fixed inset-0 flex items-center justify-center overflow-hidden bg-black"
        style={{
          backgroundColor: liveSlide?.type === 'text' ? liveSlide.styles?.backgroundColor ?? '#000' : '#000',
          backgroundImage:
            liveSlide?.type === 'text' && liveSlide.styles?.backgroundImage
              ? `url(${liveSlide.styles.backgroundImage})`
              : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <AnimatedPreview
          slide={liveSlide}
          transitionType={transitionType}
          duration={transitionDuration}
          size="projector"
          volume={mediaVolume}
          muted={isMediaMuted}
        />
      </div>
    );
  }

  // ─── Ana Arayüz ──────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-surface-base text-white overflow-hidden">
      {/* Sidebar — navigation landmark */}
      <nav
        aria-label={t('nav.sidebarLabel')}
        className="w-[72px] flex-shrink-0 bg-surface border-r border-white/10 flex flex-col items-center py-3 gap-1"
      >
        {SIDEBAR_TABS.map(({ id, icon: Icon, title }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as any)}
            title={title}
            aria-label={title}
            aria-current={activeTab === id ? 'page' : undefined}
            className={cn(
              'w-[60px] min-h-[52px] flex flex-col items-center justify-center gap-1 rounded-xl transition-[background-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none px-1 active:scale-[0.96]',
              activeTab === id
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
                : 'text-white/60 hover:bg-white/5 hover:text-white'
            )}
          >
            <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span className="text-[10px] font-semibold leading-tight text-white/65 max-w-[56px] truncate text-center text-balance">
              {title}
            </span>
          </button>
        ))}
      </nav>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <Toolbar
          moveSelectedSlides={moveSelectedSlides}
          deleteSelectedSlides={deleteSelectedSlides}
          openLive={openLive}
          closeLive={closeLive}
        />

        <main id="main-content" className="flex-1 overflow-hidden">
          {/* Screen-reader-only page title — provides h1 for every tab view */}
          <h1 className="sr-only">
            {SIDEBAR_TABS.find(tab => tab.id === activeTab)?.title ?? t('nav.slides')}
          </h1>
          {activeTab === 'presentations' && (
            <PresentationsTab
              presentation={presentation}
              presets={presets}
              selectedPresetName={selectedPresetName}
              onPresetsChange={setPresets}
              onApplyPreset={applyPreset}
              onSelectedPresetNameChange={setSelectedPresetName}
              onOpenFile={openPresentation}
              onSaveFile={savePresentation}
              onImportSlides={handleImportSlides}
              onNewPresentation={createNewPresentation}
            />
          )}

          {activeTab === 'slides' && (
            <div className="h-full flex flex-col lg:flex-row">
              <div className="flex-1 min-w-0 overflow-hidden">
                <SlideGrid
                  addSlide={addSlide}
                  reorderSlides={reorderSlides}
                  handleSlideClick={handleSlideClick}
                />
              </div>

              {isRightPanelOpen ? (
                <RightPanel
                  addSlide={addSlide}
                  removeSlide={removeSlide}
                  moveSelectedSlide={moveSelectedSlide}
                  updateSlideContent={updateSlideContent}
                  updateSlideStyles={updateSlideStyles}
                  patchSelectedCountdown={patchSelectedCountdown}
                  updateSlideBackgroundImage={updateSlideBackgroundImage}
                  removeSlideBackgroundImage={removeSlideBackgroundImage}
                  updateSlideBackgroundVideo={updateSlideBackgroundVideo}
                  removeSlideBackgroundVideo={removeSlideBackgroundVideo}
                  applyStyleFieldToAll={applyStyleFieldToAll}
                  handleKeyDown={handleKeyDown}
                  updateTransition={updateTransition}
                  replaceSlideMedia={replaceSlideMedia}
                  removeSlideMedia={removeSlideMedia}
                  updateLoopItems={updateLoopItems}
                  updateSlideProperty={updateSlideProperty}
                  onClose={() => setIsRightPanelOpen(false)}
                />
              ) : (
                <button
                  onClick={() => setIsRightPanelOpen(true)}
                  className="hidden lg:flex items-center justify-center w-6 flex-shrink-0 border-l border-white/10 bg-surface hover:bg-surface-raised transition-colors cursor-pointer group"
                  title={t('common.panelOpen')}
                  aria-label={t('common.panelOpen')}
                >
                  <PanelRightOpen className="w-4 h-4 text-white/40 group-hover:text-white/70 transition-colors" />
                </button>
              )}
            </div>
          )}

          {activeTab === 'bible' && (
            <div className="h-full">
              <ScriptureBrowser onSendToLive={handleSendToLive} />
            </div>
          )}
          {activeTab === 'media' && (
            <div className="h-full">
              <MediaLoopTab
                onAddMediaToPresentation={handleMediaAdd}
                onAddLoopToPresentation={handleAddLoopToPresentation}
              />
            </div>
          )}
          {activeTab === 'hymns' && (
            <div className="h-full">
              <HymnsTab onAddHymnToPresentation={handleHymnAdd} />
            </div>
          )}
          {activeTab === 'countdown' && (
            <div className="h-full">
              <CountdownTab onAddCountdownToPresentation={handleAddCountdownToPresentation} />
            </div>
          )}
          {activeTab === 'screen' && (
            <div className="h-full">
              <ScreenCaptureTab onAddScreenToPresentation={handleScreenAdd} />
            </div>
          )}
          {activeTab === 'calendar' && (
            <div className="h-full">
              <CalendarTab
                savedPresentationNames={savedPresentationNames}
                onOpenPresentation={openSavedPresentationByName}
              />
            </div>
          )}
        </main>
      </div>

      {/* Slide Editor Modal */}
      {isEditorOpen && selectedSlide && (
        <SlideEditor
          slide={selectedSlide}
          onSave={(editedSlide) => {
            dispatchUndo({
              type: 'SET',
              payload: {
                ...presentation,
                slides: presentation.slides.map((s) => (s.id === selectedSlideId ? editedSlide : s)),
              },
            });
            setIsEditorOpen(false);
          }}
          onClose={() => setIsEditorOpen(false)}
        />
      )}

      {/* Cheatsheet Modal */}
      <CheatsheetModal />
    </div>
  );
}
