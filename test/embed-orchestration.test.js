// story-world-v2/test/embed-orchestration.test.js
// ★★★leg152：**编排层**——一轮里"补嵌"与"召回"这两件事的胶水（细案 §5/§6）。
//
// ★为什么这一层也要判据（它的病都是"安静地花钱"或"安静地不干活"）：
//   ① 补嵌**必须封顶**：一次把全账嵌完 = 一个窗口打开就烧一大批调用；而且要**新的先嵌**
//      （窗口是从新往旧滑的 ⇒ 新的更早被召回）；
//   ② 补嵌**绝不许挡世界推进**：通道失败 ⇒ 如实记一笔、这轮跳过，**下一轮再来**（世界优先）；
//   ③ 失败**必须分诊**：可重试的（网络/限流）下轮补；"这行太长/模型号写错"那种**不许**反复撞；
//   ④ 召回是**只读**的：它顺手把"哪些候选没向量"数出来——那是"索引丢了"唯一的可读面，
//      不然界面上只会看到"这一栏空的"，分不出"没相关"还是"根本没索引"（本仓为这条静默付过账）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepEmbed, recallForPack } from '../src/embed-orchestration.js';
import { harnessOf, VECTOR_STORE_KIND } from '../src/vector-store.js';
import { timelineOf } from '../src/ledger-vector.js';

const SIG = { model: 'qwen-x', dims: 2 };

/** 一份小账：五件事（第 1~5 轮），窗口下界由测试给。 */
function makeWorld() {
    return {
        entities: [{ id: 'e1', name: '甲' }],
        events: [1, 2, 3, 4, 5].map((t) => ({ id: `ev_${t}_1`, title: `第${t}件事`, source: { type: 'state' }, position: '某地', ripples: ['e1'], tick: t, closed: true })),
        chronicle: [], agendas: [], meta: { tick: 10 },
    };
}
const itemsFor = (w) => timelineOf(w, { timeMarkOf: () => '' });

test('O1：补嵌封顶且最早缺口优先，重开后不会跳过积压', async () => {
    const w = makeWorld();
    const h = harnessOf(SIG);
    const seen = [];
    const client = { embed: async (texts) => { seen.push(texts.length); return texts.map((_, i) => [1, i]); } };
    const r = await stepEmbed({ ssot: w, harness: h, client, floor: 6, maxItemsPerTurn: 2, timeMarkOf: () => '' });
    assert.equal(r.embedded, 2, '★一轮最多 2 件');
    assert.deepEqual(seen, [2], '一批发出去（不是一件一次）');
    assert.deepEqual(h.store().ids, ['ev_1_1', 'ev_2_1'], '最早缺口优先');
    const r2 = await stepEmbed({ ssot: w, harness: h, client, floor: 6, maxItemsPerTurn: 2, timeMarkOf: () => '' });
    assert.deepEqual(h.store().ids, ['ev_1_1', 'ev_2_1', 'ev_3_1', 'ev_4_1'], '第二轮补下一批');
    const r3 = await stepEmbed({ ssot: w, harness: h, client, floor: 6, maxItemsPerTurn: 2, timeMarkOf: () => '' });
    assert.equal(r3.embedded, 1, '最后剩一件');
    const r4 = await stepEmbed({ ssot: w, harness: h, client, floor: 6, maxItemsPerTurn: 2, timeMarkOf: () => '' });
    assert.equal(r4.embedded, 0, '★都嵌过了 ⇒ 一件都不再来（水位线在咬）');
    assert.equal(r4.pending, 0);
});

test('O2：★窗口内的事一件都不嵌（那是「纪事」的活儿）', async () => {
    const w = makeWorld();
    const h = harnessOf(SIG);
    const client = { embed: async (texts) => texts.map(() => [1, 0]) };
    const r = await stepEmbed({ ssot: w, harness: h, client, floor: 4, maxItemsPerTurn: 10, timeMarkOf: () => '' });
    assert.equal(r.embedded, 3, '第 1~3 轮滑出窗口 ⇒ 只嵌这三件');
    assert.deepEqual(h.store().ids.slice().sort(), ['ev_1_1', 'ev_2_1', 'ev_3_1']);
});

test('O3：★通道失败 ⇒ **不挡世界**：如实记一笔、这轮跳过、下轮再来', async () => {
    const w = makeWorld();
    const h = harnessOf(SIG);
    const flaky = { embed: async () => { const e = new Error('嵌入通道失败：ECONNRESET'); e.retryable = true; throw e; } };
    const r1 = await stepEmbed({ ssot: w, harness: h, client: flaky, floor: 6, maxItemsPerTurn: 2, timeMarkOf: () => '' });
    assert.equal(r1.embedded, 0);
    assert.equal(r1.failed, 2, '失败的件数要如实报');
    assert.equal(r1.retryable, true);
    assert.equal(r1.blockedWorld, false, '★世界推进不许被它挡住');
    assert.deepEqual(h.store().ids, [], '失败 ⇒ 一件都不许写进索引');
    assert.ok(r1.note && /失败/.test(r1.note), `要给人话：${r1.note}`);
    // 下轮通道好了 ⇒ 同一批照样补上（没有留"假记性"）
    const ok = { embed: async (texts) => texts.map(() => [1, 0]) };
    const r2 = await stepEmbed({ ssot: w, harness: h, client: ok, floor: 6, maxItemsPerTurn: 2, timeMarkOf: () => '' });
    assert.equal(r2.embedded, 2);
});

