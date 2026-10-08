// story-world-v2/src/lines.js
// 故事线（引擎层纯函数 · 零 DOM/零 IO）：把账切成**互不相交**的一条条"讲得完的因果线"。
//
// ── 它是什么 ────────────────────────────────────────────────────────────────
// **一条线 = 一棵树**（单亲森林里互不相交的那一棵），条件是**两格**同时成立：
//   **全收口 ∧ 事件数 ≥ N**（N = 5，用户 2026-09-25 拍板）。
//   ★★★**"全收口"这一格有一次修订**（真模型 60 轮长跑实跑抓出来的，见 `forestOf` 里那段长注）：
//     **"起点"（根是 `state`／`seed` 源的那种事）不参与这一格**——它是链条的起点，**不是待办的事**，
//     而且引擎自己那一圈**永远不收它** ⇒ 不改的话，凡挂在"处境／种子"上的树**永远立不成线**。
//     ★本笔删掉两处**不参与判定**的旧格（都有实测背书，见 `forestOf` 那两处注）：
//       · `trees[].allNodesClosed`（旧口径"全节点收口"）——零读者，且新口径就是它的修订版；
//       · 判据里的 `hasOrigin` 合取项——**50 份真账 555 棵树上为假 0 棵**（实测）⇒ 永远为真。
//       要复现"老曲线"随时可以：`demo/measure-leg127-line-curve.js` **自带一份**带这两格的实现。
// ★★口径与 `demo/measure-leg127-line-curve.js` 的**乙案同一把尺**：`allClosed && eventCount >= N`。
//   为什么必须同一把：N=5 是照那份曲线拍的，这里若另写一套（哪怕"更合理"），**那个数当场作废**。
//   ★量测脚本那一侧仍写着 `hasOrigin`，而它对事件根**恒真**（同批实测：555 棵树里为假 0 棵）
//     ⇒ 两边算出来的线集合**逐条相同**（64 条 vs 64 条）；本文件不再判它。
//
// ── 这一版要解决的那个矛盾：多因点 ────────────────────────────────────────
// 账上**只有一个**来路格子（`source` 是单个对象，`additional:false`）⇒
//   "好几件事共同促成一件新事"这件事，按 `source` **根本写不出来**（只留得下其中一条）。
// 而账上同时又有**第二个上游指针**：`links.up`——它是**数组**，而且是**引擎维护**的
//   （`settle.js` 落账时写、归档时重指里程碑、里程碑那一层还会把段内多条上游并进去）。
// ⇒ ★**定案（两个指针分工，各管一件事）**：
//     · `source`   ＝ **来路**，**永远单亲** ⇒ 管"划分"（谁属于哪条线）——承重墙③不破；
//     · `links.up` ＝ **合流**，**可以多条** ⇒ 管"多因"（这件事是哪几件共同促成的）。
//   引擎落账时把多因并进那张表（`settle.js` 的 `hangEvents`）。★口径照旧、一个字节没放宽：
//   `links.up` 里装的是 **ripple 型的主因 ＋ 模型点名的多因**；`plot` 型的主因是**盘算**（不是事件）
//   ⇒ **不进那张表**（既有口径，本笔不动它——坏账扫描与归档的 up 指针都按"这里只有事件 id"在用）。
// ⇒ **多因点 = `links.up` 长度 ≥ 2 的节点**。它**不参与划分**（划分只看 `source`）⇒
//   森林照样互不相交、终点照样有定义，而"多因"第一次变成**可判、可查**的事实（不是读的时候猜）。
//   ★与"合流点"是两件事，别混（用户 2026-09-25 当场指出的）：
//     · **多因点** ＝ 好几件因 → 这一件（**入边**多，住在 `links.up`）；
//     · **合流点（共用头）** ＝ 一个父、好几个子（**出边**多，住在 `source`）。
//   一件多因点可以只有一条子线（那就不是合流点）；一个合流点也可以只有一条来路（那就不是多因）。
//
// ── 为什么切得出"互不相交" ──────────────────────────────────────────────────
// 法二（来路只有一口、最多填一个）＋ 法三（来路只能指向比自己早的东西 ⇒ 结构上写不出环）
//   ⇒ 所有节点被分成互不相交的一条条线，各有唯一起点、唯一终点（理论稿 §3 的 C）。
//   本模块**不去猜**任何来路：`source` 上没写就是根，"由处境而生"就是根，如实算。
//
// ── 与 `src/chain.js` 的关系（★别写成第二把尺子）─────────────────────────────
// `chain.js` 的 `expandChain` 是**从一个根往外看**的展开器（链视图用）；本模块是**全账划分器**。
//   两者共用同一条"归档事件也是节点"的口径（`milestones[].rows` 保住了逐事件的来路，leg111），
//   但**取数面不同**：本模块把三处节点收成一张 id 表再划树，不改任何账。
//   本模块**零写账、零创作**：不生成任何字，行文由 `pack.js` 按固定模板拼。
//
// 纪律：输入不可变、输出可序列化、同输入两次调用逐字节一致（无随机、无 Date.now）。

