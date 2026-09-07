// story-world-v2/src/settle.js
// 结算管线（S5）：按序 校验 → 薄裁定 → 因果挂链 → 一致性检查 → 分量重算（常量占位）→ 落账 → 编年 → GC/度量。
// 纯函数：输入 SSOT 不被修改，返回新世界。硬规则出处：ANCHOR §3②/§4.2/§4.4/§4.5、切片细案 S5、长跑防线细案 §2.5。
import { checkWorldStep } from './check-step.js';
import { buildEvolutionPack } from './pack.js';
import { gateWorldStep } from './gate.js';
import { computeWeightAtTick } from './weight.js';

export const ATTR_BOUNDS = [0, 1];    // 属性硬边界（薄裁定器按量裁的硬结果之一）

// K9：玩家影响通道系数（玩家档案细案 §3.3，提案态——K11 曲线校准后正式报批，铁律 2/8）
export const PLAYER_IMPACT = { targeted: 0.05, rippled: 0.02 };

// K14 出生裁判上限（盘算树细案 §3.2 → A-3）：每 tick 新生 / 在飞全局 / 顶层（无父）上限。
// T2 已拍板；数字提案态——K16 冒烟曲线后正式报批（铁律 2/8）。
export const AGENDA_CAPS = { perTick: 2, open: 15, topLevel: 5 };
const AGENDA_STAGE_FALLBACK = '谋划';   // 新盘算缺省阶段（ssot schema 要求 stage 非空）
export const VERDICT_HURT_THRESHOLD = 0.05;   // K15 败露判据（细案 §3.4，T3 已拍板；提案态——随 GC 数字一并报批）

// K19 事件产率上限 / 链尾结清窗（因果链细案 §3.1/§3.2，T1/T2 已拍板；均提案态——曲线支撑：
// 产率 max 4/tick 开局、稳态 1（细案 §1 配套曲线）；正式报批走报批支线，铁律 2/8）
export const EVENT_CAPS = { perTick: 6 };
export const CHAIN_SETTLE = 5;

// K20 档案摘要化（因果链细案 §3.3，T3 已拍板 + T3-D1 引擎结构摘要；longrun §2.2 原值，提案态——随报批支线）
// 热窗 20 tick：闭环满 20 tick 且无未决下游 → 按出生段压入里程碑（温层）；里程碑不进模型输入（pack 只取未决+近 2 closed，自动剥离）
export const ARCHIVE = { hotWindow: 20, milestoneEvery: 10 };

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

const SOURCE_LABEL = { plot: '盘算', state: '状态', ripple: '波及' };

const entityName = (world, id) => world.entities.find((e) => e.id === id)?.name || id;   // 编年渲染：id 一律成名（"棋好看"）

// ①-② 校验 + 薄裁定（硬结果：属性边界；K5 分量折减：低分量动作方按分量比折减——幅度单调 P7；静默方自我增强被拒）
// K15：hurtByEntity 收集 stateChanges 负向实际生效值（三态败露判据的窗口输入）
function adjudicate(world, step, tick, warnings, gate, hurtByEntity) {
    const checked = checkWorldStep(step, world);
    if (!checked.ok) {
        for (const e of checked.errors) warnings.push(`校验拒绝: ${e}`);
        return false;
    }
    const weights = world.weights || {};
    const silentSet = new Set(gate.silent);
    const liftedSet = new Set(gate.lifted);
    for (const [i, c] of step.stateChanges.entries()) {
        const e = world.entities.find((x) => x.id === c.entity);
        if (!e) continue; // 校验层已保证存在（防御）
        const selfSilent = !c.actor && silentSet.has(c.entity) && !liftedSet.has(c.entity);
        let eff = c.delta;
        if (selfSilent) {
            eff = 0;
            warnings.push(`裁定: 静默方自我增强被拒（${c.entity}.${c.attr} 申请 ${c.delta}）`);
        } else if (c.actor && c.actor !== c.entity && weights[c.actor] != null) {
            const wAct = weights[c.actor] ?? 0;
            const wTgt = weights[c.entity] ?? 0;
            if (wTgt > 0 && wAct < wTgt) {
                const ratio = wAct / wTgt;   // 低分量动作方折减（P7）
                eff = c.delta * ratio;
                warnings.push(`裁定: 分量比折减 ${ratio.toFixed(3)}（${c.actor}→${c.entity}.${c.attr}）`);
            }
        }
        if (!c.cause) warnings.push(`stateChanges 无 cause: ${c.entity}.${c.attr}（坏账前置，K5）`);
        const before = e.attrs[c.attr] ?? 0;
        const after = clamp(before + eff, ATTR_BOUNDS);
        if (after !== before + eff) {
            warnings.push(`裁定: 属性硬边界（${c.entity}.${c.attr} ${before}→${after}，申请 ${before + eff}）`);
        }
        e.attrs[c.attr] = after;
        if (after < before) hurtByEntity[c.entity] = (hurtByEntity[c.entity] ?? 0) + (after - before);   // K15：负向 δ（实际生效值）
    }
    return true;
}

