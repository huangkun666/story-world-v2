// story-world-v2/src/chronicle-brief.js
// ★★leg113（用户 2026-09-22 拍板「B2 编年进包」）：**把账上的编年"过滤"成给世界模型看的往事**。
//
// 【为什么要有这个模块】——病是量出来的，不是想出来的（真账 `大荒z` tick 60 · 只读副本）：
//   模型每轮拿到的那份包（`pack.js`）里**一行编年都没有**，于是它**每轮失忆**：
//   · 账上 **32** 件已收场的事，只递进去 **8** 件（`recentClosedEvents` 的尾巴）；
//   · 全账 **19/54** 件事件的"来路"指向一件**包里任何一栏都没有**的事。
//   ★根因：`settle.js` 的 `archiveClosedEvents` 把「收场满 20 轮且整链结清」的**事件**压成里程碑搬走，
//     **而编年行不归档**（编年只在 500 轮 / 5MB 才前置段入卷）⇒ **编年是"那时候到底发生了什么"的唯一存本**。
//   ★实测（同一份账）：来路在包里查不到的那 **29** 件事，**29 件全都能在编年里找回（100%）**。
//
// 【口径：只搬，不改写】（用户拍板"窄口"）
//   把编年**过滤**一遍就递过去，**编年本身一个字不改**（不改落账措辞、不动旧账）。
//
// 【收哪些、弃哪些】（真账 373 行的实测分类；**判据锚在"行首"**，理由见下）
//   收 249 行：
//     · **来路话**   170 行  `「X」——沿「Y」而来` / `由盘算「Y」而生`（编年独有，救回断掉的因果链）
//     · **经过话**    71 行  `盘算「X」推进：…`（编年独有：模型自己上轮写的"这一步干了什么、代价是什么"）
//     · **收场得失**   8 行  `盘算「X」取消（谁）：理由…` + `事件「X」这一段收场了：理由…`（★见下"关键约束"）
//   弃 124 行（格式化记账，语义为零）：
//     · 满步结算 24 · 涟漪平息 43 · 引擎通用闭环 49 · 入局离场 8
//
//   ★★**关键约束（漏了就是半死的闸）**：`pack.js:872` 记着一条既有事实——
//     「账上没有结局字段：`settle.js` 把"结清/变形/取消"写进了**编年文本**，盘算上不存」。
//     ⇒ 所以**只许弃"格式化的机械记账行"，必须留住"带理由的收场话"**——否则本模块会把这条信息
//       在包里**彻底抹掉**（比不做更坏）。这就是上面"收场得失 8 行"必须单列一类的原因。
//
//   ★**为什么判据锚在"行首"而不是"扫关键词"**（这是我第一版写法，实测被证伪）：
//     第一版用 `如果不含"闭环"就…` 这类**全行扫描**，它把
//     `盘算「X」取消（谁）：…独吞灵脉的计划彻底破产` 判成了"其它"——因为**理由里那个词**命中了规则。
//     实测两种写法**判得不一样的有 5 行**（全是必须保住的"收场得失"）。
//     ⇒ **口径**：一律用**锚在行首**的模板形状判（`^盘算「»…` / `^事件「…`），
//       理由就在**账上真名的位置**（`「」` 里），不会被名字或理由里的词干扰。
//
//   ★本模块是**零 import 的真叶子**（仓里有判据锁着这一类，先例 `panorama.js`/`render-base.js`/`tag-extract.js`）：
//     实测**编年文本在落账那一刻就已经是"名字"**（`settle.js:103` 的 `entityName()` 在 push 前就把 id 渲染成名；
//     真账 373 行里**含机器号的只有 1 行**）⇒ **不需要搬 `panorama.js` 的 `stripEngine`/`resolveIds` 来洗号**。

/** 编年行类型（判据与面板共用；**锚在行首**，不用全行扫描——见文件头那段证伪）。 */
// ★★★leg117：**这一张表是全仓唯一的"编年行是什么话"判据表**（用户 2026-09-23 拍板把两张合成一张）。
//   病（本笔实测）：取往事当时有**两条路、两张表**——
//     · 本模块（世界模型那侧）：认 4 类，弃机械记账；
//     · `ledger-recall.js`（聊天模型那侧）：**自己又抄了一份**（原文写着"本层自己认一遍"），认得略不同。
//   后果（**当场测出来的真分叉**）：「事件「X」涟漪平息（链源已了结）」这一行
//     本模块判 `LEDGER`（**弃**）、检索层判 `other`（**收**）——同一件世界事实，两个消费者被告知了
//     **不同的"什么算往事"**。⇒ B2（世界模型接检索层）一接就会长成**三份** ⇒ 必然分叉。
//   ⇒ 统一到这一张表：**取数是检索层的事，认"这是什么话"是这一张表的事**，两处共用。
//     ★消费者**收不收**仍然各管各的（本模块弃 `LEDGER`；检索层全收、由调用方筛）——
//       共用的是分类，不是取舍。
export const CHRONICLE_BRIEF_KINDS = Object.freeze({
    CAUSE: 'cause',       // 来路话（这件事因何而起）
    STEP: 'step',         // 经过话（这一步做了什么）
    OUTCOME: 'outcome',   // 收场得失（带理由）——★必须留住：账上没有结局字段
    LEDGER: 'ledger',     // 机械记账（**唯一被弃的那一类**）
    OTHER: 'other',       // ★认不出的（与 LEDGER 分开：一个"读不懂"，一个"读懂了但不值钱"）
});

