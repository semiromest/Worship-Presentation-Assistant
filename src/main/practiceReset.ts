import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoLinks } from './launchPolicy';
import { parseProgress } from './practiceProgress';
import { validateGuide, validatePracticeDeck } from './practiceWorkspace';
import type { PracticeWorkspace, PracticeProgress } from '../shared/practice';

export const resetFile = (profile: string) => path.join(profile, 'practice-reset.json');
export async function atomicPracticeJson(file: string, value: unknown) {
  assertNoLinks(file); assertNoLinks(path.dirname(file));
  await fs.mkdir(path.dirname(file), { recursive:true });
  const temp = file + '.' + randomUUID() + '.tmp';
  try { const handle = await fs.open(temp,'wx');
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    assertNoLinks(file); await fs.rename(temp,file);
  } finally { await fs.rm(temp,{force:true}); }
}
type Reset = { version:1; archive:string; createdAt:string; previous:PracticeWorkspace; previousProgress:PracticeProgress; next:PracticeWorkspace; nextProgress:PracticeProgress };
function validate(raw: Reset) {
  if (raw?.version !== 1 || !/^\d{13}-[a-f0-9-]{36}\.json$/.test(raw.archive) || typeof raw.createdAt !== 'string') throw new Error('Invalid restart journal');
  for (const [workspace,progress] of [[raw.previous,raw.previousProgress],[raw.next,raw.nextProgress]] as const) {
    validatePracticeDeck(workspace.deck); validateGuide(workspace.guide); parseProgress(JSON.stringify(progress));
    if (!workspace.runId || workspace.runId !== progress.runId || workspace.schemaVersion !== 2) throw new Error('Mismatched restart run');
  }
  if (raw.next.runId === raw.previous.runId || raw.next.active || raw.next.guide.step !== 'welcome' || !raw.next.guide.paused) throw new Error('Invalid fresh run');
  return raw;
}
async function finish(profile:string, journal:Reset) {
  const archive = path.join(profile,'practice-archives',journal.archive); assertNoLinks(archive);
  const snapshot = { version:1,createdAt:journal.createdAt,workspace:journal.previous,progress:journal.previousProgress };
  try { if (await fs.readFile(archive,'utf8') !== JSON.stringify(snapshot)) throw new Error('Archive collision'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await atomicPracticeJson(archive,snapshot); }
  await atomicPracticeJson(path.join(profile,'practice-workspace.json'),journal.next);
  await atomicPracticeJson(path.join(profile,'practice-progress.json'),journal.nextProgress);
  await fs.rm(resetFile(profile));
}
export async function recoverPracticeReset(profile:string):Promise<PracticeWorkspace|null> {
  assertNoLinks(resetFile(profile)); let journal:Reset;
  try { journal=validate(JSON.parse(await fs.readFile(resetFile(profile),'utf8'))); }
  catch(error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  await finish(profile,journal); return journal.next;
}
export async function restartPracticeRun(profile:string, previous:PracticeWorkspace, previousProgress:PracticeProgress, next:PracticeWorkspace) {
  const journal = validate({ version:1, archive:Date.now()+'-'+randomUUID()+'.json',createdAt:new Date().toISOString(),previous,previousProgress,next,
    nextProgress:{schemaVersion:2,runId:next.runId,revision:previousProgress.revision+1,tasks:{},exercises:{}} });
  await atomicPracticeJson(resetFile(profile),journal);
  try { await finish(profile,journal); }
  catch(error) {
    // Ordinary I/O failure restores the old run. Process loss instead replays
    // the durable journal at next startup. Never discard the archived work.
    await atomicPracticeJson(path.join(profile,'practice-workspace.json'),previous);
    await atomicPracticeJson(path.join(profile,'practice-progress.json'),previousProgress);
    await fs.rm(resetFile(profile)); throw error;
  }
}
