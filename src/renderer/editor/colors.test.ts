import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addRecentColor, getRecentColors } from './colors';

test('color history handles malformed data, deduplicates, and limits entries', () => {
  let stored: string | null = null;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    },
  });
  try {
    for (stored of ['{', '{}', 'null', '42', '"red"']) assert.deepEqual(getRecentColors(), []);
    stored = JSON.stringify(['#123456', null, 12, 'bad', '#123456', '#abc']);
    assert.deepEqual(getRecentColors(), ['#123456', '#abc']);
    addRecentColor('#ABC');
    assert.deepEqual(getRecentColors(), ['#ABC', '#123456']);
    for (let i = 0; i < 30; i++) addRecentColor('#' + (i + 1).toString(16).padStart(6, '0'));
    assert.equal(getRecentColors().length, 12);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('blocked storage never interrupts color application', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => {
      throw new Error('blocked');
    },
  });
  try {
    assert.deepEqual(getRecentColors(), []);
    assert.doesNotThrow(() => addRecentColor('#123456'));
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
