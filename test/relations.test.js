// story-world-v2/test/relations.test.js
// ★★★leg120（A3 关系网，细案 `docs/spec-relationship-network.md`）：**关系网那一笔的判据**（细案 §7 的 R1–R9）。
//
// 这一笔治的病（细案 §1，实测）：账本顶层九张表**没有一张**记"谁跟谁是什么关系"——
//   最像关系的只有 `parent`（单向从属、照书办，且角色与角色之间一条都不连）与 `ripples`（共现，不是关系）。
//   全仓搜 盟友/敌对/血亲/人情债/师徒 ⇒ **零命中**。而它是 leg24 **有意删的**（`abstract.js:607` 删除位），
//   理由"那些产出全属书的副本"——**那条理由只对了一半**：不抄**静态**关系是对的，
//   但**玩出来的关系不是书的副本**（谁在第几轮叛了谁、谁欠了谁：书里没有、账上也没有，无处可查）。
//
// ★★本笔的脊梁 = **必带因**（细案 §2.3）：每条边必须指得出账上真有的那件事件/盘算当来路。
//   同一条规定同时干掉三件事：**抄书**（书里的静态关系指不出账上的事 ⇒ 结构上写不进来）、
//   **填占位**（指不到就不写）、**额度**（产率被世界的因果产量天然卡住）。
//
// ★这一份判据里最要紧的三条（都不是"函数返回值对不对"，而是"会不会悄悄坏掉"）：
//   R3 **旧账零扰动**（不提议 ⇒ 账上一个字节都不动，连 `relations` 键都不许建）、
//   R5 **不许静默**（丢掉一条必须留痕——`entityUpdates ≤3` 当年正是栽在静默截断上）、
//   R8 **不许进公式**（关系不许影响分量/打分：四维浮点就是这么被整体删掉的，别换个名字请回来）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleTick } from '../src/settle.js';
import { checkWorldStep } from '../src/check-step.js';
import { dropInvalidProposals } from '../src/sanitize-step.js';
import { buildEvolutionPack } from '../src/pack.js';
import { renderChronicleHtml } from '../src/render.js';
// ★本笔（死码清理）：原来这里还 import 了 `recallLedger, RECALL_MODES`（给下面那条"检索层"判据用）——
//   那条判据整条删了（`BY_ENTITY` 生产零调用），这两个名字在本文件里再没有用处 ⇒ 一起撤掉。
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

// 三个人 + 一件未决的 state 事件（**永不自动闭环** ⇒ 是个稳定的"因"）+ 一件已了结的事（当反面样本）。
// `playerId` 必须在场：红线 1 那条判据（玩家不可作"持有关系"的一方）要读它。
const W = () => ({
    version: 1,
    context: { world: '边地', tension: 0.5, positions: ['边城'], playerId: 'e_me' },
    entities: [
        { id: 'e_x', kind: 'character', name: '薛铁衣', location: '边城' },
        { id: 'e_m', kind: 'character', name: '明素问', location: '边城' },
        { id: 'e_me', kind: 'character', name: '黄坤', location: '边城' },
    ],
    weights: {},
    agendas: [],
    events: [
        { id: 'ev_s', title: '北门那一刀', source: { type: 'state' }, position: '边城', ripples: [], links: { up: [], down: [] } },
        { id: 'ev_c', title: '早就翻篇的事', source: { type: 'state' }, position: '边城', ripples: [], closed: true, closedAt: 1, links: { up: [], down: [] } },
    ],
    chronicle: [],
    meta: { tick: 0 },
});

const empty = () => ({ actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] });
const step = (extra) => ({ ...empty(), ...extra });
/** 一条合法的关系提议（两端在册、因是那件未决的事）——各用例只覆盖自己要考的那一格。 */
const ru = (extra) => ({ from: 'e_x', to: 'e_m', type: '结下死仇', cause: { type: 'event', ref: 'ev_s' }, ...extra });
const run = (world, s) => {
    const r = settleTick({ ssot: world, step: s });
    assert.equal(r.ok, true, `settle 应通过：${(r.stage?.errors || []).join('; ')}${(r.stage?.warnings || []).join('; ')}`);
    return r.ssot;
};

