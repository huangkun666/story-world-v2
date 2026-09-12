// story-world-v2/web/index.js
// K30 骨架 + K34 渲染接线（编排层·浏览器侧）：ST 插件入口——面板挂载 + 八页签渲染刷新。
// 范式实读 v1（manifest/js/settings.html/ui.js）后仿写，命名空间 sw2_ 全隔离：
//   ① settings.html 模板经 ctx.renderExtensionTemplateAsync 注入（缺模板有最小回退窗）；
//   ② 扩展菜单「魔杖」入口挂 extensionsMenu；③ 弹窗 z-index 压顶内联规则（id 特异性）；
//   ④ css 带版本查询防浏览器缓存吞修复；⑤ 全局错误网进状态条。
// K34 渲染接线：refreshWorld(world, {config, oldVolumes}) 把 render.js 纯函数产物填入页签；
//   面板零第二份状态（A-2 语义）；按钮走 data-action 委托 → window.__sw2Actions（K36 接调度，
//   当前为占位提示）。纪律：模块顶层零 DOM（node --test 可动态导入；browser-compat 扫描覆盖）。
import { renderAll, renderVolumeReadHtml, renderChainViewHtml, LABELS } from '../src/render.js';
import { expandChain } from '../src/chain.js';
import { migrateLegacyAttrs } from '../src/settle.js';   // leg24 片4：旧账一次性清理（读到热账后、渲染前）
import {
    hotAccountShape, loadHotAccount, planChronicleRotation, countLedgerEntries,
    volumeToChronicleRows, buildExportBundle, verifyImportBundle,
} from '../src/storage.js';
import { seedBookEntities, extractWorldSetting, applySettingToSsot, resetDynamicLayer, describeProgress } from '../src/abstract.js';
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
import { PARAM_KEYS, SWITCH_PARAMS, isParamKey, normalizeParam, switchOn } from '../src/params.js';   // leg26：世界参数档位（参数页写通道的白名单真源）
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
const CSS_VERSION = '20260913-leg33d';

// leg24 片1：leg21 增量补抽的会话态（refining / refinedFailed / refinedFp / syncRefinedFp）随补抽入口一并删除

export const sw2Version = () => VERSION;
export function sw2TabState(name, active) {
    return { name: String(name), active: Boolean(active) };
}

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

