// story-world-v2/src/memory-bridge.js
// 记忆投递（leg26 b）：把**引擎账上的事实**投进 SillyTavern 的记忆插件（柚月の记忆 / yuzuki-Memory）。
//
// 为什么这么做（用户 2026-09-11 点单）：
//   用户发现一个真裂缝——**世界跑久了，聊天 LLM 不知道"已经发生过什么"**：RP 注入只有本 tick 的
//   `【世界动向】`（带因果指针的编年行），位置/格局/旧账**都不进注入**，而注入是 append-only：
//   旧行被上下文挤出窗口 ⇒ 模型忘 ⇒ 它就开始自己编。⇒ **真相（账）与对话（笔）之间没有桥**。
//   用户给的解法是现成的：**投到记忆插件**——"记住发生过什么"本来就是它的活，我们不自己造记忆。
//
// 设计口径（每条都有理由）：
//   ① **逐字投引擎原话，不经过任何 LLM**。插件自己的自动总结**会跳过 system 消息**、且会对普通消息
//      再总结一遍——那会把引擎事实**意译**一次（正是本项目一路在躲的事）。⇒ 我们走**代码级直接写记忆表**
//      （`window.YuzukiMemory` 是公开命名空间），文字**逐字**保持编年原话。
//   ② **两种形状**（leg30 收口；用户 2026-09-12 追问「前史和发生不是一个东西吗？」后改定）：
//      · **当下**：一张表**一条记录、每轮覆盖**——写"世界现在什么样"（第几轮 / 在办 / 未了结 / 参数）。
//      · **发生**：一张表**一条一行、追加**——写"世界发生过什么"；**老了原地压成一段**（见 ②.2）。
//      为什么不是三类：**"前史"与"发生"是同一批事件的两个粒度**，不是两类东西。
//   ②.2 **前史 = 同一个列表里"比较老的那些行"**（★leg30 修正，此前是设计错误）：
//      `settle.js` 的 `archiveClosedEvents` 把「闭环满 `ARCHIVE.hotWindow=20` 轮且整链结清」的事件
//      按出生段（`milestoneEvery=10`）压成里程碑 `{span, counts, titles, ids}`，并把它们**从热池删掉**
//      （段外指针重指里程碑：割断的是热池文本，不是链条）。⇒ 里程碑里的 `titles` **就是它吃掉的那批事件的标题**。
//      旧版把里程碑投成**第三张表**（`史卷纪要`）⇒ **同一批事件在插件里出现两次**（一次逐条、一次成段），
//      且该表与状态表共用 `world_setting` ⇒ 侧栏里"世界状态卡"与"史卷纪要卡"混在一列、长得一模一样。
//      现口径：**只有一个列表**，近处逐条、远处成段，`轮次` 列一眼可分（`第 9 轮` vs `第 1–10 轮`）。
//   ③ **剥掉引擎内码**：`ev_143_2`/`a_12_1`/`e_bk_7` 对聊天 LLM 毫无意义，投出去只污染上下文。
//      投的字段全部来自**编年文本与人话**（编年本来就是人话——"说人话是最高准则"）。
//   ④ **失败绝不影响世界**：插件没装/没加载/抛错 → 静默跳过（调用方也包 try）；世界推进永远优先。
//   ⑤ 分层：**编排层**（铁律 9）——零 DOM、零 Node 内建；"往哪儿写"由调用方注入（`store` 依赖注入）。
//
// 表名/列名是**中文人话**：记忆表是给人看也给模型读的，键名即语义（与 `实力`/`env` 四键同口径）。
//
// ★leg30 **一字段一义**（用户实机发现「大虞、你」被塞进"物品位置"格 ⇒ 一个字段装了两义）：
//   `物品位置` 只装**地点**（账上 `event.position`）；**波及名单**挪进**人形图标**的 `持有者` 格；
//   `状态` 装"了结没"（空 ⇒ 插件会显示"未标记"，是插件行为，我们不再拿它当垃圾桶）；
//   `备注` **我方一个字不写**（那是留给用户手写的格子，每轮覆盖会把他的字抹掉）。
//   同一条纪律也适用于"格子的取舍"：没有真数据的格子**整行不出现**，不许用 `—` 充数。

