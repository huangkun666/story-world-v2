// 事件原话、历史范围和持续条件的共同入口。零依赖，不判断故事语义。
export const EVENT_PROTOCOL = 4;
export const actorSchema = {kind:'object',additional:false,required:['name'],props:{name:{kind:'string',minLength:1},ref:{kind:'string',minLength:1}}};
export const scopeSchema = {kind:'object',additional:false,required:['kind','text'],props:{kind:{kind:'string',enum:['entity','members','place','text']},text:{kind:'string',minLength:1},ref:{kind:'string',minLength:1}}};
export const storedScopeSchema = {...scopeSchema,props:{...scopeSchema.props,resolution:{kind:'object',additional:false,required:['knownIds','asOfTick'],props:{knownIds:{kind:'array',items:{kind:'string',minLength:1}},asOfTick:{kind:'number',int:true,min:0}}}}};
const clone = value => JSON.parse(JSON.stringify(value));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const detailKeys = ['eventProtocol', 'category', 'actors', 'affected', 'audience', 'reportedContent', 'participantMode'];
export function eventDetails(event) {
    const out = {};
    for (const key of detailKeys) if (event?.[key] !== undefined) out[key] = clone(event[key]);
    return out;
}
function scopeIds(scope, world) {
    const entities = world?.entities || [];
    const target = entities.find(e => e.id === scope.ref);
    if (!target) return [];
    if (scope.kind === 'entity') return [target.id];
    if (scope.kind !== 'members') return [];
    return memberEntitiesOf(world,target).map(e => e.id);
}
export function memberEntitiesOf(world, faction) {
    const scope = new Set([faction.name, ...(faction.branches || [])]);
    return (world?.entities || []).filter(e => e.kind === 'character' && e.parent && scope.has(e.parent))
        .sort((a,b) => { const an=String(a.name ?? ''), bn=String(b.name ?? ''); return an !== bn ? (an < bn ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
}
export function currentScopeIds(scopes, world) {
    return [...new Set((scopes || []).flatMap(scope => scopeIds(scope, world)))];
}
export function resolveScopes(scopes, world, tick) {
    return (scopes || []).map(scope => {
        const { resolution: ignored, ...original } = scope;
        const ids = scopeIds(original, world);
        return { ...clone(original), ...(ids.length ? { resolution: { knownIds: ids, asOfTick: tick } } : {}) };
    });
}
export function eventEntityIds(event, world) {
    if (event?.eventProtocol !== EVENT_PROTOCOL) return [...new Set(event?.ripples || [])];
    const ids = [...(event.actors || []).map(a => a.ref).filter(Boolean),
        ...(event.affected || []).flatMap(scope => scope.resolution?.knownIds || [])];
    return [...new Set(ids)].filter(id => !world || (world.entities || []).some(e => e.id === id));
}
export function eventDetailText(event) {
    return [['类别', event?.category], ['当事人', event?.actors?.map(a => a.name).join('、')],
        ['影响范围', event?.affected?.map(s => s.text).join('；')], ['公开范围', event?.audience?.map(s => s.text).join('；')],
        ['发布说法', event?.reportedContent]].filter(([, text]) => text).map(([label, text]) => `${label}：${text}`).join('；');
}
export function remapConditionEventRefs(updates, originalEvents, keptEvents, world, tick) {
    const result = {updates:[],rejected:[]};
    for (const [index, update] of (updates || []).entries()) {
        const ref=update?.eventRef;
        if ((world.events || []).some(e=>e.id===ref) || (world.milestones || []).some(m=>(m.ids||[]).includes(ref))) { result.updates.push(update); continue; }
        const match=/^ev_\d+_(\d+)$/.exec(String(ref || ''));
        if (!match) { result.updates.push(update); continue; }
        const original=originalEvents[Number(match[1])-1];
        const indexKept=original ? keptEvents.indexOf(original) : -1;
        if (indexKept<0) { result.rejected.push({index,update,errors:['条件原因事件已被丢弃']}); continue; }
        result.updates.push({...update,eventRef:`ev_${tick}_${indexKept+1}`});
    }
    return result;
}
export function checkScopes(scopes, world) {
    if (!Array.isArray(scopes)) return ['范围必须是数组'];
    return scopes.flatMap(s => !s || !['entity','members','place','text'].includes(s.kind) || !nonempty(s.text) ||
        Object.keys(s).some(k => !['kind','text','ref'].includes(k)) || (s.ref !== undefined && !nonempty(s.ref)) ||
        (s.kind === 'members' && !nonempty(s.ref)) || (['place','text'].includes(s.kind) && s.ref !== undefined)
        ? ['范围必须保留原文与合法引用，resolution 只能由引擎填写'] : world && s.ref && !(world.entities || []).some(e => e.id===s.ref && (s.kind!=='members' || e.kind==='faction')) ? ['范围引用未对应在册对象或组织'] : []);
}
export function checkEventContract(event, protocol, world) {
    const errors = [];
    const isNew = ['category','actors','affected','audience','reportedContent','pending'].some(k => event?.[k] !== undefined);
    if (protocol !== undefined && protocol !== EVENT_PROTOCOL) errors.push('eventProtocol 必须为 4');
    if (isNew && protocol !== EVENT_PROTOCOL) errors.push('新事件字段必须声明 eventProtocol:4');
    if (protocol !== EVENT_PROTOCOL) return errors;
    if (typeof event?.pending !== 'boolean') errors.push('新事件 pending 必填 boolean');
    if (['ripples','participantIds','participantNames'].some(k => event?.[k] !== undefined)) errors.push('新旧事件字段不得混合');
    for (const key of ['category','reportedContent']) if (event?.[key] !== undefined && !nonempty(event[key])) errors.push(`${key} 必须为非空原文`);
    if (event?.actors !== undefined && (!Array.isArray(event.actors) || event.actors.some(a => !a || !nonempty(a.name) ||
        Object.keys(a).some(k => !['name','ref'].includes(k)) || (a.ref !== undefined && !nonempty(a.ref))))) errors.push('actors 必须保留原名');
    for (const key of ['affected','audience']) if (event?.[key] !== undefined) errors.push(...checkScopes(event[key],world).map(e => `${key}: ${e}`));
    if (world) {
        const entities=world.entities || [];
        for (const actor of Array.isArray(event?.actors) ? event.actors : []) if (actor?.ref && !entities.some(e=>e.id===actor.ref)) errors.push('当事人引用不在名册，未知名字请只保留 name');
    }
    return errors;
}
export function conditionUpdateErrors(update, world, { resolveEventRef = ref => ref } = {}) {
    if (!update || !['create','state'].includes(update.op)) return ['条件 op 必须为 create/state'];
    const allowed = update.op === 'create' ? ['op','localId','eventRef','statement','state','scope','effectiveFrom','effectiveUntil','supersedes'] : ['op','conditionRef','state','eventRef'];
    const errors = [];
    if (Object.keys(update).some(k => !allowed.includes(k))) errors.push('条件含未知字段');
    const ref = resolveEventRef(update.eventRef);
    if (!nonempty(update.eventRef) || !ref || !(world.events || []).some(e => e.id === ref) && !(world.milestones || []).some(m => (m.ids || []).includes(ref) || (m.rows || []).some(e => e.id === ref))) errors.push('条件原因事件不存在');
    if (update.op === 'create') {
        if (!nonempty(update.localId) || !nonempty(update.statement) || !['planned','active','ended'].includes(update.state)) errors.push('条件创建缺编号、原文或状态');
        if (update.scope !== undefined) errors.push(...checkScopes(update.scope,world));
        for (const k of ['effectiveFrom','effectiveUntil']) if (update[k] !== undefined && !nonempty(update[k])) errors.push(`${k} 必须为时间原话`);
        if (update.supersedes !== undefined && !(world.conditions || []).some(c => c.id === update.supersedes && c.state !== 'ended')) errors.push('替代条件不存在或已结束');
    } else {
        const c = (world.conditions || []).find(c => c.id === update.conditionRef);
        if (!c || c.state === 'ended' || !['active','ended'].includes(update.state) || c.state === update.state) errors.push('条件状态变化不合法');
    }
    return errors;
}
export function applyConditionUpdates(world, updates, { tick = world.meta?.tick ?? 0, resolveEventRef = ref => ref, producer = 'world' } = {}) {
    const result = { applied: [], rejected: [] };
    const locals = new Set();
    let ordinal = 1;
    const record = c => {
        const stateText = {planned:'尚未生效',active:'有效',ended:'已结束'}[c.state];
        const text = `持续条件「${c.statement}」：${stateText}${c.scope?.length ? `；适用范围：${c.scope.map(s => s.text).join('；')}` : ''}`;
        (world.chronicle ||= []).push({ id:`ch_${tick}_condition_${world.chronicle?.length || 0}`, tick, text, kind:'major', eventRef:c.endCause || c.changes?.at(-1)?.eventRef || c.eventRef, producer, recordType:'state' });
    };
    for (const [index, update] of (updates || []).entries()) {
        const errors = conditionUpdateErrors(update, world, { resolveEventRef });
        if (update?.op === 'create' && locals.has(update.localId)) errors.push('条件编号重复');
        if (errors.length) { result.rejected.push({ index, errors, update }); continue; }
        const eventRef = resolveEventRef(update.eventRef);
        const change = c => { c.state = update.op === 'create' ? 'ended' : update.state; (c.changes ||= []).push({ state: c.state, eventRef, tick }); if (c.state === 'ended') c.endCause = eventRef; record(c); };
        if (update.op === 'state') {
            const c = world.conditions.find(c => c.id === update.conditionRef); change(c); result.applied.push(c); continue;
        }
        locals.add(update.localId);
        while ((world.conditions || []).some(c => c.id === `cond_${tick}_${ordinal}`)) ordinal++;
        const c = { id: `cond_${tick}_${ordinal++}`, eventRef, statement: update.statement, state: update.state,
            changes:[{state:update.state,eventRef,tick}] };
        for (const key of ['scope','effectiveFrom','effectiveUntil','supersedes']) if (update[key] !== undefined) c[key] = clone(update[key]);
        if (c.state === 'ended') c.endCause = eventRef;
        if (c.supersedes) change(world.conditions.find(old => old.id === c.supersedes));
        (world.conditions ||= []).push(c); result.applied.push(c); record(c);
    }
    return result;
}
