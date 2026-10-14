import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPracticeWorkspace, readPracticeSavedPreset, sampleVerse, validateGuide, validGuideResult } from './practiceWorkspace';
import { createProgressStore } from './practiceProgress';
import { practiceHymns, guideResultSteps, type GuideStep, type PracticeTask } from '../shared/practice';
import type { Presentation } from '../renderer/types';

const seed: Presentation = { id:'deck',name:'Practice',slides:[{id:'keep',type:'text',content:'Keep'}] };
async function fixture() {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wpa-result-test-'));
  const progress=createProgressStore(dir);let engine=createPracticeWorkspace(dir,progress);let value=await engine.read(seed);
  const input=()=>({deck:value.deck,tab:'slides',selected:[] as string[]});
  const command=async(action:Parameters<typeof engine.guide>[2], destination?:GuideStep)=>value=await engine.guide(value.guide.id,value.guide.step,action,input(),'Sample',destination);
  const chapter=async(page:PracticeTask)=>{
    await command('pause');const entries={slides:'add',bible:'bible-intro',media:'media-intro',hymns:'hymns-intro',countdown:'countdown-intro',settings:'settings-intro'} as const;
    await command('jump',entries[page as keyof typeof entries]);await command('resume');
    if(page!=='slides')await command('next');
  };
  const observe=async(deck=value.deck,ui={},tab='slides',selected:string[]=[])=>value=await engine.guide(value.guide.id,value.guide.step,'observe',{deck,ui,tab,selected},'Sample');
  return {dir,progress,command,chapter,observe,get value(){return value;},get engine(){return engine;},
    reopen:async()=>{engine=createPracticeWorkspace(dir,progress);value=await engine.read(seed);return value;},
    cleanup:()=>fs.rm(dir,{recursive:true,force:true})};
}

test('all seven results are real, explicitly acknowledged, and their snapshots survive restart',async()=>{
  const f=await fixture();
  try {
    await f.chapter('slides');
    const added={...f.value.deck,slides:[...f.value.deck.slides,{id:'new',type:'text' as const,content:'Actual added text'}]};
    await f.observe(added);assert.equal(f.value.guide.step,'add-result');assert.equal(f.value.active,null);assert.equal(f.value.deck.slides.length,2);
    const proof=f.value.guide.result!;assert.equal(proof.slides[0].content,'Actual added text');assert.equal(validGuideResult(proof,'add-result'),true);
    assert.equal(validGuideResult({...proof,slides:[{...proof.slides[0],items:'oops'} as unknown as Presentation['slides'][number]]},'add-result'),false);
    assert.equal(validGuideResult({...proof,resourceIds:['wrong']},'add-result'),false);
    assert.equal(validGuideResult(proof,'delete-result'),false);
    const rev=(await f.progress.read());assert.ok(rev.ok);
    await f.observe();assert.equal(f.value.guide.step,'add-result');assert.deepEqual(await f.progress.read(),rev);
    await assert.rejects(f.command('skip'));
    await f.command('pause');await f.reopen();await f.command('resume');assert.deepEqual(f.value.guide.result,proof);
    await f.command('next');assert.equal(f.value.guide.step,'select');assert.equal(f.value.deck.slides.length,3);
    const target=f.value.active!.target!;await f.observe(f.value.deck,{},'slides',[target]);
    await f.observe({...f.value.deck,slides:f.value.deck.slides.filter(slide=>slide.id!==target)});
    assert.equal(f.value.guide.step,'delete-result');assert.equal(f.value.guide.result?.slides[0].content,'Sample');
    assert.equal(f.value.guide.result?.beforeCount,3);assert.equal(f.value.guide.result?.afterCount,2);assert.deepEqual(f.value.deck.slides.map(s=>s.id),['keep','new']);
    await f.command('next');assert.equal(f.value.guide.step,'nav-bible');
    await f.chapter('bible');await f.engine.sampleBible();await f.observe(f.value.deck,{bibleReady:true});
    await f.observe(f.value.deck,{book:1});await f.observe(f.value.deck,{chapter:1,chapterChosen:true});await f.observe(f.value.deck,{verse:true});
    await f.observe({...f.value.deck,slides:[...f.value.deck.slides,{id:'verse1',type:'text',content:'Genesis 1:1 '+sampleVerse},{id:'verse2',type:'text',content:'Second verse'}]});
    assert.equal(f.value.guide.step,'bible-result');assert.deepEqual(f.value.guide.result?.resourceIds,['verse1','verse2']);await f.command('next');
    await f.chapter('media');await f.observe(f.value.deck,{mediaMenu:true});const media=await f.engine.sampleMedia();await f.observe(f.value.deck,{imageReady:true,imageImported:true});
    await f.observe({...f.value.deck,slides:[...f.value.deck.slides,{id:'unrelated',type:'text',content:'Wrong resource'},{id:'image',type:'image',content:'',mediaUrl:pathToFileURL(media).href}]});
    assert.equal(f.value.guide.step,'media-result');assert.deepEqual(f.value.guide.result?.resourceIds,['image']);await f.command('next');
    await f.chapter('hymns');
    const hymn=practiceHymns.en;
    await f.observe({...f.value.deck,slides:[...f.value.deck.slides,{id:'hymn',type:'text',content:hymn.lyrics.split('\n\n')[0],partsMode:true,parts:hymn.lyrics.split('\n\n'),activePart:0,group:{id:'practice-hymn-group',title:hymn.title,part:1,parts:2,color:'#2563eb'}}]});
    assert.equal(f.value.guide.step,'hymns-result');assert.equal(f.value.guide.result?.slides[0].content,hymn.lyrics.split('\n\n')[0]);await f.command('next');await f.command('next');
    await f.chapter('countdown');await f.observe(f.value.deck,{minutes:2});
    const countdown={id:'countdown',type:'countdown' as const,content:JSON.stringify({minutes:2,seconds:0,totalSeconds:120})};
    await f.observe({...f.value.deck,slides:[...f.value.deck.slides,{...countdown,id:'wrong-countdown',content:JSON.stringify({minutes:5,totalSeconds:300})}]});assert.equal(f.value.guide.step,'countdown-add');
    await f.observe({...f.value.deck,slides:[...f.value.deck.slides,countdown]});assert.equal(f.value.guide.step,'countdown-result');assert.equal(f.value.guide.result?.resourceId,'countdown');await f.command('next');
    await f.chapter('settings');await f.observe(f.value.deck,{},'presentations');assert.equal(f.value.guide.step,'save');
    const saved=f.value.deck;const preset={name:'Actual library name',presentation:saved,createdAt:Date.now()};
    await f.engine.saved(saved,'stale',preset);assert.equal((await f.engine.read(seed)).guide.step,'save');
    await f.engine.saved(saved,f.value.active!.id,preset);await f.reopen();assert.equal(f.value.guide.step,'save-result');assert.equal(f.value.guide.result?.savedName,preset.name);
    await f.command('resume');await f.command('next');assert.equal(f.value.guide.step,'done');
    const status=await f.progress.read();assert.ok(status.ok);for(const exercise of Object.values(guideResultSteps).filter(exercise=>exercise!=='image-edit'))assert.equal(status.progress.exercises[exercise],'completed');
  }finally{await f.cleanup();}
});

