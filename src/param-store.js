// story-world-v2/src/param-store.js
// ★★leg41：**参数真源 = 插件自己的配置区**（`ctx.extensionSettings`），`dynamic.env` 只做**镜像**。
//
// 为什么要有这个模块（病因、机理、先例，逐条记档）：
//   · **病因（用户实机六轮未解的症状）**：参数档位原先住在**世界账本自己的**
//     `world.context.setting.dynamic.env` 里（leg26 立的存储位）。于是"玩家拧一个旋钮"这件事
//     被迫走**世界落账那条路**：改世界账 → 唯一落账收口 `writeHotMeta` → 拍快照 → 触发
//     **整份聊天上盘**（真账 9.6MB）→ 还要与 tick / 载入 / 卷轮转 / 快照恢复**抢同一格**。
//     那条路上有 ST 自己的三道静默 return（`saveChatConditional` 等锁 1s 超时、`saveChat` 取不到
//     文件名），插件侧判不出来 ⇒ 前六轮我们往这条路上叠了六层补丁
//     （三态返回 / 回读核对 / 抢回 / 延后重试 / 本地兜底 / 参数覆盖层），判据全绿而实机全败。
//   · **真因（v1 对照，用户点破）**：v1 **从来不把参数放进世界账**——参数住 `ctx.extensionSettings`
//     （`plugins/story-world/src/adapter.js:120-124` 的 `ensureSettings`），UI 上每次改动
//     `adapter.settings[key] = e.target.value; saveSettingsDebounced()`（`src/ui.js:432-448`）
//     就完事。**世界账怎么翻、怎么被换手，都碰不到参数。**
//   · **v2 把四层塌成了一层**：参数 / 档位 / 上限 / 开关全塞进 `dynamic.env`（`limits.js:10` 明写
//     "值落 `dynamic.env`、同一写通道"）⇒ 世界每被换手一次，玩家的档位就被洗一次。
//     ⇒ 本模块就是把那一层**搬回 v1 的位置**。
//
// 纪律（四条，都能机械核）：
//   ① **一个键一个归属者**：参数只由本模块写。世界账里的 `dynamic.env` 是**镜像**（只读方 =
//      引擎：`pack.js:482` 进包、`limits.js:105` 当闸、`params.js:97` 出面）。
//   ② **引擎照旧读得到**：镜像必须"每次真源变动后立刻同步 + 每次载入先镜像一次"，
//      否则会出现"面板写着 12、引擎按 6 跑"（本仓"一个数两把尺子"的老病）。
//   ③ **归一与白名单照抄既有表**（`params.js` 的档位/开关 + `limits.js` 的数字档位），
//      本模块**不新开一套词汇**、不发明档位。
//   ④ **叶子模块**：只依赖两张既有表（纯常量与纯函数），不 import 任何带状态的模块——
//      免得重演 leg40b 续那次"循环依赖 + TDZ ⇒ 653 条判据一片红"。
//
// 与 v1 的差别（有意为之，不照抄）：
//   · v1 的参数是**全局**一份（换聊天不变）；v2 的档位（每轮递线等）语义上是**这个世界**的尺度
//     ⇒ 本模块按**世界名**分桶存（`{ version, worlds: { [世界名]: env } }`），换聊天不串味。
//   · 清成「未定」= **删键**（照 `params.js` 既有语义："空着就是空着"，绝不写占位值）。

import { PARAM_KEYS, PARAM_NATURE, isParamKey, normalizeParam, SWITCH_PARAMS } from './params.js';
import { LIMIT_KEYS, limitKey } from './limits.js';

/** `extensionSettings` 里我们那一格（带版本号：以后搬家/改形不至于误读旧形）。 */
export const PARAMS_SETTINGS_KEY = 'story_world_v2_params';
export const PARAMS_STORE_VERSION = 1;

const UNNAMED_WORLD = '未名世界';

/** 世界名（与面板/兜底同一口径：`context.world`，拿不到就"未名世界"）。 */
export function worldNameOf(world) {
    const n = String(world?.context?.world ?? '').trim();
    return n || UNNAMED_WORLD;
}

/** 这个键是不是"玩家能拧的参数"（档位/开关/四个尺度上限）。 */
export function isParamStoreKey(key) {
    return limitKey(key) != null || isParamKey(key);
}

/**
 * ★这个键是不是**玩家输入**（＝"真源有权管辖"的键）。
 * 为什么必须与 `isParamStoreKey` 分开（判据当场抓出了这一格的语义差）：
 *   `isParamStoreKey` 是"**形状**上属于参数表"——它包含 `民生度`/`动乱度` 这两个**因变量**
 *   （世界的结果，面板只呈现、不给旋钮，见 `params.js` 的 `PARAM_NATURE`）。
 *   而"真源管辖"是**权限**问题：只有玩家能拧的键，才有资格"以真源为准、账上与它不一致时就改账"。
 *   ⇒ 若把因变量也算作管辖键，一次载入接纳就会把"书里/引擎刚写的民生度"钉成玩家输入，
 *     此后真源旧值会**反过来压掉世界的新值**——那是把只读的因变量偷偷变成了可写覆盖。
 */
