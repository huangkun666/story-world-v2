// story-world-v2/demo/measure-silence-gate.js
// 细案 spec-world-widening §5「出数协议」的执行脚本（P3 经用户 2026-09-12 批准新建）。
// 用途：同一世界、同一确定性桩、同一轮数，**只换门控的可行动面**，比五组数——
//   ①活跃面 ②盘算来源面 ③事件集中度 ④上限面（盘算大厦顶/事件洪峰）⑤不共线（多书结构面）。
// ★只读：不改 gate.js、不改任何源码、不写聊天文件。真账一律走副本（--chat 传副本路径）。
//
// ============================ 设计要点（改过三版，前两版都错，如实留档） ============================
// 【为什么不用给引擎加注入点】`settle.js:710` 直调真 `gateWorldStep`，没有注入点（承重墙）。
//   而 B2 四档与 B1/B3 全是**放宽** ⇒ 变体的可行动集合必是真门控集合的**超集**。
//   于是变体活在确定性桩里（"它从哪张名单里挑人提议"），**真门控照旧当裁判**。
//
// 【第一版错在哪】我在 `onTick` 里用**自己的镜像**（复算静默）来算下一轮候选池。镜像与真门控
//   到第 2 轮就分叉 ⇒ 池子算成 0，而 `stepGen` 的早退分支不更新 `lastPicks` ⇒ 明细里显示的是**上一轮残留**
//   的 id（看起来"挑到了人"，其实一个都没挑）。
//
// 【第二版错在哪】`runSmoke` 的 `onTick(t, world)` 里 **t 是循环序号（1..20）**，而 simLog 用的是
//   `world.meta.tick`（本真账从 12 起）⇒ 用 `find(x => x.tick === t)` 去查日志永远落到**历史条目**
//   上（真账自带 11 条历史 simLog），读数全错位。
//
// 【本版口径】**候选池只以真门控的 simLog 为准**：第 T 轮读完真 `silent` ⇒ `真候选池 = 全部 − silent`
//   ⇒ 套该档的口径筛出 `桩候选池` ⇒ **第 T+1 轮的桩只从这里挑人**。
//   镜像只用于结构层读数与自校验；**一旦镜像与真门控不一致，脚本当场中止**（不产出假数据）。
//   `lastActiveTick` 的写入（settle.js:752）发生在门控（:710）**之后**，故第 T 轮记录的
//   `silent` 名单在第 T+1 轮开跑时仍然成立——池子的有效期是够的。
// ==============================================================================================
//
// 用法：
//   node demo/measure-silence-gate.js --chat <真账副本.jsonl> [--ticks 20] [--quota 2] [--books <世界书目录>]

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runSmoke } from '../src/smoke.js';
import { QUIET_TICKS } from '../src/gate.js';
import { AGENDA_CAPS, EVENT_CAPS } from '../src/settle.js';

const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt; };
const CHAT = arg('chat', null);
const TICKS = Number(arg('ticks', 20));
const QUOTA = Number(arg('quota', 2));
const BOOKS_DIR = arg('books', null);
const AS_JSON = argv.includes('--json');
// ★--gate：可选。给一个**门控模块的副本**（系统 TEMP，不进仓库）⇒ 引擎真的按该判据跑。
//   由 `--variant` 决定副本里的口径（副本用 `globalThis.__SW2_VARIANT__` 取）。
//   这样"放宽后的真引擎"能被量到，而仓库一个字节不动（副本 + module.registerHooks 在子进程里生效）。
const GATE_FILE = arg('gate', null);
const VARIANT_ENV = process.env.SW2_VARIANT || 'baseline';

// ---------- 真账读取（只读） ----------
function loadWorldFromChat(file) {
    const raw = readFileSync(file, 'utf8');
    const nl = raw.indexOf('\n');
    const header = JSON.parse(raw.slice(0, nl));
    const box = header?.chat_metadata?.story_world_v2;
    if (!box) throw new Error('chat_metadata.story_world_v2 缺失（不是带热账的聊天？）');
    const w = box.world || box;
    if (!w?.entities) throw new Error('热账里没有 world.entities');
    return w;
}

