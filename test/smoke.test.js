// story-world-v2/test/smoke.test.js
// S7 验收：50 tick 合成冒烟——预算/增长/GC 数字实证/确定性/警告清零。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runSmoke, assertSmoke, DEFAULT_TICKS } from '../src/smoke.js';

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/golden-world.min.json', import.meta.url), 'utf8'));
const EXTRACT_FIX = JSON.parse(readFileSync(new URL('./fixtures/extract-samples.json', import.meta.url), 'utf8'));

test('冒烟 50 tick：全部断言通过（预算/增长/GC 实证/零警告）', async () => {
    const { world, metrics } = await runSmoke({ ssot: GOLDEN, extractCtx: EXTRACT_FIX.context });
    assert.equal(metrics.ticks, DEFAULT_TICKS);

    const a = assertSmoke({ world, metrics });
    assert.deepEqual(a.errors, []);

    assert.equal(metrics.closedAtTick, 3, 'a_1 在第 3 tick 满步强制结算（1/4→4/4）');
    assert.equal(metrics.peakOpenAgendas, 1, '在飞峰 1（≤15 提案实证）');
    assert.equal(metrics.newbornsTotal, 0, '生半 0（≤2 提案实证，切片无创建路径）');
    assert.ok(metrics.maxPackTokens > 0 && metrics.maxPackTokens <= 4000, `输入峰 ${metrics.maxPackTokens} tokens`);
    assert.equal(metrics.bytes[metrics.bytes.length - 1].tick, 50, '曲线采样到末 tick');

    const worldFinal = world;
    assert.equal(worldFinal.agendas[0].closed, true);
    // leg24 片3：编年 6 → 7 行——多出的一行是**闲置退休「淡出」**（片3 起退休判据=久未露面 + 无在办的事 + 无未决引用，
    //   全程无戏份的实体在 t20 扫描轮退二线）。这是设计要的行为（全册在账、可被点名复归），不是坏账。
    assert.equal(worldFinal.chronicle.length, 7, '编年：3 推进 + 1 终结 + 1 事件 + 1 闭环 + 1 淡出（执行债 events.closed 已清，2026-09-07）');
    assert.equal(worldFinal.meta.simLog.length, 50, '逐 tick 台账');
    assert.equal(worldFinal.events.length, 0, '事件出热池（t3 闭环 → t23 满热窗归档，K20——账本收敛实证）');
    assert.ok((worldFinal.milestones || []).some((m) => m.ids.includes('ev_2_1')), '唯一事件（advanceStep(0) 无事件，t2 落账 ev_2_1）入里程碑（归档保真：ids 可回溯）');
});

test('冒烟：增长曲线单调且受界', async () => {
    const { world, metrics } = await runSmoke({ ssot: GOLDEN, extractCtx: EXTRACT_FIX.context });
    const sizes = metrics.bytes.map((b) => b.bytes);
    for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] >= sizes[i - 1], `字节单调 ${sizes[i]} < ${sizes[i - 1]}`);
    assert.ok(JSON.stringify(world).length < 20000, '终态受界');
});

test('冒烟：确定性（两次 50 tick 逐字节一致）', async () => {
    const a = await runSmoke({ ssot: GOLDEN, extractCtx: EXTRACT_FIX.context });
    const b = await runSmoke({ ssot: GOLDEN, extractCtx: EXTRACT_FIX.context });
    assert.equal(JSON.stringify(a.world), JSON.stringify(b.world));
});