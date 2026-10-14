import { guideSteps, practiceExercises } from '../../../shared/practice';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseTourState, endTourState } from './tourStorage';
import { tourBlockReason, type TourConditions } from './tourPolicy';
import { TOUR_MAP, TOUR_STEPS } from './tourDefinition';

test('invitation is opt-in only for a demonstrably new profile', () => {
  assert.equal(parseTourState(null, 'new').welcomeSeen, false);
  for (const kind of ['existing', 'unknown'] as const) assert.equal(parseTourState(null, kind).welcomeSeen, true);
  for (const raw of ['{broken', '{}', 'null', '{"schemaVersion":2}']) assert.equal(parseTourState(raw, 'new').welcomeSeen, true);
  const migrated = parseTourState('{"schemaVersion":1,"welcomeSeen":true,"status":"completed"}', 'new');
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.status, 'completed');
  assert.equal(migrated.pageSuggestions.enabled, false);
});
test('every unsafe condition blocks spotlight; output has a useful reason', () => {
  const safe: TourConditions = { ready: true, output: false, session: false, editor: false, modal: false, interaction: false };
  assert.equal(tourBlockReason(safe), null);
  for (const key of ['output', 'session', 'editor', 'modal', 'interaction'] as const) assert.notEqual(tourBlockReason({ ...safe, [key]: true }), null);
  assert.equal(tourBlockReason({ ...safe, ready: false }), 'not-ready');
  assert.equal(tourBlockReason({ ...safe, ready: false, output: true }), 'output-active');
});
test('dismissal prevents reinvitation and replay cannot erase completion', () => {
  const fresh = parseTourState(null, 'new');
  assert.deepEqual(endTourState(fresh, 'dismissed'), { ...fresh, welcomeSeen: true, status: 'dismissed' });
  const completed = endTourState(fresh, 'completed');
  assert.deepEqual(endTourState(completed, 'dismissed'), completed);
});
test('five unique steps and map labels resolve in all five languages', () => {
  assert.equal(new Set(TOUR_STEPS.map(s => s.id)).size, 5);
  assert.equal(new Set(TOUR_MAP.map(s => s.id)).size, 10);
  for (const lang of ['tr', 'en', 'de', 'es', 'ko']) {
    const locale = JSON.parse(fs.readFileSync(path.resolve(`src/renderer/locales/${lang}/translation.json`), 'utf8'));
    const resolve = (key: string) => key.split('.').reduce((node, part) => node?.[part], locale);
    for (const step of TOUR_STEPS) for (const field of ['title', 'body']) assert.equal(typeof resolve(`tour.steps.${step.id}.${field}`), 'string');
    for (const exercise of practiceExercises) for (const field of ['title', 'body']) assert.equal(typeof resolve('practice.exercise.' + exercise + '.' + field), 'string');
    for (const step of guideSteps) for (const field of ['title','body']) assert.equal(typeof resolve(`guide.steps.${step}.${field}`), 'string');
    for (const key of ['title','description','begin','resume','next','exit','waiting','unavailable','retry','skip','advanced','error','finished','finishedSkipped']) assert.equal(typeof resolve(`guide.${key}`), 'string');
    for (const item of TOUR_MAP) {
      assert.equal(typeof resolve(`nav.${item.id}`), 'string');
      assert.equal(typeof resolve(item.description), 'string');
      assert.equal(typeof resolve('tour.pages.' + item.id), 'string');
    }
  }
});

test('new-profile page eligibility persists and opt-out remains separate from completion', () => {
  const fresh = parseTourState(null, 'new');
  assert.equal(fresh.pageSuggestions.enabled, true);
  const reopened = parseTourState(JSON.stringify(fresh), 'existing');
  assert.equal(reopened.pageSuggestions.eligible, true);
  const optedOut = { ...reopened, pageSuggestions: { eligible: true, enabled: false } };
  assert.equal(parseTourState(JSON.stringify(optedOut), 'new').pageSuggestions.enabled, false);
  for (const kind of ['existing', 'unknown'] as const) assert.equal(parseTourState(null, kind).pageSuggestions.enabled, false);
});
