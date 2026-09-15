// story-world-v2/demo/measure-leg40c-bloom.js
// ★★leg40b 续 · **"放开限制为什么没有百花齐放"** 的归因探针（纯只读：真账只读、世界走内存副本、不写回盘）。
//
// 问的问题（用户 2026-09-14：「结合之前的经验和数据找到放开限制为什么没有百花齐放的因素」）：
//   把"料"和"递送"放开到 N 倍，**模型每轮能并推的线**到底涨不涨？
//   之前两棒的读数（leg39 七臂 / leg40 四臂）都指向"不涨"，但**都没量到那一格**：
//     线捆递了 3 条 ⇒ 模型推 3 条；递了 62 条（wide 臂）⇒ 仍 0–2 条新线。
//     ⇒ 缺的不是"料开没开"，是**"请求配比"变没变**。本探针把这两个因素**分开**：
//       · 臂 A（base）  ：线捆 3 条 + 现行话术（话术里写死"这一栏最多只有三条"）
//       · 臂 B（ask12） ：线捆 12 条 + 话术**同步**说清"本栏递给你 N 条，每条各写一步"
//     ★这一格是本探针的全部价值：leg40 wide 臂把递送量拉到 62，而话术**一个字没改**
//       （仍写着"最多只有三条"）⇒ "递送放开没用"这个结论里，混着"话术与递送自相矛盾"这个混淆项。
//
// 每轮出四个读数（全部机械可核）：
//   ① **送到几条**（pack.threads 实际条数）
//   ② **推了几条**（本轮新建事件里 source.ref 命中"送达线 id"的**去重**条数）—— ★本探针的主读数
//   ③ **推的是哪几条**（在送达名单里的位次）——判断它是不是"从头取前几条"
//   ④ 产出规模（新事件 / 新盘算 / 新实体 / 不同地点数）+ **降级路径遥测**（死锁修复的回执）
//
// 纪律（本仓）：
//   · `--probe` 干跑自证：只读账、只出包、只拼提示词，**一次模型调用都不发**（没跑过 probe 不许烧调用）
//   · 含中文的文件**只用 edit/write 写**（PowerShell 会毁字）
//   · 本文件**零仓库改动**：不改 src、不改包、不改提示词；臂的差异只在**递送的线捆**与**追加的那一段话术**
import { readFileSync, writeFileSync } from 'node:fs';
import { buildEvolutionPack, deliverThreads } from '../src/pack.js';
import { assembleMainPrompt } from '../src/prompts.js';
import { loadStPresetConfig } from '../src/st-preset.js';
import { createHttpTransport } from '../src/transport-http.js';
import { settleWithHealing } from '../src/tick.js';

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const hasFlag = (n) => args.includes(n);

const ST_DATA = 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user';
const DEFAULT_WORLD = `${ST_DATA}/chats/大荒z/大荒z - 2026-09-01@00h37m41s559ms.jsonl`;
const WORLD_PATH = argVal('--world', DEFAULT_WORLD);
const TICKS = Math.max(1, parseInt(argVal('--ticks', '4'), 10) || 4);
const ARM = argVal('--arm', 'base');            // base | askN | ask12（兼容旧名）
const PROBE = hasFlag('--probe');
const OUT = argVal('--out', '');
// ★递送条数：`--deliver N` 为准（0 = 维持现状「3 条 + 原话术」，即基线臂）。
//   为什么要有这个旋钮：本笔的核心结论是"天花板在**请求**那一格"，而要验证的下一档正是
//   "请求=6" ⇒ 必须能单变量地把递送数从 3 挪到 6，且**话术同步**（两半必须一起，见 ledger 的归因）。
const DELIVER_ARG = parseInt(argVal('--deliver', '0'), 10) || 0;
const BASELINE = DELIVER_ARG === 0 && ARM === 'base';
const DELIVER = BASELINE ? 3 : (DELIVER_ARG || (ARM === 'ask12' ? 12 : 3));

