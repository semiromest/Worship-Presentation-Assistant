import { memo, useMemo } from 'react';
import type { SlideItem } from '../types';
import { DEFAULT_TEXT_STYLE } from '../editor/editorUtils';

// Text item renderer
export const SlideTextItem = memo(({ item }: { item: SlideItem }) => {
  const styles = item.textStyles ?? DEFAULT_TEXT_STYLE;
  const shadow = styles.textShadow;

  const textShadowStyle = useMemo(
    () =>
      shadow
        ? `${shadow.color || '#000'} ${shadow.offsetX || 0}px ${shadow.offsetY || 0}px ${shadow.blur || 0}px`
        : undefined,
    [shadow]
  );

  return (
    <div
      className="w-full h-full overflow-hidden flex justify-center"
      style={{
        padding: '8px',
        alignItems:
          styles.verticalAlign === 'top' ? 'flex-start' : styles.verticalAlign === 'bottom' ? 'flex-end' : 'center',
        textAlign: styles.textAlign ?? 'center',
      }}
    >
      <span
        style={{
          color: styles.textColor ?? '#ffffff',
          textTransform: styles.textTransform ?? 'none',
          fontSize: `${Math.max(4, styles.fontSize || 32)}px`,
          backgroundColor:
            styles.textHighlight && styles.textHighlight !== 'transparent'
              ? styles.textHighlight
              : (styles.backgroundColor ?? 'transparent'),
          lineHeight: styles.lineHeight || 1.25,
          fontWeight: styles.fontWeight ?? 'normal',
          fontStyle: styles.fontStyle ?? 'normal',
          letterSpacing: styles.letterSpacing ? `${styles.letterSpacing}px` : undefined,
          textDecoration: styles.textDecoration || undefined,
          textShadow: textShadowStyle,
          WebkitTextStroke: styles.textStroke
            ? `${styles.textStroke.width || 0}px ${styles.textStroke.color}`
            : undefined,
          whiteSpace: 'pre-wrap',
          fontFamily: styles.fontFamily,
          width: '100%',
          maxHeight: '100%',
          overflow: 'hidden',
        }}
      >
        {item.content}
      </span>
    </div>
  );
});

SlideTextItem.displayName = 'SlideTextItem';
