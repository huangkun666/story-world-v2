// test/ledger-recall.test.js
// ★★★leg115：账本检索层的判据。
// 本文件锁三件事：①**方式不止一种**（三种各真跑；★本笔把生产零调用的四种删了，
//   见 `src/ledger-recall.js` 的 `RECALL_MODES` 头注）②**时间印记**（本笔的靶子）③**三条纪律**
//   （只读零副作用 / 失败零阻塞 / reason 三态可分）。
// ★写法纪律（本仓血证）：**加辅助函数前先 grep 重名**——leg113 §4.4 因为重名 `stripComments`
//   整个测试文件加载即挂（TAP 报的是**文件级** not ok，不是某条用例）。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    recallLedger, RECALL_MODES,
    chronicleKindOf, KIND_LABEL,
    timeMarkAt, groupByTime, formatRecalled,
    buildQuery, keywordsOf, plainTextOf,
    chronicleOf,
} from '../src/ledger-recall.js';
// ★★★leg119：轮转（编年进冷档"卷"）——用**生产那一把**真造一次，不捏假卷。
import { rotateChronicle } from '../src/storage.js';

/** 一份小账：两轮编年（第 1 轮写了时长、第 2 轮没写）+ 两个事件 + 一条盘算 + 一个实体。 */
function mkLedger() {
    return {
        entities: [
            { id: 'e_a', kind: 'character', name: '黄坤', location: '大盘谷' },
            { id: 'e_b', kind: 'faction', name: '万法阁', location: '东海浮空岛' },
        ],
        agendas: [
            {
                id: 'a_1_1', owner: 'e_a', goal: '击碎死煞绝阵', stage: '攻坚',
                visibility: 'known', maxSteps: 3, progress: 1, closed: false,
                memory: { promises: [], done: ['t1: 破了外层阵'], blocked: [], turnsAlive: 1 },
            },
        ],
        events: [
            { id: 'ev_1_1', title: '死煞之阵成型', source: { type: 'state' }, position: '大盘谷', ripples: ['e_b'], closed: false },
            { id: 'ev_2_1', title: '黄坤强闯阵眼', source: { type: 'ripple', ref: 'ev_1_1' }, position: '大盘谷', ripples: ['e_a'], closed: false },
            { id: 'ev_3_1', title: '阵眼崩碎', source: { type: 'ripple', ref: 'ev_2_1' }, position: '大盘谷', ripples: ['e_a'], closed: true },
        ],
        milestones: [
            { id: 'm_10', span: { from: 1, to: 10 }, counts: { events: 2 }, titles: ['旧事甲', '旧事乙'], ids: ['ev_old_1', 'ev_old_2'], links: { up: [], down: [] } },
        ],
        chronicle: [
            { id: 'ch_1_a', tick: 1, text: '事件「死煞之阵成型」——由世界处境而生，事发 大盘谷，牵动 万法阁', kind: 'ripple', eventRef: 'ev_1_1', elapsed: '三天' },
            { id: 'ch_1_b', tick: 1, text: '盘算「击碎死煞绝阵」推进：破了外层阵', kind: 'scheme' },
            { id: 'ch_2_a', tick: 2, text: '事件「黄坤强闯阵眼」——沿「死煞之阵成型」而来，事发 大盘谷，牵动 黄坤', kind: 'ripple', eventRef: 'ev_2_1' },
            { id: 'ch_2_b', tick: 2, text: '盘算「击碎死煞绝阵」取消（黄坤）：阵眼反噬，强攻失败', kind: 'shade' },
            { id: 'ch_2_c', tick: 2, text: '事件「阵眼崩碎」闭环（源盘算已结算）', kind: 'major', chainRef: 'ev_3_1' },
            { id: 'ch_2_d', tick: 2, text: '「万法阁」淡出视野（久未现身）', kind: 'state' },
        ],
        meta: { tick: 2 },
    };
}

// ---------------------------------------------------------------------------
// 一、★方式不止一种（用户原话：「检索的方式也不可能只有一种吧？」）
// ---------------------------------------------------------------------------

test('L1：三种方式都真跑得动，而且取到的东西**不一样**（不是同一套换了名字）', () => {
    const w = mkLedger();
    const out = {};
    // ★★★leg161：**向量那一档不在这一条里**——它要"调用方嵌好的查询向量 ＋ 一个索引"才跑得动
    //   （本层同步、不碰网络：见 `modeByVector` 头注）。它的空手而归由 L1b 单独钉。
    const offline = [RECALL_MODES.RECENT, RECALL_MODES.BY_KEYWORD, RECALL_MODES.BY_NAMES];
    for (const m of offline) {
        const r = recallLedger(w, { modes: [m], limit: 50, text: '黄坤 大盘谷' });
        out[m] = r;
        assert.equal(r.ok, true, `${m} 应当取到东西：${r.reason}`);
    }
    // 每种方式的**条数或内容**至少有一处不同——否则"多种方式"是假的
    const sigs = Object.entries(out).map(([m, r]) => `${m}:${r.items.map((x) => x.id).join(',')}`);
    assert.ok(new Set(sigs).size >= 2, `三种方式应当多数取到不同集合，实测：${sigs.join(' | ')}`);
    // 点名两种的差异（防"实现了但没接线"的假绿）
    assert.ok(out.recent.items.some((x) => x.id === 'ch_2_d'), '最近优先要能取到最后一行');
    // ★"按词"= 字面命中（弱）：夹具里那几行真写着"大盘谷"
    assert.ok(out.keyword.items.some((x) => x.id === 'ch_1_a'), `按词要能取到字面命中的行：${out.keyword.items.map((x) => x.id).join(',')}`);
    // ★"按账上真名"= 相关性正解：锚是**账上真名**（不是字面词元）⇒ 它取回的是**提到这个人的行**，
    //   连"按词"撞不上的那行（那句里只有名字、没有查询里的词）也取得回来；没点名的行一条都不许混进来。
    assert.ok(out.names.items.some((x) => x.id === 'ch_2_b'), `按名取要能取到点了真名的那行：${out.names.items.map((x) => x.id).join(',')}`);
    assert.ok(!out.names.items.some((x) => x.id === 'ch_1_a'), '★没点出真名的行不许混进来（ch_1_a 里没有"黄坤"）');
    // ★口径（本笔删掉四种取法之后仍然成立）：本层**只认账上写着的字**，不猜、不模糊匹配
    assert.equal(recallLedger(w, { modes: [RECALL_MODES.BY_NAMES], text: '账上一个都没有的名字' }).ok, false,
        '★话里没有账上真名 ⇒ 一条都不取（不许凭空造锚）');
});

