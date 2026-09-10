// story-world-v2/test/lens.test.js
// K44（full-roster-lens-spec C2/C7/C8 拍板）：镜头选择器——全量棋盘有序入镜（保送+分量序、预算前缀）、
// 麾下成员打包（含分支成员）、P3 分量不泄漏、确定性锁。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEvolutionPack, lensList, trimPack, EVOLUTION_BUDGET_TOKENS } from '../src/pack.js';
import { runTick } from '../src/tick.js';

function mkWorld({ entities = [], weights = {}, events = [], agendas = [], tick = 0, moveFact = null } = {}) {
    return {
        context: { world: '测试', tension: 0.5, positions: ['中央'] },
        entities,
        weights,
        agendas,
        events,
        meta: { tick },
        moveFact,
    };
}

const ent = (id, name, kind, extra = {}) => ({ id, kind, name, location: '中央', ...extra });

test('K44: 全量入镜——现规模（350 实体）全部进入且 ≤ 镜头预算', () => {
    const entities = Array.from({ length: 350 }, (_, i) => ent(`e_${i}`, `名号${i}`, i % 3 === 0 ? 'faction' : 'character'));
    const weights = Object.fromEntries(entities.map((e, i) => [e.id, (i % 100) / 100]));
    const w = mkWorld({ entities, weights });
    const lens = lensList(w);
    assert.equal(lens.length, 350);                       // 无截断
    const p = buildEvolutionPack(w, null);
    assert.ok(p.estTokens <= EVOLUTION_BUDGET_TOKENS, `est=${p.estTokens}`);
    assert.equal(p.pack.entities.length, 350);
});

test('K44（片3 改写）: 保送优先——落子对象/未决波及/在飞属主/近 2 tick 活跃 置顶（判据已不看分量）', () => {
    const entities = [
        ent('e_hi', '高分者', 'character', { attrs: { hardPower: 0.9, network: 0.5, intel: 0.5, office: 0.5 } }),
        ent('e_lo', '低分者', 'character', { attrs: { hardPower: 0.05, network: 0.05, intel: 0.05, office: 0.05 } }),
        ent('e_wave', '被波及者', 'character', { attrs: { hardPower: 0.05, network: 0.05, intel: 0.05, office: 0.05 } }),
        ent('e_owner', '有盘算者', 'character', { attrs: { hardPower: 0.05, network: 0.05, intel: 0.05, office: 0.05 } }),
        ent('e_act', '近活跃者', 'character', { attrs: { hardPower: 0.05, network: 0.05, intel: 0.05, office: 0.05 }, lastActiveTick: 9 }),
        ent('e_old', '久未动者', 'character', { attrs: { hardPower: 0.9, network: 0.5, intel: 0.5, office: 0.5 }, lastActiveTick: 0 }),
    ];
    const w = mkWorld({
        entities,
        weights: { e_hi: 0.99, e_lo: 0.01, e_wave: 0.01, e_owner: 0.01, e_act: 0.01, e_old: 0.99 },
        events: [{ id: 'ev_1', title: '波及', ripples: ['e_wave'], closed: false }],
        agendas: [{ id: 'a_1', owner: 'e_owner', goal: '谋划', closed: false }],
        tick: 10,
        moveFact: { verb: '拜会', object: '低分者' },
    });
    const lens = lensList(w, { moveFact: w.moveFact });
    const names = lens.map((x) => x.e.name);
    const boosted = ['低分者', '被波及者', '有盘算者', '近活跃者'];
    assert.deepEqual([...names.slice(0, 4)].sort(), [...boosted].sort(), '前 4 位恰为保送/在办/近期出手者（分量高低不影响）');
    assert.ok(boosted.every((n) => names.indexOf(n) < names.indexOf('久未动者')), '久未出手者排在后面');
});

