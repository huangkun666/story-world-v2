// story-world-v2/test/style-cues-layout.test.js
// ★★★leg104（样式一批）：**「看得见的信号」判据** —— 哪些能点 / 哪些不能点 / 哪几格亮着 / 窄屏有没有丢内容。
//
// 这一批治的四条（全部**读 CSS 就能算出来或查得到**，不靠眼睛——本仓没有浏览器，leg89 §5.5）：
//   ① **不能点的按钮必须看得出来**：全仓此前**零 `:disabled` 规则**（grep 实测），而 `src/render.js`
//      真的在产出 disabled 按钮（`:693` 参数页「撤销改写」· `:1252/:1254` 编年分页器 ·
//      `:1560/:1562` 实体分页器）⇒ 翻不动的翻页键**带着手型、hover 还变色**，点了没反应。
//   ② **假可点**：`.sw2-chip` 基础规则给了 `cursor:pointer`，而 `settings.html:13-14` 那两枚 chip 是
//      **纯 `<span>`**（「世界：—」/「轮次」，没有动作）⇒ 看着能点、点了一点反应没有。
//   ③ **没点亮的格子看不见**：`.sw2-dotstep` / `.sw2-gearbar i` 的"灭"态对卡片底只有 **1.07–1.10:1**。
//   ④ **窄屏丢内容**：信息带首栏写死 `flex:0 0 340px` ＋ 带子自己 `overflow:hidden` ⇒ 右栏被**裁掉**。
//
// 形态纪律：★对比度是**算出来的**（WCAG 相对亮度公式），不是人眼说的；★每条都带**反向自证**——
//   拿**旧值**算一遍必须**不达标**（否则这条判据是恒真的空绿，leg103 §6.1 那族的病）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

