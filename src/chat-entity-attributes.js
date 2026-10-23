// Formal current values are authoritative. Initial records only omit proven unchanged values.
import {projectSourceEntityFields,SOURCE_ENTITY_SYSTEM_KEYS,sourceBaselineHash} from './source-records.js';
import {readWorldFieldSchema} from './source-field-table.js';
import {isFinalizedPublication,frozenInitialState} from './finalized-source.js';
const rows=v=>Array.isArray(v)?v:[],plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),own=(v,k)=>Object.hasOwn(v??{},k);
const canonical=v=>JSON.stringify(v,(_,x)=>plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
// Compare formatting only; originals and displayed current values stay byte-for-byte intact.
const comparable=v=>JSON.stringify(v,(_,x)=>typeof x==='string'?x.replace(/\r\n/g,'\n').trim():plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const containers=new Set(['history','historyNotes','events','chronicle','agendas','relations','conditions','sources','source_refs','source','metadata','fieldSource','record_kind','evidence','retrieval','provenance']);
const internal=new Set([...SOURCE_ENTITY_SYSTEM_KEYS.filter(k=>!['race','status','location'].includes(k)),...containers]);
const labels={location:'所在位置',race:'种族',status:'状态'},statusLabels={active:'活跃',retired:'退出',dead:'死亡'};
function attributes(e,known=[]){return Object.fromEntries(Object.entries(e??{}).filter(([k,v])=>(!internal.has(k)||known.includes(k))&&v!==undefined&&!(k==='location'&&(v==='未明'||v===''))))}
const projected=(f,known=[])=>attributes(projectSourceEntityFields(f??{}).fields,known);
function initialPublications(world,override=null){
 // updates are later source publications, not alternative copies of the initial snapshot.
 return (override?[override]:[world.meta?.sourcePublication,world.sourcePublication]).filter((p,i,a)=>plain(p)&&Array.isArray(p.records)&&p.records.length&&a.indexOf(p)===i);
}
function verifiedPublication(p){if(p.baseline_authority==='immutable-source-version')return true;if(typeof p.conversion?.baseline_hash!=='string')return false;try{return p.conversion.baseline_hash===sourceBaselineHash(p)}catch{return false}}
function compareInitialCandidates(candidates,{partial=false,known=[]}={}){
 const maps=candidates.map(c=>leaves(c.attributes,[],new Map(),known)),keys=new Set(maps.flatMap(m=>[...m.keys()])),initial=new Map(),conflicts=new Map();
 for(const key of keys){
  const values=maps.map(m=>m.get(key)),present=values.filter(Boolean);
  if((partial||present.length===values.length)&&present.every(v=>comparable(v.value)===comparable(present[0].value)))initial.set(key,present[0]);
  else conflicts.set(key,{path:present[0].path,reason:present.length===values.length?'initial-field-conflicting':'initial-field-presence-unknown',
   evidence:candidates.map((c,i)=>({source:c.source,present:!!values[i],...(values[i]?{value:structuredClone(values[i].value)}:{})}))});
 }
 return {status:'known',attributes:candidates[0]?.attributes??{},leaves:initial,conflicts,source:candidates.length===1?candidates[0].source:{type:'compared-initial-records',candidates:candidates.map(c=>c.source)}};
}
function baselineIndex(world,override,known=[]){
 const byId=new Map();
 for(const p of initialPublications(world,override)){const verified=verifiedPublication(p);for(const [index,r]of p.records.entries()){
  if(r.record_kind!=='entity')continue;
  if(!verified){if(!byId.has(r.id))byId.set(r.id,{status:'missing',attributes:{}});continue;}
  const value={attributes:projected(r.fields,known),source:{library_id:p.library_id??null,version:p.version??null,fingerprint:p.conversion?.fingerprint??null,path:override?'sourceVersions.records':p===world.meta?.sourcePublication?'meta.sourcePublication.records':'sourcePublication.records',index,record_id:r.id,kind:r.kind??null,baseline_hash:p.conversion?.baseline_hash??null}};
  const before=byId.get(r.id);if(!before||before.status==='missing')byId.set(r.id,{status:'known',candidates:[value]});else before.candidates.push(value);
 }}
 for(const [id,baseline]of byId)if(baseline.status==='known')byId.set(id,compareInitialCandidates(baseline.candidates,{known}));
 return byId;
}
function legacyBaseline(world,entity,known=[]){
 const originals=rows(world.meta?.sourceEdits?.originals),stable=originals.filter(r=>r.id===entity.id);
 if(stable.length)return compareInitialCandidates(stable.map(row=>({attributes:projected(row.value?.fields,known),source:{type:'saved-source-original',path:'meta.sourceEdits.originals',record_id:entity.id,index:originals.indexOf(row)}})),{known});
 const frozen=world.context?.setting?.frozen,canon=frozen?.canon;
 if(!frozen?.fingerprint)return {status:'missing',attributes:{}};
 const book=rows(canon?.bookEntities),hits=book.filter(r=>r.name===entity.name&&(!r.kind||r.kind===entity.kind));
 if(hits.length!==1||rows(world.entities).filter(r=>r.name===entity.name).length!==1)return {status:'missing',attributes:{}};
 const settings=rows(canon?.settings),candidates=settings.filter(r=>r.name===entity.name&&(!r.kind||r.kind===entity.kind)).map(row=>({attributes:projected(row.fields,known),source:{type:'legacy-source',path:'context.setting.frozen.canon.settings',fingerprint:frozen.fingerprint,record_id:entity.id,index:settings.indexOf(row)}}));
 candidates.push({attributes:projected(hits[0].fields,known),source:{type:'legacy-source',path:'context.setting.frozen.canon.bookEntities',fingerprint:frozen.fingerprint,record_id:entity.id,index:book.indexOf(hits[0])}});
 return compareInitialCandidates(candidates,{partial:true,known});
}
function leaves(value,path=[],out=new Map(),known=[]){
 if(plain(value)){if(own(value,'record_kind'))return out;const entries=Object.entries(value).filter(([k,v])=>(!containers.has(k)||known.includes(path[0]??k))&&v!==undefined);
  if(entries.length)for(const [k,v]of entries)leaves(v,[...path,k],out,known);else if(path.length&&!Object.keys(value).length)out.set(canonical(path),{path,value:{}});
 }else if(Array.isArray(value)&&value.length)value.forEach((v,i)=>leaves(v,[...path,i+1],out,known));
 else out.set(canonical(path),{path,value});return out;
}
function display(v,key){if(key==='status'&&own(statusLabels,v))return statusLabels[v];if(v===null)return '空值';if(v==='')return '空文本';if(Array.isArray(v))return '空列表';if(plain(v))return '空对象';return String(v)}
function acceptedRemoval(world,e,key){
 const log=world.meta?.entityFields?.[e.id]?.fields?.[key];if(log?.deleted===true)return true;
 const edit=world.meta?.sourceEdits?.last;
 return edit?.kind==='entity'&&edit.target===e.id&&own(edit.before?.fields,key)&&!own(edit.after?.fields,key);
}
function line(a,definitions,kind){
 const f=definitions.find(f=>f.storageKey===a.path[0]&&f.kinds.includes(kind));
  const label=a.path.map((p,i)=>i===0?(f?.name??labels[p]??p):p).join(' / ');
 const current=a.change==='removed'?'已停止记录':display(a.value,a.path[0]);
  return '- '+label+'：'+current;
}
export function chatEntityAttributes(world,entityIds,{baselinePublication=null}={}){
 const selected=new Set(entityIds),entities=rows(world.entities).filter(e=>selected.has(e.id)&&e.kind!=='location'&&e.record_kind!=='location');
 const finalized=isFinalizedPublication(world.meta?.sourcePublication),snapshot=finalized?frozenInitialState(world):null;
 if(finalized&&!snapshot)return {records:[],text:'',diagnostics:[{reason:'initial-state-snapshot-invalid'}],omitted:[],limited:false};
 const schema=readWorldFieldSchema(world),known=schema.fields.map(f=>f.storageKey),index=finalized?new Map(snapshot.entities.map(e=>[e.id,{status:'known',attributes:attributes(e,known)}])):baselineIndex(world,baselinePublication,known),records=[],text=[],diagnostics=[];
 if(schema.status==='invalid')diagnostics.push({reason:'field-schema-invalid',message:schema.error});
 for(const e of entities){
  let baseline=index.get(e.id)??(finalized?{status:'known',attributes:{}}:legacyBaseline(world,e,known));
  const runtime=world.meta?.entityOrigins?.[e.id]?.type==='runtime';
  const current=leaves(attributes(e,known),[],new Map(),known),original=baseline.status==='known'?(baseline.leaves??leaves(baseline.attributes,[],new Map(),known)):new Map(),changes=[];
  for(const conflict of baseline.conflicts?.values()??[])diagnostics.push({id:e.id,name:e.name,field:conflict.path.join(' / '),reason:conflict.reason,evidence:structuredClone(conflict.evidence)});
  for(const key of new Set([...current.keys(),...original.keys()])){
   const after=current.get(key),before=original.get(key),root=(after??before).path[0];
   if(schema.status==='invalid'||schema.retired.some(f=>f.storageKey===root&&f.kinds.includes(e.kind)))continue;
   if(schema.status==='confirmed'&&!['location','status'].includes(root)&&!schema.fields.some(f=>f.enabled!==false&&f.storageKey===root&&f.kinds.includes(e.kind)))continue;
   if(after&&before&&comparable(after.value)===comparable(before.value))continue;
   if(!after&&!acceptedRemoval(world,e,root)){diagnostics.push({id:e.id,field:root,reason:'current-field-missing-without-deletion'});continue}
   changes.push({path:(after??before).path,change:!after?'removed':!before?runtime?'created':'unrecorded':'changed',
    ...(after?{value:structuredClone(after.value)}:{}),...(before?{before:structuredClone(before.value)}:{})});
  }
  if(!changes.length)continue;
  records.push({record_kind:'entity',id:e.id,name:e.name,baseline:baseline.status,baseline_source:baseline.source??null,attributes:changes});
  text.push(e.name+'\n'+changes.map(a=>line(a,schema.fields,e.kind)).join('\n'));
 }
 const relations=chatRelationChanges(world,entities.map(e=>e.id),{baselinePublication});diagnostics.push(...relations.diagnostics);
 for(const e of entities){const related=relations.records.filter(c=>[c.current,c.before].some(r=>r&&(r.from===e.id||r.to===e.id)));if(!related.length)continue;
  let r=records.find(r=>r.id===e.id);if(!r){r={record_kind:'entity',id:e.id,name:e.name,attributes:[]};records.push(r)}r.relations=related;
 }
 const body=[...text,relations.text].filter(Boolean).join('\n\n');
  return {records,text:body?'【当前状态】以下记录为当前权威状态，不代表人物已经知情，也不替玩家行动。\n'+body:'',diagnostics,omitted:[],limited:false};
}
export function chatRelationChanges(world,entityIds,{baselinePublication=null}={}){
 const finalized=isFinalizedPublication(world.meta?.sourcePublication),snapshot=finalized?frozenInitialState(world):null;
 if(finalized&&!snapshot)return {records:[],text:'',diagnostics:[{reason:'initial-state-snapshot-invalid'}]};
 const selected=new Set(entityIds),entities=new Map(rows(world.entities).map(e=>[e.id,e])),places=new Set(rows(world.entities).filter(e=>e.kind==='location').map(e=>e.id));
 for(const p of rows(world.context?.setting?.frozen?.canon?.geography?.places))places.add(p.id);
 const relevant=r=>!places.has(r.from)&&!places.has(r.to)&&(selected.has(r.from)||selected.has(r.to));
 const fact=r=>({id:r.id,from:r.from??r.from_id,to:r.to??r.to_id,type:r.type??r.text,...(r.note?{note:r.note}:{})});
 const key=r=>canonical([r.from,r.to,r.type,r.note??'']),original=new Map(),diagnostics=[];
 if(finalized)for(const raw of snapshot.relations)original.set(raw.id,{row:{...fact(raw),ended:own(raw,'endedTick')},status:'known'});
 for(const p of finalized?[]:initialPublications(world,baselinePublication)){if(!verifiedPublication(p))continue;for(const raw of rows(p.records)){
  if(raw.record_kind!=='relation'||raw.fact_type&&raw.fact_type!=='current')continue;
  const r=fact(raw),old=original.get(r.id);if(old&&key(old.row)!==key(r))old.status='conflicting';else if(!old)original.set(r.id,{row:r,status:'known'});
 }
 }
 // Legacy name edges only match an exact unique current fact; partial collections never prove absence.
 const canon=world.context?.setting?.frozen?.canon;
 if(!finalized&&!initialPublications(world).length&&Array.isArray(canon?.relations)&&world.context?.setting?.frozen?.fingerprint){
  const resolve=name=>{const hits=[...entities.values()].filter(e=>e.name===name);return hits.length===1?hits[0].id:null};
  for(const old of canon.relations){const from=resolve(old.from),to=resolve(old.to);if(!from||!to)continue;
   const matches=rows(world.relations).filter(r=>r.from===from&&r.to===to);
   if(matches.length===1)original.set(matches[0].id,{row:{id:matches[0].id,from,to,type:old.type},status:'known'});
  }
 }
 const records=[],present=new Set();
 for(const raw of rows(world.relations)){const r={...fact(raw),ended:own(raw,'endedTick')};if(!relevant(r))continue;present.add(r.id);
  const before=original.get(r.id);
  if(before?.status==='known'){
   if((finalized?r.ended!==before.row.ended:r.ended)||key(before.row)!==key(r))records.push({change:r.ended?'ended':'changed',before:before.row,current:r,baseline:'known'});
  }else if(!before&&(finalized||world.meta?.relationOrigins?.[r.id]?.type==='runtime'))records.push({change:r.ended?'ended':'created',current:r,baseline:'runtime-created'});
   else {
    // 比较依据不足不否认正式当前关系，也不把它冒称为本轮新增。
    records.push({change:r.ended?'ended':'current',current:r,baseline:before?'conflicting':'missing'});
   }
 }
 for(const {row}of original.values())if(relevant(row)&&!present.has(row.id))diagnostics.push({id:row.id,reason:'current-relation-missing-without-removal'});
 const name=id=>entities.get(id)?.name??null,render=r=>{const from=name(r.from),to=name(r.to);return from&&to?from+' → '+to+'：'+r.type+(r.note?'；'+r.note:''):null};
 const visible=records.filter(c=>render(c.current)&&(!c.before||render(c.before)));
 const lines=visible.map(c=>'- '+render(c.current)+(c.change==='ended'?'（已结束）':''));
 return {records:visible,text:lines.length?'【相关关系】\n'+lines.join('\n'):'',diagnostics};
}
