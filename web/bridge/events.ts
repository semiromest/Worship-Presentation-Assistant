// Stand-in for Electron's main → renderer IPC events (`ipcRenderer.on`).
const listeners = new Map<string, Set<(payload: any) => void>>();

export function emit(channel: string, payload?: unknown): void {
  for (const listener of listeners.get(channel) ?? []) {
    try { listener(payload); } catch (error) { console.error(`[web bridge] ${channel} listener failed`, error); }
  }
}

export function subscribe<T = any>(channel: string) {
  return (callback: (payload: T) => void): (() => void) => {
    let set = listeners.get(channel);
    if (!set) listeners.set(channel, set = new Set());
    set.add(callback);
    return () => { set!.delete(callback); };
  };
}
