// story-world-v2/test/settle.test.js
// S5 验收：结算管线按序（校验→裁定→挂链→一致性→重算→落账→编年→度量），纯函数性 + golden 世界。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settleTick } from '../src/settle.js';
import { computeWeight } from '../src/weight.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/golden-world.min.json', import.meta.url), 'utf8'));

const validStep = () => ({
    actions: [{ entity: 'e_merchant', verb: '沿商路北上巡查', position: '商路' }],
    newEvents: [{ title: '守将允诺通关', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: ['e_merchant'] }],
    agendaAdvances: [{ agendaId: 'a_1', step: '守将首肯，车队放行', stage: '过边关' }],
    stateChanges: [{ entity: 'e_merchant', attr: 'network', delta: 0.05, cause: 'a_1' }],
    newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
});

// 一实体无盘算的孤岛世界（一致性检查用）
const loneWorld = () => ({
    version: 1,
    context: { world: '孤岛', tension: 0.3, positions: ['孤岛'] },
    entities: [{ id: 'e_lone', kind: 'character', name: '独行客', location: '孤岛', attrs: { network: 0.2 } }],
    weights: {},
    agendas: [],
    events: [{ id: 'ev_old', title: '旧事', source: { type: 'state' }, position: '孤岛', closed: true }],
    chronicle: [],
    meta: { tick: 3 },
});

test('结算：基本 tick 全管线落账', () => {
    const before = JSON.stringify(GOLDEN);
    const r = settleTick({ ssot: GOLDEN, step: validStep(), moveFact: { verb: '收服', object: '龙蛋' } });
    assert.equal(r.ok, true, JSON.stringify(r.stage.warnings));
    const w = r.ssot;

    assert.equal(w.meta.tick, 1, 'tick 推进');
    assert.equal(w.events.length, 1, '事件挂链');
    assert.equal(w.events[0].id, 'ev_1_1');
    assert.deepEqual(w.events[0].links.up, [], 'plot 源无上游指针');
    assert.equal(w.events[0].position, '边关');

    assert.equal(w.agendas[0].progress, 2, '盘算推进');
    assert.equal(w.agendas[0].stage, '过边关');
    assert.equal(w.agendas[0].memory.done.length, 1, '推进留痕');

    // 锚点更新（K2 重算切真公式）：重算在 stateChanges 落账后（network 0.6→0.65）→ base 0.47 × 1.5 = 0.705
    assert.ok(Math.abs(w.weights.e_merchant - 0.705) < 1e-9, `分量真公式值，实际 ${w.weights.e_merchant}`);
    assert.equal(w.entities[0].attrs.network, 0.65, '状态变更落账');

    assert.ok(w.chronicle.length >= 2, '编年：推进 + 事件各一条');
    const evEntry = w.chronicle.find((c) => c.id === 'ch_1_ev_1');
    assert.ok(evEntry.text.includes('事件「守将允诺通关」'), '编年可读');
    assert.ok(evEntry.text.includes('由盘算「打通边关商路」而生'), '编年带因果（写名不写代号）');

    assert.equal(w.meta.simLog.length, 1, '台账记账');
    assert.ok(w.meta.simLog[0].packTokens > 0 && w.meta.simLog[0].ssotBytes > 0, '四字段有值');
    assert.deepEqual(w.meta.simLog[0].warnings, []);

    assert.equal(GOLDEN.meta.tick, 0, '输入不被修改（纯函数）');
    assert.equal(JSON.stringify(GOLDEN), before);
    const vr = validate(w, ssotSchema);
    assert.equal(vr.ok, true, `结算后世界仍过 schema: ${vr.errors.join('; ')}`);
});

