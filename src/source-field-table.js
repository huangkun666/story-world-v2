// A field table describes source attributes; it never grants permission to write world identity.
import {sha256Hex} from './browser-capabilities.js';
import {SOURCE_ENTITY_SYSTEM_KEYS,projectSourceEntityFields} from './source-records.js';

export const SOURCE_FIELD_PROTOCOL='source-jobs-v6';
const kinds=new Set(['character','faction','location']);
const reserved=new Set(['__proto__','prototype','constructor','id','kind','name','aliases','sources','source_id']);
const copy=value=>structuredClone(value);
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const text=(value,label)=>{if(typeof value!=='string'||!value.trim())throw new TypeError(label+'不能为空');return value.trim()};

export function normalizeFieldDefinition(value,{allowedSources=null,user=false}={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('字段必须是对象');
 const name=text(value.name,'字段名');
 if(value.meaning!==undefined&&typeof value.meaning!=='string')throw new TypeError('补充说明必须是文字');
 const meaning=(value.meaning??'').trim();
 if(reserved.has(name))throw new TypeError('身份和系统字段不能作为属性字段');
 if(!Array.isArray(value.kinds)||!value.kinds.length||value.kinds.some(k=>!kinds.has(k)))throw new TypeError('字段适用对象无效');
 const scope=[...new Set(value.kinds)].sort();
 const sourceOptional=value.source_optional===true;
 const sources=Array.isArray(value.sources)?[...new Set(value.sources)]:[];
 if(sources.some(s=>typeof s!=='string'||!s||!sourceOptional&&allowedSources&&!allowedSources.includes(s)))throw new TypeError('字段引用了未读取的来源');
 if(!user&&!sourceOptional&&!sources.length)throw new TypeError('模型字段必须有来源依据');
 const id=value.id===undefined?'field-'+sha256Hex(canonical([name,scope])):text(value.id,'字段编号');
 if(!/^field-[a-f0-9]{64}$/.test(id))throw new TypeError('字段编号无效');
 return {id,name,meaning,kinds:scope,sources,origin:user?'user':'model',...(sourceOptional?{source_optional:true}:{})};
}

export function collectFieldCandidates(groups){
 const result=[],seen=new Set();
 for(const group of groups??[]){
  if(!Array.isArray(group.fields))throw new TypeError('字段候选必须是数组');
  for(const raw of group.fields){
   const field=normalizeFieldDefinition(raw,{allowedSources:group.refs});
   const key=canonical([field.name,field.meaning,field.kinds]);
   const existing=result.find(f=>canonical([f.name,f.meaning,f.kinds])===key);
   if(existing){existing.sources=[...new Set([...existing.sources,...field.sources])];continue;}
   // Conflicting suggestions remain visible; confirmation requires the user to resolve them.
   if(seen.has(field.id))field.id='field-'+sha256Hex(canonical([field.id,field.meaning,field.sources]));
   seen.add(field.id);result.push(field);
  }
 }
 return result;
}

function normalizedFieldTable(candidates,edited){
 if(!Array.isArray(candidates)||!Array.isArray(edited))throw new TypeError('字段表必须是数组');
 const originals=new Map(candidates.map(f=>[f.id,f])),ids=new Set(),fields=[];
 for(const raw of edited){
  const original=originals.get(raw?.id);
  const registered=original?.source_optional?{...raw,source_optional:true}:raw;
  const unchanged=original&&canonical({...registered,origin:original.origin})===canonical(original);
  const field=normalizeFieldDefinition(registered,{user:unchanged?original.origin==='user':true});
  if(ids.has(field.id))throw new TypeError('字段编号重复');
  if(fields.some(f=>f.name===field.name&&f.kinds.some(k=>field.kinds.includes(k))))throw new TypeError('同一对象的字段名称重复，请先合并或改名');
  ids.add(field.id);fields.push(field);
 }
 return {version:1,revision:sha256Hex(canonical(fields)),fields:copy(fields)};
}

const tagNameConflict=name=>/[\r\n|｜]/.test(name);
export function confirmFieldTable(candidates,edited){
 const table=normalizedFieldTable(candidates,edited);
 for(const field of table.fields)if(tagNameConflict(field.name))throw new TypeError('字段名不能包含换行或标签分隔符 |、｜，请修改字段名后确认');
 return table;
}

export function fieldTablePrompt(table,{purpose='extraction'}={}){
 validateConfirmedFieldTable(table);
 if(purpose==='chat')return worldFieldWritePrompt({meta:{sourcePublication:{field_table:table}}});
 if(purpose!=='extraction')throw new TypeError('字段说明用途无效');
 return '用户已确认的属性字段：'+JSON.stringify(fieldPromptDefinitions(table))
  +'\n只抽取这些字段，适用对象必须匹配；原文没有依据就省略，不填默认值。实体身份、来源和明述位置仍走专门结构，不把自定义属性当作系统身份。';
}

export function fieldPromptDefinitions(table){
 return validateConfirmedFieldTable(table).fields.map(({name,meaning,kinds})=>({name,...(meaning?{meaning}:{}),kinds}));
}

export function validateConfirmedFieldTable(table){
 if(!table||table.version!==1||!Array.isArray(table.fields)||typeof table.revision!=='string')throw new TypeError('尚未确认字段表');
 // Historical originals keep their original normalization and revision checks.
 const normalized=normalizedFieldTable(table.fields,table.fields);
 if(canonical(normalized)!==canonical(table))throw new TypeError('已确认字段表内容或版本校验失败');
 return copy(table);
}

export const fieldCandidateRevision=candidates=>sha256Hex(canonical(candidates));

export function assertConfirmedProperty(table,{key,kind}){
 if(!table?.fields?.some(f=>f.name===key&&f.kinds.includes(kind)))throw new TypeError('属性不在已确认字段表中：'+key);
}

// Only definitions for values actually present in the consumer's entity rows.
export function fieldDefinitionsForEntities(table,entities=[]){
 if(!table)return [];
 return validateConfirmedFieldTable(table).fields.flatMap(({name,meaning,kinds})=>{
  const used=[...new Set(entities.filter(entity=>kinds.includes(entity.kind)
   &&(Object.hasOwn(entity,name)||Object.hasOwn(entity,'原文.'+name)||Object.hasOwn(entity.fields??{},name))).map(entity=>entity.kind))];
  return used.length?[{name,...(meaning?{meaning}:{}),kinds:used}]:[];
 });
}

// An effective schema is pinned to a formal world version. Extraction originals stay immutable.
// Missing, confirmed-empty and invalid are separate states; none permits a default property list.
const systemFields=new Set([...SOURCE_ENTITY_SYSTEM_KEYS,'__proto__','prototype','constructor']);
const safeKey=key=>typeof key==='string'&&!!key&&!systemFields.has(key);
const schemaDigest=(fields,retired)=>sha256Hex(canonical({fields,retired}));
function managedField(raw){
 const field=normalizeFieldDefinition(raw,{user:raw?.origin!=='model'});
 const storageKey=raw.storageKey??Object.keys(projectSourceEntityFields({[field.name]:''}).fields)[0];
 if((!safeKey(storageKey)&&storageKey!=='location')||tagNameConflict(field.name))throw new TypeError('字段与系统结构或标签分隔符冲突');
 const valueType=raw.valueType??'text';
 if(!['text','number','boolean','null','object','array'].includes(valueType))throw new TypeError('字段值形状无效');
  if(raw.enabled!==undefined&&typeof raw.enabled!=='boolean')throw new TypeError('字段更新开关无效');
  // Omitted means enabled for existing schemas; preserve their original revision hashes.
  return {...field,storageKey,valueType,...(raw.enabled===false?{enabled:false}:{})};
}
export function readWorldFieldSchema(world){
 try{
  const stored=world?.meta?.fieldSchema;
  if(stored!==undefined){
   if(stored?.version!==1||!Array.isArray(stored.fields)||!Array.isArray(stored.retired))throw new TypeError('世界字段版本无效');
   const fields=stored.fields.map(managedField),retired=stored.retired.map(managedField),ids=new Set();
   for(const field of [...fields,...retired]){if(ids.has(field.id))throw new TypeError('字段身份重复');ids.add(field.id)}
   for(const [i,field]of fields.entries())if(fields.slice(0,i).some(f=>f.name===field.name&&f.kinds.some(k=>field.kinds.includes(k))))throw new TypeError('字段名重复');
   if(stored.revision!==schemaDigest(fields,retired)||canonical(stored)!==canonical({version:1,revision:stored.revision,fields,retired}))throw new TypeError('世界字段内容校验失败');
   return {status:'confirmed',...copy(stored)};
  }
  const original=world?.meta?.sourcePublication?.field_table;
  if(original===undefined)return {status:'unconfirmed',revision:'unconfirmed',fields:[],retired:[]};
  const table=validateConfirmedFieldTable(original),fields=table.fields.map(managedField);
  return {status:'confirmed',version:1,revision:schemaDigest(fields,[]),fields,retired:[]};
 }catch(error){return {status:'invalid',revision:'invalid',fields:[],retired:[],error:String(error.message)}}
}
export function resolveWorldPropertyField(world,entity,name,{fieldId=null,schemaRevision=null}={}){
 const schema=readWorldFieldSchema(world);
 if(schema.status!=='confirmed'||schemaRevision!==null&&schemaRevision!==schema.revision)return null;
 const field=worldWritablePropertyFields(world).find(f=>f.name===name&&f.kinds.includes(entity?.kind)&&(!fieldId||f.id===fieldId));
 if(!field||field.valueType!=='text'||!safeKey(field.storageKey))return null;
 if(Object.hasOwn(entity??{},field.storageKey)&&typeof entity[field.storageKey]!=='string')return null;
 return {...copy(field),schemaRevision:schema.revision};
}
export function worldWritablePropertyFields(world){
  return readWorldFieldSchema(world).fields.filter(f=>f.enabled!==false&&isWorldWritableDefinition(f)).map(f=>({...f,kinds:f.kinds.filter(k=>['character','faction'].includes(k))}));
}
export const isWorldWritableDefinition=field=>(field.valueType??'text')==='text'&&!systemFields.has(field.name)&&safeKey(field.storageKey??field.name)&&field.kinds.some(k=>['character','faction'].includes(k));
export function worldFieldWritePrompt(world){
 const fields=worldWritablePropertyFields(world);
 if(!fields.length)return '本世界没有已确认可更新的自定义属性，不提出属性变化。行动、事件、承诺、位置及关系仍按固定协议记录。';
 const labels={character:'人物',faction:'组织',location:'地点'};
 return '【本世界可更新的属性】\n'+fields.map(f=>f.name+'（'+f.kinds.map(k=>labels[k]).join('／')+'）'+(f.meaning?'：'+f.meaning:'')).join('\n')
  +'\n只使用这些字段名及适用对象；有已发生的依据才更新，值沿用本世界原话，不编等级或默认值。实体身份、玩家和固定操作仍受原有保护。';
}
export function discoverWorldFieldCandidates(world){
 const groups=new Map(),schema=readWorldFieldSchema(world),retired=new Set(schema.retired.map(f=>f.storageKey));
 for(const entity of world?.entities??[])for(const [name,value]of Object.entries(entity)){
  if(!safeKey(name)||retired.has(name)||!kinds.has(entity.kind))continue;
  const valueType=value===null?'null':Array.isArray(value)?'array':typeof value==='string'?'text':typeof value;
  if(!['text','number','boolean','null','object','array'].includes(valueType))continue;
  const key=canonical([name,valueType]);let field=groups.get(key);
  if(!field){field={id:'field-'+sha256Hex(canonical(['legacy',name,valueType])),name,meaning:'',kinds:[],sources:[],origin:'inferred',storageKey:name,valueType,count:0,confirmed:false};groups.set(key,field)}
  if(!field.kinds.includes(entity.kind))field.kinds.push(entity.kind);field.count++;
 }
 return [...groups.values()].map(f=>({...f,kinds:f.kinds.sort()})).sort((a,b)=>a.name.localeCompare(b.name));
}
export function applyWorldFieldEdit(world,{expected_schema_revision,fields,edit_id}={}){
 const schema=readWorldFieldSchema(world);
 if(schema.status==='invalid')throw new TypeError(schema.error);
 if(schema.revision!==expected_schema_revision)throw new TypeError('字段表已改变，请重新打开核对');
 if(!Array.isArray(fields)||typeof edit_id!=='string'||!edit_id)throw new TypeError('字段编辑内容或操作号无效');
 const existing=new Map(schema.fields.map(f=>[f.id,f])),retiredIds=new Set(schema.retired.map(f=>f.id));
 const candidates=new Map(discoverWorldFieldCandidates(world).map(f=>[f.id,f]));
 const next=[],seen=new Set();
 for(const [index,raw]of fields.entries()){
  if(retiredIds.has(raw?.id))throw new TypeError('已移除字段不能复用旧身份，请作为新字段添加');
  const prior=existing.get(raw?.id),inferred=!prior&&candidates.get(raw?.id);
  if(raw?.id&&!prior&&!inferred)throw new TypeError('字段身份不属于当前表或当前候选');
  const id=prior?.id??inferred?.id??'field-'+sha256Hex(canonical([edit_id,index]));
  const storageKey=prior?.storageKey??inferred?.storageKey??'sw2field_'+id.slice(6);
  const unchanged=prior&&canonical([raw.name,raw.meaning,[...(raw.kinds??[])].sort()])===canonical([prior.name,prior.meaning,prior.kinds]);
  const field=managedField({...raw,id,origin:unchanged?prior.origin:'user',sources:prior?.sources??[],storageKey,valueType:prior?.valueType??inferred?.valueType??'text',...(prior?.source_optional?{source_optional:true}:{})});
  if(seen.has(id)||next.some(f=>f.name===field.name&&f.kinds.some(k=>field.kinds.includes(k))))throw new TypeError('字段身份或名称重复');
  if(next.some(f=>f.storageKey===storageKey&&f.kinds.some(k=>field.kinds.includes(k))))throw new TypeError('同一存放字段不能重复授权');
  seen.add(id);next.push(field);
 }
 const retired=[...schema.retired,...schema.fields.filter(f=>!seen.has(f.id))];
 const result=copy(world);result.meta??={};result.meta.fieldSchema={version:1,revision:schemaDigest(next,retired),fields:next,retired};
 return result;
}
export function maskRetiredWorldFields(world){
  const schema=readWorldFieldSchema(world),hidden=[...schema.retired,...schema.fields.filter(f=>f.enabled===false)];if(!hidden.length&&!schema.fields.some(f=>f.storageKey!==f.name))return world;
 const result=copy(world);
 for(const entity of result.entities??[]){
   const aliases=schema.fields.filter(f=>f.enabled!==false&&f.kinds.includes(entity.kind)&&f.storageKey!==f.name),values=aliases.filter(f=>Object.hasOwn(entity,f.storageKey)).map(f=>({name:f.name,value:copy(entity[f.storageKey])}));
   for(const field of hidden)if(field.kinds.includes(entity.kind))delete entity[field.storageKey];
  for(const field of aliases){delete entity[field.storageKey];delete entity[field.name]}
  for(const field of values)Object.defineProperty(entity,field.name,{value:field.value,enumerable:true,writable:true,configurable:true});
 }
 return result;
}
export function worldFieldEditChanges(world,next){
 const before=readWorldFieldSchema(world),after=readWorldFieldSchema(next),changes=[];
 for(const field of after.fields){const old=before.fields.find(f=>f.id===field.id);
  if(!old)changes.push('启用「'+field.name+'」：'+(field.storageKey.startsWith('sw2field_')?'作为新字段记录，不连接同名旧值。':'确认现存字段，已有值与历史保留。'));
  else if(old.name!==field.name)changes.push('「'+old.name+'」改名为「'+field.name+'」：已有值与历史保留，以后只接受新名称。');
  else if(old.meaning!==field.meaning||canonical(old.kinds)!==canonical(field.kinds))changes.push('更新「'+field.name+'」的补充说明或适用对象，已有值不改。');
   if(old&&(old.enabled!==false)!==(field.enabled!==false))changes.push((field.enabled===false?'停用':'重新启用')+'「'+field.name+'」：'+(field.enabled===false?'模型不能更新或注入此字段；定义、已有值和历史保留，可再次启用。':'继续使用原字段身份和已有值。'));
 }
 for(const field of before.fields)if(!after.fields.some(f=>f.id===field.id))changes.push('移除「'+field.name+'」：撤销模型写入和当前注入，已有值与历史保留。');
 if(!after.fields.length&&(before.status!=='confirmed'||before.fields.length))changes.push('保存为空字段表：模型不能写入自定义属性，已有值与历史继续保留。');
 return changes;
}
