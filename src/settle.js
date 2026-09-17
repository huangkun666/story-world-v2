// story-world-v2/src/settle.js
// 结算管线（S5）：按序 校验 → 薄裁定 → 因果挂链 → 一致性检查 → 分量重算（常量占位）→ 落账 → 编年 → GC/度量。
// 纯函数：输入 SSOT 不被修改，返回新世界。硬规则出处：ANCHOR §3②/§4.2/§4.4/§4.5、切片细案 S5、长跑防线细案 §2.5。
import { checkWorldStep, newEventIdsOf, normalizeSameStepEventRefs } from './check-step.js';
import { buildEvolutionPack, computeIdleFaces } from './pack.js';
import { gateWorldStep } from './gate.js';
import { computeWeightAtTick } from './weight.js';
import { pulseEntropy } from './entropy.js';   // K27：熵泵（环境推演器 + 越阈落状态源事件）
import { updateTensionIntensity, pushTidePeak, eventBornTick } from './setting.js';   // K29：张力强度更新 + 浪尖派生（A-5 两来源）；bornTickOf 共用契约解析器
import { updateUnrestGear } from './unrest.js';   // ★leg53：乱象档位派生（引擎每轮从账上真发生的事推——用户令）
// ★★leg40b 续（**尺度上限参数化**·用户令「能不能直接把这些闸门参数直接放进参数页？」）：生效上限统一从这里取——
//   账上设了档位就用档位，没设就用本文件里的**出厂默认**（`limits.js` 引用式取它们，不重写数字）。
//   口径与 `params.js` 一致（值落 `context.setting.dynamic.env` / 白名单归一 / 缺键=默认）。
//   为什么**只在入口解析一次**再传着走：原先每个函数各自读模块常量 ⇒ 参数化时最易出的病就是
//   "某一条路仍读旧常量"（本仓"一个数两把尺子"的老病）。
import { resolveLimits, THREADS_TOP, EVENT_CAP_PER_TICK, AGENDA_CAP_PER_TICK, AGENDA_CAP_TOP_LEVEL, AGENDA_CAP_OPEN, ENTITY_BIRTH_PER_TICK } from './limits.js';
// ★leg33：位置归一的**唯一真源**在 `position.js`（叶子模块，避开 settle↔check-step 的循环依赖）。
//   ⚠必须是 `import` + `export` 两句——`export { X } from './y.js'` **不建立本地绑定**（本棒实测：
//   只写 re-export 时模块内 `normalizePosition is not defined`，被新用例当场抓红）。
import { normalizePosition } from './position.js';
export { normalizePosition };

// ★leg31 拍板：`topLevel` 5 → 10（用户令「先走保守的」）。
//   依据（真账副本 tick 17 / 618 实体 / 20 轮；门控放宽到 P2-(c) 后实测，细案 `spec-world-widening.md` §5.5 表六～表八）：
//   · 分离网格证明**咬人的是 `topLevel`**，不是 `perTick`：只放 perTick（→25）或只放 open（→60），
//     新生盘算与现状**逐项相同**（4 条 / 属主 3 / 在飞峰 5 / 撞闸 474）——因为闸**按序判**（下面三处 `if`），
//     顶层闸先把提议掐死在 5 件，`perTick` 那道根本轮不到咬人。
//   · 只放 `topLevel` 的档位曲线：8→7 条 · 10→**9 条 / 属主 8** · 12→11 条 · **15→14 条（甲档天花板**，
//     再往上（20）不动 —— 顶层大计吃满了"在飞 ≤15"的名额 ⇒ **`open` 是甲档的下一道天花板**）。
//   · 取 **10** 的取舍（用户口径"保守"）：属主面 3 → 8（约 2.7×），同时在线最多 10 条（模型负担可控）；
//     不取 15 是因为那等于让顶层吃满在飞闸、`open` 立刻成为新瓶颈。
//   · **未动**：`perTick`（2，非瓶颈）· `open`（15，甲档天花板，先留着）· `AGENDA_INVOLVED_CAP`（15）。
//   · **放开的代价已如实入档**：涉及闸是"**拒整步**"，所以"再往上放"必须与它同批放——
//     实测三道总量全放（25/60/40）而涉及闸保持 15 ⇒ **崩在第 12 轮**；四道全放（+涉及 60）才活（39 条 / 属主 38）。
//   · **真源纪律**：这三个数仍是**提案态**（铁律 2）；本节口径 = 用户 2026-09-12「先走保守的」+ 上表曲线。
// ★leg32 拍板：三道总量闸一起放开一档（用户令「你把世界变宽试试」，2026-09-12）：2/15/10 → **3/20/15**。
//   ★先说清楚**这次为什么不是"再抬一道"**（leg31 的读法在本棒被真账推翻）：
//   · leg31 量的是**确定性桩**——桩每轮提议 25 条、且允许同一属主堆多条线 ⇒ 那时 `topLevel` 是瓶颈。
//   · 真账（tick 27）量到的是另一回事：**模型每 2–3 轮才提 1 条新线，且一个属主同时只跑一条**
//     ⇒ 22 轮 9 条 / 27 轮 12 条，**顶层峰值 2**（上限 5 都没碰到）、在飞稳定 1–3 条。
//   · 结论：**这批闸在真账里几乎从不咬人** ⇒ 抬它们**本身不会**让世界变宽（本棒实测：只抬/只开门
//     在桩口径下 born 9→14→19，但"在飞"的**稳态**始终由"出生率 × 线寿命"决定，不由闸决定）。
//   · 那为什么还要抬？**把上限从"挡路的怀疑对象"里摘出去** ⇒ 以后再看"世界窄"，可以确定不是它们，
//     而是**供给侧**（模型提不提新线）。同时给真模型留出余量：真账 t24 出现过"一轮提 2 条新线"，
//     `perTick` 由 2 抬到 3，让这种轮不再丢线。
//   · **未动**：`AGENDA_INVOLVED_CAP`（15）—— 它是"拒整步"，且真账至今**零次触发**（无 校验拒绝 警告），
//     放开它没有需求；而 leg31 实测"总量全放 + 涉及闸不动 ⇒ 崩在第 12 轮"，故**不同批碰它**。
//   · 代价与自证：抬完跑 `node --test` + `node demo/smoke-demo.js`（切片世界新生 0/tick，此闸不参与）；
//     面板分母已改读真源 ⇒ 这次**界面上能直接看见**上限变成 15/20/3（改前那版写死 5，看不见）。
// ★leg40b 续：出厂值住在 `limits.js`（唯一真源），这里只**重新组装成既有形状**并保持导出名
//   ⇒ `smoke.js` / `render.js` / 各测试的 `AGENDA_CAPS.topLevel` 读法**零扰动**。
//   ★为什么保留这两个别名对象而不是让调用方改读 `limits.js`：本轮改动面要小、可回退；
//     下一棒若要彻底收口，再来删别名（届时 `grep AGENDA_CAPS` 只会在本文件与测试里）。
export const AGENDA_CAPS = { perTick: AGENDA_CAP_PER_TICK, open: AGENDA_CAP_OPEN, topLevel: AGENDA_CAP_TOP_LEVEL };
const AGENDA_STAGE_FALLBACK = '谋划';   // 新盘算缺省阶段（ssot schema 要求 stage 非空）
// leg25 f（用户拍板「X1 认账简化」）：`VERDICT_HURT_THRESHOLD = 0.05` **已删除**。
//   它曾是 K15「败露」判据的阈值（报批 #11 定案）。原判据吃 `hurtWindow`（近 2 tick 负向 δ），
//   而该字段随四维属性一起失去写入方（全仓无写入点、真账 563 实体里 0 个有它）⇒ 判据恒假、
//   分支永不可达、常量成死参数。**不新造判据**（引擎没有任何"计划被打回"的客观输入，见下 adjudicate 注释），
//   改为把满步终局措辞从「达成」收回为「结清」——引擎只证明"期满收摊"，不下"此事办成了"的判断。
//   全文依据：`docs/spec-failure-verdict-and-visibility.md` §2。旧值留档：0.05（报批 #11）。

