// story-world-v2/demo/measure-leg36-spotlight-uptake.js
// leg36 · 出数装置：**"待启用名单上的人能不能上场"对世界有没有用**（用户令「你先跑数吧」）。
//
// 要验的假设（leg35 读源码读出来的那一格）：
//   引擎每轮机械挑 12 个"从没出手、也没人点名"的局外人（`computeIdleFaces`，池子 597 人），
//   随包递给模型说"这几个一直没动过，你安排点事"。★但 `gate.js` 给他们的资格**只到"能提一条盘算"**：
//     · newAgendas   用 `canStart` = active || spotlight   ← 开了
//     · actions / agendaAdvances / plotEvents / newEntities / agendaCancels 用 `active` ← **全拦**
//   ⇒ 名单上的人能"报名"、不能"上场"；不上场就不产生事件、不留 `lastActiveTick`、不被任何人点名
//     ⇒ 下一轮名单把他当"局外人"继续轮换 ⇒ **一个都不转化**（leg35 实测：本轮 12 人立线 0 人）。
//
// 两臂（真引擎、逐字节同源，只差那一格判据）：
//   · base   现状：spotlight 只给"起头资格"
//   · narrow ★提案：spotlight 还给"**产生痕迹**的那两种主动作"（actions + 携带 newEvents 的 agendaAdvances）
//                   —— 不给 newEvents/newEntities/agendaCancels 单独开口子（那三样另有自己的闸）
//     为什么不放全部：可控性优先。这一格的最小充分改动是"让他出手"，不是"让他什么都能干"。
//
// ★仓库零改动：变体靠**系统 TEMP 里的 gate.js 副本 + 一个 loader**（`--import` 注入 resolve hook），
//   `src/` 一个字节不动；真账一律走副本。
//
// 用法：
//   node demo/measure-leg36-spotlight-uptake.js --variant base   --ticks 8 --out F:/deepseek/tmp/leg36-base.json
//   node demo/measure-leg36-spotlight-uptake.js --variant narrow --ticks 8 --out F:/deepseek/tmp/leg36-narrow.json
//   推荐用 demo/measure-leg36-run.ps1 两臂一起跑（同起点、同一份真账）。
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTick } from '../src/tick.js';
import { computeIdleFaces, buildEvolutionPack, packTextOf } from '../src/pack.js';
import { AGENDA_CAPS } from '../src/settle.js';

const args = process.argv.slice(2);
const hasFlag = (n) => args.includes(n);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const ST_DATA = 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user';
const DEFAULT_WORLD = `${ST_DATA}/chats/大荒z/大荒z - 2026-09-01@00h37m41s559ms.jsonl`;
const WORLD_PATH = argVal('--world', DEFAULT_WORLD);
const TICKS = Math.max(1, parseInt(argVal('--ticks', '8'), 10) || 8);
const VARIANT = process.env.SW2_VARIANT || argVal('--variant', 'base');
const OUT_PATH = argVal('--out', '');
const line = (s) => console.log(s);

function loadRealWorld(path) {
    const raw = readFileSync(path, 'utf8');
    const nl = raw.indexOf('\n');
    const header = JSON.parse(nl < 0 ? raw : raw.slice(0, nl));
    const box = header?.chat_metadata?.story_world_v2;
    if (!box?.world) throw new Error(`chat_metadata.story_world_v2.world 缺失：${path}`);
    return box.world;
}

// ---------------- 读数 ----------------
// ① 连通分量（与 leg33/leg34 同一口径：source.ref 指向池内 / 共享波及名单）
function components(world) {
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
    return comps.sort((a, b) => b.length - a.length);
}

