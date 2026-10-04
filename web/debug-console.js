// story-world-v2/web/debug-console.js
// ★★★细案 Task 3：设置 →「调试」子页签那一块——**渲染片段 ＋ 委托控制器**。
//
// ＝＝ 这一族只干两件事 ＝＝
//   ① `renderDebugConsole({summary,records,details})`：出一片能整块插进设置页的 HTML
//      （摘要事实 ＋ 模块/级别两个下拉 ＋ 详细数据勾选框 ＋ 刷新/复制/下载/清空四枚按钮 ＋ 日志行）；
//   ② `bindDebugConsole(win,{getSnapshot,getSummary,onDetails})`：在窗口上挂**一次**委托监听，
//      返回 `{sync()}`；`sync()` 只重画 `[data-debug-records]` 与 `[data-debug-summary]` 两格。
//
// ＝＝ 为什么"只重画两格"是硬要求（不是省事）＝＝
//   那两个下拉与勾选框是**玩家的手**（选择、焦点都在上面）。`sync()` 要是把它们重建一遍，
//   玩家刚选的模块会被吞掉、焦点会跳走 —— 与 leg46 续·五「绝不重画面板抢玩家的手」同一条纪律。
//
// ＝＝ 安全口径 ＝＝
//   · 一切进 HTML 的文本都过 `escapeHtml`（消息/模块名/摘要键值/数据载荷的 JSON 全文）；
//   · 摘要与载荷渲染前再过一遍 `redact`（同一把尺，防"调用方直接喂了没记过的对象"）；
//   · ★**详细载荷缺省不画**：`details` 没打开时只印一行「含数据 · 勾选…后展开」，
//     模型请求正文这类东西**默认不出现在 DOM 里**（细案：完整模型文本默认不记录）；
//   · ★不截获 console：本模块一个字都不碰 console（别人的日志更不许动）。
//
// ＝＝ 纪律 ＝＝
//   ① 模块顶层零 DOM（`document`/`win` 一律在函数体里现取）⇒ `node --test` 直接 import 就能跑；
//   ② 零依赖（只用 `src/` 那两个纯模块）＋ 没有 DOM 就静默降级、绝不抛；
//   ③ 依赖一律**注入**（`getSnapshot`/`getSummary`/`onDetails`），本模块不反向 import 接线层。

import { escapeHtml } from '../src/render-base.js';
import { diagnostics, redact } from '../src/diagnostics.js';

/** 面板根节点的标记（接线层只要把片段插进去，`sync()` 靠它找得到自己那一块）。 */
export const DEBUG_CONSOLE_ATTR = 'data-debug-console';
/** 两个下拉与勾选框的 id（细案点名，接线层与判据都从这里取，别各写一份字面量）。 */
export const DEBUG_MODULE_ID = 'sw2_debug_module';
export const DEBUG_LEVEL_ID = 'sw2_debug_level';
export const DEBUG_DETAILS_ID = 'sw2_debug_details';

const LEVEL_ORDER = ['info', 'warn', 'error'];
const LEVEL_LABELS = { info: '信息', warn: '警告', error: '错误' };
/** 摘要里常见事实的中文名（对不上就照原键名印——宁可印英文，也不假装认识）。 */
const SUMMARY_LABELS = {
    build: '当前构建', version: '当前构建', panelBuild: '面板构建',
    tick: '轮次', round: '轮次', turn: '轮次',
    vectorEnabled: '向量开关', embedEnabled: '向量开关', vectorReady: '向量可用',
    coverage: '补齐进度', progress: '补齐进度', pending: '待补齐', filled: '已补齐',
    requestMs: '模型请求耗时', latencyMs: '模型请求耗时', elapsedMs: '耗时',
    httpStatus: 'HTTP 状态', status: '状态', model: '模型',
    recall: '检索统计', inject: '注入统计', storage: '存储', snapshot: '快照',
    lastError: '最近错误', limit: '容量上限', count: '记录条数', modules: '模块',
    details: '详细数据', embedModel: '向量模型', world: '世界', volumes: '旧卷',
    completedThrough: '连续完成至', targetThrough: '待索引至', currentTick: '补齐时轮次', recentFrom: '最近窗口起点',
    embedded: '本批条数', dims: '向量维数', injection: '聊天注入', target: '目标', failed: '失败次数',
};
/** 这些键的布尔值按"开关"印（`关闭`/`开启`），其余的按"是/否"印。 */
const SWITCH_KEYS = new Set(['vectorEnabled', 'embedEnabled', 'enabled', 'ready', 'vectorReady', 'paused', 'details']);
/** 这些键的数字带 `ms` 单位（耗时读数）。 */
const MS_KEYS = new Set(['requestMs', 'latencyMs', 'elapsedMs', 'durationMs', 'costMs', 'ms']);
/** 一格事实/载荷最长印多少字（再长就截断留 `…`——面板不是日志转储）。 */
const FACT_MAX = 300;
const PAYLOAD_MAX = 2000;

