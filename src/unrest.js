// story-world-v2/src/unrest.js
// ★★leg53：**「乱象」的引擎生产者**——本仓第一个"引擎每轮从账上真发生的事推一个档位"的机制。
//
// ── 为什么要有这个模块（病因，逐条记档）────────────────────────────────────────────
//   · 用户指认：「**民生和乱象没人消费啊也没人生产**」——**成立，而且比"没人消费"更严重**。
//     本棒全仓 grep 的机械结论：
//       写点只有两处：`abstract.js:361`（初始化抽书）+ `param-hub.js:463`（玩家拧时的抢回）。
//       读点：引擎**一条判据都不读**；模型看得见（`pack.js:482` `env: dyn.env ?? {}` 整块进包）；
//             面板画出来（信息带 + 参数页）。
//   · ★★而 `param-hub.js:520` 写着「世界的因变量**归世界自己每轮写、每轮覆盖**（引擎的既有行为，零改动）」
//     ——**这句话在此之前是假的**：全仓**没有任何代码**在每轮写 `民生度`/`动乱度`
//     （`settle.js` 更新的是 `tension.intensity` 与 `derivedFrom`，从不碰 `env`）。
//     ⇒ 后果：这两个键被定义成"因变量"、面板因此**不给旋钮**（leg26 红线），**却又没有任何生产者**
//       ⇒ 唯一来源是初始化那一次抽书，而那个门极窄（提示词里写着「原文能判才填」）。
//       真账实证：`民生度` 键**根本不存在**、`动乱度` 有值（抽书那次命中了）。
//   · ⇒ 本模块把「每轮写」那句话**变成真的**（只做 `动乱度`，理由见下）。
//
// ── 机制：**结构判据，零新增数字**（照 `setting.js` 的张力公式同一条设计纪律）──────────
//   乱象档位 = **近 `TENSION_WINDOW` 轮里，"出事"铺开到几个不同地点**
//     · 窗口 **复用 `TENSION_WINDOW`**（不另立窗口数——本仓"一个新数字一次报批"）；
//     · 档位刻度 **复用 `params.js` 的 `PARAM_GEARS['动乱度']`**（不新开词汇表）；
//     · 断点由**档位条数**推导（n 档 ⇒ 每档约 2 个地点）⇒ 本文件里**一个裸数字都没有**。
//
// ── ★★三条纪律（缺一条这个机制就是错的）──────────────────────────────────────────
//   ① **它不是第二把尺子**：张力强度那边吃的是"近窗**事件密度**"（`recentEventCount`），
//      本机制吃的是"**扰动铺开多宽**"（不同地点数）——**同一地点发生 7 件事，地点数仍是 1**
//      （判据 `unrest.test.js` B 条就是这条的机械证据）。两个数度量不同的东西，不许合成一个。
//   ② **它必须真会动**：`setting.js` 的 `rival` 那条腿实测 100 tick 里 t10–t80 **恒为 1.0000**
//      ⇒ 等价于写死的 +0.4 常数偏置（leg25 b 记档，"算出来的数字照样可以是死的"）。
//      ⇒ 判据 C 条**量取值多样性**，不只量"算出来了没有"（真账实测：不同地点数 20 轮里 8 种取值）。
//   ③ **引擎不发明事实**：这把档位**完全由账上已落账的事件派生**（地点是事件自己的字段），
//      引擎**不新增任何事实、不写任何台词**——这正是 leg26 删掉旧熵泵（四个锯齿数 + 四句写死台词）的理由，
//      本模块刻意走它的反面：**只读账、只派生、零创作**。
//
// ── ★只做「乱象」，不做「民生」（这一格是**有意留白的**）──────────────────────────
//   用户令是"接成真的"，但本棒实测两条候选输入**都不成立**，故 `民生度` **不设生产者**：
//     · "空闲实体占比" ⇒ 真账 20 轮**恒 0%（1 种取值）**⇒ 死腿，用了就是重演 `rival` 那一课；
//     · "事件了结/新生比" ⇒ 那是**速度**不是**水平**，且与乱象高度相关 ⇒ 第二把尺子。
//   ⇒ 硬凑一个 `民生 = f(乱象)` 的查表**就是引擎在编语义**（换个地方犯同一个错）。
//     ⇒ 用户据此拍板：**民生这一格从面板撤下**（见 `params.js` 的 `PANEL_ENV_KEYS`），
//       `PARAM_KEYS` 仍保留它（旧账兼容——判据 `setting-guard.test.js:93` 锁着那张表）。
import { TENSION_WINDOW, eventBornTick } from './setting.js';
import { PARAM_GEARS, ENGINE_DERIVED } from './params.js';

