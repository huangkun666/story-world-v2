// story-world-v2/src/render.js
// 渲染核心纯函数（K33/K34，渲染层；细案 A-1/A-2/A-3/A-6）：
//   SSOT → HTML 片段（**八页签**全量：观棋/编年/大事纪·旧卷/角色与势力/设定/参数/快照/设置）。
//   ★本体体检修正：此处旧写"六页签"——leg26 加参数页、leg27 后加快照页之后就没再对齐过。
//   同输入 → 输出逐字节一致（纯函数锁）；引擎 id 只进 title/data-ref 悬停；
//   全边界 escapeHtml（XSS 防线）。
// 玩家语言词典（A-3 黑名单以共识样例 v3 为准——"盘算/谋划"为玩家通词放行）：
//   禁：分量/熵泵/里程碑/上溯/波及/指纹/派生源/强度参数名/hardPower…/tick/裸 id。
import { PARAM_GEARS, PANEL_ENV_KEYS, PARAM_UNSET, SWITCH_PARAMS, dependentKeys, independentKeys, normalizeParam, paramsOf, paramsRows, switchOn } from './params.js';   // leg26：环境量数值 → 世界参数档位（玩家可选）；★leg53：PANEL_ENV_KEYS = 面板真画的那几格（民生已撤）
// ★★leg52：**参数真源**的两个纯函数（`isPlayerInputKey` / `normalizeStoreValue`）——
//   设定页与观棋信息带从此**和有旋钮的参数页读同一本账**（详见下面 `paramEnvOverride` 的记档）。
//   依赖方向：render → param-store → （params / limits），**无环**（param-store 是叶子，只依赖两张常量表）。
import { isPlayerInputKey, normalizeStoreValue } from './param-store.js';
// ★leg32：引擎尺度（盘算三道上限）的**唯一真源**。此前面板把分母写死成 `/15` `/5`
//   ⇒ leg31b 把 `topLevel` 5 → 10 之后，世界真的变宽了而面板还写着 5，
//   玩家无法从面板判断任何变宽实验是否奏效（用户实机「一点变化都没有」追出来的真缺陷）。
//   依赖方向：render → settle（settle 不反向依赖 render）——无环，已在 import 图上核过。
import { AGENDA_CAPS, ENTITY_BIRTH_PER_TICK } from './settle.js';import { resolveScales, groupScales } from './abstract.js';   // ★leg62：刻度的概念表分组（与 pack.js 同一个读取口）；★leg63：按原文条目分节
import { lensList, membersOf, IDLE_FACES_TOP } from './pack.js';   // K46：镜头名单（引擎层同口径）与麾下成员派生——渲染只读复用
// ★★leg63：进包读数**必须读真源**（`buildScaleAnchor` 就是进包用的那一个函数）。
//   为什么不能在这里自己按 `TIER_TOP` 另算一份：本仓"两份复制品漂移"的亏吃过多次，
//   而这一格是**给玩家看的数字**——面板说"这些表每轮都在包里"，就得是包里真的那些（见下面那段如实报）。
import { buildScaleAnchor } from './pack.js';
import { LIMIT_ROWS, LIMIT_DEFAULTS, LIMIT_KEYS, isLimitKeyOf, normalizeLimit, limitsOf } from './limits.js';   // leg40b 续：世界尺度四个可调上限（唯一真源，与引擎判据同源）
// ★★leg53：**哪几格是引擎每轮算的**——从生产者那边取（不是面板自己另写一份名单，本仓"一处口径"）。
import { ENGINE_DERIVED_ENV } from './unrest.js';
// ★★★leg54：单轮演算上限那行原来**把数字写死**（"120 秒 / 4096 字"），而实值是 **16384**
//   （第十九棒拍板、`transport-http.js` 的 E3 记档；`test/transport-http.test.js` 锁着）。
//   ⇒ 面板印了一个**过期好几棒的数**，而且它正是"看不出哪个是准的"那种症状的来源
//     （本棒我就是先信了这行、把预算记成 4096 —— 见交接 §"我踩的坑"）。
//   ⇒ 改成**从真源现读**：`PROPOSED_CALL_LIMITS` 是那两个数的**唯一出处**。
import { PROPOSED_CALL_LIMITS } from './transport-http.js';
import { TENSION_WINDOW, recentEventCount } from './setting.js';   // A1b：张力行改说可验证事实（近 N 轮事件数），与公式共用同一口径

// 面板构建号（自证用）：用户实机常遇到"改了代码但页面还是旧的"（浏览器缓存 web/index.js）。
//   这个号随每次功能落地递增，渲染进面板页脚——Ctrl+F5 后一眼就能判断载的是哪一版。
//   判据（第二十五棒）：`有值/未查/未加载到/书未明述` 查书标记 + 位置列去重 = 本轮；
//   上一版是"查书标记（缺未查）+ 位置未明徽章重复"。
//   第二十五棒 b 追加（A1b）：张力行不再写「烈度带词 + 百分比」，改「近 N 轮事件 N 件」；
//   麾下成员序由分量序改**名号序**（A1）。← 看到 `+a1b` 后缀即已载入这两条。
//   第二十五棒 d 追加：查书前置步的异步 bookText 修通 + **取书路径改 ST 官方指针**
//   （`data.extensions.world`，旧法读 `character.world` 恒空 ⇒ 取书 0 条 ⇒ 假「书未明述」）
//   + 未查态 title 属性截断修复 + **查书补全三件套**（批量补全/单实体重查/选人可见）。
//   第二十五棒 f 追加：**位置继承的接线修通**（`bookEntriesForInherit` + 三处调用点）——
//   之前那句"接线断了而测试全绿"让真账 563 实体真位置恒 0、位置列整列「未载」；现首开面板即推 173。
//   同棒另删两处死机制：盘算满步的「败露」支（判据输入早随四维消失）+ 可见性掩码（两取值都过阈值=恒真）。
//   同棒收尾：观棋侧栏与 `📍` 行由"平铺一切"改为**按处聚合**（位置当分组键；"位置未载"单列一筐）。
//   ★leg26 追加（用户令「参数独开页签」+「熵泵删掉没用的功能，改个定义就好了」）：
//   ① 新增**参数页**（第七页签）：世界参数档位由玩家选，引擎照抄（`src/params.js` 是唯一真源）；
//   ② 环境量从"四个引擎推的数"改为**档位原话**，撤掉"危险带"判态与空心条百分比（引擎对档位零表态）；
//   ③ 熵泵改定义：只在**账本自己能证明的事实**（连续 N 轮无真实事件）时出声，世界一动就收声。
//   ← 看到 `leg26-params` 即已载入这三条。
//   ★leg27 追加（用户实机「二十多分钟很慢」+「**我也看不到日志不知道抽得怎么样**」）：
//   抽取过程**可见**——编排层注入式上报每段的开始/结束/字符数/耗时（`src/abstract.js` 的 onProgress），
//   `web/index.js` 转成状态栏进度 + 控制台每段一行；超时改为**止损跳过**（不再对半拆/重试、不再烧 62 分钟/块）。
//   ★leg27 后追加（用户令「再做一个快照容错系统，用户和 llm 每一步的修改都会生成快照」）：
//   **第八页签「快照」**（`renderSnapshotsHtml`）——每步可回退；存插件本地库（IDB，不占聊天文件）、保留 15 步、
//   **只回世界账**（对话不动）。判据与真实体积见 `docs/spec-snapshot-fault-tolerance.md` §7。
//   ★leg27 g（用户实机「记忆插件也没有记录事件，还把插件原来的**角色档案**清空了」）：
//   记忆投递读现状那一行原写 `Storage.loadState(null, null)`——**显式传 null 使插件 sessionId 默认值失效**
//   ⇒ 读回非对象 ⇒ 退回空态并被 `force` 覆盖写回 ⇒ **用户档案被逐条抹掉**。现改为传插件自己的默认态，
//   并有判据锁死（`test/snapshot.test.js` 的 leg27 g 两条：结构层禁止 null 占位 + 行为层 fake 插件真跑保档案）。
//   ← 看到 `leg27h-mem-selfevidence` 即已载入上面**全部**八条（进度+读秒心跳 / 超时分治 / 快照 / 参数页版式与误触防护 / 落账作用域 / 快照链对齐 / 记忆读取不覆盖用户档案 / 记忆投递自证面 + 大事表「未结」档）。
//   ★leg27 h（用户实机「**记忆插件也没有记录事件**」+ 口径「事件要落地才成事件」+「**但不会出现其他盘算了啊**」）：
//   ①记忆投递**自证面**——参数页开关卡挂「上次投递」的实测事实（第几轮 / 大事几条 / 或失败原因），
//     没投过则明确显示"还没投过"（**绝不显示"已投"**——这一棒吃的就是假绿的亏）。
//   ②大事表**分档如实**：已落地无标记、在飞带「未结 ·」（旧口径"在飞一律不进"让这张表前 8 轮恒空）。
//   ③世界变宽的诊断与候选 → `docs/spec-world-widening.md`（★真账实测：618 实体里 **614 静默**、可动 4 个、
//     能提新盘算的来源 2 个；根因＝**静默门是单向门**：没出手过 ⇒ 永远没有 lastActiveTick ⇒ 永远静默）。
//   ★leg29（用户令「事件波及也改成 15 个」+「写进提示词」）：`RIPPLE_TARGET_CAP` 3 → 15，并把上限写进
//   提示词铁律 8（此前四处一字未提 ⇒ 模型写超限只撞"拒整步"、白烧一整轮）。**引擎/校验面行为不变**，
//   故无界面改动——但构建号仍要往前走一格，否则"页面还是旧的 vs 代码已更新"无法用构建号判定。
//   ★实测注意：15 不是最先咬人的天花板（`AGENDA_INVOLVED_CAP` 同为 15，集合含属主 + 本步动作方
//   ⇒ 属主自行动时单事件最多波及 14）；该咬合已由 `test/worldstep.test.js` 的 leg29 用例钉死。
//   ★leg30（用户 2026-09-12 两张记忆插件截图 + 一句「很乱，这信息插入的，怎么解决？我需要有条理」）：
//   记忆投递**收成两种形状**（当下=覆盖一条 / 发生=追加一列，前史是同一列里成段的行），
//   并立"一字段一义"：位置列只装地点、波及名单进人名列、`状态` 只装"了结没"、`备注` 我方一个字不写。
//   ★这一棒**真的动了界面**（记忆插件的表名/列名/卡内容都变了），所以构建号必须往前走。
//   ★leg31（实体段表达法收改，细案 `docs/spec-entity-section-encoding.md`）：**界面零变化**（面板读的是内部
//   分段对象，不是 pack 文本），但**模型看到的东西变了**（entities 段从对象数组改成行式表格，
//   `MAIN_PROMPT_V` v2-agenda-t1-6 → v2-agenda-t1-7）⇒ 构建号照旧往前走一格：
//   否则"页面还是旧的"与"新表达法已生效"无法用构建号区分（leg29 立此规矩）。
//   ★leg31b（世界变宽·保守档）：`AGENDA_CAPS.topLevel` 5 → 10（用户令「先走保守的」）——这是**引擎判据**
//   的一次真改动（先前四道闸全是只测不改），且它以"盘算条数 ~2 倍"直接改变世界演化形状
//   ⇒ 属主面 3 → 8、盘算 4 → 9 条（细案 `docs/spec-world-widening.md` §5.5）；**界面零变化**，
//   但**世界行为变了** ⇒ 构建号照旧走一格（同 leg29 立的规矩）。
//   ⚠**构建号里不许出现引擎术语**：本棒第一版起名 `leg31b-agenda-top10` ⇒ 当场被 K33/A-3 那三条
//   "玩家可见文本零引擎术语"的用例抓红（**构建号渲染在实体表表头 = 玩家视线内**）⇒ 改为不含禁词的写法。
//   ★leg49 又踩了同一颗雷（细案初稿 `leg49-entities-three-cols` 含 `entity`）——当时的处置是从扫描里
//   **把构建号抠掉**（= 假绿），评审揪出后用户拍板改名 ⇒ 扫描恢复全量。详见本常量处的留档。
//   ⚠留档纠错（评审修正 #1 的附带发现）：本行曾按评审转述写过"构建号只被弱化后的逐 token 测试守着"，
//   但**全仓 grep（`逐 token`/`逐token`/`弱化`）找不到那样一段描述**——真正在守构建号的是
//   `test/render.test.js` 里那两条（构建号自己不许含禁词 + 构建号必须在玩家视线内）。不写没核实过的话。
//   ★leg32（**这一格与前两格性质不同：这次界面真的变了**，起因是用户实机「盘算并没有变多
//   甚至一点变化都没有」）：leg31b 只改了引擎那个数，而**面板把分母写死成 `/5`** ⇒ 玩家无法从
//   面板判断变宽是否生效。本棒把分母改成读引擎真源，并在参数页摆出三道上限（只读）。
//   ⚠如实记：leg31b 那一笔的 commit message 写的是"界面零变化"——**在那笔的范围里是对的**
//   （它只动了 `PANEL_BUILD` 一行），但它没意识到面板分母是写死的，于是"引擎 5→10、面板仍写 5"
//   这件事在用户眼里就是"什么都没发生"。教训：**改了引擎判据就要检查有没有第二份副本在呈现它**。
// ★leg33d：这一格**界面真的变了**——参数页最前面多了一张「插件总闸 · 自动推进」卡（用户令
//   「加一个启动和关闭插件的入口，要不然这个插件会直接自动生效」）。它管"插件自己"，不是"插件对外
//   的动作"；关掉之后发消息不推进、切聊天不自动载入，手动「推进一轮」永不被闸。
//   ★给构建号起名要过禁词判据（leg31 那条血的教训）：本名不含 `agenda`/`tick`/`ssot`/`schema` 等任一项。
// ★leg34：**模型看到的东西变了三次**——①实体表之外多了一栏「最近离场的人」（带因复活的前提：
//   不给名字与 id，模型就永远提不出复活）；②提示词正文多了第 13 条（字段可改、复活要带因）；
//   ③★包里多了 `recalled`——**引擎按本回合上下文从世界书检索到的原文片段**（用户追问「为什么聊天 llm
//   能直接获取世界书内容…都是一轮解决的啊」之后改成的做法：出包前检索、当轮可见、零额外调用）。
//   界面本身没动 ⇒ 照 leg29 立的规矩，**世界行为变了也走一格构建号**（玩家拿它判"页面是不是旧的"）。
//   ★禁词自检：本名不含 `agenda`/`tick`/`ssot`/`schema` 等任一项。
// ★leg35：**模型看到的东西又变了**——注入那一段多了**往事标记**。起因是本棒实机闭环自验量出的真缺陷：
//   检索**真跑了**（真 embedding 1024 维、6 段全过 0.3 门槛），但召回原文是**开局那几轮的会话总结**
//   （自带 `19021年05月05日` 这类日期），而账上**一点时间信息都没有**（`meta` 只有 tick）⇒ 模型没有任何
//   机械手段知道那是 59 轮前的旧事。原来台头只写一句"不是新发生的事"——那是**形容词**，读不出"多久以前"。
//   ⇒ 改成机械标记：把片段里**真读出来的**时间原样列在台头 + 写明位于本回合位序之前；
//     红线：**读不出时间就只报位序，绝不替它补一个年份**（那是编数）。
//   界面本身没动 ⇒ 照 leg29 立的规矩，**世界行为/模型所见变了也走一格构建号**（玩家拿它判"页面是不是旧的"）。
//   ★禁词自检：本名不含 `agenda`/`tick`/`ssot`/`schema` 等任一项（`recall` 也不是禁词，但为稳妥换成中文口径）。
// ★leg40b（**面板本体体检 · 第一刀 + 第二刀**）：界面真的动了 ⇒ 构建号往前走一格。
//   这一棒修的全是"**测试全绿也照样病着**"的东西，逐条留档（判据见各自的回归锁）：
//   ① ★**四维残文**——设置页开档描述那句还写着「世界从中摘你的底子（兵力/权位/人脉/耳目）」，
//      而这四个概念在 leg25 c 已被用户令**整条删除**（本文件 103-107 行就是删除留档）。
//      它躲过禁词锁的原因值得记住：`test/render.test.js` 扫的是 `renderAll(夹具世界())`，
//      而**夹具的 playerDesc 是「我名黄坤，炼气九层。」**——不含那四个词 ⇒
//      **禁词扫描看不见"用户真写一段描述"时会带出什么**。修法：句中那四个词换成人话说法，
//      并把夹具描述改成含四维词的串（让禁词锁真的能咬到这一句）。
//   ② ★**一条永不会兑现的承诺**——角色与势力页的位置空态写着「未查：轮到时会按需去世界书取原话」，
//      而位置查书这条腿在 leg25 f 就被摘掉了（`src/entity-lookup.js` 的 `ENTITY_LOOKUP_FIELDS = ['实力']`）。
//      真账实测：`meta.entityFields` 只有 `实力:pending×7 / 实力:absent×5`，`位置:*` **一条都没有**，
//      而面板上有 **405 行**挂着这句。（`recheck` 判据里那个 `'位置'` 同样是死条件，一并删。）
//   ③ **错归因**——地图未载筐写「他们照常在世界里活动，不被位置筛掉」。位置确实不筛（这半句对），
//      但真账 621 实体里只有 **24** 个有 `lastActiveTick`、613 人从未出手——**静默门才是那个筛子**
//      （`src/gate.js` 结构三条件）。原话会让玩家把"没人动"归因到位置上。
//   ④ **死亡倒计时式的空态噪声**——「归属空着（书里没明述、也没结构依据）」在真账上挂 **360/621 行**：
//      书里没写隶属的普通人**是常态不是异常**，逐行印一句免责声明等于把信号淹掉。改成一句短语。
//   ⑤ **档位条恒真**（`envRowHtml` 的 `width: 0%|100%` 两态）与 **D2 重复说明**（下拉里已列出全部
//      可选档位，"可选：A / B / C / D" 那一行是第二遍）一并收掉。
//   ⑥ **按钮名对不上**——状态栏三处说「要推请按观棋窗口的「推进一轮」」，而面板上真正的按钮
//      叫「▶ 手动推进一步」且在**设置页**（用户在观棋页是找不到它的）。统一叫「推进一轮」，
//      并把它挪到**参数页**（那一页就是"你对世界的输入"，推进也是输入）。
//   ⑦ **第二刀（删什么都不做的东西）**：参数页「记进编年史书」开关**一个字节都不写**
//      （leg26 交接 §7 E2 自己登记过"我顺手加的面，落点未核验"）⇒ 撤掉；
//      零引用导出 `paramBand` / `dependentKeys` / `independentKeys` / `FORCE_MODES` /
//      `memoryPushStatus` / `sw2TabState` 一并删（判据：`demo` 侧零引用探针 + 全仓 grep）。
//   ★禁词自检：本名不含 `agenda`/`tick`/`ssot`/`schema` 等任一项。
// ★★leg46 续·二 升位（用户提供读数 + 一句关键补充：「我把每轮递几条线3改成了9」+「有没有可能是其他插件造成的」）：
//   **参数页的自检卡现在多两行**——`写入审计`（每一次写真源的留痕：谁写的 · 写后有哪些键 · 丢过谁 · 调用栈）
//   与 `撤销步数`。构建号换新串的理由（照 leg29 立的规矩）：**玩家可见面真的变了**，而且这一串
//   本身就是"页面是不是新代码"的凭证（前七轮反复栽在这上面）。CSS 同步升位：自检卡又多两行版式。
// ★leg49（细案 spec-entities-page-ia）升位：**玩家可见面真的变了**——「角色与势力」页从
//   621 张等价卡平铺（真账实测 170319px 高、626 枚按钮、0 个搜索）改成三列 + 工具条 + 分组 + 分页。
//   这一串本身就是"页面是不是新代码"的凭证（前七轮反复栽在浏览器缓存上）⇒ 版位必须跟着走。
//   ★这一串的**取名被评审修正过**：细案初稿写 `leg49-entities-three-cols`，而它含 `entity`
//   ——与 leg31 立的"构建号也不许带引擎术语"那条锁在**同一串字符**上直接对撞。当时 Task 5 的处置
//   是从禁词扫描里把构建号**抠掉**（本仓纪律：抠洞就是假绿）。评审揪出 ⇒ 用户拍板**改名**：
//   `leg49-three-column-roster` ⇒ 冲突消失，扫描恢复全量（判据同批撤掉抠洞，见 test/render.test.js）。
//   ★禁词纪律：本串不含 agenda/tick/ssot/schema/entity（玩家视线内的字符串不许露引擎术语，判据在
//   `test/render.test.js` 的"版位升位且不含引擎术语"与"工具栏与列表头零引擎术语"两条里锁着）。
//   ★★leg52（`leg52-params-and-tide`）：同一页四键并成一张卡 + 推进卡撤走 + 撤销卡上移 +
//   长说明折进「？」+ 观棋页浪尖去重（大势只放大势、浪尖只放浪尖）+ 设定页/信息带改读真源。
//   ★★★leg53（`leg53-unrest-producer`）：**乱象那一格真有生产者了**——引擎每轮从账上真发生的事
//   推一个档位（`src/unrest.js`：近 10 轮出事铺到几个不同地点 ⇒ 四档）；**民生那一格撤下**
//   （它没有任何生产者，永远「未定」）；乱象的「依据」如实写「引擎每轮算的」（不再糊成"书里原话"）。
//   ★★★leg54（`leg54-unlimited-limits`）：**世界尺度那四个框改成数字输入框、拿掉上限**（用户令
//   「能自由调数，当然也能无上限」）——旧的档位白名单（顶格 9/12/30/40）撤掉；
//   顺带修**设置页印着过期预算**那个显示 bug（写着 4096，实值 16384）。
// ★★★leg60 换档：设定页**玩家可见面真的变了**——新增「维度与刻度」与「编译完整性」两栏
//   （书里的尺子 + 本次编译读了多少/漏了多少）。⇒ 构建号跟批升位（本地纪律：改盘即生效，
//   但浏览器会缓存旧面板 ⇒ 用户按 Ctrl+F5 后拿这一串对照"是不是新的"）。
//   ★起名同一条纪律：零引擎术语（判据在 `render.test.js` 的扫描器里）。
// ★★★leg62 换档：设定页**玩家可见面真的变了**——「力量谱系」+「维度与刻度」两栏
//   **合并成一栏「刻度」并按概念分表**（一概念一张卡：衡量强弱的尺 / 分配制度 / 取值范围 / 换算表
//   各自成表，不再挤在同一个框里）。这正是用户截图指出的那个混排（`S~E级` 与 `A班~D班` 并列）。
//   ⇒ 构建号跟批升位（同一条本地纪律：改盘即生效，但浏览器会缓存旧面板 ⇒ Ctrl+F5 后拿这串对照）。
//   ★起名同一条纪律：零引擎术语（判据在 `render.test.js` 的扫描器里）。
// ★★★leg62b（用户现场反馈：「只抽刻度啥意思，我刚刚抽了有很多表，但是原本的内容还在」）：
//   口径没错、呈现没交代清楚 ⇒ 草稿那一段加了三道区分（标题写明草稿 / 每卡橙边+「草稿」标 /
//   "下面那一部分是已冻结的设定，一个字没动"）。玩家可见面又变了 ⇒ 构建号同批再升一格。
//   ★形状纪律（`render.test.js` 锁着）：必须是 `leg<数字>-…`（升位链条要能一眼看出来）⇒
//     同一棒内的第二次升位写成 `leg62-…-2`，**不许**用 `leg62b` 这种（不合形状、当时被锁当场抓住）。
export const PANEL_BUILD = 'leg63-scale-index-2';


export const LABELS = {    env: { 民生度: '民生', 动乱度: '乱象', 天时: '天时', 张力推手: '时局' },
    kind: { faction: '势力', character: '角色' },
    visibility: { known: '明', concealed: '暗' },
    status: { active: '活跃', retired: '背景', dead: '已灭' },
};

// leg25 c（用户令「删」）：`LABELS.attr` 与 `ATTR_HINTS` **整条删除**——四维浮点（兵力/权位/人脉/耳目）
//   不存在了：它们没法精确表示（书里没刻度、现实里也没有），压成 0–1 就是拿精确的外壳装模糊的内容，
//   而且手拍值让"编的"看起来像"算的"（design-core-leg23 §4 第 1 条）。
//   书里的说法一律**照抄成文本**显示（实体 `实力` = 「T9渡劫巅峰」，据书；见 spec-entity-field-lookup）。
//   面板从此不再有「有据 n/4 / 数值无据」这类说法——那些数没有了，"有几维有据"自然无从谈起。

