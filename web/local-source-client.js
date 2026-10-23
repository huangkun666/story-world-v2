import {parseModelJson} from '../src/model-json.js';
import { sha256Hex, operationId } from '../src/browser-capabilities.js';
import { sourceWorld } from '../src/source-world.js';
import { validateSourceRecords, extractionPrompt, batchExtractionPrompt, canonicalSourceJson, sourceText, sourceLocalId } from '../src/source-records.js';
import { planSourceBatches, groupBatchResponse, batchIdentityIndex, resolveSourceRecords, freezeSourceBatchConfig, codepointLength, charBudget } from '../src/source-batching.js';
import { SETTING_CHUNK_CHAR } from '../src/abstract-limits.js';
import { EXTRACT_CONCURRENCY } from '../src/abstract.js';
import { modeStagePlan, deriveOutputBudget } from '../src/source-stages.js';
import { createStagedRunner } from './local-source-stages.js';
import {SOURCE_FIELD_PROTOCOL,confirmFieldTable,validateConfirmedFieldTable} from '../src/source-field-table.js';
import {SOURCE_MERGE_PROTOCOL,buildIdentityReview,buildFieldReview} from '../src/source-semantic-merge.js';
import {completeSourceJobs} from '../src/source-jobs.js';
import {SOURCE_FINALIZATION_PROTOCOL,freezeFinalizationFoundation} from '../src/source-finalization.js';
import {SOURCE_WORKSPACE_PROTOCOL,createSourceWorkspace,queueWorkspaceRevision,requestWorkspaceCollection} from '../src/source-workspace.js';
import {workspacePublication,validateFinalizedPublication,isFinalizedPublication,freezeInitialState} from '../src/finalized-source.js';
import {sourceTaskDiagnostics} from '../src/source-task-diagnostics.js';
import {authorizeWorkspaceCorrection,workspaceRecoveryOffer,applyWorkspaceMigration} from '../src/source-workspace.js';
export {canReassembleSourceImport} from './local-source-stages.js';

const liveClients=new Map();
const copy=value=>JSON.parse(canonicalSourceJson(value));
const equal=(a,b)=>canonicalSourceJson(a)===canonicalSourceJson(b);
const terminal=row=>['published','cancelled'].includes(row.status);
const ACTIVE_BATCH=['pending','requested','received'];
function error(message,status=409) {const e=new Error(message);e.status=status;return e;}
// 模型失败的落库文案只留"人话分类"。原始 err.message 可能带供应商地址/令牌，绝不落库、绝不回显。
const CALL_FAILURE_TEXT={'invalid-json':'模型返回的抽象 JSON 不完整或格式不正确，本次结果未采用','stream-incomplete':'模型响应中途断开，未取得完整抽象结果，请重新抽象',timeout:'模型请求超时，未取得返回',cancelled:'模型请求已停止，未取得返回',
    truncated:'模型输出被截断，本任务原文和结果已保留，请核对抽取输出容量后继续',truncation:'模型输出被截断，本任务原文和结果已保留，请核对抽取输出容量后继续',
    empty:'模型返回为空，本次没有生成抽象结果',provider:'模型服务报错，本次没有生成抽象结果'};
