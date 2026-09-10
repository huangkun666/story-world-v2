// story-world-v2/test/snapshot-replay.test.js
// K23 验收（因果链细案 §3.6 → A-6）：快照 fixture 重放——引擎对历史真模型输出跑回归。
// 断言分层（诚实，快照机制已知局限见下）：
// ① 可重放段（era=post 的 fixture，首个 step-null 之前的所有 tick）：ok 锁（引擎仍接受历史真输出——契约漂移防线）
//    + 锁言行（warnings/gate/playerAffected 逐行相等）；
// ② era=pre-weight-fix（live-11-47/bystander-12-18）：夹具在 K7 真跑后修补（种子 weights 预填）→ 修补前的世界
//    已不存在，其输出在当前夹具上连 ok 锁都不保（step 引用修补前状态 → 校验拒）——历史文物，不进重放面（单独断言存在）；
// ③ step-null 行之后：旧快照未记录中间世界 → 如实跳过（不计入回归面），不假装重放；
//    升级后快照（K23 缺口②，2026-09-08）每 tick 带 world——null 行由世界快照接续（链不断），
//    且每 tick 重放结果与落盘世界逐字节对照（引擎确定性锁）；
// ④ 真样本存在性：新 4 快照 newAgendas 合计 ≥11（台账 12 条含 12-57 t6 红线拦截整步拒的 1 条，如实注明）。
//
// ===================== leg25 c 单维删除后重放基线（2026-09-11） =====================
// 用户令「删」四维浮点（兵力/权位/人脉/耳目）⇒ 契约层 `stateChanges` 整条删除（world-step.schema 注释）。
// 这批快照是**历史真模型输出**，每个 step 都带 `stateChanges` ⇒ 直接重放会被 schema 判「未知字段」整步拒，
// 于是"全锁"退化成"全拒"（回归面归零＝没在回归）。处理方式（本次改动，逐条列明）：
//   ① **从 fixture 里删掉 `stateChanges` 键**（test/fixtures/snapshots/*.json，允许改）。只删这一个键，
//      其余字节与结构不动（改动自检：把该键塞回 null 后与原文档逐字节等价）；
//   ② `expect.warnings` / `expect.player.affected` **按实测重基线**——它们记的原值来自已删除的通道：
//      「裁定: 属性硬边界 / 越界提议被忽略 / stateChanges 无 cause」全是属性裁定的产出；
//      `player.affected` 是 K9 影响通道扣玩家四维的账。两条通道整段删除 ⇒ 那些行**不可能**再出现，
//      留着它们就是"锁一行已经不存在的输出"。重基线=把实测值写回，锁言行的机制本身不动。
//   ③ 统计阈值：可重放 tick 与 newAgendas 真样本数按**实测**核对（下方便是实测断言值，不是拍的）。
// 这一条要老实说清：本次是"删字段 + 重基线"，**不是**"引擎行为回归"。删掉的那批警告背后，
//   是"引擎按 0–1 刻度裁定四维涨跌"这件事整体不存在了——这正是用户要的结果，不是被掩盖的回归。
// ================================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { settleTick } from '../src/settle.js';

const fixtureDir = new URL('./fixtures/snapshots/', import.meta.url);
const fixtureFiles = readdirSync(fixtureDir).filter((f) => f.endsWith('.json'));
assert.ok(fixtureFiles.length >= 7, `快照 fixture ≥7 份（实际 ${fixtureFiles.length}）`);

