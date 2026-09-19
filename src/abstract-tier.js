// story-world-v2/src/abstract-tier.js
// ★★★leg71（丙案 · 切口 2）：**档位归一 + 法则分类**从 `abstract.js` 切出来，独立成模块。
//
// 为什么切这一块（细案 §3.2 + `leg68-recon-pending.md` §B3.3）：
//   · 它的语义与"抽取"**无关**——它是 leg61 / leg62b / leg64 三棒的独立成果：
//     **"同一个档位的几种写法怎么判等"** 与 **"一条法则属于哪一类"**；
//   · 本棒复量：它对本文件别处的依赖 = **0**（探针 `leg71-coupling-probe2.mjs`，剥注释后逐行扫）；
//   · ★**外部早就有两个真正的消费者**：`src/pack.js`（`classifyRulesByKind` + 三个 `RULE_PACK_*` 上界）
//     与 `src/render.js`（`classifyRulesByKind, RULE_CLASSES, RULE_CLASSES_PACK, RULE_CLASS_NONE`）
//     ⇒ 它们本来就该 import 一个专门的模块，而**不是从一个 3367 行的抽取器里取**。
//     切完之后，"面板报的上界"与"包里真用的上界"住在同一个家（leg63 那句不准确文案的病根正是两处各说各话）。
//
// ★★leg71 补 export 的 5 个符号（`TIER_KEY_RE` `RANGE_LIKE` `bracketPrefix` `stripBrackets` `tierKeyOfInner`）：
//   它们在原文件里是**模块内私有**，但 `abstract.js` 自己仍要用（`tierKeyOf` 那条链）⇒ 切出来后必须导出再 import 回去。
//   口径：**只补确实被用到的这 5 个**，不顺手把整个块的私有物全公开（导出面 = 契约面）。
// ★本模块**零 import**（叶子）：`RULE_CLASS_GUIDE`（形状那一族的一员）**随本块一起搬进来**，
//   所以连 `./abstract-shape.js` 都不需要 import。
//   ★依赖方向只有一条：`abstract.js → { abstract-shape.js, abstract-tier.js }`，**两个新模块都是叶子**。
//   ★设计稿里我先把这里写成"tier → shape"（以为要 import 那份形状定义），落地时被
//     `test/module-layout.test.js` 丙案④那条判据**当场纠正**——如实留档（本仓"设计稿也会错"那条纪律）。
//   ⚠ 因此**不许**为了"看起来对称"而给本模块加任何 import：它一旦 import `abstract.js` 就是循环依赖。

// ★★leg71：`RULE_CLASSES` / `RULE_CLASS_NONE` / `RULE_CLASSES_PACK` 三个常量**随本块一起搬**
//   （原在 `abstract.js:770-774`，与"法则分类"的判据分居两地 ⇒ 本棒把它们收成一处）。
//   依据：本块引用了它们（classifyRulesByKind/classifyRule/ruleKindsFromRaw），
//   而它们本身**零依赖**（纯字面量数组）⇒ 搬过来正好把本块的 out 降到 **0**。

