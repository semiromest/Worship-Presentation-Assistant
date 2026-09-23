import type { Slide } from '../renderer/types';

export function moveSelectedInOrder<T extends { id: string }>(slides: T[], selected: Set<string>, direction: -1 | 1): T[] {
  const result = [...slides];
  let changed = false;
  const start = direction === -1 ? 1 : result.length - 2;
  for (let i = start; i >= 0 && i < result.length; i -= direction) {
    const neighbor = i + direction;
    if (neighbor < 0 || neighbor >= result.length) continue;
    if (selected.has(result[i].id) && !selected.has(result[neighbor].id)) {
      [result[i], result[neighbor]] = [result[neighbor], result[i]];
      changed = true;
    }
  }
  return changed ? result : slides;
}

export function assignSection(slides: Slide[], selected: Set<string>, section?: Slide['section']): Slide[] {
  const moved = slides.filter(s => selected.has(s.id)).map(s => ({ ...s, section }));
  if (!moved.length) return slides;
  const rest = slides.filter(s => !selected.has(s.id));
  let index = rest.length;
  if (section) {
    const last = rest.map(s => s.section?.id).lastIndexOf(section.id);
    if (last >= 0) index = last + 1;
  }
  rest.splice(index, 0, ...moved);
  return rest;
}

export function sectionGroups(slides: Slide[]) {
  const groups: { id: string; title: string; slides: Slide[] }[] = [];
  for (const slide of slides) {
    const id = slide.section?.id ?? '';
    const last = groups[groups.length - 1];
    if (last?.id === id) last.slides.push(slide);
    else groups.push({ id, title: slide.section?.title ?? '', slides: [slide] });
  }
  return groups;
}

export function moveSection(slides: Slide[], groupIndex: number, direction: -1 | 1): Slide[] {
  const groups = sectionGroups(slides);
  const target = groupIndex + direction;
  if (target < 0 || target >= groups.length) return slides;
  [groups[groupIndex], groups[target]] = [groups[target], groups[groupIndex]];
  return groups.flatMap(g => g.slides);
}
