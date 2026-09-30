// story-world-v2/test/ledger-divergence.test.js
// ★★★leg121（细案 `docs/spec-chat-ledger-conflict.md` §7）：**"账上跟书不一样的地方"那一段**的判据。
//
// ＝＝ 为什么每一条都值得立（本笔实测换来的，不是凑数）＝＝
//   · 这个病是**真的**：真账最后一轮重掷 ⇒ 模型把账上唯一已死的人写成了**行动主语**
//     （「万子明｜献上｜秘库钥匙」），而生产解析器认得出、收得下（细案 §1.6.1）；
//   · 这个治法是**有效的**：加上这一段 ⇒ 它当场把人**写死了**；把这一段**写反** ⇒ 它**又写活了**（§1.6.3）；
//   · ★★而本笔**连着栽了三次"判据量错了对象"**（§1.6.4）⇒ 所以下面每一条都写清**它咬的是什么**：
//     `actorId` 写成 `who`（假阴性）· 字面 `\n` 没还原（解析恒 0）·
//     机械判据只数"这个人是不是行动主语"（D/E 两组读数一模一样，而原文**完全相反**）。
//     ⇒ **D11 就是为第三条立的**：不许只数"名字出没出现"，要**咬住"写成死还是写成活"**。
//
// ★本文件**零模型调用**（判据不许烧额度）；真模型那两轮在 `demo/measure-leg121-divergence-live.js`。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ledgerDivergenceText, DIVERGENCE_DEFAULT, createInjector, INJECT_KEY_LEDGER,
} from '../web/inject.js';
// ★★★leg146：**判据要拿真结算喂**（D14）——夹具形状一旦与生产分叉，判据再绿也是绿在夹具上
//   （本笔修的正是这个：生产写裸字符串 `prev`，夹具写 `{value}`，一丢五棒）。
import { settleTick } from '../src/settle.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 一份**形状照真账**的最小世界：`chronicle[].id = ch_<轮次>_fate_<实体id>`（`settle.js:932-937` 的原样）。 */
function makeWorld() {
    return {
        entities: [
            { id: 'e_bk_104', kind: 'character', name: '白小娥', location: '江州', status: 'retired' },
            { id: 'e_41_1', kind: 'character', name: '万子明', location: '江州', status: 'dead' },
            // ★★★leg146：`fieldSource` 是**发票**（`abstract.js:3221` 播种/`entity-lookup.js:472` 查书写它）
            //   ⇒ 有了它才敢说"书里原样是…"（见下面 D16）。
            { id: 'e_bk_1', kind: 'character', name: '黄坤', location: '江州', status: 'active', fieldSource: { 实力: '书里原话' } },
        ],
        chronicle: [
            // ★★★leg146b：编年行上的**时间印记**（`timeMark`＝那时是什么时候；`elapsed`＝此后又过了多久）。
            //   两个来源与生产同源：`settle.js:273-279/835-839`（事件的 `at`，leg137）与
            //   `tick.js` 的 `stampChronicleTime`（当轮【时长】，leg115）⇒ 这里挑两轮各盖一格来测。
            { id: 'ch_45_fate_e_41_1', tick: 45, text: '「万子明」覆灭（走火入魔）', kind: 'major', timeMark: '复苏历三年 三月初七' },
            { id: 'ch_60_chg_e_bk_1', tick: 60, text: '「黄坤」实力变了', kind: 'state', timeMark: '复苏历三年 四月十五' },
        ],
        events: [],
        meta: {
            tick: 61,
            entityFields: {
                e_bk_1: {
                    fields: {
                        // ★★★leg146：**这一格原来写的是 `prev: { value: '筑基', source: '书里原话' }`**——
                        //   而生产**任何一条路都不写这个形状**（`settle.js:1009/1071` 与 `:1191/1197` 都是
                        //   `prev = ent[field]`，**裸字符串**；判据 `entity-writeback.test.js:74` 就是这么断言的）
                        //   ⇒ 夹具绿、生产丢原值，一丢就是五棒（细案 §1.6.4 那条教训的原样复发：
                        //   **"判据通过了，不等于它量的是那件事"**）。下面 D14 会用**真结算**把形状钉死。
                        实力: {
                            value: '元婴初期', prev: '筑基', prior: null,
                            cause: 'ev_60_1', tick: 60, source: '变更',
                        },
                    },
                },
            },
        },
    };
}

