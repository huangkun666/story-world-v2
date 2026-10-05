// story-world-v2/src/init-source.js
// 第十八棒：初始化设定源合订（编排层助手 · 纯函数 · 零引擎状态）
// 背景：K38 的「换源+worldBook 存储」机制被用户（正确地）判死刑——本文件不再有任何
// worldBook 概念：设定源只有两条自动路 = 世界信息/卡内置世界书条目 + 角色卡四件套。
//   - 世界书：完整来源按稳定身份收集；不同来源的相同正文分别保留。
//   - 卡件四件套：按 v1 spend() 同款逐字段预算（散文介绍，非世界书）。
// ★★leg60 修订上面那两句（原文写"禁用标记跳过"，现在只对了一半，照旧读会读错）：
//   **禁用条目不再一律跳过**——ST 生态里"禁用"常常是作者的**仓储**（条目关掉、由控制器脚本
//   `getwi(...)` 按需取）。现在的口径分两层：
//     · 启用条目：全量进（原样）；
//     · 禁用条目：**只进"作者点名过的"那部分**——由 `probeBook` 的纯函数判据选出
//       （恒注入壳声明的目录 + "自成一套"的壳声明的料），零散实例（一人一条的人物档案）不进，
//       未读取正文不从题名旁路补回；默认合法声明和自选均由统一来源入口决定。
//   实测：三国 827 条里 563 条禁用 = 全书的 81%；旧口径下引擎只看得到 18.9%（名册只能从 JS 里捞名字）。
// 分层归属：编排层（只组文本，不落账不结算）。防御上限提案态（铁律 2，随报批）。
//
// ★★★leg148：**条目原文里的酒馆宏由本文件换成真名**（`{{user}}` → 人设名、`{{char}}` → 角色名）——
//   机制、病灶与"为什么必须在源头换"⇒ `src/macros.js` 头注。一句话：**酒馆的宏不该变成世界里的人**。
import { substituteMacros } from './macros.js';
import { prepareAbstractEntry, abstractEntryKey, abstractEntryTitle } from './abstract-source.js';
import { collectAbstractSources, resolveAbstractSources, probeAbstractDeclarations, characterFieldText, CHARACTER_SOURCE_FIELDS } from './abstract-input.js';
import { entrySelectionId } from './abstract-selection.js';

export const INIT_PIECE_CAPS = {          // 卡四件套各自上限（字符 · 提案态 · v1 spend 同款）
    description: 1200,
    scenario: 800,
    personality: 800,
    first_mes: 400,
};

export const INIT_SOURCE_HARD_CEILING = 500000; // 防御性总上限（字符 · 提案态）：世界书全量，仅超现实量级才拦

// 码点级截断（CJK 不破字；仅用于卡件 spend）
function clip(str, n) {
    const a = Array.from(String(str ?? ''));
    return a.length <= n ? a.join('') : a.slice(0, n).join('');
}

// ★★（Task 1 复查项 2）：预算切点。**先量出"实际用料前缀"**（条目 → 声明面 → 卡件），
//   题名候选与一切下游证据只许来自这个前缀——预算外的来源连"给题名自证"的资格都没有。
function ceilingCut(parts, ceiling) {
    let total = 0;
    let count = 0;
    for (const part of parts) {
        const len = Array.from(String(part)).length;
        if (total + len > ceiling) break;
        total += len;
        count += 1;
    }
    return { count, total };
}

export function normalizeEntryKey(e) {
    // ★第二十五棒 e（五）：主键取值必须**处理数组**——ST 形状里 `e.key` 常是数组（`["九宸玄陆","世界总纲",…]`），
    //   旧法 `String(e.key ?? …)` 会把它变成一长串逗号连接 ⇒ 同一本书的"世界书侧"与"卡内置侧"行**不可能相同**
    //   ⇒ 去重**完全失效**（实测交集 0）⇒ 同一本书被送进抽取两遍（424 条 / 499,526 字符，顶到 50 万防御上限）。
    return abstractEntryKey(e);
}

// ★★leg60：**送进抽取的标签用「题名」，不用触发词**。
//   病灶（两本真书都中，逐条量过）：
//     `normalizeEntryKey` 取的是 `key[0]`，而 ST 的 `key` 是**触发词表**（"什么时候该注入这条"），
//     **不是"这条叫什么"**。于是模型看到的标签是：
//       三国 `【吕氏】人物档案：吕玲绮…`（题名 `吕玲绮`）· `【貂蝉】`（题名 `貂蝉人设控制`）· `【张鲁】`（题名 `控制器_张鲁`）
//       大荒 `【九宸玄陆】`（题名 `世界总设定`）· `【境界】`（题名 `战力准则`）· `【人族】`（题名 `人族天赋与体质`）
//     ⇒ **作者亲手写的题名（`控制器_张辽` / `战力准则` / `大荒堪舆志：五洲疆域与万族生态`）一个字都没进过抽取**。
//   更糟的一格：`key=[]` 的 15 条（三国 `[mvu_update]变量更新规则`/`声誉`/`剧本背景控制`…）直接落到 uid
//     ⇒ 模型看到的是 `【36】`、`【15】` 这种**纯数字**（实测：三国 15 条 / 大荒 15 条）。
//   口径：**题名（ST 的 `comment`）优先 → `name` → 触发词兜底 → uid 最后**。
//     判据是"作者给这条起的名字"，与本书方言无关（卡内置书条目同样有 `comment`）⇒ 泛用。
//   ⚠**去重身份一个字不改**（`normalizeEntryKey` 仍管 `fpOf` 的"键+正文"）：
//     那是另一件事（同一本书被卡与书两条路取到只算一次），别顺手一起动——本仓"一字段一义"。
function labelOf(e) {
    return abstractEntryTitle(e);
}

// ★★★leg148：**条目里不许留着酒馆的宏**（病灶与"三道关口为什么都拦不住它" ⇒ `src/macros.js` 头注）。
//   为什么替换这一步必须在**送进抽取之前**（而不是在账上事后擦）：宏换成真名之后，抽出来的名字
//   **就是玩家真名**，而 `web/index.js` 的 `namePlayerPiece`（认领棋子那把尺子）只比名字相不相等
//   ⇒ 它当场认领，棋子与实体**合成一个**。在账上事后擦就只能靠"猜哪个实体是玩家"——那是不许做的事。
//   ★替换**只在 `composeInitSource` 产出文本那一层做一次**（见那里的头注）：
//     `labelOf` 那一族在探测期还要用来**配对**（壳声明的标题 ↔ 条目题名），两边口径必须一样，
//     只给一半加替换会让声明面整个配不上。⇒ 本文件内部一律读原文，**出口才换**。
function macroSub(text, macroNames) {
    return macroNames ? substituteMacros(text, macroNames) : String(text ?? '');
}

