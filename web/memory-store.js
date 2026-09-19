// story-world-v2/web/memory-store.js
// ★★★leg72（丙-web · 记忆那一格）：**记忆投递子系统**从 `web/index.js` 搬到这里。
//
// 为什么单独成家（不是为行数，是为了**归属正确**）：
//   这一族已经是一个**完整子系统**——它自己的模块级状态、自己的依赖注入形参
//   （`YM` = `window.YuzukiMemory`）、自己的自检面；**与面板视图态、DOM、渲染一条线都不沾**。
//   它此前住在 3700 行接线层的中间，于是"记忆投递"这件事的每一处修改都要先穿过一片参数/视图代码。
//   ⇒ 搬出来之后：**记忆的事只有这一个文件管**（引擎常量从 `src/memory-bridge.js` 取）。
//
// 边界（逐字节搬来，一字未改；本棒只动"它住哪"）：
//   `SW2_RECORD_PREFIX` · `TABLE_ID_ALIAS` · `memoryStore` · `pushMemoryNow` ·
//   `memoryStoreReport` · `memoryStoreCheckLine` · `markMemoryPush` · `memoryPushLine`
//   （外加 `EVENTS_TABLE_NAME`——它的定义与引用原先分居两处，不搬会断线）。
//
// ★★状态归属（本棒最该记住的一条，别改回去）：
//   `sw2MemoryPush`（记忆投递自证面）**只住在本文件**，单一真源、不劈两半。
//   块外要读它、要清它，一律走本文件给的两个受控通道：`readMemoryPush()` / `clearMemoryPush()`。
//   ★为什么不让外面直接读写：那样"记忆投递的状态"就有两个家，一处改了另一处不知道——
//     本仓最贵的病（"两份真相"）正是这么长出来的。
//
// ★依赖方向（单向，叶子）：`web/index.js → web/memory-store.js → ../src/memory-bridge.js`。
//   本文件**不许**反向 import `web/index.js`（那会成环），也**不许** import `web/` 里别的接线层模块。
//   ★保持**模块顶层零 DOM**（与 `web/index.js` 同一条纪律：`node --test` 直接导入得了）——
//     只在函数体内用 `typeof window !== 'undefined'` 守卫式地取 `window.YuzukiMemory`。
//
// ★纪律留档（随块搬来的两条血泪，别丢）：
//   ① `readState` 里那句 `Storage.loadState?.(fallback)` **不许**改成传 `null`——
//      ES 形参默认值只在 `undefined` 时生效，传 `null` 会把 sessionId 定成 null，
//      再经 `saveState(..., { force: true })` 落盘 ⇒ **把用户自己填的角色档案逐条抹掉**（leg27 g 事故）。
//   ② `memoryStoreReport` 里的 `window` 一律走 `typeof window !== 'undefined'` 守卫——
//      裸写 `window.SillyTavern` 会让这条自检在 Node 里第一步就抛、被 catch 吞成"报错"，**永远不可测**（leg30 修）。
import { buildMemoryPayload, pushToMemory, MEMORY_TABLE_STATE, MEMORY_TABLE_EVENTS, PLUGIN_TABLE_STATE, PLUGIN_TABLE_EVENTS, LEGACY_TABLE_IDS } from '../src/memory-bridge.js';
const EVENTS_TABLE_NAME = MEMORY_TABLE_EVENTS;   // leg27 h：自证面里要报"大事几条"（表名只在这里取一次，防两处漂移）

// ---------- leg26 b：记忆投递（引擎事实 → 记忆插件）----------
/**
 * 记忆插件适配器（YM 依赖注入，缺省 = 浏览器里的 `window.YuzukiMemory`）。
 * ★leg27 g：`YM` 改成**依赖注入形参**——为的是**能真测**（本仓铁律「要真 ctx 的接线，
 *   要么提成可导出函数真跑，要么写注入 fake ctx 的测试」）。下面那个 `loadState` 事故
 *   （把用户档案清空）**单测抓不到就是因为原来没法注入**。
 */
