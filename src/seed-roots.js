// story-world-v2/src/seed-roots.js
// ★★leg40：**从世界源起根**——把书里"正在发生的事"提取成账上的**线头事件**。
//
// 为什么需要它（本棒实测的诊断链）：
//   · 59 轮真账里，**第 25 轮之前只有 1 条事件**（`ev_1_1`），其余 64 条全部由聊天长出 ⇒ **世界的"根"来自聊天，不是世界源**。
//   · 世界源被抽取成了两样：**静态设定**（16 档力量谱系/7 条法则/2 条史略 —— 不进包）与**名册 751 条**（每条只有 name+kind）。
//     实测：**751 条里被事件点过名的 = 0** ⇒ 名册只到"谁"，**没有"谁正在办什么"** ⇒ 世界源里那些"事"（遗迹试炼大开、
//     龙脉受损纤维化、镇压魔渊留下的东西…）**一条都没变成过账上的事**。
//   · 于是模型每轮可引用的节点只有那场大乱 ⇒ 它只能在那条河里开新口子（59 轮起过 9 条线头，**0 条被接续**）。
//
// 三步走里的**第一步（起根）**，另两步已在本棒落地：
//   ① **起根**（本模块）：把世界源里真写着的"正在发生的事"提取成线头事件（带地点、当事人、以及书里那句话）——**只提取不发明**。
//   ② **接续**（已落：`pack.js` 的 `openRoots`/`threads` 两栏 + 提示词第 14 条）：线头分捆递到眼前 + "每条各写一步"。
//      实测：起点线头接续 1/13 → 4/13；**一轮并推 3 条线**（24 条次点名里真被推 15 次 = 62.5%）。
//   ③ 补根：由调用方按"线头不够了"再触发一次本模块（`shouldSeedRoots` 给出判据）。
//
// 纪律（与 `seedBookEntities` 同一条路）：
//   · **引擎不发明事实**：条目、地点、当事人全部取自书里原文或**账上已存在的实体名**；对不上的**丢**，不猜、不补。
//   · **幂等**：`meta.seedRoots` 记指纹 + 已种 id；同一本书只种一次（重复调用直接返回 `{ skipped: true }`，零调用）。
//   · **失败零阻塞**：调用方拿到 `{ ok:false }` 就照常跑世界（与检索注入同一条规矩）。
//   · **不碰世界进度**：只往 `events` 追加事件 + 写 `meta.seedRoots`；不写 tick/盘算/编年/权重。
import { normalizePosition } from './position.js';

export const SEED_ROOTS_TOP = 6;        // 提案态（铁律 2）：一次种几条。真账缺的就是"几条各自有轴的线"
export const SEED_ROOTS_MAX = 8;        // 硬上限（模型多给也丢）
export const SEED_CHUNK_CHAR = 30000;   // 书文取样上限（与设定五件套的 CANON_SRC_CHAR 同量级；防超长书拖垮一次调用）
export const SEED_CANDIDATES_TOP = 60;  // 改进版：候选池上限（"还没上过台的人"名字；60 个名字 ≈ 300 token）

/**
 * 起根提示词（面向模型）——只问一件事：书里**正在发生的事**有哪些。
 * ★为什么口径写成"书里写着的"，而不是"你想点什么"：本模块**不创作**，它只是把书里已有的事搬上账本。
 *   （书名录抽取问的是"书里有哪些名号"，这里问的是"书里有哪些正在办的事"——同一族的两个问题。）
 *
 * ★★leg40 改进（用户拍板后加）：**带候选池**——把账上"还没上过台的人"（从没被事件点过名的实体名）
 *   一并递给模型，要求当事人**从这份名单里挑**。理由（本棒实测）：
 *     · 盲发书文 ⇒ 种出来的多是"力量体系/门派介绍"段的事（荒古武圣硬抗天劫、万魔之祖主持仪式…），
 *       形状对，但与"这个世界此刻谁还没动"无关；
 *     · 给了名单 ⇒ 种子自带"谁"，且**天生不与那场大乱的人重叠**（那批人早被点过名）——
 *       这正是"另起一条根"要的；而且**对得上就能落账**（对不上的名字仍会被 `applySeedRoots` 丢掉）。
 *   ★不传候选池时行为与旧版逐字一致（老调用方零扰动）。
 */
