import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCountdownData, parseCountdownContent, serializeCountdownContent, getCountdownRemaining, formatCountdownTime, COUNTDOWN_QUICK_PRESETS } from './countdownUtils';

test('countdown presets round trip and reach zero without going negative', () => {
  for (const preset of COUNTDOWN_QUICK_PRESETS) {
    const data = { ...buildCountdownData(preset.minutes, preset.seconds), startTime: 1000 };
    const restored = parseCountdownContent(serializeCountdownContent(data));
    assert.equal(restored.totalSeconds, preset.minutes * 60 + preset.seconds);
    assert.equal(getCountdownRemaining(restored, 1999), restored.totalSeconds);
    assert.equal(getCountdownRemaining(restored, 2000), restored.totalSeconds - 1);
    assert.equal(getCountdownRemaining(restored, 1e9), 0);
  }
});

test('paused remaining time survives serialization independently of elapsed clock time', () => {
  const data = buildCountdownData(2, 15, { paused: true, pausedRemaining: 87 });
  const restored = parseCountdownContent(serializeCountdownContent(data));
  assert.equal(getCountdownRemaining(restored, Date.now() + 86400000), 87);
  assert.equal(formatCountdownTime(87), '01:27');
  assert.equal(formatCountdownTime(0), '00:00');
  assert.equal(formatCountdownTime(5999), '99:59');
});

test('countdown duration bounds and malformed content recover to usable values', () => {
  assert.equal(buildCountdownData(-5, -10).totalSeconds, 0);
  assert.equal(buildCountdownData(500, 500).totalSeconds, 5999);
  for (const content of ['broken', 'null']) {
    const data = parseCountdownContent(content);
    assert.equal(data.totalSeconds, 300);
    assert.equal(data.minutes, 5);
    assert.equal(data.seconds, 0);
  }
});

test('legacy countdown containing only totalSeconds derives finite duration fields', () => {
  const data = parseCountdownContent(JSON.stringify({ totalSeconds: 135, startTime: 1000 }));
  assert.equal(data.minutes, 2);
  assert.equal(data.seconds, 15);
  assert.equal(getCountdownRemaining(data, 6000), 130);
});
