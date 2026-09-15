// story-world-v2/src/tick.js
// 完整 tick 编排（S6）：对话 → 落子提取 → 演化上下文 → 主调用（真 schema）→ 结算 → 双流。
// 这就是"最小活棋盘跑通一次完整 tick"的入口。
import { extractMove } from './extract.js';
import { buildEvolutionPack } from './pack.js';
import { runMainCall } from './worldstep.js';
import { settleTick } from './settle.js';
import { checkWorldStep } from './check-step.js';
import { dropInvalidProposals } from './sanitize-step.js';
import { resolveLimits } from './limits.js';
import { renderStreams } from './streams.js';
import { recallWorldBook, recallTextOf, noteRecall } from './recall.js';

/**
 * ★leg34：**世界书检索注入**——出包之前检索，命中的原文随包**当轮**递给模型。
 *   为什么必须在这个位置：与既有前置步同一条理由（细案 spec-entity-field-lookup §3 写死的："必须在
 *   buildEvolutionPack 之前跑——否则这一轮主调用看不到刚查回来的字段"）。ST 的关键词世界书与
 *   `yuzuki-Memory` 的向量召回也都是**组装提示词那一刻**把书塞进去的 ⇒ 一轮可见、零额外调用、零跨轮状态。
 *   ★失败零阻塞：检索器没装/没开/抛错 ⇒ 照常出包（`recallWorldBook` 自己折成空结果，永不抛）。
 */
// ★★leg40b 续·**死锁修复（丙）**：让"一步被拒"再也换不来"世界永久停摆"。
//
// 病灶（交接 §4.2）：整步校验是**全有或全无**——一条提议写歪 ⇒ 整步退回 ⇒ **tick 不推进**；
//   下一轮读回同一份账、递同一个包 ⇒ 模型很可能又写歪 ⇒ 永远推不动（四个臂里 wide 撞到过连续两轮）。
//
// 三层收尾（用户拍板"降级重试 + 最后一步照常前进"）：
//   ① **原样先试**——绝不动模型写对的东西（绝大多数轮走这一层，行为与修复前逐字节相同）。
//   ② **降级重试**：走 `dropInvalidProposals` 把"注定过不了校验"的那几条丢掉，再校验一次；
//      过了就落账，并把"丢了哪几条、为什么"如实挂在 `stage.warnings`。
//   ③ **世界安静一步**：净化后仍不合法（例如 newEvents 缺 position 这类只有模型能补的毛病，
//      或整轮根本没写对）⇒ 用**空步**照常推进一轮：tick 前进、账上不落任何提议、
//      并写明"上一轮为什么被拒 + 世界照常往前走，没有停摆"。
//   ★为什么③不能省：不省则②之后仍可能停摆（这正是本轮要根治的那件事）。
//   ★③不是"静默吞掉"：拒因与丢弃清单全部进 `stage.warnings` ⇒ 面板裁定条看得见、`simLog` 落账可查。
//
// 口径边界（写死防将来改歪）：**只丢提议，不改写提议**。净化器做减法（丢/摘），
//   引擎**不替模型编内容**（编事实是另一条红线，见 ANCHOR）。
export function settleWithHealing({ ssot, step, moveFact = null, calls = 1, selfHeal = true }) {
    // ① 原样（模型写对时，这一层的开销是一次校验，行为零变化）
    const first = settleTick({ ssot, step, moveFact, calls });
    if (first.ok) return { ...first, healed: { used: false, dropped: [], warnings: first.stage.warnings, errors: [] } };

    const rawErrors = (first.stage.warnings || []).map(String);
    if (!selfHeal) return { ...first, healed: { used: false, dropped: [], warnings: first.stage.warnings, errors: rawErrors } };

    // ② 降级重试：丢掉写歪的那几条，再校验一次（同轮引用由 `findEvent` 按位次解析，无需再传 id 名单）
    const { step: clean, dropped } = dropInvalidProposals(step, ssot);
    const pre = checkWorldStep(clean, ssot);
    if (pre.ok) {
        const back = dropped.map(reasonOf);
        const second = settleTick({ ssot, step: clean, moveFact, calls, preWarnings: back });
        if (second.ok) {
            return {
                ...second,
                healed: {
                    used: true, fallback: false, dropped,
                    warnings: [...back, ...(second.stage.warnings || [])], errors: rawErrors,
                },
            };
        }
        // 理论上到不了（pre.ok 已过 ⇒ settleTick 的校验同一把尺子）；真到了就如实往下走 ③
        rawErrors.push(...(second.stage.warnings || []).map(String));
    }

    // ③ 世界安静一步（最后一步：保证"卡轮"不再等于"永久停摆"）
    const quiet = settleTick({
        ssot,
        step: emptyStep(),
        moveFact,
        calls,
        preWarnings: [
            `裁定: 本轮提议全部未落账（${rawErrors.slice(0, 3).join('；')}${rawErrors.length > 3 ? ` 等 ${rawErrors.length} 条` : ''}）`,
            '本轮按「世界安静一步」照常前进：你的这一步没有被写进世界，世界自己往前走了一轮——不会停在这里等你重试',
        ],
    });
    if (quiet.ok) {
        return {
            ...quiet,
            healed: {
                used: true, fallback: true, dropped,
                warnings: quiet.stage.warnings || [], errors: rawErrors,
            },
        };
    }
    // 连空步都过不了 = 引擎自己坏了（不是模型的问题）⇒ 如实抛给上层，不掩盖
    return { ...quiet, healed: { used: true, fallback: true, dropped, warnings: quiet.stage.warnings || [], errors: rawErrors } };
}

