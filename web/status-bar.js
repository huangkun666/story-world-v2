// story-world-v2/web/status-bar.js
//
// ★★★leg109：**面板底下那一行字**（"状态条"）与**样式表注入**从 `web/index.js` 搬到这里。
//
// ＝＝ 为什么搬（不是为了好看，是行数锁逼出来的，如实登记）＝＝
//   接线层 `web/index.js` 有一条硬锁：**不许超过 3100 行**（`test/web-view-state-layout.test.js`）。
//   leg109 要做 B4（长活儿"正在跑"要看得见、连点第二下不许发第二串），细案原本算的是"净增 0 行"，
//   但那笔账**漏算了**"新模块还得被 import 一次、还得建一次"这两行 ⇒ 实测要 9 行，而当时余量只有 4 行。
//   ⇒ 用户当场拍板：**把状态条这一族搬出去**，腾出行数余量（接线层降到 3091 行）。
//   ★这一族搬得干净：它只干两件事——往那一个 `<span>` 里写一行字、把样式表挂上页头；
//     不依赖接线层里任何别的东西（**没有**"搬一段代码要盘自由名字"那一族坑，见 `web/param-panel.js`
//     头部那段 `WINDOW_ID` 的教训——这里一个自由名字都没有，全靠注入）。
//
// ＝＝ 纪律（与 `web/action-router.js` / `web/long-task.js` 同一把尺）＝＝
//   ① **模块顶层零 DOM**：`node --test` 能直接 import 本文件（本仓硬纪律，`browser-compat` 扫描覆盖）。
//      所以 `document` 一律在函数体里现取、都带 `typeof document === 'undefined'` 早退。
//   ② **没有 DOM 就静默降级、绝不抛**（Node 侧要能调——leg89 实测：导出的判据函数一调就
//      `ReferenceError: document is not defined`，那条判据等于没写）。
//   ③ **一件事只有一个写手**：状态条那行字的三个写入口（正常状态 / 未捕获异常 / 报告）全在本文件里，
//      别处一律调它们——这样"谁在什么时候改了那一行"只有一处可查。

/** 状态条那一个 `<span>` 的 id（`settings.html` 与 `web/index.js` 的兜底模板里都挂着它）。 */
import { diagnostics } from '../src/diagnostics.js';
export const STATUS_ID = 'sw2_status_text';

