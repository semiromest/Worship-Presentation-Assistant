import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localResourceUrlToPath, mediaRefToName } from '../shared/mediaTree';

/** Accept existing OS paths and the same local media references as the player. */
export function resolvePosterSource(source: string, mediaDir: string): string | null {
  try {
    const mediaName = mediaRefToName(source);
    if (source.startsWith('local-resource://media/') && !mediaName) return null;
    const prefix = 'local-resource://mediafile/';
    const resolved = mediaName ? path.join(mediaDir, mediaName)
      : source.startsWith(prefix) ? decodeURIComponent(source.slice(prefix.length))
        : source.startsWith('file://') ? fileURLToPath(source)
          : source.startsWith('local-resource://') ? localResourceUrlToPath(source) : source;
    return path.isAbsolute(resolved) ? resolved : null;
  } catch { return null; }
}
