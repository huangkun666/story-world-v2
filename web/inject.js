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
import { recallLedger, RECALL_MODES, formatRecalled, timeMarkAt } from '../src/ledger-recall.js';
// ★★★leg123：**格名表从引擎那一侧取**（`tag-extract.js` 是真源，零 import 的叶子 ⇒ 浏览器侧安全、不成环）
import { CHANGE_FIELDS, CHANGE_FIELD_KIND } from '../src/tag-extract.js';
// ★★★leg119：卷库那一侧（浏览器 IndexedDB）——取"冷档里的编年行"要用它。
//   ★本模块顶层**零 indexedDB 访问**（`idb-backend.js` 自己就是"惰性 + 守卫"的）⇒ Node 侧 import 它照样安全。
import { createIdbVolumeStore } from './idb-backend.js';

export const INJECT_KEY_TAGS = 'sw2_tags';       // ① 格式指令 + ② 名号对照（合成一条）
export const INJECT_KEY_WORLD = 'sw2_world';     // ③ 世界动向（默认关）
export const INJECT_KEY_LEDGER = 'sw2_ledger';   // ④ ★leg115：**账上往事**（"什么时候发生了什么"，默认开）

/**
 * ★★★leg115：**账上往事那一段的预算**（提案态，可调）。
 * 为什么是这一个数（不是拍脑袋）：
 *   · `maxChars`：★**唯一当家的就是这一个**。硬上限，防的是"账长大了把聊天上下文吃掉"。
 *     排名（轮次新的在前，见 `ledger-recall.js`）决定**这 1600 字里装的是哪几条**——
 *     所以它装下的正是"离这一轮最近的那些往事"，不是随手切一段。
 *   ★**没有条数上限**（本仓血证：`entityUpdates ≤3` 那个没量过的提案态数字当家、还静默拦，
 *     2026-09-22 用户拍板直接撤）⇒ 2026-09-23 把调用里那个 `limit: turns * 6` 也一并撤了：
 *     它是个**估出来的**数字（8×6=48），而 `maxChars` 已经决定了条数 ⇒ 留着只会是第二个没量过的闸。
 *   ★★★本次（清死码）：那个已经没人读的 `turns: 8` **字段也删了**——leg116 撤掉它唯一消费者
 *     （上面那个 `limit`）时把字段留在了表里。实测本模块**零读者**：`:497` 只传 `.maxChars`，
 *     而 `sw2RecallQueryText(ctx, cap)` 的第二参是**字符数**（那个 cap 与"轮数"不是一回事，
 *     见下面 leg115④ 那条判据）⇒ 留着只会让下一任以为"轮数还管着什么"。
 */
export const LEDGER_RECALL_DEFAULT = Object.freeze({ maxChars: 1600 });

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
let volumeCache = [];            // 当前聊天的卷（含 `rows`）
let volumeCacheChatId = null;    // 这份缓存属于哪个聊天（**切聊天要整个作废**）
let volumeRefreshing = false;

