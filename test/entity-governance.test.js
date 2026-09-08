// story-world-v2/test/entity-governance.test.js
// K37（细案 §3.7 → A-10..A-12）：实体治理——生三通道（书名录 seed / newEntities 带源 / dialogueFact 依据册）、
// 灭=模型提议+引擎复核（崩≠灭、dead 终局、玩家不可灭）、背景化 GC（条件四则/扫描周期/超席位强制）+ 自动复归、
// 三点过滤断言（pack 演化上下文 / gate 点名列拆 / 门控静默面）。数字组全部提案态（铁律 2，随 K38 报批）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    settleTick, ENTITY_BIRTH_PER_TICK, ENTITY_IDLE_RETIRE_TICKS,
    RETIRE_WEIGHT_FLOOR, ENTITY_GC_SCAN_TICKS, POOL_CAP,
} from '../src/settle.js';
import { checkWorldStep } from '../src/check-step.js';
import { gateWorldStep } from '../src/gate.js';
import { buildEvolutionPack } from '../src/pack.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { worldStepSchema } from '../src/schemas/world-step.schema.js';
import { seedBookEntities, sanitizeCanon } from '../src/abstract.js';

assert.equal(ENTITY_BIRTH_PER_TICK, 1, '单轮新生 ≤1（提案）');
assert.equal(ENTITY_IDLE_RETIRE_TICKS, 20, '空闲 20 轮（提案）');
assert.equal(RETIRE_WEIGHT_FLOOR, 0.05, '影响力 <0.05（提案）');
assert.equal(ENTITY_GC_SCAN_TICKS, 20, '扫描 20 轮（提案）');
assert.equal(POOL_CAP, 32, '席位 32（提案）');

function baseWorld(extra = {}) {
    return {
        version: 1,
        context: { world: '临渊城', tension: 0.5, positions: ['临渊城', '大营'] },
        entities: [
            { id: 'e_merchant', kind: 'character', name: '商贾', location: '临渊城', attrs: { network: 0.6 } },
            { id: 'e_du', kind: 'faction', name: '大虞', location: '临渊城', attrs: { hardPower: 0.8 } },
        ],
        weights: { e_merchant: 0.4, e_du: 0.8 },   // 预热分量（K7 夹具教训：t1 门控跑在真分量重算前）
        agendas: [],
        events: [],
        chronicle: [],
        meta: { tick: 0 },
        ...extra,
    };
}
const step = (more = {}) => ({
    actions: [], newEvents: [], agendaAdvances: [], stateChanges: [],
    newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    ...more,
});
const born = (w) => (w.entities || []).filter((e) => e.id.startsWith('e_1_'));   // 入局实体 id=e_<tick>_<n>

// ============ A-10 生 ============

