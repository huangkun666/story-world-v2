// story-world-v2/demo/run-leg40b-seedmax.mjs
// leg40b · "最大化开闸"运行器（**真模型 · 真账走副本 · 仓库零改动**）。
//
// 跑一趟 = ① 走**初始化那条起根路**（分块全书 + 候选池，与 `web/index.js` 的 `seedRootsForWorld` 同构）
//          ② 落盘**逐块读数** `chunkLog`（★上一棒缺的那一格：生产里算了却被覆盖）
//          ③ 再真跑 `--ticks` 轮世界步，量"百花齐放"到底开出来没有。
//
// 用法：
//   SW2_SEEDMAX_ARM=gate node demo/run-leg40b-seedmax.mjs <SW2_TMP> --ticks 1 --out F:/deepseek/tmp/leg40b-gate.json
//   ★必须带 `--import <SW2_TMP>/loader.mjs`（生成器会打印 SW2_TMP；或本脚本自动读环境变量 SW2_TMP）
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const ST_DATA = 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user';
const WORLD_PATH = argVal('--world', `${ST_DATA}/chats/大荒z1/大荒z - 2026-09-14@16h54m07s001ms.jsonl`);
const BOOK_PATH = argVal('--book', `${ST_DATA}/worlds/大荒-姬元真.json`);
const TICKS = Math.max(0, parseInt(argVal('--ticks', '1'), 10) || 0);
const OUT = argVal('--out', '');
const ARM = process.env.SW2_SEEDMAX_ARM || 'base';
const SEED_FROM = argVal('--seed-from', '');      // ★复用另一跑已经种好的那批根 ⇒ 分数臂之间**种子完全相同**（更公平、也更省调用）
const MORE = ARM === 'max' || ARM === 'wide';
const WIDE = ARM === 'wide' || ARM === 'wideN';
const line = (s) => console.log(s);
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : 'n/a');

// ★被 loader 重定向的模块（所以这里 import 到的是**对应臂的副本**）
const { seedRootsChunked, chunkBookText, shouldSeedRoots, SEED_ROOTS_TOP, SEED_ROOTS_MAX, SEED_CHUNK_CHAR, SEED_CANDIDATES_TOP, buildSeedRootsPrompt } = await import('../src/seed-roots.js');
const { computeOpenRoots, computeThreads } = await import('../src/pack.js');
const { AGENDA_CAPS } = await import('../src/settle.js');
const { runTick } = await import('../src/tick.js');
const { resolveWorldTransport } = await import('../src/st-preset.js');

function loadRealWorld(path) {
    const raw = readFileSync(path, 'utf8');
    const nl = raw.indexOf('\n');
    const box = JSON.parse(nl < 0 ? raw : raw.slice(0, nl))?.chat_metadata?.story_world_v2;
    if (!box?.world) throw new Error('真账里没有 world');
    return box.world;
}
// 起根读的那段文本 = 初始化口径（`composeInitSource`）⇒ 世界书条目 `【条目名】正文` 逐行拼
function bookAsInitText(path) {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    const entries = j.entries && !Array.isArray(j.entries) ? Object.values(j.entries) : (j.entries || []);
    const text = entries.map((e) => `【${String(e?.comment || e?.key?.[0] || '').trim()}】${String(e?.content ?? '').trim()}`).join('\n');
    return { text, entries: entries.length };
}

line('═══ leg40b · 最大化开闸（初始化起根路 · 真模型 · 真账走副本）═══');
line(`臂 = **${ARM}**（base / gate / max）· 调度闸 AGENDA_CAPS = ${JSON.stringify(AGENDA_CAPS)}`);
line(`闸现值：SEED_ROOTS_TOP=${SEED_ROOTS_TOP} · SEED_ROOTS_MAX=${SEED_ROOTS_MAX} · SEED_CHUNK_CHAR=${SEED_CHUNK_CHAR} · SEED_CANDIDATES_TOP=${SEED_CANDIDATES_TOP}`);

