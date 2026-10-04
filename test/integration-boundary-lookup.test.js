// story-world-v2/test/integration-boundary-lookup.test.js
// ★★★Task 4（integration boundaries · 复审接口②）：**查书（按需补字段）的出处协议**真实数据流回归。
//
// 依据（全部已批准，不重复批准）：
//   · docs/superpowers/specs/2026-10-03-abstraction-sources-design.md §6.1（模型输出附来源条目及原文依据；
//     原文存在只证明引用真实）/ §6.3（每次拒收可追到具体原因）
//   · F:/deepseek/tmp/leg185-abstraction-sources/integration-boundary-probe-red.json
//     （红：`{'陆青':{'实力':'凭空捏造的渡劫境'}}` 无出处**照落账**；别名回话落成 pending）
//   · F:/deepseek/tmp/leg185-abstraction-sources/final-review-checks.md（"source availability alone must not
//     masquerade as verified new field claim"）
//
// 口径（本文件逐条钉死）：
//   ① 新默认 = **严格出处道**：每条字段要"该名号自己的来源编号 + 逐字原话"——★leg197 起引擎照旧逐字核，
//      但核的结果**只进诊断面**（`keep` / `unverified`）：**核不过不再丢这条字段，一律照收**；
//   ② `unverified`（给了出处、对不上）既不是 pending（模型没给）也不是 absent（书没写）——它是"照收 + 记账"；
//      `rejected` 只剩**同名号多值冲突**这一条来路（那不是"找不到原文"，是"两个叫法互相矛盾"）；
//   ③ `evidencePolicy:'legacy'` 只许**显式**声明（旧固定响应那条路），不许因"缺元数据/模型没给出处"自动回落；
//   ④ 原始凭证（编号/原话）**只进受门控的诊断面**，不落世界账、不进快照。
//
// ★★★leg197（用户令，逐字）：「把抽象时因为引擎根据模型给的引用而找不到原文而丢弃模型提出的行动的这个行为
//   全部取消了…现在我要全面撤销」⇒ 本文件原先钉死的"出处核不过 = 第三种结局 rejected"**已被该令覆盖**：
//   上面那条红（无出处照落账 / 别名回话落 pending）当年是要治的病，现在是**用户要的口径**——
//   各条测试改成断言"字段照收 + 出处对不上照旧记进 `unverified` 诊断"。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runBatchLookup, runLookup, applyLookup, planBatches, resolveBookSource, ENTITY_LOOKUP_FIELDS } from '../src/entity-lookup.js';
import { setCtxSource, resetBookCache, bookTextForEntity } from '../web/book-source.js';

const worldOf = (entities, canon = []) => ({
    version: 1,
    context: { world: '本地', tension: 0.5, positions: ['未明'], playerId: 'player', setting: { frozen: { fingerprint: 'f', extractedAt: 't', canon: { bookEntities: canon } } } },
    entities, weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0 },
});
const entry = (name, text, sourceId = `entry-${name}`) => ({ name, text, sourceId });
const transportOf = (obj) => async () => JSON.stringify(obj);

test('Task4·查书默认严格：没有出处的裸标量照收，出处对不上记 unverified（★leg197：出处不再丢，照收）', async () => {
    const w = worldOf([{ id: 'a', kind: 'character', name: '陆青', location: '未明' }]);
    const bookText = async () => [entry('人物_陆青', '陆青行走江湖。')];
    const evidence = [];
    const r = await runBatchLookup({ ssot: w, transport: transportOf({ 陆青: { 实力: '凭空捏造的渡劫境' } }), bookText, ids: ['a'], tick: 1, onEvidence: rec => evidence.push(rec) });
    // ★leg197：裸标量不再因为"没有出处"被丢——模型给的字段值照落账（旧法 undefined）。
    assert.equal(r.ssot.entities[0]['实力'], '凭空捏造的渡劫境', '★leg197：没有出处的字段照收');
    assert.equal(r.stats.ok, 1);
    assert.equal(r.stats.rejected, 0, '★leg197：出处核不过不再是第三种结局——它现在照收，`rejected` 只剩同名多值冲突');
    assert.equal(r.stats.pending, 0, '★不许长得像"模型没给"');
    assert.equal(r.stats.absent, 0, '★更不许长得像"书里没有"');
    assert.equal(r.warning, null, '★leg197：出处对不上不再发"出处核不过"警告（那一支只剩同名多值冲突）');
    assert.equal(r.ssot.meta.entityFields.a.attempts['实力'].state, 'ok', '落账成功 ⇒ 状态 ok（可重试语义不变：missingFields 只跳过 ok/absent）');
    // ★leg197：主张照收，但"这次没带出处"这件事照旧记进诊断面（unverified），一条都不许静默。
    assert.equal(evidence.some(x => x.subject === '陆青·实力' && x.action === 'unverified' && /缺来源编号/.test(x.why)), true, '★出处对不上仍要看得见');
    assert.equal(JSON.stringify(r.ssot).includes('凭空捏造'), true, '★leg197：这个值现在照收（用户当次的明确选择：出处只记账、不拦人）');
});

