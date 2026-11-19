import {worldSourceEvidence} from './source-records.js';
import { validateMessageReference, sameMessageVersion, recordConsumption } from './chat-consumption.js';
import { worldTasks } from './world-schedule.js';
import { chronicleOf } from './ledger-recall.js';
import { extractTags } from './tag-extract.js';
import { registerDialogueFacts } from './settle.js';
import { settleWithHealing } from './tick.js';
import { referencedEventsOf, worldInputStats } from './world-input.js';
import { eventDetails, eventEntityIds } from './event-contract.js';
import { checkWorldStep } from './check-step.js';
import { buildEvolutionPack, packTextOf, TOKEN_RATIO } from './pack.js';
import {fieldDefinitionsForEntities,readWorldFieldSchema,worldFieldWritePrompt,maskRetiredWorldFields} from './source-field-table.js';
import {resolveLimits} from './limits.js';
import { assembleMainPrompt } from './prompts.js';
import { sourceWorld } from './source-world.js';
import { observableContext } from './world-visibility.js';

function lastStoryTime(world) {
    if (world.meta?.storyTime) return world.meta.storyTime;
    const history = chronicleOf(world);
    for (let index = history.length - 1; index >= 0; index--) {
        const at = String(history[index].timeMark ?? '').trim();
        if (at) return { at, elapsed: [] };
    }
    return null;
}

function storyTimeForTurn(world, facts, historyAnchor) {
    const saved = lastStoryTime(world) ?? (historyAnchor ? { at: historyAnchor, elapsed: [] } : null);
    const at = facts.endAt ?? facts.lastAt ?? facts.at;
    const duration = facts.elapsedParts;
    const usesFirstMark = facts.at && (facts.at !== at || facts.elapsedAfterAt?.length);
    const start = !saved?.at && usesFirstMark ? { at: facts.at, elapsed: [] } : saved;
    const newAnchor = Boolean(at && at !== start?.at);
    const mayAdvance = duration.length > 0 || Boolean(newAnchor && start?.at);
    let end = start;
    if (newAnchor || (facts.endAt && mayAdvance)) {
        end = { at, elapsed: facts.endAt ? [] : (facts.elapsedAfterAt ?? []) };
    } else if (duration.length) {
        end = { ...start, elapsed: [...(start?.elapsed ?? []), ...duration] };
    }
    return { start, end, mayAdvance };
}

function backstageCharacters(world, tasks, presentIds) {
    const present = new Set(presentIds);
    const entities = new Map((world.entities ?? []).map(entity => [entity.id, entity]));
    const agendas = new Map((world.agendas ?? []).map(agenda => [agenda.id, agenda]));
    const selected = new Map();
    for (const task of tasks) {
        if (task.kind !== 'agenda' || present.has(task.owner)) continue;
        const entity = entities.get(task.owner);
        if (entity?.kind !== 'character') continue;
        if (!selected.has(entity.id)) {
            selected.set(entity.id, {
                id: entity.id,
                name: entity.name,
                ...(entity.location ? { location: entity.location } : {}),
                agendas: [],
            });
        }
        const agenda = agendas.get(task.id);
        selected.get(entity.id).agendas.push({ id: agenda.id, goal: agenda.goal, ...(agenda.stage ? { stage: agenda.stage } : {}) });
    }
    return [...selected.values()];
}

