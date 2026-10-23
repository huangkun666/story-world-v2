// 旧档搬进浏览器账本的**那座桥**（用户2026-10-16口径：搬旧档＝旧版导出 → 新版导入，
// 由用户自己带社区用户做；恢复点能带多少带多少并如实报缺；桥与撤卡片同批交付）。
//
// 说人话：
//   ① 导出：没搬过的旧聊天里那份旧账（世界 ＋ 冷卷 ＋ 本机那份恢复点）打成**一个文件**；
//      恢复点逐个试重建，重建不了的**不假装带走**，在回执里如实报“有 N 个已无法恢复”。
//   ② 导入：认这份文件，也认更早的旧版“导出存档”文件（那份不含恢复点，如实说明）；
//      当前世界直接入库，附带恢复点存成快照，不建立运行路线。
//   ③ 不许猜：目标已存在同一份文件 ⇒ 幂等（按文件指纹，不新建第二个世界）；
//      写库是一个事务，半路失败不留半个世界；旧账原件一个字不动。
//
// 落库身份是**文件指纹 ＋ 聊天**算出来的（同一文件导进同一个聊天＝同一个世界；换聊天＝另起一份，
// 免得两份账悄悄共用一份进度）。原旧账整包（世界、冷卷、原快照、原元数据）在 main 分支的
// `provenance.original_bundle` 里**只存一份**；恢复点分支只记指纹与点名，不再各存一份。
import {collectLegacyTransfer} from './service-transfer.js';
import {createTransferBundle,verifyTransferBundle,TRANSFER_FORMAT} from './transfer-client.js';
import {verifyImportBundle} from '../src/storage.js';
import {mergeActiveHistory} from '../src/vector-history.js';
import {sha256Hex} from '../src/browser-capabilities.js';
import {chatScope} from './message-consumption.js';
import {validate} from '../src/schema.js';
import {ssotSchema} from '../src/schemas/ssot.schema.js';

