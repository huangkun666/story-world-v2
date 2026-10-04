// story-world-v2/web/embed-channel.js
// ★★★leg152：**嵌入通道那一族**（设置页那三格 ＋ 体检 ＋ 每轮旁路补嵌 ＋ 读数行）。
// ★★★leg172：**多担一件**（用户令「**现在需要给记忆通道也添加一个获取模型列表**」）：
//   这一族也**取模型清单**（`GET /models`，用记忆通道自己的地址与密钥）并把点选回填进 `embedModel`；
//   同批撤掉「量一批几行」那颗手动量容量的按钮（连动作与函数——一次发多少行由通道自己定）。
//
// 【为什么它必须自成一族、而且必须由调用方注入】
//   `web/index.js` 只余个位数行（硬锁 `<3100`），而这一族要**读设置、发请求、读账、写索引**——
//   全塞进接线层就是十几个来回。⇒ 照 `web/model-channel.js` 那条既有做法：
//   **本模块管"这一族的形状与流程"，取数与判定全部从 `src/` 注入**。
//
// 【★它不做判断（一处定义）】
//   · "哪些事该嵌 / 形状对不对 / 召回几件" ⇒ `src/ledger-vector.js` 与 `src/vector-store.js`（纯函数）；
//   · "一段文本怎么变向量 / 批量装不下怎么办" ⇒ `src/embed-client.js`；
//   · "一轮里补多少、失败怎么办" ⇒ `src/embed-orchestration.js`；
//   · "模型清单长什么样、怎么转义" ⇒ `src/render.js` 那两个渲染口（与世界模型清单**同一处实现**）；
//   · **本模块只做五件**：读那几格设置 → 造客户端 → 每轮调一次旁路 → 把读数变成一行字 → 取/点模型清单。
//
// 【纪律】零 Node 内建依赖（`browser-compat` 的扫描面）；顶层零 DOM 访问；
//   所有函数都接注入进来的 `deps`（判据里给假的，生产给真的）。
// ★★配置口径（那几格的 id / 出厂缺省 / 读取 / 启用判据 / 读数行）**住在 `src/embed-client.js`**
//   ——因为渲染层也要用它们，而 `src/` 不许反向 import `web/`。这里只**转出来**给接线层用。

export { EMBED_INPUTS, EMBED_DEFAULTS, readEmbedConfig, embedEnabled, embedReadoutLine } from '../src/embed-client.js';
// ★★注意：`export {…} from` 只把名字**转给外面**，**本文件内部用不了它**——
//   本模块自己要用（`clientOf` / `line` / `stepForTick` 都读它）⇒ 必须**再 import 一次**。
//   （第一版漏了这一步，四条判据当场红：「readEmbedConfig is not defined」。）
import { readEmbedConfig, embedEnabled, embedConfigured, embedReadoutLine } from '../src/embed-client.js';
// ★★★leg172（用户令「**现在需要给记忆通道也添加一个获取模型列表**」）：取数口与渲染口**都复用既有的**
//   ——`listModels`（与"世界模型"那条通道同一个口，含人话报错）＋两个渲染口（`src/render.js`，
//   与世界模型清单**同一处实现**）。⇒ 不新增模块、不抄第二份取数或转义逻辑。
import { listModels } from '../src/transport-http.js';
import { renderEmbedModelListHtml, renderEmbedProbeHtml } from '../src/render.js';

/**
 * 造这一族的 hub。
 * @param {object} deps 全部注入（本模块不 import 接线层，免得绕回去）：
 *   · `getSettings()` → 那一坨设置（认地址/密钥/模型号三格）
 *   · `probeChannel(cfg)` → 体检（`src/embed-client.js` 的 `probeEmbedChannel`）
 *   · `stepEmbedFor({world, dialogue})` → 一轮旁路（生产＝`web/embed-runtime.js` 的 `stepForTick`）
 *   · `getStats()` → {count, pending, dims, rowsPerRequest, lastEmbedded, failed, failureNote}
 *   · `getWin()` → 面板窗口元素（只原地换清单/结论两块用）
 *   · `writeSetting(key, value)` → 写插件设置（点清单里那一项时**只写 `embedModel`**）
 *   · `setStatus(line)` → 状态条；`fetchImpl` → 取列表的发送器（判据注入假的）
 */
