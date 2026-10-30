import { randomUUID } from 'node:crypto';
import type { PreviewDeck, PreviewSlot, PreviewAssetRequest, PreviewAssetResult } from '../shared/remotePreview';

export type Asset = { bytes: Buffer; type: string };
type Slot = PreviewSlot & { address: string; asset?: Asset };
type Finish = (asset?: Asset) => void;

const MAX_SLOTS = 10_000;
const MAX_ID_LENGTH = 200;
const MAX_DATA_URL_CHARS = 2 * 1024 * 1024;
const MAX_WAITING_ADDRESSES = 128;
const MAX_WAITERS_PER_ADDRESS = 16;
const WAIT_MS = 10_000;
const DATA_URL_HEAD = /^data:(image\/(?:webp|png|jpeg));base64,/;
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;

/** Encoded bytes only. Metadata survives eviction, so a cache miss is not an
 * invalidation and can be regenerated on the next real HTTP request. */
export class PreviewAssets {
  private token = '';
  private slots = new Map<string, Slot>();
  private addresses = new Map<string, Slot>();
  private lru = new Map<string, Slot>();
  private waiting = new Map<string, Set<Finish>>();
  private bytes = 0;

  constructor(
    private need: (request: PreviewAssetRequest) => void,
    private maxBytes = 16 * 1024 * 1024,
    private maxEntries = 256
  ) {}

  snapshot() {
    return { entries: this.lru.size, bytes: this.bytes, slots: this.slots.size, waiting: this.waiting.size };
  }

  configure(input: PreviewDeck): string[] {
    if (!input || typeof input.token !== 'string' || input.token.length > MAX_ID_LENGTH ||
      !Array.isArray(input.slots) || input.slots.length > MAX_SLOTS) throw new Error('Invalid preview deck');

    const previous = this.token === input.token ? this.slots : undefined;
    const next = new Map<string, Slot>();
    const nextAddresses = new Map<string, Slot>();
    const result: string[] = [];
    for (const value of input.slots as PreviewSlot[]) {
      if (!value || typeof value.id !== 'string' || value.id.length > MAX_ID_LENGTH ||
        !Number.isSafeInteger(value.version) || value.version < 0 || next.has(value.id)) {
        throw new Error('Invalid preview deck');
      }
      const old = previous?.get(value.id);
      const slot = old?.version === value.version
        ? old
        : { ...value, address: `/preview/${randomUUID()}` };
      next.set(value.id, slot);
      nextAddresses.set(slot.address, slot);
      result.push(slot.address);
    }

    for (const [address, slot] of this.addresses) {
      if (nextAddresses.has(address)) continue;
      this.evict(slot);
      this.settle(address);
    }
    this.token = input.token;
    this.slots = next;
    this.addresses = nextAddresses;
    return result;
  }

  private evict(slot: Slot) {
    if (slot.asset) {
      this.bytes -= slot.asset.bytes.length;
      slot.asset = undefined;
    }
    this.lru.delete(slot.address);
  }

  /** Resolve all waiters for an address, including removal and cache-miss cases. */
  private settle(address: string, asset?: Asset) {
    const waiters = this.waiting.get(address);
    if (!waiters) return;
    this.waiting.delete(address);
    for (const finish of [...waiters]) finish(asset);
  }

  publish(input: PreviewAssetResult): boolean {
    const slot = this.slots.get(input?.id);
    if (!slot || input.token !== this.token || input.version !== slot.version ||
      typeof input.dataUrl !== 'string' || input.dataUrl.length > MAX_DATA_URL_CHARS) return false;
    const head = DATA_URL_HEAD.exec(input.dataUrl);
    if (!head) return false;
    const body = input.dataUrl.slice(head[0].length);
    if (!BASE64_BODY.test(body) || body.length % 4 !== 0) return false;
    const bytes = Buffer.from(body, 'base64');
    if (bytes.toString('base64') !== body) return false;
    const asset: Asset = { type: head[1], bytes };
    this.evict(slot);
    if (asset.bytes.length <= this.maxBytes) {
      slot.asset = asset;
      this.lru.set(slot.address, slot);
      this.bytes += asset.bytes.length;
      while (this.bytes > this.maxBytes || this.lru.size > this.maxEntries) {
        const oldest = this.lru.values().next().value;
        if (!oldest) break;
        this.evict(oldest);
      }
    }
    this.settle(slot.address, asset);
    return true;
  }

  read(address: string, signal?: AbortSignal): Promise<Asset | undefined> {
    const slot = this.addresses.get(address);
    if (!slot || signal?.aborted) return Promise.resolve(undefined);
    if (slot.asset) {
      this.lru.delete(address); this.lru.set(address, slot);
      return Promise.resolve(slot.asset);
    }
    const existing = this.waiting.get(address);
    if (existing ? existing.size >= MAX_WAITERS_PER_ADDRESS : this.waiting.size >= MAX_WAITING_ADDRESSES) {
      return Promise.resolve(undefined);
    }
    const waiters = existing ?? new Set<Finish>();
    const first = !waiters.size;
    return new Promise<Asset | undefined>(resolve => {
      const finish: Finish = (asset) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        waiters.delete(finish);
        if (!waiters.size && this.waiting.get(address) === waiters) this.waiting.delete(address);
        resolve(asset);
      };
      const abort = () => finish();
      const timer = setTimeout(finish, WAIT_MS);
      timer.unref();
      signal?.addEventListener('abort', abort, { once: true });
      waiters.add(finish);
      this.waiting.set(address, waiters);
      if (first) {
        try {
          this.need({ token: this.token, id: slot.id, version: slot.version });
        } catch {
          finish();
        }
      }
    });
  }

  clear() {
    this.configure({ token: '', slots: [] });
  }
}