import { eventBornTick } from './setting.js';

/** 立一条线至少要有几件事（N=5：用户 2026-09-25 拍板，曲线见 `spec-long-memory-theory.md` §8.4–§8.7）。 */
export const LINE_MIN_EVENTS = 5;
/** 一栏最多递几条线（提案态；实测密档约 40 条 / 500 轮 ⇒ 这个上界是"装得下"的量级）。 */
export const LINES_TOP = 40;
/**
 * ★★★leg151：**一轮最多预取几条线的经过**（引擎自己取，见 `pickLinesToPrefetch`）。
 * 为什么要有这个数：它是**成本闸**——预取每轮都发生，不封顶就会把整包吃光。
 * ★它**不是** `LINE_ONDEMAND_TOP`：那个数是照"偶尔点一次名"定的（防"我全要"），
 *   而预取是**每轮都在发生**的事，两者的活不一样，不许合成一个数。
 * ★真尺是包预算（超了由 `trimPack` 裁并留痕）；这个数只是"一条线都不许要得更多"的上界。
 */
export const LINES_PREFETCH_TOP = 3;
/** 一轮最多递几条线的经过（照 `SCALE_ONDEMAND_TOP` 同一条体积纪律：防"我全要"）。 */
export const LINE_ONDEMAND_TOP = 3;
/** 一条线的经过最多用多少字符（照 `SCALE_ONDEMAND_CHAR_TOP` 同一条：它是包预算的一个零头）。 */
export const LINE_DETAIL_CHAR_TOP = 4000;
/** 一条线太长时：头尾各留几件（中间如实记"略"——**不许装作这就是全部**）。 */
export const LINE_DETAIL_KEEP = 20;

// ── 来路（照量测脚本 `parentOfEvent` / `parentOfAgenda` 逐字同规）──────────────
/**
 * 一件事件的来路（父 id；null = 根）。
 * ripple/plot 的 source.ref 保留主因；其余显式 links.up 第一项为树的父。
 * 没有显式因的 state/seed/dialogue 才是根；其余多因仍单独计数，树保持单亲。
 */
export function parentOfEvent(e) {
    const st = e?.source?.type, ref = e?.source?.ref;
    if (st === 'ripple' && ref) return ref;
    if (st === 'plot' && ref) return ref;
    return (Array.isArray(e?.links?.up) ? e.links.up : []).find(id => typeof id === 'string' && id) || null;
}

/**
 * 一条盘算的来路（父 id；null = 根）。
 * ★优先 `source.ref`：**父结算之后 `parentId` 会被删掉**（`settle.js`），`source` 留着 ⇒
 *   只认 `parentId` 的写法会在父一结算时把支脉整条丢掉（量测脚本实测过这个坑）。
 */
export function parentOfAgenda(a) {
    const st = a?.source?.type, ref = a?.source?.ref;
    if (st === 'parent' && ref) return ref;
    if (st === 'event' && ref) return ref;
    if (a?.parentId) return a.parentId;   // 老账／夹具只有 parentId 没有 source
    return null;
}

