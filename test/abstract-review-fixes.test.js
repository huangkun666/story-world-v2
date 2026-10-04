// story-world-v2/test/abstract-review-fixes.test.js
// Task 3 复查（task-3-review.md 的 11 条 Important + 1 条 Minor）的**真实数据流**回归。
//
// 依据（全部已批准，不再重复批准）：
//   · F:/deepseek/tmp/leg185-abstraction-sources/dsh-task-3-implementation.md（约束全文）
//   · F:/deepseek/tmp/leg185-abstraction-sources/task-3-review.md（本次要修的 11+1 条）
//   · F:/deepseek/tmp/leg185-abstraction-sources/task-3-parent-review-notes.md（独立红证据）
//   · docs/superpowers/specs/2026-10-03-abstraction-sources-design.md §6.1/§6.2/§6.3
//
// 纪律：全部走**生产函数**（`extractWorldSetting` / `sanitizeCanon` / `dedupeRoster` /
//   `seedBookEntities` / `seedBookRelations` / `extractTags` / `selectEntityPage`），
//   不写"被测逻辑的复制品"；固定响应只证明程序保存链，不宣称模型识别质量（设计 §8 末条）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    dedupeRoster, seedBookEntities, seedBookRelations, extractWorldSetting,
} from '../src/abstract.js';
import { freezeAllowedSources, evidenceDictionary, verifyQuote } from '../src/abstract-evidence.js';
import { extractTags } from '../src/tag-extract.js';
import { entsSearchTextOf, selectEntityPage } from '../src/render.js';
import { resolveEntityName } from '../src/entity-identity.js';

const blocksOf = (pairs) => pairs.map(([sourceId, text]) => ({ sourceId, text }));
const fixed = (payload, calls = null) => async (prompt) => {
    if (calls) calls.push(prompt);
    return JSON.stringify(typeof payload === 'function' ? payload(prompt) : payload);
};
const worldOf = (setting, { positions = ['未明'], entities = [] } = {}) => ({
    context: { tension: 0.5, positions, setting },
    entities: [...entities],
    weights: {},
});
async function runSmall({ text, blocks, payload, onEvidence = null, expectOk = true }) {
    const calls = [];
    const r = await extractWorldSetting({
        sourceText: text, extract: fixed(payload, calls), allowedSources: blocks, onEvidence,
    });
    assert.equal(r.ok, expectOk, `抽取结果：${(r.errors || []).join('；')}`);
    return { r, calls };
}
/** 从提示词里取出**本次真正交出去的书文**（提示词正文段的结尾就是它）。 */
const chunkOf = (prompt) => {
    const i = prompt.indexOf('———— 设定原文如下 ————');
    return i < 0 ? prompt : prompt.slice(i);
};

// ============================ ③ 证据作用域：同一句话在多个条目里 ============================
test('复查③：所引来源必须真的在**本次展示的那一块**里——同句在别的条目里出现不算', () => {
    const shared = '陆青行走江湖。';
    const frozen = freezeAllowedSources([
        { sourceId: 'entry-a', title: '人物甲', text: `【人物甲】\n${shared}\n这是第一条独有的正文。` },
        { sourceId: 'entry-b', title: '人物乙', text: `【人物乙】\n${shared}\n这是第二条独有的正文。` },
    ]);
    // 孩子只见到了 entry-a（spanText = 它的正文）⇒ 引 entry-b 必须拒收（旧法：全局表里能找到 S2 就放行）
    const unseen = verifyQuote(frozen, { ev: { s: 'S2', q: shared }, spanText: frozen.list[0].text, cls: 'kind', subject: '陆青' });
    assert.equal(unseen.ok, false, '同一句话在看不见的条目里出现，不构成"本次材料里的出处"');
    assert.match(String(unseen.why), /不在本次展示/);
    // 正向：引自己见到的那个来源要放行
    const seen = verifyQuote(frozen, { ev: { s: 'S1', q: shared }, spanText: frozen.list[0].text, cls: 'kind', subject: '陆青' });
    assert.equal(seen.ok, true, `见到的那一条必须放行：${seen.why}`);
});

