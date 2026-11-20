import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { NdiSender } from './ndiSender';
import type { NdiStatus } from '../../shared/virtualOutputs';

class FakeWorker extends EventEmitter {
  messages: any[] = [];
  transfers: unknown[][] = [];
  terminated = false;
  postMessage(message: any, transfer?: unknown[]) { this.messages.push(message); this.transfers.push(transfer ?? []); }
  async terminate() { this.terminated = true; return 0; }
}

function setup() {
  const workers: FakeWorker[] = [];
  const statuses: NdiStatus[] = [];
  let now = 0;
  const sender = new NdiSender({
    name: 'WPA Program', fps: 30, onStatus: (s) => statuses.push(s), now: () => now,
    createWorker: () => { const w = new FakeWorker(); workers.push(w); return w as any; },
  });
  return { sender, workers, statuses, advance: (ms: number) => { now += ms; } };
}

test('asks for a repaint once started, so a static slide reaches the sender', () => {
  let repaints = 0;
  const workers: FakeWorker[] = [];
  const sender = new NdiSender({ name: 'x', fps: 30, onStatus: () => {}, onNeedFrame: () => { repaints++; },
    createWorker: () => { const w = new FakeWorker(); workers.push(w); return w as any; } });
  sender.start();
  assert.equal(repaints, 0);
  workers[0].emit('message', { type: 'started', sourceName: 'x', ndiVersion: '6' });
  assert.equal(repaints, 1);
  workers[0].emit('exit', 1);
  workers[1].emit('message', { type: 'started', sourceName: 'x', ndiVersion: '6' });
  assert.equal(repaints, 2, 'a restarted worker gets a fresh frame too');
});

test('starts the worker and reports the source once it is sending', () => {
  const { sender, workers, statuses } = setup();
  sender.start();
  assert.deepEqual(workers[0].messages[0], { type: 'start', name: 'WPA Program', fps: 30, straightAlpha: false, audio: false });
  workers[0].emit('message', { type: 'started', sourceName: 'PC (WPA Program)', ndiVersion: '6' });
  assert.equal(statuses.at(-1)?.active, true);
  assert.equal(statuses.at(-1)?.sourceName, 'PC (WPA Program)');
});

test('frames are dropped until started, then transferred without copying', () => {
  const { sender, workers } = setup();
  sender.start();
  const bitmap = Buffer.from(new ArrayBuffer(4 * 2 * 2));
  sender.pushBitmap(bitmap, 2, 2);
  assert.equal(workers[0].messages.length, 1, 'no frame before the sender exists');
  workers[0].emit('message', { type: 'started', sourceName: 'x', ndiVersion: '6' });
  sender.pushBitmap(bitmap, 2, 2);
  const frame = workers[0].messages[1];
  assert.equal(frame.type, 'frame');
  assert.equal(frame.stride, 8);
  assert.equal(workers[0].transfers[1][0], frame.data);
});

test('a crashed worker restarts at most three times a minute', () => {
  const { sender, workers, statuses, advance } = setup();
  sender.start();
  for (let i = 0; i < 3; i++) { workers.at(-1)!.emit('exit', 1); advance(1000); }
  assert.equal(workers.length, 4);
  workers.at(-1)!.emit('exit', 1);
  assert.equal(workers.length, 4, 'fourth crash within a minute stops retrying');
  assert.equal(statuses.at(-1)?.active, false);
});

test('a library load failure marks NDI unavailable and does not retry', () => {
  const { sender, workers, statuses } = setup();
  sender.start();
  workers[0].emit('message', { type: 'error', message: 'Cannot load NDI', fatal: true });
  workers[0].emit('exit', 1);
  assert.equal(workers.length, 1);
  assert.equal(workers[0].terminated, true);
  assert.equal(statuses.at(-1)?.available, false);
});

test('stop asks the worker to destroy the sender and ignores its exit', () => {
  const { sender, workers, statuses } = setup();
  sender.start();
  workers[0].emit('message', { type: 'started', sourceName: 'x', ndiVersion: '6' });
  sender.stop();
  assert.deepEqual(workers[0].messages.at(-1), { type: 'stop' });
  workers[0].emit('exit', 0);
  assert.equal(workers.length, 1);
  assert.equal(statuses.at(-1)?.active, false);
});

test('receiver stats and non-fatal errors update the status without stopping the sender', () => {
  const { sender, workers, statuses } = setup();
  sender.start();
  workers[0].emit('message', { type: 'started', sourceName: 'x', ndiVersion: '6' });
  workers[0].emit('message', { type: 'stats', connections: 2, onProgram: true, onPreview: false, sent: 90, dropped: 1, audio: false });
  assert.equal(statuses.at(-1)?.connections, 2);
  assert.equal(statuses.at(-1)?.onProgram, true);
  workers[0].emit('message', { type: 'error', message: 'slow receiver', fatal: false });
  assert.equal(statuses.at(-1)?.error, 'slow receiver');
  assert.equal(statuses.at(-1)?.active, true);
  assert.equal(workers[0].terminated, false);
});

