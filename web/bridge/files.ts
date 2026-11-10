// Open/save `.gpres` projects with the File System Access API when available
// (Chrome/Edge), falling back to a download and the classic file input.
import { readGpres, writeGpres, MissingMediaError } from './gpres';
import { pickFiles } from './media';
import { notify } from './dialogs';

const GPRES_TYPES = [{ description: 'Worship Presentation Assistant', accept: { 'application/octet-stream': ['.gpres'] } }];
type SaveHandle = {
  name: string;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  remove?: () => Promise<void>;
};
const fsAccess = window as unknown as {
  showSaveFilePicker?: (options: object) => Promise<SaveHandle>;
  showOpenFilePicker?: (options: object) => Promise<{ getFile(): Promise<File> }[]>;
};
const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';
const safeName = (name: string) => (name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Presentation').slice(0, 120);

export async function saveProject(content: string): Promise<string | null> {
  try {
    return await saveBlob(() => writeGpres(content), `${safeName(JSON.parse(content)?.name ?? '')}.gpres`, GPRES_TYPES);
  } catch (error) {
    if (error instanceof MissingMediaError) await notify('missingMedia', error.items.join('\n'));
    else { console.error('[web save]', error); await notify('saveFailed', String((error as Error)?.message ?? error)); }
    return null;
  }
}

/**
 * Asks where to save first — the browser only shows the dialog right after the click — then
 * builds the file. Falls back to a download. Resolves to the file name, or null when cancelled;
 * errors from `produce` propagate (a file created by the dialog is removed again).
 */
export async function saveBlob(produce: () => Promise<Blob>, name: string, types: object[]): Promise<string | null> {
  let handle: SaveHandle | null = null;
  if (fsAccess.showSaveFilePicker) {
    try {
      handle = await fsAccess.showSaveFilePicker({ suggestedName: name, types });
    } catch (error) {
      if (isAbort(error)) return null;
      console.warn('[web save] file picker failed, downloading instead', error);
    }
  }
  if (handle) {
    let blob: Blob;
    try {
      blob = await produce();
    } catch (error) {
      await handle.remove?.().catch(() => {});
      throw error;
    }
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return handle.name;
  }
  const blob = await produce();
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return name;
}

export { safeName };

async function chooseProjectFile(): Promise<File | null> {
  if (fsAccess.showOpenFilePicker) {
    try {
      const [handle] = await fsAccess.showOpenFilePicker({ types: GPRES_TYPES, multiple: false });
      return handle ? await handle.getFile() : null;
    } catch (error) {
      if (isAbort(error)) return null;
    }
  }
  return (await pickFiles('any', false, '.gpres'))[0] ?? null;
}

export async function openProject(): Promise<{ content: string; path: string } | null> {
  const file = await chooseProjectFile();
  if (!file) return null;
  try {
    return { content: await readGpres(file), path: file.name };
  } catch (error) {
    console.error('[web open]', error);
    await notify('openFailed', String((error as Error)?.message ?? error));
    return null;
  }
}

/** Reads text files (Zefania XML, hymn archives) chosen by the user. */
export async function readTextFiles(accept: string, multiple: boolean, directory = false): Promise<{ name: string; content: string; path: string }[]> {
  const files = await new Promise<File[]>(resolve => {
    if (!directory) { void pickFiles('any', multiple, accept).then(resolve); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.hidden = true;
    document.body.append(input);
    let settled = false;
    const finish = (value: File[]) => { if (settled) return; settled = true; input.remove(); resolve(value); };
    input.addEventListener('cancel', () => finish([]), { once: true });
    input.addEventListener('change', () => finish([...(input.files ?? [])]), { once: true });
    input.click();
  });
  const wanted = files.filter(file => !accept || accept.split(',').some(ext => file.name.toLowerCase().endsWith(ext.trim())));
  return Promise.all(wanted.map(async file => ({ name: file.name, content: await file.text(), path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name })));
}
