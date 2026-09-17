// story-world-v2/test/rule-kinds.test.js
// ★★★leg64（用户令「规则会怎么样？规则太多会怎么样？」→ 拍板「**只进『判断依据』**」）：
//   **法则分类与「法则进包」全链路判据**。
//
// 这一棒治的病（leg63 §1.2 的消费面审计，本棒逐键复查确认）：
//   `canon.rules` **只有 `render.js` 读**——判定原则（`DC24` 检定 / 换算率 / 好感·心防锁）
//   **模型一个字看不到**，于是它每轮写实力、好感、战果、物价时只能自己发明数。
//   这与 `刻度` 当初的病同源（leg61 律 7「抽出来的东西没人消费 = 没抽」），
//   而 `刻度` 已用"把可判等的一小块递进包当锚"治好 ⇒ 本条是它的兄弟。
//
// ★本文件的判据形态纪律（照 leg61 §4.1 与 `scales-concept-table.test.js` 的同一把尺）：
//   **不许出现"我在某一本书里看到的词或数字"当判据**。下面所有夹具都是**自造记号与自造数字**
//   （`X1`/`甲境`、`DC17`、`1:333`…），不抄大荒/三国/实教的任何原话——
//   这样"换一本书照样成立"这条锁才算真的锁住了。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    sanitizeCanon, mergeCanonChunks, classifyRule, classifyRulesByKind, keyByPrefix,
    RULE_CLASSES, RULE_CLASS_NONE, RULE_CLASSES_PACK,
    RULE_PACK_TOP, RULE_PACK_STR_MAX, RULE_PACK_CHAR_TOP,
    buildRosterPrompt, buildSettingOnlyPrompt, RULE_CLASS_GUIDE,
} from '../src/abstract.js';
import { buildRuleAnchor, buildScaleAnchor, buildScaleCatalog, buildEvolutionPack } from '../src/pack.js';
import { renderSettingHtml } from '../src/render.js';

// ───────── 夹具：**自造**的五类法则（术语全部与真书无关） ─────────
const R_JUDGE = '跨甲境: 跨一阶→DC17 困难检定; 跨二阶→无效';
const R_JUDGE2 = '1 枚甲晶 = 333 枚乙晶（换算率固定）';
const R_WORLD = '目睹高维交锋会导致【道心】狂降，归零则畸变';      // ★世界观：不是判据，但也要进包
const R_WORLD2 = '未录名册者视为野修，无资源分配权';
const R_STYLE = '绝对禁止使用现代口语说法';
const R_SCRIPT = '触发时必须对六组字段同时全量 replace';
const R_OTHER = '功成身退，天之道';

const canonOf = (rules, 判据) => {
    const r = sanitizeCanon({ rules, 判据 });
    assert.equal(r.ok, true, '夹具必须过净化');
    return r.canon;
};

// 最小世界夹具（够 `renderSettingHtml` 走完设定页；形状照 live-world 精简）
const world = (canon) => ({
    version: 1,
    context: {
        world: '测试世界', tension: 0.5, positions: ['临渊城'],
        setting: {
            frozen: {
                fingerprint: 'fnv1a_test', extractedAt: '2026-09-18T00:00:00Z',
                canon: { powerScale: [], dims: [], rules: [], society: '', techOrMagic: '', historyNotes: [], situation: '', ...canon },
                compile: null,
            },
            dynamic: { tension: { polarity: '甲/乙', direction: '甲压乙', intensity: 0.5 }, env: {}, derivedFrom: [] },
        },
    },
    entities: [], weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0 },
});

// ═══════════════ ① 净化层：`判据` 按位对齐 · 词表收口 · 零迁移 ═══════════════
test('★leg64 净化：`判据` 与 `rules` 按位对齐，落成一格 `ruleKinds`', () => {
    const canon = canonOf([R_JUDGE, R_WORLD, R_STYLE, R_SCRIPT, R_OTHER], ['判断依据', '世界观设定', '文风禁令', '变量指令', '其他']);
    assert.deepEqual(canon.rules, [R_JUDGE, R_WORLD, R_STYLE, R_SCRIPT, R_OTHER], '★原文那一列一个字不改（仍是纯字符串数组）');
    assert.deepEqual(canon.ruleKinds, {
        [R_JUDGE]: '判断依据', [R_WORLD]: '世界观设定', [R_STYLE]: '文风禁令', [R_SCRIPT]: '变量指令', [R_OTHER]: '其他',
    }, '类别另起一格、按原文串索引');
});

