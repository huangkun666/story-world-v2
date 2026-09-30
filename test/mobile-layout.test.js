// story-world-v2/test/mobile-layout.test.js
// ★★★leg145（用户令「**我需要你做适配手机端**」）：**手机端那一族的锁**。
//
// 这一份判据治的是一类本仓吃过太多次亏的病：**"写了规则"不等于"规则生效"**。
//   · leg104 给窄屏加了一条 `@media (max-width:620px)`（实体行改单列），**判据也写了**——
//     而它写在文件前半、被覆盖的基础规则住在更靠后的段落里；媒体查询**不加特异性**，
//     同特异性下**后写的赢** ⇒ **那条媒体查询一直是死的**（leg145 用无头 Chrome 实测 390px 宽：
//     实体行仍是 `212px …` 三列）。原来那条判据只咬了"这句话在样式表里"，没咬"它赢没赢"。
//   · 手机那一档还有一条同样的陷阱：`web/index.js` 的 `modalBoost()` 往页头插了一条
//     `#story_world2_window{…}` 的**内联**规则（特异性＝id，且排在样式表之后）⇒ 类选择器压不过它。
// ⇒ 本文件的每一条都尽量咬**关系**（谁在谁后面 / 特异性 / 谁被谁盖住），而不是咬字面。
//
// ★两档分工（与样式表里那两条媒体查询一一对应）：
//   `(pointer:coarse)` = **手感**（点击目标 / 输入框字号 / 双击缩放）——按"是不是手指"判，不看宽度；
//   `(max-width:620px)` = **版面**（单列 / 页签横滑 / 遮罩留边 / 浮层整屏）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
/** 去 CSS 注释（本仓注释里大量**引用旧值与旧话**——不去会把判据自己骗红）。 */
const cut = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
const CSS_RAW = read('web/style.css');
const CSS = cut(CSS_RAW);
const INDEX = read('web/index.js');

/** 取某条媒体查询的整块（到列首那个 `}` 为止）——样式表里同一条查询只许有一处。 */
function mediaBlock(css, query) {
    const at = css.indexOf(`@media ${query}{`);
    if (at < 0) return '';
    const end = css.indexOf('\n}', at);
    return end < 0 ? '' : css.slice(at, end + 2);
}
/** 取某条选择器**作为选择器表的开头**出现的位置（`{`/`}`/`;` 之后，**不含**跟在别的选择器后面的那种）。
 *  ★为什么非要这么挑：本仓的选择器表是逗号连写的（`.sw2-tab,.sw2-btn,…{…}`），
 *    直接 `indexOf('.sw2-chainbtn{')` 会命中**别人那条规则里**的那个逗号后面的片段，
 *    于是"取回来的声明"是别人的 —— 本仓把这叫"判据跑在别的东西上"，是空绿家族的一员。 */
function ruleAt(css, sel) {
    let from = 0;
    for (;;) {
        const at = css.indexOf(`${sel}{`, from);
        if (at < 0) return -1;
        const prev = css.slice(0, at).replace(/\s+$/, '').slice(-1);
        if (at === 0 || '{};'.includes(prev)) return at;
        from = at + 1;
    }
}
function ruleOf(css, sel) {
    const at = ruleAt(css, sel);
    if (at < 0) return '';
    const end = css.indexOf('}', at);
    return end < 0 ? '' : css.slice(at + sel.length + 1, end);
}
/** 基础规则里凡是 `font-size: Npx`（N < 12）的选择器——手机那档要把它们整批抬到 12px。 */
function smallFontSelectors(css) {
    const out = new Map();
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const fs = /font-size\s*:\s*([\d.]+)px/.exec(m[2]);
        if (!fs || Number(fs[1]) >= 12) continue;
        out.set(m[1].trim().replace(/\s+/g, ' '), Number(fs[1]));
    }
    return out;
}

const MQ620 = mediaBlock(CSS, '(max-width:620px)');
const MQCOARSE = mediaBlock(CSS, '(pointer:coarse)');

// ─────────────────── ① 两条媒体查询都在，且都不为空 ───────────────────
test('★leg145·M1：手机那两条媒体查询都在（版面 620 ＋ 手感 coarse），且不是空块', () => {
    assert.ok(MQ620.length > 400, `★\`@media (max-width:620px)\` 必须在（现 ${MQ620.length} 字符）——它是手机版面的家`);
    assert.ok(MQCOARSE.length > 300, `★\`@media (pointer:coarse)\` 必须在（现 ${MQCOARSE.length} 字符）——它是手指那一档的家`);
    // ★反向自证：两个块必须**分家**（手感只认手指、版面只认宽度）——把宽度条件写进 coarse 块就是走回头路
    const coarseQueries = [...CSS.matchAll(/@media \(([^)]*)\)\{/g)].map((m) => m[1]);
    assert.ok(coarseQueries.some((q) => q.includes('pointer:coarse')), '★手感那一档要按"是不是手指"判（不是按屏幕宽度）');
});

