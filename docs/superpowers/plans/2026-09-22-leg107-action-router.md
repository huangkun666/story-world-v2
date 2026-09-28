# 接线层端到端判据 实施计划（leg107）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `web/index.js` 里那段按钮点击处理提成可单独调用的 `web/action-router.js`，并让"真的点一下"这件事第一次有判据站岗。

**Architecture:** 照本仓既有先例（`web/view-state.js` / `web/book-source.js` / `web/scroll-keep.js`）——**搬一族进自己的模块 + 依赖注入**。新模块 `createActionRouter({ win, dispatch, toggleInject })` 返回 `{ route, handleClick }`；`route` 是纯函数（元素 → `{action, payload}`），`handleClick` 是薄壳。分**两笔**落地：第一笔纯搬家（行为逐字不变），第二笔才是唯一那处语义改动（`data-*` 从手写名单 → 照单全收）。两笔分开，是为了第二笔万一出事可以只退它、保留搬家。

**Tech Stack:** 原生 ESM（无构建步骤、无 `package.json`）、`node:test` + `node:assert/strict`、**零依赖**（不许引入 jsdom —— 本插件是零依赖的，见 `STATE.md` §5）。

## Global Constraints

- **零依赖**：不许新增任何 npm 包，不许引入 `package.json`。测试里的 DOM 一律**手写最小桩**。
- **`node --test` 必须在插件目录内、无参跑**：`cd F:\deepseek\plugins\story-world-v2; node --test`。在仓库根跑会扫到整棵树（7367 条 / 8 条红，全来自 `backups/`、`harness/`）。
- **含中文的文件禁止用 PowerShell 读写**（`STATE.md` §2.1 同级铁律）——一律用 `edit` / `write` 工具。
- **提交信息一律走 `-F <文件>`**：PowerShell 会把 `git commit -m` 里的反引号当转义符吃掉。
- **三个号都不升**：`PANEL_BUILD` / `CSS_VERSION` / `MAIN_PROMPT_V`（玩家可见版面与提示词零改动）。
- **`web/index.js` 行数锁**（`test/web-view-state-layout.test.js:339-340`）：必须 `< 3100` 且 `> 2600`。本笔使它**变薄**，两个断言都不许改。
- **新模块的注释会被扫**：`test/retired-controls.test.js:69` 用 `readdirSync(web)` 自动收全部 `web/*.js` 进玩家可见面 ⇒ 新文件的**字符串字面量**不许含引擎行话（注释会被剥掉，但字符串不会）。
- **本笔不碰**：弹窗那套翻译（`web/index.js:2655-2665`）、参数页特例（`:1310`）、行数锁那三条规矩。
- **验收三件连着做**（`STATE.md` §2.3）：测试 → 部署（junction 已就位，Ctrl+Shift+R）→ 台账（`docs/ledger.md` 补 leg107 一行，**5 格**）。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `web/action-router.js` | **新**。按钮点击的翻译口：`route(el)` 纯函数 + `handleClick(e)` 薄壳 + `createActionRouter({win, dispatch, toggleInject})` 工厂 | 建 |
| `web/index.js` | 接线层。`bindActions()` 里那 29 行点击块换成 4 行 | 改（变薄 ≈29 行） |
| `test/action-router.test.js` | **新**。端到端判据：真点击 → 断言 `{action, payload}` 逐字正确；含 leg105 回归锁 + 反向对照 | 建 |
| `docs/ledger.md` | 唯一变更实录 | 改（补 leg107 一行，5 格） |

**边界**：`action-router.js` 只做"元素 → 动作 + 参数"这一件事。它**不认识引擎、不认识视图态、不认识状态条** —— 那些全靠注入进来的 `dispatch` / `toggleInject`。所以它能被单独 import 进 Node 跑（模块顶层零 DOM）。

---

## Task 1: 建 `web/action-router.js`（纯搬家，行为逐字不变）

