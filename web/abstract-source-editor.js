// story-world-v2/web/abstract-source-editor.js
// 「抽象来源」正文编辑的**纯逻辑**：原文 ↔ 只读 textarea 的坐标映射 · 原文选段 · 批量选择计算 · 状态中文。
//
// 为什么单独成模块（与主选择器分开）：
//   ① **坐标是安全边界**：`<textarea>` 的 `selectionStart/End` 数的是**换行归一之后**的 UTF-16 位置
//      （HTML 口径：CRLF ⇒ LF），而 Task 1 的选段核对是按**原始正文**的 UTF-16 位置切片的
//      （`rawText.slice(start,end) === text`）。映射错一格 = 用户保存的选段与他看见的文字差一个字，
//      而且**静默**（核对只比对原文 slice，绝不报错）。
//   ② **批量只作用于当前筛选范围**：这是产品口径（隐藏的选择保持原值、已消失的存档 ID 原样带着）。
//      这一段算错一次就是"玩家看不见的副作用"——必须是纯函数，才咬得住。
//
// ★纪律（照本仓 web 侧的老几条）：
//   · 模块顶层**零 DOM**（`node --test` 能直接 import 本文件）；
//   · 零依赖（只 import `src/` 的纯函数）；不认识 window / document / 设置存哪儿；
//   · 不 trim 用户选中的文字（Task 1 契约：全文与选段都**保留首尾空白**）；
//   · 不执行任何来源文本（它只是字符串）。

import { normalizeAbstractSelection } from '../src/abstract-selection.js';

/** 三种读取方式（与 Task 1 的 `resolveAbstractSources` 同一套取值）。 */
export const READ_MODES = ['auto', 'full', 'segments'];

/** 读法的中文（状态面与读法标签共用一个出处）。 */
export const READ_LABELS = { auto: '自动清理', full: '原文全文', segments: '原文选段' };

/** `reads[id]` 的读法（缺省 = 自动清理）。 */
export function readModeOf(selection, id) {
    const picked = normalizeAbstractSelection(selection);
    return picked.reads?.[id]?.mode ?? 'auto';
}

/** 读法标签（选段带段数：`原文选段（2 段）`）。 */
export function readLabel(selection, id) {
    const mode = readModeOf(selection, id);
    if (mode !== 'segments') return READ_LABELS[mode] ?? READ_LABELS.auto;
    return `${READ_LABELS.segments}（${savedSegments(selection, id).length} 段）`;
}

/**
 * 换行归一：CRLF 与孤立 CR 都归成 LF（这就是 `<textarea>` 的 `value` 在浏览器里的形状）。
 * ★只用于**显示与划选**；保存的坐标一律回到原始正文（见 `displayOffsetToRawOffset`）。
 */
export function normalizeNewlines(text) {
    return String(text ?? '').replace(/\r\n?/g, '\n');
}

/**
 * 把"归一后文本里的偏移"换成"原始正文里的 UTF-16 偏移"。
 * ★CRLF 是 2→1 的折叠，所以后半段的显示偏移要整体右移；surrogate（emoji）两边都数两个码元，
 *   因此**不能**用码点下标实现（那会正好差一格）。
 * @param {string} rawText 原始正文
 * @param {number} offset 归一后文本里的 UTF-16 偏移（textarea.selectionStart/End）
 * @returns {number} 原始正文里的 UTF-16 偏移（越界夹到末尾）
 */
export function displayOffsetToRawOffset(rawText, offset) {
    const raw = String(rawText ?? '');
    const target = Math.max(0, Math.floor(Number(offset) || 0));
    let display = 0;
    for (let i = 0; i < raw.length; i += 1) {
        if (display >= target) return i;
        if (raw[i] === '\r' && raw[i + 1] === '\n') { display += 1; i += 1; continue; }
        display += 1;
    }
    return raw.length;
}

/**
 * 一段划选 ⇒ 一条选段记录（原始坐标 + 与原文逐字相等的 text）。
 * ★text 必须是 `rawText.slice(start,end)` 本身：Task 1 的核对就是拿它比的。
 * @returns {{start:number,end:number,text:string}|null} 空区间 ⇒ null（"各段非空"）
 */
