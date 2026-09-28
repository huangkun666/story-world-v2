// story-world-v2/test/book-relations.test.js
//
// ★★★leg141（用户令「**把抽象阶段的关系网抽象做出来，我才发现初始化的时候都没有关系网**」）：
//   **书里那张关系网**的判据 —— 从"抽取那一刻"到"落进账上那张表"，整条链。
//
// ★这一笔治的病（用户当场点的）：**初始化之后账上一条关系边都没有**。
//   leg120 把那张表建起来了，但它只接"玩的过程里模型提议的边"（必带因）⇒ **开局恒空**，
//   点开任何一个实体，「关系」那一格永远是"0 条"。
//
// ★★这一笔的**口径转折**（用户 2026-09-27 当场推翻我，他是对的，逐字留档）：
//   「**为啥你们总喜欢把一个东西分为书里写的和之后改的？？我请问有什么实际意义？？**」＋
//   「**肯定会有矛盾那他妈是因为模拟啊？？书里关系的权威肯定能推翻要不然你模拟什么啊**」＋
//   「**回滚都有快照了还要多此一举？？**」
//   ⇒ 三条我全认，落成三条设计决定：
//     ① **一张表、一条网**：书里的边与玩出来的边**住在同一张 `ssot.relations` 里**，
//        **不按出处分成两张表、也不在屏幕上分两组**（"一条信息只许住在它该住的那一格"）；
//     ② **边上不挂出处章**：落账的边**没有 `cause`**（书里就是这么写的，来路是"书随时可查"）；
//        **也不给书里的边任何特殊权威** —— 权威能被玩的过程推翻，那正是模拟本身；
//     ③ **防编造的牙齿长在"抽取那一刻"**，不长在账本里：每条边必须附**书里那句原话**，
//        引擎逐字核过（与起根同一把尺子）**核完即弃**。
//
// ★★本文件最要紧的一条（**不对称是刻意的，不许"顺手抹平"**）：
//   **账上那张表允许没有 `cause` 的边；而模型在玩的过程里提议新边时，仍然必须带因。**
//   前者是"给定的开局"，后者才是编造风险所在 —— 见下面 ㉕ 那条判据两头咬着。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sanitizeBookRelations, seedBookRelations, seedBookEntities, extractWorldSetting, buildRosterPrompt, buildAbstractPrompt } from '../src/abstract.js';
import { checkWorldStep } from '../src/check-step.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// ── 一本很小的书：名号 + 关系原话都真在书文里 ────────────────────────────────
const BOOK = [
    '【玄天宗】玄天宗是北境第一大宗。',
    '【凌霄】凌霄乃玄天宗掌门。',
    '【苏问】苏问与凌霄义结金兰，同为玄天宗长老。',
    '【墨渊】墨渊是凌霄的师父。',
].join('\n');

// ── 账上已建好实体（名号 → id）的夹具 ────────────────────────────────────────
const world = () => ({
    version: 1,
    context: { world: '北境', tension: 0.5, positions: ['未明'] },
    entities: [
        { id: 'e_bk_1', kind: 'faction', name: '玄天宗', location: '未明' },
        { id: 'e_bk_2', kind: 'character', name: '凌霄', location: '未明' },
        { id: 'e_bk_3', kind: 'character', name: '苏问', location: '未明' },
    ],
    weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0 },
});

// ══════════════════════════════════════════════════════════════════════════════
// ① 抽取那一刻的闸：`sanitizeBookRelations`（纯函数，真跑）
// ══════════════════════════════════════════════════════════════════════════════