// ★干跑自证（不烧模型调用）：① 重定向真的生效了（读到的是副本）② 三个开关与臂一致
//   ③ 开闸时闸真的不咬了（净化不再截条数）——用一段假 JSON 真跑 `sanitizeSeedRoots` 验证。
if (args.includes('--probe')) {
    const { sanitizeSeedRoots } = await import('../src/seed-roots.js');
    // ★假根的**当事人必须各不相同**——净化规则里有一条"当事人已在前面的根里出现过 ⇒ 这条丢"
    //   （防同一个根被拆成多条）。我第一版 30 条全用「甲」⇒ 只留下 1 条，探针自己骗了自己。
    const fake = { roots: Array.from({ length: 30 }, (_, i) => ({ title: `假根${i}`, position: '某地', parties: [`甲${i}`], quote: `原话${i}` })) };
    const clean = sanitizeSeedRoots(fake, { max: null });
    const clean2 = sanitizeSeedRoots(fake);      // 不开闸那条路：走缺省 max（= SEED_ROOTS_MAX）
    const uncap = Boolean(process.env.SW2_SEEDMAX_ARM && process.env.SW2_SEEDMAX_ARM !== 'base');
    line('');
    line('【--probe 干跑自证】');
    line(`  实际生效的 sanitizeSeedRoots 源码里带 UNCAP 补丁吗：${sanitizeSeedRoots.toString().includes('__SW2_SEED_UNCAP__')}（开闸臂应为 true）`);
    line(`  全局开关：__SW2_SEED_UNCAP__=${globalThis.__SW2_SEED_UNCAP__} · __SW2_AGENDA_UNCAPPED__=${globalThis.__SW2_AGENDA_UNCAPPED__}`);
    line(`  AGENDA_CAPS.perTick=${AGENDA_CAPS.perTick}（max 臂应为 99，其余 3）`);
    line(`  净化 30 条假根 · max=null   ⇒ ${clean.roots.length} 条（开闸应 30；未开闸应 1，因 Math.min(null,8)=0 ⇒ 第一条就 break）`);
    line(`  净化 30 条假根 · 走缺省值   ⇒ ${clean2.roots.length} 条（两臂都应 8 = SEED_ROOTS_MAX，除非开闸）`);
    line(`  剔除理由前 3 条：${(clean2.warnings || []).slice(0, 3).join(' | ') || '（无）'}`);
    const okSwitch = globalThis.__SW2_SEED_UNCAP__ === uncap && globalThis.__SW2_AGENDA_UNCAPPED__ === MORE && globalThis.__SW2_THREADS_ALL__ === WIDE;
    const okUncap = uncap ? (clean.roots.length === 30 && clean2.roots.length === 30) : (clean.roots.length === 1 && clean2.roots.length === 8);
    const okSched = MORE ? AGENDA_CAPS.perTick === 99 : AGENDA_CAPS.perTick === 3;
    const threadsNow = computeThreads({ entities: [], events: Array.from({ length: 9 }, (_, i) => ({ id: `ev_9_${i}`, title: `线${i}`, ripples: [], closed: false })), agendas: [] });
    const okThreads = WIDE ? threadsNow.length === 9 : threadsNow.length === 3;
    const ok = okSwitch && okUncap && okSched && okThreads;
    line(`  递送端：9 条线头 ⇒ 线捆 ${threadsNow.length} 条（开闸 9；未开 3）`);
    line(`  ⇒ 开关对=${okSwitch} · 闸真开了=${okUncap} · 调度对=${okSched} · 递送端对=${okThreads} ⇒ ${ok ? '✓ 与臂一致，可以烧调用' : '✗ 不一致（先修装置）'}`);
    process.exit(ok ? 0 : 3);
}

const world0 = loadRealWorld(WORLD_PATH);
const book = bookAsInitText(BOOK_PATH);
line(`起点世界：${WORLD_PATH}`);
line(`  tick ${world0.meta?.tick} · 实体 ${(world0.entities || []).length} · 事件 ${(world0.events || []).length}（未决 ${(world0.events || []).filter((e) => !e.closed).length}）· 线头 ${computeOpenRoots(world0).length}`);
line(`世界源：${BOOK_PATH}（${book.entries} 条 · ${book.text.length} 字符）`);

const resolved = resolveWorldTransport();
if (!resolved) { console.error('✗ 未找到模型配置'); process.exit(1); }
line(`真模型：${resolved.model}`);

// 抽取调用（与 web/index.js 的 diagExtract 同治法：裸串 / {text} 双形都吃）
let calls = 0;
const extract = async (p) => {
    calls += 1;
    const res = await resolved.transport(p);
    const text = typeof res === 'string' ? res : (res && typeof res.text === 'string' ? res.text : '');
    if (!text.trim()) throw new Error(`空响应（输入 ${Array.from(String(p)).length} 字符）`);
    return text;
};

