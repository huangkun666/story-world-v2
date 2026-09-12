// story-world-v2/demo/measure-single-focus-ab.js
// leg33 · P-甲 出数装置：**「这个世界该不该有主线」两档口径对照**（用户令「先出数再拍：做甲/乙两档对照实验」）。
//
// 背景（leg32 §1 的核心发现）：真账 tick 53 的 **8 条在飞盘算 8/8 全挂在同一件事上**（6 条直接是死煞、
//   2 条是它的余波）。真因不是"模型不肯并行"，而是**引擎只递给模型"一个框"**——未决事件池里
//   同一条链占绝对多数 ⇒ 模型只能在那个框里给每个人分配角色。
//
// 本装置把两档口径做成**可对跑的机械差异**（都不改仓库真源）：
//   · 基线（现状）：真 `buildEvolutionPack` 出包，逐字节不动。
//   · 甲口径「事件驱动 + 给独立链头留位」：按 `source.ref` 求**连通分量**（纯图论、零判断），
//     分出「主线（最大分量）」与「各自的线（独立链头 = 账上没有任何东西以它为来路）」两栏，
//     独立链头**至少留 N 个位子**，不足时**如实在包里写"这一栏空着"**。
//   · 乙口径「多线并存是常态」：**不给"主线"这个框**——独立链头直接**排在最前、第一眼可见**，
//     让"同时有好几件事在走"成为默认读法（甲口径的默认读法是"一件大事 + 若干配角"）。
//
// ★改包不变式（否则甲口径可能悄悄丢信息 ⇒ 模型写出悬空 ref ⇒ 整步被拒，leg32 §1.4 候选丁的坑）：
//   未决事件 id 集合在改包前后必须**逐字相等**——本装置出数时自证，不通过即报红。
//
// 口径（现场纪律）：
//   · 真账**一律先读副本**；本脚本只 readFileSync，不写聊天文件、不写仓库真源。
//   · **模拟器不许模拟玩家的行动**（用户令）：跑 tick 时 dialogue 传空串 ⇒ moveFact=null ⇒ 玩家不动。
//     本装置也不代玩家落子（那会引入玩家变量、污染两臂对照）。
//   · 上游是"真模型"时按 ST 预设直读（密钥仅本机读、不打印）。
//
// 用法：
//   node demo/measure-single-focus-ab.js --struct              # 零模型成本：只出结构与分歧读数
//   node demo/measure-single-focus-ab.js --live --ticks 8      # 两臂同起点真模型对跑（基线 vs 甲 vs 乙）
//   node demo/measure-single-focus-ab.js --live --arms base,ja  # 挑臂跑
//   可选：--slots N（独立链头留位数，缺省 5）--world <聊天文件> --out <结果 json>
import { readFileSync, writeFileSync } from 'node:fs';
import { buildEvolutionPack, packTextOf } from '../src/pack.js';
import { runMainCall } from '../src/worldstep.js';
import { settleTick } from '../src/settle.js';
import { extractMove } from '../src/extract.js';

// ---------------- 参数 ----------------
const args = process.argv.slice(2);
const hasFlag = (n) => args.includes(n);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DEFAULT_WORLD = 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/chats/大荒z/大荒z - 2026-09-01@00h37m41s559ms.jsonl';
const WORLD_PATH = argVal('--world', DEFAULT_WORLD);
const SLOTS = Math.max(0, parseInt(argVal('--slots', '5'), 10) || 0);
const TICKS = Math.max(1, parseInt(argVal('--ticks', '8'), 10) || 8);
const ARM_NAMES = argVal('--arms', 'base,ja,bing').split(',').map((s) => s.trim()).filter(Boolean);
const OUT_PATH = argVal('--out', '');
const LIVE = hasFlag('--live');
const STRUCT = hasFlag('--struct') || !LIVE;   // 缺省 = 只出结构（零成本）；要真模型必须显式 --live

// ---------------- 读真账（首行元数据头 = 热账） ----------------
function loadRealWorld(path) {
    const raw = readFileSync(path, 'utf8');
    const nl = raw.indexOf('\n');
    const header = JSON.parse(nl < 0 ? raw : raw.slice(0, nl));
    const box = header?.chat_metadata?.story_world_v2;
    if (!box?.world) throw new Error(`chat_metadata.story_world_v2.world 缺失：${path}`);
    return box.world;
}

