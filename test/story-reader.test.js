// story-world-v2/test/story-reader.test.js
// ★★★Task1（观棋 · 世界近况与故事阅读 · `docs/plan-story-reader.md` 第一棒）的判据。
//
// 这一棒只做**渲染层**：`src/story-reader.js` 用 `buildPanorama(world, opts)` 已经算好的
// `threads`（分组与"往回看轮数"窗口都归它）排出**首页近况列表 ＋ 各自独立的阅读页 ＋ 人物地点说明**；
// 浏览器里的进出、筛选、搜索、状态恢复归 Task2（`web/story-reader.js`）。
//
// 判据纪律（照本仓那把尺）：
//   ① 夹具用**真账形状**（跨地点的一件事、编年留的经过话、收场与被卡住的谋划、账上没记的格子、
//      带尖括号/引号的名字），不是"模板对模板"；
//   ② 每条都配**正向断言**（关键人话必须在），免得"把正文清空"也空绿；
//   ③ 每一句"最新变化"都要能在账上**逐句回查**（这一页是排的，不是编的）；
//   ④ 缺格子如实空着：不许拿 0 或"现在"冒充"账上没记的那一格"。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPanorama } from '../src/panorama.js';

// 模块不存在时先确认动态导入失败，再实现渲染器。
const { buildStoryReader, renderStoryReaderHtml } = await import('../src/story-reader.js');

// ─────────────────────────── 判据自带的小工具（不 import 生产代码） ───────────────────────────