// ══════════════════════════════════════════════════════════════════════════════
test('D1 · 没分歧 ⇒ 一个字都不注入（零扰动）', () => {
    const clean = { entities: [{ id: 'e_a', kind: 'character', name: '甲', location: '某地' }], chronicle: [], meta: { tick: 1 } };
    assert.equal(ledgerDivergenceText(clean), '', '★没有 dead、没有变更 ⇒ 空串（不是"空一段标题"）');
    assert.equal(ledgerDivergenceText({}), '', '空账 ⇒ 空串');
    assert.equal(ledgerDivergenceText(null), '', 'null ⇒ 空串（★不许抛：它每轮都要跑）');
    assert.equal(ledgerDivergenceText(undefined), '', 'undefined ⇒ 空串');
});

// ══════════════════════════════════════════════════════════════════════════════
test('D2/D11 · ★死了的人必须在，而且判据要咬住"已死"这两个字（不许只数名字）', () => {
    const t = ledgerDivergenceText(makeWorld());
    assert.ok(t.includes('万子明'), '名字要在（这是本机制治的第一个病）');
    assert.ok(t.includes('已死'), '★★D11：本笔实测的教训——判据停在"名字出现"就是空绿：'
        + 'D/E 两组读数一模一样（都是 2 次），而原文完全相反（"暴毙" vs "投诚献宝"）');
    // ★★★leg146b：**轮次换成时间**（用户令）——轮次只用来在账上找那一行，**不进注入**
    assert.ok(t.includes('复苏历三年 三月初七'),
        `★时间点要在（来源＝那一轮编年行的 \`timeMark\`，不是"第 N 轮"）：${t}`);
    assert.ok(!/第 \d+ 轮/.test(t), `★★引擎轮次**一个字都不许进注入**（用户令"把轮换成时间"）：${t}`);
});

// ══════════════════════════════════════════════════════════════════════════════
test('D3 · 一次属性变更写全：谁 + 哪一格 · 改之前 → 改之后 · 时间', () => {
    const t = ledgerDivergenceText(makeWorld());
    assert.ok(t.includes('黄坤的〈实力〉'), '★要说清"谁的哪一格"');
    assert.ok(t.includes('筑基 → 元婴初期'), `★★leg146b：**只写属性变更**（改之前 → 改之后），一个字不提书：${t}`);
    assert.ok(t.includes('复苏历三年 四月十五'), '★时间是那一轮的 `timeMark`（正文【此刻】的原话，逐字照抄）');
    assert.ok(!t.includes('书里') && !t.includes('原样'),
        `★★用户令：「别写书里原样了」——"书里/原样"这几个字一个都不许出现：${t}`);
});