export function buildSeedRootsPrompt(sourceText, { candidates = [] } = {}) {
    const src = String(sourceText ?? '').slice(0, SEED_CHUNK_CHAR);
    const names = (Array.isArray(candidates) ? candidates : []).map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, SEED_CANDIDATES_TOP);
    const listBlock = names.length
        ? [
            '',
            '★**另外给你一份名单**：这些是这个世界里**还没有上过台**的人与势力（引擎按账本机械筛出来的）。',
            '如果书里写着他们**正在办什么事**，优先挑这些事——**当事人请尽量从这份名单里选**（名单里没有的，才用书里别处明述的名号）：',
            names.join('、'),
        ].join('\n')
        : '';
    return [
        '你在读一部小说的设定与正文。请只做一件事：**把其中"正在发生的事"挑出来**。',
        '',
        '什么叫"正在发生的事"（判据，按顺序过）：',
        '1. 它**有地点**：发生在书里某个说得出的地方（地名照抄书中原文）。',
        '2. 它**有当事人**：有一方或几方**有名有姓**的人在办它（门派/势力/人物名，照抄书中原文）。',
        '3. 它**还没了结**：书中写它是"正在进行／刚刚开始／悬而未决"的，不是已经写完结局的往事。',
        '4. 它**能往下走**：由它可以合理推出"接下来会怎样"——不是一句静态描述（如"此界分九州"），',
        '   也不是数值档位（如"T1 感气境"），更不是一段地理志。',
        '',
        '**不要发明**：每条都要能指回书里的原话。书里没写地点就不写地点；书里没写谁在办就不要编一个人出来。',
        '宁可少给（4 条扎实的，胜过 8 条含糊的）。',
        listBlock,
        '',
        '输出**只输出 JSON**（不要解释、不要 Markdown 围栏），形状如下：',
        '{',
        '  "roots": [',
        '    {',
        '      "title": "一句话说清这件事（20 字以内，用书里的说法）",',
        '      "position": "书里明述的地点（照抄原文；没写就空着）",',
        '      "parties": ["书里明述的当事人名（门派/势力/人物，1–3 个）"],',
        '      "quote": "书里那句话（照抄原文，60 字以内）",',
        '      "why": "一句话：为什么它算「正在发生」（可省）"',
        '    }',
        '  ]',
        '}',
        '',
        '—— 以下是书文 ——',
        src,
    ].join('\n');
}

/**
 * 净化（**机械判据，零语义判断**）：条数上限、字段类型、长度上限、去重、去掉指不回书里的项。
 * ★它**不判**"这条够不够好"（那是提示词的事，也是抽取者的事）——只判"形状是否可用"，
 *   与 `sanitizeCanon`/`sanitizeBookFields` 同一治法（净化坏项、如实上报，不静默）。
 */
export function sanitizeSeedRoots(raw, { max = SEED_ROOTS_MAX } = {}) {
    const warnings = [];
    const list = Array.isArray(raw?.roots) ? raw.roots : (Array.isArray(raw) ? raw : []);
    if (!list.length) return { roots: [], warnings: ['起根结果为空（无 roots 数组或数组为空）'] };
    const seen = new Set();
    const roots = [];
    for (const [i, r] of list.entries()) {
        if (!r || typeof r !== 'object') { warnings.push(`roots[${i}]: 非对象，丢`); continue; }
        const title = String(r.title ?? '').trim().slice(0, 40);
        if (!title) { warnings.push(`roots[${i}]: 缺 title，丢`); continue; }
        if (seen.has(title)) { warnings.push(`roots[${i}]: 与前面重复（"${title}"），丢`); continue; }
        const position = String(normalizePosition(r.position) ?? '').trim();
        const parties = (Array.isArray(r.parties) ? r.parties : [])
            .map((x) => String(x ?? '').trim())
            .filter(Boolean)
            .slice(0, 3);
        const quote = String(r.quote ?? '').trim().slice(0, 120);
        if (!quote) { warnings.push(`roots[${i}]: 没有书里原话（quote 空）⇒ 指不回书里，丢`); continue; }
        if (!parties.length) { warnings.push(`roots[${i}]: 没有当事人（parties 空）⇒ 没人办的事起不了根，丢`); continue; }
        seen.add(title);
        roots.push({ title, position, parties, quote, why: String(r.why ?? '').trim().slice(0, 80) });
        if (roots.length >= Math.min(max, SEED_ROOTS_MAX)) break;
    }
    return { roots, warnings };
}