// ② 地盘：未决事件按地点分组（"几处同时在走"）
function places(world) {
    const open = (world.events || []).filter((e) => !e.closed);
    const m = new Map();
    for (const e of open) { const p = String(e.position || '未载'); m.set(p, (m.get(p) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

// ★★leg39：**"新主线"判据**（用户口径原话：「多条线，每个主线都有自己的轴」「新线就是新的主线」）
//   一条"新主线"要同时满足三件（都能机械核）：
//     ① **与那场大乱无关**：它的目标/标题里没有危机字样（死煞/幽冥/劫/大荒/浊流/煞/镇魔/超度）
//     ② **有自己的人和地**：不落在大荒这类危机地点、不只用那批老面孔
//     ③ ★**连走 ≥3 轮**（现在新线中位活 3 轮就收摊 ⇒ "主线"得活得更久）
const CRISIS_RE = /死煞|幽冥|大荒|劫气|杀劫|浊流|煞|镇魔|超度|南疆|北山/;

function alienPick(ssot, off = 8) {
    const namedNow = new Set();
    for (const ev of ssot?.events || []) if (!ev.closed) for (const r of ev.ripples || []) namedNow.add(r);
    const acted = new Set((ssot?.entities || []).filter((e) => typeof e.lastActiveTick === 'number').map((e) => e.id));
    const alien = (ssot?.entities || []).filter((e) => (e.status || 'active') === 'active'
        && !namedNow.has(e.id) && !acted.has(e.id) && e.id !== ssot?.context?.playerId
        && typeof e.name === 'string' && e.name.length >= 2);
    const tickNow = ssot?.meta?.tick ?? 0;
    return Array.from({ length: Math.min(off, alien.length) }, (_, k) => alien[(tickNow * off + k) % alien.length]);
}

// 一条线"活了几轮"：盘算的 memory.turnsAlive（引擎记的账，不是我们数的）
function lifeOf(world, agendaIds) {
    const byId = new Map((world.agendas || []).map((a) => [a.id, a]));
    return agendaIds.map((id) => (byId.get(id)?.memory?.turnsAlive) ?? null);
}


function runReadout(world, ctx) {
    const ents = world.entities || [];
    const acted = ents.filter((e) => typeof e.lastActiveTick === 'number');
    const actedSet = new Set(acted.map((e) => e.id));
    const open = (world.events || []).filter((e) => !e.closed);
    const namedNow = new Set(open.flatMap((e) => e.ripples || []));
    const comps = components(world);
    const agendaOwners = new Set((world.agendas || []).filter((a) => !a.closed).map((a) => a.owner));
    // 本轮出手的人（tick 恰等于当前 tick）
    const actedThisTick = acted.filter((e) => e.lastActiveTick === world.meta.tick).map((e) => e.id);
    // 波及名单里的"局外人"：在本轮开始前**从没出过手**的人
    const rippleOutsiders = new Set();
    for (const ev of open) for (const r of ev.ripples || []) if (!ctx.actedAtStart.has(r)) rippleOutsiders.add(r);
    const pack = buildEvolutionPack(world, null);
    return {
        tick: world.meta.tick,
        actedTotal: acted.length,
        actedNewThisTick: actedThisTick.length,
        newActors: actedThisTick.filter((id) => !ctx.actedAtStart.has(id)),
        rippleOutsiders: [...rippleOutsiders],
        rippleOutsiderN: rippleOutsiders.size,
        comps: comps.length,
        compSizes: comps.map((c) => c.length),
        eventsOpen: open.length,
        agendasOpen: (world.agendas || []).filter((a) => !a.closed).length,
        agendaOwners: agendaOwners.size,
        ownersNew: [...agendaOwners].filter((id) => !ctx.ownersAtStart.has(id)),
        places: places(world).length,
        topPlaceShare: open.length ? Number(((places(world)[0]?.[1] || 0) / open.length).toFixed(3)) : 0,
        packTokens: Math.ceil(packTextOf(pack.pack).length / 3.35),
    };
}

// ---------------- 主流程 ----------------
const world0 = loadRealWorld(WORLD_PATH);
// 玩家不模拟（用户令）：dialogue 传空串 ⇒ moveFact=null
const ctx = {
    actedAtStart: new Set((world0.entities || []).filter((e) => typeof e.lastActiveTick === 'number').map((e) => e.id)),
    ownersAtStart: new Set((world0.agendas || []).filter((a) => !a.closed).map((a) => a.owner)),
};

line(`═══ leg36 · 待启用名单"能不能上场"对跑 · 臂 = ${VARIANT} ═══`);
line(`真账副本：${WORLD_PATH}`);
line(`起点 tick ${world0.meta?.tick} · 实体 ${(world0.entities || []).length} · 出过手 ${ctx.actedAtStart.size} · 在飞盘算 ${(world0.agendas || []).filter((a) => !a.closed).length} · 未决事件 ${(world0.events || []).filter((e) => !e.closed).length}`);
line(`本臂判据：${VARIANT === 'narrow' ? '★ spotlight 给「上场权」（actions + agendaAdvances）' : '现状：spotlight 只给「起头资格」（newAgendas）'}`);
line('');

const { resolveWorldTransport } = await import('../src/st-preset.js');
const resolved = resolveWorldTransport();
if (!resolved) { console.error('✗ 未找到模型配置'); process.exit(1); }
line(`真模型：${resolved.source === 'st-preset' ? `酒馆预设「${resolved.presetName}」` : '环境变量'} · ${resolved.model} · ${TICKS} tick`);
line('');

// ★leg40b 续：**纯观测**——`settleWithHealing` 的三层收尾（①原样 / ②降级重试 / ③世界安静一步）各自被走了几次。
//   为什么真跑一遍才作数：死锁（永久停摆）修复的判别量是"**同一条提议连续两轮过不了校验**"，
//   只有真模型会写出那种提议——离线喂固定 step 的测试永远造不出"模型确实写歪"的那一轮。
//   为什么一股脑塞进这里最好：三层都不改判据、不改代码路径，差别只在"那一步有没有过关"，
//   所以"每一层被走几次 + 丢了哪几条 + 原始拒因"**只能**从真跑的 tick 序列里攒，没有第二个入口。
//   红线：只数、只印、只落档——不碰提示词、不碰包、不改轮数、不改控制流（观测不得改行为）。
const heal = { accepted: 0, retried: 0, quiet: 0, dropped: [], reasons: [], retriedTicks: [], fallbackTicks: [] };

let world = structuredClone(world0);
const perTick = [];
for (let t = 1; t <= TICKS; t += 1) {
    const faces = computeIdleFaces(world).map((f) => f.id);
    const faceSet = new Set(faces);
    const before = world;
    const beforeEv = new Set((before.events || []).map((x) => x.id));
    const beforeEnt = new Set((before.entities || []).map((x) => x.id));
    const beforeAg = new Set((before.agendas || []).map((x) => x.id));
    const r = await runTick({ transport: resolved.transport, ssot: world, dialogue: '', extractCtx: {}, calls: 1 });

    const row = { t, tickBefore: before.meta?.tick, faces, ok: r.ok, error: r.ok ? null : String(r.error).slice(0, 220) };
    if (r.ok) {
        world = r.ssot;
        row.tickAfter = world.meta.tick;
        const nowTick = world.meta.tick;
        // ★leg38：顶层闸余量（会不会锁死世界的直接量）+ 每条新线的 source.type（parent 用没用上）
        const openAg = (world.agendas || []).filter((a) => !a.closed);
        row.topLevelNow = openAg.filter((a) => !a.source || a.source.type !== 'parent').length;
        row.topLevelCap = AGENDA_CAPS.topLevel;
        row.openNow = openAg.length;
        const fresh = (world.agendas || []).filter((a) => !beforeAg.has(a.id));
        row.newAgendaDetail = fresh.map((a) => ({ owner: a.owner, type: (a.source && a.source.type) || '无', ref: (a.source && a.source.ref) || null, goal: String(a.goal || '').slice(0, 40) }));
        row.newAgendaByType = fresh.reduce((m, a) => { const t = (a.source && a.source.type) || '无'; m[t] = (m[t] || 0) + 1; return m; }, {});
        // ★leg39：新主线判据（三条）
        const alienNow = alienPick(before);
        row.alienInjected = alienNow.map((e) => e.name);
        row.alienInAgenda = fresh.filter((a) => alienNow.some((e) => e.id === a.owner)).map((a) => a.goal);
        const freshEvRows = (world.events || []).filter((e) => !beforeEv.has(e.id));
        row.newEventDetail = freshEvRows.map((e) => ({
            title: e.title, position: e.position, type: (e.source && e.source.type) || '无',
            crisis: CRISIS_RE.test(String(e.title)),
            alien: alienNow.some((x) => (e.ripples || []).includes(x.id)),
        }));
        row.newLines = fresh.map((a) => ({
            goal: String(a.goal || '').slice(0, 40), type: (a.source && a.source.type) || '无',
            crisis: CRISIS_RE.test(String(a.goal)),
            alienOwner: alienNow.some((e) => e.id === a.owner),
        }));
        row.newLinesCrisis = row.newLines.filter((x) => x.crisis).length;
        row.newLinesAlien = row.newLines.filter((x) => x.alienOwner).length;
        const actedNow = (world.entities || []).filter((e) => e.lastActiveTick === nowTick).map((e) => e.id);
        row.actedThisTick = actedNow;
        row.facesActed = actedNow.filter((id) => faceSet.has(id));
        row.newActors = actedNow.filter((id) => !ctx.actedAtStart.has(id));
        row.bornEvents = (world.events || []).filter((e) => !beforeEv.has(e.id)).map((e) => e.title);
        row.newEntitiesBorn = (world.entities || []).filter((e) => !beforeEnt.has(e.id)).map((e) => e.id);
        row.facesInRipples = [...new Set((world.events || []).filter((e) => !e.closed).flatMap((e) => e.ripples || []))].filter((id) => faceSet.has(id));
        // ★leg40：**当轮真世界的快照引用**（不是复制——`world` 是克隆体，逐轮被替换成新对象，故每轮引用各自独立）。
        //   用途：出数后在同一进程外**回放**那一轮的 `buildEvolutionPack(world, null)`，量"那一刻包里有多少字是那一场的"。
        //   为什么必须留这个：旧 JSON 只存派生读数（条数/标题），**量不了各栏量体与占比** ⇒ 占比与"无关新线"的相关性无从求。
        row.snap = world;
        // ★三条通道分开记（否则数字会骗人）：
        //   ① born   = 本轮**新入局**（模型照名单提名了新人 ⇒ `settle.js:901` K37 入组即活跃）
        //   ② owner  = 本轮**新立的线**（`settle.js:900` K14 提议并落账即活跃）
        //   ③ rest   = 其余（★这才是"够格上场"那条通道 —— narrow 臂额外放行的就是它）
        const bornSet = new Set(row.newEntitiesBorn);
        const freshOwner = new Set((world.agendas || []).filter((a) => !beforeAg.has(a.id)).map((a) => a.owner));
        row.facePath = { born: [], owner: [], rest: [] };
        for (const id of row.facesActed) {
            if (bornSet.has(id)) row.facePath.born.push(id);
            else if (freshOwner.has(id)) row.facePath.owner.push(id);
            else row.facePath.rest.push(id);
        }
    }
    // ★leg40b 续：把这一轮走的那一层记账（`r.healed` 只在成功路径上有）。
    const h = r.ok ? r.healed : null;
    if (h) {
        if (h.used === false) heal.accepted += 1;
        else if (h.fallback === true) { heal.quiet += 1; heal.fallbackTicks.push(t); }
        else { heal.retried += 1; heal.retriedTicks.push(t); }
        row.healed = h.used === false ? '原样' : (h.fallback === true ? '世界安静一步' : '降级重试');
        for (const d of h.dropped || []) heal.dropped.push({ tick: t, family: d.family, label: d.label, reason: d.reason });
        for (const e of h.errors || []) if (!heal.reasons.includes(e)) heal.reasons.push(e);
    }
    row.warnings = r.ok ? (r.stage?.warnings || []).length : null;
    row.warnSample = r.ok ? (r.stage?.warnings || []).slice(0, 3) : null;
    perTick.push(row);
    line(`第 ${t} 轮 tick ${row.tickBefore}→${row.ok ? row.tickAfter : '✗'} | 名单 ${faces.length} 人 · ★名单上出手的 ${row.facesActed?.length ?? '-'} 人 · 本轮出手共 ${row.actedThisTick?.length ?? '-'} 人 · 新生事件 ${row.bornEvents?.length ?? '-'} · 警告 ${row.warnings ?? '-'}`);
    if (row.facesActed?.length) line(`     ★名单上出手的：${JSON.stringify(row.facesActed.map((id) => (world.entities || []).find((e) => e.id === id)?.name || id))}`);
    if (row.bornEvents?.length) line(`     新生事件：${JSON.stringify(row.bornEvents.slice(0, 4))}`);
    if (!r.ok) line(`     ✗ ${row.error}`);
}

const final = runReadout(world, ctx);
line('');
line('═══ 收口读数 ═══');
const okTicks = perTick.filter((p) => p.ok);
// ★leg38：顶层闸（会不会锁死世界的那个数）+ 每条新线的来源（parent 用没用上）
const lastOk = okTicks[okTicks.length - 1];
const pathSum = (k) => okTicks.reduce((n, p) => n + ((p.facePath && p.facePath[k]) || []).length, 0);
line(`· 出过手的人：${ctx.actedAtStart.size} → **${final.actedTotal}**（净增 ${final.actedTotal - ctx.actedAtStart.size}）`);
line(`· ★名单上的人出手次数合计：**${okTicks.reduce((n, p) => n + (p.facesActed?.length || 0), 0)}** 次 = 新入局(born) ${pathSum('born')} + 新立线(owner) ${pathSum('owner')} + ★**其余(rest) ${pathSum('rest')}**`);
line(`      ★rest 才是"够格上场"那条通道——narrow 臂额外放行的就是它（base 预期 ≈0）`);
line(`· 波及名单里的"局外人"（本轮前从没出过手）：**${final.rippleOutsiderN}** 人`);
line(`· 新入局实体合计：${okTicks.reduce((n, p) => n + (p.newEntitiesBorn?.length || 0), 0)} 人（★模型照名单提名了多少张新脸）`);
line(`· ★顶层占用 ${lastOk ? lastOk.topLevelNow : '-'} / ${AGENDA_CAPS.topLevel}（有父的线不占这个名额）· 在飞 ${lastOk ? lastOk.openNow : '-'} / ${AGENDA_CAPS.open}`);
const byType = {};
for (const p of okTicks) for (const [k, v] of Object.entries(p.newAgendaByType || {})) byType[k] = (byType[k] || 0) + v;
line(`· ★新线的来源分布：**${JSON.stringify(byType)}**（parent = 挂在别人底下，不占顶层名额；现在预期 0）`);
for (const p of okTicks) if (p.newAgendaDetail?.length) line(`     第${p.t}轮: ${p.newAgendaDetail.map((a) => `${a.type}${a.ref ? `(${a.ref})` : ''}「${a.goal}」`).join(' / ')}`);
// ★★leg39：**新主线读数**（用户要的那个东西的判据）
const allLines = okTicks.flatMap((p) => p.newLines || []);
const allEvs = okTicks.flatMap((p) => p.newEventDetail || []);
const alienHits = okTicks.flatMap((p) => p.alienInAgenda || []);
line('');
line('★★ 新主线读数（三条判据）');
line(`① 新线合计 ${allLines.length} 条 · 其中**与那场大乱无关**的 **${allLines.filter((x) => !x.crisis).length}** 条（${allLines.length ? Math.round(100 * allLines.filter((x) => !x.crisis).length / allLines.length) : 0}% 无关）`);
line(`② 归到"从没进过账的书里人"名下的新线：**${allLines.filter((x) => x.alienOwner).length}** 条${alienHits.length ? ` -> ${JSON.stringify(alienHits.slice(0, 4))}` : ''}`);
line(`   新事件里点名了那批书里人的：**${allEvs.filter((x) => x.alien).length}** / ${allEvs.length} 条`);
const alienPlaces = [...new Set(allEvs.filter((x) => !x.crisis).map((x) => x.position))];
line(`   与危机无关的新事件落在 ${alienPlaces.length} 个地点：${JSON.stringify(alienPlaces.slice(0, 8))}`);
line('   逐条新线:');
for (const x of allLines) line(`     ${x.crisis ? '危机' : '★无关'} · ${x.type.padEnd(6)} ${x.alienOwner ? '★书里人' : '      '} 「${x.goal}」`);
line('   逐条新事件:');
for (const x of allEvs) line(`     ${x.crisis ? '危机' : '★无关'} · ${String(x.position || '未载').padEnd(8)} ${x.alien ? '★书里人' : '      '} 「${x.title}」`);
line(`· 事件连通分量：${components(world0).length} → **${final.comps}**（${JSON.stringify(final.compSizes.slice(0, 6))}）`);
line(`· 在飞盘算 ${(world0.agendas || []).filter((a) => !a.closed).length} → ${final.agendasOpen} · 属主 ${ctx.ownersAtStart.size} → ${final.agendaOwners}（新属主 ${final.ownersNew.length} 人）`);
line(`· 未决事件 ${(world0.events || []).filter((e) => !e.closed).length} → ${final.eventsOpen} · 地点 ${places(world0).length} → ${final.places}（最大地点占比 ${final.topPlaceShare}）`);
line(`· 包体 est ${final.packTokens} token · 拒绝 ${perTick.filter((p) => !p.ok).length} 轮 · 警告合计 ${okTicks.reduce((n, p) => n + (p.warnings || 0), 0)}`);

// ★★leg40b 续：**三层收尾的读数**（纯观测，见 tick 循环前的头注）
line('');
line('★★ 自愈三层（settleWithHealing）');
line(`· ①原样接受 **${heal.accepted}** 轮 · ②降级重试 **${heal.retried}** 轮 · ③世界安静一步 **${heal.quiet}** 轮（合计 ${heal.accepted + heal.retried + heal.quiet} / 成功 ${okTicks.length} 轮）`);
if (heal.dropped.length) {
    const byReason = new Map();
    for (const d of heal.dropped) byReason.set(d.reason, (byReason.get(d.reason) || 0) + 1);
    const hits = [...byReason.entries()].sort((a, b) => b[1] - a[1]);
    line(`· 本跑被丢的提议合计 ${heal.dropped.length} 条 · ${hits.length} 种理由（按条数）`);
    for (const [reason, n] of hits.slice(0, 10)) line(`     ${String(n).padStart(3)} 条 · ${reason}`);
    if (hits.length > 10) line(`     ... 另 ${hits.length - 10} 条`);
}
if (heal.retried) line(`· ②降级重试的轮次：${JSON.stringify(heal.retriedTicks)}（这几轮是模型原样写歪、清干净后落了账）`);
if (heal.quiet) {
    const tickList = JSON.stringify(heal.fallbackTicks);
    line('');
    line('████████████████████████████████████████████████');
    line(`██ ★★★ 世界安静一步 ×${heal.quiet} —— 轮次 ${tickList}`);
    line('██ 这一整个回合的模型输出**全部被拒**，账上一个字都没落，只是 tick 照常前进。');
    line('██ 死锁（永久停摆）修复前的旧行为：这里会卡住不动，下一轮读回同一份账、递同一个包。');
    line(`██ 原始拒因 ${heal.reasons.length} 条：`);
    for (const reason of heal.reasons.slice(0, 10)) line(`██   · ${reason}`);
    if (heal.reasons.length > 10) line(`██   ... 另 ${heal.reasons.length - 10} 条`);
    line('████████████████████████████████████████████████');
}

const out = { variant: VARIANT, model: resolved.model, ticks: TICKS, healing: heal, start: { tick: world0.meta?.tick, acted: ctx.actedAtStart.size, agendas: (world0.agendas || []).filter((a) => !a.closed).length, events: (world0.events || []).filter((e) => !e.closed).length, comps: components(world0).length }, perTick, final: { ...final, actedNewAll: null } };
if (OUT_PATH) { writeFileSync(OUT_PATH, JSON.stringify(out, null, 2)); line(`\n出数已留档：${OUT_PATH}`); }
void hasFlag;
void mkdtempSync; void tmpdir; void join;