// K41/链视图细案 §3.1（A-16）：编年五筛（chips 玩家词面 ↔ kind 契约 token）
export const CHRONICLE_FILTERS = Object.freeze([
    { token: 'scheme', label: '谋划' },
    { token: 'major', label: '大事' },
    { token: 'ripple', label: '牵动' },
    { token: 'shade', label: '暗处' },
    { token: 'state', label: '时局' },
]);

// 渲染产物黑名单（引擎术语不得出现在玩家视线）
export const BLACKLIST = [
    '分量', '熵泵', '里程碑', '上溯', '波及',
    // leg26：参数键本身（民生度/动乱度…）是**账本口径**，不是玩家词——面板一律走 LABELS.env
    //   （民生/乱象/天时/时局）。带上它们才能锁住"引擎键名不许漏进玩家视线"。
    '民生度', '动乱度', '张力推手', '异想天开键',
    'fingerprint', 'derivedFrom', 'intensity', 'polarity', 'direction', 'tension',
    'hardPower', 'office', 'network', 'intel', 'visibility', 'concealed',
    'schema', 'ssot', 'worldstep', 'agenda', 'chronicle', 'milestone', 'tick',
    // ★★leg52：**「派生源」补上**。`render.js:8` 的文件头注释从 leg26 起就写着"禁：…派生源…"，
    //   而数组里**只有英文 `derivedFrom`、没有这个中文词** ⇒ 设定页那句「浪尖（派生源）」印了十几棒
    //   都没被咬住（本仓判据只扫渲染产物，而它不在数组里就等于不存在）。
    //   ★这条同时是"注释与实现不一致"的实例：**声明禁的，数组里必须真有**（否则守门是空绿）。
    '派生源',
];

