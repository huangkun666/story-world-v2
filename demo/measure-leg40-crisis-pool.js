// story-world-v2/demo/measure-leg40-crisis-pool.js
// leg40 · 出数装置：**"那一场（未决事件池）在包里的分量"动一动，"无关新线"会不会跟着动**。
//
// 用户当次命令：「先量『包里危机占比』，不动代码」（本文件是那一件的**动态**半边）。
//   静态半边 = `demo/measure-leg40-crisis-share.js`（纯只读、零调用，量各栏量体与占比）。
//   本文件补上静态量不出来的那一格：**占比与模型产出的相关性**——每轮真跑前量一次包体构成，
//   并可选地**确定性削减"那一场"在未决事件池里的呈现**，看"与危机无关的新线"是否上升。
//
// ★★两条纪律（本装置的设计前提）：
//   ① **承重墙零改动**：`runTick` **没有** pack 注入点（`src/tick.js:61` 直调 `buildEvolutionPack`），
//      而 leg39 §8.2 立的规矩是"变体一律走**模块副本 + loader 重定向**"⇒ 本装置走同一条路：
//      变体由 `demo/leg40-gen-crisistrim.mjs` 生成到系统 TEMP，跑时 `node --import <TEMP>/loader.mjs`
//      把 `src/pack.js` 重定向到副本（副本只把 `buildEvolutionPack` 包一层）。**`src/` 一个字节不动。**
//   ② **削法是机械的、可复核的、有痕迹的**：起点（tick 59）未决事件池的最大连通分量里，
//      按"出生轮最老优先"留 `--keep` 条（缺省 6），其余**整条不进包**（只动 `pendingEvents` 这一栏），
//      并在包上留 `crisisPoolTrim` 痕迹（**不静默丢料**，与 `trimPack` 的 `trimmed` 同一条规矩）。
//      ★不碰实体段/在飞盘算/其余任何栏——**单变量**。
//
// ★三种模式（同一份真账、同起点）：
//   · `--arm base --ticks 8`：现状真跑一遍，**每轮出包前量一次包体构成**（占比→产出 的相关性靠它）。
//   · `--arm trim --keep 6` ：同一套读数，只把"那一场"在未决事件池里削到 6 条（那一栏 −80%）。
//   · `--replay <measure-leg36 出数.json>`：拿 leg36 记下的**每轮真世界快照**回放"那一刻的包"，
//     与同一轮模型产出的新线并排放——**不调模型**，几秒出全部读数。
//
// 用法（真模型一律**串行**，避 429）：
//   node demo/leg40-gen-crisistrim.mjs                       # ① 生成 TEMP 变体（打印 SW2_TMP）
//   node demo/measure-leg40-crisis-pool.js --arm base --ticks 8 --out F:/deepseek/tmp/leg40-base.json
//   node demo/run-leg40-variant.mjs <SW2_TMP> --arm trim --keep 6 --ticks 8 --out F:/deepseek/tmp/leg40-trim.json
//   node demo/measure-leg40-crisis-pool.js --replay F:/deepseek/tmp/leg36-base.json
// ★两个 Windows 坑（都实测踩过，别再踩）：① `--import` 的路径必须是 file:/// 三斜杠 URL（见 run-leg40-variant.mjs）；
//   ② 出数**一律走 `--out`**（Node 的 writeFileSync，UTF-8）——PowerShell 的 `>` 重定向写 UTF-16，read 工具读不了。
import { readFileSync, writeFileSync } from 'node:fs';
import { runTick } from '../src/tick.js';
import { computeIdleFaces, buildEvolutionPack, packTextOf } from '../src/pack.js';
import { AGENDA_CAPS } from '../src/settle.js';

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const ST_DATA = 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user';
const WORLD_PATH = argVal('--world', `${ST_DATA}/chats/大荒z/大荒z - 2026-09-01@00h37m41s559ms.jsonl`);
const TICKS = Math.max(1, parseInt(argVal('--ticks', '8'), 10) || 8);
const ARM = argVal('--arm', 'base');
const KEEP = Math.max(0, parseInt(argVal('--keep', '6'), 10) || 0);
const OUT_PATH = argVal('--out', '');
const REPLAY = argVal('--replay', '');
const line = (s) => console.log(s);
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : 'n/a');

