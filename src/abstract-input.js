import { entrySelectionId, normalizeAbstractSelection } from './abstract-selection.js';
import { prepareAbstractEntry, abstractEntryTitle } from './abstract-source.js';

export const CHARACTER_SOURCE_FIELDS = ['description', 'scenario', 'personality', 'first_mes'];

/**
 * ★★★leg201（社区第三次报同一条「设定源不可用：角色卡四件套全空」· 2026-10-05）：**读卡那四格正文的唯一取法**。
 *
 * 病（`??` 的语义坑，不是猜的）：旧法写的是 `character[field] ?? character.data?.[field] ?? ''`——
 *   **`??` 只在 `null`/`undefined` 时才往下一层找**。宿主若在顶层给一个**空串**（`description: ""`）
 *   而正文躺在 `data.description` 里，那么 `""` **会赢** ⇒ `data` 层那份**永远读不到** ⇒
 *   取料为空 ⇒ 面板报「角色卡四件套全空」，而玩家的卡明明是满的。
 *   ★这正是"**换多少张卡都一样**"的形状：**空串是宿主给的，不是卡给的**（社区用户换卡无效，原因在此）。
 *   （与 leg18「取数形状宽容」同一条纪律：ST 各版本与各家 fork 的卡形状不一，读法必须宽容。）
 *
 * 口径（**一处实现、两处共用**——`init-source.js` 那句"卡空不空"的判定必须用同一个取法，
 *   否则会出现"取料说没有、判定说没有、而盘上明明有"那种自相矛盾；本仓最忌"一个数两把尺子"）：
 *   **顶层与 `data` 层都看，取第一个"非空字符串"；两层都没有 ⇒ 空串。**
 */
export function characterFieldText(character, field) {
    for (const v of [character?.[field], character?.data?.[field]]) {
        if (typeof v === 'string' && v.trim()) return v;
    }
    return '';
}