// ═══════════════ R9：端到端——提议真的落账（这一步同时证明 gate 真接上了） ═══════════════
test('★R9 端到端：一条关系真的落账（发号 rel_<轮次>_<第几条> + 盖 tick + 编年留痕挂因）', () => {
    const world = run(W(), step({ relationUpdates: [ru({ note: '北门那一刀是他挨的' })] }));
    assert.equal(Array.isArray(world.relations), true, 'relations 表落了账');
    assert.equal(world.relations.length, 1);
    const r = world.relations[0];
    // ★发号与盖章**只有引擎能做**（契约层里 relationUpdates 根本没有 id 这一格）
    assert.equal(r.id, 'rel_1_1', '★引擎发号：rel_<轮次>_<第几条>');
    assert.equal(r.tick, 1, '★引擎盖 tick（不是模型写的）');
    assert.equal(r.from, 'e_x');
    assert.equal(r.to, 'e_m');
    assert.equal(r.type, '结下死仇', '★type 是模型的原话，引擎一字不改');
    assert.deepEqual(r.cause, { type: 'event', ref: 'ev_s' }, '★因原样留档（这张表的来路）');
    assert.equal(r.note, '北门那一刀是他挨的');
    // ★痕：编年必须留下这一笔，且**挂在因上**（链视图里追得到"因为那件事"）
    const row = world.chronicle.find((c) => c.text.includes('结下死仇'));
    assert.ok(row, '★编年要留痕（"玩出来的关系"必须看得见）');
    assert.equal(row.chainRef, 'ev_s', '★痕挂在因上 ⇒ 链视图追得到来路');
    assert.equal(row.kind, 'ripple', '编年行类型章照既有五筛（涟漪）');
    // ★落账后世界仍过 SSOT 契约（新表真被契约层认下来了）
    assert.equal(validate(world, ssotSchema).ok, true, validate(world, ssotSchema).errors.join('; '));
});

test('★R9b 端到端：**gate 真接上了**——关系提议穿过门控落账（漏一个键这条通道会整段哑掉）', () => {
    // 为什么这条必须端到端跑：`gate.js` 是**白名单式重建**，漏一个键那条通道**整段哑掉**，
    //   而本仓为此**踩过两次**（`entityUpdates`、`eventClosures`）——病历就写在 `gate.js:127-133`。
    //   ★`settleTick` 内部**真的过门控**（`SETTLE_ORDER` 里那一行），所以"落账了"就是"穿过门控了"。
    //   这里再补一条正面的形状断言：门控返回的 step 里必须有这一组。
    const world = run(W(), step({ relationUpdates: [ru()] }));
    assert.equal(world.relations.length, 1, '★穿过门控后仍然落账 ⇒ gate 的白名单里有它');
});

// ═══════════════ R1/R2：必带因——本机制的脊梁 ═══════════════
test('★R1 必带因：因指不到账上真物 ⇒ 不落账，且如实说出为什么', () => {
    const w = W();
    const bad = checkWorldStep(step({ relationUpdates: [ru({ cause: { type: 'event', ref: 'ev_不存在' } })] }), w);
    assert.equal(bad.ok, false, '★凭空编一个因 ⇒ 拒');
    assert.ok(bad.errors.some((e) => e.includes('relationUpdates[0].cause')), `报错要指到那一格：${bad.errors.join('; ')}`);
    // 缺因整格（契约层 required 也拦一层，这里考的是语义面）
    const noCause = checkWorldStep(step({ relationUpdates: [ru({ cause: undefined })] }), w);
    assert.equal(noCause.ok, false, '★没有因 ⇒ 拒（"无因之变＝随口编的关系"）');
});

test('★R2 不许抄书：因必须挂在**还没了结**的事上 ⇒ 书里的静态关系结构上写不进来', () => {
    const w = W();
    // 拿一件**早就了结**的事当因 ⇒ 拒（"不许拿旧事解释今天的变化"——与字段写回同一条口径）
    const stale = checkWorldStep(step({ relationUpdates: [ru({ cause: { type: 'event', ref: 'ev_c' } })] }), w);
    assert.equal(stale.ok, false, '★拿已了结的旧事当因 ⇒ 拒');
    // ★这就是"抄书进不来"的机制：书里写着的师父/血亲关系**指不出账上的任何一件事**
    //   ⇒ 模型想把它抄进这张表时，**没有任何一个合法的 ref 可填**（填了就必然被判"未知/已了结"）。
    const fabricated = checkWorldStep(step({ relationUpdates: [ru({ cause: { type: 'event', ref: 'ev_书里写的师父关系' } })] }), w);
    assert.equal(fabricated.ok, false, '★编一个"书里的关系"当因 ⇒ 拒（leg24 那条决定被形状保住）');
});

