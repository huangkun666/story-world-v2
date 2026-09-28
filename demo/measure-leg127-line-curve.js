// story-world-v2/demo/measure-leg127-line-curve.js
// ★这件事：在**干净的合成世界**上量「够不够格立一条故事线」的那个数字 N（理论骨架 §8.3 那五步）。
//
// 为什么必须用合成世界（理论稿 §0.2 ＋ 用户 2026-09-25 原话）：
//   「现在的这个跑出来的账本没有什么权威性的，因为是**多个版本一起跑出来的产物**，所以我们先进行理论分析」
//   ⇒ 那份真账是**多版本叠出来的事故现场**（指针悬空 · 事件表被剪 · 里程碑丢来路），
//     拿它定 N ＝ **把事故当标准**。本脚本**不读任何存量账**：世界从第 1 轮起、单一版本、因果完整。
//
// ★术语（本仓 `STATE.md` §2.5：说人话；这里另有一处**同名冲突**必须挑明，否则读数没法跟人对话）：
//   · **「一条线」**＝理论稿里的**「纪」**＝从一个根长起来、有因果连接的一串节点（事件 ＋ 盘算）。
//     ⚠ **本仓代码里的「纪」是另一个意思**——它是"大事纪／里程碑"（`src/render.js:2278` 那句
//       「展开这一纪的条目」、里程碑 id `m_<n>` 见 `src/settle.js:690`）。
//       ⇒ **同一个字两个意思** ⇒ 本脚本一律写「线」，**不写「纪」**。
//   · **「树」**＝把所有节点按"来路"连起来之后，互不相交的一棵一棵。
//     为什么天然分得开（理论稿 §3 性质 C）：**每个节点只有一个来路**（单亲）＋ **不可能成环** ⇒ 天然划分。
//
// ★本脚本量什么（照 §8.3）：
//   ① 造一个干净世界（本文件自己生成，确定性、零随机源）；
//   ② 跑够长；③ 对 N=1…10 各算一遍：立出几条线 · 每条线平均含几件事 · 覆盖多少轮 · 素材多长；
//   ④ 交叉看：**线的总条数 ÷ 卷数**；⑤ 出表。
//
// ★★**本脚本最要紧的一句诚实**（读表前先读这句）：
//   曲线是**这台生成器那个形状**的函数——换个世界形状，曲线会变。
//   所以本脚本**扫三档"起根密度"**（很少起新头／中等／不断冒新头），给的是**三条曲线**，
//   不是"这个世界的曲线"。表里同时打出生成器自己的结构读数（起了几个根、挂了几次），
//   让人能看出"喂进去的是什么形状"。
//
// 跑法：
//   node demo/measure-leg127-line-curve.js              正式（1500 轮 × 三档）
//   node demo/measure-leg127-line-curve.js --ticks=200  快跑（调生成器用）
import { readFileSync } from 'node:fs';
import { runTick } from '../src/tick.js';
import { rotateChronicle, PROPOSED_LIMITS } from '../src/storage.js';
import { scanDanglingRefs } from '../src/observatory.js';
import { EVENT_CAP_PER_TICK } from '../src/limits.js';

const EXTRACT_FIX = JSON.parse(readFileSync(new URL('../test/fixtures/extract-samples.json', import.meta.url), 'utf8'));

// ───────────────────────── 0. 命令行 ─────────────────────────
const argv = Object.fromEntries(process.argv.slice(2).map((s) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(s);
    return m ? [m[1], m[2] ?? 'true'] : [s, 'true'];
}));
const TICKS = Number(argv.ticks ?? 1500);
const N_MAX = Number(argv.nmax ?? 10);
const ONLY = argv.only ?? null;          // --only=1 只跑第 1 档（调生成器用）
const TRACE = argv.trace === 'true';     // --trace 每 100 轮打一次用时与账本规模（找性能热点用）

// ───────────────────────── 1. 干净世界的起点 ─────────────────────────
// 形状照 `test/fixtures/tree-world.json`（那是判据在跑的、已验的最小合法账），
// 只把班底扩到 8 人、驻点扩到 4 个——够长出多条互不相交的线。
const POSITIONS = ['主帐', '前线', '粮道', '边关'];
const CAST = ['主帅', '军师', '小校', '粮官', '斥候', '副将', '使节', '匠头'];

