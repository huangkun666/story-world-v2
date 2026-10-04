// story-world-v2/web/abstract-selection.js
// 「抽象来源」**页面**：完整来源清单 + 搜索/来源筛选 + 默认/自选 + 逐条读取方式（自动/全文/多个原文选段）
//   + 最终实际读取内容预览 + 只作用于当前范围的批量操作。
//
// 归属（别混）：本文件只干两件事——
//   ① `renderAbstractSelection(...)`：**纯函数**，进数据出 HTML（Node 里可直接断言）；
//   ② `bindAbstractSelection(win, deps)`：事件委托 + 把用户的选择交回接线层。
//   它**不碰世界书、不跑抽象、不落盘、不算取料**：
//     · 来源清单来自接线层的 `collectAbstractSources`（Task 1）；
//     · 每条的生效正文/状态/最终预览来自接线层的 `composeInitSource`（同一个生产入口，
//       页面**不复制一份 UI 取料算法**）；
//     · 保存一律走 `writeSelection`（接线层写现有插件设置接口）。
//
// ★七条纪律（别改回去）：
//   ① **模块顶层零 DOM**：`node --test` 能直接 import 本文件（本仓硬纪律）⇒ 一切 DOM 取用都在函数体里。
//   ② **一切文本都过 `esc`**：题名/正文/来源名/给玩家的说明都可能带引号与尖括号（ST 书里什么都有）
//      —— 一个没转义就是注入口。属性值也一律引号包裹 + 转义。
//   ③ **搜索与筛选只切可见性，不重建输入**：重建一次就把焦点、输入位置、勾选状态全丢了。
//   ④ **批量只作用于当前可见结果**：藏起来的勾选保持原值；"已不在书里"的存档 ID 每次都原样带过去。
//   ⑤ **看 ≠ 改**：展开详情/查看原文/展开最终预览都不写设置；**第一次真实改动**才转自选，
//      且基线取本次 `composeInitSource(...).defaultSelectedIds`（不是"全勾"，也不是上一次的残留）。
//   ⑥ **加选段不重建 textarea**：用户刚划好的选区、焦点、滚动位置都是他的手 —— 只补选段那一格里画。
//   ⑦ **加载用"在飞的 Promise"去重 + 世代防护**：旧的一轮回来晚了（或接线层判它作废返回 null），
//      一个字都不许覆盖新一轮。世代是**控制器私有的**，不进任何全局变量。
//      ★**归属**（"这一份快照是谁的"）由接线层的**共享来源身份**给出（快照带 `owner`）：写回原样带回它，
//      真实改动前先问 `isSnapshotCurrent(owner)` —— 过期 ⇒ 设置与页面一个字都不改，重装当前状态；
//      记住的自选也按所有者作用域（换所有者即清）。控制器自己**不解释**这份身份（不许另拼一把尺）。
//
// ★控件契约（接线层、样式与判据都按这几个钩子取；旧钩子一个都没改名）：
//   `[data-source-picker]` 容器 · `[data-source-search]` 搜索 · `[data-source-mode]` 档位
//   `[data-source-entry]` 条目复选框（`value` = 稳定 ID）· `[data-source-action="all"|"none"|"invert"|"reload"]`
//   `[data-source-item]` 单条（`hidden` = 被搜索/筛选藏起来）· `[data-source-group]` 来源分组
//   `[data-source-title]` / `[data-source-text]` 搜索用的题名与原文 · `[data-source-status]` 状态那一行
//   ★Task 2 新增：`[data-source-filter]` 来源筛选 · `[data-source-read="auto"|"full"|"segments"]` 读法
//     · `[data-source-original]` 只读原文（划选材料）· `[data-source-segments]` 选段表
//     · `[data-source-preview]` 单条生效预览 · `[data-source-effective-text]` 最终实际读取内容
//     · `[data-source-effective]` 页底展开区（`summary`/`note`/`entries`/`notes`/`text` 五格一起刷新）
//     · `[data-source-notices]` 读取失败/未加载的说明 · `[data-source-action="focus"]` 查看正文
//     · 批量：`exclude-disabled`（文案「取消勾选禁用项」）/`exclude-technical`/`exclude-empty`
//     · 组头：`data-source-action="group-all"|"group-none"|"group-invert"` + `data-source-group-scope`
//     · 选段：`add-segment` / `remove-segment` / `clear-segments` / `use-full`

import { entrySelectionId, normalizeAbstractSelection, DEFAULT_SOURCE } from '../src/abstract-selection.js';
import {
    applyBatchEdit, describeSource, mergeSegments, normalizeNewlines, rawRangeToSegment, readLabel, readModeOf,
    savedSegments, selectionBaseIds,
} from './abstract-source-editor.js';

/** 选择器容器（接线层按它找挂载点）。 */
export const SOURCE_PICKER = '[data-source-picker]';
export const SOURCE_SEARCH = '[data-source-search]';
export const SOURCE_MODE = '[data-source-mode]';
export const SOURCE_FILTER = '[data-source-filter]';
export const SOURCE_ENTRY = '[data-source-entry]';
export const SOURCE_ITEM = '[data-source-item]';
export const SOURCE_GROUP = '[data-source-group]';
export const SOURCE_STATUS = '[data-source-status]';
export const SOURCE_READ = '[data-source-read]';
export const SOURCE_ORIGINAL = '[data-source-original]';
export const SOURCE_SEGMENTS = '[data-source-segments]';
export const SOURCE_SEGMENT = '[data-source-segment]';
export const SOURCE_PREVIEW = '[data-source-preview]';
export const SOURCE_PANE = '[data-source-detail-pane]';
export const SOURCE_EFFECTIVE = '[data-source-effective]';
export const SOURCE_EFFECTIVE_ENTRIES = '[data-source-effective-entries]';
export const SOURCE_EFFECTIVE_NOTE = '[data-source-effective-note]';
export const SOURCE_EFFECTIVE_TEXT = '[data-source-effective-text]';
export const SOURCE_EFFECTIVE_NOTES = '[data-source-effective-notes]';
export const SOURCE_NOTICES = '[data-source-notices]';

const CUSTOM = 'custom';
/** 角色卡四项正文那一组的组名（来源清单里它的来源身份是 `character-fields:<卡>`）。 */
const CARD_GROUP = '角色卡正文';

/** HTML 转义（文本面与属性面共用；属性值另外一律用双引号包住）。 */
function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
const attr = (value) => esc(value);

