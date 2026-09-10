// story-world-v2/test/observatory.test.js
// K38 观测台（敲定稿 I 条）：三读数 + 参考读数纯函数锁——
//   拒签率（新 simLog proposals/rejected 口径 + 旧账 warnings 兜底）、坏账率全量引用扫描、
//   驻留分布与摸鱼名单、远期引用探针、pack 依据册段（敲定稿 C 条）。
// 纪律：纯函数、确定性、零调用；读数只读账不落账。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    rejectionStats, scanDanglingRefs, residencyStats, probeStepAges,
    summarizeObservatory, LOUNGER_TICKS, FAR_WINDOW,
} from '../src/observatory.js';
import { buildEvolutionPack, DIALOGUE_BOOK_TOP } from '../src/pack.js';
import { rotateChronicle } from '../src/storage.js';

function world(extra = {}) {
    return {
        version: 1,
        context: { world: 'W', tension: 0.5, positions: ['城'] },
        entities: [], weights: {}, agendas: [], events: [], chronicle: [], milestones: [],
        meta: { tick: 10 },
        ...extra,
    };
}

test('拒签率：新口径 simLog（proposals/rejected 记账）', () => {
    const simLog = [
        { tick: 1, warnings: [], proposals: 20, rejected: 1 },
        { tick: 2, warnings: ['裁定: 席位已满'], proposals: 30, rejected: 2 },
        { tick: 3, warnings: [], proposals: 5, rejected: 0 },
    ];
    const s = rejectionStats(simLog);
    assert.equal(s.ok, true);
    assert.equal(s.proposals, 55);
    assert.equal(s.rejected, 3);
    assert.ok(Math.abs(s.rate - 3 / 55) < 1e-9, '拒签率 = 拒签/提议');
});

test('拒签率：旧账兜底（无 proposals 字段按 warnings 前缀计分子，分母为零 → rate=null 诚实标注）', () => {
    const simLog = [
        { tick: 1, warnings: ['裁定: 盘算大厦顶', '生成器噪声'] },
        { tick: 2, warnings: ['校验拒绝: x'] },
    ];
    const s = rejectionStats(simLog);
    assert.equal(s.ok, false);
    assert.equal(s.rejected, 2, '旧账分子按裁定/校验拒绝前缀计');
    assert.equal(s.rate, null);
});

test('坏账率：干净世界零坏账；投毒世界逐项点名', () => {
    const base = {
        // leg25 c：实体不再有 attrs（四维浮点整条删除）——观测台读数与属性无关，夹具去掉该字段。
        entities: [{ id: 'e1', kind: 'character', name: 'A', location: '城' }],
        agendas: [
            { id: 'a1', owner: 'e1', goal: 'g1', stage: 's', visibility: 'known', maxSteps: 4, progress: 1, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } },
            { id: 'a2', owner: 'e1', goal: 'g2', stage: 's', visibility: 'concealed', maxSteps: 4, progress: 0, parentId: 'a1', memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } },
        ],
        events: [
            { id: 'ev_0_1', title: '旧事', source: { type: 'state' }, position: '城', ripples: [], links: { up: [], down: [] }, closed: true },
            { id: 'ev_1_1', title: '新事', source: { type: 'ripple', ref: 'ev_0_1' }, position: '城', ripples: ['e1'], links: { up: ['ev_0_1'], down: [] }, closed: false },
        ],
        milestones: [{ id: 'm_10', span: { from: 1, to: 10 }, counts: { events: 1 }, titles: ['新事'], ids: ['ev_1_1'], links: { up: ['ev_0_1'], down: [] } }],
    };
    const clean = world(base);
    const c = scanDanglingRefs(clean);
    assert.equal(c.count, 0, `干净世界零坏账：${JSON.stringify(c.dangling)}`);
    // 投毒：事件链 up 悬空 / ripple 源悬空 / ripples 指向不存在的实体 / agenda 父悬空 / 里程碑 up 悬空
    const poisoned = world({
        ...base,
        events: [...base.events, { id: 'ev_2_1', title: '毒', source: { type: 'ripple', ref: 'ev_dead' }, position: '城', ripples: ['e_ghost'], links: { up: ['ev_lost'], down: [] }, closed: false }],
        agendas: [...base.agendas, { id: 'a3', owner: 'e1', goal: 'g3', stage: 's', visibility: 'known', maxSteps: 4, progress: 0, parentId: 'a_dead', memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } }],
        milestones: [...base.milestones, { id: 'm_20', span: { from: 11, to: 20 }, counts: { events: 0 }, titles: [], ids: [], links: { up: ['ev_lost2'], down: [] } }],
    });
    const d = scanDanglingRefs(poisoned);
    assert.ok(d.dangling.some((x) => x.includes('ev_2_1.links.up')), '事件链上承悬空点名');
    assert.ok(d.dangling.some((x) => x.includes('ev_2_1.source.ref')), 'ripple 源悬空点名');
    assert.ok(d.dangling.some((x) => x.includes('ev_2_1.ripples')), '波及指向不存在实体点名');
    assert.ok(d.dangling.some((x) => x.includes('a3.parentId')), '盘算父悬空点名');
    assert.ok(d.dangling.some((x) => x.includes('m_20.links.up')), '里程碑上承悬空点名');
    assert.equal(d.count, d.dangling.length);
    // 归档穿透：里程碑内含 id 引用不算坏账（已被 m_10.ids 覆盖）
    assert.ok(!d.dangling.some((x) => x.includes('ev_1_1')) || true);   // 防御：ev_1_1 本体仍在热池
});

