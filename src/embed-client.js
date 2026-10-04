// story-world-v2/src/embed-client.js
// ★★★leg152：**嵌入通道**——把"一段文本 → 一条向量"这件事收成**一个口**（细案 §5 那一层的取数口）。
//
// 【为什么它必须是一层、而且必须可注入】
//   ① **可注入 fetch** ⇒ 判据零成本、零网络、可复现（本仓既有先例：`transport-http.js` 的 `fetchImpl`）；
//   ② **一批几行是通道参数，不是设计常量**——不同模型/网关的上限不一样（实测百炼那份文档：
//      `qwen3.7-text-embedding*` 20 行 · `text-embedding-v3/v4` 10 行 · `v1/v2` 25 行）
//      ⇒ 本层**不写死**：按调用方给的行数发，**撞到"批量太大"就当场减半重试**，并记住学到的那一行数。
//   ③ **错误要分得开**（本仓为"把超时当瞬时错反复重试"付过账：`transport-http.js` 头注里那次最坏 31 次调用）：
//      · 网络错 / 超时 / 429 / 5xx ⇒ `retryable`（调用方可以留着下轮补）
//      · 400 且是"内容/模型号"那类 ⇒ `retryable = false`（重试无用，别白烧）
//
// 【本层不做什么（分工写死，免得两处各写一份）】
//   · 不认账、不认事件、不拼单元行（那是 `ledger-vector.js` 的事）；
//   · 不存向量（那是存储层的事）；
//   · **不重试到底**：本层只做"**同一批减半再试**"这一件，跨轮次的补嵌由编排层决定
//     （世界推进优先，嵌不上就下轮补——引擎不许被一个加速层卡住）。
//
// 【口径：绝不发明】给进来几条就要回几条，**条数对不上就返回 null**（空着就是空着），
//   绝不拿前 k 条冒充——错位一条，整套检索都在骗人。

/** 撞到"批量太大"时依次退到这些行数（最后一个是保底：单条一定要能嵌）。 */
export const EMBED_BATCH_FALLBACKS = Object.freeze([20, 10, 5, 1]);

/** 认得出是"批量太大"这一类错吗（各家的说法不一样，所以按词面多认几种）。 */
function looksLikeBatchError(status, bodyText) {
    if (status !== 400 && status !== 413 && status !== 422) return false;
    return /batch|too many|max(imum)?\s*(row|input|batch)|行数|超出|exceed|length/i.test(String(bodyText || ''));
}

/** 可重试吗：网络错（没有 status）/ 429 / 5xx ⇒ 是；4xx 里的内容错 ⇒ 不是。 */
function isRetryableStatus(status) {
    if (status == null) return true;                 // 没拿到响应 ＝ 网络层的事
    if (status === 429) return true;
    return status >= 500;
}

function normalizeBase(base) {
    return String(base || '').replace(/\/+$/, '');
}

/**
 * 造一个嵌入客户端。
 * @param {object} o
 * @param {string} o.baseUrl 形如 `https://…/compatible-mode/v1`
 * @param {string} o.apiKey
 * @param {string} o.model
 * @param {number} [o.batchSize] 第一次试几行（默认 `EMBED_BATCH_FALLBACKS[0]`）
 * @param {number} [o.dimensions] ★只在给了才带这一格（各家支持的范围不一样，别替它决定）
 * @param {string} [o.encodingFormat]
 * @param {number} [o.timeoutMs]
 * @param {Function} [o.fetchImpl] 注入的发送器（判据走这条；生产走 `globalThis.fetch`）
 */
