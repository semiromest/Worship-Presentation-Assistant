import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import * as m from 'motion/react-m';
import { MonitorOff, Undo2, Redo2 } from 'lucide-react';
import { useStore } from '../state/useStore';
import { playSfx } from '../sfx';
import { uiMotion } from '../uiMotion';
import { useUiMotionEnabled } from '../hooks/useUiMotionEnabled';

export default function Toast() {
  const { t } = useTranslation();
  const toastMessage = useStore((state) => state.toastMessage);
  const toastKey = useStore((state) => state.toastKey);
  const setToastMessage = useStore((state) => state.setToastMessage);
  const uiMotionEnabled = useUiMotionEnabled();

  const isUndo = toastMessage === 'undoNotification';
  const isDisconnected = toastMessage === 'displayDisconnected';

  useEffect(() => {
    if (!toastMessage) return;
    if (!isDisconnected) playSfx(isUndo ? 'undo' : 'redo');
    const timer = setTimeout(() => setToastMessage(null), isDisconnected ? 4000 : 1800);
    return () => clearTimeout(timer);
  }, [toastKey, toastMessage, isDisconnected, isUndo, setToastMessage]);

  if (!toastMessage) return null;

  return (
        <m.div
          key={toastKey}
          className="fixed bottom-6 left-1/2 z-[100] -translate-x-1/2"
          role="status"
          aria-live="polite"
          initial={uiMotionEnabled ? { opacity: 0, y: uiMotion.distance, scale: 0.98 } : false}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={uiMotionEnabled ? { opacity: 0, y: 4, scale: 0.98 } : { opacity: 1 }}
          transition={{ duration: uiMotionEnabled ? uiMotion.duration.standard : 0, ease: uiMotion.ease }}
        >
          <div className={`flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold shadow-2xl backdrop-blur ${
            isDisconnected || isUndo
              ? 'border-amber-500/40 bg-amber-950/90 text-amber-200'
              : 'border-blue-500/40 bg-blue-950/90 text-blue-200'
          }`}>
            {isDisconnected ? <MonitorOff className="h-4 w-4" /> : isUndo ? <Undo2 className="h-4 w-4" /> : <Redo2 className="h-4 w-4" />}
            {t(`common.${toastMessage}`, { defaultValue: toastMessage })}
          </div>
        </m.div>
  );
}
