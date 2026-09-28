// story-world-v2/test/snapshot-chain-anchor.test.js
// ★★★本笔修的**真 bug**（藏了九天）：**回档那条链是坏的**——接线层把"锚点世界"记成了"当前世界"。
//
// ── 病（`web/snapshot-store.js` 里 `requestSnapshot` 那行）─────────────────────
//   `planStep` 的返回值里**本来就有** `anchorWorld`（delta 时它 = **上一个锚点世界**），
//   它的不变量在 `src/snapshot.js:284-291` 写得明明白白：
//     **「delta 必须相对锚点世界算，不能相对上一步世界算」**。
//   而接线层写成了 `anchorWorld: snapshot`（当前世界）⇒ 从**第 3 步**起：
//   差值是"上一步→这一步"，却仍挂着**原来的锚** ⇒ 恢复 = 锚 ＋ 错的差。
//   两种症状（都复现过）：① 错的差碰到基准里没有的路径 ⇒ 报「快照链不自洽」；
//   ② ★没碰到 ⇒ **恢复"成功"但世界少一整块**，面板照样印「已落盘」——退回一个没存在过的世界。
//
// ── 为什么九天没人发现（本文件存在的全部理由）────────────────────────────────
//   `test/snapshot.test.js` 与 `demo/measure-snapshot-cost.js` 都写 `anchorWorld = p.anchorWorld`
//   ——**判据用的是对的那个值** ⇒ 判据全绿，而它量的**不是生产那条接线**。
//   ⇒ 本文件**不许**只测 `planStep`（那正是 bug 藏身之处）：必须**打真接线**——
//     装一个真 hub、连拍三份、再**逐份恢复**，逐字节比对"恢复出来的世界 = 当时那个世界"。
//
// ── 判据形态（照 `test/snapshot-restore-migration.test.js` 那把"真调一次"的尺）──────
//   ★假 IndexedDB + **真** hub：`createIdbSnapshotStore` 只碰 `indexedDB` 这一个全局，
//     在 Node 里补上它就能让**真实现**跑起来（不为"可测"去改生产形状——改了形状判据就咬不到真东西了）。
//   ★取证面是 `restoreSnapshot` 的**写回实参**（`sw2WriteHotMetaEnsuringParams(meta, world)`），
//     不是它的返回值：返回值里只有 `{ ok, tick, plan, flushed }`，**世界不在里面**。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffWorld, applyDelta } from '../src/snapshot.js';
import { hotAccountShape, loadHotAccount } from '../src/storage.js';
import { createSnapshotHub } from '../web/snapshot-store.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// 一、假 IndexedDB（够用到"真的走完一遍 createIdbSnapshotStore"）
//   只实现 `web/idb-backend.js` 真正用到的那一面：open / createObjectStore / transaction /
//   objectStore / getAll / get / put / delete。★事务完成走 `queueMicrotask`（真 IDB 是异步的）。
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
                    getAll: () => { const r = { result: [...rows.values()] }; queueMicrotask(() => tx.oncomplete?.()); return r; },
                    get: (k) => { const r = { result: rows.get(k) }; queueMicrotask(() => tx.oncomplete?.()); return r; },
                    put: (rec) => { rows.set(rec.key, rec); const r = { result: rec.key }; queueMicrotask(() => tx.oncomplete?.()); return r; },
                    delete: (k) => { rows.delete(k); const r = { result: undefined }; queueMicrotask(() => tx.oncomplete?.()); return r; },
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

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// 二、世界夹具：**三步各改不同的键**（这是本判据能咬住那个 bug 的关键）
//   ★为什么必须"各改不同的键"：错基准下 `恢复(s3) = W1 ＋ (W2→W3)` ⇒
//     **W1→W2 那一步的改动整批丢失**。若三步改的是同一批键，错的那条链也会碰巧算出对的结果
//     ⇒ 判据变成假绿。所以：第 2 步只改 `weights`，第 3 步只改事件标题与张力，**互不重叠**。
const CHAT = '夹具聊天';
const stepWorld = ({ tick, weight, title, intensity }) => ({
    version: 1,
    context: {
        world: '测试界',
        positions: ['甲地', '乙地'],
        setting: {
            frozen: { fingerprint: 'fnv1a_t', extractedAt: 'T', canon: { rules: ['甲律：检定取整'], bookEntities: [{ name: '角色1', kind: 'character' }] } },
            dynamic: { tension: { polarity: '未聚', direction: '', intensity }, env: {}, derivedFrom: [] },
        },
    },
    entities: [
        { id: 'e_bk_1', name: '角色1', kind: 'character' },
        { id: 'e_bk_2', name: '角色2', kind: 'character' },
    ],
    weights: { e_bk_1: weight, e_bk_2: 0.2 },
    agendas: [],
    events: [{ id: 'ev_1', title, source: { type: 'state' }, position: '甲地', ripples: ['e_bk_1'], closed: false }],
    chronicle: [{ id: 'ch_1', tick, text: '一句话', kind: 'state' }],
    milestones: [],
    meta: { tick, simLog: [] },
});

const W1 = stepWorld({ tick: 1, weight: 0.10, title: '事一', intensity: 0.50 });
const W2 = stepWorld({ tick: 2, weight: 0.30, title: '事一', intensity: 0.50 });   // ← 只改 weights
const W3 = stepWorld({ tick: 3, weight: 0.30, title: '事三', intensity: 0.70 });   // ← 只改标题与张力（不再碰 weights）
const STEPS = [W1, W2, W3];