test('★★leg64 净化：老账零迁移——没有 `判据` 就**没有这一格**（不猜、不落空占位）', () => {
    const canon = canonOf([R_JUDGE, R_OTHER]);
    assert.deepEqual(canon.rules, [R_JUDGE, R_OTHER]);
    assert.equal('ruleKinds' in canon, false, '★没有类别 ⇒ 键不出现（"空着就是空着"，与 leg63 的 `源` 同一条纪律）');
});

test('★★leg64 净化：词表外的类别一律不认（模型自造类别不许混进判据）', () => {
    const canon = canonOf([R_JUDGE, R_STYLE], ['设定', '机制']);
    assert.equal('ruleKinds' in canon, false, '★自造类别词一个都不收 ⇒ 全都当"未分类"（契约层放行、净化层收口）');
    // 空串/缺项/短数组都要按"未分类"，**不许错位贴**
    assert.equal(classifyRule(['判断依据', '文风禁令'], 5), RULE_CLASS_NONE, '越界下标 ⇒ 未分类（不抛、不贴错）');
    assert.equal(classifyRule(undefined, 0), RULE_CLASS_NONE, '没有这一列 ⇒ 未分类');
    assert.equal(classifyRule([' 判断依据 '], 0), '判断依据', '两侧空白照吃');
});

test('★leg64 净化：对象形态（`{文, 类}`）也吃——别把对象串成 `[object Object]`', () => {
    const canon = canonOf([{ 文: R_JUDGE, 类: '判断依据' }]);
    assert.deepEqual(canon.rules, [R_JUDGE], '★取 `文` 当原文，而不是 `String(对象)`');
});

// ═══════════════ ② 去重之后类别要**重挂到胜者身上**（本棒设计时推演出的洞） ═══════════════
test('★★leg64 净化：短版被判据、长版胜过它时，类别跟着挪到胜者（否则判据静默丢类别）', () => {
    // ★去重发生在**块间合并**那一步（`mergeCanonChunks` → `dedupeRules`），不在 `sanitizeCanon`：
    //   本仓口径是"块内原样收、并集时去重"（leg61）。所以这条锁建在**合并之后**。
    //   ⚠夹具纪律：两条长度比必须落在 `dedupeRules` 的 **45% 阈值之内**——那个阈值是**有意**留的
    //     （防"世界存在严酷的法则壁垒…"把后面所有以它开头的**另一条**法则吞掉）。
    //     本棒第一版夹具写成了 19 字 vs 31 字（差 63%）⇒ 两条都被留下，**当场红**——
    //     那是判据写错，不是代码错（本仓"按实测锁、不按脑补锁"的同一条教训）。
    const short = '跨甲境: 跨一阶→DC17 困难检定';
    const long = '跨甲境: 跨一阶→DC17 困难检定; 跨二阶→无效';
    const canon = canonOf([short, long], ['判断依据', RULE_CLASS_NONE]);
    assert.deepEqual(canon.rules, [short, long], '块内原样收（两条都在）');
    assert.equal(canon.ruleKinds[short], '判断依据', '短版带判据类别');
    // 合并 ⇒ `dedupeRules` 留**长版**（近义互为前缀，留最长的）
    const merged = mergeCanonChunks([{ canon }]).canon;
    assert.deepEqual(merged.rules, [long], '★合并后只剩长版（去重口径与 leg61 一致）');
    assert.equal(merged.ruleKinds[long], '判断依据', '★类别跟着挪到胜者身上（不挪 ⇒ 判据静默丢类别）');
    assert.equal(buildRuleAnchor(merged)?.length, 1, '⇒ 这条判据真的进得了包');
});

