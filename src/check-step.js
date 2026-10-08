// story-world-v2/src/check-step.js
// 世界步语义校验（S4）：真 schema 强制（形状）+ 身份/因果/位置/波及（语义）。
// 事件源三类与无源拒绝（§4.2）、事件位置合法性切片版（§3.2）在此落实。
import { validate } from './schema.js';
import { checkEventContract, applyConditionUpdates } from './event-contract.js';
import { worldStepSchema } from './schemas/world-step.schema.js';
import { isSettingRef } from './setting.js';   // K25：设定池保留键空间判词
import { RIPPLE_TARGET_CAP } from './weight.js';   // leg25：波及上限唯一真源（此前该上限生产 0 强制点=纸面机制）
import { checkAgendaInvolvement } from './entity-lookup.js';   // 细案 §6 R2：单盘算一轮涉及实体 ≤15（唯一真源）
import { normalizePosition } from './position.js';   // leg33：剥掉引擎自己打在 location 列上的「（推）」注解（叶子模块，无环）
import { isProtectedForStep, currentTurnProtection } from './simulation-protection.js';
// ★★★leg163：这里原先 import 了 `pack.js` 的 `buildScaleTableIndex`/`sanitizeScaleRequests`/
//   `SCALE_ONDEMAND_TOP`（leg64 那条"按需查表"要拿它们核表名）。那一族已随「全塞」整族撤走
//   ⇒ 本文件**不再 import `pack.js`**（撤走前那段注释担心的"无环"从此更不成问题）。
// ★★★leg128：**点名取回一条故事线**（与刻度表那条按需通道同构）——净化要用的两把纯函数。
//   ★只 import 叶子模块（`lines.js → setting.js`）⇒ 不成环。
import { linesOf, lineIndexOf, sanitizeLineRequests, LINE_ONDEMAND_TOP } from './lines.js';
// ★★★leg67（甲案 · 用户 2026-09-18 拍板）：**引用完整性收成单一主人**。
//   判据（"这个号在此时此地能不能这么用"）与 id 解析全部住进 `src/ref-rules.js`（零 import 的叶子模块）；
//   本文件**只留渲染**（`$.foo[i].source: <判据文案>`）与结构/身份/额度类校验。
//   ★为什么必须收口：同一套规矩原先在本文件与 `sanitize-step.js` 各手写一份，**已实测长歪**——
//     `newEntities.source.type==='entity'` 引已灭实体：本文件**拒整步**（世界原样不动），
//     净化器**只丢那一条**（其余照落）。同一份输入、两个引擎侧关口、两种后果。
//     细案 `docs/plan-structure-optimization.md` §1.3：leg66 两天三条 bug 同一个根，全在这里。
//   ★依赖方向仍是树：`ref-rules.js` 零 import ⇒ 不引入环（与 `position.js` 同为叶子）。
import { judgeRef, renderVerdict, resolveRefTarget, eventOrdinal, newEventIdsOf } from './ref-rules.js';
// ★`newEventIdsOf` 从本文件 re-export（实现已搬进 `ref-rules.js`）：`settle.js` 与既有用例的 import 面不动。
export { newEventIdsOf } from './ref-rules.js';
// leg25 c：属性白名单（INBORN_ATTR_KEYS）随 `stateChanges` 整条删除——四维浮点已不存在，没有键可白名单。

/** ★leg67（甲案）：判一个引用、并把**判据文案**渲染出来。
 *  渲染刻意留在本文件——校验面的输出是 `$.foo[i].source: <判据文案>`，与净化器的"丢掉理由"不同形。 */
const verdictOf = (point, source, ctx) => {
    const v = judgeRef(point, source, ctx);
    return v ? renderVerdict(v) : null;
};

// ★★★leg112（D1 · 用户 2026-09-22 拍板「我认为直接取消上限」）：**「每轮至多 3 条字段变更」已整条撤除。**
//   原值 `export const FIELD_UPDATE_PER_TICK = 3;`（自认**提案态**、一条曲线都没出，却拦了十几棒）。
//   撤前实测（真账三份约 119 轮，只读副本）：模型落账的字段变更 **1 条**、那条上限**一次没被撞到**；
//   `meta.entityFields` **12.8 KB**＝账本 **0.2%**、每条留痕 **130 字节** ⇒ 撑不爆账（详见当棒交接 §D1）。
//   ★撤的**只是条数**：「有因 / 有痕 / 不越界」一条没动。★两处同批撤（本处 + `sanitize-step.js` 的静默截断）。
// ★★leg34 丙′ 案（用户拍板「可以。那就按你说的来」）：**禁写名单只留"有专用通道"与"纯引擎簿记"两类**。
//   判据（**尺子只有一把**：这栏有没有专用通道 / 是不是引擎自己的账）：有专用通道的走它自己的门，
//   引擎簿记的不许伪造，**其余全开**——包括剧情将来长出来的任何新栏（`性情`/`心境`/`称号`/`伤势`…）。
//   逐条理由（每条都是机械的，不是口味）：
//     · `id`   —— 主键：改它 = 换一个人，账上所有引用当场全断。
//     · `kind` —— **类型契约**：势力/角色两套字段语义不同（`规模` 只对势力、`实力` 只对角色）⇒ 翻转它 = 账本语义错位。
//     · `name` —— **身份锚**：重名守卫、名册对齐（`resolveByName` 唯一命中）、对话依据册**全按名字走**
//                 ⇒ 改名会静默破坏三条既有机制（面板/门控/抽书全在按名字找它）。
//     · `lastActiveTick` —— 纯引擎簿记，**与剧情无关**：伪造出手史 ⇒ 影响静默门与静止衰减。
//     · `fieldSource` / `parentSource` / `parentSourceFrom` —— **出处发票**（"这句是书里原话"的凭据，面板标「（书）」）：
//                 模型填它 = 伪造出处（把编的说成书里写的）⇒ 正好撞上"编数"那条禁令。
//                 ★出处**不由模型填，由引擎按变更追加**（`meta.entityFields` 记 `{value, prev, cause, tick, source}`）。
//   ★★`status` **故意不在本名单里**（本棒踩过这个坑，留档）：
//     第一版把它写进名单想"避免两条通道打架"，结果——**把带因复活整个关掉了**（复活正是改 `status`）。
//     教训：**清单式黑名单会把"有专用规则的字段"一起挡死**。`status` 的正确管法是**字段专属严规则**
//     （见下方 `u.field === 'status'` 段：必须 dead + value 必须 active + 必须本回合有事件点到他）
//     —— 那比黑名单**更严也更准**：黑名单只会说"不可改"，专属规则说得清"怎么改才算数"。
//   ★放开的（剧情真正会改的那批）：`location` · `race` · `实力` · `身份` · `定位` · `性质` · `倾向` · `规模` ·
//     `parent`（改换门庭／叛投／被吞并）· `branches` · `organs` · `status`（仅带因复活）· **+ 任何新栏**。
//     `location` 为什么也放：位置线冻结的是"**位置集当闸**"与集合本身，而 `entities[].location` 是**自由文本、
//       零机制消费者**（不筛选、不约束交互）⇒ 改它**没有任何机制后果**，也没有专用通道可撞。
export const ENTITY_IMMUTABLE_FIELDS = ['id', 'kind', 'name', 'lastActiveTick', 'fieldSource', 'parentSource', 'parentSourceFrom', 'simulationBlocked'];
// ★leg34 撤回留档（**别再往回做**）：本棒曾实现 `fieldQueries` = "模型在世界步里点名要查哪个字段，引擎下一轮回灌"。
//   用户 2026-09-13 追问「为什么聊天 llm 能够直接获取想要的世界书内容呢还能通过向量化搜索直接在插件里搜到呢
//   都是一轮解决的啊，也没有产生额外的文件」⇒ **那套是错的方向**：
//     ① ST 的关键词世界书与 `yuzuki-Memory` 的向量召回都是**系统在模型开口之前**把书塞进提示词
//        （模型根本没有"主动搜索"这个动作）⇒ **一轮可见、零额外调用、零跨轮状态**；
//     ② 我那套把顺序做反了（模型先问 → 结算后才检索）⇒ 值**晚一轮**才到眼前，还要跨轮存待办与清理。
//   ⇒ 已撤：曾改用 `src/recall.js` 的**出包前检索注入**（与 ST 同一条思路，当轮可见）。见 `runTick` 的 `preStep`。
//     ★★★leg125：那条注入后来自己也被拆了（**leg122**：实测它检索到的从来不是世界书）——
//       本笔连 `src/recall.js` 模块一起删除（用户令「直接删了」）⇒ **世界模型这一侧不再有任何"来自正文"的输入**。

