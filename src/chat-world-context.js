// Chat narration reads pinned current facts. Legacy player observation remains a separate contract.
import {resolvePlace} from './geography.js';
import {currentScopeIds} from './event-contract.js';
import {worldSourceEvidence,isChatHistoryRecord} from './source-records.js';
import {chatEntityAttributes} from './chat-entity-attributes.js';

const rows=value=>Array.isArray(value)?value:[];
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
const clone=value=>structuredClone(value);
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const geography=world=>world.context?.setting?.frozen?.canon?.geography;

function mentioned(text,value,{id=false}={}) {
 if(!nonempty(text)||!nonempty(value))return false;
 if(!id&&/\p{Script=Han}/u.test(value)&&[...value].length>1)return text.includes(value);
 const needle=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return new RegExp('(?<![\\p{L}\\p{N}_])'+needle+'(?![\\p{L}\\p{N}_])','iu').test(text);
}
export function resolveChatReferences(world,text='') {
 const entityIds=new Set(),placeIds=new Set(),names=new Map();
 for(const entity of rows(world.entities)){
  if(mentioned(text,entity.id,{id:true}))entityIds.add(entity.id);
  for(const name of [entity.name,...rows(entity.aliases)].filter(nonempty)){
   const ids=names.get(name)||new Set();ids.add(entity.id);names.set(name,ids);
  }
 }
 for(const [name,ids]of names)if(ids.size===1&&mentioned(text,name))entityIds.add([...ids][0]);
 for(const place of rows(geography(world)?.places)){
  const matched=mentioned(text,place.id,{id:true})||[place.name,...rows(place.aliases)].some(name=>{
   if(!mentioned(text,name))return false;
   const resolution=resolvePlace(geography(world),name);
   return resolution.status==='matched'&&resolution.place.id===place.id;
  });
  if(matched)placeIds.add(place.id);
 }
 for(const value of rows(world.context?.positions)){
  if(value==='未明'||!mentioned(text,value)||rows(world.context.positions).filter(x=>x===value).length!==1)continue;
  const resolved=resolvePlace(geography(world),value);
  if(resolved.status==='matched')placeIds.add(resolved.place.id);
  else if(resolved.status==='unmapped')placeIds.add('text:'+value);
 }
 return {entityIds:[...entityIds],placeIds:[...placeIds],referenceIds:[...entityIds]};
}
function placeId(world,value){
 const resolved=resolvePlace(geography(world),value);
 if(resolved.status==='matched')return resolved.place.id;
 return resolved.status==='unmapped'&&nonempty(value)&&value!=='未明'
  &&rows(world.context?.positions).filter(x=>x===value).length===1?'text:'+value:null;
}
export function chatReferencePositions(world,text=''){
 const selected=new Set(resolveChatReferences(world,text).placeIds);
 const candidates=[...rows(world.context?.positions),...rows(geography(world)?.places).flatMap(p=>[p.id,p.name,...rows(p.aliases)])];
 return [...new Set(candidates.filter(nonempty).filter(value=>selected.has(placeId(world,value))))];
}
function involved(world,record) {
 const entityIds=new Set(rows(world.entities).map(e=>e.id)),ids=new Set();
 const add=id=>{if(entityIds.has(id))ids.add(id)};
 add(record?.id);add(record?.owner);add(record?.from??record?.from_id);add(record?.to??record?.to_id);add(record?.entityId);
 for(const actor of [...rows(record?.actors),...rows(record?.participants)])add(typeof actor==='string'?actor:actor?.ref??actor?.id);
 for(const id of [...rows(record?.participantIds),...rows(record?.ripples)])add(id);
 for(const scope of [...rows(record?.scope),...rows(record?.affected)]){
  add(scope.ref);
  if(['entity','members'].includes(scope.kind))for(const id of rows(scope.resolution?.knownIds??currentScopeIds([scope],world)))add(id);
 }
 return ids;
}
function movementRows(unit){return [...rows(unit.events),...rows(unit.causes),...rows(unit.changes).flatMap(c=>[c.after??c.record,c].filter(Boolean))]}
function directMovement(world,unit,direct){
 return movementRows(unit).some(row=>[...involved(world,row)].some(id=>direct.entityIds.includes(id))
  ||direct.placeIds.includes(placeId(world,row.position??row.location)));
}
function unique(records){
 const seen=new Set();return records.filter(row=>{const key=canonical(row);if(seen.has(key))return false;seen.add(key);return true;});
}
const historyInstruction='【相关历史与资料】\n';
const movementInstruction='【本批世界动向】以下均来自已成功保存的版本；保留发生时间与因果，不能把动向再次执行，也不代表所有人物已经知情。\n';
function pack(records,maxChars,label,instruction,render,onInclude=()=>{}){
 if(!Number.isSafeInteger(maxChars)||maxChars<0)throw new TypeError(label+'预算无效');
 const result={records:[],text:'',omitted:[],limited:false,notice:''};
 for(const row of unique(records)){
  const line=render(row),prefix=result.text?'\n':instruction;
  if(!line)continue;
  if(result.text.length+prefix.length+line.length>maxChars){result.omitted.push({id:row.id,record_kind:row.record_kind??label,reason:'whole-record-budget'});continue;}
  result.records.push(clone(row));result.text+=prefix+line;
   onInclude(row);
 }
 result.limited=result.omitted.length>0;
 if(result.limited)result.notice='【部分'+label+'因额度未带入；完整记录仍保存在世界库中。】';
 return result;
}
export function historyRecordText(row,world,related=[]){
 const name=id=>rows(world.entities).find(e=>e.id===id)?.name;
 const prose=value=>typeof value==='string'&&value.trim()?value.trim():'';
 const names=values=>[...new Set(values.filter(Boolean))].join('、');
 const title=prose(row.title)||prose(row.text)||prose(row.statement)||prose(row.goal);
 if(row.accepted===false||row.rejected===true||row.recordType==='rejected')return title?'未采纳提议（未作为事实记账）：'+title:'';
 if(['source-history','source-plan','source-ambiguity','source-context'].includes(row.record_kind)){
  const label={'source-history':'原文历史','source-plan':'原文计划（尚未实现）','source-ambiguity':'原文未定记载','source-context':'世界资料'}[row.record_kind];
  const people=names(rows(row.participantIds).map(name));
  const location=rows(geography(world)?.places).find(place=>place.id===row.location_id)?.name;
  return title?label+'：'+title+(prose(row.story_time)?'；故事时间：'+row.story_time:'')
   +(prose(row.time_basis)?'；时间参照：'+row.time_basis:'')
   +(prose(row.qualifiers)&&!title.includes(row.qualifiers)?'；限定：'+row.qualifiers:'')
   +(prose(location)?'；地点：'+location:'')+(people?'；相关人物：'+people:''):'';
 }
 if(row.record_kind==='source')return prose(row.content)?'资料原文'+(row.source_title?'（'+row.source_title+'）':'')+'：'+row.content:'';
 if(row.record_kind==='entity')return '';
 if(row.record_kind==='event'){
  if(!title)return '';
  const accepted=row.recordType==='result'&&['chat','world'].includes(row.producer);
  const at=prose(row.timeMark)||prose(row.at);
  const actors=names([...rows(row.actors).map(a=>prose(a.name)||name(a.ref)),...rows(row.participantNames),...rows(row.participantIds).map(name)]);
  const lines=[(accepted?'已记录事件：':'历史记载（事实身份未确认）：')+title];
  if(at)lines.push('时间：'+at);if(actors)lines.push('主体：'+actors);if(prose(row.position))lines.push('地点：'+row.position);
  if(prose(row.reportedContent))lines.push('所述内容（说法）：'+row.reportedContent);
  const scope=[...rows(row.affected).map(s=>prose(s.text)),...rows(row.ripples).map(name)].filter(Boolean);if(scope.length)lines.push('影响范围：'+names(scope));
  const audience=rows(row.audience).map(s=>prose(s.text)||name(s.ref)).filter(Boolean);if(audience.length)lines.push('公开范围：'+names(audience));
  if(row.archived&&row.lifecycleKnown===false)lines.push('旧记录的结束状态未确认');
  else if(row.pending===true&&row.closed!==true)lines.push('尚有待兑现的义务');
  const causes=rows(row.links?.up).map(id=>[...rows(world.events),...related].find(e=>e.id===id)?.title).filter(Boolean);if(causes.length)lines.push('原因：'+names(causes));
  return lines.join('；');
 }
  if(row.record_kind==='agenda')return prose(row.goal)?'盘算'+(row.closed===true?'（已结束，不据此认定目标已经实现）':'（尚未完成）')+'：'+(name(row.owner)?name(row.owner)+'—':'')+row.goal+(prose(row.stage)?'；阶段：'+row.stage:''):'';
 if(row.record_kind==='relation'){
  const from=name(row.from??row.from_id),to=name(row.to??row.to_id),text=prose(row.type)||prose(row.text);
  return from&&to&&text?'关系记录'+(Object.hasOwn(row,'endedTick')?'（已结束）':'')+'：'+from+' → '+to+'，'+text+(prose(row.note)?'；'+row.note:''):'';
 }
  if(row.record_kind==='condition')return prose(row.statement)?'条件记录'+(row.state==='ended'?'（已结束）':row.state==='planned'?'（尚未生效）':'（当前有效）')+'：'+row.statement+(prose(row.effectiveFrom)?'；开始：'+row.effectiveFrom:'')+(prose(row.effectiveUntil)?'；期限：'+row.effectiveUntil:''):'';
 if(row.record_kind==='chronicle'&&title)return (Number.isSafeInteger(row.tick)?'第'+row.tick+'轮记录：':'历史记录：')+title;
 return title?'资料记载：'+title:'';
}
// 去重依据是本次真正输出的同一事实，检索包装和程序元数据不产生第二份事实。
function narrativeKey(row,world){return canonical([row.record_kind,row.id,row.content_kind??null,historyRecordText(row,world)]);}
function movementPrimary(unit){
 const events=rows(unit.events).map(row=>({...row,record_kind:'event'}));
 const changes=rows(unit.changes).flatMap(change=>{
  const row=change.after??change.record??change.before;if(!row)return [];
  const kind=change.record_kind??row.record_kind;
  // 属性变化只由属性投影提供，不借动向重新展开整个实体。
  if(kind==='entity'&&change.change_type==='updated')return [];
  return [{...row,record_kind:kind,...(change.change_type==='removed'?{movement_removed:true}:{})}];
 });
 return [...events,...changes];
}
function movementRecordText(row,world,related){
 if(row.record_kind==='entity')return row.name?(row.movement_removed?'停止记录实体：':'新增实体记录：')+row.name:'';
 const text=historyRecordText(row,world,related);if(!text)return '';
 return (row.movement_removed?'记录已移除（不据此推断事实消失）：':'')+text+(row.record_kind==='event'&&row.closed===true?'；事件已结束':'');
}
function packMovements(units,maxChars,world,sent){
 const identity=row=>canonical([row.record_kind,row.id,row.content_kind??null]),latest=new Map();
 for(const unit of units)for(const row of movementPrimary(unit))latest.set(identity(row),Math.max(latest.get(identity(row))??-1,unit.revision??0));
 const present=unit=>{
  const all=[...movementPrimary(unit),...rows(unit.causes)],main=movementPrimary(unit).filter(row=>(unit.revision??0)===latest.get(identity(row))&&!sent.has(narrativeKey(row,world))&&movementRecordText(row,world,all));
  if(!main.length)return {text:'',records:[]};
  const keys=new Set(main.map(row=>narrativeKey(row,world))),causes=rows(unit.causes).filter(row=>!sent.has(narrativeKey(row,world))&&!keys.has(narrativeKey(row,world))&&historyRecordText(row,world,all));
  return {text:[...main.map(row=>movementRecordText(row,world,all)),...causes.map(row=>'相关原因（既有记录）：'+historyRecordText(row,world,all))].join('\n'),records:[...main,...causes]};
 };
 return pack(units,maxChars,'动向',movementInstruction,unit=>present(unit).text,unit=>{for(const row of present(unit).records)sent.add(narrativeKey(row,world));});
}
export function movementQueryText(movements=[]){
 return rows(movements).flatMap(unit=>movementRows(unit).flatMap(row=>[
  row.id,row.name,row.title,row.description,row.statement,row.goal,row.position,
  ...rows(row.actors).flatMap(actor=>[actor?.name,actor?.ref])
 ].filter(nonempty))).filter((v,i,a)=>a.indexOf(v)===i).join(' ');
}
export function buildChatWorldContext(world,{query='',movements=[],records=[],includeState=true,movementMaxChars=0,historyMaxChars=0,range=null,baselinePublication=null}={}){
 const direct=resolveChatReferences(world,query),targets=new Set(direct.entityIds);
 const state=includeState?chatEntityAttributes(world,direct.entityIds,{baselinePublication}):{records:[],text:'',omitted:[],limited:false};
 const sorted=movements.map((unit,index)=>({unit,index,direct:directMovement(world,unit,direct)}))
  .sort((a,b)=>Number(b.direct)-Number(a.direct)||(b.unit.revision??0)-(a.unit.revision??0)||a.index-b.index).map(x=>x.unit);
 const sent=new Set();
 for(const entity of state.records)for(const change of rows(entity.relations)){
  const current=change.current?.id&&rows(world.relations).find(row=>row.id===change.current.id);
   if(current)sent.add(narrativeKey({...current,record_kind:'relation'},world));
 }
  const movement=packMovements(includeState?sorted:[],movementMaxChars,world,sent);
 const historyRows=unique(records.map(worldSourceEvidence).filter(isChatHistoryRecord)).filter(row=>{
  if(row.record_kind==='entity'&&targets.has(row.id))return false;
   return !sent.has(narrativeKey(row,world));
 });
 const history=pack(historyRows,historyMaxChars,'历史',historyInstruction,row=>historyRecordText(row,world,historyRows));
 const referenceIds=new Set(direct.referenceIds);
 for(const row of [...rows(world.events),...records])if(row.record_kind==='event'||rows(world.events).includes(row)){
  if(direct.placeIds.includes(placeId(world,row.position)))referenceIds.add(row.id);
 }
 return {state,movement,history,referenceIds:[...referenceIds],range};
}
