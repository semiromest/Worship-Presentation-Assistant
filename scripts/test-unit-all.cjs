// Discover tests recursively so a new test cannot silently miss the release gate.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function discover(dir, recursive = true) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) return !recursive || ['node_modules', 'artifacts', 'results'].includes(entry.name) ? [] : discover(name);
    return /\.test\.(ts|cjs)$/.test(entry.name) ? [name] : [];
  });
}
// perf subdirectories contain historical source snapshots, not current tests.
const performanceTests = fs.existsSync(path.join(root, 'perf')) ? discover('perf', false) : [];
const files = [...['src', 'scripts', 'tests/tour'].flatMap(dir => discover(dir)), ...performanceTests].sort();
if (!files.length) throw new Error('No unit tests discovered');
console.log(`Running ${files.length} test files`);
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=4', ...files], { cwd: root, stdio: 'inherit' });
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
