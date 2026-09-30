// story-world-v2/test/archive.test.js
// K20 验收（因果链细案 §3.3 → A-3）：档案摘要化——闭环满热窗（ARCHIVE.hotWindow=20 提案）且无未决下游 →
// 按出生段压入里程碑（引擎结构摘要 T3-D1：span/counts/titles/ids + 指针修复）；未决/年轻/链活着不归档；
// 跨段指针重指里程碑（链条不断）；resolveEventSource 跨段防御；schema + 确定性。
// leg25 c 改写（用户令「删」四维浮点）：夹具实体不再带 `attrs`，世界步不再带 `stateChanges`
//   （契约层整条删除）——归档/指针修复逻辑本身不吃属性，故只删夹具里的死字段，断言一字未改。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleTick, ARCHIVE, resolveEventSource } from '../src/settle.js';
import { expandChain } from '../src/chain.js';   // ★leg111：链视图那一格（归档事件能不能"走进"）
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

const W = () => ({
    version: 1,
    context: { world: '边地', tension: 0.5, positions: ['边城', '大营'] },
    entities: [
        { id: 'e_x', kind: 'faction', name: '边军', location: '边城' },
    ],
    weights: {},
    agendas: [
        { id: 'a_1', owner: 'e_x', goal: '夺关', stage: '谋划', visibility: 'known', maxSteps: 2, progress: 0, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } },
        { id: 'a_2', owner: 'e_x', goal: '后援', stage: '谋划', visibility: 'known', maxSteps: 4, progress: 0, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } },
    ],
    events: [],
    chronicle: [],
    meta: { tick: 0 },
});

const empty = () => ({ actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] });
const step = (extra) => ({ ...empty(), ...extra });
const adv = (id) => ({ agendaId: id, step: '推进', stage: '中' });
const ev = (title, source, tickN) => ({ title, source, position: '边城', ripples: ['e_x'] });
const runner = (start) => {
    let world = start;
    return {
        world: () => world,
        run(s) { const r = settleTick({ ssot: world, step: s }); assert.equal(r.ok, true, r.stage.warnings.join('; ')); world = r.ssot; return r; },
        runN(n) { for (let i = 0; i < n; i++) this.run(empty()); },
        find(id) { return world.events.find((e) => e.id === id); },
        m(id) { return (world.milestones || []).find((x) => x.id === id); },
    };
};

test('K20/A-3 热窗与段分组：闭环满 20 tick → 按出生段入里程碑（span/counts/titles/ids 全量保真），年轻闭环不入', () => {
    const w = runner(W());
    w.run(step({ newEvents: [ev('夺关战起', { type: 'plot', ref: 'a_1' })], agendaAdvances: [adv('a_1')] }));      // t1
    w.run(step({ newEvents: [ev('敌援东来', { type: 'ripple', ref: 'ev_1_1' })], agendaAdvances: [adv('a_1')] }));  // t2：A 源结清
    w.runN(3);    // t3-5：B 于 t8 平息前（born2，窗 5）——B 仍年轻未满热窗
    w.runN(14);   // t6-19
    assert.equal(w.find('ev_1_1').closedAt, 2, 'A 闭环');
    assert.ok(w.find('ev_1_1') && w.find('ev_2_1'), 't19：热窗未满（2+20>19 / 8+20>19）→ 均在热池');
    w.run(empty());   // t20：A age 18、B age 12 → 仍未满窗
    assert.ok(w.find('ev_1_1'), 't20 仍不归档（age 18 < 20）');
    assert.ok(!w.m('m_10'), '无里程碑');
    w.runN(2);   // t21-22：A age 20 → 归档段 0（t1-10）
    assert.equal(w.find('ev_1_1'), undefined, 'A 出热池');
    assert.equal(w.m('m_10').counts.events, 1, 'm_10 含 1 事件');
    assert.deepEqual(w.m('m_10').ids, ['ev_1_1'], 'ids 保真（任取可回溯）');
    assert.deepEqual(w.m('m_10').titles, ['夺关战起'], 'titles 保真（结构摘要）');
    assert.deepEqual(w.m('m_10').span, { from: 1, to: 10 }, '段跨度 t1-10');
    assert.ok(w.find('ev_2_1'), 'B 年轻（closedAt 8 → t28 才到期）→ 仍在热池');
});

