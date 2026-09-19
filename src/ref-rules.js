// story-world-v2/src/ref-rules.js
// ★★★leg67（甲案·用户 2026-09-18 拍板「所以我才想要优化项目结构，交接给下一任做吧」⇒ 细案
//   `docs/plan-structure-optimization.md` §2 落地）：**引用完整性的单一主人**。
//
// 本模块治的病（细案 §1.3：leg66 两天内三条 bug 同一个根）：
//   「**这个号在此时此地能不能这么用**」这套规矩，原先**散在五处**，每处都能各自说话——
//     ① `check-step.js`（校验期，整步拒/放行）
//     ② `sanitize-step.js`（净化期，丢单条提案）
//     ③ `settle.js`（结算期复核，事后裁定）
//     ④ `schemas/world-step.schema.js`（形状期，enum 只认几种源型）
//     ⑤ `prompts.js` + `gate.js`（教模型怎么说 + 注释里再讲一遍口径）
//   ⇒ 两把尺子必然长歪。**本仓已经实测到两处歪**（不是理论担忧）：
//     · `newEntities.source.type==='entity'` 引**已灭**实体：`check-step.js` **拒整步**（世界原样不动），
//       而 `sanitize-step.js` **只丢那一条**（其余照落）——同一份输入、两个引擎侧关口、两种后果。
//     · 已了结事件的文案两处已各自漂移（`check-step` 说"已经了结"，净化器说"已了结"）。
//   ★本模块**只收口判据，不改语义**：什么合法、什么不合法，与收口前**逐字相同**（M4 判据锁着）。
//
// ★形态纪律（照 `params.js` 是叶子的先例）：
//   **零 import**。本模块的判据只读"账上这个号在不在、开不开"——`ssot` 由调用方传进来，
//   需要 id 解析时读 `opts.step`（同轮新建的那批）。⇒ 依赖图仍是树，不引入环
//   （`check-step.js:9-15` 那条"叶子模块，无环"的留档同样适用于本文件）。
//
// ★四种消费者怎么用（**判据只住这里，渲染留在各家**——两家的输出纪律本来不同，见下方 `render`）：
//   · `check-step.js`   ：问 `judgeRef` ⇒ 不合法就把 `render(v)` 挂到 `$.foo[i].source` 后面（整步拒）。
//   · `sanitize-step.js`：问同一个 `judgeRef` ⇒ 不合法就丢**那一条**提案（全步照常落地）。
//   · `settle.js`       ：问 `judgeRef`（带 `openAtEntry` 快照）⇒ 记账为「裁定」警告。
//   · 判据表本身（`REF_RULES`）是**可枚举**的 ⇒ `test/ref-rules.test.js` 拿它做 M1/M2/M3 三条锁。

// ═════════════════════════ 一、id 解析（"这个号指的是哪一件东西"） ═════════════════════
// ★这一段原先住在 `check-step.js`（`findEvent` / `eventOrdinal` / `newEventIdsOf`），
//   而 `sanitize-step.js` 靠 `import` 它来"共用一把尺子"。收口后**尺子搬进本模块**，
//   两家都从这里拿——`check-step.js` 仍 re-export（`settle.js` 与既有用例的 import 面不动）。

/** 引擎的发号规矩：第 i 件新事件 ⇒ `ev_<tick>_<i+1>`。
 *  ★唯一真源：落账（`settle.js` 的 `hangEvents`）、校验（`check-step`）、净化器三处都读它。 */
export function newEventIdsOf(step, tick) {
    return (step?.newEvents || []).map((_, i) => `ev_${tick}_${i + 1}`);
}

/** 从"形如 `ev_<n>_<m>` 的号"里取出位次 m（不是这个形状 ⇒ null）。 */
export function eventOrdinal(ref) {
    const m = /^ev_\d+_(\d+)$/.exec(String(ref || ''));
    return m ? Number(m[1]) : null;
}

/**
 * ★★同一个号**只能有一个解析法**（这是 leg40b 续那条"两把尺子会长歪"的正面落实）。
 *
 * 口径（三条，按顺序，与收口前逐字相同）：
 *   ① **世界账优先**：账上有这个 id ⇒ 就是它（有则以账为准，不看位次）。
 *   ② **同轮按位次**：账上没有 ⇒ 看 `opts.step.newEvents` 的第 m 件（模型写 `ev_<任意轮号>_<m>`，
 *      位次对就认——**这是必须的，不是宽容**：`newEvents` 是封闭形状、模型不许写 id
 *      ⇒ 它在结构上无法知道"本轮即将新建的那件事"会被发什么号，只能按位次说）。
 *   ③ **归档入纪**：`opts.includeArchived` 时，`ssot.milestones[].ids` 里出现过的号**算存在**
 *      （覆灭那条通道要它："尘埃落定再言灭"，而入纪的里程碑已经尘埃落定）。
 *
 * @param {object} ssot  世界账（只读）
 * @param {string} ref   模型写的号
 * @param {{step?:object, includeSameRound?:boolean, includeArchived?:boolean}} [opts]
 * @returns {{target:object|null, archived:boolean, viaSameRound:boolean}}
 *   `target=null && !archived` ⇒ **账上没有这个号**（唯一的"不存在"判据）。
 */