/**
 * 落账（**幂等、只追加事件**）：把净化后的根写成账上的未决事件（= 线头）。
 * @param {object} ssot 世界账（就地改）
 * @param {object[]} roots `sanitizeSeedRoots` 的产物
 * @param {object} opts `{ fingerprint, at, tick }`
 * @returns {{ seeded:number, skippedParties:string[], ids:string[] }}
 */
export function applySeedRoots(ssot, roots, { fingerprint = '', at = '', tick = null } = {}) {
    const events = Array.isArray(ssot.events) ? ssot.events : (ssot.events = []);
    const byName = new Map();
    for (const e of ssot.entities || []) if (e?.name) byName.set(String(e.name), e.id);
    const taken = new Set(events.map((e) => e.id));
    const tickNow = Number.isFinite(tick) ? tick : (ssot.meta?.tick ?? 0);
    const skippedParties = [];
    const ids = [];
    for (const r of roots) {
        // 当事人必须是**账上真有**的实体（名字精确匹配）——对不上的丢，不新建（"宁缺勿造"）
        const ripples = [];
        for (const name of r.parties) {
            const id = byName.get(String(name));
            if (!id) { skippedParties.push(String(name)); continue; }
            if (id === ssot.context?.playerId) continue;      // 红线 1：玩家不当代言人
            if (!ripples.includes(id)) ripples.push(id);
        }
        if (!ripples.length) continue;                        // 一个当事人都对不上 ⇒ 这条根起不了（不猜）
        let n = 1;
        while (taken.has(`ev_seed_${n}`)) n += 1;
        const id = `ev_seed_${n}`;
        taken.add(id);
        ids.push(id);
        events.push({
            id,
            title: r.title,
            source: { type: 'seed' },                          // ★与 state/plot/ripple 并列的第四型：**世界源起的根**
            position: r.position || undefined,
            ripples,
            closed: false,
            seedFrom: { quote: r.quote, why: r.why || undefined, fingerprint, at, tick: tickNow },
        });
    }
    return { seeded: ids.length, skippedParties, ids };
}

/**
 * 该不该起根（机械判据，供编排层调用）：
 *   · 已经种过（`meta.seedRoots.fingerprint` 命中）⇒ 不种（幂等，零调用）。
 *   · 线头**够用**（现有 openRoots ≥ `minRoots`）⇒ 不种（补根只在"线头不够"时发生）。
 */
export function shouldSeedRoots(ssot, { fingerprint = '', minRoots = 3 } = {}) {
    const done = ssot?.meta?.seedRoots;
    if (done && done.fingerprint && done.fingerprint === fingerprint) return { seed: false, reason: '已种过（同一本书）' };
    const open = (ssot?.events || []).filter((e) => !e.closed);
    const evIds = new Set(open.map((e) => e.id));
    const agIds = new Set((ssot?.agendas || []).map((a) => a.id));
    const roots = open.filter((e) => !e.source?.ref || !(evIds.has(e.source.ref) || agIds.has(e.source.ref)));
    if (roots.length >= minRoots) return { seed: false, reason: `线头够用（${roots.length} ≥ ${minRoots}）` };
    return { seed: true, reason: `线头不足（${roots.length} < ${minRoots}）` };
}

/**
 * 一次完整的起根（抽取 + 净化 + 落账）——**失败零阻塞**：任何一步不成就原样返回，不抛给世界。
 * @param {object} args `{ ssot, sourceText, extract, fingerprint, at, fresh }`
 */
