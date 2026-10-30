import { cloneElement, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactElement } from 'react';
import { Tooltip } from '@base-ui/react/tooltip';

/** Keeps the actual button and its layout; explanations are also available on focus. */
export default function ControlTooltip({ children, shortcut, side = 'bottom', suppress = false }: {
  children: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Don't compete with a popup opened by the same trigger. */
  suppress?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const label = children.props.title || children.props['aria-label'];
  const disabled = children.props.disabled;
  const focusReveal = useRef(false);
  const focusFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);
  useEffect(() => { if (disabled || !label || suppress) setOpen(false); }, [disabled, label, suppress]);
  useEffect(() => {
    if (!open || disabled || !label || suppress) return;
    const close = (event: Event) => {
      // Native focus and the toolbar's reveal can scroll before the next paint.
      // Keep the newly focused control's hint; explicit wheel scrolling still closes it.
      if (event.type === 'scroll' && focusReveal.current) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"], .base-popover-popup, .base-dialog-popup')) {
        // The containing popup owns Escape; don't require a second press to close it.
        setOpen(false);
        return;
      }
      // Closing a hint must never also execute the workspace's Escape shortcut.
      event.preventDefault(); event.stopPropagation(); setOpen(false);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('dragstart', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('dragstart', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('wheel', close);
      window.removeEventListener('keydown', escape, true);
    };
  }, [open, disabled, label, suppress]);
  const button = cloneElement(children, {
    title: undefined,
    ...(!children.props['aria-label'] && !children.props['aria-labelledby'] && children.props.title
      ? { 'aria-label': children.props.title } : {}),
  });
  if (!label || disabled) return button;
  return <Tooltip.Root open={open && !suppress} onOpenChange={setOpen} disabled={suppress} disableHoverablePopup>
    <Tooltip.Trigger render={button} delay={450} className="control-tooltip-trigger" aria-describedby={open && !suppress ? tooltipId : undefined}
      onFocus={() => {
        focusReveal.current = true;
        cancelAnimationFrame(focusFrame.current);
        focusFrame.current = requestAnimationFrame(() => {
          focusFrame.current = requestAnimationFrame(() => { focusReveal.current = false; focusFrame.current = 0; });
        });
      }}
      onBlur={() => { focusReveal.current = false; cancelAnimationFrame(focusFrame.current); }}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }} />
    <Tooltip.Portal>
      <Tooltip.Positioner side={side} sideOffset={7} className="z-[110] pointer-events-none">
        <Tooltip.Popup id={tooltipId} role="tooltip" aria-hidden={!open || suppress} className="control-tooltip">
          <span>{label}</span>
          {shortcut && <kbd aria-hidden="true">{shortcut}</kbd>}
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  </Tooltip.Root>;
}
