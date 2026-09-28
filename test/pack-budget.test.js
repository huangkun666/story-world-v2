// story-world-v2/test/pack-budget.test.js
// ★★★leg114（**包预算旋钮**）判据。细案：`docs/spec-pack-budget-knob.md`（§5 的 K1–K7）。
//
// 【这一笔治什么·人话】世界模型每轮拿到的那份"料"（包）有个上限，原来是**写死在源码里**的 30000。
//   用户 2026-09-22 说「**30000token 预算也太少了，我一般玩聊天 rp 每轮 5,6 万都正常**」
//   「**做个调整的入口，让用户根据自家模型的能力动态调节**」
//   ⇒ 把这个数从"写死的常量"改成"**面板上可调、账上留痕、出厂值不变**的容量旋钮"。
//
// 【它是"尺"，不是"闸"】`每轮递线`/`每轮事件` 那几个限制"模型能做什么"（超了**拒**）；
//   这一格限制"**引擎给模型看多少**"，**不拦任何东西**——裁了什么如实写进 `pack.trimmed`。
//
// 【为什么这批判据必须存在】（每条背后要么是一次实测，要么是一条既有纪律）
//   · **K1 一个数一个家**：这个数原来只有 `pack.js` 一个出处，现在搬进 `limits.js`；而 `smoke.js`
//     与三个判据文件仍从 `pack.js` import 它 ⇒ 必须锁住"转发的是同一个值"，否则当场变成本仓老病
//     "**一个数两把尺子**"（包按 A 裁、冒烟按 B 断言）。
//   · **K2 默认逐字不变**：`limits.js` 立的纪律——出厂值就是参数化之前那个数，未设档位时**逐字节相同**。
//   · **K3 账上留痕**：面板画的那个数必须**就是**引擎读的那个数（不各问一个源）。
//   · **K4 脏值**：照那张表统一的既有口径（空/缺 ⇒ 未定回出厂；非数字/小数/0/负数 ⇒ 弃键）。
//   · **K5 读数如实**：面板"上一轮用了多少"取的是**账上真值**（不重算）；而"**裁之前有多大**"
//     **只在真裁过的那一轮才写**（没裁一个字不写 ⇒ 旧账零扰动）。
//   · **K7 设了要真生效**：预算不许是空话（`trimPack` 当年在生产里 **0 调用**过，见 `pack.js:1004`）。
//   · **K6 冒烟终态逐字节不变**：出厂值没动 ⇒ 小世界那条"引擎零漂移"硬读数必须原样（8351 字节）。
//     ★这一条**不在本文件**——它是 `node demo/smoke-demo.js` 那条读数（见 `STATE.md` §1）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEvolutionPack, packTextOf, EVOLUTION_BUDGET_TOKENS } from '../src/pack.js';
import { runTick } from '../src/tick.js';
import { renderParamsHtml } from '../src/render.js';
import {
    LIMIT_DEFAULTS, LIMIT_KEYS, LIMIT_GEARS, LIMIT_META, LIMIT_ROWS,
    PACK_BUDGET_TOKENS, limitsOf, resolveLimits, normalizeLimit,
} from '../src/limits.js';

const KEY = '包预算';

/** 一份最小可出包的世界（`context.setting.dynamic.env` 就是那张表的存储位）。 */
const mk = (n = 2, budget = null) => {
    const env = {};
    if (budget != null) env[KEY] = String(budget);
    return {
        entities: Array.from({ length: n }, (_, i) => ({
            id: `e_${i}`, kind: 'character', name: `名号${i}号长名为了吃预算`, location: '中央',
        })),
        agendas: [], events: [], chronicle: [], weights: {}, milestones: [],
        context: { world: '测试界', positions: ['中央'], setting: { dynamic: { env } } },
        meta: { tick: 5, simLog: [] },
    };
};

