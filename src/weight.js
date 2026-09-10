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
export const MASK = {                         // 可见性掩码（leg24 片3：**改成事实驱动**，不再用分量）
    intelBase: 0.5, intelGain: 0.5,          // intelFactor = 0.5 + 0.5×情报
    posSame: 1.0, posDiff: 0.5,              // 同位置 / 异位置（位置图为符号集，二元判定为能力上限）
    threshold: 0.25,                         // m < 0.25 → 注入侧省略该事实（片3：原 0.3 是配合比值项的调参值）
};
// leg24 片3 删除位：`obsFloor`（观察者存在感门 ε=0.05 修边）随比值项一并删除——
//   它当年修的是"obs→0 断崖"这个**只存在于比值公式里**的毛病；比值没了，毛病也就不存在了。
export const RADIUS_BASE = 1;                 // 因果传播半径：radius = 1 + 3×weight
export const RADIUS_GAIN = 3;
export const RIPPLE_TARGET_CAP = 3;           // 提案（片3）：一次事件波及目标数上限（原 ceil(2×分量)→固定值）


const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// leg24 片2（账本换血）：账面**没有**四维数值时，公式按**中立值**算中性 floor（character 0.5 / faction 0.75）。
// 为什么要有这个 floor：账本不再预填任何数值（空着就是空着），若把"没有数据"当成 0，
//   全世界开局分量全 0 → 门控把所有人判静默、掩码 obs=0 让谁都不见 → 世界直接冻死。
// 这不是"替实体编数值"：①它不落账（账面上这些键**根本不存在**，可验证）②同 kind 一律同值，不含任何个体信息
//   ③语义诚实——**"不知道"不等于"很弱"**（旧法把未知当 0.15，才让"没数据的角色"看起来像客观的弱者）。
// 真值只从模型提议来（settle 钳制落账）；片3 会把"谁值得动"的排序换成确定性粗规则，届时 floor 只留作兜底。
export const NEUTRAL_ATTR = { hardPower: 0.5, office: 0.5, network: 0.5, intel: 0.5 };

// 分量 = clamp(基础分 × 层级基线 × 环境修正, 0, 1)。缺键按**中立值**（见上）；
// 张力缺省取静态常量。空 attrs / 缺某一维 = 该维"账面无数" → 取中立值，不取 0。
// "客观 = 确定性计算 + 有界输入"（dev-process 红线④）：引擎只算，上游属性由模型提议、结算器钳制。
export function computeWeight(attrs = {}, kind = 'character', tension = NEUTRAL_TENSION) {
    const coeffs = COEFFS[kind] || COEFFS.character;
    let base = 0;
    for (const [name, w] of Object.entries(coeffs)) base += (attrs[name] ?? NEUTRAL_ATTR[name] ?? 0) * w;
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

// 可见性掩码（leg24 片3：**事实驱动**）：m = 情报因子 × 位置因子。
// 旧法 m = (源分量 ÷ 观察者分量) × 情报 × 位置 × 存在感门——用户拍板删掉那个数之后：
//   ①比值项失去意义（它拿两个"没法客观"的分数相除）；②"零分量观察者无所见"的短路会让**新世界开局
//   玩家什么都看不见**（全员账面无数 → 观察者分量只有中立 floor，且一旦为 0 就全瞎）。
// 现法只吃两样可查的事实：**情报关系**（有多少耳目）与**位置**（同地/异地）——都能从账本数出来，零歧义。
export function visibilityMask({ intel = 0, sameLocation = false }) {
    const intelFactor = MASK.intelBase + MASK.intelGain * clamp01(intel ?? 0);
    const posFactor = sameLocation ? MASK.posSame : MASK.posDiff;
    return clamp01(intelFactor * posFactor);
}

export const isVisible = (m) => m >= MASK.threshold;

// 因果传播半径（§3.1）：单调随分量增长；影响范围 = 波及目标数上限。
export function spreadRadius(weight) {
    return RADIUS_BASE + RADIUS_GAIN * clamp01(weight);
}

// 波及目标数上限（leg24 片3）：由 ceil(2×分量) 改为**固定提案值**——用户拍板删掉那个数。
export function maxRippleTargets() {
    return RIPPLE_TARGET_CAP;
}

// 供结算器用的衰减后分量：weight' = 公式分 × activityFactor（衰减只作用分量缓存，不改属性——动量分离，长跑 §2.3）。
export function computeWeightAtTick(attrs, kind, tension, idleTicks) {
    return clamp01(computeWeight(attrs, kind, tension) * activityFactor(idleTicks, kind));
}