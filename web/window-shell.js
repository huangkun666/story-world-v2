// story-world-v2/web/window-shell.js
// ★★★leg161：**观棋窗口那一族的壳**（压顶样式 · 去重 · 取模板 · 开 · 关 · 挂菜单入口）——
//   从 `web/index.js` 搬出来的一族。
//
// 【为什么搬】`web/index.js` 有**硬锁 `<3100` 行**（`test/web-view-state-layout.test.js`），
//   而 leg161 要往接线层加东西（记忆通道那一族接回来 ＋ 聊天侧那条向量召回口）。
//   照本仓既有纪律：**要往接线层加东西，先把一族搬出去**
//   （leg79 视图态 · leg80 取书族 · leg82 参数族 · leg142 模型通道 · leg150 候选池 · leg161 本族）。
//
// 【★这一族只碰"窗口壳"，不碰账、不碰渲染】它管的是：那层遮罩在不在、模板取没取到、
//   开着的类名、Esc/叉号收起、扩展菜单里那个入口。
//   ⇒ 账与渲染全归调用方（`web/index.js` 那几处调用点一个字没变，只是从"本文件里的函数"
//     变成"这个工厂交出来的函数"）。
//
// 【纪律】顶层零 DOM 访问（全部惰性函数内调用 + 守卫）；零 Node 内建依赖
//   （`test/browser-compat.test.js` 的扫描面）；★依赖一律**注入**，不 import 接线层（免得绕回去）。

/**
 * @param {object} deps
 * @param {string}   deps.windowId   那层遮罩的 id（生产＝`web/index.js` 的 `WINDOW_ID`）
 * @param {Function} [deps.getViewState] 取视图态 hub（收起时重置两个视图；取不到 ⇒ 跳过）
 * @param {Function} [deps.setStatus]    写状态条那一行字
 * @returns {{modalBoost:Function, dedupWindows:Function, ensureWindow:Function, openWindow:Function, closeWindow:Function, ensureWandEntry:Function}}
 */