test('复查③/④：分块与拆半的真实流程不得借未见来源；清单只列本次展示的来源且不截断', async () => {
    const A_MARK = '甲角独有记号『甲独』';
    const B_MARK = '乙角独有记号『乙独』';
    const filler = (mark, n) => Array.from({ length: n }, (_, i) => `${mark}的填充行${i}：此段只为把书撑过分块下限。`).join('\n');
    const A_TEXT = `【人物甲】\n${A_MARK}\n${filler('甲线', 700)}`;
    const B_TEXT = `【人物乙】\n${filler('乙线', 700)}\n${B_MARK}`;
    const text = `${A_TEXT}\n${B_TEXT}`;
    assert.ok(Array.from(text).length > 30000, '这一组要真的进大书分块路径');
    const blocks = [
        { sourceId: 'src-a', title: '人物甲', text: A_TEXT },
        { sourceId: 'src-b', title: '人物乙', text: B_TEXT },
    ];
    const prompts = [];
    const extract = async (prompt) => {
        prompts.push(prompt);
        if (!prompt.includes('"bookEntities"')) return JSON.stringify({ entities: [] });   // 属性遍：不参与本组
        const chunk = chunkOf(prompt);
        if (chunk.includes('甲线') && chunk.length > 20000) return '这不是 JSON';             // 逼出对半拆
        return JSON.stringify({
            bookEntities: [
                { name: '甲角', kind: 'character', ev: { s: 'src-a', q: A_MARK } },
                { name: '乙角', kind: 'character', ev: { s: 'src-b', q: B_MARK } },
            ],
        });
    };
    const records = [];
    const r = await extractWorldSetting({
        sourceText: text, extract, allowedSources: blocks, onEvidence: (x) => records.push(x),
    });
    assert.equal(r.ok, true, (r.errors || []).join('；'));
    const canon = r.setting.frozen.canon;
    // 正向：两个名号各自在**真的有它**的那一块里被确认（跨块合并后都在册）
    assert.equal(canon.bookEntities.find((b) => b.name === '甲角')?.kind, 'character');
    assert.equal(canon.bookEntities.find((b) => b.name === '乙角')?.kind, 'character');
    // 负向：每个"借了没见过的来源"的块都留了拒收原因（旧法这些块全部静默放行）
    const borrowed = records.filter((x) => x.class === 'kind' && x.action === 'drop' && /不在本次展示/.test(String(x.why)));
    assert.ok(borrowed.length >= 2, `每个未见来源的块都要留原因：${JSON.stringify(records.filter((x) => x.action === 'drop'))}`);
    // 来源清单按**本次这一块**列（S1/S2 是全局稳定编号，不许重排）
    const rosterPrompts = prompts.filter((p) => p.includes('"bookEntities"'));
    const chunkB = rosterPrompts.find((p) => chunkOf(p).includes('乙线') && !chunkOf(p).includes('甲线'));
    assert.ok(chunkB, '必须有一个只含 B 的块');
    assert.match(chunkB, /S2 = 人物乙/);
    assert.equal(/S1 = 人物甲/.test(chunkB), false, '本次没展示的来源不许出现在清单里');
    // 拆半后的子块同样只列自己那一半的来源（全局编号不变）
    const halfWithA = rosterPrompts.find((p) => chunkOf(p).includes('甲线') && chunkOf(p).length < 20000);
    assert.ok(halfWithA, '必须有一个只含 A 一半的子块（对半拆真的跑了）');
    assert.match(halfWithA, /S1 = 人物甲/);
});

test('复查④：来源清单不设 400 上限——第 513 条已接受来源也必须列出且可引', async () => {
    const blocks = Array.from({ length: 513 }, (_, i) => ({
        sourceId: `e${i + 1}`, title: `条目${i + 1}`, text: `条目${i + 1}正文。`,
    }));
    const text = blocks.map((b) => b.text).join('\n');
    const frozen = freezeAllowedSources(blocks);
    const dict = evidenceDictionary(frozen);
    assert.match(dict, /S513 = 条目513/, '第 513 条必须列在清单里（旧法在 400 处截断并禁止引用）');
    assert.equal(/不得引用|未列出/.test(dict), false, '不许再出现"未列出、不得引用"那条截断说明');
    const calls = [];
    const r = await extractWorldSetting({
        sourceText: text, extract: fixed({ bookEntities: [] }, calls), allowedSources: blocks,
    });
    assert.equal(r.ok, true);
    assert.match(calls[0], /S513 = 条目513/, '生产提示词里也要列全（不是只有 helper 列全）');
    const last = blocks[512].text;
    assert.equal(verifyQuote(frozen, { ev: { s: 'S513', q: last }, spanText: text }).ok, true, '第 513 条必须可引');
});

