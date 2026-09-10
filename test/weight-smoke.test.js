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
        // leg25 c：`stateChanges` 已随四维浮点从世界步契约删除——生成器不再产它。
        return { actions, newEvents, agendaAdvances, newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] };
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
    // leg25 c 重基线（分量不再吃属性）：base 只余层基线一个常数（人物 1 / 势力 1.5，clamp01 后人物恒为 1）。
    //   故绝对值不再是"0.9 起衰"那套（那是四维加权算出来的），而是**从 1 起、每轮 −0.02**——
    //   动的那部分只有静止衰减（时间事实）。曲线形状（先衰 → 回满 → 再衰）不变，这正是要守的东西。
    const { metrics } = await runSmoke({ ssot: GATED, extractCtx: EXTRACT_FIX.context, ticks: 100, stepGen: gatedStepGen(TRIGGER) });
    const series = metrics.weightSeries;   // 采样: 10,20,...,100
    assert.ok(series[30].e_hi < 1, `t30 e_hi 已衰减 ${series[30].e_hi}`);
    assert.ok(Math.abs(series[40].e_hi - series[30].e_hi) > 0, 't30→t40 继续衰减（单调段）');
    assert.ok(series[40].e_hi < series[30].e_hi, `t40 更深 ${series[40].e_hi} < ${series[30].e_hi}`);
    assert.ok(Math.abs(series[50].e_hi - 1) < 1e-9, `t50 活跃恢复回满 ${series[50].e_hi}`);
    assert.ok(series[60].e_hi < 1, `t60 起再衰减 ${series[60].e_hi}（点名那一刻记账，宽限 8 轮）`);
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
        // leg25 c：`stateChanges` 已随四维浮点从世界步契约删除——生成器不再产它。
        return { actions, newEvents, agendaAdvances, newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] };
    };
}

