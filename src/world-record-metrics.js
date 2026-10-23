// Preserve the existing full-world statistics while the engine operates on selected records.
// ssotBytes retains its historical JSON.length unit; it is not UTF-8 disk usage.
const size=world=>JSON.stringify(world).length;
const count=(world,key)=>Array.isArray(world[key])?world[key].length:0;
const commas=n=>Math.max(0,n-1);
export function worldRecordMetrics(world,baseline){
 if(!baseline||!Number.isSafeInteger(baseline.world_bytes)||!Number.isSafeInteger(baseline.view_bytes)||!baseline.counts||!baseline.loaded)return null;
 let adjustment=0;
 for(const [key,total]of Object.entries(baseline.counts)){
  const loaded=baseline.loaded[key];if(!Number.isSafeInteger(total)||!Number.isSafeInteger(loaded)||total<loaded)return null;
  const current=count(world,key),next=total+current-loaded;if(next<0)return null;
  adjustment+=commas(next)-commas(total)-commas(current)+commas(loaded);
 }
 if(!Number.isSafeInteger(baseline.counts.events)||!Number.isSafeInteger(baseline.loaded.events))return null;
 return {events:baseline.counts.events+count(world,'events')-baseline.loaded.events,ssotBytes:baseline.world_bytes+size(world)-baseline.view_bytes+adjustment};
}
export function hydrateWorldMetrics(baseline,before,after){
 if(!baseline)return baseline;
 const copy=structuredClone(baseline);copy.view_bytes+=size(after)-size(before);
 for(const key of Object.keys(copy.loaded??{}))copy.loaded[key]+=count(after,key)-count(before,key);
 return copy;
}
