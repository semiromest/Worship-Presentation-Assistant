// Keep the renderer's naming helpers while disabling the automatic-save effect.
export * from '../src/renderer/hooks/useLiveSave?browser-original';
export function useLiveSave() { return null; }
