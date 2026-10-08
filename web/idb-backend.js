// story-world-v2/web/idb-backend.js
// K35 存储层（编排层·浏览器侧）：IndexedDB 卷库适配——与 src/storage.js store 注入面同接口 {list, put, get}。
// 键设计：chatId + 卷号（每聊天独立卷库命名空间，细案 §3.1「旧卷入 IndexedDB（chatId 键）」）。
// 纪律：模块顶层零 indexedDB 访问（Node 动态导入安全），全部惰性函数内调用 + 守卫。
//
// leg27 后 · 快照容错（细案 docs/spec-snapshot-fault-tolerance.md，用户拍板「存 IndexedDB 独立库」）：
//   同一 DB 里**另开一张表** `snapshots`（与 volumes 分开的键空间，键 = `${chatId}:${snapshotId}`）。
//   为什么不放热账：热账在 `chat_metadata` 里，而 ST 保存是**整份重写聊天**（实测首行 3.1 MB）
//   ⇒ 保留 15 份 full 会把首行撑到 5.6 MB+，且每步一次 saveChat 的写放大不可接受。
import { diagnostics } from '../src/diagnostics.js';

const DB_NAME = 'story-world-v2';
const DB_VERSION = 3;                 // v1 → v2：新增 snapshots 表；★v2 → v3：新增 vectors 表（leg152，按需建，老库平滑升）
const STORE_NAME = 'volumes';
const SNAP_STORE = 'snapshots';
const VEC_STORE = 'vectors';          // ★leg152：向量索引（**只存一份整索引**，键 = `${chatId}:index`）

function idb() {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB 不可用（非浏览器宿主）');
    return indexedDB;
}