// ★★★leg74 立、leg75 推广：有三个类别词**保留在词表里**，但它们的语义是**丢弃标记**，不是展示类别。
//   为什么保留（而不是从词表里删掉再让模型别标）：`rules` 是**未分类的纯字符串数组**，类别挂在 `判据` 那一列。
//   若把这几类从词表删掉，模型遇到"不算世界"的原文时**必须**塞进剩下那两类之一
//   ⇒ 多半进「其他」或「世界观设定」⇒ **再也认不出来、清不掉了**，而「世界观设定」**是进包的**
//   ⇒ 这些杂物会**混进每轮包**（比现在坏得多）。⇒ 口径：词表留着、**模型照标**、记账边界确定性丢弃。
// ★★★leg75（用户令「把这些全给我删干净了」，附重抽后的面板实拍）：leg74 只丢了 `文风禁令` 一类，
//   而同一份账上「其他（2 条）」也是杂物（`数据库配置：安装：下载最新版本数据库…` /
//   `表格模板导入：配置方法：状态栏倒数第三个按钮 → 载入模板`）⇒ 用户点名要一起清掉。
//   ⇒ 丢弃集从一类**推广到三类**：`文风禁令`（怎么写/怎么呈现）· `变量指令`（脚本去改变量的活）·
//     `其他`（格言警句与归不进四类的零碎）——**这三类本来就不进每轮包**，leg75 之后**也不进账本**。
//   ★保留的两类 = **世界账只装"这个世界是什么样"**：`判断依据`（拿它能算/能判）· `世界观设定`。
//   ★★纪律不变：丢弃**只凭模型的标注**，**不按关键词猜内容**（本仓明禁过拟合；猜错会误删真法则）。
export const RULE_CLASS_STYLE = '文风禁令';
export const RULE_CLASS_VAR = '变量指令';
export const RULE_CLASS_MISC = '其他';
// ★★唯一一份"哪几类不进账本"（三个入口 + 测试都读它，别在别处再写一遍这个集合）
export const RULE_CLASSES_DROP = [RULE_CLASS_STYLE, RULE_CLASS_VAR, RULE_CLASS_MISC];
export const RULE_CLASSES = ['判断依据', '世界观设定', ...RULE_CLASSES_DROP];
export const RULE_CLASS_NONE = '未分类';           // 老账的 rules 没有这一格（= 零迁移：没有就是没有，不猜也不重抽）
//   ★进包的两类（用户拍板：世界设定和判定依据都要）。顺序 = 进包顺序：**判据在前**
//     （它是"算得出结果"的那一小块，最稀缺；世界观随后补味）。
export const RULE_CLASSES_PACK = ['判断依据', '世界观设定'];
// ★★leg61（用户报「法则直接多了一大堆，但是设定的挡位有重复」）：**档位/法则的"可判等"归一**。
//
// 病（用户新账实测 · 大荒 103 条档位）——同一档被写了几种名字，**精确去重一条都拦不住**：
//   `T4 金丹境 (妖:小妖境 | 鬼:鬼将境 | 魔:真魔境)` · `T4金丹` · `T4金丹境` · `T4` · `地阶(T4-T6)`
//   `T10 天仙境` · `T10` · `T10真仙` · `天仙阶(T10)` …（`T1..T16` 每个档平均被写了 3 遍）
// 为什么会出现（不是模型乱写）：两遍抽取 × 多块，**同一张尺子散布在好几条条目里**
//   （境界表 / 法器品阶表 / 法术品阶表 / 战力换算表），每块模型按自己看到的那份措辞抄一遍，
//   块间合并是"并集去重"（`mergeCanonChunks`）⇒ 措辞不同就各留一条。
//
// 判据（**不认任何一本书的格式**，只认两件跨书成立的事）：
//   ① **档位核心符号**：`T`/`SSS`/`LV`/`阶` 这类"等级记号 + 数字/字母"——抽出来当键（`T4` / `SSS`）；
//      没记号的（纯文字档位名）用"去掉括注与空白后的整串"当键；
//   ② **引号与标点的宽度差异**一律抹平（`"…"` 与 `“…”` 用 `mergeCleaned` 同一把尺）。
// 取值纪律（**不许因此丢原话**）：同一键下**留最长的 note**、level 留**最干净的那条**
//   （最短且含核心记号）——最短的那个通常就是"档位名"本身，最长的 note 信息最全。
//   ★若两条的 note 长度相近但内容不同（真·两种说法）⇒ **不合并**，两条都留（宁多勿丢）。
export const TIER_KEY_RE = /(?:^|[^A-Za-z0-9])((?:T|LV|Lv|lv|LEVEL)\s*\d{1,2}(?!\s*[-~－—至]))/;
// 档区间/开放区间：`T1-T3` · `T9+` · `T4及以上` —— 这些**不是"某档"**（第一版把它们当成单档，当场压错了）
export const RANGE_LIKE = /(?:(?:T|LV)\s*\d{1,2}\s*[-~－—至]\s*(?:T|LV)?\s*\d{1,2})|(?:\+|及以上|以上|以下|起)/i;
// 轴名：**结构性取法**（第一版这里用了 `境/期/阶` 这类**中文词表**——那是过拟合，已撤）。
//   ★一个坑（踩过）：轴与键**必须是同一处算出来的**。第一版让 `tierAxisOf` 与 `tierKeyOf` 各自判括注，
//     两套规则不一致（一个"有括号就取"、一个"只在区间里取"）⇒ `T1 感气境 (妖:聚气…)` 与 `T1感气`
//     被分进两个轴、永远合不上。现在只有 `tierKeyOf` 一处算轴。
export function bracketPrefix(level) {
    const m = String(level ?? '').trim().match(/^([^（(]{1,12})[（(]/);
    return m ? m[1].trim() : '';
}
/** 去掉括注与首尾空白（★leg62b：`T1 感气境 (妖:聚气 | 鬼:游魂)` ⇒ `T1 感气境`）。 */
export function stripBrackets(s) {
    return String(s ?? '').replace(/[（(][^)）]*[)）]/g, '').trim();
}
export function tierKeyOfInner(level) {
    const s = String(level ?? '').trim();
    if (!s) return null;
    const m = s.match(TIER_KEY_RE);
    if (m && !RANGE_LIKE.test(s)) return m[1].replace(/\s+/g, '').toUpperCase();
    // 区间或没记号的：用"去掉括注与空白后的整串"当键（同一张表里的同一行仍能对上）
    return s.replace(/[（(][^)）]*[)）]/g, '').replace(/\s+/g, '');
}
/**
 * 档位去重键（纯函数，导出以便单测）：**轴 + 档位核心记号**。
 *   ★三条实测教训写在这里（第一版全踩过，改这一处之前先读）：
 *     ① **不要把范围写法当记号**：`T1-T4` / `T9+` / `T4及以上` 不是"某档"，是"档区间" ⇒ 用 `(?!\s*[-~至])` 挡掉；
 *     ② **不要回退去 note 里找记号**：那会让 `外门` 这类没记号的职阶名被卷进 `T4` 组；
 *     ③ **必须带轴**：`地阶(T4-T6)`（法器品阶表）与 `T4 金丹境`（境界表）是两张表的两件事。
 *   ★★第三点第一版用了 `境/期/阶` 这种**中文词表**判轴——那是过拟合（本仓明禁），现已改为结构性取法（见 `tierAxisOf`）。
 */
