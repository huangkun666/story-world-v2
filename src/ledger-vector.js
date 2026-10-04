// story-world-v2/src/ledger-vector.js
// ★★★leg152：**向量记忆层**（引擎层纯函数 · 零 IO · 零 DOM · 零网络）。
//
// 【它治什么】细案 `docs/spec-memory-engine.md` §5：账上"某个实体干过什么"这件事，
//   **按名字精确匹配永远捞不全**——真账上大量的事不点名，写的是他的地盘/势力/手下/那只商队
//   （例：第 73 轮"商队覆灭"，境内一个字都没有"万法阁"）⇒ 必须**按意思找**。
//   而"找得到"与"喂什么"是两件事，本层把两条都钉住：
//     · **搜索单元**＝一件事的一行文本（可以带时间点，见下）；
//     · **喂给模型的**＝★账上原文那一行，一个字不改（细案 §5.2 那把刀）。
//
// 【★本层的三条承重墙（每一棒都不许漂）】
//   ① **绝不发明事实**：本层只搬账上已有的字（标题/来路/波及/位置/时间点），不生成、不转述。
//      ★排不出时间点就**只写轮次**，绝不补一个年份（红线 2：空着就是空着）。
//   ② **索引只能是加速层**：向量丢了（换浏览器/清站点数据）⇒ 本层返回**空批次**，
//      账照样答（走既有那条关键词路），**不抛错、不拿 0 分冒充**。
//   ③ **窗口内的不召回**：那一段是「纪事」的活儿（包里每轮都有）⇒ 再召回就是**重复喂**。
//
// 【★两个设计选择，都出过一轮错，留档】
//   A. **什么时候嵌 = "滑出窗口那一刻"，不是"每 N 轮"、也不是"每轮"**。
//      检索**只往回看**：一件事**变成"需要被搜到"是它滑出窗口之后** ⇒ 在它滑出前后嵌，
//      **检索效果完全一样**。区别只在：早嵌是白占索引（还躺在窗口里、永远不会被召回的那些事），
//      而"定期把全部重嵌一遍"是纯重复劳动。
//      ★**窗口是旋钮不是常量**（`limits.js` 第九个旋钮「往事轮数」，档位 [30,50]，出厂 50）
//        ⇒ 下界由调用方**每轮现算**（`windowFromTick(tick, 轮数)`）递进来，**本层一个数字都不写死**。
//   B. **单元行带时间点**（`timeMark`：模型在 `newEvents[].at` 里写的那一格，逐字照抄）——
//      细案 §6① 那条纪律（"召回的东西必须自带多久以前"）的落点。
//      ★读完这一格要小心一件事（`ssot.schema.js:632` 记着）：**`timeMark` 不入卷档**，
//        老事进卷之后时间点只剩**编年行**上有 ⇒ 取时间点要走 `chronicle`（含卷的合并读法）。
//
// 【口径：只收集，不做算术】（`STATE.md` §2.2 第 1 条同源）
//   本层**绝不**把「三天」「一炷香」累加成一个"第 N 天"——那是换算。只做两件：
//   ① 原话照抄；② 归到第几轮（轮次账上本来就有，是事实不是换算）。

/** 本层用到的"轮次从哪来"的两条键（事件上两种写法都有）。导出只为判据能钉住它。 */
export const EMBED_TICK_KEYS = Object.freeze(['tick', 'id']);

/** 默认一批几行（★这是**通道参数**，不是设计常量：调用方按通道自报的能力传进来，出错就减半重试）。 */
export const EMBED_BATCH_DEFAULT = 20;

/** 召回默认给几件（提案态：数字先报批，出曲线再定案）。 */
export const RECALL_TOP_DEFAULT = 6;

/**
 * 一件事出生在第几轮。
 * ★两种写法都要认：新账事件带 `tick`；老账/世界里那批只有 id 里的 `ev_<轮>_<位次>`。
 * @returns {number|null} 认不出 ⇒ null（**不许猜**）
 */
