// story-world-v2/src/entity-lookup.js
// 按需查书补字段（实力 / 位置）——编排层纯函数 + 注入式模型调用。
// 细案：docs/spec-entity-field-lookup.md（用户 2026-09-11 批准：「a,做吧」= R2 取拒整步）。
//
// 为什么是"按需"而不是"初始化全量"（用户定调）：
//   · 623 实体里每轮真正上场的只有几个（实测 silent 稳定 620-622），全量初始化＝给永不出场者预取；
//   · 按需只为"真进镜头又被点到"的角色付一次，且中途新生的人同样能补。
// 为什么选择权归 LLM（不是引擎镜头）：
//   pack.js 的 lensList 是**引擎**纯函数按 30k 预算截前缀——镜头外的人连"想让谁动"都表达不了；
//   leg24 片3 前按分量算的静默线实测把 345/346 全判静默（引擎实际上禁止了所有人出手）。
//   故本模块的"选人"交给模型，**引擎只提供全量事实（书序、不排序不裁剪）并只做校验**：
//   不在册/已灭/已退休 → 拒；去重；超上限（ROUND_PICK_CAP=15）→ 拒整条并退回上轮名单。
//
// 三个失败态必须在账上分开（本模块的核心判据，出处=用户提问"如果部分字段加载不出来怎么办
// （注意，这是 llm 没有加载到而不是这个字段没有的情况）"）：
//   ok      = 模型回了非空字符串 → 落值 + 留痕（from/sources/fetchedAt）
//   pending = 查了、模型没给这一栏（**可能只是漏抽**）→ 不落值、只记尝试；到 ENTITY_LOOKUP_MAX_ATTEMPTS 停止自动重试
//   absent  = **只有引擎能确定性判定**"书里没有任何相关条目"才允许记（模型没返回一律记 pending）
//   红线：不许用空值反推事实空缺；不许给缺失字段写占位/默认值。
//
// 分层归属：编排层（铁律 9）。零 DOM、零 Node 内建、零索引库依赖——浏览器与 Node 同构。

export const ROUND_PICK_CAP = 15;          // 提案（用户 2026-09-11 拍板）：每轮上场实体上限
export const ENTITY_LOOKUP_FIELDS = ['实力', '位置'];   // 本模块的面（势力不抽实力——用户拍板）
export const ENTITY_LOOKUP_MAX_ATTEMPTS = 2;            // 提案：同字段自动重试上限（防死循环）
export const ENTITY_LOOKUP_MAX_FAILS = 3;               // 提案：连续失败熔断阈值（世界推进优先）

// ---------- 名号对齐（不按位置对齐：模型少一项就会全错位；重名时按 id 回填） ----------
function rosterIndex(world) {
    const byName = new Map();
    for (const e of world?.entities || []) {
        const arr = byName.get(e.name) || [];
        arr.push(e);
        byName.set(e.name, arr);
    }
    return byName;
}
// 模型回的名号 → 实体：唯一命中才算；重名/未命中一律丢弃（宁可漏回填，不可错回填）
function resolveByName(byName, raw) {
    const arr = byName.get(String(raw ?? '').trim());
    return arr && arr.length === 1 ? arr[0] : null;
}
// 可被选中的实体：在册且未灭/未退休（门控面同一口径）
const pickable = (e) => Boolean(e) && e.status !== 'dead' && e.status !== 'retired';

// ---------- ① 选人（LLM）：引擎只给全量名号，不排序、不裁剪、不给优先级 ----------
export function selectCandidates(world, { cap = ROUND_PICK_CAP } = {}) {
    const ents = (world?.entities || []).filter(pickable);
    const idIndex = new Map(ents.map((e) => [e.id, e]));
    return { ents, idIndex, cap };
}

// 选人名单的一行。leg25 d（细案 spec-lookup-batch-refresh §5）：补上账上**已有**的「实力/位置」原话——
//   为什么必须有：选人原先只给 id/名字/类别，而主调用（pack.js:111）反而带实力 ⇒ **选拔的人比用人的信息还少**，
//   于是"两个差距极大的实体被摆到同一场斗争"这件事引擎既无从避免、也无环节拦得住（用户 2026-09-11 提出）。
//   口径（一条都不能破）：①只摆**书里的原话**（引擎不换算、不排序、不比较——design-core §4 第 1 条）；
//   ②**未查/没有的写 `—`，绝不填占位值/默认值**（硬规矩二「空着就是空着」）；③势力不显示实力（旧口径）。
export function selectRosterLine(e) {
    const kind = e.kind === 'faction' ? '势力' : '角色';
    const val = (f) => (typeof e[f] === 'string' && e[f].trim() ? e[f].trim() : '—');
    const power = e.kind === 'faction' ? '—' : val('实力');
    return `${e.id}\t${e.name}\t${kind}\t${power}\t${val('位置')}`;
}

