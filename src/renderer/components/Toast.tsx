import { AnimatePresence } from 'motion/react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import * as m from 'motion/react-m';
import { MonitorOff, Undo2, Redo2, AlertCircle, Info, X } from 'lucide-react';
import { useStore } from '../state/useStore';
import { playSfx } from '../sfx';
import { uiMotion } from '../uiMotion';
import { useUiMotionEnabled } from '../hooks/useUiMotionEnabled';

export default function Toast() {
  const { t } = useTranslation();
  const toastMessage = useStore(state => state.toastMessage);
  const toastKey = useStore(state => state.toastKey);
  const setToastMessage = useStore(state => state.setToastMessage);
  const uiMotionEnabled = useUiMotionEnabled();
  const important = useStore(state => state.importantNotification);
  const dismissImportant = useStore(state => state.dismissImportantNotification);
  const transient = toastMessage === 'undoNotification' || toastMessage === 'redoNotification';

  useEffect(() => {
    if (!toastMessage) return;
    if (!transient) return;
    playSfx(toastMessage === 'undoNotification' ? 'undo' : 'redo');
    const timer = setTimeout(() => setToastMessage(null), 1800);
    return () => clearTimeout(timer);
  }, [toastKey, toastMessage, transient, setToastMessage]);

  useEffect(() => {
    if (important?.severity !== 'info') return;
    const key = important.key;
    const timer = setTimeout(() => {
      if (useStore.getState().importantNotification?.key === key) dismissImportant();
    }, 6000);
    return () => clearTimeout(timer);
  }, [important, dismissImportant]);

  return <div className="fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 flex w-max max-w-[calc(100vw-32px)] flex-col items-center gap-2 pointer-events-none">
    <AnimatePresence initial={false}>
      {important && <m.div key="important" data-testid="important-notification" role={important.severity === 'info' ? 'status' : 'alert'} aria-atomic="true"
        className={`pointer-events-auto flex max-w-[520px] items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-xl ${important.severity === 'info' ? 'border-white/20 bg-neutral-800/95 text-white/90' : important.severity === 'warning' ? 'border-amber-500/40 bg-amber-950/95 text-amber-100' : 'border-red-500/40 bg-red-950/95 text-red-100'}`}
        initial={uiMotionEnabled ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: uiMotionEnabled ? uiMotion.duration.standard : 0 }}>
        {important.severity === 'info' ? <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : important.message === 'displayDisconnected' ? <MonitorOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
        <span className="min-w-0 break-words">{t(`common.${important.message}`, { defaultValue: important.message })}</span>
        <button type="button" onClick={dismissImportant} aria-label={t('common.close')}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}
          className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"><X className="h-4 w-4" aria-hidden="true" /></button>
      </m.div>}
      {toastMessage && transient && <m.div key="toast" data-testid="transient-notification" role="status" aria-live="polite"
        className="flex items-center gap-2 rounded-lg border border-white/15 bg-neutral-800/95 px-4 py-2 text-sm text-white/90 shadow-lg"
        initial={uiMotionEnabled ? { opacity: 0, y: uiMotion.distance } : false} animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }} transition={{ duration: uiMotionEnabled ? uiMotion.duration.standard : 0, ease: uiMotion.ease }}>
        {toastMessage === 'undoNotification' ? <Undo2 className="h-4 w-4" aria-hidden="true" /> : <Redo2 className="h-4 w-4" aria-hidden="true" />}
        {t(`common.${toastMessage}`)}
      </m.div>}
    </AnimatePresence>
  </div>;
}
