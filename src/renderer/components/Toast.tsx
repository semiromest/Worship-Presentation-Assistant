import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Undo2, Redo2 } from 'lucide-react';
import { useStore } from '../state/useStore';

export default function Toast() {
  const { t } = useTranslation();
  const toastMessage = useStore(s => s.toastMessage);
  const toastKey = useStore(s => s.toastKey);
  const setToastMessage = useStore(s => s.setToastMessage);

  const isUndo = toastMessage === 'undoNotification';

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 1500);
    return () => clearTimeout(timer);
  }, [toastKey, toastMessage, setToastMessage]);

  if (!toastMessage) return null;

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-bottom-2 duration-300"
      role="status"
      aria-live="polite"
    >
      <div className={`flex items-center gap-2 px-5 py-2.5 rounded-xl backdrop-blur border shadow-2xl text-sm font-semibold ${
        isUndo
          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
          : 'bg-blue-500/20 border-blue-500/40 text-blue-300'
      }`}>
        {isUndo ? <Undo2 className="w-4 h-4" /> : <Redo2 className="w-4 h-4" />}
        {t(`common.${toastMessage}`)}
      </div>
    </div>
  );
}
