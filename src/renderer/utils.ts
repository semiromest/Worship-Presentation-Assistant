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
  const normalized = filePath.replace(/\\/g, '/');
  // Baştaki tekrarlanan '/' karakterlerini sadeleştir (Unix mutlak yollarında
  // file:/// + /path birleşince file:////path gibi hatalı bir sonuç oluşmasını önler)
  const cleanPath = normalized.replace(/^\/+/, '/');
  // Her path segmentini ayrı ayrı encode et (boşluk, Türkçe karakter vb. için).
  // Windows sürücü harfini ("C:") encode etmekten kaçın, yoksa file:///C%3A/... olur.
  const encodedPath = cleanPath
    .split('/')
    .map((segment, i) => (i === 0 && /^[a-zA-Z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/');
  return `file:///${encodedPath}`;
}

// crossOrigin sadece gerçek http(s) kaynaklarda ayarlanmalı. file:// veya data:
// kaynaklarda crossOrigin = 'anonymous' ayarlamak ya görselin hiç yüklenmemesine
// (CORS header'ı olmadığı için onerror tetiklenir) ya da yüklense bile canvas'ın
// "tainted" sayılmasına yol açar — bu da en sondaki toDataURL() çağrısını patlatır.
function applyCorsIfRemote(img: HTMLImageElement, src: string): void {
  if (/^https?:\/\//i.test(src)) {
    img.crossOrigin = 'anonymous';
  }
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

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  function drawImg(img: HTMLImageElement, ...args: number[]) {
    ctx!.drawImage(img, ...(args as [number, number, number, number, number, number, number, number]));
  }

  try {
    ctx.fillStyle = slide.styles?.backgroundColor ?? '#000000';
    ctx.fillRect(0, 0, W, H);
    let hasVisibleContent = false;

    if (slide.type === 'text' && !slide.items?.length) {
      hasVisibleContent = true;
      if (slide.styles?.backgroundImage) {
        try {
          const img = new Image();
          applyCorsIfRemote(img, slide.styles.backgroundImage);
          img.src = slide.styles.backgroundImage;
          await new Promise(r => { img.onload = r; img.onerror = r; });
          drawImg(img, 0, 0, W, H);
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
          applyCorsIfRemote(img, src);
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
            drawImg(img, sx, sy, sw, sh, 0, 0, W, H);
          } else {
            let dw = W, dh = H, dx = 0, dy = 0;
            if (ar > cAr) { dh = W / ar; dy = (H - dh) / 2; }
            else           { dw = H * ar; dx = (W - dw) / 2; }
            drawImg(img, dx, dy, dw, dh);
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
        ctx.fillText(slide.content?.slice(0, 40) || '🖼 Görsel', W / 2, H / 2);
      }

    } else if (slide.type === 'video') {
      hasVisibleContent = true;
      let videoDrawn = false;
      if (slide.thumbnailUrl) {
        try {
          const img = new Image();
          img.src = slide.thumbnailUrl;
          await new Promise<void>((resolve) => {
            if (img.complete && img.width > 0) { resolve(); return; }
            img.onload = () => resolve();
            img.onerror = () => resolve();
          });
          if (img.width > 0 && img.height > 0) {
            const ar = img.width / img.height;
            let dw = W, dh = H, dx = 0, dy = 0;
            const cAr = W / H;
            if (ar > cAr) { dh = W / ar; dy = (H - dh) / 2; }
            else           { dw = H * ar; dx = (W - dw) / 2; }
            drawImg(img, dx, dy, dw, dh);
            videoDrawn = true;
          }
        } catch { /* skip */ }
      }
      if (!videoDrawn) {
        ctx.fillStyle = '#111111';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = '18px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(slide.content?.slice(0, 40) || '▶ Video', W / 2, H / 2);
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
          applyCorsIfRemote(img, firstItem.mediaUrl);
          img.src = firstItem.mediaUrl.startsWith('data:')
            ? firstItem.mediaUrl
            : toFileUrl(firstItem.mediaUrl);
          await new Promise(r => { img.onload = r; img.onerror = r; });
          if (img.width > 0 && img.height > 0) {
            const ar = img.width / img.height;
            const cAr = W / H;
            let dw = W, dh = H, dx = 0, dy = 0;
            if (ar > cAr) { dh = W / ar; dy = (H - dh) / 2; }
            else           { dw = H * ar; dx = (W - dw) / 2; }
            drawImg(img, dx, dy, dw, dh);
          }
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
            applyCorsIfRemote(img, item.mediaUrl);
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
              drawImg(img, x, y, iw, ih);
            }
          } catch { /* skip */ }
        }
      }

      if (!slide.items.some((i) => i.type === 'image' && i.mediaUrl)) {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(slide.content?.slice(0, 40) || 'Düzen Slaytı', W / 2, H / 2);
      }
    }

    // Universal fallback — show a content snippet so user can identify the slide
    if (!hasVisibleContent) {
      const snippet = slide.content?.slice(0, 60) || slide.type;
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(snippet, W / 2, H / 2, W - 24);
    }
  } catch {
    // Entire thumbnail failed — draw a minimal placeholder so it's never null
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(slide.content?.slice(0, 40) || slide.type || 'Slayt', W / 2, H / 2, W - 24);
  }

  // ÖNEMLİ: toDataURL() de hata fırlatabilir (ör. cross-origin bir görsel
  // çizildiyse canvas "tainted" olur ve SecurityError fırlatır). Bu çağrı
  // try/catch'in dışında bırakılmıştı; bu yüzden tek bir slaytta oluşan bu hata
  // tüm fonksiyonu reddediyor ve hiçbir thumbnail (placeholder dahil) üretilmiyordu.
  try {
    return canvas.toDataURL('image/jpeg', 0.65);
  } catch (err) {
    console.error('generateSlideThumbnail: toDataURL başarısız oldu (canvas tainted olabilir):', err);
    return null;
  }
}

// ─── PPTX Import Helpers ───────────────────────────────────────────────────────

export interface PptxSlideResult {
  slideNumber: number;
  imagePath: string;
  width: number;
  height: number;
  format: 'png';
}

export interface PptxImportResult {
  success: boolean;
  slides?: PptxSlideResult[];
  error?: string;
  presentationName: string;
}

/**
 * Convert PPTX import results to Slide format
 */
export function convertPptxToSlides(
  pptxResult: PptxImportResult,
  makeId: () => string = makeSlideId
): Slide[] {
  if (!pptxResult.success || !pptxResult.slides) {
    return [];
  }

  // Sort slides by number (slice -> in-place sort on shallow copy)
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