test('Task4·别名/ID/正名都能对到人：唯一别名 + 真出处 = 收；无出处也照收（★leg197：出处不再丢，照收）', async () => {
    const w = worldOf([{ id: 'a', kind: 'character', name: '陆青', aliases: ['青衣客'], location: '未明' }],
        [{ name: '陆青', aliases: ['青衣客'] }]);
    const text = '陆青又称青衣客，境界为感气境。';
    const bookText = async () => [entry('人物_陆青', text)];
    // ① 别名键 + 真出处 ⇒ 落到本人
    const ok = await runBatchLookup({
        ssot: w, bookText, ids: ['a'], tick: 1,
        transport: transportOf({ 青衣客: { 实力: { 文: '感气境', ev: { s: 'S1', q: '境界为感气境。' } } } }),
    });
    assert.equal(ok.stats.ok, 1, `★别名回话要认得出人：${ok.warning || ''}`);
    assert.equal(ok.ssot.entities[0]['实力'], '感气境');
    assert.equal(/"ev"|"quote"|"S1"/.test(JSON.stringify(ok.ssot)), false, '★原始凭证不落世界账');
    // ② 同一个别名键但**没有出处** ⇒ ★leg197 起**照收**（旧法落成 pending / 后来落成 rejected）
    const noProofEvidence = [];
    const noProof = await runBatchLookup({ ssot: w, bookText, ids: ['a'], tick: 1, transport: transportOf({ 青衣客: { 实力: '感气境' } }), onEvidence: rec => noProofEvidence.push(rec) });
    assert.equal(noProof.ssot.entities[0]['实力'], '感气境', '★leg197：没有出处不再拦这条字段');
    assert.equal(noProof.stats.ok, 1);
    assert.equal(noProof.stats.rejected, 0);
    assert.equal(noProof.stats.pending, 0);
    assert.equal(noProofEvidence.some(x => x.subject === '陆青·实力' && x.action === 'unverified'), true, '★出处对不上照旧记进诊断');
    // ③ id 键（模型回 id）也认
    const byId = await runBatchLookup({
        ssot: w, bookText, ids: ['a'], tick: 1,
        transport: transportOf({ a: { 实力: { 文: '感气境', ev: { s: 'S1', q: text } } } }),
    });
    assert.equal(byId.stats.ok, 1, '模型用 id 回话也要对到人');
});

test('Task4·非目标/歧义别名一律不收；同一名号多条叫法互相矛盾 ⇒ 拒（不采先到者）', async () => {
    const w = worldOf([
        { id: 'a', kind: 'character', name: '陆青', location: '未明' },
        { id: 'b', kind: 'character', name: '白小娥', aliases: ['小娥'], location: '未明' },
        { id: 'c', kind: 'character', name: '小娥', location: '未明' },
    ]);
    const text = '陆青境界为感气境。';
    const bookText = async () => [entry('人物_陆青', text)];
    // ① 回的是**别的实体**的别名（歧义/不在本批）⇒ 不收（宁可漏，不可错填）
    const foreign = await runBatchLookup({
        ssot: w, bookText, ids: ['a'], tick: 1,
        transport: transportOf({ 小娥: { 实力: { 文: '感气境', ev: { s: 'S1', q: text } } } }),
    });
    assert.equal(foreign.stats.ok, 0, '★别名指向别人（且本身歧义）⇒ 一个字都不许落到陆青头上');
    assert.equal(foreign.ssot.entities.find((e) => e.id === 'a')['实力'], undefined);
    // ② 同一名号的**两个叫法给出互相矛盾的字段值** ⇒ 拒（旧法按对象键序"先到先得"）
    const w2 = worldOf([{ id: 'a', kind: 'character', name: '陆青', aliases: ['青衣客'], location: '未明' }],
        [{ name: '陆青', aliases: ['青衣客'] }]);
    const conflict = await runBatchLookup({
        ssot: w2, bookText, ids: ['a'], tick: 1,
        transport: transportOf({
            陆青: { 实力: { 文: '感气境', ev: { s: 'S1', q: text } } },
            青衣客: { 实力: { 文: '化神期', ev: { s: 'S1', q: text } } },
        }),
    });
    assert.equal(conflict.stats.ok, 0, '★矛盾的两条都不收（不许"先到先得"）');
    assert.equal(conflict.stats.rejected, 1);
    // ★leg197：`rejected` 现在只剩这一条来路（同名多值冲突，不是出处判据）⇒ 警告也如实只讲冲突。
    assert.match(String(conflict.warning), /同名号|互相矛盾/);
});

