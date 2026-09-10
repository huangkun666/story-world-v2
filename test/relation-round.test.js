// story-world-v2/test/relation-round.test.js
// K49（词档细案 §2.1 → A-1 判据）：名册轮再瘦身到 {name,kind} 之后，隶属/所在/种族由**独立关系轮**按批补——
// 起因=大名册下可选字段最先被省略（导出 (3)：504 名册 parent 覆盖率 82%；600 版「天庭百官」无 parent → 独立入账）。
// 引擎侧「只提取不创作」：parent 须**在册且为 faction**（否则弃关系+留痕、名号保留）；
// race/location 逐字出处校验由 validateRosterDetails 在书级收口；原料补齐即生效=seedBookEntities 折叠零改动；
// 批限流：批文本 ≤ ROUND_BATCH_CHAR（超长条目书单批输入失控防护）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildRelationPrompt, runRelationRound, extractWorldSetting, seedBookEntities,
    ATTRS_BATCH_MAX, ROUND_BATCH_CHAR,
} from '../src/abstract.js';

// 书行：名号用【】标出——mock 从原文里"提取"名号（只提取不创作的同口径模拟）
const row = (name, fill = 200) => `【${name}】` + '字'.repeat(fill);
const filler = (n, len = 1900) => Array.from({ length: n }, () => '山海之间，云气翻涌。' + '文'.repeat(len));
const namesIn = (text) => [...text.matchAll(/【([^】]+)】/g)].map((m) => m[1]);
const section = (prompt, header) => {
    const i = prompt.indexOf(header);
    return i < 0 ? '' : prompt.slice(i + header.length);
};

// 大书路径 mock：名册轮只出 {name,kind}；关系轮按注入表回 parent/race/location；属性轮回空；canon 轮回空五件套
function makeExtract({ relations = {}, kindOf = () => 'character', seen = null } = {}) {
    return async (prompt) => {
        const src = section(prompt, '———— 设定原文如下 ————');
        if (prompt.includes('名册抽取器')) {
            seen?.roster.push(prompt);
            return JSON.stringify({ bookEntities: namesIn(src).map((name) => ({ name, kind: kindOf(name) })) });
        }
        if (prompt.includes('关系抽取器')) {
            seen?.relation.push(prompt);
            const asked = section(prompt, '———— 待抽取关系的名号 ————').split('、').map((s) => s.trim()).filter(Boolean);
            const bookEntities = asked.filter((n) => relations[n]).map((n) => ({ name: n, ...relations[n] }));
            return JSON.stringify({ bookEntities });
        }
        if (prompt.includes('属性抽取器')) { seen?.attrs.push(prompt); return JSON.stringify({ bookEntities: [] }); }
        seen?.canon.push(prompt);
        return JSON.stringify({ powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [], bookEntities: [], tension: {}, env: {} });
    };
}
const emptySeen = () => ({ roster: [], relation: [], attrs: [], canon: [] });

test('K49 关系轮 prompt：只问隶属/所在/种族 + 天庭百官样例逐字在位 + 名号清单', () => {
    const p = buildRelationPrompt(['天庭百官', '薛铁衣'], '书文……');
    assert.match(p, /"parent":"天庭"/, '模板示例逐字给出「天庭百官 → parent: 天庭」判读样例（细案 §2.1 要求）');
    assert.match(p, /不得拿"天庭百官""众神"这类集合称呼当上级/, '集合称呼当上级的禁令在位');
    assert.match(p, /待抽取关系的名号/);
    assert.match(p, /天庭百官、薛铁衣/, '名号清单随批传入');
    assert.ok(!p.includes('hardPower') && !p.includes('"attrs"'), '不问属性（属性轮职责，两轮不重叠）');
    assert.ok(!p.includes('powerScale') && !p.includes('situation'), '不问五件套/世情');
});

