// 细案 spec-chronicle-page-ia（leg50）：编年页数据层 + 分层渲染 + 工具条 判据
//   ★纪律：判据只吃**导出纯函数**；真结构锁**不许**写成 `includes('<summary')`（工具条那个「？」自己就含它
//     ——leg49 §4② 的假绿原形），一律锁 `details.sw2-ch-group` + **反向对照**。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
    classifyChronicle, chronicleIsClosed, chronicleNameOf, chronicleCauseOf, chroniclePlaceOf,
    chroniclePeopleOf, chronicleSearchTextOf, chronicleChainTargetOf,
    selectChroniclePage, makeChronicleView, renderChronicleHtml, renderChronicleToolbar,
    CHRONICLE_DEFAULT_VIEW, CHRONICLE_PAGE_SIZE, CHRONICLE_BOOK_LABELS, renderAll,
} from '../src/render.js';

// ── 生产者全集（照 src/settle.js 18 处 + src/entropy.js 2 处的 text 模板逐条抄，20 种形状）──
//   ★这张表是**分类判据的完整覆盖面**：新生产点若没进这张表，兜底规则会把它算账目（不会伪装成情节）。
const PRODUCER_SHAPES = [
    ['event', '事件「死煞杀局启动」——沿「万法阁商队集结」而来，事发 东海浮空岛，牵动 万法阁'],
    ['走一步', '盘算「查探北山死煞源头并荡平邪祟」推进：万千剑修结成剑阵'],
    ['结清', '盘算「查探北山死煞源头并荡平邪祟」满步结算：结清（期满收摊，终结产果 §4.4④）'],
    ['结清', '盘算「查探北山」满步结算：变形，事业移交诸子（2 项断链转独立）'],
    ['了结', '事件「死煞暗流涌动」闭环（源盘算已结算）'],
    ['了结', '事件「死煞暗流涌动」涟漪平息（链源已了结）'],
    ['起因', '因事而生：万法阁 由「死煞杀局启动」生「完成死煞杀局的部署」'],
    ['起因', '由处境而生：大虞 生「借地契交接引君入瓮」'],
    ['走一步', '拆环：万法阁 让路转伺机（较新者先让）'],
    ['走一步', '委派：沈天君 拆大给小——「查探北山」（授 薛铁衣）'],
    ['结清', '盘算「炼化死煞核心」取消（万法阁）：未言明理由'],
    ['结清', '取消后遗留子盘算 2 项转独立（事业未竟）'],
    ['走一步', '兑现：沈天君 收「查探北山」之果'],
    ['起因', '「薛铁衣」入局（因事件「大盘谷血战爆发」而生）'],
    ['起因', '「万子明」覆灭（死于死煞）'],
    ['起因', '「白小娥」淡出视野（久未现身）'],
    ['起因', '「白小娥」带着因由重回场上（因「死煞杀局启动」）'],
    ['起因', '「黄坤」复归（被「血战煞阵缺口」点名）'],
    ['走一步', '天下已不安静（新的事件上桌，安稳期结束）'],
    ['走一步', '天下安稳：已 5 轮无新事上桌（世界静默，处境上桌）'],
];

test('细案 §3.2 · classifyChronicle 对**生产者全集 20 种形状**逐条分类正确（零 UNKNOWN）', () => {
    for (const [want, text] of PRODUCER_SHAPES) {
        const c = classifyChronicle({ text });
        const got = c.isEvent ? 'event' : c.bookKind;
        assert.equal(got, want, `形状「${text.slice(0, 24)}…」判成 ${got}，应为 ${want}`);
    }
    // ★四个玩家可见的账目子类之外，一个都不许有
    //   ★比集合用 `localeCompare('zh')` 排（`Array#sort()` 默认按**码点**排 ⇒ 中文序不是"读起来"的序，
    //     这条本来会拿码点序去比人写的序，红得毫无意义——leg49 §7.3 那条教训的同款）
    const seen = new Set(PRODUCER_SHAPES.filter(([k]) => k !== 'event').map(([k]) => k));
    for (const k of seen) assert.ok(CHRONICLE_BOOK_LABELS[k], `子类「${k}」缺玩家可见词`);
    assert.deepEqual(Object.keys(CHRONICLE_BOOK_LABELS).sort((a, b) => a.localeCompare(b, 'zh')),
        ['走一步', '了结', '起因', '结清'].sort((a, b) => a.localeCompare(b, 'zh')));
    assert.equal(Object.keys(CHRONICLE_BOOK_LABELS).length, 4, '账目子类只有四个（多一个都是没登记的口径）');
});