// leg29：本插件写进记忆插件的记录 id **一律以 `sw2_` 开头**（见 src/memory-bridge.js 的前缀：
//   `sw2_state` / `sw2_ev_` / `sw2_ev_open_` / `sw2_ev_span_`）。这个前缀是"我方命名空间"的边界：
//   写入时**只清我方、只看这个前缀**，非此前缀的记录一律不动（防 leg27 g 那种覆盖用户数据的复发）。
export const SW2_RECORD_PREFIX = 'sw2_';
// leg29：逻辑表名 → 插件内置表 id（两张逻辑表对应两个插件槽位；见 src/memory-bridge.js 顶部留档）
// ★leg30：**从三项收到两项**——"史卷纪要"已并入「世界大事」，不再是逻辑表（它是同一个列表里成段的行）。
export const TABLE_ID_ALIAS = {
    [MEMORY_TABLE_STATE]: PLUGIN_TABLE_STATE,
    [MEMORY_TABLE_EVENTS]: PLUGIN_TABLE_EVENTS,
};
export function memoryStore(YM = (typeof window !== 'undefined' ? window.YuzukiMemory : null)) {
    const Storage = YM?.Storage;
    if (!Storage || typeof Storage.saveState !== 'function') return null;
    const blank = () => {
        const made = YM?.VariableInjector?.createDefaultState?.();
        return made && typeof made === 'object' ? made : { tables: [], records: {}, activeRecordIds: {} };
    };
    return {
        // 读现状：插件自己的 loadState 会做规范化；读不到就用它自己的默认态（**不自己造形状**）
        //
        // ★leg27 g（用户实机「**记忆插件也没有记录事件，还把插件原来的角色档案清空了**」）：
        //   病 = 这一行原写 **`Storage.loadState?.(null, null)`**——第二参**显式传 `null`**。
        //   插件签名是 `loadState(fallbackState, sessionId = getCurrentSessionId())`，**ES 形参默认值只在
        //   `undefined` 时才生效** ⇒ 传 `null` 等于把 sessionId 定成 null ⇒ `getStorageKeys(null)` 返回空 ⇒
        //   插件开头那句 `if (!keys.length) return normalizeState(null, fallbackState);` 直接拿 null 兜底返回
        //   **非对象** ⇒ 本函数 `if (s && typeof s === 'object')` 不成立 ⇒ **退回 `blank()`**（自带表全空）⇒
        //   `writeRecords` 再走 `saveState(..., { force: true })`（**force 会跳过插件全部保护闸**）把这份空态
        //   写回 ⇒ **用户自己填的「角色档案」被逐条抹掉**（物品追踪/世界设定没填过，所以看着"还在"）。
        //   ⇒ 治法：**把那行参数传成插件自己的默认态**（即"读不到时该用的兜底"，也正是形参的本意）——
        //   `readState(null, null)` 这种"用 null 占位"的写法在本仓一律不许再用（null 不触发默认值）。
        //   铁证（本机 vm 里跑插件**真存储代码**的对照，同一夹具）：
        //     现行写法 ⇒ 投递前 character_profile 3 条 → 投递后 **0 条**（localStorage 与 chatMetadata 同时被清）
        //     修法写法 ⇒ 投递前 3 条 → 投递后 **3 条**（item_tracking/world_setting 同样原样保留）
        readState() {
            const fallback = blank();
            try {
                // 传 fallback 而**不是 `null`**：插件签名 `loadState(fallbackState, sessionId = 当前会话)`——
                // 传 null 会把 sessionId 定成 null（默认值不生效）⇒ 见上面那段事故留档。
                const s = Storage.loadState?.(fallback);
                if (s && typeof s === 'object') return s;
            } catch (err) { console.warn('[story-world-v2] 读记忆状态失败：', err?.message || err); }
            return fallback;
        },
        // 写记录：并进它的 state（表定义随首次写入一起给），再走它自己的 saveState 落盘
        writeRecords(records, { tables = [], now = Date.now() } = {}) {
            const state = this.readState() || blank();
            // ★leg29：**旧表定义也要清掉**。三张逻辑表改用插件内置 id 之后（见 src/memory-bridge.js 顶部），
            //   原来那三张自定义表（`世界状态/世界大事/史卷纪要`）若不删，插件会永远保留它们
            //   （`normalizeState` 只保留"表定义还在"的那些记录键）⇒ 侧栏里挂着三张**永远不会再更新**的空表，
            //   正是用户问的"为什么多出三个来"。只删这三个**我们自己创建的** id，别的一律不动。
            const next = {
                ...state,
                tables: (Array.isArray(state.tables) ? state.tables : []).filter((t) => !LEGACY_TABLE_IDS.includes(t?.id)),
                records: { ...(state.records || {}) },
                activeRecordIds: { ...(state.activeRecordIds || {}) },
            };
            for (const id of LEGACY_TABLE_IDS) delete next.records[id];   // 旧表的记录一并送走（插件对无表定义的记录键不收）
            // ★leg29：同 id 必须**覆盖**，不能"已存在就跳过"——插件里原本就有 `world_setting`/`item_tracking`
            //   两张内置表（带它自己的列定义）⇒ 跳过的话，**我们给的列与显示名一个字都进不去**
            //   （实测抓到的：盘上那两张表还是插件原列、侧栏还是"世界设定/物品追踪"，我们改了个寂寞）。
            //   口径：这两张表**归我们管**（记录 id 一律 `sw2_` 前缀），所以定义以我方为准；别人的表不碰。
            for (const t of tables) {
                const at = next.tables.findIndex((x) => x?.id === t.id);
                if (at >= 0) next.tables[at] = { ...t }; else next.tables.push({ ...t });
            }
            // ★leg29：**逻辑表**收进**插件内置表 id**（用户拍板「对齐插件内置表形状」；理由见
            //   src/memory-bridge.js 顶部那一段：插件 `createTableWorkspaceView` 按 `table.id` 硬编码，
            //   自定义 id 的详情视图是空 div）。映射：世界状态→world_setting、世界大事→item_tracking。
            //   ★leg30：**从三张收到两张**——"史卷纪要"并进「世界大事」（里程碑 span 折成一行，见那个文件 ②.2）。
            //   记录按 `table.id` 分组存储，同 id 的自然并成一列数组。
            const byTable = new Map();
            for (const [logical, list] of Object.entries(records)) {
                const target = TABLE_ID_ALIAS[logical] || logical;
                byTable.set(target, [...(byTable.get(target) || []), ...(Array.isArray(list) ? list : [])]);
            }
            for (const [tableId, list] of byTable.entries()) {
                const incoming = Array.isArray(list) ? list : [];
                const prev = Array.isArray(next.records[tableId]) ? next.records[tableId] : [];
                // ★leg29 修（用户实机「投递是投递了但是看不到内容 / 为什么多出三个来」查证时发现）：
                //   原来只做**按 id 合并**（push），于是：
                //   ①状态表原来每轮一个新 id（`sw2_state_<tick>`）⇒ 旧轮次**越堆越多**（真账实测三条并存）；
                //   ②大事表/史卷纪要的旧记录到轮换/退役后**永远留在插件里**。
                //   改法：**先删掉本插件自己命名空间（`sw2_`）里"这次没投"的记录，再并入本次的**——
                //   口径是"我方三张表以**本次投出的集合**为准"，同时**绝不碰任何非 `sw2_` 前缀的记录**
                //   （用户自己加的、插件自己生成的，一律原样留着——leg27 g 那次数据丢失的教训）。
                const incomingIds = new Set(incoming.map((r) => r?.id));
                const merged = prev.filter((r) => !(typeof r?.id === 'string' && r.id.startsWith(SW2_RECORD_PREFIX) && !incomingIds.has(r.id)));
                for (const rec of incoming) {
                    const at = merged.findIndex((x) => x?.id === rec.id);
                    if (at >= 0) merged[at] = rec; else merged.push(rec);
                }
                next.records[tableId] = merged;
            }
            Storage.saveState(next, next, undefined, { force: true, saveOrigin: 'story-world-v2', allowDuringSwitch: true, now });
            // ★leg29：**通知插件"状态变了"**。为什么必须做：插件窗口是从它**自己的内存缓存**
            //   （`memory-window.js` 的 `memoryState`）渲染的；我们绕过它的 UI 直接写存储，它不知道 ⇒
            //   用户看到的是**旧快照**（现象：控制台自检说记录都在、插件里却还是旧表旧列，甚至看不到内容）。
            //   插件官方留了这条通道：`window.addEventListener('yzm-memory-state-updated', reloadStateFromStorage)`
            //   ——它收到就重读存储并重绘当前页。**不是我们发明的接口，是用它自己的同步机制**。
            try {
                if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                    const ping = () => window.dispatchEvent(new CustomEvent('yzm-memory-state-updated', { detail: { source: 'story-world-v2', table: 'all' } }));
                    ping();
                    // ★leg29：**再补一次延迟重发**。为什么：插件的监听是在它自己的 UI 初始化时绑的
                    //   （`if (!window.yzmMemoryStateUpdateBound) window.addEventListener(...)`），
                    //   而用户**没打开过记忆窗口时它可能还没绑上** ⇒ 第一次派发没人接 ⇒ 它继续用内存里的
                    //   旧状态（盘上 `saveOrigin=auto` 就是它随后回写的证据）。两次派发覆盖"开着窗口"与"刚打开"两种时机。
                    if (typeof window.setTimeout === 'function') window.setTimeout(ping, 600);
                    // ★leg29：**表名校正（一次，不循环）**。为什么：插件是从它**自己的内存状态**渲染侧栏的，
                    //   而它随后会把自己那份写回存储 ⇒ 我们写的表名会被盖回去（记录值不受影响）。
                    //   用户问的是"难道每次开新聊天都要自己改吗"——**不该**。所以这里在 700ms 后
                    //   **只重写表定义里的 name**（不动任何记录），让我们的名字成为最后写入的那一个。
                    //   一次为限：不做循环对抗（那是往第三方私有状态里塞脆写法），失败也只是名字回去，不影响内容。
                    const wantNames = Object.fromEntries(tables.map((t) => [t.id, t.name]));
                    if (typeof window.setTimeout === 'function') {
                        window.setTimeout(() => {
                            try {
                                const after = window.SillyTavern?.getContext?.()?.chatMetadata?.yuzukiMemory;
                                if (!after || !Array.isArray(after.tables)) return;
                                let fixed = 0;
                                for (const t of after.tables) if (wantNames[t.id] && t.name !== wantNames[t.id]) { t.name = wantNames[t.id]; fixed++; }
                                if (!fixed) return;
                                const pluginStorage = window.YuzukiMemory?.Storage;
                                if (typeof pluginStorage?.saveState === 'function') pluginStorage.saveState(after, after, undefined, { force: true, saveOrigin: 'story-world-v2', allowDuringSwitch: true });
                                console.info(`[story-world-v2] 记忆自检：表名被插件覆盖过，已校正 ${fixed} 张（${Object.values(wantNames).join(' / ')}）`);
                            } catch (_) { /* 校正失败只是名字，不影响内容 */ }
                        }, 700);
                    }
                }
            } catch (_) { /* 插件不在/浏览器不支持 ⇒ 静默：世界推进永远优先 */ }
            // ★leg29：**派发完再看一眼**，把"插件有没有把它自己那份缓存盖回来"记下来（只读，不改任何东西）。
            //   真存储代码复演证明我们写出去的那份是对的 ⇒ 若此刻盘上表名不是我们的，就是**插件随后覆盖**，
            //   而不是我们写错。留痕是为了下一次不用再猜。
            try {
                if (typeof window !== 'undefined') {
                    const after = window.SillyTavern?.getContext?.()?.chatMetadata?.yuzukiMemory;
                    const nameOf = (id) => (after?.tables || []).find((t) => t.id === id)?.name;
                    if (nameOf(PLUGIN_TABLE_STATE) !== undefined && nameOf(PLUGIN_TABLE_STATE) !== DISPLAY_NAME_STATE) {
                        console.info(`[story-world-v2] 记忆自检：表名被插件覆盖回去了（现为「${nameOf(PLUGIN_TABLE_STATE)}」，期望「${DISPLAY_NAME_STATE}」）——记录值不受影响`);
                    }
                }
            } catch (_) { /* 纯留痕，失败无所谓 */ }
        },
    };
}

