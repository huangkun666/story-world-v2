import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { captureScrollPositions } from '../web/scroll-keep.js';

async function reader() {
    const url = new URL('../web/story-reader.js', import.meta.url);
    assert.ok(existsSync(url), '应提供独立故事阅读控制器');
    return import(url);
}

class Node {
    constructor(tag, attrs = {}, text = '', children = []) {
        Object.assign(this, { tagName: tag.toUpperCase(), attrs, ownText: text, children, hidden: 'hidden' in attrs, open: false, value: '', scrollTop: 0 });
        for (const c of children) c.parentElement = this;
        this.classList = { toggle: (name, on) => {
            const names = new Set((this.attrs.class || '').split(' ').filter(Boolean));
            const add = on ?? !names.has(name); if (add) names.add(name); else names.delete(name);
            this.attrs.class = [...names].join(' '); return add;
        }, contains: name => (this.attrs.class || '').split(' ').includes(name) };
    }
    get textContent() { return this.ownText + this.children.map(c => c.textContent).join(' '); }
    set textContent(v) { this.ownText = v; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    matches(selector) {
        if (selector.includes(',')) return selector.split(',').some(s => this.matches(s.trim()));
        if (selector.startsWith('#')) return this.attrs.id === selector.slice(1);
        if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
        const m = /^(\w+)?\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
        return m ? (!m[1] || this.tagName === m[1].toUpperCase()) && (m[2] === 'hidden' ? this.hidden : m[2] in this.attrs) && (m[3] === undefined || this.attrs[m[2]] === m[3]) : this.tagName === selector.toUpperCase();
    }
    querySelectorAll(selector) { return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    contains(node) { return this === node || this.children.some(c => c.contains(node)); }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    focus() { this.focused = true; }
    scrollIntoView() { this.scrolledIntoView = true; }
}
function fixture(name = '甲', empty = false, missing = false) {
    const row = (id, text, live) => new Node('button', { 'data-story-row': '', 'data-story-id': id, 'data-story-open': id, 'data-story-search': text, 'data-story-live': String(live) }, text);
    const a = row('a', '万法阁 江州 １级 剧情正文', true), b = row('b', '黄坤 东海 已收场', false);
    const input = new Node('input', { 'data-story-search-input': '' });
    const clear = new Node('button', { 'data-story-clear': '' });
    const box = new Node('div', { 'data-story-search-box': '', hidden: '' }, '', [input, clear]);
    const searchToggle = new Node('button', { 'data-story-search-toggle': '' });
    const recent = new Node('button', { 'data-story-view': 'recent' }), unresolved = new Node('button', { 'data-story-view': 'unresolved' });
    const results = new Node('span', { 'data-story-results': '' }), noResults = new Node('p', { 'data-story-no-results': '', hidden: '' });
    const background = new Node('details', { 'data-story-background': '' });
    const home = new Node('section', { 'data-story-home-panel': '' }, '', [background, recent, unresolved, searchToggle, box, results, ...(!empty ? [a, b] : []), noResults]);
    const back = new Node('button', { 'data-story-back': '' });
    const person = new Node('button', { 'data-story-context': 'e_a' });
    const chapter = new Node('section', { id: 'chapter-a' });
    const jump = new Node('button', { 'data-story-jump': 'chapter-a' });
    const detail = new Node('article', { 'data-story-detail': '', 'data-story-id': 'a', hidden: '' }, '', [back, person, jump, chapter]);
    const other = new Node('article', { 'data-story-detail': '', 'data-story-id': 'b', hidden: '' });
    const main = new Node('div', { class: 'sw2-merged-main sw2-story-scroll' }, '', [home, ...(!empty && !missing ? [detail, other] : [])]);
    const close = new Node('button', { 'data-story-close-context': '' });
    const context = new Node('section', { 'data-story-context-panel': '', 'data-story-context-id': 'e_a', hidden: '' });
    const worldInput = new Node('input', { 'data-story-world-input': '' });
    const worldA = new Node('button', { 'data-story-world-entry': '', 'data-story-context': 'e_a' }, '万法阁 势力');
    const worldB = new Node('button', { 'data-story-world-entry': '', 'data-story-context': 'loc:东海' }, '东海 地点');
    const worldPanel = new Node('section', { 'data-story-world-panel': '', hidden: '' }, '', [worldInput, worldA, worldB]);
    const drawer = new Node('aside', { 'data-story-drawer': '', hidden: '' }, '', [close, context, worldPanel]);
    const worldButton = new Node('button', { 'data-story-world': '' }), homeButton = new Node('button', { 'data-story-home': '' });
    const app = new Node('div', { 'data-story-app': '', 'data-pan-world': name }, '', [worldButton, homeButton, main, drawer]);
    const page = new Node('section', { id: 'sw2_view_panorama' }, '', [app]);
    return { page, app, a, b, input, clear, searchToggle, box, recent, unresolved, results, noResults, home, detail, other, back, person, chapter, jump, main, close, context, worldPanel, drawer, worldButton, homeButton, background, worldInput, worldA, worldB };
}
async function mount(f) {
    const { bindStoryReader } = await reader();
    const win = new Node('div', {}, '', [f.page]), listeners = new Map();
    win.addEventListener = (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); };
    win.removeEventListener = (type, fn) => listeners.set(type, (listeners.get(type) || []).filter(x => x !== fn));
    const api = bindStoryReader(win); api.sync('chat-a');
    const emit = (type, target, extra = {}) => { for (const fn of listeners.get(type) || []) fn({ target, preventDefault() {}, ...extra }); };
    const replace = (next, scope = 'chat-a') => { const keep = captureScrollPositions(win.querySelector('#sw2_view_panorama')); win.children = [next.page]; next.page.parentElement = win; return api.sync(scope, keep); };
    return { win, api, emit, replace };
}

test('首页进入独立故事，返回恢复列表位置和筛选', async () => {
    const f = fixture(); const { emit } = await mount(f);
    emit('click', f.unresolved); emit('click', f.searchToggle);
    f.input.value = '江州 1级'; emit('input', f.input);
    assert.equal(f.a.hidden, false); assert.equal(f.b.hidden, true);
    f.main.scrollTop = 172; emit('click', f.a);
    assert.equal(f.home.hidden, true); assert.equal(f.detail.hidden, false); assert.equal(f.other.hidden, true); assert.equal(f.main.scrollTop, 0);
    f.main.scrollTop = 95; emit('click', f.back);
    assert.equal(f.home.hidden, false); assert.equal(f.detail.hidden, true); assert.equal(f.main.scrollTop, 172); assert.equal(f.input.value, '江州 1级');
    emit('click', f.a); assert.equal(f.main.scrollTop, 95);
});
test('说明按需打开，Escape 恢复控件，查世界与说明互斥', async () => {
    const f = fixture(); const { emit } = await mount(f);
    emit('click', f.a); emit('click', f.person);
    assert.equal(f.drawer.hidden, false); assert.equal(f.context.hidden, false); assert.equal(f.worldPanel.hidden, true); assert.equal(f.main.inert, true);
    emit('keydown', f.close, { key: 'Escape' });
    assert.equal(f.drawer.hidden, true); assert.equal(f.main.inert, false); assert.equal(f.person.focused, true);
    emit('click', f.worldButton); assert.equal(f.worldPanel.hidden, false); assert.equal(f.context.hidden, true);
    emit('click', f.close); assert.equal(f.drawer.hidden, true);
});
test('同世界刷新恢复故事、说明、阅读位置与搜索，换聊天重置', async () => {
    const f = fixture(); const { emit, replace } = await mount(f);
    emit('click', f.searchToggle); f.input.value = '万法阁'; emit('input', f.input); emit('click', f.a); emit('click', f.person); f.main.scrollTop = 91;
    const next = fixture(); assert.equal(replace(next), true);
    assert.equal(next.detail.hidden, false); assert.equal(next.context.hidden, false); assert.equal(next.main.scrollTop, 91); assert.equal(next.input.value, '万法阁');
    const otherChat = fixture(); assert.equal(replace(otherChat, 'chat-b'), false);
    assert.equal(otherChat.home.hidden, false); assert.equal(otherChat.drawer.hidden, true); assert.equal(otherChat.input.value, ''); assert.equal(otherChat.main.scrollTop, 0);
});
test('空窗口不丢故事意图，内容回来后恢复故事与阅读位置', async () => {
    const f = fixture(); const { emit, replace } = await mount(f);
    emit('click', f.a); f.main.scrollTop = 139;
    const empty = fixture('甲', true); replace(empty); assert.equal(empty.home.hidden, false);
    const emptyAgain = fixture('甲', true); replace(emptyAgain);
    const next = fixture(); replace(next); assert.equal(next.detail.hidden, false); assert.equal(next.main.scrollTop, 139);
    const otherWorld = fixture('乙'); replace(otherWorld); assert.equal(otherWorld.home.hidden, false);
});
test('输入法组合不筛选；搜索清空不改变未结视图，故事跳转限于当前正文', async () => {
    const f = fixture(); const { emit } = await mount(f);
    emit('click', f.unresolved); emit('compositionstart', f.input); f.input.value = '不存在'; emit('input', f.input, { isComposing: true }); assert.equal(f.a.hidden, false);
    emit('compositionend', f.input); assert.equal(f.a.hidden, true); assert.equal(f.noResults.hidden, false);
    emit('click', f.clear); assert.equal(f.a.hidden, false); assert.equal(f.b.hidden, true); assert.equal(f.input.value, '');
    emit('click', f.a); emit('click', f.jump); assert.equal(f.chapter.scrolledIntoView, true);
});
test('绑定幂等、范围隔离，恶意故事或说明键不会解释为选择器', async () => {
    const f = fixture(); const { win, api, emit } = await mount(f); const { bindStoryReader } = await reader();
    assert.equal(bindStoryReader(win), api);
    emit('click', new Node('button', { 'data-story-open': 'a' })); assert.equal(f.home.hidden, false);
    f.a.setAttribute('data-story-open', '"][data-story-id="b'); emit('click', f.a); assert.equal(f.home.hidden, false); assert.equal(f.other.hidden, true);
    api.dispose(); assert.notEqual(bindStoryReader(win), api);
});

test('说明刷新后保留抽屉位置和焦点，遮罩关闭返回控件', async () => {
    const f = fixture(); const { emit, replace } = await mount(f);
    emit('click', f.a); emit('click', f.person); f.drawer.scrollTop = 66;
    const next = fixture(); replace(next);
    assert.equal(next.drawer.scrollTop, 66); assert.equal(next.close.focused, true);
    emit('click', next.app);
    assert.equal(next.drawer.hidden, true); assert.equal(next.person.focused, true);
});

test('世界名册字面检索支持输入法和刷新恢复，换聊天清空', async () => {
    const f = fixture(); const { emit, replace } = await mount(f);
    emit('click', f.worldButton); emit('compositionstart', f.worldInput);
    f.worldInput.value = '万法'; emit('input', f.worldInput, { isComposing: true }); assert.equal(f.worldB.hidden, false);
    emit('compositionend', f.worldInput); assert.equal(f.worldA.hidden, false); assert.equal(f.worldB.hidden, true);
    const next = fixture(); replace(next); assert.equal(next.worldInput.value, '万法'); assert.equal(next.worldB.hidden, true);
    const other = fixture(); replace(other, 'chat-b'); assert.equal(other.worldInput.value, ''); assert.equal(other.worldB.hidden, false);
});

test('说明栏 Escape 不冒泡到宿主的整窗关闭处理', async () => {
    const f = fixture(); const { emit } = await mount(f); let stopped = false;
    emit('click', f.a); emit('click', f.person);
    emit('keydown', f.close, { key: 'Escape', stopPropagation() { stopped = true; } });
    assert.equal(f.drawer.hidden, true); assert.equal(stopped, true);
});