// ---------------- ★连通分量（纯图论、零判断、确定性） ----------------
// 节点 = 未决事件 id。三种边（全部是"账上已有的引用关系"，不发明语义）：
//   ① source.ref：ripple 源指上游事件；plot/state 源 ref 可能指事件（也可能指盘算/其他，非事件即忽略）
//   ② 共享波及实体：两个事件的 ripples 交集非空 ⇒ 它们牵动同一批人 ⇒ 同一场局
//   ③ 同源盘算：两个事件被同一在飞盘算引用（agenda.source.ref）⇒ 同一盘算的手笔
//     （盘算自身与它源出的事件之间的耦合，用"两条事件共享同一属主盘算"表达，避免把盘算当节点）
export function connectedComponents(world) {
    const open = (world.events || []).filter((e) => !e.closed);
    const ids = new Set(open.map((e) => e.id));
    const byId = new Map(open.map((e) => [e.id, e]));
    // 事件 → 引用它的事件（反向索引）：入度 = 有多少东西以它为来路
    const referencedBy = new Map();
    const addRev = (target, from) => {
        if (!referencedBy.has(target)) referencedBy.set(target, new Set());
        referencedBy.get(target).add(from);
    };
    const edges = [];
    for (const e of open) {
        const ref = e.source?.ref;
        // ① 事件 → 上游事件（唯一方向：下游指着上游）
        if (ref && ids.has(ref) && ref !== e.id) { edges.push([e.id, ref]); addRev(ref, e.id); }
    }
    // ② 共享波及实体（同一批人 ⇒ 同一场局）
    for (let i = 0; i < open.length; i += 1) {
        for (let j = i + 1; j < open.length; j += 1) {
            const a = open[i].ripples || []; const b = open[j].ripples || [];
            if (!a.length || !b.length) continue;
            if (a.some((r) => b.includes(r))) edges.push([open[i].id, open[j].id]);
        }
    }
    // ③ 同一在飞盘算源出（agenda.source.ref → 事件；两条事件被同一盘算引用）
    const byAgendaSrc = new Map();
    for (const ag of world.agendas || []) {
        if (ag.closed) continue;
        const ref = ag.source?.ref;
        if (!ref) continue;
        if (!byAgendaSrc.has(ref)) byAgendaSrc.set(ref, []);
        byAgendaSrc.get(ref).push(ag);
    }
    for (const [, ags] of byAgendaSrc) {
        if (ags.length < 2) continue;
        const evs = ags.map((a) => a.source?.ref).filter((r) => ids.has(r));
        for (let i = 1; i < evs.length; i += 1) edges.push([evs[0], evs[i]]);
    }
    // 并查集
    const parent = new Map([...ids].map((id) => [id, id]));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    for (const [a, b] of edges) if (ids.has(a) && ids.has(b)) union(a, b);
    const groups = new Map();
    for (const id of ids) {
        const r = find(id);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r).push(byId.get(id));
    }
    // ★独立链头（机械判据）：账上**没有任何东西以它为来路**——没有别的事件指它、也没有盘算源出它。
    //   它自己可以指别人（它站在这条链的**最上游**）。
    const agendaSrcRefs = new Set((world.agendas || []).filter((a) => !a.closed).map((a) => a.source?.ref).filter(Boolean));
    const isHead = (e) => !referencedBy.has(e.id) && !agendaSrcRefs.has(e.id);
    // ★真·独立的线（链头 ∧ 自己没有上游 ⇒ 自己不派生、自立走）：`state` 源事件按设计**永不自动闭环**
    //   （entropy.js）⇒ 它不派生新事件 ⇒ 一条自立的线；而 `ripple` 源（上游已闭环才降格）与挂在主线别处的事件
    //   是**大事件的下游**，不是"各自的线"。⇒ 这条判据把"世界到底有几件事在各自走"量成一句实话（纯形态、零判断）。
    const isOwnLine = (e) => isHead(e) && !(e.source?.ref && ids.has(e.source.ref));
    // ★链头的**两种**（`isHead` 把这两种混在一起，必须分开看——它们的语义完全不同）：
    //   · root：`source.ref` 空（或指向的 id 不在热池）⇒ 源头已不在池里，它是**自立**的
    //   · head-live-upstream：指着池里另一条未决事件 ⇒ 它其实是**别人链上的下游**，只是没人指它
    const headKind = (e) => {
        if (!isHead(e)) return null;
        const ref = e.source?.ref;
        if (!ref || !ids.has(ref)) return 'root';       // 源自立（含指已闭环事件/盘算的情况）
        return 'head-live-upstream';                    // 上游在池里 ⇒ 不是"各自的事"
    };
    const comps = [...groups.values()].map((evs) => ({
        size: evs.length,
        heads: evs.filter(isHead),
        hasFreshHead: evs.some(isHead),
        ids: evs.map((e) => e.id),
    }));
    // 排序：有新鲜链头的在前（那才是"能开新戏"的分量）→ 分量大小 → id 序（确定性）
    comps.sort((a, b) => (Number(b.hasFreshHead) - Number(a.hasFreshHead)) || (b.size - a.size)
        || (a.ids[0] < b.ids[0] ? -1 : 1));
    return { comps, isHead, isOwnLine, headKind, referencedBy, edges: edges.length };
}

// 盘算 ↔ 它挂在哪个事件上（用于"各异主数量"读数）
function agendaAnchor(world) {
    const openAgendas = (world.agendas || []).filter((a) => !a.closed);
    const evIds = new Set((world.events || []).filter((e) => !e.closed).map((e) => e.id));
    const anchorOf = new Map();   // agendaId → 事件 id | null
    for (const a of openAgendas) {
        const ref = a.source?.ref;
        anchorOf.set(a.id, ref && evIds.has(ref) ? ref : null);
    }
    return { openAgendas, anchorOf };
}

// ★核心读数：在飞盘算**落在几个互不相干的局里**（各异主数量）= 世界宽不宽的直接量
function focusReadout(world) {
    const { comps } = connectedComponents(world);
    const compOfEvent = new Map();
    comps.forEach((c, ci) => c.ids.forEach((id) => compOfEvent.set(id, ci)));
    const { openAgendas, anchorOf } = agendaAnchor(world);
    // 每条在飞盘算归属的分量：有事件锚 → 该事件的分量；无锚（state/entity 源）→ 它自己
    const buckets = new Map();
    const unanchored = [];
    for (const a of openAgendas) {
        const evId = anchorOf.get(a.id);
        const key = evId ? `comp:${compOfEvent.get(evId)}` : `solo:${a.id}`;
        if (!evId) unanchored.push(a.id);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(a);
    }
    const sizes = [...buckets.values()].map((v) => v.length).sort((a, b) => b - a);
    const ownerCount = new Set(openAgendas.map((a) => a.owner)).size;
    return {
        tick: world.meta?.tick ?? 0,
        agendasOpen: openAgendas.length,
        agendaOwners: ownerCount,
        // 各异主数量（盘算侧）
        distinctFocus: buckets.size,
        largestFocusShare: openAgendas.length ? (sizes[0] || 0) / openAgendas.length : 0,
        focusSizes: sizes,
        unanchoredAgendas: unanchored.length,
        // 各异主数量（事件侧）
        eventsOpen: (world.events || []).filter((e) => !e.closed).length,
        eventComps: comps.length,
        independentHeads: comps.reduce((n, c) => n + c.heads.length, 0),
        // 事件波及面（"几家在演"的客观面）
        rippledEntities: new Set((world.events || []).filter((e) => !e.closed).flatMap((e) => e.ripples || [])).size,
        namedInChronicle: null,
    };
}