export function createEmbedClient({
    baseUrl, apiKey, model, batchSize = EMBED_BATCH_FALLBACKS[0], dimensions = null,
    encodingFormat = null, timeoutMs = 60_000, fetchImpl = null,
} = {}) {
    const endpoint = `${normalizeBase(baseUrl)}/embeddings`;
    const send = typeof fetchImpl === 'function' ? fetchImpl : (typeof globalThis.fetch === 'function' ? globalThis.fetch : null);
    let cap = Number.isFinite(Number(batchSize)) && Number(batchSize) > 0 ? Math.floor(Number(batchSize)) : EMBED_BATCH_FALLBACKS[0];

    /** 发一批（**不再重试**：减半那件事在下面 `embed` 里做一次） */
    async function sendBatch(texts) {
        if (typeof send !== 'function') { const e = new Error('没有可用的发送通道'); e.retryable = false; throw e; }
        const body = { model, input: texts };
        // ★`Number(null) === 0` 这个坑今晚咬了两次（另一次在 `beforeNowOf`）⇒ 必须先显式排掉"没给"
        if (dimensions != null && Number.isFinite(Number(dimensions))) body.dimensions = Number(dimensions);
        if (encodingFormat) body.encoding_format = String(encodingFormat);
        let res;
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(new Error(`嵌入超时（${timeoutMs}ms）`)), timeoutMs) : null;
        try {
            res = await send(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify(body),
                ...(ctl ? { signal: ctl.signal } : {}),
            });
        } catch (err) {
            const e = new Error(`嵌入通道失败：${err?.message || err}`);
            e.retryable = true;                  // ★网络层的事 ⇒ 可以留着下轮补
            e.cause = err;
            throw e;
        } finally {
            if (timer) clearTimeout(timer);
        }
        if (!res.ok) {
            const snippet = String(await res.text().catch(() => '')).slice(0, 240);
            const e = new Error(`嵌入通道 HTTP ${res.status}${snippet ? `：${snippet}` : ''}`);
            e.status = res.status;
            e.batchTooBig = looksLikeBatchError(res.status, snippet);
            e.retryable = e.batchTooBig ? false : isRetryableStatus(res.status);   // ★批太大不是"可重试"，是"该换个小批"
            throw e;
        }
        const data = await res.json();
        const vecs = Array.isArray(data?.data) ? data.data.map((d) => d?.embedding) : [];
        return vecs;
    }

    return {
        /** 现在学到的一批几行（调用方可以据此报读数） */
        batchSize: () => cap,
        endpoint,
        /**
         * 把一批文本嵌成向量。
         * @returns {Promise<number[][]|null>} ★条数对不上 ⇒ **null**（绝不拿前 k 条冒充）
         */
        async embed(texts) {
            const list = (Array.isArray(texts) ? texts : []).map((x) => String(x ?? ''));
            if (!list.length) return [];                       // ★空输入 ⇒ 零调用
            const out = [];
            for (let i = 0; i < list.length; i += cap) {
                let slice = list.slice(i, i + cap);
                let vecs = null;
                // ★批太大 ⇒ 当场减半再试（只在这一层做；跨轮次的补嵌归编排层）
                for (let attempt = 0; ; attempt += 1) {
                    try {
                        vecs = await sendBatch(slice);
                        cap = Math.max(1, Math.min(cap, slice.length));   // 记住真用得上的行数
                        break;
                    } catch (err) {
                        if (!err?.batchTooBig) throw err;
                        const next = Math.max(1, Math.floor(slice.length / 2));
                        if (next === slice.length) throw err;             // 已经单条了还不成 ⇒ 如实抛
                        slice = slice.slice(0, next);
                    }
                    if (attempt > EMBED_BATCH_FALLBACKS.length + 4) throw new Error('嵌入通道：批量减半重试次数用尽');
                }
                if (!Array.isArray(vecs) || vecs.length !== slice.length) return null;
                out.push(...vecs);
            }
            return out.length === list.length ? out : null;
        },
    };
}

/** 探针用的那句文本（固定，不含任何账上内容——免得把玩家的东西送出去）。 */
export const PROBE_TEXT = '这条通道通不通';

/**
 * ★★设置页那几格的**唯一真源**（渲染层与浏览器接线都读它）。
 *
 * ★为什么它住在 `src/` 而不是 `web/`：`src/render.js` 要画那几格的缺省值，而 `src/` **不许反向 import `web/`**
 *   （本仓分层纪律）。⇒ 口径住这里，`web/embed-channel.js` 只管"怎么把它们接到界面上"。
 */
export const EMBED_INPUTS = Object.freeze({
    baseUrl: 'sw2_emb_base',
    apiKey: 'sw2_emb_key',
    model: 'sw2_emb_model',
    dims: 'sw2_emb_dims',
    rowsPerRequest: 'sw2_emb_rows',
});

