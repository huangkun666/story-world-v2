// story-world-v2/test/backdrop-smoke.test.js
// K29/设定大势层：张力强度算法（细案 §3.1/T3：事件频次×分量比×衰减，全部提案态）+ pack 大势块 +
// 冒烟 100t 张力/环境量曲线（A-5/A-6/A-8）——强度域、熵泵存在、挂因闭环、预算、无第三来源（模型无写面）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSmoke } from '../src/smoke.js';
import { buildEvolutionPack, buildScaleAnchor, DIM_TOP, TIER_TOP, SCALE_STR_MAX, SCALE_TABLE_TOP_PACK } from '../src/pack.js';
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
//   ★★leg62 改口径（用户令「换成概念表」）：进包的东西**从"两列平铺"改成"一把尺一张表"**。
//     旧断言读的是 `p.pack.setting.刻度.维度` / `.档位`（两列）；现在是 `刻度: [{表, 档位?, 维度?}]`。
//     ⇒ 本锁按新口径重写，并**补上分组那条**（旧账推导：维度 range 回指档位名 ⇒ 进同一张表）。
test('★leg60 + leg62 刻度块：概念表进包（一把尺一张表）、体积有硬上界、空则键不出现', () => {
    // ① 两列**互相独立**（range 不回指任何档位名）⇒ 各成一张表，内容一条不丢
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
    const tables = p.pack.setting.刻度;
    assert.ok(Array.isArray(tables), '刻度块 = 概念表列表');
    const allTiers = tables.flatMap((t) => t.档位 || []);
    const allDims = tables.flatMap((t) => t.维度 || []);
    assert.deepEqual(allDims, [{ 名: '勇武', 范围: '-100~100' }, { 名: '韬略', 范围: '-100~100' }], '★维度 + 取值范围进包（照抄原文）');
    assert.deepEqual(allTiers, [{ 档: 'T0级_天下无双', 标定: '数值标定 勇武100' }, { 档: 'T1级_超一流', 标定: '数值标定 勇武95-99' }], '★档位 + 数值标定进包');
    assert.ok(tables.every((t) => typeof t.表 === 'string' && t.表.length), '★每张表都带表名（旧口径两列平铺时没有它）');

    // ①b ★leg62 核心：维度 range **回指**某个档位名 ⇒ 它们进**同一张表**（实教 `S~E级` 下挂 5 个属性那种）
    const grouped = world();
    grouped.context.setting.frozen.canon.powerScale = [
        { level: 'A班', note: '精英最高资源保障' },
        { level: 'D班', note: '底层资源最少多隐藏实力' },
        { level: 'S~E级', note: '决定班级分配' },
    ];
    grouped.context.setting.frozen.canon.dims = [
        { name: '学力', range: 'S~E级' },
        { name: '智力', range: 'S~E级' },
    ];
    const g = buildEvolutionPack(grouped, null).pack.setting.刻度;
    // ★leg62 的老账推导口径（`scalesFromFlat`）：`A班/D班/S~E级` 都**没有数字记号** ⇒ 合进同一张
    //   《无记号档位》表；而 `学力/智力` 的 range 逐字回指 `S~E级`（该表的成员之一）⇒ 也挂进这张表。
    //   ⇒ 这一格里**档位与维度落在同一张表**——正是"一把尺 + 它底下的一组属性"的形态
    //     （实教 `S~E级` 下 5 个属性就是这形状）。★新账由模型直接交 `刻度` 分组，不走这条推导。
    const host = g.find((t) => (t.档位 || []).some((x) => x.档 === 'S~E级'));
    assert.ok(host, '★`S~E级` 所在的表在包里（它是被两个维度回指的那把尺）');
    assert.deepEqual((host.维度 || []).map((d) => d.名), ['学力', '智力'], '★回指它的两个维度挂进同一张表（不是平铺在别的栏里）');
    assert.deepEqual((host.档位 || []).map((x) => x.档), ['A班', 'D班', 'S~E级'], '★无记号档位合一张表（老账没有分组信息，碎成一张张表面板画不出来）');
    assert.equal(g.length, 1, '★这一格里只有一张表（两个维度都回指到它，没有游离维度）');

    // ★★leg62 夹具与断言的**真实口径**（这段踩了四轮才定，改之前先读）：
    //   旧口径（`leg60`）是"两列各自独立截断"⇒ 维 8 / 档 24 两条互不影响。
    //   换成概念表后**它们不再独立**：一张表同时装着档位与维度，而表数上限是体积兜底
    //   ⇒ 退化到"一档一表 / 一维一表"时，`表数上限` 会**先于**两条预算咬住。
    //   实测（90 个互不相同档位名 + 40 个互不相同维度名）：上限 16 → 档位 15/24、维度 1/8。
    //   ⇒ 本锁因此**不再断言"两条预算各自都压到上限"**（那是旧形状才成立的性质），改锁**真正保证的三条**：
    //     ① 逐项字符串 ≤ SCALE_STR_MAX；② 表数 ≤ 上限；③ 整体有界。
    //   而"两条预算各自压到上限"这条性质，用**真实形状的夹具**在下面单独锁（现实里档位是
    //   "少数几把尺、每把许多档"，维度挂在尺上——大荒 103 档/65 维、实教 1 尺挂 5 维都是这形状）。
    const big = world();
    big.context.setting.frozen.canon.powerScale = Array.from({ length: 90 }, (_, i) => ({ level: `档${i}`.repeat(20), note: '标'.repeat(80) }));
    big.context.setting.frozen.canon.dims = Array.from({ length: 40 }, (_, i) => ({ name: `维${i}`.repeat(20), range: '范'.repeat(80) }));
    const q = buildEvolutionPack(big, null);
    const qT = q.pack.setting.刻度;
    assert.ok(qT.flatMap((t) => t.维度 || []).every((d) => d.名.length <= SCALE_STR_MAX && d.范围.length <= SCALE_STR_MAX), '逐项 ≤ SCALE_STR_MAX');
    assert.ok(qT.flatMap((t) => t.档位 || []).every((t) => t.档.length <= SCALE_STR_MAX), '档位逐项 ≤ SCALE_STR_MAX');
    assert.ok(qT.length <= SCALE_TABLE_TOP_PACK, `表数 ≤ ${SCALE_TABLE_TOP_PACK} 张（实测 ${qT.length}）`);
    assert.ok(qT.every((t) => t.档位?.length || t.维度?.length), '★没有空表（空行不许占表数名额——实测踩过：8 张表里 2 张是空的）');
    assert.ok(qT.flatMap((t) => t.档位 || []).length > 0, '★退化形状下档位仍有（锚不能整块丢）');
    assert.ok(qT.flatMap((t) => t.维度 || []).length > 0, '★退化形状下维度仍有（不能 0/8——实测踩过：提前 break 把维度饿死）');

    // ★真实形状（**一把尺，底下许多档 + 一组挂在它上面的维度** —— 实教 `S~E级` 下挂 5 个属性就是这形状）
    //   ⇒ 两条预算**各自压到上限**，且表数远小于上限（表数封顶完全不参与 ⇒ 这段只验预算本身）。
    const real = world();
    real.context.setting.frozen.canon.powerScale = [
        { level: 'S~E级', note: '决定班级分配' },
        ...Array.from({ length: 30 }, (_, j) => ({ level: `档${j}`, note: '标' })),   // 31 档 ⇒ 逼 TIER_TOP
    ];
    real.context.setting.frozen.canon.dims = [
        ...Array.from({ length: 12 }, (_, i) => ({ name: `维${i}`, range: 'S~E级' })),  // 12 维 ⇒ 逼 DIM_TOP
        // ★对照：一个**回指不到任何档位名**的维度 ⇒ 它自成一表（`scalesFromFlat` 的兜底分支）
        { name: '独立维', range: '0~100' },
    ];
    const rq = buildEvolutionPack(real, null).pack.setting.刻度;
    assert.equal(rq.flatMap((t) => t.档位 || []).length, TIER_TOP, '★真实形状：档位压到 TIER_TOP');
    assert.equal(rq.flatMap((t) => t.维度 || []).length, DIM_TOP, '★真实形状：维度压到 DIM_TOP');
    // ★老账推导的分组（`scalesFromFlat`）：
    //   · `档0…档29` 有数字记号 ⇒ 同形态归一组（组名取该组第一条档位名 = `档0`）；
    //   · `S~E级` **无数字记号** ⇒ 进《无记号档位》那张表，而那 12 个回指它的维度也跟着挂进**同一张表**。
    //   ★为什么必须归组（实测）：不归组时"一档一表" ⇒ 31 档推出 31 张表 ⇒ 表数名额被占光，档位只剩 15/24。
    assert.equal(rq.length, 2, `★只有两张表（实测 ${JSON.stringify(rq.map((t) => t.表))}）`);
    const unmarkedT = rq.find((t) => t.表 === '无记号档位');
    assert.ok(unmarkedT, '★无记号档位（`S~E级`）自成一张《无记号档位》表');
    assert.deepEqual((unmarkedT.档位 || []).map((x) => x.档), ['S~E级'], '★它装着 `S~E级` 这一个档位');
    assert.equal((unmarkedT.维度 || []).length, DIM_TOP, '★回指它的 12 个维度截到 DIM_TOP，全挂在同一张表里');
    const markedT = rq.find((t) => t.表 !== '无记号档位');
    assert.equal((markedT.档位 || []).length, TIER_TOP - 1, '★另一张表装同形态的 30 个档（截到剩余名额）');

    // ★leg62：表数封顶只管"还能不能开新表"，**绝不能顺手把预算也停了**（实测踩过一次：
    //   表数那行原来带 `break`，维度预算当场被饿死成 0/8）。
    const spread = world();
    spread.context.setting.frozen.canon.dims = Array.from({ length: 20 }, (_, i) => ({ name: `独维${i}`, range: `范${i}` }));
    spread.context.setting.frozen.canon.powerScale = [{ level: 'T1', note: '甲' }, { level: 'T2', note: '乙' }];
    const sp = buildEvolutionPack(spread, null).pack.setting.刻度;
    assert.equal(sp.flatMap((t) => t.维度 || []).length, DIM_TOP,
        '★散开的维度仍要填满 DIM_TOP（表数封顶不许饿死维度预算）');
    assert.ok(sp.length <= SCALE_TABLE_TOP_PACK, `散开时表数仍 ≤ ${SCALE_TABLE_TOP_PACK}（实测 ${sp.length}）`);
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