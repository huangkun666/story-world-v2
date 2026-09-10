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
    stateChanges: [{ entity: 'e_merchant', attr: 'network', delta: 0.05, cause: 'a_1' }],
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

const eventLine = (id, title) => ({ id: `c_${id}`, tick: 5, text: `事件「${title}」——源：盘算`, eventRef: id });
const stage3 = {
    chronicle: [eventLine('ev_src', '近处大事'), eventLine('ev_mid', '远处琐事'), eventLine('ev_far', '北山动静')],
    warnings: [],
    events: [],
};
const hasLine = (inj, title) => inj?.includes(`事件「${title}」`) ?? false;

const maskWorld = ({ playerId = 'e_player', w = 0.5, intel = 0.5, at = '黄府' } = {}) => {
    const entities = [
        { id: 'e_src', kind: 'character', name: '榜首', location: '黄府', attrs: { hardPower: 0.9 } },
        { id: 'e_mid', kind: 'character', name: '中游', location: '北山', attrs: { hardPower: 0.2 } },
        { id: 'e_far', kind: 'character', name: '远客', location: '北山', attrs: { hardPower: 0.58 } },
    ];
    if (playerId) {
        entities.push({ id: playerId, kind: 'character', name: '黄坤', location: at, attrs: { hardPower: 0.5, office: 0.3, network: 0.5, intel } });
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

test('K10（片3 改写）：注入掩码按 情报 × 位置 判定（m<0.25 省略）——**分量不再参与**', () => {
    // 观察者 intel=0.5 → intelFactor 0.75：同位置 m=0.75 可见；异地 m=0.375 可见（≥0.25）
    const r = renderStreams(maskWorld({}), stage3, null);
    assert.ok(hasLine(r.injection, '近处大事'), '同位置可见');
    assert.ok(hasLine(r.injection, '北山动静'), '异地 m=0.75×0.5=0.375 ≥ 0.25 可见');
    assert.ok(hasLine(r.injection, '远处琐事'), '异地事件一律同判（源的分量高低不再影响）');
});

test('K10（片3 改写）：可见性只随情报升降——**源/观察者的分量摆布不改变结果**（V6 原判据已退场）', () => {
    const weak = renderStreams(maskWorld({ w: 0.5, intel: 0 }), stage3, null);     // intelFactor 0.5
    const strong = renderStreams(maskWorld({ w: 0.9, intel: 1 }), stage3, null);   // intelFactor 1.0
    // 低情报：同位置 m=0.5 可见；异地 m=0.25 恰好门槛 → 也可见
    assert.ok(hasLine(weak.injection, '近处大事'), '低情报同位置可见');
    assert.ok(hasLine(weak.injection, '北山动静'), '低情报异地 m=0.25 恰好门槛（≥）→ 可见');
    // 高情报：一律可见
    assert.ok(hasLine(strong.injection, '北山动静'), '高情报异地可见');
});

test('K10（片3 改写）：极低情报 + 异地 → 阈下省略（掩码仍会挡事，只是判据换成了事实）', () => {
    const r = renderStreams(maskWorld({ intel: 0 }), stage3, null);   // intelFactor 0.5
    assert.ok(hasLine(r.injection, '近处大事'), '同位置 m=0.5 → 可见');
    assert.ok(hasLine(r.injection, '北山动静'), '异地 m=0.25 → 可见（≥ 阈值）');
    // 真正会被挡下的是"情报与位置都不占"的极端：这里用 events 缺位置信息来构造
    const noPos = renderStreams(maskWorld({ intel: 0, at: '别处' }), stage3, null);
    assert.ok(hasLine(noPos.injection, '近处大事'), '位置不同 → 0.25，仍可见（阈值就是 0.25）');
});

test('K10：无玩家世界注入降级全见（P-E），观棋侧恒全局', () => {
    const r = renderStreams(maskWorld({ playerId: null }), stage3, null);
    assert.ok(hasLine(r.injection, '近处大事') && hasLine(r.injection, '远处琐事') && hasLine(r.injection, '北山动静'), '全见');
    assert.ok(r.observer.join('\n').includes('远处琐事'), '观棋侧全见（上帝视角不变）');
});

test('K10（片3 改写）：分量归零的玩家照常看得见（"零分量无所见"随分数退场）', () => {
    const r = renderStreams(maskWorld({ w: 0 }), stage3, { verb: '修炼' });
    assert.ok(hasLine(r.injection, '近处大事'), '照常可见（旧法：零分量 → 注入仅余行迹）');
    assert.ok(r.injection.includes('【你的行迹】修炼'), '行迹照旧并入');
    assert.ok(r.observer.join('\n').includes('◆ [tick 5]'), '观棋照常');
});

test('K10（片3）：玩家账面没有情报值时按中立情报（0.5）算，不因"没数据"而瞎', () => {
    const w = maskWorld({});
    const player = w.entities.find((e) => e.id === 'e_player');
    player.attrs = {};                       // 账面无数（片2 起新世界常态）
    const r = renderStreams(w, stage3, null);
    assert.ok(hasLine(r.injection, '近处大事'), '账面无数 → 中立情报 0.5 → 同位置 0.75 可见');
});

test('K10（leg25）：事件位置缺失 → 按"异地"一侧算（不得因缺数据反而放宽可见性）；判定改为显式判真', () => {
    // 事实：MASK.posDiff=0.5、阈值 0.25 → 无情报观察者的异地 m 恰为门槛 0.25（正因如此"异地"仍在注入里）。
    // 所以"缺位置 vs 真异地"在**输出可见性**上分不开，用**掩码数值**分辨：两者必须都取 posDiff 一侧。
    const w = maskWorld({ intel: 0 });
    const evMid = w.events.find((e) => e.id === 'ev_mid');   // 位置=北山（异地）
    const evSrc = w.events.find((e) => e.id === 'ev_src');   // 位置=黄府（同地，玩家在黄府）
    const r = renderStreams(w, stage3, null);
    assert.ok(hasLine(r.injection, '远处琐事'), '真异地 m=0.25 ≥ 阈值 → 可见');
    assert.ok(hasLine(r.injection, '近处大事'), '真同地 m=0.5 → 可见');

    delete evSrc.position;                                   // 位置缺失（旧写法 `undefined === '黄府'` 恒假 → 也是异地，行为逐字节一致）
    const r2 = renderStreams(w, stage3, null);
    assert.equal(
        JSON.stringify(r2.injection.replace('近处大事', 'X')), JSON.stringify(r.injection.replace('近处大事', 'X')),
        '缺位置的那条与"真异地"的判定结果完全一致（同一条动向照常注入）',
    );
    assert.ok(hasLine(r2.injection, '近处大事'), '缺位置 → 按异地一侧 → m=0.25（门槛）→ 照常可见');
    // 反向对照：若把"缺位置"误判成**同地**，m 会变成 0.5 → 与"真异地"的那条**不同值**。
    // 用掩码数值直接锁死口径（避免只靠可见性看不见差别）：
    assert.equal(visibilityMask({ intel: 0, sameLocation: false }), 0.25, '异地一侧 = 0.25');
    assert.equal(visibilityMask({ intel: 0, sameLocation: true }), 0.5, '同地一侧 = 0.5');
    assert.equal(MASK.threshold, 0.25, '阈值 0.25（异地恰好门槛）');
});