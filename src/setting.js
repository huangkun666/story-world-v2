// story-world-v2/src/setting.js
// 设定池读写面（K25/设定大势层，细案 §3.3 → A-4）：context.setting 全池（frozen+dynamic）
// 对模型不可写——本模块给引擎两件工具：
//   1) isSettingRef(s)：保留键空间判词——'setting' 与 'setting.*' 恒为引擎领地，
//      任何世界步实体引用字段命中即拒绝（check-step 集成；红线 1 同机制：校验拒绝、世界如实不动）；
//   2) patchDynamic(setting, patch)：演化层引擎独占写通道——纯函数、不可变、[0,1] 钳制。
//      调用方 = 引擎自身（K27 环境推演器/熵泵、K29 浪尖派生器）；模型无直写路径
//      （world-step schema 无设定池写面）。
// "事件可改（联动状态源事件）"的规则落地在 K27 环境推演器 tick 段——那里才有事件落地上下文。

export function isSettingRef(s) {
    return typeof s === 'string' && (s === 'setting' || s.startsWith('setting.'));
}

export function patchDynamic(setting, patch) {
    // patch: { key, delta } —— env 键小步增量；新键基线 0.5（提案态，随 K27 键表报批）
    if (!setting || typeof setting !== 'object' || !setting.dynamic) return setting;
    const env = setting.dynamic.env ?? {};
    const cur = typeof env[patch.key] === 'number' ? env[patch.key] : 0.5;
    const next = Math.min(1, Math.max(0, cur + patch.delta));
    return {
        ...setting,
        dynamic: { ...setting.dynamic, env: { ...env, [patch.key]: next } },
    };
}

// ---- 事件 id 契约共享解析器（ev_<tick>_<n> / ev_pump_<tick>_<n> / m_<n>——取首个数字段）----
// 单一契约点：settle 的 bornTickOf 与本处同源（防两处各自演化）。
export function eventBornTick(id) {
    const seg = String(id || '').split('_').find((s) => /^\d+$/.test(s));
    const n = seg === undefined ? NaN : Number(seg);
    return Number.isInteger(n) && n >= 0 ? n : -Infinity;   // 解析失败按"老账"（不占活跃度窗口）
}

// ---- K29 张力强度算法（细案 §3.1 要点 + T3 方向：事件频次 × 分量比 × 衰减——先曲线后报批，铁律 2/8）----
// 强度 = 引擎确定性计算（模型不拍，world-step 无此写面）；数字全部提案态，K29 曲线为报批素材。
export const TENSION_WINDOW = 10;      // 提案：活跃度观察窗（tick，含熵泵等全部近期事件）
export const TENSION_FREQ_DIV = 4;     // 提案：频次归一除数（窗内 4 事件 = 满频）
export const TENSION_INERTIA = 0.9;    // 提案：每 tick 惯性衰减（记忆系数——冷清时强度不骤跌）
export const TENSION_BLEND = { freq: 0.6, rival: 0.4 };   // 提案：压力合成权重

export function computeTensionIntensity(world, tick) {
    const recent = (world.events || []).filter((e) => tick - eventBornTick(e.id) <= TENSION_WINDOW).length;
    const freq = Math.min(1, recent / TENSION_FREQ_DIV);
    const ws = Object.values(world.weights || {}).sort((a, b) => b - a);
    const w1 = ws[0] ?? 0;
    const w2 = ws[1] ?? 0;
    const rival = w1 > 0 && w2 > 0 ? Math.min(1, Math.min(w1, w2) / Math.max(w1, w2)) : 0;   // 两强对峙度（接近=1，独强=0）
    const pressure = TENSION_BLEND.freq * freq + TENSION_BLEND.rival * rival;
    const prev = world.context?.setting?.dynamic?.tension?.intensity ?? 0.5;
    return Math.min(1, Math.max(0, prev * TENSION_INERTIA + (1 - TENSION_INERTIA) * pressure));
}

export function updateTensionIntensity(world, tick) {
    // settle 每 tick 调用（重算分量之后）——写入 dynamic.tension.intensity（引擎独占；模型无直写路径）
    const setting = world.context?.setting;
    if (!setting?.dynamic?.tension) return;
    const intensity = computeTensionIntensity(world, tick);
    world.context.setting = {
        ...setting,
        dynamic: { ...setting.dynamic, tension: { ...setting.dynamic.tension, intensity } },
    };
}