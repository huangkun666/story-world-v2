// story-world-v2/web/index.js
// K30 骨架 + K34 渲染接线（编排层·浏览器侧）：ST 插件入口——面板挂载 + 六页签渲染刷新。
// 范式实读 v1（manifest/js/settings.html/ui.js）后仿写，命名空间 sw2_ 全隔离：
//   ① settings.html 模板经 ctx.renderExtensionTemplateAsync 注入（缺模板有最小回退窗）；
//   ② 扩展菜单「魔杖」入口挂 extensionsMenu；③ 弹窗 z-index 压顶内联规则（id 特异性）；
//   ④ css 带版本查询防浏览器缓存吞修复；⑤ 全局错误网进状态条。
// K34 渲染接线：refreshWorld(world, {config, oldVolumes}) 把 render.js 纯函数产物填入六页签；
//   面板零第二份状态（A-2 语义）；按钮走 data-action 委托 → window.__sw2Actions（K36 接调度，
//   当前为占位提示）。纪律：模块顶层零 DOM（node --test 可动态导入；browser-compat 扫描覆盖）。
import { renderAll, renderVolumeReadHtml, renderChainViewHtml } from '../src/render.js';
import { expandChain } from '../src/chain.js';
import { migrateLegacyAttrs } from '../src/settle.js';   // leg24 片4：旧账一次性清理（读到热账后、渲染前）
import {
    hotAccountShape, loadHotAccount, planChronicleRotation, countLedgerEntries,
    volumeToChronicleRows, buildExportBundle, verifyImportBundle,
} from '../src/storage.js';
import { seedBookEntities, extractWorldSetting, applySettingToSsot, resetDynamicLayer } from '../src/abstract.js';
// leg24 片1（停抄书）：runAttrsRound / runRelationRound / applyRosterAttrs / refineEntityAttrs 四个入口随
// 「抄书流水线」整条删除（名册里不再有从书里抄来的属性/隶属，补抽按钮与 bus 动作同批下掉）。
// bookFingerprint 的浏览器侧唯一用途是补抽前的指纹守卫，随之删除（书指纹仍由 extractWorldSetting 写进 setting）。
import { createIdbVolumeStore } from './idb-backend.js';
import { createTickQueue } from '../src/async-tick.js';
import { runTick } from '../src/tick.js';
import { resolveBrowserTransport, EXTRACTION_MAX_TOKENS } from '../src/transport-config.js';
import { composeInitSource } from '../src/init-source.js';
// 细案 spec-entity-field-lookup（用户 2026-09-11 批准）：按需查书补字段（实力/位置）+ 两条 ≤15。
// 本层只负责"取世界书原文 + 落盘"，选择/查询/回写的判据全在 src/entity-lookup.js（纯编排层，可 Node 测）。
import { runEntityLookupStep } from '../src/entity-lookup.js';

const NAMESPACE = 'STORY_WORLD_V2';
const VERSION = '0.1.0';
const WINDOW_ID = 'story_world2_window';
const SECTIONS = ['board', 'chronicle', 'archive', 'entities', 'setting', 'settings'];
// K33 板式：board = 五块对象（时局句/信息带/盘算总览/动态流/位置速览），DOM 组装在接线层
const BOARD_BLOCK_ORDER = ['digest', 'infoband', 'agendaStrip', 'feed', 'side'];
const CSS_HREF = new URL('./style.css', import.meta.url).href;
const CSS_VERSION = '20260911-leg24-5';

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
        const out = renderAll(world, { config: cfg, oldVolumes, view: { chronicleFilter: sw2ChronicleFilter } });
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
        setStatus(`已同步 · 刚演完 ${out.header.tick}${delta == null ? '' : ` · 编年 ${delta >= 0 ? '+' : ''}${delta} 行`} · 窗口只读，不参与剧情`);
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

function volumeStore() {
    const ctx = freshCtx();
    const chatId = ctx?.chatId || 'default';
    return createIdbVolumeStore(String(chatId));
}

