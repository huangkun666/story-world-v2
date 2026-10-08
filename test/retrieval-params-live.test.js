// 参数页那一卡「往事怎么找」的判据——**两笔**都住这里：
//
// ★第一笔（leg192 · 用户 2026-10-05）：「把冻结改成真正生效吧」——
//   病：那几格在界面上可填、写盘也真写，而**真跑的那条路读的是冻结常数**（`RETRIEVAL_PARAMS`）
//   ⇒ 填了不生效。治法：参数改成"每次用时现取"（`liveRetrievalParams`），并把**取数的那个指纹**并进
//   "这份结果属于哪一次查询"（`readVectorScope`）⇒ 参数一改，备好的旧结果当场作废、重取。
//
// ★★第二笔（leg193 · 同日四句连着下的令）：
//   ①「让说明靠近一点，隔得太远了」⇒ 标签与框包进同一格（`.sw2-field-head`），说明紧跟其下；
//   ②「这四枚开关各往对话里塞什么」那枚问号**过时了，删了** ⇒ 整段撤掉（它写的"塞两段"早就不准）；
//   ③「**接下来我要做向量库注入聊天上下文的设置**…**对齐向量通道的开关**，如果开就用向量检索
//      不开就用原来的检索即可」⇒ **自动对齐**：向量通道开着才走向量路（可见处在读数行里）；
//   ④「注意**检索上下文深度**正是说的是聊天的上下文，这个理应对**原来检索和向量检索是共用的**」
//      ⇒ 查询串只拼一次，两路吃同一串（本文件的"共用"那条咬的就是它）；
//   ⑤「**字额度切忌把事件截掉**」⇒ 多一格「往事注入多少字」，**装不下就整条不进、绝不截半条**；
//   ⑥「把图片的第一段话中的关键信息抽取出来展示在参数页，第二段话可以删了，这是用来调试的」
//      ⇒ 读数行重画（哪一段多少字 ＋ 往事走哪一路）、"注入器还没跑过…"那一行整条撤掉。
//
// 纪律：这一组必须走**真生产函数**（`makeVectorRecall` / `createInjector` / `renderParamsHtml`），
//   写成判据自己的复制品就等于没测。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createEmbedRuntime } from '../web/embed-runtime.js';
import { makeVectorRecall } from '../web/settings-channels.js';
import { createInjector, INJECT_KEY_LEDGER, liveRetrievalParams, RETRIEVAL_PARAMS } from '../web/inject.js';
import { injectReadoutHtml, vectorPathLine } from '../web/inject-readout.js';
import { renderParamsHtml } from '../src/render.js';
import { LEDGER_CHARS_DEFAULT } from '../src/limits.js';

// 真渲染的运行子页；取域按子页 ID，避免随卡片文案和控件顺序漂移。
function runtimePanel(html) {
    const from = html.indexOf('id="sw2_subtab_params_runtime_panel"');
    const to = html.indexOf('id="sw2_subtab_params_conditions_panel"');
    assert.ok(from >= 0 && to > from, '前置：取得到运行与注入子页');
    return html.slice(from, to);
}
function cardOf() {
    const world = JSON.parse(fs.readFileSync(new URL('./fixtures/chronicle-page-real-world.json', import.meta.url), 'utf8'));
    const html = renderParamsHtml(world, { config: {} });
    return runtimePanel(html);
}

const turn = () => new Promise(resolve => setImmediate(resolve));

// 真装配的召回口：真 `createEmbedRuntime` ＋ 可控的"设置现值"
async function recallHarness() {
    const rows = Array.from({ length: 8 }, (_, i) => ({
        id: `ch_${i + 1}_1`, tick: i + 1, text: `甲在第${i + 1}轮办事`, kind: 'state',
    }));
    const world = { meta: { tick: 8 }, chronicle: rows };
    let disk = null;
    const runtime = createEmbedRuntime({
        indexStore: { load: async () => disk, save: async (value) => { disk = value; } },
        client: { embed: async (texts) => texts.map(() => [1, 0]) },
        signature: { model: 'fixture', dims: 2 }, windowTurns: () => 3,
    });
    await runtime.stepForTick({ world, volumes: [], floor: 9, maxItemsPerTurn: 10 });
    assert.equal(disk.ids.length, 8, '前提：八条都已有向量');
    const settings = { top: 2, minScore: 0, depth: 2 };
    const asked = [];
    const recall = makeVectorRecall({
        getCtx: () => ({ chat: [{ is_user: true, mes: '甲办事' }] }),
        getWorld: () => world, getRuntime: () => runtime, getVolumes: () => [],
        queryTextOf: (ctx, depth) => { asked.push(depth); return `甲办事 深度${depth}`; },
        params: () => ({ ...settings }),
    });
    return { recall, settings, asked };
}

