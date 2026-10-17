import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveKeyboardCommand, type KeyInput, type KeyContext } from './keyboardCommands';

const context: KeyContext = {
  activeTab: 'slides',
  helpOpen: false,
  outputOpen: false,
  hasSelection: true,
  selectedIndex: 0,
};
const key = (key: string, modifiers: Partial<KeyInput> = {}): KeyInput => ({
  key,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...modifiers,
});

test('editor owns editing keys while operator mute and blackout remain available', () => {
  const editor = { ...context, activeTab: 'editor', outputOpen: true };
  for (const name of ['Enter', 'Escape', 'Delete', 'Home', 'End', 'ArrowUp', 'j', ' '])
    assert.equal(resolveKeyboardCommand(key(name), editor), null);
  assert.equal(resolveKeyboardCommand(key('z', { ctrlKey: true }), editor), null);
  assert.deepEqual(resolveKeyboardCommand(key('m'), editor), { type: 'mute' });
  assert.deepEqual(resolveKeyboardCommand(key('b'), editor), { type: 'blackout' });
});

test('command priority keeps move distinct from navigation, shortcuts and text undo', () => {
  assert.deepEqual(resolveKeyboardCommand(key('ArrowUp', { altKey: true }), context), { type: 'move', direction: -1 });
  assert.deepEqual(resolveKeyboardCommand(key('ArrowUp'), context), { type: 'navigate', direction: 'previous' });
  assert.deepEqual(resolveKeyboardCommand(key('z', { metaKey: true, shiftKey: true }), context), { type: 'redo' });
  assert.deepEqual(resolveKeyboardCommand(key('9', { altKey: true }), context), {
    type: 'tab',
    destination: 'settings',
  });
  assert.equal(resolveKeyboardCommand(key('Delete'), { ...context, hasSelection: false }), null);
  assert.equal(resolveKeyboardCommand(key('d', { ctrlKey: true }), { ...context, helpOpen: true }), null);
  assert.deepEqual(resolveKeyboardCommand(key('Escape'), { ...context, outputOpen: true, helpOpen: true }), {
    type: 'close-output',
  });
  assert.equal(resolveKeyboardCommand(key('Escape'), { ...context, helpOpen: true }), null);
});
