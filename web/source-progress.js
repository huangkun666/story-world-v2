import {diagnostics} from '../src/diagnostics.js';
import {sourceRequestCounts} from '../src/source-request-counts.js';
/** Report the actual terminal failure, never a historical correction that later passed. */
export function sourceImportFailureMessage(row,fallback='本次没有取得完整抽象结果，请重新抽象'){
 return row?.staged?.publication_failure?.message??row?.staged?.capacity?.message??row?.staged?.failure?.message??row?.staged?.workspace?.blockers?.find(b=>b.reason)?.reason??[...(row?.execution?.attempts??[])].reverse().find(a=>a.error?.message)?.error.message??fallback;
}
const STAGE_NAMES={facts:'事实与设定',properties:'属性',identities:'身份',attributes:'属性',relations:'关系',setting:'设定','identities-attributes':'身份与属性','relations-setting':'关系与设定','collect-workspace':'收集原文记载','unify-workspace':'统一身份与时间','draft-entity':'人物与势力定稿','draft-relation':'关系定稿'};
/** A small projection of the frozen plan; never contains originals or model responses. */
export function sourceProgressSnapshot(row,receiving=new Set()){
 let calls=row.staged?.plan?.calls;if(!calls)return null;
 const ws=row.staged.workspace;
 if(ws?.revision>0&&ws.tasks?.length){const ids=new Set(ws.tasks.map(t=>t.call_id));calls=calls.filter(c=>ids.has(c.call_id));}
 else calls=calls.filter(c=>!c.workspace_batch);
 const stages={},attempts=[];let done=0,waiting=0,received=0,validating=0,retries=0;
 for(const [index,call] of calls.entries()){
  const block=row.staged.blocks?.[call.call_id],status=block?.status??'pending';
  const stage=stages[call.stage]??={done:0,total:0};stage.total++;
  if(status==='succeeded'){done++;stage.done++;}
  if(status==='requested'){if(receiving.has(block.attempt_ids?.at(-1)))received++;else waiting++;}
  if(status==='received')validating++;
  const attempt=block?.attempt_count??0;retries+=Math.max(0,attempt-1);
  if(attempt)attempts.push({call_id:call.call_id,index:index+1,stage:call.stage,attempt,status,error:block.error?.message??null});
 }
 for(const call of row.staged.plan.calls.filter(c=>c.workspace_batch&&c.children.some(child=>calls.some(c=>c.call_id===child.call_id)))){
  const block=row.staged.blocks?.[call.call_id];
  if(block?.status==='requested'){if(receiving.has(block.attempt_ids?.at(-1)))received++;else waiting++;}
  if(block?.status==='received')validating++;
  if(block?.attempt_count)attempts.push({call_id:call.call_id,index:attempts.length+1,stage:call.stage,attempt:block.attempt_count,status:block.status,error:block.error?.message??null});
 }
 const unknown=attempts.some(a=>a.status==='unknown');
  const finalStatus=row.staged.finalization?.status;
  const phase=row.status==='cancelled'?'cancelled':finalStatus==='request_unknown'?'unknown':['failed','workspace-failed','workspace-publication_failed'].includes(row.staged.status)?(unknown?'unknown':'failed'):finalStatus==='input_capacity'?'capacity':['blocked','needs_context'].includes(finalStatus)?finalStatus:row.staged.status==='awaiting-fields'?'review':row.staged.status==='succeeded'||finalStatus==='complete'?'assembled':done===calls.length?'assembly':'extract';
 const active=['cancelled','unknown','failed','assembled'].includes(phase)?0:waiting+received+validating;
 const actual=sourceRequestCounts(row);
 return {code:'source-progress',library_id:row.library_id,import_id:row.import_id,phase,total:calls.length,done,active,waiting,receiving:received,validating,stages,attempts,retries:actual.retries,actual_requests:actual,plan_is_final:false,concurrency:row.batch_config?.concurrency??1,sourceCount:row.items.length};
}
function heading(p){
 const label={prepare:'正在准备抽象任务…',extract:'正在抽象',assembly:'抽取完成 · 正在合并与校验…',assembled:'抽取完成 · 正在保存世界…',review:'名册与设定已完成 · 等待确认字段',save:'抽取完成 · 正在保存世界…',failed:'抽象失败',unknown:'抽象请求结果未确认',cancelled:'抽象已停止',capacity:'抽取容量待核对',blocked:'身份或开局时间待核对',needs_context:'需要补充关联上下文'};
  return (label[p.phase]??'正在抽象')+(p.total?' · 当前已规划任务 '+p.done+'/'+p.total+' · '+Math.floor(p.done/p.total*100)+'%':'')+(p.actual_requests?' · 已记录尝试 '+p.actual_requests.claimed+' 次，已确认发起 '+p.actual_requests.invoked+' 次，累计回执通过 '+p.actual_requests.succeeded+' 次，重试 '+p.actual_requests.retries+' 次'+(p.actual_requests.legacy_unclassified?'（旧记录 '+p.actual_requests.legacy_unclassified+' 次调用状态不明）':''):'');
}
/** Owns only UI timing and concise task diagnostics, not execution or persistence. */
export function createSourceProgressDisplay({setText=()=>{},getScope=()=>'',now=()=>Date.now(),setTimer=setInterval,clearTimer=clearInterval,record=(...args)=>diagnostics.record(...args)}={}){
 const scope=JSON.stringify(getScope()),started=now(),seenRetries=new Set();let timer=null,last=null,finished=false,begun=false,reused=0,invalidated=false;
 const current=()=>scope===JSON.stringify(getScope());
 const stop=()=>{if(timer!==null){try{clearTimer(timer);}catch{}timer=null;}};
 const render=()=>{if(finished||invalidated)return;if(!current()){invalidated=true;stop();return;}if(last)try{setText(heading(last),{diagnostic:false,progress:{...last,elapsedMs:Math.max(0,now()-started)}});}catch{}};
 const safeRecord=(...args)=>{try{record(...args);}catch{/* Diagnostics never change execution. */}};
 const update=value=>{
  if(finished||invalidated)return;if(!current()){invalidated=true;stop();return;}
  last=structuredClone(value);
  if(!begun&&last.total){begun=true;reused=last.done;for(const a of last.attempts??[])if(a.attempt>1)seenRetries.add(a.call_id+':'+a.attempt);safeRecord('抽象','info','开始抽象',{library_id:last.library_id,import_id:last.import_id,model:last.model,sources:last.sourceCount,total:last.total,plan_is_final:false,actual_requests:last.actual_requests,concurrency:last.concurrency,reused});}
  for(const a of last.attempts??[]){const key=a.call_id+':'+a.attempt;if(a.attempt>1&&a.status==='requested'&&!seenRetries.has(key)){seenRetries.add(key);safeRecord('抽象','warn','抽象任务重试',{task:a.index,stage:STAGE_NAMES[a.stage]??a.stage,attempt:a.attempt,reason:a.error});}}
  if(timer===null){timer=setTimer(render,1000);timer?.unref?.();}
  render();
 };
 const finish=({ok=false,cancelled=false,paused=false,error=null}={})=>{
  if(finished)return;finished=true;stop();
  safeRecord('抽象',ok||cancelled||paused?'info':'error',paused?'抽象暂停，等待字段确认':ok?'抽象完成':cancelled?'抽象已停止':last?.phase==='unknown'?'抽象请求结果未确认':'抽象失败',
   {library_id:last?.library_id,import_id:last?.import_id,done:last?.done??0,total:last?.total??null,plan_is_final:false,actual_requests:last?.actual_requests,reused,retries:last?.retries??0,ms:Math.max(0,now()-started),...(error?{reason:error}:{})});
 };
 return {update,finish,stop,setPhase:phase=>update({...last,phase})};
}
const put=(node,text)=>{if(node&&node.textContent!==text)node.textContent=text;};
/** Update stable status-bar nodes; clock ticks do not rebuild the panel. */
export function syncSourceProgress(status,p){
 const bar=status?.closest?.('.sw2-statusbar');if(!bar?.querySelector||!bar.ownerDocument?.createElement)return;
 let view=bar.querySelector('[data-source-progress]');
 if(!p){if(view)view.hidden=true;bar.classList.remove('sw2-has-progress');return;}
 if(!view){
  view=bar.ownerDocument.createElement('div');view.className='sw2-extract-progress';view.setAttribute('data-source-progress','');
  view.innerHTML='<progress aria-label="抽象任务完成进度"></progress><div class="sw2-extract-detail"></div><div class="sw2-extract-footer"><span data-source-phase></span><span data-source-elapsed></span></div>';
  bar.appendChild(view);
 }
 view.hidden=false;bar.classList.add('sw2-has-progress');
 const meter=view.querySelector('progress');
 if(p.total){meter.max=p.total;meter.value=p.done;}else meter.removeAttribute('value');
 const details=Object.entries(p.stages??{}).map(([stage,n])=>(STAGE_NAMES[stage]??'抽取')+' '+n.done+'/'+n.total).join(' · ');
 put(view.querySelector('.sw2-extract-detail'),details);
 const state=[p.waiting?'等待响应 '+p.waiting+' 项':'',p.receiving?'接收响应 '+p.receiving+' 项':'',p.validating?'校验结果 '+p.validating+' 项':''].filter(Boolean).join(' · ');
 put(view.querySelector('[data-source-phase]'),(p.phase==='extract'?state:'')+(p.phase==='extract'?' · 并发 '+p.active+'/'+p.concurrency:'')+(p.model?' · '+p.model:''));
 const seconds=Math.floor((p.elapsedMs??0)/1000);
 put(view.querySelector('[data-source-elapsed]'),'已用 '+String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0'));
}
