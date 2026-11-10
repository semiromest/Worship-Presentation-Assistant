import { Children, cloneElement, isValidElement, useEffect, useId, useRef, useState, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { Tooltip } from '@base-ui/react/tooltip';
import { useTranslation } from 'react-i18next';

export const TOOLTIP_HOVER_DELAY = 2000;

function hasTextContent(node: ReactNode): boolean {
  return Children.toArray(node).some(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child).trim().length > 0;
    return isValidElement<{ children?: ReactNode }>(child) && hasTextContent(child.props.children);
  });
}

/** Keeps the actual button and its layout; explanations are also available on focus. */
export default function ControlTooltip({ children, description, descriptionKey, shortcut, side = 'bottom', suppress = false }: {
  children: ReactElement<HTMLAttributes<HTMLElement> & { disabled?: boolean }>;
  /** Explain the action without changing the button's accessible name. */
  description?: string;
  /** Original translation key, so identical short labels keep their own meaning. */
  descriptionKey?: string;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Don't compete with a popup opened by the same trigger. */
  suppress?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { i18n } = useTranslation();
  const tooltipId = useId();
  const resources = i18n.getResourceBundle(i18n.resolvedLanguage ?? i18n.language, 'translation');
  const originalLabel = children.props.title || children.props['aria-label'];
  const label = description || (descriptionKey && resources?.tooltipDescriptions?.[descriptionKey]) || originalLabel;
  const focusReveal = useRef(false);
  const focusFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);
  useEffect(() => { if (!label || suppress) setOpen(false); }, [label, suppress]);
  useEffect(() => {
    if (!open || !label || suppress) return;
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
  }, [open, label, suppress]);
  const button = cloneElement(children, {
    title: undefined,
    ...(!children.props['aria-label'] && !children.props['aria-labelledby'] && children.props.title && !hasTextContent(children.props.children)
      ? { 'aria-label': children.props.title } : {}),
  });
  if (!label) return button;
  return <Tooltip.Root open={open && !suppress} onOpenChange={setOpen} disabled={suppress} disableHoverablePopup>
    <Tooltip.Trigger render={button} delay={TOOLTIP_HOVER_DELAY} className="control-tooltip-trigger" aria-describedby={[children.props['aria-describedby'], open && !suppress ? tooltipId : undefined].filter(Boolean).join(' ') || undefined}
      onFocus={() => {
        focusReveal.current = true;
        cancelAnimationFrame(focusFrame.current);
        focusFrame.current = requestAnimationFrame(() => {
          focusFrame.current = requestAnimationFrame(() => { focusReveal.current = false; focusFrame.current = 0; });
        });
      }}
      onBlur={() => { focusReveal.current = false; cancelAnimationFrame(focusFrame.current); }}
      onKeyDown={event => {
        if ((children.type === 'button' || typeof children.type !== 'string' || children.props.role === 'button') && (event.key === 'Enter' || event.key === ' ')) event.stopPropagation();
      }} />
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
