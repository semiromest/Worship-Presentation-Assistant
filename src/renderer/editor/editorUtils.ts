import type { Slide, SlideItem, TextStyle, ImageStyle } from '../types';

// ─── Constants ────────────────────────────────────────────────────────────────

export const SLIDE_REFERENCE_WIDTH = 1920;
export const SLIDE_REFERENCE_HEIGHT = Math.round(SLIDE_REFERENCE_WIDTH * 9 / 16);

export const MIN_ITEM_WIDTH = 4;
export const MIN_ITEM_HEIGHT = 4;
export const MAX_ITEM_WIDTH = 100;
export const MAX_ITEM_HEIGHT = 100;

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontSize: 48,
  textColor: '#ffffff',
  textAlign: 'center',
  verticalAlign: 'center',
  fontWeight: 'bold',
  fontStyle: 'normal',
  lineHeight: 1.3,
  letterSpacing: 0,
  textDecoration: '',
  textTransform: 'none',
};

export const DEFAULT_IMAGE_STYLE: ImageStyle = {
  objectFit: 'contain',
  opacity: 1,
  brightness: 1,
  contrast: 1,
  grayscale: 0,
  sepia: 0,
  blur: 0,
  crop: undefined,
};

export const DEFAULT_SLIDE_STYLES: Record<string, unknown> = {
  fontSize: 48,
  textTransform: 'none',
  backgroundColor: '#000000',
  textColor: '#ffffff',
  fontFamily: 'inherit',
  objectFit: 'contain',
  textAlign: 'center',
  fontWeight: 'bold',
  fontStyle: 'normal',
  lineHeight: 1.3,
};

export const FONT_PRESETS = [
  { name: 'Varsayılan', value: 'inherit' },

  // Sistem Fontları
  { name: 'Arial', value: 'Arial, sans-serif' },
  { name: 'Times New Roman', value: 'Times New Roman, serif' },
  { name: 'Courier New', value: 'Courier New, monospace' },
  { name: 'Georgia', value: 'Georgia, serif' },
  { name: 'Verdana', value: 'Verdana, sans-serif' },
  { name: 'Tahoma', value: 'Tahoma, sans-serif' },
  { name: 'Trebuchet MS', value: "'Trebuchet MS', sans-serif" },
  { name: 'Impact', value: 'Impact, sans-serif' },
  { name: 'Comic Sans MS', value: "'Comic Sans MS', cursive" },

  // Google Fonts — Sans-Serif
  { name: 'Open Sans', value: "'Open Sans', sans-serif" },
  { name: 'Roboto', value: 'Roboto, sans-serif' },
  { name: 'Montserrat', value: 'Montserrat, sans-serif' },
  { name: 'Lato', value: 'Lato, sans-serif' },
  { name: 'Poppins', value: 'Poppins, sans-serif' },
  { name: 'Inter', value: 'Inter, sans-serif' },
  { name: 'Raleway', value: 'Raleway, sans-serif' },
  { name: 'Ubuntu', value: 'Ubuntu, sans-serif' },
  { name: 'Nunito', value: 'Nunito, sans-serif' },
  { name: 'Work Sans', value: "'Work Sans', sans-serif" },
  { name: 'Quicksand', value: 'Quicksand, sans-serif' },
  { name: 'Source Sans 3', value: "'Source Sans 3', sans-serif" },
  { name: 'Oswald', value: 'Oswald, sans-serif' },
  { name: 'Barlow', value: 'Barlow, sans-serif' },
  { name: 'Manrope', value: 'Manrope, sans-serif' },
  { name: 'Jost', value: 'Jost, sans-serif' },
  { name: 'Figtree', value: 'Figtree, sans-serif' },
  { name: 'Outfit', value: 'Outfit, sans-serif' },

  // Google Fonts — Serif
  { name: 'Playfair Display', value: "'Playfair Display', serif" },
  { name: 'Merriweather', value: 'Merriweather, serif' },
  { name: 'Lora', value: 'Lora, serif' },
  { name: 'Libre Baskerville', value: "'Libre Baskerville', serif" },
  { name: 'Cormorant Garamond', value: "'Cormorant Garamond', serif" },
  { name: 'EB Garamond', value: "'EB Garamond', serif" },
  { name: 'Bitter', value: 'Bitter, serif' },
  { name: 'Abril Fatface', value: "'Abril Fatface', serif" },

  // Google Fonts — Display / Handwriting
  { name: 'Pacifico', value: 'Pacifico, cursive' },
  { name: 'Dancing Script', value: "'Dancing Script', cursive" },
  { name: 'Caveat', value: 'Caveat, cursive' },
  { name: 'Great Vibes', value: "'Great Vibes', cursive" },
  { name: 'Righteous', value: 'Righteous, sans-serif' },
  { name: 'Bebas Neue', value: "'Bebas Neue', sans-serif" },
  { name: 'Anton', value: 'Anton, sans-serif' },
  { name: 'Lobster', value: 'Lobster, cursive' },
  { name: 'Alfa Slab One', value: "'Alfa Slab One', serif" },

  // Google Fonts — Mono
  { name: 'Fira Code', value: "'Fira Code', monospace" },
  { name: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
  { name: 'Space Mono', value: "'Space Mono', monospace" },
] as const;

// ─── Utility functions ────────────────────────────────────────────────────────

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function getSafeColor(value: string | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? value : fallback;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable
  );
}

