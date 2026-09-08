// story-world-v2/test/birth.test.js
// K14 验收（盘算树细案 §3.2/§3.3/§4 K14 → A-2/A-3/A-4/A-5）：出生裁判——静默滤除（gate 联动）、
// GC 上限（每 tick ≤2 / 在飞 ≤15 / 顶层 ≤5 超限拒建）、挂因落账+编年（处境/因事/委派）、父 promises 写
// （A-5 前半）、环检测自动拆（防御性：blocked 写 + 编年留痕）、子达成兑现落痕（A-5 后半）。
// 夹具：tree-world.json（分量差三实体 0.9/0.6/0.2 + 父盘算在飞 + 双子在飞 + 未决事件可挂因，细案 §5）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settleTick } from '../src/settle.js';
import { gateWorldStep } from '../src/gate.js';
import { buildEvolutionPack } from '../src/pack.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

const TREE = JSON.parse(readFileSync(new URL('./fixtures/tree-world.json', import.meta.url), 'utf8'));

const na = (entity, goal, source, extra = {}) => ({ entity, goal, visibility: 'known', source, ...extra });
const emptyStep = (newAgendas) => ({ actions: [], newEvents: [], agendaAdvances: [], stateChanges: [], newAgendas, agendaCancels: [], newEntities: [], entityFates: [] });

