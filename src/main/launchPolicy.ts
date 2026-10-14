import fs from 'node:fs';
import path from 'node:path';

export type LaunchMode = 'normal' | 'practice' | 'smoke';
export function parseLaunchMode(args: string[]): LaunchMode {
  if (args.some(arg => /^--wpa-(profile|isolation-spike)(=|$)/.test(arg) || /^--user-data-dir(=|$)/.test(arg)))
    throw new Error('External profile overrides are unsupported');
  const modes = args.filter(arg => arg.startsWith('--wpa-'));
  if (modes.length > 1 || modes.some(arg => !['--wpa-practice', '--wpa-smoke'].includes(arg)))
    throw new Error('Invalid launch mode');
  return modes[0] === '--wpa-practice' ? 'practice' : modes[0] === '--wpa-smoke' ? 'smoke' : 'normal';
}
export function assertNoLinks(target: string): void {
  let current = path.resolve(target);
  for (;;) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Linked profile directory is unsupported');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
export function practicePath(normalProfile: string): string {
  return path.join(path.dirname(normalProfile), path.basename(normalProfile) + '-practice');
}
export function assertProfileTree(target: string): void {
  assertNoLinks(target);
  if (!fs.existsSync(target) || !fs.lstatSync(target).isDirectory()) return;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    assertNoLinks(child);
    if (entry.isDirectory()) assertProfileTree(child);
  }
}