**Files:**
- Create: `web/action-router.js`
- Test: `test/action-router.test.js`（本任务只写"模块存在且形状对"那几条）

**Interfaces:**
- Consumes: 无（本任务是链条的起点）
- Produces:
  - `createActionRouter({ win, dispatch, toggleInject })` → `{ route, handleClick }`
  - `route(el)` → `{ action: string, payload: object } | null`（`null` = 这一下不该走总线）
  - `handleClick(e)` → `void`
  - `readPayload(el)` → `object`（**不导出**，Task 4 改的就是它）

- [ ] **Step 1: 写失败的测试**

创建 `test/action-router.test.js`：

```js
// story-world-v2/test/action-router.test.js
// ★★★leg107：**接线层的端到端判据** —— 第一次让"真的点一下"这件事有判据站岗。
//
// 为什么需要它（leg106 §8 点名，本笔接）：
//   本仓 96 个判据文件里，48 个读 `web/index.js` 的**源码文本**做正则断言
//   ⇒ 「把代码从 A 搬到 B」会红，而「按钮点了没反应」全绿；只有 10 个真加载 `web/index.js`；
//   **0 个真的派发过一次点击**。而 leg89/92/103/105 四次实机病**全长在这条链上**。
//
// 这一族判据的形态纪律（照本仓同一把尺）：
//   ① 判据打在**真产物**上（从 `src/render.js` 真渲染出来的 HTML 形状），不是自造的形状；
//   ② 关键几条**自带反向对照**（证明它测的不是空气）；
//   ③ 不引入任何依赖 —— DOM 一律手写最小桩（本插件零依赖，不许引 jsdom）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createActionRouter } from '../web/action-router.js';

const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

/** 最小元素桩：只实现本模块真正用到的那几口（attribute 走 Map）。 */
function makeEl(attrs = {}, children = []) {
    const map = new Map(Object.entries(attrs));
    return {
        __clicks: 0,
        getAttribute: (k) => (map.has(k) ? map.get(k) : null),
        classList: { contains: (c) => String(map.get('class') || '').split(/\s+/).includes(c) },
        closest(sel) {
            // 只支持 `[data-action]` / `.sw2-goto` 两种选择器（本模块只用这两种）
            let n = this;
            while (n) {
                const hit = sel === '[data-action]' ? n.getAttribute('data-action') !== null
                    : sel === '.sw2-goto' ? n.classList.contains('sw2-goto')
                        : false;
                if (hit) return n;
                n = n.__parent || null;
            }
            return null;
        },
        click() { this.__clicks += 1; },
    };
}

/** 最小 window 桩：只实现 querySelector（`.sw2-goto` 那一支要用）。 */
function makeWin(bySelector = {}) {
    return { querySelector: (sel) => bySelector[sel] || null };
}

/** 装一个 router，并记下它收到的每一次派发（含事件对象）。 */
function harness(opts = {}) {
    const seen = [];
    const toggled = [];
    const router = createActionRouter({
        win: opts.win || makeWin(),
        dispatch: (action, payload, event) => seen.push({ action, payload, event }),
        toggleInject: (key, on) => toggled.push({ key, on }),
    });
    return { router, seen, toggled };
}

// ─────────────────── ① 模块形状 ───────────────────

test('leg107 · 新家存在且交出的两口是函数（route / handleClick）', () => {
    const { router } = harness();
    assert.equal(typeof router.route, 'function', 'route 必须是函数（判据的主要落点）');
    assert.equal(typeof router.handleClick, 'function', 'handleClick 必须是函数（薄壳）');
});

test('leg107 · ★接线层不再自己拼 payload（搬家完成的可观察证据）', () => {
    // ★为什么这条必须有：没有它，Task 1 的"搬家"这一步**无从证伪** ——
    //   上面那条形状判据在"搬了"和"没搬"两种情况下都会绿。
    //   搬家的定义就是"这段逻辑离开了 web/index.js"，所以判据必须打在 web/index.js 上。
    const index = read('web/index.js');
    assert.ok(!index.includes("getAttribute('data-source')"),
        '★web/index.js 里不许再手拼 payload（那 13 个 getAttribute 必须全搬走）');
    assert.match(index, /createActionRouter/,
        '★web/index.js 必须真的用上新家（否则上面那条可以靠"整段删掉"骗过去）');
});
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `cd F:\deepseek\plugins\story-world-v2; node --test test/action-router.test.js`
Expected: FAIL —— `Cannot find module '../web/action-router.js'`

- [ ] **Step 3: 建 `web/action-router.js`（把 `web/index.js:2941-2969` 那段搬进来）**

```js
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

