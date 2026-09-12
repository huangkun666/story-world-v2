// story-world-v2/web/idb-backend.js
// K35 存储层（编排层·浏览器侧）：IndexedDB 卷库适配——与 src/storage.js store 注入面同接口 {list, put, get}。
// 键设计：chatId + 卷号（每聊天独立卷库命名空间，细案 §3.1「旧卷入 IndexedDB（chatId 键）」）。
// 纪律：模块顶层零 indexedDB 访问（Node 动态导入安全），全部惰性函数内调用 + 守卫。
//
// leg27 后 · 快照容错（细案 docs/spec-snapshot-fault-tolerance.md，用户拍板「存 IndexedDB 独立库」）：
//   同一 DB 里**另开一张表** `snapshots`（与 volumes 分开的键空间，键 = `${chatId}:${snapshotId}`）。
//   为什么不放热账：热账在 `chat_metadata` 里，而 ST 保存是**整份重写聊天**（实测首行 3.1 MB）
//   ⇒ 保留 15 份 full 会把首行撑到 5.6 MB+，且每步一次 saveChat 的写放大不可接受。
const DB_NAME = 'story-world-v2';
const DB_VERSION = 2;                 // v1 → v2：新增 snapshots 表（onupgradeneeded 里按需建，老库平滑升）
const STORE_NAME = 'volumes';
const SNAP_STORE = 'snapshots';

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
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error); };
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