test('K20/A-3 链活着不归档：未决下游持续保护（涟漪延伸链），链收敛后立即归档', () => {
    const w = runner(W());
    w.run(step({ newEvents: [ev('夺关战起', { type: 'plot', ref: 'a_1' })], agendaAdvances: [adv('a_1')] }));       // t1
    w.run(step({ agendaAdvances: [adv('a_1')] }));                                                                  // t2：A 闭环
    w.run(step({ newEvents: [ev('敌援东来', { type: 'ripple', ref: 'ev_1_1' }) ] }));                               // t3：R1（ev_3_1）
    w.runN(3);   // t4-6
    w.run(step({ newEvents: [ev('敌援诱伏', { type: 'ripple', ref: 'ev_3_1' }) ] }));                               // t7：R2（ev_7_1）
    w.runN(3);   // t8-10
    w.run(step({ newEvents: [ev('伏兵反围', { type: 'ripple', ref: 'ev_7_1' }) ] }));                                // t11：R3（ev_11_1）
    w.runN(4);   // t12-15
    w.run(step({ newEvents: [ev('围势既成', { type: 'ripple', ref: 'ev_11_1' }) ] }));                               // t16：R4（ev_16_1）
    w.runN(6);   // t17-22：A 已满热窗（2+20=22）但 R1 未决 → 保护
    assert.ok(w.find('ev_1_1'), 't22：链活着（R1 未决下游）→ A 不归档');
    w.run(empty());   // t23：R1 前 tick（t22）才随链收敛 —— 本 tick R1 尚未平息（R2 同 tick 先闭，顺序保护）
    assert.ok(w.find('ev_1_1'), 't23：R1 仍未决 → 保护持续');
    w.run(empty());   // t24：R1 平息 → A 无未决下游 → 归档（链尾循环先于归档，同 tick 归位）
    assert.equal(w.find('ev_1_1'), undefined, 't24：链收敛 → A 归档');
    assert.ok(w.m('m_10') && w.m('m_10').ids.includes('ev_1_1'), 'A 在里程碑 m_10');
});

test('K20/A-3 跨段指针修复 + 解析防御：段外 up 重指里程碑；m.links.down 记引用方；未决链不受影响', () => {
    const w = runner(W());
    w.run(step({ newEvents: [ev('夺关战起', { type: 'plot', ref: 'a_1' })], agendaAdvances: [adv('a_1')] }));       // t1
    w.run(step({ agendaAdvances: [adv('a_1')] }));                                                                  // t2：A 闭
    w.run(step({ newEvents: [ev('隔岸闻信', { type: 'ripple', ref: 'ev_1_1' }) ] }));                                // t3：R（born 段 0）
    w.runN(4);   // t4-7（R 窗未满）
    w.run(empty());   // t8：R 平息（born3 + 5）
    w.runN(14);  // t9-22：A age 20 → 归档段 0；R 的 up 修复 → m_10
    assert.equal(w.find('ev_1_1'), undefined, 'A 已归档');
    const m10 = w.m('m_10');
    assert.ok(m10, 'm_10 存在');
    assert.equal(w.find('ev_3_1').links.up[0], 'm_10', '段外遗留事件 up 重指里程碑（链条不断）');
    assert.deepEqual(m10.links.down, ['ev_3_1'], 'm.links.down 记引用方');
    // 解析防御：引已归档事件的未决/遗留节点 → 沿里程碑兜底（无 source 的里程碑 → 默认 world/0，不抛）
    const r = resolveEventSource({ world: w.world(), ev: { source: { type: 'ripple', ref: 'ev_1_1' } }, weights: { e_x: 0.9 } });
    assert.deepEqual(r, { source: 'world', weight: 0 }, '跨段兜底：安全返回，不抛不悬');
    // 未决事件链不受归档影响（pack 侧不喂里程碑——另行验证于冒烟）
    const pending = w.world().events.filter((e) => !e.closed);
    assert.ok(pending.every((e) => (e.links?.up || []).every((u) => !u.startsWith('m_') || w.m(u))), '未决链上溯指针全部可解析');
});