test('★leg64 `keyByPrefix`：互为前缀才兜底，无关的两条不互相借类别', () => {
    const kinds = new Map([['甲乙丙丁', '判断依据']]);
    assert.equal(keyByPrefix(['甲乙丙'], kinds).get('甲乙丙'), '判断依据', '胜者是它的前缀 ⇒ 取它的类别');
    assert.equal(keyByPrefix(['戊己庚辛'], kinds).get('戊己庚辛'), undefined, '★无关的两条不许借（借了就是错贴）');
});

// ═══════════════ ③ 块间合并：类别跟着并集走 ═══════════════
test('★leg64 块间合并：`ruleKinds` 跨块并集（同一类只留一份，先到先得）', () => {
    const a = canonOf([R_JUDGE, R_STYLE], ['判断依据', '文风禁令']);
    const b = canonOf([R_JUDGE, R_OTHER], ['判断依据', '其他']);
    const merged = mergeCanonChunks([{ canon: a }, { canon: b }]);
    assert.deepEqual(merged.canon.rules, [R_JUDGE, R_STYLE, R_OTHER], '法则仍并集去重');
    assert.equal(merged.canon.ruleKinds[R_JUDGE], '判断依据', '★类别没在合并里丢');
    assert.equal(merged.canon.ruleKinds[R_OTHER], '其他');
});

// ═══════════════ ④ 分堆：面板与进包**读同一个函数** ═══════════════
test('★★leg64 `classifyRulesByKind`：计数 + 未标数 + 进包两类', () => {
    const all = [R_JUDGE, R_JUDGE2, R_WORLD, R_WORLD2, R_STYLE, R_SCRIPT, R_OTHER];
    const canon = canonOf(all, ['判断依据', '判断依据', '世界观设定', '世界观设定', '文风禁令', '变量指令', '其他']);
    const st = classifyRulesByKind(canon.rules, canon.ruleKinds);
    assert.deepEqual(st.计数, { 判断依据: 2, 世界观设定: 2, 文风禁令: 1, 变量指令: 1, 其他: 1 });
    assert.equal(st.未标数, 0);
    assert.equal(st.判据条数, 2, '判据条数单独可读（面板要分别报）');
    assert.equal(st.世界观条数, 2, '世界观条数单独可读');
    assert.deepEqual(st.判据, [R_JUDGE, R_JUDGE2, R_WORLD, R_WORLD2],
        '★进包两类：**判据在前、世界观随后**（闸按这个序吃预算 ⇒ 判据先占，不被世界观挤走）');
    // 老账（无 ruleKinds）⇒ 全落"未分类"，进包为空
    const legacy = classifyRulesByKind([R_JUDGE, R_OTHER], undefined);
    assert.equal(legacy.未标数, 2);
    assert.equal(legacy.判据.length, 0, '★老账一条都不进包（不猜）');
});

// ═══════════════ ⑤ 进包：判据 + 世界观两类 · 三道闸 · 老账键不出现 ═══════════════
test('★★★leg64 进包：**「判断依据」与「世界观设定」两类都进**（用户令「世界设定和判定依据都要」）', () => {
    const all = [R_JUDGE, R_JUDGE2, R_WORLD, R_WORLD2, R_STYLE, R_SCRIPT, R_OTHER];
    const canon = canonOf(all, ['判断依据', '判断依据', '世界观设定', '世界观设定', '文风禁令', '变量指令', '其他']);
    const anchor = buildRuleAnchor(canon);
    assert.deepEqual(anchor, [R_JUDGE, R_JUDGE2, R_WORLD, R_WORLD2],
        '★两类都进，判据在前（这是用户拍板的口径：世界设定也要）');
    for (const s of [R_STYLE, R_SCRIPT, R_OTHER]) assert.ok(!anchor.includes(s), `「${s}」不进包（留账给面板）`);
});

