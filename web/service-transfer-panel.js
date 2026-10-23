const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function renderTransferPanel(){return '<div class="sw2-set-card" data-transfer-panel><h4>迁移与备份</h4>'
 +'<p>先完整核对当前旧账、旧卷和所有恢复点，再明确迁移到一个新分支。迁移前旧账保留。</p>'
 +'<div class="sw2-row"><button class="sw2-btn" data-transfer-preview>预览当前旧账</button><label>或选择备份文件<input class="sw2-input" type="file" accept=".json,application/json" data-transfer-file></label><button class="sw2-btn" data-transfer-upload>预览所选文件</button></div>'
 +'<div data-transfer-report aria-live="polite"></div><label>新世界编号<input class="sw2-input" data-transfer-world></label><label>新分支编号<input class="sw2-input" data-transfer-branch></label>'
 +'<div class="sw2-row"><button class="sw2-btn" data-transfer-import>确认写入并连接服务</button><button class="sw2-btn" data-transfer-check>核对原迁移</button><button class="sw2-btn" data-transfer-export>下载当前版本服务备份</button></div>'
 +'<label><input type="checkbox" data-transfer-saved>我已保存当前版本服务备份文件</label><p>返回会恢复迁移前旧账；服务里之后发生的事情保留在服务及备份中。</p><button class="sw2-btn" data-transfer-return>返回迁移前旧账</button><p data-transfer-status role="status">尚未迁移</p></div>'}
export function renderTransferReport(result){if(!result)return '';const report=result.report??{},labels={entities:'实体',agendas:'谋划',events:'事件',conditions:'条件',chronicle:'编年记录',volumes:'旧卷',recovery_points:'恢复点',snapshots:'正式快照',branches:'分支'};return '<p>'+Object.entries(report.counts??{}).map(([k,v])=>esc(labels[k]??k)+'：'+esc(v)).join(' · ')+'</p>'
 +'<p>错误 '+esc(report.errors?.length??0)+' 项；提醒 '+esc(report.warnings?.length??0)+' 项</p>'+(result.omissions??[]).map(v=>'<p>'+esc(v)+'</p>').join('')
 +'<details><summary>完整核对结果与缺失记录</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify(report,null,2))+'</pre></details>'}
export function createTransferPanel({session,onStatus=()=>{},download=defaultDownload}){
 const find=win=>win?.querySelector('#sw2_view_settings .sw2-settings')?.querySelector('[data-transfer-panel]');
 function refresh(win){const card=find(win);if(!card)return;const state=session.readout();if(card._scope!==session.scope){card._scope=session.scope;for(const key of ['file','world','branch']){const field=card.querySelector('[data-transfer-'+key+']');if(field)field.value=''}if(card.querySelector('[data-transfer-saved]'))card.querySelector('[data-transfer-saved]').checked=false;card._backupDigest=null;if(card.querySelector('[data-transfer-report]'))card.querySelector('[data-transfer-report]').innerHTML=''}if(card.querySelector('[data-transfer-status]'))card.querySelector('[data-transfer-status]').textContent=state?.pending?'原迁移尚未确认，请核对原编号':state?.adopted?'已迁移并连接服务':state?.returned_pointer?'已返回迁移前旧账':'尚未迁移'}
 function bind(win){const pane=win?.querySelector('#sw2_view_settings .sw2-settings');if(!pane)return;let card=pane.querySelector('[data-transfer-panel]');if(!card){pane.insertAdjacentHTML('beforeend',renderTransferPanel());card=pane.querySelector('[data-transfer-panel]')}if(!card)return;refresh(win);if(card._bound)return;card._bound=true;
 card.addEventListener('click',async event=>{const button=event.target?.closest('button');if(!button||!card.contains(button))return;const scope=session.scope,read=key=>card.querySelector('[data-transfer-'+key+']');button.disabled=true;try{let result;
 if(button.hasAttribute('data-transfer-preview'))result=await session.preview();
 else if(button.hasAttribute('data-transfer-upload')){const file=read('file').files?.[0];if(!file)throw Error('请选择备份文件');const text=await file.text();if(scope!==session.scope)return;result=await session.preview(text)}
 else if(button.hasAttribute('data-transfer-import'))result=await session.import({world_id:read('world').value.trim(),branch_id:read('branch').value.trim()});
 else if(button.hasAttribute('data-transfer-check'))result=await session.reconcile();
 else if(button.hasAttribute('data-transfer-export')){const bundle=await session.export();if(scope!==session.scope)return;await download(bundle);card._backupDigest=bundle.digest;read('saved').checked=false;result={ok:true,downloaded:true}}
 else if(button.hasAttribute('data-transfer-return'))result=await session.returnLegacy({savedBackup:read('saved').checked,backupDigest:card._backupDigest});
 if(scope!==session.scope)return;if(result?.report)read('report').innerHTML=renderTransferReport(result);const text=result?.downloaded?'备份已下载，请确认文件保存成功':result?.detached?'已返回迁移前旧账':result?.ok?'核对完成':result?.error??'核对结果包含错误，请查看完整记录';read('status').textContent=text;onStatus(text);
 }catch(error){if(scope===session.scope){read('status').textContent=error.message;onStatus(error.message)}}finally{button.disabled=false}})}
 return {bind,refresh};
}
function defaultDownload(bundle){const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}));link.href=url;link.download='story-world-service-'+bundle.digest.slice(0,12)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
