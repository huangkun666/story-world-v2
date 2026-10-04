// story-world-v2/test/ledger-vector.test.js
// ★★★leg152：**向量记忆层**的判据（引擎层纯函数：单元行 / 水位线 / 检索去重 / 检索行）。
//
// ★写这一族的**目的**（不是为了行数）：把"什么时候嵌、嵌什么、召回什么、什么时候不许召回"
//   这四件事钉在**一条接口**上。细案 `docs/spec-memory-engine.md` §5/§6 那几条纪律
//   （切因果不切时间 · 搜索用总结召回用原文 · 召回必须带"多久以前" · 索引丢了账还能答）
//   在本仓是**承重墙**，而承重墙最容易在下一棒"顺手"漂走 ⇒ 必须有东西咬住。
//
// ★判据形态纪律（照 `test/rule-kinds.test.js` / `test/context-chain.test.js` 同一把尺）：
//   ① 不许拿"我在某一本书/某一份账里看到的词"当判据；② 判据跑的是**生产源码导出的函数**；
//   ③ 每条都要能当场红（下面逐条附"反向自证"的做法）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    unitLineOf, timelineOf, embedDelta, applyEmbeddings, cosine, recallQueryOf, recallOf, recalledRowOf,
    beforeNowOf, EMBED_TICK_KEYS, chronicleDelta, chronicleUnitText, usefulVolumes, dialogueTitlesOf,
} from '../src/ledger-vector.js';

// ── 夹具：一份小账（两件事 · 编年两行 · 一个实体）──
function makeWorld(over = {}) {
    const base = {
        entities: [{ id: 'e1', kind: 'character', name: '甲' }, { id: 'e2', kind: 'character', name: '乙' }],
        events: [
            { id: 'ev_10_1', title: '商队覆灭', source: { type: 'ripple', ref: 'ev_9_1' }, position: '落霞谷', ripples: ['e1'], tick: 10, closed: true },
            { id: 'ev_40_2', title: '城头易帜', source: { type: 'state' }, position: '北关', ripples: ['e2'], tick: 40, closed: true },
        ],
        chronicle: [
            { id: 'ch_10_ev_1', tick: 10, text: '事件「商队覆灭」——…', timeMark: '复苏历三年三月初七' },
            { id: 'ch_40_ev_2', tick: 40, text: '事件「城头易帜」——…' },
        ],
        agendas: [], weights: {},
        context: { positions: ['落霞谷', '北关'], playerId: null },
        meta: { tick: 60 },
    };
    return { ...base, ...over };
}

// ── ① 单元行：**带时间点**；排不出时间的**就不写那一格**（零占位）──
test('V1：单元行带时间点（照抄账上原话，不做算术）', () => {
    const w = makeWorld();
    const line = unitLineOf({ ...w.events[0], rippleNames: ['甲'] }, { timeMarkOf: (tick) => (tick === 10 ? '复苏历三年三月初七' : '') });
    assert.match(line, /^\[第10轮 · 复苏历三年三月初七\]商队覆灭/, `★时间点必须在行首那一格里：${line}`);
    assert.match(line, /波及 甲/, '波及的人要照账上真名写');
    assert.match(line, /位置 落霞谷/);
    assert.match(line, /ripple\(ev_9_1\)/, '来路要照抄');
    // ★反向自证：把这句断言改成"不含时间"⇒ 当场红（改前先跑过）
});

test('V2：排不出时间点 ⇒ 只写轮次，绝不补一个（红线：空着就是空着）', () => {
    const w = makeWorld();
    const line = unitLineOf(w.events[1], { timeMarkOf: () => '' });
    assert.match(line, /^\[第40轮\]城头易帜/, `★没有时间点就不许有"·"那一段：${line}`);
    assert.ok(!/ · /.test(line.slice(0, 12)), '不许出现空的时间格');
    assert.ok(!/undefined|null|NaN/.test(line), `不许把空值写进去：${line}`);
});

test('V3：事件没有 tick 字段 ⇒ 从 id 里认轮次（账上两种写法都有）', () => {
    const w = makeWorld();
    const ev = { id: 'ev_7_3', title: '无 tick 的老事', source: { type: 'state' }, position: '某地', ripples: [] };
    const line = unitLineOf(ev, { timeMarkOf: () => '' });
    assert.match(line, /^\[第7轮\]无 tick 的老事/, `id 里的轮次要认出来：${line}`);
});

