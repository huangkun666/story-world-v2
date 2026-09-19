// story-world-v2/src/pack.js
// 演化上下文打包（S4/S5 共用）：世界自身状态 + 玩家落子事实 → 主调用输入。
// 长跑防线细案 §2.1：预算常量（原提案 4k tokens 已废；第十九棒 K44 拍板 30k，见下方 EVOLUTION_BUDGET_TOKENS）+ 固定打包序 + 超限剪枝。
// ★leg32g：门控的"久未出手"阈值**直接读门控真源**（`gate.js` 的 `QUIET_TICKS`），不在这里另抄一个数
//   ——"待启用名单"的筛选口径必须与门控的静默判据**同一把尺子**，否则会出现"引擎说他不静默、名单里却当他冷门"。
import { QUIET_TICKS } from './gate.js';
// ★leg62：刻度块要按**概念表**分组 ⇒ 读那一份"概念表唯一读取口"（新账读 `刻度`、旧账纯函数推导）。
//   为什么不在本文件自己从 powerScale/dims 推一遍：面板也读它 ⇒ 两处各推一次迟早漂移成
//   "面板分了两张表、包里还是一栏"（本仓最贵的那类 bug，见 abstract.js 的 resolveScales 头注）。
// ★leg64：法则块的三道上界与类别词表**读真源**（`abstract.js` 定义处）——不在本文件另抄一份数字，
//   否则"面板报的上界"与"包里真用的上界"会各说各话（leg63 那句不准确的文案就是这么来的）。
// ★★★leg71（丙案）：**真源换家**——"法则怎么分类"与那三道上界已搬到 `abstract-tier.js`。
//   本文件因此**不再 import 3367 行的抽取器**（只需要"尺子怎么读、法则怎么分类"，不需要"书怎么抽"）。
//   ★这是本棒要的那个效果：消费者关系第一次变正确。
import { resolveScales } from './abstract.js';
import { classifyRulesByKind, RULE_PACK_TOP, RULE_PACK_STR_MAX, RULE_PACK_CHAR_TOP } from './abstract-tier.js';
// K44/第十九棒（full-roster-lens-spec C2/C7 拍板）：实体段=**镜头选择器**——
//   全量棋盘上按「四段确定性序：①例外保送（被点名/在飞盘算属主/近 2 tick 活跃）②手上有在办盘算 ③近 5 轮出手 ④实体 id 序」排序、30k 内取前缀；
//   势力实体附「麾下成员」简表（parent 派生反查，含分支成员）；分量数字仍不入包（P3 不变）。
export const EVOLUTION_BUDGET_TOKENS = 30000; // 用户 2026-09-09 定案（"现在的大模型绝对有这个能力"）；镜头容量=预算内自适应
export const LENS_DEFAULT_MAX_TOKENS = 30000; // 镜头（实体段）独立上限（同值；测试可注入小值验证截断机制）
export const LENS_MEMBERS_TOP = 8;            // 势力麾下成员简表条数上限（份内按**名号序**，leg25 b 前为分量序；超出记「等 N 人」）
export const TOKEN_RATIO = 3;                // 粗略估计：1 token ≈ 3 字符（中文）
export const DIALOGUE_BOOK_TOP = 5;          // 提案：K38 补差包——依据册摘要进包条数上限（敲定稿 C 条）

// 镜头名单（引擎层纯函数只读，一处定义多处读取）：全量 active 实体 → 四段确定性序（leg24 片3）：
//   ① 保送（moveFact.object / 未决事件 ripples / 在飞盘算属主 / lastActiveTick ≥ tick−2）
//   ② 手上有在办盘算者（盘算"年纪" new→old：memory.turnsAlive 小者先）
//   ③ 近 LENS_RECENT_TICKS 轮出手者（近→远）
//   ④ 其余按实体 id（字典序）
// 段内同值时一律取 id 序兜底 —— **全程零分数**（旧法：第④段按分量降序，那个数已随 leg24 片3 退场）
// 分量只用于排序，不随行输出（P3：模型看不到分量数字）。
export const LENS_RECENT_TICKS = 5;   // 提案（片3）：镜头第③段"近期出手"的轮数窗（原按分量降序，无窗可言）
// ★leg32c（长跑接得上）：往"过去"看的两条尾巴。凭据 = 真账 tick 27 实测：
//   预算占用只 33%（余量 20,003 token），而模型**看不到 11 条已了结盘算中的任何一条**、
//   28 条已关闭事件只带最近 2 条 ⇒ **接不上不是预算问题，是没往下传**。
//   加满这三样实测只要 ~430 token（余量的 2%）。数字是提案态（铁律 2），先按"够用且不堆"取。
export const EVENT_LEDGER_TAIL = 8;    // 已闭环事件带回包里几条（旧值是写死的 2，且只有 id+title）
export const AGENDA_LEDGER_TAIL = 12;  // 已了结盘算带回包里几条（旧值：一条都不带）
// ★leg34：**离场名册**带回包里几个（dead/retired；只报 id+name）。它是"带因复活"通道的**前提**——
//   死者不在包里 ⇒ 模型拿不到他的 id ⇒ 复活提议永远提不出来（本棒实测：这一栏原本是死代码）。见下方 `departed` 注释。
export const DEPARTED_TAIL = 20;
// ★★leg32g（用户：「还是不行啊，永远围绕那几个势力是为什么」——本棒把这个闭环量穿了）：
//   **待启用名单**（`idleFaces`）：引擎每轮机械算出一小撮"从没出手、也没人点名"的在册实体，放进包里。
//   为什么必须有这个面（真账 tick 38 实测的**自锁闭环**）：
//     那几家出手 ⇒ `lastActiveTick` 常新 ⇒ **镜头次序永远把他们排最前** ⇒ 模型总在写他们 ⇒ 他们继续出手；
//     而 **613 人从没出过手、也没人点过名** ⇒ 永远排在镜头最后（第④段按 id 序）⇒ 模型**根本想不起来**还有谁。
//     实测：56 条事件的波及面**只有 5 个实体**（万法阁×38 / 大虞×24 / 东海龙宫×25 / 你×3 / 白小娥×2）。
//   ⇒ ★光在提示词里喊"换镜头"没用（模型手上没有"该轮到谁"的名单）——**得把名单递到它眼前**。
//   口径（零语义、零判断、纯机械）：筛选=active ∧ 手上有在办盘算的排除 ∧ `lastActiveTick` 距今 ≥ QUIET ∧
//     不在未决事件波及里 ∧ 不是玩家 ∧ 不是 top-1 保送；排序=**按 tick 轮转的确定性切片**
//     ⇒ 每轮换一批人露头，一轮之内完全确定（同一 world 两次出包逐字节一致）。
export const IDLE_FACES_TOP = 12;      // 每轮递几张脸（提案态，铁律 2；实测成本：12 个名字 ≈ 60 token）
// ★leg32h（用户：「都是围绕一件事展开的，没有并行的效果」）：**陈旧死链头过滤**。
//   实测（真账 tick 50）：58 条事件里**独立链头只有 1 条**——`ev_1_1`「万法阁商队集结」，
//   **挂了 49 轮还开着**（`state` 源按设计**永不自动闭环**：见 `entropy.js` 的头注释）。
//   它已无人牵动（ripples 只有 1 人）、也没人推进，却**每轮都占着模型眼前的未决池**
//   ⇒ 模型永远只看到"一个当下焦点"（那场死煞乱局），新势力只能挤进这同一条线里当配角
//   ⇒ 读起来就是"都围绕一件事"，**没有并行**。
//   ⇒ 口径：`state` 源的老事件，**挂了 ≥ STALE_CHAIN_HEAD_AGE 轮且牵动 < 2 人** ⇒ 不进包
//   （**账上保留、不闭环**——那是世界的事实；只是别再让它占模型眼前的位子）。
export const STALE_CHAIN_HEAD_AGE = 12;   // 提案态（铁律 2）
export const STALE_CHAIN_HEAD_MIN_RIPPLES = 2;   // 牵动人数低于此数才算"死链头"

/**
 * 待启用名单（leg32g）——**唯一真源**：包（递给模型看）与门控（给"起头"资格）读的是同一份。
 * 口径全机械、零判断：
 *   ① active ②手上没有在办盘算 ③`lastActiveTick` 距今 ≥ QUIET_TICKS（或从没出过手）
 *   ④不在未决事件波及里（他已有正当出场路径）⑤不是玩家 ⑥不是 top-1 保送（他本来就永远可动）
 * 排序 = id 序 → 按 tick **轮转**切片 ⇒ 每轮换一批人露头；同一 world 两次调用逐字节一致（无随机）。
 * @returns {{id:string,name:string,kind:string}[]}
 */
export function computeIdleFaces(ssot, top = IDLE_FACES_TOP) {
    if (!top || top <= 0) return [];
    const tickNow = ssot.meta?.tick ?? 0;
    const playerId = ssot.context?.playerId;
    const topId = (ssot.entities || [])[0]?.id;                       // gate.js 的保送口径：首个 active 实体
    const openOwners = new Set((ssot.agendas || []).filter((a) => !a.closed).map((a) => a.owner));
    const namedNow = new Set();
    for (const ev of ssot.events || []) if (!ev.closed) for (const r of ev.ripples || []) namedNow.add(r);
    const pool = (ssot.entities || []).filter((e) => {
        if ((e.status || 'active') !== 'active') return false;
        if (e.id === playerId || e.id === topId) return false;
        if (openOwners.has(e.id) || namedNow.has(e.id)) return false;
        return !(typeof e.lastActiveTick === 'number' && (tickNow - e.lastActiveTick) < QUIET_TICKS);
    }).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (!pool.length) return [];
    const off = (tickNow * top) % pool.length;                        // 轮转（确定性）
    // ★带 name/kind（不只是 id）：模型要"从名单里挑人"，光给一串 id 它无从判断谁是谁、是势力还是角色。
    //   成本实测：12 条 id+name+kind ≈ 180 token（预算余量两万，仍是为"看得见"花的小钱）。
    return Array.from({ length: Math.min(top, pool.length) },
        (_, k) => { const e = pool[(off + k) % pool.length]; return { id: e.id, name: e.name, kind: e.kind }; });
}
// ★★leg40：**线头**（无来路的未决事件）与**线捆**——"起了根，得有人接着浇"。
// 病灶（真账 59 轮 + 本棒 4 臂对跑实测）：
//   · 模型**会**自己起头——59 轮里起过 **9 条**"无来路"的线（慈航医堡/截教/黑山老妖/天机阁主/楚星河…），
//     条条有地点、有人；但**下一轮一条都没被接续**（全黏回那场大乱）。
//   · 根因不是"起根能力"，是**没有台账**：那几条混在 31 条未决事件里，外观与那场大乱的分支**完全一样**
//     ⇒ 模型认不出"哪条是我上轮起的、还没人接"。
//   · 对跑读数（同起点 tick 59 · 各 8 轮 · `gemini-3.1-pro-preview`）：
//     control 起点线头接续 1/13、`promptlist`（递台账）→ **4/13**、`threads`（分捆 + 每条各写一步）
//     ⇒ **一轮并推 3 条线、24 条次点名里真被推 15 次 = 62.5%**（此前 16 个臂、约 190 次调用里
//     "每轮新起主线"从未超过 1 条）。
//
// 口径（全机械、零语义判断——ANCHOR §4.8：不许用词表判语义）：
//   ① **线头** = 未决事件里，`source.ref` **不指向池内任何事件/盘算**（或压根没有 ref）的那些。
//      ★它们**不等于"与那场大乱无关"**（本棒实测：起点 13 条线头里 10 条标题带危机字样）——
//        排序只按"机械可判的新颖度"，**不假装判得出语义**（见 ③）。
//   ② **谁** = 那条例事 `ripples` 里的实体名字（账上真有的字，不生成）。
//   ③ **顺序** = 三级确定性序，全部机械、**零语义判断**（ANCHOR §4.8：不许用词表判语义）：
//      **a. 材料来源**：`source.type==='seed'`（书里的事，`seed-roots.js` 落账）排最前——
//         它们本来就少（一次几条），而"线捆"这一栏的全部意义就是**把世界源里那些事推下去**。
//      **b. 地点新鲜度**：位置**不在老链头的地盘里**的排前面。
//         ★为什么这条是对的（本棒实测的因果，不是口味）：真账那 13 条老线头**全是同一场大乱的分支**
//         （标题带大荒/死煞/劫气）；让它们先占位 ⇒ 新种进来的干净根**永远挤不进被点名的 3 条**
//         ——实测发生了：种下 2 条干净根后线捆里仍是那 3 条老根。于是模型每轮被要求的仍是"接着写那场大乱"。
//         ★"老链头的地盘"= **非 seed 线头的位置去重集合**（账上真有的字，不引入任何词表）；位置空着的算"不在任何地盘里"。
//      **c. id 序兜底**（同一 world 两次出包逐字节一致）。
//   ④ **线捆**只取最前 `THREADS_TOP` 条：世界步一次 `newEvents` 至多 `EVENT_CAPS.perTick=6`、
//      `AGENDAS_CAPS.perTick=3` ⇒ 一次要求"每条各写一步"的条数必须 ≪ 闸，否则教模型撞闸。
export const THREADS_TOP = 3;   // 提案态（铁律 2）：每轮点名推进的线捆条数；实测 3 条时"三条全推"出现过 3/8 轮
// ★leg40：拾遗栏（已了结、没人接的旧事件）带回包里几条。提案态（铁律 2）。
//   为什么是 6：真账实测这类"没人接的旧线头"有 14 条；一次给太多会把模型拉回"翻旧账"，
//   给太少又补不上线头缺口 ⇒ 取 6（约 200 token），并按"出生轮新→旧"排（越近越接得上）。
export const CLOSED_ROOTS_TOP = 6;

