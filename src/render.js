// story-world-v2/src/render.js
// 渲染核心纯函数（K33/K34，渲染层；细案 A-1/A-2/A-3/A-6）：
//   SSOT → HTML 片段（六页签全量）。窗口只渲染引擎产物、零发明状态；
//   同输入 → 输出逐字节一致（纯函数锁）；引擎 id 只进 title/data-ref 悬停；
//   全边界 escapeHtml（XSS 防线）。
// 玩家语言词典（A-3 黑名单以共识样例 v3 为准——"盘算/谋划"为玩家通词放行）：
//   禁：分量/熵泵/里程碑/上溯/波及/指纹/派生源/强度参数名/hardPower…/tick/裸 id。
import { PARAM_GEARS, PARAM_KEYS, PARAM_UNSET, SWITCH_PARAMS, paramsOf, paramsRows, switchOn } from './params.js';   // leg26：环境量数值 → 世界参数档位（玩家可选）
// ★leg32：引擎尺度（盘算三道上限）的**唯一真源**。此前面板把分母写死成 `/15` `/5`
//   ⇒ leg31b 把 `topLevel` 5 → 10 之后，世界真的变宽了而面板还写着 5，
//   玩家无法从面板判断任何变宽实验是否奏效（用户实机「一点变化都没有」追出来的真缺陷）。
//   依赖方向：render → settle（settle 不反向依赖 render）——无环，已在 import 图上核过。
import { AGENDA_CAPS } from './settle.js';
import { lensList, membersOf } from './pack.js';   // K46：镜头名单（引擎层同口径）与麾下成员派生——渲染只读复用
import { TENSION_WINDOW, recentEventCount } from './setting.js';   // A1b：张力行改说可验证事实（近 N 轮事件数），与公式共用同一口径

// 面板构建号（自证用）：用户实机常遇到"改了代码但页面还是旧的"（浏览器缓存 web/index.js）。
//   这个号随每次功能落地递增，渲染进面板页脚——Ctrl+F5 后一眼就能判断载的是哪一版。
//   判据（第二十五棒）：`有值/未查/未加载到/书未明述` 查书标记 + 位置列去重 = 本轮；
//   上一版是"查书标记（缺未查）+ 位置未明徽章重复"。
//   第二十五棒 b 追加（A1b）：张力行不再写「烈度带词 + 百分比」，改「近 N 轮事件 N 件」；
//   麾下成员序由分量序改**名号序**（A1）。← 看到 `+a1b` 后缀即已载入这两条。
//   第二十五棒 d 追加：查书前置步的异步 bookText 修通 + **取书路径改 ST 官方指针**
//   （`data.extensions.world`，旧法读 `character.world` 恒空 ⇒ 取书 0 条 ⇒ 假「书未明述」）
//   + 未查态 title 属性截断修复 + **查书补全三件套**（批量补全/单实体重查/选人可见）。
//   第二十五棒 f 追加：**位置继承的接线修通**（`bookEntriesForInherit` + 三处调用点）——
//   之前那句"接线断了而测试全绿"让真账 563 实体真位置恒 0、位置列整列「未载」；现首开面板即推 173。
//   同棒另删两处死机制：盘算满步的「败露」支（判据输入早随四维消失）+ 可见性掩码（两取值都过阈值=恒真）。
//   同棒收尾：观棋侧栏与 `📍` 行由"平铺一切"改为**按处聚合**（位置当分组键；"位置未载"单列一筐）。
//   ★leg26 追加（用户令「参数独开页签」+「熵泵删掉没用的功能，改个定义就好了」）：
//   ① 新增**参数页**（第七页签）：世界参数档位由玩家选，引擎照抄（`src/params.js` 是唯一真源）；
//   ② 环境量从"四个引擎推的数"改为**档位原话**，撤掉"危险带"判态与空心条百分比（引擎对档位零表态）；
//   ③ 熵泵改定义：只在**账本自己能证明的事实**（连续 N 轮无真实事件）时出声，世界一动就收声。
//   ← 看到 `leg26-params` 即已载入这三条。
//   ★leg27 追加（用户实机「二十多分钟很慢」+「**我也看不到日志不知道抽得怎么样**」）：
//   抽取过程**可见**——编排层注入式上报每段的开始/结束/字符数/耗时（`src/abstract.js` 的 onProgress），
//   `web/index.js` 转成状态栏进度 + 控制台每段一行；超时改为**止损跳过**（不再对半拆/重试、不再烧 62 分钟/块）。
//   ★leg27 后追加（用户令「再做一个快照容错系统，用户和 llm 每一步的修改都会生成快照」）：
//   **第八页签「快照」**（`renderSnapshotsHtml`）——每步可回退；存插件本地库（IDB，不占聊天文件）、保留 15 步、
//   **只回世界账**（对话不动）。判据与真实体积见 `docs/spec-snapshot-fault-tolerance.md` §7。
//   ★leg27 g（用户实机「记忆插件也没有记录事件，还把插件原来的**角色档案**清空了」）：
//   记忆投递读现状那一行原写 `Storage.loadState(null, null)`——**显式传 null 使插件 sessionId 默认值失效**
//   ⇒ 读回非对象 ⇒ 退回空态并被 `force` 覆盖写回 ⇒ **用户档案被逐条抹掉**。现改为传插件自己的默认态，
//   并有判据锁死（`test/snapshot.test.js` 的 leg27 g 两条：结构层禁止 null 占位 + 行为层 fake 插件真跑保档案）。
//   ← 看到 `leg27h-mem-selfevidence` 即已载入上面**全部**八条（进度+读秒心跳 / 超时分治 / 快照 / 参数页版式与误触防护 / 落账作用域 / 快照链对齐 / 记忆读取不覆盖用户档案 / 记忆投递自证面 + 大事表「未结」档）。
//   ★leg27 h（用户实机「**记忆插件也没有记录事件**」+ 口径「事件要落地才成事件」+「**但不会出现其他盘算了啊**」）：
//   ①记忆投递**自证面**——参数页开关卡挂「上次投递」的实测事实（第几轮 / 大事几条 / 或失败原因），
//     没投过则明确显示"还没投过"（**绝不显示"已投"**——这一棒吃的就是假绿的亏）。
//   ②大事表**分档如实**：已落地无标记、在飞带「未结 ·」（旧口径"在飞一律不进"让这张表前 8 轮恒空）。
//   ③世界变宽的诊断与候选 → `docs/spec-world-widening.md`（★真账实测：618 实体里 **614 静默**、可动 4 个、
//     能提新盘算的来源 2 个；根因＝**静默门是单向门**：没出手过 ⇒ 永远没有 lastActiveTick ⇒ 永远静默）。
//   ★leg29（用户令「事件波及也改成 15 个」+「写进提示词」）：`RIPPLE_TARGET_CAP` 3 → 15，并把上限写进
//   提示词铁律 8（此前四处一字未提 ⇒ 模型写超限只撞"拒整步"、白烧一整轮）。**引擎/校验面行为不变**，
//   故无界面改动——但构建号仍要往前走一格，否则"页面还是旧的 vs 代码已更新"无法用构建号判定。
//   ★实测注意：15 不是最先咬人的天花板（`AGENDA_INVOLVED_CAP` 同为 15，集合含属主 + 本步动作方
//   ⇒ 属主自行动时单事件最多波及 14）；该咬合已由 `test/worldstep.test.js` 的 leg29 用例钉死。
//   ★leg30（用户 2026-09-12 两张记忆插件截图 + 一句「很乱，这信息插入的，怎么解决？我需要有条理」）：
//   记忆投递**收成两种形状**（当下=覆盖一条 / 发生=追加一列，前史是同一列里成段的行），
//   并立"一字段一义"：位置列只装地点、波及名单进人名列、`状态` 只装"了结没"、`备注` 我方一个字不写。
//   ★这一棒**真的动了界面**（记忆插件的表名/列名/卡内容都变了），所以构建号必须往前走。
//   ★leg31（实体段表达法收改，细案 `docs/spec-entity-section-encoding.md`）：**界面零变化**（面板读的是内部
//   分段对象，不是 pack 文本），但**模型看到的东西变了**（entities 段从对象数组改成行式表格，
//   `MAIN_PROMPT_V` v2-agenda-t1-6 → v2-agenda-t1-7）⇒ 构建号照旧往前走一格：
//   否则"页面还是旧的"与"新表达法已生效"无法用构建号区分（leg29 立此规矩）。
//   ★leg31b（世界变宽·保守档）：`AGENDA_CAPS.topLevel` 5 → 10（用户令「先走保守的」）——这是**引擎判据**
//   的一次真改动（先前四道闸全是只测不改），且它以"盘算条数 ~2 倍"直接改变世界演化形状
//   ⇒ 属主面 3 → 8、盘算 4 → 9 条（细案 `docs/spec-world-widening.md` §5.5）；**界面零变化**，
//   但**世界行为变了** ⇒ 构建号照旧走一格（同 leg29 立的规矩）。
//   ⚠**构建号里不许出现引擎术语**：本棒第一版起名 `leg31b-agenda-top10` ⇒ 当场被 K33/A-3 那三条
//   "玩家可见文本零引擎术语"的用例抓红（**构建号渲染在实体表表头 = 玩家视线内**）⇒ 改为不含禁词的写法。
//   ★leg32（**这一格与前两格性质不同：这次界面真的变了**，起因是用户实机「盘算并没有变多
//   甚至一点变化都没有」）：leg31b 只改了引擎那个数，而**面板把分母写死成 `/5`** ⇒ 玩家无法从
//   面板判断变宽是否生效。本棒把分母改成读引擎真源，并在参数页摆出三道上限（只读）。
//   ⚠如实记：leg31b 那一笔的 commit message 写的是"界面零变化"——**在那笔的范围里是对的**
//   （它只动了 `PANEL_BUILD` 一行），但它没意识到面板分母是写死的，于是"引擎 5→10、面板仍写 5"
//   这件事在用户眼里就是"什么都没发生"。教训：**改了引擎判据就要检查有没有第二份副本在呈现它**。
export const PANEL_BUILD = 'leg32i-player-row-marked';

export const LABELS = {    env: { 民生度: '民生', 动乱度: '乱象', 天时: '天时', 张力推手: '时局' },
    kind: { faction: '势力', character: '角色' },
    visibility: { known: '明', concealed: '暗' },
    status: { active: '活跃', retired: '背景', dead: '已灭' },
};

// leg25 c（用户令「删」）：`LABELS.attr` 与 `ATTR_HINTS` **整条删除**——四维浮点（兵力/权位/人脉/耳目）
//   不存在了：它们没法精确表示（书里没刻度、现实里也没有），压成 0–1 就是拿精确的外壳装模糊的内容，
//   而且手拍值让"编的"看起来像"算的"（design-core-leg23 §4 第 1 条）。
//   书里的说法一律**照抄成文本**显示（实体 `实力` = 「T9渡劫巅峰」，据书；见 spec-entity-field-lookup）。
//   面板从此不再有「有据 n/4 / 数值无据」这类说法——那些数没有了，"有几维有据"自然无从谈起。