export function resolveRefTarget(ssot, ref, opts = {}) {
    const miss = { target: null, archived: false, viaSameRound: false };
    if (!ref) return miss;
    const onWorld = (ssot?.events || []).find((e) => e.id === ref);
    if (onWorld) return { target: onWorld, archived: false, viaSameRound: false };
    if (opts.includeSameRound && opts.step) {
        const list = opts.step.newEvents || [];
        const ord = eventOrdinal(ref);
        if (ord != null && ord >= 1 && ord <= list.length) {
            const hit = list[ord - 1];
            if (hit) return { target: hit, archived: false, viaSameRound: true };
        }
    }
    if (opts.includeArchived && (ssot?.milestones || []).some((m) => (m.ids || []).includes(ref))) {
        return { target: null, archived: true, viaSameRound: false };
    }
    return miss;
}

/**
 * 覆灭那一格专用：**已归档入纪的号也算"存在"**（但**不**并本轮新建的事件）。
 * ★为什么与 `newAgendas` 那格刻意分开：覆灭的语义是"**尘埃落定再言灭**"，
 *   并入本轮新建的**未决**事件，等于把一条刻意设的闸静默拆掉（leg40b 续的边界①）。
 */
export function findFateEventSource(ssot, ref) {
    return resolveRefTarget(ssot, ref, { includeSameRound: false, includeArchived: true });
}

// ═════════════════════════ 二、"因的判定时点"快照 ═════════════════════════
/**
 * ★★★leg66 的治法搬进本模块（原 `settle.js` 的 `captureOpenCauseState`）：
 *   **进入结算那一刻，账上哪些事件/盘算是开着的**——以及已关的那些是在**第几轮**关的。
 *
 * 为什么要快照而不是实时读：`settleTick` 在结算尾声会**自己关掉一批**
 *   （源结清 / 涟漪平息 / 盘算满步结算），而"变更的因必须未闭环"的判定时点 = **批次开始时**。
 *   实时读 ⇒ 引擎会用自己的收尾动作，去否掉一条它**刚刚放行过**的合法变更
 *   （真账实测：`meta.entityFields['e_bk_297']` 零留痕，那条合法变更被静默吞掉）。
 * ★口径：**判定时点 = 进入 settle 那一刻**；引擎自己的收尾不许反过来宣布"它从来不算数"。
 *   ⚠只放宽这一格：**进来时就已经关着的真旧事照旧拒**。
 */
export function captureOpenCauseState(ssot) {
    const openEvents = new Set();
    const closedEventsAt = new Map();
    for (const ev of ssot?.events || []) {
        if (ev.closed) closedEventsAt.set(ev.id, ev.closedAt ?? null);
        else openEvents.add(ev.id);
    }
    const openAgendas = new Set();
    const closedAgendasAt = new Map();
    for (const a of ssot?.agendas || []) {
        if (a.closed) closedAgendasAt.set(a.id, a.closedAt ?? null);
        else openAgendas.add(a.id);
    }
    return { openEvents, closedEventsAt, openAgendas, closedAgendasAt };
}

// ═════════════════════════ 三、判据表（本模块的**唯一权威**） ═════════════════════
// ★形状：`{ code, message }`——`message` **逐字**就是原先各处分头手写的那句话
//   （⇒ 收口前后玩家看到的字一个不差，M4 才立得住），`code` 是给判据用的稳定标识。
// ★`remedy`（出路）**只在不合法的格子上出现**：每一条"不合法"都必须告诉模型**往哪走**
//   ——leg64 那条"报错把人领错方向"与 leg66 那条"报错把人领进死胡同"都是缺它造成的。
//   出路排在 `message` **末尾**，因为 `check-step` 的历史文案就是这个次序。