const clamp = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** 事实那一格（标签与值都转义）。 */
const factHtml = (label, value) => `<span class="sw2-debug-fact"><b class="sw2-debug-fact-label">${escapeHtml(label)}</b><span class="sw2-debug-fact-value">${escapeHtml(value)}</span></span>`;

/** 对象 → 一行 JSON（先过 `redact`：同一把脱敏尺；循环/怪值都接得住）。 */
function jsonText(value) {
    try {
        const text = JSON.stringify(redact(value));
        return text === undefined ? '—' : clamp(text, FACT_MAX);
    } catch (_) {
        return '[无法显示]';
    }
}

/** 一格摘要值按人话印：布尔 → 开/关（或 是/否）、耗时 → 带 ms、数组 → 顿号连、空 → `—`。 */
function fmtValue(key, value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') {
        return SWITCH_KEYS.has(key) ? (value ? '开启' : '关闭') : (value ? '是' : '否');
    }
    if (typeof value === 'number') {
        return MS_KEYS.has(key) && Number.isFinite(value) ? `${value} ms` : String(value);
    }
    if (Array.isArray(value)) {
        if (!value.length) return '—';
        const simple = value.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x));
        return simple
            ? value.map((x) => (typeof x === 'boolean' ? (x ? '是' : '否') : String(x ?? '—'))).join('、')
            : jsonText(value);
    }
    if (typeof value === 'object') {
        const text = jsonText(value);
        return text === '{}' || text === '[]' ? '—' : text;
    }
    return String(value);
}

/** 摘要那一段（`sync()` 重画的就是这一格）。★"本次显示几条"永远在，空摘要也读得懂。 */
function summaryHtml(summary, records) {
    const safe = summary && typeof summary === 'object' && !Array.isArray(summary) ? redact(summary) : {};
    const facts = [];
    for (const [key, value] of Object.entries(safe)) {
        if (key === 'modules') continue;   // 只用来喂下拉，不占一行事实
        facts.push(factHtml(SUMMARY_LABELS[key] || key, fmtValue(key, value)));
    }
    facts.push(factHtml('本次显示', `${Array.isArray(records) ? records.length : 0} 条`));
    return `<div class="sw2-debug-facts">${facts.join('')}</div>`;
}

/** 时刻：行里印 `HH:MM:SS`（title 里给完整 ISO，鼠标停一下能看到日期）。 */
function timeText(time) {
    if (typeof time !== 'number' || !Number.isFinite(time)) return '—';
    try { return new Date(time).toTimeString().slice(0, 8); } catch (_) { return '—'; }
}
function isoText(time) {
    try { return new Date(time).toISOString(); } catch (_) { return ''; }
}

/** 这条记录有没有值得展开的载荷（空对象/空数组算"没有"——不许长出一格空的展开）。 */
function hasPayload(data) {
    if (data === null || data === undefined) return false;
    if (Array.isArray(data)) return data.length > 0;
    if (typeof data === 'object') return Object.keys(data).length > 0;
    return true;
}

/** 载荷 → 缩进 JSON（先 `redact`，再整段转义）。 */
function payloadText(data) {
    try {
        const text = JSON.stringify(redact(data), null, 2);
        return clamp(String(text ?? ''), PAYLOAD_MAX);
    } catch (_) {
        return '[无法显示]';
    }
}

