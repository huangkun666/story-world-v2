// story-world-v2/demo/measure-leg40-crisis-share.js
// leg40 · 出数装置（**纯只读、不出网、零真模型调用**）：量"那场大乱在包里占多少分量"。
//
// 用户当次命令：「先量『包里危机占比』，不动代码」。
// 靶子的来路（leg39 §6.1 ⑤）：新口径把"线能连走"（最长 3 轮 → 5 轮）与"线有来路"（有锚 14% → ≈53%）
//   两条治稳了，**唯独"与那场大乱无关的新线"没动**（≈19%，有一次 0/6）⇒ 假设是
//   **连走的线内容仍围着那场大乱**，瓶颈已不在"要不要多线"，而在**"那场大乱在包里的分量"**。
//
// 本装置只回答一件事：**包里到底有多少字是"那一场"的**（分栏逐项量），
//   以及这个占比在 1..N 轮里怎么变（旧跑数的 perTick 回放）。
//   ★不改任何仓库文件、不建变体、不调模型；真账走副本（只读打开）。
//
// 口径（全部机械、可复核）：
//   ① **判据一（正则）**：与 leg39 `measure-leg36` 的 `CRISIS_RE` **同一把尺子**（那里正是用它算"
//      无关新线占比"的）——死煞|幽冥|大荒|劫气|杀劫|浊流|煞|镇魔|超度|南疆|北山。
//   ② **判据二（图论·真源）**：`source.ref` 链回溯到起点 31 条未决事件的**最大连通分量的根**。
//      ★这条是本棒读数里最硬的一条：起点 31 条未决事件在"source.ref 指向池内 + 共享 ripples"
//        口径下是**一个分量**（leg39 §6.1 ④ 登记的"分量 2–5 vs 旧 8"之谜，本装置给出根因候选）。
//   ③ 两把尺子都给数，并**列出分歧条目**（谁被判危机、谁没被判）——不许只报一个数就下结论。
//
// 用法：
//   node demo/measure-leg40-crisis-share.js
//   node demo/measure-leg40-crisis-share.js --world <真账副本> --runs F:/deepseek/tmp/leg39-base.json,F:/deepseek/tmp/leg39-np-r1.json
import { readFileSync } from 'node:fs';
import { buildEvolutionPack, packTextOf } from '../src/pack.js';

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const ST_DATA = 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user';
const WORLD_PATH = argVal('--world', `${ST_DATA}/chats/大荒z/大荒z - 2026-09-01@00h37m41s559ms.jsonl`);
const RUNS = argVal('--runs', [
    'F:/deepseek/tmp/leg39-base.json',
    'F:/deepseek/tmp/leg39-np-r1.json', 'F:/deepseek/tmp/leg39-np-r2.json',
    'F:/deepseek/tmp/leg39-np-r3.json', 'F:/deepseek/tmp/leg39-np-r4.json',
].join(','));
const line = (s) => console.log(s);
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : 'n/a');

// leg39 同一把尺子（逐字相同，不许另立一套）
const CRISIS_RE = /死煞|幽冥|大荒|劫气|杀劫|浊流|煞|镇魔|超度|南疆|北山/;

function loadRealWorld(path) {
    const raw = readFileSync(path, 'utf8');
    const nl = raw.indexOf('\n');
    const header = JSON.parse(nl < 0 ? raw : raw.slice(0, nl));
    const box = header?.chat_metadata?.story_world_v2;
    if (!box?.world) throw new Error(`chat_metadata.story_world_v2.world 缺失：${path}`);
    return box.world;
}
const han = (s) => (String(s).match(/[\u4e00-\u9fff]/g) || []).length;

// 连通分量（与 demo/measure-leg36 逐字同口径：source.ref 指向池内 / 共享 ripples）
function components(events) {
    const open = events.filter((e) => !e.closed);
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
    return comps.sort((a, b) => b.length - a.length);
}