test('K20：归档后世界过 SSOT schema（milestones 形状合法）；确定性逐字节', () => {
    const runAll = (start) => {
        const w = runner(start);
        w.run(step({ newEvents: [ev('A', { type: 'plot', ref: 'a_1' })], agendaAdvances: [adv('a_1')] }));
        w.run(step({ newEvents: [ev('B', { type: 'ripple', ref: 'ev_1_1' })], agendaAdvances: [adv('a_1')] }));
        w.runN(24);   // t3-26：B 平息 + A 归档
        return w.world();
    };
    const a = runAll(W());
    const b = runAll(W());
    assert.equal(JSON.stringify(a), JSON.stringify(b), '确定性逐字节');
    const vr = validate(a, ssotSchema);
    assert.equal(vr.ok, true, `milestones/closedAt 过 schema: ${vr.errors.join('; ')}`);
    assert.ok((a.milestones || []).length >= 1, '里程碑已产生');
    assert.equal(ARCHIVE.hotWindow, 20, '热窗常量（提案态）');
    assert.equal(ARCHIVE.milestoneEvery, 10, '里程碑粒度（提案态）');
});

// ============ ★★★leg111：进大事纪的事件**保住来路**（用户令「和其他没进的事件一样」） ============
// 病（用户看着链视图问「进了大事纪的事件的链条好像只会保存开头还有事纪，不再是具体的事件了」）：
//   归档只 `push(ev.title)` + `push(ev.id)` ⇒ 事件对象一走，`source.ref` 也没了 ⇒
//   **段内"哪件事引发了哪件事"整段查不到**（真账 4 个纪共 63 条已归档事件全无来路）。
// 口径：`milestone.rows` 存**事件契约那五格**（id/title/source/position/ripples）⇒ 与热池事件同形。
test('★★leg111：归档事件的来路随事件留档（milestone.rows 存事件契约那五格）', () => {
    const w = runner(W());
    w.run(step({ newEvents: [ev('甲事', { type: 'plot', ref: 'a_1' })], agendaAdvances: [adv('a_1')] }));   // t1 ev_1_1（plot 源）
    w.run(step({ agendaAdvances: [adv('a_1')] }));                                                           // t2 闭环
    w.run(step({ newEvents: [ev('乙事', { type: 'ripple', ref: 'ev_1_1' })] }));                             // t3 ev_3_1
    w.runN(20);   // t4-23：甲事归档 ⇒ m_10
    assert.equal(w.find('ev_1_1'), undefined, '甲事已出热池（归档）');
    const rows = w.m('m_10').rows;
    assert.ok(Array.isArray(rows) && rows.length === 1, `★m_10.rows 必须留下那条事件的来路：${JSON.stringify(rows)}`);
    assert.deepEqual(rows[0].source, { type: 'plot', ref: 'a_1' }, '★来路原样留住（plot → a_1）');
    assert.equal(rows[0].id, 'ev_1_1');
    assert.equal(rows[0].title, '甲事');
    assert.equal(rows[0].position, '边城');
    assert.deepEqual(rows[0].ripples, ['e_x'], '波及名单也留住');
    // 契约层：带 rows 的世界必须过 SSOT schema（milestones 是 additional:false，漏登记就违约）
    const vr = validate(w.world(), ssotSchema);
    assert.equal(vr.ok, true, `带 rows 的里程碑过 schema: ${vr.errors.join('; ')}`);
});