import { paramsRows, PANEL_ENV_KEYS } from './params.js';   // ★leg53：PANEL_ENV_KEYS = 面板口径（民生已撤，这一面跟着走）
// leg29：`positionLine` **不再 import**——用户口径「位置不用管，聊天 llm 知道」，本桥已在 leg29 去掉位置面。
//   留着它就是"死 import"（本仓在 leg25 f 专门清过这类东西：纸面机制与死代码一样有毒）。

// ============================ 表 id 与列形状对齐插件（leg29 用户拍板） ============================
// 起因（用户实机「投递是投递了但是**看不到内容**」）：数据一直是对的，空的是**插件的详情视图**——
//   `yuzuki-Memory/ui/memory-window.js:3777` 的 `createTableWorkspaceView(table)` **按 `table.id` 硬编码**，
//   只认它自己五个内置 id，**其余一律 `return` 一个空 div**；而左侧卡片标题取 `columns[0]`
//   ⇒ 我方第一列是 `轮次` ⇒ 卡片全显示"第 7 轮"、点进去右侧空白。
//
// 为什么不改插件：那是第三方扩展（`auto_update: true`），改了会在它下次更新时丢。
// ⇒ 治法（用户拍板「对齐插件内置表形状」）：**用插件认得的表 id**，`name` 仍留我们的人话表名。
//
// ★实测后收窄的口径（**不是**五个内置表都能用）：插件里只有三个表是"**每条记录一张卡 + 有详情视图**"——
//   `character_profile`（被用户的角色档案占着）、`item_tracking`、`world_setting`；
//   另两个是**单例表**（`plot_summary` 的左侧栏只画「主线摘要/支线摘要」两张固定卡；`memory_summary` 同理）
//   ⇒ 把它们拿来装"一次事件一行"会**从 14 条变成两条**，比现状更糟。
// ⇒ 本桥的落点（★leg30：两个槽位、两种形状，一一对应，不再并表）：
//   · **当下**（一表一条）→ **`world_setting`**（世界设定视图：设定名/类型/详细说明）
//   · **发生**（每条一行）→ **`item_tracking`**（物品追踪视图："一条一条、可点开看详情"的形状对得上）
// ⚠ 只陈述事实：两个内置表与用户自己的"世界设定/物品追踪"**共用**，靠**记录 id 前缀 `sw2_`** 划清界限
//   （web 层写入时只清 `sw2_` 前缀，非此前缀一个字不动——见 leg27 g 的教训）。
export const MEMORY_TABLE_STATE = '世界状态';          // 逻辑名（自证面/回传/report 用它）
export const MEMORY_TABLE_EVENTS = '世界大事';         // 逻辑名
// ★leg30 **删除** `MEMORY_TABLE_MILESTONES`（原"史卷纪要"）：前史不是第三张表，是同一个列表里成段的行。
//   为什么删而不是留着不用：旧账里那批 `sw2_ms_*` 记录要靠"本次没投 ⇒ 清掉"的机制退场；
//   常量若留着，下一个人会以为还有个表要维护（本仓对纸面机制的态度：跟死代码一样有毒）。
// ★leg29：**侧栏里显示的表名**（用户 2026-09-12 拍板「改表名注明归属」）。
//   为什么要注明：插件只有两个可用槽位，我们是**挤进**它的内置表的 ⇒ 侧栏若只显示插件默认名
//   （"世界设定"/"物品追踪"），用户得点进去才知道装的是谁。插件允许 `name ≠ id`（`normalizeState` 用我们给的 name），
//   所以给显示名加上归属。⚠ 代价（已告知用户）：用户原来自己建的「世界设定/物品追踪」表名会被这个显示名盖住。
export const DISPLAY_NAME_STATE = '世界状态 · 各归何处';
export const DISPLAY_NAME_EVENTS = '世界大事 · 逐条';

// 插件侧的**表 id**（决定渲染器；必须用它的内置 id 才有详情视图）
export const PLUGIN_TABLE_STATE = 'world_setting';
export const PLUGIN_TABLE_EVENTS = 'item_tracking';

// ★leg29：我方写进插件的表 id 清单（web 层据 id 收拢持久化，防旧 id 留下的记录把新表挡住）
export const LEGACY_TABLE_IDS = ['世界状态', '世界大事', '史卷纪要'];