/** 去 CSS 注释（本仓注释里大量**引用旧值与旧话**——不去会把判据自己骗红）。 */
const cut = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
/** 取某条选择器的声明块（`sel{...}` 的第一段）。 */
function ruleOf(css, sel) {
    const at = css.indexOf(`${sel}{`);
    if (at < 0) return '';
    const end = css.indexOf('}', at);
    return end < 0 ? '' : css.slice(at + sel.length + 1, end);
}
/** 取某条媒体查询的整块（到列首那个 `}` 为止）。 */
function mediaBlock(css, query) {
    const at = css.indexOf(`@media ${query}{`);
    if (at < 0) return '';
    const end = css.indexOf('\n}', at);
    return end < 0 ? '' : css.slice(at, end + 2);
}
const cssVar = (css, name) => (new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(css) || [])[1] || '';
/** WCAG 相对亮度（算对比度用；判据里的对比度一律走这两个函数，不许手写近似值）。 */
function relLum(hex) {
    const lin = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
const contrast = (a, b) => {
    const x = relLum(a);
    const y = relLum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const CSS = cut(read('web/style.css'));

// ---------- ① 不能点的按钮必须看得出来（`:disabled`）----------
test('★leg104·SCue①：`:disabled` 真的存在、真的压住 hover 那一族，且顺序在它之后', () => {
    // ★前置自证：产品真的在产出 disabled 按钮（否则这族规则没有对象）
    const rj = read('src/render.js');
    const nDisabled = (rj.match(/' disabled'/g) || []).length;
    assert.ok(nDisabled >= 4, `前置：\`src/render.js\` 必须真的在产出 disabled 按钮（实测 ${nDisabled} 处）`);
    const off = ruleOf(CSS, '.sw2-btn:disabled');
    assert.ok(off, '★★必须有 `.sw2-btn:disabled` 这条规则（全仓此前零 `:disabled`）');
    assert.match(off, /cursor\s*:\s*not-allowed/, '★不能点的按钮必须给 `not-allowed`（不是手型，也不是箭头）');
    assert.match(off, /opacity\s*:\s*(0?\.\d+)/, '★并且要看得出来"它现在是灰的"');
    // ★同特异性靠**顺序**赢：压 hover 的那几条必须排在这一族 hover 之后
    const pairs = [
        ['.sw2-btn:hover', '.sw2-btn:disabled:hover'],
        ['.sw2-btn.sw2-primary:hover', '.sw2-btn.sw2-primary:disabled:hover'],
        ['.sw2-btn.sw2-danger:hover', '.sw2-btn.sw2-danger:disabled:hover'],
    ];
    for (const [live, guard] of pairs) {
        const a = CSS.indexOf(`${live}{`);
        const b = CSS.indexOf(`${guard}{`);
        assert.ok(a > 0, `前置：\`${live}\` 在表里（否则下面那条比较是空绿）`);
        assert.ok(b > 0, `★必须有 \`${guard}\`——把"悬停还是会变"那条压住（不能点的按钮不许画得像能点）`);
        assert.ok(b > a, `★\`${guard}\` 必须排在 \`${live}\` **之后**（同特异性下靠后赢；排前面等于没写）`);
    }
});

// ---------- ② 假可点：手型只给真的是按钮的 chip ----------
test('★leg104·SCue②：`.sw2-chip` 不再一律给手型；★两面都锁（span 那侧不许有、button 那侧必须有）', () => {
    const base = ruleOf(CSS, '.sw2-chip');
    assert.ok(base, '前置：取到了 `.sw2-chip` 基础规则');
    assert.ok(!/cursor\s*:\s*pointer/.test(base), '★★基础规则不许给手型（那两枚是纯 `<span>` ⇒ 看着能点却点不动）');
    assert.match(base, /cursor\s*:\s*default/, '★基础态明确写 `default`（不是"不写"，不写会继承父级）');
    assert.match(CSS, /button\.sw2-chip\{[^}]*cursor\s*:\s*pointer/, '★真的是按钮的那些必须给手型（否则工具条变成"看着不能点"）');
    // ★两面各自的**对象**都得真在（不然这两条都是空绿）
    const sh = read('settings.html');
    assert.match(sh, /<span class="sw2-chip" id="sw2_world_chip"/, '前置：页头那枚 chip 真的是 `<span>`');
    assert.match(sh, /<span class="sw2-chip sw2-tick" id="sw2_tick_chip"/, '前置：轮次那枚也是 `<span>`');
    assert.ok(!/sw2_(world|tick)_chip[^>]*data-action/.test(sh), '★它们**没有动作**（所以不该有手型——这就是"假可点"那一条）');
    assert.match(read('src/render.js'), /<button class="sw2-chip/, '前置：`src/render.js` 真的在产出 `<button class="sw2-chip">`（工具条/筛选行）');
});

// ---------- ③ 没点亮的格子必须看得见（对比度是**算**出来的）----------
test('★★leg104·SCue③：灭的那一格改用 `--sw2-text-faint`（≥3:1），★拿旧值算必须不达标（反向自证）', () => {
    const v = {
        card: cssVar(CSS, '--sw2-card'),
        card2: cssVar(CSS, '--sw2-card-2'),
        lineSoft: cssVar(CSS, '--sw2-line-soft'),
        faint: cssVar(CSS, '--sw2-text-faint'),
        amber: cssVar(CSS, '--sw2-amber'),
    };
    for (const [k, hex] of Object.entries(v)) assert.match(hex, /^#[0-9a-f]{6}$/i, `★取不到 \`--sw2-${k}\`（后面的对比度就全是空绿）`);
    // 三处"灭"态都必须指向 faint
    assert.match(ruleOf(CSS, '.sw2-dotstep'), /background\s*:\s*var\(--sw2-text-faint\)/, '★`--sw2-dotstep`（盘算步点）的灭态');
    assert.match(ruleOf(CSS, '.sw2-gearbar i'), /background\s*:\s*var\(--sw2-text-faint\)/, '★档位条灭的那几格');
    assert.match(ruleOf(CSS, '.sw2-gearbar-unset i'), /var\(--sw2-text-faint\)/, '★"没有数据"那一档的虚框同理');
    // ★算：灭 ≥3:1（WCAG 对"有含义的图形"那条线）· 亮 ≥4.5:1 · 且两者差得开
    const cOff = contrast(v.faint, v.card);
    const cOn = contrast(v.amber, v.card);
    assert.ok(cOff >= 3, `★★灭的那一格对卡片底必须 ≥3:1——现为 ${cOff.toFixed(2)}:1（低了就等于没画）`);
    assert.ok(cOn >= 4.5, `★亮的那一格 ≥4.5:1——现为 ${cOn.toFixed(2)}:1`);
    assert.ok(cOn - cOff >= 1.5, `★亮/灭必须分得开（现差 ${(cOn - cOff).toFixed(2)}）——不然"3/4"还是只能读成"3"`);
    // ★★反向自证：旧值必须不达标（这条判据抓的正是那个病，不是任何色都能过）
    const cCard2 = contrast(v.card2, v.card);
    const cLineSoft = contrast(v.lineSoft, v.card);
    assert.ok(cCard2 < 2, `★★反向自证：旧的 \`--sw2-card-2\` 对卡片底只有 ${cCard2.toFixed(2)}:1 ⇒ 当初正是它看不见`);
    assert.ok(cLineSoft < 2, `★★反向自证：旧的 \`--sw2-line-soft\` 同理（${cLineSoft.toFixed(2)}:1）——所以"换个更亮的色"不是随便挑的`);
});

// ---------- ④ 窄屏不许丢内容（信息带竖排 + 实体行单列）----------
test('★★leg104·SCue④：窄屏兜底在（980 信息带竖排 · 620 实体行单列），且宽屏那条口径一个字没放宽', () => {
    // ★病根仍在盘上（这正说明窄屏兜底是**必要**的）：首栏写死 340px ＋ 带子自己 overflow:hidden
    assert.match(ruleOf(CSS, '.sw2-infoband > .sw2-band-block:first-child'), /flex\s*:\s*0 0 340px/,
        '前置：宽屏口径（首栏定宽 340px）仍在——窄屏那条是**兜底**，不是把它改掉');
    assert.match(ruleOf(CSS, '.sw2-infoband'), /overflow\s*:\s*hidden/,
        '前置：带子自己仍是 `overflow:hidden`（所以窄屏不竖排 = 右栏**真被裁掉**）');
    const mq980 = mediaBlock(CSS, '(max-width:980px)');
    assert.ok(mq980.length > 100, '前置：切到了 980 那条媒体查询的真块');
    assert.match(mq980, /\.sw2-infoband\{flex-direction:column;\}/, '★★窄屏信息带必须**竖排**（两段各占一行）');
    assert.match(mq980, /\.sw2-infoband > \.sw2-band-block:first-child\{flex:1 1 auto;\}/, '★首栏在窄屏放开定宽');
    assert.match(mq980, /\.sw2-band-block \+ \.sw2-band-block\{border-left:none;border-top:1px solid var\(--sw2-line-soft\);\}/,
        '★分界线从竖改横（否则两段之间没有界线）');
    const mq620 = mediaBlock(CSS, '(max-width:620px)');
    assert.ok(mq620.length > 40, '前置：切到了 620 那条（本条是本笔新加的**第二条断点**）');
    assert.match(mq620, /\.sw2-entity-row\{grid-template-columns:minmax\(0,1fr\);/, '★实体行在窄屏改单列（首列 212px 写死在宽屏那条口径里）');
    // ★★反向自证：把 980 那条里的信息带三条删掉 ⇒ 上面那三条断言必须立不住
    const broken = mq980.replace(/ {2}\.sw2-infoband\{flex-direction:column;\}/, '');
    assert.notEqual(broken, mq980, '前置：确实删掉了（否则这条自证是空转）');
    assert.ok(!/\.sw2-infoband\{flex-direction:column;\}/.test(broken), '★反向自证：删掉之后"窄屏竖排"找不到对象 ⇒ 本条会当场红');
});

