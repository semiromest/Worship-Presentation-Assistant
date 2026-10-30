import i18n from './i18n';
import { choiceDialog } from './choiceDialogState';

export interface ConfirmDialogOptions {
  message: string;
  title?: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface AlertDialogOptions {
  message: string;
  title?: string;
  detail?: string;
  okLabel?: string;
}

export async function confirmDialog(message: string, options?: Omit<ConfirmDialogOptions, 'message'>): Promise<boolean> {
  return (await choiceDialog({
    title: options?.title ?? message,
    message: options?.title ? message : '',
    detail: options?.detail,
    choices: [
      { value: 'cancel', label: options?.cancelLabel ?? i18n.t('common.cancel') },
      { value: 'confirm', label: options?.confirmLabel ?? i18n.t('common.confirm'), tone: 'primary' },
    ],
  })) === 'confirm';
}

export async function alertDialog(message: string, options?: Omit<AlertDialogOptions, 'message'>): Promise<void> {
  await choiceDialog({
    title: options?.title ?? message,
    message: options?.title ? message : '',
    detail: options?.detail,
    tone: 'info',
    choices: [{ value: 'ok', label: options?.okLabel ?? i18n.t('common.close'), tone: 'primary' }],
  });
}