export function tickOfEvent(ev) {
    const t = Number(ev?.tick);
    if (Number.isFinite(t)) return t;
    const m = /^ev_(\d+)_/.exec(String(ev?.id ?? ''));
    return m ? Number(m[1]) : null;
}

/** 波及的人名（照账上真名；查不到名字就照抄 id——**不许写成"某人"**）。 */
function namesOf(world, ids) {
    const by = new Map((world?.entities || []).map((e) => [String(e.id), String(e.name)]));
    return (Array.isArray(ids) ? ids : []).map((x) => by.get(String(x)) || String(x)).filter(Boolean);
}

/**
 * 一件事的**单元行**（进索引的那一行；也是搜索单元）。
 * 形状：`[第73轮 · 复苏历三年三月初七]万法阁商队覆灭 · 来路 ripple(ev_61_2) · 波及 甲/乙 · 位置 落霞谷`
 * ★时间点那一段**排不出就整段不写**（红线 2）。
 * @param {object} ev 事件
 * @param {{timeMarkOf?: (tick:number)=>string}} [opts]
 */
export function unitLineOf(ev, { timeMarkOf = null } = {}) {
    const tick = tickOfEvent(ev);
    const tm = tick == null ? '' : String((typeof timeMarkOf === 'function' ? timeMarkOf(tick) : '') ?? '').trim();
    const head = tick == null ? '[轮次不明]' : (tm ? `[第${tick}轮 · ${tm}]` : `[第${tick}轮]`);
    const src = ev?.source?.type ? String(ev.source.type) : '未记';
    const ref = ev?.source?.ref ? `(${ev.source.ref})` : '';
    const rippleIds = Array.isArray(ev?.ripples) ? ev.ripples : [];
    const names = Array.isArray(ev?.rippleNames) ? ev.rippleNames : null;   // 调用方可预先译好
    const rip = (names || rippleIds.map((x) => String(x))).filter(Boolean).join('/');
    const parts = [
        `${head}${String(ev?.title ?? '').trim()}`,
        `来路 ${src}${ref}`,
        rip ? `波及 ${rip}` : '',
        ev?.position ? `位置 ${String(ev.position)}` : '',
    ].filter(Boolean);
    return parts.join(' · ');
}

/**
 * 账上**全部可索引的事**（时间轴上的单元清单）。★一个 id 只出一条（账上重复引用不许出两条向量）。
 * @returns {Array<{id:string,tick:number|null,text:string,rippleNames:string[],ripples:string[],sourceRef:string}>}
 * @param {{timeMarkOf?: (tick:number)=>string, world?:object}} [opts] `world` 传了才能把 ripples 译成真名
 */
export function timelineOf(ssot, { timeMarkOf = null, world = null } = {}) {
    const w = world || ssot;
    const mk = (tick) => String((typeof timeMarkOf === 'function' ? timeMarkOf(tick) : '') ?? '').trim();
    const seen = new Set();
    const out = [];
    for (const ev of ssot?.events || []) {
        const id = String(ev?.id ?? '');
        if (!id || seen.has(id)) continue;
        if (!String(ev?.title ?? '').trim()) continue;      // 没有标题的事不进索引（空着就是空着）
        seen.add(id);
        const tick = tickOfEvent(ev);
        const ripIds = (Array.isArray(ev.ripples) ? ev.ripples : []).map((x) => String(x));
        out.push({
            id,
            tick,
            timeMark: tick == null ? '' : mk(tick),
            title: String(ev.title).trim(),
            text: unitLineOf(ev, { timeMarkOf: mk }),
            rippleNames: namesOf(w, ripIds),
            ripples: ripIds,
            sourceRef: ev?.source?.ref ? String(ev.source.ref) : '',
        });
    }
    return out;
}