export function isPlayerInputKey(key) {
    if (limitKey(key) != null) return true;                    // 四个世界尺度上限
    if (Object.prototype.hasOwnProperty.call(SWITCH_PARAMS, key)) return true;   // 三个开关
    return PARAM_KEYS.includes(key) && PARAM_NATURE[key] === 'independent';      // 天时 / 张力推手
}

/**
 * 归一一个参数值。返回：
 *   · `string` —— 合法档位/开关值（字符串，账本契约 `strRecord`）
 *   · `null`   —— **"清成未定"**（该键要从真源里删掉）
 *   · `false`  —— **不是这个键的合法档位**（调用方必须拒绝，不许写进去）
 * 三态必须分清：把"非法值"当成"清空"就会静默毁掉玩家的档位（前六轮就是这么丢的）。
 */
export function normalizeStoreValue(key, value) {
    if (!isParamStoreKey(key)) return false;
    const raw = value == null ? '' : String(value).trim();
    if (!raw) return null;                      // 空 ⇒ 未定（删键）
    if (limitKey(key) != null) {
        const n = limitKey(key, raw);
        return n == null ? false : String(n);
    }
    const p = normalizeParam(key, raw);
    return p == null ? false : p;
}

/** 空桶（形状：`{ version, worlds: { [世界名]: { [键]: 值 } } }`）。 */
export function emptyStore() {
    return { version: PARAMS_STORE_VERSION, worlds: {} };
}

/** 把任意来路的桶**洗成**合法形状（旧形 / 坏形 / 缺字段 ⇒ 一律给出可用桶，绝不抛）。 */
export function normalizeStore(raw) {
    const out = emptyStore();
    const worlds = raw && typeof raw === 'object' && raw.worlds && typeof raw.worlds === 'object' ? raw.worlds : null;
    if (!worlds) return out;
    for (const [name, env] of Object.entries(worlds)) {
        if (!env || typeof env !== 'object') continue;
        const clean = {};
        for (const [k, v] of Object.entries(env)) {
            const norm = normalizeStoreValue(k, v);
            if (typeof norm === 'string') clean[k] = norm;   // 认不出的键/档位一律丢（不搬进新家）
        }
        out.worlds[name] = clean;
    }
    return out;
}

/**
 * 载入时**合并**：已有真源 ⊕ 账上已有的环境量 ⊕ 旧兜底。
 * 优先级（写死，防"两把尺子"）：**真源 > 账上（旧账/书里抽的） > 旧兜底**。
 * ★只有"真源里没有这个键"时才会被账上/兜底填——真源一旦写过，永远是它说了算。
 * @returns {{ env: object, changed: boolean }} 合并后的该世界参数 + 是否与真源不同（不同才需要回写）
 */
export function loadMergedEnv(bucket, worldName, worldEnv, legacyPendingEnv) {
    const store = normalizeStore(bucket);
    const own = { ...(store.worlds[worldName] || {}) };
    const before = { ...own };
    const seed = (src, onlyMissing) => {
        if (!src || typeof src !== 'object') return;
        for (const [k, v] of Object.entries(src)) {
            if (!isParamStoreKey(k)) continue;
            if (onlyMissing && Object.prototype.hasOwnProperty.call(own, k)) continue;
            const norm = normalizeStoreValue(k, v);
            if (typeof norm === 'string') own[k] = norm;
        }
    };
    seed(worldEnv, true);           // 账上已有的：只补真源没有的
    seed(legacyPendingEnv, true);   // 旧兜底：同上（一次性迁移）
    const changed = Object.keys(before).length !== Object.keys(own).length
        || Object.keys(own).some((k) => before[k] !== own[k]);
    return { env: own, changed };
}

