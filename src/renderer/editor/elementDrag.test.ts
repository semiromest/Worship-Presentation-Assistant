import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SlideItem } from '../types';
import {
  ELEMENT_DRAG_MIME,
  isElementDrag,
  parseElementDrag,
  readElementDrag,
  serializeElementDrag,
  writeElementDrag,
} from './elementDrag';

const item = (overrides: Partial<SlideItem> = {}): SlideItem => ({
  id: 'i1',
  type: 'text',
  content: 'Merhaba',
  x: 10,
  y: 20,
  width: 30,
  height: 12,
  zIndex: 0,
  styles: {},
  ...overrides,
});

/** Minimal DataTransfer stand-in: only what the drag helpers touch. */
interface FakeDataTransfer {
  types: string[];
  effectAllowed: string;
  setData(type: string, value: string): void;
  getData(type: string): string;
}

function fakeDataTransfer(initial: Record<string, string> = {}): FakeDataTransfer {
  const store = new Map(Object.entries(initial));
  const transfer: FakeDataTransfer = {
    types: [...store.keys()],
    effectAllowed: '',
    setData(type, value) {
      if (!transfer.types.includes(type)) transfer.types.push(type);
      store.set(type, value);
    },
    getData(type) {
      return store.get(type) ?? '';
    },
  };
  return transfer;
}

/** The drag helpers only need setData/getData/types; the DOM type is broader. */
const asTransfer = (fake: FakeDataTransfer): DataTransfer => fake as unknown as DataTransfer;

test('a drag payload round-trips through serialisation', () => {
  const payload = { items: [item(), item({ id: 'i2', type: 'image', mediaUrl: 'file:///logo.png' })], sourceSlideId: 's3' };
  const parsed = parseElementDrag(serializeElementDrag(payload));

  assert.ok(parsed);
  assert.equal(parsed!.sourceSlideId, 's3');
  assert.deepEqual(parsed!.items.map((entry) => entry.id), ['i1', 'i2']);
  assert.equal(parsed!.items[1].mediaUrl, 'file:///logo.png');
});

test('junk payloads are rejected instead of crashing the drop handler', () => {
  assert.equal(parseElementDrag(''), null);
  assert.equal(parseElementDrag(null), null);
  assert.equal(parseElementDrag('not json'), null);
  assert.equal(parseElementDrag('{}'), null);
  assert.equal(parseElementDrag(JSON.stringify({ items: [] })), null);
  assert.equal(parseElementDrag(JSON.stringify({ items: [item()] })), null, 'a source slide is required');
});

test('entries without an id are filtered out but a usable payload survives', () => {
  const parsed = parseElementDrag(
    JSON.stringify({ sourceSlideId: 's1', items: [{ type: 'text' }, item({ id: 'good' })] }),
  );
  assert.ok(parsed);
  assert.deepEqual(parsed!.items.map((entry) => entry.id), ['good']);
});

test('only payloads carrying the element type are treated as element drags', () => {
  const elementTransfer = fakeDataTransfer();
  writeElementDrag(asTransfer(elementTransfer), { items: [item()], sourceSlideId: 's1' });

  assert.equal(isElementDrag(asTransfer(elementTransfer)), true);
  assert.equal(elementTransfer.effectAllowed, 'copy');
  assert.equal(elementTransfer.getData('text/plain'), 'text', 'plain text keeps the drag legible');
  assert.deepEqual(readElementDrag(asTransfer(elementTransfer))?.sourceSlideId, 's1');

  const fileTransfer = fakeDataTransfer({ 'text/plain': 'file:///a.png' });
  assert.equal(isElementDrag(asTransfer(fileTransfer)), false);
  assert.equal(readElementDrag(asTransfer(fileTransfer)), null);
  assert.equal(isElementDrag(null), false);
  assert.equal(readElementDrag(undefined), null);
});

test('the element mime type stays scoped to this app', () => {
  assert.equal(ELEMENT_DRAG_MIME, 'application/x-wpa-elements');
});
