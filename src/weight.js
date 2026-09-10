// story-world-v2/src/weight.js
// 分量引擎（K1，分量引擎细案 §3.1/§3.3/§3.4）：纯函数、确定性、零依赖。
// 依据：ANCHOR §3③（分量引擎：模型看不到、不参与）、长跑防线细案 §2.3（静止衰减）。
// 全部数值为【提案态】（铁律 2）：待 K6 冒烟曲线后逐项报批，勿当定案使用。

export const NEUTRAL_TENSION = 0.5;          // 静态张力常量（切片期；大势层真值后换）

// ---- 常量提案表（分量引擎细案 §3.1/§3.3/§3.4，拍板点 P1/P5/P6）----
// leg25 c（用户令「删」）：**四维浮点整条拿掉**（兵力/权位/人脉/耳目）——`COEFFS` 与 `NEUTRAL_ATTR` 一并删除。
//   为什么（`design-core-leg23` §4 第 1 条 + §2.2 三条硬规矩）：
//     ① **手拍值比没有更坏：让"编的"看起来像"算的"**——书里根本没有这些刻度；
//     ② 这几个概念**没法精确表示**：一个势力的兵力是多少？权位几品？人脉 0.6 是什么意思？
//        书里没写、现实里也没有——压成 0–1 就是**用精确的外壳装模糊的内容**；
//     ③ "要有依据"——原文没写就没依据，**空着就是空着**。
//   正确表示法前几棒已立好先例：书里的说法**照抄成文本**（实体 `实力` = 「T9渡劫巅峰」，据书），
//   引擎不换算、不进公式、不排序、不比较（`spec-entity-field-lookup` + leg25b 交接 §3 准则）。
//   因此分量从此**不吃任何属性**：基础分＝层基线一个常数，只余静止衰减在动（时间事实，不是编的数）。
export const FACTION_BASELINE = 0.85;        // 势力层基线：势力按**人物的 85%** 计（层级折扣，非"更大"）
// ⚠️ 实测留档（2026-09-11）：原值 1.5（试过 1.4）会让 `layerBase × envFactor ≥ 1`，
//   被下方 `clamp01` 吸平成 1 ⇒ 势力与人物基础分全等、本常量成了纸面常量（实测 tension 0.5 时两者都 1.0000）。
//   另：删掉属性项后，**人物的基础分恒被钳在上界 1.0**（layerBase 1 × envFactor ∈[0.9,1.1]），
//   所以"人物 vs 势力"的可见差是 **1.0 vs 0.85**（势力更低）；真正会动的是势力的张力项与两者的静止衰减。
//   分量 ∈[0,1] 是既有契约（写进 schema 与多处断言），故不动 clamp，只调基线。
export const ENV_TENSION_COEFF = 0.2;        // envFactor = 1 + 系数×(张力−0.5)
export const DECAY = {                        // 静止衰减（沿用长跑细案 §2.3 提案，玩家同尺）
    character: { grace: 8, rate: 0.02 },     // 连续 8 tick 无动作后，每 tick −2%
    faction:   { grace: 20, rate: 0.01 },    // 连续 20 tick 无动作后，每 tick −1%
};
export const MASK = {                         // 可见性掩码（leg25 c：**只剩位置**——"情报"那个手拍的数已删）
    posSame: 1.0, posDiff: 0.5,              // 同位置 / 异位置（位置图为符号集，二元判定为能力上限）
    threshold: 0.25,                         // m < 0.25 → 注入侧省略该事实（片3：原 0.3 是配合比值项的调参值）
};
// leg24 片3 删除位：`obsFloor`（观察者存在感门 ε=0.05 修边）随比值项一并删除——
//   它当年修的是"obs→0 断崖"这个**只存在于比值公式里**的毛病；比值没了，毛病也就不存在了。
export const RADIUS_BASE = 1;                 // 因果传播半径：radius = 1 + 3×weight
export const RADIUS_GAIN = 3;
// 提案（片3）：一次事件波及目标数上限（原 ceil(2×分量)→固定值）。
// leg25（死代码修复）：本常量是**唯一真源**——写入侧由 check-step 强制（newEvents[].ripples 超限即拒整步）；
//   原 `maxRippleTargets()` 包装函数生产 0 调用（唯一用处就是返回本值），已随接线一并删除（消灭纸面机制）。
export const RIPPLE_TARGET_CAP = 3;