/** 引擎最外层要求的八个组（`entityUpdates` 缺席合法，但**在场更稳**：它进来时校验面一致）。 */
export function emptyStep() {
    return { actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [], entityUpdates: [] };
}

/** "丢了什么"的落痕文案（玩家可见面用 `裁定:` 前缀 —— 与既有的裁定/丢弃口径一致，计入拒签分子）。 */
function reasonOf(d) {
    const who = d.label ? `「${d.label}」` : `${d.family}[${d.index}]`;
    if (d.family === 'newEvents' && d.index === -1) return `提议丢弃: ${who} ${d.reason}`;
    return `提议丢弃: ${who} ${d.reason}`;
}

/**
 * ★leg34：**世界书检索注入**——出包之前检索，命中的原文随包**当轮**递给模型。
 *   为什么必须在这个位置：与既有前置步同一条理由（细案 spec-entity-field-lookup §3 写死的："必须在
 *   buildEvolutionPack 之前跑——否则这一轮主调用看不到刚查回来的字段"）。ST 的关键词世界书与
 *   `yuzuki-Memory` 的向量召回也都是**组装提示词那一刻**把书塞进去的 ⇒ 一轮可见、零额外调用、零跨轮状态。
 *   ★失败零阻塞：检索器没装/没开/抛错 ⇒ 照常出包（`recallWorldBook` 自己折成空结果，永不抛）。
 */
export async function injectWorldBookRecall({ ssot, picks = null, store = undefined } = {}) {
    const world = ssot;
    if (!world?.meta) return null;
    // ★★**先清上一轮的**（本棒自查抓出的真漏洞）：原来那版在"检索器不可用"时提前 return ⇒ 跳过清空
    //   ⇒ 上一轮的书片段一直挂在账上，往后每轮都当"本轮检索结果"注入（**过期内容冒充新检索**）。
    //   ⇒ 口径：**注入文本每轮都从头决定**——只有"本轮真命中"才写，其余一律清空（含没检索器/没命中/抛错）。
    //   （这正是我刚撤掉的那套"跨轮存待办"最容易犯的错；换成正路之后，同一类坑还得自己防。）
    delete world.meta.recalledText;
    const res = await recallWorldBook({ ssot: world, picks, store });
    // ★没检索器（Node 侧、或没装向量书）⇒ **一个字节都不写**：
    //   "这环境没有检索器"是**环境事实**、不是"世界这一轮检索失败了"，写进账只是噪声（而且会让逐字节基线抖动）。
    //   真装好了但这一轮没命中 ⇒ 才记（那时 `reason` 是"检索无命中"这类**关于世界的信息**）。
    if (!res.ok && /检索器不可用/.test(res.reason || '')) return res;
    noteRecall(world, res);                                       // 自证面读数（不囤正文）
    if (res.chunks.length) world.meta.recalledText = recallTextOf(res.chunks);
    return res;
}

export async function runTick({ transport, ssot, dialogue, extractCtx, calls = 1, preStep = null, onPreStep = null, recallStore = undefined, recall = true }) {
    const move = extractMove(dialogue || '', extractCtx || {});
    // 细案 spec-entity-field-lookup §3：**前置步**（① LLM 选本轮上场实体 → ② 只对缺字段者查书 →
    //   ③ 引擎回写查书标记）必须在 buildEvolutionPack 之前跑——否则这一轮主调用看不到刚查回来的字段。
    //   失败零阻塞：preStep 抛错/失败一律继续（世界推进优先，字段是附加信息）。
    let world = ssot;
    let picks = null;
    if (typeof preStep === 'function') {
        try {
            const pre = await preStep({ ssot: world, move });
            if (pre?.ssot) world = pre.ssot;
            picks = pre?.picks || null;
            if (typeof onPreStep === 'function') await onPreStep(pre);   // 编排层落盘点（防 Ctrl+F5 重查）
        } catch (err) {
            picks = null;   // 前置步失败 → 退回引擎镜头（旧路径零扰动）
        }
    }
    // ★leg34：检索注入（在出包之前；失败不阻塞——见 injectWorldBookRecall 注释）。
    //   `recall:false` 留给不需要它的调用方（如纯结构冒烟），零扰动。
    if (recall) {
        try { await injectWorldBookRecall({ ssot: world, picks, store: recallStore }); }
        catch (err) { console.warn('[story-world-v2] 世界书检索注入失败（不影响世界推进）:', err?.message || err); }
    }
    // 未提取落子（OOC/无可提取动作）不拦 tick：世界以自身状态为原料，照常结算（§3②）；
    // moveFact 为空则注入无行迹行。诚实未提取由调用方/度量记录。
    const pack = buildEvolutionPack(world, move.verb ? move : null, { picks, lim: resolveLimits(world) });
    const main = await runMainCall({ transport, ssot: world, pack });
    if (!main.ok) {
        return { ok: false, error: main.errors.join('; '), move, pack, streams: null };
    }
    // ★leg40b 续：结算走**带自愈的**那条（①原样 → ②降级重试 → ③世界安静一步，见 `settleWithHealing` 头注）。
    //   这次改动治的是"一条提议写歪 ⇒ 整步被拒 ⇒ tick 不动 ⇒ 下一轮又一样 ⇒ 世界永久停摆"。
    const s = settleWithHealing({ ssot: world, step: main.step, moveFact: move, calls });
    if (!s.ok) {
        return { ok: false, error: `结算拒绝: ${JSON.stringify(s.stage.warnings)}`, move, pack, streams: null };
    }
    const streams = renderStreams(s.ssot, s.stage, move);
    return { ok: true, ssot: s.ssot, stage: s.stage, streams, move, pack, picks, healed: s.healed };
}