// story-world-v2/src/fingerprint.js
// 书指纹缓存（K26/设定大势层，细案 §3.2③ + 附录 A → A-3）：v1 算法原样搬（director.js bookFingerprint / adapter.js abstractCache）。
//   书指纹 = FNV-1a 32 位（offset 0x811c9dc5、prime 0x01000193、Math.imul、>>>0）+ 长度混入——书文本一变指纹即变；
//   缓存 = LRU 有界（按 extractedAt 串序淘汰）+ 版本戳防形状演进——同指纹命中 = 零抽取调用（A-3）；
//   深拷贝保护：命中返回拷贝，缓存本体不被下游改动（v1 同款）。
// force 重抽（玩家主动「重新抽象」）= 调用方行为：set 总是覆盖同指纹条目，冲掉旧产物即可。

export const FNV1A_OFFSET = 0x811c9dc5;
export const FNV1A_PRIME = 0x01000193;
export const CACHE_VERSION = 3;        // 缓存形状版本戳（形状演进时 +1，旧条目自动失效）
                                     // v1→v2（K31）：缓存值由 canon 五件套扩展为 {canon, tension, env}
                                     //   ——同指纹命中需还原 dynamic 初值（张力/环境量），只存五件套会在
                                     //   命中路径丢初值；v2 无持久化缓存，版本抬升零迁移成本。
                                     // v2→v3（leg141）：**canon 多了 `relations` 这一格**（书里的关系网，
                                     //   用户令「把抽象阶段的关系网抽象做出来」）⇒ 旧缓存条目里**没有这一项**。
                                     //   ★★为什么非抬不可（这是本笔最容易漏掉的一环，如实留档）：
                                     //     **缓存键只有"书文本指纹"**（`bookFingerprint` 只吃书文），
                                     //     **提示词改了它不知道** ⇒ 不抬这一格，老世界再点「初始化」会**命中旧缓存**、
                                     //     拿着"没有关系网"的那份 canon 直接返回，**新提示词一次都不会被行使**
                                     //     （而那看起来完全正常：ok=true、cached=true、账照建）。
                                     //   ★代价如实说：抬了之后**所有世界的旧缓存全部失效** ⇒ 下一次抽取
                                     //     是一次**真调用**（大书 20–30 分钟真钱）。这钱本来就得花——
                                     //     不花就永远拿不到关系网。
export const CACHE_MAX = 5;            // LRU 上限（v1 原值；多书共存有界）

export function bookFingerprint(text) {
    let h = FNV1A_OFFSET;
    for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, FNV1A_PRIME) >>> 0; }
    return `fnv1a_${h.toString(36)}_${text.length.toString(36)}`;
}

export function createCache(initialStore = {}) {
    const store = { ...initialStore };   // 可播种（测试注入/版本迁移）；不染外来对象
    return {
        get(fingerprint) {
            const entry = store[fingerprint];
            if (!entry || entry.cacheVersion !== CACHE_VERSION) return null;
            return JSON.parse(JSON.stringify(entry));   // 深拷贝：保护缓存本体（v1 同款）
        },
        set(fingerprint, canon, extractedAt) {
            store[fingerprint] = { cacheVersion: CACHE_VERSION, fingerprint, extractedAt: extractedAt || '', canon };
            const keys = Object.keys(store);
            if (keys.length > CACHE_MAX) {
                keys.sort((a, b) => String(store[a].extractedAt || '').localeCompare(String(store[b].extractedAt || '')));
                for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete store[k];
            }
        },
        size() { return Object.keys(store).length; },
        keys() { return Object.keys(store).slice().sort(); },
    };
}