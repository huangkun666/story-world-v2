// 聊天投影只读正式事件；知情依据来自已保存的身份与范围，不猜原文语义。
import { currentScopeIds } from './event-contract.js';
import { resolvePlace } from './geography.js';
import { eventBornTick } from './setting.js';

const copyFields = (row, keys) => Object.fromEntries(keys.filter(k => row[k] !== undefined).map(k => [k, structuredClone(row[k])]));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

function eventBasis(row, world, observer) {
    if (row.eventProtocol !== 4 || row.participantMode === 'legacy') return null;
    if ((row.actors || []).some(actor => actor.ref === observer.id)) return 'participant';
    const geography = world.context?.setting?.frozen?.canon?.geography;
    for (const scope of row.audience || []) {
        if (['entity', 'members'].includes(scope.kind)) {
            // 历史成员名单固定；新加入组织不能使旧公开记录倒生知情。
            const ids = scope.resolution?.knownIds ?? (scope.kind === 'entity' ? currentScopeIds([scope], world) : []);
            if (ids.includes(observer.id)) return 'audience';
        }
        // 当前地点只证明当轮在场；后来到达不能授予历史事件的知情。
        if (scope.kind === 'place' && Number.isSafeInteger(world.meta?.tick)
            && eventBornTick(row.id) === world.meta.tick) {
            const location = resolvePlace(geography, observer.location), target = resolvePlace(geography, scope.text);
            if (location.status === 'matched' && target.status === 'matched' && location.place.id === target.place.id) return 'public-place';
        }
    }
    return null;
}

function projectEvent(row, basis) {
    const published = basis !== 'participant' && nonempty(row.reportedContent);
    const item = copyFields(row, ['id', 'timeMark']);
    item.record_kind = 'event';
    item.title = published ? row.reportedContent : row.title;
    item.knowledge_basis = basis;
    item.content_kind = published ? 'reported' : 'fact';
    // 发布说法的受众并没有取得真实当事人、位置、原因和收场状态。
    if (!published) Object.assign(item, copyFields(row, ['position', 'category', 'actors', 'closed', 'closedAt', 'proseQuote']));
    return item;
}

/** 全文条目逐件装包；隐藏项只报告原因计数，不回传身份或内容。 */
export function observableContext(world, records, maxChars) {
    if (!Number.isSafeInteger(maxChars) || maxChars < 0) throw new TypeError('maxChars must be an explicit nonnegative safe integer');
    if (!Array.isArray(records)) throw new TypeError('records must be an array');
    const observer = (world.entities || []).find(entity => entity.id === world.context?.playerId);
    const result = { purpose: 'chat', observer_id: observer?.id ?? null, records: [], text: '', omitted: [], excluded: {} };
    if (!observer) return { ...result, reason: 'observer-unavailable' };
    const reject = reason => { result.excluded[reason] = (result.excluded[reason] || 0) + 1; };
    const unique = new Map();
    for (const row of records) if (row && nonempty(row.id) && !unique.has(`${row.record_kind}:${row.id}`)) unique.set(`${row.record_kind}:${row.id}`, row);
    const projections = [], visibleFacts = new Set();
    for (const row of unique.values()) {
        if (row.record_kind !== 'event') continue;
        const basis = eventBasis(row, world, observer);
        if (!basis) { reject('visibility-unconfirmed'); continue; }
        const item = projectEvent(row, basis);
        projections.push(item);
        if (item.content_kind === 'fact') visibleFacts.add(row.id);
    }
    for (const row of unique.values()) {
        if (row.record_kind === 'event') continue;
        if (row.record_kind !== 'condition') { reject('unsupported-chat-record'); continue; }
        const causes = [row.eventRef, row.endCause, ...(row.changes || []).map(change => change.eventRef)].filter(Boolean);
        const explicit = observationBasis(row.observation,world,observer);
        const basis = explicit || (row.observation === undefined && causes.length && causes.every(ref => visibleFacts.has(ref)) ? 'visible-causes' : null);
        if (!basis) { reject('visibility-unconfirmed'); continue; }
        projections.push({ ...copyFields(row, ['id', 'statement', 'state', 'effectiveFrom', 'effectiveUntil']),
            record_kind: 'condition', knowledge_basis: basis });
    }
    // 关系引用不自动授予知情；原文主记录完整，内部出处和不可见原因不复制。
    for (const item of projections) {
        const line = JSON.stringify(item), extra = (result.text ? 1 : 0) + line.length;
        if (result.text.length + extra > maxChars) {
            result.omitted.push({ id: item.id, record_kind: item.record_kind, reason: 'whole-record-budget', chars: line.length });
            continue;
        }
        result.records.push(item);
        result.text += (result.text ? '\n' : '') + line;
    }
    return result;
}

