import { useSyncExternalStore } from 'react';
import Dialog from './components/Dialog';

import { subscribe, snapshot, finishChoice } from './choiceDialogState';

export function ChoiceDialogHost() {
  const request = useSyncExternalStore(subscribe, snapshot);
  if (!request) return null;
  return (
    <Dialog
      open
      onClose={() => finishChoice(null)}
      labelledBy="choice-dialog-title"
      closeOnOverlayClick={false}
      className="w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/10 bg-surface-raised p-5 text-white shadow-xl"
    >
      <h2 id="choice-dialog-title" className="text-lg font-semibold">
        {request.title}
      </h2>
      <p className="mt-3 text-sm text-white/70">{request.message}</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {request.choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            onClick={() => finishChoice(choice.value)}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {choice.label}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
