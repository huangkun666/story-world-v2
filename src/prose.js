// story-world-v2/src/prose.js
// ★★★leg200（2026-10-05 用户令）：**"剥什么"从此由玩家的两份名单说了算**——
//   黑名单＝要剥掉的名字；白名单＝只留这些、其余信封全剥（过滤最重那一档）。
//
// ＝＝ 为什么改（用户当场报的病 ＋ 他自己的裁法）＝＝
//   leg198 给这一层加了"**剥掉 HTML 注释**"，理由是按结构判（注释不是正文）。
//   用户 2026-10-05 报：「**正文有时也会包裹在html注释，所以不能这样**」——
//   有的卡就是拿注释当正文的容器，一刀切把注释全剥掉会把正文本身剥走。
//   他的裁法（逐字）：「**提取正文时采用白名单和黑名单机制，这俩名单由用户自己设置，
//   白名单过滤程度最重代表只留这个名单，黑名单则代表过滤这个名单**」。
//
// ＝＝ 口径（三条，写死免得下一任改歪）＝＝
//   ① ★**名单由玩家填，插件一个内置词都没有** ⇒ 与红线 §4.8（禁"用词表判语义"）不冲突：
//      那一条禁的是**插件拿内置词表替玩家判语义**；这里是玩家点名、插件只照办、不猜。
//   ② **两个名单都空** ⇒ 回到"只按结构判"：**成对块照剥、HTML 注释不剥**
//      （＝用户说的"不能杀光注释"；成对块那半是 leg136 实测曲线靠着的，不许顺手改）。
//   ③ **两个都填** ⇒ **白名单优先**（它过滤最重：只留点名的，其余信封全剥）。
//
// ＝＝ 名字怎么匹配（两行名字，一行一条）＝＝
//   · **成对块**：写**标签名**——`<角色手机>…</角色手机>` ⇒ 名单里写 `角色手机`。逐字相等（去空白）。
//   · **HTML 注释**：注释**没有名字** ⇒ 写**它开头那几个字**——
//     `<!--抢话自查: 本段描写甲的反应-->` ⇒ 名单里写 `抢话自查`（**前缀匹配**）。
//
// ＝＝ 一条边界（照旧，不许撤）＝＝
//   ★**剥完是空的就退回原文**：万一某张卡把正文整个包在成对块里，剥完就没有字了
//     ⇒ 那时退回原文 ＝ 退化成"不剥"，不会比不剥更坏。
//
// ＝＝ 一处定义、两处消费者（都只吃这一个函数）＝＝
//   · **找旧事的查询串**（`web/inject.js`）：这一层**只剩它一个消费者**了（见下）；
//   · ~~提取那一趟~~（`src/tick.js`）：★**leg200 起不剥了**——见文件末那条留档。
//
// ＝＝ 实测曲线（查询串那一侧的，原文留在 `web/inject.js` 的调用点旁）＝＝
//   ★逐轮模拟 190 轮实测：**空手 67 轮（35.3%）**；把机器块剥掉之后 ⇒ **空手 25 轮（13.2%）**，
//     有货轮次平均从 1038 字涨到 2105 字。**一个改动，不动任何闸。**

/**
 * 把玩家填的名单文本解析成条目表（一行一条；逗号也认；去空白、去重、保序）。
 * @param {string|string[]|null|undefined} raw 名单原文（面板那两个框里填的东西）
 * @returns {string[]}
 */
export function parseProseList(raw) {
    const parts = Array.isArray(raw) ? raw : String(raw ?? '').split(/[\n\r,，、]/);
    const out = [];
    for (const p of parts) {
        const s = String(p ?? '').trim();
        if (s && !out.includes(s)) out.push(s);
    }
    return out;
}

/**
 * 剥掉机器块之后的正文。
 *
 * @param {string} text 一条正文
 * @param {{black?: string|string[], white?: string|string[]}} [opts]
 *   `black` = 黑名单（要剥掉的名字）· `white` = 白名单（只留这些，其余信封全剥）。
 *   ★两个都空 ⇒ 成对块照剥、注释不剥（见头注口径②）。
 * @returns {string} 剥掉机器块之后的正文（剥空了 ⇒ **原样返回**）
 */
export function proseOnly(text, { black = '', white = '' } = {}) {
    const s = String(text ?? '');
    if (!s) return '';
    const blackList = parseProseList(black);
    const whiteList = parseProseList(white);
    const whiteMode = whiteList.length > 0;          // ★白名单优先（过滤最重那一档）
    const blackMode = !whiteMode && blackList.length > 0;

    // 成对块：`<名 …>…</名>`（反向引用 `\1` 保证同名；非贪婪 ⇒ 不跨块吃太多）
    //   ★名字那一格是"`<` 与 `>` 之间不含空白与斜杠的那段字"——**结构判，不是标签名清单**
    //     （leg198 放宽到中文名：社区那类块就叫 `<角色手机>`）。
    const afterBlocks = s.replace(/<([^\s/>]+)[^>]*>[\s\S]*?<\/\1\s*>/g, (m, name) => {
        const strip = whiteMode ? !whiteList.includes(name) : (blackMode ? blackList.includes(name) : true);
        return strip ? ' ' : m;
    });
    // HTML 注释：`<!-- … -->`。★默认**不剥**（leg200）；点名了才剥（黑名单）／没点名才剥（白名单）。
    const out = afterBlocks.replace(/<!--[\s\S]*?-->/g, (m) => {
        const body = m.slice(4, -3).trim();                       // 去掉 `<!--` 与 `-->`
        const hit = (list) => list.some((e) => body.startsWith(e));
        const strip = whiteMode ? !hit(whiteList) : (blackMode ? hit(blackList) : false);
        return strip ? ' ' : m;
    });
    if (!out.trim()) return s;                                    // 边界：剥空 ⇒ 退回原文
    return out;
}

// ＝＝ ★★★leg200：**提取那一趟不再剥块了**（用户 2026-10-05 当场问出来的那条）＝＝
//   他的问题：「**提取tag的时候为什么要剥？难道正则提取不到tag？**」——答案是"**对，不需要**"：
//   `extractTags` 只扫 ` ```tags ` 围栏**里面的行**（`src/tag-extract.js` 的 `shellRange` ＋
//   `if (i < shell.start || i >= shell.end) continue`），**围栏外面一个字都不读**。
//   当初接上剥，靠的是两个理由，**现在两个都没了**：
//     ① leg198 那会儿提取还有"**块外逐行扫全篇**"那条降级 ⇒ 别人状态栏里一行 `【行动】` 会被当成真事
//        ⇒ 必须先把噪声剥掉。**leg199 把那条降级删了**（没有块 ⇒ 零收获）。
//     ② "**值必须在正文里找得到**"那条校验要一份底本（`settle.js` 的 `registerDialogueFacts`）
//        ⇒ ★用户 2026-10-05 令「**不要搞这个校验了**」，同批撤掉（它是恒真式，见那边留档）。
//   ⇒ 提取那趟的剥块**只会帮倒忙**：标签块要是住在别人的信封里，会被连信封一起剥掉
//     （旧代码为此专门立过一条"保围栏"边界去救它）。**现在那一整条边界随消费者一起消失。**
//   ★剥真正有用的地方**只有一处**：检索查询串（leg136 实测 空手率 35.3% → 13.2%）——
//     那里剥掉别人的机器块，查询串才干净。**名单机制就装在这一处。**
