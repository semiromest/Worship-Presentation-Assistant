import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlideOperations } from '../hooks/useSlideOperations';
import { documentSession, useDocumentSession } from '../documentSession';
import { useStore } from '../state/useStore';
import { useDesktopState, setDesktopCommandsBlocked } from '../desktopState';
import { safePathLabel } from '../../shared/desktop';
import { PREVIEW_OPTIMIZATION_ENABLED } from '../optimizationFlags';
import { alertDialog } from '../dialogs';

export default function DesktopHost() {
  const { t, i18n } = useTranslation();
  const { openPresentation } = useSlideOperations();
  const session = useDocumentSession();
  const requests = useDesktopState(s => s.requests);
  const outputs = useDesktopState(s => s.outputs);
  const [outputsOpen, setOutputsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasOutputs = useStore(s => s.isProjectorWindowOpen || Object.values(s.outputAssignments).some(output => output.isOpen));
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    document.documentElement.dataset.previewOptimization = PREVIEW_OPTIMIZATION_ENABLED ? 'candidate' : 'baseline';
    const api = window.electronAPI;
    if (!api?.desktopReady) return;
    let alive = true;
    const offStatus = api.onDesktopStatus(value => useDesktopState.setState(value));
    const offOpen = api.onDesktopOpenRequests(value => useDesktopState.setState({ requests: value }));
    const offHistory = api.onDesktopHistory(command => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, shiftKey: command === 'redo', bubbles: true, cancelable: true })));
    void api.desktopReady().then(status => { if (alive) useDesktopState.setState(status); }).catch(console.error);
    return () => { alive = false; offStatus(); offOpen(); offHistory(); };
  }, []);
  useEffect(() => {
    let previous: boolean | undefined;
    const update = () => {
      const blocked = busy || outputsOpen || requests.length > 0 || !!document.querySelector('[role="dialog"], [role="alertdialog"]');
      setDesktopCommandsBlocked(blocked);
      if (blocked !== previous) { previous = blocked; void window.electronAPI?.desktopBlock?.(blocked).catch(console.error); }
    };
    const observer = new MutationObserver(update); observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'data-open'] }); update();
    return () => { observer.disconnect(); setDesktopCommandsBlocked(true); void window.electronAPI?.desktopBlock?.(true).catch(console.error); };
  }, [busy, outputsOpen, requests.length]);
  useEffect(() => { void window.electronAPI?.desktopDocument?.(session.dirty, session.path).catch(console.error); }, [session]);
  useEffect(() => { void window.electronAPI?.desktopLanguage?.(i18n.language).catch(console.error); }, [i18n.language]);
  const accept = useCallback(async (id: string, automatic = false) => {
    setBusy(true);
    try { await openPresentation(id, { automatic }); } catch (error) { await alertDialog(t('desktop.openFailed'), { detail: safePathLabel(String(error)) }); }
    finally { setBusy(false); }
  }, [openPresentation, t]);
  useEffect(() => {
    const currentIds = new Set(requests.map(request => request.id));
    for (const id of attempted.current) if (!currentIds.has(id)) attempted.current.delete(id);
    const request = requests[0];
    if (!request || busy || hasOutputs || outputsOpen || session.dirty || documentSession.isDirty() || attempted.current.has(request.id) || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    attempted.current.add(request.id);
    void accept(request.id, true);
  }, [requests, busy, hasOutputs, outputsOpen, session.dirty, accept]);
  return <div className="fixed bottom-1 left-20 z-40 flex max-w-[70vw] flex-wrap items-center gap-x-3 gap-y-1 rounded bg-surface-raised px-2 text-xs text-white/70">
    {session.path && <span draggable={session.canDrag} onDragStart={event => { event.preventDefault(); if (session.canDrag && session.path) void window.electronAPI?.desktopDragOutput(session.path).catch(console.error); }} title={safePathLabel(session.path)}>{session.dirty ? '● ' : ''}{safePathLabel(session.path.split(/[\\/]/).pop() ?? '')}</span>}
    {outputs.length > 0 && <details data-saved-outputs className="relative" open={outputsOpen} onToggle={event => setOutputsOpen(event.currentTarget.open)}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOutputsOpen(false); }}
      onKeyDown={event => {
        if (outputsOpen || event.key === ' ' || event.key === 'Enter') event.stopPropagation();
        if (outputsOpen && event.key === 'Escape') { event.preventDefault(); setOutputsOpen(false); }
      }}>
      <summary className="cursor-pointer py-1">{t('desktop.savedOutputs')} ({outputs.length})</summary>
      {outputsOpen && <div role="dialog" aria-modal="false" aria-label={t('desktop.savedOutputs')} className="absolute bottom-full left-0 mb-2 min-w-64 max-w-md rounded-lg border border-white/15 bg-surface-raised p-2 shadow-xl">
        <p className="px-2 pb-2 text-white/50">{t('desktop.dragHint')}</p>
        <div className="max-h-48 overflow-y-auto">{outputs.map(file => <button key={file.path} type="button" data-saved-output draggable className="block w-full truncate rounded px-2 py-2 text-left hover:bg-white/10" title={safePathLabel(file.path)}
          onDragStart={event => { event.preventDefault(); void window.electronAPI?.desktopDragOutput(file.path).catch(console.error); }}>{file.label}</button>)}</div>
      </div>}
    </details>}
    {requests.map(request => <div key={request.id} data-desktop-open-request className="flex items-center gap-2 p-2" role="status">
      <span className="min-w-0 truncate" title={request.label}>{t('desktop.openRequest')}: {request.label}</span>
      <button disabled={busy} className="rounded bg-blue-600 px-2 py-1" onClick={() => void accept(request.id)}>{t('desktop.open')}</button>
      <button disabled={busy} className="rounded border px-2 py-1" onClick={() => void window.electronAPI?.desktopRejectOpen(request.id)}>{t('desktop.reject')}</button>
    </div>)}
  </div>;
}
