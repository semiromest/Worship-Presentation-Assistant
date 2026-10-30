import { useEffect, useRef, useState } from 'react';
import type { Slide } from '../types';
import type { PreviewAssetRequest, PreviewDemand } from '../../shared/remotePreview';
import { RemotePreviewState } from '../remotePreviewState';
import { useStore } from '../state/useStore';
import { useWatermarkStore } from '../state/useWatermarkStore';
import { previewCacheMatches } from '../previewCache';
import { generateSlideThumbnail, type ThumbnailStatus } from '../utils';
import { slideFonts } from '../fontLoader';
import { yieldPreviewWork } from '../previewEncoding';

export function useRemotePreviews(slides: Slide[], documentId: string, enabled: boolean) {
  const watermark = useWatermarkStore(s => s.config);
  const state = useRef(new RemotePreviewState());
  const fonts = useRef(new Map<string, number>());
  const [fontTick, setFontTick] = useState(0);
  const demand = useRef<PreviewDemand>({ clients: 0, revision: -1 });
  const pending = useRef(new Map<string, PreviewAssetRequest>());
  const work = useRef({ active: 0, generated: 0 });
  const retries = useRef(new Map<string, { request: PreviewAssetRequest; count: number; timer?: ReturnType<typeof setTimeout> }>());
  const alive = useRef(false);
  const familyName = (family: string) => family.split(',')[0].replace(/['"]/g, '').trim();
  const fontEpoch = (slide: Slide) => slideFonts(slide).reduce((sum, family) => sum + (fonts.current.get(familyName(family)) ?? 0), 0);
  const current = (request: PreviewAssetRequest) => {
    if (!alive.current || !demand.current.clients) return undefined;
    const record = state.current.get(request);
    const source = useStore.getState().presentation.slides.find(s => s.id === request.id);
    return source && previewCacheMatches(record, source, useWatermarkStore.getState().config, fontEpoch(source)) ? record : undefined;
  };
  const pump = useRef<() => void>(() => {});
  pump.current = () => {
    if (work.current.active || !alive.current || !demand.current.clients) return;
    work.current.active = 1;
    void (async () => {
      try {
        while (alive.current && demand.current.clients && pending.current.size) {
          const store = useStore.getState();
          const liveId = store.presentation.slides[store.liveIndex]?.id;
          const request = pending.current.get(liveId) ?? pending.current.values().next().value!;
          pending.current.delete(request.id);
          const record = current(request);
          if (!record) continue;
          const status: ThumbnailStatus = {};
          const dataUrl = await generateSlideThumbnail(record.slide, { status, eligible: () => !!current(request) });
          if (dataUrl && current(request) && !status.usedFallback) {
            await window.electronAPI.publishPreviewAsset({ ...request, dataUrl });
            work.current.generated++;
            const retry = retries.current.get(request.id);
            clearTimeout(retry?.timer); retries.current.delete(request.id);
          } else if (current(request)) {
            const previous = retries.current.get(request.id);
            const count = previous?.request.version === request.version ? previous.count : 0;
            clearTimeout(previous?.timer);
            if (count < 2) {
              const retry = { request, count: count + 1, timer: undefined as ReturnType<typeof setTimeout> | undefined };
              retry.timer = setTimeout(() => {
                if (current(request)) { pending.current.set(request.id, request); pump.current(); }
              }, 5100);
              retries.current.set(request.id, retry);
            }
          }
          await yieldPreviewWork();
        }
      } catch (error) { console.error('Demand preview generation failed', error); }
      finally { work.current.active = 0; if (pending.current.size && alive.current && demand.current.clients) pump.current(); }
    })();
  };
  useEffect(() => {
    const api = window.electronAPI;
    if (!enabled || !api?.getPreviewDemand) return;
    const requests = pending.current;
    const retryJobs = retries.current;
    alive.current = true;
    const update = (next: PreviewDemand) => {
      if (!alive.current || next.revision < demand.current.revision) return;
      demand.current = next;
      if (!next.clients) {
        requests.clear(); retryJobs.forEach(job => clearTimeout(job.timer)); retryJobs.clear();
      }
      else pump.current();
    };
    const offDemand = api.onPreviewDemand(update);
    const offRequest = api.onPreviewAssetRequest(request => {
      if (!current(request) || pending.current.size >= 128) return;
      pending.current.set(request.id, request); pump.current();
    });
    void api.getPreviewDemand().then(update).catch(console.error);
    return () => { alive.current = false; offDemand(); offRequest(); requests.clear(); retryJobs.forEach(job => clearTimeout(job.timer)); retryJobs.clear(); };
    // Callbacks read authoritative refs/store, never captured render snapshots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    const changed = (event: Event) => {
      const family = (event as CustomEvent<{ family?: string }>).detail?.family;
      if (!family) return;
      const key = familyName(family);
      fonts.current.set(key, (fonts.current.get(key) ?? 0) + 1);
      setFontTick(tick => tick + 1);
    };
    window.addEventListener('presenter-font-loaded', changed);
    return () => window.removeEventListener('presenter-font-loaded', changed);
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !window.electronAPI?.configurePreviewDeck) return;
    const deck = state.current.update(documentId, slides, watermark, fontEpoch);
    for (const [id, request] of pending.current) if (!state.current.get(request)) pending.current.delete(id);
    for (const [id, retry] of retries.current) if (!state.current.get(retry.request)) { clearTimeout(retry.timer); retries.current.delete(id); }
    void window.electronAPI.configurePreviewDeck(deck).catch(console.error);
    // Font versions are changed only by the explicit loaded-font event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, documentId, slides, watermark, fontTick]);
  useEffect(() => {
    if (!enabled || !import.meta.env.DEV && import.meta.env.VITE_RELIABILITY_DIAGNOSTICS !== '1') return;
    const scope = window as unknown as { __previewDiagnostics?: () => unknown };
    scope.__previewDiagnostics = () => ({ active: work.current.active, pending: pending.current.size,
      generated: work.current.generated, metadataEntries: state.current.size, clients: demand.current.clients,
      cacheEntries: 0, cacheBytes: 0, activeGenerations: work.current.active, queuedGenerations: pending.current.size });
    return () => { delete scope.__previewDiagnostics; };
  }, [enabled]);
}