test('persisted result reconciles interrupted progress write; malformed evidence never authorizes Continue',async()=>{
  const f=await fixture();
  try{
    await f.chapter('slides');
    const original=f.progress.recordExerciseResult;
    f.progress.recordExerciseResult=async()=>{throw new Error('Injected progress write failure');};
    await assert.rejects(f.observe({...f.value.deck,slides:[...f.value.deck.slides,{id:'added',type:'text',content:'Actual'}]}));
    const file=path.join(f.dir,'practice-workspace.json');const durable=JSON.parse(await fs.readFile(file,'utf8'));
    assert.equal(durable.guide.step,'add-result');assert.equal(durable.deck.slides.length,2);
    f.progress.recordExerciseResult=original;
    await assert.rejects(f.command('skip')); // stale recovery action cannot overwrite a committed result
    await f.reopen();assert.equal(f.value.guide.step,'add-result');const completed=await f.progress.read();assert.ok(completed.ok&&completed.progress.exercises['slide-add']==='completed');
    durable.guide.result.resourceIds=['wrong'];await fs.writeFile(file,JSON.stringify(durable));await f.reopen();assert.equal(f.value.guide.result,undefined);
    await f.command('resume');await assert.rejects(f.command('next'));await assert.rejects(f.command('retry-result'));assert.equal(f.value.deck.slides.length,2);
    const repaired={...durable,guide:{...durable.guide,result:{...durable.guide.result,resourceIds:['added']}}};await fs.writeFile(file,JSON.stringify(repaired));
    await f.command('retry-result');assert.equal((await f.engine.read(seed)).guide.result?.slides[0].content,'Actual');
    await f.command('pause');const oldId=f.value.guide.id;await f.command('restart');assert.equal(f.value.guide.result,undefined);assert.equal(f.value.deck.slides.length,0);
    await assert.rejects(f.engine.guide(oldId,'add-result','observe',{deck:durable.deck,tab:'slides',selected:[]},'Sample'));
  }finally{await f.cleanup();}
});