// K41/链视图细案 §3.1（A-16）：编年五筛（chips 玩家词面 ↔ kind 契约 token）
export const CHRONICLE_FILTERS = Object.freeze([
    { token: 'scheme', label: '谋划' },
    { token: 'major', label: '大事' },
    { token: 'ripple', label: '牵动' },
    { token: 'shade', label: '暗处' },
    { token: 'state', label: '时局' },
]);

// 渲染产物黑名单（引擎术语不得出现在玩家视线）
export const BLACKLIST = [
    '分量', '熵泵', '里程碑', '上溯', '波及',
    // leg26：参数键本身（民生度/动乱度…）是**账本口径**，不是玩家词——面板一律走 LABELS.env
    //   （民生/乱象/天时/时局）。带上它们才能锁住"引擎键名不许漏进玩家视线"。
    '民生度', '动乱度', '张力推手', '异想天开键',
    'fingerprint', 'derivedFrom', 'intensity', 'polarity', 'direction', 'tension',
    'hardPower', 'office', 'network', 'intel', 'visibility', 'concealed',
    'schema', 'ssot', 'worldstep', 'agenda', 'chronicle', 'milestone', 'tick',
];

export function escapeHtml(s) {
    return String(s ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export const fmtTick = (n) => `第${n}轮`;
export const fmtPct = (n) => `${Math.round((n ?? 0) * 100)}`;

export function entityLabel(world, id) {
    if (id === world.context?.playerId) return '你';
    const e = world.entities.find((x) => x.id === id);
    return e ? e.name || id : id;
}

export function kindLabel(entity, world) {
    if (entity.id === world.context?.playerId) return '你的棋子';
    return LABELS.kind[entity.kind] || '实体';
}

// 参数档位态（leg26）：未定 / 已定（档位原话）。**没有"危险/回缓"这种引擎判断**了——
//   档位是玩家/书定的世界设定，引擎只照抄摆放，不评价它好不好。
export function paramBand(value) {
    return { state: value && value !== PARAM_UNSET ? 'set' : 'unset', word: value || PARAM_UNSET };
}

function msIdTick(id) {
    const m = /m_(\d+)/.exec(String(id || ''));
    return m ? Number(m[1]) : 0;
}

// 浪尖项契约 浪尖:<id>@<tick>（K29 补遗）→ 盘算目标+轮（引擎 id 不透传）
function tideLabel(world, item) {
    const m = /浪尖:(\w+)@(\d+)/.exec(String(item || ''));
    if (!m) return escapeHtml(String(item));
    const a = (world.agendas || []).find((x) => x.id === m[1]);
    return a ? `${escapeHtml(a.goal)}（第${Number(m[2]) + 1}轮）` : escapeHtml(String(item));
}

const dotSteps = (progress, maxSteps) => {
    const n = Math.max(0, maxSteps || 0);
    let s = '';
    for (let i = 0; i < n; i += 1) s += `<span class="sw2-dotstep${i < progress ? ' on' : ''}"></span>`;
    return s;
};

// ============ 观棋页 ============

export function renderDigestHtml(world) {
    // leg26：参数档位是**世界输入**，不是引擎判出的"危险处境"——所以时局句不再由它拼"越界的处境"。
    //   档位只如实列出来（人话原话），引擎对它们**零表态**（不裁好壞、不排序、不换算）。
    const rows = paramsRows(world);
    const setList = rows.filter((r) => r.value !== PARAM_UNSET).map((r) => `${LABELS.env[r.key]}${r.value}`);
    const unsetCount = rows.length - setList.length;

    const active = (world.agendas || []).filter((a) => !a.closed);
    const hidden = active.filter((a) => a.visibility === 'concealed').length;

    // leg20 世情路径恢复：抽象书级 situation 为时局句主句（原文措辞），拼装句降为无世情时的回退
    // leg21（用户指认）：时局句只领世情——张力（极/方向/强度）归「张力 · 结构性三件套」行，不再混进主句
    const sit = world.context?.setting?.frozen?.canon?.situation;
    const main = sit
        ? escapeHtml(sit)
        : '大势未聚，各方各走各的路';
    const sub = setList.length || active.length
        ? `${setList.length ? `参数：${escapeHtml(setList.join('、'))}${unsetCount ? `（另 ${unsetCount} 项未定）` : ''}。` : ''}各方正谋划 ${active.length} 件事${hidden ? `，其中 ${hidden} 件在暗处` : ''}。`
        : '眼下没有在办的谋划，也没有越界的处境。';
    return `<div class="sw2-digest"><div class="sw2-digest-line">${main}</div><div class="sw2-digest-sub">${sub}</div></div>`;
}

// 参数档位一行（信息带/设定页共用；leg26）：**档位是人话原话**，不是数——所以没有条、没有百分比。
//   未定就写「未定」+ 空心点（**不填占位值**；与"空着就是空着"同源）。
export function envRowHtml(key, value) {
    const v = typeof value === 'string' && value.trim() ? value.trim() : PARAM_UNSET;
    const unset = v === PARAM_UNSET;
    return `<div class="sw2-env-row${unset ? ' sw2-nodata' : ''}">`
        + `<span class="sw2-env-name">${LABELS.env[key] || escapeHtml(key)}</span>`
        + `<span class="sw2-env-bar"><i style="width:${unset ? 0 : 100}%;background:var(--sw2-amber)"></i></span>`
        + `<span class="sw2-env-val">${escapeHtml(v)}${unset ? '<small class="sw2-nodata-tag">无据</small>' : ''}</span></div>`;
}

// ============ 参数页（leg26）============
// 世界参数 · 档位：**玩家在这里选**，引擎只摆出来（不读、不判断、不进任何机制）。
// 为什么独立一页（用户令「参数独开页签」）：它既不是"书里的设定"（设定页=只读原稿），
//   也不是"插件设置"（设置页=通道/存储）——它是**玩家对世界的输入**，性质不同，故独立。
export function renderParamsHtml(world, { config = {} } = {}) {
    const cfg = config || {};   // leg27 h：开关卡要挂"上次投递"的实测事实（渲染层不持状态，一律由调用方注入）
    const rows = paramsRows(world);
    const indep = rows.filter((r) => r.nature === 'independent');
    const dep = rows.filter((r) => r.nature !== 'independent');
    const setCount = rows.filter((r) => r.value !== PARAM_UNSET).length;

    // 自变量卡：**给旋钮**（玩家定，引擎照抄）
    // leg27 后：行 **按"值/控件"与"说明"分栏**——旧版把「当前 值」和「设定为 下拉」各占一行、
    //   每行还带一句说明 ⇒ 说明文字（14px 继承）把卡片撑得很丑（用户实机「说明文字太大」）。
    //   现在：当前值做成一行只读 facts 行（`sw2-row` 基础规则给三栏对齐），设定行只留 标签 + 控件 + 一句短语。
    const knob = (r) => {
        const opts = [`<option value="">未定</option>`]
            .concat(r.options.map((g) => `<option value="${escapeHtml(g)}"${g === r.value ? ' selected' : ''}>${escapeHtml(g)}</option>`));
        return `<div class="sw2-set-card" data-param="${escapeHtml(r.key)}">`
            + `<h4>${LABELS.env[r.key] || escapeHtml(r.key)} <span class="sw2-param-kind">自变量</span></h4>`
            + `<div class="sw2-row"><span>当前</span><b class="sw2-param-val">${escapeHtml(r.value)}</b>`
            + `<em>可选：${r.options.map((g) => escapeHtml(g)).join(' / ')}</em></div>`
            + `<div class="sw2-row"><span>设定为</span>`
            + `<select class="sw2-param-select" data-action="set-param" data-param="${escapeHtml(r.key)}">${opts.join('')}</select>`
            + `<em>引擎只照抄</em></div></div>`;
    };
    // 因变量行：**不给旋钮**——只呈现（书里写的原话，或空着写「未定」）
    const readout = (r) => `<div class="sw2-row" data-param="${escapeHtml(r.key)}">`
        + `<span>${LABELS.env[r.key] || escapeHtml(r.key)} <span class="sw2-param-kind sw2-param-kind-dep">因变量</span></span>`
        + `<b class="sw2-param-val">${escapeHtml(r.value)}</b>`
        + `<em>${r.value === PARAM_UNSET ? '书里没写 ⇒ 空着' : '书里原话'}</em></div>`;

    // 开关类参数（写记忆 / 记编年史书）——同一页、同一条写通道，渲染成开关而不是下拉
    // leg27 h：开关卡下面挂**上次投递的实测事实**（用户两次靠肉眼发现记忆没生效 ⇒ 必须有自证面）。
    //   口径：只报事实、不报"应该没问题"；没投过（null）只显示"还没投过"，绝不显示"已投"。
    const memPush = cfg.memoryPush || null;
    const pushLine = (key) => {
        if (key !== 'memoryEnabled') return '';
        if (!memPush) return '<em>还没投过（推一轮后这里会显示「记忆已投 · 第 N 轮」）</em>';
        return memPush.ok
            // ★leg30：删掉「史卷 N 段」——那张表已不存在（前史成了「世界大事」里成段的行），
            //   留着它只会恒显示"史卷 0 段"，那是**假的自证面**（本仓对假绿的态度：宁可少报一行）。
            ? `<em>上次投递：记忆已投 · ${escapeHtml(String(memPush.tick || '?'))} · 大事 ${Number(memPush.counts?.['世界大事'] ?? 0)} 条</em>`
            : `<em style="color:#e0a0a0">上次投递失败：${escapeHtml(String(memPush.reason || '未知原因'))}</em>`;
    };
    const switches = Object.entries(SWITCH_PARAMS).map(([key, conf]) => {
        const on = switchOn(world, key);
        return `<div class="sw2-set-card sw2-actions-inline" data-param="${escapeHtml(key)}">`
            + `<h4 style="flex:1;margin:0">${escapeHtml(conf.label)}</h4>`
            + `<b class="sw2-param-val">${on ? '开' : '关'}</b>`
            + `<span class="sw2-actions">`
            + `<button class="sw2-btn${on ? ' sw2-primary' : ''}" data-action="set-param" data-param="${escapeHtml(key)}" data-value="1">开</button>`
            + `<button class="sw2-btn${on ? '' : ' sw2-primary'}" data-action="set-param" data-param="${escapeHtml(key)}" data-value="0">关</button>`
            + `</span>${pushLine(key)}</div>`;
    }).join('');

    // ★leg32：世界尺度 · 引擎尺度三道上限（**只读**）
    //   为什么摆在这页（用户令「能不能把这些数塞进参数页签」）：这一页本来就是"世界的参数"，
    //     而世界能同时跑多宽**是引擎的设定、不是世界的处境**。
    //   为什么**不给旋钮**（三条硬约束，一条都没破）：
    //     ①`PARAM_KEYS` 的白名单只认**档位词**，这三个是裸整数 ⇒ 进不了 `dynamic.env`；
    //     ②`dynamic.env` 是"这个世界现在什么天时"的描述层，而它们是"这个世界尺度多大"的引擎参数；
    //     ③`params.js:13` 明写"引擎**不读**这些档位做任何判断"——而这三个数**恰恰就是引擎判据**
    //       ⇒ 做成可拧的旋钮＝让面板声称能改它，那正是 leg26 要治的病。
    //   呈现口径：如实报引擎现在的数（与 `AGENDA_CAPS` 同一真源，改到哪跟到哪），并说清它们的单位是人话。
    const capCard = `<div class="sw2-set-card sw2-cap-card" style="grid-column:1/-1">`
        + `<h4>世界尺度 · 引擎尺度</h4>`
        + `<div class="sw2-hint" style="margin-bottom:8px">这一栏<b>只报引擎现在的设定</b>，不给旋钮——它不属于你选的档位，而是引擎自己的尺度。</div>`
        + `<div class="sw2-row"><span>同时最多几件大计</span>`
        + `<b class="sw2-param-val">${AGENDA_CAPS.topLevel}</b>`
        + `<em>大计自己分出来的小事不占这个名额</em></div>`
        + `<div class="sw2-row"><span>总数上限</span>`
        + `<b class="sw2-param-val">${AGENDA_CAPS.open}</b>`
        + `<em>大计与小事加起来，同时在办的最多这么多</em></div>`
        + `<div class="sw2-row"><span>每轮新生上限</span>`
        + `<b class="sw2-param-val">${AGENDA_CAPS.perTick}</b>`
        + `<em>一轮里最多新起这么多件，其余顺延</em></div></div>`;

    return `<div class="sw2-sv-head"><div><div class="sw2-sv-title">世界参数 · 档位</div>`
        + `<div class="sw2-sv-sub">分两类：<b>自变量</b>（给定的条件，你定）与 <b>因变量</b>（结果，只读）。引擎只照抄，<b>不读</b>它们做任何判断。</div></div>`
        + `<div class="sw2-sv-cards"><span class="sw2-sv-chip ${setCount ? 'ok' : 'stale'}">${setCount}/${rows.length} 已定</span></div></div>`
        + `<div class="sw2-sv-grid">`
        + indep.map(knob).join('')
        + `<div class="sw2-set-card" style="grid-column:1/-1"><h4>因变量（结果 · 只读）</h4>`
        + `<div class="sw2-hint" style="margin-bottom:8px">这些是<b>被别的量决定的东西</b>，不是旋钮——拧它等于假装"拧一下结果就变了"。引擎既没有那个函数、也没有那个资格（它不发明事实）。</div>`
        + dep.map(readout).join('')
        + `</div>`
        + switches
        + capCard
        + `</div>`
        + `<div class="sw2-sv-sub" style="margin-top:10px">口径：<b>能拧的只有自变量</b>（给定的条件：天时、外压），引擎照抄原话；<b>因变量（民生、乱象）只呈现</b>——书里写了就照书里的词显示，没写就空着，<b>绝不由引擎算一个数出来冒充它</b>。</div>`;
}

export function renderInfoBandHtml(world) {
    const dyn = world.context?.setting?.dynamic;
    const env = paramsOf(world);
    const pre = !world.meta || world.meta.tick === 0;   // leg21：未演化态诚实标注（基线值非事实值）
    const baselineHint = pre ? ' <span class="sw2-baseline-hint">基线值 · 首轮后随世界演化</span>' : '';
    // leg26：参数四键 = 玩家/书定的**档位原话**；没定的显示「未定」（不填占位值）
    const envRows = PARAM_KEYS.map((k) => envRowHtml(k, env[k]));
    const t = dyn?.tension || {};
    const tides = (dyn?.derivedFrom || []).slice(-3).reverse().map((x) => tideLabel(world, x));
    const counts = {
        active: (world.agendas || []).filter((a) => !a.closed).length,
        hidden: (world.agendas || []).filter((a) => !a.closed && a.visibility === 'concealed').length,
        top: (world.agendas || []).filter((a) => !a.closed && !a.parentId).length,
    };
    // K46（细案 C4）+ leg21（用户指认）：大势行 = 真·天下大势一句（世情句领；无世情=未聚——张力不再混入）；
    // 张力行 = 结构性张力三件套独立成行（极/方向/强度带词全部归此行）
    // leg25 b（A1b）：原为「低/中/高烈度 + 百分比」。实测 rival 腿恒为满值 ⇒ 那个 % 实际只反映**事件密度**，
    //   而「烈度」这个词在暗示"引擎判断了天下张力"——它没做到。改为直说可验证的事实：近 10 轮事件几件。
    //   强度数字仍在（setting 页摆原值，且照旧喂模型），只是不再用带词包装它。
    const recentEvents = recentEventCount(world);
    const sit = world.context?.setting?.frozen?.canon?.situation;   // leg20：世情句领大势行（原文措辞）
    const trend = [
        sit ? `${escapeHtml(sit)}。` : '大势未聚（无主张力）。',
        tides.length ? `浪尖：${escapeHtml(tides.slice(0, 2).join('、'))}` : '',
    ].join('');
    return `<div class="sw2-infoband">`
        + `<div class="sw2-band-block"><div class="sw2-band-label">世情 · 四键${baselineHint}</div><div class="sw2-env">${envRows.join('')}</div></div>`
        + `<div class="sw2-band-block"><div class="sw2-band-label">大势</div><div class="sw2-trend">${trend}</div></div>`
        + `<div class="sw2-band-block"><div class="sw2-band-label">张力 · 结构性三件套</div>`
        + `<div class="sw2-clash-main">${escapeHtml(t.polarity || '未聚')}<small class="sw2-quiet-note">近${TENSION_WINDOW}轮事件 ${recentEvents} 件</small></div>`
        + `<div class="sw2-clash-sub">${escapeHtml(t.direction ? t.direction + '（原文方向）' : '僵持（无明确方向）')}</div></div>`
        + `<div class="sw2-band-block"><div class="sw2-band-label">浪尖 · 刚收尾的大动作</div><div class="sw2-tides">${tides.map((x) => `<div class="sw2-tide">${x}</div>`).join('')}</div></div>`
        + `<div class="sw2-band-block"><div class="sw2-band-label">盘算</div>`
        // ★leg32：两个分母一律读引擎真源（旧版写死 `/15` `/5` ⇒ 引擎改了面板不变，见文件头 import 注释）
        + `<div class="sw2-big-num">${counts.active}<small>/${AGENDA_CAPS.open}</small></div>`
        + `<div class="sw2-num-sub">${counts.hidden ? `${counts.hidden} 件在暗处 · ` : ''}顶层 ${counts.top}/${AGENDA_CAPS.topLevel}</div></div>`
        + `</div>`;
}

export function renderAgendaStripHtml(world) {
    const active = (world.agendas || []).filter((a) => !a.closed);
    const cards = active.map((a) => `<div class="sw2-agenda-card${a.visibility === 'concealed' ? ' sw2-agenda-hidden' : ''}">`
        + `<div class="sw2-ahead"><span class="sw2-aowner">${escapeHtml(entityLabel(world, a.owner))}</span>`
        + `<span class="sw2-visible ${a.visibility === 'concealed' ? 'v-hidden' : 'v-known'}">${LABELS.visibility[a.visibility] || '明'}</span></div>`
        + `<div class="sw2-agoal">${escapeHtml(a.goal)}</div>`
        + `<div class="sw2-astage">${escapeHtml(a.stage || '谋划中')}`
        + `<span class="sw2-aprog">${dotSteps(a.progress ?? 0, a.maxSteps)}</span>`
        + `<span class="sw2-asteps">${a.progress ?? 0}/${a.maxSteps ?? 0}</span></div></div>`);
    if (!cards.length) {
        cards.push('<div class="sw2-agenda-empty">眼下没有在办的谋划。</div>');
    }
    return `<div class="sw2-agenda-strip"><div class="sw2-col-head">各方盘算 · 总览</div><div class="sw2-agenda-cards">${cards.join('')}</div></div>`;
}

export function renderFeedHtml(world, { limit = 8 } = {}) {
    const chronicle = world.chronicle || [];
    // K38（敲定稿 I 条）：拒签可见——最近一轮的裁定/校验拒绝在动态流顶部露头（世界的重力，应当众；
    // 双面无痕的静默滤除仍不可见；钳制行保留显示但不占拒签计数——口径见 settle rejected 计算）
    const last = (world.meta?.simLog || []).slice(-1)[0];
    const verdicts = (last?.warnings || []).filter((w) => (
        w.startsWith('裁定:') || w.startsWith('校验拒绝:')
    ));
    const verdictBlock = verdicts.length
        ? `<div class="sw2-verdict"><span class="sw2-verdict-tag">⚖ 本轮裁定 ${verdicts.length} 条</span>${escapeHtml(verdicts[0])}</div>`
        : '';
    const rows = chronicle.slice(-limit).reverse().map((c, i) => {
        const latest = i === 0 && c.tick === world.meta?.tick;
        return `<div class="sw2-entry${latest ? ' sw2-latest' : ''}">${latest ? '<span class="sw2-now">最新</span>' : ''}`
            + `<div class="sw2-ctext">${escapeHtml(c.text)}</div>`
            + `<div class="sw2-cmeta"><span class="sw2-round">${fmtTick(c.tick)}</span>`
            + (c.eventRef ? `<span class="sw2-ref" title="${escapeHtml(c.eventRef)}">？</span>` : '')
            + `</div></div>`;
    });
    let note = '';
    const ms = world.milestones || [];
    if (ms.length) {
        const last = ms.reduce((a, b) => (msIdTick(b.id) > msIdTick(a.id) ? b : a));
        const titles = Array.isArray(last.titles) ? last.titles : (last.title ? [last.title] : []);
        note = `<div class="sw2-milestone-strip">⚑ 更早的 <b>第 1–${msIdTick(last.id)} 轮</b>已收进大事纪「${escapeHtml(titles.slice(0, 3).join('、'))}」<span class="sw2-goto" data-view="archive">去翻旧账 →</span></div>`;
    }
    return `<div class="sw2-col-head">动态流 · 最新在上</div>${verdictBlock}<div class="sw2-feed">${rows.join('')}${note}</div>`;
}

export function renderSideHtml(world) {
    const playerId = world.context?.playerId;
    const ef = world.meta?.entityFields || {};
    const active = (world.entities || []).filter((e) => !e.status || e.status === 'active');
    const real = (v) => typeof v === 'string' && v.trim() && v !== '未明';
    const sorted = [...active].sort((a, b) => String(a.name).localeCompare(String(b.name)));

    // ★leg25 f 版式重做（用户拍板「位置就先这样定了」）：
    //   旧版把**每个实体渲染成一张卡**（真账实测 563 张 / HTML 231 KB），位置只是卡片右上角一个词—— 
    //   于是"谁跟谁在一处"这个世界里唯一的空间结构**根本看不出来**，位置形同装饰。
    //   新版改为**按处聚合**（位置当分组键用起来），并且**两筐都摆**：
    //     ①有处可循：按地点分组（组头写"几处 / 几人"，组内按名号序列出）
    //     ②位置未载：单列一筐（如实说"书里没写"，并区分"知道归属但不知驻地"与"孤儿"）
    //   纪律（用户 2026-09-11 定的交互口径，别改回聚合式筛选）：**未载 ≠ 在别处**，
    //   分筐只是呈现，"能否相遇"归模型（引擎对两个实体能否交互零表态）。所以未载永远单列存在，不被挤掉。
    const byLoc = new Map();
    const unknown = [];
    for (const e of sorted) {
        if (!real(e.location)) { unknown.push(e); continue; }
        if (!byLoc.has(e.location)) byLoc.set(e.location, []);
        byLoc.get(e.location).push(e);
    }
    const derivedAt = (loc) => byLoc.get(loc).every((e) => ef[e.id]?.位置来源 === '结构推导');
    const chip = (e, worldRef) => {
        const nm = escapeHtml(e.name);
        const kind = e.kind === 'faction' ? '<small>势力</small>' : '';
        const agenda = (worldRef.agendas || []).some((a) => !a.closed && a.owner === e.id);
        return `<span class="sw2-locchip${e.id === playerId ? ' sw2-locchip-me' : ''}${agenda ? ' sw2-locchip-busy' : ''}"`
            + ` title="${escapeHtml(e.name)}${agenda ? '：手上正有在办的盘算' : ''}">${nm}${kind}</span>`;
    };
    const locGroups = [...byLoc.entries()]
        .sort((a, b) => b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0])))
        .map(([loc, list]) => `<div class="sw2-locgroup">`
            + `<div class="sw2-locgroup-head"><span class="sw2-locgroup-name">${escapeHtml(loc)}</span>`
            + `<span class="sw2-locgroup-n">${list.length} 人</span>`
            + (derivedAt(loc) ? '<small class="sw2-quiet-note" title="这个地点是引擎从组织条目的驻地结构推出来的（成员推定在所属组织驻地），**不是书里对这个名号自己的明述**">（推）</small>' : '')
            + `</div>`
            + `<div class="sw2-locchips">${list.map((e) => chip(e, world)).join('')}</div>`
            + `</div>`);
    const unknownHtml = unknown.length
        ? `<div class="sw2-locgroup sw2-locgroup-unknown">`
            + `<div class="sw2-locgroup-head"><span class="sw2-locgroup-name">位置未载</span>`
            + `<span class="sw2-locgroup-n">${unknown.length} 人</span></div>`
            + `<div class="sw2-locgroup-note">书里没写他们在何处——**不是"在别处"，是不知道**。`
            + `其中 ${unknown.filter((e) => e.parent).length} 人知道归属（只是其组织条目没写驻地）、`
            + `${unknown.filter((e) => !e.parent).length} 人无归属。他们照常在世界里活动，不被位置筛掉。</div>`
            + `<div class="sw2-locchips">${unknown.map((e) => chip(e, world)).join('')}</div>`
            + `</div>`
        : '';

    // ★leg25 g（用户 2026-09-11 实机复验后拍板：「有是有但是太拥挤了，收缩到一个入口内，就叫地图吧，
    //   这就是个暂时的展示功能」）：
    //   上一棒把 563 张卡压成 21 组（-84%）方向是对的，但**整片铺在侧栏里**仍然占满视线——
    //   21 组 + 390 人的未载筐一展开，动态流被挤到下面看不见。现在收成**一个入口**：默认收起，
    //   开口只报一行摘要（几处 / 几人 / 未载几人），要看得自己点开。
    //   形态选**原生 `<details>`**（不新增 JS、不新增状态）：本仓已有两处同款先例
    //   （`.sw2-milestone` / `.sw2-source-alt`），样式按它们写，不为这一次改版发明新组件。
    //   ★纪律（别改坏）：**内容照旧全在 DOM 里**——折叠≠删除。理由有两条：
    //     ① `未载 ≠ 在别处` 这条口径靠那段说明文案承载（"书里没写"），删了就把口径删了；
    //     ② 现有回归锁断言的是内容与 class（`sw2-locgroup-name">江州` / `位置未载…书里没写`），
    //        真删了内容会当场红——那正是"别把呈现改版做成功能删减"的防线。
    //   措辞纪律（用户原话）：入口就**叫「地图」**，别叫"各归何处速览"之类；这是**暂时的展示功能**。
    const known = active.length - unknown.length;
    const mapDetails = `<details class="sw2-map-details">`
        + `<summary class="sw2-map-summary"><span class="sw2-map-title">地图</span>`
        + `<span class="sw2-map-brief">${byLoc.size} 处 · ${known} 人有处可循`
        + (unknown.length ? ` · 未载 ${unknown.length} 人` : '')
        + `</span></summary>`
        + `<div class="sw2-map-note" title="位置只是把账上已有的空间结构摆出来。引擎不据此筛选谁、也不判断两人能否相遇（那是笔的事）">`
        + `各归何处（${byLoc.size} 处 / ${known} 人有处可循）——按处聚合，仅供查看；`
        + `位置不参与筛选，「未载」也不代表在别处。</div>`
        + `<div class="sw2-side">${locGroups.join('')}${unknownHtml}</div>`
        + `</details>`;
    return mapDetails;
}