// 行首模板（全部来自 `settle.js` 的 chronicle.push；改模板必须同批改这里）
// ★★★leg117 实测（本笔踩到并修好的）：下面几条的**形状要认两种**，少认一种就出事——
//   ① **真账模板**：`事件「标题」——由世界处境而生，…`（`settle.js:787` 落账时前缀是**事件「」**）；
//   ② **裸短语**：`——由世界处境而生，…` / `由世界处境而生，…`（`chronicleEvents` 里的
//      `eventSourcePhrase` 单独看就是这个形状；本仓判据夹具也按这个形状写）。
//   ★原来的 `RE_CAUSE_EVENT` 只认 ② ⇒ **在真账上一条都匹配不上**，那些来路话是靠
//     "认不出就收"的兜底**碰巧**当上来路的（结论对、理由是错的，改一条规则就会翻车）。
//   ⇒ 两条路都写出来，**不是"放宽"，是把漏掉的那条补上**（出包内容逐行不变，见交接 §3 的验收）。
const BARE_CAUSE_HEAD = String.raw`(?:——)?(?:由世界处境而生|沿「|由盘算「)`;
const RE_SETTLE = /^盘算「[^」]*」满步结算/;                    // settle.js:636 一族（满步结算：结清/变形/…）
const RE_RIPPLE_QUIET = /^事件「[^」]*」涟漪平息/;               // settle.js:362（链源已了结 / 这一段没人接着长了）
const RE_CLOSE_ENGINE = /^事件「[^」]*」闭环/;                   // settle.js:348（源盘算已结算）
const RE_CLOSE_MODEL = new RegExp(`^(?:事件「[^」]*」)?这一段收场了`);   // settle.js:395（★模型给的理由，必须留住）
const RE_FLOW = /^「[^」]*」(?:入局（|淡出视野|复归（|覆灭（)/;   // settle.js:886/1063/1033/924
const RE_OUTCOME = /^盘算「[^」]*」(?:取消|结清|变形)/;          // settle.js:555/564 一族（带理由）
const RE_STEP = /^盘算「[^」]*」推进：/;                        // settle.js:592
const RE_CAUSE_EVENT = new RegExp(`^(?:事件「[^」]*」)?${BARE_CAUSE_HEAD}`);   // settle.js:784 一族（两种形状都认）
const RE_CAUSE_AGENDA = /^(?:因事而生：|由处境而生：|由委派而生：)/;  // settle.js:502/505/511

/** ★判据表（**唯一一份**）：认得出就是认得出，认不出归 `OTHER`——★它与 `LEDGER` 是两件事：
 *   `LEDGER` = 读懂了、但语义为零（机械记账，本模块弃）；`OTHER` = 读不懂（**照收不删**，"宁缺勿造"的对偶）。
 * ★判**行首模板**，不扫关键词：理由里出现"结清/闭环"这类词**不许**影响判定（血证见 J1b）。 */
const KIND_RULES = [
    // ★顺序要紧（两条都是实测踩出来的，别随手调）：
    //   ① **来路排在收场之前**：`RE_CAUSE_EVENT` 认的是 `事件「…」——沿「…」而来`，而 `RE_CLOSE_MODEL`
    //      认的是 `事件「…」这一段收场了`——同一族行首，靠"破折号 vs 这"分开。
    //      ★本笔第一版把收场放最前 ⇒ 那种带 `——` 的来路话被抢走（回归是拿"合并前输出"逐行比对抓出来的）。
    //   ② **收场（模型给的理由）排在机械记账之前**：理由那条必须赢，否则模型的理由被当记账丢掉（旧注释原话）。
    [RE_CAUSE_EVENT, CHRONICLE_BRIEF_KINDS.CAUSE],
    [RE_CAUSE_AGENDA, CHRONICLE_BRIEF_KINDS.CAUSE],
    [RE_CLOSE_MODEL, CHRONICLE_BRIEF_KINDS.OUTCOME],
    [RE_OUTCOME, CHRONICLE_BRIEF_KINDS.OUTCOME],
    [RE_STEP, CHRONICLE_BRIEF_KINDS.STEP],
    [RE_SETTLE, CHRONICLE_BRIEF_KINDS.LEDGER],
    [RE_RIPPLE_QUIET, CHRONICLE_BRIEF_KINDS.LEDGER],
    [RE_CLOSE_ENGINE, CHRONICLE_BRIEF_KINDS.LEDGER],
    [RE_FLOW, CHRONICLE_BRIEF_KINDS.LEDGER],
];

