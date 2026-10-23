import {evaluateSourceJobProposal,applySourceJobCorrections,sourceJobCorrectionPrompt} from '../src/source-job-recovery.js';
import {SOURCE_JOB_PROTOCOL,SOURCE_SEMANTIC_PROTOCOL,buildSourceJobPlan,sourceJobPrompt,sourceJobResponseFormat,sourceJobResponseSchema,validateSourceJobResponse,completeSourceJobs} from '../src/source-jobs.js';
import {SOURCE_GROUP_PROTOCOL,buildSourceGroupPlan,sourceGroupPrompt,sourceGroupResponseFormat,validateSourceGroupResponse,completeSourceIdentityGroup} from '../src/source-groups.js';
import {validateSourceRecords} from '../src/source-records.js';
import {SOURCE_FIELD_PROTOCOL,collectFieldCandidates,fieldCandidateRevision} from '../src/source-field-table.js';
import {SOURCE_MERGE_PROTOCOL,buildIdentityReview,buildFieldReview,semanticMergePrompt,semanticMergeResponseFormat,validateSemanticDecision,applyFieldDecisions} from '../src/source-semantic-merge.js';
import {SOURCE_FINALIZATION_PROTOCOL,buildFinalizationPlan,collectedFinalizationClaims,finalizationCall,finalizationPrompt,finalizationResponseFormat,validateFinalizationResponse,assembleFinalizationDraft} from '../src/source-finalization.js';
import {SOURCE_WORKSPACE_PROTOCOL,createSourceWorkspace,buildWorkspacePlan,workspaceDirectoryCall,workspaceTaskCalls,workspaceFieldCoverage,workspaceCallCurrent,workspacePrompt,workspaceResponseFormat,validateWorkspaceResponse,commitWorkspaceDirectory,assembleWorkspaceDraft} from '../src/source-workspace.js';
import {currentWorkspaceResult,validateWorkspacePublicationDraft} from '../src/finalized-source.js';
import {workspaceCollectionCalls,acceptWorkspaceCollection} from '../src/source-workspace.js';
import {responseContractPrompt,correctionReceipt,responseContractHash} from '../src/source-response-contract.js';
import {workspaceTaskBatches,workspaceInputSourceChars} from '../src/source-workspace.js';
import {collectWorkspaceFields} from '../src/source-field-candidates.js';
import {workspaceRoundAttempts,isConfirmedOutputTruncation,DIRECTORY_REFERENCE_ENCODING,COLLECTION_REFERENCE_ENCODING} from '../src/source-workspace.js';
// Durable staged source abstraction orchestrator. It owns the persisted stage plan, per-call
// checkpoints, the three-call retry budget, resume and cancellation. All model I/O happens between
// transactions; every durable write is a single row mutation through the host's `change` helper.
import { operationId } from '../src/browser-capabilities.js';
import { parseModelJson } from '../src/model-json.js';
import {
    MAX_STAGE_ATTEMPTS, modeStagePlan, planStageCalls, chunkContent,
    stagePrompt, stageResponseFormat, validateStageResponse,
    mergeIdentityCandidates, mergeAttributeCandidates, mergeRelationCandidates,
    mergeSettingCandidates, assembleStagedRecords, deriveOutputBudget, DEFAULT_STAGE_CHUNK_CHARS,
} from '../src/source-stages.js';

export function canReassembleSourceImport(row){
 const staged=row?.staged,calls=staged?.plan?.calls;
 return row?.status==='failed'&&staged?.status==='failed'&&[SOURCE_SEMANTIC_PROTOCOL,SOURCE_FIELD_PROTOCOL].includes(staged.protocol)&&[SOURCE_SEMANTIC_PROTOCOL,SOURCE_FIELD_PROTOCOL].includes(staged.plan?.protocol)&&staged.failure?.stage==='assembly'&&row.execution?.running!==true&&Array.isArray(calls)&&calls.length>0&&calls.every(call=>{const b=staged.blocks?.[call.call_id];return b?.status==='succeeded'&&Array.isArray(b.result)&&call.units.every(unit=>b.completed_units?.includes(unit));});
}
import {sourceProgressSnapshot} from './source-progress.js';
const STAGE_DONE = new Set(['succeeded']);

function findAttempt(row, attemptId) {
    if (!attemptId) return null;
    return (row.execution?.attempts ?? []).find(attempt => attempt.attempt_id === attemptId) ?? null;
}

function lastAttempt(row, block) {
    return findAttempt(row, block?.attempt_ids?.at?.(-1) ?? (block?.attempt_ids ?? [])[block.attempt_ids.length - 1]);
}

function blockMap(row) {
    row.staged.blocks ??= {};
    return row.staged.blocks;
}

/** Build the frozen stage plan for one import. Pure; callers persist the result. */
export function buildStagePlan(entries, mode, { chunkChars = DEFAULT_STAGE_CHUNK_CHARS, outputBudget = null } = {}) {
    const stages = modeStagePlan(mode);
    const calls = planStageCalls(entries, { chunkChars, stages, maxTokens: outputBudget?.max_tokens });
    return {
        chunk_chars: calls.chunk_chars,
        stages,
        stage_budgets: calls.stage_budgets,
        chunks: calls.chunks,
        calls: calls.calls,
        output_budget: outputBudget ?? deriveOutputBudget(null),
    };
}

