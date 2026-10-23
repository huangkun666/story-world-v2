import {readWorldFieldSchema} from '../src/source-field-table.js';
import {parseModelJson} from '../src/model-json.js';
import {handleWorldRequest} from '../src/world-engine.js';
import {runTaskRecall} from './world-task-recall.js';
import {extractTags} from '../src/tag-extract.js';
import {hydrateWorldMetrics} from '../src/world-record-metrics.js';
const live=new Map();
const terminal=row=>['committed','cancelled'].includes(row.status);
const clone=value=>structuredClone(value);
// Background is optional; an envelope for another world or version is never prompt input.
function usableBackground(recall,pointer,revision){
 if(!recall||typeof recall!=='object'||Array.isArray(recall))return [];
 if((recall.revision!==undefined&&recall.revision!==revision)||(recall.world_id!==undefined&&recall.world_id!==pointer.world_id)||(recall.branch_id!==undefined&&recall.branch_id!==pointer.branch_id))return [];
 return (Array.isArray(recall.records)?recall.records:[]).filter(row=>row&&typeof row==='object'&&!Array.isArray(row)&&(row.world_id===undefined||row.world_id===pointer.world_id)&&(row.branch_id===undefined||row.branch_id===pointer.branch_id));
}
function assertPreparedSchema(prepared,response=null){
 const custom=(prepared?.dialogueStats?.changedFields??[]).some(row=>row.field!=='location');
 let updates=[];if(response)try{updates=parseModelJson(response)?.entityUpdates??[]}catch{}
 if(!prepared?.fieldSchemaRevision&&(custom||updates.some(u=>!['location','status'].includes(u.field))))throw Error('旧任务使用了未冻结的属性权限；原输入与回执保留，请先核对字段后另开新任务，不会自动重发');
 if(prepared?.fieldSchemaRevision&&prepared.fieldSchemaRevision!==readWorldFieldSchema(prepared.world).revision)throw Error('任务字段表修订不匹配，原任务未改写');
}

