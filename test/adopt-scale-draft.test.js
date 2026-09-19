// story-world-v2/test/adopt-scale-draft.test.js
// ★★leg70（A6 · 「只抽刻度」抽完**能存**）：采用通道的全链路判据。
//
// 这一棒治的病（`docs/leg68-recon-pending.md` §A6 实测 + 用户 leg63 原话
// 「我刚刚抽了有很多表，但是原本的内容还在」）：
//   直抽那条路只把结果挂到 `world.context.__scaleDraft`（**会话态**），
//   `applySettingToSsot` / `writeHotMeta` / `flushHotMeta` **一个都没调**
//   ⇒ ① 刷新即丢；② `frozen.canon.刻度` 一个字不动 ⇒ 面板上"原本的内容还在"；
//     ③ 于是那一栏**永远只是看的**（`leg62` 起就说"要用草稿取代账本，走正常的初始化/重抽"，
//        而那两条路一条会重开世界、一条会换掉整份设定 —— 用户要的只是"这一次抽到的尺子就用它"）。
//
// ★本文件的判据形态纪律（照本仓两处血教训）：
//   ① **不许**用"我在某一本书里看到的词/数字"当判据 ⇒ 夹具一律**自造记号**（甲表/X1/Y1）；
//   ② 判据**必须锁接线**（不是"函数写好了"）—— leg25 f 那条病历：机制建好、接线从没生效、测试全绿。
//      故本文件一律从**生产源码**里取那段切片来咬（同 `scales-concept-table.test.js:323` 的口径）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { renderSettingHtml } from '../src/render.js';

// 最小世界夹具（够 `renderSettingHtml` 走完设定页；形状照 live-world 精简）
// ★`canon` 里**故意放了旧的刻度**：草稿栏要报"账上现在是几张三档 ⇒ 采用后变成几张三档"。
const world = () => ({
    version: 1,
    context: {
        world: '测试世界', tension: 0.5, positions: ['临渊城'],
        setting: {
            frozen: {
                fingerprint: 'fnv1a_test', extractedAt: '2026-09-18T00:00:00Z',
                canon: {
                    刻度: [
                        { 名: '旧尺一', 用途: '分级', 档位: [{ 档: 'T1 甲境' }, { 档: 'T2 乙境' }], 维度: [{ 名: '属性甲', 范围: 'T1~T2' }] },
                        { 名: '旧尺二', 用途: '分级', 档位: [{ 档: 'T3 丙境' }] },
                    ],
                    powerScale: [{ level: 'T1 甲境', note: 'T1 甲境' }, { level: 'T2 乙境', note: 'T2 乙境' }, { level: 'T3 丙境', note: 'T3 丙境' }],
                    dims: [{ name: '属性甲', range: 'T1~T2' }],
                    rules: ['旧法则一'], society: '旧世情', techOrMagic: '', historyNotes: ['旧史略一'],
                    situation: '', bookEntities: [{ name: '甲号', kind: 'faction' }], settings: [],
                },
                compile: null,
            },
            dynamic: { tension: { polarity: '甲/乙', direction: '甲压乙', intensity: 0.5 }, env: {}, derivedFrom: [] },
        },
    },
    entities: [], weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0 },
});

const DRAFT = {
    at: '2026-09-19T00:00:00Z', source: '测试书', secs: 12.3, calls: 1, dropped: 1,
    scales: [
        { 名: '甲表', 用途: '分级', 档位: [{ 档: 'X1', 注: '一' }, { 档: 'X2', 注: '二' }], 维度: [{ 名: '属性乙', 范围: 'X1' }] },
        { 名: '乙表', 用途: '制度', 档位: [{ 档: 'Y1', 注: '三' }] },
    ],
    errors: ['刻度《甲表》档位「编的」原文查不到（已弃）'],
};

