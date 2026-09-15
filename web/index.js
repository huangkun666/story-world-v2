// story-world-v2/web/index.js
// K30 骨架 + K34 渲染接线（编排层·浏览器侧）：ST 插件入口——面板挂载 + 八页签渲染刷新。
// 范式实读 v1（manifest/js/settings.html/ui.js）后仿写，命名空间 sw2_ 全隔离：
//   ① settings.html 模板经 ctx.renderExtensionTemplateAsync 注入（缺模板有最小回退窗）；
//   ② 扩展菜单「魔杖」入口挂 extensionsMenu；③ 弹窗 z-index 压顶内联规则（id 特异性）；
//   ④ css 带版本查询防浏览器缓存吞修复；⑤ 全局错误网进状态条。
// K34 渲染接线：refreshWorld(world, {config, oldVolumes}) 把 render.js 纯函数产物填入页签；
//   面板零第二份状态（A-2 语义）；按钮走 data-action 委托 → window.__sw2Actions（K36 接调度，
//   当前为占位提示）。纪律：模块顶层零 DOM（node --test 可动态导入；browser-compat 扫描覆盖）。
import { renderAll, renderVolumeReadHtml, renderChainViewHtml, LABELS, PANEL_BUILD, makeEntsView } from '../src/render.js';
import { expandChain } from '../src/chain.js';
import { migrateLegacyAttrs } from '../src/settle.js';   // leg24 片4：旧账一次性清理（读到热账后、渲染前）
import {
    hotAccountShape, loadHotAccount, planChronicleRotation, countLedgerEntries,
    volumeToChronicleRows, buildExportBundle, verifyImportBundle,
} from '../src/storage.js';
import { seedBookEntities, extractWorldSetting, applySettingToSsot, resetDynamicLayer, describeProgress } from '../src/abstract.js';
// ★leg40：从世界源起根（把书里"正在发生的事"落成账上的线头事件；幂等、可重入、失败零阻塞）
import { seedRootsChunked, chunkBookText, SEED_ROOTS_MAX, SEED_CANDIDATES_TOP, SEED_CHUNK_CHAR } from '../src/seed-roots.js';
// leg24 片1（停抄书）：runAttrsRound / runRelationRound / applyRosterAttrs / refineEntityAttrs 四个入口随
// 「抄书流水线」整条删除（名册里不再有从书里抄来的属性/隶属，补抽按钮与 bus 动作同批下掉）。
// bookFingerprint 的浏览器侧唯一用途是补抽前的指纹守卫，随之删除（书指纹仍由 extractWorldSetting 写进 setting）。
import { createIdbVolumeStore, createIdbSnapshotStore } from './idb-backend.js';
import { describeSnapshots, planStep, planRetention, restoreFrom } from '../src/snapshot.js';   // leg27 后：快照容错（纯逻辑在 src，本层只编排）
import { createTickQueue } from '../src/async-tick.js';
import { runTick } from '../src/tick.js';
import { resolveBrowserTransport, EXTRACTION_MAX_TOKENS } from '../src/transport-config.js';
import { composeInitSource, normalizeEntryKey } from '../src/init-source.js';
// 细案 spec-entity-field-lookup（用户 2026-09-11 批准）：按需查书补字段（实力/位置）+ 两条 ≤15。
// 本层只负责"取世界书原文 + 落盘"，选择/查询/回写的判据全在 src/entity-lookup.js（纯编排层，可 Node 测）。
// ★leg46：档位/开关/上限三张表**不再在本文件里判**（归一与白名单都在 `src/param-hub.js` 一处）
//   ⇒ 这里只留 `switchOn`（闸的读法：只有显式 '1' 算开）。
import { switchOn } from '../src/params.js';
// ★★参数从世界账里搬出来（leg41 立、leg46 收口）：真源 = 插件自己的存储，
//   世界账的 `dynamic.env` 降级为**镜像**（引擎照旧读它）。本文件只用它的两个只读小工具：
//   `isParamStoreKey`（判"这个键是不是参数"——快照闸要用）与 `normalizeStore`（读旧迁移用）。
import { isParamStoreKey, normalizeStore, PARAMS_SETTINGS_KEY } from '../src/param-store.js';
// ★★★leg46（用户令「重构代码吧，我已经没有耐心了」）：**参数全生命周期收进一个模块**。
//   本文件从此**只留接线**：面板取 `hub.displayEnv()`、改动调 `hub.set(world,key,value)`、
//   载入调 `hub.commit(world)`。写存储/回读核对/镜像/撤销/自证面**一律不再出现在本文件里**
//   （旧的五处写入口 —— `sw2PersistParamEnv` / `sw2WriteParamBucket` / `paramUndo.write` /
//     载入接纳 / 快照前补镜像 —— 连同它们的"各自现算一次世界名"一起删掉）。
import { createParamHub, PARAMS_LS_KEY } from '../src/param-hub.js';
// leg26 b：记忆投递（引擎事实 → 记忆插件）。★leg27 i：这条 import 一旦少了**任何**被用到的常量——
//   漏了它会让**成功日志那一行**抛 ReferenceError，而调用点的 `.catch(() => {})` 把错误吞掉 ⇒
//   投递其实写完了、插件里却什么都没有（用户实机报「上次投递失败：MEMORY_TABLE_MILESTONES is not defined」）。
//   ★leg30：`MEMORY_TABLE_MILESTONES`（史卷纪要）**已从 src/memory-bridge.js 删除**——"前史"不再是第三张表，
//   它是「世界大事」里**成段的行**（里程碑的 span 折成一行 `第 1–10 轮 · 前史`），理由见那个文件顶部 ②.2。
import { buildMemoryPayload, pushToMemory, MEMORY_TABLE_STATE, MEMORY_TABLE_EVENTS, PLUGIN_TABLE_STATE, PLUGIN_TABLE_EVENTS, LEGACY_TABLE_IDS } from '../src/memory-bridge.js';
const EVENTS_TABLE_NAME = MEMORY_TABLE_EVENTS;   // leg27 h：自证面里要报"大事几条"（表名只在这里取一次，防两处漂移）
import { runEntityLookupStep, runBatchLookup, pickOneForLookup, planBatches, deriveLocationFromBook } from '../src/entity-lookup.js';

const NAMESPACE = 'STORY_WORLD_V2';
const VERSION = '0.1.0';
const WINDOW_ID = 'story_world2_window';
// leg26：参数独立页签；leg27 后：第八页签「快照」
const SECTIONS = ['board', 'chronicle', 'archive', 'entities', 'setting', 'params', 'snapshots', 'settings'];
// K33 板式：board = 五块对象（时局句/信息带/盘算总览/动态流/位置速览），DOM 组装在接线层
const BOARD_BLOCK_ORDER = ['digest', 'infoband', 'agendaStrip', 'feed', 'side'];
const CSS_HREF = new URL('./style.css', import.meta.url).href;
// ★leg40b（面板本体体检 · 第一刀 + 第二刀）：CSS 也动了（.sw2-env-row 去掉了那条恒真的档位条
//   ⇒ 相关规则失效；空态与卡片的间距随文案收短而变）⇒ 版本号必须往前走，否则浏览器吃旧样式。
// ★leg40c 续（落盘口径那一刀）：界面**文案真变了**（状态条新增"账上本来就是它，无需改动 · 已落盘"一句、
//   世界尺度卡新增构建号一行）⇒ 按 leg29 规矩升位，否则浏览器吃旧 CSS 时那句会排得难看。
// ★★★leg48（用户令「我给你一次机会解决这个bug」）：构建号 → `leg48b-params-page-clean`。
//   ★玩家可见面真的变了：**参数页撤掉了「自检」卡与「🔍 复制自检」按钮**（用户令「把自检也删了，参数页签的」
//     ·「不要在参数界面出现」）⇒ CSS 同步升位。
//   这一棒的现场是**真浏览器 + 真面板代码**跑出来的（见 docs/session-handoff-2026-09-16-leg48.md §2）：
//   写入一直是好的，坏的是"读"——面板按**另一个桶/滞后一拍的镜像**把玩家选的值盖了回去。
// ★leg49（细案 spec-entities-page-ia）同步升位：实体页版式整套换了（三列 + 工具条 + 分组 + 分页），
//   `web/style.css` 里的规则增删一起走 ⇒ CSS 版本号必须跟着升，否则浏览器缓存旧样式
//   （"页面是新代码、样式是旧的"正是这一串要治的病）。与 `PANEL_BUILD` 同批。
//   ★名字随 `PANEL_BUILD` 一起被评审修正过（原名 `…-leg49-entities-three-cols` 含 `entity`，
//   与"玩家可见文本零引擎术语"那条锁对撞 ⇒ 用户拍板改名 `leg49-three-column-roster`）。
// ★终审修正（`-f1`）：`web/style.css` 又动了（删 10 条零生产者旧版式规则 + 补工具条那三处声明）
//   ⇒ 照本文件顶上那条纪律（"CSS 动了就必须升位，否则浏览器吃旧样式"）往前走一格。
//   ★`PANEL_BUILD` **不动**：它是用户验收第①步的判据（印在参数页最下面那行上），本笔的修正不该改它；
//     这两个版本号本来的关系是"同批升位"，不是"必须同一串"。
// ★工具条排布定稿（用户实拍截图 +「这个角色和势力这个位置比较乱」⇒ 拍板「就乙吧」）：
//   `web/style.css` 又动了（新增 `.sw2-ents-g` / `.sw2-ents-gl` / `.sw2-ents-g-q` 三条、删掉被标签替代的
//   `.sw2-ents-grp`）⇒ 照同一条纪律再往前走一格。`PANEL_BUILD` 仍**不动**（同上：它是验收判据）。
const CSS_VERSION = '20260916-leg49-three-column-roster-f2';

// leg24 片1：leg21 增量补抽的会话态（refining / refinedFailed / refinedFp / syncRefinedFp）随补抽入口一并删除

export const sw2Version = () => VERSION;
// ★leg40b（第二刀 · 死代码）：`sw2TabState(name, active)` 已删——它是 `{ name, active }` 的恒等包装，
//   生产零调用（只有 `test/browser-compat.test.js` 拿它当"模块能载入"的探针用）。
//   该用例的真实目的（web/index.js 顶层零 DOM、Node 可载）由紧随其后的 `sw2Version()` 承担，探针随之改。

function getCtx() {
    if (typeof window === 'undefined') return null;
    try {
        return window.SillyTavern?.getContext ? window.SillyTavern.getContext() : null;
    } catch (_) {
        return null;
    }
}

function onWinError(e) {
    try {
        const msg = String(e?.message || e?.reason?.message || e?.reason || '未知异常');
        const el = document.getElementById('sw2_status_text');
        if (el) el.textContent = `⚠ 未捕获异常：${msg}`;
        console.warn('[story-world-v2]', msg);
    } catch (_) {}
}

function injectCss() {
    try {
        for (const link of document.querySelectorAll('link[data-sw2css]')) link.remove();
        const el = document.createElement('link');
        el.rel = 'stylesheet';
        el.dataset.sw2css = '1';
        el.href = `${CSS_HREF}?v=${CSS_VERSION}`;
        document.head.appendChild(el);
    } catch (_) {}
}

// 弹窗压顶内联规则（v1 同款：id 特异性保证任何加载顺序下固定位、压过 ST 自身弹层）
function modalBoost() {
    try {
        const style = document.createElement('style');
        style.textContent = `#${WINDOW_ID}{position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;z-index:50000;display:none;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;background:rgba(13,16,21,.55)}`
            + `#${WINDOW_ID}.sw2-open{display:flex}`;
        document.head.appendChild(style);
    } catch (_) {}
}

function dedupWindows() {
    try {
        const wins = document.querySelectorAll(`#${WINDOW_ID}`);
        for (let i = wins.length - 1; i > 0; i -= 1) wins[i].remove();
    } catch (_) {}
}

const FALLBACK_WINDOW = `<div id="${WINDOW_ID}" class="sw2-window-mask">
  <div class="sw2-window">
    <header class="sw2-header">
      <div class="sw2-badge">棋</div>
      <div class="sw2-title-block">
        <div class="sw2-title">观棋窗口</div>
        <div class="sw2-subtitle">Story World v2</div>
      </div>
      <div class="sw2-close" id="sw2_window_close">&#10005;</div>
    </header>
    <div class="sw2-statusbar"><span class="sw2-dot"></span><span class="sw2-main" id="sw2_status_text">模板加载失败回退窗 · 完整面板需 settings.html</span></div>
    <div class="sw2-placeholder">settings.html 模板不可用（回退形态）。</div>
  </div>
</div>`;

function ensureWindow(ctx) {
    if (document.getElementById(WINDOW_ID)) return Promise.resolve();
    return ctx.renderExtensionTemplateAsync('third-party/story-world-v2', 'settings')
        .then((html) => {
            if (html && !document.getElementById(WINDOW_ID)) {
                document.body.insertAdjacentHTML('beforeend', html);
            } else if (!document.getElementById(WINDOW_ID)) {
                document.body.insertAdjacentHTML('beforeend', FALLBACK_WINDOW);
            }
            dedupWindows();
        })
        .catch(() => {
            if (!document.getElementById(WINDOW_ID)) {
                document.body.insertAdjacentHTML('beforeend', FALLBACK_WINDOW);
            }
            dedupWindows();
        });
}

function openWindow() {
    const win = document.getElementById(WINDOW_ID);
    if (!win) return;
    win.classList.add('sw2-open');
    document.getElementById('sw2_window_close')?.focus?.();
    const menu = document.getElementById('extensionsMenu');
    if (menu) menu.style.display = 'none';
}

function closeWindow() {
    document.getElementById(WINDOW_ID)?.classList.remove('sw2-open');
    // ★细案实体页：视图态随关面板重置（照 `sw2ChronicleFilter` 的口径"纯视图态、关面板重置"）
    sw2EntsViewReset();
    const menu = document.getElementById('extensionsMenu');
    if (menu) menu.style.display = '';
}

function ensureWandEntry() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('sw2_wand_container')) return;
    const container = document.createElement('div');
    container.id = 'sw2_wand_container';
    container.className = 'extension_container';
    container.innerHTML = `<div id="sw2_world_wand" class="list-group-item flex-container flexGap5 interactable" title="打开观棋窗口">
        <div class="fa-solid fa-chess-board extensionsMenuExtensionButton"></div><span>观棋窗口</span></div>`;
    menu.appendChild(container);
    container.addEventListener('click', openWindow);
    const btn = document.getElementById('extensionsMenuButton');
    if (btn) btn.style.display = 'flex';
}

function setStatus(text) {
    const el = document.getElementById('sw2_status_text');
    if (el) el.textContent = text;
}

// ★★leg40c 续（用户实机「只是展开下拉就弹一句，点了还是改不了值」）：
//   **任何一次重绘都会把参数页的 `<select>` 整个销毁重建**（`innerHTML = ...`），
//   而浏览器**已展开的原生下拉属于那个被销毁的节点** ⇒ 列表当场关掉、那一次的点击作废。
//   这是 leg27 那条"下拉自己关"的同族病：那条只治了 `set-param` **之后**的自重绘，
//   而 `refreshWorld`（推进一轮 / 载入世界 / 回快照 / 刷新快照清单）**任何一刻都可能来**。
//   ⇒ 治法：**玩家手下有活控件时不换那一页的 DOM**——把这次重绘**押后**，控件失焦时补。
//   ★位置必须在 `refreshWorld` **之前**（它也要用这两个东西；放后面就是 TDZ 当场炸——
//     本仓 leg40c 已经为"循环依赖 + TDZ"吃过一次 653 条判据一片红）。
const pendingSectionRefresh = new Set();
let sw2SectionRefreshRunning = false;   // 重绘**自己**会夺走焦点 ⇒ 会再触发一次 focusout ⇒ 必须防重入
function playerIsTouchingParams() {
    try {
        const el = document.activeElement;
        if (!el) return false;
        const tag = String(el.tagName || '').toUpperCase();
        const isCtl = tag === 'SELECT' || tag === 'INPUT' || tag === 'BUTTON';
        return isCtl && !!el.closest?.('#sw2_view_params, #sw2_view_settings, .sw2-tabs');
    } catch (_) { return false; }
}
if (typeof document !== 'undefined') {
    document.addEventListener('focusout', () => {
        if (!pendingSectionRefresh.size) return;
        setTimeout(() => {
            if (playerIsTouchingParams()) return;   // 手还在控件上（跳到另一个控件）⇒ 继续押后
            if (sw2SectionRefreshRunning) return;   // 重绘自己正在跑（它会夺焦点 ⇒ 别再自己咬自己）
            const names = [...pendingSectionRefresh];
            pendingSectionRefresh.clear();
            console.info('[story-world-v2] 控件已失焦 —— 补上押后的重绘：', names.join('、'));
            refreshSections(names);
        }, 0);
    }, true);
}

// ---------- K34：渲染接线（纯函数产物 → DOM；面板零第二份状态） ----------
export function refreshWorld(world, { oldVolumes = [] } = {}) {
    if (typeof document === 'undefined') return;
    const win = document.getElementById(WINDOW_ID);
    if (!win) return;
    try {
        // ★★leg40b（A2 · 体检修）：这里原有一个 `config` 形参，算出的 `cfg` **从未被用过**
        //   （下一行硬调 `renderCfg()`）⇒ 任何调用方传进来的 config 都被**静默丢弃**。
        //   "忘了加参数不报错"是这类静默丢弃最坏的地方：以后往 config 塞一个开关，面板会安静地不认。
        //   现在把这个形参撤掉，只留**一条**配置路：`renderCfg()`（= 活设置 + 任务/快照/记忆自证）。
        //   判据同步：`test/render.test.js` 里那条"不许整页重绘"的用例仍锁 `renderCfg()` 这条真路。
        sw2LastWorld = world;   // K41：链视图入口持引用（同一对象，零第二份状态）
        // leg25 d：批量补全进度随 config 进渲染层（渲染层不碰任务状态——面板零第二份状态纪律）
        // leg27 后：快照清单同理（config.snapshots = IDB 读回的元信息 + 一行事实摘要）
        // leg27 h：记忆投递自证面同理（config.memoryPush = 上一次投递的实测结果）
        // ★★★leg46 续·十（**用户第五次实机："我改了值旁边直接变成未定" ⇒ 不再有"两个来源"**）：
        //   参数页**整块按 `paramEnv` 画**（下拉与格一起画，它们天然一致），**再按控件对齐一遍格**。
        //   把清单里不存在的键也一起交给渲染层 ⇒ 渲染层不会画"默认"小标（那个小标本身就在误导玩家：
        //   "默认"与"你改的值"在同一格里分不清）。
        const live = sw2CollectLiveParamValues();
        const cfgForRender = renderCfg(live.env ? { paramEnv: live.env } : {});
        const out = renderAll(world, { config: cfgForRender, oldVolumes, view: { chronicleFilter: sw2ChronicleFilter, entsView: sw2EntsView } });
        // ★★leg46 续·六（**格与控件同源**）：页面刚用 `cfg.paramEnv` 画完 ⇒ 顺手用**同一份**把显示格对齐。
        //   为什么必须用同一份（用户第四次实机：四个下拉都选对了、四格却写「未定」）：格若自己去读第二遍真源，
        //   就会与控件错开一个时刻（读到空 ⇒ 写「未定」），看起来就像"什么都没生效"。
        // ★★leg46 续·十：整页画完之后**按控件对齐格**（格的字只从同一行的控件读 ⇒ 永不分叉）。
        //   真源与控件是否一致，交给自检卡去报（它才是说这件事的地方）。
        try { sw2SyncParamCells(); } catch (_) {}
        const chipWorld = win.querySelector('#sw2_world_chip');
        if (chipWorld) chipWorld.textContent = `世界：${out.header.world || '—'}`;
        const chipTick = win.querySelector('#sw2_tick_chip');
        if (chipTick) chipTick.textContent = out.header.tick;
        for (const name of SECTIONS) {
            const el = win.querySelector(`#sw2_view_${name}`);
            if (!el) continue;
            // ★★leg40c 续：**不许在玩家手下抢 DOM**（见 `refreshSections` 的注释）。
            //   这里押后的是**当前那一页**：玩家正拉开下拉/按着按钮时，那一页的 innerHTML 一换，
            //   原生下拉当场关闭、那一次点击作废 —— 用户看到的正是"点了还是改不了值"。
            //   口径：其余页照常刷新（观棋页照旧随每轮更新），押后的那页在失焦时补上。
            if (playerIsTouchingParams() && el.contains(document.activeElement)) {
                pendingSectionRefresh.add(name);
                console.info(`[story-world-v2] ${name} 页上有控件正被操作 —— 本轮整页刷新押后该页`);
                continue;
            }
            if (name === 'board') {
                // 2026-09-08 实机冒烟发现：board 是五块对象，直填 innerHTML 会渲染成 [object Object]
                el.innerHTML = typeof out.board === 'string'
                    ? out.board
                    : BOARD_BLOCK_ORDER.map((k) => (out.board && out.board[k]) || '').join('');
            } else {
                el.innerHTML = out[name];
            }
        }
        refreshSettingsHints(); // 密钥 placeholder 随渲染刷新（表单值由 cfg 注入）
        // 第十三棒：每轮进展计数——「编年 +N 行」直接区分模型空步 vs 引擎未落账（账目可读性）
        const chronicleLen = Array.isArray(world.chronicle) ? world.chronicle.length : 0;
        const delta = sw2PrevChronicle == null ? null : chronicleLen - sw2PrevChronicle;
        sw2PrevChronicle = chronicleLen;
        // leg27 h：记忆投递自证面随同一句状态栏出声（**它才是最后写状态栏的那一处**）
        const memLine = memoryPushLine();
        // ★leg32f：本轮的**丢弃/裁定**也要出声（用户为了「演算失败：必填缺失 / 同名实体」吃过整步被拒的苦）——
        //   口径：只报**计数**（细节看观棋·动态流的「本轮裁定 N 条」），没丢就不出声（不留恒显示的噪声）。
        const lastLog = Array.isArray(world?.meta?.simLog) ? world.meta.simLog[world.meta.simLog.length - 1] : null;
        const lastWarns = Array.isArray(lastLog?.warnings) ? lastLog.warnings : [];
        const droppedNow = lastWarns.filter((x) => typeof x === 'string' && (x.startsWith('提议丢弃') || x.startsWith('裁定:') || x.startsWith('校验拒绝:'))).length;
        const dropLine = droppedNow ? ` · ⚖ 本轮丢/拒 ${droppedNow} 条提议（细节见动态流）` : '';
        setStatus(`已同步 · 刚演完 ${out.header.tick}${delta == null ? '' : ` · 编年 ${delta >= 0 ? '+' : ''}${delta} 行`}${dropLine}${memLine ? ` · ${memLine}` : ''} · 窗口只读，不参与剧情`);
    } catch (err) {
        setStatus(`⚠ 渲染失败：${err?.message || err}`);
        console.warn('[story-world-v2] render failed:', err);
    }
}

// ---------- K34/K36：按钮委托（真实调度：advance-world 已接队列；其余走动作总线） ----------
// ★leg40b（A3 · 体检修）：**兜底那句原来会把引擎术语印到玩家眼前**——
//   面板渲染与 `window.__sw2Actions` 装配之间存在一个窗口（模板先到、总线后到），
//   在这个窗口里点任何动作都会走到下面那一行，于是状态条打出「「lookup-entity」接线随后续步骤（当前为占位）」：
//   既漏了英文动作名，又违反本仓 A-3「玩家可见文本零引擎术语」。现在兜底改成人话，并把动作名收进控制台。
//   （`player-desc` 那个历史残留的 data-action 已撤，见 render.js 设置页那段注释。）
function dispatchAction(action, payload, event) {
    const bus = typeof window !== 'undefined' ? window.__sw2Actions : null;
    if (bus && typeof bus[action] === 'function') {
        bus[action](payload, event);
        return;
    }
    if (action === 'advance-world' && sw2TickQueue) {
        sw2TickQueue.advance().catch(() => {}); // K36 手动补推（A-4 手动路径）
        return;
    }
    console.warn('[story-world-v2] 面板还没装配完，这一下没接上：', action);
    setStatus('⏳ 面板刚打开、还没装配完 —— 稍等一拍再按一次（世界没有动）');
}

// ---------- K35：存储层接线（热账=chat metadata；冷档=IndexedDB 卷） ----------
const HOT_META_KEY = 'story_world_v2';
const EXPORT_FILENAME = 'story-world-v2-export.json';

// 首开空态世界（形状合法=render 契约；K34 防御口径：空世界=各数组为空，不是裸 {}）
const EMPTY_WORLD = Object.freeze({
    version: 1,
    context: { world: '', tension: 0.5, positions: [] },
    entities: [],
    weights: {},
    agendas: [],
    events: [],
    chronicle: [],
    milestones: [],
    meta: { tick: 0, simLog: [] },
});

// v1 教训（adapter.js）：ctx.chatMetadata 是取用时的引用快照，聊天切换后过期——
// 每次读/写热账都重新取最新 context。
function freshCtx() {
    return getCtx();
}

function readHotMeta() {
    const ctx = freshCtx();
    return ctx?.chatMetadata?.[HOT_META_KEY] ?? null;
}

