// story-world-v2/src/chain.js
// K40 因果链展开器（链视图细案 §3.2 → A-15）：引擎层纯函数——只读 world 数据面，
// 把"一件事的来去"展开成确定性节点链：
//   上承（up）：root 沿因果 source.ref / links.up 上溯——ripple 逐跳 / plot 遇盘算弧线卡
//     （agenda 节点：委派链 parents + 产果 fruits + 子盘算 children）/ state 到「由世界处境而生」
//     （state-root）/ ref 落空 → gap（悬空）；**里程碑聚合穿透**：上溯未命中热 events →
//     ★leg111：先查 `milestone.rows`（纪内逐事件的来路）——**归档事件与热池事件走同一条路**；
//     再退回纪节点（span/counts/titles/ids/entries），纪的 parents 沿 m.links.up 聚合
//     继续（links.up 空 → terminal「纪之源头已不可查」）；
//   下沿（down）：root 的因果引用方（ripple source.ref 或显式 links.up）全分支递归
//     （按出生轮序）——★leg111：**归档的引用方也进下沿**；已归档引用方（m.links.down 点名）→ leaf-note 余尾收敛珠；
// 防御：未知 id/空世界 → {ok:false}；环防 seen（上溯/下沿/委派链各自有界）→ gap(ring)；
//   ★leg110 修：环防的 `seen` **分两条路径各自为界**——事件链一条、纪递归一条（纪不继承事件链的 seen），
//     否则"纪引用到一个链上走过的事件"会被误判成成环（真账 19% 的节点撞这条误报，见 `milestoneNode` 头注）。
// 纪律：输入不可变、输出可序列化、逐字节确定；本模块零创作（不生成任何玩家词面），
// 渲染层（renderChainViewHtml）负责 id → 玩家名与措辞。
// 旧事件 down 边可能未维护；下游扫描 source.ref 与 links.up 因果引用方。
//   ★leg111 起归档事件**保留来路**（`milestone.rows` 存事件契约那五格）⇒ 纪内逐事件的上承/下沿都可枚举；
//   旧账（本笔之前归档的）没有 `rows` ⇒ 如实退回"纪节点 + 余尾"（不编来路）。
//   归档产果仍只列热池（agenda 产果那一栏未跟改）。

import { eventBornTick } from './setting.js';

const idCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const evMap = (world) => new Map((world.events || []).map((e) => [e.id, e]));
const agMap = (world) => new Map((world.agendas || []).map((a) => [a.id, a]));
const msOf = (ms, ref) => {
    if (!ref) return null;
    for (const m of ms) if ((m.ids || []).includes(ref) || m.id === ref) return m;
    return null;
};

function evNode(ev, children) {
    const node = {
        kind: 'event',
        id: ev.id,
        title: ev.title,
        position: ev.position ?? '',
        born: eventBornTick(ev.id),
        closed: !!ev.closed,
        // ★★★leg111（用户令「你就把进大事纪的事件来路保留就好了，和其他没进的事件一样」）：
        //   `archived` = 这条事已归档（本体不在热池，来路从 `milestone.rows` 里取）。
        //   面板据此如实标"已归大事纪"——不谎报"未了结"（归档的前提是整链结清，它一定是平息了的）。
        archived: ev.archived === true ? true : undefined,
        // ★leg40：**这个根是从世界源起的**（`source.type==='seed'`，由 `seed-roots.js` 落账）——
        //   面板上必须与"由世界处境而生"分开显示：前者是**书里写着的事**，后者是**局势自己拱出来的处境**，
        //   两者混成一句话会把"这条线有来路"这件事说反（而本棒整套改动正是在修"线没有来路"）。
        seed: ev.source?.type === 'seed' ? true : undefined,
    };
    if (children) node.children = children;
    return node;
}

