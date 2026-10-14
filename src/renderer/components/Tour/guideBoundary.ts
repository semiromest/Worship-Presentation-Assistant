type Boundary = { targets: HTMLElement[]; surface: HTMLElement; exit: () => void; deleteAllowed?: () => boolean };
let active: Boundary | null = null;
let escape: (() => void) | null = null;
export function registerGuideEscape(callback: () => void) { escape = callback; return () => { if (escape === callback) escape = null; }; }
export function dismissGuide() { if (!escape) return false; escape(); return true; }
const owned = new Map<HTMLElement, boolean>();
/** Components can change their own inert state while a guide lease is active. */
export function setComponentInert(node: HTMLElement, value: boolean) {
  if (owned.has(node)) { owned.set(node, value); node.inert = true; }
  else node.inert = value;
}
function restore() { for (const [node, previous] of owned) node.inert = previous; owned.clear(); }
export function isGuideActive() { return active !== null; }
export function guideAllows(event: Event) {
  return !!active && event.composedPath().some(node => node instanceof HTMLElement &&
    (active!.surface.contains(node) || active!.targets.some(target => target.contains(node))));
}
export function guideKey(event: KeyboardEvent) {
  if (!active) return false;
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); active.exit(); return true; }
  const deleteAllowed = event.key === 'Delete' && active.deleteAllowed?.();
  if (deleteAllowed) return true;
  const editable = event.target instanceof HTMLElement && event.target.matches('input,textarea,[contenteditable="true"]') && guideAllows(event);
  const editKey = editable && !event.altKey && (!event.ctrlKey && !event.metaKey || event.key.toLowerCase() === 'a');
  if (!guideAllows(event) || !(editKey || ['Tab', 'Enter', ' ', 'Shift'].includes(event.key))) {
    event.preventDefault(); event.stopImmediatePropagation(); return true;
  }
  const control = active.targets.find(target => target.matches('[role="button"]:not(button),[role="menuitem"]:not(button)') && target.contains(event.target as Node));
  if (control && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault(); event.stopImmediatePropagation(); control.click(); return true;
  }
  if (event.key === 'Tab') {
    const roots = [active.surface, ...active.targets];
    const elements = roots.flatMap(root => [root, ...root.querySelectorAll<HTMLElement>('button, summary, [href], input, select, textarea, [tabindex]')])
      .filter((node, index, nodes) => nodes.indexOf(node) === index && (node.tabIndex >= 0 || active!.targets.includes(node) && node.matches('[role="menuitem"]')) && !node.closest('[inert]') && node.getClientRects().length && !(node as HTMLButtonElement).disabled);
    event.preventDefault(); event.stopImmediatePropagation();
    const index = elements.indexOf(document.activeElement as HTMLElement);
    elements[(index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length]?.focus();
  }
  return true;
}
/** One lease; restores only inert values owned by this guide, including detached nodes. */
export function leaseGuideBoundary(boundary: Boundary, useInert = true) {
  restore(); active = boundary;
  const apply = () => {
    restore();
    if (!useInert) return;
    const roots = [boundary.surface, ...boundary.targets.filter(node => node.isConnected)];
    const visit = (node: HTMLElement) => {
      if (roots.includes(node)) return;
      if (roots.some(root => node.contains(root))) { for (const child of node.children) if (child instanceof HTMLElement) visit(child); }
      else { owned.set(node, node.inert); node.inert = true; }
    };
    for (const child of document.body.children) if (child instanceof HTMLElement) visit(child);
  };
  apply();
  const observer = new MutationObserver(apply);
  observer.observe(document.body, { childList: true, subtree: true });
  const focus = (event: FocusEvent) => { if (!guideAllows(event)) boundary.surface.querySelector<HTMLElement>('button')?.focus(); };
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Delete' && boundary.deleteAllowed?.()) return;
    event.stopPropagation();
  };
  const doubleClick = (event: MouseEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const pointer = (event: PointerEvent) => { if (boundary.surface.contains(event.target as Node)) event.stopPropagation(); };
  document.addEventListener('focusin', focus);
  document.addEventListener('keydown', keys);
  document.addEventListener('keyup', keys);
  document.addEventListener('dblclick', doubleClick, true);
  document.addEventListener('pointerdown', pointer);
  return () => {
    observer.disconnect(); document.removeEventListener('focusin', focus);
    document.removeEventListener('keydown', keys); document.removeEventListener('keyup', keys);
    document.removeEventListener('dblclick', doubleClick, true); document.removeEventListener('pointerdown', pointer);
    if (active === boundary) { active = null; restore(); }
  };
}
