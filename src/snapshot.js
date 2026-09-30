// story-world-v2/src/snapshot.js
// 第二十七棒后 · 快照容错（细案 docs/spec-snapshot-fault-tolerance.md，用户拍板三问：
//   ①存 IndexedDB 独立库 ②保留 **15 步**（用户原话「30步要占很大内存吧，先用15步吧」——
//     澄清：占的是**磁盘**，IDB 落盘；内存只驻留一份基准 + 一条索引）③只回世界账）。
//
// 定位：**每一步落账都可回到那一步**（用户原话「用户和 llm 每一步的修改都会生成快照」）。
// 分层归属：**纯逻辑层**——零 DOM、零 indexedDB、零 Node 内建（进 browser-compat 静态扫描面）；
//   存储适配在 `web/idb-snapshot-store.js`，接线在 `web/index.js`（同一治法：纯函数可 Node 测）。
//
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// 一、为什么是「增量 + 周期锚点」，而不是「每步一份完整拷贝」
//   实测约束（本机真账，见细案 §1）：热账 world JSON = **166,760 字节**（实体 100,090 + canon 53,172）。
//   若每步一份 full 且塞热账：ST 每次保存**整份重写聊天**（首行现 3.1 MB）⇒ 保留 20 份就撑到 6.4 MB+。
//   ⇒ 落 **IndexedDB**（与既有「旧卷」同层）+ **增量**。
//
// 二、锚点制（本模块最重要的结构选择，替代了"基线重写"那套复杂链修剪）
//   每 `ANCHOR_EVERY`(5) 步落一份 **full 锚点**；其余步只落**相对最近锚点的 delta**。
//   为什么这么设计（而不是"每步 delta 相对上一步"）：后者修剪时要么断链、要么必须**重写基线**
//   （把被删 delta 的内容折叠进下一份）——那是最容易写出 bug 的一块。
//   锚点制下：**修剪 = 从最旧直接丢**，任何时刻的窗口都自洽（丢一份 full 时其名下 delta 一并丢），
//   **结构上不可能出现断链**；恢复 = 锚 + 一个 delta（常数两步，不必重放整条链）。
//   代价：窗口里多放几份 full（15 份窗口 ≈ 3 份锚 + 12 份 delta），换掉一整类 bug——值。
//
// 三、delta 形状（**只存差异，且删除要存旧值**）
//   { set: { 'a/b/0': 值 }, del: { 'a/b/2': 旧值 } }
//   - 路径 = '/' 连接的对象键或数组下标；键里含 `/` 时**拒绝**该路径（见 escapeKey 纪律）。
//   - `del` **必须存旧值**：否则恢复时无法把"被删掉的东西"放回去（这是"快照"与"日志"的分界）。
//   - 契约：`applyDelta(base, delta)` 与快照时的世界 **逐字节相等**（`test/snapshot.test.js` 先证红再证绿）。
//
// 四、纪律（照本仓既有口径）
//   1. **失败零阻塞**：本模块是纯函数不抛网络/存储错；调用方（编排层）必须 try/catch 吞掉快照失败，
//      绝不让"拍快照"影响世界推进（与 leg26 记忆投递同一条纪律）。
//   2. **不许"大概恢复"**：任何形状不符/字节不符 ⇒ 明确返回 ok:false + 原因，**绝不部分应用**。
//   3. **确定性**：同输入两次 `diffWorld` 逐字节一致（对象键序按出现序，不排序——确定性来自输入确定性）。
//   4. **不改写入参**：全模块零就地修改（`applyDelta` 走结构化复制）。

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// 提案数字（铁律 2：提案态，随实测标定；调用方可显式传参覆盖）
//   ANCHOR_EVERY 的依据：锚点越密越占空间、越疏则恢复要重放越多。
//     5 = 每 5 步一份 166 KB 锚 ⇒ 15 份窗口里 3 份锚 ≈ 500 KB + 12 份 delta（实测 ≤3 KB/步）。
//   RETAIN_STEPS = **15**（用户拍板）。
export const ANCHOR_EVERY = 5;
export const RETAIN_STEPS = 15;
export const SNAPSHOT_FORMAT = 'story-world-v2-snapshot';
export const SNAPSHOT_VERSION = 1;

