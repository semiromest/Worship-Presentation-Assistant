import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialUpdaterState, updaterReducer } from './useUpdaterStore';

test('update-available → status available, version + notes set', () => {
  const s = updaterReducer(initialUpdaterState, {
    type: 'update-available',
    payload: { version: '1.2.0', releaseNotes: '• Slayt geçişleri düzeltildi' },
  });
  assert.equal(s.status, 'available');
  assert.equal(s.nextVersion, '1.2.0');
  assert.equal(s.releaseNotes, '• Slayt geçişleri düzeltildi');
});

test('download-progress → status downloading, progress fields', () => {
  const s = updaterReducer(initialUpdaterState, {
    type: 'download-progress',
    payload: { percent: 68, transferred: 12_400_000, total: 18_200_000 },
  });
  assert.equal(s.status, 'downloading');
  assert.equal(s.percent, 68);
  assert.equal(s.transferred, 12_400_000);
  assert.equal(s.total, 18_200_000);
});

test('update-downloaded → status downloaded', () => {
  const s = updaterReducer(initialUpdaterState, { type: 'update-downloaded', payload: { version: '1.2.0' } });
  assert.equal(s.status, 'downloaded');
});

test('error → status error with message', () => {
  const s = updaterReducer(initialUpdaterState, { type: 'error', payload: { message: 'Network Error' } });
  assert.equal(s.status, 'error');
  assert.equal(s.errorMessage, 'Network Error');
});

test('update-not-available → status uptodate, version cleared', () => {
  const withUpdate = updaterReducer(initialUpdaterState, { type: 'update-available', payload: { version: '1.2.0' } });
  const s = updaterReducer(withUpdate, { type: 'update-not-available' });
  assert.equal(s.status, 'uptodate');
  assert.equal(s.nextVersion, null);
});

test('bilinmeyen event → state değişmez', () => {
  const s = updaterReducer(initialUpdaterState, { type: 'unknown' as any });
  assert.deepEqual(s, initialUpdaterState);
});