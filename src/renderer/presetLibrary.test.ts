import { test } from 'node:test';
import assert from 'node:assert/strict';
const storage = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
Object.assign(globalThis, { window: { location: { search: '' }, localStorage: globalThis.localStorage } });
Object.assign(globalThis, { document: { documentElement: { lang: 'en' }, getElementById: () => ({}), createElement: () => ({}), head: { appendChild: () => {} } } });
test('late list response cannot erase saved entries; repeated saves retain bounded full payloads', async () => {
  const { useStore } = await import('./state/useStore');
  const { loadPresetList, saveLibraryPreset } = await import('./presetLibrary');
  let release!: (value: unknown[]) => void;
  Object.assign(window, { electronAPI: {
    listPresetEntries: () => new Promise(resolve => { release = resolve; }),
    savePresetEntry: async (item: any) => ({ removed: [], upsert: { name: item.name, createdAt: Date.now(),
      presentation: { id: item.presentation.id, name: item.name, slides: [] }, summary: { version: item.name, slideCount: item.presentation.slides.length } } }),
  } });
  useStore.getState().setPresets([]);
  const waiting = loadPresetList();
  for (let i = 0; i < 20; i++) await saveLibraryPreset({ name: 'Saved '+i, presentation: { id: String(i), name: 'Saved '+i, slides: [{ id: 's', type: 'text', content: 'Full body' }] } });
  release([]); assert.equal((await waiting).length, 20);
  assert.equal(useStore.getState().presets.length, 20);
  assert.equal(useStore.getState().presets.filter(p => p.presentation.slides.length > 0).length, 1);
});
