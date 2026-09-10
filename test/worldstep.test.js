// story-world-v2/test/worldstep.test.js
// S4 验收：样例 tick 的世界步过全部校验（真 schema + 语义）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkWorldStep } from '../src/check-step.js';
import { runMainCall } from '../src/worldstep.js';
import { buildEvolutionPack, EVOLUTION_BUDGET_TOKENS } from '../src/pack.js';
import { extractMove } from '../src/extract.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { worldStepSchema } from '../src/schemas/world-step.schema.js';
import { gateWorldStep } from '../src/gate.js';

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/golden-world.min.json', import.meta.url), 'utf8'));
const EXTRACT_FIX = JSON.parse(readFileSync(new URL('./fixtures/extract-samples.json', import.meta.url), 'utf8'));

// 合法世界步（黄金世界语境）
const validStep = () => ({
    actions: [{ entity: 'e_merchant', verb: '沿商路北上巡查', position: '商路' }],
    newEvents: [{ title: '守将允诺通关', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: ['e_merchant'] }],
    agendaAdvances: [{ agendaId: 'a_1', step: '守将首肯，车队放行', stage: '过边关' }],
    stateChanges: [{ entity: 'e_merchant', attr: 'network', delta: 0.05, cause: 'a_1' }],
    newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
});

// ---------- 语义校验 ----------

test('校验：合法世界步通过', () => {
    const r = checkWorldStep(validStep(), GOLDEN);
    assert.equal(r.ok, true, r.errors.join('; '));
});

test('校验：ripple 事件必须引用已存在上游（无源拒绝语义侧）', () => {
    const step = validStep();
    step.newEvents[0].source = { type: 'ripple', ref: 'ev_nope' };
    const r = checkWorldStep(step, GOLDEN);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('ripple 源必须引用已有事件')));
});

test('校验：plot 源 ref 必须是已有盘算', () => {
    const step = validStep();
    step.newEvents[0].source = { type: 'plot', ref: 'a_nope' };
    const r = checkWorldStep(step, GOLDEN);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('plot 源 ref 必须是已有盘算 id')));
});

test('校验：事件位置必须在世界位置集（§3.2 主角中心化防回潮）', () => {
    const step = validStep();
    step.newEvents[0].position = '玩家脚边';   // 为贴近玩家而移动 → 拒绝
    const r = checkWorldStep(step, GOLDEN);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('不在世界位置集')));
});

test('校验：动作位置越界拒绝；未知实体/盘算/波及拒绝', () => {
    const step1 = validStep();
    step1.actions[0].position = '九霄云外';
    assert.equal(checkWorldStep(step1, GOLDEN).ok, false);

    const step2 = validStep();
    step2.actions[0].entity = 'e_ghost';
    const r2 = checkWorldStep(step2, GOLDEN);
    assert.ok(!r2.ok && r2.errors.some((e) => e.includes('未知实体')));

    const step3 = validStep();
    step3.agendaAdvances[0].agendaId = 'a_ghost';
    assert.equal(checkWorldStep(step3, GOLDEN).ok, false);

    const step4 = validStep();
    step4.newEvents[0].ripples = ['e_ghost'];
    assert.equal(checkWorldStep(step4, GOLDEN).ok, false);
});

// ---------- 主调用管线（伪造 transport） ----------

const fakeTransport = (step) => async () => ({ text: JSON.stringify(step) });
const badJsonTransport = async () => ({ text: '我是一段散文，不是 JSON' });
const throwingTransport = async () => { throw new Error('连接重置'); };
const emptyTransport = async () => ({ text: '' });

test('主调用：合法世界步 → ok', async () => {
    const pack = buildEvolutionPack(GOLDEN, null);
    const r = await runMainCall({ transport: fakeTransport(validStep()), ssot: GOLDEN, pack });
    assert.equal(r.ok, true, r.errors?.join('; '));
    assert.equal(r.step.newEvents[0].title, '守将允诺通关');
});