// 与 demo/measure-leg36 · demo/measure-leg40-crisis-share **同一把尺子**（逐字相同；不许另立一套）
const CRISIS_RE = /死煞|幽冥|大荒|劫气|杀劫|浊流|煞|镇魔|超度|南疆|北山/;

function loadRealWorld(path) {
    const raw = readFileSync(path, 'utf8');
    const nl = raw.indexOf('\n');
    const header = JSON.parse(nl < 0 ? raw : raw.slice(0, nl));
    const box = header?.chat_metadata?.story_world_v2;
    if (!box?.world) throw new Error(`chat_metadata.story_world_v2.world 缺失：${path}`);
    return box.world;
}
const bornTick = (id) => Number(String(id).split('_')[1]) || 0;

// 与 leg33/leg34/leg36 同口径的连通分量（source.ref 指向池内 / 共享 ripples）
function crisisRootIds(events) {
    const open = (events || []).filter((e) => !e.closed);
    const ids = new Set(open.map((e) => e.id));
    const adj = new Map(open.map((e) => [e.id, new Set()]));
    const link = (a, b) => { if (adj.has(a) && adj.has(b) && a !== b) { adj.get(a).add(b); adj.get(b).add(a); } };
    for (const e of open) { const r = e.source?.ref; if (r && ids.has(r)) link(e.id, r); }
    for (let i = 0; i < open.length; i += 1) for (let j = i + 1; j < open.length; j += 1) {
        const a = open[i].ripples || []; const b = open[j].ripples || [];
        if (a.length && b.length && a.some((x) => b.includes(x))) link(open[i].id, open[j].id);
    }
    const seen = new Set(); const comps = [];
    for (const e of open) {
        if (seen.has(e.id)) continue;
        const st = [e.id]; const c = []; seen.add(e.id);
        while (st.length) { const x = st.pop(); c.push(x); for (const y of adj.get(x)) if (!seen.has(y)) { seen.add(y); st.push(y); } }
        comps.push(c);
    }
    comps.sort((a, b) => b.length - a.length);
    return { all: comps, root: new Set(comps[0] || []) };
}

// ★leg40 主线读数（本轮新增）：**"起了根、但还没人接"的线头**
//   定义（全机械，不判语义）：某条**未决事件**，其 `source.ref` **不指向池内任何事件/盘算**（或压根没有 ref）
//   ⇒ 它就是一个"线头"（root head）。它下一轮若被**别的**事件的 `source.ref` 指到 ⇒ 记为"**被接续**"。
//   为什么这是本轮的靶子：真账 59 轮里模型自己起过 **9 条**这样的线头（慈航医堡/截教/黑山老妖/天机阁主…），
//   但下一轮**一条都没被接续**（全黏回那场大乱）⇒"起了根没人浇"。
function openRootHeads(world) {
    const open = (world.events || []).filter((e) => !e.closed);
    const ids = new Set(open.map((e) => e.id));
    const agIds = new Set((world.agendas || []).map((a) => a.id));
    return open.filter((e) => !e.source?.ref || !(ids.has(e.source.ref) || agIds.has(e.source.ref)));
}

// ---------------- 包体构成量体（与静态装置同一套差分法：**一把尺子**） ----------------
const ENTITY_HEADER = ['id', 'kind', 'name', 'location', 'parent', '实力', 'members', 'player'].join('\t');
const jsonChars = (v) => JSON.stringify(v).length;
const onlyChars = (pack, key, emptyValue) => packTextOf(pack).length - packTextOf({ ...pack, [key]: emptyValue }).length;
const entityTextOf = (row) => packTextOf({ entities: [row] }).length - jsonChars(ENTITY_HEADER) - 3;