// ids 索引
function indexIds(ssot) {
    const entityIds = new Set((ssot.entities || []).map((e) => e.id));
    const agendaIds = new Set((ssot.agendas || []).map((a) => a.id));
    const eventIds = new Set((ssot.events || []).map((e) => e.id));
    const positions = new Set(ssot.context?.positions || []);
    return { entityIds, agendaIds, eventIds, positions };
}

// ★★leg40b 续·死锁修复（甲）：**本轮新建的未决事件，也是"已存在"的**。
//
// 病灶（交接 §4.2 抓到的"世界永久停摆"，本笔把机制追到源头）：
//   `settleTick` 的纪律是**先校验、后落账**（`settle.js:840`），所以校验这一刻，
//   本轮 `step.newEvents` **还不在** `ssot.events` 里。于是模型"在本轮里新建一件事件 +
//   为这件事起一条盘算"（`newAgendas.source={type:'event', ref:'ev_X'}`）**必然被判未知**
//   ⇒ 整步被拒 ⇒ **tick 不推进** ⇒ 下一轮读回同一份账、递同一个包 ⇒ 它又引那个 id ⇒ **永久停摆**。
//
// 而落账侧**本来就允许**这件事（这也是修复只需改校验一格的原因）：
//   `settle.js:864` 的 `spawnAgendas` 跑在 `settle.js:885` 的 `hangEvents` **之前**
//   ⇒ 盘算出生时那批新事件**尚未闭环**，作盘算之因名正言顺（K13 语义，`test/birth.test.js` 锁着）。
//
// 三条边界，写死免得下一棒改歪：
//   · **只有 `newAgendas` / `newEntities` 两处享用**它——它们的语义是"由**正在发生**的事而生"。
//   · ★**`entityFates` 明确不享用**（见该段注释）：覆灭要求"**已了结**（尘埃落定）"，
//     把本轮新建的未决事件并进去，等于把一条**刻意设的闸**静默拆掉。
//   · **同轮事件恒为未决态**（`closed:false`，且 `tick` 刚出生 ⇒ `archiveClosedEvents` 的
//     `hotWindow=20` 够不着）⇒ 那两个"必须未决"的判据仍然有效，只是**不再永远判未知**。
//
// ★★**为什么"按位次解析"是必须的，而不是宽容**（本笔读到的一条结构性事实）：
//   `newEvents` 在契约层是**封闭形状**（`additional:false` ⇒ **不许写 `id`**，实测报"未知字段"），
//   而提示词第 7 条要求 `newAgendas` 的 `ref` = **输入里的事件 id**。
//   ⇒ **模型在结构上无法知道"本轮即将新建的那件事"会被发什么号**（它只能看包里的旧 id 去猜）。
//   于是"同轮引用"唯一可靠的解析方式就是**位次**：第 i 件事 ⇒ 模型说的号解析到 `step.newEvents[i]`。
//   这也是它救得回 wide 臂那个停摆的原因：模型写 `ev_5_3`（它以为是 5 轮）而引擎记的是 6 轮——
//   按位次解析，说的就是同一件事。
/** 本轮新事件**将要拿到的 id**（引擎的发号规矩）。
 *  ★leg67：**实现已搬进 `ref-rules.js`**（那条规矩与"按位次解析"是一对，必须同住一处）；
 *  本文件 `import` 它、并 re-export ⇒ `settle.js`、净化器与既有用例的取值面一个字不动。 */

/**
 * ★leg40b 续（死锁修复·**这一步不能省**）：把"按位次认下来的同轮引用"**改写成引擎真发的号**。
 *
 * 为什么必须改写（本笔实测抓出来的真缺陷，不是理论担忧）：
 *   模型写 `ev_5_3`（它以为还是第 5 轮），引擎这一轮记的是第 6 轮、真号是 `ev_6_3`。
 *   若只在校验层"按位次认了它"就算完，落账时 `spawnAgendas` 会**原样**把 `ev_5_3` 写进账
 *   ⇒ 账上留一条**指向不存在事件的来路**（悬空引用）。世界不停摆了，但账本丢掉连续性——
 *   那正是这套引擎最不该出的东西（引擎是账房：引用必须指得着）。
 *   ⇒ 口径：**认了它，就把它写对**。校验（`findEvent`）与改写共用同一条位次规则。
 *
 * 边界：只改 `newAgendas.source` / `newEntities.source` 两处（与甲同面），且**只改能解析的那部分**
 *   （解析不出来的原样留着 ⇒ 交给校验如实向模型报错，不在这里替它猜）。
 * @returns {object} 改写后的 step（**不改原对象**，与 settle 的拷贝语义一致）
 */
export function normalizeSameStepEventRefs(step, tick) {
    const list = step?.newEvents || [];
    if (!list.length) return step;
    const ids = newEventIdsOf(step, tick);
    const map = new Map();
    const add = (x) => {
        const ref = x?.source?.type === 'event' ? x.source.ref : null;
        const ord = eventOrdinal(ref);
        if (ord != null && ord >= 1 && ord <= list.length) map.set(ref, ids[ord - 1]);
    };
    (step.newAgendas || []).forEach(add);
    (step.newEntities || []).forEach(add);
    if (!map.size) return step;
    const fix = (x) => {
        const ref = x?.source?.type === 'event' ? x.source.ref : null;
        return ref && map.has(ref) ? { ...x, source: { ...x.source, ref: map.get(ref) } } : x;
    };
    return {
        ...step,
        newAgendas: (step.newAgendas || []).map(fix),
        newEntities: (step.newEntities || []).map(fix),
    };
}

/** 事件查找：**世界账优先**，找不到再看本轮新建的那批。
 *  ★leg67：本函数退化成一层"取 `.target`"的薄壳——**真正的解析只有一处**（`ref-rules.js` 的
 *    `resolveRefTarget`），校验与净化器共用它（两把尺子会长歪，见 `sanitize-step.js` 头注）。
 *  ★同轮那半用的是**位次解析**（见上方长注）：模型写 `ev_<任意轮号>_<m>` ⇒ 落到本轮第 m 件事上。
 *    只有两个条件同时成立才认：① 世界账里**没有**这个 id（有则以账为准）；② 位次落在本轮 `newEvents` 范围内。 */
export function findEvent(step, ssot, ref) {
    return resolveRefTarget(ssot, ref, { step, includeSameRound: true, includeArchived: false }).target;
}