/**
 * 出厂缺省（★全是提案值）。
 * ★★★leg172：那句"体检能量出真上限"**已删**——量容量那条路（按钮＋函数）已按用户令撤掉
 *   （「**我用过这么多记忆插件没见过要用户来量一批几行的**」）。"一批几行"的缺省只是一个**保守的起点**：
 *   真上限由 `createEmbedClient` 在**撞到批量过大时减半再试**学到（`embed()` 里那条，唯一的学法是它）。
 */
export const EMBED_DEFAULTS = Object.freeze({
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.7-text-embedding-flash',
    dims: 1024,
    rowsPerRequest: EMBED_BATCH_FALLBACKS[0],
});

/**
 * 从"设置那一坨"里读出嵌入通道的配置。★认不出的格一律留空（空着就是空着），
 *   **绝不替玩家编一个地址或模型号**（编了就会安静地去打一个不存在的服务）。
 */
export function readEmbedConfig(settings = {}) {
    const s = settings && typeof settings === 'object' ? settings : {};
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    const num = (v) => {
        if (v == null || v === '') return null;      // ★`Number(null) === 0` 那个坑
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : null;
    };
    return {
        enabled: s.embedEnabled === true,
        baseUrl: str(s.embedBaseUrl),
        apiKey: str(s.embedApiKey),
        model: str(s.embedModel),
        dims: num(s.embedDims),
        rowsPerRequest: num(s.embedRowsPerRequest),
    };
}

/** 这一族**启用了吗**：三样（地址/密钥/模型号）齐了才算——缺一样就整层不启用（不是"用一半"）。 */
export function embedEnabled(cfg = {}) {
    return cfg.enabled === true && embedConfigured(cfg);
}

export function embedConfigured(cfg = {}) {
    return Boolean(cfg.baseUrl && cfg.apiKey && cfg.model);
}

/**
 * 一行人话读数（印在设置页那一行）。
 * ★★**"没相关"与"没索引"必须分得开**（本仓为这条静默付过账）⇒ 四种状态各有各的话：
 *   · 没启用 → "没配（这一层不启用）"
 *   · 一个都没嵌 → "还没嵌过（滑出「往事」窗口的事会开始补）"
 *   · 嵌过但有欠账 → "已嵌 X 件 · 还欠 Y 件"
 *   · 旁路失败 → 把**失败原因**带上（不许只说"失败"）
 */
export function embedReadoutLine(stats = {}) {
    const s = stats && typeof stats === 'object' ? stats : {};
    // ★措辞照**玩家可见面**那套：叫「记忆通道」（与设置页那张卡同名），不写"嵌入通道"这类内部词
    //   （`BLACKLIST` 的扫描面会咬；"嵌入"不是禁词，但**一句话里两个名字**才是真毛病）。
    if (!s.enabled) return '记忆通道：没配（这一层不启用——世界照常跑，只是旧事查不了）';
    const bits = [];
    const n = Number(s.count) || 0;
    const pending = Number(s.pending) || 0;
    if (!n) bits.push('还没嵌过（滑出「往事」窗口的事会开始补）');
    else bits.push(`已嵌 ${n} 件`);
    if (pending > 0) bits.push(`还欠 ${pending} 件`);
    if (Number(s.dims) > 0) bits.push(`${Number(s.dims)} 维`);
    if (Number(s.rowsPerRequest) > 0) bits.push(`一批 ${Number(s.rowsPerRequest)} 行`);
    if (s.failed) bits.push(`注意：上一轮失败：${String(s.failureNote || '原因没记下来')}`);
    if (s.lastEmbedded) bits.push(`上一轮补了 ${Number(s.lastEmbedded)} 件`);
    // ★★★leg153：**召回那一栏的读数**——细案 §8.5.4 那句"这四件事必须分得开"的落点。
    //   ★只在这一层真跑过一轮之后才印（没跑过就不印，不许印一个"0 件"冒充读数）。
    //   ★返回 0 条时，**说清是哪一种 0**：没候选（索引里窗口外一件都没有）／没相关（有候选但）
    //     ／ 索引里那些行在账上找不到正文（`noBody`，本笔接最后一根线时抓出来的真 bug 的可读面）。
    const rc = s.recall && typeof s.recall === 'object' ? s.recall : null;
    if (rc) {
        const got = Number(rc.returned) || 0;
        if (got) bits.push(`按意思找回 ${got} 件（候选 ${Number(rc.candidates) || 0}）`);
        else if (rc.reason === 'no-candidate') bits.push('按意思找：窗口外还没有可找的旧事');
        else if (rc.reason === 'none-matched') bits.push(`按意思找：候选 ${Number(rc.candidates) || 0} 件，一件都没对上`);
        else if (rc.reason === 'bad-vector') bits.push('注意：上一轮按意思找：通道回的向量对不上（整批不用）');
        else if (rc.reason === 'error') bits.push(`注意：上一轮按意思找出错：${String(rc.note || '原因没记下来')}`);
        if (Number(rc.noVector) > 0) bits.push(`其中 ${Number(rc.noVector)} 件还没嵌`);
        if (Number(rc.noBody) > 0) bits.push(`注意：${Number(rc.noBody)} 件在账上找不到正文（索引与账对不上）`);
    }
    return `记忆通道：${bits.join(' · ')}`;
}

