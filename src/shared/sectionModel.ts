import type { Presentation, PresentationSection, Slide } from '../renderer/types';

export const SECTION_COLORS = ['#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#22d3ee'];
export const SECTION_ICONS = ['•', '♫', '✦', '☀', '☷', '✝'];
export const UNASSIGNED_DESTINATION = '__new_unassigned';

/** Migrate legacy tags and repair disjoint runs without changing playback order.
 * Deterministic IDs keep repeated loads and cross-window normalization stable.
 */
export function normalizeSections(deck: Presentation): Presentation {
  const records = new Map<string, PresentationSection>();
  for (const section of Array.isArray(deck.sections) ? deck.sections : []) {
    if (
      section &&
      typeof section.id === 'string' &&
      section.id &&
      typeof section.title === 'string' &&
      !records.has(section.id)
    ) {
      records.set(section.id, {
        id: section.id,
        title: section.title,
        ...(section.unassigned ? { unassigned: true } : {}),
        ...(SECTION_COLORS.includes(section.color ?? '') ? { color: section.color } : {}),
        ...(SECTION_ICONS.includes(section.icon ?? '') ? { icon: section.icon } : {}),
      });
    }
  }
  const sourceOrder = [...records.keys()];
  const used = new Set<string>();
  const ordered: PresentationSection[] = [];
  let previousSource: string | undefined;
  let current: PresentationSection | undefined;
  const slides = deck.slides.map((slide) => {
    const legacy =
      slide.section && typeof slide.section.id === 'string' && typeof slide.section.title === 'string'
        ? slide.section
        : undefined;
    const source = (typeof slide.sectionId === 'string' && slide.sectionId) || legacy?.id || '__unassigned';
    if (!current || source !== previousSource) {
      const record = records.get(source) ?? {
        id: source,
        title: legacy?.title ?? '',
        ...(!legacy ? { unassigned: true } : {}),
      };
      let id = source;
      if (used.has(id)) {
        id = `${source}~${slide.id}`;
        while (used.has(id) || records.has(id)) id += '~';
      }
      current = id === record.id ? record : { ...record, id };
      records.set(id, current);
      used.add(id);
      ordered.push(current);
    }
    previousSource = source;
    const section = { id: current.id, title: current.title };
    return slide.sectionId === current.id && slide.section?.id === section.id && slide.section?.title === section.title
      ? slide
      : { ...slide, sectionId: current.id, section };
  });
  // Keep deliberately empty sections anchored before their next nonempty peer.
  for (let i = 0; i < sourceOrder.length; i++) {
    const id = sourceOrder[i];
    if (used.has(id)) continue;
    const next = sourceOrder.slice(i + 1).find((key) => used.has(key));
    const index = next ? ordered.findIndex((s) => s.id === next) : ordered.length;
    ordered.splice(index, 0, records.get(id)!);
  }
  const sameSections = JSON.stringify(deck.sections) === JSON.stringify(ordered);
  const sameSlides = slides.every((slide, i) => slide === deck.slides[i]);
  return sameSections && sameSlides
    ? deck
    : { ...deck, sections: sameSections ? deck.sections : ordered, slides: sameSlides ? deck.slides : slides };
}

export function getSectionBlocks(deck: Presentation) {
  const buckets = new Map<string, Slide[]>();
  for (const slide of deck.slides) {
    const id = slide.sectionId ?? '';
    const bucket = buckets.get(id) ?? [];
    bucket.push(slide);
    buckets.set(id, bucket);
  }
  let start = 0;
  return (deck.sections ?? []).map((section) => {
    const slides = buckets.get(section.id) ?? [];
    const block = { ...section, slides, start, end: start + slides.length - 1 };
    start += slides.length;
    return block;
  });
}

function rebuild(deck: Presentation, sections: PresentationSection[], slides: Slide[]): Presentation {
  const buckets = new Map<string, Slide[]>();
  for (const slide of slides) {
    const bucket = buckets.get(slide.sectionId!) ?? [];
    bucket.push(slide);
    buckets.set(slide.sectionId!, bucket);
  }
  return normalizeSections({ ...deck, sections, slides: sections.flatMap((s) => buckets.get(s.id) ?? []) });
}

export function sectionSplitRange(deck: Presentation, slideId: string) {
  const start = deck.slides.findIndex((s) => s.id === slideId);
  if (start < 0) return null;
  const id = deck.slides[start].sectionId;
  let end = start;
  while (end + 1 < deck.slides.length && deck.slides[end + 1].sectionId === id) end++;
  return { start, end, sectionId: id, count: end - start + 1 };
}