// ③ 因果挂链：新事件落账为节点，上游指针入 links.up
function hangEvents(world, step, tick) {
    const added = [];
    step.newEvents.forEach((ev, i) => {
        const id = `ev_${tick}_${i + 1}`;
        const node = {
            id,
            title: ev.title,
            source: { ...ev.source },
            position: ev.position,
            ripples: [...(ev.ripples || [])],
            links: { up: ev.source.type === 'ripple' ? [ev.source.ref] : [], down: [] },
            closed: false,
        };
        world.events.push(node);
        added.push(node);
    });
    return added;
}

// 事件源分量解析（K9 影响通道 / K10 注入掩码共用）：
// plot → 盘算属主分量；ripple → 沿链上溯至 plot/state；state → 世界大势常量 1.0（提案：天威以全力论）。
// K20 跨段防御：上溯未命中 events → 查 milestones.ids（归档事件在里程碑内的 id 清单中可达）。
// 不变式：未决事件的链上游必在热池（归档候选要求"无未决下游"）——防御不删，周期零成本。
export function resolveEventSource({ world, ev, weights }) {
    const agendaOwner = new Map((world.agendas || []).map((a) => [a.id, a.owner]));
    const findNode = (id) =>
        (world.events || []).find((e) => e.id === id)
        || (world.milestones || []).find((m) => m.ids.includes(id))
        || (world.milestones || []).find((m) => m.id === id)
        || null;
    let cur = ev;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
        seen.add(cur);
        const type = cur.source?.type;
        if (type === 'plot') {
            const owner = agendaOwner.get(cur.source.ref);
            return { source: owner ?? cur.source.ref, weight: weights[owner] ?? 0 };
        }
        if (type === 'state') return { source: 'world', weight: 1.0 };
        cur = (cur.source?.ref && findNode(cur.source.ref)) || null;
    }
    return { source: 'world', weight: 0 };
}

// K9 影响通道（引擎独占写玩家，红线 1 代码化，玩家档案细案 §3.3）：
// ① 他人 actions[].target === playerId → hardPower −= 0.05×min(1, w_src/w_player)
// ② 新事件波及玩家 → 各 attrs −= 0.02×min(1, w_src/w_player)
// 确定性、钳制 [0,1]、simLog 审计（playerAffected）。零分量玩家不被点名影响（与"零分量无所见"对偶）。
function applyPlayerImpact(world, gstep, tick, playerId, playerAffected, warnings) {
    const player = world.entities.find((e) => e.id === playerId);
    if (!player) return;
    const weights = world.weights || {};
    const wPlayer = weights[playerId] ?? 0;
    if (!(wPlayer > 0)) return;
    const hit = (attr, amount, ratio, source) => {
        const before = player.attrs[attr] ?? 0;
        const after = clamp(before + amount, ATTR_BOUNDS);
        if (after !== before + amount) {
            warnings.push(`裁定: 属性硬边界（${playerId}.${attr} ${before}→${after}，申请 ${before + amount}）`);
        }
        player.attrs[attr] = after;
        playerAffected.push({ tick, source, attr, delta: after - before, ratio });
    };
    for (const a of gstep.actions) {
        if (a.target !== playerId) continue;
        const wSrc = weights[a.entity] ?? 0;
        const ratio = Math.min(1, wSrc / wPlayer);
        hit('hardPower', -PLAYER_IMPACT.targeted * ratio, ratio, a.entity);
    }
    for (const ev of gstep.newEvents) {
        if (!(ev.ripples || []).includes(playerId)) continue;
        const { source, weight: wSrc } = resolveEventSource({ world, ev, weights });
        const ratio = Math.min(1, wSrc / wPlayer);
        for (const attr of Object.keys(player.attrs)) hit(attr, -PLAYER_IMPACT.rippled * ratio, ratio, source);
    }
}

