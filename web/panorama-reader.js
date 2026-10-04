// Temporary reading state only. No world, configuration, or model writes.
import { captureScrollPositions, restoreScrollPositions } from './scroll-keep.js';
import { bindStoryReader } from './story-reader.js';
const bindings = new WeakMap();
const normalized = (text) => String(text ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();

export function panoramaQueryMatches(text, query) {
    const haystack = normalized(text);
    return normalized(query).split(' ').filter(Boolean).every((term) => haystack.includes(term));
}

export function bindPanoramaReader(win) {
    if (win.querySelector('[data-story-app]')) {
        bindings.get(win)?.dispose();
        return bindStoryReader(win);
    }
    if (bindings.has(win)) return bindings.get(win);
    let page = null, marker = null, identity = null, tracked = [], hadEntries = false;
    let query = '', location = '', unresolved = false, composing = false;
    let sideVisible = true, focus = false, openState = new Map(), lastOpen = new Map(), lastFilter = null, savedScroll = null, beforeFilter = null, beforeScroll = null;
    const active = () => !!(normalized(query) || location || unresolved);
    const filterKey = () => JSON.stringify([query, location, unresolved]);
    const capture = () => new Map(tracked.map((el) => [el.getAttribute('data-pan-key'), el.open]));
    function restore(state) {
        for (const el of tracked) if (state.has(el.getAttribute('data-pan-key'))) el.open = state.get(el.getAttribute('data-pan-key'));
    }
    function applyReading() {
        if (!page) return;
        const side = page.querySelector('.sw2-merged-side');
        const showSide = sideVisible && !focus;
        if (side) side.hidden = !showSide;
        page.classList.toggle('sw2-pan-side-hidden', !showSide);
        for (const el of page.querySelectorAll('[data-pan-overview], [data-pan-aux]')) el.hidden = focus;
        const sideButton = page.querySelector('[data-pan-side]');
        if (sideButton) { sideButton.textContent = showSide ? '收起盘算' : '显示盘算'; sideButton.setAttribute('aria-expanded', String(showSide)); }
        const focusButton = page.querySelector('[data-pan-focus]');
        if (focusButton) { focusButton.textContent = focus ? '退出专注' : '专注阅读'; focusButton.setAttribute('aria-pressed', String(focus)); }
    }
    function applyFilter() {
        if (!page) return;
        const filtering = active();
        let count = 0;
        for (const entry of page.querySelectorAll('[data-pan-entry]')) {
            const group = entry.closest('[data-pan-group]');
            const place = entry.getAttribute('data-pan-place') || group?.getAttribute('data-pan-place') || '';
            entry.hidden = (location && place !== location)
                || (unresolved && entry.getAttribute('data-pan-live') !== 'true')
                || !panoramaQueryMatches(`${place} ${entry.getAttribute('data-pan-people') || ''} ${entry.textContent}`, query);
            if (!entry.hidden) {
                count++;
                if (normalized(query) && entry.tagName === 'DETAILS') entry.open = true;
            }
        }
        for (const group of page.querySelectorAll('[data-pan-group]')) {
            group.hidden = filtering && !Array.from(group.querySelectorAll('[data-pan-entry]')).some((el) => !el.hidden);
        }
        const result = page.querySelector('[data-pan-results]');
        if (result) result.textContent = filtering ? (count ? `${count} 项结果` : '未找到匹配故事') : '';
        const clear = page.querySelector('[data-pan-clear]');
        if (clear) clear.hidden = !filtering;
    }
    function sync(scope = '', scroll = null) {
        const nextPage = win.querySelector('#sw2_view_panorama');
        const nextMarker = nextPage?.querySelector('[data-pan-world]') || null;
        const nextIdentity = JSON.stringify([scope ?? '', nextMarker?.getAttribute('data-pan-world') ?? '']);
        const sameWorld = identity === nextIdentity;
        if (nextMarker === marker && nextPage === page && sameWorld) return true;
        const previousHadEntries = hadEntries;
        const currentOpen = capture();
        // Empty recent windows retain the previous stories' state until stories return.
        if (hadEntries) {
            lastOpen = currentOpen;
            lastFilter = filterKey();
            if (!active()) openState = currentOpen;
            if (sameWorld && scroll) savedScroll = scroll;
        } else {
            for (const [key, value] of currentOpen) { lastOpen.set(key, value); if (!active()) openState.set(key, value); }
        }
        page = nextPage; marker = nextMarker; identity = nextIdentity;
        tracked = Array.from(page?.querySelectorAll('details[data-pan-key]') || []);
        if (!sameWorld) {
            query = ''; location = ''; unresolved = false; composing = false;
            sideVisible = true; focus = false; openState = new Map(); lastOpen = new Map(); lastFilter = null; savedScroll = null; beforeFilter = null; beforeScroll = null;
            if (page) page.scrollTop = 0;
        }
        if (!page) return sameWorld;
        const input = page.querySelector('[data-pan-search]');
        if (input) input.value = query;
        const places = page.querySelector('[data-pan-location]');
        if (places) {
            places.value = location;
            // A location may disappear when events slide out of the viewing window.
            if (places.value !== location) location = places.value;
        }
        const onlyOpen = page.querySelector('[data-pan-unresolved]');
        if (onlyOpen) onlyOpen.checked = unresolved;
        restore(openState); applyFilter();
        if (sameWorld && active() && lastFilter === filterKey()) restore(lastOpen);
        applyReading();
        hadEntries = !!page.querySelector('[data-pan-entry]');
        if (sameWorld) {
            // Side scroll always follows the current sidebar; only the story surface returns to its saved position.
            const backFromEmpty = !previousHadEntries && hadEntries && savedScroll;
            restoreScrollPositions(page, backFromEmpty ? { ...scroll, page: savedScroll.page, 'sw2-merged-main': savedScroll['sw2-merged-main'] } : scroll);
        }
        return sameWorld;
    }
    function updateFilters(read) {
        const wasActive = active();
        if (!wasActive) {
            const current = capture();
            if (hadEntries) openState = current;
            else for (const [key, value] of current) openState.set(key, value);
            beforeScroll = captureScrollPositions(page);
        }
        read();
        if (!wasActive && active()) beforeFilter = new Map(openState);
        if (wasActive && !active()) { restore(beforeFilter || openState); beforeFilter = null; }
        applyFilter();
        if (active()) {
            page.scrollTop = 0;
            const main = page.querySelector('.sw2-merged-main'); if (main) main.scrollTop = 0;
        } else if (wasActive) { restoreScrollPositions(page, beforeScroll); beforeScroll = null; }
    }
    const within = (target) => !!page?.contains(target);
    const onInput = (e) => {
        if (!within(e.target) || !e.target.matches?.('[data-pan-search]') || composing || e.isComposing) return;
        updateFilters(() => { query = e.target.value; });
    };
    const onChange = (e) => {
        if (!within(e.target)) return;
        if (e.target.matches?.('[data-pan-location]')) updateFilters(() => { location = e.target.value; });
        if (e.target.matches?.('[data-pan-unresolved]')) updateFilters(() => { unresolved = e.target.checked; });
    };
    const onStart = (e) => { if (within(e.target) && e.target.matches?.('[data-pan-search]')) composing = true; };
    const onEnd = (e) => {
        if (!within(e.target) || !e.target.matches?.('[data-pan-search]')) return;
        composing = false; onInput(e);
    };
    const onClick = (e) => {
        if (!within(e.target)) return;
        const button = e.target.closest?.('[data-pan-clear], [data-pan-side], [data-pan-focus]');
        if (!button) return;
        if (button.matches('[data-pan-clear]')) {
            updateFilters(() => { query = ''; location = ''; unresolved = false; });
            const input = page.querySelector('[data-pan-search]');
            if (input) { input.value = ''; input.focus(); }
            const places = page.querySelector('[data-pan-location]'); if (places) places.value = '';
            const onlyOpen = page.querySelector('[data-pan-unresolved]'); if (onlyOpen) onlyOpen.checked = false;
        }
        if (button.matches('[data-pan-side]')) { sideVisible = focus || !sideVisible; focus = false; applyReading(); }
        if (button.matches('[data-pan-focus]')) { focus = !focus; applyReading(); }
    };
    const listeners = [['input', onInput], ['change', onChange], ['compositionstart', onStart], ['compositionend', onEnd], ['click', onClick]];
    for (const [type, fn] of listeners) win.addEventListener(type, fn);
    const api = { sync, dispose() {
        for (const [type, fn] of listeners) win.removeEventListener(type, fn);
        bindings.delete(win);
    } };
    bindings.set(win, api);
    return api;
}
