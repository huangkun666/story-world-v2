// story-world-v2/test/decay.test.js
// K3 验收（分量引擎细案 §3.3/§4 K3 → V3）：静止衰减入结算重算——宽限期内恒 1、宽限期后单调递减、
// 活跃恢复立即回满、lastActiveTick 记账、schema 合法。
// leg25 c 改写（用户令「删」四维浮点）：夹具里不再有 `attrs`，世界步里不再有 `stateChanges`。
//   连带后果（如实登记）：分量公式不再吃属性 ⇒ 基础分只剩**层基线常数**（人物 1.0 / 势力 0.85，
//   见 weight.test 的 leg25 c 重基线），于是"衰减"从"0.9 × 因子"变成"层基线 × 因子"——
//   断言值改了，测的东西没变（宽限/单调/回满/记账）。
// 玩家同尺说明：玩家棋子与实体共用同一入口 computeWeightAtTick（K1 已系统验证）；
//   玩家在 SSOT 的入账（分量来源）为登记中的设计缺口（见台账/未决队列），实体侧同尺先行落地。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleTick } from '../src/settle.js';
import { DECAY } from '../src/weight.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

// 单人物静止世界：无盘算无事件，纯测衰减链路（top-1 永不静默，空步即可）
// 账上无数（leg25 c：四维已删）——实体只留身份/位置这些可查事实。
const stillWorld = () => ({
    version: 1,
    context: { world: '静谷', tension: 0.5, positions: ['静谷'] },
    entities: [{ id: 'e_x', kind: 'character', name: '入定者', location: '静谷' }],
    weights: {},
    agendas: [],
    events: [],
    chronicle: [],
    meta: { tick: 0 },
});

// 空步：`stateChanges` 已从契约层整条删除（四维不存在了），故不再出现在任何世界步里
const emptyStep = () => ({ actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] });

function runTicks(world, n, entityId = 'e_x') {
    const weights = [];
    for (let t = 1; t <= n; t++) {
        const r = settleTick({ ssot: world, step: emptyStep() });
        assert.equal(r.ok, true, r.stage.warnings.join('; '));
        world = r.ssot;
        weights.push(world.weights[entityId]);
    }
    return { world, weights };
}

test('衰减：宽限期内分量恒 1（人物 8 tick），宽限期后每 tick −2% 单调递减', () => {
    const { world, weights } = runTicks(structuredClone(stillWorld()), 14);
    for (let t = 0; t < 8; t++) assert.ok(Math.abs(weights[t] - 1) < 1e-12, `t${t + 1} 宽限期内应恒 1，实际 ${weights[t]}`);
    // t9 起 idle>8 → 因子 1−0.02×(idle−8)（公式分恒 1，故分量 = 因子）
    assert.ok(Math.abs(weights[8] - 0.98) < 1e-9, `t9 衰减 2%，实际 ${weights[8]}`);
    assert.ok(Math.abs(weights[9] - 0.96) < 1e-9, `t10 衰减 4%，实际 ${weights[9]}`);
    for (let i = 9; i < weights.length; i++) assert.ok(weights[i] <= weights[i - 1], `单调不减增长：${weights[i]} > ${weights[i - 1]}`);
    assert.equal(world.entities[0].lastActiveTick, undefined, '从未活跃 → 无记账');
});

test('衰减：活跃恢复立即回满（lastActiveTick 记账 + factor 归 1）', () => {
    const { world: idleWorld } = runTicks(structuredClone(stillWorld()), 10);   // 已衰减 2 轮
    const act = settleTick({
        ssot: idleWorld,
        step: { actions: [{ entity: 'e_x', verb: '起身', position: '静谷' }], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] },
    });
    assert.equal(act.ok, true);
    assert.equal(act.ssot.entities[0].lastActiveTick, 11, '活跃落账方记账');
    assert.equal(act.ssot.weights.e_x, 1, '当轮 idle=0 → 立即回满');
    // 再静止一轮 → 仍在宽限内（刚记过活跃）
    const again = runTicks(act.ssot, 1);
    assert.ok(Math.abs(again.weights[0] - 1) < 1e-12, '最新活跃的下一轮仍在宽限内');
});

test('衰减：势力层宽限期 20 tick（沿用长跑提案，层参数不同）', () => {
    const world = {
        version: 1,
        context: { world: '王庭', tension: 0.5, positions: ['王庭'] },
        entities: [{ id: 'e_f', kind: 'faction', name: '王庭', location: '王庭' }],
        weights: {},
        agendas: [],
        events: [],
        chronicle: [],
        meta: { tick: 0 },
    };
    const { weights } = runTicks(world, 24, 'e_f');
    // leg25 c 重基线：层基线由 1.5 改 0.85（原值被 clamp01 吸平成 1，成了纸面常量）⇒
    //   势力层基础分现在**看得见地低于人物**：0.85 × envFactor(0.5)=1 → 0.85。
    //   （人物层 1.0：见上一条；此处只测势力的宽限窗与衰减斜率。）
    for (let t = 0; t < 20; t++) assert.ok(Math.abs(weights[t] - 0.85) < 1e-12, `势力宽限 20 tick 内恒 0.85（t${t + 1}，实际 ${weights[t]}）`);
    assert.ok(weights[20] < 0.85, `t21 起衰减（实际 ${weights[20]}）`);
    // 势力层每 tick −1%：t21 = 0.85×(1−0.01) = 0.8415
    assert.ok(Math.abs(weights[20] - 0.85 * (1 - DECAY.faction.rate)) < 1e-12, '宽限后首轮 −1%');
    assert.ok(weights[21] < weights[20], '单调递减');
});

test('衰减：衰减后世界过 SSOT schema（lastActiveTick 字段合法）', () => {
    const { world } = runTicks(structuredClone(stillWorld()), 12);
    const vr = validate(world, ssotSchema);
    assert.equal(vr.ok, true, vr.errors.join('; '));
});