export function renderBoardHtml(world, opts = {}) {
    return {
        digest: renderDigestHtml(world),
        infoband: renderInfoBandHtml(world),
        agendaStrip: renderAgendaStripHtml(world),
        feed: renderFeedHtml(world, opts),
        side: renderSideHtml(world),
    };
}

// ============ 编年页 ============

export function renderChronicleHtml(world, { oldVolumes = [], filter = null } = {}) {
    // K41 五筛（A-16②）：行选择 = 无 kind 旧账恒显示（不藏）∪ kind ∈ filter；filter=null 全选
    // 闭环/涟漪平息行链目标（第十五棒）：chainRef 优先（新行盖章）→ eventRef（事件行）→
    // 否则按行 id 解析历史闭环行（ch_<tick>_evc[2]_<evId>——行 id 内嵌事件 id；与 msIdTick 同款
    // id 解析纪律：引擎 id 只进 data/title 悬停 A-3 豁免；旧账不篡改=渲染只读派生，不写回账本）
    const chainTarget = (c) => c.chainRef || c.eventRef || (/^ch_\d+_evc2?_(ev_.+)$/.exec(String(c.id || '')) || [])[1] || '';
    const rows = (world.chronicle || []).map((c) => {
        if (filter != null && c.kind && !filter.has(c.kind)) return '';
        const target = chainTarget(c);
        return `<div class="sw2-ch-line${target ? ' sw2-ch-event' : ''}">`
            + `<span class="sw2-ch-round">${c.tick}</span>`
            + `<span class="sw2-ch-text">${escapeHtml(c.text)}</span>`
            + (target ? `<button class="sw2-chainbtn" data-action="open-chain" data-chain="${escapeHtml(target)}" title="${escapeHtml(target)}">链</button>` : '')
            + `</div>`;
    }).filter(Boolean);
    const legacyCount = (world.chronicle || []).filter((c) => !c.kind).length;
    const chip = (token, label, on) => `<span class="sw2-fchip${on ? ' on' : ''}" data-action="set-filter" data-filter="${token}">${label}</span>`;
    const chips = [chip('all', '全部', filter == null)]
        .concat(CHRONICLE_FILTERS.map((f) => chip(f.token, f.label, filter != null && filter.has(f.token))))
        .join('');
    const legacyNote = filter != null && legacyCount > 0
        ? `<em class="sw2-legacy-note">另有 ${legacyCount} 条旧账未分类，任何筛选下始终显示</em>` : '';
    const notes = (world.milestones || []).map((m) => {
        const titles = Array.isArray(m.titles) ? m.titles : (m.title ? [m.title] : []);
        return `<div class="sw2-ch-roll">⚑ 第 1–${msIdTick(m.id)} 轮已收进大事纪「${escapeHtml(titles.join('、'))}」</div>`;
    });
    const volumes = oldVolumes.map((v) => `<div class="sw2-cold-row"><span class="sw2-vol">${escapeHtml(v.id)}</span>`
        + `<span class="sw2-volinfo">${escapeHtml(v.info)}</span><span class="sw2-volact" data-action="read-volume" data-vol="${escapeHtml(v.id)}">阅卷</span></div>`);
    const volBlock = volumes.length
        ? `<div class="sw2-cold"><h4>旧卷（早于大事纪的编年原文 · 按需阅卷）</h4>${volumes.join('')}</div>` : '';
    return `<div class="sw2-col-head">编年 · 史卷</div>`
        + `<div class="sw2-ch-filter">${chips}${legacyNote}</div>`
        + `<div class="sw2-chronicle">${rows.join('')}${notes.join('')}</div>${volBlock}`;
}

