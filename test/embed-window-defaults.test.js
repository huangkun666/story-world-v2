// story-world-v2/test/embed-window-defaults.test.js
// ★★★窗口下界那三个选择点的判据（`web/embed-runtime.js`：补建 / 召回 / 统计）。
//
// 【咬的是什么病】三处都写着「给了下界就用它，没给就按当前轮次与窗口算一把」，
//   而形参缺省是 `null`、`Number(null) === 0` ⇒ **"没给"这条路永远落在 0**：
//   补建一件都不嵌（索引永远空着）、统计永远报"不欠"、召回永远报"没候选"——
//   ★症状是"这一栏是空的"，而读数上一切正常（本仓为这类静默付过账）。
// 【钉的是什么】① 不传/传空 ⇒ 按当前轮次与「往事轮数」算；② 显式 `floor: 0` ⇒ 照 0 办
//   （那是调用方明的，不许被"缺省"吞掉）；③ 轮次公式与检索排序一个都不改。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmbedRuntime } from '../web/embed-runtime.js';

const SIG = { model: 'qwen-x', dims: 2 };
const TICK_NOW = 6;                     // 受控账本：当下第 6 轮
const WINDOW = 3;                       // 「往事轮数」在这一族里是**旋钮**，不是常量
const FLOOR = TICK_NOW - WINDOW + 1;    // 4 ⇒ 第 1、2、3 轮已滑出窗口，第 4 至 6 轮还在窗口内

/** 假存储（与 `createIdbVectorStore` 同接口）：内存里一份对象。 */
function fakeStore() {
    let disk = null;
    const calls = { load: 0, save: 0, drop: 0 };
    return {
        calls,
        disk: () => disk,
        async load() { calls.load += 1; return disk; },
        async save(j) { calls.save += 1; disk = JSON.parse(JSON.stringify(j)); },
        async drop() { calls.drop += 1; disk = null; },
    };
}

/** 第 1 至 6 轮各一行编年（每条一件），另留一条未决事件（查询串拼得出来）。 */
function worldAtSix() {
    return {
        entities: [{ id: 'e1', name: '甲' }],
        events: [{ id: 'ev_6_1', title: '甲入北山', source: { type: 'state' }, position: '北山', ripples: ['e1'], tick: 6 }],
        chronicle: [1, 2, 3, 4, 5, 6].map((t) => ({ id: `ch_${t}_1`, tick: t, text: `第${t}轮：甲办了一件事`, kind: 'state' })),
        agendas: [],
        meta: { tick: TICK_NOW },
    };
}

/** 假嵌入通道：记下真发出去的每一行，回的都是同一条向量（相似度不是这一族要咬的东西）。 */
function fakeClient() {
    const sent = [];
    return { sent, embed: async (texts) => { sent.push(...texts); return texts.map(() => [1, 0]); } };
}

const ticksWith = (disk) => ((disk && disk.tickByIndex) || []).slice().sort((a, b) => a - b);

test('W1：★不传下界的补建 ⇒ 收窗口外那三件（第 6 轮 · 窗口 3 ⇒ 第 1 至 3 轮），不是"一件都不嵌"', async () => {
    const store = fakeStore();
    const client = fakeClient();
    const rt = createEmbedRuntime({ indexStore: store, client, signature: SIG, windowTurns: () => WINDOW });
    const r = await rt.stepForTick({ world: worldAtSix(), maxItemsPerTurn: 10 });
    assert.equal(r.embedded, 3, `★下界 ${FLOOR} ⇒ 滑出窗口的三件都该补上：${JSON.stringify(r)}`);
    assert.deepEqual(ticksWith(store.disk()), [1, 2, 3], '★落盘的正是滑出窗口那三行');
    assert.equal(client.sent.length, 3, '★窗口内的第 4 至 6 轮不许发出去（那是「纪事」的活儿）');
});

test('W2：显式递"同一把尺算出来的那个数"（下界 4）⇒ 与不传收得一模一样', async () => {
    const store = fakeStore();
    const rt = createEmbedRuntime({ indexStore: store, client: fakeClient(), signature: SIG });
    const r = await rt.stepForTick({ world: worldAtSix(), floor: FLOOR, maxItemsPerTurn: 10 });
    assert.equal(r.embedded, 3);
    assert.deepEqual(ticksWith(store.disk()), [1, 2, 3], '★修复只接上缺省那条路，公式与选中的行都不变');
});

