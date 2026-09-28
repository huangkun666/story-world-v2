// story-world-v2/web/long-task.js
//
// ★★★leg109：**长活儿"正在跑"要看得见、连点第二下不许发第二串**（`STATE.md` §3 ② 登记的那一条）。
//   细案：`docs/superpowers/specs/2026-09-22-leg108-long-task-design.md`（用户 2026-09-22 点头实施）。
//
// ＝＝ 病（逐行取证，不是推演）＝＝
//   面板上有三件事**要跑几十秒到几十分钟**：
//     · 「只重抽设定」——`extractWorldSetting` 跑多块 + 块间合并（真账实测 **20–30 分钟**）；
//     · 「只抽刻度」——一次模型调用，也是分钟级；
//     · 「采用这份草稿」——要写账 + 落盘，也会卡一下。
//   而它们跑起来**界面上没有任何"正在跑"的样子**：按钮照旧可点、文字照旧，状态条只在开头写一句
//   「只重抽设定中…」。⇒ 玩家以为没点上，**再点一次就发出去第二串模型调用**（白等一份时间、
//   花两份钱；采用那一条还会两笔覆盖写账）。
//
// ＝＝ 治法（四件事，一件都不许多做）＝＝
//   ① **闸**：同一个动作已在跑 ⇒ **立刻返回、绝不并发**。这一条**不依赖 DOM**，是真正的保证。
//   ② **出声**：被挡住时状态条写一句人话——「⏳ 上一次还在跑（<label>）——这一下没有重复发」。
//      （口径与 leg108 刚给「推进一轮」补的那条一致：**被挡住不许静默**。）
//   ③ **看得见**：把面板上那枚按钮（`[data-action="<action>"]`）置 `disabled`、文字改成「正在跑…」，
//      跑完/抛错都**还原成原文字**（原文字原样存下来，不许自己编一个）。
//      ★**如实说清它的边界**：长活儿跑的时候面板会重绘，重绘会把那个按钮节点换掉 ⇒
//        "灰掉"是**尽力而为**、不是保证（节点被换掉之后 `isConnected` 为假，本模块就不再碰它，
//        也不去猜新节点该写什么）；**真正的保证是第 ① 条那道闸**。
//   ④ **收尾**：`try/finally` 释放闸——**抛错也必须释放**，否则那一格被永久挡住
//      （照 `web/param-panel.js` 的忙闩先例：`set → finally delete`）。
//
// ＝＝ 为什么照抄这两个先例、不新造 ＝＝
//   · `web/param-panel.js` 的**忙闩**（`paramBusy()` 交出的是一颗 `Map` 的**本体**）：同一格的一笔
//     未结束时不受理重复事件。本模块是同一个形状，只是键从"参数键"换成"动作名"、并多了"出声"。
//   · `src/async-tick.js` 的 `createTickQueue`：并发时返 `{ ok: false, skipped: 'busy' }`
//     （「推进一轮」的连点保护）。本模块**不碰**它——那条闸已经有了，leg108 只补了"被挡住要出声"。
//
// ＝＝ 纪律（与 `web/action-router.js` 同一把尺）＝＝
//   ① **模块顶层零 DOM**：`node --test` 能直接 import 本文件（本仓硬纪律，`browser-compat` 扫描覆盖）。
//      窗口与按钮一律**注入**（`doc` / `win`），不写 `document` / `window` 这两个自由名字。
//   ② **只加闸与显示，主体一字不改**：`wrap` 交出的函数与原来那个**同签名**（参数原样转发、
//      返回值原样交出、`this` 原样带上）⇒ 接线层换上去之后行为逐字不变，多的只有那四件事。
//   ③ **零阻塞**：拿不到窗口 / 找不到按钮 ⇒ **什么都不做**，绝不抛、绝不猜一个文字出来。
//   ④ **解释写在这里，不写进接线层**：`web/index.js` 有行数硬锁（`< 3100`），本模块没有。

/** 三个动作各自的人话名字（状态条上要念出来；判据也按它断言）。 */
export const LONG_TASK_LABELS = {
    'reextract-setting': '只重抽设定',
    'extract-scales': '只抽刻度',
    'adopt-scale-draft': '采用这份草稿',
    // ★leg112（C1）：这一格**不是**长活儿（取一次书、算一次指纹、写一格，毫秒级），
    //   但它与那三格共用同一把闸——理由是同一个：**连点两下不该发两遍**（第二遍会再取一次书）。
    //   顺带白拿"按钮灰掉 + 状态条出声"，与那三格手感一致（玩家不必学两套）。
    'rebaseline-book': '就按现在这本算',
    // ★★★leg144：**「初始化」也进这把闸**。它一直是面板上**最慢**的那一格（真账 20–30 分钟），
    //   却偏偏是唯一没被护住的——连点两下 = **两串模型调用一起跑**（白等一份时间、花两份钱，
    //   还互相抢网关，两条都会更慢）。它是本模块第一格"真的跑几十分钟"的活儿，
    //   所以①②③④四件事（闸/出声/灰按钮/抛错放闸）在这里的收益也最大。
    'init-world': '初始化世界',
};

