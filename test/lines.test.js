// story-world-v2/test/lines.test.js
// 故事线（引擎层纯函数）：切树（单亲 ⇒ 互不相交）· 立线（全收口 ∧ 事件数 ≥ N）·
// ★多因点（`links.up` ≥ 2 —— 来路单亲管划分、合流多条管多因，两个指针分工）·
// 点名净化（账上没有的不替它造）· 经过行文（因果序、太长如实记"略"）。
//
// ★为什么口径要在这里锁死：N=5 是用户照 `demo/measure-leg127-line-curve.js` 的乙案曲线拍的
//   （`allClosed && eventCount >= N`）。这条判据就是"那把尺子没被换掉"的哨兵。
//   ★本笔删掉判据里那个 `hasOrigin` 合取项（实测永远为真：50 份真账 555 棵树里为假 0 棵）
//     与旧口径 `allNodesClosed` 那一格——**两格都不参与判定**，删它们不改任何一条线的进出。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    LINE_MIN_EVENTS, LINES_TOP, LINE_ONDEMAND_TOP,
    parentOfEvent, parentOfAgenda, nodesOf, forestOf, linesOf,
    lineTextOf, lineIndexOf, sanitizeLineRequests, buildLineDetail,
} from '../src/lines.js';

// 合成世界：`ev_<轮>_<位次>` 的号就是出生轮（`eventBornTick` 的解析口径）。
// 形状刻意做成一段真实因果：处境根 → 三件余波（其中一件是**多因**）→ 收口。
function world(over = {}) {
    return {
        events: [
            { id: 'ev_1_1', title: '死煞杀局启动', source: { type: 'state' }, closed: true, links: { up: [], down: [] } },
            { id: 'ev_2_1', title: '粮道被截', source: { type: 'ripple', ref: 'ev_1_1' }, closed: true, links: { up: ['ev_1_1'], down: [] } },
            { id: 'ev_3_1', title: '内应叛变', source: { type: 'ripple', ref: 'ev_1_1' }, closed: true, links: { up: ['ev_1_1'], down: [] } },
            // ★多因点：主因是 ev_2_1（source），合流表里还有第二条因 ev_3_1
            { id: 'ev_4_1', title: '商队覆灭', source: { type: 'ripple', ref: 'ev_2_1' }, closed: true, links: { up: ['ev_2_1', 'ev_3_1'], down: [] } },
            { id: 'ev_5_1', title: '残部西逃', source: { type: 'ripple', ref: 'ev_4_1' }, closed: true, links: { up: ['ev_4_1'], down: [] } },
            // 另一棵小树（只有 2 件 ⇒ 不够 N，丙级：不立线）
            { id: 'ev_6_1', title: '山道塌方', source: { type: 'state' }, closed: true, links: { up: [], down: [] } },
            { id: 'ev_7_1', title: '商旅绕行', source: { type: 'ripple', ref: 'ev_6_1' }, closed: true, links: { up: ['ev_6_1'], down: [] } },
            // 一棵够大但**还没全收口**的树 ⇒ 也不立线（"有收口"那一格在干活）
            { id: 'ev_8_1', title: '东海封海', source: { type: 'state' }, closed: true, links: { up: [], down: [] } },
            { id: 'ev_9_1', title: '渔船滞留', source: { type: 'ripple', ref: 'ev_8_1' }, closed: false, links: { up: ['ev_8_1'], down: [] } },
            { id: 'ev_10_1', title: '盐价飞涨', source: { type: 'ripple', ref: 'ev_9_1' }, closed: false, links: { up: ['ev_9_1'], down: [] } },
            { id: 'ev_11_1', title: '私盐横行', source: { type: 'ripple', ref: 'ev_10_1' }, closed: false, links: { up: ['ev_10_1'], down: [] } },
            { id: 'ev_12_1', title: '官盐告急', source: { type: 'ripple', ref: 'ev_11_1' }, closed: false, links: { up: ['ev_11_1'], down: [] } },
        ],
        agendas: [],
        milestones: [],
        ...over,
    };
}