test('leg141·㉓：★出处闸——原话真在书文里的收下；编的丢掉，且**必须留痕**（不许静默）', () => {
    const roster = new Set(['玄天宗', '凌霄', '苏问', '墨渊']);
    const r = sanitizeBookRelations([
        { from: '凌霄', to: '玄天宗', type: '掌门', quote: '凌霄乃玄天宗掌门。' },          // ✔ 逐字在书里
        { from: '苏问', to: '凌霄', type: '义结金兰', quote: '苏问与凌霄义结金兰' },          // ✔ 逐字在书里
        { from: '凌霄', to: '苏问', type: '师徒', quote: '凌霄收苏问为徒，授以剑法。' },       // ✘ 书里没这句（编的）
    ], { sourceText: BOOK, rosterNames: roster });
    assert.equal(r.kept.length, 2, `★只有指得回书里的那两条该收下（实收 ${r.kept.length}）`);
    assert.deepEqual(r.kept.map((x) => `${x.from}→${x.to}`), ['凌霄→玄天宗', '苏问→凌霄']);
    assert.equal(r.kept[0].quote, '凌霄乃玄天宗掌门。', '★原话原样带着（下一步落账时才丢）');
    // ★编的那条必须**有明细**地被丢掉（本仓"不许静默"）
    assert.equal(r.dropped.length, 1, '★编的那条要丢掉');
    assert.match(r.dropped[0].edge, /凌霄 → 苏问/, '明细要认得出是哪一条');
    assert.match(r.dropped[0].why, /对不上|疑似编造/, '理由要说清是"原话对不上书文"');
    assert.ok(r.warnings.some((w) => w.includes('没通过出处闸')), '★丢弃要出声（账面上少了东西却没有任何提示 = 病）');
});

test('leg141·㉔：★另外三道机械判据——缺一端 / 自己跟自己 / 端点不在名册，三条都丢', () => {
    const roster = new Set(['玄天宗', '凌霄', '苏问']);
    const r = sanitizeBookRelations([
        { from: '凌霄', to: '', type: '掌门', quote: '凌霄乃玄天宗掌门。' },                       // 缺 to
        { from: '凌霄', to: '凌霄', type: '自指', quote: '凌霄乃玄天宗掌门。' },                    // 自己跟自己
        { from: '凌霄', to: '没这个人', type: '掌门', quote: '凌霄乃玄天宗掌门。' },                 // 端点不在名册
        { from: '凌霄', to: '玄天宗', type: '', quote: '凌霄乃玄天宗掌门。' },                      // 缺 type
        { from: '凌霄', to: '玄天宗', type: '掌门', quote: '' },                                  // 没带原话
        { from: '凌霄', to: '玄天宗', type: '掌门', quote: '凌霄乃玄天宗掌门。' },                   // ✔ 唯一合法的
    ], { sourceText: BOOK, rosterNames: roster });
    assert.equal(r.kept.length, 1, `★六条里只有一条合法（实收 ${r.kept.length}）`);
    assert.equal(r.dropped.length, 5, '★另外五条全要丢，且各带理由');
    const whys = r.dropped.map((d) => d.why).join(' | ');
    for (const frag of ['缺一端', '同一个名号', '不在名册', '没带书里那句原话']) {
        assert.ok(whys.includes(frag), `★理由要分得清是哪一种：少了「${frag}」（实际 ${whys}）`);
    }
    // 没有书文可比 ⇒ **如实记一条警告**（不许静默降级成"全部通过"）
    const noSrc = sanitizeBookRelations([{ from: '凌霄', to: '玄天宗', type: '掌门', quote: '随便一句什么' }], { sourceText: '' });
    assert.ok(noSrc.warnings.some((w) => w.includes('没有核对')), '★没书文可比 ⇒ 必须如实说"这次没核"');
});

test('leg141·㉕：★同一对端点用两种说法各交一条 = 合法（不许替它判"这两条矛盾"）', () => {
    // 口径与 world-step 那条「不同 type 允许并存」逐字同源（"既是盟友又有旧怨"是合法的人间事）。
    const roster = new Set(['凌霄', '苏问']);
    const r = sanitizeBookRelations([
        { from: '凌霄', to: '苏问', type: '师徒', quote: '凌霄乃玄天宗掌门。' },
        { from: '凌霄', to: '苏问', type: '结拜兄弟', quote: '苏问与凌霄义结金兰' },
    ], { sourceText: BOOK, rosterNames: roster });
    assert.equal(r.kept.length, 2, '★两种说法并存（引擎不判语义矛盾）');
    // 但**同一条边重复交**（同 from/to/type）只收一次
    const dup = sanitizeBookRelations([
        { from: '凌霄', to: '苏问', type: '师徒', quote: '凌霄乃玄天宗掌门。' },
        { from: '凌霄', to: '苏问', type: '师徒', quote: '凌霄乃玄天宗掌门。' },
    ], { sourceText: BOOK, rosterNames: roster });
    assert.equal(dup.kept.length, 1, '★同一条边（谁→对谁→什么关系）只收一次');
});