export function buildSelectPrompt(world, { cap = ROUND_PICK_CAP, moveFact = null } = {}) {
    const { ents } = selectCandidates(world, { cap });
    const agendas = (world?.agendas || []).filter((a) => !a.closed);
    const events = (world?.events || []).filter((e) => !e.closed);
    const player = (world?.entities || []).find((e) => e.id === world?.context?.playerId);
    return [
        '你是世界模拟器的"本轮上场选择器"。世界不围绕任何一方转：选人只看局势，不看主角特殊。',
        `任务：从下面的【在册名号】里选出**本轮会出手或会被牵动的实体**，最多 ${cap} 个。`,
        '纪律：',
        `1. 只能用【在册名号】里给出的 id 原样照抄，不许发明 id、不许写名号代替 id；`,
        `2. 最多 ${cap} 个，宁可少不可凑数；没有该出手的就少选；`,
        '3. 只输出严格 JSON，不要任何解释文字：{"pick":["<id>","<id>"]}',
        '———— 在册名号（书序，未排序、未裁剪）————',
        '（列：id / 名号 / 类别 / 实力 / 位置。实力与位置是**书里的原话**，未查到的写 — 。',
        '  它只帮你判断"谁做得到、谁跟谁碰得上"，**不是分数、不含引擎判断**；不要拿它推断剧情。）',
        ents.map(selectRosterLine).join('\n'),
        '———— 在飞盘算 ————',
        agendas.length ? agendas.map((a) => `${a.owner}：${a.goal}（${a.progress ?? 0}/${a.maxSteps ?? 0}）`).join('\n') : '（无）',
        '———— 未决事件 ————',
        events.length ? events.map((e) => `${e.title}（牵动 ${(e.ripples || []).join('、') || '—'}）`).join('\n') : '（无）',
        '———— 玩家落子事实 ————',
        player ? `${player.name}（${player.id}）：${String(moveFact?.verb || '（本轮无落子）')}` : '（本世界无玩家棋子）',
    ].join('\n');
}

