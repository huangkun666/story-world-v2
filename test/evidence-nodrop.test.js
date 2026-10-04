// story-world-v2/test/evidence-nodrop.test.js
//
// ★★★leg197（2026-10-05 第五笔）——**用户令，逐字**：
//   「把抽象时因为引擎根据模型给的引用而找不到原文而丢弃模型提出的行动的这个行为全部取消了，
//     之前取消了属性相关的，现在我要全面撤销」
//
// 这一份判据守的就是那一句话本身，分三层：
//   ① **记账层**：出处核验照跑，但结果只进诊断——`unverified`（给了出处、对不上）**照收**，
//      `dropped` 在出处这条路上**恒为 0**（它现在只装"非出处原因"的丢弃）。
//   ② **净化层**（五条路各一条）：`sanitizeCanon` / `sanitizeScales` / `sanitizeBookRelations` /
//      `sanitizeSeedRoots` / `sanitizeGeography` —— 引用对不上时**东西照收**。
//   ③ **反向自证（这一层最要紧）**：全仓**不许再有**那几道闸的痕迹——
//      `filterByBookEvidence` 不存在 · `abstract.js` 不再 import `longestBookRun`/`SEED_QUOTE_MIN_RUN` ·
//      `sanitizeScales` 不再有 `settingClaim` 形参。★没有这一层，下一棒把闸加回来时**一片绿**。
//
// ★同时钉住**没有撤**的那一半（"形状"与"冲突"不是"找不到原文"）：
//   缺名/缺 title/缺当事人/自指/端点不在名册/枚举白名单——它们照旧丢。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    sanitizeCanon, sanitizeScales, sanitizeBookRelations, extractWorldSetting,
} from '../src/abstract.js';
import { sanitizeSeedRoots } from '../src/seed-roots.js';
import { sanitizeGeography } from '../src/geography-extract.js';
import { summarizeEvidence, evidenceRecord, freezeAllowedSources } from '../src/abstract-evidence.js';