/** 事件源（event）的三种结局，按**消费者**分档。 */
const EVENT = {
    // ① 引一件未决事件（newAgendas / newEntities 两处享用"同轮新建的那批"）
    //    文案取材：leg66 §2.5 用户实机第二条裁定（`ev_7_1`）——**三条出路**，第三条才是模型想要的。
    //    ⚠「拾遗（closedRoots）→ newEvents + ripple → 再用那件新事件当源」这条**不许删**：
    //      旧文案只给"换未决事件 / 改成 state"两条，把模型合法的心愿说成不可能 ⇒ 它反复换号重试、白烧轮次。
    closedAgenda: {
        code: 'event-closed-agenda',
        message: (r) => `「${r.id}」（${r.label}）**已经了结**——`
            + '起盘算要挂在**正在发生**的事上；这件已经办完了。三条出路：'
            + '① 换一件**未决**事件当源；'
            + `② 若这就是你要接的那条旧线（它在输入的"拾遗/closedRoots"一栏里）——**先接它**：`
            + `用 newEvents 写一条 source.type="ripple" + ref="${r.id}" 的新事件（"那件事的余波现在显出来了"），`
            + '那条**新事件**就是未决的，再用它当本条的 event 源；'
            + '③ 真是局势自己拱出来的处境，才把源改成 state',
    },
    closedEntity: {
        code: 'event-closed-entity',
        message: (r) => `「${r.id}」（${r.label}）**已经了结**——`
            + '新人要因**正在发生**的事入场；这件已经办完了，请引一件未决事件，或改用 book/dialogueFact 源',
    },
    // ② 因必须是未闭环的事（entityUpdates.cause）——判定时点见上方 `captureOpenCauseState`
    //   ★这一格渲染的是**模型写的那个号**（`r.ref`），不是判官查到的对象 id。
    closedCause: {
        code: 'cause-closed-before-batch',
        message: (r) => `因必须是**未闭环**的事（"${r.ref}" 已了结）——不许拿旧事解释今天的变化`,
    },
    // entityUpdates.cause 的"不存在"文案（收口前它与 newAgendas/newEntities 那两个串**不同**，本棒原样保留）
    missingCause: {
        code: 'cause-event-missing',
        message: (r) => `event 源必须引已存在事件（当前 ref="${r.ref ?? ''}"）`,
    },
    // 同上，但**结算期复核**那一格是另一句话（leg66 拆句的成果：不许把"不存在"与"已了结"合成一句）
    missingCauseEntry: {
        code: 'cause-event-missing',
        message: (r) => `的因事件「${r.ref}」**账上根本没有这个号**（本轮的因不能是凭空生成的号）`,
    },
    // ③ 覆灭的源：**只认已落账的事**（含归档入纪），且不并本轮新建
    missingFate: {
        code: 'fate-event-missing',
        message: (r) => `event 源必须引已存在事件（当前 ref="${r.ref ?? ''}"；归档入纪者亦可）`,
    },
    // ④ ripple 源：只引**已有**事件（无源拒绝的语义侧）
    missingRipple: {
        code: 'ripple-event-missing',
        message: (r) => `ripple 源必须引用已有事件（当前 ref="${r.ref ?? ''}"）`,
    },
    // ⑤ 通用"账上没有这个号"（newAgendas / newEntities 两处）
    //   ★`r.ref ?? ''` 不是装饰：空串/缺号必须渲染成 `ref=""`——原先各处的写法就是 `${x || ''}`，
    //     写成 `r.ref` 会让"模型没给号"渲染成 `ref="undefined"`（本棒探针实测抓到过）。
    missing: {
        code: 'event-missing',
        message: (r) => `event 源必须引已存在未决事件（当前 ref="${r.ref ?? ''}"）`,
    },
};

/** 盘算源（parent / agenda / plot）的三种结局。 */
const AGENDA = {
    missingParent: {
        code: 'parent-agenda-missing',
        message: (r) => `parent 源必须引已存在盘算（当前 ref="${r.ref ?? ''}"）`,
    },
    closedParent: {
        code: 'parent-agenda-closed',
        message: () => 'parent 源必须是未结算（在飞）盘算',
    },
    missingAgenda: {
        code: 'agenda-source-missing',
        message: (r) => `agenda 源必须引已存在盘算（当前 ref="${r.ref ?? ''}"）`,
    },
    // entityUpdates.cause 那一格的"不存在"文案**与别处不同**（收口前就是两个串，本棒原样保留
    //   ——M4"行为零变化"优先于"文案统一"；要统一它是一次**玩家可见面的改动**，得单独拍板）
    missingCauseAgenda: {
        code: 'cause-agenda-missing',
        message: (r) => `agenda 源必须引已存在盘算（当前 ref="${r.ref ?? ''}"）`,
    },
    // 同上，结算期复核那一格的措辞（与事件那一格对称）
    //   ★leg67 补出路：结算期这句原先只说"没有这个号"，没说**那该怎么改**——
    //     而它的读者正是"下一步要重试"的那个模型（leg66 §2.5 的教训：报错必须给出路）。
    missingCauseAgendaEntry: {
        code: 'cause-agenda-missing',
        message: (r) => `的因盘算「${r.ref}」**账上根本没有这个号**——`
            + '因必须是一条**真实存在、还没结算**的线（照抄输入"在办的事"里的盘算 id）；'
            + '若这件事不是哪条线在办、而是局势自己拱出来的，请改用 event 源引一件正在发生的事',
    },
    missingPlot: {
        code: 'plot-agenda-missing',
        message: () => 'plot 源 ref 必须是已有盘算 id',
    },
    // ★这一格渲染的是**模型写的那个号**（`r.ref`）而不是判官查到的对象 id：
    //   文案形状是 `因必须是**未闭环**的事（"<号>" 已了结）`，号是模型手上的那把钥匙。
    closedCause: {
        code: 'cause-agenda-settled',
        message: (r) => `因必须是**在飞**的盘算（"${r.ref}" 已结算）`,
    },
};

