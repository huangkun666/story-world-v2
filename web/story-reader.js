// Ephemeral reading state. Navigation never changes the world ledger or settings.
import { captureScrollPositions, restoreScrollPositions } from './scroll-keep.js';

const bindings = new WeakMap();
const normalized = text => String(text ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
const matchesQuery = (text, query) => normalized(query).split(' ').filter(Boolean).every(term => normalized(text).includes(term));
const all = (root, selector) => Array.from(root?.querySelectorAll(selector) || []);
const keyed = (root, selector, attr, key) => all(root, selector).find(node => node.getAttribute(attr) === key);

export function bindStoryReader(win) {
    if (bindings.has(win)) return bindings.get(win);
    let page = null, app = null, identity = null;
    let selected = '', context = '', view = 'recent', query = '', worldQuery = '', searchOpen = false, composing = false;
    let homeScroll = null, storyScroll = new Map(), detailsState = new Map(), returnFocus = null, drawerScroll = 0;
    const main = () => app?.querySelector('.sw2-merged-main');
    const article = () => keyed(app, '[data-story-detail]', 'data-story-id', selected);
    const within = target => !!app?.contains(target);
    function saveScroll(snapshot = captureScrollPositions(page)) {
        if (selected && article() && !article().hidden) storyScroll.set(selected, snapshot);
        else if (!selected && app?.querySelector('[data-story-row]')) homeScroll = snapshot;
    }
    function restoreReadingScroll() {
        const snapshot = selected && article() ? storyScroll.get(selected) : homeScroll;
        if (snapshot) restoreScrollPositions(page, snapshot);
        else { if (page) page.scrollTop = 0; if (main()) main().scrollTop = 0; }
    }
    function applyFilter() {
        if (!app) return;
        const rows = all(app, '[data-story-row]');
        let count = 0;
        for (const row of rows) {
            row.hidden = (view === 'unresolved' && row.getAttribute('data-story-live') !== 'true')
                || !matchesQuery(row.getAttribute('data-story-search') || row.textContent, query);
            if (!row.hidden) count++;
        }
        // A renderer may group rows by round; headings disappear with their last row.
        for (const group of all(app, '[data-story-round-group]')) group.hidden = !all(group, '[data-story-row]').some(row => !row.hidden);
        for (const button of all(app, '[data-story-view]')) button.setAttribute('aria-selected', String(button.getAttribute('data-story-view') === view));
        const input = app.querySelector('[data-story-search-input]');
        if (input && input.value !== query) input.value = query;
        const box = app.querySelector('[data-story-search-box]'); if (box) box.hidden = !searchOpen;
        const toggle = app.querySelector('[data-story-search-toggle]'); if (toggle) toggle.setAttribute('aria-expanded', String(searchOpen));
        const clear = app.querySelector('[data-story-clear]'); if (clear) clear.hidden = !query;
        const result = app.querySelector('[data-story-results]');
        if (result) result.textContent = normalized(query) || view === 'unresolved' ? (count ? `${count} 条故事` : '没有匹配的故事') : '';
        const empty = app.querySelector('[data-story-no-results]');
        if (empty) {
            empty.hidden = count > 0 || rows.length === 0;
            if (rows.length) empty.textContent = view === 'unresolved' && !normalized(query) ? '这个阅读窗口内的故事都已收场。' : '没有找到匹配的故事，试试其他人物、地点或词语。';
        }
    }
    function applyRoute() {
        if (!app) return;
        const current = article();
        const home = app.querySelector('[data-story-home-panel]'); if (home) home.hidden = !!current;
        for (const node of all(app, '[data-story-detail]')) node.hidden = node !== current;
        app.classList.toggle('sw2-story-reading', !!current);
        const homeButton = app.querySelector('[data-story-home]'); if (homeButton) homeButton.setAttribute('aria-current', current ? 'false' : 'page');
    }
    function applyWorldSearch() {
        if (!app) return;
        const input = app.querySelector('[data-story-world-input]'); if (input && input.value !== worldQuery) input.value = worldQuery;
        const entries = all(app, '[data-story-world-entry]'); let count = 0;
        for (const entry of entries) { entry.hidden = !matchesQuery(entry.textContent, worldQuery); if (!entry.hidden) count++; }
        const empty = app.querySelector('[data-story-world-empty]'); if (empty) empty.hidden = count > 0 || !worldQuery;
    }
    function applyDrawer(focus = false) {
        if (!app) return;
        const panel = context === '@world' ? app.querySelector('[data-story-world-panel]')
            : keyed(app, '[data-story-context-panel]', 'data-story-context-id', context);
        const open = !!(context && panel);
        const drawer = app.querySelector('[data-story-drawer]');
        if (drawer) { drawer.hidden = !open; drawer.setAttribute('aria-modal', String(open)); }
        for (const node of all(app, '[data-story-context-panel], [data-story-world-panel]')) node.hidden = node !== panel;
        if (main()) main().inert = open;
        const nav = app.querySelector('.sw2-story-nav'); if (nav) nav.inert = open;
        app.classList.toggle('sw2-story-context-open', open);
        if (open && focus) app.querySelector('[data-story-close-context]')?.focus();
    }
    function closeDrawer(restoreFocus = true) {
        context = ''; applyDrawer();
        if (restoreFocus && returnFocus && within(returnFocus)) returnFocus.focus();
        returnFocus = null;
    }
    function navigate(id) {
        if (id && !keyed(app, '[data-story-detail]', 'data-story-id', id)) return;
        saveScroll(); closeDrawer(false); selected = id; applyRoute(); restoreReadingScroll();
        const heading = article()?.querySelector('.sw2-story-title');
        if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
        else if (!id) keyed(app, '[data-story-row]', 'data-story-id', lastStory)?.focus({ preventScroll: true });
    }
    let lastStory = '';
    function sync(scope = '', scroll = null) {
        const nextPage = win.querySelector('#sw2_view_panorama');
        const nextApp = nextPage?.querySelector('[data-story-app]') || null;
        const nextIdentity = JSON.stringify([scope ?? '', nextApp?.getAttribute('data-pan-world') ?? '']);
        const sameWorld = identity === nextIdentity;
        if (app === nextApp && page === nextPage && sameWorld) return true;
        if (sameWorld && app) {
            saveScroll(scroll || captureScrollPositions(page));
            const oldDrawer = app.querySelector('[data-story-drawer]');
            if (oldDrawer && !oldDrawer.hidden) drawerScroll = oldDrawer.scrollTop;
            for (const node of all(app, 'details')) {
                const key = node.getAttribute('data-story-background') != null ? 'background' : node.getAttribute('data-pan-key');
                if (key != null) detailsState.set(key, node.open);
            }
        }
        page = nextPage; app = nextApp; identity = nextIdentity;
        if (!sameWorld) {
            selected = ''; lastStory = ''; context = ''; view = 'recent'; query = ''; worldQuery = ''; searchOpen = false; composing = false;
            homeScroll = null; storyScroll = new Map(); detailsState = new Map(); returnFocus = null; drawerScroll = 0;
        }
        if (!app) return sameWorld;
        for (const node of all(app, 'details')) {
            const key = node.getAttribute('data-story-background') != null ? 'background' : node.getAttribute('data-pan-key');
            if (detailsState.has(key)) node.open = detailsState.get(key);
        }
        applyFilter(); applyWorldSearch(); applyRoute(); applyDrawer(!!context); restoreReadingScroll();
        const drawer = app.querySelector('[data-story-drawer]'); if (drawer) drawer.scrollTop = drawerScroll;
        // The old trigger belongs to replaced markup; reconnect it by its semantic key.
        if (context) returnFocus = context === '@world' ? app.querySelector('[data-story-world]')
            : keyed(article() || app, '[data-story-context]', 'data-story-context', context);
        return sameWorld;
    }
    function updateQuery(input) {
        query = input.value; applyFilter();
        if (main()) main().scrollTop = 0;
    }
    const onInput = e => {
        if (!within(e.target) || composing || e.isComposing) return;
        if (e.target.matches?.('[data-story-search-input]')) updateQuery(e.target);
        if (e.target.matches?.('[data-story-world-input]')) { worldQuery = e.target.value; applyWorldSearch(); }
    };
    const onStart = e => { if (within(e.target) && e.target.matches?.('[data-story-search-input], [data-story-world-input]')) composing = true; };
    const onEnd = e => {
        if (!within(e.target) || !e.target.matches?.('[data-story-search-input], [data-story-world-input]')) return;
        composing = false; onInput(e);
    };
    const actions = '[data-story-open], [data-story-back], [data-story-home], [data-story-view], [data-story-search-toggle], [data-story-clear], [data-story-world], [data-story-context], [data-story-close-context], [data-story-jump]';
    const onClick = e => {
        if (!within(e.target)) return;
        if (e.target === app && context) { closeDrawer(); return; }
        const button = e.target.closest?.(actions); if (!button || !within(button)) return;
        if (button.matches('[data-story-open]')) { lastStory = button.getAttribute('data-story-open'); navigate(lastStory); }
        else if (button.matches('[data-story-back], [data-story-home]')) navigate('');
        else if (button.matches('[data-story-view]')) {
            const next = button.getAttribute('data-story-view'); if (!['recent', 'unresolved'].includes(next)) return;
            view = next; applyFilter(); if (main()) main().scrollTop = 0;
        } else if (button.matches('[data-story-search-toggle]')) {
            searchOpen = !searchOpen; applyFilter(); if (searchOpen) app.querySelector('[data-story-search-input]')?.focus();
        } else if (button.matches('[data-story-clear]')) {
            query = ''; applyFilter(); app.querySelector('[data-story-search-input]')?.focus(); if (main()) main().scrollTop = 0;
        } else if (button.matches('[data-story-close-context]')) closeDrawer();
        else if (button.matches('[data-story-context], [data-story-world]')) {
            const next = button.matches('[data-story-world]') ? '@world' : button.getAttribute('data-story-context');
            if (next !== '@world' && !keyed(app, '[data-story-context-panel]', 'data-story-context-id', next)) return;
            returnFocus = button.closest('[data-story-drawer]') ? app.querySelector('[data-story-world]') : button;
            if (context !== next) drawerScroll = 0;
            context = next; applyDrawer(true); const drawer = app.querySelector('[data-story-drawer]'); if (drawer) drawer.scrollTop = drawerScroll;
        } else if (button.matches('[data-story-jump]')) {
            keyed(article(), '[id]', 'id', button.getAttribute('data-story-jump'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };
    const onKey = e => {
        if (!within(e.target) || !context || app.querySelector('[data-story-drawer]')?.hidden) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation?.(); closeDrawer(); }
        if (e.key === 'Tab') {
            const controls = all(app.querySelector('[data-story-drawer]'), 'button, input, select, textarea, a[href], summary')
                .filter(node => !node.closest('[hidden]') && !node.disabled);
            const first = controls[0], last = controls.at(-1);
            if (e.shiftKey && e.target === first) { e.preventDefault(); last?.focus(); }
            else if (!e.shiftKey && e.target === last) { e.preventDefault(); first?.focus(); }
        }
    };
    const listeners = [['input', onInput], ['compositionstart', onStart], ['compositionend', onEnd], ['click', onClick], ['keydown', onKey]];
    for (const [type, fn] of listeners) win.addEventListener(type, fn);
    const api = { sync, dispose() {
        if (main()) main().inert = false;
        for (const [type, fn] of listeners) win.removeEventListener(type, fn);
        bindings.delete(win);
    } };
    bindings.set(win, api);
    return api;
}
