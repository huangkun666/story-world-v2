// story-world-v2/src/tick.js
// 完整 tick 编排（S6）：对话 → 落子提取 → 演化上下文 → 主调用（真 schema）→ 结算 → 双流。
// 这就是"最小活棋盘跑通一次完整 tick"的入口。
import { extractMove } from './extract.js';
import { extractTags, hasTagFacts, tagReadoutLine } from './tag-extract.js';
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
/**
 * ★★★leg90：**③段「世界动向」的人话渲染器**（纯函数，从`事件对象本体`取事实、不解析文本）。
 *
 * 用户两句原话定的形状：
 *   ①「**这注入的是啥，直观吗？？？**」⇒ 只收**带 `eventRef` 的编年行**（照 `streams.js:71` 既有口径：
 *      只有因果链上的节点算世界动向；记账行/规矩行/氛围行不进正文）；
 *   ②「**换成大白话**」⇒ 不搬编年那句账本腔，而是拿 `ssot.events` 按 `eventRef` 对上事件，
 *      用叙事模型看得懂的话重述。
 *
 * ★为什么不直接搬 `c.text`（两条都是实测出来的理由）：
 *   · `c.text` 里写着 `盘算「…」` —— `盘算` 是**我们内部的词**（世界步的 `agendas`），
 *     聊天模型没有这个概念，读到只会照抄进正文；
 *   · `c.text` 是**面板链视图**的措辞（`settle.js:647` `eventSourcePhrase`，用户拍板"棋好看"那一版），
 *     它的读者是**看面板的人**，不是写正文的模型。两个读者 ⇒ 两套措辞，**不是两套事实**。
 *
 * ★只讲事件**真有**的字段（`id/title/source/position/ripples` 五样）——
 *   引擎**不替模型补事实**（红线）：没有的就不说，绝不编"接引的是谁"。
 *
 * @param {object} ssot 世界账（取 `events` 对 id）
 * @param {Array} chronicle 这一轮结算产生的编年（`stage.chronicle`）
 * @returns {string[]} 每行一句人话（`◆ [第N轮] …`）；没有世界动向 ⇒ 空数组
 */
export function tideLines(ssot, chronicle) {
    const rows = (chronicle || []).filter((c) => c.eventRef);
    if (!rows.length) return [];
    const byId = new Map((ssot?.events || []).map((e) => [e.id, e]));
    const nameOf = (id) => (ssot?.entities || []).find((e) => e.id === id)?.name || null;
    return rows.map((c) => {
        const ev = byId.get(c.eventRef);
        // 事件对象取不到（旧账归档/里程碑吸收）⇒ 退回编年原文，**不许编**
        if (!ev) return `◆ [第${c.tick}轮] ${c.text}`;
        // 因果：说"因为什么"而不是"由某源型而生"
        const src = ev.source || {};
        const up = byId.get(src.ref);
        const plotAgenda = src.type === 'plot'
            ? (ssot?.agendas || []).find((x) => x.id === src.ref) : null;
        const why = src.type === 'plot'
            ? (plotAgenda ? `因「${plotAgenda.goal}」而起` : '因有人在办的事而起')
            : src.type === 'ripple'
                ? (up ? `接着「${up.title}」发生` : '接着先前那件事发生')
                : src.type === 'seed' ? '起自书里写着的旧事' : '由眼下局势而起';
        const where = ev.position && ev.position !== '未明' ? `，发生在${ev.position}` : '';
        const hit = (ev.ripples || []).map(nameOf).filter(Boolean);
        const who = hit.length ? `，波及${hit.join('、')}` : '';
        return `◆ [第${c.tick}轮] ${ev.title}（${why}${where}${who}）`;
    });
}

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

