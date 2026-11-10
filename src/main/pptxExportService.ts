/**
 * PPTX export service: writes an in-app Presentation to a real .pptx file.
 * The slide conversion lives in src/shared/pptxExport.ts (shared with the web
 * app); this file supplies desktop media reads and the file write. Runs in the
 * heavy utility process so the renderer stays responsive.
 *
 * Faithfulness notes (known limitations):
 *  - Gradients (slide background, item fills) are exported as a solid color.
 *  - CSS image filters (brightness, contrast, blur, grayscale, sepia) and
 *    text strokes are not representable in PPTX and are skipped.
 *  - Video / screen-capture / loop slides are dynamic in the app; they are
 *    exported as a static frame (thumbnail, first loop item, or placeholder).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath as nodeFileURLToPath } from 'node:url';
import type { Presentation } from '../shared/presentation';
import { buildPresentationPptx, type ExportProgressCallback } from '../shared/pptxExport';
import { mediaRefToName } from '../shared/mediaTree';

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.tif': 'image/tiff', '.tiff': 'image/tiff',
};

export interface PptxExportOk {
  success: true;
  filePath: string;
  slideCount: number;
  warnings: string[];
}

export interface PptxExportFail {
  success: false;
  error: string;
}

export type PptxExportResult = PptxExportOk | PptxExportFail;
export type { ExportProgressCallback };

function localResourceUrlToPath(url: string): string {
  return nodeFileURLToPath(url.replace(/^local-resource:\/\//, 'file://'));
}

// Phase 6: media-library refs (local-resource://media/<name>) resolve into
// userData/media. Set per export call (exports are serialized).
let mediaLibraryDir: string | null = null;

/**
 * Resolves a media reference (local-resource://media/<name>, local-resource://,
 * file://, http(s)://, data:, or a plain path) to a base64 data URI so
 * PptxGenJS can embed it.
 */
async function resolveImageData(url?: string): Promise<string | null> {
  if (!url) return null;
  try {
    if (url.startsWith('data:')) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = (res.headers.get('content-type') ?? 'image/png').split(';')[0];
      return `data:${mime};base64,${buf.toString('base64')}`;
    }
    const mediaName = mediaLibraryDir ? mediaRefToName(url) : null;
    const filePath = mediaName
      ? path.join(mediaLibraryDir!, mediaName)
      : url.startsWith('local-resource://')
        ? localResourceUrlToPath(url)
        : url.startsWith('file://')
          ? nodeFileURLToPath(url)
          : url;
    const buf = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    return `data:${MIME_BY_EXT[ext] ?? 'image/png'};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function exportPresentationToPptx(
  presentation: Presentation,
  filePath: string,
  onProgress?: ExportProgressCallback,
  mediaDir?: string | null,
): Promise<PptxExportResult> {
  try {
    mediaLibraryDir = mediaDir ?? null;
    const { pptx, slideCount, warnings } = await buildPresentationPptx(presentation, resolveImageData, onProgress);
    await pptx.writeFile({ fileName: filePath });
    return { success: true, filePath, slideCount, warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[PptxExportService] export failed:', error);
    return { success: false, error: message };
  }
}
