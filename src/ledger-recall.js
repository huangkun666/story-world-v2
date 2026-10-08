// story-world-v2/src/ledger-recall.js
// ★★★leg115：**账本检索层**——一个独立模块，供**多个消费者**用同一条路取账上的往事。
//
// 【为什么要有这一层】（用户 2026-09-23 三问点出来的方向）
//   用户原话：「**检索层不是要独立一个新模块供其他消费者检索吗？检索的方式也不可能只有一种吧？**」
//   现状：取往事这件事**各处各写一套**——
//     · 世界模型：`pack.js` 直接 `chronicleBrief(ssot)` 伸手抓编年（零检索）；
//     · 聊天模型：`memory-bridge.js` 直接 `world.events.filter(closed).slice(-60)`（零检索）；
//     · 面板/链视图：`chain.js`、`render.js` 各按自己的形状读。
//   ⇒ 三处口径各自演化，**同一件往事在三个地方是三套说法**。
//   本模块把「取哪一批往事」收成**一条接口 + 多个可取的方式**，消费者不再各写一套。
//
// 【三条纪律（逐条照抄 `recall.js` 的既有口径，不新造）】
//   ① **只读、零副作用**：本模块不写账、不改入参（纯函数；取完就返回）；
//   ② **失败零阻塞**：没源/取不到/抛错 ⇒ 一律返回空批次，世界照常推进（`recall.js:81` 同款）；
//   ③ **如实上报**：`reason` 必须能区分"**没命中**"与"**根本没在检索**"——
//      这条有血证：`START-HERE.md:1298` 记着「返空是静默的……界面分不出"没命中"和"根本没在检索"」。
//
// 【★这一层要解决的头号问题：**"什么时候"**】
//   用户原话：「**聊天llm是不知道什么时候世界发生了什么事懂吗？**」
//   实测（真账 `大荒z` tick 61 · 只读副本）：
//     · 账上 **`simLog` 没有任何时间字段**（只有 tick / packTokens / ssotBytes / events / chronicle…）；
//     · `elapsed`（正文里【时长】写的"过了多久"）**是账外的料**（`pack.js:1014` 原文：「引擎一个字都不解析它」）；
//     · ⇒ 聊天模型拿到的往事只带「**第 60 轮**」= **引擎轮次**，而**故事时间**在账上一个字节都不留。
//   ⇒ 本层的头等事：**把时间印记随往事一起取出来**。
//
// 【★关于时间的口径：**只收集，不做算术**】（本仓最硬的一条同源纪律）
//   `STATE.md` §2.2 第 1 条：「**不许把书里的词换算成数**……照抄成文本，引擎不换算、不进公式」。
//   这一条同样管时间：**绝不把「三天」「一炷香」累加成一个"第 N 天"**——那是换算，会编出账上没有的数。
//   本层只做两件事：①**原话照抄**；②**把它归到哪一轮**（轮次账上本来就有，是事实不是换算）。
//   ⇒ 消费者（模型/人）拿到的是「第 47 轮 · 此后又过了：三天」，**要累加由读者自己加**。
//
// 【★它有一条 import（leg117 更正）】
//   本模块原来**零 import**（真叶子）。现在**有一条**：`chronicle-brief.js` 的"这一行是什么话"判据表。
//   为什么破例（用户 2026-09-23 拍板）：那套行首规则原来是**两份**（本模块自己抄了一份，原文写着
//   "本层自己认一遍"），实测**已经分叉**（「涟漪平息」一边弃、一边收）——B2 一接就会长成三份。
//   ⇒ **取数是本层的事，认"这是什么话"是那张表的事**：一处定义、两处共用
//     （`chronicle-brief.js` 是零 import 的真叶子）⇒ 依赖单向（本层 → 它），**没有环**。
//   ★其余照旧：它只读**调用方递进来的账**（`ssot`），不自己去取世界、不碰 DOM、不碰存储
//     ⇒ Node 里可直接真跑，判据不需要造环境。
//
// 【★取回来之后：**谁更该给消费者看**（2026-09-23 补）】
//   第一版只做了"取回来"，**没有排序**——而这是个真缺陷，不是风格问题：
//   切字符预算那一步是「**谁先来谁占额度，满了就停**」⇒ **排序直接决定什么进得了上下文**。
//   实测（200 行账 · 1600 字预算）：按名取**一条排序都没有** ⇒ 留下的是**最老的 64 行**；
//   而按词取有排序（命中多的在前、同分新的在前）⇒ 留下的是**最新的 63 行**。
//   两条路一个记着陈年旧账、一个记着刚发生的事，**口径互相打架**。
//   最近与名称模式仍按轮次新的在前；关键词模式按命中词数、再按新旧选择预算，
//   避免一条新的一词记录挤掉旧的多词记录。聊天合并候选时复用同一匹配排序。
//   ★原来这里还有一句"**有向的两种取法不排**"（`照因果上溯` 要一层层看来路、`照指针` 要那件事
//   自己的顺序；替消费者重排就是替它决定它没要的东西）——本笔把那两种取法整个删了
//   （见 `RECALL_MODES` 头注：**生产路径零调用**）。向量模式保留相似度顺序。

import { chronicleBriefKind, CHRONICLE_BRIEF_KINDS } from './chronicle-brief.js';
// ★★★leg161（用户令「**那就让聊天侧也接上向量检索呗**」）：**向量那一档**。
//   ★依赖方向仍**单向**：`ledger-recall.js → embed-orchestration.js → ledger-vector.js`（真叶子）
//     与 `→ chronicle-brief.js`（真叶子）⇒ **不成环**（判据 `module-layout.test.js` 的丙案⑤钉着）。
//   ★为什么这一档要住在这里（而不是让消费者自己调向量层）：细案 §7 写死过——
//     「**向量进来时仍是唯一入口**（`modes` 加一档，**别另开一条路**）」。
//     本仓为"同一个判断两处各写一份"付过账（leg117 那张表分叉），这里不重蹈。
import { recallForPack } from './embed-orchestration.js';
import { RECALL_TOP_DEFAULT } from './ledger-vector.js';
import { filterChatRecords } from './event-provenance.js';
import { eventDetailText } from './event-contract.js';
// ★本笔（死码清理）：原来这里还有第二条 import——`setting.js` 的 `eventBornTick`（leg118 借来的
//   "一件事件出生在第几轮"那把尺）。它只服务 `withRound`，而 `withRound` 只服务那四种被删的取法
//   ⇒ 一起删了。★本模块回到**一条 import**（仍是真叶子：不取世界、不碰 DOM、不碰存储）。

