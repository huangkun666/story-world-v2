import {readSourceEntityDraft,readSourceSettingDraft,applySourceEdit,undoSourceEdit,sourceEditJson} from '../src/source-edit.js';
import {readWorldFieldSchema,discoverWorldFieldCandidates,applyWorldFieldEdit,worldFieldEditChanges} from '../src/source-field-table.js';

// 单个编辑会话持有打开时的正式版本；保存不借最新版本覆盖旧草稿。
export function createSourceEditHost({session,commitWorld,ensureReady,getScope,getBusy,makeId}){
 const drafts=new Map();
 const identity=p=>JSON.stringify([p?.world_id,p?.branch_id,p?.revision]);
 const copy=value=>structuredClone(value);
 function current(token){
  const draft=drafts.get(getScope());
  if([...drafts.values()].some(row=>row.token===token&&row.scope!==getScope()))throw Error('聊天已改变，原编辑不能保存到当前聊天');
  if(!draft||draft.token!==token)throw Error('编辑已关闭或被另一份编辑替代');
  if(draft.scope!==getScope())throw Error('聊天已改变，原编辑不能保存到当前聊天');
  return draft;
 }
 function assertCurrent(d,{checkBusy=true}={}){
  if(d.scope!==getScope()||identity(session.readState()?.pointer)!==identity(d.pointer))throw Error('聊天或世界版本已改变，请保留内容并重新打开编辑');
  if(checkBusy&&getBusy())throw Error('请先核对或停止当前世界操作');
 }
 function scopeGuard(d){
  const p=session.readState()?.pointer;
  if(d.scope!==getScope()||p?.world_id!==d.pointer.world_id||p?.branch_id!==d.pointer.branch_id)throw Error('聊天或世界已改变，修改已保存在原世界');
 }
 function prepare(d,change,undo=false){
  assertCurrent(d);
  if(d.input.kind==='fields'){
   const world=session.readWorld(),next=applyWorldFieldEdit(world,{expected_schema_revision:d.input.schema.revision,fields:change.value,edit_id:d.operationId});
   return {changed:readWorldFieldSchema(world).status!=='confirmed'||readWorldFieldSchema(world).revision!==readWorldFieldSchema(next).revision,world:next,changes:worldFieldEditChanges(world,next),preservedFields:[]};
  }
  return undo?undoSourceEdit(session.readWorld(),d.undoId,{editId:d.operationId})
   :applySourceEdit(session.readWorld(),d.input,change,{editId:d.operationId});
 }
 async function finishAdoption(d){
  const result=d.result,p=session.readState()?.pointer;
  if(!result?.needsReload)return copy(result);
  scopeGuard(d);
  if(p.revision!==d.pointer.revision&&p.revision!==result.receipt.revision)
   return {...copy(result),needsReload:false,newerVersion:true};
  await session.attach(result.receipt);
  result.needsReload=false;return copy(result);
 }
 function commit(d,change,undo=false){
  const signature=sourceEditJson({change,undo});
  if(d.promise){if(signature!==d.signature)return Promise.reject(Error('正在保存另一份修改'));return d.promise}
  if(d.result){if(signature!==d.signature)return Promise.reject(Error('此编辑已经保存，请重新打开'));return finishAdoption(d)}
  if(d.signature&&d.signature!==signature)d.operationId=makeId();
  d.signature=signature;
  d.promise=(async()=>{
   await ensureReady();current(d.token);
   const prepared=prepare(d,change,undo);
   if(!prepared.changed)return {ok:true,changed:false,committed:false};
   try{
    const saved=await commitWorld(prepared.world,{assertCurrent:()=>assertCurrent(d,{checkBusy:false}),checkScope:()=>scopeGuard(d)},
     {kind:d.input.kind==='fields'?'field-schema':undo?'source-edit-undo':'source-edit',operation_id:d.operationId});
    d.result={ok:true,changed:true,committed:true,receipt:saved.receipt,needsReload:false,preservedFields:prepared.preservedFields};
   }catch(error){
    if(!error.sw2Committed)throw error;
    d.result={ok:true,changed:true,committed:true,receipt:error.sw2Committed.receipt,needsReload:true,
     savedToOriginal:d.scope!==getScope(),preservedFields:prepared.preservedFields};
   }
   return copy(d.result);
  })().finally(()=>{d.promise=null});
  return d.promise;
 }
 return {
  async open({kind,entityId,key}={}){
   const scope=getScope();await ensureReady();
   if(scope!==getScope())throw Error('聊天已改变，请重新打开编辑');
   if(drafts.get(scope)?.promise)throw Error('正在保存编辑，请稍候');
   if(getBusy())throw Error('请先核对或停止当前世界操作');
   const state=session.readState(),world=session.readWorld();if(!state?.pointer||!world)throw Error('请先载入浏览器正式世界');
   const input=kind==='entity'?readSourceEntityDraft(world,entityId):kind==='setting'?readSourceSettingDraft(world,key):kind==='fields'?{kind:'fields',target:'world-fields',schema:readWorldFieldSchema(world),value:readWorldFieldSchema(world).fields,candidates:discoverWorldFieldCandidates(world)}:null;
   if(!input)throw Error('请选择人物档案或世界设定');
   const last=world.meta?.sourceEdits?.last;
   const draft={token:makeId(),operationId:makeId(),scope,pointer:copy(state.pointer),input:copy(input),
    undoId:last?.kind===input.kind&&last.target===input.target?last.id:null,promise:null,result:null,signature:null};
   drafts.set(scope,draft);return {token:draft.token,...copy(input),canUndo:!!draft.undoId};
  },
  async preview(token,change){await ensureReady();const {changed,changes,preservedFields}=prepare(current(token),change);return {changed,changes,preservedFields}},
  save(token,change){try{return commit(current(token),change)}catch(error){return Promise.reject(error)}},
  undo(token){try{const d=current(token);if(!d.undoId)throw Error('没有可撤销的本项修改');return commit(d,{},true)}catch(error){return Promise.reject(error)}},
  cancel(token){for(const [scope,draft] of drafts){if(draft.token!==token)continue;if(draft.promise)return false;drafts.delete(scope);return true}return false},
  get busy(){return !!drafts.get(getScope())?.promise}
 };
}