test('主调用：非法 JSON 被拒（真 schema 强制：形状不可靠即拒绝）', async () => {
    const pack = buildEvolutionPack(GOLDEN, null);
    const r = await runMainCall({ transport: badJsonTransport, ssot: GOLDEN, pack });
    assert.equal(r.ok, false);
    assert.ok(r.errors[0].includes('非法 JSON'));
});

test('主调用：schema 违例被拒（事件缺源）', async () => {
    const bad = validStep();
    delete bad.newEvents[0].source;
    const pack = buildEvolutionPack(GOLDEN, null);
    const r = await runMainCall({ transport: fakeTransport(bad), ssot: GOLDEN, pack });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('source')));
});

test('主调用：传输失败/空返回被拒', async () => {
    const pack = buildEvolutionPack(GOLDEN, null);
    assert.equal((await runMainCall({ transport: throwingTransport, ssot: GOLDEN, pack })).ok, false);
    assert.equal((await runMainCall({ transport: emptyTransport, ssot: GOLDEN, pack })).ok, false);
});

// ---------- 演化上下文 ----------

test('演化上下文：已结算盘算不再入包（防满步重播）', () => {
    const world = JSON.parse(JSON.stringify(GOLDEN));
    world.agendas[0].closed = true;
    const pack = buildEvolutionPack(world, null);
    assert.equal(pack.pack.agendas.length, 0, 'closed 盘算被排除');
});

// ---------- 样例 tick 集成（S4 验收） ----------

test('样例 tick：黄金世界 + l91 落子事实 → 演化上下文预算内 → 世界步过全部校验', async () => {
    const s = EXTRACT_FIX.samples.find((x) => x.id === 'l91');
    const move = extractMove(s.dialogue, EXTRACT_FIX.context);
    assert.equal(move.verb, '收服');

    const pack = buildEvolutionPack(GOLDEN, move);
    assert.ok(pack.estTokens <= EVOLUTION_BUDGET_TOKENS, `演化上下文 ${pack.estTokens} tokens 超预算 ${EVOLUTION_BUDGET_TOKENS}`);
    assert.equal(pack.pack.playerMove.verb, '收服', '落子事实进原料');

    const r = await runMainCall({ transport: fakeTransport(validStep()), ssot: GOLDEN, pack });
    assert.equal(r.ok, true, r.errors?.join('; '));
    assert.equal(r.step.agendaAdvances[0].agendaId, 'a_1');
});

// ---------- 玩家档案 K8：模型禁写玩家（红线 1 代码化） ----------

// 黄金世界 + 玩家实体（P-F 提案值，K11 校准后正式报批）
const playerWorld = () => {
    const w = JSON.parse(JSON.stringify(GOLDEN));
    w.context.playerId = 'e_player';
    w.entities.push({
        id: 'e_player',
        kind: 'character',
        name: '黄坤',
        location: w.context.positions[0],
        attrs: { hardPower: 0.25, office: 0.05, network: 0.3, intel: 0.4 },
    });
    return w;
};

test('K8：schema 接受 context.playerId（可选字符串），非字符串拒绝', () => {
    const w1 = playerWorld();
    const r1 = validate(w1, ssotSchema);
    assert.equal(r1.ok, true, r1.errors.join('; '));

    const w2 = playerWorld();
    w2.context.playerId = 123;
    const r2 = validate(w2, ssotSchema);
    assert.equal(r2.ok, false);
    assert.ok(r2.errors.some((e) => e.includes('playerId') && e.includes('期望字符串')));
});

test('K8：actions 写玩家被拒，世界如实不动（红线 1 代码化）', () => {
    const step = validStep();
    step.actions = [{ entity: 'e_player', verb: '出手', position: '边关' }];
    const r = checkWorldStep(step, playerWorld());
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('禁写玩家')));
});

test('K8：stateChanges 写玩家被拒（模拟器永不写主角行动代码化）', () => {
    const step = validStep();
    step.stateChanges = [{ entity: 'e_player', attr: 'hardPower', delta: 0.5, cause: 'a_1' }];
    const r = checkWorldStep(step, playerWorld());
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('禁写玩家')));
});

