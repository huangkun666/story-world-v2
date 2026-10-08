// 玩家、用户禁止模拟的角色和本轮已行动角色共用这份权限判定。
import { normEntityName, resolveEntityIdentityWithCanon } from './entity-identity.js';

export function isSimulationBlocked(world, id) {
    if (!id) return false;
    return world?.context?.playerId === id
        || (world?.entities || []).some(e => e.id === id && e.simulationBlocked === true);
}

/** 只认即将结算的轮次；上一轮的名单不能续用。 */
export function currentTurnProtection(world) {
    const protection = world?.meta?.turnProtection;
    return protection?.tick === (world?.meta?.tick ?? 0) + 1 ? protection : null;
}

export function isProtectedForStep(world, id) {
    return isSimulationBlocked(world, id)
        || Boolean(id && currentTurnProtection(world)?.actedIds?.includes(id));
}

/** 完整当前资料独立于镜头裁剪；也包含本轮实际行动的势力，别名使用既有身份解析。 */
export function protectedCharactersOf(world) {
    const entities = world?.entities || [];
    const canon = world?.context?.setting?.frozen?.canon?.bookEntities || [];
    return entities.filter(e => isProtectedForStep(world, e.id)).map(e => {
        const row = structuredClone(e);
        const aliases = (row.aliases || []).filter(alias => resolveEntityIdentityWithCanon(entities, canon, alias).id === e.id);
        for (const entry of canon) {
            if (normEntityName(entry.name) !== normEntityName(e.name)) continue;
            for (const alias of entry.aliases || []) {
                const resolved = resolveEntityIdentityWithCanon(entities, canon, alias);
                if (resolved.id === e.id && !aliases.includes(alias)) aliases.push(alias);
            }
        }
        if (aliases.length) row.aliases = aliases;
        else delete row.aliases;
        row.protectionReason = isSimulationBlocked(world, e.id) ? 'permanent' : 'current-turn';
        return row;
    });
}

/** 用户控制的永久开关：不改原账，不改变玩家身份。 */
export function setSimulationBlocked(world, id, blocked) {
    const entity = (world?.entities || []).find(e => e.id === id);
    if (!entity || entity.kind !== 'character') throw new Error('只能为已在册的角色设置禁止模拟');
    if (typeof blocked !== 'boolean') throw new TypeError('禁止模拟必须是 boolean');
    if (id === world?.context?.playerId) {
        if (!blocked) throw new Error('玩家角色始终受保护，不能允许模拟');
        return { world, changed: false };
    }
    if ((entity.simulationBlocked === true) === blocked) return { world, changed: false };
    return { world: { ...world, entities: world.entities.map(e => e === entity ? { ...e, simulationBlocked: blocked } : e) }, changed: true };
}