/**
 * 把参数**镜像**进世界账的 `dynamic.env`（引擎读的就是这里）。
 * 纯函数：不改入参；返回新世界（无变化时返回原对象，调用方据此决定要不要写账）。
 *
 * ★★**删键只删"真源管辖的那些键"**（`managedKeys`；本模块第一版写错过，判据当场抓红，留档防重犯）：
 *   第一版无条件删掉"真源没有的参数键"，结果把账上**已经有的** `动乱度`（旧账/书里抽的、
 *   真源还不认识它）顺手擦掉——正是本笔要治的那类"悄悄吃掉账上的键"。
 *   第二版改成"一个都不删"，又走向另一个坑：玩家**清空**的那一档会在下次载入时
 *   从账上被"接纳"回真源 ⇒ 清空失效。
 *   ⇒ 定稿（两个坑都躲开，能机械核）：删**且只删**曾经属于真源管辖的键——
 *     调用方在载入期把"账上那一批参数键"登记成 `managedKeys`，此后找不到的那些就是玩家删的；
 *     `managedKeys` 没传（判据/旧调用方）⇒ 退回"只填不删"，绝不误伤。
 *   ⇒ 另：世界自己 `env` 里**非参数键**（引擎/旧版留下的）永远不碰。
 *
 * @param {object} world 目标世界
 * @param {object} env 要镜像的参数（真源或"编辑后的完整环境"）
 * @param {Iterable<string>|null} [managedKeys] 真源管辖的键（只有它们才允许被删）
 */
export function mirrorEnvIntoWorld(world, env, managedKeys = null) {
    const dyn = world?.context?.setting?.dynamic;
    if (!dyn) return world;
    const cur = { ...(dyn.env || {}) };
    let touched = 0;
    for (const [k, v] of Object.entries(env || {})) {
        if (!isParamStoreKey(k)) continue;
        if (cur[k] !== v) { cur[k] = v; touched += 1; }
    }
    // ★注意（本模块第二版踩过）：判空必须看**里面有没有键**，不能只看"传没传"——
    //   空 `Set` 是**真值**，`if (managedKeys)` 会让"没登记任何管辖键"变成"一个都不删"的反面。
    //   ★另（第三版）：只有**玩家输入**才有资格被删——因变量（民生度/动乱度）永远不归真源管，
    //     否则一次载入接纳就会把"引擎刚写的世界结果"钉成玩家输入，反压世界的新值。
    const managed = managedKeys && typeof managedKeys[Symbol.iterator] === 'function' ? [...managedKeys] : [];
    if (managed.length) {
        for (const k of managed) {
            if (!isPlayerInputKey(k)) continue;
            if (Object.prototype.hasOwnProperty.call(env || {}, k)) continue;   // 真源里还有 ⇒ 留着
            if (k in cur) { delete cur[k]; touched += 1; }                       // 真源里没了 ⇒ 这才是玩家删的
        }
    }
    if (!touched) return world;
    return {
        ...world,
        context: { ...world.context, setting: { ...world.context.setting, dynamic: { ...dyn, env: cur } } },
    };
}

/** 从世界账的镜像里取出参数键（只读；用于"账上还有、真源没有"的一次性接纳）。 */
export function paramKeysInWorldEnv(world) {
    const env = world?.context?.setting?.dynamic?.env || {};
    const out = {};
    for (const [k, v] of Object.entries(env)) if (isParamStoreKey(k)) out[k] = v;
    return out;
}

/**
 * 受控编辑（**唯一的写入口**，照 v1 `shared/undo-stack.js` 的`edit` 语义）：
 *   fun(prevEnv) → nextEnv（**纯函数**：不许改 prevEnv，返回新对象）
 * 口径：
 *   · 返回 `{ changed:false, reason }` 表示"没有实质变更"（值一样）——**调用方不许写盘、不许记撤销**；
 *   · 有实质变更 ⇒ 返回 `{ changed:true, env, before }`，由调用方写真源 + 记撤销 + 镜像。
 * ★"先算后写"而不是"先写后比"：这样"值没变"永远不会碰到存储（前六轮的假修改都是先写后比出来的）。
 */
export function applyParamEdit(currentEnv, fun) {
    const prevEnv = { ...(currentEnv || {}) };
    let nextEnv = null;
    try { nextEnv = fun({ ...prevEnv }); } catch (err) { return { changed: false, reason: `编辑函数抛错：${String(err?.message || err)}` }; }
    if (!nextEnv || typeof nextEnv !== 'object') return { changed: false, reason: '编辑函数没返回新参数表' };
    const clean = {};
    for (const [k, v] of Object.entries(nextEnv)) {
        const norm = normalizeStoreValue(k, v);
        if (typeof norm === 'string') clean[k] = norm;    // 非法值一律丢（受控入口不该产生它）
    }
    const same = Object.keys(clean).length === Object.keys(prevEnv).length
        && Object.keys(clean).every((k) => prevEnv[k] === clean[k]);
    if (same) return { changed: false, reason: '值没变' };
    return { changed: true, env: clean, before: prevEnv };
}

/** 人话标签（状态条/撤销按钮共用；玩家可见文本不许出现引擎术语）。 */
export function paramLabel(key) {
    return SWITCH_PARAMS?.[key]?.label || key;
}

/** 参数键的**全部**白名单（供判据核对"两张表都在"）。 */
export const ALL_PARAM_KEYS = Object.freeze([...LIMIT_KEYS, ...PARAM_KEYS, ...Object.keys(SWITCH_PARAMS)]);