// ---------- K36：异步编排接线（A-4/A-5）----------
// 线程模型：单例 tick 队列（防重入锁）；失败世界不动（引擎不变式）+ 状态条报错 + 重试路径；
// 推进时机=回复完成后（MESSAGE_RECEIVED，2026-08-28 拍板：避免与主聊天 LLM 抢配额 429）；
// CHAT_CHANGED → 世界重载（v1 同款）。
let sw2TickQueue = null;
let sw2LastSettings = null;
let sw2PrevChronicle = null;      // 上一渲染的编年行数（第十三棒：进展计数用）
let sw2ChronicleFilter = null;    // K41 编年五筛视图态（kind Set；null=全选；纯视图态——不落 SSOT、不落盘，重绘保留，关面板重置）
let sw2LastWorld = null;          // K41 链视图入口的世界引用缓存（同一对象引用，非第二份状态）
let sw2LastPicks = null;          // 细案 §3：上一轮"上场实体"名单（选人调用失败时退回它，再退兜底名单）

function modelSettings() {
    const ctx = freshCtx();
    const raw = ctx?.extensionSettings?.['story_world_v2'] ?? null;
    return raw && typeof raw === 'object' ? raw : null;
}

// K36：设置页表单 ↔ extensionSettings 双向（v1 范式：即时写回 + saveSettingsDebounced）
const SETTINGS_INPUTS = { baseUrl: 'sw2_base', apiKey: 'sw2_key', model: 'sw2_model', playerDesc: 'sw2_player_desc' };

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

// ---------- leg25 检察官审计处置（B 组）：玩家棋子接线：建世界时真的给世界一枚玩家实体 ----------
// 审计发现（旧法）：`context.playerId` **生产路径从不产生**（只有 test/ 与 demo/ 赋过值）→
//   ①check-step 五条"模型禁写玩家"守卫全是 `if (playerId && …)` 恒假；②streams 走"无玩家"分支降级全见、
//   掩码永不生效；③settle 的 K9 影响通道整体失效；④extractCtx 为空 → 对话依据册恒空 → dialogueFact 入局永不合法。
// 现法：开新世界时**总是**建一枚玩家实体（书本名册里的玩家角色优先复用，否则新建 e_p<N>）并写 context.playerId；
//   开档描述（设置页「你的开档描述」）**只在第一次**用来解析四维，之后冻结（引擎与模型都不再改它）。
function nextPlayerId(entities = []) {
    let max = 0;
    for (const e of entities) {
        const m = /^e_p(\d+)$/.exec(String(e?.id || ''));
        if (m) max = Math.max(max, Number(m[1]));
    }
    return `e_p${max + 1}`;
}

// ---------- leg25 检察官审计处置（D 组）：位置集从书里现成的地名建 ----------
// 审计发现（旧法）：`context.positions` 建账时写死 `['未明']`、建账后**全仓无写入点** →
//   613 个实体位置全落「未明」、位置校验退化为单值比较、"移动"在结构上不可能。
// 来源不用新机制、不用模型猜：书里**本来就有**地名与驻点——canon.bookEntities 的 kind='location'
//   条目（书的地名条目）+ 各条目的 location 串（书中明述的所在/驻地）。
// 纪律：兜底词「未明」永远在集内（名册没带 location 的实体落在它上面，诚实表达"书没说"）；
//   不发明新地名（集内每一个都来自书里的一行字）；上限只做防御（防超长书把位置列表灌爆 prompt）。
export const POSITIONS_CAP = 60;   // 提案：位置集上限（超出按书序截断；防巨书灌爆输入）

export function derivePositions(setting, { fallback = '未明', cap = POSITIONS_CAP } = {}) {
    const book = setting?.frozen?.canon?.bookEntities || [];
    const seen = [];
    const push = (v) => {
        const s = String(v || '').trim();
        if (!s || seen.includes(s)) return;
        seen.push(s);
    };
    for (const b of book) {
        // 书里明述"它坐落在哪"时，**这个条目贡献的是那个地方**（它自己的名字不是地方）
        if (b?.location) { push(b.location); continue; }
        if (b?.kind === 'location') {
            // 结构标签（`<X帝麾下_Y>` 这类）不是地名——见 abstract 的 scanBookDeclarations 形态判据
            if (String(b.name || '').includes('_')) continue;
            push(b.name);
        }
    }
    return [fallback, ...seen.filter((s) => s !== fallback).slice(0, Math.max(0, cap - 1))];
}

