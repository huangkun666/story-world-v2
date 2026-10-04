// story-world-v2/src/seed-roots.js
// ★★leg40：**从世界源起根**——把书里"正在发生的事"提取成账上的**线头事件**。
//
// 为什么需要它（本棒实测的诊断链）：
//   · 59 轮真账里，**第 25 轮之前只有 1 条事件**（`ev_1_1`），其余 64 条全部由聊天长出 ⇒ **世界的"根"来自聊天，不是世界源**。
//   · 世界源被抽取成了两样：**静态设定**（16 档力量谱系/7 条法则/2 条史略 —— 不进包）与**名册 751 条**（每条只有 name+kind）。
//     实测：**751 条里被事件点过名的 = 0** ⇒ 名册只到"谁"，**没有"谁正在办什么"** ⇒ 世界源里那些"事"（遗迹试炼大开、
//     龙脉受损纤维化、镇压魔渊留下的东西…）**一条都没变成过账上的事**。
//   · 于是模型每轮可引用的节点只有那场大乱 ⇒ 它只能在那条河里开新口子（59 轮起过 9 条线头，**0 条被接续**）。
//
// 三步走里的**第一步（起根）**，另两步已在本棒落地：
//   ① **起根**（本模块）：把世界源里真写着的"正在发生的事"提取成线头事件（带地点、当事人、以及书里那句话）——**只提取不发明**。
//   ② **接续**（已落：`pack.js` 的 `openRoots`/`threads` 两栏 + 提示词第 14 条）：线头分捆递到眼前 + "每条各写一步"。
//      实测：起点线头接续 1/13 → 4/13；**一轮并推 3 条线**（24 条次点名里真被推 15 次 = 62.5%）。
//   ③ 补根：由调用方按"线头不够了"再触发一次本模块（`shouldSeedRoots` 给出判据）。
//
// 纪律（与 `seedBookEntities` 同一条路）：
//   · **引擎不发明事实**：条目、地点、当事人全部取自书里原文或**账上已存在的实体名**；对不上的**丢**，不猜、不补。
//   · **幂等**：`meta.seedRoots` 记指纹 + 已种 id；同一本书只种一次（重复调用直接返回 `{ skipped: true }`，零调用）。
//   · **失败零阻塞**：调用方拿到 `{ ok:false }` 就照常跑世界（与检索注入同一条规矩）。
//   · **不碰世界进度**：只往 `events` 追加事件 + 写 `meta.seedRoots`；不写 tick/盘算/编年/权重。
import { normalizePosition } from './position.js';
import { ABSTRACT_FACT_RULES } from './abstract-shape.js';
// ★★★Task 4（integration boundaries）：当事人的名号解析改用**全仓唯一那把尺子**（正名优先 + 别名并集后判唯一）。
//   旧法 `byName` 是"正名精确 Map、先到先得"：①**已确认别名一律认不出**（复审红：`青衣客` 被丢）；
//   ②两个实体同名（跨类别）时**最后写入的那个赢**（复审红：`甲` 记到了 faction 头上）——
//   而设计 §6.2/§6.3 要求"不同身份的同名项不被强行合并""相关实体解析使用相同的身份信息"。
import { resolveEntityIdentityWithCanon } from './entity-identity.js';
// ★★★Task 4（integration boundaries）：起根的**来源身份 + 原话**协议（与属性/关系/设定同一条尺子）。
//   为什么必须共用 `abstract-evidence.js`（而不是在这里再写一遍字符串查找）：
//     · 发射端的 `allowedBlocks` 是"本次真正交出去的材料"，`freezeAllowedSources` 给出编号与逐字文本；
//     · `scopeForRows`/`verifyQuote` 把"编号"绑到**这一次调用真正展示的那一段**上——
//       同句出现在别的条目里时不许冒领（`task-3-evidence-boundary-red` 那条病）。
//   ⇒ 起根此前是严格面上唯一**没有编号**的一格（复审 F1：提示词形状里根本没有 `ev`），这里补齐。
import { freezeAllowedSources, evidenceDictionary, verifyQuote, presenceIn, scopeForRows, materialRowsOf } from './abstract-evidence.js';
// ★★★leg144：起根这一遍也**并发发出去、按块号收回来**（同一个机制、同一把尺子：
//   `src/abstract.js` 的 `EXTRACT_CONCURRENCY` 头注写了为什么是 3、以及"失败即退回串行"）。
//   ★它读的是**同一本书**、打的是**同一条网关**——所以并发度由调用方传**同一个数**，不另立一个。
import { runParallel } from './parallel-run.js';

export const SEED_ROOTS_TOP = 6;        // 提案态（铁律 2）：一次种几条。真账缺的就是"几条各自有轴的线"
export const SEED_ROOTS_MAX = 8;        // 硬上限（模型多给也丢）
export const SEED_CHUNK_CHAR = 30000;   // 书文取样上限（与设定五件套的 CANON_SRC_CHAR 同量级；防超长书拖垮一次调用）
export const SEED_CANDIDATES_TOP = 60;  // 改进版：候选池上限（"还没上过台的人"名字；60 个名字 ≈ 300 token）
// ★★★本笔新立（用户令「这个通道绝对不能有」）：**"书里原话"必须真的在书文里**——这条闸以前不存在。
//   病（真账实测）：起根 6 条里 **2 条**的"原话"其实是**别处来的句子**（模型那次调用被塞进了别的东西），
//   在真书《大荒-姬元真》里**一个字都对不上**——而旧 `sanitizeSeedRoots` 只判"quote 非空"
//   ⇒ 模型写什么句子都算"指得回书里"，照落账。**"引擎不发明事实"这条承重墙，在起根这条路上
//   此前只靠提示词自觉**（提示词里那句"每条都要能指回书里的原话"没有任何代码在核）。
//   判据（机械 · 零词表 · 与任何一本书的方言无关）：把 quote 与书文都**去掉空白与省略号**之后，
//   取 quote 里**最长的一段连续字符**，看它在书文里出不出得现——要求它 ≥ `min(quote 长度, 本常量)`。
//   ★为什么是"最长连续段"而不是"整句必须逐字出现"：模型抄书时常**用省略号跳字**
//     （`…` / `...`），整句比对会把**合法的**那几条一起误杀；而"连续段"对跳字免疫。
//   ★数字（**提案态**，铁律 2）为什么取 10 —— 真账 6 条实测的**最长连续段**：
//     · 合法的 4 条：**14 / 31 / 21 / 23**（都等于它们自己的全长 ⇒ 逐字来自书里）；
//     · 那 2 条外来句：**3 / 3**（在书里只碰得上三个字）。
//     两档之间差着一个数量级（3 vs 14）⇒ 10 落在中间，两边都不擦边。
export const SEED_QUOTE_MIN_RUN = 10;