function openDb() {
    return new Promise((resolve, reject) => {
        const req = idb().open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
            // v2：快照表（老库升级时补建；已存在则不动——升级路径必须幂等）
            if (!db.objectStoreNames.contains(SNAP_STORE)) {
                db.createObjectStore(SNAP_STORE, { keyPath: 'key' });
            }
            // ★v3：向量索引表（同上：按需建、幂等）
            if (!db.objectStoreNames.contains(VEC_STORE)) {
                db.createObjectStore(VEC_STORE, { keyPath: 'key' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function txDone(db, store, mode, fn) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const s = tx.objectStore(store);
        const req = fn(s);
        tx.oncomplete = () => { db.close(); resolve(req?.result); };
        tx.onerror = () => { diagnostics.record('存储', 'error', '本地事务失败', { store, error: tx.error }); db.close(); reject(tx.error); };
        tx.onabort = () => { diagnostics.record('存储', 'error', '本地事务中止', { store, error: tx.error }); db.close(); reject(tx.error); };
    });
}

/** createIdbVolumeStore(chatId) → {list, put, get}（与 storage.js store 注入面同构） */
export function createIdbVolumeStore(chatId) {
    const ns = `${chatId}:`;
    return {
        async list() {
            const db = await openDb();
            const rows = await txDone(db, STORE_NAME, 'readonly', (s) => s.getAll());
            return (rows || [])
                .filter((r) => r && typeof r.key === 'string' && r.key.startsWith(ns))
                .map((r) => ({ id: r.id, info: r.info }));
        },
        async put(volume) {
            const db = await openDb();
            await txDone(db, STORE_NAME, 'readwrite', (s) => s.put({ key: `${ns}${volume.id}`, ...volume }));
        },
        async get(id) {
            const db = await openDb();
            const row = await txDone(db, STORE_NAME, 'readonly', (s) => s.get(`${ns}${id}`));
            return row || null;
        },
    };
}

/**
 * createIdbSnapshotStore(chatId) → {list, get, put, drop, clear}
 * 与 `src/snapshot.js` 的记录形状同构（记录里带 `key` 供 IDB 主键，读取时剥掉）。
 * 用户拍板：**IndexedDB 独立键空间** · 保留 15 步 · 只回世界账。
 * 纪律（与卷库一致）：模块顶层零 indexedDB；全部惰性 + 守卫；**读不到/写不进都只是"这次没拍上"**，
 *   绝不许让快照失败影响世界推进（编排层负责吞错，本层负责如实抛/如实返 null）。
 * ⚠ `list()` 只返回**元信息**（不含 world/delta），因为 full 一份 166 KB——列表不该把它全拖进内存；
 *   恢复/修剪要内容时用 `get(id)` / `listAll()`。
 */
export function createIdbSnapshotStore(chatId) {
    const ns = `${chatId}:`;
    const strip = (row) => { if (!row) return null; const { key, ...rest } = row; return rest; };
    return {
        async list() {
            const db = await openDb();
            const rows = await txDone(db, SNAP_STORE, 'readonly', (s) => s.getAll());
            return (rows || [])
                .filter((r) => r && typeof r.key === 'string' && r.key.startsWith(ns))
                .map((r) => strip(r))
                .sort((a, b) => Number(String(a.id).replace(/^s/, '')) - Number(String(b.id).replace(/^s/, '')));
        },
        async listAll() {
            const db = await openDb();
            const rows = await txDone(db, SNAP_STORE, 'readonly', (s) => s.getAll());
            return (rows || [])
                .filter((r) => r && typeof r.key === 'string' && r.key.startsWith(ns))
                .map((r) => strip(r));
        },
        async get(id) {
            const db = await openDb();
            return strip(await txDone(db, SNAP_STORE, 'readonly', (s) => s.get(`${ns}${id}`)));
        },
        async put(rec) {
            const db = await openDb();
            await txDone(db, SNAP_STORE, 'readwrite', (s) => s.put({ key: `${ns}${rec.id}`, ...rec }));
        },
        /** drop(ids) —— 保留窗口淘汰用；返回真正删掉的条数 */
        async drop(ids) {
            const list = (Array.isArray(ids) ? ids : []).filter(Boolean);
            if (!list.length) return 0;
            const db = await openDb();
            await txDone(db, SNAP_STORE, 'readwrite', (s) => { for (const id of list) s.delete(`${ns}${id}`); });
            return list.length;
        },
        /** clear() —— 面板「清空快照」用 */
        async clear() {
            const db = await openDb();
            const rows = await txDone(db, SNAP_STORE, 'readonly', (s) => s.getAll());
            const mine = (rows || []).filter((r) => r && typeof r.key === 'string' && r.key.startsWith(ns)).map((r) => r.key);
            if (!mine.length) return 0;
            const db2 = await openDb();
            await txDone(db2, SNAP_STORE, 'readwrite', (s) => { for (const k of mine) s.delete(k); });
            return mine.length;
        },
    };
}

/**
 * ★★★leg161：`createIdbVectorStore(chatId)` → `{load, save, drop}`——**向量索引**的本地存储。
 *
 * 【它的来路（一段历史，别只读一半）】
 *   · leg152 立（向量记忆层）⇒ leg156 用户令「稳定版不带没验过的功能」**整族撤走**（连带本函数）；
 *   · ★★★leg161 **接回来**：用户 2026-10-01 定案「**向量记忆就是rp内标准的解决失忆方案**」
 *     ＋「**那就让聊天侧也接上向量检索呗**」⇒ 聊天侧那一段要用它。
 *   ★撤走时**特意留下**的两样，正是为今天这一步铺的路（下面那段"不许退"的理由照旧管用）。
 *
 * 【为什么它必须单独一张表、而不能塞进热账】
 *   热账在 `chat_metadata` 里，而 ST 保存是**整份重写聊天**（本文件顶上那笔账：实测首行 3.1 MB）。
 *   索引随账一起长（一件事一条向量）⇒ 塞进去就是每步一次"整份重写"的写放大。
 *   ⇒ **住 IndexedDB、按聊天分键**；★**它丢了账照样答**（退回关键词那条糙路）——
 *     这条纪律决定了本层**只做存储、不做判断**：形状对不对、要不要重嵌，全归 `src/vector-store.js`。
 *
 * 【分工】
 *   · `src/vector-store.js`：形状 / 编解码 / 合并 / 何时写盘（纯函数，Node 里可穷举真跑）；
 *   · **本函数**：把那份形状放进 IDB、再原样取回来（**一个字节都不改**）。
 */
export function createIdbVectorStore(chatId) {
    const key = `${chatId}:index`;
    return {
        /** @returns {Promise<object|null>} 没有就 null（**不抛**：没有索引是正常状态） */
        async load() {
            const db = await openDb();
            const row = await txDone(db, VEC_STORE, 'readonly', (s) => s.get(key));
            if (!row || !row.payload) return null;
            try { return JSON.parse(row.payload); } catch { return null; }   // 坏掉 ⇒ 当没有（绝不半读）
        },
        /** @param {object} indexJson `encodeStore()` 的产物（或任何可 JSON 化的形状） */
        async save(indexJson) {
            const db = await openDb();
            await txDone(db, VEC_STORE, 'readwrite', (s) => s.put({ key, savedAt: new Date().toISOString(), payload: JSON.stringify(indexJson) }));
        },
        /** 面板「清掉索引」/ 换模型重嵌 用 */
        async drop() {
            const db = await openDb();
            await txDone(db, VEC_STORE, 'readwrite', (s) => s.delete(key));
        },
    };
}

//   ★★**上面那两个常量不许退**：`DB_VERSION` 保持 **3**、`vectors` 表照旧按需建。
//     为什么（这条要紧，别照"清理干净"的直觉去动它）：
//       IndexedDB **不许降级**——库一旦是 3，再拿 2 去开就会当场报
//       「The requested version (2) is less than the existing version (3)」、整条存储路不可读。
//       而**已经跑过开发版的浏览器，库就是 3**（测过：当面复现过那句报错）。
//     ⇒ 退版本号＝把那些人重新锁死一次。留着 3 只多一张空表（零读写、零开销）。