test('切树：单亲 ⇒ 互不相交，每个节点恰好进一棵树；悬空来路算根并单独计数', () => {
    const w = world();
    const { nodes, trees, danglingParents } = forestOf(w);
    assert.equal(nodes.size, 12);
    assert.equal(danglingParents, 0);
    const seen = new Set();
    for (const tr of trees) for (const id of tr.ids) {
        assert.equal(seen.has(id), false, `节点 ${id} 进了两棵树（划分破了）`);
        seen.add(id);
    }
    assert.equal(seen.size, 12, '节点总数必须等于所有树加起来（不丢节点）');
    // 世界那棵大树有 5 件；另一棵 2 件；封海那棵 5 件
    const byRoot = new Map(trees.map((t) => [t.root, t]));
    assert.equal(byRoot.get('ev_1_1').eventCount, 5);
    assert.equal(byRoot.get('ev_6_1').eventCount, 2);
    assert.equal(byRoot.get('ev_8_1').eventCount, 5);
    assert.equal(byRoot.get('ev_8_1').allClosed, false, '有未收口的话，整棵不算收口');
});

test('悬空来路：指向账上没有的 id ⇒ 算作根 + 计数（不悄悄吞掉）', () => {
    const w = world({ events: [{ id: 'ev_1_1', title: '孤儿', source: { type: 'ripple', ref: 'ev_99_9' }, closed: true }] });
    const { trees, danglingParents } = forestOf(w);
    assert.equal(danglingParents, 1);
    assert.equal(trees.length, 1);
    assert.equal(trees[0].root, 'ev_1_1');
});

test('★多因点：`links.up` ≥ 2 的节点被认出来（来路仍是单亲 ⇒ 划分不破）', () => {
    const w = world();
    const { trees } = forestOf(w);
    const big = trees.find((t) => t.root === 'ev_1_1');
    assert.deepEqual(big.joins, ['ev_4_1'], '多因点就是"商队覆灭"（主因 ev_2_1 ＋ 另一条因 ev_3_1）');
    // ★它是**多因点**，不是**合流点**：它只有一个子（ev_5_1）⇒ 出边 1 条
    const kids = (w.events.filter((e) => e.source?.ref === 'ev_4_1')).length;
    assert.equal(kids, 1, '多因点不必是合流点（用户当场指出的那条区分）');
    // 反过来：共用一个头的那几件（ev_2_1 / ev_3_1 都挂在 ev_1_1 下）⇒ **合流点**在那儿
    assert.equal(w.events.filter((e) => e.source?.ref === 'ev_1_1').length, 2, '合流点是 ev_1_1（一个父、两个子）');
});

test('立线：有来路 ∧ 全收口 ∧ 事件数 ≥ 5 —— 口径与量测脚本的乙案同一把尺', () => {
    const w = world();
    const { lines, total } = linesOf(w);
    assert.equal(LINE_MIN_EVENTS, 5);
    assert.equal(total, 1, '只有那棵 5 件且全收口的树够格');
    assert.equal(lines.length, 1);
    const ln = lines[0];
    assert.equal(ln.根, 'ev_1_1');
    assert.equal(ln.头, '死煞杀局启动');
    assert.equal(ln.件, 5);
    assert.equal(ln.起, 1);
    assert.equal(ln.收, 5, '尾＝出生最晚那件');
    assert.equal(ln.尾, '残部西逃');
    assert.equal(ln.多因, 1);
});

test('立线：把 N 拧到 2 ⇒ 那棵 2 件的小树立起来了（N 是唯一旋钮）', () => {
    const { lines, total } = linesOf(world(), { n: 2 });
    // N=5 时只有 1 条（大树）；拧到 2 ⇒ 那棵 2 件的小树也够格 ⇒ 2 条。
    // ★封海那棵（5 件）**仍不算**——它没全收口 ⇒ "有收口"那一格照旧在干活（两条判据各管一件事）。
    assert.equal(total, 2, 'N 是唯一旋钮：拧小它，小树进来；但收口那一格不受 N 影响');
    assert.ok(lines.length <= LINES_TOP);
    assert.deepEqual(lines.map((l) => l.根).sort(), ['ev_1_1', 'ev_6_1']);
});

test('立线：排序按收口轮次新→旧（越近越接得上），同轮按根 id 兜底', () => {
    const w = world({
        events: [
            { id: 'ev_1_1', title: 'A', source: { type: 'state' }, closed: true },
            ...['ev_2_1', 'ev_3_1', 'ev_4_1', 'ev_5_1'].map((id, i) => ({ id, title: `A${i}`, source: { type: 'ripple', ref: i ? `ev_${i + 1}_1` : 'ev_1_1' }, closed: true })),
            { id: 'ev_6_1', title: 'B', source: { type: 'state' }, closed: true },
            ...['ev_7_1', 'ev_8_1', 'ev_9_1', 'ev_10_1'].map((id, i) => ({ id, title: `B${i}`, source: { type: 'ripple', ref: i ? `ev_${i + 6}_1` : 'ev_6_1' }, closed: true })),
        ],
    });
    const { lines } = linesOf(w);
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map((l) => l.根), ['ev_6_1', 'ev_1_1'], '收口晚的排前面');
});

