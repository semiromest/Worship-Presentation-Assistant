#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS CI script run directly by node. */
// Code signing rewrites the Windows installer after electron-builder produced
// latest.yml and the .blockmap. electron-updater verifies the downloaded file
// against latest.yml's sha512/size, so both must be regenerated from the signed
// installer or every auto-update would fail with a checksum mismatch.
//
// Usage: node scripts/refresh-update-metadata.cjs <release-version-dir>
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap');

async function main() {
  const dir = path.resolve(process.argv[2] || '');
  if (!process.argv[2] || !fs.statSync(dir).isDirectory()) throw new Error('Pass the release/<version> directory');
  const latestFile = path.join(dir, 'latest.yml');
  const info = yaml.load(fs.readFileSync(latestFile, 'utf8'));
  if (!info || !Array.isArray(info.files) || !info.files.length) throw new Error('latest.yml has no files entry');

  for (const entry of info.files) {
    const installer = path.join(dir, entry.url);
    if (!fs.existsSync(installer)) throw new Error(`Installer listed in latest.yml is missing: ${entry.url}`);
    const blockmap = `${installer}.blockmap`;
    // Same algorithm/compression electron-builder uses for NSIS differential updates.
    const result = await buildBlockMap(installer, 'gzip', blockmap);
    entry.sha512 = result.sha512;
    entry.size = fs.statSync(installer).size;
    console.log(`refreshed ${entry.url}: ${entry.size} bytes`);
  }
  // Legacy top-level fields mirror the first file (electron-updater < 2.15 compatibility).
  info.path = info.files[0].url;
  info.sha512 = info.files[0].sha512;
  fs.writeFileSync(latestFile, yaml.dump(info, { lineWidth: 8000 }));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
