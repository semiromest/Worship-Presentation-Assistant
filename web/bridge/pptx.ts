// PowerPoint export in the browser: the shared deck builder
// (src/shared/pptxExport.ts) with media read from the web media store.
import { buildPresentationPptx } from '../../src/shared/pptxExport';
import { readMedia, mediaKeyOf } from './media';
import { saveBlob, safeName } from './files';
import { emit } from './events';

const PPTX_TYPES = [{ description: 'PowerPoint', accept: { 'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'] } }];

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

async function resolveImage(url?: string): Promise<string | null> {
  if (!url) return null;
  try {
    if (url.startsWith('data:')) return url;
    let blob: Blob | null = null;
    if (mediaKeyOf(url) || url.startsWith('blob:')) blob = await readMedia(url);
    else if (/^https?:\/\//.test(url)) {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      blob = response.ok ? await response.blob() : null;
    }
    return blob ? blobToDataUrl(blob) : null;
  } catch {
    return null;
  }
}

let busy = false;

export async function exportPptx(content: string) {
  if (busy) return { success: false, error: 'An export is already running' };
  busy = true;
  try {
    const data = JSON.parse(content);
    let result = { slideCount: 0, warnings: [] as string[] };
    const name = await saveBlob(async () => {
      const { pptx, slideCount, warnings } = await buildPresentationPptx(data, resolveImage, (current, total) =>
        emit('pptx-export-progress', { current, total }));
      result = { slideCount, warnings };
      return await pptx.write({ outputType: 'blob' }) as Blob;
    }, `${safeName(data?.name ?? 'presentation')}.pptx`, PPTX_TYPES);
    if (!name) return { success: false, canceled: true };
    return { success: true, filePath: name, ...result };
  } catch (error) {
    console.error('[web pptx export]', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    busy = false;
  }
}
