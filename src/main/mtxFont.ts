/*
 * Embedded font decoder for PPTX `ppt/fonts/*.fntdata` parts.
 *
 * PowerPoint and Google Slides store embedded fonts as EOT (Embedded OpenType)
 * containers. Their payload is usually MicroType Express (MTX) compressed:
 * three LZCOMP blocks holding a "Compact Table Format" (CTF) font whose glyf,
 * loca and cvt tables are re-encoded. This module turns such a container back
 * into a plain TrueType file.
 *
 * Format: W3C Member Submission "MicroType Express (MTX) Font Format" (2008).
 * Decoding behaviour follows libeot (https://github.com/umanwizard/libeot),
 * which is licensed under the Mozilla Public License 2.0; accordingly:
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Input is untrusted: every read is bounds-checked and output size is capped.
 */

const MAX_OUTPUT = 64 * 1024 * 1024;
const EOT_MAGIC = 0x504c;
const EOT_FIXED_HEADER = 82;
const FLAG_COMPRESSED = 0x4;
const FLAG_XOR = 0x10000000;
const XOR_KEY = 0x50;

const SFNT_TTF = 0x00010000;
const SFNT_TRUE = 0x74727565; // 'true'
const SFNT_OTF = 0x4f54544f; // 'OTTO'

function fail(message: string): never {
  throw new Error(message);
}

const toInt16 = (v: number) => ((v & 0xffff) ^ 0x8000) - 0x8000;

class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}
  private need(n: number) {
    if (this.pos + n > this.buf.length) fail('truncated font data');
  }
  u8() { this.need(1); return this.buf[this.pos++]; }
  peek() { this.need(1); return this.buf[this.pos]; }
  u16() { this.need(2); const v = (this.buf[this.pos] << 8) | this.buf[this.pos + 1]; this.pos += 2; return v; }
  s16() { return toInt16(this.u16()); }
  u32() { this.need(4); const b = this.buf, p = this.pos; this.pos += 4; return ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0; }
  bytes(n: number) { this.need(n); const v = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return v; }
  seek(at: number) { if (!Number.isInteger(at) || at < 0 || at > this.buf.length) fail('font table offset out of range'); this.pos = at; }
}

class Writer {
  buf = new Uint8Array(4096);
  pos = 0;
  private ensure(n: number) {
    const need = this.pos + n;
    if (need <= this.buf.length) return;
    if (need > MAX_OUTPUT) fail('decoded font is too large');
    let size = this.buf.length * 2;
    while (size < need) size *= 2;
    const next = new Uint8Array(Math.min(size, MAX_OUTPUT));
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
  }
  u8(v: number) { this.ensure(1); this.buf[this.pos++] = v & 0xff; }
  u16(v: number) { this.ensure(2); this.buf[this.pos++] = (v >> 8) & 0xff; this.buf[this.pos++] = v & 0xff; }
  u32(v: number) { this.u16(v >>> 16); this.u16(v & 0xffff); }
  bytes(b: Uint8Array) { this.ensure(b.length); this.buf.set(b, this.pos); this.pos += b.length; }
  patch16(at: number, v: number) { this.buf[at] = (v >> 8) & 0xff; this.buf[at + 1] = v & 0xff; }
  result() { return this.buf.slice(0, this.pos); }
}

// ---------------------------------------------------------------------------
// LZCOMP: adaptive-Huffman coded LZ77 with a fixed preloaded history window.
// ---------------------------------------------------------------------------

class BitReader {
  private index = 0;
  private byte = 0;
  private left = 0;
  constructor(private readonly data: Uint8Array) {}
  bit(): number {
    if (this.left === 0) {
      if (this.index >= this.data.length) fail('LZCOMP stream is truncated');
      this.byte = this.data[this.index++];
      this.left = 8;
    }
    this.left--;
    return (this.byte >> this.left) & 1;
  }
  value(bits: number): number {
    let v = 0;
    for (let i = 0; i < bits; i++) v = v * 2 + this.bit();
    return v;
  }
}

/** Adaptive Huffman tree (FGK-style sibling property), node 1 is the root. */
class AdaptiveHuffman {
  private readonly up: Int32Array;
  private readonly left: Int32Array;
  private readonly right: Int32Array;
  private readonly code: Int32Array;
  private readonly weight: Int32Array;
  private readonly leaf: Int32Array;

