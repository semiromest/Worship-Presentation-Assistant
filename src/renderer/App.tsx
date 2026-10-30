import { resolveCanvasSource } from './canvasSource';
import ControlTooltip from './components/ControlTooltip';
import { lazy, Suspense, useEffect, useMemo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as m from 'motion/react-m';
import { AnimatePresence } from 'motion/react';
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
  Paintbrush,
  Loader2,
} from 'lucide-react';

const SlideEditor = lazy(() => import('./SlideEditor'));
import { ChoiceDialogHost } from './choiceDialogs';
import { mergeEditorCommit } from './editor/editorConflicts';
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
import { initSfx, playSfx } from './sfx';
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
import { usePreparationCheck } from './hooks/usePreparationCheck';
import { useSttSlideTracker } from './hooks/useSttSlideTracker';
import { useShare } from './hooks/useShare';
import { useSttStore } from './state/useSttStore';
import { initUpdaterSync, useUpdaterStore } from './state/useUpdaterStore';

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
import DesktopHost from './components/DesktopHost';
import { usePractice } from './hooks/usePractice';
import PptxImportWarnings from './components/PptxImportWarnings';

import { registerTourAnchor, notifyPageVisit } from './components/Tour/tourController';

type Operations = ReturnType<typeof useSlideOperations>;
type AppCommands = ReturnType<typeof useRemoteControl> & {
  sttStart: ReturnType<typeof useStt>['start'];
  sttStop: ReturnType<typeof useStt>['stop'];
  startShare: () => Promise<void>;
  stopShare: () => Promise<void>;
  startScreenShare: ReturnType<typeof useScreenShare>['startShare'];
  stopScreenShare: ReturnType<typeof useScreenShare>['stopShare'];
};

export default function App() {
  const practice = usePractice();
  const remote = useRemoteControl();
  const { start: sttStart, stop: sttStop } = useStt();
  const { startShare, stopShare } = useShare();
  const { startShare: startScreenShare, stopShare: stopScreenShare } = useScreenShare();
  const commands = { ...remote, sttStart, sttStop, startShare, stopShare, startScreenShare, stopScreenShare };
  return <><RuntimeSync />{IS_PROJECTOR_MODE ? <ProjectorView /> : <><ControlApp commands={commands} />{!practice && <DesktopHost />}</>}</>;
}

/** Reactive bridges have their own render boundary; no visual children. */
function RuntimeSync() {
  useProjectorSync();
  usePreparationCheck();
  useLiveSave();
  useSttSlideTracker();
  useLiveScreenShare();
  const { i18n } = useTranslation();
  // ─── Sync html lang with i18n ────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.lang = i18n.language?.split('-')[0] ?? 'tr';
  }, [i18n.language]);

  useEffect(() => {
    let alive = true;

    const hydratePresets = async () => {
      const loaded = await window.electronAPI?.loadPresets?.(getLiveSaveRetention());
      if (!alive || !Array.isArray(loaded)) return;
      useStore.getState().setPresets(loaded);
    };

    void hydratePresets();
    return () => {
      alive = false;
    };
  }, []);

  // ─── Updater sync (preload events → store) ────────────────────────────────
  useEffect(() => {
    initUpdaterSync();
  }, []);

  const instantTransition = useStore(s => s.instantTransition);
  useEffect(() => {
    if (!instantTransition) return;
    const id = setTimeout(() => useStore.getState().setInstantTransition(false), 0);
    return () => clearTimeout(id);
  }, [instantTransition]);
  return null;
}

