const listeners = new Set<() => void>();
let fast = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let broadcast = false;
export const previewScrollSubscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const previewScrollSnapshot = () => fast;
function publish(value: boolean) { if (fast !== value) { fast = value; listeners.forEach(listener => listener()); } }
export function notePreviewScroll(speed: number) {
  if (Math.abs(speed) > 0.8) publish(true);
  clearTimeout(timer);
  timer = setTimeout(() => publish(false), 160);
}
export function stopPreviewScroll() { clearTimeout(timer); publish(false); }
export function setPreviewBroadcast(value: boolean) { broadcast = value; }
/** Reduce native resource competition during live output, without oscillating
 * the limit on each frame or interrupting already-running work. */
export const imagePreviewConcurrency = () => broadcast ? 1 : 2;