/** 线头（无来路的未决事件）——见上方注释的口径 ①。 */
export function computeOpenRoots(ssot) {
    const open = (ssot?.events || []).filter((e) => !e.closed);
    const evIds = new Set(open.map((e) => e.id));
    const agIds = new Set((ssot?.agendas || []).map((a) => a.id));
    return open
        .filter((e) => !e.source?.ref || !(evIds.has(e.source.ref) || agIds.has(e.source.ref)))
        .map((e) => ({ id: e.id, title: e.title, position: e.position, ripples: (e.ripples || []).length }));
}

/**
 * 线捆（递给模型"这几条线，每条各写一步"的那个名单）——见上方注释口径 ②③④。
 * ★为什么"分捆"而不是"一张平表"：平表（31 条混在一起）实测 = 模型每轮只推 1 条；
 *   分捆 + "每条各写一步" ⇒ 一轮并推 3 条（62.5% 条次被推）。
 */
export function computeThreads(ssot, top = THREADS_TOP) {
    return deliverThreads(ssot, top);
}

/**
 * ★leg40b 续（**归因探针的配套**）：同一套排序、**可指定送达条数**的线捆。
 *   为什么要有它：实验必须能问"送到 12 条会怎样"，而 `THREADS_TOP` 是模块常量。
 *   纪律：**排序与截断只有这一份实现**（`computeThreads` 就是 `deliverThreads(ssot, THREADS_TOP)`）
 *   ——探针不许自己再写一套排序（本仓老病：一个数两把尺子，见 leg32/leg33 的教训）。
 *   生产默认一个字节没变（`THREADS_TOP` 仍是 3，`computeThreads` 行为逐字不变）。
 */
export function deliverThreads(ssot, top) {
    if (!top || top <= 0) return [];
    const nameOf = new Map((ssot?.entities || []).map((e) => [e.id, e.name]));
    const byId = new Map((ssot?.events || []).map((e) => [e.id, e]));
    const heads = computeOpenRoots(ssot);
    // "老链头的地盘"：**非 seed 线头**的位置集合（口径 ③b——见上方注释里的实测因果）
    const oldPlaces = new Set(heads
        .filter((r) => byId.get(r.id)?.source?.type !== 'seed')
        .map((r) => String(r.position || '').trim())
        .filter(Boolean));
    return heads
        .map((r) => {
            const ev = byId.get(r.id);
            const pos = String(r.position || '').trim();
            return {
                id: r.id,
                title: r.title,
                position: r.position,
                people: (ev?.ripples || []).map((id) => nameOf.get(id) || id),
                _src: ev?.source?.type === 'seed' ? 0 : 1,          // a. 世界源起的根排最前
                _fresh: pos && !oldPlaces.has(pos) ? 0 : 1,          // b. 不在老地盘里的排前面
            };
        })
        .sort((a, b) => a._src - b._src || a._fresh - b._fresh || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, top)
        .map(({ _src, _fresh, ...keep }) => keep);
}

/**
 * ★★leg40 第三条料路：**拾遗（`closedRoots`）**——"已了结、而且**没有任何下游**"的旧事件。
 *
 * 用户的判断（原话）：「要么就直接挖插件已有的事件呗，或者直接让 llm 新做种，不依赖任何已有原料」——
 *   两条都对，本函数落地的是第一条。底数（真账 tick 59 实测）：**已了结事件 34 条里 14 条没有任何下游**
 *   （`万法阁血遁突入内陆`/`大盘谷血战爆发`/`浩然剑宗察觉死煞外泄`…），外加 **28 条已了结盘算**（谁办过什么、因何而起）。
 *   ⇒ "料枯竭"这个前提本身不成立：**账上现成有十几条没人接走的线头**，只是**没有任何栏目告诉模型"这几条还能接"**
 *     （它现在只以 `id+title` 的形状躺在 `recentClosedEvents` 里，引擎只带最近 8 条）。
 *
 * 口径（全机械）：
 *   ① **已了结**（`closed`）② **没有任何事件的 `source.ref` 指向它**（＝没人接着写过）
 *   ③ 不是熵泵事件（`ev_pump_*` 是"世界静下来了"的读数，不是故事线）
 *   ④ 排序（**两级，全机械**）：**位置不在"开着的线头地盘"里的排前面** → 出生轮新→旧 → id 序。
 *      ★为什么必须有第一级（**实测逼出来的**）：真账那 14 条"没人接的旧事"里 **12 条都在"大荒"**
 *        （`沈天君法旨镇压大盘谷`/`死煞核心彻底引爆`/`浩然剑气横空出世`…）——按"新→旧"排，拾遗栏 6 条**全是那一场的旧账**
 *        ⇒ 等于又给模型添危机料（与本棒整治的方向相反）。
 *        改成"新地优先"后，栏里先出 **2 条别处的事**（`万法阁引爆法器强冲`@东海 / `龙宫泣血断腕`@东海），其余才是大荒旧账。
 *        判据里的"开着的线头地盘" = **当前未决事件的位置去重集合**（账上真有的字，不引入任何词表）。
 *   ⑤ 只取最前 `CLOSED_ROOTS_TOP` 条（与线捆同一条体积纪律：一次要求太多会教模型撞 `perTick` 闸）
 *
 * ★与 `recentClosedEvents` 的**分工必须分清**（否则模型把它当背景读一遍就过去——leg39 的教训："给名单不给资格＝名单空转"）：
 *   `recentClosedEvents` = "发生过什么"（背景，只报 id/title/source）；
 *   `closedRoots`        = "**这几条没人接，接上它就算你这一步**"（可执行）。故它带 `people`（谁在里面），
 *   并在提示词第 14 条里明确"拾遗也算一步"。
 */
export function computeClosedRoots(ssot) {
    if (!CLOSED_ROOTS_TOP || CLOSED_ROOTS_TOP <= 0) return [];
    const all = ssot?.events || [];
    const referenced = new Set(all.map((e) => e.source?.ref).filter(Boolean));
    const nameOf = new Map((ssot?.entities || []).map((e) => [e.id, e.name]));
    // "老地盘"= 当前未决事件的位置集合（机械；用来把"别处的旧事"排到前面——见上方注释 ④）
    const openPlaces = new Set(all.filter((e) => !e.closed).map((e) => String(e.position || '').trim()).filter(Boolean));
    return all
        .filter((e) => e.closed && !referenced.has(e.id) && !String(e.id).startsWith('ev_pump_'))
        .map((e) => {
            const pos = String(e.position || '').trim();
            return {
                id: e.id, title: e.title, position: e.position,
                people: (e.ripples || []).map((id) => nameOf.get(id) || id),
                _born: Number(String(e.id).split('_')[1]) || 0,
                _fresh: pos && !openPlaces.has(pos) ? 0 : 1,
            };
        })
        .sort((a, b) => a._fresh - b._fresh || b._born - a._born || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, CLOSED_ROOTS_TOP)
        .map(({ _born, _fresh, ...keep }) => keep);
}

// 体积估计（leg25：**模块级唯一一份**）——1 token ≈ 3 字符（中文），向上取整。
// 为什么提到模块级：此前 `lensList` 与 `trimPack` 各自持有一份同名局部 `est`/`estBudget`，
//   trimPack 被接进生产路径后，任何一次"只改一处"的编辑都可能让裁剪路径上的调用点悬空
//   （报错形态：`ReferenceError: est is not defined`，且**只在真的超预算时才炸**，小世界冒烟看不见）。
//   现在两处共用同一个函数：没有第二份可漂移的副本，也没有"函数声明在调用点之后"的写法。
//
// ★leg31 实体段表达法收改（细案 `docs/spec-entity-section-encoding.md`）：
//   量体**必须与真正发出去的文本同一个函数**，否则预算就成了"两把尺子"。故本函数改走 `packTextOf`
//   （= 面向模型的唯一序列化口径），实体段按行式表格称重，不再按实体逐个 JSON 对象称重。
const estTokensOf = (value) => Math.ceil(packTextOf(value).length / TOKEN_RATIO);