export const RECOVERY_BRANCH='recovery:';
export const LEGACY_EXPORT_FORMAT='story-world-v2-export';
export const BROWSER_BACKUP_FORMAT='story-world-v2-browser-backup';
const clone=value=>structuredClone(value);
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const worldNameOf=world=>String(world?.context?.world??'（未命名世界）');
/** 大小一律印人话；按钮上、提示里、回执里同一口径。 */
export function humanSize(bytes){
 const value=Number(bytes);
 if(!Number.isFinite(value)||value<0)return '大小未知';
 if(value<1024)return value+' 字节';
 if(value<1024*1024)return (value/1024).toFixed(1)+' KB';
 return (value/1024/1024).toFixed(1)+' MB';
}
/** 先认文件是什么，再决定走哪条路：普通备份走既有导入，桥文件与旧版导出件走这座桥。 */
export function bundleKind(value){
 let parsed=value;
 if(typeof value==='string'){try{parsed=JSON.parse(value);}catch{return 'unknown';}}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return 'unknown';
 if(parsed.format===BROWSER_BACKUP_FORMAT)return 'browser-backup';
 if(parsed.format===TRANSFER_FORMAT)return 'bridge';
 if(parsed.format===LEGACY_EXPORT_FORMAT)return 'legacy-export';
 return 'unknown';
}
export function createLocalTransfer({host,getCtx,getWorld,getVolumeStore,getSnapshotStore,getLegacyBusy=()=>false,onStateChange=()=>{}}={}) {
 let current=null,running=false,epoch=0;
 const notify=()=>{try{onStateChange()}catch{/* UI must not affect migration. */}};
 const journalOf=()=>host.journal;
 function guard(c,{legacy=true}={}){
  if(c.epoch!==epoch)throw Error('搬迁输入已改变，请重新核对');
  if(c.scope!==chatScope(getCtx()))throw Error('聊天已改变，请重新核对搬迁');
  if(legacy&&JSON.stringify(getWorld(getCtx()))!==c.worldSignature)throw Error('旧世界已改变，请重新预览搬迁');
 }
 function idle(){if(getLegacyBusy()||host.session.busy)throw Error('仍有未决推进或保存，先核对原操作')}
 function capture(){const ctx=getCtx();if(!ctx?.chatMetadata)throw Error('没有聊天元数据');return {ctx,epoch,scope:chatScope(ctx),worldSignature:JSON.stringify(getWorld(ctx))}}
 function summary(c){
  const payload=c.payload??{};
  // 同一快照编号只计一次，摘要与实际保存数量保持一致。
  const points=new Set((payload.recovery_points??[]).map(point=>String(point?.id??'')).filter(Boolean));
  return {origin:c.origin,kind:c.kind,worldName:worldNameOf(payload.world),revision:0,bytes:c.bytes,digest:c.digest,
   updatedWorld:c.updatedWorld===true,
   counts:{snapshots:points.size,recovery_points:points.size,skipped:Number(payload.recovery_skipped??0)},
   warnings:[...(payload.boundary_warnings??[])],omissions:[...(c.omissions??[])],
   report:{errors:[...(c.report?.errors??[])],warnings:[...(c.report?.warnings??[])]},
   errors:[...(c.report?.errors??[])],existing:c.existing??null};
 }
 async function describe(c,bundle,payload,{origin,kind,omissions=[]}={}){
  const notes=[...omissions];
  const merge=world=>mergeActiveHistory(world,payload.volumes,reason=>{if(!notes.includes(reason))notes.push(reason)});
  const merged=(kind==='bridge'||kind==='legacy-export')?merge(payload.world):payload.world;
  const result=validate(merged,ssotSchema);
  // 预览就要把“这份文件能不能真的落地”说清：恢复点编号重复/缺失、世界不是纯对象，都不许等到采用那一刻才炸。
  const errors=[...result.errors],seen=new Set();
  for(const point of payload.recovery_points??[]){
   const id=String(point?.id??'');if(!id)errors.push('有一个恢复点没有编号，这份文件不完整');
   else if(seen.has(id))errors.push('恢复点编号重复：'+id+'（同一份文件里一个编号只能对应一份快照）');
   seen.add(id);
   if(!point?.world||typeof point.world!=='object'||Array.isArray(point.world))errors.push('恢复点 '+id+' 的世界内容不完整');
  }
  const next={...c,origin,kind,bundle,payload,world:merged,updatedWorld:merged!==payload.world,
   report:{errors,warnings:[...(payload.boundary_warnings??[])]},omissions:notes,
   bytes:String(bundle.payload??'').length+96,digest:bundle.digest,existing:host.session?.readState?.()?.pointer??null};
  current=next;
  // 交给界面的是**摘要**：大对象（世界、整包）只留在本对象里，避免同一份几十 MB 再复制一遍。
  return summary(next);
 }
 return {
  get busy(){return running},invalidate(){epoch++;current=null},readPreview(){return current?{...summary(current),bundle:clone(current.bundle)}:null},
  /** text=null ⇒ 从当前旧聊天收集（导出旧档）；给了 text ⇒ 认一份要导入的文件。**预览不写任何东西**。 */
  async preview(text=null){if(running)throw Error('搬迁或备份仍在进行');running=true;notify();
   try{
    const c=capture();
    if(text==null){
     if(host.session.active)throw Error('这个聊天已经搬进浏览器账本了，不需要再导出旧档');
     const bundle=await collectLegacyTransfer({ctx:c.ctx,getWorld,getVolumeStore,getSnapshotStore,assertCurrent:()=>guard(c),tolerateUnrestorable:true});
     const payload=await verifyTransferBundle(bundle);guard(c);
     return await describe(c,bundle,payload,{origin:'legacy-chat',kind:'bridge'});
    }
    const kind=bundleKind(text);
    if(kind==='browser-backup')throw Error('这是“完整备份（历史）”文件，请直接用导入恢复；本入口只在旧档搬迁时用');
    if(kind==='unknown')throw Error('不认识的备份文件：请选择本插件导出的备份或旧版“导出存档”文件');
    let bundle,payload,omissions=[];
    if(kind==='bridge'){
     bundle=typeof text==='string'?JSON.parse(text):clone(text);
     payload=await verifyTransferBundle(bundle);
     if(payload.kind!=='legacy')throw Error('这是给“服务世界”用的迁移文件，不适用浏览器账本');
    }else{
     // 旧版“导出存档”（story-world-v2-export）：只有世界与冷卷，**没有恢复点**。如实说明，不假装带走。
     const old=await verifyImportBundle(typeof text==='string'?text:JSON.stringify(text));
     if(!old.ok)throw Error(old.error);
     const source=typeof text==='string'?JSON.parse(text):clone(text);
     bundle=await createTransferBundle({kind:'legacy',world:old.world,volumes:old.volumes,recovery_points:[],original_export:source,
      scope:{chat_id:String(source.chatId??''),volume_ids:old.volumes.map(v=>v.id??''),snapshot_ids:[]}});
     payload=await verifyTransferBundle(bundle);
     omissions=['这份旧版“导出存档”不含恢复点：只能带当前进度'];
    }
    guard(c,{legacy:false});
    return await describe(c,bundle,payload,{origin:'file',kind,omissions});
   }finally{running=false;notify()}},
  async adopt(){if(running)throw Error('搬迁或备份仍在进行');const p=current;if(!p)throw Error('请先完整预览搬迁');
   guard(p,{legacy:p.origin==='legacy-chat'});if(p.report.errors.length)throw Error('旧档未通过契约，请先核对搬迁报告');idle();running=true;notify();
   try{
    const c=p,payload=c.payload,journal=journalOf();
    const scope=String(c.scope??''),branch_id='main';
    // 同一份文件导进同一个聊天 ⇒ 同一个世界编号（幂等）；换聊天 ⇒ 另起一份，不悄悄共用进度。
    const world_id=c.world_id??('legacy-'+sha256Hex(canonical([c.digest,scope])).slice(0,16));
    const pointer={world_id,branch_id,revision:0};
    const assertCurrent=()=>guard(c,{legacy:c.origin==='legacy-chat'});
    const previous=await journal.db.heads.get([world_id,branch_id]);assertCurrent();
    if(previous){const row=await journal.db.snapshots.get([world_id,branch_id,0]);assertCurrent();
     if(row?.provenance?.bridge_digest===c.digest){
      // 已经搬过这份文件：不再建第二个世界。但**世界写好而当时没接上**（保存失败、有未决那一轮挡住）时，
      // 再点一次要真的把人接上，不能只回一句"已经导过"就完了。
      c.receipt={world_id,branch_id,revision:previous.revision};
      if(!host.session.active||JSON.stringify(host.session.readState?.()?.pointer)!==JSON.stringify(c.receipt)){
       const back=await journal.getWorld({world_id,branch_id,revision:previous.revision},{revision:previous.revision});assertCurrent();
       await host.session.attach({world_id,branch_id,revision:previous.revision},{expectedWorld:back.world,validate:assertCurrent});
       assertCurrent();
      }
      return {ok:true,pointer:clone(c.receipt),alreadyImported:true};
     }
     throw Error('这个编号上已经有别的世界，请换一份文件或清掉后再导');}
    const points=(payload.recovery_points??[]).map(point=>({snapshot_id:'legacy:'+String(point.id),world:mergeActiveHistory(point.world,payload.volumes),metadata:clone(point.original_snapshot??{id:String(point.id)}),provenance:{bridge_digest:c.digest,recovery_point:String(point.id)}}));
    // main 上只记**这份旧档的指纹与结构**；整包正文不再抄一份（用户令 2026-10-17：
    //   "导入只需要记住导过哪份文件，不需要把那份文件再抄一遍"）。恢复点分支只记点名与指纹。
    //   ★恢复点的名字／时间已经在上面 `points[].metadata` 里逐条落进"附带状态"，不依赖整包。
    const mainProvenance={bridge_digest:c.digest,bridge_origin:c.origin,scope,
     original_bundle:{format:c.bundle?.format??null,version:c.bundle?.version??null,encoding:c.bundle?.encoding??null,digest:c.digest,payload_bytes:typeof c.bundle?.payload==='string'?c.bundle.payload.length:0},
     recovery_snapshots:points.map(point=>point.snapshot_id),recovery_skipped:Number(payload.recovery_skipped??0)};
    for(const key of Object.keys(mainProvenance))if(mainProvenance[key]===undefined)delete mainProvenance[key];
    guard(c,{legacy:c.origin==='legacy-chat'});
    const written=await journal.db.transaction('rw',...journal.recordTables,journal.db.heads,journal.db.snapshots,journal.db.indexJobs,journal.db.savedSnapshots,journal.db.worldBodies,journal.db.userParams,async()=>{
     guard(c,{legacy:c.origin==='legacy-chat'});
     await journal.initialize(pointer,c.world,{provenance:mainProvenance});
     await journal.saveSnapshots(world_id,points);
     return points.length;
    });
    guard(c,{legacy:c.origin==='legacy-chat'});
    await host.session.attach(pointer,{expectedWorld:c.world,validate:assertCurrent});
    assertCurrent();
    c.receipt={...pointer};
    return {ok:true,pointer:clone(c.receipt),snapshots:written,recovery_points:written,skipped:Number(payload.recovery_skipped??0)};
   }finally{running=false;notify()}}
 };
}