// ★★★leg152：**时间不参与排序**（真账实测的定案，别让下一任"想当然"地加回去）
test('V3b：★★排序**只看相似度**——不许按新旧加权（真账实测：加了反而更差）', () => {
    const w = makeWorld();
    // 两件：旧的相似度高（0.9）、新的相似度低（0.5）。正确排序＝旧的在前。
    const items = [
        { id: 'ev_1_1', tick: 1, title: '旧而准', text: '旧而准' },
        { id: 'ev_50_1', tick: 50, title: '新而不准', text: '新而不准' },
    ];
    const store = { items, vectors: new Map([['ev_1_1', [0.9, 0.1]], ['ev_50_1', [0.5, 0.1]]]) };
    const got = recallOf(w, store, { qVector: [1, 0.1], floor: 100, top: 2 });
    assert.deepEqual(got.map((x) => x.id), ['ev_1_1', 'ev_50_1'], '★相似度高的在前——**不许因为旧就被压下去**');
    // ★反向自证：真账实测三档（纯相似度 6.00/6 · ×时间衰减 5.20/6 · ＋时间加成 6.00/6，
    //   而"窗口外的旧行进前 6"的条数是 0.40 / **0.00** / 0.20）⇒ 时间那一维**只用来显示**，不参与排序。
    //   （装置：`F:/deepseek/tmp/leg151/measure-time-ranking.mjs`）
});

// ── ② 水位线：只嵌"滑出窗口的"，永不重复 ──
test('V4：只取窗口外（tick < 下界）的事，且**永不重复**', () => {
    const w = makeWorld();
    // 第一次：窗口下界 = 31 ⇒ 只有第 10 轮那件该嵌
    const d1 = embedDelta(w, { embedded: new Set(), floor: 31 });
    assert.deepEqual(d1.items.map((x) => x.id), ['ev_10_1'], `★只该嵌滑出窗口的那件：${JSON.stringify(d1.items.map((x) => x.id))}`);
    // 把它嵌上，再算一次 ⇒ 空（不许重复嵌）
    let store = applyEmbeddings({ items: [], vectors: new Map() }, d1.items, (id) => [id.length, 1]);
    const d2 = embedDelta(w, { embedded: new Set(store.items.map((x) => x.id)), floor: 31 });
    assert.deepEqual(d2.items, [], '★已经嵌过的一件都不许再来');
    // 窗口推进到下界 41 ⇒ 第 40 轮那件这才滑出窗口
    const d3 = embedDelta(w, { embedded: new Set(store.items.map((x) => x.id)), floor: 41 });
    assert.deepEqual(d3.items.map((x) => x.id), ['ev_40_2'], '窗口往前挪之后，下一件才进来');
    // ★反向自证：把 floor 改成 10（窗口内）⇒ 当场红（那说明机制在嵌窗口内的事）
});

test('V5：水位线只增不减（tick 只增 ⇒ 永不会回头重嵌）', () => {
    const w = makeWorld();
    const a = embedDelta(w, { embedded: new Set(), floor: 31 });
    const b = embedDelta(w, { embedded: new Set(), floor: 31 });
    assert.deepEqual(a.items.map((x) => x.id), b.items.map((x) => x.id), '同一状态下两次算，结果必须逐字相同（幂等）');
    const c = embedDelta(w, { embedded: new Set(), floor: 61 });
    assert.ok(c.items.length >= a.items.length, '窗口只往前挪 ⇒ 待嵌集合只增不减');
});

// ── ③ 检索：余弦 / 门槛 / 空着就是空着 ──
test('V6：余弦算得对，且**没有向量的候选不许当 0 分参与**', () => {
    assert.equal(cosine([1, 0], [1, 0]), 1);
    assert.equal(cosine([1, 0], [0, 1]), 0);
    assert.ok(Math.abs(cosine([1, 2], [2, 4]) - 1) < 1e-9, '同向必须得 1');
    assert.equal(cosine(null, [1, 0]), null, '★缺向量 ⇒ null（不是 0）——空着就是空着');
    assert.equal(cosine([1, 0], undefined), null);
});