// ─── Normalizers ──────────────────────────────────────────────────────────────

export function normalizeSlideStyles(styles?: Record<string, unknown> | null): Record<string, unknown> {
  return { ...DEFAULT_SLIDE_STYLES, ...(styles ?? {}) } as Record<string, unknown>;
}

export function normalizeItem(item: SlideItem): SlideItem {
  const width = clamp(item.width ?? 10, MIN_ITEM_WIDTH, MAX_ITEM_WIDTH);
  const height = clamp(item.height ?? 10, MIN_ITEM_HEIGHT, MAX_ITEM_HEIGHT);
  return {
    ...item,
    x: clamp(item.x ?? 0, 0, Math.max(0, 100 - width)),
    y: clamp(item.y ?? 0, 0, Math.max(0, 100 - height)),
    width,
    height,
    rotation: item.rotation ?? 0,
    visible: item.visible ?? true,
    zIndex: item.zIndex ?? 0,
    locked: item.locked ?? false,
    textStyles: item.textStyles ?? { ...DEFAULT_TEXT_STYLE },
    imageStyles: item.imageStyles ?? { ...DEFAULT_IMAGE_STYLE },
    borderWidth: item.borderWidth ?? 0,
    borderRadius: item.borderRadius ?? 0,
  };
}

export function normalizeItems(items: SlideItem[]): SlideItem[] {
  return [...items]
    .map(normalizeItem)
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    .map((item, index) => ({ ...item, zIndex: index }));
}

// ─── Immutable item operations ────────────────────────────────────────────────

export function createItem(
  type: 'text' | 'image',
  items: SlideItem[] = [],
  initialContent?: string,
): SlideItem {
  const maxZ = items.reduce((max, item) => Math.max(max, item.zIndex ?? 0), -1);
  return normalizeItem({
    id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    content: type === 'text' ? (initialContent ?? 'Yeni metin') : undefined,
    x: type === 'text' ? 12 : 15,
    y: type === 'text' ? 12 : 15,
    width: type === 'text' ? 30 : 40,
    height: type === 'text' ? 12 : 30,
    rotation: 0,
    zIndex: maxZ + 1,
    visible: true,
    locked: false,
    textStyles: { ...DEFAULT_TEXT_STYLE },
    imageStyles: { ...DEFAULT_IMAGE_STYLE },
    styles: undefined,
  });
}

export function swapLayer(
  items: SlideItem[],
  id: string,
  direction: 'up' | 'down',
): SlideItem[] {
  const ordered = normalizeItems(items);
  const idx = ordered.findIndex(item => item.id === id);
  if (idx === -1) return ordered;

  const targetIndex = direction === 'up' ? idx + 1 : idx - 1;
  if (targetIndex < 0 || targetIndex >= ordered.length) return ordered;

  const next = [...ordered];
  [next[idx], next[targetIndex]] = [next[targetIndex], next[idx]];
  return next.map((item, index) => ({ ...item, zIndex: index }));
}

export function duplicateItem(items: SlideItem[], id: string): SlideItem[] {
  const ordered = normalizeItems(items);
  const source = ordered.find(item => item.id === id);
  if (!source) return ordered;

  const copy = normalizeItem({
    ...source,
    id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    x: clamp(source.x + 2, 0, 100 - source.width),
    y: clamp(source.y + 2, 0, 100 - source.height),
    zIndex: ordered.length,
  });

  return normalizeItems([...ordered, copy]);
}

