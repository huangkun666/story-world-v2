// story-world-v2/test/abstract-fields.test.js
// ★★leg61（用户令「我就是想抽象出势力和角色，还有对应的所有属性，就这么简单」／
//        「我要的是模拟的必要属性，实力，归属等等，但是现在就是有很多抽不出来」）：
//   把"属性抽取"这一环的**四条新锁**落成判据：
//     ① **键开放**：表外属性也收（旧法只有七个键的白名单，模型交的"境界/体质/兵力/领地"全丢）
//     ② **值过出处闸**：表外键的值必须能在本段原文里逐字找到，找不到即丢**并留痕**（不是静默丢）
//     ③ **`所属` 落账**：真账实测三本账（233/482/141 条）里它曾**一条都没落地**
//     ④ **两遍抽取**：名册遍交名号 · 属性遍交属性 ⇒ 两遍的产出**并入名册且不新造实体**
//   为什么这四条必须有锁：这一环的病全是"看起来没问题"型的——
//   旧口径下 `sanitizeBookFields` 静默丢键、`pushEntity` 静默不抄 `所属`，两边判据都是绿的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import {
    sanitizeCanon,
    sanitizeBookFields,
    fieldEvidenceOf,
    seedBookEntities,
    buildSettingPrompt,
    buildAttrsOnlyPrompt,
    extractWorldSetting,
    assembleSetting,
    linkContainedFactions,
    BOOK_FIELD_KEYS,
    BOOK_FIELD_MAX_OPEN,
} from '../src/abstract.js';

// —— ① 出处闸（纯函数）——
test('★leg61 出处闸：整串命中 / 维度+数值命中 / 都对不上 ⇒ inferred', () => {
    const src = '吕布（勇武100 / 统御75）· 身份：骑都尉 · 吕布军：约1-2万人（含刘琦部）';
    assert.equal(fieldEvidenceOf('骑都尉', src), 'verbatim', '整串在原文里');
    assert.equal(fieldEvidenceOf('勇武100 / 统御75', src), 'verbatim', '维度+数值组：分段命中即可');
    assert.equal(fieldEvidenceOf('勇武99', src), 'inferred', '★书里写的是 100：数字对不上就不认（不许"差不多"）');
    assert.equal(fieldEvidenceOf('天下第一', src), 'inferred', '原文没有这句话');
    assert.equal(fieldEvidenceOf('骑都尉', ''), 'inferred', '★没给原文 ⇒ 一律按推断（不许默默当原文）');
});

test('★leg61 属性净化：常用键照旧 · 表外键"值有出处才收" · 值对不上就丢且如实报', () => {
    const src = '曹操（兖州牧，治中军）· 体质：先天道体 · 领地：兖州';
    // 常用键：走旧上限，不需要出处（既有账面形态不动）
    const a = sanitizeBookFields({ 身份: '兖州牧', 实力: 'T8破妄' }, 'character', { sourceText: src });
    assert.equal(a.fields['身份'], '兖州牧');
    assert.equal(a.fields['实力'], 'T8破妄', '常用键的旧口径不变（不走出处闸）');
    // 表外键：值在原文里 ⇒ 收；不在 ⇒ 丢 + 进 inferred
    const b = sanitizeBookFields({ 体质: '先天道体', 称号: '乱世之奸雄', 领地: '兖州' }, 'character', { sourceText: src });
    assert.equal(b.fields['体质'], '先天道体', '★键开放：表外键收下来了（旧法这里一律丢）');
    assert.equal(b.fields['领地'], '兖州', '表外键同样过出处闸');
    assert.equal(b.fields['称号'], undefined, '值对不上原文 ⇒ 不收');
    assert.deepEqual(b.inferred, ['称号'], '★丢的键要如实报（静默丢就是这轮要治的病）');
    assert.deepEqual(b.unknown.sort(), ['体质', '领地'], '收下的表外键也记账（面板/诊断可追）');
    // 键名形态闸：占位符/整句话不许当键
    const c = sanitizeBookFields({ '<user>': '兖州牧', '这是一个很长的键名不合法': '兖州牧' }, 'character', { sourceText: src });
    assert.equal(c.fields, null, '★占位符与超长键名不是"属性名"（与 §D 的 <user> 同族）');
    // 上限：表外键比常用键宽松，但仍不许写成散文
    const long = '甲'.repeat(BOOK_FIELD_MAX_OPEN + 20);
    const d = sanitizeBookFields({ 长属性: long }, 'character', { sourceText: long });
    assert.equal(d.fields['长属性'].length, BOOK_FIELD_MAX_OPEN, `表外键上限 ${BOOK_FIELD_MAX_OPEN} 字（截断而非丢弃）`);
});