/** 观察窗（**复用**张力那个窗口；不新立一个数）。 */
export const UNREST_WINDOW = TENSION_WINDOW;

/** 四档（**复用** `params.js` 的白名单，顺序即"由轻到重"）。 */
export const UNREST_GEARS = Object.freeze([...PARAM_GEARS['动乱度']]);

/** 落账位置（沿用既有键位——改名会动旧账）。 */
export const UNREST_KEY = '动乱度';

/**
 * ★★**哪些环境格是"引擎每轮算的"**——名单的**家**在 `params.js`（叶子模块，见那里的长注释：
 *   住本文件会让 `setting.js` 反过来 import 本文件 ⇒ 嵌套循环，本仓明禁）。
 *   这里**再导出**一次，好让调用方按语义从"生产者"这边取（`render.js` 就是从这个名字取的）。
 */
export const ENGINE_DERIVED_ENV = ENGINE_DERIVED;

/**
 * 断点由**档位条数**推导，不写死（改白名单就自动跟着改）：
 *   n 档 ⇒ 第 i 档（0-based）的下界 = 1 + i*2，最高档**封顶**（再多也只是最重那一档，不发明第五档）。
 *   按 `['太平','小乱','动荡','大乱']` 展开 ⇒ 0–2 太平 · 3–4 小乱 · 5–6 动荡 · 7+ 大乱。
 */
const STEP_PER_GEAR = 2;

/**
 * 近 `UNREST_WINDOW` 轮里，"出事"铺开到几个不同地点。
 * ★口径（三条，与 `recentEventCount` 同源）：
 *   · 只数**窗口内出生**的事件（`tick - bornTick <= 窗口`，**含边界**——与张力那边逐字同口径）；
 *   · 出生轮解析不出来（老账/坏 id）⇒ `eventBornTick` 给 `-Infinity` ⇒ 自然落在窗口外，**不占位**；
 *   · **地点去重**是全部要点：同一地点发生多件事只算一个地点（见上面纪律①）。
 *   · 位置取不到（空串/缺字段）⇒ **不计数**（不发明一个"未明"地点来凑数）。
 */
export function unrestPlaces(world, tick = world?.meta?.tick ?? 0) {
    const places = new Set();
    for (const ev of world?.events || []) {
        const born = eventBornTick(ev?.id);
        if (!Number.isFinite(born)) continue;              // 老账/坏 id：不占位
        const age = tick - born;
        if (age < 0 || age > UNREST_WINDOW) continue;       // 未出生/超出窗口
        const pos = String(ev?.position ?? '').trim();
        if (pos) places.add(pos);
    }
    return places.size;
}

/** 地点数 → 档位（断点由档位条数推导；最高档封顶）。 */
export function unrestGearOf(world, tick = world?.meta?.tick ?? 0) {
    const n = unrestPlaces(world, tick);
    const idx = Math.min(UNREST_GEARS.length - 1, Math.floor(Math.max(0, n - 1) / STEP_PER_GEAR));
    return UNREST_GEARS[idx];
}

/**
 * 每 tick 调用（位置与 `updateTensionIntensity` 同款：`settle` 落账链的末尾）。
 * ★返回**新世界**（纯函数，不改入参）——照 `updateTensionIntensity` 的既有写法，
 *   免得两条"引擎每轮写"的路一个改入参、一个返回新值（同一件事两种写法＝本仓老病）。
 * ★只碰 `env[动乱度]` 一个键，其余键（玩家拧的自变量/开关/上限）**一格都不动**。
 */
export function updateUnrestGear(world, tick = world?.meta?.tick ?? 0) {
    const dyn = world?.context?.setting?.dynamic;
    if (!dyn) return world;
    const gear = unrestGearOf(world, tick);
    if (dyn.env?.[UNREST_KEY] === gear) return world;      // 没变 ⇒ 返回原对象（调用方据此不写账）
    return {
        ...world,
        context: {
            ...world.context,
            setting: {
                ...world.context.setting,
                dynamic: { ...dyn, env: { ...(dyn.env || {}), [UNREST_KEY]: gear } },
            },
        },
    };
}