/** 比对用归一：去掉空白与省略号（`.`/`…`）——只动"排版噪声"，不动一个字的内容。 */
function normalizeForQuoteMatch(s) {
    return String(s ?? '').replace(/[\s\u2026.]+/g, '');
}

/**
 * quote 在书文里**最长能连续对上多少字**（0 = 一个字都对不上）。
 * ★二分查找：判据"存在长度为 L 的连续段"对 L 是**单调**的（L 成立 ⇒ L−1 必成立）⇒ 不必逐长度扫。
 *   （真书 26 万字 × 每次起根几十条 quote，逐长度扫会是几十万次 indexOf。）
 */
export function longestBookRun(quote, bookText) {
    const q = normalizeForQuoteMatch(quote);
    const b = normalizeForQuoteMatch(bookText);
    if (!q || !b) return 0;
    const has = (L) => { for (let i = 0; i + L <= q.length; i += 1) if (b.includes(q.slice(i, i + L))) return true; return false; };
    let lo = 1; let hi = q.length; let best = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (has(mid)) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
}

/**
 * ★★★leg150（甲案）：**"一条根的格"**——**一处定义、两处展开**：
 *   ① 单发起根（`buildSeedRootsPrompt`：整份提示词只问这一件事）；
 *   ② 并进第二遍（`buildAttrsOnlyPrompt` 的 `roots` 那一支：同一份说明原样附在属性那一问后面）。
 * ★为什么必须共用：这一问现在**有两个入口**，各写一份就是本仓最贵的那类病（两份复制品迟早漂移），
 *   而漂移之后**没有任何判据会红**——两边的模型行为会悄悄不一样。
 */
export const SEED_ROOT_ITEM_SHAPE = {
    title: '一句话说清这件事（20 字以内，用书里的说法）',
    position: '书里明述的地点（照抄原文；没写就空着）',
    parties: ['书里明述的当事人名（门派/势力/人物，1–3 个）'],
    quote: '书里那句话（照抄原文，60 字以内）',
    why: '一句话：为什么它算「正在发生」（可省）',
};

/**
 * ★★★Task 4：**严格道下根那一格的出处形状**（`ev:{s,q}`）——**一处定义、两处展开**。
 *   与属性/关系/设定同一条纪律（设计 §6.1：模型输出附相应来源条目及原文依据）。
 *   没有允许来源（legacy）时**一个字都不加** ⇒ 旧固定响应/旧账零扰动。
 */
export const SEED_ROOT_EV_SHAPE = { s: '来源编号（见下方「来源清单」）', q: '该来源里逐字照抄的原文依据' };

/** 根那一格的形状（`evidence=true` 时并上 `ev`；legacy 时逐字等于旧形状）。 */
export function seedRootsShape({ evidence = false } = {}) {
    return [{ ...SEED_ROOT_ITEM_SHAPE, ...(evidence ? { ev: SEED_ROOT_EV_SHAPE } : {}) }];
}

/**
 * ★★★leg150：**"起根"这一问的正文**（四道判据 ＋ 不许发明 ＋ 那份候选名单）——**唯一一份**。
 * @param {object} [opts] `{ candidates, evidence }` = 候选名单（账上"还没上过台"的人与势力名，可为空）
 *   ＋ `evidence`（严格道：多三条"每条根都要带 `ev`"的引用纪律；legacy 时一行不加）
 * @returns {string[]} 提示词里的那几行（调用方负责加"这件事叫什么"与输出形状）
 */
export function seedRootsBrief({ candidates = [], evidence = false } = {}) {
    const names = (Array.isArray(candidates) ? candidates : [])
        .map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, SEED_CANDIDATES_TOP);
    const listBlock = names.length
        ? [
            '',
            '★**另外给你一份名单**：这些是这个世界里**还没有上过台**的人与势力（引擎按账本机械筛出来的）。',
            '如果书里写着他们**正在办什么事**，优先挑这些事——**当事人请尽量从这份名单里选**（名单里没有的，才用书里别处明述的名号）：',
            names.join('、'),
        ]
        : [];
    return [
        '什么叫"正在发生的事"（判据，按顺序过）：',
        '1. 它**有地点**：发生在书里某个说得出的地方（地名照抄书中原文）。',
        '2. 它**有当事人**：有一方或几方**有名有姓**的人在办它（门派/势力/人物名，照抄书中原文）。',
        '3. 它**还没了结**：书中写它是"正在进行／刚刚开始／悬而未决"的，不是已经写完结局的往事。',
        '4. 它**能往下走**：由它可以合理推出"接下来会怎样"——不是一句静态描述（如"此界分九州"），',
        '   也不是数值档位（如"T1 感气境"），更不是一段地理志。',
        '',
        '**不要发明**：每条都要能指回书里的原话。书里没写地点就不写地点；书里没写谁在办就不要编一个人出来。',
        '宁可少给（4 条扎实的，胜过 8 条含糊的）。',
        ...(evidence ? [
            '',
            '★★**每条根都要带 `ev`（出处）**：`ev.s` = 下面「来源清单」里的编号，`ev.q` = 该编号来源里**逐字照抄**的那句原文；',
            '  `quote`（书里那句话）必须能在自己的 `ev.q` 里**逐字找到**。',
            '  编号只能引**本次这一块**列出的来源。',
            '  ★leg197：引擎会逐字核一遍并把结果记进抽取诊断，**核不过不再丢掉这条根**——',
            '    但"每条都要能指回书里的原话"这条纪律照旧（它是质量的抓手；指不回去的多半是推出来的）。',
        ] : []),
        ...listBlock,
    ];
}

