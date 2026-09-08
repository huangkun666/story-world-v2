// story-world-v2/test/chain.test.js
// K40/链视图细案 §3.2 → A-15：上承回溯到根（ripple 逐跳 / plot 盘算弧线 / state 终节点 / 里程碑聚合穿透）、
// 下沿全分支（出生序 / 归档余尾收敛珠）、三态防御（未知 id / 空世界 / 环防 / 悬空）、确定性锁。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandChain } from '../src/chain.js';

// 江州热世界（全局形状合法；编年/分量不参与展开，无需种子）
const mainWorld = () => ({
    version: 1,
    context: { world: '江州', tension: 0.5, positions: ['江州'] },
    entities: [
        { id: 'e_gov', kind: 'faction', name: '江州官府', location: '江州', attrs: { office: 0.6 } },
        { id: 'e_du', kind: 'character', name: '大虞偏将', location: '江州', attrs: { hardPower: 0.7 } },
    ],
    weights: {},
    agendas: [
        { id: 'a_1', owner: 'e_gov', goal: '筹备江州防务', stage: '征集', visibility: 'known', maxSteps: 5, progress: 2, memory: { promises: ['a_2'], done: ['t1: 征调商行出力'], blocked: [], turnsAlive: 2 } },
        { id: 'a_2', owner: 'e_du', goal: '打通边关商路', stage: '通商', visibility: 'known', maxSteps: 4, progress: 1, parentId: 'a_1', memory: { promises: ['a_3'], done: ['t1: 守将首肯，车队放行'], blocked: [], turnsAlive: 1 } },
        { id: 'a_3', owner: 'e_du', goal: '借夜禁压商', stage: '谋划', visibility: 'concealed', maxSteps: 4, progress: 0, parentId: 'a_2', memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } },
    ],
    events: [
        { id: 'ev_2_1', title: '边关商路重开', source: { type: 'plot', ref: 'a_2' }, position: '江州', ripples: ['e_du'], links: { up: [], down: [] }, closed: false },
        { id: 'ev_3_1', title: '官军出城引发恐慌', source: { type: 'ripple', ref: 'ev_2_1' }, position: '江州', ripples: ['e_du'], links: { up: ['ev_2_1'], down: [] }, closed: false },
        { id: 'ev_3_2', title: '江州粮价上涨', source: { type: 'ripple', ref: 'ev_3_1' }, position: '江州', ripples: ['e_du'], links: { up: ['ev_3_1'], down: [] }, closed: true, closedAt: 5 },
        { id: 'ev_4_1', title: '万法阁密使入城', source: { type: 'ripple', ref: 'ev_3_1' }, position: '江州', ripples: ['e_wg'], links: { up: ['ev_3_1'], down: [] }, closed: false },
        { id: 'ev_4_2', title: '坊市夜禁', source: { type: 'ripple', ref: 'ev_3_2' }, position: '江州', ripples: ['e_gov'], links: { up: ['ev_3_2'], down: [] }, closed: false },
    ],
    chronicle: [],
    milestones: [],
    meta: { tick: 6 },
});

test('A-15① 上承：ripple 逐跳 + plot 遇盘算弧线（委派链/产果/子盘算在弧线上）', () => {
    const r = expandChain(mainWorld(), 'ev_3_1');
    assert.equal(r.ok, true);
    assert.equal(r.root.kind, 'event');
    assert.equal(r.root.title, '官军出城引发恐慌');
    assert.equal(r.root.position, '江州');
    assert.equal(r.root.born, 3);
    assert.equal(r.root.closed, false);
    // 上承（最远在前）：[弧线(a_2), 事件(ev_2_1)]——a_1 在弧线的委派链 parents 里
    assert.equal(r.up.length, 2, JSON.stringify(r.up));
    assert.equal(r.up[0].kind, 'agenda');
    assert.equal(r.up[0].id, 'a_2');
    assert.equal(r.up[0].goal, '打通边关商路');
    assert.equal(r.up[0].doneTail, 't1: 守将首肯，车队放行');
    assert.equal(r.up[0].blockedTail, null);
    assert.equal(r.up[0].parents.length, 1, '委派链上承到顶层');
    assert.equal(r.up[0].parents[0].id, 'a_1');
    assert.equal(r.up[0].parents[0].closed, false);
    assert.equal(r.up[0].children.length, 1, '暗处子盘算在弧线下沿');
    assert.equal(r.up[0].children[0].id, 'a_3');
    assert.equal(r.up[0].children[0].visibility, 'concealed');
    assert.equal(r.up[0].fruits.length, 1, '产果清单');
    assert.equal(r.up[0].fruits[0].id, 'ev_2_1');
    assert.equal(r.up[1].kind, 'event');
    assert.equal(r.up[1].id, 'ev_2_1');
});

test('A-15② 下沿：全分支递归（出生序）+ 闭环徽 + 再牵动', () => {
    const r = expandChain(mainWorld(), 'ev_3_1');
    assert.equal(r.down.length, 2, '两条直接牵动（按出生序）');
    assert.equal(r.down[0].id, 'ev_3_2');
    assert.equal(r.down[0].closed, true, '闭环徽数据');
    assert.equal(r.down[0].children.length, 1, '再牵动');
    assert.equal(r.down[0].children[0].id, 'ev_4_2');
    assert.equal(r.down[1].id, 'ev_4_1');
    assert.equal(r.down[1].children.length, 0);
});

