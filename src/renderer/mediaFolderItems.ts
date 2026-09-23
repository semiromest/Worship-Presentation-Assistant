interface FolderItem { id: string; path: string; origin: 'manual' | 'folder' }

/** A refresh replaces folder results, without removing manually imported media. */
export function replaceFolderItems<T extends FolderItem>(previous: T[], incoming: T[]): T[] {
  const key = (path: string) => path.replace(/\\/g, '/');
  const old = new Map(previous.map((item) => [key(item.path), item]));
  const result = previous.filter((item) => item.origin === 'manual');
  const seen = new Set(result.map((item) => key(item.path)));
  for (const item of incoming) {
    if (seen.has(key(item.path))) continue;
    seen.add(key(item.path));
    result.push({ ...item, id: old.get(key(item.path))?.id ?? item.id });
  }
  return result;
}