// ── ④ 召回：窗口内的不许召回（那是「纪事」的活儿）──
test('V7：★窗口内的事**一条都不召回**（它已经在包里了，召回就是重复喂）', () => {
    const w = makeWorld();
    const items = timelineOf(w, { timeMarkOf: () => '' });
    const vec = new Map(items.map((x) => [x.id, [1, 0]]));
    const store = { items, vectors: vec };
    // 下界 31 ⇒ 只有第 10 轮那件在窗口外；拿一个与两件都同向的查询去取
    const got = recallOf(w, store, { query: [1, 0], floor: 31, top: 5 });
    assert.deepEqual(got.map((x) => x.id), ['ev_10_1'], `★窗口内那件不许出现：${JSON.stringify(got.map((x) => x.id))}`);
    // 下界 5 ⇒ 两件都还在窗口里（10、40 都 ≥ 5）⇒ 一件都不许来
    const got2 = recallOf(w, store, { query: [1, 0], floor: 5, top: 5 });
    assert.equal(got2.length, 0, '下界 5 ⇒ 两件都还在窗口内，一条都不许召回');
    // ★反向自证：把下面那句的 floor 改成 0 ⇒ 窗口内那件（第 10 轮）也进来 ⇒ 条数变 2 ⇒ 这条判据真在咬
    const gate = recallOf(w, store, { query: [1, 0], floor: 11, top: 5 });
    assert.deepEqual(gate.map((x) => x.id), ['ev_10_1'], 'floor=11 ⇒ 第 10 轮那件仍在窗口外（tick<floor），第 40 轮那件在窗口内');
    // ★下界正好压在第 40 轮那件身上 ⇒ 它仍在窗口内（窗口**含下界**：`纪事` 收 `tick >= 下界`）
    assert.equal(recallOf(w, store, { query: [1, 0], floor: 40, top: 5 }).length, 1, '下界 40 ⇒ 第 40 轮那件还在窗口里');
    // ★反向自证：下界挪过一格（41）⇒ 它滑出去了 ⇒ 条数变 2 ⇒ 上面那句真在咬"窗口"这条线
    assert.equal(recallOf(w, store, { query: [1, 0], floor: 41, top: 5 }).length, 2, '下界 41 ⇒ 第 40 轮那件也滑出去了');
});

test('V8：门槛（minScore）真的把不够像的挡在外面，而且**如实报条数**', () => {
    const w = makeWorld();
    const items = timelineOf(w, { timeMarkOf: () => '' });
    const vec = new Map([['ev_10_1', [1, 0]], ['ev_40_2', [0, 1]]]);
    const store = { items, vectors: vec };
    const all = recallOf(w, store, { query: [1, 0], floor: 100, top: 5 });
    assert.equal(all.length, 2, '没有门槛时两件都来（第 40 轮那件余弦 0）');
    const near = recallOf(w, store, { query: [1, 0], floor: 100, top: 5, minScore: 0.5 });
    assert.deepEqual(near.map((x) => x.id), ['ev_10_1'], '门槛 0.5 ⇒ 余弦 0 的那件被挡下');
    // 排序：分数高的在前
    assert.equal(all[0].id, 'ev_10_1', '同分时按轮次新的在前／不同分时分数高的在前');
});

test('V9：★重复不许出现——同一件往事已经在这一栏里递过，就不再递（按行身份去重）', () => {
    const w = makeWorld();
    const items = timelineOf(w, { timeMarkOf: () => '' });
    const store = { items, vectors: new Map(items.map((x) => [x.id, [1, 0]])) };
    const first = recallOf(w, store, { query: [1, 0], floor: 100, top: 5, excludeIds: [] });
    assert.equal(first.length, 2);
    const second = recallOf(w, store, { query: [1, 0], floor: 100, top: 5, excludeIds: first.map((x) => x.id) });
    assert.deepEqual(second, [], '★已经递过的必须让位（否则"每轮都在递同一批"）');
});

test('V10：检索行**必须自带"多久以前"**，且排不出时间就只报轮次', () => {
    const w = makeWorld();
    const withTime = recalledRowOf({ id: 'ev_10_1', tick: 10, text: '商队覆灭', timeMark: '复苏历三年三月初七' }, { tickNow: 60 });
    assert.match(withTime, /第10轮/, '轮次必须有');
    assert.match(withTime, /复苏历三年三月初七/, '时间点有就必须照抄');
    const noTime = recalledRowOf({ id: 'ev_40_2', tick: 40, text: '城头易帜', timeMark: '' }, { tickNow: 60 });
    assert.match(noTime, /第40轮/);
    assert.ok(!/复苏历|null|undefined|NaN/.test(noTime), `★排不出时间就只报轮次，绝不补一个：${noTime}`);
});

