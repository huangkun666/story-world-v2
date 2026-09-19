// story-world-v2/test/setting.test.js
// K24/设定大势层：context.setting 可选形状 + 旧形状兼容（细案 A-1；契约层）。
// ★leg99 追加一节：**事件出生轮解析器**（`eventBornTick`，本模块的单一契约点）——见文件末尾那几条。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { eventBornTick, recentEventCount, TENSION_WINDOW } from '../src/setting.js';
import { bornTick as panBornTick } from '../src/panorama.js';
import { unrestGearOf } from '../src/unrest.js';

const readSrc = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const baseWorld = () => ({
    version: 1,
    context: { world: '临渊城', tension: 0.5, positions: ['临渊城'] },
    // leg25 c：实体夹具不再带 `attrs`（四维浮点已整条删除；schema additional:false ⇒ 带它就是"未知字段"拒）。
    //   本文件测的全是 `setting` 层形状，实体只需最小合法形状充当载体，与属性无关。
    entities: [{ id: 'e1', kind: 'faction', name: 'A', location: '临渊城' }],
    weights: {},
    agendas: [],
    events: [],
    chronicle: [],
    meta: { tick: 1 },
});

test('K24/A-1：旧世界兼容——仅 tension 数字、无 setting 合法（缺省形状兼容断言）', () => {
    const r = validate(baseWorld(), ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
});

test('K24/A-1：setting 全形状合法（frozen 五件套 + dynamic 张力三件 + env + derivedFrom）', () => {
    const doc = baseWorld();
    doc.context.setting = {
        frozen: {
            fingerprint: 'fnv1a-abc123',
            extractedAt: '2026-09-07T12:00:00Z',
            canon: {
                powerScale: [{ level: '筑基', note: '凡俗之上' }, { level: '元婴', note: '一方之尊' }],
                rules: ['灵脉有主'],
                society: '宗门林立，大荒无主',
                techOrMagic: '灵气修行体系',
                historyNotes: ['上古一战，灵脉断流'],
            },
        },
        dynamic: {
            tension: { polarity: '宗门/朝廷', direction: '宗门压朝廷', intensity: 0.6 },
            env: { '民生度': '艰难', '动乱度': '小乱', '天时': '平常' },   // leg26：档位原话（玩家可选），不再是四个数
            derivedFrom: ['book#3', 'ev_1_2'],
        },
    };
    const r = validate(doc, ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
});

test('K24/A-1：setting 内 frozen/dynamic 各自缺省合法；dynamic 缺 tension 被拒', () => {
    const onlyFrozen = baseWorld();
    onlyFrozen.context.setting = {
        frozen: { fingerprint: 'f1', extractedAt: 't', canon: { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [] } },
    };
    assert.equal(validate(onlyFrozen, ssotSchema).ok, true);

    const onlyDynamic = baseWorld();
    onlyDynamic.context.setting = { dynamic: { tension: { polarity: 'P', intensity: 0.2 } } };   // direction 可省 = 僵持
    assert.equal(validate(onlyDynamic, ssotSchema).ok, true);

    const noTension = baseWorld();
    noTension.context.setting = { dynamic: { env: { '民生度': 1 } } };
    const r = validate(noTension, ssotSchema);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.includes('$.context.setting.dynamic.tension: 必填缺失')), r.errors.join('; '));
});

test('K24/A-1：intensity 越界与类型被拒（引擎计算域 0..1）', () => {
    const over = baseWorld();
    over.context.setting = { dynamic: { tension: { polarity: 'P', intensity: 1.2 } } };
    assert.ok(!validate(over, ssotSchema).ok, 'intensity > 1 应拒');

    const under = baseWorld();
    under.context.setting = { dynamic: { tension: { polarity: 'P', intensity: -0.1 } } };
    assert.ok(!validate(under, ssotSchema).ok, 'intensity < 0 应拒');

    const nonNum = baseWorld();
    nonNum.context.setting = { dynamic: { tension: { polarity: 'P', intensity: '高' } } };
    assert.ok(!validate(nonNum, ssotSchema).ok, 'intensity 非数字应拒');
});