/** 码点长度（显示读数，不参与任何判定）。 */
function charCount(text) {
    return Array.from(String(text ?? '')).length;
}

/** 这一条来源属于哪一组（世界书按来源名；卡四项自成一格）。 */
function groupOf(source) {
    return source?.kind === 'character-field' ? CARD_GROUP : String(source?.source ?? DEFAULT_SOURCE);
}

/** 组序：world-info 最先、其余按中文排、角色卡正文最后（与旧界面的手感一致）。 */
function groupOrder(a, b) {
    if (a === b) return 0;
    if (a === DEFAULT_SOURCE) return -1;
    if (b === DEFAULT_SOURCE) return 1;
    if (a === CARD_GROUP) return 1;
    if (b === CARD_GROUP) return -1;
    return a.localeCompare(b, 'zh-Hans-CN');
}

/** 一份来源在页面上是否算"勾上"（默认档 = 本次默认生效集；自选档 = 选择记录）。 */
function isInEffect(selection, defaultSelectedIds, id) {
    const picked = normalizeAbstractSelection(selection);
    if (picked.mode === CUSTOM) return picked.selectedIds.includes(id);
    return (Array.isArray(defaultSelectedIds) ? defaultSelectedIds : []).includes(id);
}

function itemMapOf(sourceItems) {
    const map = new Map();
    for (const item of Array.isArray(sourceItems) ? sourceItems : []) if (item?.id) map.set(String(item.id), item);
    return map;
}

// ═══════════════════════════ 渲染（纯函数） ═══════════════════════════

/**
 * 渲染整页（进数据出 HTML，零 DOM）。
 * @param {object} [opts]
 * @param {object[]} [opts.sources] `collectAbstractSources(...)` 的完整清单
 * @param {object[]} [opts.sourceItems] `composeInitSource(...).sourceItems`（生效状态/正文/字数）
 * @param {any} [opts.selection] 当前选择设置
 * @param {string[]} [opts.defaultSelectedIds] 默认档的生效集（`composeInitSource(...).defaultSelectedIds`）
 * @param {boolean} [opts.loading] 正在读取
 * @param {string} [opts.query] 搜索词（重建时回显）
 * @param {string} [opts.filter] 来源筛选（组名；空 = 全部）
 * @param {object[]|null} [opts.worldSources] 取书元数据（`{name,ok,entries}`）——失败书要如实列出来
 * @param {object|null} [opts.preview] `composeInitSource(...)` 的返回（最终预览就用它的 `text`）
 * @param {boolean} [opts.cardPending] 角色卡还没交到（未加载 ≠ 卡里没有）
 * @param {string|null} [opts.focusedId] 右栏正在查看的那一条
 * @returns {string} 完整 HTML（含 `[data-source-picker]` 容器）
 */
export function renderAbstractSelection({
    sources = [], sourceItems = [], selection = { mode: 'default' }, defaultSelectedIds = [],
    loading = false, query = '', filter = '', worldSources = null, preview = null, cardPending = false, focusedId = null,
} = {}) {
    const list = (Array.isArray(sources) ? sources : []).filter((s) => s && typeof s === 'object');
    const picked = normalizeAbstractSelection(selection);
    const items = itemMapOf(sourceItems);
    const groups = new Map();
    for (const source of list) {
        const key = groupOf(source);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(source);
    }
    const names = [...groups.keys()].sort(groupOrder);
    const known = new Set(list.map((s) => String(s.id)));
    const vanished = picked.selectedIds.filter((id) => !known.has(id));
    const focused = list.find((s) => String(s.id) === String(focusedId)) ?? null;

    const blocks = names.map((name) => groupHtml(name, groups.get(name), { picked, items, defaultSelectedIds })).join('');
    const status = statusText({ sources: list, picked, vanished, loading, cardPending });
    const filterOptions = [`<option value="">全部来源</option>`]
        .concat(names.map((name) => `<option value="${attr(name)}"${name === filter ? ' selected' : ''}>${esc(name)}（${groups.get(name).length} 条）</option>`))
        .join('');
    return [
        `<div data-source-picker data-source-mode-state="${picked.mode === CUSTOM ? 'custom' : 'default'}">`,
        `<div data-source-controls>`,
        `<input class="sw2-input" type="search" data-source-search aria-label="搜索来源题名或原文" placeholder="搜索题名或原文" value="${attr(query)}">`,
        `<select class="sw2-input" data-source-filter aria-label="按来源筛选">${filterOptions}</select>`,
        `<select class="sw2-input" data-source-mode aria-label="来源模式">`,
        `<option value="default"${picked.mode === CUSTOM ? '' : ' selected'}>默认来源</option>`,
        `<option value="custom"${picked.mode === CUSTOM ? ' selected' : ''}>自选条目</option>`,
        `</select>`,
        `<button class="sw2-btn" type="button" data-source-action="all">全选结果</button>`,
        `<button class="sw2-btn" type="button" data-source-action="none">取消结果</button>`,
        `<button class="sw2-btn" type="button" data-source-action="invert">反选结果</button>`,
        `<details data-source-batch class="sw2-batch-menu"><summary>批量…</summary>`,
        `<button class="sw2-btn" type="button" data-source-action="exclude-disabled">取消勾选禁用项</button>`,
        `<button class="sw2-btn" type="button" data-source-action="exclude-technical">取消技术条目</button>`,
        `<button class="sw2-btn" type="button" data-source-action="exclude-empty">取消空正文</button>`,
        `</details>`,
        `<button class="sw2-btn" type="button" data-source-action="reload">重读</button>`,
        `</div>`,
        `<p data-source-status>${esc(status)}</p>`,
        noticesHtml({ worldSources, sources: list, cardPending }),
        `<div data-source-columns${focused ? ' data-source-detail-open' : ''}>`,
        `<div data-source-list>${blocks || `<p data-source-empty>没有读到任何来源${loading ? '（读取中…）' : ''}。</p>`}</div>`,
        `<aside data-source-detail-pane aria-label="原文与选段"${focused ? '' : ' hidden'}>${paneHtml(focused, { picked, items })}</aside>`,
        `</div>`,
        effectiveHtml({ preview, items, sources: list, picked }),
        `</div>`,
    ].join('');
}