function ControlApp({ commands }: { commands: AppCommands }) {
  const [pptxWarnings, setPptxWarnings] = useState<string[]>([]);
  const [pptxImporting, setPptxImporting] = useState(false);
  const { t } = useTranslation();
  const { openLive, closeLive, openOutput, closeOutput, startScreenShare, stopScreenShare } = commands;
  // Layout-only subscriptions. Deck and live state belong to local connectors.
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const stylesPanelOpen = useStore(s => s.panels.styles);
  const setPanels = useStore((s) => s.setPanels);
  const editorDirty = useStore((s) => s.editorDirty);
  const [editorMounted, setEditorMounted] = useState(false);
  useEffect(() => { if (activeTab === 'editor') setEditorMounted(true); }, [activeTab]);
  const activeColorPicker = useStore((s) => s.activeColorPicker);
  const setActiveColorPicker = useStore((s) => s.setActiveColorPicker);
  const isRightPanelOpen = useStore((s) => s.isRightPanelOpen);
  const setIsRightPanelOpen = useStore((s) => s.setIsRightPanelOpen);
  const updaterStatus = useUpdaterStore((s) => s.status);
  const uiMotionEnabled = useUiMotionEnabled();
  const [shouldMountBible, setShouldMountBible] = useState(false);
  const operations = useSlideOperations();
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
    openSavedPresentationByName,
    handleSendToLive,
    handleMediaAdd,
    handleYouTubeMusicAdd,
    handleAddAllMedia,
    handleScreenAdd,
    handleQrSlideAdd,
    handleHymnAdd,
    handleAddCountdownToPresentation,
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
  } = operations;

  useKeyboardNavigation({
    onDeleteSlides: deleteSelectedSlides,
    onDuplicateSlides: duplicateSelectedSlides,
  });

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
        { id: 'editor', icon: Paintbrush, titleKey: 'nav.editor' },
        { id: 'settings', icon: Settings, titleKey: 'nav.settings' },
      ] as const,
    []
  );

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
    if (!stylesPanelOpen && !activeColorPicker) return;

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
  }, [stylesPanelOpen, activeColorPicker, setPanels, setActiveColorPicker]);

  // ─── Main UI ──────────────────────────────────────────────────────────────
  return (
    <div data-app-shell className="flex h-full bg-surface-base text-white overflow-hidden">
      {/* Sidebar — navigation landmark */}
      <nav ref={element => registerTourAnchor('sidebar', element)}
        aria-label={t('nav.sidebarLabel')}
        className="w-[72px] flex-shrink-0 overflow-y-auto overflow-x-hidden bg-surface border-r border-white/10 flex flex-col items-center py-3 gap-1"
      >
        {SIDEBAR_TABS.map(({ id, icon: Icon, titleKey }) => (
          <ControlTooltip key={id} side="right"><button
            key={id}
            data-guide-anchor={`nav-${id}`}
            onClick={() => { if (activeTab !== id) playSfx('forward'); setActiveTab(id as any); notifyPageVisit(id); }}
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
            {id === 'editor' && editorDirty && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-amber-400" aria-label={t('common.editorPendingDraft')} />}
            {id === 'settings' && (updaterStatus === 'available' || updaterStatus === 'downloaded') && (
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-blue-400" aria-hidden="true" />
            )}
            <Icon className="relative z-10 w-5 h-5 shrink-0" aria-hidden="true" />
            <span className="relative z-10 text-[10px] font-semibold leading-tight text-white/65 max-w-[56px] truncate text-center text-balance">
              {t(titleKey)}
            </span>
          </button></ControlTooltip>
        ))}
      </nav>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <Toolbar
          moveSelectedSlides={moveSelectedSlides}
          deleteSelectedSlides={deleteSelectedSlides}
          duplicateSelectedSlides={duplicateSelectedSlides}
          addYouTubeMusicSlide={handleYouTubeMusicAdd}
          openLive={openLive}
          closeLive={closeLive}
          openOutput={openOutput}
          closeOutput={closeOutput}
        />

        <main id="main-content" className="flex-1 overflow-hidden">
          {/* Screen-reader-only page title — provides h1 for every tab view */}
          <h1 className="sr-only">{t(SIDEBAR_TABS.find((tab) => tab.id === activeTab)?.titleKey ?? 'nav.slides')}</h1>
            {activeTab !== 'bible' && activeTab !== 'editor' && <m.div
              key={activeTab}
              className="h-full"
              initial={uiMotionEnabled ? { opacity: 0, y: uiMotion.distance } : false}
              animate={{ opacity: 1, y: 0 }}
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
            <div ref={element => registerTourAnchor('page-presentations', element)} className="h-full">
              <PresentationLibrary operations={operations} onImportWarnings={setPptxWarnings} onImportingChange={setPptxImporting} />
            </div>
          )}

          {activeTab === 'slides' && (
            <div ref={element => { registerTourAnchor('slides', element); registerTourAnchor('page-slides', element); }} className="h-full">
              <div className="h-full flex flex-col lg:flex-row">
                <div className="flex-1 min-w-0 overflow-hidden">
                  <SlideGrid
                    updateTransition={updateTransition}
                    moveSelectedSlides={moveSelectedSlides}
                    deleteSelectedSlides={deleteSelectedSlides}
                    duplicateSelectedSlides={duplicateSelectedSlides}
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
                    replaceSlideMedia={replaceSlideMedia}
                    removeSlideMedia={removeSlideMedia}
                    updateLoopItems={updateLoopItems}
                    updateSlideProperty={updateSlideProperty}
                />
                <ControlTooltip><button
                  data-testid="right-panel-opener"
                  onClick={() => { setIsRightPanelOpen(true); playSfx('open'); }}
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
                </button></ControlTooltip>
              </div>
            </div>
          )}

          {activeTab === 'media' && (
            <div ref={element => registerTourAnchor('page-media', element)} className="h-full">
              <MediaLoopTab
                onAddMediaToPresentation={handleMediaAdd}
                onAddAllMediaToPresentation={handleAddAllMedia}
                onAddLoopToPresentation={handleAddLoopToPresentation}
              />
            </div>
          )}
          {activeTab === 'hymns' && (
            <div ref={element => registerTourAnchor('page-hymns', element)} className="h-full">
              <HymnsTab onAddHymnToPresentation={handleHymnAdd} />
            </div>
          )}
          {activeTab === 'countdown' && (
            <div ref={element => registerTourAnchor('page-countdown', element)} className="h-full">
              <CountdownTab onAddCountdownToPresentation={handleAddCountdownToPresentation} />
            </div>
          )}
          {activeTab === 'screen' && (
            <div ref={element => registerTourAnchor('page-screen', element)} className="h-full">
              <ScreenCaptureTab onAddScreenToPresentation={handleScreenAdd} />
            </div>
          )}
          {activeTab === 'calendar' && (
            <div ref={element => registerTourAnchor('page-calendar', element)} className="h-full">
              <CalendarConnection onOpenPresentation={openSavedPresentationByName} />
            </div>
          )}
          {activeTab === 'settings' && (
            <div ref={element => registerTourAnchor('page-settings', element)} className="h-full">
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
                <div ref={element => registerTourAnchor('page-bible', element)} className={activeTab === 'bible' ? 'ui-fade-enter h-full' : 'hidden'} aria-hidden={activeTab !== 'bible'}>
                  <ScriptureBrowser active={activeTab === 'bible'} onSendToLive={handleSendToLive} />
                </div>
              </Suspense>
            )}
          {(editorMounted || activeTab === 'editor') && (
            <div ref={element => registerTourAnchor('page-editor', element)} className={activeTab === 'editor' ? 'ui-fade-enter h-full' : 'hidden'} aria-hidden={activeTab !== 'editor'}>
              <Suspense fallback={<div role="status" className="flex h-full items-center justify-center text-white/50">{t('common.loading')}</div>}>
                <EditorConnection active={activeTab === 'editor'} />
              </Suspense>
            </div>
          )}
        </main>

        <CaptionsDock operations={operations} commands={commands} />
      </div>


      <ChoiceDialogHost />

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
      {pptxImporting && (
        <div role="status" aria-live="polite" data-testid="pptx-import-status"
          className="pointer-events-none fixed bottom-6 left-1/2 z-[90] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl border border-blue-400/50 bg-surface-raised px-5 py-4 text-sm font-medium text-white shadow-xl">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin motion-reduce:animate-none text-blue-400" aria-hidden="true" />
          <span>PowerPoint · {t('common.importing')}</span>
        </div>
      )}
      <PptxImportWarnings warnings={pptxWarnings} onClose={() => setPptxWarnings([])} />
    </div>
  );
}