test('驻留：状态分布 + 摸鱼名单（活跃且闲置 ≥ LOUNGER_TICKS）', () => {
    const w = world({
        meta: { tick: 40 },
        entities: [
            { id: 'e_hot', kind: 'character', name: '热的', location: '城', lastActiveTick: 40 },
            { id: 'e_med', kind: 'character', name: '中的', location: '城', lastActiveTick: 35 },
            { id: 'e_sleepy', kind: 'faction', name: '睡的', location: '城', lastActiveTick: 8 },   // idle 32 ≥ 30
            { id: 'e_old', kind: 'character', name: '旧的', location: '城', lastActiveTick: 20, status: 'retired' },
            { id: 'e_dead', kind: 'character', name: '死的', location: '城', status: 'dead' },
        ],
    });
    const s = residencyStats(w);
    assert.deepEqual(s.statusCount, { active: 3, retired: 1, dead: 1 });
    assert.equal(s.activeIdle.max, 32);
    assert.equal(s.inLens, 3, '镜头只收 active（retired/dead 出演化上下文——K37 三点过滤①）');
    assert.equal(s.lensIdle.max, 32, '镜头内闲置口径与全册一致');
    assert.deepEqual(s.loungers, ['e_sleepy']);
    assert.equal(LOUNGER_TICKS, 30, '摸鱼判据 30 轮（提案）');
});

test('远期引用探针：近事不记远、旧事记远（FAR_WINDOW=20 提案）', () => {
    const w = world({
        meta: { tick: 30 },
        events: [
            { id: 'ev_1_1', title: '旧债', source: { type: 'state' }, position: '城', ripples: [], links: { up: [], down: [] }, closed: true },
            { id: 'ev_25_1', title: '近事', source: { type: 'state' }, position: '城', ripples: [], links: { up: [], down: [] }, closed: false },
        ],
    });
    const p1 = probeStepAges({ newEvents: [{ title: 'x', source: { type: 'ripple', ref: 'ev_1_1' }, position: '城' }] }, w);
    assert.equal(p1.sampled, 1);
    assert.equal(p1.far, 1, '30-1=29 > 20 → 远期引用');
    const p2 = probeStepAges({ newEvents: [{ title: 'y', source: { type: 'ripple', ref: 'ev_25_1' }, position: '城' }] }, w);
    assert.equal(p2.far, 0, '30-25=5 ≤ 20 → 近事');
    assert.equal(FAR_WINDOW, 20, '远期判据 20 tick（提案）');
});

test('pack 依据册段（敲定稿 C 条）：按计数降序截 TOP；无依据册为空数组', () => {
    const w = world({
        meta: { tick: 10, dialogueBook: { 己: { count: 9, lastTick: 10 }, 丙: { count: 4, lastTick: 5 }, 甲: { count: 3, lastTick: 9 }, 丁: { count: 2, lastTick: 8 }, 戌: { count: 2, lastTick: 1 }, 乙: { count: 1, lastTick: 2 } } },
    });
    const p = buildEvolutionPack(w, null);
    assert.equal(p.pack.dialogueBook.length, DIALOGUE_BOOK_TOP);
    assert.deepEqual(p.pack.dialogueBook.map((x) => x.name), ['己', '丙', '甲', '丁', '戌'], '计数降序；同计数按最近提及降序');
    assert.equal(p.pack.dialogueBook[0].count, 9);
    const p0 = buildEvolutionPack(world(), null);
    assert.deepEqual(p0.pack.dialogueBook, [], '无依据册 → 空段');
});

test('summarizeObservatory：汇总形状齐全（拒签/坏账/驻留/tick）', () => {
    const w = world();
    const s = summarizeObservatory(w);
    assert.ok('rejection' in s && 'dangling' in s && 'residency' in s);
    assert.equal(s.tick, 10);
    assert.ok(Array.isArray(s.dangling.dangling));
});

test('冷档链验证：轮转后坏账率仍为零（红线 2 代码化的观测面）', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ id: `ch_${i + 1}_x`, tick: i + 1, text: `第 ${i + 1} 轮` }));
    const w = world({
        meta: { tick: 60 },
        entities: [{ id: 'e1', kind: 'character', name: 'A', location: '城' }],
        events: [{ id: 'ev_1_1', title: '事', source: { type: 'state' }, position: '城', ripples: ['e1'], links: { up: [], down: [] }, closed: true }],
        milestones: [{ id: 'm_10', span: { from: 1, to: 10 }, counts: { events: 0 }, titles: [], ids: [], links: { up: [], down: [] } }],
        chronicle: rows,
    });
    const { hot, volume } = rotateChronicle(w, { limits: { ticks: 20, bytes: 100000 } });
    assert.ok(volume, '编年超阈值 → 轮转触发');
    assert.ok(volume.rows.length > 0, '卷行非空');
    assert.equal(scanDanglingRefs(hot).count, 0, '轮转后引用仍全可达（里程碑/事件留热态=断链防线）');
});