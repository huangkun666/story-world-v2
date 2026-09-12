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
    // leg25 c：这六位原先各带一份 `attrs`（高分/低分样本），用来证明"分量高低不影响保送序"。
    //   四维浮点已删（schema 不再接受该键），而本用例真正依赖的是 **weights 缓存**（下一行仍在给），
    //   所以把 attrs 摘掉、只留 weights——断言意图（分量不影响保送）一字不改地保住了。
    const entities = [
        ent('e_hi', '高分者', 'character'),
        ent('e_lo', '低分者', 'character'),
        ent('e_wave', '被波及者', 'character'),
        ent('e_owner', '有盘算者', 'character'),
        ent('e_act', '近活跃者', 'character', { lastActiveTick: 9 }),
        ent('e_old', '久未动者', 'character', { lastActiveTick: 0 }),
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

test('K44: 麾下成员打包——parent=势力名/分支名 双向归属，名号序 top8+等N人；无成员不带字段', () => {
    const members = Array.from({ length: 12 }, (_, i) => ent(`m_${i}`, `弟子${i}`, 'character', { parent: i % 2 === 0 ? '青龙会' : '盐帮' }));
    const entities = [
        ent('f_main', '青龙会', 'faction', { branches: ['盐帮', '漕帮'] }),
        ent('f_other', '白莲教', 'faction'),
        ...members,
    ];
    const weights = {};
    // 故意让分量序 **反向** 于名号序：若实现偷偷按分量排，下面的断言必红（leg25 b A1 的守卫）
    members.forEach((m, i) => { weights[m.id] = i / 100; });
    weights.f_main = 0.9; weights.f_other = 0.9;
    const w = mkWorld({ entities, weights });
    const p = buildEvolutionPack(w, null);
    const row = p.pack.entities.find((x) => x.name === '青龙会');
    assert.ok(row.members, '青龙会应有麾下成员');
    // 名号序（Unicode 码点序）：弟子0 < 弟子1 < 弟子10 < 弟子11 < 弟子2 …
    assert.deepEqual(row.members.slice(0, 5), ['弟子0', '弟子1', '弟子10', '弟子11', '弟子2'], '麾下序=名号序（与分量无关）');
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
    // ★leg32c：序尾新增 `closedAgendas`（已了结盘算台账——最可牺牲的一段，最后才裁）
    // ★leg32g：再增 `idleFaces`（待启用名单——**整段丢**，不截短：名单靠轮转保证公平）
    const order = ['entities.slim', 'entities.idOnly', 'recentClosedEvents', 'pendingEvents', 'agendas.detail', 'closedAgendas', 'idleFaces'];
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
    assert.deepEqual(cut, ['entities.slim', 'entities.idOnly', 'recentClosedEvents', 'pendingEvents', 'agendas.detail', 'closedAgendas', 'idleFaces', 'budgetOverrun'], '固定序走完仍越界 → 追加越界痕迹');
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
    // ★leg32c：新增 `closedAgendas`（已了结盘算台账）——键序由 pack 字面量决定，此处如实锁上
    // ★leg32g：新增 `idleFaces`（待启用名单）
    assert.deepEqual(Object.keys(p.pack), ['world', 'tension', 'setting', 'positions', 'entities', 'agendas', 'pendingEvents', 'recentClosedEvents', 'playerMove', 'dialogueBook', 'closedAgendas', 'idleFaces']);
});

// ---------- leg25：**端到端**裁剪路径（真实 runTick 车道，不只是直调 buildEvolutionPack）----------
// 为什么要有这一则：裁剪只在"真的超预算"时才执行，小世界冒烟/现有集成用例永远走不到那条分支，
//   于是裁剪路径上的任何错误（悬空的辅助名、写错的字段）都会在单测里隐形、只在真实长跑里炸。
//   本用例把超预算世界喂进 runTick（tick.js:14 → buildEvolutionPack → trimPack），端到端锁死该路径。
// ★leg31 夹具重造（实体段表达法收改后**旧夹具已结构性失效**，实测见下）：
//   旧夹具 = "1500 个无成员实体"硬吃预算。改动后实体行成本减半 ⇒ 该夹具 est 只有 20,396（不超）。
//   ★但**单纯加行数不可能救回它**：`lensList` 自带 `LENS_DEFAULT_MAX_TOKENS=30000` 的独立上限、
//     逐行截前缀 ⇒ 实测 pad 2000/2500/3000 时镜头只装 1817/1783/1776 行、实体段自我封顶 ~24,900，
//     整包**永远够不到 30,000**（pad 3000 时 est 仍 24,852）。故必须按 `trimPack` 的**剪枝设计**造夹具：
//     ①成员满的势力（`members` 是它第一刀要逐出的重字段）②未决事件 ③在飞盘算（带 memory，第五刀要砍的）。
//   实测挑选（六种配置，本文件外真账复现）：势力300/事件300/盘算300 ⇒ trimmed 前四刀全中、est 落回 28,247。
test('leg25: runTick 端到端——超预算世界不炸且全程落在预算内（裁剪路径进集成车道）', async () => {
    const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/golden-world.min.json', import.meta.url), 'utf8'));
    const world = structuredClone(GOLDEN);
    const base = world.entities[0];                          // e_merchant（大荒商帮 @ 临渊城）
    // ① 成员满的势力：members 是 trimPack 第一刀（entities.slim）要逐出的字段 —— 不这样造就触发不了剪枝
    const ROSTER = Array.from({ length: 60 }, (_, i) => `成员${i}号长名字`);
    const pad = Array.from({ length: 300 }, (_, i) => ({
        ...structuredClone(base), id: `e_pad_${i}`, kind: 'faction', name: `守卫${i}号长名为了吃预算`,
        branches: [`分舵甲${i}`, `分舵乙${i}`], organs: [`堂口${i}`], members: ROSTER,
    }));
    world.entities = [...world.entities, ...pad];
    // ② 未决事件（第四刀 pendingEvents）③ 在飞盘算带 memory（第五刀 agendas.detail）
    //   ⚠必须是**追加**而不是覆盖：本用例的 step 引用 golden 世界里原有的 `a_1` 盘算，
    //   覆盖掉 agendas 会让"超预算世界不炸"这条断言红成"未知盘算 a_1"（与裁剪路径无关的假红）。
    world.events = [...(world.events || []), ...Array.from({ length: 300 }, (_, i) => ({
        id: `ev_pad_${i}`, title: `未决事件${i}号长标题为了吃预算`, source: { type: 'plot', ref: 'a_1' }, position: '临渊城', closed: false,
    }))];
    world.agendas = [...(world.agendas || []), ...Array.from({ length: 300 }, (_, i) => ({
        id: `a_pad_${i}`, owner: `e_pad_${i}`, goal: `谋划第${i}件事的长目标描述为了吃预算`, stage: '阶段', visibility: 'known',
        progress: 1, maxSteps: 4, parentId: null, closed: false,
        memory: { promises: ['旧诺言甲', '旧诺言乙'], done: [], blocked: ['受阻原因'], turnsAlive: 3 },
    }))];
    world.weights = Object.fromEntries(world.entities.map((e) => [e.id, 0.5]));

    const p0 = buildEvolutionPack(world, null);              // 前提：这份世界真的触发了裁剪
    assert.ok(p0.pack.trimmed?.length > 0,
        `夹具必须真的超预算并触发剪枝（est=${p0.estTokens} / trimmed=${JSON.stringify(p0.pack.trimmed ?? null)}）——`
        + '若为空说明夹具又随世界成本变化而失效，须按 trimPack 的剪枝设计重造，**不许靠加行数硬堆**');

    const step = {
        actions: [{ entity: 'e_merchant', verb: '沿商路北上巡查', position: '商路' }],
        newEvents: [{ title: '守将允诺通关', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: ['e_merchant'] }],
        agendaAdvances: [{ agendaId: 'a_1', step: '守将首肯，车队放行', stage: '过边关' }],
        // leg25 c：原先这里还有一条 `stateChanges`（属性增量）——四维浮点整条删除后契约层也没有它了；
        //   本用例测的是"超预算裁剪的端到端路径"，与属性无关，删掉它不损失任何断言意图。
        newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = await runTick({ transport: async () => ({ text: JSON.stringify(step) }), ssot: world, dialogue: '（继续）' });
    assert.equal(r.ok, true, `超预算世界的 tick 不应炸：${r.error || ''}`);
    assert.ok(r.pack.estTokens <= EVOLUTION_BUDGET_TOKENS, `主调用输入 est=${r.pack.estTokens} 必须 ≤ 预算`);
    assert.ok(Array.isArray(r.pack.pack.trimmed) && r.pack.pack.trimmed.length > 0, '裁剪痕迹随包透出（模型/调试者可见）');
    assert.ok(r.streams.observer.length > 0, '双流照常渲染');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// ★★leg32g（用户：「还是不行啊，永远围绕那几个势力是为什么」）：**待启用名单**（`idleFaces`）。
//   量穿的闭环（真账 tick 38）：那几家出手 ⇒ `lastActiveTick` 常新 ⇒ 镜头永远排最前 ⇒ 模型总写他们；
//   而 613 人从没出过手 ⇒ 永远排最后 ⇒ 模型想不起他们（56 条事件只点名过 5 个实体）。
//   ⇒ 光喊"换镜头"没用（模型手上没有"该轮到谁"的名单）⇒ 引擎每轮**机械**递一小撮冷门名字进包。
//   判据锁三件：①筛选口径（排除在办/玩家/保送/刚出手/已被点名的）②**按 tick 轮转**（每轮换一批）
//   ③确定性（同一 world 两次出包逐字节一致——名单不许抖）。
// ★★leg32h（用户：「都是围绕一件事展开的，没有并行的效果」）：**陈旧死链头不进包**。
//   实测（真账 tick 50）：58 条事件里独立链头**只有 1 条**——「万法阁商队集结」**挂了 49 轮还开着**
//   （`state` 源按设计永不自动闭环），已无人牵动（ripples 只 1 人）却每轮占着模型眼前的未决池
//   ⇒ 模型永远只见"一个当下焦点" ⇒ 新势力只能挤进同一条线当配角 ⇒ 读起来"都围绕一件事"。
//   口径：**账上保留、不闭环**（那是世界的事实），只是别再让它占模型眼前的位子。
test('leg32h·陈旧死链头不进包（世界照旧留着它，只是不再占模型的焦点）', () => {
    const mk = (tick, ageOld) => mkWorld({
        entities: [ent('e_a', '甲', 'character'), ent('e_b', '乙', 'faction')],
        events: [
            // 老 state 事件（id 里的数字 = 出生 tick），只牵动 1 人 ⇒ 死链头
            { id: `ev_${tick - ageOld}_1`, title: '很久以前的集结', source: { type: 'state' }, position: '中央', ripples: ['e_a'], closed: false },
            // 刚起的 state 事件 ⇒ 照常进包（新链头要紧）
            { id: `ev_${tick}_1`, title: '刚起的事', source: { type: 'state' }, position: '中央', ripples: ['e_a'], closed: false },
            // 老 state 事件但**牵动 ≥2 人** ⇒ 仍进包（它还是活的线，不是死链头）
            { id: `ev_${tick - ageOld}_2`, title: '很多人牵涉的旧事', source: { type: 'state' }, position: '中央', ripples: ['e_a', 'e_b'], closed: false },
            // ripple 源不论多老都进包（它有上游，闭环走涟漪窗）
            { id: `ev_${tick - ageOld}_3`, title: '挂在别人因果上的旧事', source: { type: 'ripple', ref: `ev_${tick - 1}_1` }, position: '中央', ripples: ['e_a'], closed: false },
        ],
        agendas: [], tick,
    });
    const w = mk(50, 49);
    const ids = buildEvolutionPack(w, null).pack.pendingEvents.map((e) => e.id);
    assert.ok(!ids.includes('ev_1_1'), `★挂了 49 轮的死链头不该再进包：${JSON.stringify(ids)}`);
    assert.ok(ids.includes('ev_50_1'), '刚起的链头照常进包');
    assert.ok(ids.includes('ev_1_2'), '老但牵动多人的线仍进包（它还是活的）');
    assert.ok(ids.includes('ev_1_3'), 'ripple 源不论多老都进包（有上游，闭环另走涟漪窗）');
    // ★账上不许被删/被闭环：过滤只发生在"进包"这一步
    assert.equal(w.events.filter((e) => e.id === 'ev_1_1').length, 1, '老链头仍在账上');
    assert.equal(w.events.find((e) => e.id === 'ev_1_1').closed, false, '★不替世界闭环它（只不进包）');
});

test('leg32g·待启用名单：把"该轮到却没露过面的人"递到模型眼前（治"永远围绕那几个势力"）', () => {
    // 夹3：一个玩家 + 保送者 + 有在办者 + 刚出手者 + 若干冷门
    //   ★playerId 必须在**工厂里**就设好（本用例第一版把 `w.context.playerId = ...` 写在调用点，
    //   而 ④ 那一步是 `buildEvolutionPack(mk(10), null)` 直接调用 ⇒ **没设 playerId** ⇒ 玩家混进名单
    //   ⇒ 两次出包不一致的**假红**。教训：夹具的"世界状态"必须在工厂里一次成型，调用点不许补状态。
    const mk = (tick) => {
        const w = mkWorld({
            entities: [
                ent('e_top', '保送者', 'faction'),                       // 首个 active = 保送（永远可动）
                ent('e_player', '你', 'character'),
                ent('e_busy', '在办者', 'faction'),
                ent('e_fresh', '刚出手者', 'character', { lastActiveTick: tick - 1 }),
                ent('e_cold1', '冷门甲', 'character'),
                ent('e_cold2', '冷门乙', 'faction'),
                ent('e_cold3', '冷门丙', 'character'),
                ent('e_cold4', '冷门丁', 'character'),
                // 冷门池要**大于名单长度**，轮转才看得出来（否则 offset 恒 0 ⇒ 名单永远同一批）
                ...Array.from({ length: 20 }, (_, i) => ent(`e_rest${String(i).padStart(2, '0')}`, `闲人${i}`, 'character')),
            ],
            agendas: [{ id: 'a_1', owner: 'e_busy', goal: '在办的事', stage: 's', visibility: 'known', progress: 1, maxSteps: 3, closed: false, memory: { turnsAlive: 1 } }],
            events: [],
            tick,
        });
        w.context.playerId = 'e_player';
        return w;
    };
    const p = buildEvolutionPack(mk(10), null);
    const faces = p.pack.idleFaces;
    const ids = faces.map((f) => f.id);
    assert.ok(Array.isArray(faces) && faces.length > 0, `名单必须有内容：${JSON.stringify(faces)}`);
    // ⓪ 每条都要**带名字**（模型要"从名单里挑人"，光给 id 它无从判断谁是谁）
    for (const f of faces) {
        assert.ok(f.id && f.name, `名单每条要有 id+name：${JSON.stringify(f)}`);
        assert.ok(['faction', 'character'].includes(f.kind), `kind 要在册：${JSON.stringify(f)}`);
    }
    // ① 口径：在办 / 玩家 / 保送 / 刚出手 一律不在名单里
    for (const bad of ['e_busy', 'e_player', 'e_top', 'e_fresh']) {
        assert.ok(!ids.includes(bad), `★${bad} 不该出现在待启用名单里（它有别的出场路径）`);
    }
    // ② 冷门都在（本例只有 4 个冷门，全部入名单）
    for (const good of ['e_cold1', 'e_cold2', 'e_cold3', 'e_cold4']) {
        assert.ok(ids.includes(good), `冷门 ${good} 应在名单里`);
    }
    // ③ ★轮转：下一轮换一批人露头（同一批人不能永远霸着名单）
    const faces2 = buildEvolutionPack(mk(11), null).pack.idleFaces;
    assert.notDeepEqual(faces2.map((f) => f.id), ids, '★名单必须按 tick 轮转（否则又是"永远那几个"）');
    // ④ 确定性：同一 world 两次出包逐字节一致（名单不许抖）
    const again = buildEvolutionPack(mk(10), null).pack.idleFaces;
    assert.deepEqual(again, faces, `同一 tick 两次出包名单必须一致（first=${JSON.stringify(faces)} again=${JSON.stringify(again)}）`);
    // ⑤ 已被点名的（未决事件波及）不进名单——他有正当出场路径，别浪费名额
    const w3 = mk(10);
    w3.events = [{ id: 'ev_1', title: '事', source: { type: 'state' }, position: '中央', ripples: ['e_cold1'], closed: false }];
    assert.ok(!buildEvolutionPack(w3, null).pack.idleFaces.includes('e_cold1'), '被点名者不进名单（他已被解锁）');
});