function ProjectorView() {
  // Keep the focused output window's existing keyboard behavior (including
  // local mute/Enter); moving the visual branch must not remove its listener.
  const { deleteSelectedSlides, duplicateSelectedSlides } = useSlideOperations();
  useKeyboardNavigation({ onDeleteSlides: deleteSelectedSlides, onDuplicateSlides: duplicateSelectedSlides });
  const liveSlide = useStore(s => s.presentation.slides[s.liveIndex] ?? s.presentation.slides[0]);
  const transition = useStore(s => s.presentation.transition);
  const instantTransition = useStore(s => s.instantTransition);
  const transitionType = instantTransition ? 'none' : transition?.type ?? DEFAULT__TRANSITION.type;
  const transitionDuration = instantTransition ? 0 : transition?.duration ?? DEFAULT__TRANSITION.duration;
  const projectorReady = useStore(s => s.projectorReady);
  const isBlackout = useStore(s => s.isBlackout);
  const mediaVolume = useStore(s => s.mediaVolume);
  const isMediaMuted = useStore(s => s.isMediaMuted);
  const outputMode = useStore(s => s.outputMode);
  if (!projectorReady) {
    return <div className="fixed inset-0 bg-black" data-projector-loading />;
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
            ? `url(${resolveCanvasSource(liveSlide.styles.backgroundImage, false).url})`
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

function PresentationLibrary({ operations, onImportWarnings, onImportingChange }: { operations: Operations; onImportWarnings: (warnings: string[]) => void; onImportingChange: (importing: boolean) => void }) {
  const presentation = useStore(s => s.presentation);
  const presets = useStore(s => s.presets);
  const selectedPresetName = useStore(s => s.selectedPresetName);
  const { setPresets, setSelectedPresetName } = useStore.getState();
  const { applyPreset, openPresentation, savePresentation, importPptxPresentation, createNewPresentation } = operations;
  return <PresentationsTab
    presentation={presentation} presets={presets} selectedPresetName={selectedPresetName}
    onPresetsChange={setPresets} onApplyPreset={applyPreset} onSelectedPresetNameChange={setSelectedPresetName}
    onOpenFile={openPresentation} onSaveFile={savePresentation} onImportPptx={importPptxPresentation} onImportWarnings={onImportWarnings} onImportingChange={onImportingChange}
    onNewPresentation={createNewPresentation} />;
}

function CalendarConnection({ onOpenPresentation }: { onOpenPresentation: Operations['openSavedPresentationByName'] }) {
  const presets = useStore(s => s.presets);
  const savedPresentationNames = useMemo(() => presets.filter(p => !p.name.startsWith('__live_autosave_')).map(p => p.name), [presets]);
  return <CalendarTab savedPresentationNames={savedPresentationNames} onOpenPresentation={onOpenPresentation} />;
}

function EditorConnection({ active }: { active: boolean }) {
  const presentation = useStore(s => s.presentation);
  const selectedSlide = useStore(s => s.presentation.slides.find(slide => slide.id === s.selectedSlideId) ?? s.presentation.slides[0]);
  const editorSessionVersion = useStore(s => s.editorSessionVersion);
  const setActiveTab = useStore(s => s.setActiveTab);
  const save = useCallback((editedSlides: Parameters<NonNullable<React.ComponentProps<typeof SlideEditor>['onSave']>>[0]) => {
    const current = useStore.getState();
    if (editedSlides.length) current.dispatchUndo({ type: 'SET', payload: mergeEditorCommit(current.presentation, editedSlides) });
  }, []);
  const openInSlides = useCallback((slideId: string) => {
    const current = useStore.getState();
    current.selectSlides({ activeId: slideId, ids: new Set([slideId]) });
    current.setIsRightPanelOpen(true);
    current.setActiveTab('slides');
  }, []);
  const close = useCallback(() => setActiveTab('slides'), [setActiveTab]);
  return <SlideEditor key={editorSessionVersion} active={active} slide={selectedSlide} deck={presentation}
    onSave={save} onOpenInSlides={openInSlides} onClose={close} />;
}

function CaptionsDock({ operations, commands }: { operations: Operations; commands: AppCommands }) {
  const presentation = useStore(s => s.presentation);
  const liveSlide = useStore(s => s.presentation.slides[s.liveIndex] ?? s.presentation.slides[0]);
  const isSttPanelOpen = useStore(s => s.isSttPanelOpen);
  const { setIsSttPanelOpen, setActiveTab } = useStore.getState();
  const uiMotionEnabled = useUiMotionEnabled();
  const sttSessionActive = useSttStore(s => s.micActive || s.status !== 'idle');
  const { sttStart, sttStop, startShare, stopShare } = commands;
  const { handleAddCaptionsSlide, handleSttUtteranceToSlide, handleQrSlideAdd, handleSlideClick, handleSlideDoubleClick } = operations;
  const captionsOnAir = liveSlide?.type === 'captions';
  const captionsPreviewSlide = useMemo(() => {
    if (captionsOnAir) return liveSlide;
    for (let i = presentation.slides.length - 1; i >= 0; i--) {
      if (presentation.slides[i].type === 'captions') return presentation.slides[i];
    }
    return undefined;
  }, [presentation.slides, liveSlide, captionsOnAir]);
  const sendCaptionsLive = useCallback(() => {
    const state = useStore.getState();
    const idx = state.presentation.slides.findIndex(slide => slide.type === 'captions');
    if (idx === -1) { handleAddCaptionsSlide(true); return; }
    const id = state.presentation.slides[idx].id;
    if (state.isProjectorWindowOpen) handleSlideClick(id, idx);
    else handleSlideDoubleClick(id, idx);
  }, [handleAddCaptionsSlide, handleSlideClick, handleSlideDoubleClick]);
  return (<>
        {/* Live captions: bottom-docked console / persistent session bar (any tab) */}
        <AnimatePresence initial={false} mode="wait">
          {isSttPanelOpen ? (
            <m.div
              key="stt-console"
              className="shrink-0 min-h-0 overflow-hidden"
              initial={uiMotionEnabled ? { height: 0, opacity: 0 } : false}
              animate={{ height: 440, opacity: 1 }}
              exit={uiMotionEnabled ? { height: 0, opacity: 0 } : { opacity: 1 }}
              transition={{ duration: uiMotionEnabled ? uiMotion.duration.standard : 0, ease: uiMotion.ease }}
            >
              <div className="h-[440px] border-t border-white/10">
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
            </m.div>
          ) : sttSessionActive ? (
            <LiveCaptionsSessionBar
              key="stt-session-bar"
              onStop={sttStop}
              onExpand={() => setIsSttPanelOpen(true)}
            />
          ) : null}
        </AnimatePresence>
  </>);
}
