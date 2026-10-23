import {chatWorldObservation} from './chat-world-observation.js';
import {handleWorldRequest} from '../src/world-engine.js';
import {validate} from '../src/schema.js';
import {ssotSchema} from '../src/schemas/ssot.schema.js';
import {RULES_FINGERPRINT} from './service-contract.js';
import {observableStateContext} from '../src/world-visibility.js';
import {playerParamsOf, stripPlayerParams} from '../src/param-ownership.js';
import {bodyDigestOf} from './world-body-store.js';
import {applyWorldFieldEdit,readWorldFieldSchema} from '../src/source-field-table.js';
import {discoverWorldFieldCandidates} from '../src/source-field-table.js';
import {chatEntityAttributes} from '../src/chat-entity-attributes.js';
import {initialSourcePublication} from './chat-world-observation.js';
// ★2026-10-16（用户令）：改参数、撤销参数、回快照都**不再新增世界版本**——只要世界正文没变，
//   就只把玩家参数存好，版本号原地不动。口径写在 `mutate` 里（唯一的世界提交入口），
//   免得"参数算不算世界变化"在好几个调用点各判一遍。
const PARAM_ONLY_KINDS=new Set(['parameter','parameter-undo','reset-dynamic']);
export function createLocalWorldClient({journal,memory,coordinator,rulesFingerprint=RULES_FINGERPRINT}={}) {
 const requireWorld=world=>{const result=validate(world,ssotSchema);if(!result.ok)throw Error('世界契约拒绝：'+result.errors.join('; '))};
 const api={
  supportsSceneState:true,
  supportsFullCurrentState:true,
  readChatCursor:(scope,p)=>journal.readChatCursor?.(scope,p)??null,
  saveChatCursor:(scope,p,input)=>journal.saveChatCursor(scope,p,input),
  async connect({rulesFingerprint:expected=null}={}){if(expected!==null&&expected!==rulesFingerprint)throw Error('插件规则契约不兼容');return {contract_version:1,rules_contract_version:1,data_version:1,rules_fingerprint:rulesFingerprint}},
  getWorld:(p,options={})=>journal.getWorld(p,options),
  getWorkingWorld:(p,options={})=>(journal.getWorkingWorld??journal.getWorld).call(journal,p,options),
  async getObservation(p,input,{signal}={}){
   if(input&&Object.hasOwn(input,"include_current_state"))return chatWorldObservation({journal,memory,pointer:p,input,signal});
   const stateMax=input?.state_max_chars??0;
   const options=input?.search_options;
   if(!Number.isSafeInteger(input?.revision)||input.revision<0||typeof input.query!=='string'
    ||(!input.query.trim()&&stateMax===0)||!Number.isSafeInteger(input.max_chars)||input.max_chars<0
    ||!Number.isSafeInteger(stateMax)||stateMax<0)throw Error('聊天观察参数无效');
   if(options&&(!Number.isSafeInteger(options.maxRecords)||options.maxRecords<1
    ||!Number.isFinite(options.similarity)||options.similarity<0||options.similarity>1))throw Error('聊天检索参数无效');
   const fixed={...p,revision:input.revision};
   const {world}=await journal.getWorld(fixed,{revision:fixed.revision});
   let stateEvidence=[],stateEvidenceLimited=false;
   if(stateMax>0&&typeof journal.getRecords==='function'){
    const present=new Set([...(world.events??[]),...(world.milestones??[]).flatMap(m=>m.rows??[])].map(e=>e.id));
    const ids=[...new Set((world.conditions??[]).filter(c=>c.observation===undefined)
     .flatMap(c=>[c.eventRef,c.endCause,...(c.changes??[]).map(change=>change.eventRef)]).filter(id=>id&&!present.has(id)))];
    if(ids.length)try{stateEvidence=await journal.getRecords(fixed,ids)}catch{stateEvidenceLimited=true}
   }
   let recall={records:[],limited:false,mode:'not-requested'};
   if(input.query.trim()&&input.max_chars>0)try{
    recall=await memory.search(fixed,{query:input.query,purpose:'world',...(options?{maxRecords:options.maxRecords,similarity:options.similarity}:{})});
   }catch{recall={records:[],limited:true,mode:'references',reason:'history-unavailable'}}
   const scene=observableStateContext(world,[...stateEvidence,...(recall.records??[])],stateMax,{query:input.query});
   const sceneIds=new Set(scene.records.filter(r=>['condition','event','relation'].includes(r.record_kind)).map(r=>r.id));
   const observed=handleWorldRequest({action:'observe',world,records:(recall.records??[]).filter(r=>!sceneIds.has(r.id)),maxChars:input.max_chars});
   return {world_id:p.world_id,branch_id:p.branch_id,revision:fixed.revision,...observed,
    limited:!!recall.limited,memory:{mode:recall.mode,reason:recall.reason??null},
    state_text:scene.text,state_records:scene.records,state_omitted:scene.omitted,
    state_limited:scene.limited||stateEvidenceLimited,state_reason:scene.reason??(stateEvidenceLimited?'state-evidence-unavailable':null)};
  },
  startTurn:(...args)=>coordinator.startTurn(...args),getOperation:(...args)=>coordinator.getOperation(...args),
  cancel:(...args)=>coordinator.cancel(...args),continueLimited:(...args)=>coordinator.continueLimited(...args),
  restore:(p,input)=>journal.restoreBranch(p,input),
  async readFields(p){
   const current=await journal.getWorld(p,{revision:p.revision}),world=current.world;
   const baselinePublication=await initialSourcePublication(journal,world);
   const state=chatEntityAttributes(world,(world.entities??[]).map(e=>e.id),{baselinePublication});
   const names=Object.fromEntries((world.entities??[]).map(e=>[e.id,e.name]));
   for(const relation of world.relations??[])names[relation.id]=(names[relation.from]??'关系一方')+' → '+(names[relation.to]??'关系另一方');
   return {...p,worldName:world.context?.world??'',schema:readWorldFieldSchema(world),candidates:discoverWorldFieldCandidates(world),diagnostics:state.diagnostics,names};
  },
  async editFields(p,input){
   if(!Number.isSafeInteger(input?.expected_revision)||input.expected_revision!==p.revision)throw Error('世界版本已改变，请重新打开字段表');
   const current=await journal.getWorld(p,{revision:p.revision});
   const next=applyWorldFieldEdit(current.world,{...input,edit_id:input.operation_id});
   return api.mutate(p,{operation_id:input.operation_id,expected_revision:p.revision,kind:'field-schema',world:next});
  },
  async mutate(p,input){
   requireWorld(input?.world);
   if(input.kind==='field-schema'&&readWorldFieldSchema(input.world).status==='invalid')throw Error('字段表无法核验，未保存世界');
   // 参数类改动：正文没变 ⇒ 只存参数，**不新增世界版本、不多存一份世界正文**。
   // 世界真变了（推进／编辑／采用设定／刻度／地图／恢复）才照旧走候选 + 提交。
   if(PARAM_ONLY_KINDS.has(input?.kind)){
    const head=await (input.partial&&journal.getWorkingWorld?journal.getWorkingWorld(p,{revision:p.revision}):journal.getWorld(p,{revision:p.revision}));
    const incoming=stripPlayerParams(input.world);
    if(JSON.stringify(input.partial??null)===JSON.stringify(head.record_view??null)&&bodyDigestOf(incoming)===bodyDigestOf(stripPlayerParams(head.world))){
     const params=playerParamsOf(input.world);
     const previous=await journal.paramsOf(p.world_id);
     const changed=JSON.stringify(previous)!==JSON.stringify(params);
     if(changed)await journal.saveParams(p.world_id,params);
     return {receipt:{operation_id:input.operation_id,world_id:p.world_id,branch_id:p.branch_id,revision:p.revision,params_only:true,params_changed:changed}};
    }
   }
   const row=await journal.startOperation(p,input);if(['committed','cancelled'].includes(row.status))return row;
   await journal.saveProposal(p,input.operation_id,input.world,{partial:input.partial??null});return journal.commitOperation(p,input.operation_id);
  },
  async initialize(p,world,options){requireWorld(world);return journal.initialize(p,world,options)},
  exportWorld:p=>journal.exportWorld(p),previewImport:bundle=>journal.previewImport(bundle),importWorld:input=>journal.importWorld(input)
 };
 return api;
}