test('O4：★不可重试的错 ⇒ 如实记成"别再来撞"（不是每轮白撞一次）', async () => {
    const w = makeWorld();
    const h = harnessOf(SIG);
    const hard = { embed: async () => { const e = new Error('嵌入通道 HTTP 400：input too long'); e.retryable = false; throw e; } };
    const r = await stepEmbed({ ssot: w, harness: h, client: hard, floor: 6, maxItemsPerTurn: 2, timeMarkOf: () => '' });
    assert.equal(r.retryable, false);
    assert.equal(r.embedded, 0);
});

test('O5：没有可用的客户端（没配嵌入通道）⇒ 静默空转**但如实标出来**（不是"没相关"）', async () => {
    const w = makeWorld();
    const h = harnessOf(SIG);
    const r = await stepEmbed({ ssot: w, harness: h, client: null, floor: 6, maxItemsPerTurn: 2, timeMarkOf: () => '' });
    assert.equal(r.embedded, 0);
    assert.equal(r.skipped, 'no-client');
    // ★一个字节都不许动索引
    assert.deepEqual(h.store().ids, []);
    // ★★顺序判据（leg152 收尾验收当场咬出来的）：**没有待嵌的东西时也必须报 no-client**——
    //   否则设置页那一行读数**分不出"没配"与"没欠账"**（本仓为这条静默付过账）。
    const r2 = await stepEmbed({ ssot: w, harness: h, client: null, floor: 0, maxItemsPerTurn: 2, timeMarkOf: () => '' });
    assert.equal(r2.skipped, 'no-client', '★下界 0（全在窗口内、没有待嵌的）也必须是 no-client，不是"没事可做"');
    assert.equal(r2.pending, 0);
});

test('O6：召回**只读**——顺手把"候选里多少件没向量"数出来（索引丢了的唯一可读面）', async () => {
    const w = makeWorld();
    // 索引里只装了两件（模拟"索引半丢"）：一件有向量、一件的向量是空的
    const store = { v: 1, kind: VECTOR_STORE_KIND, model: 'qwen-x', dims: 2, ids: ['ev_1_1', 'ev_2_1'], tickByIndex: [1, 2], vecs: [[1, 0], null] };
    const r = recallForPack(w, store, { qVector: [1, 0], floor: 6, top: 5, tickNow: 10 });
    assert.equal(r.rows.length, 1, '只有**真带向量**的那件回来');
    assert.match(r.rows[0], /第1件事/, '标题从账上现查（索引里不存正文）');
    assert.equal(r.report.candidates, 2, '窗口外、在索引里的候选 2 件');
    assert.equal(r.report.noVector, 1, '★其中 1 件没有向量 ⇒ 必须数出来（否则分不出"没相关"与"没索引"）');
    assert.equal(r.report.reason, 'ok');
    assert.equal(r.report.readOnly, true);
    assert.deepEqual(store.ids, ['ev_1_1', 'ev_2_1'], '★召回绝不许改索引');
    // 查询向量没给 ⇒ 空批次（不抛），理由如实是"没有查询"
    const r2 = recallForPack(w, store, { qVector: null, floor: 6, top: 5, tickNow: 10 });
    assert.deepEqual(r2.rows, []);
    assert.equal(r2.report.reason, 'no-query');
    assert.equal(r2.report.noVector, 0, '没真去算 ⇒ 不许报一个"缺向量"的数（那是假读数）');
    // 索引**整份空了** ⇒ 候选 0 ⇒ 理由必须是"没有候选"（不是"没相关"）
    const r3 = recallForPack(w, { v: 1, kind: VECTOR_STORE_KIND, model: 'qwen-x', dims: 2, ids: [], tickByIndex: [], vecs: [] }, { qVector: [1, 0], floor: 6, top: 5, tickNow: 10 });
    assert.equal(r3.report.reason, 'no-candidate');
    assert.equal(r3.report.candidates, 0);
});