/**
 * 一个节点**记下来的因有几条**（多因点的判据）。
 *   账上的因住在两处，**要一起数**（少算一处就会把多因点看漏）：
 *     · `source.ref` ＝ **主因**（来路那一条；`state`/`seed`/`dialogue` 型没有 ref ⇒ 这条不存在）；
 *     · `links.up`  ＝ **合流表**（ripple 主因 ＋ 模型点名的多因，可多条）。
 *   ★别犯这个错：主因若已经在合流表里（ripple 型就是），**不许重复计一条**。
 *   ⇒ **多因点 ⟺ 这里 ≥ 2**（"好几件因共同促成这一件"第一次成了账上可判的事实）。
 */
function causeCountOf(x) {
    const ups = (Array.isArray(x?.links?.up) ? x.links.up : []).filter((v) => typeof v === 'string' && v);
    const set = new Set(ups);
    const primary = x?.source?.ref;
    if (typeof primary === 'string' && primary && !set.has(primary)) return set.size + 1;
    return set.size;
}

/**
 * 全账节点表（三处，一个不多一个不少）。
 *   · 热账事件 `world.events`
 *   · ★**已归档事件** `world.milestones[].rows`——归档会把事件从热账**删掉**（`settle.js`），
 *     来路只活在 `rows` 里（leg111 才加的格；旧账没有 ⇒ 旧账在归档那一步**断链**，这里如实少算，不编）
 *   · 盘算 `world.agendas`（**永不归档**）
 * @returns {Map<string, {id,kind,title,parentId,rootType,closed,archived,ups}>}
 */
export function nodesOf(world) {
    const nodes = new Map();
    for (const e of world?.events || []) {
        if (!e?.id || nodes.has(e.id)) continue;
        nodes.set(e.id, {
            id: e.id, kind: 'event', title: e.title ?? '', parentId: parentOfEvent(e),
            rootType: e.source?.type ?? '?', closed: !!e.closed, archived: false, causes: causeCountOf(e),
        });
    }
    for (const m of world?.milestones || []) {
        for (const r of m?.rows || []) {
            if (!r?.id || nodes.has(r.id)) continue;
            nodes.set(r.id, {
                id: r.id, kind: 'event', title: r.title ?? '', parentId: parentOfEvent(r),
                // 归档的前提是整链结清 ⇒ 归档副本**恒为已收口**（账上没有 `closed` 那一格，见 schema 头注）
                rootType: r.source?.type ?? '?', closed: true, archived: true, causes: causeCountOf(r),
            });
        }
    }
    for (const a of world?.agendas || []) {
        if (!a?.id) continue;
        nodes.set(a.id, {
            id: a.id, kind: 'agenda', title: a.goal ?? '', parentId: parentOfAgenda(a),
            rootType: a.source?.type ?? (a.parentId ? 'parent' : '?'), closed: !!a.closed, archived: false, causes: causeCountOf(a),
        });
    }
    return nodes;
}

/**
 * 单亲森林（★划分就在这里发生：每个节点恰好进一棵树）。
 * 来路指向账上没有的 id ⇒ **算作根并单独计数**（`danglingParents`）——那是"账不干净"的读数，不许悄悄吞掉。
 * @returns {{nodes:Map, trees:Array, danglingParents:number}}
 */