  constructor(private readonly bits: BitReader, range: number) {
    const size = 2 * range;
    this.up = new Int32Array(size);
    this.left = new Int32Array(size);
    this.right = new Int32Array(size);
    this.code = new Int32Array(size).fill(-1);
    this.weight = new Int32Array(size);
    this.leaf = new Int32Array(range);
    for (let i = 2; i < size; i++) { this.up[i] = i >> 1; this.weight[i] = 1; }
    for (let i = 1; i < range; i++) { this.left[i] = 2 * i; this.right[i] = 2 * i + 1; }
    for (let i = 0; i < range; i++) {
      this.code[range + i] = i;
      this.left[range + i] = this.right[range + i] = -1;
      this.leaf[i] = range + i;
    }
    this.initWeight(1);
    if (range > 256 && range < 512) {
      // The LZCOMP symbol alphabet: bias towards literals 0/1 and the DUP2/DUP4 codes.
      this.update(this.leaf[256]);
      this.update(this.leaf[257]);
      for (let i = 0; i < 12; i++) this.update(this.leaf[range - 3]);
      for (let i = 0; i < 6; i++) this.update(this.leaf[range - 2]);
    } else {
      for (let j = 0; j < 2; j++) for (let i = 0; i < range; i++) this.update(this.leaf[i]);
    }
  }

  private initWeight(a: number): number {
    if (this.code[a] >= 0) return this.weight[a];
    return (this.weight[a] = this.initWeight(this.left[a]) + this.initWeight(this.right[a]));
  }

  private swap(a: number, b: number) {
    const { left, right, code, weight } = this;
    let t = left[a]; left[a] = left[b]; left[b] = t;
    t = right[a]; right[a] = right[b]; right[b] = t;
    t = code[a]; code[a] = code[b]; code[b] = t;
    t = weight[a]; weight[a] = weight[b]; weight[b] = t;
    for (const n of [a, b]) {
      if (code[n] < 0) { this.up[left[n]] = n; this.up[right[n]] = n; } else this.leaf[code[n]] = n;
    }
  }

  private update(a: number) {
    const weight = this.weight;
    for (; a !== 1; a = this.up[a]) {
      const w = weight[a];
      let b = a - 1;
      if (weight[b] === w) {
        do b--; while (weight[b] === w);
        b++;
        if (b > 1) { this.swap(a, b); a = b; }
      }
      weight[a] = w + 1;
    }
    weight[1]++;
  }

  read(): number {
    let a = 1;
    do a = this.bits.bit() ? this.right[a] : this.left[a];
    while (this.code[a] < 0);
    const symbol = this.code[a];
    this.update(a);
    return symbol;
  }
}

const LEN_WIDTH = 3;
const DIST_WIDTH = 3;
const BIT_RANGE = LEN_WIDTH - 1;
const MAX_2BYTE_DIST = 512;
const PRELOAD_SIZE = 2 * 32 * 96 + 4 * 256;
const LEN_MIN = 2;
const DIST_MIN = 1;