// ============ 大事纪·旧卷页 ============

export function renderArchiveHtml(world, { oldVolumes = [] } = {}) {
    const msCards = (world.milestones || []).map((m) => {
        const titles = Array.isArray(m.titles) ? m.titles : (m.title ? [m.title] : []);
        const ids = Array.isArray(m.ids) ? m.ids : [];
        return `<div class="sw2-milestone"><div class="sw2-milestone-head">`
            + `<span class="sw2-milestone-id">${escapeHtml(m.id)}</span>`
            + `<span class="sw2-mspan">第 1–${msIdTick(m.id)} 轮 · ${m.counts ?? 0} 件事</span></div>`
            + `<h5>${escapeHtml(titles.slice(0, 4).join('、'))}</h5>`
            + (ids.length
                ? `<details><summary>展开这一纪的条目</summary><div class="sw2-rawids">${ids.map((id) => `<span class="sw2-rawid">${escapeHtml(id)}<button class="sw2-chainbtn" data-action="open-chain" data-chain="${escapeHtml(id)}" title="${escapeHtml(id)}">链</button></span>`).join(' · ')}</div></details>` : '')
            + `</div>`;
    });
    const volRows = oldVolumes.map((v) => `<div class="sw2-cold-row"><span class="sw2-vol">${escapeHtml(v.id)}</span>`
        + `<span class="sw2-volinfo">${escapeHtml(v.info)}</span><span class="sw2-volact" data-action="read-volume" data-vol="${escapeHtml(v.id)}">阅卷</span></div>`);
    return `<div class="sw2-arch-grid">${msCards.join('')}</div>`
        + `<div class="sw2-cold"><h4>旧卷（早于大事纪的编年原文 · 按需阅卷）</h4>${volRows.join('') || '<div class="sw2-cold-row" style="color:var(--sw2-text-faint)">尚未入卷——编年仍在热账。</div>'}</div>`;
}

