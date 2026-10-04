import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAll } from '../src/render.js';
import { mergedMainHtml } from '../web/page-compose.js';
import { createParamApi } from '../web/param-panel.js';

test('新组合把全部附层放入世界查询区域，主页不再叠加旧工具栏', () => {
    const panorama = '<div data-story-app><div data-story-home-panel>近况</div><section data-story-world-panel hidden><!-- STORY_WORLD_ATTACH --></section></div>';
    const board = { infoband: '<p>现状</p>', agendaStrip: '<p>盘算</p>', side: '<p>地图</p>', feed: '<p>动态流</p>', digest: '<p>大势副本</p>' };
    assert.equal(mergedMainHtml({ panorama, board }), panorama.replace('<!-- STORY_WORLD_ATTACH -->', board.infoband + board.agendaStrip + board.side));
    assert.equal(mergedMainHtml({ panorama, board: '<p>兼容附层</p>' }), panorama.replace('<!-- STORY_WORLD_ATTACH -->', '<p>兼容附层</p>'));
});

test('正式观棋入口提供最新进展、独立故事与按需世界查询', () => {
    const world = { meta: { tick: 3 }, entities: [], agendas: [], weights: {}, chronicle: [], milestones: [],
        context: { world: '测试世界', positions: ['江州城'] },
        events: [{ id: 'ev_1_1', title: '江州议事', source: { type: 'state' }, position: '江州城', ripples: [], links: {}, closed: false }] };
    const html = mergedMainHtml(renderAll(world));
    assert.match(html, /data-story-app/); assert.match(html, /data-story-row/); assert.match(html, /data-story-detail/);
    assert.match(html, /data-pan-world="测试世界"/); assert.match(html, /江州议事/);
    const worldPanel = html.slice(html.indexOf('data-story-world-panel'));
    for (const name of ['sw2-infoband', 'sw2-agenda-strip', 'sw2-map-entry']) {
        assert.equal(html.split(name).length - 1, 1); assert.ok(worldPanel.includes(name));
    }
    assert.equal(html.split('data-action="open-map"').length - 1, 1);
    assert.ok(!html.includes('data-pan-focus')); assert.ok(!html.includes('data-pan-location'));
    assert.ok(!html.includes('STORY_WORLD_ATTACH')); assert.ok(!html.includes('sw2-feed'));
});

test('新故事搜索受生产自动刷新保护，避免打断输入法', () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const api = createParamApi({ freshCtx: () => ({}), sw2ExtensionSettings: () => ({}), sw2LocalStore: () => null, getLastWorld: () => null });
    try {
        Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: {
            tagName: 'INPUT', closest: selector => selector.includes('[data-story-search-input]') ? {} : null,
        } } });
        assert.equal(api.playerIsTouchingParams(), true);
    } finally { if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document; }
});

test('世界附层原文含美元替换符时仍逐字保留', () => {
    const panorama = '<div data-story-app><section data-story-world-panel><!-- STORY_WORLD_ATTACH --></section></div>';
    const tail = '<p>$& $\' $`</p>';
    assert.equal(mergedMainHtml({ panorama, board: tail }), '<div data-story-app><section data-story-world-panel>' + tail + '</section></div>');
});
