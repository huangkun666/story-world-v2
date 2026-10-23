// 事件原话、历史范围和持续条件的共同入口。零依赖，不判断故事语义。
export const EVENT_PROTOCOL = 4;
export const actorSchema = {kind:'object',additional:false,required:['name'],props:{name:{kind:'string',minLength:1},ref:{kind:'string',minLength:1}}};
export const scopeSchema = {kind:'object',additional:false,required:['kind','text'],props:{kind:{kind:'string',enum:['entity','members','place','text']},text:{kind:'string',minLength:1},ref:{kind:'string',minLength:1}}};
export const storedScopeSchema = {...scopeSchema,props:{...scopeSchema.props,resolution:{kind:'object',additional:false,required:['knownIds','asOfTick'],props:{knownIds:{kind:'array',items:{kind:'string',minLength:1}},asOfTick:{kind:'number',int:true,min:0}}}}};
// 显式观察元数据（committed state change 的可见性披露）：
//   · 模型面 `observationSchema` = { mode:'encounter'|'known', scope:[scopeSchema] }——**没有** resolution/tick。
//   · 存账面 `storedObservationSchema` = 同上但 scope 用 storedScopeSchema（引擎解析出的历史成员）、
//     并带引擎盖的 `tick`。备份/迁移是可选的：老账没有这一格照常合法。
export const observationSchema = {kind:'object',additional:false,required:['mode','scope'],props:{
    mode:{kind:'string',enum:['encounter','known']},
    scope:{kind:'array',minItems:1,items:scopeSchema}}};
export const storedObservationSchema = {kind:'object',additional:false,required:['mode','scope','tick'],props:{
    mode:{kind:'string',enum:['encounter','known']},
    scope:{kind:'array',minItems:1,items:storedScopeSchema},
    tick:{kind:'number',int:true,min:0}}};
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
/** 显式观察描述的语义校验（模型提议面）。
 *  ★契约（与指挥约定）：它披露的是**已经提交的那份状态/值本身**，不是另编事实、不是摘要。
 *    · `encounter`：观察者在**当下**处于范围内即可见——place 比对正式位置，entity/members 指认对象。
 *    · `known`：已**明确传达**给列出的实体/成员、之后仍可查 ⇒ **不许**用 place/text 范围。
 *    · 未解析的 text / 未知引用**永远不授予权限**；text 单独出现不构成观察，但**可与有效范围并存**
 *      （这一条不许拦：模型常把"说不清的群体"整段保留 text）。
 *    · 范围不能为空；模型不许自带 `resolution` / `tick`（引擎在落账时填）。
 *  `undefined` = 整键省略 = 合法（可选字段）。 */
export function observationErrors(value, world) {
    if (value === undefined) return [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return ['观察描述必须是对象（或整键省略）'];
    for (const key of Object.keys(value)) if (!['mode','scope'].includes(key)) return ['观察描述含未知字段（只认 mode/scope；resolution/tick 由引擎填写）'];
    if (!['encounter','known'].includes(value.mode)) return ['观察 mode 必须为 encounter/known'];
    if (!Array.isArray(value.scope) || value.scope.length === 0) return ['观察范围必须是至少一项的数组'];
    const scopeErrors = checkScopes(value.scope, world);
    if (scopeErrors.length) return scopeErrors;
    if (value.mode === 'known' && value.scope.some(s => s.kind === 'place' || s.kind === 'text')) {
        return ['known 观察只能用 entity/members（place/text 不能满足"明确传达"）'];
    }
    return [];
}
/** 把模型提议的观察描述转成存账形状（引擎落账时调用）。
 *  · `known`：用 `resolveScopes` **在提交那一刻固化成员**（历史会员），之后新增成员不回填。
 *  · `encounter`：**不固化**——原样存范围，投影时按当场成员/位置判定。
 *  · 引擎盖 `tick`；缺席或非法返回 `null`（调用方据此清除/不落这一格）。 */
export function storeObservation(value, world, tick) {
    if (value === undefined || value === null) return null;
    if (observationErrors(value, world).length) return null;
    const scope = value.mode === 'known' ? resolveScopes(value.scope, world, tick) : clone(value.scope);
    return { mode: value.mode, scope, tick };
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
    const allowed = update.op === 'create' ? ['op','localId','eventRef','statement','state','scope','effectiveFrom','effectiveUntil','supersedes','observation'] : ['op','conditionRef','state','eventRef','observation'];
    const errors = [];
    if (Object.keys(update).some(k => !allowed.includes(k))) errors.push('条件含未知字段');
    if (update.observation !== undefined) errors.push(...observationErrors(update.observation, world));
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
    // ★观察描述随每一次 create/state 落账：带就存（known 固化成员），不带就**清除**——
    //   状态后续变化若未续报观察，不许继承旧知识（否则"秘密变了的那份状态"会带着旧可见性漂下去）。
    const applyObs = (c, source) => {
        const obs = source === undefined ? null : storeObservation(source, world, tick);
        if (obs) c.observation = obs; else delete c.observation;
    };
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
            const c = world.conditions.find(c => c.id === update.conditionRef);
            change(c); applyObs(c, update.observation);
            result.applied.push(c); continue;
        }
        locals.add(update.localId);
        while ((world.conditions || []).some(c => c.id === `cond_${tick}_${ordinal}`)) ordinal++;
        const c = { id: `cond_${tick}_${ordinal++}`, eventRef, statement: update.statement, state: update.state,
            changes:[{state:update.state,eventRef,tick}] };
        for (const key of ['scope','effectiveFrom','effectiveUntil','supersedes']) if (update[key] !== undefined) c[key] = clone(update[key]);
        if (c.state === 'ended') c.endCause = eventRef;
        applyObs(c, update.observation);
        if (c.supersedes) {
            const old = world.conditions.find(old => old.id === c.supersedes);
            change(old);
            // ★替代创建结束旧条件：只有这次更新**显式带了观察**才发布旧状态的结束；否则清掉旧描述
            //   （不能让"被替代掉的那份旧状态"继续带着旧可见性留在账上）。
            applyObs(old, update.observation);
        }
        (world.conditions ||= []).push(c); result.applied.push(c); record(c);
    }
    return result;
}
