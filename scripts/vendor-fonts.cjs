// Reproducible Google Fonts vendoring. No download occurs during application startup.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const ROOT = path.join(__dirname, '../resources/fonts');
const BUDGET = 32 * 1024 ** 2, COMPRESSED_BUDGET = 20 * 1024 ** 2;
async function get(url) {
  const result = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'WPA-font-vendor' } });
  if (!result.ok) throw new Error(`${result.status}: ${url}`);
  return Buffer.from(await result.arrayBuffer());
}
function table(bytes, name) {
  for (let i = 0; i < bytes.readUInt16BE(4); i++) {
    const at = 12 + i * 16;
    if (bytes.toString('ascii', at, at + 4) === name) return bytes.subarray(bytes.readUInt32BE(at + 8), bytes.readUInt32BE(at + 8) + bytes.readUInt32BE(at + 12));
  }
  throw new Error('Missing font table ' + name);
}
function supports(bytes, code) {
  const cmap = table(bytes, 'cmap');
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    const offset = cmap.readUInt32BE(4 + i * 8 + 4), format = cmap.readUInt16BE(offset);
    if (format === 12) {
      for (let j = 0; j < cmap.readUInt32BE(offset + 12); j++) {
        const at = offset + 16 + j * 12, first = cmap.readUInt32BE(at), last = cmap.readUInt32BE(at + 4);
        if (code >= first && code <= last && cmap.readUInt32BE(at + 8) + code - first !== 0) return true;
      }
    }
    if (format === 4 && code <= 65535) {
      const count = cmap.readUInt16BE(offset + 6) / 2;
      for (let j = 0; j < count; j++) {
        const last = cmap.readUInt16BE(offset + 14 + j * 2), first = cmap.readUInt16BE(offset + 16 + count * 2 + j * 2);
        if (code < first || code > last) continue;
        const delta = cmap.readInt16BE(offset + 16 + count * 4 + j * 2), rangeAt = offset + 16 + count * 6 + j * 2, range = cmap.readUInt16BE(rangeAt);
        const glyph = range ? cmap.readUInt16BE(rangeAt + range + (code - first) * 2) : code;
        if (glyph && ((glyph + delta) & 65535)) return true;
      }
    }
  }
  return false;
}
function version(bytes) {
  const names = table(bytes, 'name'), start = names.readUInt16BE(4);
  for (let i = 0; i < names.readUInt16BE(2); i++) {
    const at = 6 + i * 12;
    if (names.readUInt16BE(at + 6) !== 5) continue;
    const value = names.subarray(start + names.readUInt16BE(at + 10), start + names.readUInt16BE(at + 10) + names.readUInt16BE(at + 8));
    return names.readUInt16BE(at) === 3 ? Buffer.from(value).swap16().toString('utf16le') : value.toString('utf8');
  }
  return 'unknown';
}
async function main() {
  const check = process.argv.includes('--check');
  if (check) {
    const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'manifest.json'), 'utf8'));
    let total = 0, compressed = 0;
    for (const family of manifest.families) {
      const license = await fs.readFile(path.join(ROOT, family.license));
      if (!license.toString().includes('SIL OPEN FONT LICENSE')) throw new Error('Invalid license');
      total += license.length; compressed += zlib.gzipSync(license).length;
      for (const face of family.faces) {
        const bytes = await fs.readFile(path.join(ROOT, face.file));
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== face.sha256) throw new Error('Font integrity failure');
        total += bytes.length; compressed += zlib.gzipSync(bytes).length;
      }
    }
    if (total > BUDGET || compressed > COMPRESSED_BUDGET) throw new Error('Font budget exceeded');
    console.log(JSON.stringify({ families: manifest.families.length, bytes: total, gzipEstimate: compressed, installerDeltaVerified: false })); return;
  }
  const commit = process.env.WPA_FONT_COMMIT || JSON.parse((await get('https://api.github.com/repos/google/fonts/commits/main')).toString()).sha;
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Invalid commit');
  const source = await fs.readFile(path.join(__dirname, '../src/renderer/editor/editorUtils.ts'), 'utf8');
  const presets = [...source.slice(source.indexOf('// Google Fonts'), source.indexOf('] as const;')).matchAll(/name: '([^']+)'/g)].map(m => m[1]);
  const priority = ['Open Sans', 'Inter', 'Montserrat', 'Lora'];
  const order = [...priority, ...presets.filter(name => !priority.includes(name)).sort()];
  const manifest = { source: 'https://github.com/google/fonts', commit, budgetBytes: BUDGET, compressedBudgetBytes: COMPRESSED_BUDGET, requiredCharacters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzİıĞğŞşÇçÖöÜü', families: [], skipped: [] };
  await fs.mkdir(ROOT, { recursive: true });
  let total = 0, compressed = 0;
  for (const family of order) {
    try {
      const folder = family.replace(/[^a-z0-9]/gi, '').toLowerCase();
      const base = `https://raw.githubusercontent.com/google/fonts/${commit}/ofl/${folder}/`;
      const metadata = (await get(base + 'METADATA.pb')).toString();
      const license = await get(base + 'OFL.txt');
      if (!license.toString().includes('SIL OPEN FONT LICENSE')) throw new Error('Unsupported license');
      const variable = metadata.includes('tag: "wght"');
      const records = [...metadata.matchAll(/fonts \{([\s\S]*?)\n\}/g)].map(m => m[1]);
      const faces = [];
      for (const record of records) {
        const file = record.match(/filename: "([^\"]+)"/)?.[1], weight = Number(record.match(/weight: (\d+)/)?.[1]), style = record.match(/style: "([^\"]+)"/)?.[1];
        if (!file || !/\.(ttf|otf)$/i.test(file) || ![400,700].includes(weight)) continue;
        const bytes = await get(base + encodeURIComponent(file));
        if (![...manifest.requiredCharacters].every(character => supports(bytes, character.codePointAt(0)))) throw new Error('Required character coverage missing');
        faces.push({ file: `${folder}/${file}`, weight: variable ? '100 900' : String(weight), style, version: version(bytes), bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), data: bytes });
      }
      if (!faces.length) throw new Error('No supported faces');
      const familyBytes = license.length + faces.reduce((sum,face) => sum + face.bytes,0);
      const familyCompressed = zlib.gzipSync(license).length + faces.reduce((sum,face) => sum + zlib.gzipSync(face.data).length,0);
      if (total + familyBytes > BUDGET || compressed + familyCompressed > COMPRESSED_BUDGET) throw new Error('Budget');
      await fs.mkdir(path.join(ROOT, folder), { recursive: true });
      await fs.writeFile(path.join(ROOT, folder, 'OFL.txt'), license);
      for (const face of faces) { await fs.writeFile(path.join(ROOT, face.file), face.data); delete face.data; }
      manifest.families.push({ family, license: `${folder}/OFL.txt`, bytes: familyBytes, faces });
      total += familyBytes; compressed += familyCompressed;
      console.log(`${family}: ${familyBytes} bytes`);
    } catch(error) { manifest.skipped.push({ family, reason: String(error) }); console.log(`Skipped ${family}: ${error.message}`); }
  }
  manifest.totalBytes = total; manifest.gzipEstimate = compressed;
  await fs.writeFile(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest,null,2)+'\n');
  if (priority.some(name => !manifest.families.some(f => f.family === name))) throw new Error('Priority font unavailable; inspect manifest');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
