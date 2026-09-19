// story-world-v2/test/panorama.test.js
// ★★leg94「说书」视图的判据（用户令：「我看不懂整个因果，还要你给我讲解我才能知道发生了什么」）
// 这一族的病与治都在**呈现层**，所以判据也咬呈现层，四条：
//   ① **能读**：一段话里没有引擎行话、没有机器号（可见文本口径 = 剥标签**连属性一起剥**）；
//   ② **有骨架**：同一件事的来路/过程/代价真的收进同一条线里（不是把账目换个地方重排）；
//   ③ **是排的不是编的**：每一句都能在账上找到出处（本文件逐句回查），且**同输入两次逐字节相同**；
//   ④ **不退化**：空世界/无事件有兜底，单件事的线不摆"一条线怎么走的"（版式口径）。
// ★★口径纪律（照本仓"判据要能反着咬"）：只断言"零引擎词/零机器号"会**空绿**（把正文清空也能过）
//   ⇒ 每组都配**正向断言**（关键人话必须出现）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPanorama, buildFaces, renderPanoramaHtml, stripEngine, bornTick } from '../src/panorama.js';
import { renderAll } from '../src/render.js';
// ★leg98 补四：并页那一页的组合器搬去了 `web/page-compose.js` —— 判据**直接调它**（不再自己拼一遍）
import { mergedMainHtml } from '../web/page-compose.js';
import { CHAIN_SETTLE } from '../src/settle.js';

// 可见文本：**剥标签（含属性）+ 解实体** —— 属性里的 id 是悬停豁免口，不算"印给玩家看"
const visible = (html) => String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');

const BARE_ID = /\b(?:ev_seed_\d+|ev_\d+_\d+|e_bk_\d+|e_p\d+|e_\d+_\d+|a_\d+_\d+|m_\d+|ch_\d[\w]*)\b/g;
const ENGINE_WORDS = ['盘算', '涟漪', '结算', '入局', '编年', '里程碑', '闭环', '事件', '满步', '谋划树', '产果', '归档'];

// 真账形状的夹具：一条三段因果线（有开篇谋划 + 逐步过程 + 代价 + 收场），加两件零散的事
function world() {
    return {
        version: 1,
        context: { world: '大荒', tension: 0.5, positions: ['大荒', '东海'], playerId: 'e_1_1' },
        entities: [
            { id: 'e_bk_1', kind: 'faction', name: '万法阁', location: '大荒' },
            { id: 'e_bk_2', kind: 'faction', name: '大虞', location: '大荒' },
            { id: 'e_1_1', kind: 'character', name: '薛铁衣', location: '大荒' },
            { id: 'e_1_2', kind: 'character', name: '黄坤', location: '大荒' },
        ],
        weights: {},
        agendas: [
            {
                id: 'a_1_1', owner: 'e_bk_1', goal: '引爆死煞核心同归于尽', stage: '玉石俱焚',
                visibility: 'concealed', maxSteps: 3, progress: 3, closed: true,
                memory: {
                    promises: [],
                    done: ['t2: 解开死煞核心第一层封印', 't3: 引动灵脉灵气冲刷核心', 't4: 释放全部死煞引发惊天爆炸'],
                    blocked: [],
                    turnsAlive: 3,
                },
            },
            {
                id: 'a_2_1', owner: 'e_1_2', goal: '击碎死煞绝阵并向薛铁衣复仇', stage: '殊死一搏',
                visibility: 'known', maxSteps: 4, progress: 2, closed: false,
                memory: { promises: [], done: ['t3: 雷息灌注刀身，斩碎缚灵锁阵核心节点'], blocked: ['t4: 放弃（缚灵锁阵已被斩碎，独吞灵脉彻底破产）'], turnsAlive: 2 },
            },
        ],
        events: [
            { id: 'ev_1_1', title: '死煞核心第一层解封', source: { type: 'state' }, position: '大荒', ripples: ['e_bk_1'], links: {}, closed: true, closedAt: 3 },
            { id: 'ev_2_1', title: '大盘谷血战爆发', source: { type: 'plot', ref: 'a_1_1' }, position: '大荒', ripples: ['e_bk_1', 'e_1_1'], links: {}, closed: true, closedAt: 4 },
            { id: 'ev_3_1', title: '雷法激荡大盘谷阵眼', source: { type: 'plot', ref: 'a_2_1' }, position: '大荒', ripples: ['e_1_2', 'e_1_1'], links: {}, closed: false },
            { id: 'ev_seed_1', title: '万魔之祖主持接引仪式', source: { type: 'seed' }, position: '魔渊深处', ripples: ['e_bk_1'], links: {}, closed: false },
            { id: 'ev_seed_2', title: '白狐公主隐匿历练', source: { type: 'seed' }, position: '人族宗门', ripples: [], links: {}, closed: false },
            // ★leg95：一件**模型判过收场**的事（`closedBy:'model'` + 它给的理由）——判据⑤要验"留痕在悬停里"。
            //   它的标题与理由也一并进"逐句可回查"的池子（下面 ③ 那条判据按 title/why 分别回查）。
            { id: 'ev_4_1', title: '缚灵锁阵彻底破灭', source: { type: 'ripple', ref: 'ev_3_1' }, position: '大荒', ripples: ['e_1_2'], links: {}, closed: true, closedAt: 5, closedBy: 'model', closedWhy: '锁阵已碎，这一段过去了' },
        ],
        chronicle: [
            { id: 'ch_1_1', tick: 1, text: '事件「死煞核心第一层解封」——由世界处境而生，事发 大荒，牵动 万法阁', kind: 'state', eventRef: 'ev_1_1' },
            { id: 'ch_2_1', tick: 2, text: '盘算「引爆死煞核心同归于尽」推进：解开死煞核心第一层封印', kind: 'scheme' },
            { id: 'ch_2_2', tick: 2, text: '事件「大盘谷血战爆发」——由盘算「引爆死煞核心同归于尽」而生，事发 大荒，牵动 万法阁、薛铁衣', kind: 'major', eventRef: 'ev_2_1' },
            { id: 'ch_2_3', tick: 2, text: '因事而生：黄坤 由「ev_2_1」生「击碎死煞绝阵并向薛铁衣复仇」', kind: 'scheme' },
            { id: 'ch_3_1', tick: 3, text: '事件「大盘谷血战爆发」闭环（源盘算已结算）', kind: 'major', chainRef: 'ev_2_1' },
            { id: 'ch_3_2', tick: 3, text: '盘算「击碎死煞绝阵并向薛铁衣复仇」推进：雷息灌注刀身，斩碎缚灵锁阵核心节点', kind: 'scheme' },
            { id: 'ch_3_3', tick: 3, text: '事件「雷法激荡大盘谷阵眼」——由盘算「击碎死煞绝阵并向薛铁衣复仇」而生，事发 大荒，牵动 黄坤、薛铁衣', kind: 'major', eventRef: 'ev_3_1' },
        ],
        milestones: [
            { id: 'm_10', span: { from: 1, to: 10 }, counts: { events: 2 }, titles: ['死煞核心第一层解封', '大盘谷血战爆发'], ids: ['ev_1_1', 'ev_2_1'], links: { up: [], down: [] } },
        ],
        meta: { tick: 4, simLog: [] },
    };
}

test('★★leg94 · 说书①：**一段话里没有行话、没有机器号**（可见文本口径）', () => {
    const html = renderPanoramaHtml(world());
    const v = visible(html);
    for (const w of ENGINE_WORDS) assert.ok(!v.includes(w), `★说书正文里不许出现引擎词「${w}」`);
    assert.deepEqual(v.match(BARE_ID) || [], [], '★说书正文里不许出现机器号');
    // 反向自证（防"把正文清空"也过）：关键人话必须在
    assert.ok(v.includes('万法阁'), '主使的名号要在');
    assert.ok(v.includes('引爆死煞核心同归于尽'), '那件谋划的原话要在');
    assert.ok(v.includes('解开死煞核心第一层封印'), '逐步过程的原话要在');
    assert.ok(v.includes('大荒'), '地点要在');
    // ★leg95d：原断言是「'还开着' 要在」（那一态的词）——现按**新口径**断言：状态词的定稿是
    //   「还在往下长／挂着没了结／已收场」，"还开着"这个词已从全页退场（它与徽两个说法）。
    assert.ok(/还在往下长|挂着没了结/.test(v), '线的状态要如实标出（徽那套词）');
    // 剥离器的自证：它认得这些行话，且认得清"去掉词、留下句子"
    assert.equal(stripEngine('盘算「X」满步结算：结清（期满收摊，终结产果 §4.4④）'), '「X」：结清');
    assert.equal(stripEngine('事件「Y」闭环（源盘算已结算）'), '「Y」');
});

