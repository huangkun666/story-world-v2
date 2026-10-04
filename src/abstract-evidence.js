// story-world-v2/src/abstract-evidence.js
// Task 3（抽取确认与完整入账）：**抽取依据（允许来源 + 原话）的唯一一处簿记**。
//
// 依据（已批准，不再重复批准）：
//   · docs/superpowers/specs/2026-10-03-abstraction-sources-design.md §6.1/§6.2/§6.3
//   · task-3 Codex 决议：证据与拒收明细走**既有抽取诊断**（`src/diagnostics.js` +
//     `web/diagnostic-transport.js` 的 `debugDetails` 门控与脱敏），**不落世界账、不给关系边挂出处章**；
//     缓存另加**只有缓存才有的** `sourceDigest` + 严格策略标记（见 `src/fp-hash.js` 的 `set` 元数据）。
//
// 三条不许越界的口径（写在这里，免得下游各解释一遍）：
//   ① **字符串存在只能证明引用真实，不能证明解释正确**（设计 §6.1 原话）。本模块只做机械核对：
//      编号在不在本次用料里、原话能不能在所引来源里逐字找到、原话在不在**本次这一块**里。
//   ② **不给新模型调用**：来源清单（编号 → 题名）搭在既有提示词里，一次调用问完（设计 §6.1）。
//   ③ **不做语义判断**：不查词表、不设阈值、不判"这个类别词有没有出现在中文里"——类别是模型的语义主张，
//      程序只核它的出处（见 Codex 决议："do not require the English enum word to occur literally in Chinese prose"）。
import { bookFingerprint } from './fp-hash.js';

/** 空白不敏感的存在性：先逐字找；对不上再忽略空白找一次（换行/空格不应否掉一句真原话）。 */
function containsLoose(haystack, needle) {
    const h = String(haystack ?? '');
    const n = String(needle ?? '');
    if (!n) return false;
    if (h.includes(n)) return true;
    const squeeze = (s) => s.replace(/\s+/g, '');
    const hs = squeeze(h);
    const ns = squeeze(n);
    return Boolean(ns) && hs.includes(ns);
}

/** 一块"本次真正交出去的材料"的正文（来源条目原文 / 角色卡字段 / 作者合法声明的题名行）。 */
export function blockTextOf(block) {
    return String(block?.text ?? '');
}

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// ★★★Task 3 复查（task-3-review.md ③④）：**本次调用真正展示的那一段**才是允许来源。
//
// 病（复审逐字复现，见 `task-3-evidence-boundary-red.json`）：旧法只做两件机械检查——
//   ①编号在**全局冻结表**里；②原话在**这一块文本**里逐字找得到。两块条目都写着
//   `陆青行走江湖。` 时，孩子只看到 entry-a，却可以引 entry-b 的编号：因为原话在两块里**逐字相同**，
//   这两条检查**都过**。⇒ 引用的"来源身份"与"本次材料"之间没有绑定。
//
// 治法是**把来源身份绑到本次展示的字符区间上**（不是再对一遍字符串）：
//   · 发射端交出的块按顺序用 `\n` 相接 ⇒ 每块在材料里的区间是确定的（下面 `blockSpansOf`）；
//   · 抽取分块/拆半是**行级**的（`chunkRows` 与 `text.split('\n')`）⇒ 每次调用手里有一组行号
//     （下面 `materialRowsOf` 给出"行 → 材料字符区间"）；
//   · 两者的交集 = **这一块这一次真正被展示的片段**（`scopeForRows`）。
//     `verifyQuote` 只认这个片段：编号不在片段里 ⇒ 拒收；原话不在片段里 ⇒ 拒收。
//   代价如实说：拆半时一句话正好跨在切点上 ⇒ 两边都核不过（宁可漏，不许借没见过的材料）。
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝

/** 把一份逐字材料切成"行 + 该行在材料里的字符区间"（trim 后非空；**与抽取分块同一把尺子**）。 */
export function materialRowsOf(text) {
    const s = String(text ?? '');
    const out = [];
    let pos = 0;
    for (const rawLine of s.split('\n')) {
        const body = rawLine.trim();
        if (body) {
            const lead = rawLine.length - rawLine.trimStart().length;
            out.push({ text: body, start: pos + lead, end: pos + lead + body.length });
        }
        pos += rawLine.length + 1;
    }
    return out;
}

