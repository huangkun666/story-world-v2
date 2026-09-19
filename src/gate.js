// story-world-v2/src/gate.js
// 主动作权门控（K2，分量引擎细案 §3.2）：静默判定 + 触发例外 + simLog 审计。
// K37/实体治理 §3.7（三点过滤②③）：retired/dead 实体从门控面整体剔除——
//   silent 判定跳过（不进静默名单）、named 点名列拆（不构成豁免/监听）、newEntities 提议按提议者判定；
// 纯函数：不改输入 step/world，返回过滤后的世界步与滤除统计。
// 语义：静默 = 不主动（actions/盘算推进/plot 事件/入局提议），不是消失——静默方始终是合法客体；
//       被点名可应答（未决事件波及 ∪ 其他实体动作目标 ∪ 玩家落子事实对象），下一轮重新判定。
//
// ============================ leg24 片3「拆引擎裁定」============================
// 旧法：**分量 < SILENCE_THRESHOLD（人物 0.25 / 势力 0.50）→ 静默**——拿那个 0-1 的分数当判据。
// 用户 2026-09-11 拍板：那个数不要了（它没法客观，而且在暗地里替引擎做决定）。
// 实测（全量棋盘 346 实体 100t，见 docs/slice3-verdict-teardown-spec.md §2）：**静默线以下 345/346**——
//   静止衰减（久未出手就扣分）把"没出手过的在册实体"一路磨到 0 → 全体越线 → 引擎基本禁止所有人出手。
// 新法（结构三条件，全部可从账本数出来、零阈值调参）：
//   **同时满足三条才静默**：①手上没有在办的盘算（无未决 agenda）
//                          ②久未出手（lastActiveTick 不存在或距今 ≥ QUIET_TICKS）
//                          ③无人点名（不在未决事件波及里、不是本轮动作目标/落子对象）
//   任一不成立 → 活跃。设计依据：重心＝盘算（design-core §3.4）——手上没在办的事、又久没露面、
//   又没人提到你，这一轮确实没有你出手的理由；反过来只要有一条成立，你就该被放进门。
//   `lastActiveTick` 不存在 = **从没出过手**（不是"很久以前出过手"）：同属②，语义上更该让路。
// ============================ leg24 片3「拆引擎裁定」============================
export const QUIET_TICKS = 3;   // 提案（片3 新增）：静默判定里"久未出手"的轮数门（原 SILENCE_THRESHOLD 已删）

