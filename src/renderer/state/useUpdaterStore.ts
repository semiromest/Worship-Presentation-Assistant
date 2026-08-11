import { create } from 'zustand';

export type UpdaterStatus = 'idle' | 'checking' | 'uptodate' | 'available' | 'downloading' | 'downloaded' | 'error';

export interface UpdaterState {
  status: UpdaterStatus;
  currentVersion: string;
  updaterActive: boolean;
  nextVersion: string | null;
  percent: number;
  transferred: number;
  total: number;
  errorMessage: string | null;
}

export const initialUpdaterState: UpdaterState = {
  status: 'idle',
  currentVersion: '',
  updaterActive: false,
  nextVersion: null,
  percent: 0,
  transferred: 0,
  total: 0,
  errorMessage: null,
};

export function updaterReducer(state: UpdaterState, event: { type: string; payload?: any }): UpdaterState {
  switch (event.type) {
    case 'checking-for-update':
      return { ...state, status: 'checking', errorMessage: null };
    case 'update-not-available':
      return { ...state, status: 'uptodate', nextVersion: null };
    case 'update-available':
      return {
        ...state,
        status: 'available',
        nextVersion: event.payload?.version ?? null,
      };
    case 'download-progress':
      return {
        ...state,
        status: 'downloading',
        percent: event.payload?.percent ?? 0,
        transferred: event.payload?.transferred ?? 0,
        total: event.payload?.total ?? 0,
      };
    case 'update-downloaded':
      return { ...state, status: 'downloaded' };
    case 'update-cancelled':
      return { ...state, status: 'available' };
    case 'error':
      return { ...state, status: 'error', errorMessage: event.payload?.message ?? 'Unknown error' };
    default:
      return state;
  }
}

export interface UpdaterActions {
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => void;
}

const api = () => window.electronAPI;

let initialized = false;

/** Binds preload events to the store; called once on App mount. */
export function initUpdaterSync(): void {
  if (initialized) return;
  initialized = true;
  if (!api()?.onUpdaterEvent) return;

  api().onUpdaterEvent((event) => {
    useUpdaterStore.setState((s) => updaterReducer(s, event));
  });

  api()
    .getUpdaterInfo()
    .then((info) => useUpdaterStore.setState({ currentVersion: info.version, updaterActive: info.updaterActive }))
    .catch(() => { /* electron API unavailable (e.g., web preview) */ });
}

export async function checkUpdates(): Promise<void> {
  if (!api()?.checkForUpdates) return;
  const res = await api().checkForUpdates();
  if (!res.ok && res.error) {
    useUpdaterStore.setState((s) => updaterReducer(s, { type: 'error', payload: { message: res.error } }));
  }
}

export async function downloadUpdate(): Promise<void> {
  if (!api()?.downloadUpdate) return;
  const res = await api().downloadUpdate();
  if (!res.ok && res.error) {
    useUpdaterStore.setState((s) => updaterReducer(s, { type: 'error', payload: { message: res.error } }));
  }
}

export function installUpdate(): void {
  api()?.installUpdate?.();
}

export const useUpdaterStore = create<UpdaterState & UpdaterActions>(() => ({
  ...initialUpdaterState,
  check: checkUpdates,
  download: downloadUpdate,
  install: installUpdate,
}));