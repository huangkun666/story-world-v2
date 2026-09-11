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
// leg25 f 删除位：`MASK`（可见性掩码：posSame/posDiff/threshold）整组删除——见文件下方说明。
//   它到后期只剩"同地/异地 → 1.0/0.5"两个取值，而阈值 0.25 使**两者都过闸** ⇒ 恒真、挡不住任何事实。
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

// ★leg25 f（用户拍板「X3 删掉掩码」）：`MASK` / `visibilityMask` / `isVisible` **整组删除**。
//   为什么删而不是调参：这组东西到后期只剩一个二元入参（同地/异地 → 1.0 / 0.5），而阈值是 0.25，
//   **两个可能取值都过闸** ⇒ 掩码恒真、注入侧一个事实都没挡住 —— 参数、函数、注释都很正经，
//   实际是**死参数 + 假机制**（实测见 `docs/spec-failure-verdict-and-visibility.md` §3）。
//   "让位置真能挡"（把阈值提到 0.5 以上）被否：①要新报批一个阈值（铁律 2）②位置是二元量，
//   挡=整条不见，粗得像开关 ③八本书实测"地名条目可用"仅 **2/7**（三国 235 个势力条目但地名 0）
//   ⇒ 其余书 `positions = ['未明']`、全员"同地"，掩码恒真如故，白改。
//   ⇒ 判定：**一个改不动任何事实的参数，留下的唯一作用就是让人以为这里有个机制。**
//   现口径：观棋侧全局可见（你的权利，ANCHOR §3⑥）；**注入侧同样不设可见性过滤**（玩家看得见
//   带因果指针的世界动向）——两侧同向，**不制造两套真相**。concealed 盘算的编年抑制（K21）照旧不受影响。
//   旧值留档（供追溯，不再有消费者）：posSame 1.0 / posDiff 0.5 / threshold 0.25。

// 因果传播半径（§3.1）：单调随分量增长；影响范围 = 波及目标数上限。
export function spreadRadius(weight) {
    return RADIUS_BASE + RADIUS_GAIN * clamp01(weight);
}

// 供结算器用的衰减后分量：weight' = 公式分 × activityFactor（衰减只作用分量缓存，不改属性——动量分离，长跑 §2.3）。
export function computeWeightAtTick(attrs, kind, tension, idleTicks) {
    return clamp01(computeWeight(attrs, kind, tension) * activityFactor(idleTicks, kind));
}