/**
 * 一份**真的会超预算**的世界（照 `lens.test.js` 那条实测过的配方造，别靠加行数硬堆）：
 *   ①成员满的势力（`members` 是剪枝第一刀要逐出的重字段）②未决事件（第四刀）③在飞盘算带 memory（第五刀）。
 * ★★★leg135：pad 数 **300 → 500**。为什么（**读数在这，不是猜的**）：
 *   出厂预算 30000 → 50000（用户令「我预算抬到50000token」）之后，旧夹具 est=**36,518** ⇒ **不再超预算**
 *   ⇒ K5/K7 的前提（"夹具必须真的触发剪枝"）当场失效（本笔实测当场红）。
 *   实测曲线（`pad 数 ⇒ est`）：300→36,518 不裁 · 400→48,718 **不裁** · **500→裁 5 段** · 600→裁 5 段。
 *   ⇒ 取 **500**：第一个真裁的档，且夹具不至于白跑得慢（再往上只是更慢，验的东西一样）。
 *   ★复量口：`node tmp/leg135-scale-hit/measure-heavy-fixture.mjs`（住 tmp，不在仓里）。
 */
const heavyWorld = () => {
    const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/golden-world.min.json', import.meta.url), 'utf8'));
    const world = structuredClone(GOLDEN);
    const base = world.entities[0];
    const ROSTER = Array.from({ length: 60 }, (_, i) => `成员${i}号长名字`);
    world.entities = [...world.entities, ...Array.from({ length: 500 }, (_, i) => ({
        ...structuredClone(base), id: `e_pad_${i}`, kind: 'faction', name: `守卫${i}号长名为了吃预算`,
        branches: [`分舵甲${i}`, `分舵乙${i}`], organs: [`堂口${i}`], members: ROSTER,
    }))];
    // ⚠必须是**追加**而不是覆盖：本用例的 step 引用 golden 世界里原有的 `a_1` 盘算
    world.events = [...(world.events || []), ...Array.from({ length: 500 }, (_, i) => ({
        id: `ev_pad_${i}`, title: `未决事件${i}号长标题为了吃预算`, source: { type: 'plot', ref: 'a_1' }, position: '临渊城', closed: false,
    }))];
    world.agendas = [...(world.agendas || []), ...Array.from({ length: 500 }, (_, i) => ({
        id: `a_pad_${i}`, owner: `e_pad_${i}`, goal: `谋划第${i}件事的长目标描述为了吃预算`, stage: '阶段', visibility: 'known',
        progress: 1, maxSteps: 4, parentId: null, closed: false,
        memory: { promises: ['旧诺言甲', '旧诺言乙'], done: [], blocked: ['受阻原因'], turnsAlive: 3 },
    }))];
    world.weights = Object.fromEntries(world.entities.map((e) => [e.id, 0.5]));
    world.context = world.context || {};
    world.context.setting = world.context.setting || {};
    world.context.setting.dynamic = world.context.setting.dynamic || {};
    world.context.setting.dynamic.env = { ...(world.context.setting.dynamic.env || {}) };
    return world;
};
const setBudget = (world, b) => { world.context.setting.dynamic.env[KEY] = String(b); return world; };

// ── K1：一个数一个家 ────────────────────────────────────────────────────────────
test('leg114·K1：★一个数一个家——`pack.js` 转发的是 `limits.js` 那个值（不是各写一份）', () => {
    assert.equal(EVOLUTION_BUDGET_TOKENS, PACK_BUDGET_TOKENS,
        '`pack.js` 的 `EVOLUTION_BUDGET_TOKENS` 必须是 `limits.js` 那个家的转发（否则就是两把尺子）');
    assert.equal(LIMIT_DEFAULTS[KEY], PACK_BUDGET_TOKENS, '面板那张表的出厂值 = 同一个值');
    assert.ok(LIMIT_KEYS.includes(KEY), '它是那张表的一员（写通道靠 `limitKey` 认键 ⇒ 必须登记）');
    assert.equal(resolveLimits(mk()).包预算, PACK_BUDGET_TOKENS, '账上没设 ⇒ 生效值 = 出厂值');
});

// ── K2：默认逐字不变 ────────────────────────────────────────────────────────────
test('leg114·K2：★默认逐字不变——不传 `lim` 与传全套出厂 `lim`，出的包**逐字节相同**', () => {
    const a = buildEvolutionPack(mk(4), null);
    const b = buildEvolutionPack(mk(4), null, { lim: { ...LIMIT_DEFAULTS } });
    assert.equal(packTextOf(a.pack), packTextOf(b.pack), '出厂值没动 ⇒ 包逐字节不变');
    assert.equal(a.estTokens, b.estTokens);
    assert.equal(a.estBeforeTrim, undefined, '★没裁 ⇒ 不带"裁之前"那个读数（旧账零扰动，判据 K6 靠它）');
});

