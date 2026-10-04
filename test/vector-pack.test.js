// story-world-v2/test/vector-pack.test.js
// ★★★leg153（用户 2026-09-30 拍"甲：整栏进包"）：**召回那一栏真的进包了**——这一族判据守的是"最后一根线"。
//
// 【它治什么】leg152 把向量层做齐了（引擎/存储/接线/曲线），唯独**没有进包**：`recallForPack`
//   有实现、有判据、有读数，而 `pack.js` 一次都没调它。"进不进包"是**契约决定**（包里多一栏＝
//   承重墙变了）⇒ 等用户拍。用户拍了"甲"，本族就是那一拍的机器化。
//
// 【★每条判据防的是什么病（本仓规矩：判据锁"还对不对"，不只锁"在不在"）】
//   · **P1**：递进来的东西要真出现在包里，且**一件都没有就不许挂键**（空着就是空着）。
//   · **P2**：★**一个事实只许出现在一栏**——它和 `纪事`／`相关往事` 读的是**同一份账**。
//   · **P3**：机械记账（`LEDGER`）不进这一栏——"什么算往事"全仓只有一张表。
//   · **P4**：★**键序**：只许缀在 `turnFacts` 之前（那两条既有锁不许动）。
//   · **P5**：★**裁剪序**：它是"有选择"的那一类，排在 `纪事` 之后被丢；不在包里时**不许留假痕迹**。
//   · **P6**：★★本笔接最后一根线时当场抓出来的**真 bug** 的反证：生产形状的索引里**没有正文**，
//     正文必须回账上现查——查错表（查事件表）时每一行都是**空壳**，而读数照样报「ok · returned 6」。
//   · **P7**：★**顺序**：召回必须发生在"聊天侧这一轮的事落账之后、出包之前"（用户逐字裁过的那句）。
//   · **P8**：**失败零阻塞**：召回抛错 ⇒ 那一栏不出现，世界照常推进。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvolutionPack, trimPack, windowFromTick, RECENT_WINDOW_TURNS } from '../src/pack.js';
import { runTick } from '../src/tick.js';
import { recallForPack } from '../src/embed-orchestration.js';
import { VECTOR_STORE_KIND } from '../src/vector-store.js';
import { embedReadoutLine } from '../src/embed-client.js';
import { createEmbedRuntime } from '../web/embed-runtime.js';
import { historyStamp } from '../src/vector-history.js';

const COL = '按意思找回的旧事';
const F = (lines) => ['```tags', ...lines, '```'].join('\n');
const EMPTY_STEP = {
    actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
};
// 一条"按意思找回"的行（形状由 `recallForPack` 产出：一串自带走得多久的字符串）
const line = (tick, text) => `[第${tick}轮]${text} （第${tick}轮 · 在你此刻之前 ${60 - tick} 轮）`;
const item = (id, tick, text) => ({ id, tick, text, line: line(tick, text) });

const mkWorld = () => ({
    version: 1,
    context: { world: '测试', positions: ['未明', '忘川渡口'], playerId: null },
    entities: [
        { id: 'e_xue', kind: 'character', name: '薛铁衣', location: '忘川渡口', status: 'active' },
        { id: 'e_men', kind: 'faction', name: '天门', location: '未明', status: 'active' },
    ],
    weights: {}, agendas: [], events: [], milestones: [],
    // ★热账里那几行：① 窗口外（第 1 轮）② 窗口内（第 59 轮）③ 机械记账（窗口外）
    chronicle: [
        { id: 'ch_1_1', tick: 1, text: '事件「北山灵脉异动」——由世界处境而生，事发 北山', kind: 'state' },
        { id: 'ch_2_1', tick: 2, text: '盘算「守住北山」满步结算：结清', kind: 'scheme' },
        { id: 'ch_59_1', tick: 59, text: '事件「城头易帜」——沿「北山灵脉异动」而来，牵动 天门', kind: 'state' },
    ],
    meta: { tick: 60, simLog: [], warnings: [], entityFields: {} },
});

