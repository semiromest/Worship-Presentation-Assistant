import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DESKTOP, GLOBAL_SHORTCUTS, normalizeDesktopPreferences, safePathLabel } from './desktop';
test('fixed Ctrl+Alt bindings replace legacy/custom maps and preserve preferences', () => {
  assert.deepEqual(GLOBAL_SHORTCUTS, { previous: 'Control+Alt+Left', next: 'Control+Alt+Right', blackout: 'Control+Alt+B' });
  const migrated = normalizeDesktopPreferences({ ...DEFAULT_DESKTOP, shortcutsEnabled: true, notifications: true, spellcheckLanguage: 'tr', shortcuts: { previous: 'CommandOrControl+Alt+Shift+Left', next: 'Control+Shift+F10', blackout: 'B' } });
  assert.deepEqual(migrated.shortcuts, GLOBAL_SHORTCUTS);
  assert.equal(migrated.shortcutsEnabled, true); assert.equal(migrated.notifications, true); assert.equal(migrated.spellcheckLanguage, 'tr');
  migrated.shortcuts.blackout = 'B'; assert.equal(GLOBAL_SHORTCUTS.blackout, 'Control+Alt+B');
  assert.throws(() => normalizeDesktopPreferences({ ...DEFAULT_DESKTOP, shortcutsEnabled: 'yes' }), /Invalid/);
});
test('display-only paths escape control/bidi characters and preserve literal HTML', () => {
  assert.equal(safePathLabel('a\u202eb\n<script>'), 'a\\u202eb\\u000a<script>');
  assert.equal(safePathLabel('\u0085\u200e\u200f\u061c\u{13430}🙂'), '\\u0085\\u200e\\u200f\\u061c\\u{13430}🙂');
});
