// story-world-v2/web/page-compose.js
// ★★★leg98 补四：**并页那一页怎么拼**——从 `web/index.js`（接线层）搬出来的一族。
//
// 为什么有这一族（它治的是什么）：
//   leg97 把「观棋」与「说书」并成一页之后，这一页是**一串扁平的块**首尾相接：
//     四层（43 KB / 可见 10150 字）→ 信息带（1.4 KB / 可见 **94 字**）→ 盘算总览 → 动态流 → 地图。
//   用户实机读到两件事（原话）：「**你总得把这个放在上面吧？而且我要往下翻很久才能看到这些**」——
//     · 那条 **94 字**的状态条被压在**页尾**（要滚过一万多字才看见它）；
//     · 全页只有**一条竖线**，而面板宽 1120px（`#story_world2_window`）⇒ 右边一路空着、越滚越长。
//   ⇒ 定稿：**信息带升成页头** ＋ 这一页改**两栏**（左＝故事轴 / 右＝盘算总览 ＋ 地图）。
//
// ★为什么"哪一块住哪一栏"住在这里、而不是住在 `src/panorama.js`：
//   `panorama.js` 是**零 import 的真叶子**（`test/module-layout.test.js` 锁着模块图），
//   而"哪一块住哪一栏"是**版式决定**、不是渲染层的事 —— 与并页那次同一条分工。
//   这一族**零 import**（纯字符串拼装）⇒ 可以在 node 里直接测，不必起浏览器。
//
// ★★★leg99 两笔（用户令：「**动态流可以不要了**，其他就按那个模板做，但要注意**两列都能独自滑动**」）：
//   ①**动态流撤出这一页**（它是左栏的尾巴：自证闸之后那一块）——
//     ★"不要了"= **从这一页的组合里撤掉**，不是把引擎那边的账删了：`render.js` 的 `renderFeedHtml`
//       与 `board.feed` **一个字没动**（`test/render.test.js` 那几条照样在测它）。
//       本模块**不再引用它** ⇒ 它自然不上这一页（这一页是它唯一的家）。
//   ②**两栏各自独立滑动** ⇒ 见 `web/style.css` 的 `.sw2-merged-grid/-main/-side`。
//
// ★纪律（改这里之前先读）：
//   ①**一块都不许丢**：认不出形状就退回"原样拼接"（宁可这一页长，也不许把内容吃掉）；
//     ★唯一的例外是**用户明令撤掉的那一块**（`feed`）——那不是"丢了"，是"不要了"；
//   ②分组只用**产品自己认得的边界**（说书页头那一行 / `sw2-pan-selfcheck` 那一行），
//     **不自己另立一套标记**（那会是"同一件事两处表达"）；
//   ③这与 leg78 的 `sw2ResetFlushState`、leg97 的并页是同一路活：**组合器住在接线层旁边**。

// 附层三块的相对次序（★leg99：`feed`（动态流）**已整块撤出这一页**——用户令「**动态流可以不要了**」）。
//   `digest` 时局句**不在**里面：它与"大势"是同一件事的两种说法，
//   leg97 已裁只留"书的原文"那一份 ⇒ 它不许回流。
export const BOARD_ATTACH_ORDER = ['infoband', 'agendaStrip', 'side'];

/** 把 `renderBoardHtml` 交出来的那几块拼成一段 HTML（一处实现，两个刷新入口共用）。 */
export const boardBlocksHtml = (board) => (typeof board === 'string'
    ? board
    : BOARD_ATTACH_ORDER.map((k) => (board && board[k]) || '').join(''));

// 说书页头那一行（`说书 · 这世界已经发生的事` / 空态那两句都是同一个类，且**只有一层 div**）
const PAN_HEAD_RE = /^<div class="sw2-pan-head">[\s\S]*?<\/div>/;
// 自证闸那一行（它是四层的**最后一块** ⇒ 拿它当"正文到此为止"的界碑）
const PAN_SELFCHECK = '<div class="sw2-pan-selfcheck';

/**
 * 并页那一页的**唯一一处组合**：页头 ＋ 信息带（整宽）＋ 两栏。
 * 形状：
 * ```
 *   说书页头（一行）
 *   信息带（★升成页头 · 整宽）
 *   ├ 左栏（故事轴）：大势 → 此刻 → 面卡片… → 各处散落 → 自证
 *   └ 右栏：盘算总览 → 地图
 * ```
 * ★两栏**各自独立滚动**（用户令「**两列都能独自滑动**」）——
 *   落在样式上（`.sw2-merged-main` / `.sw2-merged-side` 各 `overflow-y:auto`），本模块只负责把它们摆好。
 * ★`out.board` 是**对象**（四块）；传进来的是字符串时（老调用方）退回"原样拼接"。
 */
export function mergedMainHtml(out) {
    const pan = String(out?.panorama || '');
    const board = out?.board;
    const tail = boardBlocksHtml(board);
    if (!board || typeof board === 'string') return pan + tail;
    const head = PAN_HEAD_RE.exec(pan)?.[0] || '';
    const at = pan.indexOf(PAN_SELFCHECK);
    // ★认不出形状（空态 / 老账 / 版面改了）⇒ **原样拼**：宁可长，也不许丢内容。
    if (!head || at <= head.length) return pan + tail;
    // ★★★leg99：`pan.slice(head.length, at) + pan.slice(at)` 原本中间夹着 `board.feed`（动态流），
    //   现已撤掉 ⇒ 左栏就是**四层整段**（自证闸是它的最后一块，天然收尾）。
    return head
        + (board.infoband || '')
        + '<div class="sw2-merged-grid"><div class="sw2-merged-main">'
        + pan.slice(head.length)
        + '</div><div class="sw2-merged-side">'
        + (board.agendaStrip || '') + (board.side || '')
        + '</div></div>';
}