export function lzcompDecompress(data: Uint8Array, version: number): Uint8Array {
  const bits = new BitReader(data);
  const usingRunLength = version === 1 ? false : bits.bit() === 1;
  const distCoder = new AdaptiveHuffman(bits, 1 << DIST_WIDTH);
  const lenCoder = new AdaptiveHuffman(bits, 1 << LEN_WIDTH);
  const outLen = bits.value(24);

  let numDistRanges = 1;
  while (DIST_MIN + (1 << (DIST_WIDTH * numDistRanges)) - 1 < outLen) {
    if (++numDistRanges > 8) fail('LZCOMP distance range is invalid');
  }
  const DUP2 = 256 + (1 << LEN_WIDTH) * numDistRanges;
  const DUP4 = DUP2 + 1;
  const DUP6 = DUP4 + 1;
  const symCoder = new AdaptiveHuffman(bits, DUP6 + 1);

  const win = new Uint8Array(PRELOAD_SIZE + outLen);
  let w = 0;
  for (let k = 0; k < 32; k++) for (let j = 0; j < 96; j++) { win[w++] = k; win[w++] = j; }
  for (let j = 0; w < PRELOAD_SIZE && j < 256; j++) { win[w++] = j; win[w++] = j; win[w++] = j; win[w++] = j; }

  // Run-length post-pass (first byte is the escape; escape+0 = literal escape; escape+n+b = n×b).
  const out = new Writer();
  let rleState = 0, escape = 0, count = 0;
  const emit = (byte: number) => {
    if (!usingRunLength) { out.u8(byte); return; }
    switch (rleState) {
      case 0: escape = byte; rleState = 1; break;
      case 1: if (byte === escape) rleState = 2; else out.u8(byte); break;
      case 2: count = byte; if (count === 0) { out.u8(escape); rleState = 1; } else rleState = 3; break;
      default: for (let i = 0; i < count; i++) out.u8(byte); rleState = 1; break;
    }
  };

  let pos = PRELOAD_SIZE;
  const end = PRELOAD_SIZE + outLen;
  while (pos < end) {
    const symbol = symCoder.read();
    if (symbol < 256 || symbol >= DUP2) {
      const value = symbol < 256 ? symbol : win[pos - (symbol === DUP2 ? 2 : symbol === DUP4 ? 4 : 6)];
      win[pos++] = value;
      emit(value);
      continue;
    }
    // Copy item: the symbol carries the first length chunk and the distance width.
    let lenBits = symbol - 256;
    const ranges = Math.floor(lenBits / (1 << LEN_WIDTH)) + 1;
    lenBits %= 1 << LEN_WIDTH;
    let length = 0;
    for (let guard = 0; ; guard++) {
      if (guard > 16) fail('LZCOMP length is invalid');
      length = (length << BIT_RANGE) | (lenBits & ((1 << BIT_RANGE) - 1));
      if ((lenBits & (1 << BIT_RANGE)) === 0) break;
      lenBits = lenCoder.read();
    }
    length += LEN_MIN;
    let distance = 0;
    for (let i = 0; i < ranges; i++) distance = (distance << DIST_WIDTH) | distCoder.read();
    distance += DIST_MIN;
    if (distance >= MAX_2BYTE_DIST) length++;
    const start = pos - distance - length + 1;
    if (start < 0 || pos + length > end) fail('LZCOMP copy is out of range');
    for (let j = 0; j < length; j++) {
      const value = win[start + j];
      win[pos++] = value;
      emit(value);
    }
  }
  return out.result();
}

// ---------------------------------------------------------------------------
// CTF → TrueType reconstruction.
// ---------------------------------------------------------------------------

function read255UShort(s: Reader): number {
  const code = s.u8();
  if (code === 253) return s.u16();
  if (code === 255) return 253 + s.u8();
  if (code === 254) return 506 + s.u8();
  return code;
}

function read255Short(s: Reader): number {
  let code = s.u8();
  if (code === 253) return s.s16();
  let sign = 1;
  if (code === 250) { sign = -1; code = s.u8(); }
  const value = code === 255 ? 250 + s.u8() : code === 254 ? 500 + s.u8() : code;
  return sign * value;
}

/** Same triplet table as WOFF2 glyph encoding: flag (low 7 bits) selects widths, offsets and signs. */
function readTriplet(flag: number, s: Reader): [number, number] {
  const sx = (v: number) => (flag & 1 ? v : -v);
  const sy = (v: number) => ((flag >> 1) & 1 ? v : -v);
  if (flag < 10) return [0, (flag & 1 ? 1 : -1) * (((flag & 14) << 7) + s.u8())];
  if (flag < 20) return [(flag & 1 ? 1 : -1) * ((((flag - 10) & 14) << 7) + s.u8()), 0];
  if (flag < 84) {
    const b0 = flag - 20, b1 = s.u8();
    return [sx(1 + (b0 & 0x30) + (b1 >> 4)), sy(1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f))];
  }
  if (flag < 120) {
    const b0 = flag - 84;
    return [sx(1 + (Math.floor(b0 / 12) << 8) + s.u8()), sy(1 + (((b0 % 12) >> 2) << 8) + s.u8())];
  }
  if (flag < 124) {
    const b1 = s.u8(), b2 = s.u8(), b3 = s.u8();
    return [sx((b1 << 4) | (b2 >> 4)), sy(((b2 & 0x0f) << 8) | b3)];
  }
  return [sx(s.u16()), sy(s.u16())];
}