// ★内容面读数（★这条才是治"都围绕一件事"的真判据）：
//   结构面只能量出"盘算挂在哪条链上"，量不出"它们说的是不是同一件事"——
//   真账实测就是这样骗过人的：8 条在飞盘算里 **6 条本来就是 `state` 源（结构上全自立）**，
//   但它们的目标全是死煞 ⇒ 结构面读"各异主 7"（不塌缩），内容面读"8/8 同一件事"（塌缩）。
//   口径：**纯机械、零语义判断**——把"主题词"定义为一个机械可核的东西：
//     ① 先在"局"层面取词：`newEvents[].title` 与 `newAgendas[].goal` 里长度 ≥2 的**汉字片段**
//        （按非汉字切分），取在**多条**里都出现的片段 ⇒ 它们就是这一摊事的公共名词（如「死煞」）。
//     ② 然后量每条新盘算的目标与**公共名词**的交集 ⇒ 有交集 = 它仍挂在那件事上。
//   ★这不是语义理解，是"字面公共子串"——它会同时抓住「死煞」这类真主题与「大荒」这类地名；
//     故输出**同时给出命中的词**，让读的人自己判断（不替用户下结论）。
//   实现要点（本装置第三版）：**必须逐 n 取 n=2..6 的子串**再计数。
//     第一版按非汉字切分取整段词组 ⇒ 每个词组整条只出现一次 ⇒ 公共词一个都抓不到（假绿）。
function ngramsOf(text, lo = 2, hi = 6) {
    const s = String(text || '').replace(/[^\u4e00-\u9fff]/g, '');
    const out = new Set();
    for (let n = lo; n <= hi; n += 1) for (let i = 0; i + n <= s.length; i += 1) out.add(s.slice(i, i + n));
    return out;
}
// ≥2 条共享的**极大**片段（若长片段与短片段计数相同，只留长的，否则「死煞」「死煞亡」一起刷屏）
function commonThemes(texts, minCount = 2) {
    const cnt = new Map();
    for (const t of texts) for (const f of ngramsOf(t)) cnt.set(f, (cnt.get(f) || 0) + 1);
    const list = [...cnt.entries()].filter(([, n]) => n >= minCount)
        .sort((a, b) => b[0].length - a[0].length || b[1] - a[1]);
    const kept = [];
    for (const [w, n] of list) {
        if (kept.some(([k, kn]) => k.includes(w) && kn === n)) continue;
        kept.push([w, n]);
    }
    return kept.sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
        .slice(0, 10).map(([word, n]) => ({ word, n }));
}
// 内容面：新盘算的目标 vs 世界当前大事件的公共名词
function contentReadout(world, newGoals = [], sharedThemes = null) {
    const openEvTitles = (world.events || []).filter((e) => !e.closed).map((e) => e.title);
    const openGoals = (world.agendas || []).filter((a) => !a.closed).map((a) => a.goal);
    // ★主题词从**盘算目标之间**取（那才是"他们各自在办的事"），事件标题只作旁证；
    //   sharedThemes 传入时用**同一份**词表量所有臂（否则各臂自算词表 ⇒ 数字不可比）
    const themes = sharedThemes || commonThemes([...openGoals, ...newGoals], 2).filter((t) => t.word.length >= 2);
    const flat = (s) => String(s || '').replace(/[^\u4e00-\u9fff]/g, '');
    const hitsOf = (text) => themes.filter((t) => flat(text).includes(t.word)).map((t) => t.word);
    return {
        topThemes: themes,
        openAgendaGoals: openGoals.map((g) => ({ goal: g, hits: hitsOf(g) })),
        openAgendaOnTheme: openGoals.filter((g) => hitsOf(g).length).length,
        openAgendaTotal: openGoals.length,
        newGoals: (newGoals || []).map((g) => ({ goal: g, hits: hitsOf(g) })),
        newGoalsOnTheme: (newGoals || []).filter((g) => hitsOf(g).length).length,
    };
}

// ---------------- 包变体（两档口径的机械差异，改包不变式自证） ----------------
function splitOf(world) {
    const { comps, isHead, isOwnLine } = connectedComponents(world);
    if (!comps.length) return { main: null, side: [], standalone: [] };
    const main = comps[0];
    const mainIds = new Set(main.ids);
    // ★「各自的线」= **真·独立的线**（isOwnLine，见上）——不是"链头"（大事件的下游也是链头，但不是各自的事）。
    //   主线里那一份不算"各自的线"（它本来就是主线的一部分）。
    const ownIds = new Set([...mainIds].filter((id) => {
        const e = (world.events || []).find((x) => x.id === id);
        return e && isOwnLine(e);
    }));
    const withOwn = comps.slice(1).map((c) => ({ ...c, ownLines: c.ids.map((id) => (world.events || []).find((x) => x.id === id)).filter((e) => e && isOwnLine(e)) }));
    const side = withOwn.filter((c) => c.ownLines.length);
    const standalone = withOwn.filter((c) => !c.ownLines.length);
    return { main, side, standalone, mainIds, isHead, isOwnLine, ownInMain: ownIds };
}

