// story-world-v2/test/module-layout.test.js
// ★★★leg71（**丙案** · 细案 §3.2「两个大文件的切法——按语义边界，不按行数」）：
//   `abstract.js` 的**两个零反向依赖语义簇**切出去之后的**结构判据**。
//
// 这一棒做了什么（细案 §3.2 + `leg68-recon-pending.md` §B3.3/§B3.4）：
//   · `src/abstract-shape.js` ← `SCALE_RULES` / `RULE_CLASS_GUIDE` / `SCALE_SHAPE_OBJ` / `SCALE_SHAPE_JSON`
//     （**提示词的形状**：纯数据、零依赖、被四个提示词共用）；
//   · `src/abstract-tier.js` ← 档位归一 + 法则分类（16 个符号）+ `RULE_CLASSES`/`RULE_CLASS_NONE`/
//     `RULE_CLASSES_PACK` + `RULE_PACK_TOP`/`RULE_PACK_STR_MAX`/`RULE_PACK_CHAR_TOP`。
//
// ★**为什么需要这一条判据**（不是为了好看的行数）：
//   丙案的目的写在细案里——**让消费者关系变正确**：`pack.js` 与 `render.js` 只需要
//   "尺子怎么读、法则怎么分类"，**不需要"书怎么抽"**。切完之后它们**不再 import 那个 3000 行的抽取器**取那一族。
//   这是一条**结构不变量**，而结构不变量最容易在下一棒"顺手"漂回去
//   ⇒ 必须有东西咬住它（本仓"每个不变量都得有主人"那条纪律）。
//
// ★判据形态纪律（照 `test/rule-kinds.test.js` / `test/adopt-scale-draft.test.js` 的同一把尺）：
//   ① 不许用"我在某一本书里看到的词"当判据；② 判据必须在**生产源码**上跑（不是"我以为的形状"）；
//   ③ 每条判据都要能**当场红**（下面对环检测那条附了"反向自证"，证明检测器不是空绿）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const read = (rel) => readFileSync(SRC + rel, 'utf8');

/** 从 `import { ... } from './x.js'` 里取出该文件**从某模块**取的那批符号。 */
function importedFrom(src, moduleRe) {
    const out = [];
    for (const m of src.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)'/g)) {
        if (!moduleRe.test(m[2])) continue;
        for (const raw of m[1].split(',')) {
            const n = raw.trim().split(/\s+as\s+/)[0].trim();
            if (n) out.push(n);
        }
    }
    return out;
}

