import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readWindowState, restoreWindowState, writeWindowState } from './windowState';

const laptop = { x: 0, y: 0, width: 1366, height: 728 };
const projector = { x: 1366, y: 0, width: 1920, height: 1080 };

test('saved window bounds restore only onto a display that is still connected', () => {
  const saved = { bounds: { x: 100, y: 50, width: 1000, height: 700 }, maximized: false };
  assert.deepEqual(restoreWindowState(saved, [laptop]), saved);
  // Saved on the projector, projector now unplugged: fall back to the default placement.
  assert.equal(restoreWindowState({ bounds: { x: 1500, y: 40, width: 1200, height: 800 }, maximized: false }, [laptop]), null);
  assert.ok(restoreWindowState({ bounds: { x: 1500, y: 40, width: 1200, height: 800 }, maximized: false }, [laptop, projector]));
  // Title bar above the top of every display cannot be grabbed.
  assert.equal(restoreWindowState({ bounds: { x: 100, y: -500, width: 1000, height: 400 }, maximized: false }, [laptop]), null);
});

test('restored size respects the minimum and the display size; maximized defaults to true', () => {
  const tiny = restoreWindowState({ bounds: { x: 10, y: 10, width: 100, height: 100 } }, [laptop]);
  assert.deepEqual(tiny, { bounds: { x: 10, y: 10, width: 800, height: 600 }, maximized: true });
  const huge = restoreWindowState({ bounds: { x: 0, y: 0, width: 5000, height: 4000 }, maximized: false }, [laptop]);
  assert.deepEqual(huge?.bounds, { x: 0, y: 0, width: 1366, height: 728 });
  for (const bad of [null, 'x', {}, { bounds: { x: 'a', y: 0, width: 1, height: 1 } }, { bounds: { x: NaN, y: 0, width: 900, height: 700 } }]) {
    assert.equal(restoreWindowState(bad, [laptop]), null);
  }
});

test('window state round-trips through disk and tolerates a corrupt file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'window-state-test-'));
  try {
    const file = path.join(dir, 'window-state.json');
    assert.equal(readWindowState(file, [laptop]), null);
    const state = { bounds: { x: 20, y: 30, width: 1100, height: 690 }, maximized: false };
    writeWindowState(file, state);
    assert.deepEqual(readWindowState(file, [laptop]), state);
    fs.writeFileSync(file, '{not json');
    assert.equal(readWindowState(file, [laptop]), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