// ★主调用的**输出体量**捕获（本装置新增；起因：用户问"是不是被厂商输出预算限制"）——
//   判据要的是"活跃一轮写了多少 token、有没有撞 16384"，而此前所有装置只记了**入参** token。
//   `runTick` 内部调 `transport(prompt)` 拿裸文本 ⇒ 包一层即可（不改引擎）。
let lastOut = null;
const mainTransport = async (p) => {
    const t0 = Date.now();
    const out = await resolved.transport(p);
    const text = typeof out === 'string' ? out : (out && typeof out.text === 'string' ? out.text : '');
    lastOut = {
        ms: Date.now() - t0,
        chars: Array.from(text).length,
        tokEst: Math.round(Array.from(text).length / 1.6),   // 与 pack.TOKEN_RATIO 同口径
        head: text.replace(/\s+/g, ' ').slice(0, 120),
    };
    return out;
};

// ---------- ① 起根（初始化那条路的同构：分块 + 候选池） ----------
let world = structuredClone(world0);   // ★必须 let：第 ③ 步 `world = r.ssot`（第一版写成 const，跑到世界步当场 TypeError）
const named = new Set();
for (const e of world.events || []) for (const r of e.ripples || []) named.add(r);
const pool = (world.entities || [])
    .filter((e) => (e.status || 'active') === 'active' && !named.has(e.id) && e.id !== world.context?.playerId)
    .filter((e) => typeof e.name === 'string' && e.name.length >= 2 && e.name.length <= 12)
    .map((e) => e.name).slice(0, SEED_CANDIDATES_TOP);

const chunks = chunkBookText(book.text, SEED_CHUNK_CHAR);
line('');
line(`① 起根：分块 ${chunks.length} 块 · 候选池 ${pool.length} 人 · 逐块字符 = [${chunks.map((c) => Array.from(c).length).join(', ')}]`);
const gate = shouldSeedRoots(world, { fingerprint: 'leg40b-probe', minRoots: 3 });
line(`   幂等闸：${gate.reason}（本装置绕开它：要看的是**起根本身**能出多少条）`);

const t0 = Date.now();
const chunkLog = [];
let seedRes = null;
let seeds = [];
// ★`--seed-from <json>`：直接复用另一跑**已经种好的那批根**（逐字照搬，含书里原话与当事人）
//   ⇒ 分数臂之间**种子完全相同**，差异只来自"递送/调度"那几道闸（更公平），也省掉 10 次抽取调用。
if (SEED_FROM) {
    const prev = JSON.parse(readFileSync(SEED_FROM, 'utf8'));
    const srcWorld = loadRealWorld(WORLD_PATH);      // 同一个起点世界（装置固定从最新聊天取）⇒ 实体 id 能对上
    const taken = new Set((world.events || []).map((e) => e.id));
    let n = 1;
    const added = [];
    for (const s of prev.seeds || []) {
        while (taken.has(`ev_seed_${n}`)) n += 1;
        const id = `ev_seed_${n}`;
        taken.add(id);
        const ripples = (s.people || []).map((nm) => (srcWorld.entities || []).find((e) => e.name === nm)?.id).filter(Boolean);
        if (!ripples.length) continue;               // 当事人对不上就不种（与生产同一条纪律）
        world.events.push({
            id, title: s.title, source: { type: 'seed' },
            position: s.position || undefined, ripples, closed: false,
            seedFrom: { quote: s.quote, fingerprint: `leg40b:replay:${prev.arm}`, at: new Date().toISOString(), tick: 0 },
        });
        added.push(id);
    }
    seeds = added.map((id) => {
        const e = world.events.find((x) => x.id === id);
        return { id, title: e.title, position: e.position, people: e.ripples.map((r) => world.entities.find((x) => x.id === r)?.name || r), quote: e.seedFrom?.quote };
    });
    line('');
    line(`① 起根：**跳过**（--seed-from ${SEED_FROM}）⇒ 逐字复用 ${added.length} 条根（来自 ${prev.arm} 臂）`);
    for (const s of seeds) line(`     ${s.id} @${String(s.position || '未载').padEnd(14)} [${s.people.join('、')}] 「${s.title}」`);
} else {
    line('');
    line(`① 起根：分块 ${chunks.length} 块 · 候选池 ${pool.length} 人 · 逐块字符 = [${chunks.map((c) => Array.from(c).length).join(', ')}]`);
    const gate = shouldSeedRoots(world, { fingerprint: 'leg40b-probe', minRoots: 3 });
    line(`   幂等闸：${gate.reason}（本装置绕开它：要看的是**起根本身**能出多少条）`);
    const res = await seedRootsChunked({
        ssot: world, chunks, extract, candidates: pool,
        fingerprint: `leg40b:${ARM}:${Array.from(book.text).length}`, at: new Date().toISOString(),
        maxPerChunk: ARM === 'base' ? Math.max(1, Math.ceil(SEED_ROOTS_MAX / Math.max(1, Math.min(chunks.length, 4)))) : null,
        dedupeAcrossChunks: ARM === 'base',
        mergeExisting: false,            // 幂等闸不挡（要看起根本身）
        onProgress: (e) => {
            chunkLog.push({ index: e.index, chars: e.chars, ok: e.ok, got: e.got, error: e.error || null });
            line(`   块 ${String(e.index).padStart(2)}/${e.count} · ${String(e.chars).padStart(6)} 字 ⇒ ${e.ok ? `拿到 ${e.got} 条` : `✗ ${e.error}`}`);
        },
    });
    seedRes = res;
    line(`   小结：ok=${res.ok} · 落账 **${res.seeded ?? 0}** 条 · 调用 ${calls} 次 · 用时 ${Math.round((Date.now() - t0) / 1000)}s`);
    if (res.warnings?.length) line(`   净化剔除 ${res.warnings.length} 条：${res.warnings.slice(0, 5).join(' | ')}`);
    if (res.errors?.length) line(`   错误：${res.errors.slice(0, 3).join(' | ')}`);
    seeds = (res.ids || []).map((id) => {
        const e = world.events.find((x) => x.id === id);
        return { id, title: e?.title, position: e?.position, people: (e?.ripples || []).map((r) => world.entities.find((x) => x.id === r)?.name || r), quote: e?.seedFrom?.quote };
    });
    line('');
    line(`   种下的根（${seeds.length} 条）：`);
    for (const s of seeds) line(`     ${s.id} @${String(s.position || '未载').padEnd(14)} [${s.people.join('、')}] 「${s.title}」`);
}
const secs = Math.round((Date.now() - t0) / 1000);