test('K14/A-2：静默方提议被 gate 滤除（双面无痕：不落账、不编年、simLog 审计计数）', () => {
    const r = settleTick({ ssot: TREE, step: emptyStep([na('e_min', '夺旗', { type: 'state' })]) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.deepEqual(r.ssot.meta.simLog[0].silent, ['e_min']);
    assert.deepEqual(r.ssot.meta.simLog[0].silentDropped, { e_min: 1 }, 'newAgendas 滤除计入审计');
    assert.equal(r.ssot.agendas.length, 3, '不落账');
    assert.ok(!r.ssot.chronicle.some((c) => c.text.includes('由处境而生')), '不编年');
});

test('K14/A-2：被点名应答方（lifted）可以提议——gate 透传 + settle 落账', () => {
    const world = structuredClone(TREE);
    world.events[0].ripples = ['e_min'];
    const step = emptyStep([na('e_min', '夺旗', { type: 'state' })]);
    const g = gateWorldStep(step, world);
    assert.deepEqual(g.lifted, ['e_min']);
    assert.equal(g.step.newAgendas.length, 1, '提议透传');
    const r = settleTick({ ssot: world, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.equal(r.ssot.agendas.find((a) => a.goal === '夺旗')?.id, 'a_1_1', '应答方提议落账');
});

test('K14/A-3：每 tick 新生 ≤2——第三条拒建 + 警告，前两条照常', () => {
    const step = emptyStep([
        na('e_lead', '整军', { type: 'state' }),
        na('e_court', '运粮', { type: 'state' }),
        na('e_lead', '募新兵', { type: 'state' }),
    ]);
    const r = settleTick({ ssot: TREE, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.equal(r.ssot.agendas.length, 5, '3 旧 + 2 新');
    assert.ok(r.ssot.agendas.some((a) => a.goal === '整军') && r.ssot.agendas.some((a) => a.goal === '运粮'));
    assert.ok(!r.ssot.agendas.some((a) => a.goal === '募新兵'), '第三条被拒');
    assert.ok(r.stage.warnings.some((x) => x.includes('盘算大厦顶（每 tick 新生 ≤2')), r.stage.warnings.join('; '));
    assert.equal(r.ssot.agendas.filter((a) => a.id.startsWith('a_1_')).length, 2);
});

test('K14/A-3：在飞全局 ≤15——顶满时新提议拒建，世界其余照常', () => {
    const world = structuredClone(TREE);
    for (let i = 0; i < 14; i++) {
        world.agendas.push({
            id: `a_bulk_${i}`, owner: i % 2 ? 'e_lead' : 'e_court', goal: `旁务${i}`, stage: '进行',
            visibility: 'known', maxSteps: 5, progress: 0, parentId: 'a_root',
            memory: { promises: [], done: [], blocked: [], turnsAlive: 1 },
        });
    }   // a_root + 14 子 = 15 在飞；顶层 1（未顶）
    const step = emptyStep([na('e_lead', '越限谋划', { type: 'state' })]);
    const r = settleTick({ ssot: world, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.ok(r.stage.warnings.some((x) => x.includes('盘算大厦顶（在飞全局 ≤15')), r.stage.warnings.join('; '));
    assert.ok(!r.ssot.agendas.some((a) => a.goal === '越限谋划'), '不落账');
});

test('K14/A-3：顶层 ≤5——顶层顶满时 state 源（顶层）拒、parent 源（子）过', () => {
    const world = structuredClone(TREE);
    for (let i = 0; i < 4; i++) {
        world.agendas.push({
            id: `a_top_${i}`, owner: i % 2 ? 'e_lead' : 'e_court', goal: `顶层务${i}`, stage: '进行',
            visibility: 'known', maxSteps: 5, progress: 0,
            memory: { promises: [], done: [], blocked: [], turnsAlive: 1 },
        });
    }   // a_root + a_top_0..3 = 5 顶层
    const step = emptyStep([
        na('e_court', '新顶层', { type: 'state' }),
        na('e_court', '新子务', { type: 'parent', ref: 'a_root' }),
    ]);
    const r = settleTick({ ssot: world, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.ok(r.stage.warnings.some((x) => x.includes('盘算大厦顶（顶层 ≤5')), r.stage.warnings.join('; '));
    assert.ok(!r.ssot.agendas.some((a) => a.goal === '新顶层'), '顶层上限拒建');
    assert.ok(r.ssot.agendas.some((a) => a.goal === '新子务'), '子盘算不受顶层上限约束');
});

test('K14/A-4：三层深链合法落账（parentId 逐层挂接，深链不设限）', () => {
    const s1 = emptyStep([na('e_lead', '夺关', { type: 'state' })]);
    const w1 = settleTick({ ssot: TREE, step: s1 }).ssot;
    const s2 = emptyStep([na('e_court', '围粮', { type: 'parent', ref: 'a_1_1' })]);
    const w2 = settleTick({ ssot: w1, step: s2 }).ssot;
    const s3 = emptyStep([na('e_court', '断援', { type: 'parent', ref: 'a_2_1' })]);
    const w3 = settleTick({ ssot: w2, step: s3 }).ssot;
    const a1 = w3.agendas.find((a) => a.id === 'a_1_1');
    const a2 = w3.agendas.find((a) => a.id === 'a_2_1');
    const a3 = w3.agendas.find((a) => a.id === 'a_3_1');
    assert.ok(a1 && !a1.parentId, '顶层无父');
    assert.equal(a2.parentId, 'a_1_1');
    assert.equal(a3.parentId, 'a_2_1');
});

test('K14/A-5 前半：委派落痕——父 promises 记子 id + 编年"委派"；event/state 源各有措辞；schema 过检；pack 含 parentId', () => {
    const step = emptyStep([
        na('e_lead', '亲征', { type: 'event', ref: 'ev_open' }),
        na('e_court', '筹粮', { type: 'parent', ref: 'a_root' }),
    ]);
    const r = settleTick({ ssot: TREE, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const w = r.ssot;
    const ev = w.agendas.find((a) => a.goal === '亲征');
    const pa = w.agendas.find((a) => a.goal === '筹粮');
    assert.equal(ev.id, 'a_1_1');
    assert.equal(pa.id, 'a_1_2');
    assert.equal(pa.parentId, 'a_root');
    assert.ok(w.agendas.find((a) => a.id === 'a_root').memory.promises.includes('a_1_2'), '父 promises 记子 id（A-5 前半）');
    const ch = w.chronicle.filter((c) => c.id.startsWith('ch_1_ag_'));
    assert.equal(ch.length, 2, JSON.stringify(ch));
    assert.ok(ch[0].text.includes('因事而生') && ch[0].text.includes('敌营异动'), ch[0].text);
    assert.ok(ch[1].text.includes('委派') && ch[1].text.includes('拆大给小'), ch[1].text);
    const vr = validate(w, ssotSchema);
    assert.equal(vr.ok, true, `落账后世界过 schema: ${vr.errors.join('; ')}`);
    const pack = buildEvolutionPack(w, null);
    assert.equal(pack.pack.agendas.find((a) => a.id === 'a_1_2').parentId, 'a_root', 'K13 补差：pack 在飞盘算含 parentId（树形可见）');
});

test('K14/A-4（防御）：新节点挂进既有环 → 最低分量方断边转独立（blocked 写 + 编年留痕 ≥1）', () => {
    const world = structuredClone(TREE);
    world.agendas.push(
        { id: 'a_cyc_x', owner: 'e_court', goal: '环甲', stage: '进行', visibility: 'known', maxSteps: 4, progress: 1, parentId: 'a_cyc_y', memory: { promises: [], done: [], blocked: [], turnsAlive: 1 } },
        { id: 'a_cyc_y', owner: 'e_lead', goal: '环乙', stage: '进行', visibility: 'known', maxSteps: 4, progress: 1, parentId: 'a_cyc_x', memory: { promises: [], done: [], blocked: [], turnsAlive: 1 } },
    );   // 手工错账环（现实不可达——parentId 不可变 + K13 校验；防御载体）
    const step = emptyStep([na('e_lead', '入环', { type: 'parent', ref: 'a_cyc_x' })]);
    const r = settleTick({ ssot: world, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const x = r.ssot.agendas.find((a) => a.id === 'a_cyc_x');
    const y = r.ssot.agendas.find((a) => a.id === 'a_cyc_y');
    assert.equal(x.parentId, undefined, '最低分量方（e_court 0.6）断父链转独立');
    assert.ok(x.memory.blocked.includes('拆环让路'), 'blocked 写入（清 blocked 写入执行债）');
    assert.equal(y.parentId, 'a_cyc_x', '环内高分方保留父链');
    assert.ok(r.ssot.chronicle.some((c) => c.text.includes('拆环') && c.text.includes('军师')), '编年留痕');
});

test('K14/A-4（防御）：分量相等按 progress 浅者先让', () => {
    const world = structuredClone(TREE);
    world.agendas.push(
        { id: 'a_cyc_x', owner: 'e_court', goal: '环甲', stage: '进行', visibility: 'known', maxSteps: 4, progress: 2, parentId: 'a_cyc_y', memory: { promises: [], done: [], blocked: [], turnsAlive: 1 } },
        { id: 'a_cyc_y', owner: 'e_court', goal: '环乙', stage: '进行', visibility: 'known', maxSteps: 4, progress: 1, parentId: 'a_cyc_x', memory: { promises: [], done: [], blocked: [], turnsAlive: 1 } },
    );
    const step = emptyStep([na('e_lead', '入环', { type: 'parent', ref: 'a_cyc_y' })]);
    const r = settleTick({ ssot: world, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const x = r.ssot.agendas.find((a) => a.id === 'a_cyc_x');
    const y = r.ssot.agendas.find((a) => a.id === 'a_cyc_y');
    assert.equal(y.parentId, undefined, '同分量 → progress 浅者（环乙）让路');
    assert.equal(x.parentId, 'a_cyc_y', 'progress 深者保留');
});

test('K14/A-5 后半：子满步达成 → 父 memory.done 记"兑现" + 编年', () => {
    const step = {
        actions: [], newEvents: [],
        agendaAdvances: [
            { agendaId: 'a_son1', step: '粮道探明', stage: '就绪' },
            { agendaId: 'a_son1', step: '押运启程', stage: '上路' },
        ],
        stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = settleTick({ ssot: TREE, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const w = r.ssot;
    const son = w.agendas.find((a) => a.id === 'a_son1');
    assert.equal(son.progress, 3);
    assert.equal(son.closed, true, '子满步达成');
    assert.ok(w.agendas.find((a) => a.id === 'a_root').memory.done.some((d) => d.includes('粮草调度')), '父 done 记兑现');
    assert.ok(w.chronicle.some((c) => c.text.includes('兑现') && c.text.includes('粮草调度')), '编年兑现落痕');
});

test('K14（K13 补差）：模型禁写玩家延伸——newAgendas.entity === playerId 校验拒绝，世界如实不动', () => {
    const world = structuredClone(TREE);
    world.context.playerId = 'e_player';
    world.entities.push({ id: 'e_player', kind: 'character', name: '黄坤', location: '主帐', attrs: { hardPower: 0.25, office: 0.05, network: 0.3, intel: 0.4 } });
    const step = emptyStep([na('e_player', '玩家的盘算', { type: 'state' })]);
    const r = settleTick({ ssot: world, step });
    assert.equal(r.ok, false);
    assert.ok(r.stage.warnings.some((x) => x.includes('禁写玩家')), r.stage.warnings.join('; '));
    assert.equal(r.ssot.agendas.length, 3, '世界如实不动');
});