test('K44（片3 改写）: 非保送段=确定性结构序（在办盘算 → 近期出手 → 其余 id 序），零分量参与', () => {
    const entities = [ent('e_a', '甲', 'character'), ent('e_b', '乙', 'character'), ent('e_c', '丙', 'character')];
    // 故意给"甲"最高分量：旧法它会排第一；新法按 id 序 → 甲/乙/丙
    const weights = { e_a: 0.99, e_b: 0.2, e_c: 0.5 };
    const w = mkWorld({ entities, weights });
    const lens = lensList(w);
    assert.deepEqual(lens.map((x) => x.e.name), ['甲', '乙', '丙'], '第④段按 id 序（分量不参与）');
    // 有在办盘算者排到第②段最前（即使 id 靠后）
    const w2 = mkWorld({ entities, weights, agendas: [{ id: 'a_1', owner: 'e_c', goal: '谋划', closed: false }] });
    assert.equal(lensList(w2)[0].e.name, '丙', '第②段优先于 id 序');
    // 近期出手者排第③段（先于"其余"）
    const w3 = mkWorld({ entities: [ent('e_a', '甲', 'character'), ent('e_b', '乙', 'character', { lastActiveTick: 9 })], weights, tick: 10 });
    assert.deepEqual(lensList(w3).map((x) => x.e.name), ['乙', '甲'], '第③段优先于第④段');
    const p1 = buildEvolutionPack(w, null);
    const p2 = buildEvolutionPack(w, null);
    assert.equal(JSON.stringify(p1.pack), JSON.stringify(p2.pack), '确定性逐字节');
});

test('K44: 镜头预算截断机制——小预算只留前缀（首名保底，空镜防御）', () => {
    const entities = Array.from({ length: 20 }, (_, i) => ent(`e_${i}`, `名${i}`, 'character'));
    const w = mkWorld({ entities, weights: Object.fromEntries(entities.map((e) => [e.id, 1])) });
    const lens = lensList(w, { lensMaxTokens: 5 });
    assert.ok(lens.length >= 1 && lens.length < 20);
    assert.equal(lens[0].e.name, '名0');
});

test('K44: 麾下成员打包——parent=势力名/分支名 双向归属，分量序 top8+等N人；无成员不带字段', () => {
    const members = Array.from({ length: 12 }, (_, i) => ent(`m_${i}`, `弟子${i}`, 'character', { parent: i % 2 === 0 ? '青龙会' : '盐帮' }));
    const entities = [
        ent('f_main', '青龙会', 'faction', { branches: ['盐帮', '漕帮'] }),
        ent('f_other', '白莲教', 'faction'),
        ...members,
    ];
    const weights = {};
    members.forEach((m, i) => { weights[m.id] = (12 - i) / 100; });
    weights.f_main = 0.9; weights.f_other = 0.9;
    const w = mkWorld({ entities, weights });
    const p = buildEvolutionPack(w, null);
    const row = p.pack.entities.find((x) => x.name === '青龙会');
    assert.ok(row.members, '青龙会应有麾下成员');
    assert.equal(row.members[0], '弟子0');                       // 分量最高者（弟子0=12/100 最高且 parent=青龙会）
    assert.equal(row.members.length, 9);                          // top8 + 「等N人」
    assert.equal(row.members[8], '等12人');
    assert.ok(row.branches.length === 2);
    assert.equal(p.pack.entities.find((x) => x.name === '白莲教').members, undefined);
});

test('K44: P3 保持——分量数字不随行泄漏（包文本零 weight 键）', () => {
    const entities = [ent('e_a', '甲', 'character')];
    const w = mkWorld({ entities, weights: { e_a: 0.9 } });
    const p = buildEvolutionPack(w, null);
    assert.ok(!JSON.stringify(p.pack).includes('weight'));
});

// ---------- leg25：总预算强制（trimPack 死代码接线）----------