// ── P1：递进来的东西真进包；一件都没有 ⇒ 键不出现 ────────────────────────────────
test('P1：召回的行真进包（且**一件都没有就不挂键**——空着就是空着）', () => {
    const w = mkWorld();
    const vec = { items: [item('ch_1_1', 1, '北山灵脉异动'), item('ch_2_1', 2, '守住北山 结清')], report: {} };
    const withIt = buildEvolutionPack(w, null, { vecRecall: vec }).pack;
    assert.deepEqual(withIt[COL], [line(1, '北山灵脉异动'), line(2, '守住北山 结清')],
        '★递进来几件就摆几件、**逐字照抄**（引擎不在这儿改写一行）');
    // 空着就是空着：没给 / 给了空数组 / 给了坏形状 ⇒ **键一次都不许出现**
    for (const bad of [undefined, null, { items: [] }, { items: null }, '字符串']) {
        const p = buildEvolutionPack(w, null, { vecRecall: bad }).pack;
        assert.equal(COL in p, false, `★${JSON.stringify(bad)} ⇒ 键不许出现（不许挂空壳占位）`);
    }
});

// ── P2：★一个事实只许出现在一栏（它和另两栏读的是同一份账）────────────────────────
test('P2：★已经在别的往事栏里递过的行，这一栏**按行身份排掉**（同一份账不许读两遍）', () => {
    const w = mkWorld();
    // ★索引里存的是**编年原文**（带 `事件「」` 那层包装），而两栏递出去的是**洗过的那一句**
    //   ⇒ 行身份必须**洗过之后再比**，不然同一件事换个写法就漏过去了（这一条判据守的正是它）。
    const raw59 = '事件「城头易帜」——沿「北山灵脉异动」而来，牵动 天门';
    const vec = {
        items: [{ id: 'ch_59_1', tick: 59, text: raw59, line: line(59, '城头易帜') }, item('ch_1_1', 1, '北山灵脉异动')],
        report: {},
    };
    const p = buildEvolutionPack(w, null, { vecRecall: vec }).pack;
    assert.ok((p.纪事 || []).some((r) => Number(r.tick) === 59), '前提：第 59 轮那行真在「纪事」里');
    assert.deepEqual(p[COL], [line(1, '北山灵脉异动')], '★只在「纪事」里的那件被排掉，另一件留下');
});

// ── P3：机械记账不进这一栏（"什么算往事"全仓只有一张表）──────────────────────────
test('P3：★机械记账（LEDGER）不进这一栏——与「纪事」／「相关往事」共用同一张表', () => {
    const w = mkWorld();
    const vec = { items: [item('ch_2_1', 2, '盘算「守住北山」满步结算：结清'), item('ch_1_1', 1, '北山灵脉异动')], report: {} };
    const p = buildEvolutionPack(w, null, { vecRecall: vec }).pack;
    assert.deepEqual(p[COL], [line(1, '北山灵脉异动')], '★"满步结算"那一行是机械记账 ⇒ 不许当往事递出去');
});

// ── P4：★键序（那两条既有锁都不许动）────────────────────────────────────────────
test('P4：★键只许缀在 `turnFacts` 之前（`tag-extract` 那条"turnFacts 必须最末"的锁照旧）', () => {
    const w = mkWorld();
    const vec = { items: [item('ch_1_1', 1, '北山灵脉异动')], report: {} };
    const p = buildEvolutionPack(w, null, { vecRecall: vec, turnFacts: { actions: [], count: 0, parsed: 0 } }).pack;
    const keys = Object.keys(p);
    assert.equal(keys[keys.length - 1], 'turnFacts', '★`turnFacts` 仍是最末');
    assert.ok(keys.indexOf('纪事') < keys.indexOf(COL), '★那一栏挂在「纪事」之后（新键只做加法）');
});