function buildSeedWorld() {
    const entities = CAST.map((name, i) => ({
        id: `e${i + 1}`, kind: 'character', name, location: POSITIONS[i % POSITIONS.length],
    }));
    const weights = Object.fromEntries(entities.map((e) => [e.id, 0.5]));   // K2 真公式起应在 [0,1]
    return {
        version: 1,
        context: {
            world: '测量用的合成世界（单一版本 · 从第 1 轮起 · 因果完整）',
            tension: 0.5,
            positions: POSITIONS,
        },
        entities,
        weights,
        agendas: [],
        events: [{ id: 'ev_root', title: '边关起了变故', source: { type: 'state' }, position: '边关', ripples: [], closed: false }],
        chronicle: [],
        meta: { tick: 0 },
    };
}

// ───────────────────────── 2. 生成器（确定性 · 零随机源） ─────────────────────────
// 每轮四件事，都**只提议契约允许的形状**（宁可少长，也不要被拒——被拒会在编年里留警告，
// 世界就不"干净"了）：
//   ① 推进：挑"推进一步之后不会立刻满步结算"的在飞盘算（`progress + 2 <= maxSteps`），
//      每条配一件 `plot` 源事件 ⇒ 事件挂在盘算下面（**纵深 ＋ 分叉**的主要来源）；
//   ② 新生：每轮起若干条盘算，源在三种里挑——`state`（**新的一棵树**：由处境而生，没有爹）／
//      `parent`（挂到一条已有线上：长纵深）／`event`（从某件事长出新线）；
//   ③ 起根事件：每 `freshRootEvery` 轮冒一件 `state` 源事件 ⇒ 这是 §4 来源① 那个"碎"的旋钮；
//   ④ 收场：每 `closeEvery` 轮收掉几件老事（`eventClosures`）⇒ "有收口"那个条件的来源。
//
// ★闸（`src/limits.js` 出厂值，本脚本**不抬档**：量的是出厂配置下的形状）：
//   每轮事件 ≤6 · 每轮新生 ≤3 · 顶层大计 ≤15 · 在飞大计 ≤20。
function makeStepGen(p) {
    return function stepGen(t, world) {
        const open = world.agendas.filter((a) => !a.closed);
        const hotEv = world.events.filter((e) => !e.closed);
        const actions = [], newEvents = [], agendaAdvances = [], newAgendas = [];
        const agendaCancels = [], newEntities = [], entityFates = [], eventClosures = [];

        // ① 推进（每条约配一件 plot 事件）
        // ★这里踩过一个坑，留档（第一版就是这么错的）：我起先把"推进一步就会满步结算"的盘算**滤掉不推**，
        //   理由是想避开"plot 事件指向一条刚结算的盘算"。后果是**世界死锁**：20 条在飞盘算全都爬到
        //   `progress = maxSteps − 1` 就卡住（推不动、也结算不了）⇒ 名额永不释放 ⇒ 新生全被拒 ⇒
        //   200 轮只长出 80 件事件（＝20 条 × 4 步，一个不多）。**满步结算是要的，不是要躲的**：
        //   它正是"收口"与"释放名额"的来源。⇒ 改法：要结算的也推，只是**不为它配 plot 事件**
        //   （那一件留给下一件不结算的推进）——事件与推进解耦，两侧都不越契约。
        const toAdvance = open.slice(0, p.advancePerTick);
        for (const [i, a] of toAdvance.entries()) {
            const pos = POSITIONS[i % POSITIONS.length];
            agendaAdvances.push({ agendaId: a.id, step: `第 ${a.progress + 1} 步`, stage: '推进' });
            actions.push({ entity: a.owner, verb: '推进', position: pos });
            if (a.progress + 1 < a.maxSteps && newEvents.length < EVENT_CAP_PER_TICK) {
                newEvents.push({
                    title: `${a.goal}·第 ${a.progress + 1} 步`,
                    source: { type: 'plot', ref: a.id },
                    position: pos,
                    ripples: [a.owner],
                });
            }
        }

        // ② 起根事件（"处境不断冒新头"那个旋钮）
        if (p.freshRootEvery > 0 && t % p.freshRootEvery === 0 && newEvents.length < EVENT_CAP_PER_TICK) {
            newEvents.push({
                title: `处境生变（第 ${t} 轮）`,
                source: { type: 'state' },
                position: POSITIONS[t % POSITIONS.length],
                ripples: [],
            });
        }

        // ③ 涟漪事件（把新事挂到已有的某件事上 ⇒ 事件→事件的链）
        if (p.rippleEvery > 0 && t % p.rippleEvery === 0 && hotEv.length && newEvents.length < EVENT_CAP_PER_TICK) {
            const up = hotEv[t % hotEv.length];
            newEvents.push({
                title: `余波（第 ${t} 轮）`,
                source: { type: 'ripple', ref: up.id },
                position: up.position,
                ripples: [],
            });
        }

        // ④ 新生盘算（源在三种里挑；`state` 源 ⇒ 新的一棵树）
        // ★主家只从"手上有在办盘算"的人里挑——**这是被静默门逼出来的**（`src/gate.js:76`）：
        //   门上写着"手上没在办的事 ∧ 3 轮没出手 ∧ 没人点名 ⇒ 这个人的提议整批丢掉"。
        //   随手挑一个闲人当主家 ⇒ 那条新生**静默消失**（世界上一点痕迹都没有），
        //   读数就会莫名其妙地少，而且**看起来像引擎坏了**。挑活跃的人 ⇒ 提案一定落地。
        const activeOwners = [...new Set(open.map((a) => a.owner))];
        const topLevel = open.filter((a) => !a.parentId).length;
        for (let b = 0; b < p.birthPerTick; b++) {
            // ★**先把闸让开，再提议**（否则世界不"干净"）：`在飞 ≤20` / `顶层 ≤15` 是出厂闸，
            //   撞上去的提议会被拒、还会在编年里留一条"裁定"⇒ 账本就不是"因果完整"那份了。
            //   我第一版没让，实测 **701 条警告**（全是"盘算大厦顶"）——那种世界量出来的曲线不能用。
            if (open.length >= p.openSoftCap) break;
            const seq = t * p.birthPerTick + b;
            const owner = activeOwners.length ? activeOwners[seq % activeOwners.length] : `e${(seq % CAST.length) + 1}`;
            let source;
            if (p.agendaRootEvery > 0 && seq % p.agendaRootEvery === 0) {
                if (topLevel >= p.topSoftCap) continue;                        // 顶层名额不够 ⇒ 这一条改挂到已有线上
                source = { type: 'state' };                                    // 新头：顶层盘算，自成一根
            } else if (open.length && seq % 2 === 0) {
                source = { type: 'parent', ref: open[seq % open.length].id };  // 挂到一条已有线上
            } else if (hotEv.length) {
                source = { type: 'event', ref: hotEv[seq % hotEv.length].id }; // 从某件事长出新线
            } else {
                source = { type: 'state' };
            }
            newAgendas.push({ entity: owner, goal: `谋划第 ${seq} 号`, visibility: 'known', source, maxSteps: p.maxSteps });
        }

        // ⑤ 收场（"有收口"那个条件）
        if (p.closeEvery > 0 && t % p.closeEvery === 0) {
            const old = hotEv.filter((e) => bornTickGuess(e, t) <= t - p.closeAge).slice(0, 4);
            for (const e of old) eventClosures.push({ event: e.id, why: '这一段已经讲完了' });
        }

        return { actions, newEvents, agendaAdvances, newAgendas, agendaCancels, newEntities, entityFates, eventClosures };
    };
}