test('L1b：★★向量那一档——**没递向量 / 没索引 ⇒ 空手而归**（失败零阻塞，不许抛、不许编）', () => {
    const w = mkLedger();
    // ① 什么都没递（＝没配通道 / 还没嵌好）：这一档空手，但**别的档照常**
    const r1 = recallLedger(w, { modes: [RECALL_MODES.BY_VECTOR], text: '黄坤 大盘谷' });
    assert.deepEqual(r1.items, [], '没递向量 ⇒ 一条都不取');
    // ★它**不把整批拖垮**：与字面路并用时，字面路那部分照常取到
    const r2 = recallLedger(w, { modes: [RECALL_MODES.BY_VECTOR, RECALL_MODES.BY_NAMES], text: '黄坤 大盘谷', limit: 50 });
    assert.equal(r2.ok, true, `并用时字面路照常工作：${r2.reason}`);
    assert.ok(r2.items.length > 0, '字面路那部分不许被向量那一档拖空');
    // ② 递了向量但没索引 ⇒ 一样空手（不是拿 0 分冒充）
    const r3 = recallLedger(w, { modes: [RECALL_MODES.BY_VECTOR], qVector: [0.1, 0.2, 0.3] });
    assert.deepEqual(r3.items, [], '没索引 ⇒ 空手');
    // ③ 荒唐输入不抛（这一档的唯一硬纪律：加速层不许影响世界）
    for (const bad of [null, undefined, 0, 'x', {}, []]) {
        const r = recallLedger(w, { modes: [RECALL_MODES.BY_VECTOR], qVector: bad });
        assert.deepEqual(r.items, [], `qVector=${JSON.stringify(bad)} ⇒ 空手，不抛`);
    }
});

test('L2：方式可以并用（并集），并且**同一条往事只留一份**（不是把去重糊过去，是按"这一条是谁"认）', () => {
    const w = mkLedger();
    const r = recallLedger(w, { modes: [RECALL_MODES.BY_NAMES, RECALL_MODES.RECENT], text: '黄坤 大盘谷', limit: 50 });
    assert.equal(r.ok, true, r.reason);
    const ids = r.items.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, `并集不许有重复：${ids.join(',')}`);
    assert.ok(ids.includes('ch_1_a'), '按名取到的那条要在（两条路都取到它 ⇒ 只留一份）');
    assert.ok(ids.includes('ch_2_d'), '最近那条也要在');
});

// ---------------------------------------------------------------------------
// 二、★★时间印记（本笔的靶子：用户原话「聊天llm是不知道什么时候世界发生了什么事懂吗？」）
// ---------------------------------------------------------------------------

test('L3：★时间印记只收集原话、**不做算术**（红线 §2.2 第 1 条同源）', () => {
    const w = mkLedger();
    const at1 = timeMarkAt(w, 1);
    assert.equal(at1.known, true, '第 1 轮写了时长 ⇒ known');
    assert.equal(at1.elapsed, '三天', '★原话照抄');
    assert.ok(!/\d/.test(at1.elapsed), '★不许把"三天"换算成数（累加就会编出账上没有的数）');

    const at2 = timeMarkAt(w, 2);
    assert.equal(at2.known, false, '第 2 轮没写时长 ⇒ known:false');
    assert.equal(at2.elapsed, '', '★空着就是空着（红线 2），不许填占位值');
});

test('L4：★旧账零扰动——账上根本没有时间格时，不编、不炸、读得出"没记"', () => {
    const w = mkLedger();
    for (const r of w.chronicle) delete r.elapsed;           // 模拟旧账（这一格是 leg115 才有的）
    const at = timeMarkAt(w, 1);
    assert.equal(at.known, false);
    assert.equal(at.elapsed, '');
    const out = recallLedger(w, { modes: [RECALL_MODES.RECENT] });
    assert.equal(out.ok, true, '旧账照样检索得动');
    const text = formatRecalled(w, out.items);
    assert.ok(text.includes('这一轮的"过了多久"账上没记'), `★要如实说没记，不许沉默：${text}`);
});

