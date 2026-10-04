// leg151 · 运行时 × 编年单元 的集成判据：真跑一遍 createEmbedRuntime（存储 ＋ 编排 ＋ 单元）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmbedRuntime } from '../web/embed-runtime.js';

const SIG = { model: 'qwen-x', dims: 2 };
function fakeStore() {
    let disk = null; const calls = { save: 0, load: 0 };
    return { calls, disk: () => disk, async load() { calls.load += 1; return disk; }, async save(j) { calls.save += 1; disk = JSON.parse(JSON.stringify(j)); }, async drop() { disk = null; } };
}
const world = () => ({
    entities: [{ id: 'e1', name: '薛铁衣' }],
    events: [{ id: 'ev_1_1', title: '北山灵脉异动', source: { type: 'state' }, position: '北山', ripples: ['e1'], tick: 1 }],
    chronicle: [
        { id: 'ch_1_ev_1', tick: 1, text: '事件「北山灵脉异动」——由世界处境而生，事发 北山', kind: 'state', eventRef: 'ev_1_1' },
        { id: 'ch_1_ag_1', tick: 1, text: '因事而生：薛铁衣 由「北山灵脉异动」生「剿灭北山残部」', kind: 'scheme' },
    ],
    agendas: [], meta: { tick: 100 },
});

test('R6：★真跑一遍运行时 ⇒ 收的是编年行、落盘一次、第二条命不重嵌', async () => {
    const store = fakeStore();
    const seen = [];
    const client = { embed: async (texts) => { seen.push(...texts); return texts.map(() => [1, 0]); } };
    const rt = createEmbedRuntime({ indexStore: store, client: () => client, signature: SIG });
    const r1 = await rt.stepForTick({ world: world(), floor: 60, maxItemsPerTurn: 10, windowTurns: 50 });
    assert.equal(r1.unit, 'chronicle', '★单元＝编年行');
    assert.equal(r1.embedded, 2, '两行都滑出窗口（窗口下界 60）');
    assert.equal(store.calls.save, 1, '★真嵌了才写一次盘');
    assert.ok(seen.some((t) => t.includes('薛铁衣 由')), `★"他做过什么"那一行必须真被嵌：${JSON.stringify(seen)}`);
    // 第二条命：同一个盘
    const rt2 = createEmbedRuntime({ indexStore: store, client: () => client, signature: SIG });
    const r2 = await rt2.stepForTick({ world: world(), floor: 60, maxItemsPerTurn: 10, windowTurns: 50 });
    assert.equal(r2.embedded, 0, '★一件都不重嵌');
    assert.equal(store.calls.save, 1, '★没有新东西 ⇒ 一次盘都不写');
    const s = await rt2.stats();
    assert.equal(s.count, 2);
    const s2 = await rt2.stats({ world: world(), floor: 60 });
    assert.equal(s2.pending, 0, '★"还欠几件"是真数出来的');
});

test('R7：★窗口内的编年一行都不嵌（那是「纪事」的活儿）', async () => {
    const store = fakeStore();
    const rt = createEmbedRuntime({ indexStore: store, client: () => ({ embed: async (t) => t.map(() => [1, 0]) }), signature: SIG });
    const r = await rt.stepForTick({ world: world(), floor: 0, maxItemsPerTurn: 10, windowTurns: 50 });
    assert.equal(r.embedded, 0, '下界 0 ⇒ 全在窗口内');
    assert.equal(store.calls.save, 0, '★一件没嵌 ⇒ 不许写盘');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// ★★★leg152：**覆盖面 ＝ 卷里的行有没有进来**（真账实测剥出来的承重条件）
//   实测（真账 tick 59）：东海龙宫 / 薛铁衣 / 黄坤 这三个实体，向量与"按名字包含"基线**都是 0/6**——
//   不是方法不行，是**它们的事已经轮转进卷了**，而索引只看得见热账那一截。
//   ⇒ 这一条是**承重条件**，不是优化项：索引看不见卷 = 旧事整批失踪。
//   ★而 `volumes` 是**逐层传下去的**（接线那一步漏一个参数，症状是"沉默地少收一大段"）。
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
test('R8：★★把卷里的行喂进去 ⇒ 它们**真进索引**（漏了它就等于旧事整批失踪）', async () => {
    const store = fakeStore();
    const seen = [];
    const rt = createEmbedRuntime({ indexStore: store, client: () => ({ embed: async (t) => { seen.push(...t); return t.map(() => [1, 0]); } }), signature: SIG });
    const w = { entities: [], events: [], chronicle: [{ id: 'ch_95_1', tick: 95, text: '热账那一行', kind: 'major' }], agendas: [], meta: { tick: 100 } };
    const volumes = [
        { id: 'v1', rows: [{ id: 'ch_10_1', tick: 10, text: '卷甲里的一行', kind: 'scheme' }, { id: 'ch_20_1', tick: 20, text: '卷甲里的又一行', kind: 'scheme' }] },
        { id: 'v2', rows: [{ id: 'ch_5_1', tick: 5, text: '卷乙里的一行', kind: 'major' }] },
    ];
    const r = await rt.stepForTick({ world: w, floor: 60, volumes, maxItemsPerTurn: 10, windowTurns: 50 });
    assert.equal(r.embedded, 3, `★三行卷里的行都该滑出窗口：${JSON.stringify(r)}`);
    assert.ok(seen.some((t) => t.includes('卷甲里的一行')) && seen.some((t) => t.includes('卷乙里的一行')), `★卷里的行必须真被嵌：${JSON.stringify(seen)}`);
    // ★反证：**不传卷** ⇒ 只有热账那 0 行（第 95 轮还在窗口内）⇒ 索引少收一大段（正是实测那个 0/6 的成因）
    const store2 = fakeStore();
    const rt2 = createEmbedRuntime({ indexStore: store2, client: () => ({ embed: async (t) => t.map(() => [1, 0]) }), signature: SIG });
    const r2 = await rt2.stepForTick({ world: w, floor: 60, maxItemsPerTurn: 10, windowTurns: 50 });
    assert.equal(r2.embedded, 0, '★不带卷 ⇒ 一件都收不到（症状：静默地少收一整段）');
});