// `closeAge` 用"事件 id 里的轮次"估年龄（引擎发号 `ev_<轮次>_<位次>`，`src/settle.js`）。
function bornTickGuess(ev, fallback) {
    const m = /^ev_(\d+)_/.exec(ev?.id ?? '');
    return m ? Number(m[1]) : fallback;
}

// 三档"起根密度"——**只动这一个旋钮**，其余参数三档完全相同（这样比较才干净）。
const PROFILES = [
    { name: '甲 · 很少起新头', freshRootEvery: 60, agendaRootEvery: 30 },
    { name: '乙 · 中等起新头', freshRootEvery: 15, agendaRootEvery: 8 },
    { name: '丙 · 不断冒新头', freshRootEvery: 4, agendaRootEvery: 3 },
].map((p) => ({
    birthPerTick: 1,        // ≤「每轮新生」出厂 3
    advancePerTick: 2,      // ＋ 起根/涟漪 ⇒ 每轮事件 ≤4（出厂闸 6）
    maxSteps: 3,            // 走两步就满步结算 ⇒ 名额流转得动（不然 20 个在飞名额一满，新生全被拒）
    rippleEvery: 20,
    closeEvery: 6,
    closeAge: 12,
    openSoftCap: 14,        // 在飞留 6 个空位（出厂闸 20）
    topSoftCap: 10,         // 顶层留 5 个空位（出厂闸 15）
    ...p,
}));