/** 每块在材料里的字符区间（块按给定顺序用 `\n` 相接——与 `freezeAllowedSources().text` 同构）。 */
function blockSpansOf(frozen, text) {
    const src = String(text ?? '');
    const spans = [];
    if (src === frozen.text) {
        let cursor = 0;
        for (const b of frozen.list) {
            spans.push({ ref: b.ref, start: cursor, end: cursor + b.text.length });
            cursor += b.text.length + 1;
        }
        return spans;
    }
    // 材料与冻结表逐字不同（调用方给文本的方式不一样）：**按顺序**往下找（不是"任意首次匹配"——
    // 游标只前进，重复正文也不会被反复匹配到同一处）。找不到 ⇒ 该块本次不算展示。
    let cursor = 0;
    for (const b of frozen.list) {
        const at = b.text ? src.indexOf(b.text, cursor) : -1;
        if (at < 0) { spans.push({ ref: b.ref, start: -1, end: -1 }); continue; }
        spans.push({ ref: b.ref, start: at, end: at + b.text.length });
        cursor = at + b.text.length;
    }
    return spans;
}

/** 由"块 × 行"交集装配作用域对象（`fragmentOf(ref)` 是本次真正展示的那段文本；不在本次 ⇒ null）。 */
function scopeFromParts(frozen, parts) {
    const entries = [];
    for (const p of parts) {
        const block = frozen.byRef.get(p.ref);
        if (!block || !p.fragment) continue;
        entries.push({ ref: block.ref, id: block.id, title: block.title, titleOnly: block.titleOnly, fragment: p.fragment });
    }
    const byRef = new Map(entries.map((e) => [e.ref, e]));
    return {
        list: entries,
        byRef,
        has: (ref) => byRef.has(String(ref ?? '').trim()),
        fragmentOf: (ref) => {
            const hit = byRef.get(String(ref ?? '').trim());
            return hit ? hit.fragment : null;
        },
    };
}

const intersectScopes = (frozen, scopes) => {
    const live = scopes.filter(Boolean);
    if (!live.length) return null;
    if (live.length === 1) return live[0];
    const parts = [];
    for (const e of live[0].list) {
        const others = live.slice(1).map((s) => s.fragmentOf(e.ref));
        if (others.some((f) => f === null)) continue;                 // 有一处没展示它 ⇒ 本次不认
        const same = others.every((f) => f === e.fragment);
        // 片段内容不一致（重复正文落在不同位置）⇒ 交不出更严的界 ⇒ 空片段（该来源本次拒收）
        parts.push({ ref: e.ref, fragment: same ? e.fragment : '' });
    }
    return scopeFromParts(frozen, parts);
};

/**
 * 本次调用真正展示的行 → 允许来源作用域（**生产路径的连接点**）。
 * @param {object} frozen `freezeAllowedSources` 的产物
 * @param {{text?:string, rows?:Array, indexes?:Array<number>}} args
 *   `text` = 这份材料全文（块区间在它里面定位）；`rows` = `materialRowsOf(text)`；`indexes` = 本次展示的行号
 * @returns {null|{list:Array,byRef:Map,has:Function,fragmentOf:Function}}
 */
export function scopeForRows(frozen, { text = '', rows = null, indexes = [] } = {}) {
    if (!frozen || !Array.isArray(frozen.list) || !frozen.list.length) return null;
    const rowList = Array.isArray(rows) ? rows : materialRowsOf(text);
    const picked = (Array.isArray(indexes) ? indexes : []).filter((i) => Number.isInteger(i) && rowList[i]).slice().sort((a, b) => a - b);
    if (!picked.length) return null;
    const spans = blockSpansOf(frozen, text);
    const spanByRef = new Map(spans.map((s) => [s.ref, s]));
    const parts = [];
    for (const b of frozen.list) {
        const span = spanByRef.get(b.ref);
        if (!span || span.start < 0) continue;
        const lines = [];
        for (const i of picked) {
            const r = rowList[i];
            if (r.start < span.end && r.end > span.start) lines.push(r.text);
        }
        if (lines.length) parts.push({ ref: b.ref, fragment: lines.join('\n') });
    }
    return scopeFromParts(frozen, parts);
}