test('★leg61 净化层：`entities`（属性遍）并入 canon.settings，没属性的条目不收', () => {
    const src = '关羽（勇武99 / 统御95）· 曹操（兖州牧）';
    const r = sanitizeCanon({
        entities: [
            { name: '关羽', kind: 'character', fields: { 实力: '勇武99 / 统御95' } },
            { name: '曹操', kind: 'character', fields: {} },                       // 没属性 ⇒ 不收（那一遍不是名册）
            { name: '吕布', kind: 'character', fields: { 武力值: '勇武100' } },    // 值不在本段 ⇒ 丢并留痕
        ],
    }, { sourceText: src });
    assert.equal(r.ok, true);
    assert.deepEqual(r.canon.settings.map((s) => s.name), ['关羽']);
    assert.equal(r.canon.settings[0].fields['实力'], '勇武99 / 统御95');
    assert.ok(r.errors.some((e) => e.includes('吕布') && e.includes('原文里找不到')), '★丢的属性留痕（可追是哪条、哪个键）');
});

// —— ② `所属` 落账（这一条是"抽出来了却一个都不落地"的锁）——
test('★★leg61 `所属` 落账：名册里的归属必须写进实体（旧法三本账 856 条全丢）', () => {
    const book = [
        { name: '刘备军', kind: 'faction' },                       // 归属目标必须**是势力条目**，parent 那条路才认（既有口径）
        { name: '关羽', kind: 'character', fields: { 所属: '刘备军', 身份: '汉寿亭侯', 实力: '勇武99 / 统御95', 表外属性: '某职' } },
        { name: '曹魏军', kind: 'faction', parent: '曹魏', fields: { 规模: '约5-6万人' } },
        { name: '曹魏', kind: 'faction' },
    ];
    const w = {
        context: { tension: 0.5, positions: ['未明'], setting: { frozen: { canon: { bookEntities: book } } } },
        entities: [], weights: {},
    };
    const r = seedBookEntities(w);
    assert.ok(r.seeded >= 2);
    const gy = w.entities.find((e) => e.name === '关羽');
    assert.equal(gy['所属'], '刘备军', '★★书里的归属原话落账（此前这里恒为 undefined）');
    assert.equal(gy['身份'], '汉寿亭侯');
    assert.equal(gy['实力'], '勇武99 / 统御95');
    assert.equal(gy['表外属性'], '某职', '★键开放：表外属性一并落账');
    assert.equal(gy.parent, '刘备军', '既有口径不变：parent 仍由 `所属` 推出（两格分工见 schema 注释）');
    assert.equal(gy.fieldSource['所属'], '书里原话', '来源逐字段留痕');
    // ★两格分工的**对照面**（这条锁的正是"混为一谈"）：目标不是势力条目时——
    //   `所属` 照抄原文（作者的写法就是事实），`parent` 不写（那是引擎梳理出的归属，宁缺勿造）。
    const book2 = [{ name: '貂蝉', kind: 'character', fields: { 所属: '司徒王允府' } }];
    const w2 = { context: { tension: 0.5, positions: ['未明'], setting: { frozen: { canon: { bookEntities: book2 } } } }, entities: [], weights: {} };
    seedBookEntities(w2);
    const dc = w2.entities.find((e) => e.name === '貂蝉');
    assert.equal(dc['所属'], '司徒王允府', '书里的原话照样落账（哪怕它不是势力）');
    assert.equal(dc.parent, undefined, '★parent 不跟着写（不是势力条目 ⇒ 隶属空着；两格语义不同）');
    // 契约面：带 `所属` 与表外属性的实体必须过 schema（`所属` 若漏登记 ⇒ additional:true 也拦不住语义漂移）
    //   ★夹具用 `assembleSetting` 造**真形状**的 frozen——否则考的是"夹具缺必填字段"，不是我们这一笔新增的键。
    const ssot = {
        version: 1,
        context: {
            world: 'w', tension: 0.5, positions: ['未明'],
            setting: assembleSetting({
                canon: { powerScale: [], dims: [], rules: [], society: '', techOrMagic: '', historyNotes: [], situation: '', bookEntities: book, settings: [] },
                tension: { polarity: '未聚', direction: '' }, env: {}, fingerprint: 'f', extractedAt: 'now',
            }),
        },
        entities: w.entities, weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0 },
    };
    const v = validate(ssot, ssotSchema);
    assert.equal(v.ok, true, `带所属/表外属性的账必须过 schema：${JSON.stringify(v.errors || []).slice(0, 300)}`);
});