export function escapeHtml(s) {
    return String(s ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// ★leg40b（A5）：**进 title 的文案走这里**。
//   病是复发过三次的同一个：`escapeHtml` 把 `"` 转成 `&quot;` 之后，属性值在 HTML 层面是安全的，
//   但**源码里那个裸 `"` 仍然把模板字符串的 title 掐断**（`leg25 d` 那次、`leg25 f` 那次、本次体检又一处）。
//   治法是形态判据、不靠记性：凡是写进 `title="…"` 的文本，一律先过这一层——
//   它把半角引号**换成中文引号**（玩家读起来一样、源码里再也不可能截断），再交给 escapeHtml。
export const attrText = (s) => escapeHtml(String(s ?? '').replaceAll('"', '「').replaceAll("'", '『'));

export const fmtTick = (n) => `第${n}轮`;
export const fmtPct = (n) => `${Math.round((n ?? 0) * 100)}`;
// ★★★leg55：冷档阈值那两个数的显示口径（`src/storage.js` 的 `PROPOSED_LIMITS.bytes` 是**字节**，
//   面板印的是 MB ⇒ 换算只许住这一处，别在公式里再写一遍 `/1024/1024`）。
//   ① 值来自 `web/index.js` 的 `renderCfg()` 现读 `PROPOSED_LIMITS`（唯一真源）；
//   ② **缺值照样印字面量**——但那是**诚实**的：`render()` 的夹具/直调不经过接线层，
//      真源在那儿本来就不在手上；生产路有判据锁着必须注入（`test/render.test.js` leg55）。
//   ③ 整数不带小数点（`5MB` 而不是 `5.0MB`），非整数才留一位——两类阈值都不该被显示层改写。
export const fmtLimitNum = (n, fallback) => {
    if (typeof n !== 'number' || !Number.isFinite(n)) return String(fallback);
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

export function entityLabel(world, id) {
    if (id === world.context?.playerId) return '你';
    const e = world.entities.find((x) => x.id === id);
    return e ? e.name || id : id;
}

// ★leg49（细案 J11）：**玩家那一支已删**——旧版对玩家返回「你的棋子」，而三列版式里
//   玩家那一行靠「归属与来历 + 在办的事」自证（细案 §3.1：玩家标记不许搬回来）。
//   类别词只由 kind 决定（角色/势力），玩家与旁人同口径。
//   ★承重改动，已核过调用面：全仓只有实体页一处消费（kindLabel 的玩家支无人依赖）。
//   ★评审修正 #5：那唯一一处调用点仍按两参调用（`kindLabel(e, world)`）——签名早已只收 `entity`，
//     多传的第二参是改签名时的残留。已核全仓（src/web/test/docs）确无别处按两参调用，去掉那个实参。
export function kindLabel(entity) {
    return LABELS.kind[entity.kind] || '实体';
}

// 参数档位态（leg26）：未定 / 已定（档位原话）。**没有"危险/回缓"这种引擎判断**了——
//   档位是玩家/书定的世界设定，引擎只照抄摆放，不评价它好不好。
//   ★leg40b：`paramBand()` 已删——它零引用（现役是 `envRowHtml`），是 leg26 改造留下的一具壳。

function msIdTick(id) {
    const m = /m_(\d+)/.exec(String(id || ''));
    return m ? Number(m[1]) : 0;
}

// 浪尖项契约 浪尖:<id>@<tick>（K29 补遗）→ 盘算目标+轮（引擎 id 不透传）
function tideLabel(world, item) {
    const m = /浪尖:(\w+)@(\d+)/.exec(String(item || ''));
    if (!m) return escapeHtml(String(item));
    const a = (world.agendas || []).find((x) => x.id === m[1]);
    return a ? `${escapeHtml(a.goal)}（第${Number(m[2]) + 1}轮）` : escapeHtml(String(item));
}

const dotSteps = (progress, maxSteps) => {
    const n = Math.max(0, maxSteps || 0);
    let s = '';
    for (let i = 0; i < n; i += 1) s += `<span class="sw2-dotstep${i < progress ? ' on' : ''}"></span>`;
    return s;
};

// ============ 观棋页 ============

export function renderDigestHtml(world, { config = {} } = {}) {
    // leg26：参数档位是**世界输入**，不是引擎判出的"危险处境"——所以时局句不再由它拼"越界的处境"。
    //   档位只如实列出来（人话原话），引擎对它们**零表态**（不裁好壞、不排序、不换算）。
    // ★★leg52 登记、**leg53 一并收口**：这一句原来读 `paramsRows(world)`（＝**滞后镜像**，没走真源），
    //   是本仓"一个数两把尺子"的**第四个面**（前三个在 leg52 收口）。真账上当时看不出差异
    //   （民生/时局都是未定），但只要玩家真设了天时就会分叉。⇒ 现在也走 `resolveEnv`（与其余三个面同源）。
    // ★★leg53：同时只列 `PANEL_ENV_KEYS`（面板上真画的那几格）——民生撤了，时局句里也不该再报它。
    const env = resolveEnv(world, config.paramEnv);
    const rows = PANEL_ENV_KEYS.map((k) => ({ key: k, value: normalizeParam(k, env[k]) || PARAM_UNSET }));
    const setList = rows.filter((r) => r.value !== PARAM_UNSET).map((r) => `${LABELS.env[r.key]}${r.value}`);
    const unsetCount = rows.length - setList.length;

    const active = (world.agendas || []).filter((a) => !a.closed);
    const hidden = active.filter((a) => a.visibility === 'concealed').length;

    // leg20 世情路径恢复：抽象书级 situation 为时局句主句（原文措辞），拼装句降为无世情时的回退
    // leg21（用户指认）：时局句只领世情——张力（极/方向/强度）归「张力 · 结构性三件套」行，不再混进主句
    const sit = world.context?.setting?.frozen?.canon?.situation;
    const main = sit
        ? escapeHtml(sit)
        : '大势未聚，各方各走各的路';
    const sub = setList.length || active.length
        ? `${setList.length ? `参数：${escapeHtml(setList.join('、'))}${unsetCount ? `（另 ${unsetCount} 项未定）` : ''}。` : ''}各方正谋划 ${active.length} 件事${hidden ? `，其中 ${hidden} 件在暗处` : ''}。`
        : '眼下没有在办的谋划，也没有越界的处境。';
    return `<div class="sw2-digest"><div class="sw2-digest-line">${main}</div><div class="sw2-digest-sub">${sub}</div></div>`;
}

// 参数档位一行（信息带/设定页共用；leg26）：**档位是人话原话**，不是数——所以没有条、没有百分比。
//   未定就写「未定」+ 空心点（**不填占位值**；与"空着就是空着"同源）。
//   ★leg40b：这一行原来还画一条 `<i style="width:0%|100%">` 的"档位条"——**两态恒真**（有值就满格、
//   没值就 0），既不是比例也不是进度，只让玩家以为这里有个数。撤掉；"无据"那个小标保留（它是真事实）。
// ★★★leg56（用户令「根据挡位渲染不同长度的进度条」）：**分段档位条**回来了——但**不是** leg40b 撤掉的那条。
//   为什么它这回**不是**"两态恒真"（这条区别是本处存在的全部理由，改它之前先读这三句）：
//     · 撤掉的那条：`width: 0% | 100%` 两态 ⇒ 只有"有值/没值"两种长相，**信息量为 0**，纯装饰。
//     · 现在这条：点亮格数 = **该档位在它自己那张档位表里的序位**（`PARAM_GEARS` 是有序的，
//       从"最差"到"最好"排列 ⇒ 顺序本身就是语义）。三格真值 `动荡 3/4` · `大灾 1/4` · `暗涌 3/4`
//       会画出**三种不同长度** ⇒ 它承载的是真数据。
//   ★★为什么用**分段**而不是连续宽度（这条是设计决定，别当成审美）：三格并排时，连续条会被读成
//     "三个在同一把尺子上的量"——**而它们不是**：每格只是"我在我自己那张表里的第几档"，
//     档与档之间没有共同单位（"大灾"与"太平"谁更极端，**引擎不表态**）。
//     分段（4 格）让它**看起来就是刻度**，而不是一个可以互相比较的百分比。
//   ★不写百分数、不写数字（leg26 的红线："档位是人话原话，不是数"）——玩家读到的仍只有原话。
//   ★未定 ⇒ **空轨道**（不是满格、也不是不画）：与"空着就是空着"同源；文字照旧「未定」。
export function envRowHtml(key, value) {
    const v = typeof value === 'string' && value.trim() ? value.trim() : PARAM_UNSET;
    const unset = v === PARAM_UNSET;
    // 序位 = 档位表里的下标 +1；档位表里没有这个词（旧账/异体词）⇒ 0 = 不点亮（**不猜、不当第一档**）
    const gears = PARAM_GEARS[key] || [];
    const rank = unset ? 0 : gears.indexOf(v) + 1;   // 找不到 ⇒ indexOf -1 ⇒ rank 0
    return `<div class="sw2-env-row${unset ? ' sw2-nodata' : ''}">`
        + `<span class="sw2-env-name">${LABELS.env[key] || escapeHtml(key)}</span>`
        + gearBarHtml(rank, gears.length, unset)
        + `<span class="sw2-env-val">${escapeHtml(v)}${unset ? '<small class="sw2-nodata-tag">无据</small>' : ''}</span></div>`;
}

/**
 * 分段档位条：`lit` 格点亮、共 `total` 格。**纯展示、零语义**（序位由调用方算好）。
 * ★为什么 `total` 由调用方传（而不是在这里读 `PARAM_GEARS`）：本函数对"档位表"零知识 ⇒
 *   换个表（上限那一栏也想画）就能复用；也让判据能直接喂数字验边界，不必造世界。
 * ★`lit` 超出 `[0, total]` 一律**钳**（防御：旧账里的词换了表、表变短 ⇒ 不许画出 5/4 格）。
 */
export function gearBarHtml(lit, total, unset = false) {
    const n = Math.max(0, Math.min(Number(total) || 0, Math.round(Number(lit) || 0)));
    let cells = '';
    for (let i = 0; i < (Number(total) || 0); i++) cells += `<i${i < n ? ' class="on"' : ''}></i>`;
    // `aria-hidden`：这是**视觉冗余**（右边就有原话），读屏器读它只会念出一串空格 ⇒ 藏起来。
    //   `title`：鼠标停上去说清它是什么——★**不写百分比、不写数字**（leg26 红线）。
    return `<span class="sw2-gearbar${unset ? ' sw2-gearbar-unset' : ''}" aria-hidden="true"`
        + ` title="${attrText(unset ? '还没定：这一格空着' : `档位刻度：第 ${n} 档，共 ${total} 档`)}">${cells}</span>`;
}

/**
 * ★★★leg56：**把"这片面板该用哪几个上限"收进一处**——真源 > 账本镜像 > 出厂默认。
 *   病（用户实机截图逼出来的，本棒修的）：参数页那四个框明明写着 `10 / 12 / 30 / 40`，
 *   **同一个屏幕旁边**的「盘算」栏却印着 `9/20 · 顶层 9/15`——因为那一栏读的是 `AGENDA_CAPS`
 *   那组**编译期常量**（`settle.js` 从 `limits.js` 转出的出厂值，**永不随档位变**），
 *   而参数页读的是真源 ⇒ **同一时刻、同一屏，一个数两把尺子**（leg52 在"天时"上治过一次，这处漏了）。
 *   ★★它不只是观感问题：**引擎自己读的是 `resolveLimits(world)`**（真源已被镜像进账）
 *     ⇒ 真跑起来用的就是 10/12/30/40 —— **错的是面板，不是引擎**。
 *     不修的话玩家会以为"我设的没生效"（用户原话：「参数是这样但是盘算上限怎么还是这个数」）。
 * ★口径与 `LIMIT_ROWS` 的第二参**同一把尺子**：只有本表的键被接受，值要过 `normalizeLimit`
 *   （非法值退回默认、**不抛错**——照本仓"失败零阻塞"）。传进来的通常是 `cfg.paramEnv`
 *   （＝ `param-hub.displayEnv()`：真源 > 镜像 > 默认）。
 */
export function effectiveLimits(world, envOverride = null) {
    const out = { ...LIMIT_DEFAULTS };
    if (envOverride && typeof envOverride === 'object') {
        for (const k of LIMIT_KEYS) {
            if (!isLimitKeyOf(k)) continue;                 // 不是本表的键：不认（键白名单仍在）
            const v = normalizeLimit(k, envOverride[k]);
            if (v != null) out[k] = v;
        }
        return out;
    }
    // 没传真源 ⇒ 退回读**账上镜像**（与 `LIMIT_ROWS` 同一顺位：真源 > 镜像 > 默认）
    return { ...out, ...limitsOf(world) };
}

// ★★leg52（**修"一个数两把尺子"**）：把调用方注入的**参数真源**归一成"覆盖表"。
//   为什么要有这个函数（病因、先例、判据，逐条记档）：
//     · 参数真源住在插件配置区（`param-store.js`），世界账的 `dynamic.env` 只是**镜像**，
//       而镜像是"下一次落账"才追上的一份（leg41/leg46 的机理，见 `param-hub.js` 头）。
//     · leg48 把**参数页**治好了（`renderParamsHtml` 收 `cfg.paramEnv`），但**只治了这一个面**——
//       设定档案页（`renderSettingHtml`）与观棋信息带（`renderInfoBandHtml`）**至今读 `paramsOf(world)`＝镜像**。
//     · 现场读数（真账 tick 59 · 本棒实测）：同一时刻三个面画三个值——
//       参数页「天时 大灾」（读真源）· 设定页「天时 未定」（读镜像）· 信息带「天时 未定」（读镜像）。
//       ⇒ 玩家在参数页选了大灾，切到设定页/关掉面板再看就是"未定"，正是"改了回默认"的**观感层残留**。
//     · `param-hub.js` 的口径是「**"这一格该显示什么值"只在一处裁决**」⇒ 三个面必须同源。
//   ★为什么只挑 `isPlayerInputKey`（与 `param-hub.displayEnv` 的过滤**同一把尺子**）：
//     因变量（民生度/动乱度）是**世界的结果**、真源无权管辖（`param-store.js` 明写"永不被真源删/压"），
//     它们**只能**来自账上 ⇒ 绝不接受覆盖（否则玩家的一格旧值会反压世界刚写的值）。
//   ★没传 / 传空 / 传坏形状 ⇒ 一律返回 `null`（= 退回读账），**不抛错**（照本仓"失败零阻塞"）。
function paramEnvOverride(env) {
    if (!env || typeof env !== 'object') return null;
    const out = {};
    for (const [k, v] of Object.entries(env)) {
        if (!isPlayerInputKey(k)) continue;
        const n = normalizeStoreValue(k, v);
        if (typeof n === 'string') out[k] = n;
    }
    return out;
}

// 参数块解析（设定页/信息带**共用**）：真源覆盖优先 ⊕ 账上（镜像/书里抽的）。
//   ★同一件事只许有一份实现——旧版两个面各写一遍 `paramsOf(world)`，
//     于是 leg41/leg48 两次修"显示值该读哪本账"都**只修到一个面**（本仓"两处实现迟早分叉"的原样重演）。
function resolveEnv(world, envOverride = null) {
    const over = paramEnvOverride(envOverride);
    return over ? { ...paramsOf(world), ...over } : paramsOf(world);
}

// ★★leg52（用户令「说明文占 56.6% 太长」）：**长说明折叠**。
//   口径三条（缺一条就退回"玩家看不到结论"）：
//     ① **首句必须留在外面**——首句就是结论（本棒 leg51 §5 记过：我自己的演示第一版把整段藏进折叠里 ⇒ 玩家看不到结论）；
//     ② **后果话不折**——由调用方把后果句传成 `lead`（如总闸那句"现在：插件静默…"），它永远在外面；
//     ③ 折叠壳**默认收起**，但用 `<summary>` 让"还有说明"这件事**看得见**（不许藏成隐形的）。
//   ★为什么用原生 `<details>` 而不是自己写开关：零 JS、零接线（本仓接线面已经够挤了）、
//     且浏览器原生支持键盘与无障碍——面板其余部分不需要为此多一条 `data-action`。
function foldHint(lead, detail, { summary = '说明', cls = '' } = {}) {
    const head = lead ? `<div class="sw2-hint${cls ? ` ${cls}` : ''}">${lead}</div>` : '';
    const body = String(detail ?? '').trim();
    if (!body) return head;
    return head + `<details class="sw2-fold"><summary>${escapeHtml(summary)}</summary>`
        + `<div class="sw2-hint sw2-fold-body">${body}</div></details>`;
}

// ============ 参数页（leg26）============
// 世界参数 · 档位：**玩家在这里选**，引擎只摆出来（不读、不判断、不进任何机制）。
// 为什么独立一页（用户令「参数独开页签」）：它既不是"书里的设定"（设定页=只读原稿），
//   也不是"插件设置"（设置页=通道/存储）——它是**玩家对世界的输入**，性质不同，故独立。
export function renderParamsHtml(world, { config = {} } = {}) {
    const cfg = config || {};   // leg27 h：开关卡要挂"上次投递"的实测事实（渲染层不持状态，一律由调用方注入）
    // ★★leg41：参数**真源**在插件配置区（`web/index.js` 的 `sw2ParamEnv()`），世界账里的
    //   `dynamic.env` 只是**镜像**。面板必须画真源——画镜像就会出现"镜像还没同步 ⇒ 玩家看到旧值"
    //   那类"改了就回默认"的假象（这正是本笔要治的病，不能在显示层把它请回来）。
    //   口径：`cfg.paramEnv` 传了就用它；没传（判据/旧调用方）就退回读账（行为与 leg41 之前一致）。
    const rows = paramsRows(world, cfg.paramEnv);
    // ★leg40b：自变量/因变量不再各写一份过滤判据——`params.js` 的 `independentKeys/dependentKeys`
    //   本来就是**唯一真源**（此前那两个导出零引用，而这里自己又判了一遍 `r.nature`：同一个口径两份实现）。
    const rowsOf = (keys) => keys.map((k) => rows.find((r) => r.key === k)).filter(Boolean);
    const indep = rowsOf(independentKeys());
    // ★★leg53：因变量那一组也走 `PANEL_ENV_KEYS` 过滤 —— 民生那一格撤了，面板上就**不该再有它的行**
    //   （`dependentKeys()` 仍返回它俩：那是**账本口径**，不是"面板该画什么"）。
    const dep = rowsOf(dependentKeys().filter((k) => PANEL_ENV_KEYS.includes(k)));
    const setCount = rows.filter((r) => r.value !== PARAM_UNSET).length;

    // 自变量卡：**给旋钮**（玩家定，引擎照抄）
    // leg27 后：行 **按"值/控件"与"说明"分栏**——旧版把「当前 值」和「设定为 下拉」各占一行、
    //   每行还带一句说明 ⇒ 说明文字（14px 继承）把卡片撑得很丑（用户实机「说明文字太大」）。
    //   现在：当前值做成一行只读 facts 行（`sw2-row` 基础规则给三栏对齐），设定行只留 标签 + 控件 + 一句短语。
    const knob = (r) => {
        const opts = [`<option value="">未定</option>`]
            .concat(r.options.map((g) => `<option value="${escapeHtml(g)}"${g === r.value ? ' selected' : ''}>${escapeHtml(g)}</option>`));
        // ★leg40b（D2 重复说明）：原来还有一行 `可选：A / B / C / D`——**下拉里已经列出全部档位**，
        //   那是同一份清单的第二遍，只把卡片撑宽。撤掉；"引擎只照抄"这句留着（它说的是**这条通道的性质**，
        //   不是重复信息——玩家据此知道拧它不会让引擎替世界下判断）。
        // ★★leg40c 续（用户实机「只是展开下拉就弹『天时 → 未定』，点了还是改不了值」的真因）：
        //   **卡片壳上原来也挂着 `data-param`**。而事件委托的判据是 `e.target.closest('[data-action="set-param"]')`
        //   ——真实浏览器里 `input`/`change` 的 target 有时是 `<option>`（在 select **内部**），
        //   `closest` 从 option 往上找：select 没有 `data-action`（它只在"设定为"那行的 select 上，
        //   而 card 壳没有）⇒ **落到卡片壳这个 div 上** ⇒ 读 `div.value` = `undefined` ⇒ `String(undefined ?? '')` = `''`
        //   ⇒ 引擎收到的是**「未定」**，玩家点的那一档被丢掉（"点了还是改不了值"）。
        //   ⇒ 治本：**壳上不许再挂 `data-param`**（同一个键只许有一个归属者——本仓"一字段一义"）。
        //     选择器/判据一律认 `[data-action="set-param"]`，不再认 `[data-param]`。
        // ★★leg52（**并卡之后补回标签行** —— 真浏览器出图当场抓出来的回归，留档）：
        //   旧版四键各占**一张卡**，参数名（天时/时局）写在**卡头 `<h4>`** 里；并成一张卡之后卡头只剩
        //   「世界气氛与条件」，而这两行本身**从头到尾没提过参数名** ⇒ 出图一看是
        //   「当前 大灾 / 设定为 [大灾▾]」——**玩家不知道这一行是天时还是时局**。
        //   ⇒ 补一行 `.sw2-row.sw2-param-name` 当**组标题**（与因变量行的三格形态分工一致：
        //     这里的标题**独占一行**，因为下面还有"当前/设定为"两行要归它管）。
        //   ★判据 `leg52·C` 同步加一条"每个自变量都要有名字"（不然这种回归没人咬得住）。
        return `<div class="sw2-row sw2-param-name"><b>${LABELS.env[r.key] || escapeHtml(r.key)}</b></div>`
            + `<div class="sw2-row"><span>当前</span><b class="sw2-param-val" data-param-cell="${escapeHtml(r.key)}">${escapeHtml(r.value)}</b></div>`
            + `<div class="sw2-row"><span>设定为</span>`
            + `<select class="sw2-param-select" data-action="set-param" data-param="${escapeHtml(r.key)}">${opts.join('')}</select>`
            + `<em>引擎只照抄</em></div>`;
    };
    // ★★leg52（用户令「保留天时/时局的下拉，只把说明文字折叠、四键合并成一栏」）：
    //   `knob` 从"整张卡"降级成"卡里的一行"（**行内容一字未改**，只是不再各自包一张卡）。
    //   ★为什么能合并而**不损失任何能力**：这四行本来就是**同一性质**的（世界给定条件 + 世界结果），
    //     leg26 把它们拆成四张卡只是因为当时自变量各自要一句说明——而说明现在是折叠的。
    //     玩家的操作路径**完全没变**：天时/时局照旧是"设定为"下拉、民生/乱象照旧只读。
    //   ★为什么不做 leg51 原来那版"删下拉、只留只读氛围标签"：**那是有损**——
    //     真源实测 `天时 = 大灾`（玩家真的设过），删下拉＝玩家从此设不了天时。
    const knobRow = (r) => knob(r);
    // 因变量行：**不给旋钮**——只呈现（引擎算出来的档位，或空着写「未定」）
    // ★leg52：这一行是**三格**（名称 / 值 / 依据），与 `knobRow` 的两行式（当前 / 设定为）不同形，
    //   故**不合并**——照本仓纪律"同一个键只许有一个归属者"，宁可两行形态并存，也不把只读格塞进
    //   "设定为"那一行（那会让玩家以为它也有旋钮，正是 leg26 立"因变量不给旋钮"要防的误读）。
    // ★★★leg53：**「依据」那一格必须说实话**——它说的是**这个值从哪来**，三种来路分别报：
    //     · `动乱度` ⇒ **引擎每轮算的**（`src/unrest.js`：近 10 轮出事铺到几个不同地点）；
    //     · 其余因变量 ⇒ 书里抽到的原话 / 没写就空着。
    //   ★为什么这一格不能糊弄：本棒之前它写死「书里原话」，而真账上那个 `动荡` 是抽书来的、
    //     引擎从不算它 ⇒ 一句"书里原话"就把"这一格其实没生产者"这件事盖住了（用户正是这么发现的）。
    const readout = (r) => `<div class="sw2-row">`
        + `<span>${LABELS.env[r.key] || escapeHtml(r.key)} <span class="sw2-param-kind sw2-param-kind-dep">因变量</span></span>`
        + `<b class="sw2-param-val" data-param-cell="${escapeHtml(r.key)}">${escapeHtml(r.value)}</b>`
        + `<em>${r.value === PARAM_UNSET ? '还没有据 ⇒ 空着' : (ENGINE_DERIVED_ENV.includes(r.key) ? '引擎每轮算的' : '书里原话')}</em></div>`;

    // 开关类参数（写记忆 / 记编年史书）——同一页、同一条写通道，渲染成开关而不是下拉
    // leg27 h：开关卡下面挂**上次投递的实测事实**（用户两次靠肉眼发现记忆没生效 ⇒ 必须有自证面）。
    //   口径：只报事实、不报"应该没问题"；没投过（null）只显示"还没投过"，绝不显示"已投"。
    const memPush = cfg.memoryPush || null;
    const pushLine = (key) => {
        if (key !== 'memoryEnabled') return '';
        if (!memPush) return '<em>还没投过（推一轮后这里会显示「记忆已投 · 第 N 轮」）</em>';
        return memPush.ok
            // ★leg30：删掉「史卷 N 段」——那张表已不存在（前史成了「世界大事」里成段的行），
            //   留着它只会恒显示"史卷 0 段"，那是**假的自证面**（本仓对假绿的态度：宁可少报一行）。
            ? `<em>上次投递：记忆已投 · ${escapeHtml(String(memPush.tick || '?'))} · 大事 ${Number(memPush.counts?.['世界大事'] ?? 0)} 条</em>`
            : `<em style="color:#e0a0a0">上次投递失败：${escapeHtml(String(memPush.reason || '未知原因'))}</em>`;
    };
    // ★leg33d（用户令「加一个启动和关闭插件的入口，要不然这个插件会直接自动生效」）：
    //   `master: true` 的那个开关（插件总闸）**排在最前、单独一张卡**——其余开关管"插件对外的动作"，
    //   它管"插件自己"，混在两张开关卡中间会让用户找不到。
    //   ★并且它带一句**当前后果**（不是"应该没问题"，是"关掉之后会发生什么"）——照 leg27 h 的自证面口径。
    const switchEntries = Object.entries(SWITCH_PARAMS)
        .sort((a, b) => Number(Boolean(b[1].master)) - Number(Boolean(a[1].master)));
    const switches = switchEntries.map(([key, conf]) => {
        const on = switchOn(world, key);
        const stateLine = key === 'autoAdvance'
            ? (on
                ? '<em>现在：发消息会自动推进世界（每收到一条消息推进一轮）</em>'
                : '<em style="color:#e0a0a0">现在：插件静默 —— 发消息不推进、切聊天不自动载入；要推请按观棋窗口的「推进一轮」</em>')
            : pushLine(key);
        return `<div class="sw2-set-card sw2-actions-inline${conf.master ? ' sw2-master-switch' : ''}">`
            + `<h4 style="flex:1;margin:0">${escapeHtml(conf.label)}${conf.master ? ' <span class="sw2-param-kind">总闸</span>' : ''}</h4>`
            + `<b class="sw2-param-val" data-param-cell="${escapeHtml(key)}">${on ? '开' : '关'}</b>`
            + `<span class="sw2-actions">`
            + `<button class="sw2-btn${on ? ' sw2-primary' : ''}" data-action="set-param" data-param="${escapeHtml(key)}" data-value="1">开</button>`
            + `<button class="sw2-btn${on ? '' : ' sw2-primary'}" data-action="set-param" data-param="${escapeHtml(key)}" data-value="0">关</button>`
            + `</span>${stateLine}</div>`;
    }).join('');

    // ★leg40b 续（**尺度上限参数化**·用户令「能不能直接把这些闸门参数直接放进参数页？」→ 拍板"甲+乙档全开"）：
    //   这一栏从**只读呈现**升级为**四个档位旋钮**（`每轮递线`/`每轮事件`/`顶层大计`/`在飞大计`）。
    //
    //   ★★**为什么旧的三条反对意见现在不成立了**（原文留在 `LEDGER.md` 与本模块历次台账里，不删）：
    //     ①「白名单只认档位词、裸整数进不了 `dynamic.env`」——**已解决**：`limits.js` 另立了一张
    //       **数字档位白名单**（值仍以字符串存 `dynamic.env`），归一/弃键口径与 `params.js` 逐条相同；
    //     ②「`dynamic.env` 是描述层、不该放引擎参数」——**口径已改**：本仓 leg26 立的规矩是
    //       "**因变量不给旋钮**"（民生的值由世界决定，拧它＝面板假装能改结果），而这四个**不是因变量**：
    //       它们是"这个世界允许跑多宽"的**尺度输入**（与自变量的性质一致）⇒ 给旋钮不违那条禁令；
    //     ③「引擎不读这些档位做判断」——**这一条仍然成立、且仍然必须成立**：`params.js` 的档位
    //       （天时/张力推手）依旧**不参与任何判断**；而本栏这四个**就是判据本身**，所以它们**不进 `PARAM_KEYS`**，
    //       走 `limits.js` 自己的表——两张表分开，正是为了不让第 ③ 条被悄悄破坏。
    //   ★**它的风险与边界（写在面板上，不藏）**：上调后"同时最多几件大计"会先见底（实测：请求=6 时六轮咬 4 次）；
    //     且真账从没跑过 20/30 这些档 ⇒ 面板如实把它标成"超出常用范围"，不假装有保证。
    // ★呈现纪律不变：档位**只报数**（不是"应该没问题"），改完下一轮生效。
    const limitRows = LIMIT_ROWS(world, cfg.paramEnv);
    // ★★★leg54（用户令「**把调数字的框直接变成输入框或者无上限**」→ 拍板「真无上限：输入框 + 只验 ≥1 的整数」）：
    //   旧版是 `<select>`（**只能点白名单里那三档**，顶格只有 9/12/30/40）。
    //   ⇒ 改成 `<input type="number" min="1" step="1">`：键盘直接敲，**认任意 ≥1 的整数**。
    //   ★为什么无上限是安全的（本笔核过数字，用户说得对）：
    //     单轮输出预算 **16384 token**、一条事件约 120–200 字符 ⇒ 预算够写**几十条**；
    //     而 leg40b 实测 59 轮真账**逐轮新事件 max 4** ⇒ **那个"12"从来没咬到过模型，它只是一张纸**。
    //     真正的边界是"模型一次能写多长"——撤掉白名单就是**把边界还回它本来该在的地方**。
    //   ★`suggest` 那串是**建议值**（`LIMIT_GEARS` 降级为建议）：玩家不知道该填几，给他三个常用档；
    //     它**不再是白名单**（填别的照收）。
    const limitKnob = (r) => `<div class="sw2-row" data-limit="${escapeHtml(r.key)}"><span>${escapeHtml(r.meta.label)}</span>`
        // ★接线面**不用改**：`web/index.js` 的 `set-param` 是从 `closest('[data-action="set-param"]')` 上读
        //   `.value` 的（`<select>` 与 `<input>` 都有 `.value`）⇒ 换控件类型不碰事件委托。
        + `<input class="sw2-param-input" type="number" min="1" step="1" inputmode="numeric"`
        + ` data-action="set-param" data-param="${escapeHtml(r.key)}" value="${escapeHtml(String(r.value))}"`
        + ` title="${attrText(`填任意 ≥1 的整数；建议 ${r.options.join(' / ')}`)}">`
        // ★★★leg46 续·十（用户第五次实机「我改了值旁边直接变成未定」）：**这一格不再画「默认」小标**。
        //   两次教训叠起来：①小标只在"真源里没这个键"时出现，而那一刻控件上往往还留着玩家刚选的值
        //   ⇒ 同一行里"控件 12 / 格 6默认"，**看起来就是"我的改动没生效"**；②它把"这格是不是你定的"
        //   塞进了玩家读不懂的位置。⇒ 这一格**只显示值**，由 `web/index.js` 的 `sw2SetParamCell`
        //   按**同一行的控件**对齐（控件是 12，格就是 12）；"出厂默认是多少/设没设过"交给自检卡说。
        + `<b class="sw2-param-val" data-param-cell="${escapeHtml(r.key)}">${escapeHtml(String(r.value))}</b>`
        + `<em class="sw2-limit-suggest">常用：${r.options.map((g) => escapeHtml(String(g))).join(' / ')}</em></div>`;
    //   读法（★leg52 改成"结论在外、长说明折起"）：总说明首句 + 四行旋钮 + 两条折叠说明。
    const capCard = `<div class="sw2-set-card sw2-cap-card" style="grid-column:1/-1">`
        + `<h4>世界尺度 · 可调上限</h4>`
        // ★leg40c 续：这一栏也挂**构建号**（原来只有"角色与势力"页头有）。为什么必须挂在这里：
        //   用户实机报"点了下拉值不改"时，第一件要能当场分清的事是——**页面到底是不是新代码**。
        //   构建号不在这页上，就只能靠猜（本仓老坑：改了代码但浏览器吃旧 index.js）。
        //   ★leg52：构建号**不折**（它是排障用的，折起来就等于没有）。
        + `<div class="sw2-hint" style="margin-bottom:8px">构建 <b>${escapeHtml(PANEL_BUILD)}</b> —— 若这里不是最新那串，请 <b>Ctrl+F5</b>（浏览器缓存了旧面板）。</div>`
        + foldHint('这一栏决定<b>这个世界允许跑多宽</b>；改完<b>下一轮生效</b>（已落账的账不回改）。'
            + '七个框都能<b>直接填数</b>——没有上限，填多少就是多少。',
            '出厂默认就是现在这几个数。这几个上限之间会互相掩盖，一次只调一个才看得出是哪一个在起作用。'
            // ★★leg63：**把"互相掩盖"讲成人话**（用户当场问「这个会相互掩盖是什么意思」）——
            //   过去只丢一句术语，玩家没法据此行动。真正的机理是"三道盘算闸按序判、先顶住的那道说了算"。
            + '<br>具体是这么回事：一轮里能新起几件大计，要同时过三道——'
            + '<b>每轮最多新起几件大计</b>（先判）→ <b>同时最多几件大计</b> → <b>同时在办总数上限</b>。'
            + '三道是<b>依次</b>判的，最先顶住的那道决定"这轮拒了几件"，后面的根本没轮到。'
            + '所以只抬后面那道、前面那道没抬 ⇒ 数字变了但<b>看不出任何变化</b>，这就是"互相掩盖"。'            + '<br>★实机例子（leg63 用户报的）：把「每轮递几条线」抬到 10、模型真提了 10 条，'
            + '但「每轮最多新起几件大计」还是出厂 3 ⇒ 第 4 条起全被拒，'
            + '观棋窗口只报"被拒"、不说"是哪个数拒的"，看起来就像"参数白调了"。'
            + '⇒ 想让一轮里真的多长几件事，<b>「每轮递几条线」与「每轮最多新起几件大计」要一起抬</b>。'
            // ★★★leg57（**由实测支撑，不是推理**——13 次真调用，见 `docs/measure-leg57-event-cap-ceiling.md`）：
            //   · `每轮事件` 设 12 / 30 / 50，模型都只写 **3–11 件**、`finish_reason` 全是 `stop`
            //     ⇒ **它是上限、不是产量旋钮**（设大了不会变多）；
            //   · 固定它、只把 `每轮递线` 从 10 降到 3 ⇒ 落账从 **11 件降到 5/5/5**（三轮稳定）。
            //   ⇒ 真正决定"一轮长几件事"的是 **每轮递线**（给模型几条线要走，它就写几件事）。
            //   ★为什么必须告诉玩家：不写这一句，玩家会以为"每轮事件"才是那个旋钮，
            //     于是一直拧它、一直看不出变化（正是本仓反复治的那类"静默无效"体验）。
            + '<br>☆ 而「每轮最多几件事件」<b>不是产量旋钮</b>：实测填 30、50 也一样（模型自己只写几件），'
            + '真正决定"一轮长几件事"的是<b>「每轮递几条线」</b>——给模型几条线要走，它就写几件事。'
            // ★★leg54：这一句是**如实告知**，不是限制（用户令「无上限」）——
            //   真正的边界在模型那一边，玩家必须知道"填大了会以什么形式表现出来"，
            //   否则他会以为"填 100 却只长了 3 件"是插件坏了。
            + '<br>还有一件事得先说清：这几个数<b>不是</b>"填多少就长多少"。'
            + '模型一轮只写得出那么多，超出的部分你看不到"被拦"，只会看到"这轮没长出新事"——'
            + '要查就翻观棋窗口底部的「⚖ 本轮裁定 N 条」。',
            { summary: '改这些数要注意什么' })
        + limitRows.map(limitKnob).join('')
        + foldHint('',
            limitRows.map((r) => `<b>${escapeHtml(r.meta.label)}</b>：${escapeHtml(r.meta.hint)}`).join('<br>'),
            { summary: '每个上限各是什么意思' })
        // ★★★leg63（用户令「我要把另外两个参数也设置成可调」）：原来这里还有一折
        //   「还有两个数不给拧（每轮入局新人 ≤1 · 每轮递几张待启用名单 12）」——
        //   那两个**已经给了旋钮**（`limits.js` 的 `每轮入局`/`待启用名单`）
        //   ⇒ 这一折整段撤掉：**这一栏现在七个框全是可调的**，没有"不给拧"的数了。
        //   （留一条空折会说反话，比不写更坏——本仓"面板替机制承诺一个它没写死的数"那类病。）
        + `</div>`;

    // ★★leg52（用户令「**推进和撤销不应该放到参数页吧**」→ 拍板「推进撤、撤销留并上移」）：
    //   **「推进」卡整段撤掉**（旧 `advanceCard`，原文留在 git 历史与本行记档里）。
    //   病（leg51 §2.1 取证，用户这条成立）：`data-action="advance-world"` 在**设置页也有一枚**
    //     （`render.js` 的 `renderSettingsHtml`），⇒ 参数页这一枚是**重复入口**。
    //     leg40b 把它挪过来的理由是"这一页就是你对世界的输入"——**而"推进一轮"不是输入，是动作**
    //     （它一个档位都不写）。⇒ 撤这一处，**设置页那枚保留**（入口一个不少）。
    //   ★判据注意（`test/lookup-batch.test.js:403` 那条"画了按钮就必须有人接"仍会咬）：
    //     `advance-world` **仍在设置页画**，且它的处理器在 `web/index.js` 的 `dispatchAction` 特判里
    //     ⇒ **处理器一个字节都不许删**，本棒只删参数页这一处。
    //
    //   **「撤销」卡留下并上移**：它的作用域**只覆盖这一页的编辑**（档位/开关/上限，`undo-stack.js`）
    //     ⇒ 挪到设置页会出现"在设置页撤销参数改动"的错位；上移到**紧贴被撤销的那批控件之后**
    //     （世界气氛与条件 → 撤销），玩家拧错了就地能退，不必先翻过开关与世界尺度两张卡。
    const undoState = cfg.paramUndo && typeof cfg.paramUndo === 'object' ? cfg.paramUndo : null;
    const undoCount = Number(undoState?.count) || 0;
    const undoCard = `<div class="sw2-set-card" style="grid-column:1/-1"><h4>撤销</h4>`
        + `<div class="sw2-actions"><button class="sw2-btn" data-action="param-undo"${undoCount ? '' : ' disabled'}>`
        + `↶ 撤销上一次改动${undoCount ? `（可退 ${undoCount} 步）` : '（暂无可撤销的改动）'}</button></div>`
        + foldHint('每次改动档位/开关/上限都会记一步。',
            '这一步改的是<b>你选的档位</b>，不改世界已经发生的事；撤销栈活在内存里，换聊天/刷新即清空。',
            { summary: '撤销的范围' })
        + `</div>`;

    // ★★leg52（用户令「四键合并成一栏 · 只把说明文字折叠」）：**世界气氛与条件**一张卡装下这几格。
    // ★★★leg53（用户令「民生那一格拿掉」+「乱象接成真的」）：这一卡从**四格变三格**，且**性质说清了**：
    //     ① **天时 / 时局** = 你定的条件（自变量，有旋钮）；
    //     ② **乱象** = **引擎每轮从账上真发生的事算出来的**（因变量，只读）——
    //        这是本棒新接的**生产者**（`src/unrest.js`）：近 10 轮里"出事"铺开到几个**不同地点** ⇒ 四档。
    //        ★旧文案写「乱象是书里写的原话」——**在 leg53 之前就有一半是错的**（真账里那个 `动荡` 确实是
    //        书里抽的，但"书里原话"这个说法会让人以为它永远来自书）；现在**两个来源都要说**：
    //        载入时书里抽到的那个会被引擎的读数**接上并覆盖**（用户拍板「引擎每轮算、覆盖书里那个」）。
    //     ③ **民生** 已从面板撤下（它**没有生产者**，永远「未定」——见 `params.js` 的 `PANEL_ENV_KEYS`）。
    //   ★与 `capCard` 的**世界尺度**分开成两张卡，不是重复：这一卡是**世界的样子**（书/玩家给的描述
    //     性条件 + 引擎从账上派生的读数），那一卡是**世界能跑多宽**（就是引擎的闸值本身）——性质不同。
    const atmoCard = `<div class="sw2-set-card sw2-atmo-card" style="grid-column:1/-1">`
        + `<h4>世界气氛与条件</h4>`
        + foldHint('这一栏是<b>世界的样子</b>，不是世界的开关。',
            '<b>天时 / 时局</b>是你定的条件（引擎照抄摆放，<b>不参与任何判断</b>）。'
            // ★★★leg55（leg54 §6.4 的第二处）：这里原写死「看近 **10** 轮里…」，而**机制本身**是
            //   `src/unrest.js` 的「乱象档位 = 近 `TENSION_WINDOW` 轮里"出事"铺开到几个不同地点」
            //   （`UNREST_WINDOW = TENSION_WINDOW`）⇒ 面板在**替机制承诺一个它没写死的数**：
            //   `TENSION_WINDOW` 一改（它是"定案"值，改它要报批），这句说明就变成谎话，而**代码照旧是对的**
            //   ——正是 leg54 那个 4096 的同一种病（**UI 比代码先过期**）。
            //   ★同一文件里 `TENSION_WINDOW` 已被现读三处（`:649`/`:1540`/`:1541`）⇒ 本处只是漏网那处。
            + `<b>乱象</b>是<b>引擎每轮算的</b>：看近 ${TENSION_WINDOW} 轮里"出事"铺到了几个<b>不同的地点</b>——`
            + '地点越散、档位越重；同一个地方出十件事，也只算一个地点。'
            + '它不发明事实：只从账上已经落账的事里数，一个字都不添。'
            + '世界变宽变窄是下面那张「世界尺度」的事，与这一栏无关。',
            { summary: '这几格分别是什么' })
        + indep.map(knobRow).join('')
        + dep.map(readout).join('')
        + `</div>`;

    // ★★★leg48（用户令「把自检也删了，参数页签的」·「不要在参数界面出现」）：**这一页不再印自检读数**。
    //   沿革（留档，免得下一任又把它请回来）：
    //     leg46 续把"取证"摆上这一页（读数 + 「🔍 复制自检」按钮），理由是"玩家不开控制台"；
    //     而 leg48 修这条症状时，**第一步正是靠用户贴来的那份自检读数**（`写入次数 = 0` 那一格）。
    //   ⇒ 结论：**取证能力保留，但不再占这一页**——`gatherParamEvidence()/paramEvidenceText()` 与
    //     `bus['param-doctor']` 都还在（要取证时从控制台/内部动作取），界面**一个字节都不印**。
    //     ★别再往这一页加"读数栏"：这一页是**玩家调档位的地方**，不是维护者的仪表盘。
    return `<div class="sw2-sv-head"><div><div class="sw2-sv-title">世界参数 · 档位</div>`
        // ★leg52：这一句原来只提"自变量/因变量"两类——而**世界尺度那四个上限也是能拧的**，
        //   旧措辞会让玩家以为"能拧的只有天时/时局"（一个数两把尺子的文案版）。改成三类并列。
        + `<div class="sw2-sv-sub">能拧的只有两处：<b>世界气氛与条件</b>里的<b>天时 / 时局</b>（给定的条件，你定），`
        + `以及<b>世界尺度</b>那四个上限（这个世界允许跑多宽）。其余都是<b>只读呈现</b>。</div></div>`
        + `<div class="sw2-sv-cards"><span class="sw2-sv-chip ${setCount ? 'ok' : 'stale'}">${setCount}/${rows.length} 已定</span></div></div>`
        + `<div class="sw2-sv-grid">`
        + atmoCard
        + undoCard
        + switches
        + capCard
        + `</div>`
        // ★leg52：这一段旧文案与 `atmoCard` 折叠里的解释**说的是同一件事**（"因变量只呈现/绝不冒充"），
        //   两处都说＝同一事实说两遍（正是本棒在观棋页治的病）⇒ 收进卡内折叠，页脚这一段撤掉。
        // ★★★leg53：措辞必须**收窄**——旧句是"档位只被引擎照抄摆放，不参与任何判断"，
        //   而现在 **乱象是引擎每轮算出来的**（`src/unrest.js`）⇒ 那句对乱象不成立了。
        //   ⇒ 定稿：分两句说清**三种性质**（你定的条件 / 引擎每轮算的 / 都是只读呈现），
        //     而不是用一句"档位……"把它们糊在一起（那正是本棒要治的"一个词盖住两件事"）。
        + `<div class="sw2-sv-sub" style="margin-top:10px"><b>天时 / 时局</b>是你定的条件，引擎照抄摆放、`
        + `<b>不参与任何判断</b>；<b>乱象</b>是引擎每轮从账上真发生的事算出来的读数。`
        + `两个都不改世界的走向——走向由世界上正在发生的事决定，不由这几个词决定。</div>`;
}

export function renderInfoBandHtml(world, { config = {} } = {}) {
    const dyn = world.context?.setting?.dynamic;
    // ★★leg52：**读真源，不读镜像**（`cfg.paramEnv` = `param-hub.displayEnv()` 那一份）——
    //   旧版这一行是 `paramsOf(world)`（＝账上镜像，滞后一拍）⇒ 玩家在参数页把天时选成「大灾」，
    //   这一带照样画「未定」，而参数页画「大灾」：**同一时刻一个数两把尺子**（现场读数见 `paramEnvOverride` 记档）。
    const env = resolveEnv(world, config.paramEnv);
    const pre = !world.meta || world.meta.tick === 0;   // leg21：未演化态诚实标注（基线值非事实值）
    const baselineHint = pre ? ' <span class="sw2-baseline-hint">基线值 · 首轮后随世界演化</span>' : '';
    // leg26：参数档位 = 玩家/书定的**档位原话**；没定的显示「未定」（不填占位值）
    // ★★leg53：改走 `PANEL_ENV_KEYS` —— 面板**不再画民生那一格**（用户令「拿掉」；理由见 `params.js`）。
    const envRows = PANEL_ENV_KEYS.map((k) => envRowHtml(k, env[k]));
    const t = dyn?.tension || {};
    const tides = (dyn?.derivedFrom || []).slice(-3).reverse().map((x) => tideLabel(world, x));
    const counts = {
        active: (world.agendas || []).filter((a) => !a.closed).length,
        hidden: (world.agendas || []).filter((a) => !a.closed && a.visibility === 'concealed').length,
        top: (world.agendas || []).filter((a) => !a.closed && !a.parentId).length,
    };
    // ★★★leg56：**盘算上限读真源**（不再是 `AGENDA_CAPS` 那组编译期常量）——病因见 `effectiveLimits`。
    //   ★这里**只用 `在飞大计` / `顶层大计`** 两格：它们正是这一栏印的两个分母。
    //     `每轮递线`/`每轮事件` 不在这栏（它们在参数页/引擎各管各的）。
    const lim = effectiveLimits(world, config.paramEnv);
    // K46（细案 C4）+ leg21（用户指认）：大势行 = 真·天下大势一句（世情句领；无世情=未聚——张力不再混入）；
    // 张力行 = 结构性张力三件套独立成行（极/方向/强度带词全部归此行）
    // leg25 b（A1b）：原为「低/中/高烈度 + 百分比」。实测 rival 腿恒为满值 ⇒ 那个 % 实际只反映**事件密度**，
    //   而「烈度」这个词在暗示"引擎判断了天下张力"——它没做到。改为直说可验证的事实：近 10 轮事件几件。
    //   强度数字仍在（setting 页摆原值，且照旧喂模型），只是不再用带词包装它。
    const recentEvents = recentEventCount(world);
    const sit = world.context?.setting?.frozen?.canon?.situation;   // leg20：世情句领大势行（原文措辞）
    // ★★leg52（用户令「**大势就放大势，浪尖就放浪尖**」）：大势行末尾那句「浪尖：…」**撤掉**。
    //   病因（leg51 §3 取证 + 本棒复核）：`tides` 这一份数据在这一屏里**画了两遍**——
    //   ① 大势行末尾 `tides.slice(0,2)`（这一行）② 下面独立一栏「浪尖 · 刚收尾的大动作」`tides.map(...)`。
    //   信息带可见字符只有 280，「浪尖」两处合计约占**四分之一**，而两处**同源同值**（第二处还多一条）。
    //   ⇒ 照 R2「同一事实不许说两遍」**只留一处**：留**独立那一栏**（它信息更全：3 条 vs 2 条，且有分组标题）。
    //   ★为什么不是"腾给世情 / 换成别的话"：世情句**已经在大势行行首**了（`sit` 那一支）——
    //     再补一句就是**新的重复**。大势行留它自己那一个事实，正是用户这句令的字面意思。
    //   ★这一处撤掉**零信息损失**：被撤的两条 `tides.slice(0,2)` 是独立栏 `tides.slice(0,3)` 的前缀子集。
    const trend = sit ? `${escapeHtml(sit)}。` : '大势未聚（无主张力）。';
    return `<div class="sw2-infoband">`
        + `<div class="sw2-band-block"><div class="sw2-band-label">世情 · ${PANEL_ENV_KEYS.length} 键${baselineHint}</div><div class="sw2-env">${envRows.join('')}</div></div>`
        + `<div class="sw2-band-block"><div class="sw2-band-label">大势</div><div class="sw2-trend">${trend}</div></div>`
        + `<div class="sw2-band-block"><div class="sw2-band-label">张力 · 结构性三件套</div>`
        + `<div class="sw2-clash-main">${escapeHtml(t.polarity || '未聚')}<small class="sw2-quiet-note">近${TENSION_WINDOW}轮事件 ${recentEvents} 件</small></div>`
        + `<div class="sw2-clash-sub">${escapeHtml(t.direction ? t.direction + '（原文方向）' : '僵持（无明确方向）')}</div></div>`
        + `<div class="sw2-band-block"><div class="sw2-band-label">浪尖 · 刚收尾的大动作</div><div class="sw2-tides">${tides.map((x) => `<div class="sw2-tide">${x}</div>`).join('')}</div></div>`
        + `<div class="sw2-band-block"><div class="sw2-band-label">盘算</div>`
        // ★leg32：两个分母一律读引擎真源（旧版写死 `/15` `/5` ⇒ 引擎改了面板不变，见文件头 import 注释）
        + `<div class="sw2-big-num">${counts.active}<small>/${lim.在飞大计}</small></div>`
        + `<div class="sw2-num-sub">${counts.hidden ? `${counts.hidden} 件在暗处 · ` : ''}顶层 ${counts.top}/${lim.顶层大计}</div></div>`
        + `</div>`;
}

export function renderAgendaStripHtml(world) {
    const active = (world.agendas || []).filter((a) => !a.closed);
    const cards = active.map((a) => `<div class="sw2-agenda-card${a.visibility === 'concealed' ? ' sw2-agenda-hidden' : ''}">`
        + `<div class="sw2-ahead"><span class="sw2-aowner">${escapeHtml(entityLabel(world, a.owner))}</span>`
        + `<span class="sw2-visible ${a.visibility === 'concealed' ? 'v-hidden' : 'v-known'}">${LABELS.visibility[a.visibility] || '明'}</span></div>`
        + `<div class="sw2-agoal">${escapeHtml(a.goal)}</div>`
        + `<div class="sw2-astage">${escapeHtml(a.stage || '谋划中')}`
        + `<span class="sw2-aprog">${dotSteps(a.progress ?? 0, a.maxSteps)}</span>`
        + `<span class="sw2-asteps">${a.progress ?? 0}/${a.maxSteps ?? 0}</span></div></div>`);
    if (!cards.length) {
        cards.push('<div class="sw2-agenda-empty">眼下没有在办的谋划。</div>');
    }
    return `<div class="sw2-agenda-strip"><div class="sw2-col-head">各方盘算 · 总览</div><div class="sw2-agenda-cards">${cards.join('')}</div></div>`;
}

export function renderFeedHtml(world, { limit = 8 } = {}) {
    const chronicle = world.chronicle || [];
    // K38（敲定稿 I 条）：拒签可见——最近一轮的裁定/校验拒绝在动态流顶部露头（世界的重力，应当众；
    // 双面无痕的静默滤除仍不可见；钳制行保留显示但不占拒签计数——口径见 settle rejected 计算）
    const last = (world.meta?.simLog || []).slice(-1)[0];
    const verdicts = (last?.warnings || []).filter((w) => (
        w.startsWith('裁定:') || w.startsWith('校验拒绝:')
    ));
    const verdictBlock = verdicts.length
        ? `<div class="sw2-verdict"><span class="sw2-verdict-tag">⚖ 本轮裁定 ${verdicts.length} 条</span>${escapeHtml(verdicts[0])}</div>`
        : '';
    const rows = chronicle.slice(-limit).reverse().map((c, i) => {
        const latest = i === 0 && c.tick === world.meta?.tick;
        return `<div class="sw2-entry${latest ? ' sw2-latest' : ''}">${latest ? '<span class="sw2-now">最新</span>' : ''}`
            + `<div class="sw2-ctext">${escapeHtml(c.text)}</div>`
            + `<div class="sw2-cmeta"><span class="sw2-round">${fmtTick(c.tick)}</span>`
            + (c.eventRef ? `<span class="sw2-ref" title="${escapeHtml(c.eventRef)}">？</span>` : '')
            + `</div></div>`;
    });
    let note = '';
    const ms = world.milestones || [];
    if (ms.length) {
        const last = ms.reduce((a, b) => (msIdTick(b.id) > msIdTick(a.id) ? b : a));
        const titles = Array.isArray(last.titles) ? last.titles : (last.title ? [last.title] : []);
        note = `<div class="sw2-milestone-strip">⚑ 更早的 <b>第 1–${msIdTick(last.id)} 轮</b>已收进大事纪「${escapeHtml(titles.slice(0, 3).join('、'))}」<span class="sw2-goto" data-view="archive">去翻旧账 →</span></div>`;
    }
    return `<div class="sw2-col-head">动态流 · 最新在上</div>${verdictBlock}<div class="sw2-feed">${rows.join('')}${note}</div>`;
}

export function renderSideHtml(world) {
    const playerId = world.context?.playerId;
    const ef = world.meta?.entityFields || {};
    const active = (world.entities || []).filter((e) => !e.status || e.status === 'active');
    const real = (v) => typeof v === 'string' && v.trim() && v !== '未明';
    const sorted = [...active].sort((a, b) => String(a.name).localeCompare(String(b.name)));

    // ★leg25 f 版式重做（用户拍板「位置就先这样定了」）：
    //   旧版把**每个实体渲染成一张卡**（真账实测 563 张 / HTML 231 KB），位置只是卡片右上角一个词—— 
    //   于是"谁跟谁在一处"这个世界里唯一的空间结构**根本看不出来**，位置形同装饰。
    //   新版改为**按处聚合**（位置当分组键用起来），并且**两筐都摆**：
    //     ①有处可循：按地点分组（组头写"几处 / 几人"，组内按名号序列出）
    //     ②位置未载：单列一筐（如实说"书里没写"，并区分"知道归属但不知驻地"与"孤儿"）
    //   纪律（用户 2026-09-11 定的交互口径，别改回聚合式筛选）：**未载 ≠ 在别处**，
    //   分筐只是呈现，"能否相遇"归模型（引擎对两个实体能否交互零表态）。所以未载永远单列存在，不被挤掉。
    const byLoc = new Map();
    const unknown = [];
    for (const e of sorted) {
        if (!real(e.location)) { unknown.push(e); continue; }
        if (!byLoc.has(e.location)) byLoc.set(e.location, []);
        byLoc.get(e.location).push(e);
    }
    const derivedAt = (loc) => byLoc.get(loc).every((e) => ef[e.id]?.位置来源 === '结构推导');
    const chip = (e, worldRef) => {
        const nm = escapeHtml(e.name);
        const kind = e.kind === 'faction' ? '<small>势力</small>' : '';
        const agenda = (worldRef.agendas || []).some((a) => !a.closed && a.owner === e.id);
        return `<span class="sw2-locchip${e.id === playerId ? ' sw2-locchip-me' : ''}${agenda ? ' sw2-locchip-busy' : ''}"`
            + ` title="${escapeHtml(e.name)}${agenda ? '：手上正有在办的盘算' : ''}">${nm}${kind}</span>`;
    };
    const locGroups = [...byLoc.entries()]
        .sort((a, b) => b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0])))
        .map(([loc, list]) => `<div class="sw2-locgroup">`
            + `<div class="sw2-locgroup-head"><span class="sw2-locgroup-name">${escapeHtml(loc)}</span>`
            + `<span class="sw2-locgroup-n">${list.length} 人</span>`
            + (derivedAt(loc) ? '<small class="sw2-quiet-note" title="这个地点是引擎从组织条目的驻地结构推出来的（成员推定在所属组织驻地），**不是书里对这个名号自己的明述**">（推）</small>' : '')
            + `</div>`
            + `<div class="sw2-locchips">${list.map((e) => chip(e, world)).join('')}</div>`
            + `</div>`);
    const unknownHtml = unknown.length
        ? `<div class="sw2-locgroup sw2-locgroup-unknown">`
            + `<div class="sw2-locgroup-head"><span class="sw2-locgroup-name">位置未载</span>`
            + `<span class="sw2-locgroup-n">${unknown.length} 人</span></div>`
            + `<div class="sw2-locgroup-note">书里没写他们在何处——**不是"在别处"，是不知道**。`
            + `其中 ${unknown.filter((e) => e.parent).length} 人知道归属（只是其组织条目没写驻地）、`
            + `${unknown.filter((e) => !e.parent).length} 人无归属。他们照常在世界里活动，不被位置筛掉。</div>`
            + `<div class="sw2-locchips">${unknown.map((e) => chip(e, world)).join('')}</div>`
            + `</div>`
        : '';

    // ★leg25 g（用户 2026-09-11 实机复验后拍板：「有是有但是太拥挤了，收缩到一个入口内，就叫地图吧，
    //   这就是个暂时的展示功能」）：
    //   上一棒把 563 张卡压成 21 组（-84%）方向是对的，但**整片铺在侧栏里**仍然占满视线——
    //   21 组 + 390 人的未载筐一展开，动态流被挤到下面看不见。现在收成**一个入口**：默认收起，
    //   开口只报一行摘要（几处 / 几人 / 未载几人），要看得自己点开。
    //   形态选**原生 `<details>`**（不新增 JS、不新增状态）：本仓已有两处同款先例
    //   （`.sw2-milestone` / `.sw2-source-alt`），样式按它们写，不为这一次改版发明新组件。
    //   ★纪律（别改坏）：**内容照旧全在 DOM 里**——折叠≠删除。理由有两条：
    //     ① `未载 ≠ 在别处` 这条口径靠那段说明文案承载（"书里没写"），删了就把口径删了；
    //     ② 现有回归锁断言的是内容与 class（`sw2-locgroup-name">江州` / `位置未载…书里没写`），
    //        真删了内容会当场红——那正是"别把呈现改版做成功能删减"的防线。
    //   措辞纪律（用户原话）：入口就**叫「地图」**，别叫"各归何处速览"之类；这是**暂时的展示功能**。
    const known = active.length - unknown.length;
    const mapDetails = `<details class="sw2-map-details">`
        + `<summary class="sw2-map-summary"><span class="sw2-map-title">地图</span>`
        + `<span class="sw2-map-brief">${byLoc.size} 处 · ${known} 人有处可循`
        + (unknown.length ? ` · 未载 ${unknown.length} 人` : '')
        + `</span></summary>`
        + `<div class="sw2-map-note" title="位置只是把账上已有的空间结构摆出来。引擎不据此筛选谁、也不判断两人能否相遇（那是笔的事）">`
        + `各归何处（${byLoc.size} 处 / ${known} 人有处可循）——按处聚合，仅供查看；`
        + `位置不参与筛选，「未载」也不代表在别处。</div>`
        + `<div class="sw2-side">${locGroups.join('')}${unknownHtml}</div>`
        + `</details>`;
    return mapDetails;
}