/** 可取的方式（★方式不止一种——这是本层存在的理由，见文件头）。 */
export const RECALL_MODES = Object.freeze({
    RECENT: 'recent',       // 最近优先：账是只往后加的顺序，取尾巴
    BY_KEYWORD: 'keyword',  // 按词：命中了哪些往事（**字面**匹配，弱）
    BY_NAMES: 'names',      // ★★按**账上真名**：拿调用方给的一段话，先点出里面出现了账上的哪些真名，再照名取
    // ★★★leg161：**按意思取**（向量）——用户令「**那就让聊天侧也接上向量检索呗**」＋
    //   「**向量记忆就是rp内标准的解决失忆方案**」。
    //   ★**它是"唯一入口"里的一档**，不是另开一条路（细案 `docs/spec-memory-engine.md` §7 写死过）。
    //   ★**查询向量由调用方嵌好递进来**（`q.qVector`）——本层**同步、不碰网络**（纪律②照旧：
    //     存储与网络住浏览器侧）。没递向量 ⇒ 这一档**空手而归**（不抛、不编）。
    //   ★**它捞的是"字面对不上"的那一段**：实测两法捞出来的行**几乎不重叠（0–1/6）**
    //     ⇒ 与 `BY_NAMES` **并联**，不是替代。
    BY_VECTOR: 'vector',
});

// ---------- ★本笔（死码清理）：删掉的四种取法，出处与凭据都留在这里，免得下一任再翻一遍 ----------
// 删的是这四种：`按人取`（BY_ENTITY）· `照指针`（BY_ID）· `按轮次`（BY_TICK）· `照因果上溯`（BY_CAUSE）。
//
// 【凭什么删：**生产路径零调用**（grep 穷举，不是印象）】
//   全仓 `modes:[…]` 只有 **3 处字面量**、**没有一处动态拼装**：
//     · `pack.js:806`   最近优先（`纪事` 那一栏）            ⇒ RECENT
//     · `pack.js:922`   按真名 + 按词（`相关往事` 那一栏）    ⇒ BY_NAMES · BY_KEYWORD
//     · `web/inject.js:497` 按真名 + 按词（第四段注入）      ⇒ BY_NAMES · BY_KEYWORD
//   ⇒ 七种取法里，这四种**在生产上一次都没被调用过**，只在判据里被调。
//   （唯一的例外是 `pack.js` 那条注释写着"了结的边是往事——往事走检索层（**按人取**）"（本笔实测在
//     `:1293`，行号随并行改动位移），但**没有任何生产代码调 `BY_ENTITY`** ⇒ 那条承诺的消费者不存在，
//     注释待下一棒同批勘正。）
//
// 【一起删掉的还有它们名下那套"跨归档"机器】`buildArchiveIndex` / `findEventAnywhere` / `withRound`
//   （`milestones[].rows` 建表 → 取归档事件本体）。它真能跨过归档边界，但**唯一消费者就是这四种取法**
//   ⇒ 生产路径上没人读。实测（真账 `tmp/leg133-real60b/world.json` · 5 里程碑 / 161 条归档留档 /
//   789 行编年）：把 `archivedById` 故意塞成空 `Map`（跳过建表），生产那两种取法结果**逐字节相同**
//   （最近优先 789 = 789；按真名+按词 672 = 672）。
//   ★**"跨归档"这个能力本身没丢，只是不在本层了**——同一件事在本仓另有**两处生产在用**的实现：
//     · `chain.js` 的 `archivedEventMap`（`milestone.rows` → 归档事件与热池事件同形，链往上走不断；
//       经 `web/index.js` 的 `expandChain` 直接给玩家看）；
//     · `ref-rules.js` 的 `includeArchived`（归档入纪：号在大事纪里出现过就算存在）。
//     要再把"检索层跨归档"接回来，照那两处的口径重做，别在这里另抄一份。

// ---------- ★为什么没有"取哪些源"这个旋钮（用户 2026-09-23 拍板撤掉） ----------
// 原来这里挂着 `RECALL_SOURCES`（编年/事件/里程碑/盘算/实体 五选），`DEFAULTS.sources` 也给了默认值。
// ★实测它是**装饰**（`demo` 探针：同 modes、只改 sources，三种取值取到的行**逐个相同**）——
//   因为**每种方式只读一种源**，这个旋钮改不动任何东西。
//   ★当时补的那一句"唯一真管事的是 `includeArchive`（里程碑那道闸）"——本笔连同里程碑还原那一路
//     一起删了（生产没有一处传它；见上面"本笔删除"那一段）。
// ⇒ 撤掉。留着一个改不动结果的参数 = 让人白调半天（就是本仓那条"没有消费方的抽象 = 死抽屉"）。
//   哪天真要"只要某一种源"，正确做法是**加一种方式**（方式才是取数的真正决定者），不是加一层筛子。

const DEFAULTS = Object.freeze({
    modes: [RECALL_MODES.RECENT],
    limit: null,             // ★至多取几条；**默认不限**（`null` = 不设条数上限，由 `maxChars` 说话）
    maxChars: 6000,
    text: '',
    // ★本笔删掉的是只被那四种取法读的几格：`entityId` / `entityName` / `ids` / `tickFrom` / `tickTo`
    //   （还有下面那两格归档用的）。留着它们就是本模块自己骂过的"改不动结果的参数 = 让人白调半天"。
    currentTick: null,
    // ★★★leg119：**卷**（编年进了冷档的那一段）——编排层取好递进来；**缺省 null = 只有热账**（与今天逐字节相同）。
    volumes: null,
});

// ---------- ★★卷（冷档）：取数要能看见它 ----------