// ── P5：★裁剪序（"有选择"的那一类，排在「纪事」之后被丢；不许留假痕迹）────────────
test('P5：★裁剪序——预算不够时先丢「纪事」，它比「纪事」多留一步；且不在包里时**不留假痕迹**', () => {
    const w = mkWorld();
    const vec = { items: [item('ch_1_1', 1, '北山灵脉异动')], report: {} };
    const p = buildEvolutionPack(w, null, { vecRecall: vec }).pack;
    const key = JSON.stringify(p);
    // 一点点往下挤预算：那一栏**只可能**在「纪事」先被丢掉之后才轮到自己
    let sawDrop = false;
    for (let b = 200; b > 0 && !sawDrop; b -= 5) {
        const c = JSON.parse(key);
        trimPack(c, b);
        const cut = Array.isArray(c.trimmed) ? c.trimmed : [];
        const at = cut.indexOf(COL);
        if (at >= 0) {
            sawDrop = true;
            const chronAt = cut.findIndex((s) => String(s).startsWith('纪事'));
            assert.ok(chronAt >= 0 && chronAt < at, `★它必须排在「纪事」**之后**被丢（实际痕迹 ${JSON.stringify(cut)}）`);
        }
    }
    assert.ok(sawDrop, '★这条判据不是空绿：真挤到过预算、真丢过它');
    // ★不在包里 ⇒ **一步都不许执行**（否则痕迹里多一条"丢了空气"的假账）
    const without = buildEvolutionPack(w, null, {}).pack;
    trimPack(without, 1);
    assert.ok(!(without.trimmed || []).includes(COL), '★那一栏本来就不在 ⇒ 痕迹里不许出现它');
});

// ── P6：★真 bug 的反证（生产形状的索引里没有正文）───────────────────────────────
test('P6：★正文必须回账上现查（生产索引只有 id／轮次／向量）——查错表就是**一栏空壳**', () => {
    const w = mkWorld();
    // ★三个等长数组＝**生产形状**（`vector-store.js` 那份），里面一个字都没有
    const store = {
        v: 1, kind: VECTOR_STORE_KIND, model: 'qwen-x', dims: 2,
        ids: ['ch_1_1', 'ch_2_1'], tickByIndex: [1, 2], vecs: [[1, 0], [1, 0]],
    };
    const r = recallForPack(w, store, { qVector: [1, 0], floor: 30, top: 6, tickNow: 60 });
    assert.equal(r.rows.length, 2, '两件都该回来');
    for (const s of r.rows) {
        assert.match(s, /北山灵脉异动|守住北山/, `★★每一行都必须带着账上那句正文（空壳＝这一栏白占额度）：${s}`);
        assert.ok(!/\]\s*（第/.test(s), `★★不许出现"只有轮次、没有正文"的空壳：${s}`);
    }
    assert.equal(r.report.noBody, 0);
    // ★反证：账上找不到那三样的行 ⇒ **不进**，而且要数出来（读数必须能说清"为什么是空的"）
    const orphan = { ...store, ids: ['ch_404'], tickByIndex: [1], vecs: [[1, 0]] };
    const r2 = recallForPack(w, orphan, { qVector: [1, 0], floor: 30, top: 6, tickNow: 60 });
    assert.deepEqual(r2.rows, [], '★账上查不到正文 ⇒ 不递（空壳比没有更坏）');
    assert.equal(r2.report.noBody, 1, '★而且必须数出来——不然读数上分不出"没相关"与"索引与账对不上"');
    assert.equal(r2.report.reason, 'none-matched', '★理由要如实：有候选、但一件都没成');
});

