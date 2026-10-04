// story-world-v2/test/integration-boundary-roots.test.js
// ★★★Task 4（integration boundaries · 复审接口①/③）：**起根的来源身份 + 原话协议**的真实数据流回归。
//
// 依据（全部已批准，不重复批准）：
//   · docs/superpowers/specs/2026-10-03-abstraction-sources-design.md §6.1（模型输出附来源与原文依据）
//     / §5.2（选段之外的原文不参与模型、出处校验或兜底）/ §6.3（拒收可追到具体原因）
//   · F:/deepseek/tmp/leg185-abstraction-sources/integration-boundary-probe-red.json（独立红证据）
//   · F:/deepseek/tmp/leg185-abstraction-sources/dsh-task-4-root-alias-audit-report.md（F1/F3 的机械描述）
//
// 红（旧实现，本文件逐条钉死）：
//   ① 严格面的根提示词形状里**根本没有 `ev`**（F1）⇒ 起根是严格面上唯一没有编号的一格；
//   ② 拆半（输出被截断时的降级路）之后 `mergeCanonChunks` 的返回字面量里没有 `rawRoots`/`rawRelations`
//      ⇒ 两个子块收下的根与关系边**整批静默消失**（F3，且一条警告都没有）；
//   ③ 根只在收口拿**父块整段**（`chunk.text`）当出处闸 ⇒ 子块能引"自己没见过"的原话。
// 本文件走**生产函数**（`extractWorldSetting` / `seedRootsChunked` / `sanitizeSeedRoots` / `mergeCanonChunks`），
//   固定响应只证明**程序保存链**（哪些主张被收下/拒收、写成了什么形状），不宣称模型识别质量（设计 §8 末条）。
//
// ★★★leg197（用户令「…因为引擎根据模型给的引用而找不到原文而丢弃模型提出的行动…现在我要全面撤销」）：
//   **出处那一层从"闸门"降成"记账"**——本文件里原先所有"引了没展示的来源 / 原话对不上 ⇒ 拒收"的判据，
//   一律翻成"**照收**，且 `warnings` / `errors` 仍如实点名对不上"（`verifyQuote` 一个字没改，只是没人再拿它当闸）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractWorldSetting, mergeCanonChunks } from '../src/abstract.js';
import { seedRootsChunked, applySeedRoots, chunkBookTextWithRanges, sanitizeSeedRoots } from '../src/seed-roots.js';
import { freezeAllowedSources, materialRowsOf, scopeForRows } from '../src/abstract-evidence.js';

const blocksOf = (pairs) => pairs.map(([sourceId, text]) => ({ sourceId, text }));
/** 带题名的来源块（严格道的「来源清单」印的是 `S1 = 题名`——判据要能看到它）。 */
const titledBlocks = (triples) => triples.map(([sourceId, title, text]) => ({ sourceId, title, text }));
const filler = (mark, n) => Array.from({ length: n }, (_, i) => `${mark}填充${i}：把书撑过大书分块下限。`).join('\n');
const emptySsot = () => ({
    version: 1, context: { world: '本地', tension: 0.5, positions: ['未明'], playerId: 'p' },
    entities: [{ id: 'a', kind: 'character', name: '陆青', location: '未明' }],
    weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0 },
});
const worldOf = (setting) => ({
    version: 1, context: { world: '本地', tension: 0.5, positions: ['未明'], setting },
    entities: [], weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0 },
});
/** 提示词里"来源清单"列出的编号（`S1 = 甲条` 那种行）——判据据此知道模型**这次见到了哪几条**。 */
const listedRefs = (prompt) => [...prompt.matchAll(/^(S\d+) = /gm)].map((m) => m[1]);
/** 提示词里本次真正交出去的书文的第一行（= 这一块确实展示过的原文）。 */
const firstShownRow = (prompt) => {
    const at = prompt.indexOf('———— 设定原文如下 ————');
    return String(prompt).slice(at < 0 ? 0 : at).split('\n').slice(1).map((s) => s.trim()).find(Boolean) || '';
};