// ═══════════════ R4 + 红线 1：两端在册 / 玩家不可作持有方 ═══════════════
test('★R4 两端必须在册（from/to 都查，且不许自己跟自己成边）', () => {
    const w = W();
    assert.equal(checkWorldStep(step({ relationUpdates: [ru({ to: 'e_nobody' })] }), w).ok, false, '对谁不在册 ⇒ 拒');
    assert.equal(checkWorldStep(step({ relationUpdates: [ru({ from: 'e_nobody' })] }), w).ok, false, '谁不在册 ⇒ 拒');
    assert.equal(checkWorldStep(step({ relationUpdates: [ru({ to: 'e_x' })] }), w).ok, false, '自己跟自己不成边 ⇒ 拒');
    assert.equal(checkWorldStep(step({ relationUpdates: [ru()] }), w).ok, true, '合法的照收');
});

test('★★红线 1：玩家不可作"持有关系"的那一方（**反方向允许**）', () => {
    const w = W();
    const bad = checkWorldStep(step({ relationUpdates: [ru({ from: 'e_me' })] }), w);
    assert.equal(bad.ok, false, '★玩家当 from（"黄坤欠了谁"）⇒ 拒——玩家的承诺只有玩家能立');
    assert.ok(bad.errors.some((e) => e.includes('红线 1')), `理由要说清是红线 1：${bad.errors.join('; ')}`);
    // ★反方向：别人**对玩家**的态度是**世界**的事（那正是世界活起来的样子）
    const ok = checkWorldStep(step({ relationUpdates: [ru({ to: 'e_me', type: '恨他入骨' })] }), w);
    assert.equal(ok.ok, true, `★别人对玩家的态度照收：${ok.errors.join('; ')}`);
});

// ═══════════════ R6：了结只认引擎发的 id ═══════════════
test('★R6 了结只认 id：编的号 / 已了结的边 / 本轮刚建的边，三条都拒', () => {
    const w = W();
    // ① 编一个号
    const fake = checkWorldStep(step({ relationClosures: [{ id: 'rel_99_9' }] }), w);
    assert.equal(fake.ok, false, '★号不在账上 ⇒ 拒（不许现编）');
    // ② 已经了结过的边
    const w2 = W();
    w2.relations = [{ id: 'rel_1_1', from: 'e_x', to: 'e_m', type: '欠他一条命', cause: { type: 'event', ref: 'ev_s' }, tick: 1, endedTick: 2 }];
    const again = checkWorldStep(step({ relationClosures: [{ id: 'rel_1_1' }] }), w2);
    assert.equal(again.ok, false, '★了结是一次性的（已经了结过 ⇒ 拒）');
    assert.ok(again.errors.some((e) => e.includes('已经了结')), `理由要含"已经了结"：${again.errors.join('; ')}`);
    // ③ ★本轮刚建的边本轮不能了结（`check` 只看已落账的账 ⇒ 天然拒；settle 那边还有一道 id 快照）
    const sameRound = checkWorldStep(step({ relationUpdates: [ru()], relationClosures: [{ id: 'rel_1_1' }] }), w);
    assert.equal(sameRound.ok, false, '★本轮刚建的边本轮不许了结（照 entityFates"尘埃落定再言灭"）');
    // ④ 合法的了结：真落账 + 盖 endedTick
    const w3 = W();
    w3.relations = [{ id: 'rel_1_1', from: 'e_x', to: 'e_m', type: '欠他一条命', cause: { type: 'event', ref: 'ev_s' }, tick: 1 }];
    const after = run(w3, step({ relationClosures: [{ id: 'rel_1_1', why: '人情还清了' }] }));
    assert.equal(after.relations[0].endedTick, 1, '★引擎盖 endedTick（第几轮了结的）');
    assert.equal(after.relations[0].endedWhy, '人情还清了', '模型给的理由原样留档');
    assert.equal(after.relations[0].type, '欠他一条命', '★**只增不改**：边的来路一个字没被改写');
    assert.ok(after.chronicle.some((c) => c.text.includes('了结')), '了结也要留痕');
});

// ═══════════════ R3：旧账零扰动（本仓的零迁移纪律） ═══════════════
test('★★R3 旧账零扰动：不提议关系 ⇒ 账上一个字节都不动（连 relations 键都不许建）', () => {
    const bare = run(W(), empty());
    assert.equal(Object.prototype.hasOwnProperty.call(bare, 'relations'), false, '★不许凭空建 relations 键');
    assert.equal(JSON.stringify(bare).includes('"relations"'), false, '★整个账里不该出现这个串');
    // 显式交了空数组也一样（"缺席"与"空"必须同一条路）
    const withEmpty = run(W(), step({ relationUpdates: [], relationClosures: [] }));
    assert.equal(Object.prototype.hasOwnProperty.call(withEmpty, 'relations'), false, '★空数组也不许建键');
    // 旧世界（压根没有 relations 这一格）照样过契约 ⇒ **旧账零迁移**
    assert.equal(validate(bare, ssotSchema).ok, true, '★旧账形态仍然合法（可选表）');
});

