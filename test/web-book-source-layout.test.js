// story-world-v2/test/web-book-source-layout.test.js
// ★★★leg80（**丙-web · 第五格**）：`web/index.js` 的**取书族**搬进 `web/book-source.js` 之后的**结构判据**。
//
// 这一棒做了什么（细案 §3.2「按语义边界切、一次切一族」的**第五格**）：
//   `web/book-source.js` ← ST 卡读取（世界信息名 / 卡内置书条目）+ ST ctx 取书（三条来源合并去重 + 卡选择）
//   + 取书缓存（三态语义）+ 三个消费者口 + 文本定位三档（`locateNameLine` / `locateNameSnippet` / `bookEntryText`）。
//
// ★**为什么需要这一条判据**（不是为了好看的行数）：
//   ① 这一族此前散在 3079 行接线层的**三个位置**（第 957 / 986 / 1199 行起），
//      而 `autoComposeSource` 与 `diagExtract` 那一大段（150 行）**正夹在中间** ⇒ 与 leg78 热账族/leg79 视图态族
//      同款，**不是一整块**（本棒量出来的空隙见 `leg80-extract-parts.mjs`）。
//   ② ★★★本族**特有的形态**（下面第 ② 条咬它）：它**不吃 `window`**，而是**把 ctx 当形参收**——
//      因为"名号定位"那三档是纯字符串函数，本该在 Node 里被直接真测。唯一例外是 `bookEntriesForInherit()`：
//      它**保持零参**（外部测试按零参用它），内部走**注入进来的 `getCtx` 函数**。
//   ③ ★★本族真正的**承重墙**是取书的**三态语义**（"读不到"≠"书里没有"）：
//      旧法失败时 `return []`，与"书里没有"同形 ⇒ 引擎把读不到书记成「书未明述」并**永久锁死**该栏。
//      实测代价：用户真账 563 实体、`location` 占位值「未明」563。⇒ 判据第 ⑤ 条拿**真跑**钉住它。
//
// ★判据形态纪律（照 `web-memory-layout` / `web-snapshot-layout` / `web-hot-ledger-layout` / `web-view-state-layout`
//   同一把尺）：① 一律跑在**剥注释后的源码**上（leg71 §4.1：留痕注释里就写着这些符号名）；
//   ② 每条判据都要能**当场红**（关键几条自带反向自证）；③ 不许用"我在某一本书里看到的词"当判据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
// ★本文件第 ⑤ 条要**真跑**（不是读源码）：三态语义只有真喂 ctx 才看得见。
import * as bookSource from '../web/book-source.js';

const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