test('audio blocks are forwarded only when the output carries audio', () => {
  const run = (audio: boolean) => {
    const workers: FakeWorker[] = [];
    const sender = new NdiSender({ name: 'x', fps: 30, audio, onStatus: () => {},
      createWorker: () => { const w = new FakeWorker(); workers.push(w); return w as any; } });
    sender.start();
    sender.pushAudio('music', new Float32Array(256));
    assert.equal(workers[0].messages.length, 1, 'no audio before the sender exists');
    workers[0].emit('message', { type: 'started', sourceName: 'x', ndiVersion: '6' });
    const block = new Float32Array(256);
    sender.pushAudio('music', block);
    return workers[0];
  };
  assert.equal(run(false).messages.length, 1);
  const worker = run(true);
  const message = worker.messages[1];
  assert.equal(message.type, 'audio');
  assert.equal(message.source, 'music');
  assert.equal(message.data.byteLength, 256 * 4);
  assert.equal(worker.transfers[1][0], message.data);
});

test('a frame view into a larger buffer is sliced, and an undetachable buffer is copied', () => {
  const { sender, workers } = setup();
  sender.start();
  workers[0].emit('message', { type: 'started', sourceName: 'x', ndiVersion: '6' });
  const pool = Buffer.alloc(64);
  sender.pushBitmap(pool.subarray(16, 32), 2, 2);
  assert.equal(workers[0].messages[1].data.byteLength, 16, 'only the frame bytes are sent');
  assert.equal(pool.buffer.byteLength, 64, 'the shared pool is not detached');
  workers[0].emit('message', { type: 'frame-accepted' });
  let attempts = 0;
  workers[0].postMessage = function (message: any, transfer?: unknown[]) {
    attempts++;
    if (transfer?.length) throw new Error('cannot detach');
    this.messages.push(message); this.transfers.push([]);
  };
  sender.pushBitmap(Buffer.from(new ArrayBuffer(16)), 2, 2);
  assert.equal(attempts, 2);
  assert.equal(workers[0].messages.at(-1).type, 'frame');
  assert.equal(workers[0].messages.at(-1).data.byteLength, 16);
});

test('a stalled worker retains only the newest paint and defers bitmap readback', () => {
  const { sender, workers } = setup();
  sender.start();
  const worker = workers[0];
  worker.emit('message', { type: 'started', sourceName: 'x', ndiVersion: '6' });
  let readbacks = 0;
  const image = (value: number) => ({
    getSize: () => ({ width: 2, height: 2 }),
    toBitmap: () => { readbacks++; return Buffer.alloc(16, value); },
  }) as any;
  sender.pushImage(image(1));
  for (let i = 2; i <= 100; i++) sender.pushImage(image(i));
  assert.equal(readbacks, 1);
  assert.equal(worker.messages.length, 2, 'only start and one frame cross the mailbox');
  worker.emit('message', { type: 'frame-accepted' });
  assert.equal(readbacks, 2);
  assert.equal(new Uint8Array(worker.messages.at(-1).data)[0], 100);
  worker.emit('message', { type: 'frame-accepted' });
  assert.equal(readbacks, 2, 'the final static frame is sent without another paint');
});

test('restart discards pending old frames and ignores acknowledgements from the old worker', () => {
  const { sender, workers } = setup();
  sender.start();
  workers[0].emit('message', { type: 'started', sourceName: 'x', ndiVersion: '6' });
  sender.pushBitmap(Buffer.alloc(16, 1), 2, 2);
  sender.pushBitmap(Buffer.alloc(16, 2), 2, 2);
  workers[0].emit('exit', 1);
  workers[1].emit('message', { type: 'started', sourceName: 'x', ndiVersion: '6' });
  sender.pushBitmap(Buffer.alloc(16, 3), 2, 2);
  workers[0].emit('message', { type: 'frame-accepted' });
  sender.pushBitmap(Buffer.alloc(16, 4), 2, 2);
  assert.equal(workers[1].messages.length, 2);
  workers[1].emit('message', { type: 'frame-accepted' });
  assert.equal(new Uint8Array(workers[1].messages.at(-1).data)[0], 4);
});

test('invalid dimensions and a dead worker cannot throw from a paint callback', () => {
  const { sender, workers } = setup();
  sender.start();
  workers[0].emit('message', { type: 'started', sourceName: 'x', ndiVersion: '6' });
  for (const [width, height] of [[0, 2], [2, 0], [-2, 2], [NaN, 2], [2, 3], [3, 2]]) {
    sender.pushBitmap(Buffer.alloc(16), width, height);
  }
  assert.equal(workers[0].messages.length, 1);
  workers[0].postMessage = () => { throw new Error('worker closed'); };
  assert.doesNotThrow(() => sender.pushBitmap(Buffer.alloc(16), 2, 2));
  assert.equal(sender.getStatus().error, 'worker closed');
});

test('worker construction failure is reported and an explicit retry restores availability', () => {
  const worker = new FakeWorker();
  let fail = true;
  const sender = new NdiSender({ name: 'x', fps: 30, onStatus: () => {}, createWorker: () => {
    if (fail) throw new Error('cannot create worker');
    return worker as any;
  } });
  assert.doesNotThrow(() => sender.start());
  assert.equal(sender.getStatus().error, 'cannot create worker');
  fail = false;
  sender.start();
  worker.emit('message', { type: 'error', fatal: true, message: 'load failed' });
  sender.start();
  worker.emit('message', { type: 'started', sourceName: 'x', ndiVersion: '6' });
  assert.equal(sender.getStatus().available, true);
  assert.equal(sender.getStatus().error, null);
});