export function checkWorldStep(step, ssot) {
    const errors = [];
    const warnings = [];   // ★leg33c：非致命留痕面（与 errors 分开——见下 ④ 位置段）
    const world = ssot;   // 别名：本函数沿用 ssot 命名，涉及面计算读 world.agendas/events

    // ① 形状：真 schema 强制
    const r = validate(step, worldStepSchema);
    if (!r.ok) return { ok: false, errors: r.errors, warnings: [] };
    for (const [i, ev] of step.newEvents.entries()) errors.push(...checkEventContract(ev, step.eventProtocol, ssot).map(e => `$.newEvents[${i}]: ${e}`));
    if (step.conditionUpdates !== undefined) {
        if (step.eventProtocol !== 4) errors.push('$.conditionUpdates: 必须声明 eventProtocol:4');
        else {
            const temp = JSON.parse(JSON.stringify(ssot));
            const ids = newEventIdsOf(step, (ssot.meta?.tick ?? 0) + 1);
            temp.events.push(...step.newEvents.map((ev,i) => ({...ev,id:ids[i]})));
            const resolveEventRef = ref => (ssot.events || []).some(e => e.id === ref) || (ssot.milestones || []).some(m => (m.ids || []).includes(ref)) ? ref : ids[(eventOrdinal(ref) || 0)-1] || ref;
            const checked = applyConditionUpdates(temp, step.conditionUpdates, { resolveEventRef });
            for (const bad of checked.rejected) errors.push(...bad.errors.map(e => `$.conditionUpdates[${bad.index}]: ${e}`));
        }
    }

    // 位置可省；填写了就要在归一后仍有地点，不能先放行空格再把它变成非法空串。
    for (const [i, ev] of step.newEvents.entries()) {
        if (ev.position != null && !normalizePosition(ev.position)) {
            errors.push(`$.newEvents[${i}].position: 归一后没有地点（无法确定请省略该字段）`);
        }
    }
    if (errors.length) return { ok: false, errors, warnings };

    const { entityIds, agendaIds, eventIds, positions } = indexIds(ssot);
    const playerId = ssot.context?.playerId;   // K8：玩家棋子标注（红线 1 代码化）
    const protectedRole = id => isProtectedForStep(ssot, id);
    const protectionText = id => id === playerId ? '模型禁写玩家（红线 1；玩家不可改、玩家不可灭）' : '模型禁写受保护角色（禁止模拟或本轮已经行动）';

    // ② 身份：动作/状态变更挂存在的实体；盘算推进挂存在的盘算
    //    K8 禁写规则（优先于未知实体检查）：模型禁写玩家——actions 涉 playerId 一律拒绝，世界如实不动
    for (const [i, a] of step.actions.entries()) {
        if (protectedRole(a.entity)) errors.push(`$.actions[${i}].entity: ${protectionText(a.entity)} "${a.entity}"`);
        // ★★★leg67 甲-余：行动方存在性收进判据表（`'actions.entity'`）——原先与净化器各写一份。
        //   ⚠紧邻上面那条**不是**同一件事（那条是红线 1 的"禁写玩家"，读 `context.playerId`）。
        {
            const v = verdictOf('actions.entity', { type: 'id', ref: a.entity }, { world: ssot, step });
            if (v) errors.push(`$.actions[${i}].entity: ${v}`);
        }
    }
    // ★leg32h（用户：「又把主角演了」）：**禁写玩家的面上加一条——不许推进玩家的盘算**（见 ②b' 段落的实现）。
    //   为什么放在 ②b'：它属于"身份/因果"校验（盘算属主 == 玩家），与 agendaAdvances 的形状校验同段。
    // leg25 c（用户令「删」）：`stateChanges` 的整段校验（玩家禁写 / 未知实体 / 属性白名单 / actor 在册）
    //   随契约层该字段一并删除——四维浮点不存在了，没有属性变更可校验。

    // ②b 盘算树（K13/T1）：新盘算提议——实体存在；event 源必引未决事件；parent 源必引在飞盘算；state 源不带 ref
    // （环检测在出生落账时由引擎做——K14；此处只校验引用合法，无源之物不存在）
    for (const [i, na] of (step.newAgendas || []).entries()) {
        // K14（K13 施工补差）：模型禁写玩家三通道完整——行动/状态变更（K8）+ 新盘算提议（玩家是棋子不是模拟主体，盘算树细案 §2）
        if (protectedRole(na.entity)) errors.push(`$.newAgendas[${i}].entity: ${protectionText(na.entity)} "${na.entity}"`);
        // ★★★leg67 甲-余：属主存在性也收进判据表（`'newAgendas.entity'`）——它原先与净化器各写一份。
        {
            const v = verdictOf('newAgendas.entity', { type: 'id', ref: na.entity }, { world: ssot, step });
            if (v) errors.push(`$.newAgendas[${i}].entity: ${v}`);
        }
        // ★leg40b 续（甲）：同轮引用是合法写法——`ref-rules.js` 的 event 格在解析时并进"本轮新建的那批"。
        // ★★★leg67（甲案）：**这一段的判据整体搬进 `src/ref-rules.js` 的 `'newAgendas.source'` 表**
        //   （含 leg64 第五轮那条"存在但已了结 ≠ 不存在"的分开报、以及 leg66 第二条裁定补的那**三条出路**）。
        //   本文件只剩两行渲染——**判据文案不再在这里手写**（M2 源码锁扫的就是"这里有没有手写判词"）。
        //   ★本仓实测过两把尺子会长歪，故 `state`/`parent`/`event` 三型现在都由同一张表回答。
        //   ★`if (stype === ...)` 那圈分派也一并删了：分派住进表里（源型 ⇒ 那一格），本文件不挑源型。
        const v = verdictOf('newAgendas.source', na.source, { world: ssot, step });
        if (v) errors.push(`$.newAgendas[${i}].source: ${v}`);
        // 子盘算会写父盘算的承诺并记为父属主委派；不能借普通 NPC 替受保护角色作决定。
        if (na.source?.type === 'parent') {
            const owner = (ssot.agendas || []).find(a => a.id === na.source.ref)?.owner;
            if (protectedRole(owner)) errors.push(`$.newAgendas[${i}].source: ${protectionText(owner)}；不可通过子盘算替其委派或承诺`);
        }
    }
    for (const [i, ad] of step.agendaAdvances.entries()) {
        // ★leg67（甲案）：判据搬进 `src/ref-rules.js` 的 `'agendaAdvances.agendaId'` 表。
        {
            const v = verdictOf('agendaAdvances.agendaId', { type: 'id', ref: ad.agendaId }, { world: ssot, step });
            if (v) errors.push(`$.agendaAdvances[${i}].agendaId: ${v}`);
        }
        // ★leg32h（用户：「又把主角演了」）：**红线 1 补一个缺口——不许推进玩家的盘算**。
        //   实测机制（真账 tick 50）：玩家棋子叫「你」（`attachPlayerPiece` 初始化时没拿到玩家名），
        //   而主角「黄坤」在 t42 被模型当**新实体**入局（`e_42_1`）⇒ 世界账里两个平行的人
        //   ⇒ 模型很尽责地替黄坤开了盘算并**一轮轮推进**（done 里全是"以雷法锁定薛铁衣气机、展开殊死搏杀"
        //   这类**玩家自己的选择**）。既有四条守卫只拦"提议"（actions/newAgendas/newEntities/entityFates），
        //   **没拦"推进"** ⇒ 账上只要已有属于玩家的盘算（旧账/合并前遗留），模型就能一直替玩家演下去。
        //   本条堵上：**玩家的盘算不由模型推进**——玩家那一步只由玩家自己的落子进入世界。
        const owner = (ssot.agendas.find((a) => a.id === ad.agendaId) || {}).owner;
        if (protectedRole(owner)) {
            errors.push(`$.agendaAdvances[${i}].agendaId: ${protectionText(owner)}；不许推进其盘算 "${ad.agendaId}"`);
        }
    }
    // ②c 取消通道（K18/因果链 T5）：提议放弃——agendaId 必须存在且未结算（"已结算盘算不可取消"）；
    // 模型只有提议权，裁决归引擎；按盘算属主检查保护，不能借取消通道替角色决定。
    for (const [i, ac] of (step.agendaCancels || []).entries()) {
        // ★leg67（甲案）：判据搬进 `src/ref-rules.js` 的 `'agendaCancels.agendaId'` 表
        //   （"未知盘算" / "已结算盘算不可取消"两句原先手写在本文件里——它就是"同一个号能不能这么用"）。
        const v = verdictOf('agendaCancels.agendaId', { type: 'id', ref: ac.agendaId }, { world: ssot, step });
        if (v) errors.push(`$.agendaCancels[${i}].agendaId: ${v}`);
        const owner = (ssot.agendas.find(a => a.id === ac.agendaId) || {}).owner;
        if (protectedRole(owner)) errors.push(`$.agendaCancels[${i}].agendaId: ${protectionText(owner)}；不许取消其盘算`);
    }

    // ②d 实体治理（K37/细案 §3.7 → A-10/A-11）：入局提议（newEntities）与覆灭提议（entityFates）语义校验
    //   源三型命中账：book=书名录（frozen.canon.bookEntities）/ event=未决事件 / dialogueFact=对话依据册（meta.dialogueBook）
    const bookNames = new Set((ssot.context?.setting?.frozen?.canon?.bookEntities || []).map((b) => String(b?.name || '')));
    const booked = new Set(Object.keys(ssot.meta?.dialogueBook || {}));
    for (const [i, ne] of (step.newEntities || []).entries()) {
        if (protectedRole(ne.entity)) errors.push(`$.newEntities[${i}].entity: ${protectionText(ne.entity)}；不可作为入局提议者`);
        // ★★★leg67 甲-余：提议者存在性收进判据表（`'newEntities.entity'`）。
        //   ★`ne.entity &&` 这个**前置守卫不能省**（本棒实测栽过一次）：提议者**可省**
        //     （`world-step.schema.js` 里 `entity` 不在 required 里，dialogueFact 源可省略）
        //     ⇒ 没写提议者不是"未知提议者"。判据表只答"这个号在不在账上"，"这一格该不该判"归消费口。
        const vProposer = ne.entity
            ? verdictOf('newEntities.entity', { type: 'id', ref: ne.entity }, { world: ssot, step })
            : null;
        if (vProposer) errors.push(`$.newEntities[${i}].entity: ${vProposer}`);
        if (!ne.source?.type || !ne.source.ref) {
            errors.push(`$.newEntities[${i}].source: 无源不入局——新实体必须带源引用（book/event/dialogueFact/entity）`);
            continue;
        }
        // ★★★leg67（甲案）：四型（book/event/dialogueFact/entity）的判据整体搬进
        //   `src/ref-rules.js` 的 `'newEntities.source'` 表——含 leg64 第五轮那条"存在但已了结 ≠ 不存在"、
        //   leg32i 那条"错误信息不许再说假话"（dialogueFact 按**三种真实情况**分别报）、
        //   leg32e 那条 entity 源的两条硬闸（在册 + 未灭）。本文件只剩一行渲染。
        const v = verdictOf('newEntities.source', ne.source, { world: ssot, step, bookNames, booked });
        if (v) errors.push(`$.newEntities[${i}].source: ${v}`);
        // ★leg32f（用户实机：「$.newEntities[0].name: 账上已有同名实体「白小娥」（已有者不重建）」整步被拒）：
        //   ① 同名**不再报致命错**——账上已有的那个人本来就在册，**丢掉这条提议对世界零损害**；
        //      旧法把它判成"世界步不合法"⇒ 整轮（连同玩家这一轮的行动）一起陪葬。丢掉由 `settle.js`
        //      的 `spawnEntities` 静默执行 + **留痕警告**（不许静默：丢弃也要能被看见、被计数）。
        //   ② 位置**不再报致命错**——模型编了个不在集内的地名，不等于"这个人不该存在"；
        //      由 `spawnEntities` 归一到 `未明`（空着就是空着）+ 留痕警告。
        //   两条都遵同一口径：**"提案被丢掉" ≠ "世界步不合法"**——后者才该拒整步。
        //   ⚠仍然**致命**的（不许陪葬的反而）：未知提议者 / 无源 / 源 ref 不存在（那是真的凭空造人）。
        // leg25 c：入局 `attrs`（四维浮点提议）的校验整段删除——契约层该字段已删（四维不存在）。
    }
    for (const [i, f] of (step.entityFates || []).entries()) {
        const ent = f.entity && ssot.entities.find((e) => e.id === f.entity);
        // ★★★leg67 甲-余：目标存在性收进判据表（`'entityFates.entity'`）。
        //   ⚠"玩家不可灭"与"已覆灭不重复覆灭"是**别的判据**（红线 1 / dead=终局），照旧留在这里。
        if (verdictOf('entityFates.entity', { type: 'id', ref: f.entity }, { world: ssot, step })) {
            errors.push(`$.entityFates[${i}].entity: 未知实体 "${f.entity || ''}"`);
            continue;
        }
        if (protectedRole(f.entity)) errors.push(`$.entityFates[${i}].entity: ${protectionText(f.entity)}；不可覆灭`);
        if ((ent.status || 'active') === 'dead') errors.push(`$.entityFates[${i}].entity: 已覆灭实体不重复覆灭（dead=终局）`);
        if (!f.source?.ref) {
            errors.push(`$.entityFates[${i}].source: 覆灭提议必须带源引用（真实落账复核归引擎）`);
            continue;
        }
        // ★★★leg67（甲案）：两型判据搬进 `src/ref-rules.js` 的 `'entityFates.source'` 表。
        //   ★该表**刻意不享用"本轮新建事件"**（见 `findFateEventSource` 头注）：覆灭的语义是
        //     "**尘埃落定再言灭**"——`settle.js` 的 `applyEntityFates` 跑在 `closeEvents` **之后**，
        //     且那里还要复核"源事件必须 `closed`"。若把本轮新建的**未决**事件并进存在集，
        //     模型只要同轮"新建一件事 + 顺手宣告某人覆灭"就能绕过这条闸（刻意设的闸不许静默拆掉）。
        //   ⇒ 这一格只认**已落在世界账上的事件**（含归档入纪的里程碑），与收口前逐字相同。
        const v = verdictOf('entityFates.source', f.source, { world: ssot, step });
        if (v) errors.push(`$.entityFates[${i}].source: ${v}`);
    }

    // ★★leg34（小说家条款 §6 实施）：实体字段写回 + 带因复活（同一个通道，两种用法）
    //   用户 ⑤：「llm 有权决定任何字段，实力是可以增长的，性情是可以大变的，就连死亡在一个有复活的世界都可以改变」
    //   ⇒ 复活**不是**另一套机制，就是"把 status 改回 active"的一条窄通道 ⇒ 与字段写回共用一份核验（本段）。
    //   五条约束（细案 §6.2 原文，全部机械可核）+ 一条上限：
    //     1. `cause.ref` 必须在账上真实存在（无源之物不存在不放松——这是"因果变更"与"随口改"的唯一分界）
    //     2. 只许改现值、不许改已落账的历史（改历史在形状上无门，见下"只许往前长"）
    //     3. `cause.ref` 指向的**必须未闭环**（防"拿三个月前一件旧事解释今天任何变化"）
    //     4. 玩家棋子 + 引擎 id 不可改
    //     5. `value` 是文本，不换算、不进公式（四维浮点被删的同一条理由）
    //   ★字段黑名单只放三个，且**每一条都是机械理由**（不是口味）：
    //     `id` = 主键（改它等于换一个人，引用全断）· `kind` = 实体类型契约（势力/角色的枚举）
    //     `name` = **身份锚**：重名守卫、名册对齐（`resolveByName` 唯一命中）、对话依据册全按名字走
    //     ⇒ 改 `name` 会静默破坏三条既有机制，故列禁；其余字段（含 `实力`/`身份`/`性情` 等）**全部可改**。
    //   ★**缺席 = 本轮没有变更提议**（不是错误）：这两组是**可选组**（schema 顶层 required 里没有它们）。
    //     ⚠本棒第一版把它写成"不是数组就报错" ⇒ 缺席（`undefined`）被当成"非数组" ⇒ **132 条既有用例全红**
    //     （它们只有七组）。这就是"可选组"与"必填组"的分界：**必填组省键 = 形状不合法；可选组省键 = 本轮没这件事**。
    if (step.entityUpdates !== undefined) {
        // ★★★leg112（D1）：原来这一行还带 `|| step.entityUpdates.length > FIELD_UPDATE_PER_TICK`
        //   ⇒ **超一条就把整轮提议全部退回**（连同一轮里写对的东西一起陪葬）。上限已撤 ⇒ 只剩形状判据。
        if (!Array.isArray(step.entityUpdates)) {
        errors.push(`$.entityUpdates: 必须是数组（当前 ${typeof step.entityUpdates}）`);
    } else {
        const seenPairs = new Set();
        for (const [i, u] of step.entityUpdates.entries()) {
            const ent = u.entity && ssot.entities.find((e) => e.id === u.entity);
            // ★★★leg67 甲-余：目标存在性收进判据表（`'entityUpdates.entity'`）。
            if (verdictOf('entityUpdates.entity', { type: 'id', ref: u.entity }, { world: ssot, step })) {
                errors.push(`$.entityUpdates[${i}].entity: 未知实体 "${u.entity || ''}"`);
                continue;
            }
            if (protectedRole(u.entity)) {
                errors.push(`$.entityUpdates[${i}].entity: ${protectionText(u.entity)}；不可改写字段`);
            }
            if ((currentTurnProtection(ssot)?.changedFields || []).some(r => r.entityId === u.entity && r.field === u.field)) {
                errors.push(`$.entityUpdates[${i}].field: 这一格本轮已由正文落定，同一轮同一格只写一次`);
            }
            if (ENTITY_IMMUTABLE_FIELDS.includes(u.field)) {
                errors.push(`$.entityUpdates[${i}].field: "${u.field}" 不可改（主键/实体类型/身份锚——改它会静默破坏名册对齐与重名守卫）`);
            }
            const pair = `${u.entity}|${u.field}`;
            if (seenPairs.has(pair)) errors.push(`$.entityUpdates[${i}]: 同一实体同一字段一轮内重复提议（"${u.field}"）——一条变更一个因，别叠`);
            seenPairs.add(pair);
            const ref = u.cause?.ref;
            if (!ref) { errors.push(`$.entityUpdates[${i}].cause: 必须带因（无因之变＝随口改，不是因果）`); continue; }
            if (u.cause.type === 'event') {
                // ★★★leg67（甲案）：判据搬进 `src/ref-rules.js` 的 `'entityUpdates.cause'` 表。
                //   ★判定时点：这里（校验期）**在 settle 之前**，故按"当前状态"判，与"进入批次那一刻"等价。
                //     真正的时点纪律在结算期（`settle.js` 传 `openCauseAtEntry` 快照进来）——见该表头注。
                const v = verdictOf('entityUpdates.cause', u.cause, { world: ssot, step });
                if (v) { errors.push(`$.entityUpdates[${i}].cause: ${v}`); continue; }
                // ★leg40b 续（死锁修复）：本格**只认世界账**（与 `entityFates` 同处一格）。
                //   语义上"为什么是现在？因为正在发生的这件事"与 newAgendas 的 event 源**同族**，
                //   并入本轮新建事件在方向上是一致的（尤其带因复活：同轮新建的事点到他的名字 + 同轮复活，
                //   正是 `settle.js:746` 那条"复活必须与被点名同轮发生"的口径）。
                //   但本笔**不顺手扩大**：用户授权的是"死锁"那一格，而这一格的收益未被实测过 ⇒
                //   登记为待办（见 docs/ledger.md 本笔"未做"条），要动先按老规矩出数。
                const ev = (ssot.events || []).find((e) => e.id === ref);
                // ★带因复活的**唯一**位置：改 status ⇒ 必须"被那件未了结的事点名"（ripples 含他）。
                //   为什么这么定（细案 §6.4 风险条要求"cause 本身必须是复活/重生性质"，但词表判语义是 ANCHOR §4.8 明禁的）：
                //   ⇒ 换一条**结构性**的、更硬的判据：他必须真的出现在那件未了结的事里。
                //     这样"复活"＝"他重新被世界点名"，复活从此**挂在一件正在发生的事上**，不可能凭一句理由量產。
                //   ★前提（已核）：`gate.js:39-41` 的"点名"与 `settle.js:720` 的复归都读未决事件的 ripples，
                //     且 `check-step` 第 ⑥ 段只校验 ripples 里的 id **存在性**（不查 status）⇒ status 写面**不影响**死者的 id 合法性。
                // ★先判"不许写 dead"（与 status 是不是 dead 无关——灭只有一条通道）：
                //   `entityFates` 有独立复核（"目标无在飞盘算子树"等），字段写回给不出同等强度的核验。
                if (u.value === 'dead') {
                    errors.push(`$.entityUpdates[${i}].value: 覆灭走 entityFates（那里有独立复核），字段写回不许把 status 写成 dead`);
                } else if (u.field === 'status') {
                    if ((ent.status || 'active') !== 'dead') errors.push(`$.entityUpdates[${i}]: status 只用来"带因复活"（当前「${ent.name}」status=${ent.status || 'active'}，不是 dead）`);
                    if (u.value !== 'active') errors.push(`$.entityUpdates[${i}].value: 复活只能写成 "active"（当前 "${u.value}"）`);
                    // ★★★2026-10-08 体检修（原病：`ev` 为 undefined 时直接取属性 ⇒ TypeError 抛穿校验）：
                    //   上面判定层那一格带 `includeArchived: true` ⇒ 它**放行**"引用一条已归档事件"；
                    //   可这里取事件只看**热账**（`ssot.events`），而归档会把 id 从热账里摘掉
                    //   （`settle.js` 的 `world.events = world.events.filter(...)`）⇒ `ev` 可能是 undefined。
                    //   抛出点没有 try/catch、且校验发生在克隆之前 ⇒ **整轮世界推进失败**；
                    //   自愈那条路会拿同一条提议再校验一次 ⇒ 再抛一次 ⇒ 世界停摆。
                    // ★★★2026-10-09 用户改口径（原先的收法是"如实拒"）：**已归档的事件可以当复活的因**。
                    //   用户原话（他说清了自己要的是什么）：「我主要是想实现多年前的某一个事件到今日
                    //   还有可能影响现今的事实，所以才让能引用已经归档的事件。」
                    //   ★原来那条"如实拒"错在哪：归档**不等于没发生过**——它只是从热账搬进了大事纪
                    //     （`settle.js` 的 `archiveClosedEvents`）。判定层（上面那一格）本来就放行，
                    //     这一支再拒就是**同一件事两把尺子**（本仓最贵的那类病）。
                    //   ★放开这一支**不拆任何闸**：复活真正的门在结算那一侧——
                    //     「本 tick 必须被新落账的事点名」（`settle.js` 的 `thisTickNames`）。
                    //     它是**独立**的一道，与"因是新是旧"无关 ⇒ 旧号只能当**理由**，
                    //     不能单独把人拉回场上。
                    //   ★热账那一支照旧核波及名单（那件事还在桌上、名单就在手边，核得了）。
                    if (ev && !(ev.eventProtocol === 4 ? (ev.actors || []).map(a => a.ref) : ev.ripples || []).includes(u.entity)) {
                        errors.push(`$.entityUpdates[${i}].cause: 复活必须**挂在一件提到他的事上**——「${ent.name}」不在事件「${ev.title}」的波及名单里（先让那件事点到他的名字）`);
                    }
                }
            } else if (u.cause.type === 'agenda') {
                // ★★★leg67（甲案）：同上，判据在 `'entityUpdates.cause'` 表的 `agenda` 一格。
                const v = verdictOf('entityUpdates.cause', u.cause, { world: ssot, step });
                if (v) { errors.push(`$.entityUpdates[${i}].cause: ${v}`); continue; }
                if (u.field === 'status') errors.push(`$.entityUpdates[${i}].field: 复活必须挂在一件**提到他的事**上（agenda 源没有波及名单，核不了这件事）`);
            }
            }
        }
    }

    // ★★★leg95（用户令「让 llm 来决定何时结束」）：**收场提议**（`eventClosures`，可选组）。
    //   分工纪律（用户原话「引入机械就一定要避免让代码去理解语义」）：
    //     · **模型判"这一段讲完了没有"**（语义）——引擎一个字都不判；
    //     · **引擎只做机械审计**：号在册 ∧ 还没收场 ∧ 同批不重复 ∧ 每轮配额。
    //   为什么配额**不写进这里当错误**（`entityUpdates` 那条"每轮 ≤3"曾**正好相反**——它在这里报错、
    //     整步被拒；★★leg112 用户拍板已把它**整条撤除**，见上方那一格留档）：
    //     "超配额"不是形状错、也不是无源之物——它是"这轮太多了，剩下的顺延"，**引擎给警告、照收前 N 件**。
    //     若在这里报错 ⇒ 整个世界步被拒 ⇒ **世界白停一轮**，代价远大于"少收几件旧事"。
    //     （这正是本仓的老教训：判据该拦的是"错的"，不是"多的"。）
    if (step.eventClosures !== undefined) {
        if (!Array.isArray(step.eventClosures)) {
            errors.push('$.eventClosures: 必须是数组（每项 {event, why?}；不提议就写 [] 或整组省掉）');
        } else {
            const seenEv = new Set();
            for (const [i, ec] of step.eventClosures.entries()) {
                if (!ec || typeof ec !== 'object' || Array.isArray(ec)) {
                    errors.push(`$.eventClosures[${i}]: 必须是 {event, why?} 形状的对象`);
                    continue;
                }
                const id = typeof ec.event === 'string' ? ec.event.trim() : '';
                if (!id) { errors.push(`$.eventClosures[${i}].event: 缺事件 id（照抄输入里"还没结束的事"的号）`); continue; }
                if (seenEv.has(id)) { errors.push(`$.eventClosures[${i}]: 同一件事一轮内重复提议（"${id}"）——一件只能收一次`); continue; }
                seenEv.add(id);
                // ★判据搬进 `src/ref-rules.js` 的 `'eventClosures.event'` 表（与 `entityUpdates.cause` 同一族：
                //   都是"同一个号在此时此地能不能这么用"）。那一格查两件事：号在册、且**还没收场**。
                const v = verdictOf('eventClosures.event', { type: 'id', ref: id }, { world: ssot, step });
                if (v) errors.push(`$.eventClosures[${i}].event: ${v}`);
            }
        }
    }

    // ★★★leg120（A3 关系网，细案 `docs/spec-relationship-network.md`）：**关系变更提议**（可选组）。
    //   分工纪律（与 `eventClosures` 同一条）：**模型负责语义**（谁跟谁算"结下死仇"、用哪个词），
    //   **引擎只做机械审计**：两端在册 ∧ 必带因 ∧ 因在账 ∧ 同批不重复 ∧ 不许替玩家持有关系。
    //   ★**不设条数上限**（用户 2026-09-23 拍板「不限」）：本仓为"没量过的上限当家"流过血
    //     （`entityUpdates ≤3` 是个提案态数字，在生产里拦了十几棒**而且是静默的**，leg112 已整条撤除）；
    //     而**"必带因"本身就是结构量闸**——关系不能凭空长，产率被世界的因果产量卡住。
    //   ★`type` 是**模型的原话**：引擎**不比对任何词表、不排序、不换算成数**（红线 §2.2 第 1 条）。
    if (step.relationUpdates !== undefined) {
        if (!Array.isArray(step.relationUpdates)) {
            errors.push('$.relationUpdates: 必须是数组（每项 {from, to, type, cause, note?}；不提议就写 [] 或整组省掉）');
        } else {
            const seenEdges = new Set();
            for (const [i, ru] of step.relationUpdates.entries()) {
                if (!ru || typeof ru !== 'object' || Array.isArray(ru)) {
                    errors.push(`$.relationUpdates[${i}]: 必须是 {from, to, type, cause} 形状的对象`);
                    continue;
                }
                const fromId = typeof ru.from === 'string' ? ru.from.trim() : '';
                const toId = typeof ru.to === 'string' ? ru.to.trim() : '';
                const relType = typeof ru.type === 'string' ? ru.type.trim() : '';
                if (!fromId) { errors.push(`$.relationUpdates[${i}].from: 缺"谁"（照抄输入实体 id）`); continue; }
                if (!toId) { errors.push(`$.relationUpdates[${i}].to: 缺"对谁"（照抄输入实体 id）`); continue; }
                if (!relType) { errors.push(`$.relationUpdates[${i}].type: 缺关系本身（用你自己的话写这次关系怎么变了）`); continue; }
                // ★两端在册：判据在 `src/ref-rules.js` 的 `'relationUpdates.end'` 表（只判存在性）。
                const vFrom = verdictOf('relationUpdates.end', { type: 'id', ref: fromId }, { world: ssot, step });
                if (vFrom) { errors.push(`$.relationUpdates[${i}].from: ${vFrom}`); continue; }
                const vTo = verdictOf('relationUpdates.end', { type: 'id', ref: toId }, { world: ssot, step });
                if (vTo) { errors.push(`$.relationUpdates[${i}].to: ${vTo}`); continue; }
                // ★自己跟自己不成边（有向边的两端是同一个人的话，这条边没有任何含义）。
                if (fromId === toId) {
                    errors.push(`$.relationUpdates[${i}]: 两端是同一个实体（"${fromId}"）——关系是"谁 → 对谁"，自己跟自己不成边`);
                    continue;
                }
                // ★★红线 1（玩家是棋子）：**不许把玩家写成"持有关系"的那一方**。
                //   口径与 `entityUpdates` 那格同源（"玩家不可改（红线 1；玩家的行为与承诺是唯一真相源）"）
                //   ——"黄坤欠了谁一条命"是**玩家的承诺**，只有玩家能立，模型不许替他立。
                //   ★**反方向是允许的**：别人**对玩家**的态度（"薛铁衣恨黄坤"）是**世界**的事，
                //     那正是这世界活起来的样子 ⇒ **只拦 `from`，不拦 `to`**。
                if (protectedRole(fromId)) {
                    errors.push(`$.relationUpdates[${i}].from: ${fromId === playerId ? '玩家不可作（红线 1）' : '受保护角色不可作'}"持有关系"的那一方；可以写别人对其的关系（放进 to）`);
                    continue;
                }
                // ★同批不重复：同一条边（谁→对谁→什么关系）一轮内只提一次（照 `entityUpdates` 的 seenPairs 口径：
                //   "一条变更一个因，别叠"）。★但**不同 type 允许并存**——"既是盟友又有旧怨"是合法的人间事，
                //   引擎不许替它判"这两条矛盾"（那是语义，归模型）。
                const edgeKey = `${fromId}\u0000${toId}\u0000${relType}`;
                if (seenEdges.has(edgeKey)) {
                    errors.push(`$.relationUpdates[${i}]: 同一条边一轮内重复提议（"${relType}"）——一条变更一个因，别叠`);
                    continue;
                }
                seenEdges.add(edgeKey);
                // ★★**必带因**（本机制的脊梁）：判据在 `'relationUpdates.cause'` 表
                //   ——它与 `entityUpdates.cause` **共用同一份实现**（委托），故口径与判词逐字一致。
                const cause = ru.cause;
                const causeRef = cause && typeof cause === 'object' ? cause.ref : '';
                if (!causeRef) {
                    errors.push(`$.relationUpdates[${i}].cause: 必须带因（无因之变＝随口编的关系，不是玩出来的）`);
                    continue;
                }
                const vCause = verdictOf('relationUpdates.cause', cause, { world: ssot, step });
                if (vCause) errors.push(`$.relationUpdates[${i}].cause: ${vCause}`);
            }
        }
    }

    // ★★★leg120（A3）：**了结一条边**（可选组）——与 `eventClosures` 同构。
    //   ★**只认引擎发的 `id`，不认 `type` 文本**：模型这轮写"死仇"、下轮写"深仇"，引擎**不许去猜**
    //     这是不是同一条边（leg95 的分工：引擎负责"这单结没结清"、模型负责"这故事还要不要往下讲"）。
    if (step.relationClosures !== undefined) {
        if (!Array.isArray(step.relationClosures)) {
            errors.push('$.relationClosures: 必须是数组（每项 {id, why?}；不了结就写 [] 或整组省掉）');
        } else {
            const seenRel = new Set();
            for (const [i, rc] of step.relationClosures.entries()) {
                if (!rc || typeof rc !== 'object' || Array.isArray(rc)) {
                    errors.push(`$.relationClosures[${i}]: 必须是 {id, why?} 形状的对象`);
                    continue;
                }
                const relId = typeof rc.id === 'string' ? rc.id.trim() : '';
                if (!relId) { errors.push(`$.relationClosures[${i}].id: 缺关系 id（照抄输入里那条边的号 rel_<轮次>_<第几条>）`); continue; }
                if (seenRel.has(relId)) { errors.push(`$.relationClosures[${i}]: 同一条边一轮内重复了结（"${relId}"）——一条只能了结一次`); continue; }
                seenRel.add(relId);
                // ★判据在 `'relationClosures.id'` 表：号在册 ∧ 还没了结 ∧ **只认已落账的边**。
                const v = verdictOf('relationClosures.id', { type: 'id', ref: relId }, { world: ssot, step });
                if (v) errors.push(`$.relationClosures[${i}].id: ${v}`);
                const edge = (ssot.relations || []).find(r => r.id === relId);
                if (protectedRole(edge?.from)) errors.push(`$.relationClosures[${i}].id: ${protectionText(edge.from)}；不可解除其主动持有的关系`);
            }
        }
    }

    // ★★★leg163：**按需查表那一族整族撤走**（`lookupScales` / `meta.scaleRequests` / 出包的 `刻度目录`
    //   与 `刻度补`）。用户令：「既然是全塞了就不需要点名表了所以删了这个功能即可」。
    //   为什么这个判断成立（本笔真账实测，不是推理）：leg135 那条「全塞」令把进包上限抬到
    //   表 ≤`SCALE_TABLE_TOP_PACK` / 档 ≤`TIER_TOP` 之后，**真实书里的尺已经整本进包**——
    //     · 大荒那份真账：1 张表 / 16 档 ⇒ 1 张全进；
    //     · `real-world-dh`（新账形状）：45 张表 / 293 档 ⇒ **45 张全进、目录为空**。
    //   ⇒ `刻度目录`（"我手里没有、但书里有"那份差距清单）**是空的**，点名这条通道**无表可点**。
    //   ★撤走时必须**两样一起撤**（目录与点名是一件事的两半）：只留目录 ⇒ 目录叫模型去点名、
    //     而点名那个口已经没了 = 本仓最忌的"提示词替机制承诺一个它做不到的事"。
    //   ★★★leg163 同批的第二笔：**那三道上限也删了**（用户令「删掉那三道，让预算当唯一的闸」）——
    //     `SCALE_TABLE_TOP_PACK` / `TIER_TOP` / `DIM_TOP` 三个常量已从 `pack.js` 删除。
    //     ⇒ 上面"档位预算用尽时排在后面的表整张进不去"那条边界**随之消失**（现在书里有几张就给几张）。
    //     唯一的闸是整包那一道 `trimPack`（真裁了写 `pack.trimmed`，机器可读、不静默）。

    // ★★★leg128：**点名要一条"故事线"的经过**（`lookupLines`，可选组）——与上面那道按需查表**逐条同构**：
    //     ① 点名的根必须**在这一轮真递出去的那一批线里**（`linesOf` 同一个上界）——编的 ⇒ 拒
    //        （"无源之物不入局"的通道版：模型编一条线，引擎**不许替它造出来**）；
    //     ② 每轮 ≤ `LINE_ONDEMAND_TOP` 条（防"我全要"）；
    //     ③ 缺席合法（可选组，见 `world-step.schema.js` 那一格注释）——本轮不点名不是形状错误。
    //   ★写账纪律照抄上面那一条：**只在整步没有错误时写**（被拒的步不留任何痕迹），写的是**核过**的根 id；
    //   ★★★本次修（与上面"按需查表"**同批、同一条规矩**）：老写法只在模型写了 `lookupLines` 时才跑 ⇒
    //     不写 ⇒ `meta.lineRequests` 保持旧值 ⇒ **那条线的经过每轮重复递下去**（真跑实测：点名 2 次、递出 4 次）。
    //     现在**没写 ⇒ 写空数组（= 清掉）**，"只递那一轮"才真的成立。
    //     ★同一条旧账纪律：从没点过名的世界一个字节都不碰（K6）。
    if (ssot && typeof ssot === 'object') {
        const present = typeof step.lookupLines !== 'undefined';
        const raw = Array.isArray(step.lookupLines) ? step.lookupLines : [];
        const hadPrev = Array.isArray(ssot.meta?.lineRequests) && ssot.meta.lineRequests.length > 0;
        if (present && !Array.isArray(step.lookupLines)) {
            errors.push('$.lookupLines: 必须是字符串数组（根 id 照抄输入「故事线」那一栏的**行首**）');
        } else if (present && raw.length > LINE_ONDEMAND_TOP) {
            errors.push(`$.lookupLines: 每轮至多要 ${LINE_ONDEMAND_TOP} 条线的经过（当前 ${raw.length}）——挑这一轮真要用的`);
        } else {
            // ★★★leg132：**校验要认"账上真有的全部线"，不是"这一轮摆出来的那 40 条"**。
            //   为什么必须改（否则会当场拒掉整步）：`故事线` 那一栏现在是**全史索引**——
            //   出包时按"这一轮在动的事"把相关的挑到前面（`pickLinesForPack`），
            //   而这里是**按收口轮次截前 40 条** ⇒ 模型点了它**明明看见**的一条老线，
            //   这里却会判"没有这一条线"并把**整步**拒掉（不是丢一条提议，是这一轮白跑）。
            //   ★口径没松：仍然**只收账上真算得出来的根 id**，编的照样不认——防的还是"不许替它造一条"。
            const { ok, missed } = present
                ? sanitizeLineRequests(raw, lineIndexOf(linesOf(ssot, { top: Infinity }).lines))
                : { ok: [], missed: [] };
            for (const id of missed) {
                errors.push(`$.lookupLines: 输入「故事线」里没有「${id}」这一条线（照抄那一栏行首的根 id；编的不会给你造）`);
            }
            if (!errors.length && (present || hadPrev)) ssot.meta = { ...(ssot.meta || {}), lineRequests: ok };
        }
    }

    // ③ 因果：ripple 源必须引用已存在事件（无源拒绝的语义侧）
    //   ★★★leg67（甲案）：判据搬进 `src/ref-rules.js` 的 `'newEvents.source'` 表
    //     （plot/state/ripple 三型；`plot` 那格原先只在 `ref` 非空时才判，口径原样保留在表里）。
    for (const [i, ev] of step.newEvents.entries()) {
        const v = verdictOf('newEvents.source', ev.source, { world: ssot, step });
        if (v) errors.push(`$.newEvents[${i}].source: ${v}`);
        if (ev.source?.type === 'plot') {
            const owner = (ssot.agendas || []).find(a => a.id === ev.source.ref)?.owner;
            if (protectedRole(owner)) errors.push(`$.newEvents[${i}].source: ${protectionText(owner)}；不可通过事件推进其盘算`);
        }
    }

    // ④ 位置：**自由文本**（★leg33c 用户拍板「要么就直接将位置变成自由文本就好了，位置集干脆删了」）
    //
    // 这一段的判据在 leg33c 被**换过**，全历程留档（免得下一棒又把它加回来）：
    //   · 旧（切片 §3.2 起）：「事件/动作位置 ⊆ 世界位置集」，不在集内 ⇒ **拒整步**。
    //     原文动机是"不得为贴近玩家而移动位置"——防的是"把世界搬到主角脚下"，**不是"地名要合规"**。
    //   · leg33：先剥「（推）」注解（那是**引擎自己**打在实体表 location 列上的标记，模型抄回来会被误判）。
    //   · ★leg33c：**闸整个去掉**，改成留痕。三条依据（都是实测，见 `LEDGER.md` leg33 行）：
    //     ① **跨书不成立**：位置集来源是 `kind='location'` 的抽取条目，而 8 本真实世界书里只有 3 本
    //        有干净地名表（仓库自带 `demo/audit-mechanism-genericity.js` 的"机制②"读数 3/8）；
    //        其余 4 本位置集退化成 `['未明']` ⇒ 位置闸在这类书里**近乎失效**（写什么都错）。
    //     ② **大书里在切真地名**：真账 canon 有 **134** 个地点条目，旧 `derivePositions` 按书序**截到 60**
    //        ⇒ 模型写书里真有的 `太清境`/`万魔殿` 反被拒整步。
    //     ③ **位置早就不参与机制**（定案「只做呈现、不做机制」）：白名单不换来任何机制收益，
    //        却换来"大书切真地名、小书全员未明"两件坏事。
    //   ★保留下来的（这才是原动机，没丢）：剥「（推）」注解 + **集外留痕**。
    //     留痕不是判据，是**观测面**——"这本书的位置集够不够"从此是个可数的量。
    //   ★同族先例：`newEntities` 的位置不在集内早已是"归一 + 留痕、不拒整步"（leg32f）。
    //   ⚠机器可读承诺：本段留痕一律以 `位置集外:` 开头且**不进 errors**；
    //     故它**不计入拒签率分子**（`settle.js` 的拒签口径只数 `裁定:`/`校验拒绝:`/`提议丢弃`）。
    for (const ev of step.newEvents) if (ev.position != null) ev.position = normalizePosition(ev.position);
    for (const a of step.actions) if (a.position != null) a.position = normalizePosition(a.position);
    for (const [i, ev] of step.newEvents.entries()) {
        if (ev.position && !positions.has(ev.position)) {
            warnings.push(`位置集外: $.newEvents[${i}].position="${ev.position}"（不在参照表内，照收——参照表不是闸）`);
        }
    }
    for (const [i, a] of step.actions.entries()) {
        if (a.position != null && !positions.has(a.position)) {
            warnings.push(`位置集外: $.actions[${i}].position="${a.position}"（不在参照表内，照收——参照表不是闸）`);
        }
    }

    // ⑤ 波及：ripples 必须是存在的实体；且**条数 ≤ 上限**（leg25：RIPPLE_TARGET_CAP 自此有强制点——
    //    此前"一次事件波及 ≤3"只是 weight.js 里一个没人调用的函数返回值，校验侧对条数只字未提＝纸面机制；
    //    超限**拒整步**（世界如实不动），上限值从 weight.js 导入，不写死字面量。
    //    leg29：上限 3 → 15（用户令）；★改后**本闸不是最先咬人的那道**——见下 ⑥ 的涉及闸）
    for (const [i, ev] of step.newEvents.entries()) {
        const ripples = ev.ripples || [];
        if (ripples.length > RIPPLE_TARGET_CAP) {
            errors.push(`$.newEvents[${i}].ripples: 一次事件波及目标数上限 ${RIPPLE_TARGET_CAP}（当前 ${ripples.length} 个：${ripples.join('/')}）`);
        }
        for (const [j, rid] of ripples.entries()) {
            // ★★★leg67 甲-余：波及名单的存在性收进判据表（`'newEvents.ripples'`，逐 id 判）。
            //   ⚠紧邻下面那条**不是**同一件事，别合并：那是 K25 的"设定池保留键空间"
            //     （读**串的形状**、不读账），本格读的是"账上有没有这个号"。
            const v = verdictOf('newEvents.ripples', { type: 'item', ref: rid }, { world: ssot, step });
            if (v) errors.push(`$.newEvents[${i}].ripples[${j}]: ${v}`);
        }
    }

    // ⑥ 盘算涉及面上限（细案 spec-entity-field-lookup §6 R2，用户 2026-09-11 拍板）：
    //    单个盘算**一轮内**涉及的实体（属主 + 行动方/目标 + 被波及方）≤ AGENDA_INVOLVED_CAP(15)，
    //    逐轮算、不新增存储字段（agenda 里没有涉及名单，加字段=加机制）；超限**拒整步**
    //    （用户拍板取 (a)：与 ripples 超限同款——上限不拒绝就是纸面机制，leg25 G 组的教训）。
    //    与 RIPPLE_TARGET_CAP 并存不冲突：一个盘算可有多个事件，各自受限，合计 ≤15 由本闸兜住。
    //    ★leg29（RIPPLE_TARGET_CAP 3 → 15）后两道闸边界重合，实测有效天花板（真函数跑）：
    //      属主自行动 → 单事件最多波及 14；属主 + 1 个行动方 → 13；+3 个 → 12；+5 个 → 10
    //      （因为本闸把属主 + 本步全部 actions 的 entity/target + 波及名单并成一个集合，波及名单是子集）。
    //      ⇒ 超限一律**拒整步**；告知面口径写在 prompts.js 铁律 8。
    const involved = checkAgendaInvolvement(step, world);
    for (const v of involved.violations) {
        errors.push(`$.actions: 盘算「${v.agendaId}」一轮内涉及实体上限 ${involved.cap}（当前 ${v.count} 个：${v.sample.join('/')}…）`);
    }

    // ⑦ 设定池保留键空间（K25/大势层 → A-4）：context.setting 全池（frozen+dynamic）引擎持有、
    //    模型不可写——任何世界步实体引用字段命中保留键空间即拒绝（校验拒绝、世界如实不动；
    //    命名空间恒定保留，与设定池是否已落账无关；dynamic 的引擎写通道在 src/setting.js，模型无直写路径）
    const refFields = [
        ...step.actions.map((a, i) => [`$.actions[${i}].entity`, a.entity]),
        ...step.actions.map((a, i) => [`$.actions[${i}].target`, a.target]),
        // leg25 c：`stateChanges` 两行（entity/actor）随契约层该字段一并删除。
        ...(step.newAgendas || []).map((n, i) => [`$.newAgendas[${i}].entity`, n.entity]),
    ];
    for (const [path, ref] of refFields) {
        if (isSettingRef(ref)) errors.push(`${path}: 设定池保留键不可作引用对象（引擎只读，K25/A-4）`);
    }
    for (const [i, ev] of step.newEvents.entries()) {
        for (const [j, rid] of (ev.ripples || []).entries()) {
            if (isSettingRef(rid)) errors.push(`$.newEvents[${i}].ripples[${j}]: 设定池保留键不可作引用对象（引擎只读，K25/A-4）`);
        }
    }

    return { ok: errors.length === 0, errors, warnings };
}
