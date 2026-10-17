import type { Presentation } from './presentation';
/** Keep edits made after an observation while accepting coordinator samples. */
export function mergePracticeObservation(observed:Presentation, server:Presentation, current:Presentation):Presentation {
  if (current.id!==observed.id || server.id!==observed.id) return current;
  const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
  const old=new Map(observed.slides.map(slide=>[slide.id,slide]));
  const returned=new Map(server.slides.map(slide=>[slide.id,slide]));
  const slides=current.slides.flatMap(slide=>{
    if(!old.has(slide.id)||!equal(slide,old.get(slide.id)))return [slide];
    const next=returned.get(slide.id);return next?[next]:[];
  });
  for(const slide of server.slides)if(!old.has(slide.id)&&!slides.some(existing=>existing.id===slide.id))slides.push(slide);
  const merged={...current,slides};
  for(const key of Object.keys(server) as (keyof Presentation)[])if(key!=='slides'&&equal(current[key],observed[key]))Object.assign(merged,{[key]:server[key]});
  return merged;
}
