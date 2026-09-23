import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SttSessionGroup, finishSttSession } from './sttSessionGroup';
test('three targets connect at different times but all receive complete ordered audio', () => {
  const received: number[][] = [[], [], []];
  const group = new SttSessionGroup(message => assert.fail(message));
  received.forEach((values, i) => group.add(String(i), chunk => values.push(chunk[0])));
  group.ready('0'); group.send(new Uint8Array([1]));
  group.ready('1'); group.send(new Uint8Array([2]));
  assert.equal(group.connected, false);
  group.ready('2'); group.send(new Uint8Array([3]));
  assert.equal(group.connected, true);
  assert.deepEqual(received, [[1, 2, 3], [1, 2, 3], [1, 2, 3]]);
});
test('queue overflow and send failures surface instead of dropping audio silently', () => {
  const errors: string[] = [];
  const group = new SttSessionGroup(message => errors.push(message), 1);
  group.add('en', () => { throw new Error('closed'); });
  group.send(new Uint8Array([1])); group.send(new Uint8Array([2])); group.ready('en');
  assert.equal(errors.length, 2);
});
test('finish waits for trailing result before closing', async () => {
  const events: string[] = [];
  await finishSttSession({ finish: async () => { await new Promise(r => setTimeout(r, 5)); events.push('last words'); }, close: () => { events.push('closed'); } });
  assert.deepEqual(events, ['last words', 'closed']);
});
test('hung or connecting session always closes within timeout', async () => {
  let closed = 0;
  await finishSttSession({ finish: () => new Promise(() => {}), close: () => { closed++; } }, 5);
  await finishSttSession({ finish: async () => { throw new Error('connecting'); }, close: () => { closed++; } });
  assert.equal(closed, 2);
});
test('stop during delayed connection drains pending audio before finish', async () => {
  const events: string[] = [];
  const group = new SttSessionGroup(message => assert.fail(message));
  group.add('de', chunk => events.push('audio ' + chunk[0]));
  group.send(new Uint8Array([1]));
  const stopped = finishSttSession({ finish: async () => { events.push('final text'); }, close: () => { events.push('closed'); } }, 100, group.waitReady('de'));
  group.ready('de'); await stopped;
  assert.deepEqual(events, ['audio 1', 'final text', 'closed']);
});
test('connection after stop timeout cannot finish a closed session', async () => {
  const group = new SttSessionGroup(message => assert.fail(message)); group.add('de', () => {});
  let finishes = 0;
  await finishSttSession({ finish: async () => { finishes++; }, close: () => {} }, 5, group.waitReady('de'));
  group.ready('de'); await Promise.resolve(); assert.equal(finishes, 0);
});