/**
 * 这一行是什么话？返回 `CHRONICLE_BRIEF_KINDS` 里的一个。**全仓唯一一份**（见上面 `KINDS` 头注）。
 * ★空行/非字符串 ⇒ `LEDGER`（当作"没有语义"处理——与"读不懂"（`OTHER`）分开）。
 */
export function chronicleBriefKind(line) {
    const t = String(line?.text ?? '');
    if (!t) return CHRONICLE_BRIEF_KINDS.LEDGER;
    for (const [re, kind] of KIND_RULES) if (re.test(t)) return kind;
    return CHRONICLE_BRIEF_KINDS.OTHER;
}

export function isChronicleBriefLine(line) {
    // ★只弃 `LEDGER`（机械记账）；`OTHER`（认不出）**照收**——"宁可多带一句，不可丢一段往事"
    return chronicleBriefKind(line) !== CHRONICLE_BRIEF_KINDS.LEDGER;
}

/**
 * 把一行编年洗成给模型看的一句（**只去固定前后缀，不改写事实**）。
 * ★与 `panorama.js` 的 `stripEngine` 分工不同：那个是给**玩家看的面板**洗（连"盘算/事件"这些内部词都去掉），
 *   本函数是给**世界模型**洗——内部词照留（模型读得懂，它自己也在写这类字），只去掉"事件「」/盘算「」"这类包装。
 */
export function briefLineText(text) {
    let t = String(text ?? '').trim();
    t = t.replace(/^事件/, '').replace(/^盘算/, '');          // 行首那两个字（锚定，不扫全行）
    t = t.replace(/满步结算[：:]?/g, '');
    t = t.replace(/[（(]源盘算已结算[）)]/g, '（已了结）');
    t = t.replace(/[（(]链源已了结[）)]/g, '（已了结）');
    t = t.replace(/[（(]这一段没人接着长了[）)]/g, '（没人接着长了）');
    t = t.replace(/[（(]期满收摊[^)）]*[）)]/g, '（已了结）');
    t = t.replace(/[（(]久未现身[）)]/g, '');
    return t.replace(/\s{2,}/g, ' ').trim();
}

/**
 * 出包用：把账上的编年过滤成"往事"一栏。**纯函数、输入不可变**。
 * @param {object} ssot 世界账
 * @returns {Array<{tick:number,text:string}>} 按轮次升序（编年本来就是只往后加的顺序，这里不改它）
 * ★不设条数/轮数上限：上限只认**包的总预算**（`trimPack` 会从最旧的整条丢）。
 *   理由（本仓刚流过血）：`entityUpdates 每轮 ≤3` 就是"一个没量过的提案态数字在当家、还静默拦"，
 *   2026-09-22 用户拍板直接取消 ⇒ **同一个坑不跳第二次**。
 * ★★★leg118 起：**生产里已经不再调它**——世界模型那一栏改向检索层要了（`pack.js` 的 `fetchChroniclePast`），
 *   为的是"世上只剩一条取往事的路"（用户那条硬约束「检索得到的和进包的不能重复」只能靠一栏一源守住）。
 *   ★它**不是死代码**：它现在的身份是**判据里的对照尺**——`test/chronicle-brief.test.js` 的 J9 拿它
 *     跟新路逐行比（两条路互相独立 ⇒ 谁单方面改坏一条，那条判据当场红）。这是本仓的老办法：
 *     **"我觉得等价"不算证据，"逐行相同"才算**（leg117 的原话）。
 */
export function chronicleBrief(ssot) {
    const rows = Array.isArray(ssot?.chronicle) ? ssot.chronicle : [];
    const out = [];
    for (const line of rows) {
        if (!isChronicleBriefLine(line)) continue;
        const text = briefLineText(line?.text);
        if (!text) continue;                       // ★空着就是空着：洗空了就不挂这一行（不占位、不补字）
        out.push({ tick: Number.isFinite(line?.tick) ? line.tick : 0, text });
    }
    return out;
}
