// story-world-v2/src/pack.js
// 演化上下文打包（S4/S5 共用）：世界自身状态 + 玩家落子事实 → 主调用输入。
// 长跑防线细案 §2.1：预算常量（提案 4k tokens；第十九棒 K44 拍板改 30k）+ 固定打包序 + 超限剪枝。
// K44/第十九棒（full-roster-lens-spec C2/C7 拍板）：实体段=**镜头选择器**——
//   全量棋盘上按「例外保送（被点名/在飞盘算属主/近 2 tick 活跃）+ 分量降序」排序、30k 内取前缀；
//   势力实体附「麾下成员」简表（parent 派生反查，含分支成员）；分量数字仍不入包（P3 不变）。
export const EVOLUTION_BUDGET_TOKENS = 30000; // 用户 2026-09-09 定案（"现在的大模型绝对有这个能力"）；镜头容量=预算内自适应
export const LENS_DEFAULT_MAX_TOKENS = 30000; // 镜头（实体段）独立上限（同值；测试可注入小值验证截断机制）
export const LENS_MEMBERS_TOP = 8;            // 势力麾下成员简表条数上限（份内按分量序；超出记「等 N 人」）
export const TOKEN_RATIO = 3;                // 粗略估计：1 token ≈ 3 字符（中文）
export const DIALOGUE_BOOK_TOP = 5;          // 提案：K38 补差包——依据册摘要进包条数上限（敲定稿 C 条）

// 镜头名单（引擎层纯函数只读，一处定义多处读取）：全量 active 实体 →
//   [例外保送（moveFact.object / 未决事件 ripples / 在飞盘算属主 / lastActiveTick ≥ tick−2）]
//   + [其余按分量降序]——lensMaxTokens 内取前缀（估算沿用 TOKEN_RATIO；确定性逐字节）。
// 分量只用于排序，不随行输出（P3：模型看不到分量数字）。
export function lensList(ssot, { lensMaxTokens = LENS_DEFAULT_MAX_TOKENS, moveFact = null } = {}) {
    const est = (s) => Math.ceil(s.length / TOKEN_RATIO);
    const tick = ssot?.meta?.tick ?? 0;
    const named = new Set();
    const obj = moveFact?.object;
    if (obj && typeof obj === 'string') named.add(obj);
    for (const ev of ssot?.events || []) if (!ev.closed) for (const r of ev.ripples || []) named.add(r);
    for (const ag of ssot?.agendas || []) if (!ag.closed) named.add(ag.owner);
    const rows = (ssot?.entities || [])
        .filter((e) => !e.status || e.status === 'active')      // K37 三点过滤①：retired/dead 出演化上下文
        .map((e) => {
            const boost = named.has(e.name) || named.has(e.id)
                || (typeof e.lastActiveTick === 'number' && tick - e.lastActiveTick <= 2);
            return { e, w: ssot?.weights?.[e.id] ?? 0, boost };
        })
        .sort((a, b) => (b.boost - a.boost) || (b.w - a.w) || (a.e.id < b.e.id ? -1 : 1));
    const out = [];
    let used = 0;
    for (const { e, w } of rows) {
        const line = JSON.stringify([e.id, e.name, e.kind]);
        const cost = est(line);
        if (out.length && used + cost > lensMaxTokens) break;    // 前缀截断（至少保留首名，防御空镜）
        used += cost;
        out.push({ e, w });
    }
    return out;
}

// 麾下成员简表（C7 派生反查）：characters 的 parent 命中 实体名/其分支名 → 归该势力；分量序取前 LENS_MEMBERS_TOP
export function membersOf(world, faction) {
    const scope = new Set([faction.name, ...(faction.branches || [])]);
    const list = (world?.entities || [])
        .filter((e) => e.kind === 'character' && e.parent && scope.has(e.parent))
        .sort((a, b) => (world.weights?.[b.id] ?? 0) - (world.weights?.[a.id] ?? 0));
    if (!list.length) return null;
    const heads = list.slice(0, LENS_MEMBERS_TOP).map((e) => e.name);
    if (list.length > LENS_MEMBERS_TOP) heads.push(`等${list.length}人`);
    return heads;
}

// 固定打包序：活跃实体简表 → 在飞盘算（含 memory）→ 未决事件 → 最近 2 tick 关闭事件 → 玩家落子事实 → 张力
// 已结算盘算不再喂给模型（防满步重播，活档实测发现）
// K2/P3：分量不再入包（ANCHOR §3③：模型看不到分量、不参与分量；门控在引擎侧兜底）
export function buildEvolutionPack(ssot, moveFact) {
    // K44：镜头选择器——全量棋盘有序入镜（保送+分量序），预算内前缀；分量不随行泄漏（P3）
    const lens = lensList(ssot, { moveFact });
    const entities = lens.map(({ e }) => {
        const row = { id: e.id, kind: e.kind, name: e.name, location: e.location };
        if (e.parent) row.parent = e.parent;                      // C7：从属（角色→势力/分支）
        if (e.kind === 'faction' && e.branches?.length) row.branches = e.branches;   // C8：分支表
        if (e.kind === 'faction' && e.organs?.length) row.organs = e.organs;         // leg23：名下机构/部门（书里明述）
        if (e.kind === 'faction') {
            const members = membersOf(ssot, e);                   // C7：麾下成员简表（派生）
            if (members) row.members = members;
        }
        return row;
    });
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
    const dyn = ssot.context?.setting?.dynamic;   // K29：设定大势块（只读注入；冻结层不入包——体积纪律 A-8）
    // K38 补差包（敲定稿 C 条）：对话依据册摘要进包——"谁反复被点名"模型看得见（dialogueFact 源/镜头依据；
    // 只取前 TOP 条，计数+最近提及轮；依据册总量留在账上）
    const db = ssot.meta?.dialogueBook;
    const dialogueBook = db && typeof db === 'object'
        ? Object.entries(db)
            .map(([name, rec]) => ({ name, count: rec?.count ?? 0, lastTick: rec?.lastTick ?? 0 }))
            .sort((a, b) => b.count - a.count || b.lastTick - a.lastTick)
            .slice(0, DIALOGUE_BOOK_TOP)
        : [];
    const pack = {
        world: ssot.context?.world,
        // 张力：有 setting 取演化层强度（引擎算），无则回退 context.tension 数字（细案 §3.1 兼容口径）
        tension: dyn ? dyn.tension?.intensity : ssot.context?.tension,
        setting: dyn ? { tension: dyn.tension, env: dyn.env ?? {} } : undefined,   // 大势块：张力三件 + 环境量（固定小结；derivedFrom 属引擎记账不入包）
        positions: ssot.context?.positions,
        entities,
        agendas,
        pendingEvents,
        recentClosedEvents: closedEvents,
        playerMove: moveFact || null,
        dialogueBook,
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