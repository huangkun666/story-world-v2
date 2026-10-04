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
// leg24 片1（停抄书）后：**模型侧的关系轮已删**——上级只从书标签照抄；书里没标的一律空着（用到时查书）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanBookDeclarations, buildRosterPrompt } from '../src/abstract.js';

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

test('leg25 g：名册提示词必须约束「一个实体只出一条 + 种族名不许标 faction」（治碎块）', () => {
    // 用户 2026-09-11：「治碎块只能尽量做提示词约束吧？」——对，而且这是源头。
    // 实测病根（真账 699 名号）：书条目 `人族皇朝`（key 明写 大虞/大虞皇朝）被抽成三个独立 faction，
    //   各自无成员 ⇒ 152 个势力里 108 个空壳；另有 7 个**纯种族名**被标成 faction（违反原有规则 2）。
    // 这两条约束一旦被删掉，碎片会在**每个新世界**重新长出来，所以锁住。
    const p = buildRosterPrompt('书文……');
    assert.match(p, /一个实体只出一条/, '★同一实体的多个叫法不许拆成多条（碎块的源头）');
    assert.match(p, /是同一个实体，只许出一条/, '明示"别名=同一个实体"');
    assert.match(p, /不许把同一个东西拆成多条/, '反向表述也在（两种说法任一被删都能发现）');
    assert.match(p, /规则 2 是硬性要求/, '★把原有"种族名不算势力"从建议升级为硬性要求');
    for (const race of ['人族', '妖族', '鬼族', '魔族', '灵族', '仙族', '神族', '半妖', '龙族']) {
        assert.ok(p.includes(race), `种族名清单含「${race}」（明示而非让模型自己猜）`);
    }
    assert.match(p, /违反第 2、7、8 条/, '违规要重作——否则模型照样违反');
    // 反向锁：原有纪律不许被这次改动挤掉（回归）
    assert.match(p, /纯种族的群体名号/, '原有规则 2 仍在');
    assert.match(p, /宁可多不可漏/, '原有规则 6 仍在（召回优先，只有种族/别名两条是硬的）');
    // 有声明时，声明清单的编号必须跟着顺延（不许出现两个 7）
    const p2 = buildRosterPrompt('书文……', [{ name: '界渊长城' }]);
    assert.match(p2, /9\. 本段原文里被标签直接标出来的名号/, '声明清单编号顺延为 9（不与新增的 7/8 撞号）');
    assert.equal((p2.match(/7\. /g) || []).length, 1, '编号 7 只出现一次');
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
        // leg24 片1：关系轮/属性轮已删——除名册轮与五件套轮外不再有其他调用
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

test('照书办③：标签里的上级是角色（统治者）→ 名号独立入账 + 记为名下机构（不误折叠）', async () => {
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
    // ★leg25 g（P2 锁）：**凡有 parent 必有 parentSource**。
    //   旧法这条路只写了 `parent`，漏了来源 ⇒ 真账 9 条 `parentSource === undefined`
    //   （太昊仙洲/无念禅境→太素帝、大荒战界→噬天帝、须弥界域/界渊长城→渡虚帝…）。
    //   来源是"书里写的还是引擎推的"的分账，面板靠它标「（推）」——空着就分不清明述与推断。
    assert.equal(wall.parentSource, '模型抽取', '★有 parent 就必须有 parentSource（这条路的漏打已补）');
    assert.equal(wall.parentSourceFrom, 'sub-faction-role', '证据类型也落账（可审计）');
    // 全账扫描式断言：这条锁的意义是"以后再漏也会红"，不只盯这一个实体
    for (const e of w.entities) {
        if (!e.parent) continue;
        assert.ok(typeof e.parentSource === 'string' && e.parentSource.length > 0,
            `★凡有 parent 必有 parentSource：${e.name} 缺来源`);
        assert.ok(typeof e.parentSourceFrom === 'string' && e.parentSourceFrom.length > 0,
            `★凡有 parent 必有 parentSourceFrom：${e.name} 缺证据类型`);
    }
});

test('Task3：书条目 key 里的势力名不再当成员行（名单形态不建立归属）', async () => {
    // ★★★Task 3 口径变更（依据：已批准设计 §6.2「成员行正则和关键词命中只用于定位，
    //   不直接新增关系」；先有失败证据：旧断言在改后实测 虞昭华.parent 由 '大虞' 变 undefined）。
    //   旧锁要的正是"key 命中势力名 + 像花名册 ⇒ 反推归属"（第二十五棒 e P3）——那条路已按设计移除。
    //   现在要写归属，只能由模型给依据（严格道核来源与原话）或作者标签声明。
    const { seedBookEntities } = await import('../src/abstract.js');
    const mk = (book) => ({ context: { tension: 0.5, positions: ['未明'], setting: { frozen: { canon: { bookEntities: book } } } }, entities: [], weights: {} });
    const BOOK = [
        { name: '大虞', kind: 'faction' },
        { name: '虞昭华', kind: 'character' },
        { name: '秦红袖', kind: 'character' },
        { name: '散修甲', kind: 'character' },
    ];
    const entries = [{
        comment: '人族皇朝',
        key: ['大虞', '大虞皇朝', '虞昭华', '女帝'],
        content: '势力所在地：中天神洲·中州。\n代表人物:\n- 虞昭华（女，T8大乘中期）：大虞女帝。\n- 秦红袖（女，T7合体后期）：供奉。\n',
    }];
    const w = mk(BOOK);
    seedBookEntities(w, { entries });
    assert.equal(w.entities.find((e) => e.name === '虞昭华').parent, undefined, '★key 命中不再反推归属');
    assert.equal(w.entities.find((e) => e.name === '秦红袖').parent, undefined, '同条目里的其他成员同样不反推');
    assert.equal(w.entities.find((e) => e.name === '散修甲').parent, undefined, '不在成员行里的角色更不许被牵连');
    // 模型主张的归属照常落账（这是唯一合法的来源）
    const BOOK2 = [{ name: '大虞', kind: 'faction' }, { name: '虞昭华', kind: 'character', parent: '大虞' }];
    const w2 = mk(BOOK2);
    seedBookEntities(w2, { entries });
    assert.equal(w2.entities.find((e) => e.name === '虞昭华').parent, '大虞', '模型主张照常落账');
    assert.equal(w2.entities.find((e) => e.name === '虞昭华').parentSourceFrom, 'model-claim');
});

test('照书办③：上级是地名 → 仍弃（诚实底线：地名不是上级）；判词按原因分措辞（片1 修正）', async () => {
    const { seedBookEntities } = await import('../src/abstract.js');
    const w = { context: { tension: 0.5, positions: ['未明'], setting: { frozen: { canon: { bookEntities: [
        { name: '某堂', kind: 'faction', parent: '某洲' },
        { name: '某洲', kind: 'location' },
    ] } } } }, entities: [], weights: {} };
    const r = seedBookEntities(w);
    assert.equal(r.folded, 0);
    assert.ok(w.entities.some((e) => e.name === '某堂'), '名号仍入账');
    assert.equal(r.warnings.length, 1, '弃关系留痕一次');
    assert.match(r.warnings[0], /是地名/, '上级在册但是地名 → 说"是地名"（不许说成"未明述"）');

    // 上级**不在册**（书里没它的条目）：判词要说清是"不在册"，不是"未明述为独立势力"
    const w2 = { context: { tension: 0.5, positions: ['未明'], setting: { frozen: { canon: { bookEntities: [
        { name: '界渊长城', kind: 'faction', parent: '渡虚帝' },
    ] } } } }, entities: [], weights: {} };
    const r2 = seedBookEntities(w2);
    assert.equal(r2.warnings.length, 1);
    assert.match(r2.warnings[0], /不在册/, '上级不在册 → 判词如实说"不在册"');
    assert.equal(w2.entities.find((e) => e.name === '界渊长城').parent, undefined, '关系不落账（隶属空着）');
    assert.ok(w2.entities.some((e) => e.name === '界渊长城'), '名号照常入账');
});