function packMetrics(pack, world) {
    const { all, root } = crisisRootIds(world.events || []);
    const inPack = pack.pendingEvents || [];
    const evCrisis = inPack.filter((e) => root.has(e.id));
    const total = packTextOf(pack).length;
    const evCrisisChars = packTextOf(inPack).length - packTextOf(inPack.filter((x) => !root.has(x.id))).length;
    // 实体段：按"属于那一场"逐行量（并集 = 未决事件波及 ∪ 标题点名的实体）
    const named = new Set();
    for (const e of (world.events || [])) if (!e.closed && root.has(e.id)) for (const r of e.ripples || []) named.add(r);
    const ents = (world.entities || []).filter((e) => {
        const n = String(e.name || '');
        return named.has(e.id) || (n.length >= 2 && (world.events || []).some((ev) => !ev.closed && root.has(ev.id) && String(ev.title).includes(n)));
    });
    const entIds = new Set(ents.map((e) => e.id));
    const entCrisisChars = (pack.entities || []).filter((r) => entIds.has(r.id)).reduce((n, r) => n + entityTextOf(r), 0);
    const agCrisisChars = (() => {
        const arr = pack.agendas || [];
        return packTextOf(arr).length - packTextOf(arr.filter((a) => !(root.has(a.source?.ref) || CRISIS_RE.test(String(a.goal))))).length;
    })();
    return {
        tick: world.meta?.tick, totalChars: total, estTokens: Math.ceil(total / 3),
        entChars: onlyChars(pack, 'entities', []), agChars: onlyChars(pack, 'agendas', []), evChars: onlyChars(pack, 'pendingEvents', []),
        evInPack: inPack.length, evCrisisInPack: evCrisis.length, evCrisisChars,
        entRowsTotal: (pack.entities || []).length, entRowsCrisis: (pack.entities || []).filter((r) => entIds.has(r.id)).length, entCrisisChars,
        agCrisisChars, agTotal: (pack.agendas || []).length,
        comps: all.length, compMax: all[0]?.length || 0,
        crisisRootSize: root.size, crisisEntUniverse: entIds.size,
        shareEv: +(evCrisisChars / total).toFixed(4),
        share3: +((evCrisisChars + agCrisisChars + entCrisisChars) / total).toFixed(4),
    };
}

// ---------------- 回放模式（不调模型） ----------------
if (REPLAY) {
    const j = JSON.parse(readFileSync(REPLAY, 'utf8'));
    line('═══ leg40 · 回放：那一轮的包里有多少字是"那一场"（不调模型）═══');
    line(`来源：${REPLAY}（${j.variant} · ${j.model} · 起点 tick ${j.start?.tick}）`);
    line('');
    line(' 轮 · tick · 包token · 实体段占比 · 未决栏占比 · 盘算栏占比 · 池内那一场 · ★那一场占整包 · 本轮新线(危机) · 本轮无重新线累计占比');
    let cumLines = 0; let cumUnrelated = 0;
    for (const row of j.perTick || []) {
        if (!row.ok || !row.snap) { line(` ${String(row.t).padStart(2)} · 跳过（ok=${row.ok}${row.snap ? '' : ' · 无快照'}）`); continue; }
        const pack = buildEvolutionPack(row.snap, null).pack;
        const m = packMetrics(pack, row.snap);
        const nl = (row.newLines || []).length; const nc = row.newLinesCrisis ?? 0;
        cumLines += nl; cumUnrelated += nl - nc;
        line(` ${String(row.t).padStart(2)} · ${String(m.tick).padStart(4)} · ${String(m.estTokens).padStart(7)} · ${pct(m.entChars, m.totalChars).padStart(6)} · ${pct(m.evChars, m.totalChars).padStart(6)} · ${pct(m.agChars, m.totalChars).padStart(6)} · ${String(m.evCrisisInPack).padStart(2)}/${String(m.evInPack).padStart(2)} · ★${pct(m.shareEv, 1).padStart(6)} · ${String(nl).padStart(2)}(${String(nc).padStart(2)}) · 累计 ${cumUnrelated}/${cumLines} = ${pct(cumUnrelated, cumLines)}`);
    }
    line('');
    line(`⇒ 全轮累计：与危机无关的新线 ${cumUnrelated} / ${cumLines} = ${pct(cumUnrelated, cumLines)}`);
    process.exit(0);
}

