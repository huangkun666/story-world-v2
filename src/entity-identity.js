// story-world-v2/src/entity-identity.js
// Task 3（抽取确认与完整入账）：**名号 / 别名的唯一一把尺子**——实体解析。
//
// 依据（已批准）：docs/superpowers/specs/2026-10-03-abstraction-sources-design.md
//   §6.2「别名合并要求同一实体判断和对应依据；共享关键词、相似名和不同类别的同名项不能自动合并」
//   §6.3「不同名字的同一实体在名册到实体账的转换中保留全部已确认叫法，相关搜索与实体解析使用相同的身份信息」
//
// 为什么单提一个模块（不是审美）：这套解析此前有**三份各写各的**——
//   · `tag-extract.js` 的 `makeResolver`（id → 正名 → 别名，另有 canon 兜底）；
//   · `entity-lookup.js` 的 `resolveByName`（**只认正名精确**，别名查不到）；
//   · `abstract.js` 的 `seedBookRelations`（**只认实体正名**，别名端点直接丢）。
//   Task 3 要求"复用同一个解析器"，所以这里给出**精确匹配**的实现，返回
//   未命中 / **歧义**（同名或同别名指向多个实体）而不是拿子串去猜——身份决定事实时不许猜。
//
// 纪律（三条）：
//   ① **精确**：只按 trim + NFKC + 去空白 + 小写后的完整名号比对；**不做子串/模糊**（子串解析是
//      "名字包含"那类猜测的入口，Task 3 明令它只可作候选，不可定事实）。
//   ② **歧义即未定**：同一个键命中多个实体 ⇒ `ambiguous`，调用方必须丢并留痕，不许先到先得。
//   ③ **别名以实体账为准**：`aliases` 是可选兼容字段（旧账没有 ⇒ 只按正名解析，零扰动）。