/**
 * ★★判据表本体：`引用点 × 源型 ⇒ 判据`。
 *
 * 每个 `check(ctx)` 返回 `null`（合法）或 `{ code, message }`（不合法，**带出路**）。
 * `ctx` 由 `judgeRef` 组装，字段：
 *   · `ref` 模型写的号 · `step` 本轮步（同轮解析用）· `world` 世界账（只读）
 *   · `entry` "进入批次那一刻"的快照（可选；缺省 = 不按快照判，按当前状态判）
 *   · `bookNames` 书名录 · `booked` 对话依据册（`newEntities` 的 book/dialogueFact 两型要）
 */
/**
 * ★一个**号指向账上不存在的东西**时的共用出路（leg67 甲-余）。
 *
 * 为什么把出路写在这里、而不是让每格自己编一句：这一族（九个引用点）的病因**完全一样**——
 *   模型抄了一个账上没有的号（多半是把"书里/记忆里的名字"当成了 id，或抄漏了轮次）。
 *   出路也就一样：**照抄输入里的号**；若那个人/那条线还没在册，得先让它入局/起线。
 * ★为什么必须给出路（不是啰嗦）：leg64"报错把人领错方向"与 leg66"报错把人领进死胡同"
 *   是同一种病的两次发作——**报错不给路 ⇒ 模型反复换号重试 ⇒ 每试一次白烧一轮**。
 * ★它只补**出路**那一截；"未知实体 / 未知盘算"这两个词照旧，故玩家看惯的那句还在。
 */
const MISSING_SUFFIX = {
    entity: '——照抄输入里的**实体 id**（形如 e_xx）。若这个人还没在册，'
        + '要先用 newEntities 让他入局（带 book/event/dialogueFact/entity 源），再用他的 id',
    agenda: '——照抄输入"在办的事"里的**盘算 id**。若这条线还没立起来，要先用 newAgendas 起它（带源）',
    // ★leg95 补（写 `eventClosures` 那条规则时当场咬出来的：`MISSING_SUFFIX.event` 此前**根本不存在**，
    //   用 `?? 默认串` 兜着——那是"契约里凭空写一格"的老毛病，故当场补上真格）
    event: '——照抄输入"还没结束的事"里的**事件 id**。收场只能挂在账上真有的那件事上，不许现编一个号',
};

