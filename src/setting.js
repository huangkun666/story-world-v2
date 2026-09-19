// story-world-v2/src/setting.js
// 设定池读写面（K25/设定大势层，细案 §3.3 → A-4）：context.setting 全池（frozen+dynamic）
// 对模型不可写——本模块给引擎两件工具：
//   1) isSettingRef(s)：保留键空间判词——'setting' 与 'setting.*' 恒为引擎领地，
//      任何世界步实体引用字段命中即拒绝（check-step 集成；红线 1 同机制：校验拒绝、世界如实不动）；
//   2) 世界参数档位（leg26）：**玩家可选、引擎照抄**——写通道在编排层（参数页 data-action="set-param"），
//      引擎不推演任何数值；模型侧仍无直写路径（world-step schema 无设定池写面）。
// "事件可改（联动状态源事件）"的规则落地在 K27 环境推演器 tick 段——那里才有事件落地上下文。

export function isSettingRef(s) {
    return typeof s === 'string' && (s === 'setting' || s.startsWith('setting.'));
}

// leg26：`patchDynamic(setting,{key,delta})`（环境量数值的引擎独占写通道）**已删除**——
//   它的唯一调用者是熵泵的锯齿推演，而那套（四个 0~1 的数 + 危险带/回缓带 + 四句写死台词）已随
//   "引擎不发明事实"整条撤掉（见 entropy.js 头部说明）。世界参数现在是**档位原话、玩家可选、
//   引擎照抄**（src/params.js），没有任何"引擎推演数值"的写通道存在。
//   模型侧的禁区不变：`isSettingRef` 仍把 setting/setting.* 判为引擎领地（world-step schema 无写面）。

// ---- 事件 id 契约共享解析器（ev_<tick>_<n> / ev_pump_<tick>_<n> / m_<n>——取首个数字段）----
// 单一契约点：settle 的 bornTickOf 与本处同源（防两处各自演化）。
// ★★★leg99 修：**开局种子 `ev_seed_N` 算第 0 轮**（此前"取首个数字段"把它读成了出生轮 `N`）。
//   病根（leg98 §9 登记、leg99 量清）：`ev_seed_N` 里的 `N` 是**播种时的枚举号**，不是轮次——
//   出处 `src/seed-roots.js:149` 的 `while (taken.has(\`ev_seed_${n}\`)) n += 1;`（只保证 id 不撞车）。
//   ⇒ 旧法把种子的"出生轮"读成 1…8 ⇒ 它们在**当前轮 12** 时距当前 4~10 轮 ⇒ 被算进"近 10 轮"窗口。
//   ★玩家看得见的那一笔（leg99 装置 `F:/deepseek/tmp/prototypes/leg99-born-impact.mjs`，真机账 大荒z·第12轮）：
//     「近 10 轮事件」这个数  **83（旧·含 7 件种子）→ 76（新）**。
//   ★两个读数**实测不受影响**（同一装置量的，所以这不是"报批级"改动）：
//     · 张力强度 freq 腿：两口径都早被 `TENSION_FREQ_DIV`=4 归一饱和在 1.000 ⇒ 无差；
//     · 乱象档位：把种子整个剔掉再问 `unrestGearOf`，**档位照旧**「大乱」⇒ 不变。
//   ★这是**回到本仓早已写定的口径**、不是新口径：`src/panorama.js:22` 的注释与
//     `test/panorama.test.js:148`（`bornTick('ev_seed_3') === 0`）一直这么写，两把尺子此前不一致。
//   ★已知残余（如实登记，**本笔不治**）：`src/memory-bridge.js:282,289` 与 `src/pack.js:220,801`
//     各自 **copy 了一份同族逻辑**（前者明写"与 settle/setting 同源"、后者连注释都停在 `split('_')[1]`），
//     ⇒ 它们仍把种子读成第 N 轮。影响面实测很小（`pack.js:220` 只是已闭环根排序的次序、
//     `:801` 只对 `source.type==='state'` 生效 ⇒ **种子走不到那一支**），故本笔不动它们，
//     只在此处登记；把四处**收敛成一处实现**是模块图改动，另案。
export function eventBornTick(id) {
    // 种子先判：它的数字段是枚举号、不是轮次（判据在 test/setting.test.js）
    if (/^ev_seed_\d+$/.test(String(id || ''))) return 0;
    const seg = String(id || '').split('_').find((s) => /^\d+$/.test(s));
    const n = seg === undefined ? NaN : Number(seg);
    return Number.isInteger(n) && n >= 0 ? n : -Infinity;   // 解析失败按"老账"（不占活跃度窗口）
}

