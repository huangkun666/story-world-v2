// story-world-v2/test/setting-guard.test.js
// K25/设定大势层：设定池读写面（细案 §3.3 → A-4）——保留键空间拒面（check-step 集成）+ 演化层写通道（src/setting.js）。
// leg25 c 改写：`stateChanges` 已从世界步契约整条删除（四维浮点不存在了），故拒面样本里那两类
//   （$.stateChanges[0].entity / .actor）随之删除——引用面只剩四类（actions.entity/target、newAgendas.entity、
//   newEvents.ripples）。测的东西没变：**设定池保留键空间对一切实体引用字段一律关门**。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWorldStep } from '../src/check-step.js';
import { isSettingRef } from '../src/setting.js';

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
        { id: 'e_p', kind: 'character', name: '玩家', location: '临渊城' },
        { id: 'e1', kind: 'faction', name: 'A', location: '临渊城' },
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
    newAgendas: [],
    agendaCancels: [], newEntities: [], entityFates: [],
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

test('K25/A-4 拒面：四类实体引用字段命中设定池保留键一律拒绝（世界如实不动）', () => {
    const cases = [
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
    step.actions = [{ entity: 'e1', verb: '攻打', target: 'setting.frozen.canon' }];
    const r = checkWorldStep(step, w);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('设定池保留键')));
});

test('leg26 参数档位：写通道**已删除**（引擎不再推演任何数值）——patchDynamic 不得复活', async () => {
    // 对抗式锁（不问"我以为对的地方"，问"哪里会退回去"）：
    //   熵泵改定义时把"四个数 + 锯齿推演 + 危险带"整条撤了，patchDynamic 也随之删除。
    //   这条锁防的是**无声复活**：谁再把"引擎按小步推一个 0~1 的数"加回来，这里就红。
    const mod = await import('../src/setting.js');
    assert.equal(mod.patchDynamic, undefined, '★patchDynamic 必须不存在（引擎不发明数值）');
    // 参数现在是"玩家定的档位原话"，落账走编排层（参数页 set-param），不经过任何"数值写通道"
    const { PARAM_KEYS, PARAM_GEARS, isParamGear } = await import('../src/params.js');
    assert.deepEqual(PARAM_KEYS, ['民生度', '动乱度', '天时', '张力推手'], '键表沿用（账本已有先例）');
    for (const k of PARAM_KEYS) {
        assert.ok(PARAM_GEARS[k].length >= 2, `${k} 至少两档`);
        assert.equal(isParamGear(k, PARAM_GEARS[k][0]), true);
        assert.equal(isParamGear(k, 0.5), false, '数值不是档位词');
        assert.equal(isParamGear(k, '异想天开'), false, '表外词不入账');
    }
});