// ---------------- 主流程（真模型） ----------------
const world0 = loadRealWorld(WORLD_PATH);
const boot = crisisRootIds(world0.events);
line('═══ leg40 · "那一场的分量"动态对跑（真模型）═══');
line(`真账副本：${WORLD_PATH}`);
line(`起点 tick ${world0.meta?.tick} · 实体 ${(world0.entities || []).length} · 未决事件 ${(world0.events || []).filter((e) => !e.closed).length} · 在飞盘算 ${(world0.agendas || []).filter((a) => !a.closed).length}`);
line(`起点未决事件池：连通分量 ${boot.all.length} 个（最大 ${boot.all[0]?.length || 0} 条 = 池子的 ${pct(boot.all[0]?.length || 0, (world0.events || []).filter((e) => !e.closed).length)}）`);
line(`臂 = **${ARM}**${ARM === 'trim' ? `（未决事件池里"那一场"只留最老 ${KEEP} 条，其余整条不进包）` : '（现状：那一场整栏照递）'}`);
if (ARM === 'trim' && typeof globalThis.__SW2_CRISIS_KEEP__ !== 'number') {
    line('⚠ 变体没生效：本臂必须用 `node --import <SW2_TMP>/loader.mjs …` 跑（先跑 leg40-gen-crisistrim.mjs 生成）。');
    process.exit(3);
}

const { resolveWorldTransport } = await import('../src/st-preset.js');
const resolved = resolveWorldTransport();
if (!resolved) { console.error('✗ 未找到模型配置'); process.exit(1); }
line(`真模型：${resolved.source === 'st-preset' ? `酒馆预设「${resolved.presetName}」` : '环境变量'} · ${resolved.model} · ${TICKS} tick`);
line('');

