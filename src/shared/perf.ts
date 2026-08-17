/**
 * Shared performance instrumentation kit (main / preload / renderer).
 *
 * Phase 0 goal: replace estimates with measurements. All instrumentation is
 * opt-in — default ON in development, OFF in packaged builds. It must stay
 * dependency-free (no electron / dom imports) so every process can use it.
 */

export interface PerfSample {
  /** performance.now() / Date.now() timestamp of the sample. */
  t: number;
  source: 'main' | 'preload' | 'renderer';
  /** Coarse category: ipc, ws, fs, stringify, react-commit, longtask, event-loop, store-set, thumbnail, bench */
  kind: string;
  /** Channel / operation / component id. */
  label: string;
  ms: number;
  /** Estimated payload bytes (0 when not applicable). */
  bytes: number;
}

const MAX_SAMPLES = 10_000;

/**
 * Ring buffer of perf samples with on-the-fly aggregation. Safe to call from
 * hot paths — push is O(1), aggregation only happens on snapshot().
 */
export class PerfBuffer {
  readonly source: PerfSample['source'];
  private samples: PerfSample[] = [];
  enabled = true;

  constructor(source: PerfSample['source']) {
    this.source = source;
  }

  push(s: Omit<PerfSample, 'source'>): void {
    if (!this.enabled) return;
    if (this.samples.length >= MAX_SAMPLES) {
      // Drop oldest half so snapshots stay recent.
      this.samples.splice(0, Math.floor(MAX_SAMPLES / 2));
    }
    this.samples.push({ source: this.source, ...s });
  }

  reset(): void {
    this.samples = [];
  }

  get size(): number {
    return this.samples.length;
  }

  snapshot(): PerfSnapshot {
    type RawAgg = Omit<Aggregated, 'avgMs'>;
    const byKey = new Map<string, RawAgg>();
    for (const s of this.samples) {
      const key = `${s.source}|${s.kind}|${s.label}`;
      let a = byKey.get(key);
      if (!a) {
        a = { source: s.source, kind: s.kind, label: s.label, count: 0, totalMs: 0, maxMs: 0, totalBytes: 0, maxBytes: 0 };
        byKey.set(key, a);
      }
      a.count++;
      a.totalMs += s.ms;
      if (s.ms > a.maxMs) a.maxMs = s.ms;
      a.totalBytes += s.bytes;
      if (s.bytes > a.maxBytes) a.maxBytes = s.bytes;
    }
    const aggregates = Array.from(byKey.values())
      .map((a) => ({ ...a, avgMs: a.totalMs / Math.max(1, a.count) }))
      .sort((x, y) => y.totalMs - x.totalMs);
    return { aggregates, sampleCount: this.samples.length, collectedAt: Date.now() };
  }
}

export interface Aggregated {
  source: PerfSample['source'];
  kind: string;
  label: string;
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
  totalBytes: number;
  maxBytes: number;
}

export interface PerfSnapshot {
  aggregates: Aggregated[];
  sampleCount: number;
  collectedAt: number;
}

export interface PerfSnapshotResponse {
  main: PerfSnapshot | null;
  renderer: PerfSnapshot | null;
  meta: { startedAt: number; eventLoopMaxLagMs: number; eventLoopLagSamples: number };
}

/** Quick default: enabled in development, force on/off with WPA_PERF env. */
export function defaultPerfEnabled(): boolean {
  try {
    if (typeof process !== 'undefined' && process.env) {
      if (process.env.WPA_PERF === '1') return true;
      if (process.env.WPA_PERF === '0') return false;
    }
  } catch {
    /* sandboxed preload may hide process.env */
  }
  try {
    // Vite statically replaces import.meta.env.DEV in all three builds.
    if (typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Cheap payload-size estimate (UTF-16 bytes, JSON-approximation) that does NOT
 * allocate a serialized copy — usable on multi-MB objects in dev. Mirrors the
 * cost of structured-clone transport closely enough for budgeting.
 */
export function estimatePayloadBytes(value: unknown): number {
  const seen = new WeakSet<object>();
  let bytes = 0;
  const walk = (v: unknown): void => {
    if (v === null || v === undefined) return;
    const t = typeof v;
    if (t === 'string') {
      bytes += (v as string).length * 2;
      return;
    }
    if (t === 'number') {
      bytes += 8;
      return;
    }
    if (t === 'boolean') {
      bytes += 4;
      return;
    }
    if (t === 'bigint' || t === 'symbol') {
      bytes += 16;
      return;
    }
    if (t === 'function') return;
    if (typeof (v as { byteLength?: number }).byteLength === 'number') {
      bytes += (v as { byteLength: number }).byteLength;
      return;
    }
    if (seen.has(v as object)) return;
    seen.add(v as object);
    if (Array.isArray(v)) {
      for (const item of v as unknown[]) walk(item);
      return;
    }
    const obj = v as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      bytes += k.length * 2 + 2; // key + ":" separator
      walk(obj[k]);
    }
  };
  walk(value);
  return bytes;
}

/** Synchronous timing helper; pushes to the buffer when enabled. */
export function measureSync<T>(
  buf: PerfBuffer,
  kind: string,
  label: string,
  fn: () => T,
  bytes?: () => number,
): T {
  if (!buf.enabled) return fn();
  const t0 = Date.now();
  const result = fn();
  buf.push({ kind, label, ms: Date.now() - t0, bytes: bytes ? bytes() : 0, t: Date.now() });
  return result;
}

/** Async timing helper; pushes to the buffer when enabled. */
export async function measureAsync<T>(
  buf: PerfBuffer,
  kind: string,
  label: string,
  fn: () => Promise<T>,
  bytes?: () => number,
): Promise<T> {
  if (!buf.enabled) return fn();
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    buf.push({ kind, label, ms: Date.now() - t0, bytes: bytes ? bytes() : 0, t: Date.now() });
  }
}