test('★★leg94 · 说书②：**同一件事的来路/过程/代价收进同一条线**（不是换个地方重排账目）', () => {
    const { threads, stats } = buildPanorama(world());
    const t = threads.find((x) => x.name === '引爆死煞核心同归于尽');
    assert.ok(t, '万法阁那条线必须自成一条（它的开篇谋划就是线名）');
    assert.equal(t.actor, '万法阁', '主使取谋划的主人');
    // ★分组口径（真账试读后定的两条边）：①同一批人（同一 owner）的线并成一条；②`state` 生的处境根
    //   **只在"牵动名单里恰好只有一方、且那一方账上只有一条线"时**并进它（真账：`死煞之气外泄` 牵动万法阁）。
    //   不并的话真账上 42 条谋划会碎成 40 多条线，比账本还难读。⇒ 这一条线 = 处境根 + 谋划产果 = 2 件。
    assert.equal(t.count, 2, '处境根 + 它推出来的那件事 = 2 件');
    assert.deepEqual(t.kicker.steps.map((s) => s.text), ['解开死煞核心第一层封印', '引动灵脉灵气冲刷核心', '释放全部死煞引发惊天爆炸'], '逐步过程取自谋划记下的原话');
    assert.equal(t.events[0].why, '当时的局面自己拱出来的', '来路三型之一');
    assert.ok(t.events.some((e) => e.why === '由万法阁的打算「引爆死煞核心同归于尽」推出来'), '来路三型之二（由谋划推出来）');
    // 代价那一格：取的是"卡住/放弃"那句原话（不是收场话——收场话曾被误当代价，见模块注释）
    const t2 = threads.find((x) => x.name === '击碎死煞绝阵并向薛铁衣复仇');
    assert.ok(t2, '黄坤那条线自成一条');
    assert.ok(t2.costs.some((c) => c.text.includes('独吞灵脉彻底破产')), `★代价要收进"卡住的地方"：拿到 ${JSON.stringify(t2.costs)}`);
    assert.ok(!threads.some((x) => x.costs.some((c) => /^「.*」$/.test(c.text))), '★收场话不许冒充代价');
    // 统计口径（★leg95：夹具加了一件"模型判过收场"的事 ⇒ 5 → 6，改这个数要有意识）
    assert.equal(stats.events, 6, '六件事');
    assert.equal(stats.threads, threads.length, 'stats.threads 与列表同源');
});

test('★★leg94 · 说书③：**排的不是编的**（逐句可回查账上原文）＋ 同输入逐字节相同', () => {
    const w = world();
    const { threads } = buildPanorama(w);
    const pool = [
        ...w.events.map((e) => e.title),
        ...w.agendas.map((a) => a.goal),
        ...w.agendas.flatMap((a) => [...(a.memory?.done || []), ...(a.memory?.blocked || [])]).map((s) => String(s).replace(/^t\d+[:：]\s*/, '')),
        ...w.chronicle.map((c) => stripEngine(c.text)),
        ...w.entities.map((e) => e.name),
        ...w.context.positions,
    ];
    const has = (s) => pool.some((p) => p.includes(s) || s.includes(p));
    for (const t of threads) {
        assert.ok(has(t.name), `线名「${t.name}」必须在账上找得到`);
        for (const e of t.events) {
            assert.ok(has(e.title), `事「${e.title}」必须在账上找得到`);
            if (e.why && !/^接着|^当时/.test(e.why)) {
                const core = (e.why.match(/「([^」]+)」/) || [])[1];
                if (core) assert.ok(has(core), `来路里引的那句「${core}」必须在账上找得到`);
            }
        }
    }
    // 确定性（本仓纪律：同输入两次逐字节一致）
    assert.equal(renderPanoramaHtml(w), renderPanoramaHtml(w), '★同输入两次渲染必须逐字节相同');
    assert.equal(bornTick('ev_7_2'), 7);
    assert.equal(bornTick('ev_seed_3'), 0, '开局种子算第 0 轮');
});

test('★★leg94 · 说书④：**不退化**——空世界/无事件有兜底；单件事的线不摆"怎么走的"', () => {
    assert.ok(renderPanoramaHtml(null).includes('还没有开档'), '空世界有兜底话');
    const empty = renderPanoramaHtml({ version: 1, entities: [], events: [], agendas: [], chronicle: [], milestones: [], context: {}, meta: { tick: 0 } });
    assert.ok(empty.includes('还没长出可讲的事'), '无事件有兜底话');
    assert.deepEqual((visible(empty).match(BARE_ID) || []), [], '兜底页也不许露机器号');
    // 单件事的线：进"零散的事"，且**不摆**"一条线怎么走的"（否则同一句话印三遍）
    const html = renderPanoramaHtml(world());
    assert.ok(html.includes('零散的事'), '单件事的线收进零散清单');
    const oneshot = html.slice(html.indexOf('零散的事'));
    assert.ok(oneshot.includes('万魔之祖主持接引仪式'), '零散的事里仍找得到它');
    const single = buildPanorama(world()).threads.find((t) => t.name === '万魔之祖主持接引仪式');
    assert.equal(single.count, 1);
    // 主线名单里不许出现单件事的线（判据⑧：真账 27 条里 14 条只有一件事，铺开来比账本还吵）
    const mainPart = html.slice(0, html.indexOf('零散的事'));
    assert.ok(!mainPart.includes('万魔之祖主持接引仪式'), '★单件事的线不进主线名单');
});

