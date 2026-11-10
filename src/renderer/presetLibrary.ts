import type { Preset, Presentation } from './types';
import type { PresetChange } from '../shared/presetCatalog';
import { useStore } from './state/useStore';
let revision = 0;
function apply(change: PresetChange): Preset[] {
  revision++;
  const removed = new Set(change.removed);
  if (change.upsert) removed.add(change.upsert.name);
  const retained = new Set([change.upsert?.name, useStore.getState().selectedPresetName]);
  const next = useStore.getState().presets.filter(preset => !removed.has(preset.name)).map(preset =>
    preset.summary?.resolved && !retained.has(preset.name)
      ? { ...preset, presentation: { id: preset.presentation.id, name: preset.presentation.name, slides: [] }, summary: { ...preset.summary, resolved: false } }
      : preset);
  if (change.upsert) next.push(change.upsert);
  next.sort((a, b) => b.createdAt - a.createdAt);
  useStore.getState().setPresets(next); return next;
}
function legacy(next: Preset[] | undefined): Preset[] {
  if (!Array.isArray(next)) throw Error('Preset operation unavailable');
  revision++; useStore.getState().setPresets(next); return next;
}
export async function loadPresetList(retention?: number): Promise<Preset[]> {
  const started = revision;
  const list = await (window.electronAPI.listPresetEntries?.(retention) ?? window.electronAPI.loadPresets?.(retention));
  if (started !== revision) return useStore.getState().presets;
  if (!Array.isArray(list)) throw Error('Preset library unavailable');
  useStore.getState().setPresets(list); return list;
}
export async function saveLibraryPreset(preset: { name: string; presentation: Presentation; retentionMs?: number }): Promise<Preset[]> {
  if (!window.electronAPI.savePresetEntry) return legacy(await window.electronAPI.savePreset?.(preset));
  const change = await window.electronAPI.savePresetEntry(preset);
  if (change.upsert?.summary) change.upsert = { ...change.upsert, presentation: preset.presentation, summary: { ...change.upsert.summary, resolved: true } };
  return apply(change);
}
export async function deleteLibraryPreset(name: string, retention?: number): Promise<Preset[]> {
  return window.electronAPI.deletePresetEntry ? apply(await window.electronAPI.deletePresetEntry(name, retention))
    : legacy(await window.electronAPI.deletePreset?.(name, retention));
}
export async function renameLibraryPreset(oldName: string, name: string, retention?: number): Promise<Preset[]> {
  if (!window.electronAPI.renamePresetEntry) return legacy(await window.electronAPI.renamePreset?.(oldName, name, retention));
  const original = useStore.getState().presets.find(p => p.name === oldName);
  const change = await window.electronAPI.renamePresetEntry(oldName, name, retention);
  if (original && (!original.summary || original.summary.resolved) && change.upsert?.summary) change.upsert = {
    ...change.upsert, presentation: original.presentation, summary: { ...change.upsert.summary, resolved: true },
  };
  return apply(change);
}
export async function resolveLibraryPreset(preset: Preset): Promise<Preset> {
  if (!preset.summary || preset.summary.resolved) return preset;
  const full = await window.electronAPI.getPresetEntry(preset.name);
  if (!full) throw Error('Preset no longer exists'); return full;
}
