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

test('重量冒烟 100 tick：e_lo 静默 147 条滤除（t1-49）、t50 应答窗口 t50-52、终结产果联闭后不再被点名、零意外警告（恰 1 条预期）', async () => {
    const { world, metrics } = await runSmoke({ ssot: GATED, extractCtx: EXTRACT_FIX.context, ticks: 100, stepGen: gatedStepGen(TRIGGER) });
    assert.equal(metrics.ticks, 100);
    // t1-49：e_lo 静默（行动+推进+plot 各 1 → 3/tick）；t50 起被点名应答，窗口 t50-52（a_lo 满步 → plot 事件联闭 → 不再被点名）
    assert.equal(metrics.droppedTotal, 49 * 3, `滤除累计 ${metrics.droppedTotal}`);
    // 点名应答：e_lo t50-52 共 3 tick（events.closed 关闭路径已清，台账"窗口开到盘算满步结算"预言兑现）；
    // e_mid t37 起衰减至阈值下变静默，被 ev_p（state 源常驻）点名 → 63 tick（state 事件不联闭，语义不变）
    assert.equal(metrics.liftedTotal, 3 + 63, `点名应答累计 ${metrics.liftedTotal}`);
    const liftedBy = (id) => world.meta.simLog.filter((s) => s.lifted?.includes(id)).length;
    assert.equal(liftedBy('e_lo'), 3, 'e_lo 应答窗口 t50-52（终结产果联闭后不再被点名）');
    assert.equal(liftedBy('e_mid'), 63, 'e_mid 衰减入静默后被 ev_p 常驻点名');
    // 执行债（events.closed 关闭路径）：a_lo 满步结算 → 其 plot 事件全部闭环；t53 起 gate 不再点名 e_lo
    // K20 归档：t52 联闭 → t72 满热窗出热池入里程碑（闭环保真由里程碑 ids 承接）
    const archived = new Set((world.milestones || []).flatMap((m) => m.ids));
    for (const id of ['ev_50_1', 'ev_51_1', 'ev_52_1']) {
        assert.ok(!world.events.some((e) => e.id === id), `${id} 已出热池（t72 归档）`);
        assert.ok(archived.has(id), `${id} 终结产果联闭后入里程碑`);
    }
    const liftsAfter = world.meta.simLog.slice(52).filter((s) => s.lifted?.includes('e_lo')).length;
    assert.equal(liftsAfter, 0, '闭环后 e_lo 不再被点名（t53+ 归入静默）');
    const log50 = world.meta.simLog[TRIGGER - 1];
    assert.ok(log50.lifted.includes('e_lo'), 'tick50 点名解除静默（事件波及 → 应答窗口开启；e_mid 同刻已衰减入静默被 ev_p 常驻点名，同现于名单）');
    assert.ok(!Object.values(log50.silentDropped ?? {}).reduce((a, b) => a + b, 0), 'tick50 无滤除');
    const aLo = world.agendas.find((a) => a.id === 'a_lo');
    assert.equal(aLo.progress, 3, '应答窗口内 t50-52 各推进 1 → 满步');
    assert.equal(aLo.closed, true, '满步强制结算（终结产果）');
    assert.equal(metrics.warningsTotal, 1, '零意外警告：唯一 = tick50 e_hi 无在飞盘算仍行动（预期集合精确）');
    const droppedTicks = world.meta.simLog.filter((s) => Object.values(s.silentDropped ?? {}).reduce((a, b) => a + b, 0) === 3).length;
    assert.equal(droppedTicks, 49, '滤除只发生在 t1-49');
    assert.ok(metrics.maxPackTokens <= EVOLUTION_BUDGET_TOKENS, `输入峰 ${metrics.maxPackTokens}`);
    assert.ok(metrics.peakOpenAgendas <= SLICE_AGENDA_CAP, `在飞峰 ${metrics.peakOpenAgendas}`);
    assert.equal(metrics.newbornsTotal, 0);
    assert.ok(metrics.newbornsTotal <= SLICE_NEWBORN_CAP);
    // 体积：gated 100 tick = 3 实体 + 100 条 simLog（含审计字段）→ 界放宽到 50KB；K20 归档台阶允许下降（t72 出热池）
    const sizes = metrics.bytes.map((b) => b.bytes);
    for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] >= sizes[i - 1] - 8000, `归档台阶允许下降 ${sizes[i]} < ${sizes[i - 1]}（t${metrics.bytes[i].tick}）`);
    const finalBytes = JSON.stringify(world).length;
    assert.ok(finalBytes < 50000, `终态体积 ${finalBytes} < 50KB`);
    console.log(`[K6 曲线] 100t: 输入峰 ${metrics.maxPackTokens}/4000 · 在飞峰 ${metrics.peakOpenAgendas}/≤15 · 新生 0/≤2 · 滤除累计 ${metrics.droppedTotal}（t1-49） · 点名应答窗口 t50-52（联闭后如台账预言闭环） · 警告 1（预期） · 终态 ${JSON.stringify(world).length}B`);
});

