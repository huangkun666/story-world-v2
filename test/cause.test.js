// story-world-v2/test/cause.test.js
// K5 验收（分量引擎细案 §3.5/§3.6 + §4 K5 → V5/V7）→ **leg25 c 整体改写**。
// 沿革（一句话版，防重走）：
//   ① 原 K5 = "低分量动作方按分量比折减（幅度单调 V5）"——leg24 片3 因用户拍板「引擎不裁胜负」整块删除
//      （那个数在替引擎裁胜负：弱方打强方打不动）；
//   ② 片3 之后薄裁定只剩三件事：属性边界钳制 / 静默方自我增强被拒 / cause 坏账前置报警；
//   ③ leg25 c 用户令「删」四维浮点（兵力/权位/人脉/耳目）——契约层连 `stateChanges` 整条都没了
//      （理由见 design-core-leg23 §4 第 1 条：没法精确表示的概念不许压成 0–1；手拍值让"编的"看起来像"算的"），
//      那三件事**同时失去对象**：没有属性可钳、没有"自我增强"可拒（静默面归门控）、没有 cause 可查。
// 于是 adjudicate（settle.js）现在只剩一件事：**校验通过与否**（过了就 return true）。
// 本文件锁的就是这件事本身，以及"删面"这件事本身——测的意图（薄裁定不吃分量、坏账不落账、静默面有人管）全部保留：
//   ① 旧形状（带 `stateChanges`，无 cause / 有 cause 都一样）→ 整步拒（是**拒绝**，不是静默忽略）；
//   ② 合法步 → 零裁定输出（不再有"折减/属性硬边界/静默方自我增强被拒"这类裁措辞）；
//   ③ 无分量依赖（分数怎么摆布都不改落账结果）；
//   ④ 静默面归门控（裁定不再管静默方——机制搬了家，不是丢了）。
// 已删断言（机制没了，非遗漏）：强弱折减与"全量生效"对照、属性边界钳制 0→0 措辞、初值落账、actor 白名单、
//   `stateChanges 无 cause` 报警（其载体字段已不存在）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settleTick } from '../src/settle.js';

const GATED = JSON.parse(readFileSync(new URL('./fixtures/gated-world.json', import.meta.url), 'utf8'));
const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/golden-world.min.json', import.meta.url), 'utf8'));

// 空步（世界步七组；`stateChanges` 已从契约层删除，不再是其中一组）
const emptyStep = (more = {}) => ({
    actions: [], newEvents: [], agendaAdvances: [],
    newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    ...more,
});
// 旧形状的"属性变更"提议（K5 时代的模型输出）：作为**被拒样本**保留，用来证明删面是硬的
const legacySc = (entity, attr, delta, extra = {}) => ({ entity, attr, delta, ...extra });
const legacyStep = (changes) => emptyStep({ stateChanges: changes });

test('裁定（leg25 c 删面）：旧形状带 `stateChanges` → 整步拒（与世界如实不动；无 cause / 有 cause 一视同仁）', () => {
    // 为什么保留这条"被拒"断言：原 K5 的 cause 坏账前置报警（无 cause 记警告）随字段删除，
    //   但它的**意图**必须继续成立——未申报依据的属性增量绝不许落账。现在是更强的口径：整条字段都不存在，
    //   旧模型输出直接被契约层挡住（`未知字段`），既不改账、也不留"看似生效"的痕迹。
    // 参照物用**输入快照**（而不是写死某维的期望值）：夹具里的旧字段正被清理，不该让本断言吊在它上面。
    const snapshot = JSON.stringify(GATED);
    for (const changes of [
        [legacySc('e_hi', 'hardPower', -0.05, { actor: 'e_lo', cause: 'ev_p' })],   // 旧法：合法（带 cause）
        [legacySc('e_hi', 'hardPower', -0.05)],                                      // 旧法：记"无 cause"坏账警告
    ]) {
        const r = settleTick({ ssot: GATED, step: legacyStep(changes) });
        assert.equal(r.ok, false, '带 stateChanges 的旧形状整步被拒');
        assert.equal(r.ssot, GATED, '世界如实不动（原对象原样返回）');
        assert.equal(GATED.meta.tick, 0, 'tick 不推进');
        assert.ok(r.stage.warnings.some((w) => w.includes('stateChanges') && w.includes('未知字段')), r.stage.warnings.join('; '));
        assert.equal(JSON.stringify(GATED), snapshot, '账本零污染（输入逐字节未变）');
    }
});

