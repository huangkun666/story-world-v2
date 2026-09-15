// story-world-v2/demo/measure-leg40-roots-live.js
// leg40 · 端到端实证（**真账走副本，不动用户数据**）：世界源起根 → 线头进包 → 模型接不接。
//
// 验的三件（对应本棒落地的三步）：
//   ① **起根**：真调模型读《大荒-姬元真》正文 ⇒ 出几条"书里正在发生的事" ⇒ 净化 + 落成账上的线头事件
//      （当事人必须**账上真有**，对不上就丢；书里原话随根留档）。
//   ② **进包**：`buildEvolutionPack` 的 `openRoots`/`threads` 两栏要把这些新根认出来（机械口径）。
//   ③ **接不接**：真模型跑 N 轮，看**新根被接续的比例**（对照：本棒 4 臂实测起点线头接续 1/13 → 4/13）。
//
// 用法：
//   node demo/measure-leg40-roots-live.js --roots-only --out F:/deepseek/tmp/leg40-roots.json
//   node demo/measure-leg40-roots-live.js --ticks 8 --out F:/deepseek/tmp/leg40-roots-live.json
import { readFileSync, writeFileSync } from 'node:fs';
import { runTick } from '../src/tick.js';
import { buildEvolutionPack, packTextOf, computeOpenRoots, computeThreads } from '../src/pack.js';
import { seedRoots, buildSeedRootsPrompt, SEED_ROOTS_TOP } from '../src/seed-roots.js';

const args = process.argv.slice(2);
const hasFlag = (n) => args.includes(n);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const ST_DATA = 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user';
const WORLD_PATH = argVal('--world', `${ST_DATA}/chats/大荒z/大荒z - 2026-09-01@00h37m41s559ms.jsonl`);
const BOOK_PATH = argVal('--book', `${ST_DATA}/worlds/大荒-姬元真.json`);
const TICKS = Math.max(0, parseInt(argVal('--ticks', '0'), 10) || 0);
const OUT = argVal('--out', '');
const CRISIS_RE = /死煞|幽冥|大荒|劫气|杀劫|浊流|煞|镇魔|超度|南疆|北山/;   // 与历次读数同一把尺子
const line = (s) => console.log(s);
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : 'n/a');

function loadRealWorld(path) {
    const raw = readFileSync(path, 'utf8');
    const nl = raw.indexOf('\n');
    const box = JSON.parse(nl < 0 ? raw : raw.slice(0, nl))?.chat_metadata?.story_world_v2;
    if (!box?.world) throw new Error('真账里没有 world');
    return box.world;
}
// 世界书正文（与 web/index.js 的 bookTextForRoots 同一格式：## 条目名 + 正文）
function loadBookText(path) {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    const entries = j.entries && !Array.isArray(j.entries) ? Object.values(j.entries) : (j.entries || []);
    const text = entries.map((e) => `## ${String(e?.comment || e?.key?.[0] || '').trim()}\n${String(e?.content ?? '')}`).join('\n\n');
    return { text, entries: entries.length };
}

line('═══ leg40 · 世界源起根（端到端 · 真账走副本）═══');
const world0 = loadRealWorld(WORLD_PATH);
const book = loadBookText(BOOK_PATH);
line(`真账副本：${WORLD_PATH}`);
line(`起点 tick ${world0.meta?.tick} · 实体 ${(world0.entities || []).length} · 未决事件 ${(world0.events || []).filter((e) => !e.closed).length} · 线头 ${computeOpenRoots(world0).length}`);
line(`世界源：${BOOK_PATH}（${book.entries} 条 · ${book.text.length} 字符）`);

const { resolveWorldTransport } = await import('../src/st-preset.js');
const resolved = resolveWorldTransport();
if (!resolved) { console.error('✗ 未找到模型配置'); process.exit(1); }
line(`真模型：${resolved.model}`);

let world = structuredClone(world0);
const before = { roots: computeOpenRoots(world).length };

// ① 起根（真调用）
//   ★`--force`：把 `minRoots` 抬到天上 ⇒ 绕过"线头够用就不种"的闸。
//     为什么需要它：本棒实测真账**已经有 13 条线头**（都是危机口音），闸会判定"够用"⇒ 一条都不种
//     ⇒ 而这一格要验的正是"**干净的根**能不能种进来、能不能被接上"。生产上是否对存量世界强制种一次，
//     是**要用户拍板的那一格**（见交接 §待拍），本装置只出数、不改生产判据。
const minRoots = hasFlag('--force') ? 9999 : 3;
const t0 = Date.now();
const seedRes = await seedRoots({
    ssot: world, sourceText: book.text, extract: resolved.transport, fingerprint: `leg40-live:${book.text.length}`, at: new Date().toISOString(), minRoots,
});
line('');
line(`① 起根：ok=${seedRes.ok} · 种下 **${seedRes.seeded ?? 0}** 条 · 用时 ${Math.round((Date.now() - t0) / 1000)}s${hasFlag('--force') ? '（--force：绕过"线头够用"闸）' : ''}`);
if (seedRes.skipped) line(`   （跳过：${seedRes.reason}）`);
if (seedRes.errors?.length) line(`   错误：${seedRes.errors.join(' | ')}`);
if (seedRes.warnings?.length) line(`   净化剔除 ${seedRes.warnings.length} 条：${seedRes.warnings.slice(0, 4).join(' | ')}`);
for (const id of seedRes.ids || []) {
    const e = world.events.find((x) => x.id === id);
    line(`   ${id} @${String(e.position || '未载').padEnd(10)} 人=[${e.ripples.map((r) => world.entities.find((x) => x.id === r)?.name || r).join('、')}] 「${e.title}」`);
    line(`        书里原话：「${String(e.seedFrom?.quote).slice(0, 50)}」`);
}