test('K24：setting 形状严格——未知字段拒、frozen 缺 fingerprint 拒', () => {
    const stray = baseWorld();
    stray.context.setting = { dynamic: { tension: { polarity: 'P', intensity: 0.5 }, rogue: true } };
    const r1 = validate(stray, ssotSchema);
    assert.ok(!r1.ok);
    assert.ok(r1.errors.some(e => e.includes('$.context.setting.dynamic.rogue: 未知字段')), r1.errors.join('; '));

    const noFp = baseWorld();
    noFp.context.setting = { frozen: { extractedAt: 't', canon: { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [] } } };
    const r2 = validate(noFp, ssotSchema);
    assert.ok(!r2.ok);
    assert.ok(r2.errors.some(e => e.includes('$.context.setting.frozen.fingerprint: 必填缺失')), r2.errors.join('; '));
});

test('K24：canon 五件套形状——powerScale 项缺 note 拒；空五件合法（无数量约束口径）', () => {
    const badItem = baseWorld();
    badItem.context.setting = { frozen: { fingerprint: 'f', extractedAt: 't', canon: { powerScale: [{ level: '筑基' }], rules: [], society: '', techOrMagic: '', historyNotes: [] } } };
    const r1 = validate(badItem, ssotSchema);
    assert.ok(!r1.ok);
    assert.ok(r1.errors.some(e => e.includes('$.context.setting.frozen.canon.powerScale[0].note: 必填缺失')), r1.errors.join('; '));

    const emptyCanon = baseWorld();
    emptyCanon.context.setting = { frozen: { fingerprint: 'f', extractedAt: 't', canon: { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [] } } };
    assert.equal(validate(emptyCanon, ssotSchema).ok, true);
});

test('leg26：env 键值必须是非空字符串（世界参数档位域）——数值/空串一律拒', () => {
    const asNumber = baseWorld();
    asNumber.context.setting = { dynamic: { tension: { polarity: 'P', intensity: 0.5 }, env: { '天时': 0.5 } } };
    const r1 = validate(asNumber, ssotSchema);
    assert.ok(!r1.ok, '★数值不再合法（"引擎推演数值"那条通道已删）');
    assert.ok(r1.errors.some((e) => e.includes('期望非空字符串')), r1.errors.join('; '));

    const asEmpty = baseWorld();
    asEmpty.context.setting = { dynamic: { tension: { polarity: 'P', intensity: 0.5 }, env: { '天时': '  ' } } };
    assert.ok(!validate(asEmpty, ssotSchema).ok, '空串也不是档位（空着就该删键，而不是写空串）');

    const asGear = baseWorld();
    asGear.context.setting = { dynamic: { tension: { polarity: 'P', intensity: 0.5 }, env: { '天时': '平常' } } };
    assert.equal(validate(asGear, ssotSchema).ok, true, '档位原话合法');
});

