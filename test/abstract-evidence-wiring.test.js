// story-world-v2/test/abstract-evidence-wiring.test.js
// Task 3 的**接线锁**：允许来源由发射端产出、证据明细走既有诊断门控、种账读数有人看。
// 依据：已批准设计 §6.1（原文依据与处理记录进入现有抽取诊断，受已有详细调试开关与脱敏约束）
//       与 task-3 Codex 决议（不新增常驻出处章、缓存只加 digest、种账结果必须可观察）。
// 纪律：这一组必须走**真生产函数**（`composeInitSource` / `reportSeedOutcome` / `diagEvidence`），
//       不写"被测逻辑的复制品"。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeInitSource } from '../src/init-source.js';
import { buildRosterPrompt, buildAttrsOnlyPrompt, buildSettingOnlyPrompt, seedBookEntities } from '../src/abstract.js';
import { freezeAllowedSources, evidenceDictionary, verifyQuote } from '../src/abstract-evidence.js';
import { diagnostics } from '../src/diagnostics.js';
import { diagEvidence, setDiagnosticDetails } from '../web/diagnostic-transport.js';
import { reportSeedOutcome } from '../web/seed-diagnostics.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

const entry = (uid, comment, content, extra = {}) => ({ uid, comment, key: [comment], content, disable: false, ...extra });

test('Task3 接线：`composeInitSource` 产出的允许来源块 = 逐字交出去的那几段（排除内容一个字不进）', () => {
    const worldInfoEntries = [
        entry(1, '甲', '甲正文一。'),
        entry(2, '乙', '乙正文二。'),
        entry(3, '丙', '丙正文三。', { disable: true }),          // 默认禁用 ⇒ 不进用料
        entry(4, '[mvu_update]技术', 'window.x=1'),              // 专用技术条目 ⇒ 不进用料
    ];
    const composed = composeInitSource({ worldInfoEntries });
    assert.equal(composed.ok, true, composed.reason);
    assert.ok(Array.isArray(composed.allowedBlocks) && composed.allowedBlocks.length >= 2, '发射端必须交出允许来源块');
    // 每块文本都必须**真出现在**实际交给模型的 text 里（逐字），且被排除的正文一个字都不许进来
    for (const b of composed.allowedBlocks) {
        assert.ok(composed.text.includes(b.text), `块必须逐字在最终文本里：${b.text}`);
        assert.ok(b.sourceId, '每块必须有来源 ID');
    }
    const all = composed.allowedBlocks.map((b) => b.text).join('\n');
    assert.equal(all.includes('丙正文三'), false, '禁用条目不在允许来源里');
    assert.equal(all.includes('window.x=1'), false, '技术内容不在允许来源里');
    // 冻结表：编号 → 真实来源 ID，digest 由「来源 ID + 逐字块文本」决定
    const frozen = freezeAllowedSources(composed.allowedBlocks);
    assert.ok(frozen.list.length === composed.allowedBlocks.length);
    assert.equal(frozen.digest, freezeAllowedSources(composed.allowedBlocks).digest, 'digest 确定性');
    const other = freezeAllowedSources(composed.allowedBlocks.map((b, i) => ({ ...b, sourceId: `x${i}` })));
    assert.notEqual(other.digest, frozen.digest, '同文本不同来源 ID ⇒ digest 必须不同（严格缓存不许串）');
});