const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// leg25 c：`NEUTRAL_ATTR`（中立属性表）**整条删除**——它存在的唯一理由是"账面没有四维数值时公式怎么算"，
//   而四维已经不在了，没有"缺键"可谈。删掉它也顺手删掉了一个隐患：任何"缺数据就取某个默认值"的写法
//   都是在替世界编数（§2.2 硬规矩一）。

// 分量 = clamp(层基线 × 环境修正, 0, 1)。
// leg25 c：**基础分不再吃任何属性**——属性项整条删除（见上）。动的那部分是 `activityFactor`
//   （静止衰减）——那是**时间事实**（多久没出手），不是编出来的强弱。
//   ⚠️ 实测修正（2026-09-11）：此前误写成 `clamp01(envFactor)`，**层基线从没被乘上去** ⇒ 势力与人物
//     基础分全等、`FACTION_BASELINE` 成了纸面常量。现按原设计乘回 layerBase（1.4 / 1）。
export function computeWeight(_attrs = {}, kind = 'character', tension = NEUTRAL_TENSION) {
    const layerBase = kind === 'faction' ? FACTION_BASELINE : 1;
    const envFactor = 1 + ENV_TENSION_COEFF * ((tension ?? NEUTRAL_TENSION) - NEUTRAL_TENSION);
    return clamp01(layerBase * envFactor);
}

// 静止衰减因子：宽限期内恒 1；之后 max(0, 1 − rate×(idle − grace))。active 后因子立即回 1（调用方负责归零 idle）。
export function activityFactor(idleTicks, kind = 'character') {
    const p = DECAY[kind] || DECAY.character;
    if (!(idleTicks > p.grace)) return 1;
    return Math.max(0, 1 - p.rate * (idleTicks - p.grace));
}

// 可见性掩码（leg24 片3 起事实驱动；leg25 c **只剩位置**）：
//   旧法 m = (源分量 ÷ 观察者分量) × 情报 × 位置 × 存在感门。用户拍板删掉那个数之后：
//   ①比值项失去意义（它拿两个"没法客观"的分数相除）；②"零分量观察者无所见"的短路会让新世界开局玩家什么都看不见。
//   leg25 c 再删"情报"这一项——它也是**手拍的 0–1**（同上：没法精确表示，且让编的像算的）：
//   世上没人能量化"你耳目多灵"，问一句就是编一个数。**剩下唯一可查的事实是位置**（同地/异地），零歧义。
//   ⚠️ 待办（登记，勿静默发明）：片3 交付时已留的"事件位置缺失该按同地/异地/中立取哪一值"仍**未拍板**；
//     现法沿用既有口径（缺失→按异地位，即不因数据缺失而放宽可见性），行为与删 intel 前逐字节一致
//     （因为原式中立情报 0.5 恰好也落在 posDiff 那一侧）。
export function visibilityMask({ sameLocation = false } = {}) {
    return clamp01(sameLocation ? MASK.posSame : MASK.posDiff);
}

export const isVisible = (m) => m >= MASK.threshold;

// 因果传播半径（§3.1）：单调随分量增长；影响范围 = 波及目标数上限。
export function spreadRadius(weight) {
    return RADIUS_BASE + RADIUS_GAIN * clamp01(weight);
}

// 供结算器用的衰减后分量：weight' = 公式分 × activityFactor（衰减只作用分量缓存，不改属性——动量分离，长跑 §2.3）。
export function computeWeightAtTick(attrs, kind, tension, idleTicks) {
    return clamp01(computeWeight(attrs, kind, tension) * activityFactor(idleTicks, kind));
}