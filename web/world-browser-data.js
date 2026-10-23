// 浏览历史只读；既有快照恢复纯函数仅返回副本，绝不执行恢复写入。
import {restoreFrom} from '../src/snapshot.js';
import {buildWorldViews} from '../src/world-views.js';
const copy=v=>structuredClone(v);
export function createWorldBrowserSource({getWorld,getCtx,serviceSession,getVolumeStore,getSnapshotStore}){
 const clients=new WeakMap();let serial=0;
 const clientId=c=>{if(!c)return null;if(!clients.has(c))clients.set(c,++serial);return clients.get(c);};
 function capture(){
  const ctx=getCtx(),service=serviceSession?.active?serviceSession.readState():null;
  if(serviceSession?.active&&!service)throw Error('请先载入并核对服务世界');
  return {ctx,service,world:copy(getWorld()),volumes:service?null:getVolumeStore(ctx),snapshots:service?null:getSnapshotStore(ctx)};
 }
 function scope(){
  const ctx=getCtx(),active=!!serviceSession?.active,s=active?serviceSession.readState():null;
  // Formal revisions identify immutable worlds. Legacy accounts can still edit in place.
  return JSON.stringify([ctx?.chatId,ctx?.characterId,ctx?.groupId,active,s?.scope,s?.pointer,clientId(s?.client),active?null:getWorld()]);
 }
 async function volumes(c){
  const list=await c.volumes.list(),full=await Promise.all(list.map(v=>c.volumes.get(v.id)));
  if(full.some(v=>!v))throw Error('旧卷未完整读回，请重试');return full;
 }
 return {getScope:scope,
  getIdentity(){const ctx=getCtx(),s=serviceSession?.active?serviceSession.readState():null;return JSON.stringify([ctx?.chatId,ctx?.characterId,ctx?.groupId,s?.scope,s?.pointer?.world_id,s?.pointer?.branch_id,clientId(s?.client)]);},
  async loadCurrent(){const c=capture();if(!c.world)throw Error('当前世界尚未载入');
   if(c.service){const p=c.service.pointer,result=await c.service.client.getWorld(p,{revision:p.revision});
    if(result.world_id!==p.world_id||result.branch_id!==p.branch_id||result.revision!==p.revision||!result.world)throw Error('当前世界返回身份或版本不匹配');
    return {world:result.world,oldVolumes:[],version:'current'};
   }
   return {world:c.world,oldVolumes:await volumes(c),version:'current'};
  },
  async getHistory(){const c=capture();return c.service?{service:true,maxRevision:c.service.pointer.revision}: {service:false,list:(await c.snapshots.list()).map(s=>({id:s.id,label:'第 '+(s.tick??'?')+' 轮 · '+s.id}))};},
  async readVersion(id){
   const c=capture();
   if(c.service){const revision=Number(id);if(!Number.isSafeInteger(revision)||revision<0||revision>c.service.pointer.revision)throw Error('历史版本不在当前分支范围内');
    const result=await c.service.client.getWorld(c.service.pointer,{revision});
    if(result.world_id!==c.service.pointer.world_id||result.branch_id!==c.service.pointer.branch_id||result.revision!==revision||!result.world)throw Error('历史返回身份或版本不匹配');
    return {world:result.world,oldVolumes:[],version:String(revision)};
   }
   const snapshots=await c.snapshots.listAll(),result=restoreFrom({snapshots,targetId:id});if(!result.ok)throw Error(result.error||'历史快照不可读');
   return {world:result.world,oldVolumes:await volumes(c),version:id};
  }
 };
}
export function createWorldBrowserSession({getScope,loadCurrent,getHistory,readVersion,onChange=()=>{}}){
 let generation=0,scope=null,opened=false;
 let state={data:null,history:null,version:'current',loading:false,error:''};
 const emit=()=>onChange({...state});
 const invalidate=()=>{generation++;opened=false;scope=null;state={data:null,history:null,version:'current',loading:false,error:''};emit();};
 async function read(version='current'){
  const token=++generation;scope=getScope();opened=true;
  state={...state,data:null,version,loading:true,error:''};emit();
  try{
   const [loaded,history]=await Promise.all([version==='current'?loadCurrent():readVersion(version),state.history?Promise.resolve(state.history):getHistory()]);
   if(!opened||token!==generation||scope!==getScope())return {stale:true};
   state={data:buildWorldViews(loaded.world,{oldVolumes:loaded.oldVolumes||[]}),history,version,loading:false,error:''};emit();return {ok:true};
  }catch(error){
   if(!opened||token!==generation||scope!==getScope())return {stale:true};
   state={...state,data:null,loading:false,error:String(error?.message||error)};emit();return {ok:false,error:state.error};
  }
 }
 return {open:(version='current')=>{state.history=null;return read(version);},read,close:invalidate,invalidate,
  get state(){if(opened&&scope!==getScope())invalidate();return {...state};},
  checkScope(){if(opened&&scope!==getScope()){invalidate();return false;}return opened;}
 };
}
