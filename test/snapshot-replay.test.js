// story-world-v2/test/snapshot-replay.test.js
// K23 验收（因果链细案 §3.6 → A-6）：快照 fixture 重放——引擎对历史真模型输出跑回归。
// 断言分层（诚实，快照机制已知局限见下）：
// ① 可重放段（era=post 的 fixture，首个 step-null 之前的所有 tick）：ok 锁（引擎仍接受历史真输出——契约漂移防线）
//    + 锁言行（warnings/gate/playerAffected 逐行相等）；
// ② era=pre-weight-fix（live-11-47/bystander-12-18）：夹具在 K7 真跑后修补（种子 weights 预填）→ 修补前的世界
//    已不存在，其输出在当前夹具上连 ok 锁都不保（step 引用修补前状态 → 校验拒）——历史文物，不进重放面（单独断言存在）；
// ③ step-null 行之后：快照未记录中间世界（meta.tick 偏移 → 后续 step 引用悬空 id 等），不可复现——
//    如实跳过（不计入回归面），不假装重放；
// ④ 真样本存在性：新 4 快照 newAgendas 合计 ≥11（台账 12 条含 12-57 t6 红线拦截整步拒的 1 条，如实注明）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { settleTick } from '../src/settle.js';

const fixtureDir = new URL('./fixtures/snapshots/', import.meta.url);
const fixtureFiles = readdirSync(fixtureDir).filter((f) => f.endsWith('.json'));
assert.ok(fixtureFiles.length >= 7, `快照 fixture ≥7 份（实际 ${fixtureFiles.length}）`);

let totalReplayable = 0;
let totalSkipped = 0;

for (const f of fixtureFiles.sort()) {
    const fx = JSON.parse(readFileSync(new URL(`./fixtures/snapshots/${f}`, import.meta.url), 'utf8'));
    if (fx.meta?.era === 'pre-weight-fix') {
        test(`K23 历史文物：${fx.name}（era=pre-weight-fix——夹具修补前世界，不可重放，保留在案）`, () => {
            assert.ok(fx.steps.length >= 1, '文物快照存在（记录可查）');
        });
        continue;
    }
    const world0 = JSON.parse(readFileSync(new URL(`./fixtures/${fx.sourceWorld}`, import.meta.url), 'utf8'));
    test(`K23 快照重放：${fx.name}（可重放 ${fx.steps.filter((s) => s.step).length}/${fx.steps.length} tick · 全锁）`, () => {
        let world = world0;
        let replayable = true;   // 首个 step-null 起不可重放（中间世界未记录）
        for (const s of fx.steps) {
            if (!s.step) { replayable = false; continue; }
            if (!replayable) { totalSkipped += 1; continue; }
            const r = settleTick({ ssot: world, step: s.step, moveFact: s.moveFact, calls: 1 });
            assert.equal(r.ok, true, `${fx.name} tick${s.tick}: ${r.stage.warnings.join('; ')}`);
            totalReplayable += 1;
            assert.deepEqual(r.stage.warnings, s.expect.warnings, `${fx.name} tick${s.tick} warnings 锁言行`);
            const sim = r.ssot.meta.simLog.at(-1);
            if (s.expect.gate) {
                assert.deepEqual(sim.silent, s.expect.gate.silent ?? [], `${fx.name} tick${s.tick} gate.silent`);
                assert.deepEqual(sim.lifted, s.expect.gate.lifted ?? [], `${fx.name} tick${s.tick} gate.lifted`);
            }
            if (s.expect.player) {
                assert.deepEqual(sim.playerAffected ?? [], s.expect.player.affected ?? [], `${fx.name} tick${s.tick} playerAffected`);
            }
            world = r.ssot;
        }
    });
}

test('K23：回归面统计——可重放 tick 全过（真模型历史输出仍被引擎接受）且真样本存在', () => {
    assert.ok(totalReplayable >= 16, `可重放 tick ≥16（实际 ${totalReplayable}，跳过 ${totalSkipped}——快照中间世界未记录，如实不计）`);
    let totalNa = 0;
    for (const f of fixtureFiles) {
        const fx = JSON.parse(readFileSync(new URL(`./fixtures/snapshots/${f}`, import.meta.url), 'utf8'));
        for (const s of fx.steps) totalNa += (s.step?.newAgendas || []).length;
    }
    assert.ok(totalNa >= 11, `newAgendas 真样本 ≥11（实际 ${totalNa}）`);
});