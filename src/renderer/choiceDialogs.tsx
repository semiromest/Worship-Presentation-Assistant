import { useEffect, useSyncExternalStore } from 'react';
import { AlertTriangle, Info, MessageCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Dialog from './components/Dialog';
import { cn } from './utils';
import { subscribe, snapshot, finishChoice, choiceDialog } from './choiceDialogState';

export function ChoiceDialogHost() {
  const request = useSyncExternalStore(subscribe, snapshot);
  const { t } = useTranslation();
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onAppDialog) return;
    const received = new Set<string>();
    const off = api.onAppDialog(item => {
      if (received.has(item.id)) return;
      received.add(item.id);
      void choiceDialog(item).then(value => {
        received.delete(item.id);
        api.respondAppDialog(item.id, value);
      });
    });
    api.appDialogsReady();
    return off;
  }, []);
  if (!request) return null;
  const Icon = request.tone === 'danger' ? AlertTriangle : request.tone === 'info' ? Info : MessageCircle;
  return (
    <Dialog
      open
      onClose={() => finishChoice(null)}
      labelledBy="choice-dialog-title"
      describedBy="choice-dialog-description"
      closeOnOverlayClick={false}
      className="app-choice-dialog flex max-h-[calc(100dvh-32px)] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface-raised text-white shadow-2xl"
    >
      <div className="relative overflow-y-auto p-6 pb-5">
        <button type="button" onClick={() => finishChoice(null)} aria-label={t('common.close')}
          className="absolute right-3 top-3 rounded-lg p-2 text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <X size={18} />
        </button>
        <div className={cn('mb-5 flex h-11 w-11 items-center justify-center rounded-xl border', request.tone === 'danger' ? 'border-amber-400/20 bg-amber-400/10 text-amber-300' : 'border-accent/20 bg-accent/10 text-blue-400')}>
          <Icon size={22} strokeWidth={1.8} />
        </div>
        <h2 id="choice-dialog-title" className="pr-5 text-lg font-semibold leading-snug tracking-tight break-words">{request.title}</h2>
        <div id="choice-dialog-description" className="mt-3 space-y-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-white/65">
          {request.message && <p>{request.message}</p>}
          {request.detail && <p>{request.detail}</p>}
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-white/[0.06] bg-black/10 px-6 py-4">
        {request.choices.map(choice => (
          <button key={choice.value} type="button" onClick={() => finishChoice(choice.value)}
            className={cn('rounded-lg border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
              choice.tone === 'danger' ? 'border-red-500/30 bg-red-500/15 text-red-300 hover:bg-red-500/25' : choice.tone === 'primary' ? 'border-blue-500 bg-blue-600 text-white hover:bg-blue-500' : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10')}>
            {choice.label}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