export function renderBoardHtml(world, opts = {}) {
    return {
        digest: renderDigestHtml(world, opts),
        // ★leg52：`opts.config.paramEnv`（＝参数真源）透传下去 —— 信息带要与参数页同源。
        infoband: renderInfoBandHtml(world, opts),
        agendaStrip: renderAgendaStripHtml(world),
        feed: renderFeedHtml(world, opts),
        side: renderSideHtml(world),
    };
}

// ============ 编年页 ============

// ============ 细案 spec-chronicle-page-ia：编年页数据选择层（纯函数，可导出单测） ============
// 分工（与 `selectEntityPage`/`makeEntsView` **完全同款**）：**选数据住渲染层、存状态住接线层**。
//   ⇒ 接线层（`web/index.js` 的 `sw2ChronicleView`）只持一份视图状态，一行数据逻辑都不写。
export const CHRONICLE_PAGE_SIZE = 60;
// ★细案 §3.5：五筛（谋划/大事/牵动/暗处/时局）**退场**——它们只是 `kind` 枚举的中文直译，
//   玩家读不出"牵动"与"暗处"的界线。**账上 `kind` 一个字不动**（链视图/大事纪照旧按它工作），
//   本笔只换**玩家看到的那一维**：真事件 / 账目（+ 已了结 / 未了结）。
// ★默认值**只有这一份真源**（照实体页终审 M10）：接线层的视图态与重置都从 `makeChronicleView()` 取。
export const CHRONICLE_DEFAULT_VIEW = { q: '', layer: 'all', closed: 'any', range: '10', scope: 'all', page: 1, pageBook: 1 };

export function makeChronicleView() { return { ...CHRONICLE_DEFAULT_VIEW }; }

// ── 分类（细案 §3.2）：**唯一干净判据＝行首 `事件「…」——`** ──────────────────────
//   ★两次错法留档（§7.0 的原话，别重踩）：
//     ① 按"地点非空"判 ⇒ 地点常是占位词「未明」⇒ 几乎全判成记账（演示当场报"真事件 0 行"）；
//     ② 按"有没有「事发」"判 ⇒ `盘算「X」推进：…事发…` 与 `满步结算：…事发…` **记账行也带**。
//   ★判据写成"配置 + 兜底"而不是罗列生产点：**不匹配的一律算账目**——
//     新生产点即使措辞没见过，也只会落进账目而不会**伪装成情节**（宁可少上一个故事，不许把账当故事印）。
//   ★生产者全集 20 种形状（`settle.js` 18 + `entropy.js` 2）已逐条验过 **零 UNKNOWN**（判据在
//     `test/chronicle-page.test.js` 的"生产者全集"那条里，真账副本另跑一遍）。
//   ★★子类口径必须**只此一处**：`类别徽`（T2）与`已了结`（下面 `chronicleIsClosed`）都吃本函数的结论，
//     不许在渲染端再写一遍正则（"同一事实两处实现 ⇒ 迟早分叉"）。
const BOOK_KIND_RULES = [
    // 结清：满步结算（结清/变形）/ 取消（含"取消后遗留子盘算…"）
    ['结清', (t) => /^盘算「[^」]+」(?:取消（|满步结算：)/.test(t) || /^取消后遗留子盘算/.test(t)],
    // 了结：事件闭环 / 涟漪平息
    ['了结', (t) => /^事件「[^」]+」(?:闭环（|涟漪平息（)/.test(t)],
    // 起因：新盘算从哪来（因事而生 / 由处境而生）+ 实体的入局、覆灭、淡出、重回、复归
    ['起因', (t) => /^(?:因事而生：|由处境而生：)/.test(t)
        || /^「[^」]+」(?:入局（|覆灭|淡出视野（|带着因由重回场上（|复归（)/.test(t)],
    // 走一步：推进 / 拆环 / 委派 / 兑现 / 熵泵（世界静默与收声）
    ['走一步', (t) => /^(?:盘算「[^」]+」推进：|拆环：|委派：|兑现：|天下已不安静（|天下安稳：)/.test(t)],
];
// 账目兜底子类（措辞没见过的新生产点落这里：语义上就是"引擎又走了一步"）
const BOOK_KIND_FALLBACK = '走一步';
// 玩家可见的类别词（★四个词之外不许有别的；都不是引擎词）
export const CHRONICLE_BOOK_LABELS = Object.freeze({ 走一步: '走一步', 了结: '了结', 起因: '起因', 结清: '结清' });

export function classifyChronicle(line) {
    const t = String(line?.text ?? '');
    if (/^事件「[^」]+」——/.test(t)) return { isEvent: true, bookKind: '' };
    for (const [kind, test] of BOOK_KIND_RULES) if (test(t)) return { isEvent: false, bookKind: kind };
    return { isEvent: false, bookKind: BOOK_KIND_FALLBACK };
}

// ★「已了结」的口径（细案 §T1）：**闭环 / 涟漪平息 / 满步结算 / 取消** —— 与 `classifyChronicle` 的子类共用同一份判据
//   （`了结` ∪ `结清`），真账实测 已了结 120 · 未了结 240。
export function chronicleIsClosed(line) {
    const k = classifyChronicle(line).bookKind;
    return k === '了结' || k === '结清';
}

// 事名：`事件「X」——…` 取 X；账目行没有"事名"这个概念 ⇒ 返回空串（不假装有）
export function chronicleNameOf(line) {
    const t = String(line?.text ?? '');
    if (!classifyChronicle(line).isEvent) return '';
    return (/^事件「([^」]+)」——/.exec(t) || [])[1] || '';
}

// 因（三种关系）：沿…而来 / 由盘算…而生 / 由世界处境而生
//   ★收口那一格（`」`）**全角半角都要吃**（`」` / `”` / `"`）：生产者的行是 `沿「X」而来`（全角），
//     而演示脚本与夹具里常写成半角——只吃一种的话，真账上"因"这一格会静默抽不出来而夹具全绿（假的）。
//   ★`[^」]+` 是"引号里不许再出现同一侧的引号"：账上实测 360 行的因**全部**能抽出来（见判据）。
const CH_CLOSE = '[」”"]';
export function chronicleCauseOf(line) {
    const t = String(line?.text ?? '');
    let m = new RegExp(`沿「([^」]+)${CH_CLOSE}而来`).exec(t);
    if (m) return { rel: '沿', what: m[1] };
    m = new RegExp(`由盘算「([^」]+)${CH_CLOSE}而生`).exec(t);
    if (m) return { rel: '由盘算', what: m[1] };
    if (/由世界处境而生/.test(t)) return { rel: '由处境', what: '' };
    return { rel: '', what: '' };
}

// 地点 / 牵动的人（`事发 X` / `牵动 A、B`）
//   ★分隔符**全角半角都要吃**（`，` 与 `,`）：生产者的行是 `……，事发 未明，牵动 万法阁、白小娥`（**全角**），
//     而演示脚本与合成夹具里写的是半角——只吃半角时真账**一个字段都抽不出来**，而夹具全绿（假的）。
//     真账实测：只吃半角 ⇒ 地点 0 行、牵动 0 行；两样都吃 ⇒ 地点 122 行 · 牵动 122 行（与 §7.0 的 123/122 对得上）。
const CH_SEP = '[,，]';
export function chroniclePlaceOf(line) {
    return ((new RegExp(`${CH_SEP}事发\\s*([^,，]+)`).exec(String(line?.text ?? '')) || [])[1] || '').trim();
}
export function chroniclePeopleOf(line) {
    return ((new RegExp(`${CH_SEP}牵动\\s*([^,，]+)`).exec(String(line?.text ?? '')) || [])[1] || '').trim();
}

// ★搜索面（细案 §3.6）：**事名 ∪ 因 ∪ 地点 ∪ 牵动的人**（+ 类别词，让"搜类别"也找得到）。
//   ★占位词**不进搜索面**（照实体页终审 C2 的同一条口径）：真账里多数行的地点是「未明」，
//     一搜它就把大半个账捞出来 ⇒ 玩家会以为搜索坏了。★"行原文"**刻意不进**——否则"原文里有未明"
//     就等于"未明可搜"（自相矛盾）。
export function chronicleSearchTextOf(line) {
    const t = String(line?.text ?? '');
    const cls = classifyChronicle(line);
    const place = chroniclePlaceOf(line);
    const cause = chronicleCauseOf(line);
    return [
        chronicleNameOf(line), cause.what, place === '未明' ? '' : place,
        chroniclePeopleOf(line), t.includes('未明') ? '' : t,
        cls.isEvent ? '事件' : (CHRONICLE_BOOK_LABELS[cls.bookKind] || ''),
    ].filter((x) => typeof x === 'string' && x).join(' ').toLowerCase();
}

// ⚠链目标（细案 §4.1）：链钮口径**只此一处**——`chainRef` → `eventRef` → 行 id 解析
//   （`ch_<tick>_evc2?_<evId>` 内嵌事件 id，与 msIdTick 同款 id 解析纪律：引擎 id 只进 data/title 悬停，
//    A-3 豁免；旧账不篡改＝渲染只读派生，不写回账本）。★行 id 是编年行自己的 id，**不挂链**。
export function chronicleChainTargetOf(line) {
    const c = line || {};
    return c.chainRef || c.eventRef || (/^ch_\d+_evc2?_(ev_.+)$/.exec(String(c.id || '')) || [])[1] || '';
}

// 每层内的子组（细案 §3.1）：事件层两组（近来 / 更早）· 账目层四组（四个子类，顺序固定 = 读起来由"在办"到"收摊"）
const CH_BOOK_ORDER = ['走一步', '了结', '起因', '结清'];

function chronicleLineInfo(line, idx) {
    const cls = classifyChronicle(line);
    return {
        line, idx, tick: Number(line?.tick) || 0, isEvent: cls.isEvent, bookKind: cls.bookKind,
        name: chronicleNameOf(line), cause: chronicleCauseOf(line),
        place: chroniclePlaceOf(line), people: chroniclePeopleOf(line),
        chain: chronicleChainTargetOf(line), closed: chronicleIsClosed(line),
        text: String(line?.text ?? ''),
        // ★搜索面在这里**只算一次**（管线的谓词与计数全吃它）——不许在别处再扫一遍账
        search: chronicleSearchTextOf(line),
    };
}