// ---- K29 张力强度算法（细案 §3.1 要点 + T3 方向：事件频次 × 分量比 × 衰减——先曲线后报批，铁律 2/8）----
// 强度 = 引擎确定性计算（模型不拍，world-step 无此写面）；数字已定案（2026-09-08 报批二批 #9-12，K29 曲线为报批素材）。
export const TENSION_WINDOW = 10;      // 定案（报批二批 #9）：活跃度观察窗（tick，含熵泵等全部近期事件）
export const TENSION_FREQ_DIV = 4;     // 定案（报批二批 #10）：频次归一除数（窗内 4 事件 = 满频）
export const TENSION_INERTIA = 0.9;    // 定案（报批二批 #11）：每 tick 惯性衰减（记忆系数——冷清时强度不骤跌）
export const TENSION_BLEND = { freq: 0.6, rival: 0.4 };   // 定案（报批二批 #12）：压力合成权重

// 近 TENSION_WINDOW 轮内出生的事件数（唯一一份口径）——供强度公式与**渲染层**共用。
// 为什么提到模块级：面板上原写「烈度带词 + 百分比」，而 rival 腿实测恒为满值（见下方注释），
//   那个 %% 实际只反映**事件密度**。与其让面板摆一个要解码的数，不如直说这个可验证的事实。
//   `world.meta.tick` 与强度更新用的 tick 同源（settle 先自增 meta.tick 再调 updateTensionIntensity），
//   故两处读数必然一致——不会出现"面板数与公式不同步"。
export function recentEventCount(world, tick = world?.meta?.tick ?? 0) {
    return (world?.events || []).filter((e) => tick - eventBornTick(e.id) <= TENSION_WINDOW).length;
}

export function computeTensionIntensity(world, tick) {
    const freq = Math.min(1, recentEventCount(world, tick) / TENSION_FREQ_DIV);
    // ⚠️ 已知失真（leg25 b 实测，登记为 A1b）：rival 是"去掉一个 w1 之后的并列者"，只要有并列就恒为 1；
    //   而 leg24 片2 之后势力四维普遍为空 → 同取中立 floor → 必然并列 ⇒ **实测 100 tick 里 t10–t80 恒为 1.0000**
    //   （均值 0.9913、并列者平均 96.2 个）。即这条腿等价于一个 +0.4 的**常数偏置**，"两强对峙"没被真正度量。
    //   它不属于定案要砍的面（定案只砍「裁胜负 + 排序」；切片细案 §3 结论句明写"算能见度/范围不算被禁"），
    //   且数字已报批（二批 #9-12）——故**保留计算不动**，只在渲染层把说法改诚实（不再叫「烈度」）。
    const ws = Object.values(world.weights || {}).sort((a, b) => b - a);
    const w1 = ws[0] ?? 0;
    const w2 = ws[1] ?? 0;
    const rival = w1 > 0 && w2 > 0 ? Math.min(1, Math.min(w1, w2) / Math.max(w1, w2)) : 0;   // 两强对峙度（接近=1，独强=0）
    const pressure = TENSION_BLEND.freq * freq + TENSION_BLEND.rival * rival;
    const prev = world.context?.setting?.dynamic?.tension?.intensity ?? 0.5;
    return Math.min(1, Math.max(0, prev * TENSION_INERTIA + (1 - TENSION_INERTIA) * pressure));
}

export function updateTensionIntensity(world, tick) {
    // settle 每 tick 调用（重算分量之后）——写入 dynamic.tension.intensity（引擎独占；模型无直写路径）
    const setting = world.context?.setting;
    if (!setting?.dynamic?.tension) return;
    const intensity = computeTensionIntensity(world, tick);
    world.context.setting = {
        ...setting,
        dynamic: { ...setting.dynamic, tension: { ...setting.dynamic.tension, intensity } },
    };
}

// ---- 盘算浪尖派生器（细案 §3.6② → A-5：大势两来源之二）----
// 顶层盘算终结（达成/败露/变形）/取消 → 向 dynamic.derivedFrom 推"浪尖"项（tension.direction 的候选来源，
// 引擎记账；上限 TIDE_CAP 滑动保留最近——SSOT 防漂移）。与抽象派生器并列的第二写入者；无第三来源（模型无写面）。
export const TIDE_CAP = 20;   // 定案（报批二批 #13）：浪尖派生引用上限

export function pushTidePeak(world, closedAgendaIds, tick) {
    const dynamic = world.context?.setting?.dynamic;
    if (!dynamic) return;
    const tops = (world.agendas || []).filter((a) => closedAgendaIds.has(a.id) && !a.parentId);
    if (!tops.length) return;
    const derivedFrom = [...(dynamic.derivedFrom || [])];
    for (const a of tops) derivedFrom.push(`浪尖:${a.id}@${tick}`);
    world.context.setting = {
        ...world.context.setting,
        dynamic: { ...dynamic, derivedFrom: derivedFrom.slice(-TIDE_CAP) },
    };
}