test('裁定（leg25 c）：薄裁定只剩校验——合法步零裁定输出（没有"折减/边界/静默方自我增强"这类措辞）', () => {
    const step = emptyStep({
        actions: [{ entity: 'e_merchant', verb: '沿商路北上巡查', position: '商路' }],
        newEvents: [{ title: '守将允诺通关', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: ['e_merchant'] }],
        agendaAdvances: [{ agendaId: 'a_1', step: '守将首肯，车队放行', stage: '过边关' }],
    });
    const r = settleTick({ ssot: GOLDEN, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.deepEqual(r.stage.warnings, [], '合法步不产生任何裁定警告');
    const 裁词 = ['折减', '属性硬边界', '越界提议被忽略', '静默方自我增强', '无基线可减', '记为该维初值'];
    for (const word of 裁词) {
        assert.ok(!r.stage.warnings.some((w) => w.includes(word)), `"${word}" 已随属性裁定退场`);
        assert.ok(!r.stage.chronicle.some((c) => c.text.includes(word)), `编年也不该有"${word}"`);
    }
    assert.ok(!r.stage.chronicle.some((c) => c.id.includes('_attr_')), '属性编年行随机制删除（编年只记真发生的事，而这件事不再存在）');
});

test('裁定（片3 保留）：分数再怎么摆布都不改结果（零分量依赖——引擎不裁胜负）', () => {
    const step = () => emptyStep({
        actions: [{ entity: 'e_merchant', verb: '沿商路北上巡查', position: '商路' }],
        agendaAdvances: [{ agendaId: 'a_1', step: '守将首肯，车队放行', stage: '过边关' }],
        newEvents: [{ title: '守将允诺通关', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: ['e_merchant'] }],
    });
    const a = structuredClone(GOLDEN);
    a.weights = { e_merchant: 0.01 };
    const b = structuredClone(GOLDEN);
    b.weights = { e_merchant: 0.99 };
    const ra = settleTick({ ssot: a, step: step() });
    const rb = settleTick({ ssot: b, step: step() });
    assert.equal(ra.ok, true, ra.stage.warnings.join('; '));
    // 账面上的分量是引擎重算的（吃层基线 × 静止衰减，不吃属性、也不吃旧缓存）——两世界逐字节一致
    assert.equal(JSON.stringify(ra.ssot), JSON.stringify(rb.ssot), '摆布输入分量 → 落账逐字节一致');
    assert.deepEqual(ra.stage.chronicle.map((c) => c.text), rb.stage.chronicle.map((c) => c.text), '编年措辞也一致');
});

test('裁定（K5 意图搬家）：静默方的主动作归门控滤除——裁定层不再有"静默方自我增强被拒"', () => {
    // 旧法：静默方无 actor 的自我增强提议由 adjudicate 归零 + 警告。该面随属性消失（没有可增强的数）。
    //   现法：静默方的**一切主动作**（含盘算推进）在裁定之前就被门控滤掉——双面无痕（不落账、不编年、不警告）。
    const step = emptyStep({
        actions: [{ entity: 'e_lo', verb: '请战', position: '大营' }],
        agendaAdvances: [{ agendaId: 'a_lo', step: '自荐成功', stage: '上前' }],
    });
    const r = settleTick({ ssot: GATED, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.deepEqual(r.ssot.meta.simLog[0].silent, ['e_lo'], 'e_lo 结构上静默（无在办盘算 + 从没出手 + 无人点名）');
    assert.deepEqual(r.ssot.meta.simLog[0].silentDropped, { e_lo: 2 }, '行动 + 推进各 1 条被滤（门控侧留痕）');
    assert.deepEqual(r.stage.warnings, [], '滤除不是警告（双面无痕）');
    assert.equal(r.ssot.agendas.find((a) => a.id === 'a_lo').progress, 0, '静默方盘算不动');
    assert.ok(!r.ssot.chronicle.some((c) => c.text.includes('王小卒')), '编年无静默方行迹');
});