// —— ③ 两遍抽取（真跑执行器，注入确定性 mock）——
test('★leg61 两遍抽取：名册遍只问名号 · 属性遍交属性 · 两遍并册且不新造实体', async () => {
    // 夹具要点：名字**必须真的在书文里**（全书级出处校验会丢"原文未出现"的名号——这条我在第一版夹具上踩过，
    //   当时的 mock 自己造了「名号N」这种书里根本没有的名字，于是 40 个名号全被判编造丢掉：
    //   **判据是对的、夹具是假的**）。这里让每行的正文里就写着那个人名。
    const names = Array.from({ length: 20 }, (_, i) => `角色${i}`);
    const src = names.map((n) => `【${n}】${n}：某职 · ` + '字'.repeat(4000)).join('\n');   // ≈ 8 万字符 ⇒ 2 块
    assert.ok(Array.from(src).length > 60000, '前置：确为分块路径');
    const prompts = [];
    const PASS2_MARK = '本遍不是名册';
    const extract = async (prompt) => {
        prompts.push(prompt);
        const header = '———— 设定原文如下 ————';
        const body = prompt.slice(prompt.indexOf(header) + header.length);
        const found = names.filter((n) => body.includes(n));
        if (prompt.includes(PASS2_MARK)) {
            // 属性遍：只交**带属性**的条目（值抄原文里真实存在的片段）
            return JSON.stringify({
                powerScale: [{ level: '顶层', note: '主宰一方。' }],
                rules: ['法则一（原文）'],
                entities: found.slice(0, 2).map((n) => ({ name: n, kind: 'character', fields: { 表外属性: '某职' } })),
            });
        }
        return JSON.stringify({
            bookEntities: found.map((n) => ({ name: n, kind: 'character' })),
            powerScale: [{ level: '顶层', note: '主宰一方。' }],
            rules: ['法则一（原文）'],
        });
    };
    const r = await extractWorldSetting({ sourceText: src, extract, cache: null });
    assert.equal(r.ok, true);
    assert.equal(prompts.length % 2, 0, `★两遍成对（实际 ${prompts.length} 次调用）`);
    assert.ok(prompts.some((p) => p.includes(PASS2_MARK)), '属性遍的提示词真的发出去了');
    assert.ok(prompts.some((p) => p.includes('名号来自原文的')), '名册遍的提示词真的发出去了');
    // 并册：名册遍的名号一个不少；属性遍的两条**没长成新实体**（按名归并）
    const be = r.setting.frozen.canon.bookEntities;
    const outNames = be.map((b) => b.name);
    assert.equal(new Set(outNames).size, outNames.length, '合并后无重名');
    assert.equal(outNames.length, names.length, `名册遍全量覆盖（实际 ${outNames.length} / 应为 ${names.length}）`);
    assert.ok(outNames.includes(names[names.length - 1]), '尾块的名号也在（分块覆盖全书）');
    const withField = be.filter((b) => b.fields);
    assert.ok(withField.length >= 2, '属性遍的属性并进了名册条目（不新建条目）');
    assert.equal(withField.length, new Set(withField.map((b) => b.name)).size, '★并入而不是另起一条（名字为键）');
    assert.ok(r.setting.frozen.canon.settings.length >= 2, '属性遍的产出另有 `settings` 键留痕');
});

test('★leg61 属性遍提示词：形状里没有名册那一项（那正是它省下输出的办法）', () => {
    const p = buildSettingPrompt('原文……');
    // 只查**形状块**（散文里若解释"名册由另一遍收"是允许的；形状里出现才是矛盾）
    const shape = p.slice(p.indexOf('{'), p.lastIndexOf('}') + 1);
    assert.ok(!shape.includes('bookEntities'), '★形状里不许出现 bookEntities（名号由另一遍负责）');
    assert.ok(shape.includes('entities'), '形状里有 entities');
    assert.ok(p.includes('值必须是本节原文里能逐字找到的原话'), '值必须有出处的铁律写在提示词里');
    assert.ok(p.includes('键你可以按本书自己的写法起名'), '键开放（不预设一本书的字段名）');
});