// 建玩家棋子：名册里已有同名者则复用（把 playerId 指过去），否则新建 e_p<N>。
// 返回 {created, reused, playerId, name}（就地改 world —— 与 seedBookEntities 同风格）。
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
        // leg25 c：玩家棋子不再带 attrs（四维已删）——它和别的实体同尺：只有身份 + 位置。
        lastActiveTick: 0,      // 头几轮不静默（与 spawnEntities 同口径）
    };
    world.entities = [...entities, ent];
    world.context = { ...(world.context || {}), playerId: id };
    return { created: true, reused: false, playerId: id, name: ent.name };
}

// 开档描述里写明姓名 → 给玩家棋子改名（id 不变：盘算/事件/编年里的引用都不受影响）。
// 同名已存在（书里就有这个角色）→ 不新建、把棋子指过去（复用那条账）。
export function namePlayerPiece(world, parsedName) {
    const nm = String(parsedName || '').trim();
    const pid = world.context?.playerId;
    if (!nm || !pid) return { renamed: false };
    const others = (world.entities || []).find((e) => e.name === nm && e.id !== pid);
    if (others) {
        world.context = { ...world.context, playerId: others.id };
        world.entities = world.entities.filter((e) => e.id !== pid);   // 空棋子不留（它一格数据都没有）
        return { renamed: true, mergedInto: others.id, name: others.name };
    }
    world.entities = world.entities.map((e) => (e.id === pid ? { ...e, name: nm } : e));
    return { renamed: true, name: nm };
}

// 第十八棒：初始化设定源自动合订（编排层）——只有自动两条路：
// 缺省自动合订 角色卡四件套 + 世界信息/卡内置世界书（世界书全量，大书分块抽取在 abstract 层）；
// 恢复 v1「读取当前角色卡一键初始化」手感；原生 prompt 从初始化路径清除。
// 取数形状宽容：世界信息兼容 三形态（旧版 ctx.worldInfo 数组/{entries} + 模块化 ST 的官方挂载世界）；
// 失败上控制台诊断现场（形状未知时不再盲猜）。

// 世界书条目收集（第十九棒实证修正）：模块化 ST 的 getContext() 无 worldInfo/character 字段——
// 挂载世界在 extension_settings.world_info（已载表）+ globalSelect（附加名），条目经官方
// ctx.loadWorldInfo(name) 取（getContext 暴露，服务端按名取、模块内缓存）。旧版 ctx.worldInfo 形态保留兼容。
// 候选序 = 卡挂 world 字段 → globalSelect → 已载表键（去重）。
async function collectWorldInfoEntries(ctx, character) {
    const legacy = ctx?.worldInfo;
    if (Array.isArray(legacy)) return { entries: legacy, worldSources: null };
    if (legacy && typeof legacy === 'object' && Array.isArray(legacy.entries)) return { entries: legacy.entries, worldSources: null };
    const names = [];
    const seenName = new Set();
    const push = (n) => { if (n && typeof n === 'string' && n.trim() && !seenName.has(n)) { seenName.add(n); names.push(n.trim()); } };
    push(character?.world); // 卡挂世界（v1 时代同指针：大荒z → 大荒-姬元真）
    const chatWi = ctx?.chatMetadata?.['world_info']; // 聊天级挂载（ST assignLorebookToChat 落 chat_metadata.world_info）
    if (typeof chatWi === 'string') push(chatWi); else if (Array.isArray(chatWi)) for (const n of chatWi) push(n);
    for (const n of (ctx?.extensionSettings?.world_info?.globalSelect ?? [])) push(n);
    for (const n of Object.keys(ctx?.extensionSettings?.world_info ?? {})) push(n);
    const entries = [];
    const worldSources = [];
    for (const name of names) {
        try {
            const w = typeof ctx?.loadWorldInfo === 'function' ? await ctx.loadWorldInfo(name) : null;
            const raw = w?.entries;
            const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : null);
            worldSources.push({ name, ok: Boolean(list?.length), entries: list?.length ?? 0 });
            if (list) for (const e of list) if (e && typeof e === 'object') entries.push(e);
        } catch (err) {
            worldSources.push({ name, ok: false, entries: 0 });
        }
    }
    return { entries, worldSources };
}