// ★leg27 i：导出是为了**能真测**（leg27 i 的事故恰恰是"投递其实跑完了、只在成功日志那行抛
//   `MEMORY_TABLE_MILESTONES is not defined`，被调用点的 `.catch(() => {})` 吞掉 ⇒ 插件里什么都没有"）。
//   判据必须走**真函数**——只调 `markMemoryPush`（喂现成结果）永远抓不到那条路。
//   ★leg30：那条事故的常量已删（前史不再是表）⇒ 成功日志改为只报**实际投出的两张表**的条数；
//   本函数仍必须走真路径，判据也就仍能抓到"日志行抛异常"这一类事故。
export async function pushMemoryNow(world) {
    try {
        if (!world) return { ok: false, reason: 'no-world' };
        const store = memoryStore();
        if (!store) return { ok: false, reason: '插件未加载（柚月の记忆）' };
        const r = pushToMemory(buildMemoryPayload(world), { store });
        if (!r.ok) console.warn('[story-world-v2] 记忆投递未成：', r.reason);
        else console.info('[story-world-v2] 记忆已投：', { [MEMORY_TABLE_STATE]: r.tick, 世界大事: (r.counts || {})[MEMORY_TABLE_EVENTS] ?? 0 });
        return r;
    } catch (err) {
        console.warn('[story-world-v2] 记忆投递异常（已忽略，世界照常）：', err?.message || err);
        return { ok: false, reason: String(err?.message || err) };
    }
}