// ============================ ① 设定面：每一类都要出处 ======================================
const SET_TEXT = '【世界】天地灵气稀薄，常人难入修行。凡俗国度林立。';
const SET_BLOCKS = blocksOf([['w1', SET_TEXT]]);

test('复查①：设定事实没有来源编号/原话 ⇒ 一律不收（旧法：文本在材料里就收）', async () => {
    const { r } = await runSmall({
        expectOk: false,
        text: SET_TEXT, blocks: SET_BLOCKS,
        payload: {
            society: '天地灵气稀薄，常人难入修行。',
            techOrMagic: '天地灵气稀薄，常人难入修行。',
            historyNotes: ['天地灵气稀薄，常人难入修行。'],
            situation: '天地灵气稀薄，常人难入修行。',
            rules: ['天地灵气稀薄，常人难入修行。'],
            tension: { polarity: '灵气', direction: '稀薄' },
        },
    });
    assert.equal(r.setting, undefined, '全部设定无出处，不许按成功替换');
    assert.equal(r.settingReport.kept.total, 0);
    assert.equal(r.evidence.summary.dropped, 7, '七条无依据主张逐项拒收');
});

test('复查①：所引原话必须真的包含该项原话（同一块里的另一句不算出处）', async () => {
    const { r } = await runSmall({
        text: SET_TEXT, blocks: SET_BLOCKS,
        payload: {
            ev: { s: 'w1', q: '天地灵气稀薄，常人难入修行。' },
            society: '凡俗国度林立。',                                     // 真在材料里、但不在所引原话里
            techOrMagic: '天地灵气稀薄，常人难入修行。',                     // 共用这一条 ev ⇒ 收
            rules: [{ 文: '凡俗国度林立。' }, { 文: '天地灵气稀薄' }],
        },
    });
    const canon = r.setting.frozen.canon;
    assert.equal(canon.society, '', '设定原话不在所引出处 ⇒ 不收');
    assert.equal(canon.techOrMagic, '天地灵气稀薄，常人难入修行。');
    assert.deepEqual(canon.rules, ['天地灵气稀薄'], '散在多处的法则各自给出处，共句的共用顶层 ev');
});

test('复查①/②：环境档位校验枚举格式 + 真出处，不要求枚举词出现在中文里', async () => {
    const { r } = await runSmall({
        text: SET_TEXT, blocks: SET_BLOCKS,
        payload: { ev: { s: 'w1', q: '凡俗国度林立。' }, env: { 民生度: '艰难', 动乱度: '动荡' } },
    });
    // 枚举词"艰难/动荡"在中文原文里一个字都没有——模型分类仍要收下（模型/簿记分工）
    const env = r.setting.dynamic.env;
    assert.equal(env['民生度'], '艰难', `合法枚举 + 真出处必须收下：${JSON.stringify(env)}`);
    assert.equal(env['动乱度'], '动荡');
    const bad = await runSmall({
        expectOk: false,
        text: SET_TEXT, blocks: SET_BLOCKS,
        payload: { ev: { s: 'w1', q: '凡俗国度林立。' }, env: { 民生度: '很惨' } },
    });
    assert.equal(bad.r.setting, undefined, '非法枚举必须拒收，不产生空的成功结果');
    const noEv = await runSmall({
        expectOk: false,
        text: SET_TEXT, blocks: SET_BLOCKS, payload: { env: { 民生度: '艰难' } },
    });
    assert.equal(noEv.r.setting, undefined, '没有出处的环境档位不许收');
});

