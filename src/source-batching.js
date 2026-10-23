// Deterministic, durable source batching. Pure functions only: no IndexedDB, no model I/O.
// Complete source entries are packed in input order without truncation or splitting; an entry
// larger than the target occupies its own batch and is still sent whole.
import { sha256Hex } from './browser-capabilities.js';
import { validateSourceRecords, sourceLocalId, sourceText } from './source-records.js';

export {SETTING_CHUNK_CHAR as DEFAULT_SOURCE_CHUNK_CHARS} from './abstract-limits.js';
import {SETTING_CHUNK_CHAR as DEFAULT_SOURCE_CHUNK_CHARS} from './abstract-limits.js';
export const UNLIMITED = 'unlimited';

/** Character count by Unicode code points (never UTF-16 units). */
export function codepointLength(value) {
    return Array.from(String(value)).length;
}

/** Canonical JSON-safe target: a positive safe integer or the exact string 'unlimited'. */
export function normalizeSourceChunkChars(value) {
    if(value===UNLIMITED)return UNLIMITED;
    if(!Number.isSafeInteger(value) || value<1)throw new TypeError(`source chunkChars must be a positive safe integer or '${UNLIMITED}'`);
    return value;
}

/** Canonical JSON-safe concurrency: a positive safe integer. */
export function normalizeSourceConcurrency(value) {
    if(!Number.isSafeInteger(value) || value<1)throw new TypeError('source concurrency must be a positive safe integer');
    return value;
}

/** Effective character budget for a canonical target. 'unlimited' means one batch, not infinite model capacity. */
export function charBudget(value) {
    const canonical=normalizeSourceChunkChars(value);
    return canonical===UNLIMITED?Infinity:canonical;
}

/** Resolve a live (function) or static chunk target at a task boundary. */
export function resolveSourceChunkChars(value, context=null) {
    return normalizeSourceChunkChars(typeof value==='function'?value(context):value);
}

/** Resolve a live (function) or static concurrency at a task boundary. */
export function resolveSourceConcurrency(value, context=null) {
    return normalizeSourceConcurrency(typeof value==='function'?value(context):value);
}

/** Freeze one import's grouping/config so a resumed request preserves the same input. */
export function freezeSourceBatchConfig({chunkChars=DEFAULT_SOURCE_CHUNK_CHARS,concurrency=1}={}) {
    if(typeof chunkChars==='function'||typeof concurrency==='function')throw new TypeError('frozen source config must already be resolved');
    return {chunk_chars:normalizeSourceChunkChars(chunkChars),concurrency:normalizeSourceConcurrency(concurrency)};
}

/**
 * Deterministically pack complete entries into batches.
 * @param {Array<{source_id:string,content:string,content_hash?:string}>} entries
 * @param {number|'unlimited'} chunkChars
 * @returns {Array<{batch_id:string,source_ids:string[],chars:number,oversized_source_ids:string[],sources:Array<{source_id:string,content_hash:string|null,chars:number}>}>}
 */
export function planSourceBatches(entries, chunkChars=DEFAULT_SOURCE_CHUNK_CHARS) {
    if(!Array.isArray(entries))throw new TypeError('source entries must be an array');
    const budget=charBudget(chunkChars),normalized=[];
    for(const entry of entries) {
        if(!entry || typeof entry!=='object' || Array.isArray(entry))throw new TypeError('source entry must be a JSON object');
        const source_id=sourceText(entry.source_id,'source_id');
        if(typeof entry.content!=='string')throw new TypeError('source content must be a string');
        normalized.push({source_id,content_hash:typeof entry.content_hash==='string'?entry.content_hash:null,chars:codepointLength(entry.content)});
    }
    const batches=[];let current=null;
    const flush=()=>{
        if(!current)return;
        const source_ids=current.sources.map(s=>s.source_id);
        batches.push({batch_id:'srcbatch-'+sha256Hex(JSON.stringify([budget===Infinity?UNLIMITED:budget,source_ids])),
            source_ids,chars:current.chars,
            oversized_source_ids:current.sources.filter(s=>s.chars>budget).map(s=>s.source_id),
            sources:current.sources});
        current=null;
    };
    for(const item of normalized) {
        if(current && current.chars+item.chars>budget)flush();
        if(!current)current={sources:[],chars:0};
        current.sources.push(item);current.chars+=item.chars;
    }
    flush();
    return batches;
}

/**
 * Group one model response by exact source_id. Multi-source responses must be
 * {sources:[{source_id,records}]}; a bare {records:[...]} is only attributable for a singleton.
 * Missing, duplicate or unexpected source results fail explicitly and never silently omit content.
 * @returns {Array<{source_id:string,records:Array}>} in expected order
 */