// ══════════════════════════════════════════════════════════════════════════════
// ★★★leg146 ＋ leg146b：这一族锁两笔令——①「在世界侧被修改过的实体，就一定要把它现在在世界侧的样子
//   告诉模型」②「**把轮换成时间，别写书里原样了，就写属性变更即可**」。
//   **病**：改之前那个值在真机上从来没印出来过（读数写 `prev.value`，生产写裸字符串）。
test('D14 · ★★生产同源：**真跑一次结算**，把它落下的账喂进这一段——变更两栏都要在', () => {
    const w = {
        version: 1,
        context: { world: '临渊城', positions: ['临渊城'] },
        entities: [{ id: 'e_a', kind: 'character', name: '甲', location: '临渊城', 实力: '筑基', fieldSource: { 实力: '书里原话' } }],
        weights: { e_a: 0.4 },
        agendas: [],
        events: [{ id: 'ev_1', title: '血战', source: { type: 'state' }, position: '临渊城', ripples: [], closed: false }],
        chronicle: [],
        meta: { tick: 0 },
    };
    const r = settleTick({
        ssot: w,
        step: {
            actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
            entityUpdates: [{ entity: 'e_a', field: '实力', value: '金丹', cause: { type: 'event', ref: 'ev_1' } }],
        },
    });
    assert.equal(r.ok, true, '前置自证：这一步结算必须真过（否则下面全是空绿）');
    const rec = r.ssot.meta.entityFields.e_a.fields.实力;
    // ★**前置自证（本条的脊梁）**：把"生产写什么形状"当场钉住——它就是**裸字符串**。
    //   这一条红了 ⇒ 说明生产换了形状 ⇒ 下面那条断言的前提没了，必须回来重看读数。
    assert.equal(typeof rec.prev, 'string', '★生产落下的 `prev` 是**裸字符串**（`settle.js:1009/1071`）');
    assert.equal(rec.prev, '筑基');
    const t = ledgerDivergenceText(r.ssot);
    assert.ok(t.includes('筑基 → 金丹'),
        `★★正题：**真结算落下的账**喂进来，变更的两栏（改之前 → 改之后）都要印得出来：${t}`);
    // ★这一份账的编年行**没有**时间印记（真结算只写 `at`/`elapsed`，这里两样都没有）⇒ 照"空着就是空着"
    assert.ok(!/第 \d+ 轮/.test(t), `★★账上没记时间 ⇒ 什么都不写，**不许退回"第 N 轮"**：${t}`);
});

test('D15 · 三种 `prev` 形状都读得出来，且 **`prior` 优先**（照 `web/entity-window.js:145` 的既有读法）', () => {
    // ① 老/旁路形状：`{ value }`（不是生产写的，但旧账/别处可能有 ⇒ 不许读不出来）
    const a = makeWorld();
    a.meta.entityFields.e_bk_1.fields.实力.prev = { value: '筑基' };
    assert.ok(ledgerDivergenceText(a).includes('筑基 → 元婴初期'), '`{value}` 形状照读');
    // ② 链式留痕：`prior` 在 ⇒ **以它为准**（它才是"上一版"）
    const b = makeWorld();
    b.meta.entityFields.e_bk_1.fields.实力.prev = '练气';
    b.meta.entityFields.e_bk_1.fields.实力.prior = { value: '筑基', source: '书里原话' };
    const tb = ledgerDivergenceText(b);
    assert.ok(tb.includes('筑基 → 元婴初期'), `prior 优先：${tb}`);
    assert.ok(!tb.includes('练气'), '★`prior` 在时不许把 `prev` 也抖出来（一段话里两个"改之前"就是自相矛盾）');
});

test('D16 · ★★写出处那套话整条不许回来（用户令「**别写书里原样了**」）', () => {
    // 不管上一版来自哪里（书里原话 / 账上的变更），注入里都**只写"改之前 → 改之后"**、一个字不提出处
    const a = makeWorld();
    a.meta.entityFields.e_bk_1.fields.实力.prior = { value: '金丹', source: '变更' };
    const ta = ledgerDivergenceText(a);
    assert.ok(ta.includes('金丹 → 元婴初期'), `链式变更照写：${ta}`);
    assert.ok(!ta.includes('书里') && !ta.includes('原样') && !ta.includes('据书'), `★★"书里/原样/据书"一个字都不许出现：${ta}`);
    // 没有 `prior`、也没有发票（`fieldSource` 缺）⇒ 同样是"改之前 → 改之后"，不许改口成别的说法
    const b = makeWorld();
    delete b.entities.find((e) => e.id === 'e_bk_1').fieldSource;
    const tb = ledgerDivergenceText(b);
    assert.ok(tb.includes('筑基 → 元婴初期'), `证不出处也照写变更：${tb}`);
    assert.ok(!tb.includes('书里') && !tb.includes('原样'), '★凭发票说话那套逻辑已按用户令整条撤掉');
});