test('复查①：概念表档位与旧两列都要过"所引原话"闸，note 不再是免检格', async () => {
    const text = '【战力】T1 感气境：初入门径。T2 筑基境：气贯全身。';
    const blocks = blocksOf([['w1', text]]);
    const good = await runSmall({
        text, blocks,
        payload: {
            ev: { s: 'w1', q: 'T1 感气境：初入门径。T2 筑基境：气贯全身。' },
            刻度: [{ 名: '战力', 档位: ['T1|感气境', 'T2|筑基境'] }],
        },
    });
    assert.equal(good.r.setting.frozen.canon.刻度?.length, 1, `有出处的概念表要收：${JSON.stringify(good.r.errors)}`);
    const bad = await runSmall({
        text, blocks,
        payload: {
            ev: { s: 'w1', q: 'T1 感气境：初入门径。' },
            刻度: [{ 名: '战力', 档位: ['T1|感气境', 'T9|编造境'] }],
        },
    });
    const tiers = (bad.r.setting.frozen.canon.刻度?.[0]?.档位 || []).map((t) => t.档);
    assert.deepEqual(tiers, ['T1'], '档位不在所引原话里 ⇒ 丢（旧法只在整块材料里找）');
    const noEv = await runSmall({ text, blocks, expectOk: false, payload: { 刻度: [{ 名: '战力', 档位: ['T1|感气境'] }] } });
    assert.equal(noEv.r.settingReport.kept.刻度, 0, '概念表没有出处 ⇒ 整张不收');
    // 旧两列：note 现在也要在所引原话里
    const legacyCols = await runSmall({
        text, blocks,
        payload: {
            ev: { s: 'w1', q: 'T1 感气境：初入门径。' },
            powerScale: [{ level: 'T1', note: '初入门径。' }, { level: 'T2', note: '气贯全身。' }],
            dims: [{ name: '战力', range: 'T1~T2' }],
        },
    });
    const ps = legacyCols.r.setting.frozen.canon.powerScale;
    assert.deepEqual(ps.map((x) => x.level), ['T1'], 'note 不在所引原话里的档位项一起丢');
    assert.deepEqual(legacyCols.r.setting.frozen.canon.dims, [], '维度不在所引原话里 ⇒ 丢');
});

// ============================ ③ 逐字段/别名/归属：各自的出处 ================================
test('描述属性保留模型抽取值，不再按所引句子逐字丢弃', async () => {
    const text = '【甲】甲是旅人。乙是城主，效忠青云门。';
    const blocks = blocksOf([['w1', text]]);
    const piggy = await runSmall({
        text, blocks,
        payload: {
            bookEntities: [{
                name: '甲', kind: 'character',
                fields: { 身份: '城主', 所属: '青云门' },
                ev: { s: 'w1', q: '甲是旅人。' },
            }],
        },
    });
    const jia = piggy.r.setting.frozen.canon.bookEntities.find((b) => b.name === '甲');
    assert.equal(jia.kind, 'character');
    assert.deepEqual(jia.fields, { 身份: '城主', 所属: '青云门' }, '属性值不匹配身份引用仍保留');
    // 正向：自包含的一句原话可以同时支持该实体的多个属性
    const solid = await runSmall({
        text, blocks,
        payload: {
            bookEntities: [{
                name: '乙', kind: 'character',
                fields: { 身份: '城主', 所属: '青云门' },
                ev: { s: 'w1', q: '乙是城主，效忠青云门。' },
            }],
        },
    });
    const yi = solid.r.setting.frozen.canon.bookEntities.find((b) => b.name === '乙');
    assert.deepEqual(yi.fields, { 身份: '城主', 所属: '青云门' }, '一句自包含的原话可以支持多个事实');
    // 属性遍（entities）同尺
    const attrs = await runSmall({
        text, blocks,
        payload: { entities: [{ name: '甲', kind: 'character', fields: { 身份: '城主' }, ev: { s: 'w1', q: '甲是旅人。' } }] },
    });
    const attrsJia = attrs.r.setting.frozen.canon.settings.find((b) => b.name === '甲');
    assert.equal(attrsJia.fields.身份, '城主', '属性遍同样保留');
});

test('复查③：别名与归属也要在自己引的那句原话里（不能只出现在整块材料里）', async () => {
    const text = '【陆青】陆青独自行走江湖。夜行者是柳白的别名。';
    const blocks = blocksOf([['w1', text]]);
    const { r } = await runSmall({
        text, blocks,
        payload: {
            bookEntities: [
                { name: '陆青', kind: 'character', aliases: ['夜行者'], parent: '柳白', ev: { s: 'w1', q: '陆青独自行走江湖。' } },
            ],
        },
    });
    const lu = r.setting.frozen.canon.bookEntities.find((b) => b.name === '陆青');
    assert.equal(lu.aliases, undefined, '别名叫法不在所引原话里 ⇒ 不许注入');
    assert.equal(lu.parent, undefined, '归属名不在所引原话里 ⇒ 不许注入');
});

