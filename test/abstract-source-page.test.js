// story-world-v2/test/abstract-source-page.test.js
// 「抽象来源」页面（`web/abstract-selection.js`）的**实际操作回归**：真点击、真改选、真取产。
//
// 本文件与 `abstract-selection.test.js` 的分工：
//   · 那一份咬"纯选择模块 + 界面的老契约"（稳定 ID、分组、转义、搜索不重建）；
//   · 这一份咬 Task 2 的**新行为**（批准设计 §4.2/§4.3/§5.1）：
//       ① 完整来源清单（禁用/技术/空正文/卡四项/跨来源同号）都在页面上，失败书与真空分形；
//       ② 默认档勾选 = **默认生效集**（compose 的 defaultSelectedIds），查看/预览不改设置；
//          第一次真实改动才转自选，且基线是 defaultSelectedIds；
//       ③ 批量只作用于**当前筛选范围**：取消禁用/技术/空正文，隐藏的勾选与"已消失的存档 ID"都不许动；
//       ④ 每条独立读取方式：自动清理 / 原文全文 / 多个原文选段（坐标按**原始 UTF-16** 保存，
//          CRLF 与 emoji 都要对）；原文变化之后选段失效**看得见**且不生效；
//       ⑤ 最终预览用生产 `composeInitSource` 的 text（同一份计算，不另写 UI 取料）。
//
// ★夹具全部走**生产函数**（`collectAbstractSources` / `composeInitSource`），页面只当消费者 ——
//   判据咬的是"页面有没有把 Task 1 的结果如实呈现并如实写回"，不是"页面自己算得对不对"。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectAbstractSources, migrateAbstractSelectionState } from '../src/abstract-input.js';
import { composeInitSource } from '../src/init-source.js';
import { entrySelectionId } from '../src/abstract-selection.js';
import { bindAbstractSelection, renderAbstractSelection } from '../web/abstract-selection.js';
import { normalizeNewlines } from '../web/abstract-source-editor.js';
import { checkedValues, clickAction, fire, makeDom, typeSearch, visibleItems } from './fixture-picker-dom.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ═══════════════════════════ 夹具 ═══════════════════════════

const BOOK = '大荒';
const worldEntry = (over) => ({ key: [over.comment], _sw2Source: BOOK, ...over });

const ENTRIES = [
    worldEntry({ uid: 1, comment: '昆仑道宫', content: '昆仑道宫立于西荒，掌教清玄真人。' }),
    worldEntry({ uid: 2, comment: '万法阁', content: '万法阁藏器三千，阁主公输巧。', disable: true }),
    worldEntry({ uid: 3, comment: '空条目', content: '' }),
    worldEntry({ uid: 4, comment: '[mvu_update]变量规则', content: 'const hidden = 1; // 专用技术条目' }),
    worldEntry({ uid: 5, comment: '脚本块', content: '<script>window.__sw2Pwned = 1;</script>结尾正文。' }),
    worldEntry({ uid: 7, comment: '甲', content: '甲来源（大荒）的正文。' }),
    { ...worldEntry({ uid: 7, comment: '甲', content: '甲来源（三国）的正文。' }), _sw2Source: '三国' },
];

const CARD = {
    name: '测试卡',
    description: '卡描述正文', scenario: '卡场景正文', personality: '卡性格正文', first_mes: '卡开场正文',
};

const idOf = (entry) => entrySelectionId(entry);
const cardId = (field) => `character-fields:测试卡:${field}`;

/** 一份**生产**快照（页面拿到的就是它；`compose` 就是 `composeInitSource`）。 */
function snapshotFor({ entries = ENTRIES, character = CARD, selection = { mode: 'default' }, worldSources = null, cardPending = false } = {}) {
    const sources = collectAbstractSources({ worldInfoEntries: entries, character, worldSources });
    return {
        sources,
        worldSources,
        cardPending,
        selection,
        compose: (sel) => composeInitSource({ character, worldInfoEntries: entries, worldSources, selection: sel }),
        migration: migrateAbstractSelectionState({ selection, sources }),
    };
}

/** 装好页面并跑完首次读取（返回真实 DOM、写回记录、重读计数）。 */
async function mount(options = {}) {
    const { doc, win } = makeDom();
    globalThis.document = doc;
    const writes = [];
    const reloads = [];
    const snaps = [];
    let gets = 0;
    const state = { snapshot: () => snapshotFor(options) };
    const api = bindAbstractSelection(win, {
        getSnapshot: async () => { gets += 1; const snap = state.snapshot(); snaps.push(snap); return snap; },
        writeSelection: (sel) => { writes.push(sel); },
        reloadSources: () => { reloads.push(Date.now()); },
    });
    await api.sync();
    await tick();
    return { doc, win, api, writes, reloads, state, snaps, reads: () => gets };
}

const itemOf = (win, id) => win.querySelectorAll('[data-source-item]').find((i) => i.getAttribute('data-source-id') === id);
const itemById = (win, id) => { const el = itemOf(win, id); assert.ok(el, `页面上必须有这条来源：${id}`); return el; };
const checkboxOf = (win, id) => itemById(win, id).querySelector('[data-source-entry]');
/** 那一行的状态文字（假 DOM 的 `textContent` 不含子孙 ⇒ 取状态那一格）。 */
const stateTextOf = (win, id) => itemById(win, id).querySelector('[data-source-state-text]').textContent;
const inItem = (win, id, action) => {
    const el = itemById(win, id).querySelector(`[data-source-action="${action}"]`);
    assert.ok(el, `${id} 这一行必须有 ${action}`);
    el.dispatchEvent({ type: 'click', target: el });
    return el;
};
const lastWrite = (writes) => writes[writes.length - 1];

