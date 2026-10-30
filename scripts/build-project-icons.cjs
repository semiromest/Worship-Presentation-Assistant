// Deterministic document icon assets, independent of the app executable icon.
const sharp = require('sharp');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const root = path.resolve(__dirname, '../build'),
    source = path.join(root, 'gpres.svg');
  const sizes = [16, 32, 48, 64, 128, 256],
    pngs = await Promise.all(sizes.map((size) => sharp(source).resize(size, size).png().toBuffer()));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  pngs.forEach((png, i) => {
    const p = 6 + i * 16,
      size = sizes[i];
    header[p] = size === 256 ? 0 : size;
    header[p + 1] = header[p];
    header.writeUInt16LE(1, p + 4);
    header.writeUInt16LE(32, p + 6);
    header.writeUInt32LE(png.length, p + 8);
    header.writeUInt32LE(offset, p + 12);
    offset += png.length;
  });
  await fs.writeFile(path.join(root, 'gpres.ico'), Buffer.concat([header, ...pngs]));
  const chunks = await Promise.all(
    [
      [16, 'icp4'],
      [32, 'icp5'],
      [64, 'icp6'],
      [128, 'ic07'],
      [256, 'ic08'],
      [512, 'ic09'],
      [1024, 'ic10'],
    ].map(async ([size, type]) => {
      const png = await sharp(source).resize(size, size).png().toBuffer(),
        head = Buffer.alloc(8);
      head.write(type);
      head.writeUInt32BE(png.length + 8, 4);
      return Buffer.concat([head, png]);
    })
  );
  const head = Buffer.alloc(8);
  head.write('icns');
  head.writeUInt32BE(8 + chunks.reduce((n, b) => n + b.length, 0), 4);
  await fs.writeFile(path.join(root, 'gpres.icns'), Buffer.concat([head, ...chunks]));
  await sharp(source).resize(256, 256).png().toFile(path.join(root, 'gpres.png'));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