// ─────────────────── ② 620 那条**必须排在它覆盖的规则之后**（这一笔的真病） ───────────────────
test('★★leg145·M2：620 断点排在它覆盖的 `.sw2-entity-row` 基础规则**之后**（leg104 那条一直是死的）', () => {
    const baseAt = CSS.indexOf('.sw2-entity-row{');
    const mqAt = CSS.indexOf('@media (max-width:620px){');
    assert.ok(baseAt > 0, '前置：`.sw2-entity-row` 基础规则在（取不到 ⇒ 下面是空绿）');
    assert.ok(mqAt > 0, '前置：620 断点在');
    assert.ok(mqAt > baseAt,
        '★★620 断点必须排在 `.sw2-entity-row` 基础规则**之后**——媒体查询不加特异性，同特异性下后写的赢；'
        + '排在前面 = **写了等于没写**（leg104 那次就是这么死的，实测 390px 宽仍是三列）');
    // ★规则本体一个字没改（搬的只是位置）
    assert.match(MQ620, /\.sw2-entity-row\{grid-template-columns:minmax\(0,1fr\);gap:4px;\}/,
        '★实体行单列那条规则文字照旧（本笔只搬位置，没改口径）');
    // ★其余被覆盖的规则也都要排在它们的基础规则之后（这一族是本笔新增的，同一条纪律）
    for (const sel of ['.sw2-settings', '.sw2-sv-grid', '.sw2-row', '.sw2-ents-g', '.sw2-tabs', '.sw2-close']) {
        const base = ruleAt(CSS, sel);
        assert.ok(base > 0 && base < mqAt, `★${sel} 的基础规则应当在本块之前（否则本笔这条覆盖就是多余/写错位置）`);
    }
    // ★反向自证：把 620 块挪回文件开头 ⇒ 上面那条"谁在前"当场立不住（证明它真的在咬位置）
    const movedEarly = MQ620 + CSS.replace(MQ620, '');
    assert.ok(movedEarly.indexOf('@media (max-width:620px){') < movedEarly.indexOf('.sw2-entity-row{'),
        '★反向自证：挪到开头之后，620 块真的跑到基础规则前面去了 ⇒ 本条判据会当场红');
});

// ─────────────────── ③ 遮罩那两条必须压得过 modalBoost 的内联 id 规则 ───────────────────
test('★★leg145·M3：手机改遮罩留边/视口高，写了"压得过 id"的选择器（modalBoost 的内联规则在后）', () => {
    // 前置（机理）：`modalBoost()` 真的往页头插了一条 id 规则，且带 padding 与 height
    const boost = /style\.textContent = [\s\S]*?;\n/.exec(INDEX);
    assert.ok(boost, '前置：`web/index.js` 里必须有那条内联规则（取不到 ⇒ 下面全是空绿）');
    assert.match(boost[0], /\$\{WINDOW_ID\}\{position:fixed/, '前置：它是按 id 拼出来的（这就是"特异性＝id"的来源）');
    assert.match(boost[0], /padding:20px/, '前置：它真的写了 `padding:20px`（手机要盖的就是这一条）');
    assert.match(boost[0], /height:100%/, '前置：它真的写了 `height:100%`（dvh 那一条要盖的也是它）');
    // ★治法：写成「id ＋ 类」——特异性 (1,1,0) > (1,0,0)，与"谁在前谁在后"无关
    const winner = /#story_world2_window\.sw2-window-mask\{([^}]*)\}/.exec(MQ620);
    assert.ok(winner, '★★必须在手机那一档里写 `#story_world2_window.sw2-window-mask{…}`（只写类选择器压不过那条内联规则，'
        + '——本仓把这叫"看着改了、其实没生效"）');
    assert.match(winner[1], /padding\s*:\s*6px/, '★遮罩留边在手机上收到 6px（改前实测 20px）');
    assert.match(winner[1], /height\s*:\s*100dvh/, '★视口高改 `100dvh`（`100vh` 在手机上等于"地址栏收起时"的高度）');
    // 浮层那两处（实体观览窗 / 事件链）走类选择器就够——它们没有内联规则
    assert.match(MQ620, /\.sw2-window-mask,\.sw2-cv-mask\{height:100dvh;padding:6px;\}/,
        '★另外两张遮罩（实体观览窗 / 事件链 · 旧卷）同样是 dvh ＋ 6px');
    assert.match(MQ620, /\.sw2-ew-window,\.sw2-cv-box\{[^}]*max-height:100%[^}]*\}/,
        '★浮层在手机上占满整屏（用户 2026-09-27 当场选的那一档：整屏、四边留 6px）');
});

