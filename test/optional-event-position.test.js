import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWorldStep } from '../src/check-step.js';
import { dropInvalidProposals } from '../src/sanitize-step.js';
import { emptyStep, runTick, settleWithHealing } from '../src/tick.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { buildEvolutionPack, packTextOf } from '../src/pack.js';
import { unrestPlaces } from '../src/unrest.js';
import { MAIN_PROMPT } from '../src/prompts.js';

const world = () => ({
    version: 1,
    context: { world: '测试世界', tension: 0.5, positions: ['大营'] },
    entities: [{ id: 'e_a', kind: 'character', name: '甲', location: '大营', lastActiveTick: 0 }],
    weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0, simLog: [] },
});
const rumor = () => ({ title: '关于大雷音寺魔气外泄的流言传到了黄坤耳中', source: { type: 'state' }, ripples: ['e_a'] });

test('合法新事件省略位置可以校验，不产生 undefined 位置警告', () => {
    const step = { ...emptyStep(), newEvents: [rumor()] };
    const r = checkWorldStep(step, world());
    assert.equal(r.ok, true, r.errors.join('; '));
    assert.deepEqual(r.warnings, []);
    assert.equal(Object.hasOwn(step.newEvents[0], 'position'), false);
});

test('净化其他非法提议时保留缺位置事件和原始输入', () => {
    const step = { ...emptyStep(), newEvents: [rumor(), { source: { type: 'state' } }] };
    const before = structuredClone(step);
    const r = dropInvalidProposals(step, world());
    assert.deepEqual(r.step.newEvents, [rumor()]);
    assert.equal(r.dropped.length, 1);
    assert.match(r.dropped[0].reason, /标题/);
    assert.deepEqual(step, before);
});

test('唯一的合法提议缺位置也正常推进，落账不补玩家位置或占位值', () => {
    const w = world();
    const before = structuredClone(w);
    const r = settleWithHealing({ ssot: w, step: { ...emptyStep(), newEvents: [rumor()] } });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.equal(r.healed.used, false);
    assert.equal(r.ssot.meta.tick, 1);
    assert.equal(r.ssot.events.length, 1);
    assert.equal(Object.hasOwn(r.ssot.events[0], 'position'), false);
    assert.deepEqual(w, before);
    const shape = validate(r.ssot, ssotSchema);
    assert.equal(shape.ok, true, shape.errors.join('; '));
    const row = r.ssot.chronicle.find(c => c.eventRef === r.ssot.events[0].id);
    assert.ok(row.text.includes(rumor().title));
    assert.equal(/undefined|事发|大营/.test(row.text), false, row.text);
    assert.equal(unrestPlaces(r.ssot), 0, '缺位置事件不凭空增加乱象地点数');
    const pack = buildEvolutionPack(r.ssot, null).pack;
    assert.equal(pack.pendingEvents.some(e => e.title === rumor().title), true);
    assert.equal(packTextOf(pack).includes(rumor().title), true);
    assert.equal(packTextOf(pack).includes('undefined'), false);
});

test('真实演算入口接受缺位置事件，不进入丢弃重试', async () => {
    const r = await runTick({
        ssot: world(), dialogue: '（继续）',
        transport: async () => ({ text: JSON.stringify({ ...emptyStep(), newEvents: [rumor()] }) }),
    });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.ssot.meta.tick, 1);
    assert.equal(r.ssot.events.some(e => e.title === rumor().title), true);
    assert.deepEqual(r.healed.dropped, []);
    assert.equal(r.healed.used, false);
});

test('混合响应清理坏提议后，缺位置的事件及其同轮盘算仍落账', () => {
    const step = {
        ...emptyStep(), newEvents: [rumor()],
        newAgendas: [
            { entity: 'e_a', goal: '追查流言', visibility: 'known', source: { type: 'event', ref: 'ev_1_1' } },
            { entity: 'e_a', goal: '非法提议', visibility: 'known', source: { type: 'state' }, unknownField: true },
        ],
    };
    const r = settleWithHealing({ ssot: world(), step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.equal(r.healed.used, true);
    assert.equal(r.ssot.events.length, 1);
    assert.equal(r.ssot.agendas.some(a => a.goal === '追查流言' && a.source.ref === r.ssot.events[0].id), true);
    assert.equal(r.healed.dropped.length, 1);
    assert.equal(r.healed.dropped[0].family, 'newAgendas');
});

test('写明的集外地点仍归一、照收、留痕，乱象按真实地点统计', () => {
    const r = settleWithHealing({ ssot: world(), step: {
        ...emptyStep(), newEvents: [{ ...rumor(), position: ' 大雷音寺（推）' }],
    } });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.equal(r.ssot.events[0].position, '大雷音寺');
    assert.ok(r.stage.warnings.some(w => w.startsWith('位置集外:')));
    assert.equal(unrestPlaces(r.ssot), 1);
});

test('位置可省不放宽事件身份、来源及填写位置时的形状要求', () => {
    for (const bad of [
        { title: '无源事件' }, { source: { type: 'state' } },
        { ...rumor(), position: null }, { ...rumor(), position: 42 }, { ...rumor(), position: '' },
    ]) {
        const w = world();
        const r = settleWithHealing({ ssot: w, step: { ...emptyStep(), newEvents: [bad] } });
        assert.equal(r.ok, false, JSON.stringify(bad));
        assert.equal(r.ssot.meta.tick, 0);
        assert.deepEqual(r.ssot, w);
    }
});

test('主提示词明确新事件位置可省，无法确定不猜地点', () => {
    assert.match(MAIN_PROMPT, /newEvents\[\]\.position[^\n]*可省/);
    assert.match(MAIN_PROMPT, /无法确定[^\n]*省略[^\n]*猜/);
});

test('明确填写的位置归一后为空时先拒绝，且不修改模型提议', () => {
    for (const position of ['   ', '（推）', ' （推） ']) {
        const step = { ...emptyStep(), newEvents: [{ ...rumor(), position }] };
        const before = structuredClone(step);
        const r = checkWorldStep(step, world());
        assert.equal(r.ok, false, JSON.stringify({ position, result: r }));
        assert.ok(r.errors.some(e => e.includes('newEvents[0].position')));
        assert.deepEqual(step, before);
    }
});

test('清理空白地点与其它非法提议后，合法缺位置事件仍推进落账', () => {
    for (const position of ['   ', '（推）', ' （推） ']) {
        const step = {
            ...emptyStep(), newEvents: [rumor(), { ...rumor(), title: '非法空白地点', position }],
            newAgendas: [{ entity: 'e_a', goal: '非法盘算', visibility: 'known', source: { type: 'state' }, unknownField: true }],
        };
        const before = structuredClone(step);
        const r = settleWithHealing({ ssot: world(), step });
        assert.equal(r.ok, true, r.stage.warnings.join('; '));
        assert.equal(r.ssot.meta.tick, 1);
        assert.deepEqual(r.ssot.events.map(e => e.title), [rumor().title]);
        assert.equal(Object.hasOwn(r.ssot.events[0], 'position'), false);
        assert.ok(r.healed.dropped.some(d => d.label === '非法空白地点' && d.reason.includes('位置')));
        assert.equal(r.healed.dropped.some(d => d.label === rumor().title), false);
        assert.deepEqual(step, before);
    }
});
