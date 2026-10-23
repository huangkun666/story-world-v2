import {diagnostics} from '../src/diagnostics.js';
import {readWorldFieldSchema,discoverWorldFieldCandidates} from '../src/source-field-table.js';
import {openSourceFieldReview} from './source-field-panel.js';
import {validateConfirmedFieldTable} from '../src/source-field-table.js';
import {resetDynamicLayer} from '../src/abstract.js';
import {createSourceProgressDisplay,sourceImportFailureMessage} from './source-progress.js';
import {SOURCE_WORKSPACE_PROTOCOL} from '../src/source-workspace.js';
const hasWorkspaceTask=data=>!data?.applied&&data?.import?.status!=='cancelled'&&data?.import?.staged?.protocol===SOURCE_WORKSPACE_PROTOCOL;
const hasFieldReviewTask=data=>!data?.applied&&data?.import?.status!=='cancelled'&&data?.import?.staged?.field_review&&['awaiting-fields','pending'].includes(data.import.staged.status);
const hasUnconfirmedRequests=row=>row?.execution?.attempts?.some(a=>a.outcome==='unknown'||a.unconfirmed||a.outcome==='requested'&&a.model_invoked_at!=null)||row?.items?.some(i=>i.status==='unknown');
export function bindLocalWorldActions({bus,host,getSource,onStatus=()=>{},getScope=()=>'',panel=null,paramApi=null,taskHub=null,creation=null,refresh=()=>{},onFieldsSaved=()=>{},confirmSourceRecovery=message=>globalThis.window?.confirm?.(message)??false,reviewFields=(review,options)=>openSourceFieldReview(globalThis.document,review,options)} ) {
 if(bus._sw2LocalBound)return bus._sw2LocalActions;bus._sw2LocalBound=true;
 const originals={...bus};
 const run=(fn,label='操作失败')=>async(...args)=>{const scope=getScope();try{return await fn(...args)}catch(error){if(error?.sw2Cancelled)throw error;const message=label+'：'+String(error.message);if(scope===getScope())onStatus(message);else diagnostics.forScope(scope).record('本地操作','error',message);return {ok:false,error:message, ...(scope!==getScope()?{stale:true}:{})}}};
 let beginning=false;
 const begin=run(async(options={})=>{
  if(beginning)throw Error('资料抽象正在进行，请等待完成');beginning=true;
  let progress=null,completed=false,paused=false,cancelledReview=false,progressError=null;
  try{
   const scope=getScope(),mode=options?.mode??'world',task=options?.task,wait=p=>task?task.wait(p):p;
   await wait(host.ready());if(scope!==getScope())return {stale:true};
   if(mode!=='world'&&host.legacyState?.()?.legacy)throw Error('这是旧存档，请先导出再导入；导入前仅供查看');
   const prior=await wait(host.readDraft?.({includeOriginals:false})),review=prior?.import?.staged?.field_review;
   const workspaceDraft=mode==='world'&&hasWorkspaceTask(prior);
    const resumable=workspaceDraft||mode==='world'&&hasFieldReviewTask(prior);
   if(options.resume&&!resumable)throw Error('没有可继续确认的字段任务，请重新核对当前抽象进度');
   let recovery=null;
    if(mode==='world'&&prior?.import?.status==='cancelled'&&hasUnconfirmedRequests(prior.import)){
     const approved=await wait(confirmSourceRecovery('原任务已停止，仍有请求的结果未确认。是否明确新建抽象任务？旧任务、原文和已收回执保留，不补发旧请求；新任务按当前设置重新读取资料并产生新的模型调用。'));
     if(scope!==getScope())return {stale:true};if(task?.signal.aborted)return {ok:false,cancelled:true};
     if(!approved){onStatus('已停止的原任务和回执保留，未新建任务或发送请求');return {ok:true,pending:true};}
    }
   if(workspaceDraft){
    const offer=await wait(host.readSourceRecovery());if(scope!==getScope())return {stale:true};
    if(offer.kind==='blocked')throw Error(offer.message);
    if(['correct','migrate'].includes(offer.kind)){
     const approved=await wait(confirmSourceRecovery(offer.message));if(scope!==getScope())return {stale:true};if(task?.signal.aborted)return {ok:false,cancelled:true};
     if(!approved){onStatus('原任务、确认字段和已收结果已保留，未发送请求');return {ok:true,pending:true};}recovery=offer;
    }
   }
   progress=createSourceProgressDisplay({setText:(text,opts)=>task?task.setStatus(text,opts):onStatus(text,opts),getScope});if(task)task.progress=progress;
   progress.update({phase:'prepare',total:0,done:0});
   const controls={onProgress:value=>progress.update(value),...(task?{signal:task.signal,onStopReady:p=>task.stopReady=p}:{})};
   let result;
   if(resumable){
    result=review&&!review.confirmed?{awaitingFields:true,import:prior.import}:await wait(host.resumeSource({library_id:prior.library_id,import_id:prior.import_id,recovery,...controls}));
   }else{
    onStatus('正在读取世界资料…',{diagnostic:false});
    const source=await wait(getSource({completeSelectedSources:true}));if(scope!==getScope())return {stale:true};if(!source?.ok)throw Error(source?.reason??'资料不可用');
    const blocks=source.allowedBlocks??[],entries=blocks.length?blocks.map((b,i)=>{
     const original=source.sourceItems?.find(item=>item.id===b.sourceId)??null;
     return {source_id:b.sourceId??'source-'+i,content:b.text,metadata:{title:b.title??'',kind:b.kind??'world-entry',original:JSON.parse(JSON.stringify(original)),selection:JSON.parse(JSON.stringify(source.selection??null))}};
    }):[{source_id:'composed-source',content:source.text,metadata:{label:source.label??''}}];
    result=await wait(host.beginNewWorld(entries,{worldName:source.worldName??'新世界',mode,replacePending:true,...controls}));
   }
   if(scope!==getScope()||result?.stale)return {stale:true};
   if(result.awaitingFields){
    progress.setPhase('review');
    const row=result.import,identity={library_id:row.library_id,import_id:row.import_id};
    const cancel=()=>{const stopped=host.cancelSourceTask(identity);if(task)task.stopReady=stopped;return stopped;};
    task?.signal.addEventListener('abort',cancel,{once:true});
    let choice;try{choice=await wait(reviewFields(row.staged.field_review,{signal:task?.signal}));}finally{task?.signal.removeEventListener('abort',cancel);}
    if(scope!==getScope())return {stale:true};
    if(!choice){paused=true;onStatus('抽象进度已保留，可点击“继续抽象”确认字段');refresh();return {ok:true,pending:true};}
    if(choice.cancel){await host.cancelSourceTask(identity);if(scope!==getScope())return {stale:true};cancelledReview=true;onStatus('本次抽象已停止，原文与已收到的结果保留');return {ok:false,cancelled:true};}
    result=await wait(host.resumeSource({...identity,...choice,...controls}));
   }
   if(scope!==getScope()||result?.stale)return {stale:true};
   if(!result?.ok)throw Error(sourceImportFailureMessage(result?.import));
   task?.beginCommit();progress.setPhase('save');const applied=await host.adoptSource({});
   if(scope!==getScope()||applied?.stale)return {stale:true};
   if(!applied?.ok)throw Error(applied?.error??'抽象结果未能保存');if(task)task.committed=true;completed=true;
   await panel?.refresh();if(scope!==getScope())return {stale:true};refresh();onStatus(mode==='world'?'新世界已建立':({setting:'世界设定已更新',scales:'世界刻度已更新',map:'世界地图已更新'})[mode]);return applied;
  }catch(error){progressError=String(error?.message??error);throw error;}finally{progress?.finish({ok:completed,paused,cancelled:cancelledReview||options?.task?.signal.aborted===true,error:progressError});beginning=false;}
 },'抽象失败');
 const start=(options={})=>creation&&(options.mode??'world')==='world'&&!options.resume?creation.click(options):!taskHub?begin(options):taskHub.busy()?taskHub.cancel():taskHub.run('init-world','抽象',async task=>{task.result=await begin({...options,task})},{browser:true});
 bus['init-world']=start;bus['new-world']=start;
 bus['continue-creation']=run(async(payload={})=>{
  const clickScope=getScope();
  if(creation){const current=await creation.readCurrent();if(clickScope!==getScope())return {ok:false,stale:true};if(!current||current.status==='completed')return {ok:false,pending:false};return creation.reviewCurrent({...payload,run_id:current.run_id});}
  return start({resume:true});
 },'继续抽象失败');
 const fieldReviews=new Map();
 let editorToken=null;
 bus['review-source-fields']=run(async(payload={})=>{
   const clickScope=getScope();
   if(creation){await creation.readCurrent();if(clickScope!==getScope())return {ok:false,stale:true};}
  if(fieldReviews.has(clickScope))return {ok:false,busy:true};
  const owner={scope:clickScope,overlay:null};fieldReviews.set(clickScope,owner);
  const releaseReview=()=>{if(fieldReviews.get(clickScope)===owner)fieldReviews.delete(clickScope)};
  const reviewCurrent=(review,options={})=>reviewFields(review,{...options,isCurrent:()=>clickScope===getScope(),onView:view=>{owner.overlay=view.overlay;owner.overlay.hidden=clickScope!==getScope();owner.overlay.inert=clickScope!==getScope();if(owner.overlay.style)owner.overlay.style.display=owner.overlay.hidden?'none':'';}});
  try{const scope=getScope();try{await host.ready()}catch(error){
    if(scope!==getScope())return {stale:true};
    const choice=await reviewCurrent({schema:{status:'invalid',error:String(error.message)},candidates:[]},{worldEdit:true,readOnly:true,message:'字段读取失败：'+String(error.message)+'。未修改世界或字段定义。'});if(scope!==getScope())return {stale:true};if(choice?.reload){releaseReview();return await bus['review-source-fields']({reload:true})}return {ok:false,error:String(error.message)};
   }if(scope!==getScope())return {stale:true};
   const identity=()=>JSON.stringify([getScope(),host.session.readState?.()?.pointer??null]),pinned=identity();
   let data=null,notice='';try{data=await host.readDraft({includeOriginals:false})}catch(error){notice='字段任务读取失败：'+String(error.message)+'。';}
   if(pinned!==identity())return {stale:true};

   if(payload.reload&&!taskHub?.busy()&&!host.busy&&!host.session.busy&&host.client?.()?.getWorld){
    const state=host.session.readState(),base={...state?.pointer};delete base.revision;
    const latest=await host.client().getWorld(base);
    if(scope!==getScope())return {stale:true};
    if(latest.revision!==state.pointer.revision)await host.session.attach({world_id:base.world_id,branch_id:base.branch_id,revision:latest.revision});
   }
   const world=host.session.readWorld();if(!world){await reviewCurrent({schema:{status:'invalid',error:'请先载入正式世界；未迁入的旧聊天存档可先导出再导入。'}},{worldEdit:true,readOnly:true});return {ok:false}}
   const now=identity();let review;
   try{review=host.client?.()?.readFields?await host.client().readFields(host.session.readState().pointer):{schema:readWorldFieldSchema(world),candidates:discoverWorldFieldCandidates(world),worldName:world.context?.world??'',revision:host.session.readState()?.pointer?.revision,diagnostics:[]};}
    catch(error){if(now!==identity())return {stale:true};const choice=await reviewCurrent({schema:{status:'invalid',error:String(error.message)}},{worldEdit:true,readOnly:true});if(scope!==getScope())return {stale:true};if(choice?.reload){releaseReview();return await bus['review-source-fields']({reload:true})}return {ok:false,error:String(error.message)}}
   if(now!==identity())return {stale:true};
   const readOnly=!!(taskHub?.busy()||host.busy||host.session.busy||!host.sourceEditor||review.schema.status==='invalid');
   let draft=null,choice;
   try{
    if(!readOnly){draft=await host.sourceEditor.open({kind:'fields'});editorToken=draft.token;}
    const assertOwner=()=>{if(scope!==getScope())throw Error('聊天已改变，请回到原聊天继续编辑');if(now!==identity())throw Error('世界版本已改变，输入仍保留，请重新核对');};
    const ensureEditor=async()=>{assertOwner();if(!draft)throw Error('当前字段只读');if(editorToken!==draft.token||owner.needsReopen){const fresh=await host.sourceEditor.open({kind:'fields'});assertOwner();draft=fresh;editorToken=fresh.token;owner.needsReopen=false;}return draft;};
    if(now!==identity())return {stale:true};
    choice=await reviewCurrent({...review,...(draft?{token:draft.token}:{}),confirmed:review.schema.status==='confirmed'?review.schema:null},
     {worldEdit:true,readOnly,message:notice||(readOnly&&review.schema.status!=='invalid'?'当前任务进行中或编辑服务不可用，仅供查看；不会停止已有任务。':''),
      onPreview:async fields=>{await ensureEditor();return host.sourceEditor.preview(draft.token,{value:fields})},
      onSave:async fields=>{await ensureEditor();let result=await host.sourceEditor.save(draft.token,{value:fields});if(result.needsReload&&!result.savedToOriginal&&scope===getScope())result=await host.sourceEditor.save(draft.token,{value:fields});return result}});
   }finally{if(draft)host.sourceEditor.cancel(draft.token)}
   if(choice?.saved){if(scope===getScope()){onFieldsSaved();refresh();onStatus(choice.changed===false?'字段内容未改变':'世界字段已保存，原值和历史保留');}return {ok:true,...choice}}
    if(scope!==getScope())return {stale:true};
    if(choice?.reload){releaseReview();return await bus['review-source-fields']({reload:true})}
   return {ok:true,cancelled:true};
  }finally{releaseReview();}
 });
 const local=(name,fn)=>bus[name]=run(async(...args)=>{const scope=getScope();await host.ready();if(scope!==getScope())return {ok:false,stale:true};if(!host.session.active){if(host.legacyState?.()?.legacy)throw Error('这是旧存档，请先导出再导入；导入前仅供查看');return originals[name]?.(...args);}if(host.busy||host.session.busy)throw Error('请先核对或停止当前推进');return fn(...args)});
 // 导出分两路：浏览器账 ⇒ 完整备份；**没搬过的旧聊天 ⇒ 先给“要导出什么、多大、恢复点丢没丢”的提示，
 // 用户点确认才下载**（用户2026-10-16口径：恢复点能带多少带多少并如实报缺；导出前把体积量级说出来）。
 // 注意：旧账这一路必须在 `local()` 那个“未激活就交回旧处理器”的分叉**之前**接住。
 bus['export-world']=run(async(...args)=>{
  await host.ready();
  if(!host.session.active){
   if(typeof host.legacyState==='function'&&host.legacyState()?.legacy&&typeof panel?.offerLegacyExport==='function')return panel.offerLegacyExport();
   return originals['export-world']?.(...args);
  }
  if(host.busy||host.session.busy)throw Error('请先核对或停止当前推进');
  const bundle=await host.exportWorld();panel?.download(bundle);onStatus('完整世界备份已导出');return bundle;
 });
 // All selected backups first reach a read-only preview. Adoption is a separate button.
 bus['import-world']=run(()=>panel?.pickBackup());
 // Snapshot restore only accepts an explicit formal branch revision; an old tick is not a revision.
 const formalRevision=payload=>{
  const raw=payload?.revision??payload?.formalRevision??payload?.formal_revision;
  const revision=Number(raw);
  if(raw==null||raw===''||!Number.isSafeInteger(revision)||revision<0)throw Error('请填写版本号：旧轮次号不能当作版本');
  return revision;
 };
 local('snapshot-restore',async payload=>host.restore(payload?.['snapshot-id']??payload?.snapshot_id??formalRevision(payload)));
 local('restore-snapshot',async payload=>host.restore(payload?.['snapshot-id']??payload?.snapshot_id??formalRevision(payload)));
 local('snapshot-clear',async()=>{onStatus('快照全部保留；可导出存档或恢复快照');return {ok:true}});
 local('set-param',async payload=>{
  const world=host.session.readWorld(),key=String(payload?.param??payload?.key??''),value=String(payload?.value??payload?.el?.value??'');
  const change=value===''&&String(payload?.el?.tagName).toUpperCase()==='SELECT'?paramApi.clear(world,key):paramApi.set(world,key,value);
  if(change.changed&&change.mirror?.world){await host.commitWorld(change.mirror.world,null,{kind:'parameter'});paramApi.setLastWorld(change.mirror.world)}
  paramApi.sw2SyncParamCells();paramApi.sw2SetParamControl(key);onStatus(change.humanLine??'参数已核对',{diagnostic:change.ok===false||change.mirror?.ok===false&&!change.mirror?.pending});return change;
 });
 // Undo must prepare through the current local formal world. The legacy sw2UndoParam path reads
 // the old hot account first and writes the old meta, so it is no longer the browser entry point.
 local('param-undo',async()=>{
  const world=host.session.readWorld();if(!world)throw Error('请先载入世界');
  if(typeof paramApi?.prepareParamUndo!=='function')throw Error('参数撤销准备口不可用');
  const change=paramApi.prepareParamUndo(world);
  if(!change?.ok){onStatus(change?.reason??'没有可撤销的改动');refresh();return change}
  const committed=await host.commitWorld(change.world,null,{kind:'parameter-undo'});
  paramApi.setLastWorld?.(change.world);paramApi.sw2SyncParamCells?.();refresh();
  onStatus(`已撤销：${change.label??''}，参数已回到那一步之前`,{diagnostic:false});
  return {...change,...committed};
 });
 const clear=async()=>{const w=host.session.readWorld(),carried=paramApi.playerInputs(w);w.context.setting=resetDynamicLayer(w.context.setting);w.context.setting.dynamic.env={...carried};await host.commitWorld(w,null,{kind:'reset-dynamic'});onStatus('演化层已清，参数与全部历史保留');return {ok:true}};
 local('reset-dynamic',clear);local('clear-evolution',clear);
 local('adopt-scale-draft',async()=>host.adoptSource({}));
 local('reextract-setting',async()=>start({mode:'setting'}));
 local('extract-scales',async()=>start({mode:'scales'}));
 local('extract-map',async()=>start({mode:'map'}));
 local('lookup-entity',async payload=>{
  // The source archive is keyed by the formal entity ID only; a display name is never an identity.
  const id=payload?.entityId??payload?.entity??payload?.id;
  if(typeof id!=='string'||!id.trim())throw Error('查资料源必须提供实体 ID');
  const world=host.session.readWorld(),publication=world?.meta?.sourcePublication;
  const pools=[publication?.records,...(publication?.updates??[]).map(update=>update?.records)];
  let record=null,conflict=false;
  for(const pool of pools)for(const row of pool??[])if(row?.record_kind==='entity'&&row.id===id){if(record&&JSON.stringify(record)!==JSON.stringify(row))conflict=true;record??=row}
  if(!record)throw Error('此 ID 没有固定资料原件，请核对来源');
  if(conflict)throw Error('此 ID 在固定资料里出现冲突，请核对来源');
  onStatus('已读取固定资料原件：'+record.name+' · '+JSON.stringify(record.fields??{}));return {ok:true,record};
 });
 const api={scopeChanged(){for(const owner of fieldReviews.values()){if(owner.overlay){owner.overlay.hidden=owner.scope!==getScope();owner.overlay.inert=owner.scope!==getScope();if(owner.overlay.style)owner.overlay.style.display=owner.overlay.hidden?'none':'';if(owner.overlay.hidden)owner.needsReopen=true;}}}};
 bus._sw2LocalActions=api;return api;
}