test('leg24 片2 账本换血：账面没有的那一维——首次正向提议记为初值（不从 0 起算），负向提议不收', () => {
    const mk = (attrs) => ({
        version: 1,
        context: { world: '孤岛', tension: 0.5, positions: ['孤岛'] },
        entities: [{ id: 'e_lone', kind: 'character', name: '独行客', location: '孤岛', attrs }],
        weights: {},
        agendas: [],
        events: [{ id: 'ev_1', title: '旧事', source: { type: 'state' }, position: '孤岛', closed: false }],
        chronicle: [],
        meta: { tick: 0 },
    });
    const stepOf = (attr, delta) => ({
        actions: [], newEvents: [], agendaAdvances: [],
        stateChanges: [{ entity: 'e_lone', attr, delta, cause: 'ev_1' }],
        newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    });
    // ① 账面空着（leg24 片2：名册/入局都不再预填）→ 分量取中立 floor
    const w = mk({});
    assert.equal(computeWeight(w.entities[0].attrs, 'character', 0.5), 0.5, '账面无数 → 中立 floor 0.5');
    // ② 首次正向提议 = 该维初值（旧法 ?? 0 起算会得到同样的数，但语义是"从 0 加"；且必留痕）
    const r1 = settleTick({ ssot: w, step: stepOf('hardPower', 0.4) });
    assert.equal(r1.ok, true, r1.stage.warnings.join('; '));
    assert.equal(r1.ssot.entities[0].attrs.hardPower, 0.4, '首次正向提议记为初值');
    assert.ok(r1.stage.warnings.some((x) => x.includes('记为该维初值')), '初值留痕（每条变更留痕）');
    // ③ 同维第二次 → 正常增量语义
    const r2 = settleTick({ ssot: r1.ssot, step: stepOf('hardPower', 0.1) });
    assert.equal(r2.ssot.entities[0].attrs.hardPower, 0.5, '第二次走增量（0.4+0.1）');
    // ④ 无基线时的负向提议 → 不收（不得凭空造出"0"这个事实），但留痕
    const r3 = settleTick({ ssot: r1.ssot, step: stepOf('office', -0.3) });
    assert.equal(r3.ok, true);
    assert.equal(r3.ssot.entities[0].attrs.office, undefined, '负向提议无基线可减 → 不落账（旧法会钳成 0）');
    assert.ok(r3.stage.warnings.some((x) => x.includes('负向提议') && x.includes('无基线可减')), '不收也留痕');
    // ⑤ 有基线后照样能削弱（先正向、再负向）
    const r4 = settleTick({ ssot: r3.ssot, step: stepOf('office', 0.3) });
    const r5 = settleTick({ ssot: r4.ssot, step: stepOf('office', -0.1) });
    assert.ok(Math.abs(r5.ssot.entities[0].attrs.office - 0.2) < 1e-9, '有基线 → 负向照常生效');
    assert.equal(validate(r5.ssot, ssotSchema).ok, true);
});

test('结算：校验不过 → 世界如实不动', () => {
    const bad = validStep();
    bad.actions[0].entity = 'e_ghost';
    const r = settleTick({ ssot: GOLDEN, step: bad });
    assert.equal(r.ok, false);
    assert.equal(r.ssot, GOLDEN, '原世界对象原样返回');
    assert.equal(GOLDEN.meta.tick, 0);
    assert.ok(r.stage.warnings.some((x) => x.includes('未知实体')));
});

test('结算：薄裁定硬边界（属性越界钳制 + 警告）', () => {
    const step = validStep();
    step.stateChanges = [{ entity: 'e_merchant', attr: 'network', delta: 10, cause: 'a_1' }];
    const r = settleTick({ ssot: GOLDEN, step });
    assert.equal(r.ok, true);
    assert.equal(r.ssot.entities[0].attrs.network, 1.0, '钳到上界');
    assert.ok(r.stage.warnings.some((x) => x.includes('属性硬边界')));
});

test('结算：盘算满步强制结算（终结产果）', () => {
    const step = validStep();
    step.agendaAdvances = [1, 2, 3].map((n) => ({ agendaId: 'a_1', step: `推进 ${n}`, stage: `阶段${n}` }));
    const r = settleTick({ ssot: GOLDEN, step });
    assert.equal(r.ok, true);
    const a = r.ssot.agendas[0];
    assert.equal(a.progress, 4, 'maxSteps 达到');
    assert.equal(a.closed, true, '满步置关闭');
    assert.ok(r.ssot.chronicle.some((c) => c.id === 'ch_1_fin_a_1'), '终结产果入编年');
});