// ★编年轮转的跨度阈值——**这里是测量台自己的选择，不是生产的值**，必须说清楚：
//   生产是 500 轮（`PROPOSED_LIMITS.ticks`）。本脚本压到 150，**只为一件事**：让编年别长大到
//   把包撑过预算（一撑过，`src/pack.js:1234` 那个"逐行装往事、每行真量一次整包"的循环
//   就每轮空转上千次 ⇒ 单轮 15ms → 580ms，见 `--trace`）。**它不影响本脚本要量的东西**：
//   森林是从**事件与盘算**切出来的，编年只是渲染行；轮转剥掉的是账本里的冗余，链条一行不动
//   （`src/storage.js` 文件头那句"割断的是账本里的冗余，不是链条"）。
//   ⚠ 因此：**本脚本报的"卷数"只在这个压低的阈值下成立，不能当生产的卷数用**——
//     生产的卷数另有发现（见文件末尾那段）。
const ROTATE_SPAN = Number(argv.rotatespan ?? 150);

// ───────────────────────── 3. 森林：把账本切成互不相交的树 ─────────────────────────
// ★本仓**没有**这个函数（`src/chain.js` 的 `expandChain` 只能从一个根展开；`connectedComponents`
//   住在 demo 里、只收未决事件、还掺了两种非来路耦合 ⇒ 用它会把几棵树并成一棵、低估树数）。
//   所以这里自己写。节点三处来路都读：
//     · 热账事件 `world.events`
//     · ★**已归档事件** `milestones[].rows`——归档会把事件从热账**删掉**（`src/settle.js:726`），
//       来路只活在 `rows` 里（leg111 才加的格；旧账没有 ⇒ 旧账在归档那一步**断链**）
//     · 盘算 `world.agendas`（**永不归档**，两条腿寿命不同）
function parentOfEvent(e) {
    const st = e?.source?.type, ref = e?.source?.ref;
    if (st === 'ripple' && ref) return ref;    // 来路是另一件事
    if (st === 'plot' && ref) return ref;      // 来路是一条盘算
    return null;                               // state / seed / dialogue ⇒ 根（由处境而生等）
}

function parentOfAgenda(a) {
    const st = a?.source?.type, ref = a?.source?.ref;
    // ★优先 `source.ref`：父结算之后 `parentId` 会被删掉（`src/settle.js:565/616`），`source` 留着
    if (st === 'parent' && ref) return ref;
    if (st === 'event' && ref) return ref;
    if (a?.parentId) return a.parentId;        // 老账／夹具只有 parentId 没有 source
    return null;                               // state 源或无源 ⇒ 根
}

