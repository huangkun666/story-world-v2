// story-world-v2/test/event-close.test.js
// K19 验收（因果链细案 §3.1/§3.2 → A-1/A-2）：事件闭环三型——源结清（K9 保真）/ 链尾结清（ripple 链头了结 +
// 涟漪平息窗 CHAIN_SETTLE=5 提案 + 无未决下游）/ 常驻保留（state 永不自动闭环）+ 事件产率上限
// （EVENT_CAPS.perTick=6 提案，超限拒建 + 洪峰警告，双面无痕于世界）。曲线支撑：细案 §1（max 4/稳态 1）。
// leg25 c 改写（用户令「删」四维浮点）：夹具实体不再带 `attrs`，世界步不再带 `stateChanges`
//   （契约层整条删除）——闭环逻辑本身不吃属性，故只删夹具里的死字段，断言一字未改。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleTick, EVENT_CAPS, CHAIN_SETTLE } from '../src/settle.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

// 单势力世界：两盘算（a_1 短链源 / a_2 在飞链头）+ state 常驻事件 ev_s（常驻保留样本）
const W = () => ({
    version: 1,
    context: { world: '边地', tension: 0.5, positions: ['边城', '大营'] },
    entities: [
        { id: 'e_x', kind: 'faction', name: '边军', location: '边城' },
    ],
    weights: {},
    agendas: [
        { id: 'a_1', owner: 'e_x', goal: '夺关', stage: '谋划', visibility: 'known', maxSteps: 2, progress: 0, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } },
        { id: 'a_2', owner: 'e_x', goal: '后援', stage: '谋划', visibility: 'known', maxSteps: 4, progress: 0, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } },
    ],
    events: [
        { id: 'ev_s', title: '疫起', source: { type: 'state' }, position: '边城', ripples: [], links: { up: [], down: [] } },
    ],
    chronicle: [],
    meta: { tick: 0 },
});

const empty = () => ({ actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] });
const step = (extra) => ({ ...empty(), ...extra });
const adv = (id) => ({ agendaId: id, step: '推进', stage: '中' });

test('K19/A-1 链尾结清：plot 链头终结 → 涟漪窗满 + 无未决下游 → 逐段平息（编年措辞精确 + closedAt 写）', () => {
    let world = W();
    const run = (s) => { const r = settleTick({ ssot: world, step: s }); assert.equal(r.ok, true, r.stage.warnings.join('; ')); world = r.ssot; };
    // 链：A(plot a_1) → B(ripple A) → C(ripple B)
    run(step({ newEvents: [{ title: '夺关战起', source: { type: 'plot', ref: 'a_1' }, position: '边城', ripples: ['e_x'] }], agendaAdvances: [adv('a_1')] }));        // t1
    run(step({ newEvents: [{ title: '敌援东来', source: { type: 'ripple', ref: 'ev_1_1' }, position: '边城', ripples: ['e_x'] }], agendaAdvances: [adv('a_1')] }));  // t2：a_1 满步达成 → A 源结清
    run(step({ newEvents: [{ title: '敌援诱伏', source: { type: 'ripple', ref: 'ev_2_1' }, position: '边城', ripples: ['e_x'] }] }));                                 // t3
    for (let i = 4; i <= 7; i++) run(empty());   // t4-7：C 窗未满（born3）+ B 有未决下游 C → 均不平息
    run(empty());                                 // t8：C 窗满（8-3≥5）+ 无下游 → 平息；B 仍有未决下游 C → 不平息
    const ev = (id) => world.events.find((e) => e.id === id);
    assert.equal(ev('ev_1_1').closed, true);
    assert.equal(ev('ev_1_1').closedAt, 2, '源结清写 closedAt（归档判龄）');
    assert.equal(ev('ev_2_1').closed, false, 't8 时 B 有未决下游 → 不平息');
    assert.equal(ev('ev_3_1').closed, true, 't8 C 平息');
    assert.equal(ev('ev_3_1').closedAt, 8);
    run(empty());                                 // t9：B 平息（C 已闭，9-2≥5）
    assert.equal(ev('ev_2_1').closed, true, 't9 B 平息（下游已结，链尾逐段收敛）');
    assert.equal(ev('ev_2_1').closedAt, 9);
    const ripples = world.chronicle.filter((c) => c.text.includes('涟漪平息'));
    assert.equal(ripples.length, 2, '涟漪平息编年 2 条');
    assert.ok(ripples.every((c) => c.text.includes('链源已了结')), '措辞精确');
    assert.equal(world.chronicle.filter((c) => c.text.includes('闭环（源盘算已结算）')).length, 1, 'A 源结清 1 条');
    assert.ok(!world.events.find((e) => e.id === 'ev_s').closed, 'state 常驻不动（未闭环）');
});