/** 一行日志。★`details` 没打开 ⇒ 只印"含数据"那行提示，载荷一个字都不进 DOM。 */
function recordHtml(entry, details) {
    const row = entry && typeof entry === 'object' ? entry : {};
    const level = String(row.level ?? 'info');
    const levelClass = LEVEL_LABELS[level] ? level : 'info';
    const parts = [
        `<div class="sw2-debug-entry sw2-debug-level-${levelClass}" data-debug-level="${escapeHtml(levelClass)}">`,
        `<span class="sw2-debug-time" title="${escapeHtml(isoText(row.time))}">${escapeHtml(timeText(row.time))}</span>`,
        `<span class="sw2-debug-badge sw2-debug-badge-${levelClass}">${escapeHtml(LEVEL_LABELS[level] || level)}</span>`,
        `<span class="sw2-debug-source">${escapeHtml(String(row.module ?? ''))}</span>`,
        `<span class="sw2-debug-message">${escapeHtml(String(row.message ?? ''))}</span>`,
    ];
    if (hasPayload(row.data)) {
        parts.push(details
            ? `<details class="sw2-debug-details"><summary>详情</summary><pre class="sw2-debug-data">${escapeHtml(payloadText(row.data))}</pre></details>`
            : '<span class="sw2-debug-hint">含数据</span>');
    }
    parts.push('</div>');
    return parts.join('');
}

/** 日志那一段（`sync()` 重画的就是这一格）。 */
function recordsHtml(records, details) {
    const list = Array.isArray(records) ? records : [];
    if (!list.length) return '<div class="sw2-debug-empty">暂无日志</div>';
    return list.map((entry) => recordHtml(entry, details)).join('');
}

/** 模块下拉的选项：记录里出现过的模块 ＋（可选）调用方在摘要里给的 `modules` 全量清单。 */
function moduleNames(records, summary) {
    const names = [];
    const push = (value) => {
        const text = String(value ?? '').trim();
        if (text && !names.includes(text)) names.push(text);
    };
    if (summary && typeof summary === 'object' && Array.isArray(summary.modules)) summary.modules.forEach(push);
    if (Array.isArray(records)) records.forEach((entry) => push(entry?.module));
    return names;
}

/**
 * 出一片调试面板 HTML（可整块插进设置页；插完由接线层调 `bindDebugConsole(win,…).sync()`）。
 * @param {{summary?:object, records?:Array, details?:boolean}} [options]
 * @returns {string} HTML 片段（一切文本已转义）
 */
