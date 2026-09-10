// story-world-v2/test/book-tags.test.js
// 第二十三棒（leg23）：书自己声明的结构——照书办，不猜。
// 实证（大荒-姬元真 233 条 + 导出 (5) 688 名册 / 108 势力）：
//   书用标签声明了 27 个势力——名册判对 17、判成地名 7、根本没进册 3；
//   9 条把上级直接写进标签（<渡虚帝麾下_界渊长城>），名册一个都没用上；
//   108 个势力只有 1 个有下属分支表（散落成灾的量化证据）。
// 真模型实测（切 4 批喂，43 条关系、原句逐字命中 43/43）：模型读得准，是被后续校验扔掉的
//   （蟠桃园→瑶池 因瑶池被判 location 而弃；天庭百官→人帝姬元真 因人帝姬元真不在册而弃）。
// 本步口径：①书标了是势力 → 就按势力入账（标签权威高于名字形态猜测）
//           ②书把上级写进标签 → 直接照抄该边（零模型调用）
//           ③关系不再要求"上级必须是势力"，改"在册即可"；不在册的丢弃且不重复刷警告。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanBookDeclarations, buildRosterPrompt, runRelationRound } from '../src/abstract.js';

// 书条目：首行标签 + 正文（与真实世界书同形态）
const entry = (tag, body = '正文若干字。') => `<${tag}>\n${body}`;

test('照书办①：标签声明扫描——类型标签与上级标签两种形态都读出来', () => {
    const src = [
        entry('上界势力_蟠桃园', '辖属: 瑶池（瑶池主代人帝管辖）'),
        entry('上界势力_第十六重天_凤鸣天阙'),
        entry('幽冥势力_酆都鬼府'),
        entry('渡虚帝麾下_界渊长城', '戍海大罗。'),
        entry('织命帝麾下_红尘情天'),
        entry('战力准则'),                      // 脚手架：有标签但不是实体声明
        entry('rule_T1战力体现'),
        '【人帝天庭六重天总览】',               // 无标签条目（架构条目，不当实体声明）
    ].join('\n');
    const { declares, usesLabelTerms } = scanBookDeclarations(src);
    assert.deepEqual(
        declares.map((d) => d.name),
        ['蟠桃园', '凤鸣天阙', '酆都鬼府', '界渊长城', '红尘情天'],
        '声明名号按书序取出（脚手架标签与无标签条目不算声明）',
    );
    assert.equal(declares[0].kind, 'faction', '「上界势力」→ 势力');
    assert.equal(declares[2].kind, 'faction', '「幽冥势力」→ 势力');
    assert.equal(declares[3].kind, 'faction', '「X帝麾下」→ 势力');
    assert.equal(declares[3].parent, '渡虚帝', '标签里的上级逐字取出（照抄，不推断）');
    assert.equal(declares[4].parent, '织命帝');
    assert.equal(declares[0].parent, undefined, '类型标签不带上级');
    assert.deepEqual(usesLabelTerms, [], '未使用词表判据 → 零词表命中记录（可测的死板度）');
});

test('照书办①：只有「X势力」形态才算类型声明（判据是形态，不是词表）', () => {
    const src = [
        entry('大荒战界'),                // 像地名、无声明 → 不由扫描器下结论
        entry('上界势力_须弥山'),
        entry('混沌势力_乙'),             // 生造前缀 + 「势力」形态 → 仍应认出（不靠预先写好的前缀清单）
    ].join('\n');
    const { declares } = scanBookDeclarations(src);
    assert.deepEqual(declares.map((d) => d.name).sort(), ['乙', '须弥山']);
});

test('照书办①：名册轮提示词带上书的声明名号（模型漏了也不丢）', () => {
    const p = buildRosterPrompt('书文……', [{ name: '界渊长城' }, { name: '忘忧凡川' }]);
    assert.match(p, /界渊长城/, '声明名号入提示词');
    assert.match(p, /忘忧凡川/);
    const p2 = buildRosterPrompt('书文……');
    assert.ok(!p2.includes('界渊长城'), '无声明时提示词零扰动（小书/无标签书行为不变）');
});

