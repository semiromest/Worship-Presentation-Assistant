import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useEffect, useState, useRef } from 'react';
import type { Slide } from './types';

// ─── Tailwind merge helper ────────────────────────────────────────────────────

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ─── ID / path helpers ────────────────────────────────────────────────────────

export function makeSlideId(): string {
  return Math.random().toString(36).substring(2, 11);
}

export function toFileUrl(filePath: string): string {
  return new URL(`file:///${filePath.replace(/\\/g, '/')}`).toString();
}

// ─── React Hooks ─────────────────────────────────────────────────────────────

export function useDebounce<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function useThrottle<T>(value: T, limit = 200): T {
  const [throttledValue, setThrottledValue] = useState(value);
  const lastCall = useRef(Date.now());

  useEffect(() => {
    const handler = setTimeout(() => {
      if (Date.now() - lastCall.current >= limit) {
        setThrottledValue(value);
        lastCall.current = Date.now();
      }
    }, limit - (Date.now() - lastCall.current));

    return () => clearTimeout(handler);
  }, [value, limit]);

  return throttledValue;
}

// ─── Slide thumbnail generator ────────────────────────────────────────────────

export async function generateSlideThumbnail(slide: Slide): Promise<string | null> {
  const W = 320, H = 180;

  const supportsOffscreen = typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';
  const canvas: HTMLCanvasElement | OffscreenCanvas = supportsOffscreen
    ? new OffscreenCanvas(W, H)
    : (() => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; })();

  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (supportsOffscreen) {
    ctx = (canvas as OffscreenCanvas).getContext('2d');
  } else {
    ctx = (canvas as HTMLCanvasElement).getContext('2d');
  }
  if (!ctx) return null;

  async function drawImg(img: HTMLImageElement, ...args: number[]): Promise<void> {
    if (supportsOffscreen) {
      const bitmap = await createImageBitmap(img);
      (ctx as OffscreenCanvasRenderingContext2D).drawImage(bitmap, ...(args as [number, number, number, number, number, number, number, number]));
      bitmap.close();
    } else {
      (ctx as CanvasRenderingContext2D).drawImage(img, ...(args as [number, number, number, number, number, number, number, number]));
    }
  }

  // Background
  ctx.fillStyle = slide.styles?.backgroundColor ?? '#000000';
  ctx.fillRect(0, 0, W, H);
  let hasVisibleContent = false;

  if (slide.type === 'text' && !slide.items?.length) {
    hasVisibleContent = true;
    if (slide.styles?.backgroundImage) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = slide.styles.backgroundImage;
        await new Promise(r => { img.onload = r; img.onerror = r; });
        await drawImg(img, 0, 0, W, H);
      } catch { /* skip */ }
    }
    const fs = Math.max(8, Math.min(20, (slide.styles?.fontSize ?? 48) * 0.32));
    const ff = slide.styles?.fontFamily && slide.styles.fontFamily !== 'inherit' ? slide.styles.fontFamily.split(',')[0].trim() : 'sans-serif';
    ctx.fillStyle = slide.styles?.textColor ?? '#ffffff';
    ctx.font = `bold ${fs}px ${ff}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = slide.content.split('\n').slice(0, 8);
    const lh = fs * 1.35;
    const startY = H / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line.trim(), W / 2, startY + i * lh, W - 24);
    });

  } else if (slide.type === 'image' && (slide.mediaUrl || slide.thumbnailUrl)) {
    hasVisibleContent = true;
    const sources = [slide.thumbnailUrl, slide.mediaUrl].filter(Boolean) as string[];
    let drawn = false;
    for (const src of sources) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = src.startsWith('data:') ? src : toFileUrl(src);
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
        if (!img.width || !img.height) continue;
        const ar = img.width / img.height;
        const cAr = W / H;
        if (slide.styles?.objectFit === 'cover') {
          let sx = 0, sy = 0, sw = img.width, sh = img.height;
          if (ar > cAr) { sw = img.height * cAr; sx = (img.width - sw) / 2; }
          else           { sh = img.width / cAr;  sy = (img.height - sh) / 2; }
          await drawImg(img, sx, sy, sw, sh, 0, 0, W, H);
        } else {
          let dw = W, dh = H, dx = 0, dy = 0;
          if (ar > cAr) { dh = W / ar; dy = (H - dh) / 2; }
          else           { dw = H * ar; dx = (W - dw) / 2; }
          await drawImg(img, dx, dy, dw, dh);
        }
        drawn = true;
        break;
      } catch { /* try next source */ }
    }
    if (!drawn) {
      ctx.fillStyle = '#111111';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🖼', W / 2, H / 2);
    }

  } else if (slide.type === 'video') {
    hasVisibleContent = true;
    if (slide.thumbnailUrl) {
      const img = new Image();
      img.src = slide.thumbnailUrl;
      const drawVideoThumb = async () => {
        const ar = img.width / img.height;
        let dw = W, dh = H, dx = 0, dy = 0;
        const cAr = W / H;
        if (ar > cAr) { dh = W / ar; dy = (H - dh) / 2; }
        else           { dw = H * ar; dx = (W - dw) / 2; }
        await drawImg(img, dx, dy, dw, dh);
      };
      const drawVideoFallback = () => {
        ctx.fillStyle = '#111111';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = '36px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('▶', W / 2, H / 2);
      };
      if (img.complete) {
        await drawVideoThumb();
      } else {
        img.onload = drawVideoThumb as () => void;
        img.onerror = drawVideoFallback;
      }
    } else {
      ctx.fillStyle = '#111111';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '36px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('▶', W / 2, H / 2);
    }

  } else if (slide.type === 'countdown') {
    hasVisibleContent = true;
    try {
      const data = JSON.parse(slide.content);
      const minutes = data.minutes || 0;
      const seconds = data.seconds || 0;
      const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      const fs = Math.max(8, Math.min(40, (slide.styles?.fontSize ?? 120) * 0.32));
      ctx.fillStyle = slide.styles?.textColor ?? '#ffffff';
      ctx.font = `bold ${fs}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(timeStr, W / 2, H / 2);
    } catch {
      ctx.fillStyle = slide.styles?.textColor ?? '#ffffff';
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Geri Sayım', W / 2, H / 2);
    }

  } else if (slide.type === 'screen') {
    hasVisibleContent = true;
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(59,130,246,0.15)';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🖥️ Ekran Yakalama', W / 2, H / 2 - 10);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(slide.content || 'Canlı Ekran', W / 2, H / 2 + 15);

  } else if (slide.type === 'loop') {
    hasVisibleContent = true;
    const firstItem = slide.loopItems?.[0];
    if (firstItem && firstItem.type === 'image') {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = firstItem.mediaUrl.startsWith('data:')
          ? firstItem.mediaUrl
          : toFileUrl(firstItem.mediaUrl);
        await new Promise(r => { img.onload = r; img.onerror = r; });
        const ar = img.width / img.height;
        const cAr = W / H;
        let dw = W, dh = H, dx = 0, dy = 0;
        if (ar > cAr) { dh = W / ar; dy = (H - dh) / 2; }
        else           { dw = H * ar; dx = (W - dw) / 2; }
        await drawImg(img, dx, dy, dw, dh);
      } catch { /* skip */ }
    } else {
      ctx.fillStyle = '#111111';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(168,85,247,0.2)';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔄 Loop', W / 2, H / 2 - 8);
      ctx.font = '11px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(`${slide.loopItems?.length ?? 0} öğe`, W / 2, H / 2 + 10);
    }

  } else if (slide.items?.length) {
    hasVisibleContent = true;
    ctx.fillStyle = slide.styles?.backgroundColor ?? '#000000';
    ctx.fillRect(0, 0, W, H);

    for (const item of slide.items) {
      if (item.type === 'image' && item.mediaUrl) {
        try {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.src = item.mediaUrl.startsWith('data:') ? item.mediaUrl : toFileUrl(item.mediaUrl);
          await new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          });
          if (img.width > 0 && img.height > 0) {
            const x = (item.x / 100) * W;
            const y = (item.y / 100) * H;
            const iw = (item.width / 100) * W;
            const ih = (item.height / 100) * H;
            await drawImg(img, x, y, iw, ih);
          }
        } catch { /* skip */ }
      }
    }

    const hasVisibleImage = slide.items.some((i) => i.type === 'image' && i.mediaUrl);
    if (!hasVisibleImage) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Düzen Slaytı', W / 2, H / 2);
    }
  }

  // Universal fallback: any slide type that fell through gets a visible indicator
  // so the phone never shows a solid-black JPEG
  if (!hasVisibleContent) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Slayt', W / 2, H / 2 - 6);
    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText(slide.type, W / 2, H / 2 + 10);
  }

  if (supportsOffscreen) {
    const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: 0.65 });
    if (!blob) return null;
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }
  return (canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.65);
}