/**
 * 把元素身上的 `data-*` 属性翻成 payload。
 * ★Task 4 要改的就是这一个函数（手写名单 → 照单全收）。
 */
function readPayload(el) {
    return { source: el.getAttribute('data-source'), vol: el.getAttribute('data-vol'), chain: el.getAttribute('data-chain'), filter: el.getAttribute('data-filter'), entity: el.getAttribute('data-entity'), name: el.getAttribute('data-name'), force: el.getAttribute('data-force'), snap: el.getAttribute('data-snap'), tick: el.getAttribute('data-tick'), param: el.getAttribute('data-param'), value: el.getAttribute('data-value'), key: el.getAttribute('data-key'), layer: el.getAttribute('data-layer') };
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
```

- [ ] **Step 4: 跑测试，确认形状两条绿、搬家那条仍红**

Run: `cd F:\deepseek\plugins\story-world-v2; node --test test/action-router.test.js`
Expected: 前两条 PASS；`★接线层不再自己拼 payload` **FAIL**（`web/index.js` 还没改）—— 这正是"搬家还没做完"的证据。

- [ ] **Step 5: 改 `web/index.js`（那 29 行换成 4 行）**

在 `web/index.js` 顶部的 import 区加一行：

```js
import { createActionRouter } from './action-router.js';
```

然后把 `bindActions()` 里从 `win.addEventListener('click', (e) => {`（`:2941`）
到 `});`（`:2969`）**整段**替换成：

```js
    createActionRouter({ win, dispatch: dispatchAction, toggleInject: sw2ToggleInject });
```

★ **替换时必须一并处理那 9 行注释**（`:2942-2950` 那段 leg89 的定案说明）——
它们讲的是"为什么这一支要在这里直接收"，**随代码一起搬进新模块的注释里**（Step 3 已含），
`web/index.js` 这一侧不再重复（重复就是第二份真相）。

- [ ] **Step 6: 跑全量判据 + 冒烟**

Run: `cd F:\deepseek\plugins\story-world-v2; node --test`
Expected: `pass 1096 · fail 0`（**与改动前逐条相同** —— 本任务是纯搬家，行为零变化）

Run: `cd F:\deepseek\plugins\story-world-v2; node demo/smoke-demo.js`
Expected: `PASS · 终态 SSOT 8231 字节`（**逐字节未变** ⇒ 引擎零漂移）

- [ ] **Step 7: 看行数（两个锁都不许碰）**

Run: `cd F:\deepseek\plugins\story-world-v2; node -e "console.log(require('fs').readFileSync('web/index.js','utf8').split('\n').length)"`
Expected: 比 3099 少约 25–29 行（即 ≈3070–3074），且仍 `> 2600`、`< 3100`。

- [ ] **Step 8: 提交**

把提交信息写进文件再 `-F`（PowerShell 会吃掉反引号）：

```bash
cd F:\deepseek\plugins
git add story-world-v2/web/action-router.js story-world-v2/web/index.js story-world-v2/test/action-router.test.js
git commit -F .leg107-task1.txt
```

---

## Task 2: 端到端判据 —— 真点击 → 断言引擎收到了什么

**Files:**
- Modify: `test/action-router.test.js`（追加）

**Interfaces:**
- Consumes: Task 1 的 `createActionRouter` / `route` / `handleClick`
- Produces: 无（纯判据）

- [ ] **Step 1: 追加判据（真产物 + 真点击 + 三支同序）**

在 `test/action-router.test.js` 末尾追加：

```js
// ─────────────────── ② 真产物 + 真点击（本笔的正事） ───────────────────

import { makeChronicleView, renderChronicleHtml } from '../src/render.js';

// ★★夹具的选择是**量出来的，不是猜的**：`golden-world.min.json` 的 `chronicle` 是 **0 条**
//   ⇒ 用它会渲染出**一枚分页器都没有**，下面那条判据就成了空锁（本笔第一版就写错了，现勘正）。
//   实测（本笔现跑）：`chronicle-page-real-world.json` = events 71 · chronicle **367** 条
//   ⇒ 它是仓里唯一能渲染出真分页按钮的夹具。
//   逐字形状（本笔现跑，range 取 'all' 或 '10' 都一样，pager 恒 1 枚）：
//   `<button class="sw2-btn" data-action="ch-page" data-value="next" data-layer="event"`
const REAL_WORLD = JSON.parse(readFileSync(new URL('./fixtures/chronicle-page-real-world.json', import.meta.url), 'utf8'));

/** 从真 HTML 里抠出**真的那枚**「下一页」按钮的属性（判据打在真产物上，不是自造形状）。 */
function realNextBtnAttrs() {
    const html = renderChronicleHtml(REAL_WORLD, { view: { ...makeChronicleView(), range: 'all' } });
    const m = /<button class="sw2-btn" (data-action="ch-page" data-value="next" data-layer="[a-z]+")/.exec(html);
    assert.ok(m, '★前置：真产物里必须有那枚「下一页」（没有它下面全是空锁）');
    const attrs = {};
    for (const a of m[1].matchAll(/([a-z-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    return attrs;
}

test('leg107 · ★真点击：从真产物取按钮 → 派发 click → 断言引擎收到的 {动作,参数} 逐字正确', () => {
    const attrs = realNextBtnAttrs();
    assert.equal(attrs['data-action'], 'ch-page');
    assert.equal(attrs['data-value'], 'next');
    assert.equal(attrs['data-layer'], 'event', '★前置：真产物那枚是事件层的（账目层那枚 leg105 已撤）');
    const { router, seen } = harness();
    router.handleClick({ target: makeEl(attrs) });
    assert.equal(seen.length, 1, '★一次点击必须正好派发一次（不多不少）');
    assert.equal(seen[0].action, 'ch-page');
    assert.equal(seen[0].payload.value, 'next');
    assert.equal(seen[0].payload.layer, 'event',
        '★★翻页必须带上"翻哪一层"——leg105 就是丢了这个键，于是点账目层翻的是事件层');
});

test('leg107 · 三支同序①：注入开关早退，**不进动作总线**', () => {
    const { router, seen, toggled } = harness();
    router.handleClick({ target: makeEl({ 'data-inject-switch': 'injectTagSpec', 'data-value': '1' }) });
    assert.deepEqual(seen, [], '★开关不许走总线（leg89 定案：不靠 data-action 的注册时序）');
    assert.deepEqual(toggled, [{ key: 'injectTagSpec', on: true }], '★开关必须当场收到');
});

test('leg107 · 三支同序②：`.sw2-goto` 早退，改为模拟点那枚页签', () => {
    const tab = makeEl({ class: 'sw2-tab', 'data-view': 'entities' });
    const { router, seen } = harness({ win: makeWin({ '.sw2-tab[data-view="entities"]': tab }) });
    router.handleClick({ target: makeEl({ class: 'sw2-goto', 'data-view': 'entities' }) });
    assert.equal(tab.__clicks, 1, '★必须真去点那枚页签');
    assert.deepEqual(seen, [], '★跳页签不走动作总线');
});

test('leg107 · 三支同序③：普通按钮走总线，且**事件对象原样递下去**', () => {
    const { router, seen } = harness();
    const e = { type: 'click', target: makeEl({ 'data-action': 'ents-page', 'data-value': 'prev' }) };
    router.handleClick(e);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].action, 'ents-page');
    assert.equal(seen[0].payload.value, 'prev');
    // ★事件对象必须**原样**递下去（处理器要靠它判断"点的是哪一枚"，见 web/index.js:2354 的 el 口径）
    assert.equal(seen[0].event, e, '★event 必须就是那一个对象本身，不许被丢掉或换掉');
});

test('leg107 · 没有 data-action 也不是 .sw2-goto ⇒ 一声不响（不许空派发）', () => {
    const { router, seen } = harness();
    router.handleClick({ target: makeEl({ class: 'sw2-hint' }) });
    assert.deepEqual(seen, [], '★空白处点一下不许派发任何动作');
});
```

- [ ] **Step 2: 跑，确认全绿**

Run: `cd F:\deepseek\plugins\story-world-v2; node --test test/action-router.test.js`
Expected: PASS（若 `realNextBtnAttrs` 的前置断言红 ⇒ 先查 `renderChronicleHtml` 的产物形状，别改判据去迁就）

- [ ] **Step 3: 跑全量 + 提交**

Run: `cd F:\deepseek\plugins\story-world-v2; node --test`
Expected: `pass 1096 + 新增条数 · fail 0`

---

## Task 3: ★★ 唯一那处语义改动 —— `data-*` 从手写名单 → 照单全收

**Files:**
- Modify: `web/action-router.js`（只改 `readPayload` 一个函数）
- Modify: `test/action-router.test.js`（追加两条 + 一条反向对照）

**Interfaces:**
- Consumes: Task 1 的 `readPayload(el)`
- Produces: 无（行为变更，不是接口变更）

- [ ] **Step 1: 先写失败的判据（TDD：这一条现在必须红）**

追加：

```js
test('leg107 · ★★不在旧名单上的 data-* 也要带上（leg105 那个病的**根**）', () => {
    // 旧实现是一张手写 13 词名单，名单外的键**静默扔掉**。
    // 这条用一个**旧名单里没有的**属性名（data-zzz）来证明"照单全收"真的生效了。
    const { router } = harness();
    const hit = router.route(makeEl({ 'data-action': 'ch-page', 'data-zzz': 'hello' }));
    assert.equal(hit.payload.zzz, 'hello',
        '★按钮身上写了什么就要拿什么 —— 名单制必须消失（多列/漏列同时成为不可能）');
});

test('leg107 · ★旧名单里那 3 个"没人读"的键不再由名单决定（有则带、无则不填）', () => {
    const { router } = harness();
    const withSrc = router.route(makeEl({ 'data-action': 'x', 'data-source': 's1' }));
    assert.equal(withSrc.payload.source, 's1');
    const without = router.route(makeEl({ 'data-action': 'x' }));
    assert.equal(without.payload.source, undefined,
        '★没有这个属性就不该有这个键（不许用默认值/占位值冒充）');
});
```

- [ ] **Step 2: 跑，确认这两条红**

Run: `cd F:\deepseek\plugins\story-world-v2; node --test test/action-router.test.js`
Expected: `不在旧名单上的 data-*` **FAIL**（`payload.zzz` 是 `undefined`）

- [ ] **Step 3: 改 `readPayload`（就这一个函数）**

```js
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
 *   对账：处理器读 12 个键，其中 10 个来自属性（照单全收一个都不会少）；
 *     另两个 `el` / `worldName` **不来自任何属性**（`data-el` / `data-world-name` 全仓零处出现）
 *     ⇒ 本笔**不改变它们的任何行为**（`worldName` 实测恒 undefined，本笔不动）。
 *   ★净收益：那份名单是一份**没人校对的复制品**（多列了 source/filter/key 三个没人读的键、
 *     又漏了 layer）⇒ 照单全收之后它整个消失，多列与漏列同时成为不可能。
 */
function readPayload(el) {
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
```

★ **同时必须给测试的最小元素桩补 `attributes`**（Task 1 的 `makeEl` 现在只有 `getAttribute`）——
否则 `readPayload` 取不到任何属性、`route` 会把 payload 交成空对象。把 `makeEl` 改成：

```js
function makeEl(attrs = {}, children = []) {
    const map = new Map(Object.entries(attrs));
    return {
        __clicks: 0,
        // ★leg107 Task 3：照单全收要遍历 attributes ⇒ 桩必须给出与真实 DOM 同形的形状
        get attributes() {
            return [...map.entries()].map(([name, value]) => ({ name, value }));
        },
        getAttribute: (k) => (map.has(k) ? map.get(k) : null),
        classList: { contains: (c) => String(map.get('class') || '').split(/\s+/).includes(c) },
        closest(sel) {
            let n = this;
            while (n) {
                const hit = sel === '[data-action]' ? n.getAttribute('data-action') !== null
                    : sel === '.sw2-goto' ? n.classList.contains('sw2-goto')
                        : false;
                if (hit) return n;
                n = n.__parent || null;
            }
            return null;
        },
        click() { this.__clicks += 1; },
    };
}
```

- [ ] **Step 4: 跑，确认绿**

Run: `cd F:\deepseek\plugins\story-world-v2; node --test test/action-router.test.js`
Expected: PASS

- [ ] **Step 5: ★补反向对照（证明上面那条测的不是空气）**

```js
test('leg107 · ★反向对照：把 data-layer 拿掉 ⇒ payload.layer 必须变成 undefined', () => {
    // 为什么必须有这一条：Task 2 那条"翻页必须带 layer"如果写成恒真断言（比如断言里有 || 'event'），
    //   它会在**丢键的情况下照样绿**。这条反向对照把那个洞堵死：
    //   属性在 ⇒ 键在；属性不在 ⇒ 键不在。两头都锁住，判据才不可能静默失效。
    const { router } = harness();
    const withLayer = router.route(makeEl({ 'data-action': 'ch-page', 'data-layer': 'book' }));
    assert.equal(withLayer.payload.layer, 'book');
    const without = router.route(makeEl({ 'data-action': 'ch-page' }));
    assert.equal(without.payload.layer, undefined, '★没有属性就不许有这个键');
});
```

- [ ] **Step 6: 跑全量判据 + 冒烟（★这一步是本笔的风险闸）**

Run: `cd F:\deepseek\plugins\story-world-v2; node --test`
Expected: `fail 0`。★若这里出现红 ⇒ **先看红在哪一层**：渲染层/引擎层的红说明照单全收确实影响了别人
（细案 §4.1 的取证就是为排除这个而做的）⇒ 此时**只回退 Step 3 那一个函数**，保留 Task 1/2。

Run: `cd F:\deepseek\plugins\story-world-v2; node demo/smoke-demo.js`
Expected: `PASS · 终态 SSOT 8231 字节`（逐字节未变）

- [ ] **Step 7: 提交**

```bash
cd F:\deepseek\plugins
git add story-world-v2/web/action-router.js story-world-v2/test/action-router.test.js
git commit -F .leg107-task3.txt
```

---

## Task 4: 收尾三件（台账 / 文档守门 / 交接）

**Files:**
- Modify: `docs/ledger.md`（补一行）
- Modify: `STATE.md`（§1 行数读数 + §4 上一棒）
- Create: `docs/session-handoff-<日期>-leg107.md`

**Interfaces:**
- Consumes: 全部前序任务
- Produces: 无

- [ ] **Step 1: 补台账一行（★必须 5 格，与表头同列数）**

`docs/ledger.md` 表头是 **5 格**：`日期 | 步骤 | 变更 | 测试 | 部署形态`。
`test/ledger-shape.test.js` 的计数棘轮会当场红，所以**先看表头再写**。

- [ ] **Step 2: 改 `STATE.md` §1 的行数读数**

`web/index.js` 行数那一格改成实测值（复量命令 `split('\n').length`）。
★**只改那一格**，不许在别处再写一份（`STATE.md` 开头那条纪律）。

- [ ] **Step 3: 跑文档守门**

Run: `cd F:\deepseek\plugins\story-world-v2; node scripts/audit-docs.mjs`
Expected: `PASS · 红 0`（黄 2 条是已知项：LEDGER.md 93 行超长 · 最新独立交接 leg99）

- [ ] **Step 4: 写交接文档**

落点 `docs/session-handoff-<日期>-leg107.md`，**只许引用 `STATE.md` §3 那份活儿清单，不许复制它**
（`STATE.md` §2.4 待办纪律第 1 条）。

- [ ] **Step 5: 全量终检 + 提交**

Run: `cd F:\deepseek\plugins\story-world-v2; node --test`（应全绿）
Run: `cd F:\deepseek\plugins\story-world-v2; node demo/smoke-demo.js`（应 `PASS · 8231 字节`）
Run: `cd F:\deepseek\plugins\story-world-v2; node scripts/audit-docs.mjs`（应 `PASS`）

```bash
cd F:\deepseek\plugins
git add story-world-v2/docs/ledger.md story-world-v2/STATE.md story-world-v2/docs/session-handoff-<日期>-leg107.md
git commit -F .leg107-task4.txt
```

---

## 留给用户跑的真机验收（Ctrl+Shift+R 之后）

这几条**只有人能做**（本仓没有浏览器，leg89 §5.5）：

1. 设置页那行 `构建 <号>` 应仍是 **`leg105-deadpager`**（本笔不升位）。
2. 编年页**事件层**那枚「下一页」：切到「全部轮次」能看到「第 1 / N 页」并能真翻页。
3. 实体页工具条四枚（筛选 / 排序 / 分组 / 口径）+ 那枚翻页照旧能动。
4. 注入开关点一下应**当场**切换（不是等下一次刷新才画出来）。
5. 参数页下拉框照旧能写进去。

---

## Self-Review（本计划对照细案逐条核）

| 细案要求 | 落在哪个任务 |
|---|---|
| §3 提成 `web/action-router.js` + 依赖注入 | Task 1 |
| §3 `web/index.js` 变薄（3099 → ≈3070） | Task 1 Step 7 |
| §4 `data-*` 照单全收 | Task 3 Step 3 |
| §4.1 取证"零处枚举 payload" | 已在细案取证，Task 3 Step 3 注释留档 |
| §4.2 `el` / `worldName` 行为不变 | Task 3 Step 3 注释留档；★判据**不**断言它们（断言"不变"要真引擎，本笔不碰） |
| §5 ① 真点击 → 断言 payload | Task 2 Step 1 |
| §5 ② leg105 回归锁 | Task 2 Step 1（真产物那条） |
| §5 ③ 反向对照 | Task 3 Step 5 |
| §5 ④ 三支同序 | Task 2 Step 1（三条） |
| §5 ⑤ 判据打在真产物上 | Task 2 Step 1（`realNextBtnAttrs` 从 `renderChronicleHtml` 抠真按钮） |
| §6 测试 / 部署 / 台账三件 | Task 1/2/3 的测试步 + Task 4 |
| §7 两笔分开、可单独回退 | Task 1（搬家）与 Task 3（那一刀）是两次独立提交 |

**占位符扫描**：无 TBD / TODO；每个改代码的步骤都给了完整代码。
**类型一致性**：`createActionRouter({win, dispatch, toggleInject})` → `{route, handleClick}`；
`route(el)` → `{action, payload} | null`；`readPayload(el)` → `object` —— 三个任务里的名字与形状一致。
**已知缺口（如实登记）**：`el` / `worldName` 两个键"行为逐字不变"这条**没有判据站岗**
（断言它要真引擎 + 真参数页路径，属 §2「不做」那一格）⇒ 留给后续那一笔。
