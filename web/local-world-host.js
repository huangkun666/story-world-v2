import {sha256Hex} from '../src/browser-capabilities.js';
import {createSourceEditHost} from './source-edit-host.js';
import {hasSourceSettingConflict} from '../src/source-edit.js';
import {initializePlayerWorld,playerMatches} from './source-player.js';
import {worldSearchOptions,sourceTargetChars,positiveSetting,extractionCallLimits} from '../src/runtime-settings.js';
import {SOURCE_FIELD_PROTOCOL} from '../src/source-field-table.js';
import {SOURCE_WORKSPACE_PROTOCOL} from '../src/source-workspace.js';
import {sourceTaskDiagnostics} from '../src/source-task-diagnostics.js';
import {validate} from '../src/schema.js';
import {geographySchema,BEARING_DIRECTIONS} from '../src/schemas/geography.schema.js';
import {sourceGeography,sourceSettingPatch} from '../src/source-world.js';
import {applySettingToSsot,scalesToFlat,assembleSetting,EXTRACT_CONCURRENCY} from '../src/abstract.js';
import {normalizeExtractChunkChars} from '../src/abstract-limits.js';
import {createWorldJournal,readBrowserBackupPayload} from './world-journal.js';
import {createWorldMemory} from './world-memory.js';
import {createWorldCoordinator} from './world-coordinator.js';
import {createLocalWorldClient} from './local-world-client.js';
import {sourceImportFailureMessage} from './source-progress.js';
import {canonicalSourceJson} from '../src/source-records.js';
import {createLocalSourceClient,canReassembleSourceImport} from './local-source-client.js';
import {createServiceSession,createWorldQueueRouter} from './service-session.js';
import {isConfirmedFailedOperation} from './operation-status.js';
import {chatScope} from './message-consumption.js';
import {chatIdentity} from '../src/chat-scope.js';
import {operationId} from '../src/browser-capabilities.js';
import {stripPlayerParams} from '../src/param-ownership.js';
import {RULES_FINGERPRINT} from './service-contract.js';
import {createEmbedClient,readEmbedConfig,embedEnabled} from '../src/embed-client.js';
import {createBrowserModel} from './browser-model.js';
import {loadHotAccount} from '../src/storage.js';
export const LOCAL_META_KEY='story_world_v2_browser';
// 聊天里那个指针**在库里找不到世界**时，指针搬到这一格留着（只作痕迹与提示，不再当活动账）。
// 不许无声删掉：用户要知道“这个聊天原先用的世界不在这台机器上”。
export const LOCAL_MISSING_KEY='story_world_v2_browser_missing';
export const MISSING_WORLD_TEXT='这个聊天原先用的世界不在这台机器上（可能是在别的浏览器或设备上建的）。请在那台设备用「导出旧档（连历史）」导出，再在这里用「导入恢复」搬进来。';
export const DETACHED_TEXT='你之前明确“返回旧账”过，插件不会自动把浏览器里的那个世界接回来。要用它请在「存档管理」里重新导入存档。';
export const CONNECTION_MISMATCH_TEXT='这个聊天记的浏览器连接不是现在这一份（多半是从别的环境带过来的），插件没有把它当活动账。要用库里的世界请重新导入存档。';
const copy=v=>structuredClone(v);
const validPointer=p=>!!p&&['world_id','branch_id'].every(k=>typeof p[k]==='string'&&p[k])&&Number.isSafeInteger(p.revision)&&p.revision>=0;
// 这一场聊天有没有**可用的身份**：chatId 取不到时 `chatScope` 会退化成 [null,char,null]，
// 同角色的所有聊天共用一格绑定 ⇒ 那种情况下不自动接、也不写镜像（宁可不动，也不串聊天）。
const noticeFor=reason=>reason==='user-detached'?DETACHED_TEXT:reason==='connection-mismatch'?CONNECTION_MISMATCH_TEXT:MISSING_WORLD_TEXT;
export const STALE_TEXT='聊天或世界已改变，旧结果未应用';
const PHASE_HUMAN={queued:'准备推进',prepare:'准备世界事务',retrieve:'检索历史',pack:'整理本轮资料',model:'等待世界推演',settle:'核对提议',save:'保存候选',proposed:'候选已生成，等待提交',commit:'提交世界',committed:'已提交',cancelled:'已停止',failed:'本轮失败，请核对诊断','model-unknown':'模型结果尚未确认，请核对原请求','retrieval-limited':'背景资料未完整读取，可继续原推进'};
const SOURCE_HUMAN={'source-batch-requested':()=> '正在抽象世界资料…','oversized-entry':()=> '正在抽象世界资料…','source-requested':()=> '正在抽象世界资料…','source-received':()=> '正在整理抽象结果…','source-failed':()=> '抽象失败，请重新抽象','source-succeeded':()=> '正在整理抽象结果…'};
/** coordinator/source 的状态对象只许映成人话；看不懂就如实说"进行中"，绝不直接印 English phase/object。 */
export function humanStatusText(value) {
 if(value==null)return '世界操作进行中';
 if(typeof value==='string'){
  if(PHASE_HUMAN[value])return PHASE_HUMAN[value];
  if(/[\u4e00-\u9fff]/.test(value))return value;
  return '世界操作进行中';
 }
 if(typeof value==='object'){
  const code=value.code??value.phase??value.status;
  const maker=SOURCE_HUMAN[code]??(PHASE_HUMAN[code]?()=>PHASE_HUMAN[code]:null);
  if(maker)return maker(value);
  if(typeof value.message==='string'&&/[\u4e00-\u9fff]/.test(value.message))return value.message;
  return '世界操作进行中';
 }
 return '世界操作进行中';
}
// 本批地图单独核对，再按 ID 并入；旧地图不能替空候选通过校验。
function mapCandidate(records,existing,settingGeography){
 const candidate=copy(settingGeography??sourceGeography(records).geography??{version:1,places:[],links:[]});
 const merge=(base,add)=>{
  const byId=new Map();for(const p of base.places){if(byId.has(p.id))throw Error('地点 ID 冲突：'+p.id);byId.set(p.id,p);}
  for(const p of add?.places??[]){const prior=byId.get(p.id);if(prior){if(prior.name!==p.name||(prior.qualifier&&p.qualifier&&prior.qualifier!==p.qualifier))throw Error('地点 ID 冲突：'+p.id);if(p.aliases?.length)prior.aliases=[...new Set([...(prior.aliases??[]),...p.aliases])];}else{const row=copy(p);base.places.push(row);byId.set(p.id,row);}}
  const keys=new Set(base.links.map(l=>JSON.stringify(l)));for(const l of add?.links??[]){const key=JSON.stringify(l);if(!keys.has(key)){base.links.push(copy(l));keys.add(key);}}
  return base;
 };
 if(!candidate.places.length&&!candidate.links.length)throw Error('地图候选没有明述地点或地点关系，原地图保留');
 const next=merge(copy(existing??{version:1,places:[],links:[]}),candidate),shape=validate(next,geographySchema);if(!shape.ok)throw Error('地图候选形状不合法：'+shape.errors.join('；'));
 const ids=new Set(next.places.map(p=>p.id));for(const l of next.links)if(!ids.has(l.from)||!ids.has(l.to)||l.from===l.to||(l.type==='bearing'&&!BEARING_DIRECTIONS.includes(l.bearing)))throw Error('地图候选的地点关系不完整，请核对地点 ID 与明确方位');
 return next;
}
export function createLocalWorldHost({creationDiagnostics=null,metaKey=LOCAL_META_KEY,sourceProtocol=SOURCE_WORKSPACE_PROTOCOL,getCtx,onWorld=()=>{},onStatus=()=>{},onStateChange=()=>{},onOutcome=()=>{},onSnapshots=()=>{},getBusy=()=>false,getReprocessBusy=()=>false,journal:provided=null,model:providedModel=null}={}) {
 let journal=provided,client=null,source=null,coordinator=null,memory=null,memorySignature=null,draft=null,readyScope=null,readyPromise=null,sourceProgress=null;
 const scopeWork=new Map();
 const working=kind=>scopeWork.get(chatScope(getCtx()))?.has(kind)??false;
 function holdWork(kind){const scope=chatScope(getCtx()),tasks=scopeWork.get(scope)??new Set();scopeWork.set(scope,tasks);tasks.add(kind);return ()=>{tasks.delete(kind);if(!tasks.size&&scopeWork.get(scope)===tasks)scopeWork.delete(scope)}}
 let readyGeneration=0;const bindingSaves=new Map();
 const drafts=new Map();let snapshotCache=null,maintenance=null,memoryChannelSignature=null,memoryFetch=null;
 // Host status is the only channel that reaches the player; map coordinator phases and source
 // notification objects to human text here instead of printing raw English.
 const reportState=()=>{try{if(maintenance&&!maintenanceMatchesCurrent(maintenance))stopMaintenance();onStateChange()}catch{}};
 const reportStatus=(value,origin=null)=>{
  if(origin){const state=session.readState(),pending=getCtx()?.chatMetadata?.[metaKey]?.pending;
   if(origin.owner!==chatScope(getCtx())||state?.pointer.world_id!==origin.world_id
    ||state?.pointer.branch_id!==origin.branch_id||pending?.input?.operation_id!==origin.operation_id)return;
  }
  try{onStatus(humanStatusText(value));reportState()}catch{/* UI must never change durable execution. */}
 };
 const settings=()=>getCtx()?.extensionSettings?.story_world_v2??{};
 const database=()=>journal??=createWorldJournal();
 const connection=()=> 'browser:'+database().db.name;
 const model=(prompt,options)=>providedModel?providedModel(prompt,options):createBrowserModel(settings(),{extraction:options?.task==='source-extraction',presetPurpose:options?.task==='source-extraction'?'abstract':options?.task==='world-generation'?'simulate':null})(prompt,options);
 function recall() {
  const cfg=readEmbedConfig(settings()),enabled=embedEnabled(cfg);
  const signature=JSON.stringify(enabled?[cfg.baseUrl,cfg.model,cfg.dims??0]:['fulltext-v1']);
  // Authentication and batch settings rebuild the channel, while durable vector identity stays stable.
  const canonicalScope=metaKey==='story_world_v2_creation_world'?session.readState()?.pointer?.world_id??null:null;
  const channel=JSON.stringify([signature,canonicalScope,enabled?cfg.apiKey:null,cfg.rowsPerRequest]);
  if(!memory||channel!==memoryChannelSignature||memoryFetch!==settings().fetchImpl){memory?.invalidate();memorySignature=signature;memoryChannelSignature=channel;memoryFetch=settings().fetchImpl;memory=createWorldMemory({journal:database(),...(enabled?{embedder:createEmbedClient({...cfg,dimensions:cfg.dims,batchSize:cfg.rowsPerRequest??undefined,fetchImpl:memoryFetch}),embeddingIdentity:canonicalScope?JSON.stringify([canonicalScope,signature]):signature}:{})})}
  return memory;
 }

 function stopMaintenance(){if(maintenance){maintenance.controller.abort();maintenance=null;}}
 function maintenanceMatchesCurrent(job){
  const state=session.readState();return !!state&&state.scope===job.scope&&state.client===job.client
   &&JSON.stringify(state.pointer)===JSON.stringify(job.pointer);
 }
 function refreshMemory({retry=true}={}){
  try{
   const state=session.readState();if(!state){stopMaintenance();return Promise.resolve({status:'inactive'});}
   const current=recall(),pointer=copy(state.pointer),key=JSON.stringify([state.scope,pointer]);
   if(maintenance?.key===key&&maintenance.memory===current
    &&(!maintenance.settled||!retry||['done','disabled'].includes(maintenance.result?.status)))return maintenance.promise;
   stopMaintenance();
   const job={key,pointer,scope:state.scope,client:state.client,memory:current,controller:new AbortController(),promise:null};
   maintenance=job;
   job.promise=Promise.resolve().then(()=>current.maintain(pointer,{signal:job.controller.signal}))
    .then(result=>{job.settled=true;job.result=result;if(maintenance===job&&maintenanceMatchesCurrent(job)){
      if(['failed','unknown'].includes(result.status))reportStatus(result.status==='unknown'
       ?'向量请求结果未确认，已停止自动补发；文字检索和世界记录仍可用':'向量暂未补齐，文字检索和世界记录仍可用');
      reportState();
     }return result;})
    .catch(()=>{job.settled=true;job.result={status:'failed'};return job.result;});
   return job.promise;
  }catch{return Promise.resolve({status:'failed'});}
 }

 const memoryProxy={search:(...a)=>recall().search(...a)};
 function getClient(){if(!client){coordinator=createWorldCoordinator({journal:database(),memory:memoryProxy,model,onStatus:reportStatus,getStatusOwner:()=>chatScope(getCtx()),getSearchOptions:()=>worldSearchOptions(settings()),modelIdentity:()=>({provider:settings().baseUrl??'configured',model:settings().model??'configured'})});client=createLocalWorldClient({journal:database(),memory:memoryProxy,coordinator})}return client}
 function reportSourceStatus(value){
  if(value?.code==='source-progress'){
   const active=sourceProgress;if(active&&value.import_id===active.import_id&&active.scope===chatScope(getCtx())&&!active.signal?.aborted)
    try{active.onProgress({...value,model:settings().model??'已配置模型'});}catch{}
   return;
  }
  if(!sourceProgress)reportStatus(value);
 }
 function getSource(){return source??=createLocalSourceClient({journal:database(),model,initialize:initializePlayerWorld,onStatus:reportSourceStatus,chunkChars:()=>sourceTargetChars(settings()),concurrency:()=>positiveSetting(settings().extractConcurrency,EXTRACT_CONCURRENCY),outputTokens:()=>extractionCallLimits(settings()).maxTokens})}
 async function persist(ctx,options={}) {
  const scope=chatScope(ctx),state=copy(ctx.chatMetadata?.[metaKey]??null);
  const previousSave=bindingSaves.get(scope)??Promise.resolve();
  const save=previousSave.catch(()=>{}).then(async()=>{
  // “用户明确返回旧账”要**落在库里**才算数：只存在聊天文件那份镜像里的话，宿主保存失败就会被自动拉回。
  // 写指针（接了世界）⇒ 清掉这个标记；明确返回旧账 ⇒ 打上；其余没指针的写（例如资料草稿）⇒ 原样保留。
  const previous=await database().db.bindings.get(scope);
  const user_detached=state?false:(options.detached===true||previous?.user_detached===true);
  await database().db.bindings.put({...previous,scope,state:copy(state),draft:copy(drafts.get(scope)??previous?.draft??null),user_detached});
  // Host metadata is a pointer mirror. The IndexedDB receipt/binding remains authoritative.
  try{await ctx.saveMetadata?.()}catch{if(scope===chatScope(getCtx()))reportStatus('世界已保存在浏览器；宿主指针镜像暂未保存')}
  });bindingSaves.set(scope,save);
  try{return await save}finally{if(bindingSaves.get(scope)===save)bindingSaves.delete(scope)}
 }
 const session=createServiceSession({getCtx,getClient,getConnectionId:connection,rulesFingerprint:RULES_FINGERPRINT,metaKey:metaKey,makeOperationId:operationId,persist,onWorld:world=>{const scope=chatScope(getCtx()),pointer=JSON.stringify(session.readState()?.pointer);const current=()=>scope===chatScope(getCtx())&&pointer===JSON.stringify(session.readState()?.pointer);refreshMemory({retry:false});onWorld(world);refreshSnapshots().then(value=>{if(value&&current())onSnapshots(value)}).catch(()=>{if(current())reportStatus('历史列表暂未读到，可再次核对')})},onStatus:reportStatus,onStateChange:reportState,onOutcome});
 async function ready() {
  const ctx=getCtx(),scope=chatScope(ctx);
  // Existing legacy data can still be read when local storage capability is absent.
  // A browser binding or a new browser-world write always requires the canonical database.
  if((!journal||journal.available===false)&&(!globalThis.indexedDB?.open||!globalThis.IDBKeyRange)&&!ctx?.chatMetadata?.[metaKey])return {ok:true,legacy:true};
  if(readyScope===scope)return readyPromise;
  stopMaintenance();readyScope=scope;draft=null;const generation=++readyGeneration;
  const isCurrent=()=>generation===readyGeneration&&scope===chatScope(getCtx());
  readyPromise=(async()=>{
   const row=await database().db.bindings.get(scope);
   if(!isCurrent()){if(generation===readyGeneration)readyScope=null;return {ok:false,stale:true}}
   ctx.chatMetadata??={};
   const current=connection(),mirrored=row?.state??null;
    if(mirrored&&mirrored.connection_id===current){
     const pointer=validPointer(mirrored.pointer)?mirrored.pointer:null;
     const head=pointer?await database().db.heads.get([pointer.world_id,pointer.branch_id]):null;
     if(!isCurrent()){if(generation===readyGeneration)readyScope=null;return {ok:false,stale:true}}
     if(head&&head.revision>=pointer.revision)ctx.chatMetadata[metaKey]=copy(mirrored);
     else{
      ctx.chatMetadata[LOCAL_MISSING_KEY]={pointer:copy(mirrored.pointer??null),at:new Date().toISOString(),reason:'missing-world'};
      delete ctx.chatMetadata[metaKey];reportStatus(MISSING_WORLD_TEXT);
     }
    }
   else if(mirrored){
    // 库那行的连接标识不是这一份 ⇒ 不许拿它当活动账（§30：连接标识不匹配不得静默改指到另一份账）。
    ctx.chatMetadata[LOCAL_MISSING_KEY]={pointer:copy(mirrored.pointer??null),at:new Date().toISOString(),reason:'connection-mismatch'};
    delete ctx.chatMetadata[metaKey];reportStatus(CONNECTION_MISMATCH_TEXT);
   }else if(row?.user_detached===true){
    // ★用户明确“返回旧账”过（那次聊天文件没保存成功也是可能的）⇒ 该聊天里的旧指针不许把他拉回来。
    const stale=ctx.chatMetadata[metaKey]??null;
    if(validPointer(stale?.pointer))ctx.chatMetadata[LOCAL_MISSING_KEY]={pointer:copy(stale.pointer),at:new Date().toISOString(),reason:'user-detached'};
    delete ctx.chatMetadata[metaKey];reportStatus(DETACHED_TEXT);
   }else{
    // ★开聊天自动接上（用户2026-10-16"可以"）：库那行没有镜像时，不直接把手里的指针删掉了事。
    //   指针在 ＋ 库里该世界也在 ⇒ 接上（未决记录原样留着，绝不许抹掉还能救的那一轮）；
    //   指针在 ＋ 库里没有该世界 ⇒ **不接**，把指针挪到痕迹格、用人话说明，绝不假装没事。
    const state=ctx.chatMetadata[metaKey]??null,pointer=validPointer(state?.pointer)?state.pointer:null;
    if(pointer&&chatIdentity(ctx).chatId){
     const head=await database().db.heads.get([pointer.world_id,pointer.branch_id]);
     if(!isCurrent()){if(generation===readyGeneration)readyScope=null;return {ok:false,stale:true}}
     if(head&&head.revision>=pointer.revision){
      // 接上就**收敛到这条分支的当前 HEAD**（与切分支同一口径）：指针落后时不许把用户留在旧版本上，
      // 否则下一次推进会撞上英文的 "Stale expected revision"。只往前、不往回退。
      ctx.chatMetadata[metaKey]={connection_id:current,pointer:{...pointer,revision:head.revision},pending:state?.pending??null};
      // 只把镜像写回库那行；这里不碰聊天文件（"要不要连旧账也彻底停写"是另一个待用户拍的决定，见 design-baseline §31）。
      await database().db.bindings.put({...row,scope,state:copy(ctx.chatMetadata[metaKey]),draft:copy(row?.draft??null),user_detached:false});
     }else{
      ctx.chatMetadata[LOCAL_MISSING_KEY]={pointer:copy(pointer),at:new Date().toISOString(),reason:'missing-world'};
      delete ctx.chatMetadata[metaKey];
      reportStatus(MISSING_WORLD_TEXT);
     }
    }else if(ctx.chatMetadata[metaKey])delete ctx.chatMetadata[metaKey];
   }
   // The switch may have happened while saving the row; do not publish its old draft.
   if(!isCurrent()){if(generation===readyGeneration)readyScope=null;return {ok:false,stale:true}}
   draft=copy(row?.draft??null);drafts.set(scope,copy(draft));
   return {ok:true};
  })();
  try{return await readyPromise}catch(error){if(generation===readyGeneration)readyScope=null;throw error}
 }
 /** ready 的"必须真就绪"版本：跨聊天/跨世界时明确拒绝，调用方不许拿半个结果往前走。 */
 async function ensureReady() {const scope=chatScope(getCtx()),pending=ready(),generation=readyGeneration;const result=await pending;if(result?.stale||scope!==chatScope(getCtx())||generation!==readyGeneration)throw Error(STALE_TEXT);return result}
 const idle=()=>{if(session.busy||getBusy())throw Error('请先核对或停止当前世界操作')};
 async function commitWorld(world,guard=null,{kind='edit',sourceAdoption=false,operation_id=null}={}) {
  const ownerScope=chatScope(getCtx()),ownerPointer=JSON.stringify(session.readState()?.pointer??null);
  // Synchronous latch: two rapid commits must not both read the old revision and race the same parameters.
  if(working('commit')||working('binding')||(working('adoption')&&!sourceAdoption))throw Error('正在提交世界改动，请稍候再试');
  const releaseCommit=holdWork('commit');reportState();let committed=null;
  try {
   await ensureReady();idle();guard?.assertCurrent();
   const ctx=getCtx(),scope=chatScope(ctx),state=session.readState();if(!state)throw Error('请先载入世界');
   if(scope!==ownerScope||ownerPointer!=='null'&&ownerPointer!==JSON.stringify(state.pointer))throw Error(STALE_TEXT);
   const receipt=await getClient().mutate(state.pointer,{operation_id:operation_id??operationId(),expected_revision:state.pointer.revision,kind,world:copy(world),...(state.record_view?{partial:copy(state.record_view)}:{})});
   committed={receipt:receipt.receipt};
   if(scope!==chatScope(getCtx()))throw Error('世界已保存到原聊天，当前聊天未采用旧结果');
   guard?.checkScope?.();
   // ★2026-10-16（用户令）：参数类改动只存参数、**不新增世界版本**（版本号原地不动）——
   //   这时不动指针，但要重新载入一次，界面才会读到刚保存的参数（否则面板画的还是旧值）。
   if(receipt.receipt?.params_only){
    if(typeof session.load==='function')await session.load();
    if(scope!==chatScope(getCtx()))throw Error('世界已保存到原聊天，当前聊天未采用旧结果');
    return {ok:true,receipt:receipt.receipt,world:copy(session.readWorld()??world),paramsOnly:true,paramsChanged:!!receipt.receipt.params_changed};
   }
   await session.attach({...state.pointer,revision:receipt.receipt.revision});
   if(scope!==chatScope(getCtx()))throw Error('世界已保存到原聊天，当前聊天未采用旧结果');
   return {ok:true,receipt:receipt.receipt,world:copy(world)};
  } catch(error){if(committed)error.sw2Committed=committed;throw error} finally {releaseCommit();reportState()}
 }
 const sourceEditor=createSourceEditHost({session,commitWorld,ensureReady,getScope:()=>chatScope(getCtx()),getBusy:()=>working('commit')||working('adoption')||working('binding')||session.busy||getBusy(),makeId:operationId});
 async function refreshSnapshots(){
  const scope=chatScope(getCtx()),p=session.readState()?.pointer;if(!p){snapshotCache=null;return null}
  const rows=await database().listSnapshotMetadata(p);
  if(scope!==chatScope(getCtx())||JSON.stringify(p)!==JSON.stringify(session.readState()?.pointer))return null;
  snapshotCache={key:JSON.stringify([scope,p]),mode:'browser',branch_id:p.branch_id,list:rows};return copy(snapshotCache);
 }
 function readSnapshotCache(){const key=JSON.stringify([chatScope(getCtx()),session.readState()?.pointer]);return snapshotCache?.key===key?copy(snapshotCache):{mode:'browser',branch_id:session.readState()?.pointer?.branch_id??null,list:[],loading:true}}
 async function readDraft({includeOriginals=true}={}) {
  const scope=chatScope(getCtx());
  await ensureReady();
  if(scope!==chatScope(getCtx()))return null;
  if(!draft)return null;
  const snapshot=await getSource().getDraftSnapshot(draft.library_id,draft.import_id,{includeOriginals}),records=[],candidates={};
  for(const candidate of snapshot.candidates){records.push(...candidate.records);candidates[candidate.source_id]=candidate}
  // Reading candidates is async: the chat may have changed under us; never hand old draft data to a new chat.
  if(scope!==chatScope(getCtx()))return null;
  return {...copy(draft),import:snapshot.import,records,candidates};
 }
 async function beginNewWorld(entries,{worldName='新世界',mode='world',replacePending=false,signal=null,onStopReady=()=>{},onProgress=null}={}) {
  let releaseStop;const stopReady=new Promise(resolve=>releaseStop=resolve);onStopReady(stopReady);let stopping=null;
  try{await ensureReady();idle();if(signal?.aborted)return {ok:false,cancelled:true};const scope=chatScope(getCtx()),ctx=getCtx();let recoveryTask=null;
  if(draft){const prior=await getSource().getImport(draft.library_id,draft.import_id);if(scope!==chatScope(getCtx()))return {ok:false,stale:true};if(!['cancelled','published'].includes(prior.status)){
    // 默认口径不变：旧草稿还没了结就先不动它。
    if(!replacePending)throw Error('已有待核对资料，请先采用或停止原任务');
    // 明确的"重新开始"：只有旧任务确实没在飞才许换。任何仍请求中/仍活着的来源一律拒绝——
    // 绝不替用户取消在飞请求，也绝不自动重发任何模型请求。
    const live=prior.execution?.running===true||prior.items.some(item=>item.status==='requested');
    if(live)throw Error('资料抽取仍在进行中，请先停止原任务再重新开始');
    if(canReassembleSourceImport(prior)&&draft.mode===mode&&draft.worldName===worldName){
     const input=await getSource().getImportInput(draft.library_id,draft.import_id);
     if(scope!==chatScope(getCtx()))return {ok:false,stale:true};
     if(canonicalSourceJson(input.entries)===canonicalSourceJson(entries))recoveryTask=copy(draft);
    }
    // 旧流程被打断（失败/未知/已完成）⇒ 显式取消旧任务；原件行一个字不改，新任务另起一行。
    if(!recoveryTask)await getSource().cancel(draft.library_id,draft.import_id);
    // 取消是异步的：换聊天/换世界时不许拿旧作用域的进度往前建新任务。
    if(scope!==chatScope(getCtx()))return {ok:false,stale:true};
   }}
  if(signal?.aborted)return {ok:false,cancelled:true};const priorDraft=copy(draft);
  draft=recoveryTask??{library_id:operationId(),import_id:operationId(),world_id:operationId(),branch_id:'main',worldName,mode,target:session.readState()?.pointer??null,extractedAt:new Date().toISOString()};
  drafts.set(scope,copy(draft));const task=copy(draft);
  // Register complete originals and the chat task together before any model can be sent.
  try{if(!recoveryTask)await database().db.transaction('rw',database().db.libraries,database().db.imports,database().db.bindings,async()=>{
   if(scope!==chatScope(getCtx()))throw Error(STALE_TEXT);
   await getSource().createLibrary(task.library_id);await getSource().beginImport(task.library_id,{import_id:task.import_id,entries,extraction_mode:mode,extraction_protocol:[SOURCE_FIELD_PROTOCOL,SOURCE_WORKSPACE_PROTOCOL].includes(sourceProtocol)&&mode!=='world'?'source-jobs-v5':sourceProtocol});
   const binding=await database().db.bindings.get(scope);
   if(scope!==chatScope(getCtx()))throw Error(STALE_TEXT);
   await database().db.bindings.put({...binding,scope,state:copy(ctx.chatMetadata?.[metaKey]??null),draft:copy(task)});
   if(scope!==chatScope(getCtx()))throw Error(STALE_TEXT);
  })}catch(error){drafts.set(scope,priorDraft);if(scope===chatScope(getCtx()))draft=copy(priorDraft);throw error}
  const stop=()=>{stopping??=getSource().cancel(task.library_id,task.import_id).catch(error=>{reportStatus('注意：停止抽象未能保存：'+error.message);return {ok:false,error}}).finally(releaseStop);};
  signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  const progress={import_id:task.import_id,scope,signal,onProgress};if(onProgress)sourceProgress=progress;
  let row;try{await persist(ctx);if(signal?.aborted){await stopping;return {ok:false,cancelled:true}}row=await getSource()[recoveryTask?'reprocessImport':'executeImport'](task.library_id,task.import_id);if(signal?.aborted){await stopping;return {ok:false,cancelled:true}}}finally{signal?.removeEventListener('abort',stop);if(sourceProgress===progress)sourceProgress=null;}
  if(scope!==chatScope(getCtx()))return {ok:false,stale:true};
  const ok=row.items.every(item=>item.status==='succeeded');
  const awaitingFields=row.staged?.status==='awaiting-fields';
  if(!onProgress)reportStatus(ok?'正在保存抽象结果…':awaitingFields?'名册与设定已完成，请确认抽取字段':'抽象失败：'+sourceImportFailureMessage(row));
  return {ok,awaitingFields,import:row};
  }finally{if(!stopping)releaseStop()}
 }
 async function resumeSource({library_id,import_id,fields,expected_revision,recovery=null,signal=null,onProgress=null,onStopReady=()=>{}}={}){
  await ensureReady();idle();const scope=chatScope(getCtx()),task=copy(draft);
  if(!task||task.library_id!==library_id||task.import_id!==import_id)throw Error('资料任务已改变，请重新打开字段表');
  let stopping=null,release;const stopped=new Promise(resolve=>release=resolve);onStopReady(stopped);
  const stop=()=>{stopping??=getSource().cancel(library_id,import_id).finally(release);};
  signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  const progress={import_id,scope,signal,onProgress};if(onProgress)sourceProgress=progress;
  try{
   if(signal?.aborted){await stopping;return {ok:false,cancelled:true};}
   if(recovery){if(fields!==undefined)throw Error('局部纠正保留原确认字段，不能同时改字段');await getSource().requestWorkspaceCorrection(library_id,import_id,{recovery,request_id:operationId()});}
   if(fields!==undefined)await getSource().confirmFields(library_id,import_id,{fields,expected_revision});
   if(scope!==chatScope(getCtx()))return {ok:false,stale:true};
   const row=await getSource().executeImport(library_id,import_id);
   if(signal?.aborted){await stopping;return {ok:false,cancelled:true};}
   if(scope!==chatScope(getCtx()))return {ok:false,stale:true};
   return {ok:row.items.every(item=>item.status==='succeeded'),awaitingFields:row.staged?.status==='awaiting-fields',import:row};
  }finally{signal?.removeEventListener('abort',stop);if(sourceProgress===progress)sourceProgress=null;if(!stopping)release();}
 }
 async function rebind(fn){
  if(working('commit')||working('adoption')||working('binding')||session.busy||getBusy())throw Error('正在提交世界改动，请稍候再试');
  const releaseBinding=holdWork('binding');reportState();try{return await fn();}finally{releaseBinding();reportState();}
 }
 async function adoptSource(options={}) {
  if(working('commit')||working('adoption')||working('binding'))throw Error('正在提交世界改动，请稍候再试');
  const releaseAdoption=holdWork('adoption');reportState();try{return await adoptSourceOnce(options)}finally{releaseAdoption();reportState()}
 }
 async function adopted(data,ctx,result){
  const scope=chatScope(ctx);if(scope!==chatScope(getCtx()))return {ok:false,stale:true};
  const pointer=result.pointer??session.readState()?.pointer??null;
  drafts.set(scope,{...copy(data),applied:true,adoptedPointer:copy(pointer)});draft=copy(drafts.get(scope));
  await persist(ctx);return scope===chatScope(getCtx())?result:{ok:false,stale:true};
 }
 async function adoptSourceOnce({playerId=null,entityLocations={},omitted_source_ids=[]}={}) {
  await ensureReady();idle();const ctx=getCtx(),scope=chatScope(ctx),data=await readDraft({includeOriginals:false});if(!data||scope!==chatScope(getCtx()))throw Error('聊天已改变或无待采用资料，请重新核对候选');
  if(data.applied)return {ok:true,alreadyAdopted:true,pointer:session.readState()?.pointer??null};
  const active=session.readState()?.pointer;
  if(data.mode==='world'&&active?.world_id===data.world_id)return adopted(data,ctx,{ok:true,alreadyAdopted:true,pointer:active});
  if(['setting','scales','map'].includes(data.mode)){
   const assertTarget=()=>{if(scope!==chatScope(getCtx())||JSON.stringify(session.readState()?.pointer)!==JSON.stringify(data.target))throw Error('世界版本已改变，请重新核对候选');};
   const current=session.readState();if(!current||JSON.stringify(current.pointer)!==JSON.stringify(data.target))throw Error('世界版本已改变，请重新核对候选');
   if(data.mode==='map'&&!data.records.some(r=>r.record_kind==='location'||r.record_kind==='setting'&&(r.data?.geography?.places?.length||r.data?.geography?.links?.length)))throw Error('地图候选没有明述地点或地点关系，原地图保留');
   const library=await getSource().getLibrary(data.library_id),receipt=await getSource().publish(data.library_id,data.import_id,{expected_version:data.import.receipt?.expected_version??library.version,omitted_source_ids});
   if(scope!==chatScope(getCtx()))return {ok:false,stale:true};
   const bundle=await getSource().getVersion(data.library_id,receipt.version),patch=sourceSettingPatch(bundle.records);
   assertTarget();
   if(hasSourceSettingConflict(session.readWorld(),Object.keys(patch)))throw Error('新抽象结果涉及已人工修改的设定，请先核对修改；原资料与抽象回执均保留');
   const world=session.readWorld(),before=world.context.setting??assembleSetting({canon:patch,tension:{},env:{},legacyTension:world.context.tension,fingerprint:'source:'+data.library_id+'@'+receipt.version,extractedAt:data.extractedAt}),canon={...before.frozen.canon};
   for(const [key,value]of Object.entries(patch))if(data.mode==='setting'||['刻度','powerScale','dims'].includes(key))canon[key]=value;
   if(data.mode==='scales'&&patch.刻度){const flat=scalesToFlat(patch.刻度);canon.powerScale=flat.powerScale;canon.dims=flat.dims}
   if(data.mode==='map')canon.geography=mapCandidate(bundle.records,canon.geography,patch.geography);
   if(!world.context.setting&&data.mode!=='setting')throw Error('旧世界尚无完整设定，请先核对并采用设定候选；本次资料原件已保留');
   const next=applySettingToSsot(world,{...before,frozen:{...before.frozen,canon,extractedAt:data.extractedAt}});
   if(data.mode==='map')next.context.positions=[...new Set([...(next.context.positions??[]),...canon.geography.places.map(p=>p.name)])];
   next.meta.sourcePublication??={records:[],sources:[]};next.meta.sourcePublication.updates??=[];next.meta.sourcePublication.updates.push(bundle);
   if(scope!==chatScope(getCtx()))return {ok:false,stale:true};
   const result=await commitWorld(next,{assertCurrent:assertTarget,checkScope:assertTarget},{kind:data.mode==='scales'?'scale-update':data.mode==='map'?'map-update':'setting-update',sourceAdoption:true});reportStatus(data.mode==='map'?'地图已采用，可回世界图谱查看':'设定已提交版本，人物、盘算与轮次保留');return adopted(data,ctx,result);
  }
  const positions=[...new Set([...data.records.filter(r=>r.record_kind==='location').map(r=>r.name),...data.records.filter(r=>r.record_kind==='entity').map(r=>r.fields?.location).filter(v=>typeof v==='string'&&v.trim()),...Object.values(entityLocations)])];
  const options={worldName:data.worldName,positions,tension:.5,extractedAt:data.extractedAt,playerId,entityLocations,playerName:String(ctx.name1??'').trim()};
  // Validate declared initialization facts before publishing the fixed source version.
  if(playerId!==null&&!data.records.some(r=>r.record_kind==='entity'&&r.id===playerId))throw Error('玩家 ID 不在候选中');
  const library=await getSource().getLibrary(data.library_id);
  const receipt=await getSource().publish(data.library_id,data.import_id,{expected_version:data.import.receipt?.expected_version??library.version,omitted_source_ids});
  await getSource().initializeVersion(data.library_id,receipt.version,{world_id:data.world_id,branch_id:data.branch_id,options});
  if(scope!==chatScope(getCtx()))return {ok:false,stale:true};
  const head=await database().db.heads.get([data.world_id,data.branch_id]);
  if(scope!==chatScope(getCtx()))return {ok:false,stale:true};
  const assertScope=()=>{if(scope!==chatScope(getCtx()))throw Error(STALE_TEXT)};
  const pointer={world_id:data.world_id,branch_id:data.branch_id,revision:head.revision};
  const result=await session.attach(pointer,{validate:assertScope});assertScope();reportStatus('已采用浏览器世界；原世界及原存档仍保留');return adopted(data,ctx,result);
 }
 return {get busy(){return working('commit')||working('adoption')||working('binding')||session.busy},sourceEditor,session,client:getClient,sourceClient:getSource,connectionId:connection,ready,reloadBinding:async()=>{readyScope=null;readyPromise=null;session.invalidate();const result=await ready();if(result?.ok&&session.active)await session.load();return result;},persist,refreshMemory,playerChoices:records=>playerMatches(records,String(getCtx()?.name1??'').trim()),commitWorld,refreshSnapshots,readSnapshotCache,beginNewWorld,resumeSource,readDraft,adoptSource,currentScope:()=>chatScope(getCtx()),humanStatusText,
  async readSourceRecovery(){
   if(!draft)throw Error('当前没有待继续的资料任务');const scope=chatScope(getCtx()),selected=copy(draft);
   const offer=await getSource().getWorkspaceRecovery(selected.library_id,selected.import_id);
   if(scope!==chatScope(getCtx())||draft?.library_id!==selected.library_id||draft?.import_id!==selected.import_id)throw Error('聊天或任务已改变，请重新打开');return offer;
  },
  async getSourceTaskDiagnostics(){
   if(creationDiagnostics)return creationDiagnostics();
   if(!draft||!journal?.db?.isOpen?.())return null;
   const scope=chatScope(getCtx()),selected={library_id:draft.library_id,import_id:draft.import_id},reader=journal;
   const row=await reader.db.imports.get([selected.library_id,selected.import_id]),data=row?sourceTaskDiagnostics(row):null;
   if(scope!==chatScope(getCtx())||reader!==journal||draft?.library_id!==selected.library_id||draft?.import_id!==selected.import_id)return {status:'stale',message:'聊天或任务已改变，未导出旧任务回执'};
   return data;
  },
  cancelSourceTask:({library_id,import_id})=>getSource().cancel(library_id,import_id),
  async reprocessSource(){const data=await readDraft();if(!data)throw Error('聊天已改变或无待核对资料，请重新核对候选');return getSource().reprocessImport(data.library_id,data.import_id)},
  async reprocessOperation(){
   await ensureReady();
   if(working('commit')||working('adoption')||working('binding')||getBusy()||getReprocessBusy())throw Error('正在提交世界改动，请稍候再试');
   return session.reprocess(async(pointer,id)=>{
    getClient();if(!coordinator)throw Error('世界协调器尚未建立');
    const row=await database().getOperation(pointer,id);
    const recover=row.status==='failed'&&(!row.call||row.call.outcome==='received');
    return coordinator.resume(pointer,id,{recover});
   });
  },
  async cancelDraft(){const data=await readDraft();if(!data)return {ok:true,idle:true};return getSource().cancel(data.library_id,data.import_id)},
  async retrySource(id){const data=await readDraft();if(!data)throw Error('聊天已改变或无待核对资料');await getSource().retry(data.library_id,data.import_id,id);return getSource().executeImport(data.library_id,data.import_id)},
  async exportDraft(){const data=await readDraft();if(!data)throw Error('无资料任务可导出');const scope=chatScope(getCtx()),original=await database().db.imports.get([data.library_id,data.import_id]);if(scope!==chatScope(getCtx()))throw Error(STALE_TEXT);return {format:'story-world-v2-source-task-backup',version:1,draft:copy(data),original:copy(original)}},
  async listBranches(){await ensureReady();const scope=chatScope(getCtx()),p=session.readState()?.pointer;if(!p)return [];const rows=await database().db.heads.where('world_id').equals(p.world_id).toArray();if(scope!==chatScope(getCtx()))throw Error(STALE_TEXT);return copy(rows)},
  async selectBranch(branch_id){return rebind(async()=>{
   await ensureReady();idle();if(working('commit')||working('adoption'))throw Error('正在提交世界改动，请稍候再试');
   const scope=chatScope(getCtx()),p=session.readState()?.pointer;if(!p)throw Error('尚无世界');
   if(typeof branch_id!=='string'||!branch_id)throw Error('请选择分支');
   const head=await database().db.heads.get([p.world_id,branch_id]);if(!head)throw Error('分支不存在');
   const rows=await database().db.operations.where('[world_id+branch_id]').equals([p.world_id,branch_id]).toArray();
   const pending=rows.filter(op=>['started','proposed','failed'].includes(op.status)&&!isConfirmedFailedOperation(op)&&op.expected_revision===head.revision&&typeof op.inputs?.dialogue==='string');
   if(pending.length>1)throw Error('此分支含多笔未决推进，请先核对原操作；本次未切换');
   if(scope!==chatScope(getCtx()))throw Error(STALE_TEXT);
   await session.attach({world_id:p.world_id,branch_id,revision:head.revision});
   if(pending.length){if(scope!==chatScope(getCtx()))throw Error(STALE_TEXT);const ctx=getCtx();ctx.chatMetadata[metaKey].pending={input:copy(pending[0].inputs),delivery:'sending'};await persist(ctx);session.invalidate();await session.load()}
   return {ok:true,pointer:session.readState().pointer};
  });},
  async exportWorld(){await ensureReady();const state=session.readState();if(!state)throw Error('尚无世界');return database().exportWorld(state.pointer,{compact:true})},
  async importWorld(bundle){return rebind(async()=>{
   await ensureReady();idle();if(working('commit')||working('adoption'))throw Error('正在提交世界改动，请稍候再试');const scope=chatScope(getCtx());
   const preview=await database().previewImport(bundle);
   const payload=readBrowserBackupPayload(bundle),pending=(payload.operations??[]).filter(op=>['started','proposed','failed'].includes(op.status)&&!isConfirmedFailedOperation(op)&&op.expected_revision===payload.pointer.revision&&typeof op.inputs?.dialogue==='string');
   if(pending.length>1)throw Error('备份含多笔未决推进，请先在原世界核对；本次未采用');
   if(scope!==chatScope(getCtx()))throw Error(STALE_TEXT);
   const identity=sha256Hex(JSON.stringify([scope,bundle.digest]));
   const row=await database().importWorld({operation_id:'backup-import:'+identity,world_id:'backup-'+identity.slice(0,24),branch_id:'main',bundle,snapshotsOnly:true});
   if(scope!==chatScope(getCtx()))throw Error('世界已导入原聊天，当前聊天未采用旧结果');
   const head=await database().db.heads.get([row.receipt.world_id,row.receipt.branch_id]);
   if(scope!==chatScope(getCtx()))throw Error('聊天已改变，存档未接入新聊天');
   if(!head)throw Error('导入存档的当前进度未读到，请重新核对');
   const adopted={...row.receipt,revision:head.revision};
   await session.attach(adopted);
   if(pending.length&&head.revision===row.receipt.revision){const original=pending[0],mapped=row.operation_map[original.operation_id];
    if(scope!==chatScope(getCtx()))throw Error(STALE_TEXT);
    const ctx=getCtx();ctx.chatMetadata[metaKey].pending={input:{...copy(original.inputs),operation_id:mapped.operation_id},delivery:'sending'};
    await persist(ctx);session.invalidate();await session.load();
   }
   return {ok:true,preview,pointer:session.readState().pointer};
  });},
  async restore(snapshot_id){return rebind(async()=>{
   await ensureReady();idle();if(working('commit')||working('adoption'))throw Error('正在提交世界改动，请稍候再试');const scope=chatScope(getCtx()),p=session.readState()?.pointer;if(!p)throw Error('尚无存档');
   const operations=await database().db.operations.where('[world_id+branch_id]').equals([p.world_id,p.branch_id]).toArray();
   if(operations.some(op=>['started','proposed','failed'].includes(op.status)&&!isConfirmedFailedOperation(op)&&op.expected_revision===p.revision&&typeof op.inputs?.dialogue==='string'))throw Error('仍有未决推进，请先核对或停止原操作再恢复快照');
   const source=await database().readSnapshot(p,snapshot_id);
   if(scope!==chatScope(getCtx()))throw Error(STALE_TEXT);
   const ctx=getCtx(),original=copy(ctx.chatMetadata[metaKey]),db=database().db;
   const pointer=await db.transaction('rw',...database().recordTables,db.operations,db.heads,db.snapshots,db.indexJobs,db.bindings,db.worldBodies,db.userParams,async()=>{
    if(scope!==chatScope(getCtx()))throw Error(STALE_TEXT);
    const current=await db.operations.where('[world_id+branch_id]').equals([p.world_id,p.branch_id]).toArray();
    if(current.some(op=>['started','proposed','failed'].includes(op.status)&&!isConfirmedFailedOperation(op)&&op.expected_revision===p.revision&&typeof op.inputs?.dialogue==='string'))throw Error('仍有未决推进，请先核对或停止原操作再恢复快照');
    const row=await getClient().mutate(p,{operation_id:operationId(),expected_revision:p.revision,kind:'snapshot-restore',world:copy(stripPlayerParams(source.world))});
    // 参数类改动不走这条路（`snapshot-restore` 不在参数类名单里），收据形状照旧。
    const receipt=row?.receipt&&Number.isSafeInteger(row.receipt.revision)?row.receipt:null;
    if(!receipt)throw Error('快照恢复没有拿到版本收据，请核对原操作');
    const next={world_id:p.world_id,branch_id:p.branch_id,revision:receipt.revision};
    const binding=await db.bindings.get(scope);
    if(scope!==chatScope(getCtx())||JSON.stringify(session.readState()?.pointer)!==JSON.stringify(p))throw Error(STALE_TEXT);
    await db.bindings.put({...binding,scope,state:{...original,pointer:next,pending:null},draft:copy(binding?.draft??drafts.get(scope)??null),user_detached:false});
    return next;
   });
   if(scope!==chatScope(getCtx()))throw Error('快照已恢复到原聊天，当前聊天未采用旧结果');
   ctx.chatMetadata[metaKey]={...original,pointer,pending:null};
   try{await ctx.saveMetadata?.()}catch{reportStatus('快照已保存在浏览器；聊天指针镜像暂未保存')}
   if(scope!==chatScope(getCtx()))throw Error('快照已恢复到原聊天，当前聊天未采用旧结果');
   session.invalidate();await session.load();return {ok:true,pointer};
  });},
  async previewImport(bundle){return database().previewImport(bundle)},
  /** 面板用的只读口：这个聊天眼下是"浏览器账本"还是"还没搬的旧账"，以及有没有"世界不在这台机器上"的痕迹。 */
  legacyState(){
   const ctx=getCtx(),hot=getCtx()?.chatMetadata?.story_world_v2??null;
    const legacyWorld=loadHotAccount(hot);
   const missing=ctx?.chatMetadata?.[LOCAL_MISSING_KEY]??null;
    return {active:session.active,legacy:!session.active&&!!legacyWorld,missing:missing?copy(missing):null,
     notice:session.active?null:legacyWorld?'这是旧存档，请先导出再导入；导入前仅供查看':missing?noticeFor(missing.reason):null,
     worldName:String(legacyWorld?.context?.world??'')||null};
  },
  get journal(){return database()},get memory(){return recall()},
  config(){return {mode:'browser',active:session.active,pointer:session.readState()?.pointer??null,operation:session.readout()}},
  routeQueue(legacy,{isBlocked=()=>false}={}){
   const queue=createWorldQueueRouter(legacy,session);
   // Protect both ledgers while migration/import is still establishing the browser binding.
   return {advance:(...args)=>!session.active&&((getCtx()?.chatMetadata?.story_world_v2?.world??getCtx()?.chatMetadata?.story_world_v2))
    ?Promise.resolve({ok:false,error:'这是旧存档，请先导出再导入；导入前仅供查看'})
    :(isBlocked()||working('commit')||working('adoption')||working('binding'))
    ?Promise.resolve({ok:false,error:'正在提交世界改动，请稍候再推进'}):queue.advance(...args),
    cancel:()=>queue.cancel(),invalidate:()=>queue.invalidate(),
    get busy(){return working('commit')||working('adoption')||working('binding')||queue.busy},
    get advancing(){return queue.advancing},get cancellable(){return queue.cancellable},get resumable(){return !isBlocked()&&!working('commit')&&!working('adoption')&&!working('binding')&&queue.resumable}};
  },
  guardLegacyAction(action){return (...args)=>{if(session.active){onStatus('此项操作需要浏览器账入口，原世界未修改');return {ok:false,error:'请使用浏览器账入口'}}if(getCtx()?.chatMetadata?.story_world_v2){const error='这是旧存档，请先导出再导入；导入前仅供查看';onStatus(error);return {ok:false,error}}return action(...args)}}
 };
}
