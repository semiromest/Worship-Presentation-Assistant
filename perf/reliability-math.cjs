const quantile = (values, p) => { const sorted = [...values].sort((a,b) => a-b); if (!sorted.length) throw new Error('Empty sample'); return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]; };
const median = values => quantile(values, .5);
const frameColor = index => [32+(index*73)%192,32+(index*47+Math.floor(index/192)*67)%192,32+(index*131)%192];
function random(seed = 1729) { return () => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed / 4294967296; }; }
function bootstrap(values, statistic = median, repetitions = 5000) {
  const rng = random(), estimates = [];
  for (let i=0;i<repetitions;i++) estimates.push(statistic(values.map(() => values[Math.floor(rng()*values.length)])));
  return { low: quantile(estimates,.025), high: quantile(estimates,.975) };
}
function compare(baselineA, baselineB, candidate, requiredImprovement = .2) {
  if (Math.min(baselineA.length,baselineB.length,candidate.length) < 5) return { decision:'insufficient-runs' };
  const base = [...baselineA,...baselineB], rng = random(), draws=[];
  const resample = values => values.map(() => values[Math.floor(rng()*values.length)]);
  const center = median(base), noiseDraws=[];
  for(let i=0;i<5000;i++)noiseDraws.push(Math.abs(median(resample(baselineA))-median(resample(baselineB))));
  const noise=quantile(noiseDraws,.95);
  for(let i=0;i<5000;i++) draws.push(median(resample(base))-median(resample(candidate)));
  const interval={low:quantile(draws,.025),high:quantile(draws,.975)}, gain=center-median(candidate);
  return { baseline: center, candidate: median(candidate), improvement: center ? gain/center : 0, baselineVariation: noise, interval, decision: interval.low>0 && gain>noise && gain>=center*requiredImprovement ? 'pass' : interval.high<0 && -gain>center*.1 ? 'regression' : 'inconclusive' };
}
function summarizeMemory(samples) {
  const stable=samples.filter(sample=>sample.elapsedMs>=15*60*1000 && sample.phase==='recovery');
  if(stable.length<4) return {decision:'insufficient-recovery-data'};
  const windows=new Map();for(const sample of stable){const key=sample.cycle;const group=windows.get(key)||[];group.push(sample);windows.set(key,group);}
  // Compare equal two-minute recovery windows after the 15-minute warmup.
  const groups=[...windows.values()].filter(group=>group.length>=24).map(group=>group.slice(-24));if(groups.length<2)return {decision:'insufficient-recovery-data'};
  const center=(group,key)=>median(group.map(s=>s[key]));
  const first=groups[0],last=groups.at(-1), heapGrowth=center(last,'heapBytes')-center(first,'heapBytes'), privateGrowth=center(last,'privateBytes')-center(first,'privateBytes');
  const diagnosticsComplete=groups.flat().every(s=>s.preview&&typeof s.preview.activeGenerations==='number'&&typeof s.preview.queuedGenerations==='number'&&s.mainIpcListeners&&s.rendererIpcListeners&&typeof s.heavyWorkerProcesses==='number'&&Array.isArray(s.processes));
  const processContinuity=Object.fromEntries(['Browser','GPU','presenter-heavy-worker'].map(role=>[role,[...new Set(samples.flatMap(s=>(s.processes||[]).filter(p=>p.type===role||p.name===role).map(p=>p.pid)))]]));
  const diagnosticRecovery=diagnosticsComplete&&Object.values(processContinuity).every(pids=>pids.length===1)&&groups.every(group=>group.every(s=>s.preview.activeGenerations===0&&s.preview.queuedGenerations===0&&s.preview.active===0&&s.preview.pending===0&&s.preview.cacheEntries===0&&s.preview.retryEntries===0&&s.heavyWorkerProcesses===1)&&['mainIpcListeners','rendererIpcListeners'].every(key=>median(group.map(s=>s[key].total))<=median(first.map(s=>s[key].total))));
  const slopes=[];for(let i=0;i<stable.length;i++)for(let j=i+1;j<stable.length;j++)if(stable[j].elapsedMs!==stable[i].elapsedMs)slopes.push((stable[j].privateBytes-stable[i].privateBytes)/((stable[j].elapsedMs-stable[i].elapsedMs)/60000));
  const slopeFor=key=>bootstrap(groups.map(group=>{const s=group.at(-1);return {t:s.elapsedMs,v:center(group,key)};}),points=>{const average=points.reduce((sum,p)=>sum+p.t,0)/points.length, mean=points.reduce((sum,p)=>sum+p.v,0)/points.length;const denominator=points.reduce((sum,p)=>sum+(p.t-average)**2,0);return denominator ? points.reduce((sum,p)=>sum+(p.t-average)*(p.v-mean),0)/denominator*60000 : 0;});
  const slopeInterval=slopeFor('privateBytes'),heapSlopeInterval=slopeFor('heapBytes');
  return {heapGrowth,heapSlopeInterval,privateGrowth,privateSlopeBytesPerMinute:median(slopes),slopeInterval,diagnosticsComplete,diagnosticRecovery,processContinuity,decision:!diagnosticsComplete?'insufficient-diagnostics':!diagnosticRecovery||heapGrowth>Math.max(20*1024**2,center(first,'heapBytes')*.1)||privateGrowth>Math.max(64*1024**2,center(first,'privateBytes')*.1)||slopeInterval.low>0||heapSlopeInterval.low>0?'investigate':'pass'};
}
module.exports={quantile,median,bootstrap,compare,summarizeMemory,frameColor};
