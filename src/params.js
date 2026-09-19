// story-world-v2/src/params.js
// 世界参数 · 档位表（leg26：**取代熵泵的环境量数值**）。
//
// 为什么改（用户 2026-09-11 定调，逐条记档）：
//   ① 熵泵原来用四个 0~1 的数（`dynamic.env`）当"世界气压"，并且**引擎自己按锯齿推**、
//      越阈就落一条写死的事件（「熵泵·民生凋敝：劳役征发四起」）。用户点破两件事：
//      **代码生成不了语义**、**引擎没有资格替世界宣布事实**——那四句台词与那四个数都是我们编的。
//   ② 改为**档位**：值 = **人话档位原话**，由**玩家在面板上选**（或书里抽到的原话），引擎**照抄、不换算**。
//      与既有先例同形：`canon.powerScale`（每本书自己那套档位名，引擎只抄不换算、不进公式）。
//   ③ 语义分工不变：引擎只负责"把玩家选的档位摆出来"，**不判断世界**。
//
// 纪律（一条都不能破）：
//   · 引擎**不读**这些档位做任何判断（不进门控/镜头/裁定/退休/波及/张力）。
//   · 值只能是**本文件的档位词**（白名单）；不在表内的值一律弃键，**绝不写占位值**。
//   · 玩家没选、书里也没写 ⇒ **键不存在**（空着就是空着），面板显示「未定」。

// 四个参数键（沿用既有键名——账本已有先例，改名会动旧账）
export const PARAM_KEYS = ['民生度', '动乱度', '天时', '张力推手'];

// ★每个参数的性质（leg26 c 加；**这不是元数据装饰，它决定面板上能不能当旋钮**）：
//   · 'independent' 自变量 —— 玩家/书定的**世界输入**（天时、外压这类"给定的条件"）。
//   · 'dependent'   因变量 —— **结果**（民生、乱象这类"被别的量决定的东西"）。
//   为什么必须分开（用户 2026-09-11 指认）：「民生这种东西肯定不用调，因为这是因变量」——
//   把因变量做成下拉旋钮，等于让面板**假装**"拧一下民生就变了"，而引擎既没有那个函数、
//   也没有那个资格（它不发明事实）。⇒ **因变量只呈现、不给旋钮**；要拧就得拧自变量。
export const PARAM_NATURE = {
    民生度: 'dependent',
    动乱度: 'dependent',
    天时: 'independent',
    张力推手: 'independent',
};

export const independentKeys = () => PARAM_KEYS.filter((k) => PARAM_NATURE[k] === 'independent');
export const dependentKeys = () => PARAM_KEYS.filter((k) => PARAM_NATURE[k] === 'dependent');

// ★★leg53（用户令「民生那一格拿掉」）：**面板上真正画出来的那几格**。
//   为什么需要这一层（而不是直接从 `PARAM_KEYS` 里删掉 `民生度`）：
//     · `PARAM_KEYS` 是**账本键表**——`setting-guard.test.js:93` 明确锁着"键表沿用（账本已有先例）"，
//       旧账里可能真有 `民生度` 那个键；从键表里删掉它 = 旧账那个键变成"认不出的键"，
//       会被 `param-store.normalizeStore` 当垃圾**静默丢弃**（本仓最忌的"悄悄吃掉账上的键"）。
//     · 而"面板画不画它"是**另一件事**：本棒实测它**没有任何生产者**（见 `src/unrest.js` 头部的取证）。
//   ⇒ 两件事分开：**键表不动**（旧账兼容）、**面板不画**（用户裁示）。
//   ★`民生度` 为什么被拿掉而不是接一个生产者：本棒试过两条结构输入都不成立
//     （"空闲实体占比"恒 0% = 死腿；"了结/新生比"是速度不是水平）⇒ 硬凑就是引擎在编语义。
export const PANEL_ENV_KEYS = Object.freeze(PARAM_KEYS.filter((k) => k !== '民生度'));

