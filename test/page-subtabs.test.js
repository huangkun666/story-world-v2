import test from 'node:test';
import assert from 'node:assert/strict';
import { bindPageSubtabs } from '../web/page-subtabs.js';

class Element {
    constructor(attrs = {}, children = []) {
        Object.assign(this, { attrs, children, hidden: false, scrollTop: 0 });
        for (const child of children) child.parent = this;
    }
    getAttribute(key) { return this.attrs[key] ?? null; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    matches(selector) { return selector === '.sw2-view' ? this.attrs.class === 'sw2-view' : Object.hasOwn(this.attrs, selector.slice(1, -1)); }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    focus() { this.focused = true; }
}

function page(scope) {
    const tabs = ['first', 'second', 'third'].map(key => new Element({ 'data-subtab': key }));
    const input = new Element({ 'data-control': '' }); input.value = '尚未提交的修改';
    const panels = tabs.map(tab => new Element({ 'data-subpanel': tab.getAttribute('data-subtab') }));
    panels[0].children.push(input); input.parent = panels[0];
    const root = new Element({ 'data-subtabs': scope }, [...tabs, ...panels]);
    return { view: new Element({ class: 'sw2-view' }, [root]), root, tabs, panels, input };
}

function fixture() {
    const params = page('params'), settings = page('settings');
    const win = new Element({}, [params.view, settings.view]);
    const handlers = {};
    win.addEventListener = (name, handler) => { assert.ok(!handlers[name], '绑定一次，避免重复触发'); handlers[name] = handler; };
    const api = bindPageSubtabs(win);
    return { win, api, handlers, params, settings };
}

test('子页签切换只改变显示，保留原控件、输入和两页独立状态', () => {
    const { win, api, handlers, params, settings } = fixture();
    assert.equal(bindPageSubtabs(win), api, '重复绑定返回同一控制器');
    const before = [...params.panels];
    params.view.scrollTop = 180;
    handlers.click({ target: params.tabs[1] });
    assert.deepEqual(params.panels.map(p => p.hidden), [true, false, true]);
    assert.deepEqual(params.panels, before, '切换不替换内容节点');
    assert.equal(params.input.value, '尚未提交的修改');
    assert.deepEqual(settings.panels.map(p => p.hidden), [false, true, true]);
    handlers.click({ target: params.tabs[0] });
    assert.equal(params.view.scrollTop, 180, '每个分类保留自己的滚动位置');
});

test('整页重绘后仍恢复用户选择的子页签', () => {
    const { win, api, handlers, params } = fixture();
    handlers.click({ target: params.tabs[2] });
    const fresh = page('params');
    win.children[0] = fresh.view; fresh.view.parent = win;
    api.sync();
    assert.deepEqual(fresh.panels.map(p => p.hidden), [true, true, false]);
    assert.equal(fresh.tabs[2].getAttribute('aria-selected'), 'true');
    assert.equal(fresh.tabs[2].tabIndex, 0);
    assert.equal(fresh.tabs[0].tabIndex, -1);
});

test('方向键循环切换，Home 和 End 定位首尾并移动焦点', () => {
    const { handlers, params } = fixture();
    let prevented = 0;
    const press = (key, tab) => handlers.keydown({ key, target: tab, preventDefault: () => prevented++ });
    press('ArrowLeft', params.tabs[0]);
    assert.equal(params.panels[2].hidden, false);
    assert.equal(params.tabs[2].focused, true);
    press('Home', params.tabs[2]); assert.equal(params.panels[0].hidden, false);
    press('End', params.tabs[0]); assert.equal(params.panels[2].hidden, false);
    press('ArrowRight', params.tabs[2]); assert.equal(params.panels[0].hidden, false);
    assert.equal(prevented, 4);
});
