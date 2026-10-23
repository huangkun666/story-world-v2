// 向量只是当前历史的索引；来源变化后不得复用旧向量。
export function historyStamp(row) {
    const text = JSON.stringify([row?.tick, row?.text, row?.timeMark || '', row?.kind || '', row?.eventRef || '']);
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return `${text.length}:${h >>> 0}`;
}

export function activeHistoryRows(world, volumes = [], scope = null) {
    scope = world?.meta?.memoryHistory || scope;
    const now = Number(world?.meta?.tick);
    const found = new Map();
    const add = (row, archived) => {
        const tick = row?.tick == null ? NaN : Number(row.tick), id = String(row?.id || '');
        if (!id || !Number.isFinite(tick) || !Number.isFinite(now) || tick > now || !String(row?.text || '').trim()) return;
        if (archived && scope && scope.known?.[id] !== historyStamp(row)) return;
        if (!found.has(id)) found.set(id, row);
    };
    for (const row of world?.chronicle || []) add(row, false);
    for (const volume of volumes || []) for (const row of volume?.rows || []) add(row, true);
    return [...found.values()].sort((a, b) => Number(a.tick) - Number(b.tick) || String(a.id).localeCompare(String(b.id)));
}

// 把冷卷里**仍然活跃**的历史并进正式世界时用这一条：**热账那几行一行都不许丢**。
// ★守卫是**按行**判的（早先只比条数，会被"热账掉一行、冷卷补一行"凑平 ⇒ 静默少行）：
//   只要热账里有一行没出现在活跃集里，就整条不并、保持原样，并把原因交给调用方如实报出去。
// 读不出活跃历史（世界没有 tick、编年里有读不干净的旧行）同样保持原样——绝不拿半份合并抹掉玩家的编年。
// 旧档搬迁与恢复点重建共用它。
export function mergeActiveHistory(world, volumes = [], onSkip = null) {
    const rows = Array.isArray(world?.chronicle) ? world.chronicle : [];
    if (!Number.isFinite(Number(world?.meta?.tick))) { onSkip?.('这个世界没有轮次读数，冷卷历史这次没并进来'); return world; }
    let active = [];
    try { active = activeHistoryRows(world, volumes || []); } catch { onSkip?.('活跃历史读不出来，冷卷历史这次没并进来'); return world; }
    if (!Array.isArray(active)) { onSkip?.('活跃历史形状不对，冷卷历史这次没并进来'); return world; }
    const kept = new Set(active.map((row) => String(row?.id ?? '')));
    if (rows.some((row) => !kept.has(String(row?.id ?? '')))) { onSkip?.('编年里有读不干净的旧行，冷卷历史这次没并进来（原来那几行一行没动）'); return world; }
    return { ...world, chronicle: active };
}

export function filterHistoryVolumes(world, volumes = []) {    if (!world) return [];
    const active = new Map(activeHistoryRows(world, volumes).map(row => [String(row.id), historyStamp(row)]));
    return volumes.map(v => ({ ...v, rows: (v.rows || []).filter(row => active.get(String(row.id)) === historyStamp(row)) })).filter(v => v.rows.length);
}

export function rememberHotHistory(world) {
    if (!world?.meta?.memoryHistory) return world;
    return { ...world, meta: { ...world.meta, memoryHistory: { ...world.meta.memoryHistory,
        known: { ...world.meta.memoryHistory.known, ...Object.fromEntries((world.chronicle || []).map(row => [String(row.id), historyStamp(row)])) } } } };
}

export function matchingHistoryStore(store, rows, known = {}) {
    const stamps = new Map([...Object.entries(known), ...rows.map(r => [String(r.id), historyStamp(r)])]);
    const out = { ...store, ids: [], tickByIndex: [], vecs: [], sourceById: {} };
    for (let i = 0; i < (store?.ids || []).length; i++) {
        const id = String(store.ids[i]);
        if (!stamps.has(id) || store.sourceById?.[id] !== stamps.get(id)) continue;
        out.ids.push(id); out.tickByIndex.push(store.tickByIndex[i]); out.vecs.push(store.vecs[i]);
        out.sourceById[id] = stamps.get(id);
    }
    return out;
}

export function completeHistoryThrough(rows, store, floor) {
    const target = Math.max(0, Math.floor(Number(floor)) - 1);
    const done = new Set(store.ids || []);
    const gap = rows.find(r => Number(r.tick) < Number(floor) && !done.has(String(r.id)));
    return gap ? Math.max(0, Math.min(target, Number(gap.tick) - 1)) : target;
}
