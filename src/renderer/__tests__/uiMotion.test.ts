import test from 'node:test';
import assert from 'node:assert/strict';
import { readUiMotionEnabled, UI_MOTION_STORAGE_KEY, writeUiMotionEnabled } from '../uiMotion';

function withStorage(initial: string | null, run: (values: Map<string, string>) => void) {
  const values = new Map<string, string>();
  if (initial !== null) values.set(UI_MOTION_STORAGE_KEY, initial);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });

  try {
    run(values);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
}

test('UI motion is enabled by default', () => {
  withStorage(null, () => assert.equal(readUiMotionEnabled(), true));
});

test('UI motion preference persists both states', () => {
  withStorage(null, (values) => {
    writeUiMotionEnabled(false);
    assert.equal(values.get(UI_MOTION_STORAGE_KEY), '0');
    assert.equal(readUiMotionEnabled(), false);

    writeUiMotionEnabled(true);
    assert.equal(values.get(UI_MOTION_STORAGE_KEY), '1');
    assert.equal(readUiMotionEnabled(), true);
  });
});
