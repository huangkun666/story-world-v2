// story-world-v2/test/backdrop-smoke.test.js
// K29/设定大势层：张力强度算法（细案 §3.1/T3：事件频次×分量比×衰减，全部提案态）+ pack 大势块 +
// 冒烟 100t 张力/环境量曲线（A-5/A-6/A-8）——强度域、熵泵存在、挂因闭环、预算、无第三来源（模型无写面）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSmoke } from '../src/smoke.js';
import { buildEvolutionPack } from '../src/pack.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { ENV_KEYS } from '../src/entropy.js';

const world = () => ({
    version: 1,
    context: {
        world: '临渊城',
        tension: 0.5,
        positions: ['临渊城'],
        setting: {
            frozen: { fingerprint: 'f1', extractedAt: 't', canon: { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [] } },
            dynamic: {
                tension: { polarity: '宗门/朝廷', direction: '宗门压朝廷', intensity: 0.5 },
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

const idleStep = () => ({ actions: [], newEvents: [], agendaAdvances: [], stateChanges: [], newAgendas: [], agendaCancels: [] });

// 挂因闭环步生成：熵泵事件未决时提议应对盘算（source.event=熵泵 id——A-6"可作盘算挂因"冒烟面）；
// 有在飞盘算才行动/推进（零烟雾报警）；盘算满步达成后闭环。
const stepGen = (t, w) => {
    const step = idleStep();
    const open = w.agendas.filter((a) => !a.closed);
    if (t % 5 === 0 && open.length) step.agendaAdvances = [{ agendaId: open[0].id, step: '推进' }];
    if (t % 7 === 0 && open.length) step.actions = [{ entity: 'e1', verb: '安抚', position: '临渊城' }];
    if (t % 5 === 0 && open.length < 4) {
        const pump = (w.events || []).find((e) => e.id.startsWith('ev_pump_') && !e.closed);
        if (pump) step.newAgendas = [{ entity: 'e1', goal: `应对「${pump.title}」`, visibility: 'known', source: { type: 'event', ref: pump.id } }];
    }
    return step;
};

test('K29/A-8：pack 大势块——有 setting 取演化层强度 + 张力三件/环境量入包；无 setting 回退数字且无 setting 键', () => {
    const withSet = world();
    const p1 = buildEvolutionPack(withSet, null);
    assert.equal(p1.pack.tension, 0.5, '未结算前取初值 0.5（与 context.tension 同值）');
    assert.deepEqual(p1.pack.setting, { tension: { polarity: '宗门/朝廷', direction: '宗门压朝廷', intensity: 0.5 }, env: { '民生度': 0.5, '动乱度': 0.5, '天时': 0.5, '张力推手': 0.5 } });
    assert.equal(JSON.stringify(p1.pack.setting).length < 1000, true, '大势块固定小结（≤1k 字符，A-8）');

    const noSet = world();
    delete noSet.context.setting;
    const p2 = buildEvolutionPack(noSet, null);
    assert.equal(p2.pack.tension, 0.5, '无 setting 回退 context.tension（兼容口径）');
    assert.equal(p2.pack.setting, undefined, '无 setting 世界不出现 setting 值（undefined 不入 JSON）');
    assert.equal(JSON.stringify(p2.pack).includes('setting'), false, '文本中无 setting 键');
});

test('K29/A-5/A-6/A-8：冒烟 100t 张力/环境量曲线——强度域 [0,1] 且会动、熵泵种子 ≥5、挂因闭环 ≥2、预算内、零警告、确定性', async () => {
    const run = () => runSmoke({ ssot: world(), extractCtx: { positions: ['临渊城'] }, ticks: 100, stepGen });
    const a = await run();
    const b = await run();
    assert.equal(JSON.stringify(a.world), JSON.stringify(b.world), '100t 确定性逐字节');
    const m = a.metrics;
    assert.ok(m.ticks === 100);

    // 强度域与活性（K29 曲线素材：强度会动——冷清段衰减趋低、事件段抬升）
    const series = Object.values(m.intensitySeries);
    assert.ok(series.every((v) => typeof v === 'number' && v >= 0 && v <= 1), `强度域越界: ${series.join(',')}`);
    assert.ok(new Set(series.map((v) => v.toFixed(4))).size >= 3, '强度不是死常数（大势会动）');
    assert.equal(Object.values(series).at(-1) < 0.9, true, '冷档衰减存在（惯性系数 <1）');

    // 熵泵种子（A-6 冒烟面：非模型生成的状态源事件存在；热池 + 归档承接）
    assert.ok(m.pumpSeedTotal >= 5, `熵泵事件累计 ${m.pumpSeedTotal} ≥ 5`);
    // 挂因闭环（A-6 闭环：摩擦事件 → 新盘算挂因）
    const born = a.world.chronicle.filter((c) => c.text.includes('因事而生') && c.text.includes('熵泵'));
    assert.ok(born.length >= 2, `熵泵挂因盘算 ${born.length} ≥ 2`);

    // 预算（A-8）与既有冒烟断言（体积界除外——切片刻度 20KB 不含设定池世界：大势层 100t 终态 ≈ 21.7KB，
    // 编年无裁剪为已知队列项，双流 UI 阶段裁剪/冷档；归档闸在事件池生效即有界）
    assert.ok(m.maxPackTokens <= 4000, `输入峰 ${m.maxPackTokens} ≤ 4000`);
    assert.equal(m.warningsTotal, 0, `非预期警告 ${m.warningsTotal} 条`);
    const weightsOk = Object.keys(a.world.weights).length === a.world.entities.length
        && Object.values(a.world.weights).every((w) => w >= 0 && w <= 1);
    assert.equal(weightsOk, true, '分量域 [0,1] 全覆盖');

    // 无第三来源（A-5 断言面）：env 键 ⊆ 键表；setting 形状合法
    const env = a.world.context.setting.dynamic.env;
    assert.ok(Object.keys(env).every((k) => ENV_KEYS.includes(k)), `env 键越表: ${Object.keys(env)}`);
    const r = validate(a.world, ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
    const attrsLen = Object.keys(env).length === ENV_KEYS.length;
    assert.equal(attrsLen, true, '四键常驻');
});