test('K49 runRelationRound：parent 只在册且为势力才落账；first-wins 不回改；race/location 补缺 + 留痕', async () => {
    const rows = ['【天庭百官】天庭辖下百官。', '【凌云古族】古族。', '【薛铁衣】剑客。', '【天庭】天界至高。'];
    // 场景一：天庭 不在名册 → 目标不在册，弃关系
    const names = [
        { name: '天庭百官', kind: 'faction' },
        { name: '凌云古族', kind: 'faction', parent: '已有上级' },
        { name: '薛铁衣', kind: 'character' },
    ];
    const errs = await runRelationRound(rows, names, async () => JSON.stringify({
        bookEntities: [
            { name: '天庭百官', parent: '天庭' },        // 天庭 不在名册 → 弃
            { name: '凌云古族', parent: '天庭' },        // 已有 parent → first-wins 不回改
            { name: '薛铁衣', race: '人族', location: '剑冢' },
        ],
    }));
    assert.equal(names[0].parent, undefined, '目标不在册 → 弃关系（名号保留）');
    assert.ok(errs.some((e) => /隶属/.test(e)), '弃置留痕（A-1）');
    assert.equal(names[1].parent, '已有上级', 'first-wins：已有隶属不回改');
    assert.equal(names[2].race, '人族', 'race 补缺');
    assert.equal(names[2].location, '剑冢', 'location 补缺');

    // 场景二（leg23 改口径）：parent 在册但是角色 → 照挂（书里「统辖: 人帝姬元真」就是指向人）
    const n2 = [{ name: '天庭百官', kind: 'faction' }, { name: '薛铁衣', kind: 'character' }];
    const errs2 = await runRelationRound(rows, n2, async () => JSON.stringify({ bookEntities: [{ name: '天庭百官', parent: '薛铁衣' }] }));
    assert.equal(n2[0].parent, '薛铁衣', 'leg23：在册即可（含角色）——旧口径「须为势力」实测扔掉了真关系');
    assert.deepEqual(errs2, [], '合法落账零警告');

    // 场景二·补：parent 不在册 → 仍弃（诚实底线不动），留痕按名号去重（不刷屏）
    const n2b = [{ name: '天庭百官', kind: 'faction' }];
    const errs2b = await runRelationRound(rows, n2b, async () => JSON.stringify({ bookEntities: [{ name: '天庭百官', parent: '界渊长城' }] }));
    assert.equal(n2b[0].parent, undefined, '不在册 → 弃关系（不新建实体、不猜测）');
    assert.equal(errs2b.filter((e) => /不在册/.test(e)).length, 1, '弃置留痕一次（按名号去重）');

    // 场景三：parent 在册且为势力 → 落账，零留痕
    const n3 = [{ name: '天庭百官', kind: 'faction' }, { name: '天庭', kind: 'faction' }];
    const errs3 = await runRelationRound(rows, n3, async () => JSON.stringify({ bookEntities: [{ name: '天庭百官', parent: '天庭' }] }));
    assert.equal(n3[0].parent, '天庭', '在册势力 → 隶属落账');
    assert.deepEqual(errs3, [], '正常路径零警告');
});

test('A-1 golden：关系轮补 parent → seedBookEntities 零改动折叠（天庭百官 → 天庭.branches，不独立入账）', async () => {
    const src = [row('天庭', 400), row('天庭百官', 400), row('薛铁衣', 400), ...filler(20)].join('\n');
    assert.ok(Array.from(src).length > 30000, '前置：大书路径（关系轮只在名册定稿后发起）');
    const seen = emptySeen();
    const r = await extractWorldSetting({
        sourceText: src,
        extract: makeExtract({
            relations: { 天庭百官: { parent: '天庭' } },
            kindOf: (n) => (n === '天庭' || n === '天庭百官' ? 'faction' : 'character'),
            seen,
        }),
        cache: null,
    });
    assert.equal(r.ok, true);
    assert.ok(seen.relation.length >= 1, '关系轮确实发起调用（A-1）');
    const canon = r.setting.frozen.canon;
    assert.equal(canon.bookEntities.find((b) => b.name === '天庭百官').parent, '天庭', '关系轮补到 parent');

    // 原料补齐即生效：seedBookEntities 折叠逻辑零改动
    const ssot = { context: { setting: r.setting, positions: ['未明'] }, entities: [], weights: {} };
    const res = seedBookEntities(ssot);
    assert.ok(res.folded >= 1, '折叠发生');
    const tianting = ssot.entities.find((e) => e.name === '天庭');
    assert.ok(tianting.branches?.includes('天庭百官'), '天庭 分支表含 天庭百官（A-1 golden 锁）');
    assert.ok(!ssot.entities.some((e) => e.name === '天庭百官'), '子势力不独立入账（复验痛点②消解）');
});