test('盘算也是节点：父结算后 parentId 被删 ⇒ 仍认 source.ref（别把支脉丢掉）', () => {
    const w = world({
        events: [{ id: 'ev_1_1', title: '某事', source: { type: 'state' }, closed: true }],
        agendas: [
            // 父已结算：parentId 已删，只剩 source
            { id: 'ag_2_1', goal: '父谋', source: { type: 'event', ref: 'ev_1_1' }, closed: true },
            { id: 'ag_3_1', goal: '支脉', source: { type: 'parent', ref: 'ag_2_1' }, closed: true },
        ],
    });
    assert.equal(parentOfAgenda(w.agendas[0]), 'ev_1_1');
    assert.equal(parentOfAgenda(w.agendas[1]), 'ag_2_1');
    const trees = forestOf(w).trees;
    assert.equal(trees.length, 1, '盘算挂在同一棵树上，不许因 parentId 消失而分成两棵');
    assert.equal(trees[0].eventCount, 1);
});

test('旧账兼容：`parentId` 兜底（夹具只有 parentId 没有 source）', () => {
    assert.equal(parentOfAgenda({ id: 'ag_1_1', parentId: 'ag_9_9' }), 'ag_9_9');
    assert.equal(parentOfAgenda({ id: 'ag_1_1', source: { type: 'state' } }), null, 'state 源＝根');
    assert.equal(parentOfEvent({ id: 'ev_1_1', source: { type: 'seed' } }), null, '书里起头＝根');
    assert.equal(parentOfEvent({ id: 'ev_1_1', source: { type: 'plot', ref: 'ag_1_1' } }), 'ag_1_1', '由盘算而生');
});

test('归档副本也算节点：`milestones[].rows` 里的事件照样进森林（leg111 那一格）', () => {
    const w = {
        events: [{ id: 'ev_9_1', title: '热池那件', source: { type: 'ripple', ref: 'ev_1_1' }, closed: true }],
        agendas: [],
        milestones: [{
            id: 'm_10', span: { from: 1, to: 10 }, counts: { events: 4 }, titles: [], ids: [],
            rows: [
                { id: 'ev_1_1', title: '归档根', source: { type: 'state' } },
                { id: 'ev_3_1', title: '归档二', source: { type: 'ripple', ref: 'ev_1_1' } },
                { id: 'ev_4_1', title: '归档三', source: { type: 'ripple', ref: 'ev_3_1' } },
                { id: 'ev_5_1', title: '归档四', source: { type: 'ripple', ref: 'ev_4_1' } },
            ],
            links: { up: [], down: [] },
        }],
    };
    const { nodes, trees } = forestOf(w);
    assert.equal(nodes.get('ev_1_1').archived, true);
    assert.equal(nodes.get('ev_1_1').closed, true, '归档前提是整链结清 ⇒ 归档副本恒为已收口');
    assert.equal(trees.length, 1, '热池那件与归档那四件在同一棵树上（跨归档连得上）');
    assert.equal(trees[0].eventCount, 5);
});

test('行文：一条线一行，把根 id 放在行首（那是"点名取回"的把手）', () => {
    const { lines } = linesOf(world());
    const t = lineTextOf(lines[0]);
    assert.match(t, /^ev_1_1 死煞杀局启动 第1轮 → 5件 → 残部西逃 第5轮/);
    assert.match(t, /合流1/, '多因点在行上如实可见');
});

test('点名取回：只收账上真算得出来的根 id，其余落 missed（不替它造一条）', () => {
    const { lines } = linesOf(world());
    const idx = lineIndexOf(lines);
    const { ok, missed } = sanitizeLineRequests(['ev_1_1', 'ev_99_9', 'ev_1_1'], idx);
    assert.deepEqual(ok, ['ev_1_1'], '去重、且只收账上有的');
    assert.deepEqual(missed, ['ev_99_9']);
    // 上限：一轮最多要 LINE_ONDEMAND_TOP 条
    const many = Array.from({ length: 9 }, (_, i) => `ev_${i + 1}_1`);
    assert.equal(sanitizeLineRequests(many, idx).ok.length <= LINE_ONDEMAND_TOP, true);
});

