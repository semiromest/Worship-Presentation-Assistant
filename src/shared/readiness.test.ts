import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzePresentationReadiness, analyzeSlideReadiness } from './readiness';

test('flags empty text slides as an error', () => {
  const issues = analyzeSlideReadiness({ id: '1', type: 'text', content: '' });
  assert.equal(issues.some((i) => i.message === 'emptyText'), true);
});

test('flags long text with a large font as a readability warning', () => {
  const longText = 'a'.repeat(300);
  const issues = analyzeSlideReadiness({ id: '1', type: 'text', content: longText, styles: { fontSize: 48 } });
  assert.equal(issues.some((i) => i.message === 'longTextSmallFont'), true);
});

test('does not flag short text', () => {
  const issues = analyzeSlideReadiness({ id: '1', type: 'text', content: 'Hello world', styles: { fontSize: 48 } });
  assert.equal(issues.length, 0);
});

test('flags image/video slides missing media', () => {
  assert.equal(
    analyzeSlideReadiness({ id: '1', type: 'image', content: '' }).some((i) => i.message === 'missingImage'),
    true,
  );
  assert.equal(
    analyzeSlideReadiness({ id: '1', type: 'video', content: '' }).some((i) => i.message === 'missingVideo'),
    true,
  );
});

test('flags empty loop slides', () => {
  const issues = analyzeSlideReadiness({ id: '1', type: 'loop', content: '', loopItems: [] });
  assert.equal(issues.some((i) => i.message === 'emptyLoop'), true);
});

test('analyzePresentationReadiness only returns slides with issues', () => {
  const slides = [
    { id: '1', type: 'text', content: 'fine' },
    { id: '2', type: 'text', content: '' },
  ];
  const results = analyzePresentationReadiness(slides);
  assert.equal(results.length, 1);
  assert.equal(results[0].slideId, '2');
  assert.equal(results[0].index, 1);
});
