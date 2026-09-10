// story-world-v2/test/weight-smoke.test.js
// K6 验收（分量引擎细案 §4 K6）：100 tick 门控冒烟——低分量方全程静默（V1 统计形态）、
// 被点名应答样本（tick 50）、衰减曲线单调（V3 曲线形态）、活跃恢复回满、输入预算/体积/GC 界内、
// 零意外警告（预期 1 条一致性）、确定性逐字节。曲线数字在此落台账（铁律 8）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runSmoke, SLICE_AGENDA_CAP, SLICE_NEWBORN_CAP } from '../src/smoke.js';
import { EVOLUTION_BUDGET_TOKENS } from '../src/pack.js';

const GATED = JSON.parse(readFileSync(new URL('./fixtures/gated-world.json', import.meta.url), 'utf8'));
const EXTRACT_FIX = JSON.parse(readFileSync(new URL('./fixtures/extract-samples.json', import.meta.url), 'utf8'));

const TRIGGER = 50;   // 点名样本：tick 50 时 e_hi 传唤 e_lo（e_hi 无在飞盘算 → 恰 1 条预期一致性警告）

function gatedStepGen(tick) {
    return (t, world) => {
        const open = world.agendas.filter((a) => !a.closed);
        const actions = open.map((a) => ({ entity: a.owner, verb: '推进', position: '边城' }));
        const newEvents = open.map((a) => ({
            title: `局面演进（${a.goal}）`, source: { type: 'plot', ref: a.id }, position: '边城', ripples: [a.owner],
        }));
        const agendaAdvances = open.map((a) => ({ agendaId: a.id, step: `第 ${t} 步`, stage: '推进' }));
        if (t === TRIGGER) actions.push({ entity: 'e_hi', verb: '传唤', target: 'e_lo', position: '边城' });
        return { actions, newEvents, agendaAdvances, stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] };
    };
}

test('重量冒烟 100 tick（leg24 片3 结构门控重基线）：静默面=无在办 ∧ 久未出手 ∧ 无人点名；t50 点名应答；联闭归档；零意外警告', async () => {
    const { world, metrics } = await runSmoke({ ssot: GATED, extractCtx: EXTRACT_FIX.context, ticks: 100, stepGen: gatedStepGen(TRIGGER) });
    assert.equal(metrics.ticks, 100);
    // 判据已换（旧法看分量）：本生成器只为"开着的盘算"提案（而开着盘算=活跃），所以**本轮没有可滤的提议**；
    // 静默面依旧照实记录，只是没人替静默方说话。滤除 147→0 是判据换了，不是机制坏了。
    assert.equal(metrics.droppedTotal, 0, `滤除累计 ${metrics.droppedTotal}（片3：生成器不为静默方提案）`);
    const silentBy = (id) => world.meta.simLog.filter((s) => s.silent?.includes(id)).length;
    const liftedBy = (id) => world.meta.simLog.filter((s) => s.lifted?.includes(id)).length;
    // e_lo：盘算已终结 + 从没出手 → **全程结构静默**（100 tick）；t50 被 e_hi 动作点名 → 唯一一次应答窗口
    assert.equal(silentBy('e_lo'), 100, 'e_lo 全程静默（结构判据）');
    assert.equal(liftedBy('e_lo'), 1, 'e_lo 仅 t50 被点名那一次解除静默');
    // e_mid：前 3 tick 有在办盘算 → 活跃；盘算终结后过 QUIET_TICKS 落入静默，被 ev_p（state 源常驻）点名
    assert.equal(silentBy('e_mid'), 34, 'e_mid 盘算终结后入静默');
    assert.equal(liftedBy('e_mid'), 34, 'e_mid 被 ev_p 常驻点名（同一时段）');
    assert.equal(liftedBy('e_hi'), 0, 'e_hi 始终活跃（有在办盘算）→ 无静默可解除');
    assert.equal(metrics.liftedTotal, 35, `点名应答累计 ${metrics.liftedTotal}`);
    // 事件链（片3 重基线）：本夹具的 a_lo 已终结（→ e_lo 结构静默），生成器只为"开着的盘算"出 plot 事件，
    // 故没有随 e_lo 应答窗产生新事件；ev_p（state 源）常驻未决照旧在册。原"ev_50_1 等闭环归档"断言随之失效。
    assert.ok(world.events.every((e) => e.closed === false), '未决事件池照旧（ev_p 常驻）');
    const liftsAfter = world.meta.simLog.slice(52).filter((s) => s.lifted?.includes('e_lo')).length;
    assert.equal(liftsAfter, 0, 't53 起 e_lo 不再被点名');
    const log50 = world.meta.simLog[TRIGGER - 1];
    assert.ok(log50.lifted.includes('e_lo'), 'tick50 点名解除静默（事件波及 → 应答窗口开启）');
    assert.ok(!Object.values(log50.silentDropped ?? {}).reduce((a, b) => a + b, 0), 'tick50 无滤除');
    const aLo = world.agendas.find((a) => a.id === 'a_lo');
    assert.equal(aLo.closed, true, 'a_lo 已终结（夹具：盘算已完成 → 静默）');
    assert.equal(metrics.warningsTotal, 1, '零意外警告：唯一 = tick50 e_hi 无在飞盘算仍行动（预期集合精确）');
    assert.ok(metrics.maxPackTokens <= EVOLUTION_BUDGET_TOKENS, `输入峰 ${metrics.maxPackTokens}`);
    assert.ok(metrics.peakOpenAgendas <= SLICE_AGENDA_CAP, `在飞峰 ${metrics.peakOpenAgendas}`);
    assert.equal(metrics.newbornsTotal, 0);
    // 体积：gated 100 tick = 3 实体 + 100 条 simLog（含审计字段）→ 界放宽到 50KB；K20 归档台阶允许下降（t72 出热池）
    const sizes = metrics.bytes.map((b) => b.bytes);
    for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] >= sizes[i - 1] - 8000, `归档台阶允许下降 ${sizes[i]} < ${sizes[i - 1]}（t${metrics.bytes[i].tick}）`);
    const finalBytes = JSON.stringify(world).length;
    assert.ok(finalBytes < 50000, `终态体积 ${finalBytes} < 50KB`);
    console.log(`[K6 曲线·leg24 片3 重基线] 100t: 输入峰 ${metrics.maxPackTokens}/4000 · 在飞峰 ${metrics.peakOpenAgendas}/≤15 · 新生 0/≤2 · 滤除 ${metrics.droppedTotal}（旧判据 147——生成器不为静默方提案） · 静默面 e_mid 34 / e_lo 100 tick · 应答累计 ${metrics.liftedTotal} · 警告 1（预期） · 终态 ${finalBytes}B`);
});

