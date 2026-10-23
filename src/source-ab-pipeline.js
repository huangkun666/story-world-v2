// AB is a versioned semantic plan inside the existing creation task lifecycle.
import {sha256Hex} from './browser-capabilities.js';
import {buildSourceJobPlan} from './source-jobs.js';
import {chunkContent} from './source-stages.js';
import {canonicalSourceJson} from './source-records.js';
import {normalizeFieldDefinition,validateConfirmedFieldTable} from './source-field-table.js';
import {responseContractPrompt} from './source-response-contract.js';
import {parseModelJson} from './model-json.js';
import {SOURCE_WORKSPACE_PROTOCOL} from './source-workspace.js';
import {finalizedRecords,validateFinalizedPublication} from './finalized-source.js';
import {SOURCE_AB_PROTOCOL,abPrompt,abResponseFormat,validateAbResponse} from './source-ab-contract.js';
import {freezeAbFieldWire,encodeAbFieldInput,decodeAbFieldResponse} from './source-ab-field-wire.js';
import {registrationDeclarations,registrationMapped,registrationLinks,registrationSourceRefs,registrationClaims,registrationGroups,registrationGroupInput,registrationVariants,applyRegistrationBindings} from './source-ab-registration.js';
export {SOURCE_AB_PROTOCOL} from './source-ab-contract.js';
const clone=v=>structuredClone(v),hash=v=>sha256Hex(canonicalSourceJson(v));
const ref=(call,id)=>call.call_id+':'+id;
const fail=m=>{throw TypeError('AB抽象：'+m);};
const byStage=(row,stage)=>row.staged.plan.calls.filter(c=>c.stage===stage);
const block=(row,call)=>row.staged.blocks[call.call_id]??={call_id:call.call_id,status:'pending',result:[],completed_units:[],attempt_count:0,attempt_ids:[],receipts:[],error:null};
const result=(row,call)=>row.staged.blocks[call.call_id]?.result?.[0];
const success=(row,call)=>block(row,call).status==='succeeded';
function makeCall(stage,base={},dependencies=[]){
 return {...clone(base),call_id:'ab-'+hash([SOURCE_AB_PROTOCOL,stage,base.chunk_ids??[],base.package_index??null]),
  stage,scope:'world',units:[stage],dependencies,ab_version:1};
}
export function initialAbCreationPlan(input,config){
 const base=buildSourceJobPlan(input.entries,'world',{chunkChars:config.chunk_chars,maxTokens:config.max_tokens,semantic:true,fieldReview:true,wholeEntries:true});
 const packages=base.calls.filter(c=>c.stage==='facts').map((c,package_index)=>({...clone(c),package_index}));
 const preludes=packages.map(c=>makeCall('ab-prelude',c));
 const all={chunk_ids:base.chunks.map(c=>c.chunk_id),refs:base.chunks.map(c=>c.ref),chars:base.chunks.reduce((n,c)=>n+c.chars,0)};
 const unify=makeCall('ab-unify-prelude',all,preludes.map(c=>c.call_id));
 const a=packages.map(c=>makeCall('ab-a',c,[unify.call_id]));
 const b=packages.map((c,i)=>makeCall('ab-b',c,[a[i].call_id]));
 const identities=makeCall('ab-unify-identities',all,[...a,...b].map(c=>c.call_id));
 return {schema:1,result_version:1,config:clone(config),entries:clone(input.entries),library_id:input.library_id,import_id:input.import_id,
  extractor_key:SOURCE_AB_PROTOCOL,items:input.entries.map(e=>({source_id:e.source_id,content_hash:sha256Hex(e.content),status:'pending'})),
  staged:{protocol:SOURCE_AB_PROTOCOL,delivery_version:1,mode:'world',registration_only:true,ab_field_wire_version:1,
   plan:{...clone(base),protocol:SOURCE_AB_PROTOCOL,calls:[...preludes,unify,...a,...b,identities]},blocks:{}}};
}
function sourceItems(row,call){
 return row.staged.plan.chunks.filter(c=>call.chunk_ids.includes(c.chunk_id)).map(c=>{
  const e=row.entries.find(e=>e.source_id===c.source_id);let metadata=clone(e.metadata??{});
  if(typeof metadata.original?.rawText==='string'&&typeof metadata.original.readMode==='string'){delete metadata.original;delete metadata.selection;}
  return {...clone(c),content:chunkContent(e,c),metadata};
 });
}
function declarations(row,stage,key){
 if(row.staged.registration_only)return registrationDeclarations(row,stage,key);
 return byStage(row,stage).flatMap(c=>(result(row,c)?.[key]??[]).map(d=>({...clone(d),ref:ref(c,d.local_id)})));
}
function mappedIdentities(groups,declarations){
 const byRef=new Map(declarations.map(e=>[e.ref,e]));
 return groups.map(g=>({...clone(g),id:'ab-identity:'+hash([...g.member_refs].sort()),
  clues:[...new Set([g.clues,...g.member_refs.map(r=>byRef.get(r).clues)].filter(Boolean))].join('\n')||null,
  aliases:[...new Set([...g.aliases,...g.member_refs.flatMap(r=>{const e=byRef.get(r);return [e.name,...e.aliases];})])].filter(n=>n!==g.name)}));
}
function preludeMaps(row){
 const call=byStage(row,'ab-unify-prelude')[0],value=result(row,call);
 if(!value)return null;
 const definitions=new Map();
 for(const f of value.fields){
  const key=canonicalSourceJson([f.name,f.meaning,[...f.kinds].sort()]),prior=definitions.get(key);
  if(prior){prior.sources=[...new Set([...prior.sources,...(f.sources??[])])];prior.member_refs.push(...f.member_refs);}
  else definitions.set(key,{...clone(f),sources:clone(f.sources??[])});
 }
 if(row.staged.registration_only){const declared=new Map(declarations(row,'ab-prelude','fields').map(f=>[f.ref,f]));for(const f of definitions.values())f.sources=[...new Set(f.member_refs.flatMap(r=>declared.get(r)?.sources??[]))];}
 const fields=[...definitions.values()].map((f,index)=>{const id='field-'+hash([SOURCE_AB_PROTOCOL,'prelude-field',[...f.member_refs].sort(),...(row.staged.registration_only?[index]:[])]);return row.staged.registration_only?{id,name:f.name,meaning:f.meaning,kinds:[...new Set(f.kinds)].sort(),sources:clone(f.sources),origin:'model',source_optional:true,member_refs:clone(f.member_refs)}:{...normalizeFieldDefinition({...f,id}),member_refs:clone(f.member_refs)};});
 const places=(row.staged.registration_only?registrationMapped:mappedIdentities)(value.locations,declarations(row,'ab-prelude','locations'),call.call_id);
 return {fields,places,field_links:row.staged.registration_only?registrationLinks(fields):new Map(fields.flatMap(f=>f.member_refs.map(r=>[r,f.id]))),
  place_links:row.staged.registration_only?registrationLinks(places):new Map(places.flatMap(e=>e.member_refs.map(r=>[r,e.id])))};
}
function relatedLocations(row,call,prelude){
 const declarationsByRef=new Map(declarations(row,'ab-prelude','locations').map(e=>[e.ref,e]));
 const texts=sourceItems(row,call).map(s=>s.content);
 const referenced=new Set();
 if(call.stage==='ab-b'){
  const a=byStage(row,'ab-a').find(c=>c.package_index===call.package_index),value=result(row,a);
  for(const r of value?.relations??[])for(const id of [r.from_id,r.to_id])referenced.add(id);
  for(const a of value?.attributes??[])referenced.add(a.subject_id);
 }
 // Literal mentions retain every matching same-name candidate; they never choose or merge identities.
 return prelude.places.filter(place=>referenced.has(place.id)
  ||place.member_refs.some(ref=>(declarationsByRef.get(ref)?.sources??[]).some(source=>call.refs.includes(source)))
  ||[place.name,...place.aliases].some(name=>texts.some(text=>text.includes(name))));
}
function inputFor(row,call,task){
 const declared=(stage,key)=>{const items=declarations(row,stage,key);return row.staged.registration_only?items.map(({sources,...d})=>d):items;};
 const confirmed=()=>{const table=validateConfirmedFieldTable(task.field_review.confirmed);return row.staged.registration_only?{...table,fields:table.fields.map(({id,name,meaning,kinds})=>({id,name,meaning,kinds}))}:table;};
 const common={protocol:SOURCE_AB_PROTOCOL,result_version:1,stage:call.stage};
 if(call.stage==='ab-prelude')return {...common,sources:sourceItems(row,call)};
 if(call.stage==='ab-unify-prelude')return {...common,fields:declared('ab-prelude','fields'),locations:declared('ab-prelude','locations')};
 const prelude=preludeMaps(row),places=['ab-a','ab-b'].includes(call.stage)?relatedLocations(row,call,prelude):prelude.places,
  locations=places.map(({id,name,kind,aliases,clues})=>({id,name,kind,aliases,clues}));
 if(call.stage==='ab-a')return {...common,sources:sourceItems(row,call),field_table:confirmed(),locations};
 if(call.stage==='ab-b'){
  const a=byStage(row,'ab-a').find(c=>c.package_index===call.package_index);
  return {...common,sources:sourceItems(row,call),entities:result(row,a).entities.map(e=>({id:e.local_id,name:e.name,kind:e.kind,aliases:clone(e.aliases),clues:e.clues})),locations};
 }
 if(call.stage==='ab-unify-identities')return {...common,entities:[...declared('ab-a','entities'),...declared('ab-b','entities')],locations};
 return {...common,groups:row.staged.registration_only?registrationGroupInput(row.staged.ab.groups):clone(row.staged.ab.groups)};
}
function describe(row,call,task){
 if(!call.input){
  const input=inputFor(row,call,task);
  if(row.staged.ab_field_wire_version===1&&['ab-a','ab-organize'].includes(call.stage)){
   call.field_wire=freezeAbFieldWire(input,task.field_review.confirmed.fields.map(f=>f.id));
   call.input=encodeAbFieldInput(input,call.stage,call.field_wire);
  }else call.input=input;
 }
 const response_format=abResponseFormat(call.stage);
 return {kind:'model',call:clone(call),input:clone(call.input),prompt:responseContractPrompt(abPrompt(call),response_format,{previous:block(row,call).previous??null}),response_format,
  items:clone(call.input.sources??[]),pending_units:[...call.units],
  options:{stage:call.stage,call_id:call.call_id,run_id:task.run_id,import_id:task.import_id,library_id:task.library_id,
   scope:task.scope,snapshot_id:task.snapshot_id,source_max_tokens:row.config.max_tokens,source_stream:row.config.stream!==false,ab_version:1}};
}
export function summarizeAbBlocks(pipeline,attempts=[]){
 const summary={total:pipeline.staged.plan.calls.length,succeeded:0,failed:0,format_failed:0,unknown:0,pending:0},blockers=[];
 for(const [index,call]of pipeline.staged.plan.calls.entries()){
  const b=pipeline.staged.blocks[call.call_id]??{},latest=attempts.filter(a=>a.call_id===call.call_id).sort((a,b)=>a.sequence-b.sequence).at(-1);
  const unknown=['unknown','requested'].includes(b.status)||latest&&!latest.receipt&&['reserved','dispatched'].includes(latest.status);
  if(unknown){summary.unknown++;blockers.push({call_id:call.call_id,index:index+1,unknown:true,code:'request-unknown',reason:'原请求结果尚未确认，禁止自动重发',repairable:false});}
  else if(b.status==='succeeded')summary.succeeded++;
  else if(b.status==='failed'){summary.failed++;if(b.error?.stage==='validation')summary.format_failed++;
   blockers.push({call_id:call.call_id,index:index+1,code:['truncation','truncated'].includes(b.failure?.type)?'capacity':'validation',reason:b.error?.message??'请求失败，原回执保留',repairable:false});}
  else summary.pending++;
 }
 blockers.sort((a,b)=>Number(!!b.unknown)-Number(!!a.unknown)||a.index-b.index);
 return {summary,blockers};
}
function entityMaps(row){
 const pre=preludeMaps(row),c=byStage(row,'ab-unify-identities')[0],all=[...declarations(row,'ab-a','entities'),...declarations(row,'ab-b','entities')];
 const entities=[...pre.places,...(row.staged.registration_only?registrationMapped:mappedIdentities)(result(row,c).entities,all,c.call_id)];
 const links=row.staged.registration_only?registrationLinks(entities):new Map(entities.flatMap(e=>e.member_refs.map(r=>[r,e.id])));
 return {...pre,entities,links};
}
function sourceRefs(row,sources){
 const chunks=row.staged.plan.chunks;
 const ids=[...new Set(sources.map(r=>chunks.find(c=>c.ref===r).source_id))];
 return ids.map(source_id=>({source_id,content_hash:row.items.find(i=>i.source_id===source_id).content_hash,task_id:row.import_id}));
}
function collectClaims(row,table,maps){
 if(row.staged.registration_only)return registrationClaims(row,table,maps);
 const claims=[],originals=[];
 for(const call of row.staged.plan.calls.filter(c=>['ab-prelude','ab-a','ab-b'].includes(c.stage))){
  const value=result(row,call),a=byStage(row,'ab-a').find(c=>c.package_index===call.package_index);
  const localOwn=new Set((value.entities??value.locations??[]).map(e=>e.local_id));
  const identity=id=>{
   if(maps.entities.some(e=>e.id===id))return id;
   const owner=call.stage==='ab-b'&&!localOwn.has(id)?a:call;
   return maps.links.get(ref(owner,id))??fail('已收记载的身份映射缺失');
  };
  const claimId=(key,id)=>'ab-claim:'+hash([call.call_id,key,id]);
  for(const [key,kind]of [['attributes','attribute'],['relations','relation'],['settings','setting'],['events','event'],['plans','plan']]){
   for(const raw of value[key]??[]){
    const c={...clone(raw),id:claimId(key,raw.local_id),kind,source_refs:sourceRefs(row,raw.sources),call_id:call.call_id};
    c.supersedes=(raw.supersedes??[]).map(id=>claimId(key,id));
    if(kind==='attribute'){
     c.subject_id=identity(c.subject_id);
     if(call.stage==='ab-prelude'&&c.field_id!==null){
      const original=maps.fields.find(f=>f.id===maps.field_links.get(ref(call,c.field_id)));
      if(!original)fail('地点字段映射缺失');
      c.field_id=original.id;
      if(!table.fields.some(f=>f.id===c.field_id&&f.kinds.includes('location'))){c.field_id=null;c.suggested_field={name:original.name,meaning:original.meaning,kinds:original.kinds};}
     }
     c.nature='fact';c.object_id=null;
    }else if(kind==='relation'){
     c.subject_id=identity(c.from_id);c.object_id=identity(c.to_id);c.from_id=c.subject_id;c.to_id=c.object_id;c.relation_kind=c.text;c.value=c.text;c.nature='fact';
    }else if(kind==='event'){
     c.participant_ids=c.participant_ids.map(identity);c.location_id=c.location_id===null?null:identity(c.location_id);c.subject_id=c.participant_ids[0]??null;c.nature='fact';
    }else if(kind==='plan'){c.subject_id=identity(c.subject_id);c.nature='plan';}
    originals.push(clone(c));
    if(kind==='setting'){
     const entries=Object.entries(c.data);
     for(const [key,v]of entries){
      if(key==='ruleKinds'&&Object.hasOwn(c.data,'rules'))continue;
      const data={[key]:clone(v)};if(key==='rules'&&c.data.ruleKinds)data.ruleKinds=clone(c.data.ruleKinds);
      claims.push({...clone(c),id:'ab-setting:'+hash([c.id,key]),original_record_id:c.id,data,setting_key:key,
       supersedes:c.supersedes.map(id=>'ab-setting:'+hash([id,key]))});
     }
    }else claims.push(c);
   }
  }
 }
 return {claims,originals};
}
const semantic=c=>{const {id,local_id,sources,source_refs,supersedes,call_id,original_record_id,claim_ids,...rest}=c;return canonicalSourceJson(rest);};
function candidateGroups(row,table,maps,claims){
 if(row.staged.registration_only)return registrationGroups(row,table,maps,claims);
 const buckets=new Map(),direct=[],groups=[];
 for(const c of claims){
  let key;
  if(c.kind==='attribute')key=['attribute',c.subject_id,c.field_id??c.suggested_field];
  else if(c.kind==='relation')key=['relation',c.from_id,c.to_id];
  else if(c.kind==='setting')key=['setting',c.scope,c.setting_key];
  else continue;
  const k=canonicalSourceJson(key);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(c);
 }
 for(const [key,records]of buckets){
  const merged=new Map();
  for(const c of records){
   const s=semantic(c),old=merged.get(s);
   if(old){old.claim_ids.push(c.id);old.sources=[...new Set([...old.sources,...c.sources])];old.source_refs=[...new Map([...old.source_refs,...c.source_refs].map(r=>[canonicalSourceJson(r),r])).values()];old.supersedes=[...new Set([...old.supersedes,...c.supersedes])];}
   else merged.set(s,{...clone(c),claim_ids:[c.id]});
  }
  const candidates=[...merged.values()],ids=new Set(records.map(c=>c.id));
  const superseded=new Set(candidates.flatMap(c=>c.supersedes));
  if([...superseded].some(id=>!ids.has(id)))fail('明确先后超出了同一候选组');
  const roots=candidates.filter(c=>!c.claim_ids.every(id=>superseded.has(id)));
  if(!roots.length)fail('明确先后形成循环');
  if(roots.length===1){direct.push({key,candidates:roots});continue;}
  const first=candidates[0],owners=[first.subject_id,first.object_id].filter(Boolean);
  const group={id:'ab-group:'+hash([key,records.map(c=>c.id).sort()]),kind:first.kind,
   field:first.kind==='attribute'?(table.fields.find(f=>f.id===first.field_id)??first.suggested_field):null,
   entities:maps.entities.filter(e=>owners.includes(e.id)).map(({id,name,kind,aliases,clues})=>({id,name,kind,aliases,clues})),
   candidates:clone(candidates),related_events:claims.filter(c=>c.kind==='event'&&c.participant_ids.some(id=>owners.includes(id)))};
  groups.push(group);
 }
 return {direct,groups};
}
function ambiguity(group,selection){
 const chosen=group.candidates.filter(c=>selection.record_ids.includes(c.id));
 return {id:'ab-ambiguity:'+hash(group.id),subject_id:chosen[0]?.subject_id??null,field_id:chosen[0]?.field_id??null,relation_id:null,
  summary:selection.summary??'原文状态未定',claim_ids:chosen.flatMap(c=>c.claim_ids),alternatives:chosen.map(c=>({value:c.value??c.text??canonicalSourceJson(c.data),
   story_time:c.story_time,time_basis:c.time_basis,qualifiers:c.qualifiers,claim_ids:clone(c.claim_ids)}))};
}
// Canon text carries the explicit context; the untouched structured candidate remains in setting_records.
function scopedSettingData(record){
 const data=clone(record.data);
 const context=[['适用范围',record.scope],['原文时间',record.story_time],['时间参照',record.time_basis],['必要限定',record.qualifiers]]
  .filter(([,value])=>typeof value==='string'&&value.trim()).map(([label,value])=>label+'：'+value).join('；');
 if(!context)return data;
 const prefix=value=>'【'+context+'】'+value;
 for(const [key,value]of Object.entries(data)){
  if(typeof value==='string')data[key]=prefix(value);
  else if(key==='rules'||key==='historyNotes')data[key]=value.map(prefix);
  else if(key==='ruleKinds')data[key]=Object.fromEntries(Object.entries(value).map(([rule,kind])=>[prefix(rule),kind]));
  else if(key==='刻度')data[key]=value.map(table=>({...table,名:prefix(table.名)}));
  else if(key==='powerScale')data[key]=value.map(row=>({...row,note:prefix(row.note)}));
  else if(key==='dims')data[key]=value.map(row=>({...row,name:prefix(row.name)}));
  else if(key==='geography'){
   data[key].places=value.places.map(place=>({...place,qualifier:prefix(place.qualifier??'')}));
   data[key].links=value.links.map(link=>({...link,condition:prefix(link.condition??'')}));
  }
 }
 return data;
}
function buildPublication(row,task){
 const table=validateConfirmedFieldTable(task.field_review.confirmed),ab=row.staged.ab,maps=entityMaps(row);
 const entities=maps.entities.map(({id,name,kind,aliases,clues})=>({id,name,kind,aliases,clues,fields:[]}));
 const final={...(row.staged.registration_only?{registration_only:true,geography_name_choices:[]}:{}),protocol:SOURCE_WORKSPACE_PROTOCOL,ab_protocol:SOURCE_AB_PROTOCOL,result_version:1,workspace_revision:1,
  current:{entities,relations:[]},settings:[],setting_records:[],history:[],events:[],plans:[],ambiguities:[],out_of_table:[],dispositions:[],
  provenance:{identity_declarations:[...declarations(row,'ab-prelude','locations'),...declarations(row,'ab-a','entities'),...declarations(row,'ab-b','entities')].map(e=>({...e,source_refs:row.staged.registration_only?registrationSourceRefs(row,row.staged.plan.calls.find(c=>e.ref.startsWith(c.call_id+':'))):sourceRefs(row,e.sources)})),identity_links:[...maps.links].map(([ref,id])=>({ref,id})),claims:clone(ab.claims),original_records:clone(ab.originals),...(row.staged.registration_only?{registration_mappings:{fields:clone(result(row,byStage(row,'ab-unify-prelude')[0]).fields),locations:clone(result(row,byStage(row,'ab-unify-prelude')[0]).locations),entities:clone(result(row,byStage(row,'ab-unify-identities')[0]).entities)}}:{}),
   task_receipts:row.staged.plan.calls.map(c=>({call_id:c.call_id,attempt_ids:clone(row.staged.blocks[c.call_id].attempt_ids)}))}};
 const organized=byStage(row,'ab-organize')[0],decisions=organized?result(row,organized).groups:[];
 const selections=[...ab.direct];
 for(const g of ab.groups){
  const d=decisions.find(d=>d.group_id===g.id);if(!d){if(row.staged.registration_only){final.ambiguities.push(ambiguity(g,{record_ids:g.candidates.map(c=>c.id),summary:'原文状态未定'}));final.out_of_table.push(...clone(g.candidates));continue;}fail('候选组缺少组织决定');}
  if(d.mode==='ambiguous'){final.ambiguities.push(ambiguity(g,d));if(row.staged.registration_only)final.out_of_table.push(...clone(g.candidates));continue;}
  const geographyPlace=row.staged.registration_only&&g.kind==='setting'&&g.candidates[0].setting_key?.startsWith('geography.place:');
  const selectedRecords=geographyPlace?[...new Set(d.record_ids)].flatMap(id=>g.candidates.filter(c=>c.id===id)):g.candidates.filter(c=>d.record_ids.includes(c.id));
  const chosen=row.staged.registration_only?applyRegistrationBindings(selectedRecords,d.bindings):selectedRecords;
  if(!chosen.length&&row.staged.registration_only){final.out_of_table.push(...clone(g.candidates));final.ambiguities.push(ambiguity(g,{record_ids:g.candidates.map(c=>c.id),summary:'原文状态未定'}));continue;}
  if(geographyPlace&&chosen.length){const place=chosen[0].data.geography.places[0];final.geography_name_choices.push({place_id:place.id,record_id:chosen[0].id,name:place.name});}
  if(d.mode==='equivalent'&&!row.staged.registration_only){
   const combined={...clone(chosen[0]),claim_ids:chosen.flatMap(c=>c.claim_ids),equivalent_records:clone(chosen)};
   selections.push({key:g.id,candidates:[combined]});
  }else selections.push({key:g.id,candidates:chosen});
 }
 const display=c=>c.value+(c.qualifiers&&!c.value.includes(c.qualifiers)?'（'+c.qualifiers+'）':'');
 for(const group of selections){
  const chosen=row.staged.registration_only&&['relation','setting'].includes(group.candidates[0].kind)?group.candidates.flatMap(registrationVariants):group.candidates,first=chosen[0];
  if(row.staged.registration_only&&first.kind==='attribute'){
   for(const c of chosen){
    const e=entities.find(e=>e.id===c.subject_id),field=table.fields.find(f=>f.id===c.field_id);
    if(!e||!field){if(!final.out_of_table.some(r=>r.id===c.id))final.out_of_table.push(clone(c));continue;}
    let f=e.fields.find(f=>f.field_id===c.field_id);
    if(!f){f={id:'ab-field:'+hash([e.id,c.field_id]),field_id:c.field_id,value:'',claim_ids:[],records:[]};e.fields.push(f);}
    f.records.push(clone(c));f.claim_ids.push(...c.claim_ids);f.value=[...new Set(f.records.flatMap(record=>(record.equivalent_records?.length?record.equivalent_records:[record]).map(display)))].join('\n');
   }
   continue;
  }
  if(row.staged.registration_only&&first.kind==='relation'&&chosen.some(c=>!entities.some(e=>e.id===c.from_id)||!entities.some(e=>e.id===c.to_id))){final.out_of_table.push(...clone(chosen));final.ambiguities.push(ambiguity({id:group.key,candidates:chosen},{record_ids:chosen.map(c=>c.id),summary:'原文关联未定'}));continue;}
  if(first.kind==='attribute'){
   if(first.field_id===null){final.out_of_table.push(...clone(chosen));continue;}
   const e=entities.find(e=>e.id===first.subject_id);
   e.fields.push({id:'ab-field:'+hash([e.id,first.field_id]),field_id:first.field_id,value:chosen.map(display).join('\n'),
    claim_ids:chosen.flatMap(c=>c.claim_ids),records:clone(chosen)});
  }else if(first.kind==='relation'){
   for(const c of chosen){
    if(c.state==='unknown'){
     final.ambiguities.push(ambiguity({id:c.id,candidates:[c]},{record_ids:[c.id],summary:'原文关系状态未明'}));continue;
    }
    final.current.relations.push({id:c.id,from_id:c.from_id,to_id:c.to_id,kind:display({...c,value:c.text}),state:c.state,story_time:c.story_time,time_basis:c.time_basis,qualifiers:c.qualifiers,claim_ids:clone(c.claim_ids)});
   }
  }else if(first.kind==='setting')for(const c of chosen){final.setting_records.push(clone(c));final.settings.push({record_kind:'setting',id:c.id,...(row.staged.registration_only?{original_record_id:c.original_record_id}:{}),data:scopedSettingData(c),source_refs:clone(c.source_refs)});}
 }
 // All unconfirmed values remain available, including candidates whose organization is unresolved.
 for(const c of ab.claims.filter(c=>c.kind==='attribute'&&c.field_id===null))if(!final.out_of_table.some(r=>r.id===c.id))final.out_of_table.push(clone(c));
 const initial={version:1,events:[],plans:[]};
 const groupedBIds=new Set(row.staged.registration_only?ab.groups.filter(g=>['event','plan'].includes(g.kind)).flatMap(g=>g.candidates.flatMap(c=>c.claim_ids)):[]);
 for(const c of ab.claims){
  if(!['event','plan'].includes(c.kind))continue;
  const selected=row.staged.registration_only?selections.flatMap(g=>g.candidates).find(record=>record.claim_ids?.includes(c.id)):null;
  if(row.staged.registration_only&&(groupedBIds.has(c.id)&&!selected||selected&&selected.claim_ids[0]!==c.id))continue;
  const {call_id,supersedes,...record}=clone(selected??c);record.claim_ids=clone(selected?.claim_ids??[c.id]);
  if(c.status==='completed'){final.history.push({...record,text:c.kind==='plan'?c.text+'；目标：'+c.goal:c.text});continue;}
  if(c.kind==='event'){final.events.push(record);if(c.status==='ongoing')initial.events.push(clone(record));}
  else {final.plans.push(record);if(c.status==='pending')initial.plans.push(clone(record));}
 }
 const geography=selections.flatMap(g=>g.candidates).flatMap(c=>row.staged.registration_only&&c.kind==='relation'?registrationVariants(c):[c]).filter(c=>c.kind==='relation'&&c.geography_type&&c.state==='active').map(c=>{
  const keys=['geography_type','bearing','direction','via','condition'];
  return {record_kind:'relation',id:'ab-geography:'+hash(c.id),from_id:c.from_id,to_id:c.to_id,text:c.text,fact_type:'current',
   ...Object.fromEntries(keys.filter(k=>Object.hasOwn(c,k)).map(k=>[k,c[k]])),source_refs:clone(c.source_refs)};
 });
 if(row.staged.registration_only){
  const names=new Map(final.geography_name_choices.map(choice=>[choice.place_id,choice.name]));
  for(const setting of final.settings)for(const place of setting.data.geography?.places??[])if(names.has(place.id))place.name=names.get(place.id);
  const combined=[];
  for(const setting of final.settings){
   const prior=combined.find(s=>s.original_record_id===setting.original_record_id);
   if(prior&&Object.keys(setting.data).every(k=>!Object.hasOwn(prior.data,k))){Object.assign(prior.data,setting.data);prior.source_refs.push(...setting.source_refs);}
   else combined.push(setting);
  }
  final.settings=combined.map(({original_record_id,...s})=>s);
 }
 const records=finalizedRecords(final,table,{geography});
 const sources=row.entries.map(e=>({...clone(e),content_hash:row.items.find(i=>i.source_id===e.source_id).content_hash,task_id:row.import_id}));
 const publication={library_id:row.library_id,import_id:row.import_id,expected_version:0,version:1,omitted_source_ids:[],protocol:SOURCE_WORKSPACE_PROTOCOL,
  ab_protocol:SOURCE_AB_PROTOCOL,...(row.staged.registration_only?{ab_registration:1}:{}),result_version:1,extractor_key:row.extractor_key,field_table:table,finalized:final,ab_initial:initial,records,sources,geography};
 publication.finalized_digest=hash({finalized:final,field_table:table,records});validateFinalizedPublication(publication);
 row.staged.finalization={protocol:SOURCE_AB_PROTOCOL,status:'complete',result:clone(final)};
 row.staged.status='ab-complete';row.items.forEach(i=>i.status='succeeded');
 return publication;
}
export function nextAbCreationStep(task,pipeline){
 const row=clone(pipeline),answer=effect=>({pipeline:row,effect});
 if(task.status==='cancelled')return answer({kind:'blocked',code:'cancelled',reason:'任务已停止，已有内容保留'});
 const all=summarizeAbBlocks(row);
 if(all.blockers.length)return answer({kind:'blocked',...all.blockers[0],...all});
 const prelude=byStage(row,'ab-prelude'),unify=byStage(row,'ab-unify-prelude')[0];
 const pending=prelude.filter(c=>!success(row,c));
 const requests=calls=>{const r=calls.map(c=>describe(row,c,task));return r.length===1?r[0]:{kind:'models',requests:r};};
 if(pending.length)return answer(requests(pending));
 if(!success(row,unify))return answer(requests([unify]));
 if(!task.field_review?.confirmed){
  const pre=preludeMaps(row);
  return answer({kind:'fields',groups:[{protocol:SOURCE_AB_PROTOCOL,refs:[...new Set(pre.fields.flatMap(f=>f.sources))],fields:pre.fields.map(({member_refs,...f})=>clone(f))}]});
 }
 const extraction=row.staged.plan.calls.filter(c=>['ab-a','ab-b'].includes(c.stage));
 const ready=extraction.filter(c=>!success(row,c)&&c.dependencies.every(id=>success(row,row.staged.plan.calls.find(c=>c.call_id===id))));
 if(ready.length)return answer(requests(ready));
 const identities=byStage(row,'ab-unify-identities')[0];
 if(!success(row,identities))return answer(requests([identities]));
 if(!row.staged.ab){
  const maps=entityMaps(row),table=validateConfirmedFieldTable(task.field_review.confirmed),{claims,originals}=collectClaims(row,table,maps);
  row.staged.ab={claims,originals,...candidateGroups(row,table,maps,claims)};
  if(row.staged.ab.groups.length){
   const c=makeCall('ab-organize',{chunk_ids:[],refs:[],chars:0},[identities.call_id]);
   row.staged.plan.calls.push(c);
  }
 }
 const organize=byStage(row,'ab-organize')[0];
 if(organize&&!success(row,organize))return answer(requests([organize]));
 return answer({kind:'publish',publication:buildPublication(row,task)});
}
export function applyAbCreationResponse(task,pipeline,request,attempt,receipt){
 if(task.status==='cancelled')return {pipeline,outcome:'cancelled'};
 const row=clone(pipeline),call=row.staged.plan.calls.find(c=>c.call_id===request.call.call_id);
 if(!call||call.ab_version!==1||canonicalSourceJson(call)!==canonicalSourceJson(request.call))fail('回执请求与冻结任务不符');
 const b=block(row,call);
 if(b.attempt_ids.includes(attempt.attempt_id))return {pipeline,outcome:b.status};
 if(b.status==='succeeded'||['unknown','requested'].includes(b.status))return {pipeline,outcome:b.status};
 b.attempt_count++;b.attempt_ids.push(attempt.attempt_id);
 b.receipts??=[];b.receipts.push({attempt_id:attempt.attempt_id,receipt:clone(receipt)});
 if(!receipt.ok){
  b.status=receipt.unknown?'unknown':'failed';b.failure=clone(receipt.failure??{});b.context_rejected=receipt.failure?.context_rejected===true;
  b.error={stage:'transport',message:receipt.failure?.message??'未收到完整响应'};
 }else try{
  b.result=[validateAbResponse(call,decodeAbFieldResponse(parseModelJson(receipt.text),call.stage,call.field_wire))];b.status='succeeded';b.completed_units=[...call.units];b.error=null;
 }catch(error){
  b.status='failed';b.error={stage:'validation',message:String(error.message)};
  b.previous={attempt_id:attempt.attempt_id,error:b.error.message,response:receipt.text};
 }
 return {pipeline:row,outcome:b.status};
}
