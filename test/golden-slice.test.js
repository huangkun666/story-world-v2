// story-world-v2/test/golden-slice.test.js
// 切片黄金样本：最小活棋盘冻结样本——一世界、一实体（大荒商帮）、一条盘算。
// 锚点锁 + schema 锁（S2 起）+ 引擎确定性锁/体积锁（S5 起：同输入同输出逐字节一致；结算后体积受界）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { settleTick } from '../src/settle.js';
import { FACTION_BASELINE } from '../src/weight.js';   // leg25 c：势力层基线（唯一真源——断言不抄字面量）

const RAW = JSON.parse(
    readFileSync(new URL('./fixtures/golden-world.min.json', import.meta.url), 'utf8')
);

test('黄金样本：可解析且版本为 1', () => {
    assert.equal(RAW.version, 1);
});

test('黄金样本：SSOT 四样 + 上下文齐备', () => {
    assert.ok(Array.isArray(RAW.entities), 'entities 是数组');
    assert.ok(RAW.weights && typeof RAW.weights === 'object', '分量缓存占位存在');
    assert.ok(Array.isArray(RAW.agendas), 'agendas 是数组');
    assert.ok(Array.isArray(RAW.events), 'events 是数组');
    assert.ok(Array.isArray(RAW.chronicle), 'chronicle 是数组');
    assert.equal(typeof RAW.context.tension, 'number', '张力为静态常量（大势层暂缓）');
});

test('黄金样本：实体/盘算/事件锚点（一世界一实体一盘算，零事件零编年）', () => {
    assert.equal(RAW.entities.length, 1);
    assert.equal(RAW.entities[0].name, '大荒商帮');
    assert.equal(RAW.entities[0].location, '临渊城', '位置取自世界状态（事件位置合法性前置）');
    assert.equal(RAW.agendas.length, 1);
    assert.equal(RAW.agendas[0].owner, 'e_merchant');
    assert.equal(RAW.agendas[0].maxSteps, 4, '盘算必须能在世界时间里结算（§4.5）');
    assert.equal(RAW.events.length, 0);
    assert.equal(RAW.chronicle.length, 0);
    assert.equal(RAW.meta.tick, 0);
});

test('黄金样本：位置集 ⊆ 世界状态（切片 §3.2 的前置形状）', () => {
    const positions = RAW.context.positions;
    assert.deepEqual(new Set(positions), new Set(['临渊城', '边关', '商路']));
    assert.ok(positions.includes(RAW.entities[0].location), '实体驻点必须在位置集内');
});

test('黄金样本：通过 SSOT schema 校验（S2 真 schema 强制）', () => {
    const r = validate(RAW, ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
});

// ---- 三锁之引擎确定性锁 + 锚点锁 + 体积锁（S5）----
// leg25 c（单维删除）重基线：本文件的 CANONICAL_STEP 原先还带一条
//   `stateChanges: [{entity:'e_merchant', attr:'network', delta:0.05, cause:'a_1'}]`。
//   四维浮点（兵力/权位/人脉/耳目）随用户令整条删除 ⇒ 契约层 `stateChanges` 也没了 ⇒ 夹具必须去掉它
//   （不去掉的话 schema 判"未知字段"、整步被拒，三把锁全都锁在"被拒的世界"上，等于没锁）。
//   去掉之后受影响的两个锚点按**实测值**重基线，并在原处注明理由（见下方两条用例的注释）。
const CANONICAL_STEP = () => ({
    actions: [{ entity: 'e_merchant', verb: '沿商路北上巡查', position: '商路' }],
    newEvents: [{ title: '守将允诺通关', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: ['e_merchant'] }],
    agendaAdvances: [{ agendaId: 'a_1', step: '守将首肯，车队放行', stage: '过边关' }],
    newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
});

test('黄金样本：引擎确定性（同输入同 step → 逐字节一致）', () => {
    const a = settleTick({ ssot: RAW, step: CANONICAL_STEP() });
    const b = settleTick({ ssot: RAW, step: CANONICAL_STEP() });
    assert.equal(a.ok, true);
    assert.equal(JSON.stringify(a.ssot), JSON.stringify(b.ssot), '结算管线纯函数，无隐式状态');
});

test('黄金样本：标准 tick 后的世界锚点', () => {
    const w = settleTick({ ssot: RAW, step: CANONICAL_STEP() }).ssot;
    assert.equal(w.meta.tick, 1);
    assert.equal(w.events.length, 1);
    assert.equal(w.events[0].id, 'ev_1_1');
    assert.equal(w.agendas[0].progress, 2);
    // leg25 c 重基线（原值 3）：编年原为「推进 1 条 + 事件 1 条 + **属性变更 1 条**」。
    //   属性变更那一条的来源正是 stateChanges（leg24 片4「每条变更留痕」），该通道整条删除 ⇒ 只剩 2 条。
    assert.equal(w.chronicle.length, 2, '推进 1 条 + 事件 1 条（属性变更那条随 stateChanges 通道一并消失）');
    // 顺带锁住"消失的那条"确实没了：编年里不再有任何属性变更行
    assert.ok(!w.chronicle.some((c) => /兵力|权位|人脉|耳目|hardPower|office|network|intel/.test(c.text)),
        '编年不再出现属性变更行（四维不存在了）');
    assert.equal(w.meta.simLog.length, 1);
    // leg25 c 重基线（原值 0.705）：分量公式**不再吃属性**——大荒商帮是势力 ⇒ 基础分＝FACTION_BASELINE；
    //   张力 0.5（中立）⇒ envFactor = 1 + 0.2×(0.5−0.5) = 1；本轮出手 ⇒ 静止因子 1。
    //   故分量 == FACTION_BASELINE，**断言不写字面量**（改基线则本用例随之成立，同 worldstep 的上限用例口径）。
    //   旧值 0.705 来自"attrs 0.5/0.4/0.65/0.4 → base 0.47 × 1.5"——那套折算已随四维删除（weight.js 注释）。
    assert.equal(w.weights.e_merchant, FACTION_BASELINE,
        `分量应为层基线（不吃属性）${FACTION_BASELINE}，实际 ${w.weights.e_merchant}`);
    // leg25 c：实体账上不再有 attrs 键（schema 也不再接受它）；夹具本体已摘除该键
    assert.equal('attrs' in w.entities[0], false, '实体不再带 attrs（四维浮点整条删除）');
    assert.equal(w.entities[0].lastActiveTick, 1, '本轮出手 → 活跃记账照旧（这是时间事实，不是编的强弱）');
});

test('黄金样本：序列化体积受界（防膨胀/防缩水）', () => {
    const w = settleTick({ ssot: RAW, step: CANONICAL_STEP() }).ssot;
    const len = JSON.stringify(w).length;
    assert.ok(len > 400 && len < 4000, `结算后体积 ${len} 应在 [400, 4000] 区间`);
});