test('重量冒烟：衰减曲线分段单调（e_lo t10-40 递减 → t50 活跃回满 → 窗口期恒 1 → 再衰减）', async () => {
    const { world, metrics } = await runSmoke({ ssot: GATED, extractCtx: EXTRACT_FIX.context, ticks: 100, stepGen: gatedStepGen(TRIGGER) });
    const series = metrics.weightSeries;   // 采样: 10,20,...,100
    const keys = Object.keys(series).map(Number);
    for (const k of keys) {
        if (k === 50) continue;   // 活跃恢复点是允许的回升
        const idx = keys.indexOf(k);
        if (idx === 0) continue;
        const prevK = keys[idx - 1];
        assert.ok(series[k].e_lo <= series[prevK].e_lo + 1e-12, `e_lo 非活跃段应单调非增：${series[k].e_lo} > ${series[prevK].e_lo} @t${k}`);
    }
    assert.ok(series[40].e_lo < 0.05, `t40 深度衰减 ${series[40].e_lo}`);
    assert.ok(Math.abs(series[50].e_lo - 0.1) < 1e-9, `t50 活跃恢复回满 ${series[50].e_lo}`);
    assert.ok(Math.abs(series[60].e_lo - 0.1) < 1e-9, `t60 窗口期恒 1（idle≤宽限）${series[60].e_lo}`);
    assert.ok(series[100].e_lo < 0.05, `t100 满步后再衰减 ${series[100].e_lo}`);
    // e_hi：t30 递减中 < 0.9；t50 活跃 → 回满 0.9；t60 起再衰减
    assert.ok(series[30].e_hi < 0.9, `t30 e_hi 已衰减 ${series[30].e_hi}`);
    assert.ok(Math.abs(series[50].e_hi - 0.9) < 1e-9, `t50 活跃恢复回满 ${series[50].e_hi}`);
    assert.ok(series[60].e_hi < 0.9, 't60 起再衰减');
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
    // 影响通道（K9 系数提案值实证，K11 校准素材）：t2 e_xie targeting、t3 e_wanfa targeting → 各 −0.05×min(1, w_src/w_player)，强源 ratio=1
    const pa2 = world.meta.simLog[1].playerAffected;
    assert.equal(pa2.length, 1, 't2 单笔影响');
    assert.equal(pa2[0].tick, 2);
    assert.equal(pa2[0].source, 'e_xie');
    assert.equal(pa2[0].attr, 'hardPower');
    assert.ok(Math.abs(pa2[0].delta - -0.05) < 1e-9, `delta 容差（浮点记差），实际 ${pa2[0].delta}`);
    assert.ok(Math.abs(pa2[0].ratio - 1) < 1e-12);
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
    console.log(`[K11 曲线] 玩家 100t: 影响 ${pa2[0].source}/${pa3[0].source} ratio=${pa2[0].ratio} · 衰减 t10 ${series[10].e_player.toFixed(4)} → t20 ${series[20].e_player.toFixed(4)} → t30 ${series[30].e_player.toFixed(4)} → 落子回升 t40 ${series[40].e_player.toFixed(4)} → t100 ${series[100].e_player.toFixed(4)}`);
});