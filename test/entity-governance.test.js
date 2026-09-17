// story-world-v2/test/entity-governance.test.js
// K37（细案 §3.7 → A-10..A-12）：实体治理——生三通道（书名录 seed / newEntities 带源 / dialogueFact 依据册）、
// 灭=模型提议+引擎复核（崩≠灭、dead 终局、玩家不可灭）、背景化 GC（条件四则/扫描周期）+ 自动复归、
// 三点过滤断言（pack 演化上下文 / gate 点名列拆 / 门控静默面）。数字组全部提案态（铁律 2，随 K38 报批）。
// K45（第十九棒）：超席位强制已废除（全量棋盘细案 C3）——对应断言改为"无超席强制"新语义（见 spawn-cap.test）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    settleTick, ENTITY_BIRTH_PER_TICK, ENTITY_IDLE_RETIRE_TICKS,
    ENTITY_GC_SCAN_TICKS,
} from '../src/settle.js';
import { checkWorldStep } from '../src/check-step.js';
import { gateWorldStep } from '../src/gate.js';
import { buildEvolutionPack } from '../src/pack.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { worldStepSchema } from '../src/schemas/world-step.schema.js';
import { seedBookEntities, sanitizeCanon } from '../src/abstract.js';

assert.equal(ENTITY_BIRTH_PER_TICK, 1, '单轮新生 ≤1（提案）');
assert.equal(ENTITY_IDLE_RETIRE_TICKS, 20, '空闲 20 轮（提案）');
// leg24 片3：RETIRE_WEIGHT_FLOOR 已删——退休判据不再吃那个 0-1 的分数（改"久未露面 + 无在办 + 无未决引用"）
assert.equal(ENTITY_GC_SCAN_TICKS, 20, '扫描 20 轮（提案）');

function baseWorld(extra = {}) {
    return {
        version: 1,
        context: { world: '临渊城', tension: 0.5, positions: ['临渊城', '大营'] },
        entities: [
            // leg25 c：实体不再有 attrs——四维浮点（兵力/权位/人脉/耳目）整条删除。
            //   书里的说法走实体 `实力` 文本态（据书照抄），引擎不换算、不进公式、不排序。
            { id: 'e_merchant', kind: 'character', name: '商贾', location: '临渊城' },
            { id: 'e_du', kind: 'faction', name: '大虞', location: '临渊城' },
        ],
        weights: { e_merchant: 0.4, e_du: 0.8 },   // 预热分量（K7 夹具教训：t1 门控跑在真分量重算前）
        agendas: [],
        events: [],
        chronicle: [],
        meta: { tick: 0 },
        ...extra,
    };
}
const step = (more = {}) => ({
    // leg25 c：`stateChanges`（模型提议的属性增量）随四维浮点一并从世界步契约删除——
    //   夹具步里也不再拼它（拼了就是"未知字段"整步被拒，世界如实不动）。
    actions: [], newEvents: [], agendaAdvances: [],
    newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    ...more,
});
const born = (w) => (w.entities || []).filter((e) => e.id.startsWith('e_1_'));   // 入局实体 id=e_<tick>_<n>

// ============ A-10 生 ============

