// story-world-v2/src/pack.js
// 演化上下文打包（S4/S5 共用）：世界自身状态 + 玩家落子事实 → 主调用输入。
// 长跑防线细案 §2.1：预算常量（原提案 4k tokens 已废；第十九棒 K44 拍板 30k，见下方 EVOLUTION_BUDGET_TOKENS）+ 固定打包序 + 超限剪枝。
// ★leg32g：门控的"久未出手"阈值**直接读门控真源**（`gate.js` 的 `QUIET_TICKS`），不在这里另抄一个数
//   ——"待启用名单"的筛选口径必须与门控的静默判据**同一把尺子**，否则会出现"引擎说他不静默、名单里却当他冷门"。
import { QUIET_TICKS } from './gate.js';
import { geographyPack } from './geography.js';
import { fitGeography } from './geography-fit.js';
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
// ★★★leg118（B2 接检索层 · 用户 2026-09-23 拍的硬约束「**世界模型检索到的和进包的不能重复**」）：
//   **往事那一栏的取数换家了**——不再由本文件 import `chronicleBrief` 伸手进编年账里抓，改成向**检索层**要
//   （那条唯一入口在 `ledger-recall.js`，聊天模型那一侧已经在用它）。
//   ★为什么要换（不是"迟早"这种理由，是**两套取法必然分叉**）：换之前，同一件往事有**两条各写一套的取数路**
//     ——世界模型一条（本文件直取）、聊天模型一条（检索层）；而本仓刚为这个形状付过一次账：leg117 合并的
//     "两份编年行规则表"实测**已经分叉**（同一行话，一边判"收"、一边判"弃"）。
//   ★用户那条硬约束只能靠"一条取数路"守住：世界模型那一次调用只有一条消息（`transport-http.js:91`）
//     ⇒ "不重复"= **那份包里一件往事只许有一栏落脚**。一栏、一源 ⇒ 结构上不可能重复。
//   ★本文件从此只 import 那个叶子的**两个纯函数**（认"这是什么话" + 洗行文），取舍仍归本文件（见 `fetchChroniclePast`）。
//   ★环基线不动（细案 §4.2 已核）：`pack.js → ledger-recall.js → chronicle-brief.js`，而 `chronicle-brief.js`
//     零 import ⇒ 三条边**没有回路**（`module-layout.test.js` 是 DFS 全图检测）。
import { isChronicleBriefLine, briefLineText } from './chronicle-brief.js';
import { recallLedger, RECALL_MODES, buildQuery, matchedKeysOf, chronicleOf } from './ledger-recall.js';
// ★★★leg128（用户令「把整个链路打通，包含多因点」· 设计见 `docs/spec-context-master.md` §4）：
//   **故事线**——把账切成的一条条因果线（切树＋立线住在 `lines.js`：纯函数、零写账、零创作）。
//   环基线不动：`pack.js → lines.js → setting.js`，而 `setting.js` 不 import 本文件 ⇒ 没有回路
//   （`module-layout.test.js` 是 DFS 全图检测）。
import { linesOf, lineTextOf, buildLineDetails, pickLinesForPack, pickLinesToPrefetch } from './lines.js';
// ★★★leg114（用户 2026-09-22 拍板「**30000token 预算也太少了**…做个调整的入口，**让用户根据自家模型的能力动态调节**」）：
//   **包预算那个数换家了**——它现在住在 `limits.js`（`PACK_BUDGET_TOKENS`，与那七个尺度上限**同一张表、
//   同一处存储、同一个写通道**）⇒ 本文件**从那里取**，不再自己写一个 30000。
//   ★为什么可以反向 import 而**不成环**（实测）：`limits.js` 是**零 import 的"叶子里的根"**
//     （它自己定义 `THREADS_TOP` 那些值，谁都不 import）⇒ `pack.js → limits.js` 这条边**没有回路**。
//   ★本文件里旧的那句"`limits.js` 要引用本文件的 `THREADS_TOP` 当默认值 ⇒ 反向 import 会成循环依赖"
//     （见下面 `threads` 那一栏的注释）是 **leg40b 的旧话**：那时 limits.js 还 import 别人；
//     今天它零 import，**那句话已不成立**——本笔照实勘正。
// ★★★本笔（把 leg114 那两格的成例补齐）：`THREADS_TOP` / `IDLE_FACES_TOP` 的**家也在 `limits.js`**——
//   本文件从此**只转发、不再自己写数字**。旧形态是"同一个数两个家"：`limits.js` 一份喂 `LIMIT_DEFAULTS`，
//   本文件另有一份当 `lim?.x ?? 出厂` 的兜底（且 `render.js` 与两个判据文件直接 import 本文件这一份）
//   ⇒ 两处迟早漂移（本仓老病："面板上写着 6、引擎按 3 跑"）。
//   ★转发写成 `import` ＋ `export` 两句，**不许**写 `export { X } from './limits.js'`：
//     后者**不建立本地绑定**（本仓实测过：模块内会 `X is not defined`），而本文件下面
//     `computeIdleFaces`/`computeThreads` 的形参缺省与 `threads` 那一栏都要用本地名。
import {
    PACK_BUDGET_TOKENS, RECENT_WINDOW_TURNS as LIMIT_RECENT_WINDOW_TURNS,
    THREADS_TOP, IDLE_FACES_TOP, resolveLimits,
} from './limits.js';
export { THREADS_TOP, IDLE_FACES_TOP };   // 家已搬到 limits.js；本行只是转发（要改值只改 limits.js）
// K44/第十九棒（full-roster-lens-spec C2/C7 拍板）：实体段=**镜头选择器**——
//   全量棋盘上按「四段确定性序：①例外保送（被点名/在飞盘算属主/近 2 tick 活跃）②手上有在办盘算 ③近 5 轮出手 ④实体 id 序」排序、30k 内取前缀；
//   势力实体附「麾下成员」简表（parent 派生反查，含分支成员）；分量数字仍不入包（P3 不变）。
// ★★★leg114：**这个导出名保留**（`smoke.js` 与 `lens/prompts/worldstep` 三个判据文件都从本文件 import 它），
//   但它现在只是 `limits.js` 那个家的**转发**——**值只有一处**，要改值只改 `limits.js`
//   （"一个数两把尺子"是本仓老病：就地改本文件一处 ⇒ 包按 A 裁、冒烟按 B 断言）。
export const EVOLUTION_BUDGET_TOKENS = PACK_BUDGET_TOKENS; // 家已搬到 limits.js（leg114）；本行只是转发
// ★★★leg133：往事窗口的出厂值**家也在 `limits.js`**（与 `包预算` 同一张表、同一个旋钮通道）——
//   本行同样只是转发，**不许在这里另写一个数**（"同一个数两把尺子"是本仓老病）。
export const RECENT_WINDOW_TURNS = LIMIT_RECENT_WINDOW_TURNS;
// ★★★leg136（用户令「**不要搞那么多闸了**」）：`LENS_DEFAULT_MAX_TOKENS`（原 30000）**已撤**。
//   撤它的理由（两条，都是实测/审计逼出来的）：
//     ① **它是个"咬住了也不出声"的暗闸**：`lensList` 到上限就 `break`，**包里一个字都不记**
//        （leg131 审计 §2 已经点过这一条：leg69 为「刻度/法则」的同类静默截断专门补了留痕键
//        `刻度裁掉`，而实体段这一处没治 —— **同一族病，一处治了、一处没治**）；
//     ② **它是第二个预算**：注释写着"（同值）"，而 `包预算` 已抬到 50000（leg135）⇒ 注释成了假话；
//        玩家把「包预算」拧到 60000，实体段仍在 30000 处静默截断 —— 本仓老病"一个数两把尺子"。
//   ⇒ 口径改成**跟着账上那个 `包预算` 走**（`lensList` 的缺省上限 = `resolveLimits(ssot).包预算`），
//     并且**真截了就把 `entities.lens` 记进 `pack.trimmed`**（见 `buildEvolutionPack` 里那一处）。
//   ★整包那一道 `trimPack` 照旧是最后一道兜底（它有自己的降级序与痕迹），这里只是**不再另立一把尺**。
//   ★`LENS_MEMBERS_TOP` **没撤**（它管的是"一行里列几个成员"，不是"给模型看多少"；
//     超出记「等 N 人」= 如实报数，不是静默丢）。
export const LENS_MEMBERS_TOP = 8;            // 势力麾下成员简表条数上限（份内按**名号序**，leg25 b 前为分量序；超出记「等 N 人」）
export const TOKEN_RATIO = 3;                // 粗略估计：1 token ≈ 3 字符（中文）
// ★★★leg136：`DIALOGUE_BOOK_TOP`（原 5）**已作废**（改成"有多少给多少"）。
//   它的生产端已经不在了（`meta.dialogueBook` 全仓只有 `pack.js` 一个读者、没有写者 —— leg136 实测真账上
//   这个键**根本不存在**）⇒ 这一格今天恒为空数组，闸也就恒不咬。留着 5 只会让下一任以为"这一栏被限过 5 条"。
export const DIALOGUE_BOOK_TOP = Infinity;   // 已作废（原 5）：条数闸撤掉，有多少给多少

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
// ★★★leg136（用户令「**不要搞那么多闸了**」· 曲线在交接 leg136 §3.2）：**这三道条数闸一并撤掉**。
//   实测（真账 tick 61 · 621 实体 · 用户自己的 60000 预算）：
//     · 已闭事件 **33 条只进 8 条**（砍掉 2,320 字符）· 已了结盘算 **29 条只进 12 条**（砍掉 1,336 字符）
//       · 线捆 **21 条只进 10 条**（砍掉 886 字符）—— 而**整包只用了预算的 33.1%**、`trimmed` 是 `null`。
//   ⇒ 一句人话：**闸在砍真东西，钱却还剩三分之二**。这正是本仓自己写过两遍的那条教训
//     （`abstract-tier.js`："条数不是预算的度量，字符才是"；`pack.js`："用错的单位去封顶，
//      会从结构上把预算卡死"）。
//   ⇒ 口径：**这三格改成"有多少给多少"**，越界由**整包那一道 `trimPack`** 去裁（它有固定剪枝序、有痕迹）。
//     实测把上面几道全拆掉之后整包 30,829 est / 60,000 = **51.4%，仍然不越界**。
//   ★为什么留 `Infinity` 这个名字而**不是删掉**（照 `ROSTER_CAP`/`POSITIONS_CAP` 的先例）：
//     ① 判据与面板从这三个名字读值（删了要动调用面）；② "已作废"要看得见，不能变成"查不到"。
export const EVENT_LEDGER_TAIL = Infinity;    // 已作废（原 8）：有多少给多少
export const AGENDA_LEDGER_TAIL = Infinity;   // 已作废（原 12）：有多少给多少
// ★leg34：**离场名册**带回包里几个（dead/retired；只报 id+name）。它是"带因复活"通道的**前提**——
//   死者不在包里 ⇒ 模型拿不到他的 id ⇒ 复活提议永远提不出来（leg34 实测：这一栏原本是死代码）。见下方 `departed` 注释。
//   ★leg136：`DEPARTED_TAIL`（原 20）**已作废**。原注释给的理由是"防死而复生循环刷存在感"——
//     而实测这一栏**每 59 轮才 2 个**（真账 61 轮共 3 个）⇒ 那道恐惧不成立；真要防，该防的是
//     "复活"那条提议本身，不是"报几个名字"。⇒ 改成有多少给多少。
export const DEPARTED_TAIL = Infinity;
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
//   ★每轮递几张脸的上限**不在这里定义**：家已搬到 `limits.js`（`IDLE_FACES_TOP`），本文件只转发（见文件头那段）。
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
//   ★线捆条数的上限**不在这里定义**：家已搬到 `limits.js`（`THREADS_TOP`），本文件只转发（见文件头那段）。
// ★leg40：拾遗栏（已了结、没人接的旧事件）带回包里几条。
//   为什么原来定 6：真账实测这类"没人接的旧线头"有 14 条；一次给太多会把模型拉回"翻旧账"。
//   ★★★leg136（用户令「**不要搞那么多闸了**」）：**已作废**（原 6）——改成"有多少给多少"。
//     理由与上面三道同一条：这一栏真账上是 21 条线头里被筛出来的那几条，**每条只有 id/标题/地点/人名**，
//     体积很小；而"给太多会翻旧账"这个担心**是内容问题，不是体积问题**——真要收窄，
//     该收窄的是**筛选口径**（它已经有三条机械排序），不是"砍到第 6 条为止"。
//     实测：拆掉之后这一栏 0 字符差额（真账 `computeClosedRoots` 本来就只筛出 6 条），
//     ⇒ 这道闸今天**没在砍东西**，但它在"更大的世界"上会砍 —— 与其留一把没人量的尺，不如撤掉。
export const CLOSED_ROOTS_TOP = Infinity;

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
    return JSON.stringify(pack, function (key, value) {
        return key === 'entities' && this === pack ? entityTableBlock(value) : value;
    });
}