test('O8：★补嵌**自己不碰盘**（写盘时机归存储调用方）——它一碰，运行时就会以为"没东西要写"', async () => {
    const w = makeWorld();
    const h = harnessOf(SIG);
    const client = { embed: async (texts) => texts.map(() => [1, 0]) };
    const r = await stepEmbed({ ssot: w, harness: h, client, floor: 6, maxItemsPerTurn: 2, timeMarkOf: () => '' });
    assert.equal(r.embedded, 2);
    assert.equal(h.writes(), 0, '★一件都不许在这里落盘（落盘是调用方的事）');
    assert.equal(h.dirty(), true, '★脏标记必须还留着——不然调用方永远不知道该写');
    assert.equal(h.persist(), true, '调用方来问的时候，必须拿到"有东西要写"');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// ★★★leg152：**单元是编年行**（实测定案：真账上"按实体问"前 6 里 6.00/6 对 4.20/6）
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
test('O9：★默认收**编年行**（账上真正逐条记着"谁做了什么"的那一份）——事件标题里常常没有那个人', async () => {
    const w = {
        entities: [{ id: 'e1', name: '薛铁衣' }],
        events: [{ id: 'ev_1_1', title: '北山灵脉异动', source: { type: 'state' }, position: '北山', ripples: ['e1'], tick: 1 }],
        chronicle: [
            { id: 'ch_1_ev_1', tick: 1, text: '事件「北山灵脉异动」——由世界处境而生，事发 北山', kind: 'state', eventRef: 'ev_1_1' },
            { id: 'ch_1_ag_1', tick: 1, text: '因事而生：薛铁衣 由「北山灵脉异动」生「剿灭北山残部」', kind: 'scheme' },
        ],
        agendas: [], meta: { tick: 20 },
    };
    const h = harnessOf(SIG);
    const seen = [];
    const client = { embed: async (texts) => { seen.push(...texts); return texts.map(() => [1, 0]); } };
    const r = await stepEmbed({ ssot: w, harness: h, client, floor: 10, maxItemsPerTurn: 10, timeMarkOf: () => '' });
    assert.equal(r.unit, 'chronicle', '★默认走编年行');
    assert.equal(r.embedded, 2, '两行都滑出窗口了 ⇒ 都嵌');
    assert.ok(seen.some((t) => t.includes('薛铁衣 由「北山灵脉异动」生')), `★那一行必须真被嵌（"知道每个实体都干了什么"的证据就在这类行里）：${JSON.stringify(seen)}`);
    assert.ok(seen.every((t) => /^\[第\d+轮\]/.test(t)), '单元行要带轮次');
});

test('O10：★编年一行都没有（老账/空账）⇒ **退回事件标题**（不许因此整层不干活）', async () => {
    const w = makeWorld();   // 这份夹具没有 chronicle
    const h = harnessOf(SIG);
    const client = { embed: async (texts) => texts.map(() => [1, 0]) };
    const r = await stepEmbed({ ssot: w, harness: h, client, floor: 6, maxItemsPerTurn: 3, timeMarkOf: () => '' });
    assert.equal(r.unit, 'events', '★退回事件那条路，并如实标出来');
    assert.equal(r.embedded, 3);
    // ★也可以显式点名只用事件（判据与回归要用）
    const h2 = harnessOf(SIG);
    const r2 = await stepEmbed({ ssot: { ...w, chronicle: [{ id: 'x', tick: 1, text: '一行编年' }] }, harness: h2, client, floor: 6, maxItemsPerTurn: 3, timeMarkOf: () => '', source: 'events' });
    assert.equal(r2.unit, 'events');
});

test('O11：★卷里那些旧行**也要收**（编年轮转会把它搬走；只读热账会漏掉索引最该收的那一段）', async () => {
    const w = { entities: [], events: [], chronicle: [{ id: 'ch_90_1', tick: 90, text: '热账里的一行', kind: 'major' }], agendas: [], meta: { tick: 100 } };
    const volumes = [{ id: 'v1', rows: [{ id: 'ch_10_1', tick: 10, text: '卷里的一行', kind: 'scheme' }] }];
    const h = harnessOf(SIG);
    const seen = [];
    const client = { embed: async (texts) => { seen.push(...texts); return texts.map(() => [1, 0]); } };
    const r = await stepEmbed({ ssot: w, harness: h, client, floor: 60, maxItemsPerTurn: 10, volumes, timeMarkOf: () => '' });
    assert.equal(r.embedded, 1, '窗口下界 60 ⇒ 只有第 10 轮那件（卷里那行）滑出去了');
    assert.ok(seen[0].includes('卷里的一行'), `★卷里的行必须进索引：${JSON.stringify(seen)}`);
});

test('O7：召回行**自带多久以前**与轮次（细案 §6①那条纪律的最终落点）', async () => {
    const w = makeWorld();
    const items = itemsFor(w);
    const store = { v: 1, kind: VECTOR_STORE_KIND, model: 'qwen-x', dims: 2, ids: items.map((x) => x.id), tickByIndex: items.map((x) => x.tick), vecs: items.map(() => [1, 0]) };
    const r = recallForPack(w, store, { qVector: [1, 0], floor: 6, top: 3, tickNow: 10 });
    assert.equal(r.rows.length, 3, 'top 封顶');
    assert.match(r.rows[0], /^\[第5轮\]第5件事/, `★新的在前、带轮次：${r.rows[0]}`);
    assert.match(r.rows[0], /(?:在)?你?此刻之前/, '★必须明说在此之前');
    assert.match(r.rows[0], /5 轮/, '距今多少轮要算出来（此刻第 10 轮、它是第 5 轮 ⇒ 5 轮之前）');
});