// ══════════════════════════════════════════════════════════════════════════════
// ① 净化层：严格道只认"本次展示片段"里的编号与原话（同句在别的条目里出现不算）
//   ★leg197：核不过**照收**——这一段现在验的是"核得出、且留痕"，不是"拒收"。
// ══════════════════════════════════════════════════════════════════════════════
test('Task4·起根闸：同句落在两个条目里时，引"没展示的那一条"**照收**（★leg197：出处不再丢），但警告仍点名"不在本次展示的材料内"', () => {
    const SHARED = '陆青前往东城参加聚会。';
    const A = `【甲条】${SHARED}\n甲条独有的一句。`;
    const B = `【乙条】${SHARED}\n乙条独有的一句。`;
    const frozen = freezeAllowedSources(blocksOf([['src-a', A], ['src-b', B]]));
    const rows = materialRowsOf(frozen.text);
    // 本次调用**只展示甲条**（行 0/1）
    const scope = scopeForRows(frozen, { text: frozen.text, rows, indexes: [0, 1] });
    const clean = (roots) => sanitizeSeedRoots({ roots }, { max: 8, sourceText: A, frozen, scope, spanText: A });
    const ok = clean([{ title: '甲事', parties: ['陆青'], quote: SHARED, ev: { s: 'src-a', q: SHARED } }]);
    assert.equal(ok.roots.length, 1, `本块自己的出处要收：${JSON.stringify(ok.warnings)}`);
    assert.equal(ok.roots[0].ev, undefined, '★原始凭证不落（净化产物只有 title/position/parties/quote/why）');
    // ★leg197：引"本次没展示的那一条"不再是拒收理由 ⇒ 照收；但"借了没见过的来源"仍要留痕（不许静默）
    const foreign = clean([{ title: '乙事', parties: ['陆青'], quote: SHARED, ev: { s: 'src-b', q: SHARED } }]);
    assert.equal(foreign.roots.length, 1, '★leg197：引"本次没展示的那一条"**照收**（旧法这里拒；同句逐字相同与否都不再是判据）');
    assert.match(foreign.warnings.join('|'), /不在本次展示的材料内/, '★但警告仍点名"借了没展示的来源"');
    assert.match(foreign.warnings.join('|'), /照收/, '★leg197：留痕写明"照收，只记这一条"');
    const outside = clean([{ title: '甲事', parties: ['陆青'], quote: '乙条独有的一句。', ev: { s: 'src-a', q: '乙条独有的一句。' } }]);
    assert.equal(outside.roots.length, 1, '★leg197：原话不在所引来源的展示片段里 ⇒ 照收（旧法拒）');
    assert.match(outside.warnings.join('|'), /不在本次展示的片段内/, '★警告仍点名"对不上"');
    const mismatch = clean([{ title: '甲事', parties: ['陆青'], quote: SHARED, ev: { s: 'src-a', q: '甲条独有的一句。' } }]);
    assert.equal(mismatch.roots.length, 1, '★leg197："书里那句话"不在自己的 `ev.q` 里 ⇒ 照收（旧法拒；不许借别处也不再用丢弃来罚）');
    assert.match(mismatch.warnings.join('|'), /不在所引原话里/, '★警告仍点名那一处错配');
    const noEv = clean([{ title: '甲事', parties: ['陆青'], quote: SHARED }]);
    assert.equal(noEv.roots.length, 1, '★leg197：严格道缺 `ev` ⇒ 照收（旧法：拒）');
    assert.match(noEv.warnings.join('|'), /缺来源编号/, '★警告仍点名"缺来源编号"（旧法那句丢弃理由照旧报出来）');
});