/**
 * ★★★**编年行**的单元文本——**索引的真正单元**（leg152 实测定案，见下）。
 *
 * 【为什么单元是编年行，不是事件标题】实测（真账 `大荒z-59` · 五个实体 · 前 6 里"原文提到它"的条数）：
 *   · 事件标题当单元 ⇒ **4.20 / 6**（而且标题里常常**没有那个人的名字**）；
 *   · ★编年行当单元 ⇒ **6.00 / 6**（五个实体全部满分），★单元还更短（41 字符 对 64 字符）。
 *   机理：编年行**天生带人**——`牵动 大虞` · `因事而生：薛铁衣 由「…」生「…」` · `「黄坤」入局` ·
 *   `盘算「…」取消（薛铁衣）`；而事件的 `title` 常常只是"死煞核心二次暴动"这种**不点名**的写法。
 *   ⇒ ★顺带解决一件麻烦事：**不用额外存"这行涉及谁"**（正文里就有），也就不需要第二份真相。
 *
 * 【覆盖面的差别也是决定性的】真账里**事件 73 件 · 编年 360 行**，而其中 **237 行不带事件**
 *   （推进 / 委派 / 入局 / 结清…）——那正是"谁做了什么"的正文。只收事件 ⇒ 大半事实进不了索引。
 *
 * @param {object} row 编年行（`{id,tick,text,kind,eventRef}`）
 * @param {{timeMarkOf?: (tick:number)=>string}} [opts]
 */
export function chronicleUnitText(row, { timeMarkOf = null } = {}) {
    const tick = row?.tick == null || row?.tick === '' ? null : Number(row.tick);
    const tm = tick == null ? '' : String((typeof timeMarkOf === 'function' ? timeMarkOf(tick) : '') ?? '').trim();
    const head = tick == null ? '[轮次不明]' : (tm ? `[第${tick}轮 · ${tm}]` : `[第${tick}轮]`);
    return `${head}${String(row?.text ?? '').trim()}`;
}

/**
 * ★★★编年行那一版的"该嵌哪些"（与 `embedDelta` 同口径，只是**单元换成编年行**）。
 * ★`rows` 由调用方给（生产＝`chronicleOf(ssot, volumes)`：**热账 ＋ 卷里那些行**，
 *   与 `ledger-recall.js` 取往事**同一条路**——一处定义，别各读一份）。
 */
export function chronicleDelta(ssot, { rows = null, embedded = null, floor, timeMarkOf = null, batchSize = EMBED_BATCH_DEFAULT, volumes = null } = {}) {
    const done = embedded instanceof Set ? embedded : new Set(Array.isArray(embedded) ? embedded.map(String) : []);
    const f = Number(floor);
    const cap = Number.isFinite(Number(batchSize)) && Number(batchSize) > 0 ? Math.floor(Number(batchSize)) : EMBED_BATCH_DEFAULT;
    const src = Array.isArray(rows) ? rows : chronicleRowsOf(ssot, volumes);
    const seen = new Set();
    const items = [];
    for (const row of src) {
        const id = String(row?.id ?? '');
        if (!id || seen.has(id)) continue;
        const tick = row?.tick == null || row?.tick === '' ? null : Number(row.tick);
        if (!Number.isFinite(tick) || tick >= f) continue;        // 窗口内不嵌；认不出轮次的不嵌
        if (done.has(id)) continue;                              // 嵌过就不再回来
        if (!String(row?.text ?? '').trim()) continue;            // 没有正文的行不进索引
        seen.add(id);
        items.push({ id, tick, text: chronicleUnitText(row, { timeMarkOf }), title: String(row.text).trim(), kind: String(row?.kind ?? ''), sourceRef: row?.eventRef ? String(row.eventRef) : '', ripples: [] });
    }
    const sorted = [...items].sort((a, b) => (b.tick - a.tick) || (a.id < b.id ? -1 : 1));   // ★新的先嵌
    const batches = [];
    for (let i = 0; i < sorted.length; i += cap) batches.push(sorted.slice(i, i + cap));
    return { items: sorted, batches, pending: sorted.length };
}