/** Only well-formed world retrieval budgets are accepted; anything else keeps the historical default. */
function normalizeSearchOptions(raw) {
 if(raw==null||typeof raw!=='object'||Array.isArray(raw))return null;
 const {maxRecords,maxDepth,similarity}=raw;
 if(typeof maxRecords!=='number'||!Number.isSafeInteger(maxRecords)||maxRecords<1)return null;
 if(typeof maxDepth!=='number'||!Number.isSafeInteger(maxDepth)||maxDepth<0)return null;
 const out={maxRecords,maxDepth};
 if(similarity!==undefined){
  if(typeof similarity!=='number'||!Number.isFinite(similarity)||similarity<0||similarity>1)return null;
  out.similarity=similarity;
 }
 return out;
}
function readSearchOptions(getSearchOptions){try{return normalizeSearchOptions(getSearchOptions())}catch{return null}}
// Only causal ancestors are evidence: following links.down would load unrelated future history.
function causeReferences(value){
 const ids=new Set(),visit=v=>{if(!v||typeof v!=='object')return;for(const [key,item] of Object.entries(v)){
  if(key==='down')continue;
  if(['ref','event','eventId','eventRef','parentId','endCause'].includes(key)&&typeof item==='string'&&item)ids.add(item);
  if(['up','causeIds','referenceIds'].includes(key)&&Array.isArray(item))for(const id of item)if(typeof id==='string'&&id)ids.add(id);
  if(item&&typeof item==='object')visit(item);
 }};visit(value);return [...ids];
}
async function loadEvidence(journal,p,prepared,ids=[],records=[],onUnavailable=null){
 if(typeof journal.getRecords!=='function')return prepared;
 const next=clone(prepared),world=next.world,seen=new Set(),processed=new Set(),events=new Map((world.events||[]).map(e=>[e.id,e]));
 const legacy=new Map();for(const m of world.milestones||[])for(const id of [...(m.ids||[]),...(m.rows||[]).map(r=>r.id)])legacy.set(id,m);
 let pending=[...ids],incoming=records;
 while(incoming.length||pending.length){
  for(const record of incoming){
   if(record?.record_kind!=='event'||typeof record.id!=='string'||processed.has(record.id))continue;
   processed.add(record.id);
   if(!events.has(record.id)){
    const value=clone(record);delete value.record_kind;
    if(legacy.has(value.id)){const m=legacy.get(value.id);m.rows??=[];const at=m.rows.findIndex(r=>r.id===value.id);if(at<0)m.rows.push(value);else m.rows[at]=value;}
    else {world.events??=[];world.events.push(value);events.set(value.id,value);if(next.record_view?.events?.complete===false&&!next.record_view.events.ids.includes(value.id))next.record_view.events.ids.push(value.id);
     if(Array.isArray(next.priorEventIds)&&!next.priorEventIds.includes(value.id))next.priorEventIds.push(value.id);}
   }
   pending.push(...causeReferences(record));
  }
  const fresh=[...new Set(pending)].filter(id=>!seen.has(id)&&!processed.has(id)&&!events.has(id));pending=[];
  if(!fresh.length)break;fresh.forEach(id=>seen.add(id));
  try{incoming=await journal.getRecords(p,fresh,{lifecycleMetadata:false});if(!Array.isArray(incoming))throw TypeError('Invalid background records');}
  catch(error){if(!onUnavailable)throw error;await onUnavailable(error,fresh);break;}
 }
 if(next.world_view)next.world_view=hydrateWorldMetrics(next.world_view,prepared.world,world);
 return next;
}
export function createWorldCoordinator({journal,memory,model,onStatus=()=>{},getStatusOwner=()=>null,engine=handleWorldRequest,modelIdentity={provider:'configured',model:'configured'},parseStep=parseModelJson,getSearchOptions=()=>null}={}) {
 if(!journal||!memory||typeof model!=='function')throw Error('缺少正式账、检索或模型通道');
 const key=(p,id)=>JSON.stringify([journal.db.name,p.world_id,p.branch_id,id]);
 const read=(p,id)=>journal.getOperation(p,id);
 const reportStatus=(p,id,value)=>onStatus(value,{world_id:p.world_id,branch_id:p.branch_id,operation_id:id,owner:live.get(key(p,id))?.owner??null});
 const evidenceUnavailable=(p,id,stage)=>async(_error,ids=[])=>{
  const current=await read(p,id);if(terminal(current)||current.status==='failed')return;
  await journal.checkpoint(p,id,'background-evidence:'+stage,{unavailable:true,record_ids:clone(ids),message:'背景记录暂未读到，当前世界与已读资料保持'});
  reportStatus(p,id,'背景记录暂未读到，使用当前世界与已读资料继续');
 };
 async function phase(p,id,value){const row=await read(p,id);if(terminal(row))return row;const next=await journal.setPhase(p,id,value);reportStatus(p,id,value);return next}
 // Local execution has ended; upstream delivery may remain unknown. Keep that evidence,
 // close this failed turn, and require a new explicit request instead of leaving UI locks.
 async function endModelFailure(p,id,message) {
  let row=await read(p,id);if(terminal(row))return row;
  await journal.checkpoint(p,id,'model-attempt-ended',true);
  row=await read(p,id);if(terminal(row))return row;
  if(row.status!=='failed')await journal.failOperation(p,id,{stage:'model',message,callFailure:true});
  return read(p,id);
 }
 async function run(p,id,signal) {
  let row=await read(p,id),stage='prepare';if(terminal(row))return row;
  if(signal?.aborted){await journal.cancelOperation(p,id);return read(p,id);}
  if(row.proposal!==null){try{assertPreparedSchema(row.checkpoints.prepared,row.call?.response)}catch(error){await journal.failOperation(p,id,{stage:'prepare',message:String(error.message),callFailure:false});return read(p,id)}return journal.commitOperation(p,id);}
  if(row.status==='failed')return row;
  if(row.call&&row.call.outcome!=='received')return {...row,phase:'model-unknown'};
  try {
   let prepared=row.checkpoints.prepared;
   if(!prepared){await phase(p,id,stage);
    const current=await (journal.getWorkingWorld??journal.getWorld).call(journal,p,{revision:row.expected_revision});
    const facts=extractTags(row.inputs.dialogue,{world:current.world,entities:current.world.entities||[],canon:current.world.context?.setting?.frozen?.canon?.bookEntities||[],locations:current.world.context?.positions||[],playerId:current.world.context?.playerId??null});
    const loaded=await loadEvidence(journal,{...p,revision:row.expected_revision},{world:current.world,...(current.record_view?{record_view:current.record_view}:{}),...(current.record_metrics?{world_view:current.record_metrics}:{})},facts.references||[],[],evidenceUnavailable(p,id,'prepare'));
    row=await read(p,id);if(terminal(row))return row;
    prepared={...engine({action:'prepare',world:loaded.world,dialogue:row.inputs.dialogue,message_ref:row.inputs.message_ref??null}),...(loaded.record_view?{record_view:loaded.record_view}:{}),...(loaded.world_view?{world_view:loaded.world_view}:{})};await journal.checkpoint(p,id,'prepared',prepared)}
   row=await read(p,id);if(terminal(row))return row;
   assertPreparedSchema(prepared,row.call?.response);
   if(!row.call) {
    stage='retrieve';let recall=row.checkpoints.recall;
    if(!recall){await phase(p,id,stage);
     // ★Task 2：检索预算（maxRecords/maxDepth，similarity 可选）**按操作固定**——
     //   第一次查询前落盘，恢复时只认落盘那一份，不重新读可能已变的设置。
     //   `Object.hasOwn` 区分"没落过盘"与"落过盘但为 null（没有配置）"。
     const hasOptions=Object.hasOwn(row.checkpoints,'recall-options');
     const searchOptions=hasOptions?row.checkpoints['recall-options']:readSearchOptions(getSearchOptions);
     if(!hasOptions)await journal.checkpoint(p,id,'recall-options',searchOptions);
     recall=await runTaskRecall({dialogue:row.inputs.dialogue,prepared,pointer:p,revision:row.expected_revision,memory,searchOptions,signal,
      load:async queryKey=>{const current=await read(p,id);return current.checkpoints['recall-query:'+queryKey]??null},
      save:async(queryKey,value)=>{try{await journal.checkpoint(p,id,'recall-query:'+queryKey,value)}catch(error){const current=await read(p,id);if(!terminal(current))throw error}},
      isCancelled:async()=>terminal(await read(p,id))});
     row=await read(p,id);if(terminal(row))return row;
     await journal.checkpoint(p,id,'recall',recall);
    }
    row=await read(p,id);if(terminal(row))return row;
    if(signal?.aborted){await journal.cancelOperation(p,id);return read(p,id);}
    if(recall.blocking||recall.limited)reportStatus(p,id,'背景资料未完整读取，使用当前世界与可用背景推进');
    stage='pack';let packed=row.checkpoints.packed;
    if(!packed){await phase(p,id,stage);const output=engine({action:'pack',world:prepared.world,turnFacts:prepared.turnFacts,move:prepared.move,records:usableBackground(recall,p,row.expected_revision)});packed={prompt:output.prompt,...(Number.isFinite(output.estTokens)?{estTokens:output.estTokens}:{}),...(Number.isFinite(output.estBeforeTrim)?{estBeforeTrim:output.estBeforeTrim}:{}),...(output.inputStats?{inputStats:output.inputStats}:{}),...(output.limited?{limited:true,omitted:output.omitted}:{})};await journal.checkpoint(p,id,'packed',packed)}
    row=await read(p,id);if(terminal(row))return row;
    if(packed.limited)reportStatus(p,id,'部分背景未装入本轮提示，完整资料与遗漏记录保留');
    stage='model';await phase(p,id,stage);
    const claimed=await journal.claimModel(p,id,{...(typeof modelIdentity==='function'?modelIdentity():modelIdentity),request_id:id});
    if(!claimed)return read(p,id);
    const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
    if(signal?.aborted)controller.abort(signal.reason);else signal?.addEventListener('abort',abort,{once:true});
    const task=live.get(key(p,id));if(task)task.controller=controller;
    try {
     row=await read(p,id);if(terminal(row))return row;
     if(controller.signal.aborted){await journal.cancelOperation(p,id);return read(p,id)}
     let dispatchCount=0;
     const result=await model(packed.prompt,{signal:controller.signal,task:'world-generation',scope:task?.owner??null,operation_id:id,world_id:p.world_id,branch_id:p.branch_id,revision:row.expected_revision,onDispatch:summary=>journal.checkpoint(p,id,'model-dispatch-'+(++dispatchCount),summary),onPosted:()=>journal.markModelPosted(p,id)});
     const response=typeof result==='string'?result:result?.text??result?.response;
     if(typeof response!=='string')throw Error('模型未返回文本');
     await journal.saveResponse(p,id,{response,usage:result?.usage??null,unconfirmed:result?.unconfirmed===true,provider_response:result?.provider_response??null,failure:result?.failure??null});
     row=await read(p,id);if(terminal(row))return row;
     if(result?.unconfirmed===true)return endModelFailure(p,id,'模型响应中断，本轮未采用；上游结果仍未知，可手动重新推进');
     if(result?.provider_response)await journal.checkpoint(p,id,'provider-response',result.provider_response);
     if(result?.failure){await journal.failOperation(p,id,{stage:'model',type:result.failure.type,message:result.failure.message});return read(p,id)}
    } catch(error) {
     row=await read(p,id);
     if(terminal(row))return row;
     // Only explicit transport evidence can confirm that dispatch never started.
     if(row.status!=='failed'&&row.call?.outcome==='requested'&&error?.sw2RequestNotSent===true&&!signal?.aborted){
      await journal.checkpoint(p,id,'model-request-not-sent',true);
      await journal.failOperation(p,id,{stage:'model',type:'unposted',message:'请求没有发出去：'+String(error?.message??error)});return read(p,id);
     }
     const timeout=error?.sw2CallFailure?.type==='timeout'?Number(error.sw2CallFailure.timeoutMs):0;
     const timedOut=Number.isFinite(timeout)&&timeout>0;
     const reason=timedOut?'模型等待 '+timeout/1000+' 秒后超时，响应尚未确认，禁止自动重发':'模型请求或响应尚未确认，禁止自动重发';
     await journal.markModelUnknown(p,id,{type:error?.name??'Error',message:reason});
     return endModelFailure(p,id,timedOut?reason+'；本轮已停止，原世界未改':'模型调用失败，本轮未完成；上游结果仍未知，可手动重新推进');
    } finally {signal?.removeEventListener('abort',abort);if(task)task.controller=null}
   }
   row=await read(p,id);if(terminal(row))return row;
   if(row.call?.outcome!=='received')return {...row,phase:'model-unknown'};
   stage='settle';await phase(p,id,stage);
   const step=parseStep(row.call.response);
   const referenceIds=[...new Set([...causeReferences(step),...usableBackground(row.checkpoints.recall,p,row.expected_revision).filter(r=>r.record_kind==='event').map(r=>r.id)])];
   let evidence=row.checkpoints['settle-evidence'];
   if(evidence===undefined){
    evidence=[];
    if(referenceIds.length&&typeof journal.getRecords==='function')try{
     evidence=await journal.getRecords({...p,revision:row.expected_revision},referenceIds,{lifecycleMetadata:false});
     if(!Array.isArray(evidence))throw TypeError('Invalid background records');
    }catch(error){evidence=[];await evidenceUnavailable(p,id,'settle')(error,referenceIds);}
   }
   // Keep successfully recalled records if a later optional read is unavailable.
   evidence=[...new Map([...usableBackground(row.checkpoints.recall,p,row.expected_revision).filter(r=>r.record_kind==='event'),...evidence].map(r=>[r.id,r])).values()];
   row=await read(p,id);if(terminal(row))return row;
   if(!Object.hasOwn(row.checkpoints,'settle-evidence'))await journal.checkpoint(p,id,'settle-evidence',evidence);
   prepared=await loadEvidence(journal,{...p,revision:row.expected_revision},prepared,[],evidence,evidenceUnavailable(p,id,'settle'));
   row=await read(p,id);if(terminal(row))return row;
   if(signal?.aborted){await journal.cancelOperation(p,id);return read(p,id);}
   const result=engine({action:'settle',world:prepared.world,field_schema_revision:prepared.fieldSchemaRevision,step,move:prepared.move,message_ref:row.inputs.message_ref??null,dialogueStats:prepared.dialogueStats,prior_event_ids:prepared.priorEventIds,world_view:prepared.world_view});
   if(!result.ok)throw Error(result.stage?.warnings?.join('; ')||'世界提议未通过结算');
   row=await read(p,id);if(terminal(row))return row;
   const lastInput=result.ssot?.meta?.simLog?.at(-1),input=row.checkpoints.packed;
   if(lastInput&&Number.isFinite(input?.estTokens)){lastInput.packTokens=input.estTokens;if(Number.isFinite(input.estBeforeTrim))lastInput.packTokensBeforeTrim=input.estBeforeTrim;else delete lastInput.packTokensBeforeTrim;}
   await journal.saveProposal(p,id,result.ssot,{partial:prepared.record_view??null});stage='commit';
   return await journal.commitOperation(p,id);
  } catch(error) {
   row=await read(p,id);if(terminal(row))return row;
   // 模型那一步之后的失败：请求已经发出去过，核对记录要如实标成“结果未明”（与旧账形状一致）；
   // 准备/检索/打包阶段的失败根本没发过请求，照旧只记一条失败。
   await journal.failOperation(p,id,{stage,message:String(error.message),callFailure:!['prepare','retrieve','pack'].includes(stage)});return read(p,id);
  }
 }
 function resume(p,id,{signal,recover=false,statusOwner=getStatusOwner()}={}) {
  const identity=key(p,id);
  if(live.has(identity))return live.get(identity).promise;
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const task={controller,promise:null,owner:statusOwner};live.set(identity,task);
  task.promise=(recover?journal.resumeOperation(p,id).then(()=>run(clone(p),id,controller.signal)):run(clone(p),id,controller.signal)).finally(()=>{signal?.removeEventListener('abort',abort);if(live.get(identity)===task)live.delete(identity)});
  return task.promise;
 }
 return {
  async startTurn(p,input,options={}) {const statusOwner=getStatusOwner();if(typeof input?.dialogue!=='string')throw Error('推进正文必须是文本');await journal.startOperation(p,input);return resume(p,input.operation_id,{...options,statusOwner})},
  resume,
  async getOperation(p,id){const statusOwner=getStatusOwner();const row=await read(p,id);if(row.status==='started'&&row.call?.outcome==='unknown'&&!live.has(key(p,id)))return endModelFailure(p,id,'此前模型调用已结束，本轮未完成；上游结果仍未知，可手动重新推进');if(!terminal(row)&&row.status!=='failed'&&(row.proposal!==null||row.call?.outcome==='received'))return resume(p,id,{statusOwner});return row.status!=='failed'&&['requested','unknown'].includes(row.call?.outcome)&&!live.has(key(p,id))?{...row,phase:'model-unknown'}:row},
  async cancel(p,id){const row=await journal.cancelOperation(p,id);live.get(key(p,id))?.controller?.abort();return row},
  async continueLimited(p,id){const statusOwner=getStatusOwner();await journal.allowLimited(p,id);return resume(p,id,{statusOwner})},
  get busy(){return [...live.keys()].some(k=>JSON.parse(k)[0]===journal.db.name)}
 };
}
