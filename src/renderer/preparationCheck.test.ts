import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preparationInputKey, runPreparationCheck, type PreparationDependencies } from './preparationCheck';
import { createPreparationMonitor } from './preparationMonitor';
import type { Presentation, Slide } from './types';

const slide = (id: string, properties: Partial<Slide> = {}): Slide =>
  ({ id, type: 'text', content: 'Hello', styles: {}, ...properties }) as Slide;
const deck = (slides: Slide[], id = 'deck'): Presentation => ({ id, name: id, slides });
const deps = (overrides: Partial<PreparationDependencies> = {}): PreparationDependencies => ({
  checkMedia: async (urls) => Object.fromEntries(urls.map((url) => [url, true])),
  fonts: () => ['Arial'],
  loadFont: async () => true,
  measure: () => [],
  yieldToUI: async () => {},
  ...overrides,
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));

test('one report combines missing media, fonts and measured overflow, deduplicating resources and issues', async () => {
  const mediaCalls: string[][] = [],
    fontCalls: string[] = [];
  const results = await runPreparationCheck(
    [
      slide('one', {
        content: 'x'.repeat(900),
        mediaUrl: 'file:///missing.png',
        styles: { fontSize: 48 } as Slide['styles'],
      }),
      slide('two', { content: 'Different', mediaUrl: 'file:///missing.png' }),
    ],
    deps({
      checkMedia: async (urls) => {
        mediaCalls.push(urls);
        return { 'file:///missing.png': false };
      },
      loadFont: async (family) => {
        fontCalls.push(family);
        return false;
      },
      measure: () => [
        { severity: 'warning', message: 'textOverflow' },
        { severity: 'warning', message: 'textOverflow' },
      ],
    }),
    () => false
  );
  assert.deepEqual(mediaCalls, [['file:///missing.png']]);
  assert.deepEqual(fontCalls, ['Arial']);
  assert.equal(results?.length, 2);
  assert.deepEqual(
    results?.[0].issues.map((issue) => issue.message),
    ['inaccessibleMedia', 'fontUnavailable', 'textOverflow']
  );
});

test('heuristic alone remains a warning, even for text longer than 800 characters', async () => {
  const result = await runPreparationCheck([slide('long', { content: 'x'.repeat(900) })], deps(), () => false);
  assert.deepEqual(result?.[0].issues, [{ severity: 'warning', message: 'longTextSmallFont' }]);
});

test('resource verification failures cannot produce all clear; skipped network resources remain warnings', async () => {
  await assert.rejects(
    runPreparationCheck(
      [slide('one', { mediaUrl: 'file:///missing.png' })],
      deps({ checkMedia: async () => undefined }),
      () => false
    )
  );
  await assert.rejects(
    runPreparationCheck(
      [slide('one', { mediaUrl: 'file:///missing.png' })],
      deps({ checkMedia: async () => ({}) }),
      () => false
    )
  );
  const result = await runPreparationCheck(
    [slide('one', { mediaUrl: 'https://example.com/a.png' })],
    deps({ checkMedia: async () => ({}) }),
    () => false
  );
  assert.equal(result?.[0].issues[0].message, 'onlineResource');
});

test('font loading failures are warnings and cancellation drops the report', async () => {
  const result = await runPreparationCheck(
    [slide('one')],
    deps({
      loadFont: async () => {
        throw new Error('offline');
      },
    }),
    () => false
  );
  assert.equal(result?.[0].issues[0].message, 'fontUnavailable');
  assert.equal(await runPreparationCheck([slide('one')], deps(), () => true), undefined);
});

test('live slide and part navigation do not invalidate the report, while edits, reorder and deck replacement do', () => {
  const parts = ['one', 'two'];
  const first = deck([slide('part', { partsMode: true, parts, activePart: 0, content: parts[0] }), slide('other')]);
  const navigation = {
    ...first,
    liveIndex: 1,
    liveSlideId: 'other',
    slides: [{ ...first.slides[0], activePart: 1, content: parts[1] }, first.slides[1]],
  };
  assert.equal(preparationInputKey(first), preparationInputKey(navigation));
  assert.notEqual(preparationInputKey(first), preparationInputKey({ ...first, slides: [...first.slides].reverse() }));
  assert.notEqual(preparationInputKey(first), preparationInputKey(deck(first.slides, 'replacement')));
  assert.notEqual(
    preparationInputKey(first),
    preparationInputKey({ ...first, slides: [slide('part', { partsMode: true, parts: ['edited', 'two'] })] })
  );
});

test('static checks inspect every part independently of which part is live', async () => {
  const first = slide('parts', { partsMode: true, parts: ['short', 'x'.repeat(900)], activePart: 0, content: 'short' });
  const a = await runPreparationCheck([first], deps(), () => false);
  const b = await runPreparationCheck([{ ...first, activePart: 1, content: first.parts![1] }], deps(), () => false);
  assert.deepEqual(a, b);
  assert.equal(a?.[0].issues[0].message, 'longTextSmallFont');
});

test('monitor debounces rapid edits and rejects late results after replacement, failure or stop', async () => {
  const pending: Array<(value: []) => void> = [];
  const reports: Array<{ status: string; results: unknown[] }> = [];
  let calls = 0;
  const monitor = createPreparationMonitor(
    async () => {
      calls++;
      return new Promise<[]>((resolve) => pending.push(resolve));
    },
    (report) => reports.push(report),
    5
  );
  monitor.update(deck([slide('obsolete')]));
  monitor.update(deck([slide('current')]));
  await tick();
  assert.equal(calls, 1);
  monitor.update(deck([slide('replacement')]));
  pending[0]([]);
  await tick();
  assert.equal(calls, 2);
  assert.equal(
    reports.some((report) => report.status === 'complete'),
    false
  );
  pending[1]([]);
  await tick();
  assert.equal(reports.at(-1)?.status, 'complete');
  monitor.update(deck([slide('replacement')]));
  await tick();
  assert.equal(calls, 2);
  monitor.update(deck([slide('replacement')]), true);
  await tick();
  assert.equal(calls, 3);
  monitor.stop();
  pending[2]([]);
  await tick();
  assert.equal(reports.at(-1)?.status, 'checking');
});

test('monitor exposes failure and manual retry can recover to a completed clear report', async () => {
  let failed = true;
  const statuses: string[] = [];
  const monitor = createPreparationMonitor(
    async () => {
      if (failed) throw new Error('IPC unavailable');
      return [];
    },
    (report) => statuses.push(report.status),
    0
  );
  const presentation = deck([slide('one')]);
  monitor.update(presentation);
  await tick();
  assert.equal(statuses.at(-1), 'failed');
  failed = false;
  monitor.update(presentation, true);
  await tick();
  assert.deepEqual(statuses, ['stale', 'checking', 'failed', 'stale', 'checking', 'complete']);
  monitor.stop();
});
