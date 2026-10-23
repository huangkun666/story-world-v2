import { chatScope } from './message-consumption.js';
import { persistServiceMetadata } from './hot-ledger.js';
import { RULES_FINGERPRINT } from './service-contract.js';

export const SOURCE_META_KEY = 'story_world_v2_source';
const copy = value => structuredClone(value);
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const identity = value => typeof value === 'string' && !!value.trim();
function validateEntries(entries) {
    if (!Array.isArray(entries) || !entries.length || entries.some(entry => !entry || !identity(entry.source_id)
        || typeof entry.content !== 'string' || !entry.metadata || typeof entry.metadata !== 'object' || Array.isArray(entry.metadata)
        || Object.keys(entry).sort().join(',') !== 'content,metadata,source_id')
        || new Set(entries.map(entry => entry.source_id)).size !== entries.length) throw Error('请提供完整且来源编号不重复的 JSON 原稿');
}

// 所有动作绑定捕获的聊天、连接和不可变输入；未确认请求只核对原号。
export function createSourceSession({ getCtx, getClient, getConnectionId, persist = null, onStatus = () => {},
    onWorld = null, rulesFingerprint = RULES_FINGERPRINT }) {
    const persistInput = persist ?? (ctx => persistServiceMetadata(ctx, SOURCE_META_KEY, getCtx));
    let epoch = 0, running = false, cache = null, ownerClient = null, runDone = Promise.resolve();
    const state = () => getCtx()?.chatMetadata?.[SOURCE_META_KEY] ?? null;
    const signature = () => canonical([chatScope(getCtx()), getConnectionId(), state()]);
    function capture(requireState = true) {
        const ctx = getCtx(), saved = state(), connection = getConnectionId(), client = getClient();
        if (!ctx || !client || !identity(connection)) throw Error('请先配置世界服务连接');
        if (requireState && (!saved || saved.connection_id !== connection)) throw Error('资料任务连接已改变，请核对原服务');
        return {ctx, state:copy(saved), connection, client, scope:chatScope(ctx), epoch};
    }
    const current = c => c.epoch === epoch && c.ctx.chatMetadata === getCtx()?.chatMetadata
        && c.scope === chatScope(getCtx()) && c.connection === getConnectionId() && c.client === getClient();
    function check(c) {
        if (!current(c) || canonical(state()) !== canonical(c.state)) throw Error('聊天或服务连接已改变，旧资料结果未应用');
    }
    async function save(c, next) {
        check(c);c.ctx.chatMetadata ??= {};
        const previous = c.ctx.chatMetadata[SOURCE_META_KEY];c.ctx.chatMetadata[SOURCE_META_KEY] = copy(next);
        try {await persistInput(c.ctx)} catch(error) {
            if (canonical(c.ctx.chatMetadata[SOURCE_META_KEY]) === canonical(next)) {
                if (previous === undefined) delete c.ctx.chatMetadata[SOURCE_META_KEY]; else c.ctx.chatMetadata[SOURCE_META_KEY] = previous;
            }
            throw error;
        }
        c.state = copy(next);check(c);
    }
    function display(c, data) { check(c);ownerClient = c.client;cache = {key:signature(), data:copy(data)}; }
    async function guarded(fn) {
        if (running) return {ok:false, skipped:'busy'};
        running = true;let finish;runDone = new Promise(resolve => {finish = resolve});
        const generation = epoch, scope = chatScope(getCtx()), connection = getConnectionId(), client = getClient();
        try {return await fn()} catch(error) {
            if (generation !== epoch || scope !== chatScope(getCtx()) || connection !== getConnectionId() || client !== getClient()) return {ok:false, stale:true};
            const result = {ok:false,error:String(error?.message ?? error),...(state()?.action ? {uncertain:true,pending:true} : {})};
            onStatus(result.error);return result;
        } finally {running = false;finish()}
    }
    function match(c, result) {
        if (result?.library_id !== c.state.library_id || result.import_id !== c.state.input.import_id
            || !Array.isArray(result.items) || result.items.length !== c.state.input.entries.length
            || new Set(result.items.map(item => item.source_id)).size !== result.items.length
            || result.items.some(item => !c.state.input.entries.some(entry => entry.source_id === item.source_id))) throw Error('资料任务返回来源或身份不匹配');
    }
    function publication(c, receipt, input = c.state.action?.kind === 'publish' ? c.state.action.input : null) {
        if (!receipt || receipt.library_id !== c.state.library_id || receipt.import_id !== c.state.input.import_id
            || !Number.isSafeInteger(receipt.version) || receipt.version < 1 || receipt.expected_version !== receipt.version - 1
            || !Array.isArray(receipt.omitted_source_ids) || receipt.omitted_source_ids.some(id => !c.state.input.entries.some(e => e.source_id === id))
            || (input && (receipt.expected_version !== input.expected_version
                || canonical([...receipt.omitted_source_ids].sort()) !== canonical([...input.omitted_source_ids].sort())))) throw Error('资料发布回执身份、版本或缺失名单不匹配');
        return copy(receipt);
    }
    async function accept(c, result, {verifyInput = true} = {}) {
        check(c);match(c,result);
        if (verifyInput) {
            const original = await c.client.getImportInput(c.state.library_id, c.state.input.import_id);check(c);
            if (original.library_id !== c.state.library_id || original.import_id !== c.state.input.import_id
                || original.extractor_key !== c.state.input.extractor_key || canonical(original.entries) !== canonical(c.state.input.entries)) throw Error('资料任务原稿或配置身份不匹配');
        }
        const candidates = {};
        for (const item of result.items) if (item.status === 'succeeded') {
            const candidate = await c.client.getCandidate(c.state.library_id, c.state.input.import_id, item.source_id);check(c);
            if (candidate.library_id !== c.state.library_id || candidate.import_id !== c.state.input.import_id
                || candidate.source_id !== item.source_id || candidate.content_hash !== item.content_hash || !Array.isArray(candidate.records)) throw Error('资料候选返回来源版本不匹配');
            candidates[item.source_id] = candidate;
        }
        let action = c.state.action, published = c.state.publication ?? null;
        if (result.status === 'published') {published = publication(c,result.receipt);if (action?.kind !== 'initialize') action = null}
        else if (result.status === 'cancelled') action = null;
        else if (action?.kind === 'register') action = null;
        else if (action?.kind === 'retry' && result.items.find(item => item.source_id === action.input.source_id)?.status === 'pending') action = null;
        else if (action?.kind === 'execute' && !result.execution?.running
            && (result.items.every(item => item.status === 'succeeded') || result.execution?.phase === 'failed')) action = null;
        await save(c,{...c.state,action,publication:published});
        display(c,{...c.state,import:result,candidates});
        const pending = !!action || result.execution?.running === true || result.items.some(item => ['requested','unknown'].includes(item.status));
        return {ok:!pending,pending,...(published ? {publication:published} : {}),...(result.status === 'cancelled' ? {cancelled:true} : {})};
    }
    async function query(c) {return accept(c,await c.client.getImport(c.state.library_id,c.state.input.import_id))}
    async function prepare(c,kind,input = {}) {await save(c,{...c.state,action:{kind,input:copy(input)}})}
    const session = {
        get busy() {return running},
        get scope() {return canonical([chatScope(getCtx()),getConnectionId()])},
        readout() {
            if (!state() || state().connection_id !== getConnectionId() || (ownerClient && ownerClient !== getClient())) return null;
            if (cache?.key === signature()) return copy(cache.data);
            return copy({...state(),import:null,candidates:{}});
        },
        register(input) {return guarded(async () => {
            if (!identity(input?.library_id) || !identity(input.import_id)) throw Error('请填写资料库和导入编号');
            validateEntries(input.entries);input = copy(input);
            const c = capture(false);
            if (c.state) {
                if (c.state.library_id === input.library_id && c.state.input.import_id === input.import_id) {
                    if (canonical(c.state.input.entries) !== canonical(input.entries)) throw Error('同一导入编号不能更换原稿');
                    try {return await query(c)} catch(error) {
                        if (error.status !== 404 || c.state.action?.kind !== 'register') throw error;
                        check(c);await prepare(c,'register');
                        await c.client.createLibrary(c.state.library_id);check(c);
                        return accept(c,await c.client.beginImport(c.state.library_id,c.state.input));
                    }
                }
                if (c.state.action || !c.state.publication && cache?.data?.import?.status !== 'cancelled') throw Error('请先核对、发布或停止原导入任务');
            }
            const health = await c.client.connect({...(rulesFingerprint ? {rulesFingerprint} : {})});check(c);
            const key = health?.source_execution?.extractor_key;
            if (!health?.source_execution?.available || !identity(key)) throw Error('服务尚未配置资料执行');
            await save(c,{connection_id:c.connection,library_id:input.library_id,input:{import_id:input.import_id,entries:input.entries,extractor_key:key},
                selected_source_id:input.entries[0].source_id,action:{kind:'register',input:{}},publication:null,initialization:null});
            await c.client.createLibrary(c.state.library_id);check(c);
            return accept(c,await c.client.beginImport(c.state.library_id,c.state.input));
        })},
        execute() {return guarded(async () => {
            const c = capture();if (c.state.action) return query(c);
            if (c.state.publication) throw Error('此资料任务已经发布');
            await prepare(c,'execute');return accept(c,await c.client.executeImport(c.state.library_id,c.state.input.import_id));
        })},
        reconcile() {return guarded(() => query(capture()))},
        async load() {
            const generation = epoch, scope = session.scope;
            while (running) {await runDone;if (generation !== epoch || scope !== session.scope) return {ok:false,stale:true}}
            return session.reconcile();
        },
        selectSource(sourceId) {return guarded(async () => {
            const c = capture();if (!c.state.input.entries.some(entry => entry.source_id === sourceId)) throw Error('来源编号无效');
            const previous = session.readout();await save(c,{...c.state,selected_source_id:sourceId});
            if (previous) display(c,{...previous,...c.state});return {ok:true};
        })},
        publish({omitted_source_ids = []} = {}) {return guarded(async () => {
            const c = capture();if (c.state.action) return query(c);
            await query(c);if (c.state.publication) return {ok:true,publication:c.state.publication};
            const row = session.readout().import, missing = row.items.filter(item => item.status !== 'succeeded').map(item => item.source_id);
            if (!Array.isArray(omitted_source_ids) || new Set(omitted_source_ids).size !== omitted_source_ids.length
                || canonical([...omitted_source_ids].sort()) !== canonical(missing.sort())) throw Error('请明确确认全部缺失来源名单后发布');
            const library = await c.client.getLibrary(c.state.library_id);check(c);
            if (library.library_id !== c.state.library_id || !Number.isSafeInteger(library.version) || library.version < 0) throw Error('资料库版本不匹配');
            const input = {expected_version:library.version,omitted_source_ids:copy(omitted_source_ids)};
            await prepare(c,'publish',input);const receipt = publication(c,await c.client.publish(c.state.library_id,c.state.input.import_id,input));check(c);
            await save(c,{...c.state,publication:receipt,action:null});cache = null;return {ok:true,publication:receipt};
        })},
        initialize(input) {return guarded(async () => {
            const c = capture();if (!c.state.publication) throw Error('请先明确发布资料版本');
            if (!identity(input?.world_id) || !identity(input.branch_id) || !input.options || typeof input.options !== 'object' || Array.isArray(input.options)) throw Error('请填写新世界、分支和初始化选项');
            input = copy(input);
            if (c.state.initialization) {
                if (canonical(c.state.initialization.input) !== canonical(input)) throw Error('此任务已建立世界，请核对原世界');
                return {ok:true,initialized:true,pointer:copy(c.state.initialization.pointer)};
            }
            if (c.state.action && (c.state.action.kind !== 'initialize' || canonical(c.state.action.input) !== canonical(input))) throw Error('请核对原资料动作');
            await prepare(c,'initialize',input);
            const receipt = await c.client.initializeVersion(c.state.library_id,c.state.publication.version,input);check(c);
            if (receipt.world_id !== input.world_id || receipt.branch_id !== input.branch_id || receipt.revision !== 0
                || receipt.source?.library_id !== c.state.library_id || receipt.source.version !== c.state.publication.version
                || canonical(receipt.source.omitted_source_ids) !== canonical(c.state.publication.omitted_source_ids)) throw Error('资料初始化回执身份或固定版本不匹配');
            const pointer = {world_id:input.world_id,branch_id:input.branch_id,revision:0};
            await save(c,{...c.state,initialization:{input,receipt,pointer},action:null});cache = null;
            return {ok:true,initialized:true,pointer};
        })},
        attachWorld() {return guarded(async () => {
            const c = capture();if (!c.state.initialization || !onWorld) throw Error('请先建立并核对新世界');
            const {pointer,receipt} = c.state.initialization;
            const result = await onWorld(copy(pointer),copy(receipt));check(c);
            if (result?.ok === false) return result;
            return {ok:true,attached:true,pointer:copy(pointer)};
        })},
        cancel() {return guarded(async () => {
            const c = capture();if (c.state.action && c.state.action.kind !== 'execute') return query(c);
            await prepare(c,'cancel');return accept(c,await c.client.cancel(c.state.library_id,c.state.input.import_id));
        })},
        retry(sourceId) {return guarded(async () => {
            const c = capture();if (c.state.action) return query(c);await query(c);
            if (session.readout().import.items.find(item => item.source_id === sourceId)?.status !== 'failed') throw Error('仅可明确重试失败来源');
            await prepare(c,'retry',{source_id:sourceId});return accept(c,await c.client.retry(c.state.library_id,c.state.input.import_id,sourceId));
        })},
        invalidate() {epoch++;cache = null;ownerClient = null},
    };
    return session;
}