// ============ 角色与势力页 ============

// 行内查书按钮（leg25 d）：有已定案的栏 → 同时给「重查」；否则只给「查」。
//   口径：查 = forceFields null（只补没定案的）；重查 = forceFields 'absent'（连「书未明述」推倒重来）。
function lookupButtons(e, lookupState) {
    const settled = ['实力', '位置'].some((f) => ['ok', 'absent'].includes(lookupState(f)));
    const ask = `<button class="sw2-chainbtn" data-action="lookup-entity" data-entity="${escapeHtml(e.id)}" title="只补还没定案的栏（已查到的原话不动）">查</button>`;
    const again = settled
        ? `<button class="sw2-chainbtn" data-action="lookup-entity" data-entity="${escapeHtml(e.id)}" data-force="absent" title="连「书未明述」也推倒重查——旧版取书 bug 误标的假「书未明述」靠这个清掉">重查</button>`
        : '';
    return `${ask}${again}`;
}

export function renderEntitiesHtml(world, { config = null } = {}) {
    // K46：镜头名单（pack 引擎层同口径）+ 麾下成员派生——全册展示、镜头徽、分支/隶属
    const lens = new Set(lensList(world).map((x) => x.e.id));
    // leg24 片1（停抄书）：行内「补抽」与头部「补抽未抽属性/隶属」两枚按钮下掉——
    // 它们是"按需从书里抄属性/隶属"的入口（leg21/K49），而这条流水线已整条删除。
    // 名册权威只用于身份（名字+类别）与照书办的结构声明，不再作为按钮候选口径。
    // leg24 片5（界面）：①**撤掉分量条**——那个 0-1 的数引擎已不再消费（用户拍板删），显示它等于把
    //   废数当客观给玩家看（旧法：条 + 数字）；②改成「据/无据」标记——账上真有的才算有据（设计硬规矩一）；
    //   ③属性**只有模型提议过才显示**（空着就是空着，不摆一排 0.5 冒充数据）。
    // leg25 c（用户令「删」）：四维属性 chip（含第十三棒的双通道无障碍写法）**整段删除**——
    //   那些数不存在了，面板上再也没有可渲染的属性列。同一行位置改由查书标记（实力/位置）承担，
    //   书里的说法照抄成文本显示（不再是 0–1 的数）。
    const rows = (world.entities || []).map((e) => {
        const agenda = (world.agendas || []).find((a) => !a.closed && a.owner === e.id);
        const status = e.status && e.status !== 'active' ? `<span class="sw2-visible ${e.status === 'dead' ? 'v-hidden' : 'v-known'}">${LABELS.status[e.status]}</span>` : '';
        const lensBadge = lens.has(e.id) && (!e.status || e.status === 'active') ? '<span class="sw2-visible v-known">在场</span>' : '';
        // leg23：势力挂到统治者/上级时用「上级」措辞（角色仍是「隶属」）；名下机构/部门单列一行
        // leg25 e：**来源外显**——结构推导来的归属（不是书里对这个名号自己的明述）标「（推）」，
        //   与位置继承同款纪律（用户质疑过"推错会不会帮倒忙"）：标了来源，模型与人都不会当明述用。
        // leg25 f：归属/规模/分支/机构/麾下**改由结构化区块渲染**（下面 rel/crew 几行），
        //   旧的 `affil/scaleHtml/branch/organ` 四个段落串已删——它们就是"糊成一团"的来源。
        const parentDerived = e.parentSource === '结构推导';
        // 势力麾下（leg23 membersOf 反查）：成员名单 + 成员各自账上的「实力」原话。
        //   细案（用户拍板）：**势力不写实力字段**——势力的实力由麾下成员派生显示
        //   （没有成员档位就整条不显示，绝不替它算个总档）。
        const crew = e.kind === 'faction' ? membersOf(world, e) : null;
        const crewPower = crew
            ? crew.map((n) => {
                const m = (world.entities || []).find((x) => x.name === n);
                return typeof m?.['实力'] === 'string' && m['实力'].trim() ? `${n}（${m['实力']}）` : null;
            }).filter(Boolean)
            : [];
        // leg25 c：`dims`（账上有几维数值）**删除**——四维不存在，"有据 n/4"无从谈起。
        //   这一行原来是"据/无据"徽章的来源；现在只剩位置/归属/在办这些**结构性事实**。
        // 细案 spec-entity-field-lookup（用户 2026-09-11）：按需查书补的字段显示**查书标记**——
        //   ①有值=原文原话（角色才有实力）②**未查**=还没轮到查它（新世界的常态，**必须显示**，
        //   否则整栏空白，用户会以为"看不到属性"就是这个插件的全部）③未加载到=查过但模型没给
        //   （可能只是漏抽，下轮再补）④书未明述=引擎确认书里没有相关条目。
        //   ★第二十五棒修正（用户实拍："根本看不到属性"）：旧版只做了 ③④ 两态标签，**②直接空白** = bug。
        const rec = world.meta?.entityFields?.[e.id];
        const lookupState = (f) => rec?.attempts?.[f]?.state ?? 'none';
        // 查书标记 chip（不占整列——见下「未载」口径修正）
        // leg25 f：标签**一律保留**（旧版位置那种调用传空 label，title 就变成「：还没轮到查它…」——
        //   悬停文案缺主语；现在标签在位，读起来是「位置：还没轮到查它…」）。
        const lookupChip = (f, label = f) => {
            const st = lookupState(f);
            if (st === 'pending') return `<span class="sw2-eattr nodata">${label}<b>未加载到</b></span>`;
            if (st === 'absent') return `<span class="sw2-eattr nodata">${label}<b>书未明述</b></span>`;
            // leg25 d 修（子代理报回、实测确认）：title 属性里原先写了裸双引号（`"未加载到"`），
            //   属性值被就地截断 → 悬停只显示前半句（且残余文字漏成游离文本）。改用「」，
            //   escapeHtml 不转义半角引号，凡是进属性的文案都不许带裸 `"`。
            if (st === 'none') return `<span class="sw2-eattr nodata" title="${escapeHtml(label)}：还没轮到查它（轮到时会按需去世界书取原话；查过之后这里会写「未加载到」或「书未明述」）"><b>未查</b></span>`;
            return '';
        };
        const orig = rec?.位置来源 === '结构推导' ? '（推）' : '';
        const derivedTip = '这条是引擎从组织条目的结构推出来的（书里没在这个名号自己身上明述），不是模型创作';
        // 位置的查书标记（欠载 / 未加载到 / 书未明述）——**查书标记归关系区的位置行**，
        //   位置列只留一个短语（见下）。这样"在哪"与"这一栏定案没有"各说各的，不打架也不重复。
        /* eslint-disable no-nested-ternary */
        const locStateText = lookupState('位置') === 'absent' ? '书未明述'
            : (lookupState('位置') === 'pending' ? '未加载到' : '未载');
        /* eslint-enable no-nested-ternary */
        // ---------- 位置列（**一栏一义**：这里只说"在哪"）----------
        // leg25 f 口径修正（用户实拍截图的直接观感问题）：旧版把没有位置渲染成裸字「未载」，
        //   而它独占一个 74px 整列、与名号同一基线 ⇒ **最没信息的那个词占了最显眼的位置**。
        //   现改为虚线小 chip（与「未查/未加载到」同一套空态语言），"没查到"的缘故收回 title。
        const locHtml = (e.location && e.location !== '未明')
            ? `<span class="sw2-locval">${escapeHtml(e.location)}</span>${orig ? `<span class="sw2-quiet-note" title="${escapeHtml(derivedTip)}">（推）</span>` : ''}`
            : `<span class="sw2-eattr nodata" title="${
                lookupState('位置') === 'absent' ? '查过世界书，书里确实没写它的所在'
                    : (lookupState('位置') === 'pending' ? '查过世界书，但这轮模型没抽出所在（下轮再补，不代表书里没有）'
                        : '还没轮到查它；零 token 的组织驻地结构推断会在打开面板时先跑一轮')
            }">${locStateText}</span>`;

        // ---------- 关系与属性（竖排若干行，每行一义）----------
        // 旧版把规模/上级/分支/机构/麾下/麾下实力**全部挤进一个 div 里连成一长段**——
        //   用户截图里"规模：… 麾下：… 麾下实力：…"糊成一团的可读性问题就出在这。
        const rel = [];
        if (e.kind === 'character' && typeof e['实力'] === 'string' && e['实力'].trim()) {
            rel.push(`<span class="sw2-relrow" title="实力：书里明述的原话（角色字段；势力不写实力）"><span class="sw2-visually-hidden">实力：书里明述的原话。</span><i aria-hidden="true">实力</i><span class="sw2-relval">${escapeHtml(e['实力'])}</span></span>`);
        } else if (e.kind === 'character') {
            rel.push(`<span class="sw2-relrow">${lookupChip('实力')}</span>`);
        }
        // 位置行只对**角色**摆（势力行不摆实力/位置两栏——避免把"势力的实力"又摆回来，用户拍板）。
        //   有真位置时它是值（与位置列同一事实，可接受；这一栏读起来是"位置：X"），
        //   没有时它承担**三态查书标记**（未载/未加载到/书未明述），把位置列那一格省下来的解释放这。
        if (e.kind === 'character') {
            rel.push(`<span class="sw2-relrow">${(e.location && e.location !== '未明')
                ? `<i>位置</i><span class="sw2-relval">${escapeHtml(e.location)}</span>${orig ? `<span class="sw2-quiet-note" title="${escapeHtml(derivedTip)}">（推）</span>` : ''}`
                : lookupChip('位置')}</span>`);
        }
        if (e.parent) {
            rel.push(`<span class="sw2-relrow"${parentDerived ? ` title="${escapeHtml(derivedTip)}"` : ''}><i>${e.kind === 'faction' ? '上级' : '隶属'}</i><span class="sw2-relval">${escapeHtml(e.parent)}</span>${parentDerived ? '<span class="sw2-quiet-note">（推）</span>' : ''}</span>`);
        }
        if (e.kind === 'faction' && typeof e['规模'] === 'string' && e['规模'].trim()) {
            rel.push(`<span class="sw2-relrow"><i>规模</i><span class="sw2-relval">${escapeHtml(e['规模'])}</span></span>`);
        }
        if (e.kind === 'faction' && e.branches?.length) {
            rel.push(`<span class="sw2-relrow"><i>分支</i><span class="sw2-relval">${escapeHtml(e.branches.join('、'))}</span></span>`);
        }
        if (e.organs?.length) {
            rel.push(`<span class="sw2-relrow"><i>机构</i><span class="sw2-relval">${escapeHtml(e.organs.join('、'))}</span></span>`);
        }
        const crewHtml = crew ? `<div class="sw2-crew"><i>麾下</i>${escapeHtml(crew.join('、'))}</div>` : '';
        const crewPowerHtml = crewPower.length ? `<div class="sw2-crew sw2-crew-pow"><i>麾下实力</i>${escapeHtml(crewPower.join('、'))}</div>` : '';
        const relHtml = rel.length ? `<div class="sw2-relations">${rel.join('')}</div>` : '';

        // ---------- 在办盘算（唯一的主句块）----------
        const agendaHtml = agenda
            ? `<div class="sw2-agline"><span class="sw2-aggoal">${escapeHtml(agenda.goal)}</span>`
                + (agenda.visibility === 'concealed' ? '<span class="sw2-visible v-hidden">暗</span>' : '')
                + `<div class="sw2-agstage">${escapeHtml(agenda.stage || '谋划中')} · ${agenda.progress ?? 0}/${agenda.maxSteps ?? 0}</div></div>`
            : `<div class="sw2-aidle">${e.id === world.context?.playerId ? '你的每一步从对话里来。' : '眼下没有在办的盘算。'}</div>`;

        // 归属空着：**只在这个实体确实该有归属却查不到时**说，且收敛成小字（旧版是个虚线徽章，
        //   与「在办」抢同一格的注意力——用户截图里它反而比真内容显眼）。
        const showOrphan = !e.parent && !(e.organs?.length) && !(e.branches?.length) && !crew?.length;
        return `<div class="sw2-entity-row${e.id === world.context?.playerId ? ' sw2-player' : ''}">`
            + `<div class="sw2-cell sw2-c-name"><div class="sw2-ename">${escapeHtml(e.name)}<small>${kindLabel(e, world)}${status}${lensBadge}</small></div></div>`
            + `<div class="sw2-cell sw2-c-loc" title="驻点（位置集的受控词表；不在集内的原话只留档，不写进账）">${locHtml}</div>`
            + `<div class="sw2-cell sw2-c-rel">${relHtml}${crewHtml}${crewPowerHtml}${showOrphan ? '<div class="sw2-orphan">归属空着（书里没明述、也没结构依据）</div>' : ''}</div>`
            + `<div class="sw2-cell sw2-c-agenda">${agendaHtml}</div>`
            + `<div class="sw2-cell sw2-c-active"><span class="sw2-quiet-note">最近活跃</span><br>${typeof e.lastActiveTick === 'number' ? fmtTick(e.lastActiveTick) : '—'}</div>`
            // leg25 d：行内两个入口（细案 §6）。**未查过**只需「查」（补缺）；**已定案**（含被旧 bug
            //   误标的「书未明述」）给「重查」——它走 force 覆盖，否则 absent 是永久闸、永远查不动。
            + `<div class="sw2-cell sw2-c-act">${lookupButtons(e, lookupState)}</div>`
            + `</div>`;
    });
    const allEnts = world.entities || [];
    const quiet = allEnts.filter((e) => e.status && e.status !== 'active').length;   // 退休/已灭（镜外另计）
    // leg25 c：原「其中 N 位账面无数」随四维一起删除——没有数值维度了，"账面无数"这个说法失去所指。
    // leg25 d（细案 spec-lookup-batch-refresh §6）：批量补全入口 + 进度（进度由 config 注入，
    //   渲染层不持任务状态——面板零第二份状态纪律）。
    const task = config?.lookupTask || null;
    const batchBtn = task
        ? `<button class="sw2-btn" data-action="lookup-batch-all" title="再点一次可停；已查到的都留账">■ 停止补全 ${task.cursor}/${task.total}</button>`
        : `<button class="sw2-btn" data-action="lookup-batch-all" title="把全册在册角色的实力按需查一遍（借世界推进分批跑，不阻塞推进；再点一次可停）。位置不在这里查——它由零 token 的组织驻地结构推断供给，打开面板时自动补">⬇ 补全全册实力</button>`;
    const batchHint = task
        ? `<span class="sw2-hint">补全中 ${task.cursor}/${task.total}（成功 ${task.success} · 未加载到 ${task.pending} · 书未明述 ${task.absent} · 失败 ${task.failed}）——随世界推进分批跑</span>`
        : '';
    return `<div class="sw2-list-head">全部角色与势力（全册 ${allEnts.length} · 本轮镜头 ${lens.size}）${quiet ? ` <small class="sw2-quiet-note">另 ${quiet} 位退休/已灭</small>` : ''}<small class="sw2-quiet-note" title="面板构建号：改了代码但页面还是旧的时（浏览器缓存），拿这个对照">构建 ${PANEL_BUILD}</small></div>`
        + `<div class="sw2-list-tools" style="margin:6px 0 8px">${batchBtn}${batchHint}</div>`
        + `<div class="sw2-entity-list">${rows.join('')}</div>`
        + `<div class="sw2-hint">账上只记查到的与玩出来的东西：<b>有值</b>=书里原话；<b>未加载到</b>=查过书但这轮模型没抽出来（下轮再补，不代表书里没有）；<b>书未明述</b>=书里确实没写。每行的<b>查</b>=只补没定的栏，<b>重查</b>=连「书未明述」也推倒重查（旧版误标的假「书未明述」靠它清掉）。</div>`;
}

