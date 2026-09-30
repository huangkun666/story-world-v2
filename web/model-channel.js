// story-world-v2/web/model-channel.js
//
// ★★★leg142（用户令 2026-09-27：「**把获取模型列表（点击某一项自动填入模型id）和测试是否连通做一下**（设置那一页的）」）：
//   **「模型通道」那一族的新家** —— 设置表单的写通道（原先住在 `web/index.js`）＋ 两枚新按钮的接线。
//
// ★为什么搬（两个理由，缺一不可）：
//   ① `web/index.js` **只剩 1 行**（3099 / 3100，`test/web-view-state-layout.test.js` 锁着）
//      ⇒ 要往接线层加东西，必须**先把一族搬出去**（本仓 leg73/78/82/107/140 的既有做法：
//      `createXxxHub(deps)` ＋ 调用方只取回工厂）；
//   ② 那两个新功能**本来就属于这一族**（同一个地址、同一把密钥、同一页）⇒ 搬出去正好落在同一个家里，
//      不是"为了腾行数随手挪一个不相干的东西"。
//
// ★边界（守死）：本模块**只做接线**——读设置 / 写设置 / 调取数口 / 报状态 / 回填渲染态。
//   取数与判定在 `src/transport-http.js` 的 `listModels` / `probeModel`（纯函数、可注入 sender、
//   Node 里真跑判据）；渲染在 `src/render.js` 的设置页。本模块不认识账本、不认识引擎。
//
// ★零 Node 内建依赖（`browser-compat` 的扫描面）——只用 DOM 与注入进来的那几口。

import { listModels, probeModel } from '../src/transport-http.js';
import { renderModelListHtml, renderModelProbeHtml } from '../src/render.js';

/** 按 id 找键的那三个框（地址/密钥/模型）。★数字键**不在这张表里**（它们走 `data-settings`，见下）。 */
export const SETTINGS_INPUTS = { baseUrl: 'sw2_base', apiKey: 'sw2_key', model: 'sw2_model' };

// 数字型设置键的范围（唯一真源：reading 端——渲染层只画 min/max 提示，**拦截在这里**）。
//   ★为什么拦：这两个数直接进引擎（`resolveBrowserTransport` → `createHttpTransport` 的
//     `timeoutMs`/`maxTokens`）⇒ 落一个 NaN 或负数进去 = 每轮调用当场失败，而玩家只会看到"演算失败"。
// ★★★leg144（用户真机反馈）：「**每个人使用的网关不同支持的并发度上限不同**」⇒ 新增 `extractConcurrency`。
//   ★它住**这一格**（模型通道）而不是参数页：并发度是**网关的属性**，不是世界的属性
//     （参数页那些是"这个世界"的东西：这本书的名号表、这本账的往事）。
//   ★★**只设下限、不设上限**（用户 2026-09-27 当场裁的原话：「**数自己填不设上限**」）——
//     所以上限那一格写 `POSITIVE_INFINITY`（下面 `n > range[1]` 对 Infinity 恒为假 ⇒ 等于不拦）。
//     ★但**下限 1 与"必须是整数"照旧拦**：那两条不是"上限"，是"别把引擎搞坏"
//       （0 或 NaN 进去 ⇒ 一件活儿都发不出去 ⇒ 静默什么都不抽）。
export const SETTINGS_NUM_RANGE = {
    callTimeoutSec: [5, 600], callMaxTokens: [1024, 131072], tagMaxActions: [1, 200],
    extractConcurrency: [1, Number.POSITIVE_INFINITY],
};

/** 数字键的**人话名**（出现在状态条上，所以是玩家可见文本：零引擎术语）。 */
export const SETTINGS_NUM_LABEL = {
    callTimeoutSec: '单轮超时（秒）',
    callMaxTokens: '单轮输出上限（token）',
    tagMaxActions: '单轮注入行动条数上限',
    extractConcurrency: '同时问几块',
};

/** 数字设置的归一：合法 ⇒ 整数；非法/越界 ⇒ null（调用方**不写盘**并如实出声，绝不写 NaN）。 */
export function sw2NormalizeNumericSetting(key, raw) {
    const range = SETTINGS_NUM_RANGE[key];
    if (!range) return null;
    const s = String(raw ?? '').trim();
    if (!/^\d+$/.test(s)) return null;          // 空串/负号/小数/中文一律不受理（不猜、不四舍五入）
    const n = Number(s);
    if (!Number.isFinite(n) || n < range[0] || n > range[1]) return null;
    return n;
}

