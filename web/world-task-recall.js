// Per-task fixed-version retrieval planning.
//
// The coordinator used to merge the whole dialogue and every task JSON into ONE
// memory.search call. That made each task's query fuzzy and its direct IDs share one
// reference budget. Here every task gets its own query pinned to the SAME expected
// revision. Whole records are unioned (no hard truncation: the engine pack owns the
// authoritative whole-record token budget) in deterministic task order.
//
// Tasks created during prepare carry origin:'dialogue' and are absent from the committed
// snapshot, so their new IDs must never be reserved as formal references (that would
// produce a false unresolved/limited verdict). The prepared current world already
// contains them and they are already packed; only their formal causes are reserved.

export const DEFAULT_TASK_RECALL_CONCURRENCY = 2;

const idsOf = value => (Array.isArray(value) ? value : []).filter(id => typeof id === 'string' && id);

/** One task -> one query. `task.query` falls back to `task.id`; world IDs are reserved directly. */
export function taskQuery(task, newRecordIds = null) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) throw new TypeError('task must be an object');
    const id = typeof task.id === 'string' && task.id ? task.id : null;
    const owner = typeof task.owner === 'string' && task.owner ? task.owner : null;
    const query = typeof task.query === 'string' && task.query.trim() ? task.query : (id ?? '');
    const reserved = [];
    // Dialogue-origin tasks are new this turn: their id/owner are not in the committed
    // snapshot, so reserving them would be reported as missing formal references.
    if (newRecordIds !== null || task.origin !== 'dialogue') {
        if (id) reserved.push(id);
        if (owner) reserved.push(owner);
    }
    for (const ref of idsOf(task.referenceIds)) reserved.push(ref);
    return { task_id: id, owner, query, referenceIds: [...new Set(reserved)].filter(ref => !newRecordIds?.has(ref)) };
}

/**
 * Deterministic query plan. With tasks: one query per task, plus a separate dialogue
 * query for registered turnFacts.references when there are any. Without tasks: keep the
 * single dialogue recall for backward behavior.
 */
export function buildRecallQueries(dialogue, prepared) {
    const text = typeof dialogue === 'string' ? dialogue : '';
    const tasks = Array.isArray(prepared?.tasks) ? prepared.tasks : [];
    const newIds = Array.isArray(prepared?.newRecordIds) ? new Set(prepared.newRecordIds) : null;
    const references = [...new Set(idsOf((Array.isArray(prepared?.turnFacts?.references) ? prepared.turnFacts.references : []).map(r => r?.id)))].filter(ref=>!newIds?.has(ref));
    const dialogueQuery = () => ({ key: 'dialogue', dialogue: true, task_id: null, owner: null, query: text, referenceIds: references });
    if (!tasks.length) return [dialogueQuery()];
    const queries = tasks.map((task, index) => ({ key: `task:${index}`, dialogue: false, ...taskQuery(task,newIds) }));
    if (references.length) queries.push(dialogueQuery());
    return queries;
}

function normalizeResult(raw, revision, pointer) {
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('检索回执形状无效');
    const value = raw;
    if((value.revision!==undefined&&value.revision!==revision)
        ||(value.world_id!==undefined&&value.world_id!==pointer?.world_id)
        ||(value.branch_id!==undefined&&value.branch_id!==pointer?.branch_id))throw Error('检索世界身份或版本不匹配');
    return {
        ...value,
        revision,
        records: Array.isArray(value.records) ? value.records : [],
        hits: Array.isArray(value.hits) ? value.hits : [],
        unresolved: Array.isArray(value.unresolved) ? value.unresolved : [],
        mode: typeof value.mode === 'string' && value.mode ? value.mode : 'references',
        limited: !!value.limited,
        blocking: !!value.blocking || (Array.isArray(value.unresolved)&&value.unresolved.length>0),
    };
}