/** 由"本次交出去的那段文本"反推作用域（`spanText` 兼容口径；重复正文 ⇒ 取各解的交集，更严）。 */
export function scopeForText(frozen, spanText) {
    if (!frozen || !Array.isArray(frozen.list) || !frozen.list.length) return null;
    const span = String(spanText ?? '');
    if (!span) return null;
    const allRows = materialRowsOf(frozen.text);
    const spanRows = materialRowsOf(span);
    // ① 整段（行级）对齐：找出**所有**能装下它的行窗口；多个解走交集（重复正文不许"首次匹配"）。
    const scopes = [];
    for (let i = 0; spanRows.length && i + spanRows.length <= allRows.length; i += 1) {
        let ok = true;
        for (let j = 0; j < spanRows.length; j += 1) {
            if (allRows[i + j].text !== spanRows[j].text) { ok = false; break; }
        }
        if (!ok) continue;
        const indexes = [];
        for (let j = 0; j < spanRows.length; j += 1) indexes.push(i + j);
        // 行号要落回**全材料**的行坐标系（`rows` 给全量，`indexes` 给本次）
        scopes.push(scopeForRows(frozen, { text: frozen.text, rows: allRows, indexes }));
    }
    if (scopes.length) return intersectScopes(frozen, scopes);
    // ② 行级对不上（材料被裁过头/带空白差异/只给了被裁的一小段）⇒ 按**字符区间**找。
    //   ★★★Task 3 复查第二轮（task-3-fixes-review.md ⑧）：旧法在这里 `indexOf(span)` 取**首次匹配**，
    //     再把"与它重叠的**整行**"当作展示片段返回 ⇒ 展示的是 `甲`，核的却是 `甲。乙有秘密。` 整行，
    //     于是 `{spanText:'甲', ev:{s:'S1', q:'乙有秘密。'}}` 被判 ok（没见过的字节被当成"已展示"）。
    //   治法（两条都是机械判据）：
    //     · **片段 = 字符区间的精确交集**（块区间 ∩ 展示区间），不再提升到整行——
    //       看到的就核这一段，没看到的字节永远不进片段；
    //     · **找全部出现位置**（不是首次匹配），每个解各给一个作用域，最后**保守取交集**：
    //       同一段文字出现在两处不同来源 ⇒ 交不出共同片段 ⇒ 该来源本次一律拒收（宁可漏，不许借）。
    const spans = blockSpansOf(frozen, frozen.text);
    const at = [];
    for (let i = frozen.text.indexOf(span); i >= 0; i = frozen.text.indexOf(span, i + 1)) at.push(i);
    const exact = [];
    for (const start of at) {
        const end = start + span.length;
        const parts = [];
        for (const s of spans) {
            if (s.start < 0) continue;
            const from = Math.max(s.start, start);
            const to = Math.min(s.end, end);
            if (to <= from) continue;
            parts.push({ ref: s.ref, fragment: frozen.text.slice(from, to) });
        }
        if (parts.length) exact.push(scopeFromParts(frozen, parts));
    }
    return exact.length ? intersectScopes(frozen, exact) : null;
}

/**
 * 冻结本次**允许来源**（发射端自己产出的最终接收块，见 `src/init-source.js` 的 `allowedBlocks`）。
 *
 * @param {Array<{sourceId?:string,id?:string,text:string,title?:string,titleOnly?:boolean,kind?:string,field?:string|null}>} blocks
 * @param {{declared?: Array<{name:string,sourceId?:string}>}} [opts]
 * @returns {null|{list:Array,byRef:Map,byId:Map,text:string,digest:string,declared:Map}}
 *   块按给定顺序编号 `S1..Sn`（提示词里的"来源清单"就是它）；`byId` 另认真实来源 ID（测试与旧调用方友好）。
 */
