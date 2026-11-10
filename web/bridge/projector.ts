// Projector outputs for the web app. The control page opens one browser window
// per output (`?mode=projector`), and both sides talk over a BroadcastChannel
// scoped to this control session. The hub mirrors the Electron main process
// (src/main/main.ts createProjectorWindow / update-projector / projector-ready):
// one reconstructable snapshot per output, replayed whenever the output
// (re)loads, and per-output frames for follow/manual/stage modes.
import type { DisplayInfo, ProjectorOutputStatus } from '../../src/shared/displays';
import { chooseDefaultOutputDisplay, compareDisplays } from '../../src/shared/displays';
import { mergeProjectorSnapshot } from '../../src/shared/projectorSnapshot';
import { emit } from './events';
import { notify } from './dialogs';

type Message =
  | { type: 'ready'; displayId: string; token?: string }
  | { type: 'unload'; displayId: string }
  | { type: 'key'; displayId: string; action: string; value?: unknown }
  | { type: 'update'; displayId: string; frame: Record<string, any> };

interface Output {
  displayId: string;
  win: Window;
  ready: boolean;
  token?: string;
  lastFrame?: Record<string, any>;
  pending: Record<string, any> | null;
}

const params = new URLSearchParams(location.search);
export const IS_OUTPUT = params.get('mode') === 'projector';
const session = IS_OUTPUT ? params.get('session') ?? '' : crypto.randomUUID();
const channel = new BroadcastChannel(`wpa-output-${session}`);
const post = (message: Message) => channel.postMessage(message);

// ─── displays ──────────────────────────────────────────────────────────────

type ScreenDetailed = Screen & { left: number; top: number; availLeft: number; availTop: number; isPrimary: boolean; devicePixelRatio: number; label: string };
type ScreenDetails = EventTarget & { screens: ScreenDetailed[]; currentScreen: ScreenDetailed };
const supportsScreens = 'getScreenDetails' in window;
let screenDetails: ScreenDetails | null = null;
let screenById = new Map<string, ScreenDetailed>();

/** Without the Window Management API the second "display" is simply a separate window. */
const WINDOW_OUTPUT = 'web-window';
function fallbackDisplays(): DisplayInfo[] {
  const rect = { x: 0, y: 0, width: screen.width, height: screen.height };
  return [
    { id: 'web-main', label: 'Primary', isPrimary: true, bounds: rect, workArea: rect, scaleFactor: devicePixelRatio },
    { id: WINDOW_OUTPUT, label: 'Screen 1', isPrimary: false, bounds: rect, workArea: rect, scaleFactor: devicePixelRatio },
  ];
}

function detailedDisplays(details: ScreenDetails): DisplayInfo[] {
  screenById = new Map();
  const infos = details.screens.map(s => {
    const id = `screen:${s.left},${s.top},${s.width}x${s.height}`;
    screenById.set(id, s);
    return {
      id, label: '', isPrimary: s.isPrimary,
      bounds: { x: s.left, y: s.top, width: s.width, height: s.height },
      workArea: { x: s.availLeft, y: s.availTop, width: s.availWidth, height: s.availHeight },
      scaleFactor: s.devicePixelRatio,
    } satisfies DisplayInfo;
  }).sort(compareDisplays);
  let secondary = 0;
  for (const info of infos) info.label = info.isPrimary ? 'Primary' : `Screen ${++secondary}`;
  // A single physical screen still needs somewhere to send the output.
  if (!infos.some(info => !info.isPrimary)) infos.push(fallbackDisplays()[1]);
  return infos;
}

let displays: DisplayInfo[] = fallbackDisplays();

async function adoptScreenDetails(): Promise<void> {
  if (!supportsScreens || screenDetails) return;
  screenDetails = await (window as any).getScreenDetails() as ScreenDetails;
  const refresh = () => { displays = detailedDisplays(screenDetails!); emit('displays-changed', displays); emitStatus(); };
  screenDetails.addEventListener('screenschange', refresh);
  refresh();
}

async function windowManagementState(): Promise<PermissionState | 'unsupported'> {
  if (!supportsScreens) return 'unsupported';
  try { return (await navigator.permissions.query({ name: 'window-management' as PermissionName })).state; }
  catch { return 'prompt'; }
}