let world = structuredClone(world0);
const perTick = [];
for (let t = 1; t <= TICKS; t += 1) {
    const tickBefore = world.meta?.tick;
    // ① 出数前：量"这一刻就这样递出去，包里有多少字是那一场的"（与引擎真跑**同一个** build）
    const probe = buildEvolutionPack(world, null).pack;
    const m = packMetrics(probe, world);
    const beforeEv = new Set((world.events || []).map((x) => x.id));
    const beforeEnt = new Set((world.entities || []).map((x) => x.id));
    const beforeAg = new Set((world.agendas || []).map((x) => x.id));
    const faces = computeIdleFaces(world).map((f) => f.id);
    // ★本轮开始的"线头台账"（那一栏若被放进包里，模型看到的就是这一份）
    const rootsBefore = openRootHeads(world).map((e) => ({ id: e.id, title: e.title, position: e.position, ripples: (e.ripples || []).length }));

    // ② 真跑一轮（真世界原样进引擎；变体只改"递给模型的那份包"）
    const r = await runTick({ transport: resolved.transport, ssot: world, dialogue: '', extractCtx: {}, calls: 1 });
    const row = { t, tickBefore, ok: r.ok, error: r.ok ? null : String(r.error).slice(0, 200), pack: m, faces: faces.length, rootHeads: rootsBefore, threads: probe.threads || [] };
    if (r.ok) {
        world = r.ssot;
        row.tickAfter = world.meta.tick;
        row.trimMark = r.pack?.crisisPoolTrim || null;
        row.poolAfter = {
            openEvents: (world.events || []).filter((e) => !e.closed).length,
            openAgendas: (world.agendas || []).filter((a) => !a.closed).length,
        };
        const freshEv = (world.events || []).filter((e) => !beforeEv.has(e.id));
        const freshAg = (world.agendas || []).filter((a) => !beforeAg.has(a.id));
        // ★本轮新事引用了谁（用来算"线头有没有被接续"）
        row.refsThisTick = [...new Set(freshEv.map((e) => e.source?.ref).filter(Boolean))];
        row.newEvents = freshEv.map((e) => ({ title: e.title, position: e.position, type: e.source?.type || '无', crisis: CRISIS_RE.test(String(e.title)) }));
        row.newLines = freshAg.map((a) => ({ goal: String(a.goal || '').slice(0, 44), type: a.source?.type || '无', crisis: CRISIS_RE.test(String(a.goal)) }));
        row.newLinesCrisis = row.newLines.filter((x) => x.crisis).length;
        row.newEventsCrisis = row.newEvents.filter((x) => x.crisis).length;
        row.newEntities = (world.entities || []).filter((e) => !beforeEnt.has(e.id)).length;
        row.topLevelNow = (world.agendas || []).filter((a) => !a.closed && (!a.source || a.source.type !== 'parent')).length;
        row.openNow = (world.agendas || []).filter((a) => !a.closed).length;
        row.snap = world;   // ★留快照：出数后可回放"那一刻的包"
    }
    row.warnings = r.ok ? (r.stage?.warnings || []).length : null;
    perTick.push(row);
    line(`第 ${t} 轮 tick ${tickBefore}→${row.ok ? row.tickAfter : '✗'} | 包 ${m.estTokens} token（实体 ${pct(m.entChars, m.totalChars)} · 盘算 ${pct(m.agChars, m.totalChars)} · 未决 ${pct(m.evChars, m.totalChars)}）· ★池内那一场 ${m.evCrisisInPack}/${m.evInPack} 条 = 整包 **${pct(m.evCrisisChars, m.totalChars)}** | 新事件 ${row.newEvents?.length ?? '-'}（危机 ${row.newEventsCrisis ?? '-'}）· 新线 ${row.newLines?.length ?? '-'}（危机 ${row.newLinesCrisis ?? '-'}）· 在飞 ${row.openNow ?? '-'} · 警告 ${row.warnings ?? '-'}`);
    if (row.trimMark) line(`     ✂ 本轮机削：那一场留 ${row.trimMark.keptCrisis} 条 · 削掉 ${row.trimMark.droppedCrisis} 条（账本未改）`);
    if (!r.ok) line(`     ✗ ${row.error}`);
}

const ok = perTick.filter((p) => p.ok);
const sum = (f) => ok.reduce((n, p) => n + f(p), 0);
const allLines = ok.flatMap((p) => p.newLines || []);
const allEvs = ok.flatMap((p) => p.newEvents || []);
const unrelated = allLines.filter((x) => !x.crisis).length;
line('');
line('═══ 收口 ═══');
line(`· ★**与危机无关的新线**：${unrelated} / ${allLines.length} = **${pct(unrelated, allLines.length)}**`);
line(`· 与危机无关的新事件：${allEvs.filter((x) => !x.crisis).length} / ${allEvs.length} = ${pct(allEvs.filter((x) => !x.crisis).length, allEvs.length)}`);
line(`· 有事件锚的新线（event/parent）：${allLines.filter((x) => x.type === 'event' || x.type === 'parent').length} / ${allLines.length}`);
line(`· 包体 est 均值 ${Math.round(sum((p) => p.pack.estTokens) / (ok.length || 1))} token · 池内那一场占整包均值 **${pct(sum((p) => p.pack.evCrisisChars), sum((p) => p.pack.totalChars))}** · 拒绝 ${perTick.filter((p) => !p.ok).length} 轮 · 警告合计 ${sum((p) => p.warnings || 0)}`);
line(`· 未决事件池 ${(world0.events || []).filter((e) => !e.closed).length} → ${(world.events || []).filter((e) => !e.closed).length} · 在飞盘算 ${(world0.agendas || []).filter((a) => !a.closed).length} → ${(world.agendas || []).filter((a) => !a.closed).length}（顶层 ${ok.length ? ok[ok.length - 1].topLevelNow : '-'} / ${AGENDA_CAPS.topLevel}）`);
line('');
line('  逐条新线：');
for (const x of allLines) line(`   ${x.crisis ? '危机' : '★无关'} · ${x.type.padEnd(6)} 「${x.goal}」`);