test('L5：★给聊天模型的那段话必须**带时间**、且**说人话**（不出现引擎行话）', () => {
    const w = mkLedger();
    const out = recallLedger(w, { modes: [RECALL_MODES.RECENT], limit: 50 });
    const text = formatRecalled(w, out.items);
    assert.ok(text.includes('第 1 轮'), '要有轮次');
    assert.ok(text.includes('此后又过了：三天'), `★要带上"过了多久"的原话：${text}`);
    assert.ok(text.includes('此后又过了') || text.includes('没记'), '每一组都要交代时间');
    for (const jargon of ['tick', 'eventRef', 'chainRef', 'ssot', 'agenda']) {
        assert.ok(!text.includes(jargon), `★给模型的话里不许出现引擎行话「${jargon}」：${text}`);
    }
});

test('L6：按轮次分组——每轮挂自己那一轮的时间印记（★不许把后面的时长算到前面的轮头上）', () => {
    const w = mkLedger();
    const out = recallLedger(w, { modes: [RECALL_MODES.RECENT], limit: 50 });
    const groups = groupByTime(w, out.items);
    assert.deepEqual(groups.map((g) => g.tick), [1, 2], '按轮次升序分组');
    assert.equal(groups[0].time.elapsed, '三天', '第 1 轮挂第 1 轮的');
    assert.equal(groups[1].time.known, false, '第 2 轮没写 ⇒ 不许拿第 1 轮的三天冒充');
});

// ---------------------------------------------------------------------------
// 三、三条纪律（逐条照抄 `recall.js` 的既有口径）
// ---------------------------------------------------------------------------

test('L7：纪律①**只读、零副作用**——检索前后账本逐字节相同', () => {
    const w = mkLedger();
    const before = JSON.stringify(w);
    recallLedger(w, { modes: Object.values(RECALL_MODES), text: '黄坤', limit: 50 });
    formatRecalled(w, recallLedger(w, { modes: [RECALL_MODES.RECENT] }).items);
    assert.equal(JSON.stringify(w), before, '★检索不许改账一个字节');
});

test('L8：纪律②**失败零阻塞**——账没递进来/方式不认识/账空白，一律返回空批次且**永不抛**', () => {
    assert.equal(recallLedger(null).ok, false);
    assert.equal(recallLedger(undefined).ok, false);
    assert.deepEqual(recallLedger(null).items, []);
    const bad = recallLedger(mkLedger(), { modes: ['不存在的路'] });
    assert.equal(bad.ok, false);
    assert.deepEqual(bad.items, [], '不认识的方式 ⇒ 空批次，不炸');
});

test('L9：纪律③**reason 三态可分**——"没命中"与"根本没在检索"必须分得开', () => {
    // 甲：压根没跑
    const notRun = recallLedger(mkLedger(), { modes: ['不存在的路'] });
    assert.ok(notRun.reason.startsWith('没在检索'), `甲类要说"没在检索"：${notRun.reason}`);
    const noLedger = recallLedger(null);
    assert.ok(noLedger.reason.startsWith('没在检索'), `甲类要说"没在检索"：${noLedger.reason}`);
    // 乙：跑了但没命中
    const noHit = recallLedger(mkLedger(), { modes: [RECALL_MODES.BY_KEYWORD], text: '这个词账上根本没有' });
    assert.equal(noHit.ok, false);
    assert.ok(noHit.reason.startsWith('没命中'), `乙类要说"没命中"：${noHit.reason}`);
    // 丙：取到了
    const hit = recallLedger(mkLedger(), { modes: [RECALL_MODES.RECENT] });
    assert.equal(hit.ok, true);
    assert.equal(hit.reason, '', '取到了就不该有理由');
});

// ---------------------------------------------------------------------------
// 四、收口细节（都是"以后会炸"的地方，逐条锁住）
// ---------------------------------------------------------------------------

test('L10：★预算只按字符切，**默认不设条数上限**（本仓血证：`entityUpdates ≤3` 那个静默闸）', () => {
    const w = mkLedger();
    const r = recallLedger(w, { modes: [RECALL_MODES.RECENT], maxChars: 100000 });
    assert.equal(r.items.length, w.chronicle.length, '装得下就一条不许丢（默认没有条数闸）');
    const tiny = recallLedger(w, { modes: [RECALL_MODES.RECENT], maxChars: 10 });
    assert.ok(tiny.items.length >= 1, '★放不下第一条也要给一条（否则等于静默空手）');
});

test('L12：编年四种话认得准，认不出的**照收不删**（宁缺勿造的对偶）', () => {
    assert.equal(chronicleKindOf({ text: '盘算「X」推进：做了事' }), 'step');
    assert.equal(chronicleKindOf({ text: '事件「X」——沿「Y」而来' }), 'cause');
    assert.equal(chronicleKindOf({ text: '事件「X」这一段收场了：讲完了' }), 'outcome');
    assert.equal(chronicleKindOf({ text: '事件「X」闭环（源盘算已结算）' }), 'ledger');
    assert.equal(chronicleKindOf({ text: '谁也认不出的一句话' }), 'other');
    // ★"认不出"≠"删掉"：KIND_LABEL 要给得出人话，且 retrieval 仍收它
    assert.ok(KIND_LABEL.other, '认不出的也要有人话标签');
    const w = mkLedger();
    w.chronicle.push({ id: 'ch_x', tick: 2, text: '谁也认不出的一句话' });
    const r = recallLedger(w, { modes: [RECALL_MODES.RECENT], limit: 50 });
    assert.ok(r.items.some((x) => x.id === 'ch_x'), '★认不出的行不许被丢掉');
});

