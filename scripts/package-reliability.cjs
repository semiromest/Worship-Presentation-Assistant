const path = require('node:path');
const fs = require('node:fs/promises');
const { build, Platform, Arch } = require('electron-builder');
async function main() {
process.exitCode = 1;
const project = path.resolve(__dirname, '..');
const packageOutput = path.resolve(project, process.env.WPA_RELIABILITY_OUTPUT || '.tmp/reliability-package');
if (!packageOutput.startsWith(path.join(project, '.tmp') + path.sep)) throw new Error('Test packages must stay inside workspace .tmp');
const snapshot = await fs.mkdtemp(path.join(project, '.tmp/reliability-source-'));
for (const entry of ['package.json', 'dist', 'dist-electron', 'build']) await fs.cp(path.join(project, entry), path.join(snapshot, entry), { recursive: true });
const base = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8')).build;
const configFile = path.join(snapshot, 'builder.json');
await fs.writeFile(configFile, JSON.stringify({ ...base,
  electronDist: path.join(project, 'node_modules/electron/dist'),
  directories: { ...base.directories, output: packageOutput },
  files: ['package.json', ...['dist', 'dist-electron', 'build'].map(directory => ({ from: path.join(snapshot, directory), to: directory, filter: ['**/*', '!**/*.map', '!**/*.ts'] }))],
  win: { ...base.win, signAndEditExecutable: false }, npmRebuild: false,
}, null, 2));
await build({
  projectDir: project,
  targets: Platform.WINDOWS.createTarget('dir', Arch.x64),
  config: configFile,
});
console.log('Packaged immutable build snapshot:', snapshot);
process.exitCode = 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