// 当前聊天角色卡（第十九棒实证修正）：模块化 ST 的 getContext() 没有 character 字段——单聊取
// characters[characterId]（ST 内部同款索引语义），群聊取群成员卡（v1 chatMemberCards 同款：members=头像名）。
// 旧版 ctx.character 保留兼容。不再回退 characters[0]——那是角色库首卡（内置 Assistant），不是当前聊天卡。
function pickCharacter(ctx) {
    if (ctx?.character && typeof ctx.character === 'object') return ctx.character; // 旧版 ST 兼容
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

async function autoComposeSource() {
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
    return res;
}

// 抽取调用诊断包装（第十八棒）：transport 返回裸字符串（transport-http 契约）或 {text} 对象都吃——
// K38 抽取接线曾只取 `.text`（真实 transport 返回字符串 → 恒空 →「抽取输出为空」实为接线雷，
// 合成演练从未真跑所以未炸；worldstep.js L12 同款双形取法早已存在）。空/非 JSON 响应现场上控制台。
function diagExtract(resolved) {
    return async (p) => {
        try {
            const res = await resolved.transport(p);
            const text = typeof res === 'string' ? res : (res && typeof res === 'object' && typeof res.text === 'string' ? res.text : '');
            if (!text.trim()) {
                console.warn('[story-world-v2] 抽取空响应', {
                    promptLen: Array.from(p).length,
                    responseType: typeof res,
                    responseKeys: res && typeof res === 'object' ? Object.keys(res) : null,
                    textLen: text.length,
                });
            } else {
                try { JSON.parse(text); } catch (_) {
                    console.warn('[story-world-v2] 抽取非JSON响应（原文前120字）', text.trim().replace(/\s+/g, ' ').slice(0, 120));
                }
            }
            return text;
        } catch (err) {
            console.warn('[story-world-v2] 抽取调用异常', String(err?.message || err));
            throw err;
        }
    };
}

// 第十九棒：初始化成功路径常驻取数诊断（交接任务书 §8.1 悬案实证用）——把「浏览器运行时到底取到了什么」
// 整包上控制台：聊天身份/角色卡形态与挂载世界逐本条目数、worldInfo 形态、合订源组成预览、抽取产出尺寸。
// 纯日志零行为变化（失败路径另有 autoComposeSource 的诊断 warn，此处抽取完成后统一补两侧事实，成败都打）。
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
        console.info('[story-world-v2] 初始化取数诊断', {
            identity: { characterId: ctx?.characterId ?? null, groupId: ctx?.groupId ?? null, chatId: ctx?.chatId ?? null },
            character: {
                name: char?.name ?? null,
                world: char?.world ?? null, // 卡挂世界（模块化 ST 主取数指针）
                pieces: pieces.length ? pieces : null,
                book: charBook ? { at: char.character_book ? 'character_book' : 'data.character_book', entries: bookEntries ? bookEntries.length : null } : '无',
            },
            worldInfo: {
                shape: wiShape,
                entries: wiEntries ? wiEntries.length : null,
                keys: wi && typeof wi === 'object' && !Array.isArray(wi) ? Object.keys(wi).slice(0, 20) : null,
                preview: wiEntries ? wiEntries.slice(0, 2).map((e) => `${String(e.key ?? e.name ?? e.uid ?? '?')}: ${String(e.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}`) : null,
                mounted: src?.sourceDiag?.worldSources ?? null, // 逐本挂载世界：名称/取到与否/条目数（实证核心）
            },
            source: { ok: src?.ok, label: src?.label, usedChars: src?.usedChars, entryCount: src?.entryCount, pieceCount: src?.pieceCount, truncated: src?.truncated, preview: src?.text ? src.text.replace(/\s+/g, ' ').slice(0, 40) : null },
            extract: extractOut ? { ok: extractOut.ok, cached: extractOut.cached, fingerprint: extractOut.fingerprint, errors: extractOut.errors || [], canonSize: canon ? { powerScale: canon.powerScale?.length || 0, rules: canon.rules?.length || 0, society: canon.society?.length || 0, techOrMagic: canon.techOrMagic?.length || 0, historyNotes: canon.historyNotes?.length || 0, bookEntities: canon.bookEntities?.length || 0 } : null } : null,
        });
    } catch (_) {}
}

