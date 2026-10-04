// story-world-v2/src/tick.js
// 完整 tick 编排（S6）：对话 → 落子提取 → 演化上下文 → 主调用（真 schema）→ 结算 → 双流。
// 这就是"最小活棋盘跑通一次完整 tick"的入口。
import { extractMove } from './extract.js';
import { extractTags, hasTagFacts, tagReadoutLine } from './tag-extract.js';
import { buildEvolutionPack, lineRootsOfPack, recordShownLines, windowFromTick, RECENT_WINDOW_TURNS } from './pack.js';
import { runMainCall } from './worldstep.js';
import { settleTick, registerDialogueFacts } from './settle.js';
import { checkWorldStep } from './check-step.js';
import { dropInvalidProposals } from './sanitize-step.js';
import { resolveLimits } from './limits.js';
import { renderStreams } from './streams.js';
// ★leg122：`import { recallWorldBook, recallTextOf, noteRecall } from './recall.js';` **已撤**
//   （检索注入那条线拔了；`src/recall.js` 模块本身留着留档——见下面 `runTick` 前那一大段）。
//   ★顺手清掉一处**孤儿注释**：这里原本还挂着一份 `injectWorldBookRecall` 的旧文档注释
//     （与函数前面那份重复，函数搬走时留下的），它现在描述的是一个已经不存在的机制。

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

/**
 * ★★★leg115：给**本轮新落的**编年行盖上"此后又过了多久"。
 *
 * 用户原话（本笔的靶子）：「**聊天llm是不知道什么时候世界发生了什么事懂吗？**」
 * 病：账上 `simLog` **零时间字段**，往事只带「第 N 轮」= 引擎轮次；而时长是正文里【时长】写的、
 *   属**账外的料**（`pack.js:1014`：「引擎一个字都不解析它」）⇒ 写正文的人自己写的时长，下一轮没地方找。
 *
 * 口径（三条，每条都有出处）：
 *   ① **只收集原话，不做算术**——绝不把「三天」累加成"第 N 天"。
 *      依据 `STATE.md` §2.2 第 1 条（不许把书里的词换算成数）同源：时间也归这条管，累加就编出账上没有的数。
 *   ② **只盖新行**（`fromIndex` 之后的），不回头改旧行——旧行没有那一格就是"当时没写"，不许补。
 *   ③ 没有时长 ⇒ **不盖**，不许填占位值（红线 2：空着就是空着）。
 *
 * 纯函数、就地改 `ssot.chronicle` 的新行（与 `settle.js` 落编年同一层）；**不 import 任何东西**。
 *
 * @param {object} ssot 世界账（结算后的那一份）
 * @param {number} fromIndex 结算前编年有几行（= 本轮新行的起点）
 * @param {string} elapsed 当轮时长原话（`tagFacts.elapsed`，如「三天」「一炷香」；可空）
 * @returns {number} 实际盖了几行
 */
export function stampChronicleTime(ssot, fromIndex, elapsed) {
    const t = String(elapsed ?? '').trim();
    if (!t) return 0;                                    // 没写时长 ⇒ 不盖（口径③）
    const rows = Array.isArray(ssot?.chronicle) ? ssot.chronicle : null;
    if (!rows) return 0;
    const from = Number.isFinite(fromIndex) ? Math.max(0, fromIndex) : 0;
    let n = 0;
    for (let i = from; i < rows.length; i += 1) {
        const row = rows[i];
        if (!row || typeof row !== 'object') continue;
        if (row.elapsed) continue;                       // 已经有印记的不覆盖（口径②）
        row.elapsed = t;
        n += 1;
    }
    return n;
}