/** A boundary where starting a section actually changes the deck. */
export interface SectionInsertionPoint {
  /** Stable identity for renders and focus keys. */
  key: string;
  /** The new section would begin at this slide (a suffix split). Absent at the deck end. */
  beforeSlideId?: string;
  /** An empty section would be inserted before this section; absent appends at the end. */
  beforeSectionId?: string;
  /** Slides the split would claim; 0 for the deck-end point. */
  slideCount: number;
  /** True for the trailing point after the last slide. */
  atEnd: boolean;
}

/**
 * Boundaries where creating a section is meaningful. The first slide of a named
 * section is deliberately skipped: `createSectionAt` is a no-op there, so the UI
 * must never offer a point that would silently do nothing.
 */
export function sectionInsertionPoints(deck: Presentation): SectionInsertionPoint[] {
  const points: SectionInsertionPoint[] = [];
  const blocks = getSectionBlocks(deck);
  blocks.forEach((block, blockIndex) => {
    const next = blocks[blockIndex + 1];
    block.slides.forEach((slide, i) => {
      // Only an unassigned run can be named from its first slide.
      if (i === 0 && !block.unassigned) return;
      points.push({
        key: 'before:' + slide.id,
        beforeSlideId: slide.id,
        ...(next ? { beforeSectionId: next.id } : {}),
        slideCount: block.end - (block.start + i) + 1,
        atEnd: false,
      });
    });
  });
  points.push({ key: 'end', slideCount: 0, atEnd: true });
  return points;
}

/**
 * Point a toolbar action should open for a selection: the boundary at that slide
 * when it exists, otherwise the nearest boundary below it, otherwise the deck end.
 */
export function insertionPointForSlide(deck: Presentation, slideId: string): SectionInsertionPoint {
  const points = sectionInsertionPoints(deck);
  const order = new Map(deck.slides.map((slide, index) => [slide.id, index]));
  const index = order.get(slideId);
  if (index === undefined) return points[points.length - 1];
  return (
    points.find(
      (point) => point.beforeSlideId !== undefined && (order.get(point.beforeSlideId) ?? -1) >= index
    ) ?? points[points.length - 1]
  );
}

/** Slides the user has selected, in playback order, restricted to real slides. */
export function selectedSlideIds(deck: Presentation, selection: Iterable<string>): string[] {
  const wanted = new Set(selection);
  return deck.slides.filter((slide) => wanted.has(slide.id)).map((slide) => slide.id);
}

/**
 * Group exactly the selected slides into a new section. Sections are contiguous
 * runs, so the chosen slides are gathered in their existing relative order at the
 * position of the first one; no unselected slide changes its relative order.
 * Selecting a whole existing section renames it in place instead of leaving an
 * empty orphan behind.
 */
export function createSectionFromSelection(
  deck: Presentation,
  selection: Iterable<string>,
  section: PresentationSection
): Presentation {
  const ids = selectedSlideIds(deck, selection);
  if (!ids.length || !section.title.trim() || deck.sections?.some((s) => s.id === section.id)) return deck;
  const chosen = new Set(ids);
  const order = new Map(deck.slides.map((slide, index) => [slide.id, index]));
  const firstIndex = Math.min(...ids.map((id) => order.get(id)!));
  const anchorId = deck.slides[firstIndex].sectionId;
  const sections = [...(deck.sections ?? [])];
  const anchor = sections.findIndex((s) => s.id === anchorId);
  if (anchor < 0) return deck;
  // Every slide of one existing section was chosen: reuse its slot, don't orphan it.
  const whole = deck.slides.filter((slide) => slide.sectionId === anchorId).length === ids.length;
  const created = { ...section, title: section.title.trim() };
  if (whole) sections.splice(anchor, 1, created);
  else sections.splice(anchor + 1, 0, created);
  const moved = deck.slides.filter((slide) => chosen.has(slide.id)).map((slide) => ({ ...slide, sectionId: created.id }));
  const rest = deck.slides.filter((slide) => !chosen.has(slide.id));
  rest.splice(firstIndex, 0, ...moved);
  // normalizeSections (not rebuild) because rebuild regroups slides by section
  // order and would push the new section to the end of the deck. Walking the
  // physical order keeps it where the user picked it, and splits any run that
  // the selection left behind into its own record.
  return normalizeSections({ ...deck, sections, slides: rest });
}

export function createSectionAt(deck: Presentation, slideId: string, section: PresentationSection): Presentation {
  const range = sectionSplitRange(deck, slideId);
  if (!range || !section.title.trim() || deck.sections?.some((s) => s.id === section.id)) return deck;
  const sections = [...(deck.sections ?? [])];
  const sourceIndex = sections.findIndex((s) => s.id === range.sectionId);
  // A named section already beginning here is renamed in the UI, not split.
  if (range.start === 0 || deck.slides[range.start - 1].sectionId !== range.sectionId) {
    if (!sections[sourceIndex]?.unassigned) return deck;
    sections.splice(sourceIndex, 1, { ...section, title: section.title.trim() });
  } else sections.splice(sourceIndex + 1, 0, { ...section, title: section.title.trim() });
  const slides = deck.slides.map((slide, i) =>
    i >= range.start && i <= range.end ? { ...slide, sectionId: section.id } : slide
  );
  return rebuild(deck, sections, slides);
}

