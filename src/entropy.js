// story-world-v2/src/entropy.js
// 熵泵摩擦制造（K27/设定大势层，细案 §3.5 → A-6；longrun §2.3 收口——世界不冷却的"摩擦"来源）。
// 环境推演器：每 ENV_TICK 一步，dynamic.env 各键按确定性锯齿表推小步（数字已定案——2026-09-08
//   报批二批 #1-8；曲线 = 台账 L70/L72）；
// 越阈 → 引擎生成状态源事件（熵泵事件：编年可见、挂事件链、可作盘算挂因 = source.event 未决）；
// 环境回落越过回缓带 → 引擎闭环（与"常驻保留"不冲突：状态源常驻规则约束的是自动闭环路径，
//   熵泵事件的生命周期由生成它的引擎自管——闭环/再发周期即泵的节奏）；
// 同种熵泵事件未决时不重复落（防刷屏）；事件 id 契约 ev_pump_<tick>_<n>（引擎生成器，格式同族，
//   bornTickOf 数字段扫描兼容）。
// 零创作纪律：事件只从环境量阈值落，模型不发明（world-step schema 无熵泵写面；A-5 断言随 K29 冒烟）。

import { patchDynamic } from './setting.js';

export const ENV_TICK = 3;        // 定案（报批二批 #1）：每 3 tick 一步（T5 拍板初案）
export const ENV_DRIFT_STEP = 0.06;   // 定案（报批二批 #2）：单步漂移量
export const ENV_KEYS = ['民生度', '动乱度', '天时', '张力推手'];   // 定案（报批二批 #3）：T5 键表（形状已拍）

// 锯齿周期（先 down 后 up 的相位数）；dir = 首段方向（相位 1 起推——可达极值 = 首段相位数-1 步：
// dir=+1 的键要够到危险带，down 须 ≥ at/步长+1——动乱度/张力推手 down=6 时峰值恰 0.80）
const SAW = {
    '民生度': { down: 6, up: 5, dir: -1 },
    '动乱度': { down: 6, up: 5, dir: +1 },
    '天时': { down: 7, up: 6, dir: -1 },
    '张力推手': { down: 6, up: 5, dir: +1 },
};

// 危险带（越阈触发熵泵事件）/ 回缓带（= at 同向 + 0.1 余量，恢复闭环）——全部定案（报批二批 #4-7）
export const BANDS = {
    '民生度': { dir: -1, at: 0.25, rec: 0.35, kind: '民生凋敝', title: '熵泵·民生凋敝：劳役征发四起' },
    '动乱度': { dir: +1, at: 0.75, rec: 0.65, kind: '动乱四起', title: '熵泵·动乱四起：匪患横行' },
    '天时': { dir: -1, at: 0.2, rec: 0.3, kind: '天时不作美', title: '熵泵·天时不作美：旱涝连年' },
    '张力推手': { dir: +1, at: 0.8, rec: 0.7, kind: '大势紧绷', title: '熵泵·大势紧绷：各方异动' },
};

function sawStep(key, phase) {
    const c = SAW[key];
    const p = phase % (c.down + c.up);
    return (p < c.down ? c.dir : -c.dir) * ENV_DRIFT_STEP;
}

const openEntropyOf = (world, kind) =>
    (world.events || []).find((e) => !e.closed && e.id.startsWith('ev_pump_') && e.title.startsWith(`熵泵·${kind}`));

// 引擎 tick 段（settle 挂接点：closeEvents 之后、chronicleEvents 之前）——操作 structuredClone 后的世界。
export function pulseEntropy(world, tick, chronicle) {
    const setting = world.context?.setting;
    if (!setting?.dynamic) return;   // 无设定池世界：熵泵不启动（旁观/旧世界零扰动）
    if (tick % ENV_TICK !== 0) return;
    const phase = Math.floor(tick / ENV_TICK);
    let s = setting;
    for (const key of ENV_KEYS) s = patchDynamic(s, { key, delta: sawStep(key, phase) });   // K25 写通道（引擎独占写）
    const env = s.dynamic.env;
    // 回缓闭环（先于越阈判定：两个带不相交）
    for (const [key, conf] of Object.entries(BANDS)) {
        const recovered = conf.dir < 0 ? env[key] > conf.rec : env[key] < conf.rec;
        const ev = recovered && openEntropyOf(world, conf.kind);
        if (ev) {
            ev.closed = true;
            ev.closedAt = tick;
            chronicle.push({ id: `ch_${tick}_pumpC_${ev.id}`, tick, text: `熵泵·${conf.kind} 缓和（${key} ${env[key].toFixed(2)}，环境回落）`, kind: 'state' });
        }
    }
    // 越阈落事件：危险带内且无同种未决熵泵事件 → 引擎生成状态源事件（可作盘算挂因）
    let n = 1;
    for (const [key, conf] of Object.entries(BANDS)) {
        const inDanger = conf.dir < 0 ? env[key] <= conf.at : env[key] >= conf.at;
        if (!inDanger) continue;
        if (openEntropyOf(world, conf.kind)) continue;
        const ev = {
            id: `ev_pump_${tick}_${n++}`,
            title: conf.title,
            source: { type: 'state' },
            position: world.context.positions[0],   // 定案（报批二批 #8）：熵泵事件落位置集首项（处境无特定驻点）
            ripples: [],
            links: { up: [], down: [] },
            closed: false,
        };
        world.events.push(ev);
        chronicle.push({
            id: `ch_${tick}_pump_${ev.id}`,
            tick,
            text: `${conf.title}（${key} ${env[key].toFixed(2)}，环境量越阈，处境上桌）`,
            kind: 'state',
        });
    }
    world.context.setting = s;
}