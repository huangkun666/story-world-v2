// story-world-v2/src/check-step.js
// 世界步语义校验（S4）：真 schema 强制（形状）+ 身份/因果/位置/波及（语义）。
// 事件源三类与无源拒绝（§4.2）、事件位置合法性切片版（§3.2）在此落实。
import { validate } from './schema.js';
import { worldStepSchema } from './schemas/world-step.schema.js';
import { isSettingRef } from './setting.js';   // K25：设定池保留键空间判词
import { RIPPLE_TARGET_CAP } from './weight.js';   // leg25：波及上限唯一真源（此前该上限生产 0 强制点=纸面机制）
import { checkAgendaInvolvement } from './entity-lookup.js';   // 细案 §6 R2：单盘算一轮涉及实体 ≤15（唯一真源）
import { normalizePosition } from './position.js';   // leg33：剥掉引擎自己打在 location 列上的「（推）」注解（叶子模块，无环）
// leg25 c：属性白名单（INBORN_ATTR_KEYS）随 `stateChanges` 整条删除——四维浮点已不存在，没有键可白名单。

// ids 索引
function indexIds(ssot) {
    const entityIds = new Set((ssot.entities || []).map((e) => e.id));
    const agendaIds = new Set((ssot.agendas || []).map((a) => a.id));
    const eventIds = new Set((ssot.events || []).map((e) => e.id));
    const positions = new Set(ssot.context?.positions || []);
    return { entityIds, agendaIds, eventIds, positions };
}

export function checkWorldStep(step, ssot) {
    const errors = [];
    const world = ssot;   // 别名：本函数沿用 ssot 命名，涉及面计算读 world.agendas/events

    // ① 形状：真 schema 强制
    const r = validate(step, worldStepSchema);
    if (!r.ok) return { ok: false, errors: r.errors };

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
            const ev = na.source.ref && ssot.events.find((e) => e.id === na.source.ref);
            if (!ev || ev.closed) {
                errors.push(`$.newAgendas[${i}].source: event 源必须引已存在未决事件（当前 ref="${na.source.ref || ''}"）`);
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
            const ev = ssot.events.find((e) => e.id === ref);
            if (!ev || ev.closed) errors.push(`$.newEntities[${i}].source: event 源必须引已存在未决事件（当前 ref="${ref}"）`);
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
        if (f.source.type === 'event' && !eventIds.has(f.source.ref)
            && !(ssot.milestones || []).some((m) => (m.ids || []).includes(f.source.ref))) {
            errors.push(`$.entityFates[${i}].source: event 源必须引已存在事件（当前 ref="${f.source.ref}"；归档入纪者亦可）`);
        } else if (f.source.type === 'agenda' && !agendaIds.has(f.source.ref)) {
            errors.push(`$.entityFates[${i}].source: agenda 源必须引已存在盘算（当前 ref="${f.source.ref}"）`);
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

    // ④ 位置：事件/动作位置 ⊆ 世界状态位置集（§3.2：不得为贴近玩家而移动）
    //   ★leg33：先把「（推）」注解剥掉——那是**引擎自己**打在实体表 location 列上的标记（leg31），
    //     模型把格子原样抄回来（`北俱荒洲（推）`）不是编地名。**就地归一**（同一趟校验里，
    //     下游 settle 落账读到的是剥过的值；该步本来就是重建对象，不是改调用方的输入）。
    //     剥掉之后仍不在集内的 ⇒ 真·编地名，照旧拒整步（不改判据强度，只去掉引擎注解的假阳性）。
    for (const ev of step.newEvents) ev.position = normalizePosition(ev.position);
    for (const a of step.actions) if (a.position != null) a.position = normalizePosition(a.position);
    for (const [i, ev] of step.newEvents.entries()) {
        if (!positions.has(ev.position)) {
            errors.push(`$.newEvents[${i}].position: " ${ev.position}" 不在世界位置集（${[...positions].join('/')}）`);
        }
    }
    for (const [i, a] of step.actions.entries()) {
        if (a.position != null && !positions.has(a.position)) {
            errors.push(`$.actions[${i}].position: "${a.position}" 不在世界位置集`);
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

    return { ok: errors.length === 0, errors };
}