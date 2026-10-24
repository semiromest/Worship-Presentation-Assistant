import type { CSSProperties } from 'react';
import type { Slide } from '../types';
import { hymnCreditFontSize, formatHymnCredit, readHymnAuthorPosition, readHymnAuthorSize } from '../hymnAuthorSettings';
import { useWatermarkStore } from '../state/useWatermarkStore';
import { WatermarkOverlay } from './WatermarkOverlay';

/** Decorations scale with the slide, independently of the card's UI badges. */
export function SlideCardOverlays({ slide, width }: { slide: Slide; width: number }) {
  const config = useWatermarkStore(state => state.config);
  const credit = slide.type === 'text' && (slide.partsMode || !slide.items?.length)
    ? formatHymnCredit(slide.group) : '';
  const scale = width / 1920;
  const position = readHymnAuthorPosition();
  const top = position.startsWith('top');
  const bottomCenterLogo = config.enabled && config.logoDataUrl && config.position === 'bottom-center';
  const sideLogo = config.enabled && config.logoDataUrl &&
    (config.position === 'bottom-left' || config.position === 'bottom-right');
  const creditStyle: CSSProperties = {
    position: 'absolute', zIndex: 10,
    fontSize: hymnCreditFontSize(readHymnAuthorSize(), scale),
    color: slide.styles?.textColor || '#fff', opacity: 0.7,
    padding: `${20 * scale}px ${(sideLogo && !top ? 28 : 20) * scale}px`,
    [top ? 'top' : 'bottom']: (!top && bottomCenterLogo ? 13 : 3) * scale,
    ...(position.endsWith('left') ? { left: 0, textAlign: 'left' } :
      position.endsWith('right') ? { right: 0, textAlign: 'right' } :
        { left: 0, right: 0, textAlign: 'center' }),
  };
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {credit && <span data-slide-credit="" style={creditStyle}>{credit}</span>}
      <WatermarkOverlay slide={slide} config={config} />
    </div>
  );
}