/**
 * ★★★**只挑"还可能没嵌的"那些卷**（leg152 实测的规模隐患，见下）。
 *
 * 【为什么不能"每轮把全部卷都取来"】实测（真账编年 360 行按轮数等比放大）：
 *   · 跑到 **300** 轮 ⇒ 每轮读回 **≈107 KB**、累计 31 MB；
 *   · 跑到 **1000** 轮 ⇒ 每轮 **≈358 KB**、累计 **349 MB**；
 *   · 跑到 **3000** 轮 ⇒ 每轮 **≈1 MB**、累计 **3.1 GB** —— 而这些读取**零收益**（老卷早就嵌过了）。
 *   ⇒ 症状不是花钱，是**"越玩越卡"**：读量表随轮数线性涨，而水位线本来是单调的。
 *
 * 【判据（两条，都只用账上现成的字段）】
 *   ① 一卷里**最老的 tick ≥ 下界** ⇒ 整卷都还在窗口内 ⇒ **跳过**（里头不可能有待嵌的行）；
 *   ② **索引空（首次建立 / 换模型重来）⇒ 全都要**（要回填整本账，不能只挑几卷）。
 *   ★不变量：**已经嵌过的行永远不会再被挑中**（水位线答的）⇒"少取几卷"不会漏；
 *     而这里挑的正是"**还可能含未嵌行**"的那些（**交界那一卷必然入选**）。
 *
 * @returns {Array<object>} 过滤后的卷（顺序照传入顺序）
 */
export function usefulVolumes(volumes, { floor, indexEmpty = false } = {}) {
    const vols = Array.isArray(volumes) ? volumes : [];
    if (indexEmpty) return vols;                     // ② 空索引 ⇒ 全都要（回填）
    const f = Number(floor);
    if (!Number.isFinite(f)) return vols;
    return vols.filter((v) => {
        const rows = Array.isArray(v?.rows) ? v.rows : [];
        if (!rows.length) return false;
        let oldest = Infinity;
        for (const r of rows) {
            const t = r?.tick == null || r?.tick === '' ? NaN : Number(r.tick);
            if (Number.isFinite(t) && t < oldest) oldest = t;
        }
        // 认不出轮次的卷 ⇒ 保守起见留着（宁可多读一卷，也不许漏一整段）
        return Number.isFinite(oldest) ? oldest < f : true;
    });
}

/** 账上全部编年行（热账那一份；★生产还要并上**卷里那些行**——由调用方传 `rows`）。 */
function chronicleRowsOf(ssot, volumes) {
    const hot = Array.isArray(ssot?.chronicle) ? ssot.chronicle : [];
    const vols = Array.isArray(volumes) ? volumes : [];
    if (!vols.length) return hot;
    const fromVols = [];
    for (const v of vols) for (const r of (v?.rows || [])) fromVols.push(r);
    return [...fromVols, ...hot];
}

/**
 * ★★★**增量算账**：这一轮该嵌哪几件。
 * 口径（那条定案）：**只嵌"已经滑出窗口"的事**——`tick < floor`。
 *   · `floor` 由调用方每轮现算（`windowFromTick(tick, 轮数)`）⇒ **本层不写死任何轮数**；
 *   · 已经嵌过的（`embedded`）**一件都不再回来** ⇒ 一辈子只嵌一次；
 *   · 没轮次的（`tick == null`）**不嵌**（认不出先后就不许塞进时间轴——空着就是空着）。
 * @param {object} ssot
 * @param {{embedded?: Set<string>|string[], floor: number, timeMarkOf?: Function, world?: object, batchSize?: number}} opts
 * @returns {{items: Array<object>, batches: Array<Array<object>>, pending: number}}
 */
export function embedDelta(ssot, { embedded = null, floor, timeMarkOf = null, world = null, batchSize = EMBED_BATCH_DEFAULT } = {}) {
    const done = embedded instanceof Set ? embedded : new Set(Array.isArray(embedded) ? embedded.map(String) : []);
    const f = Number(floor);
    const cap = Number.isFinite(Number(batchSize)) && Number(batchSize) > 0 ? Math.floor(Number(batchSize)) : EMBED_BATCH_DEFAULT;
    const items = timelineOf(ssot, { timeMarkOf, world })
        .filter((x) => Number.isFinite(x.tick) && x.tick < f && !done.has(x.id));
    const batches = [];
    for (let i = 0; i < items.length; i += cap) batches.push(items.slice(i, i + cap));
    return { items, batches, pending: items.length };
}

