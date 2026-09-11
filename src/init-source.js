// story-world-v2/src/init-source.js
// 第十八棒：初始化设定源合订（编排层助手 · 纯函数 · 零引擎状态）
// 背景：K38 的「换源+worldBook 存储」机制被用户（正确地）判死刑——本文件不再有任何
// worldBook 概念：设定源只有两条自动路 = 世界信息/卡内置世界书条目 + 角色卡四件套。
//   - 世界书：**完整条目摄取，全量不截断**（v1 adapter.js L19 教训；禁用标记跳过；按内容去重）；
//   - 卡件四件套：按 v1 spend() 同款逐字段预算（散文介绍，非世界书）。
// 分层归属：编排层（只组文本，不落账不结算）。防御上限提案态（铁律 2，随报批）。

export const INIT_PIECE_CAPS = {          // 卡四件套各自上限（字符 · 提案态 · v1 spend 同款）
    description: 1200,
    scenario: 800,
    personality: 800,
    first_mes: 400,
};

export const INIT_SOURCE_HARD_CEILING = 500000; // 防御性总上限（字符 · 提案态）：世界书全量，仅超现实量级才拦

// 码点级截断（CJK 不破字；仅用于卡件 spend）
function clip(str, n) {
    const a = Array.from(String(str ?? ''));
    return a.length <= n ? a.join('') : a.slice(0, n).join('');
}

export function normalizeEntryKey(e) {
    // ★第二十五棒 e（五）：主键取值必须**处理数组**——ST 形状里 `e.key` 常是数组（`["九宸玄陆","世界总纲",…]`），
    //   旧法 `String(e.key ?? …)` 会把它变成一长串逗号连接 ⇒ 同一本书的"世界书侧"与"卡内置侧"行**不可能相同**
    //   ⇒ 去重**完全失效**（实测交集 0）⇒ 同一本书被送进抽取两遍（424 条 / 499,526 字符，顶到 50 万防御上限）。
    const k = e?.key;
    if (typeof k === 'string' && k.trim()) return k.trim();
    if (Array.isArray(k) && k.length) return String(k[0] ?? '').trim();
    if (Array.isArray(e?.keys) && e.keys.length) return String(e.keys[0] ?? '').trim();
    if (typeof e?.keys === 'string' && e.keys.trim()) return e.keys.trim();
    return String(e?.uid ?? e?.name ?? e?.comment ?? '');
}

function normalizeEntry(e) {
    if (!e || typeof e !== 'object') return null;
    const key = normalizeEntryKey(e);
    const content = String(e.content ?? '').trim();
    if (!content) return null;
    return `【${key}】${content}`;
}

// 世界书条目两路来源：① ST 合订 worldInfo（含卡内置书混入条目）② 卡内嵌 character_book 原始条目
// （v1 双路径 ch.data?.character_book || ch.character_book，同款）。禁用标记跳过；全量不截断；按内容去重。
function collectEntries(worldInfoEntries, character) {
    const out = [];
    const seen = new Set();
    let rawTotal = 0;
    let disabled = 0;
    const raw = [
        ...(Array.isArray(worldInfoEntries) ? worldInfoEntries : []),
        ...(character?.character_book?.entries || character?.data?.character_book?.entries || []),
    ];
    for (const e of raw) {
        if (!e || typeof e !== 'object') continue;
        if (String(e.content ?? '').trim()) rawTotal += 1;
        if (e?.disable === true || e?.enabled === false) { disabled += 1; continue; } // v1 同款：尊重酒馆禁用标记
        const line = normalizeEntry(e);
        if (!line) continue;
        if (seen.has(line)) continue;
        seen.add(line);
        out.push(line);
    }
    return { out, rawTotal, disabled };
}

/**
 * composeInitSource：合成初始化设定文本（剪枝序：世界书条目[全量] > 描述 > 场景 > 人格 > 开场白）
 * @param {object} opts
 * @param {object} [opts.character]  ST 角色卡对象（name/description/personality/scenario/first_mes/character_book）
 * @param {Array}  [opts.worldInfoEntries] ST 世界信息条目数组
 * @param {number} [opts.budget]     防御性总上限（默认 INIT_SOURCE_HARD_CEILING；测试可注入小值验证机制）
 * @returns {{ok:boolean, text?:string, label?:string, usedChars?:number, truncated?:boolean,
 *            worldName?:string, entryCount?:number, pieceCount?:number, reason?:string}}
 */
export function composeInitSource({ character = null, worldInfoEntries = [], budget = INIT_SOURCE_HARD_CEILING } = {}) {
    const worldName = typeof character?.name === 'string' && character.name.trim() ? character.name.trim() : '';

    const parts = [];
    const { out: entryLines, rawTotal, disabled } = collectEntries(worldInfoEntries, character);
    for (const line of entryLines) parts.push(line); // 世界书条目：全量，优先
    let pieceCount = 0;
    for (const key of ['description', 'scenario', 'personality', 'first_mes']) {
        const raw = character?.[key];
        if (typeof raw !== 'string' || !raw.trim()) continue;
        parts.push(clip(raw.trim(), INIT_PIECE_CAPS[key])); // v1 spend 同款：只裁卡件散文
        pieceCount += 1;
    }

    const ceiling = Number(budget) > 0 ? Number(budget) : INIT_SOURCE_HARD_CEILING;
    const used = [];
    let total = 0;
    const allLen = parts.reduce((n, p) => n + Array.from(p).length, 0);
    for (const p of parts) {
        const len = Array.from(p).length;
        if (total + len > ceiling) break; // 仅防御性上限触发（现实量级不触发）
        used.push(p);
        total += len;
    }
    if (!used.length) {
        const pieces = ['description', 'scenario', 'personality', 'first_mes'].filter((k) => typeof character?.[k] === 'string' && character[k].trim());
        const bits = [];
        if (!character) bits.push('未读到角色卡（非角色聊天/群聊需另配）');
        else if (!pieces.length) bits.push('角色卡四件套全空');
        if (rawTotal === 0) bits.push('世界信息/内置书为空');
        else if (disabled === rawTotal) bits.push('世界书条目全部标记禁用');
        return { ok: false, reason: bits.length ? bits.join('；') : '没有可用设定（详见浏览器控制台诊断）' };
    }

    return {
        ok: true,
        text: used.join('\n'),
        label: '自动合订（角色卡 + 世界信息/内置世界书）',
        usedChars: total,
        truncated: total < allLen,
        worldName,
        entryCount: parts.length - pieceCount,
        pieceCount,
    };
}