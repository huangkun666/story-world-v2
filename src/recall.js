// story-world-v2/src/recall.js
// ★leg34（用户 2026-09-13 追问「为什么聊天 llm 能够直接获取想要的世界书内容呢还能通过向量化搜索直接在插件里搜到呢
//   都是一轮解决的啊」）：**世界书检索注入**——把"模型主动查"换成"出包前按上下文检索，当轮就注入"。
//
// 为什么撤掉原来那版（我自己的设计，已撤，留档）：
//   我第一版做成 `fieldQueries` = **模型在世界步里点名要哪个字段** ⇒ 检索只能在**结算之后**发起 ⇒ 值**晚一轮**才到模型眼前，
//   还要跨轮存待办（`meta.pendingQueries`）、取回后再挂一段（`meta.fieldsFetched`）、还得管生命周期清理。
//   ★而 ST 那套"一轮解决"根本不是模型去搜——是**系统在模型开口之前**把书塞进提示词：
//     · 关键词世界书：ST 扫**拼好的上下文**，命中条目关键词就注入；
//     · 向量召回：`yuzuki-Memory` 扫**请求体**做向量检索（余弦相似度 + 实体加权）后注入。
//   两条都在**组装提示词那一刻**完成 ⇒ 模型只是"读到了别人替它搜好的东西"，零额外调用、零跨轮状态。
//   ⇒ 本文件照同一条思路做：**出包之前**检索（`preStep` 已经是这个位置——它明写"必须在 buildEvolutionPack
//     之前跑，否则这一轮主调用看不到刚查回来的字段"），命中的片段随包**当轮**递给模型。
//
// ★三条口径：
//   ① **只读、零副作用**：本模块不写账（只往 `meta.recalled` 记"这一轮检索了什么·命中几条"，供出包与自证面读）。
//   ② **失败零阻塞**：检索器没有 / 没开 / 抛错 —— 一律返回空数组，世界照常推进（与查书那条路同一纪律）。
//   ③ **不发明事实**：注入的是**世界书原文片段**（逐字），不是引擎生成的文本；来源（书名 #序号）一并带上，
//      与"实体表 `location` 带（推）标记"同一种诚实：**让模型知道这是从书里拿的，以及从哪拿的**。

// 检索器从哪来：`yuzuki-Memory` 把 `YuzukiMemory.VectorStore` 暴露成**单例**（vector-store.js:862）
//   ⇒ 直接可用；`search(query, allowedBookIds)` 返回 `[{text, score, source}]`（同一份实现里做余弦 + 实体加权）。
//   ★注意：它自己会判"注入向量记忆未启用 / 没绑定向量书 / 维度不匹配"并**返回空数组**（不抛）——那是它的开关，
//     不是错误 ⇒ 我们这边**不重复判**，只如实记读数。
const RECALL_CHARS_DEFAULT = 4000;      // 提案态（铁律 2）：召回文本总字符上限——不设上限等于让检索把预算吃掉
const RECALL_QUERY_CHARS = 1200;        // 提案态：拿去做 query 的字符上限（检索器自己也会截 6000）
const RECALL_LIMIT_DEFAULT = 5;         // 提案态：最多收几段

// 浏览器侧取单例（Node 里没有 ⇒ 返回 null ⇒ 走"检索器不可用"分支，测试用注入的假检索器）
export function browserVectorStore() {
    if (typeof window === 'undefined') return null;
    return window.YuzukiMemory?.VectorStore || null;
}

/**
 * 拿什么去检索——**只用账上真有的字**（零编造）：
 *   ① 本轮镜头选中的实体名（`picks`，引擎选/模型定，都是有戏的人）
 *   ② 未决事件标题里点到的实体名（"谁在这件事里"）
 *   ③ 未决事件标题本身（"正在发生什么"）
 * 顺序 = 重要性顺序（检索器按整串做 embedding，前头的权重更实）。
 */
export function collectRecallQuery(ssot, { picks = null, limit = 60 } = {}) {
    const byId = new Map((ssot?.entities || []).map((e) => [e.id, e]));
    const nameOf = (id) => byId.get(id)?.name || null;
    const parts = [];
    const push = (s) => { if (s && !parts.includes(s)) parts.push(s); };
    for (const id of picks || []) push(nameOf(id));
    const open = (ssot?.events || []).filter((e) => !e.closed);
    for (const ev of open) for (const r of ev.ripples || []) push(nameOf(r));
    for (const ev of open) push(ev.title);
    return parts.slice(0, limit).join(' ');
}

/**
 * 出包前检索（**当轮可见**）。`store` 可注入（测试；缺省取浏览器单例）。
 * @returns {Promise<{ok:boolean, chunks:Array<{text:string,source:string,score:number}>, reason:string|null, queryChars:number}>}
 *   永不抛：任何异常都折成 `{ok:false, chunks:[], reason}`。
 */