const NPUSHB = 0x40, NPUSHW = 0x41, PUSHB = 0xb0, PUSHW = 0xb8;

/** Decodes the compressed push stream and writes equivalent PUSHB/PUSHW/NPUSHB/NPUSHW instructions. */
function writePushes(pushes: Reader, count: number, out: Writer) {
  const values: number[] = [];
  while (values.length < count) {
    const code = pushes.peek();
    const remaining = count - values.length;
    if (code === 251 || code === 252) {
      const needed = code === 251 ? 3 : 5;
      if (remaining < needed || values.length < 2) fail('corrupt TrueType push data');
      pushes.u8();
      const a = values[values.length - 2];
      values.push(a, read255Short(pushes), a);
      if (code === 252) values.push(read255Short(pushes), a);
    } else {
      values.push(read255Short(pushes));
    }
  }
  for (let i = 0; i < values.length;) {
    const wide = values[i] < 0 || values[i] > 255;
    let j = i;
    while (j < values.length && j - i < 255 && (values[j] < 0 || values[j] > 255) === wide) j++;
    const n = j - i;
    if (n < 8) out.u8((wide ? PUSHW : PUSHB) + n - 1);
    else { out.u8(wide ? NPUSHW : NPUSHB); out.u8(n); }
    for (let k = i; k < j; k++) {
      if (wide) out.u16(values[k] & 0xffff);
      else out.u8(values[k]);
    }
    i = j;
  }
}

interface Streams { glyphs: Reader; pushes: Reader; code: Reader }

function writeInstructions(st: Streams, out: Writer) {
  const lengthAt = out.pos;
  out.u16(0);
  writePushes(st.pushes, read255UShort(st.glyphs), out);
  const codeSize = read255UShort(st.glyphs);
  if (codeSize) out.bytes(st.code.bytes(codeSize));
  const length = out.pos - lengthAt - 2;
  if (length > 0xffff) fail('glyph instructions are too long');
  out.patch16(lengthAt, length);
}

function writeSimpleGlyph(contours: number, st: Streams, out: Writer, bbox: number[] | null) {
  if (contours === 0) return; // empty glyph: zero-length loca entry
  const s = st.glyphs;
  out.u16(contours);
  const bboxAt = out.pos;
  for (let i = 0; i < 4; i++) out.u16(bbox ? bbox[i] & 0xffff : 0);
  let points = 0;
  for (let c = 0; c < contours; c++) {
    points += read255UShort(s) + (c === 0 ? 1 : 0);
    if (points > 0xffff) fail('glyph has too many points');
    out.u16(points - 1);
  }
  const flags = s.bytes(points);
  const xs = new Int32Array(points), ys = new Int32Array(points);
  let x = 0, y = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points; i++) {
    const [dx, dy] = readTriplet(flags[i] & 0x7f, s);
    xs[i] = dx; ys[i] = dy;
    x += dx; y += dy;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  writeInstructions(st, out);
  for (let i = 0; i < points; i++) {
    let f = flags[i] & 0x80 ? 0 : 1;
    const dx = xs[i], dy = ys[i];
    if (i > 0 && dx === 0) f |= 0x10; else if (dx > -256 && dx < 0) f |= 0x02; else if (dx >= 0 && dx < 256) f |= 0x12;
    if (i > 0 && dy === 0) f |= 0x20; else if (dy > -256 && dy < 0) f |= 0x04; else if (dy >= 0 && dy < 256) f |= 0x24;
    out.u8(f);
  }
  for (const deltas of [xs, ys]) {
    for (let i = 0; i < points; i++) {
      const d = deltas[i];
      if (i > 0 && d === 0) continue;
      if (d > -256 && d < 256) out.u8(Math.abs(d)); else out.u16(d & 0xffff);
    }
  }
  if (!bbox && points) {
    [minX, minY, maxX, maxY].forEach((v, i) => out.patch16(bboxAt + i * 2, v & 0xffff));
  }
}