// 选中哪些行 + 怎么分层 —— 纯函数，唯一真源（判据逐格与真账副本对齐）
export function selectChroniclePage(world, view = {}) {
    const v = { ...CHRONICLE_DEFAULT_VIEW, ...(view || {}) };
    const all = (world?.chronicle || []).map(chronicleLineInfo);
    const tick = Number(world?.meta?.tick) || 0;
    const q = String(v.q || '').trim().toLowerCase();
    // 近 N 轮：`tick > 当前轮 - N`；`'all'` 不设时限。★账上轮数不足时按实际来（不印负数轮）
    const win = v.range === 'all' ? null : (Number(v.range) || 0);
    // ── 一条管线（照实体页 `entsRows` 的分工：**行集合只有这一处算**，分页/计数/分层全吃它）──
    //   谓词逐条叠：层 → 了结 → 搜索。★搜索面**每行只算一次**（`info.search` 在 chronicleLineInfo 里
    //   落地）——不许在别处再扫一遍 `world.chronicle`（"同一口径两处实现 ⇒ 迟早分叉"）。
    let rows = all;
    if (v.layer === 'event') rows = rows.filter((r) => r.isEvent);
    else if (v.layer === 'book') rows = rows.filter((r) => !r.isEvent);
    if (v.closed === 'done') rows = rows.filter((r) => r.closed);
    else if (v.closed === 'open') rows = rows.filter((r) => !r.closed);
    if (q) rows = rows.filter((r) => r.search.includes(q));
    // ★顺序（确定性）：轮次新→旧 → 账上原始位次（同轮内保持账本顺序，绝不靠"看起来对"的二次排序）
    rows = rows.slice().sort((a, b) => b.tick - a.tick || a.idx - b.idx);
    // ── 分层用的三条叠（层/了结/搜索都吃上了，**只差时间窗**——"上桌方式"里只有轮次是分层的）──
    const eventHit = rows.filter((r) => r.isEvent);
    const bookHit = rows.filter((r) => !r.isEvent);
    const hot = win == null ? eventHit.slice() : eventHit.filter((r) => r.tick > tick - win);
    const old = win == null ? [] : eventHit.filter((r) => r.tick <= tick - win);
    // 事件层受轮次限制（"近来发生的事"这一组的定义就是"近 N 轮内"）：
    //   `range !== 'all'` ⇒ 事件层的主列表就是 hot 那一叠；`'all'` ⇒ 全部真事件上桌，折叠组不收
    const eventRows = win == null ? eventHit : hot;
    // 账目层：四组恒全量（没有"近 N 轮"这一说——账是流水，不做时间窗）
    const g = (k) => bookHit.filter((r) => r.bookKind === k);
    const count = (k) => g(k).length;
    // 分页器**按层**（细案 §3.4：一枚共享分页器会让"在收起的名单上翻页" ⇒ 死控件）。
    //   ★默认视图下事件层 = `layer:'event'` 的命中（123 = 29 hot + 94 old），账目层 = 237。
    const hitEvent = v.layer === 'book' ? 0 : eventRows.length;
    const hitBook = v.layer === 'event' ? 0 : bookHit.length;
    const pagesOf = (n) => Math.max(1, Math.ceil(n / CHRONICLE_PAGE_SIZE));
    const clampPage = (p, n) => Math.min(Math.max(1, Number(p) || 1), pagesOf(n));
    const page = clampPage(v.page, hitEvent);
    const pageBook = clampPage(v.pageBook, hitBook);
    const slice = (list, p) => list.slice((p - 1) * CHRONICLE_PAGE_SIZE, p * CHRONICLE_PAGE_SIZE);
    const events = slice(eventRows, page);
    const books = slice(bookHit, pageBook);
    const info = (n, p, rowsIn) => ({
        hit: n, page: p, pages: pagesOf(n), rows: rowsIn,
        from: (p - 1) * CHRONICLE_PAGE_SIZE + (rowsIn.length ? 1 : 0),
        to: (p - 1) * CHRONICLE_PAGE_SIZE + rowsIn.length,
    });
    const byKind = {};
    for (const k of CH_BOOK_ORDER) byKind[k] = count(k);
    return {
        total: all.length, tick, rangeN: win,
        events: info(hitEvent, page, events),
        books: info(hitBook, pageBook, books),
        // ★两层各自的"本页行"（`events.rows` / `books.rows`）与事件层的**两个显示组**是两件事，别混：
        //   `groups.hot.rows` = 事件层主列表本页（含轮 3 这种早于窗口但仍在主列表里的）
        //   `groups.older.rows` = 早于窗口的真事件（收起的"更早的事"那一叠），两者**互斥**。
        //   ★字段名不叫 `old` 而叫 `older`：`old` 与"本页行"只差一个字母，读代码的人（和我）
        //     已经在这上面栽过一次（把主列表当成"近来那一组"）。
        groups: {
            hot: { key: 'hot', label: '近来发生的事', rows: events, hit: win == null ? 0 : hot.length, open: true },
            older: { key: 'old', label: '更早的事', rows: win == null ? [] : slice(old, page), hit: old.length, open: false },
        },
        // 账目层四组：★全量给出去（不分页）——分页器只切**该层的主列表**（`books.rows`），
        //   组内条数由 UI 用 `<details>` 自己折（细案 §3.4：分页器的粒是"层"不是"组"）
        bookGroups: CH_BOOK_ORDER.map((k) => ({ key: k, label: CHRONICLE_BOOK_LABELS[k], rows: g(k), hit: count(k) })),
        // 计数口径（chip 用）：`'all'` = 全册 · `'hit'` = 当前条件下点它会得到多少
        //   ★两个口径共用上面那一条管线（`rows` 已吃上 层/了结/搜索；`'hit'` 另外把"层"那一维
        //     换成"点它之后会得到的那一层"——照实体页 `entsHitCounts` 的同一说法）
        counts: v.scope === 'hit'
            ? (() => {
                const pick = (patch) => {
                    let rs = all;
                    const lay = patch.layer ?? v.layer;
                    if (lay === 'event') rs = rs.filter((r) => r.isEvent);
                    else if (lay === 'book') rs = rs.filter((r) => !r.isEvent);
                    const cl = patch.closed ?? v.closed;
                    if (cl === 'done') rs = rs.filter((r) => r.closed);
                    else if (cl === 'open') rs = rs.filter((r) => !r.closed);
                    if (q) rs = rs.filter((r) => r.search.includes(q));
                    return rs;
                };
                return {
                    all: pick({ layer: 'all' }).length,
                    event: pick({ layer: 'event' }).length,
                    book: pick({ layer: 'book' }).length,
                    done: pick({ closed: 'done' }).length,
                    open: pick({ closed: 'open' }).length,
                };
            })()
            : { all: all.length, event: all.filter((r) => r.isEvent).length, book: all.filter((r) => !r.isEvent).length, done: all.filter((r) => r.closed).length, open: all.filter((r) => !r.closed).length },
    };
}

// ── 行渲染（细案 §3.1）：**一行只有三样**——轮次 · 事名 · 因与牵动（+ 类别徽 + 真有链目标才有的「链」）──
//   ★"没有就留白"（照实体页纪律）：`事发 未明` 是占位词 ⇒ **不印**；没有牵动名单 ⇒ 不印；
//     账目行没有"事名"这个概念 ⇒ 不假装有（印它自己那句原文，措辞原样照抄，一个字不改）。
function chronicleRowHtml(r) {
    const cause = r.cause.what
        ? `<span class="sw2-ch-k">${escapeHtml(r.cause.rel)}</span>「<span class="sw2-ch-w">${escapeHtml(r.cause.what)}</span>」`
        : (r.cause.rel ? `<span class="sw2-ch-k">${escapeHtml(r.cause.rel)}</span>` : '');
    const place = r.place && r.place !== '未明' ? `事发 <span class="sw2-ch-w">${escapeHtml(r.place)}</span>` : '';
    const mid = [cause, place, r.people ? `牵动 ${escapeHtml(r.people)}` : ''].filter(Boolean).join(' · ');
    const badge = r.isEvent
        ? `<span class="sw2-ch-badge ev">事件</span>`
        : `<span class="sw2-ch-badge bk">${escapeHtml(CHRONICLE_BOOK_LABELS[r.bookKind] || '')}</span>`;
    // 事名：真事件取 `事件「X」——` 里的 X；账目行印它自己的原文（不是"事名"）
    const head = r.isEvent ? `「${escapeHtml(r.name)}」` : escapeHtml(r.text);
    return `<div class="sw2-ch-line${r.isEvent ? ' sw2-ch-event' : ' sw2-ch-book'}">`
        + `<span class="sw2-ch-round">${r.tick}</span>`
        + `<span class="sw2-ch-text"><span class="sw2-ch-nm">${head}</span>`
        + (mid ? `<span class="sw2-ch-mid">${mid}</span>` : '')
        + `</span>`
        + (r.chain ? `<button class="sw2-chainbtn" data-action="open-chain" data-chain="${attrText(r.chain)}" title="${attrText(r.chain)}">链</button>` : '')
        + badge
        + `</div>`;
}

// 分层渲染：一个折叠组（★真结构 = `details.sw2-ch-group`，判据按它咬——**不许**用 `includes('<summary')`，
//   工具条那个「？」自己就含 `<summary>`，那正是 leg49 §4② 假绿的原形）
function chronicleGroupHtml(key, label, note, rows, open) {
    return `<details class="sw2-ch-group" data-group="${attrText(key)}"${open ? ' open' : ''}>`
        + `<summary><span class="sw2-ch-gt">${escapeHtml(label)}</span>`
        + `<span class="sw2-ch-gc">${escapeHtml(note)}</span></summary>`
        + (rows.length ? rows.map(chronicleRowHtml).join('') : '<div class="sw2-ch-empty">这一类眼下是空的。</div>')
        + `</details>`;
}

// 层内分页器（细案 §3.4：**分页器的粒是"层"**）——照实体页 `renderEntsPager` 的口径：
//   一页装得下时两枚钮**照旧在位**（只是 `disabled`）；空结果只印「命中 0」，不印"第 0–0 条"。
function chroniclePagerHtml(info, layer) {
    const multi = info.pages > 1;
    const range = info.hit > 0 ? `　显示第 ${info.from}–${info.to} 条` : '';
    const where = multi ? `　第 ${info.page} / ${info.pages} 页` : '';
    return `<div class="sw2-ch-pager" data-layer="${attrText(layer)}">`
        + `<button class="sw2-btn" data-action="ch-page" data-value="prev" data-layer="${attrText(layer)}"${!multi || info.page <= 1 ? ' disabled' : ''}>‹ 上一页</button>`
        + `<span class="sw2-ch-hit">命中 <b>${info.hit}</b>${range}${where}</span>`
        + `<button class="sw2-btn" data-action="ch-page" data-value="next" data-layer="${attrText(layer)}"${!multi || info.page >= info.pages ? ' disabled' : ''}>下一页 ›</button>`
        + `</div>`;
}

// 编年页工具条（细案 §3.7：照实体页"乙 · 分组块"排布——每块自带标签、块内不拆行）
export function renderChronicleToolbar(world, view = {}) {
    const v = { ...CHRONICLE_DEFAULT_VIEW, ...(view || {}) };
    const sel = selectChroniclePage(world, v);
    const c = sel.counts;
    const chip = (action, value, label, on, n) =>
        `<button class="sw2-chip${on ? ' on' : ''}" aria-pressed="${on ? 'true' : 'false'}" data-action="${action}" data-value="${attrText(value)}">${escapeHtml(label)}`
        + (n == null ? '' : `<span class="sw2-chip-n">${n}</span>`) + '</button>';
    const g = (label, inner) => `<div class="sw2-ch-g"><span class="sw2-ch-gl">${label}</span>${inner}</div>`;
    const scopeLabel = v.scope === 'hit' ? '当前结果' : '全册';
    const scopeTip = v.scope === 'hit'
        ? '当前：每枚钮显示"在当前条件下点它会得到多少"（与页脚「命中」同一套数）。点一下切回全册。'
        : '当前：每枚钮显示整个编年的数（不随筛选变）。点一下切到"当前结果"口径。';
    return `<div class="sw2-ch-tools">`
        + `<div class="sw2-ch-tools-row">`
        + `<div class="sw2-ch-g sw2-ch-g-q"><input id="sw2_ch_q" class="sw2-ch-q" type="search" aria-label="搜索事名 / 因 / 地点 / 牵动的人" enterkeyhint="search" value="${attrText(v.q)}" placeholder="搜索事名 / 因 / 地点 / 牵动的人…"></div>`
        + g('只看', chip('ch-layer', 'all', '全部', v.layer === 'all', c.all)
            + chip('ch-layer', 'event', '真事件', v.layer === 'event', c.event)
            + chip('ch-layer', 'book', '账目', v.layer === 'book', c.book))
        + g('了结', chip('ch-closed', 'any', '全部', v.closed === 'any')
            + chip('ch-closed', 'done', '已了结', v.closed === 'done', c.done)
            + chip('ch-closed', 'open', '未了结', v.closed === 'open', c.open))
        + g('轮次', chip('ch-range', '5', '近 5 轮', v.range === '5')
            + chip('ch-range', '10', '近 10 轮', v.range === '10')
            + chip('ch-range', 'all', '全部轮次', v.range === 'all'))
        + g('计数', `<button class="sw2-chip${v.scope === 'hit' ? ' on' : ''}" aria-pressed="${v.scope === 'hit' ? 'true' : 'false'}" data-action="ch-scope" data-value="${v.scope === 'hit' ? 'all' : 'hit'}" title="${attrText(scopeTip)}">计数：${scopeLabel}</button>`)
        + `</div></div>`;
}

export function renderChronicleHtml(world, { oldVolumes = [], view = {} } = {}) {
    const v = { ...CHRONICLE_DEFAULT_VIEW, ...(view || {}) };
    const sel = selectChroniclePage(world, v);
    // 里程碑插行（A-16④）：卷标行**照旧在位**（筛选下也恒显示——它是"这段时间已收进大事纪"的路标）
    const notes = (world.milestones || []).map((m) => {
        const titles = Array.isArray(m.titles) ? m.titles : (m.title ? [m.title] : []);
        return `<div class="sw2-ch-roll">⚑ 第 1–${msIdTick(m.id)} 轮已收进大事纪「${escapeHtml(titles.join('、'))}」</div>`;
    });
    // ── 事件层（细案 §3.1）：近来（默认展开）+ 更早（收起）——**每层一枚分页器**，就在该层第一行右端 ──
    const hot = sel.groups.hot, older = sel.groups.older;
    const eventLayer = `
${chroniclePagerHtml(sel.events, 'event')}
${chronicleGroupHtml('hot', hot.label, `第 ${Math.max(1, sel.tick - (sel.rangeN ?? 0) + 1)}–${sel.tick} 轮 · 共 ${hot.hit} 行`, hot.rows, true)}
${sel.rangeN == null ? '' : chronicleGroupHtml('old', older.label, `第 1–${Math.max(1, sel.tick - sel.rangeN)} 轮 · 共 ${older.hit} 行（展开看）`, older.rows, false)}`;
    // ── 账目层（细案 §3.1）：四个子组（走一步 / 了结 / 起因 / 结清）──
    const bookLayer = `
${chroniclePagerHtml(sel.books, 'book')}
${sel.bookGroups.map((bg) => chronicleGroupHtml(bg.key, bg.label, `共 ${bg.hit} 行`, bg.rows, false)).join('\n')}`;
    // 层显示：`layer` 是"只看"（chips）管的——被筛掉的层整块不出现（★判据按"不出现 details.sw2-ch-group"咬）
    const showEvent = v.layer !== 'book';
    const showBook = v.layer !== 'event';
    const volumes = oldVolumes.map((vol) => `<div class="sw2-cold-row"><span class="sw2-vol">${escapeHtml(vol.id)}</span>`
        + `<span class="sw2-volinfo">${escapeHtml(vol.info)}</span><span class="sw2-volact" data-action="read-volume" data-vol="${escapeHtml(vol.id)}">阅卷</span></div>`);
    const volBlock = volumes.length
        ? `<div class="sw2-cold"><h4>旧卷（早于大事纪的编年原文 · 按需阅卷）</h4>${volumes.join('')}</div>` : '';
    return `<div class="sw2-col-head">编年 · 史卷</div>`
        + renderChronicleToolbar(world, v)
        + `<div class="sw2-chronicle">`
        + (showEvent ? `<div class="sw2-ch-layer" data-layer="event">${eventLayer}</div>` : '')
        + (showBook ? `<div class="sw2-ch-layer" data-layer="book">${bookLayer}</div>` : '')
        + notes.join('')
        + (showEvent || showBook ? '' : '<div class="sw2-ch-empty">眼下这一类是空的。</div>')
        + `</div>${volBlock}`;
}

// ============ 大事纪·旧卷页 ============

export function renderArchiveHtml(world, { oldVolumes = [] } = {}) {
    const msCards = (world.milestones || []).map((m) => {
        const titles = Array.isArray(m.titles) ? m.titles : (m.title ? [m.title] : []);
        const ids = Array.isArray(m.ids) ? m.ids : [];
        return `<div class="sw2-milestone"><div class="sw2-milestone-head">`
            + `<span class="sw2-milestone-id">${escapeHtml(m.id)}</span>`
            + `<span class="sw2-mspan">第 1–${msIdTick(m.id)} 轮 · ${m.counts ?? 0} 件事</span></div>`
            + `<h5>${escapeHtml(titles.slice(0, 4).join('、'))}</h5>`
            + (ids.length
                ? `<details><summary>展开这一纪的条目</summary><div class="sw2-rawids">${ids.map((id) => `<span class="sw2-rawid">${escapeHtml(id)}<button class="sw2-chainbtn" data-action="open-chain" data-chain="${escapeHtml(id)}" title="${escapeHtml(id)}">链</button></span>`).join(' · ')}</div></details>` : '')
            + `</div>`;
    });
    const volRows = oldVolumes.map((v) => `<div class="sw2-cold-row"><span class="sw2-vol">${escapeHtml(v.id)}</span>`
        + `<span class="sw2-volinfo">${escapeHtml(v.info)}</span><span class="sw2-volact" data-action="read-volume" data-vol="${escapeHtml(v.id)}">阅卷</span></div>`);
    return `<div class="sw2-arch-grid">${msCards.join('')}</div>`
        + `<div class="sw2-cold"><h4>旧卷（早于大事纪的编年原文 · 按需阅卷）</h4>${volRows.join('') || '<div class="sw2-cold-row" style="color:var(--sw2-text-faint)">尚未入卷——编年仍在热账。</div>'}</div>`;
}

// ============ 角色与势力页 ============

// ============ 细案 spec-entities-page-ia：实体页数据选择层（纯函数，可导出单测） ============
// 分工（照 renderChronicleHtml 的 view.chronicleFilter 同款）：**选数据住渲染层、存状态住接线层**。
//   ⇒ 接线层只持一份视图状态对象，一行数据逻辑都不写（本仓"零第二份状态"纪律）。
export const ENTS_PAGE_SIZE = 60;
// ★终审 I1：`scope` = chip 计数读**哪个口径**（`'all'` 全册 / `'hit'` 当前结果；缺省 `'all'` = 既有观感不变）。
//   病：chip 上的数一直是**全册**口径（真账 621/103/518），而与它同屏的页脚印的是「命中 4」
//   ⇒ 两个数说的不是同一件事，玩家会以为筛选坏了。
export const ENTS_DEFAULT_VIEW = { q: '', kind: 'all', filters: [], grp: 'none', sort: 'active', scope: 'all', page: 1 };

// ★终审 M10：视图态的默认值**只有这一份真源**——接线层（`web/index.js` 的 `sw2EntsView` 与 `sw2EntsViewReset`）
//   从本工厂取，不许再各写一份字面量（两份靠人同步 = 迟早分叉；本笔加 `scope` 时正是两处都要改）。
//   ★`filters` 必须**拷一份新数组**：接线层对它是**就地 `push`/`splice`**，若与默认值共用同一个数组，
//     一次筛选就会把默认值改脏（下一个玩家开局带着上一个的筛选项）。
export function makeEntsView() { return { ...ENTS_DEFAULT_VIEW, filters: [...ENTS_DEFAULT_VIEW.filters] }; }

// 搜索面：★位置**在**这里（位置不占版面 ≠ 查不到——细案 §3.3 是硬口径）
//   ★终审 C2：占位词「未明」**不进搜索面**（细案 Task 1 评审定夺③的原话：「占位词不是内容，否则搜「未明」
//     会命中 475 人」——实现当时没跟上、判据也没咬住）。真账实测（副本）：`location === '未明'` 有 475/621，
//     而位置列已撤（J1）⇒ 玩家再没有"这一格印的只是占位词"的唯一线索，一搜「未明」就是 475 个人。
//     ⇒ 只撤**这一个占位词**，真地名照旧在搜索面里（细案 §3.3 的覆盖口径一个字不改）。
export function entsSearchTextOf(e) {
    const loc = typeof e?.location === 'string' && e.location !== '未明' ? e.location : '';
    return [e?.name, e?.parent, loc, e?.['实力'], e?.['规模'], e?.['性质'], e?.['倾向'],
        ...(Array.isArray(e?.organs) ? e.organs : []), ...(Array.isArray(e?.branches) ? e.branches : [])]
        .filter((x) => typeof x === 'string' && x).join(' ').toLowerCase();
}

// ★终审 I1：**行集合只有这一处算**（`selectEntityPage` 的分页切片与 `entsHitCounts` 的「当前结果」口径
//   都吃它）——"一份真源、两个口径"：口径只决定"对哪个集合点数 / 按哪条谓词点数"，筛选管线不许出现第二份。
//   不导出：它是这两个纯函数的内部实现（接线层一行都不碰）。
function entsRows(world, view = {}) {
    const v = { ...ENTS_DEFAULT_VIEW, ...(view || {}) };
    const busy = new Set((world?.agendas || []).filter((a) => !a.closed).map((a) => a.owner));
    const filters = new Set(Array.isArray(v.filters) ? v.filters : []);
    const q = String(v.q || '').trim().toLowerCase();
    let rows = (world?.entities || []).filter((e) => v.kind === 'all' || e.kind === v.kind);
    if (filters.has('busy')) rows = rows.filter((e) => busy.has(e.id));
    if (filters.has('recent')) rows = rows.filter((e) => typeof e.lastActiveTick === 'number');
    if (filters.has('named')) rows = rows.filter((e) => e.parent);
    if (filters.has('orphan')) rows = rows.filter((e) => !e.parent);
    if (q) rows = rows.filter((e) => entsSearchTextOf(e).includes(q));
    return { rows, busy };
}

// ★终审 I1：`scope` 是**可选**第三参（缺省 `'all'` ⇒ 既有调用点零扰动）。
//   `'all'`  = 全册口径（本函数原本的唯一口径：始终对 `world.entities` 点数）。
//   `'hit'`  = 「当前结果」口径，恰好就是**页脚「命中 N」那一套数**长在每枚钮上：
//             · 类别钮（全部/势力/角色）= 把"类别"那一维换成它的值，其余当前条件不动
//               ⇒ 数 = 「点它会得到多少」；
//             · 筛选钮 = 在当前条件上**加上**这条 ⇒ 数 = 「当前结果里满足这条的有几个」
//               （已经生效的那一枚，它的数就是当前命中数本身——不会一点就从 N 跳到 0）。
//   ★两个口径共用 `entsRows` 那一条管线（`assert` 在 `test/render.test.js` 里逐格与 `selectEntityPage` 对齐）。
export function entsHitCounts(world, view = {}, scope = 'all') {
    const es = world?.entities || [];
    if (scope === 'hit') {
        const v = { ...ENTS_DEFAULT_VIEW, ...(view || {}) };
        const on = new Set(Array.isArray(v.filters) ? v.filters : []);
        const n = (patch) => entsRows(world, { ...v, ...patch }).rows.length;
        return {
            all: n({ kind: 'all' }),
            faction: n({ kind: 'faction' }),
            character: n({ kind: 'character' }),
            busy: n({ filters: [...on, 'busy'] }),
            recent: n({ filters: [...on, 'recent'] }),
            named: n({ filters: [...on, 'named'] }),
            orphan: n({ filters: [...on, 'orphan'] }),
        };
    }
    const busy = new Set((world?.agendas || []).filter((a) => !a.closed).map((a) => a.owner));
    return {
        all: es.length,
        faction: es.filter((e) => e.kind === 'faction').length,
        character: es.filter((e) => e.kind === 'character').length,
        busy: es.filter((e) => busy.has(e.id)).length,
        recent: es.filter((e) => typeof e.lastActiveTick === 'number').length,
        named: es.filter((e) => e.parent).length,
        orphan: es.filter((e) => !e.parent).length,
    };
}

