import type { CueName, PlayOptions, PlayingSFX, UISFXPlayer } from 'uisfx';

// ─── UI sound effects (uisfx) ────────────────────────────────────────────────
//
// A thin singleton around the uisfx runtime. The app ships exactly one sonic
// personality ("minimal" — dry, precise, almost invisible) and the sounds are
// never modified: we only expose an on/off switch, which is off by default.
// The library synthesizes every sound locally via Web Audio, so nothing is
// fetched from the network and no audio assets are added to the bundle.
//
// uisfx ships ESM-only (`type: module`, no `require` export). The static
// import used to break `tsx --test` runs (which load renderer modules through
// the CJS resolver), so the runtime is loaded lazily via dynamic import.
// Vite/browser builds are unaffected — the chunk is bundled normally.

const STORAGE_KEY = 'uiSfxEnabled';
const PACK = 'minimal' as const;

// Cues actually used by the app. Preloaded once after the first trusted
// interaction so the first real sound plays instantly instead of being
// synthesized on demand.
const PRELOAD_CUES: CueName[] = [
  'select',
  'success',
  'complete',
  'delete',
  'undo',
  'redo',
  'reorder',
  'open',
  'start',
  'stop',
  'lock',
  'unlock',
  'toggle-on',
  'toggle-off',
  'connect',
  'disconnect',
  'notification',
  'error',
  'processing',
  'loading',
];

let player: UISFXPlayer | null = null;
let loadPromise: Promise<UISFXPlayer | null> | null = null;
let initialized = false;
let unlocked = false;

function readStoredEnabled(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? false : v === '1';
  } catch {
    return false;
  }
}

function writeStoredEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Storage may be unavailable (private mode / quota) — the in-memory
    // player state still applies for this session.
  }
}

/** Lazily loads uisfx (ESM-only) and creates the singleton player. */
function loadPlayer(): Promise<UISFXPlayer | null> {
  if (player) return Promise.resolve(player);
  if (loadPromise) return loadPromise;
  if (typeof window === 'undefined') return Promise.resolve(null);

  loadPromise = import('uisfx')
    .then(({ createUISFX }) => {
      player = createUISFX({
        pack: PACK,
        volume: 1,
        enabled: readStoredEnabled(),
        // No `preferences` adapter on purpose: we persist only the on/off flag
        // ourselves under STORAGE_KEY, so the library never writes localStorage.
      });
      return player;
    })
    .catch(() => null);
  return loadPromise;
}

function bindUnlock(): void {
  if (unlocked || typeof window === 'undefined') return;

  const attemptUnlock = () => {
    if (unlocked) return;
    unlocked = true;
    // The first trusted pointer/keyboard action unlocks the AudioContext and
    // pre-renders the cues the app uses (cooperative: yields between cues).
    void loadPlayer()
      .then((p) => {
        if (!p) return;
        return p
          .unlock()
          .then((ok) => {
            if (ok) void p.preload(PRELOAD_CUES).catch(() => {});
          })
          .catch(() => {});
      })
      .catch(() => {});
  };

  window.addEventListener('pointerdown', attemptUnlock, { once: true, capture: true });
  window.addEventListener('keydown', attemptUnlock, { once: true, capture: true });
}

/**
 * Initializes the sound system. Call once from the main window on mount.
 * No AudioContext is created until the first interaction, so this is cheap.
 */
export function initSfx(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  void loadPlayer();
  bindUnlock();
}

/**
 * Plays a one-shot cue (or starts a loop cue). Returns null when the sounds
 * are disabled or the player is not initialized (e.g. the projector window).
 * Loop cues return a handle; stop it with `stopSfx` when the state resolves.
 */
export function playSfx(cue: CueName, options?: PlayOptions): PlayingSFX | null {
  if (!initialized) return null;
  if (!player || !player.isEnabled()) return null;
  return player.play(cue, options);
}

/** Stops a loop handle returned by `playSfx` (no-op for null/one-shots). */
export function stopSfx(handle: PlayingSFX | null | undefined): void {
  handle?.stop();
}

/** Enables/disables all UI sounds and persists the choice. */
export function setSfxEnabled(enabled: boolean): void {
  writeStoredEnabled(enabled);
  if (player) {
    player.setEnabled(enabled);
  } else {
    // Player not created yet — kick the lazy load; it reads storage, so the
    // freshly persisted flag is picked up on creation.
    void loadPlayer();
  }
}

/** Current on/off state (works before `initSfx` by reading storage). */
export function isSfxEnabled(): boolean {
  return player ? player.isEnabled() : readStoredEnabled();
}