export function groupBatchResponse(protocol, expectedSourceIds) {
    if(!Array.isArray(expectedSourceIds) || !expectedSourceIds.length)throw new TypeError('expected source_ids must be a nonempty array');
    const expected=expectedSourceIds.map(id=>sourceText(id,'expected source_id'));
    if(new Set(expected).size!==expected.length)throw new TypeError('expected source_ids must be unique');
    if(!protocol || typeof protocol!=='object' || Array.isArray(protocol))throw new TypeError('model protocol must be a JSON object');
    const keys=Object.keys(protocol);
    if(keys.length!==1)throw new TypeError('model protocol must be exactly {records:[...]} or {sources:[...]}');
    if(keys[0]==='records') {
        if(!Array.isArray(protocol.records))throw new TypeError('model protocol records must be an array');
        if(expected.length!==1)throw new TypeError('multi-source response requires {sources:[{source_id,records}]}; records cannot be attributed by model text');
        return [{source_id:expected[0],records:protocol.records}];
    }
    if(keys[0]!=='sources')throw new TypeError('model protocol must be exactly {records:[...]} or {sources:[...]}');
    if(!Array.isArray(protocol.sources))throw new TypeError('model protocol sources must be an array');
    const expectedSet=new Set(expected),seen=new Map();
    for(const [index,entry] of protocol.sources.entries()) {
        if(!entry || typeof entry!=='object' || Array.isArray(entry))throw new TypeError(`source result ${index} must be a JSON object`);
        const unknown=Object.keys(entry).filter(key=>!['source_id','records'].includes(key));
        if(unknown.length)throw new TypeError(`source result ${index} has unsupported keys ${unknown.join(', ')}`);
        const source_id=sourceText(entry.source_id,'source result source_id');
        if(!Array.isArray(entry.records))throw new TypeError(`source result ${source_id} records must be an array`);
        if(seen.has(source_id))throw new TypeError(`duplicate source result for source_id ${source_id}`);
        if(!expectedSet.has(source_id))throw new TypeError(`unexpected source result for source_id ${source_id}`);
        seen.set(source_id,entry.records);
    }
    const missing=expected.filter(id=>!seen.has(id));
    if(missing.length)throw new TypeError(`missing source results for source_id ${missing.join(', ')}`);
    return expected.map(source_id=>({source_id,records:seen.get(source_id)}));
}

/**
 * Index every identity key a batch defines: exact explicit id -> itself, local_key -> its
 * content-hash-scoped stable formal id. Same-named records are never merged; the index only
 * resolves relation endpoints.
 * @param {Array<{source_id:string,content_hash:string|null,records:Array}>} sources
 * @returns {Map<string,Set<string>>} key -> candidate formal ids
 */
export function batchIdentityIndex(sources) {
    if(!Array.isArray(sources))throw new TypeError('batch sources must be an array');
    const index=new Map();index.kindById=new Map();
    const add=(key,id)=>{if(!index.has(key))index.set(key,new Set());index.get(key).add(id);};
    for(const source of sources) {
        if(!source || !Array.isArray(source.records))throw new TypeError('batch source must carry a records array');
        for(const record of source.records) {
            if(!record || typeof record!=='object' || Array.isArray(record))continue;
            if(typeof record.id==='string' && record.id.trim()){add(record.id,record.id);index.kindById.set(record.id,record.record_kind);}
            else if(typeof record.local_key==='string' && record.local_key.trim()){const id=sourceLocalId(source.content_hash,record.local_key);add(record.local_key,id);index.kindById.set(id,record.record_kind);}
        }
    }
    return index;
}

/**
 * Validate one source's records and map cross-source relation endpoints through the batch index.
 * Endpoints defined by that same source keep their local meaning (validateSourceRecords maps them);
 * endpoints owned by another source in the batch resolve to that owner's stable formal id.
 * An endpoint that is defined by more than one source is ambiguous and fails instead of guessing.
 */
export function resolveSourceRecords(source, index, {deferReferences=true,knownIds=[]}={}) {
    if(!source || !Array.isArray(source.records))throw new TypeError('source records must be an array');
    const own=new Map();
    for(const record of source.records) {
        if(!record || typeof record!=='object' || Array.isArray(record))continue;
        if(typeof record.id==='string' && record.id.trim())own.set(record.id,record.id);
        else if(typeof record.local_key==='string' && record.local_key.trim())own.set(record.local_key,sourceLocalId(source.content_hash,record.local_key));
    }
    const endpoint=key=>{
        if(own.has(key))return key;
        const candidates=index?.get(key);
        if(!candidates||!candidates.size)return key;
        if(candidates.size>1)throw new TypeError(`identity key ${key} is ambiguous across sources`);
        return [...candidates][0];
    };
    const rewritten=source.records.map(record=>record.record_kind==='relation'
        ?{...record,from_id:endpoint(record.from_id),to_id:endpoint(record.to_id)}
        :record);
    const known=[...new Set([...knownIds,...(index?[...index.values()].flatMap(set=>[...set]):[])])];
    return validateSourceRecords(rewritten,{sourceHash:source.content_hash,knownIds:known,knownKinds:index?.kindById??[],deferReferences,modelFields:true});
}
