// story-world-v2/test/weight.test.js
// K1 单测（分量引擎细案 §4 K1 验收）→ **leg25 c 改写**（用户令「删」四维浮点）。
// 改写缘由（design-core-leg23 §4 第 1 条 + §2.2 三条硬规矩）：兵力/权位/人脉/耳目这几个概念
//   **没法精确表示**（书里没刻度、现实里也没有），压成 0–1 是拿精确外壳装模糊内容；
//   手拍值比没有更坏——它让"编的"看起来像"算的"。故 src/weight.js 里 COEFFS/NEUTRAL_ATTR 整条删除，
//   computeWeight 签名保留但**不吃属性**：= clamp01(layerBase × envFactor)；visibilityMask **只剩位置**。
// 本文件锁的三件事（换载体不换意图）：
//   ① 属性彻底退场——传什么都不改结果（防它借尸还魂 / 改名续用）；
//   ② 剩下的两个真输入（层基线、张力）方向正确；
//   ③ 掩码只剩"位置"这一条零歧义事实（同地/异地二元判定为能力上限）。
// 已删断言（机制没了，不是遗漏；理由写在报告里）：系数单调、缺键=中立 0.5、显式全零/全满、MASK.intelBase、obsFloor 修边。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../src/weight.js';
import {
    computeWeight, computeWeightAtTick, activityFactor, visibilityMask, isVisible, spreadRadius,
    DECAY, MASK, NEUTRAL_TENSION, FACTION_BASELINE, RIPPLE_TARGET_CAP,
} from '../src/weight.js';

const CHAR = 'character';
const FACT = 'faction';

test('公式（leg25 c）：不吃属性——传任何 attrs 结果逐字节一致（"编的数"不许借尸还魂）', () => {
    const empty = computeWeight({}, CHAR);
    // 旧四维（各种摆放）与"新概念试探"都必须一律无效：引擎不再有"属性→分量"这条换算
    const shapes = [
        { hardPower: 1, office: 1, network: 1, intel: 1 },
        { hardPower: 0, office: 0, network: 0, intel: 0 },
        { hardPower: 0.93, office: 0.4, network: 0.6, intel: 0.2 },
        { 兵力: 0.99, 权位: 0.01, 气运: 1 },
    ];
    for (const attrs of shapes) {
        assert.equal(computeWeight(attrs, CHAR), empty, `${JSON.stringify(attrs)} 不得改变分量`);
        assert.equal(computeWeight(attrs, FACT), computeWeight({}, FACT), '势力层同理');
    }
    // 不给 attrs（旧调用形状 computeWeight()）与给 null 同样安全
    assert.equal(computeWeight(), empty, '缺省入参不抛且同值');
    assert.equal(computeWeight(null, CHAR), empty);
});

test('公式（leg25 c）：删掉的常量不许留名——COEFFS / NEUTRAL_ATTR 均已不存在（防"改名续用"）', () => {
    // 这一条是**反向锁**：本次要治的病就是"把没法精确表示的概念压成 0–1 假装客观"。
    //   若有人日后把 hardPower 改名成别的键再把系数表加回来，这里当场红。
    assert.equal(W.COEFFS, undefined, '系数表已删（四维退场后没有"系数"可谈）');
    assert.equal(W.NEUTRAL_ATTR, undefined, '中立属性表已删——它唯一的存在理由是"缺键时公式取什么默认值"，而公式已不吃属性');
    assert.equal(MASK.intelBase, undefined, '掩码的"情报"项已删（同样是手拍的 0–1）');
    assert.equal(MASK.obsFloor, undefined, 'obsFloor 修边随比值项一并删除（比值没了，断崖无从谈起）');
});

test('公式：层基线 × 张力，钳回 [0,1]（势力层基线 0.85——leg25 c 无属性化后重基线）', () => {
    assert.equal(FACTION_BASELINE, 0.85, '层基线常量=0.85（势力按人物的 85% 计；原 1.5 被 clamp01 吸平成了纸面常量）');
    // 算式现状：envFactor = 1 + 0.2×(张力−0.5) ∈ [0.9,1.1] ⇒
    //   人物层 1×[0.9,1.1]：≤1 那半可见，>1 那半仍被 clamp01 截平（张力 0.5 恰好 = 1）；
    //   势力层 0.85×[0.9,1.1] = [0.765,0.935]：**全程落在界内**，张力项与层差现在都看得见。
    //   ⇒ "人物 vs 势力"的可见差 = 1.0 vs 0.85（势力更低——层级折扣，不是"更大"）。
    assert.ok(Math.abs(computeWeight({}, CHAR) - 1) < 1e-12, '人物：1 × envFactor(0.5)=1 → 1');
    assert.ok(Math.abs(computeWeight({}, FACT) - 0.85) < 1e-12, `势力：0.85 × 1 = 0.85（实际 ${computeWeight({}, FACT)}）`);
    assert.ok(Math.abs(computeWeight({}, FACT, 1) - 0.935) < 1e-12, '张力拉满：0.85 × 1.1 = 0.935');
    assert.ok(Math.abs(computeWeight({}, FACT, 0) - 0.765) < 1e-12, '张力归零：0.85 × 0.9 = 0.765');
    // 层差在账面上可见了（删属性前两者同为 1.0，层差全被钳制吃掉）
    assert.ok(computeWeight({}, FACT) < computeWeight({}, CHAR), '势力基础分低于人物（层级折扣方向）');
});

