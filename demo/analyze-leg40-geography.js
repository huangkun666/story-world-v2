// story-world-v2/demo/analyze-leg40-geography.js
// leg40 · 出数装置（**纯只读、零调用**）：量"故事是不是只在那一场的地盘上发生"。
//
// 为什么量这个（本棒读数把靶子换了）：
//   leg39 的三条判据里，"与危机无关的新线"是**词表判语义**（`CRISIS_RE`）⇒ 实测偏差极大：
//   `大荒` 既是**地名**又是那场灾难的名字、`南疆/北山` 同理，单字 `煞` 更滥。
//   逐条看下来，被判"危机"的新线里 13 条是"[趁/借/潜入] 大荒[某处] 干自己的事"——
//   **它们本来就是自己的线**（各有去处、各有人），只是**地名撞了词表**。
//   ⇒ 换成**结构性判据**（ANCHOR §4.8 立的规矩：不许用词表判语义）：
//     ① **地名新不新**：新生事件落在"起点那一场的地盘"里，还是落在别处？
//     ② **人新不新**：新生事件波及的人里，有没有"从没被那一场点过名"的？
//   这两条都能从账上机械算出来，且**与用词无关**。
//
// 用法：node demo/analyze-leg40-geography.js [--runs a.json,b.json] [--world <真账>]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const ST_DATA = 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user';
const WORLD_PATH = argVal('--world', `${ST_DATA}/chats/大荒z/大荒z - 2026-09-01@00h37m41s559ms.jsonl`);
const RUNS = argVal('--runs', [
    'F:/deepseek/tmp/leg39-base.json', 'F:/deepseek/tmp/leg39-newprompt.json',
    'F:/deepseek/tmp/leg39-np-r1.json', 'F:/deepseek/tmp/leg39-np-r2.json', 'F:/deepseek/tmp/leg39-np-r3.json',
    'F:/deepseek/tmp/leg40-base.json',
].join(','));
const line = (s) => console.log(s);
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(0)}%` : 'n/a');

function loadRealWorld(path) {
    const raw = readFileSync(path, 'utf8');
    const nl = raw.indexOf('\n');
    const header = JSON.parse(nl < 0 ? raw : raw.slice(0, nl));
    const box = header?.chat_metadata?.story_world_v2;
    if (!box?.world) throw new Error('真账里没有 world');
    return box.world;
}

// 起点那一场的"地盘"与"那批人"（全机械：未决事件池最大连通分量）
function rootProfile(world) {
    const open = (world.events || []).filter((e) => !e.closed);
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
    const root = new Set(comps[0] || []);
    // ★"未明"这类**没值的位置**不算地盘（"空着就是空着"——它是"未载"，不是一处地方）。
    //   本装置第一版把它当地盘算，结果把一批本在别处的新事错判成"落在那一场里"，已修正。
    const VAGUE = new Set(['未明', '未载', '未知', '']);
    const places = new Set(); const people = new Set();
    for (const e of open) if (root.has(e.id)) {
        const pos = String(e.position || '').trim();
        if (pos && !VAGUE.has(pos)) places.add(pos);
        for (const r of e.ripples || []) people.add(r);
    }
    return { rootSize: root.size, openSize: open.length, places, people, rootEvents: root };
}

const world0 = loadRealWorld(WORLD_PATH);
const prof = rootProfile(world0);
const nameOf = new Map((world0.entities || []).map((e) => [e.id, e.name]));
line('═══ leg40 · 故事落点分析（结构性判据 · 零调用）═══');
line(`起点 tick ${world0.meta?.tick}：未决事件 ${prof.openSize}（最大分量 ${prof.rootSize}）· 那一场的地盘 **${prof.places.size}** 处：${[...prof.places].join(' / ')}`);
line(`那一场点过名的人：**${prof.people.size}** 个（${[...prof.people].slice(0, 12).map((id) => nameOf.get(id) || id).join('、')}…）`);
line('');

const agg = [];
for (const p of RUNS.split(',').map((s) => s.trim()).filter(Boolean)) {
    let j;
    try { j = JSON.parse(readFileSync(p, 'utf8')); } catch { line(`${p} —— 读不到（跳过）`); continue; }
    const ok = (j.perTick || []).filter((x) => x.ok);
    const evs = ok.flatMap((x) => x.newEvents || x.newEventDetail || []);
    const rows = evs.map((e) => {
        const pos = String(e.position || '未载');
        return { title: e.title, pos, inCrisisPlace: prof.places.has(pos), type: e.type || '无' };
    });
    const fresh = rows.filter((r) => !r.inCrisisPlace);
    const byPlace = new Map();
    for (const r of rows) byPlace.set(r.pos, (byPlace.get(r.pos) || 0) + 1);
    agg.push({ file: p.split('/').pop(), n: rows.length, fresh: fresh.length, places: byPlace });
    line(`── ${p.split('/').pop()} · 新生事件 ${rows.length} 条 · **落在"那一场的地盘"之外的 ${fresh.length} 条（${pct(fresh.length, rows.length)}）**`);
    line(`   落点分布：${[...byPlace.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${prof.places.has(k) ? '★' : ''}${k}×${v}`).join(' · ')}`);
    const freshSamples = fresh.slice(0, 6).map((r) => `「${r.title}」@${r.pos}`);
    if (freshSamples.length) line(`   地盘外的例子：${freshSamples.join(' · ')}`);
}
line('');
const tot = agg.reduce((n, a) => n + a.n, 0); const totFresh = agg.reduce((n, a) => n + a.fresh, 0);
line(`★合计：${tot} 条新生事件里 ${totFresh} 条落在那一场的地盘之外 = **${pct(totFresh, tot)}**`);
line('★读法：如果这个数很高，说明"模型其实没被锁在那一场"——锁住它的是**别的东西**（本棒的静态量体指向"那一场的事实在包里的位置与次序"）。');