// ─────────────────── ④ 页签：一行横滑（两件事缺一不可） ───────────────────
test('★leg145·M4：页签一行横滑——`nowrap` ＋ 自己 `flex:none` ＋ 页签 `flex:none`（三条缺一条就露馅）', () => {
    const tabs = ruleOf(MQ620, '.sw2-tabs');
    assert.ok(tabs, '★手机那一档必须有 `.sw2-tabs{…}`');
    assert.match(tabs, /flex-wrap:nowrap/, '★页签行不折行（改前实测折 3–4 行占 130–172px 竖高）');
    assert.match(tabs, /flex:none/,
        '★★`.sw2-tabs` 自己也要 `flex:none`——`overflow-x:auto` 会让 `overflow-y` 跟着算成 auto'
        + '（规范如此）⇒ 它成了滚动容器 ⇒ 在外壳那个定高 flex 列里的"自动最小高度"变成 0 ⇒ **会被压扁**'
        + '（本笔实测过：页签行 12px、单枚 16px，整行几乎看不见）');
    assert.match(tabs, /overflow-x:auto/, '★横滑');
    assert.match(ruleOf(MQ620, '.sw2-tab'), /flex:none/,
        '★页签自己不许被压扁（flex 默认许缩 ⇒ 不写这条，"横滑"会变成"挤成一团"）');
});

// ─────────────────── ⑤ 版面：单列 ＋ 三处"许折行" ───────────────────
test('★leg145·M5：窄屏版面单列（设置 / 设定 / 旧卷三处 grid），且三处"挤不下就折行"都在', () => {
    assert.match(ruleOf(MQ620, '.sw2-settings,.sw2-sv-grid,.sw2-arch-grid'), /grid-template-columns:minmax\(0,1fr\)/,
        '★三处两栏 grid 在窄屏一律单列（改前实测：设置页要 406px 塞进 333px ⇒ 横向溢出 73px）');
    assert.match(ruleOf(MQ620, '.sw2-row'), /flex-wrap:wrap/, '★世界尺度那一行许折行');
    assert.match(ruleOf(MQ620, '.sw2-row > em'), /flex:1 1 auto/,
        '★那一行末尾的说明（`<em>`）基础规则是 `flex:1`（基准 0）⇒ 折行算法永远认为它放得下、'
        + '于是把它压成一条竖线（实测 360 宽：14px）；手机上必须把基准改回 `auto`');
    const g = ruleOf(MQ620, '.sw2-ents-g,.sw2-ch-g');
    assert.match(g, /flex-wrap:wrap/, '★两块工具栏许块内折行（实测"筛选"那块宽 450px，屏幕只有 297px）');
    assert.match(g, /flex:0 1 auto/,
        '★而且要松掉 `flex:none`——只松"能不能缩"：块整体折行照旧，只有"单块比一行还宽"时才在块内折');
    assert.match(ruleOf(MQ620, '.sw2-input,.sw2-ch-q,.sw2-ents-q,.sw2-param-input,.sw2-param-select,.sw2-field textarea'),
        /box-sizing:border-box/,
        '★输入框：`width:100%` ＋ 左右 padding ＋ 边框（默认 content-box）⇒ 实测比容器**宽 24px**，'
        + '窄屏上是"横着溢出的最后一根稻草"');
});

// ─────────────────── ⑥ 手感：点击目标与输入框字号（用户点头的那三个数） ───────────────────
test('★★leg145·M6：手指那一档的四组数（44 / 36 / 32 / 16px）都在，且不许用宽度条件代替', () => {
    assert.match(ruleOf(MQCOARSE, '.sw2-tab,.sw2-btn,.sw2-chip,.sw2-fchip,.sw2-model,.sw2-chainbtn'),
        /box-sizing:border-box/,
        '★这几个控件要 `border-box`——不然 `min-height` 只管内容盒，实测页签会变成 60px（本笔踩过一次）');
    assert.match(ruleOf(MQCOARSE, '.sw2-tab,.sw2-btn'), /min-height:44px/, '★主控件（页签 / 按钮）≥44px');
    assert.match(ruleOf(MQCOARSE, '.sw2-chip,.sw2-fchip,.sw2-model'), /min-height:36px/, '★密集片 ≥36px');
    assert.match(ruleOf(MQCOARSE, '.sw2-chainbtn'), /min-height:32px/, '★行内小钮（编年那枚「链」）≥32px——改前实测只有 14px');
    assert.match(ruleOf(MQCOARSE, '.sw2-close'), /width:44px;height:44px/, '★关窗那枚 ✕ ≥44px（改前 30px）');
    assert.match(ruleOf(MQCOARSE, '.sw2-input,.sw2-ch-q,.sw2-ents-q,.sw2-param-select,.sw2-param-input,.sw2-field textarea'),
        /font-size:16px/,
        '★★输入类一律 16px：iOS 上碰一个 <16px 的输入框会**整页放大**，而且回不去（改前实测 13px）');
    // ★这些规则**只许**住在 coarse 块里（不许混进宽度那一档：手机横过来有 800+ 宽，手指还是那根手指）
    assert.ok(!/min-height:44px/.test(MQ620), '★44px 那一族住在手感档，不许写进宽度档（两档分工见本文件抬头）');
});