// K19 事件产率上限 / 链尾结清窗（因果链细案 §3.1/§3.2，T1/T2 已拍板；均提案态——曲线支撑：
// 产率 max 4/tick 开局、稳态 1（细案 §1 配套曲线）；正式报批走报批支线，铁律 2/8）
export const EVENT_CAPS = { perTick: EVENT_CAP_PER_TICK };
// ★leg40b 续：`ENTITY_BIRTH_PER_TICK` 的值住在 `limits.js`，这里**原样转出**（老调用方 `render.js`/测试零扰动）。
export { ENTITY_BIRTH_PER_TICK } from './limits.js';
export const CHAIN_SETTLE = 5;

// K20 档案摘要化（因果链细案 §3.3，T3 已拍板 + T3-D1 引擎结构摘要；longrun §2.2 原值，提案态——随报批支线）
// 热窗 20 tick：闭环满 20 tick 且无未决下游 → 按出生段压入里程碑（温层）；里程碑不进模型输入（pack 只取未决+近 2 closed，自动剥离）
export const ARCHIVE = { hotWindow: 20, milestoneEvery: 10 };

// K37 实体治理数字组（细案 §3.7 → A-10..A-12；铁律 2：全部提案态，随 K37 曲线 + K38 报批）
// ★leg40b 续：`ENTITY_BIRTH_PER_TICK` 已移居 `limits.js`（本文件从那里 import，仍是同一个名字/同一个值）。
//   为什么移：它是"尺度上限"一族，与 `AGENDA_CAPS`/`EVENT_CAPS` 一样要**一个家**，否则参数化时会分身。
export const ENTITY_IDLE_RETIRE_TICKS = 20;  // 提案：连续未活跃轮数（背景化条件）
// leg24 片3 删除位：RETIRE_WEIGHT_FLOOR（"影响力低于地板才准退休"）已删——判据不再吃分量。
//   片2 曾提前单摘它，三处冒烟当场红（应答机制 66→34、全册 active 破）；根因=当时门控还在吃分数，
//   而分数退化的世界"谁静默"已经失真。片3 把门控/镜头/掩码全换成结构判据之后，退休才具备换判据的前提。
//   现判据（下表 retireInactive）：无在飞盘算 ∧ 无未决事件引用 ∧ 连续 ENTITY_IDLE_RETIRE_TICKS 轮未露面。
export const ENTITY_GC_SCAN_TICKS = 20;      // 提案：背景化扫描周期
// （POOL_CAP 席位上限已于第十九棒 K45 废除——full-roster-lens-spec C3：资格=在册，镜头管进出；用户 2026-09-09 拍板「不设上限」）

// leg25 c（用户令「删」）：**入局数值面整条删除**——四维浮点（兵力/权位/人脉/耳目）不存在了。
//   书里的说法照抄成文本（实体 `实力` = 「T9渡劫巅峰」据书），引擎不换算、不进公式。
//   随之删除：INBORN_ATTR_KEYS 白名单、LEGACY_ENTITY_ATTR_DEFAULTS 旧默认值表、两个 meta 迁移键、
//   ATTR_BOUNDS。旧账残留的 attrs 由 migrateLegacyAttrs（下方）一次性整键摘除，不许无声留在账上。
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

const SOURCE_LABEL = null; // 已废弃（第十三棒：编年源头措辞改写名不写代号，见 chronicleEvents）

const entityName = (world, id) => world.entities.find((e) => e.id === id)?.name || id;   // 编年渲染：id 一律成名（"棋好看"）

// ---- 旧账清理（纯函数迁移；幂等；不可变风格与全库一致） ----
// 历史留档（一句话版，防重走）：leg24 片4 起这里曾有一条"逐维判旧默认值"的迁移，
//   判"这个数是不是**引擎编的**"（该维 == 本类别旧默认值 ∧ 书里没写 ∧ 编年无变更 → 删该维）；
//   第二十五棒实机修正把它从"整行全等"改成"逐维"（旧法漏清 500 维的机理：混合行让整行判词恒假）。
//   **leg25 c 起这条判词连同它的判据源一起删除**——因为要判的对象整体不存在了：
//   四维浮点（兵力/权位/人脉/耳目）已被用户令删除（没法精确表示；手拍值让"编的"看起来像"算的"）。
//   判"数是不是编的"已经没有意义，现在只判"这个维度还存不存在"。故判据塌成一行：见下。
// 旧账迁移（leg25 c）：**把 attrs 整键摘除**。判据极简——四维不存在了，账上就不该有它。
//   为什么要留档：那些数曾经摆在面板上冒充客观（"兵力 0.15"），删掉时不许无声消失。
//   幂等闸：meta.attrsRemovedAt（一次性）；留档 meta.legacyAttrsPurged = { [entityId]: { [attr]: 旧值 } }。
//   与 leg24 那条"逐维判默认值"的迁移的关系：那条判"这个数是不是引擎编的"，本条判"这个维度还存不存在"；
//   后者一旦成立，前者不再需要——四维整体不存在了。
export const ATTRS_REMOVED_AT = 'attrsRemovedAt';
export const LEGACY_ATTRS_PURGED = 'legacyAttrsPurged';
// ★leg25 f：本口同时负责**第二个已死字段** `hurtWindow`（保留函数名以免动一大片调用面，职责写在这里）。
//   `hurtWindow` 是"近 2 tick 负向 δ"窗口，唯一消费者是已删除的「败露」判据，`ssot.schema` 里也已摘掉该键
//   （`additional:false` ⇒ 残留会让整份文档校验不过）。**两处摘除都是无条件、幂等的**——这正是治
//   "删字段只删一半"那个老洞：不做"没 attrs 就原样返回"的提前退出，否则"只有 hurtWindow 残留"的账
//   会带着字段过 schema、越走越远（ledger 里 `attrs 只删了一半` 的同类病）。
export function migrateLegacyAttrs(ssot) {
    if (!ssot || typeof ssot !== 'object') return ssot;
    const meta = ssot.meta || {};
    const purged = {};
    let changed = false;
    let hurtDropped = 0;
    const entities = (ssot.entities || []).map((e) => {
        const hasAttrs = e.attrs && typeof e.attrs === 'object' && Object.keys(e.attrs).length;
        const hasHurt = e.hurtWindow !== undefined;
        if (!hasAttrs && !hasHurt) return e;
        const next = { ...e };
        if (hasAttrs) { purged[e.id] = e.attrs; delete next.attrs; }   // 旧值留档（不许无声消失）
        if (hasHurt) { delete next.hurtWindow; hurtDropped += 1; }
        changed = true;
        return next;
    });
    if (!changed) return ssot;                                // 无可摘即不改一字（幂等：字节一致）
    // ★闸门语义（leg25 f 修正）：`attrsRemovedAt` 只是"attrs 那一轮迁过"的**留痕**，不再是提前退出的理由——
    //   提前退出正是"只残留 hurtWindow 的账带着死字段过 schema"那个洞的成因。
    //   闸门改为**写一次不改**（既有值优先），既保住"值不变"的口径，也不再拿它当跳过清理的借口。
    return {
        ...ssot,
        entities,
        meta: {
            ...meta,
            [ATTRS_REMOVED_AT]: meta[ATTRS_REMOVED_AT] ?? meta.tick ?? 0,
            ...(Object.keys(purged).length ? { [LEGACY_ATTRS_PURGED]: { ...(meta[LEGACY_ATTRS_PURGED] || {}), ...purged } } : {}),
        },
    };
}