export function gateWorldStep(step, world, moveFact = null, spotlight = null) {
    const agendaOwner = new Map((world.agendas || []).map((a) => [a.id, a.owner]));
    // ★★leg32g：**"这一轮被轮到的人"名单**（引擎每轮机械选出、随包一起递给模型的那 12 个）。
    //   为什么它必须在这里也算一份：静默门的语义是"不许主动作"，而那 614 人**从没出手过、也没人点名**
    //   ⇒ 按结构三条件永远静默 ⇒ **模型就算照名单给他们开线，提议也会被这道门丢掉**（自锁闭环的第二半）。
    //   ⇒ 名单上的人**获得一次"起头"的资格**（只限 newAgendas：自己立一条线，从此成为活跃方）。
    //   ★边界：①名单由引擎机械选出（不是模型自选，模型改不了它）②只放开"起头"这一种主动作
    //   ③已有盘算属主本来就不静默 ④每轮仍受 perTick/topLevel 两道闸管 ⇒ 不会炸量。
    const spotlightSet = spotlight instanceof Set ? spotlight : new Set(spotlight || []);
    // K37：状态面（active 才算门控成员；retired/dead 从点名/静默/提议面剔除）
    const statusOf = new Map(world.entities.map((e) => [e.id, e.status || 'active']));
    const gated = (e) => (statusOf.get(e.id) ?? 'active') === 'active';

    // 本轮"点名"面（③的输入，同时是触发例外的依据）
    const named = new Set();
    for (const ev of world.events || []) {
        if (!ev.closed) for (const r of ev.ripples || []) if (gated({ id: r })) named.add(r);
    }
    for (const a of step.actions || []) if (a.target && gated({ id: a.target })) named.add(a.target);
    if (moveFact?.object && gated({ id: moveFact.object })) named.add(moveFact.object);

    // 结构三条件（片3）：无在办盘算 ∧ 久未出手 ∧ 无人点名
    const tick = world?.meta?.tick ?? 0;
    const hasOpenAgenda = new Set((world.agendas || []).filter((a) => !a.closed).map((a) => a.owner));
    const actedRecently = (id) => {
        const e = (world.entities || []).find((x) => x.id === id);
        return typeof e?.lastActiveTick === 'number' && (tick - e.lastActiveTick) < QUIET_TICKS;
    };

    // top-1 保送（原"永不静默"防全静默；判据由分量改为实体序首个 active 实体——确定性、无分数）
    let topId = null;
    for (const e of world.entities) {
        if (!gated(e)) continue;
        topId = e.id;
        break;
    }

    const silentSet = new Set();
    for (const e of world.entities) {
        if (!gated(e)) continue;
        if (e.id === topId) continue;                       // 保送：世界里永远至少有人可动
        if (hasOpenAgenda.has(e.id)) continue;              // ① 手上有在办的事 → 不静默
        if (actedRecently(e.id)) continue;                  // ② 刚出过手 → 不静默
        silentSet.add(e.id);                                // 结构上静默（③"被点名"在下一段解除，语义与原版一致）
    }
    const lifted = [...silentSet].filter((id) => named.has(id));
    const liftedSet = new Set(lifted);
    const active = (id) => !silentSet.has(id) || liftedSet.has(id);
    // ★leg32g：名单上的人**可以起头**（只限 newAgendas，见函数头注释）——这是那个自锁闭环的出口
    const canStart = (id) => active(id) || spotlightSet.has(id);

    const dropped = { actions: [], agendaAdvances: [], plotEvents: [], newAgendas: [], agendaCancels: [], newEntities: [] };
    const actions = (step.actions || []).filter((a) => {
        if (active(a.entity)) return true;
        dropped.actions.push(a.entity);
        return false;
    });
    const agendaAdvances = (step.agendaAdvances || []).filter((ad) => {
        const owner = agendaOwner.get(ad.agendaId);
        if (active(owner)) return true;
        dropped.agendaAdvances.push(owner);
        return false;
    });
    const newEvents = (step.newEvents || []).filter((ev) => {
        if (ev.source?.type !== 'plot') return true;   // state/ripple 事件不属主动作，照常落账
        const owner = agendaOwner.get(ev.source.ref);
        if (active(owner)) return true;
        dropped.plotEvents.push(owner);
        return false;
    });
    const newAgendas = (step.newAgendas || []).filter((na) => {
        // K14 出生裁判（细案 §3.2 → A-2）：新盘算提议 = 主动作——静默方提议被滤除（双面无痕）；
        // 被点名应答方（lifted）可以提议；下一轮重新判定。
        // ★leg32g：**本轮被轮到的人**也可以提议（`canStart`）——否则"模型照名单给他开线、引擎照样丢掉"，
        //   那份名单就成了空转（这是本棒自己抓出来的机制漏洞：规则与引擎判据必须对得上）。
        if (canStart(na.entity)) return true;
        dropped.newAgendas.push(na.entity);
        return false;
    });
    const agendaCancels = (step.agendaCancels || []).filter((ac) => {
        // K18 取消通道（因果链细案 §3.5 → A-5）：放弃提议 = 主动作——静默方提议被滤除（双面无痕，与出生对称）；
        // 被点名应答方（lifted）可以提议放弃。
        const owner = agendaOwner.get(ac.agendaId);
        if (active(owner)) return true;
        dropped.agendaCancels.push(owner || ac.agendaId);
        return false;
    });
    const newEntities = (step.newEntities || []).filter((ne) => {
        // K37 生通道②：入局提议 = 主动作——静默方提议被滤除（双面无痕）；无提议者（dialogueFact 观察者源）透传。
        if (!ne.entity) return true;
        if (active(ne.entity)) return true;
        dropped.newEntities.push(ne.entity);
        return false;
    });

    const droppedCounts = {};
    for (const id of [...dropped.actions, ...dropped.agendaAdvances, ...dropped.plotEvents, ...dropped.newAgendas, ...dropped.agendaCancels, ...dropped.newEntities]) {
        droppedCounts[id] = (droppedCounts[id] ?? 0) + 1;
    }

    return {
        // leg25 c：返回的新 step 里**不再拼 `stateChanges`**——契约层该字段已删，
        //   再拼一个空数组会让下游 checkWorldStep 判"未知字段"（实测冒烟当场炸在这里）。
        // ★leg34：新增一处**必须原样透传**（这一行是白名单式重建——漏一个键，那条通道就整段哑掉；
        //   本棒实测：漏了 `entityUpdates` ⇒ 字段写回**永远不落账**，而 25 条新用例里 10 条红）。
        //   `entityUpdates` = **因果变更**，不是"主动作"：它由一件已落账的事驱动（cause 必填且须未闭环，
        //   `check-step` 已核），与 `entityFates`（覆灭）同性质 ⇒ 照它**原样透传**，不进静默门。
        // ★★★leg95：同一个坑**又踩了一次**（历史押韵）：新增 `eventClosures` 时忘了加进这一行，
        //   而症状与上面那句一字不差——"模型判定的收场**永远不落账**"，`event-close.test.js` 新判据当场红。
        //   同一条理由透传：收场提议是**对已落账事情**的判断（`check-step` 已核号在册且未收场），
        //   不是"谁出的手"⇒ 不进静默门（静默的说的是"这个人这轮不许主动作"，与他能不能判旧事收场无关）。
        step: {
            actions, newEvents, agendaAdvances, newAgendas, agendaCancels, newEntities,
            entityFates: step.entityFates || [],
            entityUpdates: step.entityUpdates || [],
            eventClosures: step.eventClosures || [],
        },
        silent: [...silentSet],
        lifted,
        dropped,
        droppedCounts,
    };
}