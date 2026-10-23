import { SOURCE_AB_PROTOCOL, initialAbCreationPlan, nextAbCreationStep, applyAbCreationResponse, summarizeAbBlocks } from './source-ab-pipeline.js';
import { sha256Hex } from './browser-capabilities.js';
import { buildSourceJobPlan, sourceJobPrompt, sourceJobResponseFormat, completeSourceJobs } from './source-jobs.js';
import { evaluateSourceJobProposal, applySourceJobCorrections, sourceJobCorrectionPrompt } from './source-job-recovery.js';
import { chunkContent, MAX_STAGE_ATTEMPTS } from './source-stages.js';
import { collectWorkspaceFields } from './source-field-candidates.js';
import { fieldCandidateRevision } from './source-field-table.js';
import { responseContractPrompt } from './source-response-contract.js';
import { parseModelJson } from './model-json.js';
import { FACTS_WIRE_VERSION, factsWireResponse } from './source-jobs.js';
import { SOURCE_WORKSPACE_PROTOCOL, DIRECTORY_REFERENCE_ENCODING, buildWorkspacePlan, createSourceWorkspace,
    workspaceDirectoryCall, workspaceTaskCalls, workspaceTaskBatches, workspaceCallCurrent, workspaceFieldCoverage,
    workspaceInputSourceChars, workspacePrompt, workspaceResponseFormat, validateWorkspaceResponse,
    commitWorkspaceDirectory, assembleWorkspaceDraft } from './source-workspace.js';
