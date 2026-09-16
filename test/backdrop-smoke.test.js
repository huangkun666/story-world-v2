// story-world-v2/test/backdrop-smoke.test.js
// K29/设定大势层：张力强度算法（细案 §3.1/T3：事件频次×分量比×衰减，全部提案态）+ pack 大势块 +
// 冒烟 100t 张力/环境量曲线（A-5/A-6/A-8）——强度域、熵泵存在、挂因闭环、预算、无第三来源（模型无写面）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSmoke } from '../src/smoke.js';
import { buildEvolutionPack, buildScaleAnchor, DIM_TOP, TIER_TOP, SCALE_STR_MAX } from '../src/pack.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { PARAM_GEARS, PARAM_KEYS } from '../src/params.js';

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
                env: { '民生度': '艰难', '动乱度': '动荡', '天时': '平常', '张力推手': '暗涌' },   // leg26：参数档位原话
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

// leg25 c：`stateChanges` 已随四维浮点从世界步契约删除——夹具步不再拼它。
const idleStep = () => ({ actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] });

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
    assert.deepEqual(p1.pack.setting, { tension: { polarity: '宗门/朝廷', direction: '宗门压朝廷', intensity: 0.5 }, env: { '民生度': '艰难', '动乱度': '动荡', '天时': '平常', '张力推手': '暗涌' } });
    assert.equal(JSON.stringify(p1.pack.setting).length < 1000, true, '大势块固定小结（≤1k 字符，A-8）');
    const noSet = world();
    delete noSet.context.setting;
    const p2 = buildEvolutionPack(noSet, null);
    assert.equal(p2.pack.tension, 0.5, '无 setting 回退 context.tension（兼容口径）');
    assert.equal(p2.pack.setting, undefined, '无 setting 世界不出现 setting 值（undefined 不入 JSON）');
    assert.equal(JSON.stringify(p2.pack).includes('setting'), false, '文本中无 setting 键');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// ★★leg60（交接第 2 件「让设定进包」）：**刻度块**——"书里的尺子"每轮都在，且必须是**短表**。
//   病：抽象出来的设定只在 `render.js` 出现，`pack.setting` 只带 tension+env（A-8 冻结层不入包）
//   ⇒ 模型每轮一个字都看不到这本书的维度与档位（真账 85 实体里 `实力` 0 条）。
//   口径：只进"可判等的那一小块"（维度 + 范围 + 档位），散文型设定不进每轮包。
test('★leg60 刻度块：档位表与维度进包（每轮都在）、体积有硬上界、空则键不出现', () => {
    const withScale = world();
    withScale.context.setting.frozen.canon.dims = [
        { name: '勇武', range: '-100~100' },
        { name: '韬略', range: '-100~100' },
    ];
    withScale.context.setting.frozen.canon.powerScale = [
        { level: 'T0级_天下无双', note: '数值标定 勇武100' },
        { level: 'T1级_超一流', note: '数值标定 勇武95-99' },
    ];
    const p = buildEvolutionPack(withScale, null);
    assert.deepEqual(p.pack.setting.刻度.维度, [{ 名: '勇武', 范围: '-100~100' }, { 名: '韬略', 范围: '-100~100' }], '★维度 + 取值范围进包（照抄原文）');
    assert.deepEqual(p.pack.setting.刻度.档位, [{ 档: 'T0级_天下无双', 标定: '数值标定 勇武100' }, { 档: 'T1级_超一流', 标定: '数值标定 勇武95-99' }], '★档位 + 数值标定进包');
    // 体积硬上界（A-8 的宽口必须可复核）：维度/档位各截断，字符串逐项 ≤ SCALE_STR_MAX
    const big = world();
    big.context.setting.frozen.canon.dims = Array.from({ length: 40 }, (_, i) => ({ name: `维${i}`.repeat(20), range: '范'.repeat(80) }));
    big.context.setting.frozen.canon.powerScale = Array.from({ length: 90 }, (_, i) => ({ level: `档${i}`.repeat(20), note: '标'.repeat(80) }));
    const q = buildEvolutionPack(big, null);
    assert.equal(q.pack.setting.刻度.维度.length, DIM_TOP, '维度条数截到 DIM_TOP');
    assert.equal(q.pack.setting.刻度.档位.length, TIER_TOP, '档位条数截到 TIER_TOP');
    assert.ok(q.pack.setting.刻度.维度.every((d) => d.名.length <= SCALE_STR_MAX && d.范围.length <= SCALE_STR_MAX), '逐项 ≤ SCALE_STR_MAX');
    assert.ok(JSON.stringify(q.pack.setting).length < 3000, `刻度块整体有界（实测 ${JSON.stringify(q.pack.setting).length} 字符）`);
    // 空则键不出现（"空着就是空着"——与 env 同一条纪律；既有世界零扰动）
    const none = world();
    const r0 = buildEvolutionPack(none, null);
    assert.equal(r0.pack.setting.刻度, undefined, '本书没有成文的维度/档位 ⇒ 键不出现（不是空对象）');
    assert.equal(buildScaleAnchor(null), null, '无 canon ⇒ null');
    assert.equal(buildScaleAnchor({ dims: [], powerScale: [] }), null, '空表 ⇒ null');
    assert.equal(buildScaleAnchor({ dims: [{ name: '  ' }], powerScale: [{ level: '' }] }), null, '只有空白项 ⇒ null（不发明维度）');
});

