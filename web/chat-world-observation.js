import {buildChatWorldContext,movementQueryText,chatReferencePositions} from '../src/chat-world-context.js';
import {isFinalizedPublication} from '../src/finalized-source.js';

// One immutable publication per journal, released with that journal or replaced on world switch.
const initialSourceCache=new WeakMap();
export async function initialSourcePublication(journal,world,signal){
 const root=world.meta?.sourcePublication;
 if(isFinalizedPublication(root)){initialSourceCache.delete(journal);return null;}
 const key=root?JSON.stringify([root.library_id,root.version]):null;
 if(initialSourceCache.get(journal)?.key!==key)initialSourceCache.delete(journal);
 if(!root||root.conversion?.baseline_hash||!journal.db?.sourceVersions||!root.library_id||!Number.isSafeInteger(root.version)){initialSourceCache.delete(journal);return null;}
 const cached=initialSourceCache.get(journal);
 if(cached?.key===key)return cached.publication;
 try{
  const fixed=await journal.db.sourceVersions.get([root.library_id,root.version]);cancelled(signal);
  if(!fixed||fixed.library_id!==root.library_id||fixed.version!==root.version||!Array.isArray(fixed.records))return null;
  const publication={library_id:fixed.library_id,version:fixed.version,records:fixed.records,baseline_authority:'immutable-source-version'};
  initialSourceCache.set(journal,{key,publication});return publication;
 }catch(error){if(error.name==='AbortError')throw error;return {read_error:String(error.message)};}
}

function cancelled(signal){if(signal?.aborted){const error=new Error('聊天上下文准备已取消');error.name='AbortError';throw error;}}
function receiptScope(value,pointer){
 if(value?.revision!==pointer.revision||(value.world_id!==undefined&&value.world_id!==pointer.world_id)
  ||(value.branch_id!==undefined&&value.branch_id!==pointer.branch_id))throw Error('聊天资料世界身份或版本不匹配');
}
export async function chatWorldObservation({journal,memory,pointer,input,signal}){
 const includeState=input.include_current_state,query=input.query,relevance=input.relevance_text??query;
 const movementMax=input.movement_max_chars??0,historyMax=input.max_chars,options=input.search_options;
 if(typeof includeState!=='boolean'||typeof query!=='string'||typeof relevance!=='string'
  ||!Number.isSafeInteger(input.revision)||input.revision<0||!Number.isSafeInteger(movementMax)||movementMax<0
  ||!Number.isSafeInteger(historyMax)||historyMax<0)throw Error('聊天上下文参数无效');
 if(options&&(!Number.isSafeInteger(options.maxRecords)||options.maxRecords<1||!Number.isFinite(options.similarity)||options.similarity<0||options.similarity>1))throw Error('聊天检索参数无效');
 const fixed={...pointer,revision:input.revision};cancelled(signal);
 const current=await (journal.getWorkingWorld??journal.getWorld).call(journal,fixed,{revision:fixed.revision,stateOnly:true});cancelled(signal);receiptScope(current,fixed);
 const baselinePublication=includeState?await initialSourcePublication(journal,current.world,signal):null;cancelled(signal);
 const batch=includeState?await journal.getMovements(fixed,{after_revision:input.movement_after_revision??null}):{records:[],range:null};cancelled(signal);
 const movements=batch.records??[],motionQuery=movementQueryText(movements);
 const queries=[...new Set([query,motionQuery].map(s=>s.trim()).filter(Boolean))];
 let original=[],recalls=[];
 if(historyMax>0&&queries.length){
  original=typeof journal.getRecordsAtPositions==='function'?await journal.getRecordsAtPositions(fixed,chatReferencePositions(current.world,relevance)):await journal.getRecords(fixed);cancelled(signal);
  const refs=buildChatWorldContext(current.world,{query:relevance,movements,records:original,includeState:false});
  for(const term of queries){
   cancelled(signal);
   const value=await memory.search(fixed,{query:term,referenceIds:refs.referenceIds,purpose:'world',excludeSettings:true,
    ...(options?{maxRecords:options.maxRecords,similarity:options.similarity}:{})},{signal});
   cancelled(signal);receiptScope(value,fixed);
   if(value.limited)throw Error('相关正式记录尚未完整读取，聊天上下文未采用');
   recalls.push(value);
  }
 }
 const records=recalls.flatMap(r=>r.records??[]);
 const built=buildChatWorldContext(current.world,{query:relevance,movements,records,includeState,
  movementMaxChars:movementMax,historyMaxChars:historyMax,range:batch.range,baselinePublication});
 return {...fixed,purpose:'chat',observer_id:current.world.context?.playerId??null,
  text:built.history.text,records:built.history.records,omitted:built.history.omitted,excluded:{},
  limited:false,memory:{mode:recalls.at(-1)?.mode??'not-requested',reason:null,
   vector_unavailable:recalls.some(r=>r.vector_unavailable),vector_reason:recalls.find(r=>r.vector_reason)?.vector_reason??null},
  state_text:built.state.text,state_records:built.state.records,state_omitted:[],state_limited:false,state_reason:null,
  state_diagnostics:[...(built.state.diagnostics??[]),...(baselinePublication?.read_error?[{reason:'source-baseline-read-failed',message:baselinePublication.read_error}]:[])],
  movement_text:built.movement.text,movement_records:built.movement.records,movement_omitted:built.movement.omitted,
  movement_limited:built.movement.limited,movement_notice:built.movement.notice,movement_range:built.range,
  history_notice:built.history.notice};
}