test('W3：★补建那一次现给的窗口盖过出厂值（没装旋钮、只在这一轮带窗口 3 ⇒ 同样收三件）', async () => {
    const store = fakeStore();
    const rt = createEmbedRuntime({ indexStore: store, client: fakeClient(), signature: SIG });   // 不给旋钮 ⇒ 出厂 50 ⇒ 下界 0
    const r = await rt.stepForTick({ world: worldAtSix(), windowTurns: WINDOW, maxItemsPerTurn: 10 });
    assert.equal(r.embedded, 3, '★这一条走的是"调用方现递窗口"那一支');
    assert.deepEqual(ticksWith(store.disk()), [1, 2, 3]);
});

test('W4：★显式 `floor: 0` 保持原义 —— 照 0 办（一件都不算滑出窗口、一次盘都不写），不被"缺省"吞掉', async () => {
    const store = fakeStore();
    const rt = createEmbedRuntime({ indexStore: store, client: fakeClient(), signature: SIG, windowTurns: () => WINDOW });
    const r = await rt.stepForTick({ world: worldAtSix(), floor: 0, maxItemsPerTurn: 10 });
    assert.equal(r.embedded, 0, '★0 是调用方明的下界，不是"没给"');
    assert.equal(store.calls.save, 0, '一件没嵌 ⇒ 一次盘都不写');
    assert.equal((await rt.stats({ world: worldAtSix(), floor: 0 })).pending, 0, '★统计同理：下界 0 ⇒ 不欠');
});

test('W5：★默认统计报"还欠几件"——未补前欠 3 件（不是永远报 0 的假读数），补完之后欠 0', async () => {
    const store = fakeStore();
    const rt = createEmbedRuntime({ indexStore: store, client: fakeClient(), signature: SIG, windowTurns: () => WINDOW });
    const before = await rt.stats({ world: worldAtSix() });
    assert.equal(before.pending, 3, `★窗口外三行还没嵌 ⇒ 必须报欠 3（下界 ${FLOOR}）`);
    await rt.stepForTick({ world: worldAtSix(), maxItemsPerTurn: 10 });
    const after = await rt.stats({ world: worldAtSix() });
    assert.equal(after.pending, 0, '★补完就不欠了（同一把尺数出来的，不是写死的 0）');
    assert.equal(after.count, 3);
});

test('W6：★默认召回把窗口内的排掉 —— 六行都嵌了，只回第 1 至 3 轮那三件', async () => {
    const store = fakeStore();
    const rt = createEmbedRuntime({ indexStore: store, client: fakeClient(), signature: SIG, windowTurns: () => WINDOW });
    const seed = await rt.stepForTick({ world: worldAtSix(), floor: TICK_NOW + 1, maxItemsPerTurn: 10 });
    assert.equal(seed.embedded, 6, '前提：显式下界 7（＝全账）先把六行收进索引');
    const r = await rt.recallForTick({ ssot: worldAtSix(), tickNow: TICK_NOW, queryText: '甲办过的事' });
    assert.ok(r, '★默认召回必须有东西回来（不传下界不许退化成"根本没候选"）');
    assert.equal(r.report.candidates, 3, `★候选＝窗口外那三件（下界 ${FLOOR}）`);
    assert.deepEqual(r.items.map((x) => x.tick).sort((a, b) => a - b), [1, 2, 3], '★窗口内那三行不许重复喂');
});

test('W7：显式 `floor: 0` 的召回照旧 —— 下界 0 ⇒ 没有任何一件算滑出窗口（候选 0、回 0）', async () => {
    const store = fakeStore();
    const rt = createEmbedRuntime({ indexStore: store, client: fakeClient(), signature: SIG, windowTurns: () => WINDOW });
    await rt.stepForTick({ world: worldAtSix(), floor: TICK_NOW + 1, maxItemsPerTurn: 10 });
    const r = await rt.recallForTick({ ssot: worldAtSix(), tickNow: TICK_NOW, floor: 0, queryText: '甲办过的事' });
    assert.equal(r.report.candidates, 0, '★0 这条路口径不变（要"整本账都可搜"得由调用方给真正的下界）');
    assert.equal(r.items.length, 0);
});

test('W8：★显式 `floor: null`（设置里没填）与不传同一条路 ⇒ 仍按当前轮次与窗口算', async () => {
    const store = fakeStore();
    const rt = createEmbedRuntime({ indexStore: store, client: fakeClient(), signature: SIG, windowTurns: () => WINDOW });
    const r = await rt.stepForTick({ world: worldAtSix(), floor: null, maxItemsPerTurn: 10 });
    assert.equal(r.embedded, 3, '★"空着"就是空着，不许当成第 0 轮');
    assert.equal((await rt.stats({ world: worldAtSix(), floor: undefined })).pending, 0, '★统计那条路同理（补过之后不欠）');
});