export const REF_RULES = {
    // ── newAgendas.source（K13 盘算树：源三型 event/parent/state） ──
    'newAgendas.source': {
        event: (c) => {
            const hit = resolveRefTarget(c.world, c.ref, { step: c.step, includeSameRound: true, includeArchived: false });
            if (!hit.target) return { ...EVENT.missing, ref: c.ref };
            if (hit.target.closed) {
                return {
                    ...EVENT.closedAgenda,
                    ref: c.ref,
                    id: hit.target.id,
                    label: String(hit.target.title || '').slice(0, 24),
                };
            }
            return null;
        },
        parent: (c) => {
            const ag = c.ref && (c.world?.agendas || []).find((a) => a.id === c.ref);
            if (!ag) return { ...AGENDA.missingParent, ref: c.ref };
            // ★leg67 甲-余：**"在飞"与"存在"不是一回事**。净化器原先只查"在不在集合里"，
            //   而它那个集合**含已结算**的盘算 ⇒ 校验面拒、净化面照收（实测抓到的第二处口径不一致）。
            //   `c.openAgendas` 由净化器传进来（只含在飞 + 本轮新建）；校验面不传 ⇒ 回落到读账上的 `closed`。
            if (c.openAgendas) {
                if (!c.openAgendas.has(c.ref)) return { ...AGENDA.closedParent, ref: c.ref };
                return null;
            }
            if (ag.closed) return { ...AGENDA.closedParent, ref: c.ref };
            return null;
        },
        // ★`state` 是"由处境而生"——**不该带 ref**（带了就是把处境伪装成一件具体的事）
        state: (c) => (c.ref
            ? { code: 'state-source-has-ref', message: () => 'state 源不应带 ref' }
            : null),
        // ★本引用点**没有**这一格：`world-step.schema.js` 的 enum 只认 event/parent/state
        //   ⇒ `check-step` 到不了这里（净化器到得了，故净化器自己处置"未知来源型"）。
    },

    // ── newEntities.source（K37 入局：源四型 book/event/dialogueFact/entity） ──
    'newEntities.source': {
        event: (c) => {
            const hit = resolveRefTarget(c.world, c.ref, { step: c.step, includeSameRound: true, includeArchived: false });
            if (!hit.target) return { ...EVENT.missing, ref: c.ref };
            if (hit.target.closed) {
                return {
                    ...EVENT.closedEntity,
                    ref: c.ref,
                    id: hit.target.id,
                    label: String(hit.target.title || '').slice(0, 24),
                };
            }
            return null;
        },
        book: (c) => (c.bookNames?.has(c.ref)
            ? null
            : { code: 'book-source-missing', message: () => `book 源必须命中书名录（当前 ref="${c.ref}"）` }),
        // ★leg32i：**错误信息不许再说假话**（用户贴回来过一条把人看懵的）——
        //   按**三种真实情况**分别说：①账上已有同名实体 ②压根没被点过名。
        //   ★leg67 补**出路**（M3 判据）：原句只说"不需要入局"，没说**那该走哪条路**
        //     ——它想让他出场，就得走 event/entity 那一型；不说清楚，模型只会换个号重试。
        dialogueFact: (c) => {
            const existing = (c.world?.entities || []).find((e) => e.name === c.ref);
            if (existing && !c.booked?.has(c.ref)) {
                return {
                    code: 'dialogue-fact-already-in-ledger',
                    message: () => `「${c.ref}」**账上已有这个实体**（${existing.id}）——他/她已在册，不需要入局。`
                        + '两条出路：① 要让他**现在出场**，改引一件**正在发生**的事（source.type="event" + ref=那件事的 id），'
                        + '或由在册实体牵出（source.type="entity" + ref=牵出者的 id）；'
                        + '② 他若本来就只是背景，本条**整条删掉**即可（不要为了让他露面而入局——他已经在册，随时可被点名）',
                };
            }
            if (!c.booked?.has(c.ref)) {
                return {
                    code: 'dialogue-fact-missing',
                    message: () => `dialogueFact 源必须命中对话依据册（当前 ref="${c.ref}" 既不在依据册、也不在账上`
                        + '——只有"对话里反复被点名"的对象才走这一型）。出路：改用 book 源（ref=书名录里的条目名，'
                        + '当前书名录里有：' + `${[...(c.bookNames || [])].slice(0, 8).join(' / ') || '（空）'}`
                        + '），或先让那件正在发生的事**点到他的名字**，再用 event 源',
                };
            }
            return null;
        },
        // ★leg32e：由在册实体牵出——两条硬闸（都在册 + 都未灭）。
        entity: (c) => {
            const src = (c.world?.entities || []).find((e) => e.id === c.ref);
            if (!src) return { code: 'entity-source-missing', message: () => `entity 源必须引出在册实体（当前 ref="${c.ref}" 未知实体）` };
            if ((src.status || 'active') === 'dead') {
                return {
                    code: 'entity-source-dead',
                    message: () => `entity 源不能引已覆灭实体（"${src.name}" 已灭，死者不生事）。`
                        + '出路：改用**另一个在册且未灭**的实体当牵出者（ref=那个活人的 id），'
                        + '或改用 book 源（ref=书名录里的条目名）',
                };
            }
            return null;
        },
    },

    // ── entityFates.source（K37 灭通道：源两型 event/agenda） ──
    // ★这一段**刻意不享用"本轮新建事件"**（见 `findFateEventSource` 头注：覆灭要尘埃落定）
    'entityFates.source': {
        event: (c) => (findFateEventSource(c.world, c.ref).target || findFateEventSource(c.world, c.ref).archived
            ? null
            : { ...EVENT.missingFate, ref: c.ref }),
        agenda: (c) => ((c.world?.agendas || []).some((a) => a.id === c.ref)
            ? null
            : { ...AGENDA.missingAgenda, ref: c.ref }),
    },

    // ── newEvents.source（源三型 plot/state/ripple） ──
    'newEvents.source': {
        // ★只认**世界账**上的事件 id（与收口前逐字相同；归档入纪不在这条路上）
        ripple: (c) => ((c.world?.events || []).some((e) => e.id === c.ref)
            ? null
            : { ...EVENT.missingRipple, ref: c.ref }),
        plot: (c) => ((c.world?.agendas || []).some((a) => a.id === c.ref)
            ? null
            : { ...AGENDA.missingPlot, ref: c.ref }),
        state: () => null,   // 由处境而生：无需引用
    },

    // ── 三个"目标实体必须在册"的引用点（覆灭 / 字段写回 / 入局提议者） ──
    // ★leg67 甲-余：这三处的**存在性判据**原先在 `check-step` 与 `sanitize-step` **各写一份**
    //   （甚至用了不同的写法：`.find()` 与 `entityIds.has()`）——典型"两把尺子"。
    //   三格各只判**存在性**；其余口径（玩家不可灭 / 已灭不可复灭 / 覆灭源要落账）是**别的判据**，留在消费口。
    'entityFates.entity': {
        id: (c) => (c.world?.entities || []).some((e) => e.id === c.ref)
            ? null
            : { code: 'fate-entity-missing', ref: c.ref, message: (r) => `未知实体 "${r.ref ?? ''}"${MISSING_SUFFIX.entity}` },
    },
    'entityUpdates.entity': {
        id: (c) => (c.world?.entities || []).some((e) => e.id === c.ref)
            ? null
            : { code: 'update-entity-missing', ref: c.ref, message: (r) => `未知实体 "${r.ref ?? ''}"${MISSING_SUFFIX.entity}` },
    },
    'newEntities.entity': {
        // ★与 `actions.entity` 同形，但**措辞不同**（这里说的是"提议者"）⇒ 各用各的 message。
        id: (c) => (c.world?.entities || []).some((e) => e.id === c.ref)
            ? null
            : { code: 'proposer-entity-missing', ref: c.ref, message: (r) => `未知提议者 "${r.ref ?? ''}"${MISSING_SUFFIX.entity}` },
    },

    // ── actions[].entity（谁走的这一步） ──
    // ★leg67 甲-余：**同一个号两处写**的又一例——`check-step.js` 说"未知实体"、
    //   `sanitize-step.js` 说"行动方…不在账上（引擎无法证明这步是谁走的）"。
    //   本格只判存在性；两句措辞各自保留（收口的是判据、不是排版）。
    //   ⚠"模型禁写玩家"**不在本格**：那条读的是 `context.playerId`（红线 1），
    //     不是"这个号在不在账上"——两条判据，别合并。
    'actions.entity': {
        id: (c) => (c.world?.entities || []).some((e) => e.id === c.ref)
            ? null
            : { code: 'actor-entity-missing', ref: c.ref, message: (r) => `未知实体 "${r.ref ?? ''}"${MISSING_SUFFIX.entity}` },
    },

    // ── newAgendas.entity（谁是这条线的属主） ──
    // ★leg67 甲-余：收口前由 `check-step.js` 与 `sanitize-step.js` **各自手写**
    //   （"未知实体" vs "属主…不在账上"）——又一个"同一件事两处实现"。
    //   本格只判**存在性**（"这个号在不在账上"），措辞由各消费者自己渲染（同 `newEvents[].ripples`）。
    'newAgendas.entity': {
        id: (c) => (c.world?.entities || []).some((e) => e.id === c.ref)
            ? null
            : { code: 'owner-entity-missing', ref: c.ref, message: (r) => `未知实体 "${r.ref ?? ''}"${MISSING_SUFFIX.entity}` },
    },

    // ── newEvents[].ripples（一次事件碰到谁：波及名单里的每一个实体号） ──
    // ★leg67 甲-余：收口前手写在 `check-step.js` 的 ⑤ 段。
    //   ★口径与别处**刻意不同**：波及名单是**逐 id** 判的（摘掉那个 id 不影响这件事本身存在，
    //     照 leg33c 位置段同一哲学），故净化面对它是"摘"不是"丢"——判据同源，处置各按自家纪律。
    //   ★本格只管**存在性**；"设定池保留键不可作引用对象"（`isSettingRef`）是**另一条**判据
    //     （K25 的保留键空间），它读的是串的形状而不是账上有没有这个号 ⇒ 留在消费口，不混进本表。
    'newEvents.ripples': {
        item: (c) => (c.world?.entities || []).some((e) => e.id === c.ref)
            ? null
            : { code: 'ripple-entity-missing', ref: c.ref, message: (r) => `未知实体 "${r.ref ?? ''}"${MISSING_SUFFIX.entity}` },
    },

    // ── agendaAdvances.agendaId（盘算推进：推一条**在飞**的线） ──
    // ★与下面 `agendaCancels` 同一族：都是"直接引用一个盘算 id"。两条都由 M2b 源码锁照出来
    //   （收口前它们手写在 `check-step.js` 里，而它们明明就是"同一个号能不能这么用"）。
    'agendaAdvances.agendaId': {
        id: (c) => ((c.world?.agendas || []).some((a) => a.id === c.ref)
            ? null
            : { code: 'advance-agenda-missing', ref: c.ref, message: (r) => `未知盘算 "${r.ref ?? ''}"${MISSING_SUFFIX.agenda}` }),
    },

    // ── agendaCancels.agendaId（K18 取消通道：取消一条**在飞**的线） ──
    // ★leg67：这一格是**源码锁当场照出来的漏网**——收口前它由 `check-step.js` 手写判词
    //   （"未知盘算" / "已结算盘算不可取消"），而它明明就是"同一个号在此时此地能不能这么用"。
    //   M2b 那条锁在改码过程中把它咬住 ⇒ 顺手收进表里（它本来就是这一类，不收就是留了第六扇门）。
    'agendaCancels.agendaId': {
        // 取消通道只有一个源面（`agendaId` 是直接引用，不是 `{type,ref}` 形状）⇒ 用 `ref` 承载它。
        //   ★旧文案把号渲染成 `"${ac.agendaId || ''}"`：空号时是 `""`，故这里 `?? ''`。
        id: (c) => {
            const ag = c.ref && (c.world?.agendas || []).find((a) => a.id === c.ref);
            if (!ag) return { code: 'cancel-agenda-missing', ref: c.ref, message: (r) => `未知盘算 "${r.ref ?? ''}"${MISSING_SUFFIX.agenda}` };
            // ★同 `parent` 那一格：`openAgendas` 传进来时以它为准（净化器原先查的集合含已结算 ⇒ 两把尺子）。
            const isOpen = c.openAgendas ? c.openAgendas.has(c.ref) : !ag.closed;
            if (!isOpen) {
                return {
                    code: 'cancel-agenda-closed',
                    ref: c.ref,
                    message: (r) => `已结算盘算不可取消（"${r.ref}"）${MISSING_SUFFIX.agenda}`,
                };
            }
            return null;
        },
    },

    // ── entityUpdates.cause（leg34 字段写回 + 带因复活：因果变更与"随口改"的唯一分界） ──    // ★判定时点 = **进入 settle 那一刻**（`entry` 快照）；没有快照时退化成"读当前状态"
    //   ——校验期（`check-step`）与净化期（`sanitize-step`）都在 settle 之前，两者等价。
    'entityUpdates.cause': {
        event: (c) => {
            const hit = resolveRefTarget(c.world, c.ref, { step: c.step, includeSameRound: false, includeArchived: false });
            if (!hit.target) {
                return { ...(c.entry ? EVENT.missingCauseEntry : EVENT.missingCause), ref: c.ref };
            }
            if (c.entry) {
                // 有快照 ⇒ 按**进来时**的状态判（leg66 的治法：引擎自己的收尾不许否掉刚放行的变更）
                if (!c.entry.openEvents.has(c.ref)) {
                    const at = c.entry.closedEventsAt.get(c.ref);
                    const title = String(hit.target.title || '').slice(0, 20);
                    return {
                        code: 'cause-closed-before-batch',
                        ref: c.ref,
                        closedAt: at ?? null,
                        label: title,
                        message: () => `的因「${c.ref}」（${title}）`
                            + `**在本批次开始前就已经了结${at != null ? `（第 ${at} 轮）` : ''}**——因果只能挂在还没了结的事上`,
                    };
                }
                return null;
            }
            if (hit.target.closed) return { ...EVENT.closedCause, ref: c.ref };
            return null;
        },
        agenda: (c) => {
            const ag = (c.world?.agendas || []).find((a) => a.id === c.ref);
            if (!ag) return { ...AGENDA.missingCauseAgendaEntry, ref: c.ref };
            if (c.entry) {
                if (!c.entry.openAgendas.has(c.ref)) {
                    const at = c.entry.closedAgendasAt.get(c.ref);
                    const goal = String(ag.goal || '').slice(0, 20);
                    return {
                        code: 'cause-agenda-settled-before-batch',
                        ref: c.ref,
                        closedAt: at ?? null,
                        label: goal,
                        message: () => `的因盘算「${c.ref}」（${goal}）`
                            + `**在本批次开始前就已经结算${at != null ? `（第 ${at} 轮）` : ''}**——因果只能挂在在办的事上`,
                    };
                }
                return null;
            }
            if (ag.closed) return { ...AGENDA.closedCause, ref: c.ref };
            return null;
        },
    },

    // ── eventClosures.event（★leg95 模型收场通道：判"这一段讲完了"） ──
    //   ★与 `entityUpdates.cause` **正相反**的一格，别搞混：那里要求"因果只能挂在**还没了结**的事上"，
    //     这里要求"只能收**还没收场**的事"——同一个号在两条通道里的资格恰好是反面。
    //   ★为什么查"当前账"而不是"同轮新立的事"：`includeSameRound:false` —— 模型只能收**已经落过账**的事，
    //     不许"刚立就收"（同轮新生的事还没发生过，收它等于把刚落的事按死，那是形态错乱不是收场）。
    'eventClosures.event': {
        id: (c) => {
            const hit = resolveRefTarget(c.world, c.ref, { step: c.step, includeSameRound: false, includeArchived: false });
            if (!hit.target) {
                return {
                    code: 'closure-event-missing',
                    ref: c.ref,
                    message: (r) => `未知事件 "${r.ref ?? ''}"${MISSING_SUFFIX.event}`,
                };
            }
            // 收场是**一次性**的动作：已经收过的不许再收。
            //   ★出路要给够（M3 那条判据锁：只说"你错了"模型会反复换号重试，一轮一轮白烧）：
            //     这一条的真出路是"**把这一项删掉**"——它已经收场了，本来就不该出现在你的提议里。
            //   ★★leg100 真机取证（用户实机那两条 `ev_6_4`/`ev_7_2`）：旧文案只说"它不在输入那份**还没结束
            //     的事**里"——那句话对 `pendingEvents` 成立，却**指错了地方**：这两个号真正的出处是包里
            //     的 **`recentClosedEvents`**（最近了结的事，尾巴 8 条），而它在 `pack.js:1020` 被剪成
            //     **只剩 id、没有标题** ⇒ 一串光秃秃的号，读起来正是一份"还能收的事"的候选池，
            //     而两个被拒的号恰好是那份尾巴的**头两条**。收场是**整步拒**（净化器不替模型摘这一项）
            //     ⇒ 模型照旧话术去"还没结束的事"里找、找不到 ⇒ 换号重试，**每试一次白烧一轮**。
            //   ★故出路要把**那个号在输入里的住处**一并点出来（与 `newAgendas.source` 那条"指拾遗"
            //     同一手法，见 `M3b`）：不然模型不知道该换哪一栏看。
            if (hit.target.closed) {
                return {
                    code: 'closure-event-closed',
                    ref: c.ref,
                    label: String(hit.target.title || '').slice(0, 20),
                    message: (r) => `事件「${r.ref}」（${String(hit.target.title || '').slice(0, 20)}）`
                        + `${hit.target.closedBy === 'model' ? '你已经判过它收场' : '**已经了结**'}——`
                        + '收场是一次性的，**把这一项删掉**'
                        + '（★这个号住在输入的 **recentClosedEvents**（最近了结的事）里——那是归档，'
                        + '**不许从那一段取号**；要收场只认 **pendingEvents**（还没结束的事）里那一批）',
                };
            }
            return null;
        },
    },
};