const evRow = (e) => ({ id: e.id, title: e.title, source: e.source, position: e.position });

// ★丙口径的骨：给名单上的人**各带一句他自己的处境**（leg32 §1.4 候选丙）。
//   为什么这条可能才是对的那一条：leg32 的发现是"引擎给的是**谁该轮到**（人），没给**轮到的人各自在过什么日子**（事）"
//   ⇒ 模型手上没有"他自己的事"，只能把每个人接到眼前唯一那件大事上。
//   口径：**只从账上派生**（不发明）——取 location / parent / 实力（照抄书里的说法，不换算成数）/ 最近一次被点名的事件标题。
//   一条事实都没有的人，如实只给名字（空着就是空着）。
function situationOf(world, entityId) {
    const e = (world.entities || []).find((x) => x.id === entityId);
    if (!e) return null;
    const namedBy = (world.events || [])
        .filter((ev) => (ev.ripples || []).includes(entityId) || (ev.owner === entityId))
        .sort((a, b) => (Number(String(b.id).split('_')[1]) || 0) - (Number(String(a.id).split('_')[1]) || 0));
    const line = {};
    if (e.location && e.location !== '未明') line.where = e.location;
    if (e.parent) line.parent = e.parent;
    if (e['实力'] || e.power) line.power = e['实力'] || e.power;
    if (namedBy[0]) line.lastMentioned = namedBy[0].title;
    const mine = (world.agendas || []).filter((a) => !a.closed && a.owner === entityId);
    if (mine.length) line.busy = mine.map((a) => a.goal);
    return { id: e.id, name: e.name, kind: e.kind, ...line };
}

// ★引擎出包返回的是**包装**：{ pack, text, estTokens }（buildEvolutionPack 末尾 return，见 pack.js:347）。
//   且 trimPack 已**就地**裁过内层 pack ⇒ 读包内读数必须读 `.pack`，不是包装本身（本装置第一版栽在这里）。
//   统一契约：每个臂的 make() 返回 { pack: 包装, base: 内层包 }，包装里的 text 已按变体重出。
const buildBase = (world, moveFact) => {
    const w = buildEvolutionPack(world, moveFact);
    return { pack: w, base: w.pack };
};
const asVariant = (w, innerVariant) => ({ pack: { ...w, pack: innerVariant, text: packTextOf(innerVariant) }, base: w.pack });

// 甲口径：把未决事件分成「主线 / 各自的线（真独立的线，留 N 个位子）」两栏递给模型
function packArmJia(world, moveFact) {
    const b = buildBase(world, moveFact);
    const base = b.base;
    const { main, side, ownInMain } = splitOf(world);
    const pending = base.pendingEvents || [];
    const byId = new Map(pending.map((e) => [e.id, e]));
    const mainRows = (main?.ids || []).map((id) => byId.get(id)).filter(Boolean);
    const sideRows = [
        ...[...ownInMain].map((id) => byId.get(id)).filter(Boolean),
        ...side.flatMap((c) => c.ownLines).map((e) => byId.get(e.id)).filter(Boolean),
    ];
    // ★留位如实：不足 N 个就**留空位**，并在文本里写明"这一栏空着"（引擎不发明事实——红线）
    const slotRows = [];
    for (let i = 0; i < SLOTS; i += 1) slotRows.push(sideRows[i] ? evRow(sideRows[i]) : null);
    const filledN = slotRows.filter(Boolean).length;
    const variant = {
        ...base,
        // 两栏结构（只加不减：pendingEvents 原样保留 ⇒ 改包不变式成立）
        mainLine: mainRows.map(evRow),
        ownLines: slotRows,                       // null = 这一栏空着（如实留空）
        ownLinesNote: filledN < SLOTS
            ? `各自的线：实有 ${filledN} 条，本栏留 ${SLOTS} 个位子 ⇒ 空着 ${SLOTS - filledN} 个。世界上只有少数几件事在各自走——这不正常。`
            : `各自的线：实有 ${filledN} 条（这一栏满了）。`,
    };
    return asVariant(b.pack, variant);
}

// 乙口径：不给"主线"这个框——真独立的线**排在最前、第一眼可见**（多线并存是默认读法）
function packArmYi(world, moveFact) {
    const b = buildBase(world, moveFact);
    const base = b.base;
    const { main, side, ownInMain } = splitOf(world);
    const pending = base.pendingEvents || [];
    const byId = new Map(pending.map((e) => [e.id, e]));
    const ownRows = [
        ...[...ownInMain].map((id) => byId.get(id)).filter(Boolean),
        ...side.flatMap((c) => c.ownLines).map((e) => byId.get(e.id)).filter(Boolean),
    ].map(evRow);
    const mainIds = new Set(main?.ids || []);
    const ownIdSet = new Set(ownRows.map((r) => r.id));
    // ★不重复：ownRows 已是"真独立的线"的全集 ⇒ 主线取**池里其余的全部**（含池外分量），
    //   否则那些分量会在 ownRows 与 mainRows 里各出现一次（本装置第二版被自检抓出来：17 条 → 19 行）。
    //   代价：'主线' 一栏也装了极少量的旁观者——它只是"不是各自的线"的筐，口径上正确且不丢信息。
    const mainRows = pending.filter((e) => !ownIdSet.has(e.id)).map(evRow);
    // 顺序即口径：真独立的线在最前（第一眼），主线其后
    return asVariant(b.pack, { ...base, pendingEvents: [...ownRows, ...mainRows], _order: 'own-first' });
}

