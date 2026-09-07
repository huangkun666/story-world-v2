// story-world-v2/src/weight.js
// 分量引擎（K1，分量引擎细案 §3.1/§3.3/§3.4）：纯函数、确定性、零依赖。
// 依据：ANCHOR §3③（分量引擎：模型看不到、不参与）、长跑防线细案 §2.3（静止衰减）。
// 全部数值为【提案态】（铁律 2）：待 K6 冒烟曲线后逐项报批，勿当定案使用。

export const NEUTRAL_TENSION = 0.5;          // 静态张力常量（切片期；大势层真值后换）

// ---- 常量提案表（分量引擎细案 §3.1/§3.3/§3.4，拍板点 P1/P5/P6）----
export const COEFFS = {
    // 基础分 = Σ wᵢ·attrᵢ（层系数提案）
    character: { hardPower: 0.35, office: 0.25, network: 0.25, intel: 0.15 },
    faction:   { hardPower: 0.45, office: 0.35, network: 0.10, intel: 0.10 },
};
export const FACTION_BASELINE = 1.5;         // 层级基线（势力层天然分量大，对齐宏大层 ≤5 在飞上限语义）
export const ENV_TENSION_COEFF = 0.2;        // envFactor = 1 + 系数×(张力−0.5)
export const DECAY = {                        // 静止衰减（沿用长跑细案 §2.3 提案，玩家同尺）
    character: { grace: 8, rate: 0.02 },     // 连续 8 tick 无动作后，每 tick −2%
    faction:   { grace: 20, rate: 0.01 },    // 连续 20 tick 无动作后，每 tick −1%
};
export const MASK = {                         // 可见性掩码（分量 × 情报 × 位置，§3.4）
    intelBase: 0.5, intelGain: 0.5,          // intelFactor = 0.5 + 0.5×情报
    posSame: 1.0, posDiff: 0.5,              // 同位置 / 异位置（位置图为符号集，二元判定为能力上限）
    threshold: 0.3,                          // m < 0.3 → 注入侧省略该事实
    obsFloor: 0.05,                          // 观察者存在感门（2026-09-07 评审修边，提案态，随掩码系数报批）：
                                             // obs < ε → m' = m×obs/ε —— 消除"obs→0 饱和全见 vs obs=0 全瞎"断崖，
                                             // obs→0 连续趋 0（"零分量无所见"语义连续化）；obs ≥ ε → 原公式。
};
export const RADIUS_BASE = 1;                 // 因果传播半径：radius = 1 + 3×weight
export const RADIUS_GAIN = 3;
export const RIPPLE_TARGET_GAIN = 2;          // 影响范围 = 事件可波及目标数上限 ceil(2×weight)

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// 分量 = clamp(基础分 × 层级基线 × 环境修正, 0, 1)。缺键按 0；张力缺省取静态常量。
// "客观 = 确定性计算 + 有界输入"（dev-process 红线④）：引擎只算，上游属性由模型提议、结算器钳制。
export function computeWeight(attrs = {}, kind = 'character', tension = NEUTRAL_TENSION) {
    const coeffs = COEFFS[kind] || COEFFS.character;
    let base = 0;
    for (const [name, w] of Object.entries(coeffs)) base += (attrs[name] ?? 0) * w;
    const layerBase = kind === 'faction' ? FACTION_BASELINE : 1;
    const envFactor = 1 + ENV_TENSION_COEFF * ((tension ?? NEUTRAL_TENSION) - NEUTRAL_TENSION);
    return clamp01(base * layerBase * envFactor);
}

// 静止衰减因子：宽限期内恒 1；之后 max(0, 1 − rate×(idle − grace))。active 后因子立即回 1（调用方负责归零 idle）。
export function activityFactor(idleTicks, kind = 'character') {
    const p = DECAY[kind] || DECAY.character;
    if (!(idleTicks > p.grace)) return 1;
    return Math.max(0, 1 - p.rate * (idleTicks - p.grace));
}

// 可见性掩码：m = clamp(事件源分量 ÷ 观察者分量 × 情报因子 × 位置因子, 0, 1)。
// 观察者分量 ≤ 0 → 0（零分量即无所见——同尺，无特殊路径）。
export function visibilityMask({ srcWeight, obsWeight, intel = 0, sameLocation = false }) {
    if (!(obsWeight > 0) || !(srcWeight > 0)) return 0;
    const intelFactor = MASK.intelBase + MASK.intelGain * clamp01(intel ?? 0);
    const posFactor = sameLocation ? MASK.posSame : MASK.posDiff;
    // 修边（2026-09-07）：比值部分 clamp 后乘观察者存在感门 min(1, obs/ε)——比值饱和在极小观察者段被线性压回，
    // obs→0 连续趋 0（不再"0.001 全见、恰 0 全瞎"）；obs ≥ ε 时门=1，原公式不变（锁定断言不受影响）。
    const presence = Math.min(1, obsWeight / MASK.obsFloor);
    return clamp01((srcWeight / obsWeight) * intelFactor * posFactor) * presence;
}

export const isVisible = (m) => m >= MASK.threshold;

// 因果传播半径（§3.1）：单调随分量增长；影响范围 = 波及目标数上限。
export function spreadRadius(weight) {
    return RADIUS_BASE + RADIUS_GAIN * clamp01(weight);
}

export function maxRippleTargets(weight) {
    return Math.ceil(RIPPLE_TARGET_GAIN * clamp01(weight));
}

// 供结算器用的衰减后分量：weight' = 公式分 × activityFactor（衰减只作用分量缓存，不改属性——动量分离，长跑 §2.3）。
export function computeWeightAtTick(attrs, kind, tension, idleTicks) {
    return clamp01(computeWeight(attrs, kind, tension) * activityFactor(idleTicks, kind));
}