test('leg25: 超预算输入 → 按固定剪枝序裁剪、estTokens 落回预算内、pack.trimmed 留痕（机器可读）', () => {
    // 规模对标"名册增长吃掉余量"的真实轨迹：900 实体 + 300 未决事件 + 300 在飞盘算（带 memory）
    const ents = Array.from({ length: 900 }, (_, i) => ent(`e_${i}`, `名号${i}号长名为了吃预算`, 'character'));
    const events = Array.from({ length: 300 }, (_, i) => ({
        id: `ev_${i}`, title: `未决事件${i}`, source: { type: 'plot', ref: 'a_0' }, position: '中央', closed: false,
    }));
    events.push({ id: 'ev_c1', title: '已闭一', source: { type: 'plot', ref: 'a_0' }, position: '中央', closed: true });
    events.push({ id: 'ev_c2', title: '已闭二', source: { type: 'plot', ref: 'a_0' }, position: '中央', closed: true });
    const agendas = Array.from({ length: 300 }, (_, i) => ({
        id: `a_${i}`, owner: `e_${i}`, goal: `谋划第${i}件事的长目标描述`, stage: '阶段', visibility: 'known',
        progress: 1, maxSteps: 4, parentId: null, closed: false,
        memory: { promises: ['旧诺言甲', '旧诺言乙'], done: [], blocked: ['受阻原因'], turnsAlive: 3 },
    }));
    const mk = () => mkWorld({ entities: ents, events, agendas, tick: 10 });
    // 前提断言：这份输入确实**超过整包预算**（否则本用例什么都没测）。
    // 注意不能拿 p.pack 量——裁剪是就地改的，出包后 pack 里已是降级后的实体段；
    // 这里用同一镜头重建"未裁剪实体行"（与 pack.js 的 entityRow 同形），**先量体**再出包。
    const fullEntities = lensList(mk(), { moveFact: null }).map(({ e }) => {
        const row = { id: e.id, kind: e.kind, name: e.name, location: e.location };
        if (e.parent) row.parent = e.parent;
        if (e.kind === 'faction' && e.branches?.length) row.branches = e.branches;
        if (e.kind === 'faction' && e.organs?.length) row.organs = e.organs;
        return row;
    });
    const fullBody = { world: '测试', tension: 0.5, positions: ['中央'], entities: fullEntities, agendas, pendingEvents: events.filter((e) => !e.closed).map((e) => ({ id: e.id, title: e.title, source: e.source, position: e.position })), recentClosedEvents: [], playerMove: null, dialogueBook: [] };
    const fullEst = Math.ceil(JSON.stringify(fullBody).length / 3);
    assert.ok(fullEst > EVOLUTION_BUDGET_TOKENS, `夹具必须真的超预算（未裁剪 est=${fullEst}）`);

    const p = buildEvolutionPack(mk(), null);
    assert.ok(p.estTokens <= EVOLUTION_BUDGET_TOKENS, `裁剪后 est=${p.estTokens} 应 ≤ ${EVOLUTION_BUDGET_TOKENS}`);
    assert.ok(Array.isArray(p.pack.trimmed) && p.pack.trimmed.length > 0, `裁剪标记应非空：${JSON.stringify(p.pack.trimmed)}`);
    assert.ok(!p.pack.trimmed.includes('budgetOverrun'), '固定剪枝序应足够压进预算（不留越界痕迹）');
    // 固定剪枝序：必须是固定序的**前缀**（前项成立后续项才有意义）
    const order = ['entities.slim', 'entities.idOnly', 'recentClosedEvents', 'pendingEvents', 'agendas.detail'];
    assert.deepEqual(p.pack.trimmed, order.slice(0, p.pack.trimmed.length), `裁剪必须是固定序前缀：${JSON.stringify(p.pack.trimmed)}`);
    // 痕迹与内容一致：被裁的段确实是降级后的形态
    if (p.pack.trimmed.includes('entities.slim')) {
        assert.ok(!('members' in p.pack.entities[0]) && !('branches' in p.pack.entities[0]), '重可选字段已逐出');
    }
    if (p.pack.trimmed.includes('entities.idOnly')) {
        assert.deepEqual(Object.keys(p.pack.entities[0]), ['id', 'name'], '实体行只剩 id+name（人数=视野不丢）');
        assert.equal(p.pack.entities.length, 900, '镜头人数不变——裁的是细节，不是"谁在棋盘上"');
    }
    if (p.pack.trimmed.includes('recentClosedEvents')) {
        assert.deepEqual(Object.keys(p.pack.recentClosedEvents[0]), ['id']);
    }
    if (p.pack.trimmed.includes('pendingEvents')) {
        assert.deepEqual(Object.keys(p.pack.pendingEvents[0]), ['id', 'title']);
    }
    if (p.pack.trimmed.includes('agendas.detail')) {
        assert.deepEqual(Object.keys(p.pack.agendas[0]), ['id', 'goal', 'progress']);
        assert.equal(p.pack.agendas[0].memory, undefined, '盘算 memory（最重的一段）被裁');
    }
    // 确定性：同一输入两次出包逐字节一致（含 trimmed 痕迹）
    const p2 = buildEvolutionPack(mk(), null);
    assert.equal(JSON.stringify(p.pack), JSON.stringify(p2.pack), '裁剪结果逐字节确定');
});

test('leg25: 固定剪枝序用尽仍越界 → 留 budgetOverrun 痕迹（不许"已强制"变成空话）', () => {
    // 直接喂 trimPack 一个不可能达成的预算：三刀（实体降级 ×2 + 三段细节）用尽后仍越界
    const pack = {
        world: 'w', positions: ['中央'],
        entities: [{ id: 'e1', kind: 'character', name: '甲', location: '中央' }],
        agendas: [], pendingEvents: [], recentClosedEvents: [], playerMove: null, dialogueBook: [],
    };
    const cut = trimPack(pack, 1);
    assert.deepEqual(cut, ['entities.slim', 'entities.idOnly', 'recentClosedEvents', 'pendingEvents', 'agendas.detail', 'budgetOverrun'], '固定序走完仍越界 → 追加越界痕迹');
    assert.deepEqual(pack.trimmed, cut, '痕迹写进包里（机器可读）');
    assert.equal(pack.entities.length, 1, '越界也不清空视野（镜头人数不丢）');
});