export function rawRangeToSegment(rawText, startOffset, endOffset) {
    const raw = String(rawText ?? '');
    const a = displayOffsetToRawOffset(raw, startOffset);
    const b = displayOffsetToRawOffset(raw, endOffset);
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    if (end <= start) return null;
    return { start, end, text: raw.slice(start, end) };
}

/**
 * 一批划选 ⇒ 规范化选段表：**按原文位置排序**、去重、丢空区间。
 * （解析函数不会替用户排序，所以顺序在这里定；保存的仍是原文坐标与原文 text。）
 * ★入参 `ranges` 是**显示坐标**（textarea 的 selectionStart/End）。
 */
export function collectSegments(rawText, ranges = []) {
    const raw = String(rawText ?? '');
    const out = [];
    const seen = new Set();
    for (const range of Array.isArray(ranges) ? ranges : []) {
        const seg = rawRangeToSegment(raw, range?.start, range?.end);
        if (!seg) continue;
        const key = `${seg.start}:${seg.end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(seg);
    }
    return out.sort((x, y) => x.start - y.start || x.end - y.end);
}

/**
 * 已保存的选段（**原始坐标**）＋ 新加的一段 ⇒ 规范化选段表。
 *
 * ★★为什么不能复用 `collectSegments`（这条是**判据当场咬出来的**真 bug）：
 *   已保存的 `start/end` 已经是原文坐标，若再喂进"显示坐标"那一套映射，CRLF 之后每一段都会被
 *   二次右移一格（实测：`丙尾` 变成 `尾`）——而 `text` 与坐标仍自洽，只在核对时整条失效。
 *   ⇒ 两个坐标系两个口，绝不混用。
 *   ★text 一律**照抄**（不按新原文重算）：原文变了就让整条判失效，绝不自动挪位/改写。
 */
export function mergeSegments(existing = [], incoming = null) {
    const out = [];
    const seen = new Set();
    for (const seg of [...(Array.isArray(existing) ? existing : []), ...(incoming ? [incoming] : [])]) {
        const start = Number(seg?.start);
        const end = Number(seg?.end);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) continue;
        const key = `${start}:${end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ start, end, text: String(seg?.text ?? '') });
    }
    return out.sort((x, y) => x.start - y.start || x.end - y.end);
}

/** 选择记录里这一条已保存的选段（没有就空表；不猜、不挪位）。 */
export function savedSegments(selection, id) {
    const read = normalizeAbstractSelection(selection).reads?.[id];
    if (!read || read.mode !== 'segments' || !Array.isArray(read.segments)) return [];
    return read.segments.map((s) => ({ start: s?.start, end: s?.end, text: s?.text }));
}

/** 多段拼成实际读取文本（解析侧就是这么连的：以换行分隔）。 */
export function segmentsText(segments = []) {
    return (Array.isArray(segments) ? segments : []).map((s) => String(s?.text ?? '')).join('\n');
}

/**
 * 改档时的**基线**：自选档 = 已存的选择；默认档 = 默认生效集 + 已消失的存档 ID。
 * ★为什么默认档要带消失的 ID：它们没有可见的行，任何"只作用于当前范围"的动作都不该碰它们。
 */
export function selectionBaseIds(selection, defaultSelectedIds = [], vanishedIds = []) {
    const picked = normalizeAbstractSelection(selection);
    const out = [];
    const seen = new Set();
    const add = (value) => {
        const id = String(value ?? '').trim();
        if (!id || seen.has(id)) return;
        seen.add(id);
        out.push(id);
    };
    if (picked.mode === 'custom') for (const id of picked.selectedIds) add(id);
    else {
        for (const id of Array.isArray(defaultSelectedIds) ? defaultSelectedIds : []) add(id);
        for (const id of Array.isArray(vanishedIds) ? vanishedIds : []) add(id);
    }
    return out;
}

