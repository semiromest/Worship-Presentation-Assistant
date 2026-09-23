import type { ReactNode } from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { useTranslation } from 'react-i18next';
import { cn } from '../utils';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  labelledBy?: string;
  describedBy?: string;
  children: ReactNode;
  className?: string;
  overlayClassName?: string;
  closeOnEscape?: boolean;
  closeOnOverlayClick?: boolean;
}

export default function Dialog({
  open,
  onClose,
  labelledBy,
  describedBy,
  children,
  className,
  overlayClassName,
  closeOnEscape = true,
  closeOnOverlayClick = true,
}: DialogProps) {
  const { t } = useTranslation();

  return (
    <BaseDialog.Root
      open={open}
      disablePointerDismissal={!closeOnOverlayClick}
      onOpenChange={(nextOpen, details) => {
        if (nextOpen) return;
        if (!closeOnEscape && details.reason === 'escape-key') {
          details.cancel();
          return;
        }
        onClose();
      }}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          className={cn(
            'base-dialog-backdrop fixed inset-0 z-50 bg-black/60 backdrop-blur-sm',
            overlayClassName,
          )}
        />
        <BaseDialog.Popup
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          className={cn('base-dialog-popup fixed left-1/2 top-1/2 z-[51]', className)}
        >
          {children}
          <BaseDialog.Close className="sr-only">{t('common.close')}</BaseDialog.Close>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
