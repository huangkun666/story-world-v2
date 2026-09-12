// story-world-v2/test/entropy.test.js
// leg26 重写：熵泵**改定义**（用户令「熵泵又不用全删，删掉没用的功能不就行了，改个定义就好了」）。
//   删掉的：四个 0~1 环境量（锯齿推演 + 危险带/回缓带）与**四句写死的事件台词**——那是引擎替世界宣布事实。
//   留下的：**每 ENTROPY_TICK 一拍**（不看模型脸色）+ **到点出声 / 世界动了收声**的循环
//           （它是全引擎**唯一会自己闭环**的事件）。
//   新定义：触发面 = **账本自己能证明的结构事实**（连续 QUIET_WINDOW 轮没有真实事件上桌）。
// 本文件锁的判据（对抗式，不问"我以为对的地方"）：
//   Q1 静默到点才出声（不早、不晚、只说真话）｜Q2 世界一动就收声、且不再重复出声
//   Q3 熵泵自己不把自己哄睡（它自己的事件不算"世界动了"）｜Q4 无设定池世界零扰动
//   Q5 落账形状过 schema、可作盘算挂因、闭环后不可挂因
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleTick } from '../src/settle.js';
import { checkWorldStep } from '../src/check-step.js';
import { ENTROPY_TICK, QUIET_WINDOW, lastRealEventTick } from '../src/entropy.js';
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
            // leg26：`dynamic.env` 是**参数档位**（人话原话，玩家可选），不再是四个数
            dynamic: {
                tension: { polarity: '宗门/朝廷', intensity: 0.5 },
                env: { 民生度: '尚可', 动乱度: '动荡' },
            },
        },
    },
    entities: [
        { id: 'e1', kind: 'faction', name: '大虞', location: '临渊城' },
        { id: 'e2', kind: 'character', name: '薛铁衣', location: '临渊城' },
    ],
    weights: {},
    agendas: [],
    events: [],
    chronicle: [],
    meta: { tick: 0 },
});

const emptyStep = () => ({ actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] });
const pumpEvents = (w) => (w.events || []).filter((e) => String(e.id).startsWith('ev_pump_'));
const openPumps = (w) => pumpEvents(w).filter((e) => !e.closed);

// 走 ticks 轮；extra 可注入每轮的世界步（用来制造真实事件/盘算）
const run = (w, ticks, extra = null) => {
    let s = w;
    for (let t = 0; t < ticks; t += 1) {
        const step = emptyStep();
        if (extra) Object.assign(step, typeof extra === 'function' ? extra(s) : extra);
        s = settleTick({ ssot: s, step }).ssot;
    }
    return s;
};

test('Q1：静默到点才出声——静默窗满了才报，且只在泵的检查点上出声；标题说的是账上算得出来的事实', () => {
    const early = run(world(), QUIET_WINDOW - 1);   // 走到 t9：静默还没满窗（9 < 10）
    assert.equal(pumpEvents(early).length, 0, '未满静默窗不出声');
    assert.equal(openPumps(early).length, 0);

    // 走到 t12：静默窗在 t10 满足，泵下一个检查点（3 的倍数）= t12 出声
    const w = run(world(), QUIET_WINDOW + 2);
    const evs = pumpEvents(w);
    assert.equal(evs.length, 1, '到点出声，且只有一条（同种未决不重复落）');
    assert.equal(evs[0].id, 'ev_pump_12_1');
    assert.equal(evs[0].title, '天下安稳：已 12 轮无新事上桌', '★标题必须能由账算出来（人可复核）');
    assert.equal(evs[0].source.type, 'state');
    assert.equal(evs[0].position, '临渊城');
    assert.equal(evs[0].closed, false);
    const fired = w.chronicle.filter((c) => c.text.includes('世界静默，处境上桌'));
    assert.equal(fired.length, 1, '编年可见');
    assert.ok(fired.every((c) => c.kind === 'state'));
    assert.equal(validate(w, ssotSchema).ok, true);
});