// ---------- leg31：实体段行式表格（表达法收改，零信息损失） ----------
// 病根（真账 tick 17 实测，618 实体）：实体段吃整包 96.8%，而其 56,047 个字符里
//   **键名 45.5% + JSON 标点 10.8% = 56% 是纯结构开销**（618 行各写一遍 `"kind":` …），真内容·汉字只占 12.2%。
//   ⇒ 表头只写一次、行内 TAB 分列 ⇒ 整包 est 19,306 → 9,789（**−49.3%**，下界口径亦 ≥49.6%）。
// ★只改**序列化**、不改**内部形状**：`pack.entities` 仍是对象数组 ⇒ trimPack 的按行删键（.slim/.idOnly）、
//   面板、测试判据**全部零连扰**；`JSON.parse(pack.text)` 往返性也仍成立（整段换成一个字符串格）。
// 空值 = **空列**（不用 `—` 充数，沿用硬规矩二"空着就是空着"）；`locationNote`（`（推）`）**并进 location 值**，
//   因为它是"结构推断"标记、不是独立事实，并进去信息零损失（实测 3,231 个非空格逐格还原一致）。
// 分隔符实测：真账 618 行全部值（含 members 逐元素）对 TAB/竖线/换行**命中 0**；
//   但那是**单本读数**（泛用性铁律 §2 第 3 条）⇒ 下方 `entityTableAnomalies` 把它变成**出包期机械自检**，不靠"我看过没问题"。
export const ENTITY_TABLE_HEADER = ['id', 'kind', 'name', 'location', 'parent', '实力', 'members', 'player'].join('\t');
const ENTITY_TABLE_COLS = ENTITY_TABLE_HEADER.split('\t');

// 一行的取值（缺列返回 ''）
const entityCell = (r, f) => {
    if (f === 'location') return r.location == null ? '' : `${r.location}${r.locationNote ?? ''}`;
    if (f === 'members') return Array.isArray(r.members) && r.members.length ? r.members.join('、') : '';
    return r[f] == null ? '' : String(r[f]);
};
// ★**保留全列对齐**（细案 §2.2/§8 的决定）：尾部空列**不收**——虽然收掉能多省 481 est（51.8% vs 49.3%），
//   但"某行少几列"会让模型误判列序（`e_p1` 那行若只剩 4 列，"第 6 列是 members"这条就读不出来了）。
//   **不拿可读性换这 1.6 个百分点**。空列一律写空字符串（TAB 相邻）。
const entityRowText = (r) => ENTITY_TABLE_COLS.map((f) => entityCell(r, f)).join('\t');

// ★自检（不改变输出，只上报）：任一格的**值本身**含 TAB/换行 ⇒ 会串列，必须显形（判据 C）。
//   ⚠实现纪律：**不许用"数 TAB 个数"判**——`entityRowText` 会收掉尾部空列（`e_p1` 只有 4 列），
//   按 TAB 计数对"尾部缺列"永远数不出来（本判据的第一版就栽在这，被新加的用例当场抓红）。
export function entityTableAnomalies(rows) {
    const bad = [];
    for (const r of Array.isArray(rows) ? rows : []) {
        const cellHasDelim = ENTITY_TABLE_COLS.some((f) => /[\t\n]/.test(entityCell(r, f)));
        if (cellHasDelim) bad.push(r?.id ?? '(无 id)');
    }
    return bad;
}

// 行式块：表头 + 每行一条（每行末尾的 `\n` 在 JSON 里要转义成 2 字符 ⇒ 用 join 拼、不留尾空行）
function entityTableBlock(rows) {
    if (!Array.isArray(rows) || !rows.length) return '';
    return ENTITY_TABLE_HEADER + '\n' + rows.map(entityRowText).join('\n');
}

// 行式块 → 对象数组（**仅供判据 D 做无损核对**，生产路径不回读：check-step 校验拿的是 ssot，不是 pack）
export function parseEntityTableBlock(block) {
    const [head, ...lines] = String(block ?? '').split('\n');
    const cols = head.split('\t');
    return lines.filter((l) => l !== '').map((l) => {
        const parts = l.split('\t');
        const row = {};
        cols.forEach((f, i) => { if (parts[i]) row[f] = parts[i]; });
        const m = /^(.+?)（推）$/.exec(row.location ?? '');
        if (m) { row.location = m[1]; row.locationNote = '（推）'; }
        if (row.members) row.members = row.members.split('、');
        return row;
    });
}

// ★面向模型的**唯一**序列化口径：只有实体段换行式块，其余九段逐字节不变；
//   未带 entities 的值走原样 —— 故 `lensList` 对**单行**量体（无 entities 键）零扰动。
export function packTextOf(pack) {
    return JSON.stringify(pack, (key, value) => (key === 'entities' ? entityTableBlock(value) : value));
}

export function lensList(ssot, { lensMaxTokens = LENS_DEFAULT_MAX_TOKENS, moveFact = null } = {}) {
    const est = (line) => estTokensOf(line);   // 行内估体：估的是**单行字符串**（与整包估计同一个函数）
    const tick = ssot?.meta?.tick ?? 0;
    const named = new Set();
    const obj = moveFact?.object;
    if (obj && typeof obj === 'string') named.add(obj);
    for (const ev of ssot?.events || []) if (!ev.closed) for (const r of ev.ripples || []) named.add(r);
    for (const ag of ssot?.agendas || []) if (!ag.closed) named.add(ag.owner);
    // 段②的输入：每个属主手上最"老"的在飞盘算年纪（turnsAlive 缺省按 0=刚生）
    const oldest = new Map();
    for (const ag of ssot?.agendas || []) {
        if (ag.closed) continue;
        const age = typeof ag.memory?.turnsAlive === 'number' ? ag.memory.turnsAlive : 0;
        if (!oldest.has(ag.owner) || age < oldest.get(ag.owner)) oldest.set(ag.owner, age);
    }
    const seg = (e) => {
        if (named.has(e.name) || named.has(e.id)
            || (typeof e.lastActiveTick === 'number' && tick - e.lastActiveTick <= 2)) return 0;   // ① 保送
        if (oldest.has(e.id)) return 1;                                                            // ② 有在办的事
        if (typeof e.lastActiveTick === 'number' && tick - e.lastActiveTick <= LENS_RECENT_TICKS) return 2;   // ③ 近期出手
        return 3;                                                                                  // ④ 其余
    };
    const rows = (ssot?.entities || [])
        .filter((e) => !e.status || e.status === 'active')      // K37 三点过滤①：retired/dead 出演化上下文
        .map((e) => ({ e, seg: seg(e), age: oldest.get(e.id) ?? 0, idle: tick - (e.lastActiveTick ?? -Infinity) }))
        .sort((a, b) => (a.seg - b.seg)
            || (a.seg === 1 ? a.age - b.age : 0)                            // ② 段内：盘算年纪 new→old
            || (a.seg === 2 ? a.idle - b.idle : 0)                          // ③ 段内：出手 近→远
            || (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0));           // 全部兜底：id 序（确定性）
    const out = [];
    let used = 0;
    for (const { e } of rows) {
        const line = JSON.stringify([e.id, e.name, e.kind]);
        const cost = est(line);
        if (out.length && used + cost > lensMaxTokens) break;    // 前缀截断（至少保留首名，防御空镜）
        used += cost;
        out.push({ e, w: ssot?.weights?.[e.id] ?? 0 });          // w 仅向后兼容保留：已无任何引擎消费者（片3）
    }
    return out;
}

// 麾下成员简表（C7 派生反查）：characters 的 parent 命中 实体名/其分支名 → 归该势力；
//   取前 LENS_MEMBERS_TOP（按名号字典序，同值按 id 兜底——**确定性**）。
// leg25 b（A1）：排序键由 `world.weights`（那个 0-1 的数）改**名号序**——片3 定案「引擎不拿数值排序」的
//   最后一处残留。旧法在 leg24 片2 之后必然退化：势力成员普遍四维为空 → 同取中立 floor → 分量全等 →
//   排序结果随底层数组顺序漂移，面板「麾下：」名单每次重算都可能换位。现在名号序逐字节稳定。
export function membersOf(world, faction) {
    const scope = new Set([faction.name, ...(faction.branches || [])]);
    const list = (world?.entities || [])
        .filter((e) => e.kind === 'character' && e.parent && scope.has(e.parent))
        .sort((a, b) => {
            const an = String(a.name ?? ''), bn = String(b.name ?? '');
            if (an !== bn) return an < bn ? -1 : 1;                   // ① 名号序（人可读，确定性）
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;            // ② 同名兜底：id 序
        });
    if (!list.length) return null;
    const heads = list.slice(0, LENS_MEMBERS_TOP).map((e) => e.name);
    if (list.length > LENS_MEMBERS_TOP) heads.push(`等${list.length}人`);
    return heads;
}

