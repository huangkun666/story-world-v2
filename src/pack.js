// story-world-v2/src/pack.js
// 演化上下文打包（S4/S5 共用）：世界自身状态 + 玩家落子事实 → 主调用输入。
// 长跑防线细案 §2.1：预算常量（原提案 4k tokens 已废；第十九棒 K44 拍板 30k，见下方 EVOLUTION_BUDGET_TOKENS）+ 固定打包序 + 超限剪枝。
// ★leg32g：门控的"久未出手"阈值**直接读门控真源**（`gate.js` 的 `QUIET_TICKS`），不在这里另抄一个数
//   ——"待启用名单"的筛选口径必须与门控的静默判据**同一把尺子**，否则会出现"引擎说他不静默、名单里却当他冷门"。
import { QUIET_TICKS } from './gate.js';
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

// 固定打包序：活跃实体简表 → 在飞盘算（含 memory）→ 未决事件 → 最近 2 tick 关闭事件 → 玩家落子事实 → 张力
// 已结算盘算不再喂给模型（防满步重播，活档实测发现）
// K2/P3：分量不再入包（ANCHOR §3③：模型看不到分量、不参与分量；门控在引擎侧兜底）
// leg25：出包末尾**强制整包预算**（超限按固定剪枝序裁，包内留 `trimmed` 痕迹；见 trimPack）
export function buildEvolutionPack(ssot, moveFact, { picks = null, lim = null } = {}) {
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
    }));
    const dyn = ssot.context?.setting?.dynamic;   // K29：设定大势块（只读注入；冻结层不入包——体积纪律 A-8）
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
    // ★leg40b 续：`待启用名单`（`IDLE_FACES_TOP`=12）**刻意不做旋钮**（丙档只读：一次调太多，每个都得重跑基线）
    //   ⇒ 这里仍是出厂常量（见 `buildEvolutionPack` 形参 `lim` 的注释）。
    const idleFaces = computeIdleFaces(ssot);
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
        setting: dyn ? { tension: dyn.tension, env: dyn.env ?? {} } : undefined,   // 大势块：张力三件 + 环境量（固定小结；derivedFrom 属引擎记账不入包）
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
    stage('recentClosedEvents', () => {
        if (pack.recentClosedEvents?.length) pack.recentClosedEvents = pack.recentClosedEvents.map((e) => ({ id: e.id }));
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