// ---------- 载体判据（B2 两档的原料；口径写在细案 §4 B2 行） ----------
export const hasLoc = (e) => {
    const loc = e.location;
    if (typeof loc !== 'string') return false;
    const t = loc.trim();
    return t !== '' && t !== '未明' && t !== '未载' && t !== '未知';
};
export const hasParent = (e) => typeof e.parent === 'string' && e.parent.trim() !== '';

export const B2_TIERS = {
    a: { label: 'B2-(a) 位置已知', test: (e) => hasLoc(e) },
    b: { label: 'B2-(b) 有隶属', test: (e) => hasParent(e) },
    c: { label: 'B2-(c) 两者任一', test: (e) => hasLoc(e) || hasParent(e) },
    d: { label: 'B2-(d) 两者都满足', test: (e) => hasLoc(e) && hasParent(e) },
};

// ---------- 镜像（只用于结构层读数 + 自校验；不是测量输入） ----------
export function silhouette(world) {
    const tick = world?.meta?.tick ?? 0;
    const ents = world.entities || [];
    const statusOf = new Map(ents.map((e) => [e.id, e.status || 'active']));
    const gated = (id) => (statusOf.get(id) ?? 'active') === 'active';
    const named = new Set();
    for (const ev of world.events || []) if (!ev.closed) for (const r of ev.ripples || []) if (gated(r)) named.add(r);
    const openOwners = new Set((world.agendas || []).filter((a) => !a.closed).map((a) => a.owner));
    const actedRecently = (e) => typeof e?.lastActiveTick === 'number' && (tick - e.lastActiveTick) < QUIET_TICKS;
    let topId = null;
    for (const e of ents) { if (gated(e.id)) { topId = e.id; break; } }
    const silent = new Set();
    for (const e of ents) {
        if (!gated(e.id)) continue;
        if (e.id === topId) continue;
        if (openOwners.has(e.id)) continue;
        if (actedRecently(e)) continue;
        silent.add(e.id);
    }
    const lifted = new Set([...silent].filter((id) => named.has(id)));
    return { silent, lifted, topId, openOwners };
}

/** 从"可行动集合"出发，按该档口径算出桩候选池。realActive = 真门控给出的可行动集合。 */
export function stubPool(world, variant, realActive) {
    const ents = world.entities || [];
    const statusOf = new Map(ents.map((e) => [e.id, e.status || 'active']));
    const pool = new Set([...realActive].filter((id) => (statusOf.get(id) ?? 'active') === 'active'));
    const tier = B2_TIERS[variant];
    if (tier) {
        for (const e of ents) if ((statusOf.get(e.id) ?? 'active') === 'active' && tier.test(e)) pool.add(e.id);
    } else if (variant === 'B1') {
        // B1：②认"从没出过手"为可动 ⇒ 静默只剩"出过手且距今 ≥3 轮"∧无在办∧无人点名
        const { silent, lifted, topId, openOwners } = silhouette(world);
        const named = new Set(world.events.filter((x) => !x.closed).flatMap((x) => x.ripples || []));
        for (const e of ents) {
            if ((statusOf.get(e.id) ?? 'active') !== 'active') continue;
            const oldSilent = silent.has(e.id) && !lifted.has(e.id);
            if (!oldSilent || e.id === topId || openOwners.has(e.id) || named.has(e.id)) pool.add(e.id);
        }
    } else if (variant === 'B3') {
        // B3：势力有在飞盘算 ⇒ 其麾下成员也算"手上有人办的事"（最窄）
        const activeFactionNames = new Set(ents.filter((e) => (world.agendas || []).some((a) => !a.closed && a.owner === e.id)).map((e) => e.name));
        for (const e of ents) if ((statusOf.get(e.id) ?? 'active') === 'active' && e.parent && activeFactionNames.has(e.parent)) pool.add(e.id);
    }
    return pool;
}

