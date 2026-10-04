import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { renderAll } from '../src/render.js';
import { mergedMainHtml } from '../web/page-compose.js';
import { createParamApi } from '../web/param-panel.js';
import { captureScrollPositions } from '../web/scroll-keep.js';

const moduleUrl = new URL('../web/panorama-reader.js', import.meta.url);
async function reader() {
    assert.ok(existsSync(moduleUrl), '观棋阅读模块应提供过滤和刷新恢复');
    return import(moduleUrl);
}

test('观棋生产组合保留正文和附层，提供独立故事与世界查询', () => {
    const world = { meta: { tick: 3 }, entities: [], agendas: [], weights: {}, chronicle: [], milestones: [],
        context: { world: '测试世界', positions: ['江州城'] },
        events: [{ id: 'ev_1_1', title: '江州议事', source: { type: 'state' }, position: '江州城', ripples: [], links: {}, closed: false }] };
    const out = renderAll(world);
    const html = mergedMainHtml(out);
    for (const control of ['search-input', 'view', 'world', 'back']) assert.match(html, new RegExp(`data-story-${control}`));
    assert.match(html, /data-story-world-panel hidden/);
    assert.match(html, /data-pan-world="测试世界"/);
    for (const name of ['sw2-infoband', 'sw2-agenda-strip', 'sw2-map-entry']) assert.equal(html.split(name).length - 1, 1);
    assert.equal(html.split('data-action="open-map"').length - 1, 1);
    assert.equal(html, out.panorama.replace('<!-- STORY_WORLD_ATTACH -->', out.board.infoband + out.board.agendaStrip + out.board.side), '正文完整，附层只装入查询区域');
    assert.ok(!html.includes('data-action="pan-'), '阅读工具不进入引擎动作总线');
});