function forestOf(world, born) {
    const nodes = new Map();   // id → { id, kind, title, parentId, rootType, closed }
    for (const e of world.events || []) {
        nodes.set(e.id, {
            id: e.id, kind: 'event', title: e.title ?? '', parentId: parentOfEvent(e),
            rootType: e.source?.type ?? '?', closed: !!e.closed, archived: false,
        });
    }
    for (const m of world.milestones || []) {
        for (const r of m.rows || []) {
            if (nodes.has(r.id)) continue;
            nodes.set(r.id, {
                id: r.id, kind: 'event', title: r.title ?? '', parentId: parentOfEvent(r),
                rootType: r.source?.type ?? '?', closed: true, archived: true,
            });
        }
    }
    for (const a of world.agendas || []) {
        nodes.set(a.id, {
            id: a.id, kind: 'agenda', title: a.goal ?? '', parentId: parentOfAgenda(a),
            rootType: a.source?.type ?? (a.parentId ? 'parent' : '?'), closed: !!a.closed, archived: false,
        });
    }
    // 来路指向账上没有的 id ⇒ 悬空（算作根，单独计数——这是"账不干净"的读数，不许悄悄吞掉）
    let danglingParents = 0;
    for (const n of nodes.values()) {
        if (n.parentId && !nodes.has(n.parentId)) { danglingParents += 1; n.parentDangling = true; n.parentId = null; }
    }
    // 子表 → 从每个根 BFS 出一棵树（单亲 ⇒ 天然划分，每个节点恰好进一棵）
    const children = new Map();
    for (const n of nodes.values()) {
        if (!n.parentId) continue;
        if (!children.has(n.parentId)) children.set(n.parentId, []);
        children.get(n.parentId).push(n.id);
    }
    const trees = [];
    for (const n of nodes.values()) {
        if (n.parentId) continue;                       // 不是根，跳过
        const ids = [];
        let frontier = [n.id], height = 0, maxChildren = 0;
        while (frontier.length) {
            const next = [];
            for (const id of frontier) {
                ids.push(id);
                const ch = children.get(id) || [];
                if (ch.length > maxChildren) maxChildren = ch.length;
                next.push(...ch);
            }
            if (next.length) height += 1;
            frontier = next;
        }
        const evIds = ids.filter((id) => nodes.get(id).kind === 'event');
        const ticks = ids.map((id) => born.get(id)).filter((v) => Number.isFinite(v));
        // ★★★修订（与 `src/lines.js` 的 `forestOf` **同批、同一条规矩**——两把尺子是本仓最忌的事）：
        //   **"起点"不参与"全收口"这一格**。根若是 `state`／`seed` 源的事件，它是**链条的起点、不是待办的事**，
        //   而且引擎自己那一圈**永远不收它**（`settle.js` 第 378 行只扫 `ripple`）⇒
        //   照老口径，凡挂在"处境／种子"上的树**永远立不成线**（真模型 60 轮实跑实测到了）。
        //   ★旧口径一字不改地另存 `allNodesClosed`：要复现老曲线随时能复现。
        const allNodesClosed = ids.every((id) => nodes.get(id).closed);
        const rootIsStart = n.kind === 'event' && (n.rootType === 'state' || n.rootType === 'seed');
        trees.push({
            root: n.id,
            rootKind: n.kind,
            rootType: n.rootType,
            rootIsStart,
            nodeCount: ids.length,
            eventCount: evIds.length,
            height,
            maxChildren,
            allClosed: rootIsStart ? ids.every((id) => id === n.id || nodes.get(id).closed) : allNodesClosed,
            allNodesClosed,
            hasClosed: ids.some((id) => nodes.get(id).closed),
            hasOrigin: n.kind === 'agenda' ? n.rootType !== '?' : true,   // 根自己带 source ⇒ 有来路
            fromTick: ticks.length ? Math.min(...ticks) : null,
            toTick: ticks.length ? Math.max(...ticks) : null,
            span: ticks.length ? Math.max(...ticks) - Math.min(...ticks) : 0,
            ticks,
            ids,
            // "素材"＝这条线里所有事件标题 ＋ 盘算目标，字数之和。
            // ★它是**摘要的原料**，不是摘要长度——摘要多长要模型写出来才知道（不许替它估）。
            material: ids.reduce((s, id) => s + (nodes.get(id).title ?? '').length, 0),
        });
    }
    return { nodes, trees, danglingParents };
}

// ───────────────────────── 4. 两条判据（理论稿 §8.1 的甲案／乙案） ─────────────────────────
// 甲案（形状口径）：**有分支或有纵深**就算有形状。
const shapeOK = (tr) => tr.height >= 2 || tr.maxChildren >= 2;
// 乙案（故事口径）：**有来路 ＋ 有收口 ＋ 中间经历过 ≥N 件事**。
const storyOK = (tr, N) => tr.hasOrigin && tr.allClosed && tr.eventCount >= N;

function summarize(trees, keep) {
    const hit = trees.filter(keep);
    const decided = trees.filter((tr) => tr.eventCount > 0 || tr.nodeCount > 1);   // 分母：值得立线的树
    const covered = new Set();
    for (const tr of hit) for (const tk of tr.ticks) covered.add(tk);
    const avg = (f) => (hit.length ? hit.reduce((s, tr) => s + f(tr), 0) / hit.length : 0);
    return {
        count: hit.length,
        avgEvents: avg((tr) => tr.eventCount),
        avgSpan: avg((tr) => tr.span),
        avgMaterial: avg((tr) => tr.material),
        coveredTicks: covered.size,
        decided: decided.length,
    };
}

