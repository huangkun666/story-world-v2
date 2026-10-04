// story-world-v2/test/schema.test.js
// 校验器自身单测 + 双 schema 的"非法文档被拒"测试（S2 验收）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { worldStepSchema } from '../src/schemas/world-step.schema.js';
import { pruneJunkRules, RULE_CLASS_STYLE } from '../src/abstract-tier.js';
import { migrateStyleRulesFromCanon } from '../src/settle.js';
import { planChronicleRotation } from '../src/storage.js';

// ---------- 校验器规则 ----------

const tiny = {
    kind: 'object',
    additional: false,
    required: ['a'],
    props: {
        a: { kind: 'number', int: true, min: 1 },
        b: { kind: 'string', enum: ['x', 'y'] },
        c: { kind: 'array', minItems: 1, items: { kind: 'boolean' } },
        d: { kind: 'numRecord' },
    },
};

test('校验器：合法文档通过', () => {
    const r = validate({ a: 2, b: 'x', c: [true], d: { k: 1.5 } }, tiny);
    assert.equal(r.ok, true);
    assert.deepEqual(r.errors, []);
});

test('校验器：必填缺失/类型错/枚举外/未知字段/数组界/整数界 全量报错', () => {
    const r = validate({ a: 0.5, b: 'z', c: [], d: { k: 's' }, e: 1 }, tiny);
    assert.equal(r.ok, false);
    const joined = r.errors.join('\n');
    assert.ok(joined.includes('$.a: 期望整数') || joined.includes('$.a: 小于 1'));
    assert.ok(joined.includes('$.b: 枚举外值 "z"'));
    assert.ok(joined.includes('$.c: 少于 1 项'));
    assert.ok(joined.includes('$.d.k: 期望数字'));
    assert.ok(joined.includes('$.e: 未知字段'));
});

test('校验器：缺失必填单独列出', () => {
    const r = validate({}, tiny);
    assert.ok(r.errors.includes('$.a: 必填缺失'));
});

// ---------- SSOT schema ----------
// leg25 c（用户令「删」）：四维浮点（兵力/权位/人脉/耳目）整条删除之后，实体 `attrs` 键**不再被接受**。
//   所以下面所有 SSOT 夹具里的 `attrs: {}` 一律摘掉——留着它 schema 会判「未知字段」。
//   这不是"改夹具迁就实现"：那些空 attrs 本来就没有任何信息量（空对象），删掉不损失任何断言意图。

test('SSOT schema：无源事件被拒（§4.2）', () => {
    const doc = {
        version: 1,
        context: { world: '临渊城', tension: 0.5, positions: ['临渊城'] },
        entities: [{ id: 'e1', kind: 'faction', name: 'A', location: '临渊城' }],
        weights: {},
        agendas: [{ id: 'a1', owner: 'e1', goal: 'g', stage: 's', visibility: 'known', maxSteps: 2, progress: 0, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } }],
        events: [{ id: 'ev1', title: '空降事件', position: '临渊城' }],   // 无 source
        chronicle: [],
        meta: { tick: 1 },
    };
    const r = validate(doc, ssotSchema);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.includes('$.events[0].source: 必填缺失')), r.errors.join('; '));
});

test('SSOT schema：事件源类型枚举外被拒', () => {
    const base = {
        version: 1,
        context: { world: '临渊城', tension: 0.5, positions: ['临渊城'] },
        entities: [{ id: 'e1', kind: 'character', name: 'A', location: '临渊城' }],
        weights: {},
        agendas: [],
        events: [{ id: 'ev1', title: 't', source: { type: 'magic' }, position: '临渊城' }],
        chronicle: [],
        meta: { tick: 1 },
    };
    const r = validate(base, ssotSchema);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => e.includes('枚举外值 "magic"')));
});