// ★★leg40b 续·**死锁修复（丙）**：让"一步被拒"再也换不来"世界永久停摆"。
//
// 病灶（交接 §4.2）：整步校验是**全有或全无**——一条提议写歪 ⇒ 整步退回 ⇒ **tick 不推进**；
//   下一轮读回同一份账、递同一个包 ⇒ 模型很可能又写歪 ⇒ 永远推不动（四个臂里 wide 撞到过连续两轮）。
//
// leg187：用户要求修复首轮空转却增加轮数，取消非法提议的空步成功兜底。
// 当前收尾：
//   ① **原样先试**——绝不动模型写对的东西（绝大多数轮走这一层，行为与修复前逐字节相同）。
//   ② **降级重试**：走 `dropInvalidProposals` 把"注定过不了校验"的那几条丢掉，再校验一次；
//      过了就落账，并把"丢了哪几条、为什么"如实挂在 `stage.warnings`。
//   ③ 净化后全空或仍不能结算 ⇒ 失败、原账不动、轮数不增加，拒因经回执进调试台。
//   合法安静步骤仍走①；失败的模型输出不能冒充它。重试仍在同一轮。
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
    const hasProposals = Object.values(clean).some(value => Array.isArray(value) && value.length > 0);
    if (pre.ok && hasProposals) {
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

    // 非法输出不能用空步替代后计作成功。全被丢弃或仍不合法就保留原账，允许重试。
    rawErrors.push(...(pre.errors || []).map(error => `校验拒绝: ${error}`));
    const warnings = [...rawErrors, ...dropped.map(reasonOf),
        `本轮未推进：${hasProposals ? '剩余提议仍无法结算' : '没有可落账的合法提议'}（世界原样未动，可重试）`];
    return { ok: false, ssot, stage: { warnings, chronicle: [] },
        healed: { used: true, fallback: false, failed: true, dropped, warnings, errors: rawErrors } };
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

// ★★★leg122（用户令「所以才需要拆」）：**`injectWorldBookRecall` 那条线已拔**——这一格留档，别再请回来。
//   它当年是"出包之前检索世界书、命中原文随包当轮递给模型"（leg34 立、leg35/39 自验过）。
//   **拆它的两条实测理由**（leg122 在真账上量的）：
//     ① **它从来没检索到世界书**：召回那 1783 字与世界书 `大荒-姬元真.json`（30.5 万字）的
//        6/8/10-gram 覆盖率 **0.00%**（4-gram 1.18% ≈ 噪声，与 leg35 2026-09-13 的读数逐字相同）；
//        它命中的是**这份聊天自己的自动总结**（来源 `大荒z - 2026-09-01… #12/#9/#10`）。
//     ② 而"存聊天总结"**本来就是记忆插件（yuzuki-Memory）的活儿** ⇒ 我们再拉一遍是把别人的活干重了，
//        还把台头写成「**世界书**·…**逐字摘自世界书**」（`src/recall.js:127`）——**那句话是假的**。
//   ⇒ 拔掉的是**两处接线**：下面 `runTick` 里那次调用 ＋ `src/pack.js` 的 `pack.recalled` 键。
//   ★★★leg125（2026-09-25 · 用户令「**我说了解耦就解耦，直接删了**」）：当时"没拔"的那两件——
//     **`src/recall.js` 模块本身已删**（连同它那两个只读测量装置），模块数硬锁 **49 → 47**。
//     ★而 `runTick` 的 `recall` / `recallStore` 两个形参**留着**（这是有意的）：它们是判据的**诱饵面**——
//       W9f/W9g/W9i/W9j/W12d 那几条反向锁靠它们证明"注进一个**活的**检索器也不许被调、不许进提示词"。
//   ★**代价也如实登记**：拔掉之后，**世界模型这一侧再没有任何"来自正文"的输入**
//     （标签那条路是用户有意关的）⇒ 它此后**只按账自己的状态演**。这不是意外，是本棒量出来的后果。

export async function runTick({ transport, ssot, dialogue, extractCtx, calls = 1, preStep = null, onPreStep = null, recallStore = undefined, recall = true, tagMaxActions = undefined, ledgerVolumes = null, recallVec = null }) {
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
    // 前置查书可能独立保存字段，先完成它，再隔离演算副本；
    // 后续正文事实和已展示标记不许泄漏到输入账或前置保存持有的引用。
    world = structuredClone(world);
    // ★★★leg122：**检索注入那一步已拔**（原来是这里调 `injectWorldBookRecall`，见 `runTick` 前那一大段留档）。
    //   ★`recall` / `recallStore` 两个形参**留着但没人读了**——照 `extractCtx` 的先例留档，撤它们要单独一笔；
    //     调用方仍可以照旧传（`recall: false` 之类），只是**不再有任何效果**。
    //   ★本步拔掉之后，出包之前**不再有"从正文/书里取料"的动作**——世界模型这一轮拿到的东西，
    //     全部来自**账自己的状态**（包）＋ 本轮的落子提取（标签，用户有意关着）。
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
    // ★★★leg123（细案 `docs/spec-tag-granularity.md` §2.3/§2.6）：**聊天侧那一侧的落账**——
    //   把三族标签注册成 `dialogue` 型事件、并把【变化】的格落下。
    //   ★**必须在出包之前**，两个理由：① 世界模型这一轮要看得见这些既成事实（包读的是**账**）；
    //     ② 它该看到**新状态**（否则照旧样子演）。
    //   ★★同时这是"谁先谁后"那条顺序的**落点**（用户 2026-09-24：「先聊天模型给出谁行动了谁被修改了，
    //     然后世界模型就不用再模拟这些行动过的角色了」）：行动过的人与已改定的格从此都在账上，
    //     世界步那三条结构（`gate.js`/`sanitize-step.js`）就按它判。
    //   ★零扰动：三族都没料（老聊天 / 开关关着）⇒ **一个字节都不碰账**。
    const chronicleLenBefore = (world?.chronicle || []).length;   // ★leg115 的时间印记靠它认出"本轮新落的行" ⇒ **必须先于注册取**
    //   ★★tick 取 **`meta.tick + 1`**：本轮的落账轮次是"下一个 tick"（`settle.js` 的 `gateAndSnapshot`
    //     一进来就把 `meta.tick` 自增到它）⇒ 我这批事件/编年行必须**跟世界步那批落在同一个轮次**上，
    //     否则同一轮的事会被记到两个轮次（差一轮 ⇒ 检索、时间印记、门控三处全部错位）。
    //   ★★leg153：这个轮次**只有一处算**（`dialogueTick`）——查询串要按它去认"聊天侧这一轮交上来的事"，
    //     两处各算一次就会在"同一轮两把尺子"上再栽一跤（本仓为这个形状付过账）。
    const dialogueTick = (world?.meta?.tick ?? 0) + 1;
    const dialogueStats = registerDialogueFacts(world, { facts: tagFacts, dialogue, tick: dialogueTick });
    // ★★★leg119：`ledgerVolumes` = **编年进了冷档的那些段（卷）**，由编排层取好递进来
    //   （与 `recallStore` 同一条路：引擎不碰存储，浏览器侧的东西一律从选项进来）。
    //   ★不传 ⇒ `null` ⇒ 与接线之前**逐字节相同**（旧调用方零扰动）。★leg153 起它多一个消费者：
    //     召回要**热账 ＋ 卷**一起查（旧行轮转进卷之后，只查热账会**静默地少一整段**）。
    // ★★★leg153（用户 2026-09-30 拍"甲：整栏进包"）／★leg161 **接回来**（用户令「**那就让聊天侧也接上向量检索呗**」）：
    //   **按意思找回旧事**——拿"这一轮正在动的人和事"去**向量索引**里翻旧账，够得着字面对不上的那一段
    //   （细案 `docs/spec-memory-engine.md` §8.5）。
    //
    //   ★★★**它必须排在这一行**（顺序是这个机制的一部分，不是位置偏好）：
    //     ① **在 `registerDialogueFacts` 之后**：查询串要拿"聊天侧这一轮交上来的事"（用户 2026-09-30 裁：
    //        「玩家这一轮说的话就不要了，应该是聊天侧本轮提供的事件」），而那批**刚刚才落到账上**；
    //     ② **在 `buildEvolutionPack` 之前**：包要装它——"下一轮才给"那条路已被用户逐字判死。
    //
    //   ★为什么是一个**函数**、而不是像 `ledgerVolumes` 那样把数据递进来：这批料**只有走到这里才算得出来**
    //     ——调用方在进 `runTick` 之前根本不知道这一轮正文落了哪几件事。存储与网络住在浏览器侧
    //     （`web/embed-runtime.js`），引擎这一层照旧"不碰存储"。
    //
    //   ★**失败零阻塞**：抛错/超时/没配通道 ⇒ 这一栏不出现，世界照常推进（加速层不许影响世界）。
    //   ★**代价如实登记**：它多花**一趟网络往返**（把查询串嵌成一条向量）——这是"当轮到位"必须付的钱，
    //     也是这一栏唯一的新增开销（补嵌那条路照旧在 `afterTick` 里跑，不挡玩家）。
    const lim = resolveLimits(world);
    let vecRecall = null;
    if (typeof recallVec === 'function') {
        // ★★窗口下界**与出包那一侧同一个算法、同一份旋钮**（`windowFromTick` ＋ 账上设的「往事轮数」）：
        //   两处各算一次，就会出现"这一行既在 `纪事` 里、又被召回回来"的重叠（或反过来漏一段）。
        const floor = windowFromTick(Number(world?.meta?.tick) || 0, lim?.往事轮数 ?? RECENT_WINDOW_TURNS);
        try {
            vecRecall = await recallVec({ ssot: world, tickNow: dialogueTick, floor, volumes: ledgerVolumes });
        } catch (err) {
            vecRecall = null;
        }
    }
    const pack = buildEvolutionPack(world, moveFact, { picks, lim, turnFacts, volumes: ledgerVolumes, vecRecall });
    // ★★★leg151（引擎预取）：**"哪些线的经过递过了"当场就记**（`meta.linesShown`）。
    //   为什么在这里记、而不是等着一轮结束再记：一轮里还会再出一次包（结算那次，见下），
    //   而"递过"必须是**整轮**的口径 —— 不记的话第二次出包会把第一次刚递过的那几条**再递一遍**。
    //   ★它**只增不删**（一条线第 40 轮又被提到时该能再进来）；★什么都没递 ⇒ 一个字节都不碰（零扰动）。
    //   ★注意：`buildEvolutionPack` 返回的是**外壳**（`{pack, text, estTokens…}`），
    //     那一栏住在外壳里面的 `pack` 上 ⇒ 读的时候必须取内层（本笔在这里栽过一次，留档）。
    recordShownLines(world, lineRootsOfPack(pack.pack));
    // ★自证面（标签读数）：**随返回值交给调用方**，**不写账、不动 stage.warnings**。两条理由：
    //   ① 它是"这一轮正文长什么样"的**会话级读数**，不是世界状态——写进热账会让"这一轮"冒充"账上事实"
    //      （leg34 那次"过期检索冒充新检索"的同款坑的另一面）；
    //   ② `stage.warnings` 带**裁定语义**（`settleWithHealing` 数着它判"这一轮是不是降级路径"、
    //      `test/deadlock-heal.test.js` 锁着）⇒ 塞一行普通读数进去会让"降级路径"误报（leg89 实测过：
    //      "世界安静一步"那条用例当场红）。⇒ 只在返回值里给，编排层（`web/index.js`）自己留着报。
    const readout0 = tagReadoutLine(tagFacts);
    // ★★★leg123：把"聊天侧那批落了多少、丢了多少"接到**同一行读数**上（玩家可见文本，零引擎术语）。
    //   ★只在**真有丢/有截**时才加这个尾巴——没丢就一个字不多说（读数行本身已经够挤）。
    //   ★为什么必须出声：用户选了"只靠聊天模型"这条路 ⇒ 模型漏写、或值在正文里找不到，
    //     都会让"这一轮少记了东西"，而那**不能是静默的**（本仓最忌的失效形状）。
    //   ★★★leg159：**空转那几件也要出声**（用户令「值没变就不落账」）。
    //     病（真账实测）：同一句【变化】连着三轮重复落账 ⇒ 三件同名事件；治了之后那一轮
    //     "正文里有 2 条【变化】、账上一件没多"⇒ 不说清，玩家会读成"插件又漏记了"。
    //     ★措辞要**如实**：它**不是**丢（丢＝那条没法用），是**本来就没发生新事**——两笔分开报。
    const dlgBits = [];
    if (dialogueStats.dropped || dialogueStats.capped) dlgBits.push(`丢 ${dialogueStats.dropped + dialogueStats.capped} 件`);
    if (dialogueStats.noop) dlgBits.push(`${dialogueStats.noop} 件没变化（没落账）`);
    const dlgNote = dlgBits.length ? `正文落账 ${dialogueStats.events} 件（${dlgBits.join(' · ')}）` : null;
    const readout = [readout0, dlgNote].filter(Boolean).join(' · ') || null;
    const main = await runMainCall({ transport, ssot: world, pack });
    // ★★★本次修（真模型 60 轮长跑实跑抓出来的病）：**校验被拒也要能自愈，不许整轮丢**。
    //   病（实测）：60 轮里 **21 轮报废（35%）**、**白花 43.4% 的挂钟时间**、最长**连续卡 6 轮**；
    //     而 21 条归因里 **18 条是同一个**——模型把新线挂在一条**已经了结**的事上。
    //     那条自愈（`settleWithHealing`）**60 轮一次都没触发**，因为它排在**校验的后面**：
    //     校验不过 ⇒ 这里当场 `return` ⇒ 自愈一步都走不到。
    //   ⇒ 定案：**同一个"步写歪了"，在哪儿被逮住就该在哪儿得到同一个处置**。
    //     本仓 leg40b 立那条自愈时要治的正是"一条提议写歪 ⇒ 整步被拒 ⇒ 轮卡住 ⇒ 永久停摆"——
    //     那一层却够不着这里，这就是病根。
    //   ★它**不改写任何提议**（自愈只做减法：丢掉写歪的 → 重校验；leg187 再不行则失败、不推进）；
    //     校验那几条闸**一条都没放宽**（`checkWorldStep` 一个字节没动）——
    //     变的只是"被拒之后怎么办"，不是"什么算合格"。
    let stepForSettle = main.step;
    if (!main.ok) {
        if (!main.rawStep || typeof main.rawStep !== 'object') {
            // 连 JSON 都没解析出来 ⇒ **没有"提议"可救**，如实失败（不许假装成功）
            return { ok: false, error: main.errors.join('; '), move, pack, streams: null, tagFacts, tagReadout: readout, dialogueStats };
        }
        stepForSettle = main.rawStep;
    }
    // 结算走带自愈的路径（①原样 → ②保留合法提议 → ③无法结算则失败、不推进）。
    //   这次改动治的是"一条提议写歪 ⇒ 整步被拒 ⇒ tick 不动 ⇒ 下一轮又一样 ⇒ 世界永久停摆"。
    // ★leg115：**先记住结算前编年有几行**——结算之后要靠它认出"本轮新落的行"（时间印记只盖新行）。
    //   ★★★leg123：这一行**已上移**到 `registerDialogueFacts` 之前（见上）——因为聊天侧那批
    //     编年行也是**本轮新落的行**，leg115 的时间印记要一并盖到它们身上。
    const s = settleWithHealing({ ssot: world, step: stepForSettle, moveFact: move, calls });
    // ★★★leg151：结算这一次也出了一份包（`settleTick` 里那次）——它**是这一轮真递出去的东西的一部分**
    //   （模型在结算那一段同样看得到）⇒ 一并记进"递过"。
    if (s.ok) recordShownLines(s.ssot, lineRootsOfPack(s.pack?.pack));   // 同上：取外壳内层
    if (!s.ok) {
        return { ok: false, error: `结算拒绝: ${JSON.stringify(s.stage.warnings)}`, stage: s.stage, healed: s.healed, move, pack, streams: null, tagFacts, tagReadout: readout, dialogueStats };
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
    // ★★★leg115：**给这一轮新落的编年行盖上时间印记**（用户原话：「聊天llm是不知道什么时候世界发生了什么事懂吗？」）。
    //   病（真账 `大荒z` tick 61 实测）：账上 **`simLog` 零时间字段**，往事只带「第 N 轮」= **引擎轮次**；
    //     而"故事里过了多久"是正文里【时长】写的——它是**账外的料**（`pack.js:1014` 原文：
    //     「引擎一个字都不解析它，账按轮走、故事按时间走」）⇒ 写正文的人**自己写的时长，下一轮没地方找**。
    //   治法：把当轮时长**逐字照抄**进这一轮的编年行（`elapsed` 一格，契约层已登记）——
    //     往事与"什么时候"从此绑在同一行上，检索层一取就带出来（`ledger-recall.js`）。
    //   ★口径三条：
    //     ① **只收集原话，不做算术**：绝不把「三天」累加成一个"第 N 天"（红线 §2.2 第 1 条同源：
    //        不许把书里的词换算成数——时间也归这条管，累加就会编出账上没有的数）；
    //     ② **只盖本轮新落的行**（靠"结算前有几行"定位），**不回头改旧行**——旧行没有就是没有；
    //     ③ 没有时长（正文没写【时长】）⇒ **不盖**，不许填占位值（红线 2：空着就是空着）。
    stampChronicleTime(s.ssot, chronicleLenBefore, tagFacts?.elapsed);
    return { ok: true, ssot: s.ssot, stage: s.stage, streams, move, pack, picks, healed: s.healed, tagFacts, tagReadout: readout, dialogueStats };
}