test('公式：envFactor 方向（张力高 → 分量升；降的方向对人物层被钳制贴顶）', () => {
    assert.equal(computeWeight({}, CHAR, NEUTRAL_TENSION), computeWeight({}, CHAR), '缺省张力 = 中立张力');
    // 降的方向可见：1 + 0.2×(0.2−0.5) = 0.94
    assert.ok(Math.abs(computeWeight({}, CHAR, 0.2) - 0.94) < 1e-12, '低张力 → 0.94');
    assert.ok(computeWeight({}, CHAR, 0.2) < computeWeight({}, CHAR, NEUTRAL_TENSION), '张力低 → 分量降');
    // 升的方向对人物层**不可见**：1 + 0.2×(0.8−0.5) = 1.06 → 钳回 1。
    //   删掉属性之后人物基础分恒为 1（贴着上界），凡 >1 的张力修正都被 clamp01 截平。
    //   势力层不贴顶（0.85 起算），故升的方向在势力层照样观察得到——见上一条的 0.935。
    assert.equal(computeWeight({}, CHAR, 0.8), 1, '高张力 → 公式值 1.06 → 钳回 1');
    assert.equal(computeWeight({}, CHAR, 0.8), computeWeight({}, CHAR, NEUTRAL_TENSION), '人物层升的方向当前观察不到');
    assert.ok(computeWeight({}, FACT, 0.8) > computeWeight({}, FACT, NEUTRAL_TENSION), '势力层升的方向可见（不贴顶）');
    // 缺省 kind 按人物（kind 是层参数，不是属性；保留旧签名的宽容度）
    assert.equal(computeWeight({}), computeWeight({}, CHAR));
});

test('公式：确定性（重复调用序列逐字节一致）', () => {
    const cases = [
        [{}, CHAR, 0.6],
        [{ hardPower: 1, office: 0 }, FACT, 0.4],
        [null, CHAR, 0.5],
    ];
    const pass1 = cases.map((a) => JSON.stringify(computeWeight(...a)));
    const pass2 = cases.map((a) => JSON.stringify(computeWeight(...a)));
    assert.deepEqual(pass1, pass2);
});

test('衰减：宽限期内恒 1（人物 8 tick / 势力 20 tick）', () => {
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

test('衰减：衰减后分量 = 公式分 × 因子（唯一还在动的那一项，是时间事实不是编的数）', () => {
    const grace = DECAY.character.grace;
    // 公式分现在恒为 1（人物层），衰减是唯一变量：宽限内 1，宽限后每 tick −2%
    assert.equal(computeWeightAtTick(null, CHAR, NEUTRAL_TENSION, grace), 1);
    assert.equal(computeWeightAtTick({}, CHAR, NEUTRAL_TENSION, grace), 1, '传 attrs 也不改（属性退场）');
    assert.ok(Math.abs(computeWeightAtTick(null, CHAR, NEUTRAL_TENSION, grace + 1) - (1 - DECAY.character.rate)) < 1e-12);
});

test('掩码（leg25 c）：只剩位置——同地 1.0 / 异地 0.5（零歧义事实，二元判定为能力上限）', () => {
    assert.equal(MASK.posSame, 1.0);
    assert.equal(MASK.posDiff, 0.5);
    assert.equal(visibilityMask({ sameLocation: true }), 1.0);
    assert.equal(visibilityMask({ sameLocation: false }), 0.5);
    // 旧参数形状（intel / 分量对）一律不再参与：与"只传位置"逐字节一致
    assert.equal(visibilityMask({ intel: 0, sameLocation: true }), 1.0, '耳目数量不再是输入');
    assert.equal(visibilityMask({ intel: 1, sameLocation: false }), 0.5);
    assert.equal(visibilityMask({ srcWeight: 0.01, obsWeight: 0.99, sameLocation: true }), 1.0, '分量比项早已退场');
    assert.equal(visibilityMask({ srcWeight: 9, obsWeight: 0, sameLocation: false }), 0.5, '零分量观察者不再"全瞎"');
});

test('掩码：阈值两端（门槛线 = MASK.threshold，恰好等于阈值算可见）', () => {
    assert.equal(MASK.threshold, 0.25);
    assert.ok(isVisible(visibilityMask({ sameLocation: true })), '同地 1.0 → 可见');
    assert.ok(isVisible(visibilityMask({ sameLocation: false })), '异地 0.5 → 可见（> 阈值）');
    assert.ok(isVisible(MASK.threshold), '恰好等于阈值 → 可见（≥ 语义）');
    assert.ok(!isVisible(MASK.threshold - 1e-9), '门槛下一格 → 不可见');
});

test('掩码（leg25）：入参缺省不抛（唯一真源被多方调用，鲁棒性）', () => {
    // 缺省 sameLocation=false → 按异地位（现法口径：不因数据缺失而放宽可见性；
    //   "事件位置缺失该按同地/异地/中立取哪一值"仍是源注释里登记未拍板的待办）。
    assert.equal(visibilityMask(), MASK.posDiff, '缺省 → 异地 0.5');
    assert.equal(visibilityMask({ 未知字段: 1 }), MASK.posDiff, '多余入参不影响');
    assert.equal(visibilityMask({ sameLocation: true, 未知字段: 1 }), 1.0);
});

test('半径与波及上限（片3）：半径公式保留（死代码，无调用者）；波及上限=固定提案常量（校验侧强制）', () => {
    assert.equal(spreadRadius(0), 1);
    assert.equal(spreadRadius(1), 4);
    assert.ok(spreadRadius(0.6) > spreadRadius(0.4), '半径那把尺还在（尽管已无调用者）');
    // leg25：删掉 `maxRippleTargets()` 包装函数的三则断言——该函数生产 0 调用（唯一用处是返回本常量），
    //   上限的强制点已改在 check-step（校验 newEvents[].ripples 条数），常量本体仍在此锁值。
    assert.equal(RIPPLE_TARGET_CAP, 3, '波及目标数上限=固定提案值（不再随分量变：旧法 ceil(2×分量)）');
});