// State is read directly from the pinned canonical world, independently of search hits.
// Only exact committed values are projected; causes, previous private values and plans stay internal.
export const STATE_CONTEXT_INSTRUCTION = '【当前可见状态】以下是正式世界当前已成立、在相关场景可观察或已明确传达的事实。同一对象同一字段以此现值描述当前情况；planned 尚未生效，ended 已结束。变化已经发生，不要再次执行。按本次交互自然表现持续影响，不必逐条播报；未提供的原因保持未知，不替玩家行动。encounter 是可在场景中发现；on-arrival 仅在到达 observe_at 后可呈现，不能据此认定玩家已到达或已经获知。\n';

function samePlace(world, left, right) {
    const geography = world.context?.setting?.frozen?.canon?.geography;
    const a = resolvePlace(geography, left), b = resolvePlace(geography, right);
    if (a.status === 'matched' && b.status === 'matched') return a.place.id === b.place.id;
    if (a.status === 'ambiguous' || b.status === 'ambiguous') return false;
    // Exact formally recorded free-text locations are usable without inventing aliases.
    return nonempty(left) && left === right && left !== '未明'
        && (world.context?.positions || []).filter(p => p === left).length === 1;
}

function delimited(query, value) {
    if (!nonempty(query) || !nonempty(value)) return false;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,'u').test(query);
}

function sceneIds(world, observer, query) {
    const ids = new Set([observer.id]), names = new Map();
    for (const entity of world.entities || []) {
        if (samePlace(world, observer.location, entity.location)) ids.add(entity.id);
        for (const name of [entity.name, ...(entity.aliases || [])].filter(nonempty)) {
            const matches = names.get(name) || new Set(); matches.add(entity.id); names.set(name, matches);
        }
        if (delimited(query,entity.id)) ids.add(entity.id);
    }
    for (const [name, matches] of names) {
        const han = /\p{Script=Han}/u.test(name);
        const mentioned = han && [...name].length > 1 ? nonempty(query) && query.includes(name) : delimited(query,name);
        if (matches.size === 1 && mentioned) ids.add([...matches][0]);
    }
    return ids;
}

function namedPlace(world, value, query) {
    if (!nonempty(query)) return false;
    const geography = world.context?.setting?.frozen?.canon?.geography;
    const target = resolvePlace(geography,value);
    if (target.status === 'ambiguous') return false;
    if (target.status === 'matched') return [target.place.name,...(target.place.aliases || [])].some(name => {
        const match = resolvePlace(geography,name);
        return nonempty(name) && query.includes(name) && match.status === 'matched' && match.place.id === target.place.id;
    });
    return value !== '未明' && (world.context?.positions || []).filter(p => p === value).length === 1 && query.includes(value);
}

function observationBasis(value, world, observer, query = '') {
    if (!value || !['encounter','known'].includes(value.mode) || !Number.isSafeInteger(value.tick)
        || value.tick < 0 || !Array.isArray(value.scope) || !value.scope.length) return null;
    for (const scope of value.scope) {
        if (value.mode === 'known') {
            if (!['entity','members'].includes(scope.kind)) continue;
            const ids = scope.resolution?.knownIds ?? (scope.kind === 'entity' ? currentScopeIds([scope], world) : []);
            if (ids.includes(observer.id)) return 'communicated';
        } else {
            if (['entity','members'].includes(scope.kind) && currentScopeIds([scope], world).includes(observer.id)) return 'encounter';
            if (scope.kind === 'place' && samePlace(world, observer.location, scope.text)) return 'encounter';
        }
    }
    if (value.mode === 'encounter' && value.scope.some(s => s.kind === 'place' && namedPlace(world,s.text,query))) return 'on-arrival';
    return null;
}

function encounterLocation(value, world, query) {
    return value?.scope?.find(s => s.kind === 'place' && namedPlace(world,s.text,query))?.text;
}

function relevantCondition(row, world, observer, targets, query) {
    if (!row.scope?.length) return true;
    for (const scope of row.scope) {
        if (['entity','members'].includes(scope.kind)
            && (targets.has(scope.ref) || currentScopeIds([scope], world).some(id => targets.has(id)))) return true;
        if (scope.kind === 'place') {
            if (samePlace(world, observer.location, scope.text)) return true;
            // A communicated condition can be recalled when asking about its named place.
            if (row.observation && namedPlace(world,scope.text,query)) return true;
        }
    }
    return false;
}