// ══════════════════════════════════════════════════════════════════════════════
// ② 落账：`seedBookRelations`（名号 → 实体 id；开局那批）
// ══════════════════════════════════════════════════════════════════════════════

test('leg141·㉖：★种进账——`rel_0_*` 发号 · `tick: 0` · **没有 `cause`** · 名号解析成实体 id', () => {
    const w = world();
    const out = seedBookRelations(w, { edges: [
        { from: '凌霄', to: '玄天宗', type: '掌门', quote: '凌霄乃玄天宗掌门。' },
        { from: '苏问', to: '凌霄', type: '义结金兰', quote: '苏问与凌霄义结金兰' },
    ] });
    assert.equal(out.seeded, 2, '两条都该落账');
    assert.equal(w.relations.length, 2);
    const r0 = w.relations[0];
    assert.equal(r0.id, 'rel_0_1', '★开局那批发号 rel_0_<n>（一眼看得出不是玩出来的）');
    assert.equal(r0.tick, 0, '★开局就在的 ⇒ 第 0 轮，不是"第几轮长出来的"');
    assert.equal(r0.from, 'e_bk_2', '★名号解析成了实体 id');
    assert.equal(r0.to, 'e_bk_1');
    assert.equal(r0.type, '掌门', '★书里的说法原样留档');
    assert.equal(Object.prototype.hasOwnProperty.call(r0, 'cause'), false,
        '★★落账的边**没有 cause**（用户当场裁的：书里就是这么写的，账本不记出处、也不给它特殊权威）');
    assert.equal(Object.prototype.hasOwnProperty.call(r0, 'quote'), false,
        '★★那句原话**核完即弃**（出处闸的牙齿长在抽取那一刻，不长在账本里）');
    // ★落账后世界仍过 SSOT 契约（没有 cause 的边是**合法形态**——这一条就是 leg141 的契约改动）
    const v = validate(w, ssotSchema);
    assert.equal(v.ok, true, `★没有 cause 的边必须过契约：${v.errors.join('; ')}`);
});

test('leg141·㉗：★幂等——跑第二遍一条不重种；**玩出来的边一个字不动**', () => {
    const w = world();
    const edges = [{ from: '凌霄', to: '玄天宗', type: '掌门', quote: '凌霄乃玄天宗掌门。' }];
    assert.equal(seedBookRelations(w, { edges }).seeded, 1);
    const again = seedBookRelations(w, { edges });
    assert.equal(again.seeded, 0, '★第二遍不许重种（`web/index.js` 建世界与每次载入都会跑）');
    assert.equal(again.skipped, 1, '★而且要如实报"跳过了一条"（不是装作没看见）');
    assert.equal(w.relations.length, 1, '账上还是一条');
    // 玩出来的边（带 cause、tick>0）不许被碰
    w.relations.push({ id: 'rel_5_1', from: 'e_bk_3', to: 'e_bk_2', type: '结下死仇', cause: { type: 'event', ref: 'ev_x' }, tick: 5 });
    const third = seedBookRelations(w, { edges });
    assert.equal(third.seeded, 0);
    assert.equal(w.relations.length, 2, '★玩出来的边一条都不许动');
    assert.equal(w.relations[1].type, '结下死仇', '★它的内容逐字未变');
    // ★号也不许撞：开局那批的序号从账上已有的 `rel_0_*` 往后接
    const w2 = world();
    w2.relations = [{ id: 'rel_0_7', from: 'e_bk_1', to: 'e_bk_2', type: '旧边', tick: 0 }];
    seedBookRelations(w2, { edges });
    assert.equal(w2.relations[1].id, 'rel_0_8', '★新号接着已有的最大号往后走（不许撞 rel_0_7）');
});

test('leg141·㉘：★零扰动——一条边都没有 ⇒ **连 `relations` 这个键都不建**', () => {
    const w = world();
    const out = seedBookRelations(w, { edges: [] });
    assert.equal(out.seeded, 0);
    assert.equal(Object.prototype.hasOwnProperty.call(w, 'relations'), false,
        '★没边就不许建键（照 leg120 那条 R3 判据的口径：空着就是空着）');
    assert.equal(JSON.stringify(w).includes('"relations"'), false, '★整个账里不该出现这个串');
    assert.equal(validate(w, ssotSchema).ok, true, '★旧账形态仍然合法');
});

