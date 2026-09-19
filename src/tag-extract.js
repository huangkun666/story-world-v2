// story-world-v2/src/tag-extract.js
// ★标签提取（S3 新口径，设计见 `docs/spec-tagged-actions-extraction.md`）：
//   聊天模型产出的**正文** → 结构化的"本轮已经发生过的事"。
//
// ============================ 为什么是它、不是老口径 ============================
// 老口径 `extract.js` 的 `extractMove(text)` 读的是**玩家自己打的那句话**，靠一张 13 条正则的
//   动词表硬猜"这一句是什么动作"。那条路在本仓有两个病（源码可证）：
//   ① **表外的动作不存在**——"我拔剑冲上去"扫完 13 条一条都不中 ⇒ `verb = null`
//      ⇒ `tick.js` 的 `move.verb ? move : null` 把**整条事实丢掉**（玩家做了什么一个字都进不了世界模型）；
//   ② 它还得**归成一类**（"拔剑冲阵"被写成"迎战"），信息在这里降级一次。
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
// 纯函数：零 DOM、零传输、零 import（叶子模块），Node 可测。
// 分层归属：引擎规则侧（S3）。

/** 行动标签一行的切格符：★**全角**竖线（半角 `|` 是 Markdown 表格与代码块里最常见的字符，认它必然误切）。 */
export const TAG_FIELD_SEP = '｜';

// 四族正则。★为什么都写成"行尾即止"（`[^\n【]+`）：模型偶尔会把下一个标签写在同一行，
//   `[^\n【]+` 让它在下一个 `【` 前停住，不至于把两行吃成一格。
const RE_ELAPSED = /【时长】\s*([^\n【]+)/g;
// ★冒号全角半角都收（`：`/`:`）——模型两个都会写；场景是行内闭合的（`【场景：X】`）。
const RE_SCENE = /【场景\s*[:：]?\s*([^】\n]*)】/g;
const RE_ACTION = /【行动】\s*([^\n【]+)/g;

