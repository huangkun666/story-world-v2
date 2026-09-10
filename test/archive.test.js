// story-world-v2/test/archive.test.js
// K20 验收（因果链细案 §3.3 → A-3）：档案摘要化——闭环满热窗（ARCHIVE.hotWindow=20 提案）且无未决下游 →
// 按出生段压入里程碑（引擎结构摘要 T3-D1：span/counts/titles/ids + 指针修复）；未决/年轻/链活着不归档；
// 跨段指针重指里程碑（链条不断）；resolveEventSource 跨段防御；schema + 确定性。
// leg25 c 改写（用户令「删」四维浮点）：夹具实体不再带 `attrs`，世界步不再带 `stateChanges`
//   （契约层整条删除）——归档/指针修复逻辑本身不吃属性，故只删夹具里的死字段，断言一字未改。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleTick, ARCHIVE, resolveEventSource } from '../src/settle.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

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
    events: [],
    chronicle: [],
    meta: { tick: 0 },
});

const empty = () => ({ actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] });
const step = (extra) => ({ ...empty(), ...extra });
const adv = (id) => ({ agendaId: id, step: '推进', stage: '中' });
const ev = (title, source, tickN) => ({ title, source, position: '边城', ripples: ['e_x'] });
const runner = (start) => {
    let world = start;
    return {
        world: () => world,
        run(s) { const r = settleTick({ ssot: world, step: s }); assert.equal(r.ok, true, r.stage.warnings.join('; ')); world = r.ssot; return r; },
        runN(n) { for (let i = 0; i < n; i++) this.run(empty()); },
        find(id) { return world.events.find((e) => e.id === id); },
        m(id) { return (world.milestones || []).find((x) => x.id === id); },
    };
};

test('K20/A-3 热窗与段分组：闭环满 20 tick → 按出生段入里程碑（span/counts/titles/ids 全量保真），年轻闭环不入', () => {
    const w = runner(W());
    w.run(step({ newEvents: [ev('夺关战起', { type: 'plot', ref: 'a_1' })], agendaAdvances: [adv('a_1')] }));      // t1
    w.run(step({ newEvents: [ev('敌援东来', { type: 'ripple', ref: 'ev_1_1' })], agendaAdvances: [adv('a_1')] }));  // t2：A 源结清
    w.runN(3);    // t3-5：B 于 t8 平息前（born2，窗 5）——B 仍年轻未满热窗
    w.runN(14);   // t6-19
    assert.equal(w.find('ev_1_1').closedAt, 2, 'A 闭环');
    assert.ok(w.find('ev_1_1') && w.find('ev_2_1'), 't19：热窗未满（2+20>19 / 8+20>19）→ 均在热池');
    w.run(empty());   // t20：A age 18、B age 12 → 仍未满窗
    assert.ok(w.find('ev_1_1'), 't20 仍不归档（age 18 < 20）');
    assert.ok(!w.m('m_10'), '无里程碑');
    w.runN(2);   // t21-22：A age 20 → 归档段 0（t1-10）
    assert.equal(w.find('ev_1_1'), undefined, 'A 出热池');
    assert.equal(w.m('m_10').counts.events, 1, 'm_10 含 1 事件');
    assert.deepEqual(w.m('m_10').ids, ['ev_1_1'], 'ids 保真（任取可回溯）');
    assert.deepEqual(w.m('m_10').titles, ['夺关战起'], 'titles 保真（结构摘要）');
    assert.deepEqual(w.m('m_10').span, { from: 1, to: 10 }, '段跨度 t1-10');
    assert.ok(w.find('ev_2_1'), 'B 年轻（closedAt 8 → t28 才到期）→ 仍在热池');
});

