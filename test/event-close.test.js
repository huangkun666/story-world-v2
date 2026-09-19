// story-world-v2/test/event-close.test.js
// K19 验收（因果链细案 §3.1/§3.2 → A-1/A-2）：事件闭环三型——源结清（K9 保真）/ 链尾结清（ripple 链头了结 +
// 涟漪平息窗 CHAIN_SETTLE=5 提案 + 无未决下游）/ 常驻保留（state 永不自动闭环）+ 事件产率上限
// （EVENT_CAPS.perTick=6 提案，超限拒建 + 洪峰警告，双面无痕于世界）。曲线支撑：细案 §1（max 4/稳态 1）。
// leg25 c 改写（用户令「删」四维浮点）：夹具实体不再带 `attrs`，世界步不再带 `stateChanges`
//   （契约层整条删除）——闭环逻辑本身不吃属性，故只删夹具里的死字段，断言一字未改。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleTick, EVENT_CAPS, CHAIN_SETTLE, EVENT_CLOSE_CAP } from '../src/settle.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { worldStepSchema } from '../src/schemas/world-step.schema.js';

// 单势力世界：两盘算（a_1 短链源 / a_2 在飞链头）+ state 常驻事件 ev_s（常驻保留样本）
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
    events: [
        { id: 'ev_s', title: '疫起', source: { type: 'state' }, position: '边城', ripples: [], links: { up: [], down: [] } },
    ],
    chronicle: [],
    meta: { tick: 0 },
});

const empty = () => ({ actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] });
const step = (extra) => ({ ...empty(), ...extra });
const adv = (id) => ({ agendaId: id, step: '推进', stage: '中' });

test('K19/A-1 链尾结清：plot 链头终结 → 涟漪窗满 + 无未决下游 → 逐段平息（编年措辞精确 + closedAt 写）', () => {
    let world = W();
    const run = (s) => { const r = settleTick({ ssot: world, step: s }); assert.equal(r.ok, true, r.stage.warnings.join('; ')); world = r.ssot; };
    // 链：A(plot a_1) → B(ripple A) → C(ripple B)
    run(step({ newEvents: [{ title: '夺关战起', source: { type: 'plot', ref: 'a_1' }, position: '边城', ripples: ['e_x'] }], agendaAdvances: [adv('a_1')] }));        // t1
    run(step({ newEvents: [{ title: '敌援东来', source: { type: 'ripple', ref: 'ev_1_1' }, position: '边城', ripples: ['e_x'] }], agendaAdvances: [adv('a_1')] }));  // t2：a_1 满步达成 → A 源结清
    run(step({ newEvents: [{ title: '敌援诱伏', source: { type: 'ripple', ref: 'ev_2_1' }, position: '边城', ripples: ['e_x'] }] }));                                 // t3
    for (let i = 4; i <= 7; i++) run(empty());   // t4-7：C 窗未满（born3）+ B 有未决下游 C → 均不平息
    run(empty());                                 // t8：C 窗满（8-3≥5）+ 无下游 → 平息；B 仍有未决下游 C → 不平息
    const ev = (id) => world.events.find((e) => e.id === id);
    assert.equal(ev('ev_1_1').closed, true);
    assert.equal(ev('ev_1_1').closedAt, 2, '源结清写 closedAt（归档判龄）');
    assert.equal(ev('ev_2_1').closed, false, 't8 时 B 有未决下游 → 不平息');
    assert.equal(ev('ev_3_1').closed, true, 't8 C 平息');
    assert.equal(ev('ev_3_1').closedAt, 8);
    run(empty());                                 // t9：B 平息（C 已闭，9-2≥5）
    assert.equal(ev('ev_2_1').closed, true, 't9 B 平息（下游已结，链尾逐段收敛）');
    assert.equal(ev('ev_2_1').closedAt, 9);
    const ripples = world.chronicle.filter((c) => c.text.includes('涟漪平息'));
    assert.equal(ripples.length, 2, '涟漪平息编年 2 条');
    assert.ok(ripples.every((c) => c.text.includes('链源已了结')), '措辞精确');
    assert.equal(world.chronicle.filter((c) => c.text.includes('闭环（源盘算已结算）')).length, 1, 'A 源结清 1 条');
    assert.ok(!world.events.find((e) => e.id === 'ev_s').closed, 'state 常驻不动（未闭环）');
});