const listOf = value => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
const titleOf = abstractEntryTitle;
const FETCH_CALL_RE = /(?:getwi|getWorldInfo|getWorldInfoEntry|activewi|activateWorldInfo)\s*\(\s*(?:[^,()]*,\s*)?['"`]([^'"`\n]{1,80})['"`]/g;
const stripComments = s => String(s).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1 ');

/** 默认声明读取沿用既有恒注入与成套声明判据，不执行脚本。 */
export function probeAbstractDeclarations(entries) {
    const byTitle = new Map();
    for (const e of entries) if (String(e.content ?? '').trim() && !byTitle.has(titleOf(e))) byTitle.set(titleOf(e), e);
    const shells = [];
    const declarers = new Map();
    for (const e of entries) {
        if (e.disable === true || e.enabled === false || !String(e.content ?? '').trim()) continue;
        const declares = [...new Set([...stripComments(e.content).matchAll(new RegExp(FETCH_CALL_RE.source, FETCH_CALL_RE.flags))].map(m => m[1].trim()).filter(Boolean))];
        if (!declares.length) continue;
        const shell = { title: titleOf(e), constant: e.constant === true, chars: Array.from(String(e.content).trim()).length, declares };
        shells.push(shell);
        for (const title of declares) { if (!declarers.has(title)) declarers.set(title, new Set()); declarers.get(title).add(shell.title); }
    }
    function family(titles) {
        for (const length of [2, 3]) for (const kind of ['pre', 'suf']) {
            const groups = new Map();
            for (const title of titles) {
                if (title.length <= length) continue;
                const affix = kind === 'pre' ? title.slice(0, length) : title.slice(-length);
                groups.set(affix, (groups.get(affix) || 0) + 1);
            }
            for (const [affix, size] of groups) if (size >= 3) return { affix, size };
        }
        return null;
    }
    const pickedTitles = new Map();
    for (const shell of shells) {
        const present = shell.declares.filter(t => byTitle.has(t));
        if (shell.constant) { for (const title of present) pickedTitles.set(title, `恒注入壳「${shell.title}」声明`); continue; }
        const group = family(present);
        if (group) for (const title of present) if (!pickedTitles.has(title)) pickedTitles.set(title, `成套声明「${shell.title}」（${group.affix}·${group.size} 条）`);
    }
    const declared = [];
    const missing = [];
    for (const [title, by] of declarers) {
        const e = byTitle.get(title);
        if (!e) { missing.push(title); continue; }
        declared.push({ title, chars: Array.from(String(e.content).trim()).length, disabled: e.disable === true || e.enabled === false, by: [...by] });
    }
    return { shells, constShells: shells.filter(s => s.constant), declared, missing,
        picked: declared.filter(d => pickedTitles.has(d.title)).map(d => ({ ...d, why: pickedTitles.get(d.title) })),
        skipped: declared.filter(d => !pickedTitles.has(d.title)) };
}

/** 完整只读清单：仅按来源身份去重，不按正文合并不同书。 */
export function collectAbstractSources({ worldInfoEntries = [], character = null, worldSources = null } = {}) {
    const sources = [];
    const seen = new Set();
    function add(entry, kind = 'world-entry', field = null) {
        const id = entrySelectionId(entry);
        if (seen.has(id)) return;
        seen.add(id);
        const rawText = String(entry.content ?? '');
        const prepared = prepareAbstractEntry(entry);
        sources.push({ id, entrySelectionId: id, kind, field, source: String(entry._sw2Source || 'world-info'), title: titleOf(entry), rawText,
            disabled: entry.disable === true || entry.enabled === false, technical: prepared.technical || (!prepared.content.trim() && prepared.excluded.length > 0),
            empty: !rawText.trim(), loaded: true, entry: { ...entry, key: Array.isArray(entry.key) ? [...entry.key] : entry.key },
            worldSource: listOf(worldSources).find(s => s.name === entry._sw2Source) ?? null });
    }
    for (const e of listOf(worldInfoEntries)) if (e && typeof e === 'object') add(e);
    const embedded = character?.character_book?.entries ?? character?.data?.character_book?.entries;
    for (const e of listOf(embedded)) if (e && typeof e === 'object') add({ ...e, uid: e.uid ?? e.id, key: Array.isArray(e.keys) ? e.keys : e.key ?? [],
        comment: String(e.comment ?? '').trim() || String(e.name ?? '').trim(), disable: e.enabled === undefined ? Boolean(e.disable) : !e.enabled,
        _sw2Source: `character:${character?.name || ''}` });
    if (character) for (const field of CHARACTER_SOURCE_FIELDS) {
        add({ uid: field, _sw2Source: `character-fields:${character.avatar || character.name || character.data?.name || ''}`,
            comment: `角色卡 ${field}`, content: characterFieldText(character, field) }, 'character-field', field);
        sources[sources.length - 1].loaded = character.shallow !== true;
    }
    return sources;
}

/** 旧自选实际会读取卡正文；只迁移一次，新设置用 version:2 或 reads 显式区分。 */
export function migrateAbstractSelection(value, sources = []) {
    const selection = normalizeAbstractSelection(value);
    if (selection.version === 2) return selection;
    if (sources.some(s => s.kind === 'character-field' && !s.loaded)) return selection;
    const selectedIds = [...selection.selectedIds];
    if (selection.mode === 'custom') for (const source of sources) {
        if (source.kind === 'character-field' && source.loaded && prepareAbstractEntry(source.entry).content.trim() && !selectedIds.includes(source.id)) selectedIds.push(source.id);
    }
    return { ...selection, selectedIds, version: 2, reads: {} };
}

export function migrateAbstractSelectionState({ selection = null, sources = [] } = {}) {
    const before = normalizeAbstractSelection(selection);
    const pendingCharacter = before.version !== 2 && sources.some(s => s.kind === 'character-field' && !s.loaded);
    return { selection: migrateAbstractSelection(selection, sources), complete: !pendingCharacter,
        migrated: before.version !== 2 && !pendingCharacter, pendingCharacter };
}

/** 只生成读取副本。declaredIds 由默认声明探测提供，自选不会越过勾选。 */
export function resolveAbstractSources({ sources = [], selection = null, declaredIds = null } = {}) {
    const picked = migrateAbstractSelection(selection, sources);
    const wanted = new Set(picked.selectedIds);
    const declarations = probeAbstractDeclarations(sources.filter(s => s.kind === 'world-entry').map(s => s.entry));
    const pickedTitles = new Set(declarations.picked.map(d => d.title));
    const declared = new Set(declaredIds ?? sources.filter(s => s.kind === 'world-entry' && pickedTitles.has(s.title)).map(s => s.id));
    const excluded = [];
    const warnings = [];
    if (picked.mode === 'custom') for (const shell of declarations.shells) {
        if (!sources.some(s => s.title === shell.title && wanted.has(s.id))) continue;
        for (const title of shell.declares) if (!sources.some(s => s.title === title && wanted.has(s.id))) warnings.push(`声明依赖「${title}」未勾选，未读取`);
    }
    const effectiveEntries = [];
    const sourceItems = sources.map(source => {
        const read = picked.mode === 'custom' ? picked.reads?.[source.id] ?? { mode: 'auto' } : { mode: 'auto' };
        const selected = picked.mode === 'custom' ? wanted.has(source.id) : !source.disabled || declared.has(source.id);
        const item = { ...source, selected, readMode: read.mode, content: '', effectiveChars: 0, status: selected ? 'empty' : 'excluded', reason: selected ? '正文为空' : source.disabled ? '默认排除禁用条目' : '未勾选' };
        if (!selected || source.loaded === false) { if (source.loaded === false) { item.status = 'unloaded'; item.reason = '角色卡还没加载完'; } return item; }
        let content = source.rawText;
        if (read.mode === 'segments') {
            const segments = read.segments;
            const valid = read.originalText === source.rawText && Array.isArray(segments) && segments.length > 0 && segments.every(s =>
                Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.end > s.start && s.end <= source.rawText.length && typeof s.text === 'string' && source.rawText.slice(s.start, s.end) === s.text);
            item.segmentsValid = valid;
            if (!valid) { item.status = 'stale-segments'; item.reason = '原文选段需要重新选择'; warnings.push(`${source.title}：${item.reason}`); return item; }
            content = segments.map(s => s.text).join('\n');
        } else if (read.mode === 'auto') {
            const prepared = prepareAbstractEntry(source.entry);
            content = prepared.content;
            excluded.push(...prepared.excluded);
            warnings.push(...prepared.warnings);
            if (!content.trim() && prepared.excluded.length) { item.status = 'technical'; item.reason = '自动清理后没有世界正文'; }
        }
        if (read.mode === 'auto') content = content.trim();
        if (!content.trim()) return item;
        item.content = content;
        item.effectiveChars = Array.from(content).length;
        item.status = 'effective';
        item.reason = picked.mode === 'custom' ? '用户勾选' : declared.has(source.id) && source.disabled ? declarations.picked.find(d => d.title === source.title)?.why || '作者声明读取' : '默认读取';
        effectiveEntries.push({ ...source.entry, content, disable: false, enabled: true, _sw2Resolved: true, _sw2SelectionId: source.id,
            _sw2SourceKind: source.kind, _sw2Field: source.field, _sw2ReadMode: read.mode, _sw2Reason: item.reason });
        return item;
    });
    return { sourceItems, effectiveEntries, selection: picked, excluded, warnings, defaultSelectedIds: effectiveEntries.map(e => e._sw2SelectionId),
        migration: migrateAbstractSelectionState({ selection, sources }) };
}
