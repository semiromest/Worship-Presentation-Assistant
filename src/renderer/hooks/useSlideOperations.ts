import { restoreLiveSession } from '../liveSession';
import { moveSectionSlidesOneStep, dropSlidesOnSlide } from '../../shared/sectionModel';
import { useShallow } from 'zustand/react/shallow';
import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../state/useStore';
import type { Slide, Preset, TransitionType, LoopItem } from '../types';
import { backgroundPatch, inheritGeneratedBackgrounds } from '../gradientBackground';
import { DEFAULT_STYLES, DEFAULT__TRANSITION } from '../constants';
import { makeSlideId, toFileUrl, convertPptxToSlides, type PptxImportResult } from '../utils';
import type { PptxImportMode } from '../../shared/fileOpen';
import { guardEditorReplacement } from '../editor/editorSessionGuard';
import { confirmDialog, alertDialog } from '../dialogs';
import { findPresetByRef } from '../presetUtils';
import { isLiveSavePreset, getLiveSaveRetention } from './useLiveSave';
import { parseCountdownContent, serializeCountdownContent, CountdownSlideData } from '../countdownUtils';
import { splitHymnLyrics } from '../hymnSplit';
import { findLockedSlideIndex } from '../slideLock';
import { playSfx } from '../sfx';
import { isYouTubeMusicResult, type YouTubeMusicResult } from '../../shared/youtubeMusic';
import { musicGain } from '../musicCustomization';
import { documentSession, documentSignature } from '../documentSession';
import { usePractice } from './usePractice';

export const createSlide = (type: Slide['type'], overrides: Partial<Slide> = {}): Slide => ({
  id: makeSlideId(),
  type,
  content: '',
  ...overrides,
  styles: { ...(overrides.styles ?? DEFAULT_STYLES), backgroundExplicit: overrides.styles?.backgroundExplicit ??
    !!(overrides.styles?.backgroundColor || overrides.styles?.backgroundImage || overrides.styles?.backgroundVideo || overrides.styles?.backgroundGradient) },
});

const HYMN_COLORS = [
  '#e11d48', '#ea580c', '#d97706', '#65a30d', '#16a34a',
  '#0891b2', '#0284c7', '#6366f1', '#8b5cf6', '#db2777',
];

function getHymnColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return HYMN_COLORS[Math.abs(hash) % HYMN_COLORS.length];
}