// 执行债（events.closed 关闭路径最小面，2026-09-07 顺手清）+ K19 闭环三型（因果链细案 §3.1 → A-1）：
// ① 源结清：盘算终结/取消 → 其 plot 源事件全部闭环（closedAt 记落账 tick——归档判龄）；
// ② 链尾结清：ripple 事件链头已了结 + 落账 ≥ 涟漪平息窗（CHAIN_SETTLE）+ 无未决下游引用 → 自动闭环
//    （"涟漪平息"——K6 点名窗口随链尾收敛，世界不自锁）；链头语义：plot → 源盘算终结才算数；
//    state → 处境不是驱动马达（波纹靠自身延伸/消亡），恒视为已了结（常驻保留不变）；
// ③ 常驻保留：state 源未决事件永不自动闭环（不在此函数内处理）。
// 闭环留痕只进观棋（不带 eventRef → 不进注入：闭环是历史状态，不是新动向）。
// 完整闭环设计（叶子结清/裁剪/事件产率上限）随因果链强化阶段（dev-process §6 队列）。
const bornTickOf = (ev) => {
    const n = Number((ev.id || '').split('_')[1]);   // 事件 id 契约 ev_<tick>_<n>（hangEvents 唯一生成点，格式已锁）
    return Number.isInteger(n) && n >= 0 ? n : -Infinity;   // 解析失败按"老账"（窗恒满）
};
const headClosed = (world, ev) => {
    let cur = ev;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
        seen.add(cur);
        if (cur.source?.type === 'plot') {
            const a = (world.agendas || []).find((x) => x.id === cur.source.ref);
            return !!(a && a.closed);
        }
        if (cur.source?.type === 'state') return true;
        cur = (cur.source?.ref && world.events.find((e) => e.id === cur.source.ref)) || null;
    }
    return false;   // 防御：链异常/悬空 → 不结清
};
const hasPendingDownstream = (world, ev) =>
    (world.events || []).some((e) => !e.closed && (e.links?.up || []).includes(ev.id));   // 下游 = links.up 引用方（down 未维护）

function closeEvents(world, closedIds, tick, chronicle) {
    if (closedIds.size) {
        for (const ev of world.events) {
            if (ev.closed || ev.source?.type !== 'plot') continue;
            if (!closedIds.has(ev.source.ref)) continue;
            ev.closed = true;
            ev.closedAt = tick;
            chronicle.push({ id: `ch_${tick}_evc_${ev.id}`, tick, text: `事件「${ev.title}」闭环（源盘算已结算）` });
        }
    }
    for (const ev of world.events) {
        if (ev.closed || ev.source?.type !== 'ripple') continue;
        if (!headClosed(world, ev)) continue;
        if (tick - bornTickOf(ev) < CHAIN_SETTLE) continue;
        if (hasPendingDownstream(world, ev)) continue;
        ev.closed = true;
        ev.closedAt = tick;
        chronicle.push({ id: `ch_${tick}_evc2_${ev.id}`, tick, text: `事件「${ev.title}」涟漪平息（链源已了结）` });
    }
}

// ④ 行动↔盘算一致性（生成器烟雾报警器）：动作实体须有未结在飞盘算

// ---- K14 出生裁判（盘算树细案 §3.2/§3.3 → A-2/A-3/A-4/A-5 前半）----
// gate 已滤静默方提案（A-2）；此处 GC 上限（A-3）→ 落账（§3.1 形状）→ 挂因/委派留痕（§4.4①/②，
// 父 promises 写 = A-5 前半）→ 环检测自动拆（A-4：低分量方断边转伺机 + memory.blocked 写 + 编年留痕）。
// 环检测为防御性实现：parentId 不可变 + K13 校验（parent 源必引已存在在飞盘算）下，同 tick 互指提议
// 在契约层即被拒，环仅可能来自历史/手工错账（记台账 K14 行）——防御不删，周期零成本。

