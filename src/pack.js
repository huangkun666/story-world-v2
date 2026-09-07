// story-world-v2/src/pack.js
// 演化上下文打包（S4/S5 共用）：世界自身状态 + 玩家落子事实 → 主调用输入。
// 长跑防线细案 §2.1：预算常量（提案 4k tokens）+ 固定打包序 + 超限剪枝（切片版）。
export const EVOLUTION_BUDGET_TOKENS = 4000; // 提案值，S7 冒烟曲线后报批
export const TOKEN_RATIO = 3;                // 粗略估计：1 token ≈ 3 字符（中文）

// 固定打包序：活跃实体简表 → 在飞盘算（含 memory）→ 未决事件 → 最近 2 tick 关闭事件 → 玩家落子事实 → 张力
// 已结算盘算不再喂给模型（防满步重播，活档实测发现）
// K2/P3：分量不再入包（ANCHOR §3③：模型看不到分量、不参与分量；门控在引擎侧兜底）
export function buildEvolutionPack(ssot, moveFact) {
    const entities = (ssot.entities || []).map((e) => ({
        id: e.id, kind: e.kind, name: e.name, location: e.location,
    }));
    const agendas = (ssot.agendas || []).filter((a) => !a.closed).map((a) => ({
        id: a.id, owner: a.owner, goal: a.goal, stage: a.stage,
        visibility: a.visibility, progress: `${a.progress}/${a.maxSteps}`, memory: a.memory,
        parentId: a.parentId,   // K14（K13 施工补差，细案 §3.5）：树形是"谋划的结构"，可见；分量数字不可见原则 P3 不动
    }));
    const pendingEvents = (ssot.events || []).filter((e) => !e.closed).map((e) => ({
        id: e.id, title: e.title, source: e.source, position: e.position,
    }));
    const closedEvents = (ssot.events || []).filter((e) => e.closed).slice(-2).map((e) => ({
        id: e.id, title: e.title,
    }));
    const pack = {
        world: ssot.context?.world,
        tension: ssot.context?.tension,
        positions: ssot.context?.positions,
        entities,
        agendas,
        pendingEvents,
        recentClosedEvents: closedEvents,
        playerMove: moveFact || null,
    };
    const text = JSON.stringify(pack);
    return { pack, text, estTokens: Math.ceil(text.length / TOKEN_RATIO) };
}

// 超限剪枝（切片版，固定剪枝序）：最近 2 tick 关闭事件 → 未决事件详情 → 在飞盘算步骤细节
export function trimPack(pack, budgetTokens = EVOLUTION_BUDGET_TOKENS) {
    const p = structuredClone(pack);
    const cut = [];
    if (p.recentClosedEvents?.length) { cut.push('recentClosedEvents'); p.recentClosedEvents = p.recentClosedEvents.map((e) => ({ id: e.id })); }
    let est = Math.ceil(JSON.stringify(p).length / TOKEN_RATIO);
    if (est <= budgetTokens) return { pack: p, cut, estTokens: est };
    if (p.pendingEvents?.length) {
        cut.push('pendingEvents');
        p.pendingEvents = p.pendingEvents.map((e) => ({ id: e.id, title: e.title }));
        est = Math.ceil(JSON.stringify(p).length / TOKEN_RATIO);
    }
    if (est <= budgetTokens) return { pack: p, cut, estTokens: est };
    if (p.agendas?.length) {
        cut.push('agendas.detail');
        p.agendas = p.agendas.map((a) => ({ id: a.id, goal: a.goal, progress: a.progress }));
        est = Math.ceil(JSON.stringify(p).length / TOKEN_RATIO);
    }
    return { pack: p, cut, estTokens: est };
}