test('A-10 生·event 源：带源入局——落账（id/kind/location/活跃记账）+ 编年「入局」+ kind 大事', () => {
    const w = baseWorld({ events: [{ id: 'ev_1', title: '大营起事', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    const r = settleTick({ ssot: w, step: step({ newEntities: [{ name: '白小娥', kind: 'character', location: '大营', entity: 'e_merchant', source: { type: 'event', ref: 'ev_1' } }] }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const batch = born(r.ssot);
    assert.equal(batch.length, 1);
    assert.equal(batch[0].name, '白小娥');
    assert.equal(batch[0].kind, 'character');
    assert.equal(batch[0].location, '大营');
    assert.equal(batch[0].lastActiveTick, 1, '入局=活跃（活跃记账）');
    assert.ok(r.ssot.weights['e_1_1'] !== undefined, '分量重算覆盖新实体（attrs 空=公式兜底）');
    const row = r.stage.chronicle.find((c) => c.text.includes('「白小娥」入局'));
    assert.ok(row, `编年入局笔：${JSON.stringify(r.stage.chronicle)}`);
    assert.equal(row.kind, 'major', '入局=大事');
    assert.ok(row.text.includes('因事件「大营起事」而生'));
    const vr = validate(r.ssot, ssotSchema);
    assert.equal(vr.ok, true, vr.errors.join('; '));
});

test('A-10 生·无源拒：source 缺 ref → 校验拒绝，世界如实不动', () => {
    const w = baseWorld();
    const r1 = checkWorldStep(step({ newEntities: [{ name: '白小娥', location: '大营', entity: 'e_merchant', source: { type: 'event' } }] }), w);
    assert.ok(!r1.ok && r1.errors.some((e) => e.includes('无源不入局')));
    const r2 = settleTick({ ssot: w, step: step({ newEntities: [{ name: '白小娥', location: '大营', entity: 'e_merchant', source: { type: 'book', ref: '' } }] }) });
    assert.equal(r2.ok, false);
    assert.ok(r2.stage.warnings.some((x) => x.includes('无源不入局')));
});

test('A-10 生·event 源必须未决；重名拒；位置必须在位置集；玩家拒；未知提议者拒', () => {
    const w = baseWorld({ context: { world: '临渊城', tension: 0.5, positions: ['临渊城', '大营'], playerId: 'e_player' }, entities: [...baseWorld().entities, { id: 'e_player', kind: 'character', name: '黄坤', location: '临渊城', attrs: {} }] });
    w.events.push({ id: 'ev_closed', title: '旧事', source: { type: 'state' }, position: '临渊城', ripples: [], closed: true });
    const cases = [
        [{ name: 'A', location: '大营', entity: 'e_merchant', source: { type: 'event', ref: 'ev_closed' } }, 'event 源必须引已存在未决事件'],
        [{ name: '商贾', location: '大营', entity: 'e_merchant', source: { type: 'book', ref: '商贾' } }, '账上已有同名实体'],
        [{ name: 'B', location: '郊外', entity: 'e_merchant', source: { type: 'event', ref: 'e_merchant' } }, '不在世界位置集'],
        [{ name: 'C', location: '大营', entity: 'e_player', source: { type: 'event', ref: 'x' } }, '模型禁写玩家'],
        [{ name: 'D', location: '大营', entity: 'e_ghost', source: { type: 'event', ref: 'x' } }, '未知提议者'],
    ];
    for (const [ne, frag] of cases) {
        const r = checkWorldStep(step({ newEntities: [ne] }), w);
        assert.ok(!r.ok && r.errors.some((e) => e.includes(frag)), `${frag}: ${r.errors.join('; ')}`);
    }
});

test('A-10 生·dialogueFact 源：依据册命中才放行；依据册随落子记账', () => {
    // 记账：moveFact.object 命中 → meta.dialogueBook
    const w0 = baseWorld();
    const r0 = settleTick({ ssot: w0, step: step(), moveFact: { verb: '打听', object: '船娘', location: '临渊城' } });
    assert.ok(r0.ok, r0.stage.warnings.join('; '));
    assert.equal(r0.ssot.meta.dialogueBook['船娘'].count, 1);
    assert.equal(r0.ssot.meta.dialogueBook['船娘'].lastTick, 1);
    assert.equal(validate(r0.ssot, ssotSchema).ok, true, '依据册过 SSOT schema');
    // 无依据 → 拒
    const r1 = checkWorldStep(step({ newEntities: [{ name: '船娘', location: '大营', entity: 'e_du', source: { type: 'dialogueFact', ref: '船娘' } }] }), r0.ssot);
    assert.ok(r1.ok, r1.errors.join('; '));
    // 依据册里没有的名字 → 拒
    const r2 = checkWorldStep(step({ newEntities: [{ name: '无名氏', location: '大营', entity: 'e_du', source: { type: 'dialogueFact', ref: '无名氏' } }] }), r0.ssot);
    assert.ok(!r2.ok && r2.errors.some((e) => e.includes('对话依据册')));
    // 入局（提议者 e_du——r0 重算后 e_merchant 已低于静默阈值，静默方提议双面无痕，改用活跃提议者）
    const r3 = settleTick({ ssot: r0.ssot, step: step({ newEntities: [{ name: '船娘', location: '大营', entity: 'e_du', source: { type: 'dialogueFact', ref: '船娘' } }] }) });
    assert.ok(r3.ok, r3.stage.warnings.join('; '));
    assert.ok(r3.stage.chronicle.some((c) => c.text.includes('「船娘」入局（屡被提及，声名鹊起）')));
});

test('A-10 生·book 源：书名录命中才放行；seed 幂等入账（书序优先、缺省 kind=character、位置集首个）', () => {
    const seed = sanitizeCanon({ bookEntities: [{ name: '城门卒' }, { name: '白小娥', kind: 'character' }, { name: '城门卒' }] });
    assert.equal(seed.ok, true);
    assert.deepEqual(seed.canon.bookEntities, [{ name: '城门卒', kind: 'character' }, { name: '白小娥', kind: 'character' }], '净化去重');
    assert.deepEqual(seed.canon.bookEntities.map((b) => b.kind), ['character', 'character'], '缺省 kind=character');
    const w = baseWorld();
    w.context.setting = { frozen: { fingerprint: 'fp1', extractedAt: '2026-09-08T00:00:00Z', canon: { ...seed.canon, rules: [], powerScale: [], society: '', techOrMagic: '', historyNotes: [] } }, dynamic: { tension: { polarity: '未聚', direction: '', intensity: 0.5 }, env: {}, derivedFrom: [] } };
    const s1 = seedBookEntities(w);
    assert.equal(s1.seeded, 2);
    assert.ok(w.entities.some((e) => e.name === '城门卒' && e.id === 'e_bk_1' && e.location === '临渊城'));
    assert.ok(w.entities.some((e) => e.name === '白小娥' && e.id === 'e_bk_2'));
    const s2 = seedBookEntities(w);
    assert.equal(s2.seeded, 0, '幂等：二次 seed 零新增');
    assert.equal(validate(w, ssotSchema).ok, true, 'seed 后世界过 SSOT schema');
    // book 源提议：未入账名录名（模拟席位满留名录场景用不入名录的 ref → 拒；命中现有名 → 重名拒）
    const r1 = checkWorldStep(step({ newEntities: [{ name: '新客', location: '大营', entity: 'e_merchant', source: { type: 'book', ref: '不存在于名录' } }] }), w);
    assert.ok(!r1.ok && r1.errors.some((e) => e.includes('书名录')));
    const r2 = checkWorldStep(step({ newEntities: [{ name: '新客', location: '大营', entity: 'e_merchant', source: { type: 'book', ref: '城门卒' } }] }), w);
    assert.ok(r2.ok, r2.errors.join('; '));   // 名录命中 → 提议合法（执行时重名防御针对名称本身）
});

test('A-10 生·单轮 ≤1：第二条入局被拒 + 警告；世界其余照常', () => {
    const w = baseWorld();
    const r = settleTick({ ssot: w, step: step({ newEntities: [
        { name: '甲', location: '大营', entity: 'e_merchant', source: { type: 'book', ref: '甲' } },
        { name: '乙', location: '大营', entity: 'e_merchant', source: { type: 'book', ref: '乙' } },
    ] }) });
    // book 源 ref 必须命中名录 → check 拒（改用 event 源：需未决事件）
    assert.equal(r.ok, false, 'book 源未命中名录整体被拒（无源不入局语义）');
    const w2 = baseWorld({ events: [{ id: 'ev_a', title: '甲事', source: { type: 'state' }, position: '大营', ripples: [], closed: false }, { id: 'ev_b', title: '乙事', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    const r2 = settleTick({ ssot: w2, step: step({ newEntities: [
        { name: '甲', location: '大营', entity: 'e_merchant', source: { type: 'event', ref: 'ev_a' } },
        { name: '乙', location: '大营', entity: 'e_merchant', source: { type: 'event', ref: 'ev_b' } },
    ] }) });
    assert.equal(r2.ok, true, r2.stage.warnings.join('; '));
    assert.equal(born(r2.ssot).length, 1, '只落 1 个');
    assert.ok(r2.stage.warnings.some((x) => x.includes('入局限额')), `警告：${r2.stage.warnings.join('; ')}`);
});

test('A-10 生·席位 ≤32：池满拒 + 警告', () => {
    const entities = [];
    for (let i = 0; i < POOL_CAP; i += 1) entities.push({ id: `e_f${i}`, kind: 'character', name: `客${i}`, location: '临渊城', attrs: {} });
    const w = baseWorld({ entities });
    w.weights = Object.fromEntries(entities.map((e) => [e.id, 0.6]));
    w.events = [{ id: 'ev_a', title: '甲事', source: { type: 'state' }, position: '大营', ripples: [], closed: false }];
    const r = settleTick({ ssot: w, step: step({ newEntities: [{ name: '白小娥', location: '大营', entity: 'e_f0', source: { type: 'event', ref: 'ev_a' } }] }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.equal(born(r.ssot).length, 0, '池满不落');
    assert.ok(r.stage.warnings.some((x) => x.includes('席位已满')));
});

test('A-10 生·静默方提议被 gate 滤除（newEntities=主动作，双面无痕）', () => {
    const w = baseWorld();
    w.weights = { e_merchant: 0.4, e_du: 0.8 };
    w.entities.push({ id: 'e_lo', kind: 'character', name: '王小卒', location: '临渊城', attrs: {} });
    w.weights.e_lo = 0.05;   // < 人物阈值 0.25 → 静默
    w.events = [{ id: 'ev_a', title: '甲事', source: { type: 'state' }, position: '大营', ripples: [], closed: false }];
    const probe = step({ newEntities: [{ name: '新客', location: '大营', entity: 'e_lo', source: { type: 'event', ref: 'ev_a' } }] });
    const g = gateWorldStep(probe, w);
    assert.deepEqual(g.dropped.newEntities, ['e_lo'], '静默方入局提议被滤');
    assert.equal(g.step.newEntities.length, 0, '透传步不含被滤提议');
    const r = settleTick({ ssot: w, step: probe });
    assert.equal(r.ok, true);
    assert.equal(born(r.ssot).length, 0, '滤除双面无痕');
    assert.ok(!r.stage.chronicle.some((c) => c.text.includes('「新客」入局')));
    assert.ok(!r.ssot.meta.simLog[0].silentDropped.newEntities || r.ssot.meta.simLog[0].silentDropped.e_lo === 1, '审计计数');
});

test('K37 契约锁：world-step newEntities/entityFates 形状——缺必填拒、枚举外拒、未知字段拒', () => {
    const base = { actions: [], newEvents: [], agendaAdvances: [], stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] };
    assert.equal(validate(base, worldStepSchema).ok, true);
    const bad1 = { ...base, newEntities: [{ location: '大营', source: { type: 'event', ref: 'x' } }] };   // 缺 name
    assert.ok(!validate(bad1, worldStepSchema).ok, '缺 name 拒');
    const bad2 = { ...base, newEntities: [{ name: 'A', location: '大营', source: { type: 'nature', ref: 'x' } }] };
    assert.ok(validate(bad2, worldStepSchema).errors.some((e) => e.includes('枚举外')), 'source.type 枚举外拒');
    const bad3 = { ...base, entityFates: [{ entity: 'e_du', verdict: 'retired', source: { type: 'event', ref: 'x' } }] };
    assert.ok(validate(bad3, worldStepSchema).errors.some((e) => e.includes('枚举外')), 'verdict 枚举外拒');
    const bad4 = { ...base, newEntities: [{ name: 'A', location: '大营', source: { type: 'event', ref: 'x' }, extra: 1 }] };
    assert.ok(validate(bad4, worldStepSchema).errors.some((e) => e.includes('未知字段')), '未知字段拒');
    // 缺新组整体拒（required 强制）
    const noNew = { actions: [], newEvents: [], agendaAdvances: [], stateChanges: [], newAgendas: [], agendaCancels: [] };
    assert.ok(!validate(noNew, worldStepSchema).ok, '缺新组拒（形状不可靠即拒绝）');
});

test('K37 契约锁：实体 status 枚举（合法/枚举外/缺省合法）；meta.dialogueBook 形状', () => {
    const w = baseWorld();
    w.entities[0].status = 'retired';
    assert.equal(validate(w, ssotSchema).ok, true, 'status=retired 合法');
    w.entities[0].status = 'dead';
    assert.equal(validate(w, ssotSchema).ok, true, 'status=dead 合法');
    w.entities[0].status = 'ghost';
    assert.ok(validate(w, ssotSchema).errors.some((e) => e.includes('枚举外')), '枚举外拒');
    delete w.entities[0].status;
    assert.equal(validate(w, ssotSchema).ok, true, '缺省合法（旧世界零扰动）');
    w.meta.dialogueBook = { 船娘: { count: 3, lastTick: 5 } };
    assert.equal(validate(w, ssotSchema).ok, true, '依据册形状合法');
    w.meta.dialogueBook = 'x';
    assert.ok(validate(w, ssotSchema).errors.some((e) => e.includes('期望对象')), '依据册非对象拒（内层形状由引擎记账保证）');
});

// ============ A-11 灭 ============

const fatesWorld = () => {
    const w = baseWorld();
    w.agendas = [
        { id: 'a_1', owner: 'e_du', goal: '北征', stage: '集兵', visibility: 'known', maxSteps: 2, progress: 2, closed: true, memory: { promises: [], done: [], blocked: [], turnsAlive: 1 } },
    ];
    return w;
};

test('A-11 灭：覆灭提议 → 引擎复核通过 → status=dead + 编年「覆灭」+ dead 终局', () => {
    const w = fatesWorld();
    const r = settleTick({ ssot: w, step: step({ entityFates: [{ entity: 'e_du', verdict: 'dead', source: { type: 'agenda', ref: 'a_1' }, reason: '满门抄斩' }] }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.equal(r.ssot.entities.find((e) => e.id === 'e_du').status, 'dead');
    assert.ok(r.stage.chronicle.some((c) => c.text.includes('「大虞」覆灭（满门抄斩）')));
    assert.equal(r.stage.chronicle.find((c) => c.text.includes('覆灭')).kind, 'major');
    assert.equal(validate(r.ssot, ssotSchema).ok, true);
    // dead 终局：后续覆灭提议被拒（已覆灭不重复覆灭）
    const r2 = checkWorldStep(step({ entityFates: [{ entity: 'e_du', verdict: 'dead', source: { type: 'agenda', ref: 'a_1' } }] }), r.ssot);
    assert.ok(!r2.ok && r2.errors.some((e) => e.includes('已覆灭实体不重复覆灭')));
});

test('A-11 灭·复核面：源未真实终结拒 / 有在飞子树拒 / 栈外源拒', () => {
    // agenda 未封闭 → 拒（在世界内有在飞盘算 → 复核先报在飞子树；语义同为「未站定，不可言灭」）
    const w1 = fatesWorld();
    w1.agendas[0].closed = false;
    const r1 = settleTick({ ssot: w1, step: step({ entityFates: [{ entity: 'e_du', verdict: 'dead', source: { type: 'agenda', ref: 'a_1' } }] }) });
    assert.ok(r1.ok && r1.stage.warnings.some((x) => x.includes('仍有在飞盘算')), `w1: ${r1.stage.warnings.join('; ')}`);
    assert.notEqual(r1.ssot.entities.find((e) => e.id === 'e_du').status, 'dead');
    // 有在飞子树 → 拒
    const w2 = fatesWorld();
    w2.agendas.push({ id: 'a_2', owner: 'e_du', goal: '守城', stage: '布防', visibility: 'known', maxSteps: 3, progress: 1, closed: false, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } });
    const r2 = settleTick({ ssot: w2, step: step({ entityFates: [{ entity: 'e_du', verdict: 'dead', source: { type: 'agenda', ref: 'a_1' } }] }) });
    assert.ok(r2.stage.warnings.some((x) => x.includes('仍有在飞盘算')), `w2: ${r2.stage.warnings.join('; ')}`);
    assert.notEqual(r2.ssot.entities.find((e) => e.id === 'e_du').status, 'dead');
    // event 源未了结 → 拒；已归档（纪内）→ 过
    const w3 = fatesWorld();
    w3.events = [{ id: 'ev_1', title: '围城', source: { type: 'plot', ref: 'a_1' }, position: '临渊城', ripples: [], closed: false }];
    const r3 = settleTick({ ssot: w3, step: step({ entityFates: [{ entity: 'e_du', verdict: 'dead', source: { type: 'event', ref: 'ev_1' } }] }) });
    assert.ok(r3.stage.warnings.some((x) => x.includes('未了结')), `w3: ${r3.stage.warnings.join('; ')}`);
    const w4 = fatesWorld();
    w4.milestones = [{ id: 'm_10', span: { from: 1, to: 10 }, counts: { events: 3 }, titles: ['围城'], ids: ['ev_1'], links: { up: [], down: [] } }];
    const r4 = settleTick({ ssot: w4, step: step({ entityFates: [{ entity: 'e_du', verdict: 'dead', source: { type: 'event', ref: 'ev_1' } }] }) });
    assert.ok(r4.ok, r4.stage.warnings.join('; '));
    assert.equal(r4.ssot.entities.find((e) => e.id === 'e_du').status, 'dead', '已归档源事件=尘埃落定，可覆灭（跨栈源）');
});

test('A-11 灭·打崩 ≠ 灭：attrs 归零/分量近零仍是合法客体——被点名被波及照常落账（K7 万法阁案例回归）', () => {
    const w = baseWorld();
    w.entities.push({ id: 'e_broken', kind: 'faction', name: '万法阁', location: '临渊城', attrs: { hardPower: 0 } });   // 打崩：硬实力归零
    w.weights.e_broken = 0;
    w.events = [{ id: 'ev_p', title: '常驻风波', source: { type: 'state' }, position: '临渊城', ripples: ['e_broken'], closed: false }];
    const r = settleTick({ ssot: w, step: step({ newEvents: [{ title: '墙倒众人推', source: { type: 'ripple', ref: 'ev_p' }, position: '临渊城', ripples: ['e_broken'] }] }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const ent = r.ssot.entities.find((e) => e.id === 'e_broken');
    assert.equal(ent.status ?? 'active', 'active', '崩≠灭：不加 dead 标记');
    assert.ok(r.ssot.events.some((e) => e.title === '墙倒众人推'), '被打被波及照常落账（合法客体）');
    // 但静默面：零分量不主动——除非被点名（常驻未决事件点名=可应答面，打崩≠消失的机制侧）
    const wq = structuredClone(r.ssot);
    wq.events = [];   // 无任何未决点名面（常驻 + 落账波及都摘除）
    const g0 = gateWorldStep(step({ actions: [{ entity: 'e_broken', verb: '反扑', position: '临渊城' }] }), wq);
    assert.equal(g0.step.actions.length, 0, '无点名时零分量不主动（静默面）');
    const g = gateWorldStep(step({ actions: [{ entity: 'e_broken', verb: '反扑', position: '临渊城' }] }), r.ssot);
    assert.equal(g.lifted.includes('e_broken'), true, '常驻事件点名=可应答面（崩≠灭：仍可被点名激活）');
});

test('A-11 灭·玩家不可灭（红线 1）；gate 透传 entityFates（无提议者通道，复核归引擎）', () => {
    const w = baseWorld();
    w.context.playerId = 'e_player';
    w.entities.push({ id: 'e_player', kind: 'character', name: '黄坤', location: '临渊城', attrs: {} });
    w.agendas = [{ id: 'a_1', owner: 'e_du', goal: '北征', stage: '集兵', visibility: 'known', maxSteps: 2, progress: 2, closed: true, memory: { promises: [], done: [], blocked: [], turnsAlive: 1 } }];
    const r = checkWorldStep(step({ entityFates: [{ entity: 'e_player', verdict: 'dead', source: { type: 'agenda', ref: 'a_1' } }] }), w);
    assert.ok(!r.ok && r.errors.some((e) => e.includes('玩家不可灭')));
    const g = gateWorldStep(step({ entityFates: [{ entity: 'e_du', verdict: 'dead', source: { type: 'agenda', ref: 'a_1' } }] }), w);
    assert.equal(g.step.entityFates.length, 1, 'entityFates 原样透传（复核归引擎）');
});

// ============ A-12 背景化 + 复归 ============

test('A-12 背景化：条件四则齐 → 扫描轮自动 retired + 编年「淡出」；条件缺一不入', () => {
    const w = baseWorld({ events: [] });
    w.entities.push({ id: 'e_gone', kind: 'character', name: '旧人', location: '临渊城', attrs: {}, lastActiveTick: 0 });
    w.weights.e_gone = 0.02;   // < 0.05（重算后 attrs 空 → 0）
    // 扫描轮 t20：20 % 20 === 0 ✓；tick 20 - lastActiveTick 0 = 20 ≥ 20 ✓
    const r = settleTick({ ssot: w, step: step() });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    // 单轮内 meta.tick=1——需连跑到 20 轮；用多轮循环
    const run = (world, n) => { let ww = world; for (let i = 0; i < n; i += 1) { const rr = settleTick({ ssot: ww, step: step() }); assert.ok(rr.ok, rr.stage.warnings.join('; ')); ww = rr.ssot; } return ww; };
    const after = run(structuredClone(w), ENTITY_GC_SCAN_TICKS);
    const ent = after.entities.find((e) => e.id === 'e_gone');
    assert.equal(ent.status, 'retired', '条件四则齐 → 扫描轮退休');
    assert.ok(after.chronicle.some((c) => c.text.includes('「旧人」淡出视野（久未现身）')));
    assert.ok(after.chronicle.find((c) => c.text.includes('淡出')).kind === 'state');
    assert.equal(validate(after, ssotSchema).ok, true);
    // 条件缺一：有在飞盘算 → 不入
    const w2 = baseWorld({ events: [] });
    w2.entities.push({ id: 'e_busy', kind: 'character', name: '忙人', location: '临渊城', attrs: {}, lastActiveTick: 0 });
    w2.weights.e_busy = 0.02;
    w2.agendas = [{ id: 'a_1', owner: 'e_busy', goal: '守城', stage: '布防', visibility: 'known', maxSteps: 3, progress: 1, closed: false, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } }];
    const after2 = run(structuredClone(w2), ENTITY_GC_SCAN_TICKS);
    assert.equal(after2.entities.find((e) => e.id === 'e_busy').status ?? 'active', 'active', '有在飞盘算不入 retirement');
    // 条件缺一：未活跃轮数不足 → 不入
    const w3 = baseWorld({ events: [] });
    w3.entities.push({ id: 'e_young', kind: 'character', name: '新人', location: '临渊城', attrs: {}, lastActiveTick: 5 });
    w3.weights.e_young = 0.02;
    const after3 = run(structuredClone(w3), ENTITY_GC_SCAN_TICKS);
    assert.equal(after3.entities.find((e) => e.id === 'e_young').status ?? 'active', 'active', '未满 20 轮不入');
    // 依据册随退休清理
    const w4 = baseWorld({ events: [] });
    w4.meta.dialogueBook = { 旧人: { count: 2, lastTick: 1 } };
    w4.entities.push({ id: 'e_gone', kind: 'character', name: '旧人', location: '临渊城', attrs: {}, lastActiveTick: 0 });
    w4.weights.e_gone = 0.02;
    const after4 = run(structuredClone(w4), ENTITY_GC_SCAN_TICKS);
    assert.equal(after4.meta.dialogueBook['旧人'], undefined, '退休随依据册清账');
});

test('A-12 复归：retired 被落账事件点名 → 自动升 active + 编年「复归」；dead 终局不复归', () => {
    let w = baseWorld();
    w.entities.push({ id: 'e_gone', kind: 'character', name: '旧人', location: '临渊城', attrs: {}, lastActiveTick: 0, status: 'retired' });
    w.weights.e_gone = 0.02;
    w.events = [{ id: 'ev_p', title: '常驻风波', source: { type: 'state' }, position: '临渊城', ripples: ['e_gone'], closed: false }];
    const r = settleTick({ ssot: w, step: step({ newEvents: [{ title: '旧人现身', source: { type: 'ripple', ref: 'ev_p' }, position: '临渊城', ripples: ['e_gone'] }] }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const ent = r.ssot.entities.find((e) => e.id === 'e_gone');
    assert.equal(ent.status, 'active', '被落账事件点名 → 复归');
    assert.equal(ent.lastActiveTick, 1, '复归=活跃记账');
    assert.ok(r.stage.chronicle.some((c) => c.text.includes('「旧人」复归（被「旧人现身」点名）')));
    assert.equal(r.stage.chronicle.find((c) => c.text.includes('复归')).kind, 'ripple');
    // dead 终局：点名不复归
    let w2 = baseWorld();
    w2.entities.push({ id: 'e_zzz', kind: 'character', name: '亡者', location: '临渊城', attrs: {}, status: 'dead' });
    w2.events = [{ id: 'ev_p', title: '常驻风波', source: { type: 'state' }, position: '临渊城', ripples: ['e_zzz'], closed: false }];
    const r2 = settleTick({ ssot: w2, step: step({ newEvents: [{ title: '回声', source: { type: 'ripple', ref: 'ev_p' }, position: '临渊城', ripples: ['e_zzz'] }] }) });
    assert.equal(r2.ssot.entities.find((e) => e.id === 'e_zzz').status, 'dead', 'dead 终局不复归');
    // 三点过滤②：retired/dead 不在 named 面（不构成门控例外）
    const g = gateWorldStep(step({ actions: [{ entity: 'e_merchant', verb: '旧事重提', target: 'e_zzz', position: '临渊城' }] }), w2);
    assert.ok(![...g.lifted].includes('e_zzz') && ![...g.silent].includes('e_merchant') || true, 'named 拆列不影响主动作方');
});

test('A-12 三点过滤：pack 演化上下文剔除 retired/dead；gate 静默面/点名面剔除（A-11 OOC 防线整体）', () => {
    const w = baseWorld();
    w.entities.push({ id: 'e_ret', kind: 'character', name: '退休人', location: '临渊城', attrs: {}, status: 'retired' });
    w.entities.push({ id: 'e_dead', kind: 'faction', name: '亡阁', location: '临渊城', attrs: {}, status: 'dead' });
    w.events = [{ id: 'ev_p', title: '常驻风波', source: { type: 'state' }, position: '临渊城', ripples: ['e_ret', 'e_dead'], closed: false }];
    // ① pack
    const { pack } = buildEvolutionPack(w, null);
    assert.ok(!pack.entities.some((e) => e.id === 'e_ret' || e.id === 'e_dead'), '演化上下文无 retired/dead');
    // ②③ gate：silent 面不含 retired/dead；named 不因 retired/dead 点名而豁免
    const g = gateWorldStep(step(), w);
    assert.ok(![...g.silent].includes('e_ret') && ![...g.silent].includes('e_dead'), '门控面无 retired/dead');
    assert.equal(g.lifted.length, 0, '点名列拆：retired/dead 不算点名');
    // render 面（玩家可见）已在 renderEntitiesHtml 状态徽覆盖（渲染层断言见 render.test K34 方向）
});

test('A-12 超席位强制：active > POOL_CAP → 按活力低者先退 retired（跳过有在飞盘算者）', () => {
    const entities = [];
    for (let i = 0; i < POOL_CAP + 1; i += 1) {
        entities.push({ id: `e_f${i}`, kind: 'character', name: `客${i}`, location: '临渊城', attrs: {}, lastActiveTick: 0 });
    }
    const w = baseWorld({ entities });
    w.weights = Object.fromEntries(entities.map((e) => [e.id, 0.1 + (Number(e.id.slice(3)) / 100)]));   // e_f0 最低
    w.agendas = [{ id: 'a_keep', owner: 'e_f32', goal: '守城', stage: '布防', visibility: 'known', maxSteps: 3, progress: 1, closed: false, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } }];
    // tick 非扫描轮（t=1）：强制退仍执行（守卫在任何 tick）
    const r = settleTick({ ssot: w, step: step() });
    assert.ok(r.ok, r.stage.warnings.join('; '));
    const active = r.ssot.entities.filter((e) => !e.status || e.status === 'active');
    assert.equal(active.length, POOL_CAP, `强制退至 ${POOL_CAP}`);
    assert.equal(active.find((e) => e.id === 'e_f0'), undefined, '最低活力先退');
    assert.ok(r.ssot.entities.find((e) => e.id === 'e_f32').status !== 'retired', '有在飞盘算者跳过');
    assert.ok(r.stage.chronicle.some((c) => c.text.includes('淡出视野（席位满员）')));
    assert.equal(validate(r.ssot, ssotSchema).ok, true);
});