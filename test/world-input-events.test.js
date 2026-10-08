import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvolutionPack } from '../src/pack.js';
import { gateWorldStep } from '../src/gate.js';
import { dropInvalidProposals } from '../src/sanitize-step.js';
import { judgeRef, captureOpenCauseState, resolveRefTarget } from '../src/ref-rules.js';
import { MAIN_PROMPT } from '../src/prompts.js';
import { diagnostics } from '../src/diagnostics.js';
import { diagTickOutcome } from '../web/diagnostic-transport.js';

const emptyStep = (extra = {}) => ({ actions: [], newEvents: [], agendaAdvances: [],
    newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [], ...extra });
const world = () => ({ version: 1, entities: [
    { id: 'e_a', name: '甲方', kind: 'character', location: '城中' },
    { id: 'e_b', name: '乙方', kind: 'character', location: '城中' },
], context: { world: '测试界', positions: ['城中'] },
    agendas: [], events: [], chronicle: [], milestones: [], weights: {}, meta: { tick: 4 } });

test('完整世界包中本轮聊天结果只提供一次，保留其他世界待办与因果编号', () => {
    const w = world();
    const title = '甲方取得跨城通行许可';
    const result = { id: 'ev_4_500', title, source: { type: 'dialogue' },
        producer: 'chat', recordType: 'result', dialogueKind: 'result',
        ripples: ['e_a'], closed: false, position: '城中', links: { up: [], down: ['ev_4_3'] } };
    w.events.push(result, { id: 'ev_4_3', title: '乙方筹备远行', source: { type: 'ripple', ref: result.id },
        ripples: ['e_b'], closed: false, links: { up: [result.id], down: [] } });
    w.chronicle.push({ id: 'ch_4_dlg_1', tick: 4, text: title, kind: 'major', eventRef: result.id });
    const volumes = [{ fromTick: 1, rows: [{ id: 'cold_result', tick: 1,
        text: title, kind: 'major', eventRef: result.id }] }];
    const before = JSON.stringify(w);
    const built = buildEvolutionPack(w, null, { turnFacts: { events: [result], actedIds: ['e_a'], changedFields: [] },
        volumes, vecRecall: { items: [{ id: 'cold_result', tick: 1, text: title,
            eventRef: result.id, line: title }] } });
    assert.equal(built.text.split(title).length - 1, 1, '不能在待办、编年、向量与线头中重复同一事件正文');
    assert.ok(built.pack.pendingEvents.some((e) => e.id === 'ev_4_3' && e.title === '乙方筹备远行'));
    assert.ok(built.pack.pendingEvents.some((e) => e.id === result.id), '未决义务仍有事件引用');
    assert.equal(JSON.stringify(w), before, '出包不可改真账');
    assert.equal(built.inputStats.duplicates, 0);
});

test('已完成聊天结果不以正文重复进入最近收场及拾遗，后续新世界事件仍保留', () => {
    const w = world();
    const result = { id: 'ev_4_500', title: '甲方取得许可', source: { type: 'dialogue' },
        dialogueKind: 'result', producer: 'chat', recordType: 'result', closed: true,
        closedAt: 4, ripples: ['e_a'], links: { up: [], down: [] } };
    w.events.push(result);
    const built = buildEvolutionPack(w, null, { turnFacts: { events: [result], actedIds: [], changedFields: [] } });
    assert.equal(built.text.split(result.title).length - 1, 1);
    assert.ok(built.pack.recentClosedEvents.some((e) => e.id === result.id && e.closed));
});

