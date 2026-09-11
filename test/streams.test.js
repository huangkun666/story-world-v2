// story-world-v2/test/streams.test.js
// S6 验收：双流渲染 + 完整 tick 编排（伪造 transport）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runTick } from '../src/tick.js';
import { renderStreams } from '../src/streams.js';
// leg25 f（X3 删掉掩码）：原 `import { visibilityMask, MASK }` 已删——那两个名字从 src/weight.js 退场。
//   本文件用**命名空间导入**做反活锁断言（`weightMod.visibilityMask === undefined`），
//   这样"有人把它加回来"会当场红，而不是靠"没人 import"这种沉默证据。
import * as weightMod from '../src/weight.js';

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

test('leg25 f（X3 删掉掩码）：注入侧不再做可见性过滤——两侧同向、全局可见，不制造两套真相', () => {
    // 删除理由（`docs/spec-failure-verdict-and-visibility.md` §3）：掩码后期只剩"同地 1.0 / 异地 0.5"，
    //   而阈值 0.25 ⇒ **两个取值都过闸**，这道判断没有任何事实挡得住（死参数 + 假机制）。
    //   现口径：观棋侧（你的权利，ANCHOR §3⑥）与注入侧**都全局可见**。
    const atHome = renderStreams(maskWorld({ at: '黄府' }), stage3, null);
    const away = renderStreams(maskWorld({ at: '北山' }), stage3, null);
    // ①玩家换位置**不再改变**注入内容（旧法这里会翻转判定）
    assert.equal(atHome.injection, away.injection, '★玩家位置不再影响注入内容（掩码已删）');
    // ②同地/异地/以及"事件没给位置"三条一律照常注入
    for (const [nm, r] of [['黄府', atHome], ['北山', away]]) {
        assert.ok(hasLine(r.injection, '近处大事'), `${nm}：近处大事照常注入`);
        assert.ok(hasLine(r.injection, '北山动静'), `${nm}：异地条目照常注入`);
    }
    // ③"事件位置缺失该取同地/异地/中立"这个**未拍板**的登记项随之失去对象（不再需要这个概念）
    const w = maskWorld({});
    delete w.events.find((e) => e.id === 'ev_src').position;
    const r2 = renderStreams(w, stage3, null);
    assert.ok(hasLine(r2.injection, '近处大事'), '事件没给位置：照样注入（不再有"缺失取哪一值"的判定）');
    // ④反活锁：掩码组不许留名
    assert.equal(weightMod.visibilityMask, undefined, '★visibilityMask 已删（不是留着不用）');
    assert.equal(weightMod.MASK, undefined, '★MASK 已删');
});

test('K10：无玩家世界注入照常全见（P-E），观棋侧恒全局', () => {
    const r = renderStreams(maskWorld({ playerId: null }), stage3, null);
    assert.ok(hasLine(r.injection, '近处大事') && hasLine(r.injection, '远处琐事') && hasLine(r.injection, '北山动静'), '全见');
    assert.ok(r.observer.join('\n').includes('远处琐事'), '观棋侧全见（上帝视角不变）');
});

test('K10（leg25 c/f 改写）：零分量玩家照常看得见 + 行迹并入不受影响', () => {
    const r = renderStreams(maskWorld({ w: 0 }), stage3, { verb: '修炼' });
    assert.ok(hasLine(r.injection, '近处大事'), '照常可见（旧法：零分量 → 注入仅余行迹）');
    assert.ok(r.injection.includes('【你的行迹】修炼'), '行迹照旧并入（行迹是玩家自己的动作）');
    assert.ok(r.observer.join('\n').includes('◆ [tick 5]'), '观棋照常');
});

// leg25 c（用户令「删」）──**原「玩家账面没有情报值时按中立情报 0.5 算」整条删除**。
//   为什么删：那条测的是"账面缺 intel → 替它编一个中立 0.5"。而现在①`intel` 这个键已不存在；
//   ②"缺数据就给个默认值"正是 design-core-leg23 §2.2 硬规矩一要治的病——**空着就是空着**，
//   引擎不许替世界编数。所以这条不是"改断言续用"，而是整条退场（换名保留中立值同样是被禁的）。
// leg25 f 续：连"事件位置缺失该按同地/异地/中立取哪一值"这个**未拍板**登记项也一并退场——
//   掩码删除后，注入侧不再有可见性判定，这个问题**没有对象**了（见上「X3 删掉掩码」一则）。