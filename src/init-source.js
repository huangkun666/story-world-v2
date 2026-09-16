// story-world-v2/src/init-source.js
// 第十八棒：初始化设定源合订（编排层助手 · 纯函数 · 零引擎状态）
// 背景：K38 的「换源+worldBook 存储」机制被用户（正确地）判死刑——本文件不再有任何
// worldBook 概念：设定源只有两条自动路 = 世界信息/卡内置世界书条目 + 角色卡四件套。
//   - 世界书：**完整条目摄取，全量不截断**（v1 adapter.js L19 教训；按内容去重）；
//   - 卡件四件套：按 v1 spend() 同款逐字段预算（散文介绍，非世界书）。
// ★★leg60 修订上面那两句（原文写"禁用标记跳过"，现在只对了一半，照旧读会读错）：
//   **禁用条目不再一律跳过**——ST 生态里"禁用"常常是作者的**仓储**（条目关掉、由控制器脚本
//   `getwi(...)` 按需取）。现在的口径分两层：
//     · 启用条目：全量进（原样）；
//     · 禁用条目：**只进"作者点名过的"那部分**——由 `probeBook` 的纯函数判据选出
//       （恒注入壳声明的目录 + "自成一套"的壳声明的料），零散实例（一人一条的人物档案）不进，
//       但它们的**题名照样进名册与未编译台账**（`catalog.skipped`）。
//   实测：三国 827 条里 563 条禁用 = 全书的 81%；旧口径下引擎只看得到 18.9%（名册只能从 JS 里捞名字）。
// 分层归属：编排层（只组文本，不落账不结算）。防御上限提案态（铁律 2，随报批）。

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

export function normalizeEntryKey(e) {
    // ★第二十五棒 e（五）：主键取值必须**处理数组**——ST 形状里 `e.key` 常是数组（`["九宸玄陆","世界总纲",…]`），
    //   旧法 `String(e.key ?? …)` 会把它变成一长串逗号连接 ⇒ 同一本书的"世界书侧"与"卡内置侧"行**不可能相同**
    //   ⇒ 去重**完全失效**（实测交集 0）⇒ 同一本书被送进抽取两遍（424 条 / 499,526 字符，顶到 50 万防御上限）。
    const k = e?.key;
    if (typeof k === 'string' && k.trim()) return k.trim();
    if (Array.isArray(k) && k.length) return String(k[0] ?? '').trim();
    if (Array.isArray(e?.keys) && e.keys.length) return String(e.keys[0] ?? '').trim();
    if (typeof e?.keys === 'string' && e.keys.trim()) return e.keys.trim();
    return String(e?.uid ?? e?.name ?? e?.comment ?? '');
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
    const t = String(e?.comment ?? '').trim();
    if (t) return t;
    const n = String(e?.name ?? '').trim();
    if (n) return n;
    return normalizeEntryKey(e);
}

function normalizeEntry(e) {
    if (!e || typeof e !== 'object') return null;
    const label = labelOf(e);
    const content = String(e.content ?? '').trim();
    if (!content) return null;
    return `【${label}】${content}`;
}