test('Task4·字段值不在自己引的那句原话里也照收，只记 unverified（★leg197：出处不再丢，照收）', async () => {
    const w = worldOf([{ id: 'a', kind: 'character', name: '甲', location: '未明' }]);
    // 同一条目里写着两个人的属性：甲=感气境、乙=化神期
    const text = '甲境界为感气境。乙境界为化神期。';
    const bookText = async () => [entry('人物_甲', text)];
    // ① 引的出处里**根本没有这个值**（值在材料别处写着）⇒ ★leg197 起照收，只记"值不在所引原话里"
    const piggyEvidence = [];
    const piggy = await runBatchLookup({
        ssot: w, bookText, ids: ['a'], tick: 1,
        transport: transportOf({ 甲: { 实力: { 文: '化神期', ev: { s: 'S1', q: '甲境界为感气境。' } } } }),
        onEvidence: rec => piggyEvidence.push(rec),
    });
    assert.equal(piggy.stats.ok, 1, '★leg197：借出处夹带的值照收（旧法 ok=0/rejected=1）');
    assert.equal(piggy.stats.rejected, 0);
    assert.equal(piggy.ssot.entities[0]['实力'], '化神期', '★取第一条回话作为该字段的值');
    assert.equal(piggyEvidence.some(x => x.subject === '甲·实力' && x.action === 'unverified' && /字段值不在所引原话里/.test(x.why)), true, '★"夹带"照旧看得见');
    // ② 同一条目里但引的是**没展示过的另一条来源** ⇒ 同样只记诊断、照收
    const outsideEvidence = [];
    const outside = await runBatchLookup({
        ssot: w, bookText, ids: ['a'], tick: 1,
        transport: transportOf({ 甲: { 实力: { 文: '感气境', ev: { s: 'S9', q: '甲境界为感气境。' } } } }),
        onEvidence: rec => outsideEvidence.push(rec),
    });
    assert.equal(outside.stats.ok, 1, '★leg197：编号不在本次用料也照收');
    assert.equal(outside.stats.rejected, 0);
    assert.equal(outsideEvidence.some(x => x.subject === '甲·实力' && x.action === 'unverified' && /来源不在本次用料/.test(x.why)), true);
    // ③ 正确出处 ⇒ 收（阳性对照：这一条永远要过）
    const ok = await runBatchLookup({
        ssot: w, bookText, ids: ['a'], tick: 1,
        transport: transportOf({ 甲: { 实力: { 文: '感气境', ev: { s: 'S1', q: '甲境界为感气境。' } } } }),
    });
    assert.equal(ok.stats.ok, 1, `阳性对照：${ok.warning || ''}`);
});