/** 接线层注入"现在是哪个聊天"的取数口（`createInjector` 调一次；见 `deps` 注）。 */
function bindVolumeSource(getCtx) {
    volumeCtxGetter = typeof getCtx === 'function' ? getCtx : null;
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
    return volumeCache;
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
 *   ★配一段**降级**：模型忘了包块时，插件退回逐行扫（老行为）——**不会整轮零标签**。
 */
export function tagSpecText() {
    // ★★★leg123（细案 `docs/spec-tag-granularity.md` §2.1/§2.2）：**格名表不另立一份**——
    //   直接从 `src/tag-extract.js` 的 `CHANGE_FIELDS`（真源）按类别分出来。
    //   口径一句话：**聊天模型看到的名单 = 引擎校验用的名单 = 实体账上真有的格**（一把尺子）。
    const roleFields = CHANGE_FIELDS.filter((f) => CHANGE_FIELD_KIND[f] === 'character').join('／');
    const factionFields = CHANGE_FIELDS.filter((f) => CHANGE_FIELD_KIND[f] === 'faction').join('／');
    return [
        '【本回合必须用标签标出"已经发生的事"】',
        '★这是本回合的**硬要求**，不是风格建议：正文照常写，但**真动了手的人、真被改动的格、真许下的事**都要在末尾那个块里各写一行。',
        '漏了标签，插件这一轮就收不到（这一轮白跑）——所以**先保证标签，再谈文风**。',
        '',
        `★★把所有标签**集中放在正文最末尾的一个 ${FENCE}tags 块里**（前后各一行 ${FENCE} 围栏，照下面那样写）。`,
        '**只有这个块里面的标签插件才看**；块外面写了也不作数（所以正文里怎么引用、怎么打比方都不会被误读）。',
        '',
        `${FENCE}tags`,
        '【此刻】复苏历三年 三月初七 卯时',
        '【时长】半柱香',
        '【场景：忘川渡口】',
        '【行动】薛铁衣｜迎战｜黄坤',
        '【变化】黄坤｜实力｜踏入元婴',
        '【承诺】黄坤｜护送白小娥回江州｜白小娥',
        FENCE,
        '',
        '规则：',
        `1. **一个 ${FENCE}tags 块**，放在正文**最末尾**；开围栏那一行**只有** ${FENCE}tags 这几个字符，别的一律不写。`,
        '2. **一个标签占一整行**——行首不许有别的东西（不缩进、不加「-」或「*」或「1.」），行尾也不许再跟别的标签。',
        '3. 【此刻】＝**现在是什么时候**——一个**时间点**（如「复苏历三年 三月初七 卯时」）。★**不用算、不用跟上一轮对账**；写不出时间点就**别写这一行**（空着就是空着）。',
        '4. 【时长】＝**从这里起又过了多久**（三日后／当夜／一炷香／半晌）。★它与【此刻】**是两回事**（一个答"现在何时"、一个答"过了多久"）：只会说相对时间时，**只写【时长】、【此刻】留空**。',
        '5. 【场景：X】＝**这一场戏在哪儿**（X 用下面【本世界的名号】里列出的**地名**）。换了地方就再写一条。',
        '6. 【行动】一行一条，中间用**全角竖线｜**分开，依次是：**谁做的｜做了什么｜针对谁**。只写**真的动了手**的人；第一格必须有，后两格知道就写、不知道就不写——**不要为了凑格式编一个名字**。',
        `7. 【变化】谁｜哪一格｜变成什么——谁的哪个属性**被改成了什么**。★第二格**只能用这几个名**：**角色**＝${roleFields}；**势力**＝${factionFields}。第三格**照抄戏里的说法**（写「踏入元婴」，**不要**换算成数字、等级分或战力值）。`,
        '8. 【承诺】谁｜许了什么｜对谁——答应的事、欠下的债、结下的交情或仇（**不是动手，但确实发生了**）；对象不知道就不写第三格。',
        '9. 只标**真的发生了**的：只是在场、只是被提到、只是说话，都不算；★**比喻和夸张不算**（"打得天崩地裂"不是变化）。',
        '10. **主角（你正在扮演的那位玩家）的行动照样标**——插件只是记下来，**不会替他做决定**。',
        '11. ★**写完之后自己数一遍**：这一轮有几个人真的动了手？谁的哪一格被改成了什么？谁许下了什么？**漏一条就等于这一轮少记一件事。**',
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

/**
 * ★★★leg136（用户令「**让第四段真起作用**」· 曲线在交接 leg136 §2.2）：**把别的插件的机器块剥掉**。
 *
 * ＝＝ 病（真账逐轮实测，不是设想）＝＝
 *   本函数原来直接取"上一轮正文的尾巴 400 字"。而在真机上，**那条正文的尾巴根本不是正文**——
 *   它是别的扩展塞进来的机器块（真账最后一条实测）：
 *     `<UpdateVariable><JSONPatch>[{ "op": "replace", "path": "/天道娘面板/激活状态", "value": "双修" }, …`
 *   ⇒ 拿这段 JSON 去点"账上真名"，**一个都点不出来** ⇒ 第四段「账上往事」**空手而归**。
 *   ★逐轮模拟 190 轮实测：**空手 67 轮（35.3%）**；把机器块剥掉之后 ⇒ **空手 25 轮（13.2%）**，
 *     有货轮次平均从 1038 字涨到 2105 字。**一个改动，不动任何闸。**
 *
 * ＝＝ 口径（为什么是"成对块"这一条，而不是一张标签名清单）＝＝
 *   ★本仓明禁"**用词表判语义**"（`ANCHOR.md` §4.8：换一本书/换一个扩展，词表就废）。
 *   ⇒ 用**结构**判：**同名开标签与闭标签成对**的那一段，就是别的扩展的信封；正文不在里面。
 *   实测核对过这条口径**不会吃掉正文**（真账最后一条）：正文包在**不成对的** `<content>` 开标签后面，
 *   而剥掉的是 5 个成对块（`xzx_qyh` / `current_event` / `progress` / `konatan_chat` / `UpdateVariable`），
 *   8225 字 → 3478 字，**尾部剩下的是干净的正文**。
 *
 * ＝＝ 两条边界（写死免得下一任改歪）＝＝
 *   ① ★**不剥代码块**（三反引号那种）：模型写出来的 ```tags 块**本身就是最好的查询串**
 *      （里面全是"谁做了什么"与账上真名）——剥了它等于把最有用的那几个字扔掉。
 *   ② ★**剥完是空的就退回原文**：万一某张卡把正文整个包在成对块里（换一个扩展就可能），
 *      剥完就没有字了 ⇒ 那时退回原文 = **退化成今天的行为**，不会比今天更坏。
 *
 * @param {string} text 一条正文
 * @returns {string} 剥掉机器块之后的正文（剥空了 ⇒ 原样返回）
 */
export function proseOnly(text) {
    const s = String(text ?? '');
    if (!s) return '';
    // 同名开/闭成对（反向引用 `\1` 保证是同一个标签名；`[\s\S]*?` 非贪婪 ⇒ 不会跨块吃太多）
    const stripped = s.replace(/<([A-Za-z][\w:.-]*)\b[^>]*>[\s\S]*?<\/\1\s*>/g, ' ');
    return stripped.trim() ? stripped : s;
}

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
 * @returns {string} 形如「<原文尾巴> <剥后正文尾巴> <玩家这一轮打的>」（有重复时自动去重一截）
 */
export function sw2RecallQueryText(ctx, cap = 400) {
    const chat = ctx?.chat;
    if (!Array.isArray(chat) || !chat.length) return '';
    const textOf = (m) => (typeof m?.mes === 'string' ? m.mes : '');
    const last = chat[chat.length - 1];
    const lastIsUser = last?.is_user === true;
    const currentUser = lastIsUser ? textOf(last).trim() : '';
    let prevRaw = '';
    for (let i = chat.length - (lastIsUser ? 2 : 1); i >= 0; i -= 1) {
        if (chat[i]?.is_user === true) continue;        // 跳过更早的玩家发言，只要**上一轮正文**
        const t = textOf(chat[i]).trim();
        if (t) { prevRaw = t; break; }
    }
    const n = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 400;
    const tail = (s) => (s.length > n ? s.slice(-n) : s);
    const prose = proseOnly(prevRaw).trim();
    // ★两截都要，但**一模一样时只留一截**（没机器块的正文 ⇒ 两截是同一份，重复没有意义）
    const parts = [];
    if (prevRaw) parts.push(tail(prevRaw));
    if (prose && prose !== prevRaw) parts.push(tail(prose));
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
    const tags = [
        spec ? tagSpecText() : '',
        roster ? rosterText(world) : '',
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
export function createInjector({ getCtx, getWorld, isOn = () => false, setStatus = () => {} } = {}) {
    if (typeof getCtx !== 'function' || typeof getWorld !== 'function') {
        throw new TypeError('createInjector：`getCtx` 与 `getWorld` 必须是函数（注入的是函数不是值）');
    }
    // ★★★leg119：卷缓存也要知道"现在是哪个聊天"——复用同一个 `getCtx`（**不新增依赖形参**，
    //   见本模块上面那一族注释：`web/index.js` 只剩 1 行余量，加不了新接线）。
    bindVolumeSource(getCtx);
    let warned = false;
    let lastLine = null;
    // ★★★leg92：**跑过的证据**（用户报"开关是 1、字典里却没有"时，这一格能一眼分开"没跑"与"跑了失败"）。
    //   记的是**事实**：调用了几次、最后一次什么结果、什么时候。
    const runs = { count: 0, lastOk: null, lastOff: null, lastChars: 0, lastAt: null };

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
     * 按当前设置与世界**重设**注入。返回自证读数（面板/控制台都读它）：
     * `{ ok, off, tagsChars, worldChars, line }`。★`off` = 玩家把开关关了（**不是失败**，别报成失败）。
     */
    function apply() {
        const spec = Boolean(isOn('injectTagSpec'));
        const roster = Boolean(isOn('injectRoster'));
        const tide = Boolean(isOn('injectWorldTide'));
        const ledgerOn = Boolean(isOn('injectLedgerRecall'));
        const stamp = () => {
            runs.count += 1;
            runs.lastAt = (() => { try { return new Date().toISOString(); } catch (_) { return null; } })();
        };
        if (!spec && !roster && !tide && !ledgerOn) {
            clear();
            lastLine = '标签注入：已关（插件不看也不动你的对话）';
            stamp(); runs.lastOk = true; runs.lastOff = true; runs.lastChars = 0;
            return { ok: true, off: true, tagsChars: 0, worldChars: 0, line: lastLine, runs: { ...runs } };
        }
        const api = readApi();
        if (!api) {
            // ★如实降级：注入口取不到就别假装注入成功（也只吵一次，别每轮刷屏）
            lastLine = '标签注入：这个 ST 版本没有"往上下文里塞东西"的接口——已跳过（世界照常推进）';
            if (!warned) { warned = true; setStatus?.(`⚠ ${lastLine}`); }
            stamp(); runs.lastOk = false; runs.lastOff = false; runs.lastChars = 0;
            return { ok: false, off: false, tagsChars: 0, worldChars: 0, line: lastLine, runs: { ...runs } };
        }
        // ④ ★leg115 **账上往事**：拿"上一轮正文＋这一轮输入"去账上取（**当轮交付**）。
        //   ★查询那几个字**本模块自己从 `getCtx()` 现取**（`sw2RecallQueryText`）——**不新增依赖形参**，
        //     也就**不用动 `web/index.js`**（它只剩 1 行余量，动不了）。
        //   ★纪律照 `recall.js`：**失败零阻塞**——取不到就空串，世界照常推进、另外三段照常注入。
        const world = getWorld();
        let ledger = '';
        let ledgerNote = '（这段没开）';
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
            try { q = sw2RecallQueryText(getCtx()); } catch (_) { q = ''; }
            if (!q) recallNote = '⚠ 取不到"上一轮正文＋这一轮输入" ⇒ 这一轮没取';
            else {
                // ★★主锚 = **账上真名**（真账实测：上一轮正文里每次都有 11–13 个账上真名，照名取命中 133–224 行）；
                //   字面关键词**并用**当兜底（它单独用会栽：玩家正文与账本用词本来就不同，实测命中 0 条）。
                // ★★★leg119：**卷要一起看**——轮转把最旧的编年整段搬进卷之后，不接这一格就会**悄悄少一半**
                //   （见本模块上面那一族注释；世界模型那一侧走 `pack.js` 的**同一个** `volumes` 参数）。
                //   ★leg146b：`vols` 已提到上面取（分歧那一段的时间印记也要用它）。
                const got = recallLedger(world, { modes: [RECALL_MODES.BY_NAMES, RECALL_MODES.BY_KEYWORD], text: q, maxChars: LEDGER_RECALL_DEFAULT.maxChars, volumes: vols });
                recalled = got.ok ? formatRecalled(world, got.items, { volumes: vols }) : '';
                recallNote = got.ok ? `${recalled.length} 字` : `没命中（${got.reason}）`;
            }
            // ★**没分歧、也没取到往事 ⇒ 空串**：与接线之前**逐字节相同**（零扰动，判据 D1 锁着）。
            ledger = [div, recalled].filter(Boolean).join('\n\n');
            ledgerNote = `${ledger.length} 字（跟书不一样 ${div.length} 字 · 往事 ${recalled.length ? `${recalled.length} 字` : recallNote}）`;
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
            setStatus?.(`⚠ ${lastLine}`);
            stamp(); runs.lastOk = false; runs.lastOff = false; runs.lastChars = 0;
            return { ok: false, off: false, tagsChars: 0, worldChars: 0, line: lastLine, runs: { ...runs } };
        }
        warned = false;
        stamp(); runs.lastOk = true; runs.lastOff = false; runs.lastChars = tags.length + tideText.length + ledger.length;
        // ★leg90c：读数里**明写位置**——它是这一段能不能真进 prompt 的判据（`IN_PROMPT`=0 → ST 映射成 'end'）。
        // ★★★leg92：**开关开着、但一个字都没注入**（世界没进内存 ⇒ 名册取不到 ⇒ 两段都空）
        //   必须**明说**，否则它和"已关"在界面上长得一样（这正是 leg92 那个真缺陷被藏了这么久的原因）。
        if (!runs.lastChars) {
            lastLine = `标签注入：⚠ 开关开着，但这一次**一个字都没注入**`
                + `（名册/世界动向都需要世界账；世界还没进内存时取不到）· position=${api.position}`;
            setStatus?.(`⚠ ${lastLine}`);
            return { ok: true, off: false, tagsChars: 0, worldChars: 0, line: lastLine, runs: { ...runs } };
        }
        // ★★★leg93 修（读数印错名·会误导排查）：这一格原来是 `名册 ${world.length} 字`——
        //   **世界动向那段（`world`）的字数被印成了"名册"**。名册根本不在这里：它在 ① 段里
        //   （`buildInjections` 把 `rosterText()` 并进 `tags`，本仓从 leg89 起就是这个形状）。
        //   ⇒ 照实分开印：① 段的字数 + ③ 段的字数（各叫各的名字）。
        // ★★★leg115：**再加 ④ 段的字数**——而且"没命中"与"取不到那几个字"必须分开印（`ledgerNote` 现成带这三态）。
        lastLine = `标签注入：格式指令 ${tags.length} 字 · 世界动向 ${tideText.length ? `${tideText.length} 字` : '（未开）'}`
            + ` · 账上往事 ${ledgerNote}`
            + `（作为系统提示词排在提示词末尾 · position=${api.position}；插件只注入这几段，不读也不改你的正文）`;
        return { ok: true, off: false, tagsChars: tags.length, worldChars: tideText.length, ledgerChars: ledger.length, ledgerNote, line: lastLine, runs: { ...runs } };
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
                try { if (isOn('injectLedgerRecall')) apply(); } catch (_) { /* 失败零阻塞：注入不成绝不许拦住发消息 */ }
            });
        }
    } catch (_) { /* 取不到事件总线 ⇒ 退化成"只有上一轮正文"，另有自证面会如实报 */ }

    // ★leg92：`runs` 也交出去——"跑过没有"是排查第一问（见上面那段注释）。
    return { apply, clear, readApi, _last: () => lastLine, _runs: () => ({ ...runs }) };
}
