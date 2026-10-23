import { Dexie } from '../vendor/world-memory.js';
import { sha256Hex } from '../src/browser-capabilities.js';
import { buildWorldMovements } from '../src/chat-world-movements.js';

export const RECORD_STORES = {
 recordHeads:'[world_id+branch_id+kind+id], [world_id+branch_id], [world_id+branch_id+kind+active], [world_id+branch_id+kind+activity_tick], [world_id+branch_id+kind+record_position]',
 recordVersions:'[world_id+branch_id+kind+id+revision], [world_id+branch_id+revision], [world_id+branch_id+kind+revision]',
 recordBodies:'&digest',
 recordCommits:'[world_id+branch_id+revision]',
 recordLogs:'[world_id+branch_id+revision+kind+id], [world_id+branch_id+revision]'
};
const kinds={entities:'entity',agendas:'agenda',events:'event',conditions:'condition',relations:'relation',chronicle:'chronicle'};
const life=['closed','closedAt','closedBy','closedWhy'];
const clone=v=>structuredClone(v);
function fail(s){throw Error(s);}
function canonical(v,seen=new Set()){
 if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
 if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
 if(!v||typeof v!=='object')return fail('Strict JSON requires finite plain values');
 if(seen.has(v))fail('Strict JSON cyclic value');
 if(!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)fail('Strict JSON plain object required');
 seen.add(v);const out=Array.isArray(v)?'['+Array.from(v,x=>canonical(x,seen)).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k],seen)).join(',')+'}';seen.delete(v);return out;
}
function ptr(p){if(!p||!['world_id','branch_id'].every(k=>typeof p[k]==='string'&&p[k].trim())||!Number.isSafeInteger(p.revision)||p.revision<0)fail('Invalid record pointer revision or scope');return {world_id:p.world_id,branch_id:p.branch_id,revision:p.revision};}
const key=p=>[p.world_id,p.branch_id,p.revision];
const sameScope=(a,b)=>a.world_id===b.world_id&&a.branch_id===b.branch_id;
const identity=r=>r.kind+'\0'+r.id;
function signatureOf(d,rows){return sha256Hex(canonical({descriptor:d,rows:rows.map(({world_id,branch_id,revision,...r})=>r).sort((a,b)=>identity(a)<identity(b)?-1:identity(a)>identity(b)?1:0)}));}
function totalsOf(d,rows){
 const counts={};let bytes=canonical(d.core).length,fields=Object.keys(d.core).length;
 for(const table of d.tables){const values=rows.filter(r=>r.kind===kinds[table]);counts[table]=values.length;
  if(values.some(r=>!Number.isSafeInteger(r.body_bytes)))bytes=null;
  if(bytes!==null)bytes+=JSON.stringify(table).length+1+2+values.reduce((n,r)=>n+r.body_bytes,0)+Math.max(0,values.length-1)+(fields++?1:0);
 }
 return {counts,world_bytes:bytes};
}
function contentDigest(d,rows){
 const tables={};for(const table of d.tables)tables[table]=rows.filter(r=>r.kind===kinds[table]).sort((a,b)=>a.position-b.position).map(r=>({id:r.id,payload_digest:r.payload_digest,state_digest:r.state_digest}));
 return sha256Hex(canonical({$sw2RecordCandidate:1,core:d.core,tables}));
}
function checkDerived(d,rows,commit){
 if(commit.content_digest!==undefined&&commit.content_digest!==contentDigest(d,rows))fail('Corrupt record content digest');
 if(commit.metrics!==undefined&&canonical(commit.metrics)!==canonical(totalsOf(d,rows)))fail('Corrupt record metrics');
}
const normal=v=>Array.isArray(v)&&v.every(r=>r&&typeof r==='object'&&!Array.isArray(r)&&typeof r.id==='string'&&r.id.trim())&&new Set(v.map(r=>r.id)).size===v.length;
export const isRecordWorld=v=>!!v&&v.$sw2Records===1;
export function splitRecord(row,kind){
 const payload=clone(row),state={fields:{},hasDown:false};
 if(kind==='event'||kind==='legacy-event'){
  for(const k of life)if(Object.hasOwn(payload,k)){state.fields[k]=payload[k];delete payload[k];}
  if(payload.links&&typeof payload.links==='object'&&!Array.isArray(payload.links)&&Object.hasOwn(payload.links,'down')){state.hasDown=true;state.down=payload.links.down;delete payload.links.down;}
 }
 return {payload,state};
}
export function joinRecord(payload,state){
 const row=clone(payload);Object.assign(row,clone(state.fields));
 if(state.hasDown)row.links.down=clone(state.down);
 return row;
}
function metadata(row,kind){
 const nums=[row.tick,row.closedAt,row.closedAt?.tick,/^ev_(\d+)_/.exec(row.id)?.[1]].map(v=>typeof v==='string'&&/^\d+$/.test(v)?Number(v):v).filter(v=>typeof v==='number'&&Number.isFinite(v));
 return {active:kind==='event'&&!row.closed?1:0,activity_tick:nums.length?Math.max(...nums):-1,record_position:typeof row.position==='string'?row.position:'',body_bytes:canonical(row).length};
}
function referencesOf(value){
 const ids=new Set(),visit=v=>{if(!v||typeof v!=='object')return;for(const [k,x]of Object.entries(v)){
  if(['eventRef','parentId','endCause','ref'].includes(k)&&typeof x==='string'&&x)ids.add(x);
  if(['up','causeIds','referenceIds'].includes(k)&&Array.isArray(x))for(const id of x)if(typeof id==='string'&&id)ids.add(id);
  if(x&&typeof x==='object')visit(x);
 }};visit(value);return [...ids];
}
function unpack(row,bodies){
 const get=d=>{const b=bodies.get(d);if(!b||sha256Hex(canonical(b.value))!==d)fail('Missing or corrupt record body '+d);return clone(b.value);};
 const payload=get(row.payload_digest),state=get(row.state_digest);
 return joinRecord(payload,state);
}
function selected(rows,p,ids=null){
 const latest=new Map();
 for(const r of rows){if(!sameScope(r,p)||r.revision>p.revision||(ids&&!ids.has(r.id)))continue;const k=identity(r),old=latest.get(k);if(!old||old.revision<r.revision)latest.set(k,r);}
 return [...latest.values()].filter(r=>!r.deleted);
}
function checkedDescriptor(d,commits){
 if(!isRecordWorld(d))fail('Invalid record descriptor');const p=ptr(d.pointer),commit=commits.find(c=>sameScope(c,p)&&c.revision===p.revision);
 if(!commit||canonical(commit.descriptor)!==canonical(d))fail('Missing or conflicting record commit');return p;
}
export function expandRecordWorld(descriptor,{recordVersions=[],recordBodies=[],recordCommits=[]}={}){
 const commits=recordCommits instanceof Map?[...recordCommits.values()]:recordCommits;
 const p=checkedDescriptor(descriptor,commits),world=clone(descriptor.core);
 const bodies=recordBodies instanceof Map?recordBodies:new Map(recordBodies.map(b=>[b.digest,b]));
 const rows=selected(recordVersions instanceof Map?[...recordVersions.values()]:recordVersions,p);
 const commit=commits.find(c=>sameScope(c,p)&&c.revision===p.revision);
 if(commit.signature!==signatureOf(descriptor,rows))fail('Incomplete or corrupt record versions');checkDerived(descriptor,rows,commit);
 for(const table of descriptor.tables){if(!kinds[table])fail('Invalid normalized table');world[table]=rows.filter(r=>r.kind===kinds[table]).sort((a,b)=>a.position-b.position).map(r=>unpack(r,bodies));}
 return world;
}
export function createWorldRecordStore(db){
 const tables=Object.keys(RECORD_STORES).map(n=>db.table(n));
 const atomic=fn=>{
  const transaction=Dexie.currentTransaction;
  if(transaction?.db===db)return fn();
  const own=Dexie.ignoreTransaction(()=>db.transaction('rw',tables,fn));
  return transaction?Dexie.waitFor(own):own;
 };
 async function versions(p,ids=null){
  ptr(p);
  if(ids){const out=[];for(const id of new Set(ids))for(const kind of [...Object.values(kinds),'legacy-event']){const r=await db.recordVersions.where('[world_id+branch_id+kind+id+revision]').between([p.world_id,p.branch_id,kind,id,0],[p.world_id,p.branch_id,kind,id,p.revision],true,true).reverse().first();if(r&&!r.deleted)out.push(r);}return out;}
  const heads=await db.recordHeads.where('[world_id+branch_id]').equals([p.world_id,p.branch_id]).toArray();
  const out=[];
  for(const h of heads){if(h.revision<=p.revision){if(!h.deleted)out.push(h);continue;}const r=await db.recordVersions.where('[world_id+branch_id+kind+id+revision]').between([p.world_id,p.branch_id,h.kind,h.id,0],[p.world_id,p.branch_id,h.kind,h.id,p.revision],true,true).reverse().first();if(r&&!r.deleted)out.push(r);}
  return out;
 }
 async function bodiesFor(rows){const ds=[...new Set(rows.flatMap(r=>[r.payload_digest,r.state_digest]))];const bs=await db.recordBodies.bulkGet(ds);return new Map(bs.filter(Boolean).map(b=>[b.digest,b]));}
 async function descriptor(p){const c=await db.recordCommits.get(key(ptr(p)));if(!c)fail('Missing record commit');return c.descriptor;}
 async function readWorld(d){
  const p=checkedDescriptor(d,[await db.recordCommits.get(key(ptr(d.pointer)))].filter(Boolean));
  const rs=await versions(p),bs=await bodiesFor(rs),w=clone(d.core);
  const commit=await db.recordCommits.get(key(p));if(commit.signature!==signatureOf(d,rs))fail('Incomplete or corrupt record versions');checkDerived(d,rs,commit);
  for(const table of d.tables)w[table]=rs.filter(r=>r.kind===kinds[table]).sort((a,b)=>a.position-b.position).map(r=>unpack(r,bs));
  return w;
 }
 async function byKind(p,kind){
  const heads=await db.recordHeads.where('[world_id+branch_id+kind+id]').between([p.world_id,p.branch_id,kind,Dexie.minKey],[p.world_id,p.branch_id,kind,Dexie.maxKey],true,true).toArray();
  const out=[];for(const h of heads){if(h.revision<=p.revision){if(!h.deleted)out.push(h)}else{const rows=await versions(p,[h.id]);const row=rows.find(r=>r.kind===kind);if(row)out.push(row)}}return out;
 }
 async function filtered(p,kind,field,lower,upper=lower){
  const latest=await db.recordCommits.where('[world_id+branch_id+revision]').between([p.world_id,p.branch_id,0],[p.world_id,p.branch_id,Dexie.maxKey],true,true).last();
  if(latest?.revision===p.revision){const index='[world_id+branch_id+kind+'+field+']';return db.recordHeads.where(index).between([p.world_id,p.branch_id,kind,lower],[p.world_id,p.branch_id,kind,upper],true,true).filter(r=>!r.deleted).toArray()}
  return (await byKind(p,kind)).filter(r=>r[field]>=lower&&r[field]<=upper);
 }
 async function readWorkingWorld(d,{afterTick=0,referenceIds=[],stateOnly=false}={}){
  const p=checkedDescriptor(d,[await db.recordCommits.get(key(ptr(d.pointer)))].filter(Boolean)),world=clone(d.core),chosen=new Map();
  const add=rows=>{for(const r of rows)chosen.set(identity(r),r)};
  for(const table of d.tables)if(!['events','chronicle'].includes(table))add(await byKind(p,kinds[table]));
  if(!stateOnly){add(await filtered(p,'event','active',1));add(await filtered(p,'event','activity_tick',afterTick,Dexie.maxKey));add(await filtered(p,'chronicle','activity_tick',afterTick,Dexie.maxKey));}
  let decoded=new Map(),pending=[...referenceIds],seen=new Set();
  const decode=async()=>{const fresh=[...chosen.values()].filter(r=>!decoded.has(identity(r)));const bodies=await bodiesFor(fresh);for(const r of fresh)decoded.set(identity(r),unpack(r,bodies));return stateOnly?[]:fresh.filter(r=>r.kind!=='agenda'||!decoded.get(identity(r)).closed).filter(r=>r.kind!=='condition'||['active','planned'].includes(decoded.get(identity(r)).state)).flatMap(r=>referencesOf(decoded.get(identity(r))))};
  pending.push(...await decode());
  while(pending.length){const ids=[...new Set(pending)].filter(id=>!seen.has(id));pending=[];if(!ids.length)break;ids.forEach(id=>seen.add(id));add(await versions(p,ids));pending.push(...await decode());}
  for(const table of d.tables)world[table]=[...chosen.values()].filter(r=>r.kind===kinds[table]).sort((a,b)=>a.position-b.position).map(r=>decoded.get(identity(r)));
  // Recovered old evidence stays in its historical group; absence of closed never creates a pending event.
  for(const r of chosen.values())if(r.kind==='legacy-event')for(const m of world.milestones||[])if((m.ids||[]).includes(r.id)||(m.rows||[]).some(v=>v.id===r.id))m.rows=(m.rows||[]).map(v=>v.id===r.id?clone(decoded.get(identity(r))):v);
  const partial=Object.fromEntries(['events','chronicle'].filter(t=>d.tables.includes(t)).map(t=>[t,{complete:false,ids:(world[t]||[]).map(r=>r.id)}]));
  const commit=await db.recordCommits.get(key(p));
  return {world,partial,metrics:{...(commit.metrics??{counts:{},world_bytes:null}),loaded:Object.fromEntries(d.tables.map(t=>[t,(world[t]||[]).length])),view_bytes:canonical(world).length}};
 }
 async function recordsAtPositions(pointer,positions){
  await descriptor(pointer);const rs=[];for(const kind of ['event','legacy-event'])for(const position of new Set(positions))rs.push(...await filtered(pointer,kind,'record_position',position));
  return getRecords(pointer,[...new Set(rs.map(r=>r.id))]);
 }
 async function putVersion(pointer,world,{previous=null,operation=null,partial=null,eventEvidence=[]}={}){
  validateRecordPartial(partial,world);const p=ptr(pointer);canonical(world);canonical(operation);canonical(eventEvidence);
  return atomic(async()=>{
   const prior=previous?await versions(checkedDescriptor(previous,[await db.recordCommits.get(key(ptr(previous.pointer)))].filter(Boolean))):[];
   if(previous&&previous.pointer.world_id!==p.world_id)fail('Record branch base world conflict');
   if(previous&&sameScope(previous.pointer,p)&&previous.pointer.revision>=p.revision)fail('Previous revision conflict');
   const core=clone(world),names=[],incoming=new Map(),priorMap=new Map(prior.map(r=>[identity(r),r]));
   const pendingBodies=new Map();
   function body(value){const digest=sha256Hex(canonical(value));pendingBodies.set(digest,{digest,value});return digest;}
   function rowFor(value,kind,position){const {payload,state}=splitRecord(value,kind);return {...p,kind,id:value.id,position,...metadata(value,kind),payload_digest:body(payload),state_digest:body(state),deleted:false};}
   for(const [table,kind]of Object.entries(kinds)){
    if(!normal(world[table]))continue;
    names.push(table);delete core[table];
    const values=world[table];
    if(partial?.[table]?.complete===false){
     const loaded=new Set(partial[table].ids||[]),supplied=new Set(values.map(r=>r.id)),old=prior.filter(r=>r.kind===kind);
     for(const r of old)if(!loaded.has(r.id)&&!supplied.has(r.id))incoming.set(identity(r),{...r,...p});
     let position=old.reduce((max,r)=>Math.max(max,r.position),-1)+1;
     for(const r of values){const previous=priorMap.get(kind+'\0'+r.id),row=rowFor(r,kind,previous?.position??position++);incoming.set(identity(row),row);}
    }else{
     values.forEach((r,i)=>{const row=rowFor(r,kind,i);incoming.set(identity(row),row);});
    }
   }
   for(const r of prior.filter(r=>r.kind==='legacy-event'))incoming.set(identity(r),{...r,...p});
   for(const [i,r]of eventEvidence.entries()){if(!normal([r]))fail('Invalid legacy event evidence');const v=rowFor(r,'legacy-event',i);incoming.set(identity(v),v);}
   for(const r of incoming.values())if(r.kind==='event')incoming.delete('legacy-event\0'+r.id);
   const d={$sw2Records:1,pointer:p,core,tables:names};
   const signature=signatureOf(d,[...incoming.values()]);
   const existing=await db.recordCommits.get(key(p));
   if(existing){if(existing.signature!==signature)fail('Immutable record revision conflict');return clone(existing.descriptor);}
   const head=await db.recordCommits.where('[world_id+branch_id+revision]').between([p.world_id,p.branch_id,0],[p.world_id,p.branch_id,Dexie.maxKey],true,true).last();
   if(head&&head.revision>=p.revision)fail('Stale record revision conflict');
   if(head&&(!previous||!sameScope(previous.pointer,p)||head.revision!==previous.pointer.revision))fail('Previous record head conflict');
   for(const b of pendingBodies.values()){const old=await db.recordBodies.get(b.digest);if(old&&canonical(old.value)!==canonical(b.value))fail('Record body hash conflict');if(!old)await db.recordBodies.add(b);}
   const branchBase=previous&&!sameScope(previous.pointer,p);
   const changed=[];
   for(const k of new Set([...priorMap.keys(),...incoming.keys()])){
    const before=priorMap.get(k),after=incoming.get(k);
    const unchanged=before&&after&&before.payload_digest===after.payload_digest&&before.state_digest===after.state_digest&&before.position===after.position;
    if(unchanged&&!branchBase)continue;
    const row=after||{...before,...p,deleted:true};
    await db.recordVersions.add(row);await db.recordHeads.put(row);
    if(!unchanged)changed.push({before:before||null,after:after||null,row});
   }
   const op=clone(operation);
   await db.recordCommits.add({...p,descriptor:d,signature,metrics:totalsOf(d,[...incoming.values()]),content_digest:contentDigest(d,[...incoming.values()]),operation:op,baseline:!previous});
   for(const {before,after,row}of changed)await db.recordLogs.add({...p,kind:row.kind,id:row.id,before,after,operation:op,baseline:!previous});
   return clone(d);
  });
 }
 async function getRecords(pointer,ids=null){
  await descriptor(pointer);const rs=await versions(pointer,ids),bs=await bodiesFor(rs),out=new Map();
  for(const r of rs){if(r.kind==='chronicle')continue;const value={...unpack(r,bs),record_kind:r.kind==='legacy-event'?'event':r.kind};const prior=out.get(r.id);if(prior&&prior.record_kind!==value.record_kind)fail('Formal record id collision: '+r.id);if(!prior||r.kind!=='legacy-event')out.set(r.id,value);}
  return [...out.values()];
 }
 async function getChanges(pointer,{after_revision=-1}={}){
  await descriptor(pointer);
  return db.recordLogs.where('[world_id+branch_id+revision]').between([pointer.world_id,pointer.branch_id,Math.max(0,after_revision+1)],[pointer.world_id,pointer.branch_id,pointer.revision],true,true).toArray();
 }
 async function getMovements(pointer,{after_revision=-1}={}){
  const logs=await getChanges(pointer,{after_revision}),records=[];
  for(const log of logs){
   const op=log.operation||{};if(log.baseline||/restore|import/i.test(op.kind||op.type||''))continue;
   if(log.kind==='chronicle'||log.kind==='legacy-event')continue;
   const refs=[log.before,log.after].filter(Boolean),bs=await bodiesFor(refs);
   const before=log.before?unpack(log.before,bs):null,after=log.after?unpack(log.after,bs):null;
   const table=Object.keys(kinds).find(k=>kinds[k]===log.kind);
   const prev={revision:log.revision-1,world:{[table]:before?[before]:[]}};
   const current={revision:log.revision,world:{[table]:after?[after]:[]},operation_id:op.operation_id,at:op.at||op.saved_at};
   // Only selected movements resolve causes; unrelated broken records remain readable.
   const all=[];
   if(log.kind==='event'&&after?.producer==='world'){
    const formal=new Set(['event','parent','ripple','plot','entity','agenda','condition']);
    const refs=r=>[formal.has(r.source?.type)?r.source.ref:null,formal.has(r.cause?.type)?r.cause.ref:null,r.eventRef,r.parentId,...(Array.isArray(r.causeIds)?r.causeIds:[]),...(Array.isArray(r.links?.up)?r.links.up:[])].filter(x=>typeof x==='string'&&x);
    const pending=refs(after),seen=new Set([after.id]);
    while(pending.length){const id=pending.shift();if(seen.has(id))continue;seen.add(id);const rows=await getRecords({...pointer,revision:log.revision},[id]);if(!rows.length)fail('Movement formal reference missing: '+id);for(const r of rows){all.push(r);pending.push(...refs(r));}}
   }
   records.push(...buildWorldMovements([prev,current],{afterRevision:log.revision-1,records:all}));
  }
  return {records,range:{after_revision,through_revision:pointer.revision}};
 }
 return {tables,putVersion,isRecordWorld,readWorld,readWorkingWorld,recordsAtPositions,getDescriptor:descriptor,getRecords,getChanges,getMovements};
}


export function validateRecordPartial(partial,world=undefined){
 if(partial===null||partial===undefined)return null;
 if(!partial||typeof partial!=='object'||Array.isArray(partial))throw Error('Invalid partial metadata');
 for(const [table,value]of Object.entries(partial)){
  if(world!==undefined&&!normal(world?.[table]))throw Error('Invalid partial normalized table: '+table);
  if(!kinds[table]||!value||typeof value!=='object'||Array.isArray(value)||typeof value.complete!=='boolean'||!Array.isArray(value.ids)||value.ids.some(id=>typeof id!=='string'||!id.trim())||new Set(value.ids).size!==value.ids.length||Object.keys(value).some(k=>!['complete','ids'].includes(k)))throw Error('Invalid partial metadata');
 }
 return partial;
}
