// Registration keeps accepted model records intact; only distinct values need a model decision.
import {sha256Hex} from './browser-capabilities.js';
import {canonicalSourceJson} from './source-records.js';
const clone=structuredClone,hash=v=>sha256Hex(canonicalSourceJson(v));
const calls=(row,stage)=>row.staged.plan.calls.filter(c=>c.stage===stage);
const result=(row,c)=>row.staged.blocks[c.call_id]?.result?.[0];
export const registrationRef=(call,id)=>call.call_id+':'+id;
export function registrationDeclarations(row,stage,key){
 return calls(row,stage).flatMap(call=>{
  const value=result(row,call)??{},items=(value[key]??[]).map(d=>({...clone(d),ref:registrationRef(call,d.local_id),sources:[...call.refs]}));
  if(stage==='ab-prelude'&&key==='locations')for(const setting of value.settings??[])for(const p of setting.data.geography?.places??[])
   items.push({local_id:p.id,name:p.name,kind:'location',aliases:clone(p.aliases??[]),clues:p.qualifier??null,ref:registrationRef(call,p.id),sources:[...call.refs]});
  return items;
 });
}
export function registrationMapped(groups,declarations,namespace='identity'){
 const byRef=new Map(declarations.map(e=>[e.ref,e]));
 return groups.map((g,index)=>({...clone(g),id:'ab-identity:'+hash([namespace,index,[...g.member_refs].sort()]),
  clues:[...new Set([g.clues,...g.member_refs.map(r=>byRef.get(r)?.clues)].filter(Boolean))].join('\n')||null,
  aliases:[...new Set([...g.aliases,...g.member_refs.flatMap(r=>{const e=byRef.get(r);return e?[e.name,...e.aliases]:[];})])].filter(n=>n!==g.name)}));
}
export function registrationLinks(items){
 const links=new Map(),ambiguous=new Set();
 for(const item of items)for(const ref of item.member_refs){if(links.has(ref)&&links.get(ref)!==item.id)ambiguous.add(ref);else links.set(ref,item.id);}
 for(const ref of ambiguous)links.delete(ref);
 return links;
}
export function registrationSourceRefs(row,call){
 return [...new Set(row.staged.plan.chunks.filter(c=>call.chunk_ids.includes(c.chunk_id)).map(c=>c.source_id))]
  .map(source_id=>({source_id,content_hash:row.items.find(i=>i.source_id===source_id)?.content_hash,task_id:row.import_id}));
}
export function registrationClaims(row,table,maps){
 const claims=[],originals=[];
 for(const call of row.staged.plan.calls.filter(c=>['ab-prelude','ab-a','ab-b'].includes(c.stage))){
  const value=result(row,call),a=calls(row,'ab-a').find(c=>c.package_index===call.package_index),own=new Set((value.entities??value.locations??[]).map(e=>e.local_id));
  const identity=id=>{
   if(maps.entities.some(e=>e.id===id))return id;
   const owner=call.stage==='ab-b'&&!own.has(id)?a:call;
   return maps.links.get(registrationRef(owner??call,id))??registrationRef(owner??call,id);
  };
  for(const [key,kind] of [['attributes','attribute'],['relations','relation'],['settings','setting'],['events','event'],['plans','plan']])for(const [index,raw] of (value[key]??[]).entries()){
   const c={...clone(raw),id:'ab-claim:'+hash([call.call_id,key,raw.local_id,index]),kind,source_refs:registrationSourceRefs(row,call),call_id:call.call_id};
   originals.push(clone(c));c.sources=[...call.refs];
   if(kind==='attribute'){
    c.subject_id=identity(c.subject_id);
    if(call.stage==='ab-prelude'&&c.field_id!==null){
     c.field_id=maps.field_links.get(registrationRef(call,c.field_id))??registrationRef(call,c.field_id);
     const definition=maps.fields.find(f=>f.id===c.field_id);
     if(definition){
      c.original_field_definition=clone(definition);
      if(!table.fields.some(f=>f.id===c.field_id)){c.field_id=null;c.suggested_field={name:definition.name,meaning:definition.meaning,kinds:clone(definition.kinds)};}
     }
    }
    c.nature='fact';c.object_id=null;
   }else if(kind==='relation'){
    c.subject_id=c.from_id=identity(c.from_id);c.object_id=c.to_id=identity(c.to_id);c.value=c.text;c.nature='fact';c.relation_kind=c.text;
   }else if(kind==='event'){
    c.participant_ids=c.participant_ids.map(identity);c.location_id=c.location_id===null?null:identity(c.location_id);c.subject_id=c.participant_ids[0]??null;c.nature='fact';
   }else if(kind==='plan'){c.subject_id=identity(c.subject_id);c.nature='plan';}
   if(kind!=='setting'){claims.push(c);continue;}
   let fragment=0;
   const add=(setting_key,data,extra={})=>claims.push({...clone(c),...clone(extra),id:'ab-setting:'+hash([c.id,setting_key,fragment++]),original_record_id:c.id,setting_key,data});
   for(const [key,v]of Object.entries(c.data)){
    if(key==='geography'){
     for(const [i,rawPlace]of (v.places??[]).entries()){
      const place=clone(rawPlace),id=identity(place.id),mapped=maps.entities.find(e=>e.id===id);
      place.id=id;if(mapped){place.name=mapped.name;place.aliases=[...new Set([...(place.aliases??[]),...mapped.aliases])].filter(n=>n!==place.name);}
      add('geography.place:'+id,{geography:{version:v.version,places:[place],links:[]}},{original_place:clone(rawPlace)});
     }
     for(const [i,rawLink]of (v.links??[]).entries()){
      const link=clone(rawLink);link.from=identity(link.from);link.to=identity(link.to);
      add('geography.link:'+canonicalSourceJson([link.from,link.to,link.kind??link.type??null]) ,{geography:{version:v.version,places:[],links:[link]}});
     }
    }else if(key==='ruleKinds'){
     for(const [rule,classification]of Object.entries(v))add('ruleKinds:'+rule,{ruleKinds:{[rule]:classification}});
    }else add(key,{[key]:clone(v)});
   }
  }
 }
 return {claims,originals};
}
function resolved(c,maps,table){
 const entity=id=>id===null||maps.entities.some(e=>e.id===id);
 if(c.kind==='attribute')return entity(c.subject_id)&&(c.field_id===null||table.fields.some(f=>f.id===c.field_id));
 if(c.kind==='relation')return entity(c.from_id)&&entity(c.to_id);
 if(c.kind==='event')return c.participant_ids.every(entity)&&entity(c.location_id);
 if(c.kind==='plan')return entity(c.subject_id);
 if(c.kind==='setting')return (c.data.geography?.links??[]).every(link=>entity(link.from)&&entity(link.to));
 return true;
}
const clean=c=>{
 const keys=['id','kind','subject_id','field_id','suggested_field','value','from_id','to_id','text','state','geography_type','bearing','direction','via','condition','participant_ids','location_id','status','goal','visibility','data','setting_key','story_time','time_basis','qualifiers','scope'];
 const record=Object.fromEntries(keys.filter(k=>Object.hasOwn(c,k)).map(k=>[k,clone(c[k])]));
 if(c.equivalent_records?.length>1)record.metadata_variants=c.equivalent_records.map(r=>Object.fromEntries(['story_time','time_basis','qualifiers','scope'].filter(k=>Object.hasOwn(r,k)).map(k=>[k,clone(r[k])])));
 return record;
};
export function registrationGroups(row,table,maps,claims){
 const buckets=new Map(),direct=[],groups=[];
 const declared=[...registrationDeclarations(row,'ab-prelude','locations'),...registrationDeclarations(row,'ab-a','entities'),...registrationDeclarations(row,'ab-b','entities')],declaredFields=registrationDeclarations(row,'ab-prelude','fields');
 for(const c of claims){
  let key;
  if(c.kind==='attribute')key=['attribute',c.subject_id,c.field_id??c.suggested_field];
  else if(c.kind==='relation')key=['relation',c.from_id,c.to_id];
  else if(c.kind==='setting')key=['setting',c.setting_key.startsWith('geography.place:')?null:c.scope,c.setting_key];
  else if(['event','plan'].includes(c.kind)&&!resolved(c,maps,table))key=[c.kind,c.id];
  else continue;
  const k=canonicalSourceJson(key);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(c);
 }
 for(const [key,records]of buckets){
  const values=new Map();
  for(const c of records){
   const value=canonicalSourceJson(c.kind==='attribute'?c.value:['event','plan'].includes(c.kind)?clean(c):c.kind==='relation'?[c.text,c.state,c.geography_type??null,c.direction??null,c.bearing??null,c.via??null,c.condition??null]:c.data);
   const prior=values.get(value);
   if(prior){prior.claim_ids.push(c.id);prior.equivalent_records.push(clone(c));prior.source_refs.push(...clone(c.source_refs));prior.sources=[...new Set([...prior.sources,...c.sources])];}
   else values.set(value,{...clone(c),claim_ids:[c.id],equivalent_records:[clone(c)]});
  }
  const candidates=[...values.values()],first=candidates[0];
  const unknown=candidates.some(c=>!resolved(c,maps,table));
  if(candidates.length===1&&!unknown){direct.push({key,candidates});continue;}
  const owners=candidates.flatMap(c=>[c.subject_id,c.object_id,...(c.participant_ids??[]),c.location_id,...(c.data?.geography?.places??[]).map(p=>p.id),...(c.data?.geography?.links??[]).flatMap(l=>[l.from,l.to])]).filter(Boolean),relatedCalls=new Set(records.map(c=>c.call_id));
  for(const c of records){const call=row.staged.plan.calls.find(x=>x.call_id===c.call_id);if(call?.stage==='ab-b'){const a=calls(row,'ab-a').find(x=>x.package_index===call.package_index);if(a)relatedCalls.add(a.call_id);}const prelude=calls(row,'ab-prelude').find(x=>x.package_index===call?.package_index);if(prelude)relatedCalls.add(prelude.call_id);}
  // These identifiers only select context for K; the saved identity mappings stay untouched.
  const related=unknown?declared.filter(d=>[...relatedCalls].some(id=>d.ref.startsWith(id+':'))):[],relatedRefs=new Set(related.map(d=>d.ref)),relatedLocalIds=new Set(related.map(d=>d.local_id));
  const unresolved=new Set(owners.filter(id=>!maps.entities.some(e=>e.id===id)));
  const declarations=related.filter(d=>unresolved.has(d.ref)).map(({ref,local_id,name,kind,aliases,clues})=>({ref,local_id,name,kind,aliases,clues}));
  const unresolvedFields=new Set(candidates.filter(c=>c.kind==='attribute'&&c.field_id!==null&&!table.fields.some(f=>f.id===c.field_id)).map(c=>c.field_id));
  const field_declarations=declaredFields.filter(d=>unresolvedFields.has(d.ref)).map(({ref,local_id,name,meaning,kinds})=>({ref,local_id,name,meaning,kinds}));
  groups.push({id:'ab-group:'+hash([key,records.map(c=>c.id).sort()]),kind:first.kind,
   field:first.kind==='attribute'?(table.fields.find(f=>f.id===first.field_id)??first.suggested_field):null,
   entities:maps.entities.filter(e=>owners.includes(e.id)||unknown&&e.member_refs.some(r=>relatedRefs.has(r)||relatedLocalIds.has(r)||[...relatedCalls].some(id=>r.startsWith(id+':')))).map(({id,name,kind,aliases,clues})=>({id,name,kind,aliases,clues})),
   ...(declarations.length?{declarations}:{}),...(field_declarations.length?{field_declarations}:{}),
   ...(unknown&&first.kind!=='setting'?{fields:clone(table.fields.map(({id,name,meaning,kinds})=>({id,name,meaning,kinds})))}:{}),candidates:clone(candidates)});
 }
 return {direct,groups};
}
export function registrationGroupInput(groups){return groups.map(g=>({...clone(g),field:g.field?Object.fromEntries(['id','name','meaning','kinds'].filter(key=>Object.hasOwn(g.field,key)).map(key=>[key,clone(g.field[key])])):null,candidates:g.candidates.map(clean)}));}
export function registrationVariants(record){
 const associations=['subject_id','field_id','from_id','to_id','participant_ids','location_id','object_id'];
 return (record.equivalent_records?.length?record.equivalent_records:[record]).map(original=>{
  const c=clone(original);for(const key of associations)if(Object.hasOwn(record,key))c[key]=clone(record[key]);
  // Each geography claim contains one link; bindings change its endpoints, not its original meaning.
  if(record.kind==='setting'&&record.data.geography?.links?.length===1&&c.data.geography?.links?.length===1){
   c.data.geography.links[0].from=record.data.geography.links[0].from;c.data.geography.links[0].to=record.data.geography.links[0].to;
  }
  c.claim_ids=[c.id];return c;
 });
}
export function applyRegistrationBindings(candidates,bindings=[]){
 return candidates.map(original=>{
  const c=clone(original);
  for(const b of bindings)if(b.record_id===c.id||c.claim_ids?.includes(b.record_id)){
   if(c.kind==='setting'&&c.data.geography?.links?.length===1&&['from_id','to_id'].includes(b.slot))c.data.geography.links[0][b.slot==='from_id'?'from':'to']=b.ids[0]??null;
   else c[b.slot]=b.slot==='participant_ids'?clone(b.ids):b.ids[0]??null;
  }
  if(c.kind==='relation'){c.subject_id=c.from_id;c.object_id=c.to_id;}
  if(c.kind==='event')c.subject_id=c.participant_ids[0]??null;
  if(c.equivalent_records)c.equivalent_records=registrationVariants(c);
  return c;
 });
}
