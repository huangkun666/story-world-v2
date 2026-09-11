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
    renderChainViewHtml, renderInfoBandHtml, escapeHtml, BLACKLIST,
} from '../src/render.js';
import { expandChain } from '../src/chain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function world() {
    const w = JSON.parse(readFileSync(path.join(ROOT, 'test', 'fixtures', 'live-world.json'), 'utf8'));
    w.context.playerId = 'e_player';
    // leg25 c：实体不再带 `attrs`（四维浮点已删，ssot.schema 的 additional:false 也不再接受该键）。
    w.entities.push({ id: 'e_player', kind: 'character', name: '黄坤', location: '黄府' });
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

test('K33+leg21 观棋·时局句与信息带：时局句只领世情（无世情=未聚，不混张力）；张力归张力行；世情四键危险带判态', () => {
    const { digest, infoband } = renderBoardHtml(world());
    assert.match(digest, /大势未聚，各方各走各的路/);   // leg21：本世界无 situation → 时局句不再拼张力
    assert.ok(!digest.includes('大虞/万法阁'), '张力极不入时局句');
    assert.ok(!digest.includes('强度'), '强度数字不入时局句');
    assert.match(digest, /天时·天时不作美、时局·大势紧绷。/);
    assert.match(digest, /各方正谋划 3 件事，其中 1 件在暗处。/);
    assert.match(infoband, /sw2-env-name">民生</);
    assert.match(infoband, /sw2-env-val">0\.44</);
    assert.match(infoband, /sw2-env-row sw2-danger/);              // 天时 0.15 与时局 0.8 危险带
    assert.match(infoband, /大虞\/万法阁/);                       // 张力极在张力行（三件套不丢）
    // leg25 b（A1b）：张力行由「强度百分比」改说「近 N 轮事件数」（那个 % 实测只反映事件密度）
    assert.match(infoband, /近10轮事件 0 件/);                    // 本夹具 events 为空 → 0 件
    assert.ok(!infoband.includes('>72<'), '推导出的强度数字不再上面板');
    assert.match(infoband, /逼黄坤入洗煞之局（第32轮）/);         // 浪尖 → 盘算目标（id 不透传）
    assert.match(infoband, /<div class="sw2-big-num">3<small>\/15<\/small>/);
});

test('leg20 世情句领大势：situation 进时局句主句与信息带（原文措辞；拼装增量保留）', () => {
    const w = world();
    w.context.setting.frozen.canon.situation = '大虞兵压江州，坊市暗流涌动';
    const { digest, infoband } = renderBoardHtml(w);
    assert.match(digest, /大虞兵压江州，坊市暗流涌动/);
    assert.match(infoband, /大虞兵压江州，坊市暗流涌动。/);
    assert.match(infoband, /大虞\/万法阁/);   // 张力极性仍在（三件套不丢）
    const bare = { version: 1, context: { world: 'x', tension: 0.5, positions: ['x'] }, entities: [], weights: {}, agendas: [], events: [], chronicle: [], meta: { tick: 0 } };
    assert.match(renderBoardHtml(bare).digest, /大势未聚/);   // 无世情无极性 → 原回退语义不变
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

test('K33/leg24 片5 观棋·位置速览：事实标记（在办/据）取代影响力分数条 / 暗徽 / 你的棋子 / 已灭实体过滤', () => {
    const w = world();
    w.weights.e_xie = 0.87975;   // 账上仍留着旧的分量缓存——界面**不许再显示它**（那个数引擎已不消费）
    const side = renderBoardHtml(w).side;
    assert.match(side, /sw2-entity-name">薛铁衣</);
    assert.ok(!side.includes('sw2-wval'), '片5：影响力分数条已撤（分数不参与决策，不摆给玩家看）');
    assert.ok(!side.includes('sw2-weight-row'), '整行影响力组件下架');
    assert.match(side, /sw2-ev-mark/, '改为事实标记');
    assert.match(side, /在办|无在办/, '在办与否可见');
    // leg25 c：原「有据 n/4 / 数值无据」徽章随四维删除——"有几维有据"这个说法已失去所指
    //   （没有数值维度了）。取而代之的是查书标记（实力/位置的原文或未查态），见实体页那几条用例。
    //   注：玩家行那句「账上没有的数就是没有据」是**另一处**文案（render.js:239），本次未改；
    //   所以这里只锁"按维度计数"的那种形态，不误伤它。
    assert.ok(!/有据\s*\d\s*\/\s*4/.test(side) && !side.includes('数值无据'),
        'leg25 c：「有据 n/4 / 数值无据」不再出现（四维不存在，无从谈"几维有据"）');
    // ★本次变更核心意图锁：旧的四维属性名不得以任何形式出现在玩家视线面
    for (const term of ['兵力', '权位', '人脉', '耳目']) {
        assert.ok(!side.includes(term), `位置速览页不得再出现旧属性名「${term}」`);
    }
    assert.match(side, /sw2-entity sw2-player/);
    assert.match(side, /你的棋子/);
    w.entities.push({ id: 'e_dead', kind: 'faction', name: '覆灭阁', location: 'x', status: 'dead' });
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
    assert.ok(html.includes('data-action="open-chain" data-chain="ev_0"'), '大事纪条目行链按钮（C-1 第二入口）');
    assert.ok(html.includes('data-action="open-chain" data-chain="ev_15_1"'), '大事纪条目行链按钮（C-1 第二入口）');
    const rawText = (v) => String(v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    assert.ok(rawText(html).includes('ev_0') && rawText(html).includes('ev_15_1'), '管理区 ids 仍裸显');
    assert.match(html, /sw2-vol">卷一/);
    const empty = renderArchiveHtml(world(), {});
    assert.match(empty, /尚未入卷/);
});

test('K34 角色与势力页：全量表（位置/实力文本/谋划/最近活跃/状态徽）', () => {
    const w = world();
    const html = renderEntitiesHtml(w);
    assert.match(html, /全部角色与势力（全册 4 · 本轮镜头 4）/);
    // leg25 c（本次变更核心意图）：四维属性 chip（兵力/权位/人脉/耳目）**整段删除**——
    //   那些数没法精确表示、手拍值让"编的"像"算的"。属性区现在只有两样**据书/据账**的东西：
    //   ① 实力 = 书里明述的原话（文本，角色才有）；② 位置的查书标记。
    for (const term of ['兵力', '权位', '人脉', '耳目', 'hardPower', 'office', 'network', 'intel']) {
        assert.ok(!html.includes(term), `实体页不得再出现旧属性名/键「${term}」（四维已删）`);
    }
    assert.ok(!html.includes('ATTR_HINTS') && !html.includes('sw2-eattr" title="兵力'),
        '旧的属性释义悬停（ATTR_HINTS）不得回潮');
    assert.match(html, /sw2-ename">黄坤<small>你的棋子/);
    assert.match(html, /最近活跃<br>第45轮/);
    w.entities.push({ id: 'e_dead', kind: 'faction', name: '覆灭阁', location: 'x', status: 'dead' });
    const html2 = renderEntitiesHtml(w);
    assert.match(html2, /覆灭阁/);
    assert.match(html2, /sw2-visible v-hidden">已灭</);
    // K37 席位语义：在席计数只算 active + 退休/已灭标注
    w.entities.push({ id: 'e_ret', kind: 'character', name: '归隐客', location: 'x', status: 'retired' });
    const html3 = renderEntitiesHtml(w);
    assert.match(html3, /全部角色与势力（全册 6 · 本轮镜头 4） <small class="sw2-quiet-note">另 2 位退休\/已灭<\/small>/);
});

test('leg25 c：属性区（实力/位置的查书标记）无障碍双通道——悬停 title + 视障 sr 文本；注脚行在位', () => {
    const w = world();
    const html = renderEntitiesHtml(w);
    // ① 有值态（实力=书里原话）：两条通道都要有（鼠标悬停 + 读屏 sr 文本）
    w.entities.push({ id: 'e_c1', kind: 'character', name: '玄一道祖', location: '未明', '实力': 'T9渡劫巅峰' });
    const withPower = renderEntitiesHtml(w);
    assert.ok(withPower.includes('title="实力：书里明述的原话（角色字段；势力不写实力）"'),
        '悬停释义在位（鼠标通道）');
    assert.ok(withPower.includes('<span class="sw2-visually-hidden">实力：书里明述的原话。</span>实力<b>T9渡劫巅峰</b>'),
        '视障通道在位：sr 文本先释义、后原话（读屏用户拿得到同一信息）');
    // ② 未查态（没轮到查它）：悬停释义同样要在——否则这一格对读屏用户是空白
    assert.ok(html.includes('title="实力：还没轮到查它'), '实力未查态有悬停释义');
    assert.ok(html.includes('title="位置：还没轮到查它'), '位置未查态有悬停释义（两条通道不因"无值"而消失）');
    // 势力行不摆实力栏（用户拍板）：势力行的属性区不应出现"实力"chip
    const factionRow = html.split('<div class="sw2-entity-row').find((seg) => seg.includes('>薛铁衣<'));
    assert.ok(factionRow && !factionRow.includes('实力<b>'), '势力行内不得渲染实力 chip');
    // 片5 注脚 + 细案查书标记改写：有值/未加载到/书未明述 三句分清
    assert.ok(html.includes('账上只记查到的与玩出来的东西'), '注脚行在位（说清"有值/未加载到/书未明述"三态）');
});

test('leg25 d 回归：属性区 title 属性不得被内层裸双引号截断（悬停文案要完整）', () => {
    // 子代理报回、实测确认的 A9：`lookupChip` 的未查态 title 里写了裸双引号（`"未加载到"`），
    //   `escapeHtml` **不转义半角引号** ⇒ 属性值就地截断：悬停只显示前半句，残余文字还漏成游离文本。
    //   旧用例只断言 `title="实力：还没轮到查它` 这个**前缀**，所以正好绕过它——这里按机械口径锁死：
    //   凡是进 title 的文案一律不许带裸 `"`（要引号用「」）。
    const w = world();
    const html = renderEntitiesHtml(w);
    assert.ok(html.includes('title="实力：还没轮到查它'), '前缀仍在（原用例不回归）');
    // ① 逐个 title 属性取值，凡值里再出现 `"` 即为被截断
    const titles = [...html.matchAll(/title="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(titles.length > 0, '这份产物里本来就该有 title（悬停释义通道）');
    const broken = titles.filter((t) => t.includes('"'));
    assert.deepEqual(broken, [], `title 属性值内出现裸双引号（属性被截断）：${JSON.stringify(broken)}`);
    // ② 未查态那句完整释义必须整句在位（截断时后半句会掉出属性）
    assert.ok(html.includes('查过之后这里会写「未加载到」或「书未明述」）"'),
        '★未查态悬停文案整句在位（截断 bug 会让后半句掉出 title）');
    assert.ok(!/title="[^"]*"[^<>]*"\s*>/.test(html), '不得出现"属性提前闭合 + 游离文字"的残迹');
});

test('细案 spec-entity-field-lookup：实力/位置查书标记在面板上是三句不同的话；势力不显示实力栏', () => {
    const w = world();
    const faction = w.entities[0];                              // fixture 里三条都是势力
    // 加一个**角色**（实力是角色字段；势力不写实力——用户拍板）
    w.entities.push({ id: 'e_c1', kind: 'character', name: '玄一道祖', location: '未明', parent: faction.name, '实力': 'T9渡劫巅峰' });
    w.entities.push({ id: 'e_c2', kind: 'character', name: '无名客', location: '未明' });
    faction['实力'] = '三万铁骑';                                 // 势力即便账上有值也不该渲染实力栏
    w.meta.entityFields = {
        e_c2: { attempts: { 实力: { count: 1, state: 'pending' } }, fields: {}, sources: ['昆仑道宫'] },
        e_wanfa: { attempts: { 位置: { count: 1, state: 'absent' } }, fields: {}, sources: [] },
    };
    const html = renderEntitiesHtml(w);
    assert.ok(html.includes('实力<b>T9渡劫巅峰</b>'), '①有值 → 显示原文原话（文本类型，不做任何加工）');
    assert.ok(!html.includes('三万铁骑'), '②势力不显示实力栏（哪怕账上有值也不渲染——用户拍板）');
    assert.ok(html.includes('实力<b>未加载到</b>'), '③查过但模型没给 → 明说"未加载到"（绝不写成"书里没有"）');
    assert.ok(html.includes('书未明述'), '④书里确实没写 → 才说"书未明述"');
    // ★第二十五棒修正（用户实拍"根本看不到属性"）：从没查过的那一栏也必须显形，否则整栏空白=用户以为没这功能
    const w2 = world();
    w2.entities.push({ id: 'e_c3', kind: 'character', name: '从没查过的人', location: '未明' });
    const html2 = renderEntitiesHtml(w2);
    assert.ok(html2.includes('实力<b>未查</b>'), '★没查过 → 显示"实力：未查"（不是空白）');
    assert.ok(html2.includes('位置<b>未查</b>'), '★位置同理：没查过显示"位置：未查"');
    assert.ok(html2.includes('账上只记查到的与玩出来的东西'), '注脚把查书标记讲清');
});

test('细案 spec-entity-field-lookup：势力的实力由麾下成员派生显示（不替它算总档）', () => {
    const w = world();
    const faction = w.entities.find((e) => e.kind === 'faction');
    const member = { id: 'e_m1', kind: 'character', name: '玄一道祖', location: '未明', parent: faction.name, '实力': 'T9渡劫巅峰' };
    w.entities.push(member);
    const html = renderEntitiesHtml(w);
    assert.ok(html.includes('麾下实力：玄一道祖（T9渡劫巅峰）'), '势力行显示麾下各成员的档位原话（派生，不落势力字段）');
    // 势力自己那格不得出现实力 chip：把该势力的行切出来单独看
    const row = html.split(`<div class="sw2-entity-row`).find((seg) => seg.includes(`>${faction.name}<`));
    assert.ok(row && !row.includes('实力<b>'), `势力行内不得渲染实力 chip：${String(row).slice(0, 80)}`);
});

test('leg25 c：「没查到就空着」要看得见（不填默认值冒充客观）；环境键书没给就标「书未明述」', () => {
    // leg25 c 改写（原「leg24 片5：账面无数与位置未明都要看得见」）：
    //   原用例断言的是"四维无数 → 明说『数值无据』"与"整排属性空着 → 一句人话解释『四维无数（等模型提议或查书）』"。
    //   那两个说法的**所指**（四维浮点）已经不存在 ⇒ 断言换成现在真实存在的对应物：
    //   ①属性区不是数值而是**查书标记**，空态文案是「实力/位置未查（轮到时会按需去世界书取原话）」；
    //   ②同样一条硬规矩仍在被锁：**不许拿 0.15/0.25/0.5 这类默认值冒充数据**（design-core-leg23 §2.2 硬规矩一）。
    const w = world();
    w.entities.forEach((e) => { e.location = '未明'; });
    const html = renderEntitiesHtml(w);
    // 第二十五棒修正（用户实拍："第一个未明是位置未明，后面还有一个位置未明是不是多了"）：
    //   位置列已经说明"没载到"，标记列不再重复打「位置未明」徽章；位置列本身写「未载」。
    assert.match(html, /sw2-eloc">未载</, '位置没载到 → 位置列写「未载」（不再显示重复的"未明"）');
    assert.ok(!html.includes('位置未明'), '★撤销重复的「位置未明」徽章（同一事实不再说两遍）');
    assert.ok(!html.includes('数值无据'), 'leg25 c：四维不存在 → "数值无据"这个说法不再出现');
    assert.match(html, /实力\/位置未查（轮到时会按需去世界书取原话）/, '属性区空态 → 一句人话解释（不是空白、不是假数）');
    assert.ok(!/0\.15|0\.25/.test(html), '不出现任何默认值冒充的数据');
    // 环境四键：书没给的显示「书未明述（无据）」，不给 0.5
    const bare = structuredClone(w);
    bare.context.setting.dynamic.env = {};             // 书整本没给环境量（新世界常态）
    const band = renderInfoBandHtml(bare);
    assert.match(band, /书未明述/);
    assert.match(band, /sw2-env-unknown/, '未知环境量用空心条');
    assert.ok(!/0\.50/.test(band), '不再出现"四键 0.50"这种看起来像原值的数');
    // 书给了值的那一键照常显示数值（本夹具四键都有值）
    const band2 = renderInfoBandHtml(w);
    assert.match(band2, /0\.62/);
    assert.ok(!/书未明述/.test(band2), '有值就不标未明述');
    // 分数（影响力条）在实体页彻底消失
    assert.ok(!html.includes('sw2-wval') && !html.includes('sw2-eweight'), '片5：分量条不再渲染');
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
    assert.match(html, /data-action="clear-evolution"/);
    assert.match(html, /浪尖（派生源）/);
    // 未抽取态
    const bare = { version: 1, context: { world: 'x', tension: 0.5, positions: ['x'] }, entities: [], weights: {}, agendas: [], events: [], chronicle: [], meta: { tick: 0 } };
    const bareHtml = renderSettingHtml(bare);
    assert.match(bareHtml, /尚未抽取/);
    assert.match(bareHtml, /sw2-sv-chip stale/);
});

test('K34 设置页：开档描述/模型通道/操作按钮/旧卷管理，表单值来自 config', () => {
    const html = renderSettingsHtml(world(), { config: CONFIG });
    assert.match(html, /来源：角色卡 \+ 世界信息（自动合订）/);
    assert.match(html, /<textarea id="sw2_player_desc"[^>]*>我名黄坤，炼气九层.<\/textarea>/u);
    assert.match(html, /id="sw2_base" value="https:\/\/gcli\.ggchan\.dev\/v1"/);
    assert.match(html, /id="sw2_key" value="••••••••••••••••••••"/);
    assert.match(html, /id="sw2_model" value="gemini-3\.1-pro-preview"/);
    assert.match(html, /data-action="init-world"/);
    assert.match(html, /data-action="advance-world"/);
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
    assert.ok(all.entities.includes('（全册 0 · 本轮镜头 0）'));
    assert.ok(all.board.agendaStrip.includes('sw2-agenda-empty'));
    assert.ok(all.archive.includes('尚未入卷'));
});

test('K46+leg21 观棋·大势行与张力行并带：大势=世情句/未聚+浪尖（不再混张力）；张力三件套全归张力行', () => {
    const mk = () => ({
        version: 1, context: {
            world: 'x', tension: 0.5, positions: ['x'],
            setting: { dynamic: { tension: { polarity: '正邪相争', direction: '魔涨道消', intensity: 0.82 }, env: { 民生度: 0.5, 动乱度: 0.5, 天时: 0.15, 张力推手: 0.8 }, derivedFrom: ['浪尖:a_1@3'] } },
        },
        entities: [{ id: 'e_a', kind: 'faction', name: '甲宗', location: 'x' }], weights: { e_a: 0.9 },
        agendas: [{ id: 'a_1', owner: 'e_a', goal: '血洗洛城', stage: '用兵', visibility: 'known', maxSteps: 3, progress: 2, closed: true, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } }],
        events: [], chronicle: [], milestones: [], meta: { tick: 3, simLog: [] },
    });
    const { infoband, digest } = renderBoardHtml(mk());
    assert.ok(infoband.includes('sw2-band-label">大势</div>'), '大势行在位');
    assert.ok(infoband.includes('sw2-band-label">张力 · 结构性三件套'), '张力行独立成行');
    assert.ok(!infoband.includes('大势 · 结构性张力'), '旧标签（大势顶张力名）废除');
    assert.ok(infoband.includes('大势未聚（无主张力）。'), '无世情时大势行=未聚（不拼张力）');
    assert.ok(infoband.includes('浪尖：血洗洛城'), '浪尖入大势句（目标名不露 id）');
    // leg25 b（A1b）：张力行不再写「烈度带词 + 百分比」——那个 % 实测只反映事件密度（rival 腿恒为满值），
    //   带词会暗示"引擎判断了天下张力"。改为直说可验证的事实：近 N 轮事件几件。
    assert.ok(!infoband.includes('烈度'), '张力行不再用「烈度」带词（它暗示引擎判断了张力）');
    assert.ok(infoband.includes('近10轮事件 0 件'), '张力行改说可验证事实：近 N 轮事件数（本夹具 events 为空）');
    assert.ok(!infoband.includes('>82<'), '推导出的百分比不再上面板（它只反映事件密度）');
    assert.ok(infoband.includes('魔涨道消（原文方向）'), '方向在张力行（原文措辞）');
    assert.ok(infoband.includes('正邪相争'), '张力极在张力行');
    assert.match(digest, /天时不作美/, '环境危险带经时局句副句（世情面，不属张力）');
});

test('K46 实体页·全册/镜头徽/分支/隶属/麾下（C7/C8 渲染面）', () => {
    const w = {
        version: 1, context: { world: 'x', tension: 0.5, positions: ['x'] },
        entities: [
            { id: 'e_f', kind: 'faction', name: '青龙会', location: 'x', branches: ['盐帮', '漕帮'] },
            { id: 'e_c1', kind: 'character', name: '弟子甲', location: 'x', parent: '盐帮' },
            { id: 'e_c2', kind: 'character', name: '弟子乙', location: 'x', parent: '青龙会' },
        ],
        weights: { e_f: 0.9, e_c1: 0.5, e_c2: 0.4 },
        agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0, simLog: [] },
    };
    const html = renderEntitiesHtml(w);
    assert.ok(html.includes('全部角色与势力（全册 3 · 本轮镜头 3）'), '全册/镜头计数');
    assert.ok(html.includes('在场'), '镜头徽');
    assert.ok(html.includes('分支：盐帮、漕帮'), '分支表展示');
    assert.ok(html.includes('隶属：盐帮') && html.includes('隶属：青龙会'), '角色隶属展示');
    // leg25 b（A1）：麾下成员序由「分量序」改**名号序**（确定性；片3「引擎不拿数值排序」的最后一处）。
    //   注意名号序是 **Unicode 码点序**（不是拼音序）：乙 U+4E59 < 甲 U+7532，故乙在前。
    assert.ok(html.includes('麾下：弟子乙、弟子甲'), '麾下成员派生（含分支成员，按名号序）');
    const text = html.replace(/<[^>]*>/g, '');
    for (const term of BLACKLIST) assert.ok(!text.includes(term), `实体页含禁词「${term}」`);
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

// ============ K41/链视图细案：编年五筛（A-16）+ 链视图渲染（A-15 渲染面） ============

function filterWorld() {
    const w = world();
    w.chronicle = [
        { id: 'ch_1_1', tick: 1, text: '盘算「买粮」推进：开仓放粮', kind: 'scheme' },
        { id: 'ch_1_2', tick: 1, text: '事件「边关扣货」——由盘算「买粮」而生，事发 边关', kind: 'major', eventRef: 'ev_1_1' },
        { id: 'ch_1_3', tick: 2, text: '事件「粮道拥堵」——沿「边关扣货」而来，事发 商路', kind: 'ripple', eventRef: 'ev_2_1' },
        { id: 'ch_1_4', tick: 3, text: '旧账：早先的某一行（无章）' },
    ];
    w.milestones = [{ id: 'm_30', span: [0, 30], counts: 8, titles: ['发兵催战'], ids: ['ev_0'] }];
    return w;
}

test('leg24 片1：抄书入口在界面下掉（补抽两枚 + 重抽一枚）+ 设定页清除演化层仍在', () => {
    const w = world();
    w.context.setting.frozen.canon.bookEntities = [
        { name: '薛铁衣', kind: 'character' },
        { name: '大虞偏将', kind: 'character' },
    ];
    const html = renderEntitiesHtml(w);
    assert.ok(!html.includes('data-action="refine-pending"'), '头部批量补抽按钮已下掉');
    assert.ok(!html.includes('data-action="refine-entity"'), '行内补抽按钮已下掉');
    assert.ok(!html.includes('补抽'), '「补抽」字样零残留（书随时可查，不需要按需抄）');
    const set = renderSettingHtml(w);
    assert.ok(set.includes('data-action="clear-evolution"'), '设定页清除演化层按钮仍在（它管引擎自己的演化层，不是抄书）');
    assert.ok(!set.includes('data-action="force-abstract"'), '「重新抽取设定」按钮已下掉（书变自动发现）');
    const settings = renderSettingsHtml(w, { config: CONFIG });
    assert.ok(!settings.includes('data-action="force-abstract"'), '设置页重抽按钮同批下掉');
    // A-3：新文案零禁词（全局视面扫描）
    const all = renderAll(w, { config: CONFIG, oldVolumes: VOLUMES });
    const text = deepStrings(all).map(textOnly).join('\n');
    for (const term of BLACKLIST) assert.ok(!text.includes(term), `含禁词「${term}」`);
});

test('K41/A-16②：五筛命中面——chips 全量、多选并集=行选择、无 kind 旧账恒显示 + 计数提示', () => {
    const all = renderChronicleHtml(filterWorld());
    assert.match(all, /sw2-ch-filter/);
    for (const f of ['all', 'scheme', 'major', 'ripple', 'shade', 'state']) {
        assert.ok(all.includes(`data-filter="${f}"`), `chips 缺 ${f}`);
    }
    // 缺省（null）= 全选：全部行都在，无旧账提示
    assert.ok(all.includes('开仓放粮') && all.includes('边关扣货') && all.includes('粮道拥堵') && all.includes('旧账：早先的某一行'));
    assert.ok(!all.includes('另有 '), '全选态不出现旧账提示');
    // 只看牵动：ripple 行 + 无章旧账行恒显示，其余隐藏；计数提示出现
    const ripple = renderChronicleHtml(filterWorld(), { filter: new Set(['ripple']) });
    assert.ok(ripple.includes('粮道拥堵'), 'ripple 行在');
    assert.ok(ripple.includes('旧账：早先的某一行'), '无 kind 旧账恒显示（不藏）');
    assert.ok(ripple.includes('已收进大事纪「发兵催战」'), 'A-16④：里程碑插行（卷标）筛选下恒显示');
    assert.ok(!ripple.includes('开仓放粮') && !ripple.includes('由盘算「买粮」而生'), '其余筛类行隐藏（大事行唯一子串）');
    assert.match(ripple, /另有 1 条旧账未分类，任何筛选下始终显示/);
    // 多选=并集：谋划+暗处
    const union = renderChronicleHtml(filterWorld(), { filter: new Set(['scheme', 'shade']) });
    assert.ok(union.includes('开仓放粮'), '谋划行在');
    assert.ok(!union.includes('粮道拥堵') && !union.includes('由盘算「买粮」而生'), '并集外隐藏');
});

test('K41/A-15 入口：事件行「链」按钮（data-action + data-chain + id 悬停）；非事件行无按钮', () => {
    const html = renderChronicleHtml(filterWorld());
    assert.ok(html.includes('class="sw2-chainbtn" data-action="open-chain" data-chain="ev_1_1"'), '链按钮带 data-action=open-chain 与 data-chain');
    assert.ok(html.includes('title="ev_1_1"'), '悬停 id 在位');
    assert.ok(!html.includes('data-chain="ch_1_1"') && !html.includes('data-chain="ch_1_2"'), '非事件行无链入口');
    // 闭环/涟漪平息行（chainRef 第十五棒补）：同款按钮；eventRef 优先于 chainRef
    const w2 = filterWorld();
    w2.chronicle.push({ id: 'ch_2_1', tick: 4, text: '事件「旧事」涟漪平息（链源已了结）', kind: 'ripple', chainRef: 'ev_9_9' });
    w2.chronicle.push({ id: 'ch_2_2', tick: 5, text: '兼有双引用行', kind: 'major', eventRef: 'ev_1_1', chainRef: 'ev_9_9' });
    const html2 = renderChronicleHtml(w2);
    assert.ok(html2.includes('data-action="open-chain" data-chain="ev_9_9"'), 'chainRef 行挂链（闭环/涟漪平息入口）');
    assert.ok(html2.includes('data-action="open-chain" data-chain="ev_1_1"'), 'eventRef 优先于 chainRef');
    assert.ok(!html2.includes('data-chain="ch_2_2"'), '行自身 id 不挂链');
});

test('第十五棒：历史闭环行（无 chainRef/eventRef）按行 id 解析挂链——旧账不篡改、纯渲染派生', () => {
    const w = filterWorld();
    w.chronicle.push(
        { id: 'ch_6_evc_ev_6_1', tick: 6, text: '事件「旧事」闭环（源盘算已结算）', kind: 'major' },
        { id: 'ch_7_evc2_ev_7_3', tick: 7, text: '事件「旧事」涟漪平息（链源已了结）', kind: 'ripple' },
        { id: 'ch_8_ag_8_1', tick: 8, text: '盘算行（不匹配 evc 模式）', kind: 'scheme' },
        { id: 'ch_9_evc_9_1', tick: 9, text: '残缺 id 形态（无 ev_ 事件段）', kind: 'major' },
    );
    const html = renderChronicleHtml(w);
    assert.ok(html.includes('data-action="open-chain" data-chain="ev_6_1"'), '历史闭环行解析挂链');
    assert.ok(html.includes('data-action="open-chain" data-chain="ev_7_3"'), '历史涟漪平息行解析挂链');
    assert.ok(html.includes('title="ev_6_1"'), '解析 id 只进悬停');
    assert.ok(!html.includes('data-chain="ch_8_ag_8_1"') && !html.includes('data-chain="ch_9_evc_9_1"'), '非 evc 模式不误挂');
    const text = String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    assert.ok(!/ev_[a-z0-9_]+/.test(text), '解析 id 不进可见文本（A-3）');
});

function chainWorld() {
    return {
        version: 1,
        context: { world: '江州', tension: 0.5, positions: ['江州'] },
        entities: [
            { id: 'e_gov', kind: 'faction', name: '江州官府', location: '江州' },
            { id: 'e_du', kind: 'character', name: '大虞偏将', location: '江州' },
        ],
        weights: {},
        agendas: [
            { id: 'a_1', owner: 'e_gov', goal: '筹备江州防务', stage: '征集', visibility: 'known', maxSteps: 5, progress: 2, memory: { promises: [], done: ['t1: 征调商行出力'], blocked: ['t2: 放弃（粮道已绝）'], turnsAlive: 2 } },
            { id: 'a_2', owner: 'e_du', goal: '打通边关商路', stage: '通商', visibility: 'concealed', maxSteps: 4, progress: 3, parentId: 'a_1', memory: { promises: [], done: ['t3: 守将首肯，车队放行'], blocked: [], turnsAlive: 3 } },
        ],
        events: [
            { id: 'ev_1_1', title: '官军出城引发恐慌', source: { type: 'plot', ref: 'a_2' }, position: '江州', ripples: [], links: { up: [], down: [] }, closed: false },
            { id: 'ev_2_1', title: '边关商路重开', source: { type: 'ripple', ref: 'ev_1_1' }, position: '江州', ripples: [], links: { up: ['ev_1_1'], down: [] }, closed: false },
            { id: 'ev_3_1', title: '江州粮价上涨', source: { type: 'ripple', ref: 'ev_2_1' }, position: '江州', ripples: [], links: { up: ['ev_2_1'], down: [] }, closed: true },
        ],
        chronicle: [],
        milestones: [],
        meta: { tick: 6 },
    };
}

test('K41/A-15 链视图渲染：珠链结构 + 事实措辞面 + 暗徽/结局徽 + 防御态', () => {
    const w = chainWorld();
    const chain = expandChain(w, 'ev_2_1');
    const html = renderChainViewHtml(chain, { world: w, volumes: [{ id: '卷A', info: '', fromTick: 1, toTick: 40 }] });
    assert.ok(html.includes('sw2_chain_view'));
    assert.match(html, /事件「边关商路重开」的来去/);
    assert.match(html, /沿「官军出城引发恐慌」而来/);            // root 源自（最近上游）
    assert.match(html, /由盘算「打通边关商路」而生/);            // 上游事件的来路（弧线）
    assert.match(html, /打通边关商路/);
    assert.match(html, /v-hidden">暗</);                          // 暗徽（concealed 弧线）
    assert.match(html, /在办/);
    assert.match(html, /委派自上/);
    assert.match(html, /最近一步：t3: 守将首肯，车队放行/);
    assert.match(html, /牵动 · 下沿/);
    assert.match(html, /江州粮价上涨/);
    assert.ok(!html.includes('data-action="read-volume"'), '热世界链无阅卷按钮（无纪）');
    // 防御态
    assert.match(renderChainViewHtml(null, { world: w }), /已无从检索/);
});

test('K41/A-15 里程碑穿透渲染：纪珠 + 聚合 parents + 卷区间装配阅卷 + 下沿余尾', () => {
    const w = chainWorld();
    w.events = w.events.filter((e) => e.id !== 'ev_1_1');         // 上游归档入纪
    w.milestones = [{ id: 'm_30', span: { from: 1, to: 30 }, counts: { events: 7 }, titles: ['穷山的来客'], ids: ['ev_1_1'], links: { up: [], down: ['ev_2_1'] } }];
    const chain = expandChain(w, 'ev_2_1');
    const vols = [
        { id: '卷一', info: '', fromTick: 1, toTick: 30 },
        { id: '卷二', info: '', fromTick: 31, toTick: 60 },
    ];
    const html = renderChainViewHtml(chain, { world: w, volumes: vols });
    assert.match(html, /大事纪/);
    assert.match(html, /第 1–30 轮 · 7 件事/);
    assert.match(html, /穷山的来客/);
    assert.match(html, /纪之源头已不可查/);
    assert.ok(html.includes('data-vol="卷一"'), 'span 区间命中的卷装配阅卷');
    assert.ok(!html.includes('data-vol="卷二"'), '区间外的卷不装配');
    assert.match(html, /另有后续在旧卷/, '下沿余尾收敛珠');
});

test('K41/A-3：链视图可见文本零禁词零代号（管理豁免区剥除外；热链与跨纪链双扫）', () => {
    const scan = (html) => {
        const stripped = String(html).replace(/<details[\s\S]*?<\/details>/g, '');
        const text = stripped.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
        for (const term of BLACKLIST) assert.ok(!text.includes(term), `链视图含禁词「${term}」`);
        assert.ok(!/ev_[a-z0-9_]+/.test(text), '链视图可见文本零事件代号');
        assert.ok(!/a_\d+/.test(text), '盘算代号不裸出（只进悬停/管理区）');
    };
    scan(renderChainViewHtml(expandChain(chainWorld(), 'ev_2_1'), { world: chainWorld() }));
    const w = chainWorld();
    w.events = w.events.filter((e) => e.id !== 'ev_1_1');
    w.milestones = [{ id: 'm_30', span: { from: 1, to: 30 }, counts: { events: 7 }, titles: ['穷山的来客'], ids: ['ev_1_1'], links: { up: [], down: ['ev_2_1'] } }];
    scan(renderChainViewHtml(expandChain(w, 'ev_2_1'), { world: w }));
});