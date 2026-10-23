import {isConfirmedFailedOperation} from './operation-status.js';
import {bundleKind} from './local-transfer.js';
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const REVISION_TEXT='请填写版本号：旧轮次号不能当作版本';
const LEGACY_EXPORT_NAME='story-world-v2-legacy-bridge.json';
function humanSize(bytes){
 const value=Number(bytes);
 if(!Number.isFinite(value)||value<0)return '大小未知';
 if(value<1024)return value+' 字节';
 if(value<1024*1024)return (value/1024).toFixed(1)+' KB';
 return (value/1024/1024).toFixed(1)+' MB';
}
/** 备份回执里“带了几条分支（其中几个恢复点）”——用户要看得见历史跟没跟过来。 */
export function branchSummary(){return '快照将一并导入'}
export function countSummary(counts={}){return '含 '+Number(counts.snapshots??counts.recovery_points??0)+' 份快照'}
/**
 * 只认明确输入的整数版本：空串、纯空白、小数、负号、科学计数、十六进制、布尔/null 一律拒绝。
 * 合法的 revision 0 仍是合法版本（"0" 明确输入即可）。
 */
export function parseFormalRevision(raw){
 if(typeof raw==='number'){if(!Number.isSafeInteger(raw)||raw<0)throw Error(REVISION_TEXT);return raw}
 if(typeof raw==='string'){
  const text=raw.trim();
  if(!/^\d+$/.test(text))throw Error(REVISION_TEXT);
  const value=Number(text);
  if(!Number.isSafeInteger(value)||value<0)throw Error(REVISION_TEXT);
  return value;
 }
 throw Error(REVISION_TEXT);
}
// ★用户2026-10-16命令："把存档管理的卡片也删了" ⇒ 这张卡**不再自成一张卡**：
//   它那几样仍然要用的控件（卡住时的按钮、旧档提示、分支、导入预览／导出确认、状态行）
//   并进「存档与备份」卡里（由 `src/render.js` 画的那张），页面上存储页只剩一张卡。
export function renderLocalMemoryPanel(){return '<div data-local-memory><p class="sw2-hint">存档、历史和快照保存在此浏览器。换设备或酒馆地址前，请先导出存档，再在新地址导入恢复。</p><div class="sw2-row" data-memory-operation hidden><button class="sw2-btn" data-memory-reprocess>重新核对已确认响应</button></div><p data-memory-legacy hidden></p><div data-memory-backup></div><p data-memory-status>正在核对浏览器世界</p></div>'}