// ============ 设定档案页（A-6：展示与 setting.frozen 逐字段一致） ============

export function renderSettingHtml(world) {
    const dyn = world.context?.setting?.dynamic;
    const frozen = world.context?.setting?.frozen;
    const env = paramsOf(world);
    const t = dyn?.tension || {};
    if (!frozen) {
        return `<div class="sw2-sv-head"><div><div class="sw2-sv-title">世界设定</div>`
            + `<div class="sw2-sv-sub">尚未抽取——设定池未就绪。</div></div>`
            + `<div class="sw2-sv-cards"><span class="sw2-sv-chip stale">未抽取</span></div></div>`;
    }
    const envRows = PARAM_KEYS.map((k) => envRowHtml(k, env[k])).join('');
    const tides = (dyn?.derivedFrom || []).slice(-5).reverse().map((x) => tideLabel(world, x)).join('<br>');
    const canon = frozen.canon || {};
    const scaleRows = (canon.powerScale || []).map((p) => `<div class="sw2-sv-row"><b>${escapeHtml(p.level)}</b><span>${escapeHtml(p.note)}</span></div>`).join('');
    const ruleRows = (canon.rules || []).map((r) => `<div class="sw2-sv-row"><b>法则</b><span>${escapeHtml(r)}</span></div>`).join('');
    const histRows = (canon.historyNotes || []).map((h, i) => `<div class="sw2-sv-hist"><span class="sw2-hist-tick">第 ${i + 1} 条</span><span>${escapeHtml(h)}</span></div>`).join('');
    const envTitle = (dyn?.derivedFrom || []).length ? `浪尖（派生源）：${tides}` : '浪尖：暂无';

    return `<div class="sw2-sv-head"><div><div class="sw2-sv-title">世界设定 · ${escapeHtml(world.context?.world || '')}</div>`
        + `<div class="sw2-sv-sub">书指纹 ${escapeHtml(frozen.fingerprint)} · 抽取于 ${escapeHtml(frozen.extractedAt)} · 全部条目取自原文，未增写一句（只提取不创作）</div></div>`
        + `<div class="sw2-sv-cards"><span class="sw2-sv-chip ok">✓ 已冻结 · 设定未变不重抽</span></div></div>`
        + `<div class="sw2-sv-grid">`
        + `<div class="sw2-set-card" style="grid-column:1/-1"><h4>张力现状（演变层 · 引擎算 · 每轮随动）</h4>`
        + `<div class="sw2-clash-main">${escapeHtml(t.polarity || '未聚')} <span class="sw2-int">${fmtPct(t.intensity)}</span></div>`
        + `<div class="sw2-clash-sub">${escapeHtml(t.direction ? t.direction + '（原文方向）' : '僵持（无明确方向）')} · 近${TENSION_WINDOW}轮事件 ${recentEventCount(world)} 件</div>`
        + `<div style="margin-top:6px;font-size:12px;color:var(--sw2-text-faint)">上面这个数是引擎每轮重算的读数（惯性平滑，0–1）。<b>它目前主要由"近${TENSION_WINDOW}轮事件数"驱动</b>——公式里的"两强对峙度"一项实测恒为满值（势力四维普遍为空时会全体同值），所以它并不表示"引擎判断了天下张力"。</div>`
        + `<div class="sw2-env">${envRows}</div>`
        + `<div style="margin-top:8px;font-size:12px;color:var(--sw2-text-faint)">${envTitle}</div>`
        + `<div style="margin-top:10px"><button class="sw2-btn" data-action="clear-evolution">清除演化层（回基线）</button><span class="sw2-hint">只清张力强度/环境量/浪尖——设定与极性方向不动，不触发抽取调用。</span></div></div>`
        + `<div class="sw2-set-card"><h4>力量谱系（${(canon.powerScale || []).length} 档 · 取全）</h4>${scaleRows || '<div class="sw2-sv-row"><span>（无）</span></div>'}</div>`
        + `<div class="sw2-set-card"><h4>法则（${(canon.rules || []).length} 条）</h4>${ruleRows || '<div class="sw2-sv-row"><span>（无）</span></div>'}</div>`
        + `<div class="sw2-set-card"><h4>社会格局 · 力量体系</h4><p class="sw2-sv-para">${escapeHtml(canon.society || '（无）')}</p><p class="sw2-sv-para">${escapeHtml(canon.techOrMagic || '（无）')}</p></div>`
        + `<div class="sw2-set-card"><h4>史略（${(canon.historyNotes || []).length} 条）</h4>${histRows || '<div class="sw2-sv-hist"><span>（无）</span></div>'}</div>`
        + `</div>`;
}

// ============ 设置页 ============