// ★★（二次复查 Important 1）：**题名行的身份** = 「给出这条题名的来源题名 + 候选名号」。
//   正文里的题名行与最终名册候选要一一对应（见 `composeInitSource` 里的不动点剔除），用它做键。
function titleLinePair(from, name) {
    return `${from}\u0000${name}`;
}

function normalizeEntry(e, diagnostics = null) {
    if (!e || typeof e !== 'object') return null;
    const label = labelOf(e);
    const prepared = prepareAbstractEntry(e, { title: label });
    if (diagnostics) {
        diagnostics.excluded.push(...prepared.excluded);
        diagnostics.warnings.push(...prepared.warnings);
    }
    const content = e._sw2Resolved === true ? prepared.content : prepared.content.trim();
    if (!content.trim()) return null;
    return `【${label}】${content}`;
}

// ============ ★★leg60：声明面探测（纯函数 · 零模型 · 零 JS 执行 · 可判据锁） ============
// 病（真账实测，本条是本棒最贵的一处）：
//   **ST 生态里"禁用条目"常常是作者的仓储**——条目关掉（ST 自己的注入器不烧它），
//   改由**控制器脚本**在运行时按需取（`getwi(null,'张辽正史')`）。作者把整座图书馆关掉、靠脚本开抽屉。
//   而 `collectEntries` 一条不剩地跳过 `disable` ⇒ 引擎把图书馆整个扔了。
//   实测两本真书（逐条量过）：
//     三国  827 条里 **禁用 563 条**，正文 **850,282 字 = 全书的 81%**；被点名过的禁用条目 554 条 / 835,647 字
//           ⇒ 引擎只看得到 **18.9%**（且其中 43% 还是 JS 代码本身）⇒ 名册只能从脚本里捞名字（127 名）。
//     大荒  235 条里禁用 20 条（37,527 字 = 12%）⇒ 引擎看得到 **87.6%** ⇒ 名册 537 条、76% 带属性。
//   **这就是"三国名册跟大荒不是一个档次"的主因**（不是"只读头 3 万"——名册轮早就读全了）。
//
// 取料判据（★纯函数、零词表、与任何一本书的方言无关）：
//   ① **恒注入壳声明的目录**：壳 = 启用且正文（剥 JS 注释后）含取件调用；恒注入 = `constant === true`。
//      恒注入壳说的就是"这些**每一轮都要进**" ⇒ 编译期必读。
//      （三国 `剧本背景控制` 声明 28 个 `正史<年份>` = 50,190 字；大荒 `[ejs]阶段主线控制器` 声明 7 条 = 1,673 字。）
//   ② **"自成一套"的声明**：一个壳点名的标题**互相成族**（共享 2–3 字前后缀且 ≥3 条）⇒ 它声明的是一**套**
//      （体系表/世界观/分阶段剧本）⇒ 读。
//      只点名 1–2 条、且同类散落在**别的壳**里的 ⇒ 那是**实例**（一人一条人物档案，如 `张辽正史`）⇒ **不读**
//      （题名照样进名册与"未编译台账"，第 3 件自检会如实报）。
//   ★为什么不用"标题含'体系/规则/总纲'"这类判据、也不用"正文形态"判据：leg58 已经量过并否掉
//     （`docs/measure-leg58-canon-sampling.md`：人物档案与体系条目长得一样，都是"字段:值"清单）。
//     本判据看的是**声明的拓扑**（谁点了谁、点了几条、彼此成不成族），不是词、也不是正文长什么样。
//   ★实测（零模型）：三国 选中 188 条 / 309,133 字（含 4 条体系表：`演义战力体系`/`演义鬼神道德体系`/
//     `演义智谋内政体系`/`演义模糊地带处理准则`）；未选中 364 条 / 523,337 字（都是人物档案，题名仍进名册）。
//     大荒 选中 7 条 / 1,673 字 · re0 与实教世界书**没有壳** ⇒ 选中 0 条（走"启用集读全"那条路，零扰动）。
const FETCH_CALL_RE = /(?:getwi|getWorldInfo|getWorldInfoEntry|activewi|activateWorldInfo)\s*\(\s*(?:[^,()]*,\s*)?['"`]([^'"`\n]{1,80})['"`]/g;
const AFFIX_LEN = [2, 3];
const FAMILY_MIN = 3;

function allEntries(worldInfoEntries, character) {
    return [
        ...(Array.isArray(worldInfoEntries) ? worldInfoEntries : []),
        ...(character?.character_book?.entries || character?.data?.character_book?.entries || []),
    ].filter((e) => e && typeof e === 'object');
}
const isDisabled = (e) => e?.disable === true || e?.enabled === false;
const charsOf = (s) => Array.from(String(s ?? '')).length;

// 剥 JS 注释再抓声明：不剥的话，注释里的示例也会被当成声明（leg59b 踩过）
function stripJsComments(s) {
    return String(s).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1 ');
}

// ★★leg60：**题名即名册**（纯函数 · 零模型 · 零 token）——本棒治"名册比人家薄一半"的零成本一刀。
//   观察（真账实测）：作者**已经把 cast 写在题名里**了——
//     三国：`控制器_张辽`（×187）· `张辽正史`/`张辽演义`（×184/185）· `甄宓人设控制`（×32）
//     ⇒ 185 个人物，一个 token 都不用花就能列出来；而真账名册只有 127 条（模型在 JS 代码里捞名字捞不全）。
//   判据（三步，纯函数、零词表、与方言无关）：
//     ① **体例**：题名按 2–3 字前后缀做频次统计，频次 ≥3 的即为"书自己的体例"（leg59c 的题名系列信号）；
//     ② 剥掉体例字串，残余 R 即候选名号（长度 2–12、剥掉首尾分隔符）；
//     ③ ★**自证**：R 必须**被这本书自己当成一个名字用过**——它出现在某条条目的 `key`（ST 触发词）里。
//        为什么要自证：`控制器_世界观背景` 也能剥出 `世界观背景`、`正史159` 能剥出 `159`、
//        `貂蝉_阶段01_金簪藏锋` 能剥出 `01_金簪藏锋`——它们谁也没被作者当名字用过（不是任何 key）⇒ 全弃。
//        ★这不是我们列的词表，是**这本书自己的字段**说了算（与 leg23"照书办"同一条纪律）。
//   返回：[{name, from, why}]（保书序、去重）。**不带 kind**——题名判不出类别，别猜（类别的判据在
//   照书办的标签面与模型那一侧）；`applyDeclaredToRoster` 只在 kind 为真时才写这个键。
//   ★★（Task1 末次复查 Important 1 定稿）：题名例外**只有一档**——
//     `opts.titleOnlyEntries` = 「**题名与 key 都借给证据面**」的合法自动控制器例外：**它自己的题名行
//       真进了本次最终用料**（预算切点之内且没被剔），题名与自证 key 随那条题名副本一起生效。
//     ★没有这一档的条目（清理后只剩技术内容、题名行没进最终用料的壳）**一个字都不借**：
//       它们没有正文副本、没有题名副本 ⇒ 按"最终用料即唯一证据面"的合同，不属于本次材料，
//       自然也不许用自己的 key 去给别的候选自证（旧法那档 `keyOnlyEntries` 已删，别再补回来）。
//     ★为什么删（实测病灶）：同一份 `text` 与同一份 `effectiveEntries` 下，只改一条**根本没进正文**
//       的壳的 key，`titleRoster` 与书指纹就跟着变——作者自证必须来自本次真读到的材料。
//       丢掉"未经证实的元数据猜测"是正确的：模型读到的仍是已进正文的普通题名行。
//     不传这一档 = 与今天逐字节同形（纯函数契约不变）。
export function deriveTitleRoster(worldInfoEntries, character = null, { titleOnlyEntries = [] } = {}) {
    const entries = allEntries(worldInfoEntries, character);
    // ① 体例频次与 ② key 自证吃同一份证据面：「进了正文的来源 + 题名行真进了正文的控制器例外」。
    const asEntries = (list) => (Array.isArray(list) ? list : []).filter((e) => e && typeof e === 'object');
    const titleOnly = asEntries(titleOnlyEntries);
    const extraKeys = new Set(titleOnly);
    const frequencyEntries = [...entries, ...titleOnly];
    const worldTitles = new Set(entries.filter((e) => prepareAbstractEntry(e, { title: labelOf(e) }).content.trim()).map(labelOf));
    const raw = frequencyEntries.filter((e) => {
        if (extraKeys.has(e)) return true;                     // 控制器例外只借题名与 key
        const prepared = prepareAbstractEntry(e, { title: labelOf(e) });
        if (prepared.content.trim()) return true;
        if (prepared.technical) return false;
        // 控制器题名仍是作者给的名字依据，但必须确实取用本书的世界正文。
        const fetch = new RegExp(FETCH_CALL_RE.source, FETCH_CALL_RE.flags);
        return [...stripJsComments(String(e.content ?? '')).matchAll(fetch)].some((m) => worldTitles.has(m[1]));
    });
    const titles = [];
    const seenTitle = new Set();
    const keySet = new Set();
    const addKeys = (e) => {
        for (const field of [e?.key, e?.keys]) {
            for (const x of (Array.isArray(field) ? field : [field])) {
                const s = String(x ?? '').trim();
                if (s) keySet.add(s);
            }
        }
    };
    for (const e of raw) {
        // ★★★leg148：题名这一栏**只读原文**（不替换）——替换之后 `{{user}}正史` 会变成 `怪璃正史`，
        //   而**书里没有一个字叫「怪璃正史」** ⇒ 把替换后的题名当名号报上去，就是"凭空造了一个名号"
        //   （红线：只提取不创作）。纯宏题名的挡法在下游：`sanitizeCanon` 的形状闸 + 实体名的形状闸。
        const t = labelOf(e);
        if (t && !seenTitle.has(t)) { seenTitle.add(t); titles.push(t); }
        addKeys(e);
    }
    // ① 体例：2–3 字前后缀，频次 ≥ FAMILY_MIN
    const affixes = [];
    for (const L of AFFIX_LEN) {
        for (const kind of ['pre', 'suf']) {
            const g = new Map();
            for (const t of titles) {
                if (t.length <= L + 1) continue;
                const a = kind === 'pre' ? t.slice(0, L) : t.slice(-L);
                g.set(a, (g.get(a) || 0) + 1);
            }
            for (const [affix, count] of g) if (count >= FAMILY_MIN) affixes.push({ affix, kind, count });
        }
    }
    const out = [];
    const seen = new Set();
    for (const t of titles) {
        // ★只认"这本书的**主导体例**"：同一条题名常能被多个族匹配——`貂蝉演义` 既能剥前缀 `貂蝉`（×6）
        //   也能剥后缀 `演义`（×185）。**取族最大的那个**：主导体例才是作者给这一类立的规矩。
        //   不这么做会剥出"模式字"当名号（首版实测：三国的 `演义`、`正史` 被收进册——它们不是名字，
        //   只是**路由词**，而它们恰好也是 key，自证闸拦不住 ⇒ 必须靠体例大小这一刀）。
        const hits = [];
        for (const { affix, kind, count } of affixes) {
            if (kind === 'pre' ? !t.startsWith(affix) : !t.endsWith(affix)) continue;
            const rest = kind === 'pre' ? t.slice(affix.length) : t.slice(0, -affix.length);
            const name = rest.replace(/^[_·．.\-—–\s]+/, '').replace(/[_·．.\-—–\s]+$/, '');
            if (!name || name.length < 2 || name.length > 12) continue;
            hits.push({ affix, kind, count, name });
        }
        if (!hits.length) continue;
        const best = hits.reduce((m, h) => Math.max(m, h.count), 0);
        for (const h of hits) {
            if (h.count !== best) continue;
            if (seen.has(h.name) || !keySet.has(h.name)) continue;      // ③ 自证：书自己当过名字才收
            seen.add(h.name);
            out.push({ name: h.name, from: t, why: `题名「${t}」剥${h.kind === 'pre' ? '前缀' : '后缀'}「${h.affix}」（${h.count} 条）· 是本书的 key` });
        }
    }
    return out;
}

// ★★leg60（交接第 3 件）：**编译完整性自检**——"书里有多少条设定类条目 vs 本次编译覆盖了多少 ⇒ 漏了如实报"。
//   目的（交接原话）：有了它，以后"哪个体系没抽出来"**不用再靠翻磁盘对账**。
//   ⚠判据是**题名判据**（纯函数 · 零模型），而且**只用来报数、绝不参与取舍**——
//     哪些料进编译由 `probeBook` 的声明面判据（恒注入壳 + 自成一套）决定，**不看这张表**。
//     为什么必须写死这句话：leg58 量过"按标题含结构词挑料"这条路（`pickCanonSource`），结论是**挑不准**
//     （人物档案与体系条目长得一样、都是"字段:值"清单）⇒ 那条判据不许再参与决策；留在这里只当体检读数。
//   ★口径取**宽**（实测定的）：窄表（只认体系/规则/总纲…）在两本真书上只认出 7 / 22 条，
//     宽表认出 **12 / 28 条**——**报数用的表宁可宽**：窄了会把"漏"藏起来，而这条自检的全部价值就是"漏了如实报"。
//     两本真书的实况（可复核）：三国 827 条里设定类 **12 条，编译覆盖 12/12**——
//     剩下未编译的 366 条**全是人物档案**（`<人名>正史/演义`），那是名册类不是设定类（题名照旧进名册）。
const SETTING_TITLE_RE = /(体系|系统|规则|准则|设定|总纲|机制|谱系|世界观|法则|编年|史略|地理|地图|境界|品级|档位|数值|属性|指导|背景|全典|图鉴|制度|天条|铁律|戒律|禁忌)/;
export function compileCompleteness(worldInfoEntries, character = null, { compiledTitles = [] } = {}) {
    const compiled = new Set(Array.isArray(compiledTitles) ? compiledTitles : []);
    const settingTitles = [];
    const seen = new Set();
    for (const e of allEntries(worldInfoEntries, character)) {
        const content = String(e.content ?? '').trim();
        if (!content) continue;
        // ★★★leg148：这里**读原文标签**（*Entry 那一版）与 `composeInitSource` 收集 `compiledTitles`
        //   的口径**必须一样**——否则"编译覆盖 12/12"会变成两把尺子量出来的假读数。
        //   （这一族的替换只在 `composeInitSource` 产出文本那一层做，见那里的头注。）
        const t = labelOf(e);
        if (!t || seen.has(t) || !SETTING_TITLE_RE.test(t)) continue;
        seen.add(t);
        settingTitles.push({ title: t, chars: charsOf(content), disabled: isDisabled(e), compiled: compiled.has(t) });
    }
    const missed = settingTitles.filter((x) => !x.compiled);
    return { settingTitles, compiled: settingTitles.length - missed.length, missed };
}

// ★★leg60：**编译完整性读数的落账形状**——**只许标量**（`SSOT_COMPILE_KEYS` 就是契约层登记的那一批）。
//   为什么单独立成函数、而且必须被锁（用户真账实测抓出来的自己那一刀）：
//     第一版我在编排层直接把整个 `catalog` 铺进 `setting.frozen.compile`，于是
//     `titleRoster`（189 条带 `why` 的名号明细）**整块进了账本** ⇒ 13,679 字符 = 账本的 **11.4%**，
//     而且契约层（`ssot.schema` 的 `compile` 是 `additional:false`）**没登记它 ⇒ 违约**。
//     ⇒ 口径：**账本只留计数，明细留在控制台诊断面**（"账里不存原值"那条纪律的同一条理由：
//       账本是给引擎读的，不是给人翻的档案）。
export const SSOT_COMPILE_KEYS = [
    'entries', 'enabled', 'disabled', 'disabledChars', 'shells', 'constShells',
    'declared', 'declaredChars', 'picked', 'pickedChars', 'declaredDropped',
    'skipped', 'skippedChars', 'titleNames', 'settingTitles', 'settingCompiled',
];
export function compileSummary(catalog, titleRoster = []) {
    if (!catalog || typeof catalog !== 'object') return null;
    const src = {
        ...catalog,
        // ★口径：**已有读数优先，明细只用来补缺**——旧账里 `titleNames`/`settingTitles` 是已经算好的计数，
        //   摘明细时**不许顺手重算**（重算 = 用"现在手上的数组"覆盖"当时记下的数"，那是另一种篡改读数）。
        //   新写入这一侧（`probeBook` 的 catalog）没有这三个顶层键 ⇒ 自然落到"从明细/派生里取"。
        titleNames: typeof catalog.titleNames === 'number'
            ? catalog.titleNames
            : (Array.isArray(titleRoster) ? titleRoster.length : 0),
        settingTitles: typeof catalog.settingTitles === 'number'
            ? catalog.settingTitles
            : (catalog.completeness?.settingTitles ?? 0),
        settingCompiled: typeof catalog.settingCompiled === 'number'
            ? catalog.settingCompiled
            : (catalog.completeness?.settingCompiled ?? 0),
    };
    const out = {};
    for (const k of SSOT_COMPILE_KEYS) {
        const v = src[k];
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return Object.keys(out).length ? out : null;
}

// ★★leg60 旧账清理（**载入期一次性 · 幂等 · 不可变**，与 `settle.migrateLegacyAttrs` 同一治法）：
//   把已经写进账本的"胖 compile"（第一版把整个探测结果铺进去 ⇒ 含 `titleRoster` 189 条明细、
//   `completeness`/`windowCover`/`missing`/`enabledChars`/`declaredLines` 等**未登记的键**）收成标量摘要。
//   为什么必须有这一处、而不是"等下次重新抽取就好了"：用户那份三国真账**刚刚花了二十多分钟**跑完，
//   为 6 个诊断键让他重跑一遍是荒唐的；而契约（`additional:false`）不修就一直违纪。
//   纪律：无可摘 ⇒ **原对象返回**（不空写、逐字节一致）；摘掉的只是**诊断明细**，计数一个不少。
export function slimLegacyCompile(ssot) {
    if (!ssot || typeof ssot !== 'object') return ssot;
    const setting = ssot.context?.setting;
    const cp = setting?.frozen?.compile;
    if (!cp || typeof cp !== 'object' || Array.isArray(cp)) return ssot;
    const extra = Object.keys(cp).filter((k) => !SSOT_COMPILE_KEYS.includes(k));
    if (!extra.length) return ssot;                       // 已经干净 ⇒ 原对象返回（幂等）
    const slim = compileSummary(cp, cp.titleRoster);
    const frozen = { ...setting.frozen };
    if (slim) frozen.compile = slim; else delete frozen.compile;
    return { ...ssot, context: { ...ssot.context, setting: { ...setting, frozen } } };
}

/**
 * probeBook：探测一本书的声明面（纯函数、零模型、零 JS 执行）——"作者把料放在哪、点名了哪些"。
 * 返回：条目计数 / 壳清单 / 声明表 / **本次要补读的料** / 未编译台账 / 题名名册 / 旧窗口覆盖率。
 */
export function probeBook(worldInfoEntries, character = null, { window = 30000 } = {}) {
    const raw = allEntries(worldInfoEntries, character);
    let enabled = 0;
    let disabled = 0;
    let enabledChars = 0;
    let disabledChars = 0;
    for (const e of raw) {
        const content = String(e.content ?? '').trim();
        if (!content) continue;
        if (isDisabled(e)) { disabled += 1; disabledChars += charsOf(content); } else { enabled += 1; enabledChars += charsOf(content); }
    }
    const { shells, declared, missing, picked, skipped } = probeAbstractDeclarations(raw);
    const sum = (list) => list.reduce((n, x) => n + x.chars, 0);
    // 旧窗口覆盖率（leg59c 的读数口径：头 window 字符覆盖了多少条启用条目）
    let winChars = 0;
    let winEntries = 0;
    for (const e of raw) {
        const content = String(e.content ?? '').trim();
        if (!content || isDisabled(e)) continue;
        if (winChars >= window) break;
        winChars += charsOf(content);
        winEntries += 1;
    }
    return {
        entries: enabled + disabled,
        enabled,
        disabled,
        enabledChars,
        disabledChars,
        shells,
        constShells: shells.filter((s) => s.constant),
        declared,
        missing,
        picked,
        skipped,
        pickedChars: sum(picked),
        skippedChars: sum(skipped),
        declaredChars: sum(declared),
        titleRoster: deriveTitleRoster(worldInfoEntries, character),   // ★零 token 的名册（见其头部注释）
        windowCover: { entries: winEntries, chars: Math.min(winChars, window) },
    };
}

/**
 * composeInitSource：合成初始化设定文本（剪枝序：世界书条目[全量] > 声明面取料 > 描述 > 场景 > 人格 > 开场白）
 * @param {object} opts
 * @param {object} [opts.character]  ST 角色卡对象（name/description/personality/scenario/first_mes/character_book）
 * @param {Array}  [opts.worldInfoEntries] ST 世界信息条目数组
 * @param {number} [opts.budget]     防御性总上限（默认 INIT_SOURCE_HARD_CEILING；测试可注入小值验证机制）
 * @param {boolean} [opts.includeDeclared] ★leg60：是否补读"声明面选中的料"（默认 true）。关掉 = 退回旧口径（只读启用条目）
 * @param {{playerName?:string,charName?:string}|null} [opts.macroNames]
 *   ★★★leg148：酒馆宏的真名对（`{{user}}` → 人设名、`{{char}}` → 角色名）。
 *   **缺省 `null` = 一个字都不换**（逐字节回到今天，判据 K2 那一族要的正是这个）；
 *   **传了就对整份产出文本换一次**（读不到的名字换成 `PLAYER_NAME_UNKNOWN` 记号 ⇒ 下游形状闸必然挡住它）。
 *   ★为什么是"出口换一次"而不是"入口逐条换"：探测期 `labelOf` 那一族还要用来**配对**
 *     （壳声明的标题 ↔ 条目题名），两边口径必须一样，只给一半加替换会让声明面整个配不上。
 *   ⇒ 本文件内部一律读原文，**出口才换**——这样"选哪些条目"这件事一个字节都不受影响。
 * @returns {{ok:boolean, text?:string, label?:string, usedChars?:number, truncated?:boolean,
 *            worldName?:string, entryCount?:number, pieceCount?:number, catalog?:object, reason?:string}}
 */
/**
 * ★★★leg201（社区第三次报同一条 · 2026-10-05）：空卡那半句必须**自带证据**。
 *
 * 为什么（这一条被社区报了三次，每次都只能来回问三四轮，最后都停在"我这儿看不到"）：
 *   · 原句只有「角色卡四件套全空」六个字，**它同时覆盖三种完全不同的病**——
 *     卡真空 / 宿主把正文放在 `data` 层（我们的读法没跟上）/ 懒加载没取回来；
 *   · 而**手机端没有控制台**（`console.warn` 那份诊断取不出来）⇒ 状态条这一句是**唯一的取证通道**；
 *   · 社区用户"换一张卡也一样"就是被这一格卡住的——那句话分不出是卡的问题还是宿主的问题。
 * ⇒ 把决定性的三个事实钉进消息里：**顶层几字 · `data` 层几字 · `shallow` 到底是什么**。
 *   看到就能当场分类：`data` 层有字 = 宿主形状（我们的锅）；两边都 0 = 卡真空或不在角色聊天；
 *   `shallow=true` = 懒加载（那条走另一支文案，不进本函数）。
 */
function emptyCardHint(character) {
    try {
        const len = (o) => CHARACTER_SOURCE_FIELDS.reduce((n, k) => n + (typeof o?.[k] === 'string' ? o[k].trim().length : 0), 0);
        const shallow = character?.shallow;
        return `（顶层 ${len(character)} 字 · data 层 ${len(character?.data)} 字`
            + ` · shallow=${shallow === undefined ? '无' : String(shallow)} · 顶层键 ${Object.keys(character || {}).length}）`;
    } catch (_) { return ''; }   // 取证失败绝不能把"报错"变成"抛错"
}

export function composeInitSource({ character = null, worldInfoEntries = [], worldSources = null, budget = INIT_SOURCE_HARD_CEILING, includeDeclared = true, macroNames = null, selection = null } = {}) {
    const sources = collectAbstractSources({ worldInfoEntries, character, worldSources });
    const rawEntries = sources.filter(s => s.kind === 'world-entry').map(s => s.entry);
    const rawCatalog = includeDeclared ? probeBook(rawEntries) : null;
    const declaredTitles = new Set(rawCatalog?.picked.map(p => p.title) || []);
    const resolved = resolveAbstractSources({ sources, selection, declaredIds: rawEntries.filter(e => declaredTitles.has(labelOf(e))).map(entrySelectionId) });
    const custom = resolved.selection.mode === 'custom';
    worldInfoEntries = resolved.effectiveEntries.filter(e => e._sw2SourceKind === 'world-entry');
    const worldName = typeof character?.name === 'string' && character.name.trim() ? character.name.trim() : '';

    const parts = [];
    const partEntries = [];
    const diagnostics = { excluded: resolved.excluded, warnings: resolved.warnings };
    const rawTotal = rawEntries.filter(e => String(e.content ?? '').trim()).length;
    const disabled = rawEntries.filter(isDisabled).length;
    const ordinary = worldInfoEntries.filter(e => custom || !sources.find(s => s.id === e._sw2SelectionId)?.disabled);
    const entryLines = ordinary.map(e => normalizeEntry(e)).filter(Boolean);
    for (const e of ordinary) { const line = normalizeEntry(e); if (line) { parts.push(line); partEntries.push(e); } }
    // ★★leg60：**声明面取料**——启用条目之后、卡件之前。为什么排在这儿：
    //   ① 启用条目是"这本书明面上给了什么"，声明面是"作者点名要用的"——两者都是书的本体，排在卡件散文之前；
    //   ② 防御上限若咬到，截掉的是声明面的**尾巴**（人物分阶段剧本），**设定与年份档在最前** ⇒ 先保要害。
    const catalog = includeDeclared ? (custom ? probeBook(worldInfoEntries) : rawCatalog) : null;
    let declaredLines = 0;
    const declaredLineList = [];
    if (catalog && catalog.picked.length) {
        const ordinaryIds = new Set(ordinary.map(e => e._sw2SelectionId));
        for (const e of worldInfoEntries) if (!ordinaryIds.has(e._sw2SelectionId)) {
            const line = normalizeEntry(e);
            if (line) { declaredLineList.push(line); parts.push(line); partEntries.push(e); }
        }
        declaredLines = declaredLineList.length;
    }
    // ★leg60（第 3 件）：本次**真正编译进源**的条目标签（= 启用条目 + 声明面取料）——
    //   编译完整性自检要拿它跟"书里有多少条设定类条目"对账。
    const compiledTitles = [];
    for (const line of [...entryLines, ...declaredLineList]) {
        const m = /^【([^】]{1,120})】/.exec(line);
        if (m) compiledTitles.push(m[1]);
    }
    const declaredFrom = entryLines.length;                          // 声明面在 parts 里的区间（算"被上限截掉几条"用）
    const declaredTo = declaredFrom + declaredLineList.length;
    let pieceCount = 0;
    const cardEntries = resolved.effectiveEntries.filter(e => e._sw2SourceKind === 'character-field');
    for (const entry of cardEntries) {
        parts.push(clip(entry.content, INIT_PIECE_CAPS[entry._sw2Field]));
        partEntries.push(entry);
        pieceCount += 1;
    }

    // ★★（Task 1 复查项 2 + 二次复查 Important 1）：**先按预算切出本次实际用料，再算题名候选**。
    //   病灶：题名候选的自证（本书 key）与体例频次此前吃的是**预算前**的全部条目 ⇒
    //   只改一条预算外条目的 key/题名，同一份实际用料就会算出不同的名册与书指纹（复查实测）。
    //   ★二次复查补的那条更窄的边界：**自动控制器题名例外**的题名行排在全部正文之后 ⇒
    //   它到底进没进本次用料，要等最终切点说了算；在第一遍就把它并进证据面，等于让一条**被预算挤掉的**
    //   控制器用它的 key/题名给别的候选当证据（重审夹具：同一份正文、只改被挤掉的 key，两个指纹）。
    //   口径（两遍定稿，不迭代）：
    //     ① 先按基础用料切点（题名行还没加）挑出**基础预算内**的候选人——题名行只可能排在正文之后，
    //        所以这个先来后到不会把"本来进得去"的题名行判死；
    //     ② 加上题名行后再切一次 = 最终用料；**证据面只认最终用料里的来源身份**：
    //        · 进了正文的来源（`acceptedWorld`）；
    //        · 题名行本身进了正文的控制器例外（它的 key 随它一起生效）。
    //        被预算挤掉的来源（普通条目或控制器）不得给出 key 与体例频次。
    const ceiling = Number(budget) > 0 ? Number(budget) : INIT_SOURCE_HARD_CEILING;
    const baseCut = ceilingCut(parts, ceiling);
    const baseAcceptedIds = new Set(partEntries.slice(0, baseCut.count).map(e => e._sw2SelectionId));

    // 未进入正文的有效题名也必须进入合订：它们影响名册，缓存和换书指纹要同步看到。
    // 只提供作者已自证的名字，不把控制器脚本带回，不编属性。
    const baseWorld = worldInfoEntries.filter(e => baseAcceptedIds.has(e._sw2SelectionId));
    const baseTitles = new Set(baseWorld.map(labelOf));
    const itemById = new Map(resolved.sourceItems.map(s => [s.id, s]));
    const rosterEntries = [...baseWorld];
    const titleExceptions = [];
    const evidenceByTitle = new Map();
    for (const e of baseWorld) if (!evidenceByTitle.has(labelOf(e))) evidenceByTitle.set(labelOf(e), e);
    // ★★（Task 1 复查项 1）：默认控制器的题名例外**只从统一解析结果**给——合法选中、自动读法、
    //   清理后仅技术内容的壳，且它声明的题名确实在本次用料里。
    //   显式全文/选段（含失效选段）一律不看原文：失效选段不许借题名路径变回"生效题名"。
    for (const e of rawEntries) {
        const id = entrySelectionId(e);
        if (baseAcceptedIds.has(id) || isDisabled(e)) continue;
        const item = itemById.get(id);
        if (!item || item.selected !== true || item.readMode !== 'auto' || item.status !== 'technical') continue;
        const fetch = new RegExp(FETCH_CALL_RE.source, FETCH_CALL_RE.flags);
        if (![...stripJsComments(String(e.content ?? '')).matchAll(fetch)].some(m => baseTitles.has(m[1]))) continue;
        rosterEntries.push(e);
        titleExceptions.push(e);                    // ★二次复查：它进没进最终用料，等下面第二遍说了算
        const t = labelOf(e);
        if (t && !evidenceByTitle.has(t)) evidenceByTitle.set(t, e);
    }
    // 第一遍：只按「基础预算内的正文来源 + 借题名的合法控制器」挑候选——题名行排在全部正文之后。
    const firstPass = includeDeclared ? deriveTitleRoster(rosterEntries) : [];
    const titleLineAt = new Map();                 // parts 下标 → { from, name, pair }（题名行的身份）
    const lineIndexOfSource = new Map();           // 来源身份 → 它那条题名行的 parts 下标（同一来源最多一条）
    for (const d of firstPass) {
        if (compiledTitles.includes(d.from)) continue;
        // 题名候选只挂到**给出这条题名的那个来源身份**上（不再照题名回头找来源——
        // 那会把失效/未选的同名来源重新拉回实际用料）。
        const evidence = evidenceByTitle.get(d.from);
        if (evidence) lineIndexOfSource.set(evidence._sw2SelectionId ?? entrySelectionId(evidence), parts.length);
        titleLineAt.set(parts.length, { from: d.from, name: d.name, pair: titleLinePair(d.from, d.name) });
        parts.push(`【${d.from}】${d.name}`);
        partEntries.push(evidence ? { ...evidence, content: d.name, disable: false, enabled: true, _sw2Resolved: true,
            _sw2SelectionId: evidence._sw2SelectionId ?? entrySelectionId(evidence), _sw2SourceKind: 'world-entry',
            _sw2Field: null, _sw2ReadMode: 'auto', _sw2Reason: '作者合法声明的题名候选', _sw2TitleOnly: true } : null);
    }

    const allLen = parts.reduce((n, p) => n + Array.from(p).length, 0);
    const cut = ceilingCut(parts, ceiling);
    // ★★★（二次复查 Important 1 定稿）：**最终用料里的来源身份才是证据面，且正文里的题名行必须与最终名册
    //   一一对应**。第一遍的候选集吃的是「基础预算内的正文来源 + 题名例外」，而一条题名行的 key 自证 /
    //   体例频次可能来自一条**被最终切点挤掉的**控制器（实测：只改那条预算外控制器的 key，正文里就换成
    //   了另一条题名行，两个指纹）。⇒ 这里**只剔不补**地迭代到不动点：
    //     ① 按当前保留的题名行算出证据面；
    //     ② 用该证据面重派生名册（key 自证与体例频次都只许来自它）；
    //     ③ 剔掉"名册里没有"的题名行 ⇒ 证据面缩小 ⇒ 回到 ①，直到没有可剔的。
    //   ★题名例外**只有一档**（判据在下面的 `faceExceptions`）：**题名行真进了最终用料**的合法自动
    //     控制器——题名、key 一起生效（它的行就是本次正文里的一条）。**没有题名行的壳一个字都不借**
    //     （旧法那档"只借 key"已删：见 `deriveTitleRoster` 头注的病灶与合同依据）。
    //   ★为什么不重排、不回填：题名行只可能排在正文之后；剔一行只是把预算还给"后面本来也进不去的行"
    //     ——回填等于让被挤掉的证据重新生效（正是要治的那一格）。保守：剔掉的预算就空着，宁短不假。
    let keptLines = new Set([...titleLineAt.keys()].filter((index) => index < cut.count));
    let usedRoster = [];
    for (;;) {
        const faceIds = new Set();
        for (let index = 0; index < cut.count; index += 1) {
            if (titleLineAt.has(index) && !keptLines.has(index)) continue;   // 剔掉的题名行不算来源
            const e = partEntries[index];
            if (e) faceIds.add(e._sw2SelectionId ?? entrySelectionId(e));
        }
        const acceptedWorld = worldInfoEntries.filter(e => faceIds.has(e._sw2SelectionId));
        const acceptedTitles = new Set(acceptedWorld.map(labelOf));
        const faceExceptions = [];       // 题名行真进了正文的例外：题名 + key 都算
        for (const e of titleExceptions) {
            const lineIndex = lineIndexOfSource.get(entrySelectionId(e));
            if (lineIndex === undefined) continue;                        // 没有题名行 ⇒ 不借任何东西
            if (lineIndex < cut.count && keptLines.has(lineIndex)) faceExceptions.push(e);
        }
        // 证据面：① 进了正文的来源；② 题名行真进了正文的合法题名例外。别的一律不算。
        const evidenceEntries = [...acceptedWorld, ...faceExceptions.filter(e => { const t = labelOf(e); return t && acceptedTitles.has(t); })];
        // 控制器例外只把**它自己的题名**带进体例频次（脚本正文不许变成"书里的一条"）。
        const keyAndFrequencyOnlyEntries = [...faceExceptions, ...acceptedWorld];
        const derived = includeDeclared ? deriveTitleRoster(evidenceEntries, null, { titleOnlyEntries: keyAndFrequencyOnlyEntries }) : [];
        // 名册读数也要来源可归：候选的题名必须仍挂在最终用料里的来源身份上（题名行没进正文 ⇒ 名册里也不留）。
        usedRoster = derived.filter((d) => {
            const source = evidenceByTitle.get(d.from);
            return Boolean(source) && faceIds.has(source._sw2SelectionId ?? entrySelectionId(source));
        });
        const justified = new Set(usedRoster.map((d) => titleLinePair(d.from, d.name)));
        const next = new Set([...keptLines].filter((index) => justified.has(titleLineAt.get(index).pair)));
        if (next.size === keptLines.size) break;      // 不动点：没有题名行再被剔掉
        keptLines = next;
    }
    const droppedTitleLines = new Set([...titleLineAt.keys()].filter((index) => index < cut.count && !keptLines.has(index)));
    const used = [];
    // ★★★Task 3（抽取确认与完整入账）：**发射端自有的"最终接收块"**——来源 ID + **逐字交出去的文本**。
    //   为什么只能在这里产出（这是本格存在的全部理由）：只有这里同时知道
    //     ① 哪几条真进了最终用料（预算切点 + 被剔掉的题名行）；② 每条交出去时**带不带题头**（`normalizeEntry`）；
    //     ③ 宏替换后的实际文本（模型看到的就是它）。`effectiveEntries[].content` 没有题头、没有顺序/偏移，
    //     而 `sourceItems` 是原文查看面（含未选/被排除内容）⇒ 两者都**不能**当证据底本。
    //   ★纪律：这里产出的块 = **只含本次允许并实际交出的材料**；被排除/预算外/技术清理掉的一个字都不进来。
    const allowedBlocks = [];
    for (let index = 0; index < cut.count; index += 1) {
        if (droppedTitleLines.has(index)) continue;
        used.push(parts[index]);
        const e = partEntries[index];
        if (!e) continue;
        const sourceId = e._sw2SelectionId ?? entrySelectionId(e);
        const text = macroSub(parts[index], macroNames);
        const title = macroSub(String(e.comment ?? '').trim() || String(e.name ?? '').trim(), macroNames);
        allowedBlocks.push({
            sourceId, text, title,
            titleOnly: e._sw2TitleOnly === true,
            kind: e._sw2SourceKind ?? 'world-entry',
            field: e._sw2Field ?? null,
        });
    }
    const total = used.reduce((n, p) => n + Array.from(p).length, 0);   // 报的是**实际交出去**的那份文本长度
    const usedDeclared = Math.max(0, Math.min(cut.count, declaredTo) - declaredFrom);
    const effectiveEntries = [];
    for (const [index, e] of partEntries.entries()) {
        if (!e) continue;
        const content = e._sw2SourceKind === 'character-field' ? clip(e.content, INIT_PIECE_CAPS[e._sw2Field]) : e.content;
        const item = resolved.sourceItems.find(s => s.id === e._sw2SelectionId);
        if (index >= cut.count || droppedTitleLines.has(index)) {
            item.status = 'budget-excluded';
            item.reason = droppedTitleLines.has(index) ? '题名证据不在最终用料内（总输入上限）' : '总输入上限排除';
            item.content = ''; item.effectiveChars = 0; continue;
        }
        item.content = macroSub(content, macroNames);
        item.effectiveChars = charsOf(item.content);
        if (content !== e.content) { item.truncated = true; item.reason += '（角色卡字段上限截取）'; }
        if (e._sw2TitleOnly) { item.status = 'effective-title'; item.reason = e._sw2Reason; }
        effectiveEntries.push({ ...e, content: item.content, comment: macroSub(e.comment, macroNames), key: Array.isArray(e.key) ? e.key.map(k => macroSub(k, macroNames)) : e.key });
    }
    const common = { ...diagnostics, text: macroSub(used.join('\n'), macroNames), sourceItems: resolved.sourceItems, effectiveEntries,
        selection: resolved.selection, migration: resolved.migration, worldSources, titleRoster: usedRoster, worldName,
        defaultSelectedIds: effectiveEntries.map(e => e._sw2SelectionId),
        // ★Task 3：**允许来源块**（发射端自有；证据核验的唯一底本）。接线层把它原样递给
        //   `extractWorldSetting({ allowedSources })`——抽取器**不再**回头读 `sourceItems` 或原书。
        allowedBlocks };
    if (!used.length) {
        // ★★★leg201：**取法与取料那一处共用**（`characterFieldText`：顶层与 `data` 层都看）。
        //   旧法只看顶层 `character[k]` ⇒ 与 `abstract-input.js` 的读法**两把尺子**：
        //   宿主把正文放在 `data` 层时，取料读到了、这一句却判"空"，于是报出与事实相反的话。
        const pieces = CHARACTER_SOURCE_FIELDS.filter((k) => characterFieldText(character, k).trim());
        const bits = [];
        if (!character) bits.push('未读到角色卡（非角色聊天/群聊需另配）');
        // ★★★leg154：**两种空必须分形**——"卡还在懒加载（我们没取到）"与"卡里真没有"是两件事。
        //   旧法一律说「角色卡四件套全空」⇒ 用户拿着一本好书被告知"你的卡是空的"（社区用户就是这么被劝退的）。
        //   `shallow` 是 ST 自己那个键（`performance.lazyLoadCharacters`），它标着"这一份只是名册那一层"。
        else if (!pieces.length) bits.push(character.shallow === true ? '角色卡还没加载完（ST 只交回了名册那一层，正文还没取）' : `角色卡四件套全空${emptyCardHint(character)}`);
        if (rawTotal === 0) bits.push('世界信息/内置书为空');
        else if (disabled === rawTotal) bits.push('世界书条目全部标记禁用');
        return { ok: false, reason: custom && !resolved.selection.selectedIds.length ? '自选来源为空，未读取任何正文' : diagnostics.excluded.length ? '排除技术内容后没有可用设定' : bits.length ? bits.join('；') : '没有可用设定（详见浏览器控制台诊断）', ...common,
            catalog: catalog ? { entries: catalog.entries, enabled: catalog.enabled, disabled: catalog.disabled, titleRoster: [] } : null };
    }

    return {
        ok: true,
        ...common,
        // ★★★leg148：**出口换一次**——整份产出文本里的酒馆宏在这里统一换成真名。
        //   `macroNames` 缺省 null ⇒ `macroSub` 原样返回 ⇒ **逐字节回到今天**（零漂移）。
        //   ★`usedChars` 报的是**换之前**的长度：换名会改字符数（`{{user}}` 9 字 → 真名 2–3 字），
        //     而那个数是"这份书文多长"的读数，跟"装不装得下"无关（预算那一步早在上面的循环里判完）。
        text: macroSub(used.join('\n'), macroNames),
        label: '自动合订（角色卡 + 世界信息/内置世界书）',
        usedChars: total,
        truncated: total < allLen,
        worldName,
        entryCount: parts.length - pieceCount,
        pieceCount,
        declaredLines,
        // ★leg60：**题名面**（不新增模型调用）——**顶层键**，因为抽取执行器直接吃它
        //   （`web/index.js` 的 `extraDeclared: src.titleRoster`）。
        //   ⚠这一行踩过一次：我第一版把它塞进了下面的 `catalog` 摘要里 ⇒ 顶层没有 ⇒
        //     `extraDeclared: undefined` ⇒ 三国那 191 个题名名号**一个都没进册**，而且**全绿**。
        //     （与 leg60 治的别名通道是同一个形状："机制对了、线没接上"。判据已补在 init-source.test。）
        titleRoster: usedRoster,
        // ★leg60：声明面读数带上走（编排层用它做人话上报与"编译完整性"自检）。
        //   为什么必须带出去：这一棒**第一次**去读作者关掉的仓储（三国 30.9 万字 / 188 条），
        //   不报出"读了多少、漏了多少"，就是"静默多读 30 万字"——那与本仓"每条变更留痕"相反。
        catalog: catalog ? {
            entries: catalog.entries,
            enabled: catalog.enabled,
            disabled: catalog.disabled,
            enabledChars: catalog.enabledChars,
            disabledChars: catalog.disabledChars,
            shells: catalog.shells.length,
            constShells: catalog.constShells.length,
            declared: catalog.declared.length,
            declaredChars: catalog.declaredChars,
            picked: catalog.picked.length,
            pickedChars: catalog.pickedChars,
            declaredLines,
            // ★leg60：**题名即名册**（零 token，纯函数）——抽取执行器把它当"照书办"的声明面强制并册
            //   （三国实测：题名里写着 185 个人物，而模型只抽到 127 ⇒ 这一刀是"作者已经列好了 cast"）。
            titleRoster: usedRoster,
            // ★leg60（第 3 件）编译完整性：书里"设定类"条目有几条 / 本次编译覆盖了几条 / 漏了哪些（前 12 个）
            completeness: (() => {
                const cc = compileCompleteness(rawEntries, null, { compiledTitles: effectiveEntries.filter(e => e._sw2SourceKind === 'world-entry').map(e => sources.find(s => s.id === e._sw2SelectionId)?.title) });
                return {
                    settingTitles: cc.settingTitles.length,
                    settingCompiled: cc.compiled,
                    missedTitles: cc.missed.slice(0, 12).map((x) => x.title),
                };
            })(),
            // ★防御上限咬到时**不许静默**（三国实测：合订 50.8 万字 > 上限 50 万 ⇒ 声明面尾巴被截）。
            //   排布已按"先保要害"（启用条目 → 声明面的设定/年份档在前 → 分阶段剧本在后）⇒ 截掉的是尾巴，
            //   但"截了几条"必须报出来，否则就是"静默少给料"。
            declaredDropped: declaredLineList.length - usedDeclared,
            skipped: catalog.skipped.length,
            skippedChars: catalog.skippedChars,
            missing: catalog.missing.length,
            windowCover: catalog.windowCover,
        } : null,
    };
}