// ★★★leg53：**哪几格是"引擎每轮算的"**（＝真源**不许**插手的那几格）。
//   本棒之前 `动乱度` 没有任何生产者 ⇒ 它只在初始化时由**抽书**写一次，此后永远不动。
//   现在 `src/unrest.js` 每轮从账上真发生的事推它（用户令「引擎每轮算、覆盖书里那个」）。
//   ⇒ 由此产生三条必须挡住的东西（**这三条是本常量存在的理由**，缺一条都会出真事故）：
//     ① **真源不许接纳它**：`loadMergedEnv` 会把"账上已有的参数键"接进插件配置区
//        ⇒ 引擎每轮算出来的**结果**会被写进用户的配置桶，然后又被镜像回来
//        （"谁写谁读"绕成一圈 + 用户的 settings.json 里多出一个我方派生的值）。
//     ② **快照不许把它当"参数"剥掉**：`web/index.js` 的 `stripParamKeys` 判"只有参数在动 ⇒ 不拍快照"，
//        若把引擎派生的这一格也算进"参数"，它就从快照里被剥掉 ⇒ **回档丢状态**。
//     ③ **面板的「依据」要照着它说实话**（`render.js` 的 `readout`：写"引擎每轮算的"而不是"书里原话"）。
//   ★为什么这份名单住在**本模块**（叶子）而不是 `unrest.js`：依赖方向是
//     `render → unrest → setting`，而 `setting.js` 也要用它（比 `eventBornTick` 的家）——
//     名单若住 `unrest.js`，`setting.js` 就得反过来 import `unrest.js` ⇒ **嵌套循环**（本仓明禁）。
//     `params.js` 是叶子（零 import），住这里谁都能取，且"哪些键是参数"本来就是这个模块的语义。
//   ★`unrest.js` 会把它**再导出**一次（`ENGINE_DERIVED_ENV`），所以两种 import 路径都对。
export const ENGINE_DERIVED = Object.freeze(['动乱度']);

// 档位表：从"最差"到"最好"排列（顺序即语义方向，供面板排下拉用）
export const PARAM_GEARS = {
    民生度: ['崩溃', '艰难', '尚可', '富足'],
    动乱度: ['太平', '小乱', '动荡', '大乱'],
    天时: ['大灾', '失调', '平常', '风调雨顺'],
    张力推手: ['沉寂', '平缓', '暗涌', '紧绷'],
};

// 未定态的人话（面板显示用；**不落账**）
export const PARAM_UNSET = '未定';

// ---------- 开关类参数（leg26 b）----------
// 为什么也走"参数"这条路：它们同样是**玩家对插件的输入**（不是书里的设定、也不是引擎的判断），
// 落账位置相同（`dynamic.env`），写通道相同（`data-action="set-param"`）⇒ 一处真源、一条写通道。
// 与档位参数的唯一差别：值是 '1'/'0'，渲染成开关而不是下拉。
export const SWITCH_PARAMS = {
    // ★leg33d（用户令「顺便加一个启动和关闭插件的入口，要不然这个插件会直接自动生效」）：
    //   **插件总闸**。这是唯一一个"管插件自己"的开关（其余开关管的是插件对外的动作）。
    //   关掉之后：发消息不再自动推进世界、切聊天不再自动载入热账 ⇒ **装上/载入即静默**；
    //   要看世界仍然可以打开观棋窗口（面板照常渲染），要推可以按面板上的「推进一轮」（手动路径永不被闸）。
    //   故取 '0'（缺省关）＝照本仓开关惯例（`memoryEnabled` 也是 def='0'）⇒ **装上/载入即静默**，正对用户原话。
    //   ★但"缺省关"若直接落到**存量世界**上，会把它悄悄按停（真账实测用户那本 `memoryEnabled='1'`＝正在用）
    //     ⇒ 故 `web/index.js` 有一次性迁移：**有推进史且该键从未写过**的世界迁成 '1'（升级前后一字不变），
    //     全新世界留 '0'（要你按一下「开始」）。见 `ensureAutoAdvanceKey`。
    //   `master: true` = 参数页把它**排在最前、单独一张卡**（其余开关管"插件对外的动作"，它管"插件自己"）。
    //   ★★leg97：那句指路改成指向**设置页**——"推进一轮"那枚按钮的家是设置页（leg52 定案），
    //     而并页之后"观棋窗口"这个说法更容易被读成"某一页"（设计交接 §4.2 第 4 条要求并页后复查这一句）。
    autoAdvance: { label: '插件总闸 · 自动推进', master: true, hint: '关掉=插件不再自动生效（发消息不推进世界、切聊天不自动载入），要推请按设置页的「推进一轮」', def: '0' },
    memoryEnabled: { label: '写进记忆插件', hint: '把世界状态与大事投进「柚月の记忆」（逐字投原话，不经过任何模型）', def: '0' },
    // ★★leg40b（面板本体体检 · 第二刀）：**「记进编年史书」开关已撤**（原 key `recordEnabled`）。
    //   撤它的判据不是"不好用"，而是**它一个字节都不写**：全仓 `grep recordEnabled` 只有本文件那一行
    //   与注释，没有任何消费者 ⇒ 它是一个**摆在玩家面前、点了会落一次盘、然后什么都不发生**的开关。
    //   它的来路本仓早登记过：`docs/handoffs/session-handoff-2026-09-11-leg26.md` §7 E2——
    //   「**我顺手加的面，落点未核验**」"要的话先读编年史插件接口；不要就撤"。
    //   用户 2026-09-14 令「找出无用入口」⇒ 按该条登记的处置办：**撤**（要接实，得先读 ST 编年史插件接口，
    //   那是一件独立的活，不该以一个假开关的形式挂在面板上）。
    //   ★旧账无害：真账 `dynamic.env.recordEnabled` 现在写着 '0'，撤掉后它成为一个**无主键**——
    //   没有任何读者，也不进任何注入口（`paramsOf` 只遍历 `PARAM_KEYS`，开关只从本表取）⇒ 不会污染面板。
    //   纪律：**不做"读到旧键就静默删"的迁移**——那会给"引擎不主动改玩家账"开一个口子。
};
export const isSwitchParam = (key) => Object.prototype.hasOwnProperty.call(SWITCH_PARAMS, key);
export const isParamKey = (key) => PARAM_KEYS.includes(key) || isSwitchParam(key);
// 开关值口径：只有显式 '1' 算开（缺省=关；空值/未定一律当关——"空着就是空着"）
export const switchOn = (world, key) => {
    if (!isSwitchParam(key)) return false;
    const raw = world?.context?.setting?.dynamic?.env?.[key];
    return String(raw ?? '') === '1';
};