// ══════════════════════════════════════════════════════════════════════════════
// ★★★leg146b（用户令：「**把轮换成时间**」）：时间读的是账上那把**既有**的尺子
//   （`timeMarkAt`，`ledger-recall.js:203`）——三种情形各有各的说法，**缺了就不许编**。
test('D18 · ★时间印记三情形：时间点 / 相对量 / 账上没记（不许退回"第 N 轮"）', () => {
    // ① 有时间点（`timeMark`，正文【此刻】原话）⇒ 直接摆时间点
    const a = makeWorld();
    assert.ok(ledgerDivergenceText(a).includes('（复苏历三年 三月初七）'), '时间点照摆（逐字照抄，不做算术）');
    // ② 只有相对量（`elapsed`，正文【时长】原话）⇒ 照账上那句说，不换算成日期
    const b = makeWorld();
    b.chronicle = b.chronicle.map((r) => (r.tick === 60 ? { ...r, timeMark: undefined, elapsed: '三天' } : r));
    const tb = ledgerDivergenceText(b);
    assert.ok(tb.includes('（那一轮此后又过了：三天）'), `相对量照摆、不换算：${tb}`);
    // ③ 两样都没有（旧账 / 那一轮没写）⇒ **什么都不写**（空着就是空着）
    const c = makeWorld();
    c.chronicle = [];
    const tc = ledgerDivergenceText(c);
    assert.ok(tc.includes('黄坤的〈实力〉：筑基 → 元婴初期'), `变更照写：${tc}`);
    assert.ok(!/第 \d+ 轮/.test(tc) && !tc.includes('（）'), `★★账上没记时间 ⇒ 不写括号、也不许退回轮次：${tc}`);
    // ④ ★**卷里的时间**也算数（轮转之后，那一行搬进卷了——`timeMarkAt` 两处都看）
    const d = makeWorld();
    d.chronicle = [];
    const td = ledgerDivergenceText(d, { volumes: [{ fromTick: 60, rows: [{ tick: 60, timeMark: '复苏历三年 四月十五' }] }] });
    assert.ok(td.includes('复苏历三年 四月十五'), `★卷里的时间印记要取得回来（编排层已把卷递进来）：${td}`);
});

// ══════════════════════════════════════════════════════════════════════════════
test('D4 · 改之前那个值缺了 ⇒ 只写现值（红线 2：空着就是空着，不许编一个空值）', () => {
    const w = makeWorld();
    w.meta.entityFields.e_bk_1.fields.实力 = { value: '金丹', tick: 9, source: '变更' };   // ★没有 prev
    const t = ledgerDivergenceText(w);
    assert.ok(t.includes('黄坤的〈实力〉：金丹'), `只写现值（没有箭头、没有空括号）：${t}`);
    assert.ok(!t.includes('金丹 →'), '★★不许出现"→ 空"或"空 →"这种编出来的原值（红线 §2.2 第 2 条）');
});

