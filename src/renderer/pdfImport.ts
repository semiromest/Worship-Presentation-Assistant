import type { PptxImportResult } from './utils';

/** Longest page edge after rasterizing; 1920 keeps 16:9 decks at full HD. */
const TARGET_LONG_EDGE = 1920;
const MAX_SCALE = 4;

type Progress = { current: number; total: number };
const listeners = new Set<(progress: Progress) => void>();

/** PDF pages are rendered in the renderer, so progress is reported here instead of over IPC. */
export function onPdfImportProgress(listener: (progress: Progress) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function emit(progress: Progress) {
  for (const listener of listeners) listener(progress);
}

/** Scale that fits the page's longest edge to TARGET_LONG_EDGE. */
export function pdfPageScale(width: number, height: number, target = TARGET_LONG_EDGE): number {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= 0) return 1;
  return Math.min(MAX_SCALE, target / longest);
}

function canvasToBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('Could not encode PDF page')); return; }
      blob.arrayBuffer().then(buffer => resolve(new Uint8Array(buffer)), reject);
    }, 'image/jpeg', 0.92);
  });
}

/**
 * Rasterizes every page of a user-picked PDF into the media library and
 * returns a PPTX-shaped result so the normal import path (new / append,
 * documentChanged guards, undo) handles the slides.
 */
export async function importPdfFile(filePath: string, name: string): Promise<PptxImportResult> {
  const api = window.electronAPI;
  if (!api?.pdfRead || !api.pdfStorePage) throw new Error('PDF import is unavailable');
  const data = await api.pdfRead(filePath);
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const slides: NonNullable<PptxImportResult['slides']> = [];
  const warnings: string[] = [];
  try {
    const total = doc.numPages;
    emit({ current: 0, total });
    for (let pageNumber = 1; pageNumber <= total; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: pdfPageScale(base.width, base.height) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable');
      // PDF pages assume white paper; the canvas starts transparent.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      try {
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const ref = await api.pdfStorePage(await canvasToBytes(canvas), 'jpg');
        // `format` is the PPTX result's fixed tag; the stored file is a JPEG ref.
        if (ref) slides.push({ slideNumber: pageNumber, imageData: ref, width: canvas.width, height: canvas.height, format: 'png' });
        else warnings.push(`Page ${pageNumber} could not be saved`);
      } finally {
        page.cleanup();
        canvas.width = 0;
        canvas.height = 0;
      }
      emit({ current: pageNumber, total });
    }
  } finally {
    await doc.destroy();
  }
  return { success: slides.length > 0, slides, warnings, presentationName: name, ...(slides.length ? {} : { error: 'No pages could be imported' }) };
}