export function renderSettingsHtml(world, { config = {}, oldVolumes = [] } = {}) {
    const cfg = config || {};
    const envText = JSON.stringify({ 民生度: 0.5, 动乱度: 0.5, 天时: 0.5, 张力推手: 0.5 });
    void envText;
    return `<div class="sw2-settings">`
        + `<div class="sw2-set-card"><h4>世界设定（书的来源）</h4>`
        + `<div class="sw2-source-line"><span class="sw2-source-tag">来源：角色卡 + 世界信息（自动合订）</span>`
        + `<span class="sw2-source-note">自动读取：卡四件套 + 世界信息/卡内置世界书（世界书全量摄入，大书分块多次抽取）；抽取只拿三样——设定五件套 · 世情句 · 名号与类别（书里的上级/所在/属性不抄，用到时现查）</span></div>`
        + `<div class="sw2-hint" style="margin-top:10px">设定全文（力量谱系/法则/社会格局/力量体系/史略 + 张力现状）在「设定」页阅览；书变了会自动重新识别（书指纹），不用手动重抽。</div></div>`
        + `<div class="sw2-set-card"><h4>你的开档描述</h4>`
        + `<div class="sw2-field"><label>写一段"你是谁"（自然语言 · ≤2000 字提案）</label>`
        + `<textarea id="sw2_player_desc" data-action="player-desc">${escapeHtml(cfg.playerDesc || '')}</textarea>`
        + `<div class="sw2-hint">世界从中摘你的底子（兵力/权位/人脉/耳目）；解析不出的维度就空着，由世界提议；你手填过的一律不动。</div></div></div>`
        + `<div class="sw2-set-card"><h4>模型通道</h4>`
        + `<div class="sw2-field"><label>服务地址</label><input class="sw2-input" id="sw2_base" value="${escapeHtml(cfg.baseUrl || '')}"></div>`
        + `<div class="sw2-field"><label>密钥</label><input class="sw2-input sw2-key-mask" id="sw2_key" value="${escapeHtml(cfg.apiKey ? '••••••••••••••••••••' : '')}"><div class="sw2-hint">本机读取 · 不落库 · 不打印</div></div>`
        + `<div class="sw2-field"><label>世界模型</label><input class="sw2-input" id="sw2_model" value="${escapeHtml(cfg.model || '')}"></div>` 
        + `<div class="sw2-field"><label>单轮演算上限（提案：120 秒 / 4096 字）</label><input class="sw2-input" id="sw2_limits" value="120s · 4096" readonly title="提案值展示 · 随 K38 报批联动后生效"><div class="sw2-hint">提案态：报批前不视为定案，此处仅展示。</div></div></div>`
        + `<div class="sw2-set-card"><h4>操作</h4><div class="sw2-actions">`
        + `<button class="sw2-btn sw2-primary" data-action="init-world">✨ 开始新世界</button>`
        + `<button class="sw2-btn" data-action="advance-world">▶ 手动推进一步</button></div>`
        + `<div class="sw2-hint" style="margin-top:10px">每轮对话后世界自动推进；此按钮是手动补推。<br>设定不用手动重抽：书变了（书指纹变化）自动重新识别，已定的设定不会自己飘。<br>演算失败时世界原样不动，状态条会报错，可重试。</div></div>`
        + `<div class="sw2-set-card" style="grid-column:1/-1"><h4>旧卷与存储</h4>`
        + `<div class="sw2-cold-mgmt"><div class="sw2-row"><span>编年体积 · 当前</span><b>${(world.chronicle || []).length ? `${(JSON.stringify(world.chronicle).length / 1024).toFixed(1)}KB` : '0KB'}</b><em>每 100 轮约 21.7KB（实测）</em></div>`
        + `<div class="sw2-row"><span>自动入卷阈值</span><b class="sw2-thr">${cfg.limitsTicks ?? '500'} 轮 或 ${cfg.limitsBytesMB ?? '5'}MB</b><em>提案态 · 随本阶段报批</em></div>`
        + `<div class="sw2-row"><span>入卷去处</span><b>插件本地 · 可导出可导入</b><em>割断的是旧账，不是来龙去脉</em></div>`
        + `${renderVolumeListHtml(oldVolumes)}<div class="sw2-actions" style="margin-top:8px">`
        + `<button class="sw2-btn" data-action="export-world">⬇ 导出整聊天</button>`
        + `<button class="sw2-btn" data-action="import-world">⬆ 导入恢复</button></div></div>`
        + `</div>`;
}

// K35：旧卷清单（设置页/旧卷页共用行渲染；阅卷=还原前置段回编年视图）
export function renderVolumeListHtml(oldVolumes = []) {
    if (!oldVolumes.length) return `<div class="sw2-row"><span>入卷清单</span><b>尚未入卷——编年仍在热账</b><em></em></div>`;
    const rows = oldVolumes.map((v) => `<div class="sw2-row"><span class="sw2-vol">${escapeHtml(v.id)}</span>`
        + `<b>${escapeHtml(v.info)}</b><em><span class="sw2-volact" data-action="read-volume" data-vol="${escapeHtml(v.id)}">阅卷</span></em></div>`).join('');
    return `<div class="sw2-row" style="display:block"><span>入卷清单</span>${rows}</div>`;
}

// K35：阅卷还原视图——卷段行（storage.volumeToChronicleRows 产物）→ 编年行 HTML（A-3：引擎 id 只进悬停）
export function renderVolumeReadHtml(volumeId, rows = []) {
    const line = (r) => `<div class="sw2-ch-line${r.eventRef ? ' sw2-ch-event' : ''}">`
        + `<span class="sw2-ch-round">${escapeHtml(r.tick)}</span>`
        + `<span class="sw2-ch-text">${escapeHtml(r.text)}</span>`
        + (r.eventRef ? `<span class="sw2-ref" title="${escapeHtml(r.eventRef)}">？</span>` : '')
        + `</div>`;
    const body = rows.length ? rows.map(line).join('') : '<div class="sw2-ch-line"><span class="sw2-ch-text">（空卷）</span></div>';
    return `<div class="sw2-chronicle" id="sw2_volume_read" data-volume="${escapeHtml(volumeId)}">${body}</div>`;
}

// ============ K41 链视图（细案 §3.2/§3.3 → A-15 渲染面；珠链形态=chain-view-mockup.html v3 沙漏） ============
// 纯函数、零创作：把 chain.js 展开器的节点链渲染成珠链 HTML——id → 玩家名/措辞全在本层；
// 引擎 id 只进悬停 title 与「展开条目」管理区（A-3 豁免口径）；阅卷按钮按纪 span ∩ 卷 fromTick/toTick 装配。

function cvVols(volumes, span) {
    return (volumes || []).filter((v) => {
        const f = Number.isFinite(v.fromTick) ? v.fromTick : -Infinity;
        const t = Number.isFinite(v.toTick) ? v.toTick : Infinity;
        return t >= (span?.from ?? 0) && f <= (span?.to ?? Infinity);
    });
}
const cvOpenBtns = (vols) => (vols.length
    ? `<span class="sw2-cv-vols">${vols.map((v) => `<button class="sw2-volact" data-action="read-volume" data-vol="${escapeHtml(v.id)}">阅卷 · ${escapeHtml(v.id)}</button>`).join('')}</span>`
    : '');
const cvVerdict = (a) => {
    if (!a.closed) return '<span class="sw2-cv-verdict open">在办</span>';
    return (a.blockedTail || '').startsWith('放弃')
        ? '<span class="sw2-cv-verdict stop">已终止</span>'
        : '<span class="sw2-cv-verdict done">已了结</span>';
};
const cvVb = (v) => (v === 'concealed' ? '<span class="sw2-visible v-hidden">暗</span>' : '<span class="sw2-visible v-known">明</span>');
const cvDots = (p, m) => {
    const s = [];
    for (let i = 0; i < m; i += 1) s.push(`<i class="${i < p ? 'on' : ''}"></i>`);
    return `<span class="sw2-cv-dots">${s.join('')}</span>`;
};
const cvChip = (x) => `<span class="sw2-cv-chip${x.visibility === 'concealed' ? ' dark' : ''}">${escapeHtml(x.goal)}${x.visibility === 'concealed' ? '（暗）' : ''} · ${x.closed ? '已了结' : '在办'} ${x.progress ?? 0}/${x.maxSteps ?? 0}</span>`;
const cvSrcPhrase = (n) => {
    if (!n) return '由世界处境而生';
    if (n.kind === 'event') return `沿「${n.title}」而来`;
    if (n.kind === 'agenda') return `由盘算「${n.goal}」而生`;
    if (n.kind === 'milestone') return '源头已入大事纪';
    if (n.kind === 'gap') return '沿「旧事」而来（已无从检索）';
    if (n.kind === 'terminal') return '纪之源头已不可查';
    return '由世界处境而生';
};

function cvUpBeads(world, nodes, volumes) {
    return (nodes || []).map((n, i) => {
        if (n.kind === 'event') {
            const src = cvSrcPhrase(nodes[i - 1]);   // 更远一侧 = 本事件的来路
            return `<div class="sw2-cv-bead ev"><span class="sw2-cv-bk">事</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">${escapeHtml(n.title)}<span class="sw2-cv-src">事件 · ${fmtTick(n.born)} · ${n.closed ? '已了结' : '未了结'}</span></div>`
                + `<div class="sw2-cv-meta">${src}</div></div></div>`;
        }
        if (n.kind === 'agenda') {
            return `<div class="sw2-cv-bead ag${n.visibility === 'concealed' ? ' dark' : ''}"><span class="sw2-cv-bk">谋</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">${escapeHtml(n.goal)}${cvVb(n.visibility)}${cvVerdict(n)}<span class="sw2-cv-src">谋划 · ${escapeHtml(entityLabel(world, n.owner))} · 阶段 ${escapeHtml(n.stage)}</span></div>`
                + `<div class="sw2-cv-meta">${cvDots(n.progress, n.maxSteps)} ${n.progress}/${n.maxSteps}</div>`
                + (n.doneTail ? `<div class="sw2-cv-meta dim">最近一步：${escapeHtml(n.doneTail)}</div>` : '')
                + (n.blockedTail ? `<div class="sw2-cv-meta dim blk">受阻：${escapeHtml(n.blockedTail)}</div>` : '')
                + (n.parents.length ? `<div class="sw2-cv-meta">委派自上：${n.parents.map(cvChip).join('')}</div>` : '')
                + (n.children.length ? `<div class="sw2-cv-meta">下沿子谋划：${n.children.map(cvChip).join('')}</div>` : '')
                + (n.fruits.length ? `<details class="sw2-cv-roll"><summary>产果 · ${n.fruits.length} 件（由本谋划生的事件）</summary><div class="sw2-cv-in">${n.fruits.map((f) => `${escapeHtml(f.title)}（${fmtTick(f.born)}${f.closed ? ' · 已了结' : ''}）`).join(' · ')}</div></details>` : '')
                + `</div></div>`;
        }
        if (n.kind === 'milestone') {
            return `<div class="sw2-cv-bead ms"><span class="sw2-cv-bk">纪</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">大事纪<span class="sw2-cv-src">第 ${n.span.from}–${n.span.to} 轮 · ${n.counts.events ?? 0} 件事</span></div>`
                + `<div class="sw2-cv-meta">“${(n.titles || []).slice(0, 3).map(escapeHtml).join(' · ')}”</div>`
                + ((n.ids || []).length ? `<details class="sw2-cv-roll"><summary>展开这一纪的条目（管理细节）</summary><div class="sw2-cv-in">${escapeHtml(n.ids.join(' · '))}</div></details>` : '')
                + cvOpenBtns(cvVols(volumes, n.span))
                + ((n.parents || []).length ? `<div class="sw2-cv-nest">${cvUpBeads(world, n.parents, volumes)}</div>` : '')
                + `</div></div>`;
        }
        if (n.kind === 'state-root') {
            return `<div class="sw2-cv-bead term"><span class="sw2-cv-bk">源</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">由世界处境而生<span class="sw2-cv-src">终节点 · 不再更上</span></div>`
                + `<div class="sw2-cv-meta">处境是事件的起点——账上没有比它更早的来路。</div></div></div>`;
        }
        if (n.kind === 'gap') {
            return `<div class="sw2-cv-bead gap"><span class="sw2-cv-bk">旧</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">${n.reason === 'ring' ? '环防' : '沿「旧事」而来'}<span class="sw2-cv-src">${n.reason === 'ring' ? '至此为止' : '已无从检索'}</span></div>`
                + `<div class="sw2-cv-meta">${n.reason === 'ring' ? '引用成环，链在此剪断（账不可信处的如实标注）。' : '引用的上游既不在热账也不在任何大事纪——正直展示，不猜内容。'}</div></div></div>`;
        }
        if (n.kind === 'terminal') {
            return `<div class="sw2-cv-bead term"><span class="sw2-cv-bk">源</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">纪之源头已不可查（旧账）<span class="sw2-cv-src">最老的大纪</span></div>`
                + `<div class="sw2-cv-meta">最老的纪没有记录更早的来路——如实显示，不猜不编。</div></div></div>`;
        }
        return '';
    }).join('');
}

