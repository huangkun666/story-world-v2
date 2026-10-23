// story-world-v2/src/param-ownership.js
// ★本模块的职责只有一件事：**在"世界正文"里分清"哪几格是玩家参数"**。
//
// 为什么要单独一个叶子模块（而不是把逻辑塞进 web/world-journal.js）：
//   · 判据要能在 Node 里直接跑（本仓既有治法：纯逻辑进 `src/`，存储适配进 `web/`）；
//   · 归属口径只许有**一处**（本仓"一个数两把尺子"的老病就是同一件事写了两遍）。
//
// 口径（与 `src/param-store.js` 的既有纪律逐条对齐，不新开词汇）：
//   · **算作玩家参数**：玩家能拧的档位与开关（`isPlayerInputKey`）——四个世界尺度上限、
//     三个开关、以及"自变量"档位（天时 / 张力推手）。它们归"玩家在这个世界选过什么"。
//   · **不算玩家参数**：`ENGINE_DERIVED`（动乱度，引擎每轮算的）与因变量（民生度，世界的**结果**）。
//     它们**留在世界正文里**，随世界一起存、一起恢复——剥掉它们就是回档丢状态（`params.js:54` 记过这条）。
//   · 判"这一版世界是不是只有参数在动"时用**同样这把尺子**：剥掉玩家参数后正文相同 ⇒ 世界没动。
//
// 兼容：旧版把玩家参数按**世界名**分桶存在插件配置区（`param-store.js` 的 `worlds[世界名]`）。
//   本模块只管"从世界正文里取出/剥掉玩家参数"，按世界名读旧桶的兼容口也在这一处，
//   免得"按世界名"与"按世界 id"两把尺子各写一遍。

import { isPlayerInputKey, normalizeStoreValue, worldNameOf } from './param-store.js';

/**
 * 从一个世界对象里取出**玩家参数**（只读；纯函数，不改入参）。
 * 只认 `context.setting.dynamic.env` 里、且 `isPlayerInputKey` 为真的键。
 * @returns {{[key:string]: string}} 只含合法档位值的表（认不出的键一律不取，绝不写占位值）
 */
export function playerParamsOf(world) {
    const env = world?.context?.setting?.dynamic?.env;
    const out = {};
    if (!env || typeof env !== 'object') return out;
    for (const [key, value] of Object.entries(env)) {
        if (!isPlayerInputKey(key)) continue;
        const norm = normalizeStoreValue(key, value);
        if (typeof norm === 'string') out[key] = norm;
    }
    return out;
}

/**
 * 把玩家参数从世界正文里**剥掉**（纯函数；返回新对象，不改入参）。
 * 只删"玩家参数"那几格：引擎派生与因变量（动乱度 / 民生度）原样留在正文里。
 * @returns {object} 剥掉玩家参数后的世界（没有可剥的就原样返回，省一次拷贝）
 */
export function stripPlayerParams(world) {
    const dyn = world?.context?.setting?.dynamic;
    if (!dyn || !dyn.env || typeof dyn.env !== 'object') return world;
    const managed = Object.keys(dyn.env).filter(isPlayerInputKey);
    if (!managed.length) return world;
    const env = { ...dyn.env };
    for (const key of managed) delete env[key];
    return {
        ...world,
        context: { ...world.context, setting: { ...world.context.setting, dynamic: { ...dyn, env } } },
    };
}

/**
 * 把玩家参数**合回**世界正文（读取世界时用；纯函数）。
 * @param {object} world 库里存的正文（不含玩家参数）
 * @param {object|null} params 该世界的玩家参数（`userParams` 行或等价表）
 * @returns {object} 完整世界（引擎、渲染、检索读的就是它）
 */
export function hydratePlayerParams(world, params) {
    const source = params && typeof params === 'object' ? params : null;
    if (!source || !Object.keys(source).length) return world;
    const dyn = world?.context?.setting?.dynamic;
    if (!dyn) return world;
    const env = { ...(dyn.env || {}) };
    let touched = 0;
    for (const [key, value] of Object.entries(source)) {
        if (!isPlayerInputKey(key)) continue;
        const norm = normalizeStoreValue(key, value);
        if (typeof norm !== 'string') continue;
        if (env[key] !== norm) { env[key] = norm; touched += 1; }
    }
    if (!touched) return world;
    return {
        ...world,
        context: { ...world.context, setting: { ...world.context.setting, dynamic: { ...dyn, env } } },
    };
}

/** `userParams` 行的形状（版本号与既有 `param-store` 的桶同源，便于对照）。 */
export function userParamsRecord(world_id, params, extra = {}) {
    const clean = {};
    for (const [key, value] of Object.entries(params || {})) {
        const norm = normalizeStoreValue(key, value);
        if (typeof norm === 'string') clean[key] = norm;
    }
    return { world_id, version: 1, params: clean, ...extra };
}

/**
 * 从**旧配置桶**（按世界名分桶）里取这个世界的那一份。
 * 用途：迁移期把旧桶里玩家选过的档位搬进库；找不到就是空表（"空着就是空着"，不填默认值）。
 * @param {object} bucket 旧桶（`{ version, worlds: { [世界名]: {键:值} } }`）
 * @param {object} world 用来取世界名的世界（或直接传世界名）
 */
export function legacyBucketParams(bucket, world) {
    const name = typeof world === 'string' ? world : worldNameOf(world);
    const env = bucket && typeof bucket === 'object' ? bucket.worlds?.[name] : null;
    if (!env || typeof env !== 'object') return {};
    const out = {};
    for (const [key, value] of Object.entries(env)) {
        const norm = normalizeStoreValue(key, value);
        if (typeof norm === 'string') out[key] = norm;
    }
    return out;
}

/** 人话：这一版世界"只有参数在动"吗（供编排层决定要不要新增世界版本）。 */
export function sameWorldBody(a, b) {
    return JSON.stringify(stripPlayerParams(a)) === JSON.stringify(stripPlayerParams(b));
}