/**
 * ★★★leg136：镜头名单（**带截断读数**的版本）——`{ list, fit }`，`list` 与 `lensList` 的返回值**同一个东西**。
 *
 * 为什么要另开这个口（照 `buildScaleAnchorWithFit` 的先例，**不是新花样**）：
 *   `lensList` 到上限就 `break`，**包里一个字都不记** —— leg131 审计 §2 点过这一条
 *   （leg69 为「刻度/法则」的同类静默截断专门补了留痕键，实体段这一处没治）。
 *   ⇒ 出包那一步要走这个口，把"一共几个、只给了几个"如实记进 `pack.trimmed`。
 *
 * ★缺省上限 = **账上那个 `包预算`**（不再另立一个 30000）：
 *   · 有账、且玩家拧过 ⇒ 用他拧的那个值（`resolveLimits` 现取）；
 *   · 没账 / 夹具 ⇒ `LIMIT_DEFAULTS.包预算`。
 *   ⇒ 本仓那条"一个数两把尺子"在这一格**到此为止**：镜头与整包**同一把尺**。
 *   ★调用方仍可显式传 `lensMaxTokens`（判据用它注入小值验证截断机制）。
 *
 * @param {object} ssot 世界账（只读）
 * @param {{lensMaxTokens?: number|null, moveFact?: object|null}} [opts]
 * @returns {{list: {e: object}[], fit: {进包: number, 共: number, 上限: number}}}
 */
export function lensListWithFit(ssot, { lensMaxTokens = null, moveFact = null } = {}) {
    const cap = Number.isFinite(lensMaxTokens) && lensMaxTokens > 0
        ? lensMaxTokens
        : resolveLimits(ssot).包预算;
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
        if (out.length && used + cost > cap) break;    // 前缀截断（至少保留首名，防御空镜）
        used += cost;
        // ★本笔删掉 `w`（分量）：**全仓零消费者**——读过 `lensList` 返回值的只有
        //   `observatory.js` / `render.js`（都只取 `x.e.id`）与 `lens.test.js`（只读 `.e`）
        //   ⇒ 旧注释自称"向后兼容保留"其实**没有兼容对象**。
        out.push({ e });
    }
    // ★leg136：读数与实物同源——`进包` 数的是**交出去那一份**，`共` 是排序后、截断前的全部。
    return { list: out, fit: { 进包: out.length, 共: rows.length, 上限: cap } };
}

/**
 * 薄壳：**返回形状与 leg44 起逐字节相同**（`{e}[]`）——三个既有调用点与各形状断言零扰动。
 * ★要读截断读数的消费口走 `lensListWithFit`（面板/出包）。
 */
export function lensList(ssot, opts = {}) {
    return lensListWithFit(ssot, opts).list;
}

// ★★★leg141b（用户当场问「**势力的麾下怎么点击窗口不显示**」）：**"谁归我管"那条判据抽出来，一处定义、两处消费。**
//   病：判据（`kind === 'character'` ∧ `parent ∈ {势力名, 其分支}`）原先**只长在 `membersOf` 里面**，
//   而 `membersOf` 的**呈现**是"面板那一行"——**截到 8 个**（`LENS_MEMBERS_TOP`）、只出名号、
//   超出记「等 N 人」。实体观览窗口要的是**另一份呈现**（全量、带 id、可点）。
//   ⇒ 照本仓那条"同一件事只许有一把尺子"：**判据抽成 `memberEntitiesOf`**，
//     `membersOf` 在它上面加"截断 ＋ 名号 ＋ 等N人"。★`membersOf` 的输出**逐字节未变**
//     （它的三个消费者 `pack.js:1221` / `render.js:1721` / `demo/inspect-affiliation.js:54` 一个都不受影响）。
/**
 * 麾下成员的**实体表**（C7 派生反查；**判据唯一真源**）：`characters` 的 `parent` 命中
 * 实体名/其分支名 → 归该势力。★按**名号序**排（同值按 id 兜底）——确定性，与 `membersOf` 同一把尺。
 * @returns {object[]} 实体数组（**不截断**；没有成员 ⇒ 空数组）
 */
export function memberEntitiesOf(world, faction) {
    const scope = new Set([faction.name, ...(faction.branches || [])]);
    return (world?.entities || [])
        .filter((e) => e.kind === 'character' && e.parent && scope.has(e.parent))
        .sort((a, b) => {
            const an = String(a.name ?? ''), bn = String(b.name ?? '');
            if (an !== bn) return an < bn ? -1 : 1;                   // ① 名号序（人可读，确定性）
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;            // ② 同名兜底：id 序
        });
}