// ★★leg60（用户令「把抽象这件事做好了」· 交接第 2 件「让设定进包」）：**刻度块**。
//   病（逐处 grep 出来的消费面，见 `docs/measure-leg59c-generality.md` §7）：抽象出来的四件套
//   （`rules`/`society`/`techOrMagic`/`historyNotes`）**只在 `render.js` 出现**，`powerScale` 只在
//   `abstract.js` 当"档位标签校验词"，而 `pack.setting` **只带 tension+env**（A-8"冻结层不入包"）
//   ⇒ **模型每轮一个字都看不到这本书的尺子**（真账：85 实体里 `实力` 0 条）。
//   口径（用户拍的）：**只进"可判等的那一小块"——维度 + 取值范围 + 档位表**；散文型设定
//   （社会格局/力量体系描述/史略）**不进每轮包**——它们留在账里给面板与开局抽取用。
//   为什么这一小块值得违反 A-8：它是**锚**——模型写实力/属性时有书里的尺子可依（档位名逐字照抄），
//   而不是各写各的形容词（"万人敌"/"很强"）；且它是**冻结的短表**（编译一次、之后每轮逐字相同）。
//   体积纪律（上界，实测可复核）：维度 ≤ DIM_TOP 条 · 档位 ≤ TIER_TOP 条 · 每个字符串 ≤ SCALE_STR_MAX 字
//   ⇒ 最坏 ≈ (8+24)×(30+8) ≈ 1,216 字符（对 30,000 token 的包预算是 4% 量级；leg28 实测峰值 19,241）。
//   键口径：解析不出任何维度/档位 ⇒ 返回 null ⇒ **键不出现**（"空着就是空着"，与 env 同一条纪律）。
export const DIM_TOP = 8;
export const TIER_TOP = 24;
export const SCALE_STR_MAX = 30;
// ★leg62：概念表按"一把尺"分组进包——**体积纪律照旧**（`TIER_TOP`/`DIM_TOP` 一个都不动），
//   只是把同样的档位**换了排法与一行的表名**。
//   ★表数上限**必须 ≥ (TIER_TOP 与 DIM_TOP 各自需要的表数之和)**，否则会**从结构上**把预算卡死：
//     旧账推导时"回指不到档位名的维度各自成表"（大荒 65 维里 54 条这种），
//     退化到极端就是"一档一表 / 一维一表" ⇒ 表数封顶即预算封顶。
//     实测（夹具：90 个互不相同档位名 + 40 个互不相同维度名）：上限 6 → 维度 0/8；
//     上限 8 → 档位 7/24、维度 1/8（都填不满）。定 16 ⇒ 档位 24/24、维度 8/8 两条都能压到上限。
//   体积上界：表名 ≤ 16×20=320 字符，其余与旧口径同尺 ⇒ 最坏 ≈ (8+24)×(30+8)+320 ≈ 1,536 字符（原 1,216，+26%）。
export const SCALE_TABLE_TOP_PACK = 16;
export const SCALE_NAME_MAX_PACK = 20;
// ★★★leg69（A1）：**块级截断的留痕** —— 病：本函数与 `buildRuleAnchor` 都在"自己的预算"里
//   **静默 `break`**（档 ≤`TIER_TOP` / 维 ≤`DIM_TOP` / 表 ≤`SCALE_TABLE_TOP_PACK` / 判据 ≤`RULE_PACK_TOP`），
//   包里没有任何"一共几项、只给了几项"的读数 ⇒ 真账实测「34 张表 214 档 ⇒ 进包 3 张 24 档、丢 88.8%」
//   只能靠人肉比对（而**整包级**的 `trimPack` 是有痕迹的：`pack.trimmed`）。
//   治法（用户拍板「新增一个只读键」）：把"口径"抽成**一个内部核心** `scaleAnchorCore(canon) → { anchor, fit }`，
//   公开的 `buildScaleAnchor` 退化为**薄壳**（`.anchor`，**返回形状逐字节不变** ⇒ 5 处调用点 + 各形状断言零扰动），
//   另开 `buildScaleAnchorWithFit` 给"要读数"的消费口（面板 / 出包）。
//   ★**为什么必须抽核心、不许各算一份**：截断规则一旦有第二份复制品，读数迟早与实物漂移
//     ——那正是本仓"一个数两把尺子"的老病（`render.js` 原先自己数了一遍 `scaleFit`，本棒一并收口）。
export function scaleAnchorCore(canon) {
    if (!canon || typeof canon !== 'object') return { anchor: null, fit: null };
    const cut = (s) => {
        const t = String(s ?? '').trim();
        return t.length > SCALE_STR_MAX ? t.slice(0, SCALE_STR_MAX) : t;
    };
    const cutName = (s) => {
        const t = String(s ?? '').trim();
        return t.length > SCALE_NAME_MAX_PACK ? t.slice(0, SCALE_NAME_MAX_PACK) : t;
    };
    // ★★leg62：**按概念表分组**（旧口径是把两列各自平铺——实教那张图里 `D班` 与 `S~E级` 挤同一个框）。
    //   分组来源走 `resolveScales`（新账读 `刻度`、旧账纯函数推导）⇒ 面板与包**同一份分组**。
    const tables = resolveScales(canon);
    const dims = [];
    const seenDim = new Set();
    const scales = [];
    for (const t of tables) {
        const rows = [];
        let used = 0;
        for (const x of (Array.isArray(t.档位) ? t.档位 : [])) {
            if (used >= TIER_TOP) break;                      // 全局档位上限仍在 buildScaleAnchor 末尾统一兜
            const level = cut(x?.档);
            if (!level) continue;
            const item = { 档: level };
            const note = cut(x?.注);
            if (note && note !== level) item.标定 = note;
            rows.push(item);
            used += 1;
        }
        // 子表现在**不单独进包**（用户拍「当子表」：它的定位是"对上面某个档位的细分"，
        //   进包只会挤掉别的尺；要看得去面板/账本）。★这条是有意为之，不是漏了。
        const tDims = [];
        for (const d of (Array.isArray(t.维度) ? t.维度 : [])) {
            const nm = cut(d?.名);
            if (!nm || seenDim.has(nm)) continue;
            seenDim.add(nm);
            const item = { 名: nm };
            const range = cut(d?.范围);
            if (range) item.范围 = range;
            tDims.push(item);
            dims.push(item);
        }
        if (!rows.length && !tDims.length) continue;
        const table = { 表: cutName(t.名) };
        if (rows.length) table.档位 = rows;
        if (tDims.length) table.维度 = tDims;
        scales.push(table);
        // ★★leg62：这里**不许**按 `SCALE_TABLE_TOP_PACK` 提前 `break`（实测踩过一次，代价是维度 0/8）：
        //   本循环只做"把概念表映射成包内形状"，**真正的截断在下面按预算分两组做**。
        //   提前 break ⇒ `scales` 被截短 ⇒ `dimsOnly` 组里一张表都没有 ⇒ 维度预算永远填不满。
    }
    // 没有概念表可分的（老账推导失败/空 canon）⇒ 落回旧两列平铺，行为与 leg61 逐字节一致。
    if (!scales.length) {
        // ★leg69（A1）：先建**全量**、再 `slice`（原写法把 `slice` 串在链尾 ⇒ 切掉多少无从得知）。
        //   ⚠返回对象的**键序**必须与旧写法逐字节相同 ⇒ 下面仍按 `out` 的 `维度`→`档位` 顺序落键。
        const allDims = (Array.isArray(canon.dims) ? canon.dims : [])
            .map((d) => { const item = { 名: cut(d?.name) }; const range = cut(d?.range); if (range) item.范围 = range; return item; })
            .filter((d) => d.名);
        const allTiers = (Array.isArray(canon.powerScale) ? canon.powerScale : [])
            .map((p) => { const item = { 档: cut(p?.level) }; const note = cut(p?.note); if (note) item.标定 = note; return item; })
            .filter((t) => t.档);
        const flatDims = allDims.slice(0, DIM_TOP);
        const flatTiers = allTiers.slice(0, TIER_TOP);
        const flatFit = {
            表: null,                                            // 平铺路没有"表"这一层（旧两列直铺）
            档: { 进包: flatTiers.length, 共: allTiers.length },
            维: { 进包: flatDims.length, 共: allDims.length },
        };
        if (!flatDims.length && !flatTiers.length) return { anchor: null, fit: null };
        const out = {};
        if (flatDims.length) out.维度 = flatDims;
        if (flatTiers.length) out.档位 = flatTiers;
        return { anchor: out, fit: flatFit };
    }
    // 全局上限兜底（与旧口径同尺：维度 ≤ DIM_TOP · 档位 ≤ TIER_TOP，跨表累计）。
    //   ★★三条排序纪律（**三条都是实测踩出来的**，改这段之前逐条读）：
    //     ① **档位表优先**：`resolveScales` 对"range 回指不到任何档位名"的维度会让它**自成一表**
    //        （大荒 65 维里 54 条这种）⇒ 不排一下，名额会被"单维度表"吃光、档位一条进不了包。
    //     ② **表数份额必须两组分开给，不能先到先得**：上限是体积兜底，若让档位组独占，
    //        一个"90 个互不相同档位名"的 canon 会推出 90 张单档位表 ⇒ 8 个名额全给档位组 ⇒
    //        **维度 0/8**（实测）。故档位组只准占 `上限 - 1`，**至少留 1 个名额给只有维度的表**。
    //     ③ **表数封顶绝不能顺手停掉预算**：`SCALE_TABLE_TOP_PACK` 只管"还开不开新表"，
    //        预算用尽（两个都空）才停循环 —— 表数变少是设计，预算被饿死是 bug（实测踩过一次：维度 0/8）。
    // ★★leg62 定稿：**顺序交给 `resolveScales`，这里只做"顺次截断"**（这段改过六轮，教训写在下面）。
    //
    //   走过的弯路（**别再走回去**）：一开始想在这里"按预算给两组各分表数名额"，结果每修一处就冒出
    //   另一种坏形态——维度 0/8（提前 `break`）、档位 15/24（名额被单档位表吃光）、维度只剩 1/8
    //   （游离维度表抢名额）。根因是：**表数上限（体积兜底）与两条内容预算（档位/维度）是两个维度的事**，
    //   在同一个循环里既排顺序又分名额，就一定会有互相饿死的情形。
    //
    //   ⇒ 定稿口径（三条，都很直白）：
    //     ① **顺序 = `resolveScales` 的返回序**。它已经是有道理的序：一把尺一张表，
    //        挂在这把尺上的维度紧跟它（实教 `S~E级` 与它那 5 个属性同一张表、且排在前面）。
    //     ② **只按名单顺次取**：空表跳过（不占名额）；非空表收下并从三条预算里各扣各的。
    //     ③ 任一预算（首表数 `SCALE_TABLE_TOP_PACK` / 维度 `DIM_TOP` / 档位 `TIER_TOP`）
    //        用尽即停 —— 三条都是**上界**，不是必须填满的指标。
    //   这样"表数"就纯粹是"最多画几张表"，与内容预算不再互相牵扯。
    //   ④ **两趟取表**（顺序必须"有档位的优先"）——`resolveScales` 的返回序对**新账**已经是对的
    //      （模型标的尺在前），但对**旧账推导**不一定：推导会把"无记号档位"那张表插在
    //      第一把尺前面（实教夹具实测）⇒ 一趟取会让它先占掉表数名额、后面真正的尺进不来。
    //      故：**第一趟取"带档位的表"（内容主体），第二趟才取"只有维度的表"**。
    let tierBudget = TIER_TOP;
    let dimBudget = DIM_TOP;
    const capped = [];
    for (const t of scales) {
        if (capped.length >= SCALE_TABLE_TOP_PACK) break;
        if (!tierBudget && !dimBudget) break;
        const row = { 表: t.表 };
        if (t.档位?.length && tierBudget > 0) {
            const got = t.档位.slice(0, tierBudget);
            row.档位 = got;
            tierBudget -= got.length;
        }
        if (t.维度?.length && dimBudget > 0) {
            const got = t.维度.slice(0, dimBudget);
            row.维度 = got;
            dimBudget -= got.length;
        }
        if (row.档位?.length || row.维度?.length) capped.push(row);
    }
    if (!capped.length) return { anchor: null, fit: null };
    // ★leg69（A1）：读数与实物同源 —— `进包` 直接数 `anchor` 本体的元素，`共` = 截断前 `scales` 里的总量。
    //   （`scales` 里的形状已与包内同形 ⇒ 两边的"一项"是同一个东西，不是两把尺子。）
    const count = (list, key) => list.reduce((n, t) => n + ((t[key] || []).length), 0);
    return {
        anchor: capped,
        fit: {
            表: { 进包: capped.length, 共: scales.length },
            档: { 进包: count(capped, '档位'), 共: count(scales, '档位') },
            维: { 进包: count(capped, '维度'), 共: count(scales, '维度') },
        },
    };
}

/** 薄壳：**返回形状与 leg61/leg62 逐字节相同**（5 处调用点 + 形状断言零扰动）。 */
export function buildScaleAnchor(canon) {
    return scaleAnchorCore(canon).anchor;
}

/**
 * 要读数的消费口（面板 / 出包）走这个：`{ anchor, fit }`，`anchor` 与 `buildScaleAnchor` 的返回值**同一个东西**。
 * `fit = { 表: {进包,共}|null, 档: {进包,共}, 维: {进包,共} }`（平铺路没有"表"这一层 ⇒ `表: null`）。
 * ★两种"没东西"都返回 `{ anchor: null, fit: null }`（无 canon / 净化后为空）——与薄壳的 `null` 一一对应。
 */
export function buildScaleAnchorWithFit(canon) {
    return scaleAnchorCore(canon);
}