test('最大召回条数：改设置当场改结果（不再读冻结常数）', async () => {
    const h = await recallHarness();
    const two = await h.recall();
    assert.equal(two.items.length, 2, '设置 2 ⇒ 最多取回 2 条');
    h.settings.top = 5;
    const five = await h.recall();
    assert.equal(five.items.length, 5, '★设置改成 5 之后，下一次取回就是 5 条（旧法恒为出厂 6）');
    h.settings.top = Number.NaN;
    const fallback = await h.recall();
    assert.equal(fallback.items.length, RETRIEVAL_PARAMS.top, '★非法/缺省 ⇒ 退回出厂值，不许编一个数');
});

test('检索上下文深度：改设置当场改查询串（旧法用的是装配时抓死的那份）', async () => {
    const h = await recallHarness();
    await h.recall();
    h.settings.depth = 7;
    await h.recall();
    assert.deepEqual(h.asked, [2, 7], '★查询串取几条正文，用的是当下这一格的值');
});

test('只改检索参数也要重新备一次，不许拿旧参数的结果充数', async () => {
    const hooks = new Map(), jobs = [], writes = [];
    // 查询串要有字：`sw2RecallQueryText` 会跳过玩家发言、只收"世界写的正文"
    const chat = [{ is_user: false, mes: '上一轮：商队进了山。' }, { is_user: true, mes: '继续' }];
    const world = { meta: { tick: 3 }, chronicle: [], entities: [], events: [], agendas: [], milestones: [] };
    // 形状照生产：注入器拿到的就是设置现值（`retrieval*` 那几个键），
    // 由 `liveRetrievalParams` 归一成召回要的那几格。
    const params = { retrievalTop: 2, retrievalMinScore: 0, retrievalDepth: 2 };
    const ctx = {
        chatId: 'chat-a', chat,
        eventTypes: { MESSAGE_SENT: 'sent' },
        eventSource: { on: (event, fn) => hooks.set(event, fn) },
        setExtensionPrompt: (key, value) => { if (key === INJECT_KEY_LEDGER) writes.push(value); },
    };
    const injector = createInjector({
        getCtx: () => ctx, getWorld: () => world,
        isOn: key => key === 'injectLedgerRecall',
        vectorEnabled: () => true,
        retrievalParams: () => ({ ...params }),
        vectorRecall: () => { const job = {}; job.promise = new Promise(resolve => { job.resolve = resolve; }); jobs.push(job); return job.promise; },
    });
    injector.prefetchVectors();
    assert.equal(jobs.length, 1, '前提：真发出了一次准备');
    jobs[0].resolve([{ id: 'a', tick: 1, text: '旧参数取回的商队旧事' }]);
    await turn();
    injector.prefetchVectors();
    assert.equal(jobs.length, 1, '参数没动 ⇒ 同一份结果照旧复用（不许每轮白跑一趟）');
    params.retrievalDepth = 5;              // 取数那几格变了：这份结果的指纹必须跟着变
    injector.prefetchVectors();
    assert.equal(jobs.length, 2, '★参数一改 ⇒ 旧结果作废、重取一次');
    jobs[1].resolve([{ id: 'b', tick: 2, text: '新参数取回的商队旧事' }]);
    await turn();
    injector.apply();
    assert.ok(String(writes.at(-1)).includes('新参数取回的商队旧事'), '注入的是重取回来的那一份');
});

