import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseDefaultOutputDisplay,
  createOutputAssignment,
  effectiveOutputSlideIndex,
  type DisplayInfo,
} from './displays';

function display(id: string, isPrimary: boolean, x: number, y = 0): DisplayInfo {
  return {
    id,
    label: isPrimary ? 'Primary' : id,
    isPrimary,
    bounds: { x, y, width: 1920, height: 1080 },
    workArea: { x, y, width: 1920, height: 1040 },
    scaleFactor: 1,
  };
}

test('chooses a secondary display even when it is left of primary', () => {
  const primary = display('primary', true, 0);
  const left = display('left', false, -1920);
  const right = display('right', false, 1920);

  assert.equal(chooseDefaultOutputDisplay([primary, right, left])?.id, 'left');
});

test('falls back to primary when no secondary display exists', () => {
  assert.equal(chooseDefaultOutputDisplay([display('primary', true, 0)])?.id, 'primary');
});

test('follow outputs resolve the global live slide', () => {
  const assignment = createOutputAssignment(1);
  assert.equal(effectiveOutputSlideIndex(assignment, 4, 8), 4);
});

test('manual outputs keep their own slide when the global live slide changes', () => {
  const assignment = { ...createOutputAssignment(1), mode: 'manual' as const, slideIndex: 2 };
  assert.equal(effectiveOutputSlideIndex(assignment, 7, 8), 2);
  assert.equal(effectiveOutputSlideIndex({ ...assignment, slideIndex: 99 }, 7, 8), 7);
});