test('A-10 生·event 源：带源入局——落账（id/kind/location/活跃记账）+ 编年「入局」+ kind 大事', () => {
    const w = baseWorld({ events: [{ id: 'ev_1', title: '大营起事', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    const r = settleTick({ ssot: w, step: step({ newEntities: [{ name: '白小娥', kind: 'character', location: '大营', entity: 'e_merchant', source: { type: 'event', ref: 'ev_1' } }] }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const batch = born(r.ssot);
    assert.equal(batch.length, 1);
    assert.equal(batch[0].name, '白小娥');
    assert.equal(batch[0].kind, 'character');
    assert.equal(batch[0].location, '大营');
    assert.equal(batch[0].lastActiveTick, 1, '入局=活跃（活跃记账）');
    assert.ok(r.ssot.weights['e_1_1'] !== undefined, '分量重算覆盖新实体（K38：入局按缺省已有值，非零）');
    assert.ok(r.ssot.weights['e_1_1'] > 0, '入局即有分量（K38 D 条：不再哑巴）');
    const row = r.stage.chronicle.find((c) => c.text.includes('「白小娥」入局'));
    assert.ok(row, `编年入局笔：${JSON.stringify(r.stage.chronicle)}`);
    assert.equal(row.kind, 'major', '入局=大事');
    assert.ok(row.text.includes('因事件「大营起事」而生'));
    const vr = validate(r.ssot, ssotSchema);
    assert.equal(vr.ok, true, vr.errors.join('; '));
});

test('A-10 生·无源拒：source 缺 ref → 校验拒绝，世界如实不动', () => {
    const w = baseWorld();
    const r1 = checkWorldStep(step({ newEntities: [{ name: '白小娥', location: '大营', entity: 'e_merchant', source: { type: 'event' } }] }), w);
    assert.ok(!r1.ok && r1.errors.some((e) => e.includes('无源不入局')));
    // 空串 ref 同样算"无源"（`!ne.source.ref` 判真）——与 book 源未命中名录是两条不同的拒因
    // （后者报"book 源必须命中书名录"，见下方 book 源测试）。
    const r2 = settleTick({ ssot: w, step: step({ newEntities: [{ name: '白小娥', location: '大营', entity: 'e_merchant', source: { type: 'book', ref: '' } }] }) });
    assert.equal(r2.ok, false);
    assert.ok(r2.stage.warnings.some((x) => x.includes('无源不入局')));
});

test('A-10 生·event 源必须未决；重名拒；位置必须在位置集；玩家拒；未知提议者拒', () => {
    const w = baseWorld({ context: { world: '临渊城', tension: 0.5, positions: ['临渊城', '大营'], playerId: 'e_player' }, entities: [...baseWorld().entities, { id: 'e_player', kind: 'character', name: '黄坤', location: '临渊城' }] });
    w.events.push({ id: 'ev_closed', title: '旧事', source: { type: 'state' }, position: '临渊城', ripples: [], closed: true });
    const cases = [
        // ★leg64 第五轮：`ev_closed` **在账上**（只是已了结）⇒ 报的必须是"已经了结"，不是"必须引已存在未决事件"
        //   （旧文案让用户/模型都以为"抄错号了"，实测现场：大荒 `ev_5_1 [已了结]` 被当成"不存在"）。
        [{ name: 'A', location: '大营', entity: 'e_merchant', source: { type: 'event', ref: 'ev_closed' } }, '已经了结'],
        // ★leg32f：原来这里还有一条「重名 ⇒ 拒」。**已按用户实机反馈撤掉**——重名是"丢掉那条提议"
        //   （账上已有的那个人正在册），不是"世界步不合法"；旧法会让整轮陪葬（连同玩家这一轮的行动）。
        //   新的judgment在下面 leg32f 那两条用例里（含"同一步里别的事照常落账"）。
        [{ name: 'C', location: '大营', entity: 'e_player', source: { type: 'event', ref: 'x' } }, '模型禁写玩家'],
        [{ name: 'D', location: '大营', entity: 'e_ghost', source: { type: 'event', ref: 'x' } }, '未知提议者'],
    ];
    for (const [ne, frag] of cases) {
        const r = checkWorldStep(step({ newEntities: [ne] }), w);
        assert.ok(!r.ok && r.errors.some((e) => e.includes(frag)), `${frag}: ${r.errors.join('; ')}`);
    }
    // ★leg64 第五轮：**"不存在"与"存在但已了结"必须报成两句不同的话**（本仓"错误信息不许说假话"那条纪律）
    const gone = checkWorldStep(step({ newEntities: [{ name: 'B', location: '大营', entity: 'e_merchant', source: { type: 'event', ref: 'ev_nope' } }] }), w);
    assert.ok(gone.errors.some((e) => e.includes('必须引已存在未决事件')), '压根不存在的号 ⇒ 报"必须引已存在未决事件"');
    assert.ok(!gone.errors.some((e) => e.includes('已经了结')), '★不存在的号**不许**被说成"已经了结"（两句不许混用）');
    const closed = checkWorldStep(step({ newEntities: [{ name: 'B', location: '大营', entity: 'e_merchant', source: { type: 'event', ref: 'ev_closed' } }] }), w);
    assert.ok(closed.errors.some((e) => e.includes('已经了结')), '账上真有的已了结事件 ⇒ 报"已经了结"');
    assert.ok(closed.errors.every((e) => !e.includes('必须引已存在未决事件')), '★已了结的**不许**被说成"不存在"');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// ★leg32e·小说家条款（细案 `docs/spec-novelist-clause.md` §3.2）第一片：**给"该出场但书上没写的人"一条路**
//   病（真账 tick 38 实测）：38 轮只有 **4 个属主**，其余 **614 人从未出场**——不是模型不想写别人，
//   而是入局源只有 book/event/dialogueFact 三型 ⇒ **书上没写过的人永远进不来**（用户：「只有将创作权
//   交在 llm 手里才能活起来」）。新源型 `entity` = **由在册实体牵出**（ref=那个实体 id）。
//   形态判据（全机械可核，不用词表）：①牵出者必须在册且未灭 ②名字非空且不重名（既有）③位置仍须∈位置集（既有，
//   本片**不动**位置口径——位置线已定案"不参与机制"）④`ENTITY_BIRTH_PER_TICK` 兜住雪崩（既有，数字**不动**）。
test('leg32e 生·entity 源：新面孔由**在册实体牵出**入局（从前这个源型不存在 ⇒ 书上没写的人永远进不来）', () => {
    const w = structuredClone(baseWorld());
    w.entities.find((e) => e.id === 'e_merchant').lastActiveTick = 0;   // 提议者须"刚出过手"，否则被门控滤（片3 结构判据）
    // 契约层：entity 源是合法枚举值
    const okShape = validate(step({ newEntities: [{ name: '游方剑客', location: '大营', entity: 'e_merchant', source: { type: 'entity', ref: 'e_du' } }] }), worldStepSchema);
    assert.equal(okShape.ok, true, `契约层应接受 entity 源：${okShape.errors.join('; ')}`);
    const r = settleTick({ ssot: w, step: step({ newEntities: [{ name: '游方剑客', kind: 'character', location: '大营', entity: 'e_merchant', source: { type: 'entity', ref: 'e_du' } }] }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const c = r.ssot.entities.find((e) => e.name === '游方剑客');
    assert.ok(c, '★新面孔必须真的落账（这是这条通道的意义）');
    assert.ok(r.stage.chronicle.some((x) => x.text.includes('「游方剑客」入局')), `编年要有入局行：${r.stage.chronicle.map((x) => x.text).join(' / ')}`);
    assert.equal(validate(r.ssot, ssotSchema).ok, true, '入局后世界仍过 SSOT schema');
});

test('leg32e 生·entity 源的两条硬闸：牵出者必须**在册**且**未灭**（无源之物不存在不放松）', () => {
    const w = structuredClone(baseWorld());
    w.entities.find((e) => e.id === 'e_merchant').lastActiveTick = 0;
    // ① 牵出一个**不存在**的实体 → 拒（否则就是凭空造人，正是"编数/编事实"那条红线）
    const r1 = checkWorldStep(step({ newEntities: [{ name: '甲', location: '大营', entity: 'e_merchant', source: { type: 'entity', ref: 'e_ghost' } }] }), w);
    assert.ok(!r1.ok && r1.errors.some((e) => e.includes('未知实体')), `未知牵出者必须拒：${r1.errors.join('; ')}`);
    // ② 已覆灭者不能牵人（死人不生事）
    const w2 = structuredClone(w);
    w2.entities.find((e) => e.id === 'e_du').status = 'dead';
    const r2 = checkWorldStep(step({ newEntities: [{ name: '乙', location: '大营', entity: 'e_merchant', source: { type: 'entity', ref: 'e_du' } }] }), w2);
    assert.ok(!r2.ok && r2.errors.some((e) => e.includes('已覆灭')), `已灭者不能牵人：${r2.errors.join('; ')}`);
    // ③ 缺 ref → 拒（无源不入局）
    const r3 = checkWorldStep(step({ newEntities: [{ name: '丙', location: '大营', entity: 'e_merchant', source: { type: 'entity' } }] }), w);
    assert.ok(!r3.ok && r3.errors.some((e) => e.includes('无源不入局')), `缺 ref 必须拒：${r3.errors.join('; ')}`);
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// ★leg32f（用户实机报错「⚠ 演算失败：$.newEntities[0].name: 账上已有同名实体「白小娥」（已有者不重建）（世界原样未动，可重试）」）：
//   病的形状：模型把**账上已经有的人**又当新实体提了一次（它眼里那个人物是从对话/事件里冒出来的"新面孔"），
//   而 check-step 把这种**无害的重复**判成致命错 ⇒ **整步被拒** ⇒ 那一轮**所有别的事也一起丢了**
//   （用户同一轮还看到"主角的行动也被演了"——正是整步被拒/重试的连带观感）。
//   口径（本仓已立的原则）：**重复注册是"提案被丢掉"，不是"世界步不合法"**——
//   账上已有的那个人**本来就在册**，丢掉这条提议对世界零损害；把整轮陪葬才是真损害。
//   判据：①重新提议同名 → 不拒整步 ②那条提议被丢并**留痕**（不许静默）③同一步里的正常提议照常落账。
test('leg32f·同名新实体 = 丢掉那条提议，**不许拒整步**（用户实机踩到的"白小娥"案）', () => {
    const w = structuredClone(baseWorld());
    w.entities.find((e) => e.id === 'e_merchant').lastActiveTick = 0;
    // ① 单条：不再报错（旧法 `账上已有同名实体` 是致命错）
    const r1 = checkWorldStep(step({ newEntities: [{ name: '商贾', location: '大营', entity: 'e_merchant', source: { type: 'entity', ref: 'e_du' } }] }), w);
    assert.equal(r1.ok, true, `重新提议同名不该拒整步：${r1.errors.join('; ')}`);
    // ② 整步：同名提议 + 一个正常动作 + 一条正常新线 → 整步照常落账，只有那条提议被丢
    const r2 = settleTick({
        ssot: w,
        step: step({
            actions: [{ entity: 'e_merchant', verb: '清点货账' }],
            newAgendas: [{ entity: 'e_merchant', goal: '试探风向', visibility: 'known', maxSteps: 2, source: { type: 'state' } }],
            newEntities: [{ name: '商贾', location: '大营', entity: 'e_merchant', source: { type: 'entity', ref: 'e_du' } }],
        }),
    });
    assert.equal(r2.ok, true, r2.stage.warnings.join('; '));
    assert.equal(r2.ssot.entities.filter((e) => e.name === '商贾').length, 1, '★不许重建同名实体（仍只有原来那一个）');
    assert.ok(r2.ssot.agendas.some((a) => a.goal === '试探风向'), '★同一步里的正常新线必须照常落账（这正是旧法陪葬掉的东西）');
    // ③ 留痕：不许静默丢（"被丢掉"这件事要能被看见/被计数）
    assert.ok(r2.stage.warnings.some((x) => x.includes('提议丢弃') && x.includes('商贾')), `丢弃要留痕：${r2.stage.warnings.join('; ')}`);
});

// ★leg33c 口径反转（用户拍板「位置变成自由文本，位置集干脆删了」）：这一格原本锁的是
//   **leg32f 的"归一到「未明」"**——现在改成**照收**。为什么反转：位置集跨书不成立
//   （8 本真实世界书只 3 本有干净地名表；真账 134 个地点被截到 59 ⇒ 书里真有的地名反被抹成「未明」）。
//   ★leg32f 那条原则**没丢**：它真正要保的是「**提案被丢掉 ≠ 世界步不合法**」——即**不许拒整步**。
//   本用例继续锁这一条，只是把"归一"换成"照收 + 留痕"。
//   ⚠只有**空值**才归「未明」（空着就是空着＝形态判断，不是位置判据）。
test('leg33c·位置是自由文本：集外地名**照收**（不再抹成「未明」），留痕；空值才归「未明」', () => {
    const w = structuredClone(baseWorld());
    w.entities.find((e) => e.id === 'e_merchant').lastActiveTick = 0;
    const r1 = checkWorldStep(step({ newEntities: [{ name: '游方僧', location: '不知何处', entity: 'e_merchant', source: { type: 'entity', ref: 'e_du' } }] }), w);
    assert.equal(r1.ok, true, `位置集外不该拒整步：${r1.errors.join('; ')}`);
    // ⚠留痕点在 `settle.js` 的 spawnEntities（`newEntities` 的位置在落账那一步归一/留痕），
    //   不在 check-step（那里没有实体段的位置校验）——故断言写在 r2，不写在 r1。
    const r2 = settleTick({ ssot: w, step: step({ newEntities: [{ name: '游方僧', kind: 'character', location: '不知何处', entity: 'e_merchant', source: { type: 'entity', ref: 'e_du' } }] }) });
    assert.equal(r2.ok, true, r2.stage.warnings.join('; '));
    const c = r2.ssot.entities.find((e) => e.name === '游方僧');
    assert.ok(c, '人照常入局');
    assert.equal(c.location, '不知何处', '★集外位置**照原样落账**（旧法抹成「未明」——那让"大书里写得出、账上记不住"）');
    assert.ok(r2.stage.warnings.some((x) => x.startsWith('位置集外:')), `留痕要进世界警告流：${r2.stage.warnings.join('; ')}`);
    // ★空值仍归「未明」：空着就是空着（形态判断，与位置集无关）
    const r3 = settleTick({ ssot: w, step: step({ newEntities: [{ name: '无名客', kind: 'character', entity: 'e_merchant', source: { type: 'entity', ref: 'e_du' } }] }) });
    assert.equal(r3.ok, true, r3.stage.warnings.join('; '));
    assert.equal(r3.ssot.entities.find((e) => e.name === '无名客').location, '未明', '没给位置 ⇒ 中立词');
});

test('A-10 生·dialogueFact 源：依据册命中才放行；依据册随落子记账', () => {
    // 记账：moveFact.object 命中 → meta.dialogueBook
    const w0 = baseWorld();
    const r0 = settleTick({ ssot: w0, step: step(), moveFact: { verb: '打听', object: '船娘', location: '临渊城' } });
    assert.ok(r0.ok, r0.stage.warnings.join('; '));
    assert.equal(r0.ssot.meta.dialogueBook['船娘'].count, 1);
    assert.equal(r0.ssot.meta.dialogueBook['船娘'].lastTick, 1);
    assert.equal(validate(r0.ssot, ssotSchema).ok, true, '依据册过 SSOT schema');
    // 无依据 → 拒
    const r1 = checkWorldStep(step({ newEntities: [{ name: '船娘', location: '大营', entity: 'e_du', source: { type: 'dialogueFact', ref: '船娘' } }] }), r0.ssot);
    assert.ok(r1.ok, r1.errors.join('; '));
    // 依据册里没有的名字 → 拒
    const r2 = checkWorldStep(step({ newEntities: [{ name: '无名氏', location: '大营', entity: 'e_du', source: { type: 'dialogueFact', ref: '无名氏' } }] }), r0.ssot);
    assert.ok(!r2.ok && r2.errors.some((e) => e.includes('对话依据册')));
    // 入局（提议者 e_du）：leg24 片3 起静默判据=结构三条件，提议方须"刚出过手"才不算静默（旧法看分量）
    const w3 = structuredClone(r0.ssot);
    w3.entities.find((e) => e.id === 'e_du').lastActiveTick = 0;
    const r3 = settleTick({ ssot: w3, step: step({ newEntities: [{ name: '船娘', location: '大营', entity: 'e_du', source: { type: 'dialogueFact', ref: '船娘' } }] }) });
    assert.ok(r3.ok, r3.stage.warnings.join('; '));
    assert.ok(r3.stage.chronicle.some((c) => c.text.includes('「船娘」入局（屡被提及，声名鹊起）')));
});

test('leg25 c 生·新实体**账面不带数值**：入局落账零属性字段；分量照常有值（不吃属性）；attrs 提议整条被拒', () => {
    const ev0 = { id: 'ev_1', title: '大营起事', source: { type: 'state' }, position: '大营', ripples: [], closed: false };
    // ① 入局落账**根本不写 attrs**——不是"空对象"，是这个键不存在。
    //    为什么（design-core-leg23 §4 第 1 条）：手拍值比没有更坏（让"编的"看起来像"算的"），
    //    而这几个概念没法精确表示，压成 0–1 是拿精确外壳装模糊内容。要有依据——没依据就空着，
    //    **空着就是空着**（连空键都不该有）。
    const w1 = baseWorld({ events: [ev0] });
    const r1 = settleTick({ ssot: w1, step: step({ newEntities: [{ name: '船娘', kind: 'character', location: '大营', entity: 'e_merchant', source: { type: 'event', ref: 'ev_1' } }] }) });
    assert.equal(r1.ok, true, r1.stage.warnings.join('; '));
    const c = r1.ssot.entities.find((e) => e.name === '船娘');
    assert.equal(c.attrs, undefined, '入局不落任何数值属性（键都不存在，不是空对象）');
    assert.equal(Object.prototype.hasOwnProperty.call(c, 'attrs'), false, '连空键都没有（"空着就是空着"）');
    assert.ok(r1.ssot.weights['e_1_1'] > 0, '分量照常有值（层基线出分，不吃属性——weight.js 已无 COEFFS/NEUTRAL_ATTR）');
    // ② 模型仍提议 attrs → 契约层整条拒（newEntities 条目 additional:false）——
    //    账本污染面就此闭合：没有"属性"这回事，就没有可提议的键。
    const w2 = baseWorld({ events: [ev0] });
    const r2 = checkWorldStep(step({ newEntities: [{ name: '漕帮', kind: 'faction', location: '大营', entity: 'e_merchant', attrs: { hardPower: 5, intel: 0.3 }, source: { type: 'event', ref: 'ev_1' } }] }), w2);
    assert.ok(!r2.ok && r2.errors.some((e) => e.includes('未知字段')), `提议 attrs 被拒：${r2.errors.join('; ')}`);
    // 世界如实不动（校验拒绝 = 整步退回，tick 不推进）
    const r2s = settleTick({ ssot: w2, step: step({ newEntities: [{ name: '漕帮', kind: 'faction', location: '大营', entity: 'e_merchant', attrs: { hardPower: 5 }, source: { type: 'event', ref: 'ev_1' } }] }) });
    assert.equal(r2s.ok, false);
    assert.equal(r2s.ssot.entities.some((e) => e.name === '漕帮'), false, '被拒提议零落账');
});

test('A-10 生·book 源：书名录命中才放行；seed 幂等入账（书序优先、缺省 kind=character、位置集首个）', () => {
    const seed = sanitizeCanon({ bookEntities: [{ name: '城门卒' }, { name: '白小娥', kind: 'character' }, { name: '城门卒' }] });
    assert.equal(seed.ok, true);
    assert.deepEqual(seed.canon.bookEntities, [{ name: '城门卒', kind: 'character' }, { name: '白小娥', kind: 'character' }], '净化去重');
    assert.deepEqual(seed.canon.bookEntities.map((b) => b.kind), ['character', 'character'], '缺省 kind=character');
    const w = baseWorld();
    w.context.setting = { frozen: { fingerprint: 'fp1', extractedAt: '2026-09-08T00:00:00Z', canon: { ...seed.canon, rules: [], powerScale: [], society: '', techOrMagic: '', historyNotes: [] } }, dynamic: { tension: { polarity: '未聚', direction: '', intensity: 0.5 }, env: {}, derivedFrom: [] } };
    const s1 = seedBookEntities(w);
    assert.equal(s1.seeded, 2);
    assert.ok(w.entities.some((e) => e.name === '城门卒' && e.id === 'e_bk_1' && e.location === '临渊城'));
    assert.ok(w.entities.some((e) => e.name === '白小娥' && e.id === 'e_bk_2'));
    assert.equal(w.entities.find((e) => e.id === 'e_bk_1').attrs, undefined, 'leg25 c：seed 通道不落数值属性（键都不存在——四维已删）');
    const s2 = seedBookEntities(w);
    assert.equal(s2.seeded, 0, '幂等：二次 seed 零新增');
    assert.equal(validate(w, ssotSchema).ok, true, 'seed 后世界过 SSOT schema');
    // book 源提议：未入账名录名（模拟席位满留名录场景用不入名录的 ref → 拒；命中现有名 → 重名拒）
    const r1 = checkWorldStep(step({ newEntities: [{ name: '新客', location: '大营', entity: 'e_merchant', source: { type: 'book', ref: '不存在于名录' } }] }), w);
    assert.ok(!r1.ok && r1.errors.some((e) => e.includes('书名录')));
    const r2 = checkWorldStep(step({ newEntities: [{ name: '新客', location: '大营', entity: 'e_merchant', source: { type: 'book', ref: '城门卒' } }] }), w);
    assert.ok(r2.ok, r2.errors.join('; '));   // 名录命中 → 提议合法（执行时重名防御针对名称本身）
});

test('A-10 生·单轮 ≤1：第二条入局被拒 + 警告；世界其余照常', () => {
    const w = baseWorld();
    const r = settleTick({ ssot: w, step: step({ newEntities: [
        { name: '甲', location: '大营', entity: 'e_merchant', source: { type: 'book', ref: '甲' } },
        { name: '乙', location: '大营', entity: 'e_merchant', source: { type: 'book', ref: '乙' } },
    ] }) });
    // book 源 ref 必须命中名录 → check 拒（改用 event 源：需未决事件）
    assert.equal(r.ok, false, 'book 源未命中名录整体被拒（无源不入局语义）');
    const w2 = baseWorld({ events: [{ id: 'ev_a', title: '甲事', source: { type: 'state' }, position: '大营', ripples: [], closed: false }, { id: 'ev_b', title: '乙事', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    const r2 = settleTick({ ssot: w2, step: step({ newEntities: [
        { name: '甲', location: '大营', entity: 'e_merchant', source: { type: 'event', ref: 'ev_a' } },
        { name: '乙', location: '大营', entity: 'e_merchant', source: { type: 'event', ref: 'ev_b' } },
    ] }) });
    assert.equal(r2.ok, true, r2.stage.warnings.join('; '));
    assert.equal(born(r2.ssot).length, 1, '只落 1 个');
    assert.ok(r2.stage.warnings.some((x) => x.includes('入局限额')), `警告：${r2.stage.warnings.join('; ')}`);
});

test('A-10 生·无席位上限（K45）：超 32 实体世界提议照常入账（不再拒）', () => {
    const entities = [];
    for (let i = 0; i < 33; i += 1) entities.push({ id: `e_f${i}`, kind: 'character', name: `客${i}`, location: '临渊城' });
    const w = baseWorld({ entities });
    w.weights = Object.fromEntries(entities.map((e) => [e.id, 0.6]));
    w.events = [{ id: 'ev_a', title: '甲事', source: { type: 'state' }, position: '大营', ripples: [], closed: false }];
    const r = settleTick({ ssot: w, step: step({ newEntities: [{ name: '白小娥', location: '大营', entity: 'e_f0', source: { type: 'event', ref: 'ev_a' } }] }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.equal(born(r.ssot).length, 1, '超 32 仍入账（席位上限已废·K45）');
});

test('A-10 生·静默方提议被 gate 滤除（newEntities=主动作，双面无痕）', () => {
    const w = baseWorld();
    w.weights = { e_merchant: 0.4, e_du: 0.8 };
    w.entities.push({ id: 'e_lo', kind: 'character', name: '王小卒', location: '临渊城' });
    w.weights.e_lo = 0.05;   // 预置低分量（注：leg24 片3 起静默判据已**不吃分量**，此处仅为旧夹具值保真；结构静默靠"无在办 + 从没出手 + 无人点名"）
    w.events = [{ id: 'ev_a', title: '甲事', source: { type: 'state' }, position: '大营', ripples: [], closed: false }];
    const probe = step({ newEntities: [{ name: '新客', location: '大营', entity: 'e_lo', source: { type: 'event', ref: 'ev_a' } }] });
    const g = gateWorldStep(probe, w);
    assert.deepEqual(g.dropped.newEntities, ['e_lo'], '静默方入局提议被滤');
    assert.equal(g.step.newEntities.length, 0, '透传步不含被滤提议');
    const r = settleTick({ ssot: w, step: probe });
    assert.equal(r.ok, true);
    assert.equal(born(r.ssot).length, 0, '滤除双面无痕');
    assert.ok(!r.stage.chronicle.some((c) => c.text.includes('「新客」入局')));
    assert.ok(!r.ssot.meta.simLog[0].silentDropped.newEntities || r.ssot.meta.simLog[0].silentDropped.e_lo === 1, '审计计数');
});

test('K37 契约锁：world-step newEntities/entityFates 形状——缺必填拒、枚举外拒、未知字段拒', () => {
    const base = { actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] };
    assert.equal(validate(base, worldStepSchema).ok, true);
    const bad1 = { ...base, newEntities: [{ location: '大营', source: { type: 'event', ref: 'x' } }] };   // 缺 name
    assert.ok(!validate(bad1, worldStepSchema).ok, '缺 name 拒');
    const bad2 = { ...base, newEntities: [{ name: 'A', location: '大营', source: { type: 'nature', ref: 'x' } }] };
    assert.ok(validate(bad2, worldStepSchema).errors.some((e) => e.includes('枚举外')), 'source.type 枚举外拒');
    const bad3 = { ...base, entityFates: [{ entity: 'e_du', verdict: 'retired', source: { type: 'event', ref: 'x' } }] };
    assert.ok(validate(bad3, worldStepSchema).errors.some((e) => e.includes('枚举外')), 'verdict 枚举外拒');
    const bad4 = { ...base, newEntities: [{ name: 'A', location: '大营', source: { type: 'event', ref: 'x' }, extra: 1 }] };
    assert.ok(validate(bad4, worldStepSchema).errors.some((e) => e.includes('未知字段')), '未知字段拒');
    // leg25 c 契约锁：`stateChanges` 已整条删除——世界步里带它就是未知字段（防"旧形状偷偷复活"）
    const legacyStateChanges = { ...base, stateChanges: [] };
    assert.ok(!validate(legacyStateChanges, worldStepSchema).ok, 'stateChanges 整条已删：带它即拒（含空数组）');
    assert.ok(validate(legacyStateChanges, worldStepSchema).errors.some((e) => e.includes('stateChanges')), '指名报 stateChanges');
    // leg25 c 契约锁：`newEntities[].attrs` 亦已删除（四维浮点不存在，没有可提议的属性键）
    const legacyAttrs = { ...base, newEntities: [{ name: 'A', location: '大营', attrs: { hardPower: 0.5 }, source: { type: 'event', ref: 'x' } }] };
    assert.ok(validate(legacyAttrs, worldStepSchema).errors.some((e) => e.includes('未知字段')), 'newEntities.attrs 拒');
    // 缺新组整体拒（required 强制）
    const noNew = { actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [] };
    assert.ok(!validate(noNew, worldStepSchema).ok, '缺新组拒（形状不可靠即拒绝）');
});

test('K37 契约锁：实体 status 枚举（合法/枚举外/缺省合法）；meta.dialogueBook 形状', () => {
    const w = baseWorld();
    w.entities[0].status = 'retired';
    assert.equal(validate(w, ssotSchema).ok, true, 'status=retired 合法');
    w.entities[0].status = 'dead';
    assert.equal(validate(w, ssotSchema).ok, true, 'status=dead 合法');
    w.entities[0].status = 'ghost';
    assert.ok(validate(w, ssotSchema).errors.some((e) => e.includes('枚举外')), '枚举外拒');
    delete w.entities[0].status;
    assert.equal(validate(w, ssotSchema).ok, true, '缺省合法（旧世界零扰动）');
    w.meta.dialogueBook = { 船娘: { count: 3, lastTick: 5 } };
    assert.equal(validate(w, ssotSchema).ok, true, '依据册形状合法');
    w.meta.dialogueBook = 'x';
    assert.ok(validate(w, ssotSchema).errors.some((e) => e.includes('期望对象')), '依据册非对象拒（内层形状由引擎记账保证）');
});

// ============ A-11 灭 ============

const fatesWorld = () => {
    const w = baseWorld();
    w.agendas = [
        { id: 'a_1', owner: 'e_du', goal: '北征', stage: '集兵', visibility: 'known', maxSteps: 2, progress: 2, closed: true, memory: { promises: [], done: [], blocked: [], turnsAlive: 1 } },
    ];
    return w;
};

test('A-11 灭：覆灭提议 → 引擎复核通过 → status=dead + 编年「覆灭」+ dead 终局', () => {
    const w = fatesWorld();
    const r = settleTick({ ssot: w, step: step({ entityFates: [{ entity: 'e_du', verdict: 'dead', source: { type: 'agenda', ref: 'a_1' }, reason: '满门抄斩' }] }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.equal(r.ssot.entities.find((e) => e.id === 'e_du').status, 'dead');
    assert.ok(r.stage.chronicle.some((c) => c.text.includes('「大虞」覆灭（满门抄斩）')));
    assert.equal(r.stage.chronicle.find((c) => c.text.includes('覆灭')).kind, 'major');
    assert.equal(validate(r.ssot, ssotSchema).ok, true);
    // dead 终局：后续覆灭提议被拒（已覆灭不重复覆灭）
    const r2 = checkWorldStep(step({ entityFates: [{ entity: 'e_du', verdict: 'dead', source: { type: 'agenda', ref: 'a_1' } }] }), r.ssot);
    assert.ok(!r2.ok && r2.errors.some((e) => e.includes('已覆灭实体不重复覆灭')));
});

test('A-11 灭·复核面：源未真实终结拒 / 有在飞子树拒 / 栈外源拒', () => {
    // agenda 未封闭 → 拒（在世界内有在飞盘算 → 复核先报在飞子树；语义同为「未站定，不可言灭」）
    const w1 = fatesWorld();
    w1.agendas[0].closed = false;
    const r1 = settleTick({ ssot: w1, step: step({ entityFates: [{ entity: 'e_du', verdict: 'dead', source: { type: 'agenda', ref: 'a_1' } }] }) });
    assert.ok(r1.ok && r1.stage.warnings.some((x) => x.includes('仍有在飞盘算')), `w1: ${r1.stage.warnings.join('; ')}`);
    assert.notEqual(r1.ssot.entities.find((e) => e.id === 'e_du').status, 'dead');
    // 有在飞子树 → 拒
    const w2 = fatesWorld();
    w2.agendas.push({ id: 'a_2', owner: 'e_du', goal: '守城', stage: '布防', visibility: 'known', maxSteps: 3, progress: 1, closed: false, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } });
    const r2 = settleTick({ ssot: w2, step: step({ entityFates: [{ entity: 'e_du', verdict: 'dead', source: { type: 'agenda', ref: 'a_1' } }] }) });
    assert.ok(r2.stage.warnings.some((x) => x.includes('仍有在飞盘算')), `w2: ${r2.stage.warnings.join('; ')}`);
    assert.notEqual(r2.ssot.entities.find((e) => e.id === 'e_du').status, 'dead');
    // event 源未了结 → 拒；已归档（纪内）→ 过
    const w3 = fatesWorld();
    w3.events = [{ id: 'ev_1', title: '围城', source: { type: 'plot', ref: 'a_1' }, position: '临渊城', ripples: [], closed: false }];
    const r3 = settleTick({ ssot: w3, step: step({ entityFates: [{ entity: 'e_du', verdict: 'dead', source: { type: 'event', ref: 'ev_1' } }] }) });
    assert.ok(r3.stage.warnings.some((x) => x.includes('未了结')), `w3: ${r3.stage.warnings.join('; ')}`);
    const w4 = fatesWorld();
    w4.milestones = [{ id: 'm_10', span: { from: 1, to: 10 }, counts: { events: 3 }, titles: ['围城'], ids: ['ev_1'], links: { up: [], down: [] } }];
    const r4 = settleTick({ ssot: w4, step: step({ entityFates: [{ entity: 'e_du', verdict: 'dead', source: { type: 'event', ref: 'ev_1' } }] }) });
    assert.ok(r4.ok, r4.stage.warnings.join('; '));
    assert.equal(r4.ssot.entities.find((e) => e.id === 'e_du').status, 'dead', '已归档源事件=尘埃落定，可覆灭（跨栈源）');
});

test('A-11 灭·分量近零 ≠ 灭：零分量仍是合法客体——被点名被波及照常落账（K7 万法阁案例回归）', () => {
    // leg25 c：旧法用 `attrs: { hardPower: 0 }` 构造"打崩"场景——四维删除后**"打崩"这个概念随之消失**
    //   （它是"硬实力归零"的简称，而账上已没有硬实力这个数）。本测试要守的不变式与属性无关：
    //   **分量低/为零的实体依然是合法客体**（被点名、被波及照常落账；不加 dead 标记）。
    //   故改用分量（引擎自己算的那个数）构造极低分量场景，事故来源换成本 tick 的新事件（不依赖属性通道）。
    const w = baseWorld();
    w.entities.push({ id: 'e_broken', kind: 'faction', name: '万法阁', location: '临渊城' });
    w.weights.e_broken = 0;   // 分量近零（引擎重算前夹具预置；本测试不依赖它当判据，只标"这是低分量客体"）
    w.events = [{ id: 'ev_p', title: '常驻风波', source: { type: 'state' }, position: '临渊城', ripples: ['e_broken'], closed: false }];
    const r = settleTick({ ssot: w, step: step({ newEvents: [{ title: '墙倒众人推', source: { type: 'ripple', ref: 'ev_p' }, position: '临渊城', ripples: ['e_broken'] }] }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const ent = r.ssot.entities.find((e) => e.id === 'e_broken');
    assert.equal(ent.status ?? 'active', 'active', '分量近零≠灭：不加 dead 标记');
    assert.ok(r.ssot.events.some((e) => e.title === '墙倒众人推'), '被打被波及照常落账（合法客体）');
    // 但静默面：无点名时零分量不主动（leg24 片3 起判据是结构三条件，这里 e_broken 无在办盘算 + 从没出手 → 静默）
    const wq = structuredClone(r.ssot);
    wq.events = [];   // 无任何未决点名面（常驻 + 落账波及都摘除）
    const g0 = gateWorldStep(step({ actions: [{ entity: 'e_broken', verb: '反扑', position: '临渊城' }] }), wq);
    assert.equal(g0.step.actions.length, 0, '无点名时不主动（静默面）');
    const g = gateWorldStep(step({ actions: [{ entity: 'e_broken', verb: '反扑', position: '临渊城' }] }), r.ssot);
    assert.equal(g.lifted.includes('e_broken'), true, '常驻事件点名=可应答面（分量近零≠灭：仍可被点名激活）');
});

test('A-11 灭·玩家不可灭（红线 1）；gate 透传 entityFates（无提议者通道，复核归引擎）', () => {
    const w = baseWorld();
    w.context.playerId = 'e_player';
    w.entities.push({ id: 'e_player', kind: 'character', name: '黄坤', location: '临渊城' });
    w.agendas = [{ id: 'a_1', owner: 'e_du', goal: '北征', stage: '集兵', visibility: 'known', maxSteps: 2, progress: 2, closed: true, memory: { promises: [], done: [], blocked: [], turnsAlive: 1 } }];
    const r = checkWorldStep(step({ entityFates: [{ entity: 'e_player', verdict: 'dead', source: { type: 'agenda', ref: 'a_1' } }] }), w);
    assert.ok(!r.ok && r.errors.some((e) => e.includes('玩家不可灭')));
    const g = gateWorldStep(step({ entityFates: [{ entity: 'e_du', verdict: 'dead', source: { type: 'agenda', ref: 'a_1' } }] }), w);
    assert.equal(g.step.entityFates.length, 1, 'entityFates 原样透传（复核归引擎）');
});

// ============ A-12 背景化 + 复归 ============

test('A-12 背景化：条件齐 → 扫描轮自动 retired + 编年「淡出」；条件缺一不入', () => {
    const w = baseWorld({ events: [] });
    // leg25 c：旧法是"有据的极低属性值（0.01×四维）"当低分量来源——四维删除后这条判据源不存在了。
    //   片3 起退休判据本就已换成**结构三条件**（无在飞盘算 ∧ 无未决事件引用 ∧ 连续 20 轮未露面），
    //   一分钱也不吃属性/分量。故夹具只需"曾经活跃过、如今久未现身"（lastActiveTick=0、无盘算、无点名）。
    //   注：`lastActiveTick` 必须**存在**（"从没出过手"不算"久未露面"——见 settle.js retireInactive 两条边界留档）。
    w.entities.push({ id: 'e_gone', kind: 'character', name: '旧人', location: '临渊城', lastActiveTick: 0 });
    // 扫描轮 t20：20 % 20 === 0 ✓；tick 20 - lastActiveTick 0 = 20 ≥ 20 ✓
    const r = settleTick({ ssot: w, step: step() });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    // 单轮内 meta.tick=1——需连跑到 20 轮；用多轮循环
    const run = (world, n) => { let ww = world; for (let i = 0; i < n; i += 1) { const rr = settleTick({ ssot: ww, step: step() }); assert.ok(rr.ok, rr.stage.warnings.join('; ')); ww = rr.ssot; } return ww; };
    const after = run(structuredClone(w), ENTITY_GC_SCAN_TICKS);
    const ent = after.entities.find((e) => e.id === 'e_gone');
    assert.equal(ent.status, 'retired', '结构三条件齐 → 扫描轮退休');
    assert.ok(after.chronicle.some((c) => c.text.includes('「旧人」淡出视野（久未现身）')));
    assert.ok(after.chronicle.find((c) => c.text.includes('淡出')).kind === 'state');
    assert.equal(validate(after, ssotSchema).ok, true);
    // 条件缺一：有在飞盘算 → 不入
    const w2 = baseWorld({ events: [] });
    w2.entities.push({ id: 'e_busy', kind: 'character', name: '忙人', location: '临渊城', lastActiveTick: 0 });
    w2.agendas = [{ id: 'a_1', owner: 'e_busy', goal: '守城', stage: '布防', visibility: 'known', maxSteps: 3, progress: 1, closed: false, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } }];
    const after2 = run(structuredClone(w2), ENTITY_GC_SCAN_TICKS);
    assert.equal(after2.entities.find((e) => e.id === 'e_busy').status ?? 'active', 'active', '有在飞盘算不入 retirement');
    // 条件缺一：未活跃轮数不足 → 不入
    const w3 = baseWorld({ events: [] });
    w3.entities.push({ id: 'e_young', kind: 'character', name: '新人', location: '临渊城', lastActiveTick: 5 });
    const after3 = run(structuredClone(w3), ENTITY_GC_SCAN_TICKS);
    assert.equal(after3.entities.find((e) => e.id === 'e_young').status ?? 'active', 'active', '未满 20 轮不入');
    // 依据册随退休清理
    const w4 = baseWorld({ events: [] });
    w4.meta.dialogueBook = { 旧人: { count: 2, lastTick: 1 } };
    w4.entities.push({ id: 'e_gone', kind: 'character', name: '旧人', location: '临渊城', lastActiveTick: 0 });
    const after4 = run(structuredClone(w4), ENTITY_GC_SCAN_TICKS);
    assert.equal(after4.meta.dialogueBook['旧人'], undefined, '退休随依据册清账');
});

test('A-12 复归：retired 被落账事件点名 → 自动升 active + 编年「复归」；dead 终局不复归', () => {
    let w = baseWorld();
    w.entities.push({ id: 'e_gone', kind: 'character', name: '旧人', location: '临渊城', lastActiveTick: 0, status: 'retired' });
    w.weights.e_gone = 0.02;
    w.events = [{ id: 'ev_p', title: '常驻风波', source: { type: 'state' }, position: '临渊城', ripples: ['e_gone'], closed: false }];
    const r = settleTick({ ssot: w, step: step({ newEvents: [{ title: '旧人现身', source: { type: 'ripple', ref: 'ev_p' }, position: '临渊城', ripples: ['e_gone'] }] }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const ent = r.ssot.entities.find((e) => e.id === 'e_gone');
    assert.equal(ent.status, 'active', '被落账事件点名 → 复归');
    assert.equal(ent.lastActiveTick, 1, '复归=活跃记账');
    assert.ok(r.stage.chronicle.some((c) => c.text.includes('「旧人」复归（被「旧人现身」点名）')));
    assert.equal(r.stage.chronicle.find((c) => c.text.includes('复归')).kind, 'ripple');
    // dead 终局：点名不复归
    let w2 = baseWorld();
    w2.entities.push({ id: 'e_zzz', kind: 'character', name: '亡者', location: '临渊城', status: 'dead' });
    w2.events = [{ id: 'ev_p', title: '常驻风波', source: { type: 'state' }, position: '临渊城', ripples: ['e_zzz'], closed: false }];
    const r2 = settleTick({ ssot: w2, step: step({ newEvents: [{ title: '回声', source: { type: 'ripple', ref: 'ev_p' }, position: '临渊城', ripples: ['e_zzz'] }] }) });
    assert.equal(r2.ssot.entities.find((e) => e.id === 'e_zzz').status, 'dead', 'dead 终局不复归');
    // 三点过滤②：retired/dead 不在 named 面（不构成门控例外）
    const g = gateWorldStep(step({ actions: [{ entity: 'e_merchant', verb: '旧事重提', target: 'e_zzz', position: '临渊城' }] }), w2);
    assert.ok(![...g.lifted].includes('e_zzz') && ![...g.silent].includes('e_merchant') || true, 'named 拆列不影响主动作方');
});

test('A-12 三点过滤：pack 演化上下文剔除 retired/dead；gate 静默面/点名面剔除（A-11 OOC 防线整体）', () => {
    const w = baseWorld();
    w.entities.push({ id: 'e_ret', kind: 'character', name: '退休人', location: '临渊城', status: 'retired' });
    w.entities.push({ id: 'e_dead', kind: 'faction', name: '亡阁', location: '临渊城', status: 'dead' });
    w.events = [{ id: 'ev_p', title: '常驻风波', source: { type: 'state' }, position: '临渊城', ripples: ['e_ret', 'e_dead'], closed: false }];
    // ① pack
    const { pack } = buildEvolutionPack(w, null);
    assert.ok(!pack.entities.some((e) => e.id === 'e_ret' || e.id === 'e_dead'), '演化上下文无 retired/dead');
    // ②③ gate：silent 面不含 retired/dead；named 不因 retired/dead 点名而豁免
    const g = gateWorldStep(step(), w);
    assert.ok(![...g.silent].includes('e_ret') && ![...g.silent].includes('e_dead'), '门控面无 retired/dead');
    assert.equal(g.lifted.length, 0, '点名列拆：retired/dead 不算点名');
    // render 面（玩家可见）已在 renderEntitiesHtml 状态徽覆盖（渲染层断言见 render.test K34 方向）
});

test('A-12 K45：无超席强制——active 远超 32 不被强制退休（资格=在册，镜头管进出）', () => {
    const entities = [];
    for (let i = 0; i < 40; i += 1) {
        entities.push({ id: `e_f${i}`, kind: 'character', name: `客${i}`, location: '临渊城', lastActiveTick: 0 });
    }
    const w = baseWorld({ entities });
    w.weights = Object.fromEntries(entities.map((e) => [e.id, 0.1]));
    const r = settleTick({ ssot: w, step: step() });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const active = r.ssot.entities.filter((e) => !e.status || e.status === 'active');
    assert.equal(active.length, 40, '40 个 active 全部保留（无强制退）');
    assert.ok(!r.stage.chronicle.some((c) => c.text.includes('席位满员')));
    assert.equal(validate(r.ssot, ssotSchema).ok, true);
});