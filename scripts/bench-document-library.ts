import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { documentSignature, sameDocument } from '../src/renderer/documentFingerprint';
import { createPresetStore } from '../src/main/presetStore';
import type { Presentation } from '../src/shared/presentation';
const quantile = (values: number[], q: number) => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*q)-1];
const stats = (values: number[]) => ({ medianMs: quantile(values,.5), p95Ms: quantile(values,.95) });
const oldSignature = (presentation: Presentation) => {
  const document = { ...presentation }; delete document.liveIndex; delete document.liveSlideId; delete document.zoom;
  return JSON.stringify({ ...document, slides: presentation.slides.map(slide => {
    const rest = { ...slide }; delete rest.activePart;
    return slide.partsMode && slide.parts?.length ? { ...rest, content: slide.parts.join('\n') } : rest;
  }) });
};
async function main() {
  const argument = process.argv.indexOf('--baseline');
  if(argument<0) throw Error('Use --baseline PATH to the pre-change presetStore.ts (adjust its perf import to the current source).');
  const baselineModule = await import(pathToFileURL(path.resolve(process.argv[argument+1])).href);
  const baselineStore = baselineModule.createPresetStore ?? baselineModule.default.createPresetStore;
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'wpa-library-bench-'));
  try {
    const deck: Presentation = { id:'bench',name:'Bench',slides:Array.from({length:1000},(_,i)=>({id:String(i),type:'text',content:'A'.repeat(4096)})) };
    const oldBase=oldSignature(deck),newBase=documentSignature(deck),oldTimes:number[]=[],newTimes:number[]=[];
    for(let i=0;i<33;i++) {
      const edited={...deck,slides:deck.slides.map((slide,index)=>index===i?{...slide,content:'Edit '+i}:slide)};
      let start=performance.now();if(oldSignature(edited)===oldBase)throw Error('Old comparison failed');if(i>=3)oldTimes.push(performance.now()-start);
      start=performance.now();if(sameDocument(newBase,documentSignature(edited)))throw Error('New comparison failed');if(i>=3)newTimes.push(performance.now()-start);
    }
    const directory=path.join(root,'presets');await fs.mkdir(directory);
    for(let i=0;i<150;i++) {
      const name='Saved '+i;
      const item={name,createdAt:Date.now(),presentation:{...deck,id:String(i),slides:deck.slides.slice(0,150).map(slide=>({...slide,content:'A'.repeat(512)}))}};
      await fs.writeFile(path.join(directory,Buffer.from(name).toString('base64url')+'.json'),JSON.stringify(item));
    }
    // Migration/index preparation is deliberately excluded and reported separately.
    const migrationStart=performance.now();await createPresetStore(root).catalog.list();const indexBuildMs=performance.now()-migrationStart;
    const oldList:number[]=[],newList:number[]=[];let oldBytes=0,newBytes=0;
    for(let i=0;i<33;i++) {
      let start=performance.now();const old=await baselineStore(root).readPresets();if(i>=3)oldList.push(performance.now()-start);oldBytes=Buffer.byteLength(JSON.stringify(old));
      const candidate=createPresetStore(root);start=performance.now();const current=await candidate.catalog.list();if(i>=3)newList.push(performance.now()-start);newBytes=Buffer.byteLength(JSON.stringify(current));
      if(current.length!==150||candidate.catalog.diagnostics().payloadReads!==0)throw Error('Metadata path read a full payload');
    }
    const report={protocol:'document-library-v1',samples:30,fixture:{slides:1000,charactersPerSlide:4096,presets:150,slidesPerPreset:150},
      documentSingleSlideEdit:{before:stats(oldTimes),after:stats(newTimes)},libraryFreshStoreWarmDisk:{before:stats(oldList),after:stats(newList),beforeJsonBytes:oldBytes,afterJsonBytes:newBytes,indexBuildMs},
      limits:['Synthetic component benchmark, not whole-app startup.','Fresh store instances in one Node process; OS disk cache not flushed.','First index build is a one-time full scan.']};
    await fs.mkdir('.tmp',{recursive:true});await fs.writeFile('.tmp/document-library-benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  } finally { if(path.dirname(root)===path.resolve(os.tmpdir())&&path.basename(root).startsWith('wpa-library-bench-'))await fs.rm(root,{recursive:true,force:true}); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