// ══════════════════════════════════════════════════════════════════════════════
// ★★★leg146：**引擎的簿记栏不许进对话**。改 `status` 的路只有"带因复活"一条
//   （`check-step.js:355-359`），所以它要么是①段那句"已死"，要么是这里这句人话——**绝不许**印出
//   `status` / `active` / `dead` 这类内部枚举值（`STATE.md` §2.5 人话红线）。
test('D17 · ★`status` 不进属性行：复活说人话「已重回场上」，枚举值一个字不许漏', () => {
    // ① 复活：账上 status 回到 active，留痕里是 `{value:'active', prev:'dead', source:'变更'}`
    const w = makeWorld();
    w.entities.push({ id: 'e_rev', kind: 'character', name: '回头客', location: '江州', status: 'active' });
    w.meta.entityFields.e_rev = {
        fields: { status: { value: 'active', prev: 'dead', cause: 'ev_70_1', tick: 70, source: '变更', prior: null } },
    };
    w.chronicle.push({ id: 'ch_70_rev_e_rev', tick: 70, text: '「回头客」带着因由重回场上', kind: 'major', timeMark: '复苏历三年 五月初一' });
    const t = ledgerDivergenceText(w);
    assert.ok(t.includes('回头客：已重回场上（复苏历三年 五月初一）'),
        `★说人话（照 settle.js:1048 账上自己那句「带着因由重回场上」）＋ 带上时间：${t}`);
    assert.ok(!t.includes('status'), '★★键名 `status` 不许出现在注入里');
    assert.ok(!/\bactive\b/.test(t) && !/\bdead\b/.test(t), '★★内部枚举值不许出现在注入里');
    // ② 反向对照：**当前仍是 dead 的**（先复活、后又覆灭）⇒ **不许**再报"重回场上"（与①段「已死」自相矛盾）
    const w2 = makeWorld();
    w2.entities.push({ id: 'e_rev2', kind: 'character', name: '二回头', location: '江州', status: 'dead' });
    w2.meta.entityFields.e_rev2 = {
        fields: { status: { value: 'active', prev: 'dead', cause: 'ev_70_1', tick: 70, source: '变更', prior: null } },
    };
    const t2 = ledgerDivergenceText(w2);
    assert.ok(t2.includes('二回头：已死'), `★现在仍是 dead ⇒ 只报"已死"：${t2}`);
    assert.ok(!t2.includes('重回场上'), '★★先复活后又覆灭 ⇒ 不许两条并存（自相矛盾的话比不说更坏）');
});

// ══════════════════════════════════════════════════════════════════════════════
test('D12 · ★`retired` 不说（用户 2026-09-23 拍板）——防将来有人顺手加回去', () => {
    const t = ledgerDivergenceText(makeWorld());
    assert.ok(!t.includes('白小娥'), '★`retired` 的人**不许**出现在这一段里：那是**引擎的记账分类**'
        + '（`settle.js:1138`），而且新事件点名时会**自动复归**（`:1101-1106`）⇒ 说成世界事实会误导');
    assert.ok(!t.includes('已离场'), '★"已离场"这个说法整个不许出现');
});

// ══════════════════════════════════════════════════════════════════════════════
test('D5 · ★截断必须说出来（不许静默——leg112 那条静默闸的血证）', () => {
    const w = makeWorld();
    for (let i = 0; i < 40; i += 1) {
        w.entities.push({ id: `e_x${i}`, kind: 'character', name: `某人${i}`, location: '江州', status: 'dead' });
    }
    const cut = ledgerDivergenceText(w, { maxChars: 200 });
    assert.ok(cut.includes('没放进来'), `★切了就要说：${cut.slice(-160)}`);
    assert.ok(cut.includes('另有'), '★要说清"另有几条"');
    // ★反向前置：预算给足时**一个字都不许提截断**（否则上面那条可能是"总会印"的空绿）
    const full = ledgerDivergenceText(w, { maxChars: 100000 });
    assert.ok(!full.includes('没放进来'), '★预算够时不许提截断（前置自证）');
    assert.ok(full.includes('某人39'), '★而且要给全');
});

// ══════════════════════════════════════════════════════════════════════════════
test('★纯函数：不改账上一个字节（本机制只读账、不写账、更不改书）', () => {
    const w = makeWorld();
    const before = JSON.stringify(w);
    ledgerDivergenceText(w);
    assert.equal(JSON.stringify(w), before, '★账本一个字节都没动');
    assert.ok(Number.isFinite(DIVERGENCE_DEFAULT.maxChars) && DIVERGENCE_DEFAULT.maxChars > 0,
        '★上限是提案态但必须是个正数（不许 Infinity 混进来）');
});