// DOM adapter for real delegated listeners and node replacement; layout is checked in Chrome.
class Node {
    constructor(tag, attrs = {}, text = '', children = []) {
        Object.assign(this, { tagName: tag.toUpperCase(), attrs, ownText: text, children, hidden: false, open: false, value: '', checked: false, scrollTop: 0 });
        for (const child of children) child.parentElement = this;
        this.classList = { toggle: (name, on) => {
            const names = new Set((this.attrs.class || '').split(' ').filter(Boolean));
            const add = on ?? !names.has(name); if (add) names.add(name); else names.delete(name);
            this.attrs.class = [...names].join(' '); return add;
        }, contains: (name) => (this.attrs.class || '').split(' ').includes(name) };
    }
    get textContent() { return this.ownText + this.children.map((c) => c.textContent).join(' '); }
    set textContent(value) { this.ownText = value; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    matches(selector) {
        if (selector.includes(',')) return selector.split(',').some((s) => this.matches(s.trim()));
        if (selector.startsWith('#')) return this.attrs.id === selector.slice(1);
        if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
        const attr = /^(\w+)?\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
        return attr ? (!attr[1] || this.tagName === attr[1].toUpperCase()) && attr[2] in this.attrs && (attr[3] === undefined || this.attrs[attr[2]] === attr[3]) : this.tagName === selector.toUpperCase();
    }
    querySelectorAll(selector) { return this.children.flatMap((c) => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    contains(node) { return this === node || this.children.some((c) => c.contains(node)); }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    focus() { this.focused = true; }
}
function fixture(world = '甲') {
    const story = (key, title, live) => new Node('details', { 'data-pan-entry': '', 'data-pan-key': key, 'data-pan-live': String(live) }, title);
    const a = story('江州:a', '万法阁 分为两派 １级', true);
    const b = story('江州:b', '黄坤 入城', false);
    const face = new Node('div', { 'data-pan-group': '', 'data-pan-place': '江州城' }, '', [a, b]);
    const c = story('东海:c', '万法阁 抵达东海', true);
    const other = new Node('div', { 'data-pan-group': '', 'data-pan-place': '东海浮空岛' }, '', [c]);
    const input = new Node('input', { 'data-pan-search': '' });
    const location = new Node('select', { 'data-pan-location': '' });
    const unresolved = new Node('input', { 'data-pan-unresolved': '' });
    const clear = new Node('button', { 'data-pan-clear': '' });
    const sideButton = new Node('button', { 'data-pan-side': '' });
    const focusButton = new Node('button', { 'data-pan-focus': '' });
    const results = new Node('span', { 'data-pan-results': '' });
    const overview = new Node('details', { 'data-pan-key': 'overview', 'data-pan-overview': '' });
    const premise = new Node('div', { 'data-pan-aux': '' });
    const marker = new Node('div', { 'data-pan-world': world });
    const main = new Node('div', { class: 'sw2-merged-main' }, '', [marker, premise, face, other]);
    const side = new Node('div', { class: 'sw2-merged-side' });
    const grid = new Node('div', { class: 'sw2-merged-grid' }, '', [main, side]);
    const page = new Node('section', { id: 'sw2_view_panorama' }, '', [overview, input, location, unresolved, clear, sideButton, focusButton, results, grid]);
    return { page, a, b, c, face, other, input, location, unresolved, clear, sideButton, focusButton, results, overview, premise, main, side };
}
async function mount(f) {
    const { bindPanoramaReader } = await reader();
    const win = new Node('div', {}, '', [f.page]); const listeners = new Map();
    win.addEventListener = (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); };
    win.removeEventListener = (type, fn) => listeners.set(type, (listeners.get(type) || []).filter((l) => l !== fn));
    const api = bindPanoramaReader(win); api.sync('chat-a');
    const emit = (type, target, extra = {}) => { for (const fn of listeners.get(type) || []) fn({ target, ...extra }); };
    const replace = (next, scope = 'chat-a') => { const keep = captureScrollPositions(win.querySelector('#sw2_view_panorama')); win.children = [next.page]; api.sync(scope, keep); };
    return { win, api, emit, replace };
}

test('观棋字面多词检索支持全半角、大小写，标点不作正则', async () => {
    const { panoramaQueryMatches: matches } = await reader();
    assert.ok(matches('江州 万法阁 １级 Apex', '万法阁 1级 apex'));
    assert.ok(matches('灵力 <script>', '<script>'));
    assert.ok(matches('任何正文', ' \n '));
    assert.ok(!matches('万法阁', '.*'));
    assert.ok(!matches('江州 万法阁', '万法阁 东海'));
});
test('观棋搜索包含地点与正文，命中展开，清空恢复手动展开状态', async () => {
    const f = fixture(); f.b.open = true; const { emit } = await mount(f);
    f.input.value = '江州 1级'; emit('input', f.input);
    assert.equal(f.a.hidden, false); assert.equal(f.a.open, true); assert.equal(f.b.hidden, true); assert.equal(f.other.hidden, true);
    assert.match(f.results.textContent, /1/);
    emit('click', f.clear);
    assert.equal(f.a.open, false); assert.equal(f.b.open, true); assert.equal(f.other.hidden, false); assert.equal(f.input.value, '');
});
test('观棋未结筛选和地点可组合，重置显示所有故事且不改变线状态', async () => {
    const f = fixture(); const { emit } = await mount(f);
    f.unresolved.checked = true; emit('change', f.unresolved);
    assert.equal(f.b.hidden, true); assert.equal(f.a.hidden, false);
    f.location.value = '东海浮空岛'; emit('change', f.location);
    assert.equal(f.face.hidden, true); assert.equal(f.c.hidden, false);
    emit('click', f.clear);
    assert.equal(f.b.hidden, false); assert.equal(f.face.hidden, false); assert.equal(f.unresolved.checked, false); assert.equal(f.location.value, '');
    assert.equal(f.b.getAttribute('data-pan-live'), 'false');
});
test('观棋输入法组合期间不筛选，组合结束后报告零结果', async () => {
    const f = fixture(); const { emit } = await mount(f);
    emit('compositionstart', f.input); f.input.value = '不存在'; emit('input', f.input, { isComposing: true });
    assert.equal(f.face.hidden, false); assert.equal(f.a.hidden, false);
    emit('compositionend', f.input); assert.equal(f.face.hidden, true); assert.match(f.results.textContent, /未找到/);
});
test('盘算收起与专注阅读可恢复原来辅助区状态', async () => {
    const f = fixture(); f.overview.open = true; const { emit } = await mount(f);
    emit('click', f.sideButton); assert.equal(f.side.hidden, true);
    emit('click', f.focusButton); assert.equal(f.overview.hidden, true); assert.equal(f.premise.hidden, true);
    emit('click', f.focusButton); assert.equal(f.overview.hidden, false); assert.equal(f.overview.open, true); assert.equal(f.side.hidden, true);
    emit('click', f.sideButton); assert.equal(f.side.hidden, false); assert.equal(f.sideButton.getAttribute('aria-expanded'), 'true');
});
test('观棋同世界重绘保留筛选与清空前状态，切聊天或世界重置', async () => {
    const f = fixture(); f.b.open = true; const { emit, replace } = await mount(f);
    f.input.value = '万法阁'; emit('input', f.input); emit('click', f.focusButton);
    const next = fixture(); replace(next);
    assert.equal(next.input.value, '万法阁'); assert.equal(next.a.open, true); assert.equal(next.b.hidden, true); assert.equal(next.side.hidden, true);
    emit('click', next.clear); assert.equal(next.a.open, false); assert.equal(next.b.open, true);
    const otherChat = fixture(); replace(otherChat, 'chat-b');
    assert.equal(otherChat.input.value, ''); assert.equal(otherChat.b.open, false); assert.equal(otherChat.side.hidden, false);
    otherChat.a.open = true;
    const otherWorld = fixture('乙'); replace(otherWorld, 'chat-b'); assert.equal(otherWorld.a.open, false);
});
test('观棋重绘保留手动折叠的故事与现状，不复用旧聊天滚动', async () => {
    const f = fixture(); const { api, replace } = await mount(f); f.a.open = true; f.overview.open = true;
    const next = fixture(); replace(next); assert.equal(next.a.open, true); assert.equal(next.overview.open, true);
    assert.equal(api.sync('chat-a'), true);
    assert.equal(api.sync('chat-b'), false);
});
test('观棋绑定幂等，输入与按钮不会触发非本页的阅读状态', async () => {
    const f = fixture(); const { win, api, emit } = await mount(f); const { bindPanoramaReader } = await reader();
    assert.equal(bindPanoramaReader(win), api);
    const outsider = new Node('input', { 'data-pan-search': '' }); outsider.value = '不存在'; emit('input', outsider);
    assert.equal(f.face.hidden, false);
    emit('click', new Node('button', { 'data-pan-focus': '' })); assert.equal(f.side.hidden, false);
    api.dispose(); assert.notEqual(bindPanoramaReader(win), api);
});
test('观棋检索定位到结果，清空后恢复检索前的滚动位置', async () => {
    const f = fixture(); const { emit } = await mount(f); f.main.scrollTop = 140; f.page.scrollTop = 80;
    f.input.value = '万法阁'; emit('input', f.input);
    assert.equal(f.main.scrollTop, 0); assert.equal(f.page.scrollTop, 0);
    emit('click', f.clear);
    assert.equal(f.main.scrollTop, 140); assert.equal(f.page.scrollTop, 80);
});
test('观棋输入与原生地点选择受现有刷新保护，避免销毁输入法与下拉', () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const api = createParamApi({ freshCtx: () => ({}), sw2ExtensionSettings: () => ({}), sw2LocalStore: () => null, getLastWorld: () => null });
    try {
        for (const [tag, attr] of [['input', 'data-pan-search'], ['select', 'data-pan-location']]) {
            Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: new Node(tag, { [attr]: '' }) } });
            assert.equal(api.playerIsTouchingParams(), true, attr);
        }
    } finally { if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document; }
});
test('近期空态保留世界标识，并在故事回来后恢复展开、盘算和阅读位置', async () => {
    const emptyWorld = { meta: { tick: 3 }, entities: [], agendas: [], weights: {}, chronicle: [], milestones: [],
        context: { world: '甲', positions: [] }, events: [] };
    assert.match(mergedMainHtml(renderAll(emptyWorld)), /data-pan-world="甲"/);
    const f = fixture(); const { emit, replace } = await mount(f); f.a.open = true; f.main.scrollTop = 140;
    emit('click', f.sideButton);
    const empty = fixture(); empty.face.children = []; empty.other.children = []; replace(empty);
    const next = fixture(); replace(next);
    assert.equal(next.a.open, true); assert.equal(next.side.hidden, true); assert.equal(next.main.scrollTop, 140);
    next.input.value = '万法阁'; emit('input', next.input);
    const emptyAgain = fixture(); emptyAgain.face.children = []; emptyAgain.other.children = []; replace(emptyAgain);
    const returnAgain = fixture(); replace(returnAgain); assert.equal(returnAgain.input.value, '万法阁');
});
test('人物检索包含生产紧凑行省略的人物，来源是已有故事的名单', async () => {
    const world = { meta: { tick: 3 }, entities: [{ id: 'e_1_1', name: '张三', kind: 'character', location: '江州城' }],
        agendas: [], weights: {}, chronicle: [], milestones: [], context: { world: '甲', positions: ['江州城'] },
        events: [{ id: 'ev_1_1', title: '江州议事', source: { type: 'state' }, position: '江州城', ripples: ['e_1_1'], links: {}, closed: false }] };
    assert.match(renderAll(world).panorama, /data-story-search="[^"]*张三/);
    const f = fixture(); f.a.attrs['data-pan-people'] = '张三'; const { emit } = await mount(f);
    f.input.value = '张三'; emit('input', f.input); assert.equal(f.a.hidden, false); assert.equal(f.b.hidden, true);
});