// K36 设置页表单 ↔ extension_settings 双向：表单值由渲染 config 注入（refreshWorld cfg），
// 这里只刷密钥 placeholder——不再覆写 render 已注入的值（第十三棒修复根因之一）。
function refreshSettingsHints() {
    const s = modelSettings() || {};
    const el = document.getElementById(SETTINGS_INPUTS.apiKey);
    if (el) el.placeholder = s.apiKey ? '（已设置 · 留空=保持不变）' : '输入模型服务密钥';
}

// 窗口级事件委托（第十三棒修复根因之一）：原实现把监听绑在首次执行时尚不存在的输入节点上
// （先绑后渲，绑定了个寂寞）——打字从未落账。委托挂在窗口上，innerHTML 重绘后监听不失效。
function bindSettingsForm() {
    const win = document.getElementById(WINDOW_ID);
    if (!win || win.dataset.sw2SettingsBound) return;
    win.dataset.sw2SettingsBound = '1';
    const onField = (e) => {
        const key = Object.keys(SETTINGS_INPUTS).find((k) => SETTINGS_INPUTS[k] === e.target?.id);
        if (!key) return;
        const v = e.target.value;
        if (key === 'apiKey') {
            if (v && v.trim()) writeSetting('apiKey', v.trim()); // 留空=不动（防清密钥）
            return;
        }
        writeSetting(key, v);
    };
    win.addEventListener('input', onField);
    win.addEventListener('change', onField);
}