/**
 * 起根提示词（面向模型）——只问一件事：书里**正在发生的事**有哪些。
 * ★为什么口径写成"书里写着的"，而不是"你想点什么"：本模块**不创作**，它只是把书里已有的事搬上账本。
 *   （书名录抽取问的是"书里有哪些名号"，这里问的是"书里有哪些正在办的事"——同一族的两个问题。）
 *
 * ★★leg40 改进（用户拍板后加）：**带候选池**——把账上"还没上过台的人"（从没被事件点过名的实体名）
 *   一并递给模型，要求当事人**从这份名单里挑**。理由（本棒实测）：
 *     · 盲发书文 ⇒ 种出来的多是"力量体系/门派介绍"段的事（荒古武圣硬抗天劫、万魔之祖主持仪式…），
 *       形状对，但与"这个世界此刻谁还没动"无关；
 *     · 给了名单 ⇒ 种子自带"谁"，且**天生不与那场大乱的人重叠**（那批人早被点过名）——
 *       这正是"另起一条根"要的；而且**对得上就能落账**（对不上的名字仍会被 `applySeedRoots` 丢掉）。
 *   ★不传候选池时行为与旧版逐字一致（老调用方零扰动）。
 */
export function buildSeedRootsPrompt(sourceText, { candidates = [], maxChars = SEED_CHUNK_CHAR, sources = null, scope = null } = {}) {
    // ★★leg60（用户实机报"起根一直是 0 条"时顺手查出来的相邻 bug）：**二次截断**。
    //   本函数一直硬切 `.slice(0, SEED_CHUNK_CHAR)`，而 `seedRootsChunked` 早就把块按
    //   `chunkBookText(src, chunkChars)` 切好了（实测块 ≈31,447 字符 > 30,000）⇒
    //   **每块尾巴那 ~1,400 字从来没进过提示词**（约 4.6%），而且**与它自己的注释相反**——
    //   第 253 行的注释写着"分块起根时不再二次截断……那道截断只属于单发路径"，代码却没做到。
    //   ⇒ 口径与注释对齐：`maxChars` 可注入，**单发路径保持 30000**（老调用方零扰动），
    //     分块路径传 `Infinity`（块的大小由调用方决定，这里不再动刀）。
    const src = maxChars === Number.POSITIVE_INFINITY ? String(sourceText ?? '') : String(sourceText ?? '').slice(0, maxChars);
    // ★★★Task 4：严格道 = 调用方给了本次允许来源（发射端 `allowedBlocks`）⇒ 起根也走"编号 + 原话"。
    //   没给 ⇒ **逐字等于旧提示词**（旧调用方/固定响应零扰动）。
    const evidence = Boolean(sources && Array.isArray(sources.list) && sources.list.length);
    return [
        '你在读一部小说的设定与正文。请只做一件事：**把其中"正在发生的事"挑出来**。',
        ...ABSTRACT_FACT_RULES,
        '',
        // ★leg150：判据与候选名单**一处定义**（另一处展开在 `buildAttrsOnlyPrompt` 的 roots 那一支）
        ...seedRootsBrief({ candidates, evidence }),
        ...(evidence ? ['', evidenceDictionary(sources, { scope })] : []),
        '',
        '输出**只输出 JSON**（不要解释、不要 Markdown 围栏），形状如下：',
        JSON.stringify({ roots: seedRootsShape({ evidence }) }, null, 2),
        '',
        '—— 以下是书文 ——',
        src,
    ].join('\n');
}

/**
 * 净化（**机械判据，零语义判断**）：条数上限、字段类型、长度上限、去重、缺 title/缺当事人的丢掉。
 * ★它**不判**"这条够不够好"（那是提示词的事，也是抽取者的事）——只判"形状是否可用"，
 *   与 `sanitizeCanon`/`sanitizeBookFields` 同一治法（净化坏项、如实上报，不静默）。
 *
 * ★★★leg197（用户令「把抽象时因为引擎根据模型给的引用而找不到原文而丢弃模型提出的行动的这个行为
 *   全部取消了…现在我要全面撤销」）：**"指回书里"那一道闸整条撤掉。**
 *   旧法（leg139 立、Task 4 收窄成"本次展示的片段"）要求每条根带 `ev:{s,q}`，且 `quote` 必须能在
 *   自己的 `ev.q` 里逐字找到、`ev.q` 必须在本次展示的片段里——**对不上就丢这条根**。
 *   现在：`verifyQuote` 照跑，**结果只记进 `warnings`（如实报"对不上"），根一律收下**。
 *   留下的判据只有形状：非对象 · 缺 `title` · 标题重复 · **缺当事人（`parties` 空）** · 每块条数上限。
 *   ★"缺当事人"不是出处判据，是**落账可行性**：`applySeedRoots` 要拿当事人去账上认实体，
 *     一个都对不上这条根就起不了（它会如实进 `skippedParties`）。
 * @param {object} raw 模型给的 `{roots:[…]}`（或直接一个数组）
 * @param {object} [opts] `{ max, sourceText, frozen, scope, spanText }`
 *   · ★leg197 起 `sourceText` / `frozen` / `scope` / `spanText` **都不再决定收不收**（只为调用方零改动而留）；
 *     给了 `frozen` 就照旧核一遍并把结果写进 `warnings`（"哪些根的原话对不上"仍然看得见）。
 */
