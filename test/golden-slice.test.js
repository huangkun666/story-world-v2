// story-world-v2/test/golden-slice.test.js
// 切片黄金样本：最小活棋盘冻结样本——一世界、一实体（大荒商帮）、一条盘算。
// 锚点锁 + schema 锁（S2 起）+ 引擎确定性锁/体积锁（S5 起：同输入同输出逐字节一致；结算后体积受界）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { settleTick } from '../src/settle.js';

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
const CANONICAL_STEP = () => ({
    actions: [{ entity: 'e_merchant', verb: '沿商路北上巡查', position: '商路' }],
    newEvents: [{ title: '守将允诺通关', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: ['e_merchant'] }],
    agendaAdvances: [{ agendaId: 'a_1', step: '守将首肯，车队放行', stage: '过边关' }],
    stateChanges: [{ entity: 'e_merchant', attr: 'network', delta: 0.05, cause: 'a_1' }],
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
    assert.equal(w.chronicle.length, 3, '推进 1 条 + 事件 1 条 + 属性变更 1 条（leg24 片4「每条变更留痕」：stateChanges 落账入编年，此前只进 simLog 警告）');
    assert.equal(w.meta.simLog.length, 1);
    // 锚点更新（K2 重算切真公式）：重算在 stateChanges 落账后 → attrs 0.5/0.4/0.65/0.4 → base 0.47 × 基线 1.5 = 0.705
    assert.ok(Math.abs(w.weights.e_merchant - 0.705) < 1e-9, `权重应为公式值 0.705，实际 ${w.weights.e_merchant}`);
    assert.equal(w.entities[0].attrs.network, 0.65);
});

test('黄金样本：序列化体积受界（防膨胀/防缩水）', () => {
    const w = settleTick({ ssot: RAW, step: CANONICAL_STEP() }).ssot;
    const len = JSON.stringify(w).length;
    assert.ok(len > 400 && len < 4000, `结算后体积 ${len} 应在 [400, 4000] 区间`);
});