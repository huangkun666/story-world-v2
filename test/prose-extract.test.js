// story-world-v2/test/prose-extract.test.js
// ★★★leg200（2026-10-05 用户令）：**"剥什么"只由玩家的两份名单说了算** ＋ **提取那一趟不再剥**。
//
// 用户 2026-10-05 四道令（逐字）：
//   ①「**正文有时也会包裹在html注释，所以不能这样**」⇒ 撤掉 leg198 那一刀"杀光 HTML 注释"
//     （有的卡就是拿注释当正文的容器，一刀切会把正文本身剥走）；
//   ②「**提取正文时采用白名单和黑名单机制，这俩名单由用户自己设置，白名单过滤程度最重代表
//      只留这个名单，黑名单则代表过滤这个名单**」⇒ 名单机制，两个框住参数页「正文怎么读」；
//   ③（他当场问出来的）「**提取tag的时候为什么要剥？难道正则提取不到tag？**」
//     ⇒ 提取那一趟的剥块**整个摘掉**：`extractTags` 只扫 ` ```tags ` 围栏**里面的行**，
//       围栏外面一个字都不读 ⇒ 剥没有用，只会把住在信封里的标签块一起剥掉。
//   ④（他指出的过度设计）「**不写就不剥得了，你还非搞个这个按钮干嘛**」
//     ⇒ ★**那枚「剥掉正文里的机器块」总闸开关已撤**，且**两个名单都空 ⇒ 一个字都不剥**。
//
// ＝＝ 口径（三条，全文在 `src/prose.js` 头注）＝＝
//   · ★★**两个名单都空** ⇒ **一个字都不剥**（口径②：不写就不剥）；
//   · **黑名单填了** ⇒ **只剥点名的**（成对块写标签名；HTML 注释写它开头那几个字）；
//   · **白名单填了** ⇒ **只留点名的，其余信封全剥**（信封**外面**的正文照留）；两个都填 ⇒ 白名单优先。
//   ★名单**由玩家填，插件一个内置词都没有**（红线 §4.8 禁的是"插件拿**内置**词表替玩家判语义"）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { proseOnly, parseProseList } from '../src/prose.js';
import { runTick } from '../src/tick.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FENCE = '`'.repeat(3);
const fenced = (...lines) => [FENCE + 'tags', ...lines, FENCE].join('\n');

const mkWorld = () => ({
    version: 1,
    context: { world: '测试', positions: ['未明', '临渊城'], playerId: 'e_p1' },
    entities: [
        { id: 'e_a', kind: 'character', name: '甲', location: '临渊城', status: 'active' },
        { id: 'e_p1', kind: 'character', name: '黄坤', location: '临渊城', status: 'active' },
    ],
    weights: { e_a: 0.5, e_p1: 0.5 },
    agendas: [], events: [], milestones: [], chronicle: [],
    meta: { tick: 3, simLog: [], warnings: [], entityFields: {} },
});
const STEP = {
    actions: [], newEvents: [{ title: '甲夺了渡口', source: { type: 'state' }, position: '临渊城', ripples: ['e_a'] }],
    agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
};
const run = (dialogue, extra = {}) => runTick({
    transport: async () => ({ text: JSON.stringify(STEP) }),
    ssot: mkWorld(), dialogue, recall: false, ...extra,
});

// ── ① ★用户令④：两个名单都空 ⇒ **一个字都不剥** ─────────────────────────────────
test('leg200①：★★两个名单都空 ⇒ 一个字都不剥（用户令「不写就不剥得了」）', () => {
    const block = '<status>机器块</status>正文在这里。';
    assert.equal(proseOnly(block), block, '★不填名单 ⇒ 成对块**也不剥**（那枚总闸开关已撤）');
    const comment = '<!--正文-->黄坤走进渡口，甲在那里等他。<!--/正文-->';
    assert.equal(proseOnly(comment), comment, '★注释当然也不剥（leg198 那一刀早撤了）');
    const code = [FENCE + 'tags', '【行动】甲｜离开', FENCE].join('\n');
    assert.equal(proseOnly(code), code, '★三反引号块从来不剥（那正是检索要用的料）');
    assert.equal(proseOnly(''), '', '空输入 ⇒ 空输出');
});

// ── ② 黑名单：**只剥点名的**（＋ 那条"剥空退回原文"的老边界照旧在）──────────────────
test('leg200②：黑名单 ＝ 只剥点名的（成对块写标签名；HTML 注释写开头那几个字）', () => {
    const text = '<角色手机>状态栏</角色手机><!--抢话自查: 甲的反应--><status>别的块</status>正文在这里。';
    const got = proseOnly(text, { black: '角色手机\n抢话自查' });
    assert.ok(!got.includes('状态栏'), '★点名的成对块剥掉');
    assert.ok(!got.includes('抢话自查'), '★点名的注释剥掉（按**开头那几个字**认）');
    assert.ok(got.includes('<status>别的块</status>'), '★没点名的成对块**一律不碰**（黑名单＝只剥点名的）');
    assert.ok(got.includes('正文在这里。'), '★正文一个字都不许少');
    // 老边界（leg198 立的，不许撤）：剥完是空的 ⇒ **退回原文**（不会比不剥更坏）
    assert.equal(proseOnly('<status>整条都包住了</status>', { black: 'status' }),
        '<status>整条都包住了</status>', '★剥空 ⇒ 退回原文');
});

// ── ③ 白名单：**只留点名的，其余信封全剥**（过滤最重那一档）──────────────────────────
test('leg200③：白名单 ＝ 只留点名的信封，其余信封全剥；信封**外面**的正文照留', () => {
    const text = '<角色手机>状态栏</角色手机><!--正文-->黄坤走进渡口。<!--/正文--><status>别的块</status>收尾。';
    const got = proseOnly(text, { white: '正文' });
    assert.ok(got.includes('黄坤走进渡口。'), '★点名的信封留下（连同里面的字）');
    assert.ok(!got.includes('状态栏'), '★没点名的成对块剥掉');
    assert.ok(!got.includes('别的块'), '★没点名的成对块剥掉');
    assert.ok(got.includes('收尾。'), '★★信封**外面**的正文照留（白名单不是"只从块里取正文"）');
});

// ── ④ 两个都填 ⇒ 白名单优先（过滤最重那一档说了算）────────────────────────────────
test('leg200④：两个都填 ⇒ **白名单优先**（黑名单不再单独生效）', () => {
    const text = '<甲>一号</甲><乙>二号</乙>';
    assert.equal(proseOnly(text, { black: '甲', white: '乙' }), ' <乙>二号</乙>',
        '★按白名单办：只留 `乙`，`甲` 照剥（黑名单那一条被白名单接管）');
});

// ── ⑤ 名单怎么解析（一行一条；逗号也认；去重保序）──────────────────────────────────
test('leg200⑤：名单文本的解析口径（一行一条 · 逗号也认 · 去空白 · 去重 · 保序）', () => {
    assert.deepEqual(parseProseList('甲\n乙\n甲'), ['甲', '乙'], '一行一条、去重、保序');
    assert.deepEqual(parseProseList('甲, 乙，丙'), ['甲', '乙', '丙'], '半角/全角逗号都认');
    assert.deepEqual(parseProseList('  \n\n '), [], '空白 ⇒ 空表（＝那一档没填）');
    assert.deepEqual(parseProseList(null), [], '没填过 ⇒ 空表');
});

// ── ⑥ ★提取那一趟**不再剥**（用户令③）──────────────────────────────────────────────
test('leg200⑥：★提取不再剥块——标签块住在注释里、外面还有别的围栏，照读得到', async () => {
    // 这一档是旧口径唯一真会出事的地方：标签块住在注释里，而**外面还有一个围栏**
    //   ⇒ 旧代码的"保围栏"边界不触发（剥完还剩那个围栏）⇒ 标签块被静默剥掉。
    //   新口径**根本不剥** ⇒ 没有这一档。
    const dialogue = ['<!--', fenced('【行动】黄坤｜修炼'), '-->', '```json', '{"a":1}', '```'].join('\n');
    const r = await run(dialogue);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.move?.verb, '修炼', '★标签块住在注释里也照读得到（提取不剥 ⇒ 不会被连注释一起剥走）');
});

test('leg200⑥b：正文包在注释里、标签块在外面 ⇒ 照旧读得到（对照组）', async () => {
    const dialogue = ['<!--黄坤走进渡口，甲在那里等他。-->', fenced('【行动】甲｜偷袭')].join('\n');
    const r = await run(dialogue);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.dialogueStats.events, 1, '★正文里那个真块照旧记下一件事');
});

// ── ⑦ 接线与面板：源码锁（名单必须真接在线上；总闸开关必须真的没了）───────────────────
test('leg200⑦：名单接在线上（面板两个框 ＋ 递进查询串 ＋ 提取不再剥 ＋ 总闸开关已撤）', () => {
    const web = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    const render = readFileSync(path.join(ROOT, 'src', 'render.js'), 'utf8');
    const mc = readFileSync(path.join(ROOT, 'web', 'model-channel.js'), 'utf8');
    const inject = readFileSync(path.join(ROOT, 'web', 'inject.js'), 'utf8');
    const tick = readFileSync(path.join(ROOT, 'src', 'tick.js'), 'utf8');
    // ① 面板上真有两个框（玩家得能填）
    assert.match(render, /data-settings-text="proseBlackList"/, '★参数页要有黑名单那个框');
    assert.match(render, /data-settings-text="proseWhiteList"/, '★参数页要有白名单那个框');
    // ② 那两个键真被读、真被写（读＝proseStripLists；写＝onField 的文本分支）
    assert.match(mc, /proseBlackList/, '★名单键要有一处读法（`proseStripLists`）');
    assert.match(mc, /data-settings-text/, '★文本型设置的写通道要在（`data-settings-text` 分支）');
    // ③ 名单真递进了查询串那一路（否则填了也不生效）
    assert.match(web, /sw2RecallQueryText\(ctx, 400, depth, proseStripLists\(/, '★接线层要把名单递给查询串');
    assert.match(inject, /lists \? proseOnly\(raw, lists\) : raw/, '★查询串那一路要按名单剥');
    // ④ ★提取那一趟真的不剥了（用户令③的落点）
    assert.ok(!/proseOnly/.test(tick), '★★提取那一趟不许再 import/调用 `proseOnly`（它只扫围栏里面的行）');
    // ⑤ ★★那枚总闸开关真的撤了（用户令④的落点：不写就不剥，不要多余的按钮）
    assert.ok(!/injSwitch\('stripMachineBlocks'/.test(render), '★★面板上不许再有「剥掉正文里的机器块」那枚开关');
    assert.ok(!/injectSwitchOn\('stripMachineBlocks'/.test(web), '★接线层不许再读那个键');
});