// ══════════════════════════════════════════════════════════════════════════════
// ★★端到端真跑（`STATE.md` §2.3 第 6 条："测试全绿但实机就炸"是本仓常客）：
//   走**真的** `createInjector`，注入 fake ctx，断言第四段里**真出现了**那一段。
//   夹具照 `test/tag-extract.test.js:780-791`（那一份**已证**能让检索命中）。
const fakeCtx = (chat) => ({
    setExtensionPrompt: (k, v) => fakeCtx.written.push([k, v]),
    extension_prompt_types: { IN_PROMPT: 0 },
    chat,
});
const E2E_WORLD = (withDead) => ({
    entities: [
        { id: 'e_xue', kind: 'character', name: '薛铁衣', location: '忘川渡口', status: 'active' },
        { id: 'e_p1', kind: 'character', name: '黄坤', location: '忘川渡口', status: 'active' },
        ...(withDead ? [{ id: 'e_41_1', kind: 'character', name: '万子明', location: '江州', status: 'dead' }] : []),
    ],
    context: { positions: ['未明', '忘川渡口', '孟婆庄'] },
    events: [{ id: 'ev_3_1', title: '炼化死煞核心', source: { type: 'state' }, ripples: [], closed: true }],
    chronicle: [
        { id: 'ch_3_1', tick: 3, text: '盘算「炼化死煞核心」取消：核心二次暴动，炼化彻底失败', elapsed: '三天' },
        ...(withDead ? [{ id: 'ch_45_fate_e_41_1', tick: 45, text: '「万子明」覆灭（走火入魔）', kind: 'major' }] : []),
    ],
    meta: { tick: 61 },
});

test('D6/D10 · ★端到端真跑：**检索没命中时，分歧那一段照旧在**（甲案的关键）', () => {
    fakeCtx.written = [];
    const inj = createInjector({
        // ★chat 是空的 ⇒ `sw2RecallQueryText` 取不到那几个字 ⇒ **往事那半必然空手而归**
        getCtx: () => fakeCtx([]),
        getWorld: () => E2E_WORLD(true),
        isOn: (k) => k === 'injectLedgerRecall',
    });
    const r = inj.apply();
    const row = fakeCtx.written.filter(([k]) => k === INJECT_KEY_LEDGER);
    assert.ok(row.length >= 1, '★第四段必须真写进注入口（写空串也算"撤掉旧的"）');
    const last = row[row.length - 1][1];
    assert.ok(last.includes('万子明'), `★★检索空手而归，但"已经发生的改变"那一段**照旧在**——这就是甲案的关键：${last}`);
    assert.ok(last.includes('已死'), '★而且要咬住"已死"这两个字');
    assert.ok(last.includes('【这一局里已经发生的改变】'), '★段首那句是本笔口径（用户令：不写"跟书不一样"那套对照）');
    assert.ok(r.ledgerChars > 0, '★读数要如实报第四段的字数');
    assert.ok(r.line.includes('账上往事'), `★自证面照旧说这一段：${r.line}`);
});

test('D13 · ★零扰动：没分歧时，那一段一个字都不出现（往事照旧）', () => {
    fakeCtx.written = [];
    const inj = createInjector({
        getCtx: () => fakeCtx([{ is_user: false, mes: '炼化死煞核心' }, { is_user: true, mes: '继续' }]),
        getWorld: () => E2E_WORLD(false),
        isOn: (k) => k === 'injectLedgerRecall',
    });
    const r = inj.apply();
    const last = fakeCtx.written.filter(([k]) => k === INJECT_KEY_LEDGER).pop()[1];
    assert.ok(r.ledgerChars > 0, '★前置自证：这一份夹具的检索**必须命中**（否则下面那条是空绿）');
    assert.ok(last.includes('炼化死煞核心'), '往事照旧在');
    assert.ok(!last.includes('【这一局里已经发生的改变】'), `★没分歧 ⇒ 那一段一个字都不出现：${last}`);
});

// ══════════════════════════════════════════════════════════════════════════════
test('D9 · `web/index.js` 一行没加（余量 1 行，硬锁 <3100）', () => {
    const lines = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8').split('\n').length;
    assert.ok(lines < 3100, `★接线层行数 ${lines} —— 本笔**不许**往那里加行（本机制全落在 web/inject.js）`);
});