/** 一组（来源）那一块 ＋ 组头的整组操作。 */
function groupHtml(name, list, { picked, items, defaultSelectedIds }) {
    const rows = list.map((source) => rowHtml(source, { picked, items, defaultSelectedIds })).join('');
    return [
        `<section data-source-group="${attr(name)}" aria-label="来源 ${attr(name)}">`,
        `<h4><span data-source-group-name>${esc(name)}（${list.length} 条）</span>`,
        `<button class="sw2-btn" type="button" data-source-action="group-all" data-source-group-scope="${attr(name)}" aria-label="全选 ${attr(name)} 组">全选本组</button>`,
        `<button class="sw2-btn" type="button" data-source-action="group-none" data-source-group-scope="${attr(name)}" aria-label="取消 ${attr(name)} 组">取消本组</button>`,
        `<button class="sw2-btn" type="button" data-source-action="group-invert" data-source-group-scope="${attr(name)}" aria-label="反选 ${attr(name)} 组">反选本组</button>`,
        `</h4>`,
        rows,
        `</section>`,
    ].join('');
}

/** 一行：勾选 + 题名 + 状态/标记 + 读法 + 查看正文（**一行只放必要信息**）。 */
function rowHtml(source, { picked, items, defaultSelectedIds }) {
    const id = String(source.id);
    const info = describeSource(items.get(id), source);
    const checked = isInEffect(picked, defaultSelectedIds, id);
    const badges = [info.label, ...info.flags.map((f) => `【${f}】`)].join(' ');
    return [
        `<div data-source-item data-source-id="${attr(id)}" data-source-title="${attr(source.title)}"`,
        ` data-source-text="${attr(source.rawText)}" data-source-source="${attr(groupOf(source))}"`,
        ` data-source-state="${attr(info.state)}" data-source-chars="${attr(info.chars)}">`,
        `<input type="checkbox" data-source-entry value="${attr(id)}" aria-label="使用来源 ${attr(source.title)}"${checked ? ' checked' : ''}>`,
        `<span data-source-name>${esc(source.title || id)}</span>`,
        `<span data-source-state-text>${esc(badges)}</span>`,
        `<span data-source-read-label>${esc(readLabel(picked, id))}</span>`,
        `<button class="sw2-btn" type="button" data-source-action="focus" aria-label="查看 ${attr(source.title)} 的原文">查看正文</button>`,
        `</div>`,
    ].join('');
}

/** 右栏：只读原文（划选材料）+ 读法 + 选段表 + 单条生效预览。 */
function paneHtml(source, { picked, items }) {
    if (!source) {
        return `<p data-source-pane-empty>点某一行的「查看正文」在这里查看原始正文、选择读取方式与原文选段。</p>`;
    }
    const id = String(source.id);
    const mode = readModeOf(picked, id);
    const segs = savedSegments(picked, id);
    const info = describeSource(items.get(id), source);
    const radios = [['auto', '自动清理（默认）'], ['full', '原文全文'], ['segments', '原文选段']]
        .map(([value, label]) => `<label><input type="radio" name="sw2read:${attr(id)}" data-source-read="${attr(value)}" value="${attr(value)}"${mode === value ? ' checked' : ''}> ${esc(label)}</label>`)
        .join('');
    return [
        `<div data-source-pane-body data-source-pane-id="${attr(id)}">`,
        `<h4><span data-source-pane-title>${esc(source.title || id)} <span data-source-pane-source>${esc(groupOf(source))}</span></span>`,
        `<button class="sw2-btn" type="button" data-source-action="close-pane" aria-label="关闭正文">关闭正文 ×</button></h4>`,
        `<div data-source-reads role="radiogroup" aria-label="读取方式">${radios}</div>`,
        `<p data-source-read-state>${esc(info.label + (info.reason ? ` · ${info.reason}` : ''))}</p>`,
        `<label data-source-original-label>原文（只读，用来划选；插件不执行其中任何代码）</label>`,
        `<textarea class="sw2-input" data-source-original readonly aria-label="原文（只读）">${esc(normalizeNewlines(source.rawText))}</textarea>`,
        `<div data-source-segment-tools>`,
        `<button class="sw2-btn" type="button" data-source-action="add-segment">把选中文字加为选段</button>`,
        `<button class="sw2-btn" type="button" data-source-action="use-full">改用全文</button>`,
        `<button class="sw2-btn" type="button" data-source-action="clear-segments">清空选段</button>`,
        `<span data-source-segment-count>${segs.length} 段</span>`,
        `</div>`,
        `<ol data-source-segments>${segmentsHtml(segs, source)}</ol>`,
        `<pre data-source-preview>${esc(items.get(id)?.content ?? '')}</pre>`,
        `<p data-source-note>${esc([info.label, ...info.flags].join(' · '))}${info.reason ? ` · ${esc(info.reason)}` : ''}</p>`,
        `</div>`,
    ].join('');
}

function segmentsHtml(segs, source) {
    return (Array.isArray(segs) ? segs : []).map((seg, index) => {
        const text = String(seg?.text ?? '');
        const valid = typeof seg?.start === 'number' && typeof seg?.end === 'number' && String(source?.rawText ?? '').slice(seg.start, seg.end) === text;
        return `<li data-source-segment="${index}"${valid ? '' : ' data-source-segment-invalid'}>`
            + `<code>${esc(text)}</code>`
            + `<span data-source-segment-range>${esc(`${seg?.start}–${seg?.end}`)}</span>`
            + `<button class="sw2-btn" type="button" data-source-action="remove-segment" data-source-segment-index="${index}" aria-label="删除第 ${index + 1} 段">删除</button>`
            + `</li>`;
    }).join('');
}

/** 读取失败 / 未加载 / 真正空书 —— 三件事必须各说各的话。 */
function noticesHtml({ worldSources, sources, cardPending }) {
    const bits = [];
    const failed = (Array.isArray(worldSources) ? worldSources : []).filter((w) => w && w.ok === false);
    if (failed.length) bits.push(`读取失败：${failed.map((w) => w.name).join('、')}（这本书这次没读到，不与"书里没有"混同；点「重读」再试）`);
    const unloaded = (Array.isArray(sources) ? sources : []).filter((s) => s?.loaded === false);
    if (cardPending || unloaded.length) bits.push(`角色卡还没加载完${unloaded.length ? `：${unloaded.map((s) => s.field || s.title).join('、')}` : ''}（未加载 ≠ 卡里没有）`);
    const empty = (Array.isArray(sources) ? sources : []).filter((s) => s?.empty === true);
    if (empty.length) bits.push(`${empty.length} 条来源的正文本来就是空的（列在下面，题名与来源可查）`);
    return `<div data-source-notices>${esc(bits.join('；'))}</div>`;
}