export function createLocalMemoryPanel({host,getWin=()=>globalThis.document?.getElementById('story_world2_window'),onStatus=()=>{},bridge=null,migration=null}={}) {
 let preview=null,offer=null,alertScope;const statusLines=new Map();
 // `migration` 是撤卡片之前那个名字；同一个引擎，旧 fixture 传旧名也能用。
 if(!bridge&&migration)bridge=migration;
 const find=()=>getWin()?.querySelector('[data-local-memory]');
 // Scope of the chat the panel is currently bound to. Async results from another chat must never render.
 const scopeOf=()=>typeof host?.currentScope==='function'?host.currentScope():null;
 function status(text,scope=scopeOf()){statusLines.set(scope,String(text));onStatus(text,{scope});if(scope!==null&&scope!==scopeOf())return;const el=find()?.querySelector('[data-memory-status]');if(el)el.textContent=text}
 function download(bundle,name='story-world-v2-complete.json'){const blob=new Blob([JSON.stringify(bundle)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),0)}
 function backupArea(){return find()?.querySelector('[data-memory-backup]')}
 /** 普通备份（story-world-v2-browser-backup）与旧档桥文件走两条路，界面同一块地方如实报“带了几条”。 */
 async function showPreview(bundle,{scope=scopeOf()}={}){
  if(scope!==null&&scope!==scopeOf())throw Error('聊天已改变，旧备份预览未采用，请重新预览');
  const kind=bundleKind(bundle);
  // 只有**桥文件与旧版导出件**走搬迁这一路；其余（含普通备份）照旧走浏览器世界的导入，
  // 于是“陌生文件”仍由原判据给出它自己的拒绝理由，不在这里抢先改口径。
  if(kind==='bridge'||kind==='legacy-export'){
   if(!bridge)throw Error('搬迁入口不可用，无法读这份旧档文件');
   const result=await bridge.preview(bundle);
   if(scope!==null&&scope!==scopeOf())throw Error('聊天已改变，旧档预览未采用，请重新核对');
   preview={kind:'bridge',bundle,result,scope,source:bridge};
   getWin()?.querySelector('[data-subtab="storage"]')?.click();
   const counts=result.counts??{},lines=['<p>待搬进浏览器的世界：「'+esc(result.worldName)+'」· '+esc(countSummary(counts))+' · 约 '+esc(humanSize(result.bytes))+'</p>'];
   if(counts.skipped)lines.push('<p>有 '+esc(counts.skipped)+' 个旧恢复点已无法完整恢复（快照窗口已淘汰），只能带走能重建的。</p>');
   for(const omission of result.omissions??[])lines.push('<p>'+esc(omission)+'</p>');
   if(result.existing)lines.push('<p>导入后接上这份存档，原存档与全部快照保留。</p>');
   lines.push('<button class="sw2-btn" data-memory-adopt-backup>采用并搬进浏览器</button>');
   const node=backupArea();if(node)node.innerHTML=lines.join('');
   return result;
  }
  const result=await host.previewImport(bundle);
  if(scope!==null&&scope!==scopeOf())throw Error('聊天已改变，旧备份预览未采用，请重新预览');
  preview={kind:'browser-backup',bundle,result,scope};
  getWin()?.querySelector('[data-subtab="storage"]')?.click();
  const node=backupArea();
  if(node)node.innerHTML='<p>待恢复世界：'+esc(result.world.context?.world)+' · 含 '+esc(result.snapshot_count??0)+' 份快照'+'。采用后原世界仍保留。</p><button class="sw2-btn" data-memory-adopt-backup>采用此备份为新世界</button>';
  return result;
 }
 function pickBackup(){const scope=scopeOf(),input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.addEventListener('change',async()=>{try{const file=input.files?.[0];if(file){const text=await file.text();if(scope!==null&&scope!==scopeOf())throw Error('聊天已改变，所选文件未预览，请重新选择');await showPreview(JSON.parse(text),{scope})}}catch(error){status('操作失败：'+error.message,scope)}});input.click()}
 /** 旧账导出第一步：只收集、只报“要导出什么、多大”，**用户点确认才下载**（用户2026-10-16口径）。 */
 async function offerLegacyExport(){
  if(!bridge)throw Error('搬迁桥不可用，无法导出旧档');
  const scope=scopeOf(),result=await bridge.preview();
  if(scope!==null&&scope!==scopeOf())throw Error('聊天已改变，旧档导出已作废，请重新核对');
  offer={scope,result};
  getWin()?.querySelector('[data-subtab="storage"]')?.click();
  const counts=result.counts??{},lines=['<p>要导出的是这个聊天的旧存档：世界「'+esc(result.worldName)+'」· '+esc(countSummary(counts))+' · 约 '+esc(humanSize(result.bytes))+'</p>'];
  if(counts.skipped)lines.push('<p>有 '+esc(counts.skipped)+' 个旧恢复点已无法完整恢复（快照窗口已淘汰），只能带走能重建的——不会假装全带走了。</p>');
  lines.push('<p>恢复点只存在这台浏览器里：换电脑或清浏览器数据就没了。导出后请用「导入恢复」把它搬进浏览器；旧存档原件照旧留着。</p>');
  lines.push('<button class="sw2-btn" data-memory-export-confirm>确认导出并下载</button>');
  const node=backupArea();if(node)node.innerHTML=lines.join('');
  status('导出前先核对：'+result.worldName+' · '+countSummary(counts)+' · 约 '+humanSize(result.bytes)+'；确认后再点「确认导出并下载」');
  return {ok:true,offered:true,...result};
 }
 /** 撤掉迁移卡片后界面不再有入口，但这个具名口按既有判据保留：**先完整导出原件、原件没导出就不搬**。
  *  顺序与文件名逐字不动（`story-world-v2-original-migration.json`），失败时绝不往下 adopt。 */
 async function adoptMigration(target=bridge,downloadFn=download){
  if(!target)throw Error('没有可读取的旧档');
  const original=typeof target.readPreview==='function'?target.readPreview()?.bundle:null;
  if(!original)throw Error('没有可导出的搬迁原件，已停止采用');
  downloadFn(original,'story-world-v2-original-migration.json');
  return target.adopt();
 }
 /** 分支列表是可见的选择；宿主没有 listBranches()（旧单元 fixture）时安静留空，绝不报错。 */
 /** 明确切换按钮落在 host.selectBranch(branch_id)：切到该分支 HEAD 并恢复其待确认请求。 */
 async function switchBranch(branchId){
  if(typeof host?.selectBranch!=='function')throw Error('当前宿主不支持分支切换');
  const target=String(branchId??'').trim();
  if(!target)throw Error('请选择要切换的分支');
  const scope=scopeOf(),result=await host.selectBranch(target);
  if(scope!==null&&scope!==scopeOf())throw Error('聊天已改变，旧分支切换未采用，请重新核对');
  return result;
 }
 /** 尚未采用草稿的完整资料任务原件下载；这是资料任务，不是世界备份。 */
 async function exportDraft(downloadFn=download,name='story-world-v2-source-task.json'){
  if(typeof host?.exportDraft!=='function')throw Error('当前宿主不提供资料任务原件导出；已采用的世界请用「导出完整备份（历史）」');
  const scope=scopeOf(),bundle=await host.exportDraft();
  if(scope!==null&&scope!==scopeOf())throw Error('聊天已改变，旧资料任务原件未导出，请重新核对');
  downloadFn(bundle,name);
  status('资料任务原件已下载：含原文、候选与调用记录；这不是世界备份');
  return bundle;
 }
 /** “卡住了怎么办”只在**真要人动手**时露出来：检索受限、结果未明、确认失败、失败，
  *  或者**有未决那一轮而此刻没在跑**（刷新后挂着）。正常推进期间整排收起——用户2026-10-16：“这几颗收起来，平时不可见”。 */
 function needsAttention(cfg,operation){
  if(!cfg?.active)return false;
  if(operation)return operation.phase==='retrieval-limited'||operation.phase==='model-unknown'
   ||operation.status==='failed'||isConfirmedFailedOperation(operation);
  return host.session?.busy===true&&host.session?.running!==true;
 }
 function syncStorageNotice(win){
  const alert=win?.querySelector('[data-storage-notice]');if(!alert)return;
  const state=host.legacyState?.();
  alert.hidden=!!state?.active||!!state?.legacy||!['missing-world','connection-mismatch'].includes(state?.missing?.reason);
  const action=win.querySelector('[data-storage-open]');
  if(action&&!action._sw2StorageBound){action._sw2StorageBound=true;action.addEventListener('click',()=>{
   win.querySelector('.sw2-tab[data-view="settings"]')?.click();win.querySelector('[data-subtab="storage"]')?.click();
  });}
 }
 async function refresh(win=getWin()){
  if(!win)return;
  const card=win?.querySelector('[data-local-memory]');
  const scope=scopeOf();
  if(alertScope!==scope){const alert=win?.querySelector('[data-storage-notice]');if(alert)alert.hidden=true;alertScope=scope;}
  await host.ready();const cfg=host.config();
  // The chat can change while IndexedDB/source reads are in flight; never paint the old chat's state.
  if(scope!==null&&scope!==scopeOf())return;
  syncStorageNotice(win);if(!card)return;
  const state=host.legacyState?.();
  const label=card.querySelector('[data-memory-status]');if(label)label.textContent=statusLines.has(scope)?statusLines.get(scope):cfg.active?'存档已载入':state?.legacy?'旧存档仅供查看，请先导出再导入':state?.missing?'当前存档尚未载入':'尚未建立世界';
  const operation=cfg.operation,operationBox=card.querySelector('[data-memory-operation]');
  const visibility={'data-memory-reprocess':isConfirmedFailedOperation(operation)&&operation?.call?.outcome==='received'};
  for(const [attr,show]of Object.entries(visibility)){const button=card.querySelector('['+attr+']');if(button)button.hidden=!show;}
  if(operationBox)operationBox.hidden=!needsAttention(cfg,operation)||!Object.values(visibility).some(Boolean);
  // “这个世界不在这台机器上／你返回过旧账／连接不对”这几句由宿主如实交回（notice 在顶层；
  // 兼容早先把说明塞在 missing 里的形状）。没有它就不占地方。
  const legacyLine=card.querySelector('[data-memory-legacy]');
  if(legacyLine){const state=typeof host.legacyState==='function'?host.legacyState():null,
   notice=state?.active?'':String(state?.notice??state?.missing?.notice??'');
   legacyLine.textContent=notice;legacyLine.hidden=!notice;}
  if(scope!==null&&scope!==scopeOf())return;
 }
 function bind(win){
  const pane=win?.querySelector('#sw2_view_settings [data-subpanel="storage"] .sw2-settings');if(!pane)return;
  let card=pane.querySelector('[data-local-memory]');
  if(!card){const host=pane.querySelector('.sw2-settings-storage')??pane;host.insertAdjacentHTML('beforeend',renderLocalMemoryPanel());card=host.querySelector('[data-local-memory]')??pane.querySelector('[data-local-memory]')}
  if(!card)return;
  if(!card._bound){card._bound=true;const handleClick=async event=>{
   const scope=scopeOf(),statusOwned=text=>status(text,scope);
   const button=event.target?.closest('button');if(!button||!card.contains(button))return;button.disabled=true;
   try{
    let result;
    if(button.hasAttribute('data-memory-cancel'))result=await host.session.cancel();
    else if(button.hasAttribute('data-memory-limited'))result=await host.session.continueLimited();
    else if(button.hasAttribute('data-memory-reprocess'))result=await host.reprocessOperation();
    else if(button.hasAttribute('data-memory-export')){download(await host.exportWorld());statusOwned('完整备份已导出');return}
    else if(button.hasAttribute('data-memory-import')){pickBackup();return}
    else if(button.hasAttribute('data-memory-export-confirm')){
     const held=offer;if(!held)throw Error('请先核对要导出的旧档');
     if(held.scope!==null&&held.scope!==scopeOf())throw Error('聊天已改变，旧档导出已作废，请重新核对');
     const full=bridge?.readPreview?.();if(!full?.bundle)throw Error('导出内容已失效，请重新核对');
     download(full.bundle,LEGACY_EXPORT_NAME);offer=null;const area=backupArea();if(area)area.innerHTML='';
     statusOwned('旧档已下载：'+held.result.worldName+' · '+countSummary(held.result.counts)+'；请用「导入恢复」写入数据库');
     return;
    }
    else if(button.hasAttribute('data-memory-adopt-backup')){
     if(!preview)throw Error('请先预览备份');
     if(preview.scope!==null&&preview.scope!==scopeOf())throw Error('聊天已改变，旧备份预览已作废，请重新预览');
     const held=preview,kind=held.kind;
     result=kind==='bridge'?await held.source.adopt():await host.importWorld(held.bundle);
     if(preview===held){preview=null;if(scope===null||scope===scopeOf()){const area=backupArea();if(area)area.innerHTML='';}}
     if(scope!==null&&scope!==scopeOf())return result;
     if(kind==='bridge'&&result?.ok){
      await refresh(win);
      statusOwned(result.alreadyImported?'这份文件之前已经搬过了，没有重复搬第二份'
       :'存档已导入数据库：含 '+result.recovery_points+' 份快照；旧存档原件保留');
      return;
     }
    }
    else if(button.hasAttribute('data-memory-branch-switch')){const select=card.querySelector('[data-memory-branch]');result=await switchBranch(select?.value??'')}
    else if(button.hasAttribute('data-memory-restore'))result=await host.restore(parseFormalRevision(card.querySelector('[data-memory-revision]')?.value));
    if(scope!==null&&scope!==scopeOf())return result;
    await refresh(win);statusOwned(result?.ok?'世界已核对':result?.cancelled?'已停止':result?.pending?'尚未完成，请核对原操作':result?.error??'操作已保存，请核对');
   }catch(error){statusOwned('操作失败：'+error.message)}finally{button.disabled=false}
  };card.addEventListener('click',handleClick);}
  const refreshScope=scopeOf();refresh(win).catch(error=>status('操作失败：'+error.message,refreshScope));
 }
 async function showSource(){const win=getWin();win?.querySelector('.sw2-tab[data-view="settings"]')?.click();win?.querySelector('[data-subtab="sources"]')?.click();}
 return {bind,refresh,showSource,download,pickBackup,showPreview,offerLegacyExport,adoptMigration,switchBranch,exportDraft};
}
