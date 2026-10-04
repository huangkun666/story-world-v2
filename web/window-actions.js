const bindings = new WeakMap();
export function bindWindowActions(win) {
    if (bindings.has(win)) return bindings.get(win);
    const toggle = () => win.querySelector('[data-window-menu]');
    const close = () => { win.classList.remove('sw2-menu-open'); toggle()?.setAttribute('aria-expanded', 'false'); };
    win.addEventListener('click', e => {
        if (e.target?.closest?.('[data-window-menu]')) {
            const open = !win.classList.contains('sw2-menu-open'); win.classList.toggle('sw2-menu-open', open);
            toggle()?.setAttribute('aria-expanded', String(open));
            if (open) win.querySelector('#sw2_actionbar button')?.focus();
        } else if (!e.target?.closest?.('#sw2_actionbar') || e.target?.closest?.('[data-action]')) close();
    });
    win.addEventListener('keydown', e => { if (e.key === 'Escape' && win.classList.contains('sw2-menu-open')) { e.preventDefault(); e.stopPropagation(); close(); toggle()?.focus(); } });
    const api = { close }; bindings.set(win, api); return api;
}