/**
 * ★★页底「实际读取内容」的**一份完整呈现**（初始渲染与增量刷新共用这一份，别处不许再算一套）。
 *
 * 为什么提出来（Task 2 复查 · Important 4）：正文与解释必须说的是**同一次生效结果**。旧法只把
 * `text` 与"排除原因"两格刷进已有 DOM，模式、字数、条数、截取说明、生效清单全停在初始那一次 ——
 * 用户一按"取消结果"，正文空了，解释还在说"默认来源 · 24 字符 · 生效 2 条"。
 * 口径：所有读数**只从生产 `composeInitSource(...)` 的返回里取**（`text`/`effectiveEntries`/
 * `truncated`/`excluded`/`warnings`），页面不另猜、不另算取料；渲染与刷新各写各的 DOM，
 * 但读的是同一份 view。
 * @returns {{summary:string, note:string, rows:{title:string, meta:string}[], reasons:string, text:string}}
 */
function effectiveView({ preview, items, sources, picked } = {}) {
    const map = items instanceof Map ? items : itemMapOf(items);
    const text = String(preview?.text ?? '');
    const effective = Array.isArray(preview?.effectiveEntries) ? preview.effectiveEntries : [];
    const titleOfId = (id) => {
        const source = (Array.isArray(sources) ? sources : []).find((s) => String(s.id) === String(id));
        return source?.title ?? String(id ?? '');
    };
    const note = [
        `最终读取 ${charCount(text)} 字符 · 生效 ${effective.length} 条`,
        preview?.truncated ? '已按现有输入上限截取' : '',
        text && /[{}<]/.test(text) ? '条目里的酒馆宏已按当前角色/玩家名替换' : '',
        '模型任务说明由抽取器另加（这里只是来源正文）',
    ].filter(Boolean).join(' · ');
    const rows = effective.map((entry) => {
        const item = map.get(String(entry?._sw2SelectionId));
        return { title: titleOfId(entry?._sw2SelectionId), meta: item ? `${charCount(item.content)} 字 · ${item.reason || ''}` : '' };
    });
    const reasons = [];
    for (const item of map.values()) {
        if (item?.selected === true && !['effective', 'effective-title'].includes(String(item.status))) {
            reasons.push(`${item.title}：${item.reason || item.status}`);
        }
    }
    for (const record of Array.isArray(preview?.excluded) ? preview.excluded : []) {
        reasons.push(`${record?.title || '原文'}：已清理${record?.reason ? ` ${record.reason}` : ''}（${Number(record?.chars ?? 0)} 字）`);
    }
    for (const warning of Array.isArray(preview?.warnings) ? preview.warnings : []) reasons.push(String(warning));
    const mode = normalizeAbstractSelection(picked).mode === CUSTOM ? '自选来源' : '默认来源';
    return { summary: `实际读取内容（${mode}，与抽取共用同一份计算）`, note, rows, reasons: reasons.join('；'), text };
}

/** 生效清单那几行（初始渲染与增量刷新共用同一段 HTML）。 */
function effectiveRowsHtml(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => `<li data-source-effective-entry><span>${esc(row.title)}</span>`
        + `<span>${esc(row.meta)}</span></li>`).join('');
}

/** 页底「实际读取内容」（展开区里放得下解释；常态页面保持简洁）。 */
function effectiveHtml({ preview, items, sources, picked }) {
    const view = effectiveView({ preview, items, sources, picked });
    return [
        `<details data-source-effective>`,
        `<summary>${esc(view.summary)}</summary>`,
        `<p data-source-effective-note>${esc(view.note)}</p>`,
        `<ol data-source-effective-entries>${effectiveRowsHtml(view.rows)}</ol>`,
        `<p data-source-effective-notes>${esc(view.reasons)}</p>`,
        `<pre data-source-effective-text>${esc(view.text)}</pre>`,
        `</details>`,
    ].join('');
}

function statusText({ sources, picked, vanished, loading, cardPending }) {
    const parts = [`${sources.length} 条来源`, picked.mode === CUSTOM ? `自选 ${picked.selectedIds.length} 条` : '默认来源'];
    if (vanished.length) parts.push(`${vanished.length} 条已不在书中（勾选记录保留，条目回来时照旧生效）`);
    if (cardPending) parts.push('角色卡还没加载完');
    if (loading) parts.push('读取中…');
    return parts.join(' · ');
}

// ═══════════════════════════ 控制器 ═══════════════════════════
// ★状态**全部住在这个闭包里**（每个窗口一份）：没有任何模块级全局可写状态（判据咬这一条）。

const bindings = new WeakMap();

/**
 * 把来源页面绑到一个窗口上（**委托只挂一次**，重复绑同一窗口返回同一份控制器）。
 * @param {Window|Element} win 事件委托的宿主（也是找 `[data-source-picker]` 的根）
 * @param {object} [deps]
 *   `getSnapshot()` 现取一份快照（可异步；接线层在这里收集来源、算迁移、给 `compose`）：
 *     `{ sources, selection, compose(selection), worldSources?, cardPending?, migration?, owner?, scope? }`
 *     —— `null` = 这一轮已作废（切了聊天/来源）：控制器一个字都不改，并把下一次 `sync` 变回"要现取"。
 *     `owner`/`scope` = 这一份快照属于**哪一个来源所有者**（不透明记录，控制器只比较、不解释）：
 *       写回原样带回，并且每次真实改动前都要问 `isSnapshotCurrent(owner)`。
 *   `writeSelection(selection, owner)` 写回（已是归一化形状，带 version:2 与 reads；`owner` 是快照那一份）
 *   `isSnapshotCurrent(owner)` 这一份快照还是不是当前所有者的（缺省 = 不判，老调用方行为一个字不变）
 *   `reloadSources()` 显式重读前的**失效口**（接线层在这里调下游取书缓存的既有失效 API）
 * @returns {{sync:Function, reload:Function}}
 */
