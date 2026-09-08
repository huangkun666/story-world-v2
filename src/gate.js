// story-world-v2/src/gate.js
// 主动作权门控（K2，分量引擎细案 §3.2）：静默判定 + 触发例外 + simLog 审计。
// K37/实体治理 §3.7（三点过滤②③）：retired/dead 实体从门控面整体剔除——
//   silent 判定跳过（不进静默名单）、named 点名列拆（不构成豁免/监听）、newEntities 提议按提议者判定；
// 纯函数：不改输入 step/world，返回过滤后的世界步与滤除统计。
// 语义：静默 = 不主动（actions/盘算推进/plot 事件/入局提议），不是消失——静默方始终是合法客体；
//       被点名可应答（未决事件波及 ∪ 其他实体动作目标 ∪ 玩家落子事实对象），下一轮重新判定。
export const SILENCE_THRESHOLD = { character: 0.25, faction: 0.50 };   // 提案态（细案 P2，K6 曲线后复校）

export function gateWorldStep(step, world, moveFact = null) {
    const weights = world.weights || {};
    const kindOf = new Map(world.entities.map((e) => [e.id, e.kind]));
    const agendaOwner = new Map((world.agendas || []).map((a) => [a.id, a.owner]));
    // K37：状态面（active 才算门控成员；retired/dead 从点名/静默/提议面剔除）
    const statusOf = new Map(world.entities.map((e) => [e.id, e.status || 'active']));
    const gated = (e) => (statusOf.get(e.id) ?? 'active') === 'active';

    // top-1 永不静默（并列取实体序首个）：世界里永远有人在动，防全静默。
    let topId = null;
    let topW = -1;
    for (const e of world.entities) {
        if (!gated(e)) continue;
        const w = weights[e.id] ?? 0;
        if (w > topW) { topW = w; topId = e.id; }
    }

    const silentSet = new Set();
    for (const e of world.entities) {
        if (!gated(e)) continue;
        if (e.id === topId) continue;
        const th = SILENCE_THRESHOLD[kindOf.get(e.id)] ?? SILENCE_THRESHOLD.character;
        if ((weights[e.id] ?? 0) < th) silentSet.add(e.id);
    }

    // 触发例外：本轮输入中点名静默方 → 解除静默（可应答）。
    // 点名列拆（K37/三点过滤②）：ripples/动作目标/落子对象指向 retired/dead 实体不算"点名"（不解除静默）。
    const named = new Set();
    for (const ev of world.events || []) {
        if (!ev.closed) for (const r of ev.ripples || []) if (gated({ id: r })) named.add(r);
    }
    for (const a of step.actions || []) if (a.target && gated({ id: a.target })) named.add(a.target);
    if (moveFact?.object && gated({ id: moveFact.object })) named.add(moveFact.object);
    const lifted = [...silentSet].filter((id) => named.has(id));
    const liftedSet = new Set(lifted);
    const active = (id) => !silentSet.has(id) || liftedSet.has(id);

    const dropped = { actions: [], agendaAdvances: [], plotEvents: [], newAgendas: [], agendaCancels: [], newEntities: [] };
    const actions = (step.actions || []).filter((a) => {
        if (active(a.entity)) return true;
        dropped.actions.push(a.entity);
        return false;
    });
    const agendaAdvances = (step.agendaAdvances || []).filter((ad) => {
        const owner = agendaOwner.get(ad.agendaId);
        if (active(owner)) return true;
        dropped.agendaAdvances.push(owner);
        return false;
    });
    const newEvents = (step.newEvents || []).filter((ev) => {
        if (ev.source?.type !== 'plot') return true;   // state/ripple 事件不属主动作，照常落账
        const owner = agendaOwner.get(ev.source.ref);
        if (active(owner)) return true;
        dropped.plotEvents.push(owner);
        return false;
    });
    const newAgendas = (step.newAgendas || []).filter((na) => {
        // K14 出生裁判（细案 §3.2 → A-2）：新盘算提议 = 主动作——静默方提议被滤除（双面无痕）；
        // 被点名应答方（lifted）可以提议；下一轮重新判定。
        if (active(na.entity)) return true;
        dropped.newAgendas.push(na.entity);
        return false;
    });
    const agendaCancels = (step.agendaCancels || []).filter((ac) => {
        // K18 取消通道（因果链细案 §3.5 → A-5）：放弃提议 = 主动作——静默方提议被滤除（双面无痕，与出生对称）；
        // 被点名应答方（lifted）可以提议放弃。
        const owner = agendaOwner.get(ac.agendaId);
        if (active(owner)) return true;
        dropped.agendaCancels.push(owner || ac.agendaId);
        return false;
    });
    const newEntities = (step.newEntities || []).filter((ne) => {
        // K37 生通道②：入局提议 = 主动作——静默方提议被滤除（双面无痕）；无提议者（dialogueFact 观察者源）透传。
        if (!ne.entity) return true;
        if (active(ne.entity)) return true;
        dropped.newEntities.push(ne.entity);
        return false;
    });

    const droppedCounts = {};
    for (const id of [...dropped.actions, ...dropped.agendaAdvances, ...dropped.plotEvents, ...dropped.newAgendas, ...dropped.agendaCancels, ...dropped.newEntities]) {
        droppedCounts[id] = (droppedCounts[id] ?? 0) + 1;
    }

    return {
        step: { actions, newEvents, agendaAdvances, stateChanges: step.stateChanges || [], newAgendas, agendaCancels, newEntities, entityFates: step.entityFates || [] },
        silent: [...silentSet],
        lifted,
        dropped,
        droppedCounts,
    };
}