test('细案 §3.2 · ★兜底：不以「事件「…」——」开头的行一律算账目（宁可少上一个故事，不许把账当故事印）', () => {
    const traps = [
        '事件甲——沿「乙」而来',                              // ★缺了「」这对书名号（"事件甲"不是"事件「甲」"）
        '事件「甲」—单破折号—沿「乙」而来',                   // 破折号只有一个
        '  事件「前导空格」——沿「乙」而来',                   // 行首有空格 ⇒ 不算（判据是**行首**）
        '议论：「事件「甲」——沿「乙」而来」',                  // 只是引用了别处的措辞
    ];    for (const t of traps) {
        const c = classifyChronicle({ text: t });
        assert.equal(c.isEvent, false, `不该判成真事件：${t}`);
        assert.equal(c.bookKind, '走一步', `兜底子类应为走一步：${t}`);
    }
    // ★反向对照（错法②的形状）：这两类**记账行也带「事发」**，必须判账目
    assert.equal(classifyChronicle({ text: '盘算「X」推进：斩杀来敌，事发 未明' }).isEvent, false);
    assert.equal(classifyChronicle({ text: '盘算「X」满步结算：结清，事发 未明' }).isEvent, false);
    // ★反向对照（错法①的形状）：地点是占位词「未明」的**真事件**必须判成真事件
    assert.equal(classifyChronicle({ text: '事件「死煞之气外泄」——由世界处境而生，事发 未明，牵动 万法阁' }).isEvent, true);
    // 空值不炸
    assert.deepEqual(classifyChronicle({}), { isEvent: false, bookKind: '走一步' });
    assert.deepEqual(classifyChronicle(null), { isEvent: false, bookKind: '走一步' });
});

test('细案 §3.2 · 「已了结」与子类**共用同一份判据**（了结 ∪ 结清），不另写正则', () => {
    const done = [
        '事件「死煞暗流涌动」闭环（源盘算已结算）',
        '事件「死煞暗流涌动」涟漪平息（链源已了结）',
        '盘算「X」满步结算：结清（期满收摊，终结产果 §4.4④）',
        '盘算「X」取消（万法阁）：未言明理由',
        '取消后遗留子盘算 2 项转独立（事业未竟）',
    ];
    for (const t of done) assert.equal(chronicleIsClosed({ text: t }), true, t);
    const open = [
        '事件「X」——沿「Y」而来，事发 未明', '盘算「X」推进：走一步', '因事而生：甲 生「乙」',
        '由处境而生：甲 生「乙」', '「甲」入局（因事件「X」而生）', '天下已不安静（新的事件上桌）',
    ];
    for (const t of open) assert.equal(chronicleIsClosed({ text: t }), false, t);
});

test('细案 §3.6 · chronicleSearchTextOf：事名/因/地点/牵动人都在面上；★占位词「未明」不在', () => {
    const ev = { text: '事件「死煞杀局启动」——沿「万法阁商队集结」而来，事发 东海浮空岛，牵动 万法阁、白小娥' };
    const s = chronicleSearchTextOf(ev);
    for (const term of ['死煞杀局启动', '万法阁商队集结', '东海浮空岛', '万法阁', '白小娥']) {
        assert.ok(s.includes(term.toLowerCase()), `搜索面缺「${term}」`);
    }
    // ★占位词不进面（照实体页终审 C2）：地点是「未明」的行，搜「未明」搜不到它
    const vague = { text: '事件「死煞之气外泄」——由世界处境而生，事发 未明，牵动 万法阁' };
    assert.ok(!chronicleSearchTextOf(vague).includes('未明'), '占位词「未明」不许进搜索面');
    assert.ok(chronicleSearchTextOf(vague).includes('死煞之气外泄'), '真内容照旧在面上');
    // 类别词在面上（搜「了结」找得到了结行）
    assert.ok(chronicleSearchTextOf({ text: '事件「X」闭环（源盘算已结算）' }).includes('了结'));
});

test('细案 §3.6 · 地点/牵动人/因的抽取（三种因果措辞 + 缺项留白）', () => {
    assert.deepEqual(chronicleCauseOf({ text: '事件「X」——沿「甲」而来，事发 乙，牵动 丙' }), { rel: '沿', what: '甲' });
    assert.deepEqual(chronicleCauseOf({ text: '事件「X」——由盘算「甲」而生，事发 乙' }), { rel: '由盘算', what: '甲' });
    assert.deepEqual(chronicleCauseOf({ text: '事件「X」——由世界处境而生，事发 乙' }), { rel: '由处境', what: '' });
    assert.deepEqual(chronicleCauseOf({ text: '盘算「X」推进：走一步' }), { rel: '', what: '' });
    assert.equal(chroniclePlaceOf({ text: '事件「X」——沿「甲」而来，事发 东海浮空岛，牵动 丙' }), '东海浮空岛');
    assert.equal(chroniclePeopleOf({ text: '事件「X」——沿「甲」而来，事发 乙，牵动 万法阁、白小娥' }), '万法阁、白小娥');
    assert.equal(chroniclePlaceOf({ text: '盘算「X」推进：走一步' }), '');
    assert.equal(chronicleNameOf({ text: '事件「死煞杀局启动」——由世界处境而生' }), '死煞杀局启动');
    assert.equal(chronicleNameOf({ text: '盘算「X」推进：走一步' }), '', '账目行没有"事名"这个概念 ⇒ 空串，不假装有');
});