// ★leg29：**只读自检**（给排查用，不改任何状态）。
//   为什么需要它：实机出现"控制台说记忆已投，但插件里看不到、盘上也没变"的矛盾——
//   而盘上那份是被 `saveChat()` 落盘的**运行时对象**，只有浏览器内存里那一刻的真相能回答"到底写没写进去"。
export function memoryStoreReport(YM = (typeof window !== 'undefined' ? window.YuzukiMemory : null)) {
    try {
        // ★leg30 修：这里原来**直接写 `window.SillyTavern`**——本模块其余地方一律用
        //   `typeof window !== 'undefined'` 守卫（见 `memoryStore`），只有这一处漏了 ⇒ 在任何非浏览器环境
        //   （Node 测试、vm 复演）里第一步就抛 `ReferenceError: window is not defined`，
        //   被本函数的 catch 吞成一个 `{报错: ...}` ⇒ **这条自检从此永远不可测、也永远报不出东西**。
        //   这正是它该被抓到的地方：判据要能真跑，不能只在浏览器里"应该没问题"。
        const ctx = (typeof window !== 'undefined' ? window.SillyTavern?.getContext?.() : null);
        const state = ctx?.chatMetadata?.yuzukiMemory ?? YM?.Storage?.loadState?.(YM?.VariableInjector?.createDefaultState?.()) ?? null;
        const records = state?.records || {};
        const count = (id) => (Array.isArray(records[id]) ? records[id].length : 0);
        const mine = (id) => (Array.isArray(records[id]) ? records[id].filter((r) => String(r?.id || '').startsWith('sw2_')).length : 0);
        // ★leg30：**语义自检**——"位置列里装的是人名吗？"（用户实机截图一眼看出的那件事）。
        //   为什么放进自检而不是只做单测：这个病**在单测里结构上不可能红**（旧判据只锁列名形状与条数，
        //   列名对、条数对 ⇒ 538/538 全绿照样乱）。把判据接进投递路径，下一棒不用再靠肉眼发现。
        //   口径：①表是插件内置表、可能同时装着别人的记录 ⇒ **只看我方 `sw2_` 的记录**；
        //   ②位置可能是一**串**（旧代码把波及名单整串写进去）⇒ 逐个片段对，不做整串相等比较
        //   （整串比较会漏掉 `薛铁衣、大虞` 这种真病——本条判据的第一版就是这么假绿的）。
        const splitNames = (v) => String(v || '').split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
        const semanticIssues = (() => {
            const out = [];
            const evRows = (Array.isArray(records[PLUGIN_TABLE_EVENTS]) ? records[PLUGIN_TABLE_EVENTS] : [])
                .filter((r) => String(r?.id || '').startsWith(SW2_RECORD_PREFIX));
            // 插件自己的角色档案里那一列叫「姓名」（见 ui/memory-window.js 的角色表列定义）；
            //   另外两个名字是我们自己可能用过的写法，一并认（认不出就退化成空集 ⇒ 自检不出声，不假报）。
            const names = new Set((state?.records?.character_profile || []).flatMap((r) => {
                const v = r?.values?.['姓名'] ?? r?.values?.['角色名'] ?? r?.values?.['名字'];
                return splitNames(typeof v === 'string' ? v : '');
            }));
            for (const r of evRows) {
                const where = String(r?.values?.['物品位置'] || '').trim();
                if (!where) continue;
                const hit = splitNames(where).find((part) => names.has(part));
                if (hit) out.push(`「${r?.values?.['物品名称'] || '?'}」的位置列写着人名「${hit}」`);
            }
            const ids = evRows.map((r) => r?.id);
            if (new Set(ids).size !== ids.length) out.push('发生表有重复 id（插件按 id 合并，重复即覆盖）');
            return out;
        })();
        return {
            我方两张表的记录在不在: {
                [`${PLUGIN_TABLE_STATE}(世界状态)`]: `${mine(PLUGIN_TABLE_STATE)} 条（共 ${count(PLUGIN_TABLE_STATE)}）`,
                [`${PLUGIN_TABLE_EVENTS}(世界大事)`]: `${mine(PLUGIN_TABLE_EVENTS)} 条（共 ${count(PLUGIN_TABLE_EVENTS)}）`,
            },
            语义自检: semanticIssues.length ? semanticIssues : '无异常（位置列没混进人名、记录 id 不重复）',
            旧的自定义表: LEGACY_TABLE_IDS.map((id) => `${id}: 表定义=${(state?.tables || []).some((t) => t.id === id) ? '在' : '已删'}，记录 ${count(id)} 条`),
            表清单: (state?.tables || []).map((t) => `${t.id}(${t.name})`),
            状态记录的值: (records[PLUGIN_TABLE_STATE] || []).find((r) => r?.id === 'sw2_state')?.values ?? '(没有 sw2_state 这条)',
            事件记录首条: (records[PLUGIN_TABLE_EVENTS] || []).find((r) => String(r?.id || '').startsWith('sw2_ev_'))?.values ?? '(没有 sw2_ev_ 记录)',
            saveOrigin: state?.saveOrigin,
            updatedAt: state?.updatedAt,
        };
    } catch (err) {
        return { 报错: String(err?.message || err) };
    }
}

