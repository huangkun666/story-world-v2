// story-world-v2/web/settings-channels.js
// ★★★leg152：**设置页两条通道的装配**（模型通道 ＋ 记忆通道）——从 `web/index.js` 搬出来的一族。
// ★★★leg161（用户令「**那就让聊天侧也接上向量检索呗**」）：**记忆通道那一族接回来**，本模块随之复活，
//   并且**多担一件**：造"聊天侧那条向量召回口"（见下面 `makeVectorRecall`）。
//
// 【为什么必须搬】`web/index.js` 有**硬锁 `<3100` 行**（`test/web-view-state-layout.test.js`），
//   而这一族要往接线层加：两条通道的 import ＋ 造两个 hub ＋ 挂五枚按钮 ＋ 造运行时 ＋ 一条召回口。
//   照本仓既有纪律：**要往接线层加东西，先把一族搬出去**
//   （leg142 搬模型通道那一族、leg150 搬候选池那一族、leg160 把说书页那一格归一进 `src/panorama.js`）。
//   ⇒ 这里把"两条通道怎么造、按钮怎么挂、召回口怎么拼"收成一处；`index.js` 只剩**装配那几行**。
//
// 【★分工】本模块只做**装配**（造 hub、把动作名挂到总线上）：
//   · 模型通道的形状与流程 ⇒ `web/model-channel.js`（它早就自成一族）；
//   · 记忆通道的形状与流程 ⇒ `web/embed-channel.js` ＋ `web/embed-runtime.js`；
//   · **本模块不做任何判断**，也不碰 DOM（全部经注入进来的 `deps`）。
//
// 【★零 Node 内建依赖、顶层零 DOM 访问】（`test/browser-compat.test.js` 的扫描面）。

import { createEmbedChannelHub } from './embed-channel.js';
import { createEmbedRuntime } from './embed-runtime.js';
import { createEmbedClient, readEmbedConfig, embedEnabled } from '../src/embed-client.js';

/**
 * ★★★leg161：**造记忆通道那两个把手**（hub ＋ 运行时）——把"要读设置、要造客户端、要算窗口"
 * 这一坨从接线层收进本模块（`web/index.js` 有 `<3100` 行硬锁）。
 *
 * 【为什么运行时那一坨住这里】它要读**三格设置**（地址/密钥/模型号）与**账上的窗口旋钮**——
 *   全是"这一族的形状"，不是"接线层的形状"。★接线层只递**它才有**的东西：
 *   索引库（`indexStore`）、现取设置（`getSettings`）、写设置（`writeSetting`）、面板窗口（`getWin`）、
 *   现取世界（`getWorld`）。
 *
 * 【★签名（模型号/维度）为什么必须进 `signature`】换了模型号或维度 ⇒ `vector-store.js` 的
 *   `harnessOf` 把旧索引**解成空索引**（＝"还没嵌过"）——这是**有意**的：不同模型号的向量不可比，
 *   凑合读会安静地给出假相似度。⇒ 签名变了就等于重嵌，这是纪律不是缺陷。
 *
 * @param {object} deps
 * @param {object}   deps.indexStore    向量索引的本地存储（生产＝`web/idb-backend.js` 的 `createIdbVectorStore(chatId)`）
 * @param {Function} deps.getSettings   现取那一坨设置
 * @param {Function} [deps.writeSetting] 写一格设置（点模型清单时**只写 `embedModel`**）
 * @param {Function} [deps.getWin]      现取面板窗口元素（只原地换清单/结论两块，不重画整页）
 * @param {Function} [deps.getWorld]    现取世界账（算窗口下界用；取不到 ⇒ 退回出厂窗口）
 * @param {Function} [deps.getWindowTurns] 现取「往事轮数」（账上设的优先）
 * @param {Function} [deps.onStatus]    报一句话给状态条
 * @param {object}   [deps.channelDeps] 造 hub 的那一坨依赖（`probeChannel`/`fetchImpl`，原样透传）
 * @returns {{embedChannel:object|null, embedRuntime:object, actions:object}}
 */