import { validateWorkspacePublicationDraft, workspacePublication } from './finalized-source.js';
import { creationError } from './creation-task.js';
const clone = value => structuredClone(value);
export function initialCreationPlan(input, config) {
    if (config.sourceCreationProtocol === SOURCE_AB_PROTOCOL) return initialAbCreationPlan(input, config);
    const plan = buildSourceJobPlan(input.entries, 'world', { chunkChars: config.chunk_chars,
        maxTokens: config.max_tokens, semantic: true, fieldReview: true });
    return { schema: 1, config: clone(config), entries: clone(input.entries), library_id: input.library_id, import_id: input.import_id,
        extractor_key: 'world-creation-v1', items: input.entries.map(e => ({ source_id: e.source_id,
            content_hash: sha256Hex(e.content), status: 'pending' })),
        staged: { protocol: SOURCE_WORKSPACE_PROTOCOL, delivery_version: 2, mode: 'world',
            plan: { ...clone(plan), calls: clone(plan.calls.filter(c => c.stage === 'facts')).map(call=>({...call,facts_wire_version:FACTS_WIRE_VERSION})) }, blocks: {} } };
}
// The legacy semantic algorithms receive a derived view, not another lifecycle owner.
function semanticRow(task, pipeline) {
    const row = clone(pipeline); row.status = task.status === 'cancelled' ? 'cancelled' : 'draft';
    row.execution = { attempts: [] }; row.staged.field_review = clone(task.field_review ?? null);
    return row;
}
function stored(row) { const copy = clone(row); delete copy.status; delete copy.execution; delete copy.staged.field_review; return copy; }
function remember(row, call) {
    const old = row.staged.plan.calls.find(c => c.call_id === call.call_id);
    if (old) return old;
    row.staged.plan.calls.push(clone(call)); return call;
}
function blockFor(row, call) {
    return row.staged.blocks[call.call_id] ??= { call_id: call.call_id, status: 'pending', result: [],
        completed_units: [], attempt_count: 0, attempt_ids: [], error: null };
}
function blocked(block, call) {
    if (block.status === 'unknown' || block.status === 'requested') return { kind: 'blocked', unknown: true, call_id: call.call_id, code: 'request-unknown' };
    if (block.failure?.type === 'not-sent') return {kind:'blocked',code:'not-sent',call_id:call.call_id,reason:'请求未能登记，尚未发送'};
    if (block.context_rejected || ['truncated', 'truncation'].includes(block.failure?.type)) return { kind: 'blocked', call_id: call.call_id, code: 'capacity', reason: block.error?.message };
    if (block.attempt_count - (block.retry_from_attempt ?? 0) >= MAX_STAGE_ATTEMPTS || block.repair_state?.repair?.length === 0) return { kind: 'blocked', call_id: call.call_id, code: 'validation', reason: block.error?.message };
    return null;
}
export function summarizeCreationBlocks(pipeline,attempts=[]){
 if(pipeline.staged.protocol===SOURCE_AB_PROTOCOL)return summarizeAbBlocks(pipeline,attempts);
 const calls=pipeline.staged.plan.calls,blocks=pipeline.staged.blocks,summary={total:calls.length,succeeded:0,failed:0,format_failed:0,unknown:0,pending:0},blockers=[];
 for(const [index,call] of calls.entries()){
  const block=blocks[call.call_id]??{},latest=attempts.filter(a=>a.call_id===call.call_id).sort((a,b)=>a.sequence-b.sequence).at(-1);
  const uncertain=['unknown','requested'].includes(block.status)||latest&&!latest.receipt&&['reserved','dispatched'].includes(latest.status);
  if(block.status==='succeeded'&&!uncertain){summary.succeeded++;continue}
  if(uncertain){summary.unknown++;blockers.push({call_id:call.call_id,index:index+1,unknown:true,code:'request-unknown',reason:block.error?.message??'原请求结果尚未确认，禁止自动重发',repairable:false});continue}
  if(block.status==='failed'){
   summary.failed++;if(block.error?.stage==='validation')summary.format_failed++;
   const stop=blocked(block,call);blockers.push({call_id:call.call_id,index:index+1,code:stop?.code??'validation',reason:block.error?.message??'已收结果尚未通过核对',repairable:!stop});
  }else summary.pending++;
 }
 blockers.sort((a,b)=>Number(!!b.unknown)-Number(!!a.unknown)||a.index-b.index);
 return {summary,blockers};
}
export function creationBlockSummary({summary,blockers}){
 const head='已成功 '+summary.succeeded+' 组，格式失败 '+summary.format_failed+' 组，结果未确认 '+summary.unknown+' 组';
 const other=summary.failed-summary.format_failed;
 return head+(other?'，其它失败 '+other+' 组':'')+'。'+blockers.map(b=>'第'+b.index+'组：'+b.reason).join('；')+(summary.unknown?'；存在结果未确认的原请求，本次不会发送模型请求':'');
}
function parseCreationReceipt(request,text){
 const protocol=parseModelJson(text),version=request?.options?.facts_wire_version;
 return version===undefined?protocol:factsWireResponse(protocol,{decode:true,version});
}
function evaluatePendingProposal(call,seed,context){
 const candidate=clone(seed),pending=context.pendingUnits??call.units,keys={IR:['identities','relations'],C:['settings'],P:['properties']};
 // Remove only arrays of already accepted units. Unknown root keys remain visible to strict validation.
 for(const unit of call.units)if(!pending.includes(unit))for(const key of keys[unit]??[])delete candidate[key];
 const checked=evaluateSourceJobProposal(call,candidate,context);
 return {...checked,proposal:{...clone(seed),...checked.proposal}};
}
export function revalidateCreationFacts(task,pipeline,attempts=[]){
 if(pipeline.staged.protocol===SOURCE_AB_PROTOCOL)return {pipeline:clone(pipeline),...summarizeAbBlocks(pipeline,attempts)};
 const row=clone(pipeline);row.revalidations??=[];
 for(const call of row.staged.plan.calls){
  const block=row.staged.blocks[call.call_id];if(call.workspace||call.stage!=='facts'||block?.status!=='failed')continue;
  const latest=attempts.filter(a=>a.call_id===call.call_id&&a.execution_id===task.execution_id).sort((a,b)=>a.sequence-b.sequence).at(-1);
  if(latest&&(!latest.receipt?.ok||['reserved','dispatched'].includes(latest.status)))continue;
  const priorError=clone(block.error??null),completed=[...(block.completed_units??[])],pending=call.units.filter(unit=>!completed.includes(unit)),beforeDigest=sha256Hex(JSON.stringify(block));let projections=[];
  try{
   const seed=block.repair_state?.proposal??(latest?.receipt?.ok?parseCreationReceipt(latest.request,latest.receipt.text):null);
   if(!seed)continue;
   if(pending.length){
    const chunks=row.staged.plan.chunks.filter(c=>call.chunk_ids.includes(c.chunk_id));
    const checked=evaluatePendingProposal(call,seed,{chunks,allChunks:row.staged.plan.chunks,mode:'world',pendingUnits:pending});
    block.result.push(...checked.records);block.completed_units=[...new Set([...completed,...checked.passedUnits])];projections=clone(checked.projections??[]);
    if(checked.fieldCandidates)block.field_candidates=clone(checked.fieldCandidates);
    const errors=Object.entries(checked.errors??{});block.error=errors.length?{stage:'validation',message:errors.map(([unit,message])=>unit+': '+message).join('; ')}:null;
    if(errors.length)block.repair_state={proposal:clone(checked.proposal),repair:clone(checked.repair??[])};else delete block.repair_state;
   }
   block.status=call.units.every(unit=>block.completed_units.includes(unit))?'succeeded':'failed';if(block.status==='succeeded'){block.error=null;delete block.repair_state;}
  }catch(error){block.error={stage:'validation',message:String(error.message)};if(block.repair_state)block.repair_state.repair=[];}
  const audit={version:1,call_id:call.call_id,priorError,newError:clone(block.error??null),projections,completed_before:completed,completed_after:clone(block.completed_units)};
  const digest=sha256Hex(JSON.stringify(audit));if(beforeDigest!==sha256Hex(JSON.stringify(block))&&!row.revalidations.some(r=>r.digest===digest))row.revalidations.push({...audit,digest});
 }
 return {pipeline:row,...summarizeCreationBlocks(row,attempts)};
}
function describe(task, row, call) {
    const block = blockFor(row, call), stop = blocked(block, call);
    if (stop) return stop;
    if (call.workspace && !workspaceCallCurrent(row, call)) throw creationError('stale-plan', '定稿任务依赖已变化');
    if (call.workspace && Number.isSafeInteger(row.config.chunk_chars) && workspaceInputSourceChars({...call,record_delivery_version:1}) > row.config.chunk_chars)
        return { kind: 'blocked', code: 'capacity', call_id: call.call_id, reason: '完整来源超过当前每包目标，原文和回执保留' };
    const pendingUnits = call.units.filter(unit => !block.completed_units.includes(unit));
    let prompt, format, items = [];
    const referenceEncoding = call.stage === 'unify-workspace' ? DIRECTORY_REFERENCE_ENCODING : call.reference_encoding;
    if (call.workspace) { const responseCall={...call,record_delivery_version:1,...(call.stage==='unify-workspace'?{directory_output_version:1,directory_input_version:1}:{})}; prompt = workspacePrompt(row, responseCall, { previous: block.previous ?? null }); format = workspaceResponseFormat(responseCall, row); }
    else {
        const chunks = row.staged.plan.chunks.filter(c => call.chunk_ids.includes(c.chunk_id));
        items = chunks.map(chunk => ({ ...chunk, content: chunkContent(row.entries.find(e => e.source_id === chunk.source_id), chunk),
            metadata: row.entries.find(e => e.source_id === chunk.source_id).metadata }));
        const responseCall=block.repair_state?{...call,facts_wire_version:undefined}:call;
        format = sourceJobResponseFormat(responseCall, { pendingUnits, repair: block.repair_state?.repair });
        prompt = responseContractPrompt(sourceJobPrompt(responseCall, { items, chunks: row.staged.plan.chunks, mode: 'world',
            pendingUnits, error: block.error?.message }), format);
        if (block.repair_state) prompt = sourceJobCorrectionPrompt(responseCall, block.repair_state, { sourcePrompt: prompt, responseFormat: format });
    }
    return { kind: 'model', call: clone(call), prompt, response_format: format, items, pending_units: pendingUnits,
        options: { stage: call.stage, call_id: call.call_id, run_id: task.run_id, import_id: task.import_id,
            library_id: task.library_id, scope: task.scope, snapshot_id: task.snapshot_id,
            source_max_tokens: row.config.max_tokens, source_stream: row.config.stream !== false,
            ...(call.workspace?{record_delivery_version:1}:{}),
            ...(referenceEncoding ? { reference_encoding: referenceEncoding } : {}),
            ...(call.stage==='unify-workspace'?{directory_output_version:1,directory_input_version:1}:{}),
            ...(call.facts_wire_version!==undefined&&!block.repair_state?{facts_wire_version:call.facts_wire_version}:{}),
            ...(call.wire_version ? { wire_version: call.wire_version } : {}) } };
}
export function nextCreationStep(task, pipeline) {
    if (pipeline.staged.protocol === SOURCE_AB_PROTOCOL) return nextAbCreationStep(task, pipeline);
    const row = semanticRow(task, pipeline), stage = row.staged;
    const answer = effect => ({ pipeline: stored(row), effect });
    const modelBatch=calls=>{const all=summarizeCreationBlocks(row);if(all.summary.unknown){const first=all.blockers[0];return {kind:'blocked',...first,...all,reason:creationBlockSummary(all)}}const requests=calls.map(call=>describe(task,row,call)),stop=requests.find(r=>r.kind==='blocked');return stop?{...stop,...all,reason:creationBlockSummary(all)}:(requests.length===1?requests[0]:{kind:'models',requests});};
    if (!stage.workspace) {
        const pendingFacts=stage.plan.calls.filter(call=>blockFor(row,call).status!=='succeeded');
        if(pendingFacts.length)return answer(modelBatch(pendingFacts));
        const calls = stage.plan.calls;
        const groups = calls.map(c => ({ refs: c.refs, fields: stage.blocks[c.call_id].field_candidates ?? [] }));
        if (!task.field_review?.confirmed) return answer({ kind: 'fields', groups });
        const merged = completeSourceJobs(calls.flatMap(c => stage.blocks[c.call_id].result), { locationConflicts: 'preserve' });
        const foundation = { version: 'confirmed-fields', time_policy: 'latest-established-story-time',
            entities: merged.directory.map(e => ({ id: e.id, name: e.name, kind: e.kind, aliases: e.aliases ?? [], clues: null })),
            field_table: clone(task.field_review.confirmed) };
        stage.bootstrap = { plan: clone(stage.plan), directory: clone(merged.directory), relations: clone(merged.relations), settings: clone(merged.settings) };
        stage.finalization = { protocol: SOURCE_WORKSPACE_PROTOCOL, foundation, status: 'pending', result: null };
        stage.workspace = createSourceWorkspace(foundation);
        stage.plan = buildWorkspacePlan(row.entries, foundation, { chunkChars: row.config.chunk_chars, maxTokens: row.config.max_tokens,
            batching: true, bootstrap: stage.bootstrap });
    }
    const collection=stage.plan.calls.filter(c=>c.stage==='collect-workspace'&&!c.collection_revision);
    if(collection.some(call=>blockFor(row,call).result[0]?.needs_context?.length))return answer({kind:'blocked',code:'needs-context',reason:'记载需要补充上下文，不能发布空世界'});
    const pendingCollection=collection.filter(call=>blockFor(row,call).status!=='succeeded');
    if(pendingCollection.length)return answer(modelBatch(pendingCollection));
    if (stage.workspace.revision === 0) {
        const call = remember(row, workspaceDirectoryCall(row)), block = blockFor(row, call);
        if (block.status !== 'succeeded') return answer(describe(task, row, call));
        if (block.result[0]?.status !== 'complete') return answer({ kind: 'blocked', code: 'needs-context', reason: '身份或故事时间尚未完整统一' });
        if (!commitWorkspaceDirectory(row, call, block.result[0])) throw creationError('stale-plan', '统一目录尚不能提交');
    }
    const calls = workspaceTaskCalls(row).map(call => remember(row, call));
    stage.workspace.tasks = calls.map(c => ({ key: c.task_key, call_id: c.call_id, dependency_hash: c.dependency_hash }));
    const pending = calls.filter(c => blockFor(row, c).status !== 'succeeded');
    if (pending.length) {
        const requests = workspaceTaskBatches(row, pending, row.config.chunk_chars,{record_delivery_version:1}).map(c => remember(row, c));
        const descriptions = requests.map(call => describe(task, row, call));
        const stopped = descriptions.find(d => d.kind === 'blocked');
        return answer(stopped ?? { kind: 'models', requests: descriptions });
    }
    if (calls.some(c => stage.blocks[c.call_id].result[0]?.status !== 'complete') || workspaceFieldCoverage(row).length)
        return answer({ kind: 'blocked', code: 'needs-context', reason: '字段或逐条定稿尚未完整，原记载保留' });
    const result = assembleWorkspaceDraft(row, calls);
    validateWorkspacePublicationDraft(row, result);
    stage.workspace.result = result; stage.workspace.blockers = [];
    if (stage.workspace.history.length) stage.workspace.history.at(-1).result = clone(result);
    stage.finalization.result = clone(result); stage.finalization.status = 'complete';
    stage.status = 'workspace-complete'; for (const item of row.items) item.status = 'succeeded';
    const publication = workspacePublication(row, { library_id: row.library_id, import_id: row.import_id,
        expected_version: 0, version: 1, omitted_source_ids: [] });
    return answer({ kind: 'publish', publication });
}
export function applyCreationResponse(task, pipeline, request, attempt, receipt) {
    if (pipeline.staged.protocol === SOURCE_AB_PROTOCOL) return applyAbCreationResponse(task, pipeline, request, attempt, receipt);
    const row = semanticRow(task, pipeline), call = remember(row, request.call), block = blockFor(row, call);
    if (block.attempt_ids.includes(attempt.attempt_id)) return { pipeline, outcome: block.status };
    block.attempt_count++; block.attempt_ids.push(attempt.attempt_id);
    if (!receipt.ok) {
        block.status = receipt.unknown ? 'unknown' : 'failed'; block.failure = clone(receipt.failure);
        block.context_rejected = receipt.failure?.context_rejected === true;
        block.error = { stage: 'transport', message: receipt.failure?.message ?? '未取得完整模型回执' };
        return { pipeline: stored(row), outcome: block.status };
    }
    try {
        const protocol = parseCreationReceipt(request,receipt.text);
        if (call.workspace) {
            const checked = validateWorkspaceResponse(row, call, protocol, { referenceEncoding: request.options.reference_encoding,
                wireVersion: request.options.wire_version, recordDeliveryVersion:request.options.record_delivery_version });
            block.result = [checked]; block.status = 'succeeded';
            if (call.workspace_batch) for (const child of call.children) {
                const childBlock = blockFor(row, child);
                childBlock.result = [checked.results.find(r => r.call_id === child.call_id).result];
                childBlock.status = 'succeeded'; childBlock.completed_units = [...child.units];
                childBlock.attempt_ids = [...new Set([...childBlock.attempt_ids, attempt.attempt_id])];
            }
        } else {
            const chunks = row.staged.plan.chunks.filter(c => call.chunk_ids.includes(c.chunk_id));
            const candidate = block.repair_state ? applySourceJobCorrections(call, block.repair_state, protocol, { sourceItems: request.items }) : protocol;
            const checked = evaluatePendingProposal(call, candidate, { chunks, allChunks: row.staged.plan.chunks, mode: 'world', pendingUnits: request.pending_units });
            block.result.push(...checked.records);
            if(checked.projections?.length){block.projections??=[];block.projections.push({attempt_id:attempt.attempt_id,projections:clone(checked.projections)})}
            if (checked.fieldCandidates) block.field_candidates = clone(checked.fieldCandidates);
            block.completed_units = [...new Set([...block.completed_units, ...checked.passedUnits])];
            const errors = Object.entries(checked.errors ?? {});
            block.status = call.units.every(unit => block.completed_units.includes(unit)) ? 'succeeded' : 'failed';
            block.error = block.status === 'failed' ? { stage: 'validation', message: errors.map(([unit, message]) => unit + ': ' + message).join('; ') } : null;
            if (block.status === 'failed' && checked.proposal) block.repair_state = { proposal: clone(checked.proposal), repair: clone(checked.repair ?? []) };
            else delete block.repair_state;
        }
    } catch (error) {
        block.status = 'failed'; block.error = { stage: 'validation', message: String(error.message) };
    }
    if (block.status === 'failed') block.previous = { attempt_id: attempt.attempt_id, error: block.error.message, response: receipt.text };
    return { pipeline: stored(row), outcome: block.status };
}