test('重量冒烟（片3 重基线）：衰减曲线分段单调（以 e_hi 为例：t30 已衰减 → t50 活跃回满 → t60 起再衰减）', async () => {
    // 旧版盯 e_lo：它曾是"长期静默方"的样本；片3 换判据后 e_lo 从没出过手（无 lastActiveTick）→ 静止衰减
    //   根本不作用于它（衰减只对"曾经活跃过的人"计时）。改盯 e_hi——它在 t50 有一次点名动作，曲线完整。
    const { metrics } = await runSmoke({ ssot: GATED, extractCtx: EXTRACT_FIX.context, ticks: 100, stepGen: gatedStepGen(TRIGGER) });
    const series = metrics.weightSeries;   // 采样: 10,20,...,100
    assert.ok(series[30].e_hi < 0.9, `t30 e_hi 已衰减 ${series[30].e_hi}`);
    assert.ok(Math.abs(series[40].e_hi - series[30].e_hi) > 0, 't30→t40 继续衰减（单调段）');
    assert.ok(series[40].e_hi < series[30].e_hi, `t40 更深 ${series[40].e_hi} < ${series[30].e_hi}`);
    assert.ok(Math.abs(series[50].e_hi - 0.9) < 1e-9, `t50 活跃恢复回满 ${series[50].e_hi}`);
    assert.ok(series[60].e_hi < 0.9, `t60 起再衰减 ${series[60].e_hi}（点名那一刻记账，宽限 8 轮）`);
    assert.ok(series[100].e_hi < series[60].e_hi, `t100 更深 ${series[100].e_hi} < ${series[60].e_hi}`);
    // 该实体的曲线与门控/衰减耦合，逐点数值不写死；只锁"t50 之后确实一路衰减下去"这一条结构性质。
    assert.ok(series[100].e_lo < series[10].e_lo, `e_lo 从 t50 被点名后一路衰减 ${series[10].e_lo} → ${series[100].e_lo}`);
});

test('重量冒烟：确定性（两次 100 tick 逐字节一致）', async () => {
    const a = await runSmoke({ ssot: GATED, extractCtx: EXTRACT_FIX.context, ticks: 100, stepGen: gatedStepGen(TRIGGER) });
    const b = await runSmoke({ ssot: GATED, extractCtx: EXTRACT_FIX.context, ticks: 100, stepGen: gatedStepGen(TRIGGER) });
    assert.equal(JSON.stringify(a.world), JSON.stringify(b.world));
    assert.deepEqual(a.metrics, b.metrics);
});

// ---------- 玩家档案 K11：玩家衰减同尺 + 影响通道系数曲线（含玩家 100t 冒烟，P-4 断言） ----------

const PLAYER_WORLD = JSON.parse(readFileSync(new URL('./fixtures/player-world.json', import.meta.url), 'utf8'));