/** 生产源码（`web/index.js`） */
const webSrc = () => readFileSync(new URL('../web/index.js', import.meta.url), 'utf8');
const renderSrc = () => readFileSync(new URL('../src/render.js', import.meta.url), 'utf8');
// ★★★leg73（丙-web 第二格）：快照族（含 `restoreSnapshot`）已整族搬进 `web/snapshot-store.js`
//   ⇒ 下面那条"锚点唯一性/全仓计数"判据必须**跟着 `web/` 目录走**，而不是只看 `index.js`。
//   ★这正是 leg72 §1.5 第 3 条那条纪律的同一次复发：**判据还绿、但它已经照不到新东西**
//     （若继续只读 index.js，那条"7 处"的计数会因为漏掉新家而变成 6 ⇒ 假红/假绿都可能）。
const webDirSrc = () => readdirSync(new URL('../web', import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8'))
    .join('\n');

/**
 * **逐字符**注释剥离器（跳过字符串与模板字面量）。
 * ★★为什么本文件非要它（本棒演练当场抓到的假绿）：腿⑥（"不清草稿"）的演练口径是
 *   **把 `delete next.context.__scaleDraft;` 整行注释掉**——那正是这个病真实发生的形态
 *   （改代码时顺手注释一行）。而 `/delete\s+next\.context\.__scaleDraft/` 在**注释里照样命中**
 *   ⇒ 源码文本一个字没变、病却回来了、判据照旧全绿（**演练报"没咬住"**）。
 *   ⇒ 凡是"判断某个**动作**在不在"的判据，都必须在**剥掉注释之后**的源码上做
 *     （这与 legit leg69 §4.5 那条纪律同源：**别用整体替换式掩码、也别在带注释的原文上判动作**）。
 * ★口径照 `test/pack-fit.test.js` 的 `stripComments`（同款逐字符扫描器，"跳过字符串、只剥注释"）。
 */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const c2 = src[i + 1];
        if (c === '/' && c2 === '/') {                       // 行注释
            while (i < n && src[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && c2 === '*') {                       // 块注释
            i += 2;
            while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {           // 字符串 / 模板（整段跳过，含其中的 //）
            const quote = c;
            out += c;
            i++;
            while (i < n) {
                if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
                out += src[i];
                if (src[i] === quote) { i++; break; }
                i++;
            }
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

/**
 * 取 `bus['adopt-scale-draft']` 的**函数体切片**。
 * ★为什么不用 `indexOf('};')` 当右界（本仓踩过两次）：那个字面量会撞上体内解构/函数式写法；
 *   而"下一个 `bus[...] =` 声明"是**结构性**边界（本仓 `reextract-setting` 那条锁同款，
 *   它头注里明写了"用 `bus['extract-scales']` 当右界会划过头，把文件顶部的 import 也包进来"）。
 * ★★leg70 演练当场抓到的第三坑（写在这里给下一棒）：**锚点必须唯一**。
 *   本文件的锚点自己就是判据（`assert` 咬的是源码形状），而 `String.replace`/`indexOf` 只认**第一处**——
 *   若同一行在别处也出现，"注入演练"会去改**别的**地方 ⇒ 锁看着"没咬住"，其实是被咬的那段根本没被改。
 *   ⇒ 所以每个锚点都先断言**全仓出现次数 = 1**（见 `uniq()`）。
 */
function uniq(web, anchor, label) {
    const n = web.split(anchor).length - 1;
    assert.equal(n, 1, `★锚点「${label}」在全仓必须恰好出现 1 次（实为 ${n} 次）——否则注入演练会改错地方`);
    return anchor;
}

function adoptBody() {
    const web = webSrc();
    const start = web.indexOf("bus['adopt-scale-draft']");
    assert.ok(start > 0, '★生产源码里必须有 adopt-scale-draft 这个动作（不是只画了个按钮）');
    assert.equal(web.split("bus['adopt-scale-draft']").length - 1, 1,
        '★采用动作只许有**一处**声明（两处 ⇒ 下面所有源码级判据都会读到错的那一段）');
    const next = web.indexOf('bus[', web.indexOf('=', start) + 1);
    const body = web.slice(start, next > start ? next : undefined);
    assert.ok(body.length > 400, `取到了 adopt 的函数体（实取 ${body.length} 字符）`);
    return body;
}

// ───────────────── ① 三面齐：按钮在位 · 处理器注册在总线 · 源码接线在位 ─────────────────

test('★leg70 采用通道：按钮在位 + 处理器注册在总线上（防"函数写好了、没人调"——leg25f 那条病历）', async () => {
    const savedW = globalThis.window;
    const savedD = globalThis.document;
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    globalThis.document = { readyState: 'complete', addEventListener() {}, getElementById: () => null };
    try {
        // `?wireadopt`：破模块缓存（动作注册在 `typeof window !== 'undefined'` 里，别的用例可能已在无 window 下导入过它）
        await import('../web/index.js?wireadopt');
        const bus = globalThis.window.__sw2Actions || {};
        assert.equal(typeof bus['adopt-scale-draft'], 'function', '★采用草稿的处理器注册在动作总线上');
        // 三条通道**并存**：抽（瞄一眼）/ 采用（落账）/ 清（丢弃）——撤一条不许连带撤别的
        assert.equal(typeof bus['extract-scales'], 'function', '★抽那条通道仍在');
        assert.equal(typeof bus['clear-scale-draft'], 'function', '★清那条通道仍在');
    } finally {
        globalThis.window = savedW;
        globalThis.document = savedD;
    }
});

test('★leg70 面板：草稿栏画出「采用」按钮，并报"账上几张三档 ⇒ 采用后几张三档"', () => {
    const w = world();
    w.context.__scaleDraft = DRAFT;
    const html = renderSettingHtml(w);
    assert.match(html, /data-action="adopt-scale-draft"/, '★草稿栏有「采用」按钮（且挂的是真动作名）');
    assert.match(html, /采用这份草稿/, '按钮文案是人话（零引擎术语）');
    // ★采用前把"要换掉的那一份"摆出来：旧 2 张 3 档 ⇒ 新 2 张 3 档（夹具特意等数，防"印了同一个数"看着像没接上）
    assert.match(html, /<b>2<\/b> 张表 \/ <b>3<\/b> 档 ⇒ <b>2<\/b> 张表 \/ <b>3<\/b> 档/,
        '★草稿栏报"账上现在是几张三档 ⇒ 采用后变成几张三档"（读数取自账本，不是自报）');
    assert.match(html, /只换刻度那三格/, '★明说采用会动哪三格');
    assert.match(html, /法则\/名册\/史略\/张力一个字不动/, '★明说不动的那些（用户最怕的就是"顺手把名册抹了"）');
    assert.match(html, /旧的那一份会先打到控制台再覆盖/, '★覆盖不可回 ⇒ 留痕这件事要说在按钮旁边');
    // ★★必须如实说的局限（leg63 §5.3 登记过）：单次调用 vs 多块 + 块间合并 ⇒ 不会逐字相同
    assert.match(html, /一次调用<\/b>抽的/, '★说清草稿是单次调用的产物');
    assert.match(html, /不会逐字相同/, '★★如实说"两边不会逐字相同"（不许让用户以为它能替代生产管线）');
    assert.match(html, /想走生产那条管线就用「只重抽设定」/, '★给出正路（说出局限的同时给出路，照 leg67 那条纪律）');
    assert.ok(!html.includes('**'), '★渲染产物不许含 markdown 星号（面板是 HTML）');
});

test('★leg70 零扰动：没有草稿 ⇒ 草稿栏与「采用」按钮都不出现（老账/新世界照旧）', () => {
    const html = renderSettingHtml(world());
    assert.ok(!html.includes('data-action="adopt-scale-draft"'), '★没有草稿 ⇒ 不画「采用」');
    assert.ok(!html.includes('data-action="clear-scale-draft"'), '★没有草稿 ⇒ 也不画「清掉这一栏」');
    assert.ok(!html.includes('只抽刻度 · 本次结果'), '★没有草稿 ⇒ 整栏都不画');
    // 但入口按钮照旧在位（两条通道不是互相替换）
    assert.match(html, /data-action="extract-scales"/, '★「只抽刻度」入口仍在');
    // ★措辞更正：本棒之前"只瞄一眼"是字面为真的（那条路确实不入账），现在草稿栏多了一枚真会写账的按钮
    //   ⇒ 旧话必须改，否则就是本仓最忌讳的"面板印一句不再为真的话"。
    assert.match(html, /瞄一眼书里的"尺子"（可再采用）/, '★入口措辞不再声称"只瞄一眼"（能再采用是新的真话）');
});

/**
 * 采用通道里"显式落盘"那一行的**唯一可锚前缀**。
 * ★为什么不能直接锚整行 `const flushed = await flushHotMeta();`：它在 `web/index.js` 里有 **6** 处
 *   （账户形状同步 / 初始化 / 导入 / 快照恢复 / 重抽设定 / 本动作）⇒ 只靠那一行**定位不到**采用通道，
 *   连"这一行唯一"这条断言本身都会红。真正唯一的只有它**行尾那句注释**。
 * ★取**前缀**（不带行尾换行）的用意：这样注入演练可以直接 `replace('…flushHotMeta();', '…{ ok: true };')`
 *   ——`replace` 是**子串**替换，锚点带不带行尾都能命中；而前缀里已经含了 `flushed` 与那句注释，
 *   别的 5 处都不长这样。
 */
const FLUSH_TAIL = 'const flushed = await flushHotMeta();   // 采用入账：走与「只重抽设定」同一条显式落盘路径';

// ───────────────── ② 接线：只换刻度那三格 · 名册保命 · 落盘三步一个不少 ─────────────────

// ★★leg70：**锚点唯一性**单列一条判据。为什么它值得单独一条（本棒演练当场踩到）：
//   本文件大部分判据是"从生产源码里取一段切片来咬"，而**切片本身就靠锚点定位**；
//   锚点不唯一 ⇒ 切片取到别的动作 ⇒ 判据变成"在错误的地方找正确的东西"（假绿）。
//   演练实证：`const flushed = await flushHotMeta();` 在全仓有 **6** 处
//   ⇒ 注入演练改的是文件里**第一处**（账户形状同步那条），采用通道一个字没动，于是报"没咬住"。
//   ⇒ 把"这几行必须各只有一处"钉成判据：谁要是**合法地**再加一处，必须在这里显式登记（并同步演练锚点）。
test('★★leg70 锚点唯一性：本文件用来取切片的那几行，全仓必须各只有一处', () => {
    const web = webSrc();
    const render = renderSrc();
    for (const [src, anchor, where] of [
        [web, "bus['adopt-scale-draft']", 'web/index.js 采用动作'],
        [web, 'delete next.context.__scaleDraft;', 'web/index.js 草稿退场'],
        [web, 'frozen: { ...world.context.setting.frozen, canon, extractedAt: new Date().toISOString() },', 'web/index.js frozen 只动两格'],
        [web, 'const canon = { ...before, 刻度: scales, powerScale: flat.powerScale, dims: flat.dims };', 'web/index.js canon 展开'],
        [web, 'const flat = scalesToFlat(scales);', 'web/index.js 唯一派生路'],
        [web, FLUSH_TAIL, 'web/index.js 采用通道的显式落盘'],
        [render, 'const oldScales = resolveScales(world?.context?.setting?.frozen?.canon || {});', 'render.js 草稿栏读数'],
    ]) {
        const n = src.split(anchor).length - 1;
        assert.equal(n, 1, `★锚点「${where}」在全仓必须恰好 1 次（实为 ${n} 次）——多一处就得在这里登记并同步演练锚点`);
    }
    // ★★leg72b 更正：这句原本写死 **6 处**，而本棒实测是 **7 处** —— 如实记两件事：
    //   ① 那是**观察值、不是设计不变量**：`restoreSnapshot` 那一处曾被换成存根
    //      `const flushed = { ok: true };`（leg67–71 的未提交改动），使实测一度变成 **5 处**
    //      —— 而**没有任何一条锁因此变红**（硬编码的计数只在这一条里，它只在"等于 7"时才响）。
    //   ② 本棒已把存根恢复成真落盘（缺陷：面板会印恒真的"已落盘"）⇒ 计数回到 7。
    //   ★纪律：这类"顺手记下来的计数"要么写成**不变量**，要么别让它承担判据职责——
    //     它证明不了任何设计要求（本仓 leg71 §4.4"锁收紧过头会自伤"的另一面：**锁写松了会假绿**）。
    //   ★真正的判据在 `test/snapshot.test.js` 的「★★leg72b：恢复快照必须真的落盘」那条（锚语义，不锚计数）。
    // ★★★leg73 二次更正：**扫描面从"一个文件"改成"web/ 整个目录"**。
    //   为什么（同一次病的第三次复发）：`restoreSnapshot` 那一处（"快照恢复"这条通道）
    //   已随快照族搬进 `web/snapshot-store.js` ⇒ 若继续只读 `web/index.js`，这个计数会**静默变成 6**
    //   ⇒ 这条锁又会变成 leg72b 痛斥过的那个样子：**照不到新东西，却还绿着**（覆盖面悄悄漏了）。
    //   ⇒ 口径：**跟着目录走**（现算，不写死清单）——与 `test/browser-compat.test.js` 的 `listSources()` 同一条纪律。
    const webAll = webDirSrc();
    // ★★★leg70 补回时的更正（**改的是错记的观察值，判据语义一个字没动**）：原写 **7** → 勘正为 **8**。
    //   溯源（`048c3c6`「leg81 检查点」一次性入档时把旧口径抄进了新扫描面）：
    //   那个 **7** 抄自 leg70 交接里的**观察值**，而当时的**口径是"`index.js` 内部 7 处（含采用）"**；
    //   本判据随后被改成"**跟着 `web/` 全目录走**"（见上一段 leg73 更正），新扫描面里**多出一处**
    //   —— `web/snapshot-store.js` 的**快照恢复**（leg73 搬过去的）。
    //   ★这正是"**这个数只在本功能缺席时才等于 7**"：补回采用之前它确实是 7（当时 `web/` 里没有采用那一处），
    //     所以它**证明不了任何设计要求**——与上面 :228 那段自己登记的纪律是同一条。
    // ★★★leg73+leg78 搬家时二次勘正 **8 → 7**（同一条纪律：**观察值跟着搬家走，不是归零重抄**）：
    //   那两族一起搬完（快照族 → `web/snapshot-store.js`、热账族 → `web/hot-ledger.js`）之后，
    //   `web/index.js` 里**原来在 `restoreSnapshot` 内的那一处**已经不在接线层了 ⇒ 总数回到 **7**。
    //   ★★这一条是"硬编码计数**必然**随搬家失效"的**第二次实证**（第一次就是上面那段 leg72b 登记的话）：
    //     同一个数在一棒之内被搬了两次（先搬快照 +1、再补采用 −1）——**留档在此，别再当不变量用**。
    //   ⇒ 现在这 7 处逐处点名（采用那处 = `FLUSH_TAIL` 要锚的**唯一**一个）：
    //     ① 载入（`loadWorld`）· ② 导出世界 · ③ 导入世界 · ④ 重抽设定（`reextract-setting`）·
    //     ⑤ 初始化（`init-world`）· ⑥ 清演化层（`reset-dynamic`）· ⑦ **采用草稿**（唯一带注释那处）
    //     ＋ **快照恢复**那一处已随族搬进 `web/snapshot-store.js`（在目录里，但不在 `index.js` 里）。
    assert.equal(webAll.split('const flushed = await flushHotMeta();').length - 1, 7,
        '★这一行（不带注释）在 `web/` 全部模块里现在共 7 处：载入 / 导出 / 导入 / 重抽设定 / 初始化 / 清演化层'
        + ' / **采用草稿** ＋ **快照恢复**（已搬去 snapshot-store.js，仍在这个扫描面里）'
        + ' —— 所以只锚它必然定位不到采用通道，这正是本文件必须用 FLUSH_TAIL 那条带注释前缀的原因');
    // ★自证：这条计数**真的照得到新家**（否则"跟着目录走"只是句空话）
    const snapStore = readFileSync(new URL('../web/snapshot-store.js', import.meta.url), 'utf8');
    assert.ok(snapStore.includes('const flushed = await flushHotMeta();'),
        '★★自证：`web/snapshot-store.js`（快照恢复那条通道的新家）里必须有这一行——'
        + '没有它，上面那个"7"就说明扫描面又漏了新模块');
});

test('★★leg70 接线四条：唯一的派生路 + 唯一的换设定路 + 落盘三步 + 名册结构保命', () => {
    const body = adoptBody();
    // ① 旧两列**必须**用 `scalesToFlat` 重算（手写第二份 ⇒ 面板/进包的旧两列与 `刻度` 漂移）
    assert.match(body, /scalesToFlat\(/, '★旧两列走唯一那条派生路（`scalesToFlat`）');
    assert.ok(!/powerScale\s*:\s*\[/.test(body), '★不许在接线里手写一份 powerScale（那就是第二份复制品）');
    assert.ok(!/dims\s*:\s*\[/.test(body), '★不许在接线里手写一份 dims');
    // ② 换设定走**唯一**那条路（不是 `{...world, context:{setting}}` 自己拼一份）
    assert.match(body, /applySettingToSsot\(/, '★走唯一那条换设定的路径');
    assert.ok(!/context\s*:\s*\{\s*\.\.\./.test(body), '★不许自己拼 `context`（那会绕过 applySettingToSsot）');
    // ③ 落盘三步一个不少（本动作与"只瞄一眼"的根本区别就在这里）
    assert.match(body, /writeHotMeta\(/, '★写热账');
    assert.match(body, /await flushHotMeta\(\)/, '★显式落盘后**才**报成功（leg20 语义）');
    // ④ ★★名册保命：canon 必须**从账上那份 canon 展开**起手 ⇒ `bookEntities` 等键天然带过。
    //    这一条是 leg62b 那条老病的结构防线（"删字段只删一半" ⇒ 名册被抹成空）：
    //    同族的 `reextract-setting` 换了**整份** canon，所以它必须显式保 `bookEntities`；
    //    本动作只换三格 ⇒ 保命靠**形状**，不靠"记得别删"。
    assert.match(body, /\.\.\.\s*before/, '★★canon 从旧 canon 展开（名册/法则/史略原样带过，这就是保命那一步）');
    assert.ok(!/bookEntities\s*:\s*\[\s*\]/.test(body), '★不许把名册清空');
    assert.ok(!/种子|seedBookEntities\(/.test(body), '★不许在采用通道里调 seedBookEntities（那是"重开世界"那一步）');
});

test('★★leg70 只换刻度那三格：`刻度`/`powerScale`/`dims` 进 canon，其余键一个都不许被赋值', () => {
    const body = adoptBody();
    assert.match(body, /刻度:\s*scales/, '★`刻度` 换成草稿那份');
    assert.match(body, /powerScale:\s*flat\.powerScale/, '★`powerScale` 是 `scalesToFlat` 的产物');
    assert.match(body, /dims:\s*flat\.dims/, '★`dims` 同上');
    // ★反向白名单：canon 里别的键**一个都不许出现在赋值位置**（漏一个就是"顺手多换了一格"）
    for (const k of ['rules', 'society', 'techOrMagic', 'historyNotes', 'situation', 'bookEntities', 'settings']) {
        assert.ok(!new RegExp(`${k}\\s*:`).test(body), `★canon 的 \`${k}\` 不许被本动作用到（只换刻度那三格）`);
    }
});

test('★★leg70 硬锁仍在：采用必须**另起动作**，不许塞进直抽那条路（`extractWorldSetting` 不许出现）', () => {
    const web = webSrc();
    // 原锁（scales-concept-table.test.js:323）的同一口径，在这里再咬一次"新加的动作也没破它"
    const extractSlice = web.slice(web.indexOf("bus['extract-scales']"), web.indexOf("bus['clear-scale-draft']"));
    assert.ok(!/extractWorldSetting\(/.test(extractSlice), '★直抽那条路上仍不许跑整条抽取管线');
    assert.ok(!/adopt-scale-draft/.test(extractSlice), '★采用**不能**塞在直抽那一段里（本仓最贵的病：抽与存接成一条）');
    assert.ok(!/extractWorldSetting\(/.test(adoptBody()),
        '★采用通道也不许跑整条抽取管线（它用的是**手上那份草稿**，不是重抽一遍）');
    // 「只重抽设定」那条仍在它自己那段里（没有被本棒挪走或合并）
    // ★右界必须**从 start 之后**找下一个 `bus[`（本仓踩过的坑：`indexOf` 从 0 找会命中更早出现的那个字面量
    //   ⇒ 得到空串/负区间。`scales-concept-table.test.js:265` 头注记的是同一件事的另一面）。
    const reStart = web.indexOf("bus['reextract-setting']");
    const reSlice = web.slice(reStart, web.indexOf('bus[', reStart + 1));
    assert.ok(reSlice.length > 500, `取到了 reextract-setting 的函数体（实取 ${reSlice.length} 字符）`);
    assert.match(reSlice, /extractWorldSetting\(/, '★只重抽设定照旧走生产管线（两条通道并存）');
});

// ───────────────── ③ 落账语义：草稿退场 · 指纹不动 · 时刻要新 ─────────────────

test('★leg70 落账语义：草稿入账后必须退场（否则面板上两份刻度，看着像没生效）', () => {
    // ★★判据必须跑在**剥掉注释之后**的源码上：这条病真实发生的形态就是"把那一行注释掉"
    //   （本棒演练实证：注释掉之后原文照旧含这串字 ⇒ 原始正则假绿、演练报"没咬住"）。
    const body = stripComments(adoptBody());
    assert.match(body, /delete\s+next\.context\.__scaleDraft|delete\s+world\.context\.__scaleDraft/,
        '★入账后真的清掉草稿（不清 ⇒ 草稿栏与账本同时画同一把尺子；★注释里的同名字串不算数）');
    // 反向自证：剥离器本身必须真的在干活（否则上面那条=在原文上判动作，等于没防）
    assert.ok(!/delete\s+next\.context\.__scaleDraft/.test(stripComments('/* delete next.context.__scaleDraft; */')),
        '★剥离器自证：被注释掉的那一行在剥离后必须**不再命中**（否则上面那条判据是空绿）');
});

test('★leg70 指纹与时刻：`fingerprint` 不动（本次没重读源）；`extractedAt` 要新（面板那句"抽取于"不许印旧时刻）', () => {
    const body = adoptBody();
    assert.ok(!/fingerprint\s*:/.test(body),
        '★fingerprint 不许被本动作改（改它 = 谎报"书变了"，会让"书没变不重抽"那条判断失去依据）');
    assert.match(body, /extractedAt:\s*new Date\(\)\.toISOString\(\)/,
        '★extractedAt 要新 —— 它印在设定页副标题"抽取于 …"上，而刻度确实是这一刻换的');
});

test('★leg70 面板可见面口径：采用按钮是**主按钮**（sw2-primary），清草稿是次按钮（丢弃不该最显眼）', () => {
    const html = renderSettingHtml({ ...world(), context: { ...world().context, __scaleDraft: DRAFT } });
    const adopt = html.slice(html.indexOf('adopt-scale-draft') - 90, html.indexOf('adopt-scale-draft'));
    assert.match(adopt, /sw2-primary/, '★采用带主按钮样式（它是这一栏的主动作）');
    const clear = html.slice(html.indexOf('clear-scale-draft') - 90, html.indexOf('clear-scale-draft'));
    assert.ok(!/sw2-primary/.test(clear), '★清掉这一栏不带主按钮样式（它不是被推荐的那一下）');
    // 渲染层不许自造读数：账上那两格读的是 `resolveScales`（与「维度与刻度」那一栏同一把尺子）
    assert.match(renderSrc(), /resolveScales\(world\?\.context\?\.setting\?\.frozen\?\.canon \|\| \{\}\)/,
        '★草稿栏的"账上现有读数"必须走 `resolveScales`（不许在这里另写一份数法）');
});