export function freezeAllowedSources(blocks = [], { declared = [] } = {}) {
    const list = [];
    for (const b of (Array.isArray(blocks) ? blocks : [])) {
        if (!b || typeof b !== 'object') continue;
        const id = String(b.sourceId ?? b.id ?? '').trim();
        const text = String(b.text ?? '');
        if (!id || !text) continue;
        const ref = `S${list.length + 1}`;
        list.push({
            ref, id, text,
            title: String(b.title ?? '').trim(),
            titleOnly: b.titleOnly === true,
            kind: String(b.kind ?? 'world-entry'),
            field: b.field ?? null,
        });
    }
    if (!list.length) return null;
    const byRef = new Map(list.map((b) => [b.ref, b]));
    const byId = new Map();
    for (const b of list) if (!byId.has(b.id)) byId.set(b.id, b);
    const declaredMap = new Map();
    for (const d of (Array.isArray(declared) ? declared : [])) {
        const nm = String(d?.name ?? '').trim();
        if (nm) declaredMap.set(nm, String(d?.sourceId ?? '').trim());
    }
    return {
        list, byRef, byId, declared: declaredMap,
        text: list.map((b) => b.text).join('\n'),
        digest: bookFingerprint(JSON.stringify(list.map((b) => [b.id, b.text])), []),
    };
}

/**
 * 提示词里那份"来源清单"（编号 → 题名）+ 引用纪律；没有允许来源 ⇒ 空串（legacy 提示词逐字不变）。
 *
 * ★★★Task 3 复查（task-3-review.md ④）：**列全本次真正展示的来源，不设条数上限**。
 *   旧法默认 `max = 400` 并在尾部写"另有 N 条来源未列出，不得引用"——513 条已接受来源的第 513 条
 *   因此**永远无法被合法引用**（模型没看见它，引擎却认它的编号）。⇒ 删掉那个数字：清单 = 本次展示块。
 *   `scope` 给了就只列它里面的（本次这一块真正交出去的那几条）；没给 = 列全部（单发全书那一路）。
 */
export function evidenceDictionary(frozen, { scope = null, descriptiveFields = false } = {}) {
    if (!frozen || !Array.isArray(frozen.list) || !frozen.list.length) return '';
    const list = scope ? frozen.list.filter((b) => scope.has(b.ref)) : frozen.list;
    const lines = ['———— 来源清单（引用出处时，`s` 只许用这里的编号）————'];
    if (!list.length) lines.push('（本次这一块没有可用来源，不要引用任何编号）');
    for (const b of list) {
        lines.push(`${b.ref} = ${b.title || '(无题名)'}${b.titleOnly ? '（题名候选）' : ''}`);
    }
    lines.push(descriptiveFields
        ? '引用纪律：实体身份、关系与全局设定要带 `ev:{s:"<编号>", q:"<该来源里逐字照抄的原文>"}`；描述属性保留模型抽取内容，不要求匹配同一句引用。'
        : '引用纪律：每一条语义主张都要带 `ev:{s:"<编号>", q:"<该来源里逐字照抄的原文>"}`；');
    lines.push('  `s` 必须来自本清单，`q` 必须在**本次这一块**所引来源的正文里逐字找得到（引擎逐字核；核不过的主张一律不收）。');
    return lines.join('\n');
}

/**
 * 核对一条"带出处的语义主张"。
 * @param {object|null} frozen `freezeAllowedSources` 的产物（null = 本次没有允许来源 ⇒ legacy，调用方另判）
 * @param {{ev:*, scope?:object|null, spanText?:string, cls?:string, subject?:string}} args
 *   `scope` = **本次这一块真正展示了哪几块的哪一段**（`scopeForRows` / `scopeForText` 的产物）。
 *     给了它就**只认它**：编号不在里面 ⇒ 拒收；原话不在它给的片段里 ⇒ 拒收。
 *   `spanText` = 兼容入口（没给 `scope` 时由它反推作用域；反推不出来才退回旧的"块内存在性"口径）。
 * @returns {{ok:boolean, why:string|null, ref:string|null, id:string|null, block:object|null, quote:string|null, fragment:string|null}}
 */
