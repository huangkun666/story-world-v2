// Page navigation only: never writes settings or replaces controls.
const bindings = new WeakMap();

export function bindPageSubtabs(win) {
    if (bindings.has(win)) return bindings.get(win);
    const states = new Map();
    const tabs = (root) => [...root.querySelectorAll('[data-subtab]')];
    const stateOf = (root) => {
        const scope = root.getAttribute('data-subtabs');
        if (!states.has(scope)) states.set(scope, { key: tabs(root)[0]?.getAttribute('data-subtab'), scrolls: new Map() });
        return states.get(scope);
    };

    function apply(root, state) {
        for (const tab of tabs(root)) {
            const selected = tab.getAttribute('data-subtab') === state.key;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
        }
        for (const panel of root.querySelectorAll('[data-subpanel]')) panel.hidden = panel.getAttribute('data-subpanel') !== state.key;
    }

    function select(tab, focus = false) {
        const root = tab.closest('[data-subtabs]');
        if (!root || !win.contains(root)) return;
        const state = stateOf(root), page = root.closest('.sw2-view');
        if (page) state.scrolls.set(state.key, page.scrollTop);
        state.key = tab.getAttribute('data-subtab');
        apply(root, state);
        if (page) page.scrollTop = state.scrolls.get(state.key) || 0;
        if (focus) tab.focus();
    }

    function sync() {
        for (const root of win.querySelectorAll('[data-subtabs]')) apply(root, stateOf(root));
    }

    win.addEventListener('click', (e) => {
        const tab = e.target?.closest?.('[data-subtab]');
        if (tab) select(tab);
    });
    win.addEventListener('keydown', (e) => {
        const tab = e.target?.closest?.('[data-subtab]');
        if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        const root = tab.closest('[data-subtabs]');
        if (!root || !win.contains(root)) return;
        const all = tabs(root), i = all.indexOf(tab);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
        e.preventDefault();
        select(all[next], true);
    });
    const api = { sync };
    bindings.set(win, api);
    sync();
    return api;
}