test('★★leg111：链视图能"走进"归档事件——逐事件来路可走通，不再只剩标题串', () => {
    const w = runner(W());
    w.run(step({ newEvents: [ev('甲事', { type: 'plot', ref: 'a_1' })], agendaAdvances: [adv('a_1')] }));   // t1 ev_1_1
    w.run(step({ agendaAdvances: [adv('a_1')] }));                                                           // t2 闭环
    w.run(step({ newEvents: [ev('乙事', { type: 'ripple', ref: 'ev_1_1' })] }));                             // t3 ev_3_1（引甲事）
    w.runN(20);   // t4-23：甲事归档 ⇒ m_10（乙事仍在热池）
    assert.equal(w.find('ev_1_1'), undefined, '甲事已归档');
    assert.ok(w.find('ev_3_1'), '乙事仍在热池');
    // ★靶心：点"乙事"的链，它的来路应当**走进甲事那件事本身**（而不是塌成"大事纪"一个节点）
    const r = expandChain(w.world(), 'ev_3_1');
    assert.equal(r.ok, true);
    const kinds = r.up.map((n) => `${n.kind}:${n.id || n.reason || ''}`);
    assert.ok(r.up.some((n) => n.kind === 'event' && n.id === 'ev_1_1'),
        `★已归档的上游事件必须作为一个**事件节点**出现（改前这里只有 milestone 或悬空）：${kinds.join(' > ')}`);
    const upEv = r.up.find((n) => n.kind === 'event' && n.id === 'ev_1_1');
    assert.equal(upEv.title, '甲事', '标题取自来路留档');
    assert.equal(upEv.archived, true, '如实标"已归大事纪"（不谎报未了结）');
    assert.equal(upEv.position, '边城', '位置也在');
    // 再往上一跳：甲事是 plot 源 ⇒ 走到谋划弧线（证明"往上还能继续走"，不是到此为止）
    assert.ok(r.up.some((n) => n.kind === 'agenda' && n.id === 'a_1'),
        `★还要能继续上溯到甲事的源头（谋划 a_1）：${kinds.join(' > ')}`);
    // ★已归档的事件自己也能当链的起点（"和其他没进的事件一样"）
    const r2 = expandChain(w.world(), 'ev_1_1');
    assert.equal(r2.ok, true, '★点一件已归档的事，链必须能展开（改前落到"纪节点为根"、逐事件来路一条都没有）');
    assert.equal(r2.root.kind, 'event');
    assert.equal(r2.root.title, '甲事');
    assert.equal(r2.root.archived, true);
    // 下沿：甲事归档后，它的下游（乙事）仍要看得见
    assert.ok(r2.down.some((d) => d.kind === 'event' && d.id === 'ev_3_1'),
        `★归档事件的下沿（谁被它牵动）也要在：${JSON.stringify(r2.down.map((d) => d.id || d.kind))}`);
});

// ============ ★★★leg110：纪的因果指针不许有重复（用户实机报「点事件的链总是有『环防·至此为止』」） ============
// 病（真账实测）：归档时那两个"重指里程碑"的循环**改完就完事、不看这个 id 是不是已经在了**——
//   两件不同的事各自引用同一件旧事 ⇒ 重指后变成**同一个 id 出现两次**：
//   `m_20.links.up = ["m_10","ev_1_1","m_10"]`、`m_30.links.up = ["m_20","m_20"]`。
//   而链视图把"已经走过"当成"成环" ⇒ 同一个纪第二次出现就被判成"引用成环、链在此剪断"，
//   面板打出「账不可信处的如实标注」——**账是可信的，是那里判错了**。
//   实测影响面：真账 75 个可点节点里 14 个（19%）撞这条误报，真互指 0 处。
// 口径：`links.up` 去重 + 去掉"已被 up 里某个纪包含"的直指事件（同一段路的两种写法只留一种）。
test('★leg110：纪的 links.up 不许有重复指针（两个引用方各自重指同一个上游纪 ⇒ 原实现写进两遍）', () => {
    const w = runner(W());
    w.run(step({ newEvents: [ev('甲事', { type: 'plot', ref: 'a_1' })], agendaAdvances: [adv('a_1')] }));      // t1 ev_1_1
    w.run(step({ agendaAdvances: [adv('a_1')] }));                                                              // t2 甲事随源盘算闭环（closedAt=2）
    w.runN(9);   // t3-11
    w.run(step({ newEvents: [ev('乙事', { type: 'ripple', ref: 'ev_1_1' })] }));                                // t12 ev_12_1（段 1）
    w.run(step({ newEvents: [ev('丙事', { type: 'ripple', ref: 'ev_1_1' })] }));                                // t13 ev_13_1（段 1）
    w.run(step({ eventClosures: [{ event: 'ev_12_1', why: '这一段讲完了' }] }));                                 // t14 乙事闭环（t34 才满热窗）
    w.run(step({ eventClosures: [{ event: 'ev_13_1', why: '这一段也讲完了' }] }));                               // t15 丙事闭环（t35 才满热窗）
    w.runN(7);    // t16-22：t22 甲事 age 20 → 归档段 0 ⇒ m_10；乙/丙的 up 重指 m_10
    assert.equal(w.find('ev_1_1'), undefined, '甲事已归档');
    const m10 = w.m('m_10');
    assert.ok(m10, 'm_10 存在');
    assert.deepEqual([...m10.links.down].sort(), ['ev_12_1', 'ev_13_1'], 'm_10 记下两个引用方');
    assert.deepEqual(w.find('ev_12_1').links.up, ['m_10'], '乙事 up 重指 m_10');
    assert.deepEqual(w.find('ev_13_1').links.up, ['m_10'], '丙事 up 重指 m_10');
    w.runN(3);    // t23-25：t25 乙事（born12，closedAt14，age 11 < 20）——仍未到期
    assert.ok(w.find('ev_12_1'), 't25 乙事仍在热池（age 11）');
    w.runN(9);    // t26-34：t34 乙事 age 20 → 归档段 1 ⇒ m_20（丙事 age 19 仍未到期，还指着 m_10）
    assert.equal(w.find('ev_12_1'), undefined, 't34 乙事已归档');
    assert.ok(w.m('m_20'), 'm_20 存在（乙事归档）');
    assert.deepEqual(w.m('m_20').ids, ['ev_12_1'], 'm_20 含乙事');
    // ★靶心：丙事此刻还在热池、仍指向 m_10 ⇒ 归档乙事时 m_10 被 push 进 m_20.links.up；
    //   紧接着"段外遗留节点重指"又把丙事的 m_10 走一遍 ⇒ 原实现得到 ['m_10', 'm_10']（真账 m_20/m_30 就是这个形状）。
    //   ⚠断言必须**现取**：`archiveClosedEvents` 每轮重建纪对象（`const m = existing || {...}`）⇒ 持有旧引用会读到过期值。
    assert.equal(w.m('m_20').links.up.filter((x) => x === 'm_10').length, 1,
        `★同一个上游纪在 links.up 里只许出现一次（实际 ${JSON.stringify(w.m('m_20').links.up)}）`);
    w.run(empty());   // t35：丙事 age 20 → 归档 ⇒ 补进 m_20
    assert.deepEqual([...w.m('m_20').ids].sort(), ['ev_12_1', 'ev_13_1'], 'm_20 含乙丙两事');
    assert.equal(w.m('m_20').links.up.filter((x) => x === 'm_10').length, 1, '丙事补进之后仍然只许一个 m_10');
    // 全账扫一遍：任何一个纪的 up/down 都不许有重复项（防"修一处漏一处"）
    for (const m of w.world().milestones || []) {
        assert.deepEqual(m.links.up, [...new Set(m.links.up)], `纪 ${m.id} 的 links.up 有重复：${JSON.stringify(m.links.up)}`);
        assert.deepEqual(m.links.down, [...new Set(m.links.down)], `纪 ${m.id} 的 links.down 有重复：${JSON.stringify(m.links.down)}`);
    }
});

