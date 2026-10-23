import { computeIdleFaces } from './pack.js';
import { resolveLimits } from './limits.js';
import { isProtectedForStep } from './simulation-protection.js';

/** 世界事务来自正式状态；正文的事实变化由准备阶段合入后再核对资格。 */
export function worldTasks(world) {
    if (!world || typeof world !== 'object' || Array.isArray(world)) throw new TypeError('world must be an object');
    const entities = new Map((world.entities || []).map(e => [e.id, e]));
    const refs = row => [...new Set([row.source?.ref, row.parentId, row.eventRef,
        ...(row.causeIds || []), ...(row.links?.up || [])].filter(Boolean))];
    const task = (row, kind, owner) => ({ id: row.id, kind, origin: 'world',
        ...(owner ? { owner } : {}), referenceIds: refs(row),
        query: [owner && entities.get(owner)?.name, row.goal, row.title, row.text, row.statement, row.stage].filter(Boolean).join(' '),
    });
    const tasks = [];
    for (const agenda of world.agendas || []) {
        const owner = entities.get(agenda.owner);
        if (!agenda.id || agenda.closed || !owner || (owner.status && owner.status !== 'active') || isProtectedForStep(world, owner.id)) continue;
        tasks.push(task(agenda, 'agenda', owner.id));
    }
    for (const event of world.events || []) {
        if (event.id && !event.closed) tasks.push(task(event, 'event'));
    }
    for (const condition of world.conditions || []) {
        if (condition.id && ['active', 'planned'].includes(condition.state)) tasks.push(task(condition, 'condition'));
    }
    for (const entity of computeIdleFaces(world, resolveLimits(world).待启用名单)) {
        if (isProtectedForStep(world, entity.id)) continue;
        tasks.push({ id: entity.id, kind: 'idle', owner: entity.id, origin: 'world', referenceIds: [], query: entity.name });
    }
    return tasks;
}