test('细案 §4.1 · chronicleChainTargetOf：三路口径唯一（chainRef → eventRef → 行 id 解析）', () => {
    assert.equal(chronicleChainTargetOf({ id: 'ch_1_1', text: 'x', chainRef: 'ev_9_9', eventRef: 'ev_1_1' }), 'ev_9_9');
    assert.equal(chronicleChainTargetOf({ text: 'x', eventRef: 'ev_1_1' }), 'ev_1_1');
    assert.equal(chronicleChainTargetOf({ id: 'ch_6_evc_ev_6_1', text: '事件「旧事」闭环（源盘算已结算）' }), 'ev_6_1');
    assert.equal(chronicleChainTargetOf({ id: 'ch_7_evc2_ev_7_3', text: '事件「旧事」涟漪平息（链源已了结）' }), 'ev_7_3');
    assert.equal(chronicleChainTargetOf({ id: 'ch_8_ag_8_1', text: '盘算行' }), '', '非 evc 模式不误挂');
    assert.equal(chronicleChainTargetOf({ id: 'ch_9_evc_9_1', text: '残缺 id 形态' }), '', '无 ev_ 段不误挂');
    assert.equal(chronicleChainTargetOf({ id: 'ch_1_1', text: 'x' }), '', '行自身 id 不挂链');
});

// ── 合成世界：每个子类各来几条（确定性，便于逐格点数）──
function synthWorld() {
    const L = (id, tick, text, extra = {}) => ({ id, tick, text, kind: 'major', ...extra });
    return {
        meta: { tick: 12 },
        chronicle: [
            L('c1', 12, '事件「近事甲」——沿「前因甲」而来，事发 东海浮空岛，牵动 万法阁、白小娥', { eventRef: 'ev_12_1' }),
            L('c2', 11, '事件「近事乙」——由世界处境而生，事发 未明，牵动 万法阁'),
            L('c3', 3, '事件「旧事丙」——由盘算「某个盘算」而生，事发 北山，牵动 万法阁', { chainRef: 'ev_3_1' }),
            L('c4', 2, '事件「旧事丁」——沿「旧事丙」而来，事发 北山，牵动 万法阁'),
            L('c5', 11, '盘算「查探北山」推进：万千剑修结成剑阵'),
            L('c6', 10, '盘算「查探北山」推进：第二阵'),
            L('c7', 9, '事件「近事甲」闭环（源盘算已结算）'),
            L('c8', 8, '盘算「炼化」取消（万法阁）：未言明理由'),
            L('c9', 7, '因事而生：万法阁 由「近事甲」生「完成部署」'),
            L('c10', 6, '「薛铁衣」入局（因事件「近事甲」而生）'),
        ],
        milestones: [{ id: 'm_3', titles: ['发兵催战'], counts: 2 }],
    };
}
const VOLUMES = [{ id: '卷一', info: '123 件事' }];

test('细案 §T1 · selectChroniclePage：分层/子类/时限/了结 逐项点数（合成世界，纯函数唯一真源）', () => {
    const w = synthWorld();
    const sel = selectChroniclePage(w, makeChronicleView());
    assert.equal(sel.total, 10);
    assert.equal(sel.counts.all, 10);
    assert.equal(sel.counts.event, 4, '真事件 4 条');
    assert.equal(sel.counts.book, 6, '账目 6 条');
    assert.equal(sel.counts.done, 2, '已了结 2 条（闭环 1 + 取消 1）');
    assert.equal(sel.counts.open, 8);
    assert.equal(sel.events.hit, 3, '近 10 轮（tick>2）的真事件 3 条（轮 12/11/3）');
    assert.equal(sel.groups.hot.hit, 3);
    assert.equal(sel.groups.older.hit, 1, '更早的真事件 1 条（轮 2，收进折叠组，一行没丢）');
    assert.deepEqual(sel.bookGroups.map((g) => [g.key, g.hit]), [['走一步', 2], ['了结', 1], ['起因', 2], ['结清', 1]]);
    // 子类合计 + 真事件 = 总行数（★"能对上总数"是底线，不是口径对的证明——口径由上面 pid 逐条咬）
    const sum = sel.bookGroups.reduce((a, g) => a + g.hit, 0) + sel.counts.event;
    assert.equal(sum, sel.total);
    // 顺序：轮次新→旧（同轮按账本位次）
    assert.deepEqual(sel.groups.hot.rows.map((r) => r.tick), [12, 11, 3]);
    assert.deepEqual(sel.groups.older.rows.map((r) => r.tick), [2]);
});