// ───────────────────────── 5. 驱动循环（★照生产来：编年超阈值就轮转入卷） ─────────────────────────
// ★★这里踩过一个大坑，留档（值一条）：
//   我第一版直接用 `src/smoke.js` 的 `runSmoke` 跑，还顺手写了个"循环调 `rotateChronicle` 数卷数"。
//   结果 **400 轮跑了 155 秒**（切树只花 2ms ⇒ 全花在引擎上），推算 1500 轮要半小时以上。两条真因：
//     ① **`runSmoke` 不轮转编年** ⇒ 合成世界的编年**无限增长**，而引擎每一轮都要把整本往事过一遍
//        （`buildEvolutionPack` 的料里就有往事）⇒ 单轮成本随轮数线性涨 ⇒ 总成本 **O(轮数²)**。
//        ★**这不只是"慢"，是"不真"**：真机上编年**从来不会长过阈值**——`rotateChronicle`
//        每轮把它剥到跨度 ≤500（`src/storage.js:81`）⇒ 我那份"跑得越久越贵"的世界，
//        **在形状上就不是生产里那个世界**。
//     ② 我那个"循环剥卷数"的写法**口径也错**：`rotateChronicle` 一次只剥一段、且剥完保证剩余跨度 ≤阈值
//        ⇒ 对一份不再生长的世界，第二次调用必然返回 null ⇒ **永远只能数出 0 或 1**。
//        生产里的卷是**随时间长出来**的（每跨过一次阈值剥一段）⇒ 只有**边跑边轮转**才数得对。
//   ⇒ 改法：**自己驱动 `runTick`**（不用 `runSmoke`），每轮跑完就照生产轮转一次，让编年有界。
//      好处拿到两个：**跑得快了**（编年有界）· **形状真了**（与生产的编年同一个量级）。
//      ★本脚本**没有**把攒下的卷用 `ledgerVolumes` 递回包里（生产是递的）——那是测量台的取舍：
//        递进去只影响"模型还看不看得见旧往事"，**不进账本、不改因果** ⇒ 对森林零影响；
//        而它每轮要把攒下的**所有**卷过一遍（卷数一轮涨一个）⇒ 又是一条 O(轮数²)。量结构不必付这笔钱。
//
// 为什么不用 `runSmoke` 也说得过去：它自己那份 `metrics`（包预算/门控/GC 上限）本脚本一个都不用，
// 本脚本要的只有"逐轮的世界账"与"逐轮的出生轮次"。
async function driveWorld(p) {
    const born = new Map([['ev_root', 0]]);
    const tRun0 = Date.now();
    let world = buildSeedWorld();
    const volumes = [];
    let warnings = 0;
    const warningSamples = new Set();

    for (let t = 1; t <= TICKS; t++) {
        const tTick = Date.now();
        const step = makeStepGen(p)(t, world);
        const transport = async () => ({ text: JSON.stringify(step) });
        const r = await runTick({
            transport, ssot: world, dialogue: '（继续）',
            extractCtx: EXTRACT_FIX.context,
            // ★**不递 `ledgerVolumes`**（生产里这一步是递的）——这是本测量台**唯一的偏差**，说清楚：
            //   递进去的作用只是"让模型还看得见已入卷的旧往事"，**不进账本、不改因果**，
            //   所以对"森林长什么样"零影响；而它每轮要把**攒下的所有卷**过一遍
            //   ⇒ 卷数一轮涨一个（见下面那条发现）⇒ 又是一条 O(轮数²)。量结构不需要付这笔钱。
        });
        if (!r.ok) throw new Error(`tick ${t} 失败: ${r.error}`);
        world = r.ssot;
        warnings += r.stage.warnings.length;
        for (const w of r.stage.warnings) if (warningSamples.size < 8) warningSamples.add(w);

        for (const a of world.agendas) if (!born.has(a.id)) born.set(a.id, t);
        for (const e of world.events) if (!born.has(e.id)) born.set(e.id, t);

        // ★照生产轮转：编年超阈值就剥一段入卷（剥的是账本里的冗余，链条不动）
        const { hot, volume } = rotateChronicle(world, { limits: { ticks: ROTATE_SPAN, bytes: Infinity }, volumeSeq: volumes.length + 1 });
        if (volume) { volumes.push(volume); world = hot; }
        if (TRACE && t % 100 === 0) {
            console.log(`    [trace] 第 ${t} 轮 · 本轮 ${Date.now() - tTick}ms · 累计 ${((Date.now() - tRun0) / 1000).toFixed(1)}s`
                + ` · 盘算 ${world.agendas.length}（在飞 ${world.agendas.filter((a) => !a.closed).length}）`
                + ` · 热事件 ${world.events.length} · 编年 ${world.chronicle.length} · 卷 ${volumes.length}`);
        }
    }
    return { world, born, volumes, warnings, warningSamples: [...warningSamples] };
}

