// story-world-v2/test/weight.test.js
// K1 单测（分量引擎细案 §4 K1 验收）：公式单调/边界/层差/env 方向/缺键/确定性；衰减宽限/单调/封底/层差；掩码对等/情报/位置/权重比/阈值；半径与波及上限。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeWeight, computeWeightAtTick, activityFactor, visibilityMask, isVisible, spreadRadius, maxRippleTargets,
    DECAY, MASK, NEUTRAL_TENSION, RIPPLE_TARGET_CAP,
} from '../src/weight.js';

const CHAR = 'character';
const FACT = 'faction';

test('公式：属性单调不减（各系数为正）', () => {
    for (const kind of [CHAR, FACT]) {
        for (const attr of ['hardPower', 'office', 'network', 'intel']) {
            const lo = { hardPower: 0.5, office: 0.5, network: 0.5, intel: 0.5 };
            const hi = { ...lo, [attr]: 0.9 };
            assert.ok(computeWeight(hi, kind) >= computeWeight(lo, kind), `${kind}.${attr} 应单调`);
        }
    }
});

test('公式：边界钳制 [0,1]；**账面无数 → 中立 floor**（leg24 片2）：空 attrs=0.5，显式全零=0，全满=1', () => {
    // leg24 片2（账本换血）语义变更：**"没有数据"不再等于 0**——账本不预填数值后，若把缺键当 0，
    // 开局全世界分量全 0 → 门控全体静默 + 掩码 obs=0 谁都不见 → 世界冻死。
    // 现法：缺键按中立值 0.5 取中性 floor（不落账、同 kind 同值、不含个体信息；见 weight.js NEUTRAL_ATTR）。
    assert.equal(computeWeight({}, CHAR), 0.5, '账面无数 → 中立 floor（人物 0.5）');
    assert.equal(computeWeight({}, FACT), 0.75, '势力层基线 1.5 → 0.75');
    assert.equal(computeWeight({ hardPower: 0, office: 0, network: 0, intel: 0 }, CHAR), 0, '**显式**全零=真值，不是缺键 → 0');
    assert.equal(computeWeight({ hardPower: 1, office: 1, network: 1, intel: 1 }, CHAR), 1);
    // 势力层基线 1.5 会把全满顶到 1.5 → 钳回 1；0.8 全满 → 1.2 → 同钳回 1
    assert.equal(computeWeight({ hardPower: 1, office: 1, network: 1, intel: 1 }, FACT), 1);
    assert.equal(computeWeight({ hardPower: 0.8, office: 0.8, network: 0.8, intel: 0.8 }, FACT), 1);
});

test('公式：层差（同属性势力分量 ≥ 人物；均匀属性下恰为基线倍）', () => {
    const attrs = { hardPower: 0.5, office: 0.3, network: 0.2, intel: 0.1 };
    const c = computeWeight(attrs, CHAR);
    const f = computeWeight(attrs, FACT);
    assert.ok(f >= c, `势力 ${f} 应不小于人物 ${c}`);
    // 0.5×0.35+0.3×0.25+0.2×0.25+0.1×0.15 = 0.175+0.075+0.05+0.015 = 0.315
    assert.ok(Math.abs(c - 0.315) < 1e-9);
    // 均匀属性下两套系数和都是 1.0 → 基础分相等，势力分量恰为人物 ×1.5
    const uni = { hardPower: 0.5, office: 0.5, network: 0.5, intel: 0.5 };
    assert.ok(Math.abs(computeWeight(uni, FACT) - 1.5 * computeWeight(uni, CHAR)) < 1e-9);
});

test('公式：envFactor 方向（张力高 → 分量升）', () => {
    assert.ok(computeWeight({ hardPower: 0.5 }, CHAR, 0.8) > computeWeight({ hardPower: 0.5 }, CHAR, NEUTRAL_TENSION));
    assert.ok(computeWeight({ hardPower: 0.5 }, CHAR, 0.2) < computeWeight({ hardPower: 0.5 }, CHAR, NEUTRAL_TENSION));
    assert.equal(computeWeight({ hardPower: 0.5 }, CHAR, NEUTRAL_TENSION), computeWeight({ hardPower: 0.5 }, CHAR));
});

test('公式：缺键按中立值（不是 0）——prop 是"有据的值"，缺键=账面无数（leg24 片2）', () => {
    // 只提议 hardPower=1：其余三维无数 → 取中立 0.5
    //   1×0.35 + 0.5×(0.25+0.25+0.15) = 0.35 + 0.325 = 0.675
    assert.ok(Math.abs(computeWeight({ hardPower: 1 }, CHAR) - 0.675) < 1e-9, '缺键取中立 0.5（旧法按 0 得 0.35）');
    // 显式给 0 = "确实没有" → 才按 0 算
    assert.ok(Math.abs(computeWeight({ hardPower: 1, office: 0, network: 0, intel: 0 }, CHAR) - 0.35) < 1e-9, '显式 0 才按 0');
});