export function sanitizeSeedRoots(raw, { max = SEED_ROOTS_MAX, sourceText = '', frozen = null, scope = null, spanText = null } = {}) {
    const warnings = [];
    const list = Array.isArray(raw?.roots) ? raw.roots : (Array.isArray(raw) ? raw : []);
    if (!list.length) return { roots: [], warnings: ['起根结果为空（无 roots 数组或数组为空）'] };
    // ★leg197：这里原先分"严格道（有允许来源 ⇒ `verifyQuote`）"与"legacy（⇒ 块内跑长判据）"两支，
    //   两支都会丢根。现在只剩一件事：**核一遍、记账**（`frozen` 给了才核；没给就什么都不核）。
    const strict = Boolean(frozen && Array.isArray(frozen.list) && frozen.list.length);
    void sourceText;
    const seen = new Set();
    const roots = [];
    for (const [i, r] of list.entries()) {
        if (!r || typeof r !== 'object') { warnings.push(`roots[${i}]: 非对象，丢`); continue; }
        const title = String(r.title ?? '').trim().slice(0, 40);
        if (!title) { warnings.push(`roots[${i}]: 缺 title，丢`); continue; }
        if (seen.has(title)) { warnings.push(`roots[${i}]: 与前面重复（"${title}"），丢`); continue; }
        const position = String(normalizePosition(r.position) ?? '').trim();
        const parties = (Array.isArray(r.parties) ? r.parties : [])
            .map((x) => String(x ?? '').trim())
            .filter(Boolean)
            .slice(0, 3);
        const quote = String(r.quote ?? '').trim().slice(0, 120);
        if (strict) {
            // ★★★leg197：**只记账，不丢根**（旧法这里 `continue` 三次：缺 ev/编号对不上、原话不在所引片段里、
            //   `quote` 不在自己的 `ev.q` 里）。诊断仍看得见"哪条的原话对不上"。
            const ev = (r.ev && typeof r.ev === 'object' && !Array.isArray(r.ev)) ? r.ev : null;
            const v = verifyQuote(frozen, { ev, scope: scope || null, spanText: spanText ?? null, cls: 'root', subject: title });
            if (!v.ok) warnings.push(`roots[${i}]（${title}）：出处核不过——${v.why}（★leg197：**照收**，只记这一条）`);
            else if (quote && !presenceIn(v.quote, quote)) warnings.push(`roots[${i}]（${title}）："书里那句话"不在所引原话里（${v.ref}）（★leg197：**照收**）`);
        }
        if (!parties.length) { warnings.push(`roots[${i}]: 没有当事人（parties 空）⇒ 没人办的事起不了根，丢`); continue; }
        seen.add(title);
        // ★落账形状**一个字不改**：`{title, position, parties, quote, why}`——原始凭证（`ev`/来源编号）
        //   是过程材料，核完即弃（与关系边的 `_swVerified` 同一条：**不进世界账、不进缓存**）。
        roots.push({ title, position, parties, quote, why: String(r.why ?? '').trim().slice(0, 80) });
        if (roots.length >= Math.min(max, SEED_ROOTS_MAX)) break;
    }
    return { roots, warnings };
}

/**
 * 落账（**幂等、只追加事件**）：把净化后的根写成账上的未决事件（= 线头）。
 * @param {object} ssot 世界账（就地改）
 * @param {object[]} roots `sanitizeSeedRoots` 的产物
 * @param {object} opts `{ fingerprint, at, tick }`
 * @returns {{ seeded:number, skippedParties:string[], ids:string[] }}
 */
export function applySeedRoots(ssot, roots, { fingerprint = '', at = '', tick = null } = {}) {
    const events = Array.isArray(ssot.events) ? ssot.events : (ssot.events = []);
    // ★★★Task 4：账上实体 + 书名录（旧世界别名只住在名册里，见 `resolveEntityIdentityWithCanon` 的兜底档）
    //   ——两样都交给**共用解析器**；本函数不再自己建"正名 Map"。
    const entities = (ssot.entities || []).filter((e) => e && typeof e === 'object');
    const canon = ssot.context?.setting?.frozen?.canon?.bookEntities || [];
    const taken = new Set(events.map((e) => e.id));
    const tickNow = Number.isFinite(tick) ? tick : (ssot.meta?.tick ?? 0);
    const skippedParties = [];
    const ids = [];
    for (const r of roots) {
        // 当事人必须是**账上真有**的实体（唯一命中才算：正名优先、别名并集后判唯一）——
        //   未命中/歧义一律丢并如实进 `skippedParties`，**不新建实体、不猜**（"宁缺勿造"）。
        const ripples = [];
        for (const name of r.parties) {
            const who = resolveEntityIdentityWithCanon(entities, canon, name);
            if (who.status !== 'ok' || !who.id) { skippedParties.push(String(name)); continue; }
            if (who.id === ssot.context?.playerId) continue;      // 红线 1：玩家不当代言人
            if (!ripples.includes(who.id)) ripples.push(who.id);
        }
        if (!ripples.length) continue;                        // 一个当事人都对不上 ⇒ 这条根起不了（不猜）
        let n = 1;
        while (taken.has(`ev_seed_${n}`)) n += 1;
        const id = `ev_seed_${n}`;
        taken.add(id);
        ids.push(id);
        events.push({
            id,
            title: r.title,
            source: { type: 'seed' },                          // ★与 state/plot/ripple 并列的第四型：**世界源起的根**
            position: r.position || undefined,
            ripples,
            closed: false,
            seedFrom: { quote: r.quote, why: r.why || undefined, fingerprint, at, tick: tickNow },
        });
    }
    return { seeded: ids.length, skippedParties, ids };
}

/**
 * ★★★leg150（甲案）：**候选名单的排序与闸门**——**一处定义、两个入口**：
 *   ① 账本入口（`web/index.js` 的 `buildSeedCandidatePool`：从**实体**里挑"还没上过台的人"）；
 *   ② 名册入口（甲案：第二遍跑的时候账还没建，名字只有第一遍那一份 `rawBookNames`）。
 * 三道闸（与 leg61 原口径逐字相同，只是提出来共用）：
 *   ① 名号形态：2–12 字 ∧ 不含 `<>{}`（`<user>` 这类占位符真的在原文里）；
 *   ② **玩家自己不进名单**（红线 1；名字由调用方从人设里读进来交）
 *   ③ 排序键 = **这个名字在本书原文里出现多少次**（零 token、零词表、纯函数；并列按名字，确定性）。
 */