// 细案 spec-entity-field-lookup §3：查书用的**世界书原文**（编排层不读文件，由本层按名号取）。
// 取数口径：账上实体名 → 世界书条目（comment 全等 或 key 含该名 或 comment 含该名）。
//   实测（用户世界 235 条 × 账上 623 实体）：comment 全等命中 67、key 含名命中 533、comment 含名 104；
//   同一名号可能命中多条 → 全给模型（宁多勿漏；"取最长的一条"这类取舍留给模型，引擎不替它选）。
// 失败（世界书不可读）→ 返回空数组 = 引擎确认"书里没有该名号的条目" → entity-lookup 记 absent（不再重查）。
async function bookTextForEntity(entity) {
    const ctx = getCtx();
    const character = pickCharacter(ctx);
    try {
        const { entries } = await collectWorldInfoEntries(ctx, character);
        const name = String(entity?.name || '').trim();
        if (!name) return [];
        const hit = (entries || []).filter((e) => {
            const comment = String(e?.comment || '').trim();
            const keys = Array.isArray(e?.key) ? e.key : [e?.key];
            return comment === name || comment.includes(name) || keys.map((k) => String(k ?? '').trim()).includes(name);
        });
        return hit.slice(0, 4).map((e) => ({
            name: String(e?.comment || name).trim(),
            text: String(e?.content || '').slice(0, 1200),   // 单条截断防御（防巨条目灌爆查询 prompt）
        })).filter((x) => x.text);
    } catch (err) {
        console.warn('[story-world-v2] 查书取原文失败（视为书里无该条目）', String(err?.message || err));
        return [];
    }
}

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
        preStep: async ({ ssot: cur, move }) => runEntityLookupStep({
            ssot: cur,
            transport: diagExtract(resolved),
            bookText: bookTextForEntity,
            tick: cur?.meta?.tick ?? 0,
            moveFact: move,
            prevPicks: sw2LastPicks,
        }),
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
            return rot.hot;
        },
        refresh: (hot) => { refreshWorld(hot, { oldVolumes: LISTED_VOLUMES }); },
        onStatus: setStatus,
    });
    es?.on?.(et.MESSAGE_RECEIVED, () => { sw2TickQueue.advance().catch(() => {}); });
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
export async function loadWorld() {
    const meta = readHotMeta();
    const world = meta ? loadHotAccount(meta) : null;
    if (!world) {
        // 首开空态：仍渲染六页签空壳 ——「导入恢复」不依赖世界存在（2026-09-08 冒烟发现：
        // 导入按钮在 renderSettingsHtml 内，无世界=设置页不渲染=首开导入死结；K38 前无创建链）
        refreshWorld(EMPTY_WORLD, { oldVolumes: [] });
        setStatus('尚无世界 · 「✨ 开始新世界」（设定源就绪后可初始化）或「⬆ 导入恢复」');
        return;
    }
    const rot = await ensureChronicleRotated(world);
    if (!rot.ok) {
        // E2：轮转失败如实上报——热账未剥段（编年完整），世界原样渲染，不许报「已同步」
        LISTED_VOLUMES = await listOldVolumes();
        refreshWorld(rot.hot, { oldVolumes: LISTED_VOLUMES });
        setStatus(`⚠ 冷档轮转失败：${rot.error}——世界原样未动（热账未剥段，编年完整保留），可重试`);
        return;
    }
    const hot = rot.hot;
    // leg24 片4（旧账清理）：热账读到之后、渲染之前——一次把旧代码替模型编的四维默认值
    //   （character 全 0.15 / faction 全 0.25，且书里无据者）批掉，界面"有据 4/4"不再骗人。
    //   纯函数 + 幂等（leg25 c 起闸名 meta.attrsRemovedAt；留档仍进 meta.legacyAttrsPurged）。
    const migrated = migrateLegacyAttrs(hot);
    const hotWorld = migrated;   // 迁移返回新对象（不可变风格）——后续一律用迁移后的世界
    // 审计修复 E4：名册入账只改内存（seedBookEntities 就地 push 实体 + 预填权重）→ 账本真变了就落盘。
    // 变没变只认 countLedgerEntries 前后差（幂等：没变不写盘，不产生无谓写盘）。
    const before = countLedgerEntries(hotWorld);
    const seed = seedBookEntities(hotWorld);   // K37 生通道① + 第十九棒 K43：书名录幂等入账（全量棋盘：无席位截断、子势力折叠、权重预填）
    const seededDelta = countLedgerEntries(hotWorld) - before;
    if (seed.seeded > 0 || seededDelta > 0 || migrated !== hot) {   // migrated!==hot = 迁移真改了账（ref 判等，幂等不空写）
        writeHotMeta(hotAccountShape(hotWorld));   // 账本已变：内存与盘上必须一致（导出/「全册 N」读的就是这里）
        const flushed = await flushHotMeta(); // 名册入账/旧账清理不该只活在页面内存——走既有显式落盘路径
        if (!flushed) console.warn('[story-world-v2] 账本写回未落盘', { seeded: seed.seeded, seededDelta });
    }
    LISTED_VOLUMES = await listOldVolumes();
    refreshWorld(hotWorld, { oldVolumes: LISTED_VOLUMES });
}