export function forestOf(world) {
    const nodes = nodesOf(world);
    let danglingParents = 0;
    for (const n of nodes.values()) {
        if (n.parentId && !nodes.has(n.parentId)) { danglingParents += 1; n.parentDangling = true; n.parentId = null; }
    }
    const children = new Map();
    for (const n of nodes.values()) {
        if (!n.parentId) continue;
        if (!children.has(n.parentId)) children.set(n.parentId, []);
        children.get(n.parentId).push(n.id);
    }
    const trees = [];
    for (const n of nodes.values()) {
        if (n.parentId) continue;                        // 不是根 ⇒ 它属于别人的树
        const ids = [];
        const seen = new Set([n.id]);                    // 环防（契约上写不出环，防御不删）
        let frontier = [n.id], height = 0, maxChildren = 0;
        while (frontier.length) {
            const next = [];
            for (const id of frontier) {
                ids.push(id);
                const ch = (children.get(id) || []).filter((c) => !seen.has(c));
                for (const c of ch) seen.add(c);
                if (ch.length > maxChildren) maxChildren = ch.length;
                next.push(...ch);
            }
            if (next.length) height += 1;
            frontier = next;
        }
        const evIds = ids.filter((id) => nodes.get(id).kind === 'event');
        const ticks = ids.map((id) => eventBornTick(id)).filter((v) => Number.isFinite(v));
        // ★多因点：**记下来的因 ≥ 2 条**（主因 ＋ 至少一条别的因，或合流表里两条以上）。
        const joins = ids.filter((id) => (nodes.get(id).causes || 0) >= 2);
        // ★★★本次修（真模型 60 轮长跑实跑抓出来的病）：**"起点"不参与"收没收口"这一格**。
        //   病：判据要"整棵树全收口"，而**根也算在内**；可 `state`／`seed` 源的那种事
        //     **引擎自己那一圈永远不收**（`settle.js` 的自动收口只扫 `ripple` 源，见那儿第 378 行）
        //     ⇒ **凡挂在"处境／种子"上的树，永远立不成一条线**。
        //     实测：一棵 17 件、底下全收口的大树就卡在根这一格；60 轮里它一次都没进过包。
        //     ★而生产做种走的就是 `seed` 型（`src/seed-roots.js`）⇒ 世界的主线从第一天起就是这栏的盲区。
        //   ★这不是"放宽判据"，是**纠正一处混同**：引擎自己早就把这两型当"起点、不是待办的事"
        //     （`settle.js` 那句「播种源 / 处境源 = 链条的起点（不是"待办的事"）」）⇒
        //     起点没收口 **≠** 故事没讲完；"收口"说的是**底下那些事**讲完了。
        //   ★本笔删掉旧口径 `allNodesClosed`（"全节点收口"，零读者）——它就是上面这一格的修订前版本，
        //     留着是"同一件事的第二个说法"。要复现老曲线：`demo/measure-leg127-line-curve.js` 自带一份。
        const rootIsStart = n.kind === 'event' && (n.rootType === 'state' || n.rootType === 'seed');
        const allClosed = ids.every((id) => (rootIsStart && id === n.id) || nodes.get(id).closed);
        trees.push({
            root: n.id,
            rootType: n.rootType,
            rootIsStart,
            nodeCount: ids.length,
            eventCount: evIds.length,
            height,
            maxChildren,
            allClosed,
            // ★leg134：本笔删掉两格，两格都是**零读者**（照"没多大用的设计直接摒弃即可"办）：
            //   · `hasOrigin`——它原先是立线判据里的一个合取项，实测**永远为真**
            //     （50 份真账 555 棵树里为假 0 棵）⇒ 先把它从判据里拿掉，拿掉之后这一格就再没有读者了
            //     （`demo/run-longrun-health.mjs` 那份"差一格就能立线"读数同批改掉）。
            //   · `span`——它的唯一读者是线对象上那一格"跨度"，同批删了。
            //   ★要复现**旧口径**（带 `hasOrigin` 的那把尺）：`demo/measure-leg127-line-curve.js` 自带一份森林实现，
            //     那一份**刻意保留**（它是"旧尺"的对照物，不是第二份生产实现）。
            fromTick: ticks.length ? Math.min(...ticks) : null,
            toTick: ticks.length ? Math.max(...ticks) : null,
            ids,
            // ★本棵树的**多因点**（`links.up` ≥ 2 的节点）——只有这一处能看出"好几件因促成一件"。
            joins,
        });
    }
    return { nodes, trees, danglingParents };
}

/**
 * 立线：**一条线 = 一棵树**（口径同量测脚本的乙案）。
 * ★判据只有两格：`allClosed && eventCount >= n`——原先那个 `hasOrigin` 合取项本笔删了
 *   （实测**永远为真**：50 份真账 555 棵树里为假 0 棵），那一格字段本身也同批删了（零读者）。
 * 排序：收口轮次**新 → 旧**（越近的越接得上），同轮按根 id（确定性兜底）。
 * @returns {Array<{根,头,尾,起,收,件,多因,ids,树}>}
 */