test('K20/A-3 链活着不归档：未决下游持续保护（涟漪延伸链），链收敛后立即归档', () => {
    const w = runner(W());
    w.run(step({ newEvents: [ev('夺关战起', { type: 'plot', ref: 'a_1' })], agendaAdvances: [adv('a_1')] }));       // t1
    w.run(step({ agendaAdvances: [adv('a_1')] }));                                                                  // t2：A 闭环
    w.run(step({ newEvents: [ev('敌援东来', { type: 'ripple', ref: 'ev_1_1' }) ] }));                               // t3：R1（ev_3_1）
    w.runN(3);   // t4-6
    w.run(step({ newEvents: [ev('敌援诱伏', { type: 'ripple', ref: 'ev_3_1' }) ] }));                               // t7：R2（ev_7_1）
    w.runN(3);   // t8-10
    w.run(step({ newEvents: [ev('伏兵反围', { type: 'ripple', ref: 'ev_7_1' }) ] }));                                // t11：R3（ev_11_1）
    w.runN(4);   // t12-15
    w.run(step({ newEvents: [ev('围势既成', { type: 'ripple', ref: 'ev_11_1' }) ] }));                               // t16：R4（ev_16_1）
    w.runN(6);   // t17-22：A 已满热窗（2+20=22）但 R1 未决 → 保护
    assert.ok(w.find('ev_1_1'), 't22：链活着（R1 未决下游）→ A 不归档');
    w.run(empty());   // t23：R1 前 tick（t22）才随链收敛 —— 本 tick R1 尚未平息（R2 同 tick 先闭，顺序保护）
    assert.ok(w.find('ev_1_1'), 't23：R1 仍未决 → 保护持续');
    w.run(empty());   // t24：R1 平息 → A 无未决下游 → 归档（链尾循环先于归档，同 tick 归位）
    assert.equal(w.find('ev_1_1'), undefined, 't24：链收敛 → A 归档');
    assert.ok(w.m('m_10') && w.m('m_10').ids.includes('ev_1_1'), 'A 在里程碑 m_10');
});

test('K20/A-3 跨段指针修复 + 解析防御：段外 up 重指里程碑；m.links.down 记引用方；未决链不受影响', () => {
    const w = runner(W());
    w.run(step({ newEvents: [ev('夺关战起', { type: 'plot', ref: 'a_1' })], agendaAdvances: [adv('a_1')] }));       // t1
    w.run(step({ agendaAdvances: [adv('a_1')] }));                                                                  // t2：A 闭
    w.run(step({ newEvents: [ev('隔岸闻信', { type: 'ripple', ref: 'ev_1_1' }) ] }));                                // t3：R（born 段 0）
    w.runN(4);   // t4-7（R 窗未满）
    w.run(empty());   // t8：R 平息（born3 + 5）
    w.runN(14);  // t9-22：A age 20 → 归档段 0；R 的 up 修复 → m_10
    assert.equal(w.find('ev_1_1'), undefined, 'A 已归档');
    const m10 = w.m('m_10');
    assert.ok(m10, 'm_10 存在');
    assert.equal(w.find('ev_3_1').links.up[0], 'm_10', '段外遗留事件 up 重指里程碑（链条不断）');
    assert.deepEqual(m10.links.down, ['ev_3_1'], 'm.links.down 记引用方');
    // 解析防御：引已归档事件的未决/遗留节点 → 沿里程碑兜底（无 source 的里程碑 → 默认 world/0，不抛）
    const r = resolveEventSource({ world: w.world(), ev: { source: { type: 'ripple', ref: 'ev_1_1' } }, weights: { e_x: 0.9 } });
    assert.deepEqual(r, { source: 'world', weight: 0 }, '跨段兜底：安全返回，不抛不悬');
    // 未决事件链不受归档影响（pack 侧不喂里程碑——另行验证于冒烟）
    const pending = w.world().events.filter((e) => !e.closed);
    assert.ok(pending.every((e) => (e.links?.up || []).every((u) => !u.startsWith('m_') || w.m(u))), '未决链上溯指针全部可解析');
});

test('K20：归档后世界过 SSOT schema（milestones 形状合法）；确定性逐字节', () => {
    const runAll = (start) => {
        const w = runner(start);
        w.run(step({ newEvents: [ev('A', { type: 'plot', ref: 'a_1' })], agendaAdvances: [adv('a_1')] }));
        w.run(step({ newEvents: [ev('B', { type: 'ripple', ref: 'ev_1_1' })], agendaAdvances: [adv('a_1')] }));
        w.runN(24);   // t3-26：B 平息 + A 归档
        return w.world();
    };
    const a = runAll(W());
    const b = runAll(W());
    assert.equal(JSON.stringify(a), JSON.stringify(b), '确定性逐字节');
    const vr = validate(a, ssotSchema);
    assert.equal(vr.ok, true, `milestones/closedAt 过 schema: ${vr.errors.join('; ')}`);
    assert.ok((a.milestones || []).length >= 1, '里程碑已产生');
    assert.equal(ARCHIVE.hotWindow, 20, '热窗常量（提案态）');
    assert.equal(ARCHIVE.milestoneEvery, 10, '里程碑粒度（提案态）');
});