test('正文栏关闭后保留选段、勾选与搜索，再次查看可重新打开且不写设置', async () => {
    const id = idOf(ENTRIES[0]);
    const raw = ENTRIES[0].content;
    const selection = { version: 2, mode: 'custom', selectedIds: [id, idOf(ENTRIES[5])], reads: {
        [id]: { mode: 'segments', originalText: raw, segments: [{ start: 0, end: 2, text: raw.slice(0, 2) }] },
    } };
    const { doc, win, writes } = await mount({ selection });
    typeSearch(win, '昆仑');
    const search = win.querySelector('[data-source-search]');
    const box = checkboxOf(win, id);
    const opener = inItem(win, id, 'focus');
    const pane = win.querySelector('[data-source-detail-pane]');
    assert.equal(pane.hasAttribute('hidden'), false);
    assert.ok(pane.querySelector('[data-source-action="close-pane"]'), '正在查看的正文必须有关闭按钮');
    clickAction(win, 'close-pane');
    assert.equal(pane.hasAttribute('hidden'), true, '关闭后正文不占页面空间');
    assert.equal(win.querySelector('[data-source-columns]').hasAttribute('data-source-detail-open'), false);
    assert.equal(win.querySelector('[data-source-search]'), search, '关闭不重建搜索控件');
    assert.equal(search.value, '昆仑');
    assert.equal(checkboxOf(win, id), box, '关闭不重建列表');
    assert.equal(box.checked, true);
    assert.equal(doc._activeElement, opener, '焦点回到刚才的查看正文按钮');
    inItem(win, id, 'focus');
    assert.equal(pane.hasAttribute('hidden'), false);
    assert.equal(win.querySelector('[data-source-columns]').hasAttribute('data-source-detail-open'), true);
    assert.equal(pane.querySelector('[data-source-original]').value, raw);
    assert.equal(pane.querySelectorAll('[data-source-segment]').length, 1, '已保存的选段仍在');
    assert.equal(pane.querySelector('[data-source-read="segments"]').checked, true);
    assert.equal(writes.length, 0, '查看和关闭都不改变取料设置');
    assert.deepEqual(selection.reads[id].segments, [{ start: 0, end: 2, text: raw.slice(0, 2) }]);
});

test('没有查看条目时正文栏隐藏，列表使用全部宽度', async () => {
    const { win } = await mount();
    assert.equal(win.querySelector('[data-source-detail-pane]').hasAttribute('hidden'), true);
    assert.equal(win.querySelector('[data-source-columns]').hasAttribute('data-source-detail-open'), false);
});

// ═══════════════════════ ① 完整清单与状态分形 ═══════════════════════