// ============================ ④ 同响应重复：先核验，再冲突感知合并 ==========================
test('复查④：同名重复先逐条核验——未核实别名不许注入，冲突类别留诊断且不先到先得', async () => {
    const text = '【陆青】陆青独自行走江湖。柳白实力是T9。夜行者是柳白的别名。青衣也指一个组织。';
    const blocks = blocksOf([['w1', text]]);
    const { r } = await runSmall({
        text, blocks,
        payload: {
            bookEntities: [
                { name: '陆青', kind: 'character', ev: { s: 'w1', q: '陆青独自行走江湖。' } },
                { name: '陆青', kind: 'character', aliases: ['夜行者'] },                       // 第二条没有出处
                { name: '青衣', kind: 'character', ev: { s: 'w1', q: '陆青独自行走江湖。' } },
                { name: '青衣', kind: 'faction', ev: { s: 'w1', q: '青衣也指一个组织。' } },     // 同名两类
            ],
        },
    });
    const canon = r.setting.frozen.canon;
    const lu = canon.bookEntities.find((b) => b.name === '陆青');
    assert.equal(lu.aliases, undefined, '未核实的别名不许借同名合并混进来');
    assert.equal(lu.kind, 'character', '已核实的类别保留');
    const qing = canon.bookEntities.find((b) => b.name === '青衣');
    assert.equal(qing.kind, undefined, '两条都核过但类别冲突 ⇒ 不选先到的，留作待核对候选');
    assert.ok(/冲突/.test(r.errors.join('|')), `冲突必须留痕：${r.errors.join('|')}`);
    // 正向：第二条的别名自己有出处 ⇒ 合并（共享引用/单独引用都允许）
    const merged = await runSmall({
        text, blocks,
        payload: {
            bookEntities: [
                { name: '柳白', kind: 'character', ev: { s: 'w1', q: '柳白实力是T9。' } },
                { name: '柳白', kind: 'character', aliases: ['夜行者'], aliasEv: { s: 'w1', q: '夜行者是柳白的别名。' } },
            ],
        },
    });
    const liu = merged.r.setting.frozen.canon.bookEntities.find((b) => b.name === '柳白');
    assert.deepEqual(liu.aliases, ['夜行者'], '有出处的别名照旧并入');
});

test('复查④：同一身份两个上级 ⇒ 不选先到的那个，冲突留诊断', () => {
    const conflicts = [];
    const out = dedupeRoster([
        { name: '白小娥', kind: 'character', parent: '甲门', aliases: ['小娥'] },
        { name: '小娥', kind: 'character', parent: '乙门' },
    ], { conflicts });
    assert.equal(out.length, 1, '同一身份（别名=正名）仍要归一');
    assert.equal(out[0].parent, undefined, '明确矛盾的归属不许静默选先到的值');
    assert.ok(conflicts.some((c) => c.field === 'parent' && (c.values || []).includes('甲门') && (c.values || []).includes('乙门')),
        `归属冲突要留两个值：${JSON.stringify(conflicts)}`);
});

// ============================ ⑤ 去重：共享别名不得拉外人 ====================================
test('复查⑤：共享泛称别名不得把外人的字段/上级/类别拉进来', () => {
    const out = dedupeRoster([
        { name: '甲', kind: 'character', aliases: ['大人'], parent: '甲门', fields: { 身份: '旅人' } },
        { name: '乙', kind: 'character', aliases: ['大人'], parent: '乙门', fields: { 实力: '绝顶' } },
    ]);
    assert.equal(out.length, 2, '共享泛称不是同一实体的证据');
    const jia = out.find((x) => x.name === '甲');
    const yi = out.find((x) => x.name === '乙');
    assert.ok(jia && yi, `正名必须来自各组自己的正名：${JSON.stringify(out)}`);
    assert.equal(jia.parent, '甲门');
    assert.equal(yi.parent, '乙门', '外人的上级不许被拉进来');
    assert.deepEqual(jia.fields, { 身份: '旅人' });
    assert.deepEqual(yi.fields, { 实力: '绝顶' }, '外人的字段不许被拉进来');
    assert.deepEqual(jia.aliases, ['大人']);
    assert.deepEqual(yi.aliases, ['大人']);
});

test('复查⑤：跨类别别名对不合并，双方类别都保留', () => {
    const conflicts = [];
    const out = dedupeRoster([
        { name: '甲', kind: 'character', aliases: ['乙'] },
        { name: '乙', kind: 'location' },
    ], { conflicts });
    assert.equal(out.length, 2, '不同类别的同名项不许并成一个实体');
    assert.equal(out.find((x) => x.name === '甲')?.kind, 'character', '并查集拒绝之后，后续吸收不许再摘类别');
    assert.equal(out.find((x) => x.name === '乙')?.kind, 'location');
    assert.ok(conflicts.some((c) => c.field === 'kind'), `冲突要留诊断：${JSON.stringify(conflicts)}`);
});