export function selectEntityPage(world, view = {}) {
    const v = { ...ENTS_DEFAULT_VIEW, ...(view || {}) };
    const { rows: matched, busy } = entsRows(world, v);
    let rows = matched;
    const cmp = {
        // 在办优先 → 最近活跃次之 → 名号（确定性三重键：同输入必得同序）
        active: (a, b) => (busy.has(b.id) ? 1 : 0) - (busy.has(a.id) ? 1 : 0)
            || (b.lastActiveTick ?? -1) - (a.lastActiveTick ?? -1) || String(a.name).localeCompare(String(b.name), 'zh'),
        recent: (a, b) => (b.lastActiveTick ?? -1) - (a.lastActiveTick ?? -1) || String(a.name).localeCompare(String(b.name), 'zh'),
        name: (a, b) => String(a.name).localeCompare(String(b.name), 'zh'),
    }[v.sort] || null;
    if (cmp) rows = rows.slice().sort(cmp);
    const hit = rows.length;
    const pages = Math.max(1, Math.ceil(hit / ENTS_PAGE_SIZE));
    const page = Math.min(Math.max(1, Number(v.page) || 1), pages);   // ★越界夹紧（不返回空页）
    const slice = rows.slice((page - 1) * ENTS_PAGE_SIZE, (page - 1) * ENTS_PAGE_SIZE + ENTS_PAGE_SIZE);
    // ★评审修正 #6：`busyOwners`（在办的主）随返回值一起出去——渲染层原来用**同一个表达式**又算了一遍
    //   （同一口径写两处 = 改一处忘一处），现在行标记只认这一份（数据选择层是唯一权威）。
    return { rows: slice, busyOwners: busy, total: (world?.entities || []).length, hit, page, pages, from: (page - 1) * ENTS_PAGE_SIZE + (slice.length ? 1 : 0), to: (page - 1) * ENTS_PAGE_SIZE + slice.length };
}

// 实体页工具条（细案 §3.2）：两行——搜索 + 类别 + 筛选 ／ 排序 + 全册补全 + 查书三态提示
//   ★`config` 必须从 `renderEntitiesHtml` 透传进来——批量补全进度**只由 config 进渲染层**
//   （本仓纪律：渲染层不持任务状态；真路是 `config.lookupTask`，见 `web/index.js` 的 `renderCfg()`）
export function renderEntsToolbar(world, view, config = null) {
    const v = { ...ENTS_DEFAULT_VIEW, ...(view || {}) };
    // ★终审 I1：chip 上的数按**当前口径**量（缺省 `'all'` = 全册，与既有观感逐字节一致）
    const c = entsHitCounts(world, v, v.scope);
    const filters = new Set(v.filters || []);
    // ★评审第二轮 #6：chip 是真 `<button>`，选中态原先**只靠 `.on` 类**（纯视觉）⇒ 读屏用户听不出
    //   自己选了哪档（筛选/排序/分组三类钮全是这个形状）。`aria-pressed` 是这种"可切换钮"的标准说法，
    //   与搜索框上那条 `aria-label` 属同一契约（本仓在无障碍上花过功夫，这里补齐）。
    //   注意：`on` 这一支会打印成 `aria-pressed="true"`，`false` 也**显式印出**（不留未设态——
    //   "未设"会被读屏当成普通按钮，而不是"可按下但现在是关的"）。
    const chip = (action, value, label, on, n) =>
        `<button class="sw2-chip${on ? ' on' : ''}" aria-pressed="${on ? 'true' : 'false'}" data-action="${action}" data-value="${value}">${label}`
        + (n == null ? '' : `<span class="sw2-chip-n">${n}</span>`) + '</button>';
    const kinds = [['all', '全部', c.all], ['faction', '势力', c.faction], ['character', '角色', c.character]];
    // 既有「⬇ 补全全册实力 / ■ 停止补全」按钮（`lookup-batch.test.js:436-448` 锁它；原在页眉，改挂工具条）
    //   ★钮挪位，**文案一字不删**：任务书给的那句比 Task 2 在位的短——它少了"位置不在这里查"那半句，
    //     而那是 leg40b 那条纪律的正面说法（位置不查书、由组织驻地结构推断供给）⇒ 照它删，等于把
    //     "玩家读得到、系统不做"的旧病请回来。⇒ 用任务书那句 + 保留原有那半句（信息只增不减）。
    const task = config?.lookupTask || null;
    const batchButtonHtml = task
        ? `<button class="sw2-btn" data-action="lookup-batch-all" title="${attrText('再点一次可停；已查到的都留账')}">■ 停止补全 ${task.cursor}/${task.total}</button>`
        : `<button class="sw2-btn" data-action="lookup-batch-all" title="${attrText('把全册在册角色的实力按需查一遍（借世界推进分批跑，不阻塞推进；再点一次可停）。位置不在这里查——它由账上的组织驻地结构推断供给，打开面板时自动补')}">⬇ 补全全册实力</button>`;
    // ★在跑时的进度行**照旧留在这里**（`lookup-batch.test.js:451` 按「补全中 4/623」锁它；
    //   它只读 `config.lookupTask`——渲染层不持任务状态这条纪律不变）
    const batchHintHtml = task
        ? `<span class="sw2-hint">补全中 ${task.cursor}/${task.total}（成功 ${task.success} · 未加载到 ${task.pending} · 书未明述 ${task.absent} · 失败 ${task.failed}）——随世界推进分批跑</span>`
        : '';
    // 查书三态说明：页底那整行太长 ⇒ 收进可展开的「？」（★文本必须**连续**出现，`render.test.js:547/620` 用 includes 锁它）
    //   ★任务书那份原文把「每行的**查**=…，**重查**=…」写成**同一句**，而这与页底新口径的既有判据冲突
    //   （`render.test.js:594-598` 从「每行的**查**」切到文末，断言**第一句**里不许出现「重查」——
    //    因为行内那枚钮**只补没定的栏**，重查不在行内）。⇒ 同一件事拆成两句、并把它挪进下面那条指路句
    //   （说法不变、事实不变，判据两边都过）。
    const asksHintHtml = `<details class="sw2-ents-asks"><summary title="${attrText('这三种标记各是什么意思')}">？</summary>`
        + `<div class="sw2-ents-asks-body">账上只记查到的与玩出来的东西：<b>有值</b>=书里原话；`
        + `<b>未加载到</b>=查过书但这轮模型没抽出来（下轮再补，不代表书里没有）；<b>书未明述</b>=书里确实没写。`
        + `每行的<b>查</b>=只补没定的栏（已查到的原话不动）。</div></details>`;
    // ★终审 I1：**计数口径钮**（一枚钮 + `data-value` 两态）。病是"chip 数全册、页脚数当前结果，同屏并列
    //   ⇒ 玩家以为筛选坏了"；治法是把口径做成**玩家自己看得见、能切**的一件事，而不是替他猜。
    //   ★标签**如实写当前口径**（`计数：全册` / `计数：当前结果`），`data-value` 是"点下去会变成什么"
    //   （与同排其它钮同一语义：那枚钮一律"点它就把状态设成 data-value"）。
    //   ★`aria-pressed` 仍照 chip 的契约印（按下 = 「当前结果」口径生效），与上面三类钮同一说法。
    const scopeLabel = v.scope === 'hit' ? '当前结果' : '全册';
    const scopeTip = v.scope === 'hit'
        ? '当前：每枚钮显示"在当前条件下点它会得到多少"（与页脚「命中」同一套数）。点一下切回全册。'
        : '当前：每枚钮显示整个名册的数（不随筛选变）。点一下切到"当前结果"口径。';
    const scopeChip = `<button class="sw2-chip${v.scope === 'hit' ? ' on' : ''}" aria-pressed="${v.scope === 'hit' ? 'true' : 'false'}"`
        + ` data-action="ents-scope" data-value="${v.scope === 'hit' ? 'all' : 'hit'}" title="${attrText(scopeTip)}">计数：${scopeLabel}</button>`;
    // ★★工具条排布定稿（用户实拍截图 +「这个角色和势力这个位置比较乱」⇒ 拍板「就乙吧」）：
    //   病是量出来的：原版把 **21 个控件平铺**在两个 flex 行里、靠 `flex-wrap` 自然折行
    //   ⇒ 实测折成 **9 个视觉行**（工具条高 154px），而且「分组」这个标签与它管的 4 枚钮**被折到不同行**
    //   （读不出谁管谁），那段三态长提示还直接印在行里、**独吃两行**。
    //   治法 = **乙 · 分组块**：**五块带标签的**（类别 / 筛选 / 排序 / 分组 / 计数）+ 搜索块（唯一该伸缩的），
    //   每块自带标签、块与块之间一条竖线；块是**整体折行**的单位（窄屏时整块下去，不把块内的钮打散）。
    //   ★两个"动作"（⬇ 补全全册实力 / ？）**不套块**：它们不是"一伙的选项"，是各干一件事的钮
    //     （套上块会让"块"这个概念变糊——判据正是按块数咬的）。
    //   ★控件一个不增不减（J5 那几条继续咬），`sw2-ents-tools-row` 容器类保留（既有判据按它切文本）。
    const g = (label, inner) => `<div class="sw2-ents-g"><span class="sw2-ents-gl">${label}</span>${inner}</div>`;
    const gq = (inner) => `<div class="sw2-ents-g sw2-ents-g-q">${inner}</div>`;
    return `<div class="sw2-ents-tools">`
        + `<div class="sw2-ents-tools-row">`
        + gq(`<input id="sw2_ents_q" class="sw2-ents-q" type="search" aria-label="搜索名号 / 归属 / 位置 / 实力 / 规模 / 性质" enterkeyhint="search" value="${attrText(v.q)}" placeholder="搜索名号 / 归属 / 位置 / 实力 / 规模 / 性质…">`)
        + g('类别', kinds.map(([k, label, n]) => chip('ents-filter', k, label, v.kind === k, n)).join(''))
        + g('筛选',
            chip('ents-filter', 'busy', '只看在办', filters.has('busy'), c.busy)
            + chip('ents-filter', 'recent', '最近动过的', filters.has('recent'), c.recent)
            + chip('ents-filter', 'named', '有归属的', filters.has('named'), c.named)
            + chip('ents-filter', 'orphan', '无归属的', filters.has('orphan'), c.orphan))
        // ★排序钮的文案与筛选钮**同词**（「最近动过的」）：`render.test.js` 的 K34 与 J1/J2 两条
        //   明文锁着「最近活跃」只进排序与筛选、不进版面——同一句话在筛选钮上已经是「最近动过的」，
        //   排序钮照它写，玩家也不必认两个词（口径由 `selectEntityPage` 的 `recent` 键承担）。
        + g('排序', [['active', '在办优先'], ['recent', '最近动过的优先'], ['name', '按名号']]
            .map(([s, label]) => chip('ents-sort', s, label, v.sort === s)).join(''))
        + g('分组', [['none', '不分组'], ['parent', '按归属'], ['loc', '按位置'], ['kind', '按类别']]
            .map(([gr, label]) => chip('ents-group', gr, label, v.grp === gr)).join(''))
        + g('计数', scopeChip)
        + batchButtonHtml      // ★既有「⬇ 补全全册实力」，从页眉挪到这里（lookup-batch.test.js:436/447 锁它）
        + asksHintHtml         // ★页底那句三态注脚（render.test.js:547/620 锁它），改成可展开的「？」
        + `</div>`
        + `<div class="sw2-ents-tools-row">`
        + batchHintHtml                // ★在跑时的进度行（lookup-batch.test.js:451 锁「补全中 4/623」）
        // ★页底只留这一句**指路**（它是"全册重查入口在哪"的答案，`render.test.js:594-600` 断言从
        //   「每行的<b>查</b>」切到文末的那一段里含「补全全册实力」）：三态释义已收进上面那个「？」，
        //   这里只说入口——那枚钮就在本工具条上（行内那枚<b>查</b>**不负责推倒重查**，这是 Task 2 定稿的口径）。
        + `<span class="sw2-hint sw2-ents-batch-note">全册范围的「连「书未明述」也推倒重查」不在这里的<b>查</b>上——入口是工具栏里那枚<b>⬇ 补全全册实力</b>（它按重查跑：被定为「书未明述」或查不动卡住的栏，一起推倒重来）。</span>`
        + `</div></div>`;
}

// 分页（细案 §3.2）：一屏 60 行
//   ★空结果时只印「命中 0」——**不印「显示第 0–0 条」**（Task 1 评审定夺：空态不占版面）
//   ★一页装得下的时候**控件照旧在位**（只是两枚都 `disabled`）：细案 J5 要的是"控件必须存在"
//     （旧版 0 个是把 621 行全摊平的病根），控件随命中数忽隐忽现反倒让玩家以为没这功能。
//   ★终审 M11（如实处置这一格）：**保留**那两枚 `disabled` 钮，不隐藏、也不假装它们能点。理由同上
//     （J5"控件必须存在" + 忽隐忽现更像坏了）；`disabled` 本身就是诚实说法——"现在没有可翻的页"。
//     同一批：单页时不印"第 1 / 1 页"（没页可翻就不摆页码），只留「命中 N」。判据在 `test/render.test.js`
//     的"命中计数与页码如实印出"那条里（两枚钮在位且都 `disabled`）。
export function renderEntsPager(info) {
    const hit = info?.hit ?? 0;
    const multi = info && info.pages > 1;
    const range = hit > 0 ? `　显示第 ${info.from}–${info.to} 条` : '';
    const where = multi ? `　第 ${info.page} / ${info.pages} 页` : '';
    return `<div class="sw2-ents-pager">`
        + `<button class="sw2-btn" data-action="ents-page" data-value="prev"${!multi || info.page <= 1 ? ' disabled' : ''}>‹ 上一页</button>`
        + `<span class="sw2-ents-hit">命中 <b>${hit}</b>${range}${where}</span>`
        + `<button class="sw2-btn" data-action="ents-page" data-value="next"${!multi || info.page >= info.pages ? ' disabled' : ''}>下一页 ›</button>`
        + `</div>`;
}

// ★leg49（细案 spec-entities-page-ia）：行渲染三列化——**位置列与活跃列退场**。
//   ★`lookupButtons()` 已删（它改造后零引用 = 死代码，本仓的体检纪律）：行内查询钮收成
//   "只在待查的那几行出现"——真账 621 实体里只有 ~12 行是待查态，旧版每行印两枚 ⇒ 626 枚按钮。
export function renderEntitiesHtml(world, { config = null, view = {} } = {}) {
    // K46：镜头名单（pack 引擎层同口径）+ 麾下成员派生——全册展示、隶属
    const lens = new Set(lensList(world).map((x) => x.e.id));
    // ★细案 spec-entities-page-ia：三列版式（名号 / 归属与来历 / 在办的事）。
    //   位置与最近活跃**不占版面**：位置 23.5% 有值、最近活跃 3.9% 有值
    //   （真账 621 实体实测）⇒ 一列印 76% / 96% 的空，是把信号淹在噪声里。
    //   ★但位置仍在搜索面里（entsSearchTextOf）——不占列 ≠ 查不到。
    const page = selectEntityPage(world, view);
    // ★评审修正 #6：行标记的 `busyOwners` **不再在这里重算**——`selectEntityPage` 已把同一份 Set 带回来
    //   （原先两处各写一遍同一个表达式，改一处必忘另一处）。
    const busyOwners = page.busyOwners;

    const rows = page.rows.map((e) => {
        const agenda = (world.agendas || []).find((a) => !a.closed && a.owner === e.id);
        const status = e.status && e.status !== 'active'
            ? `<span class="sw2-visible ${e.status === 'dead' ? 'v-hidden' : 'v-known'}">${LABELS.status[e.status]}</span>` : '';
        const lensBadge = lens.has(e.id) && (!e.status || e.status === 'active') ? '<span class="sw2-visible v-known">在场</span>' : '';
        const parentDerived = e.parentSource === '结构推导';
        const derivedTip = '这条是结构推出来的：由组织条目的驻地/隶属推出（书里没在这个名号自己身上明述），不是模型创作';
        // （推）：位置/归属是推来的 ⇒ 标记落在**名号格**（位置列已退场，来源标记不许跟着一起消失
        //   ——lookup-batch.test.js:381 与"引擎推的不许当书里写的"这条纪律都指着它）。
        // ★两支都要保留：`parentSource`（归属推导）与 `位置来源`（位置推导）——
        //   旧代码两个都判，本次**只改落点不改判定**（parentSource 有 5 个测试文件在用，删它会连坐）。
        const derived = parentDerived || world.meta?.entityFields?.[e.id]?.位置来源 === '结构推导';
        const rec = world.meta?.entityFields?.[e.id];
        const lookupState = (f) => rec?.attempts?.[f]?.state ?? 'none';
        // 查询钮：只在**真需要补**的行出现（旧版每行两枚 ⇒ 真账 626 枚；真账只有 ~12 行是待查态）
        // ★口径照既有 `lookupButtons()`（`src/render.js:658`）：action 名是 **`lookup-entity`**、
        //   id 走 `data-entity`、强制重查走 `data-force="absent"`——**不许自造 action 名**
        //   （`test/lookup-batch.test.js` 有一条"画了按钮就必须有人接"的审计会当场抓红）。
        const settled = ['ok', 'absent'].includes(lookupState('实力'));
        // ★近况/待查态**不收进静默**：行内 chip 退场（真账 621 行 ⇒ 626 枚控件的病根），
        //   但那句话必须还在玩家手上——落点是**查询钮自己的悬停**（同一枚控件既当入口又当说明）：
        //   只有两种态会出现这枚钮（未定案才渲染）：`none` = 从没查过；`pending` = 查过书、这轮模型没抽出来。
        const lookState = lookupState('实力');
        // ★这枚钮同时承担**三态说明**（旧版那枚「未查」chip 的整句口径照旧在位：
        //   「查过之后这里会写『未加载到』或『书未明述』」——它被既有用例按整句锁着，不许悄悄缩短）。
        //   ★评审修正 #3：原 `absent` 那一支是**死文案**——钮只在未定案时渲染（`settled` 挡掉 absent/ok），
        //   「再点一次可连『书未明述』也推倒重查」永远不会出得来，而它承诺的那个 force 行为也**不在行内**
        //   （行内钮不带 `data-force`，见 `web/index.js` 的 `payload.force`）⇒ 那一支连同那句话一起删，
        //   全册范围的重查能力由页底那段说明指向批量入口（`lookup-batch-all`）。
        const ASK_TIP = '只补还没定案的栏（已查到的原话不动；查过之后这里会写「未加载到」或「书未明述」）';
        // ★Task 3（复审登记的"同源假承诺"②）：`pending` 那一支原写「——再点一次重查，…」，
        //   而**行内这枚钮从来不负责推倒重查**（它不带 `data-force`；推倒重查的入口是工具条那枚
        //   `lookup-batch-all`）⇒ 那是一条玩家会读到、这枚控件永远不会做的事（leg40b 治的同一类病）。
        //   收成**只承诺它真做的事**（口径与同一枚钮的 `none` 态一致：只补没定的栏）。
        const askTip = lookState === 'pending'
            ? '按需去世界书取这个名号的原话（只补没定的栏）'
            : ASK_TIP;
        const lookupBtn = e.kind === 'character' && !settled
            ? `<button class="sw2-chainbtn" data-action="lookup-entity" data-entity="${escapeHtml(e.id)}" title="${attrText(askTip)}">查</button>`
            : '';
        // 归属与来历：**一串同源的事**（归属 › 分支 · 机构 › 实力 · 规模 › 性质 · 倾向），一个格子说完
        //   ★分支/机构也在这一串里：旧六格版式里它们是关系区的两行，三列版式里并入本格——
        //     "只改落点不改信息"（`test/render.test.js` 的 K46 用例锁着分支/麾下，不许在本笔里丢掉）。
        const origin = [
            e.parent ? `<span class="sw2-relone-who">${escapeHtml(e.parent)}</span>` : '',
            e.branches?.length ? `<span class="sw2-relone-branch">分支 ${escapeHtml(e.branches.join('、'))}</span>` : '',
            e.organs?.length ? `<span class="sw2-relone-organ">机构 ${escapeHtml(e.organs.join('、'))}</span>` : '',
            // ★"势力不写实力"（细案拍板）：势力的实力由**麾下成员派生**（见下 crewPowerHtml），
            //   势力自己账上即便有值也不渲染——旧版这条锁在 `test/render.test.js` 里，本笔不许丢。
            e.kind === 'character' && typeof e['实力'] === 'string' && e['实力'].trim()
                ? `<span class="sw2-visually-hidden">实力：书里明述的原话。</span><span class="sw2-relone-pow" title="${attrText('实力：书里明述的原话（角色字段；势力不写实力）')}">${escapeHtml(e['实力'])}</span>` : '',
            typeof e['规模'] === 'string' && e['规模'].trim() ? escapeHtml(e['规模']) : '',
            typeof e['性质'] === 'string' && e['性质'].trim() ? escapeHtml(e['性质']) : '',
            typeof e['倾向'] === 'string' && e['倾向'].trim() ? `<span class="sw2-relone-dim">${escapeHtml(e['倾向'])}</span>` : '',
        ].filter(Boolean).join('<span class="sw2-relone-sep"> · </span>');
        const crew = e.kind === 'faction' ? membersOf(world, e) : null;
        const crewPower = crew
            ? crew.map((n) => {
                const m = (world.entities || []).find((x) => x.name === n);
                return typeof m?.['实力'] === 'string' && m['实力'].trim() ? `${n}（${m['实力']}）` : null;
            }).filter(Boolean)
            : [];
        const crewHtml = crew?.length
            ? `<span class="sw2-relone-sep"> · </span><span class="sw2-relone-crew">麾下 ${escapeHtml(crew.join('、'))}</span>` : '';
        const crewPowerHtml = crewPower.length
            ? `<span class="sw2-relone-sep"> · </span><span class="sw2-relone-dim">麾下实力 ${escapeHtml(crewPower.join('、'))}</span>` : '';
        // 在办的事：**只有真在办才有字**（旧版无在办时印一句"眼下没有在办的盘算。"占主句位，真账 ~600 行都是它）
        const agendaHtml = agenda
            ? `<span class="sw2-aggoal">${escapeHtml(agenda.goal)}</span><span class="sw2-agstage">${escapeHtml(agenda.stage || '谋划中')} · ${agenda.progress ?? 0}/${agenda.maxSteps ?? 0}</span>${agenda.visibility === 'concealed' ? '<span class="sw2-visible v-hidden">暗</span>' : ''}`
            : '';
        const hot = busyOwners.has(e.id) ? ' sw2-hot' : '';
        return `<div class="sw2-entity-row${hot}">`
            + `<div class="sw2-cell sw2-c-name">`
            + `<div class="sw2-ename">${escapeHtml(e.name)}<small>${kindLabel(e)}${status}${lensBadge}</small>`
            + (derived ? `<span class="sw2-quiet-note" title="${attrText(derivedTip)}">（推）</span>` : '')
            + lookupBtn
            + `</div></div>`
            // ★空态不占版面（细案）：没有来历就**整格留白**，连占位 span 都不印
            //   （真账 621 实体里 403 行是"无来历记载"——印什么都等于把噪声摊进主线）。
            + `<div class="sw2-cell sw2-relone">${origin}${crewHtml}${crewPowerHtml}</div>`
            + `<div class="sw2-cell sw2-agcell">${agendaHtml}</div>`
            + `</div>`;
    });
    // ★Task 3：头部与工具条就位——批量补全钮与查书三态注脚**已从页眉/页底挪进工具条**
    //   （`renderEntsToolbar` 的第三个形参就是这里的 `config`：进度只由它进渲染层）。
    const empty = page.hit === 0
        ? '<div class="sw2-ents-empty">没有命中的名号——清掉筛选项或换个词试试。</div>' : '';
    // 分组（细案 §3.2）：把同一批行按归属/位置/类别切开，组头带真数（details 折叠）
    //   ★**先切页、再分组**（终审 M9 确认留档在位：这条口径不改，但把说法写死成可 grep 的一句）：
    //     只有**本页那 60 行**参与分组（`page.rows` 与 `rows` 同序同长 ⇒ 按下标配对），
    //     不是全册分组——全册分组要么把组切碎（每组跨页），要么得改分页语义（超出本笔范围）。
    //   ★★评审修正 #2（组头计数歧义）：正因为只切本页，组头**必须明说"本页"**——
    //     同屏还有两处册量级的数（分页器「命中 621」与表头「全册 621」），原写法「N 位」会被读成
    //     "全册该组共 N 位"（真账 11 页 ⇒ 同一组跨页分散，"散修 3 位"与下一页的"散修 N 位"是两件事）。
    //     ⇒ 文案改成 **「本页 N 位」**。**只改措辞**：没有把分页与分组耦合（那超出本笔范围）。
    //   ★不分组时走上面那条分支，**列表体**与 Task 4 逐字节一致（"不分组时零变化"）
    //     ——⚠话只能说到"列表体"：本笔同一批还改了表头那半句（「命中 N」→「筛掉 N」，
    //     见下方 Task 3 评审 Minor ①），整页并不逐字节一致（评审修正 #8：注释不许夸大）。
    let body;
    const grp = view?.grp ?? 'none';
    // ★评审修正 #6：未知/缺失的 `grp` 原先会走到下标取值那一步拿到 `undefined`，调它当场抛 TypeError
    //   ⇒ 与 `?? 'none'` 同一语义：**退化成不分组**（面板点不出未知值，但渲染层不该因为一个越界字符串炸掉整页）。
    const KEYERS = {
        parent: (e) => e.parent || '（无归属）',
        loc: (e) => (e.location && e.location !== '未明') ? e.location : '（位置未载）',
        kind: (e) => e.kind ? (LABELS.kind[e.kind] || e.kind) : '（类别未载）',
    };
    const keyOf = KEYERS[grp];
    if (!keyOf) {
        body = `<div class="sw2-entity-list">${rows.join('')}</div>`;
    } else {
        const groups = new Map();
        page.rows.forEach((e, i) => {
            // 兜底组名：⚠实测这一层**当前咬不住**（三个 keyer 自己都回字符串 ⇒ 删掉它产物逐字节不变，
            //   反向实验见 `test/render.test.js` 分组用例末尾的留档）——留着是纯防御，不是判据。
            const k = keyOf(e) || '（未分组）';
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push(rows[i]);
        });
        const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
        body = sorted.map(([k, list]) =>
            `<details class="sw2-ents-grp-block" open><summary><span class="sw2-ents-grp-t">${escapeHtml(k)}</span>`
            + `<span class="sw2-ents-grp-c">本页 ${list.length} 位</span></summary>`
            + `<div class="sw2-entity-list">${list.join('')}</div></details>`).join('');
    }
    // ★同一事实不说两遍（Task 3 评审 Minor ①）：分页器已经说了「命中多少」⇒ 表头这句只说
    //   **筛掉了多少**（两个数各说一件事），且只在筛选态出现；不筛选时零出现。
    const dropped = page.total - page.hit;
    return `<div class="sw2-list-head">全部角色与势力（全册 ${page.total} · 本轮镜头 ${lens.size}）`
        + (page.hit !== page.total ? `<small class="sw2-quiet-note">筛掉 ${dropped}</small>` : '')
        + `<small class="sw2-quiet-note" title="面板构建号：改了代码但页面还是旧的时（浏览器缓存），拿这个对照">构建 ${PANEL_BUILD}</small></div>`
        + renderEntsToolbar(world, view, config)
        + body
        + empty
        + renderEntsPager(page);
}