// ★★★leg64 第三轮（用户问「有这么多模型该怎么检索，难道直接全塞吗？」→ 拍板**递目录 + 按需查**）：
//   **刻度目录**——把"账上有哪些尺"递到模型眼前，但**不带档位内容**。
//
//   病（本棒实测，指得出出处）：重抽后的大荒账有 **64 张尺表 / 28,764 字符**（= 包预算 **32.0%**），
//   而进包闸只放得下 **4 张 / 24 档** ⇒ **丢 93.8%**，且模型**根本不知道另外 60 张存在**
//   （leg63 登记过同一个洞：「进包静默截断」，当时也是"包里没有痕迹"）。
//   ⇒ 后果：模型在需要"量班级分配"那把尺时无尺可依 ⇒ 又回到"自己发明形容词"（本块当初要治的病）。
//
//   为什么**不能**靠"全塞"解决（用户那一问的直接答复）：64 张表 = 32% 预算，而每轮真正用得上的
//   通常只有 3~5 张（尺的索引是**概念**——"这一轮在量什么"；实体表的索引是**身份**——"谁出场"，
//   所以实体能每轮全递、尺表不能）。
//
//   形状（纯字符串数组，与 `法则`/`recalled` 同一种"最省"的排法）：
//     `刻度目录: ['异金榜（12 档）', '大虞皇朝锁灵机制（3 档 · 2 维）', …]`   ← **只列还没进包的那些**
//   ★为什么只列"没进包的"：已在 `刻度` 里的表，目录再列一遍是重复占预算；模型需要的是
//     "**我手里没有、但书里有**"这一份差距清单。全集 = `刻度` ∪ `刻度目录`。
//   ★与 `刻度` 的分工写在同一条纪律里：**一处按预算取前几张、一处如实报"还有什么"**，
//     两处都读 `resolveScales`（同一个读取口）⇒ 不会出现"目录里有的、包里没有；包里有的、目录说没有"。
export const SCALE_CATALOG_TOP = 200;       // 荒谬上界（真账 64 张 ⇒ 留 3 倍余量；它只是**表名**）
export function buildScaleCatalog(canon, packedNames) {
    if (!canon || typeof canon !== 'object') return null;
    const tables = resolveScales(canon);
    if (!tables.length) return null;
    const has = packedNames instanceof Set ? packedNames : new Set();
    const out = [];
    for (const t of tables) {
        if (out.length >= SCALE_CATALOG_TOP) break;
        const nm = cutScaleName(t.名);          // ★与 `buildScaleAnchor`/查表索引**同一把尺**
        if (!nm || has.has(nm)) continue;          // 已在包里的不重复列
        const nTier = (Array.isArray(t.档位) ? t.档位 : []).length;
        const nDim = (Array.isArray(t.维度) ? t.维度 : []).length;
        // 只有表名（+规模），**不带任何档位内容**——这一块的定位就是"目录"
        const size = [nTier ? `${nTier} 档` : '', nDim ? `${nDim} 维` : ''].filter(Boolean).join(' · ');
        out.push(size ? `${nm}（${size}）` : nm);
    }
    return out.length ? out : null;
}

// ★★★leg64（用户令「规则会怎么样？规则太多会怎么样？」→ 拍板「只进『判断依据』」）：**法则块**。
//
//   病（leg63 §1.2 的消费面审计，本棒复查确认）：`canon.rules` **只有 `render.js` 读**——
//     判定原则（`T1-T4跨境→DC24` / `1点仙阶≈1,000,000点下界` / `一次好感增加不超过5点` /
//     `1上品=1000中品`）**模型一个字看不到** ⇒ 它每轮写实力、好感、战果、物价时只能自己发明数。
//     这与 `刻度` 当初的病**同源**（"抽出来的东西没人消费 = 没抽"，leg61 律 7），
//     而 `刻度` 那一块已经用"把可判等的一小块递进包当锚"治好了 ⇒ 本条是它的兄弟。
//
//   为什么**只进两类**（本棒按真账逐条读 + **实机重抽两轮**修出来的边界）：
//     · **判断依据**（`跨1大境界→DC24` · `1点仙阶≈1,000,000点下界` · `一次好感增加不超过5点`）
//       = "这一轮我要拿它算一个数 / 判一个结果" ⇒ 不进包 ⇒ 模型只能自己编数；
//     · **世界观设定**（`目睹高维强者交手会导致道心值狂降` · `未录仙籍者视为野仙` · `灵气浓度稀薄至普通`）
//       = "这个世界是怎么运转的" ⇒ 不进包 ⇒ 模型算得对但**世界不熟**（写出来的味道不对）。
//       ★★这两类是**用户拍板的"都要"**。本棒第一版只进判据、把世界观当兜底残渣扔掉，
//         实机 318 条那份账当场证明那是错的（详见 `RULE_CLASS_GUIDE` 头注）。
//     · **文风禁令**（三国 32 条里 11 条 `绝对禁止现代口语语法`）= 那是**怎么写**，不是**判什么/世界是什么**；
//       ★★★leg74（用户令「我不是说不要文风禁令了吗？」→ 拍板「连账本一起清掉」）：这一类现在**连账本都不进**了
//       ——`pruneJunkRules` 在收账/并集/载入三处把它摘掉（唯一实现在 `abstract-tier.js`）。
//       本条注释原来写的"留账给面板"是 leg64 的旧口径，**已被 leg74 取代**（别再照它改回去）。
//     · **变量指令**（`必须全量 replace` · `delta -1`）= **MVU 脚本那一层的活**，进叙事提示词是纯噪声
//       （用户 leg63 原话「这不是重抽设定吗？为什么要抽属性了」是同一类越界）；
//     · **其他**（格言 `功成身退天之道`）= 不是判定锚，也不是世界事实
//       ★leg75：用户重抽后又在面板上看到「其他（2 条）」是**安装/配置说明**
//       （`数据库配置：安装：下载最新版本数据库…` · `表格模板导入：配置方法：状态栏倒数第三个按钮`）
//       ⇒ 拍板「把这些全给我删干净了」。
//   ⇒ 只进那两类（`RULE_CLASSES_PACK`）；★★leg75 起**其余三类一条都不留**（既不进包、也不进账本）
//     ——丢弃凭模型标注、记账边界确定性丢弃，不猜内容（见 `pruneJunkRules` 头注与 `RULE_CLASSES_DROP`）。
//
//   体积纪律（与 `buildScaleAnchor` 同尺，**上界必须有**——leg63 §1.5 量到的病正是
//   "`rules` 没有任何上界判据"，而 `刻度` 有 表≤16/档≤24/维≤8）：条数 · 单条长度 · 总字符，三道闸。
//   大荒真账 129 条 6,286 字符（整包塞入 = 包预算 21.0%）；只取判据一类后实测见
//   `docs/measure-leg64-rule-kinds.md`。
//
//   ★老账口径（用户拍板）：**没有 `ruleKinds` 就是没有**（与 leg63 的 `源` 同一条**零迁移**纪律：
//     不猜、不重抽、不按关键词瞎分类）⇒ 老账一块都不进包，面板照旧全平铺并**如实报**"0 条进包"。
//     为什么不做"关键词猜判据"：那正是本仓明禁的过拟合（换本书就废），且猜错会把散文灌进每轮包。
/** 法则块的**唯一口径**（照 `scaleAnchorCore` 的先例：截断规则只许有一份）。 */
export function ruleAnchorCore(canon) {
    if (!canon || typeof canon !== 'object') return { anchor: null, fit: null };
    // ★分类法**不在本文件写**——走 `classifyRulesByKind`（面板读的是同一个函数 ⇒ 报的和干的一致）。
    const { 判据 } = classifyRulesByKind(canon.rules, canon.ruleKinds);
    const out = [];
    let chars = 0;
    for (const s of 判据) {
        if (out.length >= RULE_PACK_TOP) break;
        const cut = s.length > RULE_PACK_STR_MAX ? s.slice(0, RULE_PACK_STR_MAX) : s;
        if (chars + cut.length > RULE_PACK_CHAR_TOP) break;
        out.push(cut);
        chars += cut.length;
    }
    // 空着就是空着（与 env/刻度 同一条纪律）：一条判据都没有 ⇒ 键不出现，老账与旧行为**逐字节相同**。
    if (!out.length) return { anchor: null, fit: null };
    // ★leg69（A1）：`共` = **判据这一类**的总数（分类之后、三道闸之前）——口径与面板"几/几进包"同一把尺。
    return { anchor: out, fit: { 判据: { 进包: out.length, 共: 判据.length } } };
}

/** 薄壳：**返回形状不变**（`null` / `string[]`）。 */
export function buildRuleAnchor(canon) {
    return ruleAnchorCore(canon).anchor;
}

/** 要读数的消费口走这个：`{ anchor, fit }`，`fit = { 判据: {进包,共} }`。 */
export function buildRuleAnchorWithFit(canon) {
    return ruleAnchorCore(canon);
}

// ★★★leg64 第四轮（用户令「做吧」）：**按需查表**——模型"点名要"某几张尺的入口。
//
//   为什么必须有这一格（上一轮核查出来的缺口，指得出出处）：
//     · `recall` 那条路按**实体名 + 未决事件标题**发问（`recall.js` 的 `collectRecallQuery`）
//       ⇒ 表格只能"随它所在的条目碰巧被召回"，**模型无法指定要看哪张尺**；
//     · `lookup` 那条路（`meta.entityFields`）的索引键是**实体 id** ⇒ **对表格没有入口**。
//     ⇒ 后果：上一轮交给模型的 `刻度目录` 让它"知道书里有《仙阶法宝品阶》这张表"，
//       **却没有办法拿到它**——那正是本仓最忌讳的"面板/提示词替机制承诺一个它做不到的事"
//       （`render.js:126` 那条"永不会兑现的承诺"就是同一个病）。
//
//   口径四条：
//     ① **点名的键 = 表名**（目录里逐字给的那个），因为那是模型手里唯一有的标识；
//     ② **必须能对回账上的表**（`buildScaleTableIndex`）——对不上的一律**不收也不编**，
//        并**如实记下被拒的名字**（"无源之物不入局"那条纪律：模型编一个表名 ⇒ 引擎不许替它造）；
//     ③ **当轮就递**（与 `recalled`/查字段同一条：出包前准备好，投递那一轮可见，零额外调用）；
//     ④ **生命周期 1 轮**（调用方在新一轮开头清掉请求）——不做跨轮囤积
//        （`injectWorldBookRecall` 头注里那条"过期内容冒充新检索"的坑就在旁边，别重犯）。
export const SCALE_ONDEMAND_TOP = 6;              // 一轮最多递几张（防"我全要"）
export const SCALE_ONDEMAND_CHAR_TOP = 6000;      // 一轮补料总字符上限（= 包预算 6.7%）
/** 表名截断（与 `buildScaleAnchor`/`buildScaleCatalog` **同一把尺**，否则两边认不出是同一张）。 */
function cutScaleName(s) {
    const t = String(s ?? '').trim();
    return t.length > SCALE_NAME_MAX_PACK ? t.slice(0, SCALE_NAME_MAX_PACK) : t;
}
/** 表名 → 表（**唯一索引**：`resolveScales` 的账本序；目录与查表读的是同一份分组）。 */
export function buildScaleTableIndex(canon) {
    const idx = new Map();
    for (const t of resolveScales(canon)) {
        const nm = cutScaleName(t.名);
        if (nm && !idx.has(nm)) idx.set(nm, t);
    }
    return idx;
}
/**
 * 净化"模型点名的表名"：只收**账上真有的**，其余落 `missed`（如实留痕，不替它造）。
 * @returns {{ok: string[], missed: string[]}}  —— `ok` 按**点名序**去重（先到先得）
 */
