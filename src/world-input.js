// 世界输入只保存一份本轮事件正文；其他栏目按事件身份引用，不修改世界账。
import { eventDetails } from './event-contract.js';

// 重提已有事实只提供引用对象，不建新事件，也不替人物声明已经行动。
export function referencedEventsOf(world, ids = [], rejected = []) {
    const known = new Map((world?.events || []).map(e => [e.id, e]));
    for (const m of world?.milestones || []) {
        for (const r of m.rows || []) if (!known.has(r.id)) known.set(r.id, r);
        for (const [i, id] of (m.ids || []).entries()) if (!known.has(id)) known.set(id, { id,
            ...(m.titles?.[i] ? { title: m.titles[i] } : {}) });
    }
    return [...new Set(ids || [])].flatMap(id => {
        const e = known.get(id);
        if (!e) { rejected.push({ family: 'reference', why: 'cause', ref: id }); return []; }
        return [{ id, ...(e.title ? { title: e.title } : {}), ...eventDetails(e),
            ...(e.timeMark ? { timeMark: e.timeMark } : {}), ...(e.position ? { position: e.position } : {}),
            ...(typeof e.closed === 'boolean' ? { pending: !e.closed } : {}) }];
    });
}

export function prepareWorldInput(world, turnFacts, volumes = null, vecRecall = null) {
    const results = [...(Array.isArray(turnFacts?.events) ? turnFacts.events : []),
        ...(Array.isArray(turnFacts?.references) ? turnFacts.references : [])];
    const ids = new Set(results.map((e) => e?.id).filter(Boolean));
    if (!ids.size) return { world, volumes, vecRecall };
    const refersToResult = (row) => ids.has(row?.eventRef);
    const event = (e) => {
        if (!ids.has(e?.id)) return e;
        const projected = { ...e, title: `见本轮结果 ${e.id}` };
        for (const key of Object.keys(eventDetails(e))) {
            if (key !== 'eventProtocol') delete projected[key];
        }
        return projected;
    };
    const rowById = new Map();
    for (const v of Array.isArray(volumes) ? volumes : []) {
        for (const r of Array.isArray(v?.rows) ? v.rows : []) if (r?.id) rowById.set(r.id, r);
    }
    for (const r of world?.chronicle || []) if (r?.id) rowById.set(r.id, r);
    const inputWorld = { ...world,
        events: (world?.events || []).map(event),
        chronicle: (world?.chronicle || []).filter((r) => !refersToResult(r)),
        ...(Array.isArray(world?.milestones) ? { milestones: world.milestones.map((m) => ({ ...m,
            ...(Array.isArray(m.rows) ? { rows: m.rows.map(event) } : {}),
            ...(Array.isArray(m.titles) && Array.isArray(m.ids) ? {
                titles: m.titles.map((title, i) => ids.has(m.ids[i]) ? `见本轮结果 ${m.ids[i]}` : title),
            } : {}),
        })) } : {}),
    };
    const inputVolumes = Array.isArray(volumes) ? volumes.map((v) => ({ ...v,
        ...(Array.isArray(v?.rows) ? { rows: v.rows.filter((r) => !refersToResult(r)) } : {}),
    })) : volumes;
    const inputRecall = Array.isArray(vecRecall?.items) ? { ...vecRecall,
        items: vecRecall.items.filter((r) => !refersToResult(r) && !refersToResult(rowById.get(r?.id))),
    } : vecRecall;
    return { world: inputWorld, volumes: inputVolumes, vecRecall: inputRecall };
}

/** 字符组成与原文出现次数只供复制报告；它不是模型内部注意力的测量。 */
export function worldInputStats(pack, text) {
    const chars = (v) => v == null ? 0 : JSON.stringify(v).length;
    const events = [...(Array.isArray(pack?.turnFacts?.events) ? pack.turnFacts.events : []),
        ...(Array.isArray(pack?.turnFacts?.references) ? pack.turnFacts.references : [])];
    const occurrences = events.map((e) => {
        const needle = typeof e?.title === 'string' && e.title ? JSON.stringify(e.title).slice(1, -1) : '';
        return { id: e?.id, count: needle ? text.split(needle).length - 1 : 0 };
    });
    return { chatResultChars: chars(events),
        worldPendingChars: chars(pack?.pendingEvents) + chars(pack?.agendas),
        historyChars: chars(pack?.纪事) + chars(pack?.相关往事) + chars(pack?.['按意思找回的旧事']),
        protectionChars: chars(pack?.turnFacts?.actedIds) + chars(pack?.turnFacts?.changedFields),
        totalChars: text.length, selectedIds: events.map((e) => e.id), occurrences,
        duplicates: occurrences.reduce((n, e) => n + Math.max(0, e.count - 1), 0) };
}