test('A-15① 上承：state 终节点 / 悬空 gap', () => {
    const w = mainWorld();
    w.events.push({ id: 'ev_5_1', title: '天时大变', source: { type: 'state' }, position: '江州', ripples: [], links: { up: [], down: [] }, closed: false });
    w.events.push({ id: 'ev_5_2', title: '旧事回响', source: { type: 'ripple', ref: 'ev_zzz' }, position: '江州', ripples: [], links: { up: ['ev_zzz'], down: [] }, closed: false });
    const r1 = expandChain(w, 'ev_5_1');
    assert.equal(r1.up.length, 1);
    assert.equal(r1.up[0].kind, 'state-root', 'state 到「由世界处境而生」为止');
    const r2 = expandChain(w, 'ev_5_2');
    assert.equal(r2.up.length, 1);
    assert.equal(r2.up[0].kind, 'gap', '悬空引用=gap（沿旧事而来）');
    assert.equal(r2.up[0].reason, 'missing');
});

test('A-15① 里程碑聚合穿透：上溯遇归档段 → 纪节点沿 m.links.up 继续，空 → 纪之源头终节点', () => {
    const w = mainWorld();
    w.events = [w.events.find((e) => e.id === 'ev_3_1')];   // 只留 root（其上游 ev_2_1 已归档）
    w.milestones = [
        { id: 'm_30', span: { from: 1, to: 30 }, counts: { events: 7 }, titles: ['穷山的来客'], ids: ['ev_0_1', 'ev_1_1'], links: { up: [], down: [] } },
        { id: 'm_40', span: { from: 1, to: 40 }, counts: { events: 9 }, titles: ['边关商路重开'], ids: ['ev_2_1'], links: { up: ['m_30'], down: ['ev_3_1'] } },
    ];
    const r = expandChain(w, 'ev_3_1');
    assert.equal(r.up.length, 1, 'root 之上：[纪 m_40]（root=ev_3_1 本身不在 up 内）');
    assert.equal(r.up[0].kind, 'milestone');
    assert.equal(r.up[0].id, 'm_40');
    assert.equal(r.up[0].titles[0], '边关商路重开');
    assert.equal(r.up[0].ids.includes('ev_2_1'), true, '纪保 ids 可回溯');
    assert.equal(r.up[0].parents.length, 1, '沿聚合指针继续上溯');
    assert.equal(r.up[0].parents[0].kind, 'milestone');
    assert.equal(r.up[0].parents[0].id, 'm_30');
    assert.equal(r.up[0].parents[0].parents.length, 1);
    assert.equal(r.up[0].parents[0].parents[0].kind, 'terminal', '纪之源头已不可查');
    assert.equal(r.up[0].parents[0].parents[0].reason, 'ms-root');
    // 下沿：root 被 m_40.links.down 点名 → 余尾收敛珠
    assert.equal(r.down.some((d) => d.kind === 'leaf-note' && d.milestoneId === 'm_40'), true, '归档引用方收敛为旧卷余尾');
});

test('A-15① 已归档 root：大事纪 ids 入口 → 纪节点为根，下沿=纪内余尾', () => {
    const w = mainWorld();
    w.events = w.events.filter((e) => e.id !== 'ev_2_1');   // ev_2_1 已归档（热池不在）
    w.milestones = [{ id: 'm_40', span: { from: 1, to: 40 }, counts: { events: 9 }, titles: ['边关商路重开'], ids: ['ev_2_1'], links: { up: [], down: [] } }];
    const r = expandChain(w, 'ev_2_1');
    assert.equal(r.ok, true);
    assert.equal(r.root.kind, 'milestone');
    assert.equal(r.root.id, 'm_40');
    assert.equal(r.up.length, 0, '纪节点自带 parents，无独立上承段');
    assert.equal(r.root.parents.length, 1, '纪之源头终节点在纪的 parents');
    assert.equal(r.root.parents[0].kind, 'terminal');
    assert.equal(r.down.length, 1);
    assert.equal(r.down[0].kind, 'leaf-note');
    assert.equal(r.down[0].archivedRoot, true);
});

test('A-15③ 防御：环防（人工互指）上溯/下沿均终止且有标记', () => {
    const w = mainWorld();
    w.events = [
        { id: 'ev_a', title: '甲事', source: { type: 'ripple', ref: 'ev_b' }, position: '江州', ripples: [], links: { up: ['ev_b'], down: [] }, closed: false },
        { id: 'ev_b', title: '乙事', source: { type: 'ripple', ref: 'ev_a' }, position: '江州', ripples: [], links: { up: ['ev_a'], down: [] }, closed: false },
    ];
    const r = expandChain(w, 'ev_a');
    assert.equal(r.ok, true);
    assert.equal(r.up.length, 2, '[gap(ring), 事件 ev_b]');
    assert.equal(r.up[0].kind, 'gap');
    assert.equal(r.up[0].reason, 'ring');
    assert.equal(r.up[1].id, 'ev_b');
    assert.equal(r.down.length, 1);
    assert.equal(r.down[0].id, 'ev_b');
    assert.equal(r.down[0].children.length, 1);
    assert.equal(r.down[0].children[0].ring, true, '下沿环防标记');
});

test('A-15③ 防御：未知 id / 空世界 → ok:false', () => {
    assert.equal(expandChain(mainWorld(), 'ev_zzz').ok, false);
    assert.equal(expandChain(mainWorld(), 'm_99').ok, false);
    const empty = { version: 1, context: { world: 'x', tension: 0.5, positions: ['x'] }, entities: [], weights: {}, agendas: [], events: [], chronicle: [], meta: { tick: 0 } };
    assert.equal(expandChain(empty, 'ev_1_1').ok, false);
});

test('A-15④ 确定性：同输入两次展开逐字节一致', () => {
    const w = mainWorld();
    const a = expandChain(w, 'ev_3_1');
    const b = expandChain(w, 'ev_3_1');
    assert.equal(JSON.stringify(a), JSON.stringify(b), '链展开纯函数逐字节确定');
});