export function updateSection(
  deck: Presentation,
  id: string,
  update: Partial<Pick<PresentationSection, 'title' | 'color' | 'icon'>>
): Presentation {
  if (update.title !== undefined && !update.title.trim()) return deck;
  return normalizeSections({
    ...deck,
    sections: deck.sections?.map((s) =>
      s.id === id
        ? { ...s, ...update, ...(update.title !== undefined ? { title: update.title.trim(), unassigned: false } : {}) }
        : s
    ),
  });
}

export function insertEmptySection(
  deck: Presentation,
  beforeId: string | undefined,
  section: PresentationSection
): Presentation {
  if (!section.title.trim() || deck.sections?.some((s) => s.id === section.id)) return deck;
  const sections = [...(deck.sections ?? [])];
  const index = beforeId ? sections.findIndex((s) => s.id === beforeId) : sections.length;
  if (index < 0) return deck;
  sections.splice(index, 0, { ...section, title: section.title.trim() });
  return { ...deck, sections };
}

/** Move membership and physical order atomically. beforeId must belong to target. */
export function moveSlidesToSection(
  deck: Presentation,
  selected: Set<string>,
  targetId: string,
  position: 'start' | 'end' | { beforeId: string }
): Presentation {
  if (!deck.sections?.some((s) => s.id === targetId)) return deck;
  if (
    typeof position === 'object' &&
    (!deck.slides.some((s) => s.id === position.beforeId && s.sectionId === targetId) ||
      selected.has(position.beforeId))
  )
    return deck;
  const moved = deck.slides.filter((s) => selected.has(s.id)).map((s) => ({ ...s, sectionId: targetId }));
  if (!moved.length) return deck;
  const rest = deck.slides.filter((s) => !selected.has(s.id));
  const peers = rest.filter((s) => s.sectionId === targetId);
  const before = typeof position === 'object' ? position.beforeId : position === 'start' ? peers[0]?.id : undefined;
  const index = before
    ? rest.findIndex((s) => s.id === before)
    : peers.length
      ? rest.findIndex((s) => s.id === peers[peers.length - 1].id) + 1
      : rest.length;
  rest.splice(index, 0, ...moved);
  return rebuild(deck, deck.sections, rest);
}

export function moveSectionTo(deck: Presentation, id: string, targetIndex: number): Presentation {
  const sections = [...(deck.sections ?? [])];
  const from = sections.findIndex((s) => s.id === id);
  if (from < 0 || targetIndex < 0 || targetIndex >= sections.length || from === targetIndex) return deck;
  const [section] = sections.splice(from, 1);
  sections.splice(targetIndex, 0, section);
  return rebuild(deck, sections, deck.slides);
}

export function removeSection(deck: Presentation, id: string, targetId?: string, deleteSlides = false): Presentation {
  const source = deck.slides.filter((s) => s.sectionId === id);
  if (!deleteSlides && targetId === UNASSIGNED_DESTINATION) {
    return normalizeSections({
      ...deck,
      sections: deck.sections?.map((s) => (s.id === id ? { id, title: '', unassigned: true } : s)),
    });
  }
  if (deleteSlides && (source.some((s) => s.locked) || source.length === deck.slides.length)) return deck;
  if (!deleteSlides && source.length && (targetId === id || !deck.sections?.some((s) => s.id === targetId)))
    return deck;
  // Merging keeps the target's original side of the source in playback order.
  const slides = deleteSlides
    ? deck.slides.filter((s) => s.sectionId !== id)
    : deck.slides.map((s) => (s.sectionId === id ? { ...s, sectionId: targetId } : s));
  return rebuild(
    deck,
    (deck.sections ?? []).filter((s) => s.id !== id),
    slides
  );
}

/** Existing up/down commands adopt the crossed neighbor's section. */
export function moveSectionSlidesOneStep(deck: Presentation, selected: Set<string>, direction: -1 | 1): Presentation {
  const slides = [...deck.slides];
  for (let i = direction === -1 ? 1 : slides.length - 2; i >= 0 && i < slides.length; i -= direction) {
    const neighbor = i + direction;
    if (neighbor < 0 || neighbor >= slides.length || !selected.has(slides[i].id) || selected.has(slides[neighbor].id))
      continue;
    const moved = { ...slides[i], sectionId: slides[neighbor].sectionId };
    slides[i] = slides[neighbor];
    slides[neighbor] = moved;
  }
  return rebuild(deck, deck.sections ?? [], slides);
}
