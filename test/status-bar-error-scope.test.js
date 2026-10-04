// story-world-v2/test/status-bar-error-scope.test.js
//
// ★★★leg145b（用户实机报的）：**面板状态条替别人背锅** —— `Uncaught ReferenceError:
//   SpeechSynthesisUtterance is not defined` **不是这个插件抛的**，却印在它的状态条上。
//
// ＝＝ 病（逐环取证，不是推演）＝＝
//   ① 抛错的是 **SillyTavern 自带的 TTS 扩展**：`public/scripts/extensions/tts/system.js`
//      的 `SystemTtsProvider.loadSettings` 里有一段**只在手机/平板上跑**的 iOS 变通——
//      `if (isMobile()) { document.addEventListener('click', () => { const u = new SpeechSynthesisUtterance(' . '); … }) }`
//      （`isMobile()` = UA 的 `platform.type ∈ {mobile, tablet}`）。
//      ★它**裸构造、没做能力检测**：同文件里那五处 `'speechSynthesis' in window` 守卫管的是别处
//      （设置页 HTML / `getVoices()`），**一处也管不到这个 click 处理器**。
//      ⇒ 在**不实现 Web Speech 合成**的手机浏览器 / 内嵌 WebView 上，你点第一下页面它就 ReferenceError。
//      ★全仓核过：`SpeechSynthesisUtterance` / `speechSynthesis` 在 `F:\deepseek\plugins` 里**零命中**
//      ——这个插件压根不碰语音。
//   ② 那它为什么印在**我们的**状态条上：`web/index.js` 挂的是**全局** `window` 钩子
//      （`addEventListener('error', …)` ＋ `addEventListener('unhandledrejection', …)`）
//      ⇒ 页面上**任何**未捕获异常都会被写进状态条。
//   ⇒ 后果不是"功能坏了"，而是：**状态条那行字不再属于这个插件**（玩家看到的是别人的错、
//     还挂着 `⚠`），而真正的自家异常被淹在里面。这正是本仓最忌讳的"两处真相"在显示层的形状。
//
// ＝＝ 治法（口径写在 `web/status-bar.js` 的 `isOwnError` / `reportWinError` 上）＝＝
//   · **自己的错**（出处落在本插件目录里）⇒ 照旧进状态条 ＋ 控制台。
//   · **别人的错** ⇒ **不进状态条**，但**必须进控制台**（不许悄悄吞——"看不到"比"看错"更坏）。
//   · **拿不到出处**（无 `filename`、无 stack）⇒ **当自己的**：宁可多报一句，也不许把自己的错吞掉。
//
// ＝＝ 为什么这些判据长这样 ＝＝
//   ★第 1 条是**前置自证**：没有它，"别人的错不写状态条"这条**一个什么都不写的实现也能过**
//     （空绿）。所以先证明"写作这条路是通的"，再证明"该拦的真拦住了"。
//   ★第 3 条咬的是**判据本身的分辨率**：反例与正例**同协议、同前缀、只差一个目录名**
//     （`…/plugins/story-world/` vs `…/plugins/story-world-v2/`）——"只看协议/只看前缀"的假判过不了它。
//   ★第 6 条是**接线锁**：分流逻辑必须真挂在两个事件上，而且插件目录**必须现算**
//     （写死 `story-world-v2` 就等于把目录名变成第二份真相——安装契约那一处已经有一份了）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reportWinError, isOwnError } from '../web/status-bar.js';

/** 状态条那一个格子的 id（照 `web/status-bar.js` 的 `STATUS_ID`）。 */
const STATUS_ID = 'sw2_status_text';

/** 正例：**本插件自己**的脚本地址。★与实现**各自独立算**（这里从 `test/` 往上一级再进 `web/`）。 */
const OWN_URL = new URL('../web/index.js', import.meta.url).href;

/** 反例：**同一个 `file://` 前缀、只差一个目录名**的兄弟仓（`story-world` ≠ `story-world-v2`）。
 *  ★`../../` 从 `test/` 退到 `plugins/`——那底下**真的**并排躺着 `story-world` 与 `story-world-v2`
 *    （本机实测），所以这不是编出来的路径。 */
const SIBLING_URL = new URL('../../story-world/legacy.js', import.meta.url).href;

/** 反例：真实的现场来源——SillyTavern 自带 TTS 的脚本地址（与插件不在同一棵树下）。 */
const ST_TTS_URL = 'https://example.invalid/scripts/extensions/tts/system.js';

/** 装一个只有状态条格子的假 DOM，跑完还原（照 `test/param-hub.test.js` 同一把尺）。 */
function withStatusBox(fn) {
    const saved = globalThis.document;
    const box = { textContent: '' };
    globalThis.document = { getElementById: (id) => (id === STATUS_ID ? box : null) };
    try {
        return fn(box);
    } finally {
        if (saved === undefined) delete globalThis.document; else globalThis.document = saved;
    }
}

/** 收走这段期间 `console.warn` 说了什么（别人抛的错必须留痕，所以这条要能被看见）。 */
function captureWarn(fn) {
    const saved = console.warn;
    const lines = [];
    console.warn = (...a) => { lines.push(a.map((x) => String(x)).join(' ')); };
    try { fn(); } finally { console.warn = saved; }
    return lines;
}