test('经过：因果序（老在前）；太长 ⇒ 头尾各留 K 件、中间如实写"略 N 件"', () => {
    const { lines } = linesOf(world());
    const text = buildLineDetail(world(), lines[0].根);
    assert.match(text, /^\[1\]死煞杀局启动 → \[2\]粮道被截/);
    assert.match(text, /\[5\]残部西逃$/);

    // 一条 60 件的长链 ⇒ 头尾各 20 件 ＋ 中间 20 件如实记
    const long = {
        events: [
            { id: 'ev_1_1', title: '起点', source: { type: 'state' }, closed: true },
            ...Array.from({ length: 59 }, (_, i) => ({
                id: `ev_${i + 2}_1`, title: `第${i + 2}件`,
                source: { type: 'ripple', ref: i ? `ev_${i + 1}_1` : 'ev_1_1' }, closed: true,
            })),
        ],
        agendas: [], milestones: [],
    };
    const t2 = buildLineDetail(long, 'ev_1_1');
    assert.match(t2, /中间 20 件略/, '截断必须如实记名，不许装作这就是全部');
    assert.match(t2, /^\[1\]起点/);
    assert.match(t2, /\[60\]第60件$/);
});

test('确定性：同一份账两次调用逐字节一致（无随机、无 Date）', () => {
    const a = JSON.stringify(linesOf(world()));
    const b = JSON.stringify(linesOf(world()));
    assert.equal(a, b);
});

// ─────────── ★★★本次修（真模型 60 轮长跑实跑抓出来的病）：**"起点"不参与"全收口"** ───────────
// 病灶：判据要"整棵树全收口"而**根也算在内**，可 `state`／`seed` 源的那种事**引擎自己那一圈永不来收**
//   （`settle.js` 的自动收口只扫 `ripple` 源）⇒ **凡挂在"处境／种子"上的树，永远立不成一条线**。
//   实测：一棵 17 件、底下全收口的大树就卡在根那一格上，60 轮里一次都没进过包；
//   而**生产做种走的就是 `seed` 型**（`src/seed-roots.js`）⇒ 世界的主线从第一天起就是这栏的盲区。
// ★为什么这不是"放宽判据"：引擎自己早就把这两型当"**起点、不是待办的事**"
//   （`settle.js` 原话「播种源 / 处境源 = 链条的起点（不是"待办的事"）」）——
//   起点没收口 **≠** 故事没讲完；"收口"说的是**底下那些事**讲完了。
test('★本次修：处境根（state）自己没"收口"，底下的事都收了口 ⇒ **照样立得起线**', () => {
    const w = world();
    w.events = [
        { id: 'ev_1_1', title: '边关起了变故', source: { type: 'state' }, closed: false, links: { up: [], down: [] } },
        { id: 'ev_2_1', title: '粮道被截', source: { type: 'ripple', ref: 'ev_1_1' }, closed: true, links: { up: ['ev_1_1'], down: [] } },
        { id: 'ev_3_1', title: '内应叛变', source: { type: 'ripple', ref: 'ev_1_1' }, closed: true, links: { up: ['ev_1_1'], down: [] } },
        { id: 'ev_4_1', title: '商队覆灭', source: { type: 'ripple', ref: 'ev_2_1' }, closed: true, links: { up: ['ev_2_1', 'ev_3_1'], down: [] } },
        { id: 'ev_5_1', title: '残部西逃', source: { type: 'ripple', ref: 'ev_4_1' }, closed: true, links: { up: ['ev_4_1'], down: [] } },
    ];
    const tr = forestOf(w).trees.find((t) => t.root === 'ev_1_1');
    assert.equal(tr.eventCount, 5, '够 N=5');
    assert.equal(tr.rootIsStart, true, '认得出来"根是起点"');
    // ★本笔删掉 `tr.allNodesClosed`（旧口径"全节点收口"）那一格断言：字段已删（零读者），
    //   而"起点不收口不算事"这条口径由下一行 `allClosed` 锁着 ⇒ 判据没有变松。
    assert.equal(tr.allClosed, true, '★新口径：起点不收口不算事');
    assert.equal(linesOf(w).total, 1, '★它现在立得起线了（修之前这里是 0）');
    assert.match(lineTextOf(linesOf(w).lines[0]), /^ev_1_1 边关起了变故/);

    // ★闸还在：**起点之外**还有没收口的 ⇒ 照样不立线（这一次修的不是"要不要收口"）
    w.events.push({ id: 'ev_6_1', title: '还在打', source: { type: 'ripple', ref: 'ev_5_1' }, closed: false, links: { up: ['ev_5_1'], down: [] } });
    const tr2 = forestOf(w).trees.find((t) => t.root === 'ev_1_1');
    assert.equal(tr2.allClosed, false, '★底下有事没讲完 ⇒ 仍然不算收口（闸没放宽）');
    assert.equal(linesOf(w).total, 0);
});