// ---------- ② 逐块读数表（★上一棒缺的那一格） ----------
const gotTotal = chunkLog.reduce((n, c) => n + (c.got || 0), 0);
const emptyChunks = chunkLog.filter((c) => !c.got).length;
line('');
line(`② 逐块读数：返回合计 ${gotTotal} 条 · 落账 ${seeds.length} 条 ⇒ 被去重/上限丢 ${gotTotal - seeds.length} 条 · 空手块 ${emptyChunks}/${chunkLog.length}`);
line(`   按块：${chunkLog.map((c) => `${c.index}:${c.ok ? c.got : '✗'}`).join(' ')}`);

// ---------- ③ 真跑 N 轮 ----------
const ticks = [];
if (TICKS > 0) {
    line('');
    line(`③ 真跑 ${TICKS} 轮（量"百花齐放"：新线/新事件/线头走势）`);
    for (let t = 1; t <= TICKS; t += 1) {
        const tickBefore = world.meta?.tick;
        const beforeEv = new Set((world.events || []).map((x) => x.id));
        const beforeAg = new Set((world.agendas || []).map((x) => x.id));
        const threadsNow = computeThreads(world);
        const openNow = computeOpenRoots(world).length;
        lastOut = null;
        const r = await runTick({ transport: mainTransport, ssot: world, dialogue: '', extractCtx: {}, calls: 1 });
        const row = { t, tickBefore, threads: threadsNow.map((x) => x.id), openRootsBefore: openNow, ok: r.ok, error: r.ok ? null : String(r.error).slice(0, 200), out: lastOut };
        if (r.ok) {
            world = r.ssot;
            const freshEv = (world.events || []).filter((e) => !beforeEv.has(e.id));
            const freshAg = (world.agendas || []).filter((a) => !beforeAg.has(a.id));
            row.refs = [...new Set(freshEv.map((e) => e.source?.ref).filter(Boolean))];
            row.pushed = threadsNow.filter((x) => row.refs.includes(x.id)).map((x) => x.id);
            row.newEvents = freshEv.map((e) => ({ title: e.title, position: e.position, ref: e.source?.ref }));
            row.newAgendas = freshAg.map((a) => ({ goal: String(a.goal || '').slice(0, 50), type: a.source?.type || '无', ref: a.source?.ref }));
            row.warnings = (r.stage?.warnings || []).length;
            row.openRootsAfter = computeOpenRoots(world).length;
        }
        ticks.push(row);
        line(`   第 ${t} 轮 ${tickBefore}→${r.ok ? world.meta.tick : '✗'} | 线头 ${openNow} ⇒ 点名线捆 ${threadsNow.length} 条 ⇒ 被推 **${row.pushed?.length ?? '-'}** | 新事件 ${row.newEvents?.length ?? '-'} · **新线 ${row.newAgendas?.length ?? '-'}** | 线头后 ${row.openRootsAfter ?? '-'} | 警告 ${row.warnings ?? '-'}`);
        if (row.out) line(`        ★主调用输出：${row.out.chars} 字符 ≈ ${row.out.tokEst} token（上限定案 16384 ⇒ 占 ${(100 * row.out.tokEst / 16384).toFixed(1)}%）· 用时 ${(row.out.ms / 1000).toFixed(1)}s`);
        for (const a of row.newAgendas || []) line(`        + 新线：${a.type}${a.ref ? `→${a.ref}` : ''} 「${a.goal}」`);
        if (!r.ok) line(`      ✗ ${row.error}`);
    }
    // ★"百花齐放"的三种读法（同一批数据，三种口径——防只看一种被误导）
    const allAg = ticks.flatMap((x) => x.newAgendas || []);
    const allEv = ticks.flatMap((x) => x.newEvents || []);
    const fromSeed = (list) => list.filter((x) => String(x.ref || '').startsWith('ev_seed_') || (x.type === 'event' && String(x.ref || '').startsWith('ev_seed_')));
    const newFromSeeds = allEv.filter((x) => String(x.ref || '').startsWith('ev_seed_'));
    line('');
    line(`③ 收口（${TICKS} 轮合计）：`);
    line(`   ★口径一「增量」：新线 ${allAg.length} 条（均 ${(allAg.length / TICKS).toFixed(1)}/轮）· 新事件 ${allEv.length} 件（均 ${(allEv.length / TICKS).toFixed(1)}/轮）`);
    line(`   ★口径二「散度」：不同地点 ${new Set(allEv.map((x) => x.position || '未载')).size} 处 · 不同新线目标 ${new Set(allAg.map((x) => x.goal)).size} 个`);
    const seedGen = new Set(seeds.map((s) => s.id));
    const everRef = new Set(allEv.map((x) => x.ref).filter((r) => seedGen.has(r)));
    const agRef = new Set(allAg.map((x) => x.ref).filter((r) => seedGen.has(r)));
    const touched = new Set([...everRef, ...agRef]);
    line(`   ★口径三「浇了几条种子」：${touched.size} / ${seedGen.size} = ${pct(touched.size, seedGen.size)}（新事件直接挂种子的 ${newFromSeeds.length} 件）`);
    line(`   线头走势：${ticks.map((x) => `${x.openRootsBefore}→${x.openRootsAfter ?? '✗'}`).join(' · ')}`);
    line(`   线捆被推：${ticks.map((x) => `${(x.pushed || []).length}/${(x.threads || []).length}`).join(' · ')}`);
    line(`   警告合计：${ticks.reduce((n, x) => n + (x.warnings || 0), 0)}`);
}

const out = {
    arm: ARM,
    when: new Date().toISOString(),
    seedFrom: SEED_FROM || null,
    gates: { SEED_ROOTS_TOP, SEED_ROOTS_MAX, SEED_CHUNK_CHAR, SEED_CANDIDATES_TOP, AGENDA_CAPS },
    start: { tick: world0.meta?.tick, entities: (world0.entities || []).length, openRoots: computeOpenRoots(world0).length },
    book: { entries: book.entries, chars: Array.from(book.text).length, chunks: chunks.length, chunkChars: chunks.map((c) => Array.from(c).length) },
    pool: { size: pool.length, sample: pool.slice(0, 20) },
    seeding: { ok: seedRes?.ok ?? true, seeded: seeds.length, calls, secs, chunkLog, warnings: seedRes?.warnings ?? [], errors: seedRes?.errors ?? [], gotTotal },
    seeds,
    ticks,
    final: { tick: world.meta?.tick, entities: (world.entities || []).length, agendas: (world.agendas || []).length, events: (world.events || []).length, openRoots: computeOpenRoots(world).length, threads: computeThreads(world).length },
};
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); line(`\n出数已留档：${OUT}`); } else { line('\n（未指定 --out，读数只在屏上）'); }
void buildSeedRootsPrompt;
