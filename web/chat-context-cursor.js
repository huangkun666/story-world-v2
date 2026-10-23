import {assistantMessage,messageReference} from "./message-consumption.js";

const sameRef=(a,b)=>!!a&&!!b&&["chatId","messageId","version","fingerprint"].every(k=>a[k]===b[k]);
const messageVersion=(ctx,m)=>messageReference(ctx,{message_id:1,mes:m.mes,swipe_id:m.swipe_id??m.swipeId??0});
const validRevision=n=>Number.isSafeInteger(n)&&n>=0;

// 这里只记录本次正常聊天产出使用到的世界版本，不消费世界正文标签。
export function createChatContextCursor({getCtx,getState,onStatus=()=>{}}){
 let prepared=null;
 function current(){
  const state=getState();
  if(!state||typeof state.scope!=="string"||!state.scope||state.client?.supportsFullCurrentState!==true
   ||typeof state.client.readChatCursor!=="function"||typeof state.client.saveChatCursor!=="function"
   ||!state.pointer?.world_id||!state.pointer.branch_id||!validRevision(state.pointer.revision))return null;
  return {...state,pointer:{...state.pointer}};
 }
 function matches(a,b){return !!a&&!!b&&a.scope===b.scope&&a.client===b.client&&a.pointer.world_id===b.pointer.world_id&&a.pointer.branch_id===b.pointer.branch_id}
 function contains(ctx,ref){return (ctx?.chat??[]).some(m=>assistantMessage(m)&&sameRef(messageReference(ctx,m),ref))}
 async function readAfterRevision(){
  try{
   const state=current();if(!state)return null;
   const row=await state.client.readChatCursor(state.scope,state.pointer);
   const latest=current();
   if(!matches(state,latest)||!row||row.world_id!==state.pointer.world_id||row.branch_id!==state.pointer.branch_id
    ||!validRevision(row.through_revision)||row.through_revision>latest.pointer.revision||!contains(getCtx(),row.message_ref))return null;
   return row.through_revision;
  }catch{return null}
 }
 function notePrepared(receipt){
  prepared=null;
  const state=current(),ctx=getCtx();
  if(!state||!receipt||receipt.world_id!==state.pointer.world_id||receipt.branch_id!==state.pointer.branch_id
   ||!validRevision(receipt.revision)||receipt.revision>state.pointer.revision
   ||receipt.movement_range&&receipt.movement_range.through_revision!==receipt.revision)return;
  const refs=(ctx?.chat??[]).filter(assistantMessage).map(message=>({message,ref:messageReference(ctx,message),version:messageVersion(ctx,message)}));
  prepared={...state,revision:receipt.revision,refs,saving:false};
 }
 async function confirmMessage(messageIndex){
  const pending=prepared;
  if(!pending||pending.saving||!Number.isSafeInteger(messageIndex)||messageIndex<0)return false;
  const state=current(),ctx=getCtx(),message=ctx?.chat?.[messageIndex];
  if(!matches(pending,state)||state.pointer.revision<pending.revision||!assistantMessage(message)||typeof message.mes!=="string"||!message.mes.trim())return false;
  const stream=ctx.streamingProcessor;
  if(stream&&(stream.messageId!==messageIndex||stream.isFinished!==true||stream.isStopped!==false
   ||stream.abortController?.signal?.aborted!==false||(Array.isArray(stream.toolCalls)&&stream.toolCalls.length)))return false;
  // 没有公开消息事件能力的宿主不能证明这是正常生成的助手结果。
  const events=ctx.eventTypes??ctx.event_types;
  if(!ctx.eventSource?.on||!events?.MESSAGE_RECEIVED)return false;
  const existingRef=messageReference(ctx,message);
  if(pending.refs.some(old=>sameRef(old.ref,existingRef)||(old.message===message&&sameRef(old.version,messageVersion(ctx,message)))))return false;
  const ref=messageReference(ctx,message,{create:true});
  if(!ref)return false;
  pending.saving=true;
  try{
   const saved=await state.client.saveChatCursor(state.scope,{...state.pointer,revision:pending.revision},{through_revision:pending.revision,message_ref:ref});
   if(!saved||saved.world_id!==pending.pointer.world_id||saved.branch_id!==pending.pointer.branch_id||saved.through_revision!==pending.revision||!sameRef(saved.message_ref,ref))throw Error();
   if(prepared!==pending||!matches(pending,current())||!sameRef(messageReference(getCtx(),message),ref))return false;
   prepared=null;return true;
  }catch{
   try{onStatus("聊天动向读取位置暂未保存，下次会保留这些动向")}catch{}
   return false;
  }finally{pending.saving=false}
 }
 function invalidate(){prepared=null}
 const ctx=getCtx(),events=ctx?.eventTypes??ctx?.event_types;
 if(ctx?.eventSource?.on){
  if(events?.MESSAGE_RECEIVED)ctx.eventSource.on(events.MESSAGE_RECEIVED,index=>confirmMessage(index));
  if(events?.GENERATION_STOPPED)ctx.eventSource.on(events.GENERATION_STOPPED,invalidate);
 }
 return {readAfterRevision,notePrepared,confirmMessage,invalidate};
}
