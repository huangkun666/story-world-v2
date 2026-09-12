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
    autoAdvance: { label: '插件总闸 · 自动推进', master: true, hint: '关掉=插件不再自动生效（发消息不推进世界、切聊天不自动载入），要推请按观棋窗口的「推进一轮」', def: '0' },
    memoryEnabled: { label: '写进记忆插件', hint: '把世界状态与大事投进「柚月の记忆」（逐字投原话，不经过任何模型）', def: '0' },
    recordEnabled: { label: '记进编年史书', hint: '把本轮的编年行写进 ST 的「编年史」（书里的前史与它共存，互不覆盖）', def: '0' },
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
export const PARAM_ROWS = (world) => {
    const cur = paramsOf(world);
    return PARAM_KEYS.map((k) => ({ key: k, value: cur[k] || PARAM_UNSET, options: PARAM_GEARS[k], nature: PARAM_NATURE[k] }));
};

// 兼容别名（渲染层沿用 `paramsRows` 命名）
export const paramsRows = PARAM_ROWS;
