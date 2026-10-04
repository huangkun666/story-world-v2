// story-world-v2/src/abstract-selection.js
// 「自选抽象条目」的**纯选择层**：稳定 ID / 归一化 / 过滤。零依赖、零 DOM、零 IO。
//
// 为什么单独成模块：抽文书、名册、题名、缓存指纹这些口**都要先过一遍"玩家选了哪几条"**——
//   若每个消费者各自判一次"这条要不要用"，就是本仓最贵的病（两份真相）：面板说选上了、抽取却没看见。
//   ⇒ 口径只有一个：**进抽取之前调用一次 `selectAbstractEntries`**，下游一律吃它的结果。
//
// ★三条纪律（别改回去）：
//   ① **不用数组下标当身份**。书一改版，条目挪个位置，下标就指向别人了——玩家的勾选会**悄悄串到另一条**上。
//      缺 uid/id 时用「题名 + 键」的稳定摘要（同一条目换位置/改正文都不变 ⇒ 勾选跟着条目走）。
//   ② **来源名必须进 ID**。uid 只是**书内的号**，两本书各有一条 uid=7 是常态
//      （卡内置书与同名世界书尤其常见）⇒ 不带来源就会"勾一条连坐另一条"。
//      `_sw2Source` 由接线层在取书时写上（取书路径的产物），本模块**只读**，拿不到就按 `world-info` 算。
//   ③ **default 与 custom-空必须分形**：前者"全部条目 + 原样"，后者"一条都不留"。
//      把两种"空"混同，就是把玩家的排除动作静悄悄取消掉（本仓为这类同形付过多次账）。
//
// ★不可变：本模块**永不改**传进来的条目与设置（default 模式交出去的还是**同一份条目对象**，
//   下游（技术清理 / 题名 / 指纹）读到的仍是那本书本身，行为与选择功能上线前逐字相同）。

/** 没写 `_sw2Source` 时的来源名（ST「世界信息」那一类）。 */
export const DEFAULT_SOURCE = 'world-info';

/**
 * 稳定 ID 里的摘要（32 位 FNV-1a，手写乘法以避免对 `Math.imul` 的依赖）。
 * ★它只是"同一来源内把两条无号条目分开"用的，不承担加密职责。
 */
function digest(text) {
    let h = 0x811c9dc5;
    const s = String(text);
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return h.toString(36);
}

/** 来源名（`_sw2Source`；空白与缺失都算缺省世界信息）。 */
function sourceOf(entry) {
    const raw = String(entry?._sw2Source ?? '').trim().replace(/\s+/g, ' ');
    return raw || DEFAULT_SOURCE;
}

/** 「号」：uid 优先，其次 id（ST 两种形状都是同一个意思），都没有就给空串（表示"要算摘要"）。 */
function numberKeyOf(entry) {
    const uid = entry?.uid;
    if (uid !== undefined && uid !== null && String(uid).trim()) return String(uid).trim();
    const id = entry?.id;
    if (id !== undefined && id !== null && String(id).trim()) return String(id).trim();
    return '';
}

/** 题名：作者给这条起的名字（`comment` 优先，其次 `name`，最后退回键）。 */
function titleOf(entry) {
    const comment = String(entry?.comment ?? '').trim();
    if (comment) return comment;
    return String(entry?.name ?? '').trim();
}

/** 触发词/键（ST 里 `key` 是数组，卡内置书里可能是 `keys`）。 */
function keysOf(entry) {
    const raw = entry?.key ?? entry?.keys;
    const list = Array.isArray(raw) ? raw : (raw === undefined || raw === null ? [] : [raw]);
    return list.map((k) => String(k ?? '').trim()).filter(Boolean);
}

/**
 * 条目的**稳定身份**（选择记录里存的就是它）。
 *
 * 形状（文档用，下游只当它是"一个不透明字符串"）：
 *   · 有号：`<来源>:<uid>`            例 `大荒:12` · `world-info:12` · `character-book:7`
 *   · 无号：`<来源>:<题名>#<摘要>`      例 `character-book:无号条目#3f2k1`
 * ★两种形状都带来源名；无号那种的摘要由「题名 + 键」算出（换位置、改正文都不变）。
 * @param {object|null|undefined} entry ST 世界书条目（可带接线层写的 `_sw2Source`）
 * @returns {string} 稳定 ID
 */
