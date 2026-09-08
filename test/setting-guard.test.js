// story-world-v2/test/setting-guard.test.js
// K25/设定大势层：设定池读写面（细案 §3.3 → A-4）——保留键空间拒面（check-step 集成）+ 演化层写通道（src/setting.js）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWorldStep } from '../src/check-step.js';
import { isSettingRef, patchDynamic } from '../src/setting.js';

const world = () => ({
    version: 1,
    context: {
        world: '临渊城',
        tension: 0.5,
        positions: ['临渊城'],
        playerId: 'e_p',
        setting: {
            frozen: { fingerprint: 'f1', extractedAt: 't', canon: { powerScale: [{ level: '筑基', note: 'x' }], rules: ['灵脉有主'], society: 's', techOrMagic: 'm', historyNotes: ['h'] } },
            dynamic: { tension: { polarity: '宗门/朝廷', direction: '宗门压朝廷', intensity: 0.6 }, env: { '民生度': 0.7 } },
        },
    },
    entities: [
        { id: 'e_p', kind: 'character', name: '玩家', location: '临渊城', attrs: { hardPower: 0.25 } },
        { id: 'e1', kind: 'faction', name: 'A', location: '临渊城', attrs: {} },
    ],
    weights: {},
    agendas: [],
    events: [],
    chronicle: [],
    meta: { tick: 1 },
});

const okStep = () => ({
    actions: [{ entity: 'e1', verb: '巡视', position: '临渊城' }],
    newEvents: [],
    agendaAdvances: [],
    stateChanges: [],
    newAgendas: [],
    agendaCancels: [],
});

const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('K25/A-4 判词：保留键空间——setting 全池命中，普通实体/位置不误伤', () => {
    assert.equal(isSettingRef('setting'), true);
    assert.equal(isSettingRef('setting.frozen'), true);
    assert.equal(isSettingRef('setting.frozen.canon.powerScale'), true);
    assert.equal(isSettingRef('setting.dynamic.env'), true);
    assert.equal(isSettingRef('e_player'), false);
    assert.equal(isSettingRef('tension'), false);
    assert.equal(isSettingRef('scenario'), false);
});

test('K25/A-4 拒面：六类实体引用字段命中设定池保留键一律拒绝（世界如实不动）', () => {
    const cases = [
        [{ stateChanges: [{ entity: 'setting.frozen.canon.powerScale', attr: 'hardPower', delta: 0.1 }] }, '$.stateChanges[0].entity'],
        [{ stateChanges: [{ entity: 'e1', attr: 'hardPower', delta: 0.1, actor: 'setting.dynamic' }] }, '$.stateChanges[0].actor'],
        [{ actions: [{ entity: 'setting', verb: '修改' }] }, '$.actions[0].entity'],
        [{ actions: [{ entity: 'e1', verb: '攻打', target: 'setting.frozen.canon.rules' }] }, '$.actions[0].target'],
        [{ newAgendas: [{ entity: 'setting.frozen', goal: 'g', visibility: 'known', source: { type: 'state' } }] }, '$.newAgendas[0].entity'],
        [{ newEvents: [{ title: 't', source: { type: 'state' }, position: '临渊城', ripples: ['setting.dynamic.env'] }] }, '$.newEvents[0].ripples[0]'],
    ];
    for (const [over, errPath] of cases) {
        const step = okStep();
        Object.assign(step, over);
        const r = checkWorldStep(step, world());
        assert.equal(r.ok, false, `${errPath} 应被拒`);
        assert.ok(r.errors.some((e) => e.startsWith(`${errPath}:`) && e.includes('设定池保留键')), `${errPath} 文案缺失: ${r.errors.join('; ')}`);
    }
});

test('K25/A-4：含设定池世界的合法步照常通过（拒面不误伤）', () => {
    const r = checkWorldStep(okStep(), world());
    assert.equal(r.ok, true, r.errors.join('; '));
});

test('K25/A-4：命名空间恒定保留——无设定池的世界同样拒绝 setting.* 引用', () => {
    const w = world();
    delete w.context.setting;
    const step = okStep();
    step.stateChanges = [{ entity: 'setting.frozen.canon', attr: 'hardPower', delta: 0.1 }];
    const r = checkWorldStep(step, w);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('设定池保留键')));
});

test('K25 写通道：patchDynamic 引擎独占写——增量落账、[0,1] 钳制、不可变', () => {
    const w = world();
    const s1 = patchDynamic(w.context.setting, { key: '民生度', delta: -0.2 });
    approx(s1.dynamic.env['民生度'], 0.5);
    assert.equal(w.context.setting.dynamic.env['民生度'], 0.7, '原 setting 不可变');

    const s2 = patchDynamic(s1, { key: '民生度', delta: -10 });
    assert.equal(s2.dynamic.env['民生度'], 0);
    const s3 = patchDynamic(s2, { key: '民生度', delta: 10 });
    assert.equal(s3.dynamic.env['民生度'], 1);
});

test('K25 写通道：新键基线 0.5（提案态）；env 缺省时创建；无 dynamic/非对象防御返回原值', () => {
    const w = world();
    const s4 = patchDynamic(w.context.setting, { key: '动乱度', delta: 0.1 });
    approx(s4.dynamic.env['动乱度'], 0.6);

    const w2 = world();
    delete w2.context.setting.dynamic.env;
    const s5 = patchDynamic(w2.context.setting, { key: '天时', delta: 0.3 });
    approx(s5.dynamic.env['天时'], 0.8);

    const noDynamic = world();
    delete noDynamic.context.setting.dynamic;
    assert.equal(patchDynamic(noDynamic.context.setting, { key: 'x', delta: 0.1 }), noDynamic.context.setting);
    assert.equal(patchDynamic(null, { key: 'x', delta: 0.1 }), null);
});