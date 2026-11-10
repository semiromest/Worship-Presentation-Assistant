// Media storage warnings and approved cleanup, shared by the desktop and web apps.
// The platform (Electron main, or the web bridge) lists stored media and the references it
// knows of; the renderer adds what only it can see: the open presentation, its undo history,
// the media list and anything kept in local/session storage.
import { useEffect } from 'react';
import i18n from './i18n';
import { choiceDialog } from './choiceDialogState';
import { useStore } from './state/useStore';
import { collectMediaNames, type MediaStorageReport } from '../shared/mediaStorage';

const api = () => window.electronAPI;
export const mediaStorageAvailable = () => typeof api()?.mediaStorageReport === 'function';

/** Media names the renderer's own state refers to. Throws rather than under-report. */
export function rendererMediaReferences(): string[] {
  const names = collectMediaNames(useStore.getState());
  for (const area of [window.localStorage, window.sessionStorage]) {
    try {
      for (let i = 0; i < area.length; i++) collectMediaNames(area.getItem(area.key(i)!) ?? '', names);
    } catch { /* storage blocked: nothing kept there either */ }
  }
  return [...names];
}

export async function readMediaStorage(): Promise<MediaStorageReport> {
  const report = await api()!.mediaStorageReport!(rendererMediaReferences());
  if (!report) throw new Error('Media storage unavailable');
  return report;
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  return `${value.toLocaleString(locale, { maximumFractionDigits: value < 10 && unit > 1 ? 1 : 0 })} ${units[unit]}`;
}

const t = (key: string, options?: Record<string, unknown>) => i18n.t(`mediaStorage.${key}`, options) as string;

function largestList(report: MediaStorageReport): string | undefined {
  if (!report.largest.length) return undefined;
  return [t('largest'), ...report.largest.map(item => `• ${item.name}${item.autosave ? ` (${t('autosave')})` : ''} — ${formatBytes(item.bytes)}`)].join('\n');
}

async function info(title: string, message: string, detail?: string) {
  await choiceDialog({ title, message, detail, tone: 'info', choices: [{ value: 'ok', label: t('ok'), tone: 'primary' }] });
}

let reviewing = false;

/**
 * Explains the storage situation and removes unused media if the user agrees.
 * `automatic`: started by the limit check, so "Not now" postpones the next warning.
 */
export async function reviewMediaStorage(automatic: boolean): Promise<void> {
  const platform = api();
  if (reviewing || !platform?.mediaStorageReport || !platform.mediaStorageRemove) return;
  reviewing = true;
  try {
    const report = await readMediaStorage();
    const used = formatBytes(report.mediaBytes);
    const limit = formatBytes(report.limitBytes);
    const over = report.mediaBytes > report.limitBytes;
    const near = report.platform === 'desktop' ? t('nearDesktop') : t('nearWeb');
    const title = over ? t('overTitle') : report.nearCapacity && automatic ? t('nearTitle') : t('cleanTitle');
    const situation = [over ? t('over', { used, limit }) : '', report.nearCapacity ? near : ''].filter(Boolean).join(' ');
    const snooze = (bytes: number) => platform.mediaStorageSettings?.({ snoozeUntilBytes: Math.round(bytes * 1.1) });

    if (!report.unused.names.length) {
      await info(automatic ? title : t('noneTitle'), [situation, t('none')].filter(Boolean).join(' '),
        over || report.nearCapacity ? [over ? t('stillOver', { used, limit }) : '', largestList(report)].filter(Boolean).join('\n\n') : undefined);
      if (automatic) await snooze(report.mediaBytes);
      return;
    }

    const answer = await choiceDialog({
      title,
      message: [situation, t('unusedMessage', { count: report.unused.names.length, size: formatBytes(report.unused.bytes) })].filter(Boolean).join(' '),
      choices: [{ value: 'later', label: t('later') }, { value: 'clean', label: t('clean'), tone: 'primary' }],
    });
    if (answer !== 'clean') {
      if (automatic) await snooze(report.mediaBytes);
      return;
    }

    // The platform re-checks every reference (including ours, read again now) before deleting.
    const removed = await platform.mediaStorageRemove(report.unused.names, rendererMediaReferences());
    const after = report.mediaBytes - removed.bytes;
    const stillOver = after > report.limitBytes;
    await info(stillOver ? t('stillOverTitle') : t('doneTitle'), t('removed', { count: removed.count, size: formatBytes(removed.bytes) }),
      stillOver ? [t('stillOver', { used: formatBytes(after), limit }), largestList(report)].filter(Boolean).join('\n\n') : undefined);
    if (automatic && stillOver) await snooze(after);
  } finally {
    reviewing = false;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;

export function scheduleMediaStorageCheck(delayMs = 5000): void {
  clearTimeout(timer);
  timer = setTimeout(() => { void checkMediaStorage(); }, delayMs);
}

async function checkMediaStorage(): Promise<void> {
  try {
    const report = await readMediaStorage();
    const over = report.mediaBytes > report.limitBytes;
    if (!over && !report.nearCapacity) {
      if (report.snoozeUntilBytes) await api()?.mediaStorageSettings?.({ snoozeUntilBytes: null });
      return;
    }
    if (report.snoozeUntilBytes && report.mediaBytes < report.snoozeUntilBytes && !report.nearCapacity) return;
    // Disk/quota pressure alone is worth a word only when there is something to clean.
    if (!over && !report.unused.names.length) return;
    await reviewMediaStorage(true);
  } catch (error) {
    console.warn('[media storage] check failed', error);
  }
}

const PERIODIC_MS = 30 * 60 * 1000;

/** Control window only: checks after startup, when new media is stored, and every half hour. */
export function useMediaStorageMonitor(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !mediaStorageAvailable()) return;
    scheduleMediaStorageCheck(15_000);
    const off = api()?.onMediaStorageChanged?.(() => scheduleMediaStorageCheck());
    const interval = setInterval(() => scheduleMediaStorageCheck(0), PERIODIC_MS);
    return () => { off?.(); clearInterval(interval); clearTimeout(timer); };
  }, [enabled]);
}
