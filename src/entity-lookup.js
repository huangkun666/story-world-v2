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
        ents.map((e) => `${e.id}\t${e.name}\t${e.kind === 'faction' ? '势力' : '角色'}`).join('\n'),
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

// ---------- 一处收口：前置步（编排层调用它，web 只负责落盘） ----------
/**
 * runEntityLookupStep({ ssot, transport, bookText, tick, moveFact, prevPicks })
 *   → { ssot, picks, warning, calls, stats }
 * 语义：选人失败 → 退回 prevPicks（再退兜底名单）；查书失败 → 不写痕；全部绝不阻塞调用方。
 */
export async function runEntityLookupStep({ ssot, transport, bookText, tick = 0, moveFact = null, prevPicks = null } = {}) {
    const out = { ssot, picks: prevPicks || fallbackCandidates(ssot), warning: null, calls: 0, stats: null };
    if (!transport || lookupDisabled(ssot, tick)) return out;

    const selected = await runSelect({ world: ssot, transport, moveFact });
    out.calls += 1;
    if (!selected.picks) {
        out.warning = selected.warning;
        return { ...out, ssot: noteFailure(ssot, tick) };   // 选人失败：退回上轮名单 + 记失败
    }
    out.picks = selected.picks;

    const idIndex = new Map((ssot.entities || []).map((e) => [e.id, e]));
    const need = out.picks.map((id) => idIndex.get(id)).filter(Boolean).filter((e) => missingFields(e, ssot.meta).length);
    if (!need.length) return { ...out, ssot: noteSuccess(ssot) };   // 全部已有字段 → 零调用

    const res = await runLookup({ world: ssot, transport, ids: need.map((e) => e.id), bookText });
    out.calls += 1;
    if (res.byName === null) {
        out.warning = `查书调用失败：${res.error}`;
        return { ...out, ssot: noteFailure(ssot, tick) };          // 失败：不写任何痕迹
    }
    // sources 语义（applyLookup 用它决定 ok/pending/absent）：
    //   `undefined` = **这一轮没读成书**（取书抛错/书没取到）→ 必须记 pending，**绝不记 absent**
    //   `[]`        = 书读到了、但书里确实没有该名号的条目 → 才允许记 absent（书未明述）
    //   `[...]`     = 查了这几条世界书条目
    // 第二十五棒 d：原实现取书失败时给 `[]`，与"书里没有"同形 ⇒ 把读不到书误记成「书未明述」并**永久锁死**。
    let readFailed = false;
    const sources = {};
    for (const e of need) {
        const src = await resolveBookSource(bookText, e);   // 与 runLookup **同一次取数口径**（取一次用两次）
        if (!src.ok) readFailed = true;
        sources[e.id] = src.ok ? src.entries.map((x) => x?.name ?? x) : undefined;
    }
    if (readFailed) out.warning = '查书取不到世界书原文（本轮不写「书未明述」，下轮再试）';
    const applied = applyLookup({ ssot, ids: need.map((e) => e.id), byName: res.byName, sources, tick });
    out.stats = applied.stats;
    return { ...out, ssot: noteSuccess(applied.ssot) };
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
