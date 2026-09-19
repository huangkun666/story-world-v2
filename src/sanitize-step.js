// story-world-v2/src/sanitize-step.js
// ★★leg40b 续·**死锁修复（丙之一）**：把写歪的那几条提议**丢掉**，让这一轮照样能落地。
//
// 为什么需要它（世界永久停摆的机制，本笔在真源上追到底）：
//   `settleTick` 的纪律是**整步校验**——`checkWorldStep` 报一条错 ⇒ **整步退回、tick 不推进**
//   （`settle.js:840-843`）。而模型一轮会写十几条提议，**一条写歪（少个 position、引错 id）就陪葬整轮**；
//   下一轮它读回同一份账、递同一个包 ⇒ 很可能**又**写歪同一个地方 ⇒ **永久停摆、无自愈**。
//
//   ★本仓**早有正确先例**：`settle.js` 的 `spawnEntities`（"同名新实体 ⇒ 只丢那条提议"，leg32f）
//     与 `check-step` 的位置段（"集外 ⇒ 照收 + 留痕"，leg33c）。它们的共同口径是：
//     **无害的毛病不该陪葬整步，该被丢掉的那条丢掉、并留痕**。
//     本模块就是把这条口径扩到**校验期**：消掉"整步全有或全无"这个形状。
//
// 口径（四条，都能机械核）：
//   ① **只丢非法的，不修不合法的**：本模块**不改写**模型写的内容（不改 id、不改位置、不补字段）——
//      它只做减法。改写＝引擎替模型创作，那是另一件事（且是"编事实"的边界）。
//   ② **连锁**：丢了一件新事件 ⇒ 引它的盘算/新实体/覆灭/字段变更也留不住（否则第二轮仍不合法）。
//      判据是"引用闭包"：任何一条的来路被丢掉，它自己也得丢。**反复扫到不动点**。
//   ③ **确定性**：同样输入 ⇒ 逐字节同样输出（同一轮重放必须同结果）。
//   ④ **绝不越权**：不做额度裁定（上限、洪峰、门控都归 `settle.js`），不判断语义对错——只核**存在性/形状**。
//
// ★**一把尺子**：本文件的所有"存在性"判词**必须**与 `check-step.js` 同源（`import` 它的真源），
//   不许自己再写一套 `find`——本仓 leg32/leg33 的教训是"两把尺子会长歪"（选择器偏心、判据各写一份）。
import {
    findEvent, newEventIdsOf,
    FIELD_UPDATE_PER_TICK, ENTITY_IMMUTABLE_FIELDS,
} from './check-step.js';
// ★★★leg67（甲案）：**判据问单一主人**——`src/ref-rules.js` 的 `judgeRef`（零 import 的叶子模块）。
//   ★为什么必须问它而不是自己写：本文件与 `check-step.js` 原先各手写一份"这个号能不能这么用"，
//     已经**实测长歪**（引已灭实体的牵出者：那边拒整步、这边丢一条）。细案 §1.3：三条 bug 同一个根。
//   ★**口径一个字不放宽**：本文件只用它的**判据**（合法/不合法 + 哪个 code），
//     文案另走本文件自己的口（见下方 `SANITIZE_TEXT`）——净化器的理由是"丢掉理由"，
//     与校验面（`$.foo[i].source: …` 整步拒）本来就不同形，两者都得是**逐字未变**（M4 判据锁着）。
import { judgeRef, askRef } from './ref-rules.js';
import { isSettingRef } from './setting.js';
import { RIPPLE_TARGET_CAP } from './weight.js';
import { normalizePosition } from './position.js';

/**
 * ★leg67：净化面的**文案口**——只放"与校验面措辞不同"的那几条（key = `ref-rules.js` 的判据 code）。
 * ★为什么不把两套话合成一句：本文件产出的是 `dropped[].reason`（面板裁定条 + `simLog`），
 *   校验面产出的是 `$.路径: …`。**收口的是判据，不是排版**——两处排版各有各的读者。
 * ⚠没列在这里的 code 一律回落到 `ref-rules.js` 的文案（那份文案**带出路**，是模型能照做的那份）。
 */
