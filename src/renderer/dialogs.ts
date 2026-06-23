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
}

export async function confirmDialog(
  message: string,
  options?: Omit<ConfirmDialogOptions, 'message'>,
): Promise<boolean> {
  if (window.electronAPI?.showConfirmDialog) {
    return window.electronAPI.showConfirmDialog({ message, ...options });
  }
  return window.confirm(message);
}

export async function alertDialog(
  message: string,
  options?: Omit<AlertDialogOptions, 'message'>,
): Promise<void> {
  if (window.electronAPI?.showAlertDialog) {
    await window.electronAPI.showAlertDialog({ message, ...options });
    return;
  }
  window.alert(message);
}