// 当下表：一表一条（覆盖写）——"现在什么样"
// ★leg29 用户口径修正（原话：「为什么把地图放进去了，世界设定不用管，聊天 llm 知道，应该只要记录世界发生了什么就好了」）：
//   原设计把 `positionLine(world)`（一行 46 个地点、618 人的归属串）塞进"影响范围"列——**那正是用户嫌的"地图"**。
//   为什么删：①**位置与设定本来就在世界设定里**（`canon`/`entityFields`），聊天 LLM 看得到，不必在记忆里再抄一份；
//   ②这份表的重心是**"世界发生了什么"**（在办之事 / 未了结之事），位置不是；
//   ③那张串**每轮都在膨胀**，把详情页挤成一大段地名。
//   ⇒ 去掉位置；世界名＋轮次照旧（"现在走到第几轮"是记忆的锚点）。
export const STATE_COLUMNS = ['设定名', '类型', '详细说明'];

// 发生表：一条一行（追加；老了原地压成一段）——"发生过什么"
// 列结构＝**插件 `item_tracking` 视图的列**（第一列＝卡片标题；`状态`/`备注` 是它的特殊格，见顶部 leg30 注）：
//   `物品名称` 保持**裸标题**（不许把轮次拼进去——否则 M5「空标题不投」那条闸会失效：
//   `"   "` 拼上"（第 99 轮）"就不再是空串，脏数据漏过去。这是实测抓到的自己的错），
//   `物品位置`＝**地点**（账上 `event.position`）、`持有者`＝**波及的人**、`轮次`＝**什么时候的**、
//   `状态`＝**了结没**（「已了结」/「未结」/「处境」；空则插件显示"未标记"）。
export const EVENT_COLUMNS = ['物品名称', '物品描述', '物品位置', '持有者', '状态', '轮次'];

// 编排层默认取数上限（提案态；都是"防上下文被灌爆"，不是机制数字）
export const MEMORY_EVENT_TAIL = 60;      // 发生表最多保留最近多少行（**逐条 + 成段共享这一份预算**）

// ---------- 取数（只读账本，不发明） ----------
const txt = (v) => (typeof v === 'string' ? v.trim() : '');
// 列表排序键＝"这件事是什么时候的"（闭环轮 / 出生轮 / 段末轮都可比）。
// `closedTickOf` 对旧账可能返回 `'?'` ⇒ 那种行排到最下面（如实：账上查不出它什么时候了结的）。
const mkSortKey = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : -1);

// ★leg30：`position` 是事件的**必填字段**（`ssot.schema.js` events.required 含 `position`），
//   但引擎在账上没有真地点时会如实写 `未明`（与实体位置同一口径：未载 ≠ 在别处）。
//   口径：`未明` 照投——它是"账上这么写的"，删掉它等于替账本改口；空串才是"没这回事"（整行不出现）。
function placeOf(ev) {
    const p = txt(ev?.position);
    return p === '—' ? '' : p;       // `—` 是旧代码拿来充数的占位符，本桥不再产生、也不再接受
}

// 事件"来路"的人话（对应 source 三型；不写引擎 id）
function sourceLabel(ev, world) {
    const s = ev?.source || {};
    if (s.type === 'plot') {
        const a = (world?.agendas || []).find((x) => x.id === s.ref);
        return a ? `谋划「${txt(a.goal)}」推进` : '谋划推进';
    }
    if (s.type === 'ripple') {
        const up = (world?.events || []).find((x) => x.id === s.ref);
        return up ? `由「${txt(up.title)}」牵动` : '被上游牵动';
    }
    return '由处境而起';   // state：处境源（不引用上游）
}

// 被波及的人名（账上是实体 id——投出去必须翻成人话）
function rippleNames(ev, world) {
    const names = (ev?.ripples || [])
        .map((id) => (world?.entities || []).find((e) => e.id === id)?.name)
        .filter((n) => typeof n === 'string' && n.trim());
    return names.join('、');
}

// ★leg30：**行随数据取舍**——没有值的格子**整个键不写**（插件按表定义里的列逐格渲染，
//   缺的键就渲染成空行）。这是"缺数据不造"在**字段粒度**上的落法（旧版写 `|| '—'` 充数）。
function compact(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => typeof v === 'string' && v.trim() !== ''));
}

/**
 * buildMemoryPayload(world, { eventTail }) → { [表名]: records }
 * 纯函数：把账本译成**记忆表的记录**（不含任何插件调用）。返回的 records 形状 =
 * 插件自己的形状 `{ id, hidden, values: { 列名: 值 } }`（见 yuzuki-Memory/config/storage.js）。
 */