// ============ 设定档案页（A-6：展示与 setting.frozen 逐字段一致） ============

// ★★leg62（用户令「之后增加一个独立抽取设定的入口方便我直抽设定快速看效果」）：**直抽刻度的结果栏**。
//   它只画"这一次抽到什么"，**不碰账本**（草稿放在 `world.context.__scaleDraft`，是会话态、不是契约字段）。
//   为什么必须如实画三样：① 每张表（表名 + 用途 + 档位/维度）；② **这次抽到几条**；
//   ③ ★**被出处闸丢掉的档位**——档位名对不上原文的会被净化层丢（见 `sanitizeScales`），
//      丢掉的不许静默，否则用户看到"怎么少了几档"却不知道是模型编的（本仓"漏了如实报"的纪律）。
export function renderScaleDraftHtml(draft) {
    if (!draft || typeof draft !== 'object') return '';
    const scales = Array.isArray(draft.scales) ? draft.scales : [];
    const nTiers = scales.reduce((n, t) => n + (t.档位 || []).length + (t.子表 || []).reduce((m, s) => m + (s.档位 || []).length, 0), 0);
    const nDims = scales.reduce((n, t) => n + (t.维度 || []).length, 0);
    // ★★leg62b（用户现场反馈「只抽刻度啥意思，我刚刚抽了有很多表，但是原本的内容还在」）：
    //   口径没错，是**呈现**没交代清楚——草稿和"已冻结的设定"在同一页长得一模一样，
    //   于是用户看不出哪些是刚抽的、哪些是账本里的（而且草稿的表名与旧账不同 ⇒ 更像"重复了"）。
    //   ⇒ 三道区分：① 标题写明这是草稿、② 每张草稿卡描橙色边 + 打「草稿」标、
    //     ③ 明说**下面那一部分是你已冻结的设定（一个字没动）**。
    //   为什么不做成"抽完替换掉下面那一栏"：那会让人以为**账本被改了**——恰恰是这条通道要避免的误会。
    const head = `<div class="sw2-set-card" style="grid-column:1/-1;border:1px solid #b26a00"><h4>只抽刻度 · 本次结果<span class="sw2-hint"> · 草稿（没入账）</span></h4>`
        + `<div class="sw2-hint">`
        + `源：${escapeHtml(draft.source || '—')} · 本次调用 ${draft.calls ?? '?'} 次 / ${draft.secs ?? '?'} 秒 · `
        + `抽到 <b>${scales.length}</b> 张表 · <b>${nTiers}</b> 个档位 · <b>${nDims}</b> 个维度`
        + (draft.dropped ? ` · <b>${draft.dropped}</b> 条档位因"原文里找不到"被丢（见下）` : '')
        + `</div>`
        + `<div class="sw2-hint"><b>这是草稿</b>：只是拿一次调用瞄一眼书里的尺子，<b>下面那一部分是账本里已冻结的设定，一个字没动</b>`
        + `（两边的表名不一样很正常——草稿是刚抽的，账本是上一版抽的）。`
        + `要用草稿取代账本，走正常的初始化/重抽。</div>`
        + (draft.errors?.length ? `<div class="sw2-hint">${escapeHtml(draft.errors.slice(0, 12).join(' ｜ '))}</div>` : '')
        + `<div style="margin-top:8px"><button class="sw2-btn" data-action="clear-scale-draft">清掉这一栏</button></div></div>`;
    const cards = scales.map((t) => {
        const tierRows = (t.档位 || []).map((x) => `<div class="sw2-sv-row"><b>${escapeHtml(x.档)}</b><span>${escapeHtml(x.注 || '')}</span></div>`).join('');
        const dimRows = (t.维度 || []).map((d) => `<div class="sw2-sv-row"><b>${escapeHtml(d.名)}</b><span>${escapeHtml(d.范围 || '（原文未给范围）')}</span></div>`).join('');
        const subRows = (t.子表 || []).map((s) => `<div class="sw2-sv-row"><b>${escapeHtml(s.名)}</b><span>${(s.档位 || []).map((y) => escapeHtml(y.档)).join(' · ')}</span></div>`).join('');
        const bits = [(t.档位 || []).length ? `${(t.档位 || []).length} 档` : '', (t.维度 || []).length ? `${(t.维度 || []).length} 维` : ''].filter(Boolean).join(' · ');
        // ★每张草稿卡：橙色左边框 + 「草稿」标（与账本里那批卡一眼可分）
        return `<div class="sw2-set-card" style="border-left:3px solid #b26a00"><h4>《${escapeHtml(t.名)}》`
            + `<span class="sw2-hint"> · ${escapeHtml(t.用途 || '（原文未给用途）')} · 草稿</span></h4>`
            + `<div class="sw2-hint">${escapeHtml(bits)}</div>${tierRows}${dimRows}${subRows}</div>`;
    }).join('');
    return head + (cards ? `<div class="sw2-sv-grid" style="grid-column:1/-1">${cards}</div>` : '')
        + `<div class="sw2-set-card" style="grid-column:1/-1"><h4>↓ 以下是你已冻结的设定（草稿没动它）</h4></div>`;
}

export function renderSettingHtml(world, { config = {} } = {}) {
    const dyn = world.context?.setting?.dynamic;
    const frozen = world.context?.setting?.frozen;
    // ★★leg52：**读真源，不读镜像**（与参数页/信息带同源 —— 详见 `paramEnvOverride` 的记档）。
    const env = resolveEnv(world, config.paramEnv);
    const t = dyn?.tension || {};
    if (!frozen) {
        return `<div class="sw2-sv-head"><div><div class="sw2-sv-title">世界设定</div>`
            + `<div class="sw2-sv-sub">尚未抽取——设定池未就绪。</div></div>`
            + `<div class="sw2-sv-cards"><span class="sw2-sv-chip stale">未抽取</span></div></div>`;
    }
    // ★★leg53：同信息带——设定页也不再画民生那一格（`PANEL_ENV_KEYS`，一处口径两个面共用）
    const envRows = PANEL_ENV_KEYS.map((k) => envRowHtml(k, env[k])).join('');
    const tides = (dyn?.derivedFrom || []).slice(-5).reverse().map((x) => tideLabel(world, x)).join('<br>');
    const canon = frozen.canon || {};
    // ★★★leg62（用户令「粒度不要太细了，换成概念表怎么样」）：**刻度 = 一概念一表**。
    //   病（用户截图 · 实教账）：旧口径把两张表平铺成两栏——「力量谱系（5 档）」把 `S~E级`（一把尺）
    //   与 `A班~D班`（**班级分配制度**）摆在一起；「维度与刻度（14 项）」把 5 个基础属性、5 个合成分、
    //   2 个公式混成一栏。⇒ 现在按概念分栏：一个概念一张卡（表名 + 用途 + 它的档位/维度）。
    //   分组来源：`resolveScales`（新账读 `canon.刻度`，旧账纯函数从 powerScale/dims 推导 ⇒ **零迁移**）。
    //   ★与进包同一个读取口（`pack.js` 也读它）——两处各推一次必然漂移成"面板分了两张表、包里还是一栏"。
    // ★★★leg63（用户现场拍板：「66 张表平铺在面板上，读不完、不成体系」）：**刻度按原文条目分节**。
    //   病（大荒真账实测）：66 张表 **425 档**全部平铺成一堵墙，一屏之内读不完；
    //     leg62 只解决了"条目级"的粒度（标签从每条档位挪到表头），**表与表之间仍是平级**。
    //   治法（口径三条，见 `groupScales` 头注）：① `源` 有 ⇒ 按原文条目分节；② 没有 ⇒ 落「未标条目」
    //     （老账零迁移，**不猜也不重抽**）；③ 顺序取账本出现序。
    //   呈现（沿用本仓既有口径，零 JS、零新动作）：**节上一层 `<details>` + 节内每张表再折一层**
    //     ⇒ 默认看到的是"这本书的尺子分成哪几节"（一屏读完），要看档位再逐节展开。
    //   ★为什么表也要折：66 张表若各自展开档位，分节之后**仍是 425 行**（分节治不了量）。
    const scaleCards = resolveScales(canon);
    const scaleGroups = groupScales(scaleCards);
    // ★leg63：**进包的真实读数**（读真源 `buildScaleAnchor`，不是在面板里另算一份）——
    //   下面那句提示要写"其中几张表几档进包"，这必须与引擎实际做的事逐个对上。
    const scaleAnchor = buildScaleAnchor(canon) || [];
    const scaleFit = scaleAnchor.length
        ? {
            表: scaleAnchor.length,
            档: scaleAnchor.reduce((n, t) => n + (t.档位 || []).length, 0),
            维: scaleAnchor.reduce((n, t) => n + (t.维度 || []).length, 0),
        }
        : null;
    const groupsHtml = scaleGroups.map((g, gi) => {
        const names = g.表.map((t) => t.名).join(' · ');
        const showNames = g.表.length <= 6 ? names : `${g.表.slice(0, 6).map((t) => t.名).join(' · ')} 等 ${g.表.length} 张`;
        const inner = g.表.map((t, ti) => {
            const tierRows = (t.档位 || [])
                .map((x) => `<div class="sw2-sv-row"><b>${escapeHtml(x.档)}</b><span>${escapeHtml(x.注 || '')}</span></div>`).join('');
            const dimRows = (t.维度 || [])
                .map((d) => `<div class="sw2-sv-row"><b>${escapeHtml(d.名)}</b><span>${escapeHtml(d.范围 || '（原文未给范围）')}</span></div>`).join('');
            const subRows = (t.子表 || []).map((sub) => (
                `<div class="sw2-sv-row"><b>${escapeHtml(sub.名)}</b><span>${(sub.档位 || []).map((y) => escapeHtml(y.档)).join(' · ')}</span></div>`
            )).join('');
            const bits = [
                tierRows ? `${(t.档位 || []).length} 档` : '',
                (t.维度 || []).length ? `${(t.维度 || []).length} 维` : '',
                (t.子表 || []).length ? `含子表 ${(t.子表 || []).length}` : '',
            ].filter(Boolean).join(' · ');
            return `<details class="sw2-fold"${ti === 0 && gi === 0 ? ' open' : ''}><summary><b>《${escapeHtml(t.名)}》</b>`
                + (bits ? `<span class="sw2-hint"> · ${escapeHtml(bits)}</span>` : '')
                + (t.用途 ? `<span class="sw2-hint"> · ${escapeHtml(t.用途)}</span>` : '') + `</summary>`
                + (tierRows || dimRows || subRows
                    ? `<div class="sw2-hint sw2-fold-body">${tierRows}${dimRows}${subRows}</div>`
                    : `<div class="sw2-hint sw2-fold-body">（这张表没有档位）</div>`)
                + `</details>`;
        }).join('');
        return `<details class="sw2-fold" style="margin-bottom:6px"><summary><b>${g.未标 ? '' : '条目：'}${escapeHtml(g.源)}</b>`
            + `<span class="sw2-hint"> · ${g.表.length} 张 · ${g.档} 档${g.维 ? ` · ${g.维} 维` : ''}</span></summary>`
            + `<div class="sw2-hint sw2-fold-body"><div class="sw2-hint" style="margin-bottom:6px">${escapeHtml(showNames)}</div>${inner}</div></details>`;
    }).join('');
    const nSect = scaleGroups.filter((g) => !g.未标).length;
    // ★leg60（交接第 3 件）：**编译完整性**——上限口径"漏了如实报"（数字全部来自初始化那一刻的探测，落账带过来）。
    const cp = frozen.compile;
    const compileLine = cp
        ? `编译完整性：书里条目 ${cp.entries ?? '?'}（启用 ${cp.enabled ?? '?'} / 禁用 ${cp.disabled ?? '?'}）`
            + ` · 作者点名 ${cp.declared ?? 0} 条 ⇒ 本次进料 ${cp.picked ?? 0} 条`
            + (cp.skipped ? ` · 未编译 ${cp.skipped} 条（${cp.skippedChars ?? 0} 字，题名仍进名册）` : '')
            + (cp.declaredDropped ? ` · ⚠顶到体积上限，声明面有 ${cp.declaredDropped} 条未进料` : '')
            + (cp.titleNames ? ` · 题名面贡献名号 ${cp.titleNames} 条（零调用）` : '')
            + (cp.settingTitles ? ` · 设定类条目覆盖 ${cp.settingCompiled ?? 0}/${cp.settingTitles}` : '')
        : '';
    const ruleRows = (canon.rules || []).map((r) => `<div class="sw2-sv-row"><b>法则</b><span>${escapeHtml(r)}</span></div>`).join('');
    const histRows = (canon.historyNotes || []).map((h, i) => `<div class="sw2-sv-hist"><span class="sw2-hist-tick">第 ${i + 1} 条</span><span>${escapeHtml(h)}</span></div>`).join('');
    // ★★leg52（BLACKLIST 漏网）：旧措辞是 `浪尖（派生源）：…`——**「派生源」是引擎术语**，
    //   而文件头（`:8`）从 leg26 起就把它列在"禁"字里，可 `BLACKLIST` 数组里**只有英文 `derivedFrom`**，
    //   于是这一句印了十几棒都没被"玩家可见文本零禁词"那几条全局扫描咬住（本仓判据只扫渲染产物，
    //   数组里没有的字面量＝不存在）⇒ 本棒补进数组，措辞同时改成玩家话：**「刚收尾的大动作」**
    //   （与观棋信息带那一栏**同一口径**，同一个概念在面板上只有一个说法）。
    //   ★`BLACKLIST` 那条新锁会同时守住这里与信息带（两条都扫渲染产物）。
    const envTitle = (dyn?.derivedFrom || []).length ? `浪尖 · 刚收尾的大动作：${tides}` : '浪尖：暂无';

    return `<div class="sw2-sv-head"><div><div class="sw2-sv-title">世界设定 · ${escapeHtml(world.context?.world || '')}</div>`
        + `<div class="sw2-sv-sub">书指纹 ${escapeHtml(frozen.fingerprint)} · 抽取于 ${escapeHtml(frozen.extractedAt)} · 全部条目取自原文，未增写一句（只提取不创作）</div></div>`
        + `<div class="sw2-sv-cards"><span class="sw2-sv-chip ok">✓ 已冻结 · 设定未变不重抽</span>`
        // ★★leg62b（用户令「我只想重抽设定」）：**只换设定、名册与进度一个字不动**。
        //   与「初始化」的区别写在这里（用户要能一眼看出按哪个不会把世界重开）：
        //   初始化 = 世界重新开局（实体账清空重种、棋子重建、轮次归零）；本按钮**只覆盖设定那一块**。
        + `<span class="sw2-hint" style="margin-left:8px">对设定不满意 ⇒ </span>`
        + `<button class="sw2-btn" data-action="reextract-setting">只重抽设定</button>`
        + `<span class="sw2-hint">（名册/进度不动）</span>`
        // ★leg62（用户令「独立抽取设定的入口方便我直抽设定快速看效果」）：草稿通道——只瞄一眼，不入账
        + `<span class="sw2-hint" style="margin-left:8px">只瞄一眼书里的"尺子" ⇒ </span>`
        + `<button class="sw2-btn" data-action="extract-scales">只抽刻度</button>`
        + `</div></div>`
        + (world.context?.__scaleDraft ? renderScaleDraftHtml(world.context.__scaleDraft) : '')
        + `<div class="sw2-sv-grid">`
        + `<div class="sw2-set-card" style="grid-column:1/-1"><h4>张力现状（演变层 · 引擎算 · 每轮随动）</h4>`
        + `<div class="sw2-clash-main">${escapeHtml(t.polarity || '未聚')} <span class="sw2-int">${fmtPct(t.intensity)}</span></div>`
        + `<div class="sw2-clash-sub">${escapeHtml(t.direction ? t.direction + '（原文方向）' : '僵持（无明确方向）')} · 近${TENSION_WINDOW}轮事件 ${recentEventCount(world)} 件</div>`
        + `<div style="margin-top:6px;font-size:12px;color:var(--sw2-text-faint)">上面这个数是引擎每轮重算的读数（惯性平滑，0–1）。<b>它目前主要由"近${TENSION_WINDOW}轮事件数"驱动</b>——公式里的"两强对峙度"一项实测恒为满值（势力四维普遍为空时会全体同值），所以它并不表示"引擎判断了天下张力"。</div>`
        + `<div class="sw2-env">${envRows}</div>`
        + `<div style="margin-top:8px;font-size:12px;color:var(--sw2-text-faint)">${envTitle}</div>`
        + `<div style="margin-top:10px"><button class="sw2-btn" data-action="clear-evolution">清除演化层（回基线）</button><span class="sw2-hint">只清张力强度/环境量/浪尖——设定与极性方向不动，不触发抽取调用。</span></div></div>`
        + (scaleCards.length
            ? `<div class="sw2-set-card" style="grid-column:1/-1"><h4>刻度（一概念一表 · ${scaleCards.length} 张${nSect ? ` · 按原文条目分 ${nSect} 节` : ''}）</h4>`
                + `<div class="sw2-hint">书里的尺子按"一个概念一张表"分栏——衡量强弱的尺、决定资源怎么分的制度、`
                + `取值范围、换算表<b>各自成表</b>，不再挤在同一个框里。`
                + (nSect ? `表多时按<b>原文条目</b>分节（这张尺出自书里哪一条，就归到那一条下），先看"分成哪几节"，再逐节点开看档位。` : '')
                + `</div>`
                // ★★leg63：**同一句里两个数必须都是真的**（如实报，不许给假成绩）。
                //   过去这里写的是"这些表每轮都在模型的包里当锚"——而进包有体积上界
                //   （表 ≤16 · 档 ≤24 · 维 ≤8，见 `buildScaleAnchor`），大荒真账 66 张表 425 档
                //   只有 4 张表 24 档进得去 ⇒ **那句话当年就是不准确的**。现在按账上的真实读数分开说。
                + (scaleFit
                    ? `<div class="sw2-hint">其中 <b>${scaleFit.表}</b> 张表 / <b>${scaleFit.档}</b> 档 / <b>${scaleFit.维}</b> 维每轮进模型的包当锚`
                        + `（写实力/属性时按书里的尺子写，不自造形容词）；表与档太多时按账本顺序取前面那些，`
                        + `其余留在本页与账本里，不进每轮包。</div>`
                    : '')
                + `</div>`
            : '')
        + (scaleCards.length ? `<div class="sw2-sv-grid" style="grid-column:1/-1"><div style="grid-column:1/-1">${groupsHtml}</div></div>` : '')
        + (compileLine ? `<div class="sw2-set-card" style="grid-column:1/-1"><h4>编译完整性（初始化那一刻的读数）</h4>`
            + `<div class="sw2-hint">${escapeHtml(compileLine)}</div>`
            + (cp?.missedTitles?.length ? `<div class="sw2-hint" style="margin-top:4px">未编译的设定类条目（前 ${cp.missedTitles.length} 个）：${escapeHtml(cp.missedTitles.join('、'))}</div>` : '')
            + `</div>` : '')
        + `<div class="sw2-set-card"><h4>法则（${(canon.rules || []).length} 条）</h4>${ruleRows || '<div class="sw2-sv-row"><span>（无）</span></div>'}</div>`
        + `<div class="sw2-set-card"><h4>社会格局 · 力量体系</h4><p class="sw2-sv-para">${escapeHtml(canon.society || '（无）')}</p><p class="sw2-sv-para">${escapeHtml(canon.techOrMagic || '（无）')}</p></div>`
        + `<div class="sw2-set-card"><h4>史略（${(canon.historyNotes || []).length} 条）</h4>${histRows || '<div class="sw2-sv-hist"><span>（无）</span></div>'}</div>`
        + `</div>`;
}

// ============ 设置页 ============

