// story-world-v2/test/unrest.test.js
// ★★leg53：**「乱象」的引擎生产者**——用户令「引擎每轮从账上真发生的事推一个档位」。
//
// 这一格为什么必须单独立判据（三条，都是本仓踩过的）：
//   ① **它是本仓第一个"引擎每轮写因变量"的机制**。此前 `民生度`/`动乱度` 被定义为**因变量**
//      （`PARAM_NATURE`）、面板因此不给旋钮（leg26 红线），**却没有任何生产者**——
//      `param-hub.js:520` 那句"世界的因变量归世界自己每轮写、每轮覆盖（引擎的既有行为）"**是假的**
//      （全仓无此代码）。⇒ 本条判据存在的意义就是：**让那句话变成真的**。
//   ② **严禁变成"恒为常数的死腿"**：`setting.js` 的张力公式里 `rival` 那条腿
//      实测 100 tick 里 t10–t80 **恒为 1.0000** ⇒ 等价于一个写死的 +0.4 常数偏置（leg25 b 记档）。
//      ⇒ 本组的判据必须**真的量"它会不会动"**，而不是只量"算出来了没有"。
//   ③ **一个数两把尺子**：张力那边已经用了"近窗**事件密度**"；本机制用**不同地点数**（扰动铺开多宽），
//      两者**度量不同的东西** ⇒ 判据要锁住"它不是在算第二遍事件数"。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { unrestGearOf, updateUnrestGear, UNREST_GEARS, UNREST_WINDOW } from '../src/unrest.js';
import { TENSION_WINDOW } from '../src/setting.js';
import { PARAM_GEARS } from '../src/params.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 造一个只有事件/实体的最小世界；`events` 每项 = [出生轮, 位置, 牵动人数]。 */
const mkWorld = (rows, tick, extra = {}) => ({
    version: 1,
    context: { world: 'x', setting: { dynamic: { tension: { polarity: 'P', intensity: 0.5 }, env: {}, derivedFrom: [] } } },
    entities: [{ id: 'e_a', kind: 'faction', name: '甲', location: 'x' }],
    weights: { e_a: 1 },
    agendas: [], chronicle: [], milestones: [],
    events: rows.map(([born, pos, n], i) => ({
        id: `ev_${born}_${i + 1}`, title: 't', position: pos, source: { type: 'state' },
        ripples: Array.from({ length: n || 0 }, (_, k) => `e_r${i}_${k}`),
    })),
    meta: { tick, simLog: [] },
    ...extra,
});

test('★★leg53·A：乱象是**引擎算的**，不是书里写的——四档全走一遍（结构判据：扰动铺开到几个地点）', () => {
    // 窗口口径：**复用 `TENSION_WINDOW`**（不新开一个窗口数——本仓"一个新数字一次报批"）
    assert.equal(UNREST_WINDOW, TENSION_WINDOW, '★窗口必须复用 TENSION_WINDOW（不另立一个数）');
    // 档位必须是 `params.js` 里那一套的**子集**（不新开词汇表）
    for (const g of UNREST_GEARS) assert.ok(PARAM_GEARS['动乱度'].includes(g), `档位「${g}」必须来自 params.js 的动乱度白名单`);
    assert.deepEqual([...UNREST_GEARS], [...PARAM_GEARS['动乱度']], '四档一个不多一个不少');

    const T = 30;
    const at = (places) => mkWorld(
        Array.from({ length: places }, (_, i) => [T - 1, `地${i}`, 0]), T,
    );
    // ① 1 个地点 ⇒ 太平；② 3 个 ⇒ 小乱；③ 5 个 ⇒ 动荡；④ 7 个 ⇒ 大乱
    assert.equal(unrestGearOf(at(1), T), '太平', '只扰动 1 个地点 ⇒ 太平');
    assert.equal(unrestGearOf(at(2), T), '太平', '2 个地点 ⇒ 太平（四档的下界）');
    assert.equal(unrestGearOf(at(3), T), '小乱', '3 个地点 ⇒ 小乱');
    assert.equal(unrestGearOf(at(5), T), '动荡', '5 个地点 ⇒ 动荡');
    assert.equal(unrestGearOf(at(7), T), '大乱', '7 个地点 ⇒ 大乱');
    assert.equal(unrestGearOf(at(20), T), '大乱', '再多也只是大乱（**封顶**，不发明第五档）');
    assert.equal(unrestGearOf(at(0), T), '太平', '一件扰动都没有 ⇒ 太平（空账不是"未定"）');
});

