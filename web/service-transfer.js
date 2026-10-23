import { chatScope } from './message-consumption.js';
import { restoreFrom } from '../src/snapshot.js';
import { activeHistoryRows, historyStamp, mergeActiveHistory } from '../src/vector-history.js';
import { verifyImportBundle } from '../src/storage.js';
import { createTransferBundle,verifyTransferBundle,verifyImportReceipt,rawPayloadDigest } from './transfer-client.js';
import { persistServiceMetadata } from './hot-ledger.js';
export const TRANSFER_META_KEY='story_world_v2_transfer';
const clone=v=>structuredClone(v);
const serviceState=c=>c?.chatMetadata?.story_world_v2_service??null;
const stable=value=>JSON.stringify(Array.isArray(value)?value.map(v=>JSON.parse(stable(v))):value && typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(stable(value[k]))])):value);
const same=(a,b)=>stable(a)===stable(b);
function ids(rows,label){if(!Array.isArray(rows)||rows.some(r=>!r || typeof r.id!=='string'||!r.id)||new Set(rows.map(r=>r.id)).size!==rows.length)throw Error(label+'清单不完整或重复');return rows.map(r=>r.id)}
export async function collectLegacyTransfer({ctx,getWorld,getVolumeStore,getSnapshotStore,assertCurrent=()=>{},tolerateUnrestorable=false}){
 const original=clone(ctx?.chatMetadata?.story_world_v2??null),world=clone(getWorld(ctx));if(!world||typeof world!=='object')throw Error('没有可迁移的旧世界');
 const volumeStore=getVolumeStore(ctx),snapshotStore=getSnapshotStore(ctx);if(!volumeStore||!snapshotStore)throw Error('旧卷库或快照库不可读取，停止迁移');
 const listed=await volumeStore.list();assertCurrent();const volumeIds=ids(listed,'卷');const volumes=[];
 for(const id of volumeIds){const row=await volumeStore.get(id);assertCurrent();if(!row||row.id!==id||!Array.isArray(row.rows))throw Error('旧卷 '+id+' 内容缺失');volumes.push(clone(row))}
 const snapshotMeta=await snapshotStore.list();assertCurrent();const snapshotIds=ids(snapshotMeta,'快照');const all=await snapshotStore.listAll();assertCurrent();if(!same([...ids(all,'快照')].sort(),[...snapshotIds].sort()))throw Error('快照清单与完整内容不一致');
 const snapshots=[];for(const id of snapshotIds){const row=await snapshotStore.get(id);assertCurrent();if(!row||row.id!==id||!same(row,all.find(r=>r.id===id)))throw Error('快照 '+id+' 内容缺失或已改变');if(row.kind==='full'&&!row.world || row.kind==='delta'&&!row.delta)throw Error('快照 '+id+' 内容缺失');snapshots.push(clone(row))}
 // 恢复点是 15 份滚动窗口：锚点被淘汰的那一份**整份重建不出来**，绝不给半成品。
 // 用户2026-10-16口径：能带多少带多少，带不走的**如实报缺**，不许整包失败、也不许假装全带走了。
 const recovery_points=[],unrestorable=[];
 for(const row of snapshots){const restored=restoreFrom({snapshots,targetId:row.id});
  if(!restored.ok||!restored.world){if(!tolerateUnrestorable)throw Error(restored.error??'快照无法完整恢复');unrestorable.push({id:String(row.id),reason:String(restored.error??'快照无法完整恢复')});continue;}
  recovery_points.push({id:row.id,revision:0,world:mergeActiveHistory(clone(restored.world),volumes),original_snapshot:clone(row)});}
 const active=new Map(activeHistoryRows(world,volumes).map(row=>[String(row.id),historyStamp(row)])),hotIds=new Set((world.chronicle??[]).map(row=>String(row.id)));
 const scopedVolumes=volumes.map(v=>({...v,rows:v.rows.filter(row=>active.get(String(row.id))===historyStamp(row)&&!hotIds.has(String(row.id)))}));
 const boundary_warnings=world.meta?.memoryHistory?[]:['旧账没有历史来源清单：冷卷按各恢复点的轮数核对；原卷全文保留在传输原件中'];
 if(unrestorable.length)boundary_warnings.push('有 '+unrestorable.length+' 个旧恢复点已无法完整恢复（快照滚动窗口已淘汰其锚点），本次只带走能重建的 '+recovery_points.length+' 个');
 assertCurrent();return createTransferBundle({kind:'legacy',world,volumes:scopedVolumes,original_volumes:volumes,boundary_warnings,recovery_points,
  ...(tolerateUnrestorable?{recovery_skipped:unrestorable.length,recovery_unrestorable:unrestorable}:{}),
  original_metadata:original,original_snapshots:snapshots,scope:{chat_id:String(ctx.chatId??''),volume_ids:volumeIds,snapshot_ids:snapshotIds}});
}
export function createServiceTransfer({getCtx,getWorld,getVolumeStore,getSnapshotStore,getLegacyBusy=()=>false,host,persist=null,onStatus=()=>{},onLegacy=()=>{},makeOperationId=()=>globalThis.crypto.randomUUID()}){
 let previewState=null,running=false,epoch=0;
 const save=persist??(ctx=>persistServiceMetadata(ctx,TRANSFER_META_KEY,getCtx));
 const metadata=()=>getCtx()?.chatMetadata?.[TRANSFER_META_KEY]??null;
 function capture(){const ctx=getCtx();if(!ctx?.chatMetadata)throw Error('没有聊天元数据');return {ctx,scope:chatScope(ctx),connection:host.connectionId(),client:host.transferClient(),worldClient:host.client(),epoch,hot:JSON.stringify(ctx.chatMetadata.story_world_v2??null),state:JSON.stringify(metadata()),pointer:JSON.stringify(ctx.chatMetadata.story_world_v2_service??null)}}
 function check(c,{hot=true,pointer=true}={}){if(c.epoch!==epoch||chatScope(getCtx())!==c.scope||JSON.stringify(getCtx()?.chatMetadata?.[TRANSFER_META_KEY]??null)!==c.state||(hot&&JSON.stringify(getCtx()?.chatMetadata?.story_world_v2??null)!==c.hot)||(pointer&&JSON.stringify(serviceState(getCtx()))!==c.pointer)||host.connectionId()!==c.connection||host.transferClient()!==c.client||host.client()!==c.worldClient||JSON.stringify(c.ctx.chatMetadata[TRANSFER_META_KEY]??null)!==c.state||(hot&&JSON.stringify(c.ctx.chatMetadata.story_world_v2??null)!==c.hot)||(pointer&&JSON.stringify(c.ctx.chatMetadata.story_world_v2_service??null)!==c.pointer))throw Error('聊天、连接或原迁移输入已改变；旧结果未采用')}
 function idle(){if(getLegacyBusy()||host.session.busy)throw Error('仍有未决推进或保存，先核对原操作')}
 async function write(c,next){check(c);const before=c.ctx.chatMetadata[TRANSFER_META_KEY];const candidate=clone(next);c.ctx.chatMetadata[TRANSFER_META_KEY]=candidate;try{await save(c.ctx)}catch(e){if(same(c.ctx.chatMetadata[TRANSFER_META_KEY],candidate)){if(before===undefined)delete c.ctx.chatMetadata[TRANSFER_META_KEY];else c.ctx.chatMetadata[TRANSFER_META_KEY]=before}throw e}c.state=JSON.stringify(candidate);check(c)}
 async function run(fn){if(running)throw Error('迁移或备份仍在进行');running=true;try{return await fn()}catch(e){onStatus(e.message);throw e}finally{running=false}}
 async function accept(c,result,pending){check(c);verifyImportReceipt(result,pending.input,pending.preview.revision);await write(c,{...metadata(),receipt:clone(result),pending:{...pending,committed:true}});
 idle();const pointer={world_id:result.world_id,branch_id:result.branch_id,revision:result.revision};const response=await c.worldClient.getWorld(pointer,{revision:pointer.revision});check(c);if(response.world_id!==pointer.world_id||response.branch_id!==pointer.branch_id||response.revision!==pointer.revision||!same(response.world,pending.preview.world))throw Error('服务固定版本回读与迁移预览逐记录不一致；保留提交回执');idle();
 await host.session.attach(pointer,{expectedWorld:pending.preview.world,validate:({committed=false}={})=>{check(c,{pointer:!committed});if(getLegacyBusy())throw Error('旧账仍有未决推进或保存')}});c.pointer=JSON.stringify(c.ctx.chatMetadata.story_world_v2_service??null);check(c);
 await write(c,{...metadata(),pending:null,pointer,original_hot_hash:pending.original_hot_hash,origin:pending.origin,adopted:true});previewState=null;return {ok:true,pointer,report:clone(result.report??pending.preview.report)};
 }
 const hub={get scope(){return JSON.stringify([chatScope(getCtx()),host.config?.().url??''])},get busy(){return running||!!metadata()?.pending},readout(){return clone(metadata())},invalidate(){epoch++;previewState=null},
 preview(text=null){return run(async()=>{idle();if(metadata()?.pending)throw Error('请先核对原迁移编号');const c=capture();let bundle,origin='current',omissions=[];
 if(text!=null){const parsed=JSON.parse(text);if(parsed.format==='story-world-v2-transfer'){bundle=clone(parsed);await verifyTransferBundle(bundle)}else{const old=await verifyImportBundle(text);if(!old.ok)throw Error(old.error);const source=JSON.parse(text);bundle=await createTransferBundle({kind:'legacy',world:old.world,volumes:old.volumes,recovery_points:[],original_export:source,scope:{chat_id:source.chatId??'',volume_ids:old.volumes.map(v=>v.id),snapshot_ids:[]}});omissions=['旧导出文件不含快照库：未迁移本地恢复点']}origin='upload'}
 else bundle=await collectLegacyTransfer({ctx:c.ctx,getWorld,getVolumeStore,getSnapshotStore,assertCurrent:()=>check(c)});
 const payload=await verifyTransferBundle(bundle);omissions.push(...(payload.boundary_warnings??[]));check(c);const result=await c.client.preview(bundle);check(c);if(result.bundle_digest!==bundle.digest)throw Error('预览摘要不匹配');previewState={c,bundle:clone(bundle),preview:clone(result),origin,omissions};return {ok:result.report.errors.length===0,...clone(result),omissions};})},
 import(target){return run(async()=>{idle();if(metadata()?.pending)return hubReconcile();const p=previewState;if(!p)throw Error('请先预览原始输入');check(p.c);if(p.preview.report.errors.length)throw Error('预览存在错误，不能写入服务');if(!target||['world_id','branch_id'].some(k=>typeof target[k]!=='string'||!target[k].trim()))throw Error('请填写新世界与新分支编号');const c=p.c,input={operation_id:makeOperationId(),world_id:target.world_id,branch_id:target.branch_id,bundle:clone(p.bundle)};const pending={input,preview:clone(p.preview),origin:p.origin,original_hot_hash:await rawPayloadDigest(c.hot)};check(c);
 await write(c,{...metadata(),connection_id:c.connection,pending});const response=await c.client.import(input,{revision:p.preview.revision});return accept(c,response,pending);})},
 reconcile(){return run(hubReconcile)},
 export(){return run(async()=>{idle();if(metadata()?.pending)throw Error('迁移尚未确认');const c=capture(),pointer=host.session.readState()?.pointer;if(!pointer)throw Error('没有已载入的服务指针');const bundle=await c.client.export(pointer);check(c);const payload=await verifyTransferBundle(bundle);if(payload.kind!=='service'||['world_id','branch_id','revision'].some(k=>payload[k]!==pointer[k]))throw Error('备份身份或固定版本不符');await write(c,{...metadata(),backup:{pointer:clone(pointer),bundle:clone(bundle),digest:bundle.digest}});return bundle})},
 returnLegacy({savedBackup=false,backupDigest=null}={}){return run(async()=>{idle();if(metadata()?.pending)throw Error('迁移尚未确认，不能返回');const c=capture(),state=metadata(),pointer=host.session.readState()?.pointer;if(!state?.adopted||state.origin!=='current')throw Error('此聊天没有迁移前旧账可返回');if(!savedBackup||!state.backup||backupDigest!==state.backup.digest||!same(state.backup.pointer,pointer))throw Error('先下载当前固定版本服务备份，并确认文件已保存');await verifyTransferBundle(state.backup.bundle);check(c);if(await rawPayloadDigest(c.hot)!==state.original_hot_hash)throw Error('迁移前旧账已改变，不能自动返回');check(c);idle();const result=await host.session.detach({validate:({committed=false}={})=>{check(c,{pointer:!committed});if(getLegacyBusy())throw Error('旧账仍有未决推进或保存')}});c.pointer=JSON.stringify(c.ctx.chatMetadata.story_world_v2_service??null);check(c);await write(c,{...metadata(),adopted:false,returned_pointer:clone(pointer)});await onLegacy(c.ctx);return result})},
 };
 async function hubReconcile(){idle();const c=capture(),pending=metadata()?.pending;if(!pending)return {ok:true,idle:true};if(metadata().connection_id!==c.connection)throw Error('迁移原连接已改变，请恢复原连接');return accept(c,await c.client.getImport(pending.input,{revision:pending.preview.revision}),pending)}
 return hub;
}
