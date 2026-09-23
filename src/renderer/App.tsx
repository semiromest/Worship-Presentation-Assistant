import { lazy, Suspense, useEffect, useMemo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as m from 'motion/react-m';
import {
  Layers,
  Layout,
  BookOpen,
  Image as ImageIcon,
  Music,
  Timer,
  Monitor,
  Calendar,
  PanelRightOpen,
  Settings,
} from 'lucide-react';

import SlideEditor from './SlideEditor';
import StageDisplay from './components/StageDisplay';
import { AnimatedPreview } from './AnimatedPreview';

const loadScriptureBrowser = () => import('./ScriptureBrowser');
const ScriptureBrowser = lazy(loadScriptureBrowser);
const MediaLoopTab = lazy(() => import('./MediaLoopTab'));
const CountdownTab = lazy(() => import('./CountdownTab'));
const ScreenCaptureTab = lazy(() => import('./ScreenCaptureTab'));
const CalendarTab = lazy(() => import('./CalendarTab'));
const PresentationsTab = lazy(() => import('./PresentationsTab'));
const HymnsTab = lazy(() => import('./HymnsTab'));
const SettingsTab = lazy(() => import('./components/SettingsTab'));

import { IS_PROJECTOR_MODE, DEFAULT__TRANSITION } from './constants';
import { cn } from './utils';
import { initSfx } from './sfx';
import { uiMotion } from './uiMotion';
import { useUiMotionEnabled } from './hooks/useUiMotionEnabled';

// State & Hooks
import { useStore } from './state/useStore';
import { useRemoteControl } from './state/useRemoteControl';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { useProjectorSync } from './hooks/useProjectorSync';
import { useLiveScreenShare } from './hooks/useLiveScreenShare';
import { useScreenShare } from './hooks/useScreenShare';
import { useLiveSave, getLiveSaveRetention } from './hooks/useLiveSave';
import { useSlideOperations } from './hooks/useSlideOperations';
import { useStt } from './hooks/useStt';
import { useSttSlideTracker } from './hooks/useSttSlideTracker';
import { useShare } from './hooks/useShare';
import { useSttStore } from './state/useSttStore';
import { initUpdaterSync } from './state/useUpdaterStore';

// Components
import Toolbar from './components/Toolbar';
import SlideGrid from './components/SlideGrid';
import RightPanel from './components/RightPanel';
import CheatsheetModal from './components/CheatsheetModal';
import PreparationCheckModal from './components/PreparationCheckModal';
import UpdatesModal from './components/UpdatesModal';
import RemoteControlModal from './components/RemoteControlModal';
import LiveShareModal from './components/LiveShareModal';
import LiveCaptionsConsole from './components/LiveCaptionsConsole';
import LiveCaptionsSessionBar from './components/LiveCaptionsSessionBar';
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
  // Live-screen phone viewers: while a broadcast is active, streams JPEG frames
  // of the CURRENT LIVE SLIDE (the one “Canlı Yayın” sends to the projector) to
  // connected phones. No-ops in the projector window.
  useLiveScreenShare();
  const { startShare: startScreenShare, stopShare: stopScreenShare } = useScreenShare();

  // Field-level selectors: subscribing to the whole store re-rendered App on
  // every state change (toast, search, liveIndex, …). Each selector returns a
  // stable reference, so re-renders are limited to actual field changes.
  const presentation = useStore((s) => s.presentation);
  const selectedSlideId = useStore((s) => s.selectedSlideId);
  const liveIndex = useStore((s) => s.liveIndex);
  const instantTransition = useStore((s) => s.instantTransition);
  const setInstantTransition = useStore((s) => s.setInstantTransition);
  const projectorReady = useStore((s) => s.projectorReady);
  const isProjectorWindowOpen = useStore((s) => s.isProjectorWindowOpen);
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
  const outputMode = useStore((s) => s.outputMode);
  const uiMotionEnabled = useUiMotionEnabled();
  const [shouldMountBible, setShouldMountBible] = useState(false);
  // Live captions session (mic on / connecting / connected). Read at App level
  // only for layout decisions; the console and session bar subscribe to text.
  const sttSessionActive = useSttStore((s) => s.micActive || s.status !== 'idle');

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
    handleQrSlideAdd,
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

  // Puts captions on the screen right now: jumps to the deck's existing
  // captions slide (respecting whether a broadcast is open) or adds + goes
  // live with a fresh one when the deck has none.
  const sendCaptionsLive = useCallback(() => {
    const idx = presentation.slides.findIndex((s) => s.type === 'captions');
    if (idx === -1) {
      handleAddCaptionsSlide(true);
      return;
    }
    const id = presentation.slides[idx].id;
    if (isProjectorWindowOpen) handleSlideClick(id, idx);
    else handleSlideDoubleClick(id, idx);
  }, [presentation, isProjectorWindowOpen, handleAddCaptionsSlide, handleSlideClick, handleSlideDoubleClick]);

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
  const captionsOnAir = liveSlide?.type === 'captions';
  // Slide used for the WYSIWYG captions monitor: the live captions slide when
  // one is on air, otherwise the deck's captions slide (styling preview).
  const captionsPreviewSlide = useMemo(() => {
    if (captionsOnAir) return liveSlide;
    for (let i = presentation.slides.length - 1; i >= 0; i--) {
      const s = presentation.slides[i];
      if (s.type === 'captions') return s;
    }
    return undefined;
  }, [presentation.slides, liveSlide, captionsOnAir]);

  const SIDEBAR_TABS = useMemo(
    () =>
      [
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
  useEffect(() => {
    initUpdaterSync();
  }, []);

  // ─── UI sound effects (uisfx) ─────────────────────────────────────────────
  // Only the control window plays sounds; the fullscreen projector window
  // stays silent. No AudioContext is created until the first interaction.
  useEffect(() => {
    if (IS_PROJECTOR_MODE) return;
    initSfx();
  }, []);

  // Warm the Bible screen after the app shell becomes idle. Its code and saved
  // data are then ready before the first click, while the visible startup work
  // remains the priority. Once mounted, keep it alive to preserve navigation
  // state and avoid reloading the full Bible on every tab switch.
  useEffect(() => {
    if (IS_PROJECTOR_MODE || shouldMountBible) return;

    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;
    const warmBible = () => {
      void loadScriptureBrowser().then(() => setShouldMountBible(true));
    };

    if (activeTab === 'bible') {
      warmBible();
    } else if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(warmBible, { timeout: 2000 });
    } else {
      timeoutHandle = window.setTimeout(warmBible, 800);
    }

    return () => {
      if (idleHandle != null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle != null) window.clearTimeout(timeoutHandle);
    };
  }, [activeTab, shouldMountBible]);

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

    // Stage display (confidence monitor): shows current + next slide text,
    // a live clock and elapsed time — instead of the styled projector view.
    if (outputMode === 'stage') {
      return <StageDisplay />;
    }

    return (
      <div
        className="fixed inset-0 flex items-center justify-center overflow-hidden bg-black"
        style={{
          backgroundColor: liveSlide?.type === 'text' ? (liveSlide.styles?.backgroundColor ?? '#000') : '#000',
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
              'relative isolate overflow-hidden w-[60px] min-h-[52px] flex flex-col items-center justify-center gap-1 rounded-xl transition-[color,box-shadow] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none px-1 active:scale-[0.96]',
              activeTab === id
                ? 'text-white shadow-lg shadow-blue-900/40'
                : 'text-white/60 hover:bg-white/5 hover:text-white'
            )}
          >
            {activeTab === id && (
              <m.span
                layoutId="active-sidebar-tab"
                className="absolute inset-0 -z-10 rounded-xl bg-blue-600"
                transition={{ duration: uiMotionEnabled ? uiMotion.duration.standard : 0, ease: uiMotion.ease }}
              />
            )}
            <Icon className="relative z-10 w-5 h-5 shrink-0" aria-hidden="true" />
            <span className="relative z-10 text-[10px] font-semibold leading-tight text-white/65 max-w-[56px] truncate text-center text-balance">
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
          <h1 className="sr-only">{t(SIDEBAR_TABS.find((tab) => tab.id === activeTab)?.titleKey ?? 'nav.slides')}</h1>
            {activeTab !== 'bible' && <m.div
              key={activeTab}
              className="h-full"
              initial={uiMotionEnabled ? { opacity: 0, y: uiMotion.distance } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={uiMotionEnabled ? { opacity: 0, y: -4 } : { opacity: 1, y: 0 }}
              transition={{ duration: uiMotionEnabled ? uiMotion.duration.standard : 0, ease: uiMotion.ease }}
            >
            <Suspense
              fallback={
                <div className="h-full grid place-items-center text-sm text-white/50" role="status">
                  {t('common.loading')}
                </div>
              }
            >
          {activeTab === 'presentations' && (
            <div className="h-full">
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
            <div className="h-full">
              <div className="h-full flex flex-col lg:flex-row">
                <div className="flex-1 min-w-0 overflow-hidden">
                  <SlideGrid
                    addSlide={addSlide}
                    reorderSlides={reorderSlides}
                    handleSlideClick={handleSlideClick}
                    handleSlideDoubleClick={handleSlideDoubleClick}
                  />
                </div>

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
                <button
                  data-testid="right-panel-opener"
                  onClick={() => setIsRightPanelOpen(true)}
                  tabIndex={isRightPanelOpen ? -1 : 0}
                  aria-hidden={isRightPanelOpen}
                  className={cn(
                    'hidden lg:flex items-center justify-center flex-shrink-0 overflow-hidden',
                    'border-l border-white/10 bg-surface hover:bg-surface-raised cursor-pointer group',
                    'transition-[width,opacity,background-color,border-color] duration-200 ease-out',
                    isRightPanelOpen
                      ? 'w-0 opacity-0 border-transparent pointer-events-none'
                      : 'w-6 opacity-100 delay-150',
                  )}
                  title={t('common.panelOpen')}
                  aria-label={t('common.panelOpen')}
                >
                  <PanelRightOpen className="w-4 h-4 shrink-0 text-white/40 group-hover:text-white/70 transition-colors" />
                </button>
              </div>
            </div>
          )}

          {activeTab === 'media' && (
            <div className="h-full">
              <MediaLoopTab
                onAddMediaToPresentation={handleMediaAdd}
                onAddAllMediaToPresentation={handleAddAllMedia}
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
          {activeTab === 'settings' && (
            <div className="h-full">
              <SettingsTab />
            </div>
          )}
            </Suspense>
            </m.div>}
            {(shouldMountBible || activeTab === 'bible') && (
              <Suspense
                fallback={
                  activeTab === 'bible' ? (
                    <div className="h-full grid place-items-center text-sm text-white/50" role="status">
                      {t('common.loading')}
                    </div>
                  ) : null
                }
              >
                <div className={activeTab === 'bible' ? 'h-full' : 'hidden'} aria-hidden={activeTab !== 'bible'}>
                  <ScriptureBrowser active={activeTab === 'bible'} onSendToLive={handleSendToLive} />
                </div>
              </Suspense>
            )}
        </main>

        {/* Live captions: bottom-docked console / persistent session bar (any tab) */}
        {isSttPanelOpen ? (
          <div className="h-[440px] shrink-0 min-h-0 border-t border-white/10">
            <LiveCaptionsConsole
              captionsSlide={captionsPreviewSlide}
              captionsOnAir={captionsOnAir}
              onSendCaptionsLive={sendCaptionsLive}
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
              onAddQrSlide={handleQrSlideAdd}
              onClose={() => setIsSttPanelOpen(false)}
            />
          </div>
        ) : sttSessionActive ? (
          <LiveCaptionsSessionBar onStop={sttStop} onExpand={() => setIsSttPanelOpen(true)} />
        ) : null}
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

      {/* Preparation Check Modal */}
      <PreparationCheckModal />

      {/* Updates Modal */}
      <UpdatesModal />

      {/* Remote Control Modal */}
      <RemoteControlModal />

      {/* Phone viewers (live-slide broadcast) */}
      <LiveShareModal onStartShare={startScreenShare} onStopShare={stopScreenShare} onAddQrSlide={handleQrSlideAdd} />

      {/* Undo/Redo Toast */}
      <Toast />
    </div>
  );
}