// ── P7：★顺序：落账之后、出包之前（用户逐字裁过的那句）──────────────────────────
test('P7：★召回发生在"聊天侧这一轮的事落账之后、出包之前"——查询串才拿得到这一轮', async () => {
    const w = mkWorld();
    let seen = null;
    let prompt = '';
    const dialogue = F(['【行动】薛铁衣｜迎战｜天门']);
    const r = await runTick({
        transport: async (p) => { prompt = String(p); return { text: JSON.stringify(EMPTY_STEP) }; },
        ssot: w, dialogue, extractCtx: {}, recall: false,
        recallVec: async (o) => {
            seen = o;
            // ★走到这里时，"聊天侧这一轮的事"必须**已经躺在账上**（顺序就是这一条判据的全部价值）
            const dlg = (o.ssot?.events || []).filter((e) => e.source?.type === 'dialogue');
            return { items: [item('ch_1_1', 1, `按意思找回的那一件（这一轮账上已有 ${dlg.length} 件正文事实）`)], report: { returned: 1 } };
        },
    });
    assert.equal(r.ok, true, `tick 应当跑通（实际：${r.error || ''}）`);
    assert.ok(seen, '★召回口必须被调到（没调＝这一栏根本没接线）');
    assert.equal(seen.tickNow, 61, '★轮次＝本轮的落账轮次（`meta.tick + 1`，与注册那一处同一个数）');
    assert.equal(seen.floor, windowFromTick(60, RECENT_WINDOW_TURNS), '★窗口下界与出包那一侧**同一个算法**');
    assert.ok((seen.ssot?.events || []).some((e) => e.source?.type === 'dialogue'),
        '★★★调到它的时候，聊天侧这一轮的事**已经落账了**（否则查询串永远慢一轮）');
    // ★★注意别拿"那一栏的名字"当判据：提示词正文里**本来就写着**那个名字（第 9 条的指路）
    //   ⇒ 只认**内容**在不在（那才是"这一栏真进了包"的证据）。
    assert.ok(prompt.includes('按意思找回的那一件'), '★那一栏的内容必须真在**递给模型的提示词**里（不是只在 pack 对象里）');
    assert.ok(prompt.includes('这一轮账上已有 1 件正文事实'), '★递进来的那一行逐字在提示词里');
});

// ── P8：失败零阻塞 ────────────────────────────────────────────────────────────
test('P8：★召回抛错／不给钩子 ⇒ 那一栏不出现，世界照常推进（加速层不许影响世界）', async () => {
    const dialogue = F(['【行动】薛铁衣｜迎战｜天门']);
    const PROBE = '按意思找回的那一件';
    const run = async (recallVec) => {
        let prompt = '';
        const r = await runTick({
            transport: async (p) => { prompt = String(p); return { text: JSON.stringify(EMPTY_STEP) }; },
            ssot: mkWorld(), dialogue, extractCtx: {}, recall: false,
            ...(recallVec ? { recallVec } : {}),
        });
        return { r, prompt };
    };
    // ★阳性对照（防这一条变成空绿）：同一个装置，钩子好好的 ⇒ 内容**必须**在提示词里
    const good = await run(async () => ({ items: [item('ch_1_1', 1, PROBE)], report: { returned: 1 } }));
    assert.ok(good.prompt.includes(PROBE), '阳性对照：钩子好好的时候那一栏真进包（否则下面那两条是空绿）');
    // ① 抛错 ② 根本不给钩子（＝没配那条通道的老世界）⇒ 内容都不许出现，而世界照常推进
    const boom = await run(async () => { throw new Error('通道炸了'); });
    assert.equal(boom.r.ok, true, '★★抛错也要把这一轮跑完（世界优先）');
    assert.ok(!boom.prompt.includes(PROBE), '★抛错 ⇒ 那一栏不出现');
    assert.ok(boom.r.ssot.meta.tick >= 61, '★世界真推进了');
    const none = await run(null);
    assert.equal(none.r.ok, true);
    assert.ok(!none.prompt.includes(PROBE), '★没给钩子（没配通道）⇒ 一个字节的扰动都不许有');
});

