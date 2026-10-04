// story-world-v2/test/window-actionbar.test.js
// ★★★leg162（用户令「**上移就是独立于设置页了，不是只有在设置页显示，而是整个窗口的上方**」）：
//   **窗口外壳动作条**那一笔的正面锁。细案：`docs/spec-leg162-window-actionbar.md`。
//
// 这一笔把两枚世界级动作（开始新世界 / 推进一轮）从「设置」页底部那张「操作」卡
//   升进**窗口外壳**（`settings.html`，八页常驻）。本文件锁的是**"它真的在外壳、且只有一份"**
//   这半件无法由"页面渲染产物"证明的事——它的三条来路：
//     ① 页体是 `el.innerHTML = out[name]` 逐页整块替换 ⇒ 按钮住页里会被反复销毁重建；
//     ② `web/long-task.js` 那套"正在跑…就灰掉这枚按钮"靠的正是那个节点**别被换掉**
//        （它自己写着"重绘会把节点换掉 ⇒ 灰掉是尽力而为、**不是保证**"）；
//     ③ 画三份（页头/设置页/参数页）＝本仓最忌的"同一件事两处表达"（leg52 撤参数页那枚正是这个理由）。
//
// ★本文件里"锚点"那一半（②）用的是**产品自己认得的边界**（`web/page-compose.js` 认的那两个标记），
//   不另立一套标记——照那个文件 §纪律②。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderAll, renderSettingsHtml, renderParamsHtml } from '../src/render.js';
import { syncActionbar, ACTIONBAR_STATE_ID, AUTO_ADVANCE_KEY } from '../web/status-bar.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SHELL = read('settings.html');
const FALLBACK = read('web/window-shell.js');

/** 一份"形状够用"的世界（renderAll 只需要这些字段；照既有判据的夹具口径）。 */
function world() {
    return {
        version: 1,
        context: { world: '大荒', setting: { dynamic: { env: {} }, frozen: { canon: {} } } },
        entities: [],
        weights: {},
        agendas: [],
        events: [],
        chronicle: [],
        milestones: [],
        meta: { tick: 0 },
    };
}

// ─────────────────── ① 八页都在：动作条住模板，不住任何一页的渲染产物 ───────────────────
test('★★★leg162·①：动作条住**窗口外壳**（八页常驻），且**不在**任何一页的渲染产物里', () => {
    // 正面：外壳模板里真有那一条，且容器名就是它
    assert.match(SHELL, /<div class="sw2-actionbar" id="sw2_actionbar">/,
        '★外壳模板必须有那条动作条（它是八页常驻的那一份）');
    assert.match(SHELL, /data-action="init-world"/, '★「开始新世界」在外壳里');
    assert.match(SHELL, /data-action="advance-world"/, '★「推进一轮」在外壳里');
    // ★位置（用户第二句令「**把这两个放在右边和页签同一行要不然太丑了太突兀了**」）：
    //   两者必须在**同一个 `.sw2-navrow` 里**，且动作条排在页签**右边**（`margin-left:auto` 推右）。
    //   ★为什么不能并进 `.sw2-tabs` 里面：手机档 `.sw2-tabs` 是 `overflow-x:auto` 的横滑容器
    //     ⇒ 放进去的按钮会**跟着被滚走**（这是本条"包一层"的**唯一**理由，改之前先读它）。
    const iRow = SHELL.indexOf('<div class="sw2-navrow">');
    const iBar = SHELL.indexOf('<div class="sw2-actionbar" id="sw2_actionbar">');
    const iTabs = SHELL.indexOf('<nav class="sw2-tabs" id="sw2_tabs">');
    const iRowEnd = SHELL.indexOf('</div>', SHELL.indexOf('</div>', iBar) + 6);
    assert.ok(iRow > 0 && iBar > iRow && iTabs > iRow && iBar > iTabs && iRowEnd > iBar,
        `★动作条与页签必须在同一个 .sw2-navrow 里、且按钮在页签右边（实测 row=${iRow} tabs=${iTabs} bar=${iBar}）`);
    // 反面：不许再有一条"自己占一整行"的动作条（就是用户否掉的那一版）
    assert.ok(!/sw2-actionbar[^>]*>\s*<\/div>\s*<div class="sw2-navrow"/.test(SHELL), '★动作条不许再自己占一整行');
    // 八页的渲染产物里**一页都不许有它**
    const out = renderAll(world(), { config: {}, oldVolumes: [], view: {} });
    for (const name of ['panorama', 'chronicle', 'archive', 'entities', 'setting', 'params', 'snapshots', 'settings']) {
        const html = String(out[name] || '');
        assert.ok(!html.includes('data-action="advance-world"'), `★${name} 页的产物里不许有「推进一轮」（它住外壳）`);
        assert.ok(!html.includes('data-action="init-world"'), `★${name} 页的产物里不许有「开始新世界」（它住外壳）`);
        assert.ok(!html.includes('sw2_actionbar'), `★${name} 页的产物里不许自己造一个动作条`);
    }
});