// ══════════════════════════════════════════════════════════════════════════════
// ② 分块起根（web 小书/缓存兜底那条路）：提示词带清单、逐块核自己的片段、legacy 只许显式
// ══════════════════════════════════════════════════════════════════════════════
test('Task4·分块起根：来源清单随块走 + 跨块冒领拒收 + 显式 legacy 照旧 + strict 无来源拒绝', async () => {
    const SHARED = '陆青前往东城参加聚会。';
    const A = `【甲条】${SHARED}\n甲条独有的一句。`;
    const B = `【乙条】${SHARED}\n乙条独有的一句。`;
    const text = `${A}\n${B}`;
    const chunks = chunkBookTextWithRanges(text, 30000);
    assert.equal(chunks.length, 1, '前置：这一组是"单块"（两块小条目同块）——本用例先钉同块内的冒领');
    const prompts = [];
    const extract = async (prompt) => {
        prompts.push(prompt);
        const listed = listedRefs(prompt);
        assert.ok(listed.length, '★严格道的起根提示词必须列出本次来源清单（旧法一个字都没有）');
        return JSON.stringify({
            roots: [
                { title: '甲事', parties: ['陆青'], quote: SHARED, ev: { s: 'src-a', q: SHARED } },
                { title: '乙事', parties: ['陆青'], quote: SHARED, ev: { s: 'src-b', q: SHARED } },
            ],
        });
    };
    const w = emptySsot();
    const r = await seedRootsChunked({
        ssot: w, chunks, extract, sourceText: text, allowedSources: titledBlocks([['src-a', '甲条', A], ['src-b', '乙条', B]]),
        evidencePolicy: 'strict', fingerprint: 'f', at: 't', maxPerChunk: 8, concurrency: 1,
    });
    assert.equal(r.ok, true, (r.errors || []).join('；'));
    assert.match(prompts[0], /S1 = 甲条/);
    assert.match(prompts[0], /S2 = 乙条/);
    assert.match(prompts[0], /每一条主张都要带|每条根都要带 `ev`/, '提示词要写清"根也要出处"');
    assert.equal(r.seeded, 2, '两块都在本次展示范围内 ⇒ 两条都收（阳性对照）');
    // 显式 legacy：旧固定响应（无 ev）照旧收——**只许显式**（新默认是严格道）
    const w2 = emptySsot();
    const r2 = await seedRootsChunked({
        ssot: w2, chunks: [A], extract: async () => JSON.stringify({ roots: [{ title: '甲事', parties: ['陆青'], quote: SHARED }] }),
        sourceText: A, evidencePolicy: 'legacy', fingerprint: 'f', at: 't',
    });
    assert.equal(r2.ok, true, (r2.errors || []).join('；'));
    assert.equal(w2.events.length, 1, '显式 legacy：旧固定响应零扰动');
    // 显式要 strict 却没给允许来源 ⇒ **明确拒绝**（不许静默回落 legacy）
    const r3 = await seedRootsChunked({ ssot: emptySsot(), chunks: [A], extract: async () => '{}', evidencePolicy: 'strict' });
    assert.equal(r3.ok, false);
    assert.match(r3.errors.join('|'), /没有提供「允许来源」/);
});

test('Task4·分块起根：拆到两块之后，"冒领"的那两条**照收**（★leg197：出处不再丢），警告仍点名跨块冒领', async () => {
    const SHARED = '陆青前往东城参加聚会。';
    const A = `【甲条】${SHARED}\n甲条独有的一句。`;
    const B = `【乙条】${SHARED}\n乙条独有的一句。`;
    const text = `${A}\n${B}`;
    const rows = materialRowsOf(text);
    const chunks = [{ text: A, from: 0, to: 1 }, { text: B, from: 2, to: 3 }];
    assert.equal(rows.length, 4, '前置：这一组的行号区间就是两块各自的两行');
    const prompts = [];
    const extract = async (prompt) => {
        prompts.push(prompt);
        const inB = prompt.includes('乙条独有');
        return JSON.stringify({
            roots: [
                { title: inB ? '乙事' : '甲事', parties: ['陆青'], quote: SHARED, ev: { s: inB ? 'src-b' : 'src-a', q: SHARED } },
                { title: '冒领', parties: ['陆青'], quote: SHARED, ev: { s: inB ? 'src-a' : 'src-b', q: SHARED } },
            ],
        });
    };
    const w = emptySsot();
    const r = await seedRootsChunked({
        ssot: w, chunks, extract, sourceText: text, allowedSources: titledBlocks([['src-a', '甲条', A], ['src-b', '乙条', B]]),
        evidencePolicy: 'strict', fingerprint: 'f', at: 't', maxPerChunk: 8, concurrency: 1,
    });
    assert.equal(r.ok, true, (r.errors || []).join('；'));
    // ★leg197：每块的"冒领"项不再被拒 ⇒ 两块各收 2 条（跨块同标题去重后落账 3 条：甲事 / 冒领 / 乙事）
    assert.equal(r.seeded, 3, `★leg197：冒领也落账（旧法 2 条）；实际 ${JSON.stringify(w.events.map((e) => e.title))}`);
    assert.deepEqual(w.events.map((e) => e.title).sort(), ['乙事', '冒领', '甲事']);
    assert.equal(prompts[0].includes('S2 = 乙条'), false, '★第一块的清单只许列它自己那条（S1）');
    assert.match(prompts[1], /S2 = 乙条/, '★第二块的清单列的是它自己那条');
    assert.match(r.warnings.join('|'), /不在本次展示的材料内/, '★跨块冒领仍要留原因（旧法"拒收"、现在"照收 + 留痕"）');
    assert.match(r.warnings.join('|'), /照收/, '★leg197：留痕写明"照收，只记这一条"');
    assert.equal(JSON.stringify(w.events).includes('"ev"'), false, '★世界账里不许出现原始凭证键');
    assert.equal(JSON.stringify(w.events).includes('"q"'), false, '★世界账里不许出现原始凭证键');
});