const SANITIZE_TEXT = {
    'event-closed-agenda': (r) => `事件源「${r.ref}」已了结`,
    'event-closed-entity': (r) => `事件源「${r.ref}」已了结`,
    'event-missing': (r) => `事件源「${r.ref}」不在账上（本轮也没新建它）`,
    'parent-agenda-missing': (r) => `父盘算「${r.ref}」不在飞`,
    'state-source-has-ref': () => 'state 源不该带 ref',
    'entity-source-missing': (r) => `牵出者「${r.ref}」不在账上`,
    'entity-source-dead': (r) => `牵出者「${r.ref}」已灭（死者不生事）`,
    'fate-event-missing': (r) => `源事件「${r.ref}」不在账上（覆灭要尘埃落定，只认已落账的事）`,
    'agenda-source-missing': (r) => `源盘算「${r.ref}」不在账上`,
    'cause-event-missing': (r) => `因「${r.ref}」不在账上`,
    'cause-agenda-missing': (r) => `因「${r.ref}」不在账上`,
    'cause-closed-before-batch': (r) => `因「${r.ref}」已了结（因果只能挂在正在发生的事上）`,
    'cause-agenda-settled': (r) => `因「${r.ref}」已结算`,
};

/** 判一个引用并给出**净化面的理由文案**（判据来自单一主人，措辞来自上面那张小表）。 */
const dropVerdictOf = (point, source, ctx) => {
    const v = judgeRef(point, source, ctx);
    if (!v) return null;
    const own = SANITIZE_TEXT[v.code];
    return own ? own(v) : v.message(v);
};

/** 引擎最外层要求的七个组（缺键＝形状不合法＝整步被拒）。净化器**只保证自己的输出有这七个键**。 */
const STEP_KEYS = ['actions', 'newEvents', 'agendaAdvances', 'newAgendas', 'agendaCancels', 'newEntities', 'entityFates', 'entityUpdates'];

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** 给"被丢掉的那条"起个人话名字（落痕用；不追求完整，够认人即可）。 */
function labelOf(family, item) {
    if (!item || typeof item !== 'object') return '';
    if (family === 'newEvents') return str(item.title);
    if (family === 'newAgendas') return `${str(item.entity)} 的「${str(item.goal)}」`;
    if (family === 'newEntities') return str(item.name);
    if (family === 'agendaAdvances') return str(item.agendaId);
    if (family === 'agendaCancels') return str(item.agendaId);
    if (family === 'entityFates') return str(item.entity);
    if (family === 'entityUpdates') return `${str(item.entity)}.${str(item.field)}`;
    if (family === 'eventClosures') return str(item.event);
    if (family === 'actions') return `${str(item.entity)} ${str(item.verb)}`;
    return '';
}

/**
 * ★死锁修复的净化器：丢掉"注定过不了校验"的提议，返回**可落地的等价步骤** + 丢了些什么的清单。
 * @param {object} step  模型交回的世界步（形状可能已经不对——故全字段都当"可能缺"处理）
 * @param {object} ssot  当前世界账（只读；本函数**不修改**它，也不修改 `step`）
 * @returns {{step:object, dropped:Array<{family:string,index:number,label:string,reason:string}>}}
 *   同轮引用的解析走 `check-step.js` 的 `findEvent`（**按位次**，与引擎发号同源）⇒ 净化器不自己算 id，
 *   调用方也不需要再传什么名单（第一版设计过"传 id 名单"，被测出来的两条事实推翻了：
 *   ① `newEvents` 是封闭形状、**模型根本不许写 id**；② 位次解析对"模型猜错轮号"同样有效）。
 */