test('结算：行动↔盘算一致性烟雾报警（无在飞盘算仍行动）', () => {
    const step = {
        actions: [{ entity: 'e_lone', verb: '动手', position: '孤岛' }],
        newEvents: [],
        agendaAdvances: [],
        stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = settleTick({ ssot: loneWorld(), step });
    assert.equal(r.ok, true);
    assert.ok(r.stage.warnings.some((x) => x.includes('行动↔盘算不一致')), r.stage.warnings.join('; '));
});

test('结算：ripple 事件上游指针挂链', () => {
    const world = loneWorld();
    const step = {
        actions: [],
        newEvents: [{ title: '旧事发酵', source: { type: 'ripple', ref: 'ev_old' }, position: '孤岛', ripples: ['e_lone'] }],
        agendaAdvances: [],
        stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = settleTick({ ssot: world, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.deepEqual(r.ssot.events.find((e) => e.id === 'ev_4_1').links.up, ['ev_old'], '因果指针入 links.up');
    assert.ok(r.ssot.chronicle.some((c) => c.text.includes('沿「旧事」而来')), '编年可见因果（上游事件写标题）');
    assert.ok(!r.ssot.chronicle.some((c) => /ev_[a-z0-9_]+/.test(c.text)), '事件代号绝不入编年文本（第十三棒：A-3 玩家视线）');
});

test('结算：已结算盘算的推进被拦截（满步重播 bug 回归）', () => {
    // 先跑到 closed
    const step1 = validStep();
    step1.agendaAdvances = [1, 2, 3].map((n) => ({ agendaId: 'a_1', step: `推进 ${n}` }));
    const w1 = settleTick({ ssot: GOLDEN, step: step1 }).ssot;
    assert.equal(w1.agendas[0].closed, true);

    // 已结算后再推进 → 警告 + 进度不动 + 不重唱"达成"
    const step2 = validStep();
    step2.agendaAdvances = [{ agendaId: 'a_1', step: '死人推进' }];
    const r = settleTick({ ssot: w1, step: step2 });
    assert.equal(r.ok, true);
    assert.equal(r.ssot.agendas[0].progress, 4, '进度不再增长');
    assert.ok(r.stage.warnings.some((x) => x.includes('盘算推进被拒')), r.stage.warnings.join('; '));
    const finCount = r.ssot.chronicle.filter((c) => c.id === 'ch_2_fin_a_1').length;
    assert.equal(finCount, 0, '不再重唱满步结算');
});

// ---------- 玩家档案 K9：影响通道（引擎独占写玩家，玩家档案细案 §3.3 → P-3） ----------

const PW = JSON.parse(readFileSync(new URL('./fixtures/player-world.json', import.meta.url), 'utf8'));

const pwWorld = (weights) => {
    const w = structuredClone(PW);
    Object.assign(w.weights, weights);
    return w;
};
const targetStep = (target) => ({
    actions: [{ entity: 'e_xie', verb: '发兵', target, position: '大盘谷' }],
    newEvents: [], agendaAdvances: [], stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
});

test('K9（片3 改写）：玩家被 targeting → 影响通道按**固定系数**落账 + simLog 审计（不再按分量比折减）', () => {
    const r = settleTick({ ssot: pwWorld({ e_xie: 0.9, e_player: 0.2397 }), step: targetStep('e_player') });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const hp = r.ssot.entities.find((e) => e.id === 'e_player').attrs.hardPower;
    assert.ok(Math.abs(hp - 0.2) < 1e-12, `0.25 − 0.05 = 0.20，实际 ${hp}`);
    const pa = r.ssot.meta.simLog[0].playerAffected;
    assert.equal(pa.length, 1);
    assert.equal(pa[0].tick, 1);
    assert.equal(pa[0].source, 'e_xie');
    assert.equal(pa[0].attr, 'hardPower');
    assert.ok(Math.abs(pa[0].delta - -0.05) < 1e-9, `delta 容差，实际 ${pa[0].delta}`);
    assert.equal(pa[0].ratio, undefined, 'ratio 字段随分量退场（审计不再记那个数）');
});

test('K9（片3 改写）：源的分量高低不再改变影响幅度——弱源打强玩家也照章扣', () => {
    const weak = settleTick({ ssot: pwWorld({ e_xie: 0.1, e_player: 0.8 }), step: targetStep('e_player') });
    assert.equal(weak.ok, true, weak.stage.warnings.join('; '));
    const hp = weak.ssot.entities.find((e) => e.id === 'e_player').attrs.hardPower;
    assert.ok(Math.abs(hp - 0.2) < 1e-12, `旧法 0.25 − 0.05×(0.1/0.8) = 0.24375；现法固定系数 → 0.20，实际 ${hp}`);
});

test('K9：事件波及玩家（plot 源）→ 各 attrs 受影响 + 审计四笔', () => {
    const step = {
        actions: [],
        newEvents: [{ title: '围剿黄府', source: { type: 'plot', ref: 'a_xie' }, position: '黄府', ripples: ['e_player'] }],
        agendaAdvances: [], stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = settleTick({ ssot: pwWorld({ e_xie: 0.9, e_player: 0.2397 }), step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const p = r.ssot.entities.find((e) => e.id === 'e_player');
    assert.ok(Math.abs(p.attrs.hardPower - 0.23) < 1e-12, 'hardPower −0.02');
    assert.ok(Math.abs(p.attrs.office - 0.03) < 1e-12, 'office −0.02');
    assert.ok(Math.abs(p.attrs.network - 0.28) < 1e-12, 'network −0.02');
    assert.ok(Math.abs(p.attrs.intel - 0.38) < 1e-12, 'intel −0.02');
    const pa = r.ssot.meta.simLog[0].playerAffected;
    assert.equal(pa.length, 4);
    assert.ok(pa.every((x) => Math.abs(x.delta - -0.02) < 1e-9), JSON.stringify(pa));
});

test('K9：state 源波及 → 世界大势常量（source=world）', () => {
    const step = {
        actions: [],
        newEvents: [{ title: '天雷动', source: { type: 'state' }, position: '黄府', ripples: ['e_player'] }],
        agendaAdvances: [], stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = settleTick({ ssot: pwWorld({ e_player: 0.2397 }), step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const hp = r.ssot.entities.find((e) => e.id === 'e_player').attrs.hardPower;
    assert.ok(Math.abs(hp - 0.23) < 1e-12, '世界大势 → −0.02');
    assert.equal(r.ssot.meta.simLog[0].playerAffected[0].source, 'world');
});

test('K9：ripple 波及沿链上溯到 plot 属主（来源归属不变）', () => {
    const w = pwWorld({ e_xie: 0.9, e_player: 0.2397 });
    w.events.push({ id: 'ev_up', title: '兵变', source: { type: 'plot', ref: 'a_xie' }, position: '大盘谷', ripples: [], links: { up: [], down: [] }, closed: false });
    const step = {
        actions: [],
        newEvents: [{ title: '兵变波及黄府', source: { type: 'ripple', ref: 'ev_up' }, position: '黄府', ripples: ['e_player'] }],
        agendaAdvances: [], stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = settleTick({ ssot: w, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const hp = r.ssot.entities.find((e) => e.id === 'e_player').attrs.hardPower;
    assert.ok(Math.abs(hp - 0.23) < 1e-12, '上溯到 e_xie → 扣 0.02');
    assert.equal(r.ssot.meta.simLog[0].playerAffected[0].source, 'e_xie');
});

test('K9（片3 改写）：分量归零的玩家照常被点名影响（"零分量无所见/不受影响"的对偶已随分数退场）', () => {
    const r = settleTick({ ssot: pwWorld({ e_xie: 0.9, e_player: 0 }), step: targetStep('e_player') });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.ok(Math.abs(r.ssot.entities.find((e) => e.id === 'e_player').attrs.hardPower - 0.2) < 1e-12, '照章扣 0.05');
    assert.equal(r.ssot.meta.simLog[0].playerAffected.length, 1, '审计照记');
});

test('K9：影响通道后世界过 SSOT schema（playerAffected 审计合法）', () => {
    const r = settleTick({ ssot: pwWorld({ e_xie: 0.9, e_player: 0.2397 }), step: targetStep('e_player') });
    const vr = validate(r.ssot, ssotSchema);
    assert.equal(vr.ok, true, vr.errors.join('; '));
});

// ---------- 执行债（2026-09-07 顺手清）：events.closed 关闭路径——终结产果联闭 ----------

test('执行债：源盘算满步结算 → 其 plot 事件闭环 + 观棋留痕（不带 eventRef 不进注入）', () => {
    const w = structuredClone(GOLDEN);
    w.events = [{ id: 'ev_p', title: '边关风波', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: [], links: { up: [], down: [] }, closed: false }];
    const step = validStep();
    step.agendaAdvances = [1, 2, 3].map((n) => ({ agendaId: 'a_1', step: `推进 ${n}` }));
    const r = settleTick({ ssot: w, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.equal(r.ssot.events.find((e) => e.id === 'ev_p').closed, true, '旧事件终结产果联闭');
    assert.equal(r.ssot.events.find((e) => e.id === 'ev_1_1').closed, true, '同 tick 新事件同闭');
    const note = r.ssot.chronicle.find((c) => c.id === 'ch_1_evc_ev_p');
    assert.ok(note && !note.eventRef, '闭环留痕在观棋侧（不带 eventRef → 不进注入）');
    assert.equal(note.chainRef, 'ev_p', '闭环行带 chainRef 链目标（纯链入口数据，注入面不读；第十五棒补）');
    const vr = validate(r.ssot, ssotSchema);
    assert.equal(vr.ok, true, vr.errors.join('; '));
});

test('执行债：state 源事件不随盘算联闭（常驻事件语义保留，e_mid 症状另一面不动）', () => {
    const w = structuredClone(GOLDEN);
    w.events = [
        { id: 'ev_state', title: '常驻风波', source: { type: 'state' }, position: '边关', ripples: [], links: { up: [], down: [] }, closed: false },
        { id: 'ev_p', title: '边关风波', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: [], links: { up: [], down: [] }, closed: false },
    ];
    const step = validStep();
    step.agendaAdvances = [1, 2, 3].map((n) => ({ agendaId: 'a_1', step: `推进 ${n}` }));
    const r = settleTick({ ssot: w, step });
    assert.equal(r.ok, true);
    assert.equal(r.ssot.events.find((e) => e.id === 'ev_state').closed, false, 'state 事件不联闭');
    assert.equal(r.ssot.events.find((e) => e.id === 'ev_p').closed, true);
});

// ---------- K39/编年 kind 章（链视图细案 §3.1 → A-16①：五筛类型章；盘算侧按行主 visibility 定暗、事件侧按 source.type 定类） ----------

test('K39/编年 kind 章：settle 落账全行带 kind + plot 事件行=大事（A-16① 漏章锁）', () => {
    const r = settleTick({ ssot: GOLDEN, step: validStep() });
    assert.equal(r.ok, true);
    const KINDS = new Set(['scheme', 'major', 'ripple', 'shade', 'state']);
    assert.ok(r.stage.chronicle.length >= 2, '有落账行');
    assert.ok(r.stage.chronicle.every((c) => KINDS.has(c.kind)), `全行带 kind: ${JSON.stringify(r.stage.chronicle)}`);
    const adv = r.stage.chronicle.find((c) => c.id === 'ch_1_adv_a_1');
    assert.equal(adv.kind, 'scheme', '推进行=谋划');
    const ev = r.stage.chronicle.find((c) => c.id === 'ch_1_ev_1');
    assert.equal(ev.kind, 'major', 'plot 事件行=大事');
    assert.equal(ev.eventRef, 'ev_1_1', '事件行 eventRef 保持（闭环行不带 eventRef 的注入面语义不被扰动，K39 修正）');
});

test('K39/编年 kind 章：ripple 事件行=牵动（loneWorld 挂链）', () => {
    const world = loneWorld();
    const step = {
        actions: [],
        newEvents: [{ title: '旧事发酵', source: { type: 'ripple', ref: 'ev_old' }, position: '孤岛', ripples: ['e_lone'] }],
        agendaAdvances: [],
        stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = settleTick({ ssot: world, step });
    assert.equal(r.ok, true);
    const ev = r.stage.chronicle.find((c) => c.id === 'ch_4_ev_1');
    assert.equal(ev.kind, 'ripple', 'ripple 事件行=牵动');
});

test('K39/编年 kind 章：concealed 盘算侧行=暗处（终结/取消按行主盘算 visibility 定暗）', () => {
    const w = {
        version: 1,
        context: { world: '夜城', tension: 0.5, positions: ['夜城'] },
        entities: [{ id: 'e_d', kind: 'character', name: '暗子', location: '夜城', attrs: { hardPower: 0.7, network: 0.5 } }],
        weights: { e_d: 0.5 },   // 预热分量（K7 夹具教训：t1 门控跑在真分量重算前，种子权重防误判静默）
        agendas: [{ id: 'a_d', owner: 'e_d', goal: '暗线行动', stage: '谋划', visibility: 'concealed', maxSteps: 2, progress: 0, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } }],
        events: [],
        chronicle: [],
        meta: { tick: 0 },
    };
    // 满步终结（concealed 终结上桌 → kind=shade）
    const step1 = { actions: [], newEvents: [], agendaAdvances: [{ agendaId: 'a_d', step: '推进' }, { agendaId: 'a_d', step: '推进' }], stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] };
    const r1 = settleTick({ ssot: w, step: step1 });
    assert.equal(r1.ok, true);
    assert.equal(r1.ssot.agendas[0].closed, true, '暗盘算满步关闭');
    const fin = r1.stage.chronicle.find((c) => c.id === 'ch_1_fin_a_d');
    assert.equal(fin.kind, 'shade', '暗盘算终结行=暗处');
    // 取消（concealed → shade）
    const w2 = structuredClone(w);
    const step2 = { actions: [], newEvents: [], agendaAdvances: [], stateChanges: [], newAgendas: [], agendaCancels: [{ agendaId: 'a_d', reason: '收线' }], newEntities: [], entityFates: [] };
    const r2 = settleTick({ ssot: w2, step: step2 });
    assert.equal(r2.ok, true);
    const can = r2.stage.chronicle.find((c) => c.id === 'ch_1_can_a_d');
    assert.equal(can.kind, 'shade', '暗盘算取消行=暗处');
});