// ★臂的唯一差别（两个半边必须同时给，缺一半就是 leg40 `wide` 臂那个自相矛盾的坑）：
//   ① 递送条数（`deliverThreads`）② 话术里**说清同一个条数**。
//   基线臂（`base`）＝一个字节都不加，维持生产原样。
function armAddendum(n, ids) {
    if (BASELINE) return '';
    return [
        '',
        `【本回合的线（引擎已递到上面 threads 一栏，共 ${n} 条）】`,
        `本回合递给你 ${n} 条线，id 依次是：${ids.join(' / ')}。`,
        `★要求：**这 ${n} 条，本回合每一条都各写一步**（各自出一件新的未决事件，source.type="ripple" + ref= 它自己的 id）。`,
        `不是挑几条写——**一条都不能落下**。写不完就少写别的（比如本轮不再起新线）。`,
        `如果你判断某一条这一轮确实推不动，就在那段输出之后单独写一行说明：推不动 <它的 id> 因为 <理由>。`,
    ].join('\n');
}

// ---------- 真账（只读；世界走内存副本） ----------
function loadWorldCopy() {
    const raw = readFileSync(WORLD_PATH, 'utf8');
    const nl = raw.indexOf('\n');
    const meta = JSON.parse(nl < 0 ? raw : raw.slice(0, nl));
    return structuredClone(meta.chat_metadata.story_world_v2.world);
}

const tok = (s) => Math.round(Array.from(String(s)).length / 1.6);
const idsOf = (list) => list.map((t) => String(t?.id || ''));
const uniq = (a) => [...new Set(a)];

let world = loadWorldCopy();

/**
 * ★干跑与真跑**共用**的取材函数（口径同源——探针不许自带一套更宽松的口径，本仓 leg40b 的教训）。
 * 臂的唯一差别都在这里：① 送达几条（`deliverThreads` 真函数）② 追加那段话术。
 */
function materialize(w) {
    const full = buildEvolutionPack(w, null);
    const structured = { ...full.pack, threads: computeThreadsAll(w, DELIVER) };
    const pack = { ...full, pack: structured };
    const delivered = structured.threads || [];
    const prompt = assembleMainPrompt(pack) + armAddendum(delivered.length, idsOf(delivered));
    return { pack, structured, prompt, delivered, all: computeThreadsAll(w, 999).length };
}
// ---------- 干跑自证（一次调用都不发） ----------
if (PROBE) {
    // ★口径（干跑抓出来的两处）：`buildEvolutionPack` 返回 `{pack, text, estTokens}` —— 结构化字段在 **`r.pack`** 里；
    //   而且**臂的递送要在这里也生效**（否则干跑永远显示 3 条、真跑才发现臂没接上——第一版就是这样）。
    //   ⇒ 干跑与真跑共用 `materialize()` 一个函数，**口径同源**（本仓铁律：探针口径必须与被测口径同源）。
    const { pack, structured, prompt, delivered, all } = materialize(world);
    const r = buildEvolutionPack(world, null);
    console.log('══ 干跑自证（零调用） ══');
    console.log(`  世界：tick ${world.meta?.tick} · 实体 ${(world.entities || []).length} · 事件 ${(world.events || []).length} · 盘算 ${(world.agendas || []).length}`);
    console.log(`  线头 ${(structured.openRoots || []).length} · 线捆**送达** ${delivered.length} 条 · 臂=${BASELINE ? 'base（生产原样）' : `ask${DELIVER}（递送与话术同步）`}（本臂要求每条各写一步=${BASELINE ? 3 : DELIVER}）`);
    console.log(`  线头池（同一排序取全量）= ${all} 条（≥ 送达数才说明池子够大）`);
    console.log(`  送达的线 id：${idsOf(delivered).join(' / ')}`);
    console.log(`  提示词 ${Array.from(prompt).length} 字符 ≈ ${tok(prompt)} token · 包体 est ${r.estTokens} token`);
    console.log(`  pack.text 前 150 字：${String(pack.text).slice(0, 150).replace(/\s+/g, ' ')}`);
    if (delivered.length !== DELIVER) {
        console.log(`  ✗ 送达数 ${delivered.length} ≠ 本臂期望 ${DELIVER}——臂没接上，禁止真跑`);
        process.exit(1);
    }
    console.log('  ⇒ 干跑通过（送达数与本臂一致）。去掉 --probe 才真跑。');
    process.exit(0);
}