test('★R3b 包：有关系才留那一栏；只递**未了结**的边；type 原话不改', () => {
    const w = W();
    const p0 = buildEvolutionPack(w, null);
    assert.equal(Object.prototype.hasOwnProperty.call(p0.pack, 'relations'), false,
        '★没关系的世界不许出现这一栏（空着就是空着）');
    w.relations = [
        { id: 'rel_3_1', from: 'e_x', to: 'e_m', type: '结下死仇', cause: { type: 'event', ref: 'ev_s' }, tick: 3 },
        { id: 'rel_4_1', from: 'e_m', to: 'e_x', type: '欠他一条命', cause: { type: 'event', ref: 'ev_s' }, tick: 4, endedTick: 5 },
    ];
    const p1 = buildEvolutionPack(w, null);
    assert.equal(p1.pack.relations.length, 1, '★只递未了结的边（了结的边是往事，走检索层）');
    assert.equal(p1.pack.relations[0].id, 'rel_3_1', '★id 要递出去——模型了结时只能引它');
    assert.equal(p1.pack.relations[0].type, '结下死仇', '★type 是模型的原话，一个字的加工都不加');
});

// ═══════════════ R5：不许静默 ═══════════════
test('★★R5 不许静默：净化器丢掉的那条必须记进 dropped（族 + 人话名字 + 理由）', () => {
    const w = W();
    const { step: out, dropped } = dropInvalidProposals(step({ relationUpdates: [ru({ to: 'e_nobody' })] }), w);
    assert.equal(out.relationUpdates.length, 0, '两端不在册 ⇒ 丢掉那一条');
    const d = dropped.find((x) => x.family === 'relationUpdates');
    assert.ok(d, '★必须留痕——**不许静默截断**（`entityUpdates ≤3` 当年正是栽在这里，leg112 已整条撤除）');
    assert.ok(d.reason, '理由要说清为什么丢');
    assert.ok(d.label && d.label.includes('结下死仇'), `人话名字要认得出是哪一条：${d.label}`);
    // 了结那一路同样不许静默
    const { dropped: dropped2 } = dropInvalidProposals(step({ relationClosures: [{ id: 'rel_99_9' }] }), w);
    assert.ok(dropped2.some((x) => x.family === 'relationClosures'), '★了结被丢也要留痕');
});

test('★两个消费口同一把尺：校验面拒的，净化面也丢（不许一边拒整步、一边照收）', () => {
    // 这是 leg67 甲案那条纪律（"同一个号不可能这边拒整步、那边只丢一条"）在**新通道**上的落实。
    const w = W();
    const cases = [
        ['两端不在册', ru({ to: 'e_nobody' })],
        ['因不在账', ru({ cause: { type: 'event', ref: 'ev_不存在' } })],
        ['因已了结', ru({ cause: { type: 'event', ref: 'ev_c' } })],
        ['玩家当持有方', ru({ from: 'e_me' })],
    ];
    for (const [name, bad] of cases) {
        const check = checkWorldStep(step({ relationUpdates: [bad] }), w);
        const { step: out, dropped } = dropInvalidProposals(step({ relationUpdates: [bad] }), w);
        assert.equal(check.ok, false, `${name}：校验面应拒`);
        assert.equal(out.relationUpdates.length, 0, `${name}：净化面也应丢`);
        assert.ok(dropped.some((x) => x.family === 'relationUpdates'), `${name}：净化面要留痕`);
    }
});

// ═══════════════ R7/R8：不许填占位 / 不许进公式 ═══════════════
test('★R7 不许填占位：tick 由引擎盖章，模型没有这一格可写', () => {
    const world = run(W(), step({ relationUpdates: [ru()] }));
    assert.equal(world.relations[0].tick, 1, '★第 1 轮的边就盖 1（不是 0、不是"现在"）');
    const w2 = run(world, empty());   // 再走一轮
    assert.equal(w2.relations[0].tick, 1, '★第二轮不许把它的 tick 改写（只增不改）');
    assert.equal(w2.relations[0].endedTick, undefined, '★没提议了结就不许出现 endedTick（空着就是空着）');
});