export async function seedRoots({ ssot, sourceText, extract, fingerprint = '', at = '', minRoots = 3, onProgress = null } = {}) {
    if (!ssot?.meta) return { ok: false, errors: ['无世界账（ssot.meta 缺失）'] };
    const gate = shouldSeedRoots(ssot, { fingerprint, minRoots });
    if (!gate.seed) return { ok: true, skipped: true, reason: gate.reason, seeded: 0 };
    if (typeof extract !== 'function') return { ok: false, errors: ['未提供抽取调用（extract 注入缺失）'] };
    const src = String(sourceText ?? '');
    if (!src.trim()) return { ok: false, errors: ['世界源正文为空（书上没有可读的字）'] };

    let raw;
    try {
        raw = await extract(buildSeedRootsPrompt(src));
    } catch (err) {
        return { ok: false, errors: [`起根调用失败：${err?.message || err}`] };
    }
    const parsed = typeof raw === 'string' ? safeJson(raw) : raw;
    if (!parsed) return { ok: false, errors: ['起根调用返回的不是合法 JSON'] };
    const clean = sanitizeSeedRoots(parsed);
    if (!clean.roots.length) return { ok: false, errors: ['起根结果净化后为空', ...clean.warnings] };
    const applied = applySeedRoots(ssot, clean.roots, { fingerprint, at, tick: ssot.meta?.tick });
    ssot.meta.seedRoots = {
        fingerprint, at, ids: applied.ids, dropped: clean.warnings.length,
        skippedParties: applied.skippedParties,
    };
    if (typeof onProgress === 'function') {
        onProgress({ step: 'seedRoots', got: clean.roots.length, seeded: applied.seeded, warnings: clean.warnings });
    }
    return { ok: true, seeded: applied.seeded, ids: applied.ids, warnings: clean.warnings, skippedParties: applied.skippedParties };
}

