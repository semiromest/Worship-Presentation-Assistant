import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LivePreview } from '../LivePreview';
import { useWatermarkStore } from '../state/useWatermarkStore';
import type { Position, Slide } from '../types';

const SAMPLE_LOGO = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" rx="32" fill="#38bdf8"/><path d="M80 30v100M42 65h76" stroke="#082f49" stroke-width="14" stroke-linecap="round"/></svg>');

export function SettingsAppearancePreview({ authorPosition, authorSize }: { authorPosition: string; authorSize: number }) {
  const { t } = useTranslation();
  const config = useWatermarkStore(state => state.config);
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const node = outer.current;
    if (!node) return;
    const update = () => setScale(node.clientWidth / 1920);
    update(); const observer = new ResizeObserver(update); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const slide = useMemo<Slide>(() => ({ id: 'settings-hymn-preview', type: 'text',
    content: 'Your love lights up the morning\nYour peace will guide our way\nTogether we sing with grateful hearts\nAnd carry hope into each day',
    partsMode: true,
    styles: { fontSize: 72, backgroundColor: '#0f172a', textColor: '#ffffff' },
    group: { id: 'settings-hymn', part: 1, parts: 1, title: 'Sample hymn', author: 'Sample Author' },
  }), []);
  // Render at real 1920×1080 coordinates, then scale the entire canvas uniformly.
  // No preview settings are written back to the presentation or logo store.
  const previewConfig = config.logoDataUrl ? config : { ...config, logoDataUrl: SAMPLE_LOGO, enabled: true, applyToHymns: true };
  return <section id="settings-item-appearance-preview" tabIndex={-1} className="space-y-3 rounded-xl border border-blue-400/20 bg-surface-raised p-4" aria-label={t('settings.appearancePreview')}>
    <h4 className="text-sm font-semibold">{t('settings.appearancePreview')}</h4>
    <div ref={outer} className="relative aspect-video w-full overflow-hidden rounded-lg border border-white/10 bg-black">
      <div className="absolute left-0 top-0 origin-top-left" style={{ width: 1920, height: 1080, transform: `scale(${scale})` }}>
        <LivePreview slide={slide} watermarkConfig={previewConfig} hymnAuthorPosition={authorPosition as Position} hymnAuthorSize={authorSize} isActive={false} />
      </div>
    </div>
    <p className="text-xs leading-relaxed text-white/60">{t(config.logoDataUrl ? 'settings.appearancePreviewHint' : 'settings.appearancePreviewSample')}</p>
  </section>;
}
