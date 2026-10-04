// story-world-v2/test/fixture-picker-dom.mjs
// 「抽象来源」页面判据共用的**一小片假 DOM**（仓里不引任何依赖）。
//
// 为什么提出来（与 `test/fixture-param.mjs` 同一把尺）：Task 2 起，来源页面有两份判据
//   （页面操作 `abstract-source-page.test.js` 与接线 `abstract-source-ui-wiring.test.js`）
//   都要"真派发点击/输入/改选事件"。两处各写一份解析器 = 迟早分叉（先假绿后假红）。
//
// ★它不是"浏览器"：只够解析**我们自己产出的那几种标签/属性写法**、够把事件从 target 冒泡到窗口。
//   ★★`textarea` 是一条**必须在**的特例：真浏览器里它的 `value` 来自**内容**（不是 value 属性），
//     而页面判据要拿 `selectionStart/End` 选原文 —— 所以这里给它一份与真 DOM 同形的存取器。
//
// 纪律：模块顶层零 DOM 副作用（只导出函数与常量）。

const VOID_TAGS = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);
// ★属性名必须是**完整的一个 token**才能当名字——否则 `data-source-entry value="x"` 里
//   那个"光杆布尔属性"会把后面那个 `value="x"` 整个吞成自己的值；
//   带引号的两支必须排在裸值那支**前面**（否则 `="x"` 会被当成裸值 `"x"`）。
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

export function decodeEntities(s) {
    return String(s).replace(/&(#[0-9]+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos|nbsp);/g, (m, e) => {
        if (e[0] === '#') {
            const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(n) ? String.fromCodePoint(n) : m;
        }
        return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }[e] ?? m;
    });
}

export function parseAttrs(text) {
    const out = new Map();
    for (const m of String(text).matchAll(ATTR_RE)) out.set(m[1].toLowerCase(), decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
    return out;
}

/** 一小片假 DOM：够解析我们自己产出的 HTML、够派发真实事件（事件从 target 冒泡到 win）。 */
export function makeDom() {
    const listeners = new Map();
    const mk = (tag) => {
        const el = {
            tagName: String(tag).toUpperCase(),
            attrs: new Map(),
            children: [],
            parent: null,
            checked: false,
            textContent: '',
            selectionStart: 0,
            selectionEnd: 0,
            style: {},
            classList: {
                _set: new Set(),
                add(...c) { for (const x of c) this._set.add(x); },
                remove(...c) { for (const x of c) this._set.delete(x); },
                contains(c) { return this._set.has(c); },
                toggle(c, on) { if (on === undefined) on = !this._set.has(c); if (on) this._set.add(c); else this._set.delete(c); return on; },
            },
            get value() { return this.tagName === 'TEXTAREA' ? (this._value ?? this.textContent) : (this.attrs.get('value') ?? ''); },
            set value(v) {
                // ★真浏览器里给 textarea 赋一次值 = 选区与光标挪到末尾 ⇒ 假 DOM 也数一数写了几次
                //   （"加选段不许碰用户刚划好的选区"这条判据就靠它证）。
                this._valueWrites = (this._valueWrites || 0) + 1;
                if (this.tagName === 'TEXTAREA') this._value = String(v); else this.attrs.set('value', String(v));
            },
            getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; },
            hasAttribute(n) { return this.attrs.has(n); },
            setAttribute(n, v) { this.attrs.set(n, String(v)); },
            removeAttribute(n) { this.attrs.delete(n); },
            appendChild(c) { c.parent = this; this.children.push(c); return c; },
            addEventListener(t, f) { listeners.set(this, [...(listeners.get(this) || []), [t, f]]); },
            removeEventListener(t, f) {
                const l = listeners.get(this) || [];
                const i = l.findIndex((x) => x[0] === t && x[1] === f);
                if (i >= 0) l.splice(i, 1);
            },
            dispatchEvent(ev) {
                let node = this;
                while (node) {
                    for (const [t, f] of listeners.get(node) || []) if (t === ev.type) f(ev);
                    node = node.parent;
                }
                return true;
            },
            closest(sel) { let n = this; while (n) { if (matchesSel(n, sel)) return n; n = n.parent; } return null; },
            querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
            querySelectorAll(sel) { return descendants(this).filter((d) => matchesSel(d, sel)); },
            focus() { this.ownerDocument._activeElement = this; },
            contains(node) { let n = node; while (n) { if (n === this) return true; n = n.parent; } return false; },
        };
        return el;
    };
    const win = mk('div');
    const doc = {
        activeElement: null,
        createElement: (tag) => {
            const el = mk(tag);
            el.ownerDocument = doc;   // ★真 DOM 里每个元素都有它；本文件的解析器要用
            // `innerHTML` 用存取器：设进去就走本文件的解析器（控制器正是用它填容器的）
            let html = '';
            Object.defineProperty(el, 'innerHTML', {
                get() { return html; },
                set(v) { html = String(v); mountHTML(el, html); },
                configurable: true,
            });
            return el;
        },
        querySelector(sel) { return win.querySelectorAll(sel)[0] || null; },
        querySelectorAll(sel) { return win.querySelectorAll(sel); },
        addEventListener(t, f) { win.addEventListener(t, f); },
        removeEventListener(t, f) { win.removeEventListener(t, f); },
        _listeners: listeners,
        _win: win,
    };
    win.ownerDocument = doc;
    win.classList = mk('div').classList;
    return { doc, win };
}