export function createStagedRunner(runtime) {
    const {
        change:durableChange, readImport, terminal, copy, error, notify, model, clientId,
        controllers, liveClients, ownerKey, failureText, stagedExecutions, executionKey, isAttemptLive,
        resolveConfig, resolveOutputBudget, maxAttempts = MAX_STAGE_ATTEMPTS,
    } = runtime;

    const receiving=new Set(),progressCache=new Map();
    function reportProgress(snapshot){
        if(!snapshot)return;const key=JSON.stringify([snapshot.library_id,snapshot.import_id]),previous=progressCache.get(key);
        if(JSON.stringify(previous)===JSON.stringify(snapshot))return;
        progressCache.set(key,snapshot);notify(snapshot);
    }
    async function change(libraryId,importId,fn){
        let snapshot;
        const result=await durableChange(libraryId,importId,row=>{const value=fn(row);snapshot=sourceProgressSnapshot(row,receiving);return value;});
        reportProgress(snapshot);return result;
    }
    function reportReceiving(libraryId,importId,attemptId){
        if(receiving.has(attemptId))return;
        const key=JSON.stringify([libraryId,importId]),last=progressCache.get(key);
        const call=last?.attempts.find(a=>a.status==='requested'&&a.call_id===controllers.get(attemptId)?.callId);
        if(!last||last.phase!=='extract'||!call)return;
        receiving.add(attemptId);reportProgress({...last,waiting:Math.max(0,last.waiting-1),receiving:last.receiving+1});
    }
    function ensureBlock(block, call) {
        block.call_id = call.call_id;
        block.stage = call.stage;
        block.scope = call.scope;
        block.chunk_ids = [...call.chunk_ids];
        block.status = 'pending';
        block.attempt_count = 0;
        block.attempt_ids ??= [];
        block.result ??= null;
        block.error ??= null;
        return block;
    }

    async function createBlock(libraryId, importId, call) {
        return change(libraryId, importId, row => {
            if (terminal(row) || row.staged?.status==='failed' || !row.staged) return row;
            const blocks = blockMap(row);
            if (!blocks[call.call_id]) blocks[call.call_id] = ensureBlock({}, call);
            return row;
        });
    }

    async function claimCall(libraryId, importId, call) {
        return change(libraryId, importId, row => {
            if (terminal(row) || row.staged?.status==='failed' || !row.staged) return { claimed: false, terminal: true };
            if(call.workspace&&!workspaceCallCurrent(row,call))return {claimed:false,status:'superseded'};
            const block = blockMap(row)[call.call_id] ?? (blockMap(row)[call.call_id] = ensureBlock({}, call));
            if (block.status === 'succeeded' || block.status === 'unknown' || block.status === 'cancelled') return { claimed: false, status: block.status };
            if (block.status === 'received' || block.status === 'requested') return { claimed: false, status: block.status };
            if (workspaceRoundAttempts(block) >= maxAttempts) { block.status='failed';block.error ??= { stage: 'budget', message: `stage block exhausted ${maxAttempts} calls` }; return { claimed: false, exhausted: true }; }
            const attemptId = operationId();
            block.status = 'requested';
            block.attempt_count += 1;
            block.attempt_ids.push(attemptId);
            row.execution.attempts.push({
                attempt_id: attemptId, kind: 'staged', call_id: call.call_id, stage: block.stage, scope: block.scope,
                chunk_ids: [...call.chunk_ids], client_id: clientId, started_at:Date.now(),outcome: 'requested', response: null, usage: null, error: null,...(block.authorized_correction?{correction_request_id:block.authorized_correction.request_id}:{}),
            });
            return { claimed: true, attempt_id: attemptId, attempt_count: block.attempt_count };
        });
    }

    async function saveResponse(libraryId, importId, callId, attemptId, response, usage, receipt = {}) {
        return change(libraryId, importId, row => {
            const block = blockMap(row)[callId];
            const attempt = findAttempt(row, attemptId);
            if (!block || !attempt) throw error('staged response has no durable claim');
            if (attempt.response !== null && attempt.response !== undefined) {
                if (JSON.stringify(attempt.response) !== JSON.stringify(response)) throw error('staged response immutable');
            }
            attempt.response = copy(response);
            attempt.received_at=Date.now();attempt.response_chars=Array.from(typeof response==='string'?response:JSON.stringify(response)).length;
            attempt.usage = usage === undefined ? null : copy(usage);
            if (typeof receipt.provider_response === 'string') attempt.provider_response = receipt.provider_response;
            if (receipt.failure) {
                attempt.failure = copy(receipt.failure);
                if([SOURCE_JOB_PROTOCOL,SOURCE_SEMANTIC_PROTOCOL,SOURCE_FIELD_PROTOCOL].includes(row.staged.plan.protocol)&&['network','stream-incomplete'].includes(receipt.failure.type))block.transport_mode='nonstream';
                attempt.error = { stage: 'transport', message: receipt.failure.message };
                attempt.outcome = receipt.unconfirmed?'unknown':'failed';
                if(receipt.unconfirmed)attempt.unconfirmed=true; // Runtime failure remains within the approved retry budget.
                if (!terminal(row) && row.staged.status!=='failed') {block.status = attempt.outcome;block.error=attempt.error;}
            } else {
                attempt.outcome = 'received';
                if (!terminal(row) && row.staged.status!=='failed') block.status = 'received';
            }
            if (terminal(row)) block.status = 'cancelled';
            return row;
        });
    }


    // Settle the exact claim, even if its parent has already failed. Preserve receipts and errors.
    function settleUnfinishedAttempt(attempt,sent=true){
        if(!attempt||attempt.outcome!=='requested')return false;
        const certainFailure=attempt.failure&&!attempt.unconfirmed&&!['cancelled','network','timeout','stream-incomplete'].includes(attempt.failure.type);
        attempt.outcome=attempt.response!=null?(attempt.failure?(certainFailure?'failed':'unknown'):'received'):!sent?'cancelled':certainFailure?'failed':'unknown';
        if(attempt.outcome==='unknown')attempt.unconfirmed=true;
        attempt.error??={stage:'model',message:sent?'任务已结束，此请求未取得可确认回执':'任务已结束，此请求尚未发送'};
        return true;
    }

    async function markBlock(libraryId, importId, callId, stage, message, outcome = 'failed') {
        return change(libraryId, importId, row => {
            const block = blockMap(row)[callId];
            if (terminal(row) || row.staged?.status==='failed' || !block || block.status === 'succeeded') return row;
            block.status = outcome;
            block.error = { stage, message };
            const attempt = lastAttempt(row, block);
            if (attempt) { attempt.error = { stage, message }; attempt.outcome = outcome; }
            return row;
        });
    }

    async function applyResult(libraryId, importId, call, directory, {preserveAttempt=false}={}) {
        let row = await readImport(libraryId, importId);
        if (terminal(row) || row.staged?.status==='failed') return 'cancelled';
        const block = row.staged.blocks[call.call_id];
        if (!block) return 'failed';
        if (block.status === 'succeeded') return 'succeeded';
        const attempt = lastAttempt(row, block);
        if (attempt?.failure) {
            await markBlock(libraryId, importId, call.call_id, 'transport', attempt.failure.message, attempt.outcome === 'unknown' ? 'unknown' : 'failed');
            return attempt.outcome === 'unknown' ? 'unknown' : 'failed';
        }
        let protocol;
        try { protocol = typeof attempt.response === 'string' ? parseModelJson(attempt.response) : attempt.response; }
        catch (cause) { if(!preserveAttempt)await markBlock(libraryId, importId, call.call_id, 'validation', cause.message); return 'failed'; }
        try {
            if(call.workspace){
                const checked=validateWorkspaceResponse(row,call,protocol,{referenceEncoding:attempt.request?.reference_encoding,wireVersion:attempt.request?.wire_version});
                return await change(libraryId,importId,current=>{
                    if(terminal(current)||current.staged.status==='failed')return 'cancelled';
                    if(preserveAttempt&&!workspaceCallCurrent(current,call))return 'superseded';
                    const target=current.staged.blocks[call.call_id];
                    if(lastAttempt(current,target)?.attempt_id!==attempt.attempt_id)return 'busy';
                    target.result=[copy(checked)];target.completed_units=[...call.units];target.status='succeeded';target.error=null;
                    const saved=findAttempt(current,attempt.attempt_id);
                    if(preserveAttempt){target.revalidated_receipts??=[];if(!target.revalidated_receipts.some(r=>r.attempt_id===attempt.attempt_id))target.revalidated_receipts.push({attempt_id:attempt.attempt_id,at:Date.now(),validation:'directory-owned-relation-id',contract_hash:responseContractHash(workspaceResponseFormat(call,current))});}
                    else {saved.outcome='succeeded';saved.normalized_proposal=copy(checked);}
                    if(call.workspace_batch)for(const child of call.children){const target=current.staged.blocks[child.call_id]??={call_id:child.call_id,stage:child.stage,scope:child.scope,attempt_count:0,attempt_ids:[]};target.result=[copy(checked.results.find(r=>r.call_id===child.call_id).result)];target.completed_units=[...child.units];target.status='succeeded';target.error=null;target.batch_receipt_id=attempt.attempt_id;}
                    if(!preserveAttempt&&(call.stage==='draft-entity'||call.stage==='draft-relation'))saved.superseded=!workspaceTaskCalls(current).some(c=>c.call_id===call.call_id);
                    return 'succeeded';
                });
            }
            if(call.finalization){
                const checked=validateFinalizationResponse(row,call,protocol);
                return await change(libraryId,importId,current=>{
                    if(terminal(current)||current.staged.status==='failed')return 'cancelled';
                    const target=current.staged.blocks[call.call_id];
                    if(lastAttempt(current,target)?.attempt_id!==attempt.attempt_id)return 'busy';
                    target.result=[copy(checked)];target.completed_units=[...call.units];target.status='succeeded';target.error=null;
                    const saved=findAttempt(current,attempt.attempt_id);saved.outcome='succeeded';saved.normalized_proposal=copy(checked);
                    return 'succeeded';
                });
            }
            if(call.semantic_merge){
                const plan=row.staged.semantic_merge.phases[call.merge_kind],group=plan.groups.find(g=>g.id===call.group_id);
                const decision=validateSemanticDecision(group,protocol,plan);
                return await change(libraryId,importId,current=>{
                    const target=current.staged.blocks[call.call_id];
                    if(terminal(current)||current.staged.status==='failed')return 'cancelled';
                    if(lastAttempt(current,target)?.attempt_id!==attempt.attempt_id)return 'busy';
                    target.result=[copy(decision)];target.completed_units=['M'];target.status='succeeded';target.error=null;
                    const saved=findAttempt(current,attempt.attempt_id);saved.outcome='succeeded';saved.normalized_proposal=copy(decision);return 'succeeded';
                });
            }
            const chunkById = new Map(row.staged.plan.chunks.map(chunk => [chunk.chunk_id, chunk]));
            const chunks = call.chunk_ids.map(id => chunkById.get(id));
            const knownIds = (directory ?? row.staged.directory ?? []).map(entry => entry.id);
            const kindById = new Map((directory ?? row.staged.directory ?? []).map(entry => [entry.id, entry.kind]));
            if(['source-jobs-v1','source-jobs-v2','source-jobs-v3',SOURCE_JOB_PROTOCOL,SOURCE_SEMANTIC_PROTOCOL,SOURCE_FIELD_PROTOCOL].includes(row.staged.plan.protocol)){
                const pendingUnits=call.units.filter(unit=>!(block.completed_units??[]).includes(unit));
                const context={chunks,allChunks:row.staged.plan.chunks,mode:row.staged.mode,pendingUnits};
                const candidate=block.repair_state?applySourceJobCorrections(call,block.repair_state,protocol,{sourceItems:block.repair_source_items??[]}):protocol;
                const checked=[SOURCE_JOB_PROTOCOL,SOURCE_SEMANTIC_PROTOCOL,SOURCE_FIELD_PROTOCOL].includes(row.staged.plan.protocol)?evaluateSourceJobProposal(call,candidate,context):validateSourceJobResponse(call,candidate,context);
                return await change(libraryId,importId,current=>{
                    const target=current.staged.blocks[call.call_id];
                    if(terminal(current)||current.staged.status==='failed')return 'cancelled';
                    if(lastAttempt(current,target)?.attempt_id!==attempt.attempt_id)return 'busy';
                    target.result=[...(target.result??[]),...checked.records];
                    if(checked.fieldCandidates)target.field_candidates=copy(checked.fieldCandidates);
                    target.completed_units=[...new Set([...(target.completed_units??[]),...checked.passedUnits])];
                    const problems=Object.entries(checked.errors??{});
                    const done=call.units.every(unit=>target.completed_units.includes(unit));
                    target.status=done?'succeeded':'failed';
                    target.error=done?null:{stage:'validation',message:problems.map(([unit,message])=>unit+': '+message).join('; ')||'scope incomplete'};
                    const saved=findAttempt(current,attempt.attempt_id);saved.outcome=target.status;saved.error=target.error;saved.completed_units=checked.passedUnits;
                    if(checked.proposal){saved.normalized_proposal=copy(checked.proposal);saved.projections=copy(checked.projections??[]);
                        if(done){target.repair_state=null;target.repair_source_items=null;}
                        else{const remaining=call.units.filter(unit=>!target.completed_units.includes(unit));const arrays=remaining.flatMap(unit=>unit==='IR'?['identities','relations']:unit==='P'?['properties']:['settings']);
                            const proposal={coverage:checked.proposal.coverage,...Object.fromEntries(arrays.map(key=>[key,checked.proposal[key]])),...(call.field_review&&call.stage==='facts'?{field_candidates:checked.proposal.field_candidates}:{})};target.repair_state={proposal:copy(proposal),repair:copy(checked.repair??[]),based_on_attempt:attempt.attempt_id};}
                    }
                    return target.status;
                });
            }
            const records = row.staged.plan.protocol===SOURCE_GROUP_PROTOCOL
                ? validateSourceGroupResponse(call,protocol,{chunks,allChunks:row.staged.plan.chunks,directory:directory??row.staged.directory,mode:row.staged.mode})
                : validateStageResponse(block.stage, block.scope, protocol, { chunks, knownIds, kindById });
            return await change(libraryId, importId, current => {
                const target = current.staged.blocks[call.call_id];
                if(terminal(current))return 'cancelled';
                if(current.staged.status==='failed'||lastAttempt(current,target)?.attempt_id!==attempt.attempt_id)return 'busy';
                if(target.status!=='succeeded'){target.result=records;target.status='succeeded';target.error=null;findAttempt(current,attempt.attempt_id).outcome='succeeded';}
                return 'succeeded';
            });
        } catch (cause) {
            if(!preserveAttempt)await markBlock(libraryId, importId, call.call_id, 'validation', cause.message);
            return 'failed';
        }
    }

    async function runCall(libraryId, importId, call, directory) {
        let row = await readImport(libraryId, importId);
        const previous=call.workspace?correctionReceipt(row,call):null;
        if(call.field_review&&call.units.includes('P')){
            if(!row.staged.field_review?.confirmed)throw error('字段尚未确认，禁止发送属性请求');
            call={...call,field_table:copy(row.staged.field_review.confirmed)};
        }
        if (terminal(row) || row.staged?.status==='failed') return 'cancelled';
        if (!row.staged.blocks[call.call_id]) {
            await createBlock(libraryId, importId, call);
            row = await readImport(libraryId, importId);
            if (terminal(row) || row.staged?.status==='failed') return 'cancelled';
        }
        let block = row.staged.blocks[call.call_id];
        if (block.status === 'succeeded') return 'succeeded';
        if (block.status === 'unknown' || block.status === 'cancelled') return block.status;
        const stored=lastAttempt(row,block);
        if(call.workspace&&block.status==='failed'&&block.error?.stage==='validation'&&stored?.response!=null&&!stored.failure&&!stored.unconfirmed&&workspaceCallCurrent(row,call)){
            const local=await applyResult(libraryId,importId,call,directory,{preserveAttempt:true});
            if(local!=='failed')return local;
            row=await readImport(libraryId,importId);block=row.staged.blocks[call.call_id];
        }
        if (block.status === 'received' || (block.status === 'requested' && lastAttempt(row, block)?.response !== null && lastAttempt(row, block)?.response !== undefined)) {
            return applyResult(libraryId, importId, call, directory);
        }
        if (block.status === 'requested') return 'busy';
        // An empty allowlist cannot produce a valid nonempty patch. Keep the first error,
        // saved proposal and successful units instead of spending the remaining attempts.
        if(block.repair_state&&block.repair_state.repair.length===0)return 'blocked';
        if(block.context_rejected)return 'capacity';
        const outputAttempt=lastAttempt(row,block);
        const desiredEncoding=call.stage==='unify-workspace'?DIRECTORY_REFERENCE_ENCODING:call.reference_encoding===COLLECTION_REFERENCE_ENCODING?COLLECTION_REFERENCE_ENCODING:null;
        const referenceUpgrade=desiredEncoding&&outputAttempt?.request?.reference_encoding!==desiredEncoding&&block.authorized_correction?.reference_encoding===desiredEncoding&&block.authorized_correction.from_attempt_id===outputAttempt?.attempt_id;
        if((call.workspace||row.staged.protocol===SOURCE_WORKSPACE_PROTOCOL)&&isConfirmedOutputTruncation(outputAttempt)&&!referenceUpgrade&&row.staged.plan.output_budget.max_tokens<=(outputAttempt.request?.max_tokens??row.staged.plan.output_budget.max_tokens))return 'capacity';
        if(call.workspace){
            // Character safety bound uses the existing live per-request setting. It is not a
            // tokenizer or a promise about the provider's context window. Never cut source text.
            const limit=(await resolveConfig()).chunk_chars;
            const chars=Array.from(workspacePrompt(row,call,{previous})+JSON.stringify(workspaceResponseFormat(call,row))).length;
            const sourceChars=workspaceInputSourceChars(call);
            // The existing target is source characters. Contract, IDs and correction text are
            // measured separately; they are never subtracted from source coverage or truncated.
            if(Number.isSafeInteger(limit)&&sourceChars>limit){
                await change(libraryId,importId,current=>{if(!terminal(current)&&workspaceCallCurrent(current,call)){current.staged.capacity={call_id:call.call_id,chars,source_chars:sourceChars,limit,message:'本请求完整来源共 '+sourceChars+' 字符，超过当前每包抽取目标 '+limit+'。原文与已收结果保留，请调整既有目标或重新规划；完整提示／契约共 '+chars+' 字符另计，此目标不是模型token容量。'};current.staged.status='pending';current.staged.finalization.status='input_capacity';}return current;});
                return 'capacity';
            }
            await change(libraryId,importId,current=>{if(current.staged.capacity?.call_id===call.call_id)delete current.staged.capacity;return current;});
        }
        if (typeof model !== 'function') throw error('source model interface is unavailable', 503);
        const claim = await claimCall(libraryId, importId, call);
        if (!claim.claimed) {
            if (claim.exhausted) return 'failed';
            if (claim.status === 'succeeded') return 'succeeded';
            if (claim.status === 'unknown' || claim.status === 'cancelled') return claim.status;
            return 'busy';
        }
        let sent=false;
        try{
        row = await readImport(libraryId, importId);
        if (terminal(row) || row.staged?.status==='failed') return 'cancelled';
        block = row.staged.blocks[call.call_id];
        const chunkById = new Map(row.staged.plan.chunks.map(chunk => [chunk.chunk_id, chunk]));
        const entryById = new Map(row.entries.map(entry => [entry.source_id, entry]));
        const items = call.chunk_ids.map(chunkId => {
            const chunk = chunkById.get(chunkId),entry=entryById.get(chunk.source_id);
            const prefix=Array.from(entry.content).slice(0,chunk.offset_start).join('');
            const context_headings=prefix.split(/\r?\n/).filter(line=>/^\s*#{1,6}\s+\S/.test(line));
            return {source_id:chunk.source_id,chunk_id:chunk.chunk_id,offset_start:chunk.offset_start,offset_end:chunk.offset_end,content:chunkContent(entry,chunk),metadata:entry.metadata,context_headings};
        });
        const controller = new AbortController();
        controllers.set(claim.attempt_id, { libraryId, importId, callId: call.call_id, controller });
        for (const item of items) notify({ code: 'source-requested', library_id: libraryId, import_id: importId, source_id: item.source_id, call_id: call.call_id, attempt_id: claim.attempt_id });
        notify({ code: 'source-batch-requested', library_id: libraryId, import_id: importId, stage: block.stage, call_id: call.call_id, chars: call.chars, message: call.semantic_merge?`正在统一跨块${call.merge_kind==='identity'?'身份':'属性'}候选，复用 ${call.chunk_ids.length} 个已保存原文分块`:`阶段 ${block.stage}：一次请求 ${call.chunk_ids.length} 个原文分块` });
        try {
            row = await readImport(libraryId, importId);
            if (terminal(row) || row.staged?.status==='failed') return 'cancelled';
            const options = {
                signal: controller.signal, task: 'source-extraction', stage: block.stage, stage_scope: block.scope,
                onSourceProgress:update=>{if(update?.phase==='receiving'&&!controller.signal.aborted)reportReceiving(libraryId,importId,claim.attempt_id);},
                source_stage: block.stage, chunk_ids: [...call.chunk_ids], library_id: libraryId, import_id: importId,
                call_id: call.call_id, attempt_id: claim.attempt_id,
                ...(call.wire_version?{wire_version:call.wire_version}:{}),
                ...(call.stage==='unify-workspace'?{reference_encoding:DIRECTORY_REFERENCE_ENCODING}:call.reference_encoding?{reference_encoding:call.reference_encoding}:{}),
                onDispatch:summary=>change(libraryId,importId,current=>{const a=findAttempt(current,claim.attempt_id);if(!a)throw error('请求登记已不存在，未发送');a.dispatches??=[];a.dispatches.push(copy(summary));return current;}),
                onPosted:()=>change(libraryId,importId,current=>{const a=findAttempt(current,claim.attempt_id);if(a)a.posted_at=Date.now();return current;}),
                source_max_tokens:row.staged.plan.output_budget.max_tokens,
                source_generation_watch:['source-jobs-v1','source-jobs-v2','source-jobs-v3',SOURCE_JOB_PROTOCOL,SOURCE_SEMANTIC_PROTOCOL,SOURCE_FIELD_PROTOCOL,SOURCE_FINALIZATION_PROTOCOL,SOURCE_WORKSPACE_PROTOCOL].includes(row.staged.plan.protocol),
                source_reasoning_effort:[SOURCE_JOB_PROTOCOL,SOURCE_SEMANTIC_PROTOCOL,SOURCE_FIELD_PROTOCOL,SOURCE_FINALIZATION_PROTOCOL,SOURCE_WORKSPACE_PROTOCOL].includes(row.staged.plan.protocol)?'low':undefined,
                source_stream:[SOURCE_JOB_PROTOCOL,SOURCE_SEMANTIC_PROTOCOL,SOURCE_FIELD_PROTOCOL,SOURCE_FINALIZATION_PROTOCOL,SOURCE_WORKSPACE_PROTOCOL].includes(row.staged.plan.protocol)?block.transport_mode!=='nonstream':undefined,
                response_format: call.workspace?workspaceResponseFormat(call,row):call.finalization?finalizationResponseFormat(call):call.semantic_merge?semanticMergeResponseFormat(row.staged.semantic_merge.phases[call.merge_kind].groups.find(g=>g.id===call.group_id)):['source-jobs-v1','source-jobs-v2','source-jobs-v3',SOURCE_JOB_PROTOCOL,SOURCE_SEMANTIC_PROTOCOL,SOURCE_FIELD_PROTOCOL].includes(row.staged.plan.protocol)
                    ? (row.staged.plan.protocol==='source-jobs-v1'?sourceJobResponseSchema:sourceJobResponseFormat)(call,{pendingUnits:call.units.filter(unit=>!(block.completed_units??[]).includes(unit)),repair:block.repair_state?.repair})
                    : row.staged.plan.protocol===SOURCE_GROUP_PROTOCOL
                    ? sourceGroupResponseFormat(call,{items,directory,chunks:row.staged.plan.chunks,mode:row.staged.mode})
                    : stageResponseFormat(block.stage, block.scope, call.chunk_ids,{directory,items}),
                extractor_key: row.extractor_key,
            };
            let basePrompt = call.workspace?workspacePrompt(row,call,{previous}):call.finalization?finalizationPrompt(row,call):call.semantic_merge?semanticMergePrompt(row.staged.semantic_merge.phases[call.merge_kind].groups.find(g=>g.id===call.group_id),row.staged.semantic_merge.phases[call.merge_kind]):['source-jobs-v1','source-jobs-v2','source-jobs-v3',SOURCE_JOB_PROTOCOL,SOURCE_SEMANTIC_PROTOCOL,SOURCE_FIELD_PROTOCOL].includes(row.staged.plan.protocol)
                ? sourceJobPrompt(call,{items,chunks:row.staged.plan.chunks,mode:row.staged.mode,pendingUnits:call.units.filter(unit=>!(block.completed_units??[]).includes(unit)),error:block.error?.message,globalContext:call.stage==='properties'?row.staged.semantic_merge?.shared_context:null})
                : row.staged.plan.protocol===SOURCE_GROUP_PROTOCOL
                ? sourceGroupPrompt(call,{items,directory,chunks:row.staged.plan.chunks,mode:row.staged.mode})
                : stagePrompt(block.stage, block.scope, { items, directory });
            if(row.staged.protocol===SOURCE_WORKSPACE_PROTOCOL&&!call.workspace)basePrompt=responseContractPrompt(basePrompt,options.response_format);
            const prompt=block.repair_state?sourceJobCorrectionPrompt(call,block.repair_state,{sourcePrompt:basePrompt,responseFormat:options.response_format}):basePrompt;
            if(block.repair_state){await change(libraryId,importId,current=>{current.staged.blocks[call.call_id].repair_source_items=copy(items.map(item=>({...item,ref:chunkById.get(item.chunk_id)?.ref})));return current;});}
            await change(libraryId,importId,current=>{const saved=findAttempt(current,claim.attempt_id);if(saved){saved.transport_mode=options.source_stream===false?'nonstream':'stream';saved.model_invoked_at=Date.now();saved.input_chars=Array.from(prompt).length;saved.contract_chars=Array.from(JSON.stringify(options.response_format)).length;saved.contract_hash=responseContractHash(options.response_format);saved.request=Object.fromEntries(Object.entries({prompt,response_format:copy(options.response_format),max_tokens:options.source_max_tokens,stream:options.source_stream,reasoning_effort:options.source_reasoning_effort,reference_encoding:options.reference_encoding,wire_version:options.wire_version}).filter(([,value])=>value!==undefined));if(previous)saved.corrects_attempt_id=previous.attempt_id;}return current;});
            sent=true;const result = await model(prompt, options);
            const raw = typeof result === 'string' ? result : (result?.text ?? result?.response);
            if (raw === undefined || raw === null) throw new TypeError('model returned no stage response');
            const receipt = { ...(typeof result?.provider_response === 'string' ? { provider_response: result.provider_response } : {}), ...(result?.failure ? { failure: result.failure, unconfirmed: result.unconfirmed === true } : {}) };
            await saveResponse(libraryId, importId, call.call_id, claim.attempt_id, raw, result?.usage ?? null, receipt);
            if (result?.failure) {
                const latest = await readImport(libraryId, importId);
                if((call.workspace||latest.staged.protocol===SOURCE_WORKSPACE_PROTOCOL)&&isConfirmedOutputTruncation(findAttempt(latest,claim.attempt_id))){
                    await change(libraryId,importId,current=>{const active=call.workspace?workspaceCallCurrent(current,call):current.staged.plan?.calls.some(c=>c.call_id===call.call_id);if(!terminal(current)&&active){current.staged.capacity={call_id:call.call_id,provider_output_truncated:true,max_tokens:options.source_max_tokens,message:'模型输出在 '+options.source_max_tokens+' token 上限被截断；原文与成功结果保留，请提高现有抽取输出上限后明确继续，不会同预算自动重发。'};current.staged.status='pending';current.staged.finalization??={protocol:SOURCE_WORKSPACE_PROTOCOL};current.staged.finalization.status='input_capacity';}return current;});
                    return 'capacity';
                }
                const outcome = latest.staged.blocks[call.call_id]?.status;
                return outcome === 'unknown' ? 'unknown' : 'failed';
            }
            return applyResult(libraryId, importId, call, directory);
        } catch (cause) {
            const latest = await readImport(libraryId, importId).catch(() => null);
            if (!latest || terminal(latest)) return 'unknown';
            const attempt = findAttempt(latest, claim.attempt_id);
            if (attempt?.failure) return attempt.outcome === 'unknown' ? 'unknown' : 'failed';
            if (attempt?.response !== null && attempt?.response !== undefined) return applyResult(libraryId, importId, call, directory);
            if(cause.sw2CallFailure){await change(libraryId,importId,current=>{const saved=findAttempt(current,claim.attempt_id),target=current.staged.blocks[call.call_id];if(saved){saved.failure={type:cause.sw2CallFailure.type,message:failureText(cause,controller.signal.aborted)};if(['network','timeout'].includes(cause.sw2CallFailure.type))saved.unconfirmed=true;}if(target&&[SOURCE_JOB_PROTOCOL,SOURCE_SEMANTIC_PROTOCOL,SOURCE_FIELD_PROTOCOL].includes(current.staged.plan.protocol)&&cause.sw2CallFailure.type==='network')target.transport_mode='nonstream';return current;});}
            const unresolved = sent
                && (!cause.sw2CallFailure || ['network', 'timeout', 'stream-incomplete', 'cancelled'].includes(cause.sw2CallFailure.type));
            if (unresolved) await change(libraryId, importId, current => {
                const saved = findAttempt(current, claim.attempt_id);
                if (saved) saved.unconfirmed = true;
                return current;
            });
            const outcome = unresolved ? 'unknown' : 'failed';
            await markBlock(libraryId, importId, call.call_id, 'model', failureText(cause, controller.signal.aborted), outcome);
            if((call.workspace||row.staged.protocol===SOURCE_WORKSPACE_PROTOCOL)&&cause.sw2ContextLength&&cause.sw2CallFailure?.type==='http'){
                await change(libraryId,importId,current=>{const currentCall=call.workspace?workspaceCallCurrent(current,call):current.staged.protocol===SOURCE_WORKSPACE_PROTOCOL&&current.staged.plan?.calls.some(c=>c.call_id===call.call_id);if(!terminal(current)&&currentCall){current.staged.blocks[call.call_id].context_rejected=true;current.staged.capacity={call_id:call.call_id,provider_context_rejected:true,message:'模型接口明确拒绝了本次上下文长度；本请求不自动重发，原文与已收回执保留。提高每包字符目标不能解决模型容量不足，需先核实际模型容量及新的请求方案。'};current.staged.status='pending';current.staged.finalization.status='input_capacity';}return current;});
                return 'capacity';
            }
            return outcome;
        } finally {
            receiving.delete(claim.attempt_id);controllers.delete(claim.attempt_id);
        }
        } finally {
            const latest=await readImport(libraryId,importId);
            if(findAttempt(latest,claim.attempt_id)?.outcome==='requested')await change(libraryId,importId,current=>{
                const attempt=findAttempt(current,claim.attempt_id);
                if(settleUnfinishedAttempt(attempt,sent)){
                    const block=current.staged.blocks[call.call_id];
                    if(block?.status==='requested'&&lastAttempt(current,block)?.attempt_id===claim.attempt_id){block.status=attempt.outcome;block.error??=attempt.error;}
                }
                return current;
            });
        }
    }

    async function completeStage(libraryId, importId, stage, scope) {
        return change(libraryId, importId, row => {
            if (terminal(row) || row.staged.completed?.includes(stage)) return row;
            const plan = row.staged.plan;
            const results = [];
            if(plan.calls.filter(c=>c.stage===stage).some(c=>row.staged.blocks[c.call_id]?.status!=='succeeded'))throw error('stage is incomplete');
            for (const call of plan.calls.filter(entry => entry.stage === stage)) results.push(...(row.staged.blocks[call.call_id]?.result ?? []));
            if(stage==='identities-attributes'){
                const merged=completeSourceIdentityGroup(results);
                row.staged.directory=merged.directory;row.staged.ambiguous_aliases=merged.ambiguous;
                row.staged.attribute_fields=[...merged.byId.values()].map(entry=>({id:entry.id,fields:[...entry.fields],refs:entry.refs}));
                row.staged.attribute_conflicts=merged.conflicts;
            }else if(stage==='relations-setting'){
                row.staged.relations=mergeRelationCandidates(results.filter(r=>r.stage==='relations'));
                row.staged.settings=mergeSettingCandidates(results.filter(r=>r.stage==='setting'));
            }else if (stage === 'identities') {
                const merged = mergeIdentityCandidates(results);
                row.staged.directory = merged.directory;
                row.staged.ambiguous_aliases = merged.ambiguous;
            } else if (stage === 'attributes') {
                const merged = mergeAttributeCandidates(row.staged.directory ?? [], results);
                row.staged.attribute_fields = [...merged.byId.values()].map(entry => ({ id: entry.id, fields: [...entry.fields], refs: entry.refs }));
                row.staged.attribute_conflicts = merged.conflicts;
            } else if (stage === 'relations') {
                row.staged.relations = mergeRelationCandidates(results);
            } else {
                row.staged.settings = mergeSettingCandidates(results);
            }
            row.staged.completed = [...(row.staged.completed ?? []), stage];
            row.staged.scopes ??= {};
            row.staged.scopes[stage] = scope;
            return row;
        });
    }

    async function finalize(libraryId, importId) {
        return change(libraryId, importId, row => {
            if (terminal(row) || row.staged.status === 'succeeded') return row;
            const fields = new Map((row.staged.attribute_fields ?? []).map(entry => [entry.id, { fields: new Map(entry.fields), refs: entry.refs ?? [] }]));
            const assembled = assembleStagedRecords({
                mode: row.staged.mode,
                directory: row.staged.directory ?? [],
                fields,
                relations: row.staged.relations ?? [],
                settings: row.staged.settings ?? [],
            });
            validateSourceRecords(assembled.records.map(({refs,...record})=>record));
            const plan = row.staged.plan;
            row.staged.diagnostics = {
                chunk_chars: plan.chunk_chars,
                output_budget: plan.output_budget,
                chunks: plan.chunks.length,
                calls: plan.calls.length,
                bound: 'Lossless input partition; stage workload estimates are not a guaranteed output size; full originals retained',
                attribute_conflicts: copy(row.staged.attribute_conflicts ?? []),
                ambiguous_aliases: copy(row.staged.ambiguous_aliases ?? []),
            };
            row.candidates = [];
            for (const item of row.items) {
                const records = assembled.bySource.get(item.source_id) ?? [];
                item.status = 'succeeded';
                item.attempt_id = 'staged:' + importId;
                item.batch_id = null;
                const own = new Set(records.filter(record => ['entity', 'location'].includes(record.record_kind)).map(record => record.id));
                const unresolved = [...new Set(records.filter(record => record.record_kind === 'relation').flatMap(record => [record.from_id, record.to_id]).filter(id => !own.has(id)))];
                row.candidates.push({
                    library_id: libraryId, import_id: importId, source_id: item.source_id, content_hash: item.content_hash,
                    attempt_id: item.attempt_id, batch_id: null, records, graph_ids: {}, explicit_ids: records.map(record => record.id), unresolved_refs: unresolved,
                });
            }
            row.staged.status = 'succeeded';
            row.status='ready';
            return row;
        });
    }

    async function failImport(libraryId, importId, failure) {
        const result=await change(libraryId, importId, row => {
            if (!row.staged || terminal(row) || row.staged.status==='succeeded') return row;
            row.staged.status = 'failed';
            if(!terminal(row))row.status='failed';
            row.staged.failure = copy(failure);
            if (!terminal(row)) for (const item of row.items) if (item.status !== 'succeeded') item.status = 'failed';
            return row;
        });
        for(const running of controllers.values())if(running.libraryId===libraryId&&running.importId===importId)running.controller.abort();
        return result;
    }

    // Semantic requests use the same immutable receipts, ownership, retry budget and cancellation.
    // A group that remains unresolved retains its candidate values; unrelated facts can publish.
    async function reviewSemanticPhase(libraryId,importId,kind,plan){
        await change(libraryId,importId,row=>{row.staged.semantic_merge.phases[kind]??=copy(plan);return row;});
        let row=await readImport(libraryId,importId);plan=row.staged.semantic_merge.phases[kind];
        for(const group of plan.groups){
            const chunk_ids=[...new Set(group.candidates.flatMap(c=>(c.refs??[]).map(r=>r.chunk_id)))];
            const call={call_id:group.id,group_id:group.id,semantic_merge:true,merge_kind:kind,stage:'semantic-'+kind,scope:kind,units:['M'],chunk_ids,chars:plan.context.source_chunks.filter(c=>chunk_ids.includes(c.chunk_id)).reduce((n,c)=>n+c.content.length,0)};
            for(;;){
                row=await readImport(libraryId,importId);if(terminal(row)||row.staged.status==='failed')return false;
                const block=row.staged.blocks[call.call_id];
                if(block?.status==='succeeded'||block?.status==='unknown'||block?.status==='cancelled'||(block?.status==='failed'&&block.attempt_count>=maxAttempts))break;
                const outcome=await runCall(libraryId,importId,call,null);
                if(outcome==='busy'||outcome==='cancelled')return false;
                if(outcome==='succeeded'||outcome==='unknown')break;
            }
        }
        return true;
    }
    async function semanticAssembly(libraryId,importId){
        let row=await readImport(libraryId,importId);
        const candidates=row.staged.plan.calls.flatMap(call=>row.staged.blocks[call.call_id]?.result??[]);
        const provisional=completeSourceJobs(candidates,{locationConflicts:'preserve'});
        const context={entries:row.entries,chunks:row.staged.plan.chunks,fieldTable:row.staged.field_review?.confirmed??null,directory:provisional.directory,settings:provisional.settings};
        const identityPlan=buildIdentityReview(candidates,context);
        if(!await reviewSemanticPhase(libraryId,importId,'identity',identityPlan))return null;
        row=await readImport(libraryId,importId);
        const identityDecisions=row.staged.semantic_merge.phases.identity.groups.flatMap(g=>row.staged.blocks[g.id]?.result??[]);
        const partitions=identityDecisions.filter(d=>d.resolution==='partition').flatMap(d=>d.partitions);
        let merged=completeSourceJobs(candidates,{locationConflicts:'preserve',identityPartitions:partitions});
        const fieldPlan=buildFieldReview(candidates,merged,context);
        if(!await reviewSemanticPhase(libraryId,importId,'field',fieldPlan))return null;
        row=await readImport(libraryId,importId);
        const fieldDecisions=row.staged.semantic_merge.phases.field.groups.flatMap(g=>row.staged.blocks[g.id]?.result??[]);
        merged=applyFieldDecisions(merged,row.staged.semantic_merge.phases.field,fieldDecisions);
        await change(libraryId,importId,current=>{
            const state=current.staged.semantic_merge;state.candidates=copy(candidates);state.decisions=[...identityDecisions,...fieldDecisions];
            const decided=new Map(state.decisions.map(d=>[d.group_id,d]));
            state.unresolved=Object.values(state.phases).flatMap(p=>p.groups).filter(g=>!decided.has(g.id)||['conflicting','unresolved'].includes(decided.get(g.id).resolution)).map(g=>({group_id:g.id,kind:g.kind,...(g.key?{entity_id:g.entity_id,field:g.key}:{}),reason:decided.get(g.id)?.reason??current.staged.blocks[g.id]?.error?.message??'尚无确定归并结果'}));
            state.status=state.unresolved.length?'partial':'succeeded';
            return current;
        });
        return merged;
    }



    // First slice: collect exact chunks, then one entity/relation finalization task. It reuses
    // runCall and its durable receipts, and deliberately stops before the publication pipeline.
    async function executeFinalization(libraryId,importId,row){
        if(row.staged.finalization.status!=='pending')return copy(row);
        if(!row.staged.plan){
            const config=row.batch_config??await resolveConfig(),budget=await resolveOutputBudget();
            await change(libraryId,importId,current=>{
                if(terminal(current)||current.staged.plan)return current;
                current.batch_config??=copy(config);
                current.staged.plan=buildFinalizationPlan(current.entries,current.staged.finalization.foundation,
                    {chunkChars:current.batch_config.chunk_chars,maxTokens:budget?.max_tokens});
                return current;
            });
        }
        async function finishCall(call){
            for(;;){
                const current=await readImport(libraryId,importId),block=current.staged.blocks[call.call_id];
                if(terminal(current)||current.staged.status==='failed')return false;
                if(block?.status==='succeeded')return true;
                if(block?.status==='unknown'||block?.status==='cancelled'||block?.status==='failed'&&block.attempt_count>=maxAttempts){
                    await failImport(libraryId,importId,{stage:call.stage,call_id:call.call_id,reason:block.status,message:block.error?.message??'定稿请求未完成'});return false;
                }
                const outcome=await runCall(libraryId,importId,call,null);
                if(outcome==='busy'||outcome==='cancelled')return false;
            }
        }
        try{
            row=await readImport(libraryId,importId);
            for(const call of row.staged.plan.calls.filter(c=>c.stage==='collect-records')){
                if(!await finishCall(call))return copy(await readImport(libraryId,importId));
            }
            row=await readImport(libraryId,importId);
            const collected=row.staged.plan.calls.filter(c=>c.stage==='collect-records').map(c=>row.staged.blocks[c.call_id].result[0]);
            await change(libraryId,importId,current=>{
                if(terminal(current)||current.staged.status==='failed')return current;
                current.staged.finalization.claims=copy(collectedFinalizationClaims(current));
                current.staged.completed=['collect-records'];
                const needs=collected.flatMap(r=>r.needs_context);
                if(needs.length){current.staged.finalization.status='needs_context';current.staged.finalization.needs_context=copy(needs);current.staged.status='needs-context';}
                return current;
            });
            row=await readImport(libraryId,importId);
            if(terminal(row)||row.staged.status==='failed'||row.staged.finalization.status!=='pending')return copy(row);
            const call=finalizationCall(row);
            await change(libraryId,importId,current=>{if(!terminal(current)&&current.staged.status!=='failed'&&!current.staged.plan.calls.some(c=>c.call_id===call.call_id))current.staged.plan.calls.push(copy(call));return current;});
            if(!await finishCall(call))return copy(await readImport(libraryId,importId));
            return change(libraryId,importId,current=>{
                if(terminal(current)||current.staged.status==='failed')return current;
                const response=current.staged.blocks[call.call_id].result[0];
                current.staged.finalization.status=response.status;
                current.staged.completed.push('finalize-records');
                current.staged.finalization.result=response.status==='complete'?assembleFinalizationDraft(current,response):null;
                current.staged.finalization.needs_context=copy(response.needs_context);
                current.staged.finalization.reason=response.reason;
                current.staged.status=response.status==='complete'?'slice-complete':response.status==='needs_context'?'needs-context':'source-ambiguous';
                // row.status, candidates and fixed source versions are untouched: this is a draft.
                return current;
            });
        }catch(cause){
            await failImport(libraryId,importId,{stage:'finalization-slice',reason:'validation',message:cause.message});
            return copy(await readImport(libraryId,importId));
        }
    }

    async function bootstrapWorkspace(libraryId,importId,row){
        if(!row.staged.plan){
            const config=row.batch_config??await resolveConfig(),budget=await resolveOutputBudget();
            await change(libraryId,importId,current=>{if(!terminal(current)&&!current.staged.plan){current.batch_config??=copy(config);const plan=buildSourceJobPlan(current.entries,'world',{chunkChars:config.chunk_chars,maxTokens:budget?.max_tokens,semantic:true,fieldReview:true});current.staged.plan={...plan,calls:plan.calls.filter(c=>c.stage==='facts')};}return current;});
        }
        row=await readImport(libraryId,importId);
        for(const call of row.staged.plan.calls){
            for(;;){const current=await readImport(libraryId,importId),b=current.staged.blocks[call.call_id];
                if(terminal(current)||b?.status==='unknown'||b?.status==='cancelled'||b?.status==='failed'&&workspaceRoundAttempts(b)>=maxAttempts)return copy(current);
                if(b?.status==='succeeded')break;
                const outcome=await runCall(libraryId,importId,call,null);if(['busy','cancelled','unknown','capacity','blocked'].includes(outcome))return copy(await readImport(libraryId,importId));
            }
        }
        return change(libraryId,importId,current=>{
            if(terminal(current)||current.staged.workspace)return current;
            const calls=current.staged.plan.calls;
            if(!current.staged.field_review){const review=collectWorkspaceFields(calls.map(c=>({refs:c.refs,fields:current.staged.blocks[c.call_id].field_candidates??[]})));current.staged.field_review={...review,revision:fieldCandidateRevision(review.candidates),confirmed:null};}
            const table=current.staged.field_review.confirmed;
            if(!table){current.staged.status='awaiting-fields';return current;}
            const merged=completeSourceJobs(calls.flatMap(c=>current.staged.blocks[c.call_id].result),{locationConflicts:'preserve'});
            const foundation={version:'confirmed-fields',time_policy:'latest-established-story-time',entities:merged.directory.map(e=>({id:e.id,name:e.name,kind:e.kind,aliases:e.aliases??[],clues:null})),field_table:table};
            current.staged.bootstrap={plan:copy(current.staged.plan),directory:copy(merged.directory),relations:copy(merged.relations),settings:copy(merged.settings)};
            current.staged.finalization={protocol:SOURCE_WORKSPACE_PROTOCOL,foundation,status:'pending',result:null};
            current.staged.workspace=createSourceWorkspace(foundation);current.staged.plan=null;current.staged.status='pending';return current;
        });
    }
    async function executeWorkspace(libraryId,importId,row){
        if(!row.staged.workspace){row=await bootstrapWorkspace(libraryId,importId,row);if(!row.staged.workspace||terminal(row))return row;}
        let activeRevision=row.staged.workspace.revision,activeRequest=row.staged.workspace.pending_request?.request_id??null;
        if(!row.staged.plan){
            const config=row.batch_config??await resolveConfig(),budget=await resolveOutputBudget();
            await change(libraryId,importId,current=>{if(!terminal(current)&&!current.staged.plan){current.batch_config??=copy(config);current.staged.plan=buildWorkspacePlan(current.entries,current.staged.finalization.foundation,{chunkChars:current.batch_config.chunk_chars,maxTokens:budget?.max_tokens,batching:current.staged.delivery_version===2,bootstrap:current.staged.bootstrap});}return current;});
        }
        async function remember(call){return change(libraryId,importId,current=>{
            const saved=current.staged.plan.calls.find(c=>c.call_id===call.call_id);if(saved)return saved;
            if(!terminal(current))current.staged.plan.calls.push(copy(call));return call;
        });}
        async function run(call){
            call=await remember(call);
            for(;;){
                const current=await readImport(libraryId,importId),block=current.staged.blocks[call.call_id];
                if(terminal(current))return 'cancelled';
                if(block?.status==='succeeded')return 'succeeded';
                if(!workspaceCallCurrent(current,call))return 'superseded';
                const keys=new Set((call.children??[call]).map(c=>c.task_key));
                const unknown=current.staged.plan.calls.find(c=>c.call_id!==call.call_id&&current.staged.blocks[c.call_id]?.status==='unknown'&&(c.children??[c]).some(c=>keys.has(c.task_key)));
                if(unknown)return 'unknown';
                if(block?.status==='unknown'||block?.status==='cancelled'||block?.status==='failed'&&workspaceRoundAttempts(block)>=maxAttempts)return block.status;
                const outcome=await runCall(libraryId,importId,call,null);
                if(outcome==='busy'||outcome==='cancelled'||outcome==='capacity')return outcome;
            }
        }
        async function pause(status,blockers,revision,requestId=null){return change(libraryId,importId,current=>{
            const ws=current.staged.workspace;
            if(terminal(current)||ws.revision!==revision||requestId&&(ws.pending_request?.request_id??'initial')!==requestId)return current;
            if(requestId===null&&revision>0&&ws.pending_request)return current;
            ws.blockers=copy(blockers);ws.result=null;current.staged.finalization.result=null;
            current.staged.finalization.status=status;current.staged.status='workspace-'+status;return current;
        });}
        try{
            row=await readImport(libraryId,importId);
            for(const call of row.staged.plan.calls.filter(c=>c.stage==='collect-workspace'&&!c.collection_revision)){
                const outcome=await run(call);if(['busy','superseded','cancelled','capacity'].includes(outcome))return copy(await readImport(libraryId,importId));
                if(outcome!=='succeeded'){const latest=await readImport(libraryId,importId);return pause(outcome==='unknown'?'request_unknown':'failed',[{call_id:call.call_id,stage:call.stage,reason:latest.staged.blocks[call.call_id]?.error?.message??outcome}],0);}
            }
            row=await readImport(libraryId,importId);
            const needs=row.staged.plan.calls.filter(c=>c.stage==='collect-workspace'&&!c.collection_revision).flatMap(c=>row.staged.blocks[c.call_id].result[0].needs_context);
            if(needs.length)return pause('needs_context',needs,row.staged.workspace.revision);
            if(row.staged.workspace.revision===0||row.staged.workspace.pending_request){
                const call=await remember(workspaceDirectoryCall(row)),outcome=await run(call);
                activeRevision=call.snapshot.base_revision;activeRequest=call.snapshot.request_id;
                if(['busy','superseded','cancelled','capacity'].includes(outcome))return copy(await readImport(libraryId,importId));
                if(outcome!=='succeeded'){const latest=await readImport(libraryId,importId);return pause(outcome==='unknown'?'request_unknown':'failed',[{call_id:call.call_id,stage:call.stage,reason:latest.staged.blocks[call.call_id]?.error?.message??outcome}],call.snapshot.base_revision,call.snapshot.request_id);}
                row=await readImport(libraryId,importId);const response=row.staged.blocks[call.call_id].result[0];
                if(response.status!=='complete'){
                    await pause(response.status,response.status==='blocked'?response.blockers:response.needs_context,call.snapshot.base_revision,call.snapshot.request_id);
                    return change(libraryId,importId,current=>{const ws=current.staged.workspace;if(ws.pending_request?.request_id===call.snapshot.request_id){ws.requests.find(r=>r.request_id===ws.pending_request.request_id).status=response.status;ws.pending_request=null;}return current;});
                }
                const applied=await change(libraryId,importId,current=>!terminal(current)&&commitWorkspaceDirectory(current,call,response));
                if(!applied)return copy(await readImport(libraryId,importId));
            }
            row=await readImport(libraryId,importId);if(terminal(row)||row.staged.workspace.pending_request)return copy(row);
            if(row.staged.workspace.recollection?.status==='pending'){
                const collections=[];
                for(const c of workspaceCollectionCalls(row)){const call=await remember(c);collections.push(call);const outcome=await run(call);
                    if(['busy','superseded','cancelled','capacity'].includes(outcome))return copy(await readImport(libraryId,importId));
                    if(outcome!=='succeeded')return pause(outcome==='unknown'?'request_unknown':'failed',[{call_id:call.call_id,reason:outcome}],row.staged.workspace.revision);
                }
                const accepted=await change(libraryId,importId,current=>acceptWorkspaceCollection(current,collections));
                if(accepted)return executeWorkspace(libraryId,importId,await readImport(libraryId,importId));
                return pause('needs_context',[{reason:'字段补采集尚未完整，原回执已保留'}],row.staged.workspace.revision);
            }
            const revision=row.staged.workspace.revision,calls=[];
            activeRevision=revision;activeRequest=null;
            for(const call of workspaceTaskCalls(row))calls.push(await remember(call));
            await change(libraryId,importId,current=>{if(!terminal(current)&&current.staged.workspace.revision===revision&&!current.staged.workspace.pending_request)current.staged.workspace.tasks=calls.map(c=>({key:c.task_key,call_id:c.call_id,dependency_hash:c.dependency_hash}));return current;});
            const pending=calls.filter(c=>row.staged.blocks[c.call_id]?.status!=='succeeded');
            const requests=workspaceTaskBatches(row,pending,row.batch_config.chunk_chars);
            let cursor=0,stopped=false;
            await waitForWorkers(Array.from({length:Math.min(row.batch_config?.concurrency??1,requests.length)},async()=>{
                while(!stopped&&cursor<requests.length){const call=requests[cursor++],outcome=await run(call);if(['busy','superseded','cancelled','capacity'].includes(outcome))stopped=true;}
            }),()=>{stopped=true;});
            row=await readImport(libraryId,importId);
            if(terminal(row)||stopped||row.staged.workspace.revision!==revision||row.staged.workspace.pending_request)return copy(row);
            const blocked=calls.flatMap(c=>{const b=row.staged.blocks[c.call_id],r=b?.result?.[0];if(b?.status==='succeeded'&&r?.status==='complete')return [];const transport=row.staged.plan.calls.findLast(old=>row.staged.blocks[old.call_id]?.status==='unknown'&&(old.children??[old]).some(child=>child.task_key===c.task_key))??row.staged.plan.calls.findLast(old=>row.staged.blocks[old.call_id]&&row.staged.blocks[old.call_id].status!=='succeeded'&&(old.children??[old]).some(child=>child.call_id===c.call_id)),t=transport&&row.staged.blocks[transport.call_id];return [{task_key:c.task_key,call_id:c.call_id,status:t?.status==='unknown'?'unknown':b?.status==='succeeded'?'needs_context':t?.status??b?.status??'pending',needs_context:r?.needs_context??[],reason:t?.error?.message??b?.error?.message??null}];});
            if(blocked.length)return pause(blocked.some(b=>b.status==='unknown')?'request_unknown':blocked.some(b=>b.status==='failed')?'failed':'needs_context',blocked,revision);
            const coverage=workspaceFieldCoverage(row);if(coverage.length)return pause('needs_context',coverage,revision);
            return change(libraryId,importId,current=>{
                const ws=current.staged.workspace;if(terminal(current)||ws.revision!==revision||ws.pending_request)return current;
                const result=assembleWorkspaceDraft(current,calls);validateWorkspacePublicationDraft(current,result);ws.result=result;ws.blockers=[];ws.history.at(-1).result=copy(ws.result);
                for(const item of current.items)item.status='succeeded';
                current.staged.finalization.result=copy(ws.result);current.staged.finalization.status='complete';delete current.staged.publication_failure;current.staged.status='workspace-complete';return current;
            });
        }catch(cause){return pause('failed',[{reason:cause.message}],activeRevision,activeRequest);}
    }

    async function waitForWorkers(workers,onFailure){
        let failed=false,firstFailure;
        await Promise.allSettled(workers.map(worker=>worker.catch(cause=>{
            if(!failed){failed=true;firstFailure=cause;}onFailure();
        })));
        if(failed)throw firstFailure;
    }

    async function execute(libraryId,importId,options={}){
        const key=executionKey(libraryId,importId);stagedExecutions.set(key,(stagedExecutions.get(key)||0)+1);
        try{return await executeOnce(libraryId,importId,options);}
        finally{const count=stagedExecutions.get(key)-1;if(count)stagedExecutions.set(key,count);else stagedExecutions.delete(key);}
    }

    async function executeOnce(libraryId, importId, {reassemble=false} = {}) {
        if(reassemble)await change(libraryId,importId,current=>{
            if(!canReassembleSourceImport(current))return current;
            current.staged.failure_history??=[];current.staged.failure_history.push(copy(current.staged.failure));
            current.staged.failure=null;current.staged.status='processing';current.status='draft';
            return current;
        });
        await reconcile(libraryId, importId);
        let row = await readImport(libraryId, importId);
        progressCache.delete(JSON.stringify([libraryId,importId]));reportProgress(sourceProgressSnapshot(row,receiving));
        if (terminal(row) || row.staged.status === 'failed' || row.staged.status === 'succeeded') return copy(row);
        if(row.staged.protocol===SOURCE_WORKSPACE_PROTOCOL)return executeWorkspace(libraryId,importId,row);
        if(row.staged.protocol===SOURCE_FINALIZATION_PROTOCOL)return executeFinalization(libraryId,importId,row);
        if (!row.staged.plan) {
            const config = row.batch_config ?? await resolveConfig();
            const outputBudget = await resolveOutputBudget();
            await change(libraryId, importId, current => {
                if (terminal(current) || current.staged.plan) return current;
                current.batch_config ??= copy(config);
                current.staged.plan = ['source-jobs-v1','source-jobs-v2','source-jobs-v3',SOURCE_JOB_PROTOCOL,SOURCE_SEMANTIC_PROTOCOL,SOURCE_FIELD_PROTOCOL].includes(current.staged.protocol)
                    ? buildSourceJobPlan(current.entries,current.staged.mode,{chunkChars:current.batch_config.chunk_chars,maxTokens:outputBudget?.max_tokens,semantic:[SOURCE_SEMANTIC_PROTOCOL,SOURCE_FIELD_PROTOCOL].includes(current.staged.protocol),fieldReview:current.staged.protocol===SOURCE_FIELD_PROTOCOL})
                    : current.staged.protocol===SOURCE_GROUP_PROTOCOL
                    ? buildSourceGroupPlan(current.entries,current.staged.mode,{chunkChars:current.batch_config.chunk_chars,maxTokens:outputBudget?.max_tokens})
                    : buildStagePlan(current.entries, current.staged.mode, { chunkChars: current.batch_config.chunk_chars, outputBudget });
                return current;
            });
            row = await readImport(libraryId, importId);
            if (terminal(row) || row.staged.status === 'failed') return copy(row);
        }
        if(['source-jobs-v1','source-jobs-v2','source-jobs-v3',SOURCE_JOB_PROTOCOL,SOURCE_SEMANTIC_PROTOCOL,SOURCE_FIELD_PROTOCOL].includes(row.staged.plan.protocol)){
            const fieldReview=row.staged.plan.protocol===SOURCE_FIELD_PROTOCOL;
            if(row.staged.semantic_merge&&row.staged.field_review?.confirmed&&!row.staged.semantic_merge.shared_context){
                const facts=completeSourceJobs(row.staged.plan.calls.filter(c=>c.stage==='facts').flatMap(c=>row.staged.blocks[c.call_id]?.result??[]),{locationConflicts:'preserve'});
                await change(libraryId,importId,current=>{current.staged.semantic_merge.shared_context={directory:copy(facts.directory),settings:copy(facts.settings),field_table:copy(current.staged.field_review.confirmed)};return current;});
            }
            const calls=[...row.staged.plan.calls].filter(call=>!fieldReview||row.staged.field_review?.confirmed||call.stage==='facts').sort((a,b)=>b.chars-a.chars||row.staged.plan.calls.indexOf(a)-row.staged.plan.calls.indexOf(b));
            let cursor=0,stopped=false;
            await waitForWorkers(Array.from({length:Math.min(row.batch_config?.concurrency??1,calls.length)},async()=>{
                while(!stopped&&cursor<calls.length){
                    const call=calls[cursor++];
                    for(;;){
                        const current=await readImport(libraryId,importId);
                        if(stopped||terminal(current)||current.staged.status==='failed'){stopped=true;return;}
                        const block=current.staged.blocks?.[call.call_id];
                        if(block?.status==='succeeded')break;
                        if(block?.status==='unknown'||block?.status==='cancelled'||(block?.status==='failed'&&block.attempt_count>=maxAttempts)){
                            stopped=true;await failImport(libraryId,importId,{call_id:call.call_id,stage:call.stage,reason:block.status==='failed'?'exhausted':block.status,message:block.error?.message??null});return;
                        }
                        const outcome=await runCall(libraryId,importId,call,null);
                        if(outcome==='succeeded')break;
                        if(['cancelled','busy','blocked','capacity'].includes(outcome)){stopped=true;return;}
                        if(outcome==='unknown'){stopped=true;await failImport(libraryId,importId,{call_id:call.call_id,stage:call.stage,reason:'unknown',message:'request without durable receipt not replayed'});return;}
                    }
                }
            }),()=>{stopped=true;});
            row=await readImport(libraryId,importId);
            if(stopped||terminal(row)||row.staged.status==='failed')return copy(row);
            if(fieldReview&&!row.staged.field_review?.confirmed){
                await change(libraryId,importId,current=>{
                    if(terminal(current)||current.staged.status==='failed')return current;
                    if(!current.staged.field_review){
                        const candidates=collectFieldCandidates(calls.map(call=>({refs:call.refs,fields:current.staged.blocks[call.call_id]?.field_candidates??[]})));
                        current.staged.field_review={candidates,revision:fieldCandidateRevision(candidates),confirmed:null};
                    }
                    current.staged.status='awaiting-fields';return current;
                });
                return copy(await readImport(libraryId,importId));
            }
            try{
                const semanticMerged=row.staged.semantic_merge?await semanticAssembly(libraryId,importId):null;
                if(row.staged.semantic_merge&&!semanticMerged)return copy(await readImport(libraryId,importId));
                await change(libraryId,importId,current=>{
                    if(terminal(current)||current.staged.status==='failed')return current;
                    const merged=semanticMerged??completeSourceJobs(current.staged.plan.calls.flatMap(call=>current.staged.blocks[call.call_id]?.result??[]),[SOURCE_SEMANTIC_PROTOCOL,SOURCE_FIELD_PROTOCOL].includes(current.staged.plan.protocol)?{locationConflicts:'preserve'}:{});
                    current.staged.directory=merged.directory;current.staged.ambiguous_aliases=merged.ambiguous;
                    current.staged.attribute_fields=[...merged.byId.values()].map(entry=>({id:entry.id,fields:[...entry.fields],refs:entry.refs}));
                    current.staged.attribute_conflicts=merged.conflicts;current.staged.relations=merged.relations;current.staged.settings=merged.settings;
                    current.staged.completed=[...new Set(current.staged.plan.calls.map(call=>call.stage))];
                    return current;
                });
                await finalize(libraryId,importId);
            }catch(cause){await failImport(libraryId,importId,{stage:'assembly',reason:'validation',message:cause.message});}
            return copy(await readImport(libraryId,importId));
        }
        for (const step of row.staged.plan.stages) {
            row = await readImport(libraryId, importId);
            if (terminal(row)) return copy(row);
            if (row.staged.completed?.includes(step.stage)) continue;
            const directory = row.staged.directory ?? null;
            const calls = row.staged.plan.calls.filter(call => call.stage === step.stage);

            let cursor=0, stopped=false;
            await waitForWorkers(Array.from({length:Math.min(row.batch_config?.concurrency??1,calls.length)},async()=>{
                while(!stopped && cursor<calls.length){
                    const call=calls[cursor++];
                    for (;;) {
                        const current=await readImport(libraryId,importId);
                        if(stopped||terminal(current)||current.staged.status==='failed'){stopped=true;return;}
                        const block=current.staged.blocks?.[call.call_id];
                        if(block?.status==='succeeded')break;
                        if(block?.status==='unknown'||block?.status==='cancelled'||(block?.status==='failed'&&block.attempt_count>=maxAttempts)){
                            stopped=true;
                            await failImport(libraryId,importId,{call_id:call.call_id,stage:step.stage,reason:block.status==='failed'?'exhausted':block.status,message:block.error?.message??null});return;
                        }
                        const outcome=await runCall(libraryId,importId,call,directory);
                        if(outcome==='succeeded')break;
                        if(outcome==='cancelled'||outcome==='busy'){stopped=true;return;}
                        if(outcome==='unknown'){stopped=true;await failImport(libraryId,importId,{call_id:call.call_id,stage:step.stage,reason:'unknown',message:'in-flight request without a durable response was not accepted'});return;}
                    }
                }
            }),()=>{stopped=true;});
            row=await readImport(libraryId,importId);
            if(stopped||terminal(row)||row.staged.status==='failed')return copy(row);
            try{await completeStage(libraryId, importId, step.stage, step.scope);}catch(cause){await failImport(libraryId,importId,{stage:step.stage,reason:'validation',message:cause.message});return copy(await readImport(libraryId,importId));}
        }
        try{await finalize(libraryId, importId);}catch(cause){await failImport(libraryId,importId,{stage:'assembly',reason:'validation',message:cause.message});}
        return copy(await readImport(libraryId, importId));
    }

    /** Flip orphaned requested blocks to unknown; never assume a confirmed failure. */
    function reconcileRow(row) {
        if (!row.staged) return false;
        let changed = false;
        for(const attempt of row.execution?.attempts??[])if(attempt.kind==='staged'&&!isAttemptLive(row,attempt)&&settleUnfinishedAttempt(attempt))changed=true;
        for (const block of Object.values(row.staged.blocks ?? {})) {
            if (block.status !== 'requested') continue;
            const attempt = lastAttempt(row, block);
            if (!attempt) { block.status = 'unknown'; changed = true; continue; }
            if (attempt.failure) { block.status = attempt.outcome === 'unknown' ? 'unknown' : 'failed'; changed = true; continue; }
            if (attempt.response !== null && attempt.response !== undefined) { block.status = row.staged.status==='failed'?'cancelled':'received'; changed = true; continue; }
            if (!isAttemptLive(row,attempt)) {
                attempt.outcome = 'unknown';
                attempt.error ??= { stage: 'model', message: 'Request was sent; no durable response exists. Do not automatically reissue.' };
                block.status = 'unknown'; changed = true;
            }
        }
        const blocks = row.staged.protocol===SOURCE_WORKSPACE_PROTOCOL?[]:Object.values(row.staged.blocks ?? {}).filter(block=>!block.stage?.startsWith('semantic-'));
        const dead = blocks.some(block => block.status === 'unknown' || (block.status === 'failed' && block.attempt_count >= maxAttempts));
        if (dead && row.staged.status !== 'failed') {
            row.staged.status = 'failed';
            if(!terminal(row))row.status='failed';
            if (!terminal(row)) for (const item of row.items) if (item.status !== 'succeeded') item.status = 'failed';
            changed = true;
        }
        return changed;
    }

    function cancelRow(row) {
        if (!row.staged) return;
        if (!['failed', 'succeeded'].includes(row.staged.status)) row.staged.status = 'cancelled';
        for (const block of Object.values(row.staged.blocks ?? {})) {
            if (block.status === 'pending') block.status = 'cancelled';
            else if (block.status === 'requested' || block.status === 'received') block.status = 'unknown';
        }
    }

    function publishGuard(row) {
        if(row.staged?.protocol===SOURCE_WORKSPACE_PROTOCOL){currentWorkspaceResult(row);return;}
        if(row.staged?.protocol===SOURCE_FINALIZATION_PROTOCOL)throw error('隔离定稿草稿尚未接入发布和初始化，禁止沿旧协议发布');
        if (row.staged && row.staged.status !== 'succeeded') throw error('staged import is not complete; publication refused even with an omission list');
    }

    async function reconcile(libraryId, importId) {
        const current = await readImport(libraryId, importId);
        if (!current.staged) return false;
        // Reuse the host's change only when a fix-up is needed; this keeps getImport read-only on the hot path.
        let probe = copy(current);
        if (!reconcileRow(probe)) return false;
        await change(libraryId, importId, row => { reconcileRow(row); return row; });
        return true;
    }

    return { execute, reconcileRow, cancelRow, publishGuard, buildStagePlan };
}