// ② 进包
const pack = buildEvolutionPack(world, null).pack;
const roots = computeOpenRoots(world);
const threads = computeThreads(world);
line('');
line(`② 进包：线头 ${before.roots} → **${roots.length}** 条 · 线捆 ${threads.length} 条`);
for (const t of threads) line(`   ${t.id} 「${t.title}」@${t.position} 人=[${t.people.join('、')}]`);
const seedInThreads = threads.filter((t) => (seedRes.ids || []).includes(t.id)).length;
line(`   ★世界源起的根进了线捆：**${seedInThreads} / ${threads.length}**（说明"新颖度排序"真把它们排到了前面）`);

// ③ 真跑 N 轮
let ticks = [];
if (TICKS > 0) {
    line('');
    line(`③ 真跑 ${TICKS} 轮（看新根被不被接续）`);
    const seedIds = new Set(seedRes.ids || []);
    const everRef = new Set();
    for (let t = 1; t <= TICKS; t += 1) {
        const tickBefore = world.meta?.tick;
        const beforeEv = new Set((world.events || []).map((x) => x.id));
        const beforeAg = new Set((world.agendas || []).map((x) => x.id));
        const threadsNow = computeThreads(world);
        const r = await runTick({ transport: resolved.transport, ssot: world, dialogue: '', extractCtx: {}, calls: 1 });
        const row = { t, tickBefore, ok: r.ok, error: r.ok ? null : String(r.error).slice(0, 160), threads: threadsNow.map((x) => x.id) };
        if (r.ok) {
            world = r.ssot;
            const freshEv = (world.events || []).filter((e) => !beforeEv.has(e.id));
            const freshAg = (world.agendas || []).filter((a) => !beforeAg.has(a.id));
            row.refs = [...new Set(freshEv.map((e) => e.source?.ref).filter(Boolean))];
            for (const id of row.refs) everRef.add(id);
            row.pushed = threadsNow.filter((x) => row.refs.includes(x.id)).map((x) => x.id);
            row.newLines = freshAg.map((a) => ({ goal: String(a.goal || '').slice(0, 40), type: a.source?.type || '无', crisis: CRISIS_RE.test(String(a.goal)) }));
            row.newEvents = freshEv.map((e) => ({ title: e.title, position: e.position, crisis: CRISIS_RE.test(String(e.title)) }));
            row.warnings = (r.stage?.warnings || []).length;
        }
        ticks.push(row);
        line(`   第 ${t} 轮 ${tickBefore}→${r.ok ? world.meta.tick : '✗'} | 点名线捆 ${threadsNow.length} 条 ⇒ 被推 **${row.pushed?.length ?? '-'}**${row.pushed?.length ? ` [${row.pushed.join(' ')}]` : ''} | 新事件 ${row.newEvents?.length ?? '-'}（危机 ${(row.newEvents || []).filter((x) => x.crisis).length}）· 新线 ${row.newLines?.length ?? '-'} · 警告 ${row.warnings ?? '-'}`);
        if (!r.ok) line(`      ✗ ${row.error}`);
    }
    const asked = ticks.reduce((n, x) => n + (x.threads?.length || 0), 0);
    const pushed = ticks.reduce((n, x) => n + (x.pushed?.length || 0), 0);
    const seedAdopted = [...seedIds].filter((id) => everRef.has(id));
    const seedReferenced = [...seedIds].filter((id) => {
        // 被当 rc 引用的另一种形态：新线的 source.ref 指向它（含盘算挂上）
        return ticks.some((x) => (x.refs || []).includes(id));
    });
    const lines_ = ticks.flatMap((x) => x.newLines || []);
    const evs = ticks.flatMap((x) => x.newEvents || []);
    line('');
    line('③ 收口：');
    line(`   ★线捆推进率：${pushed} / ${asked} = **${pct(pushed, asked)}**（本棒 4 臂对照：threads 臂 62.5%）`);
    line(`   ★**世界源起的根被接续：${seedAdopted.length} / ${seedIds.size}**${seedAdopted.length ? ` [${seedAdopted.join(' ')}]` : ''}`);
    line(`   新线 ${lines_.length} 条 · 其中与危机无关 ${lines_.filter((x) => !x.crisis).length}（${pct(lines_.filter((x) => !x.crisis).length, lines_.length)}）`);
    line(`   新生事件 ${evs.length} 条 · 其中与危机无关 ${evs.filter((x) => !x.crisis).length}（${pct(evs.filter((x) => !x.crisis).length, evs.length)}）`);
    line(`   未决事件池 ${(world0.events || []).filter((e) => !e.closed).length} → ${(world.events || []).filter((e) => !e.closed).length} · 线头 ${computeOpenRoots(world).length}`);
}

if (OUT) {
    writeFileSync(OUT, JSON.stringify({
        start: { tick: world0.meta?.tick, roots: before.roots },
        seed: { ok: seedRes.ok, seeded: seedRes.seeded, ids: seedRes.ids, warnings: seedRes.warnings, skipped: seedRes.skipped },
        seeds: (seedRes.ids || []).map((id) => { const e = world.events.find((x) => x.id === id); return e && { id, title: e.title, position: e.position, quote: e.seedFrom?.quote, ripples: e.ripples }; }),
        threads, seedInThreads, ticks,
    }, null, 2));
    line(`\n出数已留档：${OUT}`);
}
void hasFlag; void packTextOf; void SEED_ROOTS_TOP; void buildSeedRootsPrompt;