// 单份快照的结构上限守卫（防御性 · 提案）：delta 条目数超过它 ⇒ 放弃增量、退回整份 full。
//   为什么要有：diff 是通用结构比较，遇到"整表重建"型改动（如 613 实体全换 id）会产出比 full 更大的 delta。
const MAX_DELTA_ENTRIES = 4000;

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// 结构比较

const isObj = (v) => v !== null && typeof v === 'object';
// 键里含 `/`（路径分隔符）时无法用扁平路径安全表示 ⇒ 该子树按**整棵替换**处理（见 diffNode）。
const hasSlash = (k) => String(k).includes('/');

function pathJoin(path, key) {
    return path ? `${path}/${key}` : String(key);
}

/**
 * diffWorld(prev, next) → { delta, full }：
 *   delta = { set, del }（空对象表示"逐字节相同"）
 *   full  = true 表示"差异太大，建议用整份快照"（调用方据此退回落 full）
 * 纯函数：不改写入参（未变动的子树**按引用共享**，因为全程只读）。
 */
export function diffWorld(prev, next) {
    const set = {};
    const del = {};
    let count = 0;
    let overflow = false;

    const walk = (p, a, b) => {
        if (overflow) return;
        if (Object.is(a, b)) return;                       // 同值（含同引用）→ 零成本
        const ta = typeof a;
        const tb = typeof b;
        if (!isObj(a) || !isObj(b) || ta !== tb) {         // 标量/类型变了 → 整值写
            set[p] = b;
            count += 1;
            if (count > MAX_DELTA_ENTRIES) overflow = true;
            return;
        }
        const aArr = Array.isArray(a);
        const bArr = Array.isArray(b);
        if (aArr !== bArr) {                               // 数组 ↔ 对象
            set[p] = b;
            count += 1;
            if (count > MAX_DELTA_ENTRIES) overflow = true;
            return;
        }
        if (aArr) {
            // 数组：下标对齐逐位比较（`push` 只产 1 条；删尾产 del；中间插入产 后移段）
            const min = Math.min(a.length, b.length);
            for (let i = 0; i < min; i += 1) walk(pathJoin(p, i), a[i], b[i]);
            for (let i = min; i < b.length; i += 1) { set[pathJoin(p, i)] = b[i]; count += 1; }
            for (let i = min; i < a.length; i += 1) { del[pathJoin(p, i)] = a[i]; count += 1; }
            if (count > MAX_DELTA_ENTRIES) overflow = true;
            return;
        }
        // 对象：逐键
        for (const k of Object.keys(a)) {
            if (hasSlash(k)) {                             // 键含分隔符 → 整棵替换（路径无法安全表示）
                if (b[k] !== a[k]) { set[p] = b; count += 1; if (count > MAX_DELTA_ENTRIES) overflow = true; return; }
                continue;
            }
            if (!Object.prototype.hasOwnProperty.call(b, k)) {
                del[pathJoin(p, k)] = a[k];                // ★删除必须存旧值（恢复时放回去）
                count += 1;
            } else {
                walk(pathJoin(p, k), a[k], b[k]);
            }
            if (overflow) return;
        }
        for (const k of Object.keys(b)) {
            if (Object.prototype.hasOwnProperty.call(a, k)) continue;
            if (hasSlash(k)) { set[p] = b; count += 1; if (count > MAX_DELTA_ENTRIES) overflow = true; return; }
            set[pathJoin(p, k)] = b[k];
            count += 1;
            if (overflow) return;
        }
    };

    walk('', prev, next);
    if (overflow) return { delta: null, full: true, reason: `差异条目超上限 ${MAX_DELTA_ENTRIES}（整表重建型改动）` };
    return { delta: { set, del }, full: false, entries: count };
}

/** 路径（剥掉一层）拆首段：'a/b/0' → { head:'a', rest:'b/0' }；顶层 'a' → { head:'a', rest:'' } */
function splitPath(p) {
    const i = p.indexOf('/');
    if (i < 0) return { head: p, rest: '' };
    return { head: p.slice(0, i), rest: p.slice(i + 1) };
}

function pathSegments(p) {
    return p === '' ? [] : String(p).split('/');
}

