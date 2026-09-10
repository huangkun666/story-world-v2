// story-world-v2/test/tree-smoke.test.js
// K16 验收（盘算树细案 §4 K16 → A-2/A-3/A-4 静态形态 + V9 延续）：树世界 100 tick 冒烟——stepGen 带
// newAgendas 样本（超限三连提 / 周期性 state+parent 提议 / e_min 静默滤除样本）；断言集：GC 三档上限
// （每 tick ≤2 / 在飞 ≤15 / 顶层 ≤5）、静默滤除累计、拒建警告精确集合、委派/变形/兑现落痕、预算体积界内。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runSmoke, SLICE_AGENDA_CAP, SLICE_NEWBORN_CAP, SLICE_TOP_CAP } from '../src/smoke.js';
import { EVOLUTION_BUDGET_TOKENS } from '../src/pack.js';

const TREE = JSON.parse(readFileSync(new URL('./fixtures/tree-world.json', import.meta.url), 'utf8'));
const EXTRACT_FIX = JSON.parse(readFileSync(new URL('./fixtures/extract-samples.json', import.meta.url), 'utf8'));

const na = (entity, goal, source) => ({ entity, goal, visibility: 'known', source });

// K16 stepGen（确定性）：全员在飞盘算推进 + 三类 newAgendas 样本——
// ① t1 三连提议（超限样本：2 落 1 拒 + 大厦顶警告）② 每 5 tick 周期提议（state 顶层 / parent 委派交替，
// parent ref 取在飞顶层——动态防悬空）③ e_min 每 10 tick 静默提议（被 gate 滤除，双面无痕样本）。
function treeStepGen(t, world) {
    const open = world.agendas.filter((a) => !a.closed);
    const actions = open.map((a) => ({ entity: a.owner, verb: '推进', position: '主帐' }));
    const newEvents = open.map((a) => ({
        title: `局面演进（${a.goal}）`, source: { type: 'plot', ref: a.id }, position: '主帐', ripples: [a.owner],
    }));
    const agendaAdvances = open.map((a) => ({ agendaId: a.id, step: `第 ${t} 步`, stage: '推进' }));
    const newAgendas = [];
    if (t === 1) {
        newAgendas.push(
            na('e_lead', '超编提议 A', { type: 'state' }),
            na('e_court', '超编提议 B', { type: 'state' }),
            na('e_lead', '超编提议 C', { type: 'state' }),
        );   // 超限样本：第 3 条拒建 + 警告（盘算大厦顶）
    }
    if (t % 5 === 0 && t < 100) {
        if ((t / 5) % 2 === 0) {
            newAgendas.push(na('e_lead', `新策第${t}计`, { type: 'state' }));   // state 源 → 顶层盘算
        } else {
            const parents = open.filter((a) => !a.parentId);
            if (parents.length) newAgendas.push(na('e_court', `分办第${t}务`, { type: 'parent', ref: parents[0].id }));   // 委派样本
        }
    }
    if (t % 10 === 0) newAgendas.push(na('e_min', '越权建言', { type: 'state' }));   // 静默滤除样本
    return { actions, newEvents, agendaAdvances, stateChanges: [], newAgendas, agendaCancels: [], newEntities: [], entityFates: [] };
}

