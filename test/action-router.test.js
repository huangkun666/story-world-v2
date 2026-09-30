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
import { createActionRouter, readPayload } from '../web/action-router.js';
import { makeChronicleView, renderChronicleHtml, renderChainViewHtml } from '../src/render.js';
import { expandChain } from '../src/chain.js';

const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

/** 最小元素桩：只实现本模块真正用到的那几口（attribute 走 Map）。 */
function makeEl(attrs = {}, children = []) {
    const map = new Map(Object.entries(attrs));
    return {
        __clicks: 0,
        // ★leg107 Task 3：照单全收要遍历 attributes ⇒ 桩必须给出与真实 DOM 同形的形状
        //   （`[{name, value}]`，名字带 `data-` 前缀）。缺了它，readPayload 会交出空对象。
        get attributes() {
            return [...map.entries()].map(([name, value]) => ({ name, value }));
        },
        getAttribute: (k) => (map.has(k) ? map.get(k) : null),
        classList: { contains: (c) => String(map.get('class') || '').split(/\s+/).includes(c) },
        closest(sel) {
            // ★只支持本模块真正用到的三种选择器（桩不许"什么都能匹配"——那会让判据变成空绿）。
            //   ★leg107 踩过：第一版只支持后两种，于是"注入开关"那条判据拿到 null、
            //     整条链静默走空（判据红得对，是**桩**缺了一口）。
            let n = this;
            while (n) {
                const hit = sel === '[data-inject-switch]' ? n.getAttribute('data-inject-switch') !== null
                    : sel === '[data-action]' ? n.getAttribute('data-action') !== null
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

/** 最小 window 桩：querySelector（`.sw2-goto` 那一支）+ addEventListener（本模块把委托挂在它身上）。
 *  ★监听器**记下来**：这样判据能真的派发一次点击，而不是绕过委托直接调 handleClick。 */
function makeWin(bySelector = {}) {
    const listeners = {};
    return {
        listeners,
        addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
        /** 真派发：模拟浏览器把事件交给委托 */
        fire: (type, event) => { for (const fn of listeners[type] || []) fn(event); },
        querySelector: (sel) => bySelector[sel] || null,
    };
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
    //
    // ★★口径必须精确到"**那一条**"（本判据第一版写宽了，当场被咬红，留档）：
    //   仓里**还有第二处**手拼 payload —— `web/index.js:2670` 的链浮层
    //   （它挂在 `document.body`、走不到 win 委托，细案 §2 明确列为"本笔不做"）。
    //   所以不许用 `includes("getAttribute('data-source')")` 那种宽断言（它会连浮层一起算进去，
    //   而且**连我自己写的注释都会算进去**）。定稿：只咬**主委托那一条 13 键全量拼装**。
    const index = read('web/index.js');
    assert.ok(!/payload = \{ source: el\.getAttribute\('data-source'\)/.test(index),
        '★主委托那一条 13 键全量拼装必须整条搬走（不许在 web/index.js 里留残骸）');
    assert.match(index, /createActionRouter\(\{ win, dispatch: dispatchAction, toggleInject: sw2ToggleInject \}\)/,
        '★web/index.js 必须真的用上新家（否则上面那条可以靠"整段删掉"骗过去）');
    // ★★leg108：链浮层那一处**也收干净了**（leg107 把它如实登记为"本笔不做"，leg108 做掉）。
    //   口径照 leg107 §4.1 那条留档：搬族的判据要**改指新家 + 重新想清楚锁的是哪一层**——
    //   不许删、也不许照抄。旧版这里是"它仍在原地"的登记，现在反过来：**它必须不在**。
    assert.ok(!/source: act\.getAttribute\('data-source'\)/.test(index),
        '★链浮层那张 7 词手写名单必须消失（它是 leg107 拆掉的那份"没人校对的复制品"的**第二份**）');
    assert.match(index, /dispatchAction\(action, readPayload\(act\), e\)/,
        '★浮层必须改用同一条读法（不是"整段删掉"就算数）');
    // ★★★leg142（用户令「把获取模型列表…和测试是否连通做一下」）：**这一族搬去了 `web/model-channel.js`**
    //   （理由：`web/index.js` 只剩 1 行，而那两个新功能本来就属于这一族 ⇒ 搬出去正好落在同一个家里）。
    //   ⇒ 照本仓那条"搬族的判据要改指新家、**重新想清楚锁的是哪一层**"办（leg107 §4.1 立的）：
    //     **两头都咬** —— 老地方不许留残骸（留了就是"同一件事两处实现"，迟早分叉）、新家必须真有这一条。
    const hub = read('web/model-channel.js');
    assert.ok(!/dispatchAction\('set-param'/.test(index),
        '★参数页那一格的手拼 payload 必须**整条搬走**（web/index.js 里不许留第二份）');
    assert.match(hub, /dispatchAction\('set-param', \{ \.\.\.payload, value: payload\.value \?\? hit\.value, el: hit \}, e\)/,
        '★新家必须真有这一条（`el` 仍是手工加的那一个键，如实登记）');
    assert.match(index, /dispatch: dispatchAction/,
        '★新家必须真的拿到 dispatch（否则上面那条可以靠"整段删掉"骗过去）');
    // ★反向对照（防上面三条靠"整段删掉"骗过去）：readPayload 必须**真的被引进来**，
    //   而上面两条要求它**真的被调用** —— 删掉调用点会让它们红，删掉 import 会让这条红。
    assert.match(index, /import \{ createActionRouter, readPayload \} from '\.\/action-router\.js'/,
        '★readPayload 必须真的被引进来（否则"把那段整段删掉"也能骗过上面两条）');
});

// ─────────────────── ② 真产物 + 真点击（本笔的正事） ───────────────────

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

test('leg107 · ★真派发：挂上委托 → 真的派发一次 click（不是绕过委托直接调函数）', () => {
    // 为什么单独一条：上面那条走的是 `handleClick`（薄壳直调）。这一条走的是**委托本身** ——
    //   证明"挂上去"这一步真的发生了（否则模块可以只是导出了两个没人接的函数）。
    const win = makeWin();
    const { router, seen } = harness({ win });
    assert.equal((win.listeners.click || []).length, 1, '★委托必须真的挂在 win 上（且只挂一条）');
    win.fire('click', { target: makeEl(realNextBtnAttrs()) });
    assert.equal(seen.length, 1, '★浏览器把事件交给委托之后，引擎必须收到那一次派发');
    assert.equal(seen[0].action, 'ch-page');
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
    // ★事件对象必须**原样**递下去（处理器要靠它判断"点的是哪一枚"，见 web/index.js 的 el 口径）
    assert.equal(seen[0].event, e, '★event 必须就是那一个对象本身，不许被丢掉或换掉');
});

test('leg107 · 没有 data-action 也不是 .sw2-goto ⇒ 一声不响（不许空派发）', () => {
    const { router, seen } = harness();
    router.handleClick({ target: makeEl({ class: 'sw2-hint' }) });
    assert.deepEqual(seen, [], '★空白处点一下不许派发任何动作');
});

// ─────────── ③ ★★唯一的语义改动：data-* 从手写名单 → 照单全收 ───────────

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

test('leg107 · ★反向对照：把 data-layer 拿掉 ⇒ payload.layer 必须变成 undefined', () => {
    // 为什么必须有这一条：上面"翻页必须带 layer"那条如果写成恒真断言（比如断言里带 || 'event'），
    //   它会在**丢键的情况下照样绿**。这条反向对照把那个洞堵死：
    //   属性在 ⇒ 键在；属性不在 ⇒ 键不在。两头都锁住，判据才不可能静默失效。
    const { router } = harness();
    const withLayer = router.route(makeEl({ 'data-action': 'ch-page', 'data-layer': 'book' }));
    assert.equal(withLayer.payload.layer, 'book');
    const without = router.route(makeEl({ 'data-action': 'ch-page' }));
    assert.equal(without.payload.layer, undefined, '★没有属性就不许有这个键');
});

// ─────────── ④ leg108：接线层「手拼 payload」归零（链浮层 + 参数页两格） ───────────
//
// 病（与 leg107 治的那一处**同源**，只是换了地方）：`readPayload` 在接线层里还有**两份手写复制品**——
//   · 链浮层 `web/index.js:2670`：7 词名单 `source/vol/chain/entity/name/snap/tick`；
//   · 参数页 `web/index.js:1315`：点名 `param`/`value` 两键，再手工塞一个 `el`。
// ★**先量后说**（本棒实测，不含糊）：这两处**今天都不出 bug** —— 浮层里只有 `data-vol`/`data-chain`
//   两种属性（旧名单是**超集**），参数控件只有 `data-param`/`data-value`。⇒ 本棒治的是**病根**：
//   复制品每多一份，就多一处"漏一个词 ⇒ 点了没反应"的入口（leg105 那个病的来路）。

/** 浮层里那枚「阅卷」按钮的**真产物**属性（`renderChainViewHtml` 渲出来的 HTML，不是自造形状）。 */
function realReadVolumeBtnAttrs() {
    // 夹具照 `test/render.test.js` 的 `chainWorld()` ＋ K41/A-15「里程碑穿透」那一条的改法
    //   （**有大事纪 + 有卷区间**才会装配阅卷按钮；没有它，下面两条就是空锁）。
    const w = {
        version: 1,
        context: { world: '江州', tension: 0.5, positions: ['江州'] },
        entities: [{ id: 'e_gov', kind: 'faction', name: '江州官府', location: '江州' }],
        weights: {},
        agendas: [],
        events: [{ id: 'ev_2_1', title: '边关商路重开', source: { type: 'ripple', ref: 'ev_1_1' }, position: '江州', ripples: [], links: { up: ['ev_1_1'], down: [] }, closed: false }],
        chronicle: [],
        milestones: [{ id: 'm_30', span: { from: 1, to: 30 }, counts: { events: 7 }, titles: ['穷山的来客'], ids: ['ev_1_1'], links: { up: [], down: ['ev_2_1'] } }],
        meta: { tick: 6 },
    };
    const html = renderChainViewHtml(expandChain(w, 'ev_2_1'), { world: w, volumes: [{ id: '卷一', info: '', fromTick: 1, toTick: 30 }] });
    const m = /<button class="sw2-volact" data-action="read-volume" data-vol="([^"]*)"/.exec(html);
    assert.ok(m, '★前置：真产物里必须有那枚「阅卷」——没有它下面两条就是**空锁**（leg107 栽过这一跤）');
    return { 'data-action': 'read-volume', 'data-vol': m[1] };
}

test('leg108 · ★真产物：浮层那枚「阅卷」→ 同一条读法交出逐字正确的参数', () => {
    const attrs = realReadVolumeBtnAttrs();
    const payload = readPayload(makeEl(attrs));
    assert.equal(payload.vol, '卷一', '★按钮身上写了什么就要拿什么（旧名单恰好也带 vol——这条锁的是"以后还带"）');
    assert.equal(payload.action, 'read-volume', '★属性就是属性：`data-action` 也照单全收（旧 7 词名单里没有它）');
});

test('leg108 · ★反向对照：旧名单外的 `data-*` 在浮层这条路上也必须带上', () => {
    // 为什么必须有：上面那条拿 `data-vol` 证明"能拿到"，而 `data-vol` **旧名单里也有**
    //   ⇒ 它单独存在时，判据在"名单制"与"照单全收"两种实现下**都会绿**（恒真断言）。
    //   用一个旧名单里没有的词，才真正证明浮层那条路也不再是名单制。
    const payload = readPayload(makeEl({ 'data-action': 'read-volume', 'data-vol': '卷一', 'data-layer': 'book' }));
    assert.equal(payload.layer, 'book', '★`data-layer` 正是 leg105 被扔掉的那一个词——浮层这条路也不许再扔');
    const without = readPayload(makeEl({ 'data-action': 'read-volume', 'data-vol': '卷一' }));
    assert.equal(without.layer, undefined, '★没有这个属性就不许有这个键（两头都锁住，判据不可能静默失效）');
});

test('leg108 · ★参数页那一格：三种真控件形状（下拉 / 开关 / 数字框）走同一条读法', () => {
    // 三种控件的**真形状**取自 `src/render.js`（本棒现读）：
    //   · 下拉 `:533` `<select data-action="set-param" data-param="…">`（**无** data-value ⇒ 值取控件的活值）
    //   · 开关 `:587` `<button data-action="set-param" data-param="…" data-value="1">`
    //   · 数字框 `:621` `<input data-action="set-param" data-param="…" value="…">`（是 `value`，**不是** `data-value`）
    const sel = readPayload(makeEl({ 'data-action': 'set-param', 'data-param': 'tension' }));
    assert.equal(sel.param, 'tension');
    assert.equal(sel.value, undefined, '★下拉没有 data-value ⇒ 不许凭空造一个 value（活值兜底那一步在接线层）');
    const btn = readPayload(makeEl({ 'data-action': 'set-param', 'data-param': 'injectTagSpec', 'data-value': '1' }));
    assert.equal(btn.value, '1', '★开关的 data-value 照单全收');
    const num = readPayload(makeEl({ 'data-action': 'set-param', 'data-param': 'maxTicks', value: '30' }));
    assert.equal(num.param, 'maxTicks');
    assert.equal(num.value, undefined, '★裸 `value` 属性不是 `data-*` ⇒ 读法不认它（兜底 `?? hit.value` 在接线层）');
});