// 丙口径：甲口径的两栏 **+ 名单上每人一句自己的处境**（不改"主线"结构，改的是"人有没有自己的事"）
function packArmBing(world, moveFact) {
    const j = packArmJia(world, moveFact);
    const jp = j.pack.pack;
    const sides = (jp.idleFaces || []).map((f) => situationOf(world, f.id)).filter(Boolean);
    return asVariant(j.pack, {
        ...jp,
        idleFaces: sides,   // 原来的 {id,name,kind} ⊂ 现结构（只加字段，不减）
        idleFacesNote: sides.length
            ? `待启用名单上**每个人自己的处境**（只从账上取）：他们各自有各自的日子要过，不是这场大乱的布景——点名之后请让他们办**自己的**事。`
            : undefined,
    });
}

// ★改包不变式自证：未决事件 id 集合改包前后**逐字相等、且不重复**
//   （甲/乙只重排、只加栏，绝不丢事件、绝不把同一条列两次——这是"零判断编排"的正确性判据）
function invariantOf(base, variant) {
    const ids = (p) => (p.pendingEvents || []).map((e) => e.id);
    const b = ids(base); const v = ids(variant);
    const dupes = v.filter((x, i) => v.indexOf(x) !== i);
    const extraCols = ['mainLine', 'ownLines'].flatMap((c) => (variant[c] || []).filter(Boolean).map((e) => e.id));
    const missing = extraCols.filter((id) => !b.includes(id));
    const setEq = b.slice().sort().join(',') === v.slice().sort().join(',');
    return {
        ok: setEq && dupes.length === 0 && missing.length === 0,
        baseIds: b.length, variantIds: v.length,
        duplicates: [...new Set(dupes)], missingFromBase: missing,
    };
}

export const ARMS = {
    base: { name: '基线（现状：真包逐字节不动）', make: (w, m) => buildBase(w, m) },
    ja: { name: `甲口径（主线 / 各自的线，留 ${SLOTS} 位）`, make: packArmJia },
    yi: { name: '乙口径（不给主线框：各自的线排最前）', make: packArmYi },
    bing: { name: '丙口径（甲的两栏 + 名单每人一句自己的处境）', make: packArmBing },
};

// ---------------- 结构出数（零模型成本） ----------------
function structRun(world) {
    const r = focusReadout(world);
    const { comps, isHead, isOwnLine, headKind, edges } = connectedComponents(world);
    const openEvs = (world.events || []).filter((x) => !x.closed);
    const heads = openEvs.filter(isHead);
    const roots = openEvs.filter((e) => headKind(e) === 'root');
    const upstreamHeads = openEvs.filter((e) => headKind(e) === 'head-live-upstream');
    const ownLines = openEvs.filter(isOwnLine);
    const lines = [];
    const ageOf = (e) => r.tick - (Number(String(e.id).split('_')[1]) || 0);
    const row = (e) => `   ${e.id} 「${e.title}」 源=${e.source?.type ?? '?'} 挂 ${ageOf(e)} 轮 · 牵动 ${(e.ripples || []).length} 人`;
    lines.push(`世界「${world.context?.world ?? '?'}」· tick ${r.tick} · 实体 ${(world.entities || []).length}`);
    lines.push(`未决事件 ${r.eventsOpen} 条 · 连通分量 ${r.eventComps} 个 · 图边 ${edges} 条`);
    lines.push('');
    lines.push(`★★未决事件池的成分（这三类必须分开看——语义完全不同）：`);
    lines.push(`   ① 自立（源头不在池里、且无人指它）= ${ownLines.length} 条  ← **这几条才是"各自的线"**`);
    for (const e of ownLines) lines.push(row(e));
    const dangling = ownLines.filter((e) => e.source?.ref);
    lines.push(`      （其中 ${dangling.length} 条是**悬空续链**：指着已闭环的上游——上游已了结，它就是自立线）`);
    lines.push(`   ② 伪链头（指着**在池**上游、只是没人指它）= ${upstreamHeads.length} 条  ← 它们是别人链上的**下游**，不是"各自的事"`);
    for (const e of upstreamHeads) lines.push(row(e));
    lines.push(`   ③ 其余下游节点 = ${r.eventsOpen - ownLines.length - upstreamHeads.length} 条`);
    lines.push(`   ⇒ ★**模型眼前 ${r.eventsOpen} 条未决事件，只有 ${ownLines.length} 条是自立的事，其余 ${r.eventsOpen - ownLines.length} 条（${((r.eventsOpen - ownLines.length) / r.eventsOpen * 100).toFixed(0)}%）都挂在同一场大乱上。**`);
    lines.push('');
    lines.push(`分量分布（前 8）：`);
    for (const c of comps.slice(0, 8)) {
        lines.push(`   · ${String(c.size).padStart(3)} 条事件 · 链头 ${c.heads.length} 个 · ${c.ids.slice(0, 4).join(' ')}${c.ids.length > 4 ? ' …' : ''}`);
    }
    lines.push('');
    lines.push('★★世界宽不宽：两个口径都要看（两条读数指向**不同**的病灶）');
    lines.push(`   ①【结构面】在飞盘算落在几个互不相干的局里：${r.agendasOpen} 条 / 属主 ${r.agendaOwners} 个 ⇒ **各异主 ${r.distinctFocus}**`);
    lines.push(`      最大一坨占 ${(r.largestFocusShare * 100).toFixed(0)}%（${r.focusSizes.join(' / ')}）· 无锚盘算（state/entity 源）${r.unanchoredAgendas} 条`);
    lines.push(`      ★读法：结构面**不塌缩**——8 条盘算本来就散在 7 个焦点里。"都围绕一件事"不是**链**造成的。`);
    lines.push(`   ②【素材面】模型眼前可挂的锚：自立线 **${ownLines.length} 条** vs 同一场大乱上 **${r.eventsOpen - ownLines.length} 条**`);
    lines.push(`      ★读法：这才是"单焦点"的真身——不是模型不肯并行，是**递给它的框里只有一件事**。`);
    // ★③ 内容面（第三版新增）：结构面与素材面都量不出"它们说的是不是同一件事"
    const cr = contentReadout(world, []);
    lines.push(`   ③【内容面】把 ${cr.openAgendaTotal} 条在飞盘算的目标两两比字面公共名词：`);
    lines.push(`      公共名词：${cr.topThemes.slice(0, 8).map((t) => `${t.word}×${t.n}`).join('  ') || '（无）'}`);
    lines.push(`      ⇒ 踩到公共名词的 **${cr.openAgendaOnTheme}/${cr.openAgendaTotal}**`);
    lines.push('      ★读法：**结构上各自自立、内容上全是同一件事**——这才是用户说的"都围绕一件事"。');
    lines.push('');
    const { main, side, ownInMain } = splitOf(world);
    const sideHeads = side.flatMap((c) => c.ownLines);
    const filled = Math.min(SLOTS, sideHeads.length + ownInMain.size);
    lines.push(`★甲口径会怎么递（--slots ${SLOTS}）：`);
    lines.push(`   主线 = 最大分量 ${main?.size ?? 0} 条事件 · 「各自的线」= 自立线 ${sideHeads.length + ownInMain.size} 条 ⇒ 实填 ${filled} 个位子`);
    lines.push(filled < SLOTS ? `   ⇒ **留空 ${SLOTS - filled} 个**，包里如实写"这一栏空着"（引擎不发明事实）` : `   ⇒ 位子够填`);
    lines.push(`★乙口径会怎么递：自立线排在最前（第一眼），主线 ${main?.size ?? 0} 条其后`);
    return { readout: r, ownLines: ownLines.length, roots: roots.length, upstreamHeads: upstreamHeads.length, heads: heads.map((h) => ({ id: h.id, title: h.title, source: h.source?.type, kind: headKind(h), ripples: (h.ripples || []).length })), comps: comps.map((c) => ({ size: c.size, heads: c.heads.length, ids: c.ids })), report: lines.join('\n') };
}

