// story-world-v2/test/streams.test.js
// S6 验收：双流渲染 + 完整 tick 编排（伪造 transport）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runTick } from '../src/tick.js';
import { renderStreams } from '../src/streams.js';
import { visibilityMask, MASK } from '../src/weight.js';

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/golden-world.min.json', import.meta.url), 'utf8'));
const EXTRACT_FIX = JSON.parse(readFileSync(new URL('./fixtures/extract-samples.json', import.meta.url), 'utf8'));

const validStep = () => ({
    actions: [{ entity: 'e_merchant', verb: '沿商路北上巡查', position: '商路' }],
    newEvents: [{ title: '守将允诺通关', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: ['e_merchant'] }],
    agendaAdvances: [{ agendaId: 'a_1', step: '守将首肯，车队放行', stage: '过边关' }],
    // leg25 c（用户令「删」）：原先这里还有一条 `stateChanges: [{entity:'e_merchant', attr:'network', delta:0.05}]`。
    //   四维浮点（兵力/权位/人脉/耳目）整条删除之后，契约层 `stateChanges` 也一并删了 ⇒ 再带着这个键，
    //   整个世界步会被 `$.stateChanges: 未知字段` 拒掉（本文件此前 5 条红的根因）。故整条删除，不留换名字段。
    newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
});
const fakeTransport = async () => ({ text: JSON.stringify(validStep()) });

const runOne = (dialogue) =>
    runTick({ transport: fakeTransport, ssot: GOLDEN, dialogue, extractCtx: EXTRACT_FIX.context });

test('双流：观棋三行齐备（动态流/位置/格局），注入带世界动向与行迹', async () => {
    const s = EXTRACT_FIX.samples.find((x) => x.id === 'l91');
    const r = await runOne(s.dialogue);
    assert.equal(r.ok, true, r.error);
    const obs = r.streams.observer.join('\n');
    assert.ok(obs.includes('◆ [tick 1] 盘算「打通边关商路」推进'), '动态流：盘算推进');
    assert.ok(obs.includes('◆ [tick 1] 事件「守将允诺通关」——由盘算「打通边关商路」而生'), '动态流：事件带因果');
    assert.ok(obs.includes('📍 各方位置：大荒商帮 @ 临渊城'), '位置行');
    assert.ok(obs.includes('▣ 当前格局：张力 0.5 · 未决事件 1 · 在飞盘算 1（「打通边关商路」2/4）'), '格局行（tick 后推进 1 步，2/4）');
    const inj = r.streams.injection;
    assert.ok(inj.includes('【世界动向】事件「守将允诺通关」'), '注入：世界动向');
    assert.ok(inj.includes('【你的行迹】收服向 龙蛋'), '注入：行迹（落子已记，兑现待结算）');
});

test('双流：波及实体渲染为名（"棋好看"）', async () => {
    const s = EXTRACT_FIX.samples.find((x) => x.id === 'l25');
    const r = await runOne(s.dialogue);
    assert.ok(r.ok, r.error);
    assert.ok(r.streams.observer.join('\n').includes('牵动 大荒商帮'), 'id 渲染成名');
});

test('tick 编排：OOC 对话 → 落子为空但世界照常结算（世界以自身状态为原料）', async () => {
    const r = await runOne('（继续）');
    assert.equal(r.ok, true);
    assert.equal(r.move.verb, null, '落子未提取');
    assert.equal(r.ssot.meta.tick, 1, 'tick 照常推进');
    assert.equal(r.ssot.meta.simLog.length, 1, '台账照记');
    assert.ok(r.streams.injection.includes('【世界动向】'), '世界动向照常注入');
    assert.ok(!r.streams.injection.includes('【你的行迹】'), '无落子 → 无行迹行');
});

test('tick 编排：主调用失败 → 世界不动，错误透出', async () => {
    const bad = async () => ({ text: '散文' });
    const r = await runTick({ transport: bad, ssot: GOLDEN, dialogue: '我去看看', extractCtx: EXTRACT_FIX.context });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('非法 JSON'));
    assert.equal(GOLDEN.meta.tick, 0);
});

test('主验收判据：观棋侧出现第一条动态流条目（可读、带因果、用户看得见）', async () => {
    const s = EXTRACT_FIX.samples.find((x) => x.id === 'l25');
    const r = await runOne(s.dialogue);
    assert.equal(r.ok, true);
    const first = r.streams.observer[0];
    assert.ok(first.startsWith('◆ [tick 1] '), `首条 = ${first}`);
    assert.ok(first.length >= 15, '可读长度');
    assert.ok(r.streams.observer.join('\n').includes('——由盘算「'), '因果语义在事件条目上');
    console.log(`[验收] ${first}`);
});

// ---------- 玩家档案 K10：注入掩码真值（K4 解挂，观察者=玩家）——renderStreams 纯函数单测 ----------
// leg25 c（用户令「删」）改动登记：本组夹具原先给实体带 `attrs`（四维浮点），并让观察者带一个 `intel`
//   用来升降"情报因子"。四维与"情报"都是**手拍的 0–1**（书里没刻度、没人能量化"你耳目多灵"），
//   已整条删除 ⇒ ①夹具实体一律不再带 `attrs`（schema 的 additional:false 也会拒）；②`intel` 参数删除。
//   掩码**只剩位置**这一条零歧义的事实（同地/异地二元）。测试意图照旧保留：
//   "事实驱动的掩码真的会挡事 / 挡的判据必须是可查的事实 / 无玩家世界全见降级"。