// ---------- ★leg33d：插件总闸（用户令「加一个启动和关闭插件的入口，要不然这个插件会直接自动生效」）----------
// 设计口径三条，都要能机械核：
//   ① **总闸只管"自动"**：关掉之后——发消息不自动推进、切聊天不自动载入世界。**手动永不被闸**：
//      观棋窗口照常打开、面板照常渲染、「推进一轮」照常能按（那是你明确要求的动作）。
//   ② **缺省关**（`params.js` 的 `SWITCH_PARAMS.autoAdvance.def = '0'`）——照本仓开关惯例（`memoryEnabled` 也是 def='0'）
//      ⇒ "装上/载入即静默"，正对用户原话。
//   ③ ★**但存量世界要给一次性迁移**：真账实测用户现存世界 `memoryEnabled='1'`＝**正在用它**；
//      若升级后因为"缺键=关"就悄悄停掉，等于把正在跑的世界按停——那是事故，不是功能。
//      故：**该世界已有推进史（`meta.simLog` 非空）且开关键从未写过** ⇒ 迁成 '1'（= 维持"升级前后一字不变"）；
//      **全新世界（无史）一律 '0'** ⇒ 新世界要你按一下「开始」才动。
//      ★幂等：迁移只写"键不存在"的世界；你手动关掉会把 '0' 写进账，此后**永不再迁移**（尊重显式选择）。
const AUTO_ADVANCE_KEY = 'autoAdvance';
export function ensureAutoAdvanceKey(world) {
    const dyn = world?.context?.setting?.dynamic;
    if (!dyn) return false;
    const env = { ...(dyn.env || {}) };
    if (Object.prototype.hasOwnProperty.call(env, AUTO_ADVANCE_KEY)) return false;   // 已显式写过（含你手动关）⇒ 不碰
    const hasHistory = Array.isArray(world?.meta?.simLog) && world.meta.simLog.length > 0;
    env[AUTO_ADVANCE_KEY] = hasHistory ? '1' : '0';
    world.context.setting = { ...world.context.setting, dynamic: { ...dyn, env } };
    return true;
}
// 闸的读法：**只有显式 '1' 算开**（缺键=关，与 `switchOn` 同口径；这里多传一个"世界"以免调用点自己 guard）
function autoAdvanceOn(world) {
    return String(world?.context?.setting?.dynamic?.env?.[AUTO_ADVANCE_KEY] ?? '') === '1';
}
// 供测试注入（`node --test` 里用假 world 直接验闸，不必起浏览器）
export const sw2AutoAdvanceOn = (world) => autoAdvanceOn(world);

/**
 * ★leg33d：**每收到一条消息**时的总闸判据（从 `setupAsyncTicks` 里提出来，为的是能真跑测试）。
 * 口径（三条，都能机械核）：
 *   · 开（显式 '1'）⇒ 调 `advance()` —— 这就是"插件自动生效"的那一下。
 *   · 关（缺键/'0'/空）⇒ **一次都不推进**，只 `setStatus` **明说**（否则"世界怎么不动了"会被当成 bug）。
 *   · 手动路径**不经过这里**（面板「推进一轮」走 `dispatchAction('advance-world')`）⇒ **永不被闸**。
 * @returns {{advanced:boolean, reason?:string}} 便于测试与调用方留痕（不靠副作用判断）
 */
export function sw2OnMessageReceived(hotWorld, { advance, setStatus: status } = {}) {
    if (!autoAdvanceOn(hotWorld)) {
        if (typeof status === 'function') {
            status('⏸ 插件已关（发消息不自动推进）· 参数页「插件总闸」可开 · 或按参数页的「推进一轮」手动推');
        }
        return { advanced: false, reason: 'autoAdvance=off' };
    }
    if (typeof advance === 'function') advance();
    return { advanced: true };
}

// 落盘修复（leg20）：ST 1.15 的 ctx.updateChatMetadata() 只改内存、不触发任何保存（public/script.js 实测），
// 热账必须主动触发聊天保存才写进 jsonl——此前世界只活在页面内存，刷新/关机即丢。
// 策略：写内存 + ST 自带防抖保存（saveMetadataDebounced → saveChatConditional 整聊天上盘）；
// 关键路径（初始化/重抽/导入）用 flushHotMeta() 显式 await 落盘后再报成功。
let sw2HotMetaFlushing = false;
let sw2HotMetaLastCallAt = 0;      // 上一次"真调 saveChat"的时刻（判"在飞那次有没有把我的写算进去"）
let sw2HotMetaLastWriteAt = 0;     // 上一次"写热账内存"的时刻（`writeHotMeta` 里打点）
// ★"账上还有没有**没落盘的写**"这一个事实必须显式记着（不能靠"值变没变"反推）：
//   `set-param` 的"无变化即忽略"捷径要用它——值没变、但上一笔写还没落下去时，那一下点必须**补落盘**，
//   否则玩家的操作被无声吞掉（正是用户实机「点了没反应」的成因之一）。
//   ★判据用**时刻**而不是布尔（第一版用布尔，写错了）：`pending = true` 只说明"成功落过一次盘"，
//     而每轮 tick 都写账 ⇒ 那个布尔会长期为真 ⇒ 每次点旋钮都白存一次整份聊天（真账 9.6MB）。
//     真正的判据只有一条：**最后一次确认成功的落盘，有没有晚于最后一次写**。
let sw2HotMetaPendingWriteAt = 0;   // 还没被确认落盘覆盖的那次写的时刻（0 = 没有）
let sw2HotMetaLastFlushOkAt = 0;    // 最近一次"确认成功"的落盘时刻
const hotMetaUnflushed = () => sw2HotMetaPendingWriteAt > sw2HotMetaLastFlushOkAt;
// "**正在飞的那次保存**有没有带上此刻账上这份写" —— 决定"要不要再排一次补写"的唯一判据。
//   ★为什么不能只用 `pending` 判：`pending` 只说明"确认落盘成功过"，而快照/防抖路径都会清它，
//     于是它会**长期为真**（每轮 tick 都写账）⇒ 拿它当"要不要补写"的判据就会变成每次点旋钮都白存一次
//     （真账 9.6MB 一整份上盘，这不是小事）。这一个标志只在"在飞那次已覆盖最新写"时为真。
let sw2HotMetaFlushedCurrent = false;

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// ★★★leg46：**参数全生命周期收进 `src/param-hub.js`，本文件只留接线**（用户令「重构代码吧，我已经没有耐心了」）。
//
// 这一格的性质（为什么是"推倒"而不是"再补一层"）：
//   "改档位 → 刷新回默认"从 leg26 到 leg45 被修了**七轮**，判据 662→693 全绿而实机一次都没好。
//   七轮全在**症状附近**改代码（三态返回 / 回读核对 / 抢回 / 延后重试 / 本地兜底 / 覆盖层 /
//   就地同步控件 / 撤销栈），而真形状是：**同一个数有五个写入口、三份存储、两套"值从哪来"的规则**，
//   而且每次调用各自 `worldNameOf(world ?? sw2LastWorld ?? readHotMeta()?.world)` **现算一次世界名**
//   ⇒ 读用一个桶、写用另一个桶，**不报错、不抛异常，只是静默写到别处**（本仓"一个数两把尺子"）。
//
// ⇒ 现在本文件里**没有**任何"读写参数存储"的代码了（三样东西一起没了）：
//   ① 桶读写（`sw2ParamBucket` / `sw2WriteParamBucket` / `sw2ParamEnv` / `sw2PersistParamEnv`）；
//   ② 管辖键与镜像（`sw2ManagedParamKeys` / `sw2MirrorParamsToAccount`）；
//   ③ 撤销栈的装配与 `paramUndo` 的 write 回调。
//   取而代之的是**一个对象 + 三个入口**：`hub.set(world, key, value)` · `hub.commit(world)` · `hub.undo(world)`。
//   ★纪律（判据 `test/param-hub.test.js` ⑨ 用源码扫描锁死）：
//     本文件**不许**再出现 `localStorage.setItem(` 或 `extensionSettings[...PARAMS_...]` 的赋值——
//     参数只有一个写入口，其余全是它的下游。

/** 读 ST 的插件配置区（拿不到就返回 null —— 绝不抛，面板其余部分照常工作）。 */
function sw2ExtensionSettings() {
    try {
        const ctx = freshCtx();
        const s = ctx?.extensionSettings;
        return s && typeof s === 'object' ? s : null;
    } catch (_) { return null; }
}

function sw2WriteLocalBucketRaw(bucket) {
    try {
        const ls = sw2LocalStore();
        if (!ls) return false;
        ls.setItem(PARAMS_LS_KEY, JSON.stringify(bucket));
        return true;
    } catch (err) {
        console.warn('[story-world-v2] 并入服务端参数失败（不影响参数本体）', String(err?.message || err));
        return false;
    }
}

/** 主路存储（**惰性取**：载入后才可用；拿不到就 null —— hub 会如实报"只能退回插件配置区"）。 */
function sw2LocalStore() {
    try { return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null; } catch (_) { return null; }
}

/**
 * ★★**参数的唯一入口**。三层存储与三格核对全在 `src/param-hub.js` 里：
 *   ① 主路 = 我们自己的本地存储（**同步**，写下去当场在盘上）；② 备份 = 插件配置区；
 *   ③ 镜像 = 世界账 `dynamic.env`（引擎照旧读它：`pack.js` 进包 / `limits.js` 当闸）。
 * ★全部依赖**注入**（存储 / 插件配置 / 让 ST 存配置）⇒ 这个模块在 Node 里能真跑（判据就是那么跑的）。
 * ★`saveSettings` 只是**尽力而为**：ST 的配置保存通道已被实机证伪（`settings.json` 的 mtime 停在
 *   载入那一刻，且它自己 `saveSettings()` 里有一道 `settingsReady` 闸会**静默不写**）
 *   ⇒ 它成功与否**不参与**"玩家的值存住了没有"这个判断（那是"别把数据寄托在别人的通道上"那条教训）。
 */
const paramHub = createParamHub({
    storage: () => sw2LocalStore(),
    settings: () => sw2ExtensionSettings(),
    saveSettings: () => { try { freshCtx()?.saveSettingsDebounced?.(); } catch (_) {} },
    log: (line) => console.info(`[story-world-v2] ${line}`),
});

/**
 * ★★★leg46 续（用户实机「老问题没解决，还是会回归默认」）：**把取证做成一枚按钮**。
 * 为什么必须有它（这一格是本棒最贵的教训）：这条症状被修了七轮，每一轮都**缺同一件东西**——
 *   「改一次参数之后，真源与世界账各是什么」这一对读数**从来没被同时拿到过**。
 *   前几轮给用户的取证办法是"开控制台粘一行代码"，而**用户不开控制台**（七轮里的读数都是别的时机截的图）。
 * ⇒ 现在：面板上直接印出三个读数 + 一枚「复制自检」按钮（一键把原始数据拷进剪贴板）。
 * 读什么（逐条都对着一个可能的病因）：
 *   ① `主路键名 + 原文` ⇒ 键名/内容变了没有（**换一个 origin/被清掉都会在这里现形**）
 *   ② `主路能不能写` ⇒ 真的做一次写-读-还原（隐私模式/配额/被拒会现形）
 *   ③ `世界名 / 桶键` ⇒ 读与写是不是同一个桶（本仓"一个数两把尺子"那一族）
 *   ④ `真源 keys / 引擎镜像 keys` ⇒ 参数到底落在哪一处、有没有同步给引擎
 *   ⑤ 一致性结论 ⇒ **真源 != 镜像**时直接点名（那正是"面板一个数、引擎按另一个数跑"）
 *   ★只读：除了②那次"写回原值"的探针，不改任何东西。
 */
export function gatherParamEvidence() {
    const w = sw2HubLastWorld || readHotMeta()?.world || null;
    const ev = { 采集时间: new Date().toISOString(), 构建号: PANEL_BUILD };
    try {
        const ls = sw2LocalStore();
        ev.主路可用 = !!ls;
        let raw = null;
        if (ls) { try { raw = ls.getItem(PARAMS_LS_KEY); } catch (err) { ev.主路读取失败 = String(err?.message || err); } }
        ev['主路键名'] = PARAMS_LS_KEY;
        ev['主路原文'] = raw;
        ev['主路有没有这一格'] = raw != null && raw !== '';
        if (ls) {
            // ★写探针：写一个自己的键再删掉（**不碰参数那份**），据此判"这个环境能不能写"
            const probeKey = '__sw2_probe__';
            try {
                ls.setItem(probeKey, '1');
                ev.主路能写 = ls.getItem(probeKey) === '1';
                ls.removeItem(probeKey);
            } catch (err) { ev.主路能写 = false; ev['主路写失败原因'] = String(err?.message || err); }
        }
    } catch (err) { ev['主路探针异常'] = String(err?.message || err); }
    try {
        const s = sw2ExtensionSettings();
        const b = s?.[PARAMS_SETTINGS_KEY];
        ev['插件配置区有这一格'] = !!b;
        ev['插件配置区原文'] = b ? JSON.stringify(b) : null;
    } catch (err) { ev['插件配置区探针异常'] = String(err?.message || err); }
    try {
        const d = paramHub.diag(w);
        ev['世界名'] = d.世界名;
        ev['桶键'] = d.桶键;
        ev['真源'] = d.真源;
        ev['账上镜像'] = d.账上镜像;
        ev['读自'] = d.读自;
        ev['读注'] = d.读注;
        ev['撤销步数'] = d.撤销步数;
        ev['世界名与桶键一致'] = d.世界名 === d.桶键;
        // ★★leg46 续·十：**写格留痕**（谁在什么时候把哪一格写成了什么）——画面再出分歧时，这一格直接点名。
        ev['写格次数'] = sw2CellWriteLog.length;
        ev['写格留痕'] = sw2CellWriteLog.slice(-8);
        // ★★★leg46 续·十二：**「主路（载入时）」这一行是最重要的一格**——它**不经过任何写入**，直接读盘。
        //   刷新之后它若为空、或只剩旧键，就**证明**浏览器存储没活过刷新（那就不是"我们写错"）。
        //   ★这是十二轮里唯一一条"不依赖任何推断"的读数，下一任请先看它。
        try { ev['主路（载入时，未经写入）'] = sw2LocalStore()?.getItem(PARAMS_LS_KEY) ?? null; } catch (_) {}
        ev['主路时间戳'] = (() => { try { return JSON.parse(sw2LocalStore()?.getItem(PARAMS_LS_KEY) || 'null')?.updatedAt || null; } catch (_) { return null; } })();
        // ★★★写入审计（用户怀疑"别的插件"那条线）：每一次写真源都留痕 ⇒ 谁在什么时候把桶动过、
        //   有没有"键变少了"。**这一格是八轮里第一次能回答"是谁弄没的"**（而不是"我猜是谁"）。
        const tr = paramHub.writeTrace();
        ev['写入次数'] = tr.length;
        ev['写入审计'] = tr.map((e) => `${e.at} 写后[${e.keys.join('|') || '空'}]`
            + `${e.lost.length ? ` ⚠丢了[${e.lost.join('|')}]` : ''}`
            + `${e.note ? ` (${e.note}${e.missing?.length ? ` 缺[${e.missing.join('|')}]` : ''})` : ''}`
            + ` ← ${e.stack}`);
        // ★一致性：面板画的值（真源 ⊕ 镜像 ⊕ 出厂默认）里，真源有的每一个键，镜像里必须同值
        const disp = paramHub.displayEnv(w);
        const mirror = d.账上镜像 || {};
        const src = d.真源 || {};
        const mismatch = Object.keys(src).filter((k) => mirror[k] !== src[k]);
        ev['真源与镜像不一致的键'] = mismatch;
        ev['面板画的天时'] = disp['天时'] ?? null;
        ev['面板画的上限'] = { 每轮递线: disp['每轮递线'], 每轮事件: disp['每轮事件'], 顶层大计: disp['顶层大计'], 在飞大计: disp['在飞大计'] };
    } catch (err) { ev['自证面异常'] = String(err?.message || err); }
    return ev;
}