export function descendants(root) {
    const out = [];
    const walk = (n) => { for (const c of n.children) { out.push(c); walk(c); } };
    walk(root);
    return out;
}

function parseSelector(sel) {
    const s = String(sel).trim();
    const m = /^([a-zA-Z][-a-zA-Z0-9]*)?((?:\[[^\]]*\])*)(?::checked)?$/.exec(s);
    if (!m) return null;
    const flags = [...m[2].matchAll(/\[([^\]=]+)(?:=("([^"]*)"|'([^']*)'|([^\]]*)))?\]/g)]
        .map((x) => ({ name: x[1].toLowerCase(), value: x[3] ?? x[4] ?? x[5] ?? null }));
    return { tag: m[1] ? m[1].toUpperCase() : null, flags, checked: s.endsWith(':checked') };
}

export function matchesSel(el, sel) {
    const p = parseSelector(sel);
    if (!p) return false;
    if (p.tag && el.tagName !== p.tag) return false;
    for (const f of p.flags) {
        if (!el.attrs.has(f.name)) return false;
        if (f.value !== null && el.attrs.get(f.name) !== f.value) return false;
    }
    if (p.checked && !(el.tagName === 'INPUT' && el.checked)) return false;
    return true;
}

/** 往一个元素里塞一段真实 HTML（只认本模块产出的那几种标签/属性写法）。 */
export function mountHTML(root, html) {
    root.children = [];
    const stack = [root];
    const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][-a-zA-Z0-9]*)\s*>|<([a-zA-Z][-a-zA-Z0-9]*)((?:\s+[^<>]*?)?)(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(String(html)))) {
        const [raw, closeTag, openTag, attrText, selfClose, text] = m;
        if (raw.startsWith('<!--')) continue;
        if (closeTag) {
            if (stack.length > 1) stack.pop();
            continue;
        }
        if (openTag) {
            const el = root.ownerDocument.createElement(openTag);
            for (const [k, v] of parseAttrs(attrText || '')) {
                el.attrs.set(k, v);
                if (k === 'checked') el.checked = true;
            }
            stack[stack.length - 1].appendChild(el);
            if (!selfClose && !VOID_TAGS.has(openTag.toLowerCase())) stack.push(el);
            continue;
        }
        if (text) {
            const t = decodeEntities(text);
            if (t.trim()) stack[stack.length - 1].textContent += t;
        }
    }
    return root;
}

// ─────────────────── 判据常用的小动作 ───────────────────

/** 一段 HTML 里所有条目复选框的 value（= 稳定 ID）。 */
export const checkboxValues = (html) => [...String(html).matchAll(/<input[^>]*\sdata-source-entry\s[^>]*>/g)]
    .map((m) => /value="([^"]*)"/.exec(m[0])?.[1] ?? '');

/** 其中**勾上**的那些（`checked` 是个光杆布尔属性，别按 `="…"` 找）。 */
export const checkedValues = (html) => [...String(html).matchAll(/<input[^>]*\sdata-source-entry\s[^>]*>/g)]
    .filter((m) => /\schecked(?:\s|\/?>)/.test(m[0]))
    .map((m) => /value="([^"]*)"/.exec(m[0])?.[1] ?? '');

/** 往搜索框里写字并派发 input（模拟玩家打字）。 */
export function typeSearch(win, text) {
    const box = win.querySelector('[data-source-search]');
    box.value = text;
    box.dispatchEvent({ type: 'input', target: box });
    return box;
}

/** 可见的列表项（`hidden` 为空 = 被搜索/筛选藏起来了）。 */
export const visibleItems = (win) => win.querySelectorAll('[data-source-item]').filter((i) => !i.hasAttribute('hidden'));

/** 按 `data-source-action` 的名字派发一次真点击（判据里**不直接调内部函数**）。 */
export function clickAction(win, name) {
    const el = win.querySelector(`[data-source-action="${name}"]`);
    if (!el) throw new Error(`页面上没有 [data-source-action="${name}"]`);
    el.dispatchEvent({ type: 'click', target: el });
    return el;
}

/** 给某个元素派发一次事件（target 就是它自己）。 */
export function fire(el, type) {
    el.dispatchEvent({ type, target: el });
    return el;
}

/** 在一段文本里找子串的 UTF-16 位置（判据造选择区用）。 */
export function rangeOf(text, needle) {
    const start = text.indexOf(needle);
    if (start < 0) throw new Error(`夹具里找不到 ${needle}`);
    return { start, end: start + needle.length };
}