test('★★leg64 进包：世界观**不许把判据挤出包外**（两类共用一个字符闸时，判据先占）', () => {
    // 病（实机第一版就是这个形态）：262 条被标成判据 ⇒ 按账本序截断 ⇒ **真判据被"灵气浓度稀薄至普通"
    //   这类设定挤在门外**。现在两类一起进包，更必须保证"判据先占"这条序。
    const judges = Array.from({ length: 20 }, (_, i) => `判据${i}：${'数'.repeat(40)}`);   // 20×~45 字符
    const worlds = Array.from({ length: 200 }, (_, i) => `世界观${i}：${'述'.repeat(90)}`);  // 大量长设定
    const canon = canonOf([...judges, ...worlds], [...judges.map(() => '判断依据'), ...worlds.map(() => '世界观设定')]);
    const anchor = buildRuleAnchor(canon);
    const keptJudges = anchor.filter((s) => s.startsWith('判据')).length;
    assert.equal(keptJudges, judges.length, `★${judges.length} 条判据一条都不许被世界观挤掉（实际留 ${keptJudges}）`);
    assert.ok(anchor.some((s) => s.startsWith('世界观')), '世界观也确实进了（不是把那一类整类丢了）');
    assert.ok(anchor.reduce((a, s) => a + s.length, 0) <= RULE_PACK_CHAR_TOP, '总字符仍在主闸之内');
    // 反过来：判据自己就把预算吃满时，世界观**允许被让位**（判据优先是有意的，不是 bug）
    const fatJudges = Array.from({ length: 300 }, (_, i) => `判据${i}：${'数'.repeat(100)}`);
    const onlyJudge = canonOf([...fatJudges, ...worlds], [...fatJudges.map(() => '判断依据'), ...worlds.map(() => '世界观设定')]);
    const a2 = buildRuleAnchor(onlyJudge);
    assert.ok(a2.every((s) => s.startsWith('判据')), '★判据吃满预算时，包里全是判据（世界观让位，有意的）');
});

test('★★leg64 进包：老账（没有类别）⇒ **键不出现**，与旧行为逐字节相同', () => {
    const canon = canonOf([R_JUDGE]);
    assert.equal(buildRuleAnchor(canon), null, '★一条都没有类别 ⇒ 返回 null ⇒ `setting.法则` 这个键不出现');
    // 别人的世界（没有 canon / 空 canon）都不许抛
    assert.equal(buildRuleAnchor(undefined), null);
    assert.equal(buildRuleAnchor({}), null);
    assert.equal(buildRuleAnchor({ rules: [] }), null);
});

test('★leg64 进包：三道闸（条数 / 单条长度 / 总字符）——`rules` 过去**没有任何上界判据**', () => {
    // ① 条数闸（**荒谬上界**：与字符闸的先后关系在下面单独锁）
    const many = Array.from({ length: RULE_PACK_TOP + 15 }, (_, i) => `第 ${i} 条判据：阈值 ${i}`);
    const c1 = canonOf(many, many.map(() => '判断依据'));
    assert.equal(buildRuleAnchor(c1).length, RULE_PACK_TOP, `★条数 ≤ ${RULE_PACK_TOP}`);
    // ② 单条长度闸（散文型的判据不许整段灌进包）
    const longOne = `这一条特别长：${'啰'.repeat(RULE_PACK_STR_MAX + 50)}`;
    const c2 = canonOf([longOne], ['判断依据']);
    assert.equal(buildRuleAnchor(c2)[0].length, RULE_PACK_STR_MAX, `★单条截到 ${RULE_PACK_STR_MAX} 字`);
    // ③ 总字符闸（条数够但都偏长时仍不许撑裂包）
    const fat = Array.from({ length: RULE_PACK_TOP }, (_, i) => `第 ${i} 条：${'长'.repeat(RULE_PACK_STR_MAX - 10)}`);
    const c3 = canonOf(fat, fat.map(() => '判断依据'));
    const got = buildRuleAnchor(c3);
    const chars = got.reduce((a, s) => a + s.length, 0);
    assert.ok(chars <= RULE_PACK_CHAR_TOP, `★总字符 ≤ ${RULE_PACK_CHAR_TOP}（实际 ${chars}）`);
    assert.ok(got.length < RULE_PACK_TOP, '★总字符闸真的先咬住了（不是靠条数闸兜的）');
});