// ★★★leg193（用户令「**字额度切忌把事件截掉**」）：这一组咬三件事——
//   ① 额度是**真的旋钮**（改设置当场改装进去的条数）；② 注入的那一段**真的落在额度里**
//      （量的尺子与"真注入的那几行"同一把——不是 JSON、不是条数）；
//   ③ **整条进、整条不进**：装不下的往事一个字都不许露头（露头就是被切了半条），
//      而额度小到一条都装不下时，也要**整条**给一条（否则"填小了"＝把这一段整个关掉）。
// ★夹具要点（实测过再写进来的）：`按真名取` 只认**账上真有的名字**（≥2 字）⇒ 编年行与查询串里
//   都要出现同一个真名（这里用「商队」），否则两路**一条都取不到**，判据会红在前提上。
// ★读数（实测，写死在下面几条断言里）：一条往事印出来约 45 字（"  · 那句话" ＋ 它上面那行
//   "【第 N 轮 · …】"），首尾那两行说明约 92 字 ⇒ 三条全装 = 237 字。
test('★leg193 字数额度：改设置当场改额度；装不下就从队尾整条摘（绝不截半条）', async () => {
    const writes = [];
    const chat = [{ is_user: false, mes: '上一轮：商队进了山。' }, { is_user: true, mes: '继续' }];
    const texts = ['商队进了山', '商队在山口扎营', '商队派人回渡口报信'];
    const makeWorld = () => ({
        meta: { tick: 3 },
        chronicle: texts.map((text, i) => ({ tick: i + 1, text, kind: 'state' })),
        entities: [{ name: '商队' }], events: [], agendas: [], milestones: [],
    });
    const params = { retrievalDepth: 2, retrievalMaxChars: 200 };
    const ctx = {
        chatId: 'chat-b', chat,
        eventTypes: { MESSAGE_SENT: 'sent' },
        eventSource: { on: () => {} },
        setExtensionPrompt: (key, value) => { if (key === INJECT_KEY_LEDGER) writes.push(value); },
    };
    const injector = createInjector({
        getCtx: () => ctx, getWorld: makeWorld,
        isOn: key => key === 'injectLedgerRecall',
        vectorEnabled: () => true,                    // 通道开着，但**没有** vectorRecall ⇒ 只走关键词路
        retrievalParams: () => ({ ...params }),
    });
    const facts = () => injector._facts();
    injector.apply();
    const one = facts();
    assert.equal(one.recall.cap, 200, '★额度用的是设置里填的那个数（旧法是写死的 1600）');
    assert.ok(one.recall.bytes <= 200, `★注入的往事必须落在额度里（实测 ${one.recall.bytes} 字 ≤ 200）`);
    assert.ok(one.recall.overflow >= 1, '★装不下的往事要**数得出来**（不许静默丢）');
    assert.ok(one.recall.items >= 1, '★额度 200 ⇒ 至少装得下一条');
    assert.ok(one.recall.items < texts.length, '★额度 200 装不下三条（否则这一格等于没生效）');
    // 整条进、不截半条：没装进去的那几条，正文一个字都不许露头
    const last = String(writes.at(-1));
    const inside = texts.filter((t) => last.includes(t));
    assert.equal(inside.length, one.recall.items, `★装进去的条数要与读数对得上（正文里数到 ${inside.length}，读数说 ${one.recall.items}）`);
    for (const t of texts) {
        if (inside.includes(t)) continue;
        assert.ok(!last.includes(t), `★装不下的往事**整条不进**，不许切半条：${t}`);
    }
    assert.ok(!last.includes('商队在山口扎营') || inside.includes('商队在山口扎营'), '★被摘掉的那一条不许留半句');
    // 放宽额度 ⇒ 三条全装得下（这一格真是旋钮，不是"填了不生效"）
    params.retrievalMaxChars = 600;
    injector.apply();
    const more = facts();
    assert.equal(more.recall.cap, 600, '★改设置 ⇒ 下一次就是新额度');
    assert.equal(more.recall.items, texts.length, `★额度 600 ⇒ 三条全装下（实测 ${more.recall.items} 条）`);
    assert.equal(more.recall.overflow, 0, '额度 600 ⇒ 不该再有被挡下的');
    assert.ok(more.recall.bytes <= 600 && more.recall.bytes > 200, `★装得更多了，且仍在额度里（实测 ${more.recall.bytes} 字）`);
});