function prepare(world, dialogue, messageRef = null, historyAnchor = null) {
    validateMessageReference(messageRef);
    if (messageRef && (world.meta?.chatConsumption || []).some(r => sameMessageVersion(r, messageRef))) {
        throw new Error('该消息已入账，请核对正式版本');
    }
    const priorIds = new Map(['agenda', 'event', 'condition', 'idle'].map((kind, i) => [kind,
        new Set((world[['agendas', 'events', 'conditions', 'entities'][i]] || []).map(r => r.id))]));
    const facts = extractTags(dialogue, { world, entities: world.entities || [],
        canon: world.context?.setting?.frozen?.canon?.bookEntities || [],
        locations: world.context?.positions || [], playerId: world.context?.playerId || null });
    const clock = storyTimeForTurn(world, facts, historyAnchor);
    const tick = (world.meta?.tick ?? 0) + 1;
    const stats = registerDialogueFacts(world, { facts, dialogue, tick });
    const references = referencedEventsOf(world, facts.references, stats.rejected);
    const turnFacts = { events: stats.resultEvents.map(e => ({ id: e.id, title: e.title,
        ...(e.eventProtocol === 4 ? eventDetails(e) : { participantIds: e.ripples }),
        pending: !e.closed, source: e.source, dialogueKind: e.dialogueKind,
        producer: e.producer, recordType: e.recordType,
        ...(e.position ? { position: e.position } : {}), ...(e.timeMark ? { timeMark: e.timeMark } : {}),
        ...(e.participantNames?.length ? { participantNames: e.participantNames } : {}),
        ...(e.links?.up?.length ? { causeIds: e.links.up } : {}) })),
        actedIds: stats.actedIds, changedFields: stats.changedFields,
        ...(references.length ? { references } : {}),
        ...(facts.elapsed ? { elapsed: facts.elapsed } : {}), ...(facts.at ? { at: facts.at } : {}) };
    world.meta ??= {};
    world.meta.turnProtection = { tick, actedIds: stats.actedIds, changedFields: stats.changedFields,
        participantIds: [...new Set(stats.resultEvents.flatMap(e => eventEntityIds(e, world)))] };
    const move = facts.player ? { verb: facts.player.verb, object: facts.player.targetText,
        location: facts.player.location, attempt: true, note: null, dropped: [], source: 'tag' } : null;
    if (facts.at || facts.endAt || facts.elapsed || facts.presentIds) {
        world.meta.storyTime = clock.end ?? { elapsed: [] };
        if (facts.at || facts.endAt || facts.elapsed) turnFacts.storyTime = clock;
    }
    let tasks = worldTasks(world);
    if (facts.presentIds) {
        const characters = backstageCharacters(world, tasks, facts.presentIds);
        if (characters.length) {
            turnFacts.backstage = { ...clock, characters };
            if (!clock.mayAdvance) {
                const paused = new Set(characters.map(character => character.id));
                world.meta.turnProtection.pausedBackstageIds = [...paused];
                tasks = tasks.filter(task => !paused.has(task.owner));
            }
        }
    }
    tasks = tasks.map(t => priorIds.get(t.kind).has(t.id) ? t : { ...t, origin: 'dialogue' });
    const newRecordIds = ['agendas','events','conditions','entities'].flatMap((table,index) =>
        (world[table] || []).filter(r => !priorIds.get(['agenda','event','condition','idle'][index]).has(r.id)).map(r => r.id));
    return { world, tasks, turnFacts, move, dialogueStats: stats, fieldSchemaRevision:readWorldFieldSchema(world).revision, priorEventIds: [...priorIds.get('event')],newRecordIds };
}

