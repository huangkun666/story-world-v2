// story-world-v2/web/service-observation.js
// ★服务聊天观察缓存：把"这一轮聊天能用的、服务已确认可见的那段文字"固定在一个范围上。
//
// 【范围是什么】`scope`（哪一个聊天）＋ `client`（哪一条配对连接）＋ `world_id`/`branch_id`/`revision`
//   ＋ `query`（当前完整场景查询）＋ `max_chars`（这一轮的字数预算）——六项**完全相同**才算命中。
//   ★任何一项变了，旧回执当场作废（连同在飞的那次请求一起 abort）：切聊天、换话题、改预算、
//   同一世界推进到新版本、重连换 client，都不许把上一份观察顶到这一轮里。
//
// 【只缓存服务确认可见的字符串】本组件不读世界正文、不查旧账、不看全局图、不碰向量：
//   它拿到的每一个字都来自 `client.getObservation` 的 `purpose === 'chat'` 回执，
//   并且 world/branch/revision 三项都要与请求时那一份**逐字段相同**。
//   超预算的正文**整段拒绝**（绝不切一半塞进聊天）；形状不对的回执一律丢弃并报一条短错。
//
// 【迟到结果】请求回来后**再核对一次当前范围**（`epoch` ＋ `key` 双闸）：
//   · 自己叫停的那一次（`invalidate` 或范围已变）⇒ 连错误都不报（那正是我们要它停的）；
//   · 请求期间范围动了 ⇒ 结果静默作废（不缓存、不 onReady、不报错）。
//   所有 promise rejection 都在本组件内部消化：`prefetch()` 返回的 promise 永不 reject，
//   也不产生 unhandled rejection。
//
// 【预算 0】`getMaxChars()` 返回 0 ＝ 这一轮没有可注入的余地（这一格是关着的）
//   ⇒ 不发请求、缓存清空、`read()` 为 null（不拿服务的空回执白跑一趟）。
//
// 【报告口】`onReady(receipt)` 只在**新收下一份回执**时叫一次；`onStatus({ ok:false, error })`
//   只在**当前范围**的请求失败或回执被拒时叫一次。两个口自己抛错都不许带塌缓存。
const MAX_ERROR_CHARS = 40;

