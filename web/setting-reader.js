// View-only directory search. No ledger, config, model, or HTML writes.
const bindings = new WeakMap();
const normalized = (text) => String(text ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();

export function settingQueryMatches(text, query) {
    const haystack = normalized(text);
    return normalized(query).split(' ').filter(Boolean).every((term) => haystack.includes(term));
}

export function bindSettingReader(win) {
    if (bindings.has(win)) return bindings.get(win);
    let root = null, world = null, query = '', composing = false;
    let openState = new Map(), beforeSearch = null;
    const details = () => Array.from(root?.querySelectorAll('details[data-setting-key]') || []);
    const capture = () => new Map(details().map((el) => [el.getAttribute('data-setting-key'), el.open]));
    const restore = (state) => {
        for (const el of details()) if (state.has(el.getAttribute('data-setting-key'))) el.open = state.get(el.getAttribute('data-setting-key'));
    };
    function apply() {
        if (!root) return;
        const active = !!normalized(query);
        const entries = Array.from(root.querySelectorAll('[data-setting-entry]'));
        let count = 0;
        for (const entry of entries) {
            entry.hidden = active && !settingQueryMatches(`${entry.getAttribute('data-setting-source') || ''} ${entry.textContent}`, query);
            if (!entry.hidden) {
                count++;
                if (active) for (let el = entry; el && el !== root; el = el.parentElement) if (el.tagName === 'DETAILS') el.open = true;
            }
        }
        for (const group of root.querySelectorAll('[data-setting-group]')) {
            group.hidden = active && !Array.from(group.querySelectorAll('[data-setting-entry]')).some((el) => !el.hidden);
        }
        for (const section of root.querySelectorAll('[data-setting-section]')) {
            section.hidden = active && !Array.from(section.querySelectorAll('[data-setting-entry]')).some((el) => !el.hidden);
        }
        const result = root.querySelector('[data-setting-results]');
        if (result) result.textContent = active ? (count ? `${count} 项结果` : '未找到匹配内容') : '';
        const clear = root.querySelector('[data-setting-clear]');
        if (clear) clear.hidden = !active;
    }
    function sync() {
        const next = win.querySelector('[data-setting-reader]');
        if (next === root) return;
        if (root && !normalized(query)) openState = capture();
        root = next;
        const nextWorld = root?.getAttribute('data-setting-reader') ?? null;
        if (nextWorld !== world) {
            world = nextWorld; query = ''; openState = new Map(); beforeSearch = null; composing = false;
        }
        if (!root) return;
        restore(openState);
        const input = root.querySelector('[data-setting-search]');
        if (input) input.value = query;
        apply();
    }
    function read(input) {
        if (!root?.contains(input) || !input.matches?.('[data-setting-search]')) return;
        const next = input.value;
        if (normalized(next) && !normalized(query)) { beforeSearch = capture(); openState = new Map(beforeSearch); }
        if (!normalized(next) && normalized(query)) { restore(beforeSearch || openState); beforeSearch = null; }
        query = next; apply();
    }
    const onInput = (e) => { if (!e.isComposing && !composing) read(e.target); };
    const onStart = (e) => { if (e.target?.matches?.('[data-setting-search]')) composing = true; };
    const onEnd = (e) => { if (e.target?.matches?.('[data-setting-search]')) { composing = false; read(e.target); } };
    const onClick = (e) => {
        if (!root?.contains(e.target) || !e.target?.matches?.('[data-setting-clear]')) return;
        const input = root.querySelector('[data-setting-search]');
        if (input) { input.value = ''; read(input); input.focus?.(); }
    };
    const listeners = [['input', onInput], ['compositionstart', onStart], ['compositionend', onEnd], ['click', onClick]];
    for (const [type, fn] of listeners) win.addEventListener(type, fn);
    const Observer = win.ownerDocument?.defaultView?.MutationObserver;
    const observer = Observer ? new Observer(sync) : null;
    // Observe the page's replacement, not the result label's text updates.
    const page = win.querySelector('#sw2_view_setting');
    if (page) observer?.observe(page, { childList: true });
    const api = { sync, dispose() { observer?.disconnect(); for (const [type, fn] of listeners) win.removeEventListener(type, fn); bindings.delete(win); } };
    bindings.set(win, api); sync();
    return api;
}
