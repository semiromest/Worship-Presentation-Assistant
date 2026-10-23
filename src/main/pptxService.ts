import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { SlideImage } from 'pptx-glimpse';
import { runPptxImportWorker } from './pptxImportWorkerClient';
import { storeBytesTo } from './mediaLibrary';

// Constants

const CONCURRENCY = Math.max(2, Math.min(os.cpus().length, 8));
const VALID_EXTS = new Set(['.pptx', '.pptm']);
const IMPORT_TIMEOUT = 120000;

// Types

export type ImageFormat = 'png';

export interface PptxSlideResult {
  slideNumber: number;
  /**
   * Media reference (`local-resource://media/<hash>.png`, Phase 6) of the
   * rendered slide, or the base64 data URI as a fallback when the media
   * library write fails. Either way the slide renders — never data loss.
   */
  imageData: string;
  width: number;
  height: number;
  format: ImageFormat;
}

export interface PptxImportResult {
  success: true;
  slides: PptxSlideResult[];
  presentationName: string;
  warnings?: string[];
}

export interface PptxImportError {
  success: false;
  error: string;
  presentationName: string;
}

export type PptxResult = PptxImportResult | PptxImportError;
export type ProgressCallback = (current: number, total: number) => void;

// Async Worker Pool (Memory Optimized)

/** High-performance pool: allocates only for actively processed slides. */
async function runWithWorkerPool<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      try {
        const value = await task(items[index]);
        results[index] = { status: 'fulfilled', value };
      } catch (error) {
        results[index] = { status: 'rejected', reason: error };
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}

// Service

export class PptxService {
  private validateExtension(filePath: string): void {
    const ext = path.extname(filePath).toLowerCase();
    if (!VALID_EXTS.has(ext)) {
      throw new Error(`Unsupported file type "${ext}" — expected .pptx or .pptm`);
    }
  }

  private async processSlide(
    slide: SlideImage,
    mediaDir: string | null,
    onSlideDone?: () => void
  ): Promise<PptxSlideResult> {
    // Phase 6: write the PNG into the persistent media library so the huge
    // base64 never enters the renderer state / undo / IPC / autosave. Falls
    // back to an inline data URI only if the library write fails.
    let imageData = '';
    if (mediaDir) {
      imageData = (await storeBytesTo(mediaDir, slide.png, 'png')) ?? '';
    }
    if (!imageData) {
      imageData = `data:image/png;base64,${slide.png.toString('base64')}`;
    }

    delete (slide as Partial<SlideImage>).png;

    onSlideDone?.();

    return {
      slideNumber: slide.slideNumber,
      imageData,
      width: slide.width,
      height: slide.height,
      format: 'png',
    };
  }

  async importPptx(
    filePath: string,
    onProgress?: ProgressCallback,
    mediaDir?: string | null
  ): Promise<PptxResult> {
    const presentationName = path.basename(filePath, path.extname(filePath));

    try {
      this.validateExtension(filePath);

      let buffer: Buffer;
      try {
        buffer = await fs.readFile(filePath);
      } catch {
        throw new Error(`File not found or unreadable: "${filePath}"`);
      }

      const rendered = await runPptxImportWorker(buffer, IMPORT_TIMEOUT);
      const slideImages = rendered.slides;
      const total = slideImages.length;

      let completed = 0;
      const reportProgress = () => {
        completed++;
        onProgress?.(completed, total);
      };

      // use our high-performance worker pool
      const settled = await runWithWorkerPool(
        slideImages,
        CONCURRENCY,
        (slide) => this.processSlide(slide, mediaDir ?? null, reportProgress)
      );

      // Pre-allocated array (avoids push cost)
      const slides: PptxSlideResult[] = new Array(total);
      const warnings: string[] = [...rendered.warnings];
      let validCount = 0;

      for (let i = 0; i < settled.length; i++) {
        const result = settled[i];
        if (result.status === 'fulfilled') {
          slides[validCount++] = result.value;
        } else {
          const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
          warnings.push(message);
          console.error(`[PptxService] Slide index ${i} failed:`, message);
        }
      }

      if (validCount !== total) {
        throw new Error('PPTX import incomplete: one or more slides could not be stored');
      }

      // trim the array and sort (ordering guarantee)
      const finalSlides = slides.slice(0, validCount).sort((a, b) => a.slideNumber - b.slideNumber);

      return {
        success: true,
        slides: finalSlides,
        presentationName,
        ...(warnings.length > 0 ? { warnings } : {}),
      };

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[PptxService] importPptx failed:', message);
      return { success: false, error: message, presentationName };
    }
  }
}

// Singleton

let pptxServiceInstance: PptxService | null = null;

export function getPptxService(): PptxService {
  if (!pptxServiceInstance) {
    pptxServiceInstance = new PptxService();
  }
  return pptxServiceInstance;
}

export function resetPptxService(): void {
  pptxServiceInstance = null;
}