test('★★leg64 闸的单位纪律：**总字符才是主闸**，条数闸不许先咬（本棒第一版就错在这）', () => {
    // 病（本棒实测暴露）：第一版把条数闸设成 40，而真账 70 条判据平均只有 **50 字符**
    //   ⇒ 条数闸**先于**字符闸咬住 ⇒ 静默丢掉约 27 条真判据，而字符闸明明还差得远。
    //   "条数"不是包预算的度量，"字符"才是（与 `刻度` 那边"表数上限必须 ≥ 档/维各自需要的表数之和"同族）。
    const n = 70;                                          // 真账实测的最大规模（大荒 70 条判据）
    const avg = 50;                                        // 真账实测平均长度（3477 / 70 ≈ 50）
    const list = Array.from({ length: n }, (_, i) => `判据${i}：${'字'.repeat(avg - 6)}`);
    const canon = canonOf(list, list.map(() => '判断依据'));
    const got = buildRuleAnchor(canon);
    assert.equal(got.length, n, `★${n} 条真账规模的判据**一条都不许被条数闸砍掉**（实际进 ${got.length} 条）`);
    assert.ok(got.reduce((a, s) => a + s.length, 0) <= RULE_PACK_CHAR_TOP, '且总字符仍在主闸之内');
    assert.equal(RULE_PACK_TOP >= 2 * n, true, `★条数闸（${RULE_PACK_TOP}）必须 ≥ 真账规模的两倍 ⇒ 它只当"荒谬上界"`);
});

test('★★leg64 进包真接线：`buildEvolutionPack` 的 `setting.法则` 真的出现（机制在、线也要在）', () => {
    // 本仓最贵的那类病：机制写了但线没接（leg25 g 的别名、leg34 的复活都是）。
    const canon = canonOf([R_JUDGE, R_WORLD, R_STYLE], ['判断依据', '世界观设定', '文风禁令']);
    const ssot = {
        context: { world: '测试世界', setting: { frozen: { canon }, dynamic: { tension: { polarity: '甲/乙', intensity: 0.5 }, env: {} } } },
        entities: [], agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 1 },
    };
    const base = buildEvolutionPack(ssot, null);
    assert.deepEqual(base.pack.setting.法则, [R_JUDGE, R_WORLD],
        '★判据与世界观**都**真的进了每轮包（这是本棒的全部意义）');
    assert.ok(!JSON.stringify(base.pack.setting).includes(R_STYLE), '文风禁令没混进去');
    // 老账：同一个位置**不许出现这个键**（零迁移 ⇒ 旧行为逐字节相同）
    const legacy = { ...ssot, context: { ...ssot.context, setting: { frozen: { canon: canonOf([R_JUDGE]) }, dynamic: { tension: { polarity: '甲/乙', intensity: 0.5 }, env: {} } } } };
    const p2 = buildEvolutionPack(legacy, null);
    assert.equal('法则' in (p2.pack.setting || {}), false, '★老账包里没有 `法则` 键（零迁移）');
});

// ═══════════════ ⑥ 提示词：两条通道都要问类别（leg62 的坑不许重演） ═══════════════
test('★★leg64 提示词：名册遍与设定遍**都**问 `判据`（leg62"只加进一条通道"的坑不许重演）', () => {
    for (const [name, p] of [['名册遍', buildRosterPrompt('【条目】X1 甲境。')], ['设定遍', buildSettingOnlyPrompt('【条目】X1 甲境。')]]) {
        assert.ok(p.includes('`判据`'), `${name}：问类别`);
        assert.ok(p.includes('与 `rules` 逐条对齐'), `${name}：口径与 rules 按位对齐`);
        const shape = p.slice(p.indexOf('{'), p.lastIndexOf('}') + 1);
        assert.ok(shape.includes('判据'), `${name}：形状里也有这一格（只在散文里说＝模型不会交）`);
    }
    // ★口径必须写在提示词里（**两轮实机修出来的**，见 `RULE_CLASS_GUIDE` 头注）：
    //   ① 判据是稀疏的（"一本书通常只有二三十条"）——不这么写，判据那一类会被灌满；
    //   ② 世界观**不是残渣**（它是独立一类、也进包）——第一版把它当兜底桶，实机当场证明是错的。
    assert.ok(RULE_CLASS_GUIDE.some((l) => l.includes('一本书通常只有')), '★明写"判据是稀疏的（二三十条）"');
    assert.ok(RULE_CLASS_GUIDE.some((l) => l.includes('也进每轮包')), '★明写"世界观设定也进包"（用户令「都要」）');
    assert.ok(RULE_CLASS_GUIDE.some((l) => l.includes('这个世界是怎么运转的')), '★给出判据 vs 世界观的分界句');
    assert.deepEqual(RULE_CLASSES, ['判断依据', '世界观设定', '文风禁令', '变量指令', '其他'], '词表五个（★世界观已升格成一类）');
    assert.deepEqual(RULE_CLASSES_PACK, ['判断依据', '世界观设定'], '★进包两类，判据在前');
});