function parseJson(text) {
    const s = String(text ?? '').replace(/```(?:json)?/gi, '').trim();
    const m = /\{[\s\S]*\}/.exec(s);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * runSelect({ world, transport, cap }) → { picks, error, warning }
 * 失败语义（细案 §4）：调用失败/坏 JSON/超限/空 → picks=null + warning（调用方退回上轮名单），**绝不替模型改选**。
 */
export async function runSelect({ world, transport, cap = ROUND_PICK_CAP, moveFact = null } = {}) {
    const { idIndex } = selectCandidates(world, { cap });
    let text = '';
    try {
        text = await transport(buildSelectPrompt(world, { cap, moveFact }));
    } catch (err) {
        return { picks: null, error: String(err?.message || err), warning: `选人调用失败：${String(err?.message || err)}` };
    }
    const obj = parseJson(text);
    if (!obj || !Array.isArray(obj.pick)) {
        return { picks: null, error: 'bad-json', warning: '选人回文无法解析（本轮退回上轮名单）' };
    }
    const raw = obj.pick.map((x) => String(x ?? '').trim()).filter(Boolean);
    const unknown = raw.filter((id) => !idIndex.has(id));
    if (unknown.length) {
        return { picks: null, error: 'unknown-id', warning: `选人含不在册/已灭 id（${unknown.slice(0, 3).join('、')}）——本轮退回上轮名单` };
    }
    const uniq = [...new Set(raw)];
    if (uniq.length > cap) {
        return { picks: null, error: 'over-cap', warning: `选人超上限（当前 ${uniq.length}/${cap}）——本轮退回上轮名单` };
    }
    return { picks: uniq, warning: null };
}

// 兜底候选（选人失败时的地板名单）：玩家 + 在飞盘算属主 —— 引擎事实，不含任何"谁更重要"的判断
export function fallbackCandidates(world) {
    const out = [];
    const push = (id) => { if (id && !out.includes(id)) out.push(id); };
    push(world?.context?.playerId);
    for (const a of (world?.agendas || [])) if (!a.closed) push(a.owner);
    return out;
}

// ---------- ② 查书（LLM）：只喂"选中且缺字段"的实体在世界书里的原文 ----------
const bookNameOf = (world, e) => (world?.entities || []).find((x) => x.name === e.name && x.id === e.id)?.name || e.name;
const bookEntriesFor = (world, e) => {
    const book = world?.context?.setting?.frozen?.canon?.bookEntities || [];
    const name = bookNameOf(world, e);
    return book.filter((b) => b?.name === name).map((b) => b.name);
};

// 缺字段 = 该字段既没有值、也不是"未加载到上限/书未明述"（查书标记闸）
export function missingFields(entity, meta, fields = ENTITY_LOOKUP_FIELDS) {
    const rec = meta?.entityFields?.[entity.id] || {};
    return fields.filter((f) => {
        if (typeof entity[f] === 'string' && entity[f].trim()) return false;      // 已有值 → 不再查
        const st = rec.attempts?.[f]?.state;
        if (st === 'ok' || st === 'absent') return false;                          // 已定案 → 不再查
        if ((rec.attempts?.[f]?.count ?? 0) >= ENTITY_LOOKUP_MAX_ATTEMPTS) return false;   // 到重试上限 → 停手
        return true;
    });
}

// ---------- 覆盖重查（leg25 d，细案 spec-lookup-batch-refresh §4.2）----------
// 背景：`absent`（书未明述）是**永久闸**——missingFields 对 absent/ok 一律跳过。
//   而 leg25 d 之前存在两个真 bug（取书读错字段 + 异步 bookText 被当同步用），
//   已把一批字段**误写成** `absent`；不开口子它们永远查不动（假「书未明述」不可自愈）。
// 口径（用户 2026-09-11 拍板「要：带覆盖开关」）：
//   forceFields = 'absent'（默认）→ 只重查**被定为 absent 或卡在重试上限**的字段
//   forceFields = 'all'            → 连已有值的字段也重查（面板上另有一个勾选，默认不选）
export const FORCE_MODES = ['absent', 'all'];
export function forcedFields(entity, meta, fields = ENTITY_LOOKUP_FIELDS, { forceFields = 'absent' } = {}) {
    const rec = meta?.entityFields?.[entity.id] || {};
    return fields.filter((f) => {
        if (forceFields === 'all') return true;                                    // 连已有值也重查
        const hasValue = typeof entity[f] === 'string' && entity[f].trim();
        if (hasValue) return false;                                                // 已有值不动（除非 all）
        const st = rec.attempts?.[f]?.state;
        // 只覆盖"已定案为 absent"与"卡在重试上限"两类；`ok` 必有值，上面已被 hasValue 挡掉
        if (st === 'absent') return true;
        if ((rec.attempts?.[f]?.count ?? 0) >= ENTITY_LOOKUP_MAX_ATTEMPTS) return true;
        return false;
    });
}

/**
 * pickOneForLookup(world, id, { fields, forceFields }) → { entity, fields, missing }
 * 单个实体这一轮该查哪几栏。`forceFields` 非空 = 覆盖模式（能清掉假的「书未明述」）。
 */
export function pickOneForLookup(world, id, { fields = ENTITY_LOOKUP_FIELDS, forceFields = null } = {}) {
    const entity = (world?.entities || []).find((e) => e.id === id) || null;
    if (!entity) return { entity: null, fields: [], missing: [] };
    const missing = forceFields
        ? forcedFields(entity, world?.meta, fields, { forceFields })
        : missingFields(entity, world?.meta, fields);
    return { entity, fields, missing };
}

// ---------- 批量补全的分批（细案 §3.1：**按条目载荷打包**，不按实体个数）----------
/**
 * planBatches({ world, ids, fields, forceFields, budgetChar, bookText }) → { batches, totalEntries, totalChars, skipped }
 * 分批口径（这是本细案最容易做错的一处，实测教训见 `spec-lookup-batch-refresh.md` §7 订正）：
 *   · 载荷 = 这批实体**命中条目的并集**（实体大量共享条目：吞天妖王/混元妖圣同属一条）⇒ **条目级去重**；
 *   · 一条实体进哪批，取决于它的条目能不能装进当前批预算；装不下就封批；
 *   · 按实体个数分批（如"每 15 个一次"）会**严重高估**调用次数——那是错的。
 * 纯函数：只做规划，不调模型（bookText 只用于"这条实体命中哪些条目"的确定性查询）。
 */
export async function planBatches({ world, ids = [], fields = ENTITY_LOOKUP_FIELDS, forceFields = null, budgetChar = 60000, bookText = null } = {}) {
    const idIndex = new Map((world?.entities || []).map((e) => [e.id, e]));
    const skipped = [];
    const todo = [];
    for (const id of ids) {
        const e = idIndex.get(id);
        if (!e) { skipped.push({ id, reason: 'not-in-roster' }); continue; }
        const { missing } = pickOneForLookup(world, id, { fields, forceFields });
        if (!missing.length) { skipped.push({ id, reason: 'nothing-to-ask' }); continue; }
        todo.push({ id, entity: e, missing });
    }
    const batches = [];
    const entrySeen = new Set();
    const totalEntryKeys = new Set();
    let cur = null;
    const keysOf = async (e) => {
        if (typeof bookText !== 'function') return [];
        const src = await resolveBookSource(bookText, e);
        return src.ok ? (src.entries || []) : [];
    };
    for (const item of todo) {
        const entries = await keysOf(item.entity);
        // 这一条给本批带来的**新增**载荷（条目级去重；用条目名+文本长度当键，避免同一条重复计费）
        const fresh = entries.filter((x) => {
            const k = `${x?.name ?? ''}\u0000${String(x?.text ?? '').length}`;
            return !entrySeen.has(k);
        });
        const addChar = fresh.reduce((s, x) => s + String(x?.text ?? '').length, 0);
        if (cur && cur.chars + addChar > budgetChar) { batches.push(cur); cur = null; }
        if (!cur) cur = { ids: [], chars: 0, entries: 0, items: [] };
        cur.ids.push(item.id);
        cur.items.push(item);
        cur.chars += addChar;
        for (const x of fresh) {
            const k = `${x?.name ?? ''}\u0000${String(x?.text ?? '').length}`;
            entrySeen.add(k);
            totalEntryKeys.add(k);
            cur.entries += 1;
        }
    }
    if (cur && cur.ids.length) batches.push(cur);
    return {
        batches,
        totalEntries: totalEntryKeys.size,
        totalChars: batches.reduce((s, b) => s + b.chars, 0),
        skipped,
    };
}

/**
 * runBatchLookup({ ssot, transport, bookText, ids, fields, forceFields, tick }) → { ssot, stats, warning, calls }
 * 查**指定的一批**实体（面板单实体 / 批量补全的分批，都走这里；与每轮前置步同一收口）。
 * 与 runEntityLookupStep 的区别：不选人（名单由调用方给定），其余口径完全一致。
 */
export async function runBatchLookup({ ssot, transport, bookText, ids = [], fields = ENTITY_LOOKUP_FIELDS, forceFields = null, tick = 0, bookEntries = null } = {}) {
    const out = { ssot, stats: null, warning: null, calls: 0, locationInherited: 0 };
    if (!ids.length) return out;
    // 位置继承是**零 token 结构推断**（组织条目驻地 → 成员），不依赖模型通道 ⇒ 没通道也照跑
    const withInherit = (world) => {
        if (!Array.isArray(bookEntries) || !bookEntries.length) return world;
        const d = deriveLocationFromBook({ world, entities: null, entries: bookEntries });
        out.locationInherited = d.stats.inherited;
        return d.ssot;
    };
    if (!transport) return { ...out, ssot: withInherit(ssot) };
    const { batches, skipped } = await planBatches({ world: ssot, ids, fields, forceFields, bookText });
    if (skipped.length) out.warning = `${skipped.length} 个实体无需查（${skipped.slice(0, 3).map((s) => s.reason).join('/')}）`;
    const flat = batches.flatMap((b) => b.items);
    if (!flat.length) return { ...out, ssot: withInherit(ssot) };
    const idList = flat.map((x) => x.id);
    const res = await runLookup({ world: ssot, transport, ids: idList, bookText });
    out.calls += 1;
    if (res.byName === null) {
        out.warning = `查书调用失败：${res.error}`;
        return { ...out, ssot: noteFailure(ssot, tick) };    // 失败不写痕（这回没查成 ≠ 书里没有）
    }
    let readFailed = false;
    const sources = {};
    for (const it of flat) {
        const src = await resolveBookSource(bookText, it.entity);
        if (!src.ok) readFailed = true;
        sources[it.id] = src.ok ? src.entries.map((x) => x?.name ?? x) : undefined;
    }
    if (readFailed) out.warning = '查书取不到世界书原文（本轮不写「书未明述」，下轮再试）';
    const applied = applyLookup({ ssot, ids: idList, byName: res.byName, sources, tick, fields });
    out.stats = applied.stats;
    // 查书之后再跑一遍位置继承：本批查回来的"位置"若没能归一化进集，结构推断可以补上（只填空位）
    const finalSsot = withInherit(applied.ssot);
    return { ...out, ssot: noteSuccess(finalSsot) };
}

export function buildLookupPrompt(world, targets, fields = ENTITY_LOOKUP_FIELDS) {
    const lines = [
        '你是世界设定的字段抽取器。只提取不创作：只从给定原文里取事实，原文没写的一律留空，绝不推测、不补全。',
        '任务：为下面的每个名号，抽出它在**原文里写明**的字段。',
        '口径（必须遵守）：',
        '• 实力 = 原文里写明的该名号**自身**的实力描述，**照抄原话**（短则几个字、长则一句，不超过 30 字）：',
        '  —— 分段境界的书就抄档位原话（如「T9渡劫巅峰」「化神期」）；不分段的书就抄它的原话写法（如「剑术通神」「执玄铁剑」「三万铁骑」「大乘期魔头」）。',
        '  —— **以本书实际写法为准，不要套用别的书的档位体系**；原文用判断词（如「顶级宗门」「很强」）就照抄那个词，但这个判断词必须**本来就在原文里**——原文没写就不许自己下判断（实测反例：模型曾凭空答出「武道顶级宗门」，原文里并没有这句）。',
        '• 位置 = 原文里写明的**所在地/驻地短语**（如「北俱荒洲不周山」「中天神洲·中州」）；',
        '• **势力条目不抽实力**（势力只写它自己的性质/规模描述，与角色档位不是一回事）——势力条目的"实力"一律留空；',
        '• 只写该名号**自身**写明的字段；只在它的成员/属下身上写明的，不算它的；',
        '• 取不到就不写这个键（**不要填 ""、不要填"未知"、不要猜**）。',
        `输出严格 JSON：{ "<名号>": { ${fields.map((f) => `"${f}": "原文原话"`).join(', ')} } }`,
        '不要输出任何解释文字。',
        '———— 原文 ————',
    ];
    for (const t of targets) {
        const src = (t.entries || []).filter((x) => x && x.text);
        lines.push(`【${t.name}】`);
        if (!src.length) lines.push('（本书没有该名号的条目）');
        else for (const s of src) lines.push(String(s.text));
    }
    return lines.join('\n');
}

/**
 * runLookup({ world, transport, ids, bookText }) → { byName, error }
 * bookText 是注入面（浏览器=从 canon.bookEntities 取原文；Node 诊断=直接给文本），
 *   本模块不读世界书文件，保持纯编排层。
 * 失败语义：调用失败/坏 JSON → { byName: null, error }（调用方**不写任何痕迹**，下轮重试）。
 */
/**
 * resolveBookSource(bookText, entity) → { ok, entries }
 * bookText 注入面取值：**取一次、用两次**（原来 runLookup 与 sources 各取一遍 = 两次真实取书，
 *   在异步取书下既浪费又会"两次结果不一致"）。
 * 返回 `{ ok, entries }`：`ok:false` = **书没读到**（取书抛错/一本书都没取到）——与"书里没有该条目"
 *   是两件事，调用方必须分开处置（见 applyLookup 的 sources 语义）。兼容三种注入面：
 *   异步函数 / 同步函数 / `{ [名号]: entries[] }` 映射。
 */
// ---------- C1（leg25 d，用户拍板「合并吧」）：查书的「位置」并入实体 `location` ----------
// 为什么必须**归一化**后才并（实测依据，别直接写进去）：
//   位置集是 `location` 的校验白名单（`check-step.js:99/134-140`，`location ∈ context.positions`）。
//   实测用户账本：位置集 60 项 = 「未明 / 九宸玄陆 / 十万大山 / 中天神洲 / 中州 / 西极昆仑山 …」，
//   而查书抽出的「位置」原话常是**复合写法**「南荒部洲·十万大山」——**不在集里**（集里是分开的两项）。
//   ⇒ 直接把原话写进 `location` 会灌进集外值，破坏"位置集是唯一地名表"的纪律。
// 口径（三级，宁缺勿造）：
//   · 精确命中集中一项 → `location` = **集内那一项**（原书原话另外留档在 entityFields.fields.位置.value）
//   · 命中多项 → 不写 location（歧义不猜），只留档
//   · 一项都不命中 → 不写 location，只留档（查书标记照旧）
// 引擎在这里**不发明地名**：写进去的每个值都是位置集里原有的一项。
const LOCATION_FIELD = '位置';
const LOCATION_FALLBACK = '未明';   // 位置集首项（derivePositions 的兜底词），永远是合法值

/**
 * normalizeToPositionSet(value, positions) → { value, how, candidates }
 *   how = 'exact'（原话就是集内一项）| 'longest'（取集内被包含的**最长**那项）| 'none'
 * **为什么命中多项时取"最长"而不是判歧义**（实测口径）：
 *   用户位置集 60 项里**父子地名同时存在**（中天神洲/中州、南荒部洲/十万大山、东胜沧洲/…）。
 *   原话「中天神洲·中州」按父区/子区都说得通，但 `location` 是"驻点"——**更具体的那一项才有用**；
 *   判歧义会让绝大多数复合原话都写不进去（实测复合写法是主流），等于合并白做。
 *   取最长 = "该串包含的、位置集里最具体的那个地名"，仍是**集内原有项**，引擎不发明地名。
 *   '未明' 是兜底词，**不参与包含匹配**（否则任何含"未明"的串都会命中它）。
 */
export function normalizeToPositionSet(value, positions = []) {
    const v = String(value ?? '').trim();
    const set = (Array.isArray(positions) ? positions : []).map((p) => String(p ?? '').trim()).filter(Boolean);
    if (!v || !set.length) return { value: null, how: 'none', candidates: [] };
    if (set.includes(v)) return { value: v, how: 'exact', candidates: [v] };
    const hits = set
        .filter((p) => p !== LOCATION_FALLBACK && (v.includes(p) || p.includes(v)))
        .map((p) => {
            const at = v.lastIndexOf(p);
            // 复合写法是「父区·子区」：分隔符（·/•/空格/、）**之后**的那一项才是具体驻地。
            //   同长度时用它决胜——实测「南荒部洲·十万大山」两项都是 4 字，只按长度会错挑到大区。
            const sepAfter = [v.lastIndexOf('·'), v.lastIndexOf('•'), v.lastIndexOf(' '), v.lastIndexOf('、'), v.lastIndexOf('　')]
                .some((s) => s >= 0 && at > s);
            return { p, at, sepAfter };
        })
        .sort((a, b) => b.p.length - a.p.length || Number(b.sepAfter) - Number(a.sepAfter) || b.at - a.at);
    if (!hits.length) return { value: null, how: 'none', candidates: [] };
    return { value: hits[0].p, how: 'longest', candidates: hits.map((h) => h.p) };
}

export async function resolveBookSource(bookText, entity) {
    let raw;
    try {
        raw = typeof bookText === 'function' ? await bookText(entity) : (bookText?.[entity?.name] || []);
    } catch (err) {
        return { ok: false, entries: [], error: String(err?.message || err) };
    }
    if (raw && !Array.isArray(raw) && typeof raw === 'object' && 'ok' in raw) {
        return { ok: raw.ok !== false, entries: Array.isArray(raw.entries) ? raw.entries : [] };
    }
    return { ok: true, entries: Array.isArray(raw) ? raw : [] };
}

export async function runLookup({ world, transport, ids, bookText } = {}) {
    const ents = (world?.entities || []);
    const idIndex = new Map(ents.map((e) => [e.id, e]));
    const targets = (await Promise.all((ids || []).map(async (id) => {
        const e = idIndex.get(id);
        if (!e) return null;
        // bookText 注入面**可能是异步的**（浏览器 `web/index.js` 的 `bookTextForEntity` 就是 async）——
        //   必须 await：当同步用会拿到 Promise，`.length` 为 undefined。第二十五棒 d 实测后果：
        //   下游 `.map` 对 Promise 抛 TypeError → 前置步被 tick.js 的 catch 静默吞掉 →
        //   `applyLookup` 永不执行 → 盘上 `entityFields` 恒为 0 条（用户实拍"看不到属性"的真因）。
        const src = await resolveBookSource(bookText, e);
        return { id: e.id, name: e.name, entries: src.entries, readFailed: !src.ok };
    }))).filter(Boolean).filter((t) => t.entries.length);
    if (!targets.length) return { byName: {}, skipped: 'no-source', ok: true };
    let text = '';
    try {
        text = await transport(buildLookupPrompt(world, targets));
    } catch (err) {
        return { byName: null, error: String(err?.message || err) };
    }
    const obj = parseJson(text);
    if (!obj || typeof obj !== 'object') return { byName: null, error: 'bad-json' };
    const out = {};
    for (const t of targets) out[t.name] = obj[t.name] ?? null;   // 缺失=null（查书标记里算"没给"）
    return { byName: out, ok: true };
}

// ---------- ③ 回写（引擎纯函数）：查书标记 + 逐字段独立 + 不可变风格 ----------
/**
 * applyLookup({ ssot, ids, byName, sources, tick, fields }) → { ssot, stats }
 * byName === null（调用失败）→ 原样返回（**不写任何痕迹**：这回没查成 ≠ 书里没有）。
 * sources: { [entityId]: string[] | undefined }
 *   `[...]` = 查了这几条世界书条目（模型没给值 → pending「未加载到」）
 *   `[]`    = 书读到了、但书里确实没有该名号 → **才**允许 absent「书未明述」
 *   `undefined` = **这一轮没读成书**（取书抛错/书没取到）→ 一律 pending，**绝不记 absent**
 *     （第二十五棒 d：旧法把"读不到书"与"书里没有"同形处置 ⇒ 误写「书未明述」并永久锁死该栏，
 *      违反硬规矩「绝不用空值反推『书里没有』」）
 */
export function applyLookup({ ssot, ids, byName, sources = {}, tick = 0, fields = ENTITY_LOOKUP_FIELDS } = {}) {
    const stats = { ok: 0, pending: 0, absent: 0, unread: 0, written: [] };
    if (byName === null || byName === undefined) return { ssot, stats };
    const entities = [...(ssot?.entities || [])];
    const roster = rosterIndex(ssot);
    const idxById = new Map(entities.map((e, i) => [e.id, i]));
    const prevMeta = ssot.meta || {};
    const entityFields = { ...(prevMeta.entityFields || {}) };

    for (const id of ids || []) {
        const at = idxById.get(id);
        if (at === undefined) continue;
        const e = entities[at];
        const rec = entityFields[id] ? { ...entityFields[id] } : {};
        const fieldsRec = { ...(rec.fields || {}) };
        const attempts = { ...(rec.attempts || {}) };
        const src = sources[id];
        const readOk = Array.isArray(src);          // 只有"真读到书"才允许写 absent
        // 回文按名号对齐：**唯一命中**才算（重名/未命中一律丢弃——宁可漏填，不可错填；
        //   实测世界里 623 实体重名 0 组，但防御不能省：模型少一项就会让位置对齐全错位）
        const owner = resolveByName(roster, e.name);
        const reply = owner && owner.id === id ? (byName[e.name] ?? null) : null;
        const next = { ...e };
        let changed = false;
        const provenance = {};   // 本次回写要落到 entityFields 的来源标记（如「位置来源」）

        for (const f of fields) {
            const v = reply && typeof reply[f] === 'string' ? reply[f].trim() : '';
            if (v) {
                // 有值：落账 + 留痕（from = 查过的条目；实测模型回的就是原文原话）
                next[f] = v;
                changed = true;
                fieldsRec[f] = { value: v, from: (src && src[0]) || null, fetchedAt: tick };
                attempts[f] = { count: (attempts[f]?.count ?? 0) + 1, lastTriedAt: tick, state: 'ok' };
                stats.ok += 1;
                stats.written.push(`${e.name}.${f}=${v}`);
                // C1（用户拍板「合并吧」）：查书的「位置」**并入实体 `location`**——
                //   但必须**归一化到位置集**才写（集是 location 的校验白名单，实测原话常是
                //   「南荒部洲·十万大山」这种集外复合写法）。归一化结果记在 `位置in集`，供面板/审计看。
                if (f === LOCATION_FIELD) {
                    const norm = normalizeToPositionSet(v, ssot?.context?.positions);
                    fieldsRec[f] = { ...fieldsRec[f], 位置in集: norm.value, 位置归一: norm.how };
                    // 来源落账：模型从原文原话抽的 ⇒ "书里原话"（与结构推导的"位置来源"分开存）
                    provenance.位置来源 = '书里原话';
                    if (norm.value) {
                        next.location = norm.value;   // 写进去的**一定是位置集里原有的一项**（引擎不发明地名）
                        stats.located = (stats.located || 0) + 1;
                    } else {
                        stats.locatedMiss = (stats.locatedMiss || 0) + 1;   // 集外/歧义 → 只留档，不写 location
                    }
                }
                continue;
            }
            // 没值：查书标记分开——**只有"真读到书 + 书里确实没有该条目"才允许 absent**（书未明述）；
            //   读不到书（src === undefined）一律 pending，下轮再试（不许拿"读不到"反推"书里没有"）
            const count = (attempts[f]?.count ?? 0) + 1;
            const state = !readOk ? 'pending' : (src.length ? 'pending' : 'absent');
            attempts[f] = { count, lastTriedAt: tick, state };
            if (!readOk) stats.unread += 1;
            else if (src.length) stats.pending += 1;
            else stats.absent += 1;
        }
        if (changed) entities[at] = next;
        entityFields[id] = {
            ...rec,
            fields: fieldsRec,
            attempts,
            sources: [...new Set([...(rec.sources || []), ...(readOk ? src : [])])],
            ...provenance,
        };
    }
    return {
        ssot: { ...ssot, entities, meta: { ...prevMeta, entityFields } },
        stats,
    };
}

// ---------- ④ 熔断（世界推进优先：查书绝不阻塞 tick） ----------
export function noteFailure(ssot, tick = 0) {
    const meta = ssot?.meta || {};
    const f = { fails: (meta.entityLookup?.fails ?? 0) + 1, lastFailAt: tick };
    if (f.fails >= ENTITY_LOOKUP_MAX_FAILS) f.disabledUntil = tick + ENTITY_LOOKUP_MAX_FAILS;   // 连续失败 → 停几轮
    return { ...ssot, meta: { ...meta, entityLookup: f } };
}
export function noteSuccess(ssot) {
    const meta = ssot?.meta || {};
    if (!meta.entityLookup) return ssot;
    return { ...ssot, meta: { ...meta, entityLookup: { fails: 0, lastFailAt: meta.entityLookup.lastFailAt ?? null } } };
}
export function lookupDisabled(ssot, tick = 0) {
    const u = ssot?.meta?.entityLookup;
    return Boolean(u && Number.isFinite(u.disabledUntil) && tick < u.disabledUntil);
}

// ---------- 位置继承（leg25 d，用户问「不能给个粗略位置吗，比如东边西边」）----------
// 为什么这是对的解法（实测依据，别改成"让模型猜方位"）：
//   ①**书里有现成的粗粒度**——位置集里天然存在"洲"级大区：东胜沧洲(东)/西极贺洲(西)/北俱荒洲(北)/
//     南荒部洲(南)/中天神洲(中)，它们本身就是方位大区名。**不必发明"东边/西边"这种引擎自造词**。
//   ②**结构可推、零 token**：算力实测（用户真书）——组织条目的"核心底蕴"明写驻地
//     （`《昆仑道宫》核心底蕴: 居西极贺洲西极昆仑山玉虚秘境`），且条目的 `key` 里就带**位置集内的地名**
//     （昆仑道宫 key 含 `[玉虚秘境, 西极贺洲]`）；成员（代表人物）的驻地**就是所属组织驻地**。
//     ⇒ 只要"实体名 ∈ 某组织条目（条目名或正文成员行）"，就能从**条目结构**推出位置，不调模型、不猜。
//   ③实测覆盖：能定位 470/1472（32%），其中 **260（18%）落到"洲"级**；剩下 68% 是
//     `万劫不磨/万劫炼狱锁/一念化分身` 这类功法物品名——本来就不是人、没有驻地。
// 纪律：推出的值**必须 ∈ 位置集**（引擎不发明地名）；只填空位（已有 location 的不覆盖）；
//   只对条目里**确实属于它**的名号生效（条目名本身 / 正文 `- 名号 (…)` 成员行），绝不张冠李戴。
const MEMBER_LINE = /^[-*·•\s]*([^\s(（:：]{2,16})\s*[（(]/gm;   // 正文成员行「- 名号 (男, T8…): …」

/**
 * deriveLocationFromBook({ world, entities, entries }) → { ssot, stats }
 * 零 token 结构推断：组织条目的驻地 → 其成员实体的 location（归一化到位置集后写入）。
 * 只在实体**尚无位置**（缺 location 或 location === '未明'）时生效。
 *
 * ★适用范围（实测，别外推）——本机制**只在两个前提同时成立**时有效：
 *   ①位置集是一张**干净的地名表**（书里 `kind='location'` 条目被抽出来了）；
 *   ②书里有**明述驻地**（`所在地/核心底蕴/驻地: …`）。
 *   实测 8 本世界书：大荒两前提都满足 → 能推 ~28%；**其余 4 本 `kind=location` 条目为 0**（位置集退化成
 *   ['未明']）⇒ 推出 0–1%。**所以它是"大荒这类结构化势力书"的能力，不是通用能力。**
 *   ⇒ 因此本函数**宁缺勿造**：推不出就什么都不写（绝不写错位置——错位置比「未明」更坏）。
 */
export function deriveLocationFromBook({ world, entities = null, entries = [] } = {}) {
    const stats = { inherited: 0, skipped: 0, assigned: [] };
    const positions = world?.context?.positions || [];
    if (!positions.length || !Array.isArray(entries) || !entries.length) return { ssot: world, stats };
    const targets = (entities || world?.entities || []).filter((e) => e && e.name);
    const byName = new Map(targets.map((e) => [String(e.name).trim(), e]));
    // 安全闸（实测教训）：只有在**来源串明显比地名更长**时才接受——
    //   否则脏位置集（人名/设定词混进去）会让"曹操"匹配上"曹操"这种自指，推出满账假位置。
    //   例：来源「南荒部洲·十万大山」(9字) → 「十万大山」(4字) 可接受；
    //       来源「曹操」(2字) → 「曹操」(2字) **拒绝**（等长 = 自指，不是"地点包含关系"）。
    const ACCEPT = (sourceStr, loc) => {
        const s = String(sourceStr || '').trim();
        return loc.length >= 2 && s.length > loc.length;
    };
    // 条目 → 位置集内的地名（取最长，与 normalizeToPositionSet 同口径）
    const entryLoc = (entry) => {
        const keys = Array.isArray(entry?.key) ? entry.key : [entry?.key];
        const cand = [];
        for (const k of keys) {
            const s = String(k ?? '').trim();
            const n = normalizeToPositionSet(s, positions);
            if (n.value && ACCEPT(s, n.value)) cand.push(n.value);
        }
        // 正文"核心底蕴/所在地"里的地名也收（如「居西极贺洲西极昆仑山玉虚秘境」）
        const m = /(?:所在地|核心底蕴|驻地)[:：]?\s*([^\n。；]{2,30})/.exec(String(entry?.content || ''));
        if (m) {
            const s = m[1].trim();
            const n = normalizeToPositionSet(s, positions);
            if (n.value && ACCEPT(s, n.value)) cand.push(n.value);
        }
        if (!cand.length) return null;
        cand.sort((a, b) => b.length - a.length);
        return cand[0];
    };
    const patch = new Map();   // 实体 id → 位置
    for (const entry of entries) {
        const loc = entryLoc(entry);
        if (!loc) continue;
        const names = new Set();
        const c = String(entry?.comment || '').trim();
        if (c) names.add(c);
        const text = String(entry?.content || '');
        for (const m of text.matchAll(MEMBER_LINE)) names.add(m[1].trim());
        for (const nm of names) {
            const e = byName.get(nm);
            if (!e) continue;
            const has = typeof e.location === 'string' && e.location.trim() && e.location !== '未明';
            if (has) { stats.skipped += 1; continue; }          // 已有位置不动（只填空位）
            if (patch.has(e.id)) continue;
            patch.set(e.id, { loc, from: String(entry?.comment || '').trim() });   // 连"哪一条推出来的"一起记
        }
    }
    if (!patch.size) return { ssot: world, stats };
    const prevMeta = world?.meta || {};
    const entityFields = { ...(prevMeta.entityFields || {}) };
    const list = (world?.entities || []).map((e) => {
        const hit = patch.get(e.id);
        if (!hit) return e;
        stats.inherited += 1;
        stats.assigned.push(`${e.name}→${hit.loc}`);
        // ★留痕：这条位置是**结构推出**的，不是书里明述的（用户质疑"会不会帮倒忙"——
        //   区别必须落账，否则模型分不清"书里写的"与"引擎推的"，推错就成了喂给模型的假事实）。
        //   与查书留痕（`fields.位置`）分开存：`位置来源` ∈ {'书里原话','结构推导'}。
        const rec = entityFields[e.id] ? { ...entityFields[e.id] } : {};
        entityFields[e.id] = {
            ...rec,
            // 已标过"书里原话"的不降级（书里明述 > 结构推导）
            ...(rec.位置来源 === '书里原话' ? {} : { 位置来源: '结构推导', 位置来源自: hit.from }),
        };
        return { ...e, location: hit.loc };
    });
    return { ssot: { ...world, entities: list, meta: { ...prevMeta, entityFields } }, stats };
}

// ---------- 一处收口：前置步（编排层调用它，web 只负责落盘） ----------
/**
 * runEntityLookupStep({ ssot, transport, bookText, tick, moveFact, prevPicks })
 *   → { ssot, picks, warning, calls, stats }
 * 语义：选人失败 → 退回 prevPicks（再退兜底名单）；查书失败 → 不写痕；全部绝不阻塞调用方。
 */
export async function runEntityLookupStep({ ssot, transport, bookText, tick = 0, moveFact = null, prevPicks = null, bookEntries = null } = {}) {
    const out = { ssot, picks: prevPicks || fallbackCandidates(ssot), warning: null, calls: 0, stats: null, locationInherited: 0 };
    if (!transport || lookupDisabled(ssot, tick)) {
        // 查书熔断/无通道时，位置继承照样有得赚（零 token）——别把结构事实也一起停掉
        if (Array.isArray(bookEntries) && bookEntries.length) {
            const d = deriveLocationFromBook({ world: ssot, entries: bookEntries });
            out.locationInherited = d.stats.inherited;
            return { ...out, ssot: d.ssot };
        }
        return out;
    }

    const selected = await runSelect({ world: ssot, transport, moveFact });
    out.calls += 1;
    if (!selected.picks) {
        out.warning = selected.warning;
        const failed = noteFailure(ssot, tick);   // 选人失败：退回上轮名单 + 记失败
        if (Array.isArray(bookEntries) && bookEntries.length) {
            const d = deriveLocationFromBook({ world: failed, entries: bookEntries });
            out.locationInherited = d.stats.inherited;
            return { ...out, ssot: d.ssot };
        }
        return { ...out, ssot: failed };
    }
    out.picks = selected.picks;

    const idIndex = new Map((ssot.entities || []).map((e) => [e.id, e]));
    const need = out.picks.map((id) => idIndex.get(id)).filter(Boolean).filter((e) => missingFields(e, ssot.meta).length);
    if (!need.length) {
        const ok = noteSuccess(ssot);   // 全部已有字段 → 零调用
        if (Array.isArray(bookEntries) && bookEntries.length) {
            const d = deriveLocationFromBook({ world: ok, entries: bookEntries });
            out.locationInherited = d.stats.inherited;
            return { ...out, ssot: d.ssot };
        }
        return { ...out, ssot: ok };
    }

    // 与 runBatchLookup 同一收口（选定名单后的一切完全一致：取数一次用两次 / sources 语义 / 回写）
    const batch = await runBatchLookup({
        ssot, transport, bookText, ids: need.map((e) => e.id), tick, bookEntries,
    });
    out.calls += batch.calls || 1;
    out.stats = batch.stats;
    out.locationInherited = batch.locationInherited || 0;
    if (batch.warning) out.warning = batch.warning;
    return { ...out, ssot: batch.ssot };
}

// ---------- R2：单个盘算一轮内涉及的实体（属主 + 行动方 + 被波及方；逐轮算，不新增存储字段） ----------
/**
 * computeAgendaInvolvement(step, world, agendaId) → { set: string[], count }
 * 口径（用户 2026-09-11 拍板）：属主 + 行动方/目标 + 被波及方，逐轮算。
 *   行动方 = 本步 actions 的实体（含 target）；被波及方 = 该盘算产出的 plot 事件的 ripples，
 *   以及沿链上溯到该盘算的 ripple 事件的 ripples，加上事件牵动的 actors。
 * 说明：world 只用于"这个盘算属主是谁"；涉及集合全部来自本步（一轮内的量）。
 */
export function computeAgendaInvolvement(step, world, agendaId) {
    const agenda = (world?.agendas || []).find((a) => a.id === agendaId);
    const set = new Set();
    if (!agenda) return { set: [], count: 0 };
    set.add(agenda.owner);
    const evById = new Map((world?.events || []).map((e) => [e.id, e]));
    // 本步新事件的 id 由 settle 生成（ev_<tick>_<i>），校验期尚未入账 → 用 source.ref 关联盘算
    for (const ev of (step?.newEvents || [])) {
        if (ev?.source?.type === 'plot' && ev.source.ref === agendaId) {
            for (const id of (ev.ripples || [])) set.add(id);
            for (const id of (ev.actors || [])) set.add(id);
        }
        if (ev?.source?.type === 'ripple' && ev.source.ref) {
            const up = evById.get(ev.source.ref) || (step?.newEvents || []).find((x) => x?.id === ev.source.ref);
            const chainFromAgenda = up ? (up.source?.type === 'plot' && up.source.ref === agendaId) : false;
            if (chainFromAgenda) { for (const id of (ev.ripples || [])) set.add(id); for (const id of (ev.actors || [])) set.add(id); }
        }
    }
    // 行动方：本步动作（属主自己的动作，以及被上面的波及集合点名者的动作）——只数本步 actions
    for (const a of (step?.actions || [])) {
        if (a?.entity) set.add(a.entity);
        if (a?.target) set.add(a.target);
    }
    set.delete(undefined);
    set.delete(null);
    set.delete('');
    return { set: [...set], count: set.size };
}

/**
 * checkAgendaInvolvement(step, world, { cap }) → { violations: [{agendaId, count, sample}] }
 * 上限真源 AGENDA_INVOLVED_CAP（提案 15，用户拍板）；处置由调用方定（细案取 (a) 拒整步）。
 */
export const AGENDA_INVOLVED_CAP = 15;
export function checkAgendaInvolvement(step, world, { cap = AGENDA_INVOLVED_CAP } = {}) {
    const violations = [];
    for (const a of (world?.agendas || [])) {
        if (a.closed) continue;
        const { set, count } = computeAgendaInvolvement(step, world, a.id);
        if (count > cap) violations.push({ agendaId: a.id, count, sample: set.slice(0, 5) });
    }
    return { violations, cap };
}