test('L13：查询怎么拼——**只用账上真有的字**（零编造），且词元不引分词器/不作词表判语义', () => {
    const w = mkLedger();
    const q = buildQuery(w, { picks: ['e_a'] });
    assert.ok(q.includes('黄坤'), '镜头选中的人名要在');
    assert.ok(q.includes('死煞之阵成型'), '未决事件标题要在');
    assert.ok(!q.includes('阵眼崩碎'), '已收场的事件不该进查询（它不是"正在发生什么"）');
    const toks = keywordsOf('黄坤 强闯 阵眼 大盘谷');
    assert.ok(toks.includes('黄坤') && toks.includes('大盘谷'));
    assert.ok(!toks.includes(' '), '空白不算词元');
});

test('L14：取一条往事的"那句话"有确定口径（编年取 text / 事件取标题 / 盘算取目标）', () => {
    assert.equal(plainTextOf({ text: '甲' }), '甲');
    assert.equal(plainTextOf({ title: '乙' }), '乙');
    assert.equal(plainTextOf({ goal: '丙' }), '丙');
    assert.equal(plainTextOf({}), '');
    assert.equal(plainTextOf(null), '');
});

test('L15：同一份账上，**两个消费者要的东西确实不一样**（世界模型要料、聊天模型要时间+经过）', () => {
    const w = mkLedger();
    // 世界模型那侧：机械记账行**不该混进往事**（否则又把账本腔灌给模型）——那是 chronicle-brief 的取舍
    // 聊天模型那侧：最想知道的是"这一步干了什么、为什么收场"——本层要能单独把它们取出来
    const all = recallLedger(w, { modes: [RECALL_MODES.RECENT], maxChars: 100000 }).items;
    const steps = all.filter((x) => chronicleKindOf(x) === 'step');
    assert.ok(steps.length >= 1, '要能单独取到"经过话"');
    const outcome = all.filter((x) => chronicleKindOf(x) === 'outcome');
    assert.ok(outcome.length >= 1, '要能单独取到"收场话"');
    assert.equal(chronicleKindOf({ text: '事件「X」闭环（源盘算已结算）' }), 'ledger', '机械记账要认得出来（消费者自己决定收不收）');
});

// ---------------------------------------------------------------------------
// 五、★这一格原来的两条端到端判据（L16/L17）**已随记忆桥删除**（leg125 · 用户令「直接删了」）：
//   它们锁的是"**投给柚月の记忆的那一行**里必须带'此后又过了多久'"——那条通道整条没了，判据随之作废。
//   ★本笔的靶子（时间印记**真走到消费者眼里**）**没失守**，仍在两处锁着：
//     · 注入那一段：`test/tag-extract.test.js` 锁"此后又过了：三天 跟着往事一起进注入"；
//     · 面板阅卷：`test/render.test.js` 锁"阅卷里每一行往事都带'此后又过了'"。
//   ★上游（谁把时长盖上编年行）也照旧锁着：下面 L18/L19 一个字没动。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 六、★★写端真跑：`tick.js` 到底会不会把时长盖到新落的编年行上
//    （不真跑一轮 tick 就证明不了那一格有人写——leg89 就是"读端写了、写端全仓零处写"的死开关）
// ---------------------------------------------------------------------------