const SRC = new URL('../src/', import.meta.url);
const readSrc = (f) => readFileSync(new URL(f, SRC), 'utf8');
/** 剥掉注释再咬（免得被注释里的旧话骗过——本仓 leg107 的老教训）。 */
const stripComments = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝ ① 记账层 ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
test('leg197①：出处对不上记 `unverified`（**照收**），`dropped` 在出处这条路上恒为 0', () => {
    const sum = summarizeEvidence([
        evidenceRecord({ cls: 'kind', subject: '甲', action: 'keep' }),
        evidenceRecord({ cls: 'kind', subject: '乙', action: 'unverified', why: '原话对不上（S1）' }),
        evidenceRecord({ cls: 'alias', subject: '丙', action: 'unverified', why: '缺来源编号（主张没带 ev.s）' }),
        evidenceRecord({ cls: 'parent', subject: '丁', action: 'pending' }),
    ]);
    assert.equal(sum.raw, 4);
    assert.equal(sum.kept, 1);
    assert.equal(sum.pending, 1);
    assert.equal(sum.unverified, 2, '★给了出处、对不上 ⇒ 记 unverified（这一档**照收**）');
    assert.equal(sum.dropped, 0, '★出处这条路上 dropped 恒为 0（它现在只装"非出处原因"的丢弃）');
    assert.equal(sum.unverifiedByReason['原话对不上（S1）'], 1, '★"为什么核不过"仍要看得见');
    assert.deepEqual(sum.byReason, {}, '★byReason 只装"为什么丢"——核不过不该混进去（那会读成"丢了很多"）');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝ ② 净化层（五条路） ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
test('leg197②-a：名册的类别/别名/所属——出处核不过**照收**（旧法三格全删）', () => {
    const src = '甲是乙的人。';
    const records = [];
    const frozen = freezeAllowedSources([{ sourceId: 'w1', text: src }]);
    const r = sanitizeCanon({
        bookEntities: [
            // ① 无 ev（缺来源编号）② 编号不在用料里 ③ 原话对不上 —— 三种核不过，各一条
            { name: '甲', kind: 'character', aliases: ['阿甲'], parent: '乙' },
            { name: '丙', kind: 'faction', ev: { s: 'S99', q: '这句根本不在材料里' } },
            { name: '丁', kind: 'character', aliases: ['小丁'], parent: '乙', ev: { s: 'S1', q: '编的一句' } },
        ],
    }, { sourceText: src, evidence: { frozen, strict: true, records } });
    const byName = new Map(r.canon.bookEntities.map((b) => [b.name, b]));
    for (const nm of ['甲', '丙', '丁']) {
        assert.ok(byName.has(nm), `★「${nm}」必须照收（旧法在核不过时会把它降成"待核对候选"）`);
    }
    assert.equal(byName.get('甲').kind, 'character', '★类别照收（旧法 `delete item.kind`）');
    assert.deepEqual(byName.get('甲').aliases, ['阿甲'], '★别名照收（旧法整批丢 / 逐条按"要在所引原话里"丢）');
    assert.equal(byName.get('甲').parent, '乙', '★所属照收（旧法不写 parent）');
    assert.equal(byName.get('丁').parent, '乙', '★原话对不上也照收');
    assert.deepEqual(byName.get('丁').aliases, ['小丁'], '★原话对不上也照收');
    assert.equal(records.filter((x) => x.action === 'unverified').length >= 3, true,
        '★三处核不过都要留诊断（不许静默）');
    assert.equal(records.some((x) => x.action === 'drop'), false, '★这一层不许再产出 drop');
});

test('leg197②-b：刻度的档位/注/维度——**一律不过出处闸**（连参数都没有了）', () => {
    const errors = [];
    const out = sanitizeScales([{
        名: '战力',
        档位: ['T1|感气境', 'T9|书里根本没写这一档'],
        子表: [{ 名: '细分', 档位: ['T1|初入门径', 'T2|凭空捏造'] }],
        维度: [{ 名: '编造的维度', 范围: '也不在原文里' }],
    }], { sourceText: '这本书里只有 T1 感气境 这几个字。' }, errors);
    assert.equal(out.length, 1, '★整张表照收（旧法"没有可核出处 ⇒ 整张不收"）');
    assert.deepEqual(out[0].档位.map((x) => x.档), ['T1', 'T9'], '★档位照收（旧法对不上原文即丢）');
    assert.equal(out[0].档位[1].注, '书里根本没写这一档', '★注照收（旧法"注不在所引出处里 ⇒ 丢注"）');
    assert.deepEqual(out[0].子表[0].档位.map((x) => x.档), ['T1', 'T2'], '★子表档位照收');
    assert.deepEqual(out[0].维度.map((x) => x.名), ['编造的维度'], '★维度照收');
    assert.equal(errors.some((e) => /原文查不到|不在所引出处里/.test(e)), false, '★那些"已弃"的留痕整族不再产生');
});

test('leg197②-c：关系边——原话对不上**照收**；形状/自指/端点不在名册**照旧丢**', () => {
    const roster = new Set(['甲', '乙']);
    const r = sanitizeBookRelations([
        { from: '甲', to: '乙', type: '盟友', quote: '编的一句，书里没有' },   // ★照收
        { from: '甲', to: '乙', type: '同门' },                              // ★缺 quote 也照收
        { from: '甲', to: '乙', type: '旧怨', _swVerified: undefined },        // ★缺块级核验也照收
        { from: '甲', to: '丙', type: '盟友', quote: '书里真有的句子' },        // 端点不在名册 ⇒ 丢
        { from: '甲', to: '甲', type: '自指' },                              // 自指 ⇒ 丢
        { from: '甲', to: '乙' },                                           // 缺 type ⇒ 丢
    ], { sourceText: '书里真有的句子。', rosterNames: roster });
    assert.deepEqual(r.kept.map((x) => x.type), ['盟友', '同门', '旧怨'], '★三条出处有问题的边全部照收');
    assert.equal(r.dropped.length, 3, '★丢的只剩"端点不在名册 / 自指 / 缺 type"三条');
    assert.ok(r.dropped.every((d) => /端点不在名册|同一个名号|缺一端/.test(d.why)),
        `★丢掉的理由里不许再出现"原话对不上"：${JSON.stringify(r.dropped)}`);
    assert.ok(r.kept.every((x) => !('quote' in x) && !('_swVerified' in x)), '★凭证核完即弃（落账形状不变）');
});

test('leg197②-d：起根——"指不回书里"的根**照收**；缺当事人**照旧丢**', () => {
    const frozen = freezeAllowedSources([{ sourceId: 'w1', text: '书里真有的那句话。' }]);
    const r = sanitizeSeedRoots({ roots: [
        { title: '外来事', parties: ['甲'], quote: '编的一句，书里没有' },      // ★照收
        { title: '没原话', parties: ['甲'], quote: '' },                    // ★缺 quote 也照收
        { title: '没出处', parties: ['甲'], quote: '随便一句' },              // ★缺 ev 也照收
        { title: '没人办', parties: [], quote: '书里真有的那句话。' },          // 缺当事人 ⇒ 丢
        { title: '', parties: ['甲'], quote: '书里真有的那句话。' },           // 缺 title ⇒ 丢
    ] }, { sourceText: '书里真有的那句话。', frozen });
    assert.deepEqual(r.roots.map((x) => x.title), ['外来事', '没原话', '没出处'], '★三条出处有问题的根全部照收');
    assert.ok(r.warnings.some((w) => w.includes('照收')), '★"核不过"仍要如实报出来（不许静默）');
    assert.ok(r.warnings.some((w) => w.includes('没有当事人')), '★缺当事人照旧丢，且理由照旧写明');
});

test('leg197②-e：地理——出处对不上**照收**；形状错**照旧丢**', () => {
    const r = sanitizeGeography({
        places: [
            { key: 'p1', name: '甲地', ev: { s: 'S99', q: '编的' } },                       // ★照收
            { key: 'p2', name: '乙地', qualifier: '不在所引原话里的身份说明', aliases: ['别名也不在'] }, // ★照收
            { key: 'p1', name: '编号重复' },                                                // 编号重复 ⇒ 丢
        ],
        links: [
            { from: 'p1', to: 'p2', type: 'passage', via: '编的通道名', condition: '编的条件' },  // ★照收
            { from: 'p1', to: 'p3', type: 'adjacent' },                                     // 端点未确认 ⇒ 丢
            { from: 'p1', to: 'p2', type: '乱写的类型' },                                     // 类型非法 ⇒ 丢
        ],
    }, { sourceText: '这本书里没有那些字。', evidence: null });
    assert.deepEqual(r.geography.places.map((x) => x.name), ['甲地', '乙地'], '★两个地点照收（旧法出处核不过 ⇒ 丢）');
    assert.equal(r.geography.places[1].qualifier, '不在所引原话里的身份说明', '★身份说明照收（旧法 `literal()` 拦）');
    assert.deepEqual(r.geography.places[1].aliases, ['别名也不在'], '★别名照收');
    assert.equal(r.geography.links.length, 1, '★通道那条照收');
    assert.equal(r.geography.links[0].via, '编的通道名', '★通道名照收');
    assert.equal(r.geography.links[0].condition, '编的条件', '★通行条件照收');
    assert.ok(r.dropped.every((d) => /编号重复|端点未确认|类型非法/.test(d.why)),
        `★丢的只剩形状错：${JSON.stringify(r.dropped)}`);
});

test('leg197②-f：端到端——书文里根本没有的名号与设定，现在**进得了 canon**（名字闸已撤）', async () => {
    const text = '甲是乙的人。天地灵气稀薄。';
    const r = await extractWorldSetting({
        sourceText: text,
        extract: async () => JSON.stringify({
            bookEntities: [{ name: '甲', kind: 'character' }, { name: '书里没有这个人', kind: 'faction' }],
            entities: [{ name: '别处来的', kind: 'character', fields: { 身份: '外来内容' } }],
            society: '凡俗国度林立。',
        }),
        allowedSources: [{ sourceId: 'w1', text }],
    });
    assert.equal(r.ok, true, `抽取应成功：${(r.errors || []).join('；')}`);
    const names = r.setting.frozen.canon.bookEntities.map((b) => b.name);
    assert.ok(names.includes('书里没有这个人'), `★书文里没有的名号也照收（旧法 filterByBookEvidence 会摘掉它）：${names}`);
    const settings = r.setting.frozen.canon.settings.map((b) => b.name);
    assert.ok(settings.includes('别处来的'), `★设定面那道"名字要在书文里"的校验已撤：${settings}`);
    assert.equal(r.setting.frozen.canon.society, '凡俗国度林立。', '★无出处的设定照收（旧法"一律不收"）');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝ ③ 反向自证（闸不许偷偷加回来） ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
test('leg197③（反向自证）：那几道出处闸的痕迹在全仓**一个都不许留**', () => {
    const abs = stripComments(readSrc('abstract.js'));
    assert.equal(/filterByBookEvidence/.test(abs), false,
        '★`filterByBookEvidence`（"名字必须真在书文里"那道全书级校验）不许回来——它正是"找不到原文就丢"');
    assert.equal(/^\s*import[^\n]*longestBookRun/m.test(abs), false,
        '★`abstract.js` 不许再 import `longestBookRun`（关系边那道"原话要在书文里"的尺子）');
    assert.equal(/^\s*import[^\n]*SEED_QUOTE_MIN_RUN/m.test(abs), false,
        '★`abstract.js` 不许再 import `SEED_QUOTE_MIN_RUN`（同上）');
    assert.equal(/settingClaim/.test(abs), false,
        '★`sanitizeScales` 的 `settingClaim` 形参不许回来（档位那一族已不过出处闸）');
    // 关系边那一层：`_swVerified` 只许"记在收下的边上"，不许再当放行条件
    assert.equal(/if\s*\(\s*strict\s*&&\s*it\._swVerified\s*!==\s*true\s*\)/.test(abs), false,
        '★"块级没核过 ⇒ 丢这条边"那一支不许回来');
    // 起根那一层：`sanitizeSeedRoots` 里不许再有"指不回书里 ⇒ 丢"
    const roots = stripComments(readSrc('seed-roots.js'));
    assert.equal(/指不回书里/.test(roots), false, '★起根那道"指不回书里 ⇒ 丢"不许回来');
    assert.equal(/最长只对得上/.test(roots), false, '★起根那道"最长只对上 N 个字 ⇒ 丢"不许回来');
    // 地理那一层：`literal()`（"名称要在核过的引用里逐字出现"）不许回来
    const geo = stripComments(readSrc('geography-extract.js'));
    assert.equal(/未在核过的引用中逐字出现/.test(geo), false, '★地理那道 `literal()` 不许回来');
    // 查书那一层：字段值不许再因出处被拒
    const look = stripComments(readSrc('entity-lookup.js'));
    assert.equal(/字段值不在所引原话里（别处的原话不算）'\s*;\s*continue/.test(look), false,
        '★查书"字段值不在所引原话里 ⇒ 不收"那一支不许回来');
});

test('leg197③（另一半·没有撤）：形状与冲突照旧丢——这条与上面那条是一对', () => {
    // 名册：缺 name 照旧丢
    const r1 = sanitizeCanon({ bookEntities: [{ kind: 'character' }, { name: '甲', kind: 'character' }] }, {});
    assert.deepEqual(r1.canon.bookEntities.map((b) => b.name), ['甲'], '★缺 name 照旧丢（形状，不是出处）');
    // 环境档位：枚举白名单照旧拦（`normalizeParam`）
    const r2 = sanitizeCanon({ env: { 民生度: '很惨' } }, {});
    assert.equal(r2.env.民生度, undefined, '★不是本书档位词 ⇒ 照旧丢（枚举，不是出处）');
    assert.ok(r2.errors.some((e) => /不是本书档位词/.test(e)), '★且要留痕');
    // 关系边：端点不在名册照旧丢
    const r3 = sanitizeBookRelations([{ from: '甲', to: '查无此人', type: '盟友' }], { rosterNames: new Set(['甲']) });
    assert.equal(r3.kept.length, 0, '★端点不在名册 ⇒ 照旧丢（解析不出实体 id，收下也落不了账）');
    // 起根：缺当事人照旧丢
    const r4 = sanitizeSeedRoots({ roots: [{ title: '没人办', parties: [], quote: 'x' }] }, {});
    assert.equal(r4.roots.length, 0, '★缺当事人 ⇒ 照旧丢');
});