export function bindAbstractSelection(win, { getSnapshot, writeSelection, reloadSources, isSnapshotCurrent } = {}) {
    if (bindings.has(win)) return bindings.get(win);
    const doc = win?.ownerDocument || (typeof document !== 'undefined' ? document : null);
    const state = {
        generation: 0, loading: null, loaded: false,
        sources: [], items: new Map(), selection: null, defaultSelectedIds: [],
        worldSources: null, preview: null, cardPending: false, focusedId: null,
        query: '', filter: '', lastCustom: null, owner: null, ownerKey: '',
    };
    let mounted = null;
    const contentsOf = (html) => html.slice(html.indexOf('>') + 1, html.lastIndexOf('</div>'));

    /** 容器：窗口里那一个；没有就自己补一个空壳（接线层不必先手写一份 HTML 常量）。 */
    function container() {
        const existing = win.querySelector?.(SOURCE_PICKER);
        if (existing) return existing;
        const el = doc?.createElement?.('div');
        if (!el) return null;
        el.setAttribute('data-source-picker', '');
        win.appendChild?.(el);
        return el;
    }

    const sourceById = (id) => state.sources.find((s) => String(s.id) === String(id)) ?? null;
    const itemOf = (id) => state.items.get(String(id)) ?? null;
    const vanishedIds = () => {
        const known = new Set(state.sources.map((s) => String(s.id)));
        return normalizeAbstractSelection(state.selection).selectedIds.filter((id) => !known.has(id));
    };
    const rowsOf = (items) => items.map((el) => {
        const id = String(el.getAttribute('data-source-id') ?? '');
        const source = sourceById(id);
        const item = itemOf(id);
        return {
            id,
            disabled: source?.disabled === true,
            technical: source?.technical === true || item?.status === 'technical',
            empty: source?.empty === true,
        };
    });

    /**
     * 现取一份快照并落进 state。
     * ★世代不符或接线层判作废 ⇒ 返回 `false`（一个字都不碰，也**不许**当成"读到了空"）。
     */
    async function readSnapshot() {
        if (typeof getSnapshot !== 'function') return false;
        const gen = state.generation;
        let snapshot = null;
        try {
            snapshot = await getSnapshot();
        } catch (err) {
            if (gen !== state.generation) return false;
            console.warn('[story-world-v2] 抽象来源：读取失败（这次不改设置，条目照旧）', String(err?.message || err));
            return false;
        }
        if (gen !== state.generation || !snapshot) return false;
        state.sources = (Array.isArray(snapshot.sources) ? snapshot.sources : []).filter((s) => s && typeof s === 'object');
        state.worldSources = snapshot.worldSources ?? null;
        state.cardPending = snapshot.cardPending === true;
        state.selection = normalizeAbstractSelection(snapshot.selection ?? { mode: 'default' });
        // ★这一份快照属于**哪一个所有者**：写回要原样带回，真实改动前还拿它问 `isSnapshotCurrent`。
        state.owner = snapshot.owner ?? null;
        const ownerKey = String(snapshot.owner?.key ?? snapshot.ownerKey ?? snapshot.scope ?? '');
        // ★"记住的自选"只在**同一个所有者**里作数：换了所有者（换聊天/换卡/换书源）就清掉，
        //   绝不许把上一个所有者的勾选与读法带进新所有者那一格（复查 Important 3）。
        //   ★同一所有者的重读不清（用户重读一次不该丢掉他刚切走的那份自选）。
        if (ownerKey !== state.ownerKey) {
            state.ownerKey = ownerKey;
            state.lastCustom = null;
        }
        state.composeFn = typeof snapshot.compose === 'function' ? snapshot.compose : null;
        state.focusedId = null;
        const def = await composeFor({ version: 2, mode: 'default', selectedIds: [], reads: {} });
        if (gen !== state.generation) return false;
        state.defaultSelectedIds = Array.isArray(def?.defaultSelectedIds) ? def.defaultSelectedIds.map(String) : [];
        const shown = state.selection.mode === CUSTOM ? await composeFor(state.selection) : def;
        if (gen !== state.generation) return false;
        state.preview = shown ?? def ?? null;
        state.items = itemMapOf(state.preview?.sourceItems);
        return true;
    }

    async function composeFor(selection) {
        if (typeof state.composeFn !== 'function') return null;
        try {
            return await state.composeFn(selection);
        } catch (err) {
            console.warn('[story-world-v2] 抽象来源：生效预览计算失败（页面照旧，不改设置）', String(err?.message || err));
            return null;
        }
    }

    /**
     * 搜索 + 来源筛选：**只切可见性**（不重建任何控件）。
     * 命中的判定与渲染时写进属性的是同一份文本：题名 + 原文 ⇒ 玩家按名字或按内容都搜得到。
     */
    function filter(root) {
        if (!root) return [];
        const box = root.querySelector?.(SOURCE_SEARCH);
        const query = String(box ? box.value : state.query ?? '').trim().toLowerCase();
        const sel = root.querySelector?.(SOURCE_FILTER);
        const filterValue = sel ? String(sel.value ?? '') : String(state.filter ?? '');
        state.query = box ? String(box.value ?? '') : state.query;
        state.filter = filterValue;
        for (const item of root.querySelectorAll(SOURCE_ITEM)) {
            const group = String(item.getAttribute('data-source-source') ?? '');
            const hay = `${item.getAttribute('data-source-title') ?? ''}\n${item.getAttribute('data-source-text') ?? ''}`.toLowerCase();
            const hit = (!query || hay.includes(query)) && (!filterValue || group === filterValue);
            if (hit) item.removeAttribute('hidden');
            else item.setAttribute('hidden', '');
        }
        const kept = [];
        for (const group of root.querySelectorAll(SOURCE_GROUP)) {
            const items = [...group.querySelectorAll(SOURCE_ITEM)];
            const any = items.some((item) => !item.hasAttribute('hidden'));
            if (items.length && !any) group.setAttribute('hidden', '');
            else group.removeAttribute('hidden');
            for (const item of items) if (!item.hasAttribute('hidden')) kept.push(item);
        }
        updateStatus(root);
        return kept;
    }

    function updateStatus(root) {
        const status = root.querySelector?.(SOURCE_STATUS);
        if (!status) return;
        const items = [...root.querySelectorAll(SOURCE_ITEM)];
        const kept = items.filter((i) => !i.hasAttribute('hidden'));
        const boxes = [...root.querySelectorAll(SOURCE_ENTRY)];
        const checked = boxes.filter((b) => b.checked);
        const chars = items.reduce((n, item) => {
            const box = item.querySelector(SOURCE_ENTRY);
            return n + (box?.checked ? Number(item.getAttribute('data-source-chars') ?? 0) || 0 : 0);
        }, 0);
        const picked = normalizeAbstractSelection(state.selection);
        const parts = [kept.length === items.length ? `${items.length} 条` : `${kept.length} / ${items.length} 条`,
            `已选 ${checked.length} 条 · ${chars} 字符`];
        const gone = vanishedIds().length;
        if (gone) parts.push(`${gone} 条已不在书中`);
        if (state.cardPending) parts.push('角色卡还没加载完');
        if (state.loading) parts.push('读取中…');
        status.textContent = parts.join(' · ');
    }

    /** 把当前状态重画进容器（搜索走 `filter`，**不重建**）。 */
    function rebuild() {
        const root = container();
        if (!root) return null;
        const html = renderAbstractSelection({
            sources: state.sources,
            sourceItems: state.preview?.sourceItems ?? [],
            selection: state.selection ?? { mode: 'default' },
            defaultSelectedIds: state.defaultSelectedIds,
            loading: Boolean(state.loading),
            query: state.query,
            filter: state.filter,
            worldSources: state.worldSources,
            preview: state.preview,
            cardPending: state.cardPending,
            focusedId: state.focusedId,
        });
        root.innerHTML = contentsOf(html);
        mounted = root;
        patchAll(root);
        filter(root);
        return root;
    }

    /** 只重画右栏（切"正在查看的那一条"时才整块换；**改动不换**，见纪律⑥）。 */
    function renderPane(root) {
        const pane = root?.querySelector?.(SOURCE_PANE);
        if (!pane) return;
        const source = sourceById(state.focusedId);
        const columns = root.querySelector('[data-source-columns]');
        if (source) {
            pane.removeAttribute('hidden');
            columns?.setAttribute('data-source-detail-open', '');
        } else {
            pane.setAttribute('hidden', '');
            columns?.removeAttribute('data-source-detail-open');
        }
        pane.innerHTML = paneHtml(source, { picked: normalizeAbstractSelection(state.selection), items: state.items });
        patchPane(root);
    }

    /** 把生效状态/勾选/字数/预览刷进已有 DOM（**不重建输入控件**）。 */
    function patchAll(root) {
        if (!root) return;
        const mode = root.querySelector(SOURCE_MODE);
        if (mode) mode.value = normalizeAbstractSelection(state.selection).mode;
        patchList(root);
        patchPane(root);
        patchEffective(root);
        updateStatus(root);
    }

    function patchList(root) {
        for (const el of root.querySelectorAll(SOURCE_ITEM)) {
            const id = String(el.getAttribute('data-source-id') ?? '');
            const source = sourceById(id);
            const info = describeSource(itemOf(id), source);
            const box = el.querySelector(SOURCE_ENTRY);
            if (box) box.checked = isInEffect(state.selection, state.defaultSelectedIds, id);
            const stateEl = el.querySelector('[data-source-state-text]');
            if (stateEl) stateEl.textContent = [info.label, ...info.flags.map((f) => `【${f}】`)].join(' ');
            const readEl = el.querySelector('[data-source-read-label]');
            if (readEl) readEl.textContent = readLabel(state.selection, id);
            el.setAttribute('data-source-state', info.state);
            el.setAttribute('data-source-chars', String(info.chars));
        }
    }

    function patchPane(root) {
        const source = sourceById(state.focusedId);
        const pane = root?.querySelector?.(SOURCE_PANE);
        if (!pane || !source) return;
        const id = String(source.id);
        const picked = normalizeAbstractSelection(state.selection);
        const area = pane.querySelector(SOURCE_ORIGINAL);
        // ★★只在**真的不一样**时才写 `.value`：真浏览器里给 `<textarea>` 赋一次值就会把选区与光标
        //   挪到末尾 —— 用户刚划好的一段会被"顺手清掉"（纪律⑥：加选段不许碰他的手）。
        //   原文来自来源清单，这里几乎永远相同 ⇒ 这一行就是"选区活得下来"的全部原因。
        if (area) {
            const next = normalizeNewlines(source.rawText);
            if (area.value !== next) area.value = next;
        }
        for (const radio of pane.querySelectorAll(SOURCE_READ)) radio.checked = String(radio.value) === readModeOf(picked, id);
        const segs = savedSegments(picked, id);
        const count = pane.querySelector('[data-source-segment-count]');
        if (count) count.textContent = `${segs.length} 段`;
        const ol = pane.querySelector(SOURCE_SEGMENTS);
        if (ol) ol.innerHTML = segmentsHtml(segs, source);
        const preview = pane.querySelector(SOURCE_PREVIEW);
        if (preview) preview.textContent = String(itemOf(id)?.content ?? '');
        const info = describeSource(itemOf(id), source);
        const stateEl = pane.querySelector('[data-source-read-state]');
        if (stateEl) stateEl.textContent = info.label + (info.reason ? ` · ${info.reason}` : '');
        const note = pane.querySelector('[data-source-note]');
        if (note) note.textContent = [info.label, ...info.flags].join(' · ') + (info.reason ? ` · ${info.reason}` : '');
    }

    /**
     * 把**整块解释**刷进已有的展开区（不与 `effectiveHtml` 各算一套）。
     * ★覆盖：摘要（模式）、读数说明（字数/条数/截取/宏）、生效清单、排除原因、正文。
     * ★只动这几格的文本 ⇒ `details` 的展开状态、搜索框、只读原文与选区一个都不碰（用户的手还在）。
     */
    function patchEffective(root) {
        const details = root?.querySelector?.(SOURCE_EFFECTIVE);
        if (!details) return;
        const view = effectiveView({ preview: state.preview, items: state.items, sources: state.sources, picked: state.selection });
        const summary = details.querySelector?.('summary');
        if (summary) summary.textContent = view.summary;
        const note = details.querySelector?.(SOURCE_EFFECTIVE_NOTE);
        if (note) note.textContent = view.note;
        const list = details.querySelector?.(SOURCE_EFFECTIVE_ENTRIES);
        if (list) list.innerHTML = effectiveRowsHtml(view.rows);
        const notes = details.querySelector?.(SOURCE_EFFECTIVE_NOTES);
        if (notes) notes.textContent = view.reasons;
        const text = details.querySelector?.(SOURCE_EFFECTIVE_TEXT);
        if (text) text.textContent = view.text;
    }

    /** 写回一份选择（归一化之后才写；**没变就不写**——避免"打开面板就改一次设置"）。 */
    function persist(picked) {
        if (typeof writeSelection !== 'function') return;
        try {
            // ★带上**这一份快照的所有者**：接线层据此写到正确的那一格，并在所有者过期时拒写。
            const out = writeSelection(picked, state.owner);
            if (out && typeof out.catch === 'function') out.catch((err) => console.warn('[story-world-v2] 抽象来源：保存失败', String(err?.message || err)));
        } catch (err) {
            console.warn('[story-world-v2] 抽象来源：保存失败', String(err?.message || err));
        }
    }

    /**
     * ★真实改动之前的那道闸：**这一份快照还是不是当前所有者的**（接线层说了算）。
     *   不是 ⇒ 不写设置、不动页面状态，**重新装载当前所有者**（设计 §5.2：过期结果一律废弃）；
     *   返回 true 表示这次动作已经作废，调用方必须原样退出（不许"先改了再说成功"）。
     *   接线层没注入这一口（老调用方/离线判据）⇒ 不判，行为一个字不变。
     */
    function discardIfStale() {
        if (state.loading || !state.loaded) return true;  // 未加载不等于空清单，不能作为改选基线
        if (typeof isSnapshotCurrent !== 'function') return false;
        let current = true;
        try {
            current = isSnapshotCurrent(state.owner) !== false;
        } catch (err) {
            current = false;   // ★判不了就按作废（宁可不写，绝不写错一格）
            console.warn('[story-world-v2] 抽象来源：所有者校验失败（按过期处理，重新装载）', String(err?.message || err));
        }
        if (current) return false;
        reload();
        return true;
    }

    /**
     * 一次真实改动：写回（变了才写）⇒ 先按新选择重画勾选 ⇒ 再取一次生产计算刷新状态与最终预览。
     */
    function commit(root, next) {
        if (discardIfStale()) return null;
        const picked = normalizeAbstractSelection(next);
        const before = JSON.stringify(normalizeAbstractSelection(state.selection ?? {}));
        state.selection = picked;
        if (before !== JSON.stringify(picked)) persist(picked);
        const gen = state.generation;
        patchAll(root);
        return (async () => {
            const composed = await composeFor(picked);
            if (gen !== state.generation || !composed) return;
            state.preview = composed;
            state.items = itemMapOf(composed.sourceItems);
            if (picked.mode !== CUSTOM) state.defaultSelectedIds = (composed.defaultSelectedIds ?? []).map(String);
            patchAll(root);
        })();
    }

    /** 当前基线（默认档首次改动 = 默认生效集 + 已消失的存档 ID）。 */
    function baseNext(picked) {
        return selectionBaseIds(picked, state.defaultSelectedIds, vanishedIds());
    }

    /** 批量：**只作用于当前可见结果**（`rows` 就是它们）。 */
    function applyBatch(root, kind, list) {
        const picked = normalizeAbstractSelection(state.selection);
        const next = applyBatchEdit({
            selection: picked,
            defaultSelectedIds: state.defaultSelectedIds,
            vanishedIds: vanishedIds(),
            rows: rowsOf(list),
            kind,
        });
        return commit(root, next);
    }

    function switchMode(root, mode) {
        if (discardIfStale()) return null;                 // ★过期所有者：连"记住的自选"都不许动
        const picked = normalizeAbstractSelection(state.selection);
        if (mode === CUSTOM) {
            // ★"记住的自选"优先（同一所有者内切换档位用）；没有记忆时用**这一格设置里已存的那份**
            //   （旧法直接拿默认基线 ⇒ 重开面板后再切自选，玩家已存的自选会被默认全勾顶掉）；
            //   设置里也没有 ⇒ 才用默认生效集 + 已消失的存档 ID。
            const remembered = state.lastCustom;
            const ids = remembered ? remembered.selectedIds
                : (picked.selectedIds.length ? picked.selectedIds : [...state.defaultSelectedIds, ...vanishedIds()]);
            const reads = remembered ? remembered.reads : picked.reads;
            return commit(root, { version: 2, mode: CUSTOM, selectedIds: ids, reads: { ...(reads || {}) } });
        }
        state.lastCustom = { selectedIds: [...picked.selectedIds], reads: { ...(picked.reads || {}) } };
        return commit(root, { version: 2, mode: 'default', selectedIds: picked.selectedIds, reads: { ...(picked.reads || {}) } });
    }

    function toggleEntry(root, id, checked) {
        const picked = normalizeAbstractSelection(state.selection);
        let ids = picked.mode === CUSTOM ? [...picked.selectedIds] : baseNext(picked);
        if (checked) {
            if (!ids.includes(id)) ids.push(id);
        } else {
            ids = ids.filter((x) => x !== id);
        }
        return commit(root, { version: 2, mode: CUSTOM, selectedIds: ids, reads: { ...(picked.reads || {}) } });
    }

    function setReadMode(root, mode) {
        const source = sourceById(state.focusedId);
        if (!source) return null;
        const id = String(source.id);
        const picked = normalizeAbstractSelection(state.selection);
        const ids = baseNext(picked);
        if (!ids.includes(id)) ids.push(id);
        const reads = { ...(picked.reads || {}) };
        reads[id] = mode === 'segments'
            ? { mode: 'segments', originalText: String(source.rawText ?? ''), segments: savedSegments(picked, id) }
            : { mode };
        return commit(root, { version: 2, mode: CUSTOM, selectedIds: ids, reads });
    }

    function addSegment(root) {
        const source = sourceById(state.focusedId);
        const area = root?.querySelector?.(SOURCE_ORIGINAL);
        if (!source || !area) return null;
        const id = String(source.id);
        const seg = rawRangeToSegment(source.rawText, area.selectionStart, area.selectionEnd);
        if (!seg) return null;                       // 没划到东西 ⇒ 什么都不做（绝不瞎选一段）
        const picked = normalizeAbstractSelection(state.selection);
        const segments = mergeSegments(savedSegments(picked, id), seg);
        const ids = baseNext(picked);
        if (!ids.includes(id)) ids.push(id);
        const reads = { ...(picked.reads || {}) };
        reads[id] = { mode: 'segments', originalText: String(source.rawText ?? ''), segments };
        return commit(root, { version: 2, mode: CUSTOM, selectedIds: ids, reads });
    }

    function removeSegment(root, button) {
        const source = sourceById(state.focusedId);
        if (!source) return null;
        const id = String(source.id);
        const index = Number(button?.getAttribute?.('data-source-segment-index'));
        const picked = normalizeAbstractSelection(state.selection);
        const segments = savedSegments(picked, id).filter((_, i) => i !== index);
        const ids = baseNext(picked);
        if (!ids.includes(id)) ids.push(id);
        const reads = { ...(picked.reads || {}) };
        reads[id] = { mode: 'segments', originalText: String(source.rawText ?? ''), segments };
        return commit(root, { version: 2, mode: CUSTOM, selectedIds: ids, reads });
    }

    function clearSegments(root) {
        const source = sourceById(state.focusedId);
        if (!source) return null;
        const id = String(source.id);
        const picked = normalizeAbstractSelection(state.selection);
        const ids = baseNext(picked);
        if (!ids.includes(id)) ids.push(id);
        const reads = { ...(picked.reads || {}) };
        reads[id] = { mode: 'segments', originalText: String(source.rawText ?? ''), segments: [] };
        return commit(root, { version: 2, mode: CUSTOM, selectedIds: ids, reads });
    }

    /** 现取重填（按钮 `reload`；作者刚改完书时用）。★先走下游失效口。 */
    function reload() {
        state.generation += 1;
        state.loading = null;
        state.loaded = false;
        state.query = '';
        state.filter = '';
        state.sources = [];
        state.items = new Map();
        state.preview = null;
        state.focusedId = null;
        if (typeof reloadSources === 'function') {
            try { reloadSources(); } catch (err) { console.warn('[story-world-v2] 抽象来源：重读前的失效失败', String(err?.message || err)); }
        }
        return load();
    }

    /** 首次懒加载：已经装好了就**一条都不再读**（每次 sync 都去查书 = 面板一开就重取全书）。 */
    function sync() {
        if (state.loaded) {
            if (container() !== mounted) rebuild();
            return state.loading ?? Promise.resolve();
        }
        return load();
    }

    function load() {
        if (state.loading) return state.loading;
        state.loaded = true;
        state.generation += 1;
        const gen = state.generation;
        const promise = readSnapshot().then(
            (applied) => {
                if (gen !== state.generation) return;
                state.loading = null;
                if (!applied) {
                    // ★这一轮作废（所有者换了/压根没取到）：一个字都不落，**把下一次 sync 变回"要现取"**
                    //   —— 同时照旧重画一次，绝不把上一份所有者的内容继续摆在页面上。
                    state.loaded = false;
                    try { rebuild(); } catch (err) { console.warn('[story-world-v2] 抽象来源：渲染失败（不动设置）', String(err?.message || err)); }
                    return;
                }
                try {
                    rebuild();
                } catch (err) {
                    console.warn('[story-world-v2] 抽象来源：渲染失败（不动设置）', String(err?.message || err));
                }
            },
            (err) => {
                if (gen !== state.generation) return;
                state.loading = null;
                state.loaded = false;
                console.warn('[story-world-v2] 抽象来源：读取失败（不动设置）', String(err?.message || err));
            },
        );
        state.loading = promise;
        rebuild();               // 先画"读取中"，别让玩家面对一片空白
        return promise;
    }

    win.addEventListener('click', (e) => {
        const action = e.target?.closest?.('[data-source-action]');
        if (!action) return;
        const kind = String(action.getAttribute('data-source-action') ?? '');
        const root = win.querySelector(SOURCE_PICKER);
        if (!root) return;
        if (kind === 'all' || kind === 'none' || kind === 'invert'
            || kind === 'exclude-disabled' || kind === 'exclude-technical' || kind === 'exclude-empty') {
            applyBatch(root, kind, filter(root));
            return;
        }
        if (kind === 'group-all' || kind === 'group-none' || kind === 'group-invert') {
            const scope = String(action.getAttribute('data-source-group-scope') ?? '');
            const visible = filter(root).filter((el) => String(el.getAttribute('data-source-source') ?? '') === scope);
            applyBatch(root, kind.slice('group-'.length), visible);
            return;
        }
        if (kind === 'reload') { reload(); return; }
        if (kind === 'close-pane') {
            const row = [...root.querySelectorAll(SOURCE_ITEM)].find((item) => item.getAttribute('data-source-id') === state.focusedId);
            state.focusedId = null;
            renderPane(root);
            const target = row && !row.hasAttribute('hidden')
                ? row.querySelector('[data-source-action="focus"]') : root.querySelector(SOURCE_SEARCH);
            target?.focus?.({ preventScroll: true });
            return;
        }
        if (kind === 'focus') {
            const item = action.closest?.(SOURCE_ITEM);
            state.focusedId = String(item?.getAttribute?.('data-source-id') ?? '') || null;   // ★只是"看"：不写设置
            renderPane(root);
            // 窄屏正文在完整清单之后；只滚动查看位置，不移动键盘焦点。
            if (doc?.defaultView?.matchMedia?.('(max-width:620px)').matches) {
                root.querySelector?.('[data-source-detail-pane]')?.scrollIntoView?.({ block: 'start', behavior: 'instant' });
            }
            return;
        }
        if (kind === 'add-segment') { addSegment(root); return; }
        if (kind === 'remove-segment') { removeSegment(root, action); return; }
        if (kind === 'clear-segments') { clearSegments(root); return; }
        if (kind === 'use-full') { setReadMode(root, 'full'); }
    });

    win.addEventListener('input', (e) => {
        if (!e.target?.closest?.(SOURCE_SEARCH)) return;
        const root = win.querySelector(SOURCE_PICKER);
        if (!root) return;
        filter(root);   // 搜索框**不重建**：输入、焦点、勾选全留着
    });

    win.addEventListener('change', (e) => {
        const target = e.target;
        const root = win.querySelector(SOURCE_PICKER);
        if (!root) return;
        const modeSel = target?.closest?.(SOURCE_MODE);
        if (modeSel) { switchMode(root, String(modeSel.value ?? '')); return; }
        const filterSel = target?.closest?.(SOURCE_FILTER);
        if (filterSel) { filter(root); return; }
        const read = target?.closest?.(SOURCE_READ);
        if (read) { setReadMode(root, String(read.value ?? '')); return; }
        const box = target?.closest?.(SOURCE_ENTRY);
        if (!box) return;
        // 勾选一律按 **custom** 记账：勾一条就等于"我不用全部了"——否则勾的动作在 default 档下会被整档忽略
        toggleEntry(root, String(box.value ?? ''), box.checked === true);
    });

    const api = { sync, reload };
    bindings.set(win, api);
    container();   // 先把壳备好（键盘/点击委托已挂上，数据可以后到）
    return api;
}
