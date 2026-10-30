import type { AppDialogOptions } from '../shared/appDialog';

interface ChoiceRequest extends AppDialogOptions {
  resolve: (value: string | null) => void;
}

const queue: ChoiceRequest[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const snapshot = () => queue[0] ?? null;

/** App-owned choices remain available even when the editor page is hidden. */
export function choiceDialog(options: Omit<ChoiceRequest, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => {
    queue.push({ ...options, resolve });
    notify();
  });
}

export function finishChoice(value: string | null) {
  const request = queue.shift();
  request?.resolve(value);
  notify();
}
