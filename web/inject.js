// story-world-v2/web/inject.js
// ★★★leg89：**插件第一次"会动你的对话"**——发消息前把两段塞进聊天上下文。
//   设计：`docs/spec-tagged-actions-extraction.md` §6。口径（逐条都有依据）：
//
//   ① **分两段、可分别关**（本仓 leg86 §5 的定稿纪律）：格式指令 / 名号对照 / 可选世界动向。
//      世界动向**默认关**——注入"世界状态"会让剧情越来越围着账本转（**叙事被账本殖民**）。
//   ② 走 ST 的现成口 `setExtensionPrompt(key, value, IN_PROMPT, depth, scan, SYSTEM)`
//      ⇒ `IN_PROMPT`(0) + `role=SYSTEM`。
//      ★★★leg90c：**位置曾经是 `IN_CHAT`，那是个真缺陷**——ST 的 `scripts/openai.js:1345` 是
//        `if (![BEFORE_PROMPT, IN_PROMPT].includes(prompt.position)) continue;` ⇒ `IN_CHAT`(1) 的
//        扩展提示词**根本不进发给模型的 prompt**（只躺在 ST 的字典里，所以面板读数"看着注入了"）。
//        `getPromptPosition`：`BEFORE_PROMPT(2)→'start'`、`IN_PROMPT(0)→'end'`，**其余一律 false**。
//        ⇒ 定稿 `IN_PROMPT`(0)：映射成 `'end'`，作为一条 system 消息排在提示词集合末尾。**绝不退回 1。**
//      ★**不用更重的那条路**（挂 `CHAT_COMPLETION_PROMPT_READY` 自己往 `chat` 数组里克隆 system 消息——
//        那是 yuuki 记忆插件的走法，我们不需要：它要改数组、要防重复插入，`setExtensionPrompt` 自己管这些）。
//      ⚠仍然照签名传 `depth=0`，但 **`IN_PROMPT` 下 ST 不读 depth**（`openai.js:1352` 取的是
//        `getPromptPosition(prompt.position)`）；它只在 `IN_CHAT` 那条路上有意义——而那条路是死的。
//   ③ ★**接口从 `ctx` 现取**（`SillyTavern.getContext().setExtensionPrompt`，ST 的 `scripts/st-context.js:40/144`
//      就把它挂在 ctx 上）⇒ **不 import 硬路径**（那会对安装位置产生耦合，也会让 Node 侧加载当场炸）。
//      取不到（旧版 ST / Node 侧）⇒ **静默降级为"不注入"**，但**如实报一次**（不假装注入成功）。
//   ④ 每轮**重设**（把上一轮的撤掉再写新的）：不允许上一轮那几段"冒充本轮"。
//      `MESSAGE_RECEIVED` 之后世界推完会调一次 ⇒ 下一轮发消息时它已是最新的。
//
// 零 DOM、零引擎依赖：本模块只认识"字符串"与"注入口"，可被 Node 测试直接调（注入 fake ctx）。
//
// ★★★leg115（**第四段注入 · 账上往事**）：本模块第一次 import 引擎侧的模块——
//   `ledger-recall.js`（**零 import 的真叶子**，只读调用方递进来的账）⇒ 不引回环、不碰 DOM。
//   为什么取数放在这里而不是编排层：`apply()` 是**唯一**同时拿得到 `getCtx()`（上一轮正文＋这一轮输入）
//   与 `getWorld()`（账）的地方；而 `web/index.js` 只剩 **1 行**余量（硬锁 `<3100`）⇒ **不许再往那里加**。
import { recallLedger, RECALL_MODES, formatRecalled, timeMarkAt, rankKeywordMatches, recalledLineText } from '../src/ledger-recall.js';
import { filterChatRecords } from '../src/event-provenance.js';
import { currentScopeIds } from '../src/event-contract.js';
// ★★★leg198：**「正文」那一层搬进 `src/prose.js`**——提取那一趟（`src/tick.js`）也要用它，
//   而 `src/` **不许** import `web/`（单向边）⇒ 一处定义只能住在引擎那一侧。
import { proseOnly } from '../src/prose.js';
// ★★★leg161：**检索参数那三格的出厂值**住 `src/limits.js`（渲染层也要画它们，而 `src/` 不许反向 import `web/`）
//   ⇒ 出厂值只有一个真源，本模块**只引用、不自己抄一份**。
import { RETRIEVAL_MIN_SCORE, RETRIEVAL_TOP, RETRIEVAL_DEPTH, RETRIEVAL_LITERAL_SHARE, LEDGER_CHARS_DEFAULT } from '../src/limits.js';
// ★★★leg123：**格名表从引擎那一侧取**（`tag-extract.js` 是真源，零 import 的叶子 ⇒ 浏览器侧安全、不成环）
import { CHANGE_FIELDS, CHANGE_FIELD_KIND } from '../src/tag-extract.js';
// ★★★leg119：卷库那一侧（浏览器 IndexedDB）——取"冷档里的编年行"要用它。
//   ★本模块顶层**零 indexedDB 访问**（`idb-backend.js` 自己就是"惰性 + 守卫"的）⇒ Node 侧 import 它照样安全。
import { createIdbVolumeStore } from './idb-backend.js';
import { filterHistoryVolumes } from '../src/vector-history.js';
import { diagnostics } from '../src/diagnostics.js';

export const INJECT_KEY_TAGS = 'sw2_tags';       // ① 格式指令 + ② 名号对照（合成一条）
export const INJECT_KEY_WORLD = 'sw2_world';     // ③ 世界动向（默认关）
export const INJECT_KEY_LEDGER = 'sw2_ledger';   // ④ ★leg115：**账上往事**（"什么时候发生了什么"，默认开）

/**
 * ★★★leg115：**账上往事那一段的预算**（提案态，可调）。
 * 为什么是这一个数（不是拍脑袋）：
 *   · `maxChars`：★**唯一当家的就是这一个**。硬上限，防的是"账长大了把聊天上下文吃掉"。
 *     名称与关键词候选按命中词数、同分按新旧选择；向量候选保留相似度顺序。
 *     选择完再按时间顺序排版，避免排版顺序决定哪条往事占得到额度。
 *   ★**没有条数上限**（本仓血证：`entityUpdates ≤3` 那个没量过的提案态数字当家、还静默拦，
 *     2026-09-22 用户拍板直接撤）⇒ 2026-09-23 把调用里那个 `limit: turns * 6` 也一并撤了：
 *     它是个**估出来的**数字（8×6=48），而 `maxChars` 已经决定了条数 ⇒ 留着只会是第二个没量过的闸。
 *   ★★★本次（清死码）：那个已经没人读的 `turns: 8` **字段也删了**——leg116 撤掉它唯一消费者
 *     （上面那个 `limit`）时把字段留在了表里。实测本模块**零读者**：`:497` 只传 `.maxChars`，
 *     而 `sw2RecallQueryText(ctx, cap)` 的第二参是**字符数**（那个 cap 与"轮数"不是一回事，
 *     见下面 leg115④ 那条判据）⇒ 留着只会让下一任以为"轮数还管着什么"。
 *
 * ★★★leg161（用户令「**那就让聊天侧也接上向量检索呗**」＋「**保证相关度最大就不用管时间了**」）：
 *   **聊天侧这一段从此也吃向量路**，参数面照用户给的那张图**三格**（见下面 `RETRIEVAL_PARAMS`）。
 */
//   ★★★（2026-10-05）**这个数现在是旋钮**（玩家可在参数页「往事注入多少字」那一格填）：
//     出厂值搬进 `src/limits.js` 的 `LEDGER_CHARS_DEFAULT`（那里是"渲染层与真跑读同一个数"的
//     唯一真源——`src/` 不许反向 import `web/`）；本表只留"没填过时"的兜底，与出厂值同源。
export const LEDGER_RECALL_DEFAULT = Object.freeze({ maxChars: LEDGER_CHARS_DEFAULT });

/**
 * ★★★leg161：**检索参数三格**——用户 2026-10-01 附 `yuzuki-Memory` 的「检索参数」截图定的口径：
 * 「**这是记忆插件的向量模型参数配置，就这几个**」。
 *
 * | 那一格 | 它管什么 | 出厂 | 为什么是这个数 |
 * |---|---|---|---|
 * | `minScore` | **相似度阈值** | **0.30** | ★★实测（真账 · 换词问法）：分数挤在 **0.42~0.49**、**正解常比错答分低**，门槛 0.5 只剩 **1/16** ⇒ **出厂必须给低**，它是"想收紧时才动"的旋钮，**不是用来过滤的** |
 * | `top` | **最大召回条数** | **6** | 实测支撑（按实体问"他做过什么"前 6 里 6.00/6）★**不另立一把尺**：整段预算仍归 `maxChars` |
 * | `depth` | ★**检索上下文深度** | **2** | ＝**查询串取几条正文消息**（`yuzuki-Memory` 那一格是同一件事：它 `extractSearchText` 从 `ctx.chat` 末尾往回凑 `depth` 条）。★我们原来**写死 2**，leg161 **改成参数** |
 * | `literalShare` | ★**字面路那一份额度** | **0.6** | ★★**实测逼出来的**（400 轮长账）：字面路取回 **641 行**、1600 字只装 **24 行** ⇒ 合成一个池子按"新的在前"装 ⇒ **向量那 6 行一条也挤不进去**（两臂读数一模一样）。⇒ 剩下的 **40% 专留给向量路**（"按意思找回来的旧事"才有位置） |
 *
 * ★**与「往事轮数」不是一回事**（别合并）：那一格（出厂 50）管**窗口下界**（哪些行算"窗口外"），
 *   本表这一格管"**问多长**"（拿几条正文去问）。
 * ★★（2026-10-05）**这一表只是出厂值**：玩家填过的那几格以**现读设置**为准，见下面 `liveRetrievalParams`。
 *   ★病：leg161 起这三格在界面上可填，而真跑的那条路读的**一直是这张冻结表** ⇒ 填了不生效。
 * ★**维度 / 一批几行不在这里**：那是"从厂商问得到的"，**不许做成旋钮**（用户令：
 *   「**至于多少维度还有向量化多少行直接可以从厂商问到不用写到参数里懂吗？**」）⇒ 运行时读回。
 */
export const RETRIEVAL_PARAMS = Object.freeze({
    minScore: RETRIEVAL_MIN_SCORE, top: RETRIEVAL_TOP, depth: RETRIEVAL_DEPTH,
    literalShare: RETRIEVAL_LITERAL_SHARE, maxChars: LEDGER_RECALL_DEFAULT.maxChars,
});

/**
 * 参数页那几格的**现读**：填过的用填的，没填的回出厂。
 * 用户 2026-10-05 问出来的病：界面能填、设置也写盘，而真跑的那条路读的是上面那个**冻结常数**
 * ⇒「最大召回条数」填多少都是 6。⇒ 取数一律改成"每次用时现取"。
 *
 * ★（2026-10-05 第二笔）**多一格 `maxChars`**（「往事注入多少字」）：它此前是**写死的**
 *   （`LEDGER_RECALL_DEFAULT.maxChars = 1600`），参数页上没有旋钮 ⇒ 现在是同一个现读口径。
 *   ★它与另外三格的**性质不同**：那三格只管**按语义那一路**；这一格是**整段的字数上限**，
 *   字面路与向量路**两路合起来**都吃它（两路各有一份额度，见 `apply()` 里那段）。
 * @param {object|null} settings 插件设置（`data-settings` 那几格的现值）
 * @returns {{minScore:number, top:number, depth:number, literalShare:number, maxChars:number}}
 */