// ── K3：账上留痕（引擎实读与面板同源） ──────────────────────────────────────────
test('leg114·K3：账上设了 ⇒ 引擎实读与面板画的是同一个数（不各问一个源）', () => {
    const w = mk(2, 60000);
    assert.equal(limitsOf(w)[KEY], 60000, '账上那个值被认了（归一通过）');
    assert.equal(resolveLimits(w)[KEY], 60000, '引擎实读');
    const row = LIMIT_ROWS(w).find((r) => r.key === KEY);
    assert.equal(row.value, 60000, '面板那一格画的是同一个数');
    assert.equal(row.isDefault, false, '设过 ⇒ 不是默认');
    assert.deepEqual(row.options, LIMIT_GEARS[KEY], '建议值来自那张表');
    assert.ok(LIMIT_META[KEY].label && LIMIT_META[KEY].hint, '有人话标签与说明');
    assert.equal(LIMIT_ROWS(mk(2)).find((r) => r.key === KEY).value, PACK_BUDGET_TOKENS, '没设 ⇒ 画出厂值');
});

// ── K4：脏值 ────────────────────────────────────────────────────────────────────
test('leg114·K4：脏值一律弃键（照那张表统一的既有口径，本笔不改它）', () => {
    for (const dirty of ['0', '-1', '2.5', 'abc', '']) {
        const w = mk(1);
        w.context.setting.dynamic.env[KEY] = dirty;
        assert.equal(normalizeLimit(KEY, dirty), null, `脏值「${dirty}」⇒ 弃键`);
        assert.equal(limitsOf(w)[KEY], undefined, `脏值「${dirty}」不许进结果`);
        assert.equal(resolveLimits(w)[KEY], PACK_BUDGET_TOKENS, `脏值「${dirty}」⇒ 回出厂默认（与其余几格同一条口径）`);
    }
    assert.equal(normalizeLimit(KEY, '60000'), 60000, '★大数是认的（这张表 leg54 起无上限）');
});

// ── K5：读数只在真裁时才有 ──────────────────────────────────────────────────────
test('leg114·K5：★"裁之前有多大"只在真裁过时才带出去（没裁 ⇒ `undefined`）', () => {
    const heavy = heavyWorld();
    const factory = buildEvolutionPack(heavy, null);
    // ★前提（leg113 §4.4 的教训：先确认装置真的走到了那条路径上，否则断言是假绿）
    assert.ok(factory.pack.trimmed?.length > 0,
        `夹具必须真的触发剪枝（est=${factory.estTokens} / trimmed=${JSON.stringify(factory.pack.trimmed ?? null)}）`
        + '——若为空说明夹具随世界成本变化而失效，须按 `trimPack` 的剪枝设计重造');
    assert.ok(factory.estBeforeTrim > factory.estTokens,
        `真裁 ⇒ 带读数，且"裁之前" > "裁之后"（${factory.estBeforeTrim} > ${factory.estTokens}）`);
});