function cvDownTree(world, nodes, volumes) {
    const bead = (n) => {
        if (n.kind === 'event') {
            return `<div class="sw2-cv-branch"><div class="sw2-cv-bead ev"><span class="sw2-cv-bk">事</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">${escapeHtml(n.title)}<span class="sw2-cv-src">事件 · ${fmtTick(n.born)} · ${n.closed ? '已了结' : '未了结'}${n.ring ? '（环防）' : ''}</span></div></div></div>`
                + ((n.children || []).length ? `<div class="sw2-cv-nest">${n.children.map(bead).join('')}</div>` : '')
                + `</div>`;
        }
        if (n.kind === 'leaf-note') {
            return `<div class="sw2-cv-branch"><div class="sw2-cv-bead leaf"><span class="sw2-cv-bk">卷</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">另有后续在旧卷<span class="sw2-cv-src">第 ${n.span.from}–${n.span.to} 轮 · 已随段入卷</span></div>`
                + `<div class="sw2-cv-meta">这一支的后续牵动已随段入卷——阅卷看全文。${cvOpenBtns(cvVols(volumes, n.span))}</div></div></div></div>`;
        }
        return '';
    };
    return `<div class="sw2-cv-col">牵动 · 下沿（▼ 向未来）</div><div class="sw2-cv-tree">${(nodes || []).map(bead).join('')}</div>`;
}

export function renderChainViewHtml(chain, { world, volumes = [] } = {}) {
    if (!chain || !chain.ok) {
        return `<div class="sw2-cv" id="sw2_chain_view"><div class="sw2-cv-head"><div class="sw2-cv-t">事件链</div>`
            + `<button class="sw2-btn sw2-cv-close" data-action="chain-close">收起</button></div>`
            + `<div class="sw2-cv-def">没有这条事件（已无从检索）。</div></div>`;
    }
    const root = chain.root;
    const isMs = root.kind === 'milestone';
    const nearSrc = (chain.up || []).at(-1);
    const up = isMs ? (root.parents || []) : (chain.up || []);
    const hero = isMs
        ? `<div class="sw2-cv-hero"><span class="sw2-cv-hx">纪</span><div><div class="sw2-cv-hn">大事纪 · 第 ${root.span.from}–${root.span.to} 轮 · ${root.counts.events ?? 0} 件事</div>`
            + `<div class="sw2-cv-hm">“${(root.titles || []).slice(0, 3).map(escapeHtml).join(' · ')}”${cvOpenBtns(cvVols(volumes, root.span))}</div></div></div>`
        : `<div class="sw2-cv-hero"><span class="sw2-cv-hx">事</span><div><div class="sw2-cv-hn">“${escapeHtml(root.title)}”</div>`
            + `<div class="sw2-cv-hm"><span><b>源自</b>：${cvSrcPhrase(nearSrc)}</span><span><b>事发</b>：${escapeHtml(root.position)}</span>`
            + `<span><b>${fmtTick(root.born)}</b> · ${root.closed ? '已了结' : '未了结'}</span></div></div></div>`;
    return `<div class="sw2-cv" id="sw2_chain_view">`
        + `<div class="sw2-cv-head"><div class="sw2-cv-t">${isMs ? '大事纪的来去' : `事件「${escapeHtml(root.title)}」的来去`}</div>`
        + `<button class="sw2-btn sw2-cv-close" data-action="chain-close">收起</button></div>`
        + `<div class="sw2-cv-col">来路 · 上承（▲ 向更早）</div><div class="sw2-cv-rail">${cvUpBeads(world, up, volumes)}</div>`
        + `<div class="sw2-cv-axis"></div>${hero}<div class="sw2-cv-axis"></div>`
        + cvDownTree(world, chain.down || [], volumes)
        + `<div class="sw2-cv-foot">全部为一手事实拼句：来路/牵动取自账本指针与落账文本，引擎不新编一字。</div>`
        + `</div>`;
}

// ============ 六页签全集入口（K34 接线用；同输入逐字节一致 A-2 锁） ============

// leg27 后 · 快照容错（细案 docs/spec-snapshot-fault-tolerance.md；用户拍板：IDB 独立库 / 15 步 / 只回世界账）
// 渲染纪律（同批量补全的先例）：**渲染层不持任务状态**——快照清单由 config 注入（web/index.js 读 IDB 后传入）。
//   面板零第二份状态：这里只把事实画出来，一份都不缓存。
export function renderSnapshotsHtml(world, { config = {} } = {}) {
    const snap = config?.snapshots || null;
    const rows = Array.isArray(snap?.list) ? snap.list : [];
    const seqOf = (s) => { const m = /^s(\d+)$/.exec(String(s?.id ?? '')); return m ? Number(m[1]) : -1; };
    const sorted = [...rows].sort((a, b) => seqOf(b) - seqOf(a));   // 最新在前（面板按"最近能退到哪"读）
    const kb = (n) => ((Number(n) || 0) / 1024 >= 1024 ? `${((Number(n) || 0) / 1024 / 1024).toFixed(2)}MB` : `${Math.round((Number(n) || 0) / 1024)}KB`);
    const line = (s) => {
        const kindWord = s.kind === 'full' ? '完整' : '增量';
        const when = String(s.at || '').slice(11, 19);
        // ★leg27 d（用户实拍「怎么一下子多了这么多」时那一屏）：旧行同时打「第 N 轮」**和** `reason`，
        //   而 reason 默认就是"落账" ⇒ 每行都重复一遍"落账"，信息量为零还占宽。现在只打**触发词**，
        //   轮次由 `· 第 N 轮` 承担（两者一个事实，不打两遍）。
        const trigger = String(s.reason || '').replace(/（.*?）$/, '').trim() || '落账';
        return `<div class="sw2-row" data-snap="${escapeHtml(s.id)}">`
            + `<span class="sw2-snap-id">${escapeHtml(s.id)}</span>`
            + `<span class="sw2-snap-tick">${escapeHtml(trigger)} · 第 ${s.tick == null ? '?' : s.tick} 轮</span>`
            + `<span class="sw2-snap-kind">${kindWord} ${kb(s.bytes)}</span>`
            + `<span class="sw2-snap-at">${escapeHtml(when)}</span>`
            + `<button class="sw2-btn" data-action="snapshot-restore" data-snap="${escapeHtml(s.id)}" data-tick="${s.tick == null ? '' : s.tick}">回到此步</button>`
            + `</div>`;
    };
    const head = `<div class="sw2-sv-head"><div><div class="sw2-sv-title">快照 · 每一步都能退回去</div>`
        + `<div class="sw2-sv-sub">每一次落账（演化 / 查书 / 批量补全 / 初始化）都会拍一份。存<b>插件本地库</b>（不占聊天文件），保留最近 <b>15 步</b>。`
        + `<b>回到某一步 = 只回世界账</b>，对话记录不动。</div></div>`
        + `<div class="sw2-sv-cards"><span class="sw2-sv-chip ${rows.length ? 'ok' : 'stale'}">${escapeHtml(snap?.text || '快照 —')}</span></div></div>`;
    if (!snap) {
        return head + `<div class="sw2-hint">快照清单还没读到（首次落账后出现；若一直为空请 Ctrl+F5 并看控制台）。</div>`;
    }
    if (!rows.length) {
        return head + `<div class="sw2-hint">还没有快照——世界每落一次账就会拍一份（当前 0 份）。</div>`;
    }
    return head
        + `<div class="sw2-sv-grid"><div class="sw2-set-card" style="grid-column:1/-1">`
        + `<h4>可回退的步（最新在前 · ${rows.length} 份）</h4>`
        + `<div class="sw2-hint" style="margin-bottom:8px">「完整」= 整份世界（锚点，每 5 步一份）；「增量」= 相对锚点的差异。`
        + `恢复用「锚点 + 增量」两步，所以点任意一份都是**一步到位**，不需要重放整条链。</div>`
        + sorted.map(line).join('')
        + `</div></div>`
        + `<div class="sw2-row"><span class="sw2-actions">`
        + `<button class="sw2-btn sw2-danger" data-action="snapshot-clear">重置快照（清空并重拍链头）</button>`
        + `</span><em>用于清掉旧代码/丢账时拍下的那批不可信快照；清完从当前世界重新起链</em></div>`;
}

export function renderAll(world, { config = {}, oldVolumes = [], view = {} } = {}) {
    return {
        board: renderBoardHtml(world),
        chronicle: renderChronicleHtml(world, { oldVolumes, filter: view.chronicleFilter ?? null }),
        archive: renderArchiveHtml(world, { oldVolumes }),
        entities: renderEntitiesHtml(world, { config }),
        setting: renderSettingHtml(world),
        params: renderParamsHtml(world, { config }),   // leg26：参数独立页签（玩家定档位）；leg27 h：+ 记忆投递自证
        snapshots: renderSnapshotsHtml(world, { config }),   // leg27 后：快照容错（每步可回退）
        settings: renderSettingsHtml(world, { config, oldVolumes }),
        header: {
            world: world.context?.world ?? '',
            tick: fmtTick(world.meta?.tick ?? 0),
        },
    };
}