export function rankSeedCandidates(names, src, { top = SEED_CANDIDATES_TOP, exclude = '' } = {}) {
    const text = String(src ?? '');
    const occ = (n) => {
        let c = 0;
        let i = text.indexOf(n);
        while (i !== -1 && c < 50) { c += 1; i = text.indexOf(n, i + n.length); }   // 上界 50：只为排序，不必精确
        return c;
    };
    const seen = new Set();
    const out = [];
    for (const raw of Array.isArray(names) ? names : []) {
        const name = String(raw ?? '').trim();
        if (name.length < 2 || name.length > 12) continue;
        if (/[<>{}]/.test(name)) continue;
        if (exclude && name === String(exclude).trim()) continue;
        if (seen.has(name)) continue;
        seen.add(name);
        out.push({ name, n: occ(name) });
    }
    return out
        .sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1))
        .slice(0, top)
        .map((x) => x.name);
}

/**
 * ★★leg61：**起根候选池**（导出是为了**能真测**——本仓铁律：判据要能被独立喂进去跑）。
 *   ★★★leg150：它**从 `web/index.js` 搬来这里**（接线层有行数硬锁，而这一族本来就住这儿：
 *     "从账上挑还没上过台的人"是起根的一半）。搬来之后**两个入口并排住**：
 *     本函数（**账本**入口：世界账已经在手时用）与 `rankSeedCandidates`（**名册**入口：甲案在抽取期间用）。
 *
 * 口径（三件事，全是机械判据）：
 *   ① 未上过台：`active` ∧ 从未出现在任何事件的 `ripples` 里 ∧ 不是玩家棋子（既有口径，不动）；
 *   ② 名号形态闸：名字 2–12 字 ∧ **不含 `<>{}`**（`<user>` 这类占位符真的在原文里，不上闸它会占掉名额）；
 *   ③ ★排序键 = **这个名字在本书原文里出现多少次**（零 token、零词表、纯函数；住在 `rankSeedCandidates`）。
 *
 * 为什么必须换排序键（真账实测）：旧法按**账本顺序**取前 60，于是引导指向了
 * "账本里排前面的人"（三国是 `大汉/大魏/大吴/中山无极甄氏…`），而书里戏最多的诸葛亮(111 次)、
 * 姜维(81)、司马懿(74)、关羽(56) 全被挤在名单外——**385 个合格候选里出现 ≥10 次的 114 个
 * （占 90%）一个都没进名单**。名单不是硬闸（模型确实会用名单外的名字：大荒 4/13、三国 3/14 人次），
 * 但把引导对准"书里真有事的人"是纯赚的。
 */
export function buildSeedCandidatePool(hotWorld, src = '', top = SEED_CANDIDATES_TOP) {
    const named = new Set();
    for (const e of hotWorld?.events || []) for (const r of e.ripples || []) named.add(r);
    const out = [];
    const seen = new Set();
    for (const e of hotWorld?.entities || []) {
        if ((e.status || 'active') !== 'active' || named.has(e.id) || e.id === hotWorld?.context?.playerId) continue;
        if (typeof e.name !== 'string' || seen.has(e.name)) continue;
        seen.add(e.name);
        out.push(e.name);
    }
    return rankSeedCandidates(out, src, { top });
}

/**
 * ★★leg150：**单块起根的条数上限**——`SEED_ROOTS_MAX` 摊到各块，但**最多按 4 块摊**
 *   （块再多也不把每块的上限压到 1 条以下：一块至少给 1 条的机会）。
 * ★为什么提成函数：**两条路都要用这一个数**（分块起根那条路 ＋ 甲案"并进第二遍"那条路）。
 *   内联两份 = 迟早一处改了另一处没改，而那时**没有任何判据会红**（只会"根变少了"）。
 */
export function maxRootsPerChunk(chunkCount) {
    return Math.max(1, Math.ceil(SEED_ROOTS_MAX / Math.max(1, Math.min(chunkCount, 4))));
}

/**
 * ★★leg150：**起根的幂等指纹**（"同一本书得到同一个串"——不追求密码学强度）。
 * ★为什么提成函数：甲案让起根有了**两条路**（并进第二遍／分块起根），而幂等判据写在账上
 *   （`meta.seedRoots.fingerprint`）⇒ **两条路必须算出同一个串**，否则同一本书会被种两遍根。
 *   `--chunk-chars` 进指纹（块尺寸变了 ⇒ 上次种的根覆盖不到的地方也变了 ⇒ 该重种）。
 */
export function seedFingerprint(src, chunkChars = SEED_CHUNK_CHAR) {
    const text = String(src ?? '');
    let h = 0;
    for (let i = 0; i < text.length; i += 1) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
    return `seed:${text.length}:${chunkChars}:${(h >>> 0).toString(36)}`;
}

/**
 * 该不该起根（机械判据，供编排层调用）：
 *   · 已经种过（`meta.seedRoots.fingerprint` 命中）⇒ 不种（幂等，零调用）。
 *   · 线头**够用**（现有 openRoots ≥ `minRoots`）⇒ 不种（补根只在"线头不够"时发生）。
 */
export function shouldSeedRoots(ssot, { fingerprint = '', minRoots = 3 } = {}) {
    const done = ssot?.meta?.seedRoots;
    if (done && done.fingerprint && done.fingerprint === fingerprint) return { seed: false, reason: '已种过（同一本书）' };
    const open = (ssot?.events || []).filter((e) => !e.closed);
    const evIds = new Set(open.map((e) => e.id));
    const agIds = new Set((ssot?.agendas || []).map((a) => a.id));
    const roots = open.filter((e) => !e.source?.ref || !(evIds.has(e.source.ref) || agIds.has(e.source.ref)));
    if (roots.length >= minRoots) return { seed: false, reason: `线头够用（${roots.length} ≥ ${minRoots}）` };
    return { seed: true, reason: `线头不足（${roots.length} < ${minRoots}）` };
}

/**
 * 一次完整的起根（抽取 + 净化 + 落账）——**失败零阻塞**：任何一步不成就原样返回，不抛给世界。
 * @param {object} args `{ ssot, sourceText, extract, fingerprint, at, fresh }`
 */
