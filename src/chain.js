// story-world-v2/src/chain.js
// K40 因果链展开器（链视图细案 §3.2 → A-15）：引擎层纯函数——只读 world 数据面，
// 把"一件事的来去"展开成确定性节点链：
//   上承（up）：root 沿 source.ref 逐级上溯——ripple 逐跳（事件节点）/ plot 遇盘算弧线卡
//     （agenda 节点：委派链 parents + 产果 fruits + 子盘算 children）/ state 到「由世界处境而生」
//     （state-root）/ ref 落空 → gap（悬空）；**里程碑聚合穿透**：上溯未命中热 events →
//     按 milestones.ids 命中的纪节点（span/counts/titles/ids），纪的 parents 沿 m.links.up 聚合
//     继续（links.up 空 → terminal「纪之源头已不可查」）；
//   下沿（down）：root 的 ripple 引用方（source.type==='ripple' && source.ref===id）全分支递归
//     （按出生轮序），已归档引用方（m.links.down 点名）→ leaf-note 余尾收敛珠（阅卷入口挂它）；
// 防御：未知 id/空世界 → {ok:false}；环防 seen（上溯/下沿/委派链各自有界）→ gap(ring)；
// 纪律：输入不可变、输出可序列化、逐字节确定；本模块零创作（不生成任何玩家词面），
// 渲染层（renderChainViewHtml）负责 id → 玩家名与措辞。
// 数据面真语义（台账 L107 实读记录）：事件 down 边不维护——下游靠扫 source.ref 引用方；
//   归档事件丢 source（只留 title/ids）→ 纪内逐事件的下沿不可枚举，如实收敛为纪节点/余尾；
//   归档产果同理（agenda 产果只列热池）。

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
    };
    if (children) node.children = children;
    return node;
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
function milestoneNode(evs, ms, m, seen) {
    const node = {
        kind: 'milestone',
        id: m.id,
        span: m.span ?? { from: 0, to: 0 },
        counts: m.counts ?? {},
        titles: m.titles ?? [],
        ids: m.ids ?? [],
        parents: [],
    };
    for (const ref of (m.links?.up || []).slice().sort(idCmp)) {
        if (seen.has(ref)) { node.parents.push({ kind: 'gap', reason: 'ring' }); continue; }
        seen.add(ref);
        const hot = evs.get(ref);
        if (hot) { node.parents.push(evNode(hot)); continue; }
        const mm = ms.find((x) => x.id === ref);
        if (mm) { node.parents.push(milestoneNode(evs, ms, mm, new Set(seen))); continue; }
        node.parents.push({ kind: 'gap', reason: 'missing' });
    }
    if (!node.parents.length) node.parents.push({ kind: 'terminal', reason: 'ms-root' });
    return node;
}

// 上承路径（root 之上，最远在前；事件段为单一路径，纪/弧线自带分支面）
function sourceUp(world, evs, ags, ms, srcEv, seen) {
    const out = [];
    const walk = (ev) => {
        const t = ev.source?.type;
        if (t === 'state') { out.push({ kind: 'state-root' }); return; }
        if (t === 'plot') { out.push(agendaNode(world, ags, ags.get(ev.source?.ref))); return; }
        const ref = ev.source?.ref;
        if (!ref) { out.push({ kind: 'gap', reason: 'missing' }); return; }
        if (seen.has(ref)) { out.push({ kind: 'gap', reason: 'ring' }); return; }
        seen.add(ref);
        const hot = evs.get(ref);
        if (hot) { out.push(evNode(hot)); walk(hot); return; }
        const m = msOf(ms, ref);
        if (m) { out.push(milestoneNode(evs, ms, m, new Set(seen))); return; }
        out.push({ kind: 'gap', reason: 'missing' });
    };
    walk(srcEv);
    out.reverse();
    return out;
}

// 下沿全分支：直接 ripple 引用方递归 + 归档余尾收敛珠（m.links.down 点名）
function downTree(world, evs, ms, srcEv, seen) {
    const kids = (world.events || [])
        .filter((e) => e.source?.type === 'ripple' && e.source.ref === srcEv.id)
        .sort((a, b) => eventBornTick(a.id) - eventBornTick(b.id) || idCmp(a.id, b.id));
    const children = [];
    const childSeen = new Set(seen);
    childSeen.add(srcEv.id);
    for (const k of kids) {
        if (childSeen.has(k.id)) {
            children.push({ ...evNode(k), ring: true });   // 环防（人工构造互指才可达，防御不删）
            continue;
        }
        childSeen.add(k.id);
        children.push(evNode(k, downTree(world, evs, ms, k, childSeen)));
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
    const hot = evs.get(rootId);
    if (hot) {
        return {
            ok: true,
            root: evNode(hot),
            up: sourceUp(world, evs, ags, ms, hot, new Set([rootId])),
            down: downTree(world, evs, ms, hot, new Set([rootId])),
        };
    }
    const m = msOf(ms, rootId);
    if (m) {
        // 已归档 root：纪节点为根（parents 沿聚合指针；下沿=纪内余尾入口——归档丢 source，逐事件不可枚举）
        return {
            ok: true,
            root: milestoneNode(evs, ms, m, new Set([rootId])),
            up: [],
            down: [{ kind: 'leaf-note', milestoneId: m.id, span: m.span ?? { from: 0, to: 0 }, counts: m.counts ?? {}, archivedRoot: true }],
        };
    }
    return { ok: false, error: '无此事件' };
}