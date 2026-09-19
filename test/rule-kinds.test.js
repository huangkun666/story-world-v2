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
    sanitizeCanon, mergeCanonChunks,
    buildRosterPrompt, buildSettingOnlyPrompt,
} from '../src/abstract.js';
// ★★★leg71（丙案）：分类那一族与形状搬到新模块了——**判据改指向新家**（不搞 re-export，
//   本仓"两份复制品漂移"那条纪律：re-export 会让"它到底住哪"重新变模糊）。
//   ★三道进包上界（`RULE_PACK_*`）与类别常量同住 `abstract-tier.js`：它们是同一件事的两半
//     （"哪些法则进包" + "进包时按什么封顶"），分居两地就会各说各话。
import { classifyRule, classifyRulesByKind, keyByPrefix, pruneJunkRules, RULE_CLASSES, RULE_CLASS_STYLE, RULE_CLASS_VAR, RULE_CLASS_MISC, RULE_CLASSES_DROP, RULE_CLASS_NONE, RULE_CLASSES_PACK, RULE_PACK_TOP, RULE_PACK_STR_MAX, RULE_PACK_CHAR_TOP } from '../src/abstract-tier.js';
// ★leg74：载入期的旧账清理（文风禁令那一条）
import { migrateStyleRulesFromCanon } from '../src/settle.js';

/**
 * 只剥**注释**、留下字符串字面量（本文件⑩用它数"某个字面量在**代码**里出现几次"）。
 * ★为什么必须剥注释（本仓第 N 次复发的那条纪律）：本棒在 `pack.js` / `abstract.js` / `render.js` 的
 *   **注释**里逐字写着 `文风禁令`（留档说明"这一类已不进账"），裸扫会把**留档**算成实现
 *   ⇒ 判据红在自己的注释上（leg71 §4.1 那个洞的同款）。★而字符串**不能**剥：要数的正是那个字面量。
 */
function stripCommentsForCount(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const c2 = src[i + 1];
        if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
        if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue; }
        if (c === '"' || c === "'" || c === '`') {
            const q = c; out += c; i += 1;
            while (i < n) {
                if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
                out += src[i];
                if (src[i] === q) { i += 1; break; }
                i += 1;
            }
            continue;
        }
        out += c;
        i += 1;
    }
    return out;
}
import { RULE_CLASS_GUIDE } from '../src/abstract-shape.js';
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
    // ★★★leg74 立、leg75 推广（用户令「把这些全给我删干净了」）：`文风禁令`/`变量指令`/`其他` 三类
    //   **都不进账本** ⇒ 两列里只剩"这个世界是什么样"与"拿它能算/能判"的那两类；
    //   留下的原文**一个字不改**（仍是纯字符串数组）。
    assert.deepEqual(canon.rules, [R_JUDGE, R_WORLD],
        '★留下的原文一个字不改；三类（文风禁令/变量指令/其他）全被摘掉（见 `pruneJunkRules`）');
    assert.deepEqual(canon.ruleKinds, {
        [R_JUDGE]: '判断依据', [R_WORLD]: '世界观设定',
    }, '类别另起一格、按原文串索引；★被摘掉的那三条**连键也不留**（否则就是"键指向一条不存在的法则"）');
    for (const gone of [R_STYLE, R_SCRIPT, R_OTHER]) {
        assert.ok(!(gone in canon.ruleKinds), `★被摘掉的「${gone}」的键不许残留`);
    }
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
    const b = canonOf([R_JUDGE, R_WORLD], ['判断依据', '世界观设定']);
    const merged = mergeCanonChunks([{ canon: a }, { canon: b }]);
    // ★leg74/leg75：`R_STYLE` 在收账时就没进来（`a` 里只有 `R_JUDGE`）⇒ 并集里自然也没有它。
    assert.deepEqual(merged.canon.rules, [R_JUDGE, R_WORLD], '法则仍并集去重；★文风禁令不在并集里');
    assert.equal(merged.canon.ruleKinds[R_JUDGE], '判断依据', '★类别没在合并里丢');
    assert.equal(merged.canon.ruleKinds[R_WORLD], '世界观设定');
    assert.ok(!(R_STYLE in merged.canon.ruleKinds), '★文风禁令的键也不许在合并产物里');
});