test('细案 §T1 · range 三档 + layer 三档 + closed 三档（彼此正交）', () => {
    const w = synthWorld();
    // 近 5 轮 = tick > 12-5 = 7 ⇒ 真事件里只有轮 12 / 11 那两条在窗口内（轮 3、2 早于窗口）
    assert.equal(selectChroniclePage(w, { ...makeChronicleView(), range: '5' }).events.hit, 2);
    assert.equal(selectChroniclePage(w, { ...makeChronicleView(), range: '5' }).groups.older.hit, 2, '★"更早的事"是**全部**早于窗口的真事件（窗口只切"近"那一组，不切这一组）');
    assert.equal(selectChroniclePage(w, { ...makeChronicleView(), range: 'all' }).events.hit, 4);
    assert.equal(selectChroniclePage(w, { ...makeChronicleView(), range: 'all' }).groups.older.hit, 0, '全部轮次下不收"更早"组');
    assert.equal(selectChroniclePage(w, { ...makeChronicleView(), layer: 'event' }).books.hit, 0);
    assert.equal(selectChroniclePage(w, { ...makeChronicleView(), layer: 'book' }).events.hit, 0);
    assert.equal(selectChroniclePage(w, { ...makeChronicleView(), layer: 'book' }).books.hit, 6);
    assert.equal(selectChroniclePage(w, { ...makeChronicleView(), closed: 'done' }).books.hit, 2, '账目里的已了结 2 条');
    assert.equal(selectChroniclePage(w, { ...makeChronicleView(), closed: 'open' }).books.hit, 4);
});

test('细案 §T1 · 搜索：命中面独立于分层（层/时限是"上桌方式"，搜索是"找得到"）', () => {
    const w = synthWorld();
    const hit = (q, patch = {}) => selectChroniclePage(w, { ...makeChronicleView(), q, ...patch });
    assert.equal(hit('东海浮空岛').events.hit, 1, '地点可搜');
    // ★"搜到了几条"要看**两层实际命中之和**，不能用 `counts.all`：
    //   `scope:'all'` 那几枚数按定义就是**全册**（不随搜索变）——拿它验搜索是拿错尺子（我第一版就写错了）。
    //   真账/夹具实测：搜「万法阁」= 事件层 3（c1/c2/c3）+ 账目层 2（c8/c9）= 5；
    //   c4 虽然也含它，但落在"更早的事"那一组、不进事件层主列表（它照样搜得到，见下面那条）。
    assert.equal(hit('万法阁').events.hit + hit('万法阁').books.hit, 5, '牵动人可搜（★跨层：真事件与账目一起命中）');
    assert.equal(hit('万法阁', { range: 'all' }).events.hit + hit('万法阁', { range: 'all' }).books.hit, 6,
        '放开轮次后 c4 也进主列表（6 条）');
    // ★占位词搜不到任何东西——★注意用**实际命中**（events+books）而不是 `counts.all`：
    //   `scope:'all'` 那几枚数**按定义就是全册**（不随搜索变），拿它验"搜到了几条"是拿错尺子
    //   （这一格我第一版就写错了——判据也会骗人）。
    assert.equal(hit('未明').events.hit + hit('未明').books.hit, 0, '★占位词搜不到任何东西');
    assert.equal(hit('未明', { scope: 'hit' }).counts.all, 0, '切到"当前结果"口径后它也是 0');
    assert.equal(hit('查探北山').books.hit, 2, '盘算名可搜到账目行');
    // ★搜索命中面独立于 range：搜旧事，即便"近 10 轮"这一档也找得到（它落在"更早的事"组里）
    const old = hit('旧事丙');
    assert.equal(old.groups.older.hit, 1, '搜索命中面不受"近 N 轮"限制（找得到 = 搜得到）');
    assert.equal(old.groups.older.rows.length, 1, '★而且**真的画出来了**（组头那个数只是说明，画没画要看 rows）');
    // ★组头那个数是"本组命中总数"，不是"本页几行"；而 `groups.hot.rows` 是**事件层主列表本页**
    //   （它含轮 3 这种"早于窗口但仍在主列表里"的行）——两个字段名只差一点，别读成一行。
    assert.equal(old.groups.hot.hit, 1, '命中面里的真事件共 1 条（它落在"更早"那一组）');
    assert.equal(old.groups.hot.rows.length, 1, '主列表本页 1 行（就是那一条）');
});