// ---------------- 两臂真模型对跑 ----------------
async function liveArm(arnName, world0, transport) {
    const arm = ARMS[arnName];
    let world = structuredClone(world0);
    const perTick = [];
    let calls = 0; let rejected = 0;
    for (let t = 1; t <= TICKS; t += 1) {
        const before = world;
        // ★玩家不模拟：dialogue 传空串 ⇒ moveFact=null（用户令：模拟器不许模拟玩家的行动）
        const move = extractMove('', {});
        const { pack, base } = arm.make(world, null);
        const inv = invariantOf(base, pack.pack);
        // pack.text 已按本臂重出（见 asVariant）；text 为空时兜底重算
        if (!pack.text) pack.text = packTextOf(pack.pack);
        const main = await runMainCall({ transport, ssot: world, pack });
        calls += 1;
        if (!main.ok) { rejected += 1; perTick.push({ t, ok: false, error: main.errors.join('; ').slice(0, 200) }); continue; }
        const s = settleTick({ ssot: world, step: main.step, moveFact: move, calls: 1 });
        if (!s.ok) { rejected += 1; perTick.push({ t, ok: false, error: `结算拒绝: ${JSON.stringify(s.stage.warnings).slice(0, 200)}` }); continue; }
        world = s.ssot;
        const after = focusReadout(world);
        const beforeEventIds = new Set((before.events || []).map((x) => x.id));
        const beforeAgendaIds = new Set((before.agendas || []).map((x) => x.id));
        const bornEvents = (world.events || []).filter((e) => !beforeEventIds.has(e.id));
        const bornAgendas = (world.agendas || []).filter((a) => !beforeAgendaIds.has(a.id));
        // ★新盘算挂在哪：event 源 ⇒ 该事件在主线还是各自的线（口径落点的直接量）
        const { main: mainComp, side, ownInMain } = splitOf(world);
        const mainIds = new Set(mainComp?.ids || []);
        const ownIds = new Set([...ownInMain, ...side.flatMap((c) => c.ownLines.map((e) => e.id))]);
        const anchorClass = (a) => {
            const ref = a.source?.ref;
            if (!ref) return `自立(${a.source?.type ?? '?'})`;
            if (mainIds.has(ref)) return '主线';
            if (ownIds.has(ref)) return '各自的线';
            return '其他';
        };
        const bornEventClass = (e) => (!e.source?.ref ? `自立(${e.source?.type ?? '?'})` : anchorClass({ source: e.source }));
        perTick.push({
            t, ok: true, tick: after.tick,
            distinctFocus: after.distinctFocus, largestFocusShare: Number(after.largestFocusShare.toFixed(3)),
            agendasOpen: after.agendasOpen, agendaOwners: after.agendaOwners,
            eventsOpen: after.eventsOpen, independentHeads: after.independentHeads,
            bornEvents: bornEvents.length, bornAgendas: bornAgendas.length,
            bornAgendaOwners: bornAgendas.map((a) => `${a.owner}→${anchorClass(a)}`),
            bornAgendaGoals: bornAgendas.map((a) => a.goal),
            bornEventTitles: bornEvents.map((e) => e.title),
            bornEventAnchors: bornEvents.map(bornEventClass),
            invariantOk: inv.ok,
            proposal: {
                actions: (main.step.actions || []).length,
                newEvents: (main.step.newEvents || []).length,
                newAgendas: (main.step.newAgendas || []).length,
                newEntities: (main.step.newEntities || []).length,
            },
            warns: (s.stage.warnings || []).length,
        });
    }
    const okTicks = perTick.filter((p) => p.ok);
    const avg = (k) => okTicks.length ? Number((okTicks.reduce((n, p) => n + p[k], 0) / okTicks.length).toFixed(2)) : null;
    // ★落点分账：新盘算/新事件挂在哪（这是"塌缩有没有被破"的直接量）
    const tally = (arr) => arr.reduce((m, k) => { const key = String(k).split('→').pop(); m[key] = (m[key] || 0) + 1; return m; }, {});
    const bornAgendaClasses = tally(okTicks.flatMap((p) => p.bornAgendaOwners || []));
    const bornEventClasses = tally(okTicks.flatMap((p) => p.bornEventAnchors || []));
    // ★内容面（本轮实验真正要看的那个数）：新盘算的目标说的是不是同一件事
    const newGoals = okTicks.flatMap((p) => p.bornAgendaGoals || []);
    const content = contentReadout(world, newGoals);
    const contentStart = contentReadout(world0, []);   // ★起点世界的那一批（引擎自己造的那 8 条）
    return {
        arm: arnName, label: arm.name, ticks: TICKS, calls, rejected,
        final: focusReadout(world),
        avgDistinctFocus: avg('distinctFocus'),
        maxDistinctFocus: okTicks.length ? Math.max(...okTicks.map((p) => p.distinctFocus)) : null,
        avgLargestShare: avg('largestFocusShare'),
        avgAgendasOpen: avg('agendasOpen'),
        bornEventsTotal: okTicks.reduce((n, p) => n + p.bornEvents, 0),
        bornAgendasTotal: okTicks.reduce((n, p) => n + p.bornAgendas, 0),
        bornAgendaClasses, bornEventClasses,
        content, contentStart,
        contentLine: `新生盘算 ${content.newGoals.length} 条，踩到"公共名词"的 **${content.newGoalsOnTheme}/${content.newGoals.length}**`,
        startLine: `起点那批 ${contentStart.openAgendaTotal} 条，踩到公共名词的 **${contentStart.openAgendaOnTheme}/${contentStart.openAgendaTotal}**（公共名词：${contentStart.topThemes.slice(0, 5).map((t) => `${t.word}×${t.n}`).join(' ')}）`,
        perTick,
        finalWorld: world,   // 供 --dump-world 落盘细看（默认不写文件）
    };
}

