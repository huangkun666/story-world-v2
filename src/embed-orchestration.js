// story-world-v2/src/embed-orchestration.js
// ★★★leg152：**编排层**——一轮里"补嵌"与"召回"这两件事的胶水（细案 `docs/spec-memory-engine.md` §5/§6）。
//
// 【分工写死，免得三处各写一份】
//   · `ledger-vector.js`：**认账**（单元行 / 窗口 / 去重 / 余弦）——纯函数，零 IO；
//   · `embed-client.js` ：**碰网络**（一段文本 → 一条向量）；
//   · `vector-store.js` ：**记性**（形状 / 编解码 / 合并 / 不重写）；
//   · **本层**：把上面三样**按一轮的节奏**串起来，并且**只做决定，不做实现**。
//
// 【★★本层四条纪律（每一条的病都在别处发生过）】
//   ① **补嵌每轮封顶**（`maxItemsPerTurn`）：一次把全账嵌完 ＝ 一个窗口打开就烧一大批调用。
//      ★**新的先嵌**：窗口是从新往旧滑的 ⇒ 越新的事越早会被召回，先嵌它。
//   ② **绝不挡世界推进**：通道失败 ⇒ 记一笔、这轮跳过、下轮再来。
//      本层**没有权利**让 `runTick` 等它（引擎是账房，向量只是加速层）。
//   ③ **失败分诊**：`retryable` 的（网络/限流/超时）下轮补；不可重试的（内容/模型号）
//      如实标出来，**别每轮白撞一次**。
//   ④ **召回只读，且必须留读数**：把"窗口外候选几件、其中几件没有向量"报出来——
//      不然界面上只会看到"这一栏是空的"，**分不出"没相关"与"根本没索引"**（本仓为这条静默付过账）。
//
// 【★"世界优先"怎么落成代码】`stepEmbed` 无论成败都**返回**（不抛），并把 `blockedWorld: false`
//   摆出来——调用方据此可以把它放在出包之后、甚至完全不 await 它的结果。

import { embedDelta, chronicleDelta, recallOf, recalledRowOf } from './ledger-vector.js';   // ★`recalledRowOf` 在渲染那一行用
// ★★「这一行是什么话」那张表**全仓只有一份**（`chronicle-brief.js`）⇒ 召回递出去的那一句
//   与 `纪事`／`相关往事` 用的是**同一个洗法**（`briefLineText`：只去固定前后缀，不改写事实）。
import { briefLineText } from './chronicle-brief.js';
import { filterChatRecords } from './event-provenance.js';

/** 每轮最多补嵌几件（★提案态：数字先报批，出曲线再定案；封顶是为了"一次别烧一大批调用"）。 */
export const EMBED_PER_TURN_DEFAULT = 40;

/**
 * 索引单元的两条来源（★leg152 实测定案：**默认走编年行**）：
 *   · `chronicle`＝账上逐条记着"谁做了什么"的那一份（真账 360 行 · 前 6 里 6.00/6 属于它自己）；
 *   · `events`  ＝只收事件标题（73 件 · 4.20/6）。
 *   ⇒ 保留 `events` 只为"没有编年的老账"兜底（空着就是空着，不许拿事件冒充编年）。
 */
export const EMBED_SOURCES = Object.freeze({ CHRONICLE: 'chronicle', EVENTS: 'events' });

/**
 * 补嵌一轮。
 * @param {object} o
 * @param {object} o.ssot 世界账
 * @param {object} o.harness `vector-store.js` 的 `harnessOf(...)`（提供 store/putMany/persist）
 * @param {object|null} o.client `embed-client.js` 的客户端（没配通道 ⇒ null）
 * @param {number} o.floor 窗口下界（调用方每轮现算：`windowFromTick(tick, 往事轮数)`）
 * @param {number} [o.maxItemsPerTurn]
 * @param {Function} [o.timeMarkOf]
 * @returns {Promise<{embedded:number,pending:number,failed:number,retryable:boolean,skipped?:string,note:string|null,blockedWorld:false}>}
 */