test('L18：★★真跑一轮 tick——正文里写了「【时长】三天」，账上就要留下"过了三天"', async () => {
    const { runTick } = await import('../src/tick.js');
    const mkW = () => ({
        version: 1,
        context: { world: '测试', positions: ['未明', '临渊城'], playerId: null },
        entities: [{ id: 'e_a', kind: 'character', name: '甲', location: '临渊城', status: 'active' }],
        weights: { e_a: 0.5 },
        agendas: [], events: [], milestones: [], chronicle: [],
        meta: { tick: 3, simLog: [], warnings: [], entityFields: {} },
    });
    const STEP = {
        actions: [],
        newEvents: [{ title: '甲夺了渡口', source: { type: 'state' }, position: '临渊城', ripples: ['e_a'] }],
        agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    // 对话正文：照 `tagSpecText` 的硬要求带一个 tags 块（时长 + 一条行动）
    const dialogue = [
        '甲一路疾行，三日方至渡口。',
        '```tags',
        '【时长】三天',
        '【行动】甲｜夺下｜渡口',
        '```',
    ].join('\n');

    const r = await runTick({ transport: async () => ({ text: JSON.stringify(STEP) }), ssot: mkW(), dialogue, extractCtx: {}, recall: false });
    assert.equal(r.ok, true, r.error);
    const rows = r.ssot.chronicle || [];
    assert.ok(rows.length >= 1, '这一轮要真落下编年行（否则这条判据是空跑）');
    const stamped = rows.filter((x) => x.elapsed === '三天');
    assert.equal(stamped.length, rows.length, `★本轮新落的每一行都要盖上时长：落 ${rows.length} 行、盖上 ${stamped.length} 行`);
    // ★口径①：原话照抄、不做算术
    assert.ok(!/\d/.test(String(stamped[0].elapsed)), '★不许把"三天"换算成数');
    // ★口径②：不回头改旧行——造一行"上一轮留下的"再跑一轮，看它会不会被覆盖
    const oldRow = { id: 'ch_old', tick: 1, text: '上一轮留下的旧行' };
    const r2 = await runTick({ transport: async () => ({ text: JSON.stringify(STEP) }), ssot: { ...r.ssot, chronicle: [oldRow, ...rows] }, dialogue, extractCtx: {}, recall: false });
    assert.equal(r2.ok, true, r2.error);
    const stillOld = (r2.ssot.chronicle || []).find((x) => x.id === 'ch_old');
    assert.equal(stillOld.elapsed, undefined, '★旧行不许被补盖（旧行没有就是"当时没写"）');
});

test('L19：★正文里**没写**时长 ⇒ 编年行上不许多出那一格（红线 2：空着就是空着）', async () => {
    const { runTick } = await import('../src/tick.js');
    const w = {
        version: 1,
        context: { world: '测试', positions: ['未明', '临渊城'], playerId: null },
        entities: [{ id: 'e_a', kind: 'character', name: '甲', location: '临渊城', status: 'active' }],
        weights: { e_a: 0.5 },
        agendas: [], events: [], milestones: [], chronicle: [],
        meta: { tick: 3, simLog: [], warnings: [], entityFields: {} },
    };
    const STEP = {
        actions: [],
        newEvents: [{ title: '甲夺了渡口', source: { type: 'state' }, position: '临渊城', ripples: ['e_a'] }],
        agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const dialogue = ['甲一路疾行。', '```tags', '【行动】甲｜夺下｜渡口', '```'].join('\n');
    const r = await runTick({ transport: async () => ({ text: JSON.stringify(STEP) }), ssot: w, dialogue, extractCtx: {}, recall: false });
    assert.equal(r.ok, true, r.error);
    const rows = r.ssot.chronicle || [];
    assert.ok(rows.length >= 1, '要真落行');
    assert.ok(rows.every((x) => !('elapsed' in x)), `★没写时长 ⇒ 那一格整个不出现（不是空串、不是占位值）：${JSON.stringify(rows.map((x) => x.elapsed))}`);
});

// ---------------------------------------------------------------------------
// 七、★★`BY_NAMES`：**相关性**的正解（真账实测定的，见下）
//   真账实测（`大荒z` tick 61）：玩家正文与账本**用词不同** ⇒ 字面关键词撞不上（实测命中 **0 条**）；
//   而**账上真名**是账本自带的那把钥匙（落账时 id 就渲染成了名字）⇒ 照名取命中 133–224 行。
// ---------------------------------------------------------------------------

test('L20：★★字面关键词撞不上时，**账上真名**能撞上（这就是"相关性"的来路）', () => {
    const w = mkLedger();
    // 一段"用词与账本完全不同"的话（模拟玩家的文风正文）
    const prose = '雷缠刀脊三千转，斩落人间十万峰——我提刀杀入阵中';
    const byWord = recallLedger(w, { modes: [RECALL_MODES.BY_KEYWORD], text: prose });
    assert.equal(byWord.ok, false, '★字面关键词在这段话上取不到（这正是真账里的实测情形）');
    // 同一段话里点了账上真名 ⇒ 就取得到
    const withName = '薛铁衣的缚灵锁阵当场崩碎，黄坤杀回大盘谷';
    const byName = recallLedger(w, { modes: [RECALL_MODES.BY_NAMES], text: withName });
    assert.equal(byName.ok, true, `★照账上真名要取得到：${byName.reason}`);
    assert.ok(byName.items.some((x) => String(x.text).includes('黄坤') || String(x.text).includes('万法阁')),
        `取到的要是关于这些人的往事：${byName.items.map((x) => x.text).join(' | ')}`);
});

test('L21：★`BY_NAMES` 的金口径（只用账上真有的字 / 长短名先认长的 / 空话不取）', () => {
    const w = mkLedger();
    // ① 只用账上真有的字：话里没有账上真名 ⇒ 一条都不取（不许模糊匹配、不许猜）
    assert.equal(recallLedger(w, { modes: [RECALL_MODES.BY_NAMES], text: '一个账上完全没有的名字' }).ok, false);
    // ② 空文本 ⇒ 不取（空查询 ≠ 检索了个寂寞）
    assert.equal(recallLedger(w, { modes: [RECALL_MODES.BY_NAMES], text: '' }).ok, false);
    assert.equal(recallLedger(w, { modes: [RECALL_MODES.BY_NAMES] }).ok, false);
    // ③ 盘算的**目标原话**也算锚（真账实测：编年里提到一件事有相当一部分只写目标名、不写人名）
    const byGoal = recallLedger(w, { modes: [RECALL_MODES.BY_NAMES], text: '他还在想着「击碎死煞绝阵」这件事' });
    assert.equal(byGoal.ok, true, `★按盘算目标原话也要取得到：${byGoal.reason}`);
    assert.ok(byGoal.items.some((x) => String(x.text).includes('击碎死煞绝阵')), '取到的要真是那条盘算的话');
    // ④ 名字全部来自账上（把实体表清空 ⇒ 同一个文本再也取不到）——证明"只用账上真有的字"
    const noEnt = { ...w, entities: [], agendas: [] };
    assert.equal(recallLedger(noEnt, { modes: [RECALL_MODES.BY_NAMES], text: '薛铁衣 黄坤 大盘谷' }).ok, false,
        '★账上没有那些名字 ⇒ 就取不到（不许凭空造锚）');
});

test('L22：★`BY_NAMES` 与字面关键词**并用**时取并集、不重复（第四段就是这么调的）', () => {
    const w = mkLedger();
    const text = '黄坤 在 大盘谷';
    const both = recallLedger(w, { modes: [RECALL_MODES.BY_NAMES, RECALL_MODES.BY_KEYWORD], text, maxChars: 100000 });
    assert.equal(both.ok, true, both.reason);
    const ids = both.items.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, `并集不许重复：${ids.join(',')}`);
    assert.ok(ids.includes('ch_1_a'), '照名取到的那条要在');
});

// ---------------------------------------------------------------------------
// 八、★★"取回来之后"两处补课（2026-09-23 用户拍板：旋钮与顺序一起做）
//   ① **顺序**：命中之后按"轮次新的在前"排——因为**排序决定谁占得到字符预算**
//      （第一版没排：实测按名取留下的是**最老的** 64 行，而按词取留下的是**最新的** 63 行，两条路打架）
//   ② **旋钮**：撤掉"取哪些源"、给 `limit` 一个真含义（至多取几条），并让"轮次新的在前"这条口径可被验收
// ---------------------------------------------------------------------------

/** 造 200 行账（每行都点得到"黄坤"）——真账里"照名取命中 133–224 行"就是这个规模。 */
function mkMany() {
    const chronicle = [];
    for (let t = 1; t <= 100; t += 1) {
        chronicle.push({ id: `ch_${t}_a`, tick: t, text: `第 ${t} 轮的事：黄坤 在大盘谷与人对阵，风波未平`, elapsed: `${t}日` });
        chronicle.push({ id: `ch_${t}_b`, tick: t, text: `第 ${t} 轮的经过：盘算「击碎死煞绝阵」推进——破了一层阵` });
    }
    return {
        entities: [{ id: 'e_a', kind: 'character', name: '黄坤', location: '大盘谷' }],
        agendas: [{ id: 'a_1', owner: 'e_a', goal: '击碎死煞绝阵' }],
        events: [], milestones: [], chronicle, meta: { tick: 100, simLog: [] },
    };
}

test('L23：★★命中很多行、字符预算有限时，进上下文的是**最近**的往事，不是最老的', () => {
    const w = mkMany();
    const all = recallLedger(w, { modes: [RECALL_MODES.BY_NAMES], text: '黄坤 在大盘谷', maxChars: 1e9 });
    assert.equal(all.items.length, 100, `100 行都点得到这个名字：${all.items.length}`);
    // ★排序口径：轮次新的在前（这就是"预算先给谁"的次序）
    const ticks = all.items.map((x) => x.tick);
    assert.deepEqual(ticks, [...ticks].sort((a, b) => b - a), `★要按轮次新的在前：${ticks.slice(0, 8).join(',')}…`);

    // ★★真预算（第四段出厂值 1600 字）下，留下的一定是**最新那一端**
    const cut = recallLedger(w, { modes: [RECALL_MODES.BY_NAMES], text: '黄坤 在大盘谷', maxChars: 1600 });
    const kept = cut.items.map((x) => x.tick);
    assert.ok(cut.items.length >= 2 && cut.items.length < 100, `预算要真的切掉一部分（否则这条判据是空跑）：留下 ${cut.items.length} 行`);
    assert.equal(Math.max(...kept), 100, `★最新的那一轮必须在（这就是"记住最近发生了什么"）：最高轮次 ${Math.max(...kept)}`);
    assert.ok(Math.min(...kept) > 20, `★★留下的必须是最新那一端，不是最老那一端：最低轮次 ${Math.min(...kept)}（修之前是 1）`);

    // ★两条路**同一口径**（修之前一个记着陈年旧账、一个记着刚发生的事）
    const kw = recallLedger(w, { modes: [RECALL_MODES.BY_KEYWORD], text: '黄坤 大盘谷', maxChars: 1600 });
    assert.equal(Math.max(...kw.items.map((x) => x.tick)), Math.max(...kept), '两种方式的最优先级要一致');
});

test('L24：`limit` 是个**真闸**（限掉的一定是最老的），且它排在排序之后', () => {
    const w = mkMany();
    const r = recallLedger(w, { modes: [RECALL_MODES.BY_NAMES], text: '黄坤 在大盘谷', maxChars: 1e9, limit: 5 });
    assert.equal(r.items.length, 5, '说了至多 5 条就给 5 条');
    assert.equal(r.total, 5, 'total 是切完之后的条数');
    assert.deepEqual(r.items.map((x) => x.tick), [100, 99, 98, 97, 96], '★限掉的是最老的 ⇒ 留下的是最新的那几条（每轮只有带"黄坤"的那一行会被取到）');
    const unlimited = recallLedger(w, { modes: [RECALL_MODES.BY_NAMES], text: '黄坤 在大盘谷', maxChars: 1e9 });
    assert.equal(unlimited.items.length, 100, '★不传 limit ⇒ 不设条数上限（默认 null）');
    // ★"取哪些源"那个旋钮已撤；本笔之后连"里程碑那道闸"（`includeArchive`）也删了
    //   ⇒ 同一份账、同一组 modes 下，**没有任何旋钮**能改结果集（取数方式本身才是决定者）。
    assert.equal('sources' in recallLedger(w, { modes: [RECALL_MODES.RECENT] }), false, '回执里不再有 source 那个回声（旋钮撤了，回声也撤）');
});

// ---------------------------------------------------------------------------
// 九、★★跨归档（leg117）：**本笔随那四种取法一起删了**（生产路径零调用，见 `src/ledger-recall.js`
//   的 `RECALL_MODES` 头注）。原来这里锁两条：
//     · L25：照因果上溯要能**跨过归档边界**（走到被压进大事纪的旧事件上不停，链顺序不变）；
//     · L26：照指针取也要跨归档（给一个已归档事件的 id，要取回**它自己**，不只是"闭环"那一行）。
//   ★"跨归档"这个能力本身**没丢**，只是不在本层了：`chain.js` 的 `archivedEventMap`
//     （经 `web/index.js` 的 `expandChain` 给玩家看）与 `ref-rules.js` 的 `includeArchived`
//     是同一件事在**生产路径上真在用**的两处实现；`test/chain.test.js` 锁着它。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ★★★leg118 留下的那条纪律（本笔只留它）：**排版不许静默丢料**
//   —— 排版那一步（`groupByTime`）是**按轮次分组**的：轮次解不出来的条目单独摆成最后一组，
//      **照印**并如实说"账上没记它在第几轮"，绝不沉默、也绝不编号（红线"空着就是空着"）。
//   ★原来这一节还有两条（L27：照因果上溯取回的事件条目要带"第几轮"、过排版一条都不许丢；
//     L29：补轮次只补在**返回的副本**上）——它们锁的是 `withRound`，而 `withRound` 只服务那四种
//     被删的取法（生产路径零调用）⇒ 一起删了。★那条血证留档：真账实测"锚 42 个未决事件 ⇒
//     取回 114 条 ⇒ 排版只渲染出 64 行"（**静默丢 50 条**）而回执还说 `ok=true`。
// ---------------------------------------------------------------------------

test('★L28（leg118）：轮次真解不出来时——**照印 + 如实说不知道**，绝不静默丢、也绝不编号', () => {
    // 为什么留着它：它锁的是**排版那一步**（`formatRecalled` / `groupByTime`）对"排不进时间线"的
    //   条目的态度——旧账里编年行读不出轮次时（`storage.js` 那条 `chronTick` 兜底就是为它写的）走的就是这一格。
    const w = mkLedger();
    const text = formatRecalled(w, [
        { id: 'ch_无名', title: '一件来历不明的事' },
        { id: 'ch_1_ok', tick: 1, text: '事件「甲事」——由世界处境而生' },
    ]);
    assert.ok(text.includes('一件来历不明的事'), '★不许静默丢：它必须印出来（"宁可多带一句，不可丢一段往事"）');
    assert.ok(text.includes('没记它在第几轮'), '★要如实说清"不知道是第几轮"，不许装懂');
    assert.ok(text.includes('事件「甲事」'), '有轮次的那条照旧照排');
    // ★不许拿 0 或"现在"冒充（红线 §2.2 第 2 条：空着就是空着）
    assert.ok(!text.includes('第 0 轮'), '★不许给解不出轮次的条目编一个"第 0 轮"');
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★leg119：**卷**（编年轮转进冷档的那一段）要并进时间线
//   （细案 `docs/spec-volumes-into-recall.md`；用户 2026-09-23 令「接」）
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★leg119：一份**轮转过**的账。`full` = 没轮转时的原账 · `hot` = 热账（最旧那段已被剥走）·
 * `volume` = 被剥走的那一段（**含 rows**，是真的 `rotateChronicle` 造出来的，不捏假卷）。
 * ★特征安排（都为"这条判据能不能当场红"服务）：
 *   · 第 1 轮那行含**账上真名**「黄坤」与 `eventRef` —— 它落在**卷里**（读编年那三种取法都要够得着它）；
 *   · 第 2 轮那行有 `elapsed: '三天'` —— **"什么时候"的唯一存本**，同样只在卷里（第二处盲点）。
 */
function mkRotated(total = 20, keepTicks = 5) {
    const rows = [];
    for (let t = 1; t <= total; t += 1) {
        const row = { id: `ch_${t}`, tick: t, text: `盘算「事${t}」推进：第 ${t} 步`, kind: 'scheme' };
        if (t === 1) { row.text = '盘算「事1」推进：黄坤 出手'; row.eventRef = 'ev_1_1'; }
        if (t === 2) row.elapsed = '三天';
        rows.push(row);
    }
    const full = {
        entities: [{ id: 'e_a', kind: 'character', name: '黄坤', location: '大盘谷' }],
        agendas: [], milestones: [],
        events: [{ id: 'ev_1_1', title: '旧事', source: { type: 'state' }, ripples: [], closed: true }],
        chronicle: rows, meta: { tick: total },
    };
    const { hot, volume } = rotateChronicle(full, { limits: { ticks: keepTicks, bytes: 5 * 1024 * 1024 } });
    return { full, hot, volume };
}

test('leg119·L30：★★卷并进时间线——**读编年那三种取法都看得见卷**', () => {
    const { full, hot, volume } = mkRotated();
    assert.ok(volume && volume.rows.length > 0, '前提：这份账真的轮转过（否则下面全是空绿）');
    assert.ok(hot.chronicle.length < full.chronicle.length, '前提：热账确实短了');
    const q = { limit: null, maxChars: null, volumes: [volume] };
    // ★前提自证：不传卷 ⇒ 卷里那些往事**一条都取不到**（这就是病）
    assert.equal(recallLedger(hot, { modes: [RECALL_MODES.RECENT] }).total, hot.chronicle.length);
    // ① 最近优先：一条都不许少
    assert.equal(recallLedger(hot, { modes: [RECALL_MODES.RECENT], ...q }).total, full.chronicle.length);
    // ② 按词（"黄坤"只在卷里那一行出现）
    assert.ok(recallLedger(hot, { modes: [RECALL_MODES.BY_KEYWORD], text: '黄坤', ...q }).items.some((x) => x.id === 'ch_1'));
    // ③ 按账上真名
    assert.ok(recallLedger(hot, { modes: [RECALL_MODES.BY_NAMES], text: '黄坤 出手', ...q }).items.some((x) => x.id === 'ch_1'));
    // ★如实说明：本笔删掉的四种取法里，`按轮次`/`照指针`/`按人取` 读的也是编年 ⇒ 它们当年同样看得见卷，
    //   但那三条路已随"生产路径零调用"一起删了；`照因果上溯` 读的是**事件表**，与卷无关，本条不硬凑它。
    // ★合并视图本身的两条口径
    assert.equal(chronicleOf(hot, null), hot.chronicle, '不传卷 ⇒ 原样返回**同一个引用**（旧调用方零扰动）');
    assert.equal(chronicleOf(hot, []), hot.chronicle, '空数组同理（"没有卷" = 没传）');
    const merged = chronicleOf(hot, [volume]);
    assert.deepEqual(merged.map((r) => r.tick), full.chronicle.map((r) => r.tick), '★合并结果仍是"从最早到现在"（卷在前、热账在后）');
});

test('leg119·L31：★"什么时候"也要能从卷里读出来（本笔查出的**第二处盲点**）', () => {
    // 病：`timeMarkAt` 也是只读 `ssot.chronicle` 的 ⇒ 轮转之后，卷里那些轮次的"此后又过了多久"
    //   同样取不到，而 `groupByTime` 会**如实说"账上没记"**——**账上是记了的，只是搬进卷了**。
    const { hot, volume } = mkRotated();
    assert.equal(timeMarkAt(hot, 2).known, false, '前提：第 2 轮那行在卷里 ⇒ 不传卷读不到');
    const at = timeMarkAt(hot, 2, [volume]);
    assert.equal(at.known, true, '★传了卷就要读得到');
    assert.equal(at.elapsed, '三天');
    // 端到端：排成人话那一步也要带上（`formatRecalled` 走同一格）
    const items = recallLedger(hot, { modes: [RECALL_MODES.RECENT], limit: null, maxChars: null, volumes: [volume] }).items;
    assert.ok(formatRecalled(hot, items, { volumes: [volume] }).includes('三天'), '★排成人话时要带着"此后又过了：三天"');
    assert.ok(!formatRecalled(hot, items).includes('三天'), '★前提自证：不传卷时读不到（它会如实说"账上没记"）');
});

test('leg119·L32：★只读零副作用——卷、卷里的行、那个数组，**一个字节都不改**', () => {
    // 照只读纪律同一条口径（leg118 的 L29 已随那四种取法删掉）：谁改成"就地写"，本层三条纪律的第一条当场破。
    const { hot, volume } = mkRotated();
    const before = JSON.stringify(volume);
    const list = [volume];
    recallLedger(hot, {
        modes: Object.values(RECALL_MODES), text: '黄坤',
        limit: null, maxChars: null, volumes: list,
    });
    formatRecalled(hot, recallLedger(hot, { modes: [RECALL_MODES.RECENT], volumes: list }).items, { volumes: list });
    assert.equal(JSON.stringify(volume), before, '★卷（含 rows）一个字节不改');
    assert.equal(list.length, 1, '★传进来的数组没被 push/splice');
    assert.equal(list[0], volume, '★数组里还是原来那个对象');
});

test('leg119·L33：★卷行没写"过了多久" ⇒ 那一格**整个不出现**（不许填占位值）', () => {
    // 红线 §2.2 第 2 条：空着就是空着。★尤其注意 `volumeToChronicleRows` 那条兜底会把读不出的轮次
    //   补成 `tick: 0`——那是**填占位值**，所以本层**不走那个转换**（见 `chronicleOf` 头注 ②③）。
    const { hot, volume } = mkRotated();
    const row = chronicleOf(hot, [volume]).find((r) => Number(r.tick) === 3);
    assert.ok(row, '前提：第 3 轮那行在合并结果里（它在卷里）');
    assert.ok(!('elapsed' in row), '★没写 ⇒ 那个键整个不出现');
    assert.equal(timeMarkAt(hot, 3, [volume]).known, false, '★读不出来就说读不出来——绝不编一个时长');
});

test('leg119·L34：★旧账与坏卷都要跑得通（泛用性：**账的形态**，不是书的形态）', () => {
    const { hot, volume } = mkRotated();
    const n = hot.chronicle.length + volume.rows.length;
    // ★旧账：从来没轮转过 ⇒ 盘上一条卷都没有（**这正是真账今天的形态**：`nextVolume` = 1）
    assert.equal(recallLedger(hot, { modes: [RECALL_MODES.RECENT], volumes: [] }).total, hot.chronicle.length);
    // ★形状不对的卷：跳过那一个就好——不炸、不编、好卷照收
    for (const bad of [null, undefined, {}, { rows: null }, { rows: 'x' }, [], 0, 'v']) {
        const r = recallLedger(hot, { modes: [RECALL_MODES.RECENT], volumes: [bad, volume] });
        assert.equal(r.ok, true, `坏卷不该让检索炸：${JSON.stringify(bad)}`);
        assert.equal(r.total, n, `坏卷要被跳过、好卷照收：${JSON.stringify(bad)}`);
    }
    // ★卷里有空行：跳过那一行（也不许把别的行拖下水）
    assert.equal(chronicleOf({ chronicle: [] }, [{ rows: [null, { id: 'x', tick: 1, text: '在卷里' }] }]).length, 1);
    // ★读不出"从第几轮开始"的卷：排到最后——`Infinity` 只是**排序用的哨兵**，不写进任何一格
    const noTick = { rows: [{ id: 'y', text: '不知道从第几轮开始' }] };
    const withTick = { fromTick: 1, rows: [{ id: 'z', text: '第 1 轮起' }] };
    assert.deepEqual(chronicleOf({ chronicle: [] }, [noTick, withTick]).map((r) => r.id), ['z', 'y'],
        '★排序只用它、不写进格子；读不出起轮的排最后');
});
