import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertNoLinks } from './launchPolicy';
import { recoverPracticeReset, restartPracticeRun } from './practiceReset';
import { practiceHymns, practiceExercises, exerciseOperation, guideSteps, guideChapters, guideNarrative, guideResultSteps, isGuideResultStep, type GuideResult, type GuideResultStep, type GuideUi, type GuideStep, type GuideObservation, type PracticeGuide, type PracticeExercise, type PracticeWorkspace } from '../shared/practice';
import type { Presentation } from '../renderer/types';
import type { createProgressStore } from './practiceProgress';

function isPracticeHymnSlide(slide: Presentation['slides'][number]) {
  return slide.type === 'text' && Object.values(practiceHymns).some(sample =>
    slide.group?.title === sample.title && sample.lyrics.split('\n\n').includes(slide.content) &&
    (!slide.partsMode || JSON.stringify(slide.parts) === JSON.stringify(sample.lyrics.split('\n\n')) || slide.parts?.length === 1 && slide.parts[0] === sample.lyrics.split('\n\n')[0]));
}
export const sampleVerse = 'In the beginning God created the heaven and the earth.';
/** Read exactly one durable preset; store cache/GC must not race a pending save. */
export async function readPracticeSavedPreset(profile: string, name: string) {
  if (typeof name !== 'string' || !name.trim() || name.length > 1000) throw new Error('Invalid saved name');
  const file = path.join(profile,'presets',Buffer.from(name,'utf8').toString('base64url')+'.json');
  assertNoLinks(profile); assertNoLinks(file);
  try {
    const handle = await fs.open(file,'r');
    try {
      if ((await handle.stat()).size > 12_000_000) throw new Error('Saved record too large');
      const record = JSON.parse(await handle.readFile('utf8'));
      if (record.name !== name || !Number.isFinite(record.createdAt) || record.createdAt <= 0) throw new Error('Invalid saved record');
      validatePracticeDeck(record.presentation);
      return record as { name: string; presentation: unknown; createdAt: number };
    } finally { await handle.close(); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
export function validateGuide(raw: unknown): PracticeGuide {
  const guide = raw as PracticeGuide;
  if (!guide || ![1,2,3].includes(guide.version) || typeof guide.id !== 'string' || !guideSteps.includes(guide.step) || typeof guide.paused !== 'boolean' ||
    !Array.isArray(guide.skipped) || guide.skipped.some(step => !guideSteps.includes(step))) throw new Error('Invalid guide');
  if (guide.ui) validateUi(guide.ui);
  if (guide.focusSlideId !== undefined && typeof guide.focusSlideId !== 'string') throw new Error('Invalid guide focus');
  const result = isGuideResultStep(guide.step) && validGuideResult(guide.result, guide.step) ? guide.result : undefined;
  return { ...guide, version: 3, result, step: (guide.version as number) === 1 && guide.step === 'done' ? 'nav-bible' : guide.step };
}
export function validGuideResult(result: GuideResult | undefined, step: GuideResultStep): result is GuideResult {
  try {
    if (!result || result.exercise !== guideResultSteps[step] || result.operation !== exerciseOperation[result.exercise] ||
      [result.runId,result.deckId,result.sessionId,result.resourceId].some(id => typeof id !== 'string' || !id) ||
      !Array.isArray(result.resourceIds) || !result.resourceIds.length || result.resourceIds.length > 1000 ||
      result.resourceIds.some(id => typeof id !== 'string' || !id) || new Set(result.resourceIds).size !== result.resourceIds.length ||
      !result.resourceIds.includes(result.resourceId) ||
      [result.beforeCount,result.afterCount].some(count => !Number.isInteger(count) || count < 0 || count > 1000)) return false;
    validatePracticeDeck({ id: result.deckId, name: 'Result', slides: result.slides });
    for (const slide of result.slides) {
      if (slide.items !== undefined && (!Array.isArray(slide.items) || slide.items.some(item => !item || typeof item !== 'object' || typeof item.id !== 'string' ||
        !['text','image','group','shape'].includes(item.type) || item.content !== undefined && typeof item.content !== 'string'))) return false;
      if (slide.parts !== undefined && (!Array.isArray(slide.parts) || slide.parts.some(part => typeof part !== 'string'))) return false;
      if (slide.styles !== undefined && (!slide.styles || typeof slide.styles !== 'object' || Array.isArray(slide.styles))) return false;
      const stops = slide.styles?.backgroundGradient?.stops;
      if (stops !== undefined && (!Array.isArray(stops) || stops.some(stop => !stop || typeof stop.color !== 'string' || typeof stop.position !== 'number'))) return false;
      if (slide.videoOverlays !== undefined && !Array.isArray(slide.videoOverlays)) return false;
      if (slide.loopItems !== undefined && !Array.isArray(slide.loopItems)) return false;
    }
    if (result.remaining) { validatePracticeDeck({ id: result.deckId, name: 'Remaining', slides: result.remaining }); if (result.remaining.length > 6) return false; }
    if (step === 'save-result') return typeof result.savedName === 'string' && !!result.savedName.trim() && result.savedName.length <= 1000 &&
      typeof result.savedAt === 'number' && Number.isFinite(result.savedAt) && result.savedAt > 0 && result.resourceId === result.deckId && result.slides.length <= 1;
    if (!result.slides.length || result.slides.length !== result.resourceIds.length || result.slides.some(slide => !result.resourceIds.includes(slide.id))) return false;
    if (step === 'delete-result') return result.slides.length === 1 && result.afterCount === result.beforeCount - 1 && Array.isArray(result.remaining);
    if (step === 'image-edit-result') return result.beforeCount === result.afterCount && result.slides.length === 1 && result.slides[0].type === 'image' && result.slides[0].styles?.objectFit === 'contain' && result.slides[0].styles?.imageGrayscale === 1;
    if (result.afterCount <= result.beforeCount) return false;
    if (step === 'add-result') return result.slides.every(slide => slide.type === 'text');
    if (step === 'bible-result') return result.slides.every(slide => slide.type === 'text') && result.slides.some(slide => slide.content.includes(sampleVerse));
    if (step === 'hymns-result') return result.slides.every(isPracticeHymnSlide);
    if (step === 'media-result') return result.slides.every(slide => slide.type === 'image');
    return result.slides.every(slide => slide.type === 'countdown' && JSON.parse(slide.content).totalSeconds >= 120 && JSON.parse(slide.content).totalSeconds < 180);
  } catch { return false; }
}
function validateUi(ui: GuideUi) {
  if (!ui || typeof ui !== 'object' || Array.isArray(ui)) throw new Error('Invalid UI state');
  for (const [key,value] of Object.entries(ui)) {
    if (['book','chapter','minutes'].includes(key)) { if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 200) throw new Error('Invalid UI number'); }
    else if (!['bibleReady','chapterChosen','verse','sourceMenu','mediaMenu','imageReady','imageImported'].includes(key) || typeof value !== 'boolean') throw new Error('Invalid UI flag');
  }
}
function newGuide(): PracticeGuide { return { version: 3, id: randomUUID(), step: 'welcome', paused: true, skipped: [] }; }
export function validatePracticeDeck(raw: unknown): Presentation & { id: string } {
  const deck = raw as Presentation;
  if (!deck || typeof deck.id !== 'string' || typeof deck.name !== 'string' || !Array.isArray(deck.slides) ||
    deck.slides.length > 1000 || JSON.stringify(deck).length > 10_000_000) throw new Error('Invalid practice presentation');
  const ids = new Set<string>();
  for (const slide of deck.slides) {
    if (!slide || typeof slide.id !== 'string' || ids.has(slide.id) || typeof slide.content !== 'string' ||
      !['text', 'image', 'video', 'countdown', 'screen', 'loop', 'captions'].includes(slide.type)) throw new Error('Invalid practice slide');
    ids.add(slide.id);
  }
  return JSON.parse(JSON.stringify(deck));
}
export function exerciseSucceeded(state: PracticeWorkspace, next: Presentation, sampleMedia: string): boolean {
  const active = state.active;
  if (!active || active.paused || next.id !== state.deck.id) return false;
  const added = next.slides.filter(slide => !active.baseline.includes(slide.id));
  switch (active.exercise) {
    case 'slide-reorder': return active.baseline.length === next.slides.length && active.baseline.every(id => next.slides.some(slide => slide.id === id)) && !!active.target && next.slides.findIndex(slide => slide.id === active.target) !== active.baseline.indexOf(active.target) && !!active.fingerprint && next.slides.some(slide => slide.id === active.target && JSON.stringify(slide) === active.fingerprint);
    case 'slide-add': return added.some(slide => slide.type === 'text');
    case 'slide-delete': return active.baseline.every(id => next.slides.some(slide => slide.id === id)) && !!active.target && state.deck.slides.some(slide => slide.id === active.target && JSON.stringify(slide) === active.fingerprint) && !next.slides.some(slide => slide.id === active.target);
    case 'media': return added.some(slide => slide.type === 'image' && (() => { try { return path.resolve(fileURLToPath(slide.mediaUrl ?? '')) === path.resolve(sampleMedia); } catch { return false; } })());
    case 'bible': return !!active.importedBible && added.some(slide => slide.type === 'text' && slide.content.includes(sampleVerse));
    case 'hymns': return added.some(slide => isPracticeHymnSlide(slide) && (!slide.partsMode || slide.parts?.length === 2));
    case 'image-edit': return active.baseline.length === next.slides.length && active.baseline.every(id => next.slides.some(slide => slide.id === id)) && next.slides.some(slide => slide.id === active.target && slide.type === 'image' && slide.mediaUrl === state.deck.slides.find(original => original.id === active.target)?.mediaUrl && slide.styles?.objectFit === 'contain' && slide.styles?.imageGrayscale === 1);
    case 'countdown': return added.some(slide => { try { return slide.type === 'countdown' && JSON.parse(slide.content).totalSeconds > 0; } catch { return false; } });
    default: return false;
  }
}
export function createPracticeWorkspace(profile: string, progress: ReturnType<typeof createProgressStore>) {
  const file = path.join(profile, 'practice-workspace.json');
  const assets = path.join(profile, 'practice-assets');
  const media = path.join(assets, 'practice-image.svg');
  const bible = path.join(assets, 'practice-bible.xml');
  let state: PracticeWorkspace | null = null;
  let committedState: PracticeWorkspace | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(job: () => Promise<T>): Promise<T> { const result = queue.catch(() => {}).then(async()=>{ const recovered=await recoverPracticeReset(profile); if(recovered)state=recovered; return job(); }); queue = result; return result; }
  async function persist(): Promise<PracticeWorkspace> {
    if (!state) throw new Error('Workspace unavailable');
    assertNoLinks(file); assertNoLinks(profile);
    await fs.mkdir(profile, { recursive: true });
    const temp = file + '.' + randomUUID() + '.tmp';
    try {
      const handle = await fs.open(temp, 'wx');
      try { await handle.writeFile(JSON.stringify(state)); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temp, file);
    } finally { await fs.rm(temp, { force: true }); }
    committedState = JSON.parse(JSON.stringify(state));
    return JSON.parse(JSON.stringify(committedState));
  }
  async function load(deck?: unknown): Promise<PracticeWorkspace> {
    if (!state) {
      assertNoLinks(file);
      try {
        const stored = JSON.parse(await fs.readFile(file, 'utf8')) as PracticeWorkspace;
        if (![1, 2].includes(stored.schemaVersion) || stored.active && (!practiceExercises.includes(stored.active.exercise) || typeof stored.active.id !== 'string' || !Array.isArray(stored.active.baseline) ||
          stored.active.baseline.some(id => typeof id !== 'string') ||
          [stored.active.target, stored.active.peer, stored.active.fingerprint].some(value => value !== undefined && typeof value !== 'string') ||
          [stored.active.paused, stored.active.importedBible, stored.active.importedMedia].some(value => value !== undefined && typeof value !== 'boolean'))) throw new Error('Invalid workspace');
        const checkpoints = stored.checkpoints ?? {};
        if (typeof checkpoints !== 'object' || Array.isArray(checkpoints)) throw new Error('Invalid checkpoints');
        for (const [exercise, checkpoint] of Object.entries(checkpoints)) {
          if (!practiceExercises.includes(exercise as PracticeExercise) || !checkpoint || checkpoint.exercise !== exercise || typeof checkpoint.id !== 'string' ||
            typeof checkpoint.deckId !== 'string' || !Array.isArray(checkpoint.baseline) || checkpoint.baseline.some(id => typeof id !== 'string') ||
            [checkpoint.target, checkpoint.peer, checkpoint.fingerprint].some(value => value !== undefined && typeof value !== 'string') ||
            [checkpoint.paused, checkpoint.importedBible, checkpoint.importedMedia].some(value => value !== undefined && typeof value !== 'boolean')) throw new Error('Invalid checkpoint');
        }
        state = { ...stored, schemaVersion: 2, guide: stored.schemaVersion === 2 ? { ...validateGuide(stored.guide), paused: true } : newGuide(), checkpoints, deck: validatePracticeDeck(stored.deck), active: stored.active ? { ...stored.active, deckId: stored.active.deckId ?? stored.deck.id, paused: true } : null };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        state = { schemaVersion: 2, guide: newGuide(), deck: validatePracticeDeck(deck), active: null };
      }
    }
    if (!state.runId) state.runId = 'legacy:' + state.deck.id;
    await progress.bindRun(state.runId);
    if (state.guide.result && (state.guide.result.runId !== state.runId || state.guide.result.deckId !== state.deck.id)) delete state.guide.result;
    await reconcileResult();
    if (state.guide.step === 'delete-result') { state.guide.step = 'nav-bible'; delete state.guide.result; state.active = null; }
    return JSON.parse(JSON.stringify(state));
  }
  async function savedResult(preset: { name: string; presentation: unknown; createdAt: number }) {
    if (!state?.active) throw new Error('Missing save session');
    const actual = validatePracticeDeck(preset.presentation);
    const result: GuideResult = { exercise: 'presentations', operation: 'preset-saved', sessionId: state.active.id, resourceId: actual.id,
      runId: state.runId!, deckId: actual.id, resourceIds: [actual.id], slides: actual.slides.slice(0,1), beforeCount: actual.slides.length,
      afterCount: actual.slides.length, savedName: preset.name, savedAt: preset.createdAt };
    // Never roll newer edits back to the saved snapshot.
    await showResult('save-result',result);
  }
  async function reconcileResult() {
    if (state && isGuideResultStep(state.guide.step) && validGuideResult(state.guide.result, state.guide.step)) {
      // Workspace evidence is durable first; progress is an idempotent projection.
      await progress.recordExerciseResult(state.guide.result);
    }
  }
  async function showResult(step: GuideResultStep, result: GuideResult) {
    if (!state || !validGuideResult(result, step)) throw new Error('Invalid result evidence');
    state.guide.step = step; state.guide.result = JSON.parse(JSON.stringify(result)); state.active = null;
    await persist();
    await reconcileResult();
  }
  async function advance(step: GuideStep, label: string) {
    if (!state) throw new Error('Workspace unavailable');
    const previousResult = state.guide.result;
    const previousSession = state.active;
    state.guide.step = step;
    if (step === 'hymns-parts') state.guide.focusSlideId = previousResult?.resourceId;
    else if (step === 'hymns-font') { /* Keep the selected hymn for the explanation. */ }
    else delete state.guide.focusSlideId;
    delete state.guide.result;
    state.active = ['image-fit','image-grayscale'].includes(step) && previousSession?.exercise === 'image-edit' ? previousSession : null;
    const exercises: Partial<Record<GuideStep, PracticeExercise>> = { reorder: 'slide-reorder', 'image-select': 'image-edit', add: 'slide-add', select: 'slide-delete', 'bible-source':'bible','media-menu':'media','hymns-add':'hymns','countdown-duration':'countdown',save:'presentations' };
    const exercise = exercises[step];
    if (exercise) {
      state.active = { id: randomUUID(), exercise, deckId: state.deck.id, baseline: state.deck.slides.map(slide => slide.id), paused: false };
      if (step === 'image-select') {
        state.active.target = [...state.deck.slides].reverse().find(slide => slide.type === 'image' && (() => { try { return path.resolve(fileURLToPath(slide.mediaUrl ?? '')) === path.resolve(media); } catch { return false; } })())?.id;
      }
      if (step === 'select' && previousSession?.exercise === 'slide-reorder' && previousSession.target && state.deck.slides.some(slide => slide.id === previousSession.target && JSON.stringify(slide) === previousSession.fingerprint)) {
        state.active.target = previousSession.target; state.active.fingerprint = previousSession.fingerprint; state.active.baseline = state.deck.slides.filter(slide => slide.id !== previousSession.target).map(slide => slide.id);
      } else if (step === 'select' || step === 'reorder') {
        const previous = state.deck.slides.at(-1); const sectionId = previous?.sectionId ?? '__unassigned';
        const sample = { id: randomUUID(), type: 'text' as const, content: label, styles: { fontSize: 64, backgroundColor: '#000000', textColor: '#ffffff' },
          sectionId, section: { id: sectionId, title: previous?.section?.title ?? '' } };
        state.deck.slides.push(sample); state.active.target = sample.id; state.active.fingerprint = JSON.stringify(sample);
        if (step === 'reorder') { state.active.peer = previousResult?.resourceId ?? state.active.baseline.at(-1); state.active.baseline = state.deck.slides.map(slide => slide.id); }
      }
      await progress.setExerciseStatus(exercise, 'inProgress');
    }
  }
  async function observeGuide(input: GuideObservation, label: string) {
    if (!state || state.guide.paused) return;
    const next = validatePracticeDeck(input.deck);
    if (next.id !== state.deck.id || !Array.isArray(input.selected) || input.selected.some(id => typeof id !== 'string')) throw new Error('Invalid guide observation');
    const step = state.guide.step; const task = state.active;
    const ui = input.ui ?? {}; validateUi(ui); state.guide.ui = { ...state.guide.ui, ...ui };
    const succeeded = exerciseSucceeded(state, next, media);
    const before = state.deck;
    const add = step === 'add' && task && next.slides.some(slide => slide.type === 'text' && !task.baseline.includes(slide.id));
    const remove = step === 'delete' && task?.target && task.fingerprint && !next.slides.some(slide => slide.id === task.target) && task.baseline.every(id => next.slides.some(slide => slide.id === id));
    if (task?.target) { const sample = next.slides.find(slide => slide.id === task.target); if (sample && JSON.stringify(sample) !== task.fingerprint) task.fingerprint = undefined; }
    state.deck = next;
    // Persist the actual deck with the old checkpoint before recording results.
    // A crash between the two files can then reconcile the outcome on resume.
    await persist();
    if (isGuideResultStep(step)) { await reconcileResult(); return; }
    if (step === 'nav-slides' && input.tab === 'slides') await advance('add', label);
    else if (add && task) {
      const slides = next.slides.filter(slide => slide.type === 'text' && !task.baseline.includes(slide.id));
      await showResult('add-result', { exercise: 'slide-add', operation: 'slide-added', sessionId: task.id, resourceId: slides[0].id,
        runId: state.runId!, deckId: next.id!, resourceIds: slides.map(slide => slide.id), slides, beforeCount: next.slides.length - slides.length, afterCount: next.slides.length });
    } else if (step === 'reorder' && task && succeeded) {
      await progress.recordExerciseResult({ exercise:'slide-reorder',operation:'slides-reordered',sessionId:task.id,resourceId:task.target! });
      await advance('select',label);
    } else if (step === 'select' && task?.target && input.selected.length === 1 && input.selected[0] === task.target) state.guide.step = 'delete';
    else if (remove && task) {
      const deleted = before.slides.find(slide => slide.id === task.target) ?? JSON.parse(task.fingerprint!);
      if (JSON.stringify(deleted) !== task.fingerprint) throw new Error('Modified deletion sample');
      await progress.recordExerciseResult({ exercise:'slide-delete',operation:'owned-slide-deleted',sessionId:task.id,resourceId:task.target! });
      await advance('nav-bible',label);
    }
    else if (step === 'image-select' && task?.target && input.selected.length === 1 && input.selected[0] === task.target) state.guide.step = 'image-tools';
    else if (step === 'image-fit' && task?.target && next.slides.find(slide => slide.id === task.target)?.styles?.objectFit === 'contain') state.guide.step = 'image-grayscale';
    else if (step === 'image-grayscale' && task && succeeded) {
      const edited = next.slides.find(slide => slide.id === task.target)!;
      await showResult('image-edit-result', { exercise: 'image-edit', operation: 'practice-image-edited', sessionId: task.id, resourceId: edited.id, runId: state.runId!, deckId: next.id!, resourceIds: [edited.id], slides: [edited], beforeCount: next.slides.length, afterCount: next.slides.length });
    }
    else if (step.startsWith('nav-')) {
      const page = step === 'nav-save' ? 'presentations' : step.slice(4);
      if (input.tab === page) await advance(guideSteps[guideSteps.indexOf(step) + 1], label);
    }
    else if (['bible-source','bible-import'].includes(step) && task?.importedBible && ui.bibleReady) state.guide.step = 'bible-book';
    else if (step === 'bible-source' && ui.sourceMenu) state.guide.step = 'bible-import';
    else if (step === 'bible-book' && ui.book === 1) state.guide.step = 'bible-chapter';
    else if (step === 'bible-chapter' && ui.chapter === 1 && ui.chapterChosen) state.guide.step = 'bible-verse';
    else if (step === 'bible-verse' && ui.verse) state.guide.step = 'bible-add';
    else if (step === 'media-menu' && ui.mediaMenu) state.guide.step = 'media-import';
    else if (step === 'media-import' && task?.importedMedia && ui.imageReady && ui.imageImported) state.guide.step = 'media-add';
    else if (step === 'countdown-duration' && ui.minutes === 2) state.guide.step = 'countdown-add';
    else if (['bible-add','media-add','hymns-add','countdown-add'].includes(step) && task && succeeded &&
      (step !== 'countdown-add' || next.slides.some(slide => { try { const seconds = JSON.parse(slide.content).totalSeconds; return slide.type === 'countdown' && !task.baseline.includes(slide.id) && seconds >= 120 && seconds < 180; } catch { return false; } }))) {
      const slides = next.slides.filter(slide => !task.baseline.includes(slide.id) && (task.exercise === 'bible' ? slide.type === 'text' : task.exercise === 'media'
        ? slide.type === 'image' && (() => { try { return path.resolve(fileURLToPath(slide.mediaUrl ?? '')) === path.resolve(media); } catch { return false; } })()
        : task.exercise === 'hymns' ? isPracticeHymnSlide(slide) : (() => { try { return slide.type === 'countdown' && JSON.parse(slide.content).totalSeconds >= 120 && JSON.parse(slide.content).totalSeconds < 180; } catch { return false; } })()));
      await showResult(guideSteps[guideSteps.indexOf(step) + 1] as GuideResultStep, { exercise: task.exercise, operation: exerciseOperation[task.exercise], sessionId: task.id,
        resourceId: slides[0].id, runId: state.runId!, deckId: next.id!, resourceIds: slides.map(slide => slide.id), slides, beforeCount: next.slides.length - slides.length, afterCount: next.slides.length });
    }
  }
  return {
    summary: async () => {
      assertNoLinks(file);
      try { const stored = JSON.parse(await fs.readFile(file, 'utf8')); if (![1,2].includes(stored.schemaVersion)) throw new Error('Unknown workspace'); return stored.schemaVersion === 2 ? validateGuide(stored.guide) : undefined; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    },
    summaryRun: async () => {
      assertNoLinks(file);
      try { const stored=JSON.parse(await fs.readFile(file,'utf8')); if(![1,2].includes(stored.schemaVersion))throw new Error('Unknown workspace'); return {runId:stored.runId,guide:stored.schemaVersion===2?validateGuide(stored.guide):undefined}; }
      catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {runId:undefined,guide:undefined};throw error;}
    },
    guide: (id: string, expected: GuideStep, action: 'resume' | 'next' | 'skip' | 'jump' | 'pause' | 'observe' | 'restart' | 'retry-result', input: GuideObservation, label: string, destination?: GuideStep) => serial(async () => {
      if (!state || state.guide.id !== id || state.guide.step !== expected) throw new Error('Expired guide step');
      const previous: PracticeWorkspace = JSON.parse(JSON.stringify(state));
      const previousCommit = committedState;
      try {
      if (typeof label !== 'string' || label.length > 1000) throw new Error('Invalid sample');
      if (!['resume','next','skip','jump','pause','observe','restart','retry-result'].includes(action)) throw new Error('Invalid guide action');
      if (action === 'retry-result') {
        if (!isGuideResultStep(state.guide.step)) throw new Error('Not a result stage');
        assertNoLinks(file); const stored = JSON.parse(await fs.readFile(file,'utf8')) as PracticeWorkspace;
        const result = stored.guide?.result;
        if (stored.runId !== state.runId || stored.guide.step !== state.guide.step || !validGuideResult(result,state.guide.step) || result.runId !== state.runId || result.deckId !== state.deck.id) throw new Error('Result unavailable');
        state.guide.result = result; await reconcileResult(); return JSON.parse(JSON.stringify(state));
      }
      if (action === 'observe') { await observeGuide(input, label); return await persist(); }
      if (action === 'pause') {
        if (!state.guide.paused) await observeGuide(input, label);
        else { const deck=validatePracticeDeck(input.deck); if(deck.id!==state.deck.id)throw new Error('Practice presentation changed');state.deck=deck; }
        state.guide.paused = true; if (state.active) state.active.paused = true;
        state.guide.id = randomUUID(); return await persist();
      }
      if (action === 'resume') {
        const next = validatePracticeDeck(input.deck);
        if (next.id !== state.deck.id || !Array.isArray(input.selected) || input.selected.some(id => typeof id !== 'string')) throw new Error('Invalid guide observation');
        state.guide.id = randomUUID(); state.guide.paused = false;
        if (state.active) { state.active.id = randomUUID(); state.active.paused = false; }
        await observeGuide(input, label);
        // Menus are transient DOM state. Reopen their trigger without replacing
        // the exercise baseline or replaying an import/add operation.
        if (state.guide.step === 'bible-import' && !input.ui?.sourceMenu) state.guide.step = 'bible-source';
        if (state.guide.step === 'media-import' && !input.ui?.mediaMenu || state.guide.step === 'media-add' && !input.ui?.imageReady) state.guide.step = 'media-menu';
        if (state.guide.step === 'welcome') await advance('presentations', label);
        return await persist();
      }
      if (action === 'restart') {
        if (!state.guide.paused && state.guide.step !== 'done') throw new Error('Pause before restarting');
        const deck=validatePracticeDeck(input.deck); if(deck.id!==state.deck.id)throw new Error('Practice presentation changed');
        const archived={...state,deck};
        const next:PracticeWorkspace={schemaVersion:2,runId:randomUUID(),guide:newGuide(),deck:{id:randomUUID(),name:deck.name,slides:[],sections:[]},active:null,checkpoints:{}};
        await progress.exclusive(async()=>{const current=await progress.read(); if(!current.ok)throw new Error('Progress unreadable');await restartPracticeRun(profile,archived,current.progress,next);}); state=next; return JSON.parse(JSON.stringify(state));
      }
      if (action === 'jump') {
        if (!state.guide.paused || !Object.values(guideChapters).includes(destination!)) throw new Error('Pause and select a chapter');
        const deck=validatePracticeDeck(input.deck);if(deck.id!==state.deck.id)throw new Error('Practice presentation changed');state.deck=deck;
        const from=guideSteps.indexOf(state.guide.step),to=guideSteps.indexOf(destination!);
        const skipped=to>from?guideSteps.slice(from,to):[];
        const taskSteps:Partial<Record<GuideStep,PracticeExercise>>={reorder:'slide-reorder','image-select':'image-edit',add:'slide-add',select:'slide-delete','bible-source':'bible','media-menu':'media','hymns-add':'hymns','countdown-duration':'countdown',save:'presentations'};
        for(const step of skipped){if(!state.guide.skipped.includes(step))state.guide.skipped.push(step);if(taskSteps[step])await progress.setExerciseStatus(taskSteps[step]!,'skipped');}
        if(to>from&&state.active)await progress.setExerciseStatus(state.active.exercise,'skipped');
        state.guide.id=randomUUID();state.guide.ui={};await advance(destination!,label);state.guide.paused=true;if(state.active)state.active.paused=true;
        return await persist();
      }
      if (state.guide.paused) throw new Error('Guide paused');
      if (action === 'next') {
        if (isGuideResultStep(state.guide.step)) {
          if (!validGuideResult(state.guide.result,state.guide.step)) throw new Error('Result unavailable');
          await reconcileResult();
        } else if (!guideNarrative(state.guide.step)) throw new Error('Outcome required');
        const deck = validatePracticeDeck(input.deck);
        if (deck.id !== state.deck.id) throw new Error('Practice presentation changed');
        state.deck = deck;
        const next = guideSteps[guideSteps.indexOf(state.guide.step) + 1]; if (!next) throw new Error('Outcome required');
        await advance(next, label); return await persist();
      }
      if (isGuideResultStep(state.guide.step)) throw new Error('A completed result cannot be skipped');
      const destinationIndex = guideSteps.indexOf(state.guide.step) + 1;
      if (destinationIndex < 0 || destinationIndex >= guideSteps.length) throw new Error('Invalid destination');
      const from = guideSteps.indexOf(state.guide.step);
      for (const skipped of guideSteps.slice(from, Math.max(from + 1, destinationIndex))) if (!state.guide.skipped.includes(skipped)) state.guide.skipped.push(skipped);
      if (state.active) await progress.setExerciseStatus(state.active.exercise, 'skipped');
      let next = guideSteps[destinationIndex];
      if (action === 'skip' && state.guide.step === 'add') next = 'select';
      if (action === 'skip' && state.guide.step === 'save') next = 'done';
      if (action === 'skip' && (next === 'delete' || next === 'delete-result')) { state.guide.skipped.push('delete'); next = 'nav-bible'; }
      const group = state.active?.exercise;
      const dependencies: Partial<Record<PracticeExercise, GuideStep>> = { 'slide-reorder':'select', 'image-edit':'nav-hymns', bible:'nav-media',media:'nav-hymns',hymns:'nav-countdown',countdown:'nav-screen' };
      if (action === 'skip' && group && dependencies[group]) {
        const end = guideSteps.indexOf(dependencies[group]!);
        for (const skipped of guideSteps.slice(from, end)) if (!state.guide.skipped.includes(skipped)) state.guide.skipped.push(skipped);
        next = dependencies[group]!;
      }
      state.guide.id = randomUUID();
      if (next === 'delete') { await advance('select', label); state.guide.step = 'select'; }
      else if (next.startsWith('bible-') && !['bible-intro','bible-source'].includes(next)) await advance('bible-source', label);
      else if (next.startsWith('media-') && !['media-intro','media-menu'].includes(next)) await advance('media-menu', label);
      else if (next === 'countdown-add') await advance('countdown-duration', label);
      else await advance(next, label);
      return await persist();
      } catch (error) { state = committedState !== previousCommit ? JSON.parse(JSON.stringify(committedState)) : previous; throw error; }
    }),
    read: (deck: unknown) => serial(async () => { await load(deck); return persist(); }),
    start: (exercise: PracticeExercise, deck: unknown, demoLabel: string) => serial(async () => {
      if (!practiceExercises.includes(exercise)) throw new Error('Unavailable exercise');
      if (typeof demoLabel !== 'string' || demoLabel.length > 1000) throw new Error('Invalid sample label');
      await load(deck);
      const next = validatePracticeDeck(deck);
      const checkpoints = { ...state?.checkpoints }; const runId=state!.runId;
      if (state?.active) checkpoints[state.active.exercise] = { ...state.active, paused: true };
      const checkpoint = checkpoints[exercise];
      if (checkpoint && checkpoint.deckId === next.id && (!checkpoint.target || next.slides.some(slide => slide.id === checkpoint.target && JSON.stringify(slide) === checkpoint.fingerprint))) {
        state = { schemaVersion: 2, runId, guide: state!.guide, deck: next, checkpoints, active: { ...checkpoint, id: randomUUID(), paused: false } };
        await progress.setExerciseStatus(exercise, 'inProgress');
        return persist();
      }
      const active = { id: randomUUID(), exercise, deckId: next.id, baseline: next.slides.map(slide => slide.id), paused: false };
      state = { schemaVersion: 2, runId, guide: state!.guide, deck: next, active, checkpoints };
      if (exercise === 'slide-delete') {
        const previous = next.slides.at(-1);
        const sectionId = previous?.sectionId ?? '__unassigned';
        const slide = { id: randomUUID(), type: 'text' as const, content: demoLabel, styles: { fontSize: 64, backgroundColor: '#000000', textColor: '#ffffff' },
          sectionId, section: { id: sectionId, title: previous?.section?.title ?? '' } };
        next.slides.push(slide);
        state.active = { ...active, target: slide.id, fingerprint: JSON.stringify(slide) };
      }
      await progress.setExerciseStatus(exercise, 'inProgress');
      return persist();
    }),
    observe: (id: string | null, deck: unknown) => serial(async () => {
      if (!state || (state.active?.id ?? null) !== id) return state;
      const next = validatePracticeDeck(deck);
      const success = exerciseSucceeded(state, next, media);
      const exercise = state.active?.exercise;
      if (next.id !== state.deck.id) throw new Error('Expired practice presentation');
      state.deck = next;
      await persist();
      if (success && exercise && state.active) {
        await progress.recordExerciseResult({ exercise, operation: exerciseOperation[exercise], sessionId: state.active.id, resourceId: state.active.target ?? next.slides.find(slide => !state!.active!.baseline.includes(slide.id))?.id ?? next.id });
        delete state.checkpoints?.[exercise]; state.active = null; await persist();
      }
      return JSON.parse(JSON.stringify(state));
    }),
    pause: (id: string, skip = false) => serial(async () => {
      if (state?.active?.id !== id) return state;
      if (skip) { await progress.setExerciseStatus(state.active.exercise, 'skipped'); delete state.checkpoints?.[state.active.exercise]; state.active = null; }
      else state.active.paused = true;
      return persist();
    }),
    resume: (id: string, deck: unknown) => serial(async () => {
      if (!state?.active || state.active.id !== id) throw new Error('Expired practice session');
      const next = validatePracticeDeck(deck);
      if (next.id !== state.deck.id) throw new Error('Practice presentation changed');
      state.deck = next; state.active.paused = false; state.active.id = randomUUID();
      return persist();
    }),
    sessionId: () => state?.active?.id,
    prepareSave: (id: string | undefined, preset: { name: string; presentation: unknown }) => serial(async () => {
      if (!state?.active || state.active.id !== id || state.active.paused || state.guide.step !== 'save') return;
      const deck = validatePracticeDeck(preset.presentation);
      if (deck.id !== state.deck.id || typeof preset.name !== 'string' || !preset.name.trim() || preset.name.length > 1000) throw new Error('Invalid save intent');
      state.active.saveIntent = { sessionId: state.active.id, name: preset.name, requestedAt: Date.now(), deck }; await persist();
    }),
    recoverSaved: (presets: { name: string; presentation: unknown; createdAt: number }[]) => serial(async () => {
      const intent = state?.active?.saveIntent;
      if (state?.guide.step === 'save' && state.active?.exercise === 'presentations' && intent && typeof intent.name === 'string' &&
        Number.isFinite(intent.requestedAt) && intent.requestedAt > 0) {
        const deck = validatePracticeDeck(intent.deck);
        if (deck.id !== state.deck.id) throw new Error('Invalid saved identity');
        const record = presets.find(preset => preset.name === intent.name && preset.createdAt >= intent.requestedAt && JSON.stringify(preset.presentation) === JSON.stringify(deck));
        if (record) { await savedResult(record); return persist(); }
      }
      return state ? JSON.parse(JSON.stringify(state)) as PracticeWorkspace : undefined;
    }),
    hasState: () => state!==null,
    closeReady: (id:string) => serial(async()=>{if(!state || state.guide.id!==id || !state.guide.paused)throw new Error('Save and pause before closing');await persist();}),
    saved: (deck: unknown, id?: string, preset?: { name: string; presentation: unknown; createdAt: number }) => serial(async () => {
      if (!state?.active || state.active.exercise !== 'presentations') return;
      const intent = state.active.saveIntent;
      const requestedSave = state.guide.step === 'save' && !!intent && intent.sessionId === id && !!preset && preset.name === intent.name &&
        preset.createdAt >= intent.requestedAt && JSON.stringify(preset.presentation) === JSON.stringify(intent.deck);
      if ((state.active.id !== id || state.active.paused) && !requestedSave) return;
      const saved = validatePracticeDeck(deck);
      // The saved payload is a verified successful preset operation. Name
      // trimming and edits newer than observation must not suppress that result.
      if (saved.id !== state.deck.id) return;
      if (state.guide.step === 'save' && (!state.guide.paused || requestedSave)) {
        if (!preset) throw new Error('Saved record required');
        const actual = validatePracticeDeck(preset.presentation);
        if (actual.id !== saved.id || JSON.stringify(actual) !== JSON.stringify(saved)) throw new Error('Saved record mismatch');
        await savedResult(preset);
        return persist();
      }
      await progress.recordExerciseResult({ exercise: 'presentations', operation: 'preset-saved', sessionId: state.active.id, resourceId: saved.id });
      delete state.checkpoints?.presentations; state.active = null; return persist();
    }),
    sampleMedia: () => serial(async () => {
      assertNoLinks(assets); assertNoLinks(media); await fs.mkdir(assets, { recursive: true });
      await fs.writeFile(media, '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#1e3a8a"/><circle cx="320" cy="180" r="90" fill="#fbbf24"/></svg>');
      if (state?.active?.exercise === 'media') { state.active.importedMedia = true; await persist(); }
      return media;
    }),
    sampleBible: (recordImport = true) => serial(async () => {
      assertNoLinks(assets); assertNoLinks(bible); await fs.mkdir(assets, { recursive: true });
      const content = '<?xml version="1.0"?><XMLBIBLE biblename="Practice Sample"><INFORMATION><title>Practice Sample</title><language>eng</language></INFORMATION><BIBLEBOOK bnumber="1" bname="Genesis" bsname="Gen"><CHAPTER cnumber="1"><VERS vnumber="1">' + sampleVerse + '</VERS></CHAPTER></BIBLEBOOK></XMLBIBLE>';
      await fs.writeFile(bible, content);
      if (recordImport && state?.active?.exercise === 'bible') { state.active.importedBible = true; await persist(); }
      return { content, path: bible };
    }),
    mediaPath: media,
  };
}