export function liveRetrievalParams(settings = null) {
    const num = (value, fallback, floor = false) => {
        const n = Number(value);
        if (value == null || value === '' || !Number.isFinite(n) || (floor && n < 1)) return fallback;
        return floor ? Math.floor(n) : n;
    };
    const s = settings && typeof settings === 'object' ? settings : {};
    return {
        minScore: num(s.retrievalMinScore, RETRIEVAL_PARAMS.minScore),
        top: num(s.retrievalTop, RETRIEVAL_PARAMS.top, true),
        depth: num(s.retrievalDepth, RETRIEVAL_PARAMS.depth, true),
        literalShare: RETRIEVAL_PARAMS.literalShare,
        // ★★★（2026-10-05）「往事注入多少字」——整段的字符硬上限（两路共用这一格）。
        maxChars: num(s.retrievalMaxChars, RETRIEVAL_PARAMS.maxChars, true),
    };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★leg119：**卷（冷档）里的编年行**——取往事时**要一起看**
//   （细案 `docs/spec-volumes-into-recall.md`；用户 2026-09-23 令「接」）
//
// 【病】编年太长时，引擎把**最旧的一段**整段搬进"卷"（`storage.js` 的 `rotateChronicle`；卷住在
//   浏览器的 IndexedDB 里）。搬走之后那些行**就不在账的 `chronicle` 里了**，而取往事的两条路
//   （世界模型那份包的"纪事"栏 · 本模块这一段）**都只读账上的编年**
//   ⇒ **轮转一发生，两处都悄悄少一半**。真账实测（阈值临时调到 20 轮，只为让机制真跑一遍）：
//   编年 360 行 → 热账 174 行，**186 行取不回来**（其中 119 条是真往事）；
//   而当过消费者的"纪事"栏**从 237 条掉到 118 条**——★而包里**仍然报"没裁过"**
//   （`trimPack` 那一刻量的是缩水后的编年，它**全装得下**）。
//   ⇒ 一句话：**上游先悄悄剪短了，于是下游的诚实检查报告说一切正常。**
//
// 【做法】本模块持一份**缓存**（同步可读），在后台按需刷新（`list()` + 逐个 `get()`）。
//   · ★为什么缓存放**本模块**：`web/index.js` 只剩 1 行余量（硬锁 `<3100`，仓里明写"不许再往那里加"），
//     而它**已经**把 `getCtx` 递进本模块 ⇒ 这里是"**不新增接线行**"就能知道"现在是哪个聊天"的那一处
//     （卷库按聊天隔离：`chatId` 就是它的命名空间）。
//   · ★为什么是"缓存 + 后台刷新"、不是"每次现取"：`recallLedger` 是**同步**的（它必须在出包那一刻
//     同步跑完），而 IndexedDB 只有异步口 ⇒ 只能提前备好。而轮转**极少发生**
//     （真账实测：要到**第 502 轮**才第一次）⇒ "晚一步看见新卷"是可接受的。
//   · ★★纪律：**永远不抛；拿不到就返回空**（照 `recall.js` 那条"失败零阻塞"）。
//     返回空 = 调用方按"**没有卷**"走 = **接线之前的行为**——不是新行为，也不是坏行为。
let volumeCtxGetter = null;      // 由 createInjector 注入（**现取** ST 上下文，不许抓死）
let volumeWorldGetter = null;
let volumeCache = [];            // 当前聊天的卷（含 `rows`）
let volumeCacheChatId = null;    // 这份缓存属于哪个聊天（**切聊天要整个作废**）
let volumeRefreshing = false;

/** 接线层注入"现在是哪个聊天"的取数口（`createInjector` 调一次；见 `deps` 注）。 */
function bindVolumeSource(getCtx, getWorld) {
    volumeCtxGetter = typeof getCtx === 'function' ? getCtx : null;
    volumeWorldGetter = typeof getWorld === 'function' ? getWorld : null;
}

function currentVolumeChatId() {
    try {
        return volumeCtxGetter ? String(volumeCtxGetter()?.chatId || 'default') : null;
    } catch (_) {
        return null;             // 拿不到上下文 ≠ 出错：这一轮就当"没有卷"（世界照常推进）
    }
}

async function readAllVolumes(chatId) {
    const store = createIdbVolumeStore(chatId);
    const listed = await store.list();
    const full = await Promise.all((listed || []).map((v) => store.get(v.id).catch(() => null)));
    return full.filter((v) => v && Array.isArray(v.rows));
}

export async function loadLedgerVolumes(chatId, world = null) {
    const volumes = await readAllVolumes(String(chatId || 'default'));
    return world ? filterHistoryVolumes(world, volumes) : volumes;
}

/** 后台刷一次缓存（同一时刻只飞一次）。★失败只是"这次没刷上"——不抛、也**不清空**已有缓存。 */
function refreshVolumesInBackground() {
    if (volumeRefreshing) return;
    const chatId = currentVolumeChatId();
    if (!chatId) return;
    volumeRefreshing = true;
    readAllVolumes(chatId)
        .then((list) => {
            // ★飞行途中切了聊天 ⇒ 这份结果**作废**（不许拿 A 聊天的卷去喂 B 聊天）
            if (currentVolumeChatId() === chatId) {
                volumeCache = list;
                volumeCacheChatId = chatId;
            }
        })
        .catch(() => { /* 刷不上就照旧用上一次那份（或空） */ })
        .finally(() => { volumeRefreshing = false; });
}

/**
 * ★**同步**取"当前聊天卷库里的卷"——给 `recallLedger` 的 `volumes` 那一格用。
 * 顺手在后台踢一次刷新（下一轮就能看见新卷）。**永不抛**；拿不到 ⇒ `[]`。
 * ★切了聊天、而缓存还没刷过来 ⇒ **返回空**：**宁可不给，也不给错的那一份**。
 */
export function ledgerVolumes() {
    const chatId = currentVolumeChatId();
    refreshVolumesInBackground();
    if (!chatId || volumeCacheChatId !== chatId) return [];
    return filterHistoryVolumes(volumeWorldGetter?.(), volumeCache);
}

/** ★名册不封顶（leg89 更正·用户：「120个角色上顶没必要啊」）——见 `rosterText` 的注释。 */
export const ROSTER_CAP = Infinity;

// ★围栏记号：**三反引号**（本文件里不写字面量，`FENCE` 一处定义，免得与模板串那种雷同形）。
//   ★为什么这个文件里写反引号是安全的（与 `src/prompts.js` 那条雷不同）：本段只在**运行时**拼字符串、
//     经 `setExtensionPrompt` 递出去，**从不进任何模板字符串**；`prompts.js` 也不 import 它。
const FENCE = '`'.repeat(3);

/**
 * ★给聊天模型的标签规范（纯函数，Node 可测）。这就是"注入提示词让聊天llm生产带标签的内容"那段正文。
 * 写法纪律（本仓 A-3 同款）：**说人话、零引擎术语**（不出现 actions/turnFacts/id 这类词）。
 *
 * ★★★leg93（用户裁示「**就甲吧**」）：**全部标签必须包在一个 ```tags 块里**，且这段是硬要求。
 *   为什么非包不可（用户那一问「正文里有【…】呢？不能包裹在一个标签里吗？」的答案）：
 *   插件原来是**逐行扫全篇**，于是"正文里以 `【行动】` 开头的一句叙述"会被当成**真行动**、
 *   "以 `【时长】` 开头的一句叙述"会**当成本轮时长收下**（实测：`elapsed` = 「这个词表示时间流逝。」）。
 *   ⇒ 改成"**只认块里的**"：块外怎么写都不算。所以这一段必须把"**块**"讲到模型不可能误解。
 *   ★★★leg199（用户令「**删掉降级吧**」）：这里原来还挂着一句「★配一段**降级**：模型忘了包块时，
 *     插件退回逐行扫（老行为）——不会整轮零标签」。**那句话现在删了，因为降级本身已撤**：
 *     `src/tag-extract.js` 起，**没有块 ⇒ 零收获**。两条理由（第一条是 leg198 体检实跑抓出来的）：
 *       ① 逐行扫全篇 ⇒ 正文里**只要有一行以 `【行动】` 开头**（引用字条/告示/解说格式）就成真行动；
 *          写到玩家名上时**变成玩家这一轮的落子**递给世界模型（实跑见 `src/tag-extract.js` 里那段留档）。
 *       ② 它让本段向模型承诺的那句「**块外面写了也不作数**」变成**假话**——承诺与实现必须一致。
 *     ⇒ 代价（用户已知情并拍板）：漏写块的那一轮**整轮零收获**，由接线层那句「这一轮正文里没有标签」如实出声兜。
 *   ★★★leg199 同批：**第 7 条（【变化】）改了值口径——两层**（★第二层是用户**更正**后才对的，别读丢）：
 *     · 病（用户第一轮原话）：「给一个角色修改实力字段，但是不是写从筑基到金丹这样修改，
 *       而是写获取了资源然后大幅提升了当前实力」。
 *     · ★★**我第一版只做了第一层**（"新状态 vs 过程"），用户当场更正——
 *       「**我说的不是这个意思，我说的是实力按道理来说如果有境界那么应该是境界的变化，
 *       而不是一句抽象的实力大增**」⇒ **第二层才是他要的那件事**。
 *     · 第一层：第三格＝**变完之后那一格的值**（新状态），不是**过程**（「获取了资源」「大幅提升」）。
 *     · ★★第二层：**变强/突破时要写书里那套档位的名字**（境界/等级/品阶/军阶——本书怎么分就怎么写）；
 *       **不许**写「实力大增」这类**抽象的变强总结**——它**看着像状态**（完成态），
 *       其实**说不出他什么水平**，而这一格在本仓的定义就是**档位标签原话**（`ssot.schema.js:282`）
 *       ⇒ 填了总结，这一格从此**当不了值**。
 *     · ★为什么这两层只能靠规范拦：`registerDialogueFacts` 那条"值必须在正文里找得到"
 *       （`src/settle.js:1217`）对过程句与总结句**一律放行**（那几句话确实在正文里）；
 *       而"这句算不算档位名"要判就得用词表判语义——`ANCHOR.md` §4.8 明禁。
 *     · ⇒ 示例从过程式的「踏入元婴」改成状态式的「元婴期」
 *       （★旧示例自己就在教模型写错："踏入"是过程——这一处是同一个病的根）。
 */
export function tagSpecText() {
    // ★★★leg123（细案 `docs/spec-tag-granularity.md` §2.1/§2.2）：**格名表不另立一份**——
    //   直接从 `src/tag-extract.js` 的 `CHANGE_FIELDS`（真源）按类别分出来。
    //   口径一句话：**聊天模型看到的名单 = 引擎校验用的名单 = 实体账上真有的格**（一把尺子）。
    const roleFields = CHANGE_FIELDS.filter((f) => CHANGE_FIELD_KIND[f] === 'character').join('／');
    const factionFields = CHANGE_FIELDS.filter((f) => CHANGE_FIELD_KIND[f] === 'faction').join('／');
    return [
        '【本回合必须用标签标出实际行动与重要结果】',
        '★正文照常写；末尾标签记录会改变后续局面的事实结果、当前状态变化与仍需兑现的承诺。普通行动只用于当轮已行动者保护。',
        '标签块必须有，但【事件】可以一条也没有。没有标签块，插件收不到本轮标记；只有日常活动时保留实际行动，不为凑事件数量编结果。',
        '',
        `★★把所有标签**集中放在正文最末尾的一个 ${FENCE}tags 块里**（前后各一行 ${FENCE} 围栏，照下面那样写）。`,
        '**只有这个块里面的标签插件才看**；块外面写了也不作数（所以正文里怎么引用、怎么打比方都不会被误读）。',
        '',
        '先选事件，再写编号：',
        '· 每件事件都要能指出正文已经确立的具体变化：新增了什么事实、改变了谁的处境或行动条件、确立了什么义务。只说“某人做完了某个动作”不够；没有这样的变化，就只写行动。不要为了满足这个要求给正文添加后果。',
        '· 查看公开资料、问候、走动、清点人数、进入会场、列队集合等，若没有独立新结果，只写【行动】。把它们改称“完成查阅”“完成问候”“完成集结”“确认到场”，仍然不成为事件。',
        '· 对照：查看公开规则不是发布新规则；普通问候不是确立新关系；按安排集合不是获得新资格。若正文确实写出新规则发布、双方约定交换证据、某人参赛资格被取消，才记录那个具体结果。例子不是要求本轮必须发生这些事。',
        '· 认知变化要写出足以改变判断或行动条件的关键新事实，例如发现背叛的证据；仅仅看过资料、听完介绍、熟悉流程不单独登记。已有公开事实不因每个人读了一遍就各建一件事件。',
        '· 事件不按规模大小判断，一句有效约定也可登记；同一结果的查看、交谈、办理过程不拆成多个事件。“已完成”只表示事件完成，不表示一个普通动作因此值得入账。',
        '',
        '例一：只有日常活动，没有事件。学生甲查看公开资料，与同学乙互致问候后进场列队，班长清点人数；没有新规则、约定或其他独立结果，标签这样写：',
        `${FENCE}tags`,
        '【协议】4',
        '【时长】半小时',
        '【场景：校园】',
        '【行动】学生甲｜查看公开资料并与同学乙互致问候｜同学乙',
        '【行动】同学乙｜向学生甲问候｜学生甲',
        '【场景：体育馆】',
        '【行动】学生甲｜进场列队',
        '【行动】班长｜清点人数',
        FENCE,
        '',
        '例二：正文确实发生突破、护送约定或新规则发布时，分别登记相应结果；只抄实际发生的项：',
        `${FENCE}tags`,
        '【协议】4',
        '【此刻】复苏历三年 三月初七 卯时',
        '【时长】半柱香',
        '【场景：忘川渡口】',
        '【行动】薛铁衣｜迎战｜黄坤',
        '【事件】E1｜黄坤突破至元婴期｜已完成',
        '【当事人】E1｜黄坤',
        '【变化】黄坤｜实力｜元婴期｜E1',
        '【事件】E2｜黄坤答应护送白小娥回江州｜未决',
        '【当事人】E2｜黄坤、白小娥',
        '【承诺】黄坤｜护送白小娥回江州｜白小娥｜E2',
        '【事件】E3｜学校向全体学生公开新规则｜已完成',
        '【类别】E3｜公示',
        '【影响范围】E3｜原文｜全体学生',
        '【公开范围】E3｜原文｜全体学生',
        '【持续条件】C1｜E3｜下周起禁止携带手机入课堂｜尚未生效',
        '【条件范围】C1｜原文｜全体学生',
        '【条件时间】C1｜下周｜',
        FENCE,
        '',
        '规则：',
        `1. **一个 ${FENCE}tags 块**，放在正文**最末尾**；开围栏那一行**只有** ${FENCE}tags 这几个字符，别的一律不写。`,
        '2. **一个标签占一整行**——行首不许有别的东西（不缩进、不加「-」或「*」或「1.」），行尾也不许再跟别的标签。',
        '3. 【此刻】＝**现在是什么时候**——一个**时间点**（如「复苏历三年 三月初七 卯时」）。★**不用算、不用跟上一轮对账**；写不出时间点就**别写这一行**（空着就是空着）。',
        '4. 【时长】＝**从这里起又过了多久**（三日后／当夜／一炷香／半晌）。★它与【此刻】**是两回事**：只会说相对时间时，**只写【时长】、【此刻】留空**。',
        '5. 【场景：X】＝**这一场戏在哪儿**（X 用下面【本世界的名号】里列出的**地名**）。换了地方就再写一条。',
        '6. 【行动】谁｜做了什么｜针对谁，中间用全角竖线｜分开。行动只标当轮已行动者，保护其实际落子；普通问候、移动、发资料若无新影响，不单独登记事件。后两格知道就写、不知道就不写——不要为了凑格式编一个名字。',
        '   【事件】本消息编号｜结果摘要｜已完成或未决。编号如 E1、E2，只在本消息内使用；每件事件继承其前面最近的【场景】与【此刻】，后面的时间不回填。可选第四格为账上既有因果事件 ID（顿号分隔），有可靠 ID 才填，不编 ID。',
        '   【类别】事件编号｜类别原话；【当事人】事件编号｜对象名（顿号分隔）；缺少当事人可省略，不为格式编发布人。',
        '   【影响范围】事件编号｜对象/成员/地点/原文｜范围内容；【公开范围】同样三格。影响是制度或事实适用于谁，公开是向谁公布，两者分开；公开不能当成所有人已经知情或行动。多项范围重复写关联行，前后顺序均可。成员只能引用已有组织或分支，不能猜成员；未知对象、例外与交集保留完整原文。',
        '   一件事件是一项已发生、改变后续局面的事实结果，或确立尚需兑现的承诺。结果摘要写具体新事实或义务，不能只给动作加“完成”；同一结果及其多格变化关联同一编号。已完成结果即使还会产生后果，也写已完成；明确未履行义务才写未决。',
        `7. 【变化】谁｜哪一格｜**变成了什么**。★第二格**只能用这几个名**：**角色**＝${roleFields}；**势力**＝${factionFields}。`,
        '   ★★第三格填的是**变完之后那一格的值**——一个**新状态**（对：「元婴期」「重伤」「边关防务总管」「剑术通神」），不是一个**过程**（错：「获取了资源」「大幅提升」——那是**怎么变的**，填进去这一格从此是句空话）。戏里怎么称呼就怎么照抄，**不要**换算成数字或等级分。',
        '   ★★★**角色变强/突破时，第三格要写书里那套档位的名字**（境界/等级/品阶/军阶…本书怎么分就怎么写）：书里分筑基／金丹／元婴，就从筑基写**金丹**；**不许**写成「实力大增」「功力大涨」「大幅提升」这类**抽象的变强总结**——那种话填进去，这一格就再也说不出他到底什么水平了。',
        '   ★**戏里没点出那个新档位就别写这一行**（只写"得了一枚丹药、功力大涨"而没说是哪个境界 ⇒ **留空**，不许拿过程或总结去凑）。',
        '8. 【承诺】谁｜许了什么｜对谁。变化与承诺都可在现有三格后加第四格本消息事件编号，关联同一结果；对象未知但需填第四格时保留空第三格。没有关联事件则省略第四格。',
        '   【持续条件】本消息条件编号｜原因事件编号｜条件正文｜尚未生效/有效/已结束；只在正文明确确立条件时写。公告已完成与制度仍有效分开，不把制度记成永久未决义务。',
        '   【条件范围】条件编号｜对象/成员/地点/原文｜范围内容；【条件时间】条件编号｜开始时间原话｜结束时间原话，未知保留空格，可整行省略，不推算日历。',
        '   【条件变更】已有条件ID｜有效/已结束｜原因事件编号；例如【条件变更】cond_1_1｜已结束｜E4。修改正文或范围时新建条件，并写【替代条件】本消息条件编号｜已有条件ID；旧条文不覆写，已结束条件不能重新激活。',
        '   重提或普通转发用【引用】已有事件ID，例如【引用】ev_1_1，不重新登记原公告。日常获知可写在行动缘由，不建独立知情或传播标签，也不要求先有知情记录。',
        '   人物获知后行动应有合理因果和途径；私密事实不能因为模型看见就让外人知道。密信截获、泄密等改变局面的重要传播写普通新事件，第四格指向原原因。错误公告只记某方发布了某说法，不把其中的灾害、死亡或胜负当成客观事实。',
        '9. 只标**真的发生了**的：只是在场、只是被提到、只是说话，都不算；★**比喻和夸张不算**（"打得天崩地裂"不是变化）。',
        '10. **主角（你正在扮演的那位玩家）的行动照样标**——插件只是记下来，**不会替他做决定**。',
        '11. 写完之后自己数一遍重要结果：逐件检查是否有具体新事实或义务，把只有过程、问候、普通查阅、移动或集结的项从【事件】中删掉，保留实际【行动】。块首有【协议】4；结果、当事人、范围及关联编号与正文一致。没有重要结果时不编事件，不补“无事件”占位标签；事件为零也合格。',
        '',
        '★**自检（照这个查）**：正文末尾应当有**这一个块**，像上面那个例子一样。**没有这个块 = 这一轮没达标。**',
        '',
        '★标签是**给插件读的路标**：正文写法照旧自由（**块外**想怎么写、想怎么提这些记号都行），**不必**为了标签改你的叙事——但**这个块必须有**。',
    ].join('\n');
}

/**
 * ★名号对照（纯函数）：让聊天模型写标签时**有名字可抄**（这是插件能把标签对上账的前提）。
 *   ★只给"名号 + 别名"这两样：不给 id（模型又不用 id）、不给状态与位置（那是世界模型那一侧的账，
 *     塞进聊天上下文只会引导剧情围着账本转）。
 * ★★leg89（用户拍板「模型认得出那就直接按照插件的正名来看」）：别名的真源是**书**——
 *   账上实体不带别名（播种只拷 id/kind/name/location/parent/实力…），别名留在 `canon.bookEntities`。
 *   ⇒ 名册按正名列出，**把书名录里登记的别的叫法括在后面**（有才写），模型写哪个都认得出。
 *   账上有、书里没有的名字照样列（世界模型后续入局的实体书里当然没有）。
 */
export function rosterText(world, { cap = ROSTER_CAP } = {}) {
    const aliasOf = new Map();   // 正名（归一后）→ 别名数组
    for (const c of world?.context?.setting?.frozen?.canon?.bookEntities || []) {
        const n = String(c?.name || '').trim();
        if (!n) continue;
        const list = (c.aliases || []).map((a) => String(a || '').trim()).filter(Boolean);
        if (list.length && !aliasOf.has(n)) aliasOf.set(n, list);
    }
    const active = (world?.entities || []).filter((e) => e?.name && (e.status || 'active') === 'active');
    // ★★★leg89 更正（用户：「120个角色上顶没必要啊」）：**不封顶**。
    //   为什么原设计封顶是错的：这张表是"让模型写对名字"的**必需料**——砍掉的那部分，
    //   模型写了也认不出（会变成"不在名册"），砍它等于**自己制造归不上**。
    //   要省 token 该省别处，不该省这张表（它一项就是"名号（也叫 别称）"，很轻）。
    //   ⚠`cap` 形参保留（既有调用点/判据可自设上限），生产路径不再传它。
    const room = Number.isFinite(cap) ? Math.max(0, cap) : active.length;
    // 地点表：`context.positions`（`derivePositions` 按这本书的地名建）——只列真地名，略过占位词「未明」
    const places = (world?.context?.positions || [])
        .map((p) => String(p || '').trim())
        .filter((p) => p && p !== '未明');
    const rows = active.slice(0, room).map((e) => {
        const alias = aliasOf.get(String(e.name).trim()) || (e.aliases || []).filter(Boolean);
        return alias.length ? `${e.name}（也叫 ${alias.join('、')}）` : e.name;
    });
    if (!rows.length && !places.length) return '';
    const more = active.length > room ? `（另有 ${active.length - room} 位未列出）` : '';
    // ★★★leg89 更正：**地名要一起给**。理由（两处，都是实核出来的）：
    //   ① 注入的规范里写着「【场景：X】用名册里的地名」——而第一版的名册**只有人名**（自相矛盾）；
    //   ② 引擎侧对场景做归一（`tag-extract.js` 拿 `context.positions` 对），
    //      模型凭空写的地名会被标成"不在账上的地名"⇒ 地点事实整体打折。
    //   地点表来自 `context.positions`（`derivePositions` 按**这本书**的地名建的，134 项 ≈ 180 est，很轻）。
    const placeLine = places.length ? `\n【本世界的地名】\n${places.join('、')}` : '';
    return `【本世界的名号】\n${rows.join('、')}${more}${placeLine}\n`
        + `（写标签时用这里的**正名**（括号里的是别叫法，写了插件也认）；这些之外的生名字插件认不出。）`;
}

// ★★★leg198：**`proseOnly` 整族已搬进 `src/prose.js`**（本文件照旧 import 它，调用点一个没动）。
//   为什么搬：**提取那一趟也要用它**（社区反馈第 4 条），而提取链在引擎那一层，`src/` 不许 import `web/`。
//   ★口径、三条边界、以及那一族实测曲线（空手 67 轮 35.3% → 25 轮 13.2%），**随函数一起搬去新家**
//     （一处定义只能有一个家：同一个函数两处各写一份，是本仓为"两份规则表分叉"付过账的那个形状）。
//   ★本文件只留"谁在用它"这一件事：① 找旧事的查询串（下面 `sw2RecallQueryText` 那一处）；
//     ② 往事注入那一行的去重键（`lineKey`）。**提取那一趟不在这里**——它在 `src/tick.js`。

/**
 * ★★★leg115：**检索用的那几个字** = **上一轮正文的尾巴 ＋ 玩家这一轮刚打的**。
 *
 * ★为什么不能只用"玩家刚打的那句"（用户当场指出来的漏洞）：
 *   玩家可能只打「**继续**」「嗯」「然后呢」——**那句话里一个字都没有可查的**，命中当场归零。
 * ★为什么"上一轮正文"是对的：**账上那些往事本来就是围着它长出来的**（世界模型上一轮读的就是它），
 *   两者**同源** ⇒ 必然对得上。它也是上下文里**最长、信息最密**的那一段。
 * ★顺序：**主要的那句放最后**（检索器按整串处理时，靠后的权重更实；与 `recall.js:40` 那条口径同源）。
 * ★怎么认出哪条是玩家打的：ST 用 `is_user` 区分（**不按 `name` 猜**——玩家可以叫任何名字）。
 * ★拿不到就返回空串：**空查询 = 不检索**（不是"检索了个寂寞"，那两件事要分得开）。
 *
 * ★★★leg136：上一轮那条正文**要取两截**——**剥掉机器块之后的正文** ＋ **原文尾巴**，
 *   两截**都要**。理由与实测见 `proseOnly` 的头注 ＋ 下面那一段（**只取剥后那一截会掉 12 轮**）。
 *
 * @param {object} ctx  ST 上下文（现取，不许抓死）
 * @param {number} cap  **每一截**最多取几个字（默认 400）
 *   ★★leg136 改了语义（原来是"上一轮正文那一半的总上限"）：现在上一轮正文**取两截**（见上），
 *     所以"上一轮正文"这一半最多是 **2×cap**。★为什么必须改（实测曲线，190 轮真账）：
 *     | 口径 | 空手率 | 平均取到 | ★"旧有货→新空手"的真回归 |
 *     |---|---|---|---|
 *     | 改前（只取原文尾巴 cap） | 35.3% | 13.8 条 | 0 |
 *     | 只取剥后正文 cap | 9.5% | 26.9 条 | **12 轮** |
 *     | 两截各 cap/2（总量仍 ≤ cap） | 23.7% | 21.4 条 | **17 轮** |
 *     | ★**两截各 cap**（本口径） | **3.2%** | **29.5 条** | ★**0 轮** |
 *     ⇒ 三个读数一起看才敢改：**只把 cap 分一半反而更差**（剥后那截被砍短 ⇒ 名字少了），
 *       而**两截都给满**是唯一"空手更少、且一轮都不掉"的口径。
 *   ★代价为零：查询串**不进模型**（它只用来在账上点名），长一点不花一个 token。
 * @param {number} cap   **每一条正文**最多取几个字（默认 400）
 * @param {number} depth ★★★leg161：**取几条正文**＝「检索上下文深度」（默认 2 ＝ 本笔之前写死的那个行为）
 * @param {{black?: string, white?: string}|null} lists ★★★leg200：**剥什么由玩家的两份名单说了算**
 *   （参数页「正文怎么读」那两格）。★**两个都空 ⇒ 一个字都不剥**（那枚总闸开关 leg200b 已撤）。
 *   （传 `null` 也照样不剥——留这条路只为老调用方零扰动。）
 * @returns {string} 形如「<原文尾巴> <剥后正文尾巴> <玩家这一轮打的>」（有重复时自动去重一截）
 */
export function sw2RecallQueryText(ctx, cap = 400, depth = 2, lists = {}) {
    const chat = ctx?.chat;
    if (!Array.isArray(chat) || !chat.length) return '';
    const textOf = (m) => (typeof m?.mes === 'string' ? m.mes : '');
    const last = chat[chat.length - 1];
    const lastIsUser = last?.is_user === true;
    const currentUser = lastIsUser ? textOf(last).trim() : '';
    // ★★★leg161（用户令「**把看多少轮之前改成旋钮给用户**」那族口径 ＋ 检索参数三格）：
    //   **取几条正文当查询串**＝「检索上下文深度」（`RETRIEVAL_PARAMS.depth`，出厂 2）。
    //   ★它与 `yuzuki-Memory` 那一格是**同一件事**（它 `extractSearchText` 从 `ctx.chat` 末尾往回凑 `depth` 条）。
    //   ★**缺省 2 ＝ 本笔之前写死的那个行为**（逐字节不变）⇒ 老调用方零扰动。
    //   ★跳过玩家发言（只要"世界写的那几轮正文"），跳过空白；凑不满就有几条算几条（**不编**）。
    const wantDepth = Number.isFinite(Number(depth)) && Number(depth) > 0 ? Math.floor(Number(depth)) : 2;
    const proseParts = [];
    for (let i = chat.length - (lastIsUser ? 2 : 1); i >= 0 && proseParts.length < wantDepth; i -= 1) {
        if (chat[i]?.is_user === true) continue;        // 跳过更早的玩家发言，只要**世界写的正文**
        const t = textOf(chat[i]).trim();
        if (t) proseParts.push(t);
    }
    const n = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 400;
    const tail = (s) => (s.length > n ? s.slice(-n) : s);
    const parts = [];
    // ★第一截照旧"原文尾巴"（leg136 实测：只取剥壳那截会掉 12 轮）
    const prevRaw = proseParts[0] || '';
    if (prevRaw) parts.push(tail(prevRaw));
    // ★第二截＝**每条都补一截"剥掉机器块之后的"**（原来只对上一轮做；深度 >1 时那几轮同样要）
    //   ★★★leg200：剥什么**由玩家的两份名单说了算**（`lists = {black, white}`，口径全文在 `src/prose.js`）；
    //     ★**两个都空 ⇒ `proseOnly` 原样返回**（＝一个字都不剥）⇒ 下面那句 `prose !== raw` 自然跳过。
    for (const raw of proseParts) {
        const prose = (lists ? proseOnly(raw, lists) : raw).trim();
        if (prose && prose !== raw) parts.push(tail(prose));
    }
    if (currentUser) parts.push(currentUser);
    return parts.filter(Boolean).join(' ');
}

/**
 * ★★★leg121（细案 `docs/spec-chat-ledger-conflict.md`）：**"账上跟书不一样的地方"那一段**。
 *
 * ＝＝ 它治什么病（实测抓到的，不是设想）＝＝
 *   聊天模型每轮读的是**世界书**（ST 自己塞进提示词的），而账本早就不等于书了：谁死了、
 *   谁的哪一格被哪件事改成了什么——**账上全记着，可这些东西一个字都没进过对话** ⇒ 模型照书里的旧样子写。
 *   实测（真账最后一轮重掷、真模型）：模型**把账上唯一已死的人写成了行动的主语**
 *   （「万子明｜献上｜秘库钥匙」），而生产解析器**认得出、收得下** ⇒ 这件事会一路落进账本。
 *   同一次实测的对照：加上这一段 ⇒ 它**当场把人写死了**；把这一段**写反** ⇒ 它**又写活了**。
 *   ⇒ 本函数把那几条**读出来、排成人话**，由 `apply()` 并进第四段。
 *
 * ＝＝ 为什么"只喂分歧、不喂账本"（本笔的设计脊梁）＝＝
 *   本模块顶上那条口径是**有意**的："不给状态与位置（塞进聊天上下文只会引导剧情围着账本转）"。
 *   本函数**不递账本**，只递"**与书不一致的那几条**"——数量天然极小、没分歧时**一个字都不注入**
 *   ⇒ 它是"**更正**"，不是"世界的现状表"。★**喂什么比喂不喂重要。**
 *
 * ＝＝ 两个来源（都读账上**现成**的东西：零新表、零新字段、零契约改动、零模型调用）＝＝
 *   ① **已死**：`e.status === 'dead'`。★来路（第几轮）从**编年行**取——
 *      `applyEntityFates`（`src/settle.js:931-937`）**只写 status 与一条编年行、不写 `entityFields`**
 *      （真账 3 个人都没记因、没记轮次）；编年行的 id 是 `ch_<轮次>_fate_<实体id>`，**轮次就在号里**。
 *   ② **被事件改过的格**：`meta.entityFields[id].fields[f].source === '变更'`
 *      （`src/settle.js:1020-1023` 落账时就把 `value / prev / cause / tick` 四样一起写下了）。
 *
 * ＝＝ 三条口径（缺一条这个设计就是错的）＝＝
 *   ① ★**只说"已死"，不说 `retired`**（用户 2026-09-23 拍板）：`retired` 是**引擎机械背景化**
 *      （`src/settle.js:1138`）而且新事件点名时**会自动复归**（`:1101-1106`）
 *      ⇒ 把一条记账分类说成世界事实会误导模型。
 *   ② ★**原值缺了就不说原值**（红线 `STATE.md` §2.2 第 2 条"空着就是空着"）：
 *      `prev` 没有 ⇒ 只说现值，**绝不许**编一句"书里是空的"。
 *   ③ ★**截断必须说出来**（不许静默——`leg112` 撤掉的那条静默闸是血证）。
 *
 * ＝＝ ★★★leg146 修的三处（用户令：「在世界侧被修改过的实体，就一定要把**它现在在世界侧的样子**告诉模型」）＝＝
 *   ① ★**原值那一半以前在真机上根本没印出来**：读数写成 `r.prev.value`，而生产落账写的是**裸字符串**
 *      `prev`（见下面循环里那段注释）⇒ 用户以为"两边同列"，实际只有前半句。**判据为什么没咬住**：
 *      `test/ledger-divergence.test.js` 的夹具用了 `prev: { value, source }` 这个**生产上任何一条路都不写**的形状
 *      ⇒ 绿的是夹具，不是生产（本仓老教训："判据通过了，不等于它量的是那件事"）。
 *   ② ★**"书里原样"这四个字是一个**断言**，要凭证据说**：有 `prior` 看它自己的 `source`，没有就问
 *      `entity.fieldSource[field]`（发票）；证不出来就说「这之前是「…」」——**不许拿账上的上一版冒充书里那句**。
 *      ★★★**leg146b 用户令：「别写书里原样了，就写属性变更即可」⇒ 那套"凭发票说出处"的逻辑整条撤掉**
 *      （不留死码）：现在只写「**改之前 → 改之后**」，一个字不提书。
 *   ③ ★**`status` 不进属性行**：它是引擎簿记栏（值域 `active/retired/dead`），照印就是往对话里塞内部枚举值；
 *      改它的路只有"带因复活"一条 ⇒ 说人话「已重回场上」。
 *   ④ ★★★**leg146b 用户令：「把轮换成时间」**：那两格时间**不自己造**，读账上既有那把尺子 `timeMarkAt`
 *      （`ledger-recall.js:203`）：`timeMark`（**那时是什么时候**，正文【此刻】原话）优先，退 `elapsed`
 *      （**那一轮此后又过了多久**，正文【时长】原话）；**账上没记 ⇒ 什么都不写**（空着就是空着），
 *      **绝不退回"第 N 轮"**。★段首那句也从「跟书不一样的地方」改成「**已经发生的改变**」，
 *      段尾那句「别照书里的旧样子写」改成「**别照从前的样子写**」（同一句令：不写书里那套对照）。
 *
 * ★**不注入"引擎推的值"那一族**（`位置来源 === '结构推导'`）：细案第一版有它，**实测后整条删掉**——
 *   真账上它是 **142 条 / 4000 字**，而且**根本不是冲突**（书里没写 ≠ 书里写了别的）；
 *   照原文注入等于把账本状态塞进对话，**正好犯上面那条口径**。
 *
 * @param {object} ssot 世界账（**只读**，本函数不改它一个字节）
 * @param {object} [opts] `{ maxChars, volumes }`——`maxChars` 字符硬上限（★提案态；实测基准：3 人 ＝ 109 字）；
 *   `volumes` = 卷（冷档）里的编年行（时间印记可能落在已经轮转进卷的行上，`timeMarkAt` 两处都看）
 * @returns {string} 那一段人话；★**没有分歧 ⇒ 空串**（调用方据此"没有就不挂这一段"）
 */
export const DIVERGENCE_DEFAULT = Object.freeze({ maxChars: 600 });

export function ledgerDivergenceText(ssot, { maxChars = DIVERGENCE_DEFAULT.maxChars, volumes = null } = {}) {
    const entities = ssot?.entities || [];
    if (!entities.length) return '';
    const ef = ssot?.meta?.entityFields || {};

    // ★★★leg146b（用户令：「**把轮换成时间，别写书里原样了，就写属性变更即可**」）：**时间印记**这一处读法
    //   **不自己造**——账上早有一把尺子：`timeMarkAt`（`ledger-recall.js:203`，leg115 立、leg137 分两格）。
    //   · `timeMark`＝**那时是什么时候**（时间点，正文【此刻】的原话）；
    //   · `elapsed`＝**那一轮此后又过了多久**（相对量，正文【时长】的原话）。
    //   ★两格分开摆、**只摆原话不做算术**（红线 `STATE.md` §2.2 第 1 条：时间也归这条管）。
    //   ★★**账上没记时间 ⇒ 什么都不写**（空着就是空着）——**绝不退回"第 N 轮"**（那是引擎轮次，用户点名不要它）。
    const timeOf = (t) => {
        if (!Number.isInteger(t)) return '';
        const tm = timeMarkAt(ssot, t, volumes);
        if (tm.timeMark) return `（${tm.timeMark}）`;
        if (tm.elapsed) return `（那一轮此后又过了：${tm.elapsed}）`;
        return '';
    };

    // ① 已死：轮次从编年行的**号**里解（`ch_<轮次>_fate_<实体id>`）⇒ 再换成账上的**时间印记**
    const fateTick = new Map();
    for (const r of ssot?.chronicle || []) {
        const m = /^ch_(\d+)_fate_(.+)$/.exec(String(r?.id || ''));
        if (m && !fateTick.has(m[2])) fateTick.set(m[2], Number(m[1]));
    }
    const rows = [];
    for (const e of entities) {
        if (e?.status !== 'dead' || !e.name) continue;
        const t = fateTick.get(e.id);
        rows.push({ tick: Number.isInteger(t) ? t : -1, text: `  · ${e.name}：已死${timeOf(t)}` });
    }

    // ★★★leg146b（用户令：「**把轮换成时间，别写书里原样了，就写属性变更即可**」）：**时间印记**那一处读法
    //   **不自己造**——账上早有一把尺子：`timeMarkAt`（`ledger-recall.js:203`，leg115 立、leg137 分的两格）。
    //   · `timeMark`＝**那时是什么时候**（一个时间点，正文【此刻】的原话）；
    //   · `elapsed`＝**那一轮此后又过了多久**（相对量，正文【时长】的原话）。
    //   ★两格分开摆、**只摆原话不做算术**（红线 `STATE.md` §2.2 第 1 条：时间也归这条管）。
    //   ★★**账上没记时间 ⇒ 什么都不写**（空着就是空着）——**绝不退回"第 N 轮"**（那是引擎轮次，用户点名不要它）。
    // ② 被事件改过的格（**写成一次属性变更**：改之前 → 改之后 ＋ 时间）
    const byId = new Map(entities.map((e) => [e.id, e]));
    for (const [id, rec] of Object.entries(ef)) {
        const e = byId.get(id);
        if (!e?.name) continue;
        for (const [field, r] of Object.entries(rec?.fields || {})) {
            if (r?.source !== '变更') continue;
            const t = Number.isInteger(r?.tick) ? r.tick : -1;
            const when = timeOf(t);
            // ★★leg146：**`status` 不进属性行**——它是**引擎的簿记栏**，不是"书里的属性"；照原样印出来
            //   就是「账上是「active」」这种内部枚举值（犯 `STATE.md` §2.5 的人话红线）。
            //   而改 `status` 的路**只有一条**：`check-step.js:355-359` 明写"status 只用来带因复活"
            //   ⇒ 用**账上自己那句话**的人话报（`settle.js:1048`「带着因由重回场上」）。
            //   ★当前仍是 `dead` 的不报"重回"（先复活、后又覆灭 ⇒ 与①段那条「已死」自相矛盾）。
            if (field === 'status') {
                if (e.status === 'dead' || r?.value === 'dead') continue;
                rows.push({ tick: t, text: `  · ${e.name}：已重回场上${when}` });
                continue;
            }
            // ★★★leg146 修（上一笔的正题）：原值那一半的读法以前**只认 `{value}` 一种形状**，而**生产落账写的是
            //   **裸字符串**（`settle.js:1009/1071` 与 `:1191/1197` 都是 `prev = ent[field]`；判据
            //   `entity-writeback.test.js:74` 正是按字符串断言的）⇒ `.value` 恒 `undefined` ⇒ 真机上
            //   **改之前那个值从来没印出来过**（真账实测：黑山老妖〈实力〉那一条只剩后半句）。
            //   三种形状都认，顺序照 `web/entity-window.js:145` 那把**既有正确读法**：**链式留痕 `prior` 优先，否则 `prev`**。
            const priorRec = r?.prior && typeof r.prior === 'object' ? r.prior : null;
            const prev = [priorRec?.value, r?.prev, r?.prev?.value].find((v) => typeof v === 'string' && v) || '';
            // ★★★leg146b：**不写出处、不写"书里原样"**（用户令）——只把"**从什么变成了什么**"摆出来。
            //   ⇒ `prior` / `entity.fieldSource` 那套**凭发票说话**的逻辑据此**整条撤掉**（不留死码）。
            rows.push({ tick: t, text: `  · ${e.name}的〈${field}〉：${prev ? `${prev} → ` : ''}${r?.value ?? ''}${when}` });
        }
    }

    if (!rows.length) return '';
    // ★"轮次新的在前"——这只是**取多少**的尺子，**不是**"谁更重要"（红线 `STATE.md` §2.2 第 1 条）
    rows.sort((a, b) => b.tick - a.tick);

    const budget = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : Infinity;
    const kept = [];
    let used = 0;
    for (const r of rows) {
        if (used + r.text.length > budget) break;
        kept.push(r.text); used += r.text.length;
    }
    if (!kept.length) return '';      // 一个字都放不下 ⇒ 宁可不挂（空着就是空着）
    const cut = rows.length - kept.length;
    return [
        '【这一局里已经发生的改变】',
        ...kept,
        cut > 0 ? `  （★这一栏只列了最近 ${kept.length} 条，另有 ${cut} 条没放进来——不是没有）` : '',
        '（这些是这一局里真的发生过、已经记在账上的改变——正文按这里写，别照从前的样子写；'
        + '也不要把这一段当台词念出来。）',
    ].filter(Boolean).join('\n');
}

/**
 * 组装要注入的那几段（纯函数，便于判据逐字锁）。
 * @returns {{tags: string, world: string, ledger: string}} 空串 = 该段不注入
 *   ★`ledger`（第四段 · leg115）= 拿"上一轮正文＋这一轮输入"去**账上**取回来的往事
 *     （来路/经过/收场那几类话，**当轮交付**）。`world` 是"这一轮世界发生了什么"（短、单轮），
 *     `ledger` 是"以前发生过什么、为什么收场"（深、跨多轮）——★两段不是一件事，别合并。
 */
export function buildInjections(world, { roster = true, spec = true, worldTide = false, ledger = '' } = {}) {
    const seenConditions = new Set();
    const currentConditions = (world?.conditions || []).filter(c => {
        if (!c?.id || !['planned','active'].includes(c.state) || seenConditions.has(c.id)) return false;
        seenConditions.add(c.id); return true;
    }).map(c => {
        const scopes = (c.scope || []).map(s => s.text).filter(Boolean).join('；');
        const confirmed = currentScopeIds(c.scope, world).map(id => (world?.entities || []).find(e => e.id === id)?.name || id);
        return `${c.id}｜${c.state === 'active' ? '有效' : '尚未生效'}｜${c.statement}`
            + (scopes ? `｜适用范围：${scopes}` : '')
            + (confirmed.length ? `｜当前已确认部分：${confirmed.join('、')}` : '')
            + (c.effectiveFrom ? `｜开始：${c.effectiveFrom}` : '')
            + (c.effectiveUntil ? `｜结束：${c.effectiveUntil}` : '');
    });
    const tags = [
        spec ? tagSpecText() : '',
        roster ? rosterText(world) : '',
        currentConditions.length ? `【当前持续条件 · 按ID引用】\n${currentConditions.join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
    // ③ **世界动向 = 这一轮世界发生了什么**（`runTick` 结算后写进 `meta.lastInjection` 的编年条目）。
    //   ★★★leg89 补（用户：「**把这一轮世界发生了什么注入上下文啊**」）：这一格**原来是空的**——
    //     我第一版读 `meta.lastInjection` 而**全仓零处写它**（那段只在 demo 脚本里被打印过）
    //     ⇒ 那个开关是个**死开关**（开了什么都不发生）。现在写读两端都接上了。
    //   ★时差（设计，不是 bug）：世界步在**这一轮收到消息之后**才结算 ⇒ 注入进下一轮聊天上下文的是
    //     "上一轮结算出来的这一轮"。这是"账按轮走、故事按时间走"的代价，要在界面上说明白。
    //   ★包一层标题，让聊天模型一眼看出这是**已经发生过的世界事实**（不是让它去写的剧本）。
    const tide = worldTide && world?.meta?.lastInjection
        ? `【世界动向 · 已经发生的事】\n${String(world.meta.lastInjection)}`
        : '';    // ④ ★leg115 **账上往事**（"以前发生过什么、为什么收场"）——由调用方取好递进来（`ledger`），
    //   本函数只负责**合进去**。取数那一步在编排层（它才知道"上一轮正文＋这一轮输入"是什么）。
    //   ★为什么与 ③ 分开而不是合并：③ 是**这一轮**世界发生了什么（短、单轮）；④ 是**以前**的来路与收场
    //     （深、跨多轮）。两段的读者问题不同（"刚出了什么事" vs "这事当初怎么起的"）。
    return { tags, world: tide, ledger: String(ledger || '') };
}

/**
 * 注入器（依赖注入式工厂，照本仓 `createParamHub`/`createSnapshotHub` 的先例：**注入的是函数不是值**）。
 * deps: `{ getCtx, getWorld, isOn, setStatus }`
 *   - `getCtx()`   现取 ST 上下文（**不许抓死**：换聊天/换卡后上下文会换）
 *   - `getWorld()` 现取当前世界（拿名册）
 *   - `isOn(key)`  读设置开关（缺省 false = 不注入）
 *   - `setStatus(msg)` 如实出声（取不到注入口时只报一次）
 */
export function createInjector({ getCtx, getWorld, isOn = () => false, setStatus = () => {}, vectorRecall = null, vectorEnabled = () => true, retrievalParams = null } = {}) {
    if (typeof getCtx !== 'function' || typeof getWorld !== 'function') {
        throw new TypeError('createInjector：`getCtx` 与 `getWorld` 必须是函数（注入的是函数不是值）');
    }
    // ★★★leg161（用户令「**那就让聊天侧也接上向量检索呗**」）：**向量路**（可选）。
    //
    //   【为什么它是一个注入的函数、而不是本模块自己 import 向量层】
    //     ① 存储与网络住浏览器侧（`web/embed-runtime.js`）——本模块**照旧零 indexedDB 顶层访问**，
    //        Node 里可直接真跑（判据不需要造环境）；
    //     ② ★`apply()` 是**同步**的（ST 的注入口是同步的），而"把查询串嵌成一条向量"要**一趟网络**
    //        ⇒ **不能在这里 await**。⇒ 定稿：**调用方在消息进来时后台把向量备好**，
    //        本模块只同步读属于当前查询的结果；没备好就只走字面路，结果完成后重设注入。
    //     ★这与本模块既有的"**卷缓存 ＋ 后台刷新**"是同一个办法（见上面 `volumeCache` 那一族）。
    const vecDeps = typeof vectorRecall === 'function' ? vectorRecall : null;
    // ★★★（2026-10-05）参数页那三格**现读**：由接线层把"读设置"这一个动作递进来。
    //   缺省（没接线／判据里的纯注入器）⇒ 每格都回 `RETRIEVAL_PARAMS` 的出厂值 = 本笔之前的行为。
    //   ★**每次用时现取**，不在装配时抓死——抓死就是这一笔要治的那个病。
    const paramsNow = () => (typeof retrievalParams === 'function' ? liveRetrievalParams(retrievalParams()) : RETRIEVAL_PARAMS);
    let vecRows = [], vecProvenance = null, vectorEpoch = 0, vectorScope = null, vectorJob = null;
    let vecNote = vecDeps ? '还没备' : '没接向量路';
    // 结果属于一次完整查询；同一个世界对象也可能换话题、切聊天或回档。
    // ★★（2026-10-05）**取数那几格（问多长／取几条／多像才算像）也算这份结果的一部分**——
    //   它们一改，手里这份就是按旧参数备的 ⇒ 必须当场作废重取（见下面 `prefetchVectors` 那条
    //   `sameVectorScope` 短路）。旧法用装配时抓死的常数，所以这条指纹永远不会变。
    function readVectorScope() {
        try {
            const ctx = getCtx(), world = getWorld();
            const p = paramsNow();
            const text = sw2RecallQueryText(ctx, 400, p.depth);
            return world && text ? {
                world, tick: world.meta?.tick, text,
                chatId: ctx?.chatId, characterId: ctx?.characterId, groupId: ctx?.groupId,
                top: p.top, minScore: p.minScore, depth: p.depth,
            } : null;
        } catch (_) { return null; }
    }
    function sameVectorScope(a, b) {
        return Boolean(a && b && a.world === b.world && a.tick === b.tick && a.text === b.text
            && a.chatId === b.chatId && a.characterId === b.characterId && a.groupId === b.groupId
            && a.top === b.top && a.minScore === b.minScore && a.depth === b.depth);
    }
    /** ★调用方（接线层）在消息进来时调它：后台把向量备好；**永不抛**。 */
    function prefetchVectors() {
        try {
            if (!vecDeps || !vectorEnabled() || !isOn('injectLedgerRecall')) { clearVectors(); return; }
            const scope = readVectorScope();
            if (!scope) { clearVectors(); return; }
            if (sameVectorScope(vectorScope, scope)) return vectorJob;
            clearVectors();
            vectorScope = scope;
            const epoch = vectorEpoch;
            vecNote = '准备中';
            const current = () => {
                try {
                    return epoch === vectorEpoch && vectorEnabled() && isOn('injectLedgerRecall')
                        && sameVectorScope(scope, readVectorScope());
                } catch (_) { return false; }
            };
            const reapply = () => { try { apply(); } catch (_) { /* 后台召回不能影响发送 */ } };
            const p = vecDeps();
            if (p && typeof p.then === 'function') {
                vectorJob = Promise.resolve(p).then((rows) => {
                    if (!current()) { if (epoch === vectorEpoch) clearVectors(); return; }
                    if (rows == null) { clearVectors(); reapply(); return; }
                    vecRows = Array.isArray(rows) ? rows : Array.isArray(rows?.items) ? rows.items : [];
                    vecProvenance = rows?.report?.provenance || null;
                    vecNote = vecRows.length ? `${vecRows.length} 条` : '空手';
                    reapply();
                }).catch((err) => {
                    if (!current()) { if (epoch === vectorEpoch) clearVectors(); return; }
                    clearVectors(); vecNote = `失败（${err?.message || err}）`;
                    reapply();
                });
                return vectorJob;
            }
            else { clearVectors(); }
        } catch (err) {
            // 失败零阻塞：加速层不许影响世界、也不许拦住注入
            clearVectors(); vecNote = `失败（${err?.message || err}）`;
        }
    }
    // ★★★leg119：卷缓存也要知道"现在是哪个聊天"——复用同一个 `getCtx`（**不新增依赖形参**，
    //   见本模块上面那一族注释：`web/index.js` 只剩 1 行余量，加不了新接线）。
    function clearVectors() { vectorEpoch++; vecRows = []; vecProvenance = null; vectorScope = null; vectorJob = null; vecNote = '关键词'; }
    bindVolumeSource(getCtx, getWorld);
    let warned = false;
    let lastLine = null;
    // ★★★leg92：**跑过的证据**（用户报"开关是 1、字典里却没有"时，这一格能一眼分开"没跑"与"跑了失败"）。
    //   记的是**事实**：调用了几次、最后一次什么结果、什么时候。
    //   ★★★（2026-10-05）**多一格 `last`**：上一次那几段各多少字、往事取回几条（参数页那一行读数读它，
    //     见 `runFacts()`）。★与 `lastChars` 那种"一个总数"不同：它是**分段的**，面板才画得出
    //     "格式指令 N 字 · 世界动向 M 字 · 账上往事 K 字"。
    const runs = { count: 0, lastOk: null, lastOff: null, lastChars: 0, lastAt: null, last: null };

    const readApi = () => {
        const ctx = getCtx();
        const fn = ctx?.setExtensionPrompt;
        const types = ctx?.extension_prompt_types || ctx?.extensionPromptTypes;
        // ★★★leg90c 真因修（用户：「**上下文我好像都没看见注入**」）：
        //   原来这里用的是 **`IN_CHAT`（=1）**——那是 leg89 设计时拍的口径（"贴着最后一条消息"），
        //   而它在 **chat completion 的组装阶段被整段丢掉**。ST 源码（`scripts/openai.js`）：
        //     · 1345 行：`if (![BEFORE_PROMPT, IN_PROMPT].includes(prompt.position)) continue;`
        //       ⇒ **`IN_CHAT` 的扩展提示词根本不进 prompt**（不进 = 模型永远收不到）；
        //     · `getPromptPosition`：`BEFORE_PROMPT(2)→'start'`、`IN_PROMPT(0)→'end'`，**其余一律返回 false**。
        //   ⇒ 我们那两段一直只写在 ST 的字典里（所以面板读数/`extensionPrompts` 都"看得见"），
        //     **却一次都没进过发给模型的 prompt**。这解释了"读数说注入了 475 字、模型就是不写标签"。
        //   ★定稿用 **`IN_PROMPT`(0)**：映射成 `'end'`，作为一条 system 消息排在提示词集合末尾
        //     （既有"靠后=更受注意"的好处，又真的进 prompt）。`scan=false` 照旧。
        //   ★取不到常量时退回**字面量 0**（`IN_PROMPT`，`script.js:449`）；**绝不退回 1**。
        const inPrompt = typeof types?.IN_PROMPT === 'number' ? types.IN_PROMPT : 0;
        const sysRole = 0;   // extension_prompt_roles.SYSTEM → getPromptRole → 'system'
        return typeof fn === 'function' ? { fn: fn.bind(ctx), position: inPrompt, sysRole } : null;
    };

    /** 撤掉上一轮注入的两段（**先撤后写**：绝不让上一轮冒充本轮）。 */
    function clear() {
        clearVectors();
        const api = readApi();
        if (!api) return false;
        try {
            api.fn(INJECT_KEY_TAGS, '', api.position, 0, false, api.sysRole);
            api.fn(INJECT_KEY_WORLD, '', api.position, 0, false, api.sysRole);
            api.fn(INJECT_KEY_LEDGER, '', api.position, 0, false, api.sysRole);   // ★leg115 第四段一起撤
            return true;
        } catch (_) { return false; }
    }

    /**
     * ★★★（2026-10-05 · 用户令「**把图片的第一段话中的关键信息抽取出来展示在参数页**」）：
     * **把上一次注入的经过抽成一份读数**（面板据此画那一行；措辞住 `web/inject-readout.js`）。
     * ★为什么不在面板那边解析 `line` 那个句子：那是**给人读的整句**（还带着"position=0"这类
     *   排查用的尾巴），从里面正则抠数字就等于把印法变成口径——本仓治过这种病（"同一件事两处表达"）。
     * ★这里**只报事实**：每段多少字、往事取回几条/被额度挡下几条、向量那一路什么状态。
     * @returns {object|null} 注入器还没跑过 ⇒ `null`（面板画"还没跑过"，不编数）。
     */
    function runFacts() {
        const last = runs.last || null;
        if (!last) return null;
        const n = (v) => (v == null ? null : Number(v) || 0);
        return {
            count: runs.count, at: runs.lastAt,
            status: last.status,
            tagsBytes: n(last.tagsBytes), rosterBytes: n(last.rosterBytes),
            roster: Boolean(last.rosterInTags),
            tideBytes: n(last.tideBytes),
            ledgerOn: Boolean(last.ledgerOn),
            divergenceBytes: n(last.divergenceBytes), recalledBytes: n(last.recalledBytes),
            recall: last.recall ? { ...last.recall } : null,
            totalBytes: n(last.tagsBytes) + n(last.tideBytes) + n(last.ledgerBytes),
        };
    }

    /**
     * 按当前设置与世界**重设**注入。返回自证读数（面板/控制台都读它）：
     * `{ ok, off, tagsChars, worldChars, line, facts }`。★`off` = 玩家把开关关了（**不是失败**，别报成失败）。
     */
    function apply() {
        const spec = Boolean(isOn('injectTagSpec'));
        const roster = Boolean(isOn('injectRoster'));
        const tide = Boolean(isOn('injectWorldTide'));
        const ledgerOn = Boolean(isOn('injectLedgerRecall'));
        const stamp = () => {
            runs.count += 1;
            runs.lastAt = (() => { try { return new Date().toISOString(); } catch (_) { return null; } })();
            // ★★★（2026-10-05）**这一格的初值**：`runs.last` 由下面各条出口按"这一次真发生了什么"填。
            //   先清空 ⇒ 不会出现"这一次没走到那一步、面板却印着上一次的事"（"过期货冒充新检索"那条老病）。
            runs.last = { status: 'ok' };
        };
        if (!spec && !roster && !tide && !ledgerOn) {
            clear();
            lastLine = '标签注入：已关（插件不看也不动你的对话）';
            stamp(); runs.lastOk = true; runs.lastOff = true; runs.lastChars = 0;
            runs.last = { status: 'off' };
            return { ok: true, off: true, tagsChars: 0, worldChars: 0, line: lastLine, runs: { ...runs }, facts: runFacts() };
        }
        const api = readApi();
        if (!api) {
            // ★如实降级：注入口取不到就别假装注入成功（也只吵一次，别每轮刷屏）
            lastLine = '标签注入：这个 ST 版本没有"往上下文里塞东西"的接口——已跳过（世界照常推进）';
            if (!warned) { warned = true; setStatus?.(`注意：${lastLine}`); }
            stamp(); runs.lastOk = false; runs.lastOff = false; runs.lastChars = 0;
            return { ok: false, off: false, tagsChars: 0, worldChars: 0, line: lastLine, runs: { ...runs } };
        }
        // ④ ★leg115 **账上往事**：拿"上一轮正文＋这一轮输入"去账上取（**当轮交付**）。
        //   ★查询那几个字**本模块自己从 `getCtx()` 现取**（`sw2RecallQueryText`）——**不新增依赖形参**，
        //     也就**不用动 `web/index.js`**（它只剩 1 行余量，动不了）。
        //   ★纪律照 `recall.js`：**失败零阻塞**——取不到就空串，世界照常推进、另外三段照常注入。
        const world = getWorld();
        if (!ledgerOn || !vectorEnabled() || (vectorScope && !sameVectorScope(vectorScope, readVectorScope()))) clearVectors();
        let ledger = '';
        let ledgerNote = '（这段没开）';
        // ★★★（2026-10-05）**这一次取往事的经过**（面板读数行读它，见 `web/inject-readout.js`）。
        //   ★每次 `apply()` 都重算：没开这一段 ⇒ 停在 `null`（面板按"未开"画，不拿上一轮冒充这一轮）。
        let recallFacts = null;
        if (ledgerOn) {
            // ★★★leg146b：**卷先取**——分歧那一段也要用它读时间印记（时间点可能落在已经轮转进卷的行上；
            //   `timeMarkAt` 与检索层看的是**同一份**账，见 `ledger-recall.js:206-209`）。
            const vols = ledgerVolumes();
            // ★★★leg121：**"跟书不一样"那一段不依赖检索**——无条件先算。
            //   它答的是"现在哪里不一样"，与"取哪几条往事"是两个问题 ⇒
            //   **检索空手而归时它照旧在**（判据 D6 锁着；这是它与本段其余部分唯一的结构差别）。
            const div = ledgerDivergenceText(world, { volumes: vols });
            let recalled = '';
            let recallNote = '没取';
            let q = '';
            try { q = sw2RecallQueryText(getCtx(), 400, paramsNow().depth); } catch (_) { q = ''; }
            if (!q) recallNote = '注意：取不到"上一轮正文＋这一轮输入" ⇒ 这一轮没取';
            else {
                // ★★主锚 = **账上真名**（真账实测：上一轮正文里每次都有 11–13 个账上真名，照名取命中 133–224 行）；
                //   字面关键词**并用**当兜底（它单独用会栽：玩家正文与账本用词本来就不同，实测命中 0 条）。
                // ★★★leg119：**卷要一起看**——轮转把最旧的编年整段搬进卷之后，不接这一格就会**悄悄少一半**
                //   （见本模块上面那一族注释；世界模型那一侧走 `pack.js` 的**同一个** `volumes` 参数）。
                //   ★leg146b：`vols` 已提到上面取（分歧那一段的时间印记也要用它）。
                // ★★★leg161（用户令「**那就让聊天侧也接上向量检索呗**」＋「**保证相关度最大就不用管时间了**」）：
                //   **两路并联**——字面路（按真名/按词）＋ **向量路**（按意思）。
                //   ★为什么是并联不是替代（实测）：两法捞出来的行**几乎不重叠（0–1/6）**——
                //     字面路认"名字对得上"，向量路认"意思近"（够得着"只写了车队、没写谁家的"那种）。
                //   ★向量那一路的**条数/阈值**走 `RETRIEVAL_PARAMS`（用户定的三格），
                //     它的向量由调用方**后台备好**（`prefetchVectors`）——本函数**同步**，不许在这里 await。
                //   ★**去重按行身份**（轮次 ＋ 洗过的那句正文）：一个事实只许出现一次
                //     （口径与 `pack.js` 的 `lineKeyOf` 同源）。
                // 先合并完整候选，再按命中数选择预算；预先截断会丢掉匹配更多词的旧行。
                const got = recallLedger(world, { audience: 'chat', modes: [RECALL_MODES.BY_NAMES, RECALL_MODES.BY_KEYWORD], text: q, maxChars: null, volumes: vols });
                const lit = got.ok ? rankKeywordMatches(got.items || [], q) : [];
                const lineKey = (row) => `${Number(row?.tick)}|${proseOnly(String(row?.text ?? '')).trim()}`;
                const vectorFiltered = filterChatRecords(world, vecRows.filter((r) => Number(r?.tick) <= Number(world.meta?.tick)), { volumes: vols });
                const extra = vectorFiltered.items;
                const provenance = filterChatRecords(world, [...(got.provenance?.records || []), ...(vecProvenance?.records || []), ...vectorFiltered.report.records], { volumes: vols }).report;
                // ★★★leg161（**实测逼出来的**）：**两路必须各有一份额度，不能合成一个池子。**
                //   病（400 轮长账上量的）：字面路取回 **641 行**、而 1600 字只装得下 **24 行**
                //   ⇒ 合成一个池子按"轮次新的在前"装 ⇒ 装的全是最新的那 24 行，
                //   **向量路那 6 行一条也挤不进去**（两臂读数一模一样 ⇒ 向量路等于没接）。
                //   ⇒ 治法：**先给字面路一份额度（保眼前接得上话头），再给向量路一份**
                //     （保"按意思找回来的旧事"真有位置）——这正是用户那句
                //     「**保证相关度最大就不用管时间了**」的落点：不划额度，相关度就永远输给时间。
                const kept = [];
                const keptKeys = new Set();
                let vectorCount = 0;
                let litCount = 0;
                // ★★★（2026-10-05）**这一格现在是玩家填的**（参数页「往事注入多少字」）——
                //   此前写死 `LEDGER_RECALL_DEFAULT.maxChars`。
                const cap = paramsNow().maxChars;
                // ★★★（2026-10-05 · 用户令「**字额度切忌把事件截掉**」）：**这一轮到底有几条往事没装下**
                //   ——它进读数行（"额度装不下 N 条"）。★不许静默丢：额度是玩家自己填的，
                //   他得看得见"我这一刀切掉了多少"。
                let overflow = 0;
                // ★★★**总上限那一道：量的就是"真注入那几行"**（对得上玩家填的那个数）。
                //   ★为什么不拿 `JSON.stringify({tick,text}).length`：那把尺量的是**另一件东西**
                //   （连引号带键名，还不含"【第 N 轮】"那一行）⇒ 玩家填 200、真塞 600，而面板还说"没超"。
                //   ★口径：**先按两路各自的优先级装满，再量一次真实产出，超了就从队尾整条摘**
                //   （队尾＝最不优先的那一条：字面路按命中词数、向量路按相似度，两路都是"越靠后越不该占额度"）。
                //   ★摘的永远是**整条**——绝不把一条往事切一半（用户 2026-10-05：「字额度切忌把事件截掉」）。
                const buildKept = () => picks.map((p) => p.it)
                    .sort((a, b) => (Number(a?.tick) || 0) - (Number(b?.tick) || 0));
                const litCap = extra.length ? Math.floor(cap * paramsNow().literalShare) : cap;
                // ★每一条占多少字：**走产出那一侧的同一个函数**（`recalledLineText`，`src/ledger-recall.js`）
                //   ＋它上面那行"【第 N 轮 · …】"。
                //   ★★★leg198 修：这里原来自己拼一行、而且**先 `proseOnly` 剥一遍再量**，而真正印出去的
                //     是**原文**（`formatRecalled`）⇒ **量什么和印什么不是同一把尺子**：玩家填 1600 字，
                //     真塞进去的可能更多（"一个数两把尺子"是本仓付过账的形状）。
                //   ★这里只是两路各自份额的粗算（同一轮多条会略高估 ⇒ 只会更保守），
                //     真正的**总上限**由下面"量真实产出、从队尾整条摘"那一步收口——那一步才是硬判据。
                const sizeOf = (it) => {
                    const tick = Number(it?.tick);
                    const line = recalledLineText(it);
                    const time = timeMarkAt(world, tick, vols);
                    const bits = [`第 ${tick} 轮`];
                    if (time.known) bits.push(`那一轮此后又过了：${time.elapsed}`);
                    else bits.push('（这一轮的"过了多久"账上没记——正文里没写时长）');
                    return 2 + `【${bits.join(' · ')}】`.length + line.length;
                };
                const picks = [];
                let used = 0;
                // ★字面路：**按它的优先级装**（命中词多的在前）——装不下就跳过、接着试下一条
                //   （它按相关性排，跳过一条不等于丢掉后面更该来的）。
                for (const it of lit) {
                    if (keptKeys.has(lineKey(it))) continue;
                    const n = sizeOf(it);
                    if (used + n > litCap) { overflow++; continue; }
                    used += n; picks.push({ it, from: 'lit' }); keptKeys.add(lineKey(it)); litCount++;
                }
                // ★向量路那一份：它的顺序**就是相似度序**（从最像到最不像）——**不许重排**
                //   （排了就把那一层唯一的产出毁了：哪几条最像）。
                for (const it of extra) {
                    // 只排除实际选入的字面记录，候选池里的旧行仍可能需要向量额度。
                    if (keptKeys.has(lineKey(it))) continue;
                    const n = sizeOf(it);
                    if (used + n > cap) { overflow++; continue; }
                    used += n; picks.push({ it, from: 'vec' }); keptKeys.add(lineKey(it)); vectorCount++;
                }
                // ★字面路这一趟「跳过装不下的、接着试下一条」会把顺序打乱（原文是"按命中数排"，
                //   跳过的那些**不许**因此排到更该来的后面）⇒ 照旧由下面的时间序排序收口。
                for (const it of lit) {
                    if (keptKeys.has(lineKey(it))) continue;
                    const n = sizeOf(it);
                    if (used + n > cap) { overflow++; continue; }
                    used += n; picks.push({ it, from: 'lit' }); keptKeys.add(lineKey(it));
                }
                let keptOut = buildKept();
                let recalledText = keptOut.length ? formatRecalled(world, keptOut, { volumes: vols }) : '';
                while (cap > 0 && keptOut.length > 1 && recalledText.length > cap) {
                    const dropped = picks.pop();
                    overflow++;
                    if (dropped.from === 'vec') vectorCount--; else litCount--;
                    keptOut = buildKept();
                    recalledText = keptOut.length ? formatRecalled(world, keptOut, { volumes: vols }) : '';
                }
                // ★★★（2026-10-05「字额度切忌把事件截掉」的第二半）：**一条都不许截半条，
                //   但也不许因为额度小就一条都不给**——真的一条都装不下时，**整条**装那一条
                //   （最像的那条向量 / 最先的那条字面），并在读数里如实报出"没装下的有几条"。
                //   ★为什么必须有这一条：额度的下限是 1 字，而一条往事印出来几十字 ⇒
                //   没有它，玩家把额度填小就等于**完全关掉了这一段**（那不是"少给"，是"没给"）。
                if (!keptOut.length && cap > 0) {
                    const first = (extra[0] ?? lit[0]);
                    if (first) {
                        picks.push({ it: first, from: extra[0] ? 'vec' : 'lit' });
                        if (extra[0]) vectorCount++; else litCount++;
                        keptOut = buildKept();
                        recalledText = formatRecalled(world, keptOut, { volumes: vols });
                    }
                }
                // Verify again at the final formatting boundary, including cached vector data.
                keptOut = filterChatRecords(world, keptOut, { volumes: vols }).items;
                recalledText = keptOut.length ? formatRecalled(world, keptOut, { volumes: vols }) : '';
                for (const it of keptOut) kept.push(it);
                provenance.selectedIds = kept.map(it => String(it?.id ?? ''));
                recalled = recalledText;
                recallNote = kept.length
                    ? `${recalled.length} 字（字面 ${litCount} ＋ 向量 ${vectorCount}`
                        + `${overflow ? ` · 额度 ${cap} 字装不下 ${overflow} 条` : ''}）`
                    : (got.ok ? '没命中' : `没命中（${got.reason}）`);
                if (vecDeps) recallNote += ` · 向量路 ${vecNote}`;
                // ★★★（2026-10-05）**这一段交给面板的读数**（结构与措辞见 `web/inject-readout.js`）：
                //   "哪几路真跑了、各取回几条、被额度挡下几条"。★此处**只报事实**，不判断好坏。
                recallFacts = {
                    bytes: recalled.length, items: kept.length,
                    divergenceBytes: div.length,
                    literal: lit.length, vector: extra.length,
                    keptLiteral: litCount, keptVector: vectorCount,
                    overflow, cap,
                    vectorNote: vecNote,
                    provenance,
                };
            }
            // ★**没分歧、也没取到往事 ⇒ 空串**：与接线之前**逐字节相同**（零扰动，判据 D1 锁着）。
            ledger = [div, recalled].filter(Boolean).join('\n\n');
            //   ★★★leg161：读数里**要看得见两路各给了什么**（"字面 N ＋ 向量 M"）——
            //     否则"向量路到底进没进去"在界面上完全看不出来（本仓那条"读数要能说出内容"的老账）。
            ledgerNote = `${ledger.length} 字（跟书不一样 ${div.length} 字 · 往事 ${recallNote}）`;
        }
        const { tags, world: tideText } = buildInjections(world, { spec, roster, worldTide: tide, ledger });
        try {
            if (tags) api.fn(INJECT_KEY_TAGS, tags, api.position, 0, false, api.sysRole);
            else api.fn(INJECT_KEY_TAGS, '', api.position, 0, false, api.sysRole);
            if (tideText) api.fn(INJECT_KEY_WORLD, tideText, api.position, 0, false, api.sysRole);
            else api.fn(INJECT_KEY_WORLD, '', api.position, 0, false, api.sysRole);
            // ④ ★leg115：账上往事（**每轮重设**：把上一轮那段撤掉再写新的，不许上一轮冒充本轮）
            if (ledger) api.fn(INJECT_KEY_LEDGER, ledger, api.position, 0, false, api.sysRole);
            else api.fn(INJECT_KEY_LEDGER, '', api.position, 0, false, api.sysRole);
        } catch (err) {
            lastLine = `标签注入：写入失败（${err?.message || err}）——这一轮没有注入`;
            setStatus?.(`注意：${lastLine}`);
            stamp(); runs.lastOk = false; runs.lastOff = false; runs.lastChars = 0;
            runs.last = { status: 'fail' };
            return { ok: false, off: false, tagsChars: 0, worldChars: 0, line: lastLine, runs: { ...runs }, facts: runFacts() };
        }
        warned = false;
        stamp(); runs.lastOk = true; runs.lastOff = false; runs.lastChars = tags.length + tideText.length + ledger.length;
        // ★★★（2026-10-05）**这一次注入的经过**（面板那一行读数读它）：哪几段真写了、各多少字、
        //   往事那一段两路各取回几条。★放在 `lastChars` 那两条出口**之前**——三种出口都要带上它。
        runs.last = {
            status: runs.lastChars ? 'ok' : 'empty',
            tagsBytes: tags.length, rosterInTags: roster, tideBytes: tideText.length, ledgerBytes: ledger.length,
            ledgerOn, divergenceBytes: recallFacts?.divergenceBytes ?? 0, recalledBytes: recallFacts?.bytes ?? 0,
            recall: recallFacts,
        };
        // ★leg90c：读数里**明写位置**——它是这一段能不能真进 prompt 的判据（`IN_PROMPT`=0 → ST 映射成 'end'）。
        // ★★★leg92：**开关开着、但一个字都没注入**（世界没进内存 ⇒ 名册取不到 ⇒ 两段都空）
        //   必须**明说**，否则它和"已关"在界面上长得一样（这正是 leg92 那个真缺陷被藏了这么久的原因）。
        if (!runs.lastChars) {
            lastLine = `标签注入：注意：开关开着，但这一次**一个字都没注入**`
                + `（名册/世界动向都需要世界账；世界还没进内存时取不到）· position=${api.position}`;
            setStatus?.(`注意：${lastLine}`);
            return { ok: true, off: false, tagsChars: 0, worldChars: 0, line: lastLine, runs: { ...runs }, facts: runFacts() };
        }
        // ★★★leg93 修（读数印错名·会误导排查）：这一格原来是 `名册 ${world.length} 字`——
        //   **世界动向那段（`world`）的字数被印成了"名册"**。名册根本不在这里：它在 ① 段里
        //   （`buildInjections` 把 `rosterText()` 并进 `tags`，本仓从 leg89 起就是这个形状）。
        //   ⇒ 照实分开印：① 段的字数 + ③ 段的字数（各叫各的名字）。
        // ★★★leg115：**再加 ④ 段的字数**——而且"没命中"与"取不到那几个字"必须分开印（`ledgerNote` 现成带这三态）。
        lastLine = `标签注入：格式指令 ${tags.length} 字 · 世界动向 ${tideText.length ? `${tideText.length} 字` : '（未开）'}`
            + ` · 账上往事 ${ledgerNote}`
            + `（作为系统提示词排在提示词末尾 · position=${api.position}；插件只注入这几段，不读也不改你的正文）`;
        diagnostics.record('注入', 'info', '上下文已注入', { tagsChars: tags.length, worldChars: tideText.length, ledgerChars: ledger.length, ledgerNote, vectors: vecRows.length });
        return { ok: true, off: false, tagsChars: tags.length, worldChars: tideText.length, ledgerChars: ledger.length, ledgerNote, line: lastLine, runs: { ...runs }, facts: runFacts() };
    }

    // ★★★leg115：**在"玩家把消息发出去"的那一刻再重设一次**——这是第四段能不能拿到"这一轮输入"的关键。
    //   为什么非挂不可（实读 ST 源码定的，不是猜的）：`script.js:5682` 把用户消息 push 进 `chat` **之后**才
    //   发 `MESSAGE_SENT`（`slash-commands.js:4848/4898/4936/4941` 同款）⇒ 那一刻 `ctx.chat` 末尾**就是**
    //   玩家这一句；而本插件原来的重设点只有"世界推完一轮"与"载入世界"——**都在玩家开口之前**，
    //   那时检索用的那几个字里**只有上一轮正文**，这一轮输入根本还没出现。
    //   ★顺带：那一刻 ST 还没组装这一次的 prompt ⇒ 设进去的第四段**当轮就生效**（与另外三段同一时机）。
    //   ★开关关着 ⇒ 这里**什么都不做**（不许因为挂了监听就多跑一遍：那会让"关掉"变得不干净）。
    try {
        const es = getCtx()?.eventSource;
        const sentEvt = getCtx()?.eventTypes?.MESSAGE_SENT ?? getCtx()?.event_types?.MESSAGE_SENT;
        if (es?.on && sentEvt && !es.__sw2LedgerHooked) {
            es.__sw2LedgerHooked = true;
            es.on(sentEvt, () => {
                try {
                    if (isOn('injectLedgerRecall')) { prefetchVectors(); apply(); }
                } catch (_) { /* 失败零阻塞：注入不成绝不许拦住发消息 */ }
            });
        }
    } catch (_) { /* 取不到事件总线 ⇒ 退化成"只有上一轮正文"，另有自证面会如实报 */ }

    // ★leg92：`runs` 也交出去——"跑过没有"是排查第一问（见上面那段注释）。
    // ★★★leg161：`prefetchVectors` 一并交出去——接线层在**消息进来时**调它（后台把查询向量备好），
    //   这样 `apply()` 那一刻是**同步读缓存**（ST 的注入口是同步的，这里不许 await）。
    // ★★★（2026-10-05）：`_facts` 也交出去——参数页那一行读数直接问它（接线层**不必**再存一份，
    //   省下来的行数是硬需求：`web/index.js` 有 `<3100` 行硬锁）。
    return { apply, clear, clearVectors, readApi, prefetchVectors, _vecNote: () => vecNote, _last: () => lastLine, _runs: () => ({ ...runs }), _facts: () => runFacts() };
}