export function buildMemoryPayload(world, { eventTail = MEMORY_EVENT_TAIL } = {}) {
    const tick = world?.meta?.tick ?? 0;
    // ★★leg53：这一行也走 `PANEL_ENV_KEYS` —— **同一个面板口径，第五个面**。
    //   它投出去的是**中文列**（`世界状态 · 详细说明`），玩家会在记忆插件里逐字看到 ⇒ 就是玩家可见面。
    //   民生那一格撤了，这里也不许再报（否则"面板上没有、记忆插件里有"＝又一个两把尺子）。
    const params = paramsRows(world).filter((r) => PANEL_ENV_KEYS.includes(r.key))
        .map((r) => `${r.key}：${r.value}`).join(' · ');
    const open = (world?.agendas || []).filter((a) => !a.closed);
    const pending = (world?.events || []).filter((e) => !e.closed);
    const events = world?.events || [];
    const milestones = world?.milestones || [];

    // ① **当下**（一条，覆盖）——只记"世界走到第几轮 + 有什么事在办/没了结 + 参数"（**不抄位置**，见 STATE_COLUMNS 注）
    //   ★leg30：`类型` 列加「当前 ·」前缀，与"发生在第 N 轮"一眼可分（此前都写"第 N 轮"，
    //   于是状态卡与史卷纪要卡长得一模一样——用户看到的"混在一列里"就是这个）。
    const stateValues = {
        设定名: txt(world?.context?.world) || '（未名世界）',
        类型: `当前 · 第 ${tick} 轮`,
        详细说明: [
            `在办之事：${open.length ? open.map((a) => `「${txt(a.goal)}」（${a.progress ?? 0}/${a.maxSteps ?? 0}）`).join('、') : '（无）'}`,
            // ★leg30：未了结之事**每条带出生轮**——此前只列标题，读不出"这件事多久没了结"（同一张截图里
            //   状态说第 16 轮、大事表最新才第 9 轮，用户无从判断是"旧账"还是"卡住了"）。
            `未了结之事：${pending.length ? pending.map((e) => `${txt(e.title)}（第 ${bornTickOfEv(e)} 轮起）`).filter(Boolean).join('、') : '（无）'}`,
            `参数：${params || '（未定）'}`,
        ].join('\n'),
    };
    const records = {
        // ★leg29 修（用户实机「**投递是投递了但是看不到内容**」查证时发现）：
        //   原来 id 是 `sw2_state_${tick}`——**每轮都是新 id**，而 web 层 `writeRecords` 是**按 id 合并**的
        //   ⇒ 状态表**每轮新增一条**、旧轮次的那些永远留在插件里（真账实测：`sw2_state_0` / `_10` / `_11`
        //   三条并存，而本表的契约是"一表一条、每轮覆盖"⇒ 自相矛盾）。
        //   改法：**固定 id**（`sw2_state`）⇒ 写入即覆盖同一条，账上永远只有"现在什么样"。
        //   旧轮次残留由 web 层 `writeRecords` 按前缀清掉（它与插件 id 命名空间不重叠）。
        [MEMORY_TABLE_STATE]: [{ id: 'sw2_state', hidden: false, values: stateValues }],
    };

    // ② **发生**：近处逐条、远处成段，合成**同一个列表**（★leg30：不再投第二张"史卷纪要"表）
    //
    // ★leg27 h（用户实机「记忆插件也没有记录事件」+ 口径「**我记得事件要落地才成事件的**」）：
    //   用户口径是对的——**已了结**才进这张表。但真账实测：世界跑到第 9 轮、10 条事件里**只有 5 条落地**，
    //   于是这张表在前 8 轮**恒空**，用户看到的是"插件什么都没有"，而账上其实有 6 条因果链在飞。
    //   ⇒ 治法：**不混口径，分档如实投**——已了结的进"已落地"，在飞的进"未结"（同一张表、`状态` 列带标记），
    //   两者一眼可辨，续不上"事件要落地才成事件"这条纪律（未结的没被当成事件，只是如实呈现"有事在飞"）。
    // ★leg29 修：**先滤、后切**——原写法是 `filter(closed).slice(-eventTail).map(...).filter(有标题)`，
    //   于是"切进来的脏数据（没标题）"会**白占预算**、最后被滤掉 ⇒ 实际投出的条数少于预算。
    //   这正是本模块自己写下的定稿顺序（见下方 M4 留档第③条：脏数据不许占位），但**闭档这一支漏改了**。
    const closedRows = events
        .filter((e) => e.closed)
        .map((e) => {
            const at = closedTickOf(e);
            return {
                at: mkSortKey(at),          // 排序键＝这件事"什么时候的"（不投出去，只用来排列表）
                id: `sw2_ev_${txt(e.id)}`,
                hidden: false,
                // `closedTickOf` / `bornTickOfEv` 都可能返回 '?'（旧账没有闭环轮）——那种时候只报状态，
                // 不许把 "第 ? 轮" 投出去（缺数据不造）。
                values: compact({
                    物品名称: txt(e.title),
                    物品描述: sourceLabel(e, world),
                    物品位置: placeOf(e),
                    持有者: rippleNames(e, world),
                    状态: '已了结',
                    轮次: at === '?' ? '' : `第 ${at} 轮`,
                }),
            };
        })
        .filter((r) => r.values.物品名称);              // 没标题（脏数据）不投——宁缺勿造
    // 在飞档：未了结事件（按出生轮升序＝先起的在前）
    // ★有界：**两档共享同一份尾巴预算**。M4 这条判据当场抓出我**三个**错，逐个留档：
    //   ①只给闭档 slice、在飞档漏了（闸门形同虚设）②改成各切一次 ⇒ 最坏翻倍（61 > 60）
    //   ③**先 slice 后 filter** ⇒ 预算按"切前条数"扣，而脏数据（没标题）没占位 ⇒ 又超一条。
    //   ⇒ 定稿顺序：**先滤（只留真会投的）→ 再按已落地占用后的余量切在飞**。
    //   口径（★leg30 更新）：**逐条行与成段行共享同一份预算**（`eventTail`）——旧版是"逐条 ≤60 **且** 成段 ≤12"，
    //   那等于同一批事件最多占两个预算、且总行数可以到 72。现在只有**一个列表**，所以只有一份预算。
    //   在飞档的余量仍按**逐条已结行**扣（成段行是"更早以前"，不该挤掉"已经在飞、正被读者关心"的那些）。
    const closed = closedRows.slice(-eventTail);
    const pendingBudget = Math.max(0, eventTail - closed.length);
    const pendingRows = (pendingBudget === 0 ? [] : pending
        .slice()
        .sort((a, b) => bornTickOfEv(a) - bornTickOfEv(b))
        .slice(-pendingBudget))
        .map((e) => ({
            at: mkSortKey(bornTickOfEv(e)),
            id: `sw2_ev_open_${txt(e.id)}`,
            hidden: false,
            values: compact({
                物品名称: txt(e.title),
                物品描述: sourceLabel(e, world),
                物品位置: placeOf(e),
                持有者: rippleNames(e, world),
                状态: '未结',
                轮次: `第 ${bornTickOfEv(e)} 轮起`,
            }),
        }))
        .filter((r) => r.values.物品名称);

    // ★leg30 **成段档（原"史卷纪要"）**：里程碑＝引擎把"闭环满热窗且整链结清"的旧事件按出生段
    //   （10 轮一段）压成的结构摘要（`settle.js:458-517`），`titles` 就是它吃掉的那批事件的标题。
    //   ⇒ 它是**同一个列表里比较老的那些行**，不是另一张表。`轮次` 列写整段范围（`第 1–10 轮`），
    //   与逐条行的 `第 9 轮` 一眼可分；`物品描述` 说明这一段收了多少件事、都是什么标题。
    //   没 `span` 的脏里程碑不投（缺数据不造——旧版对这条有判据，继续保留）。
    const spanRows = milestones
        .map((m) => {
            const from = m?.span?.from;
            const to = m?.span?.to;
            if (!Number.isFinite(from) || !Number.isFinite(to)) return null;   // 脏里程碑不投（缺数据不造）
            const titles = (m?.titles || []).slice(0, 6).map((t) => txt(t)).filter(Boolean);
            const count = m?.counts?.events ?? (m?.ids || []).length ?? 0;
            return {
                at: mkSortKey(to),
                id: `sw2_ev_span_${txt(m?.id)}`,
                hidden: false,
                values: compact({
                    物品名称: `第 ${from}–${to} 轮 · 前史`,
                    物品描述: `${count} 件事${titles.length ? `：${titles.join('、')}` : ''}`,
                    状态: '已归卷',
                    轮次: `第 ${from}–${to} 轮`,
                }),
            };
        })
        .filter(Boolean);

    // 合成一列 + **按"这件事什么时候的"倒序**（最新在前）：闭环轮 / 出生轮 / 段末轮都是可比的数
    //   （旧版分"已落地在前、未结在后"两段排——那让列表读起来像两张表拼在一起，正是"很乱"的来源之一）。
    // 先滤、后按预算切（脏数据不许占位；成段行与逐条行、已结与未结**共享**这一份预算）。
    records[MEMORY_TABLE_EVENTS] = [...closedRows, ...pendingRows, ...spanRows]
        .filter((r) => r.values.物品名称)
        .sort((a, b) => b.at - a.at)
        .slice(-eventTail)
        .map((rec) => ({ id: rec.id, hidden: rec.hidden, values: rec.values }));   // `at` 只用于排序，绝不投出去
    return records;
}