export function verifyQuote(frozen, { ev = null, scope = null, spanText = null, cls = 'claim', subject = '' } = {}) {
    const fail = (why) => ({ ok: false, why, ref: null, id: null, block: null, quote: null, fragment: null });
    if (!frozen) return fail('本次没有允许来源（legacy）');
    const s = String(ev?.s ?? '').trim();
    const q = String(ev?.q ?? '').trim();
    if (!s) return fail('缺来源编号（主张没带 ev.s）');
    if (!q) return fail('缺原文依据（主张没带 ev.q）');
    const block = frozen.byRef.get(s) || frozen.byId.get(s) || null;
    if (!block) return fail(`来源不在本次用料（${s}）`);
    // 题名候选行（`【from】name` 合成行）只能证明"作者把这个名字当过名字"，
    // 不能单独确认类别/属性/归属等别的语义主张（Codex 决议：a generated controller name-only line
    // cannot confirm unrelated attributes or kinds by itself）。
    if (block.titleOnly && !['name', 'declared'].includes(cls)) {
        return fail(`题名候选不能单独确认该主张（${s}）`);
    }
    const spanGiven = spanText !== null && spanText !== undefined;
    const scoped = scope || (spanGiven ? scopeForText(frozen, spanText) : null);
    if (scoped) {
        const fragment = scoped.fragmentOf(block.ref);
        if (fragment === null || fragment === undefined) {
            return fail(`所引来源不在本次展示的材料内（${s}）：同一句话在别的条目里出现不算`);
        }
        if (!containsLoose(fragment, q)) return fail(`原话对不上（${s}）：不在本次展示的片段内`);
        return { ok: true, why: null, ref: block.ref, id: block.id, block, quote: q, fragment };
    }
    // ★★★Task 3 复查第二轮（task-3-fixes-review.md ⑧）：**给了"本次材料"却对不上允许来源 ⇒ 拒收**。
    //   旧法在这里静默退回"块内存在性"（只要原话在这块的全文里就放行）——那等于把"作用域没算出来"
    //   当成"按未定作用域核对"，正是"missing scope automatic legacy"。算不出作用域只有两种可能：
    //   材料与允许来源不一致（调用方给的文本不是本次展示的那份），或者对齐有歧义——两种都不该放行。
    if (spanGiven) return fail('本次材料无法与允许来源对齐（作用域未定 ⇒ 不按块内存在性放行）');
    if (!containsLoose(block.text, q)) return fail(`原话对不上（${s}）`);
    return { ok: true, why: null, ref: block.ref, id: block.id, block, quote: q, fragment: String(block.text) };
}

/** 纯字符串存在（设定面用）：这条原话在不在**本次材料**里。 */
export function presenceIn(text, value) {
    return containsLoose(text, String(value ?? '').trim());
}

/** 一条抽取依据记录（进诊断面；**不进世界账**）。 */
export function evidenceRecord({ cls = 'claim', subject = '', action = 'drop', why = null, ref = null, quote = null, extra = null } = {}) {
    const rec = { class: cls, subject: String(subject ?? ''), action, why: why ?? null, ref: ref ?? null, quote: quote ?? null };
    if (extra && typeof extra === 'object') Object.assign(rec, extra);
    return rec;
}

/** 计数摘要（可以进返回值/缓存信封；**不含原话与明细**——那些只在受门控的诊断里）。 */
export function summarizeEvidence(records = []) {
    const byReason = {};
    const byClass = {};
    let kept = 0;
    let dropped = 0;
    let pending = 0;
    for (const r of (Array.isArray(records) ? records : [])) {
        const cls = String(r?.class ?? 'claim');
        byClass[cls] = (byClass[cls] || 0) + 1;
        if (r?.action === 'keep') kept += 1;
        else if (r?.action === 'pending') pending += 1;
        else if (r?.action === 'drop') {
            dropped += 1;
            const why = String(r?.why ?? '未知原因');
            byReason[why] = (byReason[why] || 0) + 1;
        }
    }
    return { raw: records.length, kept, dropped, pending, byReason, byClass };
}

/** 一行中文摘要（`details` 为真才带明细片段——与既有调试开关同一道门）。 */
export function formatEvidenceLine(summary, { details = false, max = 6 } = {}) {
    if (!summary || !summary.raw) return '抽取依据：本次没有需要记录的语义主张';
    const parts = [`抽取依据：主张 ${summary.raw} 条（收下 ${summary.kept} / 拒收 ${summary.dropped} / 待核对 ${summary.pending}）`];
    const reasons = Object.entries(summary.byReason || {});
    if (reasons.length) parts.push(`原因：${reasons.slice(0, max).map(([w, n]) => `${w}×${n}`).join('；')}`);
    if (details && Array.isArray(summary.samples) && summary.samples.length) {
        parts.push(`明细：${summary.samples.slice(0, max).join('；')}`);
    }
    return parts.join('，');
}
