// ★★leg40b 续：**尺度上限的唯一真源 + 可调档位**（用户令：「能不能直接把这些闸门参数直接放进参数页？」→ 拍板"甲+乙档全开"）。
//
// 为什么要有这个模块（三条，都是本仓踩过的）：
//   ① **一个数两把尺子**是本仓老病（leg32 的构建号与面板分母、leg33 的选择器偏心）。这些上限原先散在
//      两处（`settle.js` 的 `AGENDA_CAPS`/`EVENT_CAPS`/`ENTITY_BIRTH_PER_TICK` + `pack.js` 的
//      `THREADS_TOP`/`IDLE_FACES_TOP`）⇒ 参数化时必须先收成**一份**，否则"面板上写着 6、引擎按 3 跑"。
//   ② **默认逐字不变**：出厂值就是参数化之前那几个数（收进本模块，`settle.js`/`pack.js` 改从这里取）
//      ⇒ 未设档位时行为与参数化之前**逐字节相同**（判据见 `test/limits.test.js`）。
//   ③ **账上要看得见**：这些值不进账的话，"玩家把上限调低了"与"引擎坏了"在读数上**一模一样**，
//      没法归因（本棒 leg40c 全靠结构性读数判死锁与并推率）。故值落 `context.setting.dynamic.env`，
//      与既有参数（天时/张力推手/插件总闸）**同一处、同一写通道**。
//
// ★★**依赖方向（本文件踩过一次，写死免得下一棒再踩）**：本模块是**叶子里的根**——
//   它**只导出常量与纯函数，不 import 任何 `src/` 模块**。为什么必须这样：第一版我让本文件去
//   `import { EVENT_CAPS } from './settle.js'` 取默认值，而 `settle.js` 又要 `import { resolveLimits }`
//   回来 ⇒ **循环依赖 + TDZ**，实测直接炸出 `ReferenceError: Cannot access 'EVENT_CAPS' before initialization`
//   （653 条判据里一大片瞬红）。⇒ 口径：**值住在这里，判据来这里取**（单向）。
//
// ★与既有参数的关系（照 `params.js` 的立表口径，不新开一套）：
//   · `params.js` 的档位是**人话档位**（天时=风调雨顺…），引擎**不读它们做判断**（那条纪律不变）。
//   · 本模块的四个是**数字上限**——它们**就是**引擎判据本身（闸值）⇒ 性质不同，故**另立一表**，
//     但存储位置、写通道、白名单归一的口径**完全照抄**（同一处 `dynamic.env`、同一个 `set-param`）。
//   · 谁会读它们：`settle.js`（事件洪峰/盘算顶/入局限额）· `pack.js`（线捆递送条数）· `render.js`（面板）。
//
// ★诚实的边界（写在最前面，免得下一棒当既有保证用）：
//   · 这四个值**只在"账上有明确档位"时覆盖**；其余一律用出厂默认 ⇒ 出厂行为零变化。
//   · `每轮递线` 调到 3 以上会**打破现行提示词正文里"这一栏最多只有三条"那句话**（见 `prompts.js`
//     第 14 条）——该措辞的修法是把条数改成**由包自己说**（`threads` 栏有几条就写几条），属另一件活，
//     已登记；在它落地前，**> 3 的实际效果只有本棒实测支撑**（请求 6 ⇒ 推 6.00 条/轮），不是设计保证。
//   · `在飞大计`/`顶层大计` 放开后的后果**没有曲线**（真账 59 轮里在飞 13/20 从未咬到、顶层 15 在
//     请求=6 时咬了 4 次）⇒ 档位表刻意取得**保守**，不是"能开到多大就多大"。

// ---------- 出厂默认（= 参数化之前那几个数；本模块是它们**唯一的家**）----------
export const THREADS_TOP = 3;        // pack.js：线捆递给模型几条（本棒实测：3→2.25 条/轮、6→6.00）
export const EVENT_CAP_PER_TICK = 6; // settle.js：一轮最多落几件事件（超出按"事件洪峰"拒并留痕）
export const AGENDA_CAP_PER_TICK = 3;// settle.js：一轮最多新起几件盘算（**本轮刻意不做旋钮**，见下）
export const AGENDA_CAP_TOP_LEVEL = 15; // settle.js：无父盘算同时在飞的上限
export const AGENDA_CAP_OPEN = 20;   // settle.js：盘算同时在飞总数（含支脉）
export const ENTITY_BIRTH_PER_TICK = 1;  // settle.js：一轮最多入局几个新人（**不做旋钮**）
export const IDLE_FACES_TOP = 12;    // pack.js：待启用名单每轮递几张脸（**不做旋钮**）

