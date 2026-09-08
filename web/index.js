// story-world-v2/web/index.js
// K30 骨架 + K34 渲染接线（编排层·浏览器侧）：ST 插件入口——面板挂载 + 六页签渲染刷新。
// 范式实读 v1（manifest/js/settings.html/ui.js）后仿写，命名空间 sw2_ 全隔离：
//   ① settings.html 模板经 ctx.renderExtensionTemplateAsync 注入（缺模板有最小回退窗）；
//   ② 扩展菜单「魔杖」入口挂 extensionsMenu；③ 弹窗 z-index 压顶内联规则（id 特异性）；
//   ④ css 带版本查询防浏览器缓存吞修复；⑤ 全局错误网进状态条。
// K34 渲染接线：refreshWorld(world, {config, oldVolumes}) 把 render.js 纯函数产物填入六页签；
//   面板零第二份状态（A-2 语义）；按钮走 data-action 委托 → window.__sw2Actions（K36 接调度，
//   当前为占位提示）。纪律：模块顶层零 DOM（node --test 可动态导入；browser-compat 扫描覆盖）。
import { renderAll } from '../src/render.js';

const NAMESPACE = 'STORY_WORLD_V2';
const VERSION = '0.1.0';
const WINDOW_ID = 'story_world2_window';
const SECTIONS = ['board', 'chronicle', 'archive', 'entities', 'setting', 'settings'];
const CSS_HREF = new URL('./style.css', import.meta.url).href;
const CSS_VERSION = '20260908-k34';

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
export function refreshWorld(world, { config = {}, oldVolumes = [] } = {}) {
    if (typeof document === 'undefined') return;
    const win = document.getElementById(WINDOW_ID);
    if (!win) return;
    try {
        const out = renderAll(world, { config, oldVolumes });
        const chipWorld = win.querySelector('#sw2_world_chip');
        if (chipWorld) chipWorld.textContent = `世界：${out.header.world || '—'}`;
        const chipTick = win.querySelector('#sw2_tick_chip');
        if (chipTick) chipTick.textContent = out.header.tick;
        for (const name of SECTIONS) {
            const el = win.querySelector(`#sw2_view_${name}`);
            if (el) el.innerHTML = out[name];
        }
        setStatus(`已同步 · 刚刚演完 ${out.header.tick} · 窗口只读，不参与剧情`);
    } catch (err) {
        setStatus(`⚠ 渲染失败：${err?.message || err}`);
        console.warn('[story-world-v2] render failed:', err);
    }
}

// ---------- K34：按钮委托（K36 接真实调度前为占位） ----------
function dispatchAction(action, payload, event) {
    const bus = typeof window !== 'undefined' ? window.__sw2Actions : null;
    if (bus && typeof bus[action] === 'function') {
        bus[action](payload, event);
        return;
    }
    const label = { 'init-world': '开始新世界', 'advance-world': '手动推进', 'force-abstract': '重新抽取设定', 'read-volume': '阅卷', 'source-pick': '换源' }[action] || action;
    setStatus(`「${label}」接线随 K35/K36（当前为占位）`);
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
        const payload = { source: el.getAttribute('data-source'), vol: el.getAttribute('data-vol') };
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
        openWindow();
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