/**
 * ★★★leg119：**把"卷里的编年行"并进"热账的编年行"，合成一条时间线。**
 *
 * 【为什么非有不可（真账实测 + 结构性缺口）】
 *   `rotateChronicle`（`storage.js:74`）在编年过长时，把**最旧的一段**剪下来整段搬进"卷"
 *   （住在浏览器 IndexedDB 里）。剪走之后那些行**就不在 `ssot.chronicle` 里了**——而本层取法
 *   （当时七种，本笔删剩三种）**每一种都只读 `ssot.chronicle`** ⇒ **轮转一发生，卷里那些往事
 *   就从取法的视野里整个消失**。
 *   强制轮转实测（真账副本 · 阈值临时调到 20 轮，只为让机制真跑一遍）：编年 360 行 → 热账 174 行，
 *   **186 行当场取不回来**（其中 **119 条是真往事**）；而当过消费者的"纪事"栏会**从 237 条掉到 118 条**。
 *
 * 【★为什么读 `volume.rows`，而不是 `volumeToChronicleRows(volume)`】
 *   ① `volume.rows` **就是当年那些编年行的原样副本**（`rotateChronicle` 里 `.map((r) => ({ ...r }))`）
 *      ⇒ 与本层已经在读的 `ssot.chronicle` **是同一种东西**，没有什么可转换的；
 *   ② `volumeToChronicleRows` 是**给渲染那一侧**用的固定形状，它的输出被 `test/storage.test.js`
 *      用 `deepEqual` **逐键锁着**（红线 §2.2 第 4 条：改判据 = 改承重墙）⇒ 本笔**不碰它**；
 *   ③ 它还会把**读不出轮次的行补成 `tick: 0`**（`chronTick` 那条兜底）——那是**填占位值**
 *      （红线 §2.2 第 2 条"空着就是空着"）。本层要的恰恰相反：**读不出来就说读不出来**；
 *   ④ 有一格本层要用、而它不给：`id`（去重按"这一条是谁"）。
 *      ★本笔删掉四种取法之后，当时并列的另一格 `chainRef` 已不再被本层读（认它的两种取法没了）——
 *        这一句留档：它是当年不走 `volumeToChronicleRows` 的理由之一。
 *
 * 【口径】
 *   · **只读**：返回的是**新数组**，行对象**原样引用、一个字节不改**（本层纪律①：只读、零副作用）；
 *   · 卷按 `fromTick` **升序**摆在前头（更旧的在前）⇒ 合并结果仍是"从最早到现在"。
 *     ★但多数取法取回来还会按轮次重排（`MODES_SORTED`）⇒ 这个顺序只为"读代码时看得懂"，**不承担正确性**；
 *   · ★**不传卷 ⇒ 原样返回 `ssot.chronicle`（同一个引用）** ⇒ 旧调用方**逐字节零扰动**；
 *   · 卷里没有 `rows`／不是数组 ⇒ **跳过那一个卷**（不炸、不编、不补）。
 * @param {object} ssot     世界账（**热账**——它本来就只表示热账，卷是另外递进来的）
 * @param {Array}  volumes  已经取出来的卷（编排层负责取；本层不碰存储——见文件头纪律①）
 * @returns {Array} 合并后的编年行（卷在前、热账在后）
 */
export function chronicleOf(ssot, volumes) {
    const hot = Array.isArray(ssot?.chronicle) ? ssot.chronicle : [];
    const list = Array.isArray(volumes) ? volumes : [];
    const details = new Map();
    for (const m of ssot?.milestones || []) for (const e of m.rows || []) details.set(e.id, e);
    for (const e of ssot?.events || []) details.set(e.id, e);
    const enrich = rows => {
        const mapped = rows.map(r => {
        const e = details.get(r?.eventRef);
        const detail = eventDetailText(e);
        if (!detail || String(r.text || '').includes(detail) ||
            !(r.text === e.title || String(r.text || '').startsWith(`事件「${e.title}」`))) return r;
        return { ...r, text: `${r.text}；${detail}` };
        });
        return mapped.some((r, i) => r !== rows[i]) ? mapped : rows;
    };
    if (!list.length) return enrich(hot);
    const ordered = list.slice().sort((a, b) => volumeStartTick(a) - volumeStartTick(b));
    const cold = [];
    for (const v of ordered) {
        const rows = Array.isArray(v?.rows) ? v.rows : null;
        if (!rows) continue;
        for (const r of rows) if (r) cold.push(r);
    }
    return enrich(cold.length ? [...cold, ...hot] : hot);
}

/** 一卷从第几轮开始——**只用来排序**；读不出 ⇒ 排到最后。★绝不填 `0` 冒充轮次（红线 §2.2 第 2 条）。 */
function volumeStartTick(v) {
    for (const x of [v?.fromTick, v?.rows?.[0]?.tick]) {
        const n = Number(x);
        if (Number.isFinite(n)) return n;
    }
    return Infinity;
}

// ---------- 编年行是什么话（★规则表**不在这里**，见 `chronicle-brief.js`） ----------
// 本层原来**自己抄了一份**行首规则（原文：「本层自己认一遍、不 import chronicle-brief.js」）——
// 用户 2026-09-23 拍板收成一份：实测两份**已经分叉**（「涟漪平息」一边弃、一边收），
// 而 B2 接上之后还会长成第三份。⇒ 取数归本层，认"这是什么话"归那张唯一表。
// ★本层**照收 `OTHER`**（认不出的行也收）——与 `chronicle-brief` 弃 `LEDGER` 是**两种不同的取舍**，
//   共用的是**分类**，不是取舍。

/** 这一行是什么话（**转出**唯一那份表的结论；见 `chronicle-brief.js` 的 `KINDS` 头注）。 */
export function chronicleKindOf(line) {
    return chronicleBriefKind(line);
}

/** 一句人话把"这是什么话"讲给消费者（★首次出现处必须解释，这是 `STATE.md` §2.5 的红线）。 */
export const KIND_LABEL = Object.freeze({
    [CHRONICLE_BRIEF_KINDS.CAUSE]: '来路（这件事因何而起）',
    [CHRONICLE_BRIEF_KINDS.STEP]: '经过（这一步做了什么、代价是什么）',
    [CHRONICLE_BRIEF_KINDS.OUTCOME]: '收场（为什么收场）',
    [CHRONICLE_BRIEF_KINDS.LEDGER]: '机械记账（格式化，语义为零）',
    [CHRONICLE_BRIEF_KINDS.OTHER]: '其它（引擎读不懂这是什么话，照收不删）',
});