// ---------------- 分栏量体 ----------------
// ★★本装置第一版在这里犯过一个真错，留档：我按 `JSON.stringify(行).length` 逐行加总，
//   得出"entities 段 55502 字符 = 整包的 147%"——**比整包还大**。
//   根因：实体段在**唯一序列化口径**里是**行式表格**（TAB 分列、无键名、无 JSON 标点），
//   而 `JSON.stringify(行)` 把 619 行的键名与标点全算了一遍（`leg31` 实测过：那部分是 56% 的纯结构开销）。
//   ⇒ 教训与 leg31 同一条：**量体只能有一把尺子**。本版改为"同口径差分法"：
//     ① 顶层各栏 = `packTextOf({ ...pack, [栏]: 空值 })` 与整包之差（同一函数、同一形状）；
//     ② 实体段内逐行 = `packTextOf({entities:[row]})` 去掉表头与换行（行在**表里**的真宽）。
function jsonChars(v) { return JSON.stringify(v).length; }
function onlyChars(pack, key, emptyValue) {
    const clone = { ...pack, [key]: emptyValue };
    return packTextOf(pack).length - packTextOf(clone).length;
}
function entityTextOf(row) {
    // 单行在表里的真宽：packTextOf({entities:[row]}) = 1(换行) + 表头 + 1(换行) + 行文本
    return packTextOf({ entities: [row] }).length - jsonChars(ENTITY_HEADER_PLACEHOLDER) - 3;
}
const ENTITY_HEADER_PLACEHOLDER = ['id', 'kind', 'name', 'location', 'parent', '实力', 'members', 'player'].join('\t');
function sectionChars(pack) {
    return {
        total: packTextOf(pack).length,
        entities: onlyChars(pack, 'entities', []),
        agendas: onlyChars(pack, 'agendas', []),
        pendingEvents: onlyChars(pack, 'pendingEvents', []),
        recentClosedEvents: onlyChars(pack, 'recentClosedEvents', []),
        closedAgendas: onlyChars(pack, 'closedAgendas', []),
        idleFaces: onlyChars(pack, 'idleFaces', []),
        departed: onlyChars(pack, 'departed', []),
        recalled: pack.recalled === undefined ? 0 : onlyChars(pack, 'recalled', ''),
        dialogueBook: onlyChars(pack, 'dialogueBook', []),
        setting: pack.setting === undefined ? 0 : onlyChars(pack, 'setting', null),
        positions: onlyChars(pack, 'positions', []),
        playerMove: pack.playerMove === null ? 0 : onlyChars(pack, 'playerMove', null),
    };
}
const SKIP_REST_KEYS = new Set(['entities', 'agendas', 'pendingEvents', 'recentClosedEvents', 'closedAgendas',
    'idleFaces', 'departed', 'recalled', 'dialogueBook', 'setting', 'positions']);

// ---------------- 主流程 ----------------
const world = loadRealWorld(WORLD_PATH);
const ents = world.entities || [];
const byId = new Map(ents.map((e) => [e.id, e]));
const nameOf = (id) => byId.get(id)?.name || id;
const openEv = (world.events || []).filter((e) => !e.closed);
const openAg = (world.agendas || []).filter((a) => !a.closed);

line('═══ leg40 · 包里"危机占比"专项测量（纯只读 · 零模型调用）═══');
line(`真账副本：${WORLD_PATH}`);
line(`起点 tick ${world.meta?.tick} · 实体 ${ents.length} · 未决事件 ${openEv.length} · 在飞盘算 ${openAg.length}`);

// ★判据二：图论真源的根
const comps = components(world.events || []);
const rootComp = new Set(comps[0] || []);
line('');
line(`★判据二（图论）：未决事件连通分量 **${comps.length}** 个 · 最大分量 **${comps[0]?.length || 0}** 条（${pct(comps[0]?.length || 0, openEv.length)} 的未决事件在同一个分量里）`);
line(`   分量大小分布：${JSON.stringify(comps.map((c) => c.length).slice(0, 10))}`);
line(`   ⇒ 起点 ${world.meta?.tick} 的未决事件池**是一个整体**（同一分量）：${[...rootComp].slice(0, 4).map((id) => `「${openEv.find((e) => e.id === id)?.title}」`).join(' / ')} …`);

// 池内事件：两把尺子
const evCrisisRe = new Set(openEv.filter((e) => CRISIS_RE.test(String(e.title))).map((e) => e.id));
const evCrisisGraph = new Set(openEv.filter((e) => rootComp.has(e.id)).map((e) => e.id));
line('');
line('★两把尺子在"未决事件池"上的分歧（这是全案的底数）：');
line(`   正则判危机：${evCrisisRe.size} / ${openEv.length}（${pct(evCrisisRe.size, openEv.length)}）`);
line(`   图论判危机：${evCrisisGraph.size} / ${openEv.length}（${pct(evCrisisGraph.size, openEv.length)}）`);
const onlyRe = [...evCrisisRe].filter((id) => !evCrisisGraph.has(id));
const onlyGraph = [...evCrisisGraph].filter((id) => !evCrisisRe.has(id));
line(`   只在正则里：${onlyRe.length ? onlyRe.map((id) => `「${openEv.find((e) => e.id === id)?.title}」`).join(' ') : '（无）'}`);
line(`   ★只在图论里（正则漏掉的"同一场、但标题没写危机字样"）：${onlyGraph.length}`);
for (const id of onlyGraph) {
    const e = openEv.find((x) => x.id === id);
    line(`      ${id} pos=${String(e.position).padEnd(8)} src=${String(e.source?.type).padEnd(6)} ref=${String(e.source?.ref || '-').padEnd(10)} 「${e.title}」`);
}

