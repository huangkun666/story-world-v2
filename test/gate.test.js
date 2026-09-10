// story-world-v2/test/gate.test.js
// K2 验收（分量引擎细案 §3.2/§4 K2）：静默判定与滤除、触发例外（被点名可应答）、再判定、
// top-1 保送、静默方为合法客体、双面无痕、P3（pack 不含分量）、确定性、schema 审计字段。
// 夹具：gated-world.json（三实体：e_hi/e_mid 各有在办盘算，e_lo 的盘算已终结——**leg24 片3 起静默判据=结构三条件**，
//   不再看分量：没有在办的事 ∧ 久未出手 ∧ 无人点名 才静默）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settleTick } from '../src/settle.js';
import { gateWorldStep, QUIET_TICKS } from '../src/gate.js';
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

test('门控（片3 结构判据）：没有在办的事 + 久未出手 + 无人点名 → 静默滤除（不落账、双面无痕）', () => {
    const r = settleTick({ ssot: GATED, step: busyStep() });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.deepEqual(r.stage.warnings, [], '静默滤除不是警告');
    const w = r.ssot;
    assert.deepEqual(w.meta.simLog[0].silent, ['e_lo'], '王小卒：盘算已终结、从没出手、无人点名 → 静默');
    assert.deepEqual(w.meta.simLog[0].lifted, [], 'ev_p 点名的是 e_mid，e_mid 本不静默');
    assert.deepEqual(w.meta.simLog[0].silentDropped, { e_lo: 3 }, '行动 + 推进 + plot 事件各 1 → 共 3 条被门控滤除（推进那条盘算已终结，check 另记警告）');
    assert.equal(w.agendas.find((a) => a.id === 'a_hi').progress, 1, '有在办盘算 → 推进落账');
    assert.equal(w.agendas.find((a) => a.id === 'a_mid').progress, 1, '同上');
    assert.equal(w.agendas.find((a) => a.id === 'a_lo').progress, 0, '静默方盘算不被推进（且该盘算已终结）');
    assert.ok(w.events.some((e) => e.title === '整军有成'));
    assert.ok(w.events.some((e) => e.title === '军心浮动'));
    assert.ok(!w.events.some((e) => e.title === '毛遂自荐'), '静默方 plot 事件不落账');
    const vr = validate(w, ssotSchema);
    assert.equal(vr.ok, true, `审计字段过 schema: ${vr.errors.join('; ')}`);
});

test('门控（片3）：判据与那个分数无关——分量天差地别的两人，只看"有没有在办的事"', () => {
    // e_lo 分量 0.1、e_hi 分量 0.9：旧法 e_lo 必静默；新法给的盘算一开，它就活跃
    const world = structuredClone(GATED);
    world.agendas.find((a) => a.id === 'a_lo').closed = false;
    delete world.agendas.find((a) => a.id === 'a_lo').closedAt;
    const r = settleTick({ ssot: world, step: busyStep() });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.deepEqual(r.ssot.meta.simLog[0].silent, [], '三人都有在办的事 → 无人静默（分数不参与判定）');
    assert.deepEqual(r.ssot.meta.simLog[0].silentDropped, {}, '零滤除');
    assert.equal(r.ssot.agendas.find((a) => a.id === 'a_lo').progress, 1, '低分量的推进照样落账');
});

test('门控：触发例外（被点名可应答）——未决事件点名静默方时解除静默', () => {
    const world = structuredClone(GATED);
    world.events[0].ripples = ['e_lo']; // 未决事件波及点名王小卒
    const r = settleTick({ ssot: world, step: busyStep() });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const w = r.ssot;
    assert.deepEqual(w.meta.simLog[0].silent, ['e_lo'], '结构上静默（无在办、久未出手）');
    assert.deepEqual(w.meta.simLog[0].lifted, ['e_lo'], '被点名 → 解除静默');
    assert.deepEqual(w.meta.simLog[0].silentDropped, {}, '本轮无滤除');
    assert.ok(w.chronicle.some((c) => c.text.includes('王小卒') || c.text.includes('毛遂自荐')), '应答留痕入编年');
});