test('leg141·㉙：★端点认不出的（书里抽到了、但没入池）**丢 + 留痕**，不许静默', () => {
    const w = world();
    const out = seedBookRelations(w, { edges: [
        { from: '凌霄', to: '玄天宗', type: '掌门', quote: '凌霄乃玄天宗掌门。' },
        { from: '墨渊', to: '凌霄', type: '师徒', quote: '墨渊是凌霄的师父。' },   // 墨渊**不在实体账上**
    ] });
    assert.equal(out.seeded, 1, '认得出的那条照落');
    assert.equal(out.dropped.length, 1, '认不出的要丢');
    assert.match(out.dropped[0], /墨渊/, '★明细要点名是哪个名号认不出');
    assert.ok(out.warnings.some((x) => x.includes('端点认不出')), '★丢弃要出声');
});

// ══════════════════════════════════════════════════════════════════════════════
// ③ ★★不对称是刻意的：账上允许无因的边；**玩的过程里提议新边仍然必须带因**
// ══════════════════════════════════════════════════════════════════════════════

test('leg141·㉚：★★两头咬住——账上无因合法 · world-step 无因仍然拒（那条闸**没有**被拆掉）', () => {
    // 一头：账上（开局种下的边）
    const w = world();
    seedBookRelations(w, { edges: [{ from: '凌霄', to: '玄天宗', type: '掌门', quote: '凌霄乃玄天宗掌门。' }] });
    assert.equal(validate(w, ssotSchema).ok, true, '★账上：没有 cause 的边合法');
    // 另一头：玩的过程里模型提议的边（**必须带因**，一个字没松）
    const proposal = {
        actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [],
        newEntities: [], entityFates: [],
        relationUpdates: [{ from: 'e_bk_3', to: 'e_bk_2', type: '结下死仇' }],
    };
    const bad = checkWorldStep(proposal, w);
    assert.equal(bad.ok, false, '★★玩的过程里**没有因**的新边仍然要拒（编造风险真正所在的地方）');
    assert.ok(bad.errors.some((e) => e.includes('cause')), `★要指到 cause 那一格：${bad.errors.join('; ')}`);
    // ★★两层拦，实测哪一层真的开火（**本笔顺手量清的一条**，别照注释想当然）：
    //   契约层（`world-step.schema.js` 的 `required: [… 'cause']`）**总是先开火**——
    //   `check-step.js` 那句逐字判词「必须带因（无因之变＝随口编的关系，不是玩出来的）」
    //   实测**到不了**（缺整格 ⇒ "必填缺失"；`cause:{}` ⇒ 子格"必填缺失"；`ref:''` ⇒ "短于 1"）。
    //   ⇒ 本判据锁的是**这条规矩本身在不在**（两头都咬），而不是"哪一层说的"。
    for (const shape of [undefined, {}, { type: 'event', ref: '' }]) {
        const ru = { from: 'e_bk_3', to: 'e_bk_2', type: '结下死仇' };
        if (shape !== undefined) ru.cause = shape;
        assert.equal(checkWorldStep({ ...proposal, relationUpdates: [ru] }, w).ok, false,
            `★★world-step 侧：cause=${JSON.stringify(shape)} ⇒ 一律拒（这条闸一个字没松）`);
    }
    // ★那条规矩的**判词**也必须还在（它现在由契约层兜着；判词被删掉就是"规矩没了声音"）
    assert.match(read('src/check-step.js'), /必须带因（无因之变＝随口编的关系，不是玩出来的）/,
        '★那句逐字判词不许被删（它可能被契约层挡在前面，但它是这条规矩的明文）');
    // 反向自证：带上一个真因就过（证明上面那条拒的是"缺因"，不是别的）
    const okStep = { ...proposal, relationUpdates: [{ from: 'e_bk_3', to: 'e_bk_2', type: '结下死仇', cause: { type: 'event', ref: 'ev_x' } }] };
    w.events = [{ id: 'ev_x', title: '北门那一刀', source: { type: 'state' }, position: '未明', ripples: [], links: { up: [], down: [] } }];
    assert.equal(checkWorldStep(okStep, w).ok, true, `★带真因就过：${checkWorldStep(okStep, w).errors.join('; ')}`);
});

// ══════════════════════════════════════════════════════════════════════════════
// ④ 接线：提示词里真有这一项 · 抽取链路真的把它带出来
// ══════════════════════════════════════════════════════════════════════════════