// ───────────────────────── 6. 主流程 ─────────────────────────
const pad = (s, n) => String(s).padEnd(n, ' ');
const num = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');

async function runProfile(p) {
    const tRun = Date.now();
    const { world, born, volumes, warnings, warningSamples } = await driveWorld(p);
    const runMs = Date.now() - tRun;
    const tForest = Date.now();
    const { nodes, trees, danglingParents } = forestOf(world, born);
    const dangling = scanDanglingRefs(world);
    const forestMs = Date.now() - tForest;
    // 生成器"喂进去的形状"自证读数
    const roots = trees.length;
    const rootKinds = {};
    for (const tr of trees) {
        const k = `${tr.rootKind}:${tr.rootType}`;
        rootKinds[k] = (rootKinds[k] ?? 0) + 1;
    }
    const singles = trees.filter((tr) => tr.nodeCount === 1).length;
    return {
        p, world, born, nodes, trees, danglingParents, dangling, volumes, warnings, warningSamples,
        roots, rootKinds, singles, runMs, forestMs,
        chronicleRows: (world.chronicle || []).length,
        totalEvents: [...nodes.values()].filter((n) => n.kind === 'event').length,
        totalAgendas: [...nodes.values()].filter((n) => n.kind === 'agenda').length,
    };
}

function printProfile(r) {
    const { p } = r;
    console.log(`\n${'═'.repeat(78)}`);
    console.log(`档位 ${p.name}   （起根密度旋钮：事件每 ${p.freshRootEvery} 轮冒一件 · 盘算每 ${p.agendaRootEvery} 条起一个头）`);
    console.log(`${'═'.repeat(78)}`);
    console.log(`跑 ${TICKS} 轮 → 节点 ${r.nodes.size}（事件 ${r.totalEvents} · 盘算 ${r.totalAgendas}）`
        + ` · 编年 ${r.chronicleRows} 行 · 用时 ${(r.runMs / 1000).toFixed(1)}s ＋ 切树 ${r.forestMs}ms`);
    console.log(`树 ${r.roots} 棵 · 其中孤立单点 ${r.singles} 棵 · 悬空来路 ${r.danglingParents} 处`);
    console.log(`坏账扫描 scanDanglingRefs：${r.dangling.count} 处${r.dangling.count ? '（★不为 0 ⇒ 下面这些树数别信：账本身不干净）' : '（干净）'}`);
    console.log(`根的形状分布：${Object.entries(r.rootKinds).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
    console.log(`卷数 ${r.volumes.length}（在测量台阈值 ${ROTATE_SPAN} 轮下真剥出来的；★这个数只在这个阈值下成立，别当生产的卷数用）`);
    console.log(`引擎警告 ${r.warnings} 条${r.warnings ? '：' + r.warningSamples.join(' ｜ ') : '（干净）'}`);
    // ★判据成分拆开报——**不拆开就看不出是哪一条在起作用**：
    //   乙案那条"有来路 ＋ 有收口 ＋ ≥N 件事"是三个条件**相乘**，只报合起来的数，
    //   读表的人没法知道是"来路"卡掉的还是"收口"卡掉的（也就没法判断这个判据是不是合理）。
    const T = r.trees;
    const cOrigin = T.filter((tr) => tr.hasOrigin).length;
    const cClosed = T.filter((tr) => tr.hasOrigin && tr.allClosed).length;
    console.log(`判据成分（树 ${T.length} 棵）：有来路 ${cOrigin} · 有来路且全收口 ${cClosed}`
        + ` · ★孤立单点（理论稿 §5 丙级，**不立线**）${r.singles} ← 所以 \`N=1\` 那一行把这些也算进去了，看 N≥2 才合理论稿`);

    // ── 表一：N → 线的条数 ──
    console.log(`\n【表一】N → 立出几条线（乙案：有来路 ＋ 有收口 ＋ 事件数 ≥ N；甲案＝有分支或有纵深，不含 N）`);
    console.log(`${pad('判据', 10)}${pad('线的条数', 10)}${pad('平均含几件事', 14)}${pad('平均覆盖多少轮', 16)}${pad('素材字数', 10)}`);
    const a = summarize(r.trees, shapeOK);
    console.log(`${pad('甲案·形状', 10)}${pad(a.count, 10)}${pad(num(a.avgEvents), 14)}${pad(num(a.avgSpan), 16)}${pad(num(a.avgMaterial, 0), 10)}`);
    const rowsB = [];
    for (let N = 1; N <= N_MAX; N++) {
        const s = summarize(r.trees, (tr) => storyOK(tr, N));
        rowsB.push({ N, ...s });
        console.log(`${pad(`乙案 N=${N}`, 10)}${pad(s.count, 10)}${pad(num(s.avgEvents), 14)}${pad(num(s.avgSpan), 16)}${pad(num(s.avgMaterial, 0), 10)}`);
    }

    // ── 表二：N → 覆盖率 ──
    // ★分母＝这个世界**活过几轮**（第 0 轮到第 TICKS 轮，共 TICKS+1 个轮次）。
    //   第一版拿 TICKS 当分母，量出 **100.5%**——多出来的那 0.5 就是第 0 轮（起根事件住在那一轮）。
    //   留档：覆盖率这种东西一旦能超过 100%，整张表就没人信了。
    const TOTAL_TICKS = TICKS + 1;
    console.log(`\n【表二】N → 覆盖率（被立成线的那几轮 ÷ 这个世界活过的轮数 ${TOTAL_TICKS}）`
        + `\n＋ ★§8.3 第 4 步那个比值：这里用"**每 500 轮立出几条线**"——`);
    console.log('   为什么不用"线数 ÷ 卷数"（原话是那个）：真轮转量出来"卷"在稳态下是**一轮一卷**'
        + '（`splitOffOldest` 只剥到"剩余跨度 ≤ 阈值"为止，最小剥法 ⇒ 每轮各剥一段）。'
        + '见文件末尾那段发现。分母换成"500 轮"才是 §8.3 那句话的本意：'
        + '包里装得下约 500 轮往事，线就是跟它抢位置的东西。');
    console.log(`${pad('判据', 10)}${pad('覆盖轮次', 10)}${pad('覆盖率', 10)}${pad('线的条数', 10)}${pad('每500轮几条线', 14)}`);
    const cov = (s) => `${num((s.coveredTicks / TOTAL_TICKS) * 100, 1)}%`;
    const perVol = (s) => num((s.count * 500) / TICKS, 1);
    console.log(`${pad('甲案·形状', 10)}${pad(a.coveredTicks, 10)}${pad(cov(a), 10)}${pad(a.count, 10)}${pad(perVol(a), 12)}`);
    for (const s of rowsB) {
        console.log(`${pad(`乙案 N=${s.N}`, 10)}${pad(s.coveredTicks, 10)}${pad(cov(s), 10)}${pad(s.count, 10)}${pad(perVol(s), 12)}`);
    }
    console.log(`\n（分母：值得立线的树 ${a.decided} 棵 · 全部树 ${r.roots} 棵）`);
    return rowsB;
}