export async function getDisplays(): Promise<DisplayInfo[]> {
  if ((await windowManagementState()) === 'granted') await adoptScreenDetails().catch(() => {});
  return displays;
}

// ─── control side ──────────────────────────────────────────────────────────

const outputs = new Map<string, Output>();
let poll: ReturnType<typeof setInterval> | undefined;

const status = (): ProjectorOutputStatus[] =>
  [...outputs.values()].map(o => ({ displayId: o.displayId, isOpen: !o.win.closed, isReady: o.ready }));
function emitStatus() { emit('projector-output-status', status()); }

function watchOutputs() {
  poll ??= setInterval(() => {
    for (const output of [...outputs.values()]) {
      if (!output.win.closed) continue;
      outputs.delete(output.displayId);
      emit('projector-closed', { displayId: output.displayId });
      emitStatus();
    }
    if (!outputs.size) { clearInterval(poll); poll = undefined; }
  }, 400);
}

function resolveDisplay(displayId?: string): DisplayInfo | undefined {
  if (displayId) {
    const known = displays.find(d => d.id === displayId);
    if (known) return known;
    // The plain-window output disappears once real screens are known: send it to the second screen instead.
    if (displayId === WINDOW_OUTPUT) return screenDetails ? chooseDefaultOutputDisplay(displays) : fallbackDisplays()[1];
    return undefined;
  }
  return chooseDefaultOutputDisplay(displays);
}

/**
 * Like the desktop app, an output should land on the extended display (a projector, a TV, or a
 * SpaceDesk/Duet-style virtual screen). Browsers only list those screens after the user allows
 * "window management", so the first broadcast asks for it before choosing where to open.
 * Returns false when the click's user activation was used up by the permission prompt.
 */
async function prepareScreens(): Promise<boolean> {
  if (screenDetails) return true;
  const state = await windowManagementState();
  if (state === 'unsupported' || state === 'denied') return true;
  try { await adoptScreenDetails(); } catch { return true; }
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  if (state === 'prompt' && activation && !activation.isActive) {
    void notify('screensReady');
    return false;
  }
  return true;
}

export async function openOutput(requestedDisplayId?: string, initialData?: any): Promise<boolean> {
  if (!(await prepareScreens())) return false;
  return openOutputNow(requestedDisplayId, initialData);
}

function openOutputNow(requestedDisplayId?: string, initialData?: any): boolean {
  const display = resolveDisplay(requestedDisplayId);
  if (!display) return false;
  const displayId = display.id;
  const existing = outputs.get(displayId);
  if (existing && !existing.win.closed) { existing.win.focus(); return true; }

  const target = screenById.get(displayId);
  const area = target
    ? { left: target.availLeft, top: target.availTop, width: target.availWidth, height: target.availHeight }
    : { left: Math.max(0, screen.width - 1280) / 2, top: Math.max(0, screen.height - 720) / 2, width: 1280, height: 720 };
  // No `fullscreen` window feature: Chrome dropped "fullscreen popups" after its origin trial.
  // The output window enters fullscreen itself (see installOutputChrome).
  const features = [`popup`, `left=${Math.round(area.left)}`, `top=${Math.round(area.top)}`, `width=${Math.round(area.width)}`, `height=${Math.round(area.height)}`];

  const outputMode = initialData?.outputMode === 'stage' ? 'stage' : 'follow';
  const url = new URL(location.href);
  url.hash = '';
  const query: Record<string, string> = { mode: 'projector', displayId, outputMode, session };
  if (target && !target.isPrimary) query.fullscreen = '1';
  url.search = new URLSearchParams(query).toString();
  const win = window.open(url.href, `wpa-output-${session}-${displayId}`, features.join(','));
  if (!win) {
    void notify('popupBlocked');
    return false;
  }
  outputs.set(displayId, { displayId, win, ready: false, pending: initialData ?? null, lastFrame: initialData?.fullPresentation ? initialData : undefined });
  watchOutputs();
  emitStatus();
  return true;
}

export function closeOutput(displayId: string): boolean {
  const output = outputs.get(String(displayId));
  if (!output) return false;
  if (!output.win.closed) output.win.close();
  return true;
}

export async function toggleOutput(initialData?: any, requestedDisplayId?: string): Promise<boolean> {
  const display = resolveDisplay(requestedDisplayId);
  const current = display && outputs.get(display.id);
  if (current && !current.win.closed) { current.win.close(); return false; }
  if (!(await prepareScreens())) return false;
  // Resolve again: the permission prompt may just have revealed the second screen.
  return openOutputNow(requestedDisplayId, initialData);
}

