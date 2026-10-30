import { previewScrollSnapshot, previewScrollSubscribe } from '../scrollPreviewPolicy';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { resolveCanvasSource } from '../canvasSource';
import { canResizePreview, imagePreviewEdge, imagePreviewSources } from '../imagePreviewSource';

export function usePreviewImage(source: string | undefined, width = 320, enabled = true) {
  const target = imagePreviewEdge(width, window.devicePixelRatio);
  const fast = useSyncExternalStore(previewScrollSubscribe, previewScrollSnapshot);
  const [result, setResult] = useState<{ source: string; edge: number; url?: string }>();
  const resize = !!source && canResizePreview(source);
  const retained = result?.source === source ? result : undefined;
  const edge = fast && (!retained || retained.edge < target) && !(resize && imagePreviewSources.peek(source!, target)) ? Math.min(target, 256) : target;
  useEffect(() => {
    if (!enabled || !source || !resize) return;
    let current = true;
    let busy = false, waiting = true;
    const attempt = () => {
      if (!current || busy || !waiting) return;
      busy = true; waiting = false;
      void imagePreviewSources.request(source, edge, () => current).then(url => {
        if (!current) return;
        if (url || imagePreviewSources.peek(source, edge) !== undefined) setResult({ source, edge, url: url ?? undefined });
        else waiting = true;
      }).finally(() => {
        busy = false;
        if (current && waiting && imagePreviewSources.snapshot().waiting < 128) attempt();
      });
    };
    const off = imagePreviewSources.subscribe(attempt);
    attempt();
    return () => { current = false; off(); };
  }, [source, edge, enabled, resize]);
  if (!enabled || !source) return undefined;
  if (!resize) return resolveCanvasSource(source, false).url;
  if (fast && retained && retained.edge > edge) return retained.url;
  return imagePreviewSources.peek(source, edge) ?? (retained?.url ?? imagePreviewSources.peek(source, 256) ?? undefined);
}