test('复查⑤：共享别名与冲突类别走完整抽取→名册→实体账，不只是 helper', async () => {
    const text = '【甲】甲是旅人，属于甲门。乙是绝顶高手，属于乙门。两人都被称作大人。';
    const blocks = blocksOf([['w1', text]]);
    const { r } = await runSmall({
        text, blocks,
        payload: {
            bookEntities: [
                { name: '甲', kind: 'character', aliases: ['大人'], parent: '甲门', ev: { s: 'w1', q: text } },
                { name: '乙', kind: 'character', aliases: ['大人'], parent: '乙门', ev: { s: 'w1', q: text } },
            ],
        },
    });
    const canon = r.setting.frozen.canon;
    assert.equal(canon.bookEntities.length, 2, `共享别名不许并成一条：${JSON.stringify(canon.bookEntities)}`);
    const world = worldOf(r.setting, { positions: ['未明'] });
    seedBookEntities(world);
    const seedA = world.entities.find((e) => e.name === '甲');
    const seedB = world.entities.find((e) => e.name === '乙');
    assert.ok(seedA && seedB, `两个人都要入账：${JSON.stringify(world.entities)}`);
    assert.deepEqual(seedA.aliases, ['大人']);
    assert.deepEqual(seedB.aliases, ['大人']);
});

test('复查③：保底重试（单行大块）仍只认本次展示的那一块来源', async () => {
    const QUOTE = '陆青行走江湖。';
    // 超长单行自成一块（`chunkRows` 的口径）⇒ 拆不动 ⇒ 走"保底重试一次"那条路。
    const line = `【人物甲】${QUOTE}${'填充'.repeat(16000)}`;
    const text = line;
    assert.ok(Array.from(text).length > 30000, '这一组要真的进大书分块路径');
    const blocks = [{ sourceId: 'src-a', title: '甲条', text }];
    const seen = new Map();
    const extract = async (prompt) => {
        if (!prompt.includes('"bookEntities"')) return JSON.stringify({ entities: [] });
        const n = (seen.get(prompt) || 0) + 1;
        seen.set(prompt, n);
        if (n === 1) return '这不是 JSON';                       // 第一次失败 ⇒ 保底重试
        return JSON.stringify({ bookEntities: [{ name: '陆青', kind: 'character', ev: { s: 'src-a', q: QUOTE } }] });
    };
    const r = await extractWorldSetting({ sourceText: text, extract, allowedSources: blocks });
    assert.equal(r.ok, true, (r.errors || []).join('；'));
    assert.equal(r.setting.frozen.canon.bookEntities.find((b) => b.name === '陆青')?.kind, 'character',
        '重试那一次仍要按本次展示的来源核过（作用域随调用走）');
    const retryPrompt = [...seen.keys()].find((p) => p.includes('"bookEntities"') && seen.get(p) > 1);
    assert.ok(retryPrompt, '保底重试真的跑过');
    assert.match(retryPrompt, /S1 = 甲条/);
});

