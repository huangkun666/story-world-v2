import {createCreationModel} from './creation-model.js';
import {sourceTargetChars,positiveSetting,extractionCallLimits} from '../src/runtime-settings.js';
const structuredCloneSettings=s=>({...s});
import { operationId } from '../src/browser-capabilities.js';
import { creationScope, CreationError, creationView, creationStatusText, creationFailure } from '../src/creation-task.js';
import { captureCreationSource } from './source-compose-reader.js';
import { createCreationStore } from './creation-store.js';
import { createCreationFieldView } from './creation-field-view.js';

const CREATION_STAGE_NAMES={'ab-prelude':'字段、设定与地点','ab-unify-prelude':'统一字段与地点','ab-a':'属性与关系','ab-b':'经历与计划','ab-unify-identities':'统一实体身份','ab-organize':'整理相关候选',facts:'名册与设定','collect-workspace':'整理资料','unify-workspace':'统一目录','finalize-workspace':'世界定稿',foundation:'名册与设定',semantic:'世界定稿'};
const activeExecutions=new Map(),storeKeys=new WeakMap();let storeSequence=0;
// One runtime executes owned tasks; view sessions never occupy execution slots.
export function createCreationRuntime({ getCtx, getSelection, store = null, makeId = operationId,
    now = () => new Date().toISOString(), onStatus = () => {}, onState = () => {}, getRoot = () => null,
    prepareFields = null, execute = false, model = null, getConfig = null, sourceCreationProtocol = null, onPublished = async () => {}, fieldView = null, getDocument = () => globalThis.document, confirmRecovery = null, confirmNewWorld = null } = {}) {
    const preparing = new Map(), jobs = new Map(), cancelUnconfirmed = new Map(), pendingReplies = new Map(), pendingLate = new Map(), suspended = new Set(), failures = new Map(), fieldDrafts = new Map(), recovering = new Set();
    const reportedGroupFailures = new Set(), reportedFailures = new Set();
    let database = store, visible = null, viewGeneration = 0, presentationSequence = 0;
    const storage = () => typeof database === 'function' ? database() : (database ??= createCreationStore());
    const scopeNow = () => { try { return creationScope(getCtx()); } catch { return null; } };
    const fields = fieldView ?? createCreationFieldView({ getScope: scopeNow, getDocument });
    function report(scope,message,{error=false,visible=false,task=null}={}){
        try{if(error||scope===scopeNow()){
            const key=error&&task?JSON.stringify([task.run_id,task.execution_id??null,message]):null;
            const diagnostic=error&&(!key||!reportedFailures.has(key));
            onStatus(message,{scope,diagnostic,level:error?'error':'info',...(error||visible?{visible:true}:{})});
            if(diagnostic&&key)reportedFailures.add(key);
        }}catch{}
    }
    async function rememberFailure(task,error,stage,code){
        let latest=task;try{latest=await storage().getRun(task.run_id)??task}catch{}
        if(['cancelled','completed'].includes(latest.status)){failures.delete(task.run_id);return latest}
        const failure=creationFailure(error,{stage,code});failures.set(task.run_id,failure);
        try{latest=(await storage().apply(task.run_id,envelope(latest,'local-failure',{failure}))).task;}catch{}
        if(['cancelled','completed'].includes(latest.status)){failures.delete(task.run_id);return latest}
        report(task.scope,failure.message,{error:true,task:latest});return {...latest,failure};
    }
    function busy() { const scope = scopeNow(); return preparing.has(scope)||[...jobs.values()].some(job=>job.task.scope===scope&&!cancelUnconfirmed.has(job.task.run_id)&&!suspended.has(job.task.run_id)); }
    function syncButtons() {
        const scope=scopeNow(),root=getRoot(),view=visible?.scope===scope?visible:null,active=!!scope&&busy();
        const unfinished=!!view&&view.status!=='completed',offer=unfinished&&!active;
        const startButtons=new Set(root?.querySelectorAll?.('[data-action="init-world"]')??[]);
        const each=(selector,fn)=>{for(const node of root?.querySelectorAll?.(selector)??[])if(selector==='[data-action="init-world"]'||!startButtons.has(node))fn(node)};
        each('[data-action="init-world"]',button=>{button.textContent=active?'停止抽象':'开始新世界';button.disabled=false;button.setAttribute?.('aria-disabled','false');button.classList?.toggle?.('sw2-primary',!offer)});
        each('[data-action="continue-creation"]',button=>{button.hidden=!offer;button.disabled=!offer;button.textContent=view?.status==='needs_fields'?'确认字段并继续':'继续抽象';button.setAttribute?.('aria-disabled',String(!offer));button.classList?.toggle?.('sw2-primary',offer)});
        each('[data-creation-progress]',node=>{node.hidden=!unfinished});
        const progress=unfinished?view.saved_progress:null,counts=progress?.counts,stage=progress?.stageCounts;
        const names=CREATION_STAGE_NAMES;
        const stageText=unfinished?(view.status==='needs_fields'?'等待确认字段':['ready_to_commit','save_failed'].includes(view.status)?'保存世界':(names[progress?.stage]??(progress?.stage?'世界定稿':'准备抽象'))):'';
        const text=counts?'累计已保存 '+counts.saved+' 组 · 失败 '+counts.failed+' 组 · 结果未确认 '+counts.unknown+' 组 · 待处理 '+counts.pending+' 组'+(counts.running?' · 处理中 '+counts.running+' 组':''):unfinished?'正在读取已保存进度…':'';
        each('[data-creation-stage]',node=>{node.textContent=stageText});each('[data-creation-counts]',node=>{node.textContent=text});
        each('[data-creation-fraction]',node=>{node.textContent=stage?.total?'本阶段 '+stage.saved+' / '+stage.total+' 组':unfinished?'当前阶段组数尚未确定':''});
        each('[data-creation-meter]',node=>{node.max=Math.max(1,stage?.total??0);if(stage?.total){node.value=stage.saved;node.setAttribute?.('aria-valuetext','本阶段已保存 '+stage.saved+' 组，共 '+stage.total+' 组')}else{node.removeAttribute?.('value');node.removeAttribute?.('aria-valuetext')}});
    }
    async function readCurrent() {
        const generation = viewGeneration, scope = scopeNow();
        if (!scope) return null;
        const binding = await storage().readBinding(scope);
        if (generation !== viewGeneration || scope !== scopeNow() || !binding?.pending_run_id) return null;
        const task = await storage().getRun(binding.pending_run_id);
        return generation === viewGeneration && scope === scopeNow() && task?.scope === scope ? task : null;
    }
    async function selected(task) {
        const binding=await storage().readBinding(task.scope);
        return binding?.pending_run_id===task.run_id;
    }
    async function publish(task) {
        const generation = viewGeneration;
        if (!task || task.scope !== scopeNow() || preparing.has(task.scope)) return;
        const presentation=++presentationSequence;
        const binding = await storage().readBinding(task.scope);
        if (generation !== viewGeneration || task.scope !== scopeNow() || binding?.pending_run_id !== task.run_id) return;
        const latest = await storage().getRun(task.run_id);
        if (generation !== viewGeneration || !latest || latest.scope !== scopeNow() || preparing.has(latest.scope)) return;
        if (visible?.scope === latest.scope && visible.run_id === latest.run_id && visible.revision > latest.revision) return;
        let savedProgress=null;
        if(typeof storage().getProgress==='function'){
            try{savedProgress=await storage().getProgress(latest.run_id,{scope:latest.scope,isCurrent:()=>generation===viewGeneration&&latest.scope===scopeNow()})}catch{}
            if(generation!==viewGeneration||latest.scope!==scopeNow())return;
            if(savedProgress&&savedProgress.revision!==latest.revision)return;
            if(visible?.scope===latest.scope&&visible.run_id===latest.run_id&&visible.revision>latest.revision)return;
        }
        const finalBinding=await storage().readBinding(latest.scope);
        if(presentation!==presentationSequence||generation!==viewGeneration||latest.scope!==scopeNow()||preparing.has(latest.scope)||finalBinding?.pending_run_id!==latest.run_id)return;
        if(visible?.scope===latest.scope&&visible.run_id===latest.run_id&&visible.revision>latest.revision)return;
        const execution_active = jobs.has(latest.run_id) && !suspended.has(latest.run_id) && !cancelUnconfirmed.has(latest.run_id);
        visible = { ...creationView(latest), saved_progress:savedProgress,...(failures.has(latest.run_id)&&!['completed','cancelled'].includes(latest.status)?{failure:failures.get(latest.run_id)}:{}), execution_active, recoverable: latest.status === 'running' && !execution_active, ...(cancelUnconfirmed.has(latest.run_id) ? { cancel_unconfirmed: true } : {}) };
        try { onState(structuredClone(visible)); } catch {}
        for(const failure of savedProgress?.failures??[]){
            const key=JSON.stringify([latest.run_id,failure.call_id,failure.attempt_id,failure.message]);
            if(reportedGroupFailures.has(key))continue;
            try{
                onStatus((CREATION_STAGE_NAMES[failure.stage]??'抽象')+' · 第'+failure.index+'组失败：'+failure.message,
                    {scope:latest.scope,diagnostic:true,level:'error',visible:false});
                reportedGroupFailures.add(key);
            }catch{}
        }
        report(latest.scope, cancelUnconfirmed.has(latest.run_id) ? '停止状态尚未保存，旧结果不会自动采用；可以重新开始' : creationStatusText(visible),{task:latest,error:!!visible.failure||cancelUnconfirmed.has(latest.run_id),visible:visible.recoverable||['needs_fields','fields_confirmed','paused','failed','unknown','save_failed'].includes(latest.status)}); syncButtons();
    }
    function envelope(task, type, extra = {}) {
        return { type, scope: task.scope, snapshot_id: task.snapshot_id, at: now(), ...extra };
    }
    function cancelPreparation(scope) {
        const operation = preparing.get(scope); if (!operation) return null;
        preparing.delete(scope); operation.controller.abort(); syncButtons();
        report(scope, '本次来源读取已停止，未发送模型请求');
        return { ok: false, cancelled: true };
    }
    async function cancelOwned(task) {
        if(task.status==='completed')return {ok:false,cancelled:false,completed:true,task};
        cancelUnconfirmed.set(task.run_id, task.scope);
        jobs.get(task.run_id)?.controller.abort(); fields.closeRun(task.run_id);
        try {
            const saved = await storage().apply(task.run_id, envelope(task, 'cancel'));
            cancelUnconfirmed.delete(task.run_id);
            await publish(saved.task); return { ok: false, cancelled: saved.task.status==='cancelled', completed:saved.task.status==='completed', task: saved.task };
        } catch {
            await publish(task);
            return { ok: false, cancelled: false, cancel_unconfirmed: true };
        }
    }
    async function cancelRun(runId) {
        const scope = scopeNow(), task = await storage().getRun(runId);
        if (!scope || task?.scope !== scope || scope !== scopeNow()) return { ok: false, stale: true };
        return cancelOwned(task);
    }
    function cancelCurrent() {
        const scope = scopeNow(), prepared = cancelPreparation(scope);
        if (prepared) return prepared;
        const job=[...jobs.values()].reverse().find(value=>value.task.scope===scope&&!['cancelled','completed'].includes(value.task.status));
        if(job)return cancelOwned(job.task);
        return visible?.scope === scope && ['running','ready_to_commit'].includes(visible.status) ? cancelRun(visible.run_id) : { ok: false, cancelled: false };
    }
    function safeFailure(error, fallback) { return error instanceof CreationError ? String(error.message) : fallback; }
    function codeOf(error, fallback) { return error instanceof CreationError ? error.code : fallback; }
    async function confirmOwned(owner, edited) {
        fieldDrafts.set(owner.run_id,{revision:owner.field_revision,fields:structuredClone(edited)});
        let task;try{task=await storage().getRun(owner.run_id)}catch(error){await rememberFailure(owner,error,'field-confirm','field-confirm-failed');throw error}
        if (!task || task.scope !== owner.scope || task.import_id !== owner.import_id || task.snapshot_id !== owner.snapshot_id) return { ok: false, stale: true };
        try{
         const saved=await storage().apply(task.run_id,envelope(task,'fields-confirmed',{expected_field_revision:owner.field_revision,fields:edited}),{expected_revision:task.revision});
         failures.delete(task.run_id);fieldDrafts.delete(task.run_id);await publish(saved.task);
         return {ok:true,confirmed:true,pending:true,task:saved.task};
        }catch(error){
         let current=task;try{current=await storage().getRun(task.run_id)??task}catch{}
         if(current.status==='needs_fields')await rememberFailure(current,error,'field-confirm','field-confirm-failed');
         else report(task.scope,creationFailure(error,{stage:'field-confirm'}).message,{error:true});
         throw error;
        }
    }
    async function confirmFields(owner, edited) {
        return owner.scope === scopeNow() ? confirmOwned(owner, edited) : { ok: false, stale: true };
    }
    async function openFields(task) {
        const held=fieldDrafts.get(task.run_id);let initialFields=held?.revision===task.field_review?.revision?held.fields:null;
        for (;;) {
            let review;
            try { review = await fields.open(task, { initialFields }); }
            catch (error) {
                task=await rememberFailure(task,error,'field-view','field-view-unavailable');
                return { ok: false, pending: true, code: codeOf(error, 'field-view-unavailable') };
            }
            if (review.stale) {report(task.scope,'字段确认尚未保存：聊天、任务或字段版本已改变，请回到原任务重新核对',{error:true});return {ok:false,pending:true,stale:true};}
            if (!review.choice) { const current = await storage().getRun(task.run_id); await publish(current); return { ok: true, pending: true, task: current }; }
            if (review.choice.cancel) {
                const current = await storage().getRun(review.owner.run_id);
                return current?.scope === review.owner.scope ? cancelOwned(current) : { ok: false, stale: true };
            }
            try { return await confirmOwned(review.owner, review.choice.fields); }
            catch (error) {
                const current = await storage().getRun(task.run_id);
                report(task.scope,creationStatusText({...current,failure:failures.get(task.run_id)??current?.failure}),{error:true});
                if (current?.scope !== scopeNow() || current.status !== 'needs_fields' || current.field_review?.revision !== review.owner.field_revision) return { ok: false, pending: true, stale: true, code: codeOf(error, 'field-confirm-failed') };
                task = current; initialFields = review.choice.fields;
            }
        }
    }
    async function executeFoundation(task, signal) {
        const execution_id = makeId(), controller = new AbortController(), job = { task, execution_id, controller };
        jobs.set(task.run_id, job);
        const abort = () => { void cancelOwned(task).catch(() => {}); };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        try {
            const started = await storage().apply(task.run_id, envelope(task, 'execution-started', { execution_id }),
                { expected_revision: task.revision });
            job.task = started.task; await publish(started.task);
            if (controller.signal.aborted) return (await storage().getRun(task.run_id));
            const snapshot = await storage().getSnapshot(task.snapshot_id);
            const reply = await prepareFields({ task: structuredClone(started.task), snapshot, signal: controller.signal,
                onProgress: progress => storage().apply(task.run_id, envelope(started.task, 'progress', {
                    execution_id, done: progress.done, total: progress.total,
                })).then(result => publish(result.task)).catch(() => {}),
            });
            const saved = await storage().apply(task.run_id, envelope(started.task, controller.signal.aborted ? 'checkpoint' : 'fields-ready', {
                execution_id, groups: reply.groups, total: reply.total,
                checkpoint: reply.checkpoint ?? { groups: reply.groups },
            }));
            return saved.task;
        } catch (error) {
            if (controller.signal.aborted) return storage().getRun(task.run_id);
            if(job.task.status!=='running')return rememberFailure(job.task,error,'start','start-failed');
            const failure=creationFailure(error,{stage:'model',code:'foundation-failed'});
            try{
             const saved=await storage().apply(task.run_id,envelope(job.task,'execution-failed',{execution_id,unknown:error?.unconfirmed===true||['network','timeout','stream-incomplete'].includes(error?.sw2CallFailure?.type),failure}));
             if(!['completed','cancelled'].includes(saved.task.status))report(task.scope,failure.message,{error:true,task:saved.task});return saved.task;
            }catch{return rememberFailure(job.task,error,'model','foundation-failed')}
        } finally {
            signal?.removeEventListener('abort', abort);
            if (jobs.get(task.run_id) === job) jobs.delete(task.run_id);
            syncButtons();
        }
    }

    async function commitWorld(task) {
        try {
            const saved=await storage().commit(task.run_id);failures.delete(task.run_id);
            await publish(saved);
            if(saved.scope===scopeNow())try{await onPublished(saved,storage());}catch{report(saved.scope,'世界已保存在浏览器，页面指针暂未更新；可重新打开当前聊天',{error:true});}
            return saved;
        } catch(error) {
            let current=task;try{current=await storage().getRun(task.run_id)??task}catch{}
            const failure=creationFailure(error,{stage:'publication',code:'publication-failed'});failures.set(task.run_id,failure);
            let saved;try{saved=(await storage().apply(task.run_id,envelope(current,'publication-failed',{failure}))).task}catch{saved=await rememberFailure(current,error,'publication','publication-failed')}
            report(task.scope,failure.message,{error:true,task:saved});await publish(saved);return saved;
        }
    }
    function executionKey(task){const db=storage();if(!storeKeys.has(db))storeKeys.set(db,++storeSequence);return 'story-world-v2:creation:'+String(db.db?.name??storeKeys.get(db))+':'+task.run_id;}
    async function withExecutionLock(task,action,onBusy){
        const key=executionKey(task);if(activeExecutions.has(key))return onBusy();
        const run=async()=>{if(activeExecutions.has(key))return onBusy();const owner={};activeExecutions.set(key,owner);try{return await action()}finally{if(activeExecutions.get(key)===owner)activeExecutions.delete(key)}};
        const locks=globalThis.navigator?.locks;
        return locks?.request?locks.request(key,{ifAvailable:true},lock=>lock?run():onBusy()):run();
    }
    async function executePlan(task,signal,lockHeld=false){
        return lockHeld?executePlanOwned(task,signal):withExecutionLock(task,()=>executePlanOwned(task,signal),()=>storage().getRun(task.run_id));
    }
    async function executePlanOwned(task,signal) {
        const controller=new AbortController(),job={task,controller};suspended.delete(task.run_id);jobs.set(task.run_id,job);
        const abort=()=>{void cancelOwned(task).catch(()=>{});};
        signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
        const settings=structuredCloneSettings(getCtx()?.extensionSettings?.story_world_v2??{});
        const call=model??createCreationModel(settings,{getPresetSettings:()=>getCtx()?.extensionSettings?.story_world_v2??{}});let stage='start';
        try {
            if(['prepared','fields_confirmed'].includes(task.status)){
                const snapshot=await storage().getSnapshot(task.snapshot_id);
                if(controller.signal.aborted||cancelUnconfirmed.has(task.run_id))return storage().getRun(task.run_id);
                const config=getConfig?.({task,snapshot,ctx:getCtx()})??{
                    ...(task.source_creation_protocol?{sourceCreationProtocol:task.source_creation_protocol}:{}),
                    chunk_chars:sourceTargetChars(settings),concurrency:positiveSetting(settings.extractConcurrency,2),
                    max_tokens:extractionCallLimits(settings).maxTokens,stream:true,
                    world:{worldName:snapshot.world_name,tension:.5,playerName:snapshot.macros?.playerName??'',extractedAt:task.created_at}
                };
                task=await storage().begin(task.run_id,config,makeId());failures.delete(task.run_id);
            }
            if(controller.signal.aborted||cancelUnconfirmed.has(task.run_id))return storage().getRun(task.run_id);
            if(task.status==='paused'){task=(await storage().apply(task.run_id,envelope(task,'execution-resumed',{execution_id:task.execution_id}))).task;failures.delete(task.run_id)}
            job.task=task;await publish(task);
            // A received reply retained after a failed local write is retried without calling a model.
            stage='receipt';for(const pending of [...pendingReplies.values()].filter(p=>p.run_id===task.run_id)){await storage().receive(pending.attempt_id,pending.receipt);pendingReplies.delete(pending.attempt_id);await storage().consume(pending.attempt_id);}
            suspended.delete(task.run_id);
            for(;;){
                if(controller.signal.aborted||cancelUnconfirmed.has(task.run_id))return storage().getRun(task.run_id);
                if(!await selected(task))return (await storage().apply(task.run_id,envelope(task,'execution-superseded',{execution_id:task.execution_id}))).task;
                stage='plan';const next=await storage().plan(task.run_id);task=next.task;job.task=task;await publish(task);
                const effect=next.effect;
                if(effect.kind==='fields'||effect.kind==='blocked'||effect.kind==='idle')return task;
                if(effect.kind==='publish')return await commitWorld(task);
                const requests=effect.kind==='model'?[effect]:effect.requests;
                const pipeline=await storage().getPipeline(task.run_id);
                let index=0,haltScheduling=false;
                const worker=async()=>{let workerStage='claim';try{
                    while(index<requests.length&&!controller.signal.aborted&&!haltScheduling){
                        const request=requests[index++];
                        workerStage='claim';const claim=await storage().claim(task.run_id,request,makeId(),task.execution_id);
                        const attempt=claim.attempt;
                        if(!claim.claimed&&!attempt.receipt){
                            const saved=await storage().apply(task.run_id,envelope(task,'execution-failed',{execution_id:task.execution_id,unknown:true}));
                            task=saved.task;haltScheduling=true;return;
                        }
                        if(claim.claimed){
                            workerStage='model';const receipt=await call(request,{signal:controller.signal,onDispatch:summary=>storage().dispatch(attempt.attempt_id,summary),onLateReceipt:async evidence=>{
                                const key=makeId();pendingLate.set(key,{attempt_id:attempt.attempt_id,run_id:task.run_id,evidence});
                                await storage().saveLate(attempt.attempt_id,evidence);pendingLate.delete(key);
                            }});
                            if(receipt.unknown||receipt.failure?.context_rejected||['truncation','not-sent'].includes(receipt.failure?.type))haltScheduling=true;
                            pendingReplies.set(attempt.attempt_id,{run_id:task.run_id,attempt_id:attempt.attempt_id,receipt});
                            workerStage='receipt';await storage().receive(attempt.attempt_id,receipt);
                            pendingReplies.delete(attempt.attempt_id);
                        }
                        if(!controller.signal.aborted&&!cancelUnconfirmed.has(task.run_id)){workerStage='consume';const consumed=await storage().consume(attempt.attempt_id);await publish(consumed);}
                    }
                }catch(error){haltScheduling=true;throw {creation_stage:workerStage,cause:error}}};
                const results=await Promise.allSettled(Array.from({length:Math.min(pipeline.config.concurrency,requests.length)},worker));
                const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
                task=await storage().getRun(task.run_id);if(task.status!=='running')return task;
            }
        } catch(error) {
            suspended.add(task.run_id);
            const failureStage=error?.creation_stage??stage;return await rememberFailure(task,error?.creation_stage?error.cause:error,failureStage,failureStage+'-failed');
        } finally {
            signal?.removeEventListener('abort',abort);if(jobs.get(task.run_id)===job)jobs.delete(task.run_id);try{await publish(task)}catch{if(failures.has(task.run_id))report(task.scope,failures.get(task.run_id).message,{error:true,task})}syncButtons();
        }
    }

    async function continueRun(runId, { showFields = true, signal = null, lockHeld = false } = {}) {
        const scope = scopeNow();
        let task = await storage().getRun(runId);
        if (!task || task.scope !== scope || scope !== scopeNow()) return { ok: false, stale: true };
        if(!await selected(task)||scope!==scopeNow())return {ok:false,stale:true,task};
        if(['failed','unknown'].includes(task.status)&&typeof storage().revalidateFailed==='function'){
            if(recovering.has(task.run_id))return {ok:false,pending:true,skipped:'revalidating',task};
            if(jobs.has(task.run_id))return {ok:true,running:true,task};
            const generation=viewGeneration;recovering.add(task.run_id);
            try{
                const result=await storage().revalidateFailed(task.run_id,{scope,expected_revision:task.revision,execution_id:task.execution_id,isCurrent:()=>scope===scopeNow()&&generation===viewGeneration});
                task=result.task;failures.delete(task.run_id);
                if(scope!==scopeNow()||generation!==viewGeneration)return {ok:false,stale:true,task};
                if(!result.resumed){await publish(task);return {ok:false,pending:true,task,summary:result.summary,blockers:result.blockers}}
            }catch(error){
                if(scope!==scopeNow()||generation!==viewGeneration)return {ok:false,stale:true};
                if(error instanceof CreationError&&['stale-task','newer-intent'].includes(error.code))return {ok:false,stale:true};
                const failed=await rememberFailure(task,error,'plan','receipt-revalidation-failed');await publish(failed);return {ok:false,pending:true,task:failed};
            }finally{recovering.delete(task.run_id)}
        }
        const commitOnly=['ready_to_commit','save_failed'].includes(task.status);
        if (!prepareFields && (execute || model || getConfig) && ['prepared','fields_confirmed','running','paused'].includes(task.status)) {
            if(jobs.has(task.run_id))return {ok:true,running:true,task};
            task=await executePlan(task,signal,lockHeld);
        }
        if (commitOnly)task=await commitWorld(task);
        if (task.status === 'prepared' && prepareFields) {
            if (jobs.has(task.run_id)) return { ok: true, running: true, task };
            task = await executeFoundation(task, signal);
        }
        await publish(task);
        if (task.status === 'needs_fields') {
            if(!await selected(task))return {ok:true,pending:true,stale:true,task};
            const result=showFields && task.scope===scopeNow()?await openFields(task):{ok:true,pending:true,task};
            if(!prepareFields&&result.confirmed&&task.scope===scopeNow()&&await selected(task))return continueRun(task.run_id,{showFields:false,signal,lockHeld});
            return result;
        }
        if(task.status==='completed')return {ok:true,completed:true,task,pointer:task.pointer};
        return { ok: !task.failure&&['prepared', 'running', 'fields_confirmed'].includes(task.status), running: task.status === 'running', pending: true, task };
    }
    async function retryLocalWrites(runId) {
        const task=await storage().getRun(runId);if(task?.scope!==scopeNow())return {ok:false,stale:true};
        for(const [key,value] of [...pendingReplies])if(value.run_id===runId){await storage().receive(value.attempt_id,value.receipt);pendingReplies.delete(key);}
        for(const [key,value] of [...pendingLate])if(value.run_id===runId){await storage().saveLate(value.attempt_id,value.evidence);pendingLate.delete(key);}
        return {ok:true,task:await storage().getRun(runId)};
    }
    async function getSourceTaskDiagnostics(){
        const task=await readCurrent();if(!task)return null;
        const data=await storage().diagnostics(task.run_id);
        if(task.scope!==scopeNow()||!await selected(task)||task.scope!==scopeNow())return {status:'stale',message:'聊天或任务已改变，未导出旧任务回执'};
        return data;
    }
    async function recoveryLimit(task,explicit=null){
        if(explicit!==null)return explicit;
        const ctx=getCtx(),snapshot=getConfig?await storage().getSnapshot(task.snapshot_id):null;
        return getConfig?.({task,snapshot,ctx})?.max_tokens??extractionCallLimits(ctx?.extensionSettings?.story_world_v2??{}).maxTokens;
    }
    async function recoverRun(runId,{retry_unknown=false,expected_revision=null,execution_id=null,output_max_tokens=null,signal=null}={}){
        const scope=scopeNow(),generation=viewGeneration;let task=await storage().getRun(runId);
        const current=()=>scope===scopeNow()&&generation===viewGeneration;
        if(!task||task.scope!==scope||!current()||!await selected(task))return {ok:false,stale:true};
        if(jobs.has(runId)||recovering.has(runId))return {ok:false,running:true,task};
        if(getDocument()?.defaultView&&!globalThis.navigator?.locks?.request){const reason='当前页面无法使用跨窗口执行锁，不能安全重试请求；请在支持此功能的安全浏览器页面继续，已保存进度保持';report(scope,reason,{error:true});return {ok:false,pending:true,code:'recovery-lock-unavailable',task,reason}}
        return withExecutionLock(task,async()=>{
            try{
                // Retained memory receipts must land before deciding whether a request needs a retry.
                await retryLocalWrites(runId);if(!current())return {ok:false,stale:true};
                const desiredOutput=await recoveryLimit(task,output_max_tokens);
                const preview=await storage().recoveryPreview(runId,{scope,output_max_tokens:desiredOutput,isCurrent:current});
                if(expected_revision!==null&&(preview.expected_revision!==expected_revision||execution_id!==null&&preview.execution_id!==execution_id))return {ok:false,stale:true};
                if(preview.requires_unknown_confirmation&&!retry_unknown)return {ok:false,pending:true,confirmation_required:true,task:preview.task,summary:preview.summary};
                if(!preview.can_recover)return {ok:false,pending:true,task:preview.task,reason:preview.reason};
                recovering.add(runId);
                const recovered=await storage().recover(runId,{scope,expected_revision:preview.expected_revision,execution_id:preview.execution_id,retry_unknown,output_max_tokens:desiredOutput,isCurrent:current});
                recovering.delete(runId);failures.delete(runId);suspended.delete(runId);
                if(!current())return {ok:false,stale:true};
                return await continueRun(runId,{signal,lockHeld:true});
            }catch(error){
                if(!current()||error instanceof CreationError&&['stale-task','newer-intent','confirmation-required'].includes(error.code))return {ok:false,stale:true};
                const latest=await storage().getRun(runId)??task;
                const failure=creationFailure(error,{stage:'plan',code:'resume-failed'});report(scope,failure.message,{error:true});
                return {ok:false,pending:true,task:latest,failure};
            }finally{recovering.delete(runId)}
        },()=>({ok:false,running:true,task,reason:'该任务仍在其它窗口执行，请等待完成或关闭原执行窗口后继续'}));
    }
    async function reviewCurrent(payload = {}) {
        const scope=scopeNow(),generation=viewGeneration,task=payload.run_id?await storage().getRun(payload.run_id):await readCurrent();
        if(!task||task.scope!==scope||scope!==scopeNow())return {ok:false,stale:true};
        if(!storage().recoveryPreview||!['failed','unknown','cancelled','paused','running'].includes(task.status))return continueRun(task.run_id);
        if(jobs.has(task.run_id))return {ok:true,running:true,task};
        const desiredOutput=await recoveryLimit(task,payload.output_max_tokens??null);
        const preview=await storage().recoveryPreview(task.run_id,{scope,output_max_tokens:desiredOutput,isCurrent:()=>scope===scopeNow()&&generation===viewGeneration});
        if(!preview.can_recover){report(scope,preview.reason??'已保存进度；当前条件尚不能继续',{error:true});return {ok:false,pending:true,task,reason:preview.reason}}
        if(preview.requires_unknown_confirmation||task.status==='cancelled'){
            const message='继续本次抽象：已经成功的部分和已确认字段会保留，不会重抽。'+(preview.requires_unknown_confirmation?'有请求因断网、超时或关闭页面而结果未确认；只重试这些未完成请求可能再次计费。':'已停止的任务将从保存的位置继续。')+'是否继续？';
            const win=getDocument()?.defaultView,ask=confirmRecovery??(typeof win?.confirm==='function'?text=>win.confirm(text):typeof globalThis.confirm==='function'?text=>globalThis.confirm(text):null);
            if(!ask||!await ask(message))return {ok:false,pending:true,confirmation_required:!ask,task};
        }
        if(scope!==scopeNow()||generation!==viewGeneration)return {ok:false,stale:true};
        return recoverRun(task.run_id,{retry_unknown:preview.requires_unknown_confirmation,expected_revision:preview.expected_revision,execution_id:preview.execution_id,...(payload.output_max_tokens!==undefined?{output_max_tokens:payload.output_max_tokens}:{})});
    }
    async function startNew({ command_id = makeId(), signal = null } = {}) {
        let scope;
        try { scope = creationScope(getCtx()); } catch (error) { return { ok: false, code: codeOf(error, 'missing-chat'), reason: safeFailure(error, '当前聊天身份暂不可用，请稍后重试') }; }
        fields.close();
        const controller = new AbortController(), operation = { controller, command_id };
        preparing.get(scope)?.controller.abort(); preparing.set(scope, operation);
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
        syncButtons(); report(scope, '正在读取当前聊天勾选的资料…');
        let registered = null;
        try {
            const captured = await captureCreationSource({ getCtx, getSelection, signal: controller.signal });
            if (!captured.ok) { report(scope, captured.reason); return captured; }
            const current = () => !controller.signal.aborted && preparing.get(scope) === operation && captured.isCurrent();
            if (!current()) return { ok: false, stale: true, reason: '聊天或来源已变化，未建立任务' };
            const snapshot_id = makeId(), run_id = makeId(), library_id = makeId(), import_id = makeId();
            const saved = await storage().createPrepared({ run_id, library_id, import_id, snapshot_id, scope, ...(sourceCreationProtocol?{source_creation_protocol:sourceCreationProtocol}:{}),
                command_id, created_at: now(), snapshot: { ...captured.snapshot, snapshot_id } }, { isCurrent: current });
            registered = saved;
        } catch (error) {
            if (controller.signal.aborted || error?.name === 'AbortError') return { ok: false, cancelled: true };
            const reason = safeFailure(error, '当前资料未能读取或保存，可以重新开始；已有任务保持');
            report(scope, reason);
            return { ok: false, stale: error?.code === 'stale-source', code: codeOf(error, 'prepare-failed'), reason };
        } finally {
            signal?.removeEventListener('abort', abort);
            if (preparing.get(scope) === operation) preparing.delete(scope);
            syncButtons();
        }
        for (const [id, owner] of cancelUnconfirmed) if (owner === registered.task.scope && !jobs.has(id) && id !== registered.task.run_id) cancelUnconfirmed.delete(id);
        await publish(registered.task);
        const prepared = { ok: true, prepared: true, replayed: registered.replayed, task: registered.task };
        return (prepareFields || execute || model || getConfig) ? { ...prepared, ...await continueRun(registered.task.run_id, { signal }) } : prepared;
    }
    async function click(options = {}) {
        const scope=scopeNow(),generation=viewGeneration;if(!scope)return startNew(options);
        if(busy())return cancelCurrent();
        const current=await readCurrent();if(scope!==scopeNow()||generation!==viewGeneration)return {ok:false,stale:true};
        if(current&&current.status!=='completed'){
            const win=getDocument()?.defaultView,ask=confirmNewWorld??(typeof win?.confirm==='function'?text=>win.confirm(text):typeof globalThis.confirm==='function'?text=>globalThis.confirm(text):null);
            if(ask&&!await ask('当前聊天已有未完成的抽象。开始新世界会重新抽取当前资料并产生新的模型调用，旧任务与已保存结果会保留；若要接着原任务，请选择“继续抽象”。仍要新建吗？'))return {ok:false,pending:true,task:current};
            if(scope!==scopeNow()||generation!==viewGeneration)return {ok:false,stale:true};
            const stillSelected=await selected(current);
            if(!stillSelected||scope!==scopeNow()||generation!==viewGeneration)return {ok:false,stale:true};
        }
        // This click began as Start. Work appearing during the read/confirmation
        // does not turn that earlier intent into a later Stop.
        return busy()?{ok:false,pending:true,skipped:'already-starting'}:startNew(options);
    }
    async function refreshCurrent(){
        const scope=scopeNow(),generation=viewGeneration;
        try{const task=await readCurrent();if(generation!==viewGeneration||scope!==scopeNow())return null;if(task)await publish(task);else{visible=null;syncButtons()}return task}
        catch(error){const failure=creationFailure(error,{stage:'read',code:'task-read-failed'});report(scope,failure.message,{error:true});return {ok:false,unavailable:true,code:failure.code,failure}}
    }
    async function scopeChanged() {
        const generation = ++viewGeneration;
        fields.scopeChanged(); visible = null;
        try { onState(null); } catch {}
        const scope = scopeNow();
        for (const [owner] of preparing) if (owner !== scope) cancelPreparation(owner);
        syncButtons();
        try { const task = await readCurrent(); if (generation !== viewGeneration) return; if (task) await publish(task); else if (scope === scopeNow()) { try { onState(null); } catch {} report(scope, '当前聊天尚无抽象任务'); } } catch {}
    }
    return { startNew, click, continueRun, recoverRun, reviewCurrent, confirmFields, cancelRun, cancelCurrent,
        syncButtons, scopeChanged, refreshCurrent, busy, readCurrent, retryLocalWrites, getSourceTaskDiagnostics, currentFieldOwner: fields.currentOwner };
}
