import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../state/useStore';
import type { Slide, Preset, TransitionType, LoopItem } from '../types';
import { DEFAULT_STYLES, DEFAULT__TRANSITION } from '../constants';
import { makeSlideId, toFileUrl } from '../utils';
import { confirmDialog, alertDialog } from '../dialogs';
import { findPresetByRef } from '../presetUtils';
import { parseCountdownContent, serializeCountdownContent, CountdownSlideData } from '../countdownUtils';
import { splitHymnLyrics } from '../hymnSplit';

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
  } = useStore();

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
  }, [presentation, t, dispatchUndo, setSelectedSlideId]);

  const removeSlide = useCallback((id: string) => {
    if (presentation.slides.length <= 1) return;
    const slides = presentation.slides.filter((s) => s.id !== id);
    if (selectedSlideId === id) {
      setSelectedSlideId(slides[0].id);
    }
    dispatchUndo({
      type: 'SET',
      payload: { ...presentation, slides },
    });
  }, [presentation, selectedSlideId, dispatchUndo, setSelectedSlideId]);

  const moveSelectedSlide = useCallback((direction: -1 | 1) => {
    const idx = presentation.slides.findIndex((s) => s.id === selectedSlideId);
    if (idx === -1) return;

    const target = idx + direction;
    if (target < 0 || target >= presentation.slides.length) return;

    const slides = [...presentation.slides];
    const [item] = slides.splice(idx, 1);
    slides.splice(target, 0, item);

    if (isProjectorWindowOpen) {
      setLiveIndex((current) => {
        if (current === idx) return target;
        if (direction === -1 && current >= target && current < idx) return current + 1;
        if (direction === 1 && current > idx && current <= target) return current - 1;
        return current;
      });
    }

    dispatchUndo({
      type: 'SET',
      payload: { ...presentation, slides },
    });
  }, [presentation, selectedSlideId, isProjectorWindowOpen, dispatchUndo, setLiveIndex]);

  const reorderSlides = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const slides = [...presentation.slides];
    const [moved] = slides.splice(fromIndex, 1);
    slides.splice(toIndex, 0, moved);

    setSelectedSlideId(moved.id);
    if (isProjectorWindowOpen) {
      setLiveIndex(toIndex);
    }

    dispatchUndo({
      type: 'SET',
      payload: { ...presentation, slides },
    });
  }, [presentation, selectedSlideId, isProjectorWindowOpen, dispatchUndo, setSelectedSlideId, setLiveIndex]);

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
    const content = JSON.stringify(presentation, null, 2);
    const path = await window.electronAPI?.saveFile?.(content);
    if (path) {
      dispatchUndo({
        type: 'SET',
        payload: {
          ...presentation,
          name: path.split('\\').pop()?.replace('.gpres', '') ?? presentation.name,
        },
      });
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
          type: ['image', 'video', 'text', 'screen', 'countdown', 'loop'].includes(s.type) ? s.type : 'text',
          content: typeof s.content === 'string' ? s.content : '',
          mediaUrl: typeof s.mediaUrl === 'string' ? s.mediaUrl : undefined,
          thumbnailUrl: typeof s.thumbnailUrl === 'string' ? s.thumbnailUrl : undefined,
          loopItems: Array.isArray(s.loopItems)
            ? s.loopItems.map((li: any) => ({
                id: typeof li.id === 'string' ? li.id : crypto.randomUUID(),
                type: li.type === 'video' ? 'video' : 'image',
                mediaUrl: typeof li.mediaUrl === 'string' ? li.mediaUrl : '',
                duration: typeof li.duration === 'number' ? li.duration : 5000,
              }))
            : undefined,
          group: s.group && typeof s.group === 'object'
            ? {
                id: typeof s.group.id === 'string' ? s.group.id : `${i}`,
                title: typeof s.group.title === 'string' ? s.group.title : '',
                part: typeof s.group.part === 'number' ? s.group.part : 1,
                parts: typeof s.group.parts === 'number' ? s.group.parts : 1,
              }
            : undefined,
          styles: { ...DEFAULT_STYLES, ...(s.styles ?? {}) },
        }))
      : [createSlide('text', { content: t('common.newSlideContent') })];

    dispatchUndo({
      type: 'RESET',
      payload: {
        name: result.path.split('\\').pop()?.replace('.gpres', '') ?? data.name ?? t('common.presentation'),
        slides,
        transition: data.transition ?? { ...DEFAULT__TRANSITION },
      },
    });
    setSelectedSlideId(slides[0].id);
  }, [t, dispatchUndo, setSelectedSlideId]);

  const applyPreset = useCallback((preset: Preset) => {
    dispatchUndo({ type: 'RESET', payload: preset.presentation });
    setPresentationName(preset.name);
    setSelectedSlideId(preset.presentation.slides[0]?.id ?? '1');
    setSelectedPresetName(preset.name);
    setActiveTab('slides');
  }, [dispatchUndo, setPresentationName, setSelectedSlideId, setSelectedPresetName, setActiveTab]);

  const openSavedPresentationByName = useCallback(async (presentationName: string) => {
    const loaded = await window.electronAPI?.loadPresets?.();
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
    const slides = [...presentation.slides, ...newSlides];
    const newIndex = presentation.slides.length;
    if (goLive) {
      // Always set liveIndex even if projector is not open
      setLiveIndex(newIndex);
    } else if (isProjectorWindowOpen) {
      setLiveIndex(newIndex);
    }

    dispatchUndo({
      type: 'SET',
      payload: { ...presentation, slides },
    });
    setSelectedSlideId(newSlides[0].id);
    setActiveTab('slides');
  }, [presentation, isProjectorWindowOpen, dispatchUndo, setSelectedSlideId, setLiveIndex, setActiveTab]);

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

  const handleHymnAdd = useCallback((hymn: { title: string; lyrics: string }, partsMode?: boolean, goLive?: boolean) => {
    const split = splitHymnLyrics(hymn.lyrics, 5);
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
    if (isProjectorWindowOpen) setLiveIndex(index);
  }, [presentation.slides, lastSelectedIndex, isProjectorWindowOpen, setSelectedSlideIds, setSelectedSlideId, setLastSelectedIndex, setLiveIndex]);

  const deleteSelectedSlides = useCallback(async () => {
    if (selectedSlideIds.size === 0) return;
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
  }, [presentation, selectedSlideIds, selectedSlideId, t, dispatchUndo, setSelectedSlideIds, setSelectedSlideId, setLastSelectedIndex]);

  const moveSelectedSlides = useCallback((direction: -1 | 1) => {
    if (selectedSlideIds.size === 0) return;

    const selectedIndices = presentation.slides
      .map((s, i) => (selectedSlideIds.has(s.id) ? i : -1))
      .filter((i) => i !== -1)
      .sort((a, b) => (direction === -1 ? b - a : a - b));

    if (selectedIndices.length === 0) return;

    const firstIdx = selectedIndices[0];
    const lastIdx = selectedIndices[selectedIndices.length - 1];
    const target = direction === -1 ? firstIdx - 1 : lastIdx + 1;

    if (target < 0 || target >= presentation.slides.length) return;

    let slides = [...presentation.slides];
    const movedSlides: Slide[] = [];

    for (const idx of selectedIndices) {
      movedSlides.push(slides[idx]);
    }

    slides = slides.filter((_, i) => !selectedSlideIds.has(slides[i].id));

    const insertIdx = target;
    slides.splice(insertIdx, 0, ...movedSlides);

    dispatchUndo({
      type: 'SET',
      payload: { ...presentation, slides },
    });
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
    handleScreenAdd,
    handleHymnAdd,
    handleAddCountdownToPresentation,
    handleAddLoopToPresentation,
    handleSlideClick,
    deleteSelectedSlides,
    moveSelectedSlides,
    applyStylesToSelected,
    replaceSlideMedia,
    removeSlideMedia,
    updateLoopItems,
    updateSlideProperty,
  };
}
