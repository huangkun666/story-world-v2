// story-world-v2/test/vector-index-persist.test.js
// ★★★leg152：**向量索引真的存得进去、取得回来**（细案 §6②：索引只能是加速层）。
//
// ★为什么这一条不能只靠 `vector-store.test.js`：那一份测的是**形状与编解码**（纯函数），
//   而"**存进去之后下一条命还在不在**"是**存储层**的事——它一旦坏了，症状是
//   **每轮重嵌一遍**（安静地烧钱），而不是任何一条判据变红。
//
// ★做法照 `test/snapshot-chain-anchor.test.js` 的老规矩：**假 IndexedDB ＋ 真适配器**
//   （`createIdbVectorStore` 只碰 `indexedDB` 这一个全局 ⇒ 在 Node 里补上它就能让真实现跑起来）。
//   ★不为"可测"去改生产形状——改了形状，判据就咬不到真东西了。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdbVectorStore } from '../web/idb-backend.js';
import { harnessOf, decodeStore, encodeStore, embeddedIdsOf } from '../src/vector-store.js';

/** 假 IndexedDB：只实现这个适配器真正用到的那一面（事务完成走 queueMicrotask）。 */
function installFakeIdb() {
    const dbs = new Map();
    const opened = new Set();
    const makeDb = () => {
        const stores = new Map();
        return {
            objectStoreNames: { contains: (n) => stores.has(n) },
            createObjectStore: (n) => { stores.set(n, new Map()); },
            transaction(storeName) {
                const rows = stores.get(storeName);
                if (!rows) throw new Error(`假 IDB：没有这张表 ${storeName}`);
                const tx = { error: null };
                tx.objectStore = () => ({
                    get: (k) => { const r = { result: rows.get(k) }; queueMicrotask(() => tx.oncomplete?.()); return r; },
                    put: (rec) => { rows.set(rec.key, rec); const r = { result: rec.key }; queueMicrotask(() => tx.oncomplete?.()); return r; },
                    delete: (k) => { rows.delete(k); const r = { result: undefined }; queueMicrotask(() => tx.oncomplete?.()); return r; },
                    getAll: () => { const r = { result: [...rows.values()] }; queueMicrotask(() => tx.oncomplete?.()); return r; },
                });
                return tx;
            },
            close() {},
        };
    };
    globalThis.indexedDB = {
        open(name) {
            if (!dbs.has(name)) dbs.set(name, makeDb());
            const req = { result: dbs.get(name), error: null };
            const fresh = !opened.has(name);
            opened.add(name);
            queueMicrotask(() => { if (fresh) req.onupgradeneeded?.(); req.onsuccess?.(); });
            return req;
        },
    };
    return () => { delete globalThis.indexedDB; };
}

const SIG = { model: 'qwen-x', dims: 3 };

test('P1：★存进去 → 换一条命读回来 ⇒ **已嵌集合一件不少**（少了就是重嵌＝烧钱）', async () => {
    const uninstall = installFakeIdb();
    try {
        const va = createIdbVectorStore('聊天甲');
        // 第一条命：嵌三件、落盘
        const h1 = harnessOf(SIG);
        h1.putMany([{ id: 'ev_1_1', tick: 1, text: '甲' }, { id: 'ev_2_1', tick: 2, text: '乙' }, { id: 'ev_3_1', tick: 3, text: '丙' }], [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
        assert.equal(h1.persist(), true);
        await va.save(encodeStore(h1.store()));

        // 第二条命：读回来 ⇒ 用**同一套**编解码 ⇒ 已嵌集合必须逐条相同
        const raw = await va.load();
        const restored = decodeStore(raw, SIG);
        assert.deepEqual(embeddedIdsOf(restored), ['ev_1_1', 'ev_2_1', 'ev_3_1']);
        assert.deepEqual(restored.tickByIndex, [1, 2, 3]);
        assert.deepEqual(restored.vecs, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], '★向量逐位相同（浮点不许被存储改形）');
        // 换一个 harness 接着用（模拟重开面板）⇒ 上一批不再重嵌
        const h2 = harnessOf(SIG, { stored: JSON.stringify(raw) });
        const again = h2.putMany([{ id: 'ev_1_1', tick: 1, text: '甲（又来）' }], [[9, 9, 9]]);
        assert.equal(again, 0, '★已经嵌过的一件都不许再写（更不许被覆盖成另一条向量）');
    } finally { uninstall(); }
});

test('P2：★没索引 ⇒ `load()` 返 null（**不抛**：没有索引是正常状态，降级不是崩）', async () => {
    const uninstall = installFakeIdb();
    try {
        const v = createIdbVectorStore('聊天乙');
        assert.equal(await v.load(), null);
        // 坏数据 ⇒ 也当"没有"（绝不半读一份坏索引）
        await v.save({ 这是一份: '坏掉的形状' });
        const raw = await v.load();
        assert.deepEqual(decodeStore(raw, SIG).ids, [], '★形状不对 ⇒ 空索引（由 vector-store 判定，不在存储层猜）');
    } finally { uninstall(); }
});

test('P3：★按聊天分键：另一个聊天读不到我的索引（换聊天不串味）', async () => {
    const uninstall = installFakeIdb();
    try {
        const a = createIdbVectorStore('聊天甲');
        const b = createIdbVectorStore('聊天乙');
        const h = harnessOf(SIG);
        h.putMany([{ id: 'ev_1_1', tick: 1, text: '甲' }], [[1, 0, 0]]);
        await a.save(encodeStore(h.store()));
        assert.equal(embeddedIdsOf(decodeStore(await a.load(), SIG)).length, 1);
        assert.equal(await b.load(), null, '★另一个聊天必须看不到它');
    } finally { uninstall(); }
});

test('P4：drop() ⇒ 索引没了（换模型重嵌那条路）', async () => {
    const uninstall = installFakeIdb();
    try {
        const v = createIdbVectorStore('聊天丙');
        const h = harnessOf(SIG);
        h.putMany([{ id: 'ev_1_1', tick: 1, text: '甲' }], [[1, 0, 0]]);
        await v.save(encodeStore(h.store()));
        assert.ok(await v.load());
        await v.drop();
        assert.equal(await v.load(), null, '★删掉了就是没有（下一次会从零开始重嵌——这是**用户主动**的动作）');
    } finally { uninstall(); }
});
