import { dialog } from 'electron';
let depth = 0;
export const nativeDialogBusy = () => depth > 0;
/** Native dialogs are not DOM dialogs. Count their complete asynchronous lifetime. */
export function installNativeDialogGate(): void {
  for (const name of ['showOpenDialog', 'showSaveDialog', 'showMessageBox', 'showOpenDialogSync', 'showSaveDialogSync', 'showMessageBoxSync'] as const) {
    const original = dialog[name].bind(dialog) as (...args: unknown[]) => unknown;
    const wrapped = (...args: unknown[]) => {
      depth++;
      try {
        const value = original(...args);
        if (value && typeof (value as Promise<unknown>).then === 'function') return Promise.resolve(value).finally(() => { depth--; });
        depth--; return value;
      } catch (error) { depth--; throw error; }
    };
    (dialog as unknown as Record<string, unknown>)[name] = wrapped;
  }
}
