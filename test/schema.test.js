// story-world-v2/test/schema.test.js
// 校验器自身单测 + 双 schema 的"非法文档被拒"测试（S2 验收）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { worldStepSchema } from '../src/schemas/world-step.schema.js';

// ---------- 校验器规则 ----------

const tiny = {
    kind: 'object',
    additional: false,
    required: ['a'],
    props: {
        a: { kind: 'number', int: true, min: 1 },
        b: { kind: 'string', enum: ['x', 'y'] },
        c: { kind: 'array', minItems: 1, items: { kind: 'boolean' } },
        d: { kind: 'numRecord' },
    },
};

test('校验器：合法文档通过', () => {
    const r = validate({ a: 2, b: 'x', c: [true], d: { k: 1.5 } }, tiny);
    assert.equal(r.ok, true);
    assert.deepEqual(r.errors, []);
});

test('校验器：必填缺失/类型错/枚举外/未知字段/数组界/整数界 全量报错', () => {
    const r = validate({ a: 0.5, b: 'z', c: [], d: { k: 's' }, e: 1 }, tiny);
    assert.equal(r.ok, false);
    const joined = r.errors.join('\n');
    assert.ok(joined.includes('$.a: 期望整数') || joined.includes('$.a: 小于 1'));
    assert.ok(joined.includes('$.b: 枚举外值 "z"'));
    assert.ok(joined.includes('$.c: 少于 1 项'));
    assert.ok(joined.includes('$.d.k: 期望数字'));
    assert.ok(joined.includes('$.e: 未知字段'));
});

test('校验器：缺失必填单独列出', () => {
    const r = validate({}, tiny);
    assert.ok(r.errors.includes('$.a: 必填缺失'));
});

// ---------- SSOT schema ----------

test('SSOT schema：无源事件被拒（§4.2）', () => {
    const doc = {
        version: 1,
        context: { world: '临渊城', tension: 0.5, positions: ['临渊城'] },
        entities: [{ id: 'e1', kind: 'faction', name: 'A', location: '临渊城', attrs: {} }],
        weights: {},
        agendas: [{ id: 'a1', owner: 'e1', goal: 'g', stage: 's', visibility: 'known', maxSteps: 2, progress: 0, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } }],
        events: [{ id: 'ev1', title: '空降事件', position: '临渊城' }],   // 无 source
        chronicle: [],
        meta: { tick: 1 },
    };
    const r = validate(doc, ssotSchema);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.includes('$.events[0].source: 必填缺失')), r.errors.join('; '));
});

test('SSOT schema：事件源类型枚举外被拒', () => {
    const base = {
        version: 1,
        context: { world: '临渊城', tension: 0.5, positions: ['临渊城'] },
        entities: [{ id: 'e1', kind: 'character', name: 'A', location: '临渊城', attrs: {} }],
        weights: {},
        agendas: [],
        events: [{ id: 'ev1', title: 't', source: { type: 'magic' }, position: '临渊城' }],
        chronicle: [],
        meta: { tick: 1 },
    };
    const r = validate(base, ssotSchema);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => e.includes('枚举外值 "magic"')));
});

test('SSOT schema：盘算缺 maxSteps 被拒（§4.5 三必须）', () => {
    const base = {
        version: 1,
        context: { world: '临渊城', tension: 0.5, positions: ['临渊城'] },
        entities: [{ id: 'e1', kind: 'faction', name: 'A', location: '临渊城', attrs: {} }],
        weights: {},
        agendas: [{ id: 'a1', owner: 'e1', goal: 'g', stage: 's', visibility: 'known', progress: 0, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } }],
        events: [],
        chronicle: [],
        meta: { tick: 1 },
    };
    const r = validate(base, ssotSchema);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => e.includes('$.agendas[0].maxSteps: 必填缺失')));
});

test('SSOT schema：顶层未知字段被拒', () => {
    const base = {
        version: 1,
        context: { world: '临渊城', tension: 0.5, positions: ['临渊城'] },
        entities: [{ id: 'e1', kind: 'faction', name: 'A', location: '临渊城', attrs: {} }],
        weights: {},
        agendas: [],
        events: [],
        chronicle: [],
        meta: { tick: 1 },
        stray: true,
    };
    const r = validate(base, ssotSchema);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => e.includes('$.stray: 未知字段')));
});

test('SSOT schema：盘算 closed 可选、meta.simLog 记账合法', () => {
    const doc = {
        version: 1,
        context: { world: '临渊城', tension: 0.5, positions: ['临渊城'] },
        entities: [{ id: 'e1', kind: 'faction', name: 'A', location: '临渊城', attrs: {} }],
        weights: {},
        agendas: [{ id: 'a1', owner: 'e1', goal: 'g', stage: 's', visibility: 'known', maxSteps: 2, progress: 2, closed: true, memory: { promises: [], done: [], blocked: [], turnsAlive: 2 } }],
        events: [],
        chronicle: [],
        meta: { tick: 1, simLog: [{ tick: 1, packTokens: 100, ssotBytes: 200, events: 1, chronicle: 2, calls: 1, warnings: [] }] },
    };
    const r = validate(doc, ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
});

// ---------- 世界步 schema（提案形状） ----------

test('世界步 schema：合法世界步通过', () => {
    const step = {
        actions: [{ entity: 'e_merchant', verb: '循商路北上', position: '商路' }],
        newEvents: [{ title: '边关扣货', source: { type: 'state' }, position: '边关', ripples: ['e_merchant'] }],
        agendaAdvances: [{ agendaId: 'a_1', step: '守将首肯，车队放行', stage: '过边关' }],
        stateChanges: [{ entity: 'e_merchant', attr: 'network', delta: 0.05 }],
        newAgendas: [], agendaCancels: [],
    };
    const r = validate(step, worldStepSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
});

test('世界步 schema：事件缺源被拒、未知字段被拒', () => {
    const bad = {
        actions: [],
        newEvents: [{ title: 't', position: '边关' }],   // 缺 source
        agendaAdvances: [],
        stateChanges: [],
        newAgendas: [], agendaCancels: [],
        magic: 1,
    };
    const r = validate(bad, worldStepSchema);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => e.includes('$.newEvents[0].source: 必填缺失')));
    assert.ok(r.errors.some(e => e.includes('$.magic: 未知字段')));
});