export async function stepEmbed({ ssot, harness, client = null, floor, maxItemsPerTurn = EMBED_PER_TURN_DEFAULT, timeMarkOf = null, world = null, source = EMBED_SOURCES.CHRONICLE, rows = null, volumes = null } = {}) {
    const done = new Set(harness?.store?.().ids || []);
    // ★`batchSize` 填两处口径（见下）：`embedDelta` 只是把**待嵌的**算出来，
    //   真正的封顶在下面 `slice` ——**每轮最多补几件**是编排层的决定，不是批大小（批大小是通道的事）。
    const cap = Math.max(1, Number(maxItemsPerTurn) || EMBED_PER_TURN_DEFAULT);
    // ★★单元来源：默认**编年行**（实测定案）；★编年**一行都没有**（老账/空账）⇒ **退回事件标题**
    //   ——空着就是空着，但不许因此整层不干活（那会让老账永远没有索引）。
    //   ⚠判"有没有编年"要看**账上有没有那些行**，不能看"过滤之后剩几件"（全都还在窗口里是正常的，
    //   那时候退回事件同样一件都不会嵌——两条路都空，没必要纠结；但**判据必须能分清**这两件事）。
    const hasChronicle = (Array.isArray(rows) ? rows.length : (Array.isArray(ssot?.chronicle) ? ssot.chronicle.length : 0)) > 0;
    const useChron = source !== EMBED_SOURCES.EVENTS && hasChronicle;
    const delta = useChron
        ? chronicleDelta(ssot, { rows, volumes, embedded: done, floor, timeMarkOf, batchSize: cap })
        : embedDelta(ssot, { embedded: done, floor, timeMarkOf, world: world || ssot, batchSize: cap });
    const pending = delta.pending;
    // ★★顺序要紧（leg152 收尾验收当场咬出来的）：**"没配通道"必须先判**。
    //   原来先判 `pending === 0` 就返回 ⇒ 在"没配通道、且这一轮恰好没有待嵌的"那种情形下，
    //   回执里**没有 `skipped:'no-client'`** ⇒ 设置页那一行读数分不出"**没配**"与"**没欠账**"
    //   （本仓为这条静默付过账：界面必须能说出"为什么是空的"）。
    if (!client || typeof client.embed !== 'function') {
        return { embedded: 0, pending, failed: 0, retryable: true, skipped: 'no-client', note: '没配嵌入通道（这一层整层不启用）', blockedWorld: false, unit: useChron ? 'chronicle' : 'events' };
    }
    if (!pending) return { embedded: 0, pending: 0, failed: 0, retryable: true, note: null, blockedWorld: false, unit: useChron ? 'chronicle' : 'events' };
    // ★新的先嵌（窗口从新往旧滑）＋ ★每轮封顶（一次别烧一大批调用）
    const picked = [...delta.items].sort((a, b) => (a.tick - b.tick) || (a.id < b.id ? -1 : 1)).slice(0, cap);
    let vecs = null;
    try {
        vecs = await client.embed(picked.map((x) => x.text));
    } catch (err) {
        return {
            embedded: 0, pending, failed: picked.length,
            retryable: err?.retryable !== false,
            note: `嵌入这一批失败（${String(err?.message || err).slice(0, 80)}）——世界照常推进，下一轮再补`,
            blockedWorld: false, unit: useChron ? 'chronicle' : 'events',
        };
    }
    if (!Array.isArray(vecs) || vecs.length !== picked.length) {
        return { embedded: 0, pending, failed: picked.length, retryable: true, note: '嵌入通道回的条数对不上（这一批整批不写）', blockedWorld: false, unit: useChron ? 'chronicle' : 'events' };
    }
    const n = harness.putMany(picked, vecs);
    // ★★★**本层绝不碰盘**（leg152 当场抓出来的一个毒 bug）：`persist()` 是"把脏标记清掉"那一步，
    //   它一旦在这里被调掉，调用方（运行时）随后再问"有没有要写的"就永远拿到 false
    //   ⇒ **嵌了却一个字节都没落盘** ⇒ 下一轮把那批**再嵌一遍**（安静地烧钱，而且从读数上看不出来）。
    //   ⇒ 分工写死：**"什么时候写盘"是存储调用方的事**（`web/embed-runtime.js`），
    //     本层只把"嵌好的并进索引"（`putMany` 只改内存里那份形状）。
    return { embedded: n, pending: Math.max(0, pending - n), failed: 0, retryable: true, note: null, blockedWorld: false, unit: useChron ? 'chronicle' : 'events' };
}

/**
 * 召回一轮（**只读**）。
 * @param {object} o
 * @param {object} o.qVector 查询向量（调用方把 `recallQueryOf` 的串嵌好递进来）
 * @param {number} o.floor
 * @param {number} [o.top]
 * @param {number} [o.minScore]
 * @param {string[]} [o.excludeIds] ★已经在包里别栏递过的（按行身份去重）
 * @param {string[]} [o.rippleIds] ★这一轮在动的人（波及命中加权）
 * @param {Array<object>} [o.rows] ★**账上那些行**（生产＝热账 ＋ 卷，与 `ledger-recall.js` 的
 *   `chronicleOf` 同一份）——索引里**只有 id／轮次／向量**，正文要靠它现查。
 * @returns {{rows:string[], items:Array<{id,tick,text,line}>, report:object}}
 */