test('★本次修：生产做种的 `seed` 根同理（两型同一条规矩，不是给 state 开的后门）', () => {
    const w = world();
    w.events = [
        { id: 'ev_1_1', title: '书里埋着的那件事', source: { type: 'seed' }, closed: false, links: { up: [], down: [] } },
        { id: 'ev_2_1', title: '第一波', source: { type: 'ripple', ref: 'ev_1_1' }, closed: true, links: { up: ['ev_1_1'], down: [] } },
        { id: 'ev_3_1', title: '第二波', source: { type: 'ripple', ref: 'ev_2_1' }, closed: true, links: { up: ['ev_2_1'], down: [] } },
        { id: 'ev_4_1', title: '第三波', source: { type: 'ripple', ref: 'ev_3_1' }, closed: true, links: { up: ['ev_3_1'], down: [] } },
        { id: 'ev_5_1', title: '平息', source: { type: 'ripple', ref: 'ev_4_1' }, closed: true, links: { up: ['ev_4_1'], down: [] } },
    ];
    const tr = forestOf(w).trees.find((t) => t.root === 'ev_1_1');
    assert.equal(tr.rootIsStart, true);
    assert.equal(tr.allClosed, true);
    assert.equal(linesOf(w).total, 1, '★生产做种那种根，也一样（否则世界主线永远是盲区）');
});

// ─────────── ★★★本次修：归档**不许把"多因点"洗掉**（真模型 60 轮实跑抓出来的病）───────────
// 病灶：归档只抄五格（没有 `links`）⇒ `causeCountOf` 读不到第二条因 ⇒ `causes` 恒为 1
//   ⇒ **`·合流N` 一归档就消失**。实测：热账里的多因点峰值 3、末段掉回 1。
//   ⇒ "多因点在长跑里可判"这件事，此前**只在热账那一段成立**。
test('★本次修：多因点进了归档副本之后**仍然是多因点**（`·合流` 不因归档而消失）', () => {
    const arch = (id, title, source, up) => ({
        id, title, source,
        ...(up.length >= 2 ? { links: { up } } : {}),   // ★归档口径：只有"主因之外还有别的因"才挂
    });
    const w = world();
    w.events = [{ id: 'ev_5_2', title: '山道塌方', source: { type: 'state' }, closed: true, links: { up: [], down: [] } }];
    w.milestones = [{
        id: 'm_10', span: { from: 1, to: 10 }, counts: { events: 4 }, titles: [], ids: ['ev_5_3', 'ev_5_4', 'ev_5_5', 'ev_5_6'],
        rows: [
            arch('ev_5_3', '商旅绕行', { type: 'ripple', ref: 'ev_5_2' }, ['ev_5_2']),
            arch('ev_5_4', '绕行遇伏', { type: 'ripple', ref: 'ev_5_3' }, ['ev_5_3', 'ev_5_2']),   // ★多因点
            arch('ev_5_5', '伏兵退去', { type: 'ripple', ref: 'ev_5_4' }, ['ev_5_4']),
            arch('ev_5_6', '商队重开', { type: 'ripple', ref: 'ev_5_5' }, ['ev_5_5']),
        ],
        links: { up: [], down: [] },
    }];
    assert.equal(nodesOf(w).get('ev_5_4').causes, 2, '★归档副本里的多因点照样算得出两条因');
    const { lines } = linesOf(w);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].多因, 1, '★这条线里仍有一处多因点');
    assert.match(lineTextOf(lines[0]), /合流1/, '★`·合流1` 不许因为归档而消失');

    // ★反证：不挂 `links` 的老行（= 修之前存下来的账）⇒ 如实少算，**不编**
    w.milestones[0].rows[1] = { id: 'ev_5_4', title: '绕行遇伏', source: { type: 'ripple', ref: 'ev_5_3' } };
    assert.equal(nodesOf(w).get('ev_5_4').causes, 1, '老账没有那格 ⇒ 少算（本仓口径：宁可少算，不许编）');
    assert.equal(linesOf(w).lines[0].多因, 0);
});