// ★leg29：**投完当场自检的一行**（接在推送路径上，随每次投递打出）。
//   为什么做成一行：实机排查时"手抄控制台多行对象"反复丢失输出——一行纯文本，好抄也好贴。
//   只报事实：我方命名空间的记录在不在、旧表删没删；**不做任何写入**。
// ★leg30：**可注入**（`YM` 形参）——理由与 `memoryStore` 当初改注入形参一样：判据要能**真跑**。
//   这条自检的语义判据（"位置列里有人名吗"）若不能真跑，就等于又把它交回给肉眼。
export function memoryStoreCheckLine(YM = (typeof window !== 'undefined' ? window.YuzukiMemory : null)) {
    const r = memoryStoreReport(YM);
    if (r?.报错) return `[story-world-v2] 记忆自检失败：${r.报错}`;
    const mine = r.我方两张表的记录在不在 || {};
    const legacyOn = (r.旧的自定义表 || []).filter((x) => x.includes('表定义=在'));
    // ★leg29：**表名也要报**。为什么：插件是从**它自己的内存缓存**渲染侧栏的，而它自己的定时/落盘会把
    //   那份缓存写回存储 ⇒ 我们写的表名可能被覆盖回去（真存储代码复演证明"我们写的那份是对的"，
    //   所以一旦盘上名字不对，就是被它盖回去了）。把名字打进自检，一眼可见。
    const names = (r.表清单 || []).filter((x) => x.startsWith('world_setting') || x.startsWith('item_tracking')).join(' ');
    // ★leg30：**语义异常也进这一行**（位置列混进人名之类）——它此前只能靠用户肉眼发现。
    const sem = r.语义自检;
    const semBit = Array.isArray(sem) && sem.length ? ` ｜ ⚠ 语义：${sem.join('；')}` : '';
    return `[story-world-v2] 记忆自检：world_setting=${mine['world_setting(世界状态)'] ?? '?'} ｜ item_tracking=${mine['item_tracking(世界大事)'] ?? '?'} ｜ 表名 ${names} ｜ 旧表残留 ${legacyOn.length} 张 ｜ saveOrigin=${r.saveOrigin ?? '?'}${semBit}`;
}