test('门控：再判定——点名源关闭后重新静默（"下一轮重新判定"）', () => {
    const world = structuredClone(GATED);
    world.events[0].ripples = ['e_lo'];
    // 第一轮：被点名 → 解除静默（可应答）
    const g1 = gateWorldStep(busyStep(), world);
    assert.deepEqual(g1.lifted, ['e_lo'], '被点名 → 解除静默');
    assert.deepEqual(g1.dropped.actions, [], '应答当轮不被滤');
    // 点名源关闭（未决事件落幕）→ 同一结构条件下重新回到静默
    const closedWorld = structuredClone(world);
    closedWorld.events.forEach((e) => { e.closed = true; });   // 关闭路径为执行债，K5 顺手清
    const g2 = gateWorldStep(busyStep(), closedWorld);
    assert.deepEqual(g2.lifted, [], '不再被点名 → 不再有应答豁免');
    assert.deepEqual(g2.silent, ['e_lo']);
    assert.deepEqual(g2.dropped.actions, ['e_lo'], '行动被滤（重新静默）');
});

test('门控：top-1 保送（实体序首个 active 实体恒活跃，防全静默）', () => {
    const world = structuredClone(GATED);
    world.events = [];                                    // 清空点名源
    for (const a of world.agendas) a.closed = true;        // 全员无在办盘算
    for (const e of world.entities) delete e.lastActiveTick;   // 全员久未出手
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
        agendaAdvances: [],
        stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = settleTick({ ssot: world, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const w = r.ssot;
    assert.deepEqual(w.meta.simLog[0].silent, ['e_mid', 'e_lo'], '实体序首个（e_hi）保送 → 恒活跃');
    assert.ok(w.events.some((e) => e.title === '整军有成'), '保送者的动作落账');
    assert.ok(!w.events.some((e) => e.title === '毛遂自荐'), '静默方的动作被滤');
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

test('门控（片3）：结构三条件的真值表（各条件单独成立即不静默）', () => {
    const mk = (patch = {}) => ({
        entities: [{ id: 'e_top', kind: 'character' }, { id: 'e_x', kind: 'character', ...(patch.ent || {}) }],
        weights: { e_top: 1, e_x: 0 },          // 分量刻意给 0：新判据不该理它
        agendas: patch.agendas || [],
        events: patch.events || [],
        meta: { tick: patch.tick ?? 10 },
    });
    const step = { actions: [{ entity: 'e_x', verb: '动', position: '某处' }], newEvents: [], agendaAdvances: [], stateChanges: [] };
    // 三条件全不成立 → 静默
    assert.deepEqual(gateWorldStep(step, mk()).silent, ['e_x'], '无在办 + 久未出手 + 无人点名 → 静默');
    // ① 有在办盘算 → 不静默
    assert.deepEqual(gateWorldStep(step, mk({ agendas: [{ id: 'a1', owner: 'e_x', closed: false }] })).silent, [], '有在办的事 → 不静默');
    // ② 刚出过手 → 不静默
    assert.deepEqual(gateWorldStep(step, mk({ ent: { lastActiveTick: 10 - (QUIET_TICKS - 1) } })).silent, [], '刚出过手 → 不静默');
    assert.deepEqual(gateWorldStep(step, mk({ ent: { lastActiveTick: 10 - QUIET_TICKS } })).silent, ['e_x'], `恰好 QUIET_TICKS=${QUIET_TICKS} 轮前出手 → 算久未出手`);
    // ③ 被未决事件点名 → 静默名单仍列，但 lifted 可应答
    const g = gateWorldStep(step, mk({ events: [{ id: 'ev', ripples: ['e_x'], closed: false }] }));
    assert.deepEqual(g.silent, ['e_x']);
    assert.deepEqual(g.lifted, ['e_x'], '被点名 → 解除静默（可应答）');
});

test('门控：确定性（同输入同世界步 → 结算逐字节一致）', () => {
    const a = settleTick({ ssot: GATED, step: busyStep() });
    const b = settleTick({ ssot: GATED, step: busyStep() });
    assert.equal(JSON.stringify(a.ssot), JSON.stringify(b.ssot));
});