// 在飞盘算 / 已了结盘算 / 已关闭事件 / 波及名单：逐条判
const agCrisis = openAg.filter((a) => CRISIS_RE.test(String(a.goal)) || rootComp.has(a.source?.ref));
const agNot = openAg.filter((a) => !agCrisis.includes(a));
const namedInCrisis = new Set();
for (const e of openEv) if (rootComp.has(e.id)) for (const r of e.ripples || []) namedInCrisis.add(r);
const nameHit = new Set(ents.filter((e) => {
    const n = String(e.name || '');
    return n.length >= 2 && openEv.some((ev) => rootComp.has(ev.id) && String(ev.title).includes(n));
}).map((e) => e.id));
const crisisEnts = new Set([...namedInCrisis, ...nameHit]);
line('');
line(`★"那一场"波及到的实体（未决事件 ripples 去重 ${namedInCrisis.size} 个 · 标题点名 ${nameHit.size} 个 ⇒ 并集 ${crisisEnts.size} 个 = 全账 ${pct(crisisEnts.size, ents.length)}）`);
line(`   在飞盘算：危机 ${agCrisis.length} / ${openAg.length}（${pct(agCrisis.length, openAg.length)}）${agNot.length ? ` · ★不是危机的 ${agNot.length} 条：${agNot.map((a) => `「${String(a.goal).slice(0, 18)}」`).join(' ')}` : ' ★**13/13 全是**'}`);

// ★★ 分栏量体（本装置的主读数）
const built = buildEvolutionPack(world, null);
const pack = built.pack;
const sec = sectionChars(pack);
line('');
line('★★ 逐栏量体（`packTextOf` 唯一口径；"字"= 该栏序列化后的字符数）');
line(`   整包 ${sec.total} 字符（est ≈ ${built.estTokens} token / 预算 30000）`);
const rowsOut = [
    ['entities（镜头·实体段）', sec.entities, pack.entities?.length, '行'],
    ['agendas（在飞盘算）', sec.agendas, pack.agendas?.length, '条'],
    ['pendingEvents（未决事件池）', sec.pendingEvents, pack.pendingEvents?.length, '条'],
    ['recentClosedEvents', sec.recentClosedEvents, pack.recentClosedEvents?.length, '条'],
    ['closedAgendas', sec.closedAgendas, pack.closedAgendas?.length, '条'],
    ['idleFaces（待启用名单）', sec.idleFaces, pack.idleFaces?.length, '人'],
    ['departed（离场名册）', sec.departed, pack.departed?.length, '人'],
    ['recalled（本回合检索）', sec.recalled, pack.recalled ? 1 : 0, '段'],
    ['dialogueBook', sec.dialogueBook, pack.dialogueBook?.length, '人'],
    ['setting（大势）', sec.setting, pack.setting ? 1 : 0, '块'],
    ['positions（地点参照表）', sec.positions, pack.positions?.length, '项'],
];
for (const [n, c, k, u] of rowsOut) line(`   ${n.padEnd(26)} ${String(c).padStart(7)} 字符（${pct(c, sec.total).padStart(6)}）· ${k ?? 0} ${u}`);
const restKeys = Object.keys(pack).filter((k) => !SKIP_REST_KEYS.has(k) && k !== 'trimmed');
const restChars = restKeys.reduce((n, k) => n + jsonChars(k) + 2 + jsonChars(pack[k]), 0);
line(`   ${`（其余：${restKeys.join('/')}）`.padEnd(26)} ${String(restChars).padStart(7)} 字符（${pct(restChars, sec.total).padStart(6)}）`);
line(`   裁剪痕迹 trimmed = ${JSON.stringify(pack.trimmed ?? null)}`);