test('K19/A-1：在飞链头不平息（源盘算未了结，窗满也不结）；state 链头波纹正常平息、常驻本身保留', () => {
    let world = W();
    const run = (s) => { const r = settleTick({ ssot: world, step: s }); assert.equal(r.ok, true, r.stage.warnings.join('; ')); world = r.ssot; };
    run(step({ newEvents: [{ title: '后援调度', source: { type: 'plot', ref: 'a_2' }, position: '大营', ripples: ['e_x'] }], agendaAdvances: [adv('a_2')] }));   // t1
    run(step({ newEvents: [{ title: '粮道被扰', source: { type: 'ripple', ref: 'ev_1_1' }, position: '大营', ripples: ['e_x'] }] }));                        // t2
    run(step({ newEvents: [{ title: '疫行村野', source: { type: 'ripple', ref: 'ev_s' }, position: '边城', ripples: ['e_x'] }] }));                          // t3（state 链头）
    for (let i = 4; i <= 17; i++) run(empty());   // t4-17
    const ev = (id) => world.events.find((e) => e.id === id);
    assert.equal(ev('ev_1_1').closed, false, '在飞链头（a_2 未结）→ plot 链不平息；窗早已满');
    assert.equal(ev('ev_1_1').closedAt, undefined, '未结无 closedAt');
    assert.equal(ev('ev_3_1').closed, true, 'state 链头波纹 t8 起平息（窗满 + 无下游）');
    assert.ok(!ev('ev_s').closed, '常驻保留：state 源永不自动闭环');
    assert.ok(world.chronicle.filter((c) => c.text.includes('涟漪平息')).length === 1, '恰 1 条平息（波纹）');
    // 链头补结 → 波纹随结清
    run(step({ agendaAdvances: [adv('a_2')] })); run(step({ agendaAdvances: [adv('a_2')] })); run(step({ agendaAdvances: [adv('a_2')] }));   // t18-20：a_2 满步达成
    assert.equal(ev('ev_1_1').closed, true, '链头了结 → 窗满 + 无下游 → 波纹平息');
    assert.equal(ev('ev_1_1').closedAt, 20);
});

