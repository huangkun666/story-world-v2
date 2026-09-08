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