// ★ 各栏里"危机相关"的占比（逐条判，不整栏拍）
// 一条在**它那一栏数组里**的真宽（差分法：整栏减去去掉它之后的整栏）
function itemCharsIn(arr, pred) {
    if (!Array.isArray(arr) || !arr.length) return 0;
    const withAll = packTextOf(arr).length;
    const without = arr.filter((x) => !pred(x));
    return withAll - packTextOf(without).length;
}
const entCrisisChars = (pack.entities || []).filter((r) => crisisEnts.has(r.id)).reduce((n, r) => n + entityTextOf(r), 0);
const agCrisisChars = itemCharsIn(pack.agendas, (r) => agCrisis.some((a) => a.id === r.id));
const evCrisisChars = itemCharsIn(pack.pendingEvents, (r) => rootComp.has(r.id));
line('');
line('★★ 各栏里"属于那一场"的字数（判据二·图论真源；逐条判）');
line(`   entities 段：${entCrisisChars} / ${sec.entities} 字符 = **${pct(entCrisisChars, sec.entities)}**（${(pack.entities || []).filter((r) => crisisEnts.has(r.id)).length} / ${pack.entities?.length} 行）`);
line(`   agendas 段：${agCrisisChars} / ${sec.agendas} 字符 = **${pct(agCrisisChars, sec.agendas)}**`);
line(`   pendingEvents 段：${evCrisisChars} / ${sec.pendingEvents} 字符 = **${pct(evCrisisChars, sec.pendingEvents)}**`);
const crisisTotal = entCrisisChars + agCrisisChars + evCrisisChars;
line(`   ⇒ 三栏合计："那一场"占整包 **${pct(crisisTotal, sec.total)}**（${crisisTotal} / ${sec.total} 字符）`);
line(`   ★对照：pendingEvents 这一栏**只占整包 ${pct(sec.pendingEvents, sec.total)}**——` +
    `若瓶颈是"事件池的分量"，能动的杠杆上限就是这个数（其余 ${pct(1 - sec.pendingEvents / sec.total, 1)} 在别的栏里）。`);

// 镜头次序：那一场的实体在实体段里排多前（"镜头被谁占着"）——★注意：**实体表里没有"事"，只有名字**
const lensOrder = (pack.entities || []).map((r) => r.id);
line('');
line(`★镜头次序：实体段共 ${lensOrder.length} 行，其中"那一场"的实体 ${lensOrder.filter((id) => crisisEnts.has(id)).length} 个（平均名次 ${(() => { const r = lensOrder.map((id, i) => (crisisEnts.has(id) ? i + 1 : null)).filter(Boolean); return r.length ? (r.reduce((a, b) => a + b, 0) / r.length).toFixed(1) : '-'; })()}）`);
line(`   ★但"排最前的不是那一场"**不等于"镜头里没有那一场"**——本装置第一版就把它读成"几乎无关"，是错的：`);
line(`   前 12 行里那一场的实体 = **${lensOrder.slice(0, 12).filter((id) => crisisEnts.has(id)).length} / 12**（= ${pct(lensOrder.slice(0, 12).filter((id) => crisisEnts.has(id)).length, 12)}）`);
line(`   ★关键在这里：实体表**只有 id/kind/name/location/parent** 这些列，没有 goal/title，所以"某个实体属不属于那一场"在**表的字面上根本看不出来**——`);
line(`     模型看到的是 619 行名字，"那一场"只体现在**未决事件栏／在飞盘算栏**（那两栏才有事）。`);
// ★前段集中度：实体段是按"四段确定性序"排的（①保送 ②手上有在办盘算 ③近 5 轮出手 ④id 序）
//   ⇒ "那一场"的实体天然占住前段。这一栏量的是"**模型最先读到的那几十行里，那一场占多少**"。
const band = (n) => {
    const slice = lensOrder.slice(0, Math.min(n, lensOrder.length));
    const hit = slice.filter((id) => crisisEnts.has(id)).length;
    return `${String(n).padStart(3)} 行里 ${String(hit).padStart(2)} 个（${pct(hit, slice.length).padStart(6)}）`;
};
line(`   ★前段集中度（实体段按"保送→在办盘算→近 5 轮出手→id 序"四段排）：${band(12)} · ${band(24)} · ${band(48)} · ${band(96)} · ${band(192)}`);
line(`     对照：整段 ${lensOrder.filter((id) => crisisEnts.has(id)).length} / ${lensOrder.length} = ${pct(lensOrder.filter((id) => crisisEnts.has(id)).length, lensOrder.length)}`);
line(`   前 12 行：${lensOrder.slice(0, 12).map((id) => nameOf(id)).join(' · ')}`);

// ★★ 地点分布：镜头是不是被"那一场的地理"占着（位置是自由文本，按账上真值分组）
const locCount = new Map();
for (const e of (world.entities || [])) {
    const l = String(e.location || '').trim() || '（未载）';
    locCount.set(l, (locCount.get(l) || 0) + 1);
}
const CRISIS_PLACES = /大荒|北山|南荒部洲|幽冥|南疆/;
const crisisPlaceRows = (world.entities || []).filter((e) => CRISIS_PLACES.test(String(e.location || ''))).length;
line('');
line(`★镜头的地盘（619 行实体的 location 分布 · 全账 ${(world.entities || []).length}）`);
line(`   ${[...locCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([l, n]) => `${l}×${n}`).join(' · ')}`);
line(`   落在"那一场的地理"（大荒/北山/南荒部洲/幽冥/南疆）：**${crisisPlaceRows} / ${(world.entities || []).length} = ${pct(crisisPlaceRows, (world.entities || []).length)}**`);