// =====================================================================================
// ★★★leg99：**事件出生轮解析器**（`eventBornTick`）——把两把不一致的尺子合成一把
// =====================================================================================
// 这一节治的是什么（它不是"新功能"，是**同一个事实此前有两个答案**）：
//   leg98 §9 登记、leg99 量清：仓里有**两把"事件出生轮"尺子**，对同一个 id 给出两个答案——
//     · `src/panorama.js` 的 `bornTick`（说书那一层）：`ev_seed_N` 算**第 0 轮**；
//     · `src/setting.js` 的 `eventBornTick`（引擎契约点）：按"取首个数字段"把 `ev_seed_N` 读成**第 N 轮**。
//   真账实测（`F:/deepseek/tmp/prototypes/leg98-born-divergence.mjs`）：92 件事里 **8 件不一致**，全是 `ev_seed_N`。
//
// ★哪一把是对的、凭什么：`ev_seed_N` 里的 `N` 是**播种时的枚举号**，不是轮次——
//   出处 `src/seed-roots.js:149` 的 `while (taken.has(...)) n += 1;`（那段代码只保证 id 不撞车）。
//   ★而且本仓**早就把"种子算第 0 轮"写进过注释与判据**：`src/panorama.js:22` 的注释、
//   `test/panorama.test.js:148` 的 `bornTick('ev_seed_3') === 0`。⇒ 本笔是把引擎那一口**回到已写定的口径**。
//
// ★玩家看得见的那一笔（`F:/deepseek/tmp/prototypes/leg99-born-impact.mjs`，真机账 大荒z · 第 12 轮）：
//   「近 10 轮事件」  **83（旧·把 7 件种子算了进来）→ 76（新）**。
//   ★而两个读数**实测受影响为零**，所以这不是"报批级"改动：张力强度 freq 腿两口径都早饱和在 1.000；
//     把种子整个剔掉再问 `unrestGearOf`，**档位照旧**「大乱」。
//
// ★纪律（本仓踩过的坑，写在这里免得下一任重踩）：
//   ①**断言的量词要选对**（leg98 §8.8）：用户看的是"近 10 轮事件"**这个数**，
//     所以主判据是**整个计数**（`recentEventCount` 的返回值）——只数种子个数的话，
//     别的 id 坏掉了这条判据照样绿（那正是 leg98 §3.6 那次"空绿"的同族）。
//   ②**先让前置条件成立再断言**（leg98 §3.6/§3.7 连踩三次）：所以下面先断言
//     "同一批事件里那件普通事件**确实**在窗口内"，再断言种子**不在**。

test('★★★leg99：种子算第 0 轮——且**两把尺子在事件 id 空间里必须同答案**（这就是 leg98 §9 那处契约问题的判据）', () => {
    // 种子的数字段是**枚举号**、不是轮次 ⇒ 不论枚举到几，都是第 0 轮
    for (const n of [1, 2, 3, 8, 20, 137]) {
        assert.equal(eventBornTick(`ev_seed_${n}`), 0, `ev_seed_${n} 必须算第 0 轮（枚举号 ≠ 轮次）`);
    }
    // ★两把尺子同答案（真正的病：它们此前对**同一个 id** 给 0 与 N 两个答案）
    //   ★范围要说清：只在**两把尺子都认的事件 id** 上要求同答案——
    //   `panorama.bornTick` 对事件以外的 id（`m_*` / `ev_pump_*` / `e_bk_*`）**故意返回 null**
    //   （它只服务说书层，见 `src/panorama.js:22-27`、`test/panorama.test.js:147-148`）
    //   ⇒ 拿它去比"它也认不得的 id"是把断言写过头（本笔第一版就这么错过一次，如实留档）。
    for (const id of ['ev_seed_1', 'ev_seed_8', 'ev_1_1', 'ev_12_3', 'ev_0_1', 'ev_999_2']) {
        assert.equal(eventBornTick(id), panBornTick(id), `★${id} 上两把尺子必须同答案（引擎契约点 vs 说书层）`);
    }
    // ★边界如实钉住：事件 id 空间**之外**的 id，两把尺子本就不同域——不是 bug，是分工。
    assert.equal(panBornTick('ev_pump_10_2'), null, '说书层不认熵泵事件（它不进说书那一层）');
    assert.equal(eventBornTick('ev_pump_10_2'), 10, '引擎层照旧认它（取首个数字段 = 轮次）');
});

test('leg99：普通事件照旧取**轮次那一格**（改动不许把正常 id 读坏）', () => {
    assert.equal(eventBornTick('ev_12_3'), 12);
    assert.equal(eventBornTick('ev_pump_10_2'), 10, '★熵泵事件照旧取轮次（它的 id 里 tick 就在首个数字段）');
    assert.equal(eventBornTick('ev_0_1'), 0);
});

test('leg99：解析不出来 ⇒ -Infinity（老账/坏 id 不占活跃度窗口）——这条口径一个字没动', () => {
    // "解析不出来"＝**整条 id 里一个纯数字段都没有**
    for (const bad of ['', null, undefined, 'e_p1', 'ev_seed_x', 'ev_x_y', 'book#3']) {
        assert.equal(eventBornTick(bad), -Infinity, `${String(bad)} 里没有数字段 ⇒ -Infinity`);
    }
});

