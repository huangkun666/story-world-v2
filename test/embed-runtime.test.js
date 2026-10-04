// story-world-v2/test/embed-runtime.test.js
// ★★★leg152：**向量那一层的运行时**（引擎判断 ↔ 浏览器存储 之间的那条线）。
//
// ★这一族咬的是**会花钱的那三件事**（都在别处发生过）：
//   ① **写盘次数**：写一次是整份序列化 ⇒ 只在真变了的时候写（`persist()` 为真才算）；
//   ② **不重复嵌**：第二条命（重开面板）读回索引 ⇒ 上一批**一件都不许重嵌**；
//   ③ **形状对不上从头来**：换模型号 ⇒ 老向量一律不认（"凑合读"会安静地给假相似度）；
//   ④ **绝不抛**：存储坏了、通道坏了 ⇒ 都只报一句（加速层不许影响世界）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmbedRuntime } from '../web/embed-runtime.js';

const SIG = { model: 'qwen-x', dims: 2 };

/** 假存储（与 `createIdbVectorStore` 同接口）：内存里一根字符串。 */
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

/** 一份小账：五件事；窗口下界由测试给。 */
function makeWorld() {
    return {
        entities: [{ id: 'e1', name: '甲' }],
        events: [1, 2, 3, 4, 5].map((t) => ({ id: `ev_${t}_1`, title: `第${t}件事`, source: { type: 'state' }, position: '某地', ripples: ['e1'], tick: t, closed: true })),
        chronicle: [], agendas: [], meta: { tick: 10 },
    };
}
const client = (n = 0) => ({ embed: async (texts) => { void n; return texts.map((_, i) => [1, i]); } });

test('R1：★一轮补嵌 ⇒ 真写了一次盘；**再跑一轮同一份账 ⇒ 一次都不写**（没变化就不写）', async () => {
    const store = fakeStore();
    const rt = createEmbedRuntime({ indexStore: store, client: client(), signature: SIG });
    const w = makeWorld();
    const r1 = await rt.stepForTick({ world: w, floor: 6, maxItemsPerTurn: 2, timeMarkOf: () => '' });
    assert.equal(r1.embedded, 2);
    assert.equal(store.calls.save, 1, '★真嵌了才写盘');
    assert.equal(rt.writes(), 1);
    // 第二轮：同一份账、同一批已经嵌过 ⇒ 没有新东西 ⇒ **不许写盘**
    const r2 = await rt.stepForTick({ world: w, floor: 6, maxItemsPerTurn: 2, timeMarkOf: () => '' });
    assert.equal(r2.embedded, 2, '第二批还有两件（第 3、2 轮）');
    assert.equal(store.calls.save, 2, '★又真嵌了两件 ⇒ 再写一次');
    const r3 = await rt.stepForTick({ world: w, floor: 6, maxItemsPerTurn: 2, timeMarkOf: () => '' });
    assert.equal(r3.embedded, 1, '最后一件');
    const before = store.calls.save;
    const r4 = await rt.stepForTick({ world: w, floor: 6, maxItemsPerTurn: 2, timeMarkOf: () => '' });
    assert.equal(r4.embedded, 0, '★都嵌过了');
    assert.equal(store.calls.save, before, '★★没有新东西 ⇒ **一次盘都不写**（这条就是省钱的闸）');
});

test('R2：★第二条命（重开面板）读回索引 ⇒ 上一批**一件都不重嵌**（水位线跟着索引走）', async () => {
    const store = fakeStore();
    const w = makeWorld();
    const rt1 = createEmbedRuntime({ indexStore: store, client: client(), signature: SIG });
    await rt1.stepForTick({ world: w, floor: 6, maxItemsPerTurn: 3, timeMarkOf: () => '' });
    const savedIds = (await rt1.stats()).count;
    assert.equal(savedIds, 3);
    // ★换一条命：新运行时、同一个盘
    const rt2 = createEmbedRuntime({ indexStore: store, client: client(), signature: SIG });
    const r = await rt2.stepForTick({ world: w, floor: 6, maxItemsPerTurn: 10, timeMarkOf: () => '' });
    assert.equal(r.embedded, 2, '只剩第 1、2 轮那两件没嵌（不是 5 件全重来）');
    assert.equal(r.pending, 0);
});

test('R3：★换模型号 ⇒ 老向量一律不认（从头嵌一遍：形状对不上就是没有）', async () => {
    const store = fakeStore();
    const w = makeWorld();
    const rt1 = createEmbedRuntime({ indexStore: store, client: client(), signature: { model: 'qwen-x', dims: 2 } });
    await rt1.stepForTick({ world: w, floor: 6, maxItemsPerTurn: 5, timeMarkOf: () => '' });
    assert.equal((await rt1.stats()).count, 5);
    // 换模型 ⇒ 读回来是空索引 ⇒ 这一轮会把 5 件重新嵌（**这是对的**）
    const rt2 = createEmbedRuntime({ indexStore: store, client: client(), signature: { model: 'qwen-y', dims: 2 } });
    const r = await rt2.stepForTick({ world: w, floor: 6, maxItemsPerTurn: 5, timeMarkOf: () => '' });
    assert.equal(r.embedded, 5, '★换模型 ⇒ 全部重嵌（向量错模型就是垃圾）');
});

test('R4：★存储坏了/通道坏了 ⇒ 一律**不抛**，只报一句（世界优先）', async () => {
    const statuses = [];
    const badStore = { load: async () => { throw new Error('IDB 打不开'); }, save: async () => { throw new Error('IDB 写不进'); }, drop: async () => {} };
    const rt = createEmbedRuntime({ indexStore: badStore, client: client(), signature: SIG, onStatus: (m) => statuses.push(String(m)) });
    const r = await rt.stepForTick({ world: makeWorld(), floor: 6, maxItemsPerTurn: 2, timeMarkOf: () => '' });
    assert.ok(r && typeof r === 'object', '★必须返回值（不抛）');
    assert.equal(r.blockedWorld, false);
    assert.match(statuses.join(''), /读向量索引失败/, `读失败要出声：${statuses.join(' | ')}`);
    // 写不进去也要出声，但**不许改回执**
    assert.match(statuses.join(''), /写不进去/, `写失败要出声：${statuses.join(' | ')}`);
    // 通道整个抛 ⇒ 也不抛出去
    const rt2 = createEmbedRuntime({
        indexStore: fakeStore(),
        client: { embed: async () => { throw new Error('通道炸了'); } },
        signature: SIG,
        onStatus: (m) => statuses.push(String(m)),
    });
    const r2 = await rt2.stepForTick({ world: makeWorld(), floor: 6, maxItemsPerTurn: 2, timeMarkOf: () => '' });
    assert.equal(r2.embedded, 0);
    assert.equal(r2.blockedWorld, false);
});

test('R5：读数：件数/维度/上一轮补了几件（设置页那一行用它）', async () => {
    const store = fakeStore();
    const rt = createEmbedRuntime({ indexStore: store, client: client(), signature: SIG });
    assert.deepEqual((await rt.stats({ enabled: false })).enabled, false);
    let s = await rt.stats();
    assert.equal(s.count, 0);
    assert.equal(s.model, 'qwen-x');
    await rt.stepForTick({ world: makeWorld(), floor: 6, maxItemsPerTurn: 2, timeMarkOf: () => '' });
    s = await rt.stats();
    assert.equal(s.count, 2);
    assert.equal(s.lastEmbedded, 2);
    assert.equal(s.dims, 2);
    // 清索引（换模型那条路）
    await rt.reset();
    assert.equal((await rt.stats()).count, 0);
    assert.equal(store.calls.drop, 1);
});