test('leg141·㉛：★两条提示词都真有 `relations`，且都写明"每条必须带书里那句原话"', () => {
    for (const [name, p] of [['buildRosterPrompt', buildRosterPrompt(BOOK, [])], ['buildAbstractPrompt', buildAbstractPrompt(BOOK)]]) {
        assert.match(p, /"relations"/, `★${name} 的形状里必须有 relations（否则模型永远不交这一项）`);
        assert.match(p, /"quote"/, `★${name} 必须写明每条带 quote（出处闸的输入就是它）`);
        assert.match(p, /书里的关系/, `★${name} 要有"书里的关系"那一段纪律`);
        assert.match(p, /指不出那句话的，就不要交这一条|不要交这一条/, `★${name} 要写明"指不出原话就别交"`);
        assert.match(p, /不许按常识推/, `★${name} 要挡住"按常识编关系"（这是本机制最大的风险面）`);
        assert.match(p, /from.*to.*必须是上面名册里出现过的名号|名册里出现过的名号/, `★${name} 要写明两端必须是名册里的名号`);
    }
});

test('leg141·㉜：★端到端——抽取真的把书里的边带进 `canon.relations`，编的那条当场被丢掉', async () => {
    // 假模型：按形状交名册 + 两条关系（一条有书里原话、一条是编的）
    const extract = async () => JSON.stringify({
        bookEntities: [
            { name: '玄天宗', kind: 'faction' },
            { name: '凌霄', kind: 'character' },
            { name: '苏问', kind: 'character' },
        ],
        relations: [
            { from: '凌霄', to: '玄天宗', type: '掌门', quote: '凌霄乃玄天宗掌门。' },
            { from: '凌霄', to: '苏问', type: '杀父之仇', quote: '凌霄杀了苏问的父亲。' },   // ★书里没有这句
        ],
    });
    const r = await extractWorldSetting({ sourceText: BOOK, extract, cache: null });
    assert.equal(r.ok, true, `抽取应成功：${(r.errors || []).join('; ')}`);
    const rel = r.setting?.frozen?.canon?.relations;
    assert.ok(Array.isArray(rel), '★`canon.relations` 必须真有（否则落账那一步无料可种）');
    assert.equal(rel.length, 1, `★编的那条要被出处闸丢掉（实收 ${rel.length}）`);
    assert.equal(rel[0].from, '凌霄', '★两端是**名号**（落账时才解析成 id）');
    assert.equal(rel[0].type, '掌门');
    assert.ok((r.errors || []).some((e) => e.includes('书里关系网出处闸')), '★丢弃要出现在 errors 里（如实报数）');
    // ★★端到端接上：把这份 canon 交给 `seedBookRelations`，账上就该真长出那条边
    const w = world();
    w.context.setting = r.setting;
    const seeded = seedBookRelations(w);
    assert.equal(seeded.seeded, 1, '★抽取 → 落账 整条链真的通了（这一条才是"初始化就有关系网"）');
    assert.equal(w.relations[0].from, 'e_bk_2', '★名号解析成了实体 id');
});