export function tierKeyOf(level, axis = '') {
    const k = tierKeyOfInner(level);
    if (!k) return null;
    return `${tierAxisOf(level, axis)}:${k}`;
}

/** 轴名（**唯一一处**算轴的地方，`tierKeyOf` 与 `dedupeTiers` 都读它——见上面的踩坑注释）。 */
export function tierAxisOf(level, axis = '') {
    const explicit = String(axis ?? '').trim();
    if (explicit) return explicit;
    // 轴 = `地阶(T4-T6)` 这种**括注前缀**（书自己的写法），且只在"这一档是个**区间**"时才用它当轴；
    //   ⚠否则 `T4 金丹境 (妖:小妖境…)` 的括注 `妖:小妖境` 会被误当轴 ⇒ 同一档因写法不同而分到不同轴。
    if (RANGE_LIKE.test(String(level ?? ''))) {
        const p = bracketPrefix(level);
        if (p) return p;
    }
    return '';
}

// 标点与引号的"同形归一"（纯函数）：只抹**写法差异**，不动一个字的内容。
//   为什么要它：实测同一句法则出现两次，差别只在 `"…"` 与 `“…”`、全角/半角逗号。
export function sameShapeKey(s) {
    return String(s ?? '')
        .replace(/[「」『』“”"']/g, '"')
        .replace(/[，、]/g, ',')
        .replace(/[：]/g, ':')
        .replace(/[；]/g, ';')
        .replace(/[（]/g, '(')
        .replace(/[）]/g, ')')
        .replace(/[。．]/g, '.')
        .replace(/\s+/g, '')
        .trim();
}

/**
 * ★leg62b：**同记号判定用的分组键**（与 `tierKeyOf` 分开，这里只要"能不能认出是同一档"）。
 *   为什么不复用 `tierKeyOf`：那个是 leg61 的**去重键**，只认 `T/LV/LEVEL` 这几种字母记号
 *   （`TIER_KEY_RE`）。换个记号体系（`X1` / `R2` / 别的书自己的写法）它就退化成"整串当键"，
 *   于是一组同档永远合不上——本棒的判据如果建在它上面，**就只对大荒那一套记号成立**（过拟合，
 *   本仓明禁）。本函数改成**结构性取法**：
 *     · **区间记号**（`X1-X3` / `X9+` / `X4及以上`）**不是某一档** ⇒ 给个唯一键，各自独立（不参与合并）；
 *     · 名首有"字母+数字"记号（`X1` / `T4` / `SSS2`）⇒ 用那个记号当键（`X1 甲境`、`X1甲`、`X1` 同键）；
 *     · 没有数字记号的（`甲级` / `黄阶` / `A班`）⇒ 用"去掉括注与空白后的整串"当键（只有写法完全相同才合）。
 */
export function tierGroupKeyOf(level) {
    const s = String(level ?? '').trim();
    if (!s) return '';
    if (RANGE_LIKE.test(s)) return `·range·${s}`;                    // 区间/开放区间不参与合并
    const m = s.match(/^([A-Za-z]{1,6}\s*\d{1,3})/);
    if (m) return m[1].replace(/\s+/g, '').toUpperCase();
    return stripBrackets(s).replace(/\s+/g, '');
}

/**
 * ★★leg62b（用户令「之前不就说了重复问题啊」）：**同一档的几种写法合并成一条**。
 *
 * 病（本棒量准的账）：`dedupeTiers(103) → 95` 只吃掉 8 条，面板上同一档仍出现 4~5 次——
 *   大荒 **16 组同记号 / 多出 54 条**：`T1 感气境 (妖:聚气 | 鬼:游魂 | 魔:凝血)` · `T1感气` · `T1` · `T1 感气境`。
 * 为什么下面那条判据治不住：它留了个"宁可多不可丢"的口子——
 *   **note 差别大就两条都留**。而"同一档的两种写法"恰恰 note 经常不同
 *   （`T1` 的注是"凡界修行区域底层境界"、`T1感气` 的注是"眉心生光…"）⇒ 一条都合不上。
 *   ★真因（本棒的判断，可复核）：`note` 不全是"原文里对这一档的说明"，
 *     **有一半是"它属于哪张表"的括注**（`(妖:聚气 | 鬼:游魂)` 是妖族那一支的叫法，
 *     不是"这一档意味着什么"）。拿这种注当"两种说法"的判据，必然判成"两条不同的档位"。
 *
 * 判据（纯函数 · 零词表，用 `tierGroupKeyOf`）：
 *   同键 ⇒ **就是同一档** ⇒ 合成一条：
 *     · `档` 取**名字最完整**的那条（不含括注优先，然后取最长）
 *     · `注` 取**最像说明**的那条（不含括注、最长者）；
 *       ★组里还有**别的、互不包含的**说明（真·两种说法）⇒ 用 `｜` 接在后面，**一条不丢**
 *         （"只提取不创作"仍守住：拼的是各条原话，不是新写的句子）。
 *   为什么优于"都留"：面板是以"档"为单位看的，同记号出现 5 次对读者毫无信息量；
 *     合并后**信息量不变**（原话都还在），**行数**才是读者真正要的东西。
 */
export function mergeSameTierEntries(list = []) {
    const items = (Array.isArray(list) ? list : [])
        .map((x) => ({ level: String(x?.level ?? '').trim(), note: String(x?.note ?? '').trim(), axis: String(x?.axis ?? '').trim() }))
        .filter((x) => x.level);
    const groups = new Map();
    const order = [];
    for (const it of items) {
        const key = tierGroupKeyOf(it.level) || `·${it.level}`;
        if (!groups.has(key)) { groups.set(key, []); order.push(key); }
        groups.get(key).push(it);
    }
    const bracketCount = (s) => (String(s).match(/[（(]/g) || []).length;
    /** "像说明的注"：去掉括注后仍有 ≥4 字，且不是把档位名重复一遍 */
    const informative = (note, level) => {
        const n = stripBrackets(note);
        return n.length >= 4 && !n.includes(level) && !level.includes(n);
    };
    const out = [];
    for (const key of order) {
        const g = groups.get(key);
        if (g.length === 1) { out.push(g[0]); continue; }
        const best = [...g].sort((a, b) => (bracketCount(a.level) - bracketCount(b.level)) || (stripBrackets(b.level).length - stripBrackets(a.level).length))[0];
        const notes = [...new Set(g.map((x) => x.note).filter((n) => n && n !== best.level))]
            .filter((n) => informative(n, stripBrackets(best.level)))
            .sort((a, b) => b.length - a.length);
        const kept = [];
        for (const n of notes) {
            if (kept.some((k) => k.includes(n))) continue;
            for (let i = kept.length - 1; i >= 0; i -= 1) if (n.includes(kept[i])) kept.splice(i, 1);
            kept.push(n);
        }
        out.push({ level: best.level, note: kept.join('｜') || best.note, ...(best.axis ? { axis: best.axis } : {}) });
    }
    return out;
}

/**
 * 档位并集去重（纯函数 · 可测）：见上面 `tierKeyOf` 头注的口径与取值纪律。
 *
 * ★合并规则只有一条，而且**不看长度阈值**（第一版写"长度差 ≤25% 就算同一条"⇒ 太宽；第二版写"短注就合"
 *   ⇒ 那个 24 字是照大荒那份表反推的，属过拟合，两版都已撤）：
 *   **轴相同 ∧ 记号相同 ∧ 一边的 note 是另一边的子串（或抹平标点后一致）** ⇒ 同一条，留最长的 note。
 *   其余一律**留着**（宁多勿丢）——包括"同一档的两种不同说法"。
 *   ★leg62b：那条"宁可多不可丢"的口子**在面板上就是用户看到的重复**（同记号 4~5 条）⇒
 *     现在由 `mergeSameTierEntries` 在**更靠下游**的两处收口：
 *     `scalesToFlat`（概念表→旧两列）与 `scalesFromFlat`（旧账推导）。
 *     ★为什么不在本函数里改：本函数是"并集去重"（块间合并用），口径一变会动到抽取链；
 *       而"读者看到的重复"是**呈现问题**，收在呈现那一层更安全（也不影响既有真账读数）。
 */
export function dedupeTiers(list = []) {
    const out = [];
    const idx = new Map();                       // key → out 里的下标
    for (const it of (Array.isArray(list) ? list : [])) {
        const level = String(it?.level ?? '').trim();
        const note = String(it?.note ?? '').trim();
        if (!level || !note) continue;
        const key = tierKeyOf(level, tierAxisOf(it));
        if (!key) { out.push({ level, note, ...(tierAxisOf(it) ? { axis: tierAxisOf(it) } : {}) }); continue; }
        if (!idx.has(key)) { idx.set(key, out.length); out.push({ level, note, ...(tierAxisOf(it) ? { axis: tierAxisOf(it) } : {}) }); continue; }
        const cur = out[idx.get(key)];
        const curNote = String(cur.note);
        const sameSentence = curNote.includes(note) || note.includes(curNote)
            || (curNote.length === note.length && sameShapeKey(curNote) === sameShapeKey(note));
        if (!sameSentence) { out.push({ level, note, ...(tierAxisOf(it) ? { axis: tierAxisOf(it) } : {}) }); continue; }
        if (note.length > curNote.length) cur.note = note;                  // 留信息量最大的 note
        const curLevel = String(cur.level);
        if (level.length < curLevel.length) cur.level = level;              // level 留最干净的那条（实测 `T4` 优于 `T4 金丹境 (妖:…)`）
    }
    return out;
}

/**
 * ★★★leg74 立（用户令「我不是说不要文风禁令了吗？」→ 拍板「**连账本一起清掉**」）·
 *   ★★★leg75 推广（用户令「把这些全给我删干净了」）：
 *   **把"不算世界"的那几类从法则账本里摘掉** —— 这是**唯一一处实现**，三个入口共用
 *   （`sanitizeCanon` 收账时 / `mergeCanonChunks` 并集后 / `settle.migrateStyleRulesFromCanon` 载入期清旧账）。
 *   ★丢弃集 = `RULE_CLASSES_DROP`（`文风禁令` / `变量指令` / `其他`，唯一定义在文件头）。
 *
 * 三层各自不同，先分清（这是 leg74 查清的现场，别混）：
 *   · **每轮包**：`pack.js` 从 leg64 起就只取 `判断依据 + 世界观设定` ⇒ 这三类**一条都没进过包**；
 *   · **账本**：但 `canon.rules` 里**一直留着**它们（leg64 当时的拍板是"其余三类一条都不删，全留账给面板"）；
 *   · **面板**：于是面板专门开段「文风禁令（N 条）」「其他（N 条）」给作者看。
 *   ⇒ 用户看到的是**面板**那一屏，指出的是**根子**：那些条目
 *     （`必须放在 <content> 标签内` / `角色对话：（角色名）` / `数据库配置：安装：下载最新版本数据库…`）
 *     既不是世界事实、也不是判定锚 ⇒ **根本不该被抽出来记账**。
 *
 * ★★为什么是"记账时丢弃"而不是"改提示词别抽"（**本设计的关键，别改成那样**）：
 *   见 `RULE_CLASS_STYLE` 上面那段——词表一旦删掉这几类，模型会把它们塞进「世界观设定」，
 *   那就**再也清不掉**、而且会混进每轮包。⇒ 口径：词表留着、模型照标、**记账边界确定性丢弃**。
 *   ★丢弃凭**模型的标注**，不靠关键词猜内容（本仓明禁过拟合；猜错会误删真法则）。
 *
 * 幂等 · 纯函数：**没有可摘的就原样返回**（调用方据此做到"无可摘即不改一字"，与 `slimLegacyCompile` 同款）。
 * ★与 `keyByPrefix` 的关系（leg74 设计时推演出的洞，别删这一段）：摘完之后**只从幸存者那里重挂类别**——
 *   丢弃者的键**先删**，所以这几类**不可能**顺着"互为前缀的近义两版"偷偷继承回来。
 *   ★★顺序是设计的一部分：**先删键、再重挂**，两步不许对调（对调 ⇒ 长版继承到已废弃类别）。
 */
export function pruneJunkRules(rules, ruleKinds) {
    const list = (Array.isArray(rules) ? rules : []).map((r) => String(r ?? '').trim()).filter(Boolean);
    const kinds = ruleKinds && typeof ruleKinds === 'object' && !Array.isArray(ruleKinds) ? { ...ruleKinds } : {};
    const dropped = [];
    const isDropped = (v) => RULE_CLASSES_DROP.includes(String(v ?? '').trim());
    // ① 摘掉挂在这几类上的条目 —— ★先删键，断掉"继承"的来路
    for (const s of list) {
        if (!isDropped(kinds[s])) continue;
        dropped.push(s);
        delete kinds[s];
    }
    // ② 陈旧键（键指向的原文已不在账上）里凡是这几类的，一并清掉
    for (const k of Object.keys(kinds)) {
        if (isDropped(kinds[k])) delete kinds[k];
    }
    if (!dropped.length) return { rules: list, ruleKinds: kinds, dropped };
    const kept = list.filter((s) => !dropped.includes(s));
    // ③ 幸存者重挂类别（与 `sanitizeCanon`/`mergeCanonChunks` 同一条 `keyByPrefix` 口径）。
    //    此时 `kinds` 里**已无这几类的值** ⇒ 重挂不可能把它们传回来。
    const rebased = keyByPrefix(kept, new Map(Object.entries(kinds)));
    for (const s of kept) {
        if (Object.prototype.hasOwnProperty.call(kinds, s)) continue;
        if (rebased.has(s)) kinds[s] = rebased.get(s);
    }
    // ★★★leg75 补的第四步：**最后按 `kept` 白名单收口**——把"键指向账上已没有的法则"的**孤儿键**扫干净。
    //   ★为什么前面三步挡不住它（leg75 实测出来的，别删这一步）：孤儿键有两种来路，两种都绕开前三步——
    //     ① **陈旧键的值是"保留类"** ⇒ 第②步只清"已废弃类别"的值，**不碰它**；
    //     ② 它**不在 `list` 里** ⇒ 第①步的 `for (const s of list)` **遍历不到它**（那句 delete 与此无关！）。
    //     ⇒ 实测（`leg75-diag-bite3d.mjs`）：`rules=['…（补）'] + kinds={'…（说法）':'判断依据'}`
    //       ⇒ 旧版会留下 1 个孤儿键（指向账上没有的法则），而**判据 ① 那条"防孤儿键"的自证恰好照不到它**。
    //   ★纪律：本仓判"这一格在不在"用 `in`/`Object.keys`（leg64 零迁移锁），两列劈叉是真缺陷——所以
    //     "账本问什么、这一格就答什么"必须是**结构性**的，不能靠上面那三步的巧合。
    const clean = {};
    for (const s of kept) {
        if (Object.prototype.hasOwnProperty.call(kinds, s)) clean[s] = kinds[s];
    }
    return { rules: kept, ruleKinds: clean, dropped };
}

/**
 * ★★★leg64：**法则按类别分堆**（唯一一份口径——面板与进包**读同一个函数**）。
 *   为什么不各写一遍：leg63 那句不准确的文案（"这些表每轮都在模型的包里当锚"）就是
 *   "面板自己推一遍进包口径"的产物 ⇒ 面板报的和包里真干的会各说各话。
 *   ⇒ 口径：分类只此一处，`pack.js` 的 `buildRuleAnchor` 与 `render.js` 的面板都读它。
 *   返回：`{ 计数, 未标数, 判据 }`——`判据` 就是**进每轮包的那些原话**（按账本序）。
 *   ★`未标数` = 没有类别或有未知类别的条数（老账全落这里）；面板据此如实报"为什么一条都没进包"。
 */
export function classifyRulesByKind(rules, ruleKinds) {
    const list = Array.isArray(rules) ? rules : [];
    const kinds = ruleKinds && typeof ruleKinds === 'object' && !Array.isArray(ruleKinds) ? ruleKinds : {};
    const byKind = { 判断依据: [], 世界观设定: [], 文风禁令: [], 变量指令: [], 其他: [], [RULE_CLASS_NONE]: [] };
    for (const r of list) {
        const s = String(r ?? '').trim();
        if (!s) continue;
        const k = String(kinds[s] ?? '').trim();
        // 词表外（含"没有这一格"）一律落 `未分类`——**不猜**（与 `classifyRule` 同一条纪律）。
        const bucket = RULE_CLASSES.includes(k) ? k : RULE_CLASS_NONE;
        byKind[bucket].push(s);
    }
    return {
        计数: {
            判断依据: byKind.判断依据.length,
            世界观设定: byKind.世界观设定.length,
            文风禁令: byKind.文风禁令.length,
            变量指令: byKind.变量指令.length,
            其他: byKind.其他.length,
        },
        未标数: byKind[RULE_CLASS_NONE].length,
        // ★进包两类，**按 `RULE_CLASSES_PACK` 的顺序**（判据在前、世界观随后）——进包闸按这个序吃预算。
        判据: [...byKind.判断依据, ...byKind.世界观设定],
        判据条数: byKind.判断依据.length,
        世界观条数: byKind.世界观设定.length,
    };
}

/**
 * ★leg64：**取第 i 条法则的类别**（模型交的是 `判据` 那一列，与 `rules` 按位对齐）。
 *   能容的三种形态（**都是真机上会出现的**，不猜）：
 *     ① 并列数组且**等长** ⇒ 按位取（本棒提示词要求的口径）；
 *     ② 数组**不等长/缺项** ⇒ 缺的按 `未分类`（宁可漏判据，也不许错位贴类别——错贴会让"其他"混进包）；
 *     ③ 对象形态（`{法则原文: 类别}`）⇒ 按原文串取（模型自作主张换形态时的兜底）。
 *   ★词表外的值一律落 `未分类`（这就是"契约层放行、净化层收口"那条纪律的具体做法）——
 *     模型自己发明一个类别词（`设定`/`机制`…）时，它**不会**被当成判据放进每轮包。
 */
export function classifyRule(rawKinds, i) {
    if (Array.isArray(rawKinds)) {
        const v = String(rawKinds[i] ?? '').trim();
        return RULE_CLASSES.includes(v) ? v : RULE_CLASS_NONE;
    }
    return RULE_CLASS_NONE;
}
/** ★leg64：对象形态的类别表（`{法则原文: 类别}`）——只收词表内的值。 */
export function ruleKindsFromRaw(rawKinds) {
    if (!rawKinds || typeof rawKinds !== 'object' || Array.isArray(rawKinds)) return new Map();
    const out = new Map();
    for (const [k, v] of Object.entries(rawKinds)) {
        const s = String(k ?? '').trim();
        const c = String(v ?? '').trim();
        if (s && RULE_CLASSES.includes(c)) out.set(s, c);
    }
    return out;
}
/**
 * ★leg64：**把类别从"被去重丢掉的那条原文"挪到胜者身上**。
 *   为什么必须有这一步（本棒在设计时逐条推演出来的洞）：
 *     `dedupeRules` 会把"互为前缀的近义两版"合成一条，**留最长的**。而类别是按原文串挂的
 *     ⇒ 若模型给短的那版贴了 `判断依据`、给长的贴了 `其他`（或没贴），胜者就**拿不到判据类别**
 *     ⇒ 那条判据**静默地进不了包**（正是本棒要治的病，换了张脸回来）。
 *   ⇒ 口径：先精确命中；不中时，在原文里找"以胜者为前缀 / 胜者是它的前缀"的那条，**取它的类别**。
 */
export function keyByPrefix(rawList, kinds) {
    const out = new Map();
    for (const s of (Array.isArray(rawList) ? rawList : [])) {
        if (!s || kinds.has(s) || out.has(s)) continue;
        for (const [k, v] of kinds) {
            if (k === s) { out.set(s, v); break; }
            if (k.startsWith(s) || s.startsWith(k)) { out.set(s, v); break; }
        }
    }
    return out;
}

/** 法则并集去重（纯函数 · 可测）：按"同形键"去重（含**互为前缀**的那种近义），留最长的那条原话。 */
export function dedupeRules(list = []) {    // ★写法纪律（本函数踩过两次坑，改之前先读）：
    //   ① **不用 Map 迭代**（`for…of idx` / `idx.forEach` 在这条路上实测"一次都不迭代"⇒ 整段变死代码）；
    //      用最笨的两层数组循环，一眼能验。
    //   ② 前缀比较用 `startsWith`，**不拼正则**——法则原文里全是 `(`/`+`/`[`（`T1-T4(感气→金丹)跨境:…`），
    //      拼正则会被当成捕获组/量词。
    const out = [];          // [{ s, key }]
    for (const r of (Array.isArray(list) ? list : [])) {
        const s = String(r ?? '').trim();
        if (!s) continue;
        const key = sameShapeKey(s);
        if (!key) continue;
        let handled = false;
        for (let i = 0; i < out.length; i += 1) {
            const cur = out[i];
            // ① 完全同形 ⇒ 留最长（信息最全）
            if (cur.key === key) {
                if (s.length > cur.s.length) { cur.s = s; cur.key = sameShapeKey(s); }
                handled = true;
                break;
            }
            // ② **互为前缀的近义**（实测形态：同一句法则，一处抄到"…有合"就断、一处抄全了）。
            //    ★必须**按谁更长分两支**（第一版两支写成同一个条件，等于永远只走第二支 ⇒ 把抄全的丢了）。
            //    长度差 ≤45% 是防"世界存在严酷的法则壁垒…"把后面所有以它开头的**另一条**法则吞掉。
            const curLonger = cur.key.length >= key.length;
            const near = curLonger ? cur.key.length <= key.length * 1.45 : key.length <= cur.key.length * 1.45;
            if (near && curLonger && cur.key.startsWith(key)) {
                if (cur.s.length < s.length) { cur.s = s; cur.key = sameShapeKey(s); }   // 旧的更全（或平分）⇒ 留旧的
                handled = true;
                break;
            }
            // ★新的更长且以旧的为前缀 ⇒ **换掉**（第一版这里写成"直接丢新的"⇒ 把抄断的留下、抄全的丢掉）
            if (near && !curLonger && key.startsWith(cur.key)) {
                cur.s = s;
                cur.key = sameShapeKey(s);
                handled = true;
                break;
            }
        }
        if (handled) continue;
        out.push({ s, key });
    }
    return out.map((x) => x.s);
}

// ★★★leg71（丙案）：`RULE_PACK_TOP` / `RULE_PACK_STR_MAX` / `RULE_PACK_CHAR_TOP` **随"法则分类"一起搬来**
//   （原在 `abstract.js:764-806`）。它们与上面那几个类别常量是同一件事的两半：
//   **"哪些法则进包"**（`RULE_CLASSES_PACK`）与 **"进包时按什么封顶"**（这三个数）。
//   ★唯一的消费者是 `pack.js` 的 `buildRuleAnchor`；面板（`render.js`）读它们报"其中 N 条每轮进包"。
//   ★为什么必须一起搬：只搬类别、把上界留在原处 ⇒ `pack.js` 仍要回头 import 那个 3000 行的抽取器
//     ⇒ 丙案"让消费者关系变正确"这个目标就落空了（细案 §B3.3 正是这么写的）。
// ★★★leg64（用户令「规则会怎么样？规则太多会怎么样？」→ 拍板「只进『判断依据』」）：
//   **法则的类别词表**（唯一一份口径：提示词、净化、面板、进包四处共用这一个数组）。
//
//   病（leg63 §1.2 的消费面审计 + 本棒复查）：`rules` **只有 `render.js` 读**——
//     判定原则（`T1-T4跨境→DC24` / `1点仙阶≈1,000,000点下界` / `一次只能突破一道心防`）
//     模型**一个字看不到**，于是它每轮写实力/好感/战果时只能自己发明数。
//     而 `刻度` 那一块已经解决了同一类问题（把"可判等的那一小块"递进包当锚）——本条是它的兄弟。
//
//   为什么要有类别而不是"整包塞进去"（本棒按真账 179 条逐条读出来的）：
//     · 三国 32 条里 **11 条是文风禁令**（`绝对禁止现代口语语法`）——那是**怎么写**，不是**判什么**；
//     · 大荒 129 条里 `【肉身全量初始化铁律】…必须全量 replace` / `【背包联动铁律】…delta -1`
//       是**变量更新指令**（MVU 脚本那一层的活），进叙事提示词是纯粹的噪声；
//     · 还有格言警句（`功成身退天之道` / `无欲则刚`）与**世界观陈述**（`三十三重天`）——
//       第一版把世界观当成了"不必进包"，**实机证明那是错的**（见下）。
//   ⇒ 只有「这一轮判定要用的那几条数」进包；其余**留账给面板**（一条都不删）。
//   ★★★leg64 实机重抽后的修正（用户令「世界设定和判定依据都要」）：
//     第一版只有「判断依据」进包、「其他」当兜底桶 —— 实机 318 条当场证明这个分法**是错的**：
//     模型判得没错（世界事实进 `其他`、判据进 `判断依据`），错的是**我把世界观当成了残渣**。
//     ⇒ 世界观**升格成一类**（`世界观设定`），并与判据**一起进包**。
//   ★★★leg74/leg75（用户令「连账本一起清掉」→「把这些全给我删干净了」）：
//     上面那句"其余留账给面板（一条都不删）"**已废**——文风禁令/变量指令/其他这三类
//     **既不进包、也不再进账本**（收账/并集/载入期三处按模型标注确定性丢弃，见 `pruneJunkRules`）。
//     ★留在这里作历史口径（leg64 当时的拍板就是这个，别以为写错了）。
//   体积纪律（与 `buildScaleAnchor` 同尺，写在真源处）：上界**必须存在**——
//   leg63 §1.5 量到的病正是"`rules` 没有任何上界判据"，而 `刻度` 有（表 ≤16 · 档 ≤24 · 维 ≤8）。
//   大荒真账 129 条 6,286 字符（占 30k 包预算 21.0%，若整包塞入）。
//   ★★★进包两类（用户令「世界设定和判定依据都要」）⇒ 闸**按类分**、且**判据先占**：
//     判据是"算得出结果"的那一小块（最稀缺），先吃预算；世界观吃剩下的。这样"两类都要"才
//     不会变成"世界观把判据挤出去"（实机第一版正是这么坏的：262 条误标判据把真判据挤出包外）。
//   ★两道闸的分工（本棒实测后定的，别把条数闸当主闸）：
//     · **主闸 = 总字符**（`RULE_PACK_CHAR_TOP`）——真正稀缺的是包预算，字符才是它的直接度量；
//     · **条数闸只当"荒谬上界"**（`RULE_PACK_TOP`）——防"几千条一句话的判据"把包塞爆。
//   ★为什么不把条数闸设成主闸（本棒第一版就是那样，实测当场暴露）：大荒 70 条判据平均仅 **50 字符**
//     ⇒ 条数闸 40 会**先于**字符闸咬住 ⇒ **静默丢掉约 27 条真判据**，而字符闸明明还差得远。
//     "条数"不是预算的度量，"字符"才是 ⇒ 主闸必须是后者（同 `刻度` 那边"表数必须 ≥ 档/维各自需要的表数之和"
//     是同一类教训：**用错的单位去封顶，会从结构上把预算卡死**）。
export const RULE_PACK_TOP = 160;                  // 荒谬上界（真账最多 70 条 ⇒ 留 2 倍余量；本闸**只防荒谬**）
//   单条长度上限：**用户拍板 500**（原 120）。实测（大荒重抽后的账）：判据里最长的一条 193 字符，
//   **只有 2 条超过 120**（截掉 138 字符）⇒ 抬到 500 基本等于"不再截任何一条"。
//   ★为什么不干脆去掉长度闸：它是**防散文**的那一道（`刻度` 那块没有这个风险，因为档位名天生短）；
//     留一个够宽的上限，比"没有上限"更能在下一本书上兜住"一整段正文被当成一条法则"。
export const RULE_PACK_STR_MAX = 500;
// ★主闸：进包总字符上限（= 30k 包预算的 **26.7%**，与 `刻度` 块合计约 30%）。
//   实测（大荒 318 条那一份账，按机械分类估）：判据约 4,900 字符 + 世界观约 2,300 字符 ≈ 7,200
//   ⇒ 设 8,000 让"两类都进"能真正落地，同时**硬挡住"把世界书倒进包"**（318 条全文 10,684 字符 = 35.6%）。
export const RULE_PACK_CHAR_TOP = 8000;