export function useSlideOperations() {
  const practice = usePractice();
  // Subscribe only to stable actions. Each command snapshots the relevant
  // domain state when invoked, so selection/editing doesn't invalidate every
  // callback passed to memoized cards and kept-alive feature screens.
  // Native double-click includes two clicks: reuse the first selection cue.
  const firstClickCued = useRef(false);
  const { t } = useTranslation();
  const {
    setLiveSlideId,
    dispatchUndo,
    setSelectedSlideId,
    setSelectedSlideIds,
    setLastSelectedIndex,
    setLiveIndex,
    setIsBlackout,
    setActiveTab,
    setPanels,
    setSelectedPresetName,
    setPresets,
    setPresentationName,
    setSlideZoom,
  } = useStore(useShallow((s) => ({
    setLiveSlideId: s.setLiveSlideId,
    dispatchUndo: s.dispatchUndo,
    setSelectedSlideId: s.setSelectedSlideId,
    setSelectedSlideIds: s.setSelectedSlideIds,
    setLastSelectedIndex: s.setLastSelectedIndex,
    setLiveIndex: s.setLiveIndex,
    setIsBlackout: s.setIsBlackout,
    setActiveTab: s.setActiveTab,
    setPanels: s.setPanels,
    setSelectedPresetName: s.setSelectedPresetName,
    setPresets: s.setPresets,
    setPresentationName: s.setPresentationName,
    setSlideZoom: s.setSlideZoom,
  })));

  const addSlide = useCallback(() => {
    const { presentation } = useStore.getState();
    const newSlide = createSlide('text', { content: t('common.newSlideContent'), sectionId: presentation.slides.at(-1)?.sectionId });
    dispatchUndo({
      type: 'SET',
      payload: {
        ...presentation,
        slides: [...presentation.slides, newSlide],
      },
    });
    setSelectedSlideId(newSlide.id);
    playSfx('success');
  }, [t, dispatchUndo, setSelectedSlideId]);

  const removeSlide = useCallback((id: string) => {
    const state = useStore.getState();
    const { presentation, selectedSlideId, selectedSlideIds } = state;
    if (presentation.slides.length <= 1) return;
    // A locked slide is pinned to the live output — removing it would leave
    // the broadcast dangling, so it must be unlocked first.
    const target = presentation.slides.find((s) => s.id === id);
    if (target?.locked) return;
    const slides = presentation.slides.filter((s) => s.id !== id);
    dispatchUndo({
      type: 'SET',
      payload: { ...presentation, slides },
    });
    const ids = new Set([...selectedSlideIds].filter(selectedId => selectedId !== id));
    if (selectedSlideId === id) {
      const anchorIndex = Math.min(presentation.slides.findIndex(s => s.id === id), slides.length - 1);
      const activeId = slides[anchorIndex].id;
      ids.add(activeId);
      state.selectSlides({ activeId, ids, anchorIndex });
    } else if (selectedSlideIds.has(id)) {
      state.setSelectedSlideIds(ids);
    }
    playSfx('delete');
  }, [dispatchUndo]);

  const moveSelectedSlide = useCallback((direction: -1 | 1) => {
    const { presentation, selectedSlideId } = useStore.getState();
    const state = useStore.getState();
    if (state.serviceSectionsEnabled && (state.searchQuery.trim() || state.sectionFilterId)) return;
    const idx = presentation.slides.findIndex((s) => s.id === selectedSlideId);
    if (idx === -1) return;

    const target = idx + direction;
    if (target < 0 || target >= presentation.slides.length) return;

    dispatchUndo({ type: 'SET', payload: moveSectionSlidesOneStep(presentation, new Set([selectedSlideId]), direction) });
    playSfx('reorder');
  }, [dispatchUndo]);

  const reorderSlides = useCallback((fromIndex: number, toIndex: number) => {
    const { presentation } = useStore.getState();
    const state = useStore.getState();
    if (state.serviceSectionsEnabled && (state.searchQuery.trim() || state.sectionFilterId)) return;
    if (fromIndex === toIndex) return;
    const moved = presentation.slides[fromIndex];
    const target = presentation.slides[toIndex];
    if (!moved || !target) return;
    const selected = state.selectedSlideIds.has(moved.id) ? state.selectedSlideIds : new Set([moved.id]);
    const next = dropSlidesOnSlide(presentation, selected, target.id);
    if (next === presentation) return;
    dispatchUndo({ type: 'SET', payload: next });
    const activeId = selected.has(state.selectedSlideId) ? state.selectedSlideId : moved.id;
    state.selectSlides({ activeId, ids: new Set(selected), anchorIndex: next.slides.findIndex(s => s.id === activeId) });
    playSfx('reorder');
  }, [dispatchUndo]);

  const updateSlideContent = useCallback((content: string) => {
    const { selectedSlideIds, selectedSlideId } = useStore.getState();
    const targetIds = selectedSlideIds.size > 0 ? selectedSlideIds : new Set([selectedSlideId]);
    dispatchUndo({ type: 'EDIT_SLIDES', ids: [...targetIds], edit: { kind: 'content', content } });
  }, [dispatchUndo]);

  const updateSlideStyles = useCallback((styles: Partial<Slide['styles']>) => {
    const { selectedSlideIds, selectedSlideId } = useStore.getState();
    const targetIds = selectedSlideIds.size > 0 ? selectedSlideIds : new Set([selectedSlideId]);
    dispatchUndo({ type: 'EDIT_SLIDES', ids: [...targetIds], edit: { kind: 'styles', styles: styles ?? {} } });
  }, [dispatchUndo]);

  const patchSelectedCountdown = useCallback((mutate: (data: CountdownSlideData) => CountdownSlideData) => {
    const { presentation, selectedSlideId } = useStore.getState();
    dispatchUndo({
      type: 'SET',
      payload: {
        ...presentation,
        slides: presentation.slides.map((s) => {
          if (s.id !== selectedSlideId || s.type !== 'countdown') return s;
          const next = mutate(parseCountdownContent(s.content));
          return { ...s, content: serializeCountdownContent(next) };
        }),
      },
    });
  }, [dispatchUndo]);

  const updateSlideBackgroundImage = useCallback(async () => {
    const origin = useStore.getState();
    const generation = documentSession.current().generation;
    const file = await window.electronAPI?.selectMediaFile?.('image');
    if (typeof file === 'string' && file && generation === documentSession.current().generation && useStore.getState().selectedSlideId === origin.selectedSlideId) {
      updateSlideStyles({ backgroundImage: toFileUrl(file), backgroundVideo: undefined, backgroundGradient: undefined });
      playSfx('success');
    }
  }, [updateSlideStyles]);

  const removeSlideBackgroundImage = useCallback(() => {
    updateSlideStyles({ backgroundImage: undefined });
  }, [updateSlideStyles]);

  const updateSlideBackgroundVideo = useCallback(async () => {
    const origin = useStore.getState();
    const generation = documentSession.current().generation;
    const file = await window.electronAPI?.selectMediaFile?.('video');
    if (typeof file === 'string' && file && generation === documentSession.current().generation && useStore.getState().selectedSlideId === origin.selectedSlideId) {
      updateSlideStyles({ backgroundVideo: toFileUrl(file), backgroundImage: undefined, backgroundGradient: undefined });
      playSfx('success');
    }
  }, [updateSlideStyles]);

  const removeSlideBackgroundVideo = useCallback(() => {
    updateSlideStyles({ backgroundVideo: undefined });
  }, [updateSlideStyles]);

  const applyStyleFieldToAll = useCallback((pick: Partial<Slide['styles']> | 'all') => {
    const { presentation, selectedSlideId } = useStore.getState();
    const sel = presentation.slides.find((s) => s.id === selectedSlideId);
    if (!sel?.styles) return;

    let toApply: Record<string, unknown> = {};
    if (pick === 'all') {
      toApply = { ...sel.styles } as Record<string, unknown>;
    } else {
      const stylePick = pick as Partial<NonNullable<Slide['styles']>>;
      const keys = Object.keys(stylePick) as Array<keyof NonNullable<Slide['styles']>>;
      for (const key of keys) {
        const val = sel.styles[key as keyof typeof sel.styles];
        if (val !== undefined) {
          toApply[key as string] = val;
        }
      }
    }

    if (Object.keys(toApply).length === 0) return;
    if ('backgroundImage' in toApply && sel.styles.generatedBackground) {
      toApply.generatedBackground = sel.styles.generatedBackground;
    }

    if (!presentation.slides.some(slide => Object.entries(toApply).some(([key, value]) => slide.styles?.[key as keyof NonNullable<Slide['styles']>] !== value))) return;
    dispatchUndo({
      type: 'SET',
      payload: {
        ...presentation,
        slides: presentation.slides.map((s) => ({
          ...s,
          styles: {
            ...(backgroundPatch({ ...DEFAULT_STYLES, ...s.styles }, toApply) as NonNullable<Slide['styles']>),
            objectFit: s.type !== 'text'
              ? ((toApply['objectFit'] as 'fill' | 'contain' | 'cover' | undefined) ?? s.styles?.objectFit ?? 'contain')
              : undefined,
          },
        })),
      },
    });
    playSfx('success');
  }, [dispatchUndo]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const { presentation, selectedSlideId } = useStore.getState();
    if (e.key !== 'Enter' || !e.altKey) return;
    e.preventDefault();

    const ta = e.currentTarget;
    const before = ta.value.substring(0, ta.selectionStart);
    const after = ta.value.substring(ta.selectionEnd);
    const newId = makeSlideId();

    const idx = presentation.slides.findIndex((s) => s.id === selectedSlideId);
    if (idx === -1) return;

    const cur = presentation.slides[idx];
    const next = [...presentation.slides];
    next[idx] = { ...cur, content: before };
    next.splice(
      idx + 1,
      0,
      createSlide('text', {
        id: newId,
        content: after,
        styles: { ...cur.styles! },
      })
    );

    dispatchUndo({
      type: 'SET',
      payload: { ...presentation, slides: next },
    });

    setTimeout(() => setSelectedSlideId(newId), 0);
  }, [dispatchUndo, setSelectedSlideId]);

  const updateTransition = useCallback((update: Partial<{ type: TransitionType; duration: number }>) => {
    const { presentation } = useStore.getState();
    dispatchUndo({
      type: 'SET',
      payload: {
        ...presentation,
        transition: {
          type: presentation.transition?.type ?? DEFAULT__TRANSITION.type,
          duration: presentation.transition?.duration ?? DEFAULT__TRANSITION.duration,
          ...update,
        },
      },
    });
  }, [dispatchUndo]);

  const savePresentation = useCallback(async () => {
    const { presentation } = useStore.getState();
    const generation = documentSession.current().generation;
    const signature = documentSignature(presentation);
    // Zoom lives in separate UI state; re-attach it to the saved payload so
    // files keep carrying the zoom level (legacy field, read on open).
    const state = useStore.getState();
    const payload = {
      ...presentation,
      zoom: state.slideZoom,
      liveSlideId: state.liveSlideId ?? undefined,
      liveIndex: state.liveIndex,
    };
    const content = JSON.stringify(payload, null, 2);
    const path = await window.electronAPI?.saveFile?.(content);
    if (path) {
      // Saving a snapshot must never restore it over edits made while awaiting I/O.
      documentSession.saved(path, signature, generation);
      playSfx('complete');
      return true;
    }
    return false;
  }, []);

  const handleImportSlides = useCallback((slides: Slide[]) => {
    const { presentation } = useStore.getState();
    if (slides.length === 0) return;

    dispatchUndo({
      type: 'SET',
      payload: {
        ...presentation,
        slides: [...presentation.slides, ...slides],
      },
    });

    setSelectedSlideId(slides[0].id);
    setActiveTab('slides');
  }, [dispatchUndo, setSelectedSlideId, setActiveTab]);

  const guardDocumentReplacement = useCallback(async () => {
    if (!(await guardEditorReplacement())) return;
    if (!practice && documentSession.isDirty()) {
      const choice = await window.electronAPI?.desktopReplaceChoice?.();
      if (!choice || choice === 'cancel') return false;
      if (choice === 'save' && (!(await savePresentation()) || documentSession.isDirty())) return false;
    }
    return true;
  }, [practice, savePresentation]);
  const openPresentation = useCallback(async (requestId?: string, options?: { automatic?: boolean }) => {
    const outputActive = () => {
      const state = useStore.getState();
      return state.isProjectorWindowOpen || Object.values(state.outputAssignments).some(output => output.isOpen);
    };
    if (options?.automatic && (outputActive() || documentSession.isDirty())) return;
    if (typeof requestId !== 'string') requestId = undefined;
    let signature = documentSignature(useStore.getState().presentation);
    let generation = documentSession.current().generation;
    const result = await window.electronAPI?.openFile?.(requestId, requestId ? undefined : {
      title: t('fileOpen.confirmTitle'), message: t('fileOpen.confirmMessage'), detail: t('fileOpen.replaceDetail'),
      cancelLabel: t('common.cancel'), openLabel: t('fileOpen.open'),
    });
    if (!result) return;
    if (generation !== documentSession.current().generation || signature !== documentSignature(useStore.getState().presentation)) {
      await alertDialog(t('desktop.documentChanged')); return;
    }
    if (!(await guardDocumentReplacement())) return;
    // The editor guard may intentionally commit a draft before replacement.
    // Treat the approved state as our origin after checking the read race.
    signature = documentSignature(useStore.getState().presentation);
    generation = documentSession.current().generation;

    const data = JSON.parse(result.content);
    const slides: Slide[] = Array.isArray(data.slides)
      ? data.slides.map((s: any, i: number) => ({
          ...s,
          id: typeof s.id === 'string' ? s.id : `${i + 1}`,
          type: ['image', 'video', 'text', 'screen', 'countdown', 'loop', 'captions'].includes(s.type) ? s.type : 'text',
          content: typeof s.content === 'string' ? s.content : '',
          youtubeMusic: isYouTubeMusicResult(s.youtubeMusic)
            ? { id: s.youtubeMusic.id, title: s.youtubeMusic.title, duration: s.youtubeMusic.duration }
            : undefined,
          musicSettings: s.musicSettings && typeof s.musicSettings === 'object'
            ? { volume: musicGain(s.musicSettings.volume),
                ...(typeof s.musicSettings.autoPlay === 'boolean' ? { autoPlay: s.musicSettings.autoPlay } : {}),
                ...(s.musicSettings.attachment === true ? { attachment: true } : {}),
              } : undefined,
          mediaUrl: typeof s.mediaUrl === 'string' ? s.mediaUrl : undefined,
          thumbnailUrl: typeof s.thumbnailUrl === 'string' ? s.thumbnailUrl : undefined,
          loopItems: Array.isArray(s.loopItems)
            ? s.loopItems.map((li: any) => ({
                id: typeof li.id === 'string' ? li.id : crypto.randomUUID(),
                type: li.type === 'video' ? 'video' : 'image',
                mediaUrl: typeof li.mediaUrl === 'string' ? li.mediaUrl : '',
                thumbnailUrl: typeof li.thumbnailUrl === 'string' ? li.thumbnailUrl : undefined,
                fileName: typeof li.fileName === 'string' ? li.fileName : undefined,
                duration: typeof li.duration === 'number' ? li.duration : 5000,
                useVideoDuration: li.type === 'video' && li.useVideoDuration === true,
              }))
            : undefined,
          group: s.group && typeof s.group === 'object'
            ? {
                id: typeof s.group.id === 'string' ? s.group.id : `${i}`,
                title: typeof s.group.title === 'string' ? s.group.title : '',
                part: typeof s.group.part === 'number' ? s.group.part : 1,
                parts: typeof s.group.parts === 'number' ? s.group.parts : 1,
                color: typeof s.group.color === 'string' ? s.group.color : undefined,
                author: typeof s.group.author === 'string' ? s.group.author : undefined,
                kind: s.group.kind === 'hymn' ? 'hymn' : undefined,
              }
            : undefined,
          captions: s.captions && typeof s.captions === 'object' ? { ...s.captions } : undefined,
          locked: s.locked === true,
          partsMode: s.partsMode === true,
          parts: Array.isArray(s.parts) ? s.parts.filter((part: unknown) => typeof part === 'string') : undefined,
          activePart: typeof s.activePart === 'number' ? s.activePart : 0,
          items: Array.isArray(s.items) ? s.items : undefined,
          loopTransition: s.loopTransition,
          sectionId: typeof s.sectionId === 'string' ? s.sectionId : undefined,
          section: s.section && typeof s.section.id === 'string' && typeof s.section.title === 'string' ? s.section : undefined,
          operatorNotes: typeof s.operatorNotes === 'string' ? s.operatorNotes : undefined,
          gridEnabled: s.gridEnabled === true,
          gridSize: typeof s.gridSize === 'number' ? s.gridSize : undefined,
          gridColor: typeof s.gridColor === 'string' ? s.gridColor : undefined,
          snapEnabled: s.snapEnabled === true,
          styles: { ...DEFAULT_STYLES, ...(s.styles ?? {}) },
        }))
      : [createSlide('text', { content: t('common.newSlideContent') })];

    if (generation !== documentSession.current().generation || signature !== documentSignature(useStore.getState().presentation)) {
      await alertDialog(t('desktop.documentChanged'));
      return;
    }
    // An output can open while disk/media work is awaited. Automatic OS opens
    // must remain queued instead of changing a live output that just started.
    if (options?.automatic && outputActive()) return;
    dispatchUndo({
      type: 'RESET',
      payload: {
        ...data,
        sections: Array.isArray(data.sections) ? data.sections : undefined,
        id: data.id || crypto.randomUUID(),
        name: result.path.split(/[\\/]/).pop()?.replace(/\.gpres$/i, '') ?? data.name ?? t('common.presentation'),
        slides,
        zoom: typeof data.zoom === 'number' ? data.zoom : 1,
        transition: data.transition ?? { ...DEFAULT__TRANSITION },
        liveSlideId: typeof data.liveSlideId === 'string' ? data.liveSlideId : undefined,
        liveIndex: typeof data.liveIndex === 'number' ? data.liveIndex : undefined,
      },
    });
    setSelectedSlideId(slides[0]?.id ?? '');
    if (typeof data.zoom === 'number') {
      setSlideZoom(data.zoom);
    }
    const loadedGeneration = documentSession.current().generation;
    const loadedSignature = documentSignature(useStore.getState().presentation);
    if (result.token) await window.electronAPI?.desktopCommitOpen?.(result.token);
    documentSession.opened(result.path, loadedSignature, loadedGeneration);
    setSelectedPresetName(null);
    setActiveTab('slides');
    playSfx('open');
  }, [t, dispatchUndo, setSelectedSlideId, setSlideZoom, setActiveTab, setSelectedPresetName, guardDocumentReplacement]);

  const importPptxPresentation = useCallback(async (filePath: string, mode: PptxImportMode): Promise<PptxImportResult | null> => {
    if (mode === 'new' ? !(await guardDocumentReplacement()) : !(await guardEditorReplacement())) return null;
    const generation = documentSession.current().generation;
    const signature = documentSignature(useStore.getState().presentation);
    const result: PptxImportResult = await window.electronAPI.importPptx(filePath);
    if (!result?.success || !result.slides) throw new Error(result?.error || t('common.importFailedGeneric'));
    const slides = convertPptxToSlides(result);
    if (!slides.length) throw new Error(t('fileOpen.noImportedSlides'));
    const unchanged = () => generation === documentSession.current().generation && signature === documentSignature(useStore.getState().presentation);
    if (!unchanged()) { await alertDialog(t('desktop.documentChanged')); return null; }
    if (mode === 'new') {
      const current = useStore.getState();
      if ((current.isProjectorWindowOpen || Object.values(current.outputAssignments).some(output => output.isOpen)) &&
          !(await confirmDialog(t('fileOpen.liveReplaceWarning'), { title: t('fileOpen.liveReplaceTitle'), confirmLabel: t('fileOpen.newPresentation') }))) return null;
      if (!unchanged()) { await alertDialog(t('desktop.documentChanged')); return null; }
      dispatchUndo({ type: 'RESET', payload: { id: crypto.randomUUID(), name: filePath.split(/[\\/]/).pop()?.replace(/\.ppt[mx]$/i, '') || t('common.newPresentation'), slides, transition: { ...DEFAULT__TRANSITION } } });
      setSelectedPresetName(null);
      documentSession.unsaved();
    } else {
      const current = useStore.getState();
      dispatchUndo({ type: 'SET', payload: { ...current.presentation, slides: [...current.presentation.slides, ...slides] } });
    }
    setSelectedSlideId(slides[0].id);
    setActiveTab('slides');
    return result;
  }, [t, dispatchUndo, setSelectedSlideId, setSelectedPresetName, setActiveTab, guardDocumentReplacement]);

  const applyPreset = useCallback(async (preset: Preset) => {
    if (!(await guardDocumentReplacement())) return;
    const presentationWithId = {
      ...(isLiveSavePreset(preset.name) ? restoreLiveSession(preset.presentation, preset.createdAt) : preset.presentation),
      id: preset.presentation.id || crypto.randomUUID(),
    };
    dispatchUndo({ type: 'RESET', payload: presentationWithId });
    const displayName = isLiveSavePreset(preset.name) ? preset.presentation.name : preset.name;
    setPresentationName(displayName);
    setSelectedSlideId(preset.presentation.slides[0]?.id ?? '1');
    // Restore zoom level
    if (typeof preset.presentation.zoom === 'number') {
      setSlideZoom(preset.presentation.zoom);
    }
    const savedLiveSlideId = presentationWithId.liveSlideId
      ?? presentationWithId.slides[
        typeof presentationWithId.liveIndex === 'number'
          ? Math.min(Math.max(0, Math.floor(presentationWithId.liveIndex)), Math.max(0, presentationWithId.slides.length - 1))
          : 0
      ]?.id
      ?? null;
    setLiveSlideId(savedLiveSlideId);
    setSelectedPresetName(preset.name);
    setActiveTab('slides');
    documentSession.opened(null);
    playSfx('open');
  }, [dispatchUndo, setPresentationName, setSelectedSlideId, setSlideZoom, setLiveSlideId, setSelectedPresetName, setActiveTab, guardDocumentReplacement]);

  const openSavedPresentationByName = useCallback(async (presentationName: string) => {
    const { presets } = useStore.getState();
    const loaded = await window.electronAPI?.loadPresets?.(getLiveSaveRetention());
    const list = Array.isArray(loaded) ? loaded : presets;
    if (Array.isArray(loaded)) setPresets(loaded);

    const preset = findPresetByRef(presentationName, list);
    if (!preset) {
      const names = list.length > 0 ? list.map((p) => `• ${p.name}`).join('\n') : t('common.noPresetsYet');
      await alertDialog(t('warnings.presentationNotFound', { name: presentationName, list: names }));
      return;
    }

    await applyPreset(preset);
  }, [applyPreset, t, setPresets]);

  const createNewPresentation = useCallback(async () => {
    const { isProjectorWindowOpen } = useStore.getState();
    if (!(await confirmDialog(t('warnings.confirmNewPresentation')))) return;
    if (!(await guardDocumentReplacement())) return;

    if (isProjectorWindowOpen) {
      await window.electronAPI?.toggleProjector?.();
      setIsBlackout(false);
    }

    const newSlide = createSlide('text', { content: t('common.newSlide') });
    dispatchUndo({
      type: 'RESET',
      payload: {
        id: crypto.randomUUID(),
        name: t('common.newPresentation'),
        slides: [newSlide],
        transition: { ...DEFAULT__TRANSITION },
      },
    });
    setSelectedSlideId(newSlide.id);
    documentSession.opened(null);
    setLiveIndex(0);
    setIsBlackout(false);
    setActiveTab('slides');
    setPanels({ preset: false, remote: false, styles: false, imageStyles: false });
    setSelectedPresetName(null);
  }, [t, dispatchUndo, setSelectedSlideId, setLiveIndex, setIsBlackout, setActiveTab, setPanels, setSelectedPresetName, guardDocumentReplacement]);

  const appendSlides = useCallback((newSlides: Slide[], goLive?: boolean) => {
    if (newSlides.length === 0) return;
    // Read the latest state on each call so chained appends (e.g. bulk hymn inserts) don't stick to a stale closure.
    const current = useStore.getState();
    const slides = [...current.presentation.slides, ...inheritGeneratedBackgrounds(current.presentation.slides, newSlides)];

    dispatchUndo({
      type: 'SET',
      payload: { ...current.presentation, slides },
    });
    if (goLive) {
      setLiveSlideId(newSlides[0].id);
    }
    setSelectedSlideId(newSlides[0].id);
    setActiveTab('slides');
    playSfx('success');
  }, [dispatchUndo, setSelectedSlideId, setLiveSlideId, setActiveTab]);

  const handleSendToLive = useCallback((content: string | string[], options?: { groupTitle?: string; goLive?: boolean }) => {
    if (Array.isArray(content)) {
      const groupId = makeSlideId();
      const newSlides: Slide[] = content.map((chunk, idx) =>
        createSlide('text', {
          content: chunk,
          group: {
            id: groupId,
            title: options?.groupTitle ?? 'İncil',
            part: idx + 1,
            parts: content.length,
          },
          styles: {
            ...DEFAULT_STYLES,
            fontSize: 70,
            backgroundColor: '',
            textColor: '',
          },
        })
      );
      appendSlides(newSlides, options?.goLive);
    } else {
      const newSlide = createSlide('text', {
        content,
        styles: {
          ...DEFAULT_STYLES,
          fontSize: 70,
          backgroundColor: '',
          textColor: '',
        },
      });
      appendSlides([newSlide], options?.goLive);
    }
  }, [appendSlides]);

  const handleYouTubeMusicAdd = useCallback((track: YouTubeMusicResult) => {
    if (!isYouTubeMusicResult(track)) return;
    const slide = createSlide('text', {
      content: `♫\n${track.title}`,
      youtubeMusic: { id: track.id, title: track.title, duration: track.duration },
      styles: { ...DEFAULT_STYLES, fontSize: 76, backgroundColor: '#0f172a', textColor: '#f8fafc' },
    });
    appendSlides([slide]);
    setSelectedSlideIds(new Set([slide.id]));
    setLastSelectedIndex(useStore.getState().presentation.slides.length - 1);
  }, [appendSlides, setSelectedSlideIds, setLastSelectedIndex]);

  const handleMediaAdd = useCallback((type: 'image' | 'video', path: string, thumbnailUrl?: string) => {
    const newSlide = createSlide(type, {
      mediaUrl: toFileUrl(path),
      thumbnailUrl: type === 'video' ? thumbnailUrl : undefined,
      styles: {
        objectFit: 'cover',
        fontSize: 0,
        backgroundColor: '',
        textColor: '',
      },
    });

    appendSlides([newSlide]);
  }, [appendSlides]);

  const handleAddAllMedia = useCallback((items: Array<{ type: 'image' | 'video'; path: string; thumbnailUrl?: string }>) => {
    if (items.length === 0) return;
    const newSlides = items.map(item => createSlide(item.type, {
      mediaUrl: toFileUrl(item.path),
      thumbnailUrl: item.type === 'video' ? item.thumbnailUrl : undefined,
      styles: {
        objectFit: 'cover',
        fontSize: 0,
        backgroundColor: '',
        textColor: '',
      },
    }));
    appendSlides(newSlides);
  }, [appendSlides]);

  const handleScreenAdd = useCallback((sourceId: string, sourceName: string) => {
    const newSlide = createSlide('screen', {
      content: sourceName,
      mediaUrl: sourceId,
      styles: {
        objectFit: 'cover',
        fontSize: 0,
        backgroundColor: '',
        textColor: '',
      },
    });

    appendSlides([newSlide]);
  }, [appendSlides]);

  // Adds a QR slide so people can scan it from the projected screen. The URL
  // remains encoded in the QR itself and is intentionally not printed.
  const handleQrSlideAdd = useCallback((qrDataUrl: string) => {
    const qrSlide = createSlide('text', {
      content: '',
      styles: {
        ...DEFAULT_STYLES,
        fontSize: 0,
        backgroundColor: '#0b1220',
        textColor: '#ffffff',
      },
      items: [
        {
          id: makeSlideId(),
          type: 'image',
          mediaUrl: qrDataUrl,
          x: 30,
          y: 4,
          width: 40,
          height: 62,
          zIndex: 1,
          styles: {},
          imageStyles: { objectFit: 'contain' },
        },
        {
          id: makeSlideId(),
          type: 'text',
          content: t('common.screenShareQrSlideHint'),
          x: 0,
          y: 72,
          width: 100,
          height: 20,
          zIndex: 2,
          styles: {},
          textStyles: {
            fontSize: 30,
            textAlign: 'center',
            textColor: '#9fb4d4',
            textDecoration: 'none',
          },
        },
      ],
    });

    appendSlides([qrSlide]);
  }, [appendSlides, t]);

  const handleHymnAdd = useCallback((hymn: { title: string; lyrics: string; author?: string; showAuthorOnSlides?: boolean }, partsMode?: boolean, goLive?: boolean) => {
    const split = splitHymnLyrics(hymn.lyrics);
    if (split.parts.length === 0) return;

    if (partsMode === false) {
      const groupId = makeSlideId();
      const hymnColor = getHymnColor(groupId);
      const newSlides: Slide[] = split.parts.map((part, idx) =>
        createSlide('text', {
          content: part,
          group: {
            id: groupId,
            title: hymn.title,
            kind: 'hymn',
            author: hymn.showAuthorOnSlides ? hymn.author : undefined,
            part: idx + 1,
            parts: split.parts.length,
            color: hymnColor,
          },
          styles: {
            ...DEFAULT_STYLES,
            fontSize: 82,
            backgroundColor: '',
            textColor: '',
          },
        })
      );
      appendSlides(newSlides, goLive);
    } else {
      const groupId = makeSlideId();
      const hymnColor = getHymnColor(groupId);
      const newSlide = createSlide('text', {
        content: split.parts[0],
        partsMode: true,
        parts: split.parts,
        activePart: 0,
        group: {
          id: groupId,
          title: hymn.title,
          kind: 'hymn',
          author: hymn.showAuthorOnSlides ? hymn.author : undefined,
          part: 1,
          parts: split.parts.length,
          color: hymnColor,
        },
        styles: {
          ...DEFAULT_STYLES,
          fontSize: 82,
          backgroundColor: '',
          textColor: '',
        },
      });
      appendSlides([newSlide], goLive);
    }
  }, [appendSlides]);

  const handleAddCountdownToPresentation = useCallback((minutes: number, seconds: number, styles?: Partial<Slide['styles']>) => {
    const newSlide = createSlide('countdown', {
      content: JSON.stringify({
        minutes,
        seconds,
        startTime: Date.now(),
        totalSeconds: minutes * 60 + seconds,
      }),
      styles: {
        ...DEFAULT_STYLES,
        fontSize: 120,
        backgroundColor: '#000000',
        textColor: '#ffffff',
        ...styles,
      },
    });

    appendSlides([newSlide]);
  }, [appendSlides]);

  const handleAddCaptionsSlide = useCallback((goLive?: boolean) => {
    const newSlide = createSlide('captions', {
      content: '',
      captions: { showOriginal: true, showTranslation: true },
      styles: {
        ...DEFAULT_STYLES,
        fontSize: 72,
        backgroundColor: '#000000',
        textColor: '#ffffff',
      },
    });
    appendSlides([newSlide], goLive);
  }, [appendSlides]);

  /** Turns a finished STT utterance (original + translation) into a text slide. */
  const handleSttUtteranceToSlide = useCallback((original: string, translation: string) => {
    const content = [original, translation].filter(Boolean).join('\n\n');
    if (!content.trim()) return;
    const newSlide = createSlide('text', {
      content,
      styles: {
        ...DEFAULT_STYLES,
        fontSize: 48,
        backgroundColor: '#000000',
        textColor: '#ffffff',
      },
    });
    appendSlides([newSlide]);
  }, [appendSlides]);

  const handleAddLoopToPresentation = useCallback((items: LoopItem[], defaultDuration: number) => {
    const newSlide = createSlide('loop', {
      content: '',
      loopItems: items.map((item) => ({
        ...item,
        duration: item.duration || defaultDuration,
      })),
      loopTransition: { ...DEFAULT__TRANSITION },
      styles: {
        ...DEFAULT_STYLES,
        objectFit: 'cover',
        fontSize: 0,
        backgroundColor: '#000000',
        textColor: '#ffffff',
      },
    });

    appendSlides([newSlide]);
  }, [appendSlides]);

  const handleSlideClick = useCallback((id: string, index: number, e?: React.MouseEvent) => {
    const state = useStore.getState();
    const { presentation, selectedSlideIds, selectedSlideId, lastSelectedIndex } = state;
    // A queued click can arrive after a reorder but before its DOM commit.
    // Resolve the card's stable identity against the current deck.
    index = presentation.slides.findIndex(slide => slide.id === id);
    if (index < 0) return;
    if (!e || e.detail < 2) firstClickCued.current = false;
    if (e?.ctrlKey || e?.metaKey) {
      const next = new Set(selectedSlideIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      if (next.size === 0) next.add(id);
      if (next.has(id) !== selectedSlideIds.has(id)) {
        playSfx(next.has(id) ? 'focus' : 'deselect');
        firstClickCued.current = true;
      }
      state.selectSlides({ ids: next, anchorIndex: index,
        activeId: !next.has(selectedSlideId) || next.has(id) ? id : undefined });
      return;
    }
    const next = new Set<string>();
    if (e?.shiftKey && lastSelectedIndex !== null) {
      for (let i = Math.min(lastSelectedIndex, index); i <= Math.max(lastSelectedIndex, index); i++) {
        const slide = presentation.slides[i];
        if (slide) next.add(slide.id);
      }
    } else next.add(id);
    const selectionChanged = next.size !== selectedSlideIds.size || [...next].some(value => !selectedSlideIds.has(value)) || selectedSlideId !== id;
    state.selectSlides({ activeId: id, ids: next, anchorIndex: index,
      liveTargetId: state.isProjectorWindowOpen && findLockedSlideIndex(presentation.slides) === -1 ? presentation.slides[index]?.id : undefined });
    if (selectionChanged) { playSfx('focus'); firstClickCued.current = true; }
  }, []);

  const handleSlideDoubleClick = useCallback((id: string, index: number, nativeDoubleClick = false) => {
    const state = useStore.getState();
    if (state.isProjectorWindowOpen) return;
    index = state.presentation.slides.findIndex(slide => slide.id === id);
    if (index < 0) return;
    const locked = findLockedSlideIndex(state.presentation.slides) >= 0;
    state.selectSlides({ activeId: id, ids: new Set([id]), anchorIndex: index,
      liveTargetId: locked ? undefined : state.presentation.slides[index]?.id });
    if (locked) return;
    if (!nativeDoubleClick || !firstClickCued.current) playSfx('start');
    firstClickCued.current = false;
  }, []);

  const deleteSelectedSlides = useCallback(async () => {
    const { presentation, selectedSlideIds, selectedSlideId } = useStore.getState();
    if (selectedSlideIds.size === 0) return;
    // The locked slide pins the live output and must not be deleted.
    if (presentation.slides.some((s) => s.locked && selectedSlideIds.has(s.id))) return;
    if (presentation.slides.length - selectedSlideIds.size < 1) {
      await alertDialog(t('warnings.minSlides'));
      return;
    }

    const slides = presentation.slides.filter((s) => !selectedSlideIds.has(s.id));
    if (slides.length === 0) return;
    const replacementIndex = presentation.slides
      .slice(0, presentation.slides.findIndex(s => s.id === selectedSlideId))
      .filter(s => !selectedSlideIds.has(s.id)).length;

    dispatchUndo({
      type: 'SET',
      payload: { ...presentation, slides },
    });

    useStore.getState().selectSlides({ ids: new Set(), anchorIndex: null,
      activeId: selectedSlideIds.has(selectedSlideId)
        ? slides[Math.min(replacementIndex, slides.length - 1)].id : undefined });

    playSfx('delete');
  }, [t, dispatchUndo]);

  const duplicateSelectedSlides = useCallback(() => {
    const { presentation, selectedSlideIds } = useStore.getState();
    if (selectedSlideIds.size === 0) return;

    const selectedIndices = presentation.slides
      .map((s, i) => (selectedSlideIds.has(s.id) ? i : -1))
      .filter((i) => i !== -1)
      .sort((a, b) => a - b);

    if (selectedIndices.length === 0) return;

    const cloneIds: string[] = [];
    const slides: Slide[] = [];

    presentation.slides.forEach((slide) => {
      slides.push(slide);
      if (!selectedSlideIds.has(slide.id)) return;

      const cloneId = makeSlideId();
      const cloned: Slide = {
        ...slide,
        id: cloneId,
        // The lock never travels with a copy — single-lock invariant.
        locked: false,
        group: slide.group ? { ...slide.group, id: makeSlideId() } : undefined,
      };
      if (slide.type === 'countdown') {
        const data = parseCountdownContent(slide.content);
        cloned.content = serializeCountdownContent({ ...data, startTime: Date.now() });
      }
      slides.push(cloned);
      cloneIds.push(cloneId);
    });

    dispatchUndo({
      type: 'SET',
      payload: { ...presentation, slides },
    });

    playSfx('copy');
    useStore.getState().selectSlides({ ids: new Set(cloneIds), activeId: cloneIds[0],
      anchorIndex: slides.findIndex(s => s.id === cloneIds[cloneIds.length - 1]) });
  }, [dispatchUndo]);

  const moveSelectedSlides = useCallback((direction: -1 | 1) => {
    const { presentation, selectedSlideIds } = useStore.getState();
    const state = useStore.getState();
    if (state.serviceSectionsEnabled && (state.searchQuery.trim() || state.sectionFilterId)) return;
    if (selectedSlideIds.size === 0) return;

    dispatchUndo({ type: 'SET', payload: moveSectionSlidesOneStep(presentation, selectedSlideIds, direction) });
    playSfx('reorder');
  }, [dispatchUndo]);

  const replaceSlideMedia = useCallback(async () => {
    const { selectedSlideId } = useStore.getState();
    const generation = documentSession.current().generation;
    const file = await window.electronAPI?.selectMediaFile?.('image');
    if (typeof file === 'string' && file && generation === documentSession.current().generation) {
      const current = useStore.getState().presentation;
      dispatchUndo({
        type: 'SET',
        payload: {
          ...current,
          slides: current.slides.map((s) =>
            s.id === selectedSlideId
              ? { ...s, mediaUrl: toFileUrl(file) }
              : s
          ),
        },
      });
    }
  }, [dispatchUndo]);

  const removeSlideMedia = useCallback(() => {
    const { presentation, selectedSlideId } = useStore.getState();
    dispatchUndo({
      type: 'SET',
      payload: {
        ...presentation,
        slides: presentation.slides.map((s) =>
          s.id === selectedSlideId
            ? { ...s, mediaUrl: undefined }
            : s
        ),
      },
    });
  }, [dispatchUndo]);

  const updateLoopItems = useCallback((slideId: string, items: LoopItem[]) => {
    const { presentation } = useStore.getState();
    dispatchUndo({
      type: 'SET',
      payload: {
        ...presentation,
        slides: presentation.slides.map((s) =>
          s.id === slideId ? { ...s, loopItems: items } : s
        ),
      },
    });
  }, [dispatchUndo]);

  const updateSlideProperty = useCallback((slideId: string, props: Record<string, unknown>) => {
    const { presentation } = useStore.getState();
    dispatchUndo({
      type: 'SET',
      payload: {
        ...presentation,
        slides: presentation.slides.map((s) =>
          s.id === slideId ? { ...s, ...props } : s
        ),
      },
    });
  }, [dispatchUndo]);

  const applyStylesToSelected = useCallback((styles: Partial<Slide['styles']>) => {
    const { presentation, selectedSlideIds } = useStore.getState();
    if (selectedSlideIds.size === 0) return;

    dispatchUndo({
      type: 'SET',
      payload: {
        ...presentation,
        slides: presentation.slides.map((s) =>
          selectedSlideIds.has(s.id)
            ? { ...s, styles: backgroundPatch({ ...DEFAULT_STYLES, ...s.styles }, styles ?? {}) as Slide['styles'] }
            : s
        ),
      },
    });
  }, [dispatchUndo]);

  return {
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
    importPptxPresentation,
    openPresentation,
    applyPreset,
    openSavedPresentationByName,
    createNewPresentation,
    appendSlides,
    handleSendToLive,
    handleMediaAdd,
    handleYouTubeMusicAdd,
    handleAddAllMedia,
    handleScreenAdd,
    handleQrSlideAdd,
    handleHymnAdd,
    handleAddCountdownToPresentation,
    handleAddLoopToPresentation,
    handleAddCaptionsSlide,
    handleSttUtteranceToSlide,
    handleSlideClick,
    handleSlideDoubleClick,
    deleteSelectedSlides,
    duplicateSelectedSlides,
    moveSelectedSlides,
    applyStylesToSelected,
    replaceSlideMedia,
    removeSlideMedia,
    updateLoopItems,
    updateSlideProperty,
  };
}
