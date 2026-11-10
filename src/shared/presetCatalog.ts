import type { Preset } from './presentation';
export interface PresetChange { upsert?: Preset; removed: string[] }
