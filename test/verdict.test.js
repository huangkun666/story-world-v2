// story-world-v2/test/verdict.test.js
// K15 验收（盘算树细案 §3.4/§4 K15 → A-6）：盘算满步终结——达成 / 败露 / 变形（有在飞子 → 诸子断链转独立）；
// 判序 = 变形 → 败露 → 达成；兑现落痕仅达成态；模型无直接终结通道。
//
// ===================== leg25 c 连带后果（如实登记，不是测试写歪） =====================
// 四维浮点（兵力/权位/人脉/耳目）被用户令删除 ⇒ 契约层 `stateChanges` 整条消失 ⇒ **败露判据失去输入**：
//   旧法：实体 `hurtWindow` = 近 2 tick 负向 δ（来源就是 stateChanges 的实际生效值），|和| ≥ 0.05 判"败露"。
//   现法：负向 δ 无从产生（引擎已无写入方）⇒ hurtWindow 恒空 ⇒ 判据自然落到达成一侧。
//   故本文件把原"败露"三则（单 tick / 跨 tick 累计 / 边界 0.04）**改写成"无负向 δ 时按达成结算"**，
//   并新增一条"窗口已无写入方"的现状锁。要恢复"败露"必须另立**不依赖假精度**的判据（待拍板，未擅自发明）；
//   在那之前，唯一还能喂动这条分支的只有**旧账里遗留的 hurtWindow**——它被"判序"一则借用来验证托孤优先（见下）。
// 已删断言（机制没了）：负向 δ 落账、单 tick/跨 tick 阈值、0.04 边界、属性数值被改。
// =================================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settleTick, VERDICT_HURT_THRESHOLD } from '../src/settle.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

const TREE = JSON.parse(readFileSync(new URL('./fixtures/tree-world.json', import.meta.url), 'utf8'));

const na = (entity, goal, source, extra = {}) => ({ entity, goal, visibility: 'known', source, ...extra });
// 推 a_son1（progress 1 → maxSteps 3）两步 → 满步
const pushSon = (extra = {}) => ({
    actions: [], newEvents: [],
    agendaAdvances: [
        { agendaId: 'a_son1', step: '粮道探明', stage: '就绪' },
        { agendaId: 'a_son1', step: '押运启程', stage: '上路' },
    ],
    newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    ...extra,
});
const emptyStep = () => ({ actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] });

test('K15/A-6 达成：无伤害输入 → 达成编年（细案措辞）+ 兑现落痕保留', () => {
    const r = settleTick({ ssot: TREE, step: pushSon() });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const w = r.ssot;
    const fin = w.chronicle.find((c) => c.id === 'ch_1_fin_a_son1');
    assert.ok(fin.text.includes('达成'), fin.text);
    assert.ok(!fin.text.includes('败露') && !fin.text.includes('变形'), '措辞精确区分');
    assert.ok(w.agendas.find((a) => a.id === 'a_root').memory.done.some((d) => d.includes('粮草调度')), '达成态兑现');
});

test('K15/A-6（leg25 c 改写）：负向 δ 通道已删——无限负向 δ 时按达成结算（引擎无写入方，窗口恒空）', () => {
    // 这一条是**原"败露"三则的继任者**。为什么这么改：判据的输入端（属性增量）已随用户令删除，
    //   引擎侧不存在任何"扣分"通道 ⇒ 无论模型多想要"功败垂成"，引擎都不会算出来。
    //   注意措辞：这不是"败露被判定为不成立"，而是**败露无从计算**（待另立不依赖假精度的判据）。
    const r = settleTick({ ssot: TREE, step: pushSon() });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const w = r.ssot;
    const fin = w.chronicle.find((c) => c.id === 'ch_1_fin_a_son1');
    assert.ok(fin.text.includes('达成'), `无限负向 δ ⇒ 达成：${fin.text}`);
    assert.ok(!w.chronicle.some((c) => c.text.includes('败露')), '全账无"败露"字样（没有输入，就没有这个结局）');
    assert.equal(w.agendas.find((a) => a.id === 'a_son1').closed, true, '满步照结');
    assert.ok(w.agendas.find((a) => a.id === 'a_root').memory.done.some((d) => d.includes('粮草调度')), '达成态照常兑现');
    // 引擎不再产生 hurtWindow（旧判据的载体）——连字段都不该出现
    assert.ok(w.entities.every((e) => e.hurtWindow === undefined), '引擎不再写 hurtWindow（无写入方）');
    assert.equal(VERDICT_HURT_THRESHOLD, 0.05, '阈值常量仍在案（提案态）——但已无输入可喂，登记为待拍板的孤儿面');
});

