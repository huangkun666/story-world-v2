// story-world-v2/web/scroll-keep.js
// ★★★leg104（C2）：**重绘时把滚动位置放回去**——从接线层分出来的一族（零 import 的真叶子）。
//
// 病（体验，不是崩溃；用户那批体检里"每次都会硌到"的那一条）：
//   观棋页是**两栏各自滚动**（`.sw2-merged-main` / `.sw2-merged-side`，摆法见 `web/page-compose.js`，
//   样式见 `web/style.css`），而**每轮推进 / 载入世界 / 回快照**都跑 `refreshWorld`：它把当前那一页
//   `el.innerHTML = …` **整块换掉**（局部重绘 `refreshSections` 同理）⇒ 容器是**新造的**、`scrollTop` 归零。
//   ⇒ 玩家正滚到"面 / 线"中段看事件，一轮对话结束画面**跳回该栏顶部**，得重新往下翻。
//   ★同一件事还有**第二层**：面板本身就有一条页面级滚动（`.sw2-view.sw2-active{overflow:auto}`，leg101 落的）
//     —— 编年 / 实体那些长页也在同一个病里（页面元素被整块换掉 ⇒ 回到顶上）。
//
// 口径（★一条规则，不搞特例）：**每次重绘前取一次、重绘后放回去**；页与两栏**各归各的**。
//   ★为什么不做"只有推进才保、翻页就回顶"那种分叉：那是**两条规矩**（本仓最忌"同一件事两处表达"），
//     而且分叉的判据得先回答"哪一次重绘算哪一类"——那是个答不清的问题。滚动位置是**玩家的手**，
//     面板重绘不该动它（与 leg46 续·五「绝不重画面板抢玩家的手」同一条纪律，只是这次抢的是滚动条）。
//
// ★缺席值不是 0（本仓"空着就是空着"）：
//   取不到容器 / 读出来的不是有限数 ⇒ 那一格记 `null`，回写时**跳过**它 ——
//   绝不用 0 冒充（0 与"读不到"是两件事：前者是"它本来就在顶上"，后者是"这句话问不到对象"）。
//   ★同理：找不到容器时**如实不写**，由调用方按返回值知道"一共回写了几格"。

/** 重绘会重建的那几格滚动面：`page` = 页面元素自己，另两个 = 并页的两栏（类名与 `page-compose.js` 同源）。 */
export const SCROLL_SLOTS = ['page', 'sw2-merged-main', 'sw2-merged-side'];

/** 取这一格对应的节点；`page` 就是传进来的那个元素本身。 */
function slotNodeOf(el, slot) {
    if (slot === 'page') return el;
    return el.querySelector(`.${slot}`) || null;
}

/**
 * 重绘**之前**取一次：返回 `{ page, 'sw2-merged-main', 'sw2-merged-side' }`（值为 `scrollTop` 或 `null`）。
 * ★元素不可用（null / 没有 `querySelector`）⇒ 返回 `null`（"这一次不问"），调用方据此什么都不做。
 */
export function captureScrollPositions(el) {
    if (!el || typeof el.querySelector !== 'function') return null;
    const snap = {};
    for (const slot of SCROLL_SLOTS) {
        const node = slotNodeOf(el, slot);
        const top = node ? Number(node.scrollTop) : NaN;
        snap[slot] = Number.isFinite(top) ? top : null;   // ★缺席 ⇒ null，不用 0 冒充
    }
    return snap;
}

/**
 * 重绘**之后**放回去：**只回写真取到值的那几格**，返回实际回写了几格（0 = 一格都没写）。
 * ★超出新内容高度的位置由浏览器自己夹（不在这里写补偿逻辑：那是第二份"高度算法"，本仓最贵的病）。
 */
export function restoreScrollPositions(el, snap) {
    if (!el || typeof el.querySelector !== 'function' || !snap || typeof snap !== 'object') return 0;
    let wrote = 0;
    for (const slot of SCROLL_SLOTS) {
        const want = snap[slot];
        if (!Number.isFinite(want)) continue;            // ★空着就是空着：不猜、不写 0
        const node = slotNodeOf(el, slot);
        if (!node) continue;                             // ★找不到容器 ⇒ 如实跳过
        node.scrollTop = want;
        wrote += 1;
    }
    return wrote;
}
