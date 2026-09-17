// story-world-v2/src/check-step.js
// 世界步语义校验（S4）：真 schema 强制（形状）+ 身份/因果/位置/波及（语义）。
// 事件源三类与无源拒绝（§4.2）、事件位置合法性切片版（§3.2）在此落实。
import { validate } from './schema.js';
import { worldStepSchema } from './schemas/world-step.schema.js';
import { isSettingRef } from './setting.js';   // K25：设定池保留键空间判词
import { RIPPLE_TARGET_CAP } from './weight.js';   // leg25：波及上限唯一真源（此前该上限生产 0 强制点=纸面机制）
import { checkAgendaInvolvement } from './entity-lookup.js';   // 细案 §6 R2：单盘算一轮涉及实体 ≤15（唯一真源）
import { normalizePosition } from './position.js';   // leg33：剥掉引擎自己打在 location 列上的「（推）」注解（叶子模块，无环）
// ★★★leg64 第四轮（按需查表）：表名必须能对回账上真有的尺——**"无源之物不入局"那条纪律的表格版**。
//   ★为什么从 `pack.js` 拿（不在本文件另写一份索引）：目录、进包、查表三处必须**同一把尺**
//     （表名截断长度 `SCALE_NAME_MAX_PACK` 都一样），各写一份迟早出现"目录里有的表、点名说没有"。
//   ★无环：`pack.js` 只依赖 `gate.js`/`abstract.js`，两者都不回头 import 本文件
//     （`settle.js` 同时 import 了本文件与 pack.js，但**本文件不 import settle**——见 `position.js:3` 那条留档）。
import { buildScaleTableIndex, sanitizeScaleRequests, SCALE_ONDEMAND_TOP } from './pack.js';
// leg25 c：属性白名单（INBORN_ATTR_KEYS）随 `stateChanges` 整条删除——四维浮点已不存在，没有键可白名单。

// ★leg34（小说家条款 §6）：实体字段写回的三条上限/黑名单——**本文件是唯一真源**（照 AGENDA_INVOLVED_CAP 的惯例）。
//   ★三个数字都是**提案态**（铁律 2），细案 §6.2 明写"数字先出曲线再报批"；本棒按最小可跑取值并如实登记未出曲线。
export const FIELD_UPDATE_PER_TICK = 3;   // 提案：每轮至多几条字段变更（防"一轮改 200 个实体 ⇒ 世界失去连续性"）
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
export const ENTITY_IMMUTABLE_FIELDS = ['id', 'kind', 'name', 'lastActiveTick', 'fieldSource', 'parentSource', 'parentSourceFrom'];
// ★leg34 撤回留档（**别再往回做**）：本棒曾实现 `fieldQueries` = "模型在世界步里点名要查哪个字段，引擎下一轮回灌"。
//   用户 2026-09-13 追问「为什么聊天 llm 能够直接获取想要的世界书内容呢还能通过向量化搜索直接在插件里搜到呢
//   都是一轮解决的啊，也没有产生额外的文件」⇒ **那套是错的方向**：
//     ① ST 的关键词世界书与 `yuzuki-Memory` 的向量召回都是**系统在模型开口之前**把书塞进提示词
//        （模型根本没有"主动搜索"这个动作）⇒ **一轮可见、零额外调用、零跨轮状态**；
//     ② 我那套把顺序做反了（模型先问 → 结算后才检索）⇒ 值**晚一轮**才到眼前，还要跨轮存待办与清理。
//   ⇒ 已撤：改用 `src/recall.js` 的**出包前检索注入**（与 ST 同一条思路，当轮可见）。见 `runTick` 的 `preStep`。

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
/** 本轮新事件**将要拿到的 id**（引擎的发号规矩，唯一真源；`settle.js` 的 `hangEvents` 与净化器都从这里取）。 */
export function newEventIdsOf(step, tick) {
    return (step?.newEvents || []).map((_, i) => `ev_${tick}_${i + 1}`);
}