export function updateOutputs(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const payload = data as Record<string, any>;
  const frames = payload.outputs && typeof payload.outputs === 'object' ? payload.outputs as Record<string, any> : null;
  const base = { ...payload };
  delete base.outputs;
  for (const output of outputs.values()) {
    if (output.win.closed) continue;
    const assigned = frames?.[output.displayId];
    const frame = {
      ...base,
      ...(assigned && typeof assigned === 'object'
        ? { liveIndex: assigned.slideIndex, liveSlideId: assigned.slideId, isBlackout: !!assigned.isBlackout, outputMode: assigned.mode, outputDisplayId: output.displayId }
        : { outputDisplayId: output.displayId }),
    };
    output.lastFrame = mergeProjectorSnapshot(output.lastFrame, frame);
    if (!output.ready) { output.pending = output.lastFrame ?? frame; continue; }
    post({ type: 'update', displayId: output.displayId, frame: { ...frame, receiverToken: output.token } });
  }
  return outputs.size > 0;
}

export const outputStatus = status;
export function defaultOutputOpen(): boolean {
  const id = chooseDefaultOutputDisplay(displays)?.id;
  const output = id ? outputs.get(id) : undefined;
  return output ? !output.win.closed : [...outputs.values()].some(o => !o.win.closed);
}

const NAV_NEXT = new Set(['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'j', 'J']);
const NAV_PREV = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'k', 'K']);

if (!IS_OUTPUT) {
  channel.onmessage = ({ data }: MessageEvent<Message>) => {
    const output = data && outputs.get(data.displayId);
    if (!output || output.win.closed) return;
    if (data.type === 'ready') {
      output.ready = true;
      output.token = typeof data.token === 'string' && data.token.length <= 100 ? data.token : undefined;
      const snapshot = output.lastFrame ?? output.pending;
      if (snapshot) { post({ type: 'update', displayId: output.displayId, frame: { ...snapshot, receiverToken: output.token } }); output.pending = null; }
      emit('projector-ready-ack', { displayId: output.displayId });
      emitStatus();
    } else if (data.type === 'unload') {
      output.ready = false;
      output.token = undefined;
      output.pending = output.lastFrame ?? null;
      emitStatus();
    } else if (data.type === 'key') {
      emit('remote-action', { action: data.action, value: data.value });
    }
  };
  // Outputs belong to this control page; leaving it ends the broadcast.
  window.addEventListener('pagehide', () => { for (const output of outputs.values()) if (!output.win.closed) output.win.close(); });
}

/** Same policies as web/policies/allow-presentation-output.reg, for the origin this app runs on. */
// Chrome reads list policies as values "1", "2", ... in order, so the published site always
// keeps "1" (as in the ready-made file) and another host this app runs on gets "2".
const PUBLISHED_ORIGIN = 'https://semiromest.github.io';
export function downloadPolicyFile(): void {
  const origins = [...new Set([PUBLISHED_ORIGIN, location.origin])];
  const lines = ['Windows Registry Editor Version 5.00', '',
    '; Worship Presentation Assistant web app: the output window may open fullscreen on the',
    `; second screen without a click, for ${origins.join(' and ')} only.`,
    '; Double-click, confirm, then restart the browser. Undo: web/policies/remove-presentation-output.reg', ''];
  for (const browser of ['Google\\Chrome', 'Microsoft\\Edge']) {
    for (const policy of ['AutomaticFullscreenAllowedForUrls', 'WindowManagementAllowedForUrls', 'PopupsAllowedForUrls']) {
      lines.push(`[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\${browser}\\${policy}]`, ...origins.map((origin, i) => `"${i + 1}"="${origin}"`), '');
    }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'application/octet-stream' }));
  link.download = 'allow-presentation-output.reg';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

// ─── output side ───────────────────────────────────────────────────────────

const OUTPUT_ID = params.get('displayId') ?? '';

export function onOutputUpdate(callback: (frame: any) => void): () => void {
  const listener = ({ data }: MessageEvent<Message>) => {
    if (data?.type === 'update' && data.displayId === OUTPUT_ID) callback(data.frame);
  };
  channel.addEventListener('message', listener);
  return () => channel.removeEventListener('message', listener);
}