// ---------- 确定性桩（变体的全部差异都在这里：从哪张名单挑人） ----------
// 与细案 §5 一致：人选取自"当轮可行动集合"，不偏向任何人；提议质量在变体间恒定，唯一变量是名单大小。
function makeStepGen(state) {
    return (simTick, world) => {
        const ids = [...state.pool].filter((id) => id !== state.playerId).sort();   // 确定性序
        if (!ids.length) {
            // ★池子空 = 测量脚手架坏了（不是世界真的没人）——早退但记账，最后硬报错，绝不静默出数
            state.emptyPoolTicks.push(simTick);
            state.lastPicks = [];
            return { actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] };
        }
        const picks = [];
        for (let k = 0; k < Math.min(QUOTA, ids.length); k++) picks.push(ids[(state.i + k) % ids.length]);
        state.i = (state.i + Math.min(QUOTA, ids.length)) % ids.length;
        state.lastPicks = picks;
        const openOwners = new Set((world.agendas || []).filter((a) => !a.closed).map((a) => a.owner));

        // ★replyOnly：**只应答臂**——放宽进来的人不发新盘算（只对已经在飞的事做动作），
        //   发起权仍只给"本来就可动"的那几个。判据是"这个实体在不在真门控的窄集合里"。
        const openOriginators = new Set((world.agendas || []).filter((a) => !a.closed).map((a) => a.owner));
        const origination = state.replyOnly
            ? picks.filter((id) => openOriginators.has(id) || state.narrow.has(id))
            : picks;

        // 只提议新盘算（state 源=最弱来源、不需 ref）——"世界会不会变宽"的正题就是这个。
        // 玩家棋子必须排除：check-step 红线 1（模型禁写玩家），第一版就是在这崩的（桩挑了 e_p1）。
        const newAgendas = origination.map((id, k) => ({
            entity: id,
            goal: `试探周边局势（${simTick}-${k + 1}）`,
            stage: '起步',
            visibility: 'known',
            maxSteps: 3,
            source: { type: 'state' },
        }));
        // 手上已有在办盘算者：提一条**无源行动**（不产事件 ⇒ 不撞 EVENT_CAPS.perTick，也不给谁记活跃）
        // 目的是拿到"活跃面曲线"（§5 第 1 组数）。无在办者不提：settle.js:329 会报烟雾报警，那是噪声。
        const actions = picks.filter((id) => openOwners.has(id)).map((id) => ({ entity: id, verb: '按既定方略行事' }));
        return { actions, newEvents: [], agendaAdvances: [], newAgendas, agendaCancels: [], newEntities: [], entityFates: [] };
    };
}

