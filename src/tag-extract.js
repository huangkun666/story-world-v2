// story-world-v2/src/tag-extract.js
// ★标签提取（S3 新口径，设计见 `docs/spec-tagged-actions-extraction.md`）：
//   聊天模型产出的**正文** → 结构化的"本轮已经发生过的事"。
//
// ============================ 为什么是它、不是老口径 ============================
// 老口径（一张 13 条正则的**动词词表**：读"玩家自己打的那句话"，硬猜这一句是什么动作）
//   **已按用户令整族拆掉**（2026-10-05：「这个词表按道理说早应该拆了…这个功能要猜，
//   没标签就不进正文的行动即可」）。它当年在本仓有三个病（源码可证，留档免得有人把它请回来）：
//   ① **表外的动作不存在**——"我拔剑冲上去"扫完 13 条一条都不中 ⇒ 动词空 ⇒ 那条事实丢掉；
//   ② 它还得**归成一类**（"拔剑冲阵"被写成"迎战"），信息在这里降级一次；
//   ③ ★更要紧的：**它读的输入从根上就不成立**——那张表是给"玩家自己打的那句话"设计的，
//      而生产上喂进去的是**模型写的整段正文** ⇒ 正文里随便谁"问道""离开"都会被算成玩家这一轮的动作。
// 新口径把结构交给**标签**：模型写正文时就把"谁做了什么、在哪、过了多久"标出来，插件只管切。
//   ⇒ ★因此本模块**没有词表、不归一动词**（"动词不在表里"这个问题在这里不存在）。
//
// ============================ 契约 ============================
//   1. **只抽已经发生的行动**（旁白不标、在场不标、说话不标——那是模型的活，不是插件的猜测）；
//   2. **主语必须对得上账上的名号**（名 / 别名三档归一）——对不上的**不进包、不新建实体**，
//      只进 `unresolved` 如实报数（★标签直接造人会绕过 `check-step.js` 的全部入局闸门）；
//   3. **地点由最近的 `【场景：…】` 继承**（正文里位置几乎只以"这里"出现，没有兜底格就只能空着）；
//   4. ★**主角那一条走 `playerMove`，绝不进 actions**——玩家进世界步的 `actions[]`
//      会让 `check-step.js` 拒**整步**（红线 1：不许替玩家走）。**记下来可以，替它决定不行。**
//   5. **时长只当上下文，不做算术**（"三天"与"一炷香"在插件看来都是串字；断言"三天=72小时"就是编数）；
//   6. **形状不合的行**进 `malformed`、**被截断的条数**进 `parsed/count` 的差——丢了什么必须能被看见。
// 纯函数：零 DOM、零传输（★Task 3 复查起 import 共用的**身份解析器** `entity-identity.js`——见 `makeResolver`），
//   Node 可测。
// 分层归属：引擎规则侧（S3）。
import { normEntityName, resolveEntityIdentityWithCanon } from './entity-identity.js';

/** 行动标签一行的切格符：★**全角**竖线（半角 `|` 是 Markdown 表格与代码块里最常见的字符，认它必然误切）。 */
export const TAG_FIELD_SEP = '｜';

// 四族正则。★为什么都写成"行尾即止"（`[^\n【]+`）：模型偶尔会把下一个标签写在同一行，
//   `[^\n【]+` 让它在下一个 `【` 前停住，不至于把两行吃成一格。
const RE_ELAPSED = /【时长】\s*([^\n【]+)/g;
// ★冒号全角半角都收（`：`/`:`）——模型两个都会写；场景是行内闭合的（`【场景：X】`）。
const RE_SCENE = /【场景\s*[:：]?\s*([^】\n]*)】/g;
const RE_ACTION = /【行动】\s*([^\n【]+)/g;
// ★★★leg123（细案 `docs/spec-tag-granularity.md`）：**三族新标签**。★**块口径与老族一条不改**
//   （只认 ` ```tags ` 块里的；★leg199 起**块不在 ⇒ 零收获**，那条"退回逐行扫"的降级已整支撤掉——
//    见 `shellRange` 与 `extractTags` 里那段留档）。
//   · `【此刻】`＝**现在是什么时候**（一个**时间点**）——不是"过了多久"（那是 `【时长】`）。
//     ⇒ 两格**分开记**：本族 → `at`（落事件/编年的 `timeMark`）、`【时长】` → `elapsed`（leg115 老通路）。
//   · `【变化】`＝谁｜哪一格｜变成什么——**格名对齐实体账**（见下面 `CHANGE_FIELDS`），值照抄不换算。
//   · `【承诺】`＝谁｜许了什么｜对谁——不是动手，但确实发生了（"让世界记住我的事"那一格）。
const RE_AT = /【此刻】\s*([^\n【]+)/g;
const RE_CHANGE = /【变化】\s*([^\n【]+)/g;
const RE_PROMISE = /【承诺】\s*([^\n【]+)/g;

/** ★★格名表（**真源**）：`【变化】`第二格只许用这些名。
 *  ★为什么是这几个：它们是**实体账上真有的文本格**（`src/schemas/ssot.schema.js:350-369`），
 *    并按类别分（`sanitizeBookFields` 的白名单：**角色收前四项、势力收后三项**）。
 *  ⇒ 聊天模型看到的就是这一份名单（规范 v2 里那两行），**抄的是同一把尺子**，不另立第二份。 */
export const CHANGE_FIELDS = ['所属', '身份', '定位', '实力', '性质', '倾向', '规模'];
/** 格 → 归属类别（角色的格写到势力身上 = 形状不合 ⇒ 丢 + 留痕）。 */
export const CHANGE_FIELD_KIND = {
    所属: 'character', 身份: 'character', 定位: 'character', 实力: 'character',
    性质: 'faction', 倾向: 'faction', 规模: 'faction',
};
/** ★驻点也允许由戏来改（细案 §5 第 6 条），但它要**过地名归一**——不在地名表里就丢 + 留痕。 */
export const CHANGE_PLACE_FIELD = 'location';

/** 形近字归一：去空白 + 全角/半角不敏感（NFKC）+ 小写。★Task 3 复查起**共用** `entity-identity.js` 那一把尺。*/
function normName(v) {
    return normEntityName(v);
}

/** 地点归一：只去空白与原样（★**不做 NFKC**——地名要写回账上，改了字就改了地名）。 */
function normPlace(v) {
    return String(v ?? '').trim();
}