test('★★leg145b ①（★前置自证）：**自己的错**必须真进状态条——这一条不过，下面那条"别人的错不写"就是空绿', () => {
    const e = { message: '世界步超时（自家异常）', filename: OWN_URL, error: new Error('世界步超时（自家异常）') };
    withStatusBox((box) => {
        captureWarn(() => reportWinError(e));
        assert.equal(box.textContent, '注意：未捕获异常：世界步超时（自家异常）',
            '★自家异常必须照旧写进状态条（分流不许把自家的话也拦掉）');
    });
});

test('★★leg145b ②：**别人抛的错不进状态条**，但必须进控制台（不许悄悄吞）', () => {
    const e = { message: 'SpeechSynthesisUtterance is not defined', filename: ST_TTS_URL, error: new ReferenceError('SpeechSynthesisUtterance is not defined') };
    withStatusBox((box) => {
        const warned = captureWarn(() => reportWinError(e));
        assert.equal(box.textContent, '',
            '★ST 的 TTS 扩展抛的错不许再印在本插件状态条上（这就是用户实机看到的那一条）');
        assert.equal(warned.length, 1, '★但必须留一条控制台记录——"看不到"比"看错"更坏');
        assert.ok(warned[0].includes('SpeechSynthesisUtterance'), `★留痕里要带上原文，实测：${warned[0]}`);
    });
});

test('★★leg145b ③：**同协议、同前缀、只差一个目录名**的兄弟仓，也算"别人的"（防只看协议/前缀的假判）', () => {
    assert.equal(isOwnError({ filename: OWN_URL }), true, `前置：正例必须判自家（${OWN_URL}）`);
    assert.equal(isOwnError({ filename: SIBLING_URL }), false,
        `★\`${SIBLING_URL}\` 与正例同协议同前缀、只差目录名 ⇒ 必须判"别人的"（否则这条判据分辨率不够）`);
    withStatusBox((box) => {
        captureWarn(() => reportWinError({ message: '兄弟仓炸了', filename: SIBLING_URL }));
        assert.equal(box.textContent, '', '★兄弟仓的错也不许进状态条');
    });
});

test('★leg145b ④：**拿不到出处**（无 filename、无 stack）⇒ 当自己的（宁可多报，也不许吞掉自家的错）', () => {
    assert.equal(isOwnError({}), true, '★两头都拿不到出处 ⇒ 当自己的');
    assert.equal(isOwnError({ filename: '' }), true, '★空 filename 等于没出处 ⇒ 当自己的');
    withStatusBox((box) => {
        captureWarn(() => reportWinError({ message: '匿名异常' }));
        assert.equal(box.textContent, '注意：未捕获异常：匿名异常', '★没出处的那种照旧要写（保守优先）');
    });
});

test('★leg145b ⑤：`unhandledrejection` 没有 `filename`，改看 `reason.stack` 落在哪一边', () => {
    const ours = new Error('自家的 promise 炸了');
    ours.stack = `Error: 自家的 promise 炸了\n    at ${OWN_URL}:1:1`;
    const theirs = new Error('别人家的 promise 炸了');
    theirs.stack = `Error: 别人家的 promise 炸了\n    at ${ST_TTS_URL}:1:1`;

    assert.equal(isOwnError({ reason: ours }), true, '★stack 落在本插件目录 ⇒ 自家的');
    assert.equal(isOwnError({ reason: theirs }), false, '★stack 落在别处 ⇒ 别人的');

    withStatusBox((box) => {
        captureWarn(() => reportWinError({ reason: ours }));
        assert.equal(box.textContent, '注意：未捕获异常：自家的 promise 炸了', '★自家的 rejection 照旧要写');
        box.textContent = '';
        const warned = captureWarn(() => reportWinError({ reason: theirs }));
        assert.equal(box.textContent, '', '★别人的 rejection 不许进状态条');
        assert.equal(warned.length, 1, '★但别人的 rejection 也要留痕');
    });
});

test('★★leg145b ⑥（接线锁）：分流真挂在两个事件上 ＋ 插件目录**现算**（不许写死目录名）', () => {
    const index = readFileSync(new URL('../web/index.js', import.meta.url), 'utf8');
    const bar = readFileSync(new URL('../web/status-bar.js', import.meta.url), 'utf8');

    assert.match(index, /addEventListener\('error',\s*reportWinError\)/,
        '★`error` 事件必须挂到分流的那个口上（挂回旧写法 = 病回来）');
    assert.match(index, /addEventListener\('unhandledrejection',\s*reportWinError\)/,
        '★`unhandledrejection` 同理');
    assert.ok(!/function\s+onWinError\b/.test(index),
        '★旧的 `onWinError`（不过滤、什么都报）不许再留在接线层——那就是"两个写手写同一格"');

    assert.match(bar, /export\s+function\s+reportWinError\b/, '★分流口必须在 `web/status-bar.js` 里（状态条那行字只有一处写手）');
    assert.match(bar, /export\s+function\s+isOwnError\b/, '★判别口要能被判据直接调（否则第 ③④⑤ 条只能靠集成测试碰运气）');
    assert.match(bar, /new URL\('\.\.\/',\s*import\.meta\.url\)/,
        '★插件根目录必须**从 `import.meta.url` 现算**——写死 `story-world-v2` 就是第二份"安装契约"真相');
});
