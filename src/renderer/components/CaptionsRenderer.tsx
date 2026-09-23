import { memo } from 'react';
import type { Slide } from '../types';
import { useSttStore } from '../state/useSttStore';
import { layoutCaptions, measureCaptionText } from '../captionDisplay';
function CaptionsRenderer({ slide, width, height }: { slide: Slide; width: number; height: number; scale: number }) {
  const state = useSttStore();
  const layout = layoutCaptions(slide, state, measureCaptionText);
  return <svg width={width} height={height} viewBox="0 0 1920 1080" role="img"
    aria-label={layout.rows.map(row => row.text).join('\n')} style={{ display: 'block', background: layout.background }}>
    {layout.band && <rect x={76} y={layout.band.y} width={1768} height={layout.band.height} fill="rgba(0,0,0,.55)" />}
    {layout.rows.map((row, i) => <text key={i} x={960} y={row.y} textAnchor="middle" direction={row.rtl ? 'rtl' : 'ltr'}
      fill={layout.color} opacity={row.opacity} fontSize={row.size} fontFamily={layout.family} fontWeight={row.bold ? 700 : 400}
      style={{ whiteSpace: 'pre' }}>{row.text}</text>)}
  </svg>;
}
export default memo(CaptionsRenderer);