// ★★本轮主线读数：线头（无来路的未决事件）与"被接续"
line('');
line('★★ 线头读数（"起了根、但还没人接"的未决事件）');
line(`· 起点线头 **${perTick[0]?.rootHeads?.length ?? '-'}** 条：${(perTick[0]?.rootHeads || []).map((x) => `「${String(x.title).slice(0, 14)}」@${x.position}`).join(' · ')}`);
const everRef = new Set(ok.flatMap((p) => p.refsThisTick || []));
const allHeads = new Map();
for (const p of perTick) for (const h of (p.rootHeads || [])) if (!allHeads.has(h.id)) allHeads.set(h.id, { ...h, firstSeen: p.t });
let adopted = 0;
for (const [id, h] of allHeads) {
    const isMine = h.firstSeen === 1;
    const hit = everRef.has(id);
    if (hit) adopted += 1;
    line(`   ${hit ? '★被接续' : '  '} ${id.padEnd(10)} 首见于第 ${h.firstSeen} 轮 · ${isMine ? '（起点就有）' : '（本臂跑出来的）'} @${String(h.position).padEnd(10)} 「${String(h.title).slice(0, 26)}」`);
}
line(`· ★全程被别的**新事件**引用过的线头：**${adopted} / ${allHeads.size}**（起点那 ${perTick[0]?.rootHeads?.length ?? 0} 条里被接续的：${(perTick[0]?.rootHeads || []).filter((h) => everRef.has(h.id)).length}）`);
line(`· 各轮线头数：${perTick.map((p) => `${p.t}:${(p.rootHeads || []).length}`).join(' ')}`);

// ★★threads 臂专属：**一轮调用里，被要求并推的那几条线，各自被推了吗**
if (perTick.some((p) => (p.threads || []).length)) {
    line('');
    line('★★ 并推读数（threads 臂）：本回合被点名的线捆，各写了几步');
    let asked = 0; let advanced = 0;
    for (const p of perTick) {
        const list = p.threads || [];
        if (!list.length) continue;
        const pushed = list.filter((th) => (p.refsThisTick || []).includes(th.id));
        asked += list.length; advanced += pushed.length;
        line(`   第 ${p.t} 轮：点名 ${list.length} 条 [${list.map((x) => x.id).join(' ')}] ⇒ **被推 ${pushed.length} 条**${pushed.length ? ` [${pushed.map((x) => x.id).join(' ')}]` : ''}${list.length && pushed.length === list.length ? ' ★全推' : ''}`);
    }
    line(`· ★**合计：被点名的线捆 ${asked} 条（次）⇒ 真被推 ${advanced} 次 = ${pct(advanced, asked)}**（对照：control/p1/p2 三臂每轮只推 1 条 ⇒ 3 条点名最高只有 1/3）`);
}

const out = {
    arm: ARM, keep: KEEP, model: resolved.model, ticks: TICKS, perTick,
    summary: { newLines: allLines.length, newLinesUnrelated: unrelated, newEvents: allEvs.length, newEventsUnrelated: allEvs.filter((x) => !x.crisis).length, anchored: allLines.filter((x) => x.type === 'event' || x.type === 'parent').length },
};
if (OUT_PATH) { writeFileSync(OUT_PATH, JSON.stringify(out, null, 2)); line(`\n出数已留档：${OUT_PATH}`); }
