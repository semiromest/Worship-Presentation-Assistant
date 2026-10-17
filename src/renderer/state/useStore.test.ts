import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Presentation } from '../types';

test('store slices preserve atomic updates, no-op snapshots and independent UI changes', async () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  };
  Object.assign(globalThis, {
    window: { location: { search: '' }, localStorage: storage },
    localStorage: storage,
    document: {
      documentElement: { lang: 'en' },
      getElementById: () => ({}),
      createElement: () => ({}),
      head: { appendChild: () => {} },
    },
  });
  const { useStore } = await import('./useStore');
  const deck: Presentation = {
    id: 'test',
    name: 'Test',
    slides: ['a', 'b', 'c'].map((id) => ({ id, type: 'text', content: id })),
  };
  useStore.getState().dispatchUndo({ type: 'RESET', payload: deck });
  let notifications = 0;
  const off = useStore.subscribe(() => {
    notifications++;
  });
  const before = useStore.getState();
  before.setActiveTab(before.activeTab);
  before.setSelectedSlideIds(new Set(before.selectedSlideIds));
  assert.equal(useStore.getState(), before);
  assert.equal(notifications, 0);
  before.selectSlides({ activeId: 'b', ids: new Set(['b']), anchorIndex: 1, liveTargetId: 'b' });
  assert.equal(notifications, 1);
  assert.equal(useStore.getState().liveSlideId, 'b');
  assert.equal(useStore.getState().selectedSlideId, 'b');
  const presentation = useStore.getState().presentation;
  useStore.getState().setSlideZoom(1.5);
  useStore.getState().setDriveSigningIn(true);
  assert.equal(useStore.getState().presentation, presentation);
  useStore.getState().setPresentationName('Renamed');
  useStore.getState().dispatchUndo({ type: 'UNDO' });
  assert.equal(useStore.getState().presentation.name, 'Test');
  useStore.getState().dispatchUndo({ type: 'REDO' });
  assert.equal(useStore.getState().presentation.name, 'Renamed');
  useStore.getState().toggleSlideLock('b');
  useStore.getState().setLiveIndex(2);
  assert.equal(useStore.getState().liveSlideId, 'b');
  const { computePatch } = await import('./undoReducer');
  const current = useStore.getState().presentation;
  const history = useStore.getState().undoState.past;
  const patch = computePatch(current, { ...current, name: 'Synced' });
  useStore.getState().applyProjectorDelta(patch);
  assert.equal(useStore.getState().presentation.name, 'Synced');
  assert.equal(useStore.getState().undoState.past, history);
  const display = { id: 'secondary', label: 'Output', isPrimary: false, scaleFactor: 1,
    bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } };
  useStore.getState().setDisplays([display]);
  useStore.getState().setOutputOpen(display.id, true);
  assert.equal(useStore.getState().outputAssignments.secondary.isOpen, true);
  useStore.getState().setDisplays([]);
  assert.deepEqual(useStore.getState().outputAssignments, {});
  off();
});