// ── R1–R5：★接线本身也要有判据（本仓规矩：要真 ctx 的接线，要么提成可导出函数真跑，要么注入假 ctx）──
//   这一族咬的是 `web/embed-runtime.js` 的 `recallForTick` ——"引擎那一侧只认 `{rows, items}`"，
//   而**真去建查询串、真去发那一次嵌入、真去索引里找**这三步都住在这儿。
const runRecall = (opts) => createEmbedRuntime(opts).recallForTick;

const RT_STORE = {
    v: 1, kind: VECTOR_STORE_KIND, model: 'qwen-x', dims: 2,
    ids: ['ch_1_1'], tickByIndex: [1], vecs: [[1, 0]],
    sourceById: { ch_1_1: historyStamp(mkWorld().chronicle.find(r => r.id === 'ch_1_1')) },
};
const rtWorld = () => {
    const w = mkWorld();
    w.events = [{ id: 'ev_61_1', title: '甲打探（对船娘）', source: { type: 'dialogue' }, tick: 61, ripples: [], closed: false }];
    return w;
};
const fakeIndex = (store) => ({ load: async () => store, save: async () => {}, drop: async () => {} });

test('R1：★查询串真按"当下状态 ＋ 聊天侧这一轮"拼出来，且**只用一趟**嵌入调用', async () => {
    const seen = [];
    const recall = runRecall({
        indexStore: fakeIndex(RT_STORE),
        client: { embed: async (texts) => { seen.push(...texts); return texts.map(() => [1, 0]); } },
        signature: { model: 'qwen-x', dims: 2 }, windowTurns: 50,
    });
    const r = await recall({ ssot: rtWorld(), tickNow: 61, floor: 30, volumes: [] });
    assert.equal(seen.length, 1, '★只嵌查询那一句（不是把一批旧事重嵌一遍）——这是"每轮多一趟往返"的全部内容');
    assert.match(seen[0], /这一轮正文：甲打探（对船娘）/, '★聊天侧这一轮交上来的事在查询串里');
    assert.ok(!seen[0].includes('玩家这一轮说'), '★旧口径那一段不许回来');
    assert.equal(r.items.length, 1);
    assert.match(r.items[0].text, /北山灵脉异动/, '★正文回账上现查（生产索引里只有 id/轮次/向量）');
});

test('R2：★没配通道／索引还没建 ⇒ `null`（一次网络都不发——没索引就没有"按意思找"这回事）', async () => {
    let calls = 0;
    const client = { embed: async (t) => { calls += 1; return t.map(() => [1, 0]); } };
    const noClient = runRecall({ indexStore: fakeIndex(RT_STORE), client: null, signature: { model: 'qwen-x', dims: 2 } });
    assert.equal(await noClient({ ssot: rtWorld(), tickNow: 61, floor: 30 }), null, '没配 ⇒ null');
    const empty = runRecall({ indexStore: fakeIndex({ ...RT_STORE, ids: [], tickByIndex: [], vecs: [] }), client, signature: { model: 'qwen-x', dims: 2 } });
    assert.equal(await empty({ ssot: rtWorld(), tickNow: 61, floor: 30 }), null, '索引空 ⇒ null');
    assert.equal(calls, 0, '★这两条路上**一次网络都不许发**（白花钱就是这么来的）');
    // 形状对不上（换了模型号）⇒ 视为没有（`vector-store` 那条"凑合读会给出假相似度"）
    const wrong = runRecall({ indexStore: fakeIndex({ ...RT_STORE, model: '别的模型' }), client, signature: { model: 'qwen-x', dims: 2 } });
    assert.equal(await wrong({ ssot: rtWorld(), tickNow: 61, floor: 30 }), null, '★换了模型号的老索引视为没有');
});