test('leg25: 未超预算 → pack.trimmed 缺省（不写该键）、输出与旧版逐字节一致（防回归）', () => {
    const w = mkWorld({
        entities: [ent('e_a', '甲', 'character'), ent('e_b', '乙', 'faction')],
        events: [{ id: 'ev_1', title: '事', source: { type: 'plot', ref: 'a_1' }, position: '中央', closed: false }],
        agendas: [{ id: 'a_1', owner: 'e_a', goal: '谋划', stage: 's', visibility: 'known', progress: 1, maxSteps: 3, closed: false, memory: { turnsAlive: 1 } }],
        tick: 3,
    });
    const p = buildEvolutionPack(w, null);
    assert.ok(p.estTokens <= EVOLUTION_BUDGET_TOKENS);
    assert.equal('trimmed' in p.pack, false, '未裁剪不写 trimmed（缺省即"没删过"）');
    assert.deepEqual(p.pack.agendas[0].memory, { turnsAlive: 1 }, '盘算 memory 原样保留（未被裁）');
    assert.deepEqual(Object.keys(p.pack.pendingEvents[0]), ['id', 'title', 'source', 'position'], '未决事件详情原样保留');
    // 逐字节锁：与手工构造的"旧版出包形状"一致（键序=对象字面量序，无 trimmed 插入）
    assert.deepEqual(Object.keys(p.pack), ['world', 'tension', 'setting', 'positions', 'entities', 'agendas', 'pendingEvents', 'recentClosedEvents', 'playerMove', 'dialogueBook']);
});

// ---------- leg25：**端到端**裁剪路径（真实 runTick 车道，不只是直调 buildEvolutionPack）----------
// 为什么要有这一则：裁剪只在"真的超预算"时才执行，小世界冒烟/现有集成用例永远走不到那条分支，
//   于是裁剪路径上的任何错误（悬空的辅助名、写错的字段）都会在单测里隐形、只在真实长跑里炸。
//   本用例把超预算世界喂进 runTick（tick.js:14 → buildEvolutionPack → trimPack），端到端锁死该路径。
test('leg25: runTick 端到端——超预算世界不炸且全程落在预算内（裁剪路径进集成车道）', async () => {
    const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/golden-world.min.json', import.meta.url), 'utf8'));
    const world = structuredClone(GOLDEN);
    const base = world.entities[0];                          // e_merchant（大荒商帮 @ 临渊城）
    const pad = Array.from({ length: 1500 }, (_, i) => ({
        ...structuredClone(base), id: `e_pad_${i}`, name: `守卫${i}号长名为了吃预算`,
    }));
    world.entities = [...world.entities, ...pad];
    world.weights = Object.fromEntries(world.entities.map((e) => [e.id, 0.5]));

    const p0 = buildEvolutionPack(world, null);              // 前提：这份世界真的超预算
    assert.ok(p0.pack.trimmed?.length > 0, `夹具必须真的超预算（trimmed=${JSON.stringify(p0.pack.trimmed)}）`);

    const step = {
        actions: [{ entity: 'e_merchant', verb: '沿商路北上巡查', position: '商路' }],
        newEvents: [{ title: '守将允诺通关', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: ['e_merchant'] }],
        agendaAdvances: [{ agendaId: 'a_1', step: '守将首肯，车队放行', stage: '过边关' }],
        stateChanges: [{ entity: 'e_merchant', attr: 'network', delta: 0.05, cause: 'a_1' }],
        newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = await runTick({ transport: async () => ({ text: JSON.stringify(step) }), ssot: world, dialogue: '（继续）' });
    assert.equal(r.ok, true, `超预算世界的 tick 不应炸：${r.error || ''}`);
    assert.ok(r.pack.estTokens <= EVOLUTION_BUDGET_TOKENS, `主调用输入 est=${r.pack.estTokens} 必须 ≤ 预算`);
    assert.ok(Array.isArray(r.pack.pack.trimmed) && r.pack.pack.trimmed.length > 0, '裁剪痕迹随包透出（模型/调试者可见）');
    assert.ok(r.streams.observer.length > 0, '双流照常渲染');
});