// ★★★leg111：**纪内逐事件的来路索引**（`milestone.rows` → id 表）。
//   为什么必须有：归档把事件对象从热账上删掉，原来只留 `ids`+`titles` ⇒ 链视图走进大事纪就断（只剩标题串）。
//   现在 `rows` 存了事件契约那五格 ⇒ 这里建一张表，让"已归档的事件"在链视图里**和热池事件同形**可用。
//   兼容：旧账没有 `rows`（本笔之前归档的），索引里就没有它们 ⇒ 行为退回原样（如实，不编）。
function archivedEventMap(world) {
    const map = new Map();
    for (const m of world?.milestones || []) {
        for (const r of m?.rows || []) {
            if (r?.id && !map.has(r.id)) map.set(r.id, r);
        }
    }
    return map;
}

// 盘算弧线节点（plot 源上溯的终点——盘算是动作的源头，弧线自带委派链/产果/子盘算）
function agendaNode(world, ags, a) {
    if (!a) return { kind: 'gap', reason: 'missing' };
    const compact = (x) => ({
        id: x.id, goal: x.goal, owner: x.owner, visibility: x.visibility,
        closed: !!x.closed, progress: x.progress ?? 0, maxSteps: x.maxSteps ?? 0,
    });
    const node = {
        kind: 'agenda',
        id: a.id,
        goal: a.goal,
        owner: a.owner,
        visibility: a.visibility,
        stage: a.stage ?? '',
        maxSteps: a.maxSteps ?? 0,
        progress: a.progress ?? 0,
        closed: !!a.closed,
        doneTail: (a.memory?.done || []).at(-1) ?? null,
        blockedTail: (a.memory?.blocked || []).at(-1) ?? null,
        parents: [],   // 委派链上承：parentId 逐级上溯至顶（环防；深链合法不设限）
        children: [],  // 子盘算下沿（未 closed，id 序——树形委派的继续）
        fruits: [],    // 产果：热池内 source.plot ref===本盘算 的事件（出生序；归档产果不可枚举——归档丢 source）
    };
    const seen = new Set([a.id]);
    let p = a.parentId ? ags.get(a.parentId) : null;
    while (p && !seen.has(p.id)) {
        seen.add(p.id);
        node.parents.push(compact(p));
        p = p.parentId ? ags.get(p.parentId) : null;
    }
    node.children = (world.agendas || [])
        .filter((x) => x.parentId === a.id && !x.closed)
        .sort((x, y) => idCmp(x.id, y.id))
        .map(compact);
    node.fruits = (world.events || [])
        .filter((e) => e.source?.type === 'plot' && e.source.ref === a.id)
        .sort((x, y) => eventBornTick(x.id) - eventBornTick(y.id) || idCmp(x.id, y.id))
        .map((e) => evNode(e));
    return node;
}

