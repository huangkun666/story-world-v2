// story-world-v2/src/vector-store.js
// ★★★leg152：**向量索引的存储与恢复**（细案 `docs/spec-memory-engine.md` §6②：索引只能是加速层）。
//
// 【为什么它必须单独一层、而且必须有判据】
//   向量索引的"记性"不只是向量——还有**已经嵌过哪些事**（水位线）。这两样必须**一起持久**：
//   丢了水位线 ⇒ 下一轮会把账上所有事**再嵌一遍** ⇒ 那就不是加速层，是一台**每轮烧钱的机器**。
//   ⇒ "它丢了会怎样""形状对不上会怎样""合并会不会丢"这三件事**都必须测得出来**（本文件那七条判据）。
//
// 【★四条不变量（每一条都是为了不浪费钱或不骗人）】
//   ① **形状对不上 ⇒ 视为没有**：版本 / 模型号 / 维度，任何一样变了，老向量一律不认
//      （向量错模型就是垃圾；"凑合读"会安静地给出一堆假相似度）。
//   ② **水位线只增不减**：合并两个索引取并集；同一个 id 以**先来的那份**为准。
//   ③ **往返逐位相同**：浮点数组序列化之后必须一模一样（本层只做结构转换，不改数值）。
//   ④ **没东西就不写盘**：一个字节都没嵌过 ⇒ 不落盘；内容没变 ⇒ 不重复写。
//
// 【★住哪（这条是设计，不是实现细节）】
//   索引**住在本地存储**（浏览器 IndexedDB，按聊天分），**绝不写进 `chat_metadata`**
//   （那份是整份重写的，实测 3.1 MB）。⇒ **它丢了，账照样答**（退回关键词那条糙路）。
//   ★所以本层只做"形状 ＋ 编解码 ＋ 合并"，**不碰任何存储 API**：谁来存由调用方决定
//   （判据走内存那条；生产给一个 IndexedDB 适配器）——这样本层在 Node 里可穷举真跑。

/** 索引的形状标识（改结构就要动这个版本号：旧索引会被视为"没有"，然后重嵌）。 */
export const VECTOR_STORE_VERSION = 1;
export const VECTOR_STORE_KIND = 'story-world-v2-vector-index';

/** 一份空索引。★形状固定：三个**等长**数组（同一件事在三个数组里是同一个下标）。 */
export function emptyStore({ model = '', dims = null, provider = null } = {}) {
    return { v: VECTOR_STORE_VERSION, kind: VECTOR_STORE_KIND, model: String(model || ''), dims: Number.isFinite(Number(dims)) && dims != null ? Number(dims) : null, ids: [], tickByIndex: [], vecs: [], ...(provider != null ? { provider: String(provider) } : {}) };
}

/** 这份索引是不是"这片签名下的"（版本/kind/模型号/维度，四样全对才算）。 */
export function matchesSignature(store, { model = '', dims = null, provider = null } = {}) {
    if (!store || store.kind !== VECTOR_STORE_KIND || store.v !== VECTOR_STORE_VERSION) return false;
    if (String(store.model || '') !== String(model || '')) return false;
    if (String(store.provider || '') !== String(provider || '')) return false;
    const a = store.dims == null ? null : Number(store.dims);
    const b = dims == null ? null : Number(dims);
    if (a !== b) return false;
    return Array.isArray(store.ids) && Array.isArray(store.tickByIndex) && Array.isArray(store.vecs)
        && store.ids.length === store.tickByIndex.length && store.ids.length === store.vecs.length;
}

/** 序列化成可落盘的形状（本层不改数值，只挑键）。 */
export function encodeStore(store) {
    return {
        v: VECTOR_STORE_VERSION,
        kind: VECTOR_STORE_KIND,
        model: String(store?.model || ''),
        ...(store?.provider != null ? { provider: String(store.provider) } : {}),
        dims: store?.dims == null ? null : Number(store.dims),
        ids: [...(store?.ids || [])],
        tickByIndex: [...(store?.tickByIndex || [])],
        vecs: (store?.vecs || []).map((v) => (Array.isArray(v) ? [...v] : [])),
        ...(store?.sourceById ? { sourceById: { ...store.sourceById } } : {}),
        ...(Number.isFinite(store?.completedThrough) ? { completedThrough: store.completedThrough } : {}),
        ...(store?.historyScope ? { historyScope: { ...store.historyScope, known: { ...store.historyScope.known } } } : {}),
    };
}

/**
 * 解回来。★形状对不上/不是这一份 ⇒ **空索引**（不是"凑合读"）。
 * @returns {{v,kind,model,dims,ids,tickByIndex,vecs}}
 */
