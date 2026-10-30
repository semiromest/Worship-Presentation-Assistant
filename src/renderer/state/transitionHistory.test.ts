import test from 'node:test';
import assert from 'node:assert/strict';
import { undoReducer } from './undoReducer';
import type { Presentation } from '../types';

const deck: Presentation = { id: 'transition-history', name: 'Test', slides: [] };

test('first explicit effect is recorded and survives undo/redo when the deck used defaults', () => {
  const transition = { type: 'flip' as const, duration: 600 };
  const changed = undoReducer({ past: [], present: deck, future: [] }, { type: 'SET', payload: { ...deck, transition } });
  assert.deepEqual(changed.present.transition, transition);
  assert.equal(changed.past.length, 1);
  const undone = undoReducer(changed, { type: 'UNDO' });
  assert.equal(undone.present.transition, undefined);
  const redone = undoReducer(undone, { type: 'REDO' });
  assert.deepEqual(redone.present.transition, transition);
});

test('returning to default effects is undoable without changing the presentation', () => {
  const transition = { type: 'fade' as const, duration: 800 };
  const original = { ...deck, transition };
  const changed = undoReducer({ past: [], present: original, future: [] }, { type: 'SET', payload: deck });
  assert.equal(changed.present.transition, undefined);
  const undone = undoReducer(changed, { type: 'UNDO' });
  assert.deepEqual(undone.present.transition, transition);
  const redone = undoReducer(undone, { type: 'REDO' });
  assert.equal(redone.present.transition, undefined);
  assert.equal(redone.present.id, original.id);
});