test('V11：★每条召回都明说"在此刻之前"（间隔是多少轮也要能算出来）', () => {
    const b = beforeNowOf({ tick: 10 }, { tickNow: 60 });
    assert.match(b, /第10轮/);
    assert.match(b, /50 轮|50轮/, `★距今多少轮要算出来：${b}`);
    assert.match(b, /之前/, `★必须明说它在此刻之前：${b}`);
    // 查不到轮次 ⇒ 不许瞎说
    assert.equal(beforeNowOf({ tick: null }, { tickNow: 60 }), '');
});

test('V12：★索引丢了账还能答——没有向量的候选一律不进召回（降级不是崩）', () => {
    const w = makeWorld();
    const items = timelineOf(w, { timeMarkOf: () => '' });
    const store = { items, vectors: new Map() };        // ★索引整份丢了
    const got = recallOf(w, store, { query: [1, 0], floor: 0, top: 5 });
    assert.deepEqual(got, [], '没向量 ⇒ 召回空批次（而不是抛错、也不是拿 0 分冒充）');
    // 而"账还能答"由既有那条路保证（本层不碰它）——这里只钉"本层不许崩、不许编"
    assert.ok(Array.isArray(EMBED_TICK_KEYS), '本层的常量也照旧可用');
});

// ★★★leg153：**查询串的第三样换了**（用户 2026-09-30 裁：「玩家这一轮说的话就不要了，
//   应该是聊天侧本轮提供的事件」）。为什么这条改得动：判据跟的是**口径**，而口径是用户裁的；
//   旧口径（玩家原话）与被否掉的那条"模型发起取回"是同一个方向——**原话是另一种写法**，
//   而索引里的单元是**账上那行** ⇒ 问法与料不同种话。
test('V13：查询串由**当下状态**拼（在动的人 ＋ 未决的事 ＋ ★聊天侧这一轮交上来的事）', () => {
    const w = makeWorld({
        agendas: [{ id: 'a_1', owner: 'e1', goal: '清点残部', closed: false }],
        events: [
            { id: 'ev_10_1', title: '商队覆灭', source: { type: 'ripple', ref: 'ev_9_1' }, position: '落霞谷', ripples: ['e1'], tick: 10, closed: true },
            { id: 'ev_59_1', title: '北关告急', source: { type: 'state' }, position: '北关', ripples: ['e2'], tick: 59, closed: false },
            // ★聊天侧这一轮交上来的两件（`registerDialogueFacts` 落的形状：源就是正文本身）
            { id: 'ev_61_1', title: '甲打探（对船娘）', source: { type: 'dialogue' }, dialogueKind: 'action', ripples: ['e1'], tick: 61, closed: false },
            { id: 'ev_61_2', title: '乙的所在变成了「落霞谷」', source: { type: 'dialogue' }, dialogueKind: 'change', ripples: ['e2'], tick: 61, closed: false },
            // ★上一轮那批（轮次对不上）——**不许混进来**（否则查询串永远慢一轮）
            { id: 'ev_60_1', title: '上一轮的一件旧事', source: { type: 'dialogue' }, ripples: ['e1'], tick: 60, closed: true },
        ],
    });
    const q = recallQueryOf(w, { tickNow: 61 });
    assert.match(q, /清点残部/, '在飞的盘算要进来');
    assert.match(q, /甲/, '在动的人名要进来');
    assert.match(q, /北关告急/, '未决的事要进来');
    // ★那一行单独拎出来看（别拿整串判——"未决的事"那一行也会印标题，混在一起就分不出是谁带进来的）
    const said = String(q).split('\n').find((s) => s.startsWith('这一轮正文：'));
    assert.ok(said, '★要有一行"这一轮正文"');
    assert.match(said, /甲打探（对船娘）/, '★聊天侧这一轮交上来的事要进来（照抄标题，不转述）');
    assert.match(said, /乙的所在变成了/, '★【变化】那一件也要进来');
    assert.ok(!said.includes('上一轮的一件旧事'), '★轮次对不上的那批不许混进来（查询串不许慢一轮）');
    // ★旧口径的那一段**整段不许再出现**（用户裁掉的正是它）
    assert.ok(!q.includes('玩家这一轮说'), '★「玩家这一轮说的话」那一段已经撤掉，不许请回来');
    // 空账 ⇒ 空串（不许编一句占位）
    const q0 = recallQueryOf({ entities: [], events: [], agendas: [], chronicle: [] }, { tickNow: 61 });
    assert.equal(String(q0).trim(), '');
});