export function observableStateContext(world, records, maxChars, {query = ''} = {}) {
    if (!Number.isSafeInteger(maxChars) || maxChars < 0) throw new TypeError('maxChars must be an explicit nonnegative safe integer');
    if (!Array.isArray(records)) throw new TypeError('records must be an array');
    const observer = (world.entities || []).find(e => e.id === world.context?.playerId);
    const result = {purpose:'chat', observer_id:observer?.id ?? null, records:[], text:'', omitted:[], limited:false};
    if (!observer) return {...result, reason:'observer-unavailable'};
    if (maxChars === 0) return result;
    const targets = sceneIds(world, observer, query), events = new Map();
    for (const row of [...records, ...(world.events || []).map(e => ({...e, record_kind:'event'})),
        ...(world.milestones || []).flatMap(m => (m.rows || []).map(e => ({...e, record_kind:'event'})))]) {
        if (row.record_kind === 'event' && nonempty(row.id) && !events.has(row.id)) events.set(row.id, row);
    }
    const visibleFacts = new Set();
    for (const row of events.values()) {
        const basis = eventBasis(row, world, observer);
        if (basis && projectEvent(row, basis).content_kind === 'fact') visibleFacts.add(row.id);
    }
    const projected = [];
    for (const row of world.conditions || []) {
        let basis = observationBasis(row.observation, world, observer, query);
        if (!basis && row.observation === undefined) {
            const causes = [row.eventRef, row.endCause, ...(row.changes || []).map(c => c.eventRef)].filter(Boolean);
            if (causes.length && causes.every(id => visibleFacts.has(id))) basis = 'visible-causes';
        }
        if (!basis || !relevantCondition(row, world, observer, targets, query)) continue;
        projected.push({...copyFields(row,['id','statement','state','effectiveFrom','effectiveUntil']),
            record_kind:'condition', knowledge_basis:basis, content_kind:'fact',
            ...(row.observation ? {changed_at_tick:row.observation.tick} : {}),
            ...(basis === 'on-arrival' ? {observe_at:encounterLocation(row.observation,world,query)} : {})});
    }
    for (const entity of world.entities || []) {
        for (const [field, saved] of Object.entries(world.meta?.entityFields?.[entity.id]?.fields || {})) {
            const basis = observationBasis(saved.observation, world, observer, query);
            if (!targets.has(entity.id) && !(basis === 'on-arrival' && samePlace(world,entity.location,encounterLocation(saved.observation,world,query)))) continue;
            if (!basis || saved.source !== '变更' || !Object.hasOwn(entity,field)
                || !['string','number','boolean'].includes(typeof entity[field])
                || JSON.stringify(saved.value) !== JSON.stringify(entity[field])) continue;
            projected.push({id:entity.id, record_kind:'entity-state', name:entity.name, field, value:entity[field],
                changed_at_tick:saved.tick, knowledge_basis:basis, content_kind:'fact',
                ...(basis === 'on-arrival' ? {observe_at:encounterLocation(saved.observation,world,query)} : {})});
        }
    }
    for (const row of world.relations || []) {
        const basis = observationBasis(row.observation, world, observer, query);
        if (!targets.has(row.from) && !targets.has(row.to) && !['encounter','on-arrival'].includes(basis)) continue;
        if (!basis) continue;
        const from = (world.entities || []).find(e => e.id === row.from), to = (world.entities || []).find(e => e.id === row.to);
        if (!from || !to) continue;
        projected.push({id:row.id, record_kind:'relation', from:row.from, from_name:from.name, to:row.to, to_name:to.name,
            type:row.type, state:row.endedTick == null ? 'active' : 'ended', changed_at_tick:row.endedTick ?? row.tick,
            knowledge_basis:basis, content_kind:'fact',
            ...(basis === 'on-arrival' ? {observe_at:encounterLocation(row.observation,world,query)} : {})});
    }
    for (const row of events.values()) {
        if (row.producer !== 'world' || eventBornTick(row.id) !== world.meta?.tick) continue;
        const basis = eventBasis(row, world, observer);
        if (basis) projected.push(projectEvent(row,basis));
    }
    for (const item of projected) {
        const line = JSON.stringify(item), prefix = result.text ? '\n' : STATE_CONTEXT_INSTRUCTION;
        if (result.text.length + prefix.length + line.length > maxChars) {
            result.omitted.push({id:item.id,record_kind:item.record_kind,reason:'whole-record-budget'});
            result.limited = true; result.reason = 'state-budget'; continue;
        }
        result.records.push(item); result.text += prefix + line;
    }
    return result;
}