/** 搭一个**真的** hub（假 IDB + 假接线层依赖），连拍三份，再逐份恢复。 */
async function runChain() {
    const uninstall = installFakeIdb();
    try {
        const written = { world: null, count: 0 };
        const hub = createSnapshotHub({
            freshCtx: () => ({ chatId: CHAT, saveSettingsDebounced() {} }),
            setStatus: () => {},
            refreshWorld: () => {},
            loadHotAccount,
            readHotMeta: () => null,          // ★刻意为 null：本次不测"恢复前自保"那条支路（另有用例锁它）
            hotAccountShape,
            sw2WriteHotMetaEnsuringParams: (meta, world) => { written.world = world; written.count += 1; },
            flushHotMeta: async () => ({ ok: true }),
            getLastWorld: () => null,
            setLastWorld: () => {},
            getListedVolumes: () => [],
        });
        // ① 连拍三份（每一步都**真的**走完那条写队列——本笔给 `requestSnapshot` 加了返回队列）
        for (const [i, w] of STEPS.entries()) await hub.requestSnapshot(clone(w), `第${i + 1}步`);
        const store = hub.snapshotStore(() => ({ chatId: CHAT }));
        const metas = await store.list();
        // ② 逐份恢复：每次恢复都把"写回盘上的那一份"接住
        const restored = [];
        for (const m of metas) {
            written.world = null;
            const before = written.count;
            const r = await hub.restoreSnapshot(m.id);
            restored.push({ id: m.id, kind: m.kind, ok: r.ok, error: r.error, world: written.world, count: written.count - before });
        }
        return { metas, restored };
    } finally { uninstall(); }
}

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// 三、★★★行为判据：真接线，连拍三份，逐份恢复必须逐字节对得上

test('★★★快照链：连拍三份后**每一份都能恢复成当时那个世界**（差必须相对锚点算）', async () => {
    const { metas, restored } = await runChain();

    // ① 前置自证：链真的拍成了三份，而且**真的用了 delta**（否则"锚点记错"这件事根本无从发生）
    assert.equal(metas.length, 3, `★前置：必须真拍下三份（实测 ${JSON.stringify(metas.map((m) => m.id + ':' + m.kind))}）`);
    assert.deepEqual(metas.map((m) => m.id), ['s1', 's2', 's3'], '序号连续（链头 s1）');
    assert.equal(metas[0].kind, 'full', '第一份是 full（链头·锚）');
    assert.equal(metas.filter((m) => m.kind === 'delta').length, 2,
        '★★前置：第 2、3 份必须是 **delta** —— 本判据要咬的正是"delta 相对谁算"，全是 full 就测不到');

    // ② 前置自证：三步世界**两两不同**（否则"恢复对了"可能只是三份本来就一样）
    assert.notEqual(JSON.stringify(W1), JSON.stringify(W2), '★夹具自证：第 1→2 步真的变了');
    assert.notEqual(JSON.stringify(W2), JSON.stringify(W3), '★夹具自证：第 2→3 步真的变了');
    assert.notEqual(JSON.stringify(W1), JSON.stringify(W3), '★夹具自证：第 1→3 步真的变了');

    // ③ ★★★本判据要咬的那一条：逐份恢复 = 当时那个世界（逐字节）
    for (const [i, r] of restored.entries()) {
        assert.equal(r.ok, true, `★前置：${r.id} 必须能恢复（实测 ${r.error || 'ok'}）`);
        assert.equal(r.count, 1, `★前置：${r.id} 恢复时写回面必须恰好被调一次`);
        assert.equal(JSON.stringify(r.world), JSON.stringify(STEPS[i]),
            `★★★${r.id}（${r.kind}）恢复出来的世界必须与第 ${i + 1} 步**逐字节相等** —— `
            + '不等就是"差相对错的基准算了"（用户看到的是「快照链不自洽」或者世界少一块）');
    }
});

test('★★反向自证：把"锚点记成当前世界"那条错链手动算一遍 ⇒ 第 3 份**必须**对不上（否则上一条是假绿）', () => {
    // 错链：第 3 步的差是"第 2 步→第 3 步"，却挂在**第 1 步**那个锚上 ⇒ 恢复 = W1 ＋ (W2→W3)
    const wrongDelta = diffWorld(W2, W3).delta;
    const buggy = applyDelta(clone(W1), wrongDelta);
    assert.notEqual(JSON.stringify(buggy), JSON.stringify(W3),
        '★★反向自证：错基准算出来的那份**必须**不等于 W3（第 1→2 步那批改动整批丢了）');
    assert.equal(buggy.weights.e_bk_1, W1.weights.e_bk_1,
        `★★这就是丢的那一块：权重停在 W1 的 ${W1.weights.e_bk_1}（本应是 ${W3.weights.e_bk_1}）`);
    // 对照：对的那条链（差相对锚点 W1 算）必须逐字节等于 W3
    const rightDelta = diffWorld(W1, W3).delta;
    assert.equal(JSON.stringify(applyDelta(clone(W1), rightDelta)), JSON.stringify(W3),
        '★对照：差相对**锚点**算 ⇒ 恢复出来就是 W3（本笔修的就是把生产接线改成这一条）');
    // ★反向自证之二：三步"各改不同的键"这个夹具前提必须成立（改同一批键 ⇒ 错链也会碰巧算对）
    assert.notEqual(JSON.stringify(diffWorld(W1, W2).delta), JSON.stringify(diffWorld(W2, W3).delta),
        '★夹具自证：第 1→2 步与第 2→3 步改的**不是同一批键**（否则错基准会碰巧算出对的结果）');
});
