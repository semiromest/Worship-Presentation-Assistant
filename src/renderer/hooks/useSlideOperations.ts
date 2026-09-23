import { restoreLiveSession } from '../liveSession';
import { moveSelectedInOrder } from '../../shared/serviceSections';
import { useShallow } from 'zustand/react/shallow';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../state/useStore';
import type { Slide, Preset, TransitionType, LoopItem } from '../types';
import { DEFAULT_STYLES, DEFAULT__TRANSITION } from '../constants';
import { makeSlideId, toFileUrl } from '../utils';
import { confirmDialog, alertDialog } from '../dialogs';
import { findPresetByRef } from '../presetUtils';
import { isLiveSavePreset, getLiveSaveRetention } from './useLiveSave';
import { parseCountdownContent, serializeCountdownContent, CountdownSlideData } from '../countdownUtils';
import { splitHymnLyrics } from '../hymnSplit';
import { findLockedSlideIndex } from '../slideLock';
import { playSfx } from '../sfx';

export const createSlide = (type: Slide['type'], overrides: Partial<Slide> = {}): Slide => ({
  id: makeSlideId(),
  type,
  content: '',
  styles: { ...DEFAULT_STYLES },
  ...overrides,
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
  const { t } = useTranslation();
  const {
    presentation,
    selectedSlideId,
    selectedSlideIds,
    lastSelectedIndex,
    isProjectorWindowOpen,
    setLiveSlideId,
    presets,
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
    presentation: s.presentation,
    selectedSlideId: s.selectedSlideId,
    selectedSlideIds: s.selectedSlideIds,
    lastSelectedIndex: s.lastSelectedIndex,
    isProjectorWindowOpen: s.isProjectorWindowOpen,
    setLiveSlideId: s.setLiveSlideId,
    presets: s.presets,
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
    const newSlide = createSlide('text', { content: t('common.newSlideContent') });
    dispatchUndo({
      type: 'SET',
      payload: {
        ...presentation,
        slides: [...presentation.slides, newSlide],
      },
    });
    setSelectedSlideId(newSlide.id);
    playSfx('select');
  }, [presentation, t, dispatchUndo, setSelectedSlideId]);

  const removeSlide = useCallback((id: string) => {
    if (presentation.slides.length <= 1) return;
    // A locked slide is pinned to the live output — removing it would leave
    // the broadcast dangling, so it must be unlocked first.
    const target = presentation.slides.find((s) => s.id === id);
    if (target?.locked) return;
    const slides = presentation.slides.filter((s) => s.id !== id);
    if (selectedSlideId === id) {
      setSelectedSlideId(slides[0].id);
    }
    dispatchUndo({
      type: 'SET',
      payload: { ...presentation, slides },
    });
    playSfx('delete');
  }, [presentation, selectedSlideId, dispatchUndo, setSelectedSlideId]);

  const moveSelectedSlide = useCallback((direction: -1 | 1) => {
    const idx = presentation.slides.findIndex((s) => s.id === selectedSlideId);
    if (idx === -1) return;

    const target = idx + direction;
    if (target < 0 || target >= presentation.slides.length) return;

    const slides = [...presentation.slides];
    const [item] = slides.splice(idx, 1);
    slides.splice(target, 0, item);

    dispatchUndo({
      type: 'SET',
      payload: { ...presentation, slides },
    });
    playSfx('reorder');
  }, [presentation, selectedSlideId, dispatchUndo]);

  const reorderSlides = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const slides = [...presentation.slides];
    const [moved] = slides.splice(fromIndex, 1);
    slides.splice(toIndex, 0, moved);

    setSelectedSlideId(moved.id);

    dispatchUndo({
      type: 'SET',
      payload: { ...presentation, slides },
    });
    playSfx('reorder');
  }, [presentation, dispatchUndo, setSelectedSlideId]);

  const updateSlideContent = useCallback((content: string) => {
    const targetIds = selectedSlideIds.size > 0 ? selectedSlideIds : new Set([selectedSlideId]);
    dispatchUndo({
      type: 'SET',
      payload: {
        ...presentation,
        slides: presentation.slides.map((s) =>
          targetIds.has(s.id) ? { ...s, content } : s
        ),
      },
    });
  }, [presentation, selectedSlideIds, selectedSlideId, dispatchUndo]);

  const updateSlideStyles = useCallback((styles: Partial<Slide['styles']>) => {
    const targetIds = selectedSlideIds.size > 0 ? selectedSlideIds : new Set([selectedSlideId]);
    dispatchUndo({
      type: 'SET',
      payload: {
        ...presentation,
        slides: presentation.slides.map((s) =>
          targetIds.has(s.id)
            ? { ...s, styles: { ...DEFAULT_STYLES, ...s.styles, ...styles } }
            : s
        ),
      },
    });
  }, [presentation, selectedSlideIds, selectedSlideId, dispatchUndo]);

  const patchSelectedCountdown = useCallback((mutate: (data: CountdownSlideData) => CountdownSlideData) => {
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
  }, [presentation, selectedSlideId, dispatchUndo]);

  const updateSlideBackgroundImage = useCallback(async () => {
    const file = await window.electronAPI?.selectMediaFile?.('image');
    if (typeof file === 'string' && file) {
      updateSlideStyles({ backgroundImage: toFileUrl(file) });
    }
  }, [updateSlideStyles]);

  const removeSlideBackgroundImage = useCallback(() => {
    updateSlideStyles({ backgroundImage: undefined });
  }, [updateSlideStyles]);

  const updateSlideBackgroundVideo = useCallback(async () => {
    const file = await window.electronAPI?.selectMediaFile?.('video');
    if (typeof file === 'string' && file) {
      updateSlideStyles({ backgroundVideo: toFileUrl(file) });
    }
  }, [updateSlideStyles]);

  const removeSlideBackgroundVideo = useCallback(() => {
    updateSlideStyles({ backgroundVideo: undefined });
  }, [updateSlideStyles]);

  const applyStyleFieldToAll = useCallback((pick: Partial<Slide['styles']> | 'all') => {
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

    dispatchUndo({
      type: 'SET',
      payload: {
        ...presentation,
        slides: presentation.slides.map((s) => ({
          ...s,
          styles: {
            ...DEFAULT_STYLES,
            ...s.styles,
            ...toApply,
            objectFit: s.type !== 'text'
              ? ((toApply['objectFit'] as 'fill' | 'contain' | 'cover' | undefined) ?? s.styles?.objectFit ?? 'contain')
              : undefined,
          },
        })),
      },
    });
  }, [presentation, selectedSlideId, dispatchUndo]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
  }, [presentation, selectedSlideId, dispatchUndo, setSelectedSlideId]);

  const updateTransition = useCallback((update: Partial<{ type: TransitionType; duration: number }>) => {
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
  }, [presentation, dispatchUndo]);

  const savePresentation = useCallback(async () => {
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
      dispatchUndo({
        type: 'SET',
        payload: {
          ...payload,
          name: path.split('\\').pop()?.replace('.gpres', '') ?? presentation.name,
        },
      });
      playSfx('complete');
    }
  }, [presentation, dispatchUndo]);

  const handleImportSlides = useCallback((slides: Slide[]) => {
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
  }, [presentation, dispatchUndo, setSelectedSlideId, setActiveTab]);

  const openPresentation = useCallback(async () => {
    const result = await window.electronAPI?.openFile?.();
    if (!result) return;

    const data = JSON.parse(result.content);
    const slides: Slide[] = Array.isArray(data.slides)
      ? data.slides.map((s: any, i: number) => ({
          id: typeof s.id === 'string' ? s.id : `${i + 1}`,
          type: ['image', 'video', 'text', 'screen', 'countdown', 'loop', 'captions'].includes(s.type) ? s.type : 'text',
          content: typeof s.content === 'string' ? s.content : '',
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
              }
            : undefined,
          captions: s.captions && typeof s.captions === 'object' ? { ...s.captions } : undefined,
          locked: s.locked === true,
          partsMode: s.partsMode === true,
          parts: Array.isArray(s.parts) ? s.parts.filter((part: unknown) => typeof part === 'string') : undefined,
          activePart: typeof s.activePart === 'number' ? s.activePart : 0,
          items: Array.isArray(s.items) ? s.items : undefined,
          loopTransition: s.loopTransition,
          section: s.section && typeof s.section.id === 'string' && typeof s.section.title === 'string' ? s.section : undefined,
          operatorNotes: typeof s.operatorNotes === 'string' ? s.operatorNotes : undefined,
          gridEnabled: s.gridEnabled === true,
          gridSize: typeof s.gridSize === 'number' ? s.gridSize : undefined,
          gridColor: typeof s.gridColor === 'string' ? s.gridColor : undefined,
          snapEnabled: s.snapEnabled === true,
          styles: { ...DEFAULT_STYLES, ...(s.styles ?? {}) },
        }))
      : [createSlide('text', { content: t('common.newSlideContent') })];

    dispatchUndo({
      type: 'RESET',
      payload: {
        id: data.id || crypto.randomUUID(),
        name: result.path.split('\\').pop()?.replace('.gpres', '') ?? data.name ?? t('common.presentation'),
        slides,
        zoom: typeof data.zoom === 'number' ? data.zoom : 1,
        transition: data.transition ?? { ...DEFAULT__TRANSITION },
        liveSlideId: typeof data.liveSlideId === 'string' ? data.liveSlideId : undefined,
        liveIndex: typeof data.liveIndex === 'number' ? data.liveIndex : undefined,
      },
    });
    setSelectedSlideId(slides[0].id);
    if (typeof data.zoom === 'number') {
      setSlideZoom(data.zoom);
    }
    playSfx('open');
  }, [t, dispatchUndo, setSelectedSlideId, setSlideZoom]);

  const applyPreset = useCallback((preset: Preset) => {
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
    playSfx('open');
  }, [dispatchUndo, setPresentationName, setSelectedSlideId, setSlideZoom, setLiveSlideId, setSelectedPresetName, setActiveTab]);

  const openSavedPresentationByName = useCallback(async (presentationName: string) => {
    const loaded = await window.electronAPI?.loadPresets?.(getLiveSaveRetention());
    const list = Array.isArray(loaded) ? loaded : presets;
    if (Array.isArray(loaded)) setPresets(loaded);

    const preset = findPresetByRef(presentationName, list);
    if (!preset) {
      const names = list.length > 0 ? list.map((p) => `• ${p.name}`).join('\n') : t('common.noPresetsYet');
      await alertDialog(t('warnings.presentationNotFound', { name: presentationName, list: names }));
      return;
    }

    applyPreset(preset);
  }, [presets, applyPreset, t, setPresets]);

  const createNewPresentation = useCallback(async () => {
    if (!(await confirmDialog(t('warnings.confirmNewPresentation')))) return;

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
    setLiveIndex(0);
    setIsBlackout(false);
    setActiveTab('slides');
    setPanels({ preset: false, remote: false, styles: false, imageStyles: false });
    setSelectedPresetName(null);
  }, [t, isProjectorWindowOpen, dispatchUndo, setSelectedSlideId, setLiveIndex, setIsBlackout, setActiveTab, setPanels, setSelectedPresetName]);

  const appendSlides = useCallback((newSlides: Slide[], goLive?: boolean) => {
    if (newSlides.length === 0) return;
    // Read the latest state on each call so chained appends (e.g. bulk hymn inserts) don't stick to a stale closure.
    const current = useStore.getState();
    const slides = [...current.presentation.slides, ...newSlides];

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
    const isShift = e?.shiftKey;

    if (isShift && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const newSelection = new Set<string>();

      for (let i = start; i <= end; i++) {
        const slide = presentation.slides[i];
        if (slide) newSelection.add(slide.id);
      }

      setSelectedSlideIds(newSelection);
      setSelectedSlideId(id);
    } else {
      setSelectedSlideIds(new Set([id]));
      setSelectedSlideId(id);
    }

    setLastSelectedIndex(index);
    // Live broadcast open: single click sends the selected slide straight to live.
    // Broadcast closed: click only selects; go live via Enter or double click.
    // With an active broadcast lock the live output cannot move (setLiveIndex
    // resolves to the locked slide), so skip the live switch entirely.
    if (isProjectorWindowOpen && findLockedSlideIndex(presentation.slides) === -1) setLiveIndex(index);
  }, [presentation.slides, lastSelectedIndex, isProjectorWindowOpen, setSelectedSlideIds, setSelectedSlideId, setLastSelectedIndex, setLiveIndex]);

  const handleSlideDoubleClick = useCallback((id: string, index: number) => {
    // Double click = quick Send to Live, active only while the broadcast is closed (single click already covers it when open).
    if (isProjectorWindowOpen) return;
    // Locked slide owns the live output — double-click cannot take it away.
    if (findLockedSlideIndex(presentation.slides) >= 0) {
      setSelectedSlideIds(new Set([id]));
      setSelectedSlideId(id);
      setLastSelectedIndex(index);
      return;
    }
    setSelectedSlideIds(new Set([id]));
    setSelectedSlideId(id);
    setLastSelectedIndex(index);
    setLiveIndex(index);
    playSfx('start');
  }, [presentation.slides, isProjectorWindowOpen, setSelectedSlideIds, setSelectedSlideId, setLastSelectedIndex, setLiveIndex]);

  const deleteSelectedSlides = useCallback(async () => {
    if (selectedSlideIds.size === 0) return;
    // The locked slide pins the live output and must not be deleted.
    if (presentation.slides.some((s) => s.locked && selectedSlideIds.has(s.id))) return;
    if (presentation.slides.length - selectedSlideIds.size < 1) {
      await alertDialog(t('warnings.minSlides'));
      return;
    }

    const slides = presentation.slides.filter((s) => !selectedSlideIds.has(s.id));
    if (slides.length === 0) return;

    dispatchUndo({
      type: 'SET',
      payload: { ...presentation, slides },
    });

    setSelectedSlideIds(new Set());
    setLastSelectedIndex(null);

    if (selectedSlideIds.has(selectedSlideId)) {
      setSelectedSlideId(slides[0].id);
    }

    playSfx('delete');
  }, [presentation, selectedSlideIds, selectedSlideId, t, dispatchUndo, setSelectedSlideIds, setSelectedSlideId, setLastSelectedIndex]);

  const duplicateSelectedSlides = useCallback(() => {
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

    setSelectedSlideIds(new Set(cloneIds));
    setLastSelectedIndex(slides.findIndex((s) => s.id === cloneIds[cloneIds.length - 1]));
    setSelectedSlideId(cloneIds[0]);
  }, [presentation, selectedSlideIds, dispatchUndo, setSelectedSlideIds, setLastSelectedIndex, setSelectedSlideId]);

  const moveSelectedSlides = useCallback((direction: -1 | 1) => {
    if (selectedSlideIds.size === 0) return;

    const slides = moveSelectedInOrder(presentation.slides, selectedSlideIds, direction);
    if (slides === presentation.slides) return;

    dispatchUndo({
      type: 'SET',
      payload: { ...presentation, slides },
    });
    playSfx('reorder');
  }, [presentation, selectedSlideIds, dispatchUndo]);

  const replaceSlideMedia = useCallback(async () => {
    const file = await window.electronAPI?.selectMediaFile?.('image');
    if (typeof file === 'string' && file) {
      dispatchUndo({
        type: 'SET',
        payload: {
          ...presentation,
          slides: presentation.slides.map((s) =>
            s.id === selectedSlideId
              ? { ...s, mediaUrl: toFileUrl(file) }
              : s
          ),
        },
      });
    }
  }, [presentation, selectedSlideId, dispatchUndo]);

  const removeSlideMedia = useCallback(() => {
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
  }, [presentation, selectedSlideId, dispatchUndo]);

  const updateLoopItems = useCallback((slideId: string, items: LoopItem[]) => {
    dispatchUndo({
      type: 'SET',
      payload: {
        ...presentation,
        slides: presentation.slides.map((s) =>
          s.id === slideId ? { ...s, loopItems: items } : s
        ),
      },
    });
  }, [presentation, dispatchUndo]);

  const updateSlideProperty = useCallback((slideId: string, props: Record<string, unknown>) => {
    dispatchUndo({
      type: 'SET',
      payload: {
        ...presentation,
        slides: presentation.slides.map((s) =>
          s.id === slideId ? { ...s, ...props } : s
        ),
      },
    });
  }, [presentation, dispatchUndo]);

  const applyStylesToSelected = useCallback((styles: Partial<Slide['styles']>) => {
    if (selectedSlideIds.size === 0) return;

    dispatchUndo({
      type: 'SET',
      payload: {
        ...presentation,
        slides: presentation.slides.map((s) =>
          selectedSlideIds.has(s.id)
            ? { ...s, styles: { ...DEFAULT_STYLES, ...s.styles, ...styles } }
            : s
        ),
      },
    });
  }, [presentation, selectedSlideIds, dispatchUndo]);

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
    openPresentation,
    applyPreset,
    openSavedPresentationByName,
    createNewPresentation,
    appendSlides,
    handleSendToLive,
    handleMediaAdd,
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