// ============================ ⑥⑦⑧ 真实消费者：标签 / 搜索 / 归属 / 关系端点 ================
test('复查④/⑤：大书跨块同名冲突走完整抽取→合并→实体账（不选先到者、候选可见）', async () => {
    const A_QUOTE = '甲角属于甲门。';
    const B_QUOTE = '甲角是势力，属于乙门。';
    const filler = (mark, n) => Array.from({ length: n }, (_, i) => `${mark}填充${i}：把书撑过大书分块下限。`).join('\n');
    const A_TEXT = `【甲】${A_QUOTE}\n${filler('甲块线', 800)}`;
    const B_TEXT = `【甲】${filler('乙块线', 800)}\n${B_QUOTE}`;
    const text = `${A_TEXT}\n${B_TEXT}`;
    assert.ok(Array.from(text).length > 30000, '这一组要真的进大书分块路径');
    const blocks = [
        { sourceId: 'src-a', title: '甲条', text: A_TEXT },
        { sourceId: 'src-b', title: '乙条', text: B_TEXT },
    ];
    const extract = async (prompt) => {
        if (!prompt.includes('"bookEntities"')) return JSON.stringify({ entities: [] });   // 属性遍：不参与本组
        const chunk = chunkOf(prompt);
        if (chunk.includes('乙块线') && !chunk.includes('甲块线')) {
            return JSON.stringify({ bookEntities: [{ name: '甲角', kind: 'faction', parent: '乙门', ev: { s: 'src-b', q: B_QUOTE } }] });
        }
        return JSON.stringify({ bookEntities: [{ name: '甲角', kind: 'character', parent: '甲门', ev: { s: 'src-a', q: A_QUOTE } }] });
    };
    const records = [];
    const r = await extractWorldSetting({ sourceText: text, extract, allowedSources: blocks, onEvidence: (x) => records.push(x) });
    assert.equal(r.ok, true, (r.errors || []).join('；'));
    const canon = r.setting.frozen.canon;
    const jia = canon.bookEntities.find((b) => b.name === '甲角');
    assert.ok(jia, '名号要在册（待核对候选不许消失）');
    assert.equal(jia.kind, undefined, '跨块类别冲突 ⇒ 不选先到者（摘掉类别）');
    assert.equal(jia.parent, undefined, '跨块归属冲突 ⇒ 不选先到者（归属留空）');
    assert.ok(records.some((x) => /冲突/.test(String(x.why))), `冲突要留诊断：${JSON.stringify(records)}`);
    assert.ok(/冲突/.test(r.errors.join('|')), `冲突要留痕：${r.errors.join('|')}`);
    const world = worldOf(r.setting, { positions: ['未明'] });
    const seed = seedBookEntities(world);
    assert.equal(seed.pendingKind, 1, '类别未确认的候选必须可观察（不默认角色/势力）');
    assert.equal(world.entities.length, 0, '未确认类别不入账');
});
test('复查⑥：实际标签路由用共用身份解析——共享别名不许先到先得', () => {
    const shared = extractTags('【行动】大人｜修炼', {
        entities: [
            { id: 'a', name: '甲', kind: 'character', aliases: ['大人'] },
            { id: 'b', name: '乙', kind: 'character', aliases: ['大人'] },
        ],
    });
    assert.equal(shared.count, 0, `共享别名指向两个实体 ⇒ 不许归给先到的那个：${JSON.stringify(shared.actions)}`);
    assert.ok(shared.unresolved.some((u) => u.name === '大人'), '归不上要如实报数');
    // 正向：唯一命中照旧解析（含只住在账上的别名）
    const unique = extractTags('【行动】大人｜修炼', {
        entities: [{ id: 'a', name: '甲', kind: 'character', aliases: ['大人'] }],
    });
    assert.equal(unique.actions[0]?.actorId, 'a');
    // 旧世界兼容：账上实体没有 aliases，别名只在书名录里
    const legacy = extractTags('【行动】水手月亮｜变身', {
        entities: [{ id: 'a', name: '月野兔' }],
        canon: [{ name: '月野兔', aliases: ['水手月亮'] }],
    });
    assert.equal(legacy.actions[0]?.actorId, 'a', '旧账只有名册别名时仍要认得出');
    // 正名优先于别名（leg89 口径不变）：别名与别人的正名撞车时，正名那个人胜
    const primary = extractTags('【行动】小娥｜回话', {
        entities: [{ id: 'a', name: '小娥' }, { id: 'b', name: '白小娥', aliases: ['小娥'] }],
    });
    assert.equal(primary.actions[0]?.actorId, 'a', '书里正名优先于他人的别名');
});

test('复查⑦：实际实体搜索面必须含已确认别名，并走真实分页筛选', () => {
    assert.match(entsSearchTextOf({ name: '甲', aliases: ['水手月亮'] }), /水手月亮/);
    const world = {
        entities: [
            { id: 'e1', kind: 'character', name: '甲', aliases: ['水手月亮'], location: '未明' },
            { id: 'e2', kind: 'character', name: '乙', location: '未明' },
        ],
        agendas: [], weights: {},
    };
    const page = selectEntityPage(world, { q: '水手月亮' });
    assert.deepEqual(page.rows.map((e) => e.id), ['e1'], '按别名搜索要能查到人（不是只有 searchText 拼接）');
});