export function createEmbedWiring({ indexStore, getSettings, writeSetting = null, getWin = null, getWorld = null, getVolumes = async () => [], getScope = () => '', getWindowTurns = null, onStatus = null, channelDeps = {} } = {}) {
    const readCfg = () => {
        try { return readEmbedConfig(getSettings?.() || {}); } catch (_) { return {}; }
    };
    const embedRuntime = createEmbedRuntime({
        indexStore,
        clientFactory: () => { const cfg = readCfg(); return embedEnabled(cfg) ? createEmbedClient({ ...cfg, dimensions: cfg.dims, batchSize: cfg.rowsPerRequest || undefined, fetchImpl: channelDeps.fetchImpl }) : null; },
        signature: () => ({ model: String(readCfg().model || ''), dims: Number(readCfg().dims) || 0, provider: String(readCfg().baseUrl || '').replace(/\/+$/, '') }),
        getScope,
        windowTurns: () => {
            try {
                const n = Number(getWindowTurns?.());
                return Number.isFinite(n) && n > 0 ? n : undefined;
            } catch (_) { return undefined; }
        },
        onStatus,
    });
    const embedChannel = createEmbedChannelHub({
        getSettings,
        writeSetting,
        getWin,
        setStatus: onStatus,
        probeChannel: channelDeps.probeChannel,
        fetchImpl: channelDeps.fetchImpl ?? null,
        stepEmbedFor: ({ world, dialogue, volumes }) => embedRuntime.stepForTick({ world, dialogue, volumes }),
        getStats: () => embedRuntime.lastStats?.() || {},
        recallFor: (o) => embedRuntime.recallForTick(o),
        onStatus,
    });
    const actions = {
        // ★这三枚按钮/清单项在设置页那张「记忆通道（向量）」卡上（`src/render.js` 画的）——
        //   按钮画了没人接 = 死代码，本仓有判据专门咬这一条。
        'probe-embed': () => embedChannel.probe(),
        // ★★★leg172：取清单与点选（用户令「给记忆通道也添加一个获取模型列表」）。
        //   ★「量一批几行」那条动作（`measure-embed-rows`）**已撤**——那个数由通道自动缩批学到。
        'list-embed-models': () => embedChannel.listModelsAction(),
        'pick-embed-model': (payload) => embedChannel.pickModelAction(payload?.model),
    };
    let job = null, epoch = 0;
    function refreshProgress() {
        const el = getWin?.()?.querySelector?.('#sw2_embed_progress'); if (!el) return;
        const s = embedRuntime.lastStats();
        el.textContent = !embedChannel.enabled() ? (readCfg().enabled ? '关键词检索 · 向量配置未齐' : '关键词检索')
            : s.note ? `补齐失败：${s.note}` : s.pending == null ? '正在校验历史…'
            : `已索引 ${s.count} 条 · 连续完成至 ${s.completedThrough} 轮 · 待补齐 ${s.pending} 条`;
    }
    async function catchUp() {
        refreshProgress();
        if (job || !embedChannel.enabled() || !getWorld?.()) return job;
        const started = epoch;
        job = (async () => {
            try {
                while (started === epoch && embedChannel.enabled()) {
                    const world = getWorld?.(); if (!world) break;
                    const volumes = await getVolumes();
                    if (started !== epoch) break;
                    const r = await embedChannel.stepForTick({ world, volumes });
                    refreshProgress();
                    if (started !== epoch || r?.skipped || r?.note || !r?.pending || !r?.embedded) break;
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            } catch (err) { onStatus?.(`注意：历史补齐失败：${err.message}`); }
            finally { job = null; }
        })();
        return job;
    }
    function invalidate(reload = false) { epoch++; embedRuntime.invalidate(reload); }
    function settingsChanged(reload = false) { invalidate(reload); refreshProgress(); if (job) return job.finally(() => catchUp()); return catchUp(); }
    return { embedChannel, embedRuntime, actions, catchUp, settingsChanged, invalidate };
}

/**
 * 造"两条通道"的装配结果。
 * @param {object} deps
 * @param {Function} deps.createModelHub  `createModelChannelHub`（模型通道那个）
 * @param {object}   deps.modelDeps       造模型 hub 的那一坨依赖（原样透传）
 * @param {Function} [deps.createEmbedHub] `createEmbedChannelHub`
 * @param {Function} [deps.createEmbedRuntime] `createEmbedRuntime`
 * @param {object}   [deps.embedDeps]     造记忆 hub 的那一坨依赖
 * @param {object}   [deps.runtimeDeps]   造向量运行时的那一坨依赖
 * @returns {{modelChannel:object|null, embedChannel:object|null, embedRuntime:object|null, actions:object}}
 *   ★`actions` 是"动作名 → 处理函数"，由调用方挂到 `window.__sw2Actions`（**本模块不碰全局**）。
 */
export function createSettingsChannels({ createModelHub, modelDeps = {}, createEmbedWiring = null, embedDeps = null } = {}) {
    const modelChannel = typeof createModelHub === 'function' ? createModelHub(modelDeps) : null;
    const wiring = (typeof createEmbedWiring === 'function' && embedDeps) ? createEmbedWiring(embedDeps) : null;
    const embedChannel = wiring?.embedChannel || null;
    const embedRuntime = wiring?.embedRuntime || null;
    const actions = {};
    if (modelChannel) {
        actions['list-models'] = () => modelChannel.listModelsAction();
        actions['probe-model'] = () => modelChannel.probeModelAction();
        actions['pick-model'] = (payload) => modelChannel.pickModelAction(payload?.model);
    }
    Object.assign(actions, wiring?.actions || {});
    return { modelChannel, embedChannel, embedRuntime, actions };
}

/**
 * ★★★leg161：造**聊天侧那条向量召回口**——`createInjector` 的 `vectorRecall` 依赖就是它。
 *
 * 【它答的是什么】"拿**正文最近 N 条**去账本的向量索引里找最像的旧事"——
 *   ★这与 `yuzuki-Memory` 的「**检索上下文深度**」是同一件事（它 `extractSearchText` 从 `ctx.chat`
 *     末尾往回凑 `depth` 条当查询串）；★差别只在**索引什么料**：它索引模型写的总结，
 *   我们索引**世界账的编年行**（机械因果事实）。
 *
 * 【为什么这一路要单独一个口，而不是让 `web/inject.js` 自己调向量层】
 *   · `apply()` 是**同步**的（ST 的注入口是同步的），而"把查询串嵌成一条向量"要**一趟网络**
 *     ⇒ 不能在里面 await；⇒ 定稿：**注入器在消息进来时后台备好、同步读缓存**，
 *     本函数就是"备"的那一半（`prefetchVectors` 调它）。
 *   · 存储与网络住这一侧，`web/inject.js` 照旧零 indexedDB 顶层访问（Node 里可直接真跑）。
 *
 * 【★聊天用当前轮次加一作下界】底层选 `tick < floor`；零下界会排掉正常轮次，不能表示全账。
 *   聊天侧与"世界模型那一栏"**不同**：那一栏有「纪事」在兜底，
 *   所以只补窗口外那一段；聊天侧**没有兜底**，所以**全账都算候选**——
 *   这正是用户那句「**保证相关度最大就不用管时间了**」的落点。
 *   ★窗口下界那一格（「往事轮数」）在这一路上**不参与**（它管的是"世界模型看多旧"，不是这里）。
 *
 * 【失败零阻塞】没配通道 / 索引是空的 / 抛错 ⇒ 返回 `null` ⇒ 注入器那一轮只走字面路
 *   （＝本笔之前的行为，不是坏行为）。
 *
 * @param {object} deps
 * @param {Function} deps.getCtx      现取 ST 上下文（**不许抓死**：换聊天要给新对话注入）
 * @param {Function} deps.getWorld    现取世界账
 * @param {Function} deps.getRuntime  现取向量运行时（装配晚于本口，故用函数）
 * @param {Function} deps.getVolumes  现取卷（冷档里的旧编年）
 * @param {Function} deps.queryTextOf `(ctx, depth) → 查询串`（生产＝`web/inject.js` 的 `sw2RecallQueryText`）
 * @param {object|Function} deps.params 那几格 `{top, minScore, depth}`；
 *   ★★★（2026-10-05）**也可以是一个函数** —— 那就每次召回现取一次现值。
 *   为什么非这样不可：旧法在**装配时抓死**这几格，于是参数页上填的数字永远输给出厂常数
 *   （「最大召回条数」填几都是 6）。★**默认仍是常数** ⇒ 不传函数的调用方行为逐字节不变。
 * @returns {Function} `() => Promise<Array<{id,tick,text}>|null>`
 */
export function makeVectorRecall({ getCtx, getWorld, getRuntime, getVolumes, queryTextOf, params = {} } = {}) {
    // 出厂那次取值只为"没有设置时"兜底；下面每次召回都**现取**（传函数的调用方）。
    const at = () => {
        const p = (typeof params === 'function' ? params() : params) || {};
        const int = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : fallback);
        return { top: int(p.top, 6), depth: int(p.depth, 2), minScore: Number.isFinite(Number(p.minScore)) ? Number(p.minScore) : 0 };
    };
    return () => {
        const p = at();
        const runtime = getRuntime?.();
        const world = getWorld?.();
        if (!runtime || !world) return null;
        let text = '';
        try { text = String(queryTextOf?.(getCtx?.(), p.depth) || ''); } catch (_) { text = ''; }
        if (!text.trim()) return null;                       // 没正文可问 ⇒ 不编一句去撞网络
        // ★**永不抛**：这一路是加速层（`recallForTick` 自己吞异常、失败返 null）。
        return runtime.recallForTick({
            ssot: world,
            tickNow: Number(world?.meta?.tick) || null,
            floor: Math.max(0, Number(world?.meta?.tick) || 0) + 1, // ★覆盖当前全账，不套近期窗口
            volumes: (() => { try { return getVolumes?.() ?? null; } catch (_) { return null; } })(),
            queryText: text,
            top: p.top,
            minScore: p.minScore,
        });
    };
}