// ---------- K34：渲染接线（纯函数产物 → DOM；面板零第二份状态） ----------
export function refreshWorld(world, { config, oldVolumes = [] } = {}) {
    if (typeof document === 'undefined') return;
    const win = document.getElementById(WINDOW_ID);
    if (!win) return;
    try {
        // 第十三棒修复：config 缺省时取 live extension_settings——此前所有调用点都不传 config，
        // 每次重绘把设置表单清空（「填了却报未配置、刷新即丢」根因之二）
        const cfg = config ?? modelSettings() ?? {};
        sw2LastWorld = world;   // K41：链视图入口持引用（同一对象，零第二份状态）
        // leg25 d：批量补全进度随 config 进渲染层（渲染层不碰任务状态——面板零第二份状态纪律）
        // leg27 后：快照清单同理（config.snapshots = IDB 读回的元信息 + 一行事实摘要）
        // leg27 h：记忆投递自证面同理（config.memoryPush = 上一次投递的实测结果）
        const out = renderAll(world, { config: renderCfg(), oldVolumes, view: { chronicleFilter: sw2ChronicleFilter } });
        const chipWorld = win.querySelector('#sw2_world_chip');
        if (chipWorld) chipWorld.textContent = `世界：${out.header.world || '—'}`;
        const chipTick = win.querySelector('#sw2_tick_chip');
        if (chipTick) chipTick.textContent = out.header.tick;
        for (const name of SECTIONS) {
            const el = win.querySelector(`#sw2_view_${name}`);
            if (!el) continue;
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

// ---------- K34/K36：按钮委托（真实调度：advance-world 已接队列；其余按细案时序） ----------
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
    const label = { 'init-world': '开始新世界' }[action] || action;
    setStatus(`「${label}」接线随后续步骤（当前为占位）`);
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
            status('⏸ 插件已关（发消息不自动推进）· 参数页「插件总闸」可开 · 或按「推进一轮」手动推');
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

function writeHotMeta(meta) {
    const ctx = freshCtx();
    if (!ctx || typeof ctx.updateChatMetadata !== 'function') return;
    ctx.updateChatMetadata({ [HOT_META_KEY]: meta });
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
// 返回布尔供状态条确认位（「已落盘」/「⚠ 落盘失败」）——复验一眼可判。
async function flushHotMeta() {
    const ctx = freshCtx();
    if (!ctx || typeof ctx.saveChat !== 'function' || sw2HotMetaFlushing) return false;
    sw2HotMetaFlushing = true;
    try {
        await ctx.saveChat();
        console.info('[story-world-v2] 热账已落盘', new Date().toISOString());
        return true;
    } catch (err) {
        console.warn('[story-world-v2] 热账落盘失败', String(err?.message || err));
        return false;
    } finally {
        sw2HotMetaFlushing = false;
    }
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
    sw2SnapLast = [fp, ...sw2SnapLast].slice(0, 2);
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
        writeHotMeta(hotAccountShape(r.world));
        const flushed = await flushHotMeta();
        sw2LastWorld = r.world;
        refreshWorld(r.world, { oldVolumes: LISTED_VOLUMES });
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
        const paramEl = e.target?.closest?.('[data-action="set-param"]') || (e.target?.getAttribute?.('data-action') === 'set-param' ? e.target : null);
        if (paramEl) {
            dispatchAction('set-param', { param: paramEl.getAttribute('data-param'), value: paramEl.getAttribute('data-value') ?? paramEl.value }, e);
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

// B6（leg25 d，细案 spec-lookup-batch-refresh §B6）：在条目正文里**定位到该名号自己那一行**。
//   为什么值得做：v2 只会"命中条目→整条给"，而用户的书格式高度规整——
export function locateNameLine(content, name) {
    const text = String(content ?? '');
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
    return { ...(modelSettings() || {}), lookupTask: batchTaskStatus(), snapshots: sw2SnapshotCache, memoryPush: sw2MemoryPush, ...extra };
}

// 局部重绘（★leg27 后：`set-param` 原走整页重绘 ⇒ 销毁正在展开的 `<select>` ⇒ 列表自己关）。
// 纪律：只换受影响页签的 innerHTML；失败只上控制台（局部重绘失败不该打断落账那条路）。
function refreshSections(names) {
    if (typeof document === 'undefined') return;
    try {
        const win = document.getElementById(WINDOW_ID);
        if (!win || !sw2LastWorld) return;
        const out = renderAll(sw2LastWorld, { config: renderCfg(), oldVolumes: LISTED_VOLUMES, view: { chronicleFilter: sw2ChronicleFilter } });
        for (const name of names || []) {
            const el = win.querySelector(`#sw2_view_${name}`);
            if (!el) continue;
            if (name === 'board') {
                el.innerHTML = typeof out.board === 'string' ? out.board : BOARD_BLOCK_ORDER.map((k) => (out.board && out.board[k]) || '').join('');
            } else if (typeof out[name] === 'string') {
                el.innerHTML = out[name];
            }
        }
    } catch (err) {
        console.warn('[story-world-v2] 局部重绘失败（不影响落账）', String(err?.message || err));
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
    if (!missing.length) return { ok: false, error: '这一栏已经有原话了（要重查请用「重查」）' };
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
    es?.on?.(et.CHAT_CHANGED, () => { loadWorld().catch(() => {}); });
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
    const rot = await ensureChronicleRotated(world);
    if (!rot.ok) {
        // 轮转失败 = 世界不动（内存与盘上一致），如实报错不装成功（E2 语义）
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
    // ★leg33d：插件总闸的一次性迁移（幂等；只对"该键从未写过"的世界动手，见 ensureAutoAdvanceKey 注释）。
    //   有推进史的存量世界 ⇒ 迁成 '1'（升级前后行为一字不变）；全新世界 ⇒ '0'（要你按一下「开始」）。
    const autoKeyAdded = ensureAutoAdvanceKey(world2);
    if (changed || loc.inherited > 0 || migrated !== hot || pieceSync.renamed || autoKeyAdded) {   // migrated!==hot = 迁移真改了账（ref 判等，幂等不空写）
        writeHotMeta(hotAccountShape(world2));   // 账本已变：内存与盘上必须一致（导出/「全册 N」读的就是这里）
        const flushed = await flushHotMeta(); // 名册入账/旧账清理不该只活在页面内存——走既有显式落盘路径
        if (!flushed) console.warn('[story-world-v2] 账本写回未落盘', { seeded: seed.seeded, seededDelta, backfilled, 位置: loc.inherited, 棋子校准: pieceSync });
        else if (backfilled > 0 || loc.inherited > 0 || pieceSync.renamed || autoKeyAdded) {
            console.info('[story-world-v2] 名册落账可重入：本次补齐', {
                归属: seed.parentVerified ?? 0, 字段: seed.fieldsAttached ?? 0, 弃关系: seed.parentDemoted ?? 0, 位置: loc.inherited,
                棋子校准: pieceSync,   // ★leg32h：认领/改名/并掉空棋子都要留痕（用户能看见"主角认领了没有"）
                插件总闸: autoKeyAdded ? `${AUTO_ADVANCE_KEY}=${world2.context.setting.dynamic.env[AUTO_ADVANCE_KEY]}（首次写入）` : '已写过，不碰',
            });
        }
    }
    LISTED_VOLUMES = await listOldVolumes();
    refreshWorld(world2, { oldVolumes: LISTED_VOLUMES });
    refreshSnapshots();   // leg27 后：快照清单随世界加载刷新（异步，回来再重绘一次）
    // ★leg33d：关着的时候**明说**（否则"世界怎么不动了"会被当成 bug；面板照常可用）
    if (!autoAdvanceOn(world2)) {
        setStatus('⏸ 插件已关 · 自动推进不生效（发消息/切聊天都不动世界）· 参数页「插件总闸」可开 · 也可按「推进一轮」手动推');
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
export const memoryPushStatus = () => sw2MemoryPush;
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

// ---------- K35：真实动作总线（阅卷/导出/导入；其余按钮随 K36 接调度） ----------
if (typeof window !== 'undefined') {
    window.__sw2Actions = window.__sw2Actions || {};
    const bus = window.__sw2Actions;

    // ---------- leg26：世界参数 · 档位（参数页）----------
    // 口径（用户令「参数独开页签」+「让用户自己调挡位」）：
    //   · 这些是**玩家对世界的输入**，不是引擎算出来的判断、也不是书里的原稿 ⇒ 独立一页。
    //   · 引擎**只照抄**：值必须是 params.js 的档位原话（白名单），落 `setting.dynamic.env`。
    //   · 落账后**立刻落盘**（否则 Ctrl+F5 一次就丢），再重绘面板。
    bus['set-param'] = async (payload) => {
        const key = String(payload?.param || '').trim();
        const value = String(payload?.value ?? '').trim();
        if (!isParamKey(key)) { setStatus('⚠ 未知参数键'); return; }
        const norm = value ? normalizeParam(key, value) : null;
        if (value && !norm) { setStatus(`⚠ 「${value}」不是「${LABELS.env[key] || SWITCH_PARAMS[key]?.label || key}」的可选档位`); return; }
        const meta = readHotMeta();
        const world = meta ? loadHotAccount(meta) : null;
        if (!world?.context?.setting?.dynamic) { setStatus('⚠ 还没有世界可设参数（先初始化）'); return; }
        const cur = { ...(world.context.setting.dynamic.env || {}) };
        // ★leg27 c：`<select>` 滚轮滑过就改选中项 ⇒ 把"什么都没改"当修改。**值没变即忽略**。
        const before = Object.prototype.hasOwnProperty.call(cur, key) ? cur[key] : null;
        const after = norm || null;
        if (before === after) {
            console.info(`[story-world-v2] set-param 无变化已忽略：${key} = ${after ?? '未定'}（多半是滚轮/重复事件，不是你的操作）`);
            return;
        }
        if (norm) cur[key] = norm; else delete cur[key];              // 清成「未定」= 删键（空着就是空着）
        world.context.setting = { ...world.context.setting, dynamic: { ...world.context.setting.dynamic, env: cur } };
        sw2LastWorld = world;
        writeHotMeta(hotAccountShape(world));
        const flushed = await flushHotMeta();
        // 开关刚打开 ⇒ 立刻投一次（不等下一轮）。leg27 h：同样如实上报（自证面）
        let memResult = null;
        if (key === 'memoryEnabled') {
            if (norm === '1') memResult = await pushMemoryNow(world).catch(() => ({ ok: false, reason: '抛错（见控制台）' }));
            markMemoryPush(norm === '1' ? memResult : { ok: false, reason: '开关刚被关掉' }, world?.meta?.tick);
            if (norm !== '1') sw2MemoryPush = null;   // 关掉 ⇒ 自证面归零（不留上一次的"已投"）
        }
        // ★leg27 后：**不许整页重绘**（那会把用户正在操作的 `<select>` 销毁重建 ⇒ 列表自己关掉）。
        //   只重绘受影响的两页：参数页（旋钮状态真源）+ 观棋页（信息带也呈现档位）。
        refreshSections(['params', 'board']);
        const memLine = key === 'memoryEnabled' ? memoryPushLine() : '';
        // ★leg33d：总闸被打开 ⇒ 立刻把它"接上"（不必等下一轮）。关掉**不做任何拆除**——
        //   世界原样留在盘上、面板照常渲染，只是不再自动推进（手动「推进一轮」永不被闸）。
        if (key === AUTO_ADVANCE_KEY) {
            if (norm === '1') {
                const hotNow = loadHotAccount(readHotMeta());
                setStatus('▶ 插件已开 · 发消息会自动推进世界（要停请回参数页按「关」）'
                    + (hotNow ? '' : ' · ⚠ 但还没有世界：先「✨ 开始新世界」'));
            } else {
                setStatus('⏸ 插件已关 · 世界原样留在盘上（没有清账、没有拆线）· 要看按观棋窗口、要推按「推进一轮」');
            }
        }
        setStatus(`${LABELS.env[key] || SWITCH_PARAMS[key]?.label || key} → ${norm === '1' ? '开' : norm === '0' ? '关' : (norm || '未定')}${flushed ? ' · 已落盘' : ' · ⚠ 落盘失败（见控制台）'}${memLine ? ` · ${memLine}` : ''}`);
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
                writeHotMeta(hotAccountShape(res.world));
                const store = volumeStore();
                for (const v of res.volumes) await store.put(v);
                await loadWorld();
                const flushed = await flushHotMeta();   // leg20 语义：关键路径显式落盘后再报成功
                setStatus(`已导入：世界与 ${res.volumes.length} 卷${flushed ? ' · 已落盘' : ' · ⚠ 落盘失败（见控制台）'}`);
            } catch (err) {
                setStatus(`⚠ 导入失败：${err?.message || err}`);
            }
        });
        input.click();
    };

    // ---------- K38：初始化（抽取五件套 + 名册）----------
    bus['init-world'] = async () => {
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
            const had = Boolean(readHotMeta());
            writeHotMeta(hotAccountShape(seed));
            await loadWorld();
            const flushed = await flushHotMeta();   // leg20 语义：落盘后才报成功
            void had; void playerFinal;
            const tk = r.timing || {};
            const tsec = tk.ms == null ? null : Math.round(tk.ms / 1000);
            setStatus(`新世界已就绪「${src.worldName || '未名世界'}」（${(seed.entities || []).length} 个名号 · ${seed.context.positions.length} 个地点 · 你=${piece.name} · 源=${src.label}${src.truncated ? ' · 源已截断' : ''}${tsec == null ? '' : ` · 抽取 ${tk.calls || 0} 次调用 ${tsec} 秒`}）${flushed ? ' · 已落盘' : ' · ⚠ 落盘失败（见控制台）'}`);
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
            world.context.setting = resetDynamicLayer(world.context.setting);
            const rot = await ensureChronicleRotated(world);
            LISTED_VOLUMES = await listOldVolumes();
            refreshWorld(rot.hot, { oldVolumes: LISTED_VOLUMES });
            if (!rot.ok) {
                setStatus(`⚠ ${rot.error}——演化层已在内存清掉、盘上没写（可重试）`);
                return;
            }
            const flushed = await flushHotMeta();
            setStatus(`演化层已清（参数档位保留 · 张力重算 · 卷库不动）${flushed ? ' · 已落盘' : ' · ⚠ 落盘失败（见控制台）'}`);
        } catch (err) {
            setStatus(`⚠ 清演化层失败：${err?.message || err}`);
        }
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
        loadWorld().catch(() => {});   // 首次打开即载入热账（缺世界则空态提示）
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
