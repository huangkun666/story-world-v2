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
import { readFileSync } from 'node:fs';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import {
    sanitizeCanon,
    sanitizeBookFields,
    fieldEvidenceOf,
    seedBookEntities,
    buildSettingOnlyPrompt,
    buildAttrsOnlyPrompt,
    extractWorldSetting,
    assembleSetting,
    linkContainedFactions,
    isTransientCallError,
    SETTING_CHUNK_CHAR,
    BOOK_FIELD_KEYS,
} from '../src/abstract.js';
// ★★★leg71（丙案）：`dedupeTiers` / `dedupeRules` 跟着"档位归一 + 法则分类"那一块搬到 `abstract-tier.js`。
import { dedupeTiers, dedupeRules } from '../src/abstract-tier.js';

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
    assert.equal(b.fields['称号'], '乱世之奸雄', '值对不上原文也保留');
    assert.deepEqual(b.inferred, [], '描述属性不再按出处丢弃');
    assert.deepEqual(b.unknown.sort(), ['体质', '称号', '领地']);
    // 键名形态闸：占位符/整句话不许当键
    const c = sanitizeBookFields({ '<user>': '兖州牧', '这是一个很长的键名不合法': '兖州牧' }, 'character', { sourceText: src });
    assert.deepEqual(c.fields, { '<user>': '兖州牧', '这是一个很长的键名不合法': '兖州牧' }, '不再限制属性键名形态');
    // 上限：表外键比常用键宽松，但仍不许写成散文
    const long = '甲'.repeat(120);
    const d = sanitizeBookFields({ 长属性: long }, 'character', { sourceText: long });
    assert.equal(d.fields['长属性'], long, '表外属性完整保存');
    // ★leg61：`定位`/`身份` 走**宽档**（真机验收发现这一栏常是"体质+性情"一句话，30 字会砍掉长的那批）
    const wide = '甲'.repeat(120);
    const e1 = sanitizeBookFields({ 定位: wide }, 'character', { sourceText: src });
    assert.equal(e1.fields['定位'], wide, '常用属性完整保存');
    assert.equal(e1.truncated, 0);
    const e2 = sanitizeBookFields({ 性质: wide }, 'faction', { sourceText: src });
    assert.equal(e2.fields['性质'], wide, '势力属性完整保存');
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
    assert.deepEqual(r.canon.settings.map((s) => s.name), ['关羽', '吕布']);
    assert.equal(r.canon.settings[0].fields['实力'], '勇武99 / 统御95');
    assert.equal(r.canon.settings[1].fields.武力值, '勇武100', '描述属性不再因出处丢弃');
});