test('Task4·每个名号只许引自己那几条来源：引错编号照收、只记 unverified（★leg197：出处不再丢，照收）', async () => {
    const w = worldOf([
        { id: 'a', kind: 'character', name: '甲', location: '未明' },
        { id: 'b', kind: 'character', name: '乙', location: '未明' },
    ]);
    const bookText = async (e) => [entry(`人物_${e.name}`, e.name === '甲' ? '甲境界为感气境。' : '乙境界为化神期。')];
    const prompts = [];
    const transport = async (prompt) => {
        prompts.push(prompt);
        return JSON.stringify({
            甲: { 实力: { 文: '化神期', ev: { s: 'S2', q: '乙境界为化神期。' } } },   // ★引了乙的编号
            乙: { 实力: { 文: '化神期', ev: { s: 'S2', q: '乙境界为化神期。' } } },   // 乙引自己的编号
        });
    };
    const evidence = [];
    const r = await runBatchLookup({ ssot: w, transport, bookText, ids: ['a', 'b'], tick: 1, onEvidence: rec => evidence.push(rec) });
    // ★leg197：甲引了乙的编号，引擎照旧核得出来（记 unverified），但**照收**（旧法 ok=1、甲一个字都不落账）。
    assert.equal(r.stats.ok, 2, `两条都落账：${JSON.stringify(r.stats)} / ${r.warning || ''}`);
    assert.equal(r.ssot.entities.find((e) => e.id === 'b')['实力'], '化神期');
    assert.equal(r.ssot.entities.find((e) => e.id === 'a')['实力'], '化神期', '★leg197：引错编号只记账，不拦人');
    assert.equal(evidence.some(x => x.subject === '甲·实力' && x.action === 'unverified' && /S2/.test(x.why)), true, '★"引了别人的条目"照旧看得见');
    assert.equal(evidence.some(x => x.subject === '乙·实力' && x.action === 'keep'), true);
    assert.match(prompts[0], /【甲】[\s\S]*S1 = 人物_甲/, '提示词按名号给出各自清单');
    assert.match(prompts[0], /【乙】[\s\S]*S2 = 人物_乙/);
});

test('Task4·pending / absent / 出处核不过分开（核不过现在照收；rejected 只留给同名多值冲突）（★leg197：出处不再丢，照收）', async () => {
    const w = worldOf([{ id: 'a', kind: 'character', name: '甲', location: '未明' }]);
    const bookText = async () => [entry('人物_甲', '甲境界为感气境。')];
    // ① 模型没给这一栏 ⇒ pending（可重试）
    const pending = await runBatchLookup({ ssot: w, bookText, ids: ['a'], tick: 1, transport: transportOf({ 甲: {} }) });
    assert.equal(pending.stats.pending, 1);
    assert.equal(pending.stats.rejected, 0);
    assert.equal(pending.ssot.meta.entityFields.a.attempts['实力'].state, 'pending');
    // ② 有回话但出处核不过 ⇒ ★leg197 起**照收**，只记 unverified——既不算 pending，也不算 rejected
    const unverifiedEvidence = [];
    const noProof = await runBatchLookup({ ssot: w, bookText, ids: ['a'], tick: 1, transport: transportOf({ 甲: { 实力: '感气境' } }), onEvidence: rec => unverifiedEvidence.push(rec) });
    assert.equal(noProof.stats.ok, 1, '★leg197：出处对不上照收');
    assert.equal(noProof.stats.rejected, 0);
    assert.equal(noProof.stats.pending, 0);
    assert.equal(noProof.stats.absent, 0, '★更不许长得像"书里没有"');
    assert.equal(noProof.ssot.meta.entityFields.a.attempts['实力'].state, 'ok');
    assert.equal(unverifiedEvidence.some(x => x.action === 'unverified'), true, '★"出处对不上"照旧单独记一笔');
    // ③ 书读到了、但书里确实没有这个名号 ⇒ **只有这一种情形**才允许 absent（书未明述），
    //   且它既不算 pending 也不算 rejected（三种结局各归各的数）
    const empty = await runBatchLookup({ ssot: w, bookText: async () => ({ ok: true, entries: [] }), ids: ['a'], tick: 1, transport: transportOf({ 甲: { 实力: '感气境' } }) });
    assert.equal(empty.stats.absent, 1, '读到书 + 书里没有该条目 ⇒ absent（唯一允许写 absent 的情形）');
    assert.equal(empty.stats.rejected, 0);
    assert.equal(empty.stats.pending, 0);
    assert.equal(empty.ssot.meta.entityFields.a.attempts['实力'].state, 'absent');
    // ④ ★leg197：`rejected` 仍是一种**独立的**结局，但只剩"同名号的多个叫法互相矛盾"这一条来路
    //   （它不是"找不到原文"）——不许因为"现在出处不拦人"就把这一格也一起抹平。
    const conflict = await runBatchLookup({
        ssot: worldOf([{ id: 'a', kind: 'character', name: '甲', aliases: ['甲某'], location: '未明' }], [{ name: '甲', aliases: ['甲某'] }]),
        bookText, ids: ['a'], tick: 1,
        transport: transportOf({
            甲: { 实力: { 文: '感气境', ev: { s: 'S1', q: '甲境界为感气境。' } } },
            甲某: { 实力: { 文: '化神期', ev: { s: 'S1', q: '甲境界为感气境。' } } },
        }),
    });
    assert.equal(conflict.stats.rejected, 1, '★矛盾的两条都不收（不许"先到先得"）');
    assert.equal(conflict.stats.pending, 0);
    assert.equal(conflict.ssot.meta.entityFields.a.attempts['实力'].state, 'rejected');
    // 读不到书 ⇒ pending（**绝不是** absent）——红线不变
    const unread = await runBatchLookup({ ssot: w, bookText: async () => ({ ok: false }), ids: ['a'], tick: 1, transport: transportOf({ 甲: { 实力: '感气境' } }) });
    assert.equal(unread.ssot.meta.entityFields.a.attempts['实力'].state, 'pending');
    assert.equal(JSON.stringify(unread.ssot).includes('absent'), false);
});