test('K8：玩家入池不影响他人动作/状态校验（无过检）', () => {
    const r = checkWorldStep(validStep(), playerWorld());
    assert.equal(r.ok, true, r.errors.join('; '));
});

test('K8：无 playerId 世界无禁写特判（旁观语义，未知实体照常拒绝）', () => {
    const step = validStep();
    step.actions[0].entity = 'e_player';   // 旁观世界：该 id 不存在
    const r = checkWorldStep(step, GOLDEN);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('未知实体')));
    assert.ok(!r.errors.some((e) => e.includes('禁写玩家')));
});

// ---------- 盘算树 K13：newAgendas 契约（细案 A-1，拍板 T1） ----------

const agendaStep = (extra = {}) => {
    const s = validStep();
    s.newAgendas = [{
        entity: 'e_merchant', goal: '开临渊分号', stage: '选址', visibility: 'known', maxSteps: 4,
        source: { type: 'state' }, ...extra,
    }];
    return s;
};

test('K13：合法新盘算提议通过（state 源、顶层盘算）', () => {
    const r = checkWorldStep(agendaStep(), GOLDEN);
    assert.equal(r.ok, true, r.errors.join('; '));
});

test('K13：无源 newAgendas 拒绝（无源之物不存在）', () => {
    const s = agendaStep();
    delete s.newAgendas[0].source;
    const r = checkWorldStep(s, GOLDEN);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('newAgendas[0].source')));
});

test('K13：event 源必须引已存在未决事件（不存在 / 已闭环均拒）', () => {
    const s1 = agendaStep({ source: { type: 'event', ref: 'ev_nope' } });
    assert.equal(checkWorldStep(s1, GOLDEN).ok, false, 'ref 不存在');

    const w = structuredClone(GOLDEN);
    w.events = [{ id: 'ev_done', title: '旧事', source: { type: 'state' }, position: '边关', ripples: [], links: {}, closed: true }];
    const s2 = agendaStep({ source: { type: 'event', ref: 'ev_done' } });
    assert.equal(checkWorldStep(s2, w).ok, false, '已闭环事件不可作源');
});

test('K13：parent 源必须引未结算（在飞）盘算', () => {
    const s1 = agendaStep({ source: { type: 'parent', ref: 'a_nope' } });
    assert.equal(checkWorldStep(s1, GOLDEN).ok, false, '盘算不存在');

    const w = structuredClone(GOLDEN);
    w.agendas[0].closed = true;
    const s2 = agendaStep({ source: { type: 'parent', ref: 'a_1' } });
    assert.equal(checkWorldStep(s2, w).ok, false, '已结算盘算不可作父');
});

test('K13：state 源带 ref 拒绝；entity 未知拒绝；maxSteps 越界拒绝', () => {
    const s1 = agendaStep({ source: { type: 'state', ref: 'x' } });
    assert.ok(!checkWorldStep(s1, GOLDEN).ok, 'state 源不带 ref');
    const s2 = agendaStep({ entity: 'e_ghost' });
    assert.ok(!checkWorldStep(s2, GOLDEN).ok, '未知实体');
    const s3 = agendaStep({ maxSteps: 9 });
    assert.ok(!checkWorldStep(s3, GOLDEN).ok, 'maxSteps 越上界');
    const s4 = agendaStep({ maxSteps: 0 });
    assert.ok(!checkWorldStep(s4, GOLDEN).ok, 'maxSteps 越下界');
});

// ---------- 因果链强化 K18：agendaCancels 契约（细案 A-5 前半，拍板 T5） ----------

