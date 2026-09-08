// story-world-v2/test/gate.test.js
// K2 验收（分量引擎细案 §3.2/§4 K2）：静默判定与滤除、触发例外（被点名可应答）、再判定、
// top-1 永不静默、静默方为合法客体、双面无痕、P3（pack 不含分量）、确定性、schema 审计字段。
// 夹具：gated-world.json（分量差三实体：0.9/0.5/0.1；未决事件 ev_p 点名 e_mid；e_lo 恒低于人物阈值 0.25）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settleTick } from '../src/settle.js';
import { gateWorldStep, SILENCE_THRESHOLD } from '../src/gate.js';
import { buildEvolutionPack } from '../src/pack.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

const GATED = JSON.parse(readFileSync(new URL('./fixtures/gated-world.json', import.meta.url), 'utf8'));

// 全员提案的世界步：e_hi/e_mid/e_lo 各行动 + 各推盘算 + a_hi/a_lo 各出 plot 事件 + 一条波及
const busyStep = () => ({
    actions: [
        { entity: 'e_hi', verb: '调兵', target: 'e_mid', position: '边城' },
        { entity: 'e_mid', verb: '巡营', position: '边城' },
        { entity: 'e_lo', verb: '请战', position: '大营' },
    ],
    newEvents: [
        { title: '整军有成', source: { type: 'plot', ref: 'a_hi' }, position: '边城', ripples: ['e_hi', 'e_mid'] },
        { title: '毛遂自荐', source: { type: 'plot', ref: 'a_lo' }, position: '大营', ripples: ['e_lo'] },
        { title: '军心浮动', source: { type: 'ripple', ref: 'ev_p' }, position: '大营', ripples: ['e_mid'] },
    ],
    agendaAdvances: [
        { agendaId: 'a_hi', step: '三营集结完毕', stage: '就绪' },
        { agendaId: 'a_mid', step: '布防完成', stage: '就绪' },
        { agendaId: 'a_lo', step: '自荐成功', stage: '上前' },
    ],
    stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
});

test('门控：低分量静默滤除（行动/推进/plot 事件零落账），高/中正常', () => {
    const r = settleTick({ ssot: GATED, step: busyStep() });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.deepEqual(r.stage.warnings, [], '静默滤除不是警告');
    const w = r.ssot;
    assert.deepEqual(w.meta.simLog[0].silent, ['e_lo'], '王小卒静默');
    assert.deepEqual(w.meta.simLog[0].lifted, [], 'ev_p 点名的是 e_mid，e_mid 本不静默');
    assert.deepEqual(w.meta.simLog[0].silentDropped, { e_lo: 3 }, '行动+推进+plot 事件各 1 → 共 3 条滤除');
    assert.equal(w.agendas.find((a) => a.id === 'a_hi').progress, 1, '高分量推进');
    assert.equal(w.agendas.find((a) => a.id === 'a_mid').progress, 1, '中分量推进');
    assert.equal(w.agendas.find((a) => a.id === 'a_lo').progress, 0, '静默方盘算不被推进');
    assert.equal(w.events.length, 3, 'a_hi plot + a_lo plot 被滤 + 波及 = 2 条新事件 → 总计 1+2');
    assert.ok(w.events.some((e) => e.title === '整军有成'));
    assert.ok(w.events.some((e) => e.title === '军心浮动'));
    assert.ok(!w.events.some((e) => e.title === '毛遂自荐'), '静默方 plot 事件不落账');
    const vr = validate(w, ssotSchema);
    assert.equal(vr.ok, true, `审计字段过 schema: ${vr.errors.join('; ')}`);
});

test('门控：触发例外（被点名可应答）——ev_p 点名 e_lo 时解除静默', () => {
    const world = structuredClone(GATED);
    world.events[0].ripples = ['e_lo']; // 未决事件波及点名王小卒
    const r = settleTick({ ssot: world, step: busyStep() });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const w = r.ssot;
    assert.deepEqual(w.meta.simLog[0].silent, ['e_lo']);
    assert.deepEqual(w.meta.simLog[0].lifted, ['e_lo'], '被点名 → 解除静默');
    assert.deepEqual(w.meta.simLog[0].silentDropped, {}, '本轮无滤除');
    assert.equal(w.agendas.find((a) => a.id === 'a_lo').progress, 1, '应答的推进落账');
    assert.ok(w.chronicle.some((c) => c.text.includes('王小卒') || c.text.includes('自荐成功')), '应答留痕入编年');
});

test('门控：再判定——事件关闭后重新静默（"下一轮重新判定"）', () => {
    const world = structuredClone(GATED);
    world.events[0].ripples = ['e_lo'];
    const w1 = settleTick({ ssot: world, step: busyStep() }).ssot;      // 被点名 → 应答
    assert.equal(w1.meta.simLog[0].lifted.length, 1);
    const closed = structuredClone(w1);
    closed.events.forEach((e) => { e.closed = true; });                  // 未决事件落幕（关闭路径为执行债，K5 顺手清）
    const w2 = settleTick({ ssot: closed, step: busyStep() }).ssot;
    assert.deepEqual(w2.meta.simLog[1].lifted, [], '不再被点名 → 重新静默');
    assert.deepEqual(w2.meta.simLog[1].silentDropped, { e_lo: 3 });
    assert.equal(w2.agendas.find((a) => a.id === 'a_lo').progress, 1, '推进停在应答当轮');
});