export async function seedRoots({ ssot, sourceText, extract, fingerprint = '', at = '', minRoots = 3, onProgress = null } = {}) {
    if (!ssot?.meta) return { ok: false, errors: ['无世界账（ssot.meta 缺失）'] };
    const gate = shouldSeedRoots(ssot, { fingerprint, minRoots });
    if (!gate.seed) return { ok: true, skipped: true, reason: gate.reason, seeded: 0 };
    if (typeof extract !== 'function') return { ok: false, errors: ['未提供抽取调用（extract 注入缺失）'] };
    const src = String(sourceText ?? '');
    if (!src.trim()) return { ok: false, errors: ['世界源正文为空（书上没有可读的字）'] };

    let raw;
    try {
        raw = await extract(buildSeedRootsPrompt(src));
    } catch (err) {
        return { ok: false, errors: [`起根调用失败：${err?.message || err}`] };
    }
    const parsed = typeof raw === 'string' ? safeJson(raw) : raw;
    if (!parsed) return { ok: false, errors: ['起根调用返回的不是合法 JSON'] };
    const clean = sanitizeSeedRoots(parsed, { sourceText: src });
    if (!clean.roots.length) return { ok: false, errors: ['起根结果净化后为空', ...clean.warnings] };
    const applied = applySeedRoots(ssot, clean.roots, { fingerprint, at, tick: ssot.meta?.tick });
    ssot.meta.seedRoots = {
        fingerprint, at, ids: applied.ids, dropped: clean.warnings.length,
        skippedParties: applied.skippedParties,
    };
    if (typeof onProgress === 'function') {
        onProgress({ step: 'seedRoots', got: clean.roots.length, seeded: applied.seeded, warnings: clean.warnings });
    }
    return { ok: true, seeded: applied.seeded, ids: applied.ids, warnings: clean.warnings, skippedParties: applied.skippedParties };
}