// ─────────────────── ⑦ 字号：<12px 的一律抬到 12px（**棘轮**） ───────────────────
test('★★leg145·M7：手机上 <12px 的小字整批抬到 12px——**名单带棘轮**（新加一个小字类而没进名单 ⇒ 当场红）', () => {
    const small = smallFontSelectors(CSS);
    assert.ok(small.size >= 50, `前置：基础规则里 <12px 的选择器应当有一大批（实测 ${small.size} 条）——取不到 ⇒ 下面是空绿`);
    // 手机那一档里那条"整批抬字号"的规则
    const at = MQ620.indexOf('{font-size:12px;}');
    assert.ok(at > 0, '★手机那一档必须有那条"整批抬到 12px"的规则');
    // ★取**整条规则的选择器表**（它跨了好几行）：从上一个规则的 `}` 之后到 `{font-size:12px;}` 之前
    const start = MQ620.lastIndexOf('}', at) + 1;
    assert.ok(start > 0 && start < at, '前置：切到了那条规则的选择器表');
    const listed = new Set(MQ620.slice(start, at).split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean));
    // ★棘轮：基础规则里每一个 <12px 的选择器都必须在这份名单里（豁免见下）
    const EXEMPT = new Set();   // 本笔没有豁免：连徽与机器码也一起抬（用户 2026-09-27 点头那一档）
    const missing = [...small.keys()].filter((sel) => !listed.has(sel) && !EXEMPT.has(sel));
    assert.equal(missing.length, 0,
        `★★这 ${missing.length} 条小字没进手机那份名单（将来谁新加一个小字类，这条判据就会红）：\n  `
        + missing.map((s) => `${s} (${small.get(s)}px)`).join('\n  '));
    // ★反向自证：把名单里的一个选择器删掉 ⇒ 上面那条必须立不住（证明棘轮真的在咬名单）
    const one = [...small.keys()][0];
    const broken = listed.has(one) && !missing.includes(one);
    assert.ok(broken, `★反向自证：拿掉名单里的「${one}」之后，棘轮应当把它记成"漏了"（本条会红）`);
    // ★连带那一处：折叠问号那个圈要跟着放大（不然 12px 的字撑破 13px 的圈）
    assert.match(ruleOf(MQ620, '.sw2-fold > summary::before'), /width:15px;height:15px/,
        '★圈 13px → 15px（字号抬到 12px 之后的配套；这一条是"抬字"唯一的连带改动）');
});

// ─────────────────── ⑧ 桌面不动：手机那一族一条都不许漏进基础规则 ───────────────────
test('★leg145·M8：桌面口径没被动过（三条基础规则与两处既有断点原样）', () => {
    // 三条被手机档覆盖的基础规则，宽屏口径必须还是老样子（否则"桌面一个像素不动"就是空话）
    assert.match(ruleOf(CSS, '.sw2-entity-row'), /grid-template-columns:212px/,
        '★实体行宽屏仍是 `212px …` 三列（单列那条住在 620 里）');
    assert.match(ruleOf(CSS, '.sw2-settings'), /grid-template-columns:1fr 1fr/, '★设置页宽屏仍是两栏');
    assert.match(ruleOf(CSS, '.sw2-ew-window'), /width:984px;max-width:100%;height:auto;max-height:90%/,
        '★实体观览窗宽屏仍是 984px × 最高 90%（leg141 用户拍板的数）');
    // 既有那条 980 断点：一个字没动（本笔只搬了 620 那一条）
    const MQ980 = mediaBlock(CSS, '(max-width:980px)');
    assert.match(MQ980, /\.sw2-merged-grid\{grid-template-columns:minmax\(0,1fr\);height:auto;min-height:0;\}/,
        '★980 那条原样（并页两栏在窄屏退回单列＋取消定高）');
    assert.match(MQ980, /\.sw2-infoband\{flex-direction:column;\}/, '★980 那条里的信息带竖排原样');
    // 全表只许有这两条宽度断点（别偷偷再立第三条——"零零散散的设计要整合成一份"）
    const widthQueries = [...CSS.matchAll(/@media \(max-width:(\d+)px\)\{/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(widthQueries)].sort(), ['620', '980'], `★宽度断点只许 620 与 980 两条（现 ${widthQueries.join('/')}）`);
});