// ① 校验（薄裁定器）：世界步过全部语义校验；不过 → 世界如实不动（调用方退回）。
// leg25 c（用户令「删」）：**属性裁定整段删除**。原先此处逐条裁 `stateChanges[].attr/delta`
//   （边界钳制、首值落账、静默方自我增强被拒、空裁定措辞、属性编年、hurtWindow 输入）——
//   四维浮点既然不存在（没法精确表示；手拍值让"编的"看起来像"算的"，design-core §4 第 1 条），
//   契约层连 `stateChanges` 整条都删了，这里自然无可裁。
//   ✅ leg25 f 处置（用户拍板「X1 认账简化」）：连带后果**已收口**，不再是欠账——
//     满步终局的「败露」支与 `VERDICT_HURT_THRESHOLD` **一并删除**；措辞由「达成」改「**结清**」。
//     依据：引擎手上没有任何"计划被打崩/落空"的客观输入（`agenda` 不落 `source`；父终结时
//     `parentId` 被 delete；`memory.done` 只记"做过什么"；50 tick 合成跑满步盘算 done=3、"起手未动"0 例）
//     ⇒ 与其新造一个数字，不如把结论收回引擎职权边界内。详见 `docs/spec-failure-verdict-and-visibility.md` §2。
// ★leg40b 续（死锁修复）：这里**不再需要**传"本轮新事件 id 名单"——`findEvent` 已改成**按位次解析**
//   同轮引用（引擎的发号规矩就一条，见 check-step 的 `newEventIdsOf`），既不用调用方记得传，
//   也不存在"传了才生效、忘了就静默失效"的那种两把尺子。
function adjudicate(world, step, tick, warnings) {
    const checked = checkWorldStep(step, world);
    if (!checked.ok) {
        for (const e of checked.errors) warnings.push(`校验拒绝: ${e}`);
        return false;
    }
    // ★leg33c：非致命留痕面（位置集外）随拒签面一起上报——留痕不是判据，是观测面。
    //   它**不计入拒签率**（拒签口径只数 `裁定:`/`校验拒绝:`/`提议丢弃`），见 check-step ④ 段末的承诺。
    for (const w of checked.warnings || []) warnings.push(w);
    return true;
}