test('★leg61 键表仍登记七个常用键（旧账形态不动，开放的是"表外"那一半）', () => {
    assert.deepEqual(BOOK_FIELD_KEYS.character, ['所属', '身份', '定位', '实力']);
    assert.deepEqual(BOOK_FIELD_KEYS.faction, ['性质', '倾向', '规模']);
    assert.deepEqual(BOOK_FIELD_KEYS.location, []);
});

// —— ④ 势力树甲类边（"部门被当成势力"的那一族）——
test('★leg61 势力树甲类边：名字里写着上级的连边 · 多候选取最长 ⇒ 直接上级是"最近的那一层"', () => {
    const mk = (names) => names.map((n) => ({ id: `f-${n}`, kind: 'faction', name: n }));
    const ents = mk(['曹魏', '曹魏军', '曹魏西线军', '曹魏远征军', '蜀汉军', '关羽军', '袁绍军']);
    const byName = new Map(ents.map((e) => [e.name, e]));
    const { links } = linkContainedFactions(ents, byName);
    const got = links.map((l) => `${l.child.name}∈${l.parent.name}`).sort();
    assert.deepEqual(got, [
        '曹魏军∈曹魏',
        // ★注意这条：`曹魏西线军` **并不包含 `曹魏军`**（"西线"两个字插在中间）
        //   ⇒ 按"连续子串"判据它连到 `曹魏`，这是对的（判据是机械的，不是我脑子里那棵树）。
        //   ★"曹魏西线军属于曹魏军"这种**语义**归属，字符串判不出来——那正是要交给模型那一遍（乙类边）的事。
        '曹魏西线军∈曹魏',
        '曹魏远征军∈曹魏',
    ].sort());
    // ★零扰动面：名字里没写上级的（关羽军/袁绍军/蜀汉军），一条都不连——这条锁的是"不猜"
    assert.ok(!links.some((l) => ['关羽军', '袁绍军', '蜀汉军'].includes(l.child.name)), '名字里没有上级的势力不许被猜着连边');
});

test('★leg61 势力树：并列候选不硬选 · 跨类别不连', () => {
    const mk = (names, kind = 'faction') => names.map((n) => ({ id: `${kind}-${n}`, kind, name: n }));
    // 真并列：`曹魏部` 与 `魏部远` 都含于 `曹魏部远征军` 且**同长**（都是 3 字）⇒ 语料判不出是哪个 ⇒ 不连 + 留痕
    //   （★为什么夹具要长这样：`曹魏西线军` 那种"中间插字"的名字根本不包含 `曹魏军`，
    //    造不出并列——第一版夹具就是这么写错的，测了个不存在的情形。并列需要**两条同长且都被包含**的名字。）
    const amb = mk(['曹魏部', '魏部远', '曹魏部远征军']);
    const r1 = linkContainedFactions(amb, new Map(amb.map((e) => [e.name, e])));
    assert.equal(r1.links.length, 0, '等长并列 ⇒ 不硬选');
    assert.ok(r1.warnings.some((w) => w.includes('并列')), '并列要留痕（面板/台账看得见"有过歧义"）');
    // 跨类别：同名但 kind=location 的那一条不算上级（只连 faction）
    const cross = [...mk(['曹魏']), ...mk(['曹魏'], 'location'), ...mk(['曹魏军'])];
    const r2 = linkContainedFactions(cross, new Map(cross.map((e) => [e.name, e])));
    // 注意：这里 faction 的「曹魏」本身在册 ⇒ 仍然该连（"同名的 location 存在"不应干扰）；缺了 faction 才不连
    assert.equal(r2.links.length, 1, '同名 location 不影响 faction→faction 的连边');
    const onlyLoc = [...mk(['曹魏'], 'location'), ...mk(['曹魏军'])];
    const r3 = linkContainedFactions(onlyLoc, new Map(onlyLoc.map((e) => [e.name, e])));
    assert.equal(r3.links.length, 0, '只有 location 同名时**不连**（不拿地名当上级）');
});