function writeCompositeGlyph(st: Streams, out: Writer) {
  const s = st.glyphs;
  out.u16(0xffff);
  out.bytes(s.bytes(8)); // bbox
  let flags: number;
  do {
    flags = s.u16();
    out.u16(flags);
    out.u16(s.u16()); // glyph index
    out.bytes(s.bytes(flags & 0x0001 ? 4 : 2));
    const transform = flags & 0x0080 ? 8 : flags & 0x0040 ? 4 : flags & 0x0008 ? 2 : 0;
    if (transform) out.bytes(s.bytes(transform));
  } while (flags & 0x0020);
  if (flags & 0x0100) writeInstructions(st, out);
}

interface Table { tag: string; data: Uint8Array }

function rebuildGlyf(st: Streams, offset: number, numGlyphs: number, head: Uint8Array): { glyf: Uint8Array; loca: Uint8Array } {
  st.glyphs.seek(offset);
  const out = new Writer();
  const offsets = [0];
  for (let g = 0; g < numGlyphs; g++) {
    const contours = st.glyphs.s16();
    if (contours < 0) writeCompositeGlyph(st, out);
    else if (contours === 0x7fff) {
      const actual = st.glyphs.s16();
      const bbox = [st.glyphs.s16(), st.glyphs.s16(), st.glyphs.s16(), st.glyphs.s16()];
      writeSimpleGlyph(actual, st, out, bbox);
    } else writeSimpleGlyph(contours, st, out, null);
    if (out.pos & 1) out.u8(0);
    offsets.push(out.pos);
  }
  const long = out.pos > 0x1fffe || ((head[50] << 8) | head[51]) === 1;
  head[50] = 0; head[51] = long ? 1 : 0;
  const loca = new Writer();
  for (const o of offsets) {
    if (long) loca.u32(o);
    else loca.u16(o / 2);
  }
  return { glyf: out.result(), loca: loca.result() };
}

function unpackCvt(s: Reader, offset: number): Uint8Array {
  s.seek(offset);
  const count = s.u16();
  const out = new Writer();
  let last = 0;
  for (let i = 0; i < count; i++) {
    const code = s.u8();
    const delta = code >= 248 ? 238 * (code - 247) + s.u8()
      : code >= 239 ? -(238 * (code - 239) + s.u8())
        : code === 238 ? s.s16() : code;
    last = toInt16(last + delta);
    out.u16(last & 0xffff);
  }
  return out.result();
}

/** Device-metric/signature tables are optional; their CTF encodings are dropped rather than re-derived. */
const DROPPED_TABLES = new Set(['hdmx', 'VDMX', 'DSIG']);

function ctfToTables(blocks: Uint8Array[]): Table[] {
  const st: Streams = { glyphs: new Reader(blocks[0]), pushes: new Reader(blocks[1]), code: new Reader(blocks[2]) };
  const s = st.glyphs;
  s.u32();
  const numTables = s.u16();
  if (numTables === 0 || numTables > 128) fail('CTF table directory is invalid');
  s.u16(); s.u16(); s.u16();
  const dir: { tag: string; offset: number; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const tag = String.fromCharCode(...s.bytes(4));
    s.u32();
    dir.push({ tag, offset: s.u32(), length: s.u32() });
  }
  const raw = (t: { offset: number; length: number }) => {
    if (t.offset + t.length > blocks[0].length) fail('CTF table is truncated');
    return blocks[0].slice(t.offset, t.offset + t.length);
  };
  const tables: Table[] = [];
  let head: Uint8Array | undefined, maxp: Uint8Array | undefined;
  for (const t of dir) {
    if (t.tag === 'glyf' || t.tag === 'loca' || DROPPED_TABLES.has(t.tag) || tables.some(x => x.tag === t.tag)) continue;
    const data = t.tag === 'cvt ' ? unpackCvt(s, t.offset) : raw(t);
    if (t.tag === 'head') head = data;
    if (t.tag === 'maxp') maxp = data;
    tables.push({ tag: t.tag, data });
  }
  if (!head || head.length < 54) fail('font has no valid head table');
  head.fill(0, 8, 12); // checkSumAdjustment is recomputed
  const glyfEntry = dir.find(t => t.tag === 'glyf');
  if (glyfEntry) {
    if (!maxp || maxp.length < 6) fail('font has no valid maxp table');
    const { glyf, loca } = rebuildGlyf(st, glyfEntry.offset, (maxp[4] << 8) | maxp[5], head);
    tables.push({ tag: 'glyf', data: glyf }, { tag: 'loca', data: loca });
  }
  return tables;
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum = (sum + (((data[i] << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0)) >>> 0)) >>> 0;
  }
  return sum;
}