// 环检测（§3.3）：从新节点沿 parentId 链上溯，路径上出现重复节点即环；返回环上成员数组（含重复起点）。
function findCycle(start, agendas) {
    const byId = new Map(agendas.map((a) => [a.id, a]));
    const path = [];
    const seen = new Set();
    let cur = start;
    while (cur) {
        if (seen.has(cur.id)) {
            return path.slice(path.findIndex((a) => a.id === cur.id));
        }
        seen.add(cur.id);
        path.push(cur);
        cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
    return null;
}

// 自动拆环（ANCHOR §4.1 / 细案 §3.3 → A-4）：环内按分量升序，最低分量方断其与父的边转独立
// （分量相等按 progress 浅者先让；再相等按 id 序——确定性兜底）；blocked 记"拆环让路"；编年留痕。
function breakCycle(cycle, world, tick, chronicle) {
    const weights = world.weights || {};
    const sorted = [...cycle].sort((x, y) => {
        const wx = weights[x.owner] ?? 0;
        const wy = weights[y.owner] ?? 0;
        if (wx !== wy) return wx - wy;
        if (x.progress !== y.progress) return x.progress - y.progress;
        return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
    });
    const victim = sorted[0];
    delete victim.parentId;
    victim.memory.blocked.push('拆环让路');
    chronicle.push({
        id: `ch_${tick}_cyc_${victim.id}`,
        tick,
        text: `拆环：${entityName(world, victim.owner)} 让路转伺机（分量最低）`,
    });
}

export function spawnAgendas(world, gstep, tick, warnings, chronicle) {
    const spawned = [];
    for (const na of gstep.newAgendas || []) {
        const goal = na.goal;
        const owner = na.entity;
        const openNow = (world.agendas || []).filter((a) => !a.closed).length + spawned.length;
        const topNow = (world.agendas || []).filter((a) => !a.closed && !a.parentId).length
            + spawned.filter((a) => !a.parentId).length;
        // GC 上限（A-3）：超限拒建 + 警告，世界其余照常（超限不新建，§4.3 语义之一）
        if (spawned.length >= AGENDA_CAPS.perTick) {
            warnings.push(`裁定: 盘算大厦顶（每 tick 新生 ≤${AGENDA_CAPS.perTick}）：${entityName(world, owner)} 提议「${goal}」被拒`);
            continue;
        }
        if (openNow >= AGENDA_CAPS.open) {
            warnings.push(`裁定: 盘算大厦顶（在飞全局 ≤${AGENDA_CAPS.open}）：${entityName(world, owner)} 提议「${goal}」被拒`);
            continue;
        }
        if (na.source.type !== 'parent' && topNow >= AGENDA_CAPS.topLevel) {
            warnings.push(`裁定: 盘算大厦顶（顶层 ≤${AGENDA_CAPS.topLevel}）：${entityName(world, owner)} 提议「${goal}」被拒`);
            continue;
        }
        // 落账（§3.1：与既有 agenda 同形状 + 可选 parentId；id = a_<tick>_<n>；maxSteps 缺省 4）
        const agenda = {
            id: `a_${tick}_${spawned.length + 1}`,
            owner,
            goal,
            stage: na.stage || AGENDA_STAGE_FALLBACK,
            visibility: na.visibility,
            maxSteps: na.maxSteps ?? 4,
            progress: 0,
            memory: { promises: [], done: [], blocked: [], turnsAlive: 0 },
        };
        if (na.source.type === 'parent') agenda.parentId = na.source.ref;
        world.agendas.push(agenda);
        // 环检测（§3.3）：每次创建时沿父链上溯，触到自己即环（确定性）；成环不拒绝整件事——自动拆
        const cycle = findCycle(agenda, world.agendas);
        if (cycle) breakCycle(cycle, world, tick, chronicle);
        spawned.push(agenda);
        // 挂因留痕（§4.4①/②，措辞按细案 §3.2 三型）
        if (na.source.type === 'state') {
            chronicle.push({ id: `ch_${tick}_ag_${agenda.id}`, tick, text: `由处境而生：${entityName(world, owner)} 生「${goal}」` });
        } else if (na.source.type === 'event') {
            const ev = (world.events || []).find((e) => e.id === na.source.ref);
            chronicle.push({ id: `ch_${tick}_ag_${agenda.id}`, tick, text: `因事而生：${entityName(world, owner)} 由「${ev?.title ?? na.source.ref}」生「${goal}」` });
        } else {
            const parent = world.agendas.find((x) => x.id === agenda.parentId);
            parent.memory.promises.push(agenda.id);   // A-5 前半：委派承诺写入（清 promises 写入执行债）
            // K21 暗处渲染（因果链细案 §3.4 → A-4）：concealed 委派不留痕——数据照写（父 promises 属账），编年抑制（暗处不曝光）
            if (agenda.visibility !== 'concealed') {
                chronicle.push({
                    id: `ch_${tick}_ag_${agenda.id}`,
                    tick,
                    text: `委派：${entityName(world, parent.owner)} 拆大给小——「${goal}」（授 ${entityName(world, owner)}）`,
                });
            }
        }
    }
    return spawned;
}
function checkConsistency(world, step, warnings) {
    const openOwners = new Set((world.agendas || []).filter((a) => !a.closed).map((a) => a.owner));
    for (const a of step.actions) {
        if (!openOwners.has(a.entity)) {
            warnings.push(`行动↔盘算不一致: ${a.entity} 无在飞盘算仍然行动（烟雾报警）`);
        }
    }
}

// ⑤ 分量重算（K3：真公式 × 静止衰减因子；衰减作用于分量缓存不改属性——动量分离，长跑 §2.3）
function recomputeWeights(world, tick) {
    const tension = world.context?.tension ?? 0.5;
    world.weights = {};
    for (const e of world.entities) {
        const idle = tick - (e.lastActiveTick ?? 0);   // 旧夹具无历史按 tick 计；宽限期（人物 8/势力 20）内因子恒 1
        world.weights[e.id] = computeWeightAtTick(e.attrs, e.kind, tension, idle);
    }
    return world.weights;
}

// K22 取消通道裁决（因果链细案 §3.5 → A-5；C3 拍板落地——生命周期六态补全，与出生对称）：
// 模型只有提议权（gate 已滤静默方，K18）；引擎无条件裁决（轻量版）——closed + memory.blocked 记"放弃"
// + 编年措辞精确 + 在飞子断链转独立（不悬挂已死之父，K15 托孤同哲学）+ plot 源事件联闭（交 closeEvents）。
// 取消先于推进：同 tick 的被取消者推进落入既有 closed 拦截（世界不重唱）。不记兑现/败露/达成（取消是独立结局）。
function applyAgendaCancels(world, gstep, tick, chronicle) {
    const cancelled = new Set();
    for (const ac of gstep.agendaCancels || []) {
        const a = world.agendas.find((x) => x.id === ac.agendaId);
        if (!a || a.closed) continue;   // 校验层已保证在飞（防御）
        a.closed = true;
        a.memory.blocked.push(`t${tick}: 放弃（${ac.reason || '未言明'}）`);
        cancelled.add(a.id);
        const owner = entityName(world, a.owner);
        chronicle.push({
            id: `ch_${tick}_can_${a.id}`,
            tick,
            text: `盘算「${a.goal}」取消（${owner}）：${ac.reason || '未言明理由'}`,
        });
        const sons = world.agendas.filter((x) => x.parentId === a.id && !x.closed);
        if (sons.length) {
            for (const s of sons) delete s.parentId;   // 诸子断链转独立（事业未竟，不悬挂已死之父）
            chronicle.push({
                id: `ch_${tick}_canS_${a.id}`,
                tick,
                text: `取消后遗留子盘算 ${sons.length} 项转独立（事业未竟）`,
            });
        }
    }
    return cancelled;
}

// ⑥ 落账：盘算推进 + 生命周期（返回本 tick 新结算的盘算 id 集——终结产果联闭用）
function applyAgendaAdvances(world, step, tick, chronicle, warnings) {
    const closedIds = new Set();
    for (const ad of step.agendaAdvances) {
        const a = world.agendas.find((x) => x.id === ad.agendaId);
        if (!a) continue;   // 校验层已保证存在
        if (a.closed) {
            // 满步重播拦截（活档实测发现）：已结算盘算的推进 → 警告 + 跳过，世界不重唱"达成"
            warnings.push(`盘算推进被拒: ${ad.agendaId}（${a.goal}）已结算`);
            continue;
        }
        a.progress += 1;
        if (ad.stage) a.stage = ad.stage;
        a.memory.done.push(`t${tick}: ${ad.step}`);
        a.memory.turnsAlive += 1;
        // K21 暗处渲染（因果链细案 §3.4 → A-4）：concealed 推进不留痕——memory.done 属账照写，动态流条目抑制（暗处合法）
        if (a.visibility !== 'concealed') {
            chronicle.push({ id: `ch_${tick}_adv_${ad.agendaId}`, tick, text: `盘算「${a.goal}」推进：${ad.step}` });
        }
        if (a.progress >= a.maxSteps) {
            a.closed = true;
            closedIds.add(a.id);
            // K15 满步三态（细案 §3.4 → A-6；模型无直接终结通道，结局全归引擎）：
            // 判序 = 变形（有在飞子 → 事业移交诸子，断链转独立）→ 败露（近 2 tick 负 δ ≥0.05 提案）→ 达成。
            // 判序决策（记台账）：托孤优先——任何有在飞子的终结必先断链，子盘算不悬挂已死之父；
            // 败露/达成只在无子时按伤害窗口裁决；三种终止都终结产果（§4.4④）。
            const sons = world.agendas.filter((x) => x.parentId === a.id && !x.closed);
            let verdict = '达成';
            if (sons.length) {
                verdict = '变形';
                for (const s of sons) delete s.parentId;   // 诸子断链转独立（树在结算中演化）
                chronicle.push({
                    id: `ch_${tick}_fin_${a.id}`,
                    tick,
                    text: `盘算「${a.goal}」满步结算：变形，事业移交诸子（${sons.length} 项断链转独立）`,
                });
            } else {
                const owner = world.entities.find((x) => x.id === a.owner);
                const hw = owner?.hurtWindow || [0, 0];
                if (Math.abs((hw[0] ?? 0) + (hw[1] ?? 0)) >= VERDICT_HURT_THRESHOLD) {
                    verdict = '败露';
                    chronicle.push({
                        id: `ch_${tick}_fin_${a.id}`,
                        tick,
                        text: `盘算「${a.goal}」满步结算：败露——功败垂成（${entityName(world, a.owner)}）`,
                    });
                } else {
                    chronicle.push({
                        id: `ch_${tick}_fin_${a.id}`,
                        tick,
                        text: `盘算「${a.goal}」满步结算：达成（终结产果 §4.4④）`,
                    });
                }
            }
            // K14 兑现落痕（细案 §3.3 → A-5 后半）：仅"达成"态兑现——败露/变形不记（K15 三态后收紧）
            if (verdict === '达成' && a.parentId) {
                const parent = world.agendas.find((x) => x.id === a.parentId);
                if (parent) {
                    parent.memory.done.push(`兑现：${a.goal}`);
                    // K21 暗处渲染：concealed 兑现不留痕——父 done 属账照写，编年抑制（子达成是暗处的成果，不上桌）
                    if (a.visibility !== 'concealed') {
                        chronicle.push({
                            id: `ch_${tick}_ful_${a.id}`,
                            tick,
                            text: `兑现：${entityName(world, parent.owner)} 收「${a.goal}」之果`,
                        });
                    }
                }
            }
        }
    }
    return closedIds;
}

// K20 档案摘要化（因果链细案 §3.3 → A-3）：闭环满热窗且无未决下游的事件，按出生 tick 段压成里程碑。
// 里程碑 = 引擎结构摘要（T3-D1 拍板：确定性、零调用、链上节点）：span/counts/titles/ids 全量保真（"任取归档事件可回溯"），
// 段外指针重指里程碑（links.up/down 修复——割断的是热池文本，不是链条）；里程碑不进动态流不进模型输入（温层）。
// 历史闭环（无 closedAt）视为可直接归档——旧账优先清。
function archiveClosedEvents(world, tick) {
    const { hotWindow, milestoneEvery } = ARCHIVE;
    const bySeg = new Map();
    for (const ev of world.events) {
        if (!ev.closed) continue;
        if (ev.closedAt != null && tick - ev.closedAt < hotWindow) continue;
        if (hasPendingDownstream(world, ev)) continue;   // 整链结清才归档（指针跨段不悬）
        const born = bornTickOf(ev);
        const seg = Math.floor((born - 1) / milestoneEvery);   // 出生段：t1-10 段 0，t11-20 段 1，…
        if (!bySeg.has(seg)) bySeg.set(seg, []);
        bySeg.get(seg).push(ev);
    }
    if (!bySeg.size) return;
    const segMax = Math.max(...bySeg.keys());
    for (let seg = 0; seg <= segMax; seg++) {
        const segEvs = bySeg.get(seg);
        if (!segEvs?.length) continue;
        const id = `m_${(seg + 1) * milestoneEvery}`;
        const existing = (world.milestones || []).find((m) => m.id === id);
        const m = existing || {
            id,
            span: { from: seg * milestoneEvery + 1, to: (seg + 1) * milestoneEvery },
            counts: { events: 0 },
            titles: [],
            ids: [],
            links: { up: [], down: [] },
        };
        for (const ev of segEvs) {
            m.counts.events += 1;
            m.titles.push(ev.title);
            m.ids.push(ev.id);
            for (const upId of ev.links?.up || []) {
                if (bornTickOf({ id: upId }) > -Infinity && Math.floor((bornTickOf({ id: upId }) - 1) / milestoneEvery) === seg) continue;   // 段内引用不进 up
                if (!m.links.up.includes(upId)) m.links.up.push(upId);
            }
        }
        world.events = world.events.filter((e) => !m.ids.includes(e.id));
        // 段外遗留节点（事件/里程碑）up 指针重指里程碑（引用修复——链条不断）
        for (const ev of world.events) {
            for (let i = 0; i < (ev.links?.up || []).length; i++) {
                if (m.ids.includes(ev.links.up[i])) {
                    ev.links.up[i] = m.id;
                    if (!m.links.down.includes(ev.id)) m.links.down.push(ev.id);
                }
            }
        }
        for (const om of world.milestones || []) {
            if (om === m) continue;
            for (let i = 0; i < (om.links?.up || []).length; i++) {
                if (m.ids.includes(om.links.up[i])) {
                    om.links.up[i] = m.id;
                    if (!m.links.down.includes(om.id)) m.links.down.push(om.id);
                }
            }
        }
        if (!existing) (world.milestones = world.milestones || []).push(m);
    }
}

// ⑦ 编年：事件条目（可读、带因果；实体 id 一律渲染成名——"棋好看"）
function chronicleEvents(world, step, tick, chronicle) {
    const name = (id) => world.entities.find((e) => e.id === id)?.name || id;
    step.newEvents.forEach((ev, i) => {
        const label = SOURCE_LABEL[ev.source.type] || ev.source.type;
        const link = ev.source.type === 'ripple' ? `（上承 ${ev.source.ref}）` : '';
        const ripples = ev.ripples?.length ? `，波及 ${ev.ripples.map(name).join('、')}` : '';
        chronicle.push({
            id: `ch_${tick}_ev_${i + 1}`,
            tick,
            text: `事件「${ev.title}」——源：${label}${link}，发生在 ${ev.position}${ripples}`,
            eventRef: `ev_${tick}_${i + 1}`,
        });
    });
}

// ⑧ GC/度量（切片版）：simLog 记账（长跑细案 §2.5 四字段；K2 起含门控审计；K9 起含 playerAffected 影响审计）
function recordMetrics(world, tick, packTokens, calls, warnings, chronicle, gate, playerAffected = []) {
    world.meta.simLog = world.meta.simLog || [];
    const entry = {
        tick,
        packTokens,
        ssotBytes: JSON.stringify(world).length,
        events: world.events.length,
        chronicle: chronicle.length,
        calls,
        warnings: [...warnings],
    };
    if (gate) {
        entry.silent = [...gate.silent];
        entry.lifted = [...gate.lifted];
        entry.silentDropped = { ...gate.droppedCounts };
    }
    if (playerAffected.length) entry.playerAffected = [...playerAffected];
    world.meta.simLog.push(entry);
}

export function settleTick({ ssot, step, moveFact, calls = 1 }) {
    // 校验先行：不合格则世界如实不动（诚实不落账），tick 不推进
    const pre = checkWorldStep(step, ssot);
    if (!pre.ok) {
        return { ok: false, ssot, stage: { warnings: pre.errors.map((e) => `校验拒绝: ${e}`), chronicle: [] } };
    }

    const world = structuredClone(ssot);
    const warnings = [];
    const chronicle = [];
    const tick = world.meta.tick + 1;
    world.meta.tick = tick;
    const playerId = world.context?.playerId ?? null;   // K8/K9：玩家棋子标注（红线 1 代码化就位）
    const playerAffected = [];                          // K9：影响通道审计

    // ②' 主动作权门控（K2，细案 §3.2）：校验之后、裁定之前。滤除静默方主动作——不落账、不编年、不注入（双面无痕）；被点名可应答。
    const gate = gateWorldStep(step, ssot, moveFact);
    const gstep = gate.step;
    // K14 出生裁判（盘算树细案 §3.2 落点：gate 之后、裁定之前）：GC 上限 → 落账 → 挂因/委派留痕 → 环检测自动拆
    const spawned = spawnAgendas(world, gstep, tick, warnings, chronicle);

    const hurtByEntity = {};
    if (!adjudicate(world, gstep, tick, warnings, gate, hurtByEntity)) {
        // 不可达（check 已过），防御
        return { ok: false, ssot, stage: { warnings, chronicle } };
    }
    // K15 三态判据窗口（细案 §3.4）：实体粒度近 2 tick 负向 δ（stateChanges 实际生效值）；
    // 窗口 [本 tick, 上一 tick]；惰性写——全 0 删字段（旧夹具/黄金锚点零扰动）。
    for (const e of world.entities) {
        const cur = hurtByEntity[e.id] ?? 0;
        if (cur !== 0 || e.hurtWindow) {
            const next = [cur, e.hurtWindow?.[0] ?? 0];
            if (next[0] === 0 && next[1] === 0) delete e.hurtWindow;
            else e.hurtWindow = next;
        }
    }
    // K19 事件产率上限（因果链细案 §3.2 → A-2）：按提议序保留前 ≤N，超限拒建 + 警告（"事件洪峰"——与盘算大厦顶
    // 同哲学：双面无痕于世界，留痕于 simLog）；门控后、影响通道前——被拒不涉影响/挂链/编年
    if (gstep.newEvents.length > EVENT_CAPS.perTick) {
        const kept = gstep.newEvents.slice(0, EVENT_CAPS.perTick);
        for (const ev of gstep.newEvents.slice(EVENT_CAPS.perTick)) {
            warnings.push(`裁定: 事件洪峰（每 tick ≤${EVENT_CAPS.perTick}）：「${ev.title}」被拒`);
        }
        gstep.newEvents = kept;
    }
    const events = hangEvents(world, gstep, tick);
    // K9 影响通道：引擎独占写玩家（他人 targeting / 新事件波及 → 分量比影响，落账在重算前——分量当轮反映）
    if (playerId) applyPlayerImpact(world, gstep, tick, playerId, playerAffected, warnings);
    checkConsistency(world, gstep, warnings);
    // K3 活跃记账：落账主动作方（actions/盘算推进/plot 事件属主）记 lastActiveTick；被打击/被波及的客体不计
    // K11 玩家同尺：有落子轮（moveFact.verb 非空）= active；OOC/静默轮不记 → 站桩权力照萎缩（长跑 §2.3）
    const agendaOwner = new Map((world.agendas || []).map((a) => [a.id, a.owner]));
    const activeIds = new Set();
    for (const a of gstep.actions) activeIds.add(a.entity);
    for (const ad of gstep.agendaAdvances) { const o = agendaOwner.get(ad.agendaId); if (o) activeIds.add(o); }
    for (const ev of gstep.newEvents) { if (ev.source?.type === 'plot') { const o = agendaOwner.get(ev.source.ref); if (o) activeIds.add(o); } }
    for (const na of spawned) activeIds.add(na.owner);   // K14：提议并落账 = 活跃（与 gate 滤除语义对称——静默方提议被滤=不活跃）
    if (playerId && moveFact?.verb) activeIds.add(playerId);
    for (const e of world.entities) { if (activeIds.has(e.id)) e.lastActiveTick = tick; }
    recomputeWeights(world, tick);
    const cancelledIds = applyAgendaCancels(world, gstep, tick, chronicle);   // K22 取消裁决（细案 §3.5 → A-5；先于推进——被取消者当 tick 推进落 closed 拦截）
    const closedIds = applyAgendaAdvances(world, gstep, tick, chronicle, warnings);
    for (const id of cancelledIds) closedIds.add(id);   // 取消集并入联闭（取消 = 终结产果路径之一）
    closeEvents(world, closedIds, tick, chronicle);   // 闭环三型：源结清（K9 执行债）+ 链尾结清（K19）+ 取消联闭（K22）
    chronicleEvents(world, gstep, tick, chronicle);
    world.chronicle = [...world.chronicle, ...chronicle];   // 编年落账（推进留痕 + 事件条目）
    archiveClosedEvents(world, tick);   // K20 档案摘要化（细案 §3.3 → A-3）：闭环满热窗 + 整链结清 → 里程碑温层（零编年零注入）

    const pack = buildEvolutionPack(world, moveFact || null);
    recordMetrics(world, tick, pack.estTokens, calls, warnings, chronicle, gate, playerAffected);

    return { ok: true, ssot: world, stage: { chronicle, warnings, events } };
}