// ★旧账自愈：真账里已经写脏的那两个纪（`m_20.links.up=["m_10","ev_1_1","m_10"]`、`m_30=["m_20","m_20"]`）
//   必须在下一次归档时被就地修好——否则用户点旧链还是会撞那条误报。
test('★leg110：旧账自愈——已写脏的纪（重复指针 + 冗余直指）在下一次归档时被归一', () => {
    const w = runner(W());
    // 手工注入"真账那个形状"的脏账：m_10 含 ev_1_1；m_20 的 up 里 m_10 两遍 + 它内含的 ev_1_1；m_30 里 m_20 两遍
    w.world().milestones = [
        { id: 'm_10', span: { from: 1, to: 10 }, counts: { events: 1 }, titles: ['甲事'], ids: ['ev_1_1'], links: { up: [], down: [] } },
        { id: 'm_20', span: { from: 11, to: 20 }, counts: { events: 1 }, titles: ['乙事'], ids: ['ev_12_1'], links: { up: ['m_10', 'ev_1_1', 'm_10'], down: [] } },
        { id: 'm_30', span: { from: 21, to: 30 }, counts: { events: 1 }, titles: ['丙事'], ids: ['ev_25_1'], links: { up: ['m_20', 'm_20'], down: [] } },
    ];
    assert.deepEqual(w.m('m_20').links.up, ['m_10', 'ev_1_1', 'm_10'], '前置：脏账就位（真账那个形状）');
    w.run(step({ newEvents: [ev('新事', { type: 'state' })] }));   // 跑一步 ⇒ 归档函数每 tick 都跑 ⇒ 归一
    assert.deepEqual(w.m('m_20').links.up, ['m_10'], `★m_20 归一（去掉重复的 m_10 与它内含的 ev_1_1）：${JSON.stringify(w.m('m_20').links.up)}`);
    assert.deepEqual(w.m('m_30').links.up, ['m_20'], `★m_30 归一：${JSON.stringify(w.m('m_30').links.up)}`);
});