export async function runTick({ transport, ssot, dialogue, extractCtx, calls = 1, preStep = null, onPreStep = null, recallStore = undefined, recall = true, tagMaxActions = undefined }) {
    // ★★两条提取路并存，**互不影响**（口径不同、消费面不同）：
    //   ① `extractMove(dialogue, extractCtx)` = **老口径**：读"玩家自己打的那句话"，靠 13 条动词词表归一。
    //      ★生产上恒 null（`extractCtx: {}` 是接线占位）——**保留不动**：那是被用户否掉的方向的留档，
    //        撤它要单独一笔，且它现在还担着"没有标签时 playerMove 从哪来"这一格。
    //   ② `extractTags(dialogue, …)` = **新口径**（leg89）：读**聊天模型产出的正文**里的标签，
    //      抽"各角色（含主角）这一轮已经做了什么、在哪、过了多久"。见 `src/tag-extract.js` 头注。
    const move0 = extractMove(dialogue || '', extractCtx || {});
    const tagFacts = extractTags(dialogue || '', {
        entities: ssot?.entities || [],
        // ★★★leg89（用户拍板「模型认得出那就直接按照插件的正名来看」）：**别名从书里取**——
        //   账上实体**不带别名**（播种时只拷 id/kind/name/location/parent/实力…，别名留在书名录里）。
        //   不传这一格 ⇒ 别名那一档是死的（模型写"小娥"就归不上）。★路径由抽书那一族写死
        //   （`abstract.js` 把名册与别名落在这里），此处只读、不改。
        canon: ssot?.context?.setting?.frozen?.canon?.bookEntities || [],
        locations: ssot?.context?.positions || [],
        playerId: ssot?.context?.playerId || null,
        maxActions: tagMaxActions,
    });
    // ★主角槽（承重墙）：标签里主角那一条走 `playerMove`，**绝不进 turnFacts.actions**。
    //   为什么与老口径不冲突：l91 那类老用例的正文（玩家的话）里没有标签 ⇒ `tagFacts.player` 为 null
    //   ⇒ 走原样那条路，既有判据逐字节不变（`worldstep.test.js:208` 那条锁的就是它）。
    const move = tagFacts.player
        ? { verb: tagFacts.player.verb, object: tagFacts.player.targetText, location: tagFacts.player.location, attempt: true, note: null, dropped: [], source: 'tag' }
        : move0;
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
    // ★★leg89 更正：判据从 `move.verb ? move : null` 改成"**末条事实在 ⇒ 就在**"。
    //   旧判据的尺子是"老口径的词表命中"——而标签口径下**没有词表**：动词可以空着
    //   （模型只写了两格"某人｜做了一件事"），但那仍是**已经发生的事实**，不该被丢掉。
    //   为什么这次放宽是安全的：`streams.js` 与 `settle.js` 都拿 `moveFact.verb` 当真值判
    //   （空 ⇒ 不印行迹、不记玩家活跃）⇒ 空动词那条事实**照样进不了注入行**，行为不变。
    const lastFact = tagFacts.actions.length ? tagFacts.actions[tagFacts.actions.length - 1] : null;
    const moveFact = move.verb
        ? move
        : (lastFact
            ? { verb: lastFact.verb, object: lastFact.targetText, location: lastFact.location, attempt: true, note: null, dropped: [], source: 'tag' }
            : null);
    // ★注入包只带"有料的那部分"（照 `recalled` 口径）：没抽到东西 ⇒ 键不出现。
    //   ★写法纪律：**不用"条件展开"那种简写**（`{...cond ? {a} : {}}` 不是合法 JS——
    //     leg89 当场被解析器咬住："Unexpected identifier"）。这里显式建对象、逐键按条件 add。
    let turnFacts = null;
    if (hasTagFacts(tagFacts)) {
        turnFacts = {
            actions: tagFacts.actions,
            count: tagFacts.count,
            parsed: tagFacts.parsed,
        };
        if (tagFacts.elapsed) turnFacts.elapsed = tagFacts.elapsed;
        if (tagFacts.unresolved.length) turnFacts.unresolved = tagFacts.unresolved;
        // ★★★leg89 更正（用户：「就算不在名册上也给插件模型看到啊？？为啥要丢掉呢」）：
        //   不在名册上的人**这一轮做过的事**也要进包——不进账，但必须让世界模型看见
        //   （否则"这个人该不该入局"永远没证据：旧做法把这些行动整个丢掉）。
        if (tagFacts.notNoted.length) turnFacts.notNoted = tagFacts.notNoted;
        if (tagFacts.player) {
            turnFacts.player = {
                verb: tagFacts.player.verb,
                object: tagFacts.player.targetText,
                location: tagFacts.player.location,
            };
        }        if (tagFacts.playerDropped) turnFacts.playerDropped = tagFacts.playerDropped;
        if (tagFacts.malformed.length) turnFacts.malformed = tagFacts.malformed;
    }
    const pack = buildEvolutionPack(world, moveFact, { picks, lim: resolveLimits(world), turnFacts });
    // ★自证面（标签读数）：**随返回值交给调用方**，**不写账、不动 stage.warnings**。两条理由：
    //   ① 它是"这一轮正文长什么样"的**会话级读数**，不是世界状态——写进热账会让"这一轮"冒充"账上事实"
    //      （leg34 那次"过期检索冒充新检索"的同款坑的另一面）；
    //   ② `stage.warnings` 带**裁定语义**（`settleWithHealing` 数着它判"这一轮是不是降级路径"、
    //      `test/deadlock-heal.test.js` 锁着）⇒ 塞一行普通读数进去会让"降级路径"误报（leg89 实测过：
    //      "世界安静一步"那条用例当场红）。⇒ 只在返回值里给，编排层（`web/index.js`）自己留着报。
    const readout = tagReadoutLine(tagFacts);
    const main = await runMainCall({ transport, ssot: world, pack });
    if (!main.ok) {
        return { ok: false, error: main.errors.join('; '), move, pack, streams: null, tagFacts, tagReadout: readout };
    }
    // ★leg40b 续：结算走**带自愈的**那条（①原样 → ②降级重试 → ③世界安静一步，见 `settleWithHealing` 头注）。
    //   这次改动治的是"一条提议写歪 ⇒ 整步被拒 ⇒ tick 不动 ⇒ 下一轮又一样 ⇒ 世界永久停摆"。
    const s = settleWithHealing({ ssot: world, step: main.step, moveFact: move, calls });
    if (!s.ok) {
        return { ok: false, error: `结算拒绝: ${JSON.stringify(s.stage.warnings)}`, move, pack, streams: null, tagFacts, tagReadout: readout };
    }
    const streams = renderStreams(s.ssot, s.stage, move);
    // ★★★leg89 补（用户：「把这一轮世界发生了什么注入上下文啊」）：
    //   **把"这一轮世界发生了什么"存下来，供下一轮注入聊天上下文**。
    //   ★时差是设计（账按轮走）：这一轮的编年是**刚结算完**才有的（`renderStreams` 的产物），
    //     而聊天模型下一轮才生成 ⇒ 注入的必然是"上一轮结算出来的这一轮"。这一点要在界面上说明白。
    //   ★取**编年条目**（谁做了什么、带着因果），不是整段 `observer`：
    //     `observer` 还含「📍 各归何处」（几百人的位置聚合）与「▣ 当前格局」——那是世界模型那一侧的读数，
    //     塞进聊天上下文只会把正文灌爆（本仓 leg31 量过：实体段一项就吃整包 96.8%）。
    //   ★★★leg90 修（用户实机第二次骂）：「这注入的是啥，直观吗？？？」——
    //     第一版（leg89）把**整条编年**拼进去，而编年里混着**引擎记账行**：
    //     「由处境而生：X 生「Y」」/「盘算「X」推进：…」/「盘算「X」满步结算：结清（期满收摊，终结产果 §4.4④）」
    //     /「事件「X」闭环（源盘算已结算）」——那是给**面板链视图**看的账，塞进聊天正文＝给叙事模型看账本。
    //     ★判据早就在本仓写好了：`src/streams.js:71` 从 leg25 起就只把**带 `eventRef`** 的编年行当"世界动向"
    //     （注释原文：「只有带 `eventRef` 的编年行算"世界动向"——那是**因果链上的节点**，有据可查；
    //     没有 eventRef 的行（规矩行/氛围行）不进注入」）。⇒ 这里照同一条口径过滤，**不另立一套**。
    //   ★★★leg90 续（用户第三句）：「换成大白话」——过滤只解决了"该不该进"，
    //     剩下那两行仍是**世界模型说的行话**：「事件「X」——由盘算「Y」而生，事发 Z，牵动 W」。
    //     `盘算` 是我们内部的词，聊天模型没有这个概念；`牵动`/`事发` 也是账本腔。
    //     ⇒ 改走 `tideLines()`：**从事件对象本体取事实**（`ssot.events` 按 eventRef 对上），
    //     用人话重述（因…而起 / 接着…发生 / 眼下局势 / 发生在… / 波及…）。
    const tide = tideLines(s.ssot, s.stage?.chronicle).join('；');
    if (tide) s.ssot.meta.lastInjection = tide;
    else delete s.ssot.meta.lastInjection;   // ★没有新发生的事就清掉（不许上一轮的冒充本轮）
    return { ok: true, ssot: s.ssot, stage: s.stage, streams, move, pack, picks, healed: s.healed, tagFacts, tagReadout: readout };
}