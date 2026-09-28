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
export const STATUS_ID = 'sw2_status_text';

/** 写状态条那行字（玩家看到的"最近发生了什么"）。★没有 DOM ⇒ 静默返回，不抛。 */
export function setStatus(text) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(STATUS_ID);
    if (el) el.textContent = text;
}

/**
 * 未捕获异常那一句（原来写在 `web/index.js` 的 `onWinError` 里）。
 * ★搬来的同时**收成一处**：以前它自己 `getElementById('sw2_status_text')`，与 `setStatus` 是
 *   同一个格子的**两个写手**（本仓最忌讳的"两份真相"，虽然只是显示层）⇒ 现在只留一条路。
 */
export function reportTrouble(text, cause = null) {
    setStatus(`⚠ 未捕获异常：${text}`);
    try { console.warn('[story-world-v2]', text, cause); } catch (_) {}
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