test('SSOT schema：盘算缺 maxSteps 被拒（§4.5 三必须）', () => {
    const base = {
        version: 1,
        context: { world: '临渊城', tension: 0.5, positions: ['临渊城'] },
        entities: [{ id: 'e1', kind: 'faction', name: 'A', location: '临渊城' }],
        weights: {},
        agendas: [{ id: 'a1', owner: 'e1', goal: 'g', stage: 's', visibility: 'known', progress: 0, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } }],
        events: [],
        chronicle: [],
        meta: { tick: 1 },
    };
    const r = validate(base, ssotSchema);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => e.includes('$.agendas[0].maxSteps: 必填缺失')));
});

test('SSOT schema：顶层未知字段被拒', () => {
    const base = {
        version: 1,
        context: { world: '临渊城', tension: 0.5, positions: ['临渊城'] },
        entities: [{ id: 'e1', kind: 'faction', name: 'A', location: '临渊城' }],
        weights: {},
        agendas: [],
        events: [],
        chronicle: [],
        meta: { tick: 1 },
        stray: true,
    };
    const r = validate(base, ssotSchema);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => e.includes('$.stray: 未知字段')));
});

test('SSOT schema（leg25 c）：实体 `attrs` 不再被接受——删字段只删一半最危险（引擎不写、契约仍收=看起来删了其实没有）', () => {
    const doc = {
        version: 1,
        context: { world: '临渊城', tension: 0.5, positions: ['临渊城'] },
        entities: [{ id: 'e1', kind: 'faction', name: 'A', location: '临渊城', attrs: { hardPower: 0.5 } }],
        weights: {},
        agendas: [],
        events: [],
        chronicle: [],
        meta: { tick: 1 },
    };
    const r = validate(doc, ssotSchema);
    assert.equal(r.ok, false);
    // ★leg34：错误措辞变了（实体已放开额外字段 ⇒ `attrs` 不再走"未知字段"那条，改走**显式拒收名单**）。
    //   断言从"精确措辞"放宽到"**这一条被点名拒了**"——判据要锁的是"attrs 进不来"这个事实，不是文案。
    assert.ok(r.errors.some((e) => e.startsWith('$.entities[0].attrs:')), r.errors.join('; '));
    assert.ok(r.errors.some((e) => e.includes('attrs')), '必须点名是 attrs（别只说"某字段不行"）');
});