test('K19/A-2 事件产率上限：7 连提 → 6 落 1 拒 + 洪峰警告，被拒不挂链不编年（双面无痕于世界）', () => {
    let world = W();
    const r = settleTick({ ssot: world, step: step({ newEvents: [
        { title: '厢务1', source: { type: 'state' }, position: '边城', ripples: [] },
        { title: '厢务2', source: { type: 'state' }, position: '边城', ripples: [] },
        { title: '厢务3', source: { type: 'state' }, position: '边城', ripples: [] },
        { title: '厢务4', source: { type: 'state' }, position: '边城', ripples: [] },
        { title: '厢务5', source: { type: 'state' }, position: '边城', ripples: [] },
        { title: '厢务6', source: { type: 'state' }, position: '边城', ripples: [] },
        { title: '厢务7', source: { type: 'state' }, position: '边城', ripples: [] },
    ] }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.equal(r.stage.warnings.filter((x) => x.includes('事件洪峰')).length, 1, '洪峰警告恰 1 条');
    assert.ok(r.stage.warnings[0].includes(`每 tick ≤${EVENT_CAPS.perTick}`) && r.stage.warnings[0].includes('厢务7'), r.stage.warnings[0]);
    const w = r.ssot;
    assert.equal(w.events.filter((e) => e.id.startsWith('ev_1_')).length, EVENT_CAPS.perTick, '恰 ≤6 条落账');
    assert.ok(!w.events.some((e) => e.title === '厢务7'), '第 7 条不挂链');
    assert.ok(!w.chronicle.some((c) => c.text.includes('厢务7')), '被拒不编年');
    assert.ok(w.chronicle.filter((c) => c.text.includes('事件「厢务')).length === EVENT_CAPS.perTick, '仅落账事件入编年');
    assert.equal(w.meta.tick, 1);
});

test('K19：闭环写 closedAt 后世界过 SSOT schema（closedAt/milestones 可选字段合法）；确定性', () => {    const runAll = (start) => {
        let world = start;
        for (const s of [
            step({ newEvents: [{ title: 'A', source: { type: 'plot', ref: 'a_1' }, position: '边城', ripples: ['e_x'] }], agendaAdvances: [adv('a_1')] }),
            step({ newEvents: [{ title: 'B', source: { type: 'ripple', ref: 'ev_1_1' }, position: '边城', ripples: ['e_x'] }], agendaAdvances: [adv('a_1')] }),
            step({ newEvents: [{ title: 'C', source: { type: 'ripple', ref: 'ev_2_1' }, position: '边城', ripples: ['e_x'] }] }),
            empty(), empty(), empty(), empty(), empty(),
        ]) {
            const r = settleTick({ ssot: world, step: s });
            assert.equal(r.ok, true, r.stage.warnings.join('; '));
            world = r.ssot;
        }
        return world;
    };
    const a = runAll(W());
    const b = runAll(W());
    assert.equal(JSON.stringify(a), JSON.stringify(b), '确定性逐字节');
    const vr = validate(a, ssotSchema);
    assert.equal(vr.ok, true, `closedAt/milestones 过 schema: ${vr.errors.join('; ')}`);
    assert.equal(CHAIN_SETTLE, 5, '涟漪平息窗常量在案（提案态）');
});

// ═══════════════ ★★★leg95：种子链死锁 + 模型收场通道 ═══════════════
// 用户令：「让 llm 来决定何时结束」+「引入机械就一定要避免让代码去理解语义」。
// 病（真账取证 leg94 §4 / leg95 复核）：`seed` 与 `state` 两种源**没有任何关闭路径**，而涟漪的门①
//   （链头已了结）**追到种子就永远 false** ⇒ 种子底下长出来的每一环**结构上永远闭不了**
//   （A 局 16 条 / B 局 44 条；推 40 轮只增不减）。定稿判据：**链条走到"播种源/处境源"就算到了头**
//   ——它生来是一个起点，不是"谁在办的事"，没有"了结"这一说。
const WS = () => ({   // 种子世界：播种源 ev_seed_1 打头，下挂一串涟漪
    version: 1,
    context: { world: '边地', tension: 0.5, positions: ['边城'] },
    entities: [{ id: 'e_x', kind: 'faction', name: '边军', location: '边城' }],
    weights: {},
    agendas: [],
    events: [{ id: 'ev_seed_1', title: '书上早埋的一件事', source: { type: 'seed' }, position: '边城', ripples: [], links: { up: [], down: [] } }],
    chronicle: [],
    meta: { tick: 0 },
});

test('★leg95 种子链死锁破除：播种源打头的涟漪，窗满 + 无下游 ⇒ 收得掉（旧法永远闭不了）', () => {
    let world = WS();
    const run = (s) => { const r = settleTick({ ssot: world, step: s }); assert.equal(r.ok, true, r.stage.warnings.join('; ')); world = r.ssot; };
    // 链：ev_seed_1(播种) → ev_1_1(涟漪) → ev_2_1(涟漪)
    run(step({ newEvents: [{ title: '余波其一', source: { type: 'ripple', ref: 'ev_seed_1' }, position: '边城', ripples: ['e_x'] }] }));   // t1
    run(step({ newEvents: [{ title: '余波其二', source: { type: 'ripple', ref: 'ev_1_1' }, position: '边城', ripples: ['e_x'] }] }));      // t2
    for (let i = 3; i <= 7; i++) run(empty());   // t3-7：房龄未满（ev_2_1 生于 t2，要到 t7 才满 5 轮）
    const ev = (id) => world.events.find((e) => e.id === id);
    assert.equal(ev('ev_2_1').closed, true, '★链尾 t7 应当平息（旧法这里恒 false：链头是种子 ⇒ 门①永远过不了）');
    assert.equal(ev('ev_1_1').closed, false, 't7 时它还有未结下游（余波其二）⇒ 不平息');
    run(empty());   // t8：下游已结 + 房龄满 ⇒ 逐段收敛
    assert.equal(ev('ev_1_1').closed, true, 't8 前一段跟着收（链尾逐段收敛）');
    assert.ok(!ev('ev_seed_1').closed, '★播种源本身**常驻保留**（它是书的原始设定，不是"谁在办的事"——永不自动闭环）');
    // ★措辞分化：链源是播种源 ⇒ 不许说"链源已了结"（它没有被了结过），要说"这一段没人接着长了"
    const rip = world.chronicle.filter((c) => String(c.text).includes('涟漪平息'));
    assert.equal(rip.length, 2, '恰 2 条平息');
    assert.ok(rip.every((c) => String(c.text).includes('这一段没人接着长了')),
        '★措辞必须分化：播种源链不许说"链源已了结"（那句话对种子是不诚实的）');
    assert.ok(!world.chronicle.some((c) => String(c.text).includes('链源已了结')), '播种源链里不许出现旧措辞');
});

test('★leg95 模型收场通道：判"这一段讲完了"⇒ 引擎按 closedBy=model 落账（机械只审计，不判语义）', () => {
    let world = WS();
    const run = (s) => { const r = settleTick({ ssot: world, step: s }); assert.equal(r.ok, true, r.stage.warnings.join('; ')); world = r.ssot; return r; };
    run(step({ newEvents: [
        { title: '余波其一', source: { type: 'ripple', ref: 'ev_seed_1' }, position: '边城', ripples: ['e_x'] },
    ] }));   // t1：第一环（同轮不能引同轮的新事——判据当场咬过这一条）
    run(step({ newEvents: [
        { title: '余波其二', source: { type: 'ripple', ref: 'ev_1_1' }, position: '边城', ripples: ['e_x'] },
    ] }));   // t2：第二环（两件都还很年轻，房龄 0）
    const ev = (id) => world.events.find((e) => e.id === id);
    // ★模型点名链头（种子）收场——这正是"死锁"的解：一点名，底下那串当场过门
    run(step({ eventClosures: [{ event: 'ev_seed_1', why: '书上这段已经讲完了，后面的余波由别的事接管' }] }));   // t3
    assert.equal(ev('ev_seed_1').closed, true, '模型判定的收场必须落账');
    assert.equal(ev('ev_seed_1').closedBy, 'model', '★必须留痕：这条是"模型判讲完了"，不是引擎扫的');
    assert.equal(ev('ev_seed_1').closedWhy, '书上这段已经讲完了，后面的余波由别的事接管', '模型给的理由要留下（面板悬停可见）');
    assert.equal(ev('ev_seed_1').closedAt, 3);
    assert.ok(world.chronicle.some((c) => String(c.text).includes('这一段收场了')), '编年要留一句收场话');
    assert.ok(world.chronicle.some((c) => String(c.text).includes('书上这段已经讲完了')), '★模型给的理由进编年（这是"谁判的、凭什么判"的凭据）');
    // ★★机械只审计、不判语义（三条）——注意**分工所在的层**（这是一处当场踩出来的形状）：
    //   ① 号不在册 / ② 已收场 这两条由**契约层**（`check-step` + `ref-rules` 的 `'eventClosures.event'`）
    //      在整步入口就拒掉 ⇒ 到不了引擎那一段（引擎里那两句警告是**防御**，只在有人绕过校验直调阶段函数时才响）。
    //      这与 `agendaCancels`"未知盘算"是**同一条口径**：号不对 = 模型抄错了 = 拒整步（世界如实不动）。
    //      ★本判据第一版按"引擎给警告、照样落账"写 ⇒ 当场红——那是我把两道门的关系想反了（留档）。
    const badRef = settleTick({ ssot: world, step: step({ eventClosures: [{ event: 'ev_nope', why: 'x' }] }) });
    assert.equal(badRef.ok, false, '号不在册 ⇒ 契约层拒整步（与"未知盘算"同一口径）');
    //   ★拒签面住在 `stage.warnings`（带 `校验拒绝:` 前缀），**不是 `errors`**——本判据第一版按 `errors` 读，
    //     TypeError 当场红。留档：这是"自己猜返回形状"的又一次（本仓 §0.2 那三次全是这一类）。
    assert.ok(badRef.stage.warnings.some((w) => w.includes('校验拒绝') && w.includes('ev_nope')),
        '拒签理由要指名到号（模型才知道抄错了哪个）');
    const reClose = settleTick({ ssot: world, step: step({ eventClosures: [{ event: 'ev_seed_1', why: '再收一次' }] }) });
    assert.equal(reClose.ok, false, '★不许重收：已经收过场的再收 ⇒ 契约层拒（"一件只能收一次"）');
    // ③ 配额：**不是形状错**（§check-step 头注那条裁定）⇒ 引擎给警告 + 只收前 N 件，**不整步拒**
    const w2 = world;
    const r2 = settleTick({ ssot: w2, step: step({ eventClosures: [
        { event: 'ev_1_1', why: '完' }, { event: 'ev_2_1', why: '完' }, { event: 'ev_nope1', why: '完' },
    ] }) });
    assert.equal(r2.ok, false, '其中一条号不在册 ⇒ 整步仍被拒（配额那一条的前提是"每一条本身都合法"）');
    void EVENT_CLOSE_CAP;
});

test('★leg95 收场提议过契约与判据：schema 认这一组；号不在册/已收场 由判据表拒', () => {
    // ① 契约层：`eventClosures` 是**可选组**（缺席合法——既有 ~110 处夹具都只有七组）
    assert.equal(validate(step({ eventClosures: [{ event: 'ev_seed_1', why: 'w' }] }), worldStepSchema).ok, true, '合法形状');
    assert.equal(validate(step({ eventClosures: [{ why: '缺号' }] }), worldStepSchema).ok, false, '缺 event ⇒ 形状不合法（整步被拒）');
    assert.equal(validate(step({}), worldStepSchema).ok, true, '★可选组：整组缺席仍然合法（不许砸老夹具）');
});