// 纪节点：聚合穿透（parents 沿 m.links.up 递归——段级聚合指针；空 → terminal「纪之源头已不可查」）
// ★★★leg110 修（用户实机报「点事件的链总是有『环防·至此为止』」）：**纪节点的环防必须只看"纪这一条路径"**。
//   病（真账实测）：原实现把**事件链累积的 `seen`** 传进来，而那个集合里装的是"这条链上走过的事件"——
//     于是纪引用到一个**早就走过的事件**时，`seen.has(ref)` 为真 ⇒ 被当成"引用成环"剪断。
//     而真相是：那个事件**本来就在上游的某个纪里**（`m_20.links.up` 里的 `ev_1_1` 就含在 `m_10.ids` 里），
//     两条路指向同一段历史，不是环。⇒ 真账 75 个可点节点里 14 个（19%）撞这条误报，真互指 **0 处**。
//   口径：`seen` 只装**本次纪递归路径上已经过的纪 id**（从一个空集起步，不继承事件链的 seen）——
//     这样"纪→纪"的真环照样拦得住，而"纪引用到事件链走过的事件"不再误报。
//   ★同批：`parents` 里同一个 id 不许出现两遍（真账账上曾写进重复指针，见 `settle.js` 的 `normalizeMilestoneLinks`）；
//     同一 id 第二次出现时直接**跳过**（不剪断、不重复渲染），链保持完整。
function milestoneNode(evs, ms, m, seen, arch = new Map()) {
    const node = {
        kind: 'milestone',
        id: m.id,
        span: m.span ?? { from: 0, to: 0 },
        counts: m.counts ?? {},
        titles: m.titles ?? [],
        ids: m.ids ?? [],
        parents: [],
    };
    // ★★★leg111：纪内条目——**优先用 `rows` 里保住的来路**（每条挂一个链入口，与账目层同一口径）；
    //   旧账没有 `rows` ⇒ 退回 `ids`+`titles` 同位取名（行为与改前一致，不编）。
    const rowById = new Map((m.rows || []).filter((r) => r?.id).map((r) => [r.id, r]));
    node.entries = (m.ids || []).map((id, i) => {
        const r = rowById.get(id);
        return { id, title: r?.title || (typeof m.titles?.[i] === 'string' ? m.titles[i] : ''), hasPath: Boolean(r?.source) };
    });
    const rendered = new Set();   // 本节点 parents 里已经出现过的 id（账上若有重复指针，这里只渲染一次）
    for (const ref of [...new Set(m.links?.up || [])].sort(idCmp)) {
        if (rendered.has(ref)) continue;                                            // 重复引用：跳过，不算环
        if (seen.has(ref)) { node.parents.push({ kind: 'gap', reason: 'ring' }); continue; }   // 真环（纪→纪）
        const next = new Set(seen);
        next.add(ref);
        const hot = evs.get(ref);
        if (hot) { node.parents.push(evNode(hot)); rendered.add(ref); continue; }
        // ★leg111：上游指向的那件事**已归档** ⇒ 用 `rows` 里保住的来路渲染（改前这里落到"悬空"）
        const arc = arch.get(ref);
        if (arc) { node.parents.push(evNode({ ...arc, archived: true })); rendered.add(ref); continue; }
        const mm = ms.find((x) => x.id === ref);
        if (mm) { node.parents.push(milestoneNode(evs, ms, mm, next, arch)); rendered.add(ref); continue; }
        node.parents.push({ kind: 'gap', reason: 'missing' });
        rendered.add(ref);
    }
    if (!node.parents.length) node.parents.push({ kind: 'terminal', reason: 'ms-root' });
    return node;
}

// Production source and causal links are independent: dialogue retains its source,
// while links.up carries existing event causes (including completed/archived causes).
function eventCauseRefs(ev) {
    const primary = ev.source?.type === 'ripple' ? ev.source.ref : null;
    return [...new Set([primary, ...(Array.isArray(ev.links?.up) ? ev.links.up : [])]
        .filter(ref => typeof ref === 'string' && ref))];
}

// 上承路径（root 之上，最远在前）。多因展开所有已知来路；同祖去重，环防仅限当前路径。
function sourceUp(world, evs, ags, ms, srcEv, seen, arch = new Map()) {
    const out = [];
    const visited = new Set();
    const walk = (ev, path) => {
        const t = ev.source?.type;
        const refs = eventCauseRefs(ev);
        if (t === 'plot') out.push(agendaNode(world, ags, ags.get(ev.source?.ref)));
        if (!refs.length) {
            if (t === 'state') out.push({ kind: 'state-root' });
            else if (t === 'seed') out.push({ kind: 'seed-root', seedFrom: ev.seedFrom || null });
            else if (t !== 'plot' && t !== 'dialogue') out.push({ kind: 'gap', reason: 'missing' });
            return;
        }
        for (const ref of refs) {
            if (path.has(ref)) { out.push({ kind: 'gap', reason: 'ring' }); continue; }
            if (visited.has(ref)) continue;
            visited.add(ref);
            const nextPath = new Set(path);
            nextPath.add(ref);
            const parent = evs.get(ref) || (arch.has(ref) ? { ...arch.get(ref), archived: true } : null);
            if (parent) { walk(parent, nextPath); out.push(evNode(parent)); continue; }
            const m = msOf(ms, ref);
            if (m) { out.push(milestoneNode(evs, ms, m, new Set(), arch)); continue; }
            out.push({ kind: 'gap', reason: 'missing' });
        }
    };
    walk(srcEv, new Set(seen));
    return out;
}