/** 出厂默认（= 参数化之前的值；键名与面板一致，直接喂 `resolveLimits`）。 */
export const LIMIT_DEFAULTS = Object.freeze({
    每轮递线: THREADS_TOP,              // pack.js：线捆递给模型几条（本棒实测：3→2.25 条/轮、6→6.00）
    每轮事件: EVENT_CAP_PER_TICK,       // settle.js：一轮最多落几件事件（超出按"事件洪峰"拒并留痕）
    顶层大计: AGENDA_CAP_TOP_LEVEL,     // settle.js：无父盘算同时在飞的上限
    在飞大计: AGENDA_CAP_OPEN,          // settle.js：盘算同时在飞总数（含支脉）
});

/**
 * 档位表（白名单；面板排下拉 + 归一用）。
 * ★每一档都写明"为什么是这个数"，不许有无出处的档位（铁律 2：数字先报批——这里给的是**已实测的真源值**
 *   与**紧邻的一两档**，不是"能开多大开多大"）：
 *   · 每轮递线 3 = 现行默认（`THREADS_TOP`）；6 / 9 = 本棒 leg40c 实测过的档（6 档实测 6.00 条/轮全推满；
 *     9 是 6 与 12 之间取中——12 实测也能推满，但**线头池的上界我只量到 6 档**，故不放到 12）。
 *   · 每轮事件 6 = 现行默认（`EVENT_CAPS.perTick`，真账 59 轮逐轮 max 4 ⇒ 从未咬到）；9 / 12 = 请求升到 6/12
 *     之后的紧邻档（请求=6 时咬了 1 次、请求=12 时咬了 6 次 ⇒ 这一档**确实会被用到**）。
 *   · 顶层大计 15 = 现行默认（真账单属主累计最多 10）；20 / 30 = 给"世界更宽"留的两级。
 *   · 在飞大计 20 = 现行默认（真账在飞 13）；30 / 40 = 同上。
 */
export const LIMIT_GEARS = Object.freeze({
    每轮递线: [3, 6, 9],
    每轮事件: [6, 9, 12],
    顶层大计: [15, 20, 30],
    在飞大计: [20, 30, 40],
});

export const LIMIT_KEYS = Object.freeze(Object.keys(LIMIT_DEFAULTS));

/** 面板上的人话（键 → 显示名 + 一句后果/来路）。**玩家可见文本不许出现引擎术语**（A-3）。 */
export const LIMIT_META = Object.freeze({
    每轮递线: {
        label: '每轮递几条线',
        hint: '引擎每轮把"开了头还没人接的线"递到模型眼前，要求每条各写一步。'
            + '调高 ⇒ 一轮里同时推进的线更多（实测 3 → 每轮 2.25 条、6 → 6.00 条）；'
            + '代价是一轮要写的事更多，且**同时最多几件大计**会先见底。',
    },
    每轮事件: {
        label: '每轮最多几件事件',
        hint: '一轮里最多落账几件新事，超出的被拒（面板会如实报"拒了几件"）。'
            + '现行 6：真账 59 轮里一轮最多 4 件，从来没撞到过。',
    },
    顶层大计: {
        label: '同时最多几件大计',
        hint: '同时在办的大计（自己分出来的小事不占这个名额）。现行 15：真账用过 10。',
    },
    在飞大计: {
        label: '同时在办总数上限',
        hint: '大计与它们分出来的小事加起来，同时在办的最多这么多。现行 20：真账用过 13。',
    },
});

const isLimitKey = (k) => Object.prototype.hasOwnProperty.call(LIMIT_GEARS, k);
// ★★★leg56：把"这个键是不是本表的"**导出**（原先只是个内部箭头函数）。
//   为什么：观棋信息带要**按同一把尺子**从参数真源里挑出这四个上限（见 `render.js` 的
//   `effectiveCaps`）——那份挑选如果自己再写一遍 `LIMIT_GEARS`/`LIMIT_DEFAULTS` 的键表，
//   就是本仓吃过无数次的"**同一件事两处实现**"（leg53 的 `isParamStoreKey` vs `isPlayerInputKey`
//   就是这么分叉出真事故的）⇒ 口径只许住一处，调用方 import 它。
export const isLimitKeyOf = isLimitKey;

