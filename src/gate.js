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

    // ★★★leg123（细案 `docs/spec-tag-granularity.md` §2.6 ①）：**正文里被点到的人，也算"被点名"**。
    //   病（本笔查出来的**提示词与门控打架**）：`prompts.js` 第 8 条写着「被它们**当成对象**的人是另一回事：
    //     那是'有人动到他头上'，他完全可以因之而起反应——这一轮**正是你该写他的时候**」；
    //   而这里原先只算"未决事件波及 ∪ **世界步自己的**动作目标 ∪ 玩家落子对象"——
    //     **正文里 NPC 行动的目标没算** ⇒ 一个久未出手、手上无事的被点名者会被判静默、提议被丢掉
    //     （模型照提示词写了、门把它扔了，**而且不报错**）。
    //   ★取数**从账上取**（不多传形参）：本轮注册的 `dialogue` 型事件的 `ripples` 就是"正文点到的人"。
    //   ★只认**本轮**的（按号段前缀，与发号同源）。
    const dlgPrefix = `ev_${tick}_`;
    for (const ev of world.events || []) {
        if (ev?.source?.type !== 'dialogue') continue;
        if (!String(ev.id || '').startsWith(dlgPrefix)) continue;
        for (const r of ev.ripples || []) if (gated({ id: r })) named.add(r);
    }

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
        // ★★★leg120（A3 关系网）：**第三次**——细案 §2.4 把这一格单独标成"最阴的一格"（漏了它，
        //   通道整段哑掉而**判据可能还是绿的**），实施时照 §2.4 逐项核对，这次没漏。
        //   同一条理由透传：关系变更由**一件已落账的事**驱动（`cause` 必填且须未闭环，`check-step` 已核），
        //   两端也已在册 ⇒ 与 `entityUpdates`/`entityFates` 同性质，**不进静默门**
        //   （"静默方不许主动作"说的是出手，与"他能不能跟谁结成仇"是两件事）。
        // ★★★本次修（真模型 60 轮长跑实跑抓出来的病 · **同一个坑第四次**）：
        //   上面 leg34／leg95／leg120 三段注释警告的都是同一件事——**这是白名单式重建，漏一个键那条通道就哑**。
        //   而 `lookupScales`（按需查表，leg64）与 `lookupLines`（点名取回，leg128）**从来就不在这一行里**。
        //   ★它此前是**潜伏**的：老代码只在"模型写了这一格"时才动，而这一格早在上游 `runMainCall` 那次校验
        //     就记过账了 ⇒ 这里丢了也看不出来。
        //   ★本次修把"没写这一格"变成**有意义**的（= 这一轮不要，要清空）之后，它当场变成真病：
        //     `adjudicate` 拿到的是**这个被削过的 gstep** ⇒ 看不见 `lookupLines` ⇒ 误判成"模型没点名"
        //     ⇒ **刚点过的名当轮就被清掉**（`context-chain.test.js` 那条端到端判据当场红，正是它逮住的）。
        //   ⇒ 照同一条理由透传：这两个格子是"模型要什么料"的请求，与"谁出不出手"无关，**不进静默门**。
        // ★★★leg163：那两个里 `lookupScales` 那一个**整族撤走了**（用户令「既然是全塞了就不需要点名表了
        //   所以删了这个功能即可」）⇒ 这一行现在**只剩 `lookupLines` 一格**。
        //   ★上面那四段警告照旧有效、一个字没撤：**这是白名单式重建，漏一个键那条通道就哑**。
        //     撤走那一格是**有意的**（不是漏），留下这一格是**必须的**（「故事线」那一栏只是地图，不给经过）。
        step: {
            actions, newEvents, agendaAdvances, newAgendas, agendaCancels, newEntities,
            entityFates: step.entityFates || [],
            entityUpdates: step.entityUpdates || [],
            eventClosures: step.eventClosures || [],
            relationUpdates: step.relationUpdates || [],
            relationClosures: step.relationClosures || [],
            // ★请求型那一格：**有就照原样带走**（模型没写时**不补键**——"缺席"本身是有意义的信号）
            ...(typeof step.lookupLines === 'undefined' ? {} : { lookupLines: step.lookupLines }),
        },
        silent: [...silentSet],
        lifted,
        dropped,
        droppedCounts,
    };
}