// ─────────────────── ② 回退壳同形：模板取不到时也不许少东西 ───────────────────
test('★★leg162·②：回退壳（模板取不到时那一个）**同形**——两枚按钮一个不少', () => {
    // 本仓既有纪律：回退路不许比正路少东西（"模板不可用"是玩家真会遇到的一格）。
    const m = /const FALLBACK_WINDOW = `([\s\S]*?)`;/.exec(FALLBACK);
    assert.ok(m, '前置：取得到 `FALLBACK_WINDOW` 那段模板（取不到 ⇒ 本条空绿）');
    const fb = m[1];
    assert.ok(fb.includes('data-action="init-world"'), '★回退壳里也要有「开始新世界」');
    assert.ok(fb.includes('data-action="advance-world"'), '★回退壳里也要有「推进一轮」');
    assert.ok(fb.includes(`id="${ACTIONBAR_STATE_ID}"`), '★那一格状态也要在（否则回退态下它永远是空的）');
});

// ─────────────────── ③ 只许一份：全仓只有外壳那一处按钮定义 ───────────────────
test('★★leg162·③：两枚按钮**只许有一处定义**（外壳那一份；渲染层一枚都不许再画）', () => {
    const settings = renderSettingsHtml(world(), { config: {} });
    const params = renderParamsHtml(world(), { config: {} });
    assert.ok(!settings.includes('data-action="init-world"'), '★设置页不许再画「开始新世界」');
    assert.ok(!settings.includes('data-action="advance-world"'), '★设置页不许再画「推进一轮」');
    assert.ok(!params.includes('data-action="advance-world"'), '★参数页照旧不许画（leg52 那一条没撤）');
    // ★注释里提到旧话是留档、不是回潮 ⇒ 只判**模板与渲染产物**，不判源码注释。
    assert.ok(!/<h4>操作<\/h4>/.test(settings), '★设置页那张「操作」卡整张已撤（卡里只剩那两枚按钮）');
});

// ─────────────────── ④ ★状态那格读真源：先证红（写死一句话当场咬住） ───────────────────
test('★★★leg162·④：动作条右端那格状态**由真值分派**，不是写死的一句话', () => {
    // 病（写死一个字面量就是这么来的）：玩家关掉总闸之后，顶上照旧说"世界随对话自动推进"
    //   ⇒ 他下一次发消息等世界动而它不动，或者以为「推进一轮」是多余的。
    const nodes = new Map();
    const mkEl = () => ({
        textContent: '', classList: { has: false, toggle(cls, on) { this.has = !!on; } },
    });
    const realDoc = globalThis.document;
    globalThis.document = { getElementById: (id) => nodes.get(id) || null };
    try {
        // 前置：节点不在 ⇒ 静默返回（不许抛）
        assert.doesNotThrow(() => syncActionbar(world(), {}), '★拿不到节点时必须静默（不许影响面板渲染）');
        nodes.set(ACTIONBAR_STATE_ID, mkEl());
        const el = nodes.get(ACTIONBAR_STATE_ID);

        // 开着 ⇒ 说"会自动推进"，且不带暂停态
        syncActionbar({ context: { setting: { dynamic: { env: { [AUTO_ADVANCE_KEY]: '1' } } } } }, {
            envOf: (w) => w.context.setting.dynamic.env,
        });
        assert.equal(el.textContent, '世界随对话自动推进', '★开着时那句话');
        assert.equal(el.classList.has, false, '★开着时不该带暂停态');

        // 关着 ⇒ 必须改口（★这一条就是"先证红"：把文案写成一句话，它当场不成立）
        syncActionbar({ context: { setting: { dynamic: { env: { [AUTO_ADVANCE_KEY]: '0' } } } } }, {
            envOf: (w) => w.context.setting.dynamic.env,
        });
        assert.equal(el.textContent, '已暂停 · 不会自动推进', '★★关着时必须改口（写死一句话就过不了这一条）');
        assert.equal(el.classList.has, true, '★关着时要带暂停态（状态条那行要看得出来）');

        // 缺键 = 关（与 `switchOn` 同口径：**只有显式 '1' 算开**）
        syncActionbar({ context: { setting: { dynamic: { env: {} } } } }, { envOf: (w) => w.context.setting.dynamic.env });
        assert.equal(el.textContent, '已暂停 · 不会自动推进', '★缺键 = 关（空着就是空着）');

        // 真源取不到、且**没有世界** ⇒ 留空（不猜一句话）
        el.textContent = '哨兵';
        syncActionbar(null, { onOf: () => null });
        assert.equal(el.textContent, '哨兵', '★没有世界时不许猜一句话，那一格要留空');

        // 真源取不到、但有世界 ⇒ 退到镜像那一档（兜底仍要出声）
        syncActionbar(null, { onOf: () => true });
        assert.equal(el.textContent, '世界随对话自动推进', '★真源取不到时退镜像那档（兜底不许静默）');
    } finally {
        if (realDoc === undefined) delete globalThis.document; else globalThis.document = realDoc;
    }
});