// leg25 c 断言：fixture 里不得再有已删除的契约字段（防"删了一半"静默复活——旧快照重新落盘时最容易带回来）
test('K23/leg25 c：快照 fixture 里不再有 `stateChanges`（四维浮点已删，契约层整条不存在）', () => {
    let hits = 0;
    for (const f of fixtureFiles) {
        const fx = JSON.parse(readFileSync(new URL(`./fixtures/snapshots/${f}`, import.meta.url), 'utf8'));
        for (const s of fx.steps) if (s.step && 'stateChanges' in s.step) hits += 1;
    }
    assert.equal(hits, 0, `快照 step 里不得带已删除的 stateChanges（实际 ${hits} 处）`);
});

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
        let replayable = true;   // 旧格式（无世界快照）：首个 step-null 起不可重放；升级后快照带 world 全链可接续
        for (const s of fx.steps) {
            if (s.world) {
                world = s.world;   // K23 缺口②：每 tick 落盘的世界——接续重放（step-null 行也不断链）
            } else if (!s.step) {
                replayable = false;
                continue;
            }
            if (!s.step) continue;   // 世界已由快照接续（本行无可执行 step）
            if (!replayable) { totalSkipped += 1; continue; }
            const r = settleTick({ ssot: world, step: s.step, moveFact: s.moveFact, calls: 1 });
            assert.equal(r.ok, true, `${fx.name} tick${s.tick}: ${r.stage.warnings.join('; ')}`);
            totalReplayable += 1;
            assert.deepEqual(r.stage.warnings, s.expect.warnings, `${fx.name} tick${s.tick} warnings 锁言行`);
            if (s.world) assert.deepEqual(r.ssot, s.world, `${fx.name} tick${s.tick} 世界对照锁（引擎确定性）`);
            const sim = r.ssot.meta.simLog.at(-1);
            if (s.expect.gate) {
                assert.deepEqual(sim.silent, s.expect.gate.silent ?? [], `${fx.name} tick${s.tick} gate.silent`);
                assert.deepEqual(sim.lifted, s.expect.gate.lifted ?? [], `${fx.name} tick${s.tick} gate.lifted`);
            }
            if (s.expect.player) {
                // leg25 c：`playerAffected` 的**记录结构**仍在审计面（K9 通道整段删除后恒为空数组），
                //   fixture 里的期望值已按实测重基线为零——本行锁的是"世界伸手碰玩家"这件事**没有**发生。
                assert.deepEqual(sim.playerAffected ?? [], s.expect.player.affected ?? [], `${fx.name} tick${s.tick} playerAffected`);
            }
            world = r.ssot;
        }
    });
}

test('K23：回归面统计——可重放 tick 全过（真模型历史输出仍被引擎接受）且真样本存在', () => {
    // leg25 c 实测基线：可重放 24 tick（原 ≥16 的下界仍成立，故阈值不动；实际值写在报错文案里便于对账）。
    assert.ok(totalReplayable >= 16, `可重放 tick ≥16（实际 ${totalReplayable}，跳过 ${totalSkipped}——旧格式中间世界未记录如实不计；新格式带 world 全链接续）`);
    let totalNa = 0;
    for (const f of fixtureFiles) {
        const fx = JSON.parse(readFileSync(new URL(`./fixtures/snapshots/${f}`, import.meta.url), 'utf8'));
        for (const s of fx.steps) totalNa += (s.step?.newAgendas || []).length;
    }
    assert.ok(totalNa >= 11, `newAgendas 真样本 ≥11（实际 ${totalNa}）`);
});

test('K23 缺口②：带 world 的 step-null 行后仍可重放（合成链：真实步骤 + 引擎世界快照；升级后真跑 fixture 带 world 时循环接续路径自动覆盖）', () => {
    const fx = JSON.parse(readFileSync(new URL('./fixtures/snapshots/bystander-2026-09-08T05-31-51-324Z.json', import.meta.url), 'utf8'));
    const w0 = JSON.parse(readFileSync(new URL(`./fixtures/${fx.sourceWorld}`, import.meta.url), 'utf8'));
    // 引擎逐 tick 重放真实步骤 → 世界链（worlds[i] = capture 应落盘的 t(i+1) 结算后世界）
    const worlds = [];
    let world = w0;
    for (const s of fx.steps) {
        const r = settleTick({ ssot: world, step: s.step, moveFact: s.moveFact, calls: 1 });
        assert.equal(r.ok, true, `链生成 tick${s.tick}`);
        worlds.push(r.ssot);
        world = r.ssot;
    }
    assert.equal(worlds.length, fx.steps.length);
    // 模拟 step-null：t2 不做结算，t3 用 t2 落盘世界接续（缺口②语义：链不断）
    const t3 = settleTick({ ssot: worlds[1], step: fx.steps[2].step, moveFact: fx.steps[2].moveFact, calls: 1 });
    assert.equal(t3.ok, true, 'null 行后世界照常重放');
    assert.deepEqual(t3.ssot, worlds[2], '接续后世界与全链重放结果一致（确定性）');
    // 连续 null：t7 不结算 → t8 仍可重放
    const t8 = settleTick({ ssot: worlds[6], step: fx.steps[7].step, moveFact: fx.steps[7].moveFact, calls: 1 });
    assert.equal(t8.ok, true, '连续 null 行后照常接续');
    assert.deepEqual(t8.ssot, worlds[7], 't8 世界一致');
});