export function linesOf(world, { n = LINE_MIN_EVENTS, top = LINES_TOP } = {}) {
    const { nodes, trees, danglingParents } = forestOf(world);   // ★只建一次表（逐条重建＝自找那个性能病）
    const lines = [];
    for (const tr of trees) {
        if (!tr.allClosed || tr.eventCount < n) continue;
        const evIds = tr.ids.filter((id) => nodes.get(id)?.kind === 'event');   // 按表里的 kind 判，不靠 id 前缀猜
        const withTick = evIds.map((id) => ({ id, tick: eventBornTick(id) }));
        const known = withTick.filter((x) => Number.isFinite(x.tick));
        // 尾 = 这条线里**出生最晚的那件事件**（它是这段因果的落点/收场）
        const tail = known.length
            ? known.reduce((a, b) => (b.tick > a.tick || (b.tick === a.tick && b.id > a.id) ? b : a))
            : null;
        const head = tr.root;
        const headTick = eventBornTick(head);
        const headNode = nodes.get(head);
        const tailNode = tail ? nodes.get(tail.id) : null;
        lines.push({
            根: head,
            头: headNode?.title ?? '',
            尾: tailNode?.title ?? '',
            起: Number.isFinite(headTick) ? headTick : (tr.fromTick ?? 0),
            收: tail ? tail.tick : (tr.toTick ?? 0),
            件: tr.eventCount,
            多因: tr.joins.length,
            ids: tr.ids,
        });
    }
    lines.sort((a, b) => (b.收 - a.收) || (a.根 < b.根 ? -1 : a.根 > b.根 ? 1 : 0));
    return { lines: lines.slice(0, top), total: lines.length, danglingParents, trees: trees.length };
}

/**
 * ★★★leg132：**全史索引**——把"这一轮在动的事"相关的那几条线挑到前面，其余照旧。
 *
 * 【治的是什么病】（实测，不是推演）
 *   `LINES_TOP = 40`，而干净合成世界实测**每 500 轮就立出 24.4～40.6 条线**
 *   ⇒ **一屏只装得下约 500 轮**。一万轮时账上 488～812 条线，模型只看得见 **40 条（5%～8%）**；
 *   而今天它是**按"收口轮次"从新到旧**截的 ⇒ **第 3,000 轮立的那条线，在模型眼里从来没有存在过**——
 *   它连"地图被截过"都不知道。这正是"长跑失忆"在地图这一层的形状。
 *
 * 【口径】**相关优先，其余照旧**：相关的排前面，两组**各自内部**仍按收口轮次"新→旧"
 *   （`linesOf` 已经排好，稳定排序保住它）⇒ **一条相关线都没有时，输出与今天逐字相同**（旧世界零漂移）。
 *   ★相关性**只用账上真有的结构**：这条线里有没有"还没收口的事/谋划"，
 *     或有没有哪件事波及到"正在动的人"（未决事件的波及名单 ∪ 在飞盘算的属主）。
 *     不猜、不模糊匹配、不引语义模型。
 *   ★它是**纯函数、只看账**（不依赖"这一轮谁上场"那种调用方状态）⇒ **出包那一侧与校验那一侧算得出同一份**，
 *     不会出现"包里有这条线、点名却被判非法"那种把整步拒掉的错位。
 * @returns {{lines:Array, total:number}} `total` = **账上真有几条**（★不许丢：它就是"地图被截过"的读数）
 */
export function pickLinesForPack(world, { top = LINES_TOP } = {}) {
    const all = linesOf(world, { top: Infinity });
    // 归档过的事件也要认（`linesOf` 的节点表跨热账与大事纪；这里照同一条口径取波及名单）
    const evById = new Map();
    for (const m of (world?.milestones || [])) for (const r of (m.rows || [])) if (!evById.has(r.id)) evById.set(r.id, r);
    for (const e of (world?.events || [])) evById.set(e.id, e);
    const openEv = new Set();
    for (const e of (world?.events || [])) if (!e?.closed) openEv.add(String(e.id));
    const openAg = new Set();
    for (const a of (world?.agendas || [])) if (!a?.closed) openAg.add(String(a.id));
    const inPlayEnt = new Set();
    for (const e of (world?.events || [])) if (!e?.closed) for (const r of (e.ripples || [])) inPlayEnt.add(String(r));
    for (const a of (world?.agendas || [])) if (!a?.closed && a.owner) inPlayEnt.add(String(a.owner));

    const marked = all.lines.map((ln) => {
        let ok = false;
        for (const id of (ln.ids || [])) {
            const sid = String(id);
            if (openEv.has(sid) || openAg.has(sid)) { ok = true; break; }
            const ev = evById.get(id);
            if (!ev) continue;
            if (ev.source?.ref && (openEv.has(String(ev.source.ref)) || openAg.has(String(ev.source.ref)))) { ok = true; break; }
            if ((ev.ripples || []).some((r) => inPlayEnt.has(String(r)))) { ok = true; break; }
        }
        return { ln, ok };
    });
    marked.sort((a, b) => (a.ok ? 0 : 1) - (b.ok ? 0 : 1) || (b.ln.收 - a.ln.收));
    return { lines: marked.slice(0, top).map((x) => x.ln), total: all.total };
}

