export interface Hymn {
  id: string;
  title: string;
  lyrics: string;
}

/**
 * Merges imported hymns into the existing list, replacing stale cached entries.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i');
}

export function mergeImportedHymns(existing: Hymn[], imported: Hymn[]): Hymn[] {
  if (imported.length === 0) return existing;

  const indexByTitle = new Map<string, number>();
  existing.forEach((h, i) => indexByTitle.set(normalizeTitle(h.title), i));

  const result = [...existing];
  for (const fresh of imported) {
    const idx = indexByTitle.get(normalizeTitle(fresh.title));
    if (idx !== undefined) {
      result[idx] = fresh;
    } else {
      indexByTitle.set(normalizeTitle(fresh.title), result.length);
      result.push(fresh);
    }
  }
  return result;
}
