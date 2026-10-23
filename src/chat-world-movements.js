import {eventBornTick} from './setting.js';
const rows=value=>Array.isArray(value)?value:[];
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const formal=new Set(['event','parent','ripple','plot','entity','agenda','condition']);
function refs(row){
 return [...new Set([formal.has(row.source?.type)?row.source.ref:null,formal.has(row.cause?.type)?row.cause.ref:null,
 row.eventRef,row.parentId,...rows(row.causeIds),...rows(row.links?.up)].filter(v=>typeof v==='string'&&v))];
}
function eventRows(world,records){
 const result=new Map();
 for(const row of [...rows(world.events),...rows(world.milestones).flatMap(m=>rows(m.rows))])
  result.set(row.id,{...records.get(row.id),...row,record_kind:'event'});
 return result;
}
export function buildWorldMovements(snapshots,{afterRevision,records=[]}){
 const byId=new Map(records.map(row=>[row.id,row])),result=[];
 function causes(event){
  const found=new Map(),pending=refs(event),seen=new Set([event.id]);
  while(pending.length){const id=pending.shift();if(seen.has(id))continue;seen.add(id);const row=byId.get(id);
   if(!row)throw Error('动向因果引用对应的正式记录缺失：'+id);
   found.set(id,structuredClone(row));pending.push(...refs(row));
  }
  return [...found.values()];
 }
 const ordered=[...snapshots].sort((a,b)=>a.revision-b.revision);
 for(let index=0;index<ordered.length;index++){
  const current=ordered[index],previous=ordered[index-1],world=current.world;
  if(current.revision<=afterRevision)continue;
  const oldEvents=previous?eventRows(previous.world,byId):new Map(),events=eventRows(world,byId);
  const meta={record_kind:'movement',revision:current.revision,
   ...(current.operation_id?{operation_id:current.operation_id}:{}),...(current.at?{saved_at:current.at}:{})};
  for(const event of events.values()){
   if(event.producer!=='world')continue;
   const old=oldEvents.get(event.id);
   if(old&&stable(old)===stable(event))continue;
   if(!previous&&Number.isSafeInteger(world.meta?.tick)&&eventBornTick(event.id)!==world.meta.tick)continue;
   result.push({...meta,id:'movement:'+current.revision+':event:'+event.id,events:[structuredClone(event)],causes:causes(event),changes:[]});
  }
  if(!previous)continue;
  for(const [table,kind]of Object.entries({entities:'entity',agendas:'agenda',conditions:'condition',relations:'relation'})){
   const before=new Map(rows(previous.world[table]).map(row=>[row.id,row])),after=new Map(rows(world[table]).map(row=>[row.id,row]));
   for(const id of new Set([...before.keys(),...after.keys()])){
    const old=before.get(id),next=after.get(id);if(stable(old)===stable(next))continue;
    const change={id,record_kind:kind,change_type:!old?'added':!next?'removed':'updated',
     ...(next?{after:structuredClone(next)}:{before:structuredClone(old)})};
    result.push({...meta,id:'movement:'+current.revision+':'+kind+':'+id,events:[],changes:[change]});
   }
  }
 }
 return result;
}
