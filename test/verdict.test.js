// story-world-v2/test/verdict.test.js
// K15 验收（盘算树细案 §3.4/§4 K15 → A-6）：满步三态终结——达成（近 2 tick 负 δ <0.05 提案）/ 败露（≥0.05）/
// 变形（有在飞子 → 诸子断链转独立）；判序 = 变形 → 败露 → 达成；兑现落痕仅达成态；模型无直接终结通道。
// 判据窗口：实体 hurtWindow = 近 2 tick 负向 δ（stateChanges 实际生效值，惰性写）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settleTick } from '../src/settle.js';
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
    stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    ...extra,
});
const hurt = (delta) => ({ entity: 'e_court', attr: 'network', delta, cause: 'a_root' });

test('K15/A-6 达成：近 2 tick 无负向 δ → 达成编年（细案措辞）+ 兑现落痕保留', () => {
    const r = settleTick({ ssot: TREE, step: pushSon() });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const w = r.ssot;
    const fin = w.chronicle.find((c) => c.id === 'ch_1_fin_a_son1');
    assert.ok(fin.text.includes('达成'), fin.text);
    assert.ok(!fin.text.includes('败露') && !fin.text.includes('变形'), '措辞精确区分');
    assert.ok(w.agendas.find((a) => a.id === 'a_root').memory.done.some((d) => d.includes('粮草调度')), '达成态兑现');
});

test('K15/A-6 败露：单 tick 负向 δ ≥0.05 → 败露编年（功败垂成），不兑现', () => {
    const r = settleTick({ ssot: TREE, step: pushSon({ stateChanges: [hurt(-0.06)] }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const w = r.ssot;
    const fin = w.chronicle.find((c) => c.id === 'ch_1_fin_a_son1');
    assert.ok(fin.text.includes('败露') && fin.text.includes('功败垂成'), fin.text);
    assert.equal(w.agendas.find((a) => a.id === 'a_son1').closed, true, '满步照结');
    assert.ok(!w.agendas.find((a) => a.id === 'a_root').memory.done.some((d) => d.includes('粮草调度')), '败露不兑现');
    assert.ok(w.entities.find((e) => e.id === 'e_court').attrs.network < 0.8, '负 δ 落账');
});

test('K15/A-6 败露：跨 tick 窗口累计（各 0.03 → 近 2 tick 0.06 ≥0.05）', () => {
    const step1 = { actions: [], newEvents: [], agendaAdvances: [{ agendaId: 'a_son1', step: '半程', stage: '中' }], stateChanges: [hurt(-0.03)], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] };
    const w1 = settleTick({ ssot: TREE, step: step1 }).ssot;
    assert.ok(!w1.agendas.find((a) => a.id === 'a_son1').closed, '未满步不结算');
    const hw1 = w1.entities.find((e) => e.id === 'e_court').hurtWindow;
    assert.ok(Math.abs(hw1[0] + 0.03) < 1e-9 && hw1[1] === 0, `窗口 [本 tick, 上一 tick]，实际 ${hw1}`);
    const step2 = pushSon({ stateChanges: [hurt(-0.03)] });
    const r = settleTick({ ssot: w1, step: step2 });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const w = r.ssot;
    const hw2 = w.entities.find((e) => e.id === 'e_court').hurtWindow;
    assert.ok(Math.abs(hw2[0] + 0.03) < 1e-9 && Math.abs(hw2[1] + 0.03) < 1e-9, `窗口滑动，实际 ${hw2}`);
    assert.ok(w.chronicle.find((c) => c.id === 'ch_2_fin_a_son1').text.includes('败露'), '近 2 tick 累计 0.06 败露');
});

test('K15/A-6 达成边界：负向 δ 0.04（<0.05 提案阈值）→ 达成', () => {
    const r = settleTick({ ssot: TREE, step: pushSon({ stateChanges: [hurt(-0.04)] }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.ok(r.ssot.chronicle.find((c) => c.id === 'ch_1_fin_a_son1').text.includes('达成'));
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

test('K15/A-6 判序：变形优先——有在飞子且负 δ ≥0.05 → 变形而非败露', () => {
    const step = pushSon({ newAgendas: [na('e_lead', '分粮', { type: 'parent', ref: 'a_son1' })], stateChanges: [hurt(-0.06)] });
    const r = settleTick({ ssot: TREE, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const fin = r.ssot.chronicle.find((c) => c.id === 'ch_1_fin_a_son1');
    assert.ok(fin.text.includes('变形'), fin.text);
    assert.ok(!fin.text.includes('败露'), '托孤优先（子不悬挂死父）');
});

test('K15 窗口惰性：无伤害不写；伤害康复两 tick 后字段消失（锚点零扰动）', () => {
    const w1 = settleTick({ ssot: TREE, step: { actions: [], newEvents: [], agendaAdvances: [], stateChanges: [hurt(-0.03)], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] } }).ssot;
    const hw1 = w1.entities.find((e) => e.id === 'e_court').hurtWindow;
    assert.ok(Math.abs(hw1[0] + 0.03) < 1e-9 && hw1[1] === 0, `实际 ${hw1}`);
    assert.equal(w1.entities.find((e) => e.id === 'e_lead').hurtWindow, undefined, '无伤害实体不写字段');
    const empty = { actions: [], newEvents: [], agendaAdvances: [], stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] };
    const w2 = settleTick({ ssot: w1, step: empty }).ssot;
    const hw2 = w2.entities.find((e) => e.id === 'e_court').hurtWindow;
    assert.ok(hw2[0] === 0 && Math.abs(hw2[1] + 0.03) < 1e-9, `滑动保留历史，实际 ${hw2}`);
    const w3 = settleTick({ ssot: w2, step: empty }).ssot;
    assert.equal(w3.entities.find((e) => e.id === 'e_court').hurtWindow, undefined, '全 0 后删字段');
});

test('K15：三态结算后世界过 SSOT schema（hurtWindow 字段合法）', () => {
    const r = settleTick({ ssot: TREE, step: pushSon({ stateChanges: [hurt(-0.06)] }) });
    const vr = validate(r.ssot, ssotSchema);
    assert.equal(vr.ok, true, vr.errors.join('; '));
    const w2 = settleTick({ ssot: TREE, step: pushSon({ newAgendas: [na('e_lead', '分粮', { type: 'parent', ref: 'a_son1' })] }) });
    const vr2 = validate(w2.ssot, ssotSchema);
    assert.equal(vr2.ok, true, vr2.errors.join('; '));
});