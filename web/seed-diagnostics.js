// story-world-v2/web/seed-diagnostics.js
// Task 3（抽取确认与完整入账）：**种账结果的可观察出口**。
//
// 病（预检报告 §5 实测）：`seedBookEntities` 的 `warnings/parentDemoted/pendingKind` 在
//   "建世界"那条路上被**裸调用**丢掉（`web/index.js` 初始化处与 `seedAndBackfill` 只用 `changed`）
//   ⇒ 类别未确认的候选、弃掉的归属、名字包含候选**没有任何人看得到**（"不许静默"的反面）。
//
// 治法（不往入口文件塞逻辑——`web/index.js` 有行数硬锁）：这一族读数**只在这里收口**，
//   两个调用点（初始化 / 载入补缺）共用同一份报告函数：
//   · 计数与原因进**既有** `diagnostics.record`（模块名 `种账`，脱敏/环形由它负责）；
//   · 返回一行中文摘要给调用方 console/状态栏用（调用方自己决定说不说）。
// 纪律：**零 DOM、零 Node 内建**（与其余 web 模块同构），观测面抛错绝不影响种账。

import { diagnostics } from '../src/diagnostics.js';
import { seedBookEntities, seedBookRelations } from '../src/abstract.js';

/**
 * ★Task 3：**种账 + 关系网 + 读数**一次做完（两个调用点共用；入口文件只留一行接线）。
 * @param {object} ssot 世界账（就地改）
 * @param {{entries?:Array, stage?:string}} [opts]
 * @returns {{seed:object, rel:object, summary:string}}
 */
export function seedAndReport(ssot, { entries = [], stage = '种账' } = {}) {
    const seed = seedBookEntities(ssot, { entries });
    const rel = seedBookRelations(ssot);
    const { summary } = reportSeedOutcome({ seed, rel, entries: Array.isArray(entries) ? entries.length : 0, stage });
    return { seed, rel, summary };
}

/**
 * 把一次 `seedBookEntities` + `seedBookRelations` 的结果收成可观察读数。
 * @param {{seed?:object, rel?:object, entries?:number, stage?:string}} args
 * @returns {{summary:string, warnings:string[], pendingKind:number, pendingNames:string[]}}
 */
export function reportSeedOutcome({ seed = null, rel = null, entries = 0, stage = '种账' } = {}) {
    const out = { summary: '', warnings: [], pendingKind: 0, pendingNames: [] };
    try {
        const s = seed && typeof seed === 'object' ? seed : {};
        const r = rel && typeof rel === 'object' ? rel : {};
        const warnings = [...(Array.isArray(s.warnings) ? s.warnings : []), ...(Array.isArray(r.warnings) ? r.warnings : [])];
        out.warnings = warnings;
        out.pendingKind = Number(s.pendingKind) || 0;
        out.pendingNames = Array.isArray(s.pendingNames) ? s.pendingNames.slice() : [];
        const bits = [
            `${stage}: 新入账 ${s.seeded || 0} / 折叠 ${s.folded || 0} / 地名不入池 ${s.skippedLocation || 0}`,
        ];
        if (out.pendingKind) bits.push(`类别待核对 ${out.pendingKind}（未入账）`);
        if (s.parentDemoted) bits.push(`归属弃置 ${s.parentDemoted}`);
        if (s.parentVerified) bits.push(`归属落账 ${s.parentVerified}`);
        if (s.aliasesAttached) bits.push(`别名入账 ${s.aliasesAttached}`);
        if (r.seeded) bits.push(`关系边 ${r.seeded}`);
        if (r.dropped?.length) bits.push(`关系边弃置 ${r.dropped.length}`);
        if (entries) bits.push(`真书条目 ${entries}`);
        out.summary = bits.join(' · ');
        const level = warnings.length || out.pendingKind || r.dropped?.length ? 'warn' : 'info';
        diagnostics.record('种账', level, out.summary, {
            seeded: s.seeded || 0, folded: s.folded || 0, pendingKind: out.pendingKind,
            pendingNames: out.pendingNames.slice(0, 10), parentVerified: s.parentVerified || 0,
            parentDemoted: s.parentDemoted || 0, aliasesAttached: s.aliasesAttached || 0,
            relationsSeeded: r.seeded || 0, relationsDropped: (r.dropped || []).slice(0, 5),
            warnings: warnings.slice(0, 5),
        });
    } catch (err) {
        // 观测面绝不许成为故障点（与 onProgress 同一条纪律）
        try { diagnostics.record('种账', 'error', `种账读数收集失败：${String(err?.message || err)}`); } catch (_) { /* 忽略 */ }
    }
    return out;
}