test('★★R8 关系不进任何公式：有关系的世界与没关系的世界，分量与实体逐字节相同', () => {
    // 红线 §2.2 第 1 条（不许把书里的词换算成数）：`死仇` 是文本，**不进公式、不排序、不比较、不当权重**。
    //   四维浮点（兵力/权位/人脉/耳目）就是因此被整体删除的——别让"关系亲密度"换个名字把它请回来。
    const withRel = run(W(), step({ relationUpdates: [ru(), ru({ from: 'e_m', to: 'e_x', type: '欠他一条命' })] }));
    const without = run(W(), empty());
    assert.equal(JSON.stringify(withRel.weights), JSON.stringify(without.weights), '★分量不许受关系影响');
    assert.equal(JSON.stringify(withRel.entities), JSON.stringify(without.entities), '★实体身上不许被写进任何关系痕迹');
    assert.equal(withRel.relations.length, 2, '两条**不同方向**的边并存（"既是盟友又有旧怨"是合法的人间事）');
});

test('★同批不重复：同一条边一轮内只提一次，但**不同 type 允许并存**', () => {
    const w = W();
    const dup = checkWorldStep(step({ relationUpdates: [ru(), ru()] }), w);
    assert.equal(dup.ok, false, '★同一条边（谁→对谁→什么关系）一轮内重复 ⇒ 拒（一条变更一个因，别叠）');
    const twoKinds = checkWorldStep(step({ relationUpdates: [ru(), ru({ type: '又是盟友' })] }), w);
    assert.equal(twoKinds.ok, true, `★不同 type 并存 ⇒ 允许（引擎不许替模型判"这两条矛盾"）：${twoKinds.errors.join('; ')}`);
});

test('★形状面：两组都是**可选组**（缺席合法），且 relationUpdates 里不许出现 id 这一格', () => {
    const w = W();
    assert.equal(checkWorldStep(empty(), w).ok, true, '★整组省掉 = 本轮不提议，不是形状错误');
    assert.equal(checkWorldStep(step({ relationUpdates: [] }), w).ok, true, '空数组合法');
    // ★模型不许自己发号（与 newEvents 不许写 id 同源）——多写一格在封闭形状下当场被拒
    const withId = checkWorldStep(step({ relationUpdates: [ru({ id: 'rel_1_1' })] }), w);
    assert.equal(withId.ok, false, '★relationUpdates 里不许写 id（发号只有引擎能做）');
});

// ═══════════════ 玩家看得见（把"面板要不要改"这件事**量出来**，而不是靠嘴说） ═══════════════
test('★玩家看得见：关系那一笔落在编年上 ⇒ **既有编年页直接渲染得出来**（v1 面板零改动）', () => {
    // 为什么这条要写成判据：细案 §2.4 原计划给实体页加一栏"关系"（那要升 `PANEL_BUILD` + 改渲染判据）。
    //   实施时实测：关系变更**已经落在编年行上**（带 `chainRef` 挂因），而编年页是**按行通用渲染**的
    //   ⇒ **玩家本来就看得见**，不需要动版面。★本仓那把尺子是"**玩家可见的版面真变了才升** `PANEL_BUILD`"
    //   （判据原文 `test/render.test.js:2352-2421`，它还硬锁着那个号的值 ⇒ 升位就得改判据 = 改承重墙）。
    //   ⇒ 结论：**v1 不升任何号**（与 leg119 同一类：动的是数据，不是版面）。
    const world = run(W(), step({ relationUpdates: [ru()] }));
    const html = renderChronicleHtml(world, { view: {} });
    assert.ok(html.includes('结下死仇'), '★编年页把它渲染出来了（关系不是隐形的）');
    assert.ok(html.includes('薛铁衣') && html.includes('明素问'), '★两端的人名都在行里（认得出是谁跟谁）');
});

// ═══════════════ 检索层：**本笔删了那一条判据**（死码清理，见 `src/ledger-recall.js` 的 RECALL_MODES 头注） ═══════════════
// 原来这里锁的是"关系的痕是编年行 ⇒ **按人取 / 按名取**直接取得回来（`ledger-recall.js` 零改动）"：
//   它拿 `BY_ENTITY` 取两端各一次、再拿 `BY_NAMES` 取一次，三条断言都要求取回那句"结下死仇"。
// ★`BY_ENTITY`（按人取）**生产路径零调用**，已随另外三种取法一起删（删的依据与实测见 `src/ledger-recall.js`）。
//   ⇒ 这条判据整条作废（它的一半断言已经没有可调的方式）。
// ★没失守的那一半：**痕落在编年行上**这件事本身照旧锁着——上一条判据（`renderChronicleHtml` 那一条）
//   锁"编年页直接渲染得出来、两端人名都在行里"，而"按名取"这条路仍在生产上用（`pack.js` / `web/inject.js`）
//   且由 `test/ledger-recall.test.js` 的 L1/L20/L21/L22 锁着（照名取只用账上真有的字）。