const CALL_FAILURE_FALLBACK='抽象调用失败，未取得返回；详情见调试';
const UNCONFIGURED_CHANNEL='模型通道未配置，请填写已有模型 API 设置';
export function safeCallFailureText(cause,aborted=false) {
    if(cause?.name==='AbortError' || cause?.sw2Cancelled || aborted)return CALL_FAILURE_TEXT.cancelled;
    const type=cause?.sw2CallFailure?.type;
    if(type==='internal')return '抽象调用失败（'+cause.sw2CallFailure.stage+'）：'+cause.sw2CallFailure.safeMessage;
    if(type==='network')return '模型网络请求失败，未取得返回；详情见调试';
    if(type==='http'&&cause.sw2CallFailure.code==='upstream_capacity_exhausted')return '模型服务上游容量不足，本次抽象未完成，请稍后重试';
    if(type==='http'){const status=cause?.sw2CallFailure?.status;if(cause?.sw2ContextLength)return '模型上下文不足，请调整模型容量或每包抽取目标';if(Number.isInteger(status)&&status>=100&&status<=599)return '模型接口返回 HTTP '+status+'，请检查模型接口设置';}
    if(typeof type==='string' && Object.hasOwn(CALL_FAILURE_TEXT,type))return CALL_FAILURE_TEXT[type];
    const message=cause?.message;
    if(typeof message==='string' && message.includes('模型通道未配置'))return UNCONFIGURED_CHANNEL;
    return CALL_FAILURE_FALLBACK;
}
function safeVersion(version,positive=false) {
    if(!Number.isSafeInteger(version) || version<(positive?1:0))throw new TypeError('invalid source version');
}
function readEntries(entries) {
    if(!Array.isArray(entries) || !entries.length)throw new TypeError('entries must be nonempty complete source entries');
    const result=copy(entries),ids=new Set();
    for(const entry of result) {
        if(!entry || typeof entry!=='object' || Array.isArray(entry) || Object.keys(entry).some(k=>!['source_id','content','metadata'].includes(k)))throw new TypeError('source entry shape invalid');
        sourceText(entry.source_id,'source_id');if(ids.has(entry.source_id))throw new TypeError('source_id must be unique');ids.add(entry.source_id);
        if(typeof entry.content!=='string' || !entry.content.trim())throw new TypeError('source content must be nonempty original string');
        if(!entry.metadata || typeof entry.metadata!=='object' || Array.isArray(entry.metadata))throw new TypeError('source metadata must be JSON object');
    }
    return result;
}
/** Browser-only source service. Uses the canonical journal source tables; no model I/O inside transactions. */
export function createLocalSourceClient({journal,model,extractorKey='browser-source-v1',onStatus=()=>{},
    chunkChars=SETTING_CHUNK_CHAR,concurrency=EXTRACT_CONCURRENCY,outputTokens=32768,initialize=sourceWorld}={}) {
    if(!journal?.db?.imports || typeof journal.initialize!=='function')throw new TypeError('canonical source journal is required');
    sourceText(extractorKey,'extractorKey');
    // Static values are validated eagerly; function providers are resolved at every task boundary.
    if(typeof chunkChars!=='function')freezeSourceBatchConfig({chunkChars,concurrency:typeof concurrency==='function'?1:concurrency});
    else if(typeof concurrency!=='function')freezeSourceBatchConfig({chunkChars:SETTING_CHUNK_CHAR,concurrency});
    const db=journal.db,clientId=operationId(),controllers=new Map(),stagedExecutions=new Map();let closed=false;
    const ownerKey=id=>db.name+':'+id;
    liveClients.set(ownerKey(clientId),{controllers,stagedExecutions,dbName:db.name});
    const executionKey=(libraryId,importId)=>JSON.stringify([libraryId,importId]);
    const isAttemptLive=(row,attempt)=>{
        const owner=liveClients.get(ownerKey(attempt.client_id));
        return !!owner&&(attempt.kind!=='staged'||owner.controllers.has(attempt.attempt_id)||owner.stagedExecutions?.has(executionKey(row.library_id,row.import_id)));
    };
    const isExecuting=row=>!!row.staged&&[...liveClients.values()].some(owner=>owner.dbName===db.name&&owner.stagedExecutions?.has(executionKey(row.library_id,row.import_id)));

    function notify(status){try{onStatus(copy(status));}catch{/* Diagnostics cannot change durable execution. */}}
    function open(){if(closed)throw error('source client is closed');}
    function ids(libraryId,importId=null){sourceText(libraryId,'library_id');if(importId!==null)sourceText(importId,'import_id');}
    async function readImport(libraryId,importId) {
        ids(libraryId,importId);const row=await db.imports.get([libraryId,importId]);
        if(!row)throw error('source import not found',404);return row;
    }
    const itemOf=(row,sourceId)=>{
        sourceText(sourceId,'source_id');const item=row.items.find(item=>item.source_id===sourceId);
        if(!item)throw error('source not found in this import',404);return item;
    };
    const attemptOf=(row,item)=>row.execution.attempts.find(a=>a.attempt_id===item.attempt_id);
    const attemptOfBatch=(row,batch)=>batch?.attempt_id?row.execution.attempts.find(a=>a.attempt_id===batch.attempt_id):null;
    function batchOf(row,batchId) {
        sourceText(batchId,'batch_id');const batch=(row.batches??[]).find(b=>b.batch_id===batchId);
        if(!batch)throw error('source batch not found in this import',404);return batch;
    }
    async function change(libraryId,importId,fn) {
        open();return db.transaction('rw',db.imports,async()=>{
            const row=await readImport(libraryId,importId),value=await fn(row);await db.imports.put(row);return copy(value??row);
        });
    }
    function publicState(row,{includeResponses=true}={}) {
        const result=copy({library_id:row.library_id,import_id:row.import_id,status:row.status,items:row.items,
            execution:{running:isExecuting(row)||row.execution.attempts.some(a=>a.outcome==='requested'&&isAttemptLive(row,a)),attempts:includeResponses?row.execution.attempts:row.execution.attempts.map(({response,provider_response,request,dispatches,...rest})=>rest)},
            ...(row.batch_config?{batch_config:row.batch_config}:{}),
            ...(Array.isArray(row.batches)?{batches:row.batches}:{}),
            ...(row.staged?{staged:includeResponses?row.staged:{protocol:row.staged.protocol??'staged-v1',mode:row.staged.mode,status:row.staged.status,completed:row.staged.completed,failure:row.staged.failure,...(row.staged.capacity?{capacity:row.staged.capacity}:{}),...(row.staged.field_review?{field_review:row.staged.field_review}:{}),blocks:Object.fromEntries(Object.entries(row.staged.blocks).map(([id,{result,...block}])=>[id,block]))}}:{}),
            ...(row.receipt?{receipt:row.receipt}:{})});return result;
    }
    async function liveConfig(context) {
        const chunk=typeof chunkChars==='function'?await chunkChars(copy(context)):chunkChars;
        const parallel=typeof concurrency==='function'?await concurrency(copy(context)):concurrency;
        return freezeSourceBatchConfig({chunkChars:chunk,concurrency:parallel});
    }
    // New staged imports (extraction_mode supplied) run thin identities first, then attributes,
    // relations and setting/scales in separate validated calls. Legacy rows never enter this runner.
    const readOutputBudget=async()=>deriveOutputBudget(typeof outputTokens==='function'?await outputTokens({}):outputTokens);
    const staged=createStagedRunner({
        change,readImport,terminal,copy,error,notify,model,clientId,controllers,liveClients,ownerKey,stagedExecutions,executionKey,isAttemptLive,
        failureText:(cause,aborted)=>safeCallFailureText(cause,aborted),
        resolveConfig:()=>liveConfig({library_id:null,import_id:null}),
        resolveOutputBudget:readOutputBudget,
    });
    /** Deterministically plan the still-unassigned pending sources into new durable batches. */
    function ensurePlanned(row,config) {
        row.batches??=[];if(!row.batch_config)row.batch_config=copy(config);
        const frozen=row.batch_config,assigned=new Set();
        for(const batch of row.batches)if(ACTIVE_BATCH.includes(batch.status))for(const pinned of batch.sources)assigned.add(pinned.source_id);
        const pending=row.items.filter(item=>item.status==='pending'&&!assigned.has(item.source_id));
        if(!pending.length)return;
        const entryOf=new Map(row.entries.map(entry=>[entry.source_id,entry]));
        const plans=planSourceBatches(pending.map(item=>({source_id:item.source_id,content:entryOf.get(item.source_id).content,content_hash:item.content_hash})),frozen.chunk_chars);
        const used=new Set(row.batches.map(batch=>batch.batch_id));
        for(const plan of plans) {
            let unique=plan.batch_id,count=1;
            while(used.has(unique))unique=plan.batch_id+'-'+(++count);
            used.add(unique);
            row.batches.push({batch_id:unique,source_ids:[...plan.source_ids],chars:plan.chars,
                oversized_source_ids:[...plan.oversized_source_ids],chunk_chars:frozen.chunk_chars,
                sources:plan.sources.map(source=>({source_id:source.source_id,content_hash:source.content_hash})),
                status:'pending',attempt_id:null,client_id:null,error:null});
        }
    }
    /** Pin exactly one requested source as its own batch. Direct claim() stays source-scoped even
     * when other pending sources could otherwise be packed with it. */
    function ensureSingletonBatch(row,sourceId,config) {
        row.batches??=[];if(!row.batch_config)row.batch_config=copy(config);
        const frozen=row.batch_config,item=itemOf(row,sourceId);
        const active=row.batches.find(batch=>ACTIVE_BATCH.includes(batch.status)&&batch.source_ids.includes(sourceId));
        if(active)return active;
        const entry=row.entries.find(candidate=>candidate.source_id===sourceId);
        const plan=planSourceBatches([{source_id:sourceId,content:entry.content,content_hash:item.content_hash}],frozen.chunk_chars)[0];
        const used=new Set(row.batches.map(batch=>batch.batch_id));let unique=plan.batch_id,count=1;
        while(used.has(unique))unique=plan.batch_id+'-'+(++count);
        const batch={batch_id:unique,source_ids:[...plan.source_ids],chars:plan.chars,
            oversized_source_ids:[...plan.oversized_source_ids],chunk_chars:frozen.chunk_chars,
            sources:plan.sources.map(source=>({source_id:source.source_id,content_hash:source.content_hash})),
            status:'pending',attempt_id:null,client_id:null,error:null};
        row.batches.push(batch);return batch;
    }
    function claimBatchRow(row,batch) {
        const attempt_id=operationId(),singleton=batch.source_ids.length===1;
        batch.status='requested';batch.attempt_id=attempt_id;batch.client_id=clientId;
        for(const pinned of batch.sources) {
            const item=itemOf(row,pinned.source_id);
            if(item.status!=='pending')throw error('source batch cannot claim a non-pending member');
            if(item.content_hash!==pinned.content_hash)throw error('source batch content hash changed');
            item.status='requested';item.attempt_id=attempt_id;item.batch_id=batch.batch_id;
        }
        row.execution.attempts.push({attempt_id,batch_id:batch.batch_id,source_ids:[...batch.source_ids],
            source_id:singleton?batch.source_ids[0]:null,
            content_hash:singleton?batch.sources[0].content_hash:null,
            client_id:clientId,outcome:'requested',response:null,usage:null,error:null});
        return {claimed:true,attempt_id,batch_id:batch.batch_id,source_ids:[...batch.source_ids],
            source_id:singleton?batch.source_ids[0]:null,
            content_hash:singleton?batch.sources[0].content_hash:null,
            sources:batch.sources.map(pinned=>({...pinned}))};
    }
    async function reconcile(libraryId,importId,project=publicState) {
        const update=row=>{let changed=false;
            if(row.staged && staged.reconcileRow(row))changed=true;
            for(const item of row.items) {
                if(item.status!=='requested')continue;const attempt=attemptOf(row,item);
                if(attempt?.failure){changed=true;item.status=attempt.outcome==='unknown'?'unknown':'failed';continue;}
                if(attempt?.response!==null && attempt?.response!==undefined)continue;
                if(attempt && !liveClients.has(ownerKey(attempt.client_id))) {
                    changed=true;item.status='unknown';attempt.outcome='unknown';attempt.error={stage:'model',message:'Request was sent; no durable response exists. Do not automatically reissue.'};
                }
            }
            for(const batch of row.batches??[]) {
                if(batch.status!=='requested')continue;
                const attempt=attemptOfBatch(row,batch);
                if(attempt?.failure){changed=true;batch.status=attempt.outcome==='unknown'?'unknown':'failed';continue;}
                if(attempt?.response!==null && attempt?.response!==undefined){changed=true;batch.status='received';continue;}
                if(attempt && liveClients.has(ownerKey(attempt.client_id)))continue;
                changed=true;batch.status='unknown';
            }

            return changed;
        };
        const row=await readImport(libraryId,importId);
        if(!update(row))return project(row);
        return change(libraryId,importId,current=>{update(current);return project(current)});
    }
    /** Persist exactly one durable raw response/usage for a whole batch before any conversion. */
    async function saveBatchResponse(libraryId,importId,batchId,claim,response,usage,receipt={}) {
        response=copy(response);usage=usage===undefined?null:copy(usage);
        return change(libraryId,importId,row=>{
            const batch=batchOf(row,batchId),attempt=attemptOfBatch(row,batch);
            if(batch.attempt_id!==claim.attempt_id || !attempt)throw error('source batch response claim mismatch');
            if(attempt.response!==null && attempt.response!==undefined && !equal(attempt.response,response))throw error('source response immutable');
            attempt.response=response;attempt.usage=usage;attempt.outcome='received';
            if(typeof receipt.provider_response==='string'){if(attempt.provider_response!==undefined&&!equal(attempt.provider_response,receipt.provider_response))throw error('provider response immutable');attempt.provider_response=receipt.provider_response;}
            if(receipt.failure){attempt.failure=copy(receipt.failure);attempt.error={stage:'transport',message:receipt.failure.message};attempt.outcome=receipt.unconfirmed?'unknown':'failed';}
            if(terminal(row)){
                if(batch.status!=='succeeded')batch.status='cancelled';
                for(const source of batch.sources){const item=itemOf(row,source.source_id);if(item.attempt_id===claim.attempt_id&&['requested','unknown'].includes(item.status))item.status='cancelled';}
            }else if(receipt.failure){batch.status=attempt.outcome;for(const source of batch.sources){const item=itemOf(row,source.source_id);if(item.attempt_id===claim.attempt_id&&['requested','unknown'].includes(item.status))item.status=attempt.outcome}}
            else batch.status='received';
            return row;
        });
    }
    async function failSources(libraryId,importId,batchId,stage,message,unknown=false) {
        return change(libraryId,importId,row=>{
            const batch=batchOf(row,batchId),attempt=attemptOfBatch(row,batch);
            if(attempt){attempt.error={stage,message};attempt.outcome=unknown?'unknown':'failed';}
            batch.status=unknown?'unknown':'failed';
            if(!terminal(row))for(const pinned of batch.sources) {
                const item=itemOf(row,pinned.source_id);
                if(item.attempt_id===batch.attempt_id&&item.status==='requested')item.status=unknown?'unknown':'failed';
            }
            return publicState(row);
        });
    }
    async function failSource(libraryId,importId,sourceId,claim,stage,message) {
        return change(libraryId,importId,row=>{
            const item=itemOf(row,sourceId);if(item.attempt_id!==claim.attempt_id)throw error('source failure claim mismatch');
            const attempt=attemptOf(row,item);if(!attempt)throw error('source failure requires an attempt');
            attempt.error??={stage,message};attempt.errors??=[];attempt.errors.push({source_id:sourceId,stage,message});
            if(!terminal(row)&&item.status==='requested')item.status='failed';
            return publicState(row);
        });
    }
    async function finishBatch(libraryId,importId,batchId) {
        return change(libraryId,importId,row=>{
            const batch=batchOf(row,batchId),attempt=attemptOfBatch(row,batch);
            const statuses=batch.sources.map(pinned=>itemOf(row,pinned.source_id).status);
            if(statuses.every(status=>status==='succeeded')){batch.status='succeeded';if(attempt)attempt.outcome='succeeded';}
            else if(statuses.some(status=>status==='failed'||status==='unknown')) {
                batch.status=statuses.some(status=>status==='unknown')?'unknown':'failed';
                if(attempt)attempt.outcome=batch.status;
            }
            return publicState(row);
        });
    }
    /** Convert one durable raw response into per-source candidates. Grouping is validated before
     * any candidate is written; per-source shape errors only fail that member. */
    async function convertBatch(libraryId,importId,batchId,raw) {
        const row=await readImport(libraryId,importId);if(terminal(row))return;
        const batch=batchOf(row,batchId),attempt=attemptOfBatch(row,batch);
        if(!attempt || attempt.response===null || attempt.response===undefined)throw error('source batch conversion requires a durable raw response');
        if(attempt.failure)return;
        let protocol;try{protocol=typeof raw==='string'?parseModelJson(raw):raw;}catch(e){await failSources(libraryId,importId,batchId,'validation',e.message);return;}
        let grouped;try{grouped=groupBatchResponse(protocol,batch.sources.map(pinned=>pinned.source_id));}catch(e){await failSources(libraryId,importId,batchId,'validation',e.message);return;}
        const pinned=new Map(batch.sources.map(entry=>[entry.source_id,entry]));
        const sources=grouped.map(group=>({source_id:group.source_id,content_hash:pinned.get(group.source_id).content_hash,records:group.records}));
        let index;try{index=batchIdentityIndex(sources);}catch(e){await failSources(libraryId,importId,batchId,'validation',e.message);return;}
        // Successful sources retain their stable identity keys when another member is retried alone.
        // Only keys proven to belong to an existing validated candidate may enter this index.
        for(const candidate of row.candidates??[]) {
            const item=itemOf(row,candidate.source_id);if(item.status!=='succeeded')continue;
            const formal=new Set(candidate.records.filter(record=>['entity','location'].includes(record.record_kind)).map(record=>record.id));
            const add=(key,id)=>{if(!index.has(key))index.set(key,new Set());index.get(key).add(id)};
            for(const id of formal)add(id,id);
            index.kindById??=new Map();
            for(const record of candidate.records)if(formal.has(record.id))index.kindById.set(record.id,record.record_kind);
            const previous=attemptOf(row,item);if(previous?.response==null)continue;
            try {
                const protocol=typeof previous.response==='string'?parseModelJson(previous.response):previous.response;
                const ids=previous.source_ids??[candidate.source_id];
                const prior=groupBatchResponse(protocol,ids).find(group=>group.source_id===candidate.source_id);
                for(const record of prior?.records??[])if(typeof record.local_key==='string'){
                    const id=sourceLocalId(item.content_hash,record.local_key);if(formal.has(id))add(record.local_key,id);
                }
            } catch {/* A malformed old response cannot grant a new identity. */}
        }
        for(const source of sources) {
            try {
                const records=resolveSourceRecords(source,index,{deferReferences:true});
                const explicit_ids=source.records.filter(record=>Object.hasOwn(record,'id')).map(record=>record.id);
                await client.saveCandidate(libraryId,importId,source.source_id,{batch_id:batchId,content_hash:source.content_hash,attempt_id:batch.attempt_id,records,graph_ids:{},explicit_ids});
            } catch(e) {
                await failSource(libraryId,importId,source.source_id,{attempt_id:batch.attempt_id,content_hash:source.content_hash},'validation',e.message);
            }
        }
        await finishBatch(libraryId,importId,batchId);
    }
    async function runBatch(libraryId,importId,batchId) {
        let row=await readImport(libraryId,importId);if(terminal(row))return;
        let batch=batchOf(row,batchId),attempt=attemptOfBatch(row,batch);
        if(batch.status==='received' || (attempt?.response!==null && attempt?.response!==undefined && ['requested','received'].includes(batch.status))) {
            await convertBatch(libraryId,importId,batchId,attempt.response);return;
        }
        if(batch.status!=='pending')return;
        if(typeof model!=='function')throw error('source model interface is unavailable',503);
        const claim=await client.claimBatch(libraryId,importId,batchId);if(!claim.claimed)return;
        row=await readImport(libraryId,importId);if(terminal(row))return;
        batch=batchOf(row,batchId);attempt=attemptOfBatch(row,batch);
        const controller=new AbortController();
        controllers.set(claim.attempt_id,{libraryId,importId,batchId,controller});
        const entries=[];
        for(const pinned of batch.sources) {
            const entry=row.entries.find(candidate=>candidate.source_id===pinned.source_id);
            const item=itemOf(row,pinned.source_id);
            if(!entry || item.attempt_id!==claim.attempt_id || item.content_hash!==pinned.content_hash)throw error('source batch pin changed before send');
            entries.push(entry);
            const chars=codepointLength(entry.content),budget=charBudget(batch.chunk_chars);
            if(chars>budget)notify({code:'oversized-entry',library_id:libraryId,import_id:importId,source_id:pinned.source_id,batch_id:batchId,chars,budget:batch.chunk_chars,
                message:'Complete source entry retained in one request; entry exceeds selected character budget.'});
            notify({code:'source-requested',library_id:libraryId,import_id:importId,source_id:pinned.source_id,attempt_id:claim.attempt_id,batch_id:batchId,source_ids:[...batch.source_ids]});
        }
        notify({code:'source-batch-requested',library_id:libraryId,import_id:importId,batch_id:batchId,source_ids:[...batch.source_ids],chars:batch.chars,
            message:`一次请求抽取 ${batch.source_ids.length} 个完整来源`});
        try {
            row=await readImport(libraryId,importId);if(terminal(row))return;
            const options={signal:controller.signal,task:'source-extraction',library_id:libraryId,import_id:importId,
                onDispatch:summary=>change(libraryId,importId,current=>{const a=current.execution.attempts.find(a=>a.attempt_id===claim.attempt_id);if(!a)throw error('请求登记已不存在，未发送');a.dispatches??=[];a.dispatches.push(structuredClone(summary));return current;}),
                batch_id:batchId,content_hashes:batch.sources.map(pinned=>pinned.content_hash),attempt_id:claim.attempt_id,extractor_key:row.extractor_key};
            if(batch.source_ids.length===1){options.source_id=batch.source_ids[0];options.content_hash=batch.sources[0].content_hash;}
            else options.source_ids=[...batch.source_ids];
            const prompt=batch.source_ids.length===1?extractionPrompt([entries[0]]):batchExtractionPrompt(entries);
            const result=await model(prompt,options);
            const raw=typeof result==='string'?result:(result?.text??result?.response);
            if(raw===undefined || raw===null)throw new TypeError('model returned no source response');
            await saveBatchResponse(libraryId,importId,batchId,claim,raw,result?.usage??null,{...(typeof result?.provider_response==='string'?{provider_response:result.provider_response}:{}),...(result?.failure?{failure:result.failure,unconfirmed:result.unconfirmed===true}:{})});
            if(result?.failure)return;
            row=await readImport(libraryId,importId);if(terminal(row))return;
            try{await convertBatch(libraryId,importId,batchId,raw);}
            catch(e){row=await readImport(libraryId,importId);if(!terminal(row))await failSources(libraryId,importId,batchId,'validation',e.message);}
        } catch(e) {
            // Preserve a safe stage/outcome; provider messages may include credentials.
            const latest=await readImport(libraryId,importId).catch(()=>null);
            if(latest && !terminal(latest)) {
                const latestBatch=batchOf(latest,batchId),latestAttempt=attemptOfBatch(latest,latestBatch);
                if(latestAttempt?.failure)return;
                if(latestAttempt?.response!==null && latestAttempt?.response!==undefined) {
                    try{await convertBatch(libraryId,importId,batchId,latestAttempt.response);}catch{/* Retained raw response can be reprocessed later. */}
                } else await failSources(libraryId,importId,batchId,'model',safeCallFailureText(e,controller.signal.aborted),true);
            }
        } finally {controllers.delete(claim.attempt_id);}
    }
    const client={
        async connect({rulesFingerprint=null}={}) {
            open();return {contract_version:1,rules_contract_version:1,data_version:1,source_contract_version:1,
                rules_fingerprint:rulesFingerprint??'browser-shared-world-v1',source_execution:{available:typeof model==='function',extractor_key:extractorKey}};
        },
        async createLibrary(libraryId) {
            open();ids(libraryId);return db.transaction('rw',db.libraries,async()=>{
                const old=await db.libraries.get(libraryId);if(!old)await db.libraries.add({library_id:libraryId,version:0});
                return {library_id:libraryId,version:old?.version??0};
            });
        },
        async getLibrary(libraryId) {
            open();ids(libraryId);const row=await db.libraries.get(libraryId);if(!row)throw error('source library not found',404);return copy(row);
        },
        async beginImport(libraryId,{import_id,entries,extractor_key=extractorKey,extraction_mode=null,extraction_protocol='staged-v1',foundation=null}={}) {
            open();ids(libraryId,import_id);sourceText(extractor_key,'extractor_key');
            // A supplied extraction mode opts this NEW import into the staged pipeline; absent mode
            // keeps the established single-request API for legacy/manual claims and old fixtures.
            if(!['staged-v1','source-groups-v1','source-jobs-v1','source-jobs-v2','source-jobs-v3','source-jobs-v4','source-jobs-v5',SOURCE_FIELD_PROTOCOL,SOURCE_FINALIZATION_PROTOCOL,SOURCE_WORKSPACE_PROTOCOL].includes(extraction_protocol))throw error('unknown extraction protocol');
            const fixedFoundation=extraction_protocol===SOURCE_FINALIZATION_PROTOCOL||extraction_protocol===SOURCE_WORKSPACE_PROTOCOL&&foundation!==null?freezeFinalizationFoundation(foundation,{allowEmptyEntities:extraction_protocol===SOURCE_WORKSPACE_PROTOCOL}):null;
            if(extraction_protocol===SOURCE_WORKSPACE_PROTOCOL&&extraction_mode!=='world')throw error('共享定稿协议只用于完整世界抽取');
            if(fixedFoundation&&extraction_mode!=='world')throw error('隔离定稿协议只用于完整世界草稿');
            if(!fixedFoundation&&foundation!==null)throw error('旧协议不接受新的定稿底稿');
            if(['source-groups-v1','source-jobs-v1','source-jobs-v2','source-jobs-v3','source-jobs-v4','source-jobs-v5',SOURCE_FIELD_PROTOCOL].includes(extraction_protocol) && extraction_mode==null)throw error('grouped extraction protocol needs a mode');
            if(extraction_protocol===SOURCE_FIELD_PROTOCOL&&extraction_mode!=='world')throw error('字段确认协议目前只用于完整世界抽取，旧模式保持原流程');
            if(extraction_mode!==null && extraction_mode!==undefined)modeStagePlan(extraction_mode);
            const original=readEntries(entries),items=original.map(e=>({source_id:e.source_id,content_hash:sha256Hex(e.content),status:'pending',attempt_id:null,batch_id:null}));
            const row=await db.transaction('rw',db.libraries,db.imports,async()=>{
                if(!await db.libraries.get(libraryId))throw error('source library not found',404);
                const old=await db.imports.get([libraryId,import_id]);if(old) {
                    if(old.extractor_key!==extractor_key || !equal(old.entries,original) || (old.extraction_mode??null)!==(extraction_mode??null) || (old.staged?.protocol??'staged-v1')!==extraction_protocol || fixedFoundation&&!equal(old.staged?.finalization?.foundation,fixedFoundation))throw error('same import inputs immutable; changed input refused');return old;
                }
                const next={library_id:libraryId,import_id,extractor_key,entries:original,status:'draft',items,execution:{attempts:[]},candidates:[],batch_config:null,batches:[]};
                if(extraction_mode!==null && extraction_mode!==undefined) {
                    next.extraction_mode=extraction_mode;
                    next.staged={library_id:libraryId,import_id,protocol:extraction_protocol,mode:extraction_mode,status:'pending',plan:null,blocks:{},completed:[],
                        directory:null,attribute_fields:null,relations:null,settings:null,diagnostics:null,failure:null};
                    if(extraction_protocol===SOURCE_WORKSPACE_PROTOCOL)next.staged.delivery_version=foundation===null?2:1;
                    if(extraction_protocol===SOURCE_FIELD_PROTOCOL)next.staged.semantic_merge={protocol:SOURCE_MERGE_PROTOCOL,status:'pending',phases:{},decisions:[],unresolved:[]};
                    if(fixedFoundation)next.staged.finalization={protocol:extraction_protocol,foundation:fixedFoundation,status:'pending',result:null};
                    if(extraction_protocol===SOURCE_WORKSPACE_PROTOCOL&&fixedFoundation)next.staged.workspace=createSourceWorkspace(fixedFoundation);
                }
                await db.imports.add(next);return next;
            });return publicState(row);
        },
        async getImport(libraryId,importId){open();return reconcile(libraryId,importId);},
        async getTaskDiagnostics(libraryId,importId){return sourceTaskDiagnostics(await readImport(libraryId,importId));},
        async getWorkspaceRecovery(libraryId,importId){const row=await readImport(libraryId,importId);return copy(workspaceRecoveryOffer(row,{running:isExecuting(row),outputBudget:await readOutputBudget()}));},
        async requestWorkspaceCorrection(libraryId,importId,input){const outputBudget=await readOutputBudget();return change(libraryId,importId,row=>{
            if(isExecuting(row))throw error('任务仍在执行');
            if(input?.recovery){
                sourceText(input.request_id,'request_id');
                const prior=row.staged?.plan_revisions?.find(r=>r.request_id===input.request_id);
                if(prior){if(prior.offer_token!==input.recovery.token)throw error('同号合包确认输入不可变');return publicState(row);}
                const current=workspaceRecoveryOffer(row,{outputBudget});if(!['correct','migrate'].includes(current.kind)||current.token!==input.recovery.token)throw error('失败任务、设置或回执已改变，请重新打开并确认；未发送请求');
                const oldPlan=current.output_change?copy(row.staged.plan):null;
                if(current.migration)applyWorkspaceMigration(row,{request_id:input.request_id,preview:current.migration,offer_token:current.token});
                for(const f of current.failures)authorizeWorkspaceCorrection(row,{call_id:f.call_id,request_id:input.request_id+':'+f.call_id,expected_revision:current.workspace_revision,expected_attempt_id:f.attempt_id,...(current.output_change?{output_budget:outputBudget,reference_encoding:current.output_change.reference_encoding}:{})});
                if(current.output_change){
                    row.staged.plan_revisions??=[];let revision=row.staged.plan_revisions.find(r=>r.request_id===input.request_id);
                    if(!revision){revision={request_id:input.request_id,input_hash:current.output_change.input_hash,offer_token:current.token,plan:oldPlan,replaced_call_ids:[]};row.staged.plan_revisions.push(revision);}
                    revision.output_change=copy(current.output_change);row.staged.plan.output_budget=copy(outputBudget);
                }
            }else authorizeWorkspaceCorrection(row,input);
            return publicState(row);
        });},
        async requestWorkspaceRevision(libraryId,importId,input){
            open();return change(libraryId,importId,row=>publicState(queueWorkspaceRevision(row,input)));
        },
        async requestWorkspaceFieldCollection(libraryId,importId,input){
            open();return change(libraryId,importId,row=>publicState(requestWorkspaceCollection(row,input)));
        },
        async getSemanticPreview(libraryId,importId){
            open();const row=await readImport(libraryId,importId);if(row.staged?.semantic_merge)return copy(row.staged.semantic_merge);
            const calls=row.staged?.plan?.calls;
            if(!['source-jobs-v4','source-jobs-v5',SOURCE_FIELD_PROTOCOL].includes(row.staged?.protocol)||!Array.isArray(calls)||!calls.length||!calls.every(c=>row.staged.blocks[c.call_id]?.status==='succeeded'))return {status:'unavailable',reason:'此旧任务缺少当前格式的完整分块结果；不会自动重抽原文'};
            const candidates=calls.flatMap(c=>row.staged.blocks[c.call_id].result??[]),merged=completeSourceJobs(candidates,{locationConflicts:'preserve'}),context={entries:row.entries,chunks:row.staged.plan.chunks,fieldTable:row.staged.field_review?.confirmed??null,directory:merged.directory,settings:merged.settings};
            return copy({protocol:SOURCE_MERGE_PROTOCOL,status:'preview',provisional:true,phases:{identity:buildIdentityReview(candidates,context),field:buildFieldReview(candidates,merged,context)},realCalls:0});
        },
        async beginSemanticReconciliation(libraryId,{import_id,from_import_id,retry_group_ids=[]}={}){
            open();ids(libraryId,import_id);sourceText(from_import_id,'from_import_id');
            const original=await readImport(libraryId,from_import_id);
            if(isExecuting(original))throw error('原抽象任务仍在执行');
            if(!['source-jobs-v4','source-jobs-v5',SOURCE_FIELD_PROTOCOL].includes(original.staged?.protocol))throw error('旧任务格式没有当前候选的精确身份关联，不能冒充空归并；需先单独评估回执转换');
            const calls=original.staged?.plan?.calls;
            if(!Array.isArray(calls)||!calls.length||!calls.every(c=>original.staged.blocks[c.call_id]?.status==='succeeded'))throw error('缺少完整已确认分块结果；不能无提示重抽或以空值归并');
            if(!Array.isArray(retry_group_ids)||new Set(retry_group_ids).size!==retry_group_ids.length)throw error('待重试组必须唯一');
            const next=copy(original);next.import_id=import_id;next.status='draft';delete next.receipt;delete next.publicationInput;
            next.execution={attempts:copy(original.execution.attempts)};next.staged.import_id=import_id;next.staged.status='pending';next.staged.failure=null;
            next.staged.semantic_merge={protocol:SOURCE_MERGE_PROTOCOL,status:'pending',phases:{},decisions:[],unresolved:[],derived_from:{library_id:libraryId,import_id:from_import_id}};
            for(const id of retry_group_ids){const b=next.staged.blocks[id];if(!b||!b.stage?.startsWith('semantic-')||b.status!=='failed')throw error('只允许显式重试确定失败的归并组；未知请求不能重发');delete next.staged.blocks[id];}
            next.candidates=[];for(const item of next.items){item.status='pending';item.attempt_id=null;}
            return db.transaction('rw',db.imports,async()=>{
                if(await db.imports.get([libraryId,import_id]))throw error('归并草稿ID已存在，不能覆盖');
                await db.imports.add(next);return publicState(next);
            });
        },
        async confirmFields(libraryId,importId,{fields,expected_revision}={}){
            open();ids(libraryId,importId);
            const row=await change(libraryId,importId,current=>{
                if(current.status==='cancelled')throw error('已取消的任务不能确认字段');
                const review=current.staged?.field_review;
                if(![SOURCE_FIELD_PROTOCOL,SOURCE_WORKSPACE_PROTOCOL].includes(current.staged?.protocol)||!review)throw error('当前任务没有待确认字段');
                if(review.revision!==expected_revision)throw error('字段候选已经改变，请重新读取 revision');
                if(isExecuting(current))throw error('抽象任务仍在执行，不能改变字段');
                const confirmed=confirmFieldTable(review.candidates,fields);
                if(review.confirmed){if(!equal(review.confirmed,confirmed))throw error('已确认字段不可更改，请另起任务');return current;}
                if(current.staged.status!=='awaiting-fields'||current.status!=='draft')throw error('当前任务不在字段确认阶段');
                review.confirmed=confirmed;current.staged.status='pending';return current;
            });
            return publicState(row);
        },
        async getDraftSnapshot(libraryId,importId,{includeOriginals=true}={}) {
            open();return reconcile(libraryId,importId,row=>({
                import:{...publicState(row,{includeResponses:includeOriginals}),...(includeOriginals?{entries:copy(row.entries),extractor_key:row.extractor_key}:{})},
                candidates:row.staged?.protocol===SOURCE_WORKSPACE_PROTOCOL?row.staged.workspace?.result?[{source_id:row.entries[0].source_id,records:workspacePublication(row,{library_id:libraryId,version:1}).records}]:[]:copy(row.candidates.filter(c=>row.items.some(i=>i.source_id===c.source_id&&i.status==='succeeded')))
            }));
        },
        async getImportInput(libraryId,importId) {
            open();const row=await readImport(libraryId,importId);return copy({library_id:libraryId,import_id:importId,entries:row.entries,extractor_key:row.extractor_key});
        },
        async claim(libraryId,importId,sourceId) {
            open();const original=await readImport(libraryId,importId),item=itemOf(original,sourceId);
            const base={library_id:libraryId,import_id:importId,source_id:sourceId,content_hash:item.content_hash,source_ids:[sourceId]};
            if(terminal(original) || item.status!=='pending')return {...base,claimed:false,attempt_id:item.attempt_id??null,batch_id:item.batch_id??null};
            const config=original.batch_config??await liveConfig({library_id:libraryId,import_id:importId});
            return change(libraryId,importId,row=>{
                const current=itemOf(row,sourceId);
                if(terminal(row) || current.status!=='pending')return {...base,claimed:false,attempt_id:current.attempt_id??null,batch_id:current.batch_id??null};
                const batch=ensureSingletonBatch(row,sourceId,config);
                return claimBatchRow(row,batch);
            });
        },
        async claimBatch(libraryId,importId,batchId) {
            open();const original=await readImport(libraryId,importId),batch=original.batches?batchOf(original,batchId):null;
            if(terminal(original)||!batch||batch.status!=='pending')return {claimed:false,batch_id:batchId,attempt_id:batch?.attempt_id??null,source_ids:batch?[...batch.source_ids]:[]};
            return change(libraryId,importId,row=>{
                const current=batchOf(row,batchId);
                if(terminal(row)||current.status!=='pending')return {claimed:false,batch_id:batchId,attempt_id:current.attempt_id??null,source_ids:[...current.source_ids]};
                return claimBatchRow(row,current);
            });
        },
        async executeImport(libraryId,importId) {
            open();
            const current=await readImport(libraryId,importId);
            if(current.staged)return staged.execute(libraryId,importId);
            await reconcile(libraryId,importId);
            let row=await readImport(libraryId,importId);if(terminal(row))return publicState(row);
            const assigned=new Set();
            for(const batch of row.batches??[])if(ACTIVE_BATCH.includes(batch.status))for(const pinned of batch.sources)assigned.add(pinned.source_id);
            const needsPlan=row.items.some(item=>item.status==='pending'&&!assigned.has(item.source_id));
            if(needsPlan) {
                const config=row.batch_config??await liveConfig({library_id:libraryId,import_id:importId});
                await change(libraryId,importId,current=>{if(terminal(current))return publicState(current);ensurePlanned(current,config);return publicState(current);});
                row=await readImport(libraryId,importId);if(terminal(row))return publicState(row);
            }
            const work=(row.batches??[]).filter(batch=>batch.status==='pending'
                || (batch.status==='requested' && attemptOfBatch(row,batch)?.response!==null && attemptOfBatch(row,batch)?.response!==undefined)
                || batch.status==='received');
            const config=row.batch_config??freezeSourceBatchConfig({chunkChars:SETTING_CHUNK_CHAR,concurrency:EXTRACT_CONCURRENCY});
            let cursor=0;
            await Promise.all(Array.from({length:Math.min(config.concurrency,work.length)},async()=>{
                while(cursor<work.length){const batch=work[cursor++];await runBatch(libraryId,importId,batch.batch_id);}
            }));return client.getImport(libraryId,importId);
        },
        async saveCandidate(libraryId,importId,sourceId,input) {
            const records=validateSourceRecords(input?.records,{deferReferences:true}),graph_ids=copy(input?.graph_ids??{}),explicit_ids=copy(input?.explicit_ids??records.map(record=>record.id));
            if(Object.keys(graph_ids).length)throw new TypeError('browser source records do not carry Graphiti mappings');
            if(!Array.isArray(explicit_ids) || explicit_ids.some(id=>!records.some(record=>record.id===id)))throw new TypeError('candidate explicit identity mismatch');
            const batch_id=input?.batch_id===undefined||input?.batch_id===null?null:sourceText(input.batch_id,'batch_id');
            const own=new Set(records.filter(record=>['entity','location'].includes(record.record_kind)).map(record=>record.id));
            const unresolved_refs=[...new Set(records.filter(record=>record.record_kind==='relation').flatMap(record=>[record.from_id,record.to_id]).filter(id=>!own.has(id)))];
            const candidate={library_id:libraryId,import_id:importId,source_id:sourceId,content_hash:input.content_hash,attempt_id:input.attempt_id,batch_id,records,graph_ids,explicit_ids,unresolved_refs};
            return change(libraryId,importId,row=>{
                const item=itemOf(row,sourceId);if(item.content_hash!==candidate.content_hash || item.attempt_id!==candidate.attempt_id)throw error('candidate content_hash/attempt_id claim mismatch');
                const old=row.candidates.find(c=>c.source_id===sourceId);
                if(old){if(!equal(old,candidate))throw error('candidate records immutable');return publicState(row);}
                if(terminal(row))throw error(`import ${row.status}; candidate refused`);
                if(!['requested','unknown'].includes(item.status) || !attemptOf(row,item))throw error('candidate requires existing requested claim');
                row.candidates.push(candidate);item.status='succeeded';attemptOf(row,item).outcome='succeeded';return publicState(row);
            });
        },
        async getCandidate(libraryId,importId,sourceId) {
            open();const row=await readImport(libraryId,importId);itemOf(row,sourceId);const candidate=row.candidates.find(c=>c.source_id===sourceId);
            if(!candidate)throw error('source candidate not found',404);return copy(candidate);
        },

        async reprocessImport(libraryId,importId) {
            open();
            const current=await readImport(libraryId,importId);
            if(current.staged)return staged.execute(libraryId,importId,{reassemble:true});
            await change(libraryId,importId,row=>{
                if(terminal(row))throw error('terminal import cannot reprocess');
                for(const item of row.items){const attempt=attemptOf(row,item);
                    if(item.status==='failed'&&attempt?.response!==null&&attempt?.response!==undefined&&attempt.error?.stage==='validation'){
                        attempt.errors??=[];attempt.errors.push(copy(attempt.error));item.status='requested';attempt.outcome='received';
                    }
                }
                for(const batch of row.batches??[]){const attempt=attemptOfBatch(row,batch);
                    if(batch.status==='failed'&&attempt?.response!==null&&attempt?.response!==undefined&&attempt.error?.stage==='validation'){batch.status='received';attempt.outcome='received';}
                }
                return publicState(row);
            });
            return client.executeImport(libraryId,importId);
        },

        async retry(libraryId,importId,sourceId) {
            const probe=await readImport(libraryId,importId);
            if(probe.staged)throw error('staged import retry is not supported; persisted stage results are reused and exhausted attempts are never reset');
            return change(libraryId,importId,row=>{
                if(terminal(row))throw error(`import ${row.status}; retry refused`);const item=itemOf(row,sourceId);
                if(item.status!=='failed')throw error('explicit retry is allowed for failed sources only');item.status='pending';item.attempt_id=null;item.batch_id=null;return publicState(row);
            });
        },
        async cancel(libraryId,importId) {
            const state=await change(libraryId,importId,row=>{
                if(terminal(row))return publicState(row);row.status='cancelled';
                if(row.staged)staged.cancelRow(row);
                for(const item of row.items)if(item.status==='pending')item.status='cancelled';else if(item.status==='requested')item.status='unknown';
                for(const batch of row.batches??[]){if(batch.status==='pending')batch.status='cancelled';else if(batch.status==='requested'||batch.status==='received')batch.status='unknown';}
                return publicState(row);
            });
            if(state.status==='cancelled')for(const [key,owner] of liveClients)if(key.startsWith(db.name+':'))for(const entry of owner.controllers.values()) {
                if(entry.libraryId===libraryId && entry.importId===importId)entry.controller.abort();
            }
            return state;
        },
        async publish(libraryId,importId,{expected_version,omitted_source_ids=[]}={}) {
            open();safeVersion(expected_version);if(!Array.isArray(omitted_source_ids))throw new TypeError('omissions must be array');
            const omitted=omitted_source_ids.map(s=>sourceText(s,'omitted source_id')).sort();if(new Set(omitted).size!==omitted.length)throw new TypeError('omissions must be unique');
            const publicationInput={expected_version,omitted_source_ids:omitted};
            const original=await readImport(libraryId,importId);
            staged.publishGuard(original);
            if(original.status==='published') {if(!equal(original.publicationInput,publicationInput))throw error('published import inputs immutable; changed omissions refused');return copy(original.receipt);}
            if(original.status==='cancelled')throw error('cancelled import cannot publish');
            if(original.staged?.protocol===SOURCE_WORKSPACE_PROTOCOL){
                if(omitted.length)throw error('完整定稿不可省略来源');
                const receipt={library_id:libraryId,import_id:importId,expected_version,version:expected_version+1,omitted_source_ids:[]};
                try{const bundle=workspacePublication(original,receipt);
                return await db.transaction('rw',db.libraries,db.imports,db.sourceVersions,async()=>{
                    const row=await readImport(libraryId,importId);
                    if(row.status==='published'){if(!equal(row.publicationInput,publicationInput))throw error('published import inputs immutable');return copy(row.receipt);}
                    if(!equal(row,original))throw error('定稿在发布期间已改变');
                    const library=await db.libraries.get(libraryId);
                    if(!library||library.version!==expected_version)throw error('stale expected source library version');
                    if(await db.sourceVersions.get([libraryId,receipt.version]))throw error('fixed source version already exists');
                    await db.sourceVersions.add(bundle);library.version=receipt.version;await db.libraries.put(library);
                    row.status='published';row.receipt=receipt;row.publicationInput=publicationInput;row.staged.finalization.status='complete';delete row.staged.publication_failure;await db.imports.put(row);return copy(receipt);
                });}catch(cause){
                    try{await change(libraryId,importId,current=>{
                        if(current.status==='draft'&&current.staged.workspace.revision===original.staged.workspace.revision&&equal(current.staged.workspace.result,original.staged.workspace.result)){
                            const failure={stage:'publication',message:String(cause.message),at:Date.now()};
                            current.staged.publication_failures??=[];current.staged.publication_failures.push(copy(failure));current.staged.publication_failure=failure;
                            current.staged.finalization.status='publication_failed';current.staged.status='workspace-publication_failed';
                        }return current;
                    });}catch{cause.sw2PublicationFailureUnrecorded=true;}
                    throw cause;
                }
            }
            const required=original.items.filter(i=>i.status!=='succeeded').map(i=>i.source_id).sort();
            if(!equal(required,omitted))throw error('exact omission list required for every non-succeeded source');
            const merged=new Map();
            for(const item of original.items.filter(i=>i.status==='succeeded')) {
                const candidate=original.candidates.find(c=>c.source_id===item.source_id);
                if(!candidate || candidate.attempt_id!==item.attempt_id || candidate.content_hash!==item.content_hash)throw error('source candidate claim mismatch');
                const records=validateSourceRecords(candidate.records,{deferReferences:true}),ref={source_id:item.source_id,content_hash:item.content_hash};
                for(const record of records) {
                    const existing=merged.get(record.id),explicit=candidate.explicit_ids.includes(record.id);
                    if(existing) {
                        if(!explicit || !existing.explicit || !equal(existing.record,record))throw error(`cross-source identity ${record.id} conflicts`);
                        existing.refs.push(ref);
                    } else merged.set(record.id,{record,explicit,refs:[ref]});
                }
            }
            const records=[...merged.values()].map(v=>({...v.record,source_refs:v.refs}));validateSourceRecords(records,{published:true});
            const sources=original.entries.map(entry=>({...entry,content_hash:itemOf(original,entry.source_id).content_hash,task_id:importId}));
            const receipt={library_id:libraryId,import_id:importId,expected_version,version:expected_version+1,omitted_source_ids:omitted};
            const bundle={...receipt,extractor_key:original.extractor_key,records,sources,...(original.staged?.field_review?.confirmed?{field_table:validateConfirmedFieldTable(original.staged.field_review.confirmed)}:{}),...(original.staged?.semantic_merge?{semantic_merge:copy(original.staged.semantic_merge)}:{})};
            return db.transaction('rw',db.libraries,db.imports,db.sourceVersions,async()=>{
                const row=await readImport(libraryId,importId);if(row.status==='published') {
                    if(!equal(row.publicationInput,publicationInput))throw error('published import inputs immutable');return copy(row.receipt);
                }
                if(!equal(row,original))throw error('source import changed during publication; inspect original import');
                const library=await db.libraries.get(libraryId);if(!library || library.version!==expected_version)throw error('stale expected source library version');
                if(await db.sourceVersions.get([libraryId,receipt.version]))throw error('fixed source version already exists');
                await db.sourceVersions.add(bundle);library.version=receipt.version;await db.libraries.put(library);
                row.status='published';row.receipt=receipt;row.publicationInput=publicationInput;await db.imports.put(row);return copy(receipt);
            });
        },
        async getVersion(libraryId,version) {
            open();ids(libraryId);safeVersion(version,true);const row=await db.sourceVersions.get([libraryId,version]);if(!row)throw error('fixed source version not found',404);
            validateSourceRecords(row.records,{published:true});if(row.field_table)validateConfirmedFieldTable(row.field_table);if(isFinalizedPublication(row))validateFinalizedPublication(row);return copy(row);
        },
        async initializeVersion(libraryId,version,{world_id,branch_id,options}={}) {
            open();sourceText(world_id,'world_id');sourceText(branch_id,'branch_id');const input=copy({library_id:libraryId,version,world_id,branch_id,options});
            const bundle=await client.getVersion(libraryId,version),result=initialize(bundle,input.options);
            result.world.meta??={};result.world.meta.sourceInitialization=input;
            freezeInitialState(result.world);
            await journal.initialize({world_id,branch_id,revision:0},result.world,{provenance:{sourceInitialization:input,sourcePublication:bundle}});
            return {world_id,branch_id,revision:0,source:{library_id:libraryId,version,omitted_source_ids:copy(bundle.omitted_source_ids)}};
        },
        async getSource(libraryId,sourceId,contentHash) {
            open();ids(libraryId);sourceText(sourceId,'source_id');sourceText(contentHash,'content_hash');
            const rows=await db.imports.where('library_id').equals(libraryId).toArray();
            for(const row of rows) {
                const item=row.items.find(i=>i.source_id===sourceId && i.content_hash===contentHash);
                if(item)return copy({library_id:libraryId,content_hash:contentHash,...row.entries.find(e=>e.source_id===sourceId)});
            }throw error('original source version not found',404);
        },
        close() {closed=true;liveClients.delete(ownerKey(clientId));for(const entry of controllers.values())entry.controller.abort();controllers.clear();},
    };
    return client;
}