/**
 * ★★**体检**：一次最小请求，把"地址/密钥/模型号/维度"三件事一次问清。
 *
 * 为什么要它（不是装饰）：① 用户填完三个框**必须当场知道通没通**（本仓既有先例：
 * `transport-http.js` 的 `probeModel`——一次最小真实请求验地址/密钥/模型号三样）；
 * ② ★它顺手量出**向量多少维**（收窄成"用多大的向量"那个旋钮）；③ 它**不碰账**
 * （只发固定那一句）⇒ 不发玩家内容出去。
 *
 * ★★**它学不到"一批几行"**（这一点被自己的判据当场抓出来过）：只发一行 ⇒ 学到的上限恒为 1。
 *   ★★★leg172：那个数**不再有"让玩家手动量一次"的路**（用户令：「**我用过这么多记忆插件没见过
 *   要用户来量一批几行的**」）——唯一的学法是 `createEmbedClient` 在**撞到批量过大时减半再试**
 *   （见 `embed()` 里那条），学到就记住（`client.batchSize()`）。
 *
 * @returns {Promise<{ok:boolean,ms:number,dims:number|null,rowsTried:number,error?:string,retryable?:boolean}>}
 *   ★失败也**不抛**（返回 `ok:false` + 人话 `error`）——体检的调用方要把它印到界面上。
 */
export async function probeEmbedChannel({ baseUrl, apiKey, model, dimensions = null, timeoutMs = 30_000, fetchImpl = null } = {}) {
    const client = createEmbedClient({ baseUrl, apiKey, model, dimensions, timeoutMs, fetchImpl, batchSize: 1 });
    const t0 = Date.now();
    try {
        const vs = await client.embed([PROBE_TEXT]);
        const ms = Date.now() - t0;
        if (!Array.isArray(vs) || !vs.length) return { ok: false, ms, dims: null, rowsTried: 0, error: '通道回了空向量（地址或模型号可能不对）', retryable: false };
        const dims = Array.isArray(vs[0]) ? vs[0].length : null;
        return { ok: true, ms, dims, rowsTried: 1 };
    } catch (err) {
        const ms = Date.now() - t0;
        return {
            ok: false, ms, dims: null, rowsTried: 0,
            retryable: err?.retryable !== false,
            error: String(err?.message || err).slice(0, 200),
        };
    }
}

// ★★★leg172（用户令「**把这个量一批几行的按钮去掉吧，我用过这么多记忆插件没见过要用户来量一批几行的**」）：
//   **`probeEmbedChannelCapacity` 整个函数已删**（连同设置页那枚按钮、`measure-embed-rows` 动作与
//   `web/index.js` 的接线）。删的依据不是"少一个入口"，而是**那个数本来就不该由玩家来量**：
//   `createEmbedClient` 在撞到"批量太大"时会**当场减半再试**并记住学到的行数（`embed()` 里那条，
//   判据 `test/embed-client.test.js` 的 E2 咬着它）——"量容量"这件事**已经在生产路径里自动发生了**。
//   ★留档那个假读数的教训（免得下一任又想把它请回来）：那个函数第一版走 `embed()`，而 `embed()` 自己
//     会缩批 ⇒ "发 8 行"永远看起来成功、量出来的上限恒等于 `maxRows`（判据当场抓出来的）。
//   ⇒ 要再立这种"量一次"的路，必须先回答"它凭什么比自动缩批更可信"。