const cfg = loadStPresetConfig();
if (!cfg) { console.error('✗ 读不到 ST 预设（loadStPresetConfig 返回 null）'); process.exit(1); }
console.log(`══ leg40c · "放开限制为什么没有百花齐放" 归因探针 · 臂=${BASELINE ? 'base（生产原样）' : `ask${DELIVER}`} ══`);
console.log(`真账副本：${WORLD_PATH}`);
console.log(`起点 tick ${world.meta?.tick} · 实体 ${(world.entities || []).length} · 事件 ${(world.events || []).length} · 盘算 ${(world.agendas || []).length}`);
console.log(`本臂：线捆送达 ${DELIVER} 条 · 话术${BASELINE ? '维持现状（"最多只有三条"）' : '**同步**要求每条各写一步'}`);
console.log(`真模型：预设「${cfg.presetName || '?'}」 · ${cfg.model} · ${TICKS} tick\n`);

const rounds = [];
const droppedAll = [];
const fallbackRounds = [];

for (let t = 0; t < TICKS; t += 1) {
    // 臂的差别全在 `materialize` 里（送达条数 + 那段话术），干跑与真跑同一函数
    const { structured, prompt, delivered, all: poolAll } = materialize(world);
    const deliveredIds = idsOf(delivered);

    const t0 = Date.now();
    let raw = null; let err = null; let usage = null; let finish = null;
    try {
        const capture = async (url, opts) => {
            const res = await fetch(url, opts);
            const text = await res.text();
            try { usage = JSON.parse(text)?.usage ?? null; finish = JSON.parse(text)?.choices?.[0]?.finish_reason ?? null; } catch (_) {}
            return { ok: res.ok, status: res.status, text: async () => text, json: async () => JSON.parse(text) };
        };
        const transport = createHttpTransport({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, fetchImpl: capture });
        raw = String(await transport(prompt));
    } catch (e) { err = String(e?.message || e); }
    const ms = Date.now() - t0;

    let step = null;
    if (raw) { try { step = JSON.parse(String(raw).trim()); } catch (_) { step = null; } }

    if (!step) {
        console.log(`第 ${t + 1} 轮 ✗ 调用失败/非法 JSON（${(ms / 1000).toFixed(1)}s）${err ? ` · ${err}` : ''}`);
        console.log(`        原始输出前 160 字：${String(raw || '').slice(0, 160).replace(/\s+/g, ' ')}`);
        rounds.push({ n: t + 1, ok: false, ms, err, delivered: delivered.length });
        break;
    }

    // ★主读数：本轮新建事件里，来路命中"送达线 id"的**去重**条数
    const evs = step.newEvents || [];
    const refs = evs.map((e) => String(e?.source?.ref || '')).filter(Boolean);
    const advanced = uniq(refs.filter((r) => deliveredIds.includes(r)));
    const novel = uniq(refs.filter((r) => !deliveredIds.includes(r)));
    const positions = uniq([...evs.map((e) => String(e?.position || '').trim()),
        ...(step.actions || []).map((a) => String(a?.position || '').trim())].filter(Boolean));
    const newEnts = step.newEntities || [];
    const deliveredOrd = advanced.map((id) => deliveredIds.indexOf(id) + 1).sort((a, b) => a - b);

    const before = { tick: world.meta?.tick, ents: (world.entities || []).length, evs: (world.events || []).length };
    const r = settleWithHealing({ ssot: world, step, moveFact: null, calls: 1 });
    const healed = r.healed || {};
    if (healed.dropped?.length) droppedAll.push(...healed.dropped.map((d) => ({ tick: t + 1, ...d })));
    if (healed.fallback) fallbackRounds.push(t + 1);
    if (r.ok) world = r.ssot;
    // ★补一格（本跑的缺口，如实记账）：前面数的都是"**模型写了多少**"，而**引擎裁了多少不在这里**。
    //   引擎有硬上限（settle.js：`EVENT_CAPS.perTick=6` / `AGENDA_CAPS.perTick=3` / `ENTITY_BIRTH_PER_TICK=1`），
    //   超出部分按"事件洪峰/入局限额"**丢掉并留警告**。不数它就会把"写着 12 条"误读成"世界里有 12 条"。
    const landedEv = (r.ok ? world.events || [] : []).filter((e) => String(e.id).startsWith(`ev_${before.tick + 1}_`)).length;
    const warnText = (r.ok ? (r.stage?.warnings || []) : []).map(String);
    const capHits = {
        flood: warnText.filter((x) => x.includes('事件洪峰')).length,
        birth: warnText.filter((x) => x.includes('入局限额')).length,
        agenda: warnText.filter((x) => x.includes('盘算大厦顶') || x.includes('顶层')).length,
    };

    console.log(`第 ${t + 1} 轮 tick ${before.tick}→${r.ok ? world.meta.tick : '✗'} | 送达 ${delivered.length} · ★推出 ${advanced.length} 条 · 模型写 ${evs.length} 件 → **落账 ${landedEv} 件** · 新盘算 ${(step.newAgendas || []).length} · 新实体 ${newEnts.length} · 地点 ${positions.length} | ${(ms / 1000).toFixed(1)}s`);
    console.log(`      推出的是送达名单里的第 [${deliveredOrd.join(',')}] 条 · 未推 ${delivered.length - advanced.length} 条 · 引线之外的来路 ${novel.length} 条`);
    // ★本跑要盯的那一格：**线头池**（还开着、没人接的线头总数）会不会因为"请求变大"而单向堆积。
    //   真账历史：12 → 74 一路涨、**从未回落** ⇒ 这是"提升请求上限"唯一的已知风险，必须逐轮看着。
    console.log(`      ★线头池 ${poolAll} 条（未决事件 ${(r.ok ? world.events || [] : []).filter((e) => !e.closed).length} · 本轮新起线头 = 新建事件里没被任何线引的）`);
    if (capHits.flood || capHits.birth || capHits.agenda) {
        console.log(`      ⚖ 引擎上限咬到了：事件洪峰 ${capHits.flood} · 入局限额 ${capHits.birth} · 盘算顶 ${capHits.agenda}（模型写的没全落账）`);
        const sample = warnText.find((x) => x.includes('洪峰') || x.includes('限额') || x.includes('顶'));
        if (sample) console.log(`        例：${sample.slice(0, 120)}`);
    }
    if (!r.ok) console.log(`      ✗ 连空步都失败（引擎自身问题）：${JSON.stringify(r.stage?.warnings || [])}`);
    if (healed.used) {
        console.log(`      ⚠ 降级路径：${healed.fallback ? '★世界安静一步（整轮提议未落账）' : `降级重试（丢 ${healed.dropped.length} 条）`}`
            + ` · 原始拒因 ${healed.errors?.[0] ? String(healed.errors[0]).slice(0, 110) : '—'}`);
    }
    console.log(`      产出明细：新事件 ${evs.length}（plot ${evs.filter((e) => e?.source?.type === 'plot').length} / ripple ${evs.filter((e) => e?.source?.type === 'ripple').length} / state ${evs.filter((e) => e?.source?.type === 'state').length}）`
        + ` · 动作 ${(step.actions || []).length} · 盘算推进 ${(step.agendaAdvances || []).length} · 字段变更 ${(step.entityUpdates || []).length} · 输出 ${Array.from(String(raw)).length} 字`);
    rounds.push({
        n: t + 1, ok: r.ok, ms, delivered: delivered.length, deliveredIds,
        advanced: advanced.length, advancedIds: advanced, displayedOrdinals: deliveredOrd,
        newEvents: evs.length, landedEvents: landedEv, capHits, newAgendas: (step.newAgendas || []).length, newEntities: newEnts.length,
        poolBefore: poolAll, poolAfter: (r.ok ? computeThreadsAll(world, 999).length : null),
        positions: positions.length, refsOutsideThreads: novel.length,
        srcMix: { plot: evs.filter((e) => e?.source?.type === 'plot').length, ripple: evs.filter((e) => e?.source?.type === 'ripple').length, state: evs.filter((e) => e?.source?.type === 'state').length },
        // ★逐条明细（为什么必须落它）：光数"推出 12 条"回答不了**内容面**那一问——
        //   12 条可能是 12 条真不同的线，也可能是同一场大乱的 12 个侧面（leg32/leg33 实测过后者）。
        //   故把每条新事件的 `标题 + 地点 + 来路` 原样留档，让人（和下一棒）能**肉眼判**是不是百花齐放。
        detail: evs.map((e) => ({
            title: String(e?.title || ''),
            position: String(e?.position || ''),
            ref: String(e?.source?.ref || ''),
            type: String(e?.source?.type || ''),
            people: (e?.ripples || []).length,
        })),
        actions: (step.actions || []).length, advances: (step.agendaAdvances || []).length,
        updates: (step.entityUpdates || []).length, outChars: Array.from(String(raw)).length,
        usage, finish, healed: { used: !!healed.used, fallback: !!healed.fallback, dropped: healed.dropped?.length || 0, errors: healed.errors || [] },
        promptChars: Array.from(prompt).length,
    });
}

