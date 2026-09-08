// story-world-v2/test/render.test.js
// K33/K34 双流 UI：渲染核心纯函数（HTML 面，细案 A-1/A-2/A-3/A-6）——逐字节确定性锁 +
// 玩家语言黑名单（直扫产物字符串）+ 六页签内容断言 + A-6 档案页逐字段一致 + 编码安全 + 空态防御。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    renderAll, renderBoardHtml, renderChronicleHtml, renderArchiveHtml,
    renderEntitiesHtml, renderSettingHtml, renderSettingsHtml, renderVolumeReadHtml,
    escapeHtml, BLACKLIST,
} from '../src/render.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function world() {
    const w = JSON.parse(readFileSync(path.join(ROOT, 'test', 'fixtures', 'live-world.json'), 'utf8'));
    w.context.playerId = 'e_player';
    w.entities.push({ id: 'e_player', kind: 'character', name: '黄坤', location: '黄府', attrs: {} });
    w.context.setting = {
        frozen: {
            fingerprint: 'fnv1a_9f31x_12044',
            extractedAt: '2026-09-08T10:00:00Z',
            canon: {
                powerScale: [{ level: '炼气', note: '修士，江湖底子（原文）' }, { level: '元婴', note: '大宗，可开宗立派（原文）' }],
                rules: ['煞气须以灵脉镇压', '契书为王'],
                society: '官军辖江州，坊市共治',
                techOrMagic: '灵脉与煞气相生相克',
                historyNotes: ['太岁陨落北山', '洗煞阵立'],
            },
        },
        dynamic: {
            tension: { polarity: '大虞/万法阁', direction: '大虞偏将压万法阁', intensity: 0.72 },
            env: { 民生度: 0.44, 动乱度: 0.62, 天时: 0.15, 张力推手: 0.8 },
            derivedFrom: ['浪尖:a_xie@31', '浪尖:a_dayu@44'],
        },
    };
    w.weights.e_player = 0.18;
    w.meta = { tick: 47 };
    w.milestones = [{ id: 'm_30', span: [0, 30], counts: 8, titles: ['发兵催战', '民生凋敝'], ids: ['ev_0', 'ev_15_1'] }];
    w.entities.find((e) => e.id === 'e_player').lastActiveTick = 45;
    w.chronicle.push(
        { id: 'ch_44_1', tick: 44, text: '大虞偏将派帐下偏校赴黄府，递交灵脉地契的割约。', eventRef: 'ev_44_1' },
        { id: 'ch_46_1', tick: 46, text: '薛铁衣杀局推进：大军压至大盘谷口。', eventRef: '' },
        { id: 'ch_47_1', tick: 47, text: '劳役征发——大虞偏将征调坊市丁壮。', eventRef: 'ev_pump_47_1' },
    );
    return w;
}

const CONFIG = { baseUrl: 'https://gcli.ggchan.dev/v1', apiKey: 'k', model: 'gemini-3.1-pro-preview', playerDesc: '我名黄坤，炼气九层。' };
const VOLUMES = [{ id: '卷一', info: '第 1–500 轮 · 512KB · 收在插件本地' }];

test('K33/A-2：同输入两次 renderAll 逐字节一致（纯函数锁）；参数面（config/oldVolumes）也在锁内', () => {
    const a = JSON.stringify(renderAll(world(), { config: CONFIG, oldVolumes: VOLUMES }));
    const b = JSON.stringify(renderAll(world(), { config: CONFIG, oldVolumes: VOLUMES }));
    assert.equal(a, b);
});

const textOnly = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
function deepStrings(o, acc = []) {
    if (typeof o === 'string') acc.push(o);
    else if (Array.isArray(o)) for (const v of o) deepStrings(v, acc);
    else if (o && typeof o === 'object') for (const k of Object.keys(o)) deepStrings(o[k], acc);
    return acc;
}

test('K33/A-3：六页签玩家可见文本零引擎术语（黑名单；标签/属性/字段名/悬停 title 不属玩家视线）', () => {
    const all = renderAll(world(), { config: CONFIG, oldVolumes: VOLUMES });
    const text = deepStrings(all).map(textOnly).join('\n');
    for (const term of BLACKLIST) {
        assert.ok(!text.includes(term), `玩家可见文本含禁词「${term}」`);
    }
    assert.ok(text.includes('盘算')); // 玩家通词放行（共识样例 v3）
});