// 世界书条目两路来源：① ST 合订 worldInfo（含卡内置书混入条目）② 卡内嵌 character_book 原始条目
// （v1 双路径 ch.data?.character_book || ch.character_book，同款）。禁用标记跳过；全量不截断；按内容去重。
function collectEntries(worldInfoEntries, character) {
    const out = [];
    const seen = new Set();
    let rawTotal = 0;
    let disabled = 0;
    const raw = allEntries(worldInfoEntries, character);
    for (const e of raw) {
        if (!e || typeof e !== 'object') continue;
        if (String(e.content ?? '').trim()) rawTotal += 1;
        if (isDisabled(e)) { disabled += 1; continue; } // v1 同款：尊重酒馆禁用标记
        const line = normalizeEntry(e);
        if (!line) continue;
        if (seen.has(line)) continue;
        seen.add(line);
        out.push(line);
    }
    return { out, rawTotal, disabled };
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

// 一个壳点名的标题里，有没有"互相成族"（共享 2–3 字前后缀，≥ FAMILY_MIN 条）
function selfContainedFamily(list) {
    for (const L of AFFIX_LEN) {
        for (const kind of ['pre', 'suf']) {
            const g = new Map();
            for (const t of list) {
                if (t.length <= L) continue;
                const a = kind === 'pre' ? t.slice(0, L) : t.slice(-L);
                if (!g.has(a)) g.set(a, []);
                g.get(a).push(t);
            }
            for (const [affix, mem] of g) if (mem.length >= FAMILY_MIN) return { affix, kind, size: mem.length };
        }
    }
    return null;
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
export function deriveTitleRoster(worldInfoEntries, character = null) {
    const raw = allEntries(worldInfoEntries, character).filter((e) => String(e.content ?? '').trim());
    const titles = [];
    const seenTitle = new Set();
    const keySet = new Set();
    for (const e of raw) {
        const t = labelOf(e);
        if (t && !seenTitle.has(t)) { seenTitle.add(t); titles.push(t); }
        for (const field of [e?.key, e?.keys]) {
            for (const x of (Array.isArray(field) ? field : [field])) {
                const s = String(x ?? '').trim();
                if (s) keySet.add(s);
            }
        }
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
    const byTitle = new Map();
    let enabled = 0;
    let disabled = 0;
    let enabledChars = 0;
    let disabledChars = 0;
    for (const e of raw) {
        const content = String(e.content ?? '').trim();
        if (!content) continue;
        const t = labelOf(e);
        if (t && !byTitle.has(t)) byTitle.set(t, e);
        if (isDisabled(e)) { disabled += 1; disabledChars += charsOf(content); } else { enabled += 1; enabledChars += charsOf(content); }
    }
    // 壳：启用 且 正文剥注释后含取件调用
    const shells = [];
    const declarers = new Map();                 // 标题 → Set(声明者题名)
    for (const e of raw) {
        const content = String(e.content ?? '').trim();
        if (!content || isDisabled(e)) continue;
        const body = stripJsComments(content);
        FETCH_CALL_RE.lastIndex = 0;
        const seen = new Set();
        let m;
        while ((m = FETCH_CALL_RE.exec(body))) { const t = m[1].trim(); if (t) seen.add(t); }
        if (!seen.size) continue;
        const shell = { title: labelOf(e), constant: e.constant === true, chars: charsOf(content), declares: [...seen] };
        shells.push(shell);
        for (const t of seen) {
            if (!declarers.has(t)) declarers.set(t, new Set());
            declarers.get(t).add(shell.title);
        }
    }
    // 声明表：书里真有的（按书序）/ 点名了但书里没有的（作者笔误，如实报）
    const declared = [];
    const missing = [];
    for (const t of declarers.keys()) {
        const e = byTitle.get(t);
        if (!e) { missing.push(t); continue; }
        declared.push({ title: t, chars: charsOf(String(e.content ?? '').trim()), disabled: isDisabled(e), by: [...declarers.get(t)] });
    }
    // ★取料：恒注入壳的声明 + "自成一套"的壳的声明
    const pickedTitles = new Map();              // 标题 → 为什么选它
    for (const sh of shells) {
        const present = sh.declares.filter((t) => byTitle.has(t));
        if (!present.length) continue;
        if (sh.constant) { for (const t of present) pickedTitles.set(t, `恒注入壳「${sh.title}」声明`); continue; }
        const fam = selfContainedFamily(present);
        if (fam) for (const t of present) if (!pickedTitles.has(t)) pickedTitles.set(t, `成套声明「${sh.title}」（${fam.affix}·${fam.size} 条）`);
    }
    const picked = [];
    const skipped = [];
    for (const t of declared) {
        const why = pickedTitles.get(t.title);
        if (why) picked.push({ ...t, why }); else skipped.push(t);
    }
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

// 取料行（★含**禁用**条目：那正是要治的病）——按书序，去重
function pickedLines(worldInfoEntries, character, picked) {
    if (!picked.length) return [];
    const want = new Set(picked.map((p) => p.title));
    const out = [];
    const seen = new Set();
    const byTitle = new Map();
    for (const e of allEntries(worldInfoEntries, character)) {
        const t = labelOf(e);
        if (want.has(t) && !byTitle.has(t)) byTitle.set(t, e);
    }
    for (const p of picked) {
        const e = byTitle.get(p.title);
        if (!e) continue;
        const line = normalizeEntry(e);
        if (!line || seen.has(line)) continue;
        seen.add(line);
        out.push(line);
    }
    return out;
}

/**
 * composeInitSource：合成初始化设定文本（剪枝序：世界书条目[全量] > 声明面取料 > 描述 > 场景 > 人格 > 开场白）
 * @param {object} opts
 * @param {object} [opts.character]  ST 角色卡对象（name/description/personality/scenario/first_mes/character_book）
 * @param {Array}  [opts.worldInfoEntries] ST 世界信息条目数组
 * @param {number} [opts.budget]     防御性总上限（默认 INIT_SOURCE_HARD_CEILING；测试可注入小值验证机制）
 * @param {boolean} [opts.includeDeclared] ★leg60：是否补读"声明面选中的料"（默认 true）。关掉 = 退回旧口径（只读启用条目）
 * @returns {{ok:boolean, text?:string, label?:string, usedChars?:number, truncated?:boolean,
 *            worldName?:string, entryCount?:number, pieceCount?:number, catalog?:object, reason?:string}}
 */
export function composeInitSource({ character = null, worldInfoEntries = [], budget = INIT_SOURCE_HARD_CEILING, includeDeclared = true } = {}) {
    const worldName = typeof character?.name === 'string' && character.name.trim() ? character.name.trim() : '';

    const parts = [];
    const { out: entryLines, rawTotal, disabled } = collectEntries(worldInfoEntries, character);
    for (const line of entryLines) parts.push(line); // 世界书条目：全量，优先
    // ★★leg60：**声明面取料**——启用条目之后、卡件之前。为什么排在这儿：
    //   ① 启用条目是"这本书明面上给了什么"，声明面是"作者点名要用的"——两者都是书的本体，排在卡件散文之前；
    //   ② 防御上限若咬到，截掉的是声明面的**尾巴**（人物分阶段剧本），**设定与年份档在最前** ⇒ 先保要害。
    const catalog = includeDeclared ? probeBook(worldInfoEntries, character) : null;
    let declaredLines = 0;
    const declaredLineList = [];
    if (catalog && catalog.picked.length) {
        for (const line of pickedLines(worldInfoEntries, character, catalog.picked)) { declaredLineList.push(line); }
        for (const line of declaredLineList) parts.push(line);
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
    for (const key of ['description', 'scenario', 'personality', 'first_mes']) {
        const raw = character?.[key];
        if (typeof raw !== 'string' || !raw.trim()) continue;
        parts.push(clip(raw.trim(), INIT_PIECE_CAPS[key])); // v1 spend 同款：只裁卡件散文
        pieceCount += 1;
    }

    const ceiling = Number(budget) > 0 ? Number(budget) : INIT_SOURCE_HARD_CEILING;
    const used = [];
    let total = 0;
    let usedDeclared = 0;
    const allLen = parts.reduce((n, p) => n + Array.from(p).length, 0);
    for (const [i, p] of parts.entries()) {
        const len = Array.from(p).length;
        if (total + len > ceiling) break; // 仅防御性上限触发（现实量级不触发）
        used.push(p);
        total += len;
        if (i >= declaredFrom && i < declaredTo) usedDeclared += 1;
    }
    if (!used.length) {
        const pieces = ['description', 'scenario', 'personality', 'first_mes'].filter((k) => typeof character?.[k] === 'string' && character[k].trim());
        const bits = [];
        if (!character) bits.push('未读到角色卡（非角色聊天/群聊需另配）');
        else if (!pieces.length) bits.push('角色卡四件套全空');
        if (rawTotal === 0) bits.push('世界信息/内置书为空');
        else if (disabled === rawTotal) bits.push('世界书条目全部标记禁用');
        return { ok: false, reason: bits.length ? bits.join('；') : '没有可用设定（详见浏览器控制台诊断）' };
    }

    return {
        ok: true,
        text: used.join('\n'),
        label: '自动合订（角色卡 + 世界信息/内置世界书）',
        usedChars: total,
        truncated: total < allLen,
        worldName,
        entryCount: parts.length - pieceCount,
        pieceCount,
        declaredLines,
        // ★leg60：**题名面**（零 token 的 cast）——**顶层键**，因为抽取执行器直接吃它
        //   （`web/index.js` 的 `extraDeclared: src.titleRoster`）。
        //   ⚠这一行踩过一次：我第一版把它塞进了下面的 `catalog` 摘要里 ⇒ 顶层没有 ⇒
        //     `extraDeclared: undefined` ⇒ 三国那 191 个题名名号**一个都没进册**，而且**全绿**。
        //     （与 leg60 治的别名通道是同一个形状："机制对了、线没接上"。判据已补在 init-source.test。）
        titleRoster: catalog ? catalog.titleRoster : [],
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
            titleRoster: catalog.titleRoster,
            // ★leg60（第 3 件）编译完整性：书里"设定类"条目有几条 / 本次编译覆盖了几条 / 漏了哪些（前 12 个）
            completeness: (() => {
                const cc = compileCompleteness(worldInfoEntries, character, { compiledTitles });
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