// ★leg27 h：记忆投递**自证面**（用户两次靠肉眼发现它没生效 ⇒ 这功能此前没有可查的痕迹）。
//   口径：只报**事实**（投了第几轮 / 几条 / 或失败原因），不确定的一律不显示。
//   `null` = 本轮没投（开关关着，或还没推过）——**不显示"已投"**，免得变成假绿。
let sw2MemoryPush = null;
// ★leg40b（第二刀 · 死代码）：`memoryPushStatus()` 已删——它零调用（现役的是下面这个 `memoryPushLine()`，
//   状态栏与参数页都走它）。同一个事实只留一条读法，免得以后两条路各写各的口径。
export function markMemoryPush(result, tick) {
    sw2MemoryPush = result?.ok
        ? { ok: true, tick: result.tick || (Number.isFinite(tick) ? `第 ${tick} 轮` : ''), counts: result.counts || {}, at: Date.now() }
        : { ok: false, reason: result?.reason || '未知原因', at: Date.now() };
    return sw2MemoryPush;
}
/** 一行事实（给状态栏/面板用）；没投过就不出声 */
export function memoryPushLine() {
    const m = sw2MemoryPush;
    if (!m) return '';
    return m.ok ? `记忆已投 · ${m.tick} · 大事 ${m.counts[EVENTS_TABLE_NAME] ?? 0} 条` : `⚠ 记忆投递未成：${m.reason}`;
}

// ★★★leg72：**这块状态的两个受控通道**（外面只许走它们，不许直接读写 `sw2MemoryPush`）。
//   为什么必须有：搬走之后 `web/index.js` 在**块外**仍有 4 处引用（`renderCfg` 注入自证面 ·
//   插件主开关"关掉即归零"两处 · 载入期一处）。两种做法里选了这一种：
//     ①状态留在 index.js、由 index.js 传进来 ⇒ "记忆的状态"住在别人家；
//     ②状态留在本文件、只给两个函数出去 ⇒ **状态与它的读法同处一地**。口径是②。
/** 读记忆投递的那份自证面（渲染层要的读数；`null` = 本轮没投过）。只读，拿到的对象不许就地改。 */
export function readMemoryPush() {
    return sw2MemoryPush;
}
/** 清掉自证面（插件总闸关掉时用：不许留着上一次的"已投"冒充本次）。 */
export function clearMemoryPush() {
    sw2MemoryPush = null;
}