export function notifyOutputReady(_displayId?: string, token?: string): void {
  post({ type: 'ready', displayId: OUTPUT_ID, token });
}

function installOutputChrome(): void {
  window.addEventListener('pagehide', () => post({ type: 'unload', displayId: OUTPUT_ID }));
  // The output window has focus right after it opens, so the operator's first key press
  // (usually → for the next slide) lands here: that press, or any click, enters fullscreen.
  // Once the user leaves fullscreen with Esc, only F or a click brings it back.
  let userLeftFullscreen = false;
  let wasFullscreen = false;
  document.addEventListener('fullscreenchange', () => {
    if (wasFullscreen && !document.fullscreenElement) userLeftFullscreen = true;
    wasFullscreen = !!document.fullscreenElement;
  });
  // Same keyboard bridge as the desktop projector window: navigation goes to the control page.
  window.addEventListener('keydown', event => {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    const toggleKey = event.key === 'f' || event.key === 'F' || event.key === 'F11';
    if (!toggleKey && event.key !== 'Escape' && !userLeftFullscreen && !document.fullscreenElement) void enterFullscreen();
    const send = (action: string, value?: unknown) => post({ type: 'key', displayId: OUTPUT_ID, action, value });
    const key = event.key;
    if (NAV_NEXT.has(key)) send('next');
    else if (NAV_PREV.has(key)) send('prev');
    else if (key === 'Home') send('goto', 0);
    else if (key === 'End') send('goto', 2 ** 31 - 1);
    else if (key === 'b' || key === 'B') send('blackout');
    else if (key === 'Escape') { if (!document.fullscreenElement) window.close(); else return; }
    else if (toggleKey) { event.preventDefault(); void toggleFullscreen(); return; }
    else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  // A single click anywhere in the output enters fullscreen (F toggles it, Esc leaves it).
  window.addEventListener('click', () => { if (!document.fullscreenElement) void enterFullscreen(); }, true);

  // On a second screen where the automatic-fullscreen policy allows this site (Settings > Presentation),
  // the output goes fullscreen on its own; otherwise a click or key press does it. No on-screen warning.
  const mount = () => {
    // Only on a second screen, as on the desktop; on the main screen it would hide the control panel.
    // Succeeds without a click only where the policy allows this site; otherwise the control
    // page offers the policy file.
    if (params.get('fullscreen') === '1') autoFullscreen(() => userLeftFullscreen);
  };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
  document.title = 'Worship Presentation Assistant - Projection';
}

/**
 * A single request right after the window opens is not reliable: Chrome may refuse it while
 * it is still placing the new window on the second screen, or while the previous output
 * window is still leaving fullscreen. So keep trying for a few seconds (and whenever the
 * window is moved, resized or focused), and only report a block once every attempt failed.
 */
function autoFullscreen(userLeft: () => boolean): void {
  const DELAYS = [0, 150, 400, 800, 1500, 2500, 4000, 6000];
  const deadline = Date.now() + 8000;
  let done = false;
  let lastError = '';
  const attempt = async () => {
    if (done || userLeft()) return finish();
    if (await enterFullscreen(error => { lastError = error; })) finish();
  };
  const events = ['focus', 'resize'] as const;
  const onEvent = () => { if (Date.now() < deadline) void attempt(); };
  const timers = DELAYS.map(delay => setTimeout(() => void attempt(), delay));
  const report = setTimeout(() => {
    if (done || userLeft() || document.fullscreenElement) return finish();
    finish();
    console.warn('[output] automatic fullscreen was refused:', lastError);
  }, DELAYS[DELAYS.length - 1] + 500);
  function finish() {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    clearTimeout(report);
    for (const name of events) window.removeEventListener(name, onEvent);
  }
  for (const name of events) window.addEventListener(name, onEvent);
}

async function enterFullscreen(onError?: (message: string) => void): Promise<boolean> {
  if (document.fullscreenElement) return true;
  try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); return true; }
  catch (error) {
    // No gesture and no policy: a click or a key works.
    onError?.(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return false;
  }
}

async function toggleFullscreen(): Promise<void> {
  if (!document.fullscreenElement) { await enterFullscreen(); return; }
  try { await document.exitFullscreen(); } catch { /* already left */ }
}

if (IS_OUTPUT) installOutputChrome();