test('★leg193 额度下限：一条都装不下时，也要**整条**给一条（不是半条）', async () => {
    const writes = [];
    const chat = [{ is_user: false, mes: '上一轮：商队进了山。' }, { is_user: true, mes: '继续' }];
    const world = {
        meta: { tick: 2 },
        chronicle: [{ tick: 1, text: '商队进了山', kind: 'state' }, { tick: 2, text: '商队在山口扎营', kind: 'state' }],
        entities: [{ name: '商队' }], events: [], agendas: [], milestones: [],
    };
    const ctx = {
        chatId: 'chat-c', chat, eventTypes: { MESSAGE_SENT: 'sent' },
        eventSource: { on: () => {} },
        setExtensionPrompt: (key, value) => { if (key === INJECT_KEY_LEDGER) writes.push(value); },
    };
    const injector = createInjector({
        getCtx: () => ctx, getWorld: () => world,
        isOn: key => key === 'injectLedgerRecall', vectorEnabled: () => false,
        retrievalParams: () => ({ retrievalDepth: 2, retrievalMaxChars: 1 }),   // 额度 1 字：一条都装不下
    });
    injector.apply();
    const f = injector._facts();
    assert.equal(f.recall.items, 1, '★额度小到装不下时，也要给一条（否则"填小了"＝把这一段整个关掉）');
    assert.ok(f.recall.bytes > f.recall.cap, '前提：这一条确实超了额度（读数会如实报出来）');
    const last = String(writes.at(-1));
    assert.ok(last.includes('商队进了山'), '★给的是**完整的那一条**（不是被切掉一半的）');
});