test('SSOT schema：盘算 closed 可选、meta.simLog 记账合法', () => {
    const doc = {
        version: 1,
        context: { world: '临渊城', tension: 0.5, positions: ['临渊城'] },
        entities: [{ id: 'e1', kind: 'faction', name: 'A', location: '临渊城' }],
        weights: {},
        agendas: [{ id: 'a1', owner: 'e1', goal: 'g', stage: 's', visibility: 'known', maxSteps: 2, progress: 2, closed: true, memory: { promises: [], done: [], blocked: [], turnsAlive: 2 } }],
        events: [],
        chronicle: [],
        meta: { tick: 1, simLog: [{ tick: 1, packTokens: 100, ssotBytes: 200, events: 1, chronicle: 2, calls: 1, warnings: [] }] },
    };
    const r = validate(doc, ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
});

// ---------- 编年行 kind 章（K39/链视图细案 §3.1：五筛类型章，可选=旧行零扰动） ----------

test('SSOT schema：编年行 kind 合法值通过、枚举外被拒、缺省合法（旧行零扰动）', () => {
    const base = {
        version: 1,
        context: { world: '临渊城', tension: 0.5, positions: ['临渊城'] },
        entities: [{ id: 'e1', kind: 'faction', name: 'A', location: '临渊城' }],
        weights: {},
        agendas: [],
        events: [],
        chronicle: [],
        meta: { tick: 1 },
    };
    for (const kind of ['scheme', 'major', 'ripple', 'shade', 'state']) {
        const withKind = structuredClone(base);
        withKind.chronicle = [{ id: 'ch_1_1', tick: 1, text: '行', kind }];
        const r = validate(withKind, ssotSchema);
        assert.equal(r.ok, true, `${kind}: ${r.errors.join('; ')}`);
    }
    const oldRow = structuredClone(base);
    oldRow.chronicle = [{ id: 'ch_0_1', tick: 1, text: '旧账行（无 kind=合法）' }];
    assert.equal(validate(oldRow, ssotSchema).ok, true, '无 kind 旧行合法');
    const bad = structuredClone(base);
    bad.chronicle = [{ id: 'ch_1_1', tick: 1, text: '行', kind: 'nope' }];
    const rb = validate(bad, ssotSchema);
    assert.ok(!rb.ok);
    assert.ok(rb.errors.some((e) => e.includes('枚举外值 "nope"')));
});

test('SSOT schema：编年行 chainRef 可选字段——合法通过、与 eventRef 并存合法、缺省合法、非字符串拒（链路入口数据，第十五棒补）', () => {
    const base = {
        version: 1,
        context: { world: '临渊城', tension: 0.5, positions: ['临渊城'] },
        entities: [{ id: 'e1', kind: 'faction', name: 'A', location: '临渊城' }],
        weights: {},
        agendas: [],
        events: [],
        chronicle: [],
        meta: { tick: 1 },
    };
    const ok = structuredClone(base);
    ok.chronicle = [{ id: 'ch_1_1', tick: 1, text: '事件「边关扣货」闭环（源盘算已结算）', kind: 'major', chainRef: 'ev_1_1' }];
    assert.equal(validate(ok, ssotSchema).ok, true, 'chainRef 合法');
    const both = structuredClone(base);
    both.chronicle = [{ id: 'ch_1_2', tick: 2, text: '行', eventRef: 'ev_1_1', chainRef: 'ev_1_1' }];
    assert.equal(validate(both, ssotSchema).ok, true, 'eventRef+chainRef 并存合法');
    assert.equal(validate(base, ssotSchema).ok, true, '无 chainRef 旧行合法（旧世界零扰动）');
    const bad = structuredClone(base);
    bad.chronicle = [{ id: 'ch_1_3', tick: 3, text: '行', chainRef: 42 }];
    assert.ok(!validate(bad, ssotSchema).ok, '非字符串 chainRef 被拒');
});

// ---------- 契约层：引擎写进账的键，尺子上必须登记过 ----------
// 病（同一个病第三次长出来，这一笔才查全）：`canon` 与 `meta` 都是 `additional:false`
//   ⇒ 引擎一旦多写一个没登记的键，**整份真账过不了自家尺子**；而生产路不跑校验 ⇒ 它一直不出声。
//   ① leg60：`seed`/`seedFrom`/`fields`（已修）② leg151 记账时照出 `parentSource`/`axis`
//   ③ leg155（本笔）把四份真账的违约**逐族分组**，查出 5 族，其中 3 族从来没人登记过。
// ★下面每一条都配一条反证的反证：**补登记 ≠ 把闸门整个打开**。

// 一份最小合法账（只差被测的那一格）。
const ledgerDoc = ({ canon = {}, meta = {}, events = [] } = {}) => ({
    version: 1,
    context: {
        world: '临渊城',
        tension: 0.5,
        positions: ['临渊城'],
        setting: {
            frozen: {
                fingerprint: 'fnv1a_t',
                extractedAt: 'T',
                canon: { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [], bookEntities: [], ...canon },
            },
        },
    },
    entities: [{ id: 'e1', kind: 'faction', name: '甲', location: '临渊城' }],
    weights: {},
    agendas: [],
    events,
    chronicle: [],
    meta: { tick: 1, ...meta },
});

test('契约层：名册条目带 parentSource/parentSourceFrom 必须过——旧账的历史出处值仍合法', () => {
    // ★Task 3 更新：真账里这两格由旧法写上（值如「名字包含」「名字包含@天庭」「member-line」），
    //   而**新法不再生产**它们（名字包含/成员行只作候选与定位；见 src/abstract.js 的 verifyClaimedParent 头注）。
    //   本条的判据不变：**旧账与快照不重建** ⇒ 这些历史值必须继续过契约（自由字符串）。
    const doc = ledgerDoc({ canon: { bookEntities: [{ name: '天庭百官', kind: 'faction', parent: '天庭', parentSource: '名字包含', parentSourceFrom: '名字包含@天庭' }] } });
    const r = validate(doc, ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
});

test('契约层：powerScale 条目带 axis 必须过——旧账里它是空串，为老账零扰动留登记', () => {
    // ★这一格的真相与"漏登记"不同（leg155 当场查实的）：真账上 463 条 axis **全是空串**
    //   （引擎把内部去重键漏进了产出）。治法分两头：产出那一头**不再写空串**（见
    //   `test/scales-concept-table.test.js`），契约这一头**照 `ratio` 的先例留登记**——
    //   老账里已经躺着的那一批不许因为"引擎不再写"就变得不合法。
    const legacy = ledgerDoc({ canon: { powerScale: [{ level: '初期', note: 'x1.0', axis: '' }] } });
    assert.equal(validate(legacy, ssotSchema).ok, true, validate(legacy, ssotSchema).errors.join('; '));
    const real = ledgerDoc({ canon: { powerScale: [{ level: 'T4 金丹境', note: '结丹', axis: '境界表' }] } });
    assert.equal(validate(real, ssotSchema).ok, true, validate(real, ssotSchema).errors.join('; '));
});

test('契约层：canon.ruleKinds 必须过——它是 `pruneJunkRules` 的产出，三份真账都有这一格', () => {
    // 用**真产生者**造这一格（不是手搭一个假想形状）：摘掉杂物之后剩下的类别表就是它。
    const kept = '凡战者，以正合，以奇胜';
    const junk = '必须放在内容标签内';
    const pruned = pruneJunkRules([junk, kept], { [junk]: RULE_CLASS_STYLE, [kept]: '判断依据' });
    assert.deepEqual(pruned.dropped, [junk], '前提：真产生者确实摘掉了那一类杂物');
    assert.ok(Object.keys(pruned.ruleKinds).length > 0, '前提：它确实产出了类别表（不是空对象）');
    const doc = ledgerDoc({ canon: { rules: pruned.rules, ruleKinds: pruned.ruleKinds } });
    const r = validate(doc, ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
});

test('契约层：载入期清理的产出（meta.styleRulesPurged / styleRulesPurgedAt）必须过自家尺子', () => {
    // "迁移写完就过不了尺子"是最坏的组合：它每次载入都跑一遍，而校验只在体检时跑。
    const kept = '凡战者，以正合，以奇胜';
    const junk = '必须放在内容标签内';
    const before = ledgerDoc({ canon: { rules: [junk, kept], ruleKinds: { [junk]: RULE_CLASS_STYLE, [kept]: '判断依据' } } });
    const after = migrateStyleRulesFromCanon(before);
    assert.notEqual(after, before, '前提：确实有可摘的（否则这条判据什么都没测）');
    assert.equal(after.meta.styleRulesPurgedAt, 1, '前提：留痕时点写下了');
    const r = validate(after, ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
});

test('契约层：meta.recalled 必须过——旧版引擎的检索读数残留（本版引擎一个字都不写它）', () => {
    // 口径：**留着这一格是为了老账不破**（照 `legacyAttrsMigratedAt` 那两格的先例），
    //   不是"把删掉的功能请回来"——`pack.recalled` 与提示词里那两处仍是拆掉的状态。
    const doc = ledgerDoc({ meta: { recalled: { tick: 0, ok: false, chunks: 0, sources: [], queryChars: 129, reason: '检索无命中' } } });
    const r = validate(doc, ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
});

test('★★反证的反证：补登记不等于把闸门打开——这四块里塞没登记的野键，仍须当场被拒', () => {
    const roster = ledgerDoc({ canon: { bookEntities: [{ name: '甲', parentSource: '名字包含', parentSourceFrom: 'tag', 野键名册: 1 }] } });
    const r1 = validate(roster, ssotSchema);
    assert.ok(!r1.ok && r1.errors.some((e) => e.includes('bookEntities[0].野键名册') && e.includes('未知字段')), r1.errors.join('; '));

    const tiers = ledgerDoc({ canon: { powerScale: [{ level: 'X1', note: '一', axis: '', 野键档位: 1 }] } });
    const r2 = validate(tiers, ssotSchema);
    assert.ok(!r2.ok && r2.errors.some((e) => e.includes('powerScale[0].野键档位') && e.includes('未知字段')), r2.errors.join('; '));

    const canon = ledgerDoc({ canon: { ruleKinds: { 法则一: '判断依据' }, 野键canon: 1 } });
    const r3 = validate(canon, ssotSchema);
    assert.ok(!r3.ok && r3.errors.some((e) => e.includes('canon.野键canon') && e.includes('未知字段')), r3.errors.join('; '));

    const meta = ledgerDoc({ meta: { recalled: {}, 野键meta: 1 } });
    const r4 = validate(meta, ssotSchema);
    assert.ok(!r4.ok && r4.errors.some((e) => e.includes('meta.野键meta') && e.includes('未知字段')), r4.errors.join('; '));
});

test('契约层：事件 position 在历史账和新事件提议两侧都可选', () => {
    // 用户「位置改成可选」要求适用于事件，不因新旧账采用两套要求。
    const doc = ledgerDoc({ events: [{ id: 'ev_seed_1', title: '父亲企图带回白屋', source: { type: 'seed' } }] });
    const r = validate(doc, ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
    const step = {
        actions: [], newEvents: [{ title: '边关扣货', source: { type: 'state' } }],
        agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const rs = validate(step, worldStepSchema);
    assert.equal(rs.ok, true, rs.errors.join('; '));
});

test('契约层：卷号计数器 `nextVolume`（顶层）必须过——`planChronicleRotation` 每次落卷都写它', () => {
    // ★这一格**只在长局里出现**：四份真账一次都没轮转过（都没到那一步）⇒ 逐个核那四份时一次都没照到；
    //   它是本笔拿 leg153 那份 400 轮长账跑真机验收时才浮出来的（那一刻账上已经 249 卷）。
    //   ★用**真产生者**造它（`planChronicleRotation` → `rotateChronicle`），不是手搭一个假想形状。
    const world = ledgerDoc({});
    world.chronicle = Array.from({ length: 12 }, (_, i) => ({ id: `ch_${i + 1}_1`, tick: i + 1, text: `第 ${i + 1} 轮那件事` }));
    const plan = planChronicleRotation({ world, nextVolume: 1, volumes: [], limits: { ticks: 2, bytes: 1e9 }, now: 'T' });
    assert.ok(plan.volume, '前提：真轮转了（没轮转的话这条判据什么都没测）');
    assert.equal(plan.applied.nextVolume, 2, '前提：轮转确实把这个数写进了世界');
    const r = validate(plan.applied, ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
});

// ---------- 世界步 schema（提案形状） ----------
// leg25 c：`stateChanges`（属性增量提议）整条删除；世界步从八组收敛为**七组**。

test('世界步 schema：合法世界步通过（七组形状）', () => {
    const step = {
        actions: [{ entity: 'e_merchant', verb: '循商路北上', position: '商路' }],
        newEvents: [{ title: '边关扣货', source: { type: 'state' }, position: '边关', ripples: ['e_merchant'] }],
        agendaAdvances: [{ agendaId: 'a_1', step: '守将首肯，车队放行', stage: '过边关' }],
        newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = validate(step, worldStepSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
});

test('世界步 schema（leg25 c）：`stateChanges` 属未知字段被拒——四维浮点已随用户令删除，涨回来的路必须是"另立细案"而不是"旧键复活"', () => {
    // 这一条锁的是"删除"这件事本身：契约层该字段整条删了，模型若照旧模板吐出它，整步被拒（世界如实不动）。
    const step = {
        actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
        stateChanges: [{ entity: 'e_merchant', attr: 'network', delta: 0.05 }],
    };
    const r = validate(step, worldStepSchema);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('$.stateChanges: 未知字段')), r.errors.join('; '));
});

test('世界步 schema：事件缺源被拒、未知字段被拒', () => {
    const bad = {
        actions: [],
        newEvents: [{ title: 't', position: '边关' }],   // 缺 source
        agendaAdvances: [],
        newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
        magic: 1,
    };
    const r = validate(bad, worldStepSchema);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => e.includes('$.newEvents[0].source: 必填缺失')));
    assert.ok(r.errors.some(e => e.includes('$.magic: 未知字段')));
});
