// story-world-v2/test/entropy.test.js
// K27/设定大势层：熵泵摩擦制造（细案 §3.5 → A-6）——环境推演器每 ENV_TICK 一步、越阈落状态源事件、
// 恢复闭环可再发、同种未决不重复、无设定池世界零扰动、事件可作盘算挂因。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleTick } from '../src/settle.js';
import { checkWorldStep } from '../src/check-step.js';
import { ENV_TICK } from '../src/entropy.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

const world = () => ({
    version: 1,
    context: {
        world: '临渊城',
        tension: 0.5,
        positions: ['临渊城'],
        setting: {
            frozen: { fingerprint: 'f1', extractedAt: 't', canon: { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [] } },
            dynamic: {
                tension: { polarity: '宗门/朝廷', intensity: 0.5 },
                env: { '民生度': 0.5, '动乱度': 0.5, '天时': 0.5, '张力推手': 0.5 },
            },
        },
    },
    entities: [
        { id: 'e1', kind: 'faction', name: '大虞', location: '临渊城', attrs: { hardPower: 0.5, office: 0.5, network: 0.5, intel: 0.5 } },
        { id: 'e2', kind: 'character', name: '薛铁衣', location: '临渊城', attrs: { hardPower: 0.3, office: 0.2, network: 0.4, intel: 0.4 } },
    ],
    weights: {},
    agendas: [],
    events: [],
    chronicle: [],
    meta: { tick: 0 },
});

const emptyStep = () => ({ actions: [], newEvents: [], agendaAdvances: [], stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] });

const run = (w, ticks) => {
    let s = w;
    for (let t = 0; t < ticks; t += 1) s = settleTick({ ssot: s, step: emptyStep() }).ssot;
    return s;
};
const pumpEvents = (w) => (w.events || []).filter((e) => e.id.startsWith('ev_pump_'));
const envOf = (w, key) => w.context.setting.dynamic.env[key];

test('K27/A-6：每 ENV_TICK 一步——t1-t2 环境不动、t3 起按锯齿表推（民生度 0.44）且确定性逐字节', () => {
    const a = run(world(), 2);
    assert.equal(envOf(a, '民生度'), 0.5, 't2 前不推');
    const b = run(a, 1);   // t3
    assert.equal(envOf(b, '民生度'), 0.44);
    assert.equal(envOf(b, '动乱度'), 0.56);
    assert.equal(envOf(b, '天时'), 0.44);
    assert.equal(envOf(b, '张力推手'), 0.56);
    const c = run(world(), 3);
    assert.equal(JSON.stringify(b), JSON.stringify(c), '同输入多走一遍逐字节一致');
});

test('K27/A-6：越阈落熵泵事件——t15 四键齐发（ev_pump_15_1..4、source.state、编年可见、过 schema）', () => {
    const w = run(world(), 15);
    const evs = pumpEvents(w);
    assert.equal(evs.length, 4);
    assert.deepEqual(evs.map((e) => e.id), ['ev_pump_15_1', 'ev_pump_15_2', 'ev_pump_15_3', 'ev_pump_15_4']);
    assert.ok(evs.every((e) => e.source.type === 'state' && !e.closed && e.position === '临渊城'));
    assert.deepEqual(evs.map((e) => e.title), [
        '熵泵·民生凋敝：劳役征发四起',
        '熵泵·动乱四起：匪患横行',
        '熵泵·天时不作美：旱涝连年',
        '熵泵·大势紧绷：各方异动',
    ]);
    const fired = w.chronicle.filter((c) => c.text.includes('环境量越阈'));
    assert.equal(fired.length, 4, '编年可见（越阈上桌条目）');
    assert.ok(fired.every((c) => c.kind === 'state'), '熵泵事件行盖 state 章（K39）');
    const r = validate(w, ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
});

test('K27/A-6：同种未决不重复落——带内不刷屏（t18 天时 0.14 仍在危险带，不重发）', () => {
    const w = run(world(), 18);
    assert.equal(pumpEvents(w).length, 4, '带内未决不重复落');
    assert.equal(envOf(w, '民生度'), 0.26, '民生已回升出带（锯齿回升段）');
    assert.equal(envOf(w, '天时'), 0.14, '天时仍在危险带内');
});

test('K27/A-6：恢复闭环——张力推手 t21、民生度/动乱度 t24、天时 t27 依次缓和（closedAt 落账）', () => {
    const w = run(world(), 33);
    const evs = pumpEvents(w);
    assert.equal(evs.length, 4, '热窗内闭环不删事件（节点保留）');
    assert.equal(evs.filter((e) => e.closed).length, 4, '四种全部缓和');
    const closes = w.chronicle.filter((c) => c.text.includes('缓和'));
    assert.equal(closes.length, 4);
    assert.ok(closes.every((c) => c.kind === 'state'), '缓和行盖 state 章（K39）');
    const byKind = Object.fromEntries(evs.map((e) => [e.title.slice(3, e.title.indexOf('：')), e]));
    assert.equal(byKind['大势紧绷'].closedAt, 21);
    assert.equal(byKind['民生凋敝'].closedAt, 24);
    assert.equal(byKind['动乱四起'].closedAt, 24);
    assert.equal(byKind['天时不作美'].closedAt, 27);
});

test('K27/A-6：闭环后可再发（泵的节奏）——t45 民生/动乱/张力齐发、t51 天时二发；旧闭环事件满热窗归档', () => {
    const w = run(world(), 51);
    const evs = pumpEvents(w);
    // 首轮 4 条已全部闭环，其中 3 条（t21/t24 闭环）满热窗归档；二发 t45 三条 + t51 天时一条
    assert.deepEqual(evs.filter((e) => e.id.startsWith('ev_pump_45_')).map((e) => e.id), ['ev_pump_45_1', 'ev_pump_45_2', 'ev_pump_45_3'], 't45 民生/动乱/张力二发');
    assert.deepEqual(evs.filter((e) => e.id.startsWith('ev_pump_51_')).map((e) => e.id), ['ev_pump_51_1'], 't51 天时二发');
    const archivedIds = (w.milestones || []).flatMap((m) => m.ids);
    assert.ok(['ev_pump_15_1', 'ev_pump_15_2', 'ev_pump_15_3', 'ev_pump_15_4'].every((id) => archivedIds.includes(id)), '首轮四条闭环熵泵事件满热窗全部归档承接（链条不断）');
    const r = validate(w, ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
});

test('K27/A-6：熵泵事件可作盘算挂因（未决即合法；闭环后拒绝）', () => {
    const w15 = run(world(), 15);
    const step = emptyStep();
    step.newAgendas = [{ entity: 'e1', goal: '收拾民生凋敝', visibility: 'known', source: { type: 'event', ref: 'ev_pump_15_1' } }];
    assert.equal(checkWorldStep(step, w15).ok, true, '未决熵泵事件挂因合法');
    const w27 = run(world(), 27);
    assert.equal(checkWorldStep(step, w27).ok, false, '闭环后挂因被拒（因果正确：已了结的事件不是驱动马达）');
});

test('K27/A-6：无设定池世界零扰动（旁观/旧世界语义不破）', () => {
    const w = world();
    delete w.context.setting;
    const r = run(w, 30);
    assert.equal(r.context.setting, undefined, '不产生设定池');
    assert.equal(r.events.length, 0);
    assert.equal(ENV_TICK, 3);
});