const t0 = Date.now();
console.log(`★§8 曲线 · 干净合成世界 · ${TICKS} 轮 × ${PROFILES.length} 档起根密度`);
console.log('★读表前先读这句：曲线是**生成器那个形状**的函数；三档＝三种"起根密度"，不是"这个世界的曲线"。');

// ── 卷数 ──
console.log(`\n★编年按生产的方式**边跑边轮转**（本脚本自己驱动 runTick，每轮跑完调一次 `
    + `src/storage.js 的 rotateChronicle），这样热账编年不会无限长——`
    + `★但**跨度阈值压到了 ${ROTATE_SPAN} 轮**（生产是 ${PROPOSED_LIMITS.ticks}），理由是包的成本，见文件里那段留档；`
    + `**它不影响本脚本要量的森林**（森林从事件与盘算切，编年只是渲染行）。`);
const all = [];
for (const [i, p] of PROFILES.entries()) {
    if (ONLY && String(i + 1) !== String(ONLY)) continue;
    all.push({ p, rows: printProfile(await runProfile(p)) });
}

// ── 一句话结论 ──
console.log(`\n${'═'.repeat(78)}\n【结论一句话】\n${'═'.repeat(78)}`);
for (const { p, rows } of all) {
    const first = rows[0], last = rows[rows.length - 1];
    console.log(`${p.name}：N=1 立 ${first.count} 条 → N=${N_MAX} 立 ${last.count} 条`
        + `（掉了 ${first.count ? num((1 - last.count / first.count) * 100, 0) : '—'}%）`
        + ` · 每条线平均含 ${num(last.avgEvents)} 件事`);
}
console.log(`\n用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