test('K49 关系轮补到的所在/种族同过书级出处校验（不在原文 → 弃+留痕）', async () => {
    const src = [row('长风宗', 400), '人族与妖族杂居于此，长风宗执牛耳。' + '文'.repeat(1900), ...filler(20)].join('\n');
    const seen = emptySeen();
    const r = await extractWorldSetting({
        sourceText: src,
        extract: makeExtract({
            relations: { 长风宗: { location: '落霞谷', race: '人族' } },   // 落霞谷 ∉ 原文 → 弃；人族 ∈ 原文 → 留
            kindOf: () => 'faction',
            seen,
        }),
        cache: null,
    });
    assert.equal(r.ok, true);
    const entry = r.setting.frozen.canon.bookEntities.find((b) => b.name === '长风宗');
    assert.equal(entry.location, undefined, '所在不在原文 → 弃');
    assert.equal(entry.race, '人族', '种族在原文 → 保留');
    assert.ok(r.errors.some((e) => /所在出处校验/.test(e)), '弃置留痕');
});

test('A-1：关系轮调用数 = ceil(候选名号 / ATTRS_BATCH_MAX)', async () => {
    const count = 250;
    const src = [...Array.from({ length: count }, (_, i) => row(`名号${i}`, 200)), ...filler(5, 1200)].join('\n');
    assert.ok(Array.from(src).length > 30000, '前置：大书路径');
    const seen = emptySeen();
    const r = await extractWorldSetting({ sourceText: src, extract: makeExtract({ seen }), cache: null });
    assert.equal(r.ok, true);
    assert.equal(r.setting.frozen.canon.bookEntities.length, count, '名册全量');
    assert.equal(seen.relation.length, Math.ceil(count / ATTRS_BATCH_MAX), '关系轮按批上限分拆');
});

test('K49 批文本限流：超长条目书按字符拆批（≤ ROUND_BATCH_CHAR），不靠名号数兜底', async () => {
    // 4 行 × ~3 万字符：名号数只够 1 批（远小于 ATTRS_BATCH_MAX），字符上限必须逼出 2 批
    const list = ['长风宗', '赤霄门', '玄水道', '白鹿谷'];
    const src = list.map((n) => `【${n}】` + '文'.repeat(30000)).join('\n');
    const seen = emptySeen();
    const r = await extractWorldSetting({ sourceText: src, extract: makeExtract({ seen }), cache: null });
    assert.equal(r.ok, true);
    assert.equal(seen.relation.length, 2, `字符上限拆批（实际 ${seen.relation.length} 批）`);
    const perBatch = seen.relation.map((p) => section(p, '———— 待抽取关系的名号 ————').split('、').map((s) => s.trim()).filter(Boolean));
    assert.deepEqual(perBatch.map((a) => a.length), [2, 2], '每批 2 个名号（≈6 万字符/批）');
    for (const p of seen.relation) {
        const body = section(p, '———— 设定原文如下 ————').split('———— 待抽取关系的名号 ————')[0];
        assert.ok(Array.from(body).length <= ROUND_BATCH_CHAR + 30010, '批文本不超上限（单行超限者自成一批）');
    }
});