/** 判据点清单（自检 + M1 判据用；**顺序稳定**）。 */
export const REF_POINTS = Object.freeze(Object.keys(REF_RULES));

/**
 * ★★**唯一的判官入口**：四个消费者都只能问它。
 *
 * @param {string} point 引用点，见 `REF_POINTS`（如 `'newAgendas.source'`）
 * @param {object} source 模型写的源对象 `{type, ref}`
 * @param {object} ctx   `{world, step?, entry?, bookNames?, booked?, cause?}`
 * @returns {null|{code:string, ref:*, message:Function}}  `null` = **合法**；否则不合法**且带出路**
 */
export function judgeRef(point, source, ctx = {}) {
    const table = REF_RULES[point];
    if (!table) throw new Error(`ref-rules: 未知引用点 "${point}"（合法值：${REF_POINTS.join(' / ')}）`);
    const type = source?.type;
    const check = table[type];
    if (!check) {
        // 未知源型：形状层（`world-step.schema.js` 的 enum）已经把整步拒了 ⇒ 这里**不重复判**，
        //   只把"本模块认不出这个型"如实报出去（各家按自己的纪律处置：`check-step` 到不了这，
        //   净化器则丢那一条）。★这不算"两条判据"，它是"表里没有这一格"的显式表达。
        return { code: 'unknown-source-type', ref: source?.ref, unknownType: String(type), message: (r) => `未知来源型「${String(r.type)}」` };
    }
    const r = check({
        ref: source?.ref, step: ctx.step, world: ctx.world, entry: ctx.entry,
        bookNames: ctx.bookNames, booked: ctx.booked, openAgendas: ctx.openAgendas,
    });
    return r ? { ...r, type } : null;
}