/** 把一段 HTML 的**开标签**逐个解析出来（属性值一律带引号；本模块自己渲染，形状可控）。 */
function tagList(html) {
    const out = [];
    for (const m of String(html).matchAll(/<([a-zA-Z0-9]+)((?:"[^"]*"|[^>"])*)>/g)) {
        const attrs = {};
        for (const a of m[2].matchAll(/([a-zA-Z0-9-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? '';
        out.push({ tag: m[1].toLowerCase(), attrs, raw: m[0] });
    }
    return out;
}
/** 带某个标记属性的标签（属性在不在，就是契约本身）。 */
const marked = (html, marker) => tagList(html).filter((t) => marker in t.attrs);
/** 该标签的**内层** HTML（本模块没有同标签嵌套的兄弟形状，取最近的闭合标签足够）。 */
function innerOf(html, tag) {
    const outer = outerOf(html, tag.tag, open => open === tag.raw);
    return outer.slice(tag.raw.length, -(`</${tag.tag}>`.length));
}
/** 同名标签的**完整**元素（带深度计数，用来切 article / aside / 滚动容器）。 */
function outerOf(html, tagName, test) {
    const re = new RegExp(`<(/?)${tagName}\\b[^>]*>`, 'gi');
    let depth = 0, start = -1, m;
    while ((m = re.exec(String(html)))) {
        if (m[1] !== '/') {
            if (depth === 0) { if (!test(m[0])) continue; start = m.index; }
            depth += 1;
        } else if (depth > 0) {
            depth -= 1;
            if (depth === 0 && start >= 0) return String(html).slice(start, m.index + m[0].length);
        }
    }
    return '';
}
const decode = (s) => String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
/** 可见文本：剥标签（含属性）＋ 解实体 —— 与 `test/panorama.test.js` 同一把尺。 */
// Inline name markers add no whitespace to the browser's text; block separators still do.
const visible = (html) => decode(String(html)
    .replace(/<(?:span|button)\b[^>]*class="sw2-story-mention"[^>]*>([\s\S]*?)<\/(?:span|button)>/g, '$1')
    .replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const BARE_ID = /\b(?:ev_seed_\d+|ev_\d+_\d+|e_bk_\d+|e_p\d+|e_\d+_\d+|a_\d+_\d+|m_\d+|ch_\d[\w]*)\b/g;
const ENGINE_WORDS = ['盘算', '涟漪', '结算', '入局', '编年', '里程碑', '闭环', '事件', '满步', '谋划树', '产果', '归档'];
const attrOf = (tag, name) => tag.attrs[name];

// ─────────────────────────── 夹具：真账形状的一个世界（跨地点 · 经过话 · 收场 · 缺格子 · 尖括号） ───────────────────────────
//
// 五段故事（`buildPanorama` 的分组结果，逐条在下面断言）：
//   B `ev_12_1`：四件事跨两处（大虞京城 → 东胜沧洲），**最新进展来自编年留下的经过话**（第 20 轮）；
//   A `ev_2_1` ：三件事跨两处（不灭神山 → 灵山），**最新进展来自谋划记下的经过**（t19）；
//   C `ev_9_1` ：来路/地点/人都没记，只有一件事；
//   D `ev_3_1` ：两件事（其中一件是谋划产果），**已收场**（closedAt 8 ＋ 模型给的理由）；
//   E `ev_old_1`：号认不出轮次（账上也没记 tick）⇒ **不许冒充"最新"**。
function world(tick = 20) {
    return {
        version: 1,
        context: {
            world: '夹缝世界',
            positions: ['灵山', '不灭神山', '轮回台', '大虞京城', '东胜沧洲', '九霄'],
            playerId: 'e_p1',
            setting: { frozen: { canon: { situation: '复苏历：黄金大世，天骄横出，灵气井喷。' } } },
        },
        entities: [
            { id: 'e_p1', kind: 'character', name: '白素', location: '不灭神山', 身份: '妖庭旧部的召集者', 实力: '大乘' },
            { id: 'e_p2', kind: 'character', name: '鬼帝', location: '未明', fields: { 身份: '轮回台裂隙之争的挑起者' } },
            { id: 'e_p3', kind: 'character', name: '蒋武', location: '东胜沧洲' },
            { id: 'e_bk_1', kind: 'faction', name: '菩提禅院', location: '西漠灵山', 性质: '中立佛门', 规模: '一座古刹' },
            { id: 'e_bk_2', kind: 'faction', name: '大虞', location: '大虞京城', 规模: '庞大皇朝' },
            { id: 'e_x1', kind: 'character', name: '<img src=x onerror="alert(1)">', location: '灵山' },
        ],
        weights: {},
        agendas: [
            {
                id: 'a_1_1', owner: 'e_p1', goal: '召集妖庭旧部', stage: '召集', visibility: 'known',
                maxSteps: 5, progress: 3, closed: false, source: { type: 'event', ref: 'ev_2_1' },
                memory: { promises: [], done: ['t4: 在不灭神山敲响妖皇钟', 't9: 旧部开始回应', 't19: 旧部聚齐，召集完成'], blocked: [], turnsAlive: 3 },
            },
            {
                id: 'a_2_1', owner: 'e_p2', goal: '争夺轮回台裂隙', stage: '对峙', visibility: 'known',
                maxSteps: 4, progress: 2, closed: true, source: { type: 'event', ref: 'ev_3_1' },
                memory: { promises: [], done: ['t3: 击向轮回台'], blocked: ['t6: 放弃（菩提禅院结阵死守，裂隙抢不下来）'], turnsAlive: 2 },
            },
        ],
        events: [
            { id: 'ev_2_1', title: '白素敲响妖皇钟', source: { type: 'state' }, position: '不灭神山', ripples: ['e_p1'], links: { up: [] }, closed: false },
            { id: 'ev_5_1', title: '召集的消息传向灵山', source: { type: 'plot', ref: 'a_1_1' }, position: '灵山', ripples: ['e_p1', 'e_x1'], links: { up: ['ev_2_1'] }, closed: false },
            { id: 'ev_17_1', title: '旧部回信送到灵山', source: { type: 'ripple', ref: 'ev_5_1' }, position: '灵山', ripples: ['e_p1'], links: { up: ['ev_5_1'] }, closed: false },
            { id: 'ev_12_1', title: '京城派出使者', source: { type: 'state' }, position: '大虞京城', ripples: ['e_bk_2'], links: { up: [] }, closed: false },
            { id: 'ev_18_1', title: '使者向边境行进', source: { type: 'ripple', ref: 'ev_12_1' }, position: '东胜沧洲', ripples: ['e_bk_2', 'e_p3'], links: { up: ['ev_12_1'] }, closed: false },
            { id: 'ev_19_1', title: '使者抵达东胜沧洲', source: { type: 'ripple', ref: 'ev_18_1' }, position: '东胜沧洲', ripples: ['e_bk_2', 'e_p3'], links: { up: ['ev_18_1'] }, closed: false },
            { id: 'ev_20_1', title: '边境调兵开始推进', source: { type: 'ripple', ref: 'ev_19_1' }, position: '东胜沧洲', ripples: ['e_bk_2'], links: { up: ['ev_19_1'] }, closed: false },
            { id: 'ev_3_1', title: '轮回台出现裂隙', source: { type: 'state' }, position: '轮回台', ripples: ['e_p2', 'e_bk_1'], links: { up: [] }, closed: true, closedAt: 8, closedBy: 'model', closedWhy: '裂隙守住了，这一段过去了' },
            { id: 'ev_7_1', title: '菩提禅院结阵守住裂隙', source: { type: 'plot', ref: 'a_2_1' }, position: '轮回台', ripples: ['e_bk_1'], links: { up: ['ev_3_1'] }, closed: true, closedAt: 8 },
            { id: 'ev_9_1', title: '无名之事', links: { up: [] }, closed: false },
            { id: 'ev_old_1', title: '旧事一桩 <b>回响</b> & 「引号」', source: { type: 'state' }, position: '九霄', ripples: ['e_bk_2'], links: { up: [] }, closed: false },
        ],
        chronicle: [
            { id: 'ch_6_1', tick: 6, text: '召集的消息传到灵山，一些旧部开始回应', kind: 'scheme', eventRef: 'ev_5_1' },
            { id: 'ch_3_1', tick: 3, text: '事件「轮回台出现裂隙」——由世界处境而生，事发 轮回台，牵动 鬼帝、菩提禅院', kind: 'state', eventRef: 'ev_3_1' },
            { id: 'ch_14_1', tick: 14, text: '边境各方等待使者抵达', kind: 'scheme', eventRef: 'ev_12_1' },
            { id: 'ch_20_1', tick: 20, text: '使者抵达东胜沧洲，边境调兵开始推进', kind: 'scheme', eventRef: 'ev_20_1' },
        ],
        milestones: [{ id: 'm_0', span: { from: 0, to: 0 }, counts: { events: 1 }, titles: ['更早的一件事'], ids: ['ev_0_1'], links: { up: [] } }],
        meta: { tick, simLog: [] },
    };
}
// 期望的"最新有依据进展"（逐条都能在账上回查）：B 的经过话 → A 的谋划经过 → C 的事名 → D 的收场理由 → E 无轮次。
const EXPECTED_CHANGE = {
    ev_12_1: '使者抵达东胜沧洲，边境调兵开始推进',
    ev_2_1: '旧部聚齐，召集完成',
    ev_9_1: '无名之事',
    ev_3_1: '裂隙守住了，这一段过去了',
    ev_old_1: '旧事一桩 <b>回响</b> & 「引号」',
};
const REAL = JSON.parse(readFileSync(new URL('./fixtures/chronicle-page-real-world.json', import.meta.url), 'utf8'));

test('故事时间逐件照抄已有时间，同轮各自不同，缺失时不借用别件或保存时间', () => {
    const w = world();
    w.events.find(event => event.id === 'ev_12_1').timeMark = '复苏历三年 三月初七 · 清晨';
    w.events.push(
        { id: 'ev_12_2', title: '午后在城门交接', source: { type: 'ripple', ref: 'ev_12_1' }, links: { up: ['ev_12_1'] }, timeMark: '复苏历三年 三月初七 · 午后' },
        { id: 'ev_12_3', title: '探子离城', source: { type: 'ripple', ref: 'ev_12_1' }, links: { up: ['ev_12_1'] }, updatedAt: '2026-10-03T11:00:00Z' },
        { id: 'ev_12_4', title: '路口暂歇', source: { type: 'ripple', ref: 'ev_12_1' }, links: { up: ['ev_12_1'] }, timeMark: 123 },
    );
    const before = structuredClone(w);
    const html = renderStoryReaderHtml(w);
    const article = outerOf(html, 'article', tag => tag.includes('data-story-id="ev_12_1"'));
    const times = [...article.matchAll(/<p\b[^>]*data-story-time[^>]*>([\s\S]*?)<\/p>/g)].map(match => visible(match[1]));
    assert.deepEqual(times, ['时间：复苏历三年 三月初七 · 清晨', '时间：复苏历三年 三月初七 · 午后']);
    assert.ok(visible(article).includes('探子离城'));
    assert.ok(!visible(article).includes('2026-10-03T11:00:00Z'));
    assert.deepEqual(w, before, '只读展示不修改原账');
});

test('时间可从事件对应的编年原记录读回，经过话只显示自身时间，归档事件仍可读', () => {
    const w = world();
    const mark = '复苏历三年 <春> & 「初七」';
    w.chronicle.push({ tick: 12, eventRef: 'ev_12_1', text: '事件「京城派出使者」——由世界处境而生', timeMark: mark });
    w.chronicle.find(row => row.id === 'ch_14_1').timeMark = '翌日午后';
    w.chronicle.push({ tick: 16, text: '京城派出使者后，议事厅收到回信', timeMark: '次日傍晚' });
    w.milestones[0].rows = [{ id: 'ev_1_1', title: '旧年约定使者路线', source: { type: 'state' }, links: { up: [] } }];
    w.events.find(event => event.id === 'ev_12_1').links.up = ['ev_1_1'];
    w.events.find(event => event.id === 'ev_12_1').source = { type: 'ripple', ref: 'ev_1_1' };
    w.chronicle.push({ tick: 1, eventRef: 'ev_1_1', text: '事件「旧年约定使者路线」——由世界处境而生', timeMark: '复苏历二年 冬' });
    const html = renderStoryReaderHtml(w, { panelTurns: 50 });
    const article = outerOf(html, 'article', tag => tag.includes('data-story-id="ev_1_1"'));
    const times = [...article.matchAll(/<p\b[^>]*data-story-time[^>]*>([\s\S]*?)<\/p>/g)].map(match => visible(match[1]));
    assert.deepEqual(times, ['时间：复苏历二年 冬', `时间：${mark}`, '时间：翌日午后', '时间：次日傍晚']);
    assert.ok(visible(article).includes('使者抵达东胜沧洲，边境调兵开始推进'));
    assert.ok(!/<春>/.test(html), '时间字段同样转义');
});

test('故事详情每轮只显示一次轮次，同轮进展在单件事收场之前', () => {
    const w = world();
    w.events.find(event => event.id === 'ev_3_1').closedAt = 7;
    const story = buildStoryReader(w).recent.find(story => story.id === 'ev_3_1');
    const round = story.chapters.filter(chapter => chapter.tick === 7);
    assert.equal(round[0].title, '菩提禅院结阵守住裂隙');
    assert.equal(round.at(-1).kind, 'closure');
    assert.equal(round.at(-1).text, '裂隙守住了，这一段过去了');
    assert.equal(story.change.text, '裂隙守住了，这一段过去了');
    assert.equal(story.progressTick, 7);
    const html = renderStoryReaderHtml(w);
    const article = outerOf(html, 'article', tag => tag.includes('data-story-id="ev_3_1"'));
    const expected = [...new Set(story.chapters.map(chapter => chapter.tick == null ? '' : String(chapter.tick)))];
    assert.deepEqual(marked(article, 'data-story-round-head').map(tag => attrOf(tag, 'data-story-round-head')), expected);
    assert.ok(article.indexOf('菩提禅院结阵守住裂隙') < article.indexOf('单件事收场'));
    assert.ok(visible(article).includes('裂隙守住了，这一段过去了'));
    const closure = outerOf(article, 'section', tag => tag.includes('data-story-closure'));
    const source = marked(closure, 'data-pan-key')[0];
    assert.ok(visible(innerOf(closure, source)).includes('对应的事 轮回台出现裂隙'), '收场对应原事件，不误指同轮后续事件');
});

test('来路和生成的因果说明默认折起，原文及普通经过话完整保留', () => {
    const w = world();
    const cause = '因事而生：大虞 由「京城派出使者」生「追查粮道」';
    const progress = '因事而生的风波仍在继续，各方等待消息';
    w.chronicle.push({ tick: 13, eventRef: 'ev_12_1', text: cause }, { tick: 15, eventRef: 'ev_12_1', text: progress });
    const article = outerOf(renderStoryReaderHtml(w), 'article', tag => tag.includes('data-story-id="ev_12_1"'));
    const details = marked(article, 'data-pan-key').filter(tag => tag.tag === 'details');
    assert.ok(details.length >= 2);
    assert.ok(details.every(tag => !('open' in tag.attrs)), '默认折起');
    const related = details.find(tag => visible(innerOf(article, tag)).includes(cause));
    assert.ok(related, '完整因果原文保留在可展开的区域');
    assert.ok(visible(innerOf(article, related)).includes('相关打算'));
    assert.ok(details.some(tag => visible(innerOf(article, tag)).includes('接着「京城派出使者」往下长')));
    assert.ok(visible(article).includes(progress), '普通经过话留在正文');
    assert.ok(!details.some(tag => visible(innerOf(article, tag)).includes(progress)));
    assert.ok(marked(innerOf(article, related), 'data-story-context').length > 0, '展开后的名字仍可查说明');
});

test('新增故事和更早记录后，展开状态的键仍对应原记录', () => {
    const w = world();
    const keys = html => marked(html, 'data-pan-key').filter(tag => tag.tag === 'details').map(tag => decode(attrOf(tag, 'data-pan-key')));
    const before = keys(renderStoryReaderHtml(w));
    assert.ok(before.length > 1, '有可展开的原记录');
    w.chronicle.push({ tick: 1, eventRef: 'ev_12_1', text: '因事而生：大虞 由「旧闻」生「核查往事」' });
    w.events.push({ id: 'ev_21_1', title: '另一处传来新消息', source: { type: 'state' }, links: { up: [] }, closed: false });
    w.meta.tick = 21;
    const after = keys(renderStoryReaderHtml(w));
    assert.ok(after.length > before.length, '新记录确实进入展示');
    assert.equal(new Set(after).size, after.length, '各条记录的键不重合');
    for (const key of before) assert.ok(after.includes(key), '原记录展开状态的键不随列表和章节位置改变');
});

// ─────────────────────────────────── ① 出口与空世界 ───────────────────────────────────

test('★Task1①：模块出口存在；空/缺世界仍有身份与控制件（可用的根）', async () => {
    const module = await import('../src/story-reader.js');
    assert.equal(typeof module.buildStoryReader, 'function', '`buildStoryReader` 必须是函数');
    assert.equal(typeof module.renderStoryReaderHtml, 'function', '`renderStoryReaderHtml` 必须是函数');

    for (const w of [null, undefined, {}, { version: 1, entities: [], events: [], agendas: [], chronicle: [], milestones: [], context: {}, meta: { tick: 0 } }]) {
        const html = renderStoryReaderHtml(w);
        const root = tagList(html).find((t) => 'data-story-app' in t.attrs);
        assert.ok(root, '★根节点 `data-story-app` 必须在（空世界也不许没有壳）');
        assert.equal(attrOf(root, 'data-pan-world'), String((w && w.context && w.context.world) || ''),
            '★世界名如实（账上没有就是空串，不许编一个）');
        for (const marker of ['data-story-home', 'data-story-world', 'data-story-view', 'data-story-search-toggle',
            'data-story-search-box', 'data-story-search-input', 'data-story-clear', 'data-story-results',
            'data-story-list', 'data-story-no-results', 'data-story-close-context', 'data-story-world-panel', 'data-story-drawer']) {
            assert.ok(marked(html, marker).length >= 1, `★空世界也必须有控制件：${marker}`);
        }
        assert.equal(marked(html, 'data-story-detail').length, 0, '没有故事就不该有正文页');
        assert.match(visible(html), /0 段故事/, '★计数如实为 0（不是"暂无数据"那种含糊话）');
        const views = marked(html, 'data-story-view');
        assert.equal(views.length, 2, '两个视图钮：近期 / 未结');
        assert.equal(views.find((v) => attrOf(v, 'data-story-view') === 'recent').attrs['aria-selected'], 'true', '默认近期');
        assert.equal(views.find((v) => attrOf(v, 'data-story-view') === 'unresolved').attrs['aria-selected'], 'false');
        assert.ok('hidden' in marked(html, 'data-story-search-box')[0].attrs, '★搜索框默认收起');
        assert.equal(attrOf(marked(html, 'data-story-results')[0], 'role'), 'status', '计数是 role=status');
        assert.ok('hidden' in marked(html, 'data-story-no-results')[0].attrs, '空搜索提示默认收起');
        assert.ok('hidden' in marked(html, 'data-story-world-panel')[0].attrs, '世界入口默认收起');
        assert.ok('hidden' in marked(html, 'data-story-drawer')[0].attrs, '说明栏默认收起');
        assert.equal(attrOf(marked(html, 'data-story-drawer')[0], 'role'), 'dialog');
        assert.equal(attrOf(marked(html, 'data-story-drawer')[0], 'aria-label'), '人物与地点');
        assert.ok(html.includes('<!-- STORY_WORLD_ATTACH -->'), '★世界附层的占位符必须在（组合器往这儿装现状/盘算/地图）');
    }
});

// ─────────────────────────────────── ② 列表行与分组的形制 ───────────────────────────────────

test('★Task1②：首页行的形制（行是按钮、带全副标记、行内不许再嵌可点件；分组标题与行同轮）', () => {
    const html = renderStoryReaderHtml(world());
    const rows = marked(html, 'data-story-row');
    assert.equal(rows.length, 5, '★五段故事各一行（同一段跨地点也只一行）');
    for (const row of rows) {
        assert.equal(row.tag, 'button', '★行必须是按钮（整行可点）');
        const id = attrOf(row, 'data-story-id');
        assert.ok(id, '行要有 story id');
        assert.equal(attrOf(row, 'data-story-open'), id, '★`data-story-open` 与 `data-story-id` 同值（浏览器据此开页）');
        assert.ok(['true', 'false'].includes(attrOf(row, 'data-story-live')), '★`data-story-live` 只许 true/false');
        assert.ok(String(attrOf(row, 'data-story-search')).length > id.length, '★`data-story-search` 要带整段可搜正文');
        assert.match(attrOf(row, 'data-story-tick'), /^(?:\d*)$/, '★`data-story-tick` 是轮次或空串');
        const inner = innerOf(html, row);
        for (const cls of ['sw2-story-change', 'sw2-story-row-meta', 'sw2-story-state', 'sw2-story-arrow']) {
            assert.ok(inner.includes(cls), `★行里必须有 .${cls}`);
        }
        assert.ok(!/<(?:button|a)\b/i.test(inner), '★行内不许再嵌按钮/链接（嵌套可点件是坏形状）');
    }
    // 分组：每个 [data-story-round] 标题底下的行，轮次必须与标题一致（按有依据的进展分轮）
    const groups = marked(html, 'data-story-group');
    assert.ok(groups.length >= 1, '列表要分组');
    let seen = 0;
    for (const g of groups) {
        const inner = innerOf(html, g);
        const rowsIn = marked(inner, 'data-story-row');
        seen += rowsIn.length;
        const head = marked(inner, 'data-story-round')[0];
        for (const r of rowsIn) assert.equal(attrOf(r, 'data-story-tick'), head ? attrOf(head, 'data-story-round') : '', '分组标题与行的轮次要一致');
    }
    assert.equal(seen, rows.length, '每一行都落在某个分组里');
});

// ─────────────────────────────────── ③ 最新变化与排序（缺轮次不许冒充最新） ───────────────────────────────────

test('★Task1③：近期列表按**有依据的最新进展轮次**倒序；最新那句话逐句可在账上回查；缺轮次排最后', () => {
    const model = buildStoryReader(world());
    assert.deepEqual(model.recent.map((s) => s.id), ['ev_12_1', 'ev_2_1', 'ev_9_1', 'ev_3_1', 'ev_old_1'],
        '★轮次：编年经过话 20 ＞ 谋划经过 19 ＞ 事名 9 ＞ 收场 8 ＞ 账上没记');
    assert.deepEqual(model.recent.map((s) => s.progressTick), [20, 19, 9, 8, null], '★"账上没记"就是 null，不许拿 0 冒充');
    const html = renderStoryReaderHtml(world());
    const rows = marked(html, 'data-story-row');
    assert.deepEqual(rows.map((r) => attrOf(r, 'data-story-id')), ['ev_12_1', 'ev_2_1', 'ev_9_1', 'ev_3_1', 'ev_old_1'], '行序 = 模型序');
    assert.deepEqual(rows.map((r) => attrOf(r, 'data-story-tick')), ['20', '19', '9', '8', ''], '★没轮次的那一行是空串');
    for (const row of rows) {
        const id = attrOf(row, 'data-story-id');
        const change = visible(outerOf(innerOf(html, row), 'span', tag => tag.includes('class="sw2-story-change"')));
        assert.equal(change, EXPECTED_CHANGE[id], `★「最新变化」必须是账上那句话（${id}）`);
    }
});

// ─────────────────────────── ④ 跨地点一条故事只出现一次 ＋ 起头随窗口内的新进展保留 ───────────────────────────

test('★Task1④：跨地点只列一次；一条线只要进了窗口，**整条**（含窗口外的起头）都讲', () => {
    const w = world();
    const html = renderStoryReaderHtml(w);
    const rows = marked(html, 'data-story-row').filter((r) => attrOf(r, 'data-story-id') === 'ev_2_1');
    assert.equal(rows.length, 1, '★同一段故事跨两个地点，也只列一次');
    assert.equal(marked(html, 'data-story-detail').filter((a) => attrOf(a, 'data-story-id') === 'ev_2_1').length, 1, '★只有一个正文页（不按地点复制）');
    const articleA = outerOf(html, 'article', (t) => t.includes('data-story-id="ev_2_1"'));
    for (const title of ['白素敲响妖皇钟', '召集的消息传向灵山', '旧部回信送到灵山']) {
        assert.ok(visible(articleA).includes(title), `★整条线的每一件都要在正文里：${title}`);
    }
    // 窗口：往回 5 轮（tick 20 ⇒ 第 16 轮起）——B 与 A 还在窗口里，A 的起头（第 2 轮）也照讲
    const win = renderStoryReaderHtml(w, { panelTurns: 5 });
    assert.deepEqual(marked(win, 'data-story-row').map((r) => attrOf(r, 'data-story-id')), ['ev_12_1', 'ev_2_1'],
        '★窗口口径与 `buildPanorama` 同源：窗口外的三条不上这一屏');
    const winA = outerOf(win, 'article', (t) => t.includes('data-story-id="ev_2_1"'));
    assert.ok(visible(winA).includes('白素敲响妖皇钟'), '★窗口外的起头随窗口内的新进展一起保留');
    // 与 `buildPanorama` 的分组/窗口**逐条对齐**（同一件事不许两处各算一套）
    const pan = buildPanorama(w, { panelTurns: 5 });
    assert.deepEqual(marked(win, 'data-story-row').map((r) => attrOf(r, 'data-story-id')), pan.threads.map((t) => String(t.id)),
        '★行 = `buildPanorama(world, opts).threads`（顺序也照它）');
});

test('★Task1⑤：窗口里一条都没有时——身份、搜索与计数照留，故事一个不编', () => {
    const html = renderStoryReaderHtml(world(99), { panelTurns: 1 });
    assert.equal(marked(html, 'data-story-row').length, 0, '窗口里没有故事就是没有');
    assert.equal(marked(html, 'data-story-detail').length, 0, '也不该有正文页');
    const empty = marked(html, 'data-story-empty')[0];
    assert.ok(empty && !('hidden' in empty.attrs), '★空态那句话要显示出来');
    assert.match(visible(innerOf(html, empty)), /最近 1 轮/, '空态如实说这是窗口的问题');
    assert.match(visible(html), /0 段故事/, '计数如实为 0');
    assert.ok(marked(html, 'data-story-search-input').length === 1 && marked(html, 'data-story-search-toggle').length === 1,
        '★没有可读故事时，搜索与入口还在（原故事回来后能接着读）');
    assert.ok('hidden' in marked(html, 'data-story-no-results')[0].attrs, '搜索无结果那句仍归搜索用，不冒充空窗口');
});

// ─────────────────────────────────── ⑥ 未结筛选用既有 thread.live ───────────────────────────────────

test('★Task1⑥：未结筛选只用既有 `thread.live`；两个视图共用同一份行；状态词沿用说书那三态', () => {
    const w = world();
    const pan = buildPanorama(w);
    const model = buildStoryReader(w);
    const byId = new Map(pan.threads.map((t) => [String(t.id), t]));
    assert.equal(model.recent.length, pan.threads.length, '★账上留下的每一条都在（两个视图共用一份，不另开清单）');
    for (const s of model.recent) {
        assert.equal(s.live, byId.get(s.id).live, `★${s.id} 的开合状态取自既有 thread.live`);
        assert.equal(s.growing, byId.get(s.id).growing, '★"还在往下长"也照既有那格');
    }
    const html = renderStoryReaderHtml(w);
    for (const row of marked(html, 'data-story-row')) {
        const id = attrOf(row, 'data-story-id');
        assert.equal(attrOf(row, 'data-story-live'), String(byId.get(id).live), '★行上那格 = thread.live');
    }
    assert.equal(marked(html, 'data-story-row').filter((r) => attrOf(r, 'data-story-live') === 'false').length, 1, '这一局只有收场那条是未结=false');
    const labels = ['还在往下长', '挂着没了结', '已收场'];
    for (const row of marked(html, 'data-story-row')) {
        const state = decode(/<span class="sw2-story-state[^"]*">([\s\S]*?)<\/span>/.exec(innerOf(html, row))?.[1] ?? '');
        assert.ok(labels.includes(state), `★状态词只用说书那三个（拿到 ${state}）`);
    }
    const growingRow = marked(html, 'data-story-row').find((r) => attrOf(r, 'data-story-id') === 'ev_12_1');
    assert.ok(innerOf(html, growingRow).includes('还在往下长'), '★有下游的那条如实标"还在往下长"');
    const closedRow = marked(html, 'data-story-row').find((r) => attrOf(r, 'data-story-id') === 'ev_3_1');
    assert.ok(innerOf(html, closedRow).includes('已收场'), '★收场那条如实标"已收场"');
});

// ─────────────────────── ⑦ 正文：原文、来路、轮次、谋划经过、代价、收场 ───────────────────────

test('★Task1⑦：正文按时间读——每件事的原名/来路/地点/人物/经过话，加谋划经过、代价与收场记录', () => {
    const html = renderStoryReaderHtml(world());
    const a = outerOf(html, 'article', (t) => t.includes('data-story-id="ev_2_1"'));
    const va = visible(a);
    assert.ok(a.includes('class="sw2-story-title"') && va.includes('召集妖庭旧部'), '正文标题 = 那条线的名字');
    // 每一件：原名、来路、轮次
    assert.ok(va.includes('白素敲响妖皇钟') && va.includes('当时的局面自己拱出来的'), '起头那件事与它的来路');
    assert.ok(va.includes('由白素的打算「召集妖庭旧部」推出来'), '★来路取账上那句（谋划的主人＋原话目标）');
    assert.ok(va.includes('召集的消息传向灵山') && va.includes('第 5 轮'), '事名与它的轮次');
    assert.ok(va.includes('召集的消息传到灵山，一些旧部开始回应'), '★编年留下的经过话原样进正文');
    assert.ok(va.includes('第 6 轮'), '经过话自己的轮次要印（不是事件的轮次）');
    assert.ok(a.includes('class="sw2-story-chapter"'), '每一件事一章');
    // 谋划经过与代价
    assert.ok(va.includes('在不灭神山敲响妖皇钟') && va.includes('旧部聚齐，召集完成'), '★谋划记下的经过逐条保留');
    assert.ok(va.includes('第 19 轮'), '经过话自带轮次要印');
    // 收场那条：关掉的理由与轮次，一个字不改
    const d = outerOf(html, 'article', (t) => t.includes('data-story-id="ev_3_1"'));
    const vd = visible(d);
    assert.ok(vd.includes('裂隙守住了，这一段过去了'), '★收场理由必须原话');
    assert.ok(vd.includes('第 8 轮'), '收场轮次');
    assert.ok(vd.includes('轮回台出现裂隙') && vd.includes('菩提禅院结阵守住裂隙'), '收场那条线里两件事都在');
    assert.ok(vd.includes('击向轮回台'), '谋划记下的经过');
    assert.ok(vd.includes('放弃（菩提禅院结阵死守，裂隙抢不下来）'), '★被卡住的那句原话');
    assert.ok(d.includes('data-story-closure'), '收场记录那一节要在');
    // 缺格子如实空着：C 那件事没有地点、没有人、来路账上没记
    const c = outerOf(html, 'article', (t) => t.includes('data-story-id="ev_9_1"'));
    const vc = visible(c);
    assert.ok(vc.includes('无名之事'), '事名照印');
    assert.ok(vc.includes('来路在账上没记'), '★来路没记就如实说（这是既有那句措辞）');
    assert.ok(vc.includes('第 9 轮'), '事件号里的出生轮次是已有依据');
    const undated = outerOf(html, 'article', t => t.includes('data-story-id="ev_old_1"'));
    assert.ok(visible(undated).includes('轮次在账上没记'), '没有出生轮次或日期时如实留空');
    assert.ok(!/第 0 轮/.test(vc), '★不许拿 0 冒充账上没记的轮次');
});

// ─────────────────────────────────── ⑧ 搜索文本完整 ───────────────────────────────────

test('★Task1⑧：行的可搜正文含故事名、最新变化、人物、地点与全部正文关键句', () => {
    const html = renderStoryReaderHtml(world());
    const rowA = marked(html, 'data-story-row').find((r) => attrOf(r, 'data-story-id') === 'ev_2_1');
    const hay = decode(attrOf(rowA, 'data-story-search'));
    for (const needle of ['召集妖庭旧部', '旧部聚齐，召集完成', '白素', '不灭神山', '灵山',
        '白素敲响妖皇钟', '召集的消息传向灵山', '旧部回信送到灵山', '召集的消息传到灵山，一些旧部开始回应',
        '在不灭神山敲响妖皇钟', '由白素的打算「召集妖庭旧部」推出来']) {
        assert.ok(hay.includes(needle), `★可搜正文缺了「${needle}」`);
    }
});

// ─────────────────────────────────── ⑨ 转义（一个字都不许漏） ───────────────────────────────────

test('★Task1⑨：文字与属性一律转义（尖括号、引号、& 都不许破壳）', () => {
    const html = renderStoryReaderHtml(world());
    assert.ok(!/<img src=x/i.test(html), '★名字里的 <img> 不许真进页面');
    assert.ok(!/<script\b/i.test(html), '★没有脚本进来');
    assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'), '★如实转义后照样可读');
    assert.ok(visible(html).includes('<img src=x onerror="alert(1)">'), '★解回来还是原话（转义不是改写）');
    assert.ok(visible(html).includes('旧事一桩 <b>回响</b> & 「引号」'), '★事名里的尖括号与 & 原样可读');
    // 属性：带引号的值不许把属性切断（解析器仍能读到完整值，且值里没有裸引号）
    for (const row of marked(html, 'data-story-row')) {
        const search = attrOf(row, 'data-story-search');
        assert.ok(search && !search.includes('"'), '★属性值里不许留裸引号');
    }
    const hostile = marked(html, 'data-story-context').find((b) => decode(innerOf(html, b)).includes('<img'));
    assert.ok(hostile, '★带尖括号的人物也得有一个说明入口（可见文字是名字本身）');
    assert.ok(!attrOf(hostile, 'data-story-context').includes('<'), '★键是实体号/地点键，不是可见文字');
});

// ─────────────────────────── ⑩ 人物与地点说明（每个键一份、现有格子、只连故事不编地理） ───────────────────────────

test('★Task1⑩：人物/地点说明——每个入口都有对应面板，用账上现有的名/类/字段/所在，地点只连已知故事', () => {
    const w = world();
    const html = renderStoryReaderHtml(w);
    const keys = [...new Set(marked(html, 'data-story-context').map((b) => attrOf(b, 'data-story-context')))];
    assert.ok(keys.length >= 5, `入口要够（拿到 ${keys.length} 个键）`);
    const panels = marked(html, 'data-story-context-panel');
    for (const key of keys) {
        const hit = panels.filter((p) => attrOf(p, 'data-story-context-id') === key);
        assert.equal(hit.length, 1, `★每个键恰好一份说明：${key}`);
        assert.ok(marked(html, 'data-story-drawer')[0] && outerOf(html, 'aside', (t) => t.includes('data-story-drawer')).includes(`data-story-context-id="${key}"`),
            `★说明住在同一个抽屉里：${key}`);
    }
    // 人物面板：名 / 类 / 账上现成的字段 / 所在
    const bai = panels.find((p) => attrOf(p, 'data-story-context-id') === 'e_p1');
    const vb = visible(innerOf(html, bai));
    assert.ok(vb.includes('白素') && vb.includes('人物'), '名字与类别');
    assert.ok(vb.includes('妖庭旧部的召集者') && vb.includes('身份'), '★账上现成的字段（fields/顶层格）原样列出');
    assert.ok(vb.includes('大乘') && vb.includes('实力'), '顶层那格也要列');
    assert.ok(vb.includes('不灭神山') && vb.includes('所在'), '所在照账上那格');
    const gui = panels.find((p) => attrOf(p, 'data-story-context-id') === 'e_p2');
    assert.ok(visible(innerOf(html, gui)).includes('轮回台裂隙之争的挑起者'), '★只写在 fields 里的字段也要列出来');
    // 地点面板：只有"牵动的故事"，没有自造地理
    const loc = panels.find((p) => attrOf(p, 'data-story-context-id') === 'loc:东胜沧洲');
    assert.ok(loc, '地点键要用显式的地点键（不是实体号）');
    assert.ok(visible(innerOf(html, loc)).includes('东胜沧洲') && visible(innerOf(html, loc)).includes('地点'), '地点名与类别');
    const opened = marked(innerOf(html, loc), 'data-story-open').map((b) => attrOf(b, 'data-story-open'));
    assert.deepEqual(opened, ['ev_12_1'], '★地点只连"已知发生在这里的故事"（不编地理、不列别处）');
    assert.ok(!BARE_ID.test(visible(innerOf(html, loc))), '★可见文字里不许出现机器号');
    // 世界入口：所有入口都是按钮、都能翻到（Codex 的控制器负责开合）
    const worldPanel = outerOf(html, 'section', (t) => t.includes('data-story-world-panel'));
    const entries = marked(worldPanel, 'data-story-context').map((b) => attrOf(b, 'data-story-context'));
    assert.deepEqual([...entries].sort(), [...keys].sort(), '★世界入口里的按钮 = 全部说明键（一处不漏）');
});

// ─────────────────────────── ⑪ 抽屉在滚动容器外 ＋ 导航 ＋ 世界附层占位 ───────────────────────────

test('★Task1⑪：单个滚动容器（沿用既有滚动快照那格）；说明栏在它外面；导航带世界名与当前轮次', () => {
    const html = renderStoryReaderHtml(world());
    const scroll = outerOf(html, 'div', (t) => t.includes('sw2-merged-main') && t.includes('sw2-story-scroll'));
    assert.ok(scroll, '★滚动容器 .sw2-merged-main.sw2-story-scroll（既有滚动快照按 .sw2-merged-main 取）');
    assert.ok(scroll.includes('data-story-home-panel') && scroll.includes('data-story-detail'), '首页与正文都在这个滚动面里');
    assert.ok(!scroll.includes('data-story-drawer'), '★说明栏必须在滚动容器**外面**');
    assert.ok(outerOf(html, 'aside', (t) => t.includes('data-story-drawer')), '说明栏是 aside');
    const nav = outerOf(html, 'nav', (t) => t.includes('data-story-nav'));
    const vn = visible(nav);
    assert.ok(marked(nav, 'data-story-home').length === 1 && marked(nav, 'data-story-world').length === 1, '两个入口');
    assert.ok(vn.includes('夹缝世界') && vn.includes('第 20 轮'), '★世界名与当前轮次（账上没记就空着）');
    assert.ok(html.includes('<!-- STORY_WORLD_ATTACH -->'), '★世界附层占位符');
    // 首页：紧凑标题 ＋ 可选的世界背景（有原话才开这一块）
    const home = outerOf(html, 'section', (t) => t.includes('data-story-home-panel'));
    assert.ok(visible(home).includes('最近，世界发生了什么'), '紧凑标题');
    const bg = marked(home, 'data-story-background')[0];
    assert.ok(bg && visible(innerOf(home, bg)).includes('复苏历：黄金大世，天骄横出，灵气井喷。'), '★世界背景用账上原话（可选块）');
    assert.ok(!visible(renderStoryReaderHtml({ ...world(), context: { world: '无背景' } })).includes('世界背景'), '账上没这句就不开这块');
});

// ─────────────────────────── ⑫ 跳转锚点：稳定、安全、都在当前正文里 ───────────────────────────

test('★Task1⑫：跳转锚点——每个 [data-story-jump] 都能在当前正文里找到同 id 的目标，且全页 id 不重复', () => {
    const html = renderStoryReaderHtml(world());
    const ids = tagList(html).map((t) => attrOf(t, 'id')).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, `★全页 id 必须唯一：${ids.join(', ')}`);
    for (const article of marked(html, 'data-story-detail')) {
        const outer = outerOf(html, 'article', (t) => t.includes(`data-story-id="${attrOf(article, 'data-story-id')}"`));
        const here = new Set(tagList(outer).map((t) => attrOf(t, 'id')).filter(Boolean));
        for (const jump of marked(outer, 'data-story-jump')) {
            const target = attrOf(jump, 'data-story-jump');
            assert.ok(here.has(target), `★跳转目标要在当前正文里（${target}）`);
            assert.match(target, /^[A-Za-z][\w-]*$/, '★锚点 id 必须是安全形状（不许有引号/空格/尖括号）');
        }
    }
    const a = outerOf(html, 'article', (t) => t.includes('data-story-id="ev_2_1"'));
    const jumps = marked(a, 'data-story-jump').map((b) => decode(innerOf(a, b)));
    assert.ok(jumps.includes('起头') && jumps.includes('最新进展'), `★长故事要能从起头跳到最新（拿到 ${jumps.join('/')}）`);
});

// ─────────────────────────── ⑬ 真账验收：可见文本零行话零机器号 ＋ 同一输入逐字节相同 ───────────────────────────

test('★Task1⑬：拿真账跑一遍——零引擎行话、零机器号，同输入两次逐字节相同', () => {
    const html = renderStoryReaderHtml(REAL, { panelTurns: 50 });
    const v = visible(html);
    for (const word of ENGINE_WORDS) assert.ok(!v.includes(word), `★可见文本里不许出现引擎词「${word}」`);
    assert.deepEqual(v.match(BARE_ID) || [], [], '★可见文本里不许出现机器号');
    assert.ok(v.includes('复苏历：黄金大世'), '★大势原话要在（反向自证：页面不是空的）');
    assert.equal(renderStoryReaderHtml(REAL, { panelTurns: 50 }), html, '★同输入两次渲染必须逐字节相同');
    assert.equal(buildStoryReader(REAL, { panelTurns: 50 }).recent.length, buildPanorama(REAL, { panelTurns: 50 }).threads.length);
});

test('★Task1⑭：真账上每一段故事都有正文、行与轮次对得上、说明与锚点一个不漏', () => {
    const opts = { panelTurns: 50 };
    const pan = buildPanorama(REAL, opts);
    const model = buildStoryReader(REAL, opts);
    const html = renderStoryReaderHtml(REAL, opts);
    const rows = marked(html, 'data-story-row');
    assert.equal(rows.length, pan.threads.length, '★行 = 说书留下的每一条线');
    assert.ok(pan.threads.some((t) => t.count > 1), '真账里要有多件事的长线（免得这条判据在单件事上空绿）');
    const byId = new Map(pan.threads.map((t) => [String(t.id), t]));
    for (const row of rows) {
        const id = attrOf(row, 'data-story-id');
        assert.ok(byId.has(id), `行 ${id} 必须是说书那条线`);
        assert.equal(attrOf(row, 'data-story-live'), String(byId.get(id).live), '开合状态照 thread.live');
    }
    const articles = marked(html, 'data-story-detail');
    assert.equal(articles.length, pan.threads.length, '每一段故事一个正文页（不按地点复制）');
    for (const id of byId.keys()) assert.equal(articles.filter((a) => attrOf(a, 'data-story-id') === id).length, 1, `正文页唯一：${id}`);
    // 轮次：非增序 ＋ 没轮次的排最后；每行的轮次 = 账上那一段的"最新有依据进展"
    const ticks = rows.map((r) => (attrOf(r, 'data-story-tick') === '' ? null : Number(attrOf(r, 'data-story-tick'))));
    for (let i = 1; i < ticks.length; i += 1) {
        if (ticks[i] == null) continue;
        assert.ok(ticks[i - 1] != null && ticks[i - 1] >= ticks[i], `★近期列表要按最新进展倒序：${ticks.join(',')}`);
    }
    const firstNull = ticks.indexOf(null);
    if (firstNull >= 0) assert.ok(ticks.slice(firstNull).every((t) => t == null), '★账上没记轮次的那些只许排在最后（不许冒充最新）');
    // 账上逐句回查：模型里每一句"最新变化"都要能在账上找到出处
    const pool = [
        ...REAL.events.map((e) => String(e.title || '')),
        ...REAL.chronicle.map((c) => String(c.text || '')),
        ...REAL.agendas.flatMap((a) => [...(a.memory?.done || []), ...(a.memory?.blocked || [])]).map((s) => String(s).replace(/^t\d+[:：]\s*/, '')),
        ...REAL.events.map((e) => String(e.closedWhy || '')),
    ];
    for (const s of model.recent) {
        assert.ok(pool.some((p) => p.includes(s.change.text)), `★「${s.change.text}」必须能在账上找到出处`);
    }
    // 说明与锚点：真账上也一个不漏
    const keys = [...new Set(marked(html, 'data-story-context').map((b) => attrOf(b, 'data-story-context')))];
    const panels = marked(html, 'data-story-context-panel');
    assert.deepEqual([...new Set(panels.map((p) => attrOf(p, 'data-story-context-id')))].sort(), [...keys].sort(), '每个键恰好一份说明');
    for (const article of articles) {
        const outer = outerOf(html, 'article', (t) => t.includes(`data-story-id="${attrOf(article, 'data-story-id')}"`));
        const here = new Set(tagList(outer).map((t) => attrOf(t, 'id')).filter(Boolean));
        for (const jump of marked(outer, 'data-story-jump')) assert.ok(here.has(attrOf(jump, 'data-story-jump')), '跳转目标在当前正文里');
    }
});