export function sanitizeScaleRequests(names, index) {
    const idx = index instanceof Map ? index : new Map();
    const ok = [];
    const missed = [];
    for (const raw of (Array.isArray(names) ? names : [])) {
        const nm = cutScaleName(raw);
        if (!nm) continue;
        if (idx.has(nm)) { if (!ok.includes(nm) && ok.length < SCALE_ONDEMAND_TOP) ok.push(nm); continue; }
        // 账上没有这张表 ⇒ **拒**（不许"差不多就给它一张"——那是替模型编）
        if (!missed.includes(nm) && missed.length < SCALE_ONDEMAND_TOP) missed.push(nm);
    }
    return { ok, missed };
}
/**
 * 按点名**取全那张表**（与 `buildScaleAnchor` 的取舍相反：那边受预算只能给前几档，
 *   这边是"你点名要的，给你整张"——但仍有总字符闸，且**逐张整取、不半张截断**）。
 * @returns {{tables:Array, chars:number, dropped:string[]}|null}  一张都给不出 ⇒ null（键不出现）
 */
export function buildScaleOnDemand(canon, names) {
    const idx = buildScaleTableIndex(canon);
    const { ok } = sanitizeScaleRequests(names, idx);
    if (!ok.length) return null;
    const cut = (s) => {
        const t = String(s ?? '').trim();
        return t.length > SCALE_STR_MAX ? t.slice(0, SCALE_STR_MAX) : t;
    };
    const tables = [];
    const dropped = [];
    let chars = 0;
    for (const nm of ok) {
        const t = idx.get(nm);
        const rows = (Array.isArray(t.档位) ? t.档位 : []).map((x) => {
            const item = { 档: cut(x?.档) };
            const note = cut(x?.注);
            if (note && note !== item.档) item.标定 = note;
            return item;
        }).filter((x) => x.档);
        const dims = (Array.isArray(t.维度) ? t.维度 : []).map((d) => {
            const item = { 名: cut(d?.名) };
            const range = cut(d?.范围);
            if (range) item.范围 = range;
            return item;
        }).filter((x) => x.名);
        const subs = (Array.isArray(t.子表) ? t.子表 : []).map((st) => ({
            名: cutScaleName(st?.名),
            档位: (Array.isArray(st.档位) ? st.档位 : []).map((y) => ({ 档: cut(y?.档) })).filter((y) => y.档),
        })).filter((st) => st.名 && st.档位.length);
        const one = { 表: nm };
        if (t.用途) one.用途 = cut(t.用途);
        if (rows.length) one.档位 = rows;
        if (subs.length) one.子表 = subs;
        if (dims.length) one.维度 = dims;
        const size = JSON.stringify(one).length;
        // 逐张整取：装不下就**整张不要**（不做"给半张"——半张尺比没有更坏：模型会拿残缺的档位当全部）
        if (chars + size > SCALE_ONDEMAND_CHAR_TOP) { dropped.push(nm); continue; }
        tables.push(one);
        chars += size;
    }
    return tables.length ? { tables, chars, dropped } : null;
}
// 已结算盘算不再喂给模型（防满步重播，活档实测发现）
// K2/P3：分量不再入包（ANCHOR §3③：模型看不到分量、不参与分量；门控在引擎侧兜底）
// leg25：出包末尾**强制整包预算**（超限按固定剪枝序裁，包内留 `trimmed` 痕迹；见 trimPack）
export function buildEvolutionPack(ssot, moveFact, { picks = null, lim = null, turnFacts = null } = {}) {
    // K44：镜头选择器——全量棋盘有序入镜（保送+分量序），预算内前缀；分量不随行泄漏（P3）
    // 细案 spec-entity-field-lookup §3（用户 2026-09-11 批准）：**选择权归 LLM 时**传 picks——
    //   名单改用"本轮上场选择器"选的实体（引擎只做校验，见 entity-lookup.js），不再按预算截前缀。
    //   为什么必须换：lensList 是**引擎**按 30k 预算截前缀，镜头外的人连"想让谁动"都表达不了；
    //   leg24 片3 前按分量算的静默线实测把 345/346 全判静默（引擎实际上禁止了所有人出手）。
    //   picks 缺省=null 时行为与旧版逐字节一致（旧路径零扰动；预算仍由 trimPack 整包兜住）。
    const lens = picks
        ? picks.map((id) => ({ e: (ssot.entities || []).find((x) => x.id === id) })).filter((x) => x.e)
        : lensList(ssot, { moveFact });
    // leg25：实体行默认**全字段**（含麾下成员简表等重字段）；整包超预算时按固定剪枝序逐级降级
    //   （见 trimPack 的 entities.slim / entities.idOnly）。不裁时行内容与旧版逐字节一致。
    const entityRow = (e, mode) => {
        if (mode === 'idOnly') return { id: e.id, name: e.name };   // 最坏情况的兜底形态（视野仍在：还有名字）
        const row = { id: e.id, kind: e.kind, name: e.name, location: e.location };
        // ★★leg32i（用户：「你是怎么保证不演用户的？」）：**玩家棋子必须在表里一眼认出来**。
        //   代价（实测）：认领主角之后（`e_p1` → `e_42_1`「黄坤」），模型**不知道那一行就是玩家**，
        //   于是继续很自然地写 `actions[0].entity = e_42_1`（让主角出手）、推进主角的盘算、
        //   还以主角为提议者往世界里塞人 ⇒ 三条红线同时被踩 ⇒ **整步被拒、世界原样不动**
        //   （用户贴回来的那两条报错就是这个）。⇒ 光有"不许写玩家"的守卫不够，**得让模型看得见哪一行是玩家**。
        //   口径：只在**玩家那一行**写 `player=★你`（其余行空着，不占字节）。
        if (ssot.context?.playerId && e.id === ssot.context.playerId) row.player = '★你';
        // leg25 d：**位置是"结构推出"还是"书里明述"必须让模型看出来**——不标的话它就当书里的
        //   事实用（用户质疑"推错会不会帮倒忙"）。来源落账在 meta.entityFields[id].位置来源。
        const locSrc = ssot.meta?.entityFields?.[e.id]?.位置来源;
        if (row.location && locSrc === '结构推导') row.locationNote = '（推）';
        if (e.parent) row.parent = e.parent;                      // C7：从属（角色→势力/分支）
        // 细案 spec-entity-field-lookup：按需查书补的 `实力`（文本）随行入包——**角色才有**
        //   （势力不写实力，用户拍板；势力实力在面板用麾下成员派生显示）。引擎不读它、不进任何公式。
        if (e.kind === 'character' && typeof e['实力'] === 'string' && e['实力'].trim()) row['实力'] = e['实力'];
        if (e.kind === 'faction' && e.branches?.length) row.branches = e.branches;   // C8：分支表
        if (e.kind === 'faction' && e.organs?.length) row.organs = e.organs;         // leg23：名下机构/部门（书里明述）
        if (e.kind === 'faction' && mode === 'full') {
            const members = membersOf(ssot, e);                   // C7：麾下成员简表（派生；逐行最重的可选字段）
            if (members) row.members = members;
        }
        return row;
    };
    const entities = lens.map(({ e }) => entityRow(e, 'full'));
    const agendas = (ssot.agendas || []).filter((a) => !a.closed).map((a) => ({
        id: a.id, owner: a.owner, goal: a.goal, stage: a.stage,
        visibility: a.visibility, progress: `${a.progress}/${a.maxSteps}`, memory: a.memory,
        parentId: a.parentId,   // K14（K13 施工补差，细案 §3.5）：树形是"谋划的结构"，可见；分量数字不可见原则 P3 不动
        // ★leg32c（长跑接得上）：**出生理由**进包。leg29 已把理由落账（`agenda.source`），但**从没进过包**
        //   ⇒ 模型每轮看得见"万法阁在办什么"，**看不见"他为什么起这件事"** ⇒ 三十轮后接不上因果。
        //   成本实测：真账在飞 1 条 = 15 token（余量两万，这不是预算问题，是"没往下传"）。
        source: a.source,
    }));
    const pendingEvents = (ssot.events || []).filter((e) => !e.closed).filter((e) => {
        // ★leg32h：陈旧死链头不进包（见常量处注释）——它们让世界看起来"只有一个焦点"
        if (e.source?.type !== 'state') return true;                       // 只有 state 源会永不闭环
        const age = (ssot.meta?.tick ?? 0) - (Number(String(e.id).split('_')[1]) || 0);
        return !(age >= STALE_CHAIN_HEAD_AGE && (e.ripples || []).length < STALE_CHAIN_HEAD_MIN_RIPPLES);
    }).map((e) => ({
        id: e.id, title: e.title, source: e.source, position: e.position,
    }));
    // ★leg32c：已了结的**故事线台账**（长跑接得上的核心面）。
    //   病因（真账 tick 27 实测）：**11 条已了结盘算，包里 0 条**；28 条已关闭事件只带最近 2 条（且只有 id+title）。
    //   ⇒ 模型每轮都在"不知道哪些事已经办完、谁办完的、因何而起"的状态下开口，
    //   于是同一个人三十轮里能反复起同一件事，而读起来像失忆。
    //   口径三条：①**只报账上真有的**（不生成结局判断——引擎没有"办成了没有"的输入，leg25 f 已把"达成"收回为"结清"）
    //            ②**近 EVENT_LEDGER_TAIL 条**（老了靠既有里程碑归档，不在这里堆）
    //            ③**信息最少化**：id + 谁 + 目标 + 起因型（+ 起因 ref）——详情用 id 回查，不抄全文。
    const closedEvents = (ssot.events || []).filter((e) => e.closed).slice(-EVENT_LEDGER_TAIL).map((e) => ({
        id: e.id, title: e.title, source: e.source,
        // ★★★leg100（用户令「**可以按甲吧**」）：**给"已经收掉的事"盖一个记号**——它此前与
        //   `pendingEvents`（还没结束的事）**形状完全一样**（都是 id+title+source），模型分不出
        //   "哪个能动、哪个是墓碑"⇒ 真机上它就从这份**归档**里挑了两个号去收场（`ev_6_4`/`ev_7_2`，
        //   见 `docs/session-handoff-2026-09-21-leg100.md` §0 的真机取证）。
        //   ★为什么用**独立的一格**而不是往 title 里塞前缀：`trimPack` 的 ③ 级**只留 `{id}`**
        //     （见 `trimPack` 那段注释）⇒ 塞进 title 的字会被裁掉，而"只剩一串光秃秃的号"**正是**
        //     最像候选池的形态。⇒ 记号必须是**独立一格**，这样裁剪后它仍然活着（`{id, closed}`）。
        //   ★键序锁（`lens.test.js`）：本笔**只加一格、不动栏名**——栏名动了会连带动
        //     `prompts.js` 第 9 条、台账与两条键序锁，收益不抵风险。
        //   ★与 `closedRoots` 的分工**一个字没动**（见 `computeClosedRoots` 头注：那个才是"可以动手接的"）。
        closed: true,
    }));
    const dyn = ssot.context?.setting?.dynamic;   // K29：设定大势块（只读注入；冻结层不入包——体积纪律 A-8）
    // ★★leg60（交接第 2 件）：**刻度块**——A-8 体积纪律的**唯一一处窄口**（见 `scaleAnchorCore` 头注）。
    //   ★leg69（A1）：改走 `WithFit` 口 —— `anchor` 与原先**同一个东西**，另外拿到块级截断读数（见下 `刻度裁掉`）。
    const scaleFitRes = buildScaleAnchorWithFit(ssot.context?.setting?.frozen?.canon);
    const scale = scaleFitRes.anchor;
    // ★★★leg64 第三轮：**刻度目录**——"书里还有哪些尺"（用户拍板「递目录 + 按需查」）。
    //   为什么必须与 `刻度` 同源算：目录排除的正是**已经进包的那几张**（`scale` 的 `表` 名就是
    //   `buildScaleAnchor` 截断后的名字，目录用同一个 `cutName` ⇒ 两边认得出是同一张）。
    //   ⇒ 模型看到的是"我手里没的、但书里有的"那一份差距清单。见 `buildScaleCatalog` 头注。
    const scaleCatalog = buildScaleCatalog(
        ssot.context?.setting?.frozen?.canon,
        new Set((scale || []).map((t) => String(t?.表 ?? ''))),
    );
    // ★★★leg64 第四轮：**按需查表**——模型上一轮点名要的那几张（`meta.scaleRequests`）。
    //   与 `recalled` 同一条生命周期口径：**每轮由账上现算**，调用方在新一轮开头清掉请求
    //   ⇒ 递出去的那一轮可见、之后自然消失（不做跨轮囤积）。见 `buildScaleOnDemand` 头注。
    const scaleWanted = buildScaleOnDemand(ssot.context?.setting?.frozen?.canon, ssot.meta?.scaleRequests);
    // ★★★leg64（交接 §3-A「规则进包」）：**法则块**——只取「判断依据」那一类（见 `ruleAnchorCore` 头注）。
    //   与 `刻度` 并列进同一个 `setting` 块：一个是"书里的尺子"，一个是"书里的判定原则"，
    //   都是**冻结的短表**（编译一次、之后每轮逐字相同），都违反 A-8 而那是有意的（它们是锚）。
    const ruleFitRes = buildRuleAnchorWithFit(ssot.context?.setting?.frozen?.canon);
    const ruleAnchor = ruleFitRes.anchor;
    // ★★★leg69（A1）：**块级截断的留痕**（用户拍板「新增一个只读键」）——原先这两块在自身预算里
    //   **静默 `break`**（真账实测 34 张表 214 档 ⇒ 进包 3 张 24 档、丢 88.8% 只能靠人肉比对）。
    //   口径三条：
    //     ① **只在真丢了东西时挂键**（与 `刻度`/`法则`/`trimmed` 同一条：空着就是空着）⇒
    //        不丢东西的世界**逐字节与旧版相同**（本仓零迁移纪律）；
    //     ② 键名与包内其余键同风格（中文短语），内容 = 两个 `WithFit` 的读数（机器可读，模型/调试者都看得见）；
    //     ③ **只报"被块级预算切掉多少"**，不报被 `trimPack` 整包切掉的（那是 `trimmed` 的活，别混）。
    const dropped = {
        ...(scaleFitRes.fit && Number(scaleFitRes.fit.档?.共) > Number(scaleFitRes.fit.档?.进包) ? { 刻度: { ...scaleFitRes.fit, 原因: '块级预算（表≤16/档≤24/维≤8）' } } : {}),
        ...(ruleFitRes.fit && Number(ruleFitRes.fit.判据?.共) > Number(ruleFitRes.fit.判据?.进包) ? { 法则: { ...ruleFitRes.fit, 原因: '块级预算（条≤160/单条≤500字/总≤8000字）' } } : {}),
    };
    const scaleDropped = Object.keys(dropped).length ? dropped : null;
    // K38 补差包（敲定稿 C 条）：对话依据册摘要进包——"谁反复被点名"模型看得见（dialogueFact 源/镜头依据；
    // 只取前 TOP 条，计数+最近提及轮；依据册总量留在账上）
    const db = ssot.meta?.dialogueBook;
    const dialogueBook = db && typeof db === 'object'
        ? Object.entries(db)
            .map(([name, rec]) => ({ name, count: rec?.count ?? 0, lastTick: rec?.lastTick ?? 0 }))
            .sort((a, b) => b.count - a.count || b.lastTick - a.lastTick)
            .slice(0, DIALOGUE_BOOK_TOP)
        : [];
    // ★leg32c：已了结的盘算台账（近 AGENDA_LEDGER_TAIL 条，倒序=最近的在前）。
    //   ★**只报账上真有的三样**：谁（owner）/ 办的是什么事（goal）/ 因何而起（source）。
    //   ⚠**不报结局**——账上没有结局字段：`settle.js` 把"结清/变形/取消"写进了**编年文本**，
    //   盘算上不存。本棒**不新造**这个字段（那要动 ssot schema + 旧账迁移，属另一笔）；
    //   模型要追结局可以看 `chronicle` 的行，或按 id 回查——**宁可少报，不编一个字段出来**。
    const closedAgendas = (ssot.agendas || []).filter((a) => a.closed).slice(-AGENDA_LEDGER_TAIL).reverse().map((a) => ({
        id: a.id, owner: a.owner, goal: a.goal, source: a.source,
    }));
    // ★★leg32g：**待启用名单**——把"该轮到却没露过面的人"递到模型眼前（治"永远围绕那几个势力"）。
    //   闭环（真账实测）：那几家出手 ⇒ 镜头永远排最前 ⇒ 模型总写他们；613 人没出手过 ⇒ 永远排最后 ⇒ 模型想不起他们。
    //   ★这份名单**不是纯展示**：`settle.js` 会把它**同时**交给门控（`gateWorldStep` 的第 4 个参数），
    //   让名单上的人获得"起头"资格——否则"模型照名单给他开线、引擎照样丢掉"，名单就是空转。
    //   ⇒ 口径实现在下面那个**导出的纯函数**里（一处真源：包与门控读同一份）。
    // ★★★leg63（用户令「我要把另外两个参数也设置成可调」）：这一份**也走账上的值**了。
    //   为什么必须让它在 `lim` 里（而不是留常量）：这份名单**不是纯展示**——`settle.js` 把
    //   同一个函数算出来的那份交给门控（`gateWorldStep` 的第 4 参），名单上的人才有"起头"资格。
    //   两处若读不同的数 ⇒ 面板/包里递了 20 个人，门控只认前 12 个 ⇒ 名单空转（本仓治过的老病）。
    //   ⇒ 口径：**上限从 `lim` 进来**（`buildEvolutionPack` 的形参，`runTick` 用 `resolveLimits` 递），
    //     账上没设 ⇒ 出厂 `IDLE_FACES_TOP`（12）逐字不变。
    const idleFaces = computeIdleFaces(ssot, lim?.待启用名单 ?? IDLE_FACES_TOP);
    // ★★leg34（小说家条款 §6.4 那一格，实测坐实）：**离场名册**。
    //   细案原话：「★**`pack.js:51`** 必须一并改——否则"复活了但模型看不见他"，世界继续当他死了」
    //   ★本棒实测把这一格量得更准了：真账 621 实体里 `dead` 1（万子明）· `retired` 1（白小娥）——
    //     **两个都不在包里**（`lensList` 按 status 过滤，见上方 `rows` 那一行）⇒ 模型**连他的名字和 id 都拿不到**，
    //     而"带因复活"要求 `entityUpdates[].entity` 照抄一个 id ⇒ **不给名册 = 复活这条通道在生产上永远开不了**（死代码）。
    //   ⇒ 口径（**只报 id+name**，不报 status ⇒ 零新事实、与"宁缺勿造"一致；面板/门控都不读它）：
    //     · 为什么不是"把死者放回实体表"：那会让"死亡"从世界上消失（错的方向，方向反了）；
    //     · 为什么限最近 `DEPARTED_TAIL` 个：复活是"最近的事"能解释的（细案 §6.4 风险条：防死而复生循环刷存在感）
    //       ⇒ 只把**最近的离场**递到眼前，老的不堆包；实测本项目每 59 轮才 2 个，这一栏长期极小。
    //     · 归零时**整栏不出现**（`undefined`，不是空数组）——硬规矩「空着就是空着」。
    const departedRows = (ssot.entities || [])
        .filter((e) => e.status === 'dead' || e.status === 'retired')
        .sort((a, b) => (b.lastActiveTick ?? -1) - (a.lastActiveTick ?? -1) || (a.id < b.id ? -1 : 1))
        .slice(0, DEPARTED_TAIL)
        .map((e) => ({ id: e.id, name: e.name }));
    // ★leg34（小说家条款 §7.3 闭环的**最后一格**）：**已取回字段**。
    //   病根（本棒实测）：实体段是**行式表格、列固定**（leg31 `ENTITY_TABLE_HEADER` = id/kind/name/location/parent/实力/members/player），
    //   而"主动查"要查的正是**丙级字段**（身份/定位/性质/规模/倾向…）——它们**不在列里** ⇒ 查回来写进 `entity['身份']` 之后，
    //   **下一轮的包里一个字都没有** ⇒ 模型问完还是不知道答案，**这条通道等于白问**（与"复活是死代码"同族的接线没接完）。
    //   ⇒ 口径：模型**主动问过**的值，单独成一段递过去（**只递它问过的**，不问的丙级字段照旧不进包——这正是"用时再查"的本义）。
    //     不是给实体表加列（leg31 的表达法不许回退），是**另起一段**。
    //   ⚠生命周期：原样 **1 轮**（由 `web/index.js` 的 `clearStaleFetched` 在下一轮消费后清掉）——
    //     既保证模型看得见，又不会让"查过的字段"变成实质上的每轮必带。
    // ★★leg34（用户追问「为什么聊天 llm 能直接获取世界书内容…都是一轮解决的啊」）：**本回合检索到的世界书片段**。
    //   为什么放在**包里**而不是另起一次调用：ST 的关键词世界书与 `yuzuki-Memory` 的向量召回都是**组装提示词那一刻**
    //   把书塞进去的 ⇒ **当轮可见、零额外调用、零跨轮状态**。本候选照同一条路走（检索在 `preStep`，出包之前）。
    //   ★只在这一轮**真检索到**时出现（`meta.recalledText` 由编排层写；没检索就不留空栏）。
    const recalledText = typeof ssot.meta?.recalledText === 'string' ? ssot.meta.recalledText.trim() : '';
    const pack = {
        world: ssot.context?.world,
        // 张力：有 setting 取演化层强度（引擎算），无则回退 context.tension 数字（细案 §3.1 兼容口径）
        tension: dyn ? dyn.tension?.intensity : ssot.context?.tension,
        // ★★leg60：大势块 = 张力三件 + 环境量（固定小结）**+ 刻度**（维度/范围/档位，见 buildScaleAnchor）。
        //   `scale` 为空（本书没有成文的维度/档位表）⇒ 键不出现，与本棒之前**逐字节相同**（既有判据与冒烟面零扰动）。
        //   ★leg62：`scale` 现在是**概念表列表**（一把尺一个元素，见 `buildScaleAnchor` 头注），
        //     故这里由调用点写 `刻度` 这个键（改前 `buildScaleAnchor` 自己返回 `{刻度:[…]}` ⇒ 这里会嵌成两层）。
        setting: (dyn || scale || ruleAnchor || scaleCatalog || scaleWanted || scaleDropped) ? {
            ...(dyn ? { tension: dyn.tension, env: dyn.env ?? {} } : {}),
            ...(scale ? { 刻度: scale } : {}),
            // ★leg64 第三轮：**目录**（只表名 + 规模，不带档位内容）——治"60 张尺模型不知道存在"。
            ...(scaleCatalog ? { 刻度目录: scaleCatalog } : {}),
            // ★leg64 第四轮：**点名要来的整张表**（`刻度补` = 补料；空着就是空着）。
            ...(scaleWanted ? { 刻度补: scaleWanted.tables } : {}),
            ...(ruleAnchor ? { 法则: ruleAnchor } : {}),   // ★leg64：判据进包（老账/无判据 ⇒ 键不出现）
            // ★leg69（A1）：块级截断读数（**只在真丢了东西时出现**）。
            //   ★位置纪律：**缀在它所描述的两块之后**——本仓有"包内键序"的锁（`lens.test.js` 立、
            //     leg32c/leg32g 各续），把新键插在中间会动到既有键的相对位置；缀尾只做加法。
            //     且它只在"真丢了"时出现 ⇒ 不丢东西的世界（含 golden 夹具）**键集合一字不变**。
            ...(scaleDropped ? { 刻度裁掉: scaleDropped } : {}),
        } : undefined,
        positions: ssot.context?.positions,
        entities,
        agendas,
        pendingEvents,
        // ★leg34：离场名册——见上方注释（复活通道的**前提**，不是展示品）。        //   ★形状口径：**恒为数组**（空则 `[]`），与 `idleFaces`/`pendingEvents` 一致。
        //     为什么不留"空则整栏不出现"：`lens.test.js` 的**键序锁**（leg25 立、leg32c/leg32g 各续一次）
        //     把 pack 的键集合逐字锁住了 ⇒ 此处若**有时有键、有时无键**，那条锁就只能在某个分支上为真。
        //     （本仓既有先例：`setting` 缺省就是 `undefined` ⇒ **键在值为空**，不是键消失。）
        departed: departedRows,
        recentClosedEvents: closedEvents,
        playerMove: moveFact || null,
        dialogueBook,
        // ★leg32c：已了结的故事线台账（长跑接得上——见上方 `closedAgendas` 注释）
        closedAgendas,
        // ★leg32g：待启用名单——"该轮到却没露过面的人"（见上方 `idleFaces` 注释）
        idleFaces,
        // ★★leg40：**线头台账 + 线捆**——"起了根、但还没人接的线"（见 `computeOpenRoots`/`computeThreads` 注释）。
        //   恒为数组（空则 `[]`）：与 `idleFaces`/`departed` 同一形状口径，键序锁才稳。
        openRoots: computeOpenRoots(ssot),
        // ★leg40b 续（尺度上限参数化）：线捆条数 = 账上档位（`每轮递线`）优先、否则出厂 `THREADS_TOP`。
        //   `lim` 由调用方（`runTick`）用 `resolveLimits(world)` 递进来——**本文件不反向 import**
        //   （`limits.js` 要引用本文件的 `THREADS_TOP` 当默认值 ⇒ 反向 import 会成循环依赖）。
        threads: computeThreads(ssot, lim?.每轮递线 ?? THREADS_TOP),
        // ★★leg40 第三条料路：**拾遗**——已了结但**没人接**的旧事件（"接上它也算一步"，见 `computeClosedRoots` 注释）
        closedRoots: computeClosedRoots(ssot),
    };
    // ★leg34：**本回合检索到的世界书片段**——"有才挂键"（空着就是空着）。
    //   为什么与 `departed` 口径不同（那个恒为数组）：`departed` 受 `lens.test.js` 的键序锁约束（它的世界里
    //   有没有离场者都会走到同一分支）；这一段是**本回合真的检索到**才存在 ⇒ 挂 `undefined` 键没有意义。
    if (recalledText) pack.recalled = recalledText;
    // ★★★leg89：**本轮正文里"已经发生过的事"**（标签提取，设计见 `docs/spec-tagged-actions-extraction.md`）。
    //   为什么它必须是新键、且**只做加法缀在最末**：本文件的键序被 `lens.test.js` 逐字钉住
    //   （`pack.js:924/934` 都写着这条纪律）⇒ 中间插键会咬。缀尾 + **没抽到就不留键**
    //   （照 `recalled` 那条口径）⇒ 没标签的老聊天**逐字节回到今天**。
    //   ★它进的是**主调用的输入**，不是世界步：世界步仍由模型提议、引擎结算门控（红线不破）。
    //   ★`elapsed` 是**账外的料**——引擎一个字都不解析它（账按轮走，故事按时间走）。
    if (turnFacts) pack.turnFacts = turnFacts;
    // leg25（死代码接线）：**总预算在这里强制**。此前 `trimPack` 全仓生产 0 调用——
    //   lensList 只按 lensMaxTokens 截**实体段**，agendas/pendingEvents/setting/positions **不参与任何裁剪**，
    //   30k 预算等于纸面数字（余量正被名册增长吃掉）。现改为：出包即自检**整包**预算，超限即按固定剪枝序裁。
    // 裁剪痕迹以 `pack.trimmed = ['recentClosedEvents', ...]` 留在**包里**（机器可读）：模型与调试者都知道
    //   "你看到的是删过的"，不是静默丢料。未裁剪时不写该键（旧输出逐字节不变，防回归）。
    // 降级通道：实体行按需重建（**惰性**——不裁剪时一次都不建，输出与原实现逐字节一致）
    Object.defineProperty(pack, '__relight', {
        value: (mode) => lens.map(({ e }) => entityRow(e, mode)),
        enumerable: false, writable: false, configurable: false,
    });
    trimPack(pack, EVOLUTION_BUDGET_TOKENS);
    // 判据 C（细案 §5）：行式分隔符冲突**出包期机械自检**，不靠"我看过没问题"。
    //   单本实测命中 0，但那是单本读数 ⇒ 一旦某世界书的名字里带 TAB/换行，这里如实上报（并并入 trimmed 痕迹）。
    const anomalies = entityTableAnomalies(pack.entities);
    if (anomalies.length) {
        pack.tableAnomalies = anomalies.slice(0, 5);
        if (!pack.trimmed) pack.trimmed = [];
        pack.trimmed.push('entities.tableAnomaly');
    }
    const text = packTextOf(pack);   // ★细案 §2.1：唯一序列化口径；estTokensOf 同一个函数 ⇒ 不存在"两把尺子"
    return { pack, text, estTokens: Math.ceil(text.length / TOKEN_RATIO) };
}