test('★★leg95 · 说书⑤：**"开没开着"只在线头说一次，点层一个字都不印**（用户令「开没开着不应该挂在事件上」）', () => {
    // 用户第一轮指认：「链头没法完结但是为什么每个事件都写个还开着，这些事件都是已经完成了呀，这不是误导人吗？」
    // 本棒第一刀只把判词改成三态、**位置仍挂在每一件事上** ⇒ 用户当场驳回：「**开没开着不应该挂在事件上**」。
    // 定稿口径（层次纪律）：**"开没开着"是一条线的性质，一件事是时点（落账那天就发生了）**，
    //   ⇒ 点层只留事实（轮次/事名/来路/地点/牵动的人），状态只在线头那枚徽上说一次。
    const html = renderPanoramaHtml(world());
    const at = html.indexOf('一条线怎么走的');
    assert.ok(at > 0, '前置：夹具里得有一条多件事的线（否则本判据是空绿）');
    const body = html.slice(at, html.indexOf('</ul>', at));
    // ★口径：判"印没印"要按**可见文本**（`visible()` 剥标签连属性一起剥）——属性里的号与留痕是**豁免口**
    //   （本判据第一版直接拿 HTML 串查 ⇒ 把悬停 `title="这一段已收场（第 3 轮）…"` 也算成"印了"，当场红。
    //     纪律照旧：判据红了先怀疑自己的尺子）。
    const shown = visible(body);
    for (const word of ['还开着', '没人再提了', '已了结', '已收场']) {
        assert.ok(!shown.includes(word), `★点层不许印状态判词「${word}」——它是线的性质，不是事的性质`);
    }
    // 反向：线头必须**说**（状态只在那儿说一次）
    assert.ok(/还在往下长|挂着没了结|已收场/.test(visible(html)), '线头那枚徽必须给出这条线的状态');
    // 点层不许用状态样式类（防止换个 class 又把状态印回可见文本）
    assert.ok(!/sw2-pan-(open|idle|done)(?!")/.test(body), '★点层不许用状态样式类（open/idle/done）');
    // ★★★leg95d：**"零散的事"那一支也是"点层"**——它走的是另一段渲染代码，本棒第一刀漏了它
    //   （真账渲染当场照出来：那三条各自还印着「还开着」）。⇒ 同一条纪律要**两支都咬**。
    //   ★切法：按**区块标记**定位（`sw2-pan-oneshot` 是"零散的事"那一支自己的类）——前三版都是尺子错：
    //     ① 切到页尾（把页脚那句"已经了结"算进来）② `indexOf('零散的事')` 命中的是**提示语里**那句
    //     ③ `indexOf('sw2-pan-sec')` 命中的是**「还开着的线」那个区块头**（同一个类两支都用）
    //     ⇒ 定稿：找那一支**独有的**类名。**判据红了先怀疑尺子**（本仓 §0.2 那三次的同一族）。
    const oneshotAt = html.indexOf('sw2-pan-oneshot');
    assert.ok(oneshotAt > 0, '前置：夹具里得有"零散的事"那一块（否则这一半是空绿）');
    const oneshot = visible(html.slice(oneshotAt, html.indexOf('</ul>', oneshotAt)));
    assert.ok(oneshot.length > 10, '前置：这一块真的渲染出内容了');
    assert.ok(!/还开着|已了结|已收场|没人再提了/.test(oneshot), `★"零散的事"里也是点层，一个字都不许印状态：${oneshot.slice(0, 120)}`);
    // ★但**悬停豁免口还在**：模型判过的那件事，鼠标停上去看得到"这一段已收场＋它的理由"（给查账的人）
    //   （★口径又一处：`title` 前面**没有空格**，第一版正则写 `<li title=` 当场红——判据红了还是先看尺子）
    assert.ok(/<li title="[^"]*已收场[^"]*"/.test(html), '★已收场的留痕必须留在悬停里（不占读者视线，但查得到）');
});

test('★★leg95c · 说书⑧：**线头那枚徽只说状态，一个数都不带**（用户令「这个 7 还是事件的数量啊」）', () => {
    // 用户第三次指认：徽上写着「还在往下长 · 7 件没了结」——那 7 是**事件计数**，而**同一行左边
    // 已经印着「第 0–12 轮 · 8 件事」**（数还说重了）。★纪律：**说状态的地方只说状态，说数量的地方只说数量。**
    const html = renderPanoramaHtml(world());
    const badges = html.match(/<span class="sw2-pan-badge[^"]*">[^<]*<\/span>/g) || [];
    assert.ok(badges.length >= 2, `前置：夹具里得有几枚徽（实得 ${badges.length}）`);
    for (const b of badges) {
        const text = b.replace(/<[^>]*>/g, '');
        assert.ok(!/\d/.test(text), `★徽上不许出现数字（它是状态，不是计数）：${text}`);
        assert.ok(/^(还在往下长|挂着没了结|已收场)$/.test(text), `★徽只许是三态之一，不许夹带别的话：${text}`);
        assert.ok(!/件|条|个/.test(text), `★徽上不许带量词（"件/条/个"都是计数的话）：${text}`);
    }
    // 反向：数量得在**它该在的地方**（线头那行左边），不许因为"徽上删了"就整条丢掉
    assert.ok(/第 \d+[–-]\d+ 轮 · \d+ 件事|第 \d+ 轮 · \d+ 件事/.test(visible(html)), '★数量仍要在轮次那一格印出来（删徽上的数 ≠ 删掉这个信息）');
});

test('★★leg95d · 说书⑩：**"没讲完的事"整块不许回潮**（用户令「没讲完的事又是啥，这也不对吧」）', () => {
    // 用户第四次指认：那一段列着「第 1 轮 神秘猎手现身大荒 / 第 9 轮 南荒宿主绝境反扑爆出系统本源」——
    //   ★**全都发生过了**，凭什么叫"没讲完"？两条病：
    //     ① **"没讲完"是账目行话**（真正的意思只是"还没标了结"）；② 那些标题**本来就印在上面那条时间线里**。
    //   ⇒ 定稿：**整块删除**（线头那行已给计数、时间线已给过程；查一手账目去「史卷」）。
    //   ★这条取代了 leg95 的判据⑥（那条断言的是"种子前提不进这一格"——现在这一格整个没了）。
    //   ⚠编号：leg96 那一棒已占用判据⑨（徽上"还在往下长"的信号用错）⇒ 本笔是⑩。
    const html = renderPanoramaHtml(world());
    for (const bad of ['没讲完的事', '还开着的口子', '件悬着', '件了结']) {
        assert.ok(!visible(html).includes(bad), `★不许回潮：可见文本里出现「${bad}」`);
    }
    // 反向：删的只是"账目口径的复述"，不是信息本身——计数与过程都还在
    assert.ok(/第 \d+[–-]\d+ 轮 · \d+ 件事|第 \d+ 轮 · \d+ 件事/.test(visible(html)), '线头那行仍要给出轮次与件数');
    assert.ok(visible(html).includes('一条线怎么走的'), '时间线仍在（每一件事的经过在那儿）');
    // ★统计行：读者要的是"几条线还在往下长"，不是"N 件悬着"（账目口径）。
    //   ★leg95d 又改一处：统计行的词**必须与线头那枚徽同一套**——原来写「13 条还开着」而徽上是
    //     「11 还在往下长 + 2 挂着没了结」⇒ **同一页两个说法**（读者得自己换算）。
    assert.ok(/\d+ 还在往下长/.test(visible(html)), '统计行用徽那套词（"还在往下长"）');
    assert.ok(!/\d+ 条还开着/.test(visible(html)), '★统计行不许再说"还开着"（与徽两个说法）');
});

test('★★leg95 · 说书⑦：那个"最近几轮"的窗口与引擎的 CHAIN_SETTLE **同值**（两处一个数）', () => {
    // ★为什么要有这条：`panorama.js` 是**零 import 的真叶子**（不能 import `settle.js` 的常量），
    //   于是"最近几轮算还在长"这个数**只能写成局部常量** ⇒ 必须用判据把两边钉在一起，
    //   **不许靠注释约定**（本仓"一个数两把尺子"栽过多次）。
    const src = readFileSync(new URL('../src/panorama.js', import.meta.url), 'utf8');
    const m = /const RECENT_GROWTH_WINDOW = (\d+);/.exec(src);
    assert.ok(m, 'panorama.js 里必须有 RECENT_GROWTH_WINDOW 这一个常量');
    assert.equal(Number(m[1]), CHAIN_SETTLE,
        `★两边必须同值：panorama 的窗口 ${m[1]} vs 引擎的涟漪平息窗 ${CHAIN_SETTLE}`
        + '（改一个必须改另一个——否则"还在往下长"与引擎"不再长"的判断会各说各话）');
});

test('★★leg96 · 说书⑨：线头那枚徽的「还在往下长」问的是**长没长出岔**，不是"最近有没有事落在这条线上"', () => {
    // ★接手棒修的一处**判据用错信号**（真账取证：装置 `F:/deepseek/tmp/leg96-badge-verify.mjs`）：
    //   旧法 `growing = 最晚一件事的轮次 > 世界轮次 − 窗口` —— 它量的是"**最近有没有事落在线上**"。
    //   真账当场证死：还没收场的 39 条线里 **9 条被判反**（A 局 4 · B 局 5），它们**一个下游都没有**
    //   （`血屠魔君现身南疆掀起杀戮` / `菩提禅院钟声震荡大荒` / `玄鹤祭出法旨血洗长城防线` …），
    //   只因为"刚落账一件事"就被印成"还在往下长"——**那时它一个岔都还没长出来**。
    //   ★这正是用户连着三次指认的那个病根的同族（leg95 §10：**一条信息只许住在它该住的那一格**）：
    //     "还在往下长"是**结构性事实**（有没有新事从它长出来），不是"最近热闹过"。
    const w = world();
    const { threads } = buildPanorama(w);
    const win = CHAIN_SETTLE;
    const tick = w.meta.tick;
    const kidsOf = new Map();
    for (const e of w.events) {
        const ups = [...(Array.isArray(e.links?.up) ? e.links.up : []), e.source?.type === 'ripple' ? e.source.ref : null];
        for (const u of ups) { if (!u) continue; if (!kidsOf.has(u)) kidsOf.set(u, []); kidsOf.get(u).push(e); }
        }
    const bornIn = (e) => (/^ev_seed_/.test(e.id) ? 0 : Number((/^ev_(\d+)_/.exec(e.id) || [])[1] ?? 0));
    // ① 结构口径的正例：这条线上**最近几轮真的长出了新事**（ev_4_1 接在 ev_3_1 后面）⇒ 必须印"还在往下长"
    const sprouted = threads.find((t) => t.events.some((e) => e.id === 'ev_3_1'));
    assert.ok(sprouted, '前置：夹具里得有一条"接着上一件往下长"的线');
    assert.equal(sprouted.growing, true, '★线上有最近长出来的新事 ⇒ 还在往下长');
    assert.ok(/sw2-pan-badge live">还在往下长</.test(renderPanoramaHtml(w)), '★徽上要真的是"还在往下长"那一态');
    // ② ★反向断言（**这一条在修之前是红的**）：刚落账、还没长出岔的线**不许**自称"还在往下长"。
    //    夹具里的 `ev_seed_2` 出账 0 轮、没有任何下游 ⇒ 旧法说"还在往下长"，结构口径说"挂着没了结"。
    const leaf = threads.find((t) => t.events.some((e) => e.id === 'ev_seed_2'));
    assert.ok(leaf, '前置：夹具里得有那条"书里早埋着、还没长出岔"的线（`ev_seed_2`）');
    assert.ok(!leaf.events.some((e) => e.closed), '前置：这条线上的事还没收场（否则它根本不印状态）');
    assert.equal(leaf.growing, false,
        '★没有下游、只是"刚落账"的线不许印「还在往下长」——那是把"最近有事落在线上"当成了"有事从它长出来"');
    // ③ 总闸（正反都咬）：凡是印了 `live` 那一态的线，**必须真有一条新事是在窗口内出生的**
    for (const t of threads) {
        if (!t.growing) continue;
        const ok = t.events.some((x) => (kidsOf.get(x.id) || []).some((k) => bornIn(k) > tick - win));
        assert.ok(ok, `★线「${t.name}」印了"还在往下长"，但最近 ${win} 轮里没有任何新事从它长出来（旧法就是在这里判反的）`);
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ★★★leg97：「面」四层（设计交接 `docs/session-handoff-2026-09-21-leg96e-design.md` §1）
//   用户定的四条口径：① 面 ＝ 空间上的一个地方（"人"不当切口）② 那批线定稿叫「各处散落」
//   ③ 块不是层、是面与面之间的关系；大势统领不了面 ④ 四层这个形态用户已看过演示并说「不错」
//   ★下面这一族的夹具是**照真账的形状**造的（多线交会的地方 ／ 只有一条线路过的地方 ／
//     一个地方都没记的线 ／ 一个势力横跨两处），并且每条判据都配了**反向自证**。
// ═══════════════════════════════════════════════════════════════════════════════

// 真账形状的夹具：2 个多线交会的面（大荒 / 玄龟岛）＋ 1 处单线地点（魔渊深处）＋ 1 条没记地点的线
//   ★造夹具时**踩到两次**（如实留档，都是"线的连通分量"那条口径咬的）：
//     ① 两个 `seed` 事若牵动同一个势力，`buildPanorama` 会把它们**并成一条线**（同主人的几条线并成一条）
//        ⇒ 想要"两处各自一条线"，牵动的名单就不能撞；
//     ② 单线地点必须是**那个地方只有一条线到过**——多一条线到过它就成了面（判据⑫的反向自证正是这么咬的）。
function faceWorld() {
    return {
        version: 1,
        context: {
            world: '大荒', tension: 0.5, playerId: 'e_1_1',
            positions: ['大荒', '玄龟岛', '魔渊深处', '西漠灵山', '九霄'],
            setting: { frozen: { canon: { situation: '复苏历：黄金大世，天骄横出，灵气井喷。' } } },
        },
        entities: [
            // ★驻地把 `大荒` 与 `玄龟岛` 的差别写清楚（真账实测的那两条口径，见 `buildFaces` 的注释）：
            //   势力的驻地是**一个地方的名字**（`万法阁` 驻 `东海浮空岛`），但它自己**不是**地方
            //   ⇒ 不许因为"名字出现在位置表里"就把势力剔掉；而 `界渊长城` 那个形状（**驻地等于自己名字**）
            //   才是真地名，必须剔。夹具里两支都要有，判据才咬得住。
            { id: 'e_bk_1', kind: 'faction', name: '万法阁', location: '大荒' },
            { id: 'e_bk_2', kind: 'faction', name: '大虞', location: '未明' },
            { id: 'e_bk_3', kind: 'faction', name: '界渊长城', location: '界渊长城' },
            // ★名字撞车那一族（真账 B 局实测）：`界渊长城` 的驻地写成**短名** `长城`、名字里含着驻地；
            //   `大虞` 则与它跨到的那个**地方**同名（同一个词指两样东西）。两条都要在夹具里，判据才咬得住。
            { id: 'e_bk_4', kind: 'faction', name: '长城关楼', location: '长城' },
            { id: 'e_bk_5', kind: 'faction', name: '大虞', location: '未明' },
            { id: 'e_1_1', kind: 'character', name: '薛铁衣', location: '大荒' },
            { id: 'e_1_2', kind: 'character', name: '血屠魔君', location: '南疆' },
        ],
        weights: {}, agendas: [],
        // ★`ripples` 里装的是**实体号**（真账实测：世界层是 `["e_bk_7"]`，`buildPanorama` 渲染时才换成名号）
        //   —— 手写夹具时**先取证再落笔**（本棒第一版把名号直接写进来 ⇒ `nameOf` 查不到 ⇒
        //   `t.events[].ripples` 全空、桥一个都不剩。**别拿"我以为的形状"当账上的形状**）。
        events: [
            // ―― 面① 大荒：3 条线到过
            { id: 'ev_1_1', title: '大盘谷血战爆发', source: { type: 'ripple', ref: 'ev_0_1' }, position: '大荒', ripples: ['e_bk_1', 'e_1_1'], links: {}, closed: false },
            { id: 'ev_0_1', title: '死煞核心崩毁前兆', source: { type: 'state' }, position: '大荒', ripples: ['e_bk_1', 'e_bk_2'], links: {}, closed: false },
            { id: 'ev_2_1', title: '剑气撕裂大荒边界', source: { type: 'ripple', ref: 'ev_1_1' }, position: '大荒', ripples: ['e_bk_2', 'e_1_1'], links: {}, closed: false },
            { id: 'ev_7_1', title: '大虞法旨强压死煞', source: { type: 'seed' }, position: '大荒', ripples: ['e_bk_2', 'e_1_1'], links: {}, closed: false },
            // ★这一件是**判据⑮那半边的关键**：它是**另一条线**（`灵鹤上人` 那条，**不落脚在大荒**），
            //   但它**发生在大荒** ⇒ 面头那个"几件事发生在此"必须把它算进去。
            //   （本棒第一版把这一格写成"落脚线在此的事之和"⇒ 漏掉它；夹具若造得太对称，判据咬不住，
            //    所以这一件是特意加的：**只有"按地方数"才数得出 6，按"落脚线"只能数出 3**。）
            //   ★牵动的名单**不许撞**（撞了就会被并进同一条线，那是"线的连通分量"那条口径）。
            { id: 'ev_6_2', title: '灵鹤上人夜探大荒', source: { type: 'seed' }, position: '大荒', ripples: ['e_1_2'], links: {}, closed: false },
            // ★这条线**落脚在 西漠灵山**（它在那儿事最多）、在 大荒 只是**路过一件** ⇒
            //   面头那句"几件事发生在此"必须把这一件算进去，而"落脚在大荒的线干的件数"不算它。
            //   判据⑮要的正是**这两个数不相等**（本棒第一版量错了东西时，它们就会相等/漏掉）。
            { id: 'ev_6_5', title: '灵鹤上人西行入西漠', source: { type: 'ripple', ref: 'ev_6_2' }, position: '西漠灵山', ripples: ['e_1_2'], links: {}, closed: false },
            { id: 'ev_6_6', title: '灵鹤上人在灵山结庐', source: { type: 'ripple', ref: 'ev_6_5' }, position: '西漠灵山', ripples: ['e_1_2'], links: {}, closed: false },
            // ―― 面② 玄龟岛：2 条线到过（其中 `万魔之祖` 那条线的落脚面就是这里）
            { id: 'ev_2_2', title: '玄龟岛灵脉暴动', source: { type: 'seed' }, position: '玄龟岛', ripples: ['e_bk_1', 'e_bk_2'], links: {}, closed: false },
            // ―― 单线地点：只有「万魔之祖完成初步接引」这一条线到过
            { id: 'ev_3_1', title: '万魔之祖完成初步接引', source: { type: 'seed' }, position: '玄龟岛', ripples: ['e_bk_1'], links: {}, closed: false },
            { id: 'ev_3_2', title: '接引法阵在魔渊深处点亮', source: { type: 'ripple', ref: 'ev_3_1' }, position: '魔渊深处', ripples: ['e_bk_1'], links: {}, closed: false },
            { id: 'ev_3_3', title: '魔渊深处传出诵经声', source: { type: 'ripple', ref: 'ev_3_2' }, position: '魔渊深处', ripples: ['e_bk_3'], links: {}, closed: false },
    // ―― 一条只在一处的零散线（不进任何面）
    { id: 'ev_4_1', title: '菩提禅院钟声震荡大荒', source: { type: 'seed' }, position: '西漠灵山', ripples: ['e_1_2'], links: {}, closed: false },
            // ―― 一个地方都没记的线
            { id: 'ev_5_1', title: '慈航医堡远眺大荒劫气', source: { type: 'seed' }, ripples: [], links: {}, closed: false },
        ],
        chronicle: [], milestones: [], meta: { tick: 6, simLog: [] },
    };
}

test('★★leg97 · 说书⑪：**自证闸**——线 N 条 = 面内 ＋ 单线地点 ＋ 散落，掉出页面 0（设计交接 §3.1）', () => {
    // ★这条闸是本棒最值钱的一处（它在 leg96 当场咬出两个真错：漏排的线、被推两遍的单线地点）。
    //   口径：三个分类**互斥且穷尽**——每条线**恰好**一个落脚处（面 ＞ 它自己的地点 ＞ 无）。
    const w = faceWorld();
    const { threads } = buildPanorama(w);
    const m = buildFaces(w, threads);
    const c = m.census;
    assert.equal(c.total, threads.length, '总条数取的就是账上算出来的那些线');
    assert.equal(c.sum, c.total, `★闸必须平：${c.routed}(面内)+${c.lone}(单线地点)+${c.scattered}(散落) ≠ 总 ${c.total}`);
    assert.deepEqual(m.dropped, [], '★不许有一条线掉出页面');
    // 互斥：面内 ∪ 单线地点 ∪ 散落 = 全部线，且两两不相交
    const inFace = new Set(m.faces.flatMap((f) => f.lines.map((t) => t.id)));
    const onLone = new Set(m.others.filter((o) => o.place).map((o) => o.line.id));
    const scattered = new Set(m.others.filter((o) => !o.place).map((o) => o.line.id));
    assert.equal(inFace.size + onLone.size + scattered.size, threads.length, '★三个分类不许有交集（有交集就是"同一条线推了两遍"）');
    for (const id of inFace) assert.ok(!onLone.has(id) && !scattered.has(id), `★线 ${id} 同时出现在两类里`);
    // ★反向自证：把一条线从三个分类里**摘掉**，闸必须当场不平（否则这条判据是空绿）
    const broken = buildFaces(w, threads);
    broken.census.routed -= 1;
    broken.census.sum = broken.census.routed + broken.census.lone + broken.census.scattered;
    assert.notEqual(broken.census.sum, broken.census.total, '★反向自证：少算一条，闸就不平了');
    // 闸的**读数**也要印在页面上（藏在代码里的闸咬不住读者没看见的错）
    const html = renderPanoramaHtml(faceWorld());
    assert.ok(/自证：线 <b>\d+<\/b> 条 = 面内 \d+ ＋ 单线地点 \d+ ＋ 散落 \d+/.test(html), `★自证闸必须印在页脚：${visible(html).slice(-160)}`);
    assert.ok(visible(html).includes('掉出页面 0'), '★"掉出页面 0"那半句也要印（它是这条闸的结论）');
});

test('★★leg97 · 说书⑫：**面 ＝ 一个地方**——到达 ≥2 条线才立；只有一条线路过的地方不当面', () => {
    // 用户口径①（「以人物为切口感觉就不像面了」）＋ 设计交接 §1.1：面是**空间上的一个地方**，
    //   "人"只在线里当主使/牵动的人。判据咬两半：①立起来的面**真有多条线**；②单线地点**不当面**。
    const w = faceWorld();
    const { threads } = buildPanorama(w);
    const m = buildFaces(w, threads);
    assert.deepEqual(m.faces.map((f) => f.place), ['大荒', '西漠灵山', '玄龟岛'], `★只有装了 2 条线以上的地方才立起来；实得 ${m.faces.map((f) => f.place).join('、')}`);
    for (const f of m.faces) assert.ok(f.lines.length >= 2, `★面「${f.place}」只装了 ${f.lines.length} 条线——那是单线地点，不是面`);
    // 单线地点：**地名照印**（设计交接 §1.1 第 2 条），且挂在它那条线的落脚面里
    const lone = m.faces.find((f) => f.place === '玄龟岛').lone;
    assert.deepEqual(lone.map((l) => l.place), ['魔渊深处'], `★"这一处另有 N 处单线地点"要点名（地名照印）：${JSON.stringify(lone.map((l) => l.place))}`);
    assert.equal(lone[0].line.events[0].title, '万魔之祖完成初步接引', '★单线地点要指明"是哪一条线路过"（印它起头那件事，读者才知道那是什么事）');
    assert.equal(lone[0].line.places.filter((p) => p === '魔渊深处').length, 1, '★单线地点只能被**这一条线**到达');
    // 面头那一行必须照设计交接 §1 的原话（几条线在这里交会 · 几件事发生在此）
    //   ★数字按**实测**标定（本棒当玩家读真账后定的口径）：大荒 3 条线（2 条落脚 + 1 条路过）／5 件事；
    //     玄龟岛 2 条线／2 件事，另有 1 处单线地点。
    //   ★`\s*` 是必须的：`visible()` 把标签换成空格，`</b>` 与正文之间会多出一个空格
    //     （第一版按"紧凑字面量"写当场红——**判据红了先怀疑自己的尺子**）。
    const html = renderPanoramaHtml(faceWorld());
    const v = visible(html);
    assert.ok(/大荒\s*3\s*条线在这里交会（\s*2\s*条落脚在此\s*·\s*1\s*条路过\s*）\s*·\s*5\s*件事发生在此/.test(v), `★面头要分开报"落脚/路过"：${v.slice(v.indexOf('大荒'), v.indexOf('大荒') + 160)}`);
    // ★★leg98（用户实机那一屏咬出来的第三处）：**"交会"一个数把落脚和路过糊在一起**。
    //   真账现场 `大虞` 与 `大虞皇陵` 两张卡都是"2 条线"、装的还是同一批线，一个落脚一个路过，
    //   读者看不出差别（用户原话："你发现什么问题了吗"）⇒ 两个数分开印。
    //   ★夹具里 `大荒` 正好是 2 落脚 + 1 路过、`玄龟岛` 是 2 落脚 + 0 路过 ⇒ **正反两面都在**：
    //     有一支为零时不许印空话（下面玄龟岛那条就是这一半）。
    assert.ok(!/玄龟岛\s*2\s*条线在这里交会（/.test(v), '★有一支为零时不许印"（2 条落脚在此 · 0 条路过）"那种空话');
    assert.ok(/玄龟岛\s*2\s*条线在这里交会\s*·\s*2\s*件事发生在此\s*·\s*另有\s*1\s*处单线地点/.test(v), `★面头要报单线地点数：${v.slice(v.indexOf('玄龟岛'), v.indexOf('玄龟岛') + 140)}`);
    // ★反向自证：再给 魔渊深处 添一条**别的线**的事 ⇒ 它就该**立起来当一个面**
    const w2 = faceWorld();
    w2.events.push({ id: 'ev_8_1', title: '另一条线也来魔渊深处', source: { type: 'seed' }, position: '魔渊深处', ripples: ['e_bk_2'], links: {}, closed: false });
    const m2 = buildFaces(w2, buildPanorama(w2).threads);
    assert.ok(m2.faces.some((f) => f.place === '魔渊深处'), '★两条线都到过的地方必须立成一个面（反向自证）');
    assert.ok(!m2.faces.find((f) => f.place === '玄龟岛').lone.some((l) => l.place === '魔渊深处'), '★它立成面之后就不该再出现在单线地点里');
});

test('★★leg97 · 说书⑬：**桥**＝同一个手伸到 ≥2 个面（块不是层，是面与面的关系）', () => {
    // 用户口径③：「块的地位是不是比较尴尬，能让大势直接统领面吗」⇒ 定稿：**块降为面与面之间的关系**。
    //   ★判据咬：①桥是"人到过 ≥2 个面"算出来的（不是编的）；②面头那一行**不许自指**
    //     （设计交接 §3.2 第 2 条：真账里曾印出 `界渊长城 → 界渊长城`）。
    const w = faceWorld();
    const { threads } = buildPanorama(w);
    const m = buildFaces(w, threads);
    const names = m.bridges.map((b) => b.name).sort();
    assert.deepEqual(names, ['万法阁', '大虞', '血屠魔君'], `★只有"手伸到两个面"的那些才算桥；实得 ${names.join('、')}`);
    assert.ok(!m.bridges.some((b) => b.name === '薛铁衣'), '★薛铁衣只在大荒一处 ⇒ 不是桥');
    // 桥的**去处**要点名（某某 → 哪几处），且不含本面
    //   ★口径：桥跨的是**面**——单线地点不算面（它是"只有一条线路过的地方"），
    //     所以 `万法阁` 跨的是 大荒 ↔ 玄龟岛 两处（真账里 `渡虚帝` 跨 4 个面的那种是同一把尺子）。
    const wan = m.bridges.find((b) => b.name === '万法阁');
    assert.deepEqual(wan.places.slice().sort(), ['大荒', '玄龟岛'], '★桥要记全它伸到的那几个**面**');
    const html = renderPanoramaHtml(w);
    const v = visible(html);
    // ★leg98：标签改成「谁把这里和别处连起来（都是卡上那些线里的人）：」——旧文案「与别处相连：」
    //   被真机读成"这一处连着哪几处"（箭头左边其实是**人**）。判据跟着改口径，下面那条自指闸照旧。
    assert.ok(v.includes('谁把这里和别处连起来'), `★面头上要有"谁把这里和别处连起来"那一行：${v.slice(0, 260)}`);
    assert.ok(v.includes('万法阁 → '), '★桥要指名（某某 → 哪几处）');
    // ★不许自指：桥那一行的箭头右边**不许出现本面的地名**（真账里曾印出 `界渊长城 → 界渊长城`）
    for (const f of m.faces) {
        const at = html.indexOf(`<span class="sw2-pan-fhn">${f.place}</span>`);
        const head = html.slice(at, html.indexOf('sw2-pan-fb', at));
        const txt = visible(head);
        if (!txt.includes('→')) continue;   // 这一面没有桥（合法：桥是"伸到别处去"的关系，可以没有）
        const arrow = txt.slice(txt.indexOf('→'));
        assert.ok(!arrow.includes(f.place), `★桥那一行不许自指：面「${f.place}」里印出了 → ${f.place}`);
    }
});

test('★leg97 · 说书⑱：桥那一行**不许自指**——三版错法都要咬住（真账 §3.2 第 2 条）', () => {
    // 真账当玩家读时读到的那一行：`界渊长城 → 界渊长城`（面名叫 `长城`、桥名叫 `界渊长城`）。
    //   ★这一条的判据改过四版（**过宽和过严都是错**，全留在 `bridgesHtml` 的注释里）：
    //     只按逐字相等 ⇒ 漏；把"驻地等于本面"单列一条 ⇒ 把 `凤鸣天阙`（驻地 `未明`）那种真桥也剔了；
    //     只按"像不像地名"收口 ⇒ `界渊长城`（驻地 `长城`、名字含驻地）漏过去。
    //   ⇒ 夹具里三种形状各来一个：**名字含驻地的**（`长城关楼`，驻地 `长城`）、
    //     **与自己跨到的那个地方同名的**（`大虞`）、**正常跨面的**（`万法阁`，必须留着）。
    const w = faceWorld();
    // 造一个"长城"面（两条线到过），并把三个桥都牵进去
    w.context.positions.push('长城');
    w.events.push(
        { id: 'ev_9_1', title: '玄鹤出兵长城', source: { type: 'seed' }, position: '长城', ripples: ['e_bk_3'], links: {}, closed: false },
        { id: 'ev_9_2', title: '长城守军溃退', source: { type: 'seed' }, position: '长城', ripples: ['e_bk_4'], links: {}, closed: false },
    );
    // `长城关楼`（驻地 `长城`）也到大荒；`大虞` 跨到"大虞"那一面；`万法阁` 跨到大荒与玄龟岛
    w.events[0].ripples = ['e_bk_1', 'e_1_1', 'e_bk_4'];
    w.context.positions.push('大虞');
    w.events.push(
        { id: 'ev_9_3', title: '大虞钦差出巡', source: { type: 'seed' }, position: '大虞', ripples: ['e_bk_2', 'e_bk_5'], links: {}, closed: false },
        { id: 'ev_9_4', title: '大虞边军集结', source: { type: 'seed' }, position: '大虞', ripples: ['e_bk_2', 'e_bk_5'], links: {}, closed: false },
    );
    const html = renderPanoramaHtml(w);
    const heads = [...html.matchAll(/<span class="sw2-pan-fhn">([^<]*)<\/span>[\s\S]*?<div class="sw2-pan-brg">([\s\S]*?)<\/div>/g)]
        .map(([, place, brg]) => ({ place, brg: brg.replace(/<[^>]*>/g, '') }));
    assert.ok(heads.length > 0, '前置：夹具里得真有面露着"谁把这里和别处连起来"那一行（否则本判据是空绿）');
    for (const h of heads) {
        for (const seg of h.brg.replace(/^.*?：/, '').split('　')) {
            const mm = /^(.*?) → (.*)$/.exec(seg.trim());
            if (!mm) continue;
            // ★★leg98（用户实机指认）：**箭头左边就是本面名** ⇒ 整行本来就不该印。
            //   真账现场 `大虞` 那张卡上印着 `大虞 → 大虞皇陵`（`大虞` 既是势力名又是地名、驻地「未明」）
            //   ——旧判据只咬"左右两边逐字相同"，这一行两边**不相同**，从尺子底下走了过去。
            assert.notEqual(mm[1].trim(), h.place, `★面「${h.place}」的桥不该从它自己出发：${seg.trim()}`);
            assert.notEqual(mm[1].trim(), mm[2].trim(), `★面「${h.place}」印出了自指桥「${seg.trim()}」`);
            assert.ok(!mm[2].split(' · ').includes(h.place), `★面「${h.place}」的桥指向了它自己：${seg.trim()}`);
        }
    }
    // ★反向：**正常的桥不许被误伤**（这一半咬的是"过严"）——`万法阁` 跨大荒与玄龟岛，必须还在
    const daBridges = heads.find((h) => h.place === '大荒');
    assert.ok(daBridges && daBridges.brg.includes('万法阁'), `★正常跨面的桥不许被自指规则误伤：${JSON.stringify(heads)}`);
    // ★★反向之三（leg98 新加，咬的是"剔过头"）：**既到本面、又到别处**的桥必须留着。
    //   真账里的 `渡虚帝`（places = 长城·界海·鬼门关·界渊长城）就是这一种：它到得了 `长城`，
    //   而 `长城` 那张卡上恰恰要靠它才能看见"这几处是连着的"。
    //   ⇒ 若把规则写成"本面出现在 places 里就整行不印"，这一条当场红。
    const changcheng = heads.find((h) => h.place === '长城');
    assert.ok(changcheng, '前置：夹具里得有「长城」那一面');
    assert.ok(changcheng.brg.includes('长城关楼') || changcheng.brg.includes('渡虚帝'),
        `★"既到本面又到别处"的那种桥不许被剔掉（夹具里「长城关楼」「大虞」都是这种）：${JSON.stringify(changcheng)}`);
});

test('★★leg97 · 说书⑭：**大势与面是对读，不是统领**（大势句只能原文照印，不许收纳面里的条目）', () => {
    // 用户口径③的后半：「能让大势直接统领面吗」⇒ **不能**，两条硬原因（设计交接 §2.2）：
    //   ① 大势是一句话，句子收不了条目（真账 A 局 31 字、B 局 72 字，各自只切成一句）；
    //   ② "书的原始设定"是**前提**、账上算出的是**事实** ⇒ 前提不能收纳事实。
    //   ⇒ 判据：页面上印的大势句**必须逐字来自设定层**，且**不许**出现"大势统领/涵盖/分为"这类措辞。
    const w = faceWorld();
    const html = renderPanoramaHtml(w);
    const v = visible(html);
    const sit = w.context.setting.frozen.canon.situation;
    assert.ok(v.includes(sit), '★大势句必须原文照印（一个字都不许改）');
    // ★口径：判"印没印"要按**可见文本**（`visible()` 剥标签）且**按词判**、**允许标签留下的空隙**——
    //   不看字面量挨不挨着（本棒第六次"尺子错"：我在那句里加了几个 `<b>`，紧凑字面量当场失配）。
    //   `\s*` 同样是为了让过 `</b>` 变成的那个空格。**判据红了先怀疑尺子。**
    assert.ok(/大势\s*是书里写定的\s*何故/.test(v) && /面\s*是账上算出来的\s*何处/.test(v),
        `★页面要讲清"大势给何故、面给何处"这层对读关系：${v.slice(v.indexOf('大势'), v.indexOf('大势') + 90)}`);
    for (const bad of ['大势统领', '大势涵盖', '大势分为', '大势之下的面']) {
        assert.ok(!v.includes(bad), `★不许把大势写成面的上层（「${bad}」）：设计交接 §2.2 已裁定它统领不了面`);
    }
    // ★没有设定层的老账要**如实说**，不许编一句大势出来
    const bare = faceWorld();
    delete bare.context.setting;
    assert.ok(visible(renderPanoramaHtml(bare)).includes('这本账没留大势句'), '★缺大势句要如实标注（不许编）');
});

test('★★leg97 · 说书⑮：**"这个数说的是这件事"**——面头/单线地点/桥上的每个数都要量对东西', () => {
    // ★这一条治的是 leg96 §0 那族病的第五次（**一格填对了，还要问"喂给它的那个数，量的是不是这件事"**）。
    //   本棒当玩家读真账时当场读到三处"数错位"（都是第一版写的）：
    //     ① 面头"几件事发生在此"量的是"落脚线在此的事之和"（应＝**真的发生在这个地方的**事）；
    //     ② `ripples` 里查不到的名号印成一串空顿号「、、、、」；
    //     ③ 谋划的 `blocked` 原话带着 `t57:` 这种行号前缀漏进"付出的代价"。
    const w = faceWorld();
    const { threads } = buildPanorama(w);
    const m = buildFaces(w, threads);
    const at = (p) => w.events.filter((e) => e.position === p).length;
    for (const f of m.faces) assert.equal(f.events, at(f.place), `★面「${f.place}」报的件数必须等于真的发生在这个地方的事数`);
    assert.equal(m.faces.find((f) => f.place === '大荒').events, 5, '夹具里大荒有 5 件事');
    assert.equal(m.faces.find((f) => f.place === '玄龟岛').events, 2, '夹具里玄龟岛有 2 件事');
    const da = m.faces.find((f) => f.place === '大荒');
    // ★这一条就是"喂给它的那个数，量的是不是这件事"：
    //   有一条线（`灵鹤上人西行入西漠`）**路过**大荒而**落脚在西漠灵山**（它在那儿事最多）⇒
    //   「按地方数」＝5，而「只数落脚在大荒的线」＝4。两个数**必须不等**——
    //   否则这个夹具就咬不住那两种量法的差别（本棒第一版正是量错了东西，判据⑮当场红）。
    //   ★落脚表**直接读产品交出来的那份**（`m.homeOf`）——不许在测试里照规则重写一遍
    //     （那是立第二把尺子；本棒第一版重写的排法跟产品差一条 ⇒ 当场红。**归属只许有一处实现**）。
    const homeOnly = da.lines.filter((t) => m.homeOf.get(t.id) === '大荒').reduce((n, t) => n + t.here, 0);
    assert.equal(homeOnly, 4, '只有落脚在大荒的那两条线在此的件数（3 + 1）');
    assert.ok(homeOnly < da.events, `★夹具必须让"路过线在此的件数"露出来：只数落脚线 ${homeOnly} vs 按地方数 ${da.events}`);
    assert.equal(da.lines.reduce((n, t) => n + t.here, 0), 6, '线那一层的"在此 N 件"合起来＝6');
    // ★三条分类的归属都必须在这张表里（不多不少）——它也是自证闸的另一个说法
    assert.equal(m.homeOf.size, threads.length, '★每条线都要有一个落脚处（互斥且穷尽）');
    assert.equal([...m.homeOf.values()].filter((p) => p === '').length, m.census.scattered, '★落在"无"的那些＝散落那批');
    // ② 名号：账上查不到的一律不印（不许出现空顿号、空 <b>、裸号）
    //   ★两道闸各管一段（本棒实测）：`buildPanorama` 把号换成名时，**查不到的号会变成空串**；
    //     `buildFaces` 再把空串与"像地名"的那些一起剔掉。⇒ 判据要**从可见文本倒着咬**，
    //     不能只咬 `cast` 数组（那只看得见第二道闸）。
    const w3 = faceWorld();
    w3.events[0].ripples = ['e_bk_1', 'e_ghost', 'e_bk_3'];   // 查不到的号 ＋ `界渊长城`（驻地等于自己名字 ⇒ 地名型）
    const m3 = buildFaces(w3, buildPanorama(w3).threads);
    const t3 = m3.faces.find((f) => f.place === '大荒').lines.find((t) => t.events.some((e) => e.id === 'ev_1_1'));
    assert.ok(!t3.cast.includes('界渊长城'), `★驻地等于自己名字的（地名型）不许进名单：${JSON.stringify(t3.cast)}`);
    assert.ok(t3.cast.every((c) => c && !c.startsWith('e_')), `★名单里不许有空串或裸号：${JSON.stringify(t3.cast)}`);
    const html3 = renderPanoramaHtml(w3);
    const v3 = visible(html3);
    assert.ok(!v3.includes('、、'), `★不许印出一串空顿号（那是"名号没解析出来"的痕迹）：${v3.slice(0, 200)}`);
    assert.ok(!v3.includes('牵动 \u3000') && !/牵动\s*(·|$)/.test(v3), '★"牵动"后面不许跟空的名单');
    assert.ok(!/<b>\s*<\/b>/.test(html3), '★不许印出空的粗体名号');
    assert.ok(!/e_bk_\d|e_ghost/.test(v3), '★机器号不许露出来');
    // ③ 谋划那句"卡住的话"：`t57:` 这种行号前缀**不许**漏进可见文本（第一版当玩家读时当场读到）
    const w4 = faceWorld();
    w4.agendas = [{ id: 'a_1_1', owner: 'e_bk_1', goal: '引爆死煞核心', stage: '玉石俱焚', closed: false, memory: { done: ['t2: 解开第一层封印'], blocked: ['t57: 放弃（幽冥反噬过于猛烈，不得不放弃窃取核心）'], promises: [], turnsAlive: 2 } }];
    w4.events.push({ id: 'ev_9_1', title: '死煞核心解封', source: { type: 'plot', ref: 'a_1_1' }, position: '大荒', ripples: ['e_bk_1'], links: {}, closed: false });
    const v4 = visible(renderPanoramaHtml(w4));
    assert.ok(v4.includes('放弃（幽冥反噬过于猛烈'), '★卡住那句话本身要在（它是原话）');
    assert.ok(!/t\d+[:：]/.test(v4), '★那句自带的行号前缀（`t57:`）不许印出来');
});

test('★leg97 · 说书⑰：**并页**——四层是主层，观棋那四块降为附层；`digest`（时局句）撤掉不许回流', () => {
    // 用户令：「**观棋和说书其实是一个东西吧，不如就合并成一页也简洁些**」（设计交接 §4 整节）。
    //   定稿口径：**主层＝四层**；观棋五块里 `digest`（时局句）**撤掉**（它与"大势"是同一件事的两种说法，
    //   而大势是**书的原文措辞**、digest 是拼装句 ⇒ 只留一个）；其余四块原样搬进来。
    //   ★判据咬三处：①两个页签真的并成一页（只剩一个容器）②附层四块各出现一次、不错位不分叉
    //     ③`digest` 不许回流。
    const idx = readFileSync(new URL('../web/index.js', import.meta.url), 'utf8');
    // ★★leg98 补四：附层那四块的清单＋拼装整族**搬进了 `web/page-compose.js`**
    //   （`web/index.js` 有条行数锁 `<3100`，这一族长大之后顶破了它 ⇒ 照本仓"搬走一族"的先例搬）
    //   ⇒ 判据跟着**改指新家**（口径一个字没放宽）。
    const compose = readFileSync(new URL('../web/page-compose.js', import.meta.url), 'utf8');
    assert.ok(/const SECTIONS = \['panorama'/.test(idx), `★并页之后主层是 panorama（原来第一个是 board）：${(idx.match(/const SECTIONS = \[[^\]]*\]/) || [''])[0]}`);
    assert.ok(!/SECTIONS = \[[^\]]*'board'/.test(idx), '★`board` 不再是独立页签（它已经并进主层）');
    assert.match(idx, /import \{ mergedMainHtml \} from '\.\/page-compose\.js'/, '★接线层要用新家的组合器（不许自己再留一份实现）');
    assert.ok(/const BOARD_ATTACH_ORDER = \['infoband', 'agendaStrip', 'side'\]/.test(compose),
        '★★leg99：附层清单是**三块**（用户令「动态流可以不要了」⇒ `feed` 撤出；`digest` 也不在里面）');
    assert.ok(!/BOARD_ATTACH_ORDER = \[[^\]]*'digest'/.test(compose), '★`digest` 不许进附层（它与"大势"重复）');
    // ★★leg99 反向：`feed` 不许回潮进清单（"撤掉了"这件事要能被机械咬住）
    assert.ok(!/BOARD_ATTACH_ORDER = \[[^\]]*'feed'/.test(compose),
        '★★leg99：`feed`（动态流）**不许再进附层清单**——用户已裁「动态流可以不要了」');
    // 模板：只剩一个主容器，`#sw2_view_board` 退场
    const tpl = readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
    assert.ok(tpl.includes('id="sw2_view_panorama"'), '★模板要有主层容器');
    assert.ok(!tpl.includes('id="sw2_view_board"'), '★`#sw2_view_board` 必须退场（并页了，不能还留一个空容器）');
    const tabs = [...tpl.matchAll(/data-view="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(tabs, ['panorama', 'chronicle', 'archive', 'entities', 'setting', 'params', 'snapshots', 'settings'],
        `★页签清单必须与 SECTIONS 逐一对应（顺序也一样）：实得 ${tabs.join('、')}`);
    // ③ 三路一致性：SECTIONS / 模板页签 / 各页容器 —— 一处对不上就是"渲染产物无处可填"
    const sections = (idx.match(/const SECTIONS = \[([^\]]*)\]/) || [, ''])[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
    assert.deepEqual(tabs, sections, `★模板页签与 SECTIONS 必须同一份清单：模板 ${tabs.join('、')} vs SECTIONS ${sections.join('、')}`);
    for (const s of sections) assert.ok(tpl.includes(`id="sw2_view_${s}"`), `★每一页都要有容器：缺 #sw2_view_${s}`);
    // ② 附层四块在**渲染产物**里各出现一次（并页不许把某一块漏掉或印两遍）
    //   ★★leg98 补四：这里改成**真调产品那一口组合器**（`mergedMainHtml`）——原来是自己拼一遍
    //     （`panorama + 四块`），那测的是"我以为的拼法"，不是**产品真拼出来的那一页**。
    //     现在这一页有**两栏与页头**，自己拼一遍就完全测不到那些（这正是本仓"立第二把尺子"的老坑）。
    // ★★leg98 补四：这一条现在**真调产品那一口组合器**（`mergedMainHtml`）——原来是自己拼一遍
    //   （`panorama + 四块`），那测的是"我以为的拼法"，不是**产品真拼出来的那一页**。
    //   现在这一页有**两栏与页头**，自己拼一遍完全测不到（"立第二把尺子"的老坑）。
    //   ★★前置条件（本棒又一次踩到）：**必须有真事**——`renderPanoramaHtml` 在"一件事都没有"时走**空态**
    //     ⇒ 组合器走的是"原样拼接"的兜底支 ⇒ 两栏根本不存在（实测：空夹具下这条断言当场红）。
    const w = {
        meta: { tick: 3, simLog: [] }, entities: [{ id: 'e_a', kind: 'faction', name: '甲宗', location: '大荒' }],
        weights: {}, chronicle: [], agendas: [], milestones: [], context: { world: '大荒', positions: ['大荒'] },
        events: [{ id: 'ev_1_1', title: '甲宗异动', source: { type: 'state' }, position: '大荒', ripples: ['e_a'], links: {}, closed: false }],
    };
    const out = renderAll(w, {});
    const merged = mergedMainHtml(out);
    for (const [k, anchor] of [['infoband', 'sw2-infoband'], ['agendaStrip', 'sw2-agenda-strip'], ['side', 'sw2-map-details']]) {
        const n = merged.split(anchor).length - 1;
        assert.equal(n, 1, `★附层那一块「${k}」必须恰出现一次（实得 ${n}）：它漏了就是并页丢东西，多了就是两块各印一遍`);
    }
    // ★★★leg99（用户令「**动态流可以不要了**，其他就按那个模板做」）：动态流**整块撤出这一页**。
    //   ★"撤掉"要能从两头咬：①这一页上**一处都不许有** ②而它**在别处照旧存在**
    //     （撤的是"这一页印不印"，不是把引擎那边的账/渲染函数删了——那条判据在 `render.test.js` 里）。
    assert.equal(merged.split('sw2-feed').length - 1, 0, '★★leg99：动态流（`sw2-feed`）不许出现在这一页上');
    assert.ok(!merged.includes('sw2-col-head">动态流'), '★★leg99：连它那一行小标题（`动态流 · 最新在上`）也不许剩在页上');
    //   ★反向自证的前置：这一页**得真有左栏**（否则上面两条在"根本没渲染出两栏"时也会绿 —— 空绿）
    assert.ok(merged.includes('sw2-merged-main'), '★前置：这一页必须真的拼出了左栏（不然"动态流不在"是空绿）');
    assert.ok(!merged.includes('sw2-digest'), '★撤掉的时局句不许回流（它与"大势"是同一件事的两种说法）');
    // ★正向：主层（四层）必须真的在合并产物里，而且**排在信息带之后**（leg98 补四的新口径）
    assert.ok(merged.includes('sw2-pan-head'), '★主层（四层）要在合并产物里（前置：这一页得真有说书页头）');
    // ★★★leg98 补四（用户令「**你总得把这个放在上面吧？而且我要往下翻很久才能看到这些**」）：
    //   ①**信息带升成页头**：它必须在**说书页头之后、四层正文之前**（原来它排在页尾 ⇒ 用户要滚一万多字才看见）；
    //   ②这一页**分两栏**：左栏＝故事轴（四层 ＋ 自证），右栏＝盘算总览 ＋ 地图。
    //   ★★★leg99 改口径（同一条令的后半句「**但要注意两列都能独自滑动**」）：
    //     · 左栏**不再有动态流**（③那条旧断言已按新令重写，不是删掉了事）；
    //     · 两栏**各自独立滚动** —— 这是**样式层**的事（`web/style.css`），本文件测不到，
    //       所以那半条在下面的样式判据里咬（★"同一件事两处表达"的反面：各测各的那一层）。
    const atHead = merged.indexOf('sw2-pan-head'), atBand = merged.indexOf('sw2-infoband');
    const atGrid = merged.indexOf('sw2-merged-grid'), atMain = merged.indexOf('sw2-merged-main'), atSide = merged.indexOf('sw2-merged-side');
    assert.ok(atHead >= 0 && atBand > atHead, '★①信息带要排在说书页头**之后**');
    assert.ok(atBand < atGrid, '★①信息带要在**两栏之前**（升成页头，整宽）');
    assert.ok(atGrid > 0 && atMain > atGrid && atSide > atMain, '★②两栏容器在位（左栏在右栏之前）');
    const side = merged.slice(atSide);
    assert.ok(side.includes('sw2-agenda-strip') && side.includes('sw2-map-details'), '★②右栏＝盘算总览 ＋ 地图');
    // ★★leg99（本笔在这里连踩四次**同一个病根：锚点错位**，全留档，因为它是本仓判据最常见的错法）：
    //   ①按 `indexOf('</div>')+6` 猜页头长度 —— 那个偏移只在"裸 panorama"上成立，当场红；
    //   ②按"完整开标签"的长度切左栏 —— 可 `atMain`/`atSide` 指的是**类名起始**
    //     （`merged.indexOf('sw2-merged-main')`），所以两个切片都以 `<div class="` **之后**开头、
    //     也都会把**下一个容器的开标签前半截**带进来（`<div class="`）；
    //   ③我写锚点常量时顺手把那行**折成两行** ⇒ 常量里多了一个换行，`.length` 与产品差一位；
    //   ④按"长度相等"困惑了半天 —— 两边都 1325 却仍不等，是**把首个不同位置印出来**才看见真相。
    //   ⇒ 定稿：**一个长度都不算**，只用产品自己的两个边界（说书页头那条正则 / 右栏那个 `<`）。
    //   ★纪律：判据里当锚点用的字符串，**形状必须与产品里那一处逐字一致**；红了先问"我的切点对不对"。
    const sideStart = merged.lastIndexOf('<', atSide);        // 右栏容器真正开始处
    const main = merged.slice(atMain, sideStart);             // 左栏（含它自己的开标签尾部）
    // ★③左栏＝故事轴（动态流已按用户令撤走 ⇒ 这里只钉"四层与自证在左栏"）
    for (const [k, anchor] of [['四层', 'sw2-pan-dashi'], ['自证闸', 'sw2-pan-selfcheck']]) {
        assert.ok(main.includes(anchor), `★③左栏要有${k}（${anchor}）`);
    }
    // ★★leg99 核心：左栏内容必须**恰好**是"四层去掉页头那一段"——
    //   多一节＝又往里接了别的块（动态流当年就是这么接进来的），少一节＝丢了正文。
    const pan = String(out.panorama || '');
    const panHead = /^<div class="sw2-pan-head">[\s\S]*?<\/div>/.exec(pan);
    assert.ok(panHead, '★前置：panorama 要以说书页头开头（不然下面这条是空绿）');
    const gt = main.indexOf('>');                             // 左栏开标签在这个切片里到哪儿结束
    assert.ok(gt > 0 && gt < 60, `★前置：左栏开头得是个开标签（实得 ${JSON.stringify(main.slice(0, 40))}）`);
    const mainBody = main.slice(gt + 1, -6);                  // 开标签之后 → 产品补的那个 `</div>` 之前
    {
        const expect = pan.slice(panHead[0].length);
        let i = 0;
        while (i < Math.min(mainBody.length, expect.length) && mainBody[i] === expect[i]) i++;
        assert.equal(mainBody, expect,
            `★★leg99：左栏内容必须**恰好**是四层去掉页头那一段（多一节＝又接了别的块；少一节＝丢了正文）\n`
            + `  左栏 ${mainBody.length} 字 vs 期望 ${expect.length} 字 · 首个不同位置 = ${i}\n`
            + `  左栏：${JSON.stringify(mainBody.slice(Math.max(0, i - 30), i + 50))}\n`
            + `  期望：${JSON.stringify(expect.slice(Math.max(0, i - 30), i + 50))}`);
    }
    assert.ok(!main.includes('sw2-agenda-strip') && !main.includes('sw2-map-details'), '★盘算总览与地图只许在右栏（不许两边各印一份）');
});

test('★★★leg99 · 说书⑳：**两栏各自独立滑动**（用户令「但要注意两列都能独自滑动」）', () => {
    // 为什么这条要单独立（它测的是**样式**，而这一族的判据此前全在测 DOM 结构）：
    //   "两列都能独自滑动"在结构上**看不出来**——`mergedMainHtml` 交出来的 DOM 与"整页一条滚动条"时**一模一样**，
    //   差别**全在 CSS**（容器要有定高、两栏要各自 `overflow-y:auto`）。
    //   ⇒ 照本仓"判据要咬在**那一层**上"的纪律，这条读 `web/style.css` 按**规则**咬。
    // ★咬的是**关系**不是色值：①两栏都有纵向滚动 ②容器有定高（没有定高就永远滚不动）
    //   ③窄屏退回单列时**必须把定高与滚动一起取消**（否则单列变成两口小井）。
    const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
    const ruleOf = (sel) => {
        const m = new RegExp(`\\${sel}\\{([^}]*)\\}`).exec(css.replace(/\s*\n\s*/g, ''));
        return m ? m[1] : '';
    };
    // ① 两栏各自能滚
    for (const sel of ['.sw2-merged-main', '.sw2-merged-side']) {
        const body = ruleOf(sel);
        assert.ok(body, `★前置：样式里必须真有 ${sel} 这条规则（否则下面是空绿）`);
        assert.match(body, /overflow-y:\s*auto/, `★★${sel} 必须能**自己纵向滚动**（用户令"两列都能独自滑动"）`);
        assert.match(body, /height:\s*100%/, `★★${sel} 必须占满容器高度（不然那一栏高矮由内容定 ⇒ 滚不起来）`);
    }
    // ② 容器必须**定高**——"里面能滚"的前提是"外面有确定的高度"
    const grid = ruleOf('.sw2-merged-grid');
    assert.match(grid, /height:\s*calc\(/, '★★两栏容器必须有**确定高度**（`calc(...)`；没有它内容会把容器撑开、两栏永远滚不动）');
    assert.match(grid, /min-height:\s*\d+px/, '★要有下限（屏幕矮时宁可整页滚，也不许把两栏压成两条缝）');
    // ③ ★反向之"过犹不及"：窄屏退回单列时，定高与两栏滚动**必须一起取消**（否则单列里两口小井）
    const narrow = (/@media \(max-width:980px\)\{([\s\S]*?)\}\s*$/m.exec(css.replace(/\s*\n\s*/g, '')) || [])[1] || '';
    assert.ok(narrow.includes('.sw2-merged-grid'), '★前置：窄屏那条媒体查询里得真有并页这两栏的规则');
    assert.match(narrow, /\.sw2-merged-grid\{[^}]*height:auto/, '★★窄屏必须把定高取消（退回单列）');
    assert.match(narrow, /\.sw2-merged-main,\.sw2-merged-side\{[^}]*overflow:visible/, '★★窄屏两栏不许再各自滚动');
    // ④ ★反向之"残留"：旧的 `position:sticky` 模型必须撤干净（两个模型并存会互相打架）
    assert.ok(!/\.sw2-merged-side\{[^}]*position:sticky/.test(css.replace(/\s*\n\s*/g, '')),
        '★右栏那条 `position:sticky` 必须撤掉（它是"整页滚、右栏钉住"那个模型的产物，与"右栏自己滚"冲突）');
});

test('★leg97 · 说书⑯：「块」不许回流成一层（用户裁「块不是层，是面与面的关系」）', () => {
    // ★这条锁的是**结构**，不是措辞：面的三个分类里不许出现"块"；块只能以"面头上的桥"出现。
    const html = renderPanoramaHtml(faceWorld());
    const v = visible(html);
    for (const bad of ['块', '棋块', '区块']) {
        assert.ok(!v.includes(bad), `★可见文本里不许出现「${bad}」——用户口径③：它是面与面之间的关系，不是一层`);
    }
    // 正向：桥（关系）必须**在面头上**印出来（不是另起一层）
    const fh = html.slice(html.indexOf('sw2-pan-fh'), html.indexOf('sw2-pan-fb'));
    assert.ok(fh.includes('sw2-pan-brg'), '★桥属于面头那一块（面与面的关系），不是新的一层');
});

test('★★leg98 · 说书⑲：**线头那一栏要有自己的台面**（不许"透出面卡底"⇒ 两边亮度差 0）', () => {
    // 用户令：「**是改这一栏的颜色**不是标题文字」（他指着线头那一栏）。
    //   ★病根（本棒量出来的）：`.sw2-pan-face .sw2-pan-thread` 原来是 `background:transparent`
    //     ⇒ 透出的就是面卡的底，**两边亮度差 0**；整条栏只靠一条 2px 竖线划分，
    //     而那条竖线（`--sw2-line` #2c3342）对面卡底（`--sw2-card` #20252f）的对比只有 **1.21:1**
    //     ⇒ 栏目与面卡糊成一片。这不是"文字看不清"（标题本来就 12.76:1），是**这一栏没有面**。
    //   ★判据按**算出来的对比度**咬（不是咬某个十六进制写死的值）：换色可以，**不许换回"没差别的底"**。
    const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
    const rule = /\.sw2-pan-face\s+\.sw2-pan-thread\s*\{([^}]*)\}/.exec(css);
    assert.ok(rule, '★必须有一条 `.sw2-pan-face .sw2-pan-thread` 规则（线头那一栏的台面就住这儿）');
    const body = rule[1];
    const bg = (/background\s*:\s*([^;]+)/.exec(body) || [])[1]?.trim();
    assert.ok(bg && bg !== 'transparent', `★这一栏必须有自己的底，不许是 transparent（现在是「${bg}」）`);
    const hex = /#([0-9a-fA-F]{6})/.exec(bg);
    assert.ok(hex, `★底色要写成十六进制实色（判据要能算对比度）：${bg}`);

    // WCAG 相对亮度 / 对比度（判据自带，不 import 产品——样式是数据不是逻辑）
    const lum = (h) => {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
            .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const faceCard = (/#20252f/.test(css) ? '#20252f' : (/:root[^}]*--sw2-card\s*:\s*(#[0-9a-fA-F]{6})/.exec(css) || [])[1]);
    const rFace = ratio(hex[0], faceCard);
    assert.ok(rFace >= 1.08, `★这一栏与面卡底必须有可见的台面差（实测 ${rFace.toFixed(3)}:1，要 ≥1.08）；`
        + `「差 0」正是用户指的那处病`);
    // ★反向之证：**同色**必须被判死（把底写成面卡那个色 ⇒ 等于回到 transparent 那个观感）
    assert.ok(!(hex[0].toLowerCase() === faceCard.toLowerCase()), '★这一栏的底不许与面卡底同色（那就是"没改"）');
    // ★另一头也钉：它也不能亮到跟"最新一轮"那枚金色抢位（保持在暗色台面族里）
    assert.ok(ratio(hex[0], '#e3ad55') > 3, '★这一栏仍是暗色台面（不许亮到压过金/红那两个强调色）');
});