// 闭环轮：closedAt 优先；旧账没有就退回"出生轮"（如实，不猜）
function closedTickOf(ev) {
    if (typeof ev?.closedAt === 'number') return ev.closedAt;
    const seg = String(ev?.id || '').split('_').find((s) => /^\d+$/.test(s));
    return seg === undefined ? '?' : Number(seg);
}

// 出生轮：事件 id 契约（`ev_<tick>_<n>` / `ev_pump_<tick>_<n>`，取首个纯数字段）——与 settle/setting 同源口径。
// 为什么在这里重写而不是 import：本模块是**编排层纯函数**（零引擎依赖），只读 id 文本、不碰引擎内部。
function bornTickOfEv(ev) {
    const seg = String(ev?.id || '').split('_').find((s) => /^\d+$/.test(s));
    return seg === undefined ? '?' : Number(seg);
}

// ---------- 落库（依赖注入：store 由 web 层给，Node 测试给假的） ----------
/**
 * pushToMemory(records, { store, now }) → { ok, written, reason? }
 * store: { readState(): object|null, writeRecords(records, { now }): void }
 *   · 表定义（columns/name）随第一次写入一起交给 store —— 插件侧的 `normalizeState` 会按
 *     "rawState.tables 为空则用 fallback" 的规则接管，我们提供的表因而**自然并入**它的状态。
 * 口径：**绝不抛**（插件不在/写失败都只是"这次没投上"）；返回值如实报告。
 */