test('照书办②：书把上级写进标签 → 名册里直接落 parent（零模型调用）', async () => {
    const src = [
        entry('渡虚帝麾下_界渊长城', '戍海大罗，镇守宇宙边荒。'),
        entry('太素帝麾下_太昊仙洲', '高原繁华之极点。'),
        '文'.repeat(31000),                                  // 逼大书路径
    ].join('\n');
    const seen = [];
    const extract = async (prompt) => {
        seen.push(prompt);
        if (prompt.includes('名册抽取器')) {
            assert.match(prompt, /界渊长城/, '声明清单只作召回提示随提示词给出（模型漏了也不丢）');
            // 模型本轮只报了上级、把两个下级漏了 → 照书办必须把它们补回来
            return JSON.stringify({ bookEntities: [{ name: '渡虚帝', kind: 'character' }, { name: '太素帝', kind: 'character' }] });
        }
        if (prompt.includes('关系抽取器') || prompt.includes('属性抽取器')) return JSON.stringify({ bookEntities: [] });
        return JSON.stringify({ powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [], bookEntities: [], tension: {}, env: {} });
    };
    const { extractWorldSetting } = await import('../src/abstract.js');
    const r = await extractWorldSetting({ sourceText: src, extract, cache: null });
    assert.equal(r.ok, true);
    const book = r.setting.frozen.canon.bookEntities;
    const cb = book.find((b) => b.name === '界渊长城');
    assert.ok(cb, '书声明了的名号必须进册（模型漏了也不行）');
    assert.equal(cb.kind, 'faction', '照书的标签定类别（不被名字形态改判）');
    assert.equal(cb.parent, '渡虚帝', '标签里的上级照抄落账');
    const ty = book.find((b) => b.name === '太昊仙洲');
    assert.equal(ty.kind, 'faction', '「洲」字不改判：书标了势力就是势力（实证 7 例误判之根）');
    assert.equal(ty.parent, '太素帝');
    assert.ok(r.errors.some((e) => /照书办/.test(e)), '照书办留痕（补入册/改判计数）');
});

test('照书办③：关系轮改「在册即可」——上级是角色也照挂（不再因非势力而扔）', async () => {
    const rows = ['【天庭百官】天庭辖下百官。', '【人帝姬元真】人帝。', '【瑶池】瑶池。'];
    const names = [
        { name: '天庭百官', kind: 'faction' },
        { name: '人帝姬元真', kind: 'character' },
        { name: '瑶池', kind: 'faction' },
    ];
    const errs = await runRelationRound(rows, names, async () => JSON.stringify({
        bookEntities: [{ name: '天庭百官', parent: '人帝姬元真' }],
    }));
    assert.equal(names[0].parent, '人帝姬元真', '在册角色也能当上级（实证：书里就是「统辖: 人帝姬元真」）');
    assert.deepEqual(errs, [], '合法落账零警告');

    const n2 = [{ name: '天庭百官', kind: 'faction' }];
    const errs2 = await runRelationRound(rows, n2, async () => JSON.stringify({
        bookEntities: [{ name: '天庭百官', parent: '不在册的上级' }],
    }));
    assert.equal(n2[0].parent, undefined, '不在册 → 仍弃（诚实底线不动）');
    assert.equal(errs2.filter((e) => /不在册/.test(e)).length, 1, '不在册照旧留痕一次');
});

test('照书办③：上级是角色（统治者）→ 名号独立入账 + 记为名下机构（不误折叠）', async () => {
    const { seedBookEntities } = await import('../src/abstract.js');
    const mk = (book) => ({ context: { tension: 0.5, positions: ['未明'], setting: { frozen: { canon: { bookEntities: book } } } }, entities: [], weights: {} });
    const w = mk([
        { name: '界渊长城', kind: 'faction', parent: '渡虚帝' },
        { name: '渡虚帝', kind: 'character' },
    ]);
    const r = seedBookEntities(w);
    assert.equal(r.folded, 0, '角色不作折叠目标（不新建实体、不动分量）');
    const wall = w.entities.find((e) => e.name === '界渊长城');
    assert.ok(wall, '名号照常独立入账（是棋手，不是编制）');
    assert.equal(wall.parent, '渡虚帝', '归属写进实体（书里明述的上级）');
    assert.equal(r.warnings.length, 0, '不再误报「未明述为独立势力」（旧口径的 9 条误报之根）');
    assert.equal(r.organsAttached, 1);
    assert.deepEqual(w.entities.find((e) => e.name === '渡虚帝').organs, ['界渊长城'], '名义势力的名下机构落账（实体页可见）');
});

test('照书办③：上级是地名 → 仍弃（诚实底线：地名不是上级）', async () => {
    const { seedBookEntities } = await import('../src/abstract.js');
    const w = { context: { tension: 0.5, positions: ['未明'], setting: { frozen: { canon: { bookEntities: [
        { name: '某堂', kind: 'faction', parent: '某洲' },
        { name: '某洲', kind: 'location' },
    ] } } } }, entities: [], weights: {} };
    const r = seedBookEntities(w);
    assert.equal(r.folded, 0);
    assert.ok(w.entities.some((e) => e.name === '某堂'), '名号仍入账');
    assert.equal(r.warnings.length, 1, '弃关系留痕一次');
});
