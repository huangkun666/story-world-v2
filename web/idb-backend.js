// story-world-v2/web/idb-backend.js
// K35 存储层（编排层·浏览器侧）：IndexedDB 卷库适配——与 src/storage.js store 注入面同接口 {list, put, get}。
// 键设计：chatId + 卷号（每聊天独立卷库命名空间，细案 §3.1「旧卷入 IndexedDB（chatId 键）」）。
// 纪律：模块顶层零 indexedDB 访问（Node 动态导入安全），全部惰性函数内调用 + 守卫。
const DB_NAME = 'story-world-v2';
const DB_VERSION = 1;
const STORE_NAME = 'volumes';

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