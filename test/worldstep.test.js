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
import { RIPPLE_TARGET_CAP } from '../src/weight.js';

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/golden-world.min.json', import.meta.url), 'utf8'));
const EXTRACT_FIX = JSON.parse(readFileSync(new URL('./fixtures/extract-samples.json', import.meta.url), 'utf8'));

// 合法世界步（黄金世界语境）
// leg25 c（单维删除）：原先这里还有一条 `stateChanges: [{entity, attr:'network', delta, cause}]`。
//   四维浮点（兵力/权位/人脉/耳目）随用户令整条删除之后，契约层 `stateChanges` 也整条删了——
//   它在夹具里的唯一作用就是喂那几个数。删掉它，本文件的断言意图（形状/因果/位置/波及/门控）一个不少。
const validStep = () => ({
    actions: [{ entity: 'e_merchant', verb: '沿商路北上巡查', position: '商路' }],
    newEvents: [{ title: '守将允诺通关', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: ['e_merchant'] }],
    agendaAdvances: [{ agendaId: 'a_1', step: '守将首肯，车队放行', stage: '过边关' }],
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

// ★leg33c（用户拍板「位置变成自由文本，位置集干脆删了」）：这一格反转了。
//   旧判据（切片 §3.2 起）＝事件/动作位置 ∉ 世界位置集 ⇒ **拒整步**；现在**不拒**，只留痕。
//   依据（实测，见 LEDGER.md leg33 行）：① 8 本真实世界书里只有 3 本有干净地名表（其余退化成 ['未明']，
//   闸近乎失效）；② 真账 canon 134 个地点条目被 derivePositions 截到 59 ⇒ 模型写书里真有的地名反被拒。
//   ★但原动机**不许丢**：这条用例要同时锁住"集外不再拒 + 留痕要出得来"。
test('校验：事件位置**集外不再拒整步**，但必须留痕（leg33c 口径：位置是自由文本，位置集只是参照表）', () => {
    const step = validStep();
    step.newEvents[0].position = '太清境';   // 书里真有的地名（旧 derivePositions 会把它截掉）
    const r = checkWorldStep(step, GOLDEN);
    assert.equal(r.ok, true, `位置是自由文本，集外不许拒整步：${r.errors.join('; ')}`);
    assert.ok((r.warnings || []).some((w) => w.startsWith('位置集外:')), `集外要留痕（观测面）：${JSON.stringify(r.warnings)}`);
    assert.equal(r.errors.length, 0, '留痕**不许**进 errors（否则又变成拒整步）');
});

test('校验：动作位置同样只留痕不拒；且**未知实体/盘算/波及照旧拒**（别把别的闸一起放松）', () => {
    const step1 = validStep();
    step1.actions[0].position = '九霄云外';
    const r1 = checkWorldStep(step1, GOLDEN);
    assert.equal(r1.ok, true, `动作位置也是自由文本：${r1.errors.join('; ')}`);
    assert.ok((r1.warnings || []).some((w) => w.startsWith('位置集外:')), '动作集外同样要留痕');

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

test('校验（leg25）：一次事件波及目标数上限——≤RIPPLE_TARGET_CAP 过，超限**拒整步**（上限唯一真源在 weight.js）', () => {
    // 上限值不写字面量：直接读真源常量，改上限则本用例随之成立
    // 黄金夹具只有 1 个实体 → 就地补足（克隆具名，避免重定义夹具文件）
    const world = JSON.parse(JSON.stringify(GOLDEN));
    const base = world.entities[0];
    for (let i = world.entities.length; i <= RIPPLE_TARGET_CAP; i++) {
        world.entities.push({ ...base, id: `e_extra_${i}`, name: `${base.name}${i}` });
    }
    const ids = world.entities.map((e) => e.id);
    assert.ok(ids.length > RIPPLE_TARGET_CAP, '夹具实体数足够构造超限用例');

    const atCap = validStep();
    atCap.newEvents[0].ripples = ids.slice(0, RIPPLE_TARGET_CAP);
    const rPass = checkWorldStep(atCap, world);
    assert.equal(rPass.ok, true, rPass.errors.join('; '));   // 恰好等于上限 → 过（边界含等号）

    const over = validStep();
    over.newEvents[0].ripples = ids.slice(0, RIPPLE_TARGET_CAP + 1);   // 4 个 → 拒
    const rOver = checkWorldStep(over, world);
    assert.equal(rOver.ok, false, '超限必须拒整步（世界如实不动）');
    assert.ok(
        rOver.errors.some((e) => e.includes('波及目标数上限') && e.includes(String(RIPPLE_TARGET_CAP))),
        `拒绝文案应带上限值：${rOver.errors.join('; ')}`,
    );
    assert.ok(rOver.errors.some((e) => e.includes('$.newEvents[0].ripples')), '错误路径指向 ripples');
});

// ★leg29（用户令「事件波及也改成 15 个」）：改后**上限不是最先咬人的那道闸**——本用例把这条咬合钉死。
//   实测（真 checkWorldStep + 真常量）：`checkAgendaInvolvement` 的集合 = 盘算属主 + **本步全部**
//   actions 的 entity/target + 波及名单，而波及名单是它的子集 ⇒ 有效天花板 = 15 −（属主与行动方去重后的个数）。
//   为什么必须锁：只把常量改成 15 就交差，模型照"至多 15 个"写出 15 条会被涉及的闸拒掉、白烧一整轮——
//   这正是告知面（prompts 铁律 8 写"实际最多 14 人"）要防的事。改涉及口径若打破本用例，必须同时改提示词。
test('校验（leg29）：波及上限 15 与「单盘算一轮涉及 ≤15」的咬合——属主自行动时单事件最多波及 14（15 即被拒）', () => {
    const world = JSON.parse(JSON.stringify(GOLDEN));
    const base = world.entities[0];
    for (let i = world.entities.length; i <= 20; i++) {
        world.entities.push({ ...base, id: `e_extra_${i}`, name: `${base.name}${i}` });
    }
    const owner = world.agendas.find((a) => !a.closed).owner;              // 真夹具里的在飞盘算属主
    const others = world.entities.map((e) => e.id).filter((id) => id !== owner);

    // 波及名单与行动方**不重叠**（被波及的是别人）——上一版夹具拿行动方当波及目标，
    // 集合去重把两者并成一个 ⇒ 读数恒等于 N、**根本量不到咬合**（假绿）。
    const mk = (n) => {
        const s = validStep();
        s.actions = [{ entity: owner, verb: '推进', position: '商路' }];
        s.newEvents[0].ripples = others.slice(0, n);
        return s;
    };

    const at14 = checkWorldStep(mk(14), world);   // 属主 1 + 波及 14 = 涉及 15
    assert.equal(at14.ok, true, `波及 14（涉及 15）应过：${at14.errors.join('; ')}`);

    const at15 = checkWorldStep(mk(15), world);   // 属主 1 + 波及 15 = 涉及 16 > 15
    assert.equal(at15.ok, false, '波及 15 会被「涉及 >15」拒整步（不是被波及闸拒——波及 15 恰好等于上限）');
    assert.ok(at15.errors.some((e) => e.includes('一轮内涉及实体上限') && e.includes('16')),
        `拒绝文案应来自涉及闸且报出实际条数 16：${at15.errors.join('; ')}`);
    assert.ok(!at15.errors.some((e) => e.includes('波及目标数上限')),
        `★ 15 条不得再触发波及闸——若此条红，说明上限又被改回去了：${at15.errors.join('; ')}`);

    // 真·超限（16 > RIPPLE_TARGET_CAP）仍必须被波及闸抓住——上限有强制点这件事不许因改值而丢
    const at16 = checkWorldStep(mk(16), world);
    assert.ok(at16.errors.some((e) => e.includes('波及目标数上限') && e.includes(String(RIPPLE_TARGET_CAP))),
        `16 条应触发波及闸并带上限值：${at16.errors.join('; ')}`);
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
// leg25 c：玩家实体不再带 `attrs`（四维浮点已删，schema 不再接受该键）。
//   玩家实体本身照旧要建——K8 那几条"模型禁写玩家"的红线与被删的属性无关。
const playerWorld = () => {
    const w = JSON.parse(JSON.stringify(GOLDEN));
    w.context.playerId = 'e_player';
    w.entities.push({
        id: 'e_player',
        kind: 'character',
        name: '黄坤',
        location: w.context.positions[0],
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

// leg25 c（单维删除）──**原「K8：stateChanges 写玩家被拒」整条删除**。
//   为什么删：那条测试构造的是 `stateChanges: [{entity:'e_player', attr:'hardPower', delta}]`，
//   指望 engine 以「模型禁写玩家」拒它。现在 `stateChanges` 在**契约层**就没了 ⇒ 整步首先被
//   `$.stateChanges: 未知字段` 拒掉，那条断言永远走不到（只是"死引用"，不是活的防线）。
//   而"模型禁写玩家"这条红线在别处仍有活锁：actions 写玩家（上一条）、newAgendas.entity 写玩家、
//   entityFates 灭玩家、newEntities 提议者写玩家——四条通道都有独立断言。
//   "`stateChanges` 这个键必须被拒"这件事改由 schema.test.js 的专项用例锁定，见：
//   「世界步 schema（leg25 c）：`stateChanges` 属未知字段被拒」。
//   按硬规矩：该删就删，不用改名/换字段续命（换名保留假精度正是本次要治的病）。

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
    // leg25 c：这个实体原先带 `attrs: {hardPower:0.1,…}`（四维浮点，已删；schema 不再接受该键）——
    //   删掉不改变本用例语义：静默判据看的是"有没有在办的事/出没出手/被没被点名"，从来看属性。
    const w = structuredClone(GOLDEN);
    w.entities.push({ id: 'e_silent', kind: 'character', name: '无名客', location: '临渊城' });
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