/** 归一：trim + NFKC（全角/半角同形）+ 去空白 + 小写。与 `tag-extract` 的既有口径逐字同尺。 */
export function normEntityName(v) {
    return String(v ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

/** 一条实体上**已确认的叫法**：正名在前，别名去空、去重、去正名（顺序稳定）。 */
export function entityKeysOf(entity) {
    const out = [];
    const push = (v) => {
        const s = String(v ?? '').trim();
        if (!s || out.includes(s)) return;
        out.push(s);
    };
    push(entity?.name);
    for (const a of (Array.isArray(entity?.aliases) ? entity.aliases : [])) push(a);
    return out;
}

/**
 * 建立解析索引（键 = 归一后的叫法；值 = 该键命中的实体集合）。
 * @returns {Map<string, object[]>}
 */
export function buildEntityNameIndex(entities = []) {
    const index = new Map();
    for (const e of (Array.isArray(entities) ? entities : [])) {
        if (!e || typeof e !== 'object') continue;
        for (const key of entityKeysOf(e)) {
            const k = normEntityName(key);
            if (!k) continue;
            const bucket = index.get(k) || [];
            if (!bucket.includes(e)) bucket.push(e);
            index.set(k, bucket);
        }
    }
    return index;
}

/**
 * 名号（或别名）→ 实体身份。**唯一出口**：命中唯一才算数。
 * @returns {{status:'ok'|'ambiguous'|'unresolved', entity:object|null, id:string|null, key:string, candidates:object[]}}
 */
export function resolveEntityIdentity(entities = [], raw = '') {
    const key = normEntityName(raw);
    if (!key) return { status: 'unresolved', entity: null, id: null, key, candidates: [] };
    const index = buildEntityNameIndex(entities);
    const hit = index.get(key) || [];
    if (!hit.length) return { status: 'unresolved', entity: null, id: null, key, candidates: [] };
    if (hit.length > 1) return { status: 'ambiguous', entity: null, id: null, key, candidates: hit.slice() };
    return { status: 'ok', entity: hit[0], id: hit[0].id ?? null, key, candidates: hit.slice() };
}

/** 便捷出口：命中唯一实体才返回它，未命中/歧义一律 null（调用方据此留痕）。 */
export function resolveEntityName(entities = [], raw = '') {
    const r = resolveEntityIdentity(entities, raw);
    return r.status === 'ok' ? r.entity : null;
}

/**
 * ★★★Task 3 复查第二轮（task-3-fixes-review.md ③④）：**唯一一把尺子**——正名档优先 + 别名档**并集后**判唯一。
 *
 * 为什么要有这一档（不是新规则，是把既有用户口径与"歧义即未定"接在一起）：
 *   · leg89 用户拍板「模型认得出那就直接按照插件的正名来看」——别名可能与**别人的正名**撞车
 *     （书里既有 `小娥` 这条、又是 `白小娥` 的别名）⇒ **正名的那个人必须先被认出来**；
 *   · 但旧实现是"先到先得"的 Map（`tag-extract.js` 的 `makeResolver`）⇒ 两个人**共享同一个别名**时
 *     第一个被登记的人赢（第一轮复审实测：`大人` 归给了 `a`）；
 *   · 第二轮复审又实测出**第二条病**：实体别名档与"名册兜底别名档"是两条路，先命中的那条直接返回
 *     （旧 `if (aliased) return unique(aliased)`）⇒ 实体别名 `先生` 与另一个旧世界名册别名 `先生`
 *     同时存在时，动作被记到了前者头上——**同一档没并集**。
 *   ⇒ 本函数把两条并成**一条口径**（四个消费者共用：标签 / 归属 / 查书 / 关系端点）：
 *     ① **正名档**：唯一命中 ⇒ 它（压过任何人的别名）；命中多个（账上重名实体）⇒ `ambiguous`；
 *     ② **别名档**：`实体自己的 aliases` ∪ `名册兜底别名`（名册项的正名必须在账上**唯一**命中才作数，
 *        与旧兼容口径逐字相同）——**先把同一档并成一个集合，再判唯一**；多个不同实体 ⇒ `ambiguous`；
 *        唯一 ⇒ 它；空 ⇒ `unresolved`。
 *
 * ★没有第二套优先级、也没有"先到先得"：所有消费者都调这一个函数，分歧只能来自它们的输入不同。
 * ★歧义（模糊）**不是错误、也不是空**：调用方必须如实留痕（`ambiguous` 带 `candidates`），不许猜。
 *
 * @param {object[]} entities 账上实体（`[{id,name,aliases}]`）
 * @param {object[]} canon 书名录（`[{name,aliases}]`）——旧世界兼容兜底：别名只住在名册里
 * @returns 与 `resolveEntityIdentity` 同形
 */
export function resolveEntityIdentityWithCanon(entities = [], canon = [], raw = '') {
    const key = normEntityName(raw);
    const unresolved = { status: 'unresolved', entity: null, id: null, key, candidates: [] };
    if (!key) return unresolved;
    const live = (Array.isArray(entities) ? entities : []).filter((e) => e && typeof e === 'object');
    // ① 正名档（唯一命中压过别人的别名）
    const named = [];
    for (const e of live) {
        if (normEntityName(e.name) !== key) continue;
        if (!named.includes(e)) named.push(e);
    }
    if (named.length > 1) return { status: 'ambiguous', entity: null, id: null, key, candidates: named.slice() };
    if (named.length === 1) return { status: 'ok', entity: named[0], id: named[0].id ?? null, key, candidates: named.slice() };
    // ② 别名档：先并集（实体别名 ∪ 名册兼容别名），**再**判唯一——不许某一条路先命中就先返回
    const hit = [];
    for (const e of live) {
        for (const a of (Array.isArray(e.aliases) ? e.aliases : [])) {
            if (normEntityName(a) !== key) continue;
            if (!hit.includes(e)) hit.push(e);
        }
    }
    for (const c of (Array.isArray(canon) ? canon : [])) {
        const ck = normEntityName(c?.name);
        if (!ck) continue;
        const prim = live.filter((e) => normEntityName(e.name) === ck);
        if (prim.length !== 1) continue;                  // 账上没有这个人 / 同名多个 ⇒ 不补（不猜）
        for (const a of (Array.isArray(c.aliases) ? c.aliases : [])) {
            if (normEntityName(a) !== key) continue;
            if (!hit.includes(prim[0])) hit.push(prim[0]);
        }
    }
    if (hit.length > 1) return { status: 'ambiguous', entity: null, id: null, key, candidates: hit.slice() };
    if (hit.length === 1) return { status: 'ok', entity: hit[0], id: hit[0].id ?? null, key, candidates: hit.slice() };
    return unresolved;
}

/**
 * ★★★Task 3 复查（task-3-review.md ⑤）：**正名优先**的身份解析——给"先认正名、再认别名"的消费者共用。
 *
 * ★第二轮起它只是上面那把尺子的**无兜底形态**（`canon` = 空）：口径一个字不改，
 *   实现只有一处（`resolveEntityIdentityWithCanon`），免得几个消费者的"正名优先"各写一遍——
 *   复审实测的病正是"各写一遍"（标签先认实体别名、关系端点只认正名，同一个名字两处结论不同）。
 * @returns 与 `resolveEntityIdentity` 同形
 */
export function resolveEntityIdentityPreferred(entities = [], raw = '') {
    return resolveEntityIdentityWithCanon(entities, [], raw);
}

/**
 * 把名册上已确认的叫法并进实体 `aliases`（幂等；**只加不删、不覆盖正名**）。
 *
 * ★★★Task 4（integration boundaries · 用户令「别名完整保存」）：**两条静默数据丢失的上限已删**——
 *   `max = 8`（第 9 个已确认叫法整条丢）与 `charMax = 30`（超 30 字的完整别名被**截短**）。
 *   依据：设计 §6.3「不同名字的同一实体在名册到实体账的转换中保留**全部**已确认叫法」、
 *   §9「别名完整保存」、§9 末「**没有新增数值阈值或数量上限**」。
 *   旧法的病（独立复审 F5/F6 实测）：13 条已确认别名只入账前 8 条、31 字的完整别名被切到 30 字，
 *   而且**没有任何诊断**——下游（标签/搜索/查书/归属/关系端点/起根当事人）因此永远看不到那些名字。
 *   ⇒ 这里**不设任何数字上限**（也不换成另一个数）：确认过的叫法原样保存；
 *     幂等与形状防线（非字符串 / 空串 / 与正名相同 / 重复）**一个字不动**。
 * @returns {number} 新增条数
 */
export function mergeEntityAliases(entity, incoming) {
    if (!entity || typeof entity !== 'object') return 0;
    const primary = String(entity.name ?? '').trim();
    const current = Array.isArray(entity.aliases) ? entity.aliases.slice() : [];
    let added = 0;
    for (const raw of (Array.isArray(incoming) ? incoming : [])) {
        if (typeof raw !== 'string') continue;
        const s = raw.trim();
        if (!s || s === primary || current.includes(s)) continue;
        current.push(s);
        added += 1;
    }
    if (added) entity.aliases = current;
    return added;
}