export function decodeStore(raw, sig = {}) {
    const empty = emptyStore(sig);
    let obj = raw;
    if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { return empty; } }
    if (!matchesSignature(obj, sig)) return empty;
    return encodeStore(obj);
}

/** 合并两份索引：**并集**；同一个 id 以**先来的那份**为准（不许被后写的覆盖成另一条向量）。 */
export function mergeStores(a, b) {
    const base = a && Array.isArray(a.ids) ? encodeStore(a) : emptyStore({ model: b?.model, dims: b?.dims });
    const out = encodeStore(base);
    const seen = new Set(out.ids.map(String));
    const src = b && Array.isArray(b.ids) ? b : null;
    if (!src) return out;
    for (let i = 0; i < src.ids.length; i += 1) {
        const id = String(src.ids[i]);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.ids.push(id);
        out.tickByIndex.push(src.tickByIndex?.[i] ?? null);
        out.vecs.push(Array.isArray(src.vecs?.[i]) ? [...src.vecs[i]] : []);
    }
    return out;
}

/** 已经嵌过哪些事（＝水位线的可读面；给 `embedDelta` 的 `embedded` 用）。 */
export function embeddedIdsOf(store) {
    return (store?.ids || []).map(String).filter(Boolean);
}

/** 读数（界面上那一行"嵌了多少 / 多少维 / 哪个模型"）。 */
export function storeStatsOf(store) {
    const n = (store?.ids || []).length;
    const first = Array.isArray(store?.vecs?.[0]) ? store.vecs[0].length : null;
    return { count: n, dims: first, model: String(store?.model || '') };
}

/**
 * 内存版装置（判据用的那个"调用方"）。
 * ★它把"什么时候写盘"也照生产口径做出来：**有变化才写、写一次就把脏标记清掉**
 *   ——这样"内容没变不重复写"这件事才测得出来（写盘是整份重写，能省就省）。
 * @param {{model?:string,dims?:number|null}} sig
 * @param {{stored?:string|null}} [opts] 初始盘上有什么（用来量"恢复"这条路）
 */
export function harnessOf(sig = {}, { stored = null } = {}) {
    let store = stored == null ? emptyStore(sig) : decodeStore(stored, sig);
    let dirty = false;
    let writes = 0;
    const calls = { embedCalls: 0, embeddedItems: 0 };
    return {
        store: () => encodeStore(store),
        dirty: () => dirty,
        writes: () => writes,
        calls,
        /** 盘上现在是什么（生产里这一步走存储适配器；判据里就是一根字符串） */
        dump: () => (writes ? JSON.stringify(encodeStore(store)) : stored),
        /** ★恢复：盘上有东西 ⇒ 接着用；没有/形状不对 ⇒ 从零开始（水位线不再重来是不可能的，只能重嵌） */
        restore: () => { store = stored == null ? emptyStore(sig) : decodeStore(stored, sig); dirty = false; return storeStatsOf(store); },
        /**
         * 把一批"嵌好的"并进索引。★只增不改、只收条数对得上的、没有轮次的不收。
         * @returns {number} 真写进去几条
         */
        putMany(items, vecs) {
            const list = Array.isArray(items) ? items : [];
            const vs = Array.isArray(vecs) ? vecs : [];
            if (!list.length) return 0;
            if (vs.length !== list.length) return 0;              // ★条数对不上 ⇒ 整批不写
            let n = 0;
            for (let i = 0; i < list.length; i += 1) {
                const it = list[i];
                const id = String(it?.id ?? '');
                // ★`Number(null) === 0` 这个坑本轮咬了三次（另两处在 `beforeNowOf` / `embed-client`）
                //   ⇒ 凡是"可能没有"的数值格，一律先显式排掉 null/空串，再谈是不是有限数。
                const rawTick = it?.tick;
                const tick = rawTick == null || rawTick === '' ? NaN : Number(rawTick);
                const v = vs[i];
                if (!id || store.ids.includes(id)) continue;      // 已有 ⇒ 不动它（只增不改）
                if (!Number.isFinite(tick)) continue;             // 没有轮次 ⇒ 不进时间轴
                if (!Array.isArray(v) || !v.length) continue;     // 没向量 ⇒ 不写（空着就是空着）
                store.ids.push(id);
                store.tickByIndex.push(tick);
                store.vecs.push([...v]);
                n += 1;
            }
            if (n) { dirty = true; calls.embeddedItems += n; }
            return n;
        },
        /** ★落盘：没变化 ⇒ 不写（返回 false） */
        persist() {
            if (!dirty || !store.ids.length) return false;
            dirty = false; writes += 1;
            return true;
        },
    };
}