/**
 * **逐字符**注释剥离器（跳过字符串/模板）。
 * ★★为什么本文件也需要它（本棒**当场踩到**的那条）：丙案① 判的是"某个符号**在不在**（定义/导出）"，
 *   而裸正则在**注释里照样命中** ⇒ 有人把 `export const SCALE_RULES …` 注释掉、改成从别处 re-export，
 *   判据照旧全绿（**正是 leg70 §4.2 记下的那个洞**）。
 *   ⇒ 与 `test/adopt-scale-draft.test.js` 的 `stripComments` 同一把尺（那份偏重"动作在不在"，这份偏重"导出在不在"）。
 */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const c2 = src[i + 1];
        if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
        if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
        if (c === '"' || c === "'") {
            const q = c; out += c; i++;
            while (i < n) {
                if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
                out += src[i];
                if (src[i] === q) { i++; break; }
                i++;
            }
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

// 切走的符号清单（**分两族**，因为两族的家不同）——本清单就是"它们该住哪"的契约
const SHAPE_SYMBOLS = ['SCALE_RULES', 'RULE_CLASS_GUIDE', 'SCALE_SHAPE_OBJ', 'SCALE_SHAPE_JSON'];
const TIER_SYMBOLS = [
    'TIER_KEY_RE', 'RANGE_LIKE', 'bracketPrefix', 'stripBrackets', 'tierKeyOfInner', 'tierKeyOf',
    'tierAxisOf', 'sameShapeKey', 'tierGroupKeyOf', 'mergeSameTierEntries', 'dedupeTiers',
    'classifyRulesByKind', 'classifyRule', 'ruleKindsFromRaw', 'keyByPrefix', 'dedupeRules',
    // ★leg74 立 · leg75 改名推广：`pruneJunkRules`（"不算世界"那三类不进账本的唯一实现）
    //   也住 `abstract-tier.js`，且 `abstract.js` 要用它
    //   ⇒ 按本文件同一条口径登记进契约（它是"规则分类族"的第五个成员，与 `classifyRulesByKind` 同源）。
    //   ★leg75：leg74 叫 `pruneStyleRules`（只丢一类）⇒ 推广到三类时一并改名，契约跟着换名。
    'pruneJunkRules',
    'RULE_CLASSES', 'RULE_CLASS_NONE', 'RULE_CLASSES_PACK',
    'RULE_PACK_TOP', 'RULE_PACK_STR_MAX', 'RULE_PACK_CHAR_TOP',
];
// ★`abstract.js` **自己还要用**的那批（= 它必须 import 回来的）。
//   `RULE_PACK_*` **不在**这一批里：它们的唯一消费者是 `pack.js` 的 `buildRuleAnchor`
//   ⇒ 切割后 `abstract.js` 不再用它们、也就不必 import（这正是"消费者关系变正确"的一个具体表现）。
//   ★本棒实测更正：我第一版把 `RULE_PACK_*` 也写进了"必须 import 回来"⇒ 判据当场红（实为 __ 处），
//     如实留档（设计稿与现实不一致时，以**实测**为准并改判据）。
const NEEDED_BACK = [...SHAPE_SYMBOLS, ...TIER_SYMBOLS.filter((n) => !n.startsWith('RULE_PACK_'))];

// ─────────────────── ① 搬家结果：符号只在**新家**定义，旧家不再定义 ───────────────────

test('★★leg71 丙案①：那一族符号在新家**定义**、在旧家**不再定义**（防止"搬了但旧家还留一份"）', () => {
    const shape = stripComments(read('abstract-shape.js'));
    const tier = stripComments(read('abstract-tier.js'));
    const abstract = stripComments(read('abstract.js'));

    for (const n of SHAPE_SYMBOLS) {
        assert.match(shape, new RegExp(`export\\s+const\\s+${n}\\b`), `★\`${n}\` 必须在 \`abstract-shape.js\` 里导出`);
        assert.ok(!new RegExp(`export\\s+const\\s+${n}\\b`).test(abstract), `★\`${n}\` **不许**还在 \`abstract.js\` 里定义（那就是两份复制品）`);
    }
    for (const n of TIER_SYMBOLS) {
        assert.match(tier, new RegExp(`export\\s+(?:const|function)\\s+${n}\\b`), `★\`${n}\` 必须在 \`abstract-tier.js\` 里导出`);
        assert.ok(!new RegExp(`export\\s+(?:const|function)\\s+${n}\\b`).test(abstract), `★\`${n}\` **不许**还在 \`abstract.js\` 里定义`);
    }
    // ★反向自证（本棒第一版写错了这一条，如实留档）：裸正则在**注释里照样命中**——
    //   所以上面那几条必须先剥注释，否则"把 export 注释掉、改成从别处取"能骗过判据（leg70 §4.2 的洞）。
    const COMMENTED = '// export const SCALE_RULES = [];';
    assert.ok(new RegExp('export\\s+const\\s+SCALE_RULES\\b').test(COMMENTED),
        '★反向自证（第 1 半）：**裸正则**确实会命中注释里的那行 —— 这就是为什么必须剥注释');
    assert.ok(!new RegExp('export\\s+const\\s+SCALE_RULES\\b').test(stripComments(COMMENTED)),
        '★反向自证（第 2 半）：剥注释之后，被注释掉的导出**不再命中**（判据这才真的防得住）');
    // 剥离器自证：它真的在干活（不是原样返回）
    assert.ok(stripComments(COMMENTED).trim() === '', '★剥离器自证：整行注释剥完应当什么都不剩');
    assert.ok(stripComments('const a = "// 不是注释";').includes('不是注释'),
        '★剥离器自证：字符串里的 `//` 不许被当注释剥掉（本仓 leg69 §4.5"掩码把要找的代码一起抹了"的反面）');
});

test('★leg71 丙案②：`abstract.js` 把**它还要用的**那批 import 回来（不许留副本、也不许改调用点）', () => {
    const abstract = read('abstract.js');
    const fromShape = importedFrom(abstract, /abstract-shape\.js$/);
    const fromTier = importedFrom(abstract, /abstract-tier\.js$/);
    for (const n of SHAPE_SYMBOLS) assert.ok(fromShape.includes(n), `★\`abstract.js\` 必须从 shape 模块 import \`${n}\``);
    for (const n of NEEDED_BACK.filter((n) => !SHAPE_SYMBOLS.includes(n))) {
        assert.ok(fromTier.includes(n), `★\`abstract.js\` 必须从 tier 模块 import \`${n}\``);
    }
    // ★`RULE_PACK_*` **不该**被 import 回来（切割后 `abstract.js` 不用它们了）——
    //   若哪天它们又出现在 `abstract.js` 的 import 里，说明"抽取器又开始管进包上界了"，那是倒退。
    const packConsts = TIER_SYMBOLS.filter((n) => n.startsWith('RULE_PACK_'));
    const leaked = [...fromShape, ...fromTier].filter((n) => packConsts.includes(n));
    assert.deepEqual(leaked, [], `★\`RULE_PACK_*\` 不该被 import 回抽取器（它唯一的消费者是 pack.js）：${leaked.join(', ')}`);
    // 集合**不多不少**：多一个就是"顺手把别的东西也拖回来了"
    assert.deepEqual([...fromShape, ...fromTier].sort(), NEEDED_BACK.slice().sort(),
        '★`abstract.js` 从两个新模块取回的符号集合 = 契约清单（不多不少）');
});

// ─────────────────── ② 消费者关系（丙案的**目的**，不是副作用） ───────────────────

test('★★leg71 丙案③：`pack.js` / `render.js` **不再从抽取器取那一族**（丙案要的就是这个）', () => {
    const moved = new Set([...SHAPE_SYMBOLS, ...TIER_SYMBOLS]);
    for (const f of ['pack.js', 'render.js']) {
        const src = read(f);
        const stillFromAbstract = importedFrom(src, /(^|\/)abstract\.js$/).filter((n) => moved.has(n));
        assert.deepEqual(stillFromAbstract, [],
            `★\`${f}\` 仍从 \`abstract.js\`（抽取器）取【${stillFromAbstract.join(', ')}】——它们已经搬到 shape/tier 了`);
        // 而且必须真的从新家取了（否则"不再取"可能是因为**压根没用**，那是另一种病）
        const fromTier = importedFrom(src, /abstract-tier\.js$/);
        const fromShape = importedFrom(src, /abstract-shape\.js$/);
        assert.ok([...fromTier, ...fromShape].length > 0, `★\`${f}\` 必须从新模块取它要的那一族（本棒之后它一个都没取 ⇒ 接线断了）`);
    }
    // ★两个文件的取法还要**指名**（照 leg64 的"同一个函数"口径：面板与进包不许各有一套分类）
    const packTier = importedFrom(read('pack.js'), /abstract-tier\.js$/);
    const renderTier = importedFrom(read('render.js'), /abstract-tier\.js$/);
    assert.ok(packTier.includes('classifyRulesByKind'), '★进包侧从 tier 取 `classifyRulesByKind`');
    assert.ok(renderTier.includes('classifyRulesByKind'), '★面板侧从 tier 取**同一个** `classifyRulesByKind`（一处口径）');
    assert.ok(renderTier.includes('RULE_CLASSES') && renderTier.includes('RULE_CLASSES_PACK'),
        '★面板读类别词表的**真源**（不另抄一份数组）');
});

// ─────────────────── ③ 方向单向 + 无新环（结构不变量的守卫） ───────────────────

test('★★leg71 丙案④：新模块**不许反向 import** `abstract.js`（单向 ⇒ 不可能成环）', () => {
    for (const f of ['abstract-shape.js', 'abstract-tier.js']) {
        const src = read(f);
        const back = [...src.matchAll(/from\s*'([^']*abstract\.js)'/g)].map((m) => m[1]);
        assert.deepEqual(back, [], `★\`${f}\` 反向 import 了抽取器（${back.join(',')}）——那就是循环依赖`);
    }
    // shape 是叶子：零 import（照本仓 `ref-rules.js` 那条纪律）
    assert.deepEqual(importedFrom(read('abstract-shape.js'), /./), [],
        '★`abstract-shape.js` 必须零 import（纯数据叶子）');
    // ★tier 也是叶子（零 import）——**本棒实测更正**：`RULE_CLASS_GUIDE`（形状那一族）是**物理搬进 tier 块**
    //   的（它本来就是那一块的成员），所以 tier **不需要** import shape。
    //   ⇒ 两个新模块都是叶子；依赖方向只有一条：`abstract.js → {shape, tier}`。
    //   （我在设计稿里先写成"tier → shape"，落地时被这条判据当场纠正 —— 如实留档。）
    assert.deepEqual([...read('abstract-tier.js').matchAll(/from\s*'([^']+)'/g)].map((m) => m[1]), [],
        '★`abstract-tier.js` 必须零 import（它引用的三个类别常量随它一起搬过来了）');
    assert.deepEqual(importedFrom(read('abstract.js'), /abstract-(shape|tier)\.js$/).sort(),
        NEEDED_BACK.slice().sort(),
        '★`abstract.js` 从两个新模块 import 的符号集合 = 上面那条契约清单（不多不少）');
});

/** 建全 src 的 import 图（只认相对 import；跳过"解析到自己"的假自环）。 */
function importGraph() {
    const files = readdirSync(SRC).filter((f) => f.endsWith('.js'))
        .concat(existsSync(SRC + 'schemas') ? readdirSync(SRC + 'schemas').filter((f) => f.endsWith('.js')).map((f) => 'schemas/' + f) : []);
    const edges = new Map();
    for (const f of files) {
        const src = readFileSync(SRC + f, 'utf8');
        const out = [...src.matchAll(/from\s+'(\.[^']+)'/g)].map((m) => m[1])
            .map((p) => p.replace(/^\.\//, '').replace(/^\.\.\//, '').replace(/^\.\.\/src\//, ''))
            .map((p) => (p.endsWith('.js') ? p : p + '.js'))
            .filter((p) => p !== f);
        edges.set(f, [...new Set(out)]);
    }
    return { files, edges };
}

/** 环检测（DFS 着色）。 */
function findCycles(edges) {
    const state = new Map();
    const cycles = new Set();
    function visit(n, stack) {
        if (state.get(n) === 'done') return;
        if (state.get(n) === 'open') { cycles.add([...stack.slice(stack.indexOf(n)), n].join(' → ')); return; }
        state.set(n, 'open');
        for (const m of edges.get(n) || []) if (edges.has(m)) visit(m, [...stack, n]);
        state.set(n, 'done');
    }
    for (const f of edges.keys()) visit(f, []);
    return [...cycles];
}

// ★基线（leg71 切割**之前**实测，HEAD = leg69 那棵树跑同一份装置）：**4 条环，全是既有的**。
//   ★为什么要把既有环写进判据而不是"要求零环"：它们是别的模块的历史包袱，**本棒不动它们**
//     （细案"一棒只做一格"）。把它们列出来 = "本棒**没有**引入新环"这件事可复核；
//     而"要求零环"会让这条判据当场红在**与我无关**的地方（本仓 leg69 §4.4 那次"收紧过头会自伤"的教训）。
const BASELINE_CYCLES = [
    'check-step.js → position.js → check-step.js',
    'check-step.js → position.js → settle.js → check-step.js',
    'position.js → settle.js → position.js',
    'settle.js → limits.js → settle.js',
];

test('★★leg71 丙案⑤：切割**没有引入新环**（与基线逐条对齐；多一条就是新病）', () => {
    const { files, edges } = importGraph();
    const cycles = findCycles(edges);
    const extra = cycles.filter((c) => !BASELINE_CYCLES.includes(c));
    const gone = BASELINE_CYCLES.filter((c) => !cycles.includes(c));
    assert.deepEqual(extra, [], `★出现了新的 import 环（本棒造的）：${extra.join(' ｜ ')}`);
    assert.deepEqual(gone, [], `★基线里的环消失了（${gone.join(' ｜ ')}）——那是别的事变了，与本棒无关，请核实后更新基线`);
    //   ★★★leg85 同步（丙案 · `src/render.js` 第一个切口）：`src/render-base.js`（渲染层共用底，
    //     11 个公有口）是本棒新增的第 44 个模块。★口径没放宽：本条仍然是"**模块数只许在
    //     明确记账的前提下变**"——加一个文件就要在这里改一次数并写清是谁加的，防"顺手多切一个"。
    //   ★★★leg89 同步（标签提取 · 设计 `docs/spec-tagged-actions-extraction.md`）：`src/tag-extract.js`
    //     是本棒新增的第 45 个模块——它把"聊天模型正文里的标签"切成结构化的本轮事实
    //     （纯函数、**零 import**，是叶子 ⇒ 本棒的环检测基线一条未动，见上一条断言）。
    //   ★★★leg94 同步（「说书」视图 · 用户令「我看不懂，还要你给我讲解」）：`src/panorama.js`
    //     是本棒新增的第 46 个模块——把账上的字重排成人话（**零 LLM**）。
    //     ★它的 import 面**只有一条边**：`render.js → panorama.js`（同 `render.js → chain.js` 那种
    //     "渲染层调一个自渲染的纯模块"），而 `panorama.js` **不 import 任何东西**（真叶子）
    //     ⇒ 环基线照旧一条未动（见上一条断言；这里是"加模块但没加环"的第二个先例）。
    assert.equal(files.length, 46, `★src 模块数 = 46（leg71 新增 2 个：shape 与 tier；★leg85 新增 1 个：render-base；★leg89 新增 1 个：tag-extract；★leg94 新增 1 个：panorama）；实为 ${files.length} ⇒ 有人加了/删了模块，请同步本判据`);
});

test('★leg71 丙案⑥：环检测器**不是空绿**（反向自证：塞一个真环进去，它必须报出来）', () => {
    const fake = new Map([['a.js', ['b.js']], ['b.js', ['a.js']]]);
    const got = findCycles(fake);
    assert.equal(got.length, 1, '★检测器对"a→b→a"必须报 1 条环');
    assert.equal(got[0], 'a.js → b.js → a.js', '★且报出的路径要能读');
    // 自环那种假阳性必须不报（`../src/position.js` 被 normalize 成 `position.js` 的老问题）
    assert.deepEqual(findCycles(new Map([['x.js', []]])), [], '★无环图必须报 0 条');
});