/**
 * ★★★leg151：**这一轮该预取哪几条线的经过**（引擎自己决定，不问模型）。
 *
 * 【为什么是引擎挑】用户逐字判死的那条（「**下一轮才给查询结果就是垃圾**」）不是"点名"这个做法不好，
 *   是**"模型发起的取回"这一整类**——一轮只有一次调用，模型在输出里提问＝在交卷那一刻提问。
 *   ⇒ 当轮到位的唯一形态是：**引擎在出包之前就把料装进去**。
 *
 * 【依据是什么】`pickLinesForPack` 那四样（没结的事 · 在飞的盘算 · 来路指向它们的 · 被搅进去的人）
 *   ——**全是账上此刻的真状态**，不是"上一轮的输出"。
 *
 * 【★为什么要记住"递过哪几条"】正在走的线会**连着很多轮都在动**（实测一条线可以走 61～65 轮），
 *   不记的话它每轮都占满上界，**别人的线永远轮不到** ⇒ 账上记 `meta.linesShown`。
 *   ★但它**不删**：一条线可能第 40 轮又被提到，那时它该能再进来（不受"递过"影响）。
 *   ★★记性**只许记"包里真摆出去的那批"**，所以本函数**只返回"这一轮挑中什么"**，
 *     累计与去重由调用方按**实际进包的结果**去做（`pack.js` 那一处）——
 *     本函数若自作主张返回"累计后的记性"，就会在"挑中了、但没取到料"时留下**假记性**（本笔第一版的血证）。
 *
 * @param {object} world  世界账
 * @param {string[]} [alreadyShown]  账上记着的、已经递过的根 id（`meta.linesShown`）
 * @returns {string[]} 这一轮要取的根 id（已按"在动的排前面"、已跳过递过的、已封顶）
 */
export function pickLinesToPrefetch(world, alreadyShown = [], { top = LINES_PREFETCH_TOP } = {}) {
    const shown = (Array.isArray(alreadyShown) ? alreadyShown : []).map((x) => String(x)).filter(Boolean);
    const seen = new Set(shown);
    // ★取数的口与"地图那一栏"共用同一个函数（`pickLinesForPack`）——一处定义，两处消费。
    //   它已经把"在动的排前面"做完了；这里只做两件它不管的事：**跳过记过的**、**封顶**。
    const picked = pickLinesForPack(world, { top: Infinity });
    const roots = [];
    for (const line of (picked.lines || [])) {
        const rootId = line?.根 != null ? String(line.根) : '';
        if (!rootId) continue;               // 没有根 id 的线：不预取（不许编一个号出来）
        if (seen.has(rootId)) continue;      // ★递过的让位
        if (roots.length >= top) break;      // 上界
        roots.push(rootId);
        seen.add(rootId);
    }
    return roots;
}

/** 一栏一条线的**行文**（模型读的那一行）：`<根id> <头> 第<起>轮 → <件>件 → <尾> 第<收>轮`。 */
export function lineTextOf(line) {
    const head = String(line?.头 ?? '').trim();
    const tail = String(line?.尾 ?? '').trim();
    const n = Number(line?.件) || 0;
    const many = Number(line?.多因) > 0 ? ` ·合流${line.多因}` : '';
    return `${line?.根} ${head} 第${line?.起}轮 → ${n}件 → ${tail || '（收口那件没留标题）'} 第${line?.收}轮${many}`;
}

/** 根 id → 线（"点名取回"要按根查；也是栏内去重的唯一依据）。 */
export function lineIndexOf(lines) {
    const idx = new Map();
    for (const ln of Array.isArray(lines) ? lines : []) if (ln?.根 && !idx.has(ln.根)) idx.set(ln.根, ln);
    return idx;
}