// ---------- K35：真实动作总线（阅卷/导出/导入；其余按钮随 K36 接调度） ----------
if (typeof window !== 'undefined') {
    window.__sw2Actions = window.__sw2Actions || {};
    const bus = window.__sw2Actions;

    bus['read-volume'] = async (payload) => {
        const volId = payload?.vol;
        if (!volId) return;
        try {
            const volume = await volumeStore().get(volId);
            if (!volume) { setStatus(`⚠ 卷「${volId}」不存在`); return; }
            const rows = volumeToChronicleRows(volume);
            const html = renderVolumeReadHtml(volId, rows);
            const chronicle = document.getElementById('sw2_view_chronicle');
            if (!chronicle) return;
            chronicle.insertAdjacentHTML('afterbegin', html);
            setStatus(`已展开旧卷「${volId}」（${rows.length} 条 · 只读还原）`);
        } catch (err) {
            setStatus(`⚠ 阅卷失败：${err?.message || err}`);
        }
    };

    // K41：编年五筛（多选=并集；清零回全选；重绘后 chips 由 render 按视图态重画）
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
        else setStatus('筛选取愿已记（尚无世界）');
    };

    // K41：因果链视图（展开器产物 afterbegin 进编年视图容器，复用阅卷模式；只读）
    bus['open-chain'] = (payload) => {
        try {
            const id = payload?.chain;
            const world = sw2LastWorld;
            if (!world || !id) { setStatus('⚠ 无世界可展开链路'); return; }
            const chain = expandChain(world, id);
            const html = renderChainViewHtml(chain, { world, volumes: LISTED_VOLUMES });
            const chronicle = document.getElementById('sw2_view_chronicle');
            if (!chronicle) return;
            chronicle.insertAdjacentHTML('afterbegin', html);
            setStatus(chain.ok ? '已展开事件链（一手事实拼句 · 只读 · 可收起）' : '⚠ 无此事件的链路');
        } catch (err) {
            setStatus(`⚠ 链路展开失败：${err?.message || err}`);
        }
    };

    bus['chain-close'] = () => {
        document.getElementById('sw2_chain_view')?.remove();
    };

    bus['export-world'] = async () => {
        const meta = readHotMeta();
        const world = meta ? loadHotAccount(meta) : null;
        if (!world) { setStatus('⚠ 暂无世界可导出'); return; }
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
            setStatus('已导出整聊天备份（含旧卷）');
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
                const flushed = await flushHotMeta();   // leg20 落盘修复：导入完成显式落盘再报成功
                setStatus(`已导入：世界与旧卷恢复完成${flushed ? ' · 已落盘' : ' · ⚠ 落盘失败（见控制台）'}`);
            } catch (err) {
                setStatus(`⚠ 导入失败：${err?.message || err}`);
            }
        });
        input.click();
    };

    // ---------- 初始化接线（编排层） ----------
    // 换源/worldBook 机制已于第十八棒整体废除——设定源只有自动两条路
    //（世界信息/卡内置书 + 角色卡四件套，见 autoComposeSource）；无任何外部文本槽可言。

    // init-world：新世界初始化——设定源自动合订 →
    // 小调用抽取（抽象管线）→ 种子世界（书名录入席 + position 集）。零原生弹窗。
    bus['init-world'] = async () => {
        try {
            const settings = modelSettings() || {};
            const resolved = resolveBrowserTransport(settings, { maxTokens: EXTRACTION_MAX_TOKENS }); // 抽取独立预算（16384 提案，Diagnostic 实证 finish=length@4096）
            if (!resolved) { setStatus('⚠ 先填模型通道（设置页 服务地址/密钥/模型）——设定期望初始化需要它'); return; }
            const src = await autoComposeSource();
            if (!src.ok) { setStatus(`⚠ 当前没有可用设定：${src.reason}——把设定写进 ST 世界信息或角色卡描述，再点一次`); return; }
            setStatus(`正在抽取世界设定（源：${src.label} · ${src.usedChars} 字符${src.truncated ? ' · 超出防御上限截余' : ''}）…`);
            const r = await extractWorldSetting({
                sourceText: src.text,
                extract: diagExtract(resolved), // 第十八棒：空/非JSON 响应现场上控制台
                force: false,
            });
            logInitDiagnostics(getCtx(), src, r); // 第十九棒：悬案实证——取数/抽取实况常驻上控制台
            if (!r.ok) { setStatus(`⚠ 设定抽取失败：${(r.errors || []).join('; ')}${/空|已重试/.test((r.errors || []).join(';')) ? '——可再点一次重试；反复出现请检查模型通道或换小源' : ''}`); return; }
            let seed = {
                version: 1,
                context: { world: src.worldName || '未名世界', tension: 0.5, positions: derivePositions(r.setting), setting: r.setting },
                entities: [], weights: {}, agendas: [], events: [], chronicle: [], milestones: [],
                meta: { tick: 0, simLog: [] },
                // D 组修复（leg25）：位置集 = 书里现成的地名（kind='location' 条目 + 各条目明述的所在）
                // + 兜底词「未明」永远在集内。旧法写死 ['未明'] → 全员同位置、移动不可能。
            };
            seedBookEntities(seed);
            // B 组接线：世界必须真的有一枚玩家棋子（否则五条"禁写玩家"守卫、掩码、影响通道全是死的）。
            // leg25 c：开档描述的**四维解析整段删除**（那个小调用连同 player-setup/player-inject 两个模块一起没了）
            //   ——四维浮点已不存在（没法精确表示；手拍值让"编的"看起来像"算的"）。
            //   玩家棋子现在只有身份与位置（结构性事实），和别的实体同尺；开档描述本身仍留在 meta 里可查。
            const piece = attachPlayerPiece(seed);
            const playerDesc = String(settings.playerDesc || '').trim();
            if (playerDesc) {
                seed.meta = { ...(seed.meta || {}), playerDesc };
            }
            const playerFinal = seed.entities.find((e) => e.id === seed.context?.playerId);
            const had = Boolean(readHotMeta());
            writeHotMeta(hotAccountShape(seed));
            await loadWorld();
            const flushed = await flushHotMeta();   // leg20 落盘修复：初始化完成显式落盘再报成功
            setStatus(`✨ 新世界「${src.worldName || '未名世界'}」已立（${(seed.entities || []).length} 实体入席 · 位置集 ${seed.context.positions.length} 处 · 玩家棋子=${playerFinal?.name || piece.name} · 设定源=${src.label}${src.truncated ? ' · 超出防御上限截余' : ''}${(r.errors || []).length ? ` · 抽取警告 ${r.errors.length} 条` : ''}）${flushed ? ' · 已落盘' : ' · ⚠ 落盘失败（见控制台）'}${had ? '——旧世界已被覆盖（可重新导入备份恢复）' : ''}`);
        } catch (err) {
            setStatus(`⚠ 初始化失败：${err?.message || err}`);
        }
    };

    // ---------- leg21 增量抽象（docs/incremental-refine-spec.md） ----------

    // 清除演化层：dynamic 回基线（张力强度/env/浪尖），设定与极性方向不动；不触发抽取调用
    bus['clear-evolution'] = async () => {
        try {
            const meta = readHotMeta();
            const world = meta ? loadHotAccount(meta) : null;
            if (!world?.context?.setting?.dynamic) { setStatus('⚠ 还没有演化层可清除（先初始化世界）'); return; }
            world.context.setting = resetDynamicLayer(world.context.setting);
            const rot = await ensureChronicleRotated(world);
            LISTED_VOLUMES = await listOldVolumes();
            refreshWorld(rot.hot, { oldVolumes: LISTED_VOLUMES });
            if (!rot.ok) {
                // E2：轮转失败=热账未写（内存里清了演化层但盘上没写）——如实报，不做「已落盘」确认位
                setStatus(`⚠ 冷档轮转失败：${rot.error}——演化层只在内存生效、未落盘（可重试）`);
                return;
            }
            const flushed = await flushHotMeta();
            setStatus(`演化层已清除（张力强度/环境量回基线 · 极性方向保留 · 设定不动）${flushed ? ' · 已落盘' : ' · ⚠ 落盘失败（见控制台）'}`);
        } catch (err) {
            setStatus(`⚠ 清除失败：${err?.message || err}`);
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
        const payload = { source: el.getAttribute('data-source'), vol: el.getAttribute('data-vol'), chain: el.getAttribute('data-chain'), filter: el.getAttribute('data-filter'), entity: el.getAttribute('data-entity') };
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
        bindSettingsForm(); // K36：设置页表单 ↔ extension_settings
        // 不自弹窗（2026-09-08 用户实机反馈「刷新即弹出」）：v1 范式=仅入口点击（魔杖/扩展菜单）。
        // 加载照跑：热账轮转 + 卷清单预取，首次点击打开时已有内容。
        loadWorld(); // K35：面板打开即载入热账（含幂等轮转）
        setupAsyncTicks(ctx); // K36：回合钩子（MESSAGE_RECEIVED 推进 / CHAT_CHANGED 重载）
    });
    ensureWandEntry();
}

// 自举：ST 就绪即挂载；未就绪则等事件（APP_READY 双保险，v1 同款保守策略）
if (typeof window !== 'undefined') {
    const boot = () => {
        const ctx = getCtx();
        if (ctx) initPanel(ctx);
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
        if (!window[NAMESPACE]) window.addEventListener('SillyTavernReady', boot, { once: true });
        if (!window[NAMESPACE]) window.addEventListener('APP_READY', boot, { once: true });
    }
}