test('K18：合法取消提议通过（在飞盘算 + 理由可选）；静默方取消被 gate 滤除（双面无痕审计）', () => {
    const s = validStep();
    s.agendaCancels = [{ agendaId: 'a_1', reason: '形势已变，北进无胜算' }];
    const r = checkWorldStep(s, GOLDEN);
    assert.equal(r.ok, true, r.errors.join('; '));

    // 静默方（**结构静默**：手上没有在办的盘算 + 从没出手 + 无人点名）的取消提议 → gate 滤除 + 审计
    // leg24 片3：判据换了，构造也跟着换——旧夹具的 e_silent 手上有在飞盘算（旧法因低分量静默；
    //   新法"有在办的事"=活跃）。且**它必须先有过一条盘算才谈得上取消**：用一条已终结的盘算承载取消提议。
    const w = structuredClone(GOLDEN);
    w.entities.push({ id: 'e_silent', kind: 'character', name: '无名客', location: '临渊城', attrs: { hardPower: 0.1, office: 0.1, network: 0.1, intel: 0.1 } });
    w.agendas.push({ id: 'a_dead', owner: 'e_silent', goal: '旧暗务', stage: '了结', visibility: 'concealed', maxSteps: 4, progress: 4, closed: true, memory: { promises: [], done: [], blocked: [], turnsAlive: 3 } });
    w.weights = { e_merchant: 0.9, e_silent: 0.1 };
    const silentStep = validStep();
    silentStep.agendaCancels = [{ agendaId: 'a_dead' }];
    const g = gateWorldStep(silentStep, w);
    assert.deepEqual(g.dropped.agendaCancels, ['e_silent'], '结构静默方的取消提议被滤（与出生对称，双面无痕）');
    assert.deepEqual(g.droppedCounts, { e_silent: 1 }, '审计计数');
    assert.equal(g.step.agendaCancels.length, 0, '透传步不含被滤提议');
});

test('K18：未知 agendaId 拒绝（无源之物不存在的取消面）', () => {
    const s = validStep();
    s.agendaCancels = [{ agendaId: 'a_ghost' }];
    const r = checkWorldStep(s, GOLDEN);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('agendaCancels[0].agendaId') && e.includes('未知盘算')));
});

test('K18：已结算盘算不可取消（closed 拦截——"已结算盘算不可取消"）', () => {
    const w = structuredClone(GOLDEN);
    w.agendas[0].closed = true;
    const s = validStep();
    s.agendaCancels = [{ agendaId: 'a_1' }];
    const r = checkWorldStep(s, w);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('已结算盘算不可取消')));
});

test('K18：schema 形状——缺 agendaId / 空字符串 / 多余字段均拒绝', () => {
    const s1 = validStep();
    s1.agendaCancels = [{ reason: '无主' }];
    assert.ok(!validate(s1, worldStepSchema).ok, '缺 agendaId 拒');
    const s2 = validStep();
    s2.agendaCancels = [{ agendaId: '' }];
    assert.ok(!validate(s2, worldStepSchema).ok, '空字符串拒');
    const s3 = validStep();
    s3.agendaCancels = [{ agendaId: 'a_1', owner: 'e_merchant' }];
    assert.ok(!validate(s3, worldStepSchema).ok, '多余字段拒（形状严格，additional:false）');
});

// ---------- 盘算树 K17：capture 快照契约入档（A-8 前半——record.step 全量含 newAgendas，随 schema 零改） ----------

test('K17：解析出的世界步必含 newAgendas（capture-demo 快照形状锁定；真跑留用户）', async () => {
    const s = agendaStep({ goal: '再拓商路', maxSteps: 3 });
    const r = await runMainCall({ transport: async () => ({ text: JSON.stringify(s) }), ssot: GOLDEN, pack: buildEvolutionPack(GOLDEN, null) });
    assert.equal(r.ok, true, r.error);
    assert.ok(Array.isArray(r.step.newAgendas) && r.step.newAgendas.length === 1, '解析出的世界步含 newAgendas 键（快照逐字节记录全量契约）');
    assert.ok(Array.isArray(r.step.agendaCancels), '解析出的世界步含 agendaCancels 键（K18 契约随 schema 入档）');
    assert.equal(r.step.newAgendas[0].goal, '再拓商路');
    assert.equal(r.step.newAgendas[0].maxSteps, 3);
});