test('★★leg53·B：**同一个地点发生多件事只算一个地点**（判据③"不是第二把尺子"的机械证据）', () => {
    const T = 30;
    // 7 件事件**全在同一个地点** ⇒ 地点数 = 1 ⇒ 太平；而"近窗事件数"是 7（张力那边吃的是这个）
    const same = mkWorld(Array.from({ length: 7 }, () => [T - 1, '同一个地方', 0]), T);
    assert.equal(unrestGearOf(same, T), '太平',
        '★7 件事挤在一个地点 ⇒ 扰动没铺开 ⇒ 太平（若这里给出"大乱"，说明它其实在数事件数＝第二把尺子）');
    // 对照：同样 7 件事件铺到 7 个地点 ⇒ 大乱
    const spread = mkWorld(Array.from({ length: 7 }, (_, i) => [T - 1, `地${i}`, 0]), T);
    assert.equal(unrestGearOf(spread, T), '大乱', '同样 7 件事、铺开 7 个地点 ⇒ 大乱');
});

test('★★leg53·C：**真会动**（防 `rival` 那种恒为常数的死腿）——输入扫一遍，档位必须真的跟着动', () => {
    // ★这条是本组最贵的一条：只量"算出来了没有"是**不够的**——`setting.js` 的 `rival`
    //   实测恒为 1.0000，年年绿灯而那条腿什么都没度量。⇒ 判据必须量**输出对输入的响应**。
    //   ★口径（第一版写错了，自证抓红留档）：**不许拿"同一个世界逐轮扫"当自变量**——
    //     那是**时间**，而本机制的输入是**空间铺开度**；同一个 fixture 逐轮扫，输入根本没变，
    //     输出当然不变（第一版就是这么假红的：早期/后期都是大乱）。
    //   ⇒ 定稿：**直接扫输入**（铺开 0…9 个地点），量两件事：
    //     ① 取值多样性 ≥ 3（不是常数）；② **单调不减**（铺得越开，档位不会反而更轻）。
    const T = 30;
    const sweep = [];
    for (let places = 0; places <= 9; places++) {
        const w = mkWorld(Array.from({ length: places }, (_, i) => [T - 1, `地${i}`, 0]), T);
        sweep.push(unrestGearOf(w, T));
    }
    const kinds = new Set(sweep);
    assert.ok(kinds.size >= 3,
        `★铺开度 0→9 之间至少应出现 3 种档位（实测 ${kinds.size} 种：${[...kinds].join('/')}）——只有 1 种就是死腿`);
    assert.equal(sweep[0], UNREST_GEARS[0], '一个地点都没扰动 ⇒ 最轻那一档');
    assert.equal(sweep[sweep.length - 1], UNREST_GEARS[UNREST_GEARS.length - 1], '铺到 9 个地点 ⇒ 最重那一档');
    for (let i = 1; i < sweep.length; i++) {
        const prev = UNREST_GEARS.indexOf(sweep[i - 1]);
        const cur = UNREST_GEARS.indexOf(sweep[i]);
        assert.ok(cur >= prev, `★单调不减：铺开度 ${i - 1}→${i} 时档位不许回落（${sweep[i - 1]} → ${sweep[i]}）`);
    }
    // ★反向自证（防这条锁退化成空绿）：扫出来的**必须不止一档**，否则上面那条单调断言恒真
    assert.ok(sweep.some((g) => g !== sweep[0]), '前置：这个扫描里档位真的变过（否则单调断言是空绿）');
});

test('★★leg53·D：只吃**窗口内**的事件（老账不冒充现况）', () => {
    const T = 30;
    // 7 个地点的事件全都生在窗口**之外** ⇒ 不算数 ⇒ 太平
    const stale = mkWorld(Array.from({ length: 7 }, (_, i) => [T - UNREST_WINDOW - 1, `地${i}`, 0]), T);
    assert.equal(unrestGearOf(stale, T), '太平', '★窗口外的老事件不许冒充"现在很乱"');
    // 边界：正好落在窗口边上（t - born === UNREST_WINDOW）⇒ 算在内（与 `recentEventCount` 同口径）
    const edge = mkWorld(Array.from({ length: 7 }, (_, i) => [T - UNREST_WINDOW, `地${i}`, 0]), T);
    assert.equal(unrestGearOf(edge, T), '大乱', '★窗口边界与 `recentEventCount` 同口径（含边界）');
});

test('★★leg53·E：落账——写进 `dynamic.env.动乱度`，且**不动别人的键**', () => {
    const T = 30;
    const w = mkWorld(Array.from({ length: 7 }, (_, i) => [T - 1, `地${i}`, 0]), T);
    w.context.setting.dynamic.env = { 天时: '大灾', 动乱度: '动荡', memoryEnabled: '1' };
    const next = updateUnrestGear(w, T);
    assert.equal(next.context.setting.dynamic.env['动乱度'], '大乱', '★引擎把算出来的档位写进账');
    assert.equal(next.context.setting.dynamic.env['天时'], '大灾', '★玩家/书定的自变量一个都不许动');
    assert.equal(next.context.setting.dynamic.env['memoryEnabled'], '1', '★开关不许动');
    // 纯函数（存量的写法不许改入参——`updateTensionIntensity` 同款语义）
    assert.equal(w.context.setting.dynamic.env['动乱度'], '动荡', '★不改入参（纯函数）');
});