export function createWindowShell({ windowId, getViewState = null, setStatus = null } = {}) {
    const WINDOW_ID = String(windowId || '');
    const say = (m, options) => { try { setStatus?.(m, options); } catch (_) { /* 状态条不许影响收起 */ } };

    /** 弹窗压顶内联规则（v1 同款：id 特异性保证任何加载顺序下固定位、压过 ST 自身弹层） */
    function modalBoost() {
        try {
            const style = document.createElement('style');
            style.textContent = `#${WINDOW_ID}{position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;z-index:50000;display:none;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;background:rgba(13,16,21,.55)}`
                + `#${WINDOW_ID}.sw2-open{display:flex}`;
            document.head.appendChild(style);
        } catch (_) {}
    }

    /** 同一个 id 的遮罩只许留一个（热重载/重复挂载会叠出好几层） */
    function dedupWindows() {
        try {
            const wins = document.querySelectorAll(`#${WINDOW_ID}`);
            for (let i = wins.length - 1; i > 0; i -= 1) wins[i].remove();
        } catch (_) {}
    }

    // ★★★leg162：**动作条照旧在回退壳里也画一份**（与 `settings.html` 同形）——
    //   本仓既有纪律：回退路不许比正路少东西（模板取不到时玩家仍要能推、能开新世界）。
    //   ★那两枚按钮的接线不看这张壳：`data-action` 是 window 级委托（`web/index.js` 的 `bindActions`）。
    // ★★★leg165：两枚动作按钮上的 emoji（✨ ▶）撤掉（用户令「emoji 不要了」）——
    //   ★回退壳与 `settings.html` **两处必须一致**（`test/window-actionbar.test.js` 两头咬着
    //     "外壳有一份、页里一份都没有"）：图标不一致会让回退态与正常态看着是两个东西。
    //   ★这条注释住在**模板串外面**——上一版我把它写进串里，`settings.html` 那几个字
    //     被当成模板串的结束（`SyntaxError: Unexpected identifier 'settings'`，25 条判据连带红）。
    const FALLBACK_WINDOW = `<div id="${WINDOW_ID}" class="sw2-window-mask">
  <div class="sw2-window">
    <header class="sw2-header">
      <div class="sw2-badge">棋</div>
      <div class="sw2-title-block">
        <div class="sw2-title">观棋窗口</div>
        <div class="sw2-subtitle">Story World v2</div>
      </div>
      <div class="sw2-close" id="sw2_window_close">关闭</div>
      <button class="sw2-btn sw2-operation-toggle" type="button" data-window-menu aria-controls="sw2_actionbar" aria-expanded="false">操作</button>
    </header>
    <div class="sw2-actionbar" id="sw2_actionbar">
      <button class="sw2-btn sw2-primary" data-action="init-world">开始新世界</button>
      <button class="sw2-btn" data-action="advance-world">推进一轮</button>
      <span class="sw2-actionbar-state" id="sw2_advance_state"></span>
    </div>
    <div class="sw2-statusbar"><span class="sw2-dot"></span><span class="sw2-main" id="sw2_status_text">模板加载失败回退窗 · 完整面板需 settings.html</span></div>
    <div class="sw2-placeholder">settings.html 模板不可用（回退形态）。</div>
  </div>
</div>`;

    /** 把面板模板挂进 DOM（取不到模板 ⇒ 退回那个极简壳；**两条路都不许抛**） */
    function ensureWindow(ctx) {
        if (document.getElementById(WINDOW_ID)) return Promise.resolve();
        return ctx.renderExtensionTemplateAsync('third-party/story-world-v2', 'settings')
            .then((html) => {
                if (html && !document.getElementById(WINDOW_ID)) {
                    document.body.insertAdjacentHTML('beforeend', html);
                } else if (!document.getElementById(WINDOW_ID)) {
                    document.body.insertAdjacentHTML('beforeend', FALLBACK_WINDOW);
                }
                dedupWindows();
            })
            .catch(() => {
                if (!document.getElementById(WINDOW_ID)) {
                    document.body.insertAdjacentHTML('beforeend', FALLBACK_WINDOW);
                }
                dedupWindows();
            });
    }

    function openWindow() {
        const win = document.getElementById(WINDOW_ID);
        if (!win) return;
        win.classList.add('sw2-open');
        document.getElementById('sw2_window_close')?.focus?.();
        const menu = document.getElementById('extensionsMenu');
        if (menu) menu.style.display = 'none';
    }

    function closeWindow() {
        document.getElementById(WINDOW_ID)?.classList.remove('sw2-open');
        say('观棋窗口已收起', { diagnostic: false }); // 收回中性状态，调试记录不收集窗口动作。
        // ★细案实体页：视图态随关面板重置（照编年页"纯视图态、关面板重置"的口径）
        try {
            const vs = getViewState?.();
            vs?.resetEntities?.();
            vs?.resetChronicle?.();
        } catch (_) { /* 视图态不许影响收起 */ }
        const menu = document.getElementById('extensionsMenu');
        if (menu) menu.style.display = '';
    }

    /** 扩展菜单里那个入口（挂了就不再挂第二遍） */
    function ensureWandEntry() {
        const menu = document.getElementById('extensionsMenu');
        if (!menu || document.getElementById('sw2_wand_container')) return;
        const container = document.createElement('div');
        container.id = 'sw2_wand_container';
        container.className = 'extension_container';
        container.innerHTML = `<div id="sw2_world_wand" class="list-group-item flex-container flexGap5 interactable" title="打开观棋窗口">
        <div class="fa-solid fa-chess-board extensionsMenuExtensionButton"></div><span>观棋窗口</span></div>`;
        menu.appendChild(container);
        container.addEventListener('click', openWindow);
        const btn = document.getElementById('extensionsMenuButton');
        if (btn) btn.style.display = 'flex';
    }

    return { modalBoost, dedupWindows, ensureWindow, openWindow, closeWindow, ensureWandEntry };
}
