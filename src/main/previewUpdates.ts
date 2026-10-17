export interface PreviewUpdate {
  i: number;
  url: string;
}

/** Deltas only address slots established by the latest full preview snapshot. */
export function applyPreviewUpdates(previews: string[], input: unknown): PreviewUpdate[] {
  if (!Array.isArray(input)) return [];
  const applied: PreviewUpdate[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;
    const { i, url } = entry as Partial<PreviewUpdate>;
    if (typeof i !== 'number' || !Number.isSafeInteger(i) || i < 0 || i >= previews.length || typeof url !== 'string') continue;
    if (previews[i] === url) continue;
    previews[i] = url;
    applied.push({ i, url });
  }
  return applied;
}