// ---------- 时间印记 ----------

/**
 * 从账上读"第 N 轮的时间印记"。
 * ★口径：**只收集原话，不做算术**（见文件头）。返回值形如：
 *   { tick: 47, elapsed: '三天', marks: ['三天'], known: true, timeMark: '复苏历三年 三月初七' }
 * ★★★leg137：**两格分开交**——`timeMark`（那时是什么时候，一个**时间点**）与 `elapsed`
 *   （此后又过了多久，一个**相对量**）。★为什么必须分开：用户 2026-09-27 指出的那个真冲突——
 *   正文写了 `【此刻】十月初` ＋ `【时长】三月后`，**读者分不出"三月后"是"从现在往后"还是
 *   "从上一轮往后"**；要判它就得知道**上一轮的此刻**是什么。⇒ 把两点一量分开摆出来，
 *   让读的人（世界模型 / 聊天模型）自己接得上。
 *   ★本笔之前只读 `elapsed`（而函数名就叫 `timeMarkAt`），时间点那一格**全仓没有消费者**。
 * 账上没有那两格（旧账 / 那一轮没写）⇒ `known:false`，**绝不填占位值冒充**（红线 2：空着就是空着）。
 */
export function timeMarkAt(ssot, tick, volumes = null) {
    const t = Number(tick);
    if (!Number.isFinite(t)) return { tick: null, elapsed: '', marks: [], known: false, timeMark: '' };
    // ★★★leg119：**这一处也是只读 `ssot.chronicle` 的**（本笔实测查出的第二处盲点）——
    //   轮转之后，卷里那些轮次的"那一轮此后又过了多久"同样取不到，而 `groupByTime` 会如实说
    //   "账上没记"——**账上是记了的，只是搬进卷了**。⇒ 同一条合并走到底（见 `chronicleOf`）。
    const rows = chronicleOf(ssot, volumes);
    const marks = [];
    const points = [];      // 时间点（`timeMark`）——★新加的那一格，与 `marks` **分得开**
    for (const r of rows) {
        if (Number(r?.tick) !== t) continue;
        const tm = String(r?.timeMark ?? '').trim();
        if (tm && !points.includes(tm)) points.push(tm);
        const e = String(r?.elapsed ?? '').trim();
        if (e && !marks.includes(e)) marks.push(e);
    }
    // ★`marks` / `elapsed` / `known` **三格逐字节保持原样**（既有消费者 `formatRecalled` 读的就是它们
    //   ⇒ 聊天侧零扰动）；新加的那一格 `timeMark` 才是"时间点分得开"的那一份。
    return {
        tick: t,
        elapsed: marks.join('；'),
        marks,
        known: marks.length > 0,
        timeMark: points.join('；'),
    };
}

/**
 * 把一批取出来的往事**按轮次分组**，给每一组挂上那一轮的时间印记。
 * 用途：消费者要的是"什么时候"，而不是"第几轮"。
 * ★不做累加、不算"距今天几天"——只把**每一轮各自的时长原话**摆出来，让读者自己读顺序。
 * ★★leg118 改：**轮次解不出来的那几条不再被静默丢掉**——单独摆成最后一组（`tick: null`），
 *   由 `formatRecalled` 如实说"账上没记它在第几轮"。★理由（leg118 实测）：
 *   原来那一句 `if (!Number.isFinite(t)) continue;` 一丢就是 50 条（真账实测），而**回执还说成功**。
 */
export function groupByTime(ssot, items, volumes = null) {
    const byTick = new Map();
    const untimed = [];
    for (const it of items || []) {
        const t = Number(it?.tick);
        if (!Number.isFinite(t)) { untimed.push(it); continue; }
        if (!byTick.has(t)) byTick.set(t, []);
        byTick.get(t).push(it);
    }
    const ticks = [...byTick.keys()].sort((a, b) => a - b);
    const out = ticks.map((t) => ({ tick: t, time: timeMarkAt(ssot, t, volumes), items: byTick.get(t) }));
    // ★这一组排最后：它就是"排不进时间线的那几条"——**照印，不丢**（"宁可多带一句，不可丢一段往事"）。
    if (untimed.length) {
        out.push({ tick: null, time: { tick: null, elapsed: '', marks: [], known: false }, items: untimed });
    }
    return out;
}

// ---------- 取数（每种方式一段，共用同一个"出批次"的收口） ----------

/** 滤掉空项（**不滤别的**：认不出的、形状怪的都照收——"宁缺勿造"的对偶是"不许因为不认识就删"）。 */
function asItems(list) {
    const out = [];
    for (const it of list || []) {
        if (!it) continue;
        out.push(it);
    }
    return out;
}

/** 最近优先：账只往后加 ⇒ 尾巴就是最近的（倒着给 = 新的在前，与统一排序同一口径）。 */
function modeRecent(ssot, q) {
    void q;
    const chron = chronicleOf(ssot, q.volumes);
    return chron.slice().reverse();
}

/** 按词：拿账上真有的字去命中（零依赖，不引分词器——本仓有判据禁止词表判语义）。 */
function modeKeyword(ssot, q) {
    const terms = keywordsOf(q.text);
    if (!terms.length) return [];
    const chron = chronicleOf(ssot, q.volumes);
    const hits = chron.filter(r => terms.some(term => String(r?.text ?? '').includes(term)));
    return rankKeywordMatches(hits, q.text);
}

/** 预算选择共用的字面排序：不同词命中数优先，同分看已有轮次；不修改数组或记录。 */
export function rankKeywordMatches(items, text) {
    const terms = keywordsOf(text);
    return asItems(items).map((it, seq) => {
        const value = String(it?.text ?? '');
        const score = terms.reduce((n, term) => n + Number(value.includes(term)), 0);
        return { it, score, newness: newnessOf(it), seq };
    }).sort((a, b) => (b.score - a.score)
        || ((b.newness ?? -Infinity) - (a.newness ?? -Infinity)) || (a.seq - b.seq))
        .map(row => row.it);
}