test('门控：top-1 永不静默（全员低分量时仍有一个人在动）', () => {
    const world = structuredClone(GATED);
    for (const e of world.entities) e.attrs = { hardPower: 0.1, office: 0.1, network: 0.1, intel: 0.1 };
    world.weights = { e_hi: 0.1, e_mid: 0.1, e_lo: 0.1 };
    world.events = []; // 清空点名源，纯测 top-1 规则
    const step = {
        actions: [
            { entity: 'e_hi', verb: '调兵', position: '边城' },
            { entity: 'e_mid', verb: '巡营', position: '边城' },
            { entity: 'e_lo', verb: '请战', position: '大营' },
        ],
        newEvents: [
            { title: '整军有成', source: { type: 'plot', ref: 'a_hi' }, position: '边城' },
            { title: '毛遂自荐', source: { type: 'plot', ref: 'a_lo' }, position: '大营' },
        ],
        agendaAdvances: [
            { agendaId: 'a_hi', step: '三营集结完毕', stage: '就绪' },
            { agendaId: 'a_mid', step: '布防完成', stage: '就绪' },
            { agendaId: 'a_lo', step: '自荐成功', stage: '上前' },
        ],
        stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = settleTick({ ssot: world, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const w = r.ssot;
    assert.deepEqual(w.meta.simLog[0].silent, ['e_mid', 'e_lo'], '并列取实体序首个 → e_hi 恒活跃');
    assert.equal(w.agendas.find((a) => a.id === 'a_hi').progress, 1);
    assert.equal(w.agendas.find((a) => a.id === 'a_mid').progress, 0);
    assert.equal(w.agendas.find((a) => a.id === 'a_lo').progress, 0);
});

test('门控：静默方是合法客体（被打被波及照常落账，仍不出主动作）', () => {
    const step = {
        actions: [{ entity: 'e_hi', verb: '弹压', position: '大营' }],
        newEvents: [{ title: '兵卒哗动', source: { type: 'ripple', ref: 'ev_p' }, position: '大营', ripples: ['e_lo'] }],
        agendaAdvances: [{ agendaId: 'a_hi', step: '亲临弹压', stage: '镇压' }],
        stateChanges: [{ entity: 'e_lo', attr: 'hardPower', delta: -0.05, actor: 'e_hi', cause: 'ev_p' }],
        newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = settleTick({ ssot: GATED, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const w = r.ssot;
    assert.equal(w.entities.find((e) => e.id === 'e_lo').attrs.hardPower, 0.05, '客体属性照常被改');
    assert.ok(w.events.some((e) => e.title === '兵卒哗动'), '波及事件照常落账（含 e_lo 波及）');
    assert.deepEqual(w.meta.simLog[0].silent, ['e_lo'], '静默状态保持（客体变动不改主动作权）');
});

test('门控：触发例外——被其他实体动作点名时可应答', () => {
    const step = busyStep();
    step.actions = [{ entity: 'e_hi', verb: '传唤', target: 'e_lo', position: '边城' }];
    step.agendaAdvances = [{ agendaId: 'a_hi', step: '传唤小卒', stage: '问话' }];
    step.newEvents = [];
    const r = settleTick({ ssot: GATED, step });
    const w = r.ssot;
    assert.deepEqual(w.meta.simLog[0].lifted, ['e_lo'], '被动作点名 → 解除静默');
});

test('门控：双面无痕 + P3（演化上下文不含分量）', () => {
    const r = settleTick({ ssot: GATED, step: busyStep() });
    const w = r.ssot;
    assert.ok(!w.chronicle.some((c) => c.text.includes('王小卒')), '编年无静默方行迹');
    const p = buildEvolutionPack(w, null);
    assert.ok(!('weights' in p.pack), 'P3：主调用输入不含分量');
    assert.ok('entities' in p.pack && 'agendas' in p.pack, '其余打包项照常');
});

test('门控：阈值边界（严格小于才算静默）', () => {
    const mk = (kind, w) => ({
        entities: [{ id: 'e_top', kind: 'character' }, { id: 'e_x', kind }],
        weights: { e_top: 1, e_x: w },
        agendas: [],
        events: [],
    });
    const step = { actions: [{ entity: 'e_x', verb: '动', position: '某处' }], newEvents: [], agendaAdvances: [], stateChanges: [] };
    assert.deepEqual(gateWorldStep(step, mk('character', SILENCE_THRESHOLD.character)).silent, [], '人物层恰好等于阈值 → 不静默');
    assert.deepEqual(gateWorldStep(step, mk('character', SILENCE_THRESHOLD.character - 0.001)).silent, ['e_x']);
    assert.deepEqual(gateWorldStep(step, mk('faction', SILENCE_THRESHOLD.faction)).silent, [], '势力层恰好等于阈值 → 不静默');
    assert.deepEqual(gateWorldStep(step, mk('faction', SILENCE_THRESHOLD.faction - 0.001)).silent, ['e_x']);
});

test('门控：确定性（同输入同世界步 → 结算逐字节一致）', () => {
    const a = settleTick({ ssot: GATED, step: busyStep() });
    const b = settleTick({ ssot: GATED, step: busyStep() });
    assert.equal(JSON.stringify(a.ssot), JSON.stringify(b.ssot));
});