// —— ② `所属` 落账（这一条是"抽出来了却一个都不落地"的锁）——
test('★★leg61 `所属` 落账：名册里的归属必须写进实体（旧法三本账 856 条全丢）', () => {
    const book = [
        { name: '刘备军', kind: 'faction' },                       // 归属目标必须**是势力条目**，parent 那条路才认（既有口径）
        { name: '关羽', kind: 'character', parent: '刘备军', fields: { 所属: '刘备军', 身份: '汉寿亭侯', 实力: '勇武99 / 统御95', 表外属性: '某职' } },
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
    assert.equal(gy.parent, '刘备军', 'canon 已核验的 parent 进入关系，所属描述单独保存');
    assert.equal(gy.fieldSource['所属'], '模型抽取', '保留属性并如实标记来源');
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
    //   ★leg197：那道校验已删（书外名号照收）——本夹具**照旧**让正文里写着人名（它测的是两遍并册，不是出处），
    //   上面那段留档说明的是"当年为什么这么造夹具"，不再是一条活着的判据。
    const names = Array.from({ length: 20 }, (_, i) => `角色${i}`);
    const src = names.map((n) => `【${n}】${n}：某职 · ` + '字'.repeat(4000)).join('\n');   // ≈ 8 万字符 ⇒ 2 块
    assert.ok(Array.from(src).length > 60000, '前置：确为分块路径');
    const prompts = [];
    // ★★★leg150（丙案）：属性那一遍的招牌换成「本遍只干一件事」——
    //   旧招牌 `本遍不是名册` 住在被删掉的那份"设定＋属性"里，而丙案之后**每一块**都用属性那一片。
    const PASS2_MARK = '本遍只干一件事';
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

test('★leg61（leg150 改指 `buildAttrsOnlyPrompt`）：属性遍提示词的形状里没有名册那一项（那正是它省下输出的办法）', () => {
    // ★这一条原来咬的是 `buildSettingPrompt`（首块那份"设定＋属性"）——丙案已把它整份删掉，
    //   于是判据**改指还在生产上跑的那一份**（初始化时每一块都用它）。咬的意思一个字没变：
    //   形状里不许出现名册那一项，属性值必须有出处。
    const p = buildAttrsOnlyPrompt('原文……');
    // 只查**形状块**（散文里若解释"名册由另一遍收"是允许的；形状里出现才是矛盾）
    const shape = p.slice(p.indexOf('{'), p.lastIndexOf('}') + 1);
    assert.ok(!shape.includes('bookEntities'), '★形状里不许出现 bookEntities（名号由另一遍负责）');
    assert.ok(shape.includes('entities'), '形状里有 entities');
    assert.ok(p.includes('相关描述散在不同句子时可以合并保留'), '提示词允许跨句保留补充属性');
    assert.ok(p.includes('键你可以按本书自己的写法起名'), '键开放（不预设一本书的字段名）');
});

// ═══════════ ★★★leg63：**设定遍**（用户令「属性不要抽，只抽设定和概念即可，而且要将表组织起来」）═══════════
//
// 病（用户实机报「重抽出来的设定很简洁，跟之前的表的数量不是一个量级」+「这不是重抽设定吗？为什么要抽属性了」）：
//   三笔改动叠加 ⇒ 「只重抽设定」这条通道**抽不到任何概念表**、设定只覆盖第 1 块（大荒实测 10.1%），
//   却把全 10 块读了一遍去抄属性（而属性抄完被接线层丢掉）。三笔的来路见 `buildSettingOnlyPrompt` 头注。
test('★★★leg63 设定遍提示词：只抽设定与概念（不抽属性）、带概念表形状、要求按原文条目组织', () => {
    const p = buildSettingOnlyPrompt('【条目甲】X1 甲境。', [{ name: '某势力' }]);
    // 解析形状块（★不去比字符串——`JSON.stringify` 带缩进会把内层引号转义，朴素 includes 必假）
    const parsed = JSON.parse(p.slice(p.indexOf('{\n'), p.lastIndexOf('}') + 1));
    assert.deepEqual(Object.keys(parsed), ['刻度', 'rules', '判据', 'society', 'techOrMagic', 'historyNotes', 'situation', 'tension', 'env'],
        '★形状 = 概念表 + 设定五件套（含 leg64 的法则类别）+ 张力/环境（顺序与生产口径一致）');
    // ① 只抽设定与概念
    assert.ok(parsed.刻度, '★带概念表（旧口径那份设定遍用的是 `CANON_SHAPE`，里面**没有** `刻度` ⇒ 重抽永远出不来概念表）');
    assert.ok(!('entities' in parsed) && !('bookEntities' in parsed), '★不问名册/属性（形状里没有这一项）');
    assert.ok(!('powerScale' in parsed) && !('dims' in parsed),
        '★不许再交旧两列（它们是 `刻度` 的派生视图，再交一遍＝同一档存两份＋白烧预算）');
    assert.ok(p.includes('不要') && /不要[\s\S]{0,8}抄任何人的属性/.test(p), '★说明书里明写"不要抄属性"');
    // ② 概念表口径与名册遍/直抽**共用一份**（各写一份 ⇒ 改一处忘一处）
    assert.ok(p.includes('一把尺 = 一张表'), '★共用 `SCALE_RULES`');
    // ③ ★"将表组织起来"：要求每张表都填 `源`（按原文条目归节，面板据此成目录）
    assert.deepEqual(Object.keys(parsed.刻度[0]), ['名', '源', '用途', '档位', '子表', '维度'], '★刻度那一项的格与契约逐字一致（含 `源`）');
    assert.ok(/都要填 `源`/.test(p), '★明写"每一把尺都要填 `源`"（这就是"把表组织起来"那一层）');
    assert.ok(/把表组织起来/.test(p), '★任务句里点名"要把表组织起来"');
    // ④ 每块都要问（调用方对每一块都用这一份）
    assert.ok(/每一块都要单独问一遍/.test(p), '★明写每块都单独问（设定散布全书，不是只有头块）');
    // ⑤ ★★★leg64：**法则类别也要在这一遍里问**（否则「只重抽设定」出来的账永远没有 `ruleKinds`
    //    ⇒ 那份账的法则一条都进不了每轮包。这正是 leg62"概念表只加进名册遍"的同款坑，本棒必须守住）
    assert.ok(parsed.判据, '★设定遍也带 `判据`（法则的类别列）');
    assert.ok(p.includes('与 `rules` 逐条对齐'), '★共用 `RULE_CLASS_GUIDE`（分类口径一处定义、四处展开）');
});

test('★★★leg63＋leg150 接线：**重抽**时每一块都问设定（`skipRoster`）、**初始化**时每一块都只问属性', async () => {
    // 这一条锁的是**接线**（提示词绿 ≠ 生产路径上真的用了它——本仓"机制在、线断了"那张卡）。
    const src = readFileSync(new URL('../src/abstract.js', import.meta.url), 'utf8');
    // ★读源码锁的形状（条件表达式不许被"顺手简化"回旧口径）：
    //   ★★★leg150（丙案）**改口径**：旧锁写的是"初始化那一支＝首块 `buildSettingPrompt`、其余块只问属性"。
    //     用户 2026-09-29 拍板删掉那一份（第一遍的名册遍本来就问了设定，而 leg63 已实测推翻
    //     "设定只在头块"这个前提：大荒首块只覆盖全书 10.1%）⇒ **初始化那一支现在每块都用属性那一片**。
    //     ★旧锁因此**按设计作废**（不是回归）：它锁的正是丙案要删的那件事。
    assert.match(src, /const settingPass = \(t, isFirst[^)]*\) => \(skipRoster/,
        '★设定遍的选词必须**按 skipRoster 分叉**（旧口径无条件"只有第 1 块问设定"）');
    assert.match(src, /skipRoster\s*\n?\s*\? buildSettingOnlyPrompt\(t, declared,/,
        '★重抽那一支：**每块**都用设定遍提示词（不是只有第 1 块）');
    // ★Task 3 复查（task-3-review.md ③）：这一支多带一格 `scope`（本次这一块真正展示的来源）——
    //   锁的**性质不变**（初始化每一块都用属性那一片 + 第 2..N 块多带起根那一问），只是允许那一格。
    assert.match(src, /: buildAttrsOnlyPrompt\(t, declared, \{ \.\.\.\(rootsAsked && !isFirst \? \{ roots: \{ candidates: rootsCandidates \} \} : \{\}\), \.\.\.\(evidence \? \{ sources: frozen, scope \} : \{\}\) \}\)\);/,
        '★初始化那一支：**每块**都用属性那一片（丙案），第 2..N 块再多带起根那一问（甲案）');
    // ★咬**定义与调用点**，不咬"全文出现没出现这个词"——留档注释里点名它是允许的
    //   （本仓的老毛病：判据咬词面，于是连自己的留档注释一起咬住。第一版就是这么假红的）。
    assert.ok(!/export function buildSettingPrompt/.test(src), '★`buildSettingPrompt` 的定义已删（丙案：那份设定是重复的）');
    assert.ok(!/isFirst \? buildSettingPrompt/.test(src), '★它的调用点也删了（初始化那一支现在每块都用属性那一片）');
    // 端到端：真跑一次"重抽"（skipRoster）与一次"初始化"，看每一块收到的提示词
    const promptsOf = async (skipRoster) => {
        const seen = [];
        // ★必须**真的切成多块**：块尺寸取决于原文长度（`> CANON_SRC_CHAR` 才走 3 万的小块）
        //   ⇒ 夹具要够长，否则只有一块、这条判据量不到"第 2..N 块"那一半（第一版就是这么红的）。
        const line = `【条目】X1 甲境。${'说明说明说明说明说明说明说明说明说明说明'.repeat(12)}`;
        const book = Array.from({ length: 400 }, (_, i) => `${line}${i}`).join('\n');
        await extractWorldSetting({
            sourceText: book, skipRoster, force: true,
            extract: async (prompt) => {
                seen.push(prompt);
                const isSetting = /本遍只抽"设定"/.test(prompt);
                const isAttrs = /本遍只干一件事/.test(prompt);
                return JSON.stringify(isSetting
                    ? { 刻度: [{ 名: `表${seen.length}`, 源: '条目0', 档位: [{ 档: 'X1', 注: '一' }] }], rules: ['某法则'] }
                    : isAttrs ? { entities: [{ name: '某人', kind: 'character', fields: { 身份: '甲境' } }] } : {});
            },
        });
        return seen;
    };
    const re = await promptsOf(true);
    assert.ok(re.length > 1, `重抽要分多块（实测 ${re.length} 块）`);
    assert.ok(re.every((p) => /本遍只抽"设定"/.test(p)), '★★重抽：**每一块**问的都是设定遍（不问属性）');
    assert.ok(re.every((p) => !/本遍只干一件事/.test(p)), '★重抽：一块都不许走"只问属性"那份');
    const init = await promptsOf(false);
    assert.ok(init.length > 1, `初始化也要分多块（实测 ${init.length} 块）`);
    // ★初始化时提示词有**两族**（名册遍 ＋ 属性遍），所以不能拿 `every` 扫全部——
    //   要扫的是"**第二遍**的每一块"（第一版就是这么假红的：名册遍当然不含属性那一片的招牌）。
    const initAttrs = init.filter((p) => p.startsWith('你是世界属性的抽取器'));
    const initRoster = init.filter((p) => p.includes('提取事实与名号及其属性'));
    assert.ok(initAttrs.length > 1, `初始化时第二遍也分多块（实测 ${initAttrs.length} 块）`);
    assert.equal(initAttrs.length, initRoster.length, '★两遍同一批块（leg61 口径未变：属性遍调用数与名册遍逐字相同）');
    assert.ok(initAttrs.every((p) => /本遍只干一件事/.test(p)),
        '★★★leg150 丙案：**初始化时第二遍的每一块都只问属性**（旧口径首块问"设定＋属性"，那一份已删）');
    assert.ok(!init.some((p) => /本遍只干两件事/.test(p)), '★初始化时那份"设定＋属性"整个不许再出现');
});

test('★leg61 键表仍登记七个常用键（旧账形态不动，开放的是"表外"那一半）', () => {
    assert.deepEqual(BOOK_FIELD_KEYS.character, ['所属', '身份', '定位', '实力']);
    assert.deepEqual(BOOK_FIELD_KEYS.faction, ['性质', '倾向', '规模']);
    assert.deepEqual(BOOK_FIELD_KEYS.location, []);
});

test('Task3 势力树端到端：名字包含只作候选，`seedBookEntities` 不再据此连边/折叠', () => {
    // ★★★Task 3 口径变更（依据：已批准设计 §6.2「名字包含仅用作搜索候选，不单凭两个名字互相包含
    //   就建立势力上下级」；先有失败证据：旧断言在改后实测 folded=1→0、`昆仑道宫` 由被折叠变回独立实体）。
    //   旧锁要的正是"名字包含 ⇒ 连边 ⇒ 折叠"——那条路已按设计移除。
    const book = [
        { name: '昆仑', kind: 'faction' },
        { name: '昆仑道宫', kind: 'faction' },
        { name: '万法阁', kind: 'faction' },        // 名字里没写上级 ⇒ 一个字都不许连
        { name: '玄一道祖', kind: 'character', parent: '昆仑道宫', fields: { 所属: '昆仑道宫' } },
    ];
    const w = { context: { tension: 0.5, positions: ['未明'], setting: { frozen: { canon: { bookEntities: book } } } }, entities: [], weights: {} };
    const r = seedBookEntities(w);
    const byName = new Map(w.entities.map((e) => [e.name, e]));
    assert.equal(r.folded, 0, '名字包含不再触发折叠');
    assert.ok(byName.has('昆仑道宫'), '★子势力仍是独立实体（名字包含不得把它从账上抹掉）');
    assert.equal(byName.get('昆仑道宫').parent, undefined, '名字包含不得写 parent');
    assert.ok(r.warnings.some((x) => /候选/.test(x) && /昆仑道宫/.test(x)), `候选要留痕：${r.warnings.join('|')}`);
    assert.equal(byName.get('万法阁').parent, undefined, '名字里没有上级的势力不许被猜着连边');
    // 模型主张的归属（玄一道祖 → 昆仑道宫）照常落账，且**不再上溯到"名字包含"的链顶**
    assert.equal(byName.get('玄一道祖').parent, '昆仑道宫', '模型主张照常落账（无链顶可上溯）');
    assert.equal(byName.get('玄一道祖')['所属'], '昆仑道宫', '而 `所属` 照旧存书里的原话（两格分工）');
    assert.ok(r.parentVerified >= 1, `计数如实上报（实际 ${r.parentVerified}）`);
});

// —— ⑤ 起根候选池（另见 test/seed-pool.test.js）——

// —— ⑦ 档位/法则的"可判等"归一（用户报「挡位有重复」）——
test('★leg61 档位归一：同轴的同一档，不同**写法**合成一条（用户新账实测 `T1 感气境`/`T1感气`）', () => {
    const got = dedupeTiers([
        { level: 'T1 感气境 (妖:聚气 | 鬼:游魂 | 魔:凝血)', note: '眉心生光/阴煞聚体。辨凶吉，五谷杂气不侵，减食(一顿顶数日)。' },
        { level: 'T1 感气境 (妖:聚气)', note: '眉心生光/阴煞聚体。' },                       // 同一句的**截断版** ⇒ 合
        { level: 'T1感气', note: '眉心生光/阴煞聚体。辨凶吉，五谷杂气不侵，减食(一顿顶数日)。' },  // 同一句 · 纯写法差异（空格）⇒ 合
        { level: 'T2 炼体境', note: '气血如龙/骨刺狰狞。凡铁难伤，万斤巨力。' },
        { level: 'T2炼体境', note: '凡铁难伤，万斤巨力。' },                               // 截断版 ⇒ 合
    ]);    assert.equal(got.length, 2, `同轴的同一档合成一条（实际 ${got.length} 条：${got.map((g) => g.level).join(' / ')}）`);
    assert.ok(got[0].note.includes('减食'), '★note 留最长的那条（信息最全）');
    assert.equal(got[0].level, 'T1感气', '★level 留最干净的那条（实测 `T4` 优于 `T4 金丹境 (妖:…)`）');
});

test('★leg61 档位归一的两条红线：不跨表 · 不把区间当单档（第一版就这么错过）', () => {
    // 红线一：`地阶(T4-T6)` 是**法器品阶表**，与 `T4 金丹境`（境界表）不是同一件事 ⇒ 不许合并
    const cross = dedupeTiers([
        { level: '地阶(T4-T6)', note: '[法]宗门真传(修元婴/神念/神通); [器]灵器/古宝' },
        { level: 'T4 金丹境', note: '金性不朽/妖丹初成。寿五百。' },
        { level: '天阶(T9)', note: '[法]飞升秘典; [器]半仙器' },
        { level: 'T9 渡劫/帝境', note: '下界本源巅峰。' },
    ]);
    assert.equal(cross.length, 4, `★跨表不许合并（实际 ${cross.length} 条）—— 第一版把四张表压成一张：T1-T4 / T3内门 / T4及以上 全错`);
    // 红线二：档区间不是"某档"——`T9+`（T9 及以上）不该被当成 T9
    const range = dedupeTiers([
        { level: 'T9 渡劫境', note: '渡劫期大能' },
        { level: 'T9+', note: 'T9 及以上皆可' },
        { level: 'T4及以上', note: 'T4 往上' },
        { level: 'T4 金丹境', note: '金性不朽' },
    ]);
    assert.equal(range.length, 4, `★区间不算单档（实际 ${range.length} 条）`);
    // 红线三：同一档的**两种不同说法**都要留（"看着差不多就并"是错的）
    const two = dedupeTiers([
        { level: '准圣', note: 'T15与T16之间，半步道祖' },
        { level: '准圣', note: '介于古帝与道祖之间的过渡阶位' },
    ]);
    assert.equal(two.length, 2, '★内容不同的两种说法都留（不许"看着差不多"就并）');
    // ★零过拟合面：判轴的词**不是**我们的中文词表——`地阶(T4-T6)` 的轴来自**括注前缀**（书自己的写法）
    //   ⇒ 换成任何一本书的记号（下面这把 `MR-7`）照样成立，因为判据里没有题材词。
    const other = dedupeTiers([
        { level: 'MR-7 (丙等)', note: '同一句原话。' },
        { level: 'MR-7', note: '同一句原话。' },
        { level: 'SG-2 (甲等)', note: '另一张表的同一句话。' },
        { level: 'SG-2', note: '另一张表的同一句话。' },
    ]);
    assert.equal(other.length, 2, `★换一套完全不同的记号照样能合（实际 ${other.length} 条）—— 判据里没有题材词`);
});

test('★leg61 法则归一：引号/标点宽度差异与"抄断的前缀版"合成一条（留最长）', () => {
    const got = dedupeRules([
        'T12仙王境及以上：可隐约感知“有不属于此方天地的至高法则波动”，无法定位/辨识本体',
        'T12仙王境及以上：可隐约感知"有不属于此方天地的至高法则波动"，无法定位/辨识本体',   // 只差引号宽度
        'T1-T4(感气→金丹)跨境: 跨1大境界→DC24困难检定,功法/体质/法宝提供加值,有合',              // 抄断的
        'T1-T4(感气→金丹)跨境: 跨1大境界→DC24困难检定,功法/体质/法宝提供加值,有合值,有合理上限',      // 抄全的（更长）
    ]);
    assert.equal(got.length, 2, `同形/前缀版合成一条（实际 ${got.length} 条）`);
    assert.ok(got.some((s) => s.includes('有合理上限')), '★留最长的那条（抄全了的那份）');
    // 反向面：以同句开头但**是另一条**法则 ⇒ 不许吞（第一版设计里 70% 阈值就是为这个）
    const notSwallow = dedupeRules([
        '每个大境界(T1-T9)细分四阶: 初期→中期→后期→巅峰。',
        '每个大境界(T1-T9)细分四阶: 初期→中期→后期→巅峰。浮动系数: 初期(x1.0)/中期(x1.2)/后期(x1.5)/巅峰(x2.0)',
        '完全不同的另一条法则：灵石不可伪造',
    ]);
    assert.equal(notSwallow.length, 3, '★前缀关系但长度差太大 ⇒ 不合并（防一条吞掉后面所有以它开头的）');
});
test('★leg61 重试判据：瞬时错（524/fetch failed）重试 · 超时与配置错不重试', async () => {
    // 为什么要这条锁：真机实测抓到过"超时后先重试（又等满一个 600 秒周期）、再交给拆半"的瀑布——
    //   三国（7 块）因此跑了 2.5 小时仍未收尾，大荒 22 次调用（预期 10 次）。
    //   判据本身是 `isTransientCallError`，它是纯函数，直接喂它跑（不必等真网关）。
    assert.equal(isTransientCallError(new Error('HTTP 524')), true, '524 = 网关掐断 ⇒ 重试有救');
    assert.equal(isTransientCallError(new Error('fetch failed')), true, '链路断 ⇒ 重试有救');
    assert.equal(isTransientCallError(new Error('socket hang up')), true);
    assert.equal(isTransientCallError(new Error('HTTP 503')), true, '网关 5xx ⇒ 重试');
    const to = new Error('抽取超时（600s）');
    to.sw2Timeout = true;
    assert.equal(isTransientCallError(to), false, '★超时 = 止损 ⇒ **不重试**（立刻交给拆半降级）');
    assert.equal(isTransientCallError(new Error('HTTP 401')), false, '配置错 ⇒ 重试只是白烧');
    assert.equal(isTransientCallError(new Error('HTTP 429')), false, '限流 ⇒ 立刻加重限流是错的');
    // 端到端：超时的 extract ⇒ 只调 1 次/块（不重试）
    const filler = Array.from({ length: 50 }, () => '字'.repeat(1500)).join('\n');
    const chunkCount = Math.ceil(Array.from(filler).length / SETTING_CHUNK_CHAR);
    let n = 0;
    const alwaysTimeout = async () => { n += 1; const e = new Error('抽取超时'); e.sw2Timeout = true; throw e; };
    const r = await extractWorldSetting({ sourceText: filler, extract: alwaysTimeout, cache: null });
    assert.equal(r.ok, false, '全块超时 ⇒ 如实失败（不假装成功）');
    // 每块只试 1 次、每块两遍（名册 + 属性）⇒ 恰好 2×块数；若超时被重试则是 4×块数
    assert.equal(n, chunkCount * 2, `★超时不许重试（实际 ${n} 次 / 块数 ${chunkCount} ⇒ 应为 ${chunkCount * 2}；重试的话是 ${chunkCount * 4}）`);
});test('★leg61 势力树甲类边：名字里写着上级的连边 · 多候选取最长 ⇒ 直接上级是"最近的那一层"', () => {
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

// ═══════════ ★★★本笔（用户令「这个通道绝对不能有」）：**设定面也要过"名字真在书里"这道校验** ═══════════
//
// 病（真账实测，逐字对过）：`canon.settings` 622 个名字里**有 1 个在书文里一个字都没有**
//   （`玉爪儿`，`{kind:'character', fields:{身份:'灵兽'}}`）——它是**被别的扩展塞进那次调用里的记忆**
//   （通道在 HTTP 层：别人换掉了页面的 fetch，见 `src/transport-http.js` 的长注）。
//   `bookEntities` 早就有这道全书级出处校验，而 `settings` **从来没有** ⇒ 外来内容可以从这一格落进账。
//   真账读数（同一份账、同一把尺子）：bookEntities 723 个名字 **0 个**对不上；settings 622 个名字 **1 个**对不上。
// ★★★leg197（用户令「把抽象时因为引擎根据模型给的引用而找不到原文而丢弃模型提出的行动的这个行为全部取消了…」）：
//   **这一笔整个反转**——那道"设定面全书级出处校验"（与名册共用 `filterByBookEvidence`）**连函数一起删了**。
//   ⇒ 书文里找不到的名字**照收**；"对不上"只进诊断（`unverified` / 人话摘要「出处对不上 N（照收）」）。
//   ★代价如实记在这里（源码 `src/abstract.js` 的同位注释也写了）：`settings` 那条"外来内容绕过承重墙"的缝
//     按用户令**重新敞开**——要收回来只需恢复那两个函数调用。下面这条锁按新口径改写，病档留在此处不删。
test('★★★本笔·设定面：书文里找不到的名字**照收**（leg197 撤销那道校验），只把"出处对不上"记进诊断（★leg197：出处不再丢，照收）', async () => {
    const src = '【角色甲】角色甲：某职。\n【角色乙】角色乙：某职。';
    const extract = async () => JSON.stringify({
        bookEntities: [{ name: '角色甲', kind: 'character' }, { name: '角色乙', kind: 'character' }],
        entities: [
            { name: '角色甲', kind: 'character', fields: { 表外属性: '某职' } },   // 值也在原文里 ⇒ 收
            // ★leg197：夹具不变（书文里一个字都没有的那条），只给它一个"书里找不到的出处"——
            //   旧法它被设定面全书级出处校验摘掉；现在照收，诊断里记 `unverified`。
            { name: '别处来的', kind: 'character', fields: { 身份: '灵兽' }, ev: { s: 'S1', q: '书里一个字都没有的句子' } },
        ],
    });
    // ★leg197：走**严格道**（给了允许来源）——出处核验的结果才有诊断可看（legacy 道不产出出处记录）。
    const records = [];
    const r = await extractWorldSetting({
        sourceText: src, extract, cache: null,
        allowedSources: [{ sourceId: 'w1', text: src }],
        onEvidence: (rec) => records.push(rec),
    });
    assert.equal(r.ok, true, '★前置：这一轮整体是成的（不是"全失败恰好没有 settings"）');
    const names = r.setting.frozen.canon.settings.map((s) => s.name);
    // ★leg197：旧断言是 `deepEqual(names, ['角色甲'])`（书文里没有的名字不许留在设定面）——现在**照收**。
    assert.deepEqual(names, ['角色甲', '别处来的'],
        `★leg197：书文里没有的名字也照收（出处只记账、不拦人）——旧法它被"设定面全书级出处校验"摘掉，`
        + `而那道校验连同 filterByBookEvidence 一起撤了（实测留下 ${JSON.stringify(names)}）`);
    // ★leg197：对不上这件事仍要看得见——诊断里一条 `unverified`，人话摘要里一个「出处对不上 N（照收）」。
    const outsiderRecs = records.filter((rec) => rec.subject === '别处来的');
    assert.ok(outsiderRecs.length >= 1 && outsiderRecs.every((rec) => rec.action === 'unverified'),
        `★leg197：出处对不上只记账（unverified），不丢项：${JSON.stringify(outsiderRecs)}`);
    assert.match(String(outsiderRecs[0].why), /原话对不上/, '诊断要写明"原话对不上"（不许静默）');
    assert.ok(r.evidence.summary.unverified >= 1 && r.evidence.summary.dropped === 0,
        '★leg197：摘要里 dropped 恒 0，出处那一档计进 unverified');
    assert.ok(r.errors.some((e) => e.includes('出处对不上')), `留痕：人话摘要里有「出处对不上 N（照收）」：${r.errors.join('; ')}`);
    // ① 名册那一侧一个字不变（两把尺子必须是同一把，不许连带改动名册口径）
    assert.deepEqual(r.setting.frozen.canon.bookEntities.map((b) => b.name).sort(), ['角色甲', '角色乙'].sort(),
        '★名册照旧（`别处来的` 只从 entities 这一路进设定面；名册口径本笔不动）');
    // ② ★反向自证改成"两边都收"：把那个名字放进书文里，同一条照样留下（这条路上已经没有"名字闸"了）
    const src2 = src + '\n【别处来的】别处来的：灵兽。';
    const r2 = await extractWorldSetting({
        sourceText: src2, extract, cache: null,
        allowedSources: [{ sourceId: 'w1', text: src2 }],
    });
    assert.deepEqual(r2.setting.frozen.canon.settings.map((s) => s.name).sort(), ['别处来的', '角色甲'].sort(),
        '★leg197：书文里真有这个名字 ⇒ 照样留在设定面（撤销的是"找不到就丢"这条判据，不是"照收"这条口径）');
});