export function updateItemAt(
  items: SlideItem[],
  id: string,
  updates: Partial<SlideItem>,
): SlideItem[] {
  return normalizeItems(
    items.map(item =>
      item.id === id ? normalizeItem({ ...item, ...updates }) : item,
    ),
  );
}

export function deleteItemAt(items: SlideItem[], id: string): SlideItem[] {
  return normalizeItems(items.filter(item => item.id !== id));
}

export function toggleVisibility(items: SlideItem[], id: string): SlideItem[] {
  return items.map(item =>
    item.id === id
      ? { ...item, visible: !(item.visible ?? true) }
      : item,
  );
}

export function toggleLock(items: SlideItem[], id: string): SlideItem[] {
  return items.map(item =>
    item.id === id ? { ...item, locked: !item.locked } : item,
  );
}

// ─── Multi-selection operations ───────────────────────────────────────────────

export function deleteItems(items: SlideItem[], ids: Set<string>): SlideItem[] {
  return normalizeItems(items.filter(item => !ids.has(item.id)));
}

export function duplicateItems(items: SlideItem[], ids: Set<string>): SlideItem[] {
  const ordered = normalizeItems(items);
  const toDuplicate = ordered.filter(i => ids.has(i.id));
  if (toDuplicate.length === 0) return ordered;

  const copies = toDuplicate.map(source =>
    normalizeItem({
      ...source,
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      x: clamp(source.x + 2, 0, 100 - source.width),
      y: clamp(source.y + 2, 0, 100 - source.height),
      zIndex: ordered.length + Math.random(),
    }),
  );

  return normalizeItems([...ordered, ...copies]);
}

// ─── Slide seed converter ─────────────────────────────────────────────────────

export function convertSlideToItems(slide: Slide): SlideItem[] {
  const items = normalizeItems(slide.items || []);

  const baseMediaUrl =
    slide.type === 'video'
      ? slide.thumbnailUrl || slide.mediaUrl
      : slide.mediaUrl;

  const hasTextSeed =
    slide.type === 'text' &&
    items.some(item => item.type === 'text');

  const hasMediaSeed =
    !!baseMediaUrl && items.some(item => item.mediaUrl === baseMediaUrl);

  if (slide.type === 'text' && slide.content && !hasTextSeed) {
    const slideStyles = slide.styles as Record<string, unknown> | undefined;
    items.push(
      normalizeItem({
        id: `item-${Date.now()}-main-text`,
        type: 'text',
        content: slide.content,
        x: 10,
        y: 20,
        width: 80,
        height: 30,
        zIndex: 0,
        textStyles: {
          fontSize: (slideStyles?.fontSize as number) ?? 48,
          textColor: (slideStyles?.textColor as string) ?? '#ffffff',
          textAlign: (slideStyles?.textAlign as TextStyle['textAlign']) ?? 'center',
          fontWeight: (slideStyles?.fontWeight as TextStyle['fontWeight']) ?? 'bold',
          fontStyle: (slideStyles?.fontStyle as TextStyle['fontStyle']) ?? 'normal',
          lineHeight: (slideStyles?.lineHeight as number) ?? 1.3,
          letterSpacing: (slideStyles?.letterSpacing as number) ?? 0,
          textDecoration: (slideStyles?.textDecoration as string) ?? '',
          fontFamily: slideStyles?.fontFamily as string | undefined,
        },
        styles: undefined,
      }),
    );
  }

  if (
    (slide.type === 'image' || slide.type === 'video') &&
    baseMediaUrl &&
    !hasMediaSeed
  ) {
    items.push(
      normalizeItem({
        id: `item-${Date.now()}-main-media`,
        type: 'image',
        mediaUrl: baseMediaUrl,
        x: 5,
        y: 5,
        width: 90,
        height: 90,
        zIndex: 0,
        imageStyles: {
          ...DEFAULT_IMAGE_STYLE,
          objectFit: (slide.styles as Record<string, unknown>)?.objectFit as ImageStyle['objectFit'] || 'contain',
        },
        styles: undefined,
      }),
    );
  }

  return normalizeItems(items);
}