// ★★ 待启用名单在镜头里的**次序**（"递给模型的新面孔，排在多后面"）
const idleIds = (pack.idleFaces || []).map((f) => f.id);
const idleRank = idleIds.map((id) => ({ id, name: nameOf(id), rank: lensOrder.indexOf(id) }));
line('');
line(`★待启用名单（${idleIds.length} 人）在实体段里的**次序**（1 = 最前）：`);
line(`   ${idleRank.map((x) => `${x.name}#${x.rank < 0 ? '不在镜头' : x.rank + 1}`).join(' · ')}`);
const ranks = idleRank.filter((x) => x.rank >= 0).map((x) => x.rank + 1).sort((a, b) => a - b);
line(`   在镜头里 ${ranks.length} / ${idleIds.length} 人 · 名次中位 **${ranks.length ? ranks[Math.floor(ranks.length / 2)] : '-'}** / ${lensOrder.length} · 最好 ${ranks[0] ?? '-'} · 最差 ${ranks[ranks.length - 1] ?? '-'}`);
line(`   ⇒ 对照：那一场的实体平均名次 **${(() => { const r = lensOrder.map((id, i) => (crisisEnts.has(id) ? i + 1 : null)).filter(Boolean); return r.length ? (r.reduce((a, b) => a + b, 0) / r.length).toFixed(1) : '-'; })()}**（${crisisEnts.size} 个里 ${lensOrder.filter((id) => crisisEnts.has(id)).length} 个在镜头内）`);

// ---------------- 旧跑数回放：池子/占比随轮变化 ----------------
if (RUNS) {
    line('');
    line('★★ 旧跑数回放（leg39 那 5 次同起点 8 轮的 perTick，只读 JSON）');
    line('   口径：只读旧 JSON 里**当轮真实记下的**字段（本轮新生事件数 / 新线数与危机数 / 在飞盘算 / 顶层占用）。');
    line('   ★旧 JSON 没存每轮全量事件表 ⇒ 无法还原"那一刻包里有多少条未决事件"；此处只做趋势，不当判据。');
    for (const p of RUNS.split(',').map((s) => s.trim()).filter(Boolean)) {
        let j;
        try { j = JSON.parse(readFileSync(p, 'utf8')); } catch { line(`   ${p} —— 读不到（跳过）`); continue; }
        const ok = (j.perTick || []).filter((x) => x.ok);
        const lines_ = ok.flatMap((x) => x.newLines || []);
        const nUnrelated = lines_.filter((x) => !x.crisis).length;
        const evs = ok.flatMap((x) => x.newEventDetail || []);
        const nEvUnrelated = evs.filter((x) => !x.crisis).length;
        const per = ok.map((x) => ({
            t: x.t, tick: x.tickAfter, bornEv: (x.bornEvents || []).length,
            newLines: (x.newLines || []).length, crisisLines: x.newLinesCrisis ?? 0,
            newEv: (x.newEventDetail || []).length,
            crisisEv: (x.newEventDetail || []).filter((y) => y.crisis).length,
            openNow: x.openNow, topLevel: x.topLevelNow, warn: x.warnings,
        }));
        line('');
        line(`   ── ${p.split('/').pop()}（${j.variant}）· 新线 ${lines_.length} 条 / 无关 **${nUnrelated}**（${pct(nUnrelated, lines_.length)}）· 新事件 ${evs.length} 条 / 无关 ${nEvUnrelated}（${pct(nEvUnrelated, evs.length)}）`);
        line(`      轮 · 本轮新生事件(危机) · 本轮新线(危机) · 在飞盘算 · 顶层占用 · 警告`);
        for (const r of per) line(`      ${String(r.t).padStart(2)} · ${String(r.newEv).padStart(2)}(${String(r.crisisEv).padStart(2)}) · ${String(r.newLines).padStart(2)}(${String(r.crisisLines).padStart(2)}) · ${String(r.openNow ?? '-').padStart(2)} · ${String(r.topLevel ?? '-').padStart(2)}/${j.perTick[0]?.topLevelCap ?? '-'} · ${r.warn ?? '-'}`);
    }
}

line('');
line('（本装置纯只读：不写任何仓库文件、不建变体、不调模型；真账按只读方式打开。）');