test('save crash recovery requires the exact new stored preset, retains newer deck edits, and never repeats save',async()=>{
  const f=await fixture();
  try{
    await f.chapter('settings');await f.observe(f.value.deck,{},'presentations');
    const preset={name:'Saved name',presentation:f.value.deck,createdAt:Date.now()+1000};
    await f.engine.prepareSave(f.value.active!.id,preset);
    await f.reopen();assert.equal(f.value.guide.step,'save');
    assert.equal((await f.engine.recoverSaved([{...preset,createdAt:1}]))?.guide.step,'save');
    assert.equal((await f.engine.recoverSaved([{...preset,name:'Another record'}]))?.guide.step,'save');
    const newer={...f.value.deck,name:'Newer unsaved name'};
    await f.command('resume');await f.observe(newer,{},'presentations');
    const result=await f.engine.recoverSaved([preset]);assert.equal(result?.guide.step,'save-result');assert.equal(result?.guide.result?.savedName,'Saved name');assert.equal(result?.deck.name,'Newer unsaved name');
    await f.reopen();assert.equal(f.value.guide.step,'save-result');await f.command('resume');await f.command('next');assert.equal(f.value.guide.step,'done');
  }finally{await f.cleanup();}
});

test('version two migration keeps positions, completion and skipped actions without retroactive results',()=>{
  for(const step of ['select','nav-media','done'] as const){const migrated=validateGuide({version:2,id:'old',step,paused:true,skipped:['add']});assert.equal(migrated.version,3);assert.equal(migrated.step,step);assert.equal(migrated.result,undefined);assert.deepEqual(migrated.skipped,['add']);}
});

test('verified pending save produces a paused result even after resume rotates the session',async()=>{
  for(const resume of [false,true]){
    const f=await fixture();
    try{
      await f.chapter('settings');await f.observe(f.value.deck,{},'presentations');
      const id=f.value.active!.id;const preset={name:'Pending save',presentation:f.value.deck,createdAt:Date.now()+1000};
      await f.engine.prepareSave(id,preset);await f.command('pause');if(resume)await f.command('resume');
      const result=await f.engine.saved(preset.presentation,id,preset);
      assert.equal(result?.guide.step,'save-result');assert.equal(result?.guide.paused,!resume);assert.equal(result?.guide.result?.savedName,preset.name);
      await f.reopen();await f.command('resume');await f.command('next');assert.equal(f.value.guide.step,'done');
    }finally{await f.cleanup();}
  }
});

test('save recovery reads only the actual atomic preset and leaves in-flight temporary files intact',async()=>{
  const f=await fixture();
  try{
    const directory=path.join(f.dir,'presets');await fs.mkdir(directory);
    const record={name:'Record',presentation:seed,createdAt:Date.now()};const file=path.join(directory,Buffer.from(record.name).toString('base64url')+'.json');
    await fs.writeFile(file+'.tmp',JSON.stringify(record));assert.equal(await readPracticeSavedPreset(f.dir,record.name),undefined);
    await fs.writeFile(file,JSON.stringify(record));assert.deepEqual(await readPracticeSavedPreset(f.dir,record.name),record);
    assert.equal(await fs.readFile(file+'.tmp','utf8'),JSON.stringify(record));
    await fs.writeFile(file,'{broken');await assert.rejects(readPracticeSavedPreset(f.dir,record.name));
  }finally{await f.cleanup();}
});

test('removing old slides while paused does not prevent a verified new addition',async()=>{
  const f=await fixture();
  try{
    await f.chapter('slides');await f.command('pause');
    await f.observe(); // paused observation leaves the saved state unchanged
    const empty={...f.value.deck,slides:[]};
    const resumed=await f.engine.guide(f.value.guide.id,f.value.guide.step,'resume',{deck:empty,tab:'slides',selected:[]},'Sample');
    const result=await f.engine.guide(resumed.guide.id,resumed.guide.step,'observe',{deck:{...empty,slides:[{id:'replacement',type:'text',content:'New'}]},tab:'slides',selected:[]},'Sample');
    assert.equal(result.guide.step,'add-result');assert.equal(result.guide.result?.beforeCount,0);assert.equal(result.guide.result?.afterCount,1);
  }finally{await f.cleanup();}
});

test('skipped final save ends the guide without creating an unavailable or successful result',async()=>{
  const f=await fixture();
  try{
    await f.chapter('settings');await f.observe(f.value.deck,{},'presentations');assert.equal(f.value.guide.step,'save');
    await f.command('skip');assert.equal(f.value.guide.step,'done');assert.equal(f.value.guide.result,undefined);
    const progress=await f.progress.read();assert.ok(progress.ok&&progress.progress.exercises.presentations==='skipped');
  }finally{await f.cleanup();}
});
