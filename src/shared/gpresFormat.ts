import { validateGradient } from './generatedBackground';
/** Portable package contract. Hashes detect corruption, not authorship. */
export const GPRES_FORMAT = 'worship-presentation';
export const GPRES_VERSION = 1;
export const GPRES_LIMITS = {
  archive: 2 * 1024 ** 3,
  entries: 10_000,
  total: 4 * 1024 ** 3,
  entry: 512 * 1024 ** 2,
  json: 32 * 1024 ** 2,
  depth: 128,
};
export interface GpresFile {
  path: string;
  size: number;
  sha256: string;
  role: 'document' | 'media';
  mime: string;
}
export interface GpresManifest {
  format: typeof GPRES_FORMAT;
  containerVersion: number;
  documentSchemaVersion: number;
  minimumReaderVersion: number;
  documentId: string;
  revision: string;
  savedAt: string;
  producer: string;
  files: GpresFile[];
  externalDependencies: string[];
}
// ─── Manifest ──────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;
const MAX_MANIFEST_FILES = GPRES_LIMITS.entries - 1;
const MEDIA_PATH = /^media\/[a-f0-9]{64}\.[a-z0-9]{1,10}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const HTTP_URL = /^https?:\/\//;

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value !== '';

function isValidManifestFile(f: any, names: ReadonlySet<string>): boolean {
  if (!f || typeof f.path !== 'string' || names.has(f.path)) return false;
  const document = f.path === 'presentation.json' && f.role === 'document';
  if (!document && !(f.role === 'media' && MEDIA_PATH.test(f.path))) return false;
  return (
    Number.isSafeInteger(f.size) &&
    f.size >= 0 &&
    f.size <= (document ? GPRES_LIMITS.json : GPRES_LIMITS.entry) &&
    SHA256_HEX.test(f.sha256) &&
    typeof f.mime === 'string'
  );
}

export function validateManifest(value: unknown): GpresManifest {
  const m = value as GpresManifest;
  if (
    !m ||
    m.format !== GPRES_FORMAT ||
    m.containerVersion !== GPRES_VERSION ||
    m.documentSchemaVersion !== SCHEMA_VERSION ||
    m.minimumReaderVersion !== SCHEMA_VERSION
  )
    throw new Error('Unsupported .gpres project version');
  if (
    !isNonEmptyString(m.documentId) ||
    !isNonEmptyString(m.revision) ||
    typeof m.savedAt !== 'string' ||
    !Number.isFinite(Date.parse(m.savedAt)) ||
    typeof m.producer !== 'string' ||
    !Array.isArray(m.externalDependencies) ||
    m.externalDependencies.some((x) => typeof x !== 'string' || !HTTP_URL.test(x)) ||
    !Array.isArray(m.files) ||
    m.files.length > MAX_MANIFEST_FILES
  )
    throw new Error('Invalid .gpres manifest');
  const names = new Set<string>();
  for (const f of m.files) {
    if (!isValidManifestFile(f, names)) throw new Error('Invalid .gpres manifest entry');
    if (f.role === 'media' && f.path.slice(6, 70) !== f.sha256) throw new Error('Invalid .gpres media identity');
    names.add(f.path);
  }
  if (!names.has('presentation.json')) throw new Error('Missing .gpres document');
  return m;
}

// ─── Proje belgesi ─────────────────────────────────────────────────────────

const MAX_SLIDES = 10_000;
const MAX_GROUP_DEPTH = 64;
const NONE: readonly string[] = [];

const STYLE_STRINGS = [
  'fontFamily', 'fontWeight', 'fontStyle', 'textDecoration', 'textTransform', 'textColor', 'textHighlight',
  'backgroundColor', 'textAlign', 'verticalAlign', 'objectFit', 'backgroundImage', 'backgroundVideo', 'cropMode',
] as const;
const STYLE_NUMBERS = [
  'fontSize', 'lineHeight', 'letterSpacing', 'opacity', 'backgroundDim', 'backgroundBlur', 'imageBrightness',
  'imageContrast', 'imageBlur', 'imageGrayscale', 'imageSepia', 'blur', 'brightness', 'contrast', 'grayscale',
  'sepia', 'hueRotate',
] as const;
const STYLE_BOOLEANS = ['backgroundExplicit', 'imageFlipX', 'imageFlipY', 'flipX', 'flipY'] as const;
const EFFECT_KEYS = ['textShadow', 'textStroke', 'dropShadow', 'crop'] as const;
const EFFECT_STRINGS = ['color'] as const;
const EFFECT_NUMBERS = ['x', 'y', 'width', 'height', 'blur', 'offsetX', 'offsetY'] as const;
const GRADIENT_TYPES: ReadonlySet<string> = new Set(['linear', 'radial']);

const ROOT_STRINGS = ['id', 'name', 'liveSlideId'] as const;
const ROOT_NUMBERS = ['zoom', 'liveIndex'] as const;
const SECTION_STRINGS = ['id', 'title', 'time', 'color', 'icon'] as const;
const SECTION_BOOLEANS = ['unassigned'] as const;
const SLIDE_STRINGS = ['mediaUrl', 'thumbnailUrl', 'sectionId', 'operatorNotes'] as const;
const SLIDE_NUMBERS = ['gridSize', 'activePart'] as const;
const SLIDE_BOOLEANS = ['locked', 'gridEnabled', 'snapEnabled'] as const;
const PLAYBACK_NUMBERS = ['startSeconds', 'endSeconds', 'speed', 'volume'] as const;
const PLAYBACK_BOOLEANS = ['loop', 'muted'] as const;
const ITEM_STRINGS = ['content', 'mediaUrl'] as const;
const ITEM_NUMBERS = ['rotation', 'borderWidth', 'borderRadius'] as const;
const ITEM_BOOLEANS = ['locked', 'visible'] as const;
const GEOMETRY_KEYS = ['x', 'y', 'width', 'height', 'zIndex'] as const;
const SLIDE_TYPES: ReadonlySet<string> = new Set(['text', 'image', 'video', 'countdown', 'screen', 'loop', 'captions']);
const ITEM_TYPES: ReadonlySet<string> = new Set(['text', 'image', 'shape', 'group']);
const LOOP_TYPES: ReadonlySet<string> = new Set(['image', 'video']);