test('K19/A-1：在飞链头不平息（源盘算未了结，窗满也不结）；state 链头波纹正常平息、常驻本身保留', () => {
    let world = W();
    const run = (s) => { const r = settleTick({ ssot: world, step: s }); assert.equal(r.ok, true, r.stage.warnings.join('; ')); world = r.ssot; };
    run(step({ newEvents: [{ title: '后援调度', source: { type: 'plot', ref: 'a_2' }, position: '大营', ripples: ['e_x'] }], agendaAdvances: [adv('a_2')] }));   // t1
    run(step({ newEvents: [{ title: '粮道被扰', source: { type: 'ripple', ref: 'ev_1_1' }, position: '大营', ripples: ['e_x'] }] }));                        // t2
    run(step({ newEvents: [{ title: '疫行村野', source: { type: 'ripple', ref: 'ev_s' }, position: '边城', ripples: ['e_x'] }] }));                          // t3（state 链头）
    for (let i = 4; i <= 17; i++) run(empty());   // t4-17
    const ev = (id) => world.events.find((e) => e.id === id);
    assert.equal(ev('ev_1_1').closed, false, '在飞链头（a_2 未结）→ plot 链不平息；窗早已满');
    assert.equal(ev('ev_1_1').closedAt, undefined, '未结无 closedAt');
    assert.equal(ev('ev_3_1').closed, true, 'state 链头波纹 t8 起平息（窗满 + 无下游）');
    assert.ok(!ev('ev_s').closed, '常驻保留：state 源永不自动闭环');
    assert.ok(world.chronicle.filter((c) => c.text.includes('涟漪平息')).length === 1, '恰 1 条平息（波纹）');
    // 链头补结 → 波纹随结清
    run(step({ agendaAdvances: [adv('a_2')] })); run(step({ agendaAdvances: [adv('a_2')] })); run(step({ agendaAdvances: [adv('a_2')] }));   // t18-20：a_2 满步达成
    assert.equal(ev('ev_1_1').closed, true, '链头了结 → 窗满 + 无下游 → 波纹平息');
    assert.equal(ev('ev_1_1').closedAt, 20);
});

test('K19/A-2 事件产率上限：7 连提 → 6 落 1 拒 + 洪峰警告，被拒不挂链不编年（双面无痕于世界）', () => {
    let world = W();
    const r = settleTick({ ssot: world, step: step({ newEvents: [
        { title: '厢务1', source: { type: 'state' }, position: '边城', ripples: [] },
        { title: '厢务2', source: { type: 'state' }, position: '边城', ripples: [] },
        { title: '厢务3', source: { type: 'state' }, position: '边城', ripples: [] },
        { title: '厢务4', source: { type: 'state' }, position: '边城', ripples: [] },
        { title: '厢务5', source: { type: 'state' }, position: '边城', ripples: [] },
        { title: '厢务6', source: { type: 'state' }, position: '边城', ripples: [] },
        { title: '厢务7', source: { type: 'state' }, position: '边城', ripples: [] },
    ] }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.equal(r.stage.warnings.filter((x) => x.includes('事件洪峰')).length, 1, '洪峰警告恰 1 条');
    assert.ok(r.stage.warnings[0].includes(`每 tick ≤${EVENT_CAPS.perTick}`) && r.stage.warnings[0].includes('厢务7'), r.stage.warnings[0]);
    const w = r.ssot;
    assert.equal(w.events.filter((e) => e.id.startsWith('ev_1_')).length, EVENT_CAPS.perTick, '恰 ≤6 条落账');
    assert.ok(!w.events.some((e) => e.title === '厢务7'), '第 7 条不挂链');
    assert.ok(!w.chronicle.some((c) => c.text.includes('厢务7')), '被拒不编年');
    assert.ok(w.chronicle.filter((c) => c.text.includes('事件「厢务')).length === EVENT_CAPS.perTick, '仅落账事件入编年');
    assert.equal(w.meta.tick, 1);
});

test('K19：闭环写 closedAt 后世界过 SSOT schema（closedAt/milestones 可选字段合法）；确定性', () => {
    const runAll = (start) => {
        let world = start;
        for (const s of [
            step({ newEvents: [{ title: 'A', source: { type: 'plot', ref: 'a_1' }, position: '边城', ripples: ['e_x'] }], agendaAdvances: [adv('a_1')] }),
            step({ newEvents: [{ title: 'B', source: { type: 'ripple', ref: 'ev_1_1' }, position: '边城', ripples: ['e_x'] }], agendaAdvances: [adv('a_1')] }),
            step({ newEvents: [{ title: 'C', source: { type: 'ripple', ref: 'ev_2_1' }, position: '边城', ripples: ['e_x'] }] }),
            empty(), empty(), empty(), empty(), empty(),
        ]) {
            const r = settleTick({ ssot: world, step: s });
            assert.equal(r.ok, true, r.stage.warnings.join('; '));
            world = r.ssot;
        }
        return world;
    };
    const a = runAll(W());
    const b = runAll(W());
    assert.equal(JSON.stringify(a), JSON.stringify(b), '确定性逐字节');
    const vr = validate(a, ssotSchema);
    assert.equal(vr.ok, true, `closedAt/milestones 过 schema: ${vr.errors.join('; ')}`);
    assert.equal(CHAIN_SETTLE, 5, '涟漪平息窗常量在案（提案态）');
});