/**
 * 把嵌好的向量并进索引（**只增不改**：同一个 id 已经有向量就不再动它）。
 * @param {{items:Array<object>, vectors:Map<string,number[]>}} store
 * @param {Array<object>} items
 * @param {(item:object)=>number[]} vectorOf 取向量的口（调用方按 id/文本给；测试里给假的）
 */
export function applyEmbeddings(store, items, vectorOf) {
    const next = { items: [...(store?.items || [])], vectors: new Map(store?.vectors || []) };
    for (const it of Array.isArray(items) ? items : []) {
        if (!it?.id || next.vectors.has(it.id)) continue;
        const v = vectorOf(it);
        if (!Array.isArray(v) || !v.length) continue;       // ★没有向量就不写进去（空着就是空着）
        next.items.push(it);
        next.vectors.set(it.id, v);
    }
    return next;
}

/**
 * 余弦相似度。★任一边缺/空/非数组 ⇒ **null**（不是 0）——
 *   0 分是"算过、确实不像"，null 是"根本没得算"，这两件事在读数上必须分得开。
 */
export function cosine(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return null;
    let d = 0; let na = 0; let nb = 0;
    for (let i = 0; i < a.length; i += 1) {
        const x = Number(a[i]); const y = Number(b[i]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        d += x * y; na += x * x; nb += y * y;
    }
    if (!na || !nb) return null;
    return d / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * ★★★**聊天侧这一轮交上来的事**（`source.type === 'dialogue'` 那一批，轮次对得上的）。
 *
 * 【为什么它已经躺在账上了】正文里的【行动】【变化】【承诺】由 `settle.js` 的 `registerDialogueFacts`
 *   注册成事件，而**那一步排在出包之前**（`tick.js` 的 `runTick`：先注册、后出包）——
 *   所以出包那一刻，这些"既成事实"已经是账上的一行。
 *
 * 【为什么查询串用它、不用"玩家这一轮说的那句原话"（用户 2026-09-30 裁）】
 *   索引里的单元是**账上那行**（编年行），而玩家原话是**另一种写法**：人称、口语、没有账上的词。
 *   聊天侧交上来的这批**本来就是账上那行的写法** ⇒ ★**问法与料同一种话**，比原话贴。
 *   ★而且它**包含玩家那一条**（`registerDialogueFacts` 把主角那条也一起注册了）⇒ 没有丢东西。
 *
 * @returns {string[]} 标题**原话**（不转述、不加字）；轮次对不上/认不出轮次 ⇒ 空数组
 */
export function dialogueTitlesOf(ssot, tickNow = null) {
    const raw = tickNow == null || tickNow === '' ? NaN : Number(tickNow);
    if (!Number.isFinite(raw)) return [];
    const out = [];
    for (const ev of ssot?.events || []) {
        if (String(ev?.source?.type ?? '') !== 'dialogue') continue;
        if (tickOfEvent(ev) !== raw) continue;
        const title = String(ev?.title ?? '').trim();
        if (title) out.push(title);
    }
    return out;
}

/**
 * ★"这一轮在动的人"（在飞盘算的属主 ＋ 未决事件的波及）——**查询串与召回加权共用这一处**
 *   （两处各算一次就会变成两把尺子：问的是这批人，加权的是另一批）。
 * @returns {string[]} 实体 id
 */
export function movingIdsOf(ssot) {
    const openAg = (ssot?.agendas || []).filter((a) => a && !a.closed);
    const openEv = (ssot?.events || []).filter((e) => e && !e.closed);
    const ownerIds = openAg.map((a) => String(a.owner ?? '')).filter(Boolean);
    const rippleIds = openEv.flatMap((e) => (e.ripples || []).map((x) => String(x)));
    return [...new Set([...ownerIds, ...rippleIds])];
}

/**
 * 这一轮的**查询串**：当下状态拼一句话（零额外调用——料全在手里）。
 * 三样：① 在动的人（在飞盘算的 owner ＋ 未决事件的波及）② 未办的事
 *      ③ ★**聊天侧这一轮交上来的事**（`dialogueTitlesOf`，账上那行的写法）。
 * ★空账 ⇒ 空串（不许编占位）。
 */
export function recallQueryOf(ssot, { tickNow = null, maxChars = 600 } = {}) {
    const openAg = (ssot?.agendas || []).filter((a) => a && !a.closed);
    const openEv = (ssot?.events || []).filter((e) => e && !e.closed);
    const names = [...new Set(namesOf(ssot, movingIdsOf(ssot)))];
    const bits = [];
    if (names.length) bits.push(`在动的人：${names.join('、')}`);
    const goals = openAg.map((a) => String(a.goal ?? '').trim()).filter(Boolean).slice(0, 6);
    if (goals.length) bits.push(`在办的事：${goals.join('、')}`);
    const titles = openEv.map((e) => String(e.title ?? '').trim()).filter(Boolean).slice(0, 8);
    if (titles.length) bits.push(`未决的事：${titles.join('、')}`);
    const said = dialogueTitlesOf(ssot, tickNow);
    if (said.length) bits.push(`这一轮正文：${said.join('、')}`);
    return bits.join('\n').slice(0, Math.max(0, Number(maxChars) || 600));
}

/**
 * ★★★**召回**：按意思把"窗口外的旧事"取回来。
 *
 * 三道闸（缺一条就会长出病）：
 *   ① `tick < floor`：**窗口内的不召回**（那是「纪事」的活儿，包里每轮都有）⇒ 不许重复喂；
 *   ② `excludeIds`：**已经在包里别栏递过的按行身份排掉**（一个事实只许出现一栏）；
 *   ③ `minScore`：不够像的不来；★**没有向量的候选直接不进**（降级不是拿 0 分冒充）。
 *
 * @returns {Array<{id,tick,timeMark,title,text,score,ripples,sourceRef}>} 已排序、已封顶
 */
export function recallOf(ssot, store, { query, qVector = null, floor = 0, top = RECALL_TOP_DEFAULT, minScore = 0, excludeIds = [], rippleIds = [] } = {}) {
    const q = Array.isArray(qVector) ? qVector : (Array.isArray(query) ? query : null);
    if (!q || !q.length) return [];
    const f = Number(floor);
    const cut = Number.isFinite(Number(minScore)) ? Number(minScore) : 0;
    const skip = new Set((Array.isArray(excludeIds) ? excludeIds : []).map(String));
    const touched = new Set((Array.isArray(rippleIds) ? rippleIds : []).map(String));
    // ★索引有两种形状：`vector-store.js` 的**三个等长数组**（生产）与 `Map<id, 向量>`（既有判据）。
    //   两种都认——而且**只在这一处认**（别让每个消费者各认一遍）。
    const vecAt = vectorMapOf(store);
    const rows = [];
    for (const it of indexedItemsOf(store)) {
        if (!it?.id || skip.has(String(it.id))) continue;
        if (!Number.isFinite(it.tick) || it.tick >= f) continue;          // ① 窗口内不来
        const s0 = cosine(q, vecAt.get(String(it.id)));
        if (s0 == null) continue;                                         // ③ 缺向量 ⇒ 不进（不许冒充 0 分）
        if (s0 < cut) continue;
        // 波及命中：**加权不拦截**（"这人被牵连"是加分项，不是必要条件——不许因为没点名就丢掉）
        const hit = touched.size && (it.ripples || []).some((x) => touched.has(String(x)));
        const score = Math.min(1, hit ? s0 + (1 - s0) * 0.15 : s0);
        rows.push({ ...it, score });
    }
    rows.sort((a, b) => (b.score - a.score) || (b.tick - a.tick) || (a.id < b.id ? -1 : 1));
    return rows.slice(0, Math.max(0, Number(top) || RECALL_TOP_DEFAULT));
}

/**
 * 索引里"有哪几件事"——**两种形状都认**（`store.items` 有就用它；否则由 `ids` ＋ `tickByIndex` 现推）。
 * ★为什么要有它：`vector-store.js` 那份形状（三个等长数组）**只存最少的机械字段**
 *   （id / 轮次 / 向量），够召回排序用；而"标题/时间点"这类**给人看的字**在渲染那一步
 *   由账现查（`recallForPack`），**索引里不存第二份真相**。
 */
function indexedItemsOf(store) {
    if (Array.isArray(store?.items)) return store.items;
    const ids = Array.isArray(store?.ids) ? store.ids : [];
    const ticks = Array.isArray(store?.tickByIndex) ? store.tickByIndex : [];
    return ids.map((id, i) => ({ id: String(id), tick: ticks[i] == null || ticks[i] === '' ? null : Number(ticks[i]) }));
}

/**
 * 把索引里的向量摊成 `Map<id, 向量>`——**两种形状都认，且只在这一处认**：
 *   · `vector-store.js` 的形状：`{ ids:[], tickByIndex:[], vecs:[] }`（三个等长数组，生产用）；
 *   · 既有判据的形状：`{ items:[], vectors: Map }`。
 */
function vectorMapOf(store) {
    if (store?.vectors instanceof Map) return store.vectors;
    const out = new Map();
    const ids = Array.isArray(store?.ids) ? store.ids : [];
    const vecs = Array.isArray(store?.vecs) ? store.vecs : [];
    for (let i = 0; i < ids.length; i += 1) {
        const id = String(ids[i] ?? '');
        if (id) out.set(id, Array.isArray(vecs[i]) ? vecs[i] : null);
    }
    return out;
}

/**
 * ★"这件事在**你所处的这一刻之前**"——细案 §6① 那条纪律的落点。
 * 排不出轮次 ⇒ **空串**（不许瞎说一句）；有轮次 ⇒ 明说距今多少轮、且**明说在此之前**。
 */
export function beforeNowOf(item, { tickNow } = {}) {
    // ★`Number(null) === 0` ⇒ 必须先显式排掉"没有轮次"那三种写法，否则会编出一个"第 0 轮"
    const raw = item?.tick;
    if (raw == null || raw === '') return '';
    const t = Number(raw);
    const now = Number(tickNow);
    if (!Number.isFinite(t) || !Number.isFinite(now)) return '';
    return `（第${t}轮 · 在你此刻之前${now >= t ? ` ${now - t} 轮` : ''}）`;
}

/**
 * 递给模型的**那一行**（照抄账上原文 ＋ 自带"多久以前"）。
 * ★它**不是**给模型读的总结——总结只用来搜（细案 §5.2）。
 * ★字（标题/时间点）住账上，索引里没有 ⇒ 调用方通过 `titleOf` 现查（见 `recallForPack`）。
 */
export function recalledRowOf(item, { tickNow, withScore = false, titleOf = null } = {}) {
    const tickPart = Number.isFinite(Number(item?.tick)) && item?.tick != null ? `第${Number(item.tick)}轮` : '轮次不明';
    const tm = String(item?.timeMark ?? '').trim();
    const head = tm ? `[${tickPart} · ${tm}]` : `[${tickPart}]`;
    const looked = typeof titleOf === 'function' ? titleOf(String(item?.id ?? '')) : '';
    const body = String(item?.title ?? looked ?? item?.text ?? '').trim();
    const before = beforeNowOf(item, { tickNow });
    const score = withScore && Number.isFinite(item?.score) ? ` · 相似 ${item.score.toFixed(3)}` : '';
    return `${head}${body}${before ? ` ${before}` : ''}${score}`;
}