test('K15/A-6 变形：有在飞子 → 事业移交诸子（断链转独立），不兑现', () => {
    const step = pushSon({ newAgendas: [na('e_lead', '分粮', { type: 'parent', ref: 'a_son1' })] });
    const r = settleTick({ ssot: TREE, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const w = r.ssot;
    const fin = w.chronicle.find((c) => c.id === 'ch_1_fin_a_son1');
    assert.ok(fin.text.includes('变形') && fin.text.includes('事业移交诸子（1 项断链转独立）'), fin.text);
    const son = w.agendas.find((a) => a.id === 'a_son1');
    const grand = w.agendas.find((a) => a.goal === '分粮');
    assert.equal(son.closed, true);
    assert.equal(grand.parentId, undefined, '子断父链转独立（不悬挂死父）');
    assert.equal(son.memory.promises.includes(grand.id), true, '委派承诺仍在（历史留痕）');
    assert.ok(!w.agendas.find((a) => a.id === 'a_root').memory.done.some((d) => d.includes('粮草调度')), '变形不兑现');
});

test('K15/A-6 判序：变形优先——有在飞子且"伤害输入"越阈 → 变形而非败露（托孤优先）', () => {
    // 判序这条测的是**顺序**，需要"败露侧条件为真"才谈得上。属性通道删除后，唯一还能让该条件为真的
    //   只剩**旧账里遗留的 hurtWindow**（引擎已无写入方，见前一则）。这里借它把顺序钉住：
    //   托孤优先——任何有在飞子的终结必先断链，子盘算不悬挂已死之父。
    //   ⚠️ 这是**现状锁**（锁"代码今天怎么走"），不是设计意图：等"败露判据另立"拍板后，
    //      本断言应随 hurtWindow 一并从代码里消失，而不是被"修回旧行为"。
    const world = structuredClone(TREE);
    world.entities.find((e) => e.id === 'e_court').hurtWindow = [-0.06, 0];   // 旧账遗留（≥ 阈值）
    const step = pushSon({ newAgendas: [na('e_lead', '分粮', { type: 'parent', ref: 'a_son1' })] });
    const r = settleTick({ ssot: world, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const fin = r.ssot.chronicle.find((c) => c.id === 'ch_1_fin_a_son1');
    assert.ok(fin.text.includes('变形'), fin.text);
    assert.ok(!fin.text.includes('败露'), '托孤优先（子不悬挂死父）');
});

test('K15（leg25 c 现状锁）：hurtWindow 已无写入方——引擎不产生该字段；旧账遗留值惰性滑零后自删', () => {
    // 旧法：每 tick 把"本 tick 负 δ"推进窗口 [本, 上]，全 0 删字段（锚点零扰动）。
    //   现在本 tick 恒 0（没有来源），但那段惰性写还在跑：旧账遗留的窗口会一轮一轮滑零、两轮后自删。
    //   此处把**现状**钉住（免得孤儿代码的行为被静默改动）——它同样随"败露判据另立"一并清算。
    const w0 = structuredClone(TREE);
    w0.entities.find((e) => e.id === 'e_court').hurtWindow = [-0.03, 0];
    const r1 = settleTick({ ssot: w0, step: emptyStep() });
    assert.equal(r1.ok, true, r1.stage.warnings.join('; '));
    assert.deepEqual(r1.ssot.entities.find((e) => e.id === 'e_court').hurtWindow, [0, -0.03], '遗留值被推后一格（本 tick 无新增）');
    assert.equal(r1.ssot.entities.find((e) => e.id === 'e_lead').hurtWindow, undefined, '无遗留值的实体不写字段（锚点零扰动）');
    const r2 = settleTick({ ssot: r1.ssot, step: emptyStep() });
    assert.equal(r2.ssot.entities.find((e) => e.id === 'e_court').hurtWindow, undefined, '两轮滑零后删字段');
    // 没有遗留值的干净世界：多轮之后依然一个 hurtWindow 都没有
    let w = structuredClone(TREE);
    for (let i = 0; i < 3; i++) w = settleTick({ ssot: w, step: emptyStep() }).ssot;
    assert.ok(w.entities.every((e) => e.hurtWindow === undefined), '干净世界不产生窗口');
});

test('K15：两态结算后世界过 SSOT schema（hurtWindow 可选字段合法）；达成为唯一无子结局', () => {
    const r = settleTick({ ssot: TREE, step: pushSon() });
    const vr = validate(r.ssot, ssotSchema);
    assert.equal(vr.ok, true, vr.errors.join('; '));
    const w2 = settleTick({ ssot: TREE, step: pushSon({ newAgendas: [na('e_lead', '分粮', { type: 'parent', ref: 'a_son1' })] }) });
    const vr2 = validate(w2.ssot, ssotSchema);
    assert.equal(vr2.ok, true, vr2.errors.join('; '));
    assert.ok(r.ssot.chronicle.some((c) => c.text.includes('达成')), '无子终结 → 达成');
    assert.ok(w2.ssot.chronicle.some((c) => c.text.includes('变形')), '有子终结 → 变形');
});
