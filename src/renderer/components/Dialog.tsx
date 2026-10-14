import { useLayoutEffect, type ReactNode, type RefObject } from 'react';
import { finishTour, isHelpActive } from './Tour/tourController';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { useTranslation } from 'react-i18next';
import { cn } from '../utils';

export interface DialogProps {
  open: boolean;
  onboardingSurface?: boolean;
  onClose: () => void;
  labelledBy?: string;
  describedBy?: string;
  children: ReactNode;
  className?: string;
  overlayClassName?: string;
  closeOnEscape?: boolean;
  closeOnOverlayClick?: boolean;
  returnFocus?: RefObject<HTMLElement | null>;
}

export default function Dialog({
  open,
  onboardingSurface = false,
  onClose,
  labelledBy,
  describedBy,
  children,
  className,
  overlayClassName,
  closeOnEscape = true,
  closeOnOverlayClick = true,
  returnFocus,
}: DialogProps) {
  const { t } = useTranslation();
  useLayoutEffect(() => { if (open && !onboardingSurface && isHelpActive()) finishTour('interrupted'); }, [open, onboardingSurface]);

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
          data-tour-surface={onboardingSurface ? '' : undefined}
          finalFocus={returnFocus}
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
