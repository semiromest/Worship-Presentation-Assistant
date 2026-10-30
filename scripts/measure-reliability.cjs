const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {compare}=require('../perf/reliability-math.cjs');
const root=path.resolve(__dirname,'..');
async function requireFreeSpace(bytes){const volume=await fs.statfs(root,{bigint:true});if(volume.bavail*volume.bsize<BigInt(bytes))throw new Error('Insufficient disk headroom for controlled measurements; old generated packages may be removed, preserve evidence');}
async function sourceHash(){const hash=crypto.createHash('sha256');async function walk(dir){for(const entry of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else if(entry.name!=='optimizationApproval.json'){hash.update(path.relative(root,file));hash.update(await fs.readFile(file));}}}await walk(path.join(root,'src'));hash.update(await fs.readFile(path.join(root,'vite.config.ts')));hash.update(await fs.readFile(path.join(root,'resources/fonts/manifest.json')));return hash.digest('hex');}
async function command(args,env,log){
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});let writes=Promise.resolve();
 for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{writes=writes.then(()=>fs.appendFile(log,chunk));});child.on('error',reject);child.on('exit',code=>void writes.then(()=>code===0?resolve():reject(new Error(`${args[0]} failed (${code}); see ${log}`))));});
}
function evaluate(groups){
 const select=(name,metric)=>groups[name].flatMap(report=>report.runs).map(run=>run.scenarios.find(scene=>scene.count===500)?.[metric]).filter(value=>typeof value==='number'&&Number.isFinite(value));
 const metric=(key,target)=>compare(select('baseline-a',key),select('baseline-b',key),select('candidate',key),target);
 const tasks=metric('previewLongTaskMs',.2),complete=metric('previewCompleteMs',0),frameMedian=metric('composedFrameMedianMs',0),frameP95=metric('composedFrameP95Ms',0);
 const guards=[complete,frameMedian,frameP95];
 let decision=tasks.decision==='pass'&&guards.every(g=>g.interval&&g.interval.low>=-g.baseline*.1)?'pass':'inconclusive';
 if(tasks.baseline===0||tasks.interval&&tasks.interval.high<tasks.baseline*.2||guards.some(g=>g.interval&&g.interval.high< -g.baseline*.1))decision='reject';
 return {decision,previewLongTasks:tasks,previewCompletion:complete,frameMedian,frameP95,recommendedVariant:decision==='pass'?'candidate':'baseline'};
}
async function main(){
 await requireFreeSpace(4*1024**3);
 const id=new Date().toISOString().replace(/[:.]/g,'-');const output=path.join(root,'.tmp','reliability-comparison-'+id);await fs.mkdir(output,{recursive:true});
 const fingerprint=await sourceHash();let packages={};
 const preparedIndex=process.argv.indexOf('--prepared');
 if(preparedIndex>=0){const prepared=JSON.parse(await fs.readFile(process.argv[preparedIndex+1],'utf8'));if(prepared.fingerprint!==fingerprint)throw new Error('Prepared packages do not match current sources');packages=prepared.packages;for(const executable of Object.values(packages))await fs.access(executable);}
 else for(const [name,value]of [['baseline','0'],['candidate','1']]){
  console.log(JSON.stringify({phase:'build',name,output}));
  await command([path.join(root,'node_modules/vite/bin/vite.js'),'build'],{VITE_PREVIEW_OPTIMIZATION:value,VITE_RELIABILITY_DIAGNOSTICS:'1'},path.join(output,'build-'+name+'.log'));
  if(await sourceHash()!==fingerprint)throw new Error('Application sources changed while preparing measurements');
  const packageDir=path.join(output,'package-'+name);
  await command([path.join(root,'scripts/package-reliability.cjs')],{WPA_RELIABILITY_OUTPUT:packageDir},path.join(output,'package-'+name+'.log'));
  const executable=path.join(packageDir,'win-unpacked','Worship Presentation Assistant.exe');await fs.access(executable);packages[name]=executable;
 }
 await fs.writeFile(path.join(output,'preparation.json'),JSON.stringify({fingerprint,packages,prepared:new Date().toISOString()},null,2));
 console.log(JSON.stringify({phase:'restore-default-build'}));
 await command([path.join(root,'node_modules/vite/bin/vite.js'),'build'],{VITE_PREVIEW_OPTIMIZATION:'',VITE_RELIABILITY_DIAGNOSTICS:''},path.join(output,'build-default.log'));
 for(const name of ['baseline','candidate']){
  console.log(JSON.stringify({phase:'desktop-smoke',name}));
  await command([path.join(root,'tests/reliability-smoke.cjs'),packages[name]],{},path.join(output,'smoke-'+name+'.log'));
  const evidence=path.join(output,'smoke-'+name);await fs.mkdir(evidence,{recursive:true});
  for(const file of ['result.json','settings.png','native-font.webp'])await fs.copyFile(path.join(root,'.tmp/reliability-e2e',file),path.join(evidence,file));
 }
 for(const name of ['baseline','candidate']){
  console.log(JSON.stringify({phase:'cancellation-preflight',name}));
  const folder=path.join(output,'preflight-'+name);
  await command([path.join(root,'perf/reliability-run.cjs'),'--exe',packages[name],'--out',folder,'--soak-minutes','0.75'],{},path.join(output,'preflight-'+name+'.log'));
  const report=JSON.parse(await fs.readFile(path.join(folder,'report.json'),'utf8')),recovery=report.samples.filter(sample=>sample.phase==='recovery');
  if(!report.finished||report.runs.some(run=>run.errors.length||run.samplingError)||!recovery.length||recovery.some(s=>!s.preview||s.preview.active||s.preview.pending||s.preview.cacheEntries||s.preview.retryEntries||s.preview.activeGenerations!==0||s.preview.queuedGenerations!==0))throw new Error('Cancelled preview work did not recover; do not start comparison');
 }
 const groups={'baseline-a':[],'baseline-b':[],candidate:[]};
 let result,fixtureIdentity;
 for(let iteration=0;iteration<30;iteration++){
  if(iteration===15&&result.decision!=='inconclusive')break;
  const order=iteration%2?['candidate','baseline-b','baseline-a']:['baseline-a','candidate','baseline-b'];
  for(const name of order){
   await requireFreeSpace(1024**3);
   if(await sourceHash()!==fingerprint)throw new Error('Application sources changed between measurements; restart with matched packages');
   const folder=path.join(output,name,'run-'+iteration);console.log(JSON.stringify({phase:'measure',iteration:iteration+1,name}));
   await command([path.join(root,'perf/reliability-run.cjs'),'--exe',packages[name==='candidate'?'candidate':'baseline'],'--out',folder,'--runs','1'],{},path.join(output,'measure-'+name+'-'+iteration+'.log'));
   const report=JSON.parse(await fs.readFile(path.join(folder,'report.json'),'utf8'));
   const fixtureKey=JSON.stringify(report.fixtures);if(!fixtureKey||!report.fixtures?.length)throw new Error('Missing fixture identity');if(fixtureIdentity&&fixtureKey!==fixtureIdentity)throw new Error('Measurement fixture changed');fixtureIdentity=fixtureKey;
   if(!report.finished||report.runs.some(run=>run.errors.length||run.samplingError)||report.previewOptimization!==(name==='candidate'?'candidate':'baseline'))throw new Error('Invalid measurement evidence');
   groups[name].push(report);
  }
  if(iteration===14||iteration===29){result=evaluate(groups);await fs.writeFile(path.join(output,'comparison.json'),JSON.stringify({fingerprint,packages,runsPerGroup:iteration+1,...result},null,2));console.log(JSON.stringify({phase:'comparison',runsPerGroup:iteration+1,...result}));}
 }
 for(const [name,reports]of Object.entries(groups))await fs.writeFile(path.join(output,name+'.json'),JSON.stringify({...reports[0],runs:reports.flatMap(report=>report.runs),samples:[],finished:new Date().toISOString()},null,2));
 if(await sourceHash()!==fingerprint)throw new Error('Application sources changed during measurement; do not approve optimization');
 console.log(JSON.stringify({phase:'soak',variant:result.recommendedVariant,minutes:120}));
 await command([path.join(root,'perf/reliability-run.cjs'),'--exe',packages[result.recommendedVariant],'--out',path.join(output,'soak'),'--soak-minutes','120'],{},path.join(output,'soak.log'));
 const soak=JSON.parse(await fs.readFile(path.join(output,'soak/report.json'),'utf8'));
 const validSoak=!!soak.finished&&soak.mode==='soak'&&soak.protocol==='reliability-v6-nofocus-capture-mixed-color-v1'&&soak.previewOptimization===result.recommendedVariant&&soak.durationMs>=120*60000&&soak.runs.length>0&&!soak.runs.some(run=>run.errors.length||run.samplingError)&&soak.memory?.decision==='pass';
 const unchanged=await sourceHash()===fingerprint;
 const approvalEligible=result.decision==='pass'&&validSoak&&unchanged;
 const final={fingerprint,comparison:result,soak:soak.memory,validSoak,unchanged,approvalEligible,decision:approvalEligible?'pass':'not-approved',finished:soak.finished,output};
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify(final,null,2));console.log(JSON.stringify({phase:'finished',...final}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
