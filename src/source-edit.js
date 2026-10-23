// 抽象结果的人工修订。纯函数：原稿、出版回执及推演历史不改。
import {validate} from './schema.js';
import {ssotSchema} from './schemas/ssot.schema.js';
import {EDITABLE_SETTING_KEYS,sourceProfileValueSchema} from './schemas/source-edit.schema.js';
import {projectSourceEntityFields} from './source-records.js';
import {scalesToFlat} from './abstract.js';
import {RULE_CLASSES} from './abstract-tier.js';
import {sha256Hex} from './browser-capabilities.js';

const copy=value=>structuredClone(value);
const canonOf=world=>world?.context?.setting?.frozen?.canon;
const own=(value,key)=>Object.hasOwn(value??{},key);
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function fail(message){throw new Error(message)}
export function sourceEditJson(value){
 if(value===undefined)return 'undefined';
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(sourceEditJson).join(',')+']';
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+sourceEditJson(value[k])).join(',')+'}';
}
const same=(a,b)=>sourceEditJson(a)===sourceEditJson(b);
function check(value,schema,label){const r=validate(value,schema);if(!r.ok)fail(label+'形状不合法：'+r.errors.join('；'))}
function assign(target,key,value){Object.defineProperty(target,key,{value:copy(value),enumerable:true,writable:true,configurable:true})}
export function sourcePublications(world){
 const out=[],seen=new Set();
 function walk(value){if(!plain(value)||seen.has(value))return;seen.add(value);out.push(value);for(const update of value.updates??[])walk(update)}
 walk(world?.meta?.sourcePublication);walk(world?.sourcePublication);return out;
}
function originals(world,id){
 const records=sourcePublications(world).flatMap(p=>p.records??[]).filter(r=>r.record_kind==='entity'&&r.id===id);
 if(records.length){if(records.some(r=>!same(r,records[0])))fail('此人物的原抽象档案存在冲突，请先核对来源');return records[0]}
 const stable=(world.meta?.sourceEdits?.originals??[]).filter(row=>row.id===id);
 if(stable.length>1)fail('原档案身份重复');
 if(stable.length)return {id,record_kind:'entity',kind:'character',...copy(stable[0].value)};
 // 旧档只有名号档案时，必须能唯一对应，不能把推演新增人物当抽象人物。
 const entity=world?.entities?.find(e=>e.id===id),canon=canonOf(world);
 const rows=(canon?.bookEntities??[]).filter(e=>e.name===entity?.name&&(!e.kind||e.kind===entity.kind));
 if(rows.length!==1||(world.entities??[]).filter(e=>e.name===entity?.name).length!==1)fail('此人物没有可唯一确认的抽象档案');
 const row=rows[0],fields={};
 for(const entry of (canon?.settings??[]).filter(e=>e.name===row.name&&(!e.kind||e.kind===entity.kind))){
  for(const [key,value]of Object.entries(entry.fields??{})){if(typeof value!=='string')continue;if(own(fields,key)&&fields[key]!==value)fail('旧人物抽象档案存在字段冲突');assign(fields,key,value)}
 }
 if(plain(row.fields))for(const [key,value]of Object.entries(row.fields))if(typeof value==='string')assign(fields,key,value);
 return {id,record_kind:'entity',kind:'character',name:row.name,aliases:row.aliases??[],fields};
}
const valueOf=record=>({name:record.name,aliases:copy(record.aliases??[]),fields:copy(record.fields??{})});
export function readSourceEntityDraft(world,id){
 const entity=world?.entities?.find(e=>e.id===id);
 if(!entity||entity.kind!=='character')fail('请选择抽象得到的人物档案');
 const original=originals(world,id);if(original.kind!=='character')fail('只编辑抽象人物档案');
 const values=(world.meta?.sourceEdits?.entities??[]).filter(e=>e.id===id);
 if(values.length>1)fail('人工档案身份重复，请核对');
 const value=copy(values[0]?.value??valueOf(original));
 check(value,sourceProfileValueSchema,'人物档案');
 return {kind:'entity',target:id,value};
}
export function readSourceSettingDraft(world,key){
 if(!EDITABLE_SETTING_KEYS.includes(key))fail('此项不在世界设定编辑范围内');
 const canon=canonOf(world);if(!canon)fail('当前世界没有已抽象的世界设定');
 const schema=ssotSchema.props.context.props.setting.props.frozen.props.canon.props[key];
 const value=own(canon,key)?copy(canon[key]):schema.kind==='array'?[]:'';
 const result={kind:'setting',target:key,value};
 if(key==='rules')result.ruleKinds=copy(canon.ruleKinds??{});
 return result;
}
export function editableSourceSettings(world){
 if(!canonOf(world))return [];
 return EDITABLE_SETTING_KEYS.filter(key=>!(canonOf(world).刻度?.length&&['powerScale','dims'].includes(key)));
}
function profile(value){
 if(!plain(value)||typeof value.name!=='string'||!value.name.trim())fail('人物名号不能为空');
 check(value,sourceProfileValueSchema,'人物档案');
 if(value.aliases.some(v=>!v.trim()))fail('别名不能为空');
 for(const [key,v]of Object.entries(value.fields))if(!key.trim()||typeof v!=='string')fail('档案字段必须是非空名称和文本值');
 return copy(value);
}
function projected(value){
 const out={name:value.name,aliases:value.aliases};
 const fields=projectSourceEntityFields(value.fields).fields;
 for(const [key,v]of Object.entries(fields)){
  if(own(ssotSchema.props.entities.items.props,key)&&typeof v==='string'&&!v.trim())continue;
  assign(out,key,v);
 }
 return out;
}
function updateEntity(next,id,before,after){
 const entity=next.entities.find(e=>e.id===id),a=projected(before),b=projected(after),preserved=[];
 for(const key of new Set([...Object.keys(a),...Object.keys(b)])){
  if(same(a[key],b[key])&&own(a,key)===own(b,key))continue;
  const current=key==='aliases'?entity[key]??[]:entity[key],expected=key==='aliases'?a[key]??[]:a[key];
  if(!same(current,expected)||key!=='aliases'&&own(entity,key)!==own(a,key)){preserved.push(key);continue}
  if(own(b,key))assign(entity,key,b[key]);else delete entity[key];
 }
 if(entity.location&&!next.context.positions.includes(entity.location))next.context.positions.push(entity.location);
 return preserved;
}
function stateOf(world){return copy(world.meta?.sourceEdits??{version:1,entities:[],settingKeys:[]})}
function setEntityOverride(state,world,id,value){
 const original=valueOf(originals(world,id));
 state.entities=state.entities.filter(e=>e.id!==id);
 if(!same(value,original))state.entities.push({id,value:copy(value)});
}
function ruleKindsFor(before,after,oldKinds,supplied){
 if(supplied!==undefined&&!plain(supplied))fail('法则用途分类必须是对象');
 const kinds={};
 for(let i=0;i<after.length;i++){
  const key=after[i].trim();if(!key)continue;
  let kind=own(supplied,key)?supplied[key]:oldKinds[key];
  if(kind===undefined&&before[i]!==undefined)kind=oldKinds[String(before[i]).trim()];
  if(!before.includes(after[i])&&!RULE_CLASSES.includes(kind))fail('请为新增或修改的法则选择用途分类');
  if(kind!==undefined){if(!RULE_CLASSES.includes(kind))fail('法则用途分类无效');assign(kinds,key,kind)}
 }
 return kinds;
}
function changesOf(before,after,prefix=''){
 const result=[];
 function walk(a,b,label){
  if(same(a,b))return;
  if(plain(a)&&plain(b)){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[key],b[key],label?label+' / '+key:key);return}
  if(Array.isArray(a)&&Array.isArray(b)){for(let i=0;i<Math.max(a.length,b.length);i++)walk(a[i],b[i],label+' / '+(i+1));return}
  result.push({label:label||'内容',before:copy(a),after:copy(b)});
 }
 walk(before,after,prefix);return result;
}
function snapshotSetting(canon,keys){return Object.fromEntries(keys.map(key=>[key,own(canon,key)?{exists:true,value:copy(canon[key])}:{exists:false}]))}
function checkedWorld(world){check(world,ssotSchema,'修改后的世界');return world}
export function applySourceEdit(world,draft,change,{editId}={}){
 if(!draft||!['entity','setting'].includes(draft.kind)||!plain(change)||Object.keys(change).some(k=>!['value','ruleKinds'].includes(k)))fail('编辑内容字段不合法');
 if(typeof editId!=='string'||!editId.trim())fail('修改记录编号缺失');
 const current=draft.kind==='entity'?readSourceEntityDraft(world,draft.target):readSourceSettingDraft(world,draft.target);
 if(!same(current,draft))fail('抽象档案或设定已改变，请重新打开编辑');
 const before=draft.value;
 let after,beforeKinds,afterKinds;
 if(draft.kind==='entity')after=profile(change.value);
 else{
  const schema=ssotSchema.props.context.props.setting.props.frozen.props.canon.props[draft.target];
  check(change.value,schema,'世界设定');after=copy(change.value);
  if(draft.target==='rules'){beforeKinds=copy(draft.ruleKinds);afterKinds=ruleKindsFor(before,after,beforeKinds,change.ruleKinds)}
 }
 if(same(before,after)&&same(beforeKinds,afterKinds))return {changed:false,world,changes:[],preservedFields:[]};
 const next=copy(world),state=stateOf(world);
 const settingKeys=draft.kind==='setting'?[draft.target,...(draft.target==='刻度'?['powerScale','dims']:draft.target==='rules'?['ruleKinds']:[])]:[];
 const beforeSetting=settingKeys.length?snapshotSetting(canonOf(world),settingKeys):null;
 let preservedFields=[];
 const wasOverridden=draft.kind==='entity'?state.entities.some(e=>e.id===draft.target):state.settingKeys.includes(draft.target);
 if(draft.kind==='entity'){
  if(!sourcePublications(world).some(p=>(p.records??[]).some(r=>r.record_kind==='entity'&&r.id===draft.target))){
   state.originals??=[];if(!state.originals.some(row=>row.id===draft.target))state.originals.push({id:draft.target,value:valueOf(originals(world,draft.target))});
  }
  setEntityOverride(state,world,draft.target,after);
  preservedFields=updateEntity(next,draft.target,before,after);
 }else{
  const canon=canonOf(next);assign(canon,draft.target,after);
  if(draft.target==='rules')canon.ruleKinds=afterKinds;
  if(draft.target==='刻度'){
   const flat=scalesToFlat(after);canon.powerScale=flat.powerScale;canon.dims=flat.dims;
  }
  if(!state.settingKeys.includes(draft.target))state.settingKeys.push(draft.target);
 }
 state.last={id:editId,kind:draft.kind,target:draft.target,before:copy(before),after:copy(after),wasOverridden,
  ...(beforeKinds?{beforeRuleKinds:beforeKinds,afterRuleKinds:afterKinds}:{}),...(beforeSetting?{beforeSetting,afterSetting:snapshotSetting(canonOf(next),settingKeys)}:{})};
 next.meta.sourceEdits=state;
 return {changed:true,world:checkedWorld(next),changes:[...changesOf(before,after,draft.kind==='entity'?'人物档案':draft.target),...changesOf(beforeKinds,afterKinds,'法则用途')],preservedFields};
}
export function undoSourceEdit(world,expectedEditId,{editId}={}){
 const last=world?.meta?.sourceEdits?.last;
 if(!last||last.id!==expectedEditId)fail('可撤销的修改已改变，请重新核对');
 const draft=last.kind==='entity'?readSourceEntityDraft(world,last.target):readSourceSettingDraft(world,last.target);
 if(!same(draft.value,last.after)||last.afterRuleKinds&&!same(draft.ruleKinds,last.afterRuleKinds))fail('此项内容已经改变，不能覆盖后续修改来撤销');
 if(last.afterSetting&&!same(snapshotSetting(canonOf(world),Object.keys(last.afterSetting)),last.afterSetting))fail('此项关联设定已改变，不能覆盖后续修改来撤销');
 const result=applySourceEdit(world,draft,{value:last.before,...(last.beforeRuleKinds?{ruleKinds:last.beforeRuleKinds}:{})},{editId});
 if(!result.changed)return result;
 if(last.beforeSetting)for(const [key,entry]of Object.entries(last.beforeSetting)){
  if(entry.exists)assign(canonOf(result.world),key,entry.value);else delete canonOf(result.world)[key];
 }
 const state=result.world.meta.sourceEdits;
 if(last.kind==='setting'&&!last.wasOverridden)state.settingKeys=state.settingKeys.filter(k=>k!==last.target);
 delete state.last;
 checkedWorld(result.world);return result;
}
export function hasSourceSettingConflict(world,keys){
 return (world?.meta?.sourceEdits?.settingKeys??[]).some(key=>keys.includes(key)||key==='刻度'&&keys.some(k=>['powerScale','dims'].includes(k)));
}
export function effectiveSourceRecords(world,records){
 const edits=world?.meta?.sourceEdits;
 if(!edits||!edits.entities.length&&!edits.settingKeys.length)return records;
 const canon=canonOf(world),settingKeys=new Set(edits.settingKeys);
 if(settingKeys.has('刻度')){settingKeys.add('powerScale');settingKeys.add('dims')}
 if(settingKeys.has('rules'))settingKeys.add('ruleKinds');
 const settingData={};for(const key of settingKeys)if(own(canon,key))assign(settingData,key,canon[key]);
 const profiles=new Map(edits.entities.map(row=>[row.id,copy(row.value)]));
 const sourceIds=new Set();
 for(const publication of sourcePublications(world))for(const record of publication.records??[]){
  if(profiles.has(record.id)||record.record_kind==='setting'&&Object.keys(record.data??{}).some(k=>settingKeys.has(k)))
   for(const ref of record.source_refs??[])sourceIds.add(ref.source_id);
 }
 const explanation='人工修订只改变基础档案与世界设定；保留原稿用于追溯，修订内容以此处为准，当前推演状态仍以正式世界为准。';
 const out=records.map(record=>{
  if(record.record_kind==='entity'&&profiles.has(record.id))return {...copy(record),source_profile:profiles.get(record.id),source_edit_notice:explanation};
  if(record.record_kind==='setting'){
   const data=copy(record.data??{}),keys=Object.keys(data).filter(k=>settingKeys.has(k));
   if(keys.length){for(const key of keys)assign(data,key,settingData[key]);return {...copy(record),data,source_edit_notice:explanation}}
  }
  if(record.record_kind==='source'&&sourceIds.has(record.source_id))return {...copy(record),source_edits:{notice:explanation,entities:edits.entities.map(row=>copy(row)),settings:copy(settingData)}};
  return record;
 });
 if(Object.keys(settingData).length){
  const id='manual-setting:'+sha256Hex(sourceEditJson(settingData));
  if(!out.some(r=>r.id===id))out.push({id,record_kind:'setting',data:settingData,source_edit_notice:explanation});
 }
 return out;
}