/** ★把取证读数拼成一段**可直接粘贴**的文本（给用户复制用；一行一个读数）。 */
export function paramEvidenceText(ev = null) {
    const e = ev || gatherParamEvidence();
    return ['[story-world-v2 参数自检]', ...Object.entries(e).map(([k, v]) => `${k} = ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)].join('\n');
}

/** ★hub 最近一次"算过参数"的世界（只为自证面 `sw2ParamDiag()` 取证；不参与任何判定）。 */
let sw2HubLastWorld = null;

/** 外部（面板）读撤销态。 */
export const sw2ParamUndoState = () => paramHub.undoState();
/** ★自证面：三个读数（世界名 / 真源 / 账上镜像）——用户不必再开控制台手打（leg41 §5.1 那段的内置版）。 */
export function sw2ParamDiag() {
    const w = sw2HubLastWorld || readHotMeta()?.world || null;
    return paramHub.diag(w);
}

/** 外部（面板）按撤销：退的是**玩家的档位**，世界已经发生的事不回退。 */
export function sw2UndoParam() {
    const world = loadHotAccount(readHotMeta()) || sw2HubLastWorld || null;
    if (!world) return { ok: false, reason: '还没有世界' };
    const r = paramHub.undo(world);
    if (!r.ok) return r;
    // 撤销之后：真源与镜像一起回退 ⇒ 把镜像那份落进聊天账，并让面板重画
    if (r.world) {
        sw2HubLastWorld = r.world;
        try { writeHotMeta(hotAccountShape(r.world)); } catch (_) {}
    }
    try { refreshSections(['params', 'board']); } catch (_) {}
    return { ok: true, label: r.label };
}
/**
 * ★**写账 + 参数镜像**（"账本被整份换成另一份"的那些路径用它，例如快照恢复 / 导入 / 清演化层）：
 *   这些路径写下去的账可能带着**它自己那份旧的 `dynamic.env`** ⇒ 参数镜像会与真源不一致，
 *   引擎（`limits.js` 的闸 / `pack.js` 进包）就会按旧档跑。这里在写之前把真源镜像补上。
 *   ★leg46 起这里**不再有重入闩**：镜像只在内存里改世界（`hub.mirrorOnly`），
 *     落账仍然只有 `writeHotMeta` 一处 ⇒ "镜像自己又调 writeHotMeta"这条递归路径结构上不存在了。
 */
function sw2WriteHotMetaEnsuringParams(meta, world = null) {
    const w = world || meta?.world || null;
    if (!w) { writeHotMeta(meta); return; }
    const m = paramHub.mirrorOnly(w);          // 顺带把账上那份旧参数换成真源（快照恢复/导入之后必须做）
    sw2HubLastWorld = m.world || w;
    writeHotMeta(hotAccountShape(m.world || w));
}
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝

function writeHotMeta(meta) {
    const ctx = freshCtx();
    if (!ctx || typeof ctx.updateChatMetadata !== 'function') return;
    // ★★leg41（本笔的核心简化）：这里原来有一层 `sw2WithParamOverlay(meta)`——它的作用是
    //   "让玩家的参数档位搭上每一笔世界写"，用来对抗"账本被别的副本换手时把档位洗掉"。
    //   参数真源搬进 `extensionSettings` 之后，**参数本来就不在这份账里了** ⇒ 搭车这件事连同
    //   它要防的那一类竞争一起消失。现在这一笔写**只写世界**（`dynamic.env` 里那份是镜像，
    //   由 `sw2MirrorParamsToAccount` 在参数变动时同步）。
    ctx.updateChatMetadata({ [HOT_META_KEY]: meta });
    sw2HotMetaLastWriteAt = Date.now();
    sw2HotMetaPendingWriteAt = sw2HotMetaLastWriteAt;   // 这一笔写还没被确认落盘覆盖
    sw2HotMetaWrittenMeta = meta;   // 被覆盖时拿它抢回来（同一个对象，零拷贝）
    sw2HotMetaWrittenFp = hotMetaSignatureOf(meta);   // 回读核对基线（见 hotMetaSignatureOf）
    try {
        if (typeof ctx.saveMetadataDebounced === 'function') ctx.saveMetadataDebounced();
        else if (typeof ctx.saveChat === 'function') ctx.saveChat().catch(() => {});
    } catch (_) {}
    // leg27 后 · 快照容错：**唯一的落账收口**就是这里——挂在这一处 ⇒ 全步覆盖
    //（查书前置步 / tick 演化 / 批量补全 / 单实体查 / 卷轮转 / 名册入账 / 初始化 / 导入 / 清演化层）。
    // 纪律：**fire-and-forget**（不 await）+ 内部 try/catch ⇒ 快照失败绝不影响世界推进（同记忆投递）。
    requestSnapshot(meta?.world, '落账');
}

// 显式落盘（关键路径 await 后报成功）：绕过防抖立即整聊天保存；重入守卫防并发双写。
//
// ★★leg40c 续 · 用户实机「下拉列表都点不了，会显示落盘失败」的那一刀（根因，读 ST 真源复核过）：
//   ① `ctx.saveChat` 不是 ST 的 `saveChat`，而是 **`saveChatConditional`**（`public/scripts/st-context.js:146`）；
//   ② 它头一件事是 `await waitUntilCondition(() => !isChatSaving, DEFAULT_SAVE_EDIT_TIMEOUT, 100)`
//      （`public/script.js:9063-9069`，`DEFAULT_SAVE_EDIT_TIMEOUT = debounce_timeout.relaxed = 1000ms`）
//      ⇒ **另一次聊天保存在飞时，它要等最多 1 秒**；超时只 `console.warn` 后 **return**（**不抛错**）；
//   ③ 它把内层 `saveChat()` 的异常**catch 掉只打 console.error**（`script.js:9086-9087`）⇒ **不往上传**。
//   于是旧实现（本函数）有两个真缺陷，症状正是用户看到的那两条：
//   · **假失败**：`sw2HotMetaFlushing` 为真时**直接 `return false`**，调用方照着打
//     「⚠ 落盘失败（见控制台）」——可控制台里既没有异常、稍后防抖那次还把数据写下去了。
//     用户看到的「一改就报落盘失败」就是这一条（实测：在飞窗口里连改两个参数，第二个必报）。
//   · **静默丢写**：在飞窗口里改的参数，那次在飞的保存**开始于这次写之前** ⇒ 盘上没有它；
//     旧实现既不重存也不追加，只能指望之后某次防抖/下一轮 tick 顺手带上（**无保证**）。
//   ⇒ 定稿口径三条（都能机械核，判据见 `test/set-param-persist.test.js`）：
//     **甲** 返回三态而非布尔：`{ ok: true }` 已落盘 · `{ ok: true, queued: true }` 排队补写 ·
//        `{ ok: false, reason: 'timeout'|'no-ctx'|'no-save-chat'|'throw' }` 真失败。**再没有第四种含糊态**。
//     **乙** 在飞 ⇒ **排队补写**（在飞那次完成后自动再存一次，把"在飞之后写的"补下去）——
//        ★只在「在飞那次的保存**开始于**本次写之前」时才补（`lastCallAt < lastWriteAt`），
//        否则就是无谓的一次重复上盘（真账 9.6MB 聊天，白存一次是实打实的代价）。
//     **丙** **绝不无限等**：单次等待超过 `SW2_FLUSH_TIMEOUT_MS` 就如实报超时并把结果交回调用方
//        （旧实现会把 `set-param` 的 `await` 一直挂着 ⇒ 状态条永不更新 ⇒ 界面像"点了没反应"）。
//
// ★★leg40c 续·二（用户实机「点跑一轮后参数的值又会回到默认」的**真因**——上一版只治了一半）：
//   ★**铁证**（用户真账备份序列）：`22:12:24` 与 `22:13:25`（第 1 轮）两份热账的 `dynamic.env`
//   **都没有**任何档位键 ⇒ 玩家那次「已落盘」**是空话**，值只活在内存里；下一轮落账/载入
//   拿别的世界副本一覆盖就"回到默认"。
//   ★**为什么空话**：`saveChatConditional`（= `ctx.saveChat`）**第一道闸**是
//   `await waitUntilCondition(() => !isChatSaving, 1000ms)`；超时它只 `console.warn` 后
//   **`return`——既不抛错也不写盘**；内层 `saveChat()` 的异常又被它 catch 掉（只打 console.error）
//   ⇒ **返回值里没有任何信息**。上一版把 `ok:true` 的口径写成"ST 的保存路径没有报错"，
//   于是这个洞原样留着：**报成功、盘上没有**。
//   ⇒ 治法：**别问返回值，去问账本**——显式落盘后**回读聊天元数据**核对指纹（`savedAt|tick`）：
//     ①对得上 ⇒ 报「已落盘」；②对不上 ⇒ **当场重试**（最多 `SW2_FLUSH_TRIES` 次、退避 0/150/400ms，
//     足够躲开那道 1 秒闸）；③试完仍对不上 ⇒ **绝不报成功**，如实说"只在内存里、刷新会丢"。
//   ★诚实边界（仍在，但不再扭曲结论）：回读对得上**不能**证明"字节真到了磁盘"（可能是另一次保存
//     把同一份数据带上去了）；但**对不上一定说明没成**。我们只把"对得上"当成功——宁可多存一次。
//
// 超时档（丙）：**绝不无限等**。为什么必须有它：真账 9.6MB 聊天的整份上盘是秒级，而 ST 的
//   `saveChatConditional` 在"另一次保存在飞"时要等最多 1 秒、超时**静默返回**（不抛错）⇒
//   旧实现把 `set-param` 的 await 一直挂在这儿，状态条**永不更新** = 界面像"点了没反应"。
export const SW2_FLUSH_TIMEOUT_MS = 10_000;
let sw2FlushTimeoutMs = SW2_FLUSH_TIMEOUT_MS;
// 重试次数与退避（第 1 次不等；后两次让开 ST 那道 1 秒闸）
export const SW2_FLUSH_TRIES = 3;
const SW2_FLUSH_BACKOFF_MS = [0, 150, 400];
// 供判据注入（`node --test` 里把超时压到几十毫秒，真跑超时分支而不必等 10 秒）
export function sw2SetFlushTimeout(ms) {
    sw2FlushTimeoutMs = Number.isFinite(ms) && ms > 0 ? ms : SW2_FLUSH_TIMEOUT_MS;
}

// 排队补写用的**一条**链（不堆第二条：多人同刻写入也只需要"最后一次再存一遍"）
let sw2FlushChain = Promise.resolve();
let sw2FlushChainBusy = false;

// ★★leg40c 续·五（用户实机「根本没落盘，刷新也回默认」）：**落盘要自己带文件名**。
//   读 ST 真源发现的那一格（`public/script.js:7105-7127`）：
//     `saveChat` 的文件名取 `characters[this_chid]?.chat`；**取不到就 `console.warn` 后直接 `return`**
//     ——**不写盘、不抛错**。而 `ctx.saveChat` 又是 `saveChatConditional`（它把内层异常也 catch 掉）
//     ⇒ 从插件侧看**永远"成功"**，盘上却什么都没写。这正是"改了就回默认"的最后一块拼图。
//   ⇒ 两条治法：
//     ① 保存时**显式带 `chatName`**（取 `ctx.chatId`，它与 ST 内部 `getCurrentChatId()` 同源）
//        ⇒ **不再依赖 `characters[this_chid].chat` 那个可能为空的字段**；
//     ② **计时闸**：一次真的整份上盘不可能在 10ms 内回来；**回得太快就当"它静默跳过了"**，
//        拒绝报成功并交给重试环（这道闸也顺带兜住别的静默 return 分支）。
const SW2_SAVE_MIN_MS = 10;
export function sw2ExplicitChatName() {
    const ctx = freshCtx();
    try {
        const id = ctx?.chatId ?? ctx?.getCurrentChatId?.();
        return typeof id === 'string' && id.trim() ? id.trim() : null;
    } catch (_) { return null; }
}
/** 调一次 ST 的保存（显式带文件名）；返回 { ms, fast } —— `fast` 为真 = 疑似静默跳过。 */
async function sw2CallSaveChat(ctx) {
    const chatName = sw2ExplicitChatName();
    const t0 = Date.now();
    await (chatName ? ctx.saveChat({ chatName }) : ctx.saveChat());
    return { ms: Date.now() - t0, fast: Date.now() - t0 < SW2_SAVE_MIN_MS };
}

// 我们最后写进账本那份形状的签名（判"账本还是不是我写的那一份"）。
//   ★为什么不用整个 JSON：真账 9.6MB，每次落盘串一遍是实打实的开销。
//   ★为什么**必须**带上 `env` 的键集（判据当场抓过一版）：用户那一天的症状正是
//     "档位键被吃掉了"，而那时 tick 没变 ⇒ 只看 `savedAt|tick` 会**假阳**（以为还是我那份）。
//     ⇒ 签名 = `savedAt|tick|编年行数|事件末位 id|env 键集`，全是 O(1) 的取数，且**覆盖了会被吃掉的那部分**。
function hotMetaSignatureOf(meta) {
    if (!meta || typeof meta !== 'object') return null;
    const w = meta.world || {};
    const ev = Array.isArray(w.events) && w.events.length ? String(w.events[w.events.length - 1]?.id ?? '') : '';
    const ch = Array.isArray(w.chronicle) ? w.chronicle.length : 0;
    const keys = Object.keys(w?.context?.setting?.dynamic?.env || {}).sort().join(',');
    return `${meta.savedAt}|${w?.meta?.tick ?? ''}|${ch}|${ev}|${keys}`;
}
function hotMetaFingerprint() {
    return hotMetaSignatureOf(readHotMeta());
}
let sw2HotMetaWrittenFp = null;   // `writeHotMeta` 写下去那一份的签名（回读核对基线）
let sw2HotMetaWrittenMeta = null; // 写下去的那一份本体（被别的副本覆盖时**拿它抢回来**）

/**
 * ★★leg40c 续·二：**把被抢走的账本抢回来**（用户实机「点跑一轮后参数又回到默认」的正面治法）。
 * 病：我们写下的档位，被"另一份世界副本"回写热账时吃掉了（下一个 tick 拿旧世界覆盖、聊天被重载…）
 *   ⇒ 玩家看到的就是"回到默认"。只在判别层重试是不够的——**重存的还是被覆盖后的那份**。
 * 治法：保存之前先看账本还是不是我写的那一份；不是 ⇒ **用我写的那份重新覆盖回去**，再存。
 * ★为什么不需要"别覆盖人家更新的写"那道闸（第一版加了，结果**自己把自己锁死**、判据当场抓红）：
 *   现在账本**不等于我那份**就已经说明"我被换掉了"；若这时账本内容正确，那它就是**更新的正确版本**，
 *   重存一遍无害（幂等）。故只按"内容是不是我那份"判，不掺时间戳。
 * @param {{fp:string, meta:object}} want 本次落盘开始时冻结的基线
 * @returns {boolean} 抢回来了没有
 */
function reassertWrittenMetaIfClobbered(want) {
    const fp = hotMetaFingerprint();
    if (!want?.fp || fp === want.fp) return false;                    // 账本还是我那份
    const ctx = freshCtx();
    if (!ctx || typeof ctx.updateChatMetadata !== 'function' || !want.meta) return false;
    console.warn('[story-world-v2] 账本被别的副本覆盖 —— 用我们写的那一份抢回来（否则玩家刚改的档位就"回到默认"了）', { 被换成: fp, 抢回: want.fp });
    ctx.updateChatMetadata({ [HOT_META_KEY]: want.meta });
    sw2HotMetaLastWriteAt = Date.now();       // 记账：这一下也是一次"写"
    sw2HotMetaPendingWriteAt = sw2HotMetaLastWriteAt;
    return true;
}

async function flushHotMeta() {
    const ctx = freshCtx();
    if (!ctx) return { ok: false, reason: 'no-ctx' };
    if (typeof ctx.saveChat !== 'function') return { ok: false, reason: 'no-save-chat' };
    if (sw2HotMetaFlushing) {
        // 在飞：不假装成功、也不假装失败——排一次补写，如实回报"排队中"
        // ★要不要补写的判据 = **在飞的那次保存有没有带上最新的写**（`sw2HotMetaFlushedCurrent`）：
        //   带上 ⇒ 不补（省一次无谓的整份上盘）；没带上（含"在飞那次是报过超时还挂着的那一次"）⇒ 补。
        //   `inFlightCoversMyWrite` 只作日志佐证，不作判据（时刻比较不严谨）。
        const inFlightCoversMyWrite = sw2HotMetaLastCallAt >= sw2HotMetaLastWriteAt;
        console.info('[story-world-v2] 热账保存已在飞 —— 本次写入排队补落盘', {
            在飞那次是否已含本次写: inFlightCoversMyWrite,
        });
        if (!sw2HotMetaFlushedCurrent && hotMetaUnflushed() && !sw2FlushChainBusy) {
            sw2FlushChainBusy = true;
            sw2FlushChain = sw2FlushChain
                .then(() => new Promise((r) => { setTimeout(r, 0); }))
                .then(() => flushHotMeta())
                .then((r) => { if (!r.ok) console.warn('[story-world-v2] 排队补落盘未成', r.reason); })
                .catch((err) => { console.warn('[story-world-v2] 排队补落盘抛错', String(err?.message || err)); })
                .finally(() => { sw2FlushChainBusy = false; });
        }
        return { ok: true, queued: true };
    }

    sw2HotMetaFlushing = true;
    sw2HotMetaFlushedCurrent = false;   // 这一次保存**还没**证明带上最新写（成功才置真）
    let lastErr = null;
    // ★冻结本次落盘的基线（见 `reassertWrittenMetaIfClobbered` 的 `want` 说明）
    const want = { fp: sw2HotMetaWrittenFp, meta: sw2HotMetaWrittenMeta };
    try {
        // ★★回读核对的重试环（见本函数头注释：`saveChatConditional` 会**静默不写**）
        for (let attempt = 1; attempt <= SW2_FLUSH_TRIES; attempt += 1) {
            if (attempt > 1) {
                const wait = SW2_FLUSH_BACKOFF_MS[Math.min(attempt - 1, SW2_FLUSH_BACKOFF_MS.length - 1)];
                await new Promise((r) => { setTimeout(r, wait); });
                console.info(`[story-world-v2] 热账落盘核对未过 —— 第 ${attempt}/${SW2_FLUSH_TRIES} 次重试`);
            }
            reassertWrittenMetaIfClobbered(want);   // ★被别的副本覆盖 ⇒ 先抢回来（否则重存的还是被覆盖掉的那份）
            sw2HotMetaLastCallAt = Date.now();
            let timer = null;
            let saveMs = null;
            try {
                const raced = await Promise.race([
                    sw2CallSaveChat(ctx),
                    new Promise((r) => { timer = setTimeout(() => r('__sw2_timeout__'), sw2FlushTimeoutMs); }),
                ]);
                if (raced === '__sw2_timeout__') throw new Error(`saveChat 超过 ${sw2FlushTimeoutMs}ms 未返回`);
                saveMs = raced.ms;
                // ★太快 = ST **静默跳过**了写盘（`saveChat` 的 `fileName` 为空就 `return`；见 sw2CallSaveChat 注释）
                if (raced.fast) throw new Error(`saveChat 只花了 ${raced.ms}ms 就返回（整份上盘不可能这么快 ⇒ 疑似被静默跳过）`);
            } catch (err) {
                const reason = String(err?.message || err);
                lastErr = /未返回/.test(reason) ? 'timeout' : /静默跳过/.test(reason) ? 'skipped' : 'throw';
                console.warn('[story-world-v2] 热账落盘未确认', reason);
                continue;   // 交给重试环（退避后再试）
            } finally {
                clearTimeout(timer);
            }
            // ★核对：账本还是**我写下去的那一份**吗。
            //   ★★诚实边界（这一格反复踩过，写死）：`readHotMeta()` 读的是**内存副本**，而账本正是我们
            //     刚写进去的 ⇒ 只要没人拿别的副本覆盖它，这里**必然相等** —— 所以它能抓的是
            //     **"账本被换成了别的副本"**（下一个 tick 拿旧世界覆盖、聊天被重载等），
            //     **抓不到**"ST 静默没写盘"（那件事从浏览器侧根本判不了：内存与磁盘无法区分）。
            //     ⇒ 故语义定成：相等 ⇒ "我们写下去的账本还在"（可报已落盘）；
            //       不相等 ⇒ 账本被人换了 ⇒ **抢回来 + 重存**（这才是重试环真正拦得住的那一类）。
            const after = hotMetaFingerprint();
            if (want.fp && after === want.fp) {
                console.info('[story-world-v2] 热账已落盘', new Date().toISOString(), { 耗时ms: saveMs });
                sw2HotMetaLastFlushOkAt = Date.now();   // 这一刻之前的写都算已上盘
                sw2HotMetaFlushedCurrent = true;
                return { ok: true };
            }
            lastErr = 'replaced';
            // ★★leg41：这里原来还有三件"抢参数"的动作（`sw2PinParamsOnLiveAccount` 钉 + 本地兜底 +
            //   延后重试）。它们全部为"参数住在世界账里"而存在——真源搬进插件配置后，
            //   账本被谁换手都动不到玩家的档位 ⇒ 这三个动作连同它们要防的竞争一起撤掉。
            //   注意：**世界账自己的核对与重试保留**（它对"世界"仍然有用：tick 的落账不该被静默吞掉）。
            console.warn('[story-world-v2] 热账在我写完之后被换成了别的副本 —— 重存一次', { 期望: want.fp, 实际: after });
        }
        // 试完仍对不上 ⇒ **如实报**（世界这一笔可能只在内存里；参数不受影响——它有自己的家）
        return { ok: false, reason: lastErr || 'replaced' };
    } finally {
        // ★超时也必须**放出这一格**（自愈）：旧式的"在飞"标志在超时分支里若不放开，一次卡住的保存
        //   会把此后每一次改参数都变成"排队"⇒ **一次卡死永久卡死**（判据实测抓到过这一版：
        //   超时那一轮之后，下一轮报的还是"另一次保存还在飞"）。
        //   放开它不会造成并发双写失控：真正写下去的那次早已开始，它带的是**当时**那份账；
        //   后来的写由这次（或排队那次）负责。ST 侧 `isChatSaving` 自己会把并发收敛掉。
        sw2HotMetaFlushing = false;
    }
}

/** ★只供判据用：清掉本模块的落盘簿记（每次测试开局调用，防上一例的在飞/待落状态串味）。 */
export function sw2ResetFlushState() {
    sw2HotMetaFlushing = false;
    sw2HotMetaFlushedCurrent = false;
    sw2HotMetaLastCallAt = 0;
    sw2HotMetaLastWriteAt = 0;
    sw2HotMetaPendingWriteAt = 0;
    sw2HotMetaLastFlushOkAt = 0;
    sw2FlushChainBusy = false;
    sw2FlushChain = Promise.resolve();
    paramHub.reset();   // ★leg46：撤销栈 + 管辖键 + 墓碑 + 抢回名单都是 hub 的模块级状态（不清会串到下一条用例）
    sw2HubLastWorld = null;
    sw2SnapLast = [];                  // ★同上：快照内容闸的指纹
    sw2SnapLastWorldFp = null;         // ★同上："只有参数变了"那道闸的基准（不清会让下一条用例判不出来）
}

// ★leg40c 续·六 的"延后重试（3 秒 × 最多 2 次）"已在 leg41 **整段删除**（用户令「可以你做吧」）：
//   它存在的唯一理由是"参数档位可能没落成盘、下次载入要补"——而参数真源搬进插件配置、
//   走 ST 自己的 `saveSettingsDebounced` 之后，**参数根本不再依赖聊天落盘** ⇒ 这个重试没有对象了。
//   （保留它会变成"每 3 秒把整份 9.6MB 聊天存一遍"的隐患——它自己那条注释就写着这是真隐患。）
//   ★判据里锁了"这四样都不许回潮"：`SW2_FLUSH_RETRY_DELAY_MS` / `sw2PlanFlushRetry` /
//     `sw2_pending_params` / `sw2ParamOverlay`。

/** 落盘结果 → 状态条那半句（**只有三种话，且只有一种带 ⚠**）。 */export function flushOutcomeText(r) {
    if (r?.ok && !r.queued) return ' · 已落盘';
    if (r?.ok && r.queued) return ' · 已改（另一次保存还在飞，已排队补落盘）';
    const why = r?.reason === 'timeout' ? `超过 ${Math.round(sw2FlushTimeoutMs / 1000)} 秒未返回`
        : r?.reason === 'no-ctx' ? '拿不到聊天上下文'
            : r?.reason === 'no-save-chat' ? '这一版 ST 没有可用的保存入口'
                // ★leg40c 续·五：ST 的保存**静默跳过**了（回得太快 / 文件名取不到就 return）
                : r?.reason === 'skipped' ? 'ST 的保存通道没真写（回得太快，疑似静默跳过）'
                    // ★leg40c 续·二 / 续·六：账本被**别的副本**覆盖了（下一个 tick 拿旧世界回写是主要来路）
                    : r?.reason === 'replaced' ? `账本被别的副本覆盖了（试了 ${SW2_FLUSH_TRIES} 次没抢回来）`
                        : '保存报错（见控制台）';
    return ` · ⚠ 这次没能确认落盘（${why}）`;
}

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// leg27 后 · 快照容错（细案 docs/spec-snapshot-fault-tolerance.md；用户拍板：IDB 独立库 / 保留 15 步 / 只回世界账）
//   纯逻辑在 `src/snapshot.js`（可 Node 测），存储适配在 `web/idb-backend.js`（照旧卷同层同纪律）。
//   本段只做编排：**何时拍** + **基准从哪来** + **失败怎么吞**。
let sw2SnapChain = { seq: 0, anchorId: null, anchorSeq: null, anchorWorld: null };
let sw2SnapQueue = Promise.resolve();   // 写串行（IDB 异步，不串行会竞态丢份）
let sw2SnapLast = [];                   // 最近两份快照的**逐字节指纹**（去重用，最多两串）
let sw2SnapInited = null;               // 链是否已与 IDB 对齐（null=未对齐）

// ★leg27 e（用户实拍：s1 时间最新、s12 最旧，**id 序列与时间完全对不上**）：
//   病 = **`seq` 只活在内存里，刷新即归零，而 IDB 里的旧快照还在**。
//   IDB 键是 `${chatId}:${id}` ⇒ 刷新后新链又从 `s1` 开始 ⇒ **新快照把旧快照按 id 一份份覆盖**，
//   各条链交织在一起（"越新的 id 时间越早"），且**重复份永远清不掉**（用户看到的"一下子多了这么多"）。
//   ⇒ 治法：**加载时把链与 IDB 对齐**——`seq` 取盘上最大序号，**凭空续号、绝不回头覆盖**。
//   对齐后 `anchorWorld` 为空 ⇒ 下一份自愿落 full（`planStep` 的既有规则），链头永远完整。
async function ensureSnapshotChain() {
    if (sw2SnapInited) return sw2SnapInited;
    sw2SnapInited = (async () => {
        try {
            const metas = await snapshotStore().list();
            const seqs = metas.map((s) => { const m = /^s(\d+)$/.exec(String(s.id ?? '')); return m ? Number(m[1]) : 0; });
            const maxSeq = seqs.length ? Math.max(...seqs) : 0;
            if (maxSeq > sw2SnapChain.seq) sw2SnapChain = { ...sw2SnapChain, seq: maxSeq };
            console.info(`[story-world-v2] 快照链已对齐：盘上 ${metas.length} 份 · 最大序号 s${maxSeq}（新快照从 s${maxSeq + 1} 起，不再覆盖旧的）`);
        } catch (err) {
            console.warn('[story-world-v2] 快照链对齐失败（本次按新链处理）', String(err?.message || err));
        }
        return true;
    })();
    return sw2SnapInited;
}

function snapshotStore() {
    const ctx = freshCtx();
    const chatId = String(ctx?.chatId ?? ctx?.chatMetadata?.chat_id_hash ?? 'default');
    return createIdbSnapshotStore(chatId);
}

/** 拍一份快照（异步 · 串行 · 零阻塞）。reason 只作可读标注，判据不放它身上。 */
//   ★★leg41（用户实机「参数改了好像还会生成快照极其不友好」）：**参数改动不再拍快照**。
//   为什么（v1 的先例）：v1 的持久快照只给"大操作"（生成/修订/体检）与受控编辑，5 份窗口就够用；
//     而 v2 把快照钩在**唯一落账收口**上，于是"改一个旋钮"也走这条路——`dynamic.env` 一变，
//     世界就逐字节变了，过不了下面那道内容闸 ⇒ **拧一次旋钮烧掉一个快照位**（15 份窗口被旋钮吃掉）。
//   口径（能机械核）：把**参数键全部摘掉**之后两份世界**逐字节相同** ⇒ 这一步只有参数在动，
//     **不是世界动了** ⇒ 不拍。此时参数的真源在插件配置里（本笔刚搬的家），快照本来也管不到它。
function stripParamKeys(world) {
    const copy = JSON.parse(JSON.stringify(world));      // 深拷贝：绝不动真账一个键
    const env = copy?.context?.setting?.dynamic?.env;
    if (!env || typeof env !== 'object') return copy;
    for (const k of Object.keys(env)) if (isParamStoreKey(k)) delete env[k];
    return copy;
}
let sw2SnapLastWorldFp = null;   // 上一份"摘掉参数键"的世界指纹（判"只有参数在动"的基准）
function isParamOnlyChange(world) {
    try {
        const env = world?.context?.setting?.dynamic?.env;
        if (!env || !Object.keys(env).some((k) => isParamStoreKey(k))) return false;   // 没有参数键 ⇒ 不适用
        if (!sw2SnapLastWorldFp) return false;           // 没有上一份可比 ⇒ 老实拍（链头必须有）
        return JSON.stringify(stripParamKeys(world)) === sw2SnapLastWorldFp;
    } catch (_) { return false; }
}
function requestSnapshot(world, reason) {
    if (!world || typeof world !== 'object') return;
    const snapshot = JSON.parse(JSON.stringify(world));   // 立即取副本（后续可能被就地改）
    // ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
    // ★leg27 d（用户实拍「**怎么一下子多了这么多，落账太细了还是 tick 吧**」，一屏 12 份、其中 11 份
    //   「增量 · 0KB」、tick 全是「第 0 轮」、时间戳挤在同一秒）：
    //   病的准确名字 = **"落账"不等于"世界动了"**。`writeHotMeta` 是**内存与盘面同步**的收口，
    //   它会在"账本逐字节没变"时也被调用（名册落账/位置继承/迁移/快照回填/初始化那一串）。
    //   我原来挂在它上面 ⇒ **对同一份世界反复拍快照**，其中还有**逐字节相同**的纯重复。
    //   ⇒ 加**内容闸**：与上一份逐字节相同 ⇒ 直接不拍（"一步"的定义 = **世界真的变了**）。
    //   这一闸同时把"落账太细"与"重复份"一起治掉：一个 tick 推进 = 一次真变化 = 一份快照。
    const fp = JSON.stringify(world);
    if (sw2SnapLast.includes(fp)) return;
    // ★leg41：**只有参数键在动 ⇒ 这不是"世界动了"**，不拍（理由见上面那段"参数改动不再拍快照"）。
    //   ★它必须放在"记指纹"**之前**：否则一次纯参数写会把 `sw2SnapLastWorldFp` 冲掉，
    //   下次真世界变化反而比不上了（判据里专门锁了这一条）。
    if (isParamOnlyChange(world)) {
        console.info('[story-world-v2] 只有参数档位变了（世界本体逐字节没变）⇒ 不拍快照');
        return;
    }
    sw2SnapLast = [fp, ...sw2SnapLast].slice(0, 2);
    sw2SnapLastWorldFp = JSON.stringify(stripParamKeys(world));
    sw2SnapQueue = sw2SnapQueue.then(async () => {
        try {
            await ensureSnapshotChain();      // ★异步边界上再保一次（防 loadWorld 的第一次对齐竞态）
            const p = planStep({
                seq: sw2SnapChain.seq,
                tick: world?.meta?.tick ?? null,
                world: snapshot,
                prevAnchorWorld: sw2SnapChain.anchorWorld,
                prevAnchorId: sw2SnapChain.anchorId,
                anchorSeq: sw2SnapChain.anchorSeq,
                reason: String(reason || '落账'),
            });
            await snapshotStore().put(p.snapshot);
            sw2SnapChain = { seq: p.nextSeq, anchorId: p.anchorId, anchorSeq: p.anchorSeq, anchorWorld: snapshot };
            // 保留窗口 15 步 · 锚点完整性由 planRetention 保证：丢锚就丢它名下的 delta
            const metas = await snapshotStore().list();
            const plan = planRetention({ snapshots: metas });
            if (plan.drop.length) await snapshotStore().drop(plan.drop);
            console.info(`[story-world-v2] 快照 ${p.snapshot.id}（${p.snapshot.kind}${p.mode ? `·${p.mode}` : ''} · ${p.snapshot.bytes} 字节）· ${p.snapshot.reason} · 现有 ${metas.length - plan.drop.length} 份`);
        } catch (err) {
            // 失败零阻塞：只进控制台（世界推进永远优先）
            console.warn('[story-world-v2] 快照失败（不影响世界推进）', String(err?.message || err));
        }
    });
}

/** 面板用：读快照清单 + 一行事实摘要（失败返回空，不抛） */
export async function snapshotList() {
    try {
        const metas = await snapshotStore().list();
        return { ok: true, list: metas, text: describeSnapshots(metas) };
    } catch (err) {
        return { ok: false, list: [], text: `快照不可读：${err?.message || err}` };
    }
}

/**
 * 回到某一步（**只回世界账**，用户拍板；对话记录不动）。
 * 三条纪律：①恢复前**先给当前状态拍一份**（防"恢复错了回不来"）②链不可恢复 ⇒ 明确拒绝、世界原样不动
 * ③恢复后落盘 + 重绘 + 把该份钉住（keepId）不被窗口剪掉。
 */
export async function restoreSnapshot(targetId) {
    try {
        const store = snapshotStore();
        const all = await store.listAll();
        const r = restoreFrom({ snapshots: all, targetId });
        if (!r.ok) return { ok: false, error: r.error };
        const current = loadHotAccount(readHotMeta()) || sw2LastWorld;
        if (current) requestSnapshot(current, '恢复前自保');       // ②自保（异步，不阻塞这次恢复）
        // ★leg41：恢复的是**世界账**（参数不在里面）⇒ 写回前先把真源镜像补上，
        //   否则恢复后引擎会按"快照里那份旧 env"跑（面板写 12、闸按 6 —— 正是本仓禁的"一个数两把尺子"）。
        sw2WriteHotMetaEnsuringParams(hotAccountShape(r.world), r.world);
        const flushed = await flushHotMeta();
        sw2LastWorld = loadHotAccount(readHotMeta()) || r.world;
        refreshWorld(sw2LastWorld, { oldVolumes: LISTED_VOLUMES });
        // 钉住该份 + 它需要的锚（keepId 闭包）
        try {
            const metas = await store.list();
            const plan = planRetention({ snapshots: metas, keepId: String(targetId) });
            if (plan.drop.length) await store.drop(plan.drop);
        } catch (_) {}
        const t = r.world?.meta?.tick;
        return { ok: true, tick: t, plan: r.plan, flushed };
    } catch (err) {
        return { ok: false, error: String(err?.message || err) };
    }
}

export async function clearSnapshots() {
    try {
        const n = await snapshotStore().clear();
        // 三个内存态一起清：链、去重指纹、**对齐标记**（清了盘就必须允许重新对齐，否则新链又从头覆盖）
        sw2SnapChain = { seq: 0, anchorId: null, anchorSeq: null, anchorWorld: null };
        sw2SnapLast = [];
        sw2SnapInited = null;
        return { ok: true, removed: n };
    } catch (err) {
        return { ok: false, error: String(err?.message || err) };
    }
}

/**
 * 重置快照（清空 + 立刻给当前世界拍一份新链头）。
 * 用途（用户实拍 12 份的来源）：盘上混着**旧代码/丢账时拍下的**快照——内容不可信、id 也乱。
 * 一键丢掉那些、从"现在这份干净世界"重新起链。
 */
export async function resetSnapshots() {
    const cleared = await clearSnapshots();
    if (!cleared.ok) return cleared;
    const current = loadHotAccount(readHotMeta()) || sw2LastWorld;
    if (current) await requestSnapshot(current, '重置后链头');
    return { ok: true, removed: cleared.removed };
}

async function refreshSnapshots({ silent = true } = {}) {
    try {
        await ensureSnapshotChain();          // ★先对齐（否则新链会从头覆盖旧链）
        const r = await snapshotList();
        sw2SnapshotCache = { list: r.list, text: r.text };
        if (sw2LastWorld) refreshWorld(sw2LastWorld, { oldVolumes: LISTED_VOLUMES });
    } catch (err) {
        if (!silent) setStatus(`⚠ 快照刷新失败：${err?.message || err}`);
    }
}

function volumeStore() {
    const ctx = freshCtx();
    const chatId = ctx?.chatId || 'default';
    return createIdbVolumeStore(String(chatId));
}

// K36：轮次队列（setupAsyncTicks 装一次；dispatchAction 的手动补推要用它）
let sw2TickQueue = null;

// ---------- K34/K36：会话态（模块级 · 面板零第二份状态） ----------
let sw2LastSettings = null;
let sw2PrevChronicle = null;      // 上一渲染的编年行数（第十三棒：进展计数用）
let sw2ChronicleFilter = null;    // K41 编年五筛视图态（kind Set；null=全选；纯视图态——不落 SSOT、不落盘，重绘保留，关面板重置）
let sw2LastWorld = null;          // K41：链视图入口持引用（同一对象，零第二份状态）
let sw2SnapshotCache = null;      // leg27 后：快照清单（IDB 读回的元信息 + 摘要文案）——随 config 进渲染层，面板零第二份状态
let sw2LastPicks = null;          // 细案 §3：上一轮"上场实体"名单（选人调用失败时退回它，再退兜底名单）

// ★细案 spec-entities-page-ia：实体页的**唯一一份**视图状态
//   （数据逻辑全在 `src/render.js` 的纯函数里：`selectEntityPage` / `entsHitCounts`；这里只存状态，
//    一行数据逻辑都不写——本仓"零第二份状态"纪律，与上面的 `sw2ChronicleFilter` 完全同款：
//    纯视图态、不落 SSOT、不落盘、重绘保留、关面板重置）
//   ★终审 M10：默认值**只有一份真源**（渲染层的 `makeEntsView()`）——原先这里与 `src/render.js` 的
//     `ENTS_DEFAULT_VIEW` 各写一份字面量、靠人同步（本笔加 `scope` 字段时正是两处都要改）。
let sw2EntsView = makeEntsView();
const SW2_ENTS_KINDS = new Set(['all', 'faction', 'character']);
const SW2_ENTS_FILTERS = new Set(['busy', 'recent', 'named', 'orphan']);
function sw2EntsViewReset() { sw2EntsView = makeEntsView(); }
// ★终审 C1：中文输入法**组合期**标志（模块级：`compositionstart`/`compositionend`/`input` 三支监听共享）。
//   组合期一律不写状态、不重绘（`refreshSections` 换掉搜索框节点 = 组合被中途打断 = 玩家打不出字）。
let sw2EntsComposing = false;

function modelSettings() {
    const ctx = freshCtx();
    const raw = ctx?.extensionSettings?.['story_world_v2'] ?? null;
    return raw && typeof raw === 'object' ? raw : null;
}

function readSettings() {
    const ctx = freshCtx();
    if (ctx?.extensionSettings && typeof ctx.extensionSettings === 'object' && !ctx.extensionSettings['story_world_v2']) {
        ctx.extensionSettings['story_world_v2'] = {};
    }
    return ctx?.extensionSettings?.['story_world_v2'] ?? null;
}

function writeSetting(key, value) {
    const ctx = freshCtx();
    const s = readSettings();
    if (!s) return;
    s[key] = value;
    try { ctx?.saveSettingsDebounced?.(); } catch (_) {}
}

const SETTINGS_INPUTS = { baseUrl: 'sw2_base', apiKey: 'sw2_key', model: 'sw2_model', playerDesc: 'sw2_player_desc' };

function nextPlayerId(entities = []) {
    let max = 0;
    for (const e of entities) {
        const m = /^e_p(\d+)$/.exec(String(e?.id || ''));
        if (m) max = Math.max(max, Number(m[1]));
    }
    return `e_p${max + 1}`;
}

// ★leg33c（用户拍板「位置变成自由文本，位置集干脆删了」）：**位置集从"闸"降级为"参照表"**，
//   并且**不再截断**。两件事分开说，别混：
//   ① 降级：`check-step.js` 的位置段不再拒整步（集外只留痕）、`settle.js` 的 spawnEntities 集外照收。
//      依据：位置线的定案本来是"只做呈现、不做机制"（START-HERE §1），而白名单却一直在当硬闸；
//      实测 8 本真实世界书里只有 3 本有干净地名表（`demo/audit-mechanism-genericity.js` 机制②），
//      其余 4 本退化成 `['未明']` ⇒ 闸在那些书上近乎失效。⇒ 参照表留给模型/面板/位置继承用，
//      但**不再决定"模型配不配写这个地名"**。
//   ② 不截断：**`POSITIONS_CAP` 已作废**（原来是 60，按书序截断防巨书灌爆输入）。真账实测截掉的代价：
//      canon 有 **134** 个地点条目，被切到 59 ⇒ 模型写书里真有的 `太清境`/`万魔殿`/`落英谷` 反被拒整步。
//      参照表已实测极轻（134 项 ≈ 600 字符 ≈ **180 est**），且**不参与 trimPack 裁剪** ⇒ 省钱的理由不成立。
//   ⚠保留 `cap` 形参只为兼容既有调用点（传 0/负 = 不截断）；生产路径不再传它。
export const POSITIONS_CAP = Infinity;   // ★已作废（留常量名防旧调用点炸）；见上 ②
export function derivePositions(setting, { fallback = '未明', cap = POSITIONS_CAP } = {}) {
    const book = setting?.frozen?.canon?.bookEntities || [];
    const seen = [];
    const push = (v) => {
        const s = String(v || '').trim();
        if (!s || seen.includes(s)) return;
        seen.push(s);
    };
    for (const b of book) {
        if (b?.location) { push(b.location); continue; }
        if (b?.kind === 'location') {
            push(b.name);
        }
    }
    // cap 缺省 = Infinity ⇒ 全收；显式传有限值才截断（既有用例自设上限时仍可测）
    const room = Number.isFinite(cap) ? Math.max(0, cap - 1) : seen.length;
    return [fallback, ...seen.filter((s) => s !== fallback).slice(0, room)];
}

export function attachPlayerPiece(world, playerName) {
    const nm = String(playerName || '').trim();
    const entities = world.entities || [];
    const existing = nm ? entities.find((e) => e.name === nm) : null;
    if (existing) {
        world.context = { ...(world.context || {}), playerId: existing.id };
        return { created: false, reused: true, playerId: existing.id, name: existing.name };
    }
    const id = nextPlayerId(entities);
    const ent = {
        id,
        kind: 'character',
        name: nm || '你',
        location: (world.context?.positions || [])[0] || '未明',
        lastActiveTick: 0,   // 头几轮不静默（与 spawnEntities 同口径——否则棋子一开始就被静默门滤掉）
    };
    world.entities = [...entities, ent];
    world.context = { ...(world.context || {}), playerId: id };
    return { created: true, reused: false, playerId: id, name: ent.name };
}

export function namePlayerPiece(world, parsedName) {
    const nm = String(parsedName || '').trim();
    const pid = world.context?.playerId;
    if (!nm || !pid) return { renamed: false };
    const others = (world.entities || []).find((e) => e.name === nm && e.id !== pid);
    if (others) {
        world.context = { ...world.context, playerId: others.id };
        world.entities = world.entities.filter((e) => e.id !== pid);   // 同名他人 ⇒ 合并，空棋子不留
        return { renamed: true, mergedInto: others.id, name: others.name };
    }
    world.entities = world.entities.map((e) => (e.id === pid ? { ...e, name: nm } : e));
    return { renamed: true, name: nm };
}

// ---------- ★leg40b（I-1）：**覆盖现存世界的守门**（用户点单修；这条会真丢用户数据）----------
// 病灶（体检 §3.2 I-1）：`bus['init-world']` 原来**一声不响就覆盖现存世界**——
//   没有确认框、没有存在性检查，而同文件的「回到此步」**有**确认框（同一份代码里两种标准）。
//   更贵的是**顺序**：起根（读整本书，真账实测 170–490 秒）与抽取都跑在 `writeHotMeta` **之前**，
//   于是用户**在覆盖真正发生前一句提示都看不到**，只看见状态条慢慢跑了几分钟。
//   ⇒ 修法两条：① 加确认框 + 存在性检查；② ★把闸放在**最前面**（第一行，任何一次模型调用之前）。
// 判据（都能机械核，见 test/init-overwrite-guard.test.js）：
//   · **存世界在 ⇒ 必问**（不按"推进过才问"分层：tick 0 的世界也是用户的账）；
//   · **问了才烧调用**——取消路径**一次模型调用都不许发**；
//   · **什么都不做**——取消后盘上/内存里的世界逐字节原样；
//   · **没窗口**（`window.confirm` 不存在，Node/vm 里）⇒ 照旧放行，**绝不因为"问不出来"就把人卡死**。
//   · 文案只说**用户看得懂的事实**（名字 / 推进到第几轮 / 多少条名号 / 被换掉的时刻），
//     不出现 tick/entity 这类引擎词（A-3），也不评价世界好坏。
/** 把热账归一成「要被换掉的那个世界」的事实面；没有世界就返回 null（= 没有可丢的东西）。 */
export function worldToBeReplaced(world) {
    if (!world || typeof world !== 'object') return null;
    const tick = world?.meta?.tick;
    return {
        name: String(world?.context?.world || '').trim() || '未名世界',
        tick: Number.isFinite(tick) ? tick : null,
        entities: Array.isArray(world?.entities) ? world.entities.length : 0,
        savedAt: String(world?.savedAt || '').trim(),
    };
}

/** 覆盖确认的文案（**玩家视线内的文本**：人话、零引擎术语、可逐条被用例核）。
 *  ★入参契约（本函数**只吃归一后的 brief**，不吃世界本体）：这是踩过的一格——
 *    第一版写成"吃世界"，于是调用方把 `worldToBeReplaced()` 的结果又喂进来 ⇒ 二次归一出「未名世界 / ? 轮」。
 *    同一个形状、两种身份 = 本仓"一字段一义"要治的病 ⇒ 契约写死：**先 `worldToBeReplaced()`，再喂结果**。
 *  brief 为 null/空名 ⇒ ''（= 调用方据此不问）。 */
export function initWorldOverwriteNotice(brief) {
    const old = brief && typeof brief === 'object' ? brief : null;
    if (!old || !old.name) return '';
    const lines = [
        `「✨ 开始新世界」会**换掉**当前这个世界「${old.name}」。`,
        '',
        '将被换掉（世界账）：',
        `· 已推进 ${old.tick == null ? '?' : old.tick} 轮${old.entities ? ` · 记着 ${old.entities} 条名号` : ''}`,
        `· 这个世界的进度、事件、盘算都会从头开始（它背后的对话记录不受影响）`,
        '· 换掉前会自动给当前状态拍一份快照（换错了可以再退回来）',
        '',
        '换掉之前没有任何调用能先替你试一下，所以先问你一句。',
        '点「确定」= 换掉它；点「取消」= 什么都不做（世界一个字节不动，也不会发生任何调用）。',
    ];
    if (old.savedAt) lines.push('', `（这份世界最后落盘：${old.savedAt}）`);
    return lines.join('\n');
}

export function characterWorldNames(character) {
    const out = [];
    const seen = new Set();
    const push = (v) => {
        const s = String(v ?? '').trim();
        if (s && !seen.has(s)) { seen.add(s); out.push(s); }
    };
    push(character?.world);                            // 卡上写的 ST 世界信息名
    push(character?.data?.extensions?.world);          // 另一种 ST 卡格式（数据段）
    push(character?.extensions?.world);                // data.extensions 之外的 extensions 段
    return out;
}

export function characterBookEntries(character) {
    const book = character?.character_book || character?.data?.character_book;
    const raw = book?.entries;
    const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
    return list.filter((e) => e && typeof e === 'object').map((e, i) => ({
        uid: e.id ?? i,
        key: Array.isArray(e.keys) ? e.keys : (e.key ?? []),
        keysecondary: e.secondary_keys ?? [],
        comment: e.comment ?? '',
        content: String(e.content ?? ''),
        disable: e.enabled === undefined ? Boolean(e.disable) : !e.enabled,
    })).filter((e) => e.content);
}

// 世界书条目收集（三条来源：卡内置书 / 具名世界书 / 旧版 worldInfo 数组）——去重按"键+正文"指纹，
// 同一本书被两条路取到时只算一次（leg25 e 实测：同一本书读两遍 499526 → 301538 字符）。
async function collectWorldInfoEntries(ctx, character) {
    const legacy = ctx?.worldInfo;
    if (Array.isArray(legacy)) return { entries: legacy, worldSources: null, readable: true };
    if (legacy && typeof legacy === 'object' && Array.isArray(legacy.entries)) return { entries: legacy.entries, worldSources: null, readable: true };
    const names = [];
    const seenName = new Set();
    const push = (n) => { if (n && typeof n === 'string' && n.trim() && !seenName.has(n)) { seenName.add(n); names.push(n.trim()); } };
    push(character?.world); // 卡上写的世界信息名（v1 同款：单卡 z 情形靠它）
    const chatWi = ctx?.chatMetadata?.['world_info']; // 聊天级挂载（ST assignLorebookToChat 写 chat_metadata.world_info）
    if (typeof chatWi === 'string') push(chatWi); else if (Array.isArray(chatWi)) for (const n of chatWi) push(n);
    for (const n of (ctx?.extensionSettings?.world_info?.globalSelect ?? [])) push(n);
    for (const n of Object.keys(ctx?.extensionSettings?.world_info ?? {})) push(n);
    const fpOf = (e) => {
        const content = String(e?.content ?? '').trim();
        if (!content) return null;
        return `${normalizeEntryKey(e)}\u0000${content}`;   // 契约来自 init-source（键归一 + 正文）
    };
    const entries = [];
    const seenFp = new Set();
    let dupEntries = 0;
    const addEntry = (e) => {
        if (!e || typeof e !== 'object') return;
        const fp = fpOf(e);
        if (fp) {
            if (seenFp.has(fp)) { dupEntries += 1; return; }
            seenFp.add(fp);
        }
        entries.push(e);
    };
    for (const e of characterBookEntries(character)) addEntry(e);   // 卡内置书：不花 loadWorldInfo，先收
    let loadedAny = false;
    const worldSources = [];
    for (const name of names) {
        try {
            const w = typeof ctx?.loadWorldInfo === 'function' ? await ctx.loadWorldInfo(name) : null;
            const raw = w?.entries;
            const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : null);
            const ok = Boolean(list?.length);
            if (ok) loadedAny = true;
            worldSources.push({ name, ok, entries: list?.length ?? 0 });
            if (list) for (const e of list) addEntry(e);
        } catch (err) {
            worldSources.push({ name, ok: false, entries: 0 });
        }
    }
    return { entries, worldSources, readable: loadedAny || entries.length > 0, dupEntries };
}

function pickCharacter(ctx) {
    if (ctx?.character && typeof ctx.character === 'object') return ctx.character; // 已解析好的 ST 卡
    const chars = ctx?.characters;
    if (!Array.isArray(chars)) return null;
    if (ctx?.groupId != null) {
        const g = Array.isArray(ctx.groups) ? ctx.groups.find((x) => String(x?.id) === String(ctx.groupId)) : null;
        const avatars = Array.isArray(g?.members) ? g.members : [];
        for (const av of avatars) { const m = chars.find((c) => c?.avatar === av); if (m) return m; }
        return null;
    }
    const chid = Number(ctx?.characterId);
    if (Number.isInteger(chid) && chid >= 0 && chars[chid]) return chars[chid];
    return null;
}

export async function autoComposeSource() {
    const ctx = getCtx();
    const character = pickCharacter(ctx);
    const { entries: worldInfoEntries, worldSources } = await collectWorldInfoEntries(ctx, character);
    const res = composeInitSource({ character, worldInfoEntries });
    res.sourceDiag = { // 诊断附加元数据（非契约字段，仅控制台消费）
        identity: { characterId: ctx?.characterId ?? null, groupId: ctx?.groupId ?? null, chatId: ctx?.chatId ?? null },
        character: { name: character?.name ?? null, world: character?.world ?? null, hasBook: Boolean(character?.character_book || character?.data?.character_book) },
        worldSources,
    };
    if (!res.ok) {
        try {
            console.warn('[story-world-v2] 初始化设定源失败诊断', {
                ctxKeys: ctx ? Object.keys(ctx).slice(0, 40) : null,
                sourceDiag: res.sourceDiag,
                worldInfoType: ctx?.worldInfo ? (Array.isArray(ctx.worldInfo) ? 'array' : typeof ctx.worldInfo) : null,
                reason: res.reason,
            });
        } catch (_) {}
    }
    // 第二十五棒 e：把**真书条目**随源一起交出去——名册落账那一步（seedBookEntities）的零 token 兜底
    //   （成员行反推归属 / 紧贴名号的档位标签 / 势力规模原话）**必须读正文**，而 canon 名册条目只是名号表。
    //   这里已经收过一次条目，顺手带出，免得为了拿正文再收一遍（同一份数据取两次＝两次真实取书）。
    res.worldInfoEntries = worldInfoEntries;   // ← 真名是解构出来的 worldInfoEntries（`entries` 在此作用域不存在）
    return res;
}

// 抽取调用诊断包装（第十八棒）：transport 返回裸字符串（transport-http 契约）或 {text} 对象都吃——
// K38 抽取接线曾只取 `.text`（真实 transport 返回字符串 → 恒空 →「抽取输出为空」实为接线雷，
// 合成演练从未真跑所以未炸；worldstep.js L12 同款双形取法早已存在）。空/非 JSON 响应现场上控制台。
function diagExtract(resolved) {
    return async (p) => {
        const t0 = Date.now();
        const promptChars = Array.from(String(p ?? '')).length;
        try {
            const res = await resolved.transport(p);
            const text = typeof res === 'string' ? res : (res && typeof res === 'object' && typeof res.text === 'string' ? res.text : '');
            if (!text.trim()) {
                console.warn('[story-world-v2] 抽取空响应', {
                    promptLen: promptChars,
                    responseType: typeof res,
                    responseKeys: res && typeof res === 'object' ? Object.keys(res) : null,
                    textLen: text.length,
                    ms: Date.now() - t0,
                });
            } else {
                let shape = 'ok';
                try { JSON.parse(text); } catch (_) {
                    shape = 'non-json';
                    console.warn('[story-world-v2] 抽取非JSON响应（原文前120字）', text.trim().replace(/\s+/g, ' ').slice(0, 120));
                }
                void shape;
            }
            return text;
        } catch (err) {
            console.warn(`[story-world-v2] 抽取调用失败（输入 ${promptChars} 字符 · 已花 ${((Date.now() - t0) / 1000).toFixed(1)}s）`, String(err?.message || err));
            throw err;
        }
    };
}

// 初始化诊断（leg27 起：抽取每段的真实字符数/耗时都在这里现身——用户"看不到日志"那一刀）
function logInitDiagnostics(ctx, src, extractOut) {
    try {
        const char = pickCharacter(ctx);
        const charBook = (char?.character_book || char?.data?.character_book) || null;
        const bookEntries = charBook ? (Array.isArray(charBook.entries) ? charBook.entries : (charBook.entries && typeof charBook.entries === 'object' ? Object.values(charBook.entries) : null)) : null;
        const wi = ctx?.worldInfo;
        const wiShape = Array.isArray(wi) ? 'array' : (wi && typeof wi === 'object') ? 'object' : typeof wi;
        const wiEntries = Array.isArray(wi) ? wi : (wi && typeof wi === 'object' && Array.isArray(wi.entries) ? wi.entries : null);
        const pieces = ['description', 'scenario', 'personality', 'first_mes'].filter((k) => typeof char?.[k] === 'string' && char[k].trim());
        const canon = extractOut?.setting?.frozen?.canon;
        console.info('[story-world-v2] 初始化诊断', {
            identity: { characterId: ctx?.characterId ?? null, groupId: ctx?.groupId ?? null, chatId: ctx?.chatId ?? null },
            character: {
                name: char?.name ?? null,
                world: char?.world ?? null, // 卡上的世界信息名（ST 卡字段）
                pieces: pieces.length ? pieces : null,
                book: charBook ? { at: char.character_book ? 'character_book' : 'data.character_book', entries: bookEntries ? bookEntries.length : null } : '（无卡内置书）',
            },
            worldInfo: {
                shape: wiShape,
                entries: wiEntries ? wiEntries.length : null,
                keys: wi && typeof wi === 'object' && !Array.isArray(wi) ? Object.keys(wi).slice(0, 20) : null,
                preview: wiEntries ? wiEntries.slice(0, 2).map((e) => `${String(e.key ?? e.name ?? e.uid ?? '?')}: ${String(e.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}`) : null,
                mounted: src?.sourceDiag?.worldSources ?? null, // 具名挂载：哪些书读到了/几条（防"书没挂上"被当"书里没有"）
            },
            source: { ok: src?.ok, label: src?.label, usedChars: src?.usedChars, entryCount: src?.entryCount, pieceCount: src?.pieceCount, truncated: src?.truncated, preview: src?.text ? src.text.replace(/\s+/g, ' ').slice(0, 120) : null },
            extract: extractOut ? { ok: extractOut.ok, cached: extractOut.cached, fingerprint: extractOut.fingerprint, errors: extractOut.errors || [], canonSize: canon ? { powerScale: canon.powerScale?.length ?? 0, factions: canon.factions?.length ?? 0, bookEntities: canon.bookEntities?.length ?? 0 } : null } : null,
        });
    } catch (_) {}
}

function refreshSettingsHints() {
    const s = modelSettings() || {};
    const el = document.getElementById(SETTINGS_INPUTS.apiKey);
    if (el) el.placeholder = s.apiKey ? '（已保存 · 留空=不改）' : '（本机读取，不打印）';
}

function bindSettingsForm() {
    const win = document.getElementById(WINDOW_ID);
    if (!win || win.dataset.sw2SettingsBound) return;
    win.dataset.sw2SettingsBound = '1';
    const onField = (e) => {
        // leg26：参数页的控件也走这条委托（`data-action="set-param"`）——旋钮与开关同一条写通道
        // ★★leg40c 续（用户实机「只是展开下拉就弹『天时 → 未定』，点了还是改不了值」的真因）：
        //   判据必须是 **`[data-action="set-param"]`**，而且**必须确认抓到的是控件本身**。
        //   原来的写法 `closest('[data-action="set-param"]') || (target 自己有 data-action ? target : null)`
        //   在 `input`/`change` 的 target 是 `<option>`（在 select 内部）时，`closest` 找不到 select
        //   （旧 markup 里 select 上其实有 data-action，真正出事的是**卡片壳也挂着 `data-param`**）
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
                setStatus('⚠ 这一下没接上（面板结构变了）——已拒绝提交，世界账没动');
                return;
            }
            dispatchAction('set-param', { param: hit.getAttribute('data-param'), value: hit.getAttribute('data-value') ?? hit.value, el: hit }, e);
            return;
        }
        const key = Object.keys(SETTINGS_INPUTS).find((k) => SETTINGS_INPUTS[k] === e.target?.id);
        if (!key) return;
        const v = e.target.value;
        if (key === 'apiKey') {
            if (v && v.trim()) writeSetting('apiKey', v.trim()); // 留空=不改（防一次误清）
            return;
        }
        writeSetting(key, v);
    };
    win.addEventListener('input', onField);
    win.addEventListener('change', onField);
    // ★leg27 c（用户实拍「下拉表刚拉开没多久自己就关了」的同批修复）：
    //   `<select>` 有个老坑——**鼠标滚轮从它上面滚过就会改选中项**（不弹列表也改）。
    //   面板一打开、滚轮滑过参数页那个下拉，就把一次**什么都没改**的动作变成一次落盘 + 状态栏弹出。
    //   ⇒ 拦掉 `SELECT` 上的滚轮（键盘/点击照旧——那才是"玩家的手"）。
    win.addEventListener('wheel', (e) => {
        const el = e.target?.closest?.('[data-action="set-param"]');
        if (el && el.tagName === 'SELECT') e.preventDefault();
    }, { passive: false });
}

// 取书结果按会话缓存。三态语义（**"读不到"与"书里没有"必须分形**——硬规矩二）：
//   `{ ok: true, entries: [...] }` = 书读到了（条目可能为空 = 书里真没有）
//   `{ ok: false }`           = **书没读到**（取书炸了/一本都没取到）→ 调用方**不写任何痕迹**，下轮再试
//   旧法失败时 `return []`，与"书里没有"同形 ⇒ 引擎把读不到书记成「书未明述」并**永久锁死**该栏
//   （违反硬规矩「绝不用空值反推『书里没有』」）。另：取书结果按会话缓存（原实现每个实体重取一遍全量书）。
let sw2BookCache = null;   // { names, entries, readable }——只活在内存，loadWorld 时清
export function resetBookCache() { sw2BookCache = null; }

async function worldBookCached() {
    if (sw2BookCache) return sw2BookCache;
    const ctx = getCtx();
    const character = pickCharacter(ctx);
    const { entries, readable } = await collectWorldInfoEntries(ctx, character);
    sw2BookCache = { entries: entries || [], readable };
    return sw2BookCache;
}

// leg25 f 修（**接线类缺陷，本棒最重的一条**）：位置继承（零 token 结构推断，`deriveLocationFromBook`）
//   要的是**原始 ST 条目**（`comment`=条目名 / `content`=正文 / `key`=键数组）——它自己按条目名与
//   正文成员行匹配实体，**不经过查书那套"按名号取三档文本"**，所以不能复用 `bookTextForEntity`。
// 旧法为什么一次都没生效（三处断头，全在接线层）：
//   ① `lookupOneEntity` 调 `bookEntriesCached()`——**该函数全仓从未定义**（只有 `worldBookCached`），
//      点面板行的「查/重查」当场抛 `ReferenceError`；
//   ② `runBatchChunk`（批量补全）与 `advanceTick` 的 preStep（每轮前置步）**压根没传 `bookEntries`**
//      ⇒ `runBatchLookup` 里 `bookEntries == null` ⇒ `withInherit` 原样返回世界 ⇒ 推断跑 0 次；
//   ③ 全量测试没有任何一条把 `bookEntries` 喂给这两个收口 ⇒ "接线断了而测试全绿"（本仓常客）。
// 实测代价（用户真账 563 实体）：`location` 真值 0 / 占位值「未明」563——面板整列「未载」。
// 该函数提成**导出**是为了能被真测（与 `autoComposeSource` 同一治法）：注入 fake ST ctx 真跑。
// 失败语义（与查书路同纪律）：**取不到书就返回空数组 = 本轮不推断**，绝不猜位置、绝不阻塞调用方。
export async function bookEntriesForInherit() {
    try {
        const book = await worldBookCached();
        if (!book?.readable) return [];          // 书没挂载/读不到 ⇒ 结构推断没得依据（≠ 书里没有）
        return Array.isArray(book.entries) ? book.entries : [];
    } catch (err) {
        console.warn('[story-world-v2] 位置继承：取书失败（本轮不推断，世界照常推进）', String(err?.message || err));
        return [];
    }
}

// ★leg40：**世界书正文**（供"从世界源起根"用）——与 `bookEntriesForInherit` 同一份缓存，只多拼一段文本。
//   为什么另起一个函数而不是在起根处现拼：取书要 await + 失败兜底，散在调用点会长出第二份"取书口径"。
//   格式与 `autoComposeSource` 的世界信息一致（## 条目名 + 正文），起根提示词与设定抽取读到的就是同一种书文。
//   失败语义同 `bookEntriesForInherit`：**取不到书就返回空文本**（起根会如实报"世界源正文为空"，绝不猜）。
export async function bookTextForRoots() {
    try {
        const book = await worldBookCached();
        if (!book?.readable) return { text: '', entries: 0 };
        const entries = Array.isArray(book.entries) ? book.entries : [];
        const text = entries
            .map((e) => `## ${String(e?.comment || e?.key?.[0] || '').trim()}\n${String(e?.content ?? '')}`)
            .join('\n\n');
        return { text, entries: entries.length };
    } catch (err) {
        console.warn('[story-world-v2] 起根：取书失败（本轮不起根，世界照常载入）', String(err?.message || err));
        return { text: '', entries: 0 };
    }
}

// B6（leg25 d，细案 spec-lookup-batch-refresh §B6）：在条目正文里**定位到该名号自己那一行**。
//   为什么值得做：v2 只会"命中条目→整条给"，而用户的书格式高度规整——
export function locateNameLine(content, name) {    const text = String(content ?? '');
    const nm = String(name ?? '').trim();
    if (!text || !nm) return null;
    // 行首（可带列表符号）出现名号，**紧跟着**冒号或圆括号属性 = 该名号自己那一行；
    //   名号后面先跟别的字（`吞天妖王 与 金刚狮王 (…) 交战。`）⇒ 明确**不认**（防跨名号抓错人）。
    const re = new RegExp(`^[-*·•\\s]*${escapeRegExp(nm)}\\s*(?:[：:]|\\()([^\\n]*)`, 'm');
    const m = re.exec(text);
    return m ? m[0].trim() : null;
}

function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function locateNameSnippet(content, name) {
    const EXPAND = 160;   // 名号前后各取多少字符（够一句上下文，又不至于把整条灌进 prompt）
    // ★边界优先级（leg25 d 的判据抓过一次）：**先找句读/换行（硬边界），找不到才退到逗号（软边界）**。
    //   旧法见逗号就停 ⇒「…吞天妖王于北荒现身，」——把紧跟其后的「气息T8大乘中期」切掉了，
    //   模型看不到档位原话 ⇒ 记 absent ⇒ **假的「书未明述」**（与本仓一直在治的那种病同款）。
    const hardStop = /[\n。！？；]/;
    const softBreak = /[，、]/;
    const text = String(content ?? '');
    const nm = String(name ?? '').trim();
    if (!text || !nm) return null;
    const m = new RegExp(escapeRegExp(nm)).exec(text);
    if (!m) return null;
    const scan = (dir) => {
        let hard = null;
        let soft = null;
        if (dir < 0) {
            for (let i = m.index - 1; i >= 0 && m.index - i <= EXPAND; i -= 1) {
                if (hardStop.test(text[i])) { hard = i + 1; break; }
                if (soft === null && softBreak.test(text[i])) soft = i + 1;
            }
        } else {
            const end = m.index + nm.length;
            for (let i = end; i < text.length && i - end <= EXPAND; i += 1) {
                if (hardStop.test(text[i])) { hard = i; break; }
                if (soft === null && softBreak.test(text[i])) soft = i;
            }
        }
        return { hard, soft };
    };
    const fromSide = scan(-1);
    const toSide = scan(1);
    const from = fromSide.hard !== null ? fromSide.hard : (fromSide.soft !== null ? fromSide.soft : Math.max(0, m.index - EXPAND));
    const to = toSide.hard !== null ? toSide.hard : (toSide.soft !== null ? toSide.soft : Math.min(text.length, m.index + nm.length + EXPAND));
    const seg = text.slice(from, to).trim();
    return seg || null;
}

export function bookEntryText(content, name, cap = 1200) {
    const raw = String(content ?? '');
    const line = locateNameLine(raw, name);
    if (line) return { text: line, located: 'line' };
    const snippet = locateNameSnippet(raw, name);
    if (snippet) return { text: snippet, located: 'snippet' };
    return { text: raw.slice(0, cap), located: 'none' };   // 定位不到才整条截断（cap 内），并如实标 located
}

async function bookTextForEntity(entity) {
    const name = String(entity?.name || '').trim();
    if (!name) return { ok: true, entries: [] };
    let book;
    try {
        book = await worldBookCached();
    } catch (err) {
        console.warn('[story-world-v2] 查书：取书失败（**不是"书里没有"**，不写任何痕迹，下轮再试）', String(err?.message || err));
        return { ok: false };
    }
    if (!book.readable) {
        console.warn('[story-world-v2] 查书：一本书都没读到（世界书没挂载/未加载）——本轮不写痕迹');
        return { ok: false };
    }
    const hit = (book.entries || []).filter((e) => {
        const comment = String(e?.comment || '').trim();
        const keys = Array.isArray(e?.key) ? e.key : [e?.key];
        return comment === name || comment.includes(name) || keys.map((k) => String(k ?? '').trim()).includes(name);
    });
    return {
        ok: true,
        entries: hit.slice(0, 4).map((e) => {
            const picked = bookEntryText(e?.content, name);
            return {
                name: String(e?.comment || name).trim(),
                text: picked.text,
                located: picked.located,
            };
        }).filter((x) => x.text),
    };
}

// ---------- leg25 d：批量补全（借轮次跑；每轮 ≤BATCH_PER_TICK 批） ----------
const BATCH_PER_TICK = 1;          // 每轮最多跑几批（细案 §10 B2：1 批，不拖慢推进）
let sw2BatchTask = null;           // { ids, cursor, done:[], failed:[], success, pending, absent, forceFields, chars }

export function batchTaskStatus() {
    if (!sw2BatchTask) return null;
    const t = sw2BatchTask;
    return {
        total: t.ids.length, cursor: t.cursor, remaining: t.ids.length - t.cursor,
        success: t.success, pending: t.pending, absent: t.absent, failed: t.failed.length,
        forceFields: t.forceFields,
    };
}

export function stopBatchTask() {
    if (!sw2BatchTask) return false;
    sw2BatchTask = null;
    return true;
}

// 渲染 config（渲染层不持状态：任务/快照/记忆自证一律由本层注入）
function renderCfg(extra = {}) {
    // ★★leg46：把**参数真源**与**撤销态**注入渲染层（渲染层不持状态，照本仓既有纪律）：
    //   `paramEnv` ⇒ 面板画的是**真源**（不是滞后一拍的世界账镜像）；
    //   ★★而"真源里没有这个键时该显示什么"（出厂默认）**只由 `hub.displayEnv` 一处裁决**——
    //     leg41 的"四个下拉全空白"就是因为同步逻辑另写了一套"没有就是空"（同一语义两处实现 ⇒ 迟早分叉）。
    //   `paramUndo` ⇒ 撤销按钮的自证面（可退几步）。
    //   ★世界对象用**面板正在渲染的那一份**（`sw2LastWorld`）现取：桶键必须与它同源。
    const w = sw2LastWorld || readHotMeta()?.world || null;
    return {
        ...(modelSettings() || {}),
        lookupTask: batchTaskStatus(),
        snapshots: sw2SnapshotCache,
        memoryPush: sw2MemoryPush,
        paramEnv: paramHub.displayEnv(w),
        paramUndo: sw2ParamUndoState(),
        // ★★leg46 续：自检卡要的读数（世界名/桶键 · 真源 · 引擎镜像 · 主路能不能写）——
        //   渲染层不持状态，一律由本层注入（照本仓既有纪律）。
        paramDiag: gatherParamEvidence(),
        ...extra,
    };
}

// 局部重绘（★leg27 后：`set-param` 原走整页重绘 ⇒ 销毁正在展开的 `<select>` ⇒ 列表自己关）。
// 纪律：只换受影响页签的 innerHTML；失败只上控制台（局部重绘失败不该打断落账那条路）。
// ★★leg40c 续（用户实机「只是展开下拉就弹一句，点了还是改不了值」）：
//   押后逻辑的**定义**已提到 `refreshWorld` 之前（见那一段注释：放这里就是 TDZ 当场炸）。

/**
 * ★★leg46 续·八：**把页面上现存参数控件里的值收起来**（渲染整页之前的"事实采集"）。
 * 为什么需要它（用户第四次实机那张"下拉是 9/12/30/40、四格却写 3默认/6默认/15默认/20默认"的截图）：
 *   那一刻 `paramEnv` 里没有这四个键，渲染层就按"出厂默认"画了格，而**控件上还留着玩家选的值**。
 *   两者不一致时**控件才是事实**（那是玩家的手、也是他刚做成的事）⇒ 用它当**最高优先级覆盖**。
 * @returns {{env: object|null, selects: object}} `env` 只在"有控件值"时非空（否则让渲染层照旧读真源）
 */
export function sw2CollectLiveParamValues() {
    try {
        if (typeof document === 'undefined') return { env: null, selects: {} };
        const win = document.getElementById(WINDOW_ID);
        if (!win) return { env: null, selects: {} };
        const selects = {};
        for (const el of win.querySelectorAll('[data-action="set-param"][data-param]')) {
            const tag = String(el.tagName || '').toUpperCase();
            const key = el.getAttribute('data-param');
            if (!key) continue;
            if (tag === 'SELECT') {
                const v = String(el.value ?? '').trim();
                if (v) selects[key] = v;             // ★空串＝玩家清成未定 ⇒ 不覆盖（让真源/默认照旧说话）
            } else if (tag === 'BUTTON') {
                // 开关：亮着的那一枚按钮写着 data-value="1"
                const on = el.classList?.contains?.('sw2-primary');
                if (on) selects[key] = String(el.getAttribute('data-value') ?? '1');
            }
        }
        if (!Object.keys(selects).length) return { env: null, selects: {} };
        // ★★leg48：基准值取"hub 真正读写过的那个桶"（见 `sw2SetParamControl` 里那段现场记录）
        const base = { ...paramHub.displayEnv(paramHub.currentWorldName() || sw2LastWorld || readHotMeta()?.world || null) };
        // ★★★leg48（**真浏览器现场抓到的最后一环**）：**控件值不许盖住真源**。
        //   现场：玩家选 9 → 真源里已经是 9 → 浏览器把重建出来的 `<select>` 显示成旧值 3
        //   → 这句"控件值覆盖在真源之上"把 **3** 抬成最高优先级 → 面板与格**照着 3 重画一遍**
        //   ⇒ 玩家看到"它自己跳回去了"（而真源里明明是 9）。
        //   ⇒ 定稿（三条顺位，与 `hub.displayEnv` 同一口径）：
        //     ① 真源（`displayEnv`，**绝不许被控件盖住**）
        //     ② 控件现值（只做"真源没写过的那些键"的补充 —— 开关按钮与"书里抽出来的镜像值"靠它，
        //        照 user 第四次实机的原意：**这一类**分歧时控件才是事实）
        //     ③ 灰账（由 hub 在 displayEnv 里兜底）
        //   ★为什么允许控件盖住"账上镜像"（②>③）却不让它盖住真源（①>②）：真源是**玩家的手写下的**，
        //     而镜像只是抄来的旧账；控件"比旧账新"是可能的，控件"比玩家的手新"不可能。
        const OWN = Object.prototype.hasOwnProperty;
        const srcOwn = {};   // 只有"真源/本页权威值里确实有"的键才进这里
        try {
            const tx = paramHub.diag(sw2LastWorld || readHotMeta()?.world || null);
            for (const k of Object.keys(tx?.真源 || {})) srcOwn[k] = true;
            for (const k of Object.keys(tx?.挂起的镜像 || {})) srcOwn[k] = true;
        } catch (_) {}
        const out = { ...base };
        for (const [k, v] of Object.entries(selects)) {
            if (OWN.call(base, k) && srcOwn[k]) continue;   // ★真源说了算 ⇒ 控件不许盖
            out[k] = v;
        }
        return { env: out, selects };   // 采集到的控件值仍原样带出去（给调用方留痕用）
    } catch (err) {
        console.warn('[story-world-v2] 采集控件现值失败（不影响参数本体）', String(err?.message || err));
        return { env: null, selects: {} };
    }
}

// ★★★leg46 续·五/六：**"当前值"那一格的字，只由 `sw2SetParamCell` 一处写**（`data-param-cell="<键>"` 的 `<b>`）。
/** ★leg46 续·九：写格留痕（取证用；不进任何判定）。 */
const sw2CellWriteLog = [];
//   为什么非它不可（用户第三次实机的真形状）：旧法整块重画参数页 ⇒ 控件在玩家手底下被销毁重建
//   ⇒ 浏览器再吐一笔**带旧值**的事件 ⇒ "点一次空白写两次，第二笔把 9 覆盖回 3"。
//   ★第六轮补的那一刀（用户第四次实机：四个下拉都选对了、四格却写「未定」）：格与控件必须**同源** ——
//     格的值必须由调用方把"这一次渲染/这一次改动用的那份真源"传进来，**不许自己再读一遍**。
/**
 * ★★★**唯一的"格该显示什么"的写手**（`data-param-cell="<键>"` 的 `<b>`）——**只读控件，不读别处**。
 *
 * ＝＝ 为什么最终是这个形状（用户五轮实机把我逼到这一步）＝＝
 * 前面四版都错在同一件事上：**"格"和"控件"各自去问一个数据源**（真源 / 注入的 env / 我自己算的判定），
 * 于是只要有一刻两边读到的不是同一份，画面就自相矛盾：
 *   · 下拉是 9、格写「未定」；· 下拉是 12、格写「6默认」；· 改完当场变「未定」……
 *   **每一次都是"两个来源、一个瞬间的错位"，不是"某一笔没落下去"。**
 * ⇒ 定稿（把这类错位**从结构上删掉**）：**格子里写什么，只看同一行那个控件自己的值**。
 *   控件是 12，格就是 12 —— 两者**在同一个节点树里、同一时刻读**，物理上不可能不一致。
 *   真源/引擎/审计那一侧对不对，交给**自检卡**去说（那是它的活），**不拿它来决定这一格显示什么**。
 *
 * ＝＝ 规矩（都能机械核；判据 ⑯ 锁着）＝＝
 *   ① **只读控件**（同一卡片里的 `[data-action="set-param"]`），**绝不改控件**（控件是玩家的手）；
 *   ② **只写这一格的字**（`textContent`），不碰结构、不碰事件、不新建/销毁节点；
 *   ③ `<select value="">` 或开关"关" ⇒ 写「未定」；有值 ⇒ 写那个值（**不带任何小标**）；
 *   ④ 找不到对应控件 ⇒ **什么都不做**（退回让渲染层画，绝不自己猜一个值出来）。
 */
export function sw2SetParamCell(key) {
    try {
        if (typeof document === 'undefined') return false;
        const win = document.getElementById(WINDOW_ID);
        if (!win) return false;
        const ctl = sw2ParamControlOf(win, key);
        if (!ctl) return false;                       // ★找不到控件就退让（绝不自己编一个值）
        const text = sw2ControlText(ctl);
        // ★写格留痕（取证用；不进任何判定）
        try {
            sw2CellWriteLog.push(`${new Date().toISOString()} ${key} ← ${JSON.stringify(text)}（读自控件）`);
            if (sw2CellWriteLog.length > 30) sw2CellWriteLog.shift();
        } catch (_) {}
        for (const el of win.querySelectorAll('[data-param-cell]')) {
            if (el.getAttribute('data-param-cell') !== key) continue;
            if (el.textContent !== text) el.textContent = text;
        }
        return true;
    } catch (err) {
        console.warn('[story-world-v2] 就地刷新参数格失败（不影响参数本体）', String(err?.message || err));
        return false;
    }
}

/** 找出这一格对应的**控件**（同一张卡片里的 `[data-action="set-param"]`）。找不到返回 null。 */
function sw2ParamControlOf(win, key) {
    try {
        const sel = win.querySelector(`[data-action="set-param"][data-param="${key}"]`);
        if (sel) {
            const tag = String(sel.tagName || '').toUpperCase();
            if (tag === 'SELECT' || tag === 'INPUT') return sel;
            return null;                               // 一排开关按钮的情况下面单独处理
        }
        // 开关：一排按钮里"亮着的那一枚"代表开（`.sw2-primary`），都没亮 ⇒ 关
        const btns = [...win.querySelectorAll(`[data-action="set-param"][data-param="${key}"]`)];
        if (!btns.length) return null;
        const on = btns.find((b) => b.classList?.contains?.('sw2-primary')) || null;
        return on || btns[btns.length - 1];            // 关的时候用最后一枚（"关"那枚）代表状态
    } catch (_) { return null; }
}

/** 控件现值 → 这一格该显示的字（**唯一的取值处**）。 */
function sw2ControlText(ctl) {
    try {
        const tag = String(ctl.tagName || '').toUpperCase();
        if (tag === 'SELECT' || tag === 'INPUT') {
            const v = String(ctl.value ?? '').trim();
            return v || '未定';
        }
        if (tag === 'BUTTON') {
            return ctl.classList?.contains?.('sw2-primary') ? '开' : '未定';
        }
    } catch (_) {}
    return '未定';
}

/**
 * ★★★leg48：**把控件按真源对齐**（一笔参数操作结束之后调一次；下拉专用）。
 *
 * ＝＝ 为什么必须有它（用户实机状态条「每轮递几条线 → 未定（已存进本地存储 · 已同步给引擎）」）＝＝
 * 那一屏的形状：**控件空着**（浏览器/滚轮/重画吐了一笔空值），面板于是把"空"当成一次改动，
 * 而"格"又只读控件 ⇒ 格写「未定」 ⇒ 玩家看到的是"我的档位没了"。刷新之后真源里那一格回来，
 * 就成了他报了十几轮的那句话：**"改了档位，刷新之后回默认"**。
 * ⇒ 定稿（一条可机械核的纪律）：**控件的值 = 真源的裁决值**，每一笔操作结束时按真源对齐一次。
 *   · 写成功 ⇒ 真源就是玩家选的那一档（控件原地不动，两边天然一致）；
 *   · 空值/非法/失败 ⇒ 控件**退回真源那一档**（"手滑到空"不再留在屏幕上冒充一次改动）。
 *   ★它只写 `<select>` 的 `value`，**不新建/不销毁任何节点**（旧法整块 `innerHTML` 重画会把玩家
 *     手底下的控件销毁重建 ⇒ 浏览器对**新节点**再吐一笔带旧值的事件 ⇒"点一次写两次"）。
 *   ★找不到这个键的控件 / 不是下拉（开关按钮有它自己的画法）⇒ **什么都不做**（退让）。
 */
export function sw2SetParamControl(key) {
    try {
        if (typeof document === 'undefined') return false;
        const win = document.getElementById(WINDOW_ID);
        if (!win) return false;
        const el = win.querySelector(`[data-action="set-param"][data-param="${key}"]`);
        if (!el || String(el.tagName || '').toUpperCase() !== 'SELECT') return false;
        // ★裁决只问一处：`paramHub.displayEnv`（真源 > 本页刚写的权威值 > 账上镜像 > 出厂默认）
        // ★★★leg48：**桶名取"hub 真正读写过的那个桶"**（`currentWorldName()`），不取"当下那个世界对象"——
        //   病因（真浏览器现场）：`loadWorld` 走空态/轮转失败时把**空态世界**交给面板，
        //   面板于是去读"未名世界"那个空桶 ⇒ 按出厂默认把控件写成 3，而玩家的档位其实在"大荒z"桶里。
        //   读的桶必须与写的桶是同一个 —— 这一条被违反过九轮，是"改了回默认"的机理。
        const env = paramHub.displayEnv(paramHub.currentWorldName() || sw2HubLastWorld || sw2LastWorld || readHotMeta()?.world || null);
        const want = Object.prototype.hasOwnProperty.call(env, key) ? String(env[key]) : '';
        if (String(el.value ?? '') === want) return false;      // 已经一致 ⇒ 一个字节都不动
        el.value = want;
        console.info(`[story-world-v2] 参数控件按真源对齐：${key} → ${JSON.stringify(want || '未定')}`);
        return true;
    } catch (err) {
        console.warn('[story-world-v2] 控件对齐失败（不影响参数本体）', String(err?.message || err));
        return false;
    }
}

/**
 * ★★**把参数页上所有显示格，按各自的控件对齐**（用户改了值/页面重画之后各调一次）。
 * 这是"格与控件永不分叉"的**唯一入口**——判据 ⑯ 锁的就是"页面上不存在'控件是 12 而格不是 12'"。
 */
export function sw2SyncParamCells() {
    try {
        if (typeof document === 'undefined') return 0;
        const win = document.getElementById(WINDOW_ID);
        if (!win) return 0;
        const keys = new Set([...win.querySelectorAll('[data-param-cell]')].map((el) => el.getAttribute('data-param-cell')));
        let n = 0;
        for (const k of keys) if (k && sw2SetParamCell(k)) n += 1;
        return n;
    } catch (_) { return 0; }
}

function refreshSections(names) {
    if (typeof document === 'undefined') return;
    sw2SectionRefreshRunning = true;
    try {
        const win = document.getElementById(WINDOW_ID);
        if (!win || !sw2LastWorld) return;
        const out = renderAll(sw2LastWorld, { config: renderCfg(), oldVolumes: LISTED_VOLUMES, view: { chronicleFilter: sw2ChronicleFilter, entsView: sw2EntsView } });
        for (const name of names || []) {
            const el = win.querySelector(`#sw2_view_${name}`);
            if (!el) continue;
            // ★玩家正在这一页上下拉/点按钮 ⇒ 这一页押后（否则等于把他的手从控件上打掉）
            if (playerIsTouchingParams() && el.contains(document.activeElement)) {
                pendingSectionRefresh.add(name);
                console.info(`[story-world-v2] ${name} 页上有控件正被操作 —— 本次重绘押后（避免销毁正在展开的下拉）`);
                continue;
            }
            if (name === 'board') {
                el.innerHTML = typeof out.board === 'string' ? out.board : BOARD_BLOCK_ORDER.map((k) => (out.board && out.board[k]) || '').join('');
            } else if (typeof out[name] === 'string') {
                el.innerHTML = out[name];
            }
        }
    } catch (err) {
        console.warn('[story-world-v2] 局部重绘失败（不影响落账）', String(err?.message || err));
    } finally {
        // ★重绘**自己**会换掉 DOM（被换掉的控件若正持焦点，浏览器会派发 focusout）
        //   ⇒ 不在这里清掉标志，"补上押后的重绘"就会自己咬自己（实测会多跑一轮空刷新）。
        sw2SectionRefreshRunning = false;
    }
}

function batchStatusText() {
    const s = batchTaskStatus();
    if (!s) return null;
    return `批量补全：第 ${s.cursor}/${s.total}（成功 ${s.success} · 待补 ${s.pending} · 书未载 ${s.absent} · 失败 ${s.failed}）`;
}

// ---------- leg27：抽取进度（用户「十多分钟了还是没抽好，我也看不到日志」那一刀） ----------
// 进度文案：按**真实已花时间**算（旧法用"已完成段之和" ⇒ 正在跑的那段不在里面 ⇒ 恒显 0 秒 = 用户说的「读秒没变」）
function extractionProgressText(events, elapsedMs) {
    const fin = (events || []).filter((e) => e && e.phase === 'finish');
    const done = fin.filter((e) => e.ok).length;
    const spent = Number.isFinite(elapsedMs) ? elapsedMs : fin.reduce((n, e) => n + (Number(e.ms) || 0), 0);
    const mins = Math.floor(spent / 60000);
    const secs = Math.floor((spent % 60000) / 1000);
    const cost = mins ? `${mins} 分 ${String(secs).padStart(2, '0')} 秒` : `${secs} 秒`;
    const cur = (events || []).filter((e) => e && e.phase === 'start').slice(-1)[0] || null;
    if (cur && cur.step === 'chunk') {
        return `⏳ 抽取中 · 名册第 ${cur.index}/${cur.count} 块（${cur.chars} 字符）· 已 ${done} 段 · 已花 ${cost}`;
    }
    return `⏳ 抽取中 · 设定（${cur ? cur.chars : '—'} 字符）· 已花 ${cost}`;
}

/**
 * 抽取进度处理器（leg27 F1/F1b）——导出以便**真测**（注入假计时器验"读秒在跳"）。
 * 心跳口径：每 `intervalMs` 按**真实已花时间**重写一次状态栏；每 `heartbeatMs` 在控制台留一行"仍在跑"
 * （"看不见在动"与"已经死了"在界面上完全同形——这是用户实机两次反馈逼出来的）。
 */
export function extractionProgressHandler(events, { setText = setStatus, intervalMs = 1000, now = () => Date.now(), setTimer = setInterval, clearTimer = clearInterval, log = (m) => console.info(m), heartbeatMs = 30000 } = {}) {
    let timer = null;
    let startedAt = null;
    let lastText = null;
    let heartbeatAt = null;
    const render = (elapsedOverride) => {
        const elapsed = Number.isFinite(elapsedOverride) ? elapsedOverride : (startedAt == null ? null : now() - startedAt);
        const text = extractionProgressText(events, elapsed);
        lastText = text;
        try { setText(text); } catch (_) {}
        return text;
    };
    const tick = () => {
        try {
            render();
            if (heartbeatAt == null || now() - heartbeatAt >= heartbeatMs) {
                heartbeatAt = now();
                const cur = (events || []).filter((e) => e && e.phase === 'start').slice(-1)[0] || null;
                const done = (events || []).filter((e) => e && e.phase === 'finish' && e.ok).length;
                const label = cur ? (cur.step === 'canon' ? '设定' : `名册第 ${cur.index}/${cur.count} 块`) : '（准备中）';
                try {
                    log(`[story-world-v2] 抽取仍在跑：${label} · 已 ${done} 段 · 已花 ${Math.round((startedAt == null ? 0 : now() - startedAt) / 1000)} 秒（这一段还没返回属正常，单块是分钟级）`);
                } catch (_) {}
            }
        } catch (_) {}
    };
    const stop = () => {
        if (timer == null) return;
        try { clearTimer(timer); } catch (_) {}
        timer = null;
    };
    return {
        onEvent: (ev) => {
            try {
                const label = ev.step === 'canon' ? '设定' : `名册第 ${ev.index}/${ev.count} 块`;
                if (ev.phase === 'start') {
                    if (startedAt == null) {
                        startedAt = now();
                        timer = setTimer(tick, intervalMs);      // ★心跳：让"它没死"每秒都看得见
                        if (typeof timer?.unref === 'function') timer.unref();   // Node 侧别把进程吊住
                    }
                    console.info(`[story-world-v2] 抽取调用：${label} 开始（输入 ${ev.chars} 字符）`);
                    render(0);                                    // 立刻出一次（别等 1 秒）
                } else {
                    console.info(`[story-world-v2] 抽取调用：${label} ${ev.ok ? '完成' : '失败'}（${ev.chars} 字符 · ${((ev.ms || 0) / 1000).toFixed(1)}s${ev.ok ? '' : ` · ${ev.error}`}）`);
                    render();
                }
            } catch (_) { /* 进度上报绝不影响抽取 */ }
        },
        stop,
        _state: () => ({ running: timer != null, lastText }),   // 供判据观测（"读秒在跳"必须可验）
    };
}

// ---------- leg25 d：查书补全的两个入口（面板行内「查/重查」+ 批量补全） ----------
export async function lookupOneEntity(id, { forceFields = null } = {}) {
    const world = loadHotAccount(readHotMeta()) || sw2LastWorld;
    if (!world) return { ok: false, error: '还没有世界' };
    const settings = modelSettings();
    const resolved = resolveBrowserTransport(settings);
    if (!resolved) return { ok: false, error: '模型通道未配置' };
    const { entity, missing } = pickOneForLookup(world, id, { forceFields });
    if (!entity) return { ok: false, error: '账上没有这个实体' };
    if (!missing.length) return { ok: false, error: '这一栏已经有原话了（要连「书未明述」一起推倒重查，用页顶的「补全全册实力」）' };
    const res = await runBatchLookup({
        ssot: world, transport: diagExtract(resolved), bookText: bookTextForEntity,
        ids: [id], forceFields, tick: world?.meta?.tick ?? 0,
        bookEntries: await bookEntriesForInherit(),   // ★leg25 f：这条路也必须吃位置继承（零 token 兜底）
    });
    if (!res.stats) return { ok: false, error: res.warning || '查书未成' };
    writeHotMeta(hotAccountShape(res.ssot));
    await flushHotMeta();
    sw2LastWorld = res.ssot;
    refreshWorld(res.ssot, { oldVolumes: LISTED_VOLUMES });
    return { ok: true, stats: res.stats, warning: res.warning, entity: res.ssot.entities.find((x) => x.id === id) };
}

export function startBatchTask({ forceFields = 'absent', ids = null } = {}) {
    const world = loadHotAccount(readHotMeta()) || sw2LastWorld;
    if (!world) return { ok: false, error: '还没有世界' };
    const all = (ids && ids.length) ? ids : (world.entities || []).filter((e) => e.status !== 'dead' && e.status !== 'retired').map((e) => e.id);
    sw2BatchTask = {
        ids: all, cursor: 0, failed: [], success: 0, pending: 0, absent: 0, forceFields,
    };
    return { ok: true, total: all.length };
}

async function runBatchChunk(resolved) {
    const t = sw2BatchTask;
    if (!t) return null;
    const world = loadHotAccount(readHotMeta()) || sw2LastWorld;
    if (!world) { sw2BatchTask = null; return { warning: '世界不在了，批量补全中止' }; }
    const { batches } = await planBatchesLazy(world, t);
    if (!batches.length) {
        const summary = `批量补全完成：成功 ${t.success} · 待补 ${t.pending} · 书未载 ${t.absent} · 失败 ${t.failed.length}`;
        sw2BatchTask = null;
        return { warning: null, done: true, summary };
    }
    const batch = batches[0];
    const res = await runBatchLookup({
        ssot: world, transport: diagExtract(resolved), bookText: bookTextForEntity,
        ids: batch.ids, forceFields: t.forceFields, tick: world?.meta?.tick ?? 0,
        bookEntries: await bookEntriesForInherit(),   // leg25 f：批量补全同样吃位置继承
    });
    t.cursor += batch.ids.length;
    if (res.stats) {
        t.success += res.stats.ok || 0;
        t.pending += res.stats.pending || 0;
        t.absent += res.stats.absent || 0;
    } else {
        t.failed.push(...batch.ids);
    }
    if (res.ssot) {
        writeHotMeta(hotAccountShape(res.ssot));
        await flushHotMeta();
        sw2LastWorld = res.ssot;
    }
    return { warning: res.warning, done: false };
}

async function planBatchesLazy(world, task) {
    const rest = task.ids.slice(task.cursor);
    if (!rest.length) return { batches: [] };
    return planBatches({ world, ids: rest, forceFields: task.forceFields, bookText: bookTextForEntity });
}

// ---------- K36：每轮演化（前置步 + 主调用 + 落盘点） ----------
async function advanceTick({ world, dialogue }) {
    const settings = modelSettings();
    sw2LastSettings = settings;
    const resolved = resolveBrowserTransport(settings);
    if (!resolved) {
        return { ok: false, error: '模型通道未配置（设置页填写服务地址/密钥/模型）' };
    }
    const res = await runTick({
        transport: resolved.transport, ssot: world, dialogue, extractCtx: {},
        // 前置步：① 选本轮上场实体（LLM，≤15）→ ② 只对缺字段者查书（模型）→ ③ 引擎回写查书标记。
        // 失败零阻塞：任一步失败都退回引擎镜头，世界照常推进（细案 §4）。
        // leg25 d 追加：批量补全**借轮次**跑在这里（每轮 ≤BATCH_PER_TICK 批）——世界照常推进，
        //   补全是搭车的；两条路都走同一个 runBatchLookup 收口。
        preStep: async ({ ssot: cur, move }) => {
            const pre = await runEntityLookupStep({
                ssot: cur,
                transport: diagExtract(resolved),
                bookText: bookTextForEntity,
                tick: cur?.meta?.tick ?? 0,
                moveFact: move,
                prevPicks: sw2LastPicks,
                // leg25 f：每轮前置步那条路也要吃位置继承（零 token，不占模型预算）
                bookEntries: await bookEntriesForInherit(),
            });
            // ★leg34：世界书检索注入**不在这里**——它放在 `runTick` 里（`injectWorldBookRecall`），
            //   因为那一步要读**本轮选中的 picks**（`pre.picks`），而 `runTick` 正好在 preStep 之后、
            //   出包之前拿到它 ⇒ **一处执行、顺序天生正确**，也不会重复检索。
            if (!sw2BatchTask) return pre;
            let world2 = pre?.ssot || cur;
            for (let i = 0; i < BATCH_PER_TICK; i += 1) {
                if (!sw2BatchTask) break;
                const r = await runBatchChunk(resolved);
                if (r?.done) { setStatus(r.summary); break; }
                if (r?.warning) console.warn('[story-world-v2] 批量补全:', r.warning);
            }
            // 批量改了账 ⇒ 把前置步的 ssot 换成批量后的（落盘点据此写盘）
            if (sw2LastWorld) world2 = sw2LastWorld;
            setStatus(batchStatusText());
            return { ...pre, ssot: world2 };
        },
        // 落盘点：前置步的新字段**必须落盘**，否则 Ctrl+F5 一次就重查一遍（细案 §7）。
        onPreStep: async (pre) => {
            if (!pre?.ssot) return;
            if (pre.picks) sw2LastPicks = pre.picks;
            if (pre.warning) console.warn('[story-world-v2] 查书前置步:', pre.warning);
            const shapeBefore = readHotMeta()?.world;
            if (shapeBefore && pre.ssot.meta?.entityFields !== shapeBefore.meta?.entityFields) {
                writeHotMeta(hotAccountShape(pre.ssot));   // 内存与盘上一致（导出/刷新读的就是这里）
                await flushHotMeta();
            }
        },
    });
    // ★leg40b 续（死锁修复）：降级路径**单独出一行**（此前只有 panel 裁定条里那句话）。
    //   为什么单独打：这条路径的语义是"这一轮不是模型写的那一轮"——它必须**能复盘**：
    //   丢了哪几条、原始拒因是什么。（面板裁定条只截前几条，控制台留全量。）
    if (res?.healed?.used) {
        console.warn('[story-world-v2] 本轮走了降级路径（世界照常前进，没停摆）', {
            kind: res.healed.fallback ? '世界安静一步（提议全部未落账）' : '降级重试（丢掉写歪的提议后落账）',
            dropped: (res.healed.dropped || []).map((d) => `${d.family}「${d.label || d.index}」：${d.reason}`),
            errors: res.healed.errors,
            warnings: res.healed.warnings,
        });
    }
    return res;
}

export function setupAsyncTicks(ctx) {
    if (sw2TickQueue) return;
    const es = ctx?.eventSource;
    const et = ctx?.eventTypes || ctx?.event_types;
    sw2TickQueue = createTickQueue({
        tick: advanceTick,
        load: () => loadHotAccount(readHotMeta()),
        // E2：轮转失败不再当成功——抛给队列（async-tick 的 save 失败面：报「落账失败…可重试」、
        // 不 refresh、世界原样；旧实现返回原世界被当 succeed → 界面报「已同步」而盘上什么都没写）。
        save: async (ssot) => {
            const rot = await ensureChronicleRotated(ssot);
            if (!rot.ok) throw new Error(rot.error);
            // leg26 b：记忆投递（开关控制；**失败零阻塞**——绝不因为它让世界推进失败）
            // leg27 h：投完**如实上报**（面板/状态栏/控制台三处自证；失败也不阻断世界）
            if (switchOn(rot.hot, 'memoryEnabled')) {
                const r = await pushMemoryNow(rot.hot).catch(() => ({ ok: false, reason: '抛错（见控制台）' }));
                markMemoryPush(r, rot.hot?.meta?.tick);   // 状态栏那一句由 refreshWorld 统一报（顺序上它才是最后写状态栏的）
                // ★leg29：投完**当场自检**并把结果打出来。为什么接在这里而不是等用户手抄控制台：
                //   实机出现"控制台说投成了、插件里却看不到"的矛盾，而盘上那份是被 `saveChat()` 落盘的
                //   **运行时对象**——只有投完那一刻的内存真相能回答"到底写没写进去"。一行，好抄也好贴。
                if (r?.ok) console.info(memoryStoreCheckLine());
            } else if (sw2MemoryPush) {
                sw2MemoryPush = null;   // 开关关了 ⇒ 自证面归零（不许留着上一次的"已投"冒充本次）
            }
            return rot.hot;
        },
        refresh: (hot) => { refreshWorld(hot, { oldVolumes: LISTED_VOLUMES }); },
        onStatus: setStatus,
    });
    es?.on?.(et.MESSAGE_RECEIVED, () => {
        // ★leg33d 总闸：关掉时**不自动推进**（但说一句，别让用户以为插件坏了或以为推过了）。
        //   闸的判据提成导出的纯函数 `sw2OnMessageReceived` —— 为的是**能真测**（本仓铁律：
        //   "要真 ctx 的接线，要么提成可导出函数真跑，要么写注入 fake ctx 的测试"）。
        sw2OnMessageReceived(loadHotAccount(readHotMeta()), {
            advance: () => sw2TickQueue.advance().catch(() => {}),
            setStatus,
        });
    });
    // ★★★leg48：**吞错可以，沉默不行**（见 `initPanel` 里那句注释：载入失败被空 `.catch` 吞掉，
    //   是"世界没到"这件事十二轮不可见的直接原因）。
    es?.on?.(et.CHAT_CHANGED, () => {
        loadWorld().catch((err) => console.warn('[story-world-v2] 切聊天后载入世界失败（面板照常可用）：', err));
    });
}

// 卷清单缓存（K36 接线用；loadWorld/导入后刷新）
let LISTED_VOLUMES = [];

// 原 listOldVolumes 保持语义（K35），refreshWorld 用缓存清单
async function listOldVolumes() {
    try {
        return await volumeStore().list();
    } catch (_) {
        return [];
    }
}

// 幂等冷档轮转 + 热账写回：编年超阈值 → 前置段入卷；且**无论是否轮转都写热账**。
// （第十三棒修复：原实现只在入卷分支 writeHotMeta——无轮转路径推进后的世界从不落盘，
//  只活在内存/DOM，刷新即回滚到推进前。loadWorld 也走此入口，幂等无副作用。）
// 审计修复 E1：卷号从热账读（nextVolume，跨页面刷新延续）→ 卷库实有清单校正 →
//   写回 hotAccountShape(带新 nextVolume)，第二卷起不再覆盖第一卷。
// 审计修复 E2（执行序纪律）：**先入卷库、成功后才允许剥段写回**——volumeStore().put 抛错时
//   绝不写热账、绝不返回剥了段的世界；返回 {ok:false} 由调用方如实上报（旧实现 catch 掉异常
//   返回原世界，界面照报「已同步」= 内存改了、盘上没写、界面说成功）。
// 返回 {ok, hot, volume}：ok:false = world 原样（热账/内存一致，无静默失败面）。
async function ensureChronicleRotated(world) {
    const nextVolume = nextVolumeOfHotMeta();
    let volumes = [];
    try {
        volumes = await volumeStore().list();   // 卷库清单（也作卷号校正依据）
    } catch (err) {
        return { ok: false, hot: world, error: `卷库不可读：${shortErr(err)}` };
    }
    const plan = planChronicleRotation({ world, nextVolume, volumes });
    if (!plan.mustRotate) {
        writeHotMeta(hotAccountShape(world));   // 无轮转也写回（第十三棒语义不变）
        return { ok: true, hot: world, volume: null };
    }
    try {
        await volumeStore().put(plan.volume);   // 先落卷：只有它成功，才允许提交"剥了段"的世界
    } catch (err) {
        // 写失败 = 世界不动（热账一行不少、内存与盘上一致），如实上报给调用方
        return { ok: false, hot: world, error: `卷「${plan.volume.id}」入卷失败：${shortErr(err)}` };
    }
    // E2 执行序收口：落卷成功之后才用 applied（剥段后 + nextVolume 已 +1）覆盖热账
    writeHotMeta(hotAccountShape(plan.applied));
    return { ok: true, hot: plan.applied, volume: plan.volume };
}

// 热账里的下一卷号（E1：旧账无此字段 → 1；planChronicleRotation 再用卷库清单兜底校正）
function nextVolumeOfHotMeta() {
    const meta = readHotMeta();
    return Number.isInteger(meta?.nextVolume) && meta.nextVolume > 0 ? meta.nextVolume : 1;
}

function shortErr(err) {
    return String(err?.message || err || '未知错误');
}

// 世界注入入口（K36 推进后 / 导入后 / 加载热账后调用）
// 第二十五棒 e：名册落账（**可重入**）——世界加载与初始化共用同一个收口。
// 为什么需要它：这一步在 leg24 之后只搬 name/kind，而**已建好的世界是持久化的**（账停在当年那份代码上）
//   ⇒ 归属/档位/规模那块永远缺。把它做成幂等可重入、挂在世界加载上 ⇒ 老世界一刷新就自己补上。
// 安全性质（全部有测试锁）：幂等（第二次 zero 变化）、只填空栏、不新建实体（`seeded` 恒 0）、
//   零 token（纯读真书正文，不调模型）、不碰世界进度（tick/事件/盘算/编年/权重/已查字段）。
// 提成导出函数是为了**能被真测**：写在 loadWorld 里就只能测它的复制品（本仓纪律：测试不许自带被测逻辑的复制品）。
export function seedAndBackfill(hotWorld, { entries = [] } = {}) {
    const before = countLedgerEntries(hotWorld);
    const seed = seedBookEntities(hotWorld, { entries });
    const seededDelta = countLedgerEntries(hotWorld) - before;
    const backfilled = (seed.fieldsAttached ?? 0) + (seed.parentVerified ?? 0);
    return { seed, seededDelta, backfilled, changed: seed.seeded > 0 || seededDelta > 0 || backfilled > 0 };
}

/**
 * ★★leg40：**从世界源起根**（把书里"正在发生的事"落成账上的线头事件）。
 *
 * 病根（本棒实测）：世界源被抽成了**静态设定**（不进包）与**名册 751 条**（只有 name+kind，**0 条起过事**）
 *   ⇒ 全账 65 条事件里第 25 轮之前只有 1 条（`ev_1_1`），**世界的根来自聊天、不是世界源**
 *   ⇒ 模型每轮可引用的节点只有那场大乱（59 轮起过 9 条线头、**0 条被接续**）。
 * 治法三步：**① 起根（本函数）→ ② 接续（`pack.js` 的 openRoots/threads + 提示词第 14 条）→ ③ 补根（线头不够时再起一次）**。
 *
 * ★★两条路**同一套参数**（本函数是唯一收口；2026-09-14 修正——第一版初始化那条走的是"只发前 3 万字、无候选池"的老法，
 *   新开世界会比移植那批差一档）：
 *   · **分块覆盖全书**（`chunkBookText`，`--chunk-chars` 同量级 60000）——老法只发前 30,000 字符（那本书的 9.8%）；
 *   · **候选池**：把账上"从没被事件点过名的实体名"递给模型，要求当事人从名单里挑（种子自带"谁"、天生不与那场大乱的人重叠）。
 * 纪律：**幂等**（同一本书只种一次，`meta.seedRoots` 记指纹）· **失败零阻塞** · **不碰世界进度**（当事人必须是账上真有的实体名）。
 * 提成导出是为了**能被真测**（注入真 extract 真跑），与 `seedAndBackfill` 同治法。
 */
export async function seedRootsForWorld(hotWorld, { sourceText = '', extract = null, fresh = false, minRoots = 3, chunkChars = SEED_CHUNK_CHAR, candidates = null, onProgress = null } = {}) {
    if (typeof extract !== 'function') return { ok: false, skipped: true, reason: '没有可用的抽取通道' };
    const src = String(sourceText ?? '');
    // 指纹：**够用的确定性短哈希**（幂等判据只需要"同一本书得到同一个串"——不追求密码学强度）。
    //   为什么不复用 `bookFingerprint`：那个函数在 leg24 片1 随"补抽"整条从编排层移除（见上方 import 注释），
    //   而这里只要一个"同书同串"的稳定键 ⇒ 本地三行足够，不为此把删掉的依赖请回来。
    let h = 0;
    for (let i = 0; i < src.length; i += 1) h = (Math.imul(31, h) + src.charCodeAt(i)) | 0;
    const fp = `seed:${src.length}:${chunkChars}:${(h >>> 0).toString(36)}`;
    // 候选人名单：缺省 = 账上"从没被任何事件点过名的 active 实体名"（机械，零语义）
    const pool = Array.isArray(candidates) ? candidates : (() => {
        const named = new Set();
        for (const e of hotWorld.events || []) for (const r of e.ripples || []) named.add(r);
        return (hotWorld.entities || [])
            .filter((e) => (e.status || 'active') === 'active' && !named.has(e.id) && e.id !== hotWorld.context?.playerId)
            .filter((e) => typeof e.name === 'string' && e.name.length >= 2 && e.name.length <= 12)
            .map((e) => e.name)
            .slice(0, SEED_CANDIDATES_TOP);
    })();
    const chunks = chunkBookText(src, chunkChars);
    const r = await seedRootsChunked({
        ssot: hotWorld, chunks, extract, candidates: pool, fingerprint: fp, at: new Date().toISOString(),
        maxPerChunk: Math.max(1, Math.ceil(SEED_ROOTS_MAX / Math.max(1, Math.min(chunks.length, 4)))),
        onProgress,
    });
    if (r.warnings?.length) console.warn('[story-world-v2] 起根净化剔除', { warnings: r.warnings.slice(0, 6), skippedParties: r.skippedParties });
    if (r.ok && !r.skipped) {
        console.info('[story-world-v2] 起根完成（世界源 → 线头）', { seeded: r.seeded, ids: r.ids, fresh, chunks: chunks.length, candidates: pool.length, fingerprint: fp });
    }
    return { ...r, fingerprint: fp, chunkCount: chunks.length, candidateCount: pool.length };
}

/**
 * 位置继承（零 token 结构推断）——挂加载期，与名册落账同一份条目。
 * 提成导出是为了真测（注入真条目真跑），与 `seedAndBackfill` 同治法。
 */
export function inheritLocations(world, { entries = [] } = {}) {
    if (!Array.isArray(entries) || !entries.length) return { ssot: world, inherited: 0 };
    const d = deriveLocationFromBook({ world, entries });
    return { ssot: d.ssot, inherited: d.stats?.inherited ?? 0 };
}

export async function loadWorld() {
    resetBookCache();   // leg25 d：取书缓存与聊天/卡绑定——每次载入世界都必须重取（否则换卡换书还吃旧缓存）
    const meta = readHotMeta();
    const world = meta ? loadHotAccount(meta) : null;
    if (!world) {
        LISTED_VOLUMES = [];
        refreshWorld(EMPTY_WORLD, { oldVolumes: [] });
        setStatus('还没有世界 · 点「✨ 开始新世界」（或「⬆ 导入恢复」一份旧档）');
        return;
    }
    // ★★载入期的参数口径（三条，都能机械核）：
    //     ① 参数的**真源**在插件自己的存储里 ⇒ 载入时以它为准写进 `dynamic.env`（镜像）；
    //     ② **账上已有、真源里没有**的键（旧账 / 从前写在 env 里的档位）**一次性接纳进真源**——
    //        否则升级后玩家会看到自己的档位"消失了"（那是事故，不是升级）；
    //     ③ 从此**没有第三份**存储（leg40c 那个 `sw2_pending_params` 兜底桶已随 leg41 撤除）。
    //   ★这个顺序（放在 `ensureChronicleRotated` 之前）沿用 leg40c 的教训：参数与卷轮转无关，
    //     轮转失败不该连带让参数处理不到。
    // ★★★leg46：**载入期一次做完**（接纳账上已有的参数 + 合并进真源 + 镜像回世界账）——
    //   三件事都在 `paramHub.commit(world)` 里，一次事务、一个桶键、一份核对结果。
    //   旧版把它们摊在本文件里（各算一次世界名、各写一次存储）⇒ 这正是"读一个桶、写另一个桶"的温床。
    const adopted = paramHub.commit(world);
    sw2HubLastWorld = world;
    // ★★★leg48：**把"世界没到那一刻"写下的档位一次补进世界账**（幂等）。
    //   为什么必须有这一步（本棒治"改了回默认"的另一半）：写入口已经和世界解耦了 ——
    //   世界对象没到 ⇒ 真源照写、引擎那一格挂起 ⇒ **必须在这里补上**，否则"面板改了、引擎按旧档跑"。
    //   顺序放在 `commit` 之后：先接纳账上已有的，再把本会话写过的补齐（两次都是幂等纯函数）。
    const flushed = paramHub.flushPending(world);
    const flushedWorld = flushed.world || null;
    const paramsAdopted = adopted.adopted;
    const paramsMirrored = adopted.mirrorChanged || flushed.changed;
    if (flushed.changed) {
        console.info('[story-world-v2] 载入期把"世界没到那一刻"写下的档位补进世界账', {
            键: flushed.keys.join('、'), 世界名: adopted.worldName,
        });
    }
    void flushed;   // ★leg48：这里只用到 `flushed.world / .changed / .keys`（末尾那次"世界成型后再补"同一口径）
    if (paramsMirrored) {
        // ★leg48：两路都算（`commit` 的接纳 + `flushPending` 的补镜像）——取"真的动过的那一份"。
        const mirroredNow = flushedWorld || adopted.world;
        world.context.setting = mirroredNow.context.setting;   // 只换 setting（世界其余部分原地不动）
        console.info('[story-world-v2] 载入期把参数真源镜像进世界账', {
            参数: Object.keys(adopted.env).join('、') || '（无）',
            接纳进真源: paramsAdopted ? '是' : '无需',
            补进了挂起的: flushed.changed ? flushed.keys.join('、') : '无',
            世界名: adopted.worldName,
        });
    }
    if (adopted.note) console.warn(`[story-world-v2] 参数：${adopted.note}`);
    const replayedPendingEnv = paramsAdopted || paramsMirrored;
    const rot = await ensureChronicleRotated(world);
    if (!rot.ok) {
        // 轮转失败 = 世界不动（内存与盘上一致），如实报错不装成功（E2 语义）
        // ★★★leg48：**这条路上也要补镜像**——它正是真浏览器现场抓到的那个形状（世界半成品 ⇒ 面板空态）。
        //   旧版这里直接 `refreshWorld` 就完了，玩家在这一刻改的档位只能等下一次载入才进世界账。
        try { paramHub.flushPending(rot.hot); } catch (_) {}
        refreshWorld(rot.hot, { oldVolumes: LISTED_VOLUMES });
        setStatus(`⚠ ${rot.error}——世界原样不动（热账没写），可重试`);
        return;
    }
    const hot = rot.hot;
    const migrated = migrateLegacyAttrs(hot);   // leg24 片4：旧账一次性清理（幂等）
    const hotWorld = migrated;   // 旧账清理后的世界（下面所有落账都基于它）
    // 名册落账（可重入）+ 位置继承：共用同一份条目，一次落盘
    const bookEntriesForSeed = await bookEntriesForInherit();
    const { seed, seededDelta, backfilled, changed } = seedAndBackfill(hotWorld, { entries: bookEntriesForSeed });
    // leg25 f：**位置继承也挂在加载期**（零 token、幂等、只填空位）——打开面板即见效，
    //   不必等玩家推一轮或点「查」。与名册落账共用同一份条目，一次落盘。
    const loc = inheritLocations(hotWorld, { entries: bookEntriesForSeed });
    const world2 = loc.ssot;
    // ★★leg32h：**玩家棋子身份每轮校准一次**（幂等、零 token、先于落盘）。
    //   为什么需要：棋子建得太早（初始化那一刻），而"主角名"可能**后来才进世界**——
    //   真实案例：主角「黄坤」在第 42 轮被模型当新实体入局，而棋子从第 1 轮就叫「你」
    //   ⇒ 世界账里两个平行的人，模型于是**一直演黄坤**（用户：「又把主角演了」）。
    //   这里在每次载入时用 ST 的人设名（`name1`）校准：**同名实体已存在 ⇒ 认领它、把空棋子并掉**
    //   （`namePlayerPiece` 的两个分支），没有则只给棋子改名。★拿不到名字就什么都不做（不猜）。
    const personaNow = (() => { try { return String(getCtx()?.name1 || '').trim(); } catch (_) { return ''; } })();
    const pieceSync = personaNow ? namePlayerPiece(world2, personaNow) : { renamed: false };
    // ★★leg40（用户拍板后的形状）：**起根只在两处发生**——
    //   ① **初始化**（`bus['init-world']`，新世界开局那一步）；
    //   ② **显式移植**（`demo/seed-roots-migrate.js`，备份 + 写后自证的一次性动作）。
    //   ★**载入期（打开面板/刷新）绝不自动起根**：那会变成"你只打开面板看一眼，它就在后台烧掉一次几十秒的抽取调用"，
    //     而这时候用户没有任何"我要种"的意图。用户原话问的就是这一格（「这个做种是初始化的时候种的？」）。
    //   ⇒ 存量世界要补根，走 ②；判据（幂等指纹 + 线头是否够用）仍由 `shouldSeedRoots` 一处说了算。
    // ★leg33d：插件总闸的一次性迁移（幂等；只对"该键从未写过"的世界动手，见 ensureAutoAdvanceKey 注释）。
    //   有推进史的存量世界 ⇒ 迁成 '1'（升级前后行为一字不变）；全新世界 ⇒ '0'（要你按一下「开始」）。
    const autoKeyAdded = ensureAutoAdvanceKey(world2);
    if (changed || loc.inherited > 0 || migrated !== hot || pieceSync.renamed || autoKeyAdded || replayedPendingEnv) {   // migrated!==hot = 迁移真改了账（ref 判等，幂等不空写）
        writeHotMeta(hotAccountShape(world2));   // 账本已变：内存与盘上必须一致（导出/「全册 N」读的就是这里）
        const flushed = await flushHotMeta(); // 名册入账/旧账清理不该只活在页面内存——走既有显式落盘路径
        if (!flushed.ok) console.warn('[story-world-v2] 账本写回未落盘', { reason: flushed.reason, seeded: seed.seeded, seededDelta, backfilled, 位置: loc.inherited, 棋子校准: pieceSync, 补回本地档位: replayedPendingEnv });
        else if (backfilled > 0 || loc.inherited > 0 || pieceSync.renamed || autoKeyAdded || replayedPendingEnv) {
            console.info('[story-world-v2] 名册落账可重入：本次补齐', {
                归属: seed.parentVerified ?? 0, 字段: seed.fieldsAttached ?? 0, 弃关系: seed.parentDemoted ?? 0, 位置: loc.inherited,
                棋子校准: pieceSync,   // ★leg32h：认领/改名/并掉空棋子都要留痕（用户能看见"主角认领了没有"）
                插件总闸: autoKeyAdded ? `${AUTO_ADVANCE_KEY}=${world2.context.setting.dynamic.env[AUTO_ADVANCE_KEY]}（首次写入）` : '已写过，不碰',
                补回本地档位: replayedPendingEnv ? '是（上次落盘没确认，这次重落）' : '无',
            });
        }
    }
    // ★★★leg48（**解耦的另一半，用户追问"解耦了？"点出来的窟窿**）：世界**跑完了** ⇒ 立刻再补一次镜像。
    //   为什么必须在这里补（不只是开头那次 `flushPending`）：
    //     开头那次在 `commit` 之后、`ensureChronicleRotated` **之前**；如果世界对象是"载入链跑到后半段
    //     才成型"的，那一次补的是**半成品**。玩家在"世界对象还没成型"的窗口里改的档位，
    //     就会一路挂到**下一次载入**才进世界账 ⇒ 这一次会话里"面板改了、引擎按旧档跑"。
    //   ⇒ 口径：**"世界一到就补"**——载入链**每一处拿到可用世界的地方**都补一次（幂等、无变化零写）。
    const lateFlush = paramHub.flushPending(world2);
    if (lateFlush.changed) {
        writeHotMeta(hotAccountShape(lateFlush.world || world2));
        // ★日志口径与载入期开头那次**同一条**（同一件事只有一个说法，别造第二套）
        console.info('[story-world-v2] 载入期把"世界没到那一刻"写下的档位补进世界账', {
            键: lateFlush.keys.join('、'), 世界名: adopted.worldName, 时机: '世界成型后',
        });
    }
    LISTED_VOLUMES = await listOldVolumes();
    refreshWorld(world2, { oldVolumes: LISTED_VOLUMES });
    refreshSnapshots();   // leg27 后：快照清单随世界加载刷新（异步，回来再重绘一次）
    // ★leg33d：关着的时候**明说**（否则"世界怎么不动了"会被当成 bug；面板照常可用）
    if (!autoAdvanceOn(world2)) {
        setStatus('⏸ 插件已关 · 自动推进不生效（发消息/切聊天都不动世界）· 参数页「插件总闸」可开 · 也可按参数页的「推进一轮」手动推');
    }
}

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

// ★★★leg48：**"参数操作进行中"的忙闩**（按参数键记）——见 `bus['set-param']` 里那段现场读数。
//   为什么必须有它：重画会把 `<select>` 销毁重建，浏览器对**新节点**补吐一笔**带旧值**的事件
//   （`input`+`change` 各一次）⇒ **同一格一次点击进两笔，第二笔把玩家选的值覆盖回去**。
//   它只挡"同一刻的补吐事件"：玩家下一次真实点击时上一笔早已结束，所以手感上完全无感。
const sw2ParamBusy = new Map();   // 参数键 → true（正在处理这一格的一笔操作）

// ---------- K35：真实动作总线（阅卷/导出/导入；其余按钮随 K36 接调度） ----------
// ★leg40b（A2 · 体检修）：动作总线在这里装配，而面板模板与事件委托早于它 —— 见 `dispatchAction` 的兜底。
if (typeof window !== 'undefined') {
    window.__sw2Actions = window.__sw2Actions || {};
    const bus = window.__sw2Actions;

    // ---------- leg26：世界参数 · 档位（参数页）----------
    // 口径（用户令「参数独开页签」+「让用户自己调挡位」）：
    //   · 这些是**玩家对世界的输入**，不是引擎算出来的判断、也不是书里的原稿 ⇒ 独立一页。
    //   · 引擎**只照抄**：值必须是 params.js 的档位原话（白名单）。
    //   ★★leg41 改口径（用户令「可以你做吧」）：**落点从世界账改成插件自己的配置区**
    //     （`extensionSettings`，走 ST 的 `saveSettingsDebounced`）——见 `src/param-store.js` 头部。
    //     世界账里的 `dynamic.env` 降级为**镜像**（引擎还照旧读它）。于是：
    //     ①"改一次参数 = 整份 9.6MB 聊天上盘"这件事**没了**；②"刷新回默认"这件事**没有对象了**。
    bus['set-param'] = async (payload) => {
        const key = String(payload?.param || '').trim();
        const value = String(payload?.value ?? '').trim();
        // ★★★leg48（**真浏览器现场抓到的第二笔**）：同一格里会进**两笔**——
        //   `收到：每轮递线 → "9"（ok）` → `控件按真源对齐 → "3"` → `收到：每轮递线 → "3"（ok）`
        //   ⇒ 第二笔把玩家选的 9 覆盖成 3，画面看起来就是"它自己跳回去了/刷新回默认"。
        //   第二笔的来源：整页/局部重画把 `<select>` **销毁重建** ⇒ 浏览器对**新节点**补吐一笔
        //   带**旧值**的事件（`input`+`change` 各一次，所以现场是"点一次写两次"）。
        //   ⇒ 定稿（一笔操作 = 一笔事务）：**本通道忙的时候，同一格再来的事件一律不受理**，
        //     并如实留痕（不是静默丢弃）。它只挡"同一刻的补吐事件"，挡不住玩家下一次真实的点击
        //     （那时上一笔早已结束）。
        const busy = sw2ParamBusy.get(key);
        if (busy) {
            console.info(`[story-world-v2] set-param：上一次操作还在进行中 ⇒ 不受理这一笔重复事件`
                + `（值 ${JSON.stringify(value)}）——这是重画/浏览器补吐的那一笔，不是玩家的手：${key}`);
            return;
        }
        sw2ParamBusy.set(key, true);
        try {
            return await sw2ApplyParam(key, value, payload);
        } finally {
            sw2ParamBusy.delete(key);
        }
    };

    /**
     * ★leg48：`set-param` 的**实体**（从 `bus['set-param']` 里提出来，为的是让"忙闩"能干净地包住它）。
     * 口径不变：判定与写入全在 `paramHub`；本函数只做接线（拿世界 → 交给 hub → 落账 → 对齐画面 → 状态条）。
     */
    async function sw2ApplyParam(key, value, payload) {
        // ★★★leg48：**"明确清空"与"手滑到空"在这一层分开**（判定必须在接线层，因为只有这一层
        //   知道"这一个控件有没有「未定」这一项、玩家是不是选了它"）：
        //   · 下拉里的空串 = 玩家**明确选了「未定」**（`render.js` 给每个下拉的首项就是它）⇒ 走 `clear()`；
        //   · 开关按钮的空值 = 不是清空（它有 data-value）⇒ 走 `set()`，由 hub 按空值处理（什么都不动）。
        //   ★为什么非分不可（用户实机状态条的原话）：不分的时候，浏览器吐一笔**带空值的事件**
        //     （重画/滚轮/失焦）就会被当成"玩家要清空" ⇒ **档位被删**，而状态条还报"已存进本地存储"。
        const el = payload?.el || null;
        const fromUnsetOption = (() => {
            try { return String(el?.tagName || '').toUpperCase() === 'SELECT' && el.value === ''; } catch (_) { return false; }
        })();
        // ★★leg46：本条通道**只做三件接线的事**，判定与写入全在 `paramHub` 里：
        //   ① 拿**当下的**世界（从聊天账现读一份，不用渲染层那份引用）——★拿不到不再是"拒绝写入"的理由；
        //   ② 把它的返回值当**唯一真相**——状态条照抄 `humanLine`（存到哪 / 镜像成没成 / 失败在哪一步）；
        //   ③ 把镜像那份写回聊天账 + 按真源把控件与格对齐。
        //   ★本函数**不再碰任何存储**（旧版这里既算世界名、又写 localStorage、又写插件配置、
        //     又自己镜像一遍 —— 五处写入口就是这么散出去的）。
        const meta = readHotMeta();
        const world = meta ? loadHotAccount(meta) : null;
        // ★★★leg48：**世界对象拿不到时，把"世界名"单独交给 hub**（它是桶键的唯一来源）。
        //   为什么必须单独给名字：真机上"世界在盘上、`loadHotAccount` 却给了 null/半成品"是最常见的形状
        //   （载入链中任一环失败）。此时**名字是有的**（就在热账那一格里），而桶键只能靠它 ——
        //   名字拿不到就会退回兜底名 ⇒ 档位存进另一个桶 ⇒ 面板读的是原桶 ⇒ **玩家看到"我改的不见了"**。
        //   ★注意：这里**只取名，不猜内容** —— 拿不到就是空串，hub 自己会用"最后一次见到的名字"兜底。
        const worldNameHint = (() => {
            try { return String(payload?.worldName || meta?.world?.context?.world || '').trim(); } catch (_) { return ''; }
        })();
        const key2 = world || worldNameHint || null;
        const r = fromUnsetOption ? paramHub.clear(key2, key) : paramHub.set(key2, key, value);
        sw2HubLastWorld = r.mirror?.world || world || sw2HubLastWorld || null;
        // ★★★leg48：**世界没到就出声**（旧版这条路上一个字都不说，于是"世界对象没拿到"这件事
        //   在玩家与维护者两边都不可见——十二轮里缺的就是这一行）。
        if (!world) {
            console.warn(`[story-world-v2] 这一刻拿不到世界对象（载入还没跑完或失败）——`
                + `参数**照常写进真源**，引擎那一格（世界账）等世界载入后由 flushPending 补上`
                + `（见控制台里 loadWorld 的报错；面板参数页自检卡有「世界对象」一行）`);
        }
        // ★★★leg46 续·五（**用户第三次实机：「我点了四次为啥有八次写入，在点击旁边空白的时候会直接写入两次」**）：
        //   八次写入 = 四组"**写成功 → 40 毫秒后丢掉**"，每一对的第二笔**都是同一个 `bus.set-param`**
        //   ⇒ **同一格一次点击进了两次**，且第二笔带的值与第一笔不同（否则会走"无变化"分支、不会写盘）。
        //   ⇒ 这一行是**定性用的读数**（零风险、不改行为）：把"这一笔到底提交了什么值、结果是什么分支"
        //     打到控制台。下一份反馈里，`收到：<键> → <值>` 连着两行就是答案（第二行的值是什么，一眼就知道）。
        console.info(`[story-world-v2] set-param 收到：${key} → ${JSON.stringify(value)}`
            + `（${fromUnsetOption ? '明确清空' : '赋值'} · 真源现值 ${JSON.stringify(r.before)}`
            + ` · 世界「${r.worldName ?? '—'}」· 世界对象 ${world ? '在' : '**不在**'}`
            + ` · 判定 kind=${r.kind} changed=${r.changed} · 面板构建 ${PANEL_BUILD}）`);
        if (r.reason) console.info(`[story-world-v2] set-param 未受理：${r.reason}`);
        if (r.kind === 'noop-empty') {
            console.info(`[story-world-v2] set-param：空值不算改档位 ⇒ 一个字都没写（要清空请明确选「未定」）：${key}`);
        } else if (r.kind === 'unchanged') {
            console.info(`[story-world-v2] set-param 无变化：${key} = ${r.after ?? '未定'}（真源里本来就是它，无需改动）`);
        }

        // 受理了（真值变了）⇒ 把镜像那份落进聊天账。★从这里往后全是"下游"，参数已经安全落定。
        if (r.changed && r.mirror?.world) {
            writeHotMeta(hotAccountShape(r.mirror.world));
            sw2HubLastWorld = r.mirror.world;
        }

        // 开关刚打开 ⇒ 立刻投一次（不等下一轮）。leg27 h：同样如实上报（自证面）
        let memLine = '';
        if (r.changed && key === 'memoryEnabled') {
            const on = r.after === '1';
            const memResult = on
                ? await pushMemoryNow(sw2HubLastWorld || world).catch(() => ({ ok: false, reason: '抛错（见控制台）' }))
                : { ok: false, reason: '开关刚被关掉' };
            markMemoryPush(memResult, world?.meta?.tick);
            if (!on) sw2MemoryPush = null;   // 关掉 ⇒ 自证面归零（不留上一次的"已投"）
            memLine = memoryPushLine();
        }

        // ★★★leg46 续·五（**用户第三次实机：「点一次空白写两次、第二笔把 9 覆盖回 3」**）：这一格**改了治法**。
        //   旧法：`refreshSections(['params', ...])` —— **整块 innerHTML 重画参数页**。
        //   它的后果（用户审计里五组"写成功 → 40ms 后丢掉"就是它）：把玩家手底下的 `<select>` **销毁重建**
        //   ⇒ 浏览器对**新节点**再吐一笔事件（带着刚被换掉的**旧值**）⇒ 第二笔把第一笔覆盖回默认。
        //   ⇒ 定稿：**只就地改显示格**（`data-param-cell="<键>"` 那一个 `<b>` 的字），
        //     **绝不重画参数页、绝不碰任何控件、绝不回写控件的值**。
        //     （与 leg41 那条铁律一致：控件是玩家的手，不是我们的画布；`<b>` 才是我们的画布。）
        //   观棋页仍照常重画（信息带要跟着变），它没有可交互控件。
        if (r.kind === 'ok' || r.kind === 'fail') {
            // ★★★leg46 续·十（**用户第五次实机："我改了值旁边直接变成未定"**）：这里**不再按真源写格**。
            //   格的字现在**只从同一行的控件读**（`sw2SetParamCell` 的规矩）⇒ 控件是 12，格就必须是 12。
            //   曾经在这里按 `r.env` 写过一版，结果"真源那一份里没有这个键"时把它写成「未定」——
            //   而控件明明显示着玩家刚选的值 ⇒ 画面自相矛盾。**这条路整段删掉**。
            // ★★★leg48（**"改了回默认"的最后一环**）：这一笔结束之后，**控件按真源对齐**——
            //   写成功 ⇒ 控件停在玩家选的那一档（真源＝它）；空值/非法/失败 ⇒ 控件**退回真源那一档**，
            //   于是"手滑到空"不会再留在屏幕上冒充一次改动（旧版留着的就是那一屏：
            //   控件空着、"格"跟着写「未定」，刷新一看档位回默认）。
            sw2SetParamControl(key);
            sw2SyncParamCells();
            // 撤销按钮的可用性跟着刷（它是按钮，改 `disabled` 不算"回写控件的值"）
            try {
                const btn = document.getElementById(WINDOW_ID)?.querySelector?.('[data-action="param-undo"]');
                if (btn && typeof btn.disabled === 'boolean') btn.disabled = !(sw2ParamUndoState().count > 0);
            } catch (_) {}
            refreshSections(['board']);
        }

        // ★leg33d：总闸被打开 ⇒ 立刻把它"接上"（不必等下一轮）。关掉**不做任何拆除**——
        //   世界原样留在盘上、面板照常渲染，只是不再自动推进（手动「推进一轮」永不被闸）。
        if (r.kind === 'ok' && key === AUTO_ADVANCE_KEY) {
            if (r.after === '1') {
                const hotNow = loadHotAccount(readHotMeta());
                setStatus('▶ 插件已开 · 发消息会自动推进世界（要停请回参数页按「关」）'
                    + (hotNow ? '' : ' · ⚠ 但还没有世界：先「✨ 开始新世界」'));
            } else {
                setStatus('⏸ 插件已关 · 世界原样留在盘上（没有清账、没有拆线）· 要看按观棋窗口、要推按参数页的「推进一轮」');
            }
            return;
        }
        // ★★状态条 = hub 的原话（**不许在这里另写一套口径**——leg41 的"说得比做得好听"就是两套口径）
        setStatus(`${r.humanLine}${memLine ? ` · ${memLine}` : ''}`);
    }
    // ---------- leg41：撤销（参数页那一枚；照 v1 的撤销栈）----------
    bus['param-undo'] = async () => {
        const r = sw2UndoParam();
        if (!r.ok) { setStatus(`↶ ${r.reason}`); return; }
        setStatus(`↶ 已撤销：${r.label} —— 档位回到那一步之前（世界已经发生的事不回退）`);
    };

    // ---------- leg25 d：查书补全的两个入口（面板行内「查/重查」+ 批量补全）----------
    // 单实体：即时查一次（不必等下一轮世界推进），查完立即落盘 + 重绘
    bus['lookup-entity'] = async (payload) => {
        const id = payload?.entity;
        if (!id) return;
        const forceFields = payload?.force === 'all' ? 'all' : (payload?.force ? 'absent' : null);
        setStatus(`正在查书：${payload?.name || id}…`);
        try {
            const r = await lookupOneEntity(id, { forceFields });
            if (!r.ok) { setStatus(`⚠ ${r.error}`); return; }
            const e = r.entity || {};
            const got = ['实力', '位置'].filter((f) => typeof e[f] === 'string' && e[f].trim())
                .map((f) => `${f}：${e[f]}`).join(' · ');
            setStatus(`${e.name || id} → ${got || '书里没给出可用原话'}${r.warning ? `（${r.warning}）` : ''}`);
        } catch (err) {
            setStatus(`⚠ 查书失败：${err?.message || err}`);
        }
    };

    bus['lookup-batch'] = async (payload) => {
        if (sw2BatchTask) {
            const s = batchTaskStatus();
            stopBatchTask();
            setStatus(`已停止批量补全：第 ${s.cursor}/${s.total} 批（成功 ${s.success}）——世界照常推进`);
            return;
        }
        const forceFields = payload?.force === 'all' ? 'all' : 'absent';
        const started = startBatchTask({ forceFields });
        if (!started.ok) { setStatus(`⚠ ${started.error}`); return; }
        setStatus(batchStatusText() || `批量补全已排队（共 ${started.total} 个）——每轮搭车跑一批，想停再点一次`);
    };
    // 面板上的名字叫 `lookup-batch-all`（render.js 的按钮就这么写的）——同一个动作，两个别名都接上，
    //   防"按钮画了没人接"（本仓判据：**面板产物里每个 data-action 都必须有真实处理器**）。
    bus['lookup-batch-all'] = (payload, event) => bus['lookup-batch'](payload, event);

    // ---------- leg27 后：快照容错（第八页签的两个动作）----------
    bus['snapshot-restore'] = async (payload) => {
        const id = payload?.snap;
        if (!id) return;
        const tick = payload?.tick === '' || payload?.tick == null ? null : Number(payload.tick);
        const cur = loadHotAccount(readHotMeta()) || sw2LastWorld;
        const curTick = cur?.meta?.tick;
        const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
            ? window.confirm(`确定回到快照 ${id}${tick == null ? '' : `（第 ${tick} 轮）`}？\n\n· 世界账回到第 ${curTick ?? '?'} 轮 → 第 ${tick ?? '?'} 轮\n· 只回世界账，**对话记录不动**，也不会重写你聊过的内容\n· 恢复前会**自动给当前状态拍一份**（回不来可以再退回去）\n\n确认后立即生效。`)
            : true;
        if (!ok) { setStatus('已取消（世界原样）'); return; }
        setStatus(`正在回到快照 ${id}…`);
        const r = await restoreSnapshot(id);
        if (!r.ok) { setStatus(`⚠ 回不去（链不完整）——${r.error}`); return; }
        await refreshSnapshots();
        setStatus(`已回到 ${id}（第 ${r.tick ?? '?'} 轮 · ${r.plan === 'full' ? '整份' : '锚点+增量'}）${r.flushed ? ' · 已落盘' : ' · ⚠ 落盘失败（见控制台）'}——对话记录未动`);
    };

    bus['snapshot-clear'] = async () => {
        const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
            ? window.confirm('重置快照？\n\n· 会清空**当前聊天**的全部快照（别的聊天不受影响）\n· 然后立刻给**现在这份世界**拍一份新链头（第 1 份）\n· 世界账本身**不动**，只动快照库\n\n适用场景：盘上混着旧代码/丢账时拍下的脏数据。')
            : true;
        if (!ok) { setStatus('已取消（世界原样）'); return; }
        const r = await resetSnapshots();
        if (!r.ok) { setStatus(`⚠ 重置失败：${r.error}`); return; }
        await refreshSnapshots();
        setStatus(`快照已重置（清掉 ${r.removed} 份 · 已拍新链头 s1）——世界账未动，窗口保留 15 步`);
    };

    // ---------- K35：阅卷 / 编年五筛 / 链视图 / 导出导入 ----------
    bus['read-volume'] = async (payload) => {
        const volId = payload?.vol;
        if (!volId) return;
        try {
            const volume = await volumeStore().get(volId);
            if (!volume) { setStatus(`⚠ 卷「${volId}」不在库中`); return; }
            const rows = volumeToChronicleRows(volume);
            const html = renderVolumeReadHtml(volId, rows);
            const chronicle = document.getElementById('sw2_view_chronicle');
            if (!chronicle) return;
            chronicle.insertAdjacentHTML('afterbegin', html);
            setStatus(`已展开旧卷「${volId}」（${rows.length} 行 · 只读）`);
        } catch (err) {
            setStatus(`⚠ 阅卷失败：${err?.message || err}`);
        }
    };

    bus['set-filter'] = (payload) => {
        const t = payload?.filter;
        if (t === 'all' || t == null) {
            sw2ChronicleFilter = null;
        } else {
            sw2ChronicleFilter = sw2ChronicleFilter ? new Set(sw2ChronicleFilter) : new Set();
            if (sw2ChronicleFilter.has(t)) sw2ChronicleFilter.delete(t);
            else sw2ChronicleFilter.add(t);
            if (!sw2ChronicleFilter.size) sw2ChronicleFilter = null;
        }
        if (sw2LastWorld) refreshWorld(sw2LastWorld);
        else setStatus('还没有世界（编年筛无处可用）');
    };

    // ---------- leg49（细案 spec-entities-page-ia）：实体页工具条四枚动作 ----------
    // 口径：改状态一行 + 只重绘本页。**选数据一行都不写在这里**（全在 `src/render.js` 的纯函数里）。
    // ★重绘走 `refreshSections(['entities'])` 而不是自己拼 innerHTML：它是本仓唯一的局部重绘通道，
    //   且跑在 `sw2SectionRefreshRunning` 防重入标志里（自拼 innerHTML 会绕过它 ⇒ 重绘自己咬自己）。
    bus['ents-filter'] = (payload) => {
        const v = String(payload?.value || '');
        if (SW2_ENTS_KINDS.has(v)) sw2EntsView.kind = v;
        else if (SW2_ENTS_FILTERS.has(v)) {
            const i = sw2EntsView.filters.indexOf(v);
            if (i >= 0) sw2EntsView.filters.splice(i, 1); else sw2EntsView.filters.push(v);
        }
        sw2EntsView.page = 1;          // ★换筛选必回第一页（否则"页码夹紧"会让人以为点了没反应）
        refreshSections(['entities']);
    };
    bus['ents-sort'] = (payload) => {
        const v = String(payload?.value || 'active');
        if (['active', 'recent', 'name'].includes(v)) sw2EntsView.sort = v;
        sw2EntsView.page = 1;
        refreshSections(['entities']);
    };
    // ★分组那一档（`grp`）：控件与分组渲染在 Task 5 同批落地（用户拍板"中途不许有死控件"）。
    //   ★`page = 1` 复位与三个兄弟动作一致（Task 4 评审判定它当时零可观察行为、约定本笔补）：
    //     换了分组口径 ⇒ 命中集合的**切法与顺序都变**，停在第 3 页会落在另一批组上
    //     （与"换筛选/换搜索词必回第一页"同一条道理，否则玩家以为点了没反应）。
    bus['ents-group'] = (payload) => {
        const v = String(payload?.value || 'none');
        if (['none', 'parent', 'loc', 'kind'].includes(v)) sw2EntsView.grp = v;
        sw2EntsView.page = 1;
        refreshSections(['entities']);
    };
    bus['ents-page'] = (payload) => {
        // ★页码由渲染层夹紧（`selectEntityPage` 的越界夹紧），这里只管加减——零第二份夹紧逻辑
        sw2EntsView.page += (String(payload?.value) === 'prev' ? -1 : 1);
        refreshSections(['entities']);
    };
    // ★终审 I1：chip 计数的**口径开关**（全册 ⇄ 当前结果）。走的还是既有那条 `refreshSections(['entities'])`
    //   通道（与四个兄弟动作同形：改状态一行 + 只重绘本页）。
    //   ★**不动 `page`**（与三个兄弟动作不同，理由必须说清）：换筛选/换搜索词会**改变命中集合**
    //     ⇒ 停在第三页会落在另一批行上（那种情况回第一页是对的）；而换计数口径**一个行都不动**——
    //     `rows`/`hit`/`pages` 全不变，只是那几枚钮上的数换了把尺子。此时回第一页反而是**无理由的位移**
    //     （玩家正翻到第 7 页看着，点一下口径就被踢回第 1 页 = 本仓最忌的"面板抢玩家的手"）。
    bus['ents-scope'] = (payload) => {
        const v = String(payload?.value || 'all');
        if (v === 'all' || v === 'hit') sw2EntsView.scope = v;
        refreshSections(['entities']);
    };

    bus['open-chain'] = (payload) => {
        try {
            const id = payload?.chain;
            const world = sw2LastWorld;
            if (!world || !id) { setStatus('⚠ 没有可展开的链'); return; }
            const chain = expandChain(world, id);
            const html = renderChainViewHtml(chain, { world, volumes: LISTED_VOLUMES });
            const chronicle = document.getElementById('sw2_view_chronicle');
            if (!chronicle) return;
            chronicle.insertAdjacentHTML('afterbegin', html);
            setStatus(chain.ok ? `链已展开（上承 ${chain.up?.length ?? 0} · 下沿 ${chain.down?.length ?? 0} · 只读）` : '⚠ 链视图不可用');
        } catch (err) {
            setStatus(`⚠ 链视图失败：${err?.message || err}`);
        }
    };

    bus['chain-close'] = () => {
        document.getElementById('sw2_chain_view')?.remove();
    };

    bus['export-world'] = async () => {
        const meta = readHotMeta();
        const world = meta ? loadHotAccount(meta) : null;
        if (!world) { setStatus('⚠ 还没有世界可导出'); return; }
        try {
            const volumes = await volumeStore().list();
            const full = await Promise.all(volumes.map((v) => volumeStore().get(v.id)));
            const { json } = await buildExportBundle(world, full.filter(Boolean));
            const blob = new Blob([json], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = EXPORT_FILENAME;
            a.click();
            URL.revokeObjectURL(a.href);
            setStatus(`已导出整聊天（世界账 + ${full.filter(Boolean).length} 卷）`);
        } catch (err) {
            setStatus(`⚠ 导出失败：${err?.message || err}`);
        }
    };

    bus['import-world'] = async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const res = await verifyImportBundle(text);
                if (!res.ok) { setStatus(`⚠ 导入被拒：${res.error}`); return; }
                writeHotMeta(hotAccountShape(res.world));   // leg41：导入的账带它自己那份 env；随后 loadWorld 会把真源镜像补上
                const store = volumeStore();
                for (const v of res.volumes) await store.put(v);
                await loadWorld();
                const flushed = await flushHotMeta();   // leg20 语义：关键路径显式落盘后再报成功
                setStatus(`已导入：世界与 ${res.volumes.length} 卷${flushOutcomeText(flushed)}`);
            } catch (err) {
                setStatus(`⚠ 导入失败：${err?.message || err}`);
            }
        });
        input.click();
    };

    // ---------- K38：初始化（抽取五件套 + 名册）----------
    bus['init-world'] = async () => {
        // ★★leg40b（I-1）：**先问，再动手**——这条必须是本函数第一条语句。
        //   放在这里（而不是放到 writeHotMeta 之前）是因为：抽取与起根都在这后面，
        //   真账实测合起来要几分钟（起根 170–490 秒）⇒ 闸若靠后，用户会在**毫不知情**的情况下等完再被覆盖。
        //   口径：有世界才问（`worldToBeReplaced` 返回 null = 没什么可丢的，别多问一句）；
        //   问不出来（无 window.confirm）⇒ 放行，绝不卡死。
        const target = worldToBeReplaced(loadHotAccount(readHotMeta()));
        if (target) {
            const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
                ? window.confirm(initWorldOverwriteNotice(target))   // ★先归一（worldToBeReplaced）再喂文案：契约见该函数注释
                : true;
            if (!ok) {
                setStatus(`已取消——世界「${target.name}」原样不动（没有覆盖，也没有发生任何调用）`);
                return;
            }
        }
        try {
            const settings = modelSettings() || {};
            // leg27：抽取走**独立超时档**（extraction: true = EXTRACTION_TIMEOUT_MS），不再蹭主调用的 120s
            const resolved = resolveBrowserTransport(settings, { maxTokens: EXTRACTION_MAX_TOKENS, extraction: true });
            if (!resolved) { setStatus('⚠ 模型通道未配置（设置页填写服务地址/密钥/模型）'); return; }
            setStatus('正在合订设定源（角色卡 + 世界信息）…');
            const src = await autoComposeSource();
            if (!src.ok) { setStatus(`⚠ 设定源不可用：${src.reason}——请检查 ST 是否已载入角色卡/世界书`); return; }
            setStatus(`设定源就绪（${src.label} · ${src.usedChars} 字符${src.truncated ? ' · 已截断' : ''}），开始抽取…`);
            // leg27 F1/F1b：抽取**全程可见**——进度事件 + 1 秒心跳读秒（用户「看不到日志」那一刀）
            const progressEvents = [];
            const progress = extractionProgressHandler(progressEvents);
            const r = await extractWorldSetting({
                sourceText: src.text,
                extract: diagExtract(resolved), // 双形取法：字符串/JSON 都吃
                force: false,
                onProgress: progress.onEvent,
            });
            progress.stop();
            // 抽取耗时与逐段读数（成功也要出声——"慢"必须有据可查）
            console.info('[story-world-v2] 抽取耗时实测', {
                ok: r.ok, cached: r.cached, timing: r.timing, steps: describeProgress(progressEvents),
            });
            logInitDiagnostics(getCtx(), src, r); // 控制台诊断（现场唯一证据面）
            if (!r.ok) {
                const tk0 = r.timing || {};
                const secs0 = tk0.ms == null ? null : Math.round(tk0.ms / 1000);
                console.warn('[story-world-v2] 抽取失败实测', {
                    timing: tk0, steps: describeProgress(progressEvents), errors: r.errors || [],
                });
                setStatus(`⚠ 抽取失败${secs0 == null ? '' : `（${tk0.calls || 0} 次调用 / ${secs0} 秒）`}：${(r.errors || []).join('; ')}${/超时|timeout/.test((r.errors || []).join(';')) ? '——建议提高抽取超时或换更快的模型；每段成败见控制台' : ''}——世界未动`);
                return;
            }
            let seed = {
                version: 1,
                context: { world: src.worldName || '未名世界', tension: 0.5, positions: derivePositions(r.setting), setting: r.setting },
                entities: [], weights: {}, agendas: [], events: [], chronicle: [], milestones: [],
                meta: { tick: 0, simLog: [] },
            };
            // 第二十五棒 e：初始化创建世界时就把真书正文交给名册落账（零 token 兜底要用正文）；
            //   随后 `loadWorld()` 还会再跑一次（幂等）——两处同一条路径，谁先跑都不重不漏。
            seedBookEntities(seed, { entries: src.worldInfoEntries || [] });
            // B 组接线：世界必须真的有一枚玩家棋子（否则五条"禁写玩家"守卫、掩码、影响通道全是死的）。
            // leg25 c：开档描述的**四维解析整段删除**（那个小调用连同 player-setup/player-inject 两个模块一起没了）
            //   ——四维浮点已不存在（没法精确表示；手拍值让"编的"看起来像"算的"）。
            //   玩家棋子现在只有身份与位置（结构性事实），和别的实体同尺；开档描述本身仍留在 meta 里可查。
            //   ★★leg32h（用户：「又把主角演了」）：**这里必须把玩家的真名传进去**。
            //   旧法 `attachPlayerPiece(seed)` 空参 ⇒ 棋子永远叫「你」⇒ 模型在第 42 轮把主角「黄坤」
            //   当**新实体**入局（`e_42_1`）⇒ 世界账里两个平行的人 ⇒ 模型一直很尽责地演黄坤
            //   （替他开盘算、推进、写"以雷法锁定薛铁衣气机，展开殊死搏杀"这类**玩家自己的选择**）。
            //   传名字后：`attachPlayerPiece` 会**复用同名实体**（名册里就有 → 直接认领），否则建一枚真名棋子；
            //   此后每轮载入还有 `namePlayerPiece` 兜底，把"后来才出现的主角实体"并进来。
            //   名字读 ST 的 `name1`（用户人设名）。★拿不到就退回旧口径（空串 ⇒ 「你」），**不猜**。
            const personaName = (() => { try { return String(getCtx()?.name1 || '').trim(); } catch (_) { return ''; } })();
            const piece = attachPlayerPiece(seed, personaName);
            const playerDesc = String(settings.playerDesc || '').trim();
            if (playerDesc) {
                seed.meta = { ...(seed.meta || {}), playerDesc };
            }
            const playerFinal = seed.entities.find((e) => e.id === seed.context?.playerId);
            // ★★leg40：**从世界源起根**——新世界开局就种几条"书里正在发生的事"当线头。
            //   为什么必须在**开局**这一步（用户拍板：起根只留在"初始化"与"显式移植"两处，**载入期绝不自动跑**）：
            //   世界源被抽成静态设定 + 名册（0 条起过事）⇒ 全账第 25 轮之前只有 1 条事件 ⇒ 模型可引用的节点只有那场大乱。
            //   ★★位置：**必须在 `attachPlayerPiece` 之后**（2026-09-14 修正）——候选人名单取自"账上没被点过名的人"，
            //     棋子若还没建，玩家自己会混进候选池里（虽然落账时会按红线 1 跳过，但那是**事后补救**，名单本身就该干净）。
            //   失败零阻塞（起根不成照常开局）；种下的根在面板链视图里标「由世界源而起」。
            try {
                setStatus('正在开局：从世界源起根（读整本书里"正在发生的事"）…');
                const seededRoots = await seedRootsForWorld(seed, {
                    sourceText: src.text || '', extract: diagExtract(resolved), fresh: true,
                    onProgress: (e) => setStatus(`正在开局：起根 第 ${e.index}/${e.count} 块（${e.chars} 字符）${e.ok ? `· 得 ${e.got} 条` : `· 失败`}…`),
                });
                if (seededRoots.ok && !seededRoots.skipped) {
                    setStatus(`正在开局：已从世界源起 ${seededRoots.seeded} 条根（${seededRoots.chunkCount} 块 · 候选 ${seededRoots.candidateCount} 人）…`);
                } else if (!seededRoots.ok) {
                    console.warn('[story-world-v2] 起根未成（照常开局）', seededRoots);
                    setStatus('⚠ 起根未成（照常开局，见控制台）——世界照旧可用，线头可在之后再补');
                }
            } catch (err) {
                console.warn('[story-world-v2] 起根异常（照常开局）', err?.message || err);
            }
            const had = Boolean(target);   // = 本次确实换掉了一个现存世界（守门那一步已经查过，这里只留痕）
            writeHotMeta(hotAccountShape(seed));
            await loadWorld();
            const flushed = await flushHotMeta();   // leg20 语义：落盘后才报成功
            void had; void playerFinal;
            const tk = r.timing || {};
            const tsec = tk.ms == null ? null : Math.round(tk.ms / 1000);
            setStatus(`新世界已就绪「${src.worldName || '未名世界'}」（${(seed.entities || []).length} 个名号 · ${seed.context.positions.length} 个地点 · 你=${piece.name} · 源=${src.label}${src.truncated ? ' · 源已截断' : ''}${tsec == null ? '' : ` · 抽取 ${tk.calls || 0} 次调用 ${tsec} 秒`}）${flushOutcomeText(flushed)}`);
        } catch (err) {
            setStatus(`⚠ 初始化失败：${err?.message || err}`);
        }
    };

    // 面板按钮写的是 `clear-evolution`（render.js §参数/设置页那个"清除演化层"按钮）——
    //   与 `reset-dynamic` 同一动作，两个名字都接上（同上：防"按钮画了没人接"）。
    bus['clear-evolution'] = (payload, event) => bus['reset-dynamic'](payload, event);

    bus['reset-dynamic'] = async () => {        try {
            const meta = readHotMeta();
            const world = meta ? loadHotAccount(meta) : null;
            if (!world?.context?.setting?.dynamic) { setStatus('⚠ 还没有世界（无演化层可清）'); return; }
            // ★★★leg46 续（本轮查出来的**真缺陷**，用户症状的一个真来源）：
            //   `resetDynamicLayer()` 的结构是 `dynamic: { tension, env: {}, derivedFrom: [] }` ——
            //   它把 `env` **清成空表**（那是 leg26 之前"四个数值环境量"的设计遗产）。
            //   而**引擎读档位读的就是 `dynamic.env`**（`pack.js` 进包 / `limits.js` 当闸）⇒
            //   按一下这枚按钮，引擎眼里玩家的档位当场"回归默认"，直到下一次载入才被真源镜像补回来。
            //   旧状态条还写着「参数档位保留」——**说得比做的好听**（本仓禁的那一类）。
            //   ⇒ 定稿：清完**立刻把玩家档位镜像补回去**（真源才是档位的家，清演化层不许碰它），
            //     并让状态条如实报"补回来几个"。★补的只有**玩家输入**（`playerInputs`）——
            //     因变量（民生度/动乱度）是**世界的结果**，这一枚按钮清的正是引擎算出来的那一层，
            //     把它们搬回来就会"清了又被填回去"（判据 ⑫b 当场抓红过这一版）。
            const carried = paramHub.playerInputs(world);     // 清之前在手上（只读，不改世界）
            world.context.setting = resetDynamicLayer(world.context.setting);
            const dyn = world.context.setting.dynamic;
            world.context.setting = { ...world.context.setting, dynamic: { ...dyn, env: { ...carried } } };
            const rot = await ensureChronicleRotated(world);
            LISTED_VOLUMES = await listOldVolumes();
            refreshWorld(rot.hot, { oldVolumes: LISTED_VOLUMES });
            if (!rot.ok) {
                setStatus(`⚠ ${rot.error}——演化层已在内存清掉、盘上没写（可重试）`);
                return;
            }
            const flushed = await flushHotMeta();
            const n = Object.keys(carried).length;
            setStatus(`演化层已清（张力重算 · 卷库不动）· 参数档位 ${n ? `${n} 个原样保留并已同步给引擎` : '本来就没设过'}${flushOutcomeText(flushed)}`);
        } catch (err) {
            setStatus(`⚠ 清演化层失败：${err?.message || err}`);
        }
    };

    // ---------- leg46 续：参数自检（**把取证做成一枚按钮**）----------
    // 用户令「老问题没解决，还是会回归默认」之后的这一棒：前七轮缺的**从来不是补丁，是读数**。
    // 这枚按钮一次给出五个决定性读数（主路键名/原文/能不能写 · 世界名与桶键 · 真源 · 引擎镜像 ·
    // 真源与镜像不一致的键），并尽量拷进剪贴板 ⇒ 玩家不用开控制台。
    bus['param-doctor'] = async () => {
        const ev = gatherParamEvidence();
        const text = paramEvidenceText(ev);
        console.info(text);
        let copied = false;
        try {
            if (globalThis.navigator?.clipboard?.writeText) { await globalThis.navigator.clipboard.writeText(text); copied = true; }
        } catch (_) { copied = false; }
        const bad = Object.keys(ev['真源'] || {}).filter((k) => (ev['账上镜像'] || {})[k] !== ev['真源'][k]);
        const head = ev['主路有没有这一格']
            ? `参数自检：真源 ${Object.keys(ev['真源'] || {}).length} 个键`
                + `${bad.length ? ` · ⚠ 有 ${bad.length} 个没同步给引擎（${bad.join('、')}）` : ' · 引擎镜像一致'}`
                + `${ev['主路能写'] === false ? ' · ⚠ 本地存储**写不进去**' : ''}`
            : '参数自检：⚠ 本地存储里**没有**参数这一格（写没落下去，或被清了）';
        setStatus(`${head} · ${copied ? '读数已复制到剪贴板，直接粘给我' : '读数已打进控制台（Console）'}`);
    };
}