/**
 * 名号 → 实体（**唯一一把尺子**：`entity-identity.js` 的 `resolveEntityIdentityWithCanon`）。
 * ★为什么连 id 也认：模型偶尔会把 id 照抄进标签（名册里两样都给了它），认下来比丢掉好。
 * ★★优先级写死（leg89 用户拍板「模型认得出那就直接按照插件的正名来看」）：
 *   **账上正名 → 别名（实体别名 ∪ 名册兜底别名，并集后判唯一）**。为什么正名必须在别名之前：
 *   别名可能跟别人的正名撞车（书里既有「小娥」这条、又是「白小娥」的别名）⇒ 先收正名，
 *   别名再收时才不会把真名盖掉。
 * ★★★Task 3 复查（task-3-review.md ⑥）：**同档内"唯一命中"才算数**——旧实现是一张
 *   `byKey` 的"先到先得"表（`if (byKey.has(k)) return;`），于是两个实体共享同一个别名（都叫 `大人`）时
 *   第一个登记的人赢。现在：命中**集合**里有多个不同 id ⇒ 返回 null（未定，调用方如实进 `unresolved`）。
 * ★★★Task 3 复查第二轮（task-3-fixes-review.md ④）：别名档**先并集再判唯一**——旧法实体别名先命中
 *   就直接返回，名册兜底别名（另一个实体）根本没机会参与唯一性判定 ⇒ 跨来源同名时选错了人。
 *   并集与判定都住在 `entity-identity.js`（一处实现，四个消费者共用）。
 * @param entities 账上实体（`[{id,name,aliases}]`）——★Task 3 起**别名也住在账上**（`seedBookEntities` 写入）
 * @param canon    书名录（`[{name,aliases}]`，来自 `context.setting.frozen.canon.bookEntities`）
 *                 ——旧账/历史世界的兼容兜底：`entities[].aliases` 缺失时仍按名册里的别名解析
 */
function makeResolver(entities = [], canon = []) {
    const live = (Array.isArray(entities) ? entities : []).filter((e) => e?.id);
    const idHits = new Map();                                 // ① id 原样照抄（标签这一层的既有约定）
    for (const e of live) {
        const k = normName(e.id);
        if (!k) continue;
        const bucket = idHits.get(k) || [];
        if (!bucket.includes(e.id)) bucket.push(e.id);
        idHits.set(k, bucket);
    }
    return (raw) => {
        const k = normName(raw);
        if (!k) return null;
        const ids = idHits.get(k);
        if (ids) return ids.length === 1 ? ids[0] : null;      // 同一个 id 抄到多个实体上 ⇒ 未定（不猜）
        const r = resolveEntityIdentityWithCanon(live, canon, raw);
        return r.status === 'ok' ? r.id : null;                // ② 正名唯一 → 它；③ 别名档并集后唯一才算
    };
}

/** 标签块的开围栏（**围栏行只有它自己**才算——围栏后面跟别的不算）。 */
const RE_FENCE_OPEN = /^```\s*tags\s*$/;
/** 闭围栏：三个反引号或三个波浪号，同样要求整行只有它。 */
const RE_FENCE_CLOSE = /^(?:```|~~~)\s*$/;
// ★★★leg199：**"还原之后"那一档的开围栏**（只给 `extractTags` 的第二级尝试用，见 `shellRange` 的 `loose`）。
//   病（本笔实测，装置 `F:/deepseek/tmp/leg198-audit/dbg3.mjs`）：模型把整块标签塞进 JSON 字符串时，
//   还原真换行之后**第一行是 `{"tags":"```tags`**——围栏前面还挂着 JSON 的开头那几个字符。
//   而 `RE_FENCE_OPEN` 那条"整行只有它"（leg93 定的，**不许放宽**）当场不认 ⇒ 还原这一级**白救**
//   （leg137 那条静默失效会原样复发）。★为什么可以在这里松一档：这一档**只对"已经确认是 JSON 转义"
//   的文本**开门（`RE_ESCAPED_FENCE_CLOSE` 那道门槛先过了），而那一档里的围栏前缀**必然是信封**、不是正文。
const RE_FENCE_OPEN_LOOSE = /```\s*tags\s*$/;

/**
 * ★★★leg93（用户裁示「**就甲吧**」）：**标签块口径**——正文里所有标签必须包在一个围栏块里，
 *   **提取器只扫这个块里面**。这一节回答的是用户那一问：
 *   「**正文里有【…】呢？不能包裹在一个标签里吗？**」。
 *
 *   病（逐字喂真提取器实测，装置 `F:/deepseek/tmp/leg93-brackets-in-prose.mjs`）：
 *     正文里只要有一句**以 `【行动】` 开头**的叙述（解说格式、举例子、被引用），它就**被当成一条真行动**；
 *     以 `【时长】` 开头的叙述更糟——`elapsed` 直接**收下一整句话**（实测「这个词表示时间流逝。」），
 *     而**引擎一个字都不校验这个值**，它原样进世界模型的 prompt。
 *   ⇒ 根因：认不认得出标签**全看 `【` 在不在行首**——正文与标签**共用同一个语法空间**，中间没有边界。
 *
 *   修法：给标签一个**专属边界**（围栏块）。块外的 `【】` 再怎么写都落在扫描范围之外。
 *   ★★★leg199（用户令「**删掉降级吧**」）：**"块不在 ⇒ 退回逐行扫"那条降级铁律已整支撤掉。**
 *     它当年立的理由（"模型漏写围栏时，整轮零标签比少认几条严重"）**被实测证伪**：
 *     块不在时逐行扫全篇 ⇒ 正文里任何一行 `【行动】…`（引用字条/告示/解说格式）都成真行动，
 *     写到玩家名上就**变成玩家的落子递给世界模型**（实跑见下面 `extractTags` 里那段留档）。
 *     ⇒ 现在：**没有块 = 零收获**（与注入规范那句"块外写了也不作数"从此一致）。
 *     代价（用户已知情）：漏写块的那一轮整轮零收获；leg93 之前的老聊天不再进账。
 *
 * @param {string} text 一条正文
 * @param {{loose?: boolean}} [opts] `loose` = **只给"还原过字面 `\n`"那一档用**（见 `RE_FENCE_OPEN_LOOSE`）
 * @returns {{start:number,end:number,closed:boolean}|null} 行号区间（**不含围栏行本身**）；没命中 ⇒ null
 */
export function shellRange(text, { loose = false } = {}) {
    const reOpen = loose ? RE_FENCE_OPEN_LOOSE : RE_FENCE_OPEN;
    const lines = String(text ?? '').split(/\r?\n/);
    const open = lines.findIndex((l) => reOpen.test(String(l).trim()));
    if (open < 0) return null;
    // 闭围栏从开围栏**下一行**往回找（`closed` 如实标出"模型忘收尾"那种）；
    //   没闭合 ⇒ 吃到正文末尾——截断/漏收尾时标签仍然要能读出来。
    for (let i = open + 1; i < lines.length; i += 1) {
        if (RE_FENCE_CLOSE.test(String(lines[i]).trim())) return { start: open + 1, end: i, closed: true };
    }
    return { start: open + 1, end: lines.length, closed: false };
}

/** 字面的两个字符 `\` `n`——模型把标签块塞进 JSON 字符串时，真换行会变成它（见 `extractTags` 顶注）。 */
const LITERAL_NL = '\\n';
/** 还原尝试的门槛②：**标签块的开围栏本身也是被转义的**（`\`\`\`tags` 前面紧跟一个**字面** `\n`）。
 *  ★为什么是这一条（**本笔实测纠正过两次，两次都留档**）：
 *    第一版门槛②写成"标签名出现在行首（字面 `\n` 之后也算）"⇒ **当场咬到正常正文**：
 *    `'正文解说：…\n【行动】谁｜做了什么\n就长这样。'`（正文在解说格式、句尾又提到字面 `\n`
 *    这个写法）被还原后读出一条**假行动**（实测 parsed=1，本应是 0）。
 *    根因：**字面 `\n` 在"正文提到它"时是内容，在"JSON 转义"时是结构**，光看标签名分不开。
 *    第二版想用"还原之后真能找出围栏块"（`shellRange`）——**也不成立**：真模型那种写法里，
 *    开围栏那一行是 `{"tags":"```tags`（**围栏不是整行只有它**），闭围栏那行尾巴还挂着 `"}`，
 *    ⇒ `shellRange` 在还原后照样返回 null（它那条"整行只有它"的判据是 leg93 定的，不许为这里放宽）。
 *    ★**定稿这一条分得开**：**闭围栏自己也是被转义的**——它在字面 `\n` 之后（`…\n```"}` 那种）。
 *    而正文里提到 `\n` 时，后面跟的是散文或标签名，**不会正好跟一个闭围栏**。
 *    ⚠本笔在这个门槛上**连错三版**（全留档，别重踩）：①只看"标签名在行首"⇒ 咬到正常正文（假行动）；
 *    ②看"还原后 `shellRange` 找得到围栏"⇒ **永不成立**（真模型那种写法里开围栏跟 `{"tags":"` 同处
 *    一行、闭围栏尾巴挂着 `"}`，`shellRange` 那条"整行只有它"的判据在还原后照样不满足）；
 *    ③锚**开**围栏⇒ **也永不成立**（JSON 那种形状里开围栏前面是 `"`、不是 `\n`，而"`\n` ＋ 开围栏"
 *    这个组合在转义文本里根本不存在）⇒ 必须锚**闭**围栏。★三次都是**先跑再看**才发现的。
 *  ★**只认有围栏的那种**：围栏不在 ⇒ 就算还原了也没有边界，认出来的东西会落在块外
 *    （leg93 甲案那条"块外一律当正文"）⇒ 那种情况**不救**，照旧零收获（＝今天的行为）。
 *    ★这条是**有意的取舍**：宁可少救一类（漏写围栏的 JSON 转义），不可改动读得出来的轮次。 */