// ═══════════════ ⑦ 面板：按类别分段 + **如实报**进包条数 ═══════════════
test('★★leg64 面板：法则栏按类别分段，并如实报"哪几条真的进了包"（两类分开报）', () => {
    const canon = canonOf([R_JUDGE, R_WORLD, R_STYLE], ['判断依据', '世界观设定', '文风禁令']);
    const html = renderSettingHtml(world(canon));
    assert.ok(html.includes('法则（3 条'), '表头报总条数');
    assert.ok(html.includes('判断依据（1 条）'), '★判据单独一段');
    assert.ok(html.includes('世界观设定（1 条）'), '★世界观**也单独成段**（第一版它混在兜底的"其他"里）');
    assert.ok(html.includes('文风禁令（1 条）'), '★文风禁令单独一段');
    assert.ok(/其中 <b>2<\/b> 条每轮进模型的包/.test(html), '★如实报进包总条数（读的就是进包那个函数的分堆）');
    assert.ok(/<b>判断依据 1<\/b> 条/.test(html), '★两类**分开报**（合着报就看不出是谁进了包）');
    assert.ok(/<b>世界观设定 1<\/b> 条/.test(html), '★世界观那一类也要报出来');
    // ★原文一条不许少（"折起来"不等于"藏掉"，本仓纪律）
    for (const s of [R_JUDGE, R_WORLD, R_STYLE]) assert.ok(html.includes(s), `原文「${s}」仍在产物里`);
    // ★HTML 里不许有 markdown 星号（leg60/leg63/leg64 各栽过一次）
    assert.ok(!html.includes('**'), '★整卡不许含 `**`（面板是 HTML）');
});

test('★★leg64 面板：老账如实报"一条都没进包"，并指出出路（重抽）', () => {
    const html = renderSettingHtml(world({ rules: [R_JUDGE, R_OTHER] }));
    assert.ok(html.includes('一条都没进每轮包'), '★不许默默不报（玩家会以为"抽出来就在用"——这正是本棒要治的观感）');
    assert.ok(html.includes(RULE_CLASS_NONE), '点明"未分类"这一栏');
    assert.ok(html.includes('只重抽设定'), '给出路：重抽一次才会有类别');
    assert.ok(!html.includes('**'), '★老账那一支同样不许有星号');
});

// ═══════════ ⑧ 刻度目录（leg64 第三轮：用户问「这么多模型怎么检索，难道直接全塞吗」） ═══════════
test('★★leg64 刻度目录：只列**没进包**的表名（不带档位内容），给模型一份"书里还有什么"', () => {
    // 真账实景：64 张表 / 28,764 字符 = 预算 32%（全塞不进）；进包只 4 张 ⇒ 60 张模型不知道存在。
    const canon = {
        powerScale: [], dims: [], rules: [],
        刻度: Array.from({ length: 40 }, (_, i) => ({
            名: `表${i}`, 源: '条目甲',
            档位: Array.from({ length: 3 }, (_, j) => ({ 档: `X${j}`, 注: '说明' })),
        })),
    };
    const packed = buildScaleAnchor(canon) || [];
    const cat = buildScaleCatalog(canon, new Set(packed.map((t) => t.表))) || [];
    assert.ok(packed.length > 0 && packed.length < 40, `夹具确实发生了截断（进包 ${packed.length} / 40）`);
    assert.equal(cat.length, 40 - packed.length, '★目录 = 账上 - 已进包（不重复列已经给过的）');
    assert.ok(cat.every((s) => !s.includes('X0')), '★目录里**不许带档位名**（它只是目录，带内容就变第二份真相）');
    assert.ok(cat.every((s) => /（\d+ 档）$/.test(s)), '目录形状：`表名（N 档）`');
    const chars = cat.reduce((a, s) => a + s.length, 0);
    assert.ok(chars < 40 * 12, `★目录必须极便宜（实测 60 张 = 753 字符；夹具 ${cat.length} 张 = ${chars} 字符）`);
});

