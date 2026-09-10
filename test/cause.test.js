// story-world-v2/test/cause.test.js
// K5 验收（分量引擎细案 §3.5/§3.6 + §4 K5 → V5/V7）：
//   **leg24 片3 改写**——原"低分量动作方按分量比折减（幅度单调 V5）"整块删除：用户拍板引擎不裁胜负，
//   而"弱方打强方打不动"就是这个数在替引擎裁胜负。现薄裁定只剩两件事：**属性边界钳制** + **静默方自我增强被拒**。
//   保留：静默方自我增强被拒（actor 缺省 + 静默 → 归零）、cause 坏账前置报警（无 cause 记警告）。
// 说明：K5 的"方向相悖"报警无裁决对象（薄裁定器只按量不产胜负，ANCHOR 未决点 3 之魂），登记未决不实现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settleTick } from '../src/settle.js';

const GATED = JSON.parse(readFileSync(new URL('./fixtures/gated-world.json', import.meta.url), 'utf8'));

const sc = (entity, attr, delta, extra = {}) => ({ entity, attr, delta, ...extra });
const stepWith = (changes) => ({ actions: [], newEvents: [], agendaAdvances: [], stateChanges: changes, newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] });

test('裁定（片3）：强弱不再影响生效幅度——同一条提议，谁打谁都全量生效', () => {
    // 旧法：0.9/0.1 比 ≥1 → 全量；0.1→0.9 方向 → 折减到 0.0556。现法：两个方向都全量。
    const strong = settleTick({ ssot: GATED, step: stepWith([sc('e_lo', 'hardPower', -0.05, { actor: 'e_hi', cause: 'ev_p' })]) });
    assert.equal(strong.ok, true);
    assert.ok(Math.abs(strong.ssot.entities.find((e) => e.id === 'e_lo').attrs.hardPower - 0.05) < 1e-12, '强打弱：全量生效');

    const weak = settleTick({ ssot: GATED, step: stepWith([sc('e_hi', 'hardPower', 0.05, { actor: 'e_lo', cause: 'ev_p' })]) });
    assert.equal(weak.ok, true);
    assert.ok(Math.abs(weak.ssot.entities.find((e) => e.id === 'e_hi').attrs.hardPower - 0.95) < 1e-12, '弱打强：同样全量（不再折减）');
    assert.ok(!weak.stage.warnings.some((w) => w.includes('折减')), '折减已退场：零留痕');
});

test('裁定（片3）：分数再怎么摆布都不改生效值（无分量依赖）', () => {
    const a = structuredClone(GATED);
    a.weights = { e_hi: 0.01, e_mid: 0.5, e_lo: 0.99 };
    const b = structuredClone(GATED);
    b.weights = { e_hi: 0.99, e_mid: 0.5, e_lo: 0.01 };
    const step = () => stepWith([sc('e_hi', 'hardPower', 0.03, { actor: 'e_lo', cause: 'ev_p' })]);
    const ra = settleTick({ ssot: a, step: step() });
    const rb = settleTick({ ssot: b, step: step() });
    assert.equal(ra.ssot.entities.find((e) => e.id === 'e_hi').attrs.hardPower, rb.ssot.entities.find((e) => e.id === 'e_hi').attrs.hardPower, '分量互换 → 结果一致');
    assert.ok(Math.abs(ra.ssot.entities.find((e) => e.id === 'e_hi').attrs.hardPower - 0.93) < 1e-12);
});

test('裁定：静默方自我增强被拒（actor 缺省 + 静默 → 归零 + 警告）；被点名应答时允许', () => {
    const r = settleTick({ ssot: GATED, step: stepWith([sc('e_lo', 'hardPower', 0.5, { cause: 'ev_p' })]) });
    assert.equal(r.ok, true);
    assert.equal(r.ssot.entities.find((e) => e.id === 'e_lo').attrs.hardPower, 0.1, '静默自我增强 = 0');
    assert.ok(r.stage.warnings.some((w) => w.includes('静默方自我增强被拒')));

    const world = structuredClone(GATED);
    world.events[0].ripples = ['e_lo'];   // 被点名 → 解除静默
    const r2 = settleTick({ ssot: world, step: stepWith([sc('e_lo', 'hardPower', 0.5, { cause: 'ev_p' })]) });
    assert.equal(r2.ssot.entities.find((e) => e.id === 'e_lo').attrs.hardPower, 0.6, '应答方可以行动（含自我变化走裁定）');
    assert.ok(!r2.stage.warnings.some((w) => w.includes('静默方自我增强')), '应答方不误伤');
});

test('报警：无 cause 记坏账前置警告；带 cause 不记（V7 第一条）', () => {
    const noCause = settleTick({ ssot: GATED, step: stepWith([sc('e_mid', 'network', 0.05)]) });
    assert.ok(noCause.stage.warnings.some((w) => w.includes('stateChanges 无 cause')));
    const withCause = settleTick({ ssot: GATED, step: stepWith([sc('e_mid', 'network', 0.05, { cause: 'ev_p' })]) });
    assert.ok(!withCause.stage.warnings.some((w) => w.includes('无 cause')));
});