// 麾下成员简表（C7 派生反查）：**呈现**那一半——取前 LENS_MEMBERS_TOP 个名号，超出记「等 N 人」。
// leg25 b（A1）：排序键由 `world.weights`（那个 0-1 的数）改**名号序**——片3 定案「引擎不拿数值排序」的
//   最后一处残留。旧法在 leg24 片2 之后必然退化：势力成员普遍四维为空 → 同取中立 floor → 分量全等 →
//   排序结果随底层数组顺序漂移，面板「麾下：」名单每次重算都可能换位。现在名号序逐字节稳定。
export function membersOf(world, faction) {
    const list = memberEntitiesOf(world, faction);
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
//   体积纪律（★leg163 起：**没有条数上限了**——只有每个字符串 ≤ SCALE_STR_MAX 字这一道长度闸，
//     与整包那一道 `trimPack`；见下面 leg163 那一段。旧的"维度 ≤ DIM_TOP · 档位 ≤ TIER_TOP"已删）
//   ⇒ 最坏 ≈ (8+24)×(30+8) ≈ 1,216 字符（对 30,000 token 的包预算是 4% 量级；leg28 实测峰值 19,241）。
//   键口径：解析不出任何维度/档位 ⇒ 返回 null ⇒ **键不出现**（"空着就是空着"，与 env 同一条纪律）。
// ★★★leg163（用户令「**删掉那三道，让预算当唯一的闸**」）：**三道上限整批删除** ——
//   `SCALE_TABLE_TOP_PACK`(64) / `TIER_TOP`(300) / `DIM_TOP`(16) 三个常量**不再存在**，
//   刻度块的口径定稿为「**书里有几张尺就给几张**」（这正是 leg135 那条「全塞」令的字面意思）。
//   为什么删（本笔真账实测，逐条算过，指得出出处）：
//     · **它们从来不是在保护预算**：刻度块实际只占 **6.94%**（10,417 字符 ≈ 3,472 token / 50,000）；
//       三道上限**全部吃满**时的最坏体积也只 **8.9%**（≈13,288 字符）；而真账整包只用 **54.4%**、
//       `trimmed` 是 `null`（预算根本没满）⇒ 闸在关着一扇预算根本没关的门。
//     · **而它们在真账上已经开始咬**：`real-world-dh` 是 45 张表 / **293 档**，离 `TIER_TOP=300`
//       只差 **7 档** ⇒ 再加两张小表，排在后面的表就**整张进不去**，而预算还剩 45%。
//     · **用户这条令下过一次、没落地**：leg136「**不要搞那么多闸了**」那一笔只改了参数页的一行说明文
//       （见 `render-base.js:432` 留档），**闸原地没动** ⇒ 本笔把那条令真正落地。
//   ★预算这一侧**本来就是诚实的**：删掉这三道之后，唯一的闸是整包那一道 `trimPack`——
//     它有固定剪枝序，真裁了就写 `pack.trimmed`（机器可读），压不进还有 `budgetOverrun` 痕迹。
//   ★★为什么放开刻度不会挤掉别的东西（这条是关键，改回去之前先读）：
//     **`刻度` 根本不在 `trimPack` 的剪枝序里**——它与 `法则` 同性质，是"书里的锚"，
//     按设计受保护（`trimPack` 那一段注释写明了剪枝序是 entities → 未决事件 → 盘算 → 纪事 →
//     相关往事 → recalled，刻度不在其中）。⇒ 放开它的上限**不会**让它在别人之前被裁掉。
//   ★如实登记的代价：一本表极多、平均档数很高的书，刻度会与「纪事」「相关往事」抢预算——
//     那时被裁的是**整包级**的 `trimmed`（会如实报出来），而不是像原来那样**悄悄少几张表**。
//   ★历史留档（别再照它改回去）：leg135 把这三个数从 `24/8/16` 抬到 `300/16/64`，理由是当时
//     真书 41 张表 / 259 档被旧上限丢掉了 90.7%。**那个判断没错，只是它只走了一半**——
//     抬上限仍是"猜一个够大的数"，而本笔实测证明：只要还是写死的数，迟早有书撞上它。
export const SCALE_STR_MAX = 30;
//   ★★★leg163：上面那条"表数上限必须 ≥ 两组各自需要的表数之和"的**不变量连同那三个常量一起作废**——
//     表数上限、档位上限、维度上限**都不存在了**（`SCALE_TABLE_TOP_PACK` / `TIER_TOP` / `DIM_TOP`
//     三个名字已从本模块删除）。留档照旧有用：它记的是"为什么当年会踩到维度 0/8"——
//     那个病的根因是**在一个循环里既排顺序又分名额**，现在没有名额可分了，病根随之消失。
//     ★下面这段是旧账（leg62/leg135 的口径），**别再照它把三个数加回来**。
//   ★leg62：概念表按"一把尺"分组进包——只是把同样的档位**换了排法与一行的表名**。
//   ★表数上限**必须 ≥ (TIER_TOP 与 DIM_TOP 各自需要的表数之和)**，否则会**从结构上**把预算卡死：
//     旧账推导时"回指不到档位名的维度各自成表"（大荒 65 维里 54 条这种），
//     退化到极端就是"一档一表 / 一维一表" ⇒ 表数封顶即预算封顶。
//     实测（夹具：90 个互不相同档位名 + 40 个互不相同维度名）：上限 6 → 维度 0/8；
//     上限 8 → 档位 7/24、维度 1/8（都填不满）。定 16 ⇒ 档位 24/24、维度 8/8 两条都能压到上限。
//   体积上界：表名 ≤ 16×20=320 字符，其余与旧口径同尺 ⇒ 最坏 ≈ (8+24)×(30+8)+320 ≈ 1,536 字符（原 1,216，+26%）。
//   ★★leg163：**这条不变量连同那三个常量一起作废**（表数/档位/维度上限都不存在了）——
//     留档照旧有用：它记的是"为什么当年抬档位上限会饿死维度预算"（同一个循环里既排顺序又分名额）。
export const SCALE_NAME_MAX_PACK = 20;
// ★★★leg69（A1）：**块级截断的留痕** —— 病：本函数与 `buildRuleAnchor` 都在"自己的预算"里
//   **静默 `break`**（当年：档 ≤`TIER_TOP` / 维 ≤`DIM_TOP` / 表 ≤`SCALE_TABLE_TOP_PACK` / 判据 ≤`RULE_PACK_TOP`），
//   ★★★leg163：**刻度那一半的截断整批删掉了**（用户令「删掉那三道，让预算当唯一的闸」）⇒
//     本函数**不再截断任何东西**，`刻度裁掉` 那一格随之永不出现。`法则` 那半边（`RULE_PACK_*`）照旧。
//     留档照旧有用：它记的是"静默截断"这个病本身（本仓"包里有读数"那条纪律的来路）。
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
        // ★★★leg163：这里原有一道**逐表档位上限**（`if (used >= TIER_TOP) break;`）——**删掉**。
        //   它与末尾那三道上限同批撤走（用户令「删掉那三道，让预算当唯一的闸」）：
        //   留一道逐表截断，等于"全塞"在单张大表上仍然不成立（350 档的表会被砍成 300 档）。
        for (const x of (Array.isArray(t.档位) ? t.档位 : [])) {
            const level = cut(x?.档);
            if (!level) continue;
            const item = { 档: level };
            const note = cut(x?.注);
            if (note && note !== level) item.标定 = note;
            rows.push(item);
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
        // ★★★leg163：这里原有 `slice(0, DIM_TOP)` / `slice(0, TIER_TOP)` 两道截断——**删掉**
        //   （与那三道上限同批撤走：平铺路是老账的退路，它同样该"书里有几条给几条"）。
        const flatDims = allDims;
        const flatTiers = allTiers;
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
    // ★★★leg163：这里原有"全局上限兜底"（维度 ≤ DIM_TOP · 档位 ≤ TIER_TOP，跨表累计）——**删掉**。
    //   下面那三条排序纪律是**旧账留档**（它们治的是"在一个循环里既排顺序又分名额"那个病）：
    //   现在**没有名额可分了**，三条纪律随之作废——但别删这段留档，它记着当年踩过的坑。
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
    // ★★★leg163（用户令「删掉那三道，让预算当唯一的闸」＋ leg135 那条「**全塞**」）：
    //   **三道上限整批删除**（`SCALE_TABLE_TOP_PACK` / `TIER_TOP` / `DIM_TOP`）——
    //   口径从"按写死的上界截断"改成"**书里有几张尺就给几张**"。
    //   为什么删（本笔真账实测，逐条算过）：
    //     · 刻度块实际只占预算 **6.94%**（10,417 字符 ≈ 3,472 token / 50,000），
    //       三道上限**全部吃满**时的最坏体积也只 **8.9%**；而真账整包只用 **54.4%**、
    //       `trimmed` 是 `null`（预算根本没满）⇒ **这三道从来不是在保护预算**。
    //     · 而它们在**真账上已经开始咬**：`real-world-dh` 是 45 张表 / **293 档**，离 `TIER_TOP=300`
    //       只差 7 档 ⇒ 再加两张小表，排在后面的表就**整张进不去**，而预算还剩 45%。
    //     · 用户令「不要搞那么多闸了」早在 leg136 下过一次，而那一笔**只改了面板上的一行字**
    //       （见 `render-base.js:432` 的留档），**闸原地没动** ⇒ 本笔把那条令真正落地。
    //   ★预算这一侧**本来就是诚实的**：这三道删掉之后，唯一的闸是整包那一道 `trimPack`——
    //     它有固定剪枝序、真裁了就写 `pack.trimmed`；压不进时还有 `budgetOverrun` 痕迹。
    //     （★`刻度` 那块**根本不在 `trimPack` 的剪枝序里**——它与 `法则` 同性质，是"锚"，
    //      本来就受保护；所以这里放开上限不会让刻度先被裁掉。）
    //   ★`fit` 照旧算（面板要如实报"几进包/共几"）：**没有截断之后 `进包 === 共`**
    //     ⇒ 块级那一格 `刻度裁掉` 自然永不出现（"只在真丢了东西时挂键"那条纪律自动成立）。
    const capped = [];
    for (const t of scales) {
        const row = { 表: t.表 };
        if (t.档位?.length) row.档位 = t.档位;
        if (t.维度?.length) row.维度 = t.维度;
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

// ★★★leg163：这里原有 **刻度目录**（`SCALE_CATALOG_TOP` / `buildScaleCatalog`）——**撤走**。
//   它当初的用途只有一个：把"书里有、包里没有"的表名递给模型，好让模型**点名**去要（leg64 第三轮）。
//   而点名那个口（`lookupScales`）与它同批撤走 ⇒ 留一份"叫你去点名、却点不了"的目录，
//   正是本仓最忌的"提示词替机制承诺一个它做不到的事"（目录这一族当初就是为治那个病而生的）。
//   ★真账实测：leg135「全塞」之后**目录本来就是空的**（大荒 1/1 张全进；`real-world-dh` 45/45 全进）
//     ⇒ 它进包时压根不挂键（`...(scaleCatalog ? {...} : {})`），撤走对真账**零字节影响**。

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

// ★★★leg163：这里原有 **按需查表** 那一整族（`SCALE_ONDEMAND_TOP` / `SCALE_ONDEMAND_CHAR_TOP` /
//   `cutScaleName` / `buildScaleTableIndex` / `sanitizeScaleRequests` / `buildScaleOnDemand`）——
//   **整族撤走**（用户令：「既然是全塞了就不需要点名表了所以删了这个功能即可」）。
//   为什么成立（真账实测，不是推理）：leg135 那条「全塞」令把进包上限抬到 表 ≤`SCALE_TABLE_TOP_PACK`
//   / 档 ≤`TIER_TOP` 之后，**真书里的尺已经整本进包**——大荒真账 1/1 张全进；
//   `real-world-dh`（新账形状）45 张表 / 293 档 ⇒ **45/45 全进、`刻度目录` 为空**。
//   ⇒ 目录（"我手里没有、但书里有"那份差距清单）是空的 ⇒ 点名这条通道**无表可点**。
//   ★★撤走时**两样一起撤**（目录与点名是一件事的两半）：只留目录 = 目录叫模型去点名、而点名那个口
//     已经没了 ⇒ 正是本仓最忌的"提示词替机制承诺一个它做不到的事"（这一族当初就是为治那个病而生的）。
//   ★留下的边界（如实登记）：**档位预算（`TIER_TOP`）用尽时，排在后面的表整张进不去**
//     （`scaleAnchorCore` 顺次扣预算）⇒ 此后模型只剩面板的 `刻度裁掉` 读数、没有要回来的路。
//     真账上没发生过（上面两本都是 0 丢失）；会发生的是"表多且平均档数 ≳7"的大书。
//   ★`cutScaleName` 也一并撤了——它此前只有目录、索引、补料三处用，三处同去。

/**
 * ★★★leg137：**递给模型的"时间尺子"**——上一件事发生在什么时候 ＋ 此后又过了多久。
 *
 * 【为什么必须有它】用户 2026-09-27 当场指出的真冲突（账上逐字可证）：模型写了
 *   `【此刻】复苏历19025年 十月初` ＋ `【时长】三月后`，而**读的人分不出"三月后"的基准是谁**——
 *   是"从上一轮（八月十五）往后三个月"，还是"从此刻（十月初）再往后三个月"（那就是明年了）。
 *   根因：**模型手上没有"上一轮是什么时候"** ⇒ 那个基准在它那一侧根本表达不出来。
 *   ⇒ 把它递过去，模型才有资格给每件事**各自**写时间（用户令：「事件的时间字段就由 llm 自己写」）。
 *
 * 【两格分开摆，不许合成一句】`此刻` 是**时间点**、`此后又过了` 是**相对量**——
 *   合成"十月初；三月后"就又把那个歧义原样带回来了（这正是本栏要治的东西）。
 *
 * 【只摆原话，不做算术】红线 §2.2 第 1 条：不许把书里的词换算成数（时间也归这条管）。
 *   引擎**不累加、不推算**——「三月后」照抄成「三月后」，绝不算成"三个月"。
 *
 * 【找不到就不挂】两样都没有（旧账 / 这一局没有时间轴）⇒ 返回 `null` ⇒ 这一栏不出现
 *   （红线 2：空着就是空着，**绝不填占位值冒充**）。
 *
 * @param {object} ssot 世界账
 * @param {object} opts `{ turnFacts, volumes }`——`turnFacts.elapsed` 是本轮的【时长】
 * @returns {{此刻?:string, 此后又过了?:string}|null}
 */
function timeBaseOf(ssot, { turnFacts = null, volumes = null } = {}) {
    const out = {};
    // ① **上一件事发生在什么时候**：从账上（含卷）往回找最近的一个已知时间点。
    //    ★为什么要"含卷"：轮转之后最旧的编年进了冷档，不接卷就会在轮转之后**悄悄读不到**
    //      （本仓 leg119 为这个形状付过账：那一栏实测从 237 条掉到 118 条而**不报错**）。
    const rows = chronicleOf(ssot, volumes);
    for (let i = rows.length - 1; i >= 0; i -= 1) {
        const t = String(rows[i]?.timeMark ?? '').trim();
        if (t) { out.此刻 = t; break; }
    }
    // ② **此后又过了多久**：本轮的【时长】（`turnFacts.elapsed`，leg115 那条老通路）。
    const span = String(turnFacts?.elapsed ?? '').trim();
    if (span) out.此后又过了 = span;
    return (out.此刻 || out.此后又过了) ? out : null;
}

/**
 * ★★★leg137：**给往事行带上账上的时间点**（`纪事` 与 `相关往事` 共用这一处——两栏读同一份账，
 *   口径必须一模一样；分开写两遍就是"同一件事两份实现"，本仓为那个形状付过账）。
 *
 * 【它治的是什么】`timeMark` 在这之前是**只写不读**的——账上记了时间点，包里一个字都没有，
 *   ⇒ 世界模型只看得见**轮次号**，看不见"故事走到什么时候了"。
 *
 * 【为什么是"增量"写法（只在变化处带）】本笔在真账上量过（258 行往事，`tmp/leg137-live/measure-time-cost.mjs`）：
 *   · 每行都带：稳态 **+3,029 token**；· 只在变化处带：稳态 **+12 token**。差 250 倍。
 *   原因很实在：**同一轮里十几件事共用同一个时间点**，相邻行绝大多数时间相同。
 *   ★它同时是**聊天侧已经在用的形状**（`ledger-recall.js` 的 `formatRecalled` 是"一组一个表头"）。
 *
 * ★**缺格读作"与上一行同一时间"**（不是"账上没记"）：行按**时间线顺序**排（最早 → 现在），
 *   而故事时间只往后走。★第一行若带格，它就是这一栏起点的时间；通道上线之前的老行没有格。
 *
 * @param {Array<{tick:number,text:string}>} rows 已按"从最早到现在"排好的行（就地改，不换数组）
 * @returns {Array} 同一个数组（方便链式返回）
 */
function stampRowsWithTimeMark(rows, keep = null) {
    let prevMark = null;
    for (const r of rows) {
        // ★**幂等**：这一行**自己的**时间点读自 `timeMark`；若上一次盖之前存过底（`keep`），以底为准。
        //   ★为什么要 `keep`（本笔踩了四次才理清，逐条留档）：
        //     · `相关往事` 那一栏要**盖两次**——先盖一次好按"真实体量"算额度，退掉头几行之后**再盖一次**
        //       （新首行要补回它自己的时间点）。而第一遍盖完，行上只剩"增量后"的样子
        //       （大多数行**没有** `timeMark`）⇒ 第二遍无从还原 ⇒ **第一版把时间全抹掉了**。
        //     · 所以第一遍之前先把"每行自己的时间点"存进 `keep`（一个与 `rows` 等长的数组）。
        //   ⚠踩过的另外三处（同一个坑的不同面，别重踩）：
        //     ① 先 `delete r.timeMark` 再读 ⇒ 第二遍读到空；
        //     ② `prevMark` 被"没有时间点的行"重置成 null ⇒ 它后面同时间的行会被误当成"时间变了"；
        //     ③ **出包绝不许改账**：`fetchChroniclePast` 曾经把账上那一行**原对象**塞进包，
        //        于是就地盖格就**改到了账本本身**（同一份账两次建包结果不同）⇒ 已改成新造对象。
        const own = String((keep ? keep.get(r) : r?.timeMark) ?? '').trim();
        if (own && own !== prevMark) r.timeMark = own;
        else delete r.timeMark;      // 与上一行同一个时间 ⇒ 不带格（增量写法）
        if (own) prevMark = own;
    }
    return rows;
}

/**
 * ★★★leg118（B2 接检索层）：**取那一栏往事——向检索层要，不自己伸手抓。**
 *
 * 【这一笔变的是什么、没变什么】——★**没变的是内容**：真账实测（细案 §9.4）接线前后**逐行逐字符相同**
 *   （258 条对 258 条）。变的只是**从哪儿取**：世上从此**只有一条取往事的路**（消费者多了，路只有一条）。
 *
 * 【三步，一步都不能少】
 *   ① **取数**：`recallLedger` 的"最近优先"（账只往后加 ⇒ 尾巴就是最近的）。
 *      ★`limit: null` 与 `maxChars: null` 都是"**不设上限**"——那一栏唯一的尺是**包的总预算**
 *        （`trimPack` 末尾那道额度守卫），这一点是 `leg113` §3.4 拍过的口径，不许在这里另加一把尺。
 *        ★`maxChars` 的"不限"是 leg118 才补上的（见 `ledger-recall.js` 那一处注释：原来传 `Infinity`
 *          会掉回出厂 6000 ⇒ 那一栏会被**静默截掉**一百多条）。
 *   ② **取舍**：本文件筛掉机械记账行——用的是**全仓唯一那张"这行编年是什么话"的表**
 *      （`isChronicleBriefLine`）。★检索层**全收**（连认不出的都收），"收不收"归消费者：
 *      共用的是**分类**，不是取舍（`leg117` 定稿）。
 *   ③ **投影 + 正序**：只留两格 `{tick, text}`（那一栏的行形状**被判据锁着**：多一格就是新造字段），
 *      并按轮次回到"**从最早到现在**"——那是时间线，也是 `prompts.js` 第 9 条指路的原话。
 *      ★检索层给回的是"新的在前"（`leg116` 统一的排序，管的是"谁占得到额度"）；
 *        栏内顺序管的是"模型读到的顺序"——**两件事，别混**（细案 §4.5）。
 *
 * 【失败零阻塞】取不到 ⇒ 返回空数组 ⇒ 那一栏的键**根本不出现**（"空着就是空着"）。
 * @param {object} ssot 世界账
 * @returns {Array<{tick:number,text:string}>} 按轮次升序
 */
function fetchChroniclePast(ssot, volumes = null) {
    const got = recallLedger(ssot, {
        modes: [RECALL_MODES.RECENT],
        limit: null,        // 不设条数上限（与 `maxChars: null` 同一口径）
        maxChars: null,     // 不设字符上限：唯一的尺是包的总预算（见上③）
        // ★★★leg119：**卷要一起看**（编年进了冷档的那一段）。
        //   为什么非接不可（真账实测）：轮转把最旧的编年整段搬进卷之后，那些行就不在 `ssot.chronicle`
        //   里了 ⇒ 不接卷的话这一栏会**悄悄少一半**（强制轮转实测 **237 条 → 118 条**），
        //   而 `trimPack` 那一刻量到的是"缩水后的编年"，它**全装得下** ⇒ 包里 `trimmed` 依然是
        //   `undefined`、**一个字都不会说**。★"上游先悄悄剪短了，于是下游的诚实检查报告说一切正常"。
        volumes,
    });
    if (!got.ok) return [];
    const rows = [];
    for (const it of got.items) {
        if (!isChronicleBriefLine(it)) continue;
        const text = briefLineText(it?.text);
        if (!text) continue;                       // 洗空了就不挂这一行（不占位、不补字）
        // ★★★leg137：★**必须新造对象，不许把账上那一行原样塞进来**（本笔踩过、留档）：
        //   下面 `stampRowsWithTimeMark` 会**就地删/写** `timeMark`。若这里塞的是账上的**同一个对象**，
        //   那一写就**改到了账本本身**（第二次建包时账上那格已经没了 ⇒ 时间**时有时无**，
        //   而且是"同一份账、两次建包结果不同"那种最难查的形状）。
        //   ⇒ 出包**永远只读账**：这里只把要用的三格抄出来。
        //   ★`timeMark` **原样带着**（不叫 `_mark`）：它要**活到切完窗口**才盖增量——
        //     窗口缺省只有最近 50 轮，而带格的那一行可能落在窗口外（实测：整栏 50 行一行时间都没有）。
        rows.push({
            tick: Number.isFinite(it?.tick) ? it.tick : 0,
            text,
            ...(String(it?.timeMark ?? '').trim() ? { timeMark: String(it.timeMark).trim() } : {}),
        });
    }
    rows.reverse();                                // ★栏内回到"从最早到现在"（见上③）
    // ★注意：**这一层不盖增量**（盖了就会把"每行自己的时间点"消费掉，切窗口之后就无从还原）。
    //   全量这一份 `__chronicle` 只喂额度守卫；真正给模型看的两栏各自在"定下来之后"盖（见下）。
    return rows;
}

// ══════════════════════════════════════════════════════════════════════════════
// ★★★leg132：**相关往事**——引擎替模型翻旧账（本轮到位，不问模型）
// ══════════════════════════════════════════════════════════════════════════════
//
// 【这一栏治的是什么病】
//   `纪事`（往事）那一栏是**没有选择**的：它只认"最新"，装不下就从**最旧的**开始丢。
//   于是长跑里必然发生这件事：**一件四十轮前结下的仇、一件还没收口的旧事，从模型眼前永久消失**——
//   而它这一轮恰好要用。实测（真模型 60 轮 / 30 轮两趟）：包一旦被裁，够不着的事件从 0% 涨到 4.2%
//   （预算 12000）→ 17.1%（5000）→ **35%（3000）**；而"真被裁过"的那一跑终态，
//   **123 件事里 61 件（49.6%）模型再也够不着**。
//
// 【为什么必须由**引擎**发起，而不是"模型点名、下一轮给"】
//   模型一开口，这一轮的输出就已经在生成中——它没法在说话之前先问一句。
//   所以"本轮到位"这条要求，**在结构上就排除了任何模型发起的取回**（那条现成的
//   `lookupLines` 通道因此不合格：实测三趟真跑共 150 轮，模型一次都没用过，而且就算用了也迟一轮）。
//   ⇒ 取回的发起权归引擎，取回的**依据**是"这一轮正在动的东西"——那是账上的事实，引擎知道得比模型准。
//
// 【相关性拿什么算：**只用账上真有的字**，零编造】
//   ① `buildQuery(ssot, {picks})`——本轮上场实体的**真名** ＋ 未决事件的**标题**（既有那把尺，不另立）；
//   ② 在飞盘算的**目标原话**（`agendas[].goal`，未了结的那几条）。
//   这两样拼成一段话，交给检索层的 `按真名取` ＋ `按词` 两种取法。
//   ★不引向量、不引外部依赖（本仓零依赖）；★命中理由**人看得出来**（"因为这行里出现了 e3 的名字"），
//     这正是本仓要的"可核对"，而不是一个说不清为什么的黑箱。
//
// 【三条口径（一条都不许松）】
//   ① **只取原文**：`briefLineText` 只去固定前后缀，**不改写事实**——检索层给的是编年原文，不是谁的重述；
//   ② **不重复"最近的事"**：窗口内（`tick >= windowFromTick(...)`）的往事归 `纪事`，这里不重复占额度；
//      （`trimPack` 那一侧还会按**行身份**再排一次重，见那里的注释）
//   ③ **有空才挂键**：一条都没取到 ⇒ 键不出现（空着就是空着），旧世界**逐字节回到今天**。

/** ★这一栏的尺度。**是"尺"不是"闸"**——只决定给模型看多少，一个东西都不拦。
 *  ★本笔删掉原先并排的 `RELATED_MIN_AGE = 12`（leg132 的"最小年龄"兜底）：它**已被窗口判据整段吃掉**——
 *    下面 `fetchRelatedPast` 里 `t >= floor`（`floor = windowFromTick(tickNow, 往事轮数)`）比它严得多
 *    （往事轮数 50 ⇒ 这一栏最旧可到 50 轮前；30 ⇒ 30 轮前），只有把「往事轮数」填到 ≤11 才会轮到它咬人，
 *    而出厂档位是 30/50 ⇒ 留着它就是**同一条口径的第二把尺子**（永远不生效的那种）。 */
export const RELATED_BUDGET_SHARE = 0.15;

/**
 * ★★★leg133：**往事窗口的下界**——第几轮之前的往事算"窗口外"。
 *
 * 【这条线是干什么的（用户 2026-09-25 拍板：「我认为50轮」）】
 *   账从这一轮起被切成两半：
 *     · **窗口内**（`tick >= 本函数返回值`）⇒ `纪事` 那一栏**每轮必给原文**，且**裁剪时优先保留**
 *       （见 `trimPack` 那一段）——"最近"第一次有了硬保证，不再"碰巧挤得下多少算多少"；
 *     · **窗口外**（`tick < 本函数返回值`）⇒ 由 `相关往事` 按相关度补（本函数下面那一栏）。
 *   ⇒ 两边**各有各的活**：窗口内是"接得上"，窗口外是"想得起"。
 *
 * ★`turns` 由 `lim.往事轮数` 递进来（账上设的优先、否则出厂 50）；非有限/非正 ⇒ 回出厂值。
 * ★返回的是**轮次下界**（含），不是条数：`tickNow - turns + 1`（50 轮 ⇒ 含本轮往前数 50 轮）。
 */
export function windowFromTick(tickNow, turns) {
    const t = Number(tickNow);
    const n = Number(turns);
    const now = Number.isFinite(t) ? t : 0;
    const span = Number.isFinite(n) && n > 0 ? Math.floor(n) : RECENT_WINDOW_TURNS;
    return now - span + 1;
}

/**
 * ★leg153：**一行往事的身份**（`轮次 ＋ 那句话`）——治"同一个事实在两栏里各出现一次"。
 *
 * 为什么是这两样、而不是 id：`纪事`／`相关往事` 那两栏的行形状是 `{tick,text}`（判据 J16 锁着），
 *   **不带 id** ⇒ 跨栏去重只能按"轮次 ＋ 正文"比。★必须**先洗成给模型看的那一句**再比
 *   （索引里存的是编年原文，两栏递出去的是 `briefLineText` 洗过的那一句——不洗就永远比不上）。
 * ★它与 `trimPack` 里那次去重分工不同：那一处比的是**同一批行对象**（栏内搬迁），这里比的是**事实**。
 */
function lineKeyOf(tick, text) {
    const t = tick == null || tick === '' ? '' : String(Number(tick));
    return `${t}|${briefLineText(text)}`;
}

/** "这一轮正在动的东西"——拼成一句给检索层的查询（**只用账上真有的字**）。 */
function relatedQueryText(ssot, picks) {
    const parts = [buildQuery(ssot, { picks })];
    for (const a of (ssot?.agendas || [])) {
        if (a?.closed) continue;                       // 只问"还在办的事"，了结的不再是"正在动"
        const g = String(a?.goal || '').trim();
        if (g) parts.push(g);
    }
    return parts.filter(Boolean).join(' ');
}

/**
 * 取"关于这一轮正在动的东西"的往事。**永不抛**（照检索层那条失败零阻塞）：取不到就返回空数组。
 *
 * ★★★leg133 两条新口径（都在这一层落实，别处不许再各写一份）：
 *
 * **① 只取窗口外**（`tick < windowFromTick(...)`）。
 *   窗口内的往事已经由 `纪事` 每轮必给了 ⇒ 这里再取就是**重复占额度**。
 *   leg132 实测的第三处缺陷正是栽在这：第一版照"新的在前"从头取，取回来的全在 `纪事` 覆盖范围内
 *   ⇒ **一行都没救回来**（预算 12000 时救回 0/89）。
 *
 * **② ★相关度保证**（用户令：「索引一定要保证相关度」）。
 *   检索层是按**关键词**命中取数的，而"命中一个词"不等于"这件事和当下有关"
 *   ⇒ 必须再筛一道，而且尺子要**用检索层自己那份钥匙**（`matchedKeys`），不许在这里另算一份。
 *   ★实测（真账 60 轮世界 · 严尺：提到在场最靠前 5 人的真名）：
 *     相关度只有 **94%（预算 30000）/ 92%（12000）/ 87%（6000）**——越紧越不相关，
 *     而不相关的那几行**照样占额度**。
 *   ⇒ 口径：**一行必须点到 `matchedKeys` 里的至少一把钥匙，否则不进包。**
 *     代价是取回的**条数会变少**（相关度换召回率，这是用户点的那个取舍，如实登记、不藏）。
 *
 * @returns {Array<{tick:number,text:string}>} 按轮次升序（与 `纪事` 同一个读法）
 */
function fetchRelatedPast(ssot, { picks = null, volumes = null, budgetTokens = 0, tickNow = 0, windowTurns = RECENT_WINDOW_TURNS } = {}) {
    const text = relatedQueryText(ssot, picks);
    if (!text) return [];
    // ★这一栏的字符上限**从包预算推出来**，不是一个独立的魔数——预算抬了它跟着抬，不用两处改。
    const charCap = Math.floor(Number(budgetTokens || 0) * TOKEN_RATIO * RELATED_BUDGET_SHARE);
    if (!(charCap > 0)) return [];
    const floor = windowFromTick(tickNow, windowTurns);   // ★窗口下界：这一轮之前的都算"窗口外"
    const got = recallLedger(ssot, {
        modes: [RECALL_MODES.BY_NAMES, RECALL_MODES.BY_KEYWORD],
        text, limit: null,
        // ★★★`maxChars` 必须传 `null`（**不设上限**），上限在下面**筛完之后**自己收——
        //   这是本笔实测抓出来的一个真缺陷，留档免得下一任重踩：
        //   检索层的字符预算是**排在"轮次新的在前"那个排序之后**的（它那一侧的口径："谁先来谁占额度"），
        //   而这一栏恰恰要的是**旧的**（最近的归 `纪事`，见 `windowFromTick`）
        //   ⇒ 额度会被"马上要扔掉的那些新行"吃干，筛完之后**一条都不剩**。
        //   实测（真账 60 轮世界 · 预算 6000）：625 行往事里有 **594 行提到在册真名**，
        //   而这一栏取回 **0 行**——读数上看着像"没有相关的旧事"，其实是**额度顺序错了**。
        maxChars: null,
        volumes,
    });
    if (!got.ok) return [];
    // ★相关度那把尺：用检索层交出来的同一份钥匙（取数与校验同源，见 `matchedKeysOf` 头注）。
    const keys = Array.isArray(got.matchedKeys) ? got.matchedKeys : matchedKeysOf(ssot, text);
    if (!keys.length) return [];                       // 一个账上真名都没点出来 ⇒ 没有"相关"可言
    const eligible = [];
    for (const it of got.items) {                      // 检索层给的是"新的在前"
        if (!isChronicleBriefLine(it)) continue;       // 与 `纪事` 共用同一张"这行是什么话"的表（一处定义）
        const t = Number(it?.tick);
        if (!Number.isFinite(t)) continue;             // ★窗口口径要按轮次判 ⇒ 读不出轮次的行不进这一栏
        if (t >= floor) continue;                      // ★口径①：窗口内的归 `纪事`，这里不重复占额度
        const s = briefLineText(it?.text);
        if (!s) continue;
        if (!keys.some((k) => s.includes(k))) continue; // ★口径②：**相关度保证**（点不到钥匙 ⇒ 不进包）
        eligible.push({
            tick: t,
            text: s,
            ...(String(it?.timeMark ?? '').trim() ? { timeMark: String(it.timeMark).trim() } : {}),
        });
    }
    // ★★★**从最旧的那一端取**（本笔实测抓出来的第二处，留档）：
    //   第一版照"新的在前"从头取 ⇒ 取回来的全是**最近**的那几行，而"最新优先"那道守卫
    //   **本来就会保住它们** ⇒ 这一栏等于把 `纪事` 的内容搬了个家，**一行都没救回来**。
    //   实测（真账 60 轮世界）：预算 12000 时救回 **0/89**（取回的轮次全在 `纪事` 覆盖的范围内）；
    //   改成从旧端取之后，预算 6000 时 **45/45 都比 `纪事` 里最旧的更旧**——那才是"失忆"真正发生的地方。
    //   ★道理一句话：**这一栏的职责是"补 `纪事` 补不到的那一段"，不是"再挑一遍最新的"。**
    // ★★★leg137：这一栏也要带时间点（两栏读同一份账 ⇒ 口径必须一致）。
    //   ★**先盖时间、再算额度**：`timeMark` 是真实包体量的一部分，漏算它额度就会悄悄多装几行。
    //   ★额度仍然**只在筛完之后**生效（见上），且方向照旧：从**旧端**开始装，装不下就停在旧端那一侧。
    //   ★**盖之前先把"每行自己的时间点"存底**（`ownMarks`）——因为下面退掉头几行之后要**再盖一次**，
    //     而第一遍盖完行上只剩"增量后"的样子（多数行没有 `timeMark`）⇒ 不存底就还原不回来。
    const ownMarks = new Map(eligible.map((r) => [r, String(r?.timeMark ?? '').trim()]));
    stampRowsWithTimeMark(eligible, ownMarks);
    const rows = [];
    let chars = 0;
    for (let i = eligible.length - 1; i >= 0; i -= 1) {          // 旧 → 新
        const n = JSON.stringify(eligible[i]).length;
        if (chars + n > charCap) break;
        chars += n;
        rows.push(eligible[i]);
    }
    // ★退完之后**再盖一次**（口径与理由见 `stampRowsWithTimeMark` 头注）：
    //   被退掉的头几行若带着时间点，新首行就得补上它
    //   （否则"缺格 = 与上一行同一时间"这条读法会指向一个**已经不在这一栏里**的行）。
    stampRowsWithTimeMark(rows, ownMarks);
    return rows;                                       // 已经是"从最早到现在"（与 `纪事` 同一个读法）
}

/**
 * ★★★leg151：从**已出的包**里读出"这一轮真摆出去的线的根 id"（给编排层记账用；**纯读、零副作用**）。
 * 为什么要有它：出包那一层**不许写账**，而"记性"必须由调用方按**真摆出去的那批**去写
 *   ⇒ 读的口就是这里（一处定义）。行文形状是 `根id：…`（`buildLineDetails` 定的）⇒ 只切第一个全角冒号。
 * ★键不出现 ⇒ 空数组（空着就是空着）。
 */
export function lineRootsOfPack(pack) {
    const rows = Array.isArray(pack?.['线的经过']) ? pack['线的经过'] : [];
    const out = [];
    for (const row of rows) {
        const id = String(row).split('：')[0].trim();
        if (id && !out.includes(id)) out.push(id);
    }
    return out;
}

/**
 * ★★★leg151：**把"这一轮真摆出去的线"记进账**（一轮之内幂等；只增不删）。
 * 为什么由编排层做、不做出包里：出包在**一轮里会跑两次**（主调用那次 ＋ 结算那次），
 *   而"递过"这件事必须是**整轮合起来**的口径；出包那一层若自己写账，第一次写完之后
 *   第二次就会读到它、把剩下没递过的线又当成"这一轮该递的"（本笔第一版的血证：
 *   一轮下来账上写着"五条都递过了"，而真摆在模型眼前的只有后两条 ⇒ **下一轮一条都取不到**）。
 * ★返回 true ＝ 账真的变了（调用方据此决定要不要留痕/是否需要别的动作）。
 *
 * @param {object} ssot 世界账（就地写 `meta.linesShown`）
 * @param {string[]} roots 这一轮真摆出去的那批根 id
 */
export function recordShownLines(ssot, roots) {
    const list = (Array.isArray(roots) ? roots : []).map((x) => String(x)).filter(Boolean);
    if (!list.length) return false;                    // ★零扰动：什么都没递 ⇒ 一个字节都不碰
    const before = (Array.isArray(ssot?.meta?.linesShown) ? ssot.meta.linesShown : []).map((x) => String(x));
    const merged = [...before];
    for (const id of list) if (!merged.includes(id)) merged.push(id);
    if (merged.length === before.length) return false; // 全是旧记性 ⇒ 也不必写
    ssot.meta = { ...(ssot.meta || {}), linesShown: merged };
    return true;
}

// 已结算盘算不再喂给模型（防满步重播，活档实测发现）
// K2/P3：分量不再入包（ANCHOR §3③：模型看不到分量、不参与分量；门控在引擎侧兜底）
// leg25：出包末尾**强制整包预算**（超限按固定剪枝序裁，包内留 `trimmed` 痕迹；见 trimPack）
export function buildEvolutionPack(ssot, moveFact, { picks = null, lim = null, turnFacts = null, volumes = null, vecRecall = null } = {}) {
    // K44：镜头选择器——全量棋盘有序入镜（保送+分量序），预算内前缀；分量不随行泄漏（P3）
    // 细案 spec-entity-field-lookup §3（用户 2026-09-11 批准）：**选择权归 LLM 时**传 picks——
    //   名单改用"本轮上场选择器"选的实体（引擎只做校验，见 entity-lookup.js），不再按预算截前缀。
    //   为什么必须换：lensList 是**引擎**按 30k 预算截前缀，镜头外的人连"想让谁动"都表达不了；
    //   leg24 片3 前按分量算的静默线实测把 345/346 全判静默（引擎实际上禁止了所有人出手）。
    //   picks 缺省=null 时行为与旧版逐字节一致（旧路径零扰动；预算仍由 trimPack 整包兜住）。
    //   ★★★leg136：**镜头那一道"独立上限"撤了**（原 `LENS_DEFAULT_MAX_TOKENS=30000`）——
    //     现在缺省上限 = 账上的 `包预算`（`lensListWithFit` 现取），并且**真截了就留痕**
    //     （`entities.lens` 记进 `pack.trimmed`，见下面那一处）。两条理由写在常量那一段注释里。
    const lensFit = picks ? null : lensListWithFit(ssot, { moveFact });
    const lens = picks
        ? picks.map((id) => ({ e: (ssot.entities || []).find((x) => x.id === id) })).filter((x) => x.e)
        : lensFit.list;
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
    // ★★★leg163：**刻度目录**与**按需查表**（`刻度补`）两处**同批撤走**——见本文件上面那两段留档。
    //   用户令：「既然是全塞了就不需要点名表了所以删了这个功能即可」。
    //   ⇒ `setting` 里那两格（`刻度目录` / `刻度补`）从此不再出现；真账上它们本来就是空的（目录）
    //     或从没出现过（补料）⇒ 对真账**零字节影响**。
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
        // ★★★leg163：这里原有 `刻度` 那一支（块级预算切掉多少档/表/维）——**删掉**。
        //   三道上限整批撤走之后 `scaleAnchorCore` **不再截断刻度** ⇒ `进包 === 共` 恒成立
        //   ⇒ 那一支**永远不成立**（留着就是一段永远跑不到、还会印假"原因"的死代码）。
        //   ★刻度块现在的唯一闸是整包那一道 `trimPack`（真裁了写 `pack.trimmed`，见它那段注释）。
        // ★★★leg136：这一句原来**写死了** `条≤160` —— 而 `RULE_PACK_TOP` 已抬到 256（leg135）
        //   ⇒ 包里那句"原因"是**假话**。本笔照 leg135 给 `刻度` 那一句定的口径改成**从常量现读**
        //   （同一条纪律：读数量体不许写死数字，写死就是第二份真相）。
        ...(ruleFitRes.fit && Number(ruleFitRes.fit.判据?.共) > Number(ruleFitRes.fit.判据?.进包) ? { 法则: { ...ruleFitRes.fit, 原因: `块级预算（条≤${RULE_PACK_TOP}/单条≤${RULE_PACK_STR_MAX}字/总≤${RULE_PACK_CHAR_TOP}字）` } } : {}),
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
    // ★leg34（小说家条款 §7.3）那一格"已取回字段"的**勘正**（本笔照实改，别再按旧注释去找机制）：
    //   · 旧注释写着"模型主动问过的值**单独成一段**递过去（不是给实体表加列），原样 1 轮，
    //     由 `web/index.js` 的 `clearStaleFetched` 在下一轮消费后清掉"。
    //     ★**这段机制不存在**：`clearStaleFetched` 全仓只命中这条注释自己，包里也没有这一栏
    //     （所以这里没有代码可删——要改的只是这句话本身）。
    //   · 实际接线（**是活的**）：查书的面早已收窄成只剩 `实力`（`src/entity-lookup.js:37`），
    //     而 `applyLookup` 把值写回**实体自己**（`next[f] = v`，同文件 :467）⇒ 它随实体表的
    //     `实力` 列进包（见上面 `entityRow`），`location` 的来源也随行标注（`:1007` 的 `（推）`）
    //     ⇒ **不需要另起一段**，也不需要"1 轮生命周期"那套。
    // ★★★leg122：**`pack.recalled` 已拆**（用户令「所以才需要拆」）——这一格留档，别再请回来。
    //   它当年是"本回合检索到的世界书片段"（leg34 立、leg35/39 自验过）。**实测拆它的理由**
    //   （全文在 `src/tick.js` 的 `runTick` 前那一大段）：真账上召回的那 1783 字与世界书
    //   `大荒-姬元真.json`（30.5 万字）的 **6/8/10-gram 覆盖率 0.00%**，命中的全是
    //   **这份聊天自己的自动总结**（来源 `大荒z - 2026-09-01… #12/#9/#10`）——而那是**记忆插件的活**，
    //   台头却写着「**世界书**·…**逐字摘自世界书**」（`src/recall.js:127`）⇒ **那句话是假的**。
    //   ⇒ 取数那一步（`injectWorldBookRecall`）与本键**同批拔掉**：世界模型的包从此**不含"书的原文"**。
    //   ★下面 `纪事` / `turnFacts` 那两句注释里的"照 `recalled` 那条口径"= **"有才挂键"这条命名约定**：
    //     约定本身还在用（它们各自仍是"没料就不留键"），只是那个**举例**已经不在了。
    const pack = {
        world: ssot.context?.world,
        // 张力：有 setting 取演化层强度（引擎算），无则回退 context.tension 数字（细案 §3.1 兼容口径）
        tension: dyn ? dyn.tension?.intensity : ssot.context?.tension,
        // ★★leg60：大势块 = 张力三件 + 环境量（固定小结）**+ 刻度**（维度/范围/档位，见 buildScaleAnchor）。
        //   `scale` 为空（本书没有成文的维度/档位表）⇒ 键不出现，与本棒之前**逐字节相同**（既有判据与冒烟面零扰动）。
        //   ★leg62：`scale` 现在是**概念表列表**（一把尺一个元素，见 `buildScaleAnchor` 头注），
        //     故这里由调用点写 `刻度` 这个键（改前 `buildScaleAnchor` 自己返回 `{刻度:[…]}` ⇒ 这里会嵌成两层）。
        setting: (dyn || scale || ruleAnchor || scaleDropped) ? {
            ...(dyn ? { tension: dyn.tension, env: dyn.env ?? {} } : {}),
            ...(scale ? { 刻度: scale } : {}),
            // ★★★leg163：`刻度目录` 与 `刻度补` 两格**同批撤走**（leg64 那条"递目录 + 按需查"整族）——
            //   见本文件上面那两段留档。★位置纪律照旧：只做减法，**不动其余键的相对位置**
            //   （`lens.test.js` 那条包内键序锁：撤走的两格真账上本来就不出现 ⇒ 键集合一字不变）。
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
        //   `lim` 由调用方（`runTick`）用 `resolveLimits(world)` 递进来；出厂值本身的家在 `limits.js`
        //   （本文件只转发，见文件头那段）——`pack.js → limits.js` 是单向边，**没有回路**。
        threads: computeThreads(ssot, lim?.每轮递线 ?? THREADS_TOP),
        // ★★leg40 第三条料路：**拾遗**——已了结但**没人接**的旧事件（"接上它也算一步"，见 `computeClosedRoots` 注释）
        closedRoots: computeClosedRoots(ssot),
    };
    // ★★★leg122：`if (recalledText) pack.recalled = recalledText;` **已拆**（见上面那一大段留档）。
    //   为什么它与 `departed` 口径不同（那个恒为数组）：`departed` 受 `lens.test.js` 的键序锁约束
    //   （它的世界里有没有离场者都会走到同一分支）；检索那一段是"本回合真的检索到才存在" ⇒ 挂
    //   `undefined` 键没有意义。★本键拔掉后，包里的键集合**少了一格**（只在"检索命中"时才少——
    //   而生产上它一直命中）⇒ 逐字节基线会动，这是本笔**预期之内**的扰动（不是回归）。
    // ★★★leg113（B2 编年进包 · 用户 2026-09-22 拍板）：**往事**——把账上的编年过滤成"那时候发生了什么"递过去。
    //   病（真账 tick 60 实测）：包里**一行编年都没有** ⇒ 模型每轮失忆：账上 32 件已收场的事只递 **8** 件，
    //     全账 **19/54** 件事件的来路指向一件**任何一栏都没有**的事；而根因是归档把 20 轮前的**事件**
    //     压成里程碑搬走了（`settle.js` 的 `archiveClosedEvents`）——**编年行不归档** ⇒ 编年是唯一存本。
    //     ★同一份账实测：来路查不到的那 **29** 件事，**29 件全能在编年里找回（100%）**。
    //   口径：**只搬、不改写**（用户拍"窄口"）；收"来路/经过/收场得失"三类，弃 4 类机械记账（详见叶子文件头）。
    //   位置（★键序纪律）：**插在 `recalled` 之后、`turnFacts` 之前**——这样两把既有锁都不用动：
    //     · `lens.test.js` 的 16 键集合锁（本栏不在字面量里）；
    //     · `tag-extract.test.js` 的「`turnFacts` 必须最末」（本栏在它前面）。
    //   ★**不设条数/轮数上限**：上限只认包的总预算（`trimPack` 从最旧的整条丢）。
    //     理由：`entityUpdates 每轮 ≤3` 就是"没量过的提案态数字当家、还静默拦"，2026-09-22 用户拍板直接撤
    //     ⇒ 同一个坑不跳第二次。
    //   ★"有才挂键"（照 `recalled` 那条口径）：没编年（新局/老账）⇒ **键不出现**，逐字节回到今天。
    // ★★★leg118：**取数改走检索层**（`fetchChroniclePast`，头注在它那里）——内容一个字没变
    //   （真账实测逐行逐字符相同），变的是"从哪儿取"：**世上只剩一条取往事的路**。
    const briefAll = fetchChroniclePast(ssot, volumes);
    // ★★★leg133：**"最近的事"只装窗口内那一段**——窗口在这里就切，不许等到 `trimPack`。
    //   ★★这是本笔第一版栽的地方（真模型 60 轮当场抓出来，留档免得下一任重踩）：
    //     第一版只让 `trimPack` 的额度守卫"优先保窗口" ⇒ 那一栏**照样是全量**（实测末轮 684 行，
    //     而窗口只有 50 轮 ≈ 540 行）——因为 `trimPack` 的额度守卫**只在 `pack.纪事 === undefined`
    //     时才跑**（它管的是"整栏被固定序丢掉之后装回多少"），而这里已经把整栏挂上了
    //     ⇒ 那条分支**一次都没进**，"窗口优先"等于没写。
    //   ★口径：**窗口是这一栏的装载范围，不只是裁剪偏好**——所以切在这一步（唯一的装载点）。
    //   ★`briefAll` 仍然原样递给 `__chronicle`（额度守卫要"完整那一份"才能算余量）；
    //     但既然 `纪事` 已经挂上，那条守卫本来就不会跑。
    const windowFloor = windowFromTick(Number(ssot?.meta?.tick) || 0, lim?.往事轮数 ?? RECENT_WINDOW_TURNS);
    const brief = briefAll.filter((r) => Number(r?.tick) >= windowFloor);
    // ★★★leg137：**切完窗口，在这一栏自己身上盖增量**（本笔踩了四次才理清，留档免得下一任重踩）。
    //   病：`timeMark` 是**增量**写的（只在"与上一行不同"处带一格）⇒ 那一格**留在窗口外那一行上**。
    //   实测（真账形状的夹具）：全量里带格的是第 1 与第 61 轮，而窗口是第 71–120 轮
    //   ⇒ **整栏 50 行、一行时间都没有**（"时间明明记了，模型一个字看不到"）。
    //   ★口径：**一栏的第一行永远带它自己的时间点**（它没有"上一行"可继承）；栏内其余行照增量走。
    //   ★必须"在切完之后、在**这一栏的行对象**上"盖：`briefAll` 里那些行**各自带着自己的时间点**
    //     （`fetchChroniclePast` 不盖增量，见它那一处注释），所以这里盖得出来、也还原得回去。
    stampRowsWithTimeMark(brief);
    if (brief.length) pack.纪事 = brief;
    // ★★★leg132：**相关往事**——引擎在这一刻（模型还没开口）就替它把旧账翻出来。
    //   ★★键序纪律：本键**必须挂在 `turnFacts` 之前**（`chronicle-brief.test.js` 的 J7 与
    //     `tag-extract.test.js` 那条"`turnFacts` 必须最末"的锁一起管着）⇒ 就挂在这里，别往后挪。
    //   ★"有空才挂键"：没取到 ⇒ 键不出现。**今天这一份真账（预算宽裕、往事全装得下）就是空的那一支**——
    //     因为那时候 `纪事` 已经把所有往事都给了模型，没有"失忆"可治，这一栏本就不该占位置。
    const related = fetchRelatedPast(ssot, {
        // ★★★**必须递 `lens`，不许递 `picks`**（本笔第一版就栽在这，留档）：
        //   `picks` 只在"选择权交给模型"那条路上有值；生产多数轮次它是 `null`
        //   ⇒ 查询里**一个人名都没有**，只剩未决事件的标题；而未决事件全是**最近**的
        //   ⇒ 取回来的全是"已经在 `纪事` 里"的行，再被窗口判据（`t >= floor`）筛掉 ⇒ **这一栏永远空着**。
        //   实测（免费自证 40 轮 · 预算 1200）：`纪事` 被裁到 31/39，救回 **0** 行——"监视器不报警"那个形状。
        //   `lens` 是**引擎自己的"这一轮谁在场上"**（两条路都算得出来，保送/近期出手的排最前）
        //   ⇒ 拿它的真名当桥，"同一批人"的旧事才取得回来。★这才是"相关性"真正该挂的地方。
        picks: lens.map(({ e }) => e.id),
        volumes,
        budgetTokens: lim?.包预算 ?? EVOLUTION_BUDGET_TOKENS,
        tickNow: Number(ssot?.meta?.tick) || 0,
        // ★★★leg133：窗口由账上设的「往事轮数」定（缺省出厂 50）——窗口内的往事归 `纪事`，这里只补窗口外。
        windowTurns: lim?.往事轮数 ?? RECENT_WINDOW_TURNS,
    });
    if (related.length) pack.相关往事 = related;
    // ★★★leg153（用户 2026-09-30 拍"甲：整栏进包"）：**按意思找回的旧事**——
    //   引擎拿"这一轮正在动的人和事"去**向量索引**里翻旧账，够得着字面对不上的那一段。
    //   ★它与 `相关往事` **并联、不是替代**（实测：两法在这两份账上**命中数打平**，而**捞出来的行不同**）：
    //     `相关往事` 认的是"名字/关键词对得上"，这一栏认的是"**意思近**"⇒ 只写"车队"、一个字不提势力名的
    //     那种旧事，只有这一栏够得着。⇒ 两条路各留各的，谁也不许把谁替掉。
    //   ★★**一个事实只许出现在一栏**：已经在 `纪事`／`相关往事` 里递过的，这里按**行身份**排掉
    //     （行身份＝轮次 ＋ 洗过的那句正文——那两栏的行只带 `{tick,text}`，跟它们没有 id 可比）。
    //   ★"这行是什么话"与另两栏**共用一张表**（`isChronicleBriefLine`）：机械记账不进这一栏。
    //   ★"有才挂键"：一件都没取到 ⇒ **键不出现**（空着就是空着；没配通道的老世界逐字节回到今天）。
    //   ★位置纪律：只做加法、**挂在 `相关往事` 之后**——`turnFacts` 必须最末那条锁
    //     （`tag-extract.test.js`）与"新键只许缀尾"那条纪律都不动。
    //   ★**上限只有一个**：条数由召回那一侧封顶（`RECALL_TOP_DEFAULT`，实测支撑的那个数），
    //     整包超预算仍由 `trimPack` 兜底 ⇒ 这里**不另立一把尺**（本仓为"同一条口径的第二把尺"付过账）。
    if (Array.isArray(vecRecall?.items) && vecRecall.items.length) {
        const delivered = new Set();
        for (const r of [...(pack.纪事 || []), ...(pack.相关往事 || [])]) delivered.add(lineKeyOf(r?.tick, r?.text));
        const vecRows = [];
        for (const it of vecRecall.items) {
            if (!isChronicleBriefLine({ text: String(it?.text ?? '') })) continue;
            const key = lineKeyOf(it?.tick, it?.text);
            if (delivered.has(key)) continue;
            delivered.add(key);
            vecRows.push(String(it?.line ?? ''));
        }
        if (vecRows.length) pack['按意思找回的旧事'] = vecRows;
    }
    // ★★★leg137（用户令：「**只要告诉时间流逝的长度和起始，事件的时间字段就由 llm 自己写**
    //   要不然所有事件都是同一时刻发生的了**」）：**把尺子递给模型**——"上一件事发生在什么时候"
    //   ＋"此后又过了多久"。模型有了这两样，才有资格给 `newEvents[].at` **各自**写时间。
    //   ★为什么必须有这一栏（用户 2026-09-27 指出的真冲突）：正文写了 `【此刻】十月初` ＋
    //     `【时长】三月后`，而**读的人分不出"三月后"是从现在往后还是从上一轮往后**——
    //     要判它就得知道"上一轮的此刻"。⇒ 这条信息此前**只存在于正文里**，账上一个字都没有。
    //   ★两格**分开摆**（`此刻` 是时间点、`此后又过了` 是相对量）：合成一句就又把那个歧义带回来了。
    //   ★**只摆原话、不做算术**（红线 §2.2 第 1 条：不许把书里的词换算成数——时间也归这条管）。
    //   ★两样都没有 ⇒ 这一栏**根本不出现**（红线 2：空着就是空着，不许挂空壳占位）。
    const timeBase = timeBaseOf(ssot, { turnFacts, volumes });
    if (timeBase) pack.时间 = timeBase;
    // ★leg113：把这一栏的**全量**递给 `trimPack` 的额度守卫（它要按"最新优先"装回来，得知道完整那一份）。
    //   走 `__relight` 同一条路：**不可枚举** ⇒ 不进 `JSON.stringify`（`packTextOf` 看不见它）、
    //   不进 `Object.keys`（`lens.test.js` 那条键序锁看不见它）⇒ **零扰动**。
    //   为什么不另开一个形参：`trimPack(pack, budget)` 是既有签名（判据与冒烟都在按它调），加参数要动调用面。
    Object.defineProperty(pack, '__chronicle', {
        value: briefAll, enumerable: false, writable: false, configurable: false,
    });
    // ★★★leg133：把**窗口下界**也走同一条路递给 `trimPack`（理由与上面 `__chronicle` 逐字相同：
    //   不可枚举 ⇒ 不进 `JSON.stringify`（`packTextOf` 看不见它）、不进 `Object.keys`（键序锁看不见它）
    //   ⇒ **零扰动**；而且不必改 `trimPack(pack, budget)` 那个公开签名）。
    //   ★`trimPack` 拿不到 `ssot`（它只收 `pack` 与预算）⇒ 窗口这条线只能从出包侧算好递进来。
    //   ★它仍然有用：`纪事` 若在固定剪枝序里被整栏丢掉，那条额度守卫会把窗口内那一段装回来。
    Object.defineProperty(pack, '__windowFloor', {
        value: windowFloor,
        enumerable: false, writable: false, configurable: false,
    });
    // ★★★leg89：**本轮正文里"已经发生过的事"**（标签提取，设计见 `docs/spec-tagged-actions-extraction.md`）。
    //   为什么它必须是新键、且**只做加法缀在最末**：本文件的键序被 `lens.test.js` 逐字钉住
    //   （`pack.js:924/934` 都写着这条纪律）⇒ 中间插键会咬。缀尾 + **没抽到就不留键**
    //   （照 `recalled` 那条口径）⇒ 没标签的老聊天**逐字节回到今天**。
    //   ★它进的是**主调用的输入**，不是世界步：世界步仍由模型提议、引擎结算门控（红线不破）。
    //   ★`elapsed` 是**账外的料**——引擎一个字都不解析它（账按轮走，故事按时间走）。
    if (turnFacts) pack.turnFacts = turnFacts;
    // ★★★leg120（A3 关系网，细案 `docs/spec-relationship-network.md`）：**关系那一栏**。
    //   为什么它必须进包：① 第 16 条教了模型"要了结就引那个号"，**而号只能从输入里来**
    //   （契约层不许它自己编）⇒ 不递这一栏，模型**永远了结不了**任何一条边；
    //   ② 不递它就不知道上一轮自己结下过什么，会一轮一轮把同一条边重写一遍。
    //   ★三条口径（照 `recalled` / `turnFacts` 那两栏的成例）：
    //     ① **只做加法、缀在最末**——本文件的键序被 `lens.test.js` 逐字钉住，中间插键会咬；
    //     ② ★**没有关系就不留键**（空着就是空着）⇒ 老账与新世界**逐字节回到今天**（判据 R3）；
    //     ③ **只递账上真有的那几格**（id 是引擎发的，照抄），一个字的加工都不加——
    //        尤其**不排序、不算轻重**（红线 §2.2 第 1 条：关系的词不许换算成数，四维浮点就是这么被删的）。
    //   ★为什么只递**未了结**的边：包是"此刻的世界"，了结的边是往事——往事走检索层
    //     （`ledger-recall.js` 的 `recallLedger`），两条路各管一段，不在这里堆历史。
    //     ★leg134 勘正：原文这句写的是"检索层的**按人取**"，而**"按人取"这一种取法已作为死码删除**——
    //       生产路径从来没调用过它（全仓 `modes:[…]` 字面量只有三处，用的是"最近优先"与"按真名取＋按词取"）。
    //       ⇒ 口径一个字没变（往事仍走检索层），变的只是**别再指向一个已经不存在的取法**。
    //   ★它不进 `trimPack` 的剪枝序（那份序是既有读数锁着的）：关系条数在自然产率下是个位数，
    //     硬塞一道剪枝只会给所有世界改行为；真撑爆时 `budgetOverrun` 那条痕迹照旧会说话。
    const openRelations = (ssot.relations || []).filter((r) => r.endedTick == null);
    if (openRelations.length) {
        pack.relations = openRelations.map((r) => ({
            id: r.id, from: r.from, to: r.to, type: r.type, tick: r.tick, cause: r.cause,
        }));
    }
    // ★★★leg128（用户令「把整个链路打通，包含多因点」· 设计 `docs/spec-context-master.md` §4）：
    //   **故事线那一栏**——"这个世界有哪几条故事、各自走到哪"的**地图**，一行一条。
    //   与"往事"（`纪事`）的分工：往事是**地皮**（一轮一轮的原文），故事线是**地图**（一条条因果的边界）。
    //   ⇒ ★**先装地图、再装地皮**：这一栏不进固定剪枝序（它一直待在包里，量体时算进去），
    //     而往事由末道额度守卫**最后**按最新优先装回来 ⇒ 预算紧时先丢原文、保住地图。
    //     为什么这么排（三条，都是本仓已有的纪律）：
    //       ① 它是整包最便宜的一栏（一行 ≈ 45 字 ≈ 15 est；上界 `LINES_TOP=40` ⇒ ≈ 2% 预算）；
    //       ② ★**只有它带得回**——往事那一条被丢就是从模型眼前永久消失，而这一行自带**回去的路**（行首那个根 id）；
    //       ③ 真到连 2% 都装不下，`budgetOverrun` 照旧如实留痕（"预算已强制"不许是空话）。
    //   ★行里**一个字都不是生成的**：根 id / 头标题 / 件数 / 尾标题全部取账上原文
    //     （头尾两端的名字本来就是编年里那两行原文，见理论稿法五）⇒ 结构上不可能发明事实。
    //   ★行首那个 **根 id 就是"点名取回"的把手**（照刻度表那条已落地的通道：点名 → 净化 → 下一轮整取 → 用完即消失）。
    //   ★口径：**没有线就不挂键**（空着就是空着）⇒ 老账、新局、无线可立的世界**逐字节回到今天**。
    //   ★键序纪律：本文件的键序被 `lens.test.js` / `tag-extract.test.js` 逐字钉住 ⇒ 新键**只许缀在最末**
    //     （中间插键会咬），且"有才挂键"两条一起保住"旧输出逐字节不变"。
    //   ★★★leg132：**改成"全史索引"**——见 `pickLinesForPack` 的头注（实测：一屏只装得下约 500 轮，
    //     一万轮时账上 488～812 条线而模型只看得见 40 条，且**连地图被截过都不知道**）。
    const picked = pickLinesForPack(ssot);
    const lineTexts = picked.lines.map(lineTextOf);
    if (lineTexts.length) pack.故事线 = lineTexts;
    // ★★★leg132：**把"一共几条"如实说出来**（这一步是补一条旧账：`linesOf().total` 一直算得出来，
    //   但生产三处**都只用 `lines`**，`total` 只在测试里被读过 ⇒ 模型看见的是一张**残缺却不说**的地图）。
    //   "有才挂键"：装得下全部时不挂（不留一句废话，旧输出逐字节不变）。
    if (picked.total > lineTexts.length) {
        pack.故事线说明 = `账上一共 ${picked.total} 条线，这一栏只摆得下 ${lineTexts.length} 条：`
            + '按"这一轮正在动的事"相关的排前面，其余按收口轮次从新到旧。'
            + '★没摆出来的不是没有，是这里装不下。';
    }
    // ★模型上一轮点名要的那几条线的**经过**（同一轮生效、下一轮自然消失，照 `scaleRequests` 那条生命周期）。
    //   ★它**不设条数与字符上限之外的第二把尺**：上界就 `LINE_ONDEMAND_TOP` 条 × `LINE_DETAIL_CHAR_TOP` 字符，
    //     两个数都住 `lines.js`（一处定义）。
    //   ★★★leg151（用户令：记忆引擎那套体系的第一步「引擎预取」）：**取回的发起权归引擎**。
    //     旧路（模型点名 → 下一轮给）已被用户逐字判死（「下一轮才给查询结果就是垃圾」）——
    //     判死的**不是"点名"这个做法，是"模型发起的取回"这一整类**：一轮只有一次调用，
    //     模型在输出里提问＝**在交卷那一刻提问**（当轮到位的唯一形态是引擎在出包前装好料）。
    //   ⇒ 现在是：**引擎自己挑"这一轮在动的线"，本轮的经过就在这一轮包里**（当轮到位，不问模型）。
    //   ★两条都不许松：
    //     ① **一处定义**：挑线用 `pickLinesToPrefetch`（与"地图那一栏"共用 `pickLinesForPack` 那把尺），
    //        取料用 `buildLineDetails`（与旧路同一个函数）——**各写一份必然漂移，而漂移了没有任何判据会红**；
    //     ② **零扰动**：一条都没取到 ⇒ **键不出现**（没有线的世界逐字节不变）。
    //   ★★★**这一层不许写账**（本笔第一版就栽在这里，留档）：出包在**一轮里会跑两次**
    //     （`tick.js:298` 主调用那次 ＋ `settle.js:1658` 结算那次，后者建包只为量体与记账）。
    //     第一版把"递过"记在出包里 ⇒ 第一次出包挑走 3 条、第二次又挑走剩下 2 条
    //     ⇒ 一轮下来账上写着"五条都递过了"，而**真摆在模型眼前的只有后两条** ⇒ 下一轮**一条都取不到**。
    //     ⇒ 定稿：**出包只决定"这一轮摆什么"，记账由 `runTick` 在一轮落定之后做一次**
    //       （`recordPrefetchedLines`，见 `tick.js`），且记的是**真摆出去的那批**。
    const lineWanted = buildLineDetails(ssot, pickLinesToPrefetch(ssot, ssot.meta?.linesShown));
    if (lineWanted) pack.线的经过 = lineWanted;

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
    // ★★★leg114：预算 = **账上设的优先、否则出厂**——`lim` 由调用方（`runTick`）用 `resolveLimits(world)`
    //   递进来，与上面 `threads` 那一栏**同一条路**；旧调用方不传 `lim` ⇒ **逐字节回到今天**（判据 K2）。
    // ★同批量一个"**裁之前有多大**"：细案 §2.4 丙案要面板显示"上一轮实际用了多少"，而账上原来那个
    //   `pack.estTokens` 是**裁完之后**才量的（见下面几行）⇒ 包一旦撑满，它就**贴着预算顶**、
    //   看着"刚好合适"，**答不出"我该填多少"**（用户嫌 30000 小，正因为它在裁，而账上那个数看不出来）。
    //   ⇒ 故这里先量一次。用的是**同一个量体函数**（`estTokensOf` ⇒ `packTextOf`，"唯一序列化口径"），
    //     不存在第二把尺子；代价是每轮多一次序列化（~40KB，相对一次模型调用是噪声），
    //     换来的是数据流显式——**不用**隐藏属性，也**不改** `trimPack` 的返回形状（它是公开函数，判据在用）。
    const geo = geographyPack({...ssot, entities: lens.map(({e}) => e)}, {moveFact});
    const estBeforeTrim = estTokensOf(geo ? {...pack, geography:geo} : pack);
    const budget = lim?.包预算 ?? EVOLUTION_BUDGET_TOKENS;
    const cutByBudget = trimPack(pack, budget);
    // 判据 C（细案 §5）：行式分隔符冲突**出包期机械自检**，不靠"我看过没问题"。
    //   单本实测命中 0，但那是单本读数 ⇒ 一旦某世界书的名字里带 TAB/换行，这里如实上报（并并入 trimmed 痕迹）。
    const anomalies = entityTableAnomalies(pack.entities);
    if (anomalies.length) {
        pack.tableAnomalies = anomalies.slice(0, 5);
        if (!pack.trimmed) pack.trimmed = [];
        pack.trimmed.push('entities.tableAnomaly');
    }
    // ★★★leg136：**镜头截断的留痕**——原来 `lensList` 到上限就 `break`，包里一个字都不记
    //   （leg131 审计 §2 点过：leg69 为「刻度/法则」的同类静默截断补了 `刻度裁掉`，这一处没治）。
    //   口径照 `entities.tableAnomaly` 那一条：**只在真丢了东西时挂名**，名字进 `trimmed`
    //   （那是"包被裁过"的唯一机器可读痕迹）；条数另挂在 `实体裁掉` 这一格上（同 `刻度裁掉` 的形状）。
    //   ★`picks` 那一支不算截断：那时镜头是**模型自己点的名单**，不是引擎按预算截的（见上面 `lens` 那一处）。
    if (lensFit && lensFit.fit.进包 < lensFit.fit.共) {
        pack.实体裁掉 = { ...lensFit.fit, 原因: `镜头按包预算取前缀（上限 ${lensFit.fit.上限} est）` };
        if (!pack.trimmed) pack.trimmed = [];
        pack.trimmed.push('entities.lens');
    }
    cutByBudget.push(...fitGeography(pack, geo, budget, estTokensOf));
    const text = packTextOf(pack);   // ★细案 §2.1：唯一序列化口径；estTokensOf 同一个函数 ⇒ 不存在"两把尺子"
    // ★★★leg114：`estBeforeTrim` **只在真裁了的时候才带出去**（没裁 ⇒ `undefined`）。
    //   口径依据：`trimPack` 末尾 `if (cut.length) pack.trimmed = cut;` ⇒ **`cut` 非空 ⟺ 包真被裁过**，
    //   与它自己那条"未裁剪时不写该键"完全同源。
    //   ★为什么必须这样收窄：记账那一步照本仓既有口径"**只在有值时写**（旧账零扰动）"
    //     （`settle.js` 的 `recordMetrics` 就是这么写 `proposals`/`rejected`/`gate` 的）⇒
    //     **小世界冒烟一个字节都不写**，那条"终态 SSOT 逐字节不变"的引擎零漂移硬读数才保得住（判据 K6）。
    return {
        pack,
        text,
        estTokens: Math.ceil(text.length / TOKEN_RATIO),
        estBeforeTrim: cutByBudget.length ? estBeforeTrim : undefined,
    };
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
    // ★★★leg113（B2）：**往事（编年）那一栏**——排在这里，只比"书的复印件"（`recalled`）先走。
    //   为什么排在 `closedAgendas` 之后、`recalled` 之前（四段的相对要紧度）：
    //     在办的事 > 已了结的线 > **往事** > 检索到的书的片段。
    //     · 往事是"接得上"的底线（模型每轮失忆就是它不在包里）；`recalled` 只是"这人什么来头"的附加细节。
    //   ★这一段与 `idleFaces`（整段丢弃）同款：**整段丢**。保留多少**不由这里定**
    //     ——它排在中段，此刻量到的余量会被后面几段（`idleFaces`）再改一次；
    //     由**末尾那一道"额度守卫"**在"所有段都定下来之后"逐行装回来，那里才是可靠读数，**记账也只在那一处写**。
    //     ★本笔第一版让这一段自己算额度 ⇒ 判据 J6 当场抓出"算完仍越界"（拿的是过期读数）。
    stage('纪事', () => { delete pack.纪事; });
    // ★★★leg132：**相关往事**紧随其后——**它排在"最近的事"之后被丢，这是故意的**。
    //   两条都是"过去"，但性质不同：`纪事` 是**没有选择**的最新尾巴，这一栏是**按"这一轮正在动的东西"
    //   挑出来的**。预算不够时，先牺牲"没有选择"的那一条，保住"有选择"的那一条——
    //   这正是"最大化阻止失忆"那条要求在裁剪序上的落地。
    //   ★它**不是**"裁空气"：这一格只在那一栏**真在包里**时才执行（见下一行的判据）——
    //     否则剪枝痕迹里会多出一条"丢了空气"的假账（本仓明令，见文件里那段留档）。
    if (pack.相关往事 !== undefined) stage('相关往事', () => { delete pack.相关往事; });
    // ★★★leg153：**按意思找回的旧事**紧跟在 `相关往事` 之后被丢（＝它比名字那条路**多留一步**）。
    //   理由（一句人话）：这一栏是**唯一**够得着"字面对不上"那段旧账的路；名字那条路捞得到的东西，
    //   `纪事` 与它自己多少能补一部分，而这一栏一旦丢掉，那一段旧事**没有任何别的路**能补。
    //   ★这是**提案态**（裁剪序上的先后没量过曲线）——真跑几轮之后照读数再定，别当成定案。
    //   ★同一条纪律：**那一栏不在包里时不许执行这一步**（否则剪枝痕迹里多一条"丢了空气"的假账）。
    if (pack['按意思找回的旧事'] !== undefined) stage('按意思找回的旧事', () => { delete pack['按意思找回的旧事']; });
    // ⑦ ★leg32g：待启用名单**整段丢弃**（不是截短——名单靠"轮转"保证公平，截短会让排在后面的永远露不了头）。
    stage('idleFaces', () => { pack.idleFaces = []; });
    // ⑧ ★leg34 的"检索到的世界书片段"（`recalled`）**已拆**（leg122）⇒ **固定剪枝序到 ⑦ 为止**。
    //   ★留档它当年的口径（免得下一任重新发明）：它排在剪枝序**最后**、**最可牺牲**——
    //     因为它是**附加细节**（"这个人什么来头"），而前面每一段都是**当下必须知道的事**
    //     （谁在办什么/什么事在飞/谁该轮到）；预算不够时先丢"书的复印件"、保住"世界的现状"。
    //   ★顺手记一条纪律（原注释里的守卫，值得留）：**那一段不存在时不要执行那一步**——
    //     否则剪枝顺序报告里会多出一条"丢了空气"的记录，读数就不实了。
    // ★★★leg113（B2）：**额度守卫**——固定序全走完之后，把"往事"按**最新优先**装回来，装到满为止。
    //   为什么必须放在最后（本笔踩过一脚，判据 J6 抓出来的）：
    //     `纪事` 那一段在固定序的**中段**，那一刻量到的余量会被后面几段（`idleFaces`）**再改一次**
    //     ⇒ 在中段算"能留几条"= 拿**过期的读数**做决定（第一版正是这么写的：算完仍越界）。
    //   ★口径（与 `stage()` 那套"整段丢"刻意不同）：
    //     · **整条收、整条丢**——绝不拦腰砍（砍半句"沿「死煞杀局启动」而"比不写更坏，模型会拿半句话说事）；
    //     · **从最旧的丢**——往事里"最近发生的"才是接着写这一轮最需要的（装回来也从最新那条开始）；
    //     · ★**每一步都真量一遍整包**（不是先算额度再一次性 `slice`）——本笔实测证明：
    //        "先算额度"那套会拿两个**状态不同**的读数相减（含列 vs 不含列），算出来的条数当场越界。
    //        逐条试、逐条量，慢一点但**结论与最终那一份包是同一个事实**（"先证红"的同一条纪律）。
    //     · 丢了多少**如实记名**（`纪事` = 整栏没装下；`纪事.留N条` = 只装下最近 N 条）——
    //       "往事被丢了一半"这件事，读包的人（模型与调试者）必须看得出来。
    //   ★全量那一份由 `buildEvolutionPack` 通过不可枚举的 `__chronicle` 递进来（见那一处注释）。
    //   ★**一行一行往里加、每加一行真量一次整包**（不是先算额度再一次性 `slice`）——本笔实测两处栽在这上面：
    //     ① 在中段算额度 = 拿过期读数；② 一次量"整个前缀" ≠ 逐行量的结果（`packTextOf` 是非线性的）。
    //     逐行试、逐行量慢一点，但它与**最终那一份包是同一个事实**（"先证红"的同一条纪律）。
    //   ★记账**只在这里写一次**（`纪事` = 整栏没装下；`纪事.留N条` = 只装下最近 N 条）——
    //     同步那一段不再记名（同一件事只有一个写手；否则读数里会出现"丢了又丢"的假账）。
    const brief = Array.isArray(pack.__chronicle) ? pack.__chronicle : [];
    // ★★★leg132：**"最近的事"与"相关往事"不许重复占额度**。
    //   一份往事只能出现在一栏里：已经在 `相关往事` 里递出去的那些，这里**按行身份**排掉
    //   （同一批字符串对象，不是按文字比——`fetchChroniclePast` 与 `fetchRelatedPast` 都返回
    //   检索层交出来的**同一个** `briefLineText` 结果，所以身份比对是准的）。
    //   为什么必须在**这里**排（而不是在出包那一刻）：那一刻还不知道额度守卫最终会留几条，
    //   算出来的是**过期读数**——本文件已经为"拿过期读数做决定"栽过一次（见上面那段注释）。
    const relatedKept = Array.isArray(pack.相关往事) ? pack.相关往事 : [];
    const briefAvail = relatedKept.length ? brief.filter((r) => !relatedKept.includes(r)) : brief;
    // ★★★leg133：**把往事按窗口切成两段**（`brief` 是按轮次升序的 ⇒ 切一刀就是两段）——
    //   · `briefWindow` = **窗口内**（`tick >= windowFromTick(...)`）⇒ **必须保住**，预算紧也不许把它挤空；
    //   · `briefOld`    = **窗口外**的更旧那一段 ⇒ 只在**还有余量**时从**最旧的一端**往里装。
    //   ★为什么这么切（用户 2026-09-25 拍板「我认为50轮」）：在这一笔之前，"最近的事"那一栏
    //     **没有任何时间保证**——它只是"链尾往回数、装到装不下"（实测同一份账只换预算，装进去的行数
    //     是 625/241/122/33/0）⇒ 预算一紧，模型连"刚刚发生了什么"都看不见。
    //     有了这条线，"最近 N 轮一定在"第一次成了硬保证。
    //   ★装填次序与旧口径**相反**（旧的是"从最新往回装"）：因为窗口内那一段已经保证了"最新"，
    //     剩下的余量该拿去补**更旧的**那一段——否则余量又会被"窗口内已经有的行"吃掉（等于没加窗口）。
    //   ★窗口下界由出包侧经 `__windowFloor` 递进来（`trimPack` 拿不到 `ssot`，见那一处注释）；
    //     直接调 `trimPack` 的旧调用方（判据/冒烟）拿不到 ⇒ **缺省 `-Infinity` = 全部算窗口内**
    //     ⇒ 退化成"最新优先"的旧行为，**旧调用方零扰动**。
    const windowFloor = Number.isFinite(pack.__windowFloor) ? pack.__windowFloor : -Infinity;
    const briefWindow = briefAvail.filter((r) => Number(r?.tick) >= windowFloor);
    const briefOld = briefAvail.filter((r) => Number(r?.tick) < windowFloor);
    if (briefAvail.length && pack.纪事 === undefined) {
        //   ★★把"裁过这一栏"这条记账**先按最终内容挂上**再逐行量（本笔实测踩到的最后一脚，值得留档）：
        //     `trimmed` 那个键自己也占字符，且它**不是一小条**——本笔实测它已积累到 130 字符（前面各段的名字都在里面）。
        //     第一版只挂一个占位 `['纪事']`（14 字符），量出来"装得下 494 条"，可循环之后写进去的是那 130 字符的
        //     真正的 `trimmed` ⇒ 最终那一份包**越界 80 字符（≈27 est）**。
        //   ⇒ 口径：**先按最终内容挂上**（`[...前面各段, '纪事']`），这样循环量到的就是最终那一份真包。
        //     `keep` 定下来之后再把它改成如实的 `纪事.留N条`——**那个字符串更短**，所以只会更省，不会又越界。
        const hadTrimmed = pack.trimmed !== undefined;
        if (!hadTrimmed) pack.trimmed = [...cut, '纪事'];
        let keep = 0;
        // ★★★二分找"最多装得下几条"（保语义、只换算法）。
        //   口径一个字没变：量体**永远是最终那一份包**（`trimmed` 已按最终内容挂上、逐条真量），
        //   丢的那一端仍是**最旧的**（`brief.slice(-n)` 取最新那一端），"整条收、整条丢"照旧。
        //   为什么可以二分：装得下的条数**单调**（每多一条只往数组里多一项 ⇒ 序列化只变长不变短）
        //   ⇒ 二分与"逐行试"**同一个答案**。
        //   为什么必须改（实测，不是理论担忧）：原写法逐条量一次整包，而包一超预算时
        //   往事可能有上千条 ⇒ **每轮空转上千次整包序列化**，单轮 15ms → **1100ms**，且永不自愈。
        //   ★这一格与那条性能病是同一处：判据锁的仍是"结果"，只有量体次数从 O(条数) 降到 O(log 条数)。
        // ★★★leg133：**一条二分同时保住"窗口优先"与"预算硬顶"**。
        //   口径（三句，缺一不可）：
        //     ① `keep` = **整栏保留的条数**（仍是"最新那一端"）——与旧口径同一个变量、同一个含义；
        //     ② 当 `keep >= 窗口内条数` 时，**窗口内那一段全部在里面**（它是最新的）⇒ **窗口优先**；
        //     ③ 当 `keep < 窗口内条数`（预算紧到连窗口都装不下）时，**从窗口最旧的一端开始丢**——
        //        而不是像旧口径那样"谁先来谁留下"⇒ 降级方向可预期，且**本轮刚发生的一定在**。
        //   ⇒ 装填次序与旧口径**相反**（旧的是"从最新往回装"，余量全被最新的吃掉）：
        //     现在余量先给"窗口内"，剩下的才拿去补**更旧的**那一段——否则加了窗口等于没加。
        const fits = (n) => {
            const kept = n >= briefWindow.length
                ? [...briefOld.slice(0, n - briefWindow.length), ...briefWindow]   // 窗口全在 ＋ 补最旧的那几条
                : briefAvail.slice(-n);                                            // 连窗口都装不下 ⇒ 保最新那一端
            if (!kept.length) delete pack.纪事; else pack.纪事 = kept;
            return estTokensOf(pack) <= budgetTokens;
        };
        if (fits(briefAvail.length)) {
            keep = briefAvail.length;                // 全装下（真账今天就是这一支）：一次量体就收工
        } else {
            let lo = 0, hi = briefAvail.length;      // 不变量：keep ≥ lo；hi 是"已知装不下"的上界
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (fits(mid)) lo = mid; else hi = mid;
            }
            keep = lo;
        }
        const kept = keep >= briefWindow.length
            ? [...briefOld.slice(0, keep - briefWindow.length), ...briefWindow]
            : briefAvail.slice(-keep);
        if (kept.length) pack.纪事 = kept; else delete pack.纪事;   // 一条都没有 ⇒ 整栏不挂（空着就是空着）
        // ★leg133：痕迹记的是**真正留下的条数**（`kept.length`），不是二分出来的那个 `keep`——
        //   两者在新装填序下**会不相等**（余量按"窗口全在 ＋ 补最旧的几条"算 ⇒ 实际留下的是 `O + W` 条，
        //   而 `keep` 是"总量上限"那个数）。`trimmed` 是唯一记录裁剪事实的地方 ⇒ 必须与事实同数。
        //   （判据 `chronicle-brief.test.js` 的"痕要与事实同数"当场咬出这一处。）
        if (kept.length < briefAvail.length) {
            // ★★★修（leg130 真跑抓出来的第二个病）：**插回原来那一格，不许追加到末尾**。
            //   病：这一格原先是"splice 掉旧的 → push 到末尾" ⇒ 当 ⑦往事 与 ⑧待启用名单**同时**触发时，
            //     痕迹读出来是 `[…, "idleFaces", "纪事.留N条"]`——**看着像"先扔往事、后扔名单"**，
            //     与固定剪枝序正好相反（实测 41/200 轮）。
            //   为什么这是病而不是"记法不同"：`trimmed` 是**唯一记录裁剪次序的地方**，
            //     它一排错，"裁剪到底按没按固定序"这件事就**再也无法机械核对**（判据落不了地）。
            //   ★口径没变：仍然只有"真被裁过"才记名，仍然只记 `纪事` / `纪事.留N条` 这两种之一。
            //   ★leg133：N = **真正留下的条数**（`kept.length`）——见上面那段（`keep` 与它在新装填序下不等）。
            const mark = kept.length === 0 ? '纪事' : `纪事.留${kept.length}条`;
            const at = cut.findIndex((s) => String(s).startsWith('纪事'));
            if (at >= 0) cut[at] = mark; else cut.push(mark);
        } else if (!hadTrimmed) {
            delete pack.trimmed;
        }
    }
    // ★★★修（leg130 真跑抓出来的第一个病）：**先把 `trimmed` 按最终内容挂上，再量最后一次**。
    //   病：原先是"先量 `estTokensOf(pack)` 判越界、再挂 `trimmed`" ⇒ 量到的是**还没挂 `trimmed` 的包**，
    //     而 `trimmed` 自己也占字符（实测 5 段时 ≈ 37 est）⇒ 交出去的那一份包**越了预算却没有 `budgetOverrun`**。
    //   实测（各档预算）：3000 → 4/90 轮 · 1500 → 5/200 · 1350 → 2/200 · 1200 → 4/151，
    //     越界幅度恰好是那个数组本身的长度（最大 28 est）；精确复现见 `demo/` 那次体检的记录。
    //   最刺眼的一点：它**只在"固定序走到一半就压进预算"那条路上出现**——那时 `pack.trimmed` 从头到尾
    //     没挂过，末道自量整整少算了整个数组 ⇒ "不许静默炸预算"就是在这里变成空话的。
    //   ★口径：量体**永远是最终那一份包**（与上面额度守卫同一条纪律，别在这里另立一把尺）。
    if (cut.length) pack.trimmed = cut;
    if (estTokensOf(pack) > budgetTokens) cut.push('budgetOverrun');
    if (cut.length) pack.trimmed = cut;
    return cut;
}
