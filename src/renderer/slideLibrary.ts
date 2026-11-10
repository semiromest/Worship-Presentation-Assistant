import type { Slide, SlideItem } from './types';
import { DEFAULT_STYLES } from './defaultSlideStyles';
import { parseCountdownContent, serializeCountdownContent } from './countdownUtils';

export type LibraryKind = 'gallery' | 'templates';
export interface SlideLibraryEntry {
  id: string;
  name: string;
  slide: Slide;
  /** Templates can contain several slides; slide is their first preview. */
  slides?: Slide[];
  createdAt: number;
}

// IndexedDB keeps full slide snapshots out of localStorage's small quota.
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('wpa-slide-library', 2);
    request.onupgradeneeded = () => {
      // Keep the original gallery store intact. Templates own a separate store.
      for (const store of ['entries', 'templates']) {
        if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(kind: LibraryKind, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const store = kind === 'gallery' ? 'entries' : 'templates';
    const tx = db.transaction(store, mode);
    const request = operation(tx.objectStore(store));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function listSlideLibrary(kind: LibraryKind): Promise<SlideLibraryEntry[]> {
  const entries = await transaction(kind, 'readonly', store => store.getAll());
  return (entries as SlideLibraryEntry[]).sort((a, b) => b.createdAt - a.createdAt);
}

export function saveSlideLibrary(kind: LibraryKind, entry: SlideLibraryEntry) {
  return transaction(kind, 'readwrite', store => store.put(entry));
}

export function removeSlideLibrary(kind: LibraryKind, id: string) {
  return transaction(kind, 'readwrite', store => store.delete(id));
}

/** Gallery snapshots contain background layers only, never lyrics or music. */
export function gallerySlide(source: Slide): Slide | null {
  if (source.youtubeMusic && !source.musicSettings?.attachment) return null;
  const styles = source.styles;
  const image = source.type === 'image' ? source.mediaUrl : styles?.backgroundImage;
  const video = source.type === 'video' ? source.mediaUrl : styles?.backgroundVideo;
  if (!image && !video && !styles?.backgroundGradient) return null;
  return {
    id: source.id, type: 'text', content: '',
    thumbnailUrl: source.thumbnailUrl,
    styles: {
      ...DEFAULT_STYLES,
      backgroundColor: styles?.backgroundColor ?? '#000000',
      backgroundImage: video ? undefined : image,
      backgroundVideo: video,
      backgroundGradient: styles?.backgroundGradient,
      generatedBackground: styles?.generatedBackground,
      backgroundBlur: styles?.backgroundBlur ?? 0,
      backgroundDim: styles?.backgroundDim ?? 0,
      objectFit: styles?.objectFit ?? 'cover',
      backgroundExplicit: true,
    },
  };
}

/** Prepared media creates a fresh slide without copying the source's text or live state. */
export function instantiateLibraryMedia(source: Slide, sectionId?: string): Slide {
  const background = source.styles;
  const video = background?.backgroundVideo;
  const image = background?.backgroundImage;
  const gradient = !!background?.generatedBackground || !!background?.backgroundGradient;
  return {
    id: crypto.randomUUID(), sectionId, content: '',
    type: video ? 'video' : image && !gradient ? 'image' : 'text',
    mediaUrl: video || (gradient ? undefined : image),
    thumbnailUrl: source.thumbnailUrl,
    styles: structuredClone(video || (image && !gradient)
      ? { ...DEFAULT_STYLES, objectFit: background?.objectFit ?? 'cover', backgroundExplicit: true }
      : { ...background, backgroundExplicit: true }) as Slide['styles'],
  };
}

/** Preserve complete slide content while detaching it from its source deck. */
export function snapshotTemplate(slides: Slide[]): Slide[] {
  return structuredClone(slides).map(slide => {
    delete slide.sectionId;
    delete slide.section;
    delete slide.locked;
    return slide;
  });
}

/** Every insertion owns fresh slide, layer, loop and group identities. */
export function instantiateTemplate(sources: Slide[], sectionId?: string): Slide[] {
  const groups = new Map<string, string>();
  const rekey = (item: SlideItem): SlideItem => ({
    ...item, id: crypto.randomUUID(), groupItems: item.groupItems?.map(rekey),
  });
  const slides = snapshotTemplate(sources).map(slide => {
    slide.id = crypto.randomUUID();
    slide.sectionId = sectionId;
    slide.items = slide.items?.map(rekey);
    slide.videoOverlays = slide.videoOverlays?.map(item => ({ ...item, id: crypto.randomUUID() }));
    slide.loopItems = slide.loopItems?.map(item => ({ ...item, id: crypto.randomUUID() }));
    if (slide.group) {
      const oldId = slide.group.id;
      if (!groups.has(oldId)) groups.set(oldId, crypto.randomUUID());
      slide.group.id = groups.get(oldId)!;
    }
    if (slide.partsMode) { slide.activePart = 0; slide.content = slide.parts?.[0] ?? slide.content; }
    if (slide.type === 'countdown') {
      const data = parseCountdownContent(slide.content);
      slide.content = serializeCountdownContent({ ...data, startTime: Date.now(), paused: true, pausedRemaining: data.totalSeconds });
    }
    return slide;
  });
  for (const groupId of groups.values()) {
    const members = slides.filter(slide => slide.group?.id === groupId);
    members.forEach((slide, index) => {
      slide.group = { ...slide.group!, part: index + 1, parts: members.length };
    });
  }
  return slides;
}
