import fs from 'node:fs/promises';
import path from 'node:path';
export type TourProfileInfo = { profileKind: 'new' | 'existing' | 'unknown' };
/** Capture before constructing windows or touching Chromium's default session. */
export async function inspectTourProfile(userData: string): Promise<TourProfileInfo> {
  try {
    for (const name of ['Local Storage', 'IndexedDB', 'sessions/Local Storage', 'sessions/IndexedDB', 'presets.json', 'presets']) {
      try { await fs.stat(path.join(userData, name)); return { profileKind: 'existing' }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return { profileKind: 'new' };
  } catch { return { profileKind: 'unknown' }; }
}
export function isTourProfileSender(sender: unknown, frame: unknown, control: { mainFrame: unknown } | null): boolean {
  return !!control && sender === control && frame === control.mainFrame;
}
