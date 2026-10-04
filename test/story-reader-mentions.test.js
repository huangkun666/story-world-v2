import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStoryReaderHtml } from '../src/story-reader.js';

const fixture = (person = '白素') => ({
    meta: { tick: 2 }, context: { world: '测试世界', positions: ['江州', '江州城'], setting: { frozen: { canon: { situation: `${person}到江州城` } } } },
    entities: [{ id: 'e_p1', name: person, kind: 'character', location: '江州城' }],
    events: [{ id: 'ev_1_1', title: `${person}抵达江州城`, position: '江州城', ripples: ['e_p1'], source: { type: 'state' }, links: {}, closed: false }],
    agendas: [], chronicle: [], milestones: [], weights: {},
});

test('近况人物和地点带名称标记，整行保持单一按钮且原文连贯', () => {
    const html = renderStoryReaderHtml(fixture());
    const row = html.match(/<button[^>]*data-story-row[\s\S]*?<\/button>/)?.[0];
    assert.ok(row);
    assert.match(row, /<span class="sw2-story-mention" data-story-kind="人物">白素<\/span>/);
    assert.match(row, /<span class="sw2-story-mention" data-story-kind="地点">江州城<\/span>/);
    assert.equal((row.match(/<button\b/g) || []).length, 1);
    assert.ok(row.replace(/<[^>]*>/g, '').includes('白素抵达江州城'));
    assert.ok(!row.includes('>江州</span>城'), '较长地点优先，不拆分地点名称');
});

test('正文名称可打开已有说明，字面匹配保留特殊字符与转义', () => {
    const name = '白素+<客>&';
    const html = renderStoryReaderHtml(fixture(name));
    const article = html.match(/<article[^>]*data-story-detail[\s\S]*?<\/article>/)?.[0];
    assert.match(article, /<button[^>]*class="sw2-story-mention"[^>]*data-story-context="e_p1"[^>]*>白素\+&lt;客&gt;&amp;<\/button>抵达/);
    assert.match(article, /data-story-context="loc:江州城"[^>]*>江州城<\/button>/);
    assert.ok(!html.includes('<客>'));
    assert.ok(!html.includes('>江州</button>城'));
});

test('账上没有的名称不产生说明入口', () => {
    const data = fixture();
    data.events[0].title = '无名旅客到荒野';
    const html = renderStoryReaderHtml(data);
    assert.ok(!html.includes('>无名旅客</span>'));
    assert.ok(!html.includes('>荒野</button>'));
});
