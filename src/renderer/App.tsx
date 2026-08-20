import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Layers, Layout, BookOpen, Image as ImageIcon, Music, Timer, Monitor, Calendar,
  PanelRightOpen, Settings
} from 'lucide-react';

import ScriptureBrowser from './ScriptureBrowser';
import MediaLoopTab from './MediaLoopTab';
import CountdownTab from './CountdownTab';
import ScreenCaptureTab from './ScreenCaptureTab';
import CalendarTab from './CalendarTab';
import PresentationsTab from './PresentationsTab';
import HymnsTab from './HymnsTab';
import SlideEditor from './SlideEditor';
import SettingsTab from './components/SettingsTab';
import { AnimatedPreview } from './AnimatedPreview';

import { IS_PROJECTOR_MODE, DEFAULT__TRANSITION } from './constants';
import { cn } from './utils';
import { initSfx } from './sfx';

// State & Hooks
import { useStore } from './state/useStore';
import { useRemoteControl } from './state/useRemoteControl';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { useProjectorSync } from './hooks/useProjectorSync';
import { useLiveSave, getLiveSaveRetention } from './hooks/useLiveSave';
import { useSlideOperations } from './hooks/useSlideOperations';
import { useStt } from './hooks/useStt';
import { useSttSlideTracker } from './hooks/useSttSlideTracker';
import { useShare } from './hooks/useShare';
import { initUpdaterSync } from './state/useUpdaterStore';

// Components
import Toolbar from './components/Toolbar';
import SlideGrid from './components/SlideGrid';
import RightPanel from './components/RightPanel';
import CheatsheetModal from './components/CheatsheetModal';
import UpdatesModal from './components/UpdatesModal';
import RemoteControlModal from './components/RemoteControlModal';
import SttPanel from './components/SttPanel';
import Toast from './components/Toast';