function playerSmokeStepGen(t) {
    return (t2, world) => {
        const open = world.agendas.filter((a) => !a.closed);
        const actions = open.map((a) => ({ entity: a.owner, verb: '推进', position: '江州' }));
        const newEvents = open.map((a) => ({
            title: `局势变化（${a.goal}）`, source: { type: 'plot', ref: a.id }, position: '江州', ripples: [a.owner],
        }));
        const agendaAdvances = open.map((a) => ({ agendaId: a.id, step: `第 ${t2} 步`, stage: '推进' }));
        if (t2 === 2) actions.push({ entity: 'e_xie', verb: '发兵', target: 'e_player', position: '大盘谷' });
        if (t2 === 3) actions.push({ entity: 'e_wanfa', verb: '袭扰', target: 'e_player', position: '北山' });
        return { actions, newEvents, agendaAdvances, stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] };
    };
}

test('玩家冒烟 100 tick：影响通道系数曲线（t2/t3）+ 玩家衰减同尺（OOC 单调 → 落子回升 → 再衰减）', async () => {
    // 三方盘算按夹具 maxSteps 自然结算（t3/t4 闭）→ 事件随之联闭，演化上下文不膨胀（未决事件无产率上限，队列项）
    // 摘除常驻 state 事件对三方阵营的点名（ev_0 波及——常驻点名语义已由 gated 曲线锁定），聚焦玩家曲线
    const world0 = structuredClone(PLAYER_WORLD);
    world0.events[0].ripples = [];
    const PLAY_DIALOGUE = EXTRACT_FIX.samples.find((s) => s.id === 'l61').dialogue;   // 词表命中 verb=修炼 → 落子轮
    const dialogueGen = (t) => (t >= 40 && t <= 49 ? PLAY_DIALOGUE : '（静默）');
    const { world, metrics } = await runSmoke({
        ssot: world0, extractCtx: EXTRACT_FIX.context, ticks: 100,
        stepGen: playerSmokeStepGen(2), dialogueGen,
    });
    assert.equal(metrics.ticks, 100);
    // 影响通道（K9 固定系数，leg24 片3：ratio 折减已随分量退场）：t2 e_xie targeting、t3 e_wanfa targeting → 各 −0.05
    const pa2 = world.meta.simLog[1].playerAffected;
    assert.equal(pa2.length, 1, 't2 单笔影响');
    assert.equal(pa2[0].tick, 2);
    assert.equal(pa2[0].source, 'e_xie');
    assert.equal(pa2[0].attr, 'hardPower');
    assert.ok(Math.abs(pa2[0].delta - -0.05) < 1e-9, `delta 容差（浮点记差），实际 ${pa2[0].delta}`);
    assert.equal(pa2[0].ratio, undefined, '片3：不再记 ratio（那个数已退场）');
    const pa3 = world.meta.simLog[2].playerAffected;
    assert.equal(pa3[0].source, 'e_wanfa');
    assert.ok(Math.abs(pa3[0].delta - -0.05) < 1e-9);
    const hp = world.entities.find((e) => e.id === 'e_player').attrs.hardPower;
    assert.ok(Math.abs(hp - 0.15) < 1e-12, `两次 targeting 共 −0.10，实际 ${hp}`);
    // 衰减同尺（P-4）：同实体公式（人物 8 tick/−2%）——OOC 段单调衰减、落子段 t40 记 active 回升、t50 后复衰减
    const series = metrics.weightSeries;
    assert.ok(Math.abs(series[10].e_player - 0.204 * 0.96) < 1e-9, `t10 宽限外首衰 ${series[10].e_player}`);   // 影响后 base 0.204 × 0.96
    assert.ok(Math.abs(series[20].e_player - 0.204 * 0.76) < 1e-9, `t20 衰减 ${series[20].e_player}`);
    assert.ok(Math.abs(series[30].e_player - 0.204 * 0.56) < 1e-9, `t30 衰减深 ${series[30].e_player}`);
    assert.ok(Math.abs(series[40].e_player - 0.204) < 1e-9, `t40 落子回升回满 ${series[40].e_player}`);   // hardPower 0.15 → base 0.20×1.02；active → 因子 1
    assert.ok(Math.abs(series[50].e_player - 0.204) < 1e-9, 't50 仍在宽限（idle 1）');
    assert.ok(series[60].e_player < series[50].e_player, 't60 起再衰减');
    assert.ok(series[100].e_player < 0.05, `t100 站桩权力萎缩 ${series[100].e_player}`);
    // 世界干净：无静默滤除（三方分量足）、仅 t2/t3 玩家被点名应答、零警告、输入恒在预算
    assert.equal(metrics.droppedTotal, 0);
    assert.equal(metrics.liftedTotal, 2);
    assert.equal(metrics.warningsTotal, 0);
    assert.ok(metrics.maxPackTokens <= EVOLUTION_BUDGET_TOKENS, `输入峰 ${metrics.maxPackTokens}`);
    console.log(`[K11 曲线] 玩家 100t: 影响 ${pa2[0].source}/${pa3[0].source}（固定系数 −0.05） · 衰减 t10 ${series[10].e_player.toFixed(4)} → t20 ${series[20].e_player.toFixed(4)} → t30 ${series[30].e_player.toFixed(4)} → 落子回升 t40 ${series[40].e_player.toFixed(4)} → t100 ${series[100].e_player.toFixed(4)}`);
});