test('K33 观棋·时局句与信息带：模板拼装（极性/强度/危险带词）零创作零预测；世情四键危险带判态', () => {
    const { digest, infoband } = renderBoardHtml(world());
    assert.match(digest, /大虞\/万法阁，大虞偏将压万法阁 · 强度72/);
    assert.match(digest, /天时·天时不作美、时局·大势紧绷。/);
    assert.match(digest, /各方正谋划 3 件事，其中 1 件在暗处。/);
    assert.match(infoband, /sw2-env-name">民生</);
    assert.match(infoband, /sw2-env-val">0\.44</);
    assert.match(infoband, /sw2-env-row sw2-danger/);              // 天时 0.15 与时局 0.8 危险带
    assert.match(infoband, /逼黄坤入洗煞之局（第32轮）/);         // 浪尖 → 盘算目标（id 不透传）
    assert.match(infoband, /<div class="sw2-big-num">3<small>\/15<\/small>/);
});

test('K33 观棋·无设定池回退：大势未聚 + 无盘算空态', () => {
    const bare = { version: 1, context: { world: 'x', tension: 0.5, positions: ['x'] }, entities: [], weights: {}, agendas: [], events: [], chronicle: [], meta: { tick: 0 } };
    const html = renderBoardHtml(bare);
    assert.match(html.digest, /大势未聚/);
    assert.match(html.digest, /没有在办的谋划/);
    assert.match(html.agendaStrip, /sw2-agenda-empty/);
});

test('K33 观棋·动态流：倒序 + 最新徽 + 引擎 id 只进 title 悬停 + 归档提示条', () => {
    const feed = renderBoardHtml(world()).feed;
    assert.ok(feed.indexOf('第47轮') < feed.indexOf('第44轮'));   // 最新在上
    assert.match(feed, /sw2-now">最新</);
    assert.match(feed, /title="ev_pump_47_1"/);                   // id 悬停
    assert.equal(feed.split('ev_pump_47_1').length - 1, 1);       // 且只出现这一次（仅悬停，不在可见文本）
    assert.match(feed, /已收进大事纪「发兵催战、民生凋敝」/);
    assert.match(feed, /data-view="archive"/);
});

test('K33 观棋·位置速览：影响力百分比 / 暗徽 / 你的棋子 / 已灭实体过滤', () => {
    const w = world();
    w.weights.e_xie = 0.87975;
    const side = renderBoardHtml(w).side;
    assert.match(side, /sw2-entity-name">薛铁衣</);
    assert.match(side, /sw2-wval">88</);
    assert.match(side, /sw2-entity sw2-player/);
    assert.match(side, /你的棋子/);
    w.entities.push({ id: 'e_dead', kind: 'faction', name: '覆灭阁', location: 'x', attrs: {}, status: 'dead' });
    assert.ok(!renderBoardHtml(w).side.includes('覆灭阁'));
});

test('K34 编年页：全量条目 + 大事纪插行 + 旧卷卷行（数据入面）', () => {
    const html = renderChronicleHtml(world(), { oldVolumes: VOLUMES });
    assert.match(html, /劳役征发——大虞偏将征调坊市丁壮。/);
    assert.match(html, /第 1–30 轮已收进大事纪「发兵催战、民生凋敝」/);
    assert.match(html, /sw2-vol">卷一/);
    assert.match(html, /data-action="read-volume"/);
    assert.ok(html.indexOf('ch_47_1') === -1);                    // 编年 id 不裸出
});

test('K34 大事纪·旧卷页：里程碑卡（span/标题/ids 展开） + 卷列表 + 无卷提示', () => {
    const html = renderArchiveHtml(world(), { oldVolumes: VOLUMES });
    assert.match(html, /sw2-milestone-id">m_30</);
    assert.match(html, /第 1–30 轮 · 8 件事/);
    assert.match(html, /展开这一纪的条目/);
    assert.match(html, /sw2-rawids">ev_0 · ev_15_1</);
    assert.match(html, /sw2-vol">卷一/);
    const empty = renderArchiveHtml(world(), {});
    assert.match(empty, /尚未入卷/);
});

test('K34 角色与势力页：全量表（位置/影响力/兵力权位人脉耳目/谋划/最近活跃/状态徽）', () => {
    const w = world();
    const html = renderEntitiesHtml(w);
    assert.match(html, /全部角色与势力（4 位 · 席位上限 32）/);
    assert.ok(html.includes('sw2-eattr" title="兵力：硬实力'));
    assert.ok(html.includes('sw2-eattr" title="耳目：情报网有多灵'));
    assert.match(html, /sw2-ename">黄坤<small>你的棋子/);
    assert.match(html, /最近活跃<br>第45轮/);
    w.entities.push({ id: 'e_dead', kind: 'faction', name: '覆灭阁', location: 'x', attrs: {}, status: 'dead' });
    const html2 = renderEntitiesHtml(w);
    assert.match(html2, /覆灭阁/);
    assert.match(html2, /sw2-visible v-hidden">已灭</);
});

test('第十三棒：属性维度释义与无障碍——title+视障文本双通道、注脚行、缺键零维不渲染', () => {
    const w = world();
    const html = renderEntitiesHtml(w);
    // 悬停释义（鼠标通道）
    assert.ok(html.includes('title="兵力：硬实力——兵马、武备、财力这类能押上桌的东西">'));
    // 视障通道（sr 文本对读屏可见，chip 内先释义后数值）
    assert.ok(html.includes('class="sw2-visually-hidden">兵力：硬实力——兵马、武备、财力这类能押上桌的东西。<'));
    assert.ok(html.includes('class="sw2-visually-hidden">耳目：情报网有多灵——决定你能看多远。<'));
    // 势力/角色差异注脚（机制事实：COEFFS 层差）
    assert.ok(html.includes('势力的影响力更吃兵力与权位；角色的影响力更吃人脉与耳目。'));
    // 缺键零维不渲染：账上只有兵力的世界，不出现权位/人脉/耳目任何 chip（「无兵世界」语义闭环）
    const bareAttrs = world();
    for (const e of bareAttrs.entities) e.attrs = {};
    bareAttrs.entities.find((e) => e.id === 'e_xie').attrs = { hardPower: 0.8 };
    const html2 = renderEntitiesHtml(bareAttrs);
    assert.ok(html2.includes('title="兵力：硬实力'));
    assert.ok(!html2.includes('title="权位'));
    assert.ok(!html2.includes('title="人脉'));
    assert.ok(!html2.includes('title="耳目'));
});

test('K34/A-6 设定档案页：展示与 setting.frozen 逐字段一致（指纹/时间/五件套原文全量），重抽按钮在位', () => {
    const html = renderSettingHtml(world());
    assert.match(html, /书指纹 fnv1a_9f31x_12044/);
    assert.match(html, /抽取于 2026-09-08T10:00:00Z/);
    assert.match(html, /力量谱系（2 档 · 取全）/);
    assert.match(html, /炼气<\/b><span>修士，江湖底子（原文）/);
    assert.match(html, /元婴<\/b><span>大宗，可开宗立派（原文）/);
    assert.match(html, /煞气须以灵脉镇压/);
    assert.match(html, /官军辖江州，坊市共治/);
    assert.match(html, /灵脉与煞气相生相克/);
    assert.match(html, /太岁陨落北山/);
    assert.match(html, /已冻结/);
    assert.match(html, /data-action="force-abstract"/);
    assert.match(html, /浪尖（派生源）/);
    // 未抽取态
    const bare = { version: 1, context: { world: 'x', tension: 0.5, positions: ['x'] }, entities: [], weights: {}, agendas: [], events: [], chronicle: [], meta: { tick: 0 } };
    const bareHtml = renderSettingHtml(bare);
    assert.match(bareHtml, /尚未抽取/);
    assert.match(bareHtml, /sw2-sv-chip stale/);
});

test('K34 设置页：开档描述/模型通道/操作按钮/旧卷管理，表单值来自 config', () => {
    const html = renderSettingsHtml(world(), { config: CONFIG });
    assert.match(html, /来源：角色卡描述/);
    assert.match(html, /<textarea id="sw2_player_desc"[^>]*>我名黄坤，炼气九层.<\/textarea>/u);
    assert.match(html, /id="sw2_base" value="https:\/\/gcli\.ggchan\.dev\/v1"/);
    assert.match(html, /id="sw2_key" value="••••••••••••••••••••"/);
    assert.match(html, /id="sw2_model" value="gemini-3\.1-pro-preview"/);
    assert.match(html, /data-action="init-world"/);
    assert.match(html, /data-action="advance-world"/);
    assert.match(html, /data-action="force-abstract"/);
    assert.match(html, /自动入卷阈值/);
    assert.match(html, /data-action="export-world"/);
    assert.match(html, /data-action="import-world"/);
});

test('K35/A-9 设置页：旧卷清单（卷号/信息/阅卷动作）入面；无卷时"尚未入卷"', () => {
    const html = renderSettingsHtml(world(), { config: CONFIG, oldVolumes: VOLUMES });
    assert.match(html, /入卷清单/);
    assert.match(html, /sw2-vol">卷一/);
    assert.match(html, /data-action="read-volume"/);
    const empty = renderSettingsHtml(world(), { config: CONFIG, oldVolumes: [] });
    assert.match(empty, /尚未入卷/);
});

test('K35/A-9 阅卷视图：卷段行还原（编年行形状→HTML，引擎 id 只进悬停；空卷防御）', () => {
    const rows = [
        { tick: 3, text: '天时骤变', eventRef: 'ev_3' },
        { tick: 4, text: '坊市斗殴', eventRef: '' },
    ];
    const html = renderVolumeReadHtml('卷一', rows);
    assert.match(html, /data-volume="卷一"/);
    assert.match(html, /sw2-ch-round">3</);
    assert.match(html, /天时骤变/);
    assert.match(html, /title="ev_3"/);
    const text = String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    assert.ok(!text.includes('ev_3')); // id 只在悬停，不进可见文本
    const empty = renderVolumeReadHtml('卷二', []);
    assert.match(empty, /（空卷）/);
});

test('K33 编码安全：实体名/编年文本/表单值含 <script> 全转义', () => {
    const w = world();
    w.entities.find((e) => e.id === 'e_xie').name = '<script>alert(1)</script>';
    const side = renderBoardHtml(w).side;
    assert.ok(!side.includes('<script>'));
    const cfg = { ...CONFIG, playerDesc: '<img src=x onerror=alert(1)>' };
    const setHtml = renderSettingsHtml(w, { config: cfg });
    assert.ok(!setHtml.includes('<img src=x onerror=alert(1)>'));          // 原串不残存
    assert.ok(setHtml.includes('&lt;img src=x onerror=alert(1)&gt;'));      // 转义后落地
    assert.equal(escapeHtml('a&b<c>"d\''), 'a&amp;b&lt;c&gt;&quot;d&#39;');
});

test('K34 防御：全空世界六页签不炸（空态合法）', () => {
    const bare = { version: 1, context: { world: 'x', tension: 0.5, positions: ['x'] }, entities: [], weights: {}, agendas: [], events: [], chronicle: [], meta: { tick: 0 } };
    const all = renderAll(bare);
    assert.ok(all.setting.includes('尚未抽取'));
    assert.ok(all.entities.includes('（0 位'));
    assert.ok(all.board.agendaStrip.includes('sw2-agenda-empty'));
    assert.ok(all.archive.includes('尚未入卷'));
});

test('第十三棒锁：事件源措辞零代号——把用户实机样例（ripple 行）锁进 A-3 全局扫描', () => {
    const w = world();
    w.events.push({ id: 'ev_3_1', title: '官军出城引发恐慌', source: { type: 'ripple', ref: 'ev_0' }, position: '江州', ripples: ['e_dayu'] });
    w.chronicle.push({ id: 'ch_3_1', tick: 3, text: '事件「官军出城引发恐慌」——沿「薛铁衣发兵催战」而来，事发 江州，牵动 大虞偏将', eventRef: 'ev_3_1' });
    const all = renderAll(w, { config: CONFIG, oldVolumes: VOLUMES });
    // 玩家视线面：编年/动态流/位置速览（大事纪·旧卷的 ids 展开=管理细节豁免，K34 拍板口径）
    const text = [all.chronicle, all.board.feed, all.board.side].map(textOnly).join('\n');
    assert.ok(text.includes('沿「薛铁衣发兵催战」而来'));
    assert.ok(text.includes('牵动 大虞偏将'));
    assert.ok(!/ev_[a-z0-9_]+/.test(text), '玩家可见文本零事件代号（A-3）');
});