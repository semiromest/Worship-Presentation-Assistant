export const DEFAULT_LIVE_SAVE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function isLiveSavePresetName(name: string): boolean {
  return name === '__live_autosave__' || (name.startsWith('__live_autosave_') && name.endsWith('__'));
}

export function getLiveSaveBaseKey(name: string): string {
  if (!isLiveSavePresetName(name)) return name;
  return name.replace(/^__live_autosave_/, '').replace(/__$/, '');
}

export function prunePresetStore<T extends { name: string; createdAt: number }>(
  list: T[],
  now = Date.now(),
  retentionMs = DEFAULT_LIVE_SAVE_RETENTION_MS,
): T[] {
  const regular: T[] = [];
  const latestLiveByEntry = new Map<string, T>();

  for (const item of list) {
    if (!isLiveSavePresetName(item.name)) {
      regular.push(item);
      continue;
    }

    // retentionMs <= 0 means "keep forever" — only age-prune when > 0.
    if (retentionMs > 0) {
      const age = now - item.createdAt;
      if (age > retentionMs) continue;
    }

    const key = getLiveSaveBaseKey(item.name);
    const current = latestLiveByEntry.get(key);
    if (!current || item.createdAt > current.createdAt) {
      latestLiveByEntry.set(key, item);
    }
  }

  return [...regular, ...Array.from(latestLiveByEntry.values())].sort((a, b) => b.createdAt - a.createdAt);
}