export function createEmbedChannelHub(deps = {}) {
    const { getSettings, probeChannel, stepEmbedFor, getStats, onStatus, recallFor, getWin, writeSetting, setStatus, fetchImpl = null } = deps;
    let running = false;          // ★同一时刻只跑一个（本模块自己保证，不指望调用方）
    let last = null;
    // ★★★leg172：**清单状态住在 hub 里**（渲染层不持状态，本仓既有纪律）——由 `renderCfg()` 摊进 config。
    //   ★★它与"世界模型"那条通道的清单**各持一份**（`embedCatalog` ≠ `modelCatalog`）：两条通道的
    //     地址/密钥/选中项/清单**互不覆盖**（一个本地网关、一个云端是常见配法）。
    const state = { catalog: null, probe: null };
    let probing = null;
    const win = typeof getWin === 'function' ? getWin : () => null;
    const write = typeof writeSetting === 'function' ? writeSetting : () => {};
    const status = typeof setStatus === 'function' ? setStatus : (typeof onStatus === 'function' ? onStatus : () => {});

    /** 交给 `renderCfg()` 摊进 config 的那一格。 */
    const renderState = () => ({ embedCatalog: state.catalog || null, embedProbe: state.probe || null });

    /**
     * ★★★leg172：**只原地换那两块**（清单 ＋ 结论行），**绝不重画整页**——照 `web/model-channel.js`
     * 那条既有做法（原因见那边的留档：点按钮会让按钮拿到焦点 ⇒ `refreshSections` 的"押后"闸把整页
     * 重绘推到失焦之后 ⇒ 实机手感是"点了要等几秒才变"）。
     */
    function paint() {
        const el = win();
        if (!el || typeof el.querySelector !== 'function') return;
        const cfg = { ...(getSettings?.() || {}), ...renderState() };
        const list = el.querySelector('#sw2_emb_models');
        if (list) list.innerHTML = renderEmbedModelListHtml(cfg);
        const probe = el.querySelector('#sw2_emb_probe');
        if (probe) probe.innerHTML = renderEmbedProbeHtml(cfg);
    }

    function showProbe(ok, line) {
        state.probe = { ok, line };
        status(line);
        paint();
    }

    return {
        /** 现在这一族启用了吗（配置齐了没） */
        enabled() { return embedEnabled(readEmbedConfig(getSettings?.() || {})); },
        /** 读一行给界面用 */
        line() { return embedReadoutLine({ enabled: this.enabled(), ...(getStats?.() || {}), ...(last || {}) }); },
        /** 体检（设置页那颗按钮）：一次最小请求 ⇒ 通不通 ＋ 多少维 */
        async probe() {
            if (probing) return probing;
            const cfg = readEmbedConfig(getSettings?.() || {});
            if (!embedConfigured(cfg)) {
                const error = '三格（地址/密钥/模型号）先填齐';
                showProbe(false, error);
                return { ok: false, error };
            }
            showProbe(false, '正在测试记忆通道…');
            probing = (async () => {
                let r;
                try { r = await probeChannel({ ...cfg, dimensions: cfg.dims }); }
                catch (err) { r = { ok: false, error: String(err?.message || err) }; }
                if (!r) r = { ok: false, error: '服务没有返回测试结果' };
                last = { ...(last || {}), dims: r?.dims ?? last?.dims ?? null };
                showProbe(Boolean(r.ok), r.ok
                    ? `记忆通道连通 · ${cfg.model}${r.dims ? ` · ${r.dims} 维` : ''}${Number.isFinite(r.ms) ? ` · ${(r.ms / 1000).toFixed(2)} 秒` : ''}`
                    : `记忆通道连不通：${r.error || '服务没有返回失败原因'}`);
                return r;
            })();
            try { return await probing; } finally { probing = null; }
        },
        /**
         * ★★★leg172（用户令「**现在需要给记忆通道也添加一个获取模型列表**」）：**取向量模型清单**。
         * 三条（与世界模型那条通道同一套交互，逐条对齐）：
         *   ① 用**记忆通道自己的**地址与密钥（`embedBaseUrl`/`embedApiKey`）打 `GET /models`；
         *   ② ★**不要求先填模型号**——"先看有哪些模型再挑"正是这个按钮的用处（`embedEnabled` 那条
         *      "三格齐了才算启用"的判据**不该**挡在这里）；
         *   ③ ★**一个字都不写进设置**——只把清单摆出来，填不填由玩家点（下一条）。
         * ★失败**不抛**：返回 `ok:false` ＋ 一句人话（`listModels` 自己就从不抛；这里再兜一层，
         *   免得注入进来的实现抛出来把动作总线打断）。
         */
        async listModelsAction() {
            const cfg = readEmbedConfig(getSettings?.() || {});
            status('正在取模型列表…');
            let r;
            try {
                r = await listModels({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, fetchImpl });
            } catch (err) {
                r = { ok: false, error: String(err?.message || err) };
            }
            if (!r?.ok) {
                const why = r?.error || '原因没记下来';
                state.catalog = { models: [], note: `取不到模型列表：${why}` };
                status(`注意：取不到模型列表：${why}`);
            } else {
                state.catalog = { models: r.models, note: `取到 ${r.models.length} 个模型（点一下即填进「向量模型」）` };
                status(`已取到 ${r.models.length} 个模型——点列表里任意一项即填入`);
            }
            paint();
            return r;
        },
        /**
         * ★★★leg172：**点清单里某一项 ⇒ 自动填入向量模型号**。
         * ★这是这一族**唯一会写设置**的那一下（取列表与体检都只读）——且**只写 `embedModel`**：
         *   嵌入模型没有"单轮输出上限"那类容量要顺手填（世界模型那条通道才填 `callMaxTokens`）。
         * ★就地写进输入框（**不是**重画整页，理由同上）；手动输入照旧走设置表单那条写通道。
         */
        pickModelAction(model) {
            const id = String(model || '').trim();
            if (!id) return { ok: false, line: '没有模型名' };
            write('embedModel', id);
            const input = win()?.querySelector?.('#sw2_emb_model');
            if (input) input.value = id;
            status(`已填入向量模型：${id}`);
            paint();          // 清单那边把高亮挪到新的这一项
            return { ok: true, line: id };
        },
        /** ★★★leg172：renderCfg 摊进 config 的那一格（整页重画后清单照旧画得出来）。 */
        renderState,
        /**
         * ★★**一轮的旁路**（由 `createTickQueue` 的 `afterTick` 调）：补嵌新滑出窗口的事。
         * 三条：① 同一时刻只跑一个 ② 没启用就**静默返回**（不报错——没配是正常状态）
         *       ③ 失败**只报一句**、绝不抛（加速层不许影响世界）。
         * ★"补几件、窗口多大、用哪个客户端"统统由运行时决定（这里只当闸门与计数）。
         */
        async stepForTick({ world, dialogue = '', volumes = null } = {}) {
            if (running) return { skipped: 'busy' };
            if (!this.enabled()) return { skipped: 'disabled' };
            running = true;
            try {
                const r = await stepEmbedFor({ world, dialogue, volumes });
                last = {
                    lastEmbedded: r?.embedded ?? 0,
                    failed: r?.embedded ? 0 : (r?.failed ? 1 : 0),
                    failureNote: r?.note || null,
                };
                if (r?.note) onStatus?.(`ℹ ${r.note}`);
                return r;
            } catch (err) {
                last = { failed: 1, failureNote: String(err?.message || err) };
                onStatus?.(`注意：向量补嵌出错：${err?.message || err}（世界不受影响）`);
                return { embedded: 0, error: String(err?.message || err), blockedWorld: false };
            } finally {
                running = false;
            }
        },
        /**
         * ★★★leg153：**一轮的召回取数口**（`runTick` 在出包之前调它，把那一栏装进包）。
         * ★它与上面那条旁路**不是一回事**：旁路（补嵌）**不许挡世界**、晚一轮也无所谓；
         *   这一条**必须当轮给出**——"下一轮才给查询结果"那条路已被用户逐字判死。
         * ★这里只做两件：没启用 ⇒ `null`；出错 ⇒ `null`（引擎那一侧照旧"有才挂键"，世界不受影响）。
         */
        async recallForTick(o = {}) {
            if (!this.enabled()) return null;
            try { return await recallFor(o); } catch { return null; }
        },
    };
}