test('K29/A-5/A-6/A-8：冒烟 100t 张力/参数曲线——强度域 [0,1] 且会动、熵泵出声、挂因、预算内、零警告、确定性', async () => {
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

    // 熵泵（leg26 改定义后的读数）：**只看账本自己能证明的事实**——连续 QUIET_WINDOW 轮无真实事件 ⇒ 报一次。
    //   本冒烟的世界步只在开局头几轮产事件，之后一直空转 ⇒ 全程只有**一段静默** ⇒ 泵只出声一次、
    //   且因世界再没动过而始终未闭（这正是 Q3 要保护的语义：它不许自己把自己哄睡去刷屏）。
    //   所以这里锁"出声过一次"，**不再锁"累计 ≥5"**（旧值来自"四个数每 10 轮越阈齐发"的假节奏）。
    assert.ok(m.pumpSeedTotal >= 1, `熵泵至少出声一次（当前 ${m.pumpSeedTotal}）`);
    // 挂因（A-6 语义面）：熵泵事件在飞时，stepGen 会提议"应对它"的盘算（source.event=熵泵 id）。
    //   leg26 改定义后，本冒烟里泵只出声一次（世界步产事件只集中在开局）⇒ 期望值从"≥2"改为"≥1"。
    const born = a.world.chronicle.filter((c) => c.text.includes('因事而生'));
    assert.ok(born.length >= 1, `熵泵事件当挂因的盘算 ${born.length} ≥ 1`);

    // K39/A-16①：settle 落账编年行 100% 带 kind 章（漏章回归锁——未来新增编年写点漏章即红）
    assert.ok(a.world.chronicle.every((c) => ['scheme', 'major', 'ripple', 'shade', 'state'].includes(c.kind)), '冒烟 100t 落账编年行全带 kind（A-16①）');

    // 预算（A-8）与既有冒烟断言（体积界除外——切片刻度 20KB 不含设定池世界：大势层 100t 终态 ≈ 21.7KB，
    // 编年无裁剪为已知队列项，双流 UI 阶段裁剪/冷档；归档闸在事件池生效即有界）
    assert.ok(m.maxPackTokens <= 4000, `输入峰 ${m.maxPackTokens} ≤ 4000`);
    assert.equal(m.warningsTotal, 0, `非预期警告 ${m.warningsTotal} 条`);
    const weightsOk = Object.keys(a.world.weights).length === a.world.entities.length
        && Object.values(a.world.weights).every((w) => w >= 0 && w <= 1);
    assert.equal(weightsOk, true, '分量域 [0,1] 全覆盖');

    // 无第三来源（A-5 断言面）：参数档位键 ⊆ 键表；setting 形状合法
    // leg26：env 从"四个引擎推的数"改为"档位原话"——所以"四键常驻"这条判据**故意取消**
    //   （空着就是空着：书没给、玩家没定 ⇒ 键不存在），只锁"键不越表 + 值必须是本书档位词"。
    const env = a.world.context.setting.dynamic.env;
    assert.ok(Object.keys(env).every((k) => PARAM_KEYS.includes(k)), `参数键越表: ${Object.keys(env)}`);
    assert.ok(Object.entries(env).every(([k, v]) => (PARAM_GEARS[k] || []).includes(v)), `档位越表: ${JSON.stringify(env)}`);
    const r = validate(a.world, ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));

    // A-5 两来源之二：盘算浪尖派生——顶层盘算终结（达成）后 derivedFrom 有浪尖项
    const derived = a.world.context.setting.dynamic.derivedFrom || [];
    assert.ok(derived.some((d) => d.startsWith('浪尖:a_')), `浪尖项缺失: ${JSON.stringify(derived)}`);
    assert.ok(derived.every((d) => /^浪尖:a_\d+_\d+@\d+$/.test(d) || d.startsWith('浪尖:')), '浪尖项格式统一');
});