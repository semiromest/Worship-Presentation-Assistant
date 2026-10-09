/** A mounted editor owns the guard; presentation loaders share this entry point. */
let guard: (() => Promise<boolean>) | null = null;
let pending: Promise<boolean> | null = null;

export function registerEditorGuard(next: () => Promise<boolean>) {
  guard = next;
  return () => {
    if (guard === next) guard = null;
  };
}

export async function guardEditorReplacement(): Promise<boolean> {
  // Ignore repeated open/new actions while a decision is pending.
  if (pending) return false;
  if (!guard) return true;
  pending = guard();
  try {
    return await pending;
  } finally {
    pending = null;
  }
}
