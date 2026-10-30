const fs = require('node:fs/promises');
const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');
const { execFileSync } = require('node:child_process');
async function main() {
  process.exitCode = 1;
  if (process.argv[2] === '--one') {
    await build({ projectDir: path.resolve(__dirname, '..'), targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never', config: process.argv[3] });
    process.exitCode = 0; return;
  }
  const root = path.resolve(__dirname, '..'), outputs = {};
  const base = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).build;
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const image = await loadImage(path.join(root, 'build/ico.png')), canvas = createCanvas(256, 256);
  canvas.getContext('2d').drawImage(image, 0, 0, 256, 256);
  const png = canvas.toBuffer('image/png'), header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  const icon = path.join(await fs.mkdtemp(path.join(root, '.tmp/font-budget-icon-')), 'icon.ico'); await fs.writeFile(icon, Buffer.concat([header, png]));
  for (const fonts of [false, true]) {
    const output = await fs.mkdtemp(path.join(root, '.tmp', fonts ? 'installer-with-fonts-' : 'installer-without-fonts-'));
    const config = {
      ...base,
      electronDist: path.join(root, 'node_modules/electron/dist'), npmRebuild: false,
      directories: { ...base.directories, output }, win: { ...base.win, icon, signAndEditExecutable: false },
      extraResources: base.extraResources.filter(resource => fonts || resource.to !== 'fonts'),
      nsis: { ...base.nsis, artifactName: 'WPA-font-budget-setup.exe' },
    };
    const configFile = path.join(output, 'builder.json'); await fs.writeFile(configFile, JSON.stringify(config, null, 2));
    execFileSync(process.execPath, [__filename, '--one', configFile], { cwd: root, stdio: 'inherit', windowsHide: true });
    outputs[fonts ? 'withFonts' : 'withoutFonts'] = (await fs.stat(path.join(output, 'WPA-font-budget-setup.exe'))).size;
  }
  const deltaBytes = outputs.withFonts - outputs.withoutFonts;
  const result = { target: 'Windows x64 unsigned NSIS', ...outputs, deltaBytes, budgetBytes: 20 * 1024 ** 2, passed: deltaBytes <= 20 * 1024 ** 2 };
  await fs.writeFile(path.join(root, '.tmp/font-installer-budget.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  process.exitCode = result.passed ? 0 : 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