// ★本笔删掉了 `modeByEntity`（按人/势力）——口径留档：它认**三种关系**（名字 / 他名下盘算的目标名 /
//   他被牵动的事件 id），且**只走"他被牵动"那一侧**、不替消费者走向上游。要恢复请照判据里的夹具重做。
//   ★`pack.js` 那条注释（"了结的边是往事——往事走检索层（**按人取**）"，本笔实测时在 `:1293`，
//     行号随并行改动位移）的消费者**不存在** ⇒ **待下一棒同批勘正**（`pack.js` 不在本笔名下）。

// ★本笔删掉了 `modeById`（照指针：编年行 + 事件本体，跨归档）与 `modeByTick`（按轮次区间）。
//   要恢复请照判据里那几条夹具重做；★它们的"跨归档"那一半依赖下面删掉的那张表。

// ---------- ★本笔（死码清理）：原来这里那一族"跨归档"取数，整段删了 ----------
//
// 删掉的是四件：`buildArchiveIndex`（`milestones[].rows` → `id → 归档事件` 表，**每批次建一次**）·
// `findEventAnywhere`（先热池、后归档，归档来的带 `archivedIn`）· `withRound`（leg118：给取回来的
// 事件补"第几轮"——事件的轮次不在对象里，在 id 里）· `modeByCause`（照因果链上溯，跨归档不停）。
//
// 【它们**真能跨过归档边界**（leg117 特意做的：事件满 20 轮且整链结清 ⇒ `settle.js` 把它从
//   `ssot.events` 删掉、压成里程碑，走到归档边界就断）——删的依据不是"做不到"，是**没人读**】
//   · 那张表的**唯一消费者就是 `照因果上溯` 与 `照指针`**，而这两种取法生产路径零调用（见文件头）；
//   · 实测（真账 `tmp/leg133-real60b/world.json` · 5 里程碑 / 161 条归档留档 / 789 行编年）：
//     把 `archivedById` 故意塞成空 `Map`（跳过建表），生产那两种取法结果**逐字节相同**
//     （最近优先 789 = 789；按真名+按词 672 = 672）⇒ 这张表在生产路径上确实没人读。
//   · 代价读数：每轮 **0.231 ms / 161 条**（微不足道——删它是为清晰，不是为性能）。
//
// 【★"跨归档"这个能力本身没丢，只是不在本层了】同一件事本仓另有**两处生产在用**的实现：
//   `chain.js` 的 `archivedEventMap`（`milestone.rows` → 归档事件与热池事件同形，链往上走不断；
//   经 `web/index.js` 的 `expandChain` 直接给玩家看）与 `ref-rules.js` 的 `includeArchived`
//   （归档入纪：号在大事纪里出现过就算存在）。★要接回来，照那两处口径重做，别在这里另抄一份。
//
// 【一起删掉的还有 `withRound` 名下那条血证】事件条目**没有 `tick`** 时，排版那一步（`groupByTime`
//   按轮次分组）会把它**静默丢掉**：真账实测"锚 42 个未决事件 ⇒ 取回 114 条 ⇒ 只渲染出 64 行"
//   （**丢 50 条**）而回执还说 `ok=true`。★那条纪律本身照旧管用，判据也留着（`formatRecalled`
//   对"轮次解不出来"的条目：**照印 + 如实说不知道**，绝不静默丢、绝不编号）。

/**
 * ★★按**账上真名**取——**这一条是"相关性"的正解**（真账实测定的，见下）。
 *
 * 拿一段自由文本（调用方给：**上一轮正文 ＋ 玩家这一轮输入**），
 * 先**点名**：账上那 600 多个真名（角色/势力/地点）里，哪几个**真出现在这段话里**；
 * 再**照名取**：编年里提到这些名字的行，就是"关于这件事的往事"。
 *
 * ★为什么它比"字面关键词"强（真账 `大荒z` tick 61 实测，装置见交接 §4）：
 *   · 玩家那一句话：**12 条里只有 2 条**能点出账上真名；拿字面关键词去撞 ⇒ **命中 0 条**；
 *   · **上一轮正文**：**每一条都有 11–13 个**账上真名（大虞、万法阁、天机阁、白小娥…）
 *     ⇒ 照名取 **命中 133–224 行**。
 *   ⇒ 玩家正文与账本用词本来就不同（"斩落人间十万峰" vs「死煞核心二次暴动」），**字面撞不上**；
 *     而**名字是账本自带的那把钥匙**——它落账时就把 id 渲染成了名字（`settle.js:103`）。
 * ★为什么不用向量：那是引一个外部插件（本仓"零依赖"+ 与 D3 解耦那条冲突）；而**真名这条路零依赖、可真测**。
 * ★仍然**只用账上真有的字**：名字全部从 `ssot.entities` / `ssot.agendas` 读，不猜、不造、不模糊匹配。
 */
function modeByNames(ssot, q) {
    const text = String(q.text ?? '');
    if (!text) return [];
    const hits = [];
    const seen = new Set();
    const push = (s) => { if (s && !seen.has(s)) { seen.add(s); hits.push(s); } };
    // ① 实体真名（★长的排前：`白小娥` 与 `小娥` 同时命中时先认长的那个）
    const ents = (ssot?.entities || []).map((e) => String(e?.name || '').trim())
        .filter((n) => n.length >= 2).sort((a, b) => b.length - a.length);
    for (const n of ents) if (text.includes(n)) push(n);
    // ② 盘算的目标原话（★真账实测：编年里提到一件事有相当一部分是**只写目标名、不写人名**的）
    for (const a of (ssot?.agendas || [])) {
        const g = String(a?.goal || '').trim();
        if (g.length >= 4 && text.includes(g)) push(g);
    }
    if (!hits.length) return [];
    const chron = chronicleOf(ssot, q.volumes);
    const out = [];
    for (const r of chron) {
        const t = String(r?.text ?? '');
        for (const n of hits) if (t.includes(n)) { out.push(r); break; }
    }
    return out;
}

// ---------- ★排序：谁排前面，谁就占得到字符预算 ----------

/**
 * ★★这一条往事"有多新"——**只用来排序，绝不进账、绝不进给模型看的那段话**。
 * ★**只读账上真有的格**（轮次是账上的事实，不是换算）：编年行看 `tick`，事件看 `tick`/`closedAt`，
 *   里程碑看 `span.to`。**读不出就返回 `null`**——不许拿 0 或"现在"冒充（红线 2：空着就是空着）。
 *   ★本笔删掉四种取法之后，走到这里的条目**都是编年行**（自带 `tick`）⇒ 后两格暂时够不着；
 *     留着是因为它是**通用口径**（谁喂什么条目它都只认账上真有的格），不是死代码。
 */