test('★leg64 刻度目录：空着就是空着（没有表 / 全都进了包 ⇒ 键不出现）', () => {
    assert.equal(buildScaleCatalog(undefined, new Set()), null);
    assert.equal(buildScaleCatalog({ powerScale: [], dims: [] }, new Set()), null);
    // 全进包 ⇒ 目录没东西可列
    const canon = { powerScale: [], dims: [], rules: [], 刻度: [{ 名: '唯一表', 档位: [{ 档: 'X1', 注: '一' }] }] };
    assert.equal(buildScaleCatalog(canon, new Set(['唯一表'])), null, '★全进了包 ⇒ 目录为 null（不留空栏）');
});

test('★★leg64 刻度目录真接线：`buildEvolutionPack` 的 `setting.刻度目录` 真的出现', () => {
    const canon = {
        powerScale: [], dims: [], rules: [],
        刻度: Array.from({ length: 30 }, (_, i) => ({ 名: `表${i}`, 源: '甲', 档位: [{ 档: `X${i}`, 注: '一' }] })),
    };
    const ssot = {
        context: { world: '测试世界', setting: { frozen: { canon }, dynamic: { tension: { polarity: '甲/乙', intensity: 0.5 }, env: {} } } },
        entities: [], agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 1 },
    };
    const built = buildEvolutionPack(ssot, null);
    assert.ok(Array.isArray(built.pack.setting.刻度目录), '★目录真的进了每轮包');
    assert.ok(built.pack.setting.刻度目录.length > 0);
    assert.ok(built.pack.setting.刻度, '刻度块仍在（目录不是替代它）');
    // 键序锁：`刻度目录` 紧跟在 `刻度` 之后（面板与调试者按这个序读；也防"目录跑到 setting 外面去"）
    const keys = Object.keys(built.pack.setting);
    assert.equal(keys[keys.indexOf('刻度') + 1], '刻度目录', '★键序：刻度 → 刻度目录');
    // 三块齐全时（有判据 + 有表 + 有目录）的顺序
    const c2 = { ...canon, rules: ['跨甲境: 跨一阶→DC17'], ruleKinds: { '跨甲境: 跨一阶→DC17': '判断依据' } };
    const s2 = { ...ssot, context: { ...ssot.context, setting: { frozen: { canon: c2 }, dynamic: ssot.context.setting.dynamic } } };
    assert.deepEqual(Object.keys(buildEvolutionPack(s2, null).pack.setting), ['tension', 'env', '刻度', '刻度目录', '法则'],
        '★三块齐全时的键序：刻度 → 刻度目录 → 法则');
});


// ═══════════════ ⑨ 源码锁：分类只有一处实现（面板与进包不许各写一遍） ═══════════════
test('★leg64 源码锁：进包与面板**共用** `classifyRulesByKind`（不许各推一遍口径）', () => {
    const pack = readFileSync(new URL('../src/pack.js', import.meta.url), 'utf8');
    const render = readFileSync(new URL('../src/render.js', import.meta.url), 'utf8');
    assert.match(pack, /classifyRulesByKind\(canon\.rules, canon\.ruleKinds\)/,
        '★`buildRuleAnchor` 读那一份分堆（不许在本文件自己按 `ruleKinds` 写一遍过滤）');
    assert.match(render, /classifyRulesByKind\(canon\.rules, canon\.ruleKinds\)/,
        '★面板读**同一个函数**（leg63 那句不准确的文案就是"面板自己推一遍"的产物）');
});