test('★leg99：**宽口径**如实钉住（本笔量出来的一处，此前没人登记过）', () => {
    // `eventBornTick` 是"取**首个纯数字段**"——所以事件以外的 id 也会被它算出一个数：
    //   `m_10`（里程碑）⇒ 10、`e_bk_1`（实体书号）⇒ 1、`ch_1_x`（编年）⇒ 1、`a_1_2`（盘算）⇒ 1。
    // ★为什么这样也无害（本笔取证，不是猜）：这些 id **不进事件数组**——
    //   `recentEventCount` / `unrestPlaces` 都是从 `world.events` 里取 `e.id` 再解析，
    //   而 `world.events` 里的 id 只有 `ev_*` 一族（真账 92 件实测：全是 `ev_seed_*`/`ev_<轮>_<序>`）。
    //   ⇒ 宽口径是"够用且不冒烟"，**本笔不动它**（收窄会影响 settle 对 up 指针 `m_*` 的段位计算）。
    assert.equal(eventBornTick('m_10'), 10, '里程碑 id 照旧算 10（它只被 settle 的段位计算用到）');
    assert.equal(eventBornTick('e_bk_1'), 1, '实体书号照旧算 1（它不进事件数组）');
    assert.equal(eventBornTick('ch_1_x'), 1);
    assert.equal(eventBornTick('a_1_2'), 1);
    // ★反向之一：上面那句"它们不进事件数组"必须是**产品自己保证的**，不是我说的——
    //   即：种子与普通事件两类 id 必须**都**能被解析出来（否则窗口会静默漏事件）
    for (const id of ['ev_seed_1', 'ev_1_1', 'ev_pump_3_1']) {
        assert.notEqual(eventBornTick(id), -Infinity, `事件 id 必须解析得出来：${id}`);
    }
});

test('★★★leg99：反向之"剔过头"——**熵泵事件也生在某一轮**，不许跟种子一起被当成第 0 轮', () => {
    // 为什么单立这一条：本笔第一版把"剔过头"只写在**解析器**上（断言 `ev_pump_10_2 === 10`），
    //   结果反向自证当场咬出来——把守卫写宽成 `/^(?:ev_seed|ev_pump)_\d+$/` 时**判据全绿**
    //   （那处断言在别的 test 里，而这一条真正该咬的是**整个计数**）。
    //   ⇒ 照本仓纪律：**测"整条链"而不测"某个零件"**（同 leg98 §3.6 那次"断言的量词选错"）。
    const tick = 12;
    const world = {
        meta: { tick },
        events: [
            { id: 'ev_seed_1', source: { type: 'seed' } },        // 第 0 轮（种子）
            { id: 'ev_pump_11_1', source: { type: 'pump' } },     // 第 11 轮 ⇒ 距当前 1 轮 ⇒ **在窗内**
            { id: 'ev_12_1', source: { type: 'ripple' } },        // 第 12 轮 ⇒ 距当前 0 轮 ⇒ 在窗内
        ],
    };
    // ① 前置条件：那两件**非种子**事件确实落在窗口内
    for (const id of ['ev_pump_11_1', 'ev_12_1']) {
        assert.ok(tick - eventBornTick(id) <= TENSION_WINDOW, `前置：${id} 必须在窗内（距当前 ${tick - eventBornTick(id)} 轮）`);
    }
    // ② 主判据：整条链只有 **1 件**种子不算数 ⇒ 计数必须是 2（种子 + 熵泵 + 涟漪 = 3 件，减去种子那 1 件）
    assert.equal(recentEventCount(world, tick), 2,
        '★熵泵事件生在某一轮、**必须算进窗口**；只有种子算第 0 轮（把 pump 一起剔掉就是"剔过头"）');
});