/**
 * applyDelta(base, delta) → 新对象（base 不被修改）
 * 契约：与快照时的世界逐字节相等。**绝不部分应用**——中途形状不符即抛（调用方捕获后报"不可恢复"）。
 */
export function applyDelta(base, delta) {
    if (!isObj(delta) || !isObj(delta.set) || !isObj(delta.del)) {
        throw new Error('delta 形状不符（需 {set,del} 对象）');
    }
    // ★复制必须把**两个方向**的表都带上（漏传 = 退化成浅拷 = 就地改写调用方的世界，实测踩过）
    const out = deepCopy(base, delta.set, delta.del, '');
    const touchedArrays = new Set();
    for (const [p, oldV] of Object.entries(delta.del)) delAt(out, pathSegments(p), oldV, touchedArrays);
    for (const [p, v] of Object.entries(delta.set)) setAt(out, pathSegments(p), v);
    // 收尾：把"被挖空后留在末尾"的数组空位剪掉（等价 pop）。不做这一步 ⇒ JSON 把 undefined 序列化成 null
    //   ⇒ 恢复出来的数组多出 null（实测踩过：删尾部元素后得到 `[…,null]`）。
    for (const arr of touchedArrays) trimTrailingHoles(arr);
    return out;
}

// 只剪**末尾**空位：数组中间的挖空保留为 undefined（JSON 里是 null）——
//   中间删除会带来"整段搬家"的推断歧义，本设计**不猜**（宁可在该位置留一个 null 洞，也不擅自移位）。
function trimTrailingHoles(arr) {
    while (arr.length && arr[arr.length - 1] === undefined) arr.length -= 1;
}

// 结构化复制。**只复制会被写到的路径**——快照不需要深拷全文（真账 166 KB，每步深拷是浪费）。
// 但"哪条路径会被写到"要**先合上两个方向**才算得准（本次踩的两个坑都在这里，留档）：
//   坑一（漏合）：本轮只复制"set 或 del 任一命中"的容器，漏掉"set 命中而 del 也更深"的容器
//     ⇒ 那个容器被整棵换成 set 侧的值，del 侧更深层的删除**静默丢失**（实测：weights 删键被整表覆盖，键回来了）。
//   坑二（错合）：下钻时把自己那张表也合一遍 ⇒ **刚删掉的键被 del 自己写回**（实测：e_bk_2 删了还在、还跑到末尾）。
//   ⇒ 正确规则：复制容器时**合上对面那张表里更深层的条目**，但**绝不合自己**。
const touchedBy = (map, prefix) => {
    if (!isObj(map)) return false;
    for (const k of Object.keys(map)) if (k === prefix || k.startsWith(`${prefix}/`)) return true;
    return false;
};

function deepCopy(v, setMap, delMap, prefix) {
    if (Array.isArray(v)) {
        const arr = v.slice();
        const pre = prefix || '';
        for (let i = 0; i < arr.length; i += 1) {
            const path = pre ? `${pre}/${i}` : String(i);
            if (isObj(arr[i]) && (touchedBy(setMap, path) || touchedBy(delMap, path))) {
                arr[i] = deepCopy(arr[i], setMap, delMap, path);
            }
        }
        return arr;
    }
    if (!isObj(v)) return v;
    const out = { ...v };
    for (const k of Object.keys(v)) {
        const path = prefix ? `${prefix}/${k}` : String(k);
        if (isObj(v[k]) && (touchedBy(setMap, path) || touchedBy(delMap, path))) {
            out[k] = deepCopy(v[k], setMap, delMap, path);
        }
    }
    return out;
}

// 逐层下钻（容器已在 applyDelta 入口按"两个方向"整体深拷过，这里直接走）
function descend(root, segs, stopAt) {
    let cur = root;
    for (let i = 0; i < stopAt; i += 1) {
        const k = segs[i];
        const nxt = cur[k];
        if (!isObj(nxt)) throw new Error(`路径 ${segs.slice(0, i + 1).join('/')} 在基准里不存在（快照链不自洽）`);
        cur = nxt;
    }
    return cur;
}

/**
 * setAt / delAt：把一条条目写进 root。`other` = **对面**那张表（用于诊断，不用于回写）。
 * ★数组纪律（本次踩过的真 bug，留档防复发）：数组上的删除**绝不许用 splice 挪位**——
 *   `del` 的语义是"**按下标定位**的挖空"，若删下标 i 时把后面元素左移，
 *   则同时存在的 `set['arr/i+1']` 会被写到错误位置，甚至整段搬家（实测症状：events 里出现 `null` 洞）。
 */