export function pushToMemory(records, { store, now = Date.now(), table = MEMORY_TABLE_STATE } = {}) {
    try {
        if (!store || typeof store.writeRecords !== 'function') return { ok: false, written: 0, reason: 'no-store' };
        const tables = [
            // id 用**插件内置 id**（决定渲染器与"有没有详情视图"），name 用**注明归属的显示名**（侧栏显示的就是它）
            { id: PLUGIN_TABLE_STATE, name: DISPLAY_NAME_STATE, icon: 'world', columns: STATE_COLUMNS, hidden: false },
            { id: PLUGIN_TABLE_EVENTS, name: DISPLAY_NAME_EVENTS, icon: 'item', columns: EVENT_COLUMNS, hidden: false },
            // ★leg30：只有**两个**槽位——"前史"不再单独占表（它是发生表里成段的行，见顶部 ②.2）。
        ];
        const written = Object.values(records).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
        store.writeRecords(records, { tables, now });
        // ★leg27 h：把"投到哪儿 / 投了什么"如实回给调用方（面板与状态栏据此自证）。
        //   为什么必须有：这功能此前**完全没有自证面**——用户两次靠肉眼发现它没生效（"-- 记忆插件里还是什么都没有"）。
        const counts = Object.fromEntries(Object.entries(records).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]));
        // ★leg29：状态表改用插件列形状后**没有 `轮次` 键了**（轮次落在 `类型` 列）——这里原写死读 `轮次`，
        //   改列后会**回传空轮次** ⇒ 自证面显示"记忆已投 · （空）轮"。改成"读得出来就读、读不出就退回调用方给的 tick"
        //   （宁可退回，也不许拿上一次的冒充本次）。
        //   ★leg30：`类型` 现在是 `当前 · 第 N 轮` ⇒ 回传前把「当前 ·」摘掉（自证面的话术照旧是"第 N 轮"）。
        const stateRec = (records[MEMORY_TABLE_STATE] || [])[0];
        const tick = String(stateRec?.values?.['类型'] ?? stateRec?.values?.['轮次'] ?? '').replace(/^当前 · /, '');
        return { ok: true, written, counts, tick, table };
    } catch (err) {
        return { ok: false, written: 0, reason: String(err?.message || err) };
    }
}