function bindActions() {
    const win = document.getElementById(WINDOW_ID);
    if (!win) return;
    win.addEventListener('click', (e) => {
        const el = e.target?.closest?.('[data-action]') || e.target?.closest?.('.sw2-goto');
        if (!el) return;
        if (el.classList.contains('sw2-goto')) {
            const view = el.getAttribute('data-view') || 'archive';
            win.querySelector(`.sw2-tab[data-view="${view}"]`)?.click();
            return;
        }
        const action = el.getAttribute('data-action');
        const payload = { source: el.getAttribute('data-source'), vol: el.getAttribute('data-vol'), chain: el.getAttribute('data-chain'), filter: el.getAttribute('data-filter'), entity: el.getAttribute('data-entity'), name: el.getAttribute('data-name'), force: el.getAttribute('data-force'), snap: el.getAttribute('data-snap'), tick: el.getAttribute('data-tick'), param: el.getAttribute('data-param'), value: el.getAttribute('data-value') };
        dispatchAction(action, payload, e);
    });
    // ★细案实体页：搜索框（`#sw2_ents_q`）走 input 通道——`refreshSections` 换掉 innerHTML 会**夺焦点**，
    //   ⇒ 重绘后必须把焦点与光标还回去（不还，用户打到第二个字就掉焦点——这是"面板抢玩家的手"的另一种形态）。
    // ★★终审 C1：**中文输入法（IME）组合期一律不许抢 DOM**。
    //   事件真相：组合期间浏览器照旧对 `<input>` 派发 `input`（`e.isComposing === true`），而上面那句
    //   重绘会把**搜索框那一个节点整个换掉** ⇒ 组合会话被当场打断：玩家用拼音打「东海浮空岛」，
    //   打到第二个字就没了（这正好打在用户验收第③步上）。
    //   ⇒ 处置（照本仓既有的"别抢玩家的手"口径，最小改动）：①组合期 `input` 进门**先早退**
    //     （不写状态、不重绘）；②`compositionend` 才把**整串**落成 `sw2EntsView.q` 并**补一次重绘**。
    //   ★**不用防抖/定时器绕**：那会把"打字时列表滞后"引进来（新的、更难解释的病），且与本笔"最小改动"不符。
    //   ★标志是**模块级** `let`（下面两支监听要共享它；挂在函数里等于没有）。
    //   ★判据走源码锁（`test/render.test.js` 的"终审 C1"那条，自带反向自证）——IME 组合序列在 Node 里
    //     造不出真序列，而这段护栏的可观察效果"不发生一次重绘"要真 DOM + 真世界对象才看得见。
    win.addEventListener('compositionstart', (e) => {
        if (e.target?.closest?.('#sw2_ents_q')) sw2EntsComposing = true;
    });
    win.addEventListener('compositionend', (e) => {
        const q = e.target?.closest?.('#sw2_ents_q');
        if (!q) return;
        sw2EntsComposing = false;
        // 组合结束 = 补一次**正常的提交**（组合期一次都没提交过）；四步与下面 input 那支同形。
        const caret = q.selectionStart;
        sw2EntsView.q = String(q.value || '');
        sw2EntsView.page = 1;                 // 换搜索词必回第一页（同筛选）
        refreshSections(['entities']);
        const again = win.querySelector('#sw2_ents_q');
        if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (_) {} }
    });
    win.addEventListener('input', (e) => {
        // ★C1 护栏：组合期**在改状态与重绘之前**早退（这两样都会把组合打断）
        if (e.isComposing || sw2EntsComposing) return;
        const q = e.target?.closest?.('#sw2_ents_q');
        if (!q) return;
        const caret = q.selectionStart;
        sw2EntsView.q = String(q.value || '');
        sw2EntsView.page = 1;                 // 换搜索词必回第一页（同筛选）
        refreshSections(['entities']);
        const again = win.querySelector('#sw2_ents_q');
        if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (_) {} }
    });
}

