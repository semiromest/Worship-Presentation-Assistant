import fs from 'node:fs/promises';
import { rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { convertPptxToPng, type SlideImage } from 'pptx-glimpse';
import sharp from 'sharp';

// ─── Constants ────────────────────────────────────────────────────────────────

const SLIDE_WIDTH = 1024;
const WEBP_QUALITY = 85;
const WEBP_EFFORT = 4; // 0-6 arası. 4 CPU/Boyut açısından en dengeli olanıdır.
const CONCURRENCY = Math.max(2, Math.min(os.cpus().length, 8));
const VALID_EXTS = new Set(['.pptx', '.ppt']);
const IMPORT_TIMEOUT = 120000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImageFormat = 'webp';

export interface PptxSlideResult {
  slideNumber: number;
  imagePath: string;
  width: number;
  height: number;
  format: ImageFormat;
  savedBytes: number;
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

// ─── Global Sharp Configuration ───────────────────────────────────────────────

sharp.cache(false);
sharp.concurrency(1); // Thread oversubscription engellemesi

// ─── Async Worker Pool (Memory Optimized) ─────────────────────────────────────

/**
 * Bekleyen yüzlerce Promise yaratmak yerine, sadece aktif olarak
 * işlenen slaytlar için bellek ayıran yüksek performanslı havuz.
 */
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

// ─── Service ──────────────────────────────────────────────────────────────────

export class PptxService {
  private readonly sessionId: string;
  private readonly tempDir: string;
  private isInitialized: boolean = false;

  constructor() {
    this.sessionId = randomUUID(); // Tüm slaytlar için tek sefer üret
    this.tempDir = path.join(app.getPath('temp'), 'pptx-imports', this.sessionId);

    app.on('will-quit', () => {
      try {
        rmSync(this.tempDir, { recursive: true, force: true });
      } catch {
        // Sessizce yut
      }
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await fs.mkdir(this.tempDir, { recursive: true });
      this.isInitialized = true;
    }
  }

  private validateExtension(filePath: string): void {
    const ext = path.extname(filePath).toLowerCase();
    if (!VALID_EXTS.has(ext)) {
      throw new Error(`Unsupported file type "${ext}" — expected .pptx or .ppt`);
    }
  }

  /**
   * V8 Heap Bypass uygulanan encode ve kaydetme adımı.
   */
  private async processSlide(
    slide: SlideImage,
    baseName: string,
    onSlideDone?: () => void
  ): Promise<PptxSlideResult> {
    const originalSize = slide.png.length;
    
    // UUID yerine Session ID ve Index birleşimi (String allocation hızlandırması)
    const fileName = `${baseName}-s${slide.slideNumber}-${this.sessionId}.webp`;
    const imagePath = path.join(this.tempDir, fileName);

    // .toFile() ile Buffer'ı V8 belleğine döndürmeden C++ üzerinden diske yaz
    const webpInfo = await sharp(slide.png)
  // Kalite 85 kalabilir (görsellik bozulmaz), ama eforu 1'e çekiyoruz (hız artar)
  .webp({ quality: 85, effort: 1 }) 
  .toFile(imagePath);

    // Hard GC Hint: Buffer referansını anında yok et
    delete (slide as Partial<SlideImage>).png;

    onSlideDone?.();

    return {
      slideNumber: slide.slideNumber,
      imagePath,
      width: webpInfo.width,
      height: webpInfo.height,
      format: 'webp',
      savedBytes: originalSize - webpInfo.size,
    };
  }

  private async convertWithTimeout(buffer: Buffer): Promise<SlideImage[]> {
    let timerId: NodeJS.Timeout | undefined;
    
    try {
      return await Promise.race([
        convertPptxToPng(buffer, { width: SLIDE_WIDTH, logLevel: 'off' }),
        new Promise<never>((_, reject) => {
          timerId = setTimeout(
            () => reject(new Error('PPTX conversion timed out')),
            IMPORT_TIMEOUT
          );
        }),
      ]);
    } finally {
      if (timerId) clearTimeout(timerId);
    }
  }

  async importPptx(
    filePath: string,
    onProgress?: ProgressCallback
  ): Promise<PptxResult> {
    const presentationName = path.basename(filePath, path.extname(filePath));

    try {
      await this.ensureInitialized();
      this.validateExtension(filePath);

      let buffer: Buffer;
      try {
        buffer = await fs.readFile(filePath);
      } catch {
        throw new Error(`File not found or unreadable: "${filePath}"`);
      }

      const slideImages = await this.convertWithTimeout(buffer);
      const total = slideImages.length;

      let completed = 0;
      const reportProgress = () => {
        completed++;
        onProgress?.(completed, total);
      };

      // Yüksek performanslı havuzumuzu (Worker Pool) kullanıyoruz
      const settled = await runWithWorkerPool(
        slideImages,
        CONCURRENCY,
        (slide) => this.processSlide(slide, presentationName, reportProgress)
      );

      // Pre-allocated dizi (Push maliyetinden kaçınmak için)
      const slides: PptxSlideResult[] = new Array(total);
      const warnings: string[] = [];
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

      if (validCount === 0) {
        throw new Error(warnings[0] ?? 'All slides failed to process');
      }

      // Diziyi küçült ve sırala (Sıralama garantisi için)
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

  async cleanup(): Promise<void> {
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
      this.isInitialized = false;
    } catch (error) {
      console.error('[PptxService] cleanup failed:', error);
    }
  }

  async deleteSlideFile(imagePath: string): Promise<void> {
    const resolved = path.resolve(imagePath);
    const sessionDir = path.resolve(this.tempDir) + path.sep;

    if (!resolved.startsWith(sessionDir)) {
      console.warn('[PptxService] Path traversal attempt blocked.');
      return;
    }

    try {
      await fs.unlink(resolved);
    } catch {
      // Ignored - Zaten silinmiş olabilir
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

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