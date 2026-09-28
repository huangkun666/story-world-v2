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

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 一份**形状照真账**的最小世界：`chronicle[].id = ch_<轮次>_fate_<实体id>`（`settle.js:932-937` 的原样）。 */
function makeWorld() {
    return {
        entities: [
            { id: 'e_bk_104', kind: 'character', name: '白小娥', location: '江州', status: 'retired' },
            { id: 'e_41_1', kind: 'character', name: '万子明', location: '江州', status: 'dead' },
            { id: 'e_bk_1', kind: 'character', name: '黄坤', location: '江州', status: 'active' },
        ],
        chronicle: [{ id: 'ch_45_fate_e_41_1', tick: 45, text: '「万子明」覆灭（走火入魔）', kind: 'major' }],
        events: [],
        meta: {
            tick: 61,
            entityFields: {
                e_bk_1: {
                    fields: {
                        实力: {
                            value: '元婴初期', prev: { value: '筑基', source: '书里原话' },
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
    assert.ok(t.includes('第 45 轮'), '★轮次要取得到——来源是**编年行的号** `ch_45_fate_e_41_1`，'
        + '不是 `entityFields`（`applyEntityFates` 不写它，真账 3 个人都没记因）');
});

// ══════════════════════════════════════════════════════════════════════════════
test('D3 · 变更格三样齐全：谁 + 哪一格 · 现值 · 原值 · 轮次', () => {
    const t = ledgerDivergenceText(makeWorld());
    assert.ok(t.includes('黄坤的〈实力〉'), '★要说清"谁的哪一格"');
    assert.ok(t.includes('账上是「元婴初期」'), '★现值');
    assert.ok(t.includes('书里原样是「筑基」'), '★原值（这正是"模型只看得到书里那个值"的解药）');
    assert.ok(t.includes('第 60 轮'), '★轮次');
});

// ══════════════════════════════════════════════════════════════════════════════
test('D4 · 原值缺了 ⇒ 只说现值（红线 2：空着就是空着，不许编"书里是空的"）', () => {
    const w = makeWorld();
    w.meta.entityFields.e_bk_1.fields.实力 = { value: '金丹', tick: 9, source: '变更' };   // ★没有 prev
    const t = ledgerDivergenceText(w);
    assert.ok(t.includes('账上是「金丹」'), '现值照说');
    assert.ok(!t.includes('书里原样是'), '★★不许出现"书里原样是「」"这种**编出来的空值**（红线 §2.2 第 2 条）');
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
    assert.ok(last.includes('万子明'), `★★检索空手而归，但"跟书不一样"那一段**照旧在**——这就是甲案的关键：${last}`);
    assert.ok(last.includes('已死'), '★而且要咬住"已死"这两个字');
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
    assert.ok(!last.includes('跟书不一样'), `★没分歧 ⇒ 那一段一个字都不出现：${last}`);
});

// ══════════════════════════════════════════════════════════════════════════════
test('D9 · `web/index.js` 一行没加（余量 1 行，硬锁 <3100）', () => {
    const lines = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8').split('\n').length;
    assert.ok(lines < 3100, `★接线层行数 ${lines} —— 本笔**不许**往那里加行（本机制全落在 web/inject.js）`);
});