export function entrySelectionId(entry) {
    const source = sourceOf(entry);
    const numberKey = numberKeyOf(entry);
    if (numberKey) return `${source}:${numberKey}`;
    const title = titleOf(entry);
    const keys = keysOf(entry);
    // 键的**顺序**不影响身份（同一批键换个排列还是同一条）；去重后再拼，摘要才稳。
    const keyText = [...new Set(keys)].sort().join('\u0001');
    return `${source}:${title}#${digest(`${title}\u0000${keyText}`)}`;
}

/**
 * 归一化一份选择设置。**只认两档**：`default`（沿用全部条目）与 `custom`（只用手选的那几条）。
 * 缺省 / 非法 / 空 ⇒ `default`（存量世界与老配置的行为一个字不变）。
 * @param {any} value 插件设置里存的那一份（可能是 null / 旧形状 / 被手改过）
 * @returns {{mode:'default'|'custom', selectedIds:string[]}}
 */
export function normalizeAbstractSelection(value) {
    // ★非法模式 ⇒ 退回 default，且**把 selectedIds 丢掉**：一个坏掉的档位配一串 ID 是自相矛盾的状态，
    //   留着它只会让下游以为"这些 ID 还作数"（本仓最忌讳的"两份真相"）。
    if (value?.mode !== 'custom' && value?.mode !== 'default') return { mode: 'default', selectedIds: [] };
    const mode = value.mode;
    const raw = Array.isArray(value?.selectedIds) ? value.selectedIds : [];
    const out = [];
    const seen = new Set();
    for (const item of raw) {
        if (item === undefined || item === null) continue;
        const id = String(item).trim();
        if (!id || seen.has(id)) continue;   // 空串与重复都不进（前后空格会让"同一条"变成两条）
        seen.add(id);
        out.push(id);
    }
    const result = { mode, selectedIds: out };
    // 没有版本和 reads 的存量设置仍保留旧形状，迁移由完整来源入口负责。
    if (value.version === 2 || Object.hasOwn(value, 'reads')) {
        result.version = 2;
        result.reads = {};
        for (const [id, read] of Object.entries(value.reads && typeof value.reads === 'object' ? value.reads : {})) {
            if (!read || !['auto', 'full', 'segments'].includes(read.mode)) continue;
            const item = { mode: read.mode };
            if (read.mode === 'segments') {
                item.originalText = typeof read.originalText === 'string' ? read.originalText : null;
                item.segments = (Array.isArray(read.segments) ? read.segments : []).map(s => ({ start: s?.start, end: s?.end, text: s?.text }));
            }
            Object.defineProperty(result.reads, id, { value: item, enumerable: true, configurable: true, writable: true });
        }
    }
    return result;
}

/**
 * 按选择**过滤条目**（进抽取之前的唯一一道闸）。
 * @param {object[]} entries 取书路径交出来的条目（原样，可带 `_sw2Source`）
 * @param {{mode?:string, selectedIds?:string[]}} [selection] 选择设置（未归一化也吃得下）
 * @returns {object[]} **新数组**；元素是**原件本身**（正文一个字不改，技术清理照旧在下游作用）
 */
export function selectAbstractEntries(entries, selection = { mode: 'default', selectedIds: [] }) {
    const list = Array.isArray(entries) ? entries : [];
    const picked = normalizeAbstractSelection(selection);
    if (picked.mode !== 'custom') return list.slice();          // default：全留（存量世界的原行为）
    const wanted = new Set(picked.selectedIds);
    // custom：只留选中的；**已消失的 ID 什么都不留**（绝不因为"记录里那条找不到了"就退回全用）
    return list.filter((entry) => wanted.has(entrySelectionId(entry)));
}