test('R3：★通道出错／回的条数对不上 ⇒ `null`，**永不抛**（加速层不许影响世界）', async () => {
    const boom = runRecall({ indexStore: fakeIndex(RT_STORE), client: { embed: async () => { throw new Error('超时'); } }, signature: { model: 'qwen-x', dims: 2 } });
    assert.equal(await boom({ ssot: rtWorld(), tickNow: 61, floor: 30 }), null);
    const short = runRecall({ indexStore: fakeIndex(RT_STORE), client: { embed: async () => [] }, signature: { model: 'qwen-x', dims: 2 } });
    assert.equal(await short({ ssot: rtWorld(), tickNow: 61, floor: 30 }), null, '★条数对不上 ⇒ 当作没有（不许拿半条冒充）');
    const emptyVec = runRecall({ indexStore: fakeIndex(RT_STORE), client: { embed: async () => [[]] }, signature: { model: 'qwen-x', dims: 2 } });
    assert.equal(await emptyVec({ ssot: rtWorld(), tickNow: 61, floor: 30 }), null, '★空向量 ⇒ 当作没有');
    // 空账（拼不出查询串）⇒ 也不许发那一次
    let calls = 0;
    const noQuery = runRecall({ indexStore: fakeIndex(RT_STORE), client: { embed: async (t) => { calls += 1; return t.map(() => [1, 0]); } }, signature: { model: 'qwen-x', dims: 2 } });
    assert.equal(await noQuery({ ssot: { events: [], agendas: [], chronicle: [], meta: { tick: 60 } }, tickNow: 61, floor: 30 }), null);
    assert.equal(calls, 0, '★空账 ⇒ 不编一句查询去撞网络');
});

test('R4：★卷里的行也认得出来（旧事轮转进卷之后，热账里已经查不到它）', async () => {
    const w = rtWorld();
    const store = { ...RT_STORE, ids: ['ch_5_9'], tickByIndex: [5], vecs: [[1, 0]], sourceById: { ch_5_9: historyStamp({ id: 'ch_5_9', tick: 5, text: '卷里记着的那件事', kind: 'state' }) } };
    let q = '';
    const recall = runRecall({ indexStore: fakeIndex(store), client: { embed: async (t) => { q = t[0]; return [[1, 0]]; } }, signature: { model: 'qwen-x', dims: 2 } });
    // 那行**只在卷里**（热账里没有它）——只查热账会静默地少一整段
    const r = await recall({ ssot: w, tickNow: 61, floor: 30, volumes: [{ id: 'v1', rows: [{ id: 'ch_5_9', tick: 5, text: '卷里记着的那件事', kind: 'state' }] }] });
    assert.ok(q, '前提：查询真发了');
    assert.equal(r.items.length, 1);
    assert.match(r.items[0].text, /卷里记着的那件事/, '★卷里的正文也要查得到（与索引收卷那条口径对齐）');
});

test('P9：★读数把四种"空"分开：没候选 / 没对上 / 向量对不上 / 出错', () => {
    const base = { enabled: true, count: 3, pending: 0 };
    const cases = [
        [{ reason: 'no-candidate', candidates: 0, returned: 0 }, /窗口外还没有可找的旧事/],
        [{ reason: 'none-matched', candidates: 4, returned: 0 }, /候选 4 件，一件都没对上/],
        [{ reason: 'bad-vector', returned: 0 }, /通道回的向量对不上/],
        [{ reason: 'error', note: '超时', returned: 0 }, /按意思找出错：超时/],
    ];
    for (const [recall, re] of cases) {
        const s = embedReadoutLine({ ...base, recall });
        assert.match(s, re, `★这一种"空"必须说得出为什么：${s}`);
    }
    // 有收获 ⇒ 报条数与候选；缺向量/正文对不上也要报
    const s2 = embedReadoutLine({ ...base, recall: { reason: 'ok', returned: 2, candidates: 5, noVector: 3, noBody: 1 } });
    assert.match(s2, /按意思找回 2 件（候选 5）/);
    assert.match(s2, /其中 3 件还没嵌/);
    assert.match(s2, /1 件在账上找不到正文/);
    // ★没跑过 ⇒ 一个字都不许提（不许印"0 件"冒充读数）
    assert.ok(!embedReadoutLine(base).includes('按意思'), '★这一层没跑过就不出声');
});
