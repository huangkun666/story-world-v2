import test from 'node:test';
import assert from 'node:assert/strict';
import { bindSettingReader, settingQueryMatches } from '../web/setting-reader.js';

// Small DOM adapter: exercise delegated events and replacement without a browser dependency.
class Node {
    constructor(tag, attrs = {}, text = '', children = []) {
        Object.assign(this, { tagName: tag.toUpperCase(), attrs, ownText: text, children, hidden: false, open: false, value: '' });
        for (const child of children) child.parentElement = this;
    }
    get textContent() { return this.ownText + this.children.map((c) => c.textContent).join(' '); }
    set textContent(text) { this.ownText = text; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    matches(selector) {
        const match = /^(\w+)?\[([^\]]+)\]$/.exec(selector);
        return !!match && (!match[1] || this.tagName === match[1].toUpperCase()) && match[2] in this.attrs;
    }
    querySelectorAll(selector) { return this.children.flatMap((c) => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    contains(node) { return this === node || this.children.some((c) => c.contains(node)); }
}
function fixture(world = '甲') {
    const entry = (id, text) => new Node('details', { 'data-setting-entry': id, 'data-setting-key': id }, text);
    const a = entry('a', '灵力 入门 １级 <script>');
    const b = entry('b', '战力 Apex 二阶');
    const group = new Node('details', { 'data-setting-group': '', 'data-setting-key': 'group' }, '', [a, b]);
    const scales = new Node('details', { 'data-setting-section': '', 'data-setting-key': 'scales' }, '', [group]);
    const history = new Node('details', { 'data-setting-section': '', 'data-setting-key': 'history' }, '', [new Node('p', { 'data-setting-entry': 'h' }, '帝国建立')]);
    const input = new Node('input', { 'data-setting-search': '' });
    const clear = new Node('button', { 'data-setting-clear': '' });
    const result = new Node('span', { 'data-setting-results': '' });
    const root = new Node('div', { 'data-setting-reader': world }, '', [input, clear, result, scales, history]);
    return { root, input, clear, result, scales, history, group, a, b };
}
function mount(f) {
    const win = new Node('div', {}, '', [f.root]);
    const handlers = new Map();
    win.addEventListener = (type, fn) => handlers.set(type, fn);
    win.removeEventListener = (type) => handlers.delete(type);
    const api = bindSettingReader(win);
    const emit = (type, target, extra = {}) => handlers.get(type)?.({ target, ...extra });
    return { win, api, emit };
}
test('setting search normalizes width/case, uses literal AND terms, and permits punctuation', () => {
    assert.ok(settingQueryMatches('力量 Apex １级', 'apex 1级'));
    assert.ok(settingQueryMatches('灵力 <script>', '<script>'));
    assert.ok(settingQueryMatches('任何原文', ' \n '));
    assert.ok(!settingQueryMatches('力量 Apex', 'apex 灵力'));
    assert.ok(!settingQueryMatches('灵力', '.*'));
});
test('search finds hidden tier text, opens its ancestors, and clear restores manual disclosure state', () => {
    const f = fixture(); f.history.open = true;
    const { emit } = mount(f);
    f.input.value = '入门 1级'; emit('input', f.input);
    assert.ok(f.scales.open && f.group.open && f.a.open);
    assert.equal(f.b.hidden, true); assert.equal(f.history.hidden, true);
    assert.equal(f.result.textContent, '1 项结果');
    emit('click', f.clear);
    assert.equal(f.input.value, ''); assert.equal(f.a.hidden, false); assert.equal(f.b.hidden, false);
    assert.equal(f.scales.open, false); assert.equal(f.group.open, false); assert.equal(f.a.open, false);
    assert.equal(f.history.open, true);
});
test('unmatched query reports empty results and an IME composition does not filter before commit', () => {
    const f = fixture(); const { emit } = mount(f);
    emit('compositionstart', f.input); f.input.value = '不存在'; emit('input', f.input, { isComposing: true });
    assert.equal(f.scales.hidden, false); assert.equal(f.a.hidden, false);
    emit('compositionend', f.input);
    assert.equal(f.scales.hidden, true); assert.equal(f.history.hidden, true);
    assert.equal(f.result.textContent, '未找到匹配内容');
});
test('replacement preserves query and clear-state in the same world, but switching worlds resets them', () => {
    const f = fixture(); f.history.open = true;
    const { win, api, emit } = mount(f);
    f.input.value = 'apex'; emit('input', f.input);
    const next = fixture(); win.children = [next.root]; api.sync();
    assert.equal(next.input.value, 'apex'); assert.equal(next.b.open, true); assert.equal(next.a.hidden, true);
    emit('click', next.clear);
    assert.equal(next.history.open, true); assert.equal(next.scales.open, false);
    next.input.value = '帝国'; emit('input', next.input);
    const other = fixture('乙'); win.children = [other.root]; api.sync();
    assert.equal(other.input.value, ''); assert.equal(other.scales.hidden, false); assert.equal(other.history.open, false);
});
test('binding is idempotent and unrelated controls do not affect reading', () => {
    const f = fixture(); const { win, api, emit } = mount(f);
    assert.equal(bindSettingReader(win), api);
    emit('input', new Node('input', {}, 'apex'));
    assert.equal(f.scales.hidden, false); assert.equal(f.b.open, false);
    api.dispose(); assert.notEqual(bindSettingReader(win), api);
});
test('source names are searchable even when they do not appear in the table text', () => {
    const f = fixture(); f.a.attrs['data-setting-source'] = '原文条目甲';
    const { emit } = mount(f);
    f.input.value = '原文条目甲'; emit('input', f.input);
    assert.equal(f.a.hidden, false); assert.equal(f.b.hidden, true);
    assert.ok(f.group.open && f.a.open);
});
