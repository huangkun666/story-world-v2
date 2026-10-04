// 只处理送给抽象模型的副本；原书与取件声明仍由调用方保留。
const TECH_TITLE = /^\s*\[(?:mvu_update|initvar)\]/i;
const BLOCK_OPEN = /<%(?!%)|<script\b[^>]*>|<UpdateVariable\b[^>]*>/gi;
const WORD_CHAR = /[\p{L}\p{N}_]/u;
const chars = (text) => Array.from(text).length;

/** 世界书标签的共同回退规则；来源清单、声明配对与合订题头使用同一名称。 */
export function abstractEntryKey(entry) {
    const key = entry?.key;
    if (typeof key === 'string' && key.trim()) return key.trim();
    if (Array.isArray(key) && key.length) return String(key[0] ?? '').trim();
    if (Array.isArray(entry?.keys) && entry.keys.length) return String(entry.keys[0] ?? '').trim();
    if (typeof entry?.keys === 'string' && entry.keys.trim()) return entry.keys.trim();
    return String(entry?.uid ?? entry?.name ?? entry?.comment ?? '');
}

export function abstractEntryTitle(entry) {
    return String(entry?.comment ?? '').trim() || String(entry?.name ?? '').trim() || abstractEntryKey(entry);
}

export function prepareAbstractText(value, { title = '' } = {}) {
    const raw = String(value ?? '');
    const excluded = [];
    const warnings = [];
    const open = new RegExp(BLOCK_OPEN.source, BLOCK_OPEN.flags);
    let text = '';
    let cursor = 0;
    let separated = false;
    function append(segment) {
        if (!segment) return;
        const before = text.match(/.$/u)?.[0] || '';
        const after = segment.match(/^./u)?.[0] || '';
        if (separated && WORD_CHAR.test(before) && WORD_CHAR.test(after)) text += '\n';
        text += segment;
        separated = false;
    }
    let match;
    while ((match = open.exec(raw))) {
        const ejs = match[0].startsWith('<%');
        const kind = ejs ? 'EJS' : /^<script\b/i.test(match[0]) ? 'script' : 'UpdateVariable';
        const close = ejs ? /%>/g : new RegExp('</' + kind + '\\s*>', 'gi');
        close.lastIndex = open.lastIndex;
        const end = close.exec(raw);
        append(raw.slice(cursor, match.index));
        if (!end) {
            append(raw.slice(match.index));
            warnings.push(`${title || '原文'}：${kind} 区块未闭合，已保留原文`);
            cursor = raw.length;
            break;
        }
        cursor = close.lastIndex;
        excluded.push({ title, reason: `${kind} 技术区块`, chars: chars(raw.slice(match.index, cursor)) });
        // 等到下一段正文再判边界：相邻区块与补充汉字也不会拼造名字。
        separated = true;
        open.lastIndex = cursor;
    }
    append(raw.slice(cursor));
    return { text, excluded, warnings };
}

export function prepareAbstractEntry(entry, { title = null } = {}) {
    if (entry?._sw2Resolved === true) return { content: String(entry.content ?? ''), technical: false, excluded: [], warnings: [] };
    const key = typeof entry?.key === 'string' && entry.key.trim() ? entry.key.trim()
        : Array.isArray(entry?.key) && entry.key.length ? String(entry.key[0] ?? '').trim()
        : Array.isArray(entry?.keys) && entry.keys.length ? String(entry.keys[0] ?? '').trim()
        : typeof entry?.keys === 'string' ? entry.keys.trim() : String(entry?.uid ?? '');
    const label = title ?? (String(entry?.comment ?? '').trim() || String(entry?.name ?? '').trim() || key);
    const raw = String(entry?.content ?? '');
    if (TECH_TITLE.test(label)) return {
        content: '',
        technical: true,
        excluded: raw ? [{ title: label, reason: '专用 MVU 技术条目', chars: chars(raw) }] : [],
        warnings: [],
    };
    const result = prepareAbstractText(raw, { title: label });
    return { content: result.text, technical: false, excluded: result.excluded, warnings: result.warnings };
}