test('初始空窗口与空窗口之间刷新保留侧栏和页面滚动', async () => {
    const empty = fixture(); empty.face.children = []; empty.other.children = [];
    const { replace } = await mount(empty); empty.side.scrollTop = 120; empty.page.scrollTop = 80;
    const next = fixture(); next.face.children = []; next.other.children = []; replace(next);
    assert.equal(next.side.scrollTop, 120); assert.equal(next.page.scrollTop, 80);
    next.side.scrollTop = 240;
    const stories = fixture(); replace(stories);
    assert.equal(stories.side.scrollTop, 240); assert.equal(stories.page.scrollTop, 80);
});

test('单事件盘算故事的主使即使不在牵动名单也能被检索', () => {
    const world = { meta: { tick: 3 }, entities: [{ id: 'e_1_1', name: '张三', kind: 'character' }],
        agendas: [{ id: 'a_1_1', owner: 'e_1_1', goal: '查清幕后黑手', status: 'active', steps: [], currentStep: 0 }],
        weights: {}, chronicle: [], milestones: [], context: { world: '甲', positions: [] },
        events: [{ id: 'ev_1_1', title: '追查线索', source: { type: 'plot', ref: 'a_1_1' }, ripples: [], links: {}, closed: false }] };
    assert.match(renderAll(world).panorama, /<button[^>]*data-story-row[^>]*data-story-search="[^"]*张三/);
});

test('在空窗口开始搜索，故事回来时展开命中且清空恢复原来的手动状态', async () => {
    const f = fixture(); f.b.open = true; const { emit, replace } = await mount(f);
    const empty = fixture(); empty.face.children = []; empty.other.children = []; replace(empty);
    empty.input.value = '万法阁'; emit('input', empty.input);
    const next = fixture(); replace(next);
    assert.equal(next.a.open, true); assert.equal(next.b.hidden, true);
    next.a.open = false; emit('click', next.clear);
    assert.equal(next.a.open, false); assert.equal(next.b.open, true);
});