/**
 * 批量动作 ⇒ 下一份选择设置（**只动 `rows` 交进来的那些行**）。
 *
 * @param {object} opts
 * @param {any} opts.selection 当前选择（未归一化也吃得下）
 * @param {string[]} [opts.defaultSelectedIds] 默认档的生效集（首次改动时作基线）
 * @param {string[]} [opts.vanishedIds] 已不在书里的存档 ID（原样带着）
 * @param {{id:string,disabled?:boolean,technical?:boolean,empty?:boolean}[]} [opts.rows]
 *   ★**当前筛选范围内的行**（隐藏的行不在里面 = 一个字都不动）
 * @param {'all'|'none'|'invert'|'exclude-disabled'|'exclude-technical'|'exclude-empty'} [opts.kind]
 * @returns {{version:2,mode:'custom',selectedIds:string[],reads:object}} 新设置（不改入参）
 */
export function applyBatchEdit({ selection = null, defaultSelectedIds = [], vanishedIds = [], rows = [], kind = 'all' } = {}) {
    const picked = normalizeAbstractSelection(selection);
    const base = selectionBaseIds(selection, defaultSelectedIds, vanishedIds);
    const list = Array.isArray(rows) ? rows : [];
    const inBase = new Set(base);
    const remove = new Set();
    const append = [];
    const add = (id) => {
        if (!id || inBase.has(id)) return;
        inBase.add(id);
        append.push(id);
    };
    if (kind === 'all') {
        for (const row of list) add(String(row?.id ?? ''));
    } else if (kind === 'none') {
        for (const row of list) remove.add(String(row?.id ?? ''));
    } else if (kind === 'invert') {
        for (const row of list) {
            const id = String(row?.id ?? '');
            if (!id) continue;
            if (inBase.has(id)) remove.add(id); else add(id);
        }
    } else if (kind === 'exclude-disabled' || kind === 'exclude-technical' || kind === 'exclude-empty') {
        const flag = kind === 'exclude-disabled' ? 'disabled' : kind === 'exclude-technical' ? 'technical' : 'empty';
        for (const row of list) if (row?.[flag] === true) remove.add(String(row?.id ?? ''));
    }
    const selectedIds = [...base, ...append].filter((id) => id && !remove.has(id));
    return {
        version: 2,
        mode: 'custom',
        selectedIds,
        reads: { ...(picked.reads || {}) },
    };
}

/**
 * 一条来源在页面上的**状态说明**（中文 + 标记 + 是否生效）。
 * ★三种"没有正文"必须分形：真正空正文 / 自动清理后只剩技术内容 / 卡还没加载完。
 * @param {object|null} item `composeInitSource(...).sourceItems` 里的一项（producer 的读法/状态）
 * @param {object|null} source 原始来源项（禁用/技术/空/未加载这些**固有**标记）
 */
export function describeSource(item, source = null) {
    const flags = [];
    if (source?.disabled === true) flags.push('禁用');
    if (source?.technical === true) flags.push('技术条目');
    if (source?.empty === true) flags.push('空正文');
    if (source?.loaded === false) flags.push('未加载');
    if (item?.readMode === 'segments') flags.push('选段');
    if (item?.truncated === true) flags.push('已截取');
    const state = String(item?.status ?? (source?.loaded === false ? 'unloaded' : source?.empty ? 'empty' : 'empty'));
    const chars = Number(item?.effectiveChars ?? 0) || 0;
    const reason = String(item?.reason ?? '').trim();
    const labels = {
        effective: `已生效 ${chars} 字`,
        'effective-title': '仅题名生效',
        excluded: '未使用',
        empty: '正文为空',
        technical: '自动清理后没有世界正文',
        unloaded: '角色卡还没加载完',
        'stale-segments': '原文选段需要重新选择',
        'budget-excluded': '总输入上限排除',
    };
    const defaults = {
        excluded: source?.disabled ? '默认排除禁用条目' : '未勾选',
        empty: '正文为空',
        technical: '自动清理后没有世界正文',
        unloaded: '角色卡还没加载完（未加载 ≠ 卡里没有）',
        'stale-segments': '选段与本次原文对不上，需要重新选择（不会自动挪位或回退全文）',
        'budget-excluded': '总输入上限排除（没有送进模型）',
    };
    return {
        state,
        flags,
        chars,
        effective: state === 'effective' || state === 'effective-title',
        label: labels[state] ?? '未读取',
        reason: reason || defaults[state] || '',
    };
}