// ═══════════════ ④ 分堆：面板与进包**读同一个函数** ═══════════════
test('★★leg64 `classifyRulesByKind`：计数 + 未标数 + 进包两类', () => {
    const all = [R_JUDGE, R_JUDGE2, R_WORLD, R_WORLD2, R_STYLE, R_SCRIPT, R_OTHER];
    const canon = canonOf(all, ['判断依据', '判断依据', '世界观设定', '世界观设定', '文风禁令', '变量指令', '其他']);
    const st = classifyRulesByKind(canon.rules, canon.ruleKinds);
    // ★leg74/leg75：账上已无那三类 ⇒ 这三格计数 **0**（★键保留：面板/判据读的是同一份形状，少一个键会让读数错位）
    assert.deepEqual(st.计数, { 判断依据: 2, 世界观设定: 2, 文风禁令: 0, 变量指令: 0, 其他: 0 });
    assert.equal(st.未标数, 0);
    assert.equal(st.判据条数, 2, '判据条数单独可读（面板要分别报）');
    assert.equal(st.世界观条数, 2, '世界观条数单独可读');
    assert.deepEqual(st.判据, [R_JUDGE, R_JUDGE2, R_WORLD, R_WORLD2],
        '★进包两类：**判据在前、世界观随后**（闸按这个序吃预算 ⇒ 判据先占，不被世界观挤走）');
    // ★leg74 立、leg75 推广的反向自证：**直接**往分堆里喂一条带这三类标注的法则 ⇒ 它仍被认成对应那一格
    //   （分堆函数**不负责**摘——摘是 `pruneJunkRules` 的活；这条自证证明"计数为 0"是**账上真没有**，
    //    而不是"分堆函数看不见这几类了"——后者会让面板与进包各说各话）
    const stRaw = classifyRulesByKind([R_STYLE, R_SCRIPT, R_OTHER], { [R_STYLE]: '文风禁令', [R_SCRIPT]: '变量指令', [R_OTHER]: '其他' });
    assert.equal(stRaw.计数.文风禁令, 1, '★反向自证：分堆函数仍认得这一类（摘除只在记账边界做）');
    assert.equal(stRaw.计数.变量指令, 1, '★反向自证：`变量指令` 也仍认得');
    assert.equal(stRaw.计数.其他, 1, '★反向自证：`其他` 也仍认得');
    assert.equal(stRaw.判据.length, 0, '★这三类本来就不进包');
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
    // ★★★leg74：用户实拍的那一屏就是这一段 ⇒ 现在**总条数不含**文风禁令、那一段**整段不再出现**。
    assert.ok(html.includes('法则（2 条'), '表头报总条数（★leg74 起不含文风禁令——它不进账）');
    assert.ok(html.includes('判断依据（1 条）'), '★判据单独一段');
    assert.ok(html.includes('世界观设定（1 条）'), '★世界观**也单独成段**（第一版它混在兜底的"其他"里）');
    assert.ok(!html.includes('文风禁令（'), '★★leg74：面板**不许**再出现「文风禁令（N 条）」那一段（用户实拍要清掉的就是它）');
    assert.ok(/其中 <b>2<\/b> 条每轮进模型的包/.test(html), '★如实报进包总条数（读的就是进包那个函数的分堆）');
    assert.ok(/<b>判断依据 1<\/b> 条/.test(html), '★两类**分开报**（合着报就看不出是谁进了包）');
    assert.ok(/<b>世界观设定 1<\/b> 条/.test(html), '★世界观那一类也要报出来');
    // ★原文一条不许少（"折起来"不等于"藏掉"，本仓纪律）—— ★leg74 例外：**被摘掉的那一类不进账，也就不在面板**
    for (const s of [R_JUDGE, R_WORLD]) assert.ok(html.includes(s), `原文「${s}」仍在产物里`);
    assert.ok(!html.includes(R_STYLE), '★★leg74：写法规矩那句原文**不许**再出现在面板上（它已不在账上）');
    // ★面板那段说明**不许再宣称**"一条不删"（leg74 起它是假的）；也不许再点名"文风禁令…留给作者看"
    assert.ok(!html.includes('一条不删'), '★★leg74："一条不删"是假的（文风禁令已被摘）⇒ 那句话不许留在面板上');
    assert.ok(html.includes('文风禁令') === false || html.includes('不在此列'),
        '★leg74：若面板仍提到"文风禁令"这四个字，必须是在说"它不在此列"（如实说明），而不是列它给你看');
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
    // ★leg69（A1）：本夹具的 30 张表 / 30 档**真的顶到了块级预算**（表 ≤16）⇒ 多出 `刻度裁掉` 这个读数键。
    //   它**缀在末尾**（加法，不动既有键的相对位置）⇒ 既有键序 `刻度 → 刻度目录 → 法则` 原样保留。
    //   ⚠这条锁的纪律照旧：**新键只许缀尾**，插在中间会动到面板与调试者按序读的那份次序。
    assert.deepEqual(Object.keys(buildEvolutionPack(s2, null).pack.setting), ['tension', 'env', '刻度', '刻度目录', '法则', '刻度裁掉'],
        '★三块齐全时的键序：刻度 → 刻度目录 → 法则 →（真丢东西时才有的）刻度裁掉');
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

// ═══════════════ ⑩ ★★★leg74：文风禁令（正文写法规矩）**不进账本** ═══════════════
// 用户实拍（设定页法则栏）：那一屏列着「文风禁令（3 条）」——`必须放在 <content> 标签内` /
//   `角色对话：（角色名）` / `旁白：直接写普通段落`——并写着"只留在这里给作者看，不进每轮包"。
// 用户令：「**我不是说不要文风禁令了吗？**」⇒ 拍板「**连账本一起清掉**」。
//
// ★先分清三层（本棒查清的现场，别混）：**每轮包**从 leg64 起就没进过它（只取判据+世界观）；
//   问题在**账本**（`canon.rules` 一直留着）与**面板**（专门开一段给作者看）。
// ★为什么不去改提示词"别抽"（**本设计的关键**）：`rules` 是未分类的纯数组、类别挂在 `判据` 一列；
//   词表一旦删掉这一类，模型会把写法规矩塞进「其他/世界观设定」⇒ **更糟**（清了不、还会混进包）。
//   ⇒ 口径：**词表留着、模型照标、记账边界确定性丢弃**（凭标注，不猜内容）。

test('★★★leg74 立 · leg75 推广：三类（文风禁令/变量指令/其他）**都不进账本**（原文与类别键都不留）', () => {
    const canon = canonOf([R_JUDGE, R_STYLE, R_SCRIPT, R_OTHER], ['判断依据', '文风禁令', '变量指令', '其他']);
    assert.deepEqual(canon.rules, [R_JUDGE], '★三类杂物的原文都不进账，只留"这个世界是什么样/拿它能算能判"的');
    for (const gone of [R_STYLE, R_SCRIPT, R_OTHER]) {
        assert.ok(!(gone in (canon.ruleKinds || {})), `★「${gone}」的类别键也不许残留（否则是"指向不存在法则的孤儿键"）`);
    }
    assert.equal(canon.ruleKinds[R_JUDGE], '判断依据', '★其余条的类别照旧挂好（摘几类不许动别类）');
    // ★两列**不许劈叉**：每一个类别键都必须指向账上真有的那条法则
    for (const k of Object.keys(canon.ruleKinds || {})) {
        assert.ok(canon.rules.includes(k), `★类别键「${k}」必须指向账上真有的法则`);
    }
    // 反向自证：不做摘除的**原样**产物必须被这条口径认出来（否则它是假绿）
    const dirty = { rules: [R_JUDGE, R_STYLE], ruleKinds: { [R_JUDGE]: '判断依据', [R_STYLE]: '文风禁令' } };
    assert.ok(Object.values(dirty.ruleKinds).includes('文风禁令'), '★反向自证：脏账确实带着这一类（判据认得出）');
    for (const gone of [R_STYLE, R_SCRIPT, R_OTHER]) {
        assert.ok(!canon.rules.includes(gone), `★而净化后的账上确实没有「${gone}」`);
    }
});

test('★★★leg74 立 · leg75 推广：**近义前缀那条继承路**不许把已废弃类别偷偷带回来（推演出的洞）', () => {
    // 病：`keyByPrefix` 的口径是"胜者认不出类别时，用互为前缀的那条兜"——
    //   若先重挂再摘、或摘了不删键，**长版（胜者）就会从被摘的短版那里继承到那个已废弃类别**
    //   ⇒ 账上出现一条"标着已废弃类别"的法则（面板/进包各说各话的来路）。
    // ★三类逐一走一遍：这不是"文风禁令"独有的洞——只要哪一类进了丢弃集，它就适用。
    for (const cls of RULE_CLASSES_DROP) {
        const short = '绝对禁止使用现代口语说法';
        const long = '绝对禁止使用现代口语说法（补）';
        const r = pruneJunkRules([short, long], { [short]: cls });
        assert.deepEqual(r.dropped, [short], `★「${cls}」带标注的那条被摘`);
        for (const s of r.rules) {
            assert.notEqual(String(r.ruleKinds[s] ?? '').trim(), cls, `★「${s}」不许继承到「${cls}」`);
        }
        for (const v of Object.values(r.ruleKinds)) {
            assert.ok(!RULE_CLASSES_DROP.includes(String(v).trim()), `★类别表里不许再有任何一条「${cls}」的值`);
        }
        // ★这条锁的语义边界（如实写清，免得下一棒误以为漏了）：**没标注**的近义长版**不猜**着删
        //   （它落"未分类"⇒ 不进包，与全仓"不猜"纪律一致）；本判据只保证它**不会继承**那个已废弃的类别。
        assert.ok(r.rules.includes(long), `★没标注的那条留在账上（不猜内容）——「${cls}」这一轮`);
        assert.equal(r.ruleKinds[long], undefined, `★但它不许带类别（尤其不许是「${cls}」）`);
    }
});

test('★★★leg75：**孤儿键**必须扫干净（键指向账上已没有的法则）——前三步挡不住它，靠最后那趟白名单收口', () => {
    // ★本棒实测出来的真缺陷（`leg75-diag-bite3d.mjs`，别以为这条是凑数的）：
    //   旧版 `pruneJunkRules` 只做到"重挂"，于是**陈旧键**有两类漏网——
    //     ① 它的值是**保留类**（`判断依据`）⇒ 第②步"只清已废弃类别"的清扫**不碰它**；
    //     ② 它**不在 `list` 里** ⇒ 第①步 `for (const s of list)` **遍历不到它**。
    //   ⇒ 账上于是留下一个"指向不存在法则的类别键"，而两列劈叉在本仓是**真缺陷**（`in`/`Object.keys` 判格）。
    //   ★为什么判据① 照不到它：那条的自证夹具里，陈旧键的值恰好是**已废弃类别**（被第②步清掉了）
    //     ⇒ 它只覆盖了两条来路里的那一条。本条锁把**另一条**补上。
    const victim = '数据库配置：安装：下载最新版本数据库';      // 用来把 `dropped.length` 顶到 > 0（否则函数在幂等闸就返回）
    const stale = '绝对禁止使用现代口语说法';                  // 陈旧键：它已不在 `rules` 里
    const survivor = '绝对禁止使用现代口语说法（补）';          // 幸存者：以陈旧键为前缀
    const r = pruneJunkRules([victim, survivor], { [victim]: '其他', [stale]: '判断依据' });
    assert.deepEqual(r.dropped, [victim], '★先确认这一轮**真的发生了摘除**（否则后面的收口代码根本执行不到）');
    assert.deepEqual(r.rules, [survivor], '★账上只剩幸存者（`victim` 被摘、`stale` 本来就不在账）');
    // ★核心断言：每一个类别键都必须指向账上真有的法则
    for (const k of Object.keys(r.ruleKinds)) {
        assert.ok(r.rules.includes(k), `★类别键「${k}」指向了一条账上**没有**的法则（孤儿键）`);
    }
    assert.ok(!(stale in r.ruleKinds), '★★陈旧键必须消失（它指向的原文早就不在账上了）');
    assert.equal(r.ruleKinds[survivor], '判断依据', '★幸存者照旧从"互为前缀"那条路拿到类别（重挂没被收口破坏）');
    // 反向自证：把这个键**留着**的产物必须被上面那条口径认出来（否则它是假绿）
    //   ★口径：孤儿 = "键不在**幸存者**名单里"（用 `survivor` 而不是 `[victim, survivor]`——
    //     本棒第一版写成后者，`victim` 于是不算孤儿 ⇒ 反向自证**当场红**，如实留档）
    const dirtyKinds = { [stale]: '判断依据', [survivor]: '判断依据' };
    const dirtyOrphan = Object.keys(dirtyKinds).filter((k) => ![survivor].includes(k));
    assert.deepEqual(dirtyOrphan, [stale], '★反向自证：脏产物确实带着那个孤儿键（判据认得出）');
});

test('★★leg74 立 · leg75 推广：摘除的三个入口都在，且**只有一处实现**（面板/进包那两条老纪律的同款）', () => {
    const tier = readFileSync(new URL('../src/abstract-tier.js', import.meta.url), 'utf8');
    const abstract = readFileSync(new URL('../src/abstract.js', import.meta.url), 'utf8');
    const settle = readFileSync(new URL('../src/settle.js', import.meta.url), 'utf8');
    // ① 唯一实现：`pruneJunkRules` 在 tier 模块里导出，且**全仓只有它这一处**出现那三个类别字面量
    assert.match(tier, /export function pruneJunkRules\(/, '★唯一实现必须导出（三个入口共用）');
    assert.match(tier, /RULE_CLASS_STYLE = '文风禁令'/, '★类别词收成常量（别处不许再写字面量）');
    assert.match(tier, /RULE_CLASS_VAR = '变量指令'/, '★`变量指令` 也收成常量');
    assert.match(tier, /RULE_CLASS_MISC = '其他'/, '★`其他` 也收成常量');
    // ★★丢弃集**只有一处定义**：`RULE_CLASSES_DROP`（三个入口读它，不许各自再写一遍这个集合）
    assert.match(tier, /export const RULE_CLASSES_DROP = \[RULE_CLASS_STYLE, RULE_CLASS_VAR, RULE_CLASS_MISC\]/,
        '★"哪几类不进账本"必须收成一处（本仓"一个数两把尺子"的老病）');
    //   ★★口径（leg75 当场修正过一次，别改回去）：**不要**拿"剥注释后数 `'其他'` 这种字面量"当"只有一处"的判据——
    //     `stripCommentsForCount` 是**按引号配对**走的，而 JSDoc 正文里会出现 ASCII 引号
    //     （`:327` 那句「错贴会让"其他"混进包」）⇒ 它把后半行当成"字符串"，这一处**留在了"代码"里**
    //     ⇒ 报出 4 处（假红：`其他` 其实只有常量那一处）。**判据必须锚在行首的 `export const` 上**。
    const declaredOnce = (name, word) => {
        const hits = stripCommentsForCount(tier).match(new RegExp(`^export const ${name} = '${word}';$`, 'gm')) || [];
        assert.equal(hits.length, 1, `★\`${name}\` 必须**恰好声明一处**（这个类别词只许有一个家）`);
    };
    declaredOnce('RULE_CLASS_STYLE', '文风禁令');
    declaredOnce('RULE_CLASS_VAR', '变量指令');
    declaredOnce('RULE_CLASS_MISC', '其他');
    //   ★其余文件的口径：**代码**里那三个词只许以**单引号字面量**出现（也就是"又写了一遍过滤逻辑"）——
    //     实测这三个文件里它们的每一次出现都在注释/中文行文里，裸词扫会**红在自己的留档上**（leg74 §4.1 同款）。
    //     ⇒ 只扫 `'文风禁令'` / `'变量指令'` / `'其他'` 这种**带引号的形态**（那才是代码里"又写一遍"的指纹）。
    const quoted = (src) => (src.match(/'(?:文风禁令|变量指令|其他)'/g) || []).length;
    for (const [name, src] of [['abstract.js', abstract], ['settle.js', settle], ['pack.js', readFileSync(new URL('../src/pack.js', import.meta.url), 'utf8')]]) {
        assert.equal(quoted(src), 0, `★${name} 的**代码**里不许出现这三个字面量（注释里留档可以）——摘除只许走 \`pruneJunkRules\``);
    }
    // ② 三个入口：收账（sanitizeCanon）/ 并集（mergeCanonChunks）/ 载入期清旧账（settle）
    //   ★计数口径（leg74 当场修正过一次）：只数**调用**（`pruneJunkRules(`），import 那一行没有括号、不算。
    assert.equal((abstract.match(/pruneJunkRules\(/g) || []).length, 2,
        '★`abstract.js` 里应是**两处调用**（收账 + 并集各一处）');
    assert.match(settle, /export function migrateStyleRulesFromCanon\(/, '★载入期的旧账清理必须在');
    assert.match(settle, /pruneJunkRules\(canon\.rules, canon\.ruleKinds\)/, '★它必须复用唯一实现（不许自己再写一遍过滤）');
    // ★★leg75：收账那一道的"摘空了"分支必须**显式删格**（与载入期那句同一条口径，别留空对象）
    assert.match(abstract, /else delete canon\.ruleKinds;/, '★收账摘空时 `ruleKinds` 这一格要**整个消失**（"空着就是空着"）');
});

test('★★★leg74 旧账清理：`migrateStyleRulesFromCanon` 幂等 · 不可变 · 留痕 · 老账零扰动', () => {
    const ssotOf = (canon) => ({
        version: 1,
        context: { world: '甲世界', setting: { frozen: { fingerprint: 'fnv1a_t', extractedAt: 'T', canon } }, dynamic: {} },
        entities: [], meta: { tick: 7 },
    });
    // ① 带三类杂物（文风禁令 + 其他）的老账 ⇒ 摘掉 + 留痕；留下来的那条一字不动
    const before = ssotOf({
        rules: [R_JUDGE, R_WORLD, R_STYLE, R_OTHER],
        ruleKinds: { [R_JUDGE]: '判断依据', [R_WORLD]: '世界观设定', [R_STYLE]: '文风禁令', [R_OTHER]: '其他' },
    });
    const after = migrateStyleRulesFromCanon(before);
    assert.notEqual(after, before, '★有可摘的 ⇒ 返回**新** ssot（不可变：不就地改）');
    assert.deepEqual(before.context.setting.frozen.canon.rules, [R_JUDGE, R_WORLD, R_STYLE, R_OTHER],
        '★★原对象**一字未动**（本仓"纯函数：输入不被修改"那条铁律）');
    assert.deepEqual(after.context.setting.frozen.canon.rules, [R_JUDGE, R_WORLD],
        '★摘掉那两类杂物；留下来的两条**原话一字不改**');
    assert.ok(!(R_STYLE in after.context.setting.frozen.canon.ruleKinds), '★类别键同步摘掉（两列不许劈叉）');
    assert.ok(!(R_OTHER in after.context.setting.frozen.canon.ruleKinds), '★`其他` 的键同步摘掉');
    assert.deepEqual(after.meta.styleRulesPurged, [R_STYLE, R_OTHER], '★★不许无声消失：摘掉的原话进 meta 留档');
    assert.equal(after.meta.styleRulesPurgedAt, 7, '★留痕时点（缺省取 tick，照 `attrsRemovedAt` 的先例）');
    // ② 幂等：再跑一次 ⇒ **原对象返回**（无可摘即不改一字）
    const again = migrateStyleRulesFromCanon(after);
    assert.equal(again, after, '★第二次跑必须原对象返回（幂等 ⇒ 载入期每次跑都不会改账一个字节）');
    // ③ 老账（**没有 `ruleKinds`**）⇒ 一个字都不改：认不出就不猜（零迁移纪律）
    const legacy = ssotOf({ rules: [R_JUDGE, R_OTHER] });
    assert.equal(migrateStyleRulesFromCanon(legacy), legacy, '★没有类别那一格 ⇒ 原对象返回（不猜、不重抽）');
    // ④ 全都是文风禁令 ⇒ 摘空之后 `ruleKinds` 这一格**要消失**（"空着就是空着"，不留空对象/undefined）
    const onlyStyle = migrateStyleRulesFromCanon(ssotOf({ rules: [R_STYLE], ruleKinds: { [R_STYLE]: '文风禁令' } }));
    const c = onlyStyle.context.setting.frozen.canon;
    assert.deepEqual(c.rules, [], '★账上一条不剩');
    assert.equal('ruleKinds' in c, false, '★★这一格必须**整个消失**（`{ruleKinds: undefined}` 那种写法会留下自有键 ⇒ `in` 判为真）');
    // ⑤ 没有 canon / 形状不对 ⇒ 原样返回，不抛
    for (const bad of [null, undefined, {}, { context: {} }, { context: { setting: {} } }]) {
        assert.equal(migrateStyleRulesFromCanon(bad), bad, '★形状不对 ⇒ 原样返回（不抛）');
    }
});

test('★leg74 立 · leg75 推广：提示词把这三类**明令不交**（抽取侧挡在门外，记账丢弃只当兜底）', () => {
    // ★★★leg75 口径变更（用户令「文风禁令我不要，**全不要**」·「给我只抽象设定和概念」）：
    //   leg74 的口径是"词表留着、**模型照标**、记账时确定性丢弃"——那是**兜底**。
    //   用户拍的那一屏证明兜底**不够**：重抽出来的账上照样有那三类（抽取侧一直在问"法则"）。
    //   ⇒ 现在**抽取侧也明令不交**（两条通道各一条硬禁令），记账边界那道丢弃闸**仍在**（双保险）。
    assert.ok(RULE_CLASS_GUIDE.some((l) => l.includes('一律不许交进')),
        '★`RULE_CLASS_GUIDE` 必须明写"这三类一律不许交进 `rules`"（抽取侧的第一道闸）');
    assert.ok(RULE_CLASS_GUIDE.some((l) => l.includes('宁可不交')),
        '★并给出口径：**宁可不交**（否则模型为了"不丢信息"硬塞进「世界观设定」⇒ 混进每轮包）');
    // ★必须**逐类点名**三类（leg74 只写"这一类"⇒ 模型不知道 `变量指令`/`其他` 同样不许交）
    assert.ok(RULE_CLASS_GUIDE.some((l) => l.includes('`文风禁令`') && l.includes('`变量指令`') && l.includes('`其他`') && l.includes('一律不许交进')),
        '★必须**逐类点名**三类都不许交（否则模型以为只有文风禁令被禁，照旧把安装说明交进 `rules`）');
    // ★旧口径不许回潮：leg74 那句"只作标记用…照实标"是**兜底时代的写法**，现在要改成"不许交"
    assert.ok(!RULE_CLASS_GUIDE.some((l) => l.includes('请**照实标')),
        '★leg74 那句"照实标"不许回潮（那是"照标再丢"的兜底口径，与"明令不交"同处会互相打架）');
    // ★词表**仍然保留**这三类（这是有意的：删掉它们，模型会把杂物塞进「世界观设定」⇒ 更糟）
    for (const cls of RULE_CLASSES_DROP) {
        assert.ok(RULE_CLASSES.includes(cls), `★类别词「${cls}」必须留着（它仍是"丢弃标记"：模型万一手滑交了，靠它认出来丢掉）`);
    }
    // ★反向自证：被丢的三类**一个都不许**出现在"进包"那一列里（进包两列 = 世界账保留的两列，天然一致）
    for (const cls of RULE_CLASSES_DROP) {
        assert.ok(!RULE_CLASSES_PACK.includes(cls), `★「${cls}」不许进包（它是被丢的那一类）`);
    }
});

test('★★★leg75：两条抽取通道的**真提示词**里都落进了硬禁令（只改形状常量不够——用户重抽走的是设定遍）', () => {
    // ★为什么这条判据必须存在（真实教训）：leg75 第一版只在 `RULE_CLASS_GUIDE` 里改口径 ⇒
    //   而**用户点的「只重抽设定」走的是 `buildSettingOnlyPrompt`**，那条通道自己还写着一句
    //   「本遍只抽设定（尺子、**法则**、格局…）」在招杂物。⇒ 判据必须咬**两条通道各自的真提示词**。
    // ★★判据口径：拿**真提示词文本**判，不拿正则抠函数体（第一版那么写，注释边界/花括号都会让它失准）。
    //   ★且比对**抹掉 markdown 记号之后**的文本——否则"加了反引号"会让判据假绿。
    const norm = (s) => String(s).replace(/[`*\"'“”「」（）()]/g, '').replace(/\s+/g, '');
    // ★两条通道的"要抽什么"清单**措辞不同**（本棒实测，别写成一个正则去套两条）：
    //   名册遍 = `这一段（本块）里有什么就抽什么：刻度 / … / 世情`；设定遍 = `本遍只抽"设定"（尺子、…）`。
    //   ★正则终点也不同：名册遍那句以 `，与名册…` 接续，设定遍那句以 `。` 收尾。
    //     ★踩过的坑：归一化把全角 `（` 抹掉了，于是 `[^）]*` **一路吞到下一个右括号**（把整篇类别说明
    //       都吃进来 ⇒ 里面当然有"法则" ⇒ 假红）。终点必须落在**句号**上。
    const CLAUSES = [
        ['名册遍 buildRosterPrompt', () => buildRosterPrompt('夹具原文', []), /有什么就抽什么[：:]刻度[^，]*/],
        ['设定遍 buildSettingOnlyPrompt', () => buildSettingOnlyPrompt('夹具原文', []), /只抽设定书里的尺子[^。]*/],
    ];
    for (const [name, build, re] of CLAUSES) {
        const n = norm(build());
        assert.ok(n.includes('硬禁令'), `★★${name} 必须带那条硬禁令（抽取侧挡在门外，别只靠记账丢弃）`);
        assert.ok(n.includes('一律不进rules'), `★${name} 的硬禁令要写明"原文里有也不要抄"`);
        // ★反向自证：把"法则"当**要抽的东西**列出来的旧文案不许回潮
        //   ★写法纪律（本棒当场踩到）：断言里**不要照抄整句**——第一版写的是
        //     `只抽设定书里的尺子法则格局`，而真句是`…尺子、判定依据与世界观设定、格局…`
        //     ⇒ 判据**永远为真**（假绿）。定稿按**不变式**判：从句里的"要抽清单"抠出来，不许含"法则"。
        const clause = n.match(re);
        assert.ok(clause, `★${name} 必须保留"要抽什么"那一句（判据要咬它）`);
        assert.ok(!clause[0].includes('法则'), `★${name} 的要抽清单里不许再出现"法则"（那正是招杂物的那句话）：${clause[0]}`);
        // ★反向自证：兜底时代的"照实标"不许回潮（它和"明令不交"同处会互相打架）
        assert.ok(!n.includes('照实标'), `★${name} 不许再写"照实标…"（那是"照标再丢"的兜底口径，与本棒的"明令不交"冲突）`);
    }
    // ★形状模板那一行的字面量**也是模型看到的**：不许再写 `法则1（原文）`（那两个字本身就在招杂物）
    const src = readFileSync(new URL('../src/abstract.js', import.meta.url), 'utf8');
    assert.ok(!src.includes("rules: ['法则1（原文）']"),
        '★`SETTING_SHAPE.rules` 的模板字面量不许再写「法则1（原文）」——它就是模型看到的示例');
});

test('★★leg74 真接线：载入期的清理必须**进落盘条件**（不许只活在页面内存）', () => {
    // ★本棒自查发现的洞（如实留档）：`loadWorld` 那个写回条件原本只看 `migrated !== hot`（=
    //   `slimLegacyCompile` 那一次），**没带上文风禁令这一次** ⇒ 只改了这一件事时**不写盘**：
    //   面板是对的（内存里已干净），但**盘上那份老账照旧带着写法规矩**（导出/换机/看账都还能看到），
    //   而紧接着那行注释写的正是"旧账清理不该只活在页面内存"。
    //   ⇒ 判据：接线层那个条件里必须**同时**出现两次比较，且两次是**不同的变量**
    //     （合成一次会让"只改了其中一件事"漏写盘）。
    const idx = readFileSync(new URL('../web/index.js', import.meta.url), 'utf8');
    const code = stripCommentsForCount(idx);   // 剥注释：本节注释里逐字写着这两个比较
    // ★★判据必须**只盯那一行写回条件**（本棒第一版拿全文正则，当场假绿/假红各一次）：
    //   全文里 `migrated1 !== migrated` 还出现在**上一行的日志**里（`if (migrated1 !== migrated) console.info(…)`）
    //   ⇒ 拿全文正则判"条件里有没有它"，日志那一行会**替它作证**（假绿）。
    //   口径：先用**唯一标识**（`loc.inherited > 0`，只有写回条件有）定位那一行，再在**那一行**上判。
    const cond = code.split('\n').find((l) => l.trim().startsWith('if (') && l.includes('loc.inherited > 0'));
    assert.ok(cond, '前置：找得到 `loadWorld` 那个写回条件行（以 `loc.inherited > 0` 定位）');
    assert.match(cond, /migrated\s*!==\s*hot/, '★`slimLegacyCompile` 那一次比较要在（两件事各算各的）');
    assert.match(cond, /migrated1\s*!==\s*migrated/, '★载入期清理的结果必须参与写回条件（否则只活在内存里）');
    // ★接线本身：那个函数必须真的被调用，且参数是上一步的产物（链式，不许中途丢掉清理结果）
    assert.match(code, /const\s+migrated1\s*=\s*migrateStyleRulesFromCanon\(migrated\)/,
        '★清理必须接在 `slimLegacyCompile` 之后（链式传下去，别把结果丢了）');
    assert.match(code, /const\s+hotWorld\s*=\s*migrated1/, '★后面所有落账都要基于**清理后**的世界');
    // 反向自证：把条件里那一项拿掉，这条口径必须认得出（否则它是假绿）
    //   ★注意只改**这一行**（全文替换会先打中日志那一行 ⇒ 那次自证是假的，本棒当场踩到）
    const broken = cond.replace(/migrated1\s*!==\s*migrated\s*\|\|\s*/, '');
    assert.ok(!/migrated1\s*!==\s*migrated/.test(broken), '★反向自证：条件里少了它，这条口径确实认得出来');
});
