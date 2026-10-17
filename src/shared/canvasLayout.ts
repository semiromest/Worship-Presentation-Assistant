interface FitRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}
interface CoverRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}
export function calculateFit(imgW: number, imgH: number, canvasW: number, canvasH: number): FitRect {
  const imgAr = imgW / imgH;
  const cAr = canvasW / canvasH;
  if (imgAr > cAr) {
    const dh = canvasW / imgAr;
    return { dx: 0, dy: (canvasH - dh) / 2, dw: canvasW, dh };
  }
  const dw = canvasH * imgAr;
  return { dx: (canvasW - dw) / 2, dy: 0, dw, dh: canvasH };
}

export function calculateCover(imgW: number, imgH: number, canvasW: number, canvasH: number): CoverRect {
  const imgAr = imgW / imgH;
  const cAr = canvasW / canvasH;
  if (imgAr > cAr) {
    const sw = imgH * cAr;
    return { sx: (imgW - sw) / 2, sy: 0, sw, sh: imgH };
  }
  const sh = imgW / cAr;
  return { sx: 0, sy: (imgH - sh) / 2, sw: imgW, sh };
}

export function wrapCanvasText(
  ctx: { measureText(text: string): { width: number } },
  text: string,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim().length === 0) {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}
export interface CanvasTextStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  fontStyle?: string;
  textAlign?: string;
  verticalAlign?: string;
  lineHeight?: number;
  textTransform?: string;
}

/** Pure typography calculations; canvas/font loading belongs to each adapter. */
export function canvasTypography(styles: CanvasTextStyle, width: number, minimumFontSize = 8) {
  const family =
    styles.fontFamily && styles.fontFamily !== 'inherit' ? styles.fontFamily.split(',')[0].trim() : 'sans-serif';
  const fontSize = Math.max(minimumFontSize, (styles.fontSize || 48) * (width / 1920));
  const weight = styles.fontWeight || 'bold';
  const italic = styles.fontStyle === 'italic' ? 'italic ' : '';
  return {
    fontSize,
    family,
    font: italic + weight + ' ' + fontSize + 'px ' + family,
    textAlign: styles.textAlign || 'center',
    verticalAlign: styles.verticalAlign || 'center',
    lineHeight: (styles.lineHeight ?? 1.3) * fontSize,
    padding: 20 * (width / 1920),
  };
}

export function canvasLinePlacement(
  style: ReturnType<typeof canvasTypography>,
  lineCount: number,
  width: number,
  height: number
) {
  const totalHeight = lineCount * style.lineHeight;
  const startY =
    style.verticalAlign === 'top'
      ? style.padding
      : style.verticalAlign === 'bottom'
        ? height - style.padding - totalHeight
        : (height - totalHeight) / 2;
  const x =
    style.textAlign === 'center' ? width / 2 : style.textAlign === 'right' ? width - style.padding : style.padding;
  return { startY, x, leading: (style.lineHeight - style.fontSize) / 2 };
}
