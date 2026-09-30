// story-world-v2/web/volume-popup.js
// ★★★leg104（A4）：**旧卷展开**改挂浮层——从接线层分出来的一族（零 import 的真叶子）。
//
// 病（体检捋出来的 A4，源码可证）：
//   旧 `bus['read-volume']` 把渲染好的卷段 `insertAdjacentHTML('afterbegin')` 到 `#sw2_view_chronicle`。
//   而编年页**每轮都会整块重绘**（`refreshWorld` / `refreshSections`）⇒ 展开的旧卷**被无声吞掉**
//   （它不属于任何刷新通道，重绘一换 DOM 就没了）；而且展开之后**没有收起口**（只能刷新页面）。
//
// ★为什么是浮层而不是"做成视图态"（两条路都想过，选这条的理由）：
//   ① 旧卷展开是**只读**的东西（卷段原文，不看实时账）⇒ 它与"面板每轮要重绘的活内容"本来就不该住一层；
//   ② 本仓**已经有这个先例**：链视图（`leg93c`）就是因为"插进页签里会在别处失效"而改挂 `document.body`
//      —— 本族照它做，等于**同一类东西同一种住法**（不是新发明一套）；
//   ③ 收起口**白得**：浮层本来就有"点空白 / ESC / 头里那枚收起"三条路；
//   ④ ★它还顺手治了一个从链浮层点「阅卷」的怪事：旧实现把内容插到**浮层底下的编年页**里，
//      玩家在浮层上点阅卷看着像"没反应"（内容被浮层挡着）。
//
// 纪律（照 leg93c 那三条，一字不改）：
//   · 挂 `document.body`（不在面板窗口里 ⇒ 面板关着也能看）；
//   · 内层是**已经写好的**渲染产物（`renderVolumeReadHtml` 一字不改地放进来），本模块只给壳与关闭；
//   · ESC 走**捕获阶段**且 `stopPropagation` ⇒ 不会顺带把整个面板也关掉（面板的 ESC 只管面板）。
//
// ★本模块**顶层零 DOM**（`docOf` 到调用时才看 `document`）⇒ `node --test` 可直接 import；
//   测试拿一个假 `document` 喂进来就能真跑（判据打的是**产品真入口**：接线层调的正是这两个函数）。

/** 浮层容器 id（一处定义；`test/` 与接线层都从这里取，别各写一份字面量）。 */
export const VOLUME_MASK_ID = 'sw2_volume_mask';

/** 取文档对象：显式传进来的优先（判据用），否则用全局的（浏览器里就是它）。 */
const docOf = (doc) => doc || (typeof document === 'undefined' ? null : document);

/**
 * 收起旧卷浮层（★一处收口：头里的「收起」/ 点空白 / ESC 三条路都走它）。
 * 返回**是否真的收掉了一层**（`false` = 本来就没开——如实报，不假装做了事）。
 */
export function closeVolumePopup(doc) {
    const d = docOf(doc);
    const el = d?.getElementById?.(VOLUME_MASK_ID);
    if (!el) return false;
    if (el._sw2Esc) d.removeEventListener('keydown', el._sw2Esc, true);   // ★ESC 监听随浮层一起摘掉（别留在 document 上）
    el.remove?.();
    return true;
}

/**
 * 打开旧卷浮层：`html` = `renderVolumeReadHtml(...)` 的产物（一字不改地放进壳里）。
 * ★一次只留一层：开新的之前先把旧的收掉（与链浮层"不留两份"同一条）。
 * ★没有可用的 `document`（Node 里没喂假文档）⇒ 返回 `null`、什么都不做（绝不抛）。
 */
export function openVolumePopup(html, doc) {
    const d = docOf(doc);
    if (!d || typeof d.createElement !== 'function' || !d.body) return null;
    closeVolumePopup(d);
    const mask = d.createElement('div');
    mask.className = 'sw2-cv-mask';                 // ★复用链浮层那套样式（同一类东西同一种长相）
    mask.id = VOLUME_MASK_ID;
    const box = d.createElement('div');
    box.className = 'sw2-cv-box';
    box.innerHTML = `${html}<div class="sw2-cv-hint">点空白处或按 Esc 关闭 · 旧卷只读</div>`;
    mask.appendChild(box);
    // ⓵ 点**背景**关掉（点弹窗内部不关——不然想看细处一点就没了）；头里那枚「收起」也在这里收口
    mask.addEventListener('click', (e) => {
        if (e.target === mask) { closeVolumePopup(d); return; }
        if (e.target?.closest?.('[data-action="volume-close"]')) closeVolumePopup(d);
    });
    // ⓶ ESC：**捕获阶段** + `stopPropagation` ⇒ 面板那条"ESC 关整个窗口"不会跟着一起触发
    const onEsc = (e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        e.preventDefault();
        closeVolumePopup(d);
    };
    mask._sw2Esc = onEsc;
    d.addEventListener('keydown', onEsc, true);
    d.body.appendChild(mask);
    return mask;
}