export function dropInvalidProposals(step, ssot) {
    const src = step && typeof step === 'object' ? step : {};
    const world = ssot && typeof ssot === 'object' ? ssot : {};
    const dropped = [];

    const entityIds = new Set(arr(world.entities).map((e) => e?.id));
    const agendaIds = new Set(arr(world.agendas).map((a) => a?.id));
    // ★leg67：`newEntities.source` 的 book / dialogueFact 两型要查这两本册子 ⇒ 与校验面**同一把尺**
    //   （`check-step.js` 第 ②d 段同源；两处都从 `ssot` 现取，谁都不另立一份口径）。
    const bookNames = new Set((world.context?.setting?.frozen?.canon?.bookEntities || []).map((b) => String(b?.name || '')));
    const booked = new Set(Object.keys(world.meta?.dialogueBook || {}));

    // ---- 第 0 步：形状兜底（只补"七个键在场"，不补内容——缺键是模型的问题，不是我们替它编）----
    let cur = {};
    for (const k of STEP_KEYS) cur[k] = arr(src[k]);
    // 非七组的合法可选字段照原样带走（净化器不是契约白名单，不该顺手删模型没写歪的东西）
    for (const [k, v] of Object.entries(src)) if (!(k in cur)) cur[k] = v;

    // ---- 第 1 步：组内自明非法（不需要跨组信息就能判死的）----
    cur = {
        ...cur,
        newEvents: cur.newEvents.filter((ev, i) => {
            if (!ev || typeof ev !== 'object') return keep(dropped, 'newEvents', i, ev, '不是对象');
            if (!str(ev.title)) return keep(dropped, 'newEvents', i, ev, '缺标题');
            if (!str(ev.position)) return keep(dropped, 'newEvents', i, ev, '缺位置（位置是必填——空着就是空着，但不能没有）');
            if (!ev.source || !str(ev.source.type)) return keep(dropped, 'newEvents', i, ev, '缺事件源（无源之物不存在）');
            if (arr(ev.ripples).length > RIPPLE_TARGET_CAP) return keep(dropped, 'newEvents', i, ev, `波及名单超上限（${arr(ev.ripples).length} > ${RIPPLE_TARGET_CAP}）`);
            // ★★★leg67（甲案）：事件源（plot/state/ripple）判据问单一主人。
            //   ★补上这一格（收口前净化器**根本不判** `newEvents.source`）：M1 判据"两个消费口结论必须一致"
            //     当场照出来的第二处不一致——同一个"不存在的 ripple 源"，校验面**拒整步**、净化面**照收**。
            //     这条补上很要紧：净化器的存在意义就是"交出去的步能过校验"，它放行一个必然被拒的步，
            //     等于把降级重试那条路**白走一轮**（下一轮照旧被拒 ⇒ 只能掉进"世界安静一步"）。
            const srcWhy = dropVerdictOf('newEvents.source', ev.source, { world, step: cur });
            if (srcWhy) return keep(dropped, 'newEvents', i, ev, srcWhy);
            // ★模型**本不该**写事件 id（id 由引擎发）；真写了、又与世界账里某件旧事件撞号 ⇒ 丢掉。
            //   为什么这条必须在这里：`hangEvents` 会**无条件**用 `ev_<tick>_<n>` 覆盖，但撞号期间
            //   `findEvent`（世界账优先）会把引用解析到**那件旧事件**上 ⇒ 盘算的来路会指错东西。
            if (str(ev.id) && arr(world.events).some((e) => e?.id === str(ev.id))) {
                return keep(dropped, 'newEvents', i, ev, `id「${str(ev.id)}」与世界账已有事件撞号`);
            }
            return true;
        }),
        actions: cur.actions.filter((a, i) => {
            if (!a || typeof a !== 'object') return keep(dropped, 'actions', i, a, '不是对象');
            if (!str(a.entity)) return keep(dropped, 'actions', i, a, '缺行动方');
            if (!str(a.verb)) return keep(dropped, 'actions', i, a, '缺动作');
            return true;
        }),
        newEntities: cur.newEntities.filter((ne, i) => {
            if (!ne || typeof ne !== 'object') return keep(dropped, 'newEntities', i, ne, '不是对象');
            if (!str(ne.name)) return keep(dropped, 'newEntities', i, ne, '缺名字');
            if (!ne.source || !str(ne.source.type) || !str(ne.source.ref)) return keep(dropped, 'newEntities', i, ne, '无源不入局（必须带源引用）');
            if (ne.location != null && typeof ne.location === 'string' && ne.location !== '' && !str(ne.location)) {
                return keep(dropped, 'newEntities', i, ne, '位置是空串（给了就得有值）');
            }
            return true;
        }),
        agendaAdvances: cur.agendaAdvances.filter((ad, i) => {
            if (!ad || typeof ad !== 'object') return keep(dropped, 'agendaAdvances', i, ad, '不是对象');
            if (!str(ad.agendaId) || !str(ad.step)) return keep(dropped, 'agendaAdvances', i, ad, '缺盘算 id 或本步内容');
            return true;
        }),
        agendaCancels: cur.agendaCancels.filter((ac, i) => {
            if (!ac || typeof ac !== 'object') return keep(dropped, 'agendaCancels', i, ac, '不是对象');
            if (!str(ac.agendaId)) return keep(dropped, 'agendaCancels', i, ac, '缺盘算 id');
            return true;
        }),
        newAgendas: cur.newAgendas.filter((na, i) => {
            if (!na || typeof na !== 'object') return keep(dropped, 'newAgendas', i, na, '不是对象');
            if (!str(na.entity)) return keep(dropped, 'newAgendas', i, na, '缺属主');
            if (!str(na.goal)) return keep(dropped, 'newAgendas', i, na, '缺目标（一条没有目标的线不是线）');
            // `visibility` 是 schema 必填且只有两个取值；`maxSteps` 有硬区间 1..8。
            //   ★这两条本笔补上（自己用例抓出来的缺口）：第一版只核"存不存在"，于是 `maxSteps: 99`
            //     会**原样递给引擎**、再由 schema 判死整步——净化器就白净化了。
            if (na.visibility !== 'known' && na.visibility !== 'concealed') return keep(dropped, 'newAgendas', i, na, `visibility 必须是 known/concealed（当前 "${str(na.visibility)}"）`);
            if (na.maxSteps != null && (!Number.isInteger(na.maxSteps) || na.maxSteps < 1 || na.maxSteps > 8)) {
                return keep(dropped, 'newAgendas', i, na, `maxSteps 越界（1..8，当前 ${String(na.maxSteps)}）`);
            }
            return true;
        }),
        entityFates: cur.entityFates.filter((f, i) => {
            if (!f || typeof f !== 'object') return keep(dropped, 'entityFates', i, f, '不是对象');
            if (!str(f.entity) || f.verdict !== 'dead') return keep(dropped, 'entityFates', i, f, '缺目标或裁断不是 dead');
            if (!f.source || !str(f.source.type)) return keep(dropped, 'entityFates', i, f, '缺源（覆灭必须有据）');
            return true;
        }),
        entityUpdates: cur.entityUpdates.filter((u, i) => {
            if (!u || typeof u !== 'object') return keep(dropped, 'entityUpdates', i, u, '不是对象');
            if (!str(u.entity) || !str(u.field) || !str(u.value)) return keep(dropped, 'entityUpdates', i, u, '缺实体/字段/值');
            if (ENTITY_IMMUTABLE_FIELDS.includes(u.field)) return keep(dropped, 'entityUpdates', i, u, `"${u.field}" 不可改（引擎簿记/主键）`);
            if (!u.cause || !str(u.cause.type) || !str(u.cause.ref)) return keep(dropped, 'entityUpdates', i, u, '无因之变（必须带因）');
            return true;
        }),
    };

    // 位置统一过一遍归一（剥「（推）」注解）——与 check-step ④ 段同一把尺子（`normalizePosition` 是叶子模块）。
    //   为什么净化器也要做：模型抄回带注解的地名时，校验器的留痕与落账都按"归一后"处理，
    //   净化器若按原文比对，会拿一个**引擎根本不会用的串**去判（两把尺子）。
    cur = {
        ...cur,
        newEvents: cur.newEvents.map((ev) => (ev && typeof ev === 'object' && ev.position != null
            ? { ...ev, position: normalizePosition(ev.position) } : ev)),
        actions: cur.actions.map((a) => (a && typeof a === 'object' && a.position != null
            ? { ...a, position: normalizePosition(a.position) } : a)),
    };

    // ---- 第 2 步：跨组存在性 + 连锁，反复扫到**不动点**（丢一件新事件 ⇒ 引它的那几条也留不住）----
    for (let pass = 0; pass < 8; pass += 1) {
        const liveAgendas = new Set([...agendaIds, ...cur.newAgendas.map((a) => str(a.id)).filter(Boolean)]);
        // ★leg67 甲-余：**"在飞"与"存在"不是一回事**（本棒实测到的第二处口径不一致）。
        //   `liveAgendas` 一直**含已结算**的盘算（判定时只用了"在不在集合里"），于是：
        //     · `newAgendas` 的 `parent` 源引一条**已结算**的线 ⇒ 校验面拒、净化面照收；
        //   ⇒ 这里补一个**只含在飞**的集合给"要求未结算"的那两格用。
        //   ⚠`agendaAdvances` **继续用 `liveAgendas`**：它的口径是"存在性"（校验面也只查存在），
        //     改成 open-only 会变成**新的**语义改动（推进一条已结算的线从"上报"变成"丢掉"）——
        //     那是另一格的事，不在本棒范围（见 ref-rules 该格头注）。
        const openAgendas = new Set([
            ...arr(world.agendas).filter((a) => a && !a.closed).map((a) => a.id),
            ...cur.newAgendas.map((a) => str(a.id)).filter(Boolean),
        ]);
        // ★leg67：这里原先还有一个 `evOk`（"事件在不在"的本地判词）——**已删除**：
        //   "事件引用算不算存在"现在只有一处实现（`ref-rules.js` 的 `resolveRefTarget`，
        //   由 `judgeRef` 的表按引用点选 includeSameRound/includeArchived）。
        //   留着它就是第三把尺子（本仓 leg32/leg33 的教训：两把尺子会长歪）。

        const next = {
            ...cur,
            // ★★★leg95（模型收场通道）：净化器的存在意义是"交出去的步能过校验"，
            //   所以这里也要问**同一个主人**（`ref-rules.js` 的 `'eventClosures.event'`）——
            //   收一条"不在账上"或"已经收过场"的事，校验面必拒整步 ⇒ 那一步白走。
            //   ★`includeSameRound` 在判据表里已固定为 false（只能收已落账的事，不许刚落就收）。
            eventClosures: arr(cur.eventClosures).filter((ec, i) => {
                const id = str(ec && typeof ec === 'object' ? ec.event : ec);
                if (!id) return keep(dropped, 'eventClosures', i, ec, '缺事件 id');
                const why = dropVerdictOf('eventClosures.event', { type: 'id', ref: id }, { world, step: cur });
                if (why) return keep(dropped, 'eventClosures', i, ec, why);
                return true;
            }),
            actions: cur.actions.filter((a, i) => {
                // ★★★leg67 甲-余：存在性**问单一主人**（`askRef` = 只要判据、不要判词）；
                //   本文件那句"引擎无法证明这步是谁走的"保持不变。
                if (!askRef('actions.entity', { type: 'id', ref: a.entity }, { world, step: cur })) return true;
                return keep(dropped, 'actions', i, a, `行动方「${str(a.entity)}」不在账上（引擎无法证明这步是谁走的）`);
            }),
            agendaAdvances: cur.agendaAdvances.filter((ad, i) => (liveAgendas.has(str(ad.agendaId))
                ? true
                : keep(dropped, 'agendaAdvances', i, ad, `盘算「${str(ad.agendaId)}」不在账上/本轮也没立起来`))),
            agendaCancels: cur.agendaCancels.filter((ac, i) => {
                // ★leg67 甲-余：取消**一条已结算的线**是"未知盘算/已结算"那一族的判据 ⇒ 问单一主人
                //   （原先只查 `liveAgendas`（含已结算）⇒ 校验面拒、净化面照收）。
                if (liveAgendas.has(str(ac.agendaId))) {
                    const why = dropVerdictOf('agendaCancels.agendaId', { type: 'id', ref: ac.agendaId }, { world, step: cur });
                    if (why) return keep(dropped, 'agendaCancels', i, ac, why);
                    return true;
                }
                return keep(dropped, 'agendaCancels', i, ac, `盘算「${str(ac.agendaId)}」不在账上/本轮也没立起来`);
            }),            newAgendas: cur.newAgendas.filter((na, i) => {
                // ★★★leg67 甲-余：属主存在性**问单一主人**（`askRef` = 只要判据、不要判词）——
                //   本文件自己那套话（"属主「X」不在账上"）保持不变，收口的是判据、不是排版。
                if (askRef('newAgendas.entity', { type: 'id', ref: na.entity }, { world, step: { newEvents: cur.newEvents } })) {
                    return keep(dropped, 'newAgendas', i, na, `属主「${str(na.entity)}」不在账上`);
                }
                // ★★★leg67（甲案）：三型判据问单一主人（`ref-rules.js` 的 `'newAgendas.source'` 表）。
                //   ★原先这里是**自己手写**的三型分派，与 `check-step.js` 那份是两把尺子（细案 §1.3 的病根）。
                //   ★"未知来源型"仍由本文件自己处置：校验面到不了那里（`world-step.schema.js` 的 enum
                //     会先拒整步），而净化器**必须**替它兜住——它要保证交出去的步能过校验。
                const st = na.source?.type;
                if (st !== 'event' && st !== 'parent' && st !== 'state') {
                    return keep(dropped, 'newAgendas', i, na, `未知来源型「${str(st)}」`);
                }
                const why = dropVerdictOf('newAgendas.source', na.source, {
                    world, step: { newEvents: cur.newEvents }, openAgendas,
                });
                if (why) return keep(dropped, 'newAgendas', i, na, why);
                return true;
            }),
            newEntities: cur.newEntities.filter((ne, i) => {
                const st = ne.source?.type;
                // ★★★leg67 甲-余：提议者存在性**问单一主人**。
                //   ★`ne.entity &&` 这个守卫不能省（提议者可省 ⇒ 没写 ≠ 未知；见 check-step 同处注释）。
                if (ne.entity && askRef('newEntities.entity', { type: 'id', ref: ne.entity }, { world, step: cur })) {
                    return keep(dropped, 'newEntities', i, ne, `提议者「${str(ne.entity)}」不在账上`);
                }
                // ★★★leg67（甲案）：四型**全部**问单一主人（`'newEntities.source'` 表）。
                //   ★补 `book` / `dialogueFact` 两型（收口前本文件对它们**根本不判**）：
                //     M1 判据"两个消费口结论必须一致"当场把这条不一致照出来了——
                //     同一个"书名录里没有的条目"，校验面**拒整步**、净化面**照收**（细案 §1.3 那类病的又一例）。
                //   ★那两型要查书名录与对话依据册 ⇒ 与校验面**同一把尺**（从 `ssot` 现取，不另立口径）。
                if (st !== 'event' && st !== 'entity' && st !== 'book' && st !== 'dialogueFact') {
                    return keep(dropped, 'newEntities', i, ne, `未知来源型「${str(st)}」`);
                }
                const why = dropVerdictOf('newEntities.source', ne.source, {
                    world, step: { newEvents: cur.newEvents }, bookNames, booked,
                });
                if (why) return keep(dropped, 'newEntities', i, ne, why);
                return true;
            }),
            entityFates: cur.entityFates.filter((f, i) => {
                // ★★★leg67 甲-余：目标存在性**问单一主人**（原先这里用 `.find()`、校验面用 `entityIds`——两把尺子）。
                if (askRef('entityFates.entity', { type: 'id', ref: str(f.entity) }, { world, step: cur })) {
                    return keep(dropped, 'entityFates', i, f, `目标「${str(f.entity)}」不在账上`);
                }
                const who = arr(world.entities).find((e) => e?.id === str(f.entity));
                if ((who.status || 'active') === 'dead') return keep(dropped, 'entityFates', i, f, `目标「${str(f.entity)}」已灭（dead=终局）`);
                // ★★★leg67（甲案）：两型判据问单一主人（`'entityFates.source'` 表）。
                //   ★覆灭的源**只认世界账**（与 check-step 同一口径：尘埃落定再言灭）——那条边界
                //     现在写在 `ref-rules.js` 的 `findFateEventSource` 里，两处不可能再各说各话。
                const why = dropVerdictOf('entityFates.source', f.source, { world, step: cur });
                if (why) return keep(dropped, 'entityFates', i, f, why);
                return true;
            }),
            entityUpdates: cur.entityUpdates.filter((u, i) => {
                // ★★★leg67 甲-余：目标存在性**问单一主人**。
                if (askRef('entityUpdates.entity', { type: 'id', ref: str(u.entity) }, { world, step: cur })) {
                    return keep(dropped, 'entityUpdates', i, u, `目标「${str(u.entity)}」不在账上`);
                }
                const t = u.cause?.type;
                if (t !== 'event' && t !== 'agenda') {
                    return keep(dropped, 'entityUpdates', i, u, `未知因型「${str(t)}」`);
                }
                // ★★★leg67（甲案）：判据问单一主人（`'entityUpdates.cause'` 表）。
                //   ★这里**不传 `entry` 快照**：净化器跑在 `settleTick` **之前**（`tick.js` 的降级重试线），
                //     那一刻的"当前状态"就是 settle 进来时的状态 ⇒ 与快照判据等价（见 ref-rules 表头注）。
                const why = dropVerdictOf('entityUpdates.cause', u.cause, { world, step: { newEvents: cur.newEvents } });
                if (why) return keep(dropped, 'entityUpdates', i, u, why);
                return true;
            }),
        };

        // ripples 里出现"不存在/本轮建不起来的实体" ⇒ **只摘掉那个 id**（不是丢整件事件：
        //   波及名单是"这件事碰到了谁"，摘一个错 id 不影响这件事本身存在——与 leg33c 位置段同一哲学）
        // ★★★leg67 甲-余：**存在性问单一主人**（`askRef('newEvents.ripples', …)`），
        //   而"设定池保留键"（`isSettingRef`）照旧由本文件自己判——那是**另一条判据**
        //   （读串的形状，不读账），两者合成"这个 id 该不该摘"（见 ref-rules 该格头注）。
        next.newEvents = next.newEvents.map((ev) => {
            const badRef = (r) => Boolean(askRef('newEvents.ripples', { type: 'item', ref: r }, { world, step: cur })) || isSettingRef(r);
            const bad = arr(ev.ripples).filter(badRef);
            if (!bad.length) return ev;
            dropped.push({ family: 'newEvents', index: -1, label: str(ev.title), reason: `波及名单摘掉 ${bad.length} 个不存在的引用（${bad.join('/')}）` });
            return { ...ev, ripples: arr(ev.ripples).filter((r) => !badRef(r)) };
        });

        // 额度类（不越权判对错，只裁"超过引擎自己发布的上限"那部分——与 settle.js 的裁定口径同源）
        if (next.entityUpdates.length > FIELD_UPDATE_PER_TICK) {
            for (let i = FIELD_UPDATE_PER_TICK; i < next.entityUpdates.length; i += 1) {
                dropped.push({ family: 'entityUpdates', index: i, label: labelOf('entityUpdates', next.entityUpdates[i]), reason: `超过每轮上限 ${FIELD_UPDATE_PER_TICK} 条` });
            }
            next.entityUpdates = next.entityUpdates.slice(0, FIELD_UPDATE_PER_TICK);
        }
        // ★关于"单盘算一轮涉及 ≤15"（`checkAgendaInvolvement`）：**本净化器不处理它**，如实说明为什么：
        //   那条闸读的是 `(step, world)` ⇒ 只算**世界账里在飞盘算**的被涉及面，与"本轮新建的盘算"无关；
        //   而它的输入面（属主 + 本步全部 actions + 波及名单）里，能被"丢掉一条提议"削掉的只有波及名单，
        //   一旦超限就丢不干净 ⇒ 靠丢提议降级**治不了它**（只能丢 actions/属主，越丢越伤世界）。
        //   ⇒ 归"③ 世界安静一步"那条兜底路径处理（真账至今零次触发，见 settle.js:39 的留档）。

        const stable = STEP_KEYS.every((k) => next[k].length === cur[k].length);
        cur = next;
        if (stable) break;
    }

    return { step: cur, dropped };
}

/** 只在"决定丢掉"时返回 false，顺手把留痕记进 dropped（读起来像过滤器，语义是"留 or 丢 + 记账"）。 */
function keep(dropped, family, index, item, reason) {
    dropped.push({ family, index, label: labelOf(family, item), reason });
    return false;
}