export function recallForPack(ssot, store, { qVector = null, floor = 0, top = 6, minScore = 0, excludeIds = [], rippleIds = [], tickNow = null, withScore = false, rows = null, audience = 'world', volumes = null } = {}) {
    const cand = candidateIds(store, floor, excludeIds);
    if (!Array.isArray(qVector) || !qVector.length) {
        return { rows: [], items: [], report: { reason: 'no-query', candidates: cand.length, noVector: 0, noBody: 0, returned: 0, readOnly: true } };
    }
    const scored = recallOf(ssot, store, { qVector, floor, top: Number.MAX_SAFE_INTEGER, minScore: -1, excludeIds, rippleIds });
    const filtered = audience === 'chat' ? filterChatRecords(ssot, scored, { volumes, rows }) : null;
    const cap = Math.max(0, Number(top) || 0);
    const got = filtered ? (cap ? filtered.items : []) : scored.slice(0, cap);
    // ★★★索引里**只有 id／轮次／向量**（`vector-store.js` 那三个等长数组）⇒ 正文必须**回账上现查**。
    //   索引单元是**编年行**（leg152 定案）⇒ 它的 id 是**编年行的 id**，正文在编年那儿。
    //   ★本笔接最后一根线时当场抓出来的真 bug（血证留在判据里）：原来只查 `ssot.events`，
    //     而编年行的 id 在事件表里根本不存在 ⇒ 每一行退出来都是**空壳**（只剩 `[第N轮]（…）`），
    //     而读数照样报 `reason: ok · returned: 6` ——**读数上看不出来**的那一类失效。
    //   ★两张表都要认：老账/判据里索引 id 可能是**事件 id**（那时正文＝事件标题）。
    const bodyOf = rowBodyResolver(ssot, rows);
    const now = tickNow ?? ssot?.meta?.tick ?? null;
    const items = [];
    let noBody = 0;
    for (const it of got) {
        const id = String(it?.id ?? '');
        const found = bodyOf(id);
        if (!found.text) { noBody += 1; continue; }             // 查不到正文 ⇒ 不进（空壳比没有更坏：它占额度还骗人）
        const line = recalledRowOf({ id, tick: it.tick, score: it.score, title: found.text, ...(found.timeMark ? { timeMark: found.timeMark } : {}) }, { tickNow: now, withScore });
        items.push({ id, tick: it.tick, text: found.raw, line });
        if (filtered && items.length >= cap) break;
    }
    return {
        rows: items.map((x) => x.line),
        items,
        report: {
            // ★"没相关"与"根本没索引"必须分得开（本仓为这条静默付过账）
            reason: items.length ? 'ok' : (cand.length ? 'none-matched' : 'no-candidate'),
            candidates: cand.length,
            noVector: Math.max(0, cand.length - scored.length),
            noBody,                                            // ★索引里有、账上却找不到那一行正文的有几件
            returned: items.length,
            readOnly: true,
            ...(filtered ? { provenance: { ...filtered.report, selectedIds: items.map(it => it.id) } } : {}),
        },
    };
}

/**
 * 「这件事的正文在哪」——**两张表都认，且只在这一处认**：
 *   · **编年行**（生产：索引单元就是编年行）⇒ 正文＝那一行的原文，洗成给模型看的一句（`briefLineText`）；
 *   · **事件**（老账/判据：索引 id 可能是事件 id）⇒ 正文＝事件标题（原样，它本来就不是编年行）。
 * ★`rows` 给了就用它（生产＝**热账 ＋ 卷**：旧行轮转进卷之后，热账里已经查不到它了）；
 *   没给 ⇒ 退回只看热账（判据与老调用方零扰动）。
 * @returns {(id:string)=>{text:string, raw:string, timeMark:string}}
 */
function rowBodyResolver(ssot, rows) {
    const src = Array.isArray(rows) ? rows : (Array.isArray(ssot?.chronicle) ? ssot.chronicle : []);
    const chById = new Map();
    for (const r of src) {
        const id = String(r?.id ?? '');
        if (id && !chById.has(id)) chById.set(id, r);
    }
    const titleById = new Map((ssot?.events || []).map((e) => [String(e?.id ?? ''), e]));
    return (id) => {
        const ch = chById.get(id);
        if (ch) {
            const raw = String(ch.text ?? '').trim();
            const tm = String(ch.timeMark ?? '').trim();
            return { text: raw ? briefLineText(raw) : '', raw, timeMark: tm };
        }
        const ev = titleById.get(id);
        const t = String(ev?.title ?? '').trim();
        return { text: t, raw: t, timeMark: '' };
    };
}

/** 窗口外、且不在排除名单里的候选 id（**不看向量**——所以"没索引"与"没相关"能分开）。 */
function candidateIds(store, floor, excludeIds) {
    const skip = new Set((Array.isArray(excludeIds) ? excludeIds : []).map(String));
    const f = Number(floor);
    const out = [];
    const ids = store?.ids || [];
    for (let i = 0; i < ids.length; i += 1) {
        const id = String(ids[i] ?? '');
        if (!id || skip.has(id)) continue;
        const raw = store?.tickByIndex?.[i];
        const tick = raw == null || raw === '' ? NaN : Number(raw);
        if (!Number.isFinite(tick) || tick >= f) continue;
        out.push(id);
    }
    return out;
}