const eventLine = (id, title) => ({ id: `c_${id}`, tick: 5, text: `事件「${title}」——源：盘算`, eventRef: id });
const stage3 = {
    chronicle: [eventLine('ev_src', '近处大事'), eventLine('ev_mid', '远处琐事'), eventLine('ev_far', '北山动静')],
    warnings: [],
    events: [],
};
const hasLine = (inj, title) => inj?.includes(`事件「${title}」`) ?? false;

const maskWorld = ({ playerId = 'e_player', w = 0.5, at = '黄府' } = {}) => {
    const entities = [
        { id: 'e_src', kind: 'character', name: '榜首', location: '黄府' },
        { id: 'e_mid', kind: 'character', name: '中游', location: '北山' },
        { id: 'e_far', kind: 'character', name: '远客', location: '北山' },
    ];
    if (playerId) {
        entities.push({ id: playerId, kind: 'character', name: '黄坤', location: at });
    }
    return {
        version: 1,
        context: { world: '江州', tension: 0.6, positions: ['黄府', '北山'], ...(playerId ? { playerId } : {}) },
        entities,
        weights: { e_src: 0.9, e_mid: 0.2, e_far: 0.58, ...(playerId ? { [playerId]: w } : {}) },
        agendas: [
            { id: 'a_1', owner: 'e_src', goal: '守门', stage: 's', visibility: 'known', maxSteps: 3, progress: 1, memory: { promises: [], done: [], blocked: [], turnsAlive: 1 } },
            { id: 'a_2', owner: 'e_mid', goal: '行商', stage: 's', visibility: 'known', maxSteps: 3, progress: 1, memory: { promises: [], done: [], blocked: [], turnsAlive: 1 } },
            { id: 'a_3', owner: 'e_far', goal: '远行', stage: 's', visibility: 'known', maxSteps: 3, progress: 1, memory: { promises: [], done: [], blocked: [], turnsAlive: 1 } },
        ],
        events: [
            { id: 'ev_src', title: '近处大事', source: { type: 'plot', ref: 'a_1' }, position: '黄府', ripples: [], links: {}, closed: false },
            { id: 'ev_mid', title: '远处琐事', source: { type: 'plot', ref: 'a_2' }, position: '北山', ripples: [], links: {}, closed: false },
            { id: 'ev_far', title: '北山动静', source: { type: 'plot', ref: 'a_3' }, position: '北山', ripples: [], links: {}, closed: false },
        ],
        chronicle: [],
        meta: { tick: 5 },
    };
};

test('K10（leg25 c 改写）：注入掩码只按位置判定——同地可见 / 异地照旧可见（阈值 0.25 ≤ posDiff）', () => {
    // 为什么断言写成这样：本文件原先靠"玩家在黄府、事件在别处"来分辨判据。
    //   删掉情报项后，掩码只剩位置，**同地/异地都必须可见**——所以位置事实一点也没被削掉，
    //   反倒多了"分量摆布不改变结果"的确定性（见下一条）。
    const r = renderStreams(maskWorld({}), stage3, null);
    assert.ok(hasLine(r.injection, '近处大事'), '同位置 m=posSame=1.0 → 可见');
    assert.ok(hasLine(r.injection, '北山动静'), '异地 m=posDiff=0.5 ≥ 阈值 0.25 → 可见');
    assert.ok(hasLine(r.injection, '远处琐事'), '异地事件一律同判（源的分量高低不再影响）');
});

test('K10（leg25 c 改写）：可见性只随**位置事实**升降——**源/观察者的分量摆布不改变结果**（V6 原判据已退场）', () => {
    // 观察者分量 w 与源分量在删掉比值项后就该完全无关；这里用两个极端玩家分量对照，要求注入**逐字节一致**。
    const weak = renderStreams(maskWorld({ w: 0 }), stage3, null);     // 玩家分量 0
    const strong = renderStreams(maskWorld({ w: 1 }), stage3, null);   // 玩家分量 1
    assert.equal(weak.injection, strong.injection, '分量从 0 到 1，注入一字不变（假精度不再参与可见性）');
    assert.ok(hasLine(weak.injection, '近处大事'), '零分量玩家照常看得见（"零分量无所见"随分数退场）');
    assert.ok(hasLine(weak.injection, '北山动静'), '异地同样照常可见');
});