const RE_ESCAPED_FENCE_CLOSE = /\\n[ \t]*(?:```|~~~)/;

/**
 * ★标签提取（纯函数）。
 *
 * @param {string} text 聊天模型这一轮产出的正文
 * @param {object} ctx  `{ entities, canon, locations, playerId, maxActions }`
 *   - `entities`  账上名册（`[{id,name,aliases}]`）——主语/对象归一的唯一依据
 *   - `canon`     ★书名录（`[{name,aliases}]`，`context.setting.frozen.canon.bookEntities`）
 *                 ——**别名只住在这里**；不传 ⇒ 只认账上的名号（旧行为，逐字节不变）
 *   - `locations` 参照表（`['未明','忘川',…]` 或 `[{name,aliases}]`）——场景归一用；空表 ⇒ 原样留文本
 *   - `playerId`  玩家棋子 id（★**不传 = 没有主角槽**，主角那条会被当成普通 NPC 收进 actions）
 *   - `maxActions` 入包封顶（★防炸包；被截断的条数如实报在 `parsed - count`）
 * @returns {{
 *   actions: Array, elapsed: string, elapsedParts: string[], count: number, parsed: number,
 *   unresolved: Array, player: object|null, playerDropped: number, malformed: string[],
 *   locations: string[],
 *   shell: {found: boolean, closed: boolean|null},   // ★leg199：`mode` 已撤（'all' 那一支整支删掉）
 *   restored: boolean,   ★leg137：这一遍是不是"把字面 `\n` 还原成真换行之后"的结果
 * }}
 */
/**
 * ★★★leg199：**"这一轮没有标签块"那一份空结果**——与"跑完一遍什么都没抽到"**同形**（一处定义）。
 *   为什么要它（而不是让调用方各自拼一个空对象）：`hasTagFacts` / `tagReadoutLine` / 包那一栏
 *   全按这个形状读 ⇒ 两处各拼一份就是本仓最忌的"同一件事两处表达"，迟早分叉。
 *   ★`shell.found:false` 是**唯一的区别**：它如实说"连块都没有"，好让面板把原因说出来。
 *   @returns {object} 与 `extractTags` 正常返回同形的空结果
 */
function emptyResult() {
    return {
        protocol: null, events: [], eventsBad: [], actedIds: [],
        actions: [], elapsed: '', elapsedParts: [], at: null,
        changes: [], changesBad: [], promises: [], promisesBad: [],
        count: 0, parsed: 0, unresolved: [], notNoted: [],
        player: null, playerDropped: 0, malformed: [], locations: [],
        shell: { found: false, closed: null },
        restored: false,
    };
}

export function extractTags(text, ctx = {}) {
    const src = String(text ?? '');
    const { entities = [], canon = [], locations = [], playerId = null, maxActions = 12 } = ctx;
    const resolveEntity = makeResolver(entities, canon);
    // 地点表：字符串或 {name,aliases} 两种形状都收（`web/index.js` 的 `derivePositions` 给的是字符串数组）
    const placeRows = (locations || []).map((l) => (typeof l === 'string' ? { name: l, aliases: [] } : (l || {})));
    const resolvePlace = (raw) => {
        const k = normName(raw);
        if (!k) return null;
        for (const p of placeRows) {
            if (normName(p.name) === k) return normPlace(p.name);
            for (const a of p.aliases || []) if (normName(a) === k) return normPlace(p.name);
        }
        return null;
    };

    // ★★★leg137：**两级尝试**（治"标签块被包进 JSON 字符串 ⇒ 一个字都读不到"那条静默失效）。
    //   病（leg136 §4.2 真模型实测）：模型把整块标签塞进一个 JSON 字符串 ⇒ 换行成了**字面的
    //   两个字符 `\` `n`**，而本模块是**按真换行切行**的 ⇒ 围栏与每一行标签都不在行首，
    //   **一条都读不出来，而且一个字都不出声**（`malformed`/`unresolved` 全空，界面上看不出
    //   "这一轮其实有标签"）。真账实测：原样 **0 条** / 把字面 `\n` 还原成真换行 **3 条**。
    //   治法：**先按原样跑一遍**（今天的行为逐字节不变）；**只在"一条都没读到"时**才把字面
    //   `\n` 还原成真换行再跑一遍；**两级都读不到 ⇒ 才算这一轮没有标签**。
    //   ★**为什么不能无条件还原**：正常正文里也可能出现字面 `\n`（比如正文在讲代码）⇒
    //   无条件还原会**改掉今天正常的解析**（本仓"改判据 = 改承重墙"）。
    //   ★**两道门槛都必须有**（缺一个就会咬到正常正文）：
    //     ① 文本里**真出现**字面 `\n`；② ★★**字面 `\n` 紧跟一个标签块开围栏**（` ```tags `）。
    //     门槛②为什么是这一条、以及它前面两版为什么都不成立（**本笔实测纠正过两次**）⇒
    //     逐条写在下面 `RE_LITERAL_NL_FENCE` 那个常量的注释里，**同一件事只许有一处**，这里不重抄。
    //   ★**门只开给"零收获"**：`hasTagFacts(pass1) === false` 是**最严的一档**——
    //     连一条"归不上名字""形状不合"都没有才试。宁可少救，不可改动读得出来的轮次。
    const parse = (text0, { loose = false } = {}) => {
    const elapsedParts = [];
    const malformed = [];
    const unresolved = new Map();          // 名字 → 条数（同一名字只报一次）
    const notNoted = new Map();            // 名字 → 他这一轮做过的事（★不进账，但**要递给世界模型看**）
    const playerPids = normName(playerId);
    const actions = [];                    // 主语已归一、地点已继承的中间结果（未封顶）
    const playerSeen = [];                 // 主角那几条（按出现序）
    // ★★★leg123（细案 `docs/spec-tag-granularity.md`）：三族新标签的收料槽。
    const changes = [];                    // 【变化】主语已归一的结果（谁｜哪一格｜变成什么）
    const changesBad = [];                 // 【变化】**丢掉**的行 + 为什么丢（丢了什么必须能被看见）
    const promises = [];                   // 【承诺】谁｜许了什么｜对谁
    const promisesBad = [];                // 【承诺】**丢掉**的行 + 为什么丢
    const events = [];
    const eventsBad = [];
    const references = [], conditionUpdates = [], conditionsBad = [], associations = [];
    let recentAt = null;
    let protocol = null;
    const entById = new Map((entities || []).filter((e) => e?.id).map((e) => [e.id, e]));   // 类别校验用（角色的格 ≠ 势力的格）
    let at = null;                         // 【此刻】的时间点原文（★**先到先得**：点不是一个可以累加的量）

    let sceneText = null;                  // 当前场景原文（最近的 `【场景：…】`）
    let sceneId = null;                    // 归一到地点表的结果；null = 表里没有（或不在地点表口径里）

    // ★★★leg199（用户令「**删掉降级吧**」）：**没有标签块 ⇒ 这一轮零收获**——整支"退回逐行扫全篇"拆掉。
    //
    //   拆它的两条理由（第一条是 leg198 体检实跑抓出来的，装置 `F:/deepseek/tmp/leg198-audit/probe.mjs`）：
    //     ① ★**它是"猜"的最后一条路，而且比 leg198 拆掉的词表更狠**：块不在时逐行扫全篇 ⇒
    //        正文里**只要有一行以 `【行动】` 开头**（引用一张字条、一份告示、解说格式、打比方）就被当成真行动。
    //        实跑三档：`【行动】甲｜偷袭｜黄坤`（字条）⇒ 落账**一件真事件**；
    //        而**写到玩家名上**时（`【行动】黄坤｜刺杀｜甲`）⇒ **变成玩家这一轮的落子**、原样递给世界模型
    //        ⇒ 世界照它演下去。这正是 leg198 声称已治好的那个病（"拿别人的行动当玩家的落子"）换了个入口。
    //     ② 它与注入给聊天模型的规范**正面冲突**：`web/inject.js` 的 `tagSpecText()` 向模型承诺
    //        「**只有这个块里面的标签插件才看**；块外面写了也不作数」——而降级让这句话**是假的**。
    //   ★口径从此一句话：**只扫 ` ```tags ` 块里；没有块 ⇒ 什么都没有**（与"没标签就不进正文的行动"同源）。
    //   ★代价如实登记（用户已知情并拍板）：模型漏写块的那一轮**整轮零收获**（以前至少能捞到行）；
    //     leg93 时代之前的老聊天（块还没立）此后不再进账。→ 由接线层那句「没有标签」的如实出声兜。
    //   ★★为什么不能再"救"回去：任何"块不在就扫全篇"的写法都会把上面第①条那个病带回来。
    //     要救只能救**围栏写法**（leg137 那两级尝试：字面 `\n` 还原，门只开给零收获），那条留着。
    const shell = shellRange(text0, { loose });
    if (!shell) return emptyResult();
    const lines = text0.split(/\r?\n/);
    // Protocol is a block-level declaration. Invalid/missing v3 declarations must
    // never reinterpret an association cell as part of a legacy field value.
    const blockLines = lines.slice(shell.start, shell.end).map(line => line.trim());
    const declarations = blockLines.filter(line => /^【协议】/.test(line));
    const newTag = /^【(类别|当事人|影响范围|公开范围|引用|持续条件|条件范围|条件时间|条件变更|替代条件)】/;
    const newIntent = blockLines.some(line => newTag.test(line));
    const intent = declarations.length > 0 || newIntent || blockLines.some(line => /^【事件】/.test(line));
    for (const v of [3, 4]) if (declarations.length && declarations.every(line => line.slice('【协议】'.length).trim() === String(v))) protocol = v;
    const invalidProtocol = intent && (!protocol || (newIntent && protocol !== 4));
    for (let i = 0; i < lines.length; i += 1) {
        if (i < shell.start || i >= shell.end) continue;
        const raw = lines[i].trim();
        if (!raw) continue;
        const linked = raw.match(/^【(类别|当事人|影响范围|公开范围|引用|持续条件|条件范围|条件时间|条件变更|替代条件)】(.*)$/);
        if (linked) {
            const [, tag, body] = linked;
            const cells = body.trim().split(TAG_FIELD_SEP).map(s => s.trim());
            const bad = tag.includes('条件') ? conditionsBad : eventsBad;
            if (invalidProtocol || protocol !== 4) bad.push({raw, why:'protocol'});
            else associations.push({tag, cells, raw});
            continue;
        }

        // ① 时长（可多条 ⇒ 按出现序收集，★累加且**不做算术**）
        if (/^【时长】/.test(raw)) {
            const m = RE_ELAPSED.exec(raw);
            RE_ELAPSED.lastIndex = 0;
            const v = normPlace(m?.[1]);
            if (v) elapsedParts.push(v);
            else malformed.push(raw.slice(0, 40));
            continue;
        }
        // ② 场景（更新继承源）
        if (/^【场景/.test(raw)) {
            const m = RE_SCENE.exec(raw);
            RE_SCENE.lastIndex = 0;
            const v = normPlace(m?.[1]);
            if (v) { sceneText = v; sceneId = resolvePlace(v); }
            else malformed.push(raw.slice(0, 40));
            continue;
        }
        // ③ 行动
        if (/^【行动】/.test(raw)) {
            const m = RE_ACTION.exec(raw);
            RE_ACTION.lastIndex = 0;
            const body = normPlace(m?.[1]);
            if (!body) { malformed.push(raw.slice(0, 40)); continue; }
            const cells = body.split(TAG_FIELD_SEP).map((s) => s.trim()).filter((s, i) => s || i === 0);
            if (!cells[0]) { malformed.push(raw.slice(0, 40)); continue; }
            // ★★★leg89：**主语取哪一格，由"能不能在册上认出来"决定**（不是由格数决定）。
            //   为什么必须这样（本笔端到端实测抓出来的真毛病）：模型若把三格写成
            //   「谁｜做了什么｜针对谁」，而插件按"两格=无对象"读，就会把**动词当成主语**
            //   （"沿商路北上巡查"→ 归不上 ⇒ 整条行动**静默丢掉**）。⇒ 两个候选依次试：
            //     ① 两格读法：主语=cells[0]、动词=cells[1]（**规范形态**，先试）
            //     ② 三格读法：主语=cells[1]、动词=cells[2]（"对象"那一格其实是动词）
            //   ★只有"主语认得出来"才算数；两个都不认 ⇒ 如实进 unresolved（不猜、不丢痕迹）。
            //   ⚠边界：规范四格「谁｜做了什么｜针对谁」走 ①（主语认得出来 ⇒ 直接成立），
            //     所以三格读法**只**在"规范读法认不出主语"时兜底——它不会把正常的三格读反。
            const candidates = [
                { who: cells[0], verb: cells[1] || null, target: cells[2] || null },
                ...(cells.length >= 3 ? [{ who: cells[1], verb: cells[2] || null, target: cells[3] || null }] : []),
            ];
            let pick = null;
            for (const c of candidates) {
                if (!c.who) continue;
                const id = resolveEntity(c.who);
                if (id) { pick = { ...c, actorId: id }; break; }
            }
            if (!pick) {
                // ★★★leg89 更正（用户：「就算不在名册上也给插件模型看到啊？？为啥要丢掉呢」）：
                //   主语在账上/书上都查不到 ⇒ **仍然不造人**，但**这条行动不许丢**——
                //   它是**这一轮故事里真发生过的事**，只是**没写进账**（标 `noted: true`）。
                //   ★为什么必须递下去：若剧情里新冒出一个重要人物，模型给他标了一堆行动，
                //     旧做法会让这些行动**全部消失**，于是"这个人该不该入局"**永远没证据**。
                //     ⇒ 递给世界模型看，入不入局仍由它按现成的 newEntities 通道提议、引擎复核。
                const who = cells[0] || '';
                unresolved.set(who, (unresolved.get(who) || 0) + 1);
                if (!notNoted.has(who)) notNoted.set(who, []);
                const list = notNoted.get(who);
                const line = [cells[1], cells[2]].filter(Boolean).join('｜');
                if (line && !list.includes(line)) list.push(line);
                else if (!line && !list.length) list.push('（正文里做了事，没写清是什么）');
                continue;
            }
            const { actorId, verb, target: objRaw } = pick;
            // 地点：继承最近场景；场景也在表外 ⇒ 原样留文本（标 derived=false）
            const location = sceneId ?? sceneText ?? null;
            const locationDerived = Boolean(sceneId);
            const targetId = objRaw ? resolveEntity(objRaw) : null;
            const row = {
                actorId, verb,
                targetId,
                targetText: objRaw,
                location,
                locationDerived,
                source: 'tag',
            };
            if (playerPids && normName(actorId) === playerPids) playerSeen.push(row);
            else actions.push(row);
            continue;
        }
        if (/^【协议】/.test(raw)) {
            const version = raw.slice('【协议】'.length).trim();
            if (!['3','4'].includes(version) || invalidProtocol) malformed.push(raw.slice(0, 40));
            continue;
        }
        if (/^【事件】/.test(raw)) {
            const cells = raw.slice('【事件】'.length).trim().split(TAG_FIELD_SEP).map(s => s.trim());
            const [localId, title, participants, status, causes] = cells;
            const reject = (why) => eventsBad.push({ raw: raw.slice(0, 80), why });
            if (invalidProtocol || !protocol) { reject('protocol'); continue; }
            if (protocol === 4) {
                const [localId, title, status, causes] = cells;
                if (cells.length < 3 || cells.length > 4 || !localId || !title || !['已完成','未决'].includes(status)) { reject('shape'); continue; }
                if (events.some(e => e.localId === localId)) { reject('localId'); continue; }
                events.push({localId,title,pending:status === '未决', ...(recentAt ? {at:recentAt}:{}), ...(sceneId ?? sceneText ? {location:sceneId ?? sceneText}:{}), ...(causes ? {causeIds:[...new Set(causes.split('、').map(s=>s.trim()).filter(Boolean))]}:{})});
                continue;
            }
            if (cells.length < 4 || cells.length > 5 || !localId || !title || !participants || !['已完成', '未决'].includes(status)) { reject('shape'); continue; }
            if (events.some(e => e.localId === localId)) { reject('localId'); continue; }
            const participantIds = [], participantNames = [];
            for (const name of [...new Set(participants.split('、').map(s => s.trim()).filter(Boolean))]) {
                const id = resolveEntity(name);
                if (id) { if (!participantIds.includes(id)) participantIds.push(id); }
                else {
                    participantNames.push(name);
                    unresolved.set(name, (unresolved.get(name) || 0) + 1);
                }
            }
            if (!participantIds.length && !participantNames.length) { reject('participants'); continue; }
            const row = { localId, title, participantIds, pending: status === '未决' };
            if (participantNames.length) row.participantNames = participantNames;
            if (sceneId ?? sceneText) row.location = sceneId ?? sceneText;
            if (causes) row.causeIds = [...new Set(causes.split('、').map(s => s.trim()).filter(Boolean))];
            events.push(row);
            continue;
        }
        // ④ 【此刻】——**现在是什么时候**（时间点；逐字照抄，不做算术、不带源）
        if (/^【此刻】/.test(raw)) {
            const m = RE_AT.exec(raw);
            RE_AT.lastIndex = 0;
            const v = normPlace(m?.[1]);
            if (!v) { malformed.push(raw.slice(0, 40)); continue; }
            if (at === null) at = v;           // ★先到先得（不取最后、不拼接：点不是一个可累加的量）
            recentAt = v;
            continue;
        }
        // ⑤ 【变化】——谁｜哪一格｜变成什么（格名对齐实体账；值**照抄不换算**）
        if (/^【变化】/.test(raw)) {
            if (invalidProtocol) { changesBad.push({ raw: raw.slice(0, 80), why: 'protocol' }); continue; }
            const m = RE_CHANGE.exec(raw);
            RE_CHANGE.lastIndex = 0;
            const body = normPlace(m?.[1]);
            if (!body) { malformed.push(raw.slice(0, 40)); continue; }
            const cells = body.split(TAG_FIELD_SEP).map((s) => s.trim());
            const who = cells[0] || '';
            const field = cells[1] || '';
            if (protocol && (cells.length < 3 || cells.length > 4)) { changesBad.push({ raw: raw.slice(0, 40), why: 'shape' }); continue; }
            const value = (protocol ? cells[2] : cells.slice(2).join(TAG_FIELD_SEP)).trim();
            if (!who || !field || !value) { malformed.push(raw.slice(0, 40)); continue; }
            const id = resolveEntity(who);
            if (!id) {
                // ★宁缺勿造：账上没有这个人 ⇒ **不写格**（写格等于凭空造人），但丢了什么必须能被看见。
                unresolved.set(who, (unresolved.get(who) || 0) + 1);
                changesBad.push({ raw: raw.slice(0, 40), why: 'who' });
                continue;
            }
            const isPlace = field === CHANGE_PLACE_FIELD;
            if (!isPlace && !CHANGE_FIELDS.includes(field)) {
                changesBad.push({ raw: raw.slice(0, 40), why: 'field' });   // 格名不在册
                continue;
            }
            const kind = entById.get(id)?.kind || null;
            if (!isPlace && kind && CHANGE_FIELD_KIND[field] && CHANGE_FIELD_KIND[field] !== kind) {
                changesBad.push({ raw: raw.slice(0, 40), why: 'kind' });    // 角色的格写到势力身上（反之亦然）
                continue;
            }
            // ★驻点必须过地名归一（与事件 `position` 同一把尺子）；不在地名表里 ⇒ 丢 + 留痕。
            const place = isPlace ? resolvePlace(value) : null;
            if (isPlace && !place) { changesBad.push({ raw: raw.slice(0, 40), why: 'place' }); continue; }
            changes.push({
                entityId: id,
                field,
                value: isPlace ? place : value,
                raw: raw.trim(),                            // ★原话（落账时当 `proseQuote` 用：逐字回执）
                location: sceneId ?? sceneText ?? null,     // 地点继承最近场景（与行动同一条）
                source: 'tag',
                ...(protocol && cells[3] ? { eventLocalId: cells[3] } : {}),
            });
            continue;
        }
        // ⑥ 【承诺】——谁｜许了什么｜对谁（不是动手，但确实发生了；"让世界记住我的事"那一格）
        if (/^【承诺】/.test(raw)) {
            if (invalidProtocol) { promisesBad.push({ raw: raw.slice(0, 80), why: 'protocol' }); continue; }
            const m = RE_PROMISE.exec(raw);
            RE_PROMISE.lastIndex = 0;
            const body = normPlace(m?.[1]);
            if (!body) { malformed.push(raw.slice(0, 40)); continue; }
            const cells = body.split(TAG_FIELD_SEP).map((s) => s.trim());
            if (protocol && (cells.length < 3 || cells.length > 4)) { promisesBad.push({ raw: raw.slice(0, 40), why: 'shape' }); continue; }
            const who = cells[0] || '';
            const what = cells[1] || '';
            const toText = cells[2] || '';
            if (!who || !what) { malformed.push(raw.slice(0, 40)); continue; }
            const id = resolveEntity(who);
            if (!id) {
                // ★没有主的承诺挂不到任何人身上 ⇒ 丢 + 留痕（与【变化】同一条口径）。
                unresolved.set(who, (unresolved.get(who) || 0) + 1);
                promisesBad.push({ raw: raw.slice(0, 40), why: 'who' });
                continue;
            }
            // ★对象那一格**知道就写、不知道就不写**：写了个认不出的名字 ⇒ **不丢承诺**
            //   （玩家许下的事是"唯一真相源"），只把 id 留空、名字照抄进标题
            //   ⇒ 与行动那条"不造人但不丢料"同一条口径。
            promises.push({
                entityId: id,
                what,
                toId: toText ? resolveEntity(toText) : null,
                toText: toText || null,
                raw: raw.trim(),                            // ★原话（落账时当 `proseQuote` 用：逐字回执）
                location: sceneId ?? sceneText ?? null,
                source: 'tag',
                ...(protocol && cells[3] ? { eventLocalId: cells[3] } : {}),
            });
            continue;
        }
        // ⑦ 其它一律不看（正文归模型自由写；只有 `【…` 开头却不像上面各族的行才当"形状不合"留痕）
        if (/^【(时长|场景|行动|此刻|变化|承诺|协议|事件)/.test(raw)) malformed.push(raw.slice(0, 40));
    }

    // 先登记声明，再合并关联；关联的前后顺序不影响结果。
    const states = {'尚未生效':'planned','有效':'active','已结束':'ended'};
    for (const a of associations.filter(a => ['持续条件','条件变更','引用'].includes(a.tag))) {
        const [id, eventRef, statement, state] = a.cells;
        const reject = why => (a.tag === '引用' ? eventsBad : conditionsBad).push({raw:a.raw,why});
        if (a.tag === '引用') {
            if (a.cells.length !== 1 || !id) reject('shape');
            else if (!references.includes(id)) references.push(id);
        } else if (a.tag === '持续条件') {
            if (a.cells.length !== 4 || !id || !eventRef || !statement || !states[state]) reject('shape');
            else if (conditionUpdates.some(c=>c.localId===id)) reject('localId');
            else if (!events.some(e=>e.localId===eventRef)) reject('eventRef');
            else conditionUpdates.push({op:'create',localId:id,eventRef,statement,state:states[state]});
        } else {
            if (a.cells.length !== 3 || !id || !['有效','已结束'].includes(eventRef) || !statement) reject('shape');
            else conditionUpdates.push({op:'state',conditionRef:id,state:states[eventRef],eventRef:statement});
        }
    }
    const scopeItem = cells => {
        const kinds = {'对象':'entity','成员':'members','地点':'place','原文':'text'};
        const kind = kinds[cells[1]], text = cells[2];
        if (cells.length !== 3 || !kind || !text) return null;
        const ref = ['entity','members'].includes(kind) ? resolveEntity(text) : null;
        const eligible = ref && (kind !== 'members' || entById.get(ref)?.kind === 'faction');
        return {kind:kind === 'members' && !eligible ? 'text' : kind,text,...(eligible ? {ref}:{})};
    };
    const conditionTimes = new Map();
    for (const a of associations.filter(a => !['持续条件','条件变更','引用'].includes(a.tag))) {
        const condition = a.tag.includes('条件');
        const bad = condition ? conditionsBad : eventsBad;
        const row = condition ? conditionUpdates.find(c=>c.op==='create' && c.localId===a.cells[0]) : events.find(e=>e.localId===a.cells[0]);
        const reject = why => bad.push({raw:a.raw,why});
        if (!row) { reject(condition ? 'conditionRef':'eventRef'); continue; }
        if (a.tag === '类别') {
            if (a.cells.length !== 2 || !a.cells[1] || row.category) reject('shape'); else row.category=a.cells[1];
        } else if (a.tag === '当事人') {
            const names = (a.cells[1] || '').split('、').map(s=>s.trim()).filter(Boolean);
            if (a.cells.length !== 2 || !names.length) {reject('shape');continue;}
            row.actors ||= [];
            for (const name of names) if (!row.actors.some(x=>x.name===name)) {
                const ref=resolveEntity(name);row.actors.push({name,...(ref?{ref}:{})});
            }
        } else if (['影响范围','公开范围','条件范围'].includes(a.tag)) {
            const scope=scopeItem(a.cells);if (!scope) {reject('shape');continue;}
            const field = a.tag==='影响范围' ? 'affected' : a.tag==='公开范围' ? 'audience':'scope';
            (row[field] ||= []).push(scope);
        } else if (a.tag==='条件时间') {
            if (a.cells.length!==3) {reject('shape');continue;}
            const first = conditionTimes.get(row);
            if (first) {
                if (first[0] !== a.cells[1] || first[1] !== a.cells[2]) reject('conflict');
                continue;
            }
            conditionTimes.set(row, a.cells.slice(1));
            if(a.cells[1])row.effectiveFrom=a.cells[1];if(a.cells[2])row.effectiveUntil=a.cells[2];
        } else if (a.tag==='替代条件') {
            if(a.cells.length!==2 || !a.cells[1])reject('shape');
            else if (row.supersedes && row.supersedes !== a.cells[1]) reject('conflict');
            else row.supersedes=a.cells[1];
        }
    }
    if (protocol === 4) for (const [rows,bad] of [[changes,changesBad],[promises,promisesBad]]) {
        for (let i=rows.length-1;i>=0;i--) if(rows[i].eventLocalId && !events.some(e=>e.localId===rows[i].eventLocalId)) {
            bad.push({raw:rows[i].raw,why:'eventRef'});rows.splice(i,1);
        }
    }

    // ★`parsed` 的语义（leg89 实测校正，写死防将来改歪）：**正文里解析出的行动条数**
    //   （含归不上名字的、含主角的）——它是"这一轮故事里发生了多少件事"的读数。
    //   ⇒ `parsed - count` **不再等于**截断数（那会让"归不上名字"和"被封顶截掉"混成一笔账）；
    //     截断看 `count`、归不上看 `unresolved`，两笔账各说各的。
    const parsed = actions.length + playerSeen.length + [...unresolved.values()].reduce((s, n) => s + n, 0);
    const cap = Number.isFinite(maxActions) && maxActions > 0 ? Math.floor(maxActions) : Infinity;
    const kept = actions.slice(0, cap);

    return {
        protocol, events, eventsBad,
        ...(protocol === 4 || conditionsBad.length ? {references,conditionUpdates,conditionsBad}:{}),
        actedIds: [...new Set([...actions, ...playerSeen].map(a => a.actorId))],
        actions: kept,
        // ★散文并列，不是时长合计（合计就要做算术 = 编数）
        elapsed: elapsedParts.join('；'),
        elapsedParts,
        // ★★★leg123：`【此刻】`——本轮"现在是什么时候"（点，逐字照抄；没写 ⇒ null ⇒ 那一格不出现）
        at,
        // ★★★leg123：三族新料的收料面（★**只增键**：老聊天没有这三族 ⇒ 既有断言逐字节不变）
        changes,
        changesBad,
        promises,
        promisesBad,
        count: kept.length,
        parsed,                                              // ★截断必须可见：parsed > count 就是真丢了
        unresolved: [...unresolved.entries()].map(([name, n]) => ({ name, n })),
        // ★★★不在名册上的人**这一轮做过的事**——不进账，但要**递给世界模型看**（见上面那段注释）。
        notNoted: [...notNoted.entries()].map(([name, did]) => ({ name, did })),
        // ★主角槽：只留第一条（`playerMove` 是单事实形状，契约 v1），其余如实报数
        player: playerSeen[0] || null,
        playerDropped: Math.max(0, playerSeen.length - 1),
        malformed: malformed.slice(0, 3),
        locations: [...new Set(kept.map((a) => a.location).filter(Boolean))],
        // ★leg93 起：**这一次有没有标签块**——如实交出去（面板读数要用它把"没包块"说出来）。
        //   ★★★leg199：`mode` 那一格**已撤**（它只有 'shell'/'all' 两个值，而 'all' 整支已删 ⇒
        //     留着它等于留一格"永远是同一个值"的假选择）。**"没有块"由 `found:false` 如实说**。
        shell: { found: true, closed: shell.closed },
        // ★★★leg137：这一遍是不是"还原过字面 `\n` 之后"的结果（见本函数顶注那段两级尝试）。
        restored: false,
    };
    };

    const first = parse(src);
    // ★门只开给"零收获"（最严的一档，见顶注）。★`hasTagFacts` 就是本模块自己那条"有没有料"的口径，
    //   直接复用它 ⇒ 不会出现"这里算没读到、别处算读到了"两把尺子。
    //   ★★★leg199 复核（这一格**必须留着**，别顺手删）：`parse` 现在"没有块 ⇒ 零收获"，
    //     而 **JSON 转义那种写法恰恰就是"原样看没有块"**（围栏被字面 `\n` 顶得不在行首）
    //     ⇒ 这条降级**正是**它唯一的救法。删掉它 = leg137 治过的那条静默失效当场复发
    //     （`test/tag-extract.test.js` 的 leg137① 就是咬这个的）。
    //     ★它与"块不在就扫全篇"那条**不是一回事**：这里救的是**围栏写法**，不是取消边界。
    if (hasTagFacts(first) || src.indexOf(LITERAL_NL) < 0 || !RE_ESCAPED_FENCE_CLOSE.test(src)) return first;
    // ★`split().join()` 而不是正则替换：要替换的就是**字面反斜杠＋n 这两个字符**，不是转义序列。
    //   ★★★leg199：这一级多带一个 `loose:true`——还原之后围栏前面还挂着 JSON 信封那几个字符
    //     （`{"tags":"```tags`），不放宽这一档就等于**还原了也认不出块**（leg137 那条失效原样复发）。
    //     见 `RE_FENCE_OPEN_LOOSE` 那条注释：只对"已确认是 JSON 转义"的文本开门。
    const second = parse(src.split(LITERAL_NL).join('\n'), { loose: true });
    second.restored = true;
    return second;
}

