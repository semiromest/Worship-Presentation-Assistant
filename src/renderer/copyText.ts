/**
 * Copies plain text to the system clipboard.
 *
 * Desktop: through the main process, because the app session denies the web
 * clipboard permission. Web build / fallback: the async Clipboard API, then a
 * hidden textarea with execCommand('copy').
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  const writeViaMain = window.electronAPI?.writeClipboardText;
  if (writeViaMain) {
    try {
      if (await writeViaMain(text)) return true;
    } catch {
      /* fall through to the web paths */
    }
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to execCommand */
  }
  return copyWithTextarea(text);
}

function copyWithTextarea(text: string): boolean {
  const active = document.activeElement as HTMLElement | null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  active?.focus({ preventScroll: true });
  return ok;
}