test('来源页①：禁用/技术/空正文/同号异源/卡四项**全部在列**，各组分开，控件齐备', async () => {
    const html = renderAbstractSelection({
        sources: collectAbstractSources({ worldInfoEntries: ENTRIES, character: CARD }),
        selection: { mode: 'default' },
    });
    for (const hook of ['data-source-picker', 'data-source-search', 'data-source-mode-state="default"', 'data-source-filter',
        'data-source-action="all"', 'data-source-action="none"', 'data-source-action="invert"', 'data-source-action="reload"',
        'data-source-action="exclude-disabled"', 'data-source-action="exclude-technical"', 'data-source-action="exclude-empty"',
        'data-source-group=', 'data-source-item', 'data-source-entry', 'data-source-status']) {
        assert.ok(html.includes(hook), `★控件/钩子必须在位：${hook}`);
    }
    const values = checkedValues(html);   // 静态壳（没有 defaultSelectedIds）⇒ 一条都不勾，交给控制器填
    assert.deepEqual(values, [], '★静态壳不许假装知道默认生效集（那是 compose 的事）');
    // 分组：大荒、三国、角色卡正文
    const groups = [...html.matchAll(/data-source-group="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(groups.includes('大荒') && groups.includes('三国') && groups.includes('角色卡正文'),
        `★按来源分组，卡四项自成一格；实际 ${JSON.stringify(groups)}`);
    // 同号异源：两条 `甲` 各自的 ID 都在（不许合并成一条）
    assert.ok(html.includes(`value="${idOf(ENTRIES[5])}"`), '★大荒那一条在列');
    assert.ok(html.includes(`value="${idOf(ENTRIES[6])}"`), '★三国那条也在列（跨来源同号不许互相吞）');
    for (const field of ['description', 'scenario', 'personality', 'first_mes']) {
        assert.ok(html.includes(`value="${cardId(field)}"`), `★卡字段 ${field} 必须独立成行`);
    }
    assert.match(html, /取消勾选禁用项/, '★批量菜单那一枚的文案是"取消勾选禁用项"（说清它只改本次选择）');
});

test('来源页②：技术条目只作文本材料（原文可看、**不执行**），失败书与未加载卡与真空各有各的话', () => {
    const worldSources = [{ name: '读不到的书', ok: false, entries: 0 }];
    const character = { ...CARD, shallow: true, description: '', scenario: '', personality: '', first_mes: '' };
    const html = renderAbstractSelection({
        sources: collectAbstractSources({ worldInfoEntries: ENTRIES, character, worldSources }),
        worldSources,
        cardPending: true,
        selection: { mode: 'default' },
    });
    assert.match(html, /读不到的书/, '★读取失败的书要列出来');
    assert.match(html, /读取失败/, '★并且明说"读取失败"——不与"书里没有"混同');
    assert.match(html, /还没加载完/, '★未加载的角色卡正文如实说"还没加载完"');
    assert.match(html, /空条目/, '★真正空正文的条目照样在列（题名与来源可查）');
    assert.match(html, /技术/, '★技术条目带标记');
    // 技术代码只以**文本**身份出现（转义后的），一个字符都不许变成可执行的标签
    assert.ok(!html.includes('<script>window.__sw2Pwned'), '★原文里的 script 标签必须被转义');
    assert.ok(html.includes('&lt;script&gt;'), '★转义之后仍看得见（是文本，不是被吞掉）');
});

// ═══════════════════════ ② 默认档 / 首次改写 / 预览 ═══════════════════════

test('来源页③：默认档勾选 = compose 的 defaultSelectedIds（禁用/技术/空正文不勾），查看与预览不改设置', async () => {
    const { win, writes } = await mount();
    const composed = composeInitSource({ character: CARD, worldInfoEntries: ENTRIES, selection: { mode: 'default' } });
    const expected = new Set(composed.defaultSelectedIds);
    const got = win.querySelectorAll('[data-source-entry]').filter((b) => b.checked).map((b) => b.value);
    assert.deepEqual(got.slice().sort(), [...expected].slice().sort(), '★默认档勾的就是本次默认真正会读的那些来源');
    assert.equal(checkboxOf(win, entrySelectionId(ENTRIES[1])).checked, false, '★默认禁用的条目在默认档不勾（它本来就不读）');
    assert.equal(checkboxOf(win, entrySelectionId(ENTRIES[2])).checked, false, '★空正文不勾');
    assert.equal(checkboxOf(win, entrySelectionId(ENTRIES[3])).checked, false, '★专用技术条目不勾');
    assert.equal(checkboxOf(win, cardId('description')).checked, true, '★卡正文默认读取 ⇒ 勾上');
    // ★查看/预览是**看**：不许写设置
    inItem(win, entrySelectionId(ENTRIES[1]), 'focus');
    const summary = win.querySelector('[data-source-effective] summary');
    if (summary) fire(summary, 'click');
    assert.deepEqual(writes, [], '★查看正文与展开最终预览都不算改动（一个字都不许写回设置）');
    assert.ok(win.querySelector('[data-source-original]'), '★详情面里有只读原文');
    assert.equal(win.querySelector('[data-source-original]').value, '万法阁藏器三千，阁主公输巧。',
        '★只读原文是**原始正文**（没被清理过的），它是编辑材料、不是事实');
});

test('来源页④：第一次真实改动才转自选，基线是 defaultSelectedIds；未纳入的新条目不许被顺手勾上', async () => {
    const { win, writes } = await mount();
    const composed = composeInitSource({ character: CARD, worldInfoEntries: ENTRIES, selection: { mode: 'default' } });
    const disabledId = entrySelectionId(ENTRIES[1]);
    const box = checkboxOf(win, disabledId);
    box.checked = true;
    fire(box, 'change');
    const written = lastWrite(writes);
    assert.equal(written.version, 2, '★新写入必须带 version:2（Task 1 的迁移与读法都靠它）');
    assert.equal(written.mode, 'custom');
    assert.equal(win.querySelector('[data-source-mode]').value, 'custom', '实际改选后模式控件同步显示自选');
    assert.ok(written.selectedIds.includes(disabledId), '★明确勾选的禁用条目要进自选（只改读取副本）');
    for (const id of composed.defaultSelectedIds) assert.ok(written.selectedIds.includes(id), `★默认生效集里的 ${id} 必须作为基线带上`);
    assert.equal(written.selectedIds.includes(entrySelectionId(ENTRIES[3])), false, '★技术条目没被顺手勾上');
    assert.equal(written.selectedIds.includes(entrySelectionId(ENTRIES[2])), false, '★空正文没被顺手勾上');
    assert.deepEqual(written.reads, {}, '★还没选读法 ⇒ 空 reads（不是 undefined）');
    // 取消勾选同理：去掉那一条，基线其余照旧
    const again = checkboxOf(win, disabledId);
    assert.equal(again.checked, true, '★重画之后它照旧是勾上的（所见即所选）');
    again.checked = false;
    fire(again, 'change');
    assert.equal(lastWrite(writes).selectedIds.includes(disabledId), false, '★取消勾选真去掉');
});

test('来源页⑤：卡片四项**各自独立**取消；最终预览用生产 compose 的 text（排除的正文一个字都不在）', async () => {
    const everything = [...ENTRIES.map(idOf), cardId('description'), cardId('scenario'), cardId('personality'), cardId('first_mes')];
    const { win, writes } = await mount({ selection: { version: 2, mode: 'custom', selectedIds: everything, reads: {} } });
    await tick();
    const before = win.querySelector('[data-source-effective-text]').textContent;
    assert.ok(before.includes('卡描述正文') && before.includes('卡场景正文'), '★清空之前两份卡正文都在预览里');
    const box = checkboxOf(win, cardId('description'));
    box.checked = false;
    fire(box, 'change');
    await tick();
    const written = lastWrite(writes);
    assert.equal(written.selectedIds.includes(cardId('description')), false, '★描述被排除');
    assert.ok(written.selectedIds.includes(cardId('scenario')), '★场景不受牵连（四项各自身份）');
    assert.ok(written.selectedIds.includes(cardId('personality')) && written.selectedIds.includes(cardId('first_mes')), '★性格与开场白也在');
    const after = win.querySelector('[data-source-effective-text]').textContent;
    assert.equal(after.includes('卡描述正文'), false, '★被排除的卡正文不许再出现在最终预览里');
    assert.ok(after.includes('卡场景正文'), '★其余卡正文照旧生效');
    assert.ok(after.includes('昆仑道宫立于西荒'), '★世界书正文照旧生效');
});

// ═══════════════════════ ③ 批量：只作用于当前筛选范围 ═══════════════════════

test('来源页⑥：取消勾选禁用项只作用于**当前搜索结果**——隐藏的禁用项与可见的启用项都不许动', async () => {
    const entries = [
        worldEntry({ uid: 11, comment: '法王殿', content: '法王殿正文。', disable: true }),
        worldEntry({ uid: 12, comment: '幽冥王座', content: '幽冥王座正文。', disable: true }),
        worldEntry({ uid: 13, comment: '藏剑山庄', content: '藏剑山庄正文。', disable: true }),
        worldEntry({ uid: 14, comment: '王城守卫', content: '王城守卫正文。' }),
        worldEntry({ uid: 15, comment: '昆仑道宫', content: '昆仑道宫正文。' }),
    ];
    const all = entries.map(idOf);
    const { win, writes, snaps } = await mount({ entries, selection: { version: 2, mode: 'custom', selectedIds: all, reads: {} } });
    assert.equal(writes.length, 0, '★打开页面本身不许写设置');
    typeSearch(win, '王');
    const visible = visibleItems(win).map((i) => i.getAttribute('data-source-id'));
    assert.deepEqual(visible.slice().sort(), [idOf(entries[0]), idOf(entries[1]), idOf(entries[3])].sort(),
        '★搜索"王"命中三条（藏剑山庄与昆仑道宫被藏起来）');
    clickAction(win, 'exclude-disabled');
    const visibleDisabled = checkboxOf(win, idOf(entries[0]));
    const hiddenDisabled = checkboxOf(win, idOf(entries[2]));
    const visibleEnabled = checkboxOf(win, idOf(entries[3]));
    assert.equal(visibleDisabled.checked, false, '★可见的禁用项被取消勾选');
    assert.equal(hiddenDisabled.checked, true, '★★藏起来的禁用项仍是勾上的（批量只作用于当前结果）');
    assert.equal(visibleEnabled.checked, true, '★可见的启用项不受牵连');
    const written = lastWrite(writes);
    assert.equal(written.selectedIds.includes(idOf(entries[0])), false, '★写回里可见禁用项已去掉');
    assert.ok(written.selectedIds.includes(idOf(entries[2])), '★★写回里隐藏禁用项的勾选必须原样保留');
    assert.ok(written.selectedIds.includes(idOf(entries[3])) && written.selectedIds.includes(idOf(entries[4])), '★两条启用项都还在');
    // ★"取消勾选禁用项"只改**本次抽象选择**：原条目的 disable 标记与夹具原件一个字节都不许动
    const disabledSource = snaps[snaps.length - 1].sources.find((s) => String(s.id) === idOf(entries[0]));
    assert.equal(disabledSource.disabled, true, '来源清单里它照旧是禁用条目');
    assert.equal(disabledSource.entry.disable, true, '★★原条目的 disable 标记不许改（读取副本才允许放开）');
    assert.equal(entries[0].disable, true, '★★夹具原件（= 作者的书）也没被动过');
    // 与搜索/筛选无关的批量（全选/取消/反选）也守同一条口径
    typeSearch(win, '藏剑');
    clickAction(win, 'none');
    assert.equal(checkboxOf(win, idOf(entries[2])).checked, false, '★当前可见的那条被取消');
    assert.ok(lastWrite(writes).selectedIds.includes(idOf(entries[0])) === false, '★上一步的取消照旧作数');
    assert.ok(lastWrite(writes).selectedIds.includes(idOf(entries[4])), '★范围外那条（昆仑道宫）没被"取消结果"波及');
});

test('来源页⑦：已消失的存档 ID 与筛选藏起来的勾选在批量之后都必须活着', async () => {
    const entries = [
        worldEntry({ uid: 21, comment: '甲条', content: '甲条正文。', disable: true }),
        worldEntry({ uid: 22, comment: '乙条', content: '乙条正文。' }),
    ];
    const gone = '大荒:作者早就删掉的条目';
    const { win, writes } = await mount({ entries, selection: { version: 2, mode: 'custom', selectedIds: [idOf(entries[0]), idOf(entries[1]), gone], reads: {} } });
    typeSearch(win, '甲条');
    clickAction(win, 'exclude-disabled');
    assert.deepEqual(lastWrite(writes).selectedIds, [idOf(entries[1]), gone],
        '★可见的禁用项去掉、已消失的存档 ID 原样带着（悄悄抹掉 = 作者改回来时玩家的勾选已经没了）');
    const status = win.querySelector('[data-source-status]').textContent;
    assert.match(status, /已不在/, '★界面上如实提示还有存档 ID 不在书里');
});

test('来源页⑧：跨来源同号互不牵连——勾大荒的 7 号不会连坐三国的 7 号', async () => {
    const a = idOf(ENTRIES[5]);
    const b = idOf(ENTRIES[6]);
    assert.notEqual(a, b, '★同一号、不同来源必须是两个 ID');
    const { win, writes } = await mount({ selection: { version: 2, mode: 'custom', selectedIds: [a], reads: {} } });
    assert.equal(checkboxOf(win, a).checked, true);
    assert.equal(checkboxOf(win, b).checked, false, '★另一本书里同号的那条不许跟着勾上');
    const box = checkboxOf(win, b);
    box.checked = true;
    fire(box, 'change');
    assert.deepEqual(lastWrite(writes).selectedIds, [a, b], '★两条各自独立勾上');
    const first = checkboxOf(win, a);
    first.checked = false;
    fire(first, 'change');
    assert.deepEqual(lastWrite(writes).selectedIds, [b], '★取消一条不许带走另一条');
});

// ═══════════════════════ ④ 原文选段：保存 / 恢复 / 失效 ═══════════════════════

const SEG_RAW = '甲😀\r\n乙段\n丙尾';   // 原文：甲0 😀1,2 \r3 \n4 乙5 段6 \n7 丙8 尾9
const SEG_ENTRY = worldEntry({ uid: 31, comment: '选段来源', content: SEG_RAW });

test('来源页⑨：原文选段按**原始 UTF-16** 保存（CRLF 与 emoji 都要对），多段连接进最终预览', async () => {
    const id = idOf(SEG_ENTRY);
    const { win, writes } = await mount({ entries: [SEG_ENTRY], selection: { version: 2, mode: 'custom', selectedIds: [id], reads: {} } });
    await tick();
    inItem(win, id, 'focus');
    const area = win.querySelector('[data-source-original]');
    assert.ok(area, '★详情面里必须有一份只读原文');
    assert.equal(area.value, normalizeNewlines(SEG_RAW), '★textarea 拿到的是**换行归一**之后的原文（真浏览器同款）');
    // 读法切到"原文选段"（一次真实改动）
    const mode = win.querySelector('[data-source-read="segments"]');
    mode.checked = true;
    fire(mode, 'change');
    // 划选两段：emoji（显示 [1,3)）与"丙尾"（显示 [7,9)）
    area.selectionStart = 1; area.selectionEnd = 3;
    const writesBefore = area._valueWrites || 0;
    clickAction(win, 'add-segment');
    area.selectionStart = 7; area.selectionEnd = 9;
    clickAction(win, 'add-segment');
    await tick();
    assert.equal(area._valueWrites || 0, writesBefore,
        '★★加选段不许再给 textarea 赋一次值（真浏览器里那一赋就把用户刚划好的选区挪到末尾）');
    const written = lastWrite(writes);
    const read = written.reads[id];
    assert.equal(read.mode, 'segments');
    assert.equal(read.originalText, SEG_RAW, '★★保存的原文必须是**原始正文**（逐字相等是 Task 1 的核对前提）');
    assert.deepEqual(read.segments.map((s) => s.text), ['😀', '丙尾'], '★两段按划选顺序保存');
    assert.deepEqual(read.segments.map((s) => [s.start, s.end]), [[1, 3], [8, 10]],
        '★坐标是原始 UTF-16：emoji 占两格；CRLF 让后半段整体右移一格');
    for (const s of read.segments) assert.equal(SEG_RAW.slice(s.start, s.end), s.text, '★★Task 1 核对口径逐段成立');
    await tick();
    const preview = win.querySelector('[data-source-effective-text]').textContent;
    assert.ok(preview.includes('😀') && preview.includes('丙尾'), '★选段真的进了最终预览');
    assert.equal(preview.includes('乙段'), false, '★没选中的原文不许混进来');
    assert.match(win.querySelector('[data-source-segment-count]').textContent, /2/, '★页面上说得出选了几段');
    // 重开一次（同一份已保存的设置）⇒ 选段要恢复出来
    const again = await mount({ entries: [SEG_ENTRY], selection: written });
    await tick();
    inItem(again.win, id, 'focus');
    const rows = again.win.querySelectorAll('[data-source-segment]');
    assert.equal(rows.length, 2, '★重开之后两段都回来了');
    assert.ok(again.win.querySelector('[data-source-original]').value.startsWith('甲'), '★原文面照旧在');
});

test('来源页⑩：原文改了之后选段**失效可见**、不生效、不回退全文；读法仍留在设置里等用户重选', async () => {
    const id = idOf(SEG_ENTRY);
    const saved = {
        version: 2, mode: 'custom', selectedIds: [id],
        reads: { [id]: { mode: 'segments', originalText: SEG_RAW, segments: [{ start: 8, end: 10, text: '丙尾' }] } },
    };
    const { win } = await mount({ entries: [SEG_ENTRY], selection: saved });
    await tick();
    assert.ok(win.querySelector('[data-source-effective-text]').textContent.includes('丙尾'), '★原文没变时选段生效');
    // 作者改了原文（同一个 uid、同一身份）⇒ 核对失败
    const changed = worldEntry({ uid: 31, comment: '选段来源', content: '甲😀\r\n乙段\n丙尾（改过）' });
    const { win: win2, writes: writes2 } = await mount({ entries: [changed], selection: saved });
    await tick();
    const item = itemById(win2, id);
    const badges = stateTextOf(win2, id);
    assert.match(badges, /选段|重新选择/, `★失效要在那一行看得见；实际：${badges}`);
    const preview = win2.querySelector('[data-source-effective-text]').textContent;
    assert.equal(preview.includes('丙尾'), false, '★失效的选段不许生效');
    assert.equal(preview.includes('乙段'), false, '★也不许回退全文（宁可不给，不猜）');
    const expanded = win2.querySelector('[data-source-effective-notes]').textContent;
    assert.match(expanded, /重新选择/, '★展开区里说得出为什么（原文对不上）');
    assert.deepEqual(writes2, [], '★这不是用户的改动 ⇒ 一个字都不许写回去（等他自己重选）');
});

// ═══════════════════════ ⑤ 重读与持久化 ═══════════════════════

test('来源页⑪：重读走接线层的失效口并现取重填；重读本身不改设置', async () => {
    const state = { entries: [SEG_ENTRY] };
    const { doc, win } = makeDom();
    globalThis.document = doc;
    const writes = [];
    const api = bindAbstractSelection(win, {
        getSnapshot: async () => snapshotFor({ entries: state.entries, character: null, selection: { version: 2, mode: 'custom', selectedIds: ['大荒:早就删掉的'], reads: {} } }),
        writeSelection: (sel) => { writes.push(sel); },
        reloadSources: () => { writes.push({ reloaded: true }); },
    });
    await api.sync();
    await tick();
    assert.equal(win.querySelectorAll('[data-source-item]').length, 1);
    state.entries = [SEG_ENTRY, worldEntry({ uid: 32, comment: '新条目', content: '新条目正文。' })];
    clickAction(win, 'reload');
    await tick();
    await tick();
    assert.equal(win.querySelectorAll('[data-source-item]').length, 2, '★重读要现取重填（作者刚改了书）');
    assert.deepEqual(writes[0], { reloaded: true }, '★重读必须先走失效口（下游取书缓存不许留着旧书）');
    assert.equal(writes.length, 1, '★重读本身不改选择（一个字节都不写回设置）');
    assert.ok(win.querySelector('[data-source-status]').textContent.includes('已不在'), '★消失的存档 ID 在重读之后照旧提示');
});

// ═══════════════════════ ⑥ 转义与不可执行 ═══════════════════════

test('来源页⑫：原文里的标签与闭标签一律转义成文本；技术代码进的是只读材料，永不执行', async () => {
    const evil = worldEntry({ uid: 41, comment: '</script><img src=x onerror=alert(1)>', content: '正文 </script> <b>不是粗体</b>。' });
    const { doc, win } = makeDom();
    globalThis.document = doc;
    const html = renderAbstractSelection({
        sources: collectAbstractSources({ worldInfoEntries: [evil], character: null }),
        selection: { mode: 'custom', selectedIds: [idOf(evil)], reads: {} },
    });
    assert.ok(!html.includes('</script><img'), '★★夹具里塞的闭标签不许把页面切断（闭 script 标签会提前结束整段脚本）');
    assert.ok(!html.includes('<b>不是粗体</b>'), '★正文里的标签必须转义');
    assert.ok(html.includes('&lt;/script&gt;'), '★转义之后仍看得见（是文本）');
    const api = bindAbstractSelection(win, {
        getSnapshot: async () => snapshotFor({ entries: [evil], character: null, selection: { version: 2, mode: 'custom', selectedIds: [idOf(evil)], reads: {} } }),
        writeSelection: () => {},
    });
    await api.sync();
    await tick();
    inItem(win, idOf(evil), 'focus');
    const area = win.querySelector('[data-source-original]');
    assert.equal(area.value, '正文 </script> <b>不是粗体</b>。', '★只读原文里是**文本本身**（不是可执行的 DOM）');
    assert.equal(win.querySelectorAll('img').length, 0, '★一个注入进来的元素都不许出现');
    assert.equal(globalThis.window?.__sw2Pwned, undefined, '★技术代码永不被执行');
});

// ═══════════════════════ ⑦ 迁移元数据的展示 ═══════════════════════

// ═══════════════════════ ⑧ 所有者归属：过期快照 / 记住的自选 / 整块解释 ═══════════════════════
//
// 设计 §5.2：「切换聊天、角色或书源时废弃过期的读取结果」。**快照属于它被取出来的那个所有者**——
//   之后的每一次真实改动都要问一句"这一份还是不是当前的"；不是 ⇒ 一个字都不改，页面重装当前状态。
// 设计 §4.2：页底解释（模式/字数/条数/清单/截取）说的是**本次实际生效材料**——正文变了，
//   解释必须跟着一起变；不许正文换了、解释还停在初始那一次。★这两条都不许在 UI 里另算一份取料。

/** 带**所有者**的一份生产快照（接线层给的就是它：`owner` 是共享来源身份，`isSnapshotCurrent` 判它过不过期）。 */
function ownedSnapshot({ entries, selection, character = null, key }) {
    return {
        sources: collectAbstractSources({ worldInfoEntries: entries, character }),
        selection,
        owner: { key },
        compose: (sel) => composeInitSource({ character, worldInfoEntries: entries, selection: sel }),
    };
}

test('来源页⑭：所有者过期之后的事件一个字都不写，页面**重新装载当前状态**', async () => {
    const { doc, win } = makeDom();
    globalThis.document = doc;
    const writes = [];
    const entriesB = [worldEntry({ uid: 91, comment: '乙书条', content: '乙书正文。', _sw2Source: '乙书' })];
    let live = 'A';                    // 接线层那边"现在是谁的"（换所有者 = 手里这一份快照作废）
    const api = bindAbstractSelection(win, {
        getSnapshot: async () => (live === 'A'
            ? ownedSnapshot({ entries: ENTRIES, character: CARD, key: 'A', selection: { version: 2, mode: 'custom', selectedIds: [idOf(ENTRIES[0])], reads: {} } })
            : ownedSnapshot({ entries: entriesB, key: 'B', selection: { version: 2, mode: 'custom', selectedIds: [idOf(entriesB[0])], reads: {} } })),
        writeSelection: (sel) => { writes.push(sel); },
        isSnapshotCurrent: (owner) => owner?.key === live,
    });
    await api.sync();
    await tick();
    assert.equal(checkboxOf(win, idOf(ENTRIES[0])).checked, true, '★一开始显示 A 的选择');
    live = 'B';                        // ★所有者换了：手里这一份快照已经过期
    const box = checkboxOf(win, idOf(ENTRIES[1]));
    box.checked = true;
    fire(box, 'change');
    await tick();
    await tick();
    assert.deepEqual(writes, [], '★★过期所有者的事件一个字都不许写（更不许先改了页面再说成功）');
    assert.equal(checkboxOf(win, idOf(entriesB[0])).checked, true, '★页面重新装载当前所有者：乙书那条勾着');
    assert.equal(win.querySelectorAll('[data-source-item]').some((i) => i.getAttribute('data-source-id') === idOf(ENTRIES[0])), false,
        '★甲书的行撤掉了（不许停在过期快照上）');
});

test('来源页⑮：记住的自选**不跨所有者**——新所有者按它自己的设置/默认基线起算', async () => {
    const { doc, win } = makeDom();
    globalThis.document = doc;
    const writes = [];
    const entriesB = [worldEntry({ uid: 91, comment: '乙书条', content: '乙书正文。', _sw2Source: '乙书' })];
    let live = 'A';
    const api = bindAbstractSelection(win, {
        getSnapshot: async () => (live === 'A'
            ? ownedSnapshot({ entries: ENTRIES, character: CARD, key: 'A', selection: { version: 2, mode: 'custom', selectedIds: [idOf(ENTRIES[0])], reads: { [idOf(ENTRIES[0])]: { mode: 'full' } } } })
            : ownedSnapshot({ entries: entriesB, key: 'B', selection: { version: 2, mode: 'default', selectedIds: [], reads: {} } })),
        writeSelection: (sel) => { writes.push(sel); },
        isSnapshotCurrent: (owner) => owner?.key === live,
    });
    await api.sync();
    await tick();
    const mode = win.querySelector('[data-source-mode]');
    mode.value = 'default';
    fire(mode, 'change');              // 自选 → 默认：控制器会记住 A 的自选与 reads
    await tick();
    assert.equal(writes.length, 1, '★先写一次"切到默认"');
    live = 'B';
    await api.reload();                // ★真实接线换所有者时会重绑/重读
    await tick();
    const mode2 = win.querySelector('[data-source-mode]');
    mode2.value = 'custom';
    fire(mode2, 'change');
    await tick();
    const saved = writes[writes.length - 1];
    assert.deepEqual(saved.selectedIds, [idOf(entriesB[0])], '★★B 的自选基线是 B 自己那份默认（绝不许带上 A 的记忆）');
    assert.deepEqual(saved.reads, {}, '★A 的 reads 也不许跟过来');
    assert.equal(JSON.stringify(saved).includes(idOf(ENTRIES[0])), false, '★A 的条目 ID 一个字都不在 B 里');
});

test('来源页⑯：同一所有者的已存自选在重读与重开之后都还在（含**显式空自选**）', async () => {
    // ① 同一控制器：显式空自选 → 默认 → 重读 ⇒ 切回自选仍是空（不是"没选过"）
    const { doc, win } = makeDom();
    globalThis.document = doc;
    const writes = [];
    let selection = { version: 2, mode: 'custom', selectedIds: [], reads: {} };
    const api = bindAbstractSelection(win, {
        getSnapshot: async () => ownedSnapshot({ entries: ENTRIES, character: CARD, key: 'A', selection }),
        writeSelection: (sel) => { writes.push(sel); selection = sel; },
        isSnapshotCurrent: () => true,
    });
    await api.sync();
    await tick();
    assert.equal(win.querySelector('[data-source-mode]').value, 'custom', '★先是一份显式空自选');
    const mode = win.querySelector('[data-source-mode]');
    mode.value = 'default';
    fire(mode, 'change');
    await tick();
    await api.reload();                // ★同一所有者重读
    await tick();
    const mode2 = win.querySelector('[data-source-mode]');
    mode2.value = 'custom';
    fire(mode2, 'change');
    await tick();
    assert.deepEqual(writes[writes.length - 1].selectedIds, [], '★★重读之后切回自选仍是显式空（不许被默认基线顶掉）');

    // ② 重开面板（新控制器）：已存的那份自选（带读法）仍要能恢复出来
    const kept = idOf(ENTRIES[1]);     // 默认禁用的那条 ⇒ 它只可能来自用户的自选
    const again = await mount({ selection: { version: 2, mode: 'default', selectedIds: [kept], reads: { [kept]: { mode: 'full' } } } });
    await tick();
    const mode3 = again.win.querySelector('[data-source-mode]');
    mode3.value = 'custom';
    fire(mode3, 'change');
    await tick();
    const saved = lastWrite(again.writes);
    assert.deepEqual(saved.selectedIds, [kept], '★★重开之后切回自选，恢复的是**已存的那一份自选**（不是默认全勾）');
    assert.equal(saved.reads[kept]?.mode, 'full', '★那一条的读法（原文全文）也不丢');
});

test('来源页⑰：最终预览的**整块解释**随生效结果刷新，且与生产 compose 逐字一致', async () => {
    const { win, writes } = await mount();
    await tick();
    const details = win.querySelector('[data-source-effective]');
    details.setAttribute('open', '');                                  // ★用户展开着看
    const summaryOf = () => win.querySelector('[data-source-effective]').querySelector('summary').textContent;
    const noteOf = () => win.querySelector('[data-source-effective-note]').textContent;
    const rowsOf = () => win.querySelectorAll('[data-source-effective-entry]').length;
    /** 与生产 compose 对齐的三件读数：正文逐字、解释里的字数/条数、生效清单条数。 */
    const coherent = (selection, label) => {
        const composed = composeInitSource({ character: CARD, worldInfoEntries: ENTRIES, selection });
        assert.equal(win.querySelector('[data-source-effective-text]').textContent, composed.text, `★${label}：预览正文 = 生产 compose 的 text`);
        assert.ok(noteOf().includes(`最终读取 ${[...composed.text].length} 字符 · 生效 ${composed.effectiveEntries.length} 条`),
            `★${label}：解释的读数跟着生效结果走；实际「${noteOf()}」`);
        assert.equal(rowsOf(), composed.effectiveEntries.length, `★${label}：生效清单条数与生产一致`);
        return composed;
    };
    coherent({ mode: 'default' }, '初始默认档');
    assert.match(summaryOf(), /默认来源/, '★初始摘要是默认档');
    const beforeNote = noteOf();
    clickAction(win, 'none');                                          // ★取消结果 ⇒ 自选 + 空
    await tick();
    await tick();
    const empty = coherent(lastWrite(writes), '取消结果之后');
    assert.equal(lastWrite(writes).mode, 'custom');
    assert.match(summaryOf(), /自选来源/, '★★摘要里的模式标签也要跟着走');
    assert.notEqual(noteOf(), beforeNote, '★★解释不许停在初始那一次（字数/条数真的变了）');
    assert.equal(empty.effectiveEntries.length, 0, '夹具口径：取消结果之后生产结果确实是空的');
    assert.ok(win.querySelector('[data-source-effective]').hasAttribute('open'), '★展开状态不许被刷新弄丢');
    assert.equal(win.querySelector('[data-source-effective]'), details, '★还是同一枚 details（整块解释是刷新，不是重建）');
    // 逐条读法（原文全文）也要让解释跟着动
    const disabledId = idOf(ENTRIES[1]);
    inItem(win, disabledId, 'focus');
    const area = win.querySelector('[data-source-original]');
    area.selectionStart = 1;
    area.selectionEnd = 3;
    const full = win.querySelector('[data-source-read="full"]');
    full.checked = true;
    fire(full, 'change');
    await tick();
    await tick();
    const picked = coherent(lastWrite(writes), '单条改用原文全文');
    assert.ok(picked.effectiveEntries.length > 0, '★夹具口径：改读法之后确实有生效条目');
    assert.equal(win.querySelector('[data-source-original]').selectionStart, 1, '★只读原文的选区不许被刷新碰掉');
    // 选段改动走同一条 commit/刷新路 ⇒ 解释照旧跟着动
    const seg = win.querySelector('[data-source-read="segments"]');
    seg.checked = true;
    fire(seg, 'change');
    await tick();
    const area2 = win.querySelector('[data-source-original]');
    assert.equal(area2, area, '★读法切换不重建只读原文（同一枚 textarea）');
    area2.selectionStart = 0;
    area2.selectionEnd = 2;
    clickAction(win, 'add-segment');
    await tick();
    await tick();
    coherent(lastWrite(writes), '单条改用原文选段');
    assert.match(win.querySelector('[data-source-segment-count]').textContent, /1 段/, '★选段真的加上了');
    // 搜索框是**输入控件**：不重建、不丢词
    const search = typeSearch(win, '昆仑');
    await tick();
    assert.equal(win.querySelector('[data-source-search]'), search, '★搜索框还是原来那一枚（不重建输入控件）');
    assert.equal(win.querySelector('[data-source-search]').value, '昆仑', '★搜索词不丢');
    // 切回默认档 ⇒ 解释与正文一起回到生产默认结果
    typeSearch(win, '');
    const mode = win.querySelector('[data-source-mode]');
    mode.value = 'default';
    fire(mode, 'change');
    await tick();
    await tick();
    coherent(lastWrite(writes), '切回默认档');
    assert.match(summaryOf(), /默认来源/);
});

test('来源页⑬：旧配置迁移完成时页面直接呈现迁移后的选择（读法/新增卡正文都在），且不重复写盘', async () => {
    const legacy = { mode: 'custom', selectedIds: ['大荒:1'] };
    const { win, writes } = await mount({ selection: legacy });
    await tick();
    // 页面只呈现接线层给的快照；迁移与落盘由 web/panel-tools.js 负责（见 wiring 判据）
    assert.ok(win.querySelectorAll('[data-source-item]').length > 0, '★页面照常列出全部来源');
    assert.equal(checkboxOf(win, cardId('description')).checked, false,
        '★快照说"还没迁移/卡没加载"时，卡正文不许被页面自己勾上（迁移不是 UI 的活）');
    assert.deepEqual(writes, [], '★页面不许自己落盘迁移结果');
});