export function renderSettingsHtml(world, { config = {}, oldVolumes = [] } = {}) {
    const cfg = config || {};
    // ★leg40b（第二刀 · 死代码）：这里原本造了一个四维浮点的 `envText` 再 `void` 掉
    //   （`{民生度:0.5,…}` + `void envText`）——四维时代留下的化石，什么都不做。删。
    return `<div class="sw2-settings">`
        + `<div class="sw2-set-card"><h4>世界设定（书的来源）</h4>`
        + `<div class="sw2-source-line"><span class="sw2-source-tag">来源：角色卡 + 世界信息（自动合订）</span>`
        + `<span class="sw2-source-note">自动读取：卡四件套 + 世界信息/卡内置世界书（世界书全量摄入，大书分块多次抽取）；抽取只拿三样——设定五件套 · 世情句 · 名号与类别（书里的上级/所在/实力不抄，用到时现查：<b>实力</b>按需去书里取原话，<b>所在与上级</b>只由账上的组织驻地与隶属结构推断）</span></div>`
        + `<div class="sw2-hint" style="margin-top:10px">设定全文（力量谱系/法则/社会格局/力量体系/史略 + 张力现状）在「设定」页阅览；书变了会自动重新识别（书指纹），不用手动重抽。</div></div>`
        + `<div class="sw2-set-card"><h4>你的开档描述</h4>`
        + `<div class="sw2-field"><label>写一段"你是谁"（自然语言 · ≤2000 字提案）</label>`
        // ★leg40b（第二刀 · D 类残留）：`data-action="player-desc"` 是历史残留——这个 textarea 由
        //   `bindSettingsForm` 按 id 绑 input/change 写入，**不经动作总线**；留着它只会让点击时
        //   走 `dispatchAction` 的兜底分支、在状态条闪一句"接线随后续步骤"。撤掉（判据同步收窄 NON_BUS 白名单）。
        + `<textarea id="sw2_player_desc">${escapeHtml(cfg.playerDesc || '')}</textarea>`
        // ★★leg40b（C4 · 四维残文）：这句原来写「世界从中摘你的底子（**兵力/权位/人脉/耳目**）」——
        //   那四个概念在 leg25 c 已按用户令**整条删除**（本文件头部 103-107 行就是删除留档），
        //   而设置页还在向玩家承诺"会摘这四样"。它躲过禁词锁的原因：`test/render.test.js` 扫的是
        //   `renderAll(夹具世界())`，而夹具的 `playerDesc` 是「我名黄坤，炼气九层。」——不含那四个词。
        //   （夹具已同步改成含四维词的串，让那条禁词锁真的能咬住这一句。）
        + `<div class="sw2-hint">世界从中读你的来历与身份（你写的原话），落成棋子自己的处境；读不出来的地方就空着，由世界提议；你手填过的一律不动。</div></div></div>`
        + `<div class="sw2-set-card"><h4>模型通道</h4>`
        + `<div class="sw2-field"><label>服务地址</label><input class="sw2-input" id="sw2_base" value="${escapeHtml(cfg.baseUrl || '')}"></div>`
        + `<div class="sw2-field"><label>密钥</label><input class="sw2-input sw2-key-mask" id="sw2_key" value="${escapeHtml(cfg.apiKey ? '••••••••••••••••••••' : '')}"><div class="sw2-hint">本机读取 · 不落库 · 不打印</div></div>`
        + `<div class="sw2-field"><label>世界模型</label><input class="sw2-input" id="sw2_model" value="${escapeHtml(cfg.model || '')}"></div>` 
        // ★★★leg54（**修一个真的显示 bug**）：这一行原来是写死的「提案：120 秒 / **4096 字**」，
        //   而实值是 **16384**（第十九棒拍板 `4096 → 16384`，`transport-http.js` 的 E3 记档，
        //   `test/transport-http.test.js` 锁着）⇒ 面板印了一个**过期好几棒的数**。
        //   ⇒ 改成**从真源现读**（`PROPOSED_CALL_LIMITS`），从此不可能再写歪。
        //   ★教训（本棒我自己踩的，写在这里防下一任）：我就是**先信了这行**把预算记成 4096、
        //     差点据此劝用户"不要放开上限"——**UI 上的数字也是要核的**，它和代码一样会过期。
        + `<div class="sw2-field"><label>单轮演算上限（${Math.round(PROPOSED_CALL_LIMITS.timeoutMs / 1000)} 秒 / ${PROPOSED_CALL_LIMITS.maxTokens} token）</label>`
        + `<input class="sw2-input" id="sw2_limits" value="${Math.round(PROPOSED_CALL_LIMITS.timeoutMs / 1000)}s · ${PROPOSED_CALL_LIMITS.maxTokens}" readonly title="${attrText('随 K38 报批联动后生效')}">`
        + `<div class="sw2-hint">这是<b>模型一次回复</b>的长度上限（推理与正文<b>共享</b>这一份）。`
        + `<b>世界尺度</b>那几个框填得再大，一轮里也只能写这么多。</div></div></div>`
        + `<div class="sw2-set-card"><h4>操作</h4><div class="sw2-actions">`
        + `<button class="sw2-btn sw2-primary" data-action="init-world">✨ 开始新世界</button>`
        // ★leg40b（D1）：名字与状态栏/参数页统一成「推进一轮」（原来叫「手动推进一步」，
        //   而状态栏三处在教玩家"按观棋窗口的「推进一轮」"——面板上根本没有那个名字的按钮）。
        + `<button class="sw2-btn" data-action="advance-world">▶ 推进一轮</button></div>`
        + `<div class="sw2-hint" style="margin-top:10px">每轮对话后世界自动推进（总闸开着时）；此按钮是手动补推，<b>关着总闸也能按</b>。<br>设定不用手动重抽：书变了（书指纹变化）自动重新识别，已定的设定不会自己飘。<br>演算失败时世界原样不动，状态条会报错，可重试。</div></div>`
        + `<div class="sw2-set-card" style="grid-column:1/-1"><h4>旧卷与存储</h4>`
        + `<div class="sw2-cold-mgmt"><div class="sw2-row"><span>编年体积 · 当前</span><b>${(world.chronicle || []).length ? `${(JSON.stringify(world.chronicle).length / 1024).toFixed(1)}KB` : '0KB'}</b><em>每 100 轮约 21.7KB（实测）</em></div>`
        // ★★★leg55（结掉 leg40b 体检登记、坐实 leg54 §6.4 那条纪律）：这一行原本是
        //   `${cfg.limitsTicks ?? '500'} 轮 或 ${cfg.limitsBytesMB ?? '5'}MB`——而 `renderCfg()`
        //   **从不注入这两个键** ⇒ 生产上永远是 `undefined`、兜底字面量恒生效，
        //   "从 config 现读"是**死路**：它印的其实是渲染层自己抄的一份数（值与真源一致，纯属巧合维持）。
        //   ⇒ 两件事一起做：①`web/index.js` 的 `renderCfg()` 接上 `PROPOSED_LIMITS`（真源）；
        //     ②判据锁死"接线层真的注入了这两键"（见 `test/render.test.js` leg55 那条）。
        //   ★为什么这正是 leg54 那个 4096 的同一种病：**面板上的数字悄悄脱离真源**，字面量看着对，
        //     真源一改它就变成谎话（4096 那行就是这么过期了好几棒）。
        + `<div class="sw2-row"><span>自动入卷阈值</span><b class="sw2-thr">${fmtLimitNum(cfg.limitsTicks, 500)} 轮 或 ${fmtLimitNum(cfg.limitsBytesMB, 5)}MB</b><em>提案态 · 随本阶段报批</em></div>`
        + `<div class="sw2-row"><span>入卷去处</span><b>插件本地 · 可导出可导入</b><em>割断的是旧账，不是来龙去脉</em></div>`
        + `${renderVolumeListHtml(oldVolumes)}<div class="sw2-actions" style="margin-top:8px">`
        + `<button class="sw2-btn" data-action="export-world">⬇ 导出整聊天</button>`
        + `<button class="sw2-btn" data-action="import-world">⬆ 导入恢复</button></div></div>`
        + `</div>`;
}

// K35：旧卷清单（设置页/旧卷页共用行渲染；阅卷=还原前置段回编年视图）
export function renderVolumeListHtml(oldVolumes = []) {
    if (!oldVolumes.length) return `<div class="sw2-row"><span>入卷清单</span><b>尚未入卷——编年仍在热账</b><em></em></div>`;
    const rows = oldVolumes.map((v) => `<div class="sw2-row"><span class="sw2-vol">${escapeHtml(v.id)}</span>`
        + `<b>${escapeHtml(v.info)}</b><em><span class="sw2-volact" data-action="read-volume" data-vol="${escapeHtml(v.id)}">阅卷</span></em></div>`).join('');
    return `<div class="sw2-row" style="display:block"><span>入卷清单</span>${rows}</div>`;
}

// K35：阅卷还原视图——卷段行（storage.volumeToChronicleRows 产物）→ 编年行 HTML（A-3：引擎 id 只进悬停）
export function renderVolumeReadHtml(volumeId, rows = []) {
    const line = (r) => `<div class="sw2-ch-line${r.eventRef ? ' sw2-ch-event' : ''}">`
        + `<span class="sw2-ch-round">${escapeHtml(r.tick)}</span>`
        + `<span class="sw2-ch-text">${escapeHtml(r.text)}</span>`
        + (r.eventRef ? `<span class="sw2-ref" title="${escapeHtml(r.eventRef)}">？</span>` : '')
        + `</div>`;
    const body = rows.length ? rows.map(line).join('') : '<div class="sw2-ch-line"><span class="sw2-ch-text">（空卷）</span></div>';
    return `<div class="sw2-chronicle" id="sw2_volume_read" data-volume="${escapeHtml(volumeId)}">${body}</div>`;
}

// ============ K41 链视图（细案 §3.2/§3.3 → A-15 渲染面；珠链形态=chain-view-mockup.html v3 沙漏） ============
// 纯函数、零创作：把 chain.js 展开器的节点链渲染成珠链 HTML——id → 玩家名/措辞全在本层；
// 引擎 id 只进悬停 title 与「展开条目」管理区（A-3 豁免口径）；阅卷按钮按纪 span ∩ 卷 fromTick/toTick 装配。

function cvVols(volumes, span) {
    return (volumes || []).filter((v) => {
        const f = Number.isFinite(v.fromTick) ? v.fromTick : -Infinity;
        const t = Number.isFinite(v.toTick) ? v.toTick : Infinity;
        return t >= (span?.from ?? 0) && f <= (span?.to ?? Infinity);
    });
}
const cvOpenBtns = (vols) => (vols.length
    ? `<span class="sw2-cv-vols">${vols.map((v) => `<button class="sw2-volact" data-action="read-volume" data-vol="${escapeHtml(v.id)}">阅卷 · ${escapeHtml(v.id)}</button>`).join('')}</span>`
    : '');
const cvVerdict = (a) => {
    if (!a.closed) return '<span class="sw2-cv-verdict open">在办</span>';
    return (a.blockedTail || '').startsWith('放弃')
        ? '<span class="sw2-cv-verdict stop">已终止</span>'
        : '<span class="sw2-cv-verdict done">已了结</span>';
};
const cvVb = (v) => (v === 'concealed' ? '<span class="sw2-visible v-hidden">暗</span>' : '<span class="sw2-visible v-known">明</span>');
const cvDots = (p, m) => {
    const s = [];
    for (let i = 0; i < m; i += 1) s.push(`<i class="${i < p ? 'on' : ''}"></i>`);
    return `<span class="sw2-cv-dots">${s.join('')}</span>`;
};
const cvChip = (x) => `<span class="sw2-cv-chip${x.visibility === 'concealed' ? ' dark' : ''}">${escapeHtml(x.goal)}${x.visibility === 'concealed' ? '（暗）' : ''} · ${x.closed ? '已了结' : '在办'} ${x.progress ?? 0}/${x.maxSteps ?? 0}</span>`;
const cvSrcPhrase = (n) => {
    if (!n) return '由世界处境而生';
    if (n.kind === 'event') return `沿「${n.title}」而来`;
    if (n.kind === 'agenda') return `由盘算「${n.goal}」而生`;
    if (n.kind === 'milestone') return '源头已入大事纪';
    if (n.kind === 'gap') return '沿「旧事」而来（已无从检索）';
    if (n.kind === 'terminal') return '纪之源头已不可查';
    return '由世界处境而生';
};
// ★leg40：**世界源起的根**（`source.type==='seed'`）在链视图里的说法——
//   它与"由世界处境而生"必须分开：前者是**书里写着的事**（有出处），后者是**局势自己拱出来的**。
//   混成一句会把"这条线有没有来路"说反，而 leg40 整套改动修的正是"线没有来路"。
const cvSeedPhrase = (n) => (n?.seedFrom?.quote
    ? `书里的事：「${String(n.seedFrom.quote).slice(0, 40)}」`
    : '由世界源而起');

function cvUpBeads(world, nodes, volumes) {
    return (nodes || []).map((n, i) => {
        if (n.kind === 'event') {
            const src = cvSrcPhrase(nodes[i - 1]);   // 更远一侧 = 本事件的来路
            return `<div class="sw2-cv-bead ev"><span class="sw2-cv-bk">事</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">${escapeHtml(n.title)}<span class="sw2-cv-src">事件 · ${fmtTick(n.born)} · ${n.closed ? '已了结' : '未了结'}</span></div>`
                + `<div class="sw2-cv-meta">${src}</div></div></div>`;
        }
        if (n.kind === 'agenda') {
            return `<div class="sw2-cv-bead ag${n.visibility === 'concealed' ? ' dark' : ''}"><span class="sw2-cv-bk">谋</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">${escapeHtml(n.goal)}${cvVb(n.visibility)}${cvVerdict(n)}<span class="sw2-cv-src">谋划 · ${escapeHtml(entityLabel(world, n.owner))} · 阶段 ${escapeHtml(n.stage)}</span></div>`
                + `<div class="sw2-cv-meta">${cvDots(n.progress, n.maxSteps)} ${n.progress}/${n.maxSteps}</div>`
                + (n.doneTail ? `<div class="sw2-cv-meta dim">最近一步：${escapeHtml(n.doneTail)}</div>` : '')
                + (n.blockedTail ? `<div class="sw2-cv-meta dim blk">受阻：${escapeHtml(n.blockedTail)}</div>` : '')
                + (n.parents.length ? `<div class="sw2-cv-meta">委派自上：${n.parents.map(cvChip).join('')}</div>` : '')
                + (n.children.length ? `<div class="sw2-cv-meta">下沿子谋划：${n.children.map(cvChip).join('')}</div>` : '')
                + (n.fruits.length ? `<details class="sw2-cv-roll"><summary>产果 · ${n.fruits.length} 件（由本谋划生的事件）</summary><div class="sw2-cv-in">${n.fruits.map((f) => `${escapeHtml(f.title)}（${fmtTick(f.born)}${f.closed ? ' · 已了结' : ''}）`).join(' · ')}</div></details>` : '')
                + `</div></div>`;
        }
        if (n.kind === 'milestone') {
            return `<div class="sw2-cv-bead ms"><span class="sw2-cv-bk">纪</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">大事纪<span class="sw2-cv-src">第 ${n.span.from}–${n.span.to} 轮 · ${n.counts.events ?? 0} 件事</span></div>`
                + `<div class="sw2-cv-meta">“${(n.titles || []).slice(0, 3).map(escapeHtml).join(' · ')}”</div>`
                + ((n.ids || []).length ? `<details class="sw2-cv-roll"><summary>展开这一纪的条目（管理细节）</summary><div class="sw2-cv-in">${escapeHtml(n.ids.join(' · '))}</div></details>` : '')
                + cvOpenBtns(cvVols(volumes, n.span))
                + ((n.parents || []).length ? `<div class="sw2-cv-nest">${cvUpBeads(world, n.parents, volumes)}</div>` : '')
                + `</div></div>`;
        }
        if (n.kind === 'state-root') {
            return `<div class="sw2-cv-bead term"><span class="sw2-cv-bk">源</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">由世界处境而生<span class="sw2-cv-src">终节点 · 不再更上</span></div>`
                + `<div class="sw2-cv-meta">处境是事件的起点——账上没有比它更早的来路。</div></div></div>`;
        }
        // ★leg40：世界源起的根（书里那句"正在发生的事"）——与"由世界处境而生"分开显示
        if (n.kind === 'seed-root') {
            return `<div class="sw2-cv-bead term"><span class="sw2-cv-bk">源</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">由世界源而起<span class="sw2-cv-src">书里的事 · 不是局势自变</span></div>`
                + `<div class="sw2-cv-meta">${escapeHtml(cvSeedPhrase(n))}</div></div></div>`;
        }
        if (n.kind === 'gap') {
            return `<div class="sw2-cv-bead gap"><span class="sw2-cv-bk">旧</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">${n.reason === 'ring' ? '环防' : '沿「旧事」而来'}<span class="sw2-cv-src">${n.reason === 'ring' ? '至此为止' : '已无从检索'}</span></div>`
                + `<div class="sw2-cv-meta">${n.reason === 'ring' ? '引用成环，链在此剪断（账不可信处的如实标注）。' : '引用的上游既不在热账也不在任何大事纪——正直展示，不猜内容。'}</div></div></div>`;
        }
        if (n.kind === 'terminal') {
            return `<div class="sw2-cv-bead term"><span class="sw2-cv-bk">源</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">纪之源头已不可查（旧账）<span class="sw2-cv-src">最老的大纪</span></div>`
                + `<div class="sw2-cv-meta">最老的纪没有记录更早的来路——如实显示，不猜不编。</div></div></div>`;
        }
        return '';
    }).join('');
}

function cvDownTree(world, nodes, volumes) {
    const bead = (n) => {
        if (n.kind === 'event') {
            return `<div class="sw2-cv-branch"><div class="sw2-cv-bead ev"><span class="sw2-cv-bk">事</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">${escapeHtml(n.title)}<span class="sw2-cv-src">事件 · ${fmtTick(n.born)} · ${n.closed ? '已了结' : '未了结'}${n.ring ? '（环防）' : ''}</span></div></div></div>`
                + ((n.children || []).length ? `<div class="sw2-cv-nest">${n.children.map(bead).join('')}</div>` : '')
                + `</div>`;
        }
        if (n.kind === 'leaf-note') {
            return `<div class="sw2-cv-branch"><div class="sw2-cv-bead leaf"><span class="sw2-cv-bk">卷</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">另有后续在旧卷<span class="sw2-cv-src">第 ${n.span.from}–${n.span.to} 轮 · 已随段入卷</span></div>`
                + `<div class="sw2-cv-meta">这一支的后续牵动已随段入卷——阅卷看全文。${cvOpenBtns(cvVols(volumes, n.span))}</div></div></div></div>`;
        }
        return '';
    };
    return `<div class="sw2-cv-col">牵动 · 下沿（▼ 向未来）</div><div class="sw2-cv-tree">${(nodes || []).map(bead).join('')}</div>`;
}

export function renderChainViewHtml(chain, { world, volumes = [] } = {}) {
    if (!chain || !chain.ok) {
        return `<div class="sw2-cv" id="sw2_chain_view"><div class="sw2-cv-head"><div class="sw2-cv-t">事件链</div>`
            + `<button class="sw2-btn sw2-cv-close" data-action="chain-close">收起</button></div>`
            + `<div class="sw2-cv-def">没有这条事件（已无从检索）。</div></div>`;
    }
    const root = chain.root;
    const isMs = root.kind === 'milestone';
    const nearSrc = (chain.up || []).at(-1);
    const up = isMs ? (root.parents || []) : (chain.up || []);
    const hero = isMs
        ? `<div class="sw2-cv-hero"><span class="sw2-cv-hx">纪</span><div><div class="sw2-cv-hn">大事纪 · 第 ${root.span.from}–${root.span.to} 轮 · ${root.counts.events ?? 0} 件事</div>`
            + `<div class="sw2-cv-hm">“${(root.titles || []).slice(0, 3).map(escapeHtml).join(' · ')}”${cvOpenBtns(cvVols(volumes, root.span))}</div></div></div>`
        : `<div class="sw2-cv-hero"><span class="sw2-cv-hx">事</span><div><div class="sw2-cv-hn">“${escapeHtml(root.title)}”</div>`
            + `<div class="sw2-cv-hm"><span><b>源自</b>：${cvSrcPhrase(nearSrc)}</span><span><b>事发</b>：${escapeHtml(root.position)}</span>`
            + `<span><b>${fmtTick(root.born)}</b> · ${root.closed ? '已了结' : '未了结'}</span></div></div></div>`;
    return `<div class="sw2-cv" id="sw2_chain_view">`
        + `<div class="sw2-cv-head"><div class="sw2-cv-t">${isMs ? '大事纪的来去' : `事件「${escapeHtml(root.title)}」的来去`}</div>`
        + `<button class="sw2-btn sw2-cv-close" data-action="chain-close">收起</button></div>`
        + `<div class="sw2-cv-col">来路 · 上承（▲ 向更早）</div><div class="sw2-cv-rail">${cvUpBeads(world, up, volumes)}</div>`
        + `<div class="sw2-cv-axis"></div>${hero}<div class="sw2-cv-axis"></div>`
        + cvDownTree(world, chain.down || [], volumes)
        + `<div class="sw2-cv-foot">全部为一手事实拼句：来路/牵动取自账本指针与落账文本，引擎不新编一字。</div>`
        + `</div>`;
}

// ============ 六页签全集入口（K34 接线用；同输入逐字节一致 A-2 锁） ============

// leg27 后 · 快照容错（细案 docs/spec-snapshot-fault-tolerance.md；用户拍板：IDB 独立库 / 15 步 / 只回世界账）
// 渲染纪律（同批量补全的先例）：**渲染层不持任务状态**——快照清单由 config 注入（web/index.js 读 IDB 后传入）。
//   面板零第二份状态：这里只把事实画出来，一份都不缓存。
export function renderSnapshotsHtml(world, { config = {} } = {}) {
    const snap = config?.snapshots || null;
    const rows = Array.isArray(snap?.list) ? snap.list : [];
    const seqOf = (s) => { const m = /^s(\d+)$/.exec(String(s?.id ?? '')); return m ? Number(m[1]) : -1; };
    const sorted = [...rows].sort((a, b) => seqOf(b) - seqOf(a));   // 最新在前（面板按"最近能退到哪"读）
    const kb = (n) => ((Number(n) || 0) / 1024 >= 1024 ? `${((Number(n) || 0) / 1024 / 1024).toFixed(2)}MB` : `${Math.round((Number(n) || 0) / 1024)}KB`);
    const line = (s) => {
        const kindWord = s.kind === 'full' ? '完整' : '增量';
        const when = String(s.at || '').slice(11, 19);
        // ★leg27 d（用户实拍「怎么一下子多了这么多」时那一屏）：旧行同时打「第 N 轮」**和** `reason`，
        //   而 reason 默认就是"落账" ⇒ 每行都重复一遍"落账"，信息量为零还占宽。现在只打**触发词**，
        //   轮次由 `· 第 N 轮` 承担（两者一个事实，不打两遍）。
        const trigger = String(s.reason || '').replace(/（.*?）$/, '').trim() || '落账';
        return `<div class="sw2-row" data-snap="${escapeHtml(s.id)}">`
            + `<span class="sw2-snap-id">${escapeHtml(s.id)}</span>`
            + `<span class="sw2-snap-tick">${escapeHtml(trigger)} · 第 ${s.tick == null ? '?' : s.tick} 轮</span>`
            + `<span class="sw2-snap-kind">${kindWord} ${kb(s.bytes)}</span>`
            + `<span class="sw2-snap-at">${escapeHtml(when)}</span>`
            + `<button class="sw2-btn" data-action="snapshot-restore" data-snap="${escapeHtml(s.id)}" data-tick="${s.tick == null ? '' : s.tick}">回到此步</button>`
            + `</div>`;
    };
    const head = `<div class="sw2-sv-head"><div><div class="sw2-sv-title">快照 · 每一步都能退回去</div>`
        + `<div class="sw2-sv-sub">每一次落账（演化 / 查书 / 批量补全 / 初始化）都会拍一份。存<b>插件本地库</b>（不占聊天文件），保留最近 <b>15 步</b>。`
        + `<b>回到某一步 = 只回世界账</b>，对话记录不动。</div></div>`
        + `<div class="sw2-sv-cards"><span class="sw2-sv-chip ${rows.length ? 'ok' : 'stale'}">${escapeHtml(snap?.text || '快照 —')}</span></div></div>`;
    if (!snap) {
        return head + `<div class="sw2-hint">快照清单还没读到（首次落账后出现；若一直为空请 Ctrl+F5 并看控制台）。</div>`;
    }
    if (!rows.length) {
        return head + `<div class="sw2-hint">还没有快照——世界每落一次账就会拍一份（当前 0 份）。</div>`;
    }
    return head
        + `<div class="sw2-sv-grid"><div class="sw2-set-card" style="grid-column:1/-1">`
        + `<h4>可回退的步（最新在前 · ${rows.length} 份）</h4>`
        + `<div class="sw2-hint" style="margin-bottom:8px">「完整」= 整份世界（锚点，每 5 步一份）；「增量」= 相对锚点的差异。`
        + `恢复用「锚点 + 增量」两步，所以点任意一份都是**一步到位**，不需要重放整条链。</div>`
        + sorted.map(line).join('')
        + `</div></div>`
        + `<div class="sw2-row"><span class="sw2-actions">`
        + `<button class="sw2-btn sw2-danger" data-action="snapshot-clear">重置快照（清空并重拍链头）</button>`
        + `</span><em>用于清掉旧代码/丢账时拍下的那批不可信快照；清完从当前世界重新起链</em></div>`;
}

export function renderAll(world, { config = {}, oldVolumes = [], view = {} } = {}) {
    return {
        board: renderBoardHtml(world, { config }),
        chronicle: renderChronicleHtml(world, { oldVolumes, view: view.chronicleView ?? null }),
        archive: renderArchiveHtml(world, { oldVolumes }),
        // ★leg49：实体页视图态随 `view.entsView` 透传（与 `view.chronicleFilter` 同款）——
        //   工具条的搜索/筛选/排序/翻页都落在这一个对象上（接线层只存状态，选数据住本层纯函数）。
        entities: renderEntitiesHtml(world, { config, view: view.entsView || {} }),
        setting: renderSettingHtml(world, { config }),
        params: renderParamsHtml(world, { config }),   // leg26：参数独立页签（玩家定档位）；leg27 h：+ 记忆投递自证
        snapshots: renderSnapshotsHtml(world, { config }),   // leg27 后：快照容错（每步可回退）
        settings: renderSettingsHtml(world, { config, oldVolumes }),
        header: {
            world: world.context?.world ?? '',
            tick: fmtTick(world.meta?.tick ?? 0),
        },
    };
}
