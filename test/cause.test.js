// story-world-v2/test/cause.test.js
// K5 验收（分量引擎细案 §3.5/§3.6 + §4 K5 → V5/V7）：薄裁定分量化（低分量动作方按分量比折减，幅度单调）、
// 静默方自我增强被拒（actor 缺省 + 静默 → 归零）、cause 坏账前置报警（无 cause 记警告）。
// 说明：K5 的"方向相悖"报警无裁决对象（薄裁定器只按量不产胜负，ANCHOR 未决点 3 之魂），登记未决不实现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settleTick } from '../src/settle.js';

const GATED = JSON.parse(readFileSync(new URL('./fixtures/gated-world.json', import.meta.url), 'utf8'));

const sc = (entity, attr, delta, extra = {}) => ({ entity, attr, delta, ...extra });
const stepWith = (changes) => ({ actions: [], newEvents: [], agendaAdvances: [], stateChanges: changes, newAgendas: [], agendaCancels: [] });

test('裁定：强方作用弱方 → 全量生效（不折减）', () => {
    const r = settleTick({ ssot: GATED, step: stepWith([sc('e_lo', 'hardPower', -0.05, { actor: 'e_hi', cause: 'ev_p' })]) });
    assert.equal(r.ok, true);
    assert.equal(r.ssot.entities.find((e) => e.id === 'e_lo').attrs.hardPower, 0.05, '0.9/0.1 比 ≥1 → 全量');
    assert.ok(!r.stage.warnings.some((w) => w.includes('折减')), '强方不折减');
});

test('裁定：弱方作用强方 → 分量比折减（P7，幅度单调）', () => {
    const r = settleTick({ ssot: GATED, step: stepWith([sc('e_hi', 'hardPower', 0.5, { actor: 'e_lo', cause: 'ev_p' })]) });
    assert.equal(r.ok, true);
    const hp = r.ssot.entities.find((e) => e.id === 'e_hi').attrs.hardPower;
    // 0.5 × (0.1/0.9) ≈ 0.0556 → 0.9 + 0.0556 ≈ 0.9556
    assert.ok(Math.abs(hp - (0.9 + 0.5 * 0.1 / 0.9)) < 1e-9, `实际 ${hp}`);
    assert.ok(r.stage.warnings.some((w) => w.includes('分量比折减')), '折减留痕（可观测）');
});

test('裁定：折减幅度随分量比单调不减（V5）', () => {
    // 固定 target=e_lo（0.1），actor 分量依次升高 → 折减比 min(1, w/0.1) 单调升 → 生效幅度单调升
    let prev = -1;
    for (const wAct of [0.02, 0.05, 0.08, 0.1]) {
        const world = structuredClone(GATED);
        world.weights = { e_hi: wAct, e_mid: 0.5, e_lo: 0.1 };
        const step = stepWith([sc('e_lo', 'hardPower', 0.5, { actor: 'e_hi', cause: 'ev_p' })]);
        const r = settleTick({ ssot: world, step });
        const hp = r.ssot.entities.find((e) => e.id === 'e_lo').attrs.hardPower;
        assert.ok(hp >= prev, `幅度应单调不减：${hp} < ${prev}`);
        prev = hp;
    }
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