export default function App() {
  const { t, i18n } = useTranslation();

  // Custom Hooks
  const { openLive, closeLive, openOutput, closeOutput } = useRemoteControl();
  useProjectorSync();
  useLiveSave();
  // Real-time captions/translation — runs in BOTH windows so the projector
  // screen renders the same live text. The hook owns mic capture + session
  // start/stop; the panel below is just the control UI.
  const { start: sttStart, stop: sttStop } = useStt();
  // Slide tracker: follows the speaker by matching the live transcript against
  // the deck's text slides. No-ops in the projector window.
  useSttSlideTracker();
  // Phone captions/translation share — a pure subscriber of the STT store that
  // pushes normalized snapshots to the main process for LAN broadcast.
  const { startShare, stopShare } = useShare();

  // Field-level selectors: subscribing to the whole store re-rendered App on
  // every state change (toast, search, liveIndex, …). Each selector returns a
  // stable reference, so re-renders are limited to actual field changes.
  const presentation = useStore((s) => s.presentation);
  const selectedSlideId = useStore((s) => s.selectedSlideId);
  const liveIndex = useStore((s) => s.liveIndex);
  const instantTransition = useStore((s) => s.instantTransition);
  const setInstantTransition = useStore((s) => s.setInstantTransition);
  const projectorReady = useStore((s) => s.projectorReady);
  const isBlackout = useStore((s) => s.isBlackout);
  const mediaVolume = useStore((s) => s.mediaVolume);
  const isMediaMuted = useStore((s) => s.isMediaMuted);
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const presets = useStore((s) => s.presets);
  const setPresets = useStore((s) => s.setPresets);
  const panels = useStore((s) => s.panels);
  const setPanels = useStore((s) => s.setPanels);
  const selectedPresetName = useStore((s) => s.selectedPresetName);
  const setSelectedPresetName = useStore((s) => s.setSelectedPresetName);
  const isEditorOpen = useStore((s) => s.isEditorOpen);
  const setIsEditorOpen = useStore((s) => s.setIsEditorOpen);
  const activeColorPicker = useStore((s) => s.activeColorPicker);
  const setActiveColorPicker = useStore((s) => s.setActiveColorPicker);
  const dispatchUndo = useStore((s) => s.dispatchUndo);
  const isRightPanelOpen = useStore((s) => s.isRightPanelOpen);
  const setIsRightPanelOpen = useStore((s) => s.setIsRightPanelOpen);
  const isSttPanelOpen = useStore((s) => s.isSttPanelOpen);
  const setIsSttPanelOpen = useStore((s) => s.setIsSttPanelOpen);

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
    handleAddAllMedia,
    handleScreenAdd,
    handleHymnAdd,
    handleAddCountdownToPresentation,
    handleAddCaptionsSlide,
    handleSttUtteranceToSlide,
    handleAddLoopToPresentation,
    handleSlideClick,
    handleSlideDoubleClick,
    deleteSelectedSlides,
    duplicateSelectedSlides,
    moveSelectedSlides,
    replaceSlideMedia,
    removeSlideMedia,
    updateLoopItems,
    updateSlideProperty,
  } = useSlideOperations();

  useKeyboardNavigation({
    onDeleteSlides: deleteSelectedSlides,
    onDuplicateSlides: duplicateSelectedSlides,
  });

  const configuredTransitionType = presentation.transition?.type ?? DEFAULT__TRANSITION.type;
  const configuredTransitionDuration = presentation.transition?.duration ?? DEFAULT__TRANSITION.duration;
  // Auto-tracked slide changes switch instantly (no fade/zoom) so the speaker
  // is followed with minimal delay; manual navigation keeps the configured
  // transition.
  const transitionType = instantTransition ? 'none' : configuredTransitionType;
  const transitionDuration = instantTransition ? 0 : configuredTransitionDuration;
  const liveSlide = presentation.slides[liveIndex] ?? presentation.slides[0];
  const selectedSlide = presentation.slides.find((s) => s.id === selectedSlideId);

  const SIDEBAR_TABS = useMemo(
    () => [
      { id: 'presentations', icon: Layers, titleKey: 'nav.presentations' },
      { id: 'slides', icon: Layout, titleKey: 'nav.slides' },
      { id: 'bible', icon: BookOpen, titleKey: 'nav.bible' },
      { id: 'media', icon: ImageIcon, titleKey: 'nav.media' },
      { id: 'hymns', icon: Music, titleKey: 'nav.hymns' },
      { id: 'countdown', icon: Timer, titleKey: 'nav.countdown' },
      { id: 'screen', icon: Monitor, titleKey: 'nav.screen' },
      { id: 'calendar', icon: Calendar, titleKey: 'nav.calendar' },
      { id: 'settings', icon: Settings, titleKey: 'nav.settings' },
    ] as const,
    []
  );

  const savedPresentationNames = useMemo(
    () => presets.filter((p) => !p.name.startsWith('__live_autosave_')).map((p) => p.name),
    [presets]
  );

  // ─── Sync html lang with i18n ────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.lang = i18n.language?.split('-')[0] ?? 'tr';
  }, [i18n.language]);

  // ─── Auto-track "instant switch" is one-shot ─────────────────────────────
  // The flag is consumed by this render (transitionType becomes 'none') and
  // then cleared so the next manual navigation uses the configured effect.
  useEffect(() => {
    if (!instantTransition) return;
    const id = setTimeout(() => setInstantTransition(false), 0);
    return () => clearTimeout(id);
  }, [instantTransition, setInstantTransition]);

  useEffect(() => {
    let alive = true;

    const hydratePresets = async () => {
      const loaded = await window.electronAPI?.loadPresets?.(getLiveSaveRetention());
      if (!alive || !Array.isArray(loaded)) return;
      setPresets(loaded);
    };

    void hydratePresets();
    return () => {
      alive = false;
    };
  }, [setPresets]);

  // ─── Updater sync (preload events → store) ────────────────────────────────
  useEffect(() => { initUpdaterSync(); }, []);

  // ─── UI sound effects (uisfx) ─────────────────────────────────────────────
  // Only the control window plays sounds; the fullscreen projector window
  // stays silent. No AudioContext is created until the first interaction.
  useEffect(() => {
    if (IS_PROJECTOR_MODE) return;
    initSfx();
  }, []);

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

  // ─── Projector View ───────────────────────────────────────────────────────
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

  // ─── Main UI ──────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-surface-base text-white overflow-hidden">
      {/* Sidebar — navigation landmark */}
      <nav
        aria-label={t('nav.sidebarLabel')}
        className="w-[72px] flex-shrink-0 bg-surface border-r border-white/10 flex flex-col items-center py-3 gap-1"
      >
        {SIDEBAR_TABS.map(({ id, icon: Icon, titleKey }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as any)}
            title={t(titleKey)}
            aria-label={t(titleKey)}
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
              {t(titleKey)}
            </span>
          </button>
        ))}
      </nav>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <Toolbar
          moveSelectedSlides={moveSelectedSlides}
          deleteSelectedSlides={deleteSelectedSlides}
          duplicateSelectedSlides={duplicateSelectedSlides}
          openLive={openLive}
          closeLive={closeLive}
          openOutput={openOutput}
          closeOutput={closeOutput}
        />

        <main id="main-content" className="flex-1 overflow-hidden">
          {/* Screen-reader-only page title — provides h1 for every tab view */}
          <h1 className="sr-only">
            {t(SIDEBAR_TABS.find(tab => tab.id === activeTab)?.titleKey ?? 'nav.slides')}
          </h1>
          {activeTab === 'presentations' && (
            <div className="h-full gp-slide-enter">
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
            </div>
          )}

          {activeTab === 'slides' && (
            <div className="h-full gp-slide-enter">
              <div className="h-full flex flex-col lg:flex-row">
              <div className="flex-1 min-w-0 overflow-hidden">
                <SlideGrid
                  addSlide={addSlide}
                  reorderSlides={reorderSlides}
                  handleSlideClick={handleSlideClick}
                  handleSlideDoubleClick={handleSlideDoubleClick}
                />
              </div>

              {isSttPanelOpen && (
                <div className="w-[340px] max-w-[85vw] flex-shrink-0 border-l border-white/10">
                  <SttPanel
                    onAddCaptionsSlide={() => handleAddCaptionsSlide(true)}
                    onAddUtteranceSlide={handleSttUtteranceToSlide}
                    onOpenSettings={() => {
                      setIsSttPanelOpen(false);
                      setActiveTab('settings');
                    }}
                    onStart={sttStart}
                    onStop={sttStop}
                    onStartShare={startShare}
                    onStopShare={stopShare}
                  />
                </div>
              )}

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
            </div>
          )}

          {activeTab === 'bible' && (
            <div className="h-full gp-slide-enter">
              <ScriptureBrowser onSendToLive={handleSendToLive} />
            </div>
          )}
          {activeTab === 'media' && (
            <div className="h-full gp-slide-enter">
              <MediaLoopTab
                onAddMediaToPresentation={handleMediaAdd}
                onAddAllMediaToPresentation={handleAddAllMedia}
                onAddLoopToPresentation={handleAddLoopToPresentation}
              />
            </div>
          )}
          {activeTab === 'hymns' && (
            <div className="h-full gp-slide-enter">
              <HymnsTab onAddHymnToPresentation={handleHymnAdd} />
            </div>
          )}
          {activeTab === 'countdown' && (
            <div className="h-full gp-slide-enter">
              <CountdownTab onAddCountdownToPresentation={handleAddCountdownToPresentation} />
            </div>
          )}
          {activeTab === 'screen' && (
            <div className="h-full gp-slide-enter">
              <ScreenCaptureTab onAddScreenToPresentation={handleScreenAdd} />
            </div>
          )}
          {activeTab === 'calendar' && (
            <div className="h-full gp-slide-enter">
              <CalendarTab
                savedPresentationNames={savedPresentationNames}
                onOpenPresentation={openSavedPresentationByName}
              />
            </div>
          )}
          {activeTab === 'settings' && (
            <div className="h-full gp-slide-enter">
              <SettingsTab />
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

      {/* Updates Modal */}
      <UpdatesModal />

      {/* Remote Control Modal */}
      <RemoteControlModal />

      {/* Undo/Redo Toast */}
      <Toast />
    </div>
  );
}