/** 按钮跑起来时那四个字（唯一一处；判据逐字锁它）。 */
export const BUSY_TEXT = '正在跑…';

/**
 * 建一套长活儿护栏。
 *
 * @param {object} deps
 *   · `doc`       document（★注入，不是自由名字；缺省取全局的那个，Node 里为 undefined ⇒ 退让）
 *   · `win`       窗口（找不到按钮时兜底用 `doc`；同样可注入，判据喂假窗口进来）
 *   · `setStatus` (text) => void 写状态条（被挡住时"出声"走它；缺省 no-op）
 *   · `log`       (line) => void 控制台留痕（缺省 console.info；只为取证，不参与任何判定）
 * @returns {{wrap: Function, running: Function, busy: Function}}
 *   · `wrap(action, label, fn)` 把一段长活儿包成"带闸 + 看得见"的处理器（同签名）
 *   · `running(action)` 这一个动作此刻是不是在跑（给面板/取证读；不参与判定）
 *   · `busy()` 现在在跑的全部动作名（取证用；**交出去的是副本**，外头改不动闸）
 */
export function createLongTask({ doc = null, win = null, setStatus = null, log = null } = {}) {
    // ★闸就住在这里：一颗 `Set`，键是**动作名**。它是本模块唯一的真状态。
    const inFlight = new Set();
    const docOf = () => doc || (typeof document === 'undefined' ? null : document);
    const winOf = () => win || docOf();
    const say = (text) => { if (typeof setStatus === 'function') setStatus(text); };
    const note = (line) => {
        if (typeof log === 'function') { log(line); return; }
        try { console.info(`[story-world-v2] ${line}`); } catch (_) {}
    };

    /**
     * 把面板上这一个动作的**每一枚**按钮置灰、文字改成「正在跑…」，并交出"怎么还原"。
     * ★找不到按钮 / 拿不到窗口 ⇒ 交出一个**什么都不做的还原函数**（零阻塞，绝不抛）。
     * ★为什么是"每一枚"：同一个动作名在面板上可能画在不止一处（例如设定页与刻度栏），
     *   只灰掉找到的第一枚 ⇒ 另一枚照旧可点，看着像"这个按钮坏了"。
     */
    function markRunning(action) {
        const undo = () => {};
        try {
            const root = winOf();
            if (!root || typeof root.querySelectorAll !== 'function') return undo;
            const btns = [...root.querySelectorAll(`[data-action="${action}"]`)];
            if (!btns.length) return undo;
            const saved = [];
            for (const b of btns) {
                try {
                    if (typeof b.setAttribute !== 'function') continue;
                    // ★原文字**逐字**存下来（还原时不许自己编一个）
                    saved.push([b, b.textContent]);
                    b.setAttribute('disabled', 'disabled');
                    b.textContent = BUSY_TEXT;
                } catch (_) {}
            }
            if (!saved.length) return undo;
            // ★还原：**只碰当初真碰过的那几个节点**；已经被重绘换掉的（`isConnected === false`）
            //   一概不动——它已经不在页面上，改它没有意义，去猜"新节点该写什么"更是编事实。
            return () => {
                for (const [b, text] of saved) {
                    try {
                        if (b.isConnected === false) continue;
                        b.removeAttribute('disabled');
                        b.textContent = text;
                    } catch (_) {}
                }
            };
        } catch (_) { return undo; }
    }

    /**
     * 把一段长活儿包起来。返回的函数与 `fn` **同签名**（参数原样转发、返回值原样交出）。
     * @param {string} action 动作名（就是 `data-action` 那个字面量；闸按它记）
     * @param {string} label  人话名字（被挡住时念出来）
     * @param {Function} fn   原处理器（**一字不改**）
     */
    function wrap(action, label, fn) {
        if (typeof fn !== 'function') throw new TypeError('createLongTask.wrap：第三个参数必须是原处理器函数');
        return async function wrapped(...args) {
            // ① 闸：已在跑 ⇒ 立刻返回，绝不并发（也不动 DOM：这一下什么都没发生）
            if (inFlight.has(action)) {
                say(`⏳ 上一次还在跑（${label}）——这一下没有重复发`);
                note(`${action}：上一次还在跑 ⇒ 这一下没有重复发（没有发出第二串模型调用）`);
                return undefined;
            }
            inFlight.add(action);
            const undoBtn = markRunning(action);
            try {
                return await fn.apply(this, args);
            } finally {
                // ④ 收尾：抛错也必须放闸（否则那一格被永久挡住）
                inFlight.delete(action);
                undoBtn();
            }
        };
    }

    return {
        wrap,
        running: (action) => inFlight.has(action),
        busy: () => [...inFlight],
    };
}