test('玩家冒烟 100 tick：玩家衰减同尺（OOC 单调 → 落子回升 → 再衰减）+ 影响通道审计面为空', async () => {
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
    // ---- leg25 c：K9 影响通道**已随属性一并删除**，「被人打就扣你的数」这件事不再发生 ----
    //   它扣的是 hardPower/各 attrs，而账上已经没有这些数了（四维浮点整条删除）。
    //   原用例断言的是"−0.05 × 两次 = hardPower 0.25→0.15"与玩家硬实力曲线——**该判据源已不存在，整段删除**。
    //   （红线 1「引擎独占写玩家」本身不变，只是"可写的内容"没了；`playerAffected` 记录照旧留着，
    //     照旧是 K9 审计面——将来若有了新的可写事实，仍从这条通道走。故此处锁的是"通道在、当前为空"。）
    assert.equal(world.meta.simLog[1].playerAffected, undefined, 't2：引擎不再写影响通道（四维已删，无内容可扣）');
    assert.equal(world.meta.simLog[2].playerAffected, undefined, 't3：同上');
    assert.equal(world.meta.simLog.some((s) => s.playerAffected !== undefined), false, '全程零影响通道条目（审计面在、内容为空）');
    // 玩家实体账面上也没有任何数值属性（键都不存在，不是空对象）
    assert.equal(world.entities.find((e) => e.id === 'e_player').attrs, undefined, '玩家账面不带数值属性（四维已删）');
    // ---- 衰减同尺（P-4）：玩家与 NPC **同一公式、同一速率**——久不出手就衰减，落子即回升 ----
    //   判据源换成"时间事实"（多久没出手）而不是编出来的属性分：base 只余层基线（人物 1 / 势力 1.5）。
    const series = metrics.weightSeries;   // 采样: 10,20,...,100
    const D = (v) => Math.abs(v - 1) < 1e-9;   // 人物因子上限 = 基线 1.0（clamp01）
    // idle = tick − lastActiveTick；人物宽限 8 轮（idle ≥ 9 才起衰）、之后每轮 −2%：
    //   因子 = 1 − 0.02×(idle − 8)。
    //   实测口径（本轮确认）：玩家在 t2/t3 被 e_xie/e_wanfa **点名**（进 lifted）并不记活跃——
    //   活跃记账只认本人出手/推进/入局（settle.js §K3），被点名不是出手。故玩家 lastActiveTick 到 t40 前
    //   一直是夹具初值 0 → t10 idle=10 → 0.96。
    assert.ok(Math.abs(series[10].e_player - 0.96) < 1e-9, `t10 宽限外首衰（idle 10 → 1−0.02×2）实际 ${series[10].e_player}`);
    assert.ok(Math.abs(series[20].e_player - 0.76) < 1e-9, `t20 衰减（idle 20 → 1−0.02×12）实际 ${series[20].e_player}`);
    assert.ok(Math.abs(series[30].e_player - 0.56) < 1e-9, `t30 衰减深（idle 30 → 1−0.02×22）实际 ${series[30].e_player}`);
    assert.ok(series[20].e_player < series[10].e_player && series[30].e_player < series[20].e_player, 'OOC 段单调衰减');
    assert.equal(D(series[40].e_player), true, `t40 落子回升回满（moveFact.verb 非空 → 记活跃）实际 ${series[40].e_player}`);
    assert.equal(D(series[50].e_player), true, 't50 仍在宽限内（落子轮 t40-49 持续记账 → idle 1 < 8）');
    assert.ok(series[60].e_player < series[50].e_player, `t60 起再衰减 ${series[60].e_player}`);
    assert.ok(series[100].e_player < 0.2, `t100 站桩一路萎缩 ${series[100].e_player}（时间事实，不是编的分）`);
    // 同尺的**实质**（P-4）：玩家不吃任何特例——它走的就是**同 kind 的同一张衰减表**。
    //   `computeWeight` 已不吃属性（层基线一个常数），动的那部分只有 `activityFactor`（时间事实）：
    //     人物（character）：宽限 8 轮，之后每轮 −2%
    //     势力（faction）  ：宽限 20 轮，之后每轮 −1%
    //   夹具实况（据实核对，勿想当然）：e_player = kind=character（玩家是人物），
    //   而 e_dayu「大虞偏将」/ e_xie「薛铁衣」/ e_wanfa「万法阁」**三个都是 kind=faction**
    //   （偏将是势力实体）——故本文件里唯一的人物就是玩家自己。
    //   这正是"同尺"的含义：同 kind 同表，不是全场一个数（势力走各自那张表）。
    const { computeWeightAtTick } = await import('../src/weight.js');
    // 活跃记账口径（与 settle.recomputeWeights 同源）：idle = tick − (lastActiveTick ?? 0)。
    // 提到最前定义：下面多处要用（原先定义在文件后段，前面用会静默取到 undefined —— 实测踩过）。
    const laOf = (id) => {
        const raw = world.entities.find((e) => e.id === id).lastActiveTick;
        return typeof raw === 'number' ? raw : 0;
    };
    const kindOf = (id) => world.entities.find((e) => e.id === id).kind;
    assert.equal(kindOf('e_player'), 'character', '玩家是人物（走人物衰减表）');
    assert.equal(kindOf('e_dayu'), 'faction', '偏将是势力实体（据夹具；勿当人物）');
    assert.equal(kindOf('e_xie'), 'faction');
    // ① 公式复算（逐点）：只对**终态 lastActiveTick 与全程同值**的实体成立——它们的 idle 单调、无相位重置。
    //   玩家不入此循环：它的 lastActiveTick 在 t40-49 被落子改写（终态 49 不能反推 t10 的 idle）。
    //   玩家的逐点正确性改由 ② 的"冻结窗"与上面的显式曲线断言共同锁定。
    for (const id of ['e_dayu', 'e_xie']) {
        const kind = kindOf(id);
        const raw = world.entities.find((e) => e.id === id).lastActiveTick;
        const la = typeof raw === 'number' ? raw : 0;   // 口径对齐 settle.recomputeWeights：idle = tick − (la ?? 0)
        for (const t of [30, 60, 80, 100]) {
            const predicted = computeWeightAtTick(null, kind, world.context.tension, t - la);
            assert.ok(Math.abs(series[t][id] - predicted) < 1e-9,
                `${id}（${kind}）t${t} 实测 ${series[t][id]} = 公式预测 ${predicted}`);
        }
    }
    // ② 玩家：t49 落子后 lastActiveTick 冻结在 49（终态可证），故 t60 起玩家与"idle = t − 49"的公式完全吻合。
    const playerLa = world.entities.find((e) => e.id === 'e_player').lastActiveTick;
    assert.equal(playerLa, 49, '落子段把玩家活跃记到最后一次落子（t49）');
    for (const t of [60, 80, 100]) {
        const predicted = computeWeightAtTick(null, 'character', world.context.tension, t - playerLa);
        assert.ok(Math.abs(series[t].e_player - predicted) < 1e-9,
            `e_player t${t} 实测 ${series[t].e_player} = 公式预测 ${predicted}（同 kind 同表，玩家无特例）`);
    }
    // ③ 速率：人物 0.02/轮、势力 0.01/轮（各自的表）——**按公式算出的预测差**，不写"Δ = 速率×轮数"。
    //   leg25 c 实测教训（勿改回去）：删掉属性项后，人物的基础分恒被 clamp 在 1.0，**张力那条腿被吃掉**，
    //   于是人物曲线"每轮恰好 −0.02"；而势力基线 0.85 **不贴顶**，张力腿**现在是可见的** ⇒ 势力曲线的
    //   每轮差 = `0.01 × 轮数 × 层基线 × envFactor`，不再等于 0.01×轮数（实测 t60→t70 Δ0.0867）。
    //   旧断言之所以看着对，是因为旧法下势力也被钳在 1 —— 那是 clamp 的假象，不是衰减的真实行为。
    //   故此处一律以公式为真源：Δ实测 必须等于 公式在 t1/t2 两点之差；再补一条单调衰减（行为断言）。
    const RATE = { character: 0.02, faction: 0.01 };
    for (const [t1, t2] of [[60, 70], [80, 90], [60, 100]]) {
        const predOf = (id, kind, la) => computeWeightAtTick(null, kind, world.context.tension, t1 - la)
            - computeWeightAtTick(null, kind, world.context.tension, t2 - la);
        const dC = series[t1].e_player - series[t2].e_player;
        const dF = series[t1].e_xie - series[t2].e_xie;
        assert.ok(Math.abs(dC - predOf('e_player', 'character', playerLa)) < 1e-9,
            `t${t1}→t${t2} 人物 Δ 与公式一致（实测 ${dC.toFixed(4)}）`);
        assert.ok(Math.abs(dF - predOf('e_xie', 'faction', laOf('e_xie'))) < 1e-9,
            `t${t1}→t${t2} 势力 Δ 与公式一致（实测 ${dF.toFixed(4)}）`);
        assert.ok(dC > 0, `t${t1}→t${t2} 人物单调衰减（Δ${dC.toFixed(4)}）`);
        assert.ok(dF > 0, `t${t1}→t${t2} 势力单调衰减（Δ${dF.toFixed(4)}）`);
        // 各自的表：人物速率表 0.02 / 势力 0.01（常量仍在案，防无声改动）
        assert.equal(RATE.character, 0.02);
        assert.equal(RATE.faction, 0.01);
    }
    // 相位/类别差异如实记录：t10 玩家已在衰（早就过 8 轮宽限）而势力 NPC 还没起衰（宽限 20 轮）——
    //   这正说明"同尺"是**同 kind 同表**，不是"全场同一个数"（旧断言拿绝对数跨类别比，等于把相位/类别当尺）。
    //   leg25 c：旧法下势力也被 clamp 在 1，玩家已衰 ⇒ `玩家 < 势力` 恒成立，那条断言看着对；
    //   势力基线改 0.85 后该序不再必然成立（实测 t10 玩家 0.96 > 薛铁衣 0.867）——**这正是它本来就不可靠的证据**。
    //   改为**相位断言**（这才是注释声称要验的东西）：
    //     idle 10 → 人物已过宽限期 ⇒ 已衰；势力还在宽限内 ⇒ 因子恒 1、**未衰**。
    //   ⚠️ 两条"反推历史"的坑（实测踩过，勿重犯）：终态 `world.context.tension`（0.6）不是 t10 的张力；
    //     终态 `lastActiveTick`（玩家 49）也不是 t10 的（玩家 t40-49 落子才被改写）。
    //     ⇒ **系列采样值不做公式复算**（历史相位不可从终态还原），只做"纯函数相位锁" + 行为断言。
    const { activityFactor, FACTION_BASELINE } = await import('../src/weight.js');
    assert.equal(activityFactor(10, 'character') < 1, true, '人物：idle 10 > 宽限 8 ⇒ 因子 < 1（已衰）');
    assert.equal(activityFactor(10, 'faction'), 1, '势力：idle 10 < 宽限 20 ⇒ 因子恒 1（未衰）');
    assert.ok(series[10].e_player < 1, `t10 玩家已衰（实测 ${series[10].e_player} < 1）`);
    assert.ok(Math.abs(series[10].e_xie - FACTION_BASELINE) < 0.11,
        `t10 势力在宽限内 ⇒ 贴近层基线 ${FACTION_BASELINE}（只被张力项小幅调制）：实测 ${series[10].e_xie}`);
    assert.ok(series[10].e_player < series[20].e_player * 2, '玩家在 OOC 段一路下探（t10 → t20 继续衰）');
    // 世界干净：无静默滤除、仅 t2/t3 玩家被点名应答、零警告、输入恒在预算
    assert.equal(metrics.droppedTotal, 0);
    assert.equal(metrics.liftedTotal, 2);
    assert.equal(metrics.warningsTotal, 0);
    assert.ok(metrics.maxPackTokens <= EVOLUTION_BUDGET_TOKENS, `输入峰 ${metrics.maxPackTokens}`);
    console.log(`[K11 曲线·leg25 c] 玩家 100t: 影响通道 0 条（随四维删除） · 衰减同尺 t10 ${series[10].e_player.toFixed(4)} → t20 ${series[20].e_player.toFixed(4)} → t30 ${series[30].e_player.toFixed(4)} → 落子回升 t40 ${series[40].e_player.toFixed(4)} → t60 ${series[60].e_player.toFixed(4)} → t100 ${series[100].e_player.toFixed(4)}`);
});