/** 全量状态留在调试页；顶部只显示进行中的操作和警告。没有 DOM 时仍记录日志。 */
export function setStatus(text) {
    const line = String(text ?? '');
    const warning = /失败|异常|注意/.test(line);
    diagnostics.record('状态', warning ? 'warn' : 'info', line);
    if (typeof document === 'undefined') return;
    const el = document.getElementById(STATUS_ID);
    if (!el) return;
    el.textContent = line;
    const bar = el.closest?.('.sw2-statusbar');
    if (bar) {
        const inProgress = /^(?:⏳|正在)|^[^·。]*中[（(…]/u.test(line);
        bar.style.display = warning || inProgress ? '' : 'none';
    }
}

/**
 * 未捕获异常那一句（原来写在 `web/index.js` 的 `onWinError` 里）。
 * ★搬来的同时**收成一处**：以前它自己 `getElementById('sw2_status_text')`，与 `setStatus` 是
 *   同一个格子的**两个写手**（本仓最忌讳的"两份真相"，虽然只是显示层）⇒ 现在只留一条路。
 */
export function reportTrouble(text, cause = null) {
    setStatus(`注意：未捕获异常：${text}`);
    try { console.warn('[story-world-v2]', text, cause); } catch (_) {}
}

/**
 * 本插件自己的根目录（`…/story-world-v2/`）——用来分辨"这条异常是不是我们抛的"。
 * ★**必须现算**：本文件在 `web/`,它的上一级就是插件根。
 *   写死 `story-world-v2` 就等于把目录名变成第二份真相（那份"安装契约"已经有一处了，见 README）。
 */
const SELF_BASE = new URL('../', import.meta.url).href;

/**
 * 这条未捕获异常**是不是本插件抛的**？
 *
 * ＝＝ 为什么需要它（leg145b · 用户实机报的）＝＝
 *   `web/index.js` 挂的是**全局** `window` 钩子（`error` ＋ `unhandledrejection`）
 *   ⇒ 页面上**任何**未捕获异常都会流到这里。实测那一回是 **SillyTavern 自带 TTS 扩展**抛的：
 *   `public/scripts/extensions/tts/system.js` 里有一段**只在手机/平板上跑**的 iOS 变通
 *   （`if (isMobile())` 之后在第一次点击时裸构造 `SpeechSynthesisUtterance`，**没做能力检测**）
 *   ⇒ 玩家的面板上印着 `⚠ 未捕获异常：SpeechSynthesisUtterance is not defined`，
 *   而**这个插件一行语音代码都没有**（全仓 `speechSynthesis` 零命中）。
 *   状态条那行字本该只说自己的事——这就是"两处真相"在显示层的形状。
 *
 * ★口径（保守优先）：**拿不到出处就当自己的**——宁可多报一句，也绝不许把自己的错悄悄吞掉。
 *   ① `error` 事件：看 `e.filename`（出错的那个脚本地址）——它可靠，有它就以它为准；
 *   ② 没有 `filename` 时看 stack（`unhandledrejection` 走这条：rejection 事件不带 filename）；
 *   ③ 两头都拿不到 ⇒ 算自己的。
 * @param {any} e `error` 或 `unhandledrejection` 事件对象
 * @returns {boolean}
 */
export function isOwnError(e) {
    try {
        const file = String(e?.filename || '');
        if (file) return file.includes(SELF_BASE);
        const stack = String(e?.error?.stack || e?.reason?.stack || '');
        if (stack) return stack.includes(SELF_BASE);
        return true;
    } catch (_) {
        return true;                 // 判别本身出错 ⇒ 当自己的（不许因此把那句话吞掉）
    }
}

/**
 * 未捕获异常的**分流口**（`web/index.js` 的两个 `addEventListener` 直接挂它）。
 * · **自己的** ⇒ 照旧 `reportTrouble`（状态条 ＋ 控制台）；
 * · **别人的** ⇒ ★**只进控制台**——状态条那行字重新属于这个插件。
 *   ★为什么别人的也要留痕：**"看不到"比"看错"更坏**——排查时你还得知道页面上有别人在报错。
 * @param {any} e `error` 或 `unhandledrejection` 事件对象
 */
export function reportWinError(e) {
    try {
        const text = String(e?.message || e?.reason?.message || e?.reason || '未知异常');
        const cause = e?.reason || e || null;
        if (isOwnError(e)) { reportTrouble(text, cause); return; }
        try { console.warn('[story-world-v2] 这条异常不是本插件抛的（故不进状态条）', text, cause); } catch (_) {}
    } catch (_) {}
}

/**
 * 样式表的地址。★与 `web/index.js` **同在 `web/` 目录** ⇒ 这一句在两个文件里算出来是**同一个串**
 *   （搬家的前提，已核）。★★但那个**版本号**（`CSS_VERSION`）**没有搬**：它必须留在
 *   `web/index.js`（`test/render.test.js` 是按那个文件里的 `const CSS_VERSION = '…'` 取值的，
 *   连"样式表内容指纹"那条判据都挂在它上面）。所以改号时**只改 `web/index.js` 那一处**，
 *   本文件这一句只是"把号拼进地址"。
 */
export const CSS_HREF = new URL('./style.css', import.meta.url).href;

/**
 * 把样式表挂上页头（带版本号，防浏览器吃旧样式）。
 * ★先删掉**它自己上次插的那一条**（认 `data-sw2css` 标记）——删不掉 `manifest.json` 声明的那一条
 *   （那条不带标记），两条并存是 leg102/leg103 已登记的现状，不在本笔范围内。
 * @param {string} cssVersion 由接线层传进来（真源在 `web/index.js` 的 `CSS_VERSION`）
 */
export function injectCss(cssVersion) {
    try {
        if (typeof document === 'undefined') return;
        for (const link of document.querySelectorAll('link[data-sw2css]')) link.remove();
        const el = document.createElement('link');
        el.rel = 'stylesheet';
        el.dataset.sw2css = '1';
        el.href = `${CSS_HREF}?v=${cssVersion}`;
        document.head.appendChild(el);
    } catch (_) {}
}

/** ★leg162：外壳动作条右端那格状态的 id（`settings.html` 与回退壳里都挂着它）。 */
export const ACTIONBAR_STATE_ID = 'sw2_advance_state';

// ════════════════════════════════════════════════════════════════════════════════
// ★★★leg162：**总闸那一族**（键名 · 一次性迁移 · 判据）从 `web/index.js` 搬到这里。
//   为什么搬：接线层有 3100 行硬锁，而这一笔（动作条）净加 24 行 ⇒ 须腾余量；
//   为什么搬**到这里**：它们与本文件的 `syncActionbar` 是**同一件事的两半**——
//     那一格状态印的就是这个判据的结论（"发消息会不会自动推进"）。
//   为什么搬得干净：整族只读/写 `world.context.setting.dynamic.env` 一个格子，
//     **零依赖**（不 import 接线层任何东西，也没有自由名字）⇒ 与 `CSS_HREF` 那次搬迁同一口径。
// ════════════════════════════════════════════════════════════════════════════════

/** 总闸在账上的键名（`src/params.js` 的 `SWITCH_PARAMS.autoAdvance`；值是 '1'/'0'）。 */
export const AUTO_ADVANCE_KEY = 'autoAdvance';

/**
 * ★leg33d：**存量世界的一次性迁移**（原来住 `web/index.js`，leg162 随总闸那一族搬来）。
 *   口径三条（都能机械核）：
 *     ① 已显式写过（含玩家手动关）⇒ **不碰**（尊重显式选择，且保证幂等）；
 *     ② 该世界已有推进史（`meta.simLog` 非空）⇒ 迁成 `'1'`（维持"升级前后一字不变"）；
 *     ③ 全新世界（无史）⇒ `'0'`（照 `params.js` 的出厂值：新世界要你按一下「开始」才动）。
 *   病（它当年的来路）：缺省关若直接落到**存量世界**上，会把正在跑的世界悄悄按停——那是事故，不是功能。
 * @returns {boolean} 真的写了吗（调用方据此决定要不要落盘）
 */
export function ensureAutoAdvanceKey(world) {
    const dyn = world?.context?.setting?.dynamic;
    if (!dyn) return false;
    const env = { ...(dyn.env || {}) };
    if (Object.prototype.hasOwnProperty.call(env, AUTO_ADVANCE_KEY)) return false;   // 已显式写过（含你手动关）⇒ 不碰
    const hasHistory = Array.isArray(world?.meta?.simLog) && world.meta.simLog.length > 0;
    env[AUTO_ADVANCE_KEY] = hasHistory ? '1' : '0';
    world.context.setting = { ...world.context.setting, dynamic: { ...dyn, env } };
    return true;
}

/**
 * 闸的读法：**只有显式 '1' 算开**（缺键=关，与 `src/param-hub.js` 的 `switchOn` 同口径；
 * 这里多收一个"世界"以免调用点自己 guard）。★它读的是**账上镜像**——要与参数页那个开关
 * 同一时刻说话请走 `syncActionbar` 的真源那一路（两者的分工写在那边的函数头注释里）。
 */
export function autoAdvanceOn(world) {
    return String(world?.context?.setting?.dynamic?.env?.[AUTO_ADVANCE_KEY] ?? '') === '1';
}
/** 供测试注入（`node --test` 里用假 world 直接验闸，不必起浏览器）。★leg162 随本族一起搬到这里的。 */
export const sw2AutoAdvanceOn = (world) => autoAdvanceOn(world);

/**
 * ★★★leg162：**外壳动作条右端那一格状态**——「现在发消息，世界会不会自己往前走？」
 *
 * ＝＝ 它答的是什么 ＝＝
 *   用户令「**上移就是独立于设置页了，不是只有在设置页显示，而是整个窗口的上方**」⇒
 *   设置页那张「操作」卡整张撤掉（卡里除了两枚按钮，剩下的是 96 字解释，其中一句正是
 *   "每轮对话后世界自动推进（总闸开着时）"）。**那句话说的是一个真状态，不能随卡一起消失**
 *   ——否则玩家关掉总闸之后，在面板上**看不出后果**（"世界怎么不动了"会被当成 bug，
 *   `test/plugin-master-switch.test.js` ⑷ 早就为这件事立过判据）。
 *   ⇒ 它改由这一格承担：**读总闸真值**，开着说「世界随对话自动推进」、关着说「已暂停 · 不会自动推进」。
 *
 * ＝＝ ★★为什么读真源、不读账上镜像（这是本函数唯一的结构选择，别改）＝＝
 *   `web/index.js` 的 `autoAdvanceOn(world)` 读的是 `world.context.setting.dynamic.env`——
 *   那是**镜像**（leg41 起真源搬进插件存储，账上那份是照抄，会滞后一拍）。
 *   本格要与**参数页那个开关**在同一时刻说同一句话 ⇒ 必须问**那个开关自己的裁决处**。
 *   ⇒ 依赖由调用方**注入**（本文件不 import 接线层，免得绕回去，同 `CSS_HREF` 那条注释的口径）：
 *     · `envOf()`  取参数真源（生产＝`paramApi.displayEnv(...)` ＋ 页面上控件此刻的值）
 *     · `onOf()`   取总闸布尔（生产＝接线层那个读镜像的兜底）
 *
 * ＝＝ 边界（三条，与 `long-task.js` 同款纪律）＝＝
 *   ① **拿不到节点 / 拿不到真源 ⇒ 静默降级**，绝不抛、绝不猜一句话印出来；
 *   ② **不写死文案**：两句由真值分派（写死就是本仓最忌的"第二份真相"）；
 *   ③ 只管**这一格**，不碰别的 DOM（动作条那两枚按钮的接线是 window 级委托，与本函数无关）。
 *
 * @param {any} world 当前世界（可空——空表示"还没有世界"）
 * @param {{liveEnvOf?:Function, envOf?:Function, onOf?:Function}} deps
 *   · `liveEnvOf()` 页面上控件此刻的值（最高顺位；取不到 ⇒ undefined）
 *   · `envOf(world)` 参数真源那个裁决处（`paramApi.displayEnv`）
 *   · `onOf(world)` **账上镜像**那条兜底（只在真源取不到时用；无世界 ⇒ 交 null）
 */
export function syncActionbar(world, { liveEnvOf = null, envOf = null, onOf = null } = {}) {
    try {
        if (typeof document === 'undefined') return;
        const el = document.getElementById(ACTIONBAR_STATE_ID);
        if (!el) return;                                  // 模板没挂上 / 回退壳里没有 ⇒ 什么都不做
        let on = null;
        try {
            const live = liveEnvOf?.() || null;
            const env = (live && live.env) || envOf?.(world) || null;
            if (env && Object.prototype.hasOwnProperty.call(env, 'autoAdvance')) {
                on = String(env.autoAdvance ?? '') === '1';
            }
        } catch (_) { /* 真源取不到 ⇒ 退下面那一档，绝不抛 */ }
        if (on == null) {
            const v = onOf?.(world);
            if (v == null) return;                        // 还没有世界 ⇒ 这一格留空（"空着就是空着"）
            on = !!v;
        }
        el.textContent = on ? '世界随对话自动推进' : '已暂停 · 不会自动推进';
        el.classList.toggle('sw2-paused', !on);
    } catch (_) { /* 状态格不许影响面板渲染（与注入那次失败同一口径） */ }
}