// ---------------- main ----------------
const cwdTag = () => (OUT_PATH ? OUT_PATH.replace(/\.json$/, '') : `live-${Date.now()}`);
const world0 = loadRealWorld(WORLD_PATH);
console.log(`真账副本：${WORLD_PATH}`);
console.log(`起点：tick ${world0.meta?.tick ?? 0} · 实体 ${(world0.entities || []).length} · 在飞盘算 ${(world0.agendas || []).filter((a) => !a.closed).length} · 未决事件 ${(world0.events || []).filter((e) => !e.closed).length}\n`);

const report = structRun(world0);
console.log(report.report);

// ★出包自检（零模型成本）：真模型调用之前先证明"改包不丢事件、文本读得通、代价多少"
if (hasFlag('--check-packs')) {
    console.log('\n═══ 出包自检（改包不变式 + 代价 + 文本抽样）═══');
    for (const name of ARM_NAMES) {
        const built = ARMS[name].make(world0, null);
        const ip = built.pack.pack;          // 内层包（引擎出包是 {pack,text,estTokens} 包装）
        const inv = invariantOf(built.base, ip);
        const text = packTextOf(ip);
        const baseText = packTextOf(built.base);
        const est = (s) => Math.ceil(s.length / 3.35);   // 与引擎 estTokensOf 同一口径（TOKEN_RATIO）
        console.log(`\n── 臂 ${name}（${ARMS[name].name}）`);
        console.log(`   包内读数：在飞盘算 ${(ip.agendas || []).length} · 未决事件 ${(ip.pendingEvents || []).length} · 关闭事件 ${(ip.recentClosedEvents || []).length} · 名单 ${(ip.idleFaces || []).length} · trimmed=${JSON.stringify(ip.trimmed ?? null)}`);
        console.log(`   改包不变式：未决事件 ${inv.baseIds} → ${inv.variantIds} 行 · ${inv.ok ? '✔ 集合逐字相等、无重复' : `✗ 坏了：重复 ${JSON.stringify(inv.duplicates)} · 凭空多出 ${JSON.stringify(inv.missingFromBase)}`}`);
        console.log(`   出包体积：基线 ${baseText.length} 字符 / est ${est(baseText)} → 本臂 ${text.length} 字符 / est ${est(text)}（+${est(text) - est(baseText)}，预算 30000 的 ${((est(text) / 30000) * 100).toFixed(0)}%）`);
        // 抽样：把本臂**新增/改序**的那几栏原样打出来（这是模型真正多看到的东西）
        for (const col of ['mainLine', 'ownLines', 'ownLinesNote', 'activeLines', 'idleFacesNote']) {
            if (ip[col] === undefined) continue;
            const v = JSON.stringify(ip[col]);
            console.log(`   ${col} = ${v.length > 700 ? v.slice(0, 700) + ' …（截断）' : v}`);
        }
        if (name === 'bing') console.log(`   idleFaces[0] = ${JSON.stringify((ip.idleFaces || [])[0])}`);
    }
}