/**
 * ★这一包"值不值得进包"——**没抽到任何东西 ⇒ 键不出现**（照 `recalled` 那条口径：
 *   与"空着就是空着"一致，且让没标签的老聊天**逐字节回到今天**，不动既有键序锁）。
 */
export function hasTagFacts(f) {
    if (!f) return false;
    return Boolean(
        f.actions?.length || f.notNoted?.length || f.player || f.elapsed || f.unresolved?.length
        || f.malformed?.length || f.playerDropped
        // ★★★leg123：三族新料也算"有料"——只有【此刻】/【变化】/【承诺】时也要进包、要出声
        //   （★`*Bad` 也算：丢了什么**必须能被看见**，这正是"不许静默"那条口径的落点）。
        || f.at || f.events?.length || f.eventsBad?.length || f.references?.length || f.conditionUpdates?.length || f.conditionsBad?.length || f.changes?.length || f.promises?.length || f.changesBad?.length || f.promisesBad?.length,
    );
}

/**
 * 面板/状态条那一行读数（★玩家可见文本，零引擎术语；被截断时**必须**出现）。
 * 形态：`标签: 行动 15 条（入包 12）· 主角 1 条 · 归不上 2 个名字（船夫×2）· 时长 三天；一炷香`
 */
export function tagReadoutLine(f) {
    if (!hasTagFacts(f)) return null;
    const bits = [];
    // ★分母 = 正文里解析出的行动条数（含归不上名字的、含主角的）；分子 = 真正进包的那几条。
    //   两个"丢了"各说各的、**不混成一笔**：截断看 count<非主角条数、归不上看 unresolved。
    const unresolvedN = (f.unresolved || []).reduce((s, u) => s + (u.n || 0), 0);
    const nonPlayer = Math.max(0, (f.parsed || 0) - unresolvedN - (f.player ? 1 + (f.playerDropped || 0) : 0));
    const truncated = nonPlayer > (f.count || 0);
    bits.push(`${f.parsed || 0} 条${truncated ? `（入包 ${f.count}）` : ''}`);
    if (f.player) bits.push(`主角 ${1 + (f.playerDropped || 0)} 条（落子 1）`);
    if (f.unresolved?.length) {
        const who = f.unresolved.slice(0, 3).map((u) => (u.n > 1 ? `${u.name}×${u.n}` : u.name)).join('、');
        // 名称解析诊断不承诺动作正文入包；重要未知参与者随明确结果保留名字。
        bits.push(`不在名册 ${f.unresolved.length} 个名字（${who}）——未建立实体，结果中的名字保留`);
    }
    if (f.elapsed) bits.push(`时长 ${f.elapsed}`);
    // ★★★leg123：三族新料如实报——**含"丢掉的"**（丢了什么必须能被看见，这条与既有 `形状不合` 同一口径）。
    if (f.at) bits.push(`此刻 ${f.at}`);
    if (f.events?.length) bits.push(`结果 ${f.events.length}`);
    if (f.eventsBad?.length) bits.push(`结果丢掉 ${f.eventsBad.length} 行`);
    if (f.references?.length) bits.push(`引用 ${f.references.length}`);
    if (f.conditionUpdates?.length) bits.push(`持续条件 ${f.conditionUpdates.length}`);
    if (f.conditionsBad?.length) bits.push(`条件丢掉 ${f.conditionsBad.length} 行`);
    if (f.changes?.length) bits.push(`变化 ${f.changes.length}`);
    if (f.promises?.length) bits.push(`承诺 ${f.promises.length}`);
    if (f.changesBad?.length) bits.push(`变化丢掉 ${f.changesBad.length} 行`);
    if (f.promisesBad?.length) bits.push(`承诺丢掉 ${f.promisesBad.length} 行`);
    if (f.malformed?.length) bits.push(`形状不合 ${f.malformed.length} 行`);
    return `标签: 行动 ${bits.join(' · ')}`;
}