// ---------- 收口 ----------
const okR = rounds.filter((r) => r.ok);
const sum = (k) => okR.reduce((a, r) => a + (r[k] || 0), 0);
const avg = (k) => (okR.length ? sum(k) / okR.length : 0);
const healCount = okR.filter((r) => r.healed.used).length;
console.log('\n══ 收口 ══');
console.log(`  有效轮 ${okR.length}/${TICKS} · 送达 ${okR.length ? okR[0].delivered : '—'} 条/轮`);
console.log(`  ★**推出几条/轮** = ${avg('advanced').toFixed(2)}（合计 ${sum('advanced')} 条次）— 本探针的主读数`);
console.log(`  新事件/轮 ${avg('newEvents').toFixed(2)} · 新盘算/轮 ${avg('newAgendas').toFixed(2)} · 新实体/轮 ${avg('newEntities').toFixed(2)} · 不同地点/轮 ${avg('positions').toFixed(2)}`);
console.log(`  引线之外的来路/轮 ${avg('refsOutsideThreads').toFixed(2)} · 输出 ${Math.round(avg('outChars'))} 字/轮 · 提示词 ${okR.length ? okR[0].promptChars : '—'} 字`);
console.log(`  ★死锁修复遥测：走降级 ${healCount} 轮（其中世界安静一步 ${fallbackRounds.length} 轮${fallbackRounds.length ? `：第 ${fallbackRounds.join('/')} 轮` : ''}）· 丢弃提议 ${droppedAll.length} 条`);
// ★线头池走向（本跑的核心风险格）：起 → 终，逐轮序列。堆不堆，一眼看得出。
const poolSeq = okR.map((r) => r.poolAfter).filter((x) => x != null);
if (poolSeq.length) {
    console.log(`  ★线头池走向：${poolSeq.join(' → ')}（起 ${poolSeq[0]}，终 ${poolSeq[poolSeq.length - 1]}，净 ${poolSeq[poolSeq.length - 1] - poolSeq[0] >= 0 ? '+' : ''}${poolSeq[poolSeq.length - 1] - poolSeq[0]}）`);
    const capSum = okR.reduce((a, r) => a + (r.capHits?.flood || 0) + (r.capHits?.birth || 0) + (r.capHits?.agenda || 0), 0);
    console.log(`  引擎上限咬到合计 ${capSum} 次（洪峰 ${okR.reduce((a, r) => a + (r.capHits?.flood || 0), 0)} · 入局限额 ${okR.reduce((a, r) => a + (r.capHits?.birth || 0), 0)} · 盘算顶 ${okR.reduce((a, r) => a + (r.capHits?.agenda || 0), 0)}）`);
}
if (droppedAll.length) {
    for (const d of droppedAll.slice(0, 8)) console.log(`      · 第 ${d.tick} 轮丢 ${d.family}「${d.label || d.index}」：${String(d.reason).slice(0, 90)}`);
    if (droppedAll.length > 8) console.log(`      · …另 ${droppedAll.length - 8} 条`);
}
const allIds = uniq(okR.flatMap((r) => r.advancedIds));
console.log(`  全程被推过的**不同**线 ${allIds.length} 条`);

if (OUT) {
    writeFileSync(OUT, JSON.stringify({ arm: ARM, ticks: TICKS, world: WORLD_PATH, deliver: DELIVER, rounds, dropped: droppedAll, fallbackRounds, summary: { advancedPerRound: avg('advanced'), newEventsPerRound: avg('newEvents'), newAgendasPerRound: avg('newAgendas'), positionsPerRound: avg('positions'), healedRounds: healCount, distinctAdvanced: allIds.length } }, null, 2));
    console.log(`\n出数：${OUT}`);
}

// 全量线头：直接用 `src/pack.js` 的 `deliverThreads(ssot, N)`——**排序与截断只有那一份实现**，
//   探针绝不自己再写一套（本仓老病：一个数两把尺子）。第一版这里抄了一份排序，已删。
function computeThreadsAll(ssot, n) {
    return deliverThreads(ssot, n);
}