test('Task3 接线：严格证据提示词带「来源清单 + ev 形状」；legacy 提示词逐字不变', () => {
    const frozen = freezeAllowedSources([
        { sourceId: 'w1', text: '【甲】甲正文一。', title: '甲' },
        { sourceId: 'w2', text: '【乙】乙正文二。', title: '乙' },
    ]);
    const strict = buildRosterPrompt('【甲】甲正文一。', [], { sources: frozen, fields: true });
    assert.match(strict, /来源清单/, '要有来源清单');
    assert.match(strict, /S1 = 甲/, '清单按编号列题名');
    assert.match(strict, /"ev"/, '形状里要有 ev');
    assert.match(strict, /"fields"/, '小书单发要带属性形状（原缺口：单发提示词没有属性通道）');
    const legacy = buildRosterPrompt('【甲】甲正文一。', []);
    assert.equal(legacy.includes('来源清单'), false, 'legacy 提示词不许被改（旧固定响应夹具零扰动）');
    assert.equal(legacy.includes('"ev"'), false);
    assert.match(buildAttrsOnlyPrompt('【甲】甲正文一。', [], { sources: frozen }), /描述属性保留模型抽取内容/);
    assert.match(buildSettingOnlyPrompt('【甲】甲正文一。', [], { sources: frozen }), /逐字/);
    assert.equal(evidenceDictionary(null), '', '没有允许来源 ⇒ 清单为空串');
    // 引用核对：编号在册 + 原话逐字 + 不许引用块外材料
    assert.equal(verifyQuote(frozen, { ev: { s: 'S1', q: '甲正文一。' }, spanText: '【甲】甲正文一。' }).ok, true);
    assert.equal(verifyQuote(frozen, { ev: { s: 'S1', q: '甲正文一。' }, spanText: '【乙】乙正文二。' }).ok, false, '拆半子块不得借块外材料');
    assert.equal(verifyQuote(frozen, { ev: { s: 'S9', q: '甲正文一。' }, spanText: '【甲】甲正文一。' }).why.includes('来源不在本次用料'), true);
});

test('Task3 接线：种账读数进既有诊断面（待核对候选不再静默消失）', () => {
    diagnostics.clear();
    const world = { context: { tension: 0.5, positions: ['未明'], setting: { frozen: { canon: { bookEntities: [
        { name: '月野兔' },                                  // 类别未确认
        { name: '昆仑', kind: 'faction' },
        { name: '昆仑道宫', kind: 'faction' },               // 名字包含 ⇒ 只作候选
    ] } } } }, entities: [], weights: {} };
    const seed = seedBookEntities(world);
    const out = reportSeedOutcome({ seed, rel: { seeded: 0, dropped: [], warnings: [] }, entries: 2, stage: '测试种账' });
    assert.equal(out.pendingKind, 1);
    assert.match(out.summary, /类别待核对 1/);
    const records = diagnostics.snapshot({ module: '种账' });
    assert.equal(records.length, 1, '种账读数必须真的记进诊断面');
    assert.equal(records[0].data.pendingKind, 1);
    assert.ok(records[0].data.warnings.some((w) => /候选/.test(w)));
});

test('Task3 接线：`diagEvidence` 受 debugDetails 门控——关着不带原话，开着才带', () => {
    diagnostics.clear();
    setDiagnosticDetails(() => false);
    diagEvidence({ class: 'relation', subject: '甲 → 乙', action: 'drop', why: '原话对不上来源（w1）', ref: 'S1', quote: '一句原话' });
    let rec = diagnostics.snapshot({ module: '抽取依据' });
    assert.equal(rec.length, 1);
    assert.equal(rec[0].data.quote, undefined, '关着调试明细时不许带原话');
    assert.equal(rec[0].data.why ?? rec[0].message, '原话对不上来源（w1）', '原因与来源编号恒记');
    diagnostics.clear();
    setDiagnosticDetails(() => true);
    diagEvidence({ class: 'relation', subject: '甲 → 乙', action: 'drop', why: '原话对不上来源（w1）', ref: 'S1', quote: '一句原话' });
    rec = diagnostics.snapshot({ module: '抽取依据' });
    assert.equal(rec[0].data.quote, '一句原话', '开着调试明细才带原话');
    setDiagnosticDetails(() => false);
});

test('Task3 接线：实体别名写进账后仍过 schema（新键必须登记）', () => {
    const world = { context: { tension: 0.5, positions: ['未明'], setting: { frozen: { canon: { bookEntities: [
        { name: '月野兔', kind: 'character', aliases: ['水手月亮'] },
    ] } } } }, entities: [], weights: {} };
    seedBookEntities(world);
    const e = world.entities[0];
    assert.deepEqual(e.aliases, ['水手月亮']);
    const v = validate(e, ssotSchema.props.entities.items);
    assert.deepEqual(v.errors, [], `实体别名必须过契约：${v.errors.join('; ')}`);
});
