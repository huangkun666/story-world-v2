// story-world-v2/test/streams.test.js
// S6 验收：双流渲染 + 完整 tick 编排（伪造 transport）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runTick } from '../src/tick.js';
import { renderStreams } from '../src/streams.js';

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/golden-world.min.json', import.meta.url), 'utf8'));
const EXTRACT_FIX = JSON.parse(readFileSync(new URL('./fixtures/extract-samples.json', import.meta.url), 'utf8'));

const validStep = () => ({
    actions: [{ entity: 'e_merchant', verb: '沿商路北上巡查', position: '商路' }],
    newEvents: [{ title: '守将允诺通关', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: ['e_merchant'] }],
    agendaAdvances: [{ agendaId: 'a_1', step: '守将首肯，车队放行', stage: '过边关' }],
    stateChanges: [{ entity: 'e_merchant', attr: 'network', delta: 0.05, cause: 'a_1' }],
    newAgendas: [], agendaCancels: [],
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
    assert.ok(obs.includes('◆ [tick 1] 事件「守将允诺通关」——源：盘算'), '动态流：事件带因果');
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
    assert.ok(r.streams.observer.join('\n').includes('波及 大荒商帮'), 'id 渲染成名');
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
    assert.ok(r.streams.observer.join('\n').includes('——源：'), '因果语义在事件条目上');
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

test('K10：注入掩码按 玩家分量×情报×位置（m<0.3 省略，阈值语义）', () => {
    // 观察者 w=0.5、intel=0.5 → intelFactor 0.75：同位置强源 m=1.35→1 可见；异地弱源 m=0.15 省略；异地中源 m=0.435 可见
    const r = renderStreams(maskWorld({}), stage3, null);
    assert.ok(hasLine(r.injection, '近处大事'), '同位置强源可见');
    assert.ok(hasLine(r.injection, '北山动静'), 'm=0.435 ≥ 0.3 可见');
    assert.ok(!hasLine(r.injection, '远处琐事'), 'm=0.15 < 0.3 省略');
});

test('K10：数值序（V6）——低分量+低情报对异地事件可见性 ≤ 高分量+高情报', () => {
    // 北山动静（src 0.58，异地）：weak m=0.58/0.5×0.5×0.5=0.29 <0.3 省略；strong m=0.58/0.9×1.0×0.5=0.322 ≥0.3 可见
    const weak = renderStreams(maskWorld({ w: 0.5, intel: 0 }), stage3, null);
    const strong = renderStreams(maskWorld({ w: 0.9, intel: 1 }), stage3, null);
    assert.ok(!hasLine(weak.injection, '北山动静'), '低分量+低情报 → 远事不可见');
    assert.ok(hasLine(strong.injection, '北山动静'), '高分量+高情报 → 可见');
    assert.ok(hasLine(weak.injection, '近处大事') && hasLine(strong.injection, '近处大事'), '近处强源双方可见');
});

test('K10：无玩家世界注入降级全见（P-E），观棋侧恒全局', () => {
    const r = renderStreams(maskWorld({ playerId: null }), stage3, null);
    assert.ok(hasLine(r.injection, '近处大事') && hasLine(r.injection, '远处琐事') && hasLine(r.injection, '北山动静'), '全见');
    assert.ok(r.observer.join('\n').includes('远处琐事'), '观棋侧全见（上帝视角不变）');
});

test('K10：零分量玩家无所见（注入仅余行迹，观棋照常）', () => {
    const r = renderStreams(maskWorld({ w: 0 }), stage3, { verb: '修炼' });
    assert.equal(r.injection, '【你的行迹】修炼——落子已记，兑现待棋局结算（时差 §4.7）', '仅行迹');
    assert.ok(r.observer.join('\n').includes('◆ [tick 5]'), '观棋照常');
});