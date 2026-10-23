// story-world-v2/web/world-body-store.js
// ★本模块只管一件事：**同一份世界正文，库里只留一份**（内容寻址）。
//
// 为什么需要它（真账实测，2026-10-16）：
//   一份世界正文 ≈ 230 KB。当前真账里 `snapshots.world` 61 行、`operations.proposal` 18 行、
//   推演检查点里的 `prepared.world` 16 行 —— 一共 95 份 ≈ 22 MB，而**真正不同的世界只有 11 种**。
//   重复来自"同一步被存好几次"（重复恢复、导入历史、候选与提交各存一份），不是世界真变了。
//
// 口径（三条，都能机械核）：
//   ① **身份 = 内容**：`digest = sha256Hex(canonical(正文))`，正文是**剥掉玩家参数**的那一份
//      （剥法见 `src/param-ownership.js`；玩家参数单独存，见 `userParams` 表）。
//   ② **行只记引用**：`{ body_digest, body_bytes, round, at }`。`round`／`at` 直接落在引用上，
//      所以即使正文表被清理，快照页照样能显示"第几轮、什么时候"。
//   ③ **绝不猜**：引用在正文表里找不到 ⇒ 明确报错（`missing`），**不许**返回空对象、
//      不许拿别的正文顶替、不许静默降级成"大概能恢复"。
//
// 本模块是**纯逻辑**（零 Dexie、零 DOM、零 Node 内建）⇒ 判据能在 Node 里直接跑。
// 落库由 `web/world-journal.js` 接线（同一治法：纯函数住一处，存储适配住一处）。

import { sha256Hex } from '../src/browser-capabilities.js';

/** 规范化 JSON（与 `world-journal.js` 既有 `canonical` 同一口径：对象键排序，其余原样）。 */
export function canonicalWorld(value) {
    return JSON.stringify(value, (_, item) => (item && typeof item === 'object' && !Array.isArray(item))
        ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
        : item);
}

/** 一份正文的身份。空值一律拒绝（不许把"没有正文"算成一种正文）。 */
export function bodyDigestOf(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('世界正文必须是普通对象');
    return sha256Hex(canonicalWorld(body));
}

/** 这一份正文占多少字节（给快照页与迁移报告报数用）。 */
export function bodyBytesOf(body) {
    return canonicalWorld(body).length;
}

/**
 * 生成一条**引用**（要写进 `snapshots` / `savedSnapshots` / `operations` 的那几格）。
 * @param {object} body 剥掉玩家参数后的世界正文
 * @param {{round?:number|null, at?:string|null}} [meta] 直接落在引用上的展示信息
 */
export function bodyRefOf(body, { round = null, at = null } = {}) {
    return {
        body_digest: bodyDigestOf(body),
        body_bytes: bodyBytesOf(body),
        round: Number.isFinite(round) ? round : null,
        at: typeof at === 'string' && at ? at : null,
    };
}

/** 这一行是不是"按引用存"的（旧库／旧备份的行是内联正文，没有这一格）。 */
export function isRefRow(row) {
    return !!row && typeof row.body_digest === 'string' && row.body_digest.length > 0;
}

/** 一行里内联的正文（旧形状）；没有就是 `null`。 */
export function inlineBodyOf(row) {
    const body = row?.world;
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

/** 从若干行里收集所有被引用的摘要（导出时按这份清单取正文，避免整表搬运）。 */
export function referencedDigests(rows) {
    const out = new Set();
    for (const row of rows || []) if (isRefRow(row)) out.add(row.body_digest);
    return [...out];
}

/**
 * 按引用取正文。找不到就**明确失败**（纪律③），绝不返回空对象。
 * @param {Map<string,object>|{[k:string]:object}} table 摘要 ⇒ 正文
 * @param {object} row 带 `body_digest` 的行
 */
export function resolveBody(table, row) {
    const digest = row?.body_digest;
    if (typeof digest !== 'string' || !digest) throw new Error('这一行没有正文引用');
    const body = table instanceof Map ? table.get(digest) : table?.[digest];
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('世界正文引用缺失：' + digest);
    return body;
}

/**
 * 校验一份正文与它声明的摘要是否相符（迁移、导入、读取兼容三处共用）。
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
export function verifyBody(digest, body) {
    let actual;
    try { actual = bodyDigestOf(body); } catch (error) { return { ok: false, reason: String(error?.message ?? error) }; }
    if (actual !== digest) return { ok: false, reason: `世界正文与摘要不符（声明 ${String(digest).slice(0, 12)}…，实算 ${actual.slice(0, 12)}…）` };
    return { ok: true };
}

/**
 * 把"一批行"收敛成"正文表 + 引用行"（写入路径共用一次，避免每处各写一遍）。
 * @param {Array<{row:object, body:object, round?:number|null, at?:string|null}>} items
 * @returns {{bodies:Array<{digest:string,body:object,bytes:number}>, rows:Array<object>}}
 */
export function packBodies(items) {
    const bodies = new Map();
    const rows = [];
    for (const item of items || []) {
        const ref = bodyRefOf(item.body, { round: item.round ?? null, at: item.at ?? null });
        if (!bodies.has(ref.body_digest)) bodies.set(ref.body_digest, { digest: ref.body_digest, body: item.body, bytes: ref.body_bytes });
        rows.push({ ...item.row, ...ref });
    }
    return { bodies: [...bodies.values()], rows };
}