/** 逐字符注释剥离器（跳过字符串/模板）。★本文件必须有它：留档注释里就写着这些符号名。 */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const c2 = src[i + 1];
        if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
        if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
        if (c === '"' || c === "'" || c === '`') {
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

// 这一族的清单（★"搬走了"与"还在"都按这张表判——一处真源，免得两边漂）
const FAMILY_FN = ['characterWorldNames', 'characterBookEntries', 'collectWorldInfoEntries', 'pickCharacter',
    'resetBookCache', 'setCtxSource', 'bookEntriesForInherit', 'bookTextForRoots', 'locateNameLine',
    'locateNameSnippet', 'bookEntryText', 'bookTextForEntity'];
const FAMILY_STATE = ['sw2BookCache'];
// ★接线层**仍然要够得到**的口（= 外部消费者从 `web/index.js` 取的那些；清单是**算出来的**，不是猜的）：
//   `test/lookup-batch.test.js` + `test/player-wiring.test.js` → characterWorldNames / characterBookEntries / 三档定位口
//   `test/location-inherit-wiring.test.js`                    → bookEntriesForInherit
const REEXPORTED = ['characterWorldNames', 'characterBookEntries', 'bookEntriesForInherit', 'resetBookCache',
    'locateNameLine', 'locateNameSnippet', 'bookEntryText'];

// ─────────────────── ① 符号只有一个家 ───────────────────

test('★★leg80 丙-web①：族内符号**只在新家定义**，旧家代码里一个实现都不许剩', () => {
    const bs = stripComments(read('web/book-source.js'));
    const index = stripComments(read('web/index.js'));
    // 新家：每个函数必须**恰好一处**定义
    for (const n of FAMILY_FN) {
        assert.equal((bs.match(new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${n}\\s*\\(`, 'gm')) || []).length, 1,
            `★\`${n}\` 必须只住新家**恰好一处**定义`);
    }
    // 新家：类级缓存状态恰好一处 `let`（它是"按会话缓存"的，必须可重置）
    assert.equal((bs.match(/^let\s+sw2BookCache\s*=/gm) || []).length, 1,
        '★`sw2BookCache` 必须只住新家**恰好一处** `let` 定义（loadWorld 时要能清）');
    // ★★旧家**代码里**一个都不许剩（注释里可以留档）
    for (const n of [...FAMILY_FN, ...FAMILY_STATE]) {
        const decl = new RegExp(`(?:function\\s+${n}\\s*\\(|(?:let|const|var)\\s+${n}\\s*=)`);
        assert.ok(!decl.test(index),
            `★★\`web/index.js\` 的**代码**里不许再出现 \`${n}\` 的**定义**（注释里可以留档；`
            + '★leg72 漏了块外直接读写 ⇒ 搬完当场 `ReferenceError`；leg78 的 `sw2FlushTimeoutMs`、'
            + 'leg79 的视图对象同款 —— 这是第四次）');
    }
    // ★反向自证：裸正则在**注释里照样命中** ⇒ 必须先剥注释，否则"把定义注释掉"能骗过判据
    assert.ok(!new RegExp(`function\\s+${FAMILY_FN[0]}\\s*\\(`).test(stripComments('// function characterWorldNames(c) 的说明')),
        '★反向自证：注释里提到函数名不算"代码里有定义"（否则留档就把判据自己搞红）');
    assert.equal((stripComments('export function characterWorldNames(character) {').match(/^(?:export\s+)?(?:async\s+)?function\s+characterWorldNames\s*\(/gm) || []).length, 1,
        '★反向自证：真定义必须被认作定义（否则上面那条是空绿）');
});

// ─────────────────── ② 方向单向 + 本族特有的"ctx 当形参" ───────────────────

test('★★leg80 丙-web②：新模块只许 import `../src/init-source.js`，且**不许碰 window**', () => {
    const bs = read('web/book-source.js');
    const code = stripComments(bs);
    const imports = [...code.matchAll(/^\s*import\s.+$/gm)].map((m) => m[0].trim());
    assert.equal(imports.length, 1, `★\`web/book-source.js\` 只许有一条 import；实际 ${imports.length} 条：${imports.join(' | ')}`);
    assert.match(imports[0], /^import \{ normalizeEntryKey \} from '\.\.\/src\/init-source\.js';/,
        '★唯一那条 import 必须是"条目指纹的键归一"（与起根同一份契约）');
    assert.ok(!/from\s*'\.\/index\.js'/.test(code), '★不许反向 import 接线层（那就是循环依赖）');
    assert.ok(!/from\s*'\.\/idb-backend\.js'/.test(code), '★不许 import 浏览器侧适配层（本模块要能在 Node 里直接导入）');
    // ★★★本族特有的形态：不吃 `window`，ctx 一律当形参收（唯一例外见下一条）
    assert.ok(!/\bwindow\b/.test(code),
        '★★★新模块**不许出现 `window`**——它要能在 Node 里直接导入，纯函数（三档定位）才好真测');
    assert.ok(!/\bdocument\b/.test(code), '★★新模块不许碰 DOM（它是纯取书层，不是适配层）');
    // ★三种"吃 ctx"的形状都必须在（形状是本族的设计，不是巧合）
    assert.match(code, /export async function collectWorldInfoEntries\(ctx, character\)/,
        '★`collectWorldInfoEntries` 收 (ctx, character) 形参');
    assert.match(code, /export function pickCharacter\(ctx\)/, '★`pickCharacter(ctx)` 收形参');
    assert.match(code, /async function worldBookCached\(ctx\)/, '★私有的 `worldBookCached(ctx)` 也收形参');
    // ★反向自证：这一段**真的**在判 window（拿一段带 window 的文本喂进去必须被抓）
    assert.ok(/\bwindow\b/.test(stripComments('const x = window.SillyTavern;')), '★反向自证：window 检测器真的会咬');
});

test('★★leg80 丙-web③：零参那一口（`bookEntriesForInherit`）走**注入的取数函数**，且注入的是函数不是值', () => {
    const code = stripComments(read('web/book-source.js'));
    // ★为什么它零参：外面真有消费者按零参用它（`test/location-inherit-wiring.test.js` 装好 fake ctx 直接调）
    //   ⇒ "签名与语义一个字不改"是本棒的验收口径。
    assert.match(code, /export async function bookEntriesForInherit\(\)/, '★这一口必须**零参**（外部契约不变）');
    assert.match(code, /let getCtx = \(\) => null;/,
        '★私有的 `getCtx` 是**可换绑的模块级 `let`**，初值是"没有上下文"的安全默认');
    assert.match(code, /export function setCtxSource\(fn\) \{ if \(typeof fn === 'function'\) getCtx = fn; \}/,
        '★注入口必须**只收函数**（收值会把上下文冻在建模块那一刻 —— leg73 TDZ / leg79"不许抓死"同一条纪律）');
    assert.match(code, /await worldBookCached\(getCtx\(\)\)/, '★零参那一口内部**现取** ctx（不是抓死一份）');
    // 接线层必须真的注入了（"建了注入口但没人用"= leg25f 那条病历的同款）
    const index = stripComments(read('web/index.js'));
    assert.match(index, /setCtxSource\(getCtx\);/, '★接线层必须真的把 `getCtx` 注进去（判据咬"注入口有人用"）');
    // ★顺序铁律：注入必须发生在**模块顶层同步区**（`getCtx` 是函数声明、已提升）
    const idxFn = index.indexOf('function getCtx()');
    const idxSet = index.indexOf('setCtxSource(getCtx);');
    assert.ok(idxFn > 0 && idxSet > idxFn, '★`setCtxSource(getCtx)` 必须排在 `getCtx` 定义之后');
    const between = index.slice(idxFn, idxSet);
    assert.ok(!/\bexport function setup|\bexport async function on\w+\(/.test(between),
        '★注入不许拖到某个入口函数里（那样"装好 fake ctx 直接调取书口"的测试会先跑 ⇒ 静默拿到空书）');
});

// ─────────────────── ③ 旧家仍然是门面（再导出 = 转交，不是第二份实现） ───────────────────

test('★★leg80 丙-web④：接线层**再导出**那几个口（外部 import 零改动），且**不许**再导出内部件', () => {
    const code = stripComments(read('web/index.js'));
    const m = /export \{([^}]*)\};/.exec(code);
    assert.ok(m, '★接线层必须有一条 `export { ... }`（把搬走的口转交出去）');
    const names = m[1].split(',').map((x) => x.trim()).filter(Boolean);
    // ★清单**逐项**对（多一个 = 把内部件也漏出去了；少一个 = 外部 import 当场 SyntaxError）
    assert.deepEqual([...names].sort(), [...REEXPORTED].sort(),
        `★再导出的清单必须**不多不少**；实际 ${names.join(' ')}`);
    // 被搬走但**不该**再导出的（只有族内自己用 / 只有接线层自己用）
    for (const n of ['characterBookEntries']) {
        void n;   // ★`characterBookEntries` **在**清单里（两个测试文件从旧家取它）⇒ 这里不列入禁项
    }
    for (const n of ['collectWorldInfoEntries', 'pickCharacter', 'bookTextForEntity', 'setCtxSource']) {
        assert.ok(!names.includes(n),
            `★\`${n}\` **不该**再导出（它要么只被族内用、要么只被接线层自己用 —— 导出面 = 契约面，不许顺手放大）`);
    }
    // ★转交的两个半边都要在：① 从新家 import ② 再导出
    const imported = /import \{([^}]*)\} from '\.\/book-source\.js';/.exec(code);
    assert.ok(imported, '★接线层必须从新家 import 这一族');
    for (const n of REEXPORTED) {
        assert.ok(imported[1].includes(n), `★\`${n}\` 必须在接线层的 import 清单里（否则再导出会 SyntaxError）`);
    }
    // ★反向自证：清单判据真的在判（换掉一个名字必须不等）
    assert.notDeepEqual([...names].sort(), [...REEXPORTED, 'setCtxSource'].sort(), '★反向自证：多一个就必须不等');
});

// ─────────────────── ④ 搬过来的东西**逐字节**没被改写 ───────────────────

test('★★leg80 丙-web⑤：三段搬过来的代码**逐字节**在新家（本棒只动"它住哪"，不动逻辑）', () => {
    const bs = read('web/book-source.js');
    // ★取几处**有分量**的原文（含中文注释与正则字面量）逐字节比对——它们最容易被"手抄"改坏
    const MUST_BE_BYTE_IDENTICAL = [
        // 三态语义那段注释（承重墙的说明）
        '//   `{ ok: false }`           = **书没读到**（取书炸了/一本都没取到）→ 调用方**不写任何痕迹**，下轮再试',
        // 三档定位的 EXPAND 常量与边界优先级注释
        '    const EXPAND = 160;   // 名号前后各取多少字符（够一句上下文，又不至于把整条灌进 prompt）',
        // 取书失败的三态返回（不是 `return []`）
        '        console.warn(\'[story-world-v2] 查书：取书失败（**不是"书里没有"**，不写任何痕迹，下轮再试）\', String(err?.message || err));',
        // 三条来源合并里那句"卡内置书先收"
        '    for (const e of characterBookEntries(character)) addEntry(e);   // 卡内置书：不花 loadWorldInfo，先收',
    ];
    for (const L of MUST_BE_BYTE_IDENTICAL) {
        assert.ok(bs.includes(L), `★这一行必须在新家里**逐字节**存在：${L.slice(0, 70)}`);
    }
    // ★★行首定位那条正则：**不整行重打**（它正文里同时有反引号、`\s`、`\(`、`${…}`——在测试里重打
    //   必须再过一层 JS 转义，稍不留神就写成"比我自己拼的串"= 假自证；而"从文件里抠出来再比它自己"
    //   更是**恒真**的废判据，本棒第一版就写成了那样，当场自己判掉）。
    //   ⇒ 定稿：咬它的**可辨识要件**（每个片段都是这段逻辑承重的地方，少一个就是被改过）：
    //     ① `escapeRegExp(nm)` —— 名号进正则前必须转义（手写忘了 ⇒ 名号里的 `(` 会把正则搞坏）
    //     ② 行首锚 `^[-*·•\s]*` —— 只认行首（防段落里提及被抓成"该名号自己那一行"）
    //     ③ `[：:]` 与 `\(` —— 冒号或圆括号属性两种标签形态
    //     ④ 只取到行尾 `[^\n]*`
    const code = stripComments(bs);
    const reLine = (code.match(/^ {4}const re = new RegExp\(.*$/m) || [''])[0];
    assert.ok(reLine.length > 0, '★定位正则那一行必须还在（不许整行搬没了）');
    for (const frag of ['escapeRegExp(nm)', '^[-*·•', '[：:]', '\\(']) {
        assert.ok(reLine.includes(frag), `★定位正则必须保住这一片段：${frag}\n  实际：${reLine}`);
    }
    // ★反向自证：把 `escapeRegExp(nm)` 抽掉（换成裸 `${nm}`）必须被上面那条咬住（否则它是空绿）
    assert.ok(!reLine.replace('escapeRegExp(nm)', 'nm').includes('escapeRegExp(nm)'),
        '★反向自证：抽掉转义口后该片段判定必须为假（证明它在真判内容，不是恒真）');
    // ★反向自证：改成"白名单式存在性"就会假绿 ⇒ 拿一行**不该在**的文本喂进去必须为假
    assert.ok(!bs.includes('        if (!book?.readable) return [];          // 书没挂载/读不到 ⇒ 结构推断没得依据（≠ 书里没有）X'),
        '★反向自证：包含判定真的在比内容（不是恒真）');
});

// ─────────────────── ⑤ ★真跑：三态语义（"读不到"≠"书里没有"）+ 端到端 ───────────────────

test('★★★leg80 丙-web⑥：真跑一遍——三态语义成立（读不到 ≠ 书里没有）+ 合并去重 + 三档定位', async () => {
    // ★★★本条的**为什么**：这一族真正会伤人的地方不是"代码在哪"，而是**把两种空当成一种**。
    //   旧法失败时 `return []` ⇒ 引擎把"读不到书"记成「书未明述」并永久锁死（用户真账 563 实体全「未明」）。
    //   ⇒ 必须**真喂 ctx** 跑一遍，而不是在源码里找字符串。
    bookSource.resetBookCache();

    // ① 书读到了：三态是 `{ ok: true, entries: [...] }`
    // ★夹具纪律：条目名就是名号（`bookTextForEntity` 按 comment/key 命中，再按名号定位那一行）
    const cardBook = {
        entries: [
            { keys: ['昆仑道宫'], comment: '昆仑道宫', content: '- 清玄真人 (男, T7合体中期): 掌教。' },
            { key: '万法阁', comment: '万法阁', content: '- 公输巧 (男, T4金丹后期): 阁主。' },
            { keys: ['清玄真人'], comment: '清玄真人', content: '- 清玄真人 (男, T7合体中期, 昆仑道宫掌教): 坐镇玉虚秘境。' },
        ],
    };
    const character = { name: '大荒z', data: { extensions: { world: '大荒' }, character_book: cardBook }, character_book: cardBook };
    const ctx = { character, characters: [character], characterId: 0, extensionSettings: {}, chatMetadata: {} };
    bookSource.resetBookCache();
    const hit = await bookSource.bookTextForEntity({ name: '清玄真人' }, ctx);
    assert.equal(hit.ok, true, '★书读到了 ⇒ `ok: true`（"书里没有"是 ok 为真、entries 为空，**另一态**）');
    assert.ok(hit.entries.length >= 1, '★命中条目必须交出来');
    assert.equal(hit.entries[0].located, 'line', '★名号自己那一行必须被定位到（line 档）');

    // ② "书里没有"这一态：ok 为真、entries 为空 —— 与 ① 必须**分形**
    bookSource.resetBookCache();
    const missing = await bookSource.bookTextForEntity({ name: '查无此人' }, ctx);
    assert.equal(missing.ok, true, '★★"书里没有"仍然是 `ok: true`（书是读到了的）——这一态绝不能被当成"读不到"');
    assert.deepEqual(missing.entries, [], '★条目为空（书里真没有这个人）');

    // ③ **"读不到"这一态**：这条路取不到书 ⇒ `ok: false`（★调用方据此**不写任何痕迹**）
    //   ★夹具用"书没挂载"这一条真语义（`{ readable: false }`），不伪造异常：
    //     `worldBookCached` 的失败分支会把异常吞成 `[]` 条目，那是**另一条**路（下一段的 `readable` 为假）。
    bookSource.resetBookCache();
    const noBookChar = { name: '无书卡', data: {}, character_book: null };
    const broken = await bookSource.bookTextForEntity({ name: '清玄真人' }, {
        character: noBookChar, characters: [noBookChar], characterId: 0, extensionSettings: {}, chatMetadata: {},
    });
    assert.equal(broken.ok, false, '★★★一本都没读到必须是 `ok: false`（与"书里没有"**分形**）——'
        + '旧法在这里 `return []`，与"书里没有"同形 ⇒ 引擎记「书未明述」并永久锁死该栏（用户真账 563 实体全「未明」）');

    // ④ 三条来源合并 + 按"键+正文"指纹去重（同一本书被两条路取到只算一次）
    bookSource.resetBookCache();
    const dup = await bookSource.collectWorldInfoEntries({
        characterId: 0,
        characters: [character],
        extensionSettings: { world_info: { globalSelect: ['大荒'] } },
        chatMetadata: {},
        loadWorldInfo: async () => ({ entries: [{ key: ['昆仑道宫'], comment: '昆仑道宫', content: '- 清玄真人 (男, T7合体中期): 掌教。' }] }),
    }, character);
    assert.equal(dup.entries.length, 3, `★卡内置书 3 条 + 同名书 1 条（与卡那条同指纹）⇒ 去重后仍是 3（实际 ${dup.entries.length}）`);
    assert.equal(dup.readable, true, '★读到书 ⇒ readable 为真');

    // ⑤ 三档定位：line > snippet > none（纯函数，无 ctx）
    const line = bookSource.bookEntryText('- 吞天妖王 (男, T8大乘中期): 北荒现身。', '吞天妖王');
    assert.equal(line.located, 'line', '★行首形态 ⇒ line 档');
    const snip = bookSource.bookEntryText('前文很长。吞天妖王于北荒现身，气息T8大乘中期。后文也很长。', '吞天妖王');
    assert.equal(snip.located, 'snippet', '★段落里提及 ⇒ snippet 档（★必须带上「气息T8大乘中期」：先句读后逗号那条边界纪律）');
    assert.ok(snip.text.includes('T8大乘中期'), '★★句读优先那条边界纪律：逗号不能截断紧跟其后的档位原话（截断了 ⇒ 假的「书未明述」）');
    const none = bookSource.bookEntryText('整条都与名号无关的正文。', '查无此人', 5);
    assert.equal(none.located, 'none', '★定位不到 ⇒ none 档（整条截断到 cap）');
    assert.equal(none.text.length, 5, '★none 档必须**如实**截到 cap');
});

// ─────────────────── ⑥ 初始化那一次：另起进程量（leg79 §3 坑③ 的硬规矩） ───────────────────

test('★★leg80 丙-web⑦：新家不模块级抓死任何 ctx（另起进程量初始态）', () => {
    // ★为什么另起进程：模块级状态 + 同进程多用例 ⇒ "初始化那一次"会被前面任何一条用例掩盖
    //   （leg79 §3 坑③ 的实拍：变异"共用同一个数组"一路全绿）。本族对应的是 `getCtx` 的初值。
    // ★★本判据**咬什么**（这一条是 leg80 在咬合演练里**改过一次**的，留档）：
    //   初版只断言"初始态返回空数组" ⇒ 变异"模块级抓死一份 ctx"**咬不住**——因为那种变异下
    //   `bookEntriesForInherit()` 仍可能返回空数组（取决于抓死的那份 ctx 有没有书）。
    //   ⇒ 定稿把"初始态"钉成**两半**：① 必须有"没有上下文"的**等价物**可看到（`getCtx` 可换绑）
    //     ② ★★★`setCtxSource` 必须能把它**换成"有书"**，且换完之后结果**真的变了**
    //     —— "换得动"才是"没有被抓死"的可观察证据（抓死的实现在这里必然交不出书）。
    // ★路径用 `import.meta.url` 算（**不许拼 `process.cwd()`**：本仓第一版就这么写，
    //   反斜杠在 `-e` 字符串里被吃一层 ⇒ `F:deepseekplugins…` 当场 ERR_MODULE_NOT_FOUND）。
    const modUrl = new URL('../web/book-source.js', import.meta.url).href;
    const probe = `
      const m = await import(${JSON.stringify(modUrl)});
      const out = [];
      // ① 初始态：没有任何注入 ⇒ 取书口**不许抛**，且如实交"读不到"（不是"书里没有"）
      const before = await m.bookEntriesForInherit();
      if (!Array.isArray(before) || before.length !== 0) throw new Error('INIT-NOT-EMPTY:' + JSON.stringify(before));
      out.push('before=' + before.length);
      // ② 纯函数**不需要** ctx（这是本族能搬出来的理由）
      const t = m.bookEntryText('- 甲 (男): 乙。', '甲');
      if (t.located !== 'line') throw new Error('PURE-NEEDS-CTX');
      // ③ ★★★换得动：注入"有书"的取数函数 + 清缓存之后，同一口必须**真的**交出书
      //    （模块级抓死的实现在这里恒交空数组 ⇒ 当场红）
      //    ★这一格顺带把**真契约**写下来了：setCtxSource 只换"以后去哪取 ctx"，
      //      **不动已缓存的那本书**——换聊天/换卡时必须照旧调 resetBookCache()
      //      （生产侧那处就是这么写的：loadWorld 里 resetBookCache()）。
      m.setCtxSource(() => ({
        characterId: 0, characters: [{}], chatMetadata: {},
        extensionSettings: { world_info: { globalSelect: ['probe'] } },
        loadWorldInfo: async () => ({ entries: [{ key: ['甲'], comment: '甲', content: '- 甲 (男): 乙。' }] }),
      }));
      m.resetBookCache();
      const after = await m.bookEntriesForInherit();
      if (!Array.isArray(after) || after.length !== 1) throw new Error('NOT-SWAPPABLE:' + JSON.stringify(after));
      out.push('after=' + after.length);
      // ④ 再换回"没有上下文" ⇒ 缓存要跟着清（否则读到上一份书）
      m.setCtxSource(() => null);
      m.resetBookCache();
      const back = await m.bookEntriesForInherit();
      if (back.length !== 0) throw new Error('NOT-RESETTABLE:' + JSON.stringify(back));
      out.push('back=' + back.length);
      console.log('INIT-OK ' + out.join(' '));
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' });
    assert.match(out, /INIT-OK before=0 after=1 back=0/,
        '★初始态必须是"没有上下文"（before=0）· 注入后必须**换得动**（after=1）· 换回后必须清得掉（back=0）'
        + `—— ★"换得动"这一格是本棒咬合演练改出来的：没有它，"模块级抓死"那种变异咬不住。实际输出：${out.trim()}`);
});