// ③ 因果挂链：新事件落账为节点，上游指针入 links.up
// ★leg40b 续（死锁修复·配套）：**新事件的发号规矩**现在住在 `check-step.js`（`newEventIdsOf`）——
//   因为"校验时就能算出这批事件将拿到哪些 id"是**校验面**的知识（`findEvent` 要用它认同轮引用），
//   而落账面（本文件）与净化器都从那里取 ⇒ 一处定义、三处同源（本仓老病是"一个数两把尺子"）。
function hangEvents(world, step, tick) {
    const added = [];
    const ids = newEventIdsOf(step, tick);
    step.newEvents.forEach((ev, i) => {
        const id = ids[i];
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

// K9 影响通道（引擎独占写玩家，红线 1 代码化，玩家档案细案 §3.3）——**leg25 c：整段删除**。
//   原法：① 他人 actions[].target === playerId → 玩家 hardPower −= PLAYER_IMPACT.targeted
//         ② 新事件波及玩家 → 玩家各 attrs −= PLAYER_IMPACT.rippled
//   它扣的是**四维浮点**，而账上已经没有这些数了（没法精确表示；手拍值让"编的"像"算的"）。
//   红线 1（引擎独占写玩家）本身不变，只是"可写的内容"没了；`playerAffected` 记录**照旧留着**
//   并照旧进 simLog（审计面不缩水——它的语义是"世界伸手碰了玩家"；将来若有新的可写事实，仍从这里走）。

// 执行债（events.closed 关闭路径最小面，2026-09-07 顺手清）+ K19 闭环三型（因果链细案 §3.1 → A-1）：
// ① 源结清：盘算终结/取消 → 其 plot 源事件全部闭环（closedAt 记落账 tick——归档判龄）；
// ② 链尾结清：ripple 事件链头已了结 + 落账 ≥ 涟漪平息窗（CHAIN_SETTLE）+ 无未决下游引用 → 自动闭环
//    （"涟漪平息"——K6 点名窗口随链尾收敛，世界不自锁）；链头语义：plot → 源盘算终结才算数；
//    state → 处境不是驱动马达（波纹靠自身延伸/消亡），恒视为已了结（常驻保留不变）；
// ③ 常驻保留：state 源未决事件永不自动闭环（不在此函数内处理）。
// 闭环留痕只进观棋（不带 eventRef → 不进注入：闭环是历史状态，不是新动向）。
// 完整闭环设计（叶子结清/裁剪/事件产率上限）随因果链强化阶段（dev-process §6 队列）。
const bornTickOf = (ev) => eventBornTick(ev.id);   // 事件 id 契约共享解析器（setting.js；K29 起同源）
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
            chronicle.push({ id: `ch_${tick}_evc_${ev.id}`, tick, text: `事件「${ev.title}」闭环（源盘算已结算）`, kind: 'major', chainRef: ev.id });
        }
    }
    for (const ev of world.events) {
        if (ev.closed || ev.source?.type !== 'ripple') continue;
        if (!headClosed(world, ev)) continue;
        if (tick - bornTickOf(ev) < CHAIN_SETTLE) continue;
        if (hasPendingDownstream(world, ev)) continue;
        ev.closed = true;
        ev.closedAt = tick;
        chronicle.push({ id: `ch_${tick}_evc2_${ev.id}`, tick, text: `事件「${ev.title}」涟漪平息（链源已了结）`, kind: 'ripple', chainRef: ev.id });
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

// 自动拆环（ANCHOR §4.1 / 细案 §3.3 → A-4）：环内挑一方断其与父的边转独立。
// leg24 片3：**排序判据由"分量升序"改为结构序**——①盘算年纪：turnsAlive 小者（较新）先让
//   ②再比 progress 浅者先让 ③再比 id 序（确定性兜底）。原判据吃那个已被拍板删除的分数。
// blocked 记"拆环让路"；编年留痕。
function breakCycle(cycle, world, tick, chronicle) {
    const age = (a) => (typeof a.memory?.turnsAlive === 'number' ? a.memory.turnsAlive : 0);
    const sorted = [...cycle].sort((x, y) => {
        if (age(x) !== age(y)) return age(x) - age(y);
        if (x.progress !== y.progress) return x.progress - y.progress;
        return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
    });
    const victim = sorted[0];
    delete victim.parentId;
    victim.memory.blocked.push('拆环让路');
    chronicle.push({
        id: `ch_${tick}_cyc_${victim.id}`,
        tick,
        text: `拆环：${entityName(world, victim.owner)} 让路转伺机（较新者先让）`,
        kind: victim.visibility === 'concealed' ? 'shade' : 'scheme',
    });
}

export function spawnAgendas(world, gstep, tick, warnings, chronicle, lim = resolveLimits(world)) {
    const spawned = [];
    for (const na of gstep.newAgendas || []) {
        const goal = na.goal;
        const owner = na.entity;
        const openNow = (world.agendas || []).filter((a) => !a.closed).length + spawned.length;
        const topNow = (world.agendas || []).filter((a) => !a.closed && !a.parentId).length
            + spawned.filter((a) => !a.parentId).length;
        // GC 上限（A-3）：超限拒建 + 警告，世界其余照常（超限不新建，§4.3 语义之一）
        // ★leg40b 续：三个上限一律走 `lim`（= `resolveLimits(world)`：账上档位优先、否则出厂默认）。
        // ★★★leg63（用户实机报「我参数都这样了」）：`每 tick 新生` 这一道**过去读的是出厂常量**
        //   （`AGENDA_CAPS.perTick` = 3，刻意不做旋钮），于是玩家把「每轮递几条线」拧到 10、
        //   模型真提了 10 条，第 4 条起全被这个**他看不到的数**拒掉（观棋窗口只报"被拒"，
        //   不说"是这个数拒的"）。⇒ 本棒把它收进 `lim.每轮新生`（第五个输入框），
        //   **与上面两道同源**：账上设了就按账上、没设就出厂 3（零行为变化，见 test/limits.test.js）。
        //   ★口径仍是"按序判"：这一道先判（它是"这一轮里最多新开几件"），
        //     它放行之后才轮到 `在飞大计`/`顶层大计` —— 三道都各有自己的账。
        if (spawned.length >= lim.每轮新生) {
            warnings.push(`裁定: 盘算大厦顶（每 tick 新生 ≤${lim.每轮新生}）：${entityName(world, owner)} 提议「${goal}」被拒`);
            continue;
        }
        if (openNow >= lim.在飞大计) {
            warnings.push(`裁定: 盘算大厦顶（在飞全局 ≤${lim.在飞大计}）：${entityName(world, owner)} 提议「${goal}」被拒`);
            continue;
        }
        if (na.source.type !== 'parent' && topNow >= lim.顶层大计) {
            warnings.push(`裁定: 盘算大厦顶（顶层 ≤${lim.顶层大计}）：${entityName(world, owner)} 提议「${goal}」被拒`);
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
        // ★leg29（N3）：**出生理由落账**——与 `parentId` 分开写、两者并存（parent 源两个字段都有）。
        //   此前只有 `parentId` 一条边，event/state 两种源在出生那一刻被丢掉 ⇒ 引擎事后说不清一条盘算怎么来的
        //   （细案 `docs/spec-novelist-clause.md` §5.2 实测：真账四条盘算 parentId 全 null、source 不存在）。
        //   `ref` 只在该源型需要引用时才写（state 源不带 ref）。
        agenda.source = na.source.ref ? { type: na.source.type, ref: na.source.ref } : { type: na.source.type };
        if (na.source.type === 'parent') agenda.parentId = na.source.ref;
        world.agendas.push(agenda);
        // 环检测（§3.3）：每次创建时沿父链上溯，触到自己即环（确定性）；成环不拒绝整件事——自动拆
        const cycle = findCycle(agenda, world.agendas);
        if (cycle) breakCycle(cycle, world, tick, chronicle);
        spawned.push(agenda);
        // 挂因留痕（§4.4①/②，措辞按细案 §3.2 三型）
        if (na.source.type === 'state') {
            chronicle.push({ id: `ch_${tick}_ag_${agenda.id}`, tick, text: `由处境而生：${entityName(world, owner)} 生「${goal}」`, kind: agenda.visibility === 'concealed' ? 'shade' : 'scheme' });
        } else if (na.source.type === 'event') {
            const ev = (world.events || []).find((e) => e.id === na.source.ref);
            chronicle.push({ id: `ch_${tick}_ag_${agenda.id}`, tick, text: `因事而生：${entityName(world, owner)} 由「${ev?.title ?? na.source.ref}」生「${goal}」`, kind: agenda.visibility === 'concealed' ? 'shade' : 'scheme' });
        } else {
            const parent = world.agendas.find((x) => x.id === agenda.parentId);
            parent.memory.promises.push(agenda.id);   // A-5 前半：委派承诺写入（清 promises 写入执行债）
            // K21 暗处渲染（因果链细案 §3.4 → A-4）：concealed 委派不留痕——数据照写（父 promises 属账），编年抑制（暗处不曝光）
            if (agenda.visibility !== 'concealed') {
                chronicle.push({
                    id: `ch_${tick}_ag_${agenda.id}`,
                    tick,
                    text: `委派：${entityName(world, parent.owner)} 拆大给小——「${goal}」（授 ${entityName(world, owner)}）`,
                    kind: 'scheme',
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
        world.weights[e.id] = computeWeightAtTick(null, e.kind, tension, idle);
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
            kind: a.visibility === 'concealed' ? 'shade' : 'scheme',
        });
        const sons = world.agendas.filter((x) => x.parentId === a.id && !x.closed);
        if (sons.length) {
            for (const s of sons) delete s.parentId;   // 诸子断链转独立（事业未竟，不悬挂已死之父）
            chronicle.push({
                id: `ch_${tick}_canS_${a.id}`,
                tick,
                text: `取消后遗留子盘算 ${sons.length} 项转独立（事业未竟）`,
                kind: a.visibility === 'concealed' ? 'shade' : 'scheme',
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
            chronicle.push({ id: `ch_${tick}_adv_${ad.agendaId}`, tick, text: `盘算「${a.goal}」推进：${ad.step}`, kind: 'scheme' });
        }
        if (a.progress >= a.maxSteps) {
            a.closed = true;
            closedIds.add(a.id);
            // 满步终局（K15 细案 §3.4 → A-6 的 leg25 f 修订；模型无直接终结通道，结局全归引擎）：
            //   判序 = **变形**（有在飞子 → 事业移交诸子，断链转独立）→ **结清**（无子时期满收摊）。
            // ★leg25 f 修订（用户拍板「X1 认账简化」，细案 `spec-failure-verdict-and-visibility.md` §2）：
            //   原第三支「败露」**已删除**——它的判据吃 `hurtWindow`（近 2 tick 负向 δ），
            //   而那个字段随四维属性一起失去写入方（实测：真账 563 实体里 0 个有它），
            //   ⇒ `|0| >= 0.05` 恒假 ⇒ **该分支永不可达**，且 `VERDICT_HURT_THRESHOLD` 成了死参数。
            //   为什么不是"另立一条判据"而是删掉：引擎手上**根本没有任何"计划被打崩/落空"的客观输入**
            //   （`agenda` 不落 `source`；父终结时 `parentId` 被 delete；`memory.done` 只记"做过什么"），
            //   实测 50 tick 合成跑满步盘算 `memory.done=3`——"起手未动"0 例。
            //   ⇒ 与其造一个新数字（触碰「宁缺勿造」），不如**把结论收回到引擎的职权边界内**：
            //   引擎能证明的只有"步数走完了、没人拦"，所以措辞从「达成」（= 对世界下判断）改为
            //   **「结清」**（= 账房把这一笔收摊）——与红线 1「引擎不裁胜负」同源。
            //   "未竟而终"由既有通道承担：模型提议取消（K22：提议 + 理由 + 引擎裁决 + 托孤 + 联闭）。
            const sons = world.agendas.filter((x) => x.parentId === a.id && !x.closed);
            let verdict = '结清';
            if (sons.length) {
                verdict = '变形';
                for (const s of sons) delete s.parentId;   // 诸子断链转独立（树在结算中演化）
                chronicle.push({
                    id: `ch_${tick}_fin_${a.id}`,
                    tick,
                    text: `盘算「${a.goal}」满步结算：变形，事业移交诸子（${sons.length} 项断链转独立）`,
                    kind: a.visibility === 'concealed' ? 'shade' : 'scheme',
                });
            } else {
                chronicle.push({
                    id: `ch_${tick}_fin_${a.id}`,
                    tick,
                    text: `盘算「${a.goal}」满步结算：结清（期满收摊，终结产果 §4.4④）`,
                    kind: a.visibility === 'concealed' ? 'shade' : 'scheme',
                });
            }
            // K14 兑现落痕（细案 §3.3 → A-5 后半）：仅"结清"态兑现——变形不记（托孤之子尚未有果）
            if (verdict === '结清' && a.parentId) {
                const parent = world.agendas.find((x) => x.id === a.parentId);
                if (parent) {
                    parent.memory.done.push(`兑现：${a.goal}`);
                    // K21 暗处渲染：concealed 兑现不留痕——父 done 属账照写，编年抑制（子结清是暗处的成果，不上桌）
                    if (a.visibility !== 'concealed') {
                        chronicle.push({
                            id: `ch_${tick}_ful_${a.id}`,
                            tick,
                            text: `兑现：${entityName(world, parent.owner)} 收「${a.goal}」之果`,
                            kind: 'scheme',
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

// ⑦ 编年：事件条目（可读、带因果；实体 id 一律渲染成名——"棋好看"。
//   第十三棒：源头措辞写名/题/目标——由盘算「目标」而生 / 由世界处境而生 / 沿「上游事件标题」而来；
//   代号（ev_/a_/e_）绝不入玩家视线（A-3）；历史行保持原样，只作用于新落账行。）
function eventSourcePhrase(world, ev) {
    if (ev.source.type === 'plot') {
        const a = (world.agendas || []).find((x) => x.id === ev.source.ref);
        return a ? `由盘算「${a.goal}」而生` : '由盘算而生';
    }
    if (ev.source.type === 'ripple') {
        const up = (world.events || []).find((x) => x.id === ev.source.ref);
        return up ? `沿「${up.title}」而来` : '沿旧事而来';
    }
    return '由世界处境而生';
}
function chronicleEvents(world, step, tick, chronicle) {
    const name = (id) => world.entities.find((e) => e.id === id)?.name || id;
    step.newEvents.forEach((ev, i) => {
        const ripples = ev.ripples?.length ? `，牵动 ${ev.ripples.map(name).join('、')}` : '';
        chronicle.push({
            id: `ch_${tick}_ev_${i + 1}`,
            tick,
            text: `事件「${ev.title}」——${eventSourcePhrase(world, ev)}，事发 ${ev.position}${ripples}`,
            kind: ev.source.type === 'plot' ? 'major' : ev.source.type === 'ripple' ? 'ripple' : 'state',
            eventRef: `ev_${tick}_${i + 1}`,
        });
    });
}

// ⑧ GC/度量（切片版）：simLog 记账（长跑细案 §2.5 四字段；K2 起含门控审计；K9 起含 playerAffected 影响审计）。
// K38 观测台（敲定稿 I 条）：entry 增 proposals（提议条数=拒签率分母）/ rejected（静默滤除+裁定拒=分子）——
//   只在有值时写（旧账零扰动；观测台对缺字段走 warnings 兜底口径）。
function recordMetrics(world, tick, packTokens, calls, warnings, chronicle, gate, playerAffected = [], proposals = 0, rejected = 0) {
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
    if (proposals > 0) entry.proposals = proposals;
    if (rejected > 0) entry.rejected = rejected;
    world.meta.simLog.push(entry);
}

// K37 生通道②落账（细案 §3.7 → A-10）：入局提议——单轮 ≤N 拒超限；
// 落账（id=e_<tick>_<n>；kind 缺省 character；**attrs 只在模型提议时落，没提议就空着**——leg24 片2）
// + 编年「XX 入局」（kind major=大事）
// ★★★leg63（用户令「我要把另外两个参数也设置成可调」）：上限从**出厂常量**改成**`lim.每轮入局`**
//   （`= resolveLimits(world)`：账上设了按账上、没设回出厂 1 ⇒ 逐字不变）。
//   为什么过去那个理由不成立：注释写的是"一次调太多，每个都得重跑基线"——那是**保守**，
//   而真账里它会咬人：模型一轮提两个新人 ⇒ 第二个直接拒（"入局限额"那条裁定就是这个）。
function spawnEntities(world, gstep, tick, warnings, chronicle, lim = { 每轮入局: ENTITY_BIRTH_PER_TICK }) {
    const born = [];
    const cap = Number(lim?.每轮入局) > 0 ? Number(lim.每轮入局) : ENTITY_BIRTH_PER_TICK;
    for (const ne of gstep.newEntities || []) {
        if (born.length >= cap) {
            warnings.push(`裁定: 入局限额（每 tick 新生 ≤${cap}）：「${ne.name}」被拒`);
            continue;
        }
        if (world.entities.some((e) => e.name === ne.name)) {
            // ★leg32f：同名 = **丢掉这条提议**（账上已有的那个人正在册，丢掉它对世界零损害），
            //   而**不是**判整步不合法。旧法在 check-step 里报致命错 ⇒ 整轮（含玩家这一轮的行动）陪葬
            //   （用户实机：「$.newEntities[0].name: 账上已有同名实体「白小娥」…（世界原样未动，可重试）」）。
            //   ⚠留痕不许省：静默丢弃也要能被看见、被计数（`提议丢弃:` 已并入 simLog 的 rejected 口径）。
            warnings.push(`提议丢弃: 「${ne.name}」账上已有同名实体（已有者不重建）`);
            continue;
        }
        const kind = ne.kind || 'character';
        // ★leg32f：位置不在集内 ⇒ 归一到「未明」并留痕（不拒整步、不拒这个人）。
        //   为什么归一：位置线已定案"不可靠、不参与机制、包里'有就给'"，拿它当硬闸会把"这个人该不该存在"
        //   和"他站在哪"混为一谈。座标编错，人还是该入场的（空着就是空着）。
        let location = ne.location;
        // ★leg33：同一趟归一——模型可能把实体表格子里的「（推）」注解一起抄进 location
        //   （`normalizePosition` 与 check-step 的位置段读同一份真源）。
        // ★leg33c（用户拍板「位置变成自由文本，位置集干脆删了」）：**位置集不再是闸**——
        //   集外地名**照收**（模型的创作权），只留痕。旧法把它归一到「未明」，
        //   于是"大书里写得出、账上却记不住"（书里 134 个地点被截到 60，模型写 `太清境` 就被抹成未明）。
        //   只有**空值**才归「未明」（空着就是空着——这是形态，不是判据）。
        const locNorm = normalizePosition(location);
        if (typeof locNorm === 'string' && locNorm.trim()) {
            location = locNorm.trim();
            if (!new Set(world.context?.positions || []).has(location)) {
                warnings.push(`位置集外: 「${ne.name}」的位置「${location}」不在参照表内（照收——参照表不是闸）`);
            }
        } else {
            location = '未明';
        }
        // leg25 c：入局**不再落任何数值**——四维已不存在（书里的说法走 `实力` 文本态）。
        const ent = {
            id: `e_${tick}_${born.length + 1}`,
            kind,
            name: ne.name,
            location,
            lastActiveTick: tick,
        };
        // K45/C7（用户 2026-09-09 拍板：提示词约束为主）：newEntities 可带 parent=所属势力名——目标在册且为势力且未灭才落；否则弃关系+警告（照常入局）
        const parent = typeof ne.parent === 'string' && ne.parent.trim() ? ne.parent.trim() : null;
        if (parent) {
            const target = world.entities.find((t) => t.name === parent);
            if (target && target.kind === 'faction' && (target.status || 'active') !== 'dead') ent.parent = parent;
            else warnings.push(`裁定: 「${ne.name}」的从属「${parent}」不在册/非势力/已灭——弃关系（照常入局）`);
        }
        world.entities.push(ent);
        born.push(ent);
        const why = ne.source.type === 'event'
            ? `因事件「${(world.events || []).find((e) => e.id === ne.source.ref)?.title ?? ''}」而生`
            : ne.source.type === 'book' ? '名载书中'
                : ne.source.type === 'entity'
                    // ★leg32e：牵出者写**名**不写 id（与全仓"引擎 id 不透传玩家视线"同口径）
                    ? `由「${world.entities.find((e) => e.id === ne.source.ref)?.name ?? ''}」牵出`
                    : '屡被提及，声名鹊起';
        chronicle.push({ id: `ch_${tick}_ent_${ent.id}`, tick, text: `「${ent.name}」入局（${why}）`, kind: 'major' });
    }
    return born;
}

// K37 对话依据册（细案 §3.7 → A-10 通道③）：落子提取对象命中即记账（meta.dialogueBook，随背景化清理）；
// "白小娥反复被点名"成为可溯源的 dialogueFact 依据（extract 双名单的引擎侧落账）
function bookDialogue(world, moveFact, tick) {
    const obj = moveFact?.object;
    if (!obj || typeof obj !== 'string') return;
    world.meta.dialogueBook = world.meta.dialogueBook || {};
    const rec = world.meta.dialogueBook[obj] || { count: 0, lastTick: 0 };
    rec.count += 1;
    rec.lastTick = tick;
    world.meta.dialogueBook[obj] = rec;
}

// K37 灭通道（细案 §3.7 → A-11）：覆灭提议 → 引擎复核——source.ref 真实落账且指向已了结
// （agenda closed / 事件闭环或已归档入纪）+ 目标无在飞盘算子树 → status=dead（终局不复归）+ 编年「覆灭」；
// 打崩 ≠ 灭（attrs 归零仍是合法客体，K7 万法阁案例回归）；玩家不可灭（check 已拒，防御）
function applyEntityFates(world, gstep, tick, warnings, chronicle) {
    for (const f of gstep.entityFates || []) {
        const ent = world.entities.find((e) => e.id === f.entity);
        if (!ent || (ent.status || 'active') === 'dead') continue;   // check 已查（防御）
        if ((world.agendas || []).some((a) => a.owner === ent.id && !a.closed)) {
            warnings.push(`裁定: 覆灭复核拒绝——「${ent.name}」仍有在飞盘算（先了结，再言灭）`);
            continue;
        }
        if (f.source.type === 'agenda') {
            const ag = world.agendas.find((a) => a.id === f.source.ref);
            if (!ag || !ag.closed) { warnings.push(`裁定: 覆灭复核拒绝——源盘算「${f.source.ref}」未真实终结`); continue; }
        } else {
            const hot = world.events.find((e) => e.id === f.source.ref);
            const archived = (world.milestones || []).some((m) => (m.ids || []).includes(f.source.ref));
            if (!hot && !archived) { warnings.push(`裁定: 覆灭复核拒绝——源事件「${f.source.ref}」不在账`); continue; }
            if (hot && !hot.closed) { warnings.push(`裁定: 覆灭复核拒绝——源事件「${f.source.ref}」未了结（尘埃未定）`); continue; }
        }
        ent.status = 'dead';
        chronicle.push({
            id: `ch_${tick}_fate_${ent.id}`,
            tick,
            text: `「${ent.name}」覆灭${f.reason ? `（${f.reason}）` : ''}`,
            kind: 'major',
        });
    }
}

// ★★leg34（小说家条款 §6 实施）：**实体字段写回** + **带因复活**（同一个通道）
//   用户 ⑤：「llm 有权决定任何字段，实力是可以增长的，性情是可以大变的，就连死亡在一个有复活的世界都可以改变」
//   ★这一笔让引擎**放弃"这值对不对"的判断权**，只保留"这变更有因、有痕、有额度"的核验（细案 §6.5 的真实代价，记在案）：
//     50 轮后可能出现"同一人实力变了三次、前后不一致"——引擎**一律照收**，因为承重墙写着"不裁胜负、不打分、不判对错"。
//     补救是**留痕**，不是判断：每条变更永久落账（值 + 因 + 轮次）⇒ 前后矛盾**可被发现**，但引擎不替世界仲裁。
//   ★"只许改现值、不许回改历史"在**形状上**就已经成立：本函数只写得回 `entity[field]` 一个现值格，
//     账上的事件/编年/里程碑**没有任何写通道** ⇒ 不需要额外判据（这是形状保证，不是口头纪律）。
function applyEntityUpdates(world, gstep, tick, warnings, chronicle) {
    const updates = gstep.entityUpdates || [];
    const stats = { applied: 0, revived: 0 };
    for (const u of updates) {
        const ent = (world.entities || []).find((e) => e.id === u.entity);
        if (!ent) continue;                                          // check 已拒（防御）
        const prev = ent[u.field];
        // 复核（check 已核，此处是"不信上游"的防御——照 applyEntityFates 的惯例）
        const ref = u.cause?.ref;
        const ev = u.cause?.type === 'event' ? (world.events || []).find((e) => e.id === ref) : null;
        const ag = u.cause?.type === 'agenda' ? (world.agendas || []).find((a) => a.id === ref) : null;
        if (ev?.closed || ag?.closed || (!ev && !ag)) {
            warnings.push(`裁定: 字段写回复核拒绝——「${ent.name}」的因「${ref}」不在账或已了结（因果只能挂在正在发生的事上）`);
            continue;
        }
        if (u.field === 'status') {
            // ★带因复活：与 `reactivateNamed`（只认 retired）互补——dead 需要"模型声明 + 被那件未了结的事点名"两把钥匙。
            //   ★闸②（本函数里的第二把钥匙）：**必须在本 tick 落账的编年里真的出现过这件因**。
            //     为什么：check 只核"ripples 里有他"，而 ripples 是**模型自己写的**；若那件因是**前几轮**的旧事件，
            //     模型可以把一个死人的 id 补进旧事件的波及名单……但旧事件本 tick 没上桌 ⇒ 这里直接拦住。
            //     口径：**复活和被点名必须发生在同一轮**（dead → 被一件"正在发生的事"重新拉回场上）。
            const thisTickNames = (gstep.newEvents || []).some((e) => (e.ripples || []).includes(ent.id));
            if (!thisTickNames) {
                warnings.push(`裁定: 复活复核拒绝——「${ent.name}」本 tick 没被新落账的事点名（复活必须与"被重新点名"同轮发生）`);
                continue;
            }
            if ((ent.status || 'active') !== 'dead') {
                warnings.push(`裁定: 复活复核拒绝——「${ent.name}」不是 dead（当前 ${ent.status || 'active'}）`);
                continue;
            }
            ent.status = u.value;
            ent.lastActiveTick = tick;                                // 复归即活跃（与 reactivateNamed 同口径）
            stats.revived += 1;
            chronicle.push({
                id: `ch_${tick}_rev_${ent.id}`,
                tick,
                text: `「${ent.name}」带着因由重回场上（${u.note || `因「${ev?.title || ref}」`}）`,
                kind: 'major',
            });
        } else {
            ent[u.field] = u.value;
            stats.applied += 1;
        }
        // ★留痕（细案 §6.3「原话不会丢」）：原值与现值同时在场、且能追到账。
        //   ★结构照 `entity-lookup.js:468` 的既有形状（`{value, from, fetchedAt}`）⇒ 两条路共用一份来源账，不各写一套。
        //   ★★`from` 是**出处双源**的落点（丙′ 案，用户拍板）：查书那条路写「书里原话」（发票），
        //     模型变更这条写「变更」+ 因 + 原值 ⇒ **同一个人身上"书里怎么说"与"后来怎么变"同时在场**。
        //     为什么必须有它：模型改了 `parent` 之后，`parentSourceFrom` 还写着 `member-line`（"书里成员行列了他"）
        //     就**不实了**——而出处发票不许模型填（伪造出处＝把编的说成书里写的）⇒ 只能由引擎**追加**一条变更记录。
        //     口径：**发票只增不改**（`fieldSource` 归引擎；模型每次变更在这里留一条带因的记录）。
        world.meta.entityFields = world.meta.entityFields || {};
        const rec = world.meta.entityFields[ent.id] ? { ...world.meta.entityFields[ent.id] } : {};
        const fieldsRec = { ...(rec.fields || {}) };
        const prior = fieldsRec[u.field] || null;
        // ★★出处双源（本棒实测抓出来的：第一版直接覆盖 ⇒ **把查书那条"书里原话"记录覆盖掉了 = 发票真丢了**）
        //   ⇒ 口径：**现值占主位、历史压栈**——`source` 恒等于"现值是谁写的"（现在的现值当然来自这次变更），
        //     而**原来那条记录整条进 `prior`** ⇒ "书里怎么说"与"后来怎么变"**同时在场、互不覆盖**。
        //     （不改 `entity.fieldSource`：那张发票是"书里原话"的证据，只由名册/查书写，本函数不碰。）
        fieldsRec[u.field] = {
            value: u.value, prev, cause: ref, causeType: u.cause?.type, tick, source: '变更',
            prior,                                   // ← 上一版记录（可能是查书的「书里原话」，也可能是上一次变更）
        };
        rec.fields = fieldsRec;
        world.meta.entityFields[ent.id] = rec;
    }
    return stats;
}

// K37 复归（细案 §3.7 → A-12）：被本 tick 落账事件点名（ripples 命中）→ retired 自动升回 active；
// 一条确定性规则不发明状态机；dead 终局不复归；编年「复归」一笔（kind ripple——被波及点名而起的反应）
function reactivateNamed(world, events, tick, chronicle) {
    const named = new Set();
    for (const ev of events || []) for (const r of ev.ripples || []) named.add(r);
    if (!named.size) return;
    for (const e of world.entities) {
        if (e.status !== 'retired' || !named.has(e.id)) continue;
        e.status = 'active';
        e.lastActiveTick = tick;
        const ev = (events || []).find((x) => (x.ripples || []).includes(e.id));
        chronicle.push({
            id: `ch_${tick}_rev_${e.id}`,
            tick,
            text: `「${e.name}」复归（被「${ev?.title ?? '事件'}」点名）`,
            kind: 'ripple',
        });
    }
}

// K37 背景化 GC（细案 §3.7 → A-12）：扫描轮（每 ENTITY_GC_SCAN_TICKS）——条件=无在飞盘算 + 无未决事件/链引用
// + 连续 ENTITY_IDLE_RETIRE_TICKS 轮未露面（**片3 起不再看分量**）→ status=retired
// （名录/指针全保留；编年「淡出」一笔，kind state——处境驱动）；依据册随退休清理（其名消账）。
// K45（full-roster-lens-spec C3 拍板）：**超席强制退已废除**（资格=在册，镜头管进出——用户 2026-09-09 拍板）——
// 闲置退休仍保留：长期没戏份的实体退二线（**仍在册**、可被点名复归），这是"镜头进出"的引擎侧实现。
// leg24 片3：判据里的分量地板已删（那个数用户已定不要）。
//   ⚠️ 两条边界（实测踩过，留档）：① **"没露过面"≠"久未露面"**——`lastActiveTick` 缺失 = 从没出过手
//   （书里读进来的名号就是这种）；若把它当 t0，新世界 t20 会把全册实体一次性退休（实测 K47 全量棋盘
//   active 346→0：镜头空转、应答机制失效）。故保留"必须有过活跃记录"这一条——退的是"曾经在场、
//   如今久未现身"的人，不是"还没上场"的人。② 上一版注释里"从没出过手也在 t20 退二线是设计要的行为"
//   是**错的判断**，被 K47 与重量冒烟两处读数当场证伪。
function retireInactive(world, tick, warnings, chronicle) {
    const canRetire = (e) => !(world.agendas || []).some((a) => a.owner === e.id && !a.closed)
        && !(world.events || []).some((ev) => !ev.closed && (ev.ripples || []).includes(e.id));
    if (tick % ENTITY_GC_SCAN_TICKS !== 0) return;
    for (const e of world.entities) {
        if (e.status && e.status !== 'active') continue;
        if (!canRetire(e)) continue;
        if (typeof e.lastActiveTick !== 'number' || tick - e.lastActiveTick < ENTITY_IDLE_RETIRE_TICKS) continue;
        e.status = 'retired';
        if (world.meta?.dialogueBook) delete world.meta.dialogueBook[e.name];
        chronicle.push({ id: `ch_${tick}_ret_${e.id}`, tick, text: `「${e.name}」淡出视野（久未现身）`, kind: 'state' });
    }
}

// ★★leg40b 续（**尺度上限参数化**）：读数口径统一到 `src/limits.js` 的 `resolveLimits(world)`——
//   账上设了档位就用档位，没设就用本文件这些**出厂默认**（`limits.js` 引用式取它们，不重写数字）。
//   口径与 `params.js` 一致：值落 `context.setting.dynamic.env`、白名单归一、缺键=用默认。
export function settleTick({ ssot, step, moveFact, calls = 1, preWarnings = [] }) {
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
    // ★leg40b 续（死锁修复·收尾一格）：**把"按位次认下来的同轮引用"改成引擎真发的号**。
    //   为什么必须在落账前做：`findEvent` 只是"认了它"，而落账用的是 `step` 里的原字符串——
    //   不改写 ⇒ 账上留一条悬空来路（本笔实测：模型写 ev_5_3、真号 ev_6_3，账上就记着 ev_5_3）。
    //   放在校验**之后**（校验读的是模型原话，报错信息才准确）、落账**之前**（改写要生效）。
    const stepN = normalizeSameStepEventRefs(step, tick);
    // ★leg40b 续（死锁修复 ③）：**降级路径的回执**——"这一轮为什么不是模型写的那一轮"必须进
    //   `stage.warnings`（面板裁定条 + `simLog` 都读它）。不给这个口子，那条降级就成了静默失败面。
    for (const w of preWarnings || []) warnings.push(w);
    // ★leg33c：位置集外的非致命留痕先收（`pre.warnings`）——玩家的这一步也要能看到"这本书的位置够不够"。
    for (const w of pre.warnings || []) warnings.push(w);
    const playerId = world.context?.playerId ?? null;   // K8/K9：玩家棋子标注（红线 1 代码化就位）
    const playerAffected = [];                          // K9：影响通道审计
    bookDialogue(world, moveFact, tick);                // K37：对话依据册记账（moveFact.object 命中）

    // ②' 主动作权门控（K2，细案 §3.2）：校验之后、裁定之前。滤除静默方主动作——不落账、不编年、不注入（双面无痕）；被点名可应答。
    // ★★leg32g：第 4 个参数＝**本轮待启用名单**（引擎机械选出、也随包递给模型的那 12 个）。
    //   为什么必须传进来：名单上的人按结构三条件是静默的 ⇒ 模型照名单给他开线也会被门控丢掉
    //   ⇒ 那份名单就成了空转（"规则与引擎判据必须对得上"）。传进来 ⇒ 他们获得**一次起头资格**。
    // ★★★leg63（用户令「我要把另外两个参数也设置成可调」）：这份名单的口径是**同一份**（包与门控同源），
    //   故这里的上限也必须读账上那个值 —— 否则包/面板递了 N 个人、门控只认前 `IDLE_FACES_TOP` 个
    //   ⇒ 名单上多出来的人"照名单开了线也会被门控丢掉"（那份名单就成了空转）。
    const spotlight = new Set(computeIdleFaces(ssot, resolveLimits(world).待启用名单).map((f) => f.id));
    const gate = gateWorldStep(stepN, ssot, moveFact, spotlight);
    // ★leg40b 续（死锁修复·收尾一格）：**把"按位次认下来的同轮引用"改成引擎真发的号**。
    //   位置必须在**门控之后**：`gate.js:87-93` 会丢掉"静默方属主的 plot 事件"⇒ 数组位次会变，
    //   而 `hangEvents` 是按**门控后**的位次发号 ⇒ 改写必须与发号看**同一个数组**，否则会指错人。
    //   （校验仍读模型原话 ⇒ 报错信息准确；这里只把"已经认下来的"写对。）
    //   不改写会怎样（本笔实测定到的真缺陷）：模型写 `ev_5_3`、真号 `ev_6_3` ⇒ 账上留一条悬空来路。
    const gstep = normalizeSameStepEventRefs(gate.step, tick);
    // ★leg40b 续：生效上限**在入口解析一次**，之后全文件都用它（防"某条路仍读旧常量"）。
    const lim = resolveLimits(world);
    // K14 出生裁判（盘算树细案 §3.2 落点：gate 之后、裁定之前）：GC 上限 → 落账 → 挂因/委派留痕 → 环检测自动拆
    const spawned = spawnAgendas(world, gstep, tick, warnings, chronicle, lim);

    // leg25 c：`hurtByEntity`（属性负向 δ 收集）随属性裁定一并删除——没有负向 δ 可收。
    // leg25 f：原来这里还有一段"把旧账残留的 hurtWindow 滑零自删"的补丁。**整段删除**——
    //   那段之所以存在，是因为当时还想让窗口"自己归零后消失"；既然该键已从 schema 摘掉、消费者
    //   （败露判据）也已删除，残留就该**在载入时无条件摘除**（`migrateLegacyAttrs`，与 attrs 同一口）。
    //   留着滑零块等于把"死字段"在账上多留几轮——正是"删字段只删一半"那类病的温床。
    if (!adjudicate(world, gstep, tick, warnings)) {
        // 不可达（check 已过），防御
        return { ok: false, ssot, stage: { warnings, chronicle } };
    }
    const born = spawnEntities(world, gstep, tick, warnings, chronicle, lim);   // K37：入局提议落账（校验先行——裁定后再落账，重名自反不误伤）
    // K19 事件产率上限（因果链细案 §3.2 → A-2）：按提议序保留前 ≤N，超限拒建 + 警告（"事件洪峰"——与盘算大厦顶
    // 同哲学：双面无痕于世界，留痕于 simLog）；门控后、影响通道前——被拒不涉影响/挂链/编年
    // ★leg40b 续：这个上限现在**可调**（`每轮事件`：6/9/12 ⇒ `lim.每轮事件`），账上没设档位时 = 出厂 6（逐字不变）。
    if (gstep.newEvents.length > lim.每轮事件) {
        const kept = gstep.newEvents.slice(0, lim.每轮事件);
        for (const ev of gstep.newEvents.slice(lim.每轮事件)) {
            warnings.push(`裁定: 事件洪峰（每 tick ≤${lim.每轮事件}）：「${ev.title}」被拒`);
        }
        gstep.newEvents = kept;
    }
    const events = hangEvents(world, gstep, tick);
    // K9 影响通道：引擎独占写玩家（他人 targeting / 新事件波及 → 分量比影响，落账在重算前——分量当轮反映）
    // leg25 c：K9 影响通道（被人打/被事件波及 → 扣玩家的属性）**随属性一并删除**——
    //   它扣的是 hardPower/各 attrs，而账上已经没有这些数了。
    //   红线 1（引擎独占写玩家）本身不变，只是"写"的内容没了；`playerAffected` 记录照旧留着
    //   并照旧进 simLog（审计面不缩水——它的语义是"世界伸手碰了玩家"，将来若有了新的可写事实，
    //   仍从这条通道走、仍写这里）。
    checkConsistency(world, gstep, warnings);
    // K3 活跃记账：落账主动作方（actions/盘算推进/plot 事件属主）记 lastActiveTick；被打击/被波及的客体不计
    // K11 玩家同尺：有落子轮（moveFact.verb 非空）= active；OOC/静默轮不记 → 站桩权力照萎缩（长跑 §2.3）
    const agendaOwner = new Map((world.agendas || []).map((a) => [a.id, a.owner]));
    const activeIds = new Set();
    for (const a of gstep.actions) activeIds.add(a.entity);
    for (const ad of gstep.agendaAdvances) { const o = agendaOwner.get(ad.agendaId); if (o) activeIds.add(o); }
    for (const ev of gstep.newEvents) { if (ev.source?.type === 'plot') { const o = agendaOwner.get(ev.source.ref); if (o) activeIds.add(o); } }
    for (const na of spawned) activeIds.add(na.owner);   // K14：提议并落账 = 活跃（与 gate 滤除语义对称——静默方提议被滤=不活跃）
    for (const e of born) activeIds.add(e.id);           // K37：入局 = 活跃（lastActiveTick 落账）
    if (playerId && moveFact?.verb) activeIds.add(playerId);
    for (const e of world.entities) { if (activeIds.has(e.id)) e.lastActiveTick = tick; }
    recomputeWeights(world, tick);
    updateTensionIntensity(world, tick);   // K29 张力强度（细案 T3：事件频次×分量比×衰减；引擎确定性计算，模型不拍）
    const cancelledIds = applyAgendaCancels(world, gstep, tick, chronicle);   // K22 取消裁决（细案 §3.5 → A-5；先于推进——被取消者当 tick 推进落 closed 拦截）
    const closedIds = applyAgendaAdvances(world, gstep, tick, chronicle, warnings);
    for (const id of cancelledIds) closedIds.add(id);   // 取消集并入联闭（取消 = 终结产果路径之一）
    pushTidePeak(world, closedIds, tick);   // K29：盘算浪尖派生（细案 §3.6②——顶层终结/取消 → derivedFrom 浪尖项，A-5 两来源之一）
    closeEvents(world, closedIds, tick, chronicle);   // 闭环三型：源结清（K9 执行债）+ 链尾结清（K19）+ 取消联闭（K22）
    applyEntityFates(world, gstep, tick, warnings, chronicle);   // K37 灭通道：覆灭复核落账（在闭环后——尘埃落定再言灭）
    // ★leg34（小说家条款 §6）：字段写回 + 带因复活。位置在 `reactivateNamed` **之前**：
    //   复活与"被点名复归"是同一件事的两种入口（dead 要模型声明，retired 自动），先落后者就好。
    applyEntityUpdates(world, gstep, tick, warnings, chronicle);
    pulseEntropy(world, tick, chronicle);   // K27 熵泵（细案 §3.5 → A-6）：环境推演器每 ENV_TICK 一步；越阈落状态源事件；恢复闭环
    reactivateNamed(world, events, tick, chronicle);   // K37 复归：本 tick 落账事件点名 → retired 升回 active
    retireInactive(world, tick, warnings, chronicle);  // K37 背景化 GC：扫描轮条件退休 + 超席位强制（守卫）
    // ★★leg53（用户令「引擎每轮从账上真发生的事推一个档位」）：**乱象的生产者**——
    //   `updateUnrestGear` 是纯函数（返回新世界），而本函数（`settleTick`）全程**就地改 `world`**
    //   （上面每一行都是 `applyX(world, …)` 那种写法）⇒ 这里把结果**装回**同一个对象，
    //   免得两条"引擎每轮写"的路一个改入参、一个返回新值（同一件事两种写法＝本仓老病）。
    //   ★位置：放在 `retireInactive` **之后**——那个函数会改实体的 `status`，而本机制的数
    //     派生自**事件**（此时已全部落账），放末尾保证"读的是这一轮最终那份账"。
    //   ★它只写 `env.动乱度` 一个键（判据 E 条锁着"不动别人的键"）。
    {
        const next = updateUnrestGear(world, tick);
        if (next !== world) world.context.setting.dynamic = next.context.setting.dynamic;
    }
    chronicleEvents(world, gstep, tick, chronicle);
    world.chronicle = [...world.chronicle, ...chronicle];   // 编年落账（推进留痕 + 事件条目）
    archiveClosedEvents(world, tick);   // K20 档案摘要化（细案 §3.3 → A-3）：闭环满热窗 + 整链结清 → 里程碑温层（零编年零注入）

    const pack = buildEvolutionPack(world, moveFact || null);
    // K38 观测台：拒签率分子/分母记账（铁律 8：先有数，后说话）
    // leg25 c：`stateChanges` 已从世界步契约删除 ⇒ 从分母里**移除**（留着恒为 0，会让分母少算一项——
    //   "删字段只删一半"的典型残留）。同处 `rejected` 的死过滤 `!w.includes('入局属性钳制')` 一并删除
    //   （那条警告已不可能产生）。
    const proposals = ['actions', 'newEvents', 'agendaAdvances', 'newAgendas', 'agendaCancels', 'newEntities', 'entityFates', 'entityUpdates']
        .reduce((n, k) => n + (stepN[k]?.length ?? 0), 0);
    // ★leg32f：`提议丢弃:` 并入拒签分子——它在语义上与"裁定拒"同类（模型提了、世界没落账），
    //   漏掉它会让拒签率**低估**（丢掉的东西不计入分子 ⇒ 读数失真）。
    const rejected = Object.values(gate.droppedCounts).reduce((a, b) => a + b, 0)
        + warnings.filter((w) => w.startsWith('裁定:') || w.startsWith('校验拒绝:') || w.startsWith('提议丢弃')).length;
    recordMetrics(world, tick, pack.estTokens, calls, warnings, chronicle, gate, playerAffected, proposals, rejected);

    return { ok: true, ssot: world, stage: { chronicle, warnings, events } };
}