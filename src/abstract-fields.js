// 描述属性保留模型内容；统一格式与合并，不裁决语义、不设长度或数量上限。
export function bookFieldTextOf(value) {
    if (typeof value === 'string') return value.trim();
    if (value == null) return '';
    return JSON.stringify(value) ?? '';
}

export function mergeBookFieldValues(first, second) {
    const a = bookFieldTextOf(first), b = bookFieldTextOf(second);
    if (!a) return b;
    if (!b || a === b || containsDescription(a, b)) return a;
    if (containsDescription(b, a)) return b;
    return `${a}\n${b}`;
}

function containsDescription(full, part) {
    if (full.split('\n').includes(part)) return true;
    // 含数字的描述只按完整值去重，不用子串压缩（含全角数、千位符和空格）。
    if (/\p{N}/u.test(part)) return false;
    // 数值符号也是 token 的组成部分，不能把 1 与 -1 / 1.5 / 1/2 合成同一个值。
    const word = /[\p{L}\p{N}_.+\-−/:%]/u;
    for (let index = full.indexOf(part); index >= 0; index = full.indexOf(part, index + 1)) {
        const before = full[index - 1] || '', after = full[index + part.length] || '';
        if (!(word.test(part[0]) && word.test(before))
            && !(word.test(part.at(-1)) && word.test(after))) return true;
    }
    return false;
}

export function mergeBookFieldMaps(first = {}, second = {}) {
    const out = new Map(Object.entries(first));
    for (const [key, value] of Object.entries(second)) out.set(key, mergeBookFieldValues(out.get(key), value));
    return Object.fromEntries(out);
}