// ══════════════════════════════════════════════════════════════════════════════
// ③ 并进第二遍（大书生产路）：逐块核 + 拆半后根/关系不丢 + skipRoster 不重抽
// ══════════════════════════════════════════════════════════════════════════════
test('Task4·并进第二遍：每块按自己展示的片段核——跨块冒领**照收**（★leg197：出处不再丢），skipRoster 不问根', async () => {
    const A_ONLY = '甲独有的话。';
    const B_ONLY = '乙独有的话。';
    const A_TEXT = `【甲条】${A_ONLY}\n${filler('甲线', 1600)}`;
    const B_TEXT = `【乙条】${B_ONLY}\n${filler('乙线', 1600)}`;
    const text = `${A_TEXT}\n${B_TEXT}`;
    assert.ok(Array.from(text).length > 30000, '这一组要真的进大书分块路径');
    const blocks = [
        { sourceId: 'src-a', title: '甲条', text: A_TEXT },
        { sourceId: 'src-b', title: '乙条', text: B_TEXT },
    ];
    const prompts = [];
    const extract = async (prompt) => {
        prompts.push(prompt);
        if (!prompt.includes('"roots"')) return JSON.stringify({ entities: [] });      // 名册遍/首块（不问根）
        const listed = listedRefs(prompt);
        const own = listed[0];
        const shown = firstShownRow(prompt);
        const foreignRef = listed.includes('S1') ? 'src-b' : 'src-a';
        const foreignQuote = listed.includes('S1') ? B_ONLY : A_ONLY;
        const roots = [{ title: `本块事·${own}`, parties: ['陆青'], quote: shown, ev: { s: own, q: shown } }];
        // 只有"这一块只列了一条来源"时才造冒领项（否则另一条本来就在本次展示范围内，那是合法的）
        if (listed.length === 1) roots.push({ title: '冒领', parties: ['陆青'], quote: foreignQuote, ev: { s: foreignRef, q: foreignQuote } });
        return JSON.stringify({ entities: [], roots });
    };
    const r = await extractWorldSetting({ sourceText: text, extract, allowedSources: blocks, seedRoots: { playerName: '' } });
    assert.equal(r.ok, true, (r.errors || []).join('；'));
    assert.ok(Array.isArray(r.rawRoots), '★"并进来了"必须能被接线层看见（按有没有这一格分叉）');
    const got = r.rawRoots.flat();
    assert.ok(got.length >= 1, `本块自己的根要收下：${JSON.stringify(r.errors)}`);
    // ★leg197：引"本次没展示的那一条"的根**照收**（旧法拿父块整段核 ⇒ 会放行；现在核归核、收归收）
    assert.equal(got.some((x) => x.title === '冒领'), true, '★leg197：跨块冒领的根**照收**（出处核不过不再决定收不收）');
    assert.ok(r.errors.join('|').includes('不在本次展示'), `★但留痕仍要点名"不在本次展示"：${r.errors.join('|')}`);
    assert.ok(r.errors.join('|').includes('照收'), '★leg197：留痕写明"照收，只记这一条"（不许静默）');
    assert.equal(JSON.stringify(r.setting).includes('"ev"'), false, '★setting（会持久化的那份）里不许出现原始凭证');
    // 首块不问根：只有非首块的提示词里有 roots 那一项
    const rootPrompts = prompts.filter((p) => p.includes('"roots"'));
    assert.ok(rootPrompts.length >= 1, '非首块要问根');
    assert.ok(rootPrompts.every((p) => p.includes('每条根都要带 `ev`')), '★每一块都要写明"根也要出处"');
    // skipRoster：整遍不跑 ⇒ 一条根都不问、`rawRoots` 不带这一格（不重抽、不新发调用）
    const before = prompts.length;
    const r2 = await extractWorldSetting({ sourceText: text, extract, allowedSources: blocks, seedRoots: { playerName: '' }, skipRoster: true });
    assert.equal(r2.rawRoots, undefined, '★skipRoster 不许重抽根');
    assert.equal(prompts.slice(before).some((p) => p.includes('"roots"')), false, '★skipRoster 的调用里一个字都不许问根');
});