// ─── PPTX Import Helpers ───────────────────────────────────────────────────────

export interface PptxSlideResult {
  slideNumber: number;
  imagePath: string;
  width: number;
  height: number;
  format: 'webp';
}

export interface PptxImportResult {
  success: boolean;
  slides?: PptxSlideResult[];
  error?: string;
  presentationName: string;
}

/**
 * PPTX import sonuçlarını Slide formatına dönüştürür
 */
export function convertPptxToSlides(
  pptxResult: PptxImportResult,
  makeId: () => string = makeSlideId
): Slide[] {
  if (!pptxResult.success || !pptxResult.slides) {
    return [];
  }

  // Slaytları numaraya göre sırala (slice -> in-place sort on shallow copy)
  const sortedSlides = pptxResult.slides.slice();
  sortedSlides.sort((a, b) => a.slideNumber - b.slideNumber);

  // Map to Slide objects lazily and avoid unnecessary allocations where possible
  return sortedSlides.map((pptxSlide) => ({
    id: makeId(),
    type: 'image' as const,
    content: `Slayt ${pptxSlide.slideNumber}`,
    mediaUrl: pptxSlide.imagePath,
    thumbnailUrl: pptxSlide.imagePath, // PPTX slaytları için thumbnail aynı olabilir
    styles: {
      fontSize: 48,
      backgroundColor: '#000000',
      textColor: '#ffffff',
      objectFit: 'contain' as const,
    },
  }));
}