test('普通动作没有事件时，独立保护仍拦重复行动及同轮字段改写', () => {
    const w = world();
    w.meta.turnProtection = { tick: 5, actedIds: ['e_a'], participantIds: ['e_b'],
        changedFields: [{ entityId: 'e_a', field: '身份' }] };
    w.events.push({ id: 'ev_3_1', title: '世界旧因', source: { type: 'state' }, closed: false });
    const s = emptyStep({ actions: [{ entity: 'e_a', verb: '再问候' }, { entity: 'e_b', verb: '回应新情况' }],
        entityUpdates: [{ entity: 'e_a', field: '身份', value: '旧身份', cause: { type: 'event', ref: 'ev_3_1' } }] });
    const cleaned = dropInvalidProposals(s, w);
    assert.deepEqual(cleaned.step.actions.map((a) => a.entity), ['e_b']);
    assert.deepEqual(cleaned.step.entityUpdates, []);
    // 门控发生在结算已推进 tick 的工作副本，权限校验和净化发生在推进之前。
    const settling = { ...w, meta: { ...w.meta, tick: 5 } };
    const gated = gateWorldStep(emptyStep({ actions: [{ entity: 'e_b', verb: '回应新情况' }] }), settling);
    assert.equal(gated.step.actions.length, 1, '事件参与者能反应，不依赖未决普通动作');
});

test('上一轮独立保护不限制本轮行动', () => {
    const w = world();
    w.meta.turnProtection = { tick: 3, actedIds: ['e_a'], changedFields: [] };
    assert.equal(dropInvalidProposals(emptyStep({ actions: [{ entity: 'e_a', verb: '新行动' }] }), w).step.actions.length, 1);
});

test('已经发生并闭合的事实与归档事实可作新后果的因，不能重复收场', () => {
    const w = world();
    w.events.push({ id: 'ev_3_1', title: '已取得许可', source: { type: 'dialogue' }, closed: true, closedAt: 3 });
    w.milestones.push({ ids: ['ev_1_9'] });
    for (const ref of ['ev_3_1', 'ev_1_9']) {
        for (const point of ['newAgendas.source', 'newEntities.source', 'entityUpdates.cause', 'relationUpdates.cause']) {
            assert.equal(judgeRef(point, { type: 'event', ref }, { world: w, step: emptyStep(),
                entry: captureOpenCauseState(w) }), null, `${point} 可引用已发生的 ${ref}`);
        }
    }
    assert.ok(judgeRef('eventClosures.event', { type: 'id', ref: 'ev_3_1' }, { world: w, step: emptyStep() }));
    assert.ok(judgeRef('entityUpdates.cause', { type: 'event', ref: 'missing' }, { world: w, step: emptyStep() }));
});

test('世界提示词按结果与保护名单解释输入，不要求读取动作流水账', () => {
    assert.match(MAIN_PROMPT, /turnFacts\.events/);
    assert.match(MAIN_PROMPT, /turnFacts\.actedIds/);
    assert.match(MAIN_PROMPT, /turnFacts\.changedFields/);
    assert.doesNotMatch(MAIN_PROMPT, /turnFacts\.actions/);
    assert.match(MAIN_PROMPT, /已完成.*因果|闭合.*因果/);
    assert.doesNotMatch(MAIN_PROMPT, /不许拿一件早就办完的旧事来解释今天的变化/);
});

test('成功推进也把完整输入统计写进复制报告，默认不记录结果正文', () => {
    diagnostics.clear();
    const inputStats = { selectedIds: ['ev_4_500'], duplicates: 0, chatResultChars: 60 };
    diagTickOutcome({ ok: true, ssot: world(), pack: { inputStats } }, 3);
    const report = JSON.parse(diagnostics.report());
    const row = report.records.find((r) => r.module === '世界输入');
    assert.ok(row, '成功输入不能因为没有拒因而漏记');
    assert.deepEqual(row.data.selectedIds, ['ev_4_500']);
    assert.equal(row.data.duplicates, 0);
    assert.ok(!Object.hasOwn(row.data, 'text'));
    diagnostics.clear();
});

test('归档结果仍可引出世界涟漪；同轮位次别名不能冒充已有归档事实', () => {
    const w = world();
    w.milestones.push({ ids: ['ev_1_1'], rows: [{ id: 'ev_1_1', title: '过去确立的许可' }] });
    assert.equal(judgeRef('newEvents.source', { type: 'ripple', ref: 'ev_1_1' }, { world: w, step: emptyStep() }), null);
    const hit = resolveRefTarget(w, 'ev_1_1', { includeArchived: true, includeSameRound: true,
        step: emptyStep({ newEvents: [{ title: '正在提议的新事', source: { type: 'state' } }] }) });
    assert.equal(hit.archived, true);
    assert.equal(hit.viaSameRound, false);
});