test('Task4·显式 legacy 道：旧固定响应逐字照旧（只许显式声明）', async () => {
    const w = worldOf([{ id: 'a', kind: 'character', name: '甲', location: '未明' }]);
    const bookText = async () => [entry('人物_甲', '甲境界为感气境。')];
    const legacy = await runBatchLookup({ ssot: w, bookText, ids: ['a'], tick: 1, evidencePolicy: 'legacy', transport: transportOf({ 甲: { 实力: '感气境' } }) });
    assert.equal(legacy.stats.ok, 1, '★显式 legacy：裸标量照收（旧固定响应零扰动）');
    assert.equal(legacy.stats.rejected, 0);
    assert.equal(legacy.ssot.entities[0]['实力'], '感气境');
    // 缺材料不许静默变 legacy：取到的条目没有正文 ⇒ 明确失败（不写痕）
    const noMaterial = await runLookup({ world: w, ids: ['a'], bookText: async () => [entry('人物_甲', '   ')], transport: transportOf({ 甲: { 实力: '感气境' } }) });
    assert.equal(noMaterial.byName, null, '★"没材料"与"不需要材料"是两件事（不许静默回落 legacy）');
    assert.equal(noMaterial.policy, 'strict');
    assert.match(String(noMaterial.error), /没有正文/);
});

test('Task4·分批预算不变（严格道不改载荷规划）', async () => {
    const w = worldOf([
        { id: 'a', kind: 'character', name: '甲', location: '未明' },
        { id: 'b', kind: 'character', name: '乙', location: '未明' },
    ]);
    const shared = entry('共享条目', 'x'.repeat(8000));
    const r = await planBatches({ world: w, ids: ['a', 'b'], bookText: async () => ({ ok: true, entries: [shared] }), budgetChar: 20000 });
    assert.equal(r.batches.length, 1, '共享条目只算一次载荷（严格道不改这条口径）');
    assert.equal(r.totalEntries, 1);
    assert.equal(r.totalChars, 8000);
    // 严格道的 prompt 只加"出处纪律 + 每个名号自己的清单"，不改变分批的载荷口径
    const applied = await runBatchLookup({
        ssot: w, ids: ['a', 'b'], tick: 1, bookText: async () => ({ ok: true, entries: [shared] }),
        transport: transportOf({}),
    });
    assert.equal(applied.calls, 1, '两个共享同一条目 ⇒ 一次调用');
    assert.equal(shared.ref, undefined, '来源编号不能写回读取方提供的条目');
});

test('Task4·来源身份一路不丢：bookTextForEntity 写 sourceId、resolveBookSource 原样保留', async () => {
    const entries = [{ uid: 7, _sw2Source: '书甲', comment: '人物_陆青', key: ['陆青'], content: '陆青境界为感气境。' }];
    const ctx = { chatId: 'task4-lookup-sourceid', worldInfo: entries };
    setCtxSource(() => ctx); resetBookCache();
    try {
        const r = await bookTextForEntity({ name: '陆青' }, ctx);
        assert.equal(r.ok, true);
        assert.equal(r.entries[0].sourceId, '书甲#7', '★取书面必须交出稳定的来源身份（来源名 + 条目 uid）');
        const via = await resolveBookSource(async () => r.entries, { name: '陆青' });
        assert.equal(via.entries[0].sourceId, '书甲#7', '★注入面原样保留来源身份（下游出处核对读的就是它）');
        assert.ok(via.entries[0].text.includes('感气境'), '原文照旧交出去（定位到那一行/那一段）');
    } finally { resetBookCache(); }
});