test('细案 §T1 · 分页：越界夹紧（不返回空页）、页码随返回值出去、每页 60 行', () => {
    // 造 130 条真事件 ⇒ 3 页
    const many = Array.from({ length: 130 }, (_, i) => ({
        id: `x${i}`, tick: 1, text: `事件「第${i}件」——由世界处境而生，事发 甲`,
    }));
    const w = { meta: { tick: 5 }, chronicle: many };
    const p1 = selectChroniclePage(w, { ...makeChronicleView(), range: 'all', page: 1 });
    assert.equal(p1.events.hit, 130);
    assert.equal(p1.events.pages, 3);
    assert.equal(p1.events.rows.length, CHRONICLE_PAGE_SIZE);
    assert.deepEqual([p1.events.from, p1.events.to], [1, 60]);
    const p9 = selectChroniclePage(w, { ...makeChronicleView(), range: 'all', page: 9 });
    assert.equal(p9.events.page, 3, '越界夹到最后一页');
    assert.equal(p9.events.rows.length, 10);
    assert.deepEqual([p9.events.from, p9.events.to], [121, 130]);
    // 空结果：hit 0 ⇒ 不返回空页以外的东西（from/to 都是 0，UI 不许印"第 0–0 条"）
    const empty = selectChroniclePage(w, { ...makeChronicleView(), q: '绝无此词' });
    assert.deepEqual([empty.events.hit, empty.events.page, empty.events.pages], [0, 1, 1]);
    assert.deepEqual([empty.events.from, empty.events.to], [0, 0]);
});

test('细案 §T1 · 计数双口径（scope）：`all` = 全册 · `hit` = 当前条件下点它会得到多少', () => {
    const w = synthWorld();
    const all = selectChroniclePage(w, makeChronicleView()).counts;
    assert.deepEqual(all, { all: 10, event: 4, book: 6, done: 2, open: 8 });
    const hit = selectChroniclePage(w, { ...makeChronicleView(), q: '万法阁', scope: 'hit' }).counts;
    assert.equal(hit.all, 6, '当前结果口径：全册那一枚印"当前命中"（真事件 4 + 账目 2）');
    assert.equal(hit.event + hit.book, hit.all);
});

test('细案 §T1 · 确定性与真源唯一：同输入两次逐字节一致；makeChronicleView 不共享引用', () => {
    const w = synthWorld();
    const a = selectChroniclePage(w, makeChronicleView());
    const b = selectChroniclePage(w, makeChronicleView());
    assert.equal(JSON.stringify(a), JSON.stringify(b), '同输入两次必须逐字节一致');
    assert.deepEqual(CHRONICLE_DEFAULT_VIEW, { q: '', layer: 'all', closed: 'any', range: '10', scope: 'all', page: 1, pageBook: 1 });
    const v1 = makeChronicleView(), v2 = makeChronicleView();
    v1.q = '改了';
    assert.equal(v2.q, '', '两份视图态不许共享引用');
    assert.equal(CHRONICLE_DEFAULT_VIEW.q, '', '更不许改脏默认值本身');
});

