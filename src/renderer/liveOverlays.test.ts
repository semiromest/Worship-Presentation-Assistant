import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIVE_OVERLAYS, TICKER_MAX_LENGTH, parseLiveOverlays, speakerVisible, tickerDurationSeconds,
  tickerLine, tickerRepeatCount, tickerVisible,
} from './liveOverlays';

test('parseLiveOverlays falls back to defaults for missing or broken storage', () => {
  assert.deepEqual(parseLiveOverlays(null), DEFAULT_LIVE_OVERLAYS);
  assert.deepEqual(parseLiveOverlays('{not json'), DEFAULT_LIVE_OVERLAYS);
  assert.deepEqual(parseLiveOverlays('[1,2]'), DEFAULT_LIVE_OVERLAYS);
});

test('parseLiveOverlays clamps text and drops on-air without content', () => {
  const state = parseLiveOverlays(JSON.stringify({
    ticker: { text: 'x'.repeat(TICKER_MAX_LENGTH + 20), position: 'bottom', onAir: true },
    speaker: { name: '   ', title: 'Lead Pastor', onAir: true },
  }));
  assert.equal(state.ticker.text.length, TICKER_MAX_LENGTH);
  assert.equal(state.ticker.position, 'bottom');
  assert.equal(state.ticker.onAir, true);
  assert.equal(state.speaker.onAir, false);
  assert.equal(parseLiveOverlays(JSON.stringify({ ticker: { position: 'left' } })).ticker.position, 'top');
});

test('visibility needs both the on-air flag and text', () => {
  assert.equal(tickerVisible({ text: 'Room 3', position: 'top', onAir: true }), true);
  assert.equal(tickerVisible({ text: ' ', position: 'top', onAir: true }), false);
  assert.equal(speakerVisible({ name: 'Daniel', title: '', onAir: false }), false);
  assert.equal(speakerVisible({ name: 'Daniel', title: '', onAir: true }), true);
});

test('ticker helpers keep the marquee seamless', () => {
  assert.equal(tickerLine('  Parents of\nSophie   please '), 'Parents of Sophie please');
  assert.equal(tickerRepeatCount(400, 1920), 5);
  assert.equal(tickerRepeatCount(3000, 1920), 1);
  assert.equal(tickerRepeatCount(0, 1920), 1);
  assert.equal(tickerDurationSeconds(1400, 1), 10);
  assert.equal(tickerDurationSeconds(100, 1), 4);
  assert.equal(tickerDurationSeconds(0, 1), 0);
});