/** 把书文按行切成块（**与名册抽取的 `chunkRows` 同一治法**；起根与名册用同一把尺子）。 */
// ★★★Task 4：**带行号**的版本是唯一实现——`chunkBookText` 只是它的薄壳。
//   为什么：严格道要把"这一块展示了哪些行"交回来源块（`scopeForRows`），
//   而分块与作用域**必须是同一把尺子**（与 `src/abstract.js` 的 `chunkRowsWithRanges` 同一条纪律）。
export function chunkBookTextWithRanges(text, maxChar = SEED_CHUNK_CHAR) {
    const rows = String(text ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
    const chunks = [];
    let cur = []; let len = 0; let from = 0;
    for (let i = 0; i < rows.length; i += 1) {
        const l = Array.from(rows[i]).length;
        if (cur.length && len + l > maxChar) { chunks.push({ text: cur.join('\n'), from, to: i - 1 }); cur = []; len = 0; from = i; }
        cur.push(rows[i]); len += l;
    }
    if (cur.length) chunks.push({ text: cur.join('\n'), from, to: rows.length - 1 });
    return chunks;
}

export function chunkBookText(text, maxChar = SEED_CHUNK_CHAR) {
    return chunkBookTextWithRanges(text, maxChar).map((c) => c.text);
}

/**
 * ★★leg150：**跨块收口**（把各块起出来的根合成一份）——**一处定义、两条路共用**：
 *   ① `seedRootsChunked`（分块起根那条老路）② `seedRootsFromPass`（甲案：并进第二遍那条新路）。
 * ★三条口径（与 leg144 那条留档逐字相同，不许改）：
 *   · **按块序**：`seenTitles` 的语义是"**先见到的那块算数**"——它是**有次序**的判据，
 *     放进并发里跑就变成"看谁先回来"（同一本书两次跑可能种出不同的根）；
 *   · **老账已有的标题也算"先见到的"**（重种不该把同名根再种一遍）；
 *   · **总量上限** `max`（`SEED_ROOTS_MAX`）。
 */
export function dedupeRootsAcrossChunks(perChunkLists, { existingTitles = [], max = SEED_ROOTS_MAX } = {}) {
    const seen = new Set((Array.isArray(existingTitles) ? existingTitles : []).map((t) => String(t ?? '')));
    const out = [];
    for (const list of Array.isArray(perChunkLists) ? perChunkLists : []) {
        for (const r of Array.isArray(list) ? list : []) {
            if (!r || seen.has(r.title)) continue;
            seen.add(r.title);
            out.push(r);
        }
    }
    return out.slice(0, max);
}

/**
 * ★★★leg150（甲案）：**把"并进第二遍"里各块顺带起出来的根收口落账**。
 *
 * 为什么需要它：起根现在有**两条路**——老路是"第三次通读全书"（`seedRootsChunked`，仍然活着：
 *   换书重种／存量移植／载入期自动补根／小书单发 都在用它）；甲案这条路是**第二遍的块里顺带问**。
 *   两条路的收口口径必须**逐字相同**（去重、上限、幂等指纹、玩家不当代言人），所以收口只写一份。
 *
 * @param {object} ssot 世界账（就地改）
 * @param {object} args `{ perChunk, fingerprint, at, max }`——`perChunk` = **按块序**的每块一份
 *   （`extractWorldSetting` 交回来的 `rawRoots`：每块各自过了"原话真在这一块里"那道闸）
 * @returns `{ ok, seeded, ids, skippedParties, chunkCount, fingerprint }`（与 `seedRootsForWorld` 同形，接线层好接）
 */
export function seedRootsFromPass(ssot, { perChunk = [], fingerprint = '', at = '', max = SEED_ROOTS_MAX, candidateCount = null, warnings = [] } = {}) {
    const chunkCount = Array.isArray(perChunk) ? perChunk.length : 0;
    if (!ssot?.meta) return { ok: false, seeded: 0, errors: ['无世界账（ssot.meta 缺失）'] };
    const collected = dedupeRootsAcrossChunks(perChunk, {
        existingTitles: (ssot.events || []).map((e) => String(e.title || '')),
        max,
    });
    if (!collected.length) {
        // ★一条都没起出来 ⇒ **如实返回失败**（调用方据此出声），但**不许抛**（与"失败零阻塞"同一条纪律）：
        //   世界照常开局，线头可以之后再补（载入期的自动补根会看到账上没有指纹）。
        return { ok: false, seeded: 0, chunkCount, candidateCount, fingerprint, warnings, errors: ['第二遍没能起出可用的根（照常开局，线头可以之后再补）'] };
    }
    const applied = applySeedRoots(ssot, collected, { fingerprint, at, tick: ssot.meta?.tick });
    // ★合并（不是覆盖）：老账可能已有指纹（例如先按老路种过一次）⇒ 把两次的 id 并起来，
    //   否则"重种会把上一次的记录从账上抹掉"（那是假账——事件还在，指纹却说没有）。与 `seedRootsChunked` 同一条。
    const prev = ssot.meta.seedRoots || {};
    const prevIds = Array.isArray(prev.ids) ? prev.ids : [];
    ssot.meta.seedRoots = {
        fingerprint, at, ids: [...new Set([...prevIds, ...applied.ids])],
        chunks: chunkCount, dropped: (Array.isArray(warnings) ? warnings : []).length, skippedParties: applied.skippedParties,
    };
    return { ok: true, seeded: applied.seeded, ids: applied.ids, skippedParties: applied.skippedParties, chunkCount, candidateCount, fingerprint, warnings };
}

/**
 * ★leg40 改进版：**分块起根**——一本书按块各问一次，种子就能覆盖全书（而不是只覆盖前 3 万字）。
 * 为什么需要：`SEED_CHUNK_CHAR=30000` 只截开头，而真账那本书 **305,590 字符** ⇒ 老策略只看了 **10%**，
 *   种出来的都是开头"力量体系与人物介绍"段的事。名册抽取早就走"分块多调用"这条路（`ROSTER_CHUNK_CHAR=60000`），
 *   本函数把同一治法搬到起根上：**按同样的行分块，逐块问，逐块净化，最后一起落账**。
 * 纪律：**逐块失败只丢那一块**（不整批失败）；块内净化规则与单块完全一致（同一个 `sanitizeSeedRoots`）。
 * @returns `{ ok, seeded, ids, warnings, chunks: [{ index, chars, ok, got, error }], skippedParties }`
 */
export async function seedRootsChunked({
    ssot, chunks = [], extract, fingerprint = '', at = '', candidates = [], seedChunkChar = SEED_CHUNK_CHAR,
    maxPerChunk = Math.ceil(SEED_ROOTS_MAX / 2), onProgress = null, mergeExisting = true, concurrency = 1,
    sourceText = '', allowedSources = null, evidencePolicy = null,
} = {}) {
    if (!ssot?.meta) return { ok: false, errors: ['无世界账（ssot.meta 缺失）'] };
    if (typeof extract !== 'function') return { ok: false, errors: ['未提供抽取调用（extract 注入缺失）'] };
    // ★★★Task 4（integration boundaries）：**起根的严格道**——与 `extractWorldSetting` 同一条政策口径：
    //   · 给了允许来源（发射端 `allowedBlocks`）⇒ strict：每条根要"编号 + 原话"；
    //   · 显式 `evidencePolicy:'legacy'` ⇒ 旧固定响应那条路（逐字旧行为）；
    //   · **显式要 strict 却没给允许来源 ⇒ 明确拒绝**，不许静默回落 legacy（"没材料"≠"不需要材料"）。
    const frozen = freezeAllowedSources(allowedSources);
    const policy = evidencePolicy === 'legacy' ? 'legacy' : (evidencePolicy === 'strict' ? 'strict' : (frozen ? 'strict' : 'legacy'));
    if (policy === 'strict' && !frozen) {
        return { ok: false, errors: ['起根依据: 本次要求 strict（来源编号 + 原话）但调用方没有提供「允许来源」清单 ⇒ 拒绝按未核实入账（不许自动回落 legacy）'], chunks: [] };
    }
    const strict = policy === 'strict' && Boolean(frozen);
    // 每块的**本次展示片段**：块带行号（`chunkBookTextWithRanges`）且给了整份正文 ⇒ 用行号算（精确）；
    //   否则交给 `verifyQuote` 的 `spanText` 兼容入口反推（重复正文取交集，更严）。
    const material = strict ? String(sourceText ?? '') : '';
    const materialRowList = strict && material ? materialRowsOf(material) : null;
    const scopeOfChunk = (c) => {
        if (!strict || !materialRowList) return null;
        const from = Number.isInteger(c?.from) ? c.from : null;
        const to = Number.isInteger(c?.to) ? c.to : null;
        if (from === null || to === null || to < from) return null;
        const indexes = [];
        for (let i = from; i <= to && i < materialRowList.length; i += 1) indexes.push(i);
        return scopeForRows(frozen, { text: material, rows: materialRowList, indexes });
    };
    const list = (Array.isArray(chunks) ? chunks : [])
        .map((c) => (typeof c === 'string' ? { text: String(c) } : (c && typeof c === 'object' ? c : null)))
        .filter((c) => c && String(c.text ?? '').trim());
    if (!list.length) return { ok: false, errors: ['书文为空（没有可分块的内容）'] };
    if (mergeExisting) {
        // ★只查**幂等**（同一本书不重种），**不查"线头够不够"**——
        //   "线头够用就不种"是**载入期自动补根**的判据；而本函数是**显式移植**（用户点了才跑），
        //   移植的全部意义正是"存量世界已有 13 条旧线头，也要把干净的根补进去"。
        //   ⇒ 传 `Infinity` 让"线头不足"那条分支永不为真（口径仍走同一个 shouldSeedRoots，不另立判据）。
        const gate = shouldSeedRoots(ssot, { fingerprint, minRoots: Number.POSITIVE_INFINITY });
        if (!gate.seed) return { ok: true, skipped: true, reason: gate.reason, seeded: 0, chunks: [] };
    }

    const allWarnings = [];
    const allSkipped = [];
    const seenTitles = new Set((ssot.events || []).map((e) => String(e.title || '')));
    const collected = [];
    const chunkLog = [];
    // ★★★leg144：**并发发出去**（旧法 `for … await`：一块一块排队，真账 9~11 块 ⇒ 170–490 秒里大半是干等）。
    //   ★★两条纪律（缺一条就会悄悄改行为）：
    //     ① **进度必须当场出声**——不能挪到收口那一步报。收口在 `await` 之后，
    //        9 块会在**最后一瞬间一起报完**，那正是 leg27 要治的"看不见在动"（用户原话「我也看不到日志」）。
    //     ② **跨块去重仍在收口按块序做**——`seenTitles` 的语义是"**先见到的那块算数**"，
    //        它是**有次序**的判据；放进并发里跑就是看谁先回来（同一本书两次跑可能种出不同的根）。
    //   ★`got` 的口径（如实说清，免得两处读数打架）：= **这一块**净化后起出几条（**跨块去重之前**）。
    //     跨块去重之后的净落账数是 `seeded`（调用方另有那句"已从世界源起 N 条根"）。
    // ★★★leg144 **补**（用户真机控制台抓出来的**我自己那一处漏**，逐字留档）：
    //   `[story-world-v2] 抽取调用失败（输入 31631 字符 · 已花 0.8s） HTTP 429`
    //   栈 = `seed-roots.js:331 ← runLane @ parallel-run.js:78` ⇒ **429 落在起根这一遍**。
    //   病：本笔第一版**只给 `extractWorldSetting` 装了降级**，起根这里是**定死的并发度**——
    //   网关一限流，连着几块一起 429、**每块 0.8 秒就丢一个**，既不降速也不重试
    //   （实测：他那一跑丢了 **4 块**，即 4 块的线头候选整块没进账）。
    //   ⇒ 与抽取那两遍**同一条口径、同一个开关**：任何一块失败 ⇒ 剩下的活儿当场退回 1 路。
    //   ★它**不**做什么（别误读）：**不重试**（起根这一遍本来就没有重试，本笔没加）、
    //     也不改变"失败那一块怎么办"（照旧整块放弃、照旧进 `chunkLog.error` 与 `warnings`）。
    //     那两条属"改失败分诊"，用户 2026-09-27 明说「**先只做设置**」⇒ 留作活儿单。
    let degraded = false;
    const concurrencyNow = () => (degraded ? 1 : concurrency);
    const results = await runParallel(list, concurrencyNow, async (chunk, i) => {
        const sliced = String(chunk.text);
        const scope = scopeOfChunk(chunk);
        const chars = Array.from(sliced).length;
        let roots = [];
        let warnings = [];
        let err = null;
        try {
            // ★leg60：**传 Infinity**——块已经由 `chunkBookText` 切好，这里不许再切（见 buildSeedRootsPrompt 头注）
            const raw = await extract(buildSeedRootsPrompt(sliced, {
                candidates, maxChars: Number.POSITIVE_INFINITY,
                ...(strict ? { sources: frozen, scope } : {}),     // ★Task 4：来源清单 = 这一块真正见到的那几条
            }));
            const parsed = typeof raw === 'string' ? safeJson(raw) : raw;
            if (!parsed) throw new Error('返回的不是合法 JSON');
            // ★Task 4：严格道把"编号 + 原话"核到**这一块真正展示的片段**上（legacy 逐字旧行为）。
            const clean = sanitizeSeedRoots(parsed, {
                max: maxPerChunk, sourceText: sliced,
                ...(strict ? { frozen, scope, spanText: sliced } : {}),
            });
            roots = clean.roots;
            warnings = clean.warnings;
        } catch (e) {
            err = String(e?.message || e);
            degraded = true;   // ★失败即退回串行（与抽取那两遍同一把尺子——见上）
        }
        if (typeof onProgress === 'function') {
            onProgress({ step: 'seedRoots', index: i + 1, count: list.length, chars, ok: !err, got: roots.length, error: err });
        }
        return { chars, roots, warnings, err };
    });
    // 按块序收口（★次序的唯一出处：跨块去重 + 留痕 + 收集，三件都在这里按块号做）
    for (const [i, res] of results.entries()) {
        if (!res) continue;
        allWarnings.push(...res.warnings.map((w) => `块${i + 1}: ${w}`));
        chunkLog.push({ index: i + 1, chars: res.chars, ok: !res.err, got: res.roots.length, error: res.err });
        collected.push(res.roots);
    }
    // ★leg150：跨块去重与总量上限**一处定义**（与甲案"并进第二遍"那条路共用同一份收口）
    const roots = dedupeRootsAcrossChunks(collected, { existingTitles: seenTitles });
    if (!roots.length) {
        return { ok: false, errors: ['全部块都没能起出可用的根', ...chunkLog.filter((c) => c.error).map((c) => `块${c.index}: ${c.error}`)], chunks: chunkLog };
    }
    const applied = applySeedRoots(ssot, roots, { fingerprint, at, tick: ssot.meta?.tick });
    allSkipped.push(...applied.skippedParties);
    // ★合并（不是覆盖）：老账可能已有指纹（例如先按 30k 种过一次）⇒ 把两次的 id 并起来，
    //   否则"重种会把上一次的记录从账上抹掉"（那是假账——事件还在，指纹却说没有）。
    const prev = ssot.meta.seedRoots || {};
    const prevIds = Array.isArray(prev.ids) ? prev.ids : [];
    ssot.meta.seedRoots = {
        fingerprint, at, ids: [...new Set([...prevIds, ...applied.ids])],
        chunks: chunkLog.length, dropped: allWarnings.length, skippedParties: allSkipped,
    };
    return { ok: true, seeded: applied.seeded, ids: applied.ids, warnings: allWarnings, skippedParties: allSkipped, chunks: chunkLog };
}

/** JSON 容错解析（模型偶尔包一层围栏/解说）——只做"取出第一个 JSON 对象"，不猜内容。 */
function safeJson(text) {
    const s = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(s); } catch (_) { /* 继续找 */ }
    const i = s.indexOf('{');
    const j = s.lastIndexOf('}');
    if (i >= 0 && j > i) { try { return JSON.parse(s.slice(i, j + 1)); } catch (_) { return null; } }
    return null;
}