// 下沿全分支：显式因果引用方递归 + 归档余尾收敛珠（m.links.down 点名）
// ★★★leg111：**归档的引用方也进下沿**（改前只扫热池 `world.events` ⇒ 一条事归档后，它的下游就看不见了）。
function downTree(world, evs, ms, srcEv, seen, arch = new Map()) {
    const kids = [...(world.events || []), ...[...arch.values()].map((r) => ({ ...r, archived: true }))]
        .filter((e) => eventCauseRefs(e).includes(srcEv.id))
        .sort((a, b) => eventBornTick(a.id) - eventBornTick(b.id) || idCmp(a.id, b.id));
    const children = [];
    const childSeen = new Set(seen);
    childSeen.add(srcEv.id);
    for (const k of kids) {
        if (childSeen.has(k.id)) {
            children.push({ ...evNode(k), ring: true });   // 环防（人工构造互指才可达，防御不删）
            continue;
        }
        const branchSeen = new Set(childSeen);
        branchSeen.add(k.id);
        children.push(evNode(k, downTree(world, evs, ms, k, branchSeen, arch)));
    }
    for (const m of world.milestones || []) {
        if ((m.links?.down || []).includes(srcEv.id)) {
            children.push({ kind: 'leaf-note', milestoneId: m.id, span: m.span ?? { from: 0, to: 0 }, counts: m.counts ?? {} });
        }
    }
    return children;
}

/**
 * expandChain(world, rootId) → {ok, root, up, down} | {ok:false, error}
 *  root：{kind:'event'|'milestone'}（rootId 已归档 → 纪节点，如实）
 *  up：上承节点链（最远在前）；down：下沿分支树（森林，每节点 children 递归）
 * 节点种类：event / agenda / milestone / state-root / gap(悬空|环防) / leaf-note(余尾) / terminal(纪之源头)
 * 确定性：全部分支按出生轮序/id 序；同输入两次展开逐字节一致（A-15④）
 */
export function expandChain(world, rootId) {
    const evs = evMap(world);
    const ms = world.milestones || [];
    const ags = agMap(world);
    const arch = archivedEventMap(world);   // ★leg111：纪内逐事件的来路索引
    const hot = evs.get(rootId);
    if (hot) {
        return {
            ok: true,
            root: evNode(hot),
            up: sourceUp(world, evs, ags, ms, hot, new Set([rootId]), arch),
            down: downTree(world, evs, ms, hot, new Set([rootId]), arch),
        };
    }
    // ★★★leg111：**点一件已归档的事** ⇒ 与热池事件走完全同一条路（用户原话"和其他没进的事件一样"）。
    //   改前这里会落到"纪节点为根"（只看得见段级聚合），逐事件的来路一条都没有。
    const arc = arch.get(rootId);
    if (arc) {
        const ev = { ...arc, archived: true };
        return {
            ok: true,
            root: evNode(ev),
            up: sourceUp(world, evs, ags, ms, ev, new Set([rootId]), arch),
            down: downTree(world, evs, ms, ev, new Set([rootId]), arch),
        };
    }
    const m = msOf(ms, rootId);
    if (m) {
        // 已归档 root（旧账：没有 `rows`，逐事件来路不可枚举）：纪节点为根，下沿=纪内余尾入口
        return {
            ok: true,
            root: milestoneNode(evs, ms, m, new Set([rootId]), arch),
            up: [],
            down: [{ kind: 'leaf-note', milestoneId: m.id, span: m.span ?? { from: 0, to: 0 }, counts: m.counts ?? {}, archivedRoot: true }],
        };
    }
    return { ok: false, error: '无此事件' };
}
