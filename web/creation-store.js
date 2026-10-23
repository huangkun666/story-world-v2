import { redactText } from '../src/diagnostics.js';
import { initialCreationPlan, nextCreationStep, applyCreationResponse, revalidateCreationFacts, creationBlockSummary, summarizeCreationBlocks } from '../src/creation-plan.js';
import { createWorldJournal } from './world-journal.js';
import { RECORD_STORES } from './world-record-store.js';
import { initializePlayerWorld } from './source-player.js';
import { freezeInitialState } from '../src/finalized-source.js';
import { Dexie } from '../vendor/world-memory.js';
import { sha256Hex, operationId } from '../src/browser-capabilities.js';
import { CREATION_PROTOCOL, preparedCreationTask, creationError, transitionCreationTask, creationFailure } from '../src/creation-task.js';
export const CREATION_DATABASE = 'story-world-v2-creation-v1';
const clone = value => structuredClone(value);
export function createCreationStore({ name = CREATION_DATABASE, indexedDB = globalThis.indexedDB, IDBKeyRange = globalThis.IDBKeyRange } = {}) {
    if (!name.startsWith('story-world-v2-creation-')) throw creationError('invalid-database', '新建任务只能写入独立的新流程数据库');
    if (!indexedDB?.open || !IDBKeyRange) throw creationError('storage-unavailable', '浏览器本地存储暂不可用，未建立新任务');
    const db = new Dexie(name, { indexedDB, IDBKeyRange });
    // This namespace contains new-flow records only. No old database is opened or migrated.
    db.version(1).stores({
        creationRuns: 'run_id, scope, status', creationSnapshots: 'snapshot_id, scope',
        imports: '[library_id+import_id], library_id, run_id, scope', bindings: 'scope', creationCommands: 'command_id, scope',
    });
    db.version(2).stores({ creationCheckpoints: '[run_id+execution_id], run_id' });
    db.version(3).stores({
        creationPipelines:'run_id',creationAttempts:'attempt_id, [run_id+call_id], run_id, status',
        heads:'[world_id+branch_id], world_id, revision',snapshots:'[world_id+branch_id+revision], [world_id+branch_id], world_id',
        operations:'operation_id, [world_id+branch_id], status',indexJobs:'[world_id+branch_id+revision], status',
        vectors:'[identity+hash], identity',libraries:'library_id',sourceVersions:'[library_id+version], library_id',
        savedSnapshots:'[world_id+snapshot_id], world_id',worldBodies:'digest',userParams:'world_id',
        ...RECORD_STORES,recordConversions:'[world_id+branch_id+revision]'
    });

    async function projectSourceImport(input){
        if(!input.run_id)return input;
        const task=await db.creationRuns.get(input.run_id);
        // Imported audit retains its original identity; it is not a runnable local task.
        if(!task){
            const audit=input.creation_audit,object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
            if(![audit,audit?.task,audit?.snapshot,audit?.pipeline].every(object)
                ||!Array.isArray(audit.snapshot.originals)||!Array.isArray(audit.snapshot.allowed_blocks)
                ||!Array.isArray(audit.pipeline.items)||!object(input.execution)||!Array.isArray(input.execution.attempts))
                throw creationError('invalid-creation-audit','创建归档不完整，无法完整导出；原资料保持');
            if(audit.protocol!==CREATION_PROTOCOL||audit.task.protocol!==audit.protocol)
                throw creationError('invalid-creation-audit','创建归档协议无法核对，未导出；原资料保持');
            const keys=['run_id','library_id','import_id','snapshot_id','scope'];
            if(keys.some(key=>typeof input[key]!=='string'||!input[key]||audit.task[key]!==input[key])
                ||audit.snapshot.snapshot_id!==input.snapshot_id||audit.snapshot.scope!==input.scope
                ||audit.pipeline.run_id!==input.run_id
                ||input.execution.attempts.some(attempt=>!object(attempt)||keys.some(key=>Object.hasOwn(attempt,key)&&attempt[key]!==input[key])))
                throw creationError('invalid-creation-audit','创建归档身份不一致，无法完整导出；原资料保持');
            return input;
        }
        const pipeline=await db.creationPipelines.get(input.run_id);
        const snapshot=await db.creationSnapshots.get(input.snapshot_id);
        const attempts=await db.creationAttempts.where('run_id').equals(input.run_id).toArray();
        const audit=attempts.map(a=>a.audit_cleared?a:({...a,outcome:a.outcome==='succeeded'?'succeeded':a.receipt?.unknown?'unknown':a.receipt?'failed':'requested'}));
        return {...input,status:task.status==='completed'?'published':'draft',
            items:pipeline.items,candidates:[],execution:{attempts:audit},receipt:input.publication_receipt??null,
            creation_audit:{protocol:task.protocol,task,snapshot,pipeline,...(task.audit_cleared?{cleared:true}:{})}};
    }
    const journal = createWorldJournal({database:db,indexedDB,IDBKeyRange,projectSourceImport,
        sourceAuditTables:[db.creationRuns,db.creationPipelines,db.creationSnapshots,db.creationAttempts]});
    const eventFor=(task,type,extra={})=>({type,scope:task.scope,snapshot_id:task.snapshot_id,execution_id:task.execution_id,at:new Date().toISOString(),...extra});
    async function begin(runId,config,execution_id) {
        return db.transaction('rw',db.creationRuns,db.creationPipelines,db.imports,async()=>{
            const task=await db.creationRuns.get(runId);
            if(!task)throw creationError('missing-task','任务尚未读到');
            const saved=transitionCreationTask(task,eventFor(task,'execution-started',{execution_id})).task;
            let pipeline=await db.creationPipelines.get(runId);
            if(!pipeline){const input=await db.imports.get([task.library_id,task.import_id]);pipeline={run_id:runId,...initialCreationPlan(input,config)};await db.creationPipelines.add(pipeline);}
            await db.creationRuns.put(saved);return saved;
        });
    }
    async function plan(runId) {
        return db.transaction('rw',db.creationRuns,db.creationPipelines,async()=>{
            let task=await db.creationRuns.get(runId),pipeline=await db.creationPipelines.get(runId);
            if(!task||task.status!=='running')return {task,effect:{kind:'idle'}};
            const next=nextCreationStep(task,pipeline);pipeline={...next.pipeline,run_id:runId};
            if(next.effect.kind==='fields')task=transitionCreationTask(task,eventFor(task,'fields-ready',{groups:next.effect.groups,total:pipeline.staged.plan.calls.length})).task;
            if(next.effect.kind==='blocked'){
                const reason=next.effect.reason??(next.effect.unknown?'请求结果尚未确认，禁止自动重发':'后续抽象条件尚未满足');
                const failure=creationFailure(Object.assign(creationError(next.effect.code??'plan-blocked',reason),{sw2CallFailure:pipeline.staged.blocks[next.effect.call_id]?.failure}),{stage:'plan',code:'plan-blocked'});
                if(next.effect.summary){failure.summary=clone(next.effect.summary);failure.blockers=clone(next.effect.blockers??[])}
                task=transitionCreationTask(task,eventFor(task,'execution-failed',{unknown:next.effect.unknown===true,failure})).task;
            }
            if(next.effect.kind==='publish'){pipeline.publication=next.effect.publication;task=transitionCreationTask(task,eventFor(task,'publication-ready')).task;}
            await db.creationPipelines.put(pipeline);await db.creationRuns.put(task);
            return {task,effect:next.effect};
        });
    }
    async function revalidateFailed(runId,{scope,expected_revision,execution_id,isCurrent=()=>true}={}){
        return db.transaction('rw',db.creationRuns,db.creationPipelines,db.creationAttempts,db.bindings,async()=>{
            let task=await db.creationRuns.get(runId);const binding=task&&await db.bindings.get(task.scope);
            if(!task||task.scope!==scope||task.revision!==expected_revision||task.execution_id!==execution_id||!['failed','unknown'].includes(task.status)||binding?.pending_run_id!==runId||!isCurrent())throw creationError('stale-task','聊天或任务状态已变化，原回执未重验');
            const pipeline=await db.creationPipelines.get(runId);if(!pipeline)throw creationError('missing-plan','已保存的抽象计划尚未读到，未重新发送请求');
            const attempts=await db.creationAttempts.where('run_id').equals(runId).toArray();
            const result=revalidateCreationFacts(task,pipeline,attempts),hard=result.blockers.filter(b=>!b.repairable),blocked=hard.length>0;
            let failure=null;if(blocked){failure=creationFailure(creationError(result.summary.unknown?'request-unknown':'validation',creationBlockSummary(result)),{stage:'plan'});failure.summary=clone(result.summary);failure.blockers=clone(result.blockers)}
            const phase=result.pipeline.staged.workspace?'semantic':'foundation';
            task=transitionCreationTask(task,eventFor(task,'receipts-revalidated',{execution_id,unknown:result.summary.unknown>0,blocked,failure,phase})).task;
            if(!isCurrent())throw creationError('stale-task','聊天或任务状态已变化，本次重验未采用');
            await db.creationPipelines.put({...result.pipeline,run_id:runId});await db.creationRuns.put(task);
            return {task,resumed:!blocked,summary:result.summary,blockers:result.blockers};
        });
    }
    const ordinaryContinue=new Set(['prepared','needs_fields','fields_confirmed','ready_to_commit','save_failed']);
    const releasedAttempts=pipeline=>new Set((pipeline?.recoveries??[]).flatMap(row=>row.released_attempt_ids??[]));
    function recoveryState(task,pipeline,attempts){
        const summaryEmpty={total:0,succeeded:0,failed:0,format_failed:0,unknown:0,pending:0};
        if(!pipeline){
            const preparation=task.status==='cancelled'&&task.execution_id===undefined&&attempts.length===0;
            const can_recover=ordinaryContinue.has(task.status)||preparation;
            return {pipeline:null,summary:summaryEmpty,blockers:[],actions:[],consumed:[],can_recover,needs_recovery:!ordinaryContinue.has(task.status),
                reason:can_recover?null:task.status==='completed'?'任务已完成，无需恢复':'抽象计划尚未保存，请从当前来源阶段继续'};
        }
        let working=clone(pipeline);const released=releasedAttempts(working),current=attempts.filter(a=>!released.has(a.attempt_id)),consumed=[],actions=[];
        let reason=task.status==='completed'?'任务已完成，无需恢复':null;
        for(const call of working.staged.plan.calls){
            const block=working.staged.blocks[call.call_id];if(block?.status==='succeeded')continue;
            const attempt=current.filter(a=>a.call_id===call.call_id).sort((a,b)=>a.sequence-b.sequence).at(-1);
            if(!attempt?.receipt)continue;
            const original=attempt.request?.call,keys=['call_id','stage','scope','dependency_hash','workspace_revision','facts_wire_version','wire_version','reference_encoding'];
            if(!original||keys.some(key=>original[key]!==call[key])||JSON.stringify(original.chunk_ids)!==JSON.stringify(call.chunk_ids)){
                reason='已收回执的计划或依赖已变化，不能采用旧结果或重复发送';continue;
            }
            if(!(block?.attempt_ids??[]).includes(attempt.attempt_id)){
                const checked=applyCreationResponse({...task,status:'running',execution_id:attempt.execution_id},working,attempt.request,attempt,attempt.receipt);
                working=checked.pipeline;consumed.push(attempt.attempt_id);actions.push({call_id:call.call_id,kind:'received',attempt_id:attempt.attempt_id});
            }else if(attempt.status==='received')consumed.push(attempt.attempt_id);
        }
        working=revalidateCreationFacts(task,working,current).pipeline;
        for(const call of working.staged.plan.calls){
            const block=working.staged.blocks[call.call_id];if(block?.status==='succeeded')continue;
            const attempt=current.filter(a=>a.call_id===call.call_id).sort((a,b)=>a.sequence-b.sequence).at(-1);
            if(attempt?.status==='reserved'&&!attempt.receipt){actions.push({call_id:call.call_id,kind:'reserved',attempt_id:attempt.attempt_id});continue}
            if(['unknown','requested'].includes(block?.status)||attempt?.receipt?.unknown||attempt?.status==='dispatched'&&!attempt.receipt){actions.push({call_id:call.call_id,kind:'unknown',attempt_id:attempt?.attempt_id??null});continue}
            if(block?.status==='failed')actions.push({call_id:call.call_id,kind:'failed',attempt_id:attempt?.attempt_id??null});
        }
        const totals=summarizeCreationBlocks(working,current),unknown=actions.filter(a=>a.kind==='unknown').length;
        // A reservation is a durable proof that dispatch has not yet been registered.
        const reserved=actions.filter(a=>a.kind==='reserved').length;
        const summary={...totals.summary,unknown:Math.max(unknown,totals.summary.unknown-reserved),reserved};
        return {pipeline:working,summary,blockers:totals.blockers,actions,consumed,can_recover:task.status!=='completed'&&!reason,needs_recovery:!ordinaryContinue.has(task.status),requires_unknown_confirmation:unknown>0,reason};
    }
    async function getProgress(runId,{scope,isCurrent=()=>true}={}){
        return db.transaction('r',db.creationRuns,db.creationPipelines,db.creationAttempts,db.bindings,async()=>{
            const task=await db.creationRuns.get(runId);
            if(!task)throw creationError('missing-task','该资料任务暂未读到');
            const binding=scope===undefined?null:await db.bindings.get(scope);
            if(!isCurrent()||scope!==undefined&&(task.scope!==scope||binding?.pending_run_id!==runId))throw creationError('stale-task','聊天或任务已变化，未读取旧任务进度');
            const pipeline=await db.creationPipelines.get(runId),attempts=await db.creationAttempts.where('run_id').equals(runId).toArray();
            if(task.status==='completed'&&task.audit_cleared&&pipeline?.progress){
                if(!isCurrent())throw creationError('stale-task','聊天或任务已变化，旧任务进度未采用');
                return clone({...pipeline.progress,revision:task.revision,audit_cleared:true});
            }
            const all=[...(pipeline?.staged?.bootstrap?.plan?.calls??[]),...(pipeline?.staged?.plan?.calls??[])];
            const unique=new Map(all.map(call=>[call.call_id,call])),children=new Set(all.filter(call=>call.workspace_batch).flatMap(call=>(call.children??[]).map(child=>child.call_id)));
            const calls=[...unique.values()].filter(call=>!children.has(call.call_id)),blocks=pipeline?.staged?.blocks??{},released=new Set((pipeline?.recoveries??[]).flatMap(row=>row.released_attempt_ids??[]));
            const latest=new Map();
            for(const attempt of attempts)if(!released.has(attempt.attempt_id)&&(!latest.has(attempt.call_id)||latest.get(attempt.call_id).sequence<attempt.sequence))latest.set(attempt.call_id,attempt);
            const state=call=>{
                const block=blocks[call.call_id],attempt=latest.get(call.call_id);
                if(block?.status==='succeeded')return 'saved';
                if(attempt?.receipt?.unknown||block?.status==='unknown')return 'unknown';
                if(attempt?.receipt?.ok===false)return 'failed';
                if(attempt&&['reserved','dispatched','received'].includes(attempt.status))return 'running';
                if(block?.status==='requested')return 'unknown';
                if(block?.status==='failed')return 'failed';
                return 'pending';
            };
            const count=list=>{const value={total:list.length,saved:0,failed:0,unknown:0,running:0,pending:0};for(const call of list)value[state(call)]++;return value};
            const counts=count(calls),stage=(calls.find(call=>state(call)!=='saved')??calls.at(-1))?.stage??task.phase;
            const failures=[];
            for(const [index,call] of calls.entries()){
                if(state(call)!=='failed')continue;
                const block=blocks[call.call_id],attempt=latest.get(call.call_id),failure=attempt?.receipt?.failure;
                const message=attempt?.receipt?.ok===false
                    ? failure?.message??block?.error?.message
                    : block?.error?.message??failure?.message;
                failures.push({call_id:call.call_id,index:index+1,stage:call.stage,attempt_id:attempt?.attempt_id??block?.attempt_ids?.at(-1)??null,
                    message:redactText(String(message??(failure?.status?'HTTP '+failure.status:'未保存具体失败原因，请查看该组原回执')))});
            }
            const result={run_id:runId,scope:task.scope,revision:task.revision,stage,totalKnown:!!pipeline,counts:{total:counts.total,succeeded:counts.saved,...counts},stageCounts:count(calls.filter(call=>call.stage===stage)),failures};
            if(!isCurrent())throw creationError('stale-task','聊天或任务已变化，旧任务进度未采用');
            return result;
        });
    }

    async function recoveryPreview(runId,{scope,output_max_tokens=null,isCurrent=()=>true}={}){
        return db.transaction('r',db.creationRuns,db.creationPipelines,db.creationAttempts,db.bindings,async()=>{
            const task=await db.creationRuns.get(runId),binding=task&&await db.bindings.get(task.scope);
            if(!task||task.scope!==scope||binding?.pending_run_id!==runId||!isCurrent())throw creationError('stale-task','聊天或任务已变化，未读取其它任务的恢复状态');
            const pipeline=await db.creationPipelines.get(runId),attempts=await db.creationAttempts.where('run_id').equals(runId).toArray(),view=recoveryState(task,pipeline,attempts);
            if(!isCurrent())throw creationError('stale-task','聊天或任务已变化，旧恢复预览未采用');
            const {pipeline:ignored,consumed,...publicView}=view;
            return {task:clone(task),scope,expected_revision:task.revision,execution_id:task.execution_id,...publicView};
        });
    }
    async function recover(runId,{scope,expected_revision,execution_id,retry_unknown=false,output_max_tokens=null,isCurrent=()=>true}={}){
        return db.transaction('rw',db.creationRuns,db.creationPipelines,db.creationAttempts,db.bindings,async()=>{
            let task=await db.creationRuns.get(runId);const binding=task&&await db.bindings.get(task.scope);
            if(!task||task.scope!==scope||task.revision!==expected_revision||task.execution_id!==execution_id||binding?.pending_run_id!==runId||!isCurrent())throw creationError('stale-task','聊天、任务或执行状态已变化，未恢复旧任务');
            const original=await db.creationPipelines.get(runId),attempts=await db.creationAttempts.where('run_id').equals(runId).toArray(),view=recoveryState(task,original,attempts);
            if(!view.can_recover)throw creationError('recovery-blocked',view.reason??'任务已完成，不能恢复');
            if(!view.needs_recovery)return {task:clone(task),recovered:false,summary:view.summary,actions:view.actions};
            if(view.requires_unknown_confirmation&&retry_unknown!==true)throw creationError('confirmation-required','存在结果未确认的原请求；必须明确同意才会重新发送这些分组，原请求可能仍产生费用');
            const pipeline=view.pipeline;
            if(!pipeline){
                // Only a cancelled preparation with no execution or request evidence reaches here.
                task=transitionCreationTask(task,eventFor(task,'preparation-resumed')).task;
                if(!isCurrent())throw creationError('stale-task','聊天或任务已变化，本次恢复已撤销');
                await db.creationRuns.put(task);
                return {task,recovered:true,summary:view.summary,actions:view.actions};
            }
            const previousExecution=task.execution_id,newExecution=operationId(),released=new Set(view.consumed),changed=[];
            const priorMaxTokens=pipeline.config.max_tokens;
            if(Number.isSafeInteger(output_max_tokens)&&output_max_tokens>0){
                pipeline.config.max_tokens=output_max_tokens;
                if(pipeline.staged.plan?.output_budget)pipeline.staged.plan.output_budget.max_tokens=output_max_tokens;
            }
            for(const action of view.actions){
                if(action.kind==='received')continue;
                if(action.attempt_id)released.add(action.attempt_id);
                const block=pipeline.staged.blocks[action.call_id]??={call_id:action.call_id,status:'pending',result:[],completed_units:[],attempt_count:0,attempt_ids:[],error:null};
                changed.push({call_id:action.call_id,prior_status:block.status,prior_error:clone(block.error??null),prior_failure:clone(block.failure??null),prior_repair_state:clone(block.repair_state??null),prior_retry_from_attempt:block.retry_from_attempt??null});
                block.retry_from_attempt=block.attempt_count??0;block.status='pending';delete block.failure;delete block.context_rejected;
                if(block.repair_state&&!block.repair_state.repair?.length)delete block.repair_state;
            }
            pipeline.recoveries??=[];pipeline.recoveries.push({version:1,recovery_id:newExecution,prior_execution_id:previousExecution,execution_id:newExecution,prior_status:task.status,prior_phase:task.phase,prior_failure:clone(task.failure??null),retry_unknown:retry_unknown===true,prior_max_tokens:priorMaxTokens,max_tokens:pipeline.config.max_tokens,released_attempt_ids:[...released],consumed_attempt_ids:view.consumed,changed_blocks:changed,at:new Date().toISOString()});
            task=transitionCreationTask(task,eventFor(task,'recovery-resumed',{previous_execution_id:previousExecution,new_execution_id:newExecution,phase:pipeline.staged.workspace?'semantic':'foundation'})).task;
            if(!isCurrent())throw creationError('stale-task','聊天或任务已变化，本次恢复已撤销');
            await db.creationPipelines.put({...pipeline,run_id:runId});await db.creationRuns.put(task);
            return {task,recovered:true,new_execution_id:newExecution,summary:view.summary,actions:view.actions};
        });
    }
    async function claim(runId,request,attempt_id,execution_id) {
        return db.transaction('rw',db.creationRuns,db.creationAttempts,db.creationPipelines,async()=>{
            const task=await db.creationRuns.get(runId);
            if(task?.status!=='running'||task.execution_id!==execution_id)throw creationError('stale-task','该执行已停止或变化');
            const previous=await db.creationAttempts.where('[run_id+call_id]').equals([runId,request.call.call_id]).toArray();
            const released=releasedAttempts(await db.creationPipelines.get(runId));
            const latest=previous.filter(a=>!released.has(a.attempt_id)).sort((a,b)=>a.sequence-b.sequence).at(-1);
            if(latest&&['reserved','dispatched','received'].includes(latest.status))return {claimed:false,attempt:latest};
            const attempt={attempt_id,run_id:runId,scope:task.scope,snapshot_id:task.snapshot_id,import_id:task.import_id,
                execution_id,call_id:request.call.call_id,sequence:previous.length+1,status:'reserved',request:clone(request),created_at:new Date().toISOString()};
            await db.creationAttempts.add(attempt);return {claimed:true,attempt};
        });
    }
    async function dispatch(attempt_id,summary) {
        return db.transaction('rw',db.creationRuns,db.creationAttempts,async()=>{
            const attempt=await db.creationAttempts.get(attempt_id),task=attempt&&await db.creationRuns.get(attempt.run_id);
            if(!attempt||attempt.status!=='reserved'||task?.status!=='running'||task.execution_id!==attempt.execution_id)throw creationError('dispatch-denied','请求已停止或不再属于本次执行，未发送');
            attempt.status='dispatched';attempt.dispatch=clone(summary);attempt.dispatched_at=new Date().toISOString();
            await db.creationAttempts.put(attempt);return attempt;
        });
    }
    async function receive(attempt_id,receipt) {
        return db.transaction('rw',db.creationAttempts,async()=>{
            const attempt=await db.creationAttempts.get(attempt_id);
            if(!attempt)throw creationError('missing-attempt','请求身份尚未读到');
            if(attempt.audit_cleared)return attempt;
            const digest=sha256Hex(JSON.stringify(receipt));
            if(attempt.receipt){if(attempt.receipt_digest!==digest)throw creationError('immutable-receipt','已收到的回执不能替换');return attempt;}
            if(receipt.sent&&attempt.status!=='dispatched')throw creationError('receipt-without-dispatch','回执缺少对应发送登记');
            attempt.receipt=clone(receipt);attempt.receipt_digest=digest;attempt.status='received';attempt.received_at=new Date().toISOString();
            await db.creationAttempts.put(attempt);return attempt;
        });
    }
    async function saveLate(attempt_id,evidence) {
        return db.transaction('rw',db.creationAttempts,async()=>{
            const attempt=await db.creationAttempts.get(attempt_id);
            if(!attempt)throw creationError('missing-attempt','迟到回执缺少原请求身份');
            if(attempt.audit_cleared)return attempt;
            const digest=sha256Hex(JSON.stringify(evidence));
            if((attempt.late_evidence??[]).some(e=>e.digest===digest))return attempt;
            attempt.late_evidence=[...(attempt.late_evidence??[]),{digest,value:clone(evidence)}];
            await db.creationAttempts.put(attempt);return attempt;
        });
    }
    async function consume(attempt_id) {
        return db.transaction('rw',db.creationRuns,db.creationAttempts,db.creationPipelines,async()=>{
            const attempt=await db.creationAttempts.get(attempt_id),task=attempt&&await db.creationRuns.get(attempt.run_id);
            if(attempt?.audit_cleared&&task?.status==='completed')return task;
            if(!attempt?.receipt)throw creationError('receipt-not-saved','回执尚未保存，不能继续');
            if(attempt.status==='applied'||task?.status!=='running'||task.execution_id!==attempt.execution_id)return task;
            const pipeline=await db.creationPipelines.get(task.run_id);
            const result=applyCreationResponse(task,pipeline,attempt.request,attempt,attempt.receipt);
            await db.creationPipelines.put({...result.pipeline,run_id:task.run_id});
            await db.creationAttempts.put({...attempt,status:'applied',outcome:result.outcome});
            const done=Object.values(result.pipeline.staged.blocks).filter(b=>b.status==='succeeded').length;
            const total=Math.max(done,result.pipeline.staged.plan.calls.length,task.progress?.total??0);
            const updated=transitionCreationTask(task,eventFor(task,'progress',{done:Math.max(done,task.progress?.done??0),total})).task;
            await db.creationRuns.put(updated);return updated;
        });
    }
    async function diagnostics(runId) {
        return db.transaction('r',db.creationRuns,db.creationSnapshots,db.creationPipelines,db.creationAttempts,async()=>{
            const task=await db.creationRuns.get(runId);if(!task)return null;
            return {protocol:task.protocol,scope:task.scope,task,
                snapshot:await db.creationSnapshots.get(task.snapshot_id),
                pipeline:await db.creationPipelines.get(runId),
                attempts:await db.creationAttempts.where('run_id').equals(runId).toArray()};
        });
    }
    // Only new tasks opt in. Publication and cleanup share one transaction, so a failed
    // save leaves all original process evidence available for explicit recovery.
    async function clearCompletedAudit(task,pipeline){
        const runId=task.run_id,progress=await getProgress(runId,{scope:task.scope});
        const attempts=await db.creationAttempts.where('run_id').equals(runId).toArray();
        const keys=['attempt_id','run_id','call_id','execution_id','scope','snapshot_id','library_id','import_id','sequence','status'];
        const identities=attempts.map(row=>({...Object.fromEntries(keys.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]])),
            outcome:row.outcome==='succeeded'?'succeeded':row.receipt?.unknown?'unknown':row.receipt?'failed':'requested',audit_cleared:true}));
        await db.creationAttempts.bulkPut(identities);
        await db.creationPipelines.put({run_id:runId,items:clone(pipeline.items),progress,audit_cleared:true});
        await db.creationCheckpoints.where('run_id').equals(runId).delete();
        return {...task,audit_cleared:true};
    }
    async function commit(runId) {
        return db.transaction('rw',db.tables,async()=>{
            const task=await db.creationRuns.get(runId),binding=task&&await db.bindings.get(task.scope);
            if(task?.status==='completed')return task;
            if(!task||!['ready_to_commit','save_failed'].includes(task.status))throw creationError('publication-not-ready','完整抽象尚未保存，不能建立世界');
            if(binding?.pending_run_id!==runId)throw creationError('newer-intent','该聊天已开始另一任务，旧结果保持待保存');
            const pipeline=await db.creationPipelines.get(runId),publication=pipeline?.publication;
            if(!publication)throw creationError('publication-missing','已保存的统一世界尚未读到');
            const pointer={world_id:'creation:'+task.run_id,branch_id:'main',revision:0};
            const {world}=initializePlayerWorld(publication,pipeline.config.world);freezeInitialState(world);
            await journal.initialize(pointer,world,{provenance:{creation_run_id:runId,snapshot_id:task.snapshot_id}});
            await db.sourceVersions.put(clone(publication));
            await db.libraries.put({library_id:task.library_id,version:publication.version});
            const input=await db.imports.get([task.library_id,task.import_id]);
            await db.imports.put({...input,publication_receipt:{version:publication.version,pointer,run_id:runId}});
            await db.bindings.put({...binding,state:{connection_id:'browser:'+db.name,pointer,pending:null},user_detached:false});
            let saved=transitionCreationTask(task,eventFor(task,'published',{pointer})).task;
            if(task.cleanup_after_publish===1)saved=await clearCompletedAudit(saved,pipeline);
            await db.creationRuns.put(saved);return saved;
        });
    }

    async function createPrepared(input, { isCurrent = () => true } = {}) {
        const { snapshot, ...identity } = clone(input);
        if (!snapshot || snapshot.scope !== identity.scope || !snapshot.effective_chars || !snapshot.allowed_blocks?.length) throw creationError('empty-source', '当前勾选来源没有有效正文，未建立任务');
        const task = {...preparedCreationTask(identity),cleanup_after_publish:1};
        const { snapshot_id, ...sourceInput } = snapshot;
        if (snapshot_id !== task.snapshot_id) throw creationError('snapshot-mismatch', '来源快照与新任务不一致');
        const inputHash = sha256Hex(JSON.stringify(sourceInput));
        const entries = new Map();
        for (const block of snapshot.allowed_blocks) {
            if (typeof block.sourceId !== 'string' || !block.sourceId || !String(block.text ?? '').trim()) throw creationError('invalid-source', '有效来源块不完整');
            const item = entries.get(block.sourceId);
            if (item) item.content += '\n' + block.text;
            else entries.set(block.sourceId, { source_id: block.sourceId, content: block.text,
                metadata: { title: block.title ?? '', kind: block.kind ?? 'world-entry', snapshot_id: snapshot_id } });
        }
        return db.transaction('rw', db.creationRuns, db.creationSnapshots, db.imports, db.bindings, db.creationCommands, async () => {
            if (!isCurrent()) throw creationError('stale-source', '聊天或勾选来源已变化，本次读取未建立任务');
            const previous = await db.creationCommands.get(identity.command_id);
            if (previous) {
                if (previous.scope !== identity.scope || previous.input_hash !== inputHash) throw creationError('command-conflict', '同一开始操作的来源不能改变，请重新开始');
                return { task: await db.creationRuns.get(previous.run_id), replayed: true };
            }
            await db.creationSnapshots.add(snapshot);
            await db.imports.add({ library_id: task.library_id, import_id: task.import_id, run_id: task.run_id,
                scope: task.scope, snapshot_id: task.snapshot_id, entries: [...entries.values()] });
            await db.creationRuns.add(task);
            const binding = await db.bindings.get(task.scope);
            await db.bindings.put({ ...binding, scope: task.scope, pending_run_id: task.run_id,
                creation_revision: (binding?.creation_revision ?? 0) + 1 });
            await db.creationCommands.add({ command_id: identity.command_id, scope: task.scope, input_hash: inputHash, run_id: task.run_id });
            if (!isCurrent()) throw creationError('stale-source', '聊天或勾选来源已变化，本次登记已回滚');
            return { task, replayed: false };
        });
    }

    async function apply(runId, event, { expected_revision = null } = {}) {
        return db.transaction('rw', db.creationRuns, db.creationCheckpoints, async () => {
            const task = await db.creationRuns.get(runId);
            if (!task) throw creationError('missing-task', '该资料任务暂未读到');
            if (expected_revision !== null && task.revision !== expected_revision) throw creationError('stale-task', '任务已被更新，请重新核对');
            if (event.scope !== task.scope || event.snapshot_id !== task.snapshot_id) throw creationError('wrong-owner', '操作不属于该聊天的资料任务');
            if(task.status==='completed'&&task.audit_cleared&&event.checkpoint!==undefined)return {task,changed:false};
            if (event.checkpoint !== undefined) {
                if (!event.execution_id || event.execution_id !== task.execution_id) throw creationError('wrong-execution', '回执不属于该任务的本次执行');
                const key = [runId, event.execution_id], old = await db.creationCheckpoints.get(key);
                const digest = sha256Hex(JSON.stringify(event.checkpoint));
                if (old && old.digest !== digest) throw creationError('immutable-checkpoint', '已保存的本次执行回执不能改变');
                if (!old) await db.creationCheckpoints.add({ run_id: runId, execution_id: event.execution_id,
                    scope: task.scope, snapshot_id: task.snapshot_id, digest, value: clone(event.checkpoint) });
            }
            const result = transitionCreationTask(task, event);
            if (result.changed) await db.creationRuns.put(result.task);
            return clone(result);
        });
    }
    return { db, journal, begin, plan, revalidateFailed, recoveryPreview, recover, getProgress, claim, dispatch, receive, saveLate, consume, commit, diagnostics, createPrepared, apply, getAttempt:id=>db.creationAttempts.get(id), getPipeline:id=>db.creationPipelines.get(id), getCheckpoint: (run, execution) => db.creationCheckpoints.get([run, execution]), getRun: id => db.creationRuns.get(id), getSnapshot: id => db.creationSnapshots.get(id),
        getImport: (library, id) => db.imports.get([library, id]), readBinding: scope => db.bindings.get(scope),
        close: () => db.close() };
}