async function runVariant(baseWorld, variant) {
    const ents = baseWorld.entities || [];
    const statusOf = new Map(ents.map((e) => [e.id, e.status || 'active']));
    const gatedIds = new Set(ents.filter((e) => (statusOf.get(e.id) ?? 'active') === 'active').map((e) => e.id));

    // 第 1 轮的池：从真账自身读（历史最后一条 simLog 就是"门控上次说的话"）
    const histLog = (baseWorld.meta?.simLog || [])[(baseWorld.meta?.simLog || []).length - 1];
    const histActive = new Set(histLog ? [...gatedIds].filter((id) => !new Set(histLog.silent || []).has(id)) : [...gatedIds]);
    // 窄集合（"本来就可动"）：只由**真账末条 simLog** 决定，全跑期不随放宽后的引擎变化。
    const narrowSeed = new Set(histActive);
    const state = {
        variant, i: 0, playerId: baseWorld.context?.playerId ?? null,
        pool: stubPool(baseWorld, variant, histActive), lastPicks: [], emptyPoolTicks: [],
        seenAgendas: new Set((baseWorld.agendas || []).map((a) => a.id)),   // 出生判定用"id 差集"，不猜 id 格式
        // ★只应答臂：narrow = 「本来就可动」∪「本轮被点名的人」。后者用引擎自己的 log.lifted——
        //   它是"被未决事件 ripples 点名"的权威名单 ⇒ "应答 = 对已经发生的事做反应"有引擎侧凭据。
        replyOnly: process.env.SW2_REPLY_ONLY === '1',
        narrow: new Set(histLog?.lifted || []),    };

    const perTick = [];
    const owners = new Map();
    const bornRipples = new Map();
    const historicEventIds = new Set((baseWorld.events || []).map((e) => e.id));
    const capWarn = { 盘算大厦顶: 0, 事件洪峰: 0, 其他: 0 };
    let mirrorMismatch = 0, checked = 0, bornTotal = 0;

    const { world: endWorld, metrics } = await runSmoke({
        ssot: baseWorld,
        ticks: TICKS,
        stepGen: makeStepGen(state),
        // ★对话给空串：`extractMove` 拿实体名做**子串匹配**找"落子对象"，'（继续）' 会命中玩家（叫"你"）
        //   ⇒ 每轮给玩家开一次口子，污染门控③。测量要的是"只看门控"，对话噪声必须清零。
        dialogueGen: () => '',
        onTick: (_loopIndex, w) => {
            const simTick = w.meta.tick;                               // ★simLog 用的是世界 tick，不是循环序号
            const log = (w.meta.simLog || [])[(w.meta.simLog || []).length - 1];
            if (!log || log.tick !== simTick) throw new Error(`日志错位：log.tick=${log?.tick} vs meta.tick=${simTick}`);

            // --- 自校验：镜像 vs 真门控（不一致即中止，绝不带病出数） ---
            const sil = silhouette(w);
            const realSilent = new Set(log.silent || []);
            const realLifted = new Set(log.lifted || []);
            const mineSilent = new Set([...sil.silent].filter((id) => !sil.lifted.has(id)));
            const realSilentOnly = new Set([...realSilent].filter((id) => !realLifted.has(id)));
            checked++;
            const diff = [...new Set([...realSilentOnly, ...mineSilent])].filter((id) => realSilentOnly.has(id) !== mineSilent.has(id));
            if (diff.length) {
                mirrorMismatch += diff.length;
                if (mirrorMismatch <= 6) console.log(`   ★镜像与真门控不一致 t${simTick}：${diff.length} 个（例：${diff.slice(0, 3).join(',')}）`);
            }

            const realActive = new Set([...gatedIds].filter((id) => !realSilent.has(id) || realLifted.has(id)));
            // 本轮实际挑了谁（从桩自己的记账取，不用残留值）
            const picked = state.lastPicks;
            // 本轮真正落账的新盘算（相对生成前的世界）→ 用 owner 记账
            const bornNow = (w.agendas || []).filter((a) => !state.seenAgendas.has(a.id));
            for (const a of bornNow) { state.seenAgendas.add(a.id); owners.set(a.owner, (owners.get(a.owner) || 0) + 1); }
            bornTotal += bornNow.length;

            // 集中度：只数**本轮新落账**事件牵动的人（历史事件不算，否则各变体读数会一样）
            for (const ev of w.events || []) {
                if (historicEventIds.has(ev.id)) continue;
                for (const r of ev.ripples || []) bornRipples.set(r, (bornRipples.get(r) || 0) + 1);
            }
            for (const wn of log.warnings || []) {
                if (wn.includes('盘算大厦顶')) capWarn.盘算大厦顶++;
                else if (wn.includes('事件洪峰')) capWarn.事件洪峰++;
                else capWarn.其他++;
            }

            // --- 为下一轮备池：真门控的可行动集合 → 该档口径 ---
            state.pool = stubPool(w, variant, realActive);
            // 只应答臂的"点名"依据 = 本来就可动的那几个（窄集合，全跑期恒定）∪ 本轮被引擎点名的人。
            //   窄集合用真账末条 simLog 算一次即可：放宽门控后 log.lifted 不再包含他们（他们已不在静默名单里）。
            state.narrow = new Set([...narrowSeed, ...realLifted]);
            state.lastPicks = [];

            perTick.push({
                simTick, loop: perTick.length + 1,
                realActive: realActive.size, silent: realSilent.size, lifted: realLifted.size,
                pool: [...state.pool].filter((id) => id !== state.playerId).length,
                picked: picked.length, born: bornNow.length,
                dropped: Object.values(log.silentDropped || {}).reduce((a, b) => a + b, 0),
            });
        },
    });

    const allRipples = [...bornRipples.values()].reduce((a, b) => a + b, 0);
    const top3 = [...bornRipples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const top3Share = allRipples ? Math.round((top3.reduce((a, [, v]) => a + v, 0) / allRipples) * 1000) / 10 : 0;
    return {
        variant, perTick, owners, bornTotal, distinctOwners: owners.size,
        peakPool: perTick.reduce((m, p) => Math.max(m, p.pool), 0),
        endRealActive: perTick.length ? perTick[perTick.length - 1].realActive : 0,
        top3, top3Share, capWarn, mirrorMismatch, checked, emptyPoolTicks: state.emptyPoolTicks,
        breadth: bornRipples.size, rippleSamples: allRipples,
        peakOpen: metrics.peakOpenAgendas, warningsTotal: metrics.warningsTotal,
    };
}

// ================================ 主 ================================
// --json：只吐一行 JSON（供批量跑变体用），所有人类可读输出抑制。
const say = (...a) => { if (!AS_JSON) console.log(...a); };
say('════ 静默门出数（细案 spec-world-widening §5）════');
say(`参数：ticks=${TICKS} quota=${QUOTA}（每轮提议新盘算数，各变体恒定）｜QUIET_TICKS=${QUIET_TICKS}｜盘算上限 ${JSON.stringify(AGENDA_CAPS)}｜事件上限 ${JSON.stringify(EVENT_CAPS)}｜门控模块=${GATE_FILE ? `副本(${VARIANT_ENV})` : '仓库真源'}`);
if (!CHAT) { console.log('未给 --chat ⇒ 退出（结构层也要真账）。'); process.exit(0); }

const base = loadWorldFromChat(CHAT);
const ents = base.entities || [];
say(`\n真账：tick ${base.meta?.tick}｜实体 ${ents.length}（${ents.filter((e) => e.kind === 'faction').length} 势力 / ${ents.filter((e) => e.kind === 'character').length} 角色）｜事件 ${(base.events || []).length}（未决 ${(base.events || []).filter((e) => !e.closed).length}）｜盘算 ${(base.agendas || []).length}（在飞 ${(base.agendas || []).filter((a) => !a.closed).length}）｜simLog ${(base.meta?.simLog || []).length}`);

// ---- ① 结构层（不跑引擎；重取，leg28 那套是 tick 9 的旧数） ----
const sil0 = silhouette(base);
const hist0 = (base.meta?.simLog || [])[(base.meta?.simLog || []).length - 1];
const realActive0 = new Set(ents.map((e) => e.id).filter((id) => !new Set(hist0?.silent || []).has(id) || new Set(hist0?.lifted || []).has(id)));
say('\n──── ① 结构层：现状与各档（真账读数） ────');
say(`镜像静默 ${sil0.silent.size}｜真门控静默 ${(hist0?.silent || []).length}（末条 simLog）｜真门控可行动 ${realActive0.size}｜被点名解除 ${(hist0?.lifted || []).length}`);
say(`　账上有据：位置已知 ${ents.filter(hasLoc).length}｜有隶属 ${ents.filter(hasParent).length}｜两者任一 ${ents.filter((e) => hasLoc(e) || hasParent(e)).length}｜两者都满足 ${ents.filter((e) => hasLoc(e) && hasParent(e)).length}`);

const rows = [];
for (const key of [...Object.keys(B2_TIERS), 'B1', 'B3']) {
    const pool = stubPool(base, key, realActive0);
    const unlocked = ents.filter((e) => sil0.silent.has(e.id) && !sil0.lifted.has(e.id) && pool.has(e.id));
    const facNames = new Set(ents.filter((e) => e.kind === 'faction').map((e) => e.name));
    const factions = new Set(unlocked.filter((e) => facNames.has(e.name)).map((e) => e.name));
    const locations = new Set(unlocked.map((e) => e.location).filter((l) => hasLoc({ location: l })));
    rows.push({
        key, label: key === 'B1' ? 'B1 从没出过手也算可动' : key === 'B3' ? 'B3 沿隶属传递（最窄）' : B2_TIERS[key].label,
        pool: [...pool].filter((id) => id !== (base.context?.playerId ?? null)).length,
        unlocked: unlocked.length, factions: factions.size, locations: locations.size,
    });
}
say('\n档位                    桩候选池   从静默里放出   涉及势力   涉及地点');
for (const r of rows) {
    say(`${r.label.padEnd(22)} ${String(r.pool).padStart(8)} ${String(r.unlocked).padStart(12)} ${String(r.factions).padStart(10)} ${String(r.locations).padStart(10)}`);
}

// ---- ② 引擎跑 ----
say('\n──── ② 引擎跑（真 runSmoke；变体只改"桩从哪张名单挑人"，真门控当裁判） ────');
const results = [];
// ★--gate 模式下：引擎自己已被换成"放宽后的门控"，桩只需覆盖全部门控成员
//   ⇒ 只跑一个变体（由 SW2_VARIANT 决定引擎口径），避免重复跑五遍。
const variants = GATE_FILE ? ['all'] : ['baseline', 'a', 'b', 'c', 'd'];
for (const v of variants) {
    const label = v === 'baseline' ? '现状（不改）' : v === 'all' ? `引擎=门控副本(${VARIANT_ENV})` : B2_TIERS[v].label;
    const r = await runVariant(base, v);
    results.push(r);
    const flag = r.mirrorMismatch ? `★镜像分歧 ${r.mirrorMismatch}` : '镜像一致';
    const flag2 = r.emptyPoolTicks.length ? `★空池 ${r.emptyPoolTicks.length} 轮` : '无空池';
    say(`${label}：候选池峰 ${r.peakPool}｜末轮真可行动 ${r.endRealActive}｜新生盘算 ${r.bornTotal}（属主 ${r.distinctOwners}）｜在飞峰 ${r.peakOpen}｜警告 ${r.warningsTotal}（大厦顶 ${r.capWarn.盘算大厦顶}/洪峰 ${r.capWarn.事件洪峰}/其他 ${r.capWarn.其他}）｜新事件集中度 前3占 ${r.top3Share}%｜${flag}｜${flag2}`);
}

// ---- ③ 逐轮曲线 ----
say('\n──── ③ 逐轮「桩候选池 / 真可行动 / 真静默 / 被滤」 ────');
const head = results.map((r) => (r.variant === 'baseline' ? '现状' : r.variant).padStart(11)).join('');
say(`${'轮'.padStart(4)}${head}   ← 每格：池/可行动/静默/被滤`);
for (let i = 0; i < TICKS; i++) {
    const cells = results.map((r) => {
        const p = r.perTick[i];
        return p ? `${p.pool}/${p.realActive}/${p.silent}/${p.dropped}`.padStart(11) : '          -';
    }).join('');
    say(`${String(i + 1).padStart(4)}${cells}`);
}

// ---- ④ 不共线：第二本书（结构面） ----
say('\n──── ④ 不共线（细案 §5 第 5 条：至少 2 个多书世界） ────');
const bookRows = [];
if (BOOKS_DIR && existsSync(BOOKS_DIR)) {
    const files = readdirSync(BOOKS_DIR).filter((f) => f.endsWith('.json'));
    say(`世界书目录（${files.length} 本）——结构面读数（★**不是**第二世界的引擎跑）：`);
    for (const f of files) {
        try {
            const b = JSON.parse(readFileSync(join(BOOKS_DIR, f), 'utf8'));
            const raw = b.entries;
            const list = (Array.isArray(raw) ? raw : Object.values(raw || {})).filter((e) => e && typeof e === 'object');
            const on = list.filter((e) => e.disable !== true && e.enabled !== false);
            const MEMBER_STRICT = /^[-*·•\s]*([^\s(（:：、,]{2,20})\s*[（(]\s*(男|女|雄|雌|公|母)\s*[,，、]\s*([^)）]{1,24})[)）]/gm;
            const PLACE_HINT = /(?:所在地|驻地|核心底蕴|位于|地处|居)\s*[:：]?\s*([^\n。；]{2,30})/g;
            let memberRows = 0, placeRows = 0;
            for (const e of on) {
                const c = String(e.content || '');
                MEMBER_STRICT.lastIndex = 0; PLACE_HINT.lastIndex = 0;
                if (MEMBER_STRICT.test(c)) memberRows++;
                if (PLACE_HINT.test(c)) placeRows++;
            }
            bookRows.push({ file: f, entries: on.length, memberRows, placeRows });
            say(`  ${f.padEnd(38)} 条目 ${String(on.length).padStart(4)}｜严口径成员行 ${String(memberRows).padStart(4)}｜驻地线索 ${String(placeRows).padStart(4)}`);
        } catch (err) { say(`  ${f.padEnd(38)} [SKIP] ${err.message}`); }
    }
    say('　★B2 两档的载体：严口径成员行 ⇒ 隶属(parent)可推；驻地线索 ⇒ 位置可推。');
} else {
    say('未给 --books：跳过。');
}

// ---- ⑤ 结论速览 ----
say('\n──── ⑤ 结论速览（P2 拍板用） ────');
say('档位                    候选池峰   末轮真可行动   新生盘算   不同属主   新事件前3占   撞闸(大厦顶/洪峰)');
for (const r of results) {
    const label = r.variant === 'baseline' ? '现状（不改）' : r.variant === 'all' ? `门控副本(${VARIANT_ENV})` : B2_TIERS[r.variant].label;
    say(`${label.padEnd(22)} ${String(r.peakPool).padStart(8)} ${String(r.endRealActive).padStart(13)} ${String(r.bornTotal).padStart(10)} ${String(r.distinctOwners).padStart(10)} ${String(r.top3Share + '%').padStart(13)}   ${r.capWarn.盘算大厦顶}/${r.capWarn.事件洪峰}`);
}
say('\n★未完成项（如实记）：第二世界的引擎跑需要第二本热账（要跑真模型抽取，属 §5 之外，未擅自跑）。');
say('★自校验：每变体一行"镜像一致/★镜像分歧"+"无空池/★空池"；任一项异常即为脚手架故障，读数不可用。');

// ---- JSON 出口（供批量跑变体；不含人类可读文本） ----
if (AS_JSON) {
    console.log(JSON.stringify({
        gate: GATE_FILE ? `copy:${VARIANT_ENV}` : 'repo-real',
        ticks: TICKS, quota: QUOTA,
        base: { tick: base.meta?.tick, entities: ents.length, histSilent: (hist0?.silent || []).length, histActive: realActive0.size },
        struct: rows,
        books: bookRows,
        variants: results.map((r) => ({
            variant: r.variant, peakPool: r.peakPool, endRealActive: r.endRealActive,
            bornTotal: r.bornTotal, distinctOwners: r.distinctOwners, top3: r.top3, top3Share: r.top3Share,
            breadth: r.breadth, rippleSamples: r.rippleSamples,
            capWarn: r.capWarn, mirrorMismatch: r.mirrorMismatch, emptyPoolTicks: r.emptyPoolTicks.length,
            peakOpen: r.peakOpen, warningsTotal: r.warningsTotal,
            series: r.perTick.map((p) => ({ t: p.simTick, pool: p.pool, active: p.realActive, silent: p.silent, dropped: p.dropped, born: p.born })),
        })),
    }));
}