/** 把书文按行切成块（**与名册抽取的 `chunkRows` 同一治法**；起根与名册用同一把尺子）。 */
export function chunkBookText(text, maxChar = SEED_CHUNK_CHAR) {
    const rows = String(text ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
    const chunks = [];
    let cur = []; let len = 0;
    for (const r of rows) {
        const l = Array.from(r).length;
        if (cur.length && len + l > maxChar) { chunks.push(cur.join('\n')); cur = []; len = 0; }
        cur.push(r); len += l;
    }
    if (cur.length) chunks.push(cur.join('\n'));
    return chunks;
}

/**
 * ★leg40 改进版：**分块起根**——一本书按块各问一次，种子就能覆盖全书（而不是只覆盖前 3 万字）。
 * 为什么需要：`SEED_CHUNK_CHAR=30000` 只截开头，而真账那本书 **305,590 字符** ⇒ 老策略只看了 **10%**，
 *   种出来的都是开头"力量体系与人物介绍"段的事。名册抽取早就走"分块多调用"这条路（`ROSTER_CHUNK_CHAR=60000`），
 *   本函数把同一治法搬到起根上：**按同样的行分块，逐块问，逐块净化，最后一起落账**。
 * 纪律：**逐块失败只丢那一块**（不整批失败）；块内净化规则与单块完全一致（同一个 `sanitizeSeedRoots`）。
 * @returns `{ ok, seeded, ids, warnings, chunks: [{ index, chars, ok, got, error }], skippedParties }`
 */
export async function seedRootsChunked({
    ssot, chunks = [], extract, fingerprint = '', at = '', candidates = [], seedChunkChar = SEED_CHUNK_CHAR,
    maxPerChunk = Math.ceil(SEED_ROOTS_MAX / 2), onProgress = null, mergeExisting = true,
} = {}) {
    if (!ssot?.meta) return { ok: false, errors: ['无世界账（ssot.meta 缺失）'] };
    if (typeof extract !== 'function') return { ok: false, errors: ['未提供抽取调用（extract 注入缺失）'] };
    const list = (Array.isArray(chunks) ? chunks : []).map((c) => String(c ?? '')).filter((c) => c.trim());
    if (!list.length) return { ok: false, errors: ['书文为空（没有可分块的内容）'] };
    if (mergeExisting) {
        // ★只查**幂等**（同一本书不重种），**不查"线头够不够"**——
        //   "线头够用就不种"是**载入期自动补根**的判据；而本函数是**显式移植**（用户点了才跑），
        //   移植的全部意义正是"存量世界已有 13 条旧线头，也要把干净的根补进去"。
        //   ⇒ 传 `Infinity` 让"线头不足"那条分支永不为真（口径仍走同一个 shouldSeedRoots，不另立判据）。
        const gate = shouldSeedRoots(ssot, { fingerprint, minRoots: Number.POSITIVE_INFINITY });
        if (!gate.seed) return { ok: true, skipped: true, reason: gate.reason, seeded: 0, chunks: [] };
    }

    const allWarnings = [];
    const allSkipped = [];
    const seenTitles = new Set((ssot.events || []).map((e) => String(e.title || '')));
    const collected = [];
    const chunkLog = [];
    for (const [i, src] of list.entries()) {
        // ★**分块起根时不再二次截断**：块的大小由调用方（`seed-roots-migrate.js` 的 `--chunk-chars`）决定；
        //   `SEED_CHUNK_CHAR` 那道截断只属于**单发**路径（`buildSeedRootsPrompt` 的缺省保护）。
        //   （本装置第一版在这里把 60k 的块又截回 30k，等于白分了块。）
        const sliced = String(src);
        let roots = [];
        let err = null;
        try {
            const raw = await extract(buildSeedRootsPrompt(sliced, { candidates }));
            const parsed = typeof raw === 'string' ? safeJson(raw) : raw;
            if (!parsed) throw new Error('返回的不是合法 JSON');
            const clean = sanitizeSeedRoots(parsed, { max: maxPerChunk });
            roots = clean.roots.filter((r) => !seenTitles.has(r.title));
            allWarnings.push(...clean.warnings.map((w) => `块${i + 1}: ${w}`));
            for (const r of roots) seenTitles.add(r.title);
        } catch (e) {
            err = String(e?.message || e);
        }
        chunkLog.push({ index: i + 1, chars: Array.from(sliced).length, ok: !err, got: roots.length, error: err });
        if (typeof onProgress === 'function') onProgress({ step: 'seedRoots', index: i + 1, count: list.length, chars: sliced.length, ok: !err, got: roots.length, error: err });
        collected.push(...roots);
    }
    if (!collected.length) {
        return { ok: false, errors: ['全部块都没能起出可用的根', ...chunkLog.filter((c) => c.error).map((c) => `块${c.index}: ${c.error}`)], chunks: chunkLog };
    }
    const applied = applySeedRoots(ssot, collected.slice(0, SEED_ROOTS_MAX), { fingerprint, at, tick: ssot.meta?.tick });
    allSkipped.push(...applied.skippedParties);
    // ★合并（不是覆盖）：老账可能已有指纹（例如先按 30k 种过一次）⇒ 把两次的 id 并起来，
    //   否则"重种会把上一次的记录从账上抹掉"（那是假账——事件还在，指纹却说没有）。
    const prev = ssot.meta.seedRoots || {};
    const prevIds = Array.isArray(prev.ids) ? prev.ids : [];
    ssot.meta.seedRoots = {
        fingerprint, at, ids: [...new Set([...prevIds, ...applied.ids])],
        chunks: chunkLog.length, dropped: allWarnings.length, skippedParties: allSkipped,
    };
    return { ok: true, seeded: applied.seeded, ids: applied.ids, warnings: allWarnings, skippedParties: allSkipped, chunks: chunkLog };
}

/** JSON 容错解析（模型偶尔包一层围栏/解说）——只做"取出第一个 JSON 对象"，不猜内容。 */
function safeJson(text) {
    const s = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(s); } catch (_) { /* 继续找 */ }
    const i = s.indexOf('{');
    const j = s.lastIndexOf('}');
    if (i >= 0 && j > i) { try { return JSON.parse(s.slice(i, j + 1)); } catch (_) { return null; } }
    return null;
}