test('Q2：世界一动就收声——真实事件上桌后熵泵事件自闭环，且不会立刻再出声', () => {
    const quiet = run(world(), QUIET_WINDOW + 2);    // t12：一条未决熵泵事件
    assert.equal(openPumps(quiet).length, 1);
    // t13 落一条真实事件（模型提的 state 源事件）
    const moved = run(quiet, 1, { newEvents: [{ title: '北山隘口被袭', source: { type: 'state' }, position: '临渊城', ripples: [] }] });
    assert.equal(lastRealEventTick(moved), 13, '真实事件出生轮被认出（熵泵自己的不算）');
    const w15 = run(moved, 2);                       // t15（3 的倍数，泵才检查）
    assert.equal(openPumps(w15).length, 0, '★世界动了 ⇒ 收声（自闭环）');
    assert.equal(pumpEvents(w15).length, 1, '热窗内不清节点——只标 closed');
    assert.equal(pumpEvents(w15)[0].closedAt, 15);
    assert.equal(w15.chronicle.filter((c) => c.text.includes('天下已不安静')).length, 1, '收声留痕');
});

test('Q3：熵泵不把自己哄睡——它自己的事件不算"世界动了"（否则会永远不静默）', () => {
    const w = run(world(), 40);   // 全程无真实事件
    assert.equal(lastRealEventTick(w), -Infinity, '没有真实事件 ⇒ 无出生轮');
    const evs = pumpEvents(w);
    assert.equal(evs.length, 1, '★只出声一次：出声后世界依然静默，条件仍成立，但同种未决不重复落');
    assert.equal(evs[0].closed, false, '没有新的真实事件 ⇒ 不安稳期不收声');
    assert.equal(evs[0].title, '天下安稳：已 12 轮无新事上桌', '标题是**出声那一刻**的读数（12 轮无新事），不是"现在多少轮"');
    assert.equal(evs[0].id, 'ev_pump_12_1', '声只出一次（它自己的事件不算"世界动了"）');
});

test('Q2b：收声后必须等**新的**真实事件才能再收声——不能靠旧事件自循环', () => {
    // t12 出声 → t13 真实事件 → t15 收声；此后又静默，走到 t24 才可能再出声
    let w = run(world(), QUIET_WINDOW + 2);          // t12 出声
    w = run(w, 1, { newEvents: [{ title: '事一', source: { type: 'state' }, position: '临渊城', ripples: [] }] });
    w = run(w, 8);                                   // 到 t21：距 t13 只有 8 轮 → 还不到窗
    assert.equal(pumpEvents(w).length, 1, '还没到"距上次真实事件满窗"——不出第二条');
    w = run(w, 3);                                   // 到 t24（3 的倍数，且距 t13 满 11 轮）
    assert.equal(pumpEvents(w).length, 2, '距 t13 满窗 ⇒ 第二条出声');
    assert.equal(pumpEvents(w)[1].id, 'ev_pump_24_1');
    assert.equal(openPumps(w).length, 1);
});

test('Q5：落账形状——可作盘算挂因（未决即合法；闭环后拒绝）、满热窗归档、链条不断', () => {
    let w = run(world(), QUIET_WINDOW + 2);          // t12：熵泵事件在册
    const step = emptyStep();
    step.newAgendas = [{ entity: 'e1', goal: '趁静养民', visibility: 'known', source: { type: 'event', ref: 'ev_pump_12_1' } }];
    assert.equal(checkWorldStep(step, w).ok, true, '未决熵泵事件当挂因合法');
    // 世界动了 ⇒ 收声 ⇒ 该事件不再是合法挂因（因果正确：已了结的不算驱动马达）
    w = run(w, 1, { newEvents: [{ title: '事一', source: { type: 'state' }, position: '临渊城', ripples: [] }] });
    w = run(w, 2);
    assert.equal(checkWorldStep(step, w).ok, false, '闭环后挂因被拒');
    // 走够热窗 ⇒ 归档进里程碑
    w = run(w, 60);
    const archived = (w.milestones || []).flatMap((m) => m.ids || []);
    assert.ok(archived.includes('ev_pump_12_1'), '闭环熵泵事件满热窗归档（热点进温层，指针仍可回溯）');
    assert.equal(validate(w, ssotSchema).ok, true);
});

test('Q4：无设定池世界零扰动（旁观/旧世界语义不破）；常量与节奏锁定', () => {
    const bare = world();
    delete bare.context.setting;
    const r = run(bare, 30);
    assert.equal(r.context.setting, undefined, '不产生设定池');
    assert.equal(r.events.length, 0, '熵泵不启动');

    const noEvents = world();
    delete noEvents.context.setting.dynamic;
    const r2 = run(noEvents, 30);
    assert.equal(pumpEvents(r2).length, 0, '无演化层（无 dynamic）⇒ 熵泵不启动（旧世界/旁观语义守住）');

    assert.equal(ENTROPY_TICK, 3, '提案：每 3 tick 检查一次');
    assert.equal(QUIET_WINDOW, 10, '提案：静默窗 10 轮');
});