/** Union whole records by kind/id, hits by formal ID, unresolved/errors and limited status. */
export function mergeRecallResults(entries, revision) {
    const records = [], recordKeys = new Set();
    const hits = [], hitKeys = new Set();
    const unresolved = [], unresolvedKeys = new Set();
    const errors = [], errorKeys = new Set();
    const queries = [];
    const modes = new Set();
    let limited = false, blocking = false, vectorUnavailable = false;
    const vectorReasons = new Set();
    for (const { query, result } of entries) {
        const value = result ?? {};
        limited = limited || !!value.limited;
        blocking = blocking || !!value.blocking;vectorUnavailable = vectorUnavailable || !!value.vector_unavailable;
        if(value.vector_reason)vectorReasons.add(String(value.vector_reason));
        if (typeof value.mode === 'string' && value.mode) modes.add(value.mode);
        for (const record of Array.isArray(value.records) ? value.records : []) {
            if (!record || typeof record !== 'object') continue;
            const id = typeof record.id === 'string' ? record.id : null;
            if (!id) continue;
            const kind = typeof record.record_kind === 'string' ? record.record_kind : (typeof record.kind === 'string' ? record.kind : '');
            const key = JSON.stringify([kind,id,record.content_kind??"",record.revision??""]);
            if (recordKeys.has(key)) continue;
            recordKeys.add(key);
            records.push(record);
        }
        for (const hit of Array.isArray(value.hits) ? value.hits : []) {
            const id = typeof hit?.id === 'string' ? hit.id : null;
            if (!id || hitKeys.has(id)) continue;
            hitKeys.add(id);
            hits.push(hit);
        }
        for (const item of Array.isArray(value.unresolved) ? value.unresolved : []) {
            const key = JSON.stringify(item);
            if (unresolvedKeys.has(key)) continue;
            unresolvedKeys.add(key);
            unresolved.push(item);
        }
        if (value.error) {
            const message = String(value.error);
            if (!errorKeys.has(message)) { errorKeys.add(message); errors.push(message); }
        }
        queries.push({
            key: query.key,
            query: query.query,
            task_id: query.task_id ?? null,
            owner: query.owner ?? null,
            dialogue: !!query.dialogue,
            referenceIds: [...(query.referenceIds ?? [])],
            recordIds: (Array.isArray(value.records) ? value.records : []).map(record => record?.id).filter(id => typeof id === 'string'),
            hitIds: (Array.isArray(value.hits) ? value.hits : []).map(hit => hit?.id).filter(id => typeof id === 'string'),
            mode: typeof value.mode === 'string' && value.mode ? value.mode : null,
            limited: !!value.limited,
            ...(value.error ? { error: String(value.error) } : {}),
        });
    }
    const distinct = [...modes];
    const mode = distinct.length === 0 ? 'references' : (distinct.length === 1 ? distinct[0] : 'mixed');
    return { revision, mode, limited, blocking, vector_unavailable:vectorUnavailable,vector_reasons:[...vectorReasons],records, hits, unresolved, errors, queries };
}

/**
 * Run the planned queries with bounded concurrency against one pinned revision.
 * Completed queries are loaded from and written back to `load`/`save` checkpoints so a
 * resumed operation never repeats a finished search. `isCancelled` is consulted before
 * scheduling every further search.
 */
export async function runTaskRecall({
    dialogue = '', prepared, pointer, revision, memory,
    concurrency = DEFAULT_TASK_RECALL_CONCURRENCY,
    load = null, save = null, isCancelled = () => false, searchOptions = null, signal = null,
} = {}) {
    if (!memory || typeof memory.search !== 'function') throw new TypeError('memory.search is required');
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new TypeError('concurrency must be a positive integer');
    const rev = revision ?? pointer?.revision;
    if (!Number.isSafeInteger(rev) || rev < 0) throw new TypeError('revision must be a non-negative integer');
    // Fixed per-operation retrieval budget (maxRecords/maxDepth/similarity). The planned query and
    // its formal references are always written last: options may never erase them (an explicit
    // formal reference is evidence, not a ranking candidate that a small maxRecords may drop).
    const fixedOptions = searchOptions && typeof searchOptions === 'object' ? searchOptions : null;
    const searchInput = (query) => ({
        ...(fixedOptions ? {
            ...(fixedOptions.maxRecords !== undefined ? { maxRecords: fixedOptions.maxRecords } : {}),
            ...(fixedOptions.maxDepth !== undefined ? { maxDepth: fixedOptions.maxDepth } : {}),
            ...(fixedOptions.similarity !== undefined ? { similarity: fixedOptions.similarity } : {}),
        } : {}),
        query: query.query, referenceIds: query.referenceIds, purpose: 'world',
    });
    const queries = buildRecallQueries(dialogue, prepared);
    const results = new Array(queries.length).fill(undefined);
    const restored = new Array(queries.length).fill(false);
    const failed = error => ({revision:rev,mode:"references",limited:true,blocking:true,records:[],hits:[],unresolved:[],error:String(error?.message??error)});
    if (typeof load === 'function') {
        for (let index = 0; index < queries.length; index++) {
            const stored = await load(queries[index].key);
            if (stored && typeof stored === 'object') {
                try{results[index] = normalizeResult(stored.result ?? stored,rev,pointer)}catch(error){results[index]=failed(error)}
                restored[index] = true;
            }
        }
    }
    let cursor = 0;
    const worker = async () => {
        while (true) {
            if (signal?.aborted || await isCancelled()) return;
            const index = cursor++;
            if (index >= queries.length) return;
            if (restored[index]) continue;
            const query = queries[index];
            let result;
            try {
                const raw = await memory.search({ ...pointer, revision: rev }, searchInput(query),{signal});
                result = normalizeResult(raw, rev, pointer);
            } catch (error) {
                result = failed(error);
            }
            results[index] = result;
            if(signal?.aborted || await isCancelled())return;
            if (typeof save === 'function') await save(query.key, { query: query.key, result });
        }
    };
    const width = Math.min(concurrency, Math.max(1, queries.length));
    await Promise.all(Array.from({ length: width }, worker));
    const entries = queries.map((query, index) => ({ query, result: results[index] ?? null })).filter(entry => entry.result !== null);
    return mergeRecallResults(entries, rev);
}