test('Task4·拆半（输出截断的降级路）：子块的根与关系边**不许整批消失**', async () => {
    // 复审 F3：`mergeCleaned` → `mergeCanonChunks` 的返回字面量里没有 rawRoots/rawRelations
    //   ⇒ 拆半之后两个子块收下的东西静默丢光，且一条警告都没有。
    const A = { canon: { bookEntities: [] }, tension: {}, env: {}, rawRelations: [{ from: '甲', to: '乙', type: '盟友', _swVerified: true }], rawRoots: [{ title: '甲事', parties: ['甲'], quote: '甲和乙是盟友。' }] };
    const B = { canon: { bookEntities: [] }, tension: {}, env: {}, rawRelations: [{ from: '乙', to: '丙', type: '同门', _swVerified: true }], rawRoots: [{ title: '乙事', parties: ['乙'], quote: '乙和丙是同门。' }] };
    const merged = mergeCanonChunks([A, B]);
    assert.equal((merged.rawRelations || []).length, 2, '★合并必须把两个子块的关系边带出去（旧法整批丢）');
    assert.equal((merged.rawRoots || []).length, 2, '★合并必须把两个子块的根带出去（旧法整批丢）');
    // 没有这一格的块 ⇒ 合并结果也不多出这个键（老形状零扰动）
    const plain = mergeCanonChunks([{ canon: { bookEntities: [] }, tension: {}, env: {} }]);
    assert.equal(Object.prototype.hasOwnProperty.call(plain, 'rawRoots'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(plain, 'rawRelations'), false);
});

test('Task4·落账：已确认别名/正名唯一命中才收（歧义留痕、不新建实体）', () => {
    const w = emptySsot();
    w.entities = [
        { id: 'a', kind: 'character', name: '陆青', aliases: ['青衣客'] },
        { id: 'b', kind: 'character', name: '甲' },
        { id: 'c', kind: 'faction', name: '甲' },
    ];
    const r = applySeedRoots(w, [
        { title: '赴会', parties: ['青衣客'], quote: '青衣客赴会。' },
        { title: '撞车', parties: ['甲'], quote: '甲赴会。' },
        { title: '外人', parties: ['查无此人'], quote: '查无此人赴会。' },
    ]);
    assert.equal(r.seeded, 1, `只有唯一命中的那条能落账：${JSON.stringify(r)}`);
    assert.deepEqual(w.events[0].ripples, ['a']);
    assert.deepEqual(r.skippedParties.sort(), ['甲', '查无此人'].sort(), '歧义与未命中都要如实留痕');
    assert.equal(w.entities.length, 3, '★不新建实体、不复活任何东西');
    // 旧世界兼容：别名只住在书名录里（账上实体没有 aliases）
    const w2 = emptySsot();
    w2.entities = [{ id: 'a', kind: 'character', name: '陆青' }];
    w2.context.setting = { frozen: { canon: { bookEntities: [{ name: '陆青', aliases: ['青衣客'] }] } } };
    const r2 = applySeedRoots(w2, [{ title: '赴会', parties: ['青衣客'], quote: '青衣客赴会。' }]);
    assert.equal(r2.seeded, 1, '旧账（别名只在名册里）照旧认得出——与标签/归属/关系端点同一把尺子');
    // 幂等口径不变：本函数只保证 id 不撞、实体不动；"同标题不重种"仍由收口按块序做
    //   （`dedupeRootsAcrossChunks` 的 `existingTitles`）——那是**有次序**的判据，不许挪进这里。
    const before = w.events.length;
    const again = applySeedRoots(w, [{ title: '赴会', parties: ['青衣客'], quote: '青衣客赴会。' }]);
    assert.equal(again.seeded, 1);
    assert.equal(w.events.length, before + 1, '再落一次是新 id（同标题去重是收口的职责）');
    assert.deepEqual([...new Set(w.events.map((e) => e.id))].length, w.events.length, 'id 不许撞');
});

test('Task4·skipRoster 不重抽：rootsAsked 恒假 ⇒ 一遍也不问', async () => {
    const text = `${filler('甲线', 1600)}\n${filler('乙线', 1600)}`;
    const prompts = [];
    const extract = async (prompt) => { prompts.push(prompt); return JSON.stringify({ entities: [] }); };
    const r = await extractWorldSetting({ sourceText: text, extract, allowedSources: blocksOf([['w1', text]]), seedRoots: { playerName: '' }, skipRoster: true });
    assert.equal(r.ok, false, '没有设定的重抽应失败，且失败也不许补问根');
    assert.equal(r.rawRoots, undefined);
    assert.equal(prompts.some((p) => p.includes('"roots"')), false, '重抽设定那条路一个字都不许问根');
});