/** 秒数的人话（两位小数够用；探测本来就在秒级）。 */
const secs = (ms) => `${(Number(ms || 0) / 1000).toFixed(1)} 秒`;

/**
 * 建「模型通道」hub。
 * @param {object} deps 全部由调用方注入（本模块不 import 接线层，免得绕回去）：
 *   `{ getWin, getSettings, writeSetting, setStatus, refreshSettings }`
 *   · `getWin()` ⇒ 面板窗口元素（`bindSettingsForm` 挂委托用）
 *   · `getSettings()` ⇒ 当前设置（`modelSettings()` 那一口）
 *   · `writeSetting(key, value)` ⇒ 写插件设置（`extension_settings.story_world_v2`）
 *   · `setStatus(line)` ⇒ 状态条
 *   · `refreshSettings()` ⇒ 只重画设置页那一段（**不重画整面板**）
 */
export function createModelChannelHub(deps = {}) {
    // ★解构名刻意与原来那一份**逐字同名**（`dispatchAction` / `readPayload`）——判据按源码位置咬这一条，
    //   同名让那条判据"改指新家"时**只换文件、不换断言**（少一次改写就少一次改错的机会）。
    const { getWin, getSettings, writeSetting, setStatus, readPayload, dispatch: dispatchAction, fetchImpl = null } = deps;
    const noop = () => {};
    const win = typeof getWin === 'function' ? getWin : () => null;
    const read = typeof getSettings === 'function' ? getSettings : () => ({});
    const write = typeof writeSetting === 'function' ? writeSetting : noop;
    const status = typeof setStatus === 'function' ? setStatus : noop;

    // ★渲染态住在 hub 里（渲染层不持状态是本仓纪律 ⇒ 由这里经 `renderCfg` 注进去）。
    //   两格各自独立：清单可以取到了而连通还没测过（反过来也一样）。
    const state = { catalog: null, probe: null };

    /** 交给 `renderCfg()` 摊进 config 的那两格。 */
    const renderState = () => ({
        modelCatalog: state.catalog || null,
        modelProbe: state.probe || null,
    });

    /**
     * ★★★leg142：**只原地换那两块**（清单 ＋ 结论行），**绝不重画整页**。
     *
     * 为什么（**这是本笔最要紧的一处，实机抓出来的**）：`refreshSections` 有一道"玩家手下有活控件 ⇒
     * 重绘押后"的闸（`web/index.js` 那条 `playerIsTouchingParams()`）——而**点按钮会让按钮拿到焦点**
     * ⇒ 闸判成"手还在控件上" ⇒ 整页重绘被推到**失焦之后**才补。实机手感就是"点了要等几秒才变"。
     * ★本仓**自己记过这个坑**（`web/index.js:404-407`）：注入开关当年试过"给自己发一张重绘通行证"
     * 来豁免那条判据，**实机没解决**；走通的办法是"**不重画整页，只原地改那一块自己的 DOM**"。
     * 这里照同一条办——所以本模块**没有"重画设置页"这一步**。
     */
    function paint() {
        const el = win();
        if (!el || typeof el.querySelector !== 'function') return;
        const cfg = { ...(read() || {}), ...renderState() };
        const list = el.querySelector('#sw2_models');
        if (list) list.innerHTML = renderModelListHtml(cfg);
        const probe = el.querySelector('#sw2_probe');
        if (probe) probe.innerHTML = renderModelProbeHtml(cfg);
    }

    /**
     * ★★★用户令：**获取模型列表**（`GET /v1/models`，与对话同一个地址、同一把密钥）。
     * ★**不花钱**，而且它成功本身就证明"地址与密钥是通的"。
     * ★**一个字都不写进设置**——只把清单摆出来，填不填由玩家点（下一条）。
     */
    async function listModelsAction() {
        const s = read() || {};
        status('正在取模型列表…');
        const r = await listModels({ baseUrl: s.baseUrl, apiKey: s.apiKey, fetchImpl });
        if (!r.ok) {
            state.catalog = { models: [], limits: {}, note: `✗ 取不到模型列表：${r.error}` };
            status(`⚠ 取不到模型列表：${r.error}`);
        } else {
            // ★★★leg157：清单里**顺手带上服务端自己报的容量**（`limits`，键 = 模型 id）——
            //   点某一项时用它把「单轮输出上限」填好（见 `pickModelAction`）。
            //   ★这一句要**如实说清"报了几个"**：一个都没报时玩家得知道"那一格按出厂值"，
            //     而不是以为"插件没读"（本仓最忌"读数为空"与"功能没跑"长得一模一样）。
            const declared = Object.keys(r.limits || {}).length;
            state.catalog = {
                models: r.models,
                limits: r.limits || {},
                note: `✓ 取到 ${r.models.length} 个模型（点一下即填进「世界模型」）`
                    + (declared
                        ? ` · 其中 ${declared} 个自己报了输出上限——点它时会**一并**填好「单轮输出上限」`
                        : ' · 这个网关一个都没报输出上限（那一格就按出厂值走）'),
            };
            status(`已取到 ${r.models.length} 个模型——点列表里任意一项即填入`);
        }
        paint();
        return r;
    }

    /** ★★★用户令：**测试连通**——发一次最小真实请求，一次验三样（地址 / 密钥 / 模型号）。 */
    async function probeModelAction() {
        const s = read() || {};
        status('正在测试连通…');
        const r = await probeModel({ baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model, fetchImpl });
        // ★用户 2026-09-27 当场裁的：**不写"模型回了几个字"**（那是内部噪声，玩家要的是通没通）。
        state.probe = r.ok
            ? { ok: true, line: `✓ 通 · ${String(s.model || '')} · ${secs(r.ms)}` }
            : { ok: false, line: `✗ ${r.error}` };
        status(r.ok ? `✓ 连通 · ${String(s.model || '')} · ${secs(r.ms)}` : `⚠ 连不通：${r.error}`);
        paint();
        return r;
    }

    /**
     * ★★★用户令：**点清单里某一项 ⇒ 自动填入模型 id**。
     * ★这是**唯一会写设置**的那一下（另外两条都只读）——所以要写状态条、要让玩家看得见填了什么。
     */
    function pickModelAction(model) {
        const id = String(model || '').trim();
        if (!id) return { ok: false, line: '没有模型名' };
        write('model', id);
        // ★★就地写进输入框（**不是**重画整页）：玩家点的就是"把这一格换成它"，
        //   而重画会被"押后"闸推到失焦之后（见上面 `paint` 的留档）⇒ 手感变成"点了没反应"。
        //   ★本仓"控件是玩家的手、不许回写"那条讲的是 `set-param` 那条路（防"点了写两次"）；
        //     这里玩家**明确点名要换这一格**，与注入开关（leg89）是同一情形，故照它办。
        const el = win();
        const input = el?.querySelector?.('#sw2_model');
        if (input) input.value = id;
        // ★★★leg157（用户令「**能直接读的话那就直接读呗，没有就默认32768**」）：
        //   **服务端自己报了输出上限就照它填**（这个值就是它接受的 `max_tokens` 上限，
        //   见 `src/transport-http.js` 的 `declaredLimitsOf`）——玩家不用再去猜一个数。
        //   ★报不到（或报的数出了可填范围）⇒ **一个字都不写**，让那一格回出厂值（32,768），
        //     并**如实说清是哪一种**：本仓最忌"这一格没填"与"我读了但你没报"长得一样。
        const declared = state.catalog?.limits?.[id]?.maxOutputTokens;
        const norm = Number.isFinite(declared) ? sw2NormalizeNumericSetting('callMaxTokens', declared) : null;
        if (norm != null) {
            write('callMaxTokens', norm);
            const ti = el?.querySelector?.('#sw2_call_tokens');
            if (ti) ti.value = String(norm);
            status(`已填入世界模型：${id} ——「单轮输出上限」按它自己声明的 ${norm} 一并填好`);
            paint();          // 清单那边把高亮挪到新的这一项
            return { ok: true, line: id, maxTokens: norm };
        }
        status(`已填入世界模型：${id}`
            + (Number.isFinite(declared)
                ? '（它声明的输出上限超出了这一格能填的范围，这一格没动）'
                : '（这个网关没报输出上限，这一格保持原样 / 按出厂值）'));
        paint();          // 清单那边把高亮挪到新的这一项
        return { ok: true, line: id, maxTokens: null };
    }

    /**
     * 设置表单的写通道（★从 `web/index.js` **整段搬来**，行为逐字未变）。
     * 三条路：① `[data-action="set-param"]`（参数页控件）② 按 id 找键的三个框 ③ `data-settings` 数字键。
     * ★注入开关**不走这里**（它由 `web/action-router.js` 的 `route()` 早退收下，见那边的留档）。
     */
    function bindSettingsForm() {
        const el = win();
        if (!el || el.dataset.sw2SettingsBound) return;
        el.dataset.sw2SettingsBound = '1';
        const onField = (e) => {
            // leg26：参数页的控件也走这条委托（`data-action="set-param"`）——旋钮与开关同一条写通道
            // ★★leg40c 续（用户实机「只是展开下拉就弹『天时 → 未定』，点了还是改不了值」的真因）：
            //   判据必须是 **`[data-action="set-param"]`**，而且**必须确认抓到的是控件本身**。
            //   原来的写法 `closest('[data-action="set-param"]') || (target 自己有 data-action ? target : null)`
            //   在 `input`/`change` 的 target 是 `<option>`（在 select 内部）时，`closest` 找不到 select
            //   ⇒ 落到卡片壳那个 `div` 上 ⇒ 读 `div.value` = `undefined` ⇒ **当成"未定"提交**，玩家选的那档被丢掉。
            //   ⇒ 定稿两条：①壳上不再挂 `data-param`（治本，见 render.js）；②这里**只认真正的控件**
            //      （`SELECT`/`BUTTON`/`INPUT`），抓到非控件就**如实拒绝**并把原始 target 记进控制台——
            //      宁可报错，也绝不把 `undefined` 当成"未定"写进玩家的账（静默写错值比报错坏得多）。
            const hit = e.target?.closest?.('[data-action="set-param"]') || null;
            if (hit) {
                const tag = String(hit.tagName || '').toUpperCase();
                if (tag !== 'SELECT' && tag !== 'BUTTON' && tag !== 'INPUT') {
                    console.warn('[story-world-v2] 参数控件的判据抓到了非控件（值会被读成 undefined）——已拒绝本次提交，请把这一行给维护者', {
                        抓到: `${tag}.${hit.className || ''}`,
                        '原始 target': `${String(e.target?.tagName || '').toUpperCase()}.${e.target?.className || ''}`,
                        'data-param': hit.getAttribute('data-param'),
                    });
                    status('⚠ 这一下没接上（面板结构变了）——已拒绝提交，世界账没动');
                    return;
                }
                // ★★leg108：属性那一半不再手拼 —— 与主委托共用 `readPayload`；`el` 仍是**手工加的那一个键**
                //   （它不来自任何属性，而 `sw2ApplyParam` 靠它分「明确清空」与「手滑到空」）。
                const payload = typeof readPayload === 'function' ? readPayload(hit) : {};
                if (typeof dispatchAction === 'function') dispatchAction('set-param', { ...payload, value: payload.value ?? hit.value, el: hit }, e);
                return;
            }
            const key = Object.keys(SETTINGS_INPUTS).find((k) => SETTINGS_INPUTS[k] === e.target?.id);
            if (key) {
                const v = e.target.value;
                if (key === 'apiKey') {
                    if (v && v.trim()) write('apiKey', v.trim()); // 留空=不改（防一次误清）
                    return;
                }
                write(key, v);
                return;
            }
            // ★★★leg87：数字型设置（单轮超时/输出上限）走**声明式**这一格（`data-settings="键名"`）。
            //   为什么与上面那条分开：上面那条把值原样写盘（字符串），数字键必须过校验——
            //   非法值（空框 / 负数 / 中文）**不写盘、当场如实出声**（静默写 NaN = 每轮调用失败且看不出为什么）。
            const numKey = e.target?.getAttribute?.('data-settings');
            if (numKey) {
                const n = sw2NormalizeNumericSetting(numKey, e.target.value);
                if (n == null) {
                    const [lo, hi] = SETTINGS_NUM_RANGE[numKey] || [];
                    status(`⚠ 「${SETTINGS_NUM_LABEL[numKey] || numKey}」要填 ${lo}–${hi} 之间的整数——这一下没有写入（世界账没动）`);
                    return;
                }
                write(numKey, n);
                status(`已保存 · ${SETTINGS_NUM_LABEL[numKey] || numKey} → ${n}`);
                return;
            }
        };
        el.addEventListener('input', onField);
        el.addEventListener('change', onField);
        // ★leg27 c（用户实拍「下拉表刚拉开没多久自己就关了」的同批修复）：
        //   `<select>` 有个老坑——**鼠标滚轮从它上面滚过就会改选中项**（不弹列表也改）。
        //   面板一打开、滚轮滑过参数页那个下拉，就把一次**什么都没改**的动作变成一次落盘 + 状态栏弹出。
        //   ⇒ 拦掉 `SELECT` 上的滚轮（键盘/点击照旧——那才是"玩家的手"）。
        el.addEventListener('wheel', (e) => {
            const hit = e.target?.closest?.('[data-action="set-param"]');
            if (hit && hit.tagName === 'SELECT') e.preventDefault();
        }, { passive: false });
    }

    return { bindSettingsForm, listModelsAction, probeModelAction, pickModelAction, renderState, normalizeNumericSetting: sw2NormalizeNumericSetting };
}