export function buildSfnt(tables: Table[], flavor = SFNT_TTF): Buffer {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = sorted.length;
  const entrySelector = Math.floor(Math.log2(n));
  const searchRange = (1 << entrySelector) * 16;
  let offset = 12 + 16 * n;
  const total = sorted.reduce((size, t) => size + ((t.data.length + 3) & ~3), offset);
  if (total > MAX_OUTPUT) fail('decoded font is too large');
  const out = Buffer.alloc(total);
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(n, 4);
  out.writeUInt16BE(searchRange, 6);
  out.writeUInt16BE(entrySelector, 8);
  out.writeUInt16BE(n * 16 - searchRange, 10);
  let headOffset = -1;
  sorted.forEach((t, i) => {
    const entry = 12 + i * 16;
    out.write(t.tag, entry, 4, 'latin1');
    out.writeUInt32BE(checksum(t.data), entry + 4);
    out.writeUInt32BE(offset, entry + 8);
    out.writeUInt32BE(t.data.length, entry + 12);
    out.set(t.data, offset);
    if (t.tag === 'head') headOffset = offset;
    offset += (t.data.length + 3) & ~3;
  });
  if (headOffset >= 0) out.writeUInt32BE((0xb1b0afba - checksum(out)) >>> 0, headOffset + 8);
  return out;
}

export function decompressMtx(data: Uint8Array): Buffer {
  if (data.length < 10) fail('MTX header is truncated');
  const version = data[0];
  const offset2 = (data[4] << 16) | (data[5] << 8) | data[6];
  const offset3 = (data[7] << 16) | (data[8] << 8) | data[9];
  if (offset2 < 10 || offset3 < offset2 || offset3 > data.length) fail('MTX block offsets are invalid');
  const blocks = [data.subarray(10, offset2), data.subarray(offset2, offset3), data.subarray(offset3)]
    .map(block => (block.length ? lzcompDecompress(block, version) : new Uint8Array(0)));
  return buildSfnt(ctfToTables(blocks));
}

const isSfnt = (b: Uint8Array) => {
  if (b.length < 12) return false;
  const sig = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  return sig === SFNT_TTF || sig === SFNT_OTF || sig === SFNT_TRUE;
};

/** Returns 'otf' for CFF-flavoured fonts, otherwise 'ttf'. */
export const sfntExtension = (font: Buffer) => (font.length >= 4 && font.readUInt32BE(0) === SFNT_OTF ? 'otf' : 'ttf');

/**
 * Decodes an embedded PPTX font part into a TrueType/OpenType file.
 * Accepts EOT (uncompressed, MTX-compressed and/or XOR-obfuscated) and bare SFNT payloads.
 * Throws with a short reason when the data cannot be decoded.
 */
export function decodeEmbeddedFont(bytes: Uint8Array): Buffer {
  if (isSfnt(bytes)) return Buffer.from(bytes);
  if (bytes.length < EOT_FIXED_HEADER || ((bytes[35] << 8) | bytes[34]) !== EOT_MAGIC) fail('not an EOT or TrueType font');
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eotSize = view.readUInt32LE(0);
  const fontSize = view.readUInt32LE(4);
  const flags = view.readUInt32LE(12);
  // Font data is the last field of the EOT header; trust EOTSize only when it is consistent.
  const end = eotSize <= view.length && eotSize >= EOT_FIXED_HEADER + fontSize ? eotSize : view.length;
  if (fontSize < 12 || end - fontSize < EOT_FIXED_HEADER) fail('EOT font data size is invalid');
  let data: Uint8Array = view.subarray(end - fontSize, end);
  if (flags & FLAG_XOR) data = data.map(b => b ^ XOR_KEY);
  const font = flags & FLAG_COMPRESSED ? decompressMtx(data) : Buffer.from(data);
  if (!isSfnt(font)) fail('EOT payload is not a TrueType/OpenType font');
  return font;
}