function setAt(root, segs, value) {
    const cur = descend(root, segs, segs.length - 1);
    cur[segs[segs.length - 1]] = value;
}

function delAt(root, segs, expectOld, touchedArrays) {
    const cur = descend(root, segs, segs.length - 1);
    const last = segs[segs.length - 1];
    if (!Object.prototype.hasOwnProperty.call(cur, last)) {
        throw new Error(`要删的路径 ${segs.join('/')} 在基准里不存在（快照链不自洽）`);
    }
    if (expectOld !== undefined && !isObj(expectOld) && !Object.is(cur[last], expectOld)) {
        throw new Error(`要删的路径 ${segs.join('/')} 与基准值不符（快照链不自洽）`);
    }
    delEntry(cur, last);
    if (touchedArrays && Array.isArray(cur)) touchedArrays.add(cur);
}

// 数组按下标"挖空"而不是挪位（保持下标语义自洽）；对象直接 delete。
function delEntry(container, key) {
    if (Array.isArray(container)) {
        const i = Number(key);
        if (!Number.isInteger(i) || i < 0 || i >= container.length) {
            throw new Error(`数组下标 ${key} 越界（快照链不自洽）`);
        }
        container[i] = undefined;
        return;
    }
    delete container[key];
}

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// 快照记录 + 恢复

/** 一份快照记录（**落 IDB**；热账只存一个指针 seq） */
export function makeSnapshot({ world, id, tick, at, reason, kind, anchorId = null, delta = null, worldBytes = null }) {
    if (!id) throw new Error('快照必须有 id');
    if (kind !== 'full' && kind !== 'delta') throw new Error('kind 必须是 full|delta');
    if (kind === 'delta' && !anchorId) throw new Error('delta 必须带 anchorId');
    const rec = {
        format: SNAPSHOT_FORMAT,
        version: SNAPSHOT_VERSION,
        id,
        tick: Number.isFinite(tick) ? tick : null,
        at: at || new Date().toISOString(),
        reason: String(reason || '未标注'),
        kind,
    };
    if (kind === 'full') {
        rec.world = world;
        rec.bytes = worldBytes != null ? worldBytes : JSON.stringify(world).length;
    } else {
        rec.anchorId = anchorId;
        rec.delta = delta;
        rec.bytes = JSON.stringify(delta).length;
    }
    return rec;
}

/**
 * planStep({ seq, tick, world, prevWorld, prevAnchorWorld, prevAnchorId, prevAnchorTick, reason, anchorEvery, now })
 *   → { snapshot, nextSeq, anchorId, anchorTick, anchorWorld, mode }
 * 决定"这一步落 full 还是 delta"（纯函数，不落盘）。编排层拿到后交给 IDB store。
 * 规则：①没有 prevAnchorWorld（首份/刷新后失基准）⇒ full ②距锚点 ≥ anchorEvery 步 ⇒ full ③否则 delta。
 *
 * ★不变量（本次踩过的真 bug，务必守住）：
 *   **delta 必须相对"锚点世界"算，不能相对"上一步世界"算。**
 *   我第一版写成了 `diffWorld(prevWorld, world)`——看着对（每步都变小），但**恢复语义就错了**：
 *   恢复 = 锚 + delta，而 delta 只含"上一步→这一步"的改动 ⇒ 锚到上一步之间的改动**全部丢失**。
 *   实测症状（本机复现）：events 里出现 `null` 洞（被"挖空"的那一位没人填回）、
 *   被删掉的权重键又回来了——而且**只有 delta 份错、full 份对**（s1/s6/s11 对，其余全错），
 *   这种"一半对一半错"最难肉眼发现，所以它必须由测试锁死（`test/snapshot.test.js` 的"每一份都能恢复"）。
 *   ⇒ 所以 planStep 必须拿到 `prevAnchorWorld`，并把它原样传下去（`anchorWorld`）。
 */
