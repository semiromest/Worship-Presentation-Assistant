const {test}=require('node:test');const assert=require('node:assert/strict');const {compare,summarizeMemory}=require('./reliability-math.cjs');
test('uncertain/noisy improvements do not pass the gate',()=>{
 assert.equal(compare([100,110,90,105,95],[110,90,105,95,100],[99,102,95,101,98],.05).decision,'inconclusive');
 assert.equal(compare([100,101,99,100,100],[100,100,101,99,100],[60,60,61,59,60]).decision,'pass');
 assert.equal(compare([100,101,99,100,100],[100,100,101,99,100],[140,140,141,139,140]).decision,'regression');
});
test('soak refuses missing recovery evidence',()=>assert.equal(summarizeMemory([]).decision,'insufficient-recovery-data'));
test('soak requires recovered preview resources and stable listeners',()=>{
 const samples=Array.from({length:72},(_,i)=>({elapsedMs:16*60000+i*5000,cycle:Math.floor(i/24),phase:'recovery',heapBytes:10*1024**2,privateBytes:100*1024**2,preview:{activeGenerations:0,queuedGenerations:0,active:0,pending:0,cacheEntries:0,retryEntries:0},mainIpcListeners:{total:10},rendererIpcListeners:{total:15},heavyWorkerProcesses:1,processes:[{type:'Browser',pid:1},{type:'GPU',pid:2},{type:'Utility',name:'presenter-heavy-worker',pid:3}]}));
 assert.equal(summarizeMemory(samples).decision,'pass');
 assert.equal(summarizeMemory(samples.map(s=>({...s,preview:null}))).decision,'insufficient-diagnostics');
 samples[30].preview.active=1;assert.equal(summarizeMemory(samples).decision,'investigate');
 samples[30].preview.active=0;samples.slice(24,48).forEach(s=>s.rendererIpcListeners.total++);assert.equal(summarizeMemory(samples).decision,'investigate');
 samples.slice(24,48).forEach(s=>s.rendererIpcListeners.total--);samples[40].processes[1].pid=9;assert.equal(summarizeMemory(samples).decision,'investigate');
});
test('previous slide cannot satisfy composed-frame color tolerance',()=>{
 const {frameColor}=require('./reliability-math.cjs');
 for(const count of [100,500])for(let i=0;i<count;i++)assert.ok(frameColor(i).some((value,c)=>Math.abs(value-frameColor((i+1)%count)[c])>2));
 assert.equal(new Set(Array.from({length:500},(_,i)=>frameColor(i).join(','))).size,500);
});
