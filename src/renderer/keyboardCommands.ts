import { tabForShortcut } from './navigation';

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}
export interface KeyContext {
  activeTab: string;
  helpOpen: boolean;
  outputOpen: boolean;
  hasSelection: boolean;
  selectedIndex: number;
}
export type KeyboardCommand =
  | { type: 'tab'; destination: NonNullable<ReturnType<typeof tabForShortcut>> }
  | { type: 'move'; direction: -1 | 1 }
  | { type: 'part'; direction: -1 | 1 }
  | { type: 'navigate'; direction: 'next' | 'previous' | 'first' | 'last' }
  | {
      type: 'undo' | 'redo' | 'help' | 'duplicate' | 'delete' | 'mute' | 'live' | 'close-output' | 'blackout' | 'clear';
    };

const navigation = new Map<string, 'next' | 'previous' | 'first' | 'last'>([
  ...['ArrowRight', ' ', 'PageDown', 'j', 'J'].map((key) => [key, 'next'] as const),
  ...['ArrowLeft', 'PageUp', 'k', 'K'].map((key) => [key, 'previous'] as const),
  ['Home', 'first'],
  ['End', 'last'],
]);

function editorOwnsKey(e: KeyInput): boolean {
  return (
    navigation.has(e.key) ||
    ['Enter', 'Escape', 'Delete'].includes(e.key) ||
    e.key.startsWith('Arrow') ||
    ((e.ctrlKey || e.metaKey) && ['z', 'y', 'd', 'a'].includes(e.key.toLowerCase()))
  );
}

function editingCommand(e: KeyInput, state: KeyContext): KeyboardCommand | null {
  if (e.altKey && state.activeTab === 'slides') {
    if (e.key === 'ArrowUp') return { type: 'move', direction: -1 };
    if (e.key === 'ArrowDown') return { type: 'move', direction: 1 };
  }
  if (state.helpOpen || state.activeTab !== 'slides') return null;
  if (e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'd') return { type: 'duplicate' };
  if (e.key === 'Delete' && state.hasSelection) return { type: 'delete' };
  return null;
}

/** Pure routing; dialogs and editable elements are filtered by the DOM adapter. */
export function resolveKeyboardCommand(e: KeyInput, state: KeyContext): KeyboardCommand | null {
  if (state.activeTab === 'editor' && editorOwnsKey(e)) return null;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) return { type: 'undo' };
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) return { type: 'redo' };
  if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey) return { type: 'help' };
  const destination = tabForShortcut(e.key);
  if (e.altKey && !e.ctrlKey && !e.metaKey && destination) return { type: 'tab', destination };
  const editing = editingCommand(e, state);
  if (editing) return editing;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    if (state.activeTab !== 'slides' || state.helpOpen || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
    return { type: 'part', direction: e.key === 'ArrowDown' ? 1 : -1 };
  }
  if (e.key.toLowerCase() === 'm' && !state.helpOpen) return { type: 'mute' };
  const direction = navigation.get(e.key);
  if (direction) return { type: 'navigate', direction };
  if (e.key === 'Enter' && state.selectedIndex >= 0) return { type: 'live' };
  if (e.key === 'Escape' && state.outputOpen) return { type: 'close-output' };
  if (e.key.toLowerCase() === 'b' && state.outputOpen) return { type: 'blackout' };
  if (e.key === 'Escape' && !state.helpOpen) return { type: 'clear' };
  return null;
}