// 预算强制（leg25：`trimPack` 死代码接线而来——**函数本体保留**，只是现在真的有人调用它）。
// 固定剪枝序（确定性、可复现、与输入顺序无关；每段前重新量体，压进预算即停）：
//   ① entities.slim（实体行逐出重可选字段：麾下成员简表 / 分支表 / 机构表——**一并**逐出，
//      因为"只逐出成员"这一级在实测场景里从不成立，写进痕迹只会变成假账）
//   ② entities.idOnly（实体行只剩 id+name——视野仍全量，细节最省）
//   ③ recentClosedEvents（只留 id）④ pendingEvents（只留 id+title）⑤ agendas.detail（只留 id+goal+progress）
// 就地裁剪传入的 pack 并**把裁剪痕迹写进包里**（`pack.trimmed = [...]`，机器可读：模型与调试者都知道
//   "你看到的是删过的"，不是静默丢料）；未裁剪时不写该键（旧输出逐字节不变，防回归）。
// 返回被裁字段名清单（空数组=未裁，包原样）。就地改是安全的：buildEvolutionPack 每 tick 新建 pack，
//   不与调用方共享引用（旧版 structuredClone 版本正是"没人调用"的死代码形态）。
// 实测说明（900 实体/300 未决事件/300 在飞盘算的记账场景）：只靠 ③④⑤ 压不进 30k——实体段本身就吃满预算，
//   故剪枝序前移两段实体降级；最坏情况仍越界时留 `budgetOverrun` 痕迹（不静默炸预算）。
export function trimPack(pack, budgetTokens = EVOLUTION_BUDGET_TOKENS) {
    const cut = [];
    const stage = (name, reduce) => {
        // 每一段前重新量：压进预算即停（序固定 → 结果确定）。量体走模块级 estTokensOf（见文件头部说明：
        //   裁剪路径上不留任何可悬空的局部辅助名——小世界冒烟走不到这里，只有真超预算才会执行）。
        if (estTokensOf(pack) <= budgetTokens) return;
        reduce();
        cut.push(name);
    };
    // ① 实体行：逐出麾下成员简表（C7 派生，逐行最重）/ 分支表（C8）/ 机构表（leg23）——核心字段与 parent 保留
    stage('entities.slim', () => {
        if (pack.__relight) pack.entities = pack.__relight('slim');
    });
    // ② 实体行：只剩 id+name（最省形态；镜头次序与人数不变——"谁在棋盘上"不丢，"细节"丢）
    stage('entities.idOnly', () => {
        if (pack.__relight) pack.entities = pack.__relight('idOnly');
    });
    // ③ 最近关闭事件：本 tick 已不是主料（防满步重播），只留 id 供回溯
    //   ★leg100：**记号 `closed` 必须跟着留**（不能只留 `{id}`）——那一格是本笔给"归档"盖的戳，
    //     而"只剩一串 id"恰恰是最容易被当成候选池的形态（真机上就是这么出的事，见 `closedEvents` 处注释）。
    stage('recentClosedEvents', () => {
        if (pack.recentClosedEvents?.length) pack.recentClosedEvents = pack.recentClosedEvents.map((e) => ({ id: e.id, closed: true }));
    });
    // ④ 未决事件详情：id+title 保住"有事在飞"，砍掉 source/position 细节
    stage('pendingEvents', () => {
        if (pack.pendingEvents?.length) pack.pendingEvents = pack.pendingEvents.map((e) => ({ id: e.id, title: e.title }));
    });
    // ⑤ 在飞盘算细节：id+goal+progress 保住目标与进度，砍掉 stage/visibility/memory/parentId
    stage('agendas.detail', () => {
        if (pack.agendas?.length) pack.agendas = pack.agendas.map((a) => ({ id: a.id, goal: a.goal, progress: a.progress }));
    });
    // ⑥ ★leg32c 新增：已了结盘算台账最先被裁（它是最"可牺牲"的一段——往事不如在办的事要紧）。
    //   顺序放在最后 = 只有在实体段与其余各段都压过之后才动它；裁时留 id+goal（"谁办过什么"仍可回查）。
    stage('closedAgendas', () => {
        if (pack.closedAgendas?.length) pack.closedAgendas = pack.closedAgendas.map((a) => ({ id: a.id, goal: a.goal }));
    });
    // ⑦ ★leg32g：待启用名单**整段丢弃**（不是截短——名单靠"轮转"保证公平，截短会让排在后面的永远露不了头）。
    stage('idleFaces', () => { pack.idleFaces = []; });
    // ⑧ ★leg34：**检索到的世界书片段整段丢弃**——它排在固定剪枝序的**最后**。
    //   为什么最后（最可牺牲）：它是**附加细节**（"这个人什么来头"），而前面每一段都是**当下必须知道的事**
    //   （谁在办什么/什么事在飞/谁该轮到）。预算真不够时，先丢"书的复印件"，保住"世界的现状"。
    //   ★守卫：**这一段不存在时这一步不执行**（否则剪枝顺序报告里会多出一条"丢了空气"的记录——读数就不实了）。
    if (pack.recalled !== undefined) stage('recalled', () => { delete pack.recalled; });
    // 兜底痕迹：固定剪枝序全部用尽仍越界 → 如实记在包里（不许"预算已强制"变成一句空话）
    if (estTokensOf(pack) > budgetTokens) cut.push('budgetOverrun');
    if (cut.length) pack.trimmed = cut;
    return cut;
}
