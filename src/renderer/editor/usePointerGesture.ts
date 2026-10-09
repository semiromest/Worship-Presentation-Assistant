import { useCallback, useEffect, useRef } from 'react';
import { createPointerSession } from './pointerSession';

export const FINISH_EDITOR_GESTURE = 'editor-finish-gesture';
export function finishEditorGesture() {
  window.dispatchEvent(new Event(FINISH_EDITOR_GESTURE));
}

export function usePointerGesture<T>(
  onMove: (event: PointerEvent, start: T) => void,
  onFinish: (start: T, unmount: boolean) => void
) {
  const callbacks = useRef({ onMove, onFinish });
  callbacks.current = { onMove, onFinish };
  const disposeRef = useRef<(() => void) | null>(null);
  const begin = useCallback((event: React.PointerEvent<HTMLElement>, start: T) => {
    if (disposeRef.current) return false;
    const pointerId = event.pointerId;
    const target = event.currentTarget;
    const finishCallback = callbacks.current.onFinish;
    const moveCallback = callbacks.current.onMove;
    const controller = createPointerSession<T, PointerEvent>(
      moveCallback,
      (initial, unmount) => {
        detach();
        disposeRef.current = null;
        if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
        finishCallback(initial, unmount);
      },
      requestAnimationFrame,
      cancelAnimationFrame
    );
    const move = (sample: PointerEvent) => controller.move(sample);
    const finish = (sample: Event) => controller.finish(sample instanceof PointerEvent ? sample : undefined);
    const detach = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('lostpointercapture', finish);
      window.removeEventListener('blur', finish);
      window.removeEventListener(FINISH_EDITOR_GESTURE, finish);
    };
    controller.begin(pointerId, start);
    disposeRef.current = () => controller.dispose();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('lostpointercapture', finish);
    window.addEventListener('blur', finish);
    window.addEventListener(FINISH_EDITOR_GESTURE, finish);
    target.setPointerCapture?.(pointerId);
    return true;
  }, []);
  useEffect(() => () => disposeRef.current?.(), []);
  return begin;
}