export async function recallWorldBook({ ssot, picks = null, store = undefined, limit = RECALL_LIMIT_DEFAULT, maxChars = RECALL_CHARS_DEFAULT } = {}) {
    const out = { ok: false, chunks: [], reason: null, queryChars: 0 };
    let s = store;
    try {
        if (s === undefined) s = browserVectorStore();
        if (!s || typeof s.search !== 'function') { out.reason = '检索器不可用（没装/没开向量书）'; return out; }
        const q = collectRecallQuery(ssot, { picks });
        out.queryChars = q.length;
        if (!q) { out.reason = '没有可检索的上下文（实体与事件都空）'; return out; }
        const hits = await s.search(q.slice(0, RECALL_QUERY_CHARS));
        if (!Array.isArray(hits) || !hits.length) { out.reason = '检索无命中'; return out; }
        let used = 0;
        for (const h of hits.slice(0, limit)) {
            const text = String(h?.text || '').trim();
            if (!text) continue;
            if (used + text.length > maxChars) break;        // 逐条算，超上限就停（不半条截断）
            used += text.length;
            out.chunks.push({ text, source: String(h?.source || ''), score: Number(h?.score) || 0 });
        }
        out.ok = out.chunks.length > 0;
        if (!out.ok) out.reason = '命中片段均为空或超上限';
    } catch (err) {
        out.reason = `检索失败：${err?.message || err}`;      // ② 失败零阻塞
    }
    return out;
}

// ★leg35（实机闭环自验抓出的真缺陷，用户令修）：**「往事标记」——时间要说出来，不能靠形容词**。
//   本棒实测（真账 tick 59、真 embedding、真模型 5 轮）：检索**真跑了**（1024 维、6 段全过门槛），
//   但召回原文是**开局那几轮的会话总结**（自带 19021年05月05日 这类日期），而**账上一点时间信息都没有**
//   （meta 只有 tick）⇒ 模型没有任何机械手段知道那是 59 轮前的事。
//   原文台头只写了一句 不是新发生的事 —— 那是**形容词**：模型读不出"多久以前"。
//   ⇒ 改成**机械标记**：把片段里**真读出来的**日期/轮次段原样列出来，并写明位于哪个位序（"早于本轮"），
//     外加一句硬口径（这些是往事、其后果已由本回合的盘算与事件承载）。
//   ★不许编时间：**没读出日期就只报位序**，绝不替它补一个年份（那是"编数"，红线）。
const TIME_PATTERNS = [
    /\d{3,5}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*,?\s*\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?)?/g,   // 19021年05月05日,08:00-08:30
    /\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*,?\s*\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?)?/g,                     // 05月05日
    /第\s*\d+\s*(?:[-–~至]\s*\d+\s*)?轮/g,                                                                // 第 1–10 轮
];

/** 从一段召回原文里**机械抽出**时间标记（零编造：抽不出就是空数组）。返回去重后的原样字符串。
 *  ★按"已占字符区间"去重：`19021年05月05日,11:00-12:00` 里那截 `05月05日,11:00-12:00`
 *    是**同一条时间的尾部**，不是第二条时间 ⇒ 落在已占区间里的命中一律丢掉（否则台头会重复报同一件事）。 */
export function timeMarksOf(text) {
    const src = String(text || '');
    const spans = [];       // [start, end) 已占区间
    const out = [];
    for (const re of TIME_PATTERNS) {
        const r = new RegExp(re.source, re.flags);
        let m;
        while ((m = r.exec(src))) {
            const start = m.index;
            const end = start + m[0].length;
            if (spans.some(([s, e]) => start < e && end > s)) continue;   // 与已认领的时间重叠 ⇒ 是它的碎片
            const s = String(m[0]).replace(/\s+/g, ' ').trim();
            if (!s) continue;
            spans.push([start, end]);
            if (!out.includes(s)) out.push(s);
        }
    }
    return out;
}

// 出包用的那一段文本（命中才有；逐字附来源，见 ③）
export function recallTextOf(chunks) {
    const list = Array.isArray(chunks) ? chunks : [];
    if (!list.length) return '';
    const lines = ['【世界书·按本回合上下文检索到的原文片段】（逐字摘自世界书；供你取用细节，**不是新发生的事**）'];
    // ★往事标记：把这一批片段里真读出来的时间原样列在台头（读到几个报几个，读不出就不报时间）
    const marks = [];
    for (const c of list) for (const t of timeMarksOf(c?.text)) if (!marks.includes(t)) marks.push(t);
    lines.push(marks.length
        ? `〔时间：下列片段出自 ${marks.join(' / ')} 的记录，位于本回合位序之前（早于本轮）——是**往事**，不是正在发生的事；它们后来的后果由本回合的盘算与事件承载，不要把它们当作本回合的新事件重写一遍。〕`
        : '〔位序：下列片段均位于本回合之前——是**往事**，不是正在发生的事；不要把它们当作本回合的新事件重写一遍。〕');
    list.forEach((c, i) => lines.push(`〔${i + 1}〕出自 ${c.source || '未载来源'}\n${c.text}`));
    return lines.join('\n');
}

/**
 * 把检索结果记到账上的"这一轮检索了什么"（③ 自证面：面板/控制台能如实上报，不谎报成"检索过了"）。
 * ★只记读数与来源，不记正文（正文进包即用即弃——账本不该囤书的副本；硬规矩"账房+史官"）。
 */
export function noteRecall(ssot, res) {
    if (!ssot?.meta) return res;
    if (!res) { delete ssot.meta.recalled; return res; }
    ssot.meta.recalled = {
        tick: ssot.meta.tick ?? 0,
        ok: !!res.ok,
        chunks: (res.chunks || []).length,
        sources: (res.chunks || []).map((c) => c.source).filter(Boolean),
        queryChars: res.queryChars || 0,
        reason: res.reason || null,
    };
    return res;
}