test('复查⑧：已确认别名要能解析归属链与关系端点（canon 父级 + 别名端点）', async () => {
    const text = '【主角】主角效忠海盟。海盟别称蓝潮会。';
    const blocks = blocksOf([['w1', text]]);
    const { r } = await runSmall({
        text, blocks,
        payload: {
            bookEntities: [
                { name: '主角', kind: 'character', parent: '蓝潮会', ev: { s: 'w1', q: '主角效忠海盟。海盟别称蓝潮会。' } },
                { name: '海盟', kind: 'faction', aliases: ['蓝潮会'], ev: { s: 'w1', q: '海盟别称蓝潮会。' } },
            ],
            relations: [
                { from: '主角', to: '蓝潮会', type: '效忠', ev: { s: 'w1', q: '主角效忠海盟。' } },
            ],
        },
    });
    const canon = r.setting.frozen.canon;
    const world = worldOf(r.setting, { positions: ['未明'] });
    const seed = seedBookEntities(world);
    const zhu = world.entities.find((e) => e.name === '主角');
    assert.equal(zhu.parent, '海盟', `归属名走别名时要归到正名：${JSON.stringify(seed.warnings)}`);
    assert.equal(resolveEntityName(world.entities, '蓝潮会')?.name, '海盟');
    assert.equal(canon.relations?.length ?? 0, 1, `别名端点的边要收下：${JSON.stringify(canon.relations)}`);
    const rel = seedBookRelations(world);
    assert.equal(rel.seeded, 1, `别名端点的边要落账：${rel.dropped.join('|')}`);
});

test('复查⑪：关系出处只有一种形状 ev:{s,q}，旧口径显式兼容；legacy 固定响应不受影响', async () => {
    const text = '【月野兔】月野兔（水手月亮），所属势力：科学团。她是科学团的成员。';
    const blocks = blocksOf([['w2', text]]);
    const base = {
        bookEntities: [
            { name: '月野兔', kind: 'character', ev: { s: 'w2', q: '月野兔（水手月亮），所属势力：科学团。她是科学团的成员。' } },
            { name: '科学团', kind: 'faction', ev: { s: 'w2', q: '月野兔（水手月亮），所属势力：科学团。她是科学团的成员。' } },
        ],
    };
    // ① 规范形状 ev:{s,q}（提示词里写的就是它）——旧法只认顶层 s+quote ⇒ 这条被丢
    const canonical = await runSmall({
        text, blocks,
        payload: { ...base, relations: [{ from: '月野兔', to: '科学团', type: '成员', ev: { s: 'w2', q: '她是科学团的成员。' } }] },
    });
    assert.equal(canonical.r.setting.frozen.canon.relations?.length, 1, '规范 ev 形状必须被收下');
    // ② 旧口径 s+quote 显式兼容（旧固定响应不许被打死）
    const legacyShape = await runSmall({
        text, blocks,
        payload: { ...base, relations: [{ from: '月野兔', to: '科学团', type: '成员', s: 'w2', quote: '她是科学团的成员。' }] },
    });
    assert.equal(legacyShape.r.setting.frozen.canon.relations?.length, 1, '旧 s+quote 口径要显式兼容');
    // ③ 两种形状都不给 ⇒ 拒收并留原因
    const noEv = await runSmall({
        text, blocks,
        payload: { ...base, relations: [{ from: '月野兔', to: '科学团', type: '成员', quote: '她是科学团的成员。' }] },
    });
    assert.equal(noEv.r.setting.frozen.canon.relations, undefined, '没有来源编号的边不许收');
    // ④ legacy 调用（无允许来源）逐字不变：固定响应仍按书文核原话
    const legacyRun = await extractWorldSetting({
        sourceText: text,
        extract: fixed({ ...base, relations: [{ from: '月野兔', to: '科学团', type: '成员', quote: '她是科学团的成员。' }] }),
    });
    assert.equal(legacyRun.ok, true);
    assert.equal(legacyRun.setting.frozen.canon.relations?.length, 1, 'legacy 固定响应契约不许被打死');
});

// ============================ ② strict 不许自动变 legacy ===================================
test('复查②：显式要求 strict 而没有允许来源 ⇒ 拒绝按未核实入账（不许自动回落）', async () => {
    const r = await extractWorldSetting({
        sourceText: '【甲】甲正文。',
        extract: fixed({ bookEntities: [{ name: '甲', kind: 'character' }] }),
        evidencePolicy: 'strict',
    });
    assert.equal(r.ok, false, 'strict 缺材料时必须明确拒绝，而不是静默按 legacy 收下');
    assert.match(r.errors.join('|'), /strict|严格/);
});