test('细案 §T2 · 行渲染只有三样（轮次/事名/因与牵动）+ 占位词留白 + 类别徽', () => {
    const html = renderChronicleHtml(synthWorld(), { view: makeChronicleView() });
    assert.match(html, /class="sw2-ch-round">12</, '轮次在');
    assert.match(html, /class="sw2-ch-nm">「近事甲」</, '★真事件取「事件「X」——」里的 X 当事名');
    assert.match(html, /sw2-ch-k">沿<\/span>「<span class="sw2-ch-w">前因甲/, '因（三种关系）在');
    assert.match(html, /牵动 万法阁、白小娥/, '牵动的人在');
    assert.match(html, /class="sw2-ch-badge ev">事件</, '真事件徽');    assert.ok(!html.includes('事发 未明'), '★占位词「未明」不许上版面（没有就留白）');
    assert.ok(!html.includes('眼下没有在办'), '旧版占位句不许回潮');
    // 账目行印原文（措辞一个字不改）+ 自己的子类徽
    assert.match(html, /盘算「查探北山」推进：万千剑修结成剑阵/);
    assert.match(html, /class="sw2-ch-badge bk">走一步</);
    for (const label of Object.values(CHRONICLE_BOOK_LABELS)) assert.ok(html.includes(`>${label}</`), `子类词「${label}」在`);
});

test('细案 §T2 · ★分层真结构锁 + 反向对照（不许用 includes("<summary") 那种恒真断言）', () => {
    const w = synthWorld();
    const html = renderChronicleHtml(w, { view: makeChronicleView() });
    // 真结构：事件层两组 + 账目层四组，且"近来"那一组默认展开
    assert.match(html, /<details class="sw2-ch-group" data-group="hot" open>/);
    assert.match(html, /<details class="sw2-ch-group" data-group="old">/);
    for (const k of ['走一步', '了结', '起因', '结清']) {
        assert.match(html, new RegExp(`<details class="sw2-ch-group" data-group="${k}">`), `账目组 ${k} 在位且默认收起`);
    }
    assert.equal((html.match(/<details class="sw2-ch-group"/g) || []).length, 6, '六组');
    // ★反向对照①：只看账目 ⇒ 事件层那两组**必须不出现**
    const bookOnly = renderChronicleHtml(w, { view: { ...makeChronicleView(), layer: 'book' } });
    assert.ok(!bookOnly.includes('data-group="hot"') && !bookOnly.includes('data-group="old"'),
        '只看账目时事件层不许还在（恒真断言会漏掉这一格）');
    // ★反向对照②：只看真事件 ⇒ 账目那四组不出现
    const evOnly = renderChronicleHtml(w, { view: { ...makeChronicleView(), layer: 'event' } });
    assert.ok(!evOnly.includes('data-group="走一步"'), '只看真事件时账目层不许还在');
    assert.ok(evOnly.includes('data-group="hot"'));
    // ★反向对照③：工具条那个「？」（含 <summary>）与分组无关——证明 includes('<summary') 确实恒真
    assert.ok(renderChronicleHtml(w, { view: { ...makeChronicleView(), layer: 'event' } }).includes('<summary'),
        '（这一句本身就是"为什么不能用 includes(<summary) 判分组"的证据）');
});

test('细案 §T2/§3.4 · 每层一枚分页器（数出来 2 枚、各带自己的 layer）；空结果只印「命中 0」', () => {
    const w = synthWorld();
    const html = renderChronicleHtml(w, { view: makeChronicleView() });
    assert.equal((html.match(/class="sw2-ch-pager"/g) || []).length, 2, '两枚分页器（事件层/账目层各一）');
    assert.match(html, /data-layer="event"/);
    assert.match(html, /data-layer="book"/);
    const bookOnly = renderChronicleHtml(w, { view: { ...makeChronicleView(), layer: 'book' } });
    assert.equal((bookOnly.match(/class="sw2-ch-pager"/g) || []).length, 1, '只看账目 ⇒ 只剩一枚分页器（层被动过就不该留死控件）');
    const empty = renderChronicleHtml(w, { view: { ...makeChronicleView(), q: '绝无此词' } });
    assert.match(empty, /命中 <b>0<\/b>/);
    assert.ok(!empty.includes('显示第 0–0 条'), '空态不印"显示第 0–0 条"');
});

test('细案 §4.1 · 「链」钮只在**真有链目标**的行出现（一行空钮都不许有）', () => {
    const w = synthWorld();
    // ★「链」钮的判据必须**照"链目标"咬、不照"真事件"咬**：c1 有 eventRef、c3 有 chainRef，
    //   两条都在 3 条真事件里，但默认 range='10' 只把 c1 端上桌（c3 落在"更早的事"那一组）。
    //   本条要测的是"有目标才给钮"，所以用 range:'all'（全都在主列表里）——两枚钮必须都在。
    const html = renderChronicleHtml(w, { view: { ...makeChronicleView(), range: 'all' } });
    const btns = (html.match(/data-action="open-chain"/g) || []).length;
    assert.equal(btns, 2, '只有 c1(eventRef) 与 c3(chainRef) 两行有钮');
    assert.ok(!html.includes('data-chain="c1"'), '行自身 id 不挂链');
    assert.match(html, /data-chain="ev_12_1"/);
    assert.match(html, /data-chain="ev_3_1"/);
    // ★反向对照：**钮数恒等于"被渲染出来的行里有链目标的那些"**——不看排版、不看分组，逐档算一遍。
    //   （我第一版这里写"近 5 轮只剩一枚"是错的：更早那一组**自己也有链**，它照旧要把钮画出来。）
    const marked = (h) => (h.match(/data-action="open-chain"/g) || []).length;
    for (const range of ['5', '10', 'all']) {
        const v = { ...makeChronicleView(), range };
        const s = selectChroniclePage(w, v);
        const shown = [...s.events.rows, ...s.groups.older.rows, ...s.bookGroups.flatMap((g) => g.rows)];
        const want = shown.filter((r) => r.chain).length;
        assert.equal(marked(renderChronicleHtml(w, { view: v })), want, `range=${range}：钮数必须 = 画出来的行里有目标的条数`);
    }
    // ★反向对照②：整个世界里**没有一条**有链目标 ⇒ 一枚钮都不许有（证明判据不是恒真）
    const noChain = { meta: { tick: 3 }, chronicle: [{ id: 'z1', tick: 1, text: '事件「无事」——由世界处境而生，事发 甲' }] };
    assert.equal(marked(renderChronicleHtml(noChain, { view: makeChronicleView() })), 0, '没有链目标 ⇒ 一枚钮都没有');
    // ★三路解析（行 id 内嵌事件 id）也走同一个口径
    const w2 = synthWorld();
    w2.chronicle.push({ id: 'ch_6_evc_ev_6_1', tick: 6, text: '事件「旧事」闭环（源盘算已结算）', kind: 'major' });
    const h2 = renderChronicleHtml(w2, { view: makeChronicleView() });
    assert.match(h2, /data-chain="ev_6_1"/, '行 id 解析那一路照旧');
    // ★引擎 id 只进 data/title 悬停（A-3），不进可见文本
    const text = String(h2).replace(/<[^>]*>/g, ' ');
    assert.ok(!/ev_[a-z0-9_]+/.test(text), '解析 id 不进可见文本（A-3）');
});

test('细案 §T3 · 工具条：控件齐（搜索 1 + 只看 3 + 了结 3 + 轮次 3 + 计数 1），aria-pressed 显式', () => {
    const w = synthWorld();
    const html = renderChronicleToolbar(w, makeChronicleView());
    assert.match(html, /id="sw2_ch_q"/, '搜索框在');
    for (const v of ['all', 'event', 'book']) assert.ok(html.includes(`data-action="ch-layer" data-value="${v}"`), `只看缺 ${v}`);
    for (const v of ['any', 'done', 'open']) assert.ok(html.includes(`data-action="ch-closed" data-value="${v}"`), `了结缺 ${v}`);
    for (const v of ['5', '10', 'all']) assert.ok(html.includes(`data-action="ch-range" data-value="${v}"`), `轮次缺 ${v}`);
    assert.ok(html.includes('data-action="ch-scope"'), '计数口径钮在');
    assert.match(html, /计数：全册/);
    // ★十枚可切换钮，**每一枚都显式印 aria-pressed**（不留未设态——"未设"会被读屏当普通按钮）。
    //   ★判据按"总数十枚 + 未选中的那几枚不许漏印"咬，**不**写死 false 的具体个数
    //     （个数随标签要不要带计数而变；写死它等于把装饰当契约）。
    assert.equal((html.match(/aria-pressed="/g) || []).length, 10, '十枚钮各印一次');
    assert.equal((html.match(/aria-pressed="true"/g) || []).length, 3, '三组各有一枚选中（只看=全部 · 了结=全部 · 轮次=近 10 轮）');
    // ★逐枚咬（**不写死属性之间的字节顺序**——上一版写成精确子串，属性顺序一变就红得莫名其妙，
    //   而它要说的契约只有一句："每一枚可切换钮都必须显式印 aria-pressed"）：
    const chips = html.match(/<button[^>]*class="sw2-chip[^>]*>/g) || [];
    assert.equal(chips.length, 10, 'chip 钮共十枚');
    for (const tag of chips) {
        assert.ok(/aria-pressed="(true|false)"/.test(tag), `这枚钮没印 aria-pressed：${tag.slice(0, 90)}`);
        // ★选中态两样缺一不可：`.on` 是给眼睛的、`aria-pressed="true"` 是给读屏的（实体页同款契约）
        assert.equal(/class="sw2-chip on"/.test(tag), /aria-pressed="true"/.test(tag), `选中态两样不一致：${tag.slice(0, 90)}`);
    }
    // ★五筛退场：旧 action/data-filter 一个都不许回潮
    assert.ok(!html.includes('set-filter') && !html.includes('data-filter'), '五筛（set-filter/data-filter）不许回潮');
    for (const term of ['谋划', '大事', '牵动', '暗处', '时局']) {
        assert.ok(!html.includes(`>${term}<`), `引擎词 chip「${term}」不许回潮`);
    }
});

test('细案 §3.5/T3 · 全册渲染零禁词（BLACKLIST 全量扫描，含新文案）', () => {
    const w = synthWorld();
    const all = renderAll(w, { config: {}, oldVolumes: VOLUMES, view: { chronicleView: makeChronicleView() } });
    const text = JSON.stringify(all) + renderChronicleToolbar(w, makeChronicleView());
    for (const term of ['chronicle', 'kind', 'tick', 'schema', 'ssot', 'agenda', 'entity', 'visibility']) {
        assert.ok(!text.includes(`>${term}<`), `禁词「${term}」漏进玩家视线`);
    }
    assert.ok(all.chronicle.includes('编年 · 史卷'));
});

// ── 真账副本（只读）——★leg96c：**已收进仓库**，不再依赖仓库外路径 ──
//   ★为什么搬进来（这是一次真实损失换来的纪律）：原来这里写的是
//     `F:/deepseek/tmp/sw2-ui-audit/world.json`（仓库外）。leg96c 清理那个临时目录时把它当垃圾删了，
//     而这三条判据写的是"文件不在就跳过"⇒ **它们不报错、只是静默跳过**（`skipped 3`）——
//     ★**静默跳过比红了更坏：红了有人看见，跳过没人看见。**
//   ★那份 360 行的旧副本已无法恢复（现存副本是 367 / 162 行，回收站里那几份是小世界）
//     ⇒ 本笔换成同世界的另一份真账（60 轮 · 大荒z · 编年 **367** 行），并**按它的实测重新标定**下面所有数字。
//   ★纪律：**判据要吃的真账副本，跟判据一起住在仓库里**（先例 `test/fixtures/*-world.json`）——
//     否则它总会被某一次清理带走，而"跳过的绿"看起来永远是对的。
//   ★位置口径：放 **`test/fixtures/` 这一层**，**不放进 `fixtures/snapshots/`**——
//     那个子目录被 `snapshot-replay.test.js` 整个扫走当"快照"用（它按 `fx.sourceWorld` 去找世界文件），
//     真账放进去会被它当快照解析（leg96c 当场踩到：`ENOENT .../test/fixtures/undefined`）。
//     与仓里既有的 `live-world.json` / `player-world.json` / `golden-world.min.json` 同一层、同一命名法。
const REAL = new URL('./fixtures/chronicle-page-real-world.json', import.meta.url);
const hasReal = existsSync(REAL);   // 留作防御（正常路径下它必然在；不在只可能是仓库被剪过）

test('细案 §3.2 · 真账 367 行：零 UNKNOWN + 子类合计 = 总行数 + 四个数（126/70/92/50/29）', { skip: hasReal ? false : '★真账副本不在：它本该在 test/fixtures/chronicle-page-real-world.json（跑 leg96c 的装置可重建）' }, () => {
    const w = JSON.parse(readFileSync(REAL, 'utf8'));
    const sel = selectChroniclePage(w, { ...makeChronicleView(), range: 'all' });
    assert.equal(sel.total, 367, '真账编年 367 行');
    assert.equal(sel.counts.event, 126, '真事件 126');
    assert.equal(sel.counts.book, 241, '账目 241');
    assert.deepEqual(sel.bookGroups.map((g) => [g.key, g.hit]), [['走一步', 70], ['了结', 92], ['起因', 50], ['结清', 29]]);
    const sum = sel.bookGroups.reduce((a, g) => a + g.hit, 0) + sel.counts.event;
    assert.equal(sum, 367, '子类合计 + 真事件 = 总行数（★这是底线：零未分类）');
    assert.equal(sel.counts.done, 121, '已了结 121（了结 92 + 结清 29）');
    assert.equal(sel.counts.open, 246);
    // 「链」钮数（真账实测 218 行有目标）——三路口径下不许有假钮
    const noTarget = (w.chronicle || []).filter((c) => c.chainRef || c.eventRef).filter((c) => !chronicleChainTargetOf(c));
    assert.equal(noTarget.length, 0, '★"渲染了钮却没有目标"的行数必须是 0');
});

test('细案 §3.3 · 真账"近 N 轮"三档读数（近 5 轮 17 · 近 10 轮 30 · 近 20 轮 49 · 全部 126）', { skip: hasReal ? false : '真账副本不在' }, () => {
    const w = JSON.parse(readFileSync(REAL, 'utf8'));
    const ev = (range) => selectChroniclePage(w, { ...makeChronicleView(), range }).events.hit;
    assert.equal(ev('5'), 17);
    assert.equal(ev('10'), 30);
    assert.equal(selectChroniclePage(w, { ...makeChronicleView(), range: '20' }).events.hit, 49);
    assert.equal(ev('all'), 126);
});

test('细案 §3.6 · 真账：占位词「未明」不进搜索面（不含它的行搜不到，含它的行照旧搜得到）', { skip: hasReal ? false : '真账副本不在' }, () => {
    const w = JSON.parse(readFileSync(REAL, 'utf8'));
    // ★真账实测：**29 行**原文含「未明」——全部来自 `事发 未明` 这个**占位词**位置 ⇒ 搜索面里 0 行含它。
    //   ★判据不能用"搜「未明」命中 0"：真账里还有 29 行是**别的字段**带着这两个字（那是真内容，
    //     搜得到才对）。⇒ 咬的是**占位词那一格**：占位词位置上的「未明」一行都不许进搜索面。
    const placeholderRows = w.chronicle.filter((c) => /事发\s*未明/.test(String(c.text)));
    assert.ok(placeholderRows.length > 0, '真账里确实有一批"事发 未明"的行（否则这条判据是空绿）');
    const leaked = placeholderRows.filter((c) => chronicleSearchTextOf(c).includes('未明'));
    assert.equal(leaked.length, 0, `★占位词位置上的「未明」漏进搜索面 ${leaked.length} 行`);
    // 占位词那一格不进面，但它**自己**进面了（不是内容）——真地名照旧搜得到
    const vague = { text: '事件「死煞之气外泄」——由世界处境而生，事发 未明，牵动 万法阁' };
    assert.ok(!chronicleSearchTextOf(vague).includes('未明'));
    assert.match(chronicleSearchTextOf(vague), /死煞之气外泄/);
    const loc = selectChroniclePage(w, { ...makeChronicleView(), q: '东海浮空岛', range: 'all' });
    assert.ok(loc.counts.all > 0, '真地名照旧搜得到（不占列 ≠ 查不到）');
});