test('Task4·applyLookup 的旧契约不变：byName=null 一个字节都不写、显式 rejected 才走第三种结局', () => {
    const w = worldOf([{ id: 'a', kind: 'character', name: '甲', location: '未明' }]);
    const out = applyLookup({ ssot: w, ids: ['a'], byName: null, sources: {}, tick: 1 });
    assert.equal(out.ssot, w, '原对象原样返回');
    assert.deepEqual(out.stats, { ok: 0, pending: 0, absent: 0, unread: 0, rejected: 0, written: [] });
    // 显式 rejected：不落值、不记 pending/absent、留原因
    const rejected = applyLookup({
        ssot: w, ids: ['a'], byName: { 甲: null }, sources: { a: ['人物_甲'] }, tick: 1, fields: ENTITY_LOOKUP_FIELDS,
        rejected: { 甲: { 实力: '缺来源编号' } },
    });
    assert.equal(rejected.stats.rejected, 1);
    assert.equal(rejected.stats.pending, 0);
    assert.equal(rejected.ssot.entities[0]['实力'], undefined);
    assert.equal(rejected.ssot.meta.entityFields.a.attempts['实力'].why, '缺来源编号');
});

test('实际取书用已确认别名定位长正文后段，再以带出处的字段回话入账', async () => {
    const quote = '青衣客境界为感气境';
    const ctx = { chatId: 'confirmed-alias-source', worldInfo: [{ uid: 31, comment: '青衣客', key: ['青衣客'], content: `${'x'.repeat(1600)}\n${quote}。` }] };
    const person = { id: 'a', kind: 'character', name: '陆青', aliases: ['青衣客'], location: '未明' };
    setCtxSource(() => ctx); resetBookCache();
    try {
        const source = await bookTextForEntity(person, ctx);
        assert.equal(source.entries[0].located, 'snippet');
        assert.equal(source.entries[0].text, quote);
        const result = await runBatchLookup({ ssot: worldOf([person]), ids: ['a'], bookText: (e) => bookTextForEntity(e, ctx),
            transport: async (prompt) => {
                assert.ok(prompt.includes(quote), '正文后段的别名依据必须真正进入请求');
                return JSON.stringify({ 青衣客: { 实力: { 文: '感气境', ev: { s: 'S1', q: quote } } } });
            } });
        assert.equal(result.ssot.entities[0]['实力'], '感气境');
        assert.equal(ctx.worldInfo[0].ref, undefined);
    } finally { resetBookCache(); }
});

test('同名实体的补查使用实体编号；歧义正名不能替代编号', async () => {
    const people = [{ id: 'a', kind: 'character', name: '甲', location: '未明' }, { id: 'b', kind: 'character', name: '甲', location: '未明' }];
    const bookText = async (e) => [entry(e.id, e.id === 'a' ? '甲境界为感气境。' : '甲境界为化神期。')];
    const ambiguous = await runBatchLookup({ ssot: worldOf(people), ids: ['a', 'b'], bookText,
        transport: transportOf({ 甲: { 实力: { 文: '感气境', ev: { s: 'S1', q: '甲境界为感气境。' } } } }) });
    assert.equal(ambiguous.stats.ok, 0);
    const exact = await runBatchLookup({ ssot: worldOf(people), ids: ['a', 'b'], bookText,
        transport: async (prompt) => {
            assert.ok(prompt.includes('a') && prompt.includes('b'), '同名时必须给模型实际实体编号');
            return JSON.stringify({ a: { 实力: { 文: '感气境', ev: { s: 'S1', q: '甲境界为感气境。' } } } });
        } });
    assert.equal(exact.ssot.entities.find(e => e.id === 'a')['实力'], '感气境');
    assert.equal(exact.ssot.entities.find(e => e.id === 'b')['实力'], undefined);
});