/** 形近字归一：去空白 + 全角/半角不敏感（NFKC）+ 小写。别名对齐靠它（实测"小娥 ≠ 白小娥"那类坑）。*/
function normName(v) {
    return String(v ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

/** 地点归一：只去空白与原样（★**不做 NFKC**——地名要写回账上，改了字就改了地名）。 */
function normPlace(v) {
    return String(v ?? '').trim();
}

/**
 * 名号 → 实体（三档：id → name → aliases）。
 * ★为什么连 id 也认：模型偶尔会把 id 照抄进标签（名册里两样都给了它），认下来比丢掉好。
 * ★★优先级写死（leg89 用户拍板「模型认得出那就直接按照插件的正名来看」）：
 *   **账上正名 → 书里正名 → 别名**。为什么正名必须在别名之前：别名可能跟别人的正名撞车
 *   （书里既有「小娥」这条、又是「白小娥」的别名）⇒ 先收正名，别名再收时才不会把真名盖掉。
 * @param entities 账上实体（`[{id,name,aliases}]`）
 * @param canon    书名录（`[{name,aliases}]`，来自 `context.setting.frozen.canon.bookEntities`）
 *                 ——★别名住在这里，账上没有（播种不拷别名，见设计文档 §14）
 */
function makeResolver(entities = [], canon = []) {
    const byKey = new Map();
    const add = (key, id) => {
        const k = normName(key);
        if (!k) return;
        if (byKey.has(k)) return;              // 先到先得（确定性，不随机）
        byKey.set(k, id);
    };
    // ① 账上：id 与正名
    const entityKeys = new Set();
    for (const e of entities) if (e?.id) entityKeys.add(normName(e.id));
    for (const e of entities) if (e?.id) add(e.id, e.id);
    for (const e of entities) if (e?.id) entityKeys.add(normName(e.name));
    for (const e of entities) if (e?.id) add(e.name, e.id);
    // ② 书里正名：**只补账上还没有的键**，且**不给 id**（账上没这个人 ⇒ 写它就是归不上，不许凭空造）。
    //    ⚠这一档是"占位"用的：它让"这个名字是一条真名"这件事优先于"它还是别人的别名"（见 ③）。
    const canonNameId = new Map();   // 书里正名 → 账上实体 id（账上没有就是 null）
    for (const c of canon) {
        const k = normName(c?.name);
        if (!k) continue;
        canonNameId.set(k, entityKeys.has(k) ? byKey.get(k) : null);
        add(c.name, null);
    }
    // ③ 别名（最后收：正名/账上已经占了键的，别名不许盖）
    for (const e of entities) if (e?.id) for (const a of e.aliases || []) add(a, e.id);
    for (const c of canon) {
        // 书里的别名指回**账上同名的那个实体**（有才是 id，没有就是 null ⇒ 归不上，如实报数）
        const target = canonNameId.get(normName(c?.name)) ?? null;
        for (const a of c.aliases || []) add(a, target);
    }
    return (raw) => byKey.get(normName(raw)) || null;
}

/** 标签块的开围栏（**围栏行只有它自己**才算——围栏后面跟别的不算）。 */
const RE_FENCE_OPEN = /^```\s*tags\s*$/;
/** 闭围栏：三个反引号或三个波浪号，同样要求整行只有它。 */
const RE_FENCE_CLOSE = /^(?:```|~~~)\s*$/;

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
 *   ★★**降级铁律**：块不在 ⇒ 退回原来的逐行扫（`mode:'all'`，**老账、老聊天逐字节不变**）。
 *     为什么必须留：模型漏写围栏时，"**整轮零标签**"比"少认几条"严重得多。
 *
 * @returns {{start:number,end:number,closed:boolean}|null} 行号区间（**不含围栏行本身**）；没命中 ⇒ null
 */
export function shellRange(text) {
    const lines = String(text ?? '').split(/\r?\n/);
    const open = lines.findIndex((l) => RE_FENCE_OPEN.test(String(l).trim()));
    if (open < 0) return null;
    // 闭围栏从开围栏**下一行**往回找（`closed` 如实标出"模型忘收尾"那种）；
    //   没闭合 ⇒ 吃到正文末尾——截断/漏收尾时标签仍然要能读出来。
    for (let i = open + 1; i < lines.length; i += 1) {
        if (RE_FENCE_CLOSE.test(String(lines[i]).trim())) return { start: open + 1, end: i, closed: true };
    }
    return { start: open + 1, end: lines.length, closed: false };
}

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
 *   shell: {found: boolean, mode: 'shell'|'all', closed: boolean|null},
 * }}
 */
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

    const elapsedParts = [];
    const malformed = [];
    const unresolved = new Map();          // 名字 → 条数（同一名字只报一次）
    const notNoted = new Map();            // 名字 → 他这一轮做过的事（★不进账，但**要递给世界模型看**）
    const playerPids = normName(playerId);
    const actions = [];                    // 主语已归一、地点已继承的中间结果（未封顶）
    const playerSeen = [];                 // 主角那几条（按出现序）

    let sceneText = null;                  // 当前场景原文（最近的 `【场景：…】`）
    let sceneId = null;                    // 归一到地点表的结果；null = 表里没有（或不在地点表口径里）

    // ★逐行扫，**不是先把正文按块切开**：块切法在"模型漏写块头"时会把整块丢掉；
    //   逐行扫的下限是"只丢那一行"，与"丢了什么要能被看见"这条口径一致。
    // ★★★leg93：**先定扫描范围**——标签块在 ⇒ **只扫块里**（块外的 `【】` 落在范围外，
    //   正文怎么引用标签格式都不会被当成行动）；块不在 ⇒ 退回逐行扫全篇（老行为逐字节不变）。
    const shell = shellRange(src);
    const mode = shell ? 'shell' : 'all';
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
        if (mode === 'shell' && (i < shell.start || i >= shell.end)) continue;
        const raw = lines[i].trim();
        if (!raw) continue;

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
        // ④ 其它一律不看（正文归模型自由写；只有 `【…` 开头却不像上面三族的行才当"形状不合"留痕）
        if (/^【(时长|场景|行动)/.test(raw)) malformed.push(raw.slice(0, 40));
    }

    // ★`parsed` 的语义（leg89 实测校正，写死防将来改歪）：**正文里解析出的行动条数**
    //   （含归不上名字的、含主角的）——它是"这一轮故事里发生了多少件事"的读数。
    //   ⇒ `parsed - count` **不再等于**截断数（那会让"归不上名字"和"被封顶截掉"混成一笔账）；
    //     截断看 `count`、归不上看 `unresolved`，两笔账各说各的。
    const parsed = actions.length + playerSeen.length + [...unresolved.values()].reduce((s, n) => s + n, 0);
    const cap = Number.isFinite(maxActions) && maxActions > 0 ? Math.floor(maxActions) : Infinity;
    const kept = actions.slice(0, cap);

    return {
        actions: kept,
        // ★散文并列，不是时长合计（合计就要做算术 = 编数）
        elapsed: elapsedParts.join('；'),
        elapsedParts,
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
        // ★leg93：**这一次是按哪个口径扫的**——如实交出去（面板读数要用它把"没包块"说出来）。
        shell: { found: Boolean(shell), mode, closed: shell ? shell.closed : null },
    };
}

/**
 * ★这一包"值不值得进包"——**没抽到任何东西 ⇒ 键不出现**（照 `recalled` 那条口径：
 *   与"空着就是空着"一致，且让没标签的老聊天**逐字节回到今天**，不动既有键序锁）。
 */
export function hasTagFacts(f) {
    if (!f) return false;
    return Boolean(
        f.actions?.length || f.notNoted?.length || f.player || f.elapsed || f.unresolved?.length
        || f.malformed?.length || f.playerDropped,
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
    if (f.player) bits.push(`主角 ${1 + (f.playerDropped || 0)} 条（入账 1）`);
    if (f.unresolved?.length) {
        const who = f.unresolved.slice(0, 3).map((u) => (u.n > 1 ? `${u.name}×${u.n}` : u.name)).join('、');
        // ★措辞如实（leg89 更正）：这些人的行动**不在账上**，但**已经递给世界模型看过**——
        //   不许写成"丢了"（那会让玩家以为东西没了），也不许写成"入账了"（那是假话）。
        bits.push(`不在名册 ${f.unresolved.length} 个名字（${who}）——他们这轮的事没入账，但已递给世界模型`);
    }
    if (f.elapsed) bits.push(`时长 ${f.elapsed}`);
    if (f.malformed?.length) bits.push(`形状不合 ${f.malformed.length} 行`);
    return `标签: 行动 ${bits.join(' · ')}`;
}