function newnessOf(it) {
    for (const v of [it?.tick, it?.closedAt, it?.span?.to]) {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

// 最近与名称模式按新旧排序；关键词模式保留上面的命中词数顺序。
//   ★原来这里还写着"**有向型**不排——`照因果上溯` 的链顺序、`照指针` 的顺序本身就是信息"：
//     那两种取法已删掉（生产路径零调用，见 `RECALL_MODES` 头注）。
//   ★★★leg161：**向量那一档不排**——它的顺序**就是相似度序**（从最像到最不像），
//     排了就把那一层唯一的产出（"哪几条最像"）毁掉。★它是**有向型**（第一个是"最像的"），
//     与 `照因果上溯` 当年那条口径同源（"顺序本身就是信息"）。
const MODES_SORTED = new Set([
    RECALL_MODES.RECENT, RECALL_MODES.BY_NAMES,
]);

/**
 * ★★★leg161：**按意思取**——把调用方嵌好的查询向量交给向量层，取回最像的 N 条**账上原文**。
 *
 * 【它为什么不在这里自己嵌】本层是**同步**的（`recallLedger` 的既有契约：出包那一刻必须同步跑完），
 *   而嵌一条向量要**一趟网络**。⇒ 分工照旧：**存储与网络住浏览器侧**
 *   （`web/embed-runtime.js` 把向量嵌好、由 `q.qVector` 递进来），本层只负责"取"。
 *   ★没递向量（没配通道 / 还没嵌好 / 嵌失败）⇒ **空手而归**——不是坏行为，是"这一轮退回字面路"。
 *
 * 【它捞的是什么】窗口外、**字面对不上**的那一段（实测两法捞的行几乎不重叠 0–1/6）。
 *   ★`floor` 由调用方按**同一个算法、同一份旋钮**算好递进来（`windowFromTick` ＋ 账上「往事轮数」）——
 *     两处各算一次就会出现"这一行既在 `纪事` 里、又被召回回来"的重叠。
 */
function modeByVector(ssot, q) {
    if (!Array.isArray(q?.qVector) || !q.qVector.length) return [];
    const store = q?.vectorStore;
    if (!store) return [];
    const got = recallForPack(ssot, store, {
        qVector: q.qVector,
        floor: Number.isFinite(Number(q?.floor)) ? Number(q.floor) : 0,
        top: Number.isFinite(Number(q?.top)) && Number(q.top) > 0 ? Math.floor(Number(q.top)) : RECALL_TOP_DEFAULT,
        minScore: Number.isFinite(Number(q?.minScore)) ? Number(q.minScore) : 0,
        excludeIds: Array.isArray(q?.excludeIds) ? q.excludeIds : [],
        rippleIds: Array.isArray(q?.rippleIds) ? q.rippleIds : [],
        tickNow: q?.currentTick ?? null,
        rows: Array.isArray(q?.rows) ? q.rows : chronicleOf(ssot, q.volumes),
        audience: q.audience,
        volumes: q.volumes,
    });
    if (got?.report?.provenance && Array.isArray(q.provenanceReports)) q.provenanceReports.push(got.report.provenance);
    // ★交出去的**必须是编年行那个形状**（`{id,tick,text,…}`）——本层其余取法都是这个形状，
    //   消费者（`formatRecalled` / 包那一栏）按同一个形状读。`line` 是排好版的那一句，也一起带上。
    return (got?.items || []).map((it) => ({ id: it.id, tick: it.tick, text: it.text, ...(it.timeMark ? { timeMark: it.timeMark } : {}), line: it.line, score: it.score }));
}

const MODE_FNS = {
    [RECALL_MODES.RECENT]: modeRecent,
    [RECALL_MODES.BY_KEYWORD]: modeKeyword,
    [RECALL_MODES.BY_NAMES]: modeByNames,
    [RECALL_MODES.BY_VECTOR]: modeByVector,
};

/**
 * 拿什么去检索——**只用账上真有的字**（零编造）。
 * 有 `text` 用 `text`；否则用实体名 + 未决事件标题拼（与 `recall.js:42` 的既有口径同源）。
 */
export function buildQuery(ssot, { picks = null, text = '' } = {}) {
    if (text) return String(text);
    const byId = new Map((ssot?.entities || []).map((e) => [e.id, e]));
    const parts = [];
    const push = (s) => { if (s && !parts.includes(s)) parts.push(s); };
    for (const id of picks || []) push(byId.get(id)?.name);
    const open = (ssot?.events || []).filter((e) => !e.closed);
    for (const ev of open) push(ev.title);
    return parts.join(' ');
}

/** 把一段话切成词元（**不引分词器、不做词表判语义**：只取账上真有的连续中文段/数字/拉丁词）。 */
export function keywordsOf(text) {
    const out = new Set();
    for (const w of String(text || '').match(/[\u4e00-\u9fa5]{2,8}|[A-Za-z_]{3,}|\d+/g) || []) out.add(w);
    return [...out];
}

/**
 * ★★★「相关度」这条尺的**唯一出处**：这段查询里，**真的点出了账上哪些钥匙**。
 *
 * 【为什么必须由本层给，不许消费方自己再算一遍】
 *   `modeByNames` 判"这一行相关"用的就是这份钥匙表（实体真名 ＋ 盘算目标原话）。
 *   消费方若自己重算一份 ⇒ **两把尺子**，迟早长歪（本仓老病，见 `limits.js` 头注那条"同一张表"）。
 *   ⇒ 本层把**它自己用的那份钥匙**如实交出去，消费方拿它做门槛 ⇒ 取数与校验同源。
 *
 * 【它治的病（leg133 实测）】预取回来的行**不保证真的相关**：
 *   真账 60 轮世界，严尺下（提到在场最靠前 5 人的真名）相关度只有 **94% / 92% / 87%**
 *   （预算 30000 / 12000 / 6000）⇒ 越紧越不相关，而不相关的那几行**照样占额度**。
 *
 * ★口径与 `modeByNames` 逐字一致（≥2 字的实体真名、≥4 字的盘算目标、长的排前），**不新立一把尺**。
 * @returns {string[]} 命中的钥匙（可能为空 ⇒ 说明这段查询一个账上真名都没点出来）
 */
export function matchedKeysOf(ssot, text) {
    const t = String(text ?? '');
    if (!t) return [];
    const hits = [];
    const seen = new Set();
    const push = (s) => { if (s && !seen.has(s)) { seen.add(s); hits.push(s); } };
    const ents = (ssot?.entities || []).map((e) => String(e?.name || '').trim())
        .filter((n) => n.length >= 2).sort((a, b) => b.length - a.length);
    for (const n of ents) if (t.includes(n)) push(n);
    for (const a of (ssot?.agendas || [])) {
        const g = String(a?.goal || '').trim();
        if (g.length >= 4 && t.includes(g)) push(g);
    }
    return hits;
}

// ---------- ★本笔（死码清理）：里程碑还原那一路（`includeArchive` → `fromMilestones`）也删了 ----------
// 它把 `milestones[].ids/titles` 还原成条目（`source: 'milestone'`、带 `archivedIn`、`ref` 指回事件 id），
// 口径是"**显式要才取**"（温层纪律）。删的依据同上面那条：**生产没有一处传 `includeArchive`**
// （`pack.js` 两处、`web/inject.js` 一处，全是显式列 `modes` 的短查询）⇒ 这个键改不动任何生产结果。
// ★要恢复：先确认有消费者，再照判据里那条"显式要了就要给"的夹具重做（连 `timeMarkAt` 那格一起）。

// ---------- 收口：一个批次 ----------

/**
 * ★检索层的**唯一入口**。
 * @param {object} ssot   世界账（调用方递进来；本层不自己去取任何东西）
 * @param {object} query  查询（见 DEFAULTS；`modes` 可以是字符串或数组，多方式是**并集**）
 *   · `recent`/`names` 按轮次新的在前；`keyword` 按命中词数、再按新旧；向量按相似度。
 *     （原来这里还写着"`cause`/`id` 是有向的、保留处理顺序"——那两种取法本笔删了。）
 *   · ★`limit` = 至多取几条，**默认 `null` 表示不限**；在各模式排序之后选取。
 *     真正的尺是 `maxChars`（字符预算）——条数不设上限是本仓血证（`entityUpdates ≤3` 那个静默闸）。
 * @returns {{ok:boolean, items:Array, reason:string, mode:string[], queryChars:number, total:number, matchedKeys?:string[]}}
 *   ★**永不抛**：任何异常都折成 `{ok:false, items:[], reason}`（纪律②）。
 *   ★★★leg133：`matchedKeys` = 这段查询**真的点出了账上哪些钥匙**（见 `matchedKeysOf`）——
 *     它只在真取到时给；消费方拿它当"相关度"门槛（没点出真名的行不许进包）。
 *   ★`reason` 三态可分（纪律③）：
 *     · `''`            = 真取到了；
 *     · `'没命中：…'`    = **检索跑了**，但这个查询取不到东西；
 *     · `'没在检索：…'`  = **压根没跑**（账空 / 方式不认识 / 查询是空的）——这两者必须分得开。
 */
export function recallLedger(ssot, query = {}) {
    const q = { ...DEFAULTS, ...query };
    q.provenanceReports = [];
    const modes = (Array.isArray(q.modes) ? q.modes : [q.modes]).filter(Boolean);
    const out = { ok: false, items: [], reason: '', mode: modes, queryChars: 0, total: 0 };
    try {
        if (!ssot || typeof ssot !== 'object') { out.reason = '没在检索：账没递进来'; return out; }
        const unknown = modes.filter((m) => !MODE_FNS[m]);
        if (unknown.length) { out.reason = `没在检索：不认识的方式 ${unknown.join('/')}（可取：${Object.keys(MODE_FNS).join('/')}）`; return out; }

        // ★本笔（死码清理）：这里原来先建两张表（`archivedById` + `eventsById`）再取数，供那四种
        //   被删的取法跨归档用。表没了，取数直接吃 `q`（`volumes` 那一格照旧）。
        const seen = new Set();
        let seq = 0;
        const items = [];
        for (const m of modes) {
            const got = MODE_FNS[m](ssot, q);
            const bucket = [];
            // ★去重按"这一条是谁"（编年行有 id；事件有 id）——同一件往事被两种方式取到只留一份。
            //   去重放在**排序之前**：先按方式的先后认领（消费者写的顺序就是它的优先级），
            //   再在每一种方式**内部**排序 ⇒ 两种效果不互相打架。
            for (const it of asItems(got)) {
                const key = it?.id != null ? String(it.id) : `${m}:${String(it?.text ?? it?.title ?? '')}`;
                if (seen.has(key)) continue;
                seen.add(key);
                bucket.push({ it, newness: newnessOf(it), seq: seq++ });
            }
            // ★平铺型：轮次新的在前（并列时"先取到的"在前，保证同一份账每次结果都一样）
            if (MODES_SORTED.has(m)) {
                bucket.sort((a, b) => {
                    const na = a.newness === null ? -Infinity : a.newness;
                    const nb = b.newness === null ? -Infinity : b.newness;
                    return nb - na || a.seq - b.seq;
                });
            }
            for (const b of bucket) items.push(b.it);
        }
        // 条数闸默认不限；按各模式的选择顺序截取，关键词匹配不会再被新旧覆盖。
        const filtered = q.audience === 'chat' ? filterChatRecords(ssot, items, { volumes: q.volumes, rows: q.rows }) : null;
        if (filtered) out.provenance = filterChatRecords(ssot, [...filtered.report.records, ...q.provenanceReports.flatMap(report => report.records || [])], { volumes: q.volumes, rows: q.rows }).report;
        const eligible = filtered ? filtered.items : items;
        const maxItems = Number.isFinite(q.limit) && q.limit >= 0 ? q.limit : Infinity;
        const capped = maxItems < eligible.length ? eligible.slice(0, maxItems) : eligible;
        out.total = capped.length;

        // 字符预算：★只按预算切，不设条数上限（本仓血证：`entityUpdates ≤3` 那个静默闸）
        const kept = [];
        let chars = 0;
        // ★★★leg118：**`maxChars: null` = 不设字符上限**——与上面那一格 `limit` 的"不限"对齐。
        //   病（leg118 实读 + 细案 §3.2）：原来只有 `Number.isFinite` 一条路 ⇒ 传 `Infinity` **不是"不限"，
        //   是掉回出厂 6000**（`Infinity` 不是有限数，`Number.isFinite` 假）。而本仓口径是
        //   "上限只认包的总预算"（leg113 §3.4）⇒ 消费方**必须能表达"别在这里切"**。
        //   ★为什么非有不可：世界模型那一栏（`pack.js` 的 `纪事`）就是"不设上限、只认包预算"那一条口径的
        //     ——它接上本层的第一天就会撞上这个默认值（6000 字符 ≈ 只装得下 150 条，而真账那一栏是 258 条）。
        //   ★旧行为零扰动：没人传 `null` 时走的还是原路（`limit` 那一格早就是 `null` = 不限的口径）。
        const maxChars = q.maxChars === null
            ? Infinity
            : (Number.isFinite(q.maxChars) ? q.maxChars : DEFAULTS.maxChars);
        for (const it of capped) {
            const len = String(it?.text ?? it?.title ?? it?.goal ?? '').length;
            if (kept.length && chars + len > maxChars) break;
            kept.push(it); chars += len;
        }
        out.items = kept;
        if (filtered) out.provenance.selectedIds = kept.map(it => String(it?.id ?? ''));
        out.queryChars = chars;
        if (!kept.length) {
            out.reason = items.length
                ? `没命中：取到 ${items.length} 条但字符预算放不下第一条`
                : `没命中：账上 ${chronicleOf(ssot, q.volumes).length} 行编年里，方式 ${modes.join('/')} 一条都没取到`;
            return out;
        }
        out.ok = true;
        // ★★★leg133：「相关度」那把尺的钥匙随结果一起交出去（见 `matchedKeysOf` 头注）——
        //   消费方（`pack.js` 的预取）拿它做门槛：**没点出账上真名的行，一条都不许进包**。
        out.matchedKeys = matchedKeysOf(ssot, q.text);
        return out;
    } catch (err) {
        out.ok = false; out.items = []; out.reason = `没在检索：取数时抛错（${String(err?.message || err)}）`;
        return out;
    }
}

// ---------- 消费者面：把批次排成给人/模型读的一段 ----------

/**
 * 把一批往事排成一段文本，**每一条都带时间印记**。
 * ★这一格就是本笔要治的病（用户原话：「聊天llm是不知道什么时候世界发生了什么事」）。
 * ★措辞纪律：**不出现引擎行话**（不说"盘算"「tick」「eventRef」——聊天模型没有这些概念），
 *   照 `tideLines()` 那条既有口径（它把账本腔重述成人话，读者是写正文的模型）。
 * @param {object} ssot
 * @param {Array}  items   `recallLedger(...).items`
 * @param {object} opts
 *   · `header`   默认 `true`：是否带那一行标题与末尾那句"括起来的是什么"的说明；
 *   · `showKind` 默认 `false`：是否在每条后面标出"这是什么话"（来路/经过/收场…）。
 *   ★字符预算**不在这里切**（切在 `recallLedger` 的 `maxChars`）——本函数只负责排版。
 * @returns {string} 空批次 ⇒ 空串（调用方据此"没有就不挂这一段"，与 `recalled` 同口径）
 */
export function formatRecalled(ssot, items, { header = true, showKind = false, volumes = null } = {}) {
    const groups = groupByTime(ssot, items || [], volumes);
    const lines = [];
    for (const g of groups) {
        if (g.tick === null) {
            // ★★leg118：轮次解不出来的那几条——**照印，并如实说清"不知道是第几轮"**。
            //   绝不因为"排不进时间线"就沉默（那正是这一处原来的病：静默丢 50 条还报成功）。
            lines.push('【账上没记它在第几轮——这一条只说得出"发生过"，说不出"什么时候"】');
        } else {
            const timeBits = [];
            timeBits.push(`第 ${g.tick} 轮`);
            // ★只摆原话，不做累加（红线 §2.2 第 1 条：不许把词换算成数）
            if (g.time.known) timeBits.push(`那一轮此后又过了：${g.time.elapsed}`);
            else timeBits.push('（这一轮的"过了多久"账上没记——正文里没写时长）');
            lines.push(`【${timeBits.join(' · ')}】`);
        }
        for (const it of g.items) {
            const line = recalledLineText(it);
            if (!line) continue;
            const kind = showKind && it?.text ? `（${KIND_LABEL[chronicleKindOf(it)]}）` : '';
            lines.push(`${line}${kind}`);
        }
    }
    if (!lines.length) return '';
    const body = lines.join('\n');
    if (!header) return body;
    return `【世界已经发生的事 · 按发生先后排】\n${body}\n`
        + `（★括起来的那一行是**引擎轮次**，后面的"此后又过了"是**写正文的人自己当时写的时长原话**——`
        + `引擎照抄、不做累加，你觉得需要算就算一下。）`;
}

/** 从一条往事里取出"给人读的那句话"（编年行取 `text`；事件取标题；盘算取目标）。 */
export function plainTextOf(item) {
    if (!item || typeof item !== 'object') return '';
    if (typeof item.text === 'string' && item.text) return item.text;
    if (typeof item.title === 'string' && item.title) return item.title;
    if (typeof item.goal === 'string' && item.goal) return item.goal;
    return '';
}

/**
 * ★★★leg198：**"一行往事长什么样"的唯一一处拼法**。
 * 为什么必须只有一处：**量额度那一侧**（`web/inject.js` 的 `sizeOf`）与**印出来那一侧**
 *   （本文件的 `formatRecalled`）此前是**两把尺子**——量的是"剥掉机器块之后的长度"、
 *   印的是**原文** ⇒ 玩家填 1600 字，真塞进去的可能是 2600 字（"一个数两把尺子"是本仓付过账的形状）。
 * 口径：**量什么就印什么**——两侧都走这一个函数。
 */
export function recalledLineText(item) {
    const text = plainTextOf(item);
    return text ? '  · ' + text : '';
}