export function planStep({ seq = 0, tick = null, world, prevWorld = null, prevAnchorWorld = null, prevAnchorId = null, anchorSeq = null, reason = '', anchorEvery = ANCHOR_EVERY, now = null } = {}) {
    if (!isObj(world)) throw new Error('planStep 需要 world 对象');
    const nextSeq = Number.isInteger(seq) && seq > 0 ? seq + 1 : 1;
    const id = `s${nextSeq}`;
    const worldBytes = JSON.stringify(world).length;
    if (!isObj(prevAnchorWorld)) {
        return { snapshot: makeSnapshot({ world, id, tick, at: now, reason: `${reason}（首份·锚）`, kind: 'full', worldBytes }), nextSeq, anchorId: id, anchorSeq: nextSeq, anchorWorld: world, mode: 'full-nobase' };
    }
    // ★锚点间隔必须按**步号**算，不能按 tick 差算（实测踩过）：
    //   一步演化可能推进多轮 tick（真账里一步常走 1–N 轮）⇒ 用 `|tick − 锚tick| ≥ 5` 判会在**第二步**就再落锚
    //   （实测症状：锚点变成 s1/s3/s5/s7… 每 2 步一份 full，白占一倍空间）。锚点是"**每几步**"的概念。
    const stepSinceAnchor = Number.isInteger(anchorSeq) && anchorSeq > 0 ? nextSeq - anchorSeq : anchorEvery;
    if (!prevAnchorId || stepSinceAnchor >= anchorEvery) {
        return { snapshot: makeSnapshot({ world, id, tick, at: now, reason: `${reason}（锚点）`, kind: 'full', worldBytes }), nextSeq, anchorId: id, anchorSeq: nextSeq, anchorWorld: world, mode: 'full-anchor' };
    }
    const { delta, full, reason: why } = diffWorld(prevAnchorWorld, world);   // ★相对**锚点**算（见上方不变量）
    if (full) {
        return { snapshot: makeSnapshot({ world, id, tick, at: now, reason: `${reason}（锚点·${why}）`, kind: 'full', worldBytes }), nextSeq, anchorId: id, anchorSeq: nextSeq, anchorWorld: world, mode: 'full-overflow' };
    }
    return {
        snapshot: makeSnapshot({ world, id, tick, at: now, reason, kind: 'delta', anchorId: prevAnchorId, delta }),
        nextSeq, anchorId: prevAnchorId, anchorSeq, anchorWorld: prevAnchorWorld, mode: 'delta',
    };
}

/**
 * restoreFrom({ snapshots, targetId }) → { ok, world, plan, error }
 * `snapshots` = 该聊天的全量快照（或窗口），按 id 数字序无需预排序（本函数自己找）。
 * 两条纪律：①**绝不部分应用**——锚点缺失/形状不符 ⇒ ok:false + error，不给半成品 ②不改入参。
 */
export function restoreFrom({ snapshots, targetId } = {}) {
    const list = Array.isArray(snapshots) ? snapshots.filter((s) => isObj(s) && s.id) : [];
    const byId = new Map(list.map((s) => [String(s.id), s]));
    const target = byId.get(String(targetId));
    if (!target) return { ok: false, error: `快照 ${targetId} 不存在（可能已被窗口淘汰）` };
    if (target.kind === 'full') {
        return { ok: true, world: target.world, plan: 'full', used: [target.id] };
    }
    const anchor = byId.get(String(target.anchorId));
    if (!anchor) return { ok: false, error: `快照 ${targetId} 的锚点 ${target.anchorId} 不在窗口内（已淘汰 ⇒ 不可恢复）` };
    if (anchor.kind !== 'full') return { ok: false, error: `快照链不自洽：锚点 ${anchor.id} 不是 full` };
    try {
        const world = applyDelta(anchor.world, target.delta);
        return { ok: true, world, plan: 'anchor+delta', used: [anchor.id, target.id] };
    } catch (err) {
        return { ok: false, error: `恢复失败（快照链不自洽，世界原样不动）：${err?.message || err}` };
    }
}

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// 保留窗口（用户拍板 15 步）