test('K10（leg25 c 改写）：掩码真的会挡事——判据是位置（同地 1.0 / 异地 0.5），不是任何编出来的数', () => {
    // "会挡事"必须在**掩码层**锁死：只看注入结果的话，同地与异地都在阈值之上，看不出差别。
    assert.equal(visibilityMask({ sameLocation: true }), 1.0, '同地 = posSame');
    assert.equal(visibilityMask({ sameLocation: false }), 0.5, '异地 = posDiff');
    assert.equal(visibilityMask({}), 0.5, '什么都没给 ⇒ 落"异地"一侧（不因缺数据放宽可见性）');
    assert.equal(MASK.threshold, 0.25, '阈值 0.25：异地 0.5 在门槛之上，所以"异地仍可见"是设计而非漏判');

    // 注入层面的对应事实：玩家换个位置（离开黄府去北山），同一条动向的判定随之翻转——位置是真的在起作用。
    const atHome = renderStreams(maskWorld({ at: '黄府' }), stage3, null);
    const away = renderStreams(maskWorld({ at: '北山' }), stage3, null);
    assert.ok(hasLine(atHome.injection, '近处大事'), '玩家在黄府 → 近处大事同地');
    assert.ok(hasLine(away.injection, '北山动静'), '玩家挪到北山 → 北山那条变为同地');
});

test('K10：无玩家世界注入降级全见（P-E），观棋侧恒全局', () => {
    const r = renderStreams(maskWorld({ playerId: null }), stage3, null);
    assert.ok(hasLine(r.injection, '近处大事') && hasLine(r.injection, '远处琐事') && hasLine(r.injection, '北山动静'), '全见');
    assert.ok(r.observer.join('\n').includes('远处琐事'), '观棋侧全见（上帝视角不变）');
});

test('K10（leg25 c 改写）：零分量玩家照常看得见 + 行迹并入不受掩码影响', () => {
    const r = renderStreams(maskWorld({ w: 0 }), stage3, { verb: '修炼' });
    assert.ok(hasLine(r.injection, '近处大事'), '照常可见（旧法：零分量 → 注入仅余行迹）');
    assert.ok(r.injection.includes('【你的行迹】修炼'), '行迹照旧并入（行迹是玩家自己的动作，不查掩码）');
    assert.ok(r.observer.join('\n').includes('◆ [tick 5]'), '观棋照常');
});

// leg25 c（用户令「删」）──**原「玩家账面没有情报值时按中立情报 0.5 算」整条删除**。
//   为什么删：那条测的是"账面缺 intel → 替它编一个中立 0.5"。而现在①`intel` 这个键已不存在；
//   ②"缺数据就给个默认值"正是 design-core-leg23 §2.2 硬规矩一要治的病——**空着就是空着**，
//   引擎不许替世界编数。所以这条不是"改断言续用"，而是整条退场（换名保留中立值同样是被禁的）。

test('K10（leg25）：事件位置缺失 → 按"异地"一侧算（不得因缺数据反而放宽可见性）；判定为显式判真', () => {
    // 事实：MASK.posDiff=0.5、阈值 0.25 → 异地 m 在门槛之上（正因如此"异地"仍在注入里）。
    //   所以"缺位置 vs 真异地"在**输出可见性**上分不开，用**掩码数值**分辨：两者必须都取 posDiff 一侧。
    const w = maskWorld({});
    const evMid = w.events.find((e) => e.id === 'ev_mid');   // 位置=北山（异地；玩家在黄府）
    const evSrc = w.events.find((e) => e.id === 'ev_src');   // 位置=黄府（同地）
    const r = renderStreams(w, stage3, null);
    assert.ok(hasLine(r.injection, '远处琐事'), '真异地 m=0.5 ≥ 阈值 → 可见');
    assert.ok(hasLine(r.injection, '近处大事'), '真同地 m=1.0 → 可见');
    assert.equal(visibilityMask({ sameLocation: evMid.position === '黄府' }), 0.5, '真异地 → 0.5');

    delete evSrc.position;                                   // 位置缺失（旧写法 `undefined === '黄府'` 恒假 → 也是异地，行为逐字节一致）
    const r2 = renderStreams(w, stage3, null);
    assert.equal(
        JSON.stringify(r2.injection.replace('近处大事', 'X')), JSON.stringify(r.injection.replace('近处大事', 'X')),
        '缺位置的那条与"真异地"的判定结果完全一致（同一条动向照常注入）',
    );
    assert.ok(hasLine(r2.injection, '近处大事'), '缺位置 → 按异地一侧 → m=0.5 → 可见');
    // 反向对照：若把"缺位置"误判成**同地**，m 会变成 1.0 → 与"真异地"的那条**不同值**。
    // 用掩码数值直接锁死口径（避免只靠可见性看不见差别）：
    assert.equal(visibilityMask({ sameLocation: false }), 0.5, '异地一侧 = 0.5');
    assert.equal(visibilityMask({ sameLocation: true }), 1.0, '同地一侧 = 1.0');
    assert.equal(MASK.threshold, 0.25, '阈值 0.25（异地 0.5 在门槛之上）');
    // 并锁死"情报不再参与"：任何 intel 值都不得改变结果（防旧法无声复活）。
    assert.equal(visibilityMask({ intel: 0, sameLocation: false }), 0.5, 'intel 不再是入参：给 0 也取 posDiff');
    assert.equal(visibilityMask({ intel: 1, sameLocation: true }), 1.0, 'intel 不再是入参：给 1 也取 posSame');
});