// story-world-v2/web/action-router.js
//
// ★★★leg107：**按钮点击那一口**从 `web/index.js` 搬到这里 —— 接线层的端到端判据的第一格。
//
// 为什么搬（细案 `docs/superpowers/specs/2026-09-22-leg107-action-router-design.md` §1）：
//   面板上所有按钮共用 `web/index.js` 里的**一个** click 委托，它把按钮身上的 `data-*` 属性
//   翻成引擎听得懂的参数。而 leg89/92/103/105 四次实机「点了没反应」**全长在这条链上**，
//   它却是全仓唯一没有判据站岗的层（96 个判据文件里 0 个真的派发过点击）。
//   ⇒ 把它提成可单独调用的模块，判据才能**真点一下**并断言"引擎收到了什么"。
//
// ★本模块的边界（守死）：只做「元素 → 动作 + 参数」这一件事。
//   它**不认识**引擎、不认识视图态、不认识状态条 —— 那些全靠注入进来的 dispatch / toggleInject。
//   ⇒ 模块顶层零 DOM，Node 里可直接 import（与 `web/view-state.js` 同一把尺）。
//
// 三支的处理顺序**照搬原实现，一个字不改**（细案 §3）：
//   ① `data-inject-switch` 早退：注入开关**不进动作总线**（leg89 的定案：不靠 data-action 的注册时序）
//   ② `.sw2-goto` 早退：模拟点那枚页签
//   ③ 其余：交给动作总线
//
// ★★leg108：本模块**多交出一口** —— `readPayload`（元素 → 参数）成为全仓**唯一**的那条读法。
//   接线层里原有**两处手拼 payload**（链浮层 `web/index.js:2670` 的 7 词名单、参数页 `:1315` 的特例）
//   ⇒ 两处都改成调它。链浮层那处与 leg107 拆掉的主委托**是同一个病**（名单＝没人校对的复制品），
//   只是它挂在 `document.body`、走不到 `win` 委托，所以 leg107 把它**如实登记**为"本笔不做"。
//   ★**先量后说**（leg108 实测，不含糊）：这两处**今天都不出 bug** ——
//     · 链浮层里只有 `data-vol` / `data-chain` 两种属性（旧 7 词名单是**超集**）；
//     · 参数控件只有 `data-param` / `data-value`（数字框是裸 `value`，读法不认它，兜底在接线层）。
//     ⇒ 本棒治的是**病根**：复制品每多一份，就多一处"漏一个词 ⇒ 点了没反应"的入口（leg105 的来路）。
//   ★为什么把解释留在这里而不是 `web/index.js`：那一份有**行数硬锁**（`< 3100`），
//     而本模块没有 —— 新功能与它的理由都该先进模块（leg107 §6 第 3 格登记的同一件事）。

/**
 * 把元素身上的**全部** `data-*` 属性翻成 payload。
 *
 * ★★★leg107（本笔唯一的语义改动）：**从"手写名单"改成"照单全收"。**
 *   病：旧实现是一张手写 13 词名单，不在名单上的 `data-*` **静默扔掉、不抛错**。
 *     leg105 的「编年页下一页点了没反应」正是被它扔掉了 `data-layer`：
 *     处理器读 `payload?.layer` ⇒ 恒 undefined ⇒ 兜底成 'event'
 *     ⇒ 点账目层的下一页，动的是**事件层**的页码（玩家看到"页数也不会跳"）。
 *   取证（细案 §4.1）：全仓 **0 处**枚举或展开 payload（`Object.keys/entries/stringify`、`...payload`
 *     全无命中）；处理器**一律点名要某一个键**、要不到走默认值 ⇒ 多带键不会影响任何人。
 *   对账（机械清点）：处理器读 12 个键，其中 **10 个来自属性**
 *     （`chain entity force layer name param snap tick value vol`）⇒ 照单全收一个都不会少；
 *     另两个 `el` / `worldName` **不来自任何属性**（`data-el` / `data-world-name` 全仓零处出现）
 *     ⇒ 本笔**不改变它们的任何行为**（`worldName` 实测恒 undefined，本笔不动）。
 *   ★净收益：那份名单是一份**没人校对的复制品**（多列了 `source`/`filter`/`key` 三个没人读的键、
 *     又漏了 `layer`）⇒ 照单全收之后它整个消失，多列与漏列同时成为不可能。
 *   ★顺带修好一处：旧写法对**缺失**的属性交出的是 `null`（`getAttribute` 的返回值），
 *     现在缺属性就**没有那个键**（`undefined`）——与"空着就是空着"那条红线同向。
 *   ★leg108：这一口现在**全仓只有一条**（主委托 / 链浮层 / 参数页三处都调它）——接线层里手拼名单归零。
 */
export function readPayload(el) {
    const out = {};
    // 用 attributes 而不是 dataset：dataset 会把 `data-foo-bar` 驼峰化成 `fooBar`，
    // 而本模块的键名口径是**逐字属性名去前缀**（`data-value` → `value`），两者对不上。
    const attrs = el.attributes || [];
    for (const a of attrs) {
        const name = a.name || '';
        if (!name.startsWith('data-')) continue;
        out[name.slice(5)] = a.value;
    }
    return out;
}

/**
 * @param {{win: object, dispatch: Function, toggleInject: Function}} deps
 * @returns {{route: (el: object) => ({action: string, payload: object}|null), handleClick: (e: object) => void}}
 */
export function createActionRouter({ win, dispatch, toggleInject }) {
    /**
     * 纯函数：给定一个元素，交出「这是哪个动作、带哪些参数」。
     * 返回 `null` = 这一下不该走动作总线（两支早退都走这里）。
     */
    function route(el) {
        if (!el) return null;
        // ① 注入开关：直接收，不进总线
        const sw = el.closest?.('[data-inject-switch]') || null;
        if (sw) {
            const key = sw.getAttribute('data-inject-switch');
            const on = String(sw.getAttribute('data-value') ?? '') === '1';
            console.info(`[story-world-v2] 注入开关被按下：${key} → ${on ? '开' : '关'}`);
            toggleInject(key, on);
            return null;
        }
        // ② 跳页签：模拟点那一枚（`.sw2-goto` 自身不是 data-action）
        const el2 = el.closest?.('[data-action]') || el.closest?.('.sw2-goto') || null;
        if (!el2) return null;
        if (el2.classList.contains('sw2-goto')) {
            const view = el2.getAttribute('data-view') || 'archive';
            win.querySelector(`.sw2-tab[data-view="${view}"]`)?.click();
            return null;
        }
        // ③ 其余：交给动作总线
        return { action: el2.getAttribute('data-action'), payload: readPayload(el2) };
    }

    /** 薄壳：挂 click 委托。判据要测逻辑走 `route`，要测"真点击"走这一口。 */
    function handleClick(e) {
        const hit = route(e?.target);
        if (!hit) return;
        dispatch(hit.action, hit.payload, e);
    }

    win.addEventListener('click', handleClick);
    return { route, handleClick };
}