function bindTabs() {
    const win = document.getElementById(WINDOW_ID);
    if (!win) return;
    const tabs = [...win.querySelectorAll('.sw2-tab')];
    const views = [...win.querySelectorAll('.sw2-view')];
    for (const tab of tabs) {
        tab.addEventListener('click', () => {
            const view = tab.getAttribute('data-view');
            for (const t of tabs) t.classList.toggle('sw2-active', t === tab);
            for (const v of views) v.classList.toggle('sw2-active', v.id === `sw2_view_${view}`);
        });
    }
    document.getElementById('sw2_window_close')?.addEventListener('click', closeWindow);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeWindow();
    }, true);
}

function initPanel(ctx) {
    if (typeof window === 'undefined') return;
    if (window[NAMESPACE]?.loaded) return;
    window[NAMESPACE] = { loaded: true, version: VERSION };
    injectCss();
    modalBoost();
    window.addEventListener('error', onWinError);
    window.addEventListener('unhandledrejection', onWinError);
    ensureWindow(ctx).then(() => {
        bindTabs();
        bindActions();
        bindSettingsForm(); // K36：设置表单写通道（extension_settings）
        loadWorld().catch((err) => {
            // ★★★leg48：**这里原来是一个空函数 `.catch(() => {})`** —— 载入路的一切失败都被它吞掉。
            //   它的代价被记在案（用户报"改档位回默认"十二轮）：那十二轮里，**"世界到底载入成没成"
            //   这件事在玩家与维护者两边都不可见**（控制台一个字没有、界面上照旧画那一屏）。
            //   ⇒ 定稿：**吞错可以（不许因为载入失败把面板打挂），但必须出声**，而且说清"后果是什么"。
            console.warn('[story-world-v2] 载入世界失败（面板照常可用，参数照常能改能存；'
                + '只是"引擎那一格"与世界镜像要等下次载入补上）：', err);
            setStatus(`⚠ 世界载入失败：${String(err?.message || err)}——参数照常能改能存（引擎那一格下次载入补）`);
        });   // 首次打开即载入热账（缺世界则空态提示）
        setupAsyncTicks(ctx); // K36：回合钩子（MESSAGE_RECEIVED 推进 / CHAT_CHANGED 重载）
    });
    ensureWandEntry();
}

// 启动：ctx 就绪即挂（DOMContentLoaded / ST 就绪事件双保险）
(function boot() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const start = () => {
        const ctx = getCtx();
        if (ctx) initPanel(ctx);
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
        if (!window[NAMESPACE]) window.addEventListener('SillyTavernReady', start, { once: true });
        if (!window[NAMESPACE]) window.addEventListener('APP_READY', start, { once: true });
    }
})();