/**
 * ★★★leg54（用户令「**能自由调数，当然也能无上限**」）：归一 = **任意 ≥1 的整数**，不再是档位白名单。
 *
 * 为什么撤掉白名单（**这段是本笔的完整理由，别只抄结论**）：
 *   · 用户原话：「无上限其实就是**模型自由发挥**，我的想法是用户能自由调数当然也能无上限」。
 *     我去核了数字 ⇒ **他说得对**：
 *       - 旧白名单顶格只有 9 / 12 / 30 / 40，而**单轮输出预算 16384 token**
 *         （`PROPOSED_CALL_LIMITS.maxTokens`，第十九棒拍板定的；见 `transport-http.js` 的 E3 记档）；
 *         一条事件在 JSON 里约 120–200 字符 ⇒ 预算够写**几十条**
 *         ⇒ **那个 12 从来没咬到过模型，它只是一张纸**。
 *       - leg40b 实测同样印证：59 轮真账**逐轮新事件 max 4**，引擎闸一次没咬到；
 *         而"请求 6 ⇒ 真推 6.00 / 请求 12 ⇒ 真推 12.00"也都**推满了**（不是写不动）。
 *     ⇒ **上限的真实边界是"模型一次能写多长"，不是我们的白名单。** 撤掉它，边界回到它本来该在的地方。
 *   · 被拒的代价**不叫停世界**：leg40b 的死锁自愈在（同轮引用按位次认 / 丢掉写歪的那几条 /
 *     重试一次 / 最后一档"世界安静一步"，**tick 照常前进**）⇒ 不是"静默卡死"。
 *   · ★**但有一句必须留在面板上**（不是限制，是如实告知）：超出模型一次能写的量时，
 *     你看不到"被拦"，只会看到"这轮没长出新事"（被拒的世界原样不动）——
 *     要查就翻观棋窗口底部的「⚖ 本轮裁定 N 条」。
 *
 * ★**仍然在挡的四条**（都是"能不能让代码跑起来"的最小校验，不是产品上限）：
 *     `≥ 1` 的**整数**；空/缺值 ⇒ `null` = **未定**（回出厂默认）；非数字/小数/负数/0 ⇒ 弃键。
 *   ★键白名单（`LIMIT_KEYS`）**照旧在**——`limitKey('天时')` 仍返 `null`（两张表不许互相吃）。
 *
 * ★`LIMIT_GEARS` 从"白名单"降级为**建议值**：面板拿它在输入框下面提示"常用：3 / 6 / 9"
 *   （玩家不知道该填几），旧账里那些值也都还是合法整数 ⇒ **旧账照旧读得出来**。
 */
export function normalizeLimit(key, value) {
    if (!isLimitKey(key)) return null;
    const raw = typeof value === 'number' ? value : String(value ?? '').trim();
    if (raw === '') return null;                       // 空 = 未定（回出厂默认），不是 0
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) return null;              // 非数字
    if (!Number.isInteger(n)) return null;             // 小数：("半件事"没有意义)
    if (n < 1) return null;                            // 0 / 负数
    return n;
}

/** 从世界账读**已设**的档位（只读、不发明；缺键=没设过 ⇒ 不进结果）。 */
export function limitsOf(world) {
    const raw = world?.context?.setting?.dynamic?.env;
    const out = {};
    for (const k of LIMIT_KEYS) {
        const v = normalizeLimit(k, raw?.[k]);
        if (v != null) out[k] = v;
    }
    return out;
}

/** 生效值 = 代码默认 ⊕ 账上已设（**默认逐字不变**：账上没有就用 `LIMIT_DEFAULTS`）。 */
export function resolveLimits(world) {
    return { ...LIMIT_DEFAULTS, ...limitsOf(world) };
}

/**
 * 面板行（与 `params.js` 的 `PARAM_ROWS` 同形：值/档位/是否已设）。
 * ★★leg41：与 `PARAM_ROWS` 同一条纪律——`envOverride` = **参数真源**（插件配置区那份）。
 *   传了就以它为准，不传才读世界账的镜像。
 *   ★为什么这条必须一起改（判据当场抓出来的真缺陷）：`set-param` 写完真源后，页面重绘若读镜像，
 *     而镜像要等一次写账才同步 ⇒ **面板会画回默认值**——那正是用户报的"改了就回默认"的观感。
 *     （本笔第一版只改了档位那两行、漏了这一栏，判据立刻在 `每轮事件` 上抓红。）
 */
export const LIMIT_ROWS = (world, envOverride = null) => {
    if (envOverride && typeof envOverride === 'object') {
        const out = {};
        for (const k of LIMIT_KEYS) {
            const v = normalizeLimit(k, envOverride[k]);
            if (v != null) out[k] = v;
        }
        return LIMIT_KEYS.map((k) => ({
            key: k,
            value: out[k] ?? LIMIT_DEFAULTS[k],
            options: LIMIT_GEARS[k],
            isDefault: out[k] == null,
            meta: LIMIT_META[k],
        }));
    }
    const set = limitsOf(world);
    return LIMIT_KEYS.map((k) => ({
        key: k,
        value: set[k] ?? LIMIT_DEFAULTS[k],
        options: LIMIT_GEARS[k],
        isDefault: set[k] == null,
        meta: LIMIT_META[k],
    }));
};

/** 这一轮是不是"用了出厂默认"（落账/自证面用；全默认时不必在账上堆冗余）。 */
export const usingDefaults = (world) => Object.keys(limitsOf(world)).length === 0;

/**
 * 写通道用：`limitKey(key)` ⇒ 这个键是不是本表的（不是 ⇒ null）；`limitKey(key, value)` ⇒ 归一后的档位。
 * ★两个用途合成一个函数，是为了让"白名单"与"归一"**同源**——分两处写迟早会长歪（本仓老病）。
 */
export function limitKey(key, value) {
    if (!isLimitKey(key)) return null;
    if (value === undefined) return true;
    return normalizeLimit(key, value);
}