/** 从"形如 `ev_<n>_<m>` 的号"里取出位次 m（不是这个形状 ⇒ null）。 */
function eventOrdinal(ref) {
    const m = /^ev_\d+_(\d+)$/.exec(String(ref || ''));
    return m ? Number(m[1]) : null;
}

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
 *  ★本函数是"事件引用算不算存在"的**唯一真源**（校验与净化器共用）——两把尺子会长歪，见 `sanitize-step.js` 头注。
 *  ★同轮那半用的是**位次解析**（见上方长注）：模型写 `ev_<任意轮号>_<m>` ⇒ 落到本轮第 m 件事上。
 *    只有两个条件同时成立才认：① 世界账里**没有**这个 id（有则以账为准）；② 位次落在本轮 `newEvents` 范围内。 */
export function findEvent(step, ssot, ref) {
    if (!ref) return null;
    const onWorld = (ssot.events || []).find((e) => e.id === ref);
    if (onWorld) return onWorld;
    const list = step?.newEvents || [];
    if (!list.length) return null;
    const ord = eventOrdinal(ref);
    if (ord == null || ord < 1 || ord > list.length) return null;
    return list[ord - 1] || null;
}

export function checkWorldStep(step, ssot) {
    const errors = [];
    const warnings = [];   // ★leg33c：非致命留痕面（与 errors 分开——见下 ④ 位置段）
    const world = ssot;   // 别名：本函数沿用 ssot 命名，涉及面计算读 world.agendas/events

    // ① 形状：真 schema 强制
    const r = validate(step, worldStepSchema);
    if (!r.ok) return { ok: false, errors: r.errors, warnings: [] };

    const { entityIds, agendaIds, eventIds, positions } = indexIds(ssot);
    const playerId = ssot.context?.playerId;   // K8：玩家棋子标注（红线 1 代码化）

    // ② 身份：动作/状态变更挂存在的实体；盘算推进挂存在的盘算
    //    K8 禁写规则（优先于未知实体检查）：模型禁写玩家——actions 涉 playerId 一律拒绝，世界如实不动
    for (const [i, a] of step.actions.entries()) {
        if (playerId && a.entity === playerId) errors.push(`$.actions[${i}].entity: 模型禁写玩家 "${playerId}"（红线 1 代码化）`);
        if (!entityIds.has(a.entity)) errors.push(`$.actions[${i}].entity: 未知实体 "${a.entity}"`);
    }
    // ★leg32h（用户：「又把主角演了」）：**禁写玩家的面上加一条——不许推进玩家的盘算**（见 ②b' 段落的实现）。
    //   为什么放在 ②b'：它属于"身份/因果"校验（盘算属主 == 玩家），与 agendaAdvances 的形状校验同段。
    // leg25 c（用户令「删」）：`stateChanges` 的整段校验（玩家禁写 / 未知实体 / 属性白名单 / actor 在册）
    //   随契约层该字段一并删除——四维浮点不存在了，没有属性变更可校验。

    // ②b 盘算树（K13/T1）：新盘算提议——实体存在；event 源必引未决事件；parent 源必引在飞盘算；state 源不带 ref
    // （环检测在出生落账时由引擎做——K14；此处只校验引用合法，无源之物不存在）
    for (const [i, na] of (step.newAgendas || []).entries()) {
        // K14（K13 施工补差）：模型禁写玩家三通道完整——行动/状态变更（K8）+ 新盘算提议（玩家是棋子不是模拟主体，盘算树细案 §2）
        if (playerId && na.entity === playerId) errors.push(`$.newAgendas[${i}].entity: 模型禁写玩家 "${playerId}"（红线 1 代码化）`);
        if (!entityIds.has(na.entity)) errors.push(`$.newAgendas[${i}].entity: 未知实体 "${na.entity}"`);
        const stype = na.source?.type;
        if (stype === 'event') {
            // ★leg40b 续（甲）：`findEvent` = 世界账 ∪ **本轮新建的那批**（同轮引用是合法写法，见上方 `findEvent` 注释）
            const ev = findEvent(step, ssot, na.source.ref);
            if (!ev) {
                errors.push(`$.newAgendas[${i}].source: event 源必须引已存在未决事件（当前 ref="${na.source.ref || ''}"）`);
            } else if (ev.closed) {
                // ★leg64 第五轮（用户实机贴回的错就在这一格）：**"存在但已了结"与"根本不存在"必须分开报**。
                //   病：旧信息只有一句"必须引已存在未决事件"，而账上**确实有** `ev_5_1`
                //   ——读者（与模型）只会理解为"我抄错号了"，于是换一个号再试，再被拒。
                //   实测现场：大荒那份账 `ev_5_1 [已了结] 丹劫第三道天雷降下，穷奇强攻丹炉`
                //   ⇒ 真实原因是"这件事办完了"，不是"没有这件事"。
                //   纪律出处：本文件 `:242` 那条"错误信息**不许再说假话**"（leg32i 用户贴回来过一条把人看懵的）。
                // ★★★leg66（用户实机第二条：`newAgendas[2].source` 引了 `ev_7_1`「苏千欢携龙气破开废墟遁走」）：
                //   **这一格引擎判得对**（`newAgendas` 的源型只有 event/parent/state，
                //   而 `ripple` **不是**它的合法源型——`world-step.schema.js:40` 锁着），
                //   错的是**这句提示没给出路**：`ev_7_1` 正是 `closedRoots`（拾遗）那一栏里的"可以动手接的旧事"，
                //   提示词第 14 条明写"**旧事也能接**，用 `source.type="ripple"` + ref= 它的 id"，
                //   而模型把这件事写进了 `newAgendas`（源型给成了 `event`）⇒ 意图对、落点错。
                //   旧文案只说"引一件未决事件，或把源改成 state"——**两条都把模型的心愿（那件事的余波长出新线）
                //   说成不可能**，于是它会反复换号重试（正是 leg64 那条"报错把人领错方向"的同一种病）。
                //   ⇒ 补上第三条路（**这才是它想要的那条**）：先接旧事（`newEvents` + `ripple`）⇒
                //     那件**新事件**就是未决的 ⇒ 下一轮（或同轮）再用它当 `newAgendas` 的 event 源。
                //   ★只改文案，**不动判据**：`newAgendas` 的源型一个字不放宽（放宽带宽的是"线要挂在正在发生的事上"这条语义闸）。
                errors.push(`$.newAgendas[${i}].source: 「${ev.id}」（${String(ev.title || '').slice(0, 24)}）**已经了结**——`
                    + '起盘算要挂在**正在发生**的事上；这件已经办完了。三条出路：'
                    + '① 换一件**未决**事件当源；'
                    + `② 若这就是你要接的那条旧线（它在输入的"拾遗/closedRoots"一栏里）——**先接它**：`
                    + `用 newEvents 写一条 source.type="ripple" + ref="${ev.id}" 的新事件（"那件事的余波现在显出来了"），`
                    + '那条**新事件**就是未决的，再用它当本条的 event 源；'
                    + '③ 真是局势自己拱出来的处境，才把源改成 state');
            }
        } else if (stype === 'parent') {
            const ag = na.source.ref && ssot.agendas.find((a) => a.id === na.source.ref);
            if (!ag) {
                errors.push(`$.newAgendas[${i}].source: parent 源必须引已存在盘算（当前 ref="${na.source.ref || ''}"）`);
            } else if (ag.closed) {
                errors.push(`$.newAgendas[${i}].source: parent 源必须是未结算（在飞）盘算`);
            }
        } else if (stype === 'state' && na.source?.ref) {
            errors.push(`$.newAgendas[${i}].source: state 源不应带 ref`);
        }
    }
    for (const [i, ad] of step.agendaAdvances.entries()) {
        if (!agendaIds.has(ad.agendaId)) errors.push(`$.agendaAdvances[${i}].agendaId: 未知盘算 "${ad.agendaId}"`);
        // ★leg32h（用户：「又把主角演了」）：**红线 1 补一个缺口——不许推进玩家的盘算**。
        //   实测机制（真账 tick 50）：玩家棋子叫「你」（`attachPlayerPiece` 初始化时没拿到玩家名），
        //   而主角「黄坤」在 t42 被模型当**新实体**入局（`e_42_1`）⇒ 世界账里两个平行的人
        //   ⇒ 模型很尽责地替黄坤开了盘算并**一轮轮推进**（done 里全是"以雷法锁定薛铁衣气机、展开殊死搏杀"
        //   这类**玩家自己的选择**）。既有四条守卫只拦"提议"（actions/newAgendas/newEntities/entityFates），
        //   **没拦"推进"** ⇒ 账上只要已有属于玩家的盘算（旧账/合并前遗留），模型就能一直替玩家演下去。
        //   本条堵上：**玩家的盘算不由模型推进**——玩家那一步只由玩家自己的落子进入世界。
        const owner = (ssot.agendas.find((a) => a.id === ad.agendaId) || {}).owner;
        if (playerId && owner === playerId) {
            errors.push(`$.agendaAdvances[${i}].agendaId: 模型禁写玩家（红线 1 代码化；不许推进玩家的盘算 "${ad.agendaId}"）`);
        }
    }
    // ②c 取消通道（K18/因果链 T5）：提议放弃——agendaId 必须存在且未结算（"已结算盘算不可取消"）；
    // 模型只有提议权，裁决归引擎；玩家不是模拟主体（agendaCancels 无 entity 通道，形状天然无玩家面）
    for (const [i, ac] of (step.agendaCancels || []).entries()) {
        const ag = ac.agendaId && ssot.agendas.find((a) => a.id === ac.agendaId);
        if (!ag) {
            errors.push(`$.agendaCancels[${i}].agendaId: 未知盘算 "${ac.agendaId || ''}"`);
        } else if (ag.closed) {
            errors.push(`$.agendaCancels[${i}].agendaId: 已结算盘算不可取消（"${ac.agendaId}"）`);
        }
    }

    // ②d 实体治理（K37/细案 §3.7 → A-10/A-11）：入局提议（newEntities）与覆灭提议（entityFates）语义校验
    //   源三型命中账：book=书名录（frozen.canon.bookEntities）/ event=未决事件 / dialogueFact=对话依据册（meta.dialogueBook）
    const bookNames = new Set((ssot.context?.setting?.frozen?.canon?.bookEntities || []).map((b) => String(b?.name || '')));
    const booked = new Set(Object.keys(ssot.meta?.dialogueBook || {}));
    for (const [i, ne] of (step.newEntities || []).entries()) {
        if (playerId && ne.entity === playerId) errors.push(`$.newEntities[${i}].entity: 模型禁写玩家（红线 1 代码化；玩家不是入局提议者）`);
        if (ne.entity && !entityIds.has(ne.entity)) errors.push(`$.newEntities[${i}].entity: 未知提议者 "${ne.entity}"`);
        if (!ne.source?.type || !ne.source.ref) {
            errors.push(`$.newEntities[${i}].source: 无源不入局——新实体必须带源引用（book/event/dialogueFact/entity）`);
            continue;
        }
        const stype = ne.source.type;
        const ref = ne.source.ref;
        if (stype === 'event') {
            // ★leg40b 续（甲）：同上——同轮新建的未决事件可作入局之因（新人因"正在发生的这件事"入场）。
            const ev = findEvent(step, ssot, ref);
            // ★leg64 第五轮：同 `newAgendas` 那一格——**"存在但已了结"不许报成"不存在"**
            //   （用户实机贴回的那条错就是它：`ev_5_1` 在账上、但 `[已了结]`）。
            if (!ev) {
                errors.push(`$.newEntities[${i}].source: event 源必须引已存在未决事件（当前 ref="${ref}"）`);
            } else if (ev.closed) {
                errors.push(`$.newEntities[${i}].source: 「${ev.id}」（${String(ev.title || '').slice(0, 24)}）**已经了结**——`
                    + '新人要因**正在发生**的事入场；这件已经办完了，请引一件未决事件，或改用 book/dialogueFact 源');
            }
        } else if (stype === 'book') {
            if (!bookNames.has(ref)) errors.push(`$.newEntities[${i}].source: book 源必须命中书名录（当前 ref="${ref}"）`);
        } else if (stype === 'dialogueFact') {
            // ★leg32i：错误信息**不许再说假话**（用户贴回来过一条把人看懵的）：
            //   模型提议 `dialogueFact` 源、ref 指向「白小娥」——而白小娥**明明就在账上**
            //   （她是静默实体、不在依据册里）。旧信息只说"必须命中对话依据册"，读者以为账上没有这个人。
            //   ⇒ 现在按**三种真实情况**分别报：①账上已有同名实体（那就别入局，她已经在册）
            //   ②名字在依据册里但没到门槛 ③压根没被点过名。
            const existing = ssot.entities.find((e) => e.name === ref);
            if (existing && !booked.has(ref)) {
                errors.push(`$.newEntities[${i}].source: 「${ref}」**账上已有这个实体**（${existing.id}）——他/她已在册，不需要入局（dialogueFact 源是给"还没入册、但对话里反复被点名的人"用的）`);
            } else if (!booked.has(ref)) {
                errors.push(`$.newEntities[${i}].source: dialogueFact 源必须命中对话依据册（当前 ref="${ref}" 既不在依据册、也不在账上——只有"对话里反复被点名"的对象才走这一型）`);
            }
        } else if (stype === 'entity') {
            // ★leg32e（小说家条款 §3.2 第一片）：**由在册实体牵出**——给"该出场但书上没写的人"一条路。
            //   两条硬闸（全机械可核）：①牵出者**必须在册** ②**必须未灭**。
            //   为什么这两条不能松：「无源之物不存在」是"因果生成"与"凭空造人"的唯一分界；
            //   而死者不生事（与 entityFates 的"dead=终局"一致）。
            const src = ssot.entities.find((e) => e.id === ref);
            if (!src) errors.push(`$.newEntities[${i}].source: entity 源必须引出在册实体（当前 ref="${ref}" 未知实体）`);
            else if ((src.status || 'active') === 'dead') errors.push(`$.newEntities[${i}].source: entity 源不能引已覆灭实体（"${src.name}" 已灭，死者不生事）`);
        }
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
        if (!ent) { errors.push(`$.entityFates[${i}].entity: 未知实体 "${f.entity || ''}"`); continue; }
        if (playerId && f.entity === playerId) errors.push(`$.entityFates[${i}].entity: 玩家不可灭（玩家是棋子，覆灭归世界）`);
        if ((ent.status || 'active') === 'dead') errors.push(`$.entityFates[${i}].entity: 已覆灭实体不重复覆灭（dead=终局）`);
        if (!f.source?.ref) {
            errors.push(`$.entityFates[${i}].source: 覆灭提议必须带源引用（真实落账复核归引擎）`);
            continue;
        }
        // ★leg40b 续：**这一段刻意*不*享用"本轮新建事件"**（`findEvent` 只给 newAgendas/newEntities 两处用）。
        //   为什么：覆灭的语义是"**尘埃落定再言灭**"——`settle.js` 的 `applyEntityFates` 跑在 `closeEvents`
        //   **之后**，且那里还要复核"源事件必须 `closed`"。若把本轮新建的**未决**事件并进存在集，
        //   模型只要同轮"新建一件事 + 顺手宣告某人覆灭"就能绕过这条闸 ⇒ 等于把一条刻意设的闸静默拆掉。
        //   ⇒ 这一段的"已存在"**只认已落在世界账上的事件**（含归档入纪的里程碑），与修复前逐字相同。
        if (f.source.type === 'event' && !eventIds.has(f.source.ref)
            && !(ssot.milestones || []).some((m) => (m.ids || []).includes(f.source.ref))) {
            errors.push(`$.entityFates[${i}].source: event 源必须引已存在事件（当前 ref="${f.source.ref}"；归档入纪者亦可）`);
        } else if (f.source.type === 'agenda' && !agendaIds.has(f.source.ref)) {
            errors.push(`$.entityFates[${i}].source: agenda 源必须引已存在盘算（当前 ref="${f.source.ref}"）`);
        }
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
        if (!Array.isArray(step.entityUpdates) || step.entityUpdates.length > FIELD_UPDATE_PER_TICK) {
        errors.push(`$.entityUpdates: 每轮至多 ${FIELD_UPDATE_PER_TICK} 条字段变更（当前 ${Array.isArray(step.entityUpdates) ? step.entityUpdates.length : '非数组'}）——世界的连续性靠"变得慢"`);
    } else {
        const seenPairs = new Set();
        for (const [i, u] of step.entityUpdates.entries()) {
            const ent = u.entity && ssot.entities.find((e) => e.id === u.entity);
            if (!ent) { errors.push(`$.entityUpdates[${i}].entity: 未知实体 "${u.entity || ''}"`); continue; }
            if (playerId && u.entity === playerId) {
                errors.push(`$.entityUpdates[${i}].entity: 玩家不可改（红线 1；玩家的行为与承诺是唯一真相源）`);
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
                // ★leg40b 续（死锁修复）：这里**暂时仍只认世界账**（与 `entityFates` 同处一格）。
                //   语义上"为什么是现在？因为正在发生的这件事"与 newAgendas 的 event 源**同族**，
                //   并入本轮新建事件在方向上是一致的（尤其带因复活：同轮新建的事点到他的名字 + 同轮复活，
                //   正是 `settle.js:746` 那条"复活必须与被点名同轮发生"的口径）。
                //   但本笔**不顺手扩大**：用户授权的是"死锁"那一格，而这一格的收益未被实测过 ⇒
                //   登记为待办（见 docs/ledger.md 本笔"未做"条），要动先按老规矩出数。
                const ev = (ssot.events || []).find((e) => e.id === ref);
                if (!ev) { errors.push(`$.entityUpdates[${i}].cause: event 源必须引已存在事件（当前 ref="${ref}"）`); continue; }
                if (ev.closed) { errors.push(`$.entityUpdates[${i}].cause: 因必须是**未闭环**的事（"${ref}" 已了结）——不许拿旧事解释今天的变化`); continue; }
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
                    if (!(ev.ripples || []).includes(u.entity)) {
                        errors.push(`$.entityUpdates[${i}].cause: 复活必须**挂在一件提到他的未了结事上**——「${ent.name}」不在事件「${ev.title}」的波及名单里（先让那件事点到他的名字）`);
                    }
                }
            } else if (u.cause.type === 'agenda') {
                const ag = (ssot.agendas || []).find((a) => a.id === ref);
                if (!ag) { errors.push(`$.entityUpdates[${i}].cause: agenda 源必须引已存在盘算（当前 ref="${ref}"）`); continue; }
                if (ag.closed) { errors.push(`$.entityUpdates[${i}].cause: 因必须是**在飞**的盘算（"${ref}" 已结算）`); continue; }
                if (u.field === 'status') errors.push(`$.entityUpdates[${i}].field: 复活必须挂在一件**提到他的事**上（agenda 源没有波及名单，核不了这件事）`);
            }
        }
    }
    }

    // ★★★leg64 第四轮：**按需查表**（`lookupScales`，可选组）——模型点名要的刻度表。
    //   三条判据（都是机械的）：
    //     ① **点名的表名必须对回账上真有的尺**（`buildScaleTableIndex`）。对不上 ⇒ 拒
    //        ——"无源之物不入局"的表格版：模型编一个表名，引擎**不许替它造一张出来**；
    //     ② 每轮 ≤ `SCALE_ONDEMAND_TOP` 张（防"我全要"把包塞爆）；
    //     ③ 缺席合法（可选组，见 `world-step.schema.js` 那一格的注释）——本轮没要点表不是形状错误。
    //   ★★它为什么**同时把结果写进 `ssot.meta.scaleRequests`**（本仓少见的一处写账）：
    //     这一格要"**同一轮就生效**"——模型在这一轮的步里点名、出包时那张表就该在包里。
    //     而 `checkWorldStep` 正是"步 → 包"之间唯一的引擎侧关口（`settle.js` 的 gstep 线：
    //     先 check 再 buildEvolutionPack），且它**本来就返回 step**（净化掉非法项的版本是它的下游）。
    //     ⇒ 写在这里 = 模型只拿得到**核过**的表名（编的名字进不了账），且不新增一条跨模块线。
    //     生命周期：**每轮被新值覆盖**（没点名 ⇒ 写成空数组）⇒ 天然是"一次性"，不跨轮囤积
    //     （与 `injectWorldBookRecall` 头注那条"过期内容冒充新检索"的坑同一条纪律）。
    if (ssot && typeof ssot === 'object' && typeof step.lookupScales !== 'undefined') {
        const raw = Array.isArray(step.lookupScales) ? step.lookupScales : [];
        if (!Array.isArray(step.lookupScales)) {
            errors.push('$.lookupScales: 必须是字符串数组（表名照抄输入里的「刻度目录」）');
        } else if (raw.length > SCALE_ONDEMAND_TOP) {
            errors.push(`$.lookupScales: 每轮至多要 ${SCALE_ONDEMAND_TOP} 张尺（当前 ${raw.length}）——一次看不完那么多，挑这一轮真要用的`);
        } else {
            const { ok, missed } = sanitizeScaleRequests(raw, buildScaleTableIndex(ssot.context?.setting?.frozen?.canon));
            for (const nm of missed) {
                errors.push(`$.lookupScales: 账上没有《${nm}》这张尺（照抄输入「刻度目录」里的表名；编的表名不会给你造）`);
            }
            // ★**只在整步没有错误时**写账：这一步是"被拒的步不该留下任何痕迹"那条纪律
            //   （`checkWorldStep` 是纯判官，唯一被允许的副作用就是这个"同一轮生效"的交接）。
            //   写的是**核过**的表名（编的名字进不了账）。
            if (!errors.length) ssot.meta = { ...(ssot.meta || {}), scaleRequests: ok };
        }
    }

    // ③ 因果：ripple 源必须引用已存在事件（无源拒绝的语义侧）
    for (const [i, ev] of step.newEvents.entries()) {
        if (ev.source.type === 'ripple') {
            if (!ev.source.ref || !eventIds.has(ev.source.ref)) {
                errors.push(`$.newEvents[${i}].source: ripple 源必须引用已有事件（当前 ref="${ev.source.ref || ''}"）`);
            }
        } else if (ev.source.type === 'plot' && ev.source.ref) {
            if (!agendaIds.has(ev.source.ref)) {
                errors.push(`$.newEvents[${i}].source: plot 源 ref 必须是已有盘算 id`);
            }
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
    for (const ev of step.newEvents) ev.position = normalizePosition(ev.position);
    for (const a of step.actions) if (a.position != null) a.position = normalizePosition(a.position);
    for (const [i, ev] of step.newEvents.entries()) {
        if (!positions.has(ev.position)) {
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
            if (!entityIds.has(rid)) errors.push(`$.newEvents[${i}].ripples[${j}]: 未知实体 "${rid}"`);
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