const isObject = (value: any): boolean => !!value && typeof value === 'object' && !Array.isArray(value);

function fields(value: any, strings: readonly string[], numbers: readonly string[] = NONE, booleans: readonly string[] = NONE): void {
  if (!isObject(value)) throw new Error('Invalid project object');
  for (const key of strings)
    if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error(`Invalid project string: ${key}`);
  for (const key of numbers)
    if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key])))
      throw new Error(`Invalid project number: ${key}`);
  for (const key of booleans)
    if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error(`Invalid project boolean: ${key}`);
}

function style(value: any): void {
  if (value === undefined) return;
  fields(value, STYLE_STRINGS, STYLE_NUMBERS, STYLE_BOOLEANS);
  for (const key of EFFECT_KEYS)
    if (value[key] !== undefined) fields(value[key], EFFECT_STRINGS, EFFECT_NUMBERS);
  const gradient = value.backgroundGradient ?? value.gradient;
  if (gradient !== undefined) {
    fields(gradient, ['type'], ['angle']);
    if (
      !GRADIENT_TYPES.has(gradient.type) ||
      (gradient.stops !== undefined &&
        (!Array.isArray(gradient.stops) ||
          gradient.stops.some((stop: any) => !isObject(stop) || typeof stop.color !== 'string' || !Number.isFinite(stop.position))))
    )
      throw new Error('Invalid gradient stops');
  }
  if (value.generatedBackground !== undefined) validateGradient(value.generatedBackground);
  if (value.generatedGroupBackground !== undefined) {
    fields(value.generatedGroupBackground, ['image']);
    if (typeof value.generatedGroupBackground.image !== 'string') throw new Error('Invalid group background');
    validateGradient(value.generatedGroupBackground.recipe);
  }
}

function checkIds(items: any[], types: ReadonlySet<string>, ids: Set<string>): void {
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || !types.has(item.type))
      throw new Error('Invalid project item identity');
    ids.add(item.id);
  }
}

function validateSlideItems(slide: any): void {
  const ids = new Set<string>();
  const pending = [
    { items: slide.items, depth: 0 },
    { items: slide.videoOverlays, depth: 0 },
  ];
  while (pending.length) {
    const { items, depth } = pending.pop()!;
    if (items === undefined) continue;
    if (!Array.isArray(items) || depth > MAX_GROUP_DEPTH) throw new Error('Invalid slide items');
    checkIds(items, ITEM_TYPES, ids);
    for (const item of items) {
      fields(item, ITEM_STRINGS, ITEM_NUMBERS, ITEM_BOOLEANS);
      style(item.textStyles);
      style(item.imageStyles);
      style(item.styles);
      for (const key of GEOMETRY_KEYS)
        if (typeof item[key] !== 'number' || !Number.isFinite(item[key])) throw new Error('Invalid item geometry');
      if (item.width < 0 || item.height < 0) throw new Error('Invalid item dimensions');
      pending.push({ items: item.groupItems, depth: depth + 1 });
    }
  }
}

function validateSlide(slide: any): void {
  if (typeof slide.content !== 'string') throw new Error('Invalid slide content');
  fields(slide, SLIDE_STRINGS, SLIDE_NUMBERS, SLIDE_BOOLEANS);
  style(slide.styles);
  if (slide.parts !== undefined && (!Array.isArray(slide.parts) || slide.parts.some((part: any) => typeof part !== 'string')))
    throw new Error('Invalid text parts');
  if (slide.videoPlayback !== undefined) fields(slide.videoPlayback, NONE, PLAYBACK_NUMBERS, PLAYBACK_BOOLEANS);
  if (slide.items !== undefined || slide.videoOverlays !== undefined) validateSlideItems(slide);
  if (slide.loopItems !== undefined) {
    if (!Array.isArray(slide.loopItems)) throw new Error('Invalid loop');
    checkIds(slide.loopItems, LOOP_TYPES, new Set());
    for (const item of slide.loopItems)
      if (typeof item.mediaUrl !== 'string' || !Number.isFinite(item.duration) || item.duration < 0)
        throw new Error('Invalid loop media');
  }
}

/** Strict checks for new packages only; legacy import retains its tolerant parser.
 * Unknown optional properties survive round trips. */
export function validateProject(data: any): void {
  if (!data || typeof data.name !== 'string' || !Array.isArray(data.slides) || data.slides.length > MAX_SLIDES)
    throw new Error('Invalid project document');
  fields(data, ROOT_STRINGS, ROOT_NUMBERS);
  if (data.sections !== undefined) {
    if (!Array.isArray(data.sections)) throw new Error('Invalid sections');
    const ids = new Set<string>();
    for (const section of data.sections) {
      fields(section, SECTION_STRINGS, NONE, SECTION_BOOLEANS);
      if (!section.id || ids.has(section.id) || typeof section.title !== 'string') throw new Error('Invalid section');
      ids.add(section.id);
    }
  }
  checkIds(data.slides, SLIDE_TYPES, new Set());
  for (const slide of data.slides) validateSlide(slide);
}
