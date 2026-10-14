# App discovery tour

The implementation has three independently removable layers:

1. Settings and keyboard-help entry points open a ten-section map with explicit page-introduction buttons.
2. A lazy `react-joyride@3.2.0` adapter presents five steps. The controller owns application policy, cancellation and restoration; Joyride owns step progression, positioning and tooltip focus.
3. A read-only main-process profile classification enables a single invitation for a new profile. Unknown state suppresses the invitation.

## Event boundary

The spotlight makes only `[data-app-shell]` inert. Tour and Base UI portals stay outside it. The early window capture boundary owns Escape and rejects off-surface events. React portal boundaries stop on-surface events from reaching application bubble shortcuts. Native tour button activation is preserved.

Application shortcuts must not register window capture listeners. Existing capture listeners in the editor check `isHelpActive`; new shortcuts belong to the regular application event path. `inert` does not stop global JavaScript listeners or IPC. Remote commands interrupt the tour before executing normally.

Every exit uses `finishTour`. No presentation, undo or live-output snapshot is restored. An external tab change takes precedence over the tour's original tab. Async work is scoped to an abortable session.

## Checks

`npm run test:tour` covers pure policy, storage parsing, profile evidence, IPC sender identity and five-language content.

`npx vite build` followed by `npm run test:tour:e2e` runs real Electron with a development StrictMode renderer and isolated temporary userData. The flows cover map/focus, spotlight/keyboard/inert/restart, output windows, invitation persistence, all ten mini introductions, page-suggestion opt-out, migration, and unsafe/unknown visits. No jsdom layout assertions are used. CI runs one worker with no retries.

Typecheck passed before implementation. Full repository lint already failed with 103 findings (78 errors, 25 warnings), including ignored performance snapshots. This feature does not broaden scope to fix unrelated lint findings.

## Manual release checklist

- Windows display scaling: 100%, 125%, 150%, each at minimum 800×600 and after resize. Browser zoom is not a DPI substitute.
- Five languages and reduced-motion preference; STT panel open and constrained workspace.
- Installed NSIS userData path and upgrade from a previously used release.
- Separate portable test artifact: record its actual userData path; do not assume it differs from installed mode. Portable distribution is not introduced by this feature.
- Cancel while loading, external modal interruption and a phone command during the tour.

The automated profile tests exercise clean and legacy evidence plus relaunch; actual installed/portable migration remains a release checklist, not a claimed automated result.

## Verified locally

The Joyride spike succeeded in Electron 43.4.0: native button activation, inert target measurement, forward/back navigation, StrictMode restart, Escape, pending-target cancellation, modal interruption, and remote output opening. Visual inspection identified and fixed the sidebar tooltip falling below the viewport. The adapter now uses fixed viewport positioning and centers large-workspace cards. Tests assert card bounds and capture 800×600 screenshots.

New tour modules pass targeted ESLint. Main/profile startup and unauthorized output-window IPC have been exercised with real Electron. The installed/portable and physical Windows DPI checklist above has not been executed locally.

## Phase 1 expansion

All ten sidebar pages have one short read-only introduction. Settings and map cards provide manual entries. The existing five-step tour remains separate. Finishing a mini introduction stays on its explicitly chosen page and records its own completion; it does not complete the five-step tour.

Schema 2 preserves old welcome/completion fields while migrating v1 page suggestions OFF. Only a demonstrably new profile starts with page eligibility. Eligibility survives restarts, opt-out is global and durable, and an unknown current profile suppresses automatic suggestions even if a stored record was previously eligible. Only user sidebar/keyboard visits create suggestions; hidden preload and tour navigation do not. Unsafe visits do not schedule delayed prompts.

Editor introductions remain on the editor and do not save pending drafts. Active pointer/typing gestures and actually expanded popovers block an intro; closed menu wrappers do not. New code passes targeted lint via npm run lint:tour. The AST capture-rule test guards reviewed window keyboard capture registrations including literal, object, computed-key, alias and dynamic option forms.

Windows release CI now runs the real packaged executable smoke after packaging, without the development test seam. NSIS installation/upgrade and physical Windows DPI checks remain manual. Output-free practice infrastructure, the Windows acceptance gate, and the pending Phase 3 remote policy are documented in practice-isolation-comparison.md; practice uses a single guided sequence covering Presentations and Slides; see guided-learning.md for the current scope and practice-tasks.md for historical task delivery. Packaged smoke is advisory for the first three releases and remains advisory until explicit promotion approval.