test('★★★leg99：真账形的复现——「近 10 轮事件」**整个数**（种子落进窗口会让它虚高）', () => {
    const tick = 12;
    // 照真账形状造：8 件开局种子（`ev_seed_1..8`）＋ 2 件普通事件（第 1、2 轮出生）
    const world = {
        meta: { tick },
        events: [
            ...Array.from({ length: 8 }, (_, i) => ({ id: `ev_seed_${i + 1}`, source: { type: 'seed' } })),
            { id: 'ev_1_1', source: { type: 'ripple' } },
            { id: 'ev_2_1', source: { type: 'ripple' } },
        ],
    };
    // ① 前置条件先成立：那件普通事件**确实**在窗口内（否则下面的断言是空绿）
    assert.ok(tick - eventBornTick('ev_2_1') <= TENSION_WINDOW,
        `前置：ev_2_1 必须落在窗口内（距当前 ${tick - eventBornTick('ev_2_1')} 轮，窗 = ${TENSION_WINDOW}）`);
    // ② 前置条件的反向：第 1 轮那件**已出窗**（距当前 11 > 窗 10）
    //    ★与真账实测对得上：`ev_seed_1`（旧法算第 1 轮）距当前 11 轮 ⇒ 旧法自己也没把它算进去
    assert.ok(tick - 1 > TENSION_WINDOW, `前置：第 1 轮距当前 ${tick - 1} 轮，应已出窗（窗 = ${TENSION_WINDOW}）`);
    // ③ 主判据：**整个计数** —— 只有第 2 轮那件算数；8 件种子一件都不许进
    assert.equal(recentEventCount(world, tick), 1,
        '★种子一件都不许算进"近 10 轮"；这个数就是面板上那个（旧法会把它印成虚高的数）');
});

test('★★leg99：种子影响「乱象档位」吗——如实量一遍（本笔登记为"不变"，这里把它钉住）', () => {
    const tick = 30;
    const mk = (events) => ({
        meta: { tick },
        events,
        entities: [], weights: {}, agendas: [], chronicle: [], milestones: [],
        context: { setting: { dynamic: { env: {} } } },
    });
    // 7 个不同地点的事件 ⇒ 铺开够宽 ⇒ 高档位（沿用 unrest.test.js 的形状）
    const real = Array.from({ length: 7 }, (_, i) => ({ id: `ev_${tick - 1}_${i + 1}`, position: `地${i}`, source: { type: 'state' }, ripples: [] }));
    const seeds = [{ id: 'ev_seed_1', position: '地0', source: { type: 'seed' }, ripples: [] }];
    const withSeeds = unrestGearOf(mk([...real, ...seeds]), tick);
    const withoutSeeds = unrestGearOf(mk(real), tick);
    assert.equal(withSeeds, withoutSeeds, '★种子不许改变玩家看得见的乱象档位（leg99 实测：真账那 8 件也不改变）');
});

test('leg99：注释里那句"单一契约点"不许退化成谎话——同族逻辑的**住处必须被登记**', () => {
    // `src/setting.js` 的注释称本处是"单一契约点"，但仓里另有 **copy 一份**的同族解析器。
    // 本笔**没动它们**（收敛成一处是模块图改动，另案），所以这里只钉住一件事：
    // 那些复本**必须在注释里被登记**，免得下一任以为全仓真只有一处、于是改错了地方。
    const setting = readSrc('../src/setting.js');
    assert.match(setting, /memory-bridge\.js/, '★setting.js 必须登记 memory-bridge 那份复本（本笔未收敛，只登记）');
    assert.match(setting, /pack\.js/, '★setting.js 必须登记 pack.js 那两处复本');
    // 反向自证：登记的那两处**确实存在**（否则那段注释就是空话）
    const mem = readSrc('../src/memory-bridge.js');
    const pk = readSrc('../src/pack.js');
    assert.match(mem, /split\('_'\)\.find\(/, '★memory-bridge 那份复本必须还在（注释指的是真事）');
    assert.match(pk, /split\('_'\)\[1\]/, '★pack.js 那两处必须还在（注释指的是真事）');
});