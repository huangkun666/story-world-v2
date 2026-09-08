// story-world-v2/src/check-step.js
// 世界步语义校验（S4）：真 schema 强制（形状）+ 身份/因果/位置/波及（语义）。
// 事件源三类与无源拒绝（§4.2）、事件位置合法性切片版（§3.2）在此落实。
import { validate } from './schema.js';
import { worldStepSchema } from './schemas/world-step.schema.js';
import { isSettingRef } from './setting.js';   // K25：设定池保留键空间判词

// ids 索引
function indexIds(ssot) {
    const entityIds = new Set((ssot.entities || []).map((e) => e.id));
    const agendaIds = new Set((ssot.agendas || []).map((a) => a.id));
    const eventIds = new Set((ssot.events || []).map((e) => e.id));
    const positions = new Set(ssot.context?.positions || []);
    return { entityIds, agendaIds, eventIds, positions };
}

export function checkWorldStep(step, ssot) {
    const errors = [];

    // ① 形状：真 schema 强制
    const r = validate(step, worldStepSchema);
    if (!r.ok) return { ok: false, errors: r.errors };

    const { entityIds, agendaIds, eventIds, positions } = indexIds(ssot);
    const playerId = ssot.context?.playerId;   // K8：玩家棋子标注（红线 1 代码化）

    // ② 身份：动作/状态变更挂存在的实体；盘算推进挂存在的盘算
    //    K8 禁写规则（优先于未知实体检查）：模型禁写玩家——actions/stateChanges 涉 playerId 一律拒绝，世界如实不动
    for (const [i, a] of step.actions.entries()) {
        if (playerId && a.entity === playerId) errors.push(`$.actions[${i}].entity: 模型禁写玩家 "${playerId}"（红线 1 代码化）`);
        if (!entityIds.has(a.entity)) errors.push(`$.actions[${i}].entity: 未知实体 "${a.entity}"`);
    }
    for (const [i, c] of step.stateChanges.entries()) {
        if (playerId && c.entity === playerId) errors.push(`$.stateChanges[${i}].entity: 模型禁写玩家 "${playerId}"（红线 1 代码化）`);
        if (!entityIds.has(c.entity)) errors.push(`$.stateChanges[${i}].entity: 未知实体 "${c.entity}"`);
    }

    // ②b 盘算树（K13/T1）：新盘算提议——实体存在；event 源必引未决事件；parent 源必引在飞盘算；state 源不带 ref
    // （环检测在出生落账时由引擎做——K14；此处只校验引用合法，无源之物不存在）
    for (const [i, na] of (step.newAgendas || []).entries()) {
        // K14（K13 施工补差）：模型禁写玩家三通道完整——行动/状态变更（K8）+ 新盘算提议（玩家是棋子不是模拟主体，盘算树细案 §2）
        if (playerId && na.entity === playerId) errors.push(`$.newAgendas[${i}].entity: 模型禁写玩家 "${playerId}"（红线 1 代码化）`);
        if (!entityIds.has(na.entity)) errors.push(`$.newAgendas[${i}].entity: 未知实体 "${na.entity}"`);
        const stype = na.source?.type;
        if (stype === 'event') {
            const ev = na.source.ref && ssot.events.find((e) => e.id === na.source.ref);
            if (!ev || ev.closed) {
                errors.push(`$.newAgendas[${i}].source: event 源必须引已存在未决事件（当前 ref="${na.source.ref || ''}"）`);
            }
        } else if (stype === 'parent') {
            const ag = na.source.ref && ssot.agendas.find((a) => a.id === na.source.ref);
            if (!ag) {
                errors.push(`$.newAgendas[${i}].source: parent 源必须引已存在盘算（当前 ref="${na.source.ref || ''}"）`);
            } else if (ag.closed) {
                errors.push(`$.newAgendas[${i}].source: parent 源必须是未结算（在飞）盘算`);
            }
        } else if (stype === 'state' && na.source?.ref) {
            errors.push(`$.newAgendas[${i}].source: state 源不应带 ref`);
        }
    }
    for (const [i, ad] of step.agendaAdvances.entries()) {
        if (!agendaIds.has(ad.agendaId)) errors.push(`$.agendaAdvances[${i}].agendaId: 未知盘算 "${ad.agendaId}"`);
    }
    // ②c 取消通道（K18/因果链 T5）：提议放弃——agendaId 必须存在且未结算（"已结算盘算不可取消"）；
    // 模型只有提议权，裁决归引擎；玩家不是模拟主体（agendaCancels 无 entity 通道，形状天然无玩家面）
    for (const [i, ac] of (step.agendaCancels || []).entries()) {
        const ag = ac.agendaId && ssot.agendas.find((a) => a.id === ac.agendaId);
        if (!ag) {
            errors.push(`$.agendaCancels[${i}].agendaId: 未知盘算 "${ac.agendaId || ''}"`);
        } else if (ag.closed) {
            errors.push(`$.agendaCancels[${i}].agendaId: 已结算盘算不可取消（"${ac.agendaId}"）`);
        }
    }

    // ③ 因果：ripple 源必须引用已存在事件（无源拒绝的语义侧）
    for (const [i, ev] of step.newEvents.entries()) {
        if (ev.source.type === 'ripple') {
            if (!ev.source.ref || !eventIds.has(ev.source.ref)) {
                errors.push(`$.newEvents[${i}].source: ripple 源必须引用已有事件（当前 ref="${ev.source.ref || ''}"）`);
            }
        } else if (ev.source.type === 'plot' && ev.source.ref) {
            if (!agendaIds.has(ev.source.ref)) {
                errors.push(`$.newEvents[${i}].source: plot 源 ref 必须是已有盘算 id`);
            }
        }
    }

    // ④ 位置：事件/动作位置 ⊆ 世界状态位置集（§3.2：不得为贴近玩家而移动）
    for (const [i, ev] of step.newEvents.entries()) {
        if (!positions.has(ev.position)) {
            errors.push(`$.newEvents[${i}].position: " ${ev.position}" 不在世界位置集（${[...positions].join('/')}）`);
        }
    }
    for (const [i, a] of step.actions.entries()) {
        if (a.position != null && !positions.has(a.position)) {
            errors.push(`$.actions[${i}].position: "${a.position}" 不在世界位置集`);
        }
    }

    // ⑤ 波及：ripples 必须是存在的实体
    for (const [i, ev] of step.newEvents.entries()) {
        for (const [j, rid] of (ev.ripples || []).entries()) {
            if (!entityIds.has(rid)) errors.push(`$.newEvents[${i}].ripples[${j}]: 未知实体 "${rid}"`);
        }
    }

    // ⑥ 设定池保留键空间（K25/大势层 → A-4）：context.setting 全池（frozen+dynamic）引擎持有、
    //    模型不可写——任何世界步实体引用字段命中保留键空间即拒绝（校验拒绝、世界如实不动；
    //    命名空间恒定保留，与设定池是否已落账无关；dynamic 的引擎写通道在 src/setting.js，模型无直写路径）
    const refFields = [
        ...step.actions.map((a, i) => [`$.actions[${i}].entity`, a.entity]),
        ...step.actions.map((a, i) => [`$.actions[${i}].target`, a.target]),
        ...step.stateChanges.map((c, i) => [`$.stateChanges[${i}].entity`, c.entity]),
        ...step.stateChanges.map((c, i) => [`$.stateChanges[${i}].actor`, c.actor]),
        ...(step.newAgendas || []).map((n, i) => [`$.newAgendas[${i}].entity`, n.entity]),
    ];
    for (const [path, ref] of refFields) {
        if (isSettingRef(ref)) errors.push(`${path}: 设定池保留键不可作引用对象（引擎只读，K25/A-4）`);
    }
    for (const [i, ev] of step.newEvents.entries()) {
        for (const [j, rid] of (ev.ripples || []).entries()) {
            if (isSettingRef(rid)) errors.push(`$.newEvents[${i}].ripples[${j}]: 设定池保留键不可作引用对象（引擎只读，K25/A-4）`);
        }
    }

    return { ok: errors.length === 0, errors };
}