export type DesktopCommand = 'previous' | 'next' | 'blackout';
export const GLOBAL_SHORTCUTS = Object.freeze({
  previous: 'Control+Alt+Left',
  next: 'Control+Alt+Right',
  blackout: 'Control+Alt+B',
} satisfies Record<DesktopCommand, string>);
export const SPELLCHECK_LANGUAGES = ['auto', 'tr', 'en-US', 'de', 'es', 'ko'] as const;

export interface DesktopPreferences {
  shortcutsEnabled: boolean;
  shortcuts: Record<DesktopCommand, string>;
  spellcheck: boolean;
  spellcheckLanguage: typeof SPELLCHECK_LANGUAGES[number];
  notifications: boolean;
}

export interface OpenDocumentRequest { id: string; label: string }

export interface DesktopStatus {
  outputs: { path: string; label: string }[];
  preferences: DesktopPreferences;
  registered: Record<DesktopCommand, boolean>;
  services: Record<string, { state: 'unknown' | 'working' | 'offline' | 'error'; lastSuccess?: number }>;
}

export const DEFAULT_DESKTOP: DesktopPreferences = {
  shortcutsEnabled: false,
  shortcuts: { ...GLOBAL_SHORTCUTS },
  spellcheck: true,
  spellcheckLanguage: 'auto',
  notifications: false,
};

const COMMANDS: readonly DesktopCommand[] = ['previous', 'next', 'blackout'];

export function validAccelerator(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(value);
}

/** Legacy/custom mappings never override the fixed bindings, including via IPC. */
export function normalizeDesktopPreferences(input: unknown): DesktopPreferences {
  if (!input || typeof input !== 'object') throw new Error('Invalid desktop preferences');
  const p = input as DesktopPreferences & { shortcuts?: Partial<Record<DesktopCommand, string>> };

  if (
    typeof p.shortcutsEnabled !== 'boolean' ||
    typeof p.spellcheck !== 'boolean' ||
    typeof p.notifications !== 'boolean' ||
    !p.shortcuts ||
    typeof p.shortcuts !== 'object' ||
    !COMMANDS.every(name => validAccelerator(p.shortcuts?.[name])) ||
    new Set(COMMANDS.map(name => p.shortcuts![name].toLowerCase())).size !== COMMANDS.length
  ) {
    throw new Error('Invalid desktop preferences');
  }

  const spellcheckLanguage = p.spellcheckLanguage ?? 'auto';
  if (!SPELLCHECK_LANGUAGES.includes(spellcheckLanguage)) throw new Error('Invalid spelling language');

  return {
    shortcutsEnabled: p.shortcutsEnabled,
    shortcuts: { ...GLOBAL_SHORTCUTS },
    spellcheck: p.spellcheck,
    spellcheckLanguage,
    notifications: p.notifications,
  };
}

export function safePathLabel(value: string): string {
  return [...value].map(character => {
    if (!/[\p{Cc}\p{Cf}]/u.test(character)) return character;
    const point = character.codePointAt(0)!;
    return point <= 0xffff ? `\\u${point.toString(16).padStart(4, '0')}` : `\\u{${point.toString(16)}}`;
  }).join('');
}
