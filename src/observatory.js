// story-world-v2/src/observatory.js
// 观测台（敲定稿 I 条；K38 收口，引擎层纯函数，零调用零创作）：找死不找活——
//   一、拒签率（rejectionStats）：分子=静默滤除+裁定拒签，分母=模型提议条数（K38 起 simLog 记 proposals/rejected；
//       旧账/缺字段走 warnings 前缀兜底口径，诚实标注 samples）
//   二、坏账率（scanDanglingRefs）：全量引用扫描——events.links.up / source.ref（ripple）/ ripples /
//       agendas.parentId / milestones.links.up，凡指向热池事件、里程碑、里程碑内含 id 皆不可达者=坏账（0 是目标）
//   三、驻留（residencyStats）：active/retired/dead 分布 + 活跃实体闲置轮数分位（"占座摸鱼"判据）+ loungers 名单
//   参考读数（probeStepAges）：当轮提议对旧事（>FAR_WINDOW tick）的引用占比——"记得你"的代理读数（演练采样用）
// 纪律：纯函数、输入不可变；只读账，不落账、不写编年、不调 LLM。
import { eventBornTick } from './setting.js';

export const REJECTION_PREFIXES = ['裁定:', '校验拒绝:'];
export const LOUNGER_TICKS = 30;   // 提案：占座摸鱼判据（敲定稿 I 条：>30 轮告警；随 K38 报批）
export const FAR_WINDOW = 20;      // 提案：远期引用判据（>20 tick 视为"还记得"；随 K38 报批）

const EV_ID = /^ev_(\d+)_/;
const AG_ID = /^a_(\d+)_/;

// 一、拒签率（近 window 轮；rate=null 表示分母不足/无数据）
export function rejectionStats(simLog, window = 20) {
    const rows = (simLog || []).slice(-window);
    let proposals = 0;
    let rejected = 0;
    let counted = 0;
    for (const r of rows) {
        if (typeof r.proposals === 'number') {
            proposals += r.proposals;
            counted += 1;
            rejected += typeof r.rejected === 'number' ? r.rejected : 0;
        } else {
            // 旧账兜底：无 proposals 记账的轮，按 warnings 计数（无分母口径，不计入分母）
            rejected += (r.warnings || []).filter((w) => REJECTION_PREFIXES.some((p) => w.startsWith(p))).length;
        }
    }
    if (!counted || proposals <= 0) return { ok: false, samples: rows.length, countedRounds: counted, proposals, rejected, rate: null };
    return { ok: true, samples: rows.length, countedRounds: counted, proposals, rejected, rate: rejected / proposals };
}

// 二、坏账率：全量引用解析扫描（0 坏账是目标；返回明细清单）
export function scanDanglingRefs(world) {
    const dangling = [];
    const evIds = new Set((world.events || []).map((e) => e.id));
    const msIds = new Set((world.milestones || []).map((m) => m.id));
    const msContain = new Set();
    for (const m of world.milestones || []) for (const id of m.ids || []) msContain.add(id);
    const reachable = (id) => evIds.has(id) || msIds.has(id) || msContain.has(id);
    const entIds = new Set((world.entities || []).map((e) => e.id));
    const agIds = new Set((world.agendas || []).map((a) => a.id));

    for (const ev of world.events || []) {
        for (const u of ev.links?.up || []) if (!reachable(u)) dangling.push(`events.${ev.id}.links.up → ${u}`);
        const st = ev.source?.type;
        const ref = ev.source?.ref;
        if (ref && st === 'ripple' && !reachable(ref)) dangling.push(`events.${ev.id}.source.ref → ${ref}`);
        for (const r of ev.ripples || []) if (!entIds.has(r)) dangling.push(`events.${ev.id}.ripples → ${r}`);
    }
    for (const a of world.agendas || []) {
        if (a.parentId && !agIds.has(a.parentId)) dangling.push(`agendas.${a.id}.parentId → ${a.parentId}`);
    }
    for (const m of world.milestones || []) {
        for (const u of m.links?.up || []) if (!reachable(u)) dangling.push(`milestones.${m.id}.links.up → ${u}`);
    }
    return { dangling, count: dangling.length };
}

// 三、驻留：实体状态分布 + 活跃闲置分位 + 摸鱼名单
export function residencyStats(world) {
    const now = world.meta?.tick ?? 0;
    const rows = [];
    for (const e of world.entities || []) {
        const idle = now - (e.lastActiveTick ?? 0);
        rows.push({ id: e.id, kind: e.kind, status: e.status || 'active', idle });
    }
    const statusCount = { active: 0, retired: 0, dead: 0 };
    const idleActive = [];
    for (const r of rows) {
        statusCount[r.status] = (statusCount[r.status] ?? 0) + 1;
        if (r.status === 'active') idleActive.push(r.idle);
    }
    idleActive.sort((a, b) => a - b);
    const pct = (p) => (idleActive.length ? idleActive[Math.min(idleActive.length - 1, Math.floor(p * idleActive.length))] : null);
    return {
        entities: rows.length,
        statusCount,
        activeIdle: { max: idleActive.length ? idleActive[idleActive.length - 1] : null, p50: pct(0.5), p90: pct(0.9) },
        loungers: rows.filter((r) => r.status === 'active' && r.idle >= LOUNGER_TICKS).map((r) => r.id),
    };
}

// 参考读数：当轮提议对旧事实的引用年龄分布（演练脚本逐轮采样；纯只读）
export function probeStepAges(step, world) {
    const now = world.meta?.tick ?? 0;
    const findEvent = (id) => (world.events || []).find((e) => e.id === id);
    const ageOf = (id) => {
        if (!id) return null;
        const m = EV_ID.exec(id);
        if (m) {
            const born = parseInt(m[1], 10);
            return now - born;
        }
        const ev = findEvent(id);
        if (ev) {
            const born = eventBornTick(ev.id);
            return born === -Infinity ? null : now - born;
        }
        const a = AG_ID.exec(id);
        if (a) return now - parseInt(a[1], 10);
        return null;
    };
    const sampled = [];
    for (const ev of step?.newEvents || []) {
        if (ev.source?.type === 'ripple') {
            const age = ageOf(ev.source.ref);
            if (age != null) sampled.push({ ref: ev.source.ref, age });
        }
    }
    const far = sampled.filter((s) => s.age > FAR_WINDOW);
    return {
        sampled: sampled.length,
        far: far.length,
        farRate: sampled.length ? far.length / sampled.length : null,
        farRefs: far.map((s) => s.ref),
    };
}

// 汇总：一次给全（演练/面板共用）
export function summarizeObservatory(world) {
    return {
        rejection: rejectionStats(world.meta?.simLog),
        dangling: scanDanglingRefs(world),
        residency: residencyStats(world),
        tick: world.meta?.tick ?? 0,
    };
}