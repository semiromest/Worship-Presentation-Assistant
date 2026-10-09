import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPointerSession } from './pointerSession';

function fixture() {
  let nextId = 0;
  const frames = new Map<number, () => void>();
  const moves: number[] = [];
  const ends: boolean[] = [];
  const session = createPointerSession<string, { pointerId: number; type: string; x: number }>(
    (event) => moves.push(event.x),
    (_, unmount) => ends.push(unmount),
    (callback) => {
      frames.set(++nextId, callback);
      return nextId;
    },
    (id) => {
      frames.delete(id);
    }
  );
  return { session, moves, ends, frames };
}

test('many moves produce one frame update and pointerup retains its final coordinate', () => {
  const { session, moves, ends, frames } = fixture();
  assert.equal(session.begin(1, 'item'), true);
  assert.equal(session.begin(2, 'other'), false);
  for (let x = 0; x < 100; x++) session.move({ pointerId: 1, type: 'pointermove', x });
  assert.equal(frames.size, 1);
  [...frames.values()][0]();
  assert.deepEqual(moves, [99]);
  session.move({ pointerId: 1, type: 'pointermove', x: 100 });
  session.finish({ pointerId: 1, type: 'pointerup', x: 101 });
  assert.deepEqual(moves, [99, 101]);
  assert.deepEqual(ends, [false]);
  assert.equal(frames.size, 0);
  session.dispose();
  assert.equal(ends.length, 1);
});

test('unrelated pointers cannot move or terminate a gesture', () => {
  const { session, moves, ends, frames } = fixture();
  session.begin(1, 'item');
  session.move({ pointerId: 2, type: 'pointermove', x: 99 });
  session.finish({ pointerId: 2, type: 'pointerup', x: 99 });
  assert.equal(frames.size, 0);
  assert.equal(ends.length, 0);
  session.finish({ pointerId: 1, type: 'pointerup', x: 12 });
  assert.deepEqual(moves, [12]);
});

test('cancel, blur, and unmount keep the last valid sample and finish once', () => {
  for (const reason of ['cancel', 'blur', 'unmount']) {
    const { session, moves, ends, frames } = fixture();
    session.begin(1, 'item');
    session.move({ pointerId: 1, type: 'pointermove', x: 25 });
    if (reason === 'cancel') session.finish({ pointerId: 1, type: 'pointercancel', x: 0 });
    else if (reason === 'blur') session.finish();
    else session.dispose();
    session.finish();
    session.dispose();
    assert.deepEqual(moves, [25]);
    assert.deepEqual(ends, [reason === 'unmount']);
    assert.equal(frames.size, 0);
  }
});