// ── K5b：面板读数（取账上真值 + 新局一个字不印 + 三支都要如实） ─────────────────
test('leg114·K5b：面板那个读数是账上真值；新局一个字不印；"裁无可裁"那一支不许印假话', () => {
    const sim = (o) => Object.assign({
        tick: 5, packTokens: 900, ssotBytes: 1, events: 0, chronicle: 0, calls: 1, warnings: [],
    }, o);
    // ① 没裁：只印一个数 + 余量
    const w1 = mk(2, 30000);
    w1.meta.simLog = [sim({ packTokens: 900 })];
    const h1 = renderParamsHtml(w1);
    assert.match(h1, /上一轮递过去的料折合 <b>900<\/b> token/, '没裁 ⇒ 印"裁之后"（= 账上那个 `packTokens`，不重算）');
    assert.match(h1, /没裁，还余 <b>29100<\/b>/, '余量如实算出');
    assert.ok(!h1.includes('裁掉了'), '没裁就不许出现"裁掉了"');
    // ② 真裁：印"裁之前/裁之后/裁掉多少"
    const w2 = mk(2, 2000);
    w2.meta.simLog = [sim({ packTokens: 900, packTokensBeforeTrim: 1500 })];
    const h2 = renderParamsHtml(w2);
    assert.match(h2, /本来有 <b>1500<\/b> token/, '真裁 ⇒ 印"裁之前"');
    assert.match(h2, /裁完剩 <b>900<\/b>/, '印"裁之后"');
    assert.match(h2, /裁掉了 600<\/b>/, '差额如实算出（1500−900）');
    // ③ ★实测逮到的那一支：裁了却没变小（`trimmed` 自己也要占地方）⇒ 不许印"没裁"、不许印负数
    const w3 = mk(2, 800);
    w3.meta.simLog = [sim({ packTokens: 3081, packTokensBeforeTrim: 3031 })];
    const h3 = renderParamsHtml(w3);
    assert.match(h3, /裁无可裁/, '★这一支必须如实说"裁无可裁"');
    assert.ok(!/裁掉了 <b>-/.test(h3), '★绝不许印"裁掉了 −50"这种荒唐话');
    assert.ok(!h3.includes('没裁'), '★更不许把它当成"没裁"（那是假话——它确实裁了）');
    // ④ 新局：没有读数 ⇒ 一个字不印
    assert.ok(!renderParamsHtml(mk(2)).includes('上一轮递过去的料'),
        '★新局/没推进过 ⇒ 一个字不印（不是印 0、也不是印空壳）');
});

// ── K7：账上那个数**真的当家**（判别器：账上填大 ⇒ 同一份世界不再被裁） ──────────
test('leg114·K7：★账上把预算调大 ⇒ 同一份世界不再被裁（证明当家的是账上那个数，不是出厂那个）', () => {
    const atFactory = buildEvolutionPack(heavyWorld(), null);          // 出厂 30000
    assert.ok(atFactory.pack.trimmed?.length > 0,
        `前提：出厂预算下这份世界真的会被裁（est=${atFactory.estTokens}）`);
    const w = setBudget(heavyWorld(), 120000);
    const atAccount = buildEvolutionPack(w, null, { lim: resolveLimits(w) });
    assert.equal(atAccount.pack.trimmed, undefined, '★账上填 120000 ⇒ 这份料全装得下 ⇒ 一个字都不裁');
    assert.ok(atAccount.estTokens > atFactory.estTokens,
        `装得下 ⇒ 递过去的料更多（${atAccount.estTokens} > ${atFactory.estTokens}）——这正是玩家要的效果`);
    assert.equal(atAccount.estBeforeTrim, undefined, '没裁 ⇒ 账上不写"裁之前"（旧账零扰动）');
});

// ── K7 端到端：真发出去的包按账上那个预算裁 + 记账带上"裁之前" ──────────────────
test('leg114·K7 端到端：★真发出去的包按账上预算裁，且记账带"裁之前"（两处建包同源）', async () => {
    const world = setBudget(heavyWorld(), 29000);
    const p0 = buildEvolutionPack(world, null, { lim: resolveLimits(world) });
    assert.ok(p0.pack.trimmed?.length > 0, `前提：这份世界在 29000 下真的会裁（est=${p0.estTokens}）`);
    const step = {
        actions: [{ entity: 'e_merchant', verb: '沿商路北上巡查', position: '商路' }],
        newEvents: [{ title: '守将允诺通关', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: ['e_merchant'] }],
        agendaAdvances: [{ agendaId: 'a_1', step: '守将首肯，车队放行', stage: '过边关' }],
        newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = await runTick({ transport: async () => ({ text: JSON.stringify(step) }), ssot: world, dialogue: '（继续）' });
    assert.equal(r.ok, true, `调预算之后 tick 不该炸：${r.error || ''}`);
    assert.ok(r.pack.estTokens <= 29000 || r.pack.pack.trimmed?.includes('budgetOverrun'),
        `★真发出去的包要么落回账上那个预算内、要么如实留越界痕迹（est=${r.pack.estTokens}）`);
    const last = r.ssot.meta.simLog.at(-1);
    assert.ok(last.packTokensBeforeTrim > last.packTokens,
        `★记账要带"裁之前"（before=${last.packTokensBeforeTrim} / after=${last.packTokens}）——`
        + '这一条同时锁住 `settle.js` 那一处**递了 `lim`**：不递的话它按出厂 30000 建包，这里就没有这个读数');
});
