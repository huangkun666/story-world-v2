import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMapHtml } from '../src/map-view.js';
import { createMapPopupHub } from '../web/map-reader.js';
const world = () => ({ context: { setting: { frozen: { canon: { geography: { version: 1, places: [{ id: 'p1', name: '大厅', aliases: ['殿堂'] }, { id: 'p2', name: '城' }], links: [{ from: 'p1', to: 'p2', type: 'within' }] } } } } }, entities: [{ id: 'e1', name: '访客', location: '大厅' }, { id: 'e2', name: '无处客' }], events: [{ id: 'v1', title: '来信' }], meta: { entityFields: { e1: { 位置来源: '结构推导' } } } });
function documentFake() {
    const listeners = new Map();
    const doc = { activeElement: null, addEventListener: (k, f) => listeners.set(k, f), removeEventListener: (k) => listeners.delete(k), listeners };
    doc.createElement = () => ({ children: [], handlers: {}, innerHTML: '', isConnected: true, appendChild(e) { this.children.push(e); e.parent = this; }, addEventListener(k, f) { this.handlers[k] = f; }, setAttribute() {}, querySelector() { return null; }, focus() { doc.activeElement = this; }, remove() { this.isConnected = false; this.parent.children = this.parent.children.filter(e => e !== this); } });
    doc.body = doc.createElement(); doc.querySelector = () => doc.trigger;
    doc.trigger = doc.createElement(); doc.activeElement = doc.trigger;
    return doc;
}
test('map content keeps relations, aliases, item provenance and unlocated records', () => {
    const html = renderMapHtml(world(), { placeId: 'p1' });
    for (const text of ['大厅', '城', '结构推导', '访客', '无处客', '来信', '<line', '位置未载']) assert.ok(html.includes(text), text);
    assert.ok(renderMapHtml(world(), { query: '殿堂' }).includes('大厅'));
    assert.ok(renderMapHtml(world(), { query: '来信' }).includes('来信'));
});
test('body popup survives redraw, refreshes fresh world and reopens with ESC/focus', () => {
    const doc = documentFake(); let w = world(); let extracts = 0;
    const hub = createMapPopupHub({ getWorld: () => w, doc, onExtract: () => { extracts++; } });
    const mask = hub.open(); assert.equal(doc.body.children.length, 1);
    w = { ...w, entities: [...w.entities, { id: 'e3', name: '新访客', location: '大厅' }] };
    hub.refresh(); assert.ok(mask.children[0].innerHTML.includes('新访客'));
    mask.handlers.click({ target: { closest: () => ({ dataset: { mapAction: 'extract' } }) } }); assert.equal(extracts, 1);
    doc.listeners.get('keydown')({ key: 'Escape', stopPropagation() {}, preventDefault() {} });
    assert.equal(doc.body.children.length, 0); assert.equal(doc.activeElement, doc.trigger);
    const next = hub.open(); assert.ok(doc.listeners.has('keydown'));
    next.handlers.click({ target: next }); assert.equal(doc.body.children.length, 0);
    const last = hub.open(); last.handlers.click({ target: { closest: () => ({ dataset: { mapAction: 'close' } }) } });
    assert.equal(doc.body.children.length, 0); assert.equal(doc.listeners.size, 0);
});
test('relations preserve multiple parents, passage direction and condition without inventing roads', () => {
    const w = world(); const g = w.context.setting.frozen.canon.geography;
    g.places.push({ id: 'p3', name: '位面' }, { id: 'p4', name: '门' });
    g.links.push({ from: 'p1', to: 'p3', type: 'within' }, { from: 'p1', to: 'p4', type: 'adjacent' }, { from: 'p1', to: 'p4', type: 'passage', via: '星门', condition: '持符' });
    w.entities.push({ id: 'e3', name: '守卫', location: '大厅' });
    const html = renderMapHtml(w, { placeId: 'p1' });
    for (const text of ['位面', '相邻', '通道', '星门', '持符', '方向未载', '结构推导', '来源未载']) assert.ok(html.includes(text), text);
    assert.equal((html.match(/<line /g) || []).length, 4);
    assert.ok(!html.includes('双向') && !html.includes('当前畅通'));
});
test('map search discovers entities/events and safely escapes ledger text', () => {
    const w = world(); w.entities.push({ id: 'e3', name: '<script>甲</script>', location: '城' });
    w.events.push({ id: 'v2', title: '城中集会', position: '城' });
    assert.ok(renderMapHtml(w, { query: '集会' }).includes('城中集会'));
    const html = renderMapHtml(w, { query: '甲' });
    assert.ok(html.includes('&lt;script&gt;甲&lt;/script&gt;')); assert.ok(!html.includes('<script>'));
});
test('close restores the replacement entrance after original entrance redraw', () => {
    const doc = documentFake(); const hub = createMapPopupHub({ getWorld: world, doc });
    hub.open(); const old = doc.trigger; old.isConnected = false;
    doc.trigger = doc.createElement(); hub.close(); assert.equal(doc.activeElement, doc.trigger);
});
test('search replaces an excluded selection and renders qualified identity and dynamic change evidence', () => {
    const w = world(); const g = w.context.setting.frozen.canon.geography;
    g.places = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta', qualifier: '北区' }]; g.links = [];
    w.entities = [{ id: 'alice', name: 'Alice', location: 'Alpha' }, { id: 'bob', name: 'Bob', location: 'Beta' }];
    w.meta.entityFields.bob = { fields: { location: { source: '变更', value: 'Beta', prev: 'Alpha', cause: '迁居', tick: 7 } } };
    const html = renderMapHtml(w, { placeId: 'a', query: 'Bob' });
    assert.match(html, /<h3>Beta · 北区<\/h3>/); assert.ok(html.includes('Bob'));
    assert.ok(!html.includes('<h3>Alpha'));
    for (const fact of ['动态更新', '迁居', '第 7 轮', '此前：Alpha']) assert.ok(html.includes(fact), fact);
});
test('Chinese composition keeps the composing input intact and applies one final search', () => {
    const doc = documentFake(); let reads = 0;
    const hub = createMapPopupHub({ getWorld: () => { reads++; return world(); }, doc });
    const mask = hub.open(), box = mask.children[0]; const initial = box.innerHTML;
    const input = { value: '访', selectionStart: 1, matches: () => true, focus() { this.focused = true; }, setSelectionRange(a, b) { this.caret = [a, b]; } };
    box.querySelector = () => input;
    mask.handlers.compositionstart({ target: input });
    mask.handlers.input({ target: input, isComposing: true });
    assert.equal(box.innerHTML, initial); assert.equal(reads, 1);
    input.value = '访客'; input.selectionStart = 2;
    mask.handlers.compositionend({ target: input });
    assert.equal(reads, 2); assert.ok(box.innerHTML.includes('value="访客"'));
    assert.equal(input.focused, true); assert.deepEqual(input.caret, [2, 2]);
    mask.handlers.input({ target: input, isComposing: false }); assert.equal(reads, 2);
});
test('location stories reuse recorded chapters and search, without placing positionless or affected events', () => {
    const w = world(); w.meta.tick = 10;
    w.events = [{ id: 'ev_1_1', title: '大厅来客', position: '大厅', source: { type: 'state' }, links: { up: [] }, ripples: [], closed: false },
        { id: 'ev_2_1', title: '无处来信', source: { type: 'state' }, links: { up: [] }, ripples: ['e1'], closed: false }];
    w.chronicle = [{ tick: 3, eventRef: 'ev_1_1', text: '访客留下<墨迹>，记录仍在', timeMark: '午后' },
        { tick: 4, eventRef: 'ev_2_1', text: '消息不知来自何处', timeMark: '夜' }];
    w.agendas = [{ id: 'a_1_1', owner: 'e1', goal: '收集来访记录', source: { type: 'event', ref: 'ev_1_1' }, memory: { done: ['t5: 已将记录封存'], blocked: [] }, closed: false }];
    w.milestones = [{ rows: [{ id: 'ev_0_1', title: '城的旧事', position: '城', links: { up: [] }, source: { type: 'state' } }] }];
    const html = renderMapHtml(w, { placeId: 'p1', query: '墨迹' });
    assert.ok(html.includes('访客留下&lt;墨迹&gt;，记录仍在')); assert.ok(html.includes('午后'));
    assert.ok(renderMapHtml(w, { placeId: 'p1' }).includes('已将记录封存'));
    assert.ok(!html.includes('消息不知来自何处'));
    const unlocated = renderMapHtml(w, { placeId: 'p1' }).split('class="sw2-map-unlocated"')[1];
    assert.ok(unlocated.includes('消息不知来自何处')); assert.ok(unlocated.includes('无处来信'));
    assert.ok(renderMapHtml(w, { placeId: 'p2' }).includes('城的旧事'));
});