export function createServiceObservation({ getState, getQuery, getMaxChars, getStateMaxChars = () => 0, getSearchOptions = () => null, getContextOptions = () => null, onReady = () => {}, onStatus = () => {} }) {
    if (typeof getState !== 'function' || typeof getQuery !== 'function' || typeof getMaxChars !== 'function') {
        throw new TypeError('聊天观察缓存缺少读取当前范围的函数');
    }
    let epoch = 0;        // 范围变更 / 取消的代数：只有"出生在这一代"的请求才许落账
    let cache = null;     // { key, receipt }：当前范围已经收下的那一份
    let inFlight = null;  // { key, epoch, controller, promise }：当前范围正在取的那一次

    /** 读一个调用方给的函数；它自己坏了只当"这一格现在没有范围"。 */
    function readValue(source) {
        try { return source(); } catch { return undefined; }
    }

    /** 当前范围（六项全在才算数）；任何一项不成立 ⇒ null（不发请求）。 */
    function currentKey() {
        const state = readValue(getState);
        if (!state || typeof state !== 'object') return null;
        const { scope, pointer, client } = state;
        // ★scope 必须点名是哪一个聊天：空串会让"切聊天"与"没切"长得一模一样
        if (typeof scope !== 'string' || scope === '') return null;
        if (!pointer || typeof pointer !== 'object') return null;
        const { world_id: worldId, branch_id: branchId, revision } = pointer;
        if (typeof worldId !== 'string' || worldId === '') return null;
        if (typeof branchId !== 'string' || branchId === '') return null;
        if (!Number.isSafeInteger(revision) || revision < 0) return null;
        if (!client || typeof client.getObservation !== 'function') return null;
        const query = readValue(getQuery);
        const maxChars = readValue(getMaxChars);
        const stateMax = client.supportsSceneState === true ? readValue(getStateMaxChars) : 0;
        if (!Number.isSafeInteger(maxChars) || maxChars < 0 || !Number.isSafeInteger(stateMax) || stateMax < 0) return null;
        const full = client.supportsFullCurrentState === true;
        const context = full ? readValue(getContextOptions) : null;
        const include = full && context?.include_current_state === true;
        if (typeof query !== 'string' || (query.trim() === '' && stateMax === 0 && !include) || (maxChars + stateMax === 0 && !include)) return null;
        const contextOptions = full ? {include_current_state:include,relevance_text:context?.relevance_text??query,
            movement_max_chars:stateMax,movement_after_revision:context?.movement_after_revision??null} : null;
        if(contextOptions && (typeof contextOptions.relevance_text!=='string' || (contextOptions.movement_after_revision!==null
            && (!Number.isSafeInteger(contextOptions.movement_after_revision)||contextOptions.movement_after_revision<0||contextOptions.movement_after_revision>revision))))return null;
        const options = client.supportsSceneState === true && maxChars > 0 ? readValue(getSearchOptions) : null;
        const searchOptions = options ? {maxRecords:options.maxRecords,similarity:options.similarity} : null;
        return { scope, client, world_id: worldId, branch_id: branchId, revision, query, max_chars: maxChars, state_max_chars:stateMax,search_options:searchOptions,context_options:contextOptions };
    }

    function sameKey(a, b) {
        return !!a && !!b && a.scope === b.scope && a.client === b.client
            && a.world_id === b.world_id && a.branch_id === b.branch_id
            && a.revision === b.revision && a.query === b.query && a.max_chars === b.max_chars
            && a.state_max_chars === b.state_max_chars && JSON.stringify(a.search_options) === JSON.stringify(b.search_options)
            && JSON.stringify(a.context_options) === JSON.stringify(b.context_options);
    }

    function notify(sink, value) {
        try { sink(value); } catch { /* 报告口自己坏了不许带塌缓存 */ }
    }

    function shortError(error) {
        const text = typeof error?.message === 'string' ? error.message.trim() : '';
        if (!text) return '聊天观察请求失败';
        return text.length <= MAX_ERROR_CHARS ? text : text.slice(0, MAX_ERROR_CHARS);
    }

    /** 中止在飞的那一次并换代：即使对方无视 abort 迟到交卷，那一份也已经不作数。 */
    function abortInFlight() {
        const job = inFlight;
        inFlight = null;
        epoch += 1;
        if (job) { try { job.controller.abort(); } catch { /* 取消失败：结果照样进不了账 */ } }
    }

    /** 范围变了就立刻清旧回执、abort 旧请求（同范围的照旧留着）。 */
    function dropStale(key) {
        if (cache && !sameKey(cache.key, key)) cache = null;
        if (inFlight && !sameKey(inFlight.key, key)) abortInFlight();
    }

    /** 服务回执的闸门：用途、世界、分支、版本、正文形状与预算，一项不符整份拒绝。 */
    function inspect(value, key) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: '观察回执形状无效' };
        if (value.purpose !== 'chat') return { ok: false, error: '观察回执用途不是聊天' };
        if (value.world_id !== key.world_id || value.branch_id !== key.branch_id) {
            return { ok: false, error: '观察回执世界身份不匹配' };
        }
        if (value.revision !== key.revision) return { ok: false, error: '观察回执版本不匹配' };
        if (typeof value.text !== 'string') return { ok: false, error: '观察回执正文不是文本' };
        if (value.text.length > key.max_chars) return { ok: false, error: '观察回执超出预算' };
        if (key.context_options && (typeof value.state_text!=='string'||typeof value.movement_text!=='string'
            ||value.movement_text.length>key.context_options.movement_max_chars))return {ok:false,error:'当前状态或动向回执无效'};
        if (!key.context_options && key.state_max_chars > 0 && (typeof value.state_text !== 'string' || value.state_text.length > key.state_max_chars)) {
            return {ok:false,error:'当前状态回执无效或超出字数预算'};
        }
        return { ok: true, receipt: value };
    }

    /** 取一次（内部）：无论成败都平静收场，绝不把 rejection 漏给外面。 */
    async function run(job) {
        try {
            const { key, controller } = job;
            let receipt = null;
            let failure = null;
            try {
                receipt = await key.client.getObservation(
                    { world_id: key.world_id, branch_id: key.branch_id },
                    { revision: key.revision, query: key.query, max_chars: key.max_chars,
                        ...(key.context_options ? key.context_options : key.state_max_chars > 0 ? {state_max_chars:key.state_max_chars} : {}),
                        ...(key.search_options ? {search_options:key.search_options} : {}) },
                    { signal: controller.signal });
            } catch (error) { failure = error; }
            if (inFlight === job) inFlight = null;
            // ① 我们自己叫停的（invalidate / 范围已变）⇒ 不落账、不报错、不 onReady
            // ★闸门只有这一处：`abort` 是停请求的**机制**，而"这一次还算不算数"由代数说了算
            //   （换代只发生在 `abortInFlight`：abort 与 epoch+1 永远同批发生）。
            if (job.epoch !== epoch) return null;
            // ② 请求期间范围动了 ⇒ 这一份迟到，静默作废
            if (!sameKey(currentKey(), key)) return null;
            if (failure) {
                cache = null;
                notify(onStatus, { ok: false, error: shortError(failure) });
                return null;
            }
            const verdict = inspect(receipt, key);
            if (!verdict.ok) {
                cache = null;
                notify(onStatus, { ok: false, error: verdict.error });
                return null;
            }
            cache = { key, receipt: verdict.receipt };
            notify(onReady, verdict.receipt);
            return verdict.receipt;
        } catch {
            if (inFlight === job) inFlight = null;
            return null;
        }
    }

    /** 同步读当前范围的回执；没有（或范围已经变了）⇒ null。 */
    function read() {
        const key = currentKey();
        dropStale(key);
        if (!key || !cache) return null;
        return sameKey(cache.key, key) ? cache.receipt : null;
    }

    /** 异步准备当前这个固定范围；同范围在飞复用、已有回执直接复用，永不 reject。 */
    async function prefetch() {
        try {
            const key = currentKey();
            dropStale(key);
            if (!key) return null;
            if (cache && sameKey(cache.key, key)) return cache.receipt;
            if (inFlight && sameKey(inFlight.key, key)) return inFlight.promise;
            const job = { key, epoch, controller: new AbortController() };
            inFlight = job;
            job.promise = run(job);
            return job.promise;
        } catch { return null; }
    }

    /** 中止本任务并清缓存（下一次 prefetch 必须重新取）。 */
    function invalidate() {
        cache = null;
        abortInFlight();
    }

    return { read, prefetch, invalidate };
}