test('leg141·㉝：★`seedBookEntities` 之后立刻种关系 —— 初始化那条路的真实顺序（端到端）', async () => {
    // 这是 `web/index.js` 里真实的两行：先 `seedBookEntities(seed, {entries})`，再 `seedBookRelations(seed)`。
    const extract = async () => JSON.stringify({
        bookEntities: [{ name: '玄天宗', kind: 'faction' }, { name: '凌霄', kind: 'character' }],
        relations: [{ from: '凌霄', to: '玄天宗', type: '掌门', quote: '凌霄乃玄天宗掌门。' }],
    });
    const r = await extractWorldSetting({ sourceText: BOOK, extract, cache: null });
    const seed = {
        version: 1, context: { world: '北境', tension: 0.5, positions: ['未明'], setting: r.setting },
        entities: [], weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0, simLog: [] },
    };
    seedBookEntities(seed, { entries: [] });
    assert.ok(seed.entities.length >= 2, '前置：实体真建出来了');
    const out = seedBookRelations(seed);
    assert.equal(out.seeded, 1, '★初始化之后账上就该有关系边（用户那一句"初始化的时候都没有关系网"的正解）');
    assert.equal(seed.relations[0].tick, 0);
    assert.equal(validate(seed, ssotSchema).ok, true, `★整份开局账过契约：${validate(seed, ssotSchema).errors.join('; ')}`);
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑤ 屏幕那一侧：**一张网，不分出处**（用户当场裁的那一条）
// ══════════════════════════════════════════════════════════════════════════════

test('leg141·㉞：★★窗口那一格**不许按出处分组**，也不许再说"关系是玩出来的"', async () => {
    const { renderEntityWindowHtml, relationsOf } = await import('../web/entity-window.js');
    const w = world();
    seedBookRelations(w, { edges: [
        { from: '凌霄', to: '玄天宗', type: '掌门', quote: '凌霄乃玄天宗掌门。' },
        { from: '苏问', to: '凌霄', type: '义结金兰', quote: '苏问与凌霄义结金兰' },
    ] });
    // 取数：开局种下的边与玩出来的边走**同一个口**（没有第二张表、没有第二个函数）
    assert.equal(relationsOf(w, 'e_bk_2').length, 2, '★凌霄身上两条边都在（一条他当 from、一条他当 to）');
    const html = renderEntityWindowHtml(w, 'e_bk_2');
    assert.ok(html.includes('掌门') && html.includes('义结金兰'), '★两条边都渲染出来了');
    assert.ok(html.includes('玄天宗') && html.includes('苏问'), '★两端的人名/势力名都在（认得出是谁跟谁）');
    // ★不许分家：产物里不许出现"书里写的/玩出来的"这类**按出处分的组**
    for (const bad of ['书里写的', '玩出来的边', '书里给的关系', '开局给的']) {
        assert.ok(!html.includes(bad), `★★不许按出处分组（用户当场裁的）：「${bad}」`);
    }
    // ★空态那句也不能再说"关系是玩出来的"（那句话现在只对一半，是**假话**）
    const bare = renderEntityWindowHtml(world(), 'e_bk_1');
    assert.ok(!bare.includes('关系是玩出来的'), '★空态不许再说"关系是玩出来的"（书里的边也在这张表里）');
    assert.match(bare, /书里没写他的归属与同僚/, '★空态要如实说清是哪一种空');
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑥ ★★本笔差点漏掉的一环：**提示词形状与缓存版本戳必须同批动**
// ══════════════════════════════════════════════════════════════════════════════
//
// 病（写这一笔时现读代码才发现的）：**缓存键只有"书文本指纹"**（`bookFingerprint` 只吃书文，
//   `src/fingerprint.js:16`），**提示词改了它一个字都不知道** ⇒ 光改提示词、不抬版本戳，
//   老世界再点「初始化」会**命中旧缓存**、拿着"没有关系网"的那份 canon 直接返回，
//   **新提示词一次都不会被行使**——而且整个过程看起来完全正常（`ok=true`、`cached=true`、账照建）。
// ★这条判据咬的就是那个耦合：**canon 形状变了 ⇒ `CACHE_VERSION` 必须跟着抬**。
test('leg141·㉟：★★提示词形状变了，缓存版本戳必须同批抬（否则老世界永远拿不到新产出）', () => {
    const fpSrc = read('src/fingerprint.js');
    const absSrc = read('src/abstract.js');
    // 前置：形状那一侧真有 relations（取不到 ⇒ 下面那条是空绿）
    assert.match(absSrc, /relations: \[/, '前置：抽取形状里真有 relations');
    const ver = Number((/CACHE_VERSION = (\d+)/.exec(fpSrc) || [])[1]);
    assert.ok(Number.isFinite(ver), '★`CACHE_VERSION` 必须取得到（它是这条耦合锁的一头）');
    assert.ok(ver >= 3, `★canon 多了 relations ⇒ CACHE_VERSION 必须 ≥3（v2 那批条目里没有这一项；现为 ${ver}）`);
    assert.notEqual(ver, 2, '★写回 2 就是"新提示词 + 旧缓存"那个坑');
    // ★版本戳那一段必须写清**为什么**抬（下一个人得看懂它是给谁抬的，不然会被当成噪声删掉）
    assert.match(fpSrc, /relations/, '★版本戳的注释里要点名是 relations 这一格引起的');
    assert.match(fpSrc, /命中旧缓存|一次都不会被行使/, '★要写清不抬的后果（"看起来完全正常"才是最贵的部分）');
});
