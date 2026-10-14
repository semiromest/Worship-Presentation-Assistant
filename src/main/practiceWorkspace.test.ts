import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createPracticeWorkspace, exerciseSucceeded, sampleVerse, validateGuide } from './practiceWorkspace';
import { createProgressStore, parseProgress } from './practiceProgress';
import type { Presentation } from '../renderer/types';
import { guideChapters, practiceTasks } from '../shared/practice';
import { recoverPracticeReset } from './practiceReset';
import { mergePracticeObservation } from '../shared/practiceMerge';
const seed = { id: 'practice', name: 'Practice', slides: [{ id: 'keep', type: 'text', content: 'Keep me' }] } as Presentation;
test('delayed observation preserves later edits and adds coordinator sample without resurrecting removed slides',()=>{
 const server={...seed,slides:[...seed.slides,{id:'sample',type:'text' as const,content:'Sample'}]};
 const current={...seed,name:'Renamed later',slides:[{...seed.slides[0],content:'Changed later'},{id:'newer',type:'text' as const,content:'Added later'}]};
 const merged=mergePracticeObservation(seed,server,current);assert.equal(merged.name,current.name);assert.deepEqual(merged.slides.map(s=>s.id),['keep','newer','sample']);assert.equal(merged.slides[0].content,'Changed later');
 assert.deepEqual(mergePracticeObservation(seed,server,{...seed,slides:[]}).slides.map(s=>s.id),['sample']);
});
test('paused chapter destinations work, intermediate steps are denied, and backward visits keep results', async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wpa-workspace-test-'));
 try{
  const progress=createProgressStore(dir),engine=createPracticeWorkspace(dir,progress);let value=await engine.read(seed);
  const input=()=>({deck:value.deck,tab:'slides',selected:[]});
  await assert.rejects(engine.guide(value.guide.id,value.guide.step,'jump',input(),'Sample','select'));
  for(const page of practiceTasks){value=await engine.guide(value.guide.id,value.guide.step,'jump',input(),'Sample',guideChapters[page]);assert.equal(value.guide.step,guideChapters[page]);assert.equal(value.guide.paused,true);assert.deepEqual(value.deck.slides,seed.slides);}
  value=await engine.guide(value.guide.id,value.guide.step,'jump',input(),'Sample','add');
  value=await engine.guide(value.guide.id,value.guide.step,'resume',input(),'Sample');
  await assert.rejects(engine.guide(value.guide.id,value.guide.step,'jump',input(),'Sample','presentations'));
  const deck={...value.deck,slides:[...value.deck.slides,{id:'added',type:'text' as const,content:'Keep'}]};
  value=await engine.guide(value.guide.id,value.guide.step,'observe',{...input(),deck},'Sample');
  value=await engine.guide(value.guide.id,value.guide.step,'pause',input(),'Sample');
  value=await engine.guide(value.guide.id,value.guide.step,'jump',input(),'Sample','presentations');
  const result=await progress.read();assert.ok(result.ok&&result.progress.exercises['slide-add']==='completed');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('restart archives verified work, resets progress, rejects late deck results and keeps old state on archive failure',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wpa-workspace-test-'));
 try{
  const progress=createProgressStore(dir),engine=createPracticeWorkspace(dir,progress);let value=await engine.read(seed);
  const old=value;
  await fs.writeFile(path.join(dir,'practice-archives'),'blocked');
  await assert.rejects(engine.guide(value.guide.id,value.guide.step,'restart',{deck:value.deck,tab:'slides',selected:[]},'Sample'));
  assert.deepEqual((await engine.read(seed)).deck,seed);await fs.rm(path.join(dir,'practice-archives'));
  value=await engine.guide(value.guide.id,value.guide.step,'restart',{deck:value.deck,tab:'slides',selected:[]},'Sample');
  assert.notEqual(value.runId,old.runId);assert.notEqual(value.deck.id,seed.id);assert.equal(value.deck.slides.length,0);assert.equal(value.guide.step,'welcome');assert.equal(value.guide.paused,true);
  await assert.rejects(engine.observe(null,old.deck));
  const files=await fs.readdir(path.join(dir,'practice-archives'));assert.equal(files.length,1);
  const archive=JSON.parse(await fs.readFile(path.join(dir,'practice-archives',files[0]),'utf8'));assert.deepEqual(archive.workspace.deck,seed);
  const status=await progress.read();assert.ok(status.ok&&status.progress.runId===value.runId&&Object.keys(status.progress.exercises).length===0);
  await assert.rejects(engine.guide(old.guide.id,old.guide.step,'observe',{deck:old.deck,tab:'slides',selected:[]},'Sample'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('durable restart journal recovers both records and immutable archive after process loss',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wpa-workspace-test-'));
 try{
  const progress=createProgressStore(dir),engine=createPracticeWorkspace(dir,progress);const previous=await engine.read(seed);const read=await progress.read();if(!read.ok)throw new Error('Unreadable');
  const next={...previous,runId:'new-run',deck:{...seed,id:'new-deck',slides:[]},guide:{...previous.guide,id:'new-guide'}};
  const nextProgress={schemaVersion:2,runId:'new-run',revision:read.progress.revision+1,tasks:{},exercises:{}};
  const journal={version:1,archive:'1700000000000-00000000-0000-0000-0000-000000000000.json',createdAt:new Date().toISOString(),previous,previousProgress:read.progress,next,nextProgress};
  await fs.writeFile(path.join(dir,'practice-reset.json'),JSON.stringify(journal));
  await fs.writeFile(path.join(dir,'practice-workspace.json'),JSON.stringify(next)); // crash between the two replacements
  await recoverPracticeReset(dir);
  assert.equal((await createPracticeWorkspace(dir,progress).read(seed)).runId,'new-run');
  const status=await progress.read();assert.ok(status.ok&&status.progress.runId==='new-run');
  assert.equal(await recoverPracticeReset(dir),null);assert.equal((await fs.readdir(path.join(dir,'practice-archives'))).length,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('completed first delivery migrates to Bible without replaying slide tasks', () => {
  const guide = validateGuide({ version: 1, id: 'old', step: 'done', paused: true, skipped: ['add'] });
  assert.equal(guide.version, 3); assert.equal(guide.step, 'nav-bible'); assert.deepEqual(guide.skipped, ['add']);
});

test('expanded guide requires actual sample results, resumes transient menus and skips dependent steps', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-workspace-test-'));
  try {
    const progress = createProgressStore(dir); const engine = createPracticeWorkspace(dir, progress);
    let value = await engine.read(seed);
    const command = async (action: 'resume'|'observe'|'jump'|'pause'|'skip'|'next', ui = {}, destination?: typeof value.guide.step, deck = value.deck) => {
      if(action==='jump') {
        value=await engine.guide(value.guide.id,value.guide.step,'pause',{deck,tab:'bible',selected:[],ui},'Sample');
        const entry=destination==='bible-source'?'bible-intro':destination==='media-menu'?'media-intro':'settings-intro';
        value=await engine.guide(value.guide.id,value.guide.step,'jump',{deck:value.deck,tab:'bible',selected:[],ui:{}},'Sample',entry);
        value=await engine.guide(value.guide.id,value.guide.step,'resume',{deck:value.deck,tab:'bible',selected:[],ui:{}},'Sample');
        value=await engine.guide(value.guide.id,value.guide.step,'next',{deck:value.deck,tab:'bible',selected:[],ui:{}},'Sample');
        if(destination==='save')value=await engine.guide(value.guide.id,value.guide.step,'observe',{deck:value.deck,tab:'presentations',selected:[],ui:{}},'Sample');
        return;
      }
      value = await engine.guide(value.guide.id, value.guide.step, action, { deck, tab: 'bible', selected: [], ui }, 'Sample', destination);
    };
    await command('resume'); await command('jump', {}, 'bible-source');
    await assert.rejects(engine.guide(value.guide.id, value.guide.step, 'next', {deck:value.deck,tab:'bible',selected:[]}, 'Sample'));
    await engine.sampleBible(false); // Startup source restoration is not a new import.
    await command('observe', { bibleReady: true }); assert.equal(value.guide.step, 'bible-source');
    await command('observe', { sourceMenu:true }); assert.equal(value.guide.step, 'bible-import');
    const baseline = value.active!.baseline;
    await command('pause'); await command('resume', { sourceMenu:false }); assert.equal(value.guide.step,'bible-source'); assert.deepEqual(value.active!.baseline, baseline);
    await engine.sampleBible(); await command('observe', { bibleReady:true }); assert.equal(value.guide.step,'bible-book');
    await command('observe', {book:1}); await command('observe', {chapter:1,chapterChosen:true}); await command('observe', {verse:true});
    assert.equal(value.guide.step,'bible-add'); await command('observe'); assert.equal(value.guide.step,'bible-add');
    await command('observe', {}, undefined, {...value.deck,slides:[...value.deck.slides,{id:'verse',type:'text',content:sampleVerse}]});
    assert.equal(value.guide.step,'bible-result'); await command('next'); assert.equal(value.guide.step,'nav-media');
    await command('jump', {}, 'media-menu'); await command('observe', {mediaMenu:true}); await command('pause'); await command('resume', {mediaMenu:false});
    assert.equal(value.guide.step,'media-menu'); await command('skip'); assert.equal(value.guide.step,'nav-hymns');
    assert.ok(value.guide.skipped.includes('media-add'));
    await command('jump', {}, 'save'); await engine.saved(value.deck, 'stale'); assert.equal((await engine.read(seed)).guide.step,'save');
    await engine.saved(value.deck, value.active!.id, {name:'Library record',presentation:value.deck,createdAt:Date.now()}); value=await engine.read(seed); assert.equal(value.guide.step,'save-result'); assert.equal(value.guide.result?.savedName,'Library record'); await command('resume'); await command('next'); assert.equal(value.guide.step,'done');
    const result=await progress.read(); assert.ok(result.ok && result.progress.exercises.bible==='completed' && result.progress.exercises.media==='skipped' && result.progress.exercises.presentations==='completed');
  } finally { await fs.rm(dir, { recursive:true,force:true }); }
});
test('independent exercises detect outcomes, preserve changes, skip and ignore stale sessions', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-workspace-test-'));
  try {
    const progress = createProgressStore(dir); const engine = createPracticeWorkspace(dir, progress);
    await engine.read(seed);
    const add = await engine.start('slide-add', seed, 'Delete sample');
    await engine.observe(add.active!.id, seed);
    assert.equal((await progress.read()).ok, true);
    const next = { ...seed, slides: [...seed.slides, { id: 'added', type: 'text' as const, content: 'User content' }] };
    const result = await engine.observe(add.active!.id, next);
    assert.equal(result?.active, null);
    const deletion = await engine.start('slide-delete', next, 'Delete sample');
    assert.deepEqual(deletion.deck.slides.slice(0, 2), next.slides);
    await engine.pause(deletion.active!.id);
    const resumed = await engine.resume(deletion.active!.id, deletion.deck);
    assert.equal(resumed.active?.target, deletion.active?.target);
    assert.equal(resumed.deck.slides.length, deletion.deck.slides.length);
    await engine.start('countdown', resumed.deck, 'Delete sample');
    const switchedBack = await engine.start('slide-delete', resumed.deck, 'Delete sample');
    assert.equal(switchedBack.active?.target, resumed.active?.target);
    assert.equal(switchedBack.deck.slides.length, resumed.deck.slides.length);
    assert.equal(exerciseSucceeded(deletion, { ...deletion.deck, slides: deletion.deck.slides.filter(s => s.id !== 'keep') }, ''), false);
    const removed = { ...deletion.deck, slides: deletion.deck.slides.filter(s => s.id !== deletion.active!.target) };
    await engine.observe(switchedBack.active!.id, removed);
    assert.deepEqual(removed.slides, next.slides);
    const media = await engine.start('media', removed, 'Delete sample');
    await engine.pause(media.active!.id, true);
    await engine.observe(media.active!.id, { ...removed, slides: [] });
    const reopened = await createPracticeWorkspace(dir, progress).read(seed);
    assert.deepEqual(reopened.deck, removed);
    const state = await progress.read(); if (!state.ok) throw new Error('Unreadable');
    assert.equal(state.progress.tasks.slides, 'completed'); assert.equal(state.progress.exercises.media, 'skipped');
    assert.equal(state.progress.schemaVersion, 2);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('samples, actual save result, crash resume, migration and malformed input', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-workspace-test-'));
  try {
    const progress = createProgressStore(dir); const engine = createPracticeWorkspace(dir, progress);
    await engine.read(seed);
    let task = await engine.start('bible', seed, 'demo');
    const xml = await engine.sampleBible(); assert.ok(xml.content.includes(sampleVerse));
    const bibleDeck = { ...seed, slides: [...seed.slides, { id: 'verse', type: 'text' as const, content: sampleVerse }] };
    await engine.observe(task.active!.id, bibleDeck);
    task = await engine.start('media', bibleDeck, 'demo');
    const image = await engine.sampleMedia();
    const mediaDeck = { ...bibleDeck, slides: [...bibleDeck.slides, { id: 'image', type: 'image' as const, content: '', mediaUrl: pathToFileURL(image).href }] };
    await engine.observe(task.active!.id, mediaDeck);
    task = await engine.start('presentations', mediaDeck, 'demo');
    await engine.pause(task.active!.id);
    await engine.saved(mediaDeck, task.active!.id);
    assert.equal((await engine.read(mediaDeck)).active?.paused, true);
    task = await engine.resume(task.active!.id, mediaDeck);
    await engine.saved(mediaDeck, 'old-session');
    assert.equal((await engine.read(mediaDeck)).active?.exercise, 'presentations');
    await engine.saved({ ...mediaDeck, name: 'Trimmed name' }, task.active!.id);
    assert.equal((await engine.read(mediaDeck)).active, null);
    task = await engine.start('countdown', mediaDeck, 'demo');
    const reopened = await createPracticeWorkspace(dir, progress).read(seed);
    assert.equal(reopened.active?.paused, true); assert.deepEqual(reopened.deck, mediaDeck);
    assert.equal(parseProgress('{"schemaVersion":1,"revision":7,"tasks":{"presentations":"completed"}}').tasks.presentations, 'completed');
    await assert.rejects(engine.start('calendar' as 'media', seed, 'demo'));
    await assert.rejects(engine.observe(task.active!.id, { id: 'bad', slides: [null] }));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});


test('guided sequence requires actual outcomes, rejects stale steps and resumes without duplicate samples', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-workspace-test-'));
  try {
    const progress = createProgressStore(dir); let engine = createPracticeWorkspace(dir, progress);
    let value = await engine.read(seed);
    const input = (deck = value.deck, tab = 'presentations', selected: string[] = []) => ({ deck, tab, selected });
    const command = async (action: 'resume' | 'next' | 'observe' | 'pause' | 'skip', data = input()) => {
      value = await engine.guide(value.guide.id, value.guide.step, action, data, 'Sample'); return value;
    };
    await command('resume'); assert.equal(value.guide.step, 'presentations');
    await command('next'); await command('next'); assert.equal(value.guide.step, 'nav-slides');
    await command('observe'); assert.equal(value.guide.step, 'nav-slides');
    await command('observe', input(value.deck, 'slides')); assert.equal(value.guide.step, 'add');
    await assert.rejects(command('next'));
    const id = value.guide.id;
    const next = { ...value.deck, slides: [...value.deck.slides, { id: 'added-guided', type: 'text' as const, content: 'Added' }] };
    await command('observe', input(next, 'slides')); assert.equal(value.guide.step, 'add-result'); assert.equal(value.deck.slides.length,2); await command('next'); assert.equal(value.guide.step,'select');
    const target = value.active!.target;
    assert.equal(value.deck.slides.length, 3);
    await command('pause', input(value.deck, 'slides'));
    await assert.rejects(engine.guide(id, 'select', 'observe', input(value.deck, 'slides'), 'Sample'));
    engine = createPracticeWorkspace(dir, progress); value = await engine.read(seed);
    assert.equal(value.guide.paused, true); await command('resume', input(value.deck, 'slides'));
    assert.equal(value.active!.target, target); assert.equal(value.deck.slides.length, 3);
    await command('observe', input(value.deck, 'slides', [target!])); assert.equal(value.guide.step, 'delete');
    const removed = { ...value.deck, slides: value.deck.slides.filter(slide => slide.id !== target) };
    await command('observe', input(removed, 'slides', [])); assert.equal(value.guide.step, 'delete-result'); assert.equal(value.guide.result?.slides[0].id,target); await command('next'); assert.equal(value.guide.step,'nav-bible');
    assert.deepEqual(value.deck.slides.map(slide => slide.id), ['keep','added-guided']);
    assert.equal(value.guide.skipped.length, 0);
    const status = await progress.read(); assert.ok(status.ok && status.progress.exercises['slide-delete'] === 'completed');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('guided migration preserves history; jumps and skips never complete exercises', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wpa-workspace-test-'));
  try {
    await fs.writeFile(path.join(dir,'practice-workspace.json'), JSON.stringify({ schemaVersion: 1, deck: seed, active: null }));
    const progress = createProgressStore(dir); const engine = createPracticeWorkspace(dir, progress);
    let value = await engine.read(seed); assert.equal(value.schemaVersion, 2); assert.deepEqual(value.deck, seed);
    const input = () => ({ deck: value.deck, tab: 'slides', selected: [] });
    value = await engine.guide(value.guide.id, value.guide.step, 'resume', input(), 'Sample');
    value = await engine.guide(value.guide.id, value.guide.step, 'pause', input(), 'Sample');
    value = await engine.guide(value.guide.id, value.guide.step, 'jump', input(), 'Sample', 'add');
    value = await engine.guide(value.guide.id, value.guide.step, 'resume', input(), 'Sample');
    value = await engine.guide(value.guide.id, value.guide.step, 'skip', input(), 'Sample');
    const target = value.active!.target;
    value = await engine.guide(value.guide.id, value.guide.step, 'skip', input(), 'Sample');
    assert.equal(value.guide.step, 'nav-bible'); assert.ok(value.guide.skipped.includes('select') && value.guide.skipped.includes('delete'));
    assert.ok(value.deck.slides.some(slide => slide.id === target));
    const state = await progress.read(); assert.ok(state.ok && state.progress.exercises['slide-delete'] === 'skipped');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});


test('resume validates before rotating ID and reconciles interrupted deck/result writes', async () => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wpa-workspace-test-'));
 try {
  const progress=createProgressStore(dir);let engine=createPracticeWorkspace(dir,progress);let value=await engine.read(seed);
  const input=(deck=value.deck)=>({deck,tab:'slides',selected:[]});
  value=await engine.guide(value.guide.id,value.guide.step,'resume',input(),'Sample');
  value=await engine.guide(value.guide.id,value.guide.step,'pause',input(),'Sample');
  value=await engine.guide(value.guide.id,value.guide.step,'jump',input(),'Sample','add');
  value=await engine.guide(value.guide.id,value.guide.step,'resume',input(),'Sample');
  value=await engine.guide(value.guide.id,value.guide.step,'pause',input(),'Sample');
  await assert.rejects(engine.guide(value.guide.id,value.guide.step,'resume',input({...value.deck,id:'different'}),'Sample'));
  const file=path.join(dir,'practice-workspace.json');
  await fs.rename(file,file+'.backup'); await fs.mkdir(file);
  await assert.rejects(engine.guide(value.guide.id,value.guide.step,'resume',input(),'Sample'));
  await fs.rmdir(file); await fs.rename(file+'.backup',file);
  value=await engine.guide(value.guide.id,value.guide.step,'resume',input(),'Sample');assert.equal(value.guide.step,'add');
  // Crash after deck persistence, before result/next checkpoint persistence.
  value.deck.slides.push({id:'crash-added',type:'text',content:'Keep this'} as Presentation['slides'][number]);
  await fs.writeFile(path.join(dir,'practice-workspace.json'),JSON.stringify(value));
  engine=createPracticeWorkspace(dir,progress);value=await engine.read(seed);
  value=await engine.guide(value.guide.id,value.guide.step,'resume',input(),'Sample');assert.equal(value.guide.step,'add-result');value=await engine.guide(value.guide.id,value.guide.step,'next',input(),'Sample');assert.equal(value.guide.step,'select');
  const sample=value.active!.target;
  value=await engine.guide(value.guide.id,value.guide.step,'observe',{...input(),selected:[sample!]},'Sample');assert.equal(value.guide.step,'delete');
  value.deck.slides=value.deck.slides.filter(slide=>slide.id!==sample);
  await fs.writeFile(path.join(dir,'practice-workspace.json'),JSON.stringify(value));
  engine=createPracticeWorkspace(dir,progress);value=await engine.read(seed);
  value=await engine.guide(value.guide.id,value.guide.step,'resume',input(),'Sample');assert.equal(value.guide.step,'delete-result');value=await engine.guide(value.guide.id,value.guide.step,'next',input(),'Sample');assert.equal(value.guide.step,'nav-bible');
  assert.deepEqual(value.deck.slides.map(slide=>slide.id),['keep','crash-added']);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