test('公式：确定性（重复调用序列逐字节一致）', () => {
    const cases = [
        [{ hardPower: 0.1, office: 0.9, network: 0.4, intel: 0.7 }, CHAR, 0.6],
        [{ hardPower: 1, office: 0, network: 0.3, intel: 0 }, FACT, 0.4],
        [{}, CHAR, 0.5],
    ];
    const pass1 = cases.map((a) => JSON.stringify(computeWeight(...a)));
    const pass2 = cases.map((a) => JSON.stringify(computeWeight(...a)));
    assert.deepEqual(pass1, pass2);
});

test('衰减：宽限期内恒 1', () => {
    for (let idle = 0; idle <= DECAY.character.grace; idle++) {
        assert.equal(activityFactor(idle, CHAR), 1);
    }
    for (let idle = 0; idle <= DECAY.faction.grace; idle++) {
        assert.equal(activityFactor(idle, FACT), 1);
    }
});

test('衰减：宽限期后每 tick 固定比率、单调递减、封底 0', () => {
    const p = DECAY.character;
    assert.ok(Math.abs(activityFactor(p.grace + 1, CHAR) - (1 - p.rate)) < 1e-12);
    assert.ok(Math.abs(activityFactor(p.grace + 2, CHAR) - (1 - 2 * p.rate)) < 1e-12);
    let prev = 1;
    for (let idle = p.grace; idle <= p.grace + 50; idle++) {
        const f = activityFactor(idle, CHAR);
        assert.ok(f <= prev, `t=${idle} 应单调不减增长`);
        assert.ok(f >= 0);
        prev = f;
    }
    assert.equal(activityFactor(p.grace + 51, CHAR), 0); // 1 − 0.02×51 < 0 → 封底
});

test('衰减：衰减后分量 = 公式分 × 因子（玩家同尺经由同一入口）', () => {
    const attrs = { hardPower: 1, office: 0, network: 0, intel: 0 };
    const grace = DECAY.character.grace;
    assert.equal(computeWeightAtTick(attrs, CHAR, NEUTRAL_TENSION, grace), 0.35);
    assert.ok(Math.abs(computeWeightAtTick(attrs, CHAR, NEUTRAL_TENSION, grace + 1) - 0.35 * (1 - DECAY.character.rate)) < 1e-12);
});

test('掩码（片3 事实驱动）：全情报同位置 → 1；情报缺失 → 减半；异地 → 再减半', () => {
    assert.equal(visibilityMask({ intel: 1, sameLocation: true }), 1);
    const base = visibilityMask({ intel: 1, sameLocation: true });
    const noIntel = visibilityMask({ intel: 0, sameLocation: true });
    const far = visibilityMask({ intel: 1, sameLocation: false });
    assert.ok(Math.abs(noIntel - base * MASK.intelBase) < 1e-12);
    assert.ok(Math.abs(far - base * MASK.posDiff) < 1e-12);
});

test('掩码（片3）：**不再吃那个分数**——传不传分量、分量多少，结果逐字节一致', () => {
    const a = visibilityMask({ intel: 0.5, sameLocation: true });
    const b = visibilityMask({ srcWeight: 0.01, obsWeight: 0.99, intel: 0.5, sameLocation: true });
    const c = visibilityMask({ srcWeight: 9, obsWeight: 0, intel: 0.5, sameLocation: true });
    assert.equal(a, b, '分量参数已退场（旧法：源弱观察者强 → 更低）');
    assert.equal(a, c, '观察者分量 0 不再导致全瞎（旧法：零分量无所见短路）');
    assert.ok(a > 0, '账面无数的新世界，玩家仍看得见东西');
});

test('掩码（片3）：阈值两端（0.25 是门槛线，两边各测一格）', () => {
    assert.equal(visibilityMask({ intel: 0, sameLocation: false }), 0.25, '无情报 + 异地 = 0.25（恰好门槛）');
    assert.ok(isVisible(visibilityMask({ intel: 0, sameLocation: false })), '恰好 0.25 → 可见（≥ 阈值）');
    assert.ok(!isVisible(visibilityMask({ intel: 0, sameLocation: false }) - 0.01), '门槛下一格 → 不可见');
});

test('掩码（片3）：删掉的 obsFloor 修边不再需要（比值项已不存在，断崖无从谈起）', () => {
    assert.equal(MASK.obsFloor, undefined, 'obsFloor 常量随比值项一并删除');
    // 旧毛病（0.001 全见 / 0 全瞎）在事实驱动公式下不存在：m 只由情报×位置决定
    assert.equal(visibilityMask({ intel: 1, sameLocation: true }), visibilityMask({ intel: 1, sameLocation: true }));
});

test('半径与波及上限（片3）：半径公式保留（死代码，无调用者）；波及上限改固定提案值', () => {
    assert.equal(spreadRadius(0), 1);
    assert.equal(spreadRadius(1), 4);
    assert.ok(spreadRadius(0.6) > spreadRadius(0.4), '半径那把尺还在（尽管已无调用者）');
    assert.equal(maxRippleTargets(), RIPPLE_TARGET_CAP, '不再随分量变：固定值');
    assert.equal(maxRippleTargets(0), RIPPLE_TARGET_CAP, '传参也不影响（旧法 ceil(2×0)=0）');
    assert.equal(maxRippleTargets(1), RIPPLE_TARGET_CAP);
});