/**
 * 净化"模型点名的线"：**只收这一轮账上真算得出来的根 id**，其余落 `missed`
 * （★与 `sanitizeScaleRequests` 同一条纪律：账上没有的，**不许替它造一条出来**）。
 * @returns {{ok:string[], missed:string[]}}  —— `ok` 按点名序去重（先到先得）
 */
export function sanitizeLineRequests(refs, index) {
    const idx = index instanceof Map ? index : lineIndexOf(index);
    const ok = [];
    const missed = [];
    for (const raw of (Array.isArray(refs) ? refs : [])) {
        const id = String(raw ?? '').trim();
        if (!id) continue;
        if (idx.has(id)) { if (!ok.includes(id) && ok.length < LINE_ONDEMAND_TOP) ok.push(id); continue; }
        if (!missed.includes(id) && missed.length < LINE_ONDEMAND_TOP) missed.push(id);
    }
    return { ok, missed };
}

/**
 * 模型点名的那几条线的**经过**（一轮的补料）。
 * ★可点名的集合＝**这一轮真递出去的那一批线**（同一个 `linesOf` 默认上界）——没在包里的，
 *   不算"账上没有"也不算"有"：**只收你眼前见过的那一批**（与刻度表那条同一条纪律）。
 * @returns {string[]|null}  没点名 / 一条都对不上 ⇒ null（键不出现）
 */
export function buildLineDetails(world, refs, { charTop = LINE_DETAIL_CHAR_TOP } = {}) {
    const wanted = Array.isArray(refs) ? refs.filter((x) => typeof x === 'string' && x.trim()) : [];
    if (!wanted.length) return null;
    const { lines } = linesOf(world, { top: Infinity });
    const { ok } = sanitizeLineRequests(wanted, lineIndexOf(lines));
    if (!ok.length) return null;
    const out = [];
    for (const id of ok) {
        const text = buildLineDetail(world, id, { charTop });
        if (text) out.push(`${id}：${text}`);
    }
    return out.length ? out : null;
}

/**
 * 一条线的**经过**（因果序：出生轮升序 ⇒ 老在前，与"往事"那一栏同一个读法）。
 * 太长 ⇒ **头尾各留 `LINE_DETAIL_KEEP` 件，中间如实写"略 N 件"**
 *   （★不许假装这就是全部——本仓对"悄悄截断"的恨，见 `trimPack` 的 `trimmed` 那一段）。
 * @returns {string|null}  这条线一条都没有 ⇒ null（键不出现）
 */
export function buildLineDetail(world, rootId, { charTop = LINE_DETAIL_CHAR_TOP, keep = LINE_DETAIL_KEEP } = {}) {
    const { nodes } = forestOf(world);
    const root = nodes.get(rootId);
    if (!root) return null;
    // 从根往下收（只用 `source` 那条边 ⇒ 与划分同一把尺）
    const children = new Map();
    for (const nd of nodes.values()) {
        if (!nd.parentId) continue;
        if (!children.has(nd.parentId)) children.set(nd.parentId, []);
        children.get(nd.parentId).push(nd.id);
    }
    const ids = [];
    const seen = new Set([rootId]);
    let frontier = [rootId];
    while (frontier.length) {
        const next = [];
        for (const id of frontier) {
            ids.push(id);
            for (const c of children.get(id) || []) if (!seen.has(c)) { seen.add(c); next.push(c); }
        }
        frontier = next;
    }
    const rows = ids.map((id) => ({ id, tick: eventBornTick(id), title: nodes.get(id)?.title ?? '' }))
        .sort((a, b) => (a.tick - b.tick) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (!rows.length) return null;
    const cell = (r) => `[${Number.isFinite(r.tick) ? r.tick : '?'}]${r.title}`;
    const parts = rows.length <= keep * 2
        ? rows.map(cell)
        : [...rows.slice(0, keep).map(cell), `……（中间 ${rows.length - keep * 2} 件略）`, ...rows.slice(-keep).map(cell)];
    let text = parts.join(' → ');
    if (text.length > charTop) text = `${text.slice(0, charTop)}……（本行按字符上限截断）`;
    return text;
}