test('★leg193 检索上下文深度：按名字找与按意思找**共用同一串**（两路一个深度）', async () => {
    const hooks = new Map(), jobs = [];
    // ★造三条正文：深度 2 ⇒ 查询串只该含最后两条 ⇒ 这就是"两路共用同一串"能看见的凭据。
    const chat = [
        { is_user: false, mes: '甲在渡口点了一遍货' },
        { is_user: false, mes: '乙把商队带进山口' },
        { is_user: false, mes: '丙在山口等信号' },
        { is_user: true, mes: '继续' },
    ];
    const world = {
        meta: { tick: 3 },
        chronicle: [{ tick: 1, text: '甲在渡口点了一遍货', kind: 'state' }],
        entities: [], events: [], agendas: [], milestones: [],
    };
    const ctx = {
        chatId: 'chat-d', chat, eventTypes: { MESSAGE_SENT: 'sent' },
        eventSource: { on: (event, fn) => hooks.set(event, fn) },
        setExtensionPrompt: () => {},
    };
    const injector = createInjector({
        getCtx: () => ctx, getWorld: () => world,
        isOn: key => key === 'injectLedgerRecall', vectorEnabled: () => true,
        retrievalParams: () => ({ retrievalDepth: 2 }),
        // ★这一路就是"按意思找"：它拿到的查询串，必须与"按名字找"那一路**同源同深度**
        vectorRecall: () => {
            const job = {};
            job.promise = new Promise(resolve => { job.resolve = resolve; });
            jobs.push(job); return job.promise;
        },
    });
    injector.prefetchVectors();
    jobs[0]?.resolve([{ id: 'v1', tick: 2, text: '按意思找回来的旧事' }]);
    await turn();
    injector.apply();
    assert.ok(jobs.length >= 1, '前提：向量那一路真被问了一次');
    const f = injector._facts();
    // ★"共用同一串"的可核那一半：**深度决定的那几条正文**在这一轮的读数里对得上
    //   （查询串本身不落读数——它不注入、不进模型，所以这里咬的是"两路都按这一格问"）
    assert.equal(f.recall.literal + f.recall.vector >= 1, true, '前提：两路至少有一路取回了东西');
    assert.equal(f.recall.cap, RETRIEVAL_PARAMS.maxChars, '前提：额度回出厂（这一条只咬深度）');
    // ★另一半是**同一个函数**：注入器两处拼查询串走的是同一个 `sw2RecallQueryText`（源码只有一份实现）。
    const src = fs.readFileSync(new URL('../web/inject.js', import.meta.url), 'utf8');
    const calls = (src.match(/sw2RecallQueryText\(/g) || []).length;
    assert.ok(calls >= 3, `★两路拼查询串必须是同一个函数（定义 ＋ 至少两处调用，实测 ${calls} 处）`);
    assert.ok(!/function sw2RecallQueryText[\s\S]{0,600}?function sw2RecallQueryText/.test(src), '★不许有第二份实现');
});

test('出厂缺省：没有任何设置时，各格回到 limits.js 的出厂值', () => {
    assert.deepEqual(liveRetrievalParams(null), RETRIEVAL_PARAMS, '没有设置 ⇒ 逐格等于出厂值');
    const partial = liveRetrievalParams({ retrievalTop: 9 });
    assert.equal(partial.top, 9, '填过的那格用填的');
    assert.equal(partial.minScore, RETRIEVAL_PARAMS.minScore, '没填的那格回出厂');
    assert.equal(partial.depth, RETRIEVAL_PARAMS.depth, '没填的那格回出厂');
    assert.equal(partial.literalShare, RETRIEVAL_PARAMS.literalShare, '份额不开放给玩家，照旧');
    assert.equal(partial.maxChars, LEDGER_CHARS_DEFAULT, '★字数额度没填过 ⇒ 回出厂（1600）');
    assert.equal(liveRetrievalParams({ retrievalMaxChars: 2400 }).maxChars, 2400, '★填过就用填的');
    assert.equal(liveRetrievalParams({ retrievalMaxChars: 0 }).maxChars, LEDGER_CHARS_DEFAULT, '★0 字额度没法给药 ⇒ 回出厂，不猜');
    assert.equal(liveRetrievalParams({ retrievalMaxChars: 'abc' }).maxChars, LEDGER_CHARS_DEFAULT, '非数字 ⇒ 回出厂');
    assert.equal(RETRIEVAL_PARAMS.maxChars, LEDGER_CHARS_DEFAULT, '★出厂值只有一个真源（`src/limits.js`）');
    assert.equal(liveRetrievalParams({ retrievalTop: 'abc' }).top, RETRIEVAL_PARAMS.top, '非数字 ⇒ 回出厂，不猜');
    assert.equal(liveRetrievalParams({ retrievalDepth: 0 }).depth, RETRIEVAL_PARAMS.depth, '0 条正文没法问 ⇒ 回出厂');
});

// ★★★（2026-10-05 用户令，两句连着下）：「名字恢复到原样，然后在旁边添加一个小问号说明作用即可」＋
//   （leg193）「**让说明靠近一点，隔得太远了**」——锁三件事：
//   ① **五个名字一个字都不许再改**（它们已经改错过一次，玩家认得的名字要稳定）；
//   ② 小问号带着"作用在哪"的说明，且**必须是 `.sw2-field` 的直接子元素**（塞进 `<label>` 里不合规范，
//      点它还会把焦点带进数字框——这条判据就是防下一任图省事挪进去）；
//   ③ **ˋ说明ˊ与标签同在一格**（`label` 与 `input` 包在同一个 `.sw2-field-head` 里）——
//      旧形状里"说明"被挤到第三行、隔着一百多像素（用户截图当场指出来的那一处）。
test('五格名字保持原样，说明紧跟标签、在标签外面', () => {
    const card = cardOf();
    for (const name of ['一轮最多递多少条行动', '相似度阈值', '最大召回条数', '检索上下文深度', '往事注入多少字']) {
        assert.ok(card.includes(name), `★名字保持原样：${name}`);
    }
    assert.ok(!/<label[^>]*>\s*[^<]*轮最多递多少条行动[\s\S]{0,60}?sw2-fold/.test(card),
        '★问号不许塞进 `<label>` 里面（块级 details 放进 label 不合规范，点它会把焦点带进数字框）');
    // ★leg193：每一格都是"一格头部（标签＋框）＋ 紧跟其下的说明"。
    //   ★判据不去解析 HTML 的嵌套（正则解析嵌套必错，实测第一版就栽在 `</div>` 里也含
    //     `<div class="sw2-field` 这串字上）⇒ 改用**每格自己的控件 id** 当锚，逐格看次序：
    //     一格之内 `.sw2-field-head` 先出现、`.sw2-fold-inline`（说明）后出现。
    const anchors = ['sw2_tag_max', 'sw2_ret_min', 'sw2_ret_top', 'sw2_ret_depth', 'sw2_ret_chars'];
    const segs = anchors.map((id, i) => {
        const at = card.indexOf(`id="${id}"`);
        assert.ok(at > 0, `前置：取得到第 ${i + 1} 格的控件（${id}）`);
        const from = card.lastIndexOf('<div class="sw2-field"', at);
        const inlineFrom = card.lastIndexOf('<div class="sw2-field sw2-field-inline"', at);
        const start = Math.max(from, inlineFrom);
        const next = card.indexOf('<div class="sw2-field', at);
        return card.slice(start, next >= 0 ? next : card.length);
    });
    segs.forEach((seg, i) => {
        const head = seg.indexOf('sw2-field-head');
        const hint = seg.indexOf('sw2-fold-inline');
        assert.ok(head >= 0, `★第 ${i + 1} 格（${anchors[i]}）：标签与框必须包在同一格（\`.sw2-field-head\`）里——否则说明会被挤到下一行`);
        assert.ok(hint > head, `★第 ${i + 1} 格（${anchors[i]}）：说明要落在那一格**之后**（标签与框的下方），不是里面`);
    });
    // 说明要把"作用在哪／什么时候不生效"写出来，不能只说"这是啥"
    const hints = [...card.matchAll(/<div class="sw2-hint[^\"]*"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => m[1]).join('\n');
    assert.ok(hints.includes('递给世界模型的行动条数') && hints.includes('它不进对话'), '第一格要说清是递给世界模型、不是注入');
    assert.ok((hints.match(/向量通道/g) || []).length >= 3, '后三格要说清"向量通道没开时哪几格不生效"');
    assert.ok(hints.includes('按名字找和按意思找共用这一个深度'), '★深度那一格要说清**两条路共用**（用户 2026-10-05 定的口径）');
    assert.ok(hints.includes('装不下的往事整条不进'), '★字数额度那一格要说清"整条不进、不切半条"（用户原话「字额度切忌把事件截掉」）');
});

// ★★★（2026-10-05 用户令）：「**这四枚开关各往对话里塞什么**那枚问号好像已经过时了可以删了」
//   ＋「把图片的第一段话中的关键信息抽取出来展示在参数页，**第二段话可以删了，这是用来调试的**」。
test('过时的那段总说明撤了、排查那一行也撤了；读数行改印"哪一段多少字"', () => {
    const card = cardOf();
    assert.ok(!card.includes('这四枚开关各往对话里塞什么'), '★过时的总说明整段撤掉（它写的"塞两段"早就不准）');
    assert.ok(!card.includes('注入跑过'), '★"注入跑过 N 次"那一行撤掉（用户："这是用来调试的"）');
    assert.ok(!card.includes('把这条发我'), '★"若一直这样，把这条发我"那句撤掉');
    // 旧的整句读数仍在（leg92 那条"跑过没有必须可见"的口径没撤，只是**不再画**那一行排查话术）
    assert.ok(card.includes('data-settings="retrievalMaxChars"'), '★第五格（字数额度）必须画出来，且走 `data-settings` 这条写通道');
    assert.ok(!card.includes('另有其尺'), '★旧说明里那句"另有其尺"要换成指向真控件（第五格）的说法');
});

test('★leg193 自动对齐：向量通道开着才印"向量＋关键词"，没开只印"关键词"', () => {
    const facts = {
        status: 'ok', count: 3, tagsBytes: 1200, rosterBytes: 0, roster: true, tideBytes: 0,
        ledgerOn: true, divergenceBytes: 87, recalledBytes: 120,
        recall: { literal: 4, vector: 6, keptLiteral: 3, keptVector: 2, overflow: 1, cap: 1600, vectorNote: '6 条', items: 5, bytes: 120 },
        totalBytes: 1407,
    };
    const on = injectReadoutHtml({ facts, vectorOn: true, rosterOn: true });
    assert.ok(on.includes('格式指令＋名号表') && on.includes('1200 字'), '★图里那一行"格式指令 N 字"必须还在（用户要的关键信息）');
    assert.ok(on.includes('世界动向') && on.includes('未开'), '★世界动向那一段照实印"未开"');
    assert.ok(on.includes('账上往事') && on.includes('跟书不一样'), '★往事那一段与"跟书不一样"分开印（后者不依赖检索）');
    assert.ok(on.includes('向量＋关键词'), '★通道开着 ⇒ 如实印"向量＋关键词"');
    assert.ok(on.includes('关键词路取回 4 条') && on.includes('向量路取回 6 条'), '★两路各取回几条要看得出（"向量到底进没进去"的唯一可见处）');
    assert.ok(on.includes('额度装不下 1 条'), '★被额度挡下的条数要如实报出来');
    assert.ok(on.includes('position=') === false, '★那句"作为系统提示词排在提示词末尾 · position=0"是排查话术，不再画到面板上');
    const off = injectReadoutHtml({ facts, vectorOn: false, rosterOn: true });
    assert.ok(off.includes('关键词') && !off.includes('向量＋关键词'), '★通道没开 ⇒ 只走关键词路');
    assert.equal(vectorPathLine(facts.recall, false), '往事：只走关键词路（向量通道没开）', '一句话口径住同一个函数');
});

test('★leg193 没跑过/全关/写失败：读数行各有各的话，不许留空也不许编数', () => {
    const unused = injectReadoutHtml({ facts: null });
    assert.ok(unused.includes('不动你的对话'), '没跑过 ⇒ 说"插件现在不动你的对话"，不留空');
    assert.ok(unused.includes('还没注入过') && unused.includes('注入'), '★没跑过那句要留在这一行里（原读数行撤了，别把"没跑过"也丢掉）');
    const off = injectReadoutHtml({ facts: { status: 'off', count: 2, tagsBytes: 0, tideBytes: 0, divergenceBytes: 0, recalledBytes: 0, ledgerOn: false, totalBytes: 0 } });
    assert.ok(off.includes('不动你的对话'), '★四枚开关全关 ⇒ 同一句话（"关了即恢复原样"）');
    const fail = injectReadoutHtml({ facts: { status: 'fail', count: 1, tagsBytes: 0, tideBytes: 0, divergenceBytes: 0, recalledBytes: 0, ledgerOn: true, totalBytes: 0 } });
    assert.ok(fail.includes('写入失败'), '★写失败 ≠ 没跑过 ≠ 全关（三态分得开，这是 leg92 那条老账）');
});

// ★★★（2026-10-05 用户第二道令，两句）：「**第二段话可以删了，这是用来调试的**」＋
//   「**把那句我让你抽出重点的话也删了，毕竟已经抽出来了**」
//   ⇒ 那一卡底下**不许再印原始读数句**：① `标签注入：…（作为系统提示词…position=0；插件只注入这几段…）`；
//     ② `注入跑过 N 次 · 最后一次 …` ／ `注入器还没跑过（…把这条发我）`。
//   ★这条判据**两头都咬**：① 渲染层**给什么都不再印**（拿旧配置喂它，输出里也不许出现那句话）；
//     ② 接线层不许再存那份副本、也不许再 import 拼那句话的函数（否则就是"删了画、留着料"）。
test('★leg194 那句原始读数整行撤了（给旧配置也不许再印出来）', () => {
    const world = JSON.parse(fs.readFileSync(new URL('./fixtures/chronicle-page-real-world.json', import.meta.url), 'utf8'));
    const legacy = '标签注入：格式指令 1349 字 · 世界动向 326 字 · 账上往事 87 字（作为系统提示词排在提示词末尾 · position=0；插件只注入这几段，不读也不改你的正文）';
    // ① 渲染层：把旧配置照原样喂进去（连同 `injectRuns` 那份排查行），一个字都不许印
    const html = renderParamsHtml(world, { config: { injectLine: legacy, injectRuns: '注入跑过 3 次 · 最后一次 注入 1895 字' } });
    const card = runtimePanel(html);
    assert.ok(!card.includes('标签注入：'), '★那句原始读数不许再印（它的关键信息已经抽成上面那一行小格）');
    assert.ok(!card.includes('position='), '★排查尾巴（position=0）不许再印到面板上');
    assert.ok(!card.includes('作为系统提示词'), '★同上');
    assert.ok(!card.includes('注入跑过'), '★"注入跑过 N 次"那一行也不许回来');
    assert.ok(!card.includes('把这条发我'), '★"若一直这样，把这条发我"那句更不许回来');
    // ② 接线层：那份副本与那句印法的 import 都必须没了（不许"删了画、留着料"）
    const index = fs.readFileSync(new URL('../web/index.js', import.meta.url), 'utf8');
    assert.ok(!/sw2LastInjectLine/.test(index.replace(/\/\/.*$/gm, '')), '★`sw2LastInjectLine` 那份副本要一起删（本判据先剥掉注释再咬）');
    assert.ok(!/tagReadoutLine/.test(index.replace(/\/\/.*$/gm, '')), '★`tagReadoutLine` 的 import 也要一起删（它在本文件已无消费者）');
    assert.ok(!/injectLine\s*:/.test(index.replace(/\/\/.*$/gm, '')), '★`injectLine` 那一格也不许再喂给渲染层');
});