/** 不读写世界账、不调用模型或数据库；所有输出均是候选。 */
export function handleWorldRequest(request) {
    // ★Task 1：**初始化只创建新世界**——它吃的是已发布的固定资料版本（bundle）与调用方选项，
    //   没有、也不需要一份"已有的世界"。故这一支必须排在下面那道 `world is required` 之前：
    //   放到后面就成了"要先有世界才能初始化世界"（自相矛盾），而且会把初始化错判成坏请求。
    if (request?.action === 'initialize') return sourceWorld(request.bundle, request.options);
    if (!request || !request.world || typeof request.world !== 'object' || Array.isArray(request.world)) throw new TypeError('world is required');
    const world = structuredClone(request.world);
    if (request.action === 'observe') return observableContext(world, request.records ?? [], request.maxChars);
    if (request.action === 'tasks') return { tasks: worldTasks(world) };
    if (request.action === 'prepare') {
        if (request.dialogue != null && typeof request.dialogue !== 'string') throw new TypeError('dialogue must be a string');
        return prepare(world, request.dialogue ?? '', request.message_ref ?? null, request.history_time_anchor);
    }
    if (request.action === 'settle') {
        if(request.field_schema_revision!==undefined&&request.field_schema_revision!==readWorldFieldSchema(world).revision)throw Error('任务字段表修订不匹配，拒绝旧权限写入');
        const check = checkWorldStep(request.step, world);
        if (!check.ok) throw new Error(check.errors.join('; '));
        validateMessageReference(request.message_ref);
        const result = settleWithHealing({ ssot: world, step: request.step, moveFact: request.move ?? null, archiveEvents: false, world_view: request.world_view });
        if (result.ok) {
            const existing = new Set([...(world.events || []).map(e=>e.id),
                ...(world.milestones || []).flatMap(m=>[...(m.ids || []),...(m.rows || []).map(e=>e.id)])]);
            // Producer is engine-owned. Newly settled world results differ from the dialogue
            // facts already present in prepared.world; neither model text nor query grants origin.
            for (const event of [...(result.ssot.events || []),...(result.ssot.milestones || []).flatMap(m=>m.rows || [])]) {
                if (!existing.has(event.id)) {event.producer='world';event.recordType='result'}
            }
            recordConsumption(result.ssot, { world, messageRef: request.message_ref,
                result: { dialogueStats: request.dialogueStats }, priorEventIds: request.prior_event_ids ?? null });
        }
        return result;
    }
    if (request.action === 'pack') {
        const turnFacts = structuredClone(request.turnFacts ?? {});
        const references = new Map((turnFacts.references || []).map(e => [e.id, e]));
        const localIds = new Set((turnFacts.events || []).map(e => e.id));
        for (const record of request.records || []) {
            if (record.record_kind === 'event' && record.id && !localIds.has(record.id)) {
                const archived=referencedEventsOf(world,[record.id]).find(row=>row.archived);
                references.set(record.id,archived?{...record,archived:true,lifecycleKnown:archived.lifecycleKnown,...(archived.lifecycleKnown?{pending:false}:{pending:undefined})}:record);
            }
        }
        if (references.size) turnFacts.references = [...references.values()];
        const packed = buildEvolutionPack(world, request.move ?? null, {
            turnFacts: Object.keys(turnFacts).length ? turnFacts : null,
            volumes: request.volumes ?? null,
            vecRecall: request.recall ?? null,
            // ★Task 2：主包必须把**这个世界的生效尺度**递进去——否则账上设的
            //   递线/冷门名单/包预算全在这条路上落空（走的是出厂默认），
            //   面板与真包就成了"一个数两把尺子"（本仓老病）。
            lim: resolveLimits(world),
        });
        // Whole canonical records preserve source originals and historical facts. Current state still
        // comes from the fixed world above; retrieved records are evidence, never new turn results.
        const selected=[],omitted=[];
        const budget=resolveLimits(world).包预算;
        for(const record of request.records || []) {
            if(record.record_kind==='event')continue;
            const evidence=worldSourceEvidence(record);
            const candidate={...packed.pack,'固定版本资料':[...selected,evidence]};
            if(Math.ceil(packTextOf(candidate).length/TOKEN_RATIO)<=budget)selected.push(evidence);
            else omitted.push(record.id);
        }
        if(selected.length)packed.pack['固定版本资料']=selected;
        // Definitions accompany only entity values actually present in this request.
        const fieldEntities=[...(packed.pack.entities??[]),...selected.filter(row=>row.record_kind==='entity')];
        const definitions=readWorldFieldSchema(world).fields.filter(f=>f.enabled!==false&&fieldEntities.some(e=>f.kinds.includes(e.kind)&&
            (Object.hasOwn(e,f.name)||Object.hasOwn(e,f.storageKey)||Object.hasOwn(e.fields??{},f.storageKey)||Object.hasOwn(e.attributes??{},f.name)))).map(({name,meaning,kinds})=>({name,meaning,kinds}));
        const included=[];
        for(const definition of definitions){
            const candidate={...packed.pack,'字段含义':[...included,definition]};
            if(Math.ceil(packTextOf(candidate).length/TOKEN_RATIO)<=budget)included.push(definition);
            else omitted.push('field:'+definition.name);
        }
        if(included.length)packed.pack['字段含义']=included;
        packed.text=packTextOf(packed.pack);
        const baseTokens=packed.estTokens;packed.estTokens=Math.ceil(packed.text.length/TOKEN_RATIO);
        if(Number.isFinite(packed.estBeforeTrim))packed.estBeforeTrim+=Math.max(0,packed.estTokens-baseTokens);
        if(packed.inputStats)packed.inputStats=worldInputStats(packed.pack,packed.text);
        return { ...packed, fieldSchemaRevision:readWorldFieldSchema(world).revision, limited:omitted.length>0, omitted, prompt: assembleMainPrompt(packed)+(selected.length?'\n\n固定版本资料是该版本已有的完整记录与来源原文，供核对因果；以正式世界当前状态为准，不得把历史资料当成本轮新事件。':'') };
    }
    throw new Error(`unsupported action: ${request.action}`);
}