// 快照序号解析（**唯一一份实现**——本仓吃过"两份复制品漂移"的亏，故不在这里写第二遍）。
// ★本次踩过的真 bug（留档）：旧写法是 `Number(String(id).replace(/^s/, '')) || 0`——看着对（`s12` → 12），
//   但 ①解析失败时**静默降级成 0**，`planRetention` 的排序随之全乱（"保留最新 15 份"实际保留了**任意** 15 份）；
//   ②而**单靠"窗口内每一份可恢复"是发现不了它的**（乱序窗口照样自洽）——只有 keepId 那条锁抓到了。
//   ⇒ 现在：只认 `s<数字>`；解析不出来按 -1（排最后、稳定保持原序），**绝不静默当 0**。
function seqOfSnapshot(s) {
    const m = /^s(\d+)$/.exec(String(s?.id ?? ''));
    return m ? Number(m[1]) : -1;
}

function sortBySeq(list) {
    return [...list].sort((a, b) => seqOfSnapshot(a) - seqOfSnapshot(b));
}

/**
 * planRetention({ snapshots, retain = RETAIN_STEPS, keepId }) → { keep, drop }
 * 滚动窗口：保留最新 `retain` 份（按 seq 序）；**锚点制让修剪安全**——
 *   丢一份 full 锚点时，它名下的 delta 若仍在窗口内会失去锚 ⇒ 一并丢（**结构上不可能留断链**）。
 * `keepId`：正在恢复/刚恢复的那一份永远留（防"恢复完发现回不去了"）。
 */
export function planRetention({ snapshots, retain = RETAIN_STEPS, keepId = null } = {}) {
    const list = (Array.isArray(snapshots) ? snapshots : []).filter((s) => isObj(s) && s.id);
    const sorted = sortBySeq(list);
    const byId = new Map(sorted.map((s) => [String(s.id), s]));
    const keep = new Set();
    for (const s of sorted.slice(Math.max(0, sorted.length - retain))) keep.add(String(s.id));
    // keepId：**闭包**——保住它自己，并沿锚链把它需要的锚一并保住（"保一份"不够；delta 没有锚就是废纸）。
    //   实测教训：第一版只 keep 自己 ⇒ 留下的 s3 虽然可恢复，但它**名下的 delta**（s4/s5）因锚不在而被级联丢弃，
    //   而 keepId 的用意正是"刚恢复完那一步之后还能往前翻"。
    if (keepId) {
        let cur = byId.get(String(keepId));
        while (cur && !keep.has(String(cur.id))) {
            keep.add(String(cur.id));
            cur = cur.kind === 'delta' ? byId.get(String(cur.anchorId)) : null;
        }
    }
    // 锚点完整性：被保留的 delta 若锚点不在保留集 ⇒ 一并丢（不留断链）
    let changed = true;
    while (changed) {
        changed = false;
        for (const s of sorted) {
            if (!keep.has(String(s.id))) continue;
            if (s.kind !== 'delta') continue;
            if (keep.has(String(s.anchorId))) continue;
            keep.delete(String(s.id));
            changed = true;
        }
    }
    const drop = sorted.filter((s) => !keep.has(String(s.id))).map((s) => String(s.id));
    const kept = sorted.filter((s) => keep.has(String(s.id)));
    return {
        keep: kept.map((s) => String(s.id)),
        drop,
        bytes: kept.reduce((n, s) => n + (Number(s.bytes) || 0), 0),
    };
}

/** 状态栏/面板用的一行事实摘要（纯函数） */
export function describeSnapshots(snapshots) {
    const list = (Array.isArray(snapshots) ? snapshots : []).filter((s) => isObj(s) && s.id);
    if (!list.length) return '快照 0 份（还没有可回退的步）';
    const sorted = sortBySeq(list);       // ★与 planRetention 共用同一个序号解析（别写第二份）
    const ticks = sorted.map((s) => s.tick).filter((t) => Number.isFinite(t));
    const bytes = sorted.reduce((n, s) => n + (Number(s.bytes) || 0), 0);
    const kb = bytes / 1024;
    const span = ticks.length ? `覆盖第 ${Math.min(...ticks)}–${Math.max(...ticks)} 轮` : '轮次未标注';
    const newest = sorted[sorted.length - 1];
    return `快照 ${sorted.length} 份 · ${span} · ${kb >= 1024 ? `${(kb / 1024).toFixed(2)}MB` : `${kb.toFixed(0)}KB`} · 最新 ${String(newest.at || '').slice(11, 19) || '—'}`;
}