/**
 * 渲染一条判据结果为**人话**（各家的输出纪律不同，故渲染**留在各家**——见文件头注）。
 * ★它只做一件事：把"带出路的判据文案"调出来，**不许**在调用点另写一句同义的话。
 */
export function renderVerdict(v) {
    if (!v || typeof v.message !== 'function') return '';
    return v.message({ ...v, type: v.type });
}

/**
 * ★★**布尔口**（leg67 甲-余新增）：只问"合不合法"，**不要**判词文案。
 *
 * 为什么需要它（不是"多此一举的包装"）：有些消费口**自己有一套话要说**，不该被表的文案替掉——
 *   · 净化器判 `newAgendas.entity` 说的是"属主「X」不在账上"（丢掉理由的口径）；
 *   · 净化器判 `newEvents[].ripples` 做的是"**摘掉那个 id**"（不是丢掉整件事），
 *     它要报的是"波及名单摘掉 N 个不存在的引用"。
 * ⇒ 这些地方**该问的是判据，不是文案**。若强迫它们用 `renderVerdict`，就会把净化面的话改成校验面的话
 *   （那是玩家可见面的改动，要单独拍板）；若让它们自己判，就又是第二把尺子。
 *   ⇒ `askRef` = **判据同源、排版各就各位**（本模块头注那条口径的第二个入口）。
 *
 * @returns {null|{code:string, ref:*}}  `null` = 合法；否则不合法（**不带文案**，调用方自己措辞）
 */
export function askRef(point, source, ctx = {}) {
    const v = judgeRef(point, source, ctx);
    return v ? { code: v.code, ref: v.ref } : null;
}

/** 本模块认得的源型全集（按引用点）——契约层 enum 必须与它对齐（M1 判据锁着）。 */
export const SOURCE_TYPES = Object.freeze(Object.fromEntries(
    Object.entries(REF_RULES).map(([point, table]) => [point, Object.freeze(Object.keys(table))]),
));