// 档位是否合法（白名单判据，唯一的验伪面——形态判据，不是词表判语义）
export const isParamGear = (key, value) =>
    typeof value === 'string' && (PARAM_GEARS[key] || []).includes(value);

// 归一：非白名单/非字符串一律返回 null（调用方弃键，不写占位值）
export function normalizeParam(key, value) {
    const v = typeof value === 'string' ? value.trim() : '';
    if (isSwitchParam(key)) return v === '1' || v === '0' ? v : null;
    return isParamGear(key, v) ? v : null;
}

// 从世界取参数块（缺键=未定；只读，不发明）。
//   键位沿用既有 `dynamic.env`（旧账里就是它——改名会动契约与旧账，且这个位置本就是"演化层环境量"）。
export function paramsOf(world) {
    const raw = world?.context?.setting?.dynamic?.env;
    const out = {};
    for (const k of PARAM_KEYS) {
        const v = normalizeParam(k, raw?.[k]);
        if (v) out[k] = v;
    }
    return out;
}

// 参数块（面板与注入共用**同一份口径**，防两处漂移）。
// 未定的键照实写「未定」——**不是**"没有这一栏"，因为玩家要看见"还没定"。
// 注意：这里落的是**引擎键名**（账本口径）；面板显示时用 LABELS.env 翻成玩家词。
// ★★leg41：`envOverride` = **参数真源**（插件配置区那一份）。传了就以它为准，不传才读世界账的镜像。
//   为什么必须支持它：真源与镜像之间**永远存在一个短暂窗口**（镜像要等一次写账），
//   面板若画镜像，玩家就会在这个窗口里看到旧值——那正是"改了就回默认"的观感来源。
// ★★★leg52（**逐键覆盖，不是整份替换** —— 旧实现写错了，判据当场抓红，留档）：
//   旧实现是 `const cur = envOverride ?? paramsOf(world)`（**整份替换**）⇒ 只要真源里出现
//   **因变量**（`民生度`/`动乱度`），那一格就会被真源覆盖，**把世界刚写下的结果顶掉**。
//   而 `param-store.js` 明写：**因变量永远不归真源管辖**（`isPlayerInputKey` 把它们排除在外），
//   理由是"一次载入接纳就会把引擎刚写的世界结果钉成玩家输入、反压世界的新值"。
//   ⇒ 定稿：**逐键覆盖 + 只认"归真源管辖"的键**——真源仍然优先（leg41 的口径一字未变），
//     但两头都堵住：①真源里**没有**的键照旧读账；②真源里**混进来的因变量一律不采纳**
//     （判据：`PARAM_NATURE[k] !== 'independent'` 就丢掉那个键）。
//   ★为什么 leg52 之前咬不到：`render.js` 传进来的 `paramEnv` 已经过 `isPlayerInputKey` 过滤，
//     所以这个洞被上游挡住了；本棒把过滤**同时**下沉到本层 ⇒ 两处一致是**一道锁**，不是一个补丁。
//   ★为什么不 import `param-store.js`：本模块是**叶子**（只导出常量与纯函数），
//     import 一个带状态语义的模块会把这层关系倒过来；判据用 `PARAM_NATURE` 就够，且它是**唯一真源**。
export const PARAM_ROWS = (world, envOverride = null) => {
    const fromWorld = paramsOf(world);
    const over = {};
    if (envOverride && typeof envOverride === 'object') {
        for (const [k, v] of Object.entries(envOverride)) {
            if (!PARAM_KEYS.includes(k)) continue;                  // 不是参数键：不认
            if (PARAM_NATURE[k] !== 'independent') continue;        // ★因变量：真源无权管辖，一律丢
            over[k] = v;
        }
    }
    const src = { ...fromWorld, ...over };
    return PARAM_KEYS.map((k) => {
        const v = normalizeParam(k, src[k]);
        return { key: k, value: v || PARAM_UNSET, options: PARAM_GEARS[k], nature: PARAM_NATURE[k] };
    });
};

// 兼容别名（渲染层沿用 `paramsRows` 命名）
export const paramsRows = PARAM_ROWS;