test('V13b：★聊天侧那一批只认"源是正文 ＋ 轮次对得上"——世界步自己的事不许混进来', () => {
    const ev = (id, type, tick, title) => ({ id, title, source: { type }, tick, ripples: [] });
    const w = makeWorld({
        events: [
            ev('ev_61_1', 'dialogue', 61, '正文里的一件'),
            ev('ev_61_2', 'ripple', 61, '世界步自己推出来的一件'),
            ev('ev_61_3', 'state', 61, '处境自己变的一件'),
        ],
    });
    assert.deepEqual(dialogueTitlesOf(w, 61), ['正文里的一件'], '★只有 dialogue 那一批算"聊天侧交上来的"');
    // 认不出轮次 / 没给轮次 ⇒ 空数组（空着就是空着，不许拿"最近一批"凑）
    assert.deepEqual(dialogueTitlesOf(w, null), []);
    assert.deepEqual(dialogueTitlesOf(w, ''), []);
    assert.deepEqual(dialogueTitlesOf(w, 999), [], '★没有那一批 ⇒ 空（不许退回上一轮那批）');
    assert.deepEqual(dialogueTitlesOf(null, 61), [], '没账 ⇒ 空（不抛）');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// ★★★leg152：**只挑"还可能没嵌的"卷**（每轮取全卷会长成"越玩越卡"）
//   实测：跑到 3000 轮时每轮读回 ≈1MB、累计 3.1GB，而**零收益**（老卷早就嵌过了）。
// ＝＝＝＝＝＝＝════
const vol = (id, ticks) => ({ id, rows: ticks.map((t) => ({ id: `${id}_${t}`, tick: t, text: `第${t}轮的事` })) });

test('V14：★整卷都还在窗口内 ⇒ **跳过**（里头不可能有待嵌的行）', () => {
    const vols = [vol('v1', [10, 20]), vol('v2', [80, 90]), vol('v3', [150, 160])];
    const got = usefulVolumes(vols, { floor: 50 });
    assert.deepEqual(got.map((x) => x.id), ['v1'], `★下界 50 ⇒ 只有 v1（最老 10 < 50）要取：${JSON.stringify(got.map((x) => x.id))}`);
    // ★反向自证：下界挪到 5 ⇒ v1 整卷也在窗口内 ⇒ 一卷都不必取
    assert.deepEqual(usefulVolumes(vols, { floor: 5 }).map((x) => x.id), []);
});

test('V15：★交界那一卷**必然入选**（它的最老 tick < 下界、最新 ≥ 下界）', () => {
    const vols = [vol('v1', [10, 40]), vol('v2', [45, 55, 70])];
    const got = usefulVolumes(vols, { floor: 50 });
    assert.deepEqual(got.map((x) => x.id), ['v1', 'v2'], '★v2 跨在下界上（45 < 50 ≤ 70）⇒ 必须取');
});

test('V16：★索引是空的（首次建立/换模型）⇒ **全都要**（要回填整本账，不许只挑几卷）', () => {
    const vols = [vol('v1', [10]), vol('v2', [200]), vol('v3', [400])];
    assert.equal(usefulVolumes(vols, { floor: 450, indexEmpty: true }).length, 3, '★空索引 ⇒ 一卷都不许跳');
    // ★反向自证：索引不空、且三卷**全在窗口内**（下界压到 5）⇒ 一卷都不必取
    assert.equal(usefulVolumes(vols, { floor: 5, indexEmpty: false }).length, 0, '全在窗口内 ⇒ 一卷都不取');
    // 下界 450 ⇒ 三卷**都在窗口外**（最老 10/200/400 都 < 450）⇒ 三卷都要取（那不是"浪费"，是真有待嵌的行）
    assert.equal(usefulVolumes(vols, { floor: 450, indexEmpty: false }).length, 3, '★窗口外的卷必须取');
});

test('V17：认不出轮次的卷**保守留着**（宁可多读一卷，也不许漏一整段）；空卷直接跳过', () => {
    const vols = [{ id: 'vx', rows: [{ id: 'x', text: '没写轮次' }] }, { id: 'vy', rows: [] }, vol('vz', [10])];
    const got = usefulVolumes(vols, { floor: 50 }).map((x) => x.id);
    assert.deepEqual(got, ['vx', 'vz'], `★认不出轮次的要留着（不许静默丢）：${JSON.stringify(got)}`);
});

test('V18：★少取几卷**不许漏嵌**——过滤掉的那些卷，里头一行都不该待嵌', () => {
    // 卷：v1 全窗口外（待嵌）、v2 全窗口内（不该嵌）
    const rows = [...vol('v1', [10, 20]).rows, ...vol('v2', [80, 90]).rows];
    const floor = 50;
    const all = chronicleDelta({ chronicle: [] }, { rows, floor, embedded: new Set() });
    const picked = chronicleDelta({ chronicle: [] }, { rows: usefulVolumes([vol('v1', [10, 20]), vol('v2', [80, 90])], { floor }).flatMap((v) => v.rows), floor, embedded: new Set() });
    assert.equal(all.pending, 2, '整批里待嵌 2 行（第 10、20 轮）');
    assert.equal(picked.pending, 2, `★过滤之后待嵌数必须一样（漏了就是"少收一整段"）：${JSON.stringify(picked.items.map((x) => x.tick))}`);
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// ★★leg152 收尾验收：**残缺/荒唐的输入下不许崩、不许编**（"如实登记边界与降级"那一项的机器化）
//   装置：`F:/deepseek/tmp/leg151/verify-boundaries.mjs`（22 项，本轮全过）
// ＝＝＝＝＝＝＝════
test('V19：★残缺的账：只收"有 id ＋ 有轮次 ＋ 有正文"的行；重复 id 只出一条；认不出的一律不进', () => {
    const weird = {
        chronicle: [
            { id: 'a', tick: 1, text: '正常的一行' },
            { id: 'b', text: '没有轮次' },
            { id: 'c', tick: 'x', text: '轮次不是数' },
            { id: 'd', tick: 2 },
            { text: '没有 id' },
            null,
            { id: 'a', tick: 1, text: '重复 id' },
            { id: 'e', tick: -5, text: '轮次是负的' },
        ],
        meta: { tick: 100 },
    };
    const d = chronicleDelta(weird, { floor: 50, embedded: new Set() });
    assert.equal(d.items.length, 2, `★只收两行（正常那行 ＋ 负轮次那行）：${JSON.stringify(d.items.map((x) => x.id))}`);
    assert.equal(new Set(d.items.map((x) => x.id)).size, 2, '重复 id 只出一条');
    assert.ok(d.items.some((x) => x.tick === -5), '★负轮次不许被丢掉（账上怎么写就怎么算，引擎不替它改）');
});

test('V20：★荒唐输入下召回**一律空批次**（不抛、不编、不拿 0 分冒充）', () => {
    const store = { v: 1, ids: ['a'], tickByIndex: [1], vecs: [[1, 0]] };
    assert.deepEqual(recallOf({}, store, { qVector: null, floor: 100 }), [], '空查询 ⇒ 空');
    assert.deepEqual(recallOf({}, store, { qVector: [1, 0, 0], floor: 100 }), [], '维度对不上 ⇒ 空');
    assert.deepEqual(recallOf({}, store, { qVector: [NaN, 0], floor: 100 }), [], 'NaN ⇒ 空');
    assert.deepEqual(recallOf({}, null, { qVector: [1, 0], floor: 100 }), [], 'store 是 null ⇒ 空');
    assert.deepEqual(recallOf({}, { items: '不是数组' }, { qVector: [1, 0], floor: 100 }), [], 'items 不是数组 ⇒ 空');
});

test('V21：★卷的荒唐形状（不是数组 / rows 不是数组 / 全是坏行）', () => {
    assert.deepEqual(usefulVolumes(null, { floor: 10 }), [], 'volumes 不是数组 ⇒ 空（不是抛）');
    assert.deepEqual(usefulVolumes([{ id: 'v', rows: '不是数组' }], { floor: 10 }), [], 'rows 不是数组 ⇒ 跳过');
    assert.equal(usefulVolumes([{ id: 'v', rows: [null, { text: '没有轮次' }] }], { floor: 10 }).length, 1, '★认不出轮次 ⇒ 保守留着（宁可多读一卷）');
});