test('K16 树冒烟 100 tick：GC 三档上限实证 + 拒建警告精确集合 + 静默滤除累计 + 委派/变形/兑现落痕', async () => {
    const { world, metrics } = await runSmoke({ ssot: TREE, extractCtx: EXTRACT_FIX.context, ticks: 100, stepGen: treeStepGen });
    assert.equal(metrics.ticks, 100);
    // 通用断言器（assertSmoke）不适用：其口径为切片级（零警告 + 20KB 界）；树冒烟按本测试集合断言（铁律 8：曲线先例）
    // A-3 GC 三档上限（引擎执行实证）：每 tick 新生 ≤2 / 在飞 ≤15 / 顶层 ≤5
    assert.ok(metrics.maxPerTickBirths <= SLICE_NEWBORN_CAP, `每 tick 新生峰 ${metrics.maxPerTickBirths}`);
    assert.ok(metrics.peakOpenAgendas <= SLICE_AGENDA_CAP, `在飞峰 ${metrics.peakOpenAgendas}`);
    assert.ok(metrics.peakTopLevel <= SLICE_TOP_CAP, `顶层峰 ${metrics.peakTopLevel}`);
    assert.equal(metrics.rejectedTotal, 1, '唯一拒建 = t1 超编提议 C（盘算大厦顶 ×1）');
    assert.equal(metrics.warningsTotal, 1, '警告精确集合：恰 1 条（t1 大厦顶）；无一致性/裁定/坏账警告');
    // A-2 静默滤除（双面无痕统计）：**leg24 片3 判据换成结构三条件后，滤除量从 310 掉到 8**——
    //   旧法靠"分量低于阈值"把大批实体摁成静默；新法里"手上有在办盘算"就活跃（a_son2 正因此在飞），
    //   只有真正三条件齐（无在办 ∧ 久未出手 ∧ 无人点名）的少数提议被滤。这正是用户要的方向。
    assert.equal(metrics.droppedTotal, 8, `滤除累计 ${metrics.droppedTotal}（片3：结构判据，只剩真正"没你的事"的提议）`);
    assert.equal(metrics.liftedTotal, 0, '无点名样本 → 零应答');
    // A-4 树形态：委派落账（parentId 存在）+ 父 promises 写 + 兑现落痕 + 变形托孤
    // leg24 片3：带 parentId 的落账 11 → 2——同一台生成器，但门控换了判据：**周期提议方在提议那一刻
    //   已经"结构静默"**（手上无在办盘算 + 超过 QUIET_TICKS 没出手 + 无人点名），提议被如实滤除；
    //   落下来的 2 条正是"提议时其父盘算仍开着"的委派样本。断言改为结构性质（委派能落账且带父链）。
    const withParent = world.agendas.filter((a) => a.parentId);
    assert.ok(withParent.length >= 2, `委派落账 ≥2 条（片3 口径），实际 ${withParent.length}`);
    const son2 = world.agendas.find((a) => a.id === 'a_son2');
    // leg24 片3 语义变化（旧断言"a_son2 断父链转独立"不再成立，原因值得记住）：
    //   旧法 a_son2 长期静默 → 它的推进全被滤 → 永远停在 1/3 → 父终结时它仍"在飞" → 走托孤断链分支；
    //   新法它活跃、按步推进、与父同轮满步 → **它是"达成"而不是"被托孤"**，故 closed=true 且保留 parentId。
    //   真正要守的不变式是：**不能留下"还开着、却挂着一个已终结的父亲"的盘算**（悬挂死父）。改锁这一条。
    assert.equal(son2.closed, true, '片3：a_son2 照常按步推进 → 满步达成');
    assert.ok(son2.progress >= son2.maxSteps, `达成证据 ${son2.progress}/${son2.maxSteps}`);
    const dangling = world.agendas.filter((a) => !a.closed && a.parentId
        && (world.agendas.find((p) => p.id === a.parentId)?.closed ?? false));
    assert.deepEqual(dangling.map((a) => a.id), [], '无"开着却挂着已终结之父"的悬挂盘算（托孤不变式）');
    // 委派契约（片3 口径）：凡带父链的盘算，其父必须在册；且**至少有一个父盘算记下了委派**（promises 写入）。
    //   （旧断言"a_son2.promises ≥9"绑定的是旧门控下"a_son2 是唯一在飞顶层"的偶然事实，片3 换判据后不再成立。）
    for (const a of withParent) {
        assert.ok(world.agendas.some((p) => p.id === a.parentId), `父链可回溯：${a.id} → ${a.parentId}`);
    }
    assert.ok(world.agendas.some((a) => (a.memory?.promises?.length ?? 0) >= 1), '有父盘算记下了委派（promises 写入）');
    assert.ok(world.agendas.some((a) => (a.memory?.done ?? []).some((d) => d.includes('兑现'))), '有委派子达成 → 兑现落痕（done）');
    assert.ok(world.chronicle.some((c) => c.text.includes('变形') && c.text.includes('事业移交诸子')), '变形编年（托孤分支别处照常触发）');
    assert.ok(world.chronicle.some((c) => c.text.includes('达成')), '达成编年存在');
    assert.ok(!world.chronicle.some((c) => c.text.includes('败露')), '零伤害冒烟无败露（语义精确区分）');
    // V9 延续：预算 / 体积（事件池无裁剪=已知队列项，随因果链强化阶段——界 80KB 防膨胀回归）
    assert.ok(metrics.maxPackTokens <= EVOLUTION_BUDGET_TOKENS, `输入峰 ${metrics.maxPackTokens}/4000`);
    const sizes = metrics.bytes.map((b) => b.bytes);
    for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] >= sizes[i - 1], `字节单调 ${sizes[i]} < ${sizes[i - 1]}`);
    assert.ok(sizes[sizes.length - 1] < 80000, `终态 ${sizes[sizes.length - 1]}B < 80KB`);
    console.log(`[K16 曲线] 树 100t（leg24 片3 结构门控）: 输入峰 ${metrics.maxPackTokens}/4000 · 在飞峰 ${metrics.peakOpenAgendas}/≤15 · 顶层峰 ${metrics.peakTopLevel}/≤5 · 新生 ${metrics.newbornsTotal}（每 tick 峰 ${metrics.maxPerTickBirths}/≤2） · 拒建 ${metrics.rejectedTotal} · 滤除 ${metrics.droppedTotal}（旧判据下 310） · 委派 ${withParent.length}（旧 11） · 警告 ${metrics.warningsTotal} · 终态 ${sizes[sizes.length - 1]}B`);
});

test('K16 树冒烟：确定性（两次 100 tick 逐字节一致）', async () => {
    const a = await runSmoke({ ssot: TREE, extractCtx: EXTRACT_FIX.context, ticks: 100, stepGen: treeStepGen });
    const b = await runSmoke({ ssot: TREE, extractCtx: EXTRACT_FIX.context, ticks: 100, stepGen: treeStepGen });
    assert.equal(JSON.stringify(a.world), JSON.stringify(b.world));
    assert.deepEqual(a.metrics, b.metrics);
});