export function renderDebugConsole({ summary = {}, records = [], details = false } = {}) {
    const list = Array.isArray(records) ? records : [];
    const moduleOpts = ['<option value="">全部模块</option>']
        .concat(moduleNames(list, summary).map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`))
        .join('');
    const levelOpts = ['<option value="">全部级别</option>']
        .concat(LEVEL_ORDER.map((level) => `<option value="${level}">${LEVEL_LABELS[level]}</option>`))
        .join('');
    return `<div class="sw2-debug-console" ${DEBUG_CONSOLE_ATTR}="1">
  <div class="sw2-debug-summary" data-debug-summary>${summaryHtml(summary, list)}</div>
  <div class="sw2-debug-bar">
    <label class="sw2-debug-field">模块<select id="${DEBUG_MODULE_ID}" data-debug-filter="module">${moduleOpts}</select></label>
    <label class="sw2-debug-field">级别<select id="${DEBUG_LEVEL_ID}" data-debug-filter="level">${levelOpts}</select></label>
    <label class="sw2-debug-field sw2-debug-check"><input type="checkbox" id="${DEBUG_DETAILS_ID}" data-debug-filter="details"${details ? ' checked' : ''}>详细数据</label>
    <button type="button" class="sw2-btn sw2-debug-btn" data-debug-action="refresh">刷新</button>
    <button type="button" class="sw2-btn sw2-debug-btn" data-debug-action="copy">复制报告</button>
    <button type="button" class="sw2-btn sw2-debug-btn" data-debug-action="download">下载报告</button>
    <button type="button" class="sw2-btn sw2-debug-btn" data-debug-action="clear">清空日志</button>
    <span class="sw2-debug-result" data-debug-result role="status"></span>
  </div>
  <div class="sw2-debug-log" data-debug-records>${recordsHtml(list, details)}</div>
</div>`;
}

/** 同一个窗口只绑一次（与 `web/setting-reader.js` 同一把尺；重复调用只更新依赖）。 */
const bindings = new WeakMap();

/** 报告文件名里的时刻（`:` 在文件名里不合法，换成 `-`）。 */
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/**
 * 把面板接上（委托监听挂一次；返回 `{sync(),dispose(),setOptions()}`）。
 *
 * @param {Window|object} win 挂监听的窗口（真浏览器就是 `window`）
 * @param {object} [options]
 * @param {(filters:{module:string,level:string})=>Array} [options.getSnapshot] 取记录（接线层给 `diagnostics.snapshot`）
 * @param {()=>object} [options.getSummary] 取摘要事实（构建/轮次/开关/进度…）
 * @param {(details:boolean)=>void} [options.onDetails] 详情开关落根设置（由接线层实现）
 * @returns {{sync:Function, dispose:Function, setOptions:Function}|null} 没有窗口 ⇒ null（Node 里也安全）
 */
export function bindDebugConsole(win, options = {}) {
    if (!win || typeof win.addEventListener !== 'function') return null;
    const bound = bindings.get(win);
    if (bound) {
        bound.setOptions(options);   // ★监听不重挂，依赖以最新那次为准（免得旧闭包把新依赖顶掉）
        return bound;
    }

    let deps = { getSnapshot: null, getSummary: null, onDetails: null, ...(options && typeof options === 'object' ? options : {}) };
    const state = { count: 0 };

    const rootOf = () => win.querySelector?.(`[${DEBUG_CONSOLE_ATTR}]`) || win.querySelector?.('.sw2-debug-console') || null;

    /** 结果那行字（复制/下载/清空的结果都写这里——细案的"结果内联"）。 */
    function setResult(text) {
        try {
            const el = rootOf()?.querySelector?.('[data-debug-result]');
            if (el) el.textContent = String(text);
        } catch (_) { /* 结果那行字不许影响主流程 */ }
    }

    function readSummary() {
        try {
            const got = deps.getSummary?.();
            return got && typeof got === 'object' ? got : {};
        } catch (_) { return {}; }
    }

    /** 报告全文（复制与下载**同一个来源**：`diagnostics.report(摘要)`——两处一个字节都不许差）。 */
    function reportText() {
        try {
            return diagnostics.report(readSummary());
        } catch (_) {
            return JSON.stringify({ title: 'Story World v2 调试报告', count: 0, summary: {}, records: [] });
        }
    }

    /** 按当下筛选取账并重画**两格**。面板还没渲染 ⇒ 返回 false（如实，不假装做了事）。 */
    function sync() {
        const root = rootOf();
        if (!root || typeof root.querySelector !== 'function') return false;
        const moduleSel = root.querySelector(`#${DEBUG_MODULE_ID}`);
        const levelSel = root.querySelector(`#${DEBUG_LEVEL_ID}`);
        const detailsBox = root.querySelector(`#${DEBUG_DETAILS_ID}`);
        const filters = {
            module: moduleSel && moduleSel.value ? String(moduleSel.value) : '',
            level: levelSel && levelSel.value ? String(levelSel.value) : '',
        };
        const details = !!(detailsBox && detailsBox.checked);
        let records = [];
        try {
            const got = deps.getSnapshot?.(filters);
            records = Array.isArray(got) ? got : [];
        } catch (_) { records = []; }             // 取账出错 ⇒ 空态，绝不把面板带崩
        state.count = records.length;
        // ★只动这两格：下拉、勾选框与焦点全是玩家的手，sync 一个字都不许碰（更不许抢焦点）。
        const recordsBox = root.querySelector('[data-debug-records]');
        if (recordsBox) recordsBox.innerHTML = recordsHtml(records, details);
        const summaryBox = root.querySelector('[data-debug-summary]');
        if (summaryBox) summaryBox.innerHTML = summaryHtml(readSummary(), records);
        return true;
    }

    function refresh() {
        sync();
        setResult(`已刷新（${state.count} 条）`);
    }

    /** 清空：★走单例 `diagnostics.clear()`（细案点名），然后当场重画空态。 */
    function clearLog() {
        try { diagnostics.clear(); } catch (_) { /* 清不动也要把面板刷成空态 */ }
        state.count = 0;
        sync();
        setResult('日志已清空');
    }

    /** 复制：剪贴板可用就复制；不可用/被拒 ⇒ 结果那行字如实说明并指向"下载报告"。 */
    async function copyReport() {
        const text = reportText();
        try {
            const clip = (win.ownerDocument?.defaultView || win).navigator?.clipboard;
            if (clip && typeof clip.writeText === 'function') {
                await clip.writeText(text);
                setResult(`报告已复制（${state.count} 条）`);
                return true;
            }
        } catch (_) { /* 落到下面那行内联结果 */ }
        setResult('复制失败：这个环境没开放剪贴板，请改用「下载报告」');
        return false;
    }

    /** 下载：Blob URL 造一条链，**用完立刻 revoke**（不许把 URL 一直挂着）。 */
    function downloadReport() {
        const text = reportText();
        try {
            const host = win.ownerDocument?.defaultView || win;
            const BlobCtor = host.Blob;
            const url = host.URL;
            const doc = win.ownerDocument || host.document;
            if (!BlobCtor || !url || typeof url.createObjectURL !== 'function' || !doc || typeof doc.createElement !== 'function') {
                throw new Error('这个环境没有 Blob/URL/document');
            }
            const href = url.createObjectURL(new BlobCtor([text], { type: 'application/json' }));
            const anchor = doc.createElement('a');
            anchor.href = href;
            anchor.download = `story-world-v2-debug-${stamp()}.json`;
            try { doc.body?.appendChild?.(anchor); } catch (_) { /* 有的环境不需要挂进去也能点 */ }
            anchor.click?.();
            try { anchor.remove?.(); } catch (_) { /* 摘不掉也不影响已触发的下载 */ }
            setTimeout(() => { try { url.revokeObjectURL(href); } catch (_) {} }, 1000);
            setResult(`报告已下载（${state.count} 条）`);
            return true;
        } catch (_) {
            setResult('当前环境不支持下载，请改用「复制报告」');
            return false;
        }
    }

    /** 委托①：四枚按钮（只认带 `data-debug-action` 的那一枚）。 */
    function onClick(event) {
        const target = event?.target;
        if (!target) return undefined;
        const root = rootOf();
        if (!root) return undefined;
        if (typeof root.contains === 'function' && !root.contains(target)) return undefined;
        const action = target.closest?.('[data-debug-action]')?.getAttribute?.('data-debug-action') || '';
        if (action === 'refresh') { refresh(); return undefined; }
        if (action === 'clear') { clearLog(); return undefined; }
        if (action === 'copy') return copyReport();      // ★把 promise 交回去（调用方要能 await 结果）
        if (action === 'download') return downloadReport();
        return undefined;
    }

    /** 委托②：两个下拉与详情勾选框。★都只触发 sync，绝不重建控件自己。 */
    function onChange(event) {
        const target = event?.target;
        if (!target) return undefined;
        const root = rootOf();
        if (!root) return undefined;
        if (typeof root.contains === 'function' && !root.contains(target)) return undefined;
        const id = String(target.id || '');
        if (id === DEBUG_DETAILS_ID) {
            try { deps.onDetails?.(!!target.checked); } catch (_) { /* 落设置失败不该把面板卡住 */ }
            sync();
            return undefined;
        }
        if (id === DEBUG_MODULE_ID || id === DEBUG_LEVEL_ID) sync();
        return undefined;
    }

    win.addEventListener('click', onClick);
    win.addEventListener('change', onChange);

    const api = {
        sync,
        /** 摘监听（面板被拆掉时调用；重挂会重新走一遍绑定）。 */
        dispose() {
            win.removeEventListener?.('click', onClick);
            win.removeEventListener?.('change', onChange);
            bindings.delete(win);
        },
        /** 重复绑定时只换依赖（监听仍是那一对）。 */
        setOptions(next) {
            if (next && typeof next === 'object') deps = { ...deps, ...next };
        },
    };
    bindings.set(win, api);
    sync();   // 面板已经在页上就先画一遍；还没渲染 ⇒ sync 自己会返回 false
    return api;
}