const out = { world: WORLD_PATH, slots: SLOTS, struct: report };

if (LIVE) {
    const { resolveWorldTransport } = await import('../src/st-preset.js');
    const resolved = resolveWorldTransport();
    if (!resolved) { console.error('\n✗ 未找到模型配置（env 未设、酒馆预设也没读到）'); process.exit(1); }
    console.log(`\n真模型：${resolved.source === 'st-preset' ? `酒馆预设「${resolved.presetName}」` : '环境变量'} · 模型 ${resolved.model}`);
    console.log(`两臂同起点对跑 ${TICKS} tick · 臂 = ${ARM_NAMES.join(' / ')}（玩家不模拟：dialogue="" ⇒ moveFact=null）\n`);
    const results = [];
    for (const a of ARM_NAMES) {
        process.stdout.write(`跑臂 ${a} …`);
        const r = await liveArm(a, world0, resolved.transport);
        results.push(r);
        if (hasFlag('--dump-world')) {
            const p = `${cwdTag()}-${a}-final-world.json`;
            writeFileSync(p, JSON.stringify(r.finalWorld));
            console.log(` 完成（调用 ${r.calls} · 拒绝 ${r.rejected}）· 终态世界已写 ${p}`);
        } else {
            console.log(` 完成（调用 ${r.calls} · 拒绝 ${r.rejected}）`);
        }
    }
    console.log('\n═══ 两臂对照（★看最后两列：新盘算挂到哪去了）═══');
    const pad = (s, n) => String(s).padEnd(n);
    console.log(`${pad('臂', 7)}${pad('各异主均/峰', 14)}${pad('最大坨占比', 12)}${pad('在飞/属主', 12)}${pad('新盘算', 8)}${pad('挂主线', 8)}${pad('自立', 8)}${pad('挂各自的线', 12)}拒绝`);
    for (const r of results) {
        const c = r.bornAgendaClasses;
        console.log(`${pad(r.arm, 7)}${pad(`${r.avgDistinctFocus} / ${r.maxDistinctFocus}`, 14)}${pad(r.avgLargestShare, 12)}${pad(`${r.avgAgendasOpen}/${r.final.agendaOwners}`, 12)}${pad(r.bornAgendasTotal, 8)}${pad(c['主线'] || 0, 8)}${pad(Object.entries(c).filter(([k]) => k.startsWith('自立')).reduce((n, [, v]) => n + v, 0), 8)}${pad(c['各自的线'] || 0, 12)}${r.rejected}`);
    }
    console.log('\n★★内容面（治"都围绕一件事"的真判据）：新盘算的目标踩没踩上那摊公共名词');
    // ★同一份词表量所有臂：词表 = 起点世界 8 条在飞盘算 + 各臂本轮新生目标的**合集**
    //   （各臂自算词表会让"公共名词"随臂变化 ⇒ 数字不可比）
    const corpusGoals = [
        ...(results[0]?.contentStart?.openAgendaGoals || []).map((x) => x.goal),
        ...results.flatMap((r) => r.content.newGoals.map((x) => x.goal)),
    ];
    const shared = commonThemes(corpusGoals, 2).filter((t) => t.word.length >= 2);
    console.log(`  共用词表（${corpusGoals.length} 条目标里 ≥2 条共享的字面极大片段）：${shared.slice(0, 8).map((t) => `${t.word}×${t.n}`).join('  ')}`);
    for (const r of results) {
        const nn = r.content.newGoals.map((x) => x.goal);
        const onTheme = nn.filter((g) => shared.some((t) => String(g).replace(/[^\u4e00-\u9fff]/g, '').includes(t.word))).length;
        r.sharedOnTheme = onTheme;
        console.log(`  ${r.arm} · 起点那批: ${r.startLine}`);
        console.log(`  ${r.arm} · 本轮新生: ${nn.length} 条，踩到**共用词表**的 **${onTheme}/${nn.length}**`);
        for (const g of nn) {
            const hits = shared.filter((t) => String(g).replace(/[^\u4e00-\u9fff]/g, '').includes(t.word)).map((t) => t.word);
            console.log(`      · 「${g}」${hits.length ? ` ← ${hits.slice(0, 3).join('/')}` : ' ← 未命中'}`);
        }
    }
    console.log('  公共主题词（在≥2 条事件/盘算里字面出现的汉字片段）:', JSON.stringify(results[0]?.content?.topThemes?.slice(0, 8) ?? []));
    out.live = results.map(({ finalWorld, ...keep }) => keep);   // 世界本体不进 JSON（体积）
    console.log('\n逐 tick（各异主 / 最大坨占比 / 新盘算落点）:');
    for (const r of results) {
        console.log(`  ${r.arm}（${r.label}）:`);
        for (const p of r.perTick) {
            if (!p.ok) { console.log(`    t${p.t} ✗ ${p.error}`); continue; }
            console.log(`    t${p.t} 各异主 ${p.distinctFocus} · 最大坨 ${p.largestFocusShare} · 在飞 ${p.agendasOpen} · 新事件 ${p.bornEvents} [${(p.bornEventAnchors || []).join(',')}] · 新盘算 ${p.bornAgendas} [${(p.bornAgendaOwners || []).join(',')}] · 不变式 ${p.invariantOk ? 'OK' : '★坏'}`);
        }
    }
    console.log('\n新事件落点合计：');
    for (const r of results) console.log(`  ${r.arm}: ${JSON.stringify(r.bornEventClasses)}`);
}

if (OUT_PATH) { writeFileSync(OUT_PATH, JSON.stringify(out, null, 2)); console.log(`\n结果已写：${OUT_PATH}`); }
