// story-world-v2/test/entity-writeback.test.js
// ★leg34（小说家条款 §6 实施）：**实体字段写回** · **带因复活** · **世界书检索注入**。
// 用户原话（细案 §0 ④⑤⑥）：
//   ⑤「我认为 llm 有权决定任何字段，实力是可以增长的，性情是可以大变的，就连死亡在一个有复活的世界都可以改变」
//   ⑥「为了防止 token 爆炸，有些数据可以分为必须每轮都带和不用每轮都带，使用时再查」+「要给模型主动查的接口」
//   ★⑥ 的**实现方式在本棒修正过一次**（用户 2026-09-13 追问）：不是"模型主动问、下一轮回灌"，而是
//     "**出包前按上下文检索、当轮随包递**"——与 ST 关键词世界书 / `yuzuki-Memory` 向量召回同一条思路。见 W9 组。
//
// 本文件锁的是**判据**，不是实现细节（本仓铁律：每条机制都要能红）：
//   · W1 合法变更：落账 + **原值与现值同时在场** + 能追到账（细案 §6.3「原话不会丢」）
//   · W2：事件因须真实存在，完成事实仍可作因；盘算因须仍在办。
//   · W3 约束 4：黑名单三字段 + 玩家不可改（与既有四条守卫同权）
//   · W4 约束 5：value 是文本，引擎不换算
//   · W5 复活三把钥匙：dead + **本 tick 被提到他的事点名** + value=active（缺一不可）
//   · W6 ★离场名册：死者进包（否则"复活"在生产上是死代码——本棒实测踩到的那个坑）
//   · W7 ★★★leg112 反向：**上限已撤**（用户 2026-09-22 拍板）⇒ 一轮提多条**必须全部落账**
//   · W8 ★可选组：只带七组的老步照常合法（**缺席 = 本轮没有这件事**，不是形状错误）
//   · W9 ★检索注入**当轮可见** + 失败零阻塞 + 只用账上真有的字
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settleTick } from '../src/settle.js';
import { checkWorldStep, ENTITY_IMMUTABLE_FIELDS } from '../src/check-step.js';
import { buildEvolutionPack, DEPARTED_TAIL } from '../src/pack.js';
import { validate } from '../src/schema.js';
import { worldStepSchema } from '../src/schemas/world-step.schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
// ★丙′ 案（用户拍板）：禁写名单只留"纯引擎簿记"与"身份锚"两类——逐个锁住，防以后被顺手放宽
assert.deepEqual(ENTITY_IMMUTABLE_FIELDS,
    ['id', 'kind', 'name', 'lastActiveTick', 'fieldSource', 'parentSource', 'parentSourceFrom', 'simulationBlocked'],
    '禁写名单包含主键/类型契约/身份锚/引擎簿记/出处发票和用户的模拟开关');
// ★`status` **故意不在名单里**（本棒踩坑留档）：第一版把它放进去 ⇒ **把带因复活整个关掉了**
//   （复活就是改 status）。它的正确管法是**字段专属严规则**（必须 dead + value=active + 本回合有事件点到他）
//   —— 比黑名单更严也更准。见 W5 组。
assert.equal(ENTITY_IMMUTABLE_FIELDS.includes('status'), false, '★status 不进黑名单（有专属严规则；进了就等于关掉复活）');
assert.equal(ENTITY_IMMUTABLE_FIELDS.includes('location'), false, '★location 可改（位置集是闸才冻结，这栏零机制消费者）');
assert.equal(ENTITY_IMMUTABLE_FIELDS.includes('race'), false, '★race 可改（无专用通道、无机制消费者——妖化/夺舍是剧情）');
assert.equal(ENTITY_IMMUTABLE_FIELDS.includes('parent'), false, '★parent 可改（改换门庭／叛投／被吞并）');

function baseWorld(extra = {}) {
    return {
        version: 1,
        context: { world: '临渊城', tension: 0.5, positions: ['临渊城', '大营'] },
        entities: [
            { id: 'e_a', kind: 'character', name: '甲', location: '临渊城', 实力: '筑基' },
            { id: 'e_dead', kind: 'character', name: '亡者', location: '大营', status: 'dead' },
            { id: 'e_player', kind: 'character', name: '棋子', location: '临渊城' },
        ],
        weights: { e_a: 0.4, e_dead: 0.1, e_player: 0.5, e_du: 0.8 },
        agendas: [],
        events: [],
        chronicle: [],
        meta: { tick: 0 },
        ...extra,
    };
}
// 七组底（**不含**新两组的故意缺省——见 W8）
const step7 = (more = {}) => ({
    actions: [], newEvents: [], agendaAdvances: [],
    newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    ...more,
});
const upd = (more = {}) => ({ entity: 'e_a', field: '实力', value: '金丹', cause: { type: 'event', ref: 'ev_1' }, ...more });

// ============ W1 合法变更：落账 + 留痕 ============

test('W1：合法字段变更落账——现值改掉，且**原值与现值同时在场**、能追到账（细案 §6.3）', () => {
    const w = baseWorld({ events: [{ id: 'ev_1', title: '血战', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    const r = settleTick({ ssot: w, step: step7({ entityUpdates: [upd()] }) });
    assert.equal(r.ok, true);
    assert.equal(r.ssot.entities.find((e) => e.id === 'e_a').实力, '金丹', '现值已改');
    const rec = r.ssot.meta.entityFields.e_a.fields.实力;
    assert.equal(r.ssot.meta.entityFields.e_a.fields.实力.value, '金丹', '现值在留痕里');
    assert.equal(r.ssot.meta.entityFields.e_a.fields.实力.prev, '筑基', '★原值不丢（"原话不会丢"）');
    assert.equal(r.ssot.meta.entityFields.e_a.fields.实力.cause, 'ev_1', '能追到是哪件事让它变的');
    assert.equal(r.ssot.meta.entityFields.e_a.fields.实力.tick, 1, '落在哪一轮');
    // ★丙′ 出处双源：这条路（模型变更）写 `source:'变更'`；查书那条路写 `'书里原话'`（见 W11）
    assert.equal(r.ssot.meta.entityFields.e_a.fields.实力.source, '变更', '出处标成"变更"（不是"书里原话"——别伪造发票）');
    assert.equal(r.ssot.events[0].title, '血战', '历史（事件）一个字节未动——只许往前长');
    assert.equal(r.stage.warnings.filter((x) => x.startsWith('裁定:')).length, 0, '合法变更零裁定');
});

test('W1b：改任意非黑名单字段都可以（用户⑤"有权决定任何字段"）——含新增字段', () => {
    const w = baseWorld({ events: [{ id: 'ev_1', title: '觉悟', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    const r = settleTick({ ssot: w, step: step7({ entityUpdates: [upd({ field: '性情', value: '变得阴鸷' })] }) });
    assert.equal(r.ok, true);
    assert.equal(r.ssot.entities.find((e) => e.id === 'e_a').性情, '变得阴鸷', '账上原先没有这个字段也照写');
    assert.equal(r.ssot.meta.entityFields.e_a.fields.性情.value, '变得阴鸷');
});

// ============ W2：事件事实须存在，盘算须仍在办 ============

test('W2：因不在账上 ⇒ 拒（无因之变不是因果）', () => {
    const w = baseWorld();
    const c = checkWorldStep(step7({ entityUpdates: [upd({ cause: { type: 'event', ref: 'ev_无' } })] }), w);
    assert.equal(c.ok, false);
    assert.ok(c.errors.some((e) => e.includes('event 源必须引已存在事件')), c.errors.join('; '));
});

test('W2b：已完成的真实事件仍可解释后续变化', () => {
    const w = baseWorld({ events: [{ id: 'ev_old', title: '旧事', source: { type: 'state' }, position: '大营', ripples: [], closed: true }] });
    const c = checkWorldStep(step7({ entityUpdates: [upd({ cause: { type: 'event', ref: 'ev_old' } })] }), w);
    assert.equal(c.ok, true, c.errors.join('; '));
});

test('W2c：agenda 源同理——不在账/已结算都拒', () => {
    const w = baseWorld({ agendas: [{ id: 'a_x', owner: 'e_a', goal: 'g', visibility: 'known', progress: 0, maxSteps: 3, closed: true, source: { type: 'state' } }] });
    const miss = checkWorldStep(step7({ entityUpdates: [upd({ cause: { type: 'agenda', ref: 'a_无' } })] }), w);
    assert.equal(miss.ok, false);
    const closed = checkWorldStep(step7({ entityUpdates: [upd({ cause: { type: 'agenda', ref: 'a_x' } })] }), w);
    assert.equal(closed.ok, false);
    assert.ok(closed.errors.some((e) => e.includes('在飞')), closed.errors.join('; '));
});

test('W2d：settle 侧防御复核——直调 settleTick（绕过 check）时，非法步**当场拒整步**而不是悄悄落账', () => {
    // 本棒更正：第一版这里断言"世界照常推进、只丢这一条提议"——**错的**。
    //   `settleTick` 内部**自己**先跑 `checkWorldStep`（`settle.js` 入口处的契约闸）⇒ 非法步在入口就被拒，
    //   根本走不到"逐条复核"。这正是我们要的：**非法步 fail-fast，不许半途落账**（比静默丢弃更安全）。
    //   ⇒ 本用例改成锁"fail-fast"这条语义；"逐条复核"那层防御由 W2e/W5c（warnings 里的裁定痕迹）覆盖。
    const w = baseWorld({ events: [{ id: 'ev_old', title: '旧事', source: { type: 'state' }, position: '大营', ripples: [], closed: true }] });
    const r = settleTick({ ssot: w, step: step7({ entityUpdates: [upd({ cause: { type: 'event', ref: 'ev_missing' } })] }) });
    assert.equal(r.ok, false, '★非法步必须被拒（fail-fast）');
    assert.ok(r.stage.warnings.join('; ').includes('event 源必须引已存在事件'), r.stage.warnings.join('; '));
    assert.equal(r.ssot.entities.find((e) => e.id === 'e_a').实力, '筑基', '世界原样未动');
});

test('W2e：同一实体同一字段一轮内重复提议 ⇒ 拒（一条变更一个因，别叠）', () => {
    const w = baseWorld({ events: [{ id: 'ev_1', title: 'x', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    const c = checkWorldStep(step7({ entityUpdates: [upd(), upd({ value: '元婴' })] }), w);
    assert.equal(c.ok, false);
    assert.ok(c.errors.some((e) => e.includes('重复提议')), c.errors.join('; '));
});

// ★★★leg66（用户实机贴回的一条裁定）：**"本批次开始时因是开着的" 才是判据**，不是"复核那一刻它还开着"。
//   现场（真账 tick 7 · 大荒z1）：模型给「苏千欢」写回字段、因 = `ev_5_3`（它自己那件"阵眼破碎、龙气外泄"）；
//   `settle` 入口的 `checkWorldStep` **看到它是开的 ⇒ 放行**，而同一批里她那条盘算走到了满步
//   ⇒ `closeEvents` 的"源结清"型**先把 `ev_5_3` 关掉** ⇒ 随后 `applyEntityUpdates` 的防御复核读到 `closed=true`
//   ⇒ 一条合法变更被吞，玩家看到那句"不在账或已了结"（**而它明明在账上、也明明是本轮的由头**）。
//   本组锁两件：①同一批次内被本轮关掉的因仍有效；②批次前已完成的事实也可产生新后果。
test('W2f：因在本批次内被本轮自己关掉，写回仍有效', () => {
    // 盘算 3/3：这一推就是满步结算 ⇒ closeEvents 的"源结清"会把它的 plot 事件一并关掉
    const w = baseWorld({
        agendas: [{
            id: 'a_1', owner: 'e_a', goal: '夺龙气', stage: '入体', visibility: 'known',
            maxSteps: 3, progress: 3, memory: { promises: [], done: [], blocked: [], turnsAlive: 3 }, source: { type: 'state' },
        }],
        events: [{ id: 'ev_1', title: '阵眼破碎', source: { type: 'plot', ref: 'a_1' }, position: '大营', ripples: ['e_a'], links: { up: [], down: [] }, closed: false }],
    });
    const r = settleTick({ ssot: w, step: step7({
        agendaAdvances: [{ agendaId: 'a_1', step: '硬抗反噬，将其压入丹田' }],
        entityUpdates: [upd({ value: '元婴', cause: { type: 'event', ref: 'ev_1' } })],
    }) });
    // 先确认"因真的被本轮关掉了"——不然后面那条断言就是空绿
    assert.equal(r.ssot.events.find((e) => e.id === 'ev_1').closed, true, '★前提：因确实被本轮关掉（源结清）');
    assert.equal(r.ssot.agendas.find((a) => a.id === 'a_1').closed, true, '★前提：盘算确实本轮满步结算');
    assert.equal(r.ssot.entities.find((e) => e.id === 'e_a').实力, '元婴', '★写回必须落账（不许因为"本轮自己把它关掉"而吞掉合法变更）');
    assert.equal(r.stage.warnings.filter((x) => x.includes('字段写回复核拒绝')).length, 0, `不该有复核拒绝裁定：${r.stage.warnings.join('; ')}`);
});

test('W2g：批次前已完成的事件仍能作因，结算保留原引用', () => {
    const w = baseWorld({ events: [{ id: 'ev_old', title: '旧事', source: { type: 'state' }, position: '大营', ripples: ['e_a'], closed: true, closedAt: 2 }] });
    const r = settleTick({ ssot: w, step: step7({ entityUpdates: [upd({ cause: { type: 'event', ref: 'ev_old' } })] }) });
    assert.equal(r.ok, true);
    assert.equal(r.ssot.entities.find((e) => e.id === 'e_a').实力, '金丹');
    assert.equal(r.ssot.events.find((e) => e.id === 'ev_old').closedAt, 2);
});

// ============ W3 约束 4：黑名单 + 玩家不可改 ============

test('W3：黑名单全拒——理由全是机械的（主键/类型契约/身份锚/引擎簿记/出处发票）', () => {
    const w = baseWorld({ events: [{ id: 'ev_1', title: 'x', source: { type: 'state' }, position: '大营', ripples: ['e_dead'], closed: false }] });
    for (const f of ENTITY_IMMUTABLE_FIELDS) {
        const c = checkWorldStep(step7({ entityUpdates: [upd({ field: f })] }), w);
        assert.equal(c.ok, false, `${f} 应被拒`);
        assert.ok(c.errors.some((e) => e.includes('不可改')), `${f}: ${c.errors.join('; ')}`);
    }
});

test('W3b：★放开的真能改——location / race / 归属 / 新栏（剧情会改的那批）', () => {
    const w = baseWorld({ events: [{ id: 'ev_1', title: '迁徙', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    const cases = [
        ['location', '大营'],      // ★位置：零机制消费者 ⇒ 改它没有机制后果
        ['race', '妖族'],          // ★妖化/夺舍
        ['parent', '大虞'],        // ★改换门庭
        ['称号', '荡魔真君'],       // ★剧情长出来的新栏
        ['性情', '变得阴鸷'],       // ★同上（上一版这条过不了 schema）
    ];
    for (const [f, v] of cases) {
        const c = checkWorldStep(step7({ entityUpdates: [upd({ field: f, value: v })] }), w);
        assert.equal(c.ok, true, `${f} 应可改：${c.errors.join('; ')}`);
        const r = settleTick({ ssot: baseWorld({ events: [{ id: 'ev_1', title: '迁徙', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] }), step: step7({ entityUpdates: [upd({ field: f, value: v })] }) });
        assert.equal(r.ok, true, `${f} 落账应成功`);
        assert.equal(r.ssot.entities.find((e) => e.id === 'e_a')[f], v, `${f} 落账值对不对`);
    }
});

test('W3b2：★新栏写进账后**整份账仍过 SSOT schema**（上一版这条红——entities 是 additional:false）', () => {
    const w = baseWorld({ events: [{ id: 'ev_1', title: '顿悟', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    const r = settleTick({ ssot: w, step: step7({ entityUpdates: [upd({ field: '性情', value: '变得阴鸷' })] }) });
    const v = validate(r.ssot, ssotSchema);
    assert.equal(v.ok, true, `★模型写的新栏不许让账本过不了 schema：${v.errors?.slice(0, 3).join('; ')}`);
});

test('W3b3：放开额外字段**不等于**放松已知字段的校验（kind 枚举这些照旧强校验）', () => {
    const w = baseWorld();
    w.entities[0].kind = '神兽';      // 枚举外
    const v = validate(w, ssotSchema);
    assert.equal(v.ok, false, '★已知字段仍强校验（additional 只管"未知键"）');
    assert.ok(v.errors.some((e) => e.includes('枚举外')), v.errors.join('; '));
});

test('W3c：未知实体拒；字段写回不许把 status 写成 dead（灭走 entityFates，那里有独立复核）', () => {
    const w = baseWorld({ events: [{ id: 'ev_1', title: 'x', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    assert.equal(checkWorldStep(step7({ entityUpdates: [upd({ entity: 'e_无' })] }), w).ok, false);
    const dead = checkWorldStep(step7({ entityUpdates: [upd({ entity: 'e_dead', field: 'status', value: 'dead' })] }), w);
    assert.equal(dead.ok, false);
    // status 已进禁写名单（有专用通道）⇒ 报"不可改"就对了（更早也更准确）
    assert.ok(dead.errors.some((e) => e.includes('不可改') || e.includes('entityFates') || e.includes('带因复活')), dead.errors.join('; '));
});

test('W3b：玩家棋子不可改（红线 1——玩家的行为与承诺是唯一真相源）', () => {
    const w = baseWorld({ events: [{ id: 'ev_1', title: 'x', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    w.context.playerId = 'e_player';
    const c = checkWorldStep(step7({ entityUpdates: [upd({ entity: 'e_player', field: '实力', value: '登天' })] }), w);
    assert.equal(c.ok, false);
    assert.ok(c.errors.some((e) => e.includes('玩家不可改')), c.errors.join('; '));
});

test('W3c：未知实体拒；字段写回不许把 status 写成 dead（灭走 entityFates，那里有独立复核）', () => {
    const w = baseWorld({ events: [{ id: 'ev_1', title: 'x', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    assert.equal(checkWorldStep(step7({ entityUpdates: [upd({ entity: 'e_无' })] }), w).ok, false);
    const dead = checkWorldStep(step7({ entityUpdates: [upd({ field: 'status', value: 'dead' })] }), w);
    assert.equal(dead.ok, false);
    assert.ok(dead.errors.some((e) => e.includes('entityFates')), dead.errors.join('; '));
});

// ============ W4 约束 5：值是文本 ============

test('W4：value 是文本，引擎不换算、不进公式（四维浮点被删的同一条理由）', () => {
    const w = baseWorld({ events: [{ id: 'ev_1', title: 'x', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    const r = settleTick({ ssot: w, step: step7({ entityUpdates: [upd({ value: 'T8 破妄' })] }) });
    const v = r.ssot.entities.find((e) => e.id === 'e_a').实力;
    assert.equal(v, 'T8 破妄', '原话照抄，不做任何解析');
    assert.equal(typeof v, 'string', '★是文本不是数（"用精确外壳装模糊内容"那条教训）');
    // 本棒更正：第一版这里断言"weights 一点没变"——**错的**：`settleTick` 每轮都会 `recomputeWeights`
    //   （那是活跃度/衰减的正常记账，与本次变更无关）。
    //   ★本用例真正要锁的是"引擎不拿这个值算任何东西" ⇒ 用**源码级判据**（本仓有先例：用花括号深度判作用域）：
    //     分量模块 `weight.js` 里**不许出现** `实力` 的读取——四维浮点被删的整条理由就是"这值不进公式"。
    const weightSrc = readFileSync(new URL('../src/weight.js', import.meta.url), 'utf8');
    const reads = weightSrc.split('\n').filter((l) => /实力/.test(l) && !/^\s*(\/\/|\*)/.test(l));
    assert.deepEqual(reads, [], '★weight.js 里不许有读 `实力` 的代码行（注释可以）——文本值永不进公式');
});

// ============ W5 带因复活：三把钥匙 ============

const revStep = (more = {}) => step7({
    newEvents: [{ title: '亡者遗蜕现世', source: { type: 'state' }, position: '大营', ripples: ['e_dead'] }],
    entityUpdates: [{ entity: 'e_dead', field: 'status', value: 'active', cause: { type: 'event', ref: 'ev_named' }, note: '遗蜕现世' }],
    ...more,
});
test('W5：带因复活三把钥匙齐 ⇒ 复活（status=active + 活跃记账 + 编年留痕）', () => {
    const w = baseWorld({ events: [{ id: 'ev_named', title: '大营异动', source: { type: 'state' }, position: '大营', ripples: ['e_dead'], closed: false }] });
    const r = settleTick({ ssot: w, step: revStep() });
    assert.equal(r.ok, true);
    assert.equal(r.ssot.entities.find((e) => e.id === 'e_dead').status, 'active', '★复活了');
    assert.equal(r.ssot.entities.find((e) => e.id === 'e_dead').lastActiveTick, 1, '复归即活跃');
    assert.ok(r.stage.chronicle.some((c) => c.text.includes('重回场上')), '编年留痕');
    assert.equal(r.ssot.meta.entityFields.e_dead.fields.status.prev, 'dead', '原状态不丢');
});

test('W5b：钥匙①「因必须提到他」——因的波及名单里没有他 ⇒ 拒（结构性判据，不是词表判语义）', () => {
    const w = baseWorld({ events: [{ id: 'ev_named', title: '别处的事', source: { type: 'state' }, position: '临渊城', ripples: ['e_a'], closed: false }] });
    const c = checkWorldStep(revStep(), w);
    assert.equal(c.ok, false);
    assert.ok(c.errors.some((e) => e.includes('波及名单')), c.errors.join('; '));
});

test('W5c：钥匙②「同轮被点名」——因是旧事件、本 tick 没有新事件点他 ⇒ settle 复核拒', () => {
    const w = baseWorld({ events: [{ id: 'ev_named', title: '旧异动', source: { type: 'state' }, position: '大营', ripples: ['e_dead'], closed: false }] });
    const r = settleTick({ ssot: w, step: step7({
        entityUpdates: [{ entity: 'e_dead', field: 'status', value: 'active', cause: { type: 'event', ref: 'ev_named' } }],
    }) });
    assert.equal(r.ssot.entities.find((e) => e.id === 'e_dead').status, 'dead', '★没复活');
    assert.ok(r.stage.warnings.some((x) => x.includes('本 tick 没被新落账的事点名')), r.stage.warnings.join('; '));
});

test('W5d：钥匙③ value 必须写 active；且复活不许挂 agenda 源（agenda 没有波及名单，核不了"提到他"）', () => {
    const w = baseWorld({
        events: [{ id: 'ev_named', title: 'x', source: { type: 'state' }, position: '大营', ripples: ['e_dead'], closed: false }],
        agendas: [{ id: 'a_x', owner: 'e_a', goal: 'g', visibility: 'known', progress: 0, maxSteps: 3, closed: false, source: { type: 'state' } }],
    });
    const bad = checkWorldStep(revStep({ entityUpdates: [{ entity: 'e_dead', field: 'status', value: 'retired', cause: { type: 'event', ref: 'ev_named' } }] }), w);
    assert.equal(bad.ok, false);
    const ag = checkWorldStep(revStep({ entityUpdates: [{ entity: 'e_dead', field: 'status', value: 'active', cause: { type: 'agenda', ref: 'a_x' } }] }), w);
    assert.equal(ag.ok, false);
    assert.ok(ag.errors.some((e) => e.includes('提到他的事')), ag.errors.join('; '));
});

test('W5e：活人不能走 status 通道（status 只用来"带因复活"）', () => {
    const w = baseWorld({ events: [{ id: 'ev_named', title: 'x', source: { type: 'state' }, position: '大营', ripples: ['e_a'], closed: false }] });
    const c = checkWorldStep(revStep({ entityUpdates: [{ entity: 'e_a', field: 'status', value: 'active', cause: { type: 'event', ref: 'ev_named' } }] }), w);
    assert.equal(c.ok, false);
    assert.ok(c.errors.some((e) => e.includes('不是 dead')), c.errors.join('; '));
});

test('W5f：★因引用「已归档事件」⇒ 可以引用（2026-10-09 用户改口径；原为 TypeError 抛穿 ＋ 如实拒）', () => {
    // 病史（2026-10-08 体检实测复现）：`ref-rules.js` 的 `entityUpdates.cause` 那一格带
    //   `includeArchived: true` ⇒ **判定层放行**"引用一条已归档事件"；
    //   而这里取事件只看**热账**（`ssot.events`），归档会把 id 从热账里摘掉（`settle.js` 的
    //   `world.events = world.events.filter(...)`）⇒ `ev` 是 undefined，
    //   而下一行直接读 `ev.eventProtocol` ⇒ **TypeError**。
    //   抛出点没有 try/catch，一路抛穿 `prepareSettle`（校验发生在克隆之前）⇒ 整轮世界推进失败；
    //   自愈那条路会拿同一条提议再校验一次 ⇒ **再抛一次** ⇒ 世界停摆（不是"这一轮白跑"那么轻）。
    // ★★2026-10-09 用户改口径：**已归档的事件可以当复活的因**。用户原话（他说清了要的是什么）：
    //   「我主要是想实现多年前的某一个事件到今日还有可能影响现今的事实，所以才让能引用已经归档的事件。」
    //   ⇒ 这一支不再拒。★放开的是"因可以是旧号"，**不是**复活那把钥匙：真复活仍要过结算那一道
    //     「本 tick 必须被新落账的事点名」（`settle.js` 的 `thisTickNames`）——见下面第二段。
    const milestones = [{ id: 'm_10', span: { from: 1, to: 10 }, ids: ['ev_old'], titles: ['旧事'], links: { up: [], down: [] } }];
    const w = baseWorld({ milestones });
    const step = revStep({ entityUpdates: [{ entity: 'e_dead', field: 'status', value: 'active', cause: { type: 'event', ref: 'ev_old' } }] });
    let c;
    assert.doesNotThrow(() => { c = checkWorldStep(step, w); }, '★不许抛错（原病：TypeError 抛穿校验）');
    assert.equal(c.ok, true, `★归档事件可以当复活的因（改口径前这里被"如实拒"）：${c.errors.join('; ')}`);
    // 第二段：**复活本身**仍归那把钥匙管——本轮没有新事点他名 ⇒ 照旧不复活（口径放开 ≠ 把闸拆了）
    const r = settleTick({ ssot: baseWorld({ milestones }), step: step7({
        entityUpdates: [{ entity: 'e_dead', field: 'status', value: 'active', cause: { type: 'event', ref: 'ev_old' } }],
    }) });
    assert.equal(r.ssot.entities.find((e) => e.id === 'e_dead').status, 'dead', '★没被本轮新事点名 ⇒ 照旧不复活');
    assert.ok(r.stage.warnings.some((x) => x.includes('本 tick 没被新落账的事点名')), r.stage.warnings.join('; '));
    // 反证：同一枚归档号作**别的字段**的因，照旧合法——判定层那条"归档事实仍可作因"不许被这一刀收窄
    const other = checkWorldStep(step7({
        entityUpdates: [{ entity: 'e_a', field: '实力', value: '金丹', cause: { type: 'event', ref: 'ev_old' } }],
    }), w);
    assert.equal(other.ok, true, `★归档事件仍可作别的字段的因：${other.errors.join('; ')}`);
});

// ============ W6 ★离场名册（复活通道的前提） ============

test('W6：死者进"离场名册"——否则模型拿不到他的 id，复活在生产上是死代码（本棒实测踩到）', () => {
    const w = baseWorld();
    const p = buildEvolutionPack(w, null);
    const ids = (p.pack.departed || []).map((d) => d.id);
    assert.ok(ids.includes('e_dead'), '★死者必须在名册里（拿得到 id 才提得出复活）');
    assert.equal(p.pack.entities.some((e) => e.id === 'e_dead'), false, '死者仍不进演化上下文（死亡不因此消失）');
    assert.deepEqual(Object.keys(p.pack.departed[0]), ['id', 'name'], '★只报 id+name——零新事实（不报 status 是给别人看的）');
});

test('W6b：没有离场者 ⇒ 名册为空（恒为数组，与 idleFaces/pendingEvents 同形）', () => {
    // 本棒更正：第一版断言"整栏不出现"——与 `lens.test.js` 的**键序锁**冲突（那条锁把 pack 键集合逐字钉住）。
    //   既有先例是 `setting`：缺省 = `undefined` ⇒ **键在值为空**，不是键消失 ⇒ 本栏照此口径取"恒为数组"。
    const w = baseWorld({ entities: [{ id: 'e_a', kind: 'character', name: '甲', location: '临渊城' }] });
    const p = buildEvolutionPack(w, null);
    assert.deepEqual(p.pack.departed, [], '没有离场者 ⇒ 空数组（不塞占位、不编内容）');
});

// ★★★leg136（用户令「不要搞那么多闸了」）：**这一则随 `DEPARTED_TAIL` 作废而重造**。
//   旧前提「名册有上限」**已不成立**（上限撤了，改成"有多少给多少"）——
//   照本仓那条纪律（leg135 §2.4）：**上限改了而夹具不改 ⇒ 用例会静默失去意义**。
//   新前提（仍然咬得住东西）：**一个都不许少，且同输入两次出包逐字节一致**。
test('W6c：离场名册**不封顶**（有多少给多少；原 DEPARTED_TAIL 已作废），且确定性', () => {
    const N = 25;   // ★故意比旧上限（20）多 5 个：旧口径下这一则量的是"截断"，新口径下量的是"一个不落"
    const many = Array.from({ length: N }, (_, i) => ({ id: `e_d${i}`, kind: 'character', name: `亡${i}`, status: 'dead', lastActiveTick: i }));
    const w = baseWorld({ entities: many });
    const a = buildEvolutionPack(w, null).pack.departed;
    const b = buildEvolutionPack(w, null).pack.departed;
    assert.equal(a.length, N, `离场者 ${N} 个 ⇒ 名册里就是 ${N} 个（不封顶）`);
    assert.equal(DEPARTED_TAIL, Infinity, '常量本身如实标着"已作废"');
    assert.deepEqual(a, b, '同输入两次出包一致（无随机）');
});

test('W6d：复活之后，他重新出现在演化上下文里（复活不是"账上改了但还是看不见"）', () => {
    const w = baseWorld({ events: [{ id: 'ev_named', title: '遗蜕现世', source: { type: 'state' }, position: '大营', ripples: ['e_dead'], closed: false }] });
    const r = settleTick({ ssot: w, step: revStep() });
    const p = buildEvolutionPack(r.ssot, null);
    assert.ok(p.pack.entities.some((e) => e.id === 'e_dead'), '★活人进演化上下文');
    assert.equal((p.pack.departed || []).some((d) => d.id === 'e_dead'), false, '名册里不再有他');
});

// ============ W7 ★★★leg112：上限已撤（反向对照） ============
// ★这一格**原来是它的反面**（"超上限 ⇒ 拒，世界的连续性靠变得慢"）。用户 2026-09-22 拍板
//   「我认为直接取消上限」⇒ 两条用例**反过来**：现在**多条必须全部落账**。
// ★为什么这条值得留（而不是删掉）：它现在守的是"**有人把上限加回来**"——那正是本仓的老病
//   （一个没量过的提案数字在生产里当家、而且是静默拦的）。撤前实测读数见 `check-step.js` 那一格留档。

test('W7 ★leg112：一轮提 8 条字段变更 ⇒ 全部放行、全部落账（上限已撤）', () => {
    const w = baseWorld({ events: [{ id: 'ev_1', title: 'x', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    const many = Array.from({ length: 8 }, (_, i) => upd({ field: `f${i}`, value: `v${i}` }));
    const c = checkWorldStep(step7({ entityUpdates: many }), w);
    assert.equal(c.ok, true, `★上限已撤 ⇒ 8 条不许被拒：${c.errors.join('; ')}`);
    // ★"放行"还不够——必须真的**落进账**（本仓最忌"校验放行了、落账那一步悄悄丢"）
    const r = settleTick({ ssot: w, step: step7({ entityUpdates: many }) });
    const e = r.ssot.entities.find((x) => x.id === 'e_a');
    for (let i = 0; i < 8; i += 1) assert.equal(e[`f${i}`], `v${i}`, `第 ${i} 条必须真的写进账`);
    const rec = r.ssot.meta.entityFields.e_a.fields;
    assert.equal(Object.keys(rec).length, 8, '★八条变更必须各留一条痕（原值+现值同时在场）');
});

test('W7b ★leg112：同一实体**同一字段**一轮内仍不许重复提议（撤的只是条数，不是"一条变更一个因"）', () => {
    const w = baseWorld({ events: [{ id: 'ev_1', title: 'x', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    const dup = [upd({ field: '实力', value: '金丹' }), upd({ field: '实力', value: '元婴' })];
    const c = checkWorldStep(step7({ entityUpdates: dup }), w);
    assert.equal(c.ok, false, '★同一人同一栏一轮改两次仍要拒（否则"一条变更一个因"就破了）');
    assert.ok(c.errors.some((e) => e.includes('重复提议')), c.errors.join('; '));
});

test('W7c ★leg112：非数组仍然拒（撤的是条数上限，形状判据一条没动）', () => {
    const w = baseWorld();
    assert.equal(checkWorldStep(step7({ entityUpdates: 'nope' }), w).ok, false, '★不是数组必须拒');
    assert.equal(checkWorldStep(step7({ entityUpdates: [] }), w).ok, true, '★空数组合法（= 本轮没有变更）');
    assert.equal(checkWorldStep(step7(), w).ok, true, '★整组缺席也合法（可选组）');
});

// ============ W8 ★可选组（本棒踩过的那个坑，锁死防复发） ============

test('W8：★只有七组的老步照常合法——新两组**缺席 = 本轮没有这件事**，不是形状错误', () => {
    const w = baseWorld();
    const c = checkWorldStep(step7(), w);
    assert.equal(c.ok, true, `七组步必须过检（本棒第一版把它写成"非数组即拒" ⇒ 132 条既有用例全红）: ${c.errors.join('; ')}`);
    assert.equal(validate(step7(), worldStepSchema).ok, true, 'schema 层同样放行（两组不在顶层 required）');
});

test('W8b：schema 顶层 required 仍是那七组（必填组省键＝形状不合法，这条不许被这次改动放松）', () => {
    assert.deepEqual(worldStepSchema.required,
        ['actions', 'newEvents', 'agendaAdvances', 'newAgendas', 'agendaCancels', 'newEntities', 'entityFates'],
        '七组必填口径不变（entityUpdates 是可选的）');
    assert.ok(worldStepSchema.props.entityUpdates, 'entityUpdates 已在 props 里注册');
    assert.equal(worldStepSchema.props.fieldQueries, undefined,
        '★fieldQueries 已撤（"模型主动查"改成"出包前检索注入"——见 W9 组；别让它回潮）');
});

test('W8c：世界过 SSOT schema（`meta.entityFields` 的形状合法）——留痕不破坏账本', () => {
    const w = baseWorld({ events: [{ id: 'ev_1', title: 'x', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    const r = settleTick({ ssot: w, step: step7({ entityUpdates: [upd()] }) });
    const v = validate(r.ssot, ssotSchema);
    assert.equal(v.ok, true, `SSOT 必须合法: ${v.errors?.join('; ')}`);
});

// ★★W11：**出处双源**（丙′ 案的核心一格）——"书里怎么说"与"后来怎么变"**同时在场、互不覆盖**
//   为什么必须有它：模型改了 `parent` 之后，`parentSourceFrom` 还写着 `member-line`（"书里成员行列了他"）就**不实了**。
//   解法不是让模型去改发票（那等于伪造出处），而是**引擎按变更追加一条带因的记录**：
//     · 查书那条路 → `meta.entityFields[id].fields[f].source === '书里原话'`（发票）
//     · 模型变更这条路 → `source === '变更'` + `cause`（因哪件事）+ `prev`（原值）
test('W11：改 parent 之后，账上同时留着"书里原话"与"这次变更的因"（发票只增不改）', async () => {
    const { applyLookup } = await import('../src/entity-lookup.js');
    // ① 先照"查书"那条路落一份出处（发票）
    const w1 = baseWorld();
    const looked = applyLookup({
        ssot: w1, ids: ['e_a'], byName: { 甲: { 实力: '筑基' } },
        sources: { e_a: ['甲条'] }, tick: 1, fields: ['实力'],
    }).ssot;
    assert.equal(looked.meta.entityFields.e_a.fields.实力.source, '书里原话', '查书进来的是"书里原话"（发票）');

    // ② 再让模型改同一个字段（因一件具体的事）
    looked.events = [{ id: 'ev_1', title: '血战', source: { type: 'state' }, position: '大营', ripples: [], closed: false }];
    const r = settleTick({ ssot: looked, step: step7({ entityUpdates: [upd({ field: '实力', value: '金丹' })] }) });
    assert.equal(r.ok, true);
    const rec = r.ssot.meta.entityFields.e_a.fields.实力;
    assert.equal(rec.value, '金丹', '现值是变更后的');
    assert.equal(rec.source, '变更', '★这条记录标"变更"（不是"书里原话"）');
    assert.equal(rec.prev, '筑基', '★原值（书里那个"筑基"）没丢');
    assert.equal(rec.cause, 'ev_1', '★追得到是哪件事让它变的');
    // ③ ★发票没丢：查书那条记录**整条压进 `prior`**（本棒实测抓出的真问题：第一版直接覆盖 ⇒ 发票真丢了）
    assert.ok(rec.prior, '★上一版记录必须留着（"发票只增不改"）');
    assert.equal(rec.prior.source, '书里原话', '★压栈的正是查书那条（书里怎么说）');
    assert.equal(rec.prior.value, '筑基', '它记的值也还在');
    assert.equal(rec.prior.from, '甲条', '连"从哪条抄的"都在');
    // ④ 两源同时在场、互不覆盖：现值来自变更（带因），历史来自书里（带条目名）
    assert.equal(rec.source, '变更');
    assert.equal(rec.prior.source, '书里原话');
});

test('W11b：同一栏被改两次 ⇒ 现值是最后那次，且每次都能追到自己的因', () => {
    const w = baseWorld({
        events: [
            { id: 'ev_1', title: '第一次', source: { type: 'state' }, position: '大营', ripples: [], closed: false },
            { id: 'ev_2', title: '第二次', source: { type: 'state' }, position: '大营', ripples: [], closed: false },
        ],
    });
    const r1 = settleTick({ ssot: w, step: step7({ entityUpdates: [upd({ value: '金丹', cause: { type: 'event', ref: 'ev_1' } })] }) });
    const r2 = settleTick({ ssot: r1.ssot, step: step7({ entityUpdates: [upd({ value: '元婴', cause: { type: 'event', ref: 'ev_2' } })] }) });
    const rec = r2.ssot.meta.entityFields.e_a.fields.实力;
    assert.equal(rec.value, '元婴', '现值 = 最后一次');
    assert.equal(rec.prev, '金丹', '★原值 = 上一次的现值（链条没断）');
    assert.equal(rec.cause, 'ev_2', '这次变更是"第二次"那件事引起的');
});
// ============ W9 ★★★「世界书检索注入」**已拆**（leg122 · 用户令「所以才需要拆」） ============
//   ★这一族的定位变了：原来量的是"那条接线活着"，现在量的是"**它没回来**"。
//   ★机制当年长什么样（留档，别再请回来）：我曾做成 `fieldQueries` = 模型点名、结算后检索、**下一轮**回灌，
//   用户 2026-09-13 当场问穿：「为什么聊天 llm 能够直接获取想要的世界书内容呢还能通过向量化搜索直接在插件里搜到呢
//   都是一轮解决的啊」⇒ 改成 `recall.js`：**出包前检索、命中原文随包当轮递**（＋ `pack.recalled` 键）。
//
//   ★★**拆它的两条实测理由**（leg122 在真账上量的，全文在 `src/tick.js` 的 `runTick` 前那一大段）：
//     ① **它从来没检索到世界书**：召回那 1783 字与世界书 `大荒-姬元真.json`（30.5 万字）的
//        6/8/10-gram 覆盖率 **0.00%**（4-gram 1.18% ≈ 噪声，与 leg35 2026-09-13 的读数逐字相同）；
//        名字上更直白：黄坤/万子明/薛铁衣在世界书里 **0 次**、在召回段里 **22/10/11 次**。
//     ② 它命中的全是**这份聊天自己的自动总结**（来源 `大荒z - 2026-09-01… #12/#9/#10`）——
//        而"存聊天总结"**本来就是记忆插件（yuzuki-Memory）的活儿** ⇒ 我们把别人的活干重了，
//        还把台头写成「**世界书**·…**逐字摘自世界书**」（`src/recall.js:127`）——**那句话是假的**。
//
//   ★★★leg125：那时"留着没撤"的 `src/recall.js` **模块本身也撤了**（用户令「我说了解耦就解耦，直接删了」
//     ＋「一个插件偏要给一个特定的插件留个通道干嘛」）——它是**借柚月の记忆的向量库**那条腿。
//     ⇒ 它那几条**纯函数判据**（W9c/W9d/W9e/W12/W12b/W12c）随模块一起删除；
//     ★而"**它没回来**"这组反向锁（W9/W9b/W9f/W9g/W9i/W9j/W12d）**一条没动**——它们只经 `runTick`，
//      断言的正是"注进活的检索器也不许被调、更不许进提示词"，比删模块以前更该留着。

test('W9：★已拆——账上留着的旧注入文本**不许**再漏进包（拆了就别回来）', () => {
    const w = baseWorld();
    // ★诱饵：真账上就留着旧机制写下的那份（1783 字）——引擎不再读它，**也不顺手删**（留档）
    w.meta.recalledText = '【世界书·按本回合上下文检索到的原文片段】\n〔1〕出自 大荒-姬元真.json #7\n昆仑道宫：西极昆仑山上的道门，主修太清一脉。';
    const p = buildEvolutionPack(w, null);
    assert.equal(p.text.includes('昆仑道宫：西极昆仑山上的道门'), false, '★旧注入文本不许出现在**发出去**的文本里');
    assert.equal('recalled' in p.pack, false, '★包里不许再有 `recalled` 键');
    assert.equal(w.meta.recalledText.includes('昆仑道宫'), true, '★账上那份**原样不动**（引擎不读它、也不替玩家删账）');
});

test('W9b：没检索到 ⇒ 包里不留这一段（空着就是空着，不写空壳）', () => {
    const p = buildEvolutionPack(baseWorld(), null);
    assert.equal('recalled' in p.pack, false, '没检索到就不留键');
});

// ★★★leg125：W9c / W9d / W9e 三条（`collectRecallQuery` · `recallWorldBook` · `recallTextOf` 的纯函数判据）
//   已随 `src/recall.js` 整块删除——那条腿借的是柚月の记忆的向量库，全仓已无消费者。

// ★★W9f（**已反向**）：原来是"接线——`runTick` 在出包前检索、主调用当轮就看得见书里原文"。
//   拆掉之后这条判据的**同一份装置**正好用来咬反面：注进一个**活的**检索器，它**一次都不该被调**。
test('W9f：★接线已拔——注进**活的**检索器也不许被调、更不许进提示词（拆了就别回来）', async () => {
    const { runTick } = await import('../src/tick.js');
    const w = baseWorld({ events: [{ id: 'ev_1', title: '大营起事', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    let seenPackText = null;
    let called = 0;
    const store = { search: async () => { called += 1; return [{ text: '昆仑道宫：西极昆仑山上的道门，主修太清一脉。', source: '大荒-姬元真.json #7', score: 0.9 }]; } };
    const res = await runTick({
        transport: async (prompt) => { seenPackText = String(prompt); return { text: JSON.stringify(step7()) }; },
        ssot: w, dialogue: '', extractCtx: {}, recallStore: store,
    });
    assert.equal(res.ok, true, JSON.stringify(res.error));
    assert.equal(called, 0, '★接线拔了：检索器**一次都不该被调**');
    assert.equal(seenPackText.includes('昆仑道宫：西极昆仑山上的道门'), false, '★书里原文不许再进主调用的提示词');
    assert.equal(seenPackText.includes('大荒-姬元真.json #7'), false, '★出处也不许再进');
    assert.equal('recalled' in res.pack, false, '★包里不许再有 `recalled` 键');
});

test('W9g：接线零阻塞——检索器抛错时 runTick 照常跑完一轮（世界推进优先）', async () => {
    const { runTick } = await import('../src/tick.js');
    const w = baseWorld({ events: [{ id: 'ev_1', title: '事', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    let seenPackText = null;
    const res = await runTick({
        transport: async (prompt) => { seenPackText = String(prompt); return { text: JSON.stringify(step7()) }; },
        ssot: w, dialogue: '', extractCtx: {},
        recallStore: { search: async () => { throw new Error('检索器炸了'); } },
    });
    assert.equal(res.ok, true, '★检索炸了也要照常推进');
    assert.equal(seenPackText.includes('世界书·按本回合上下文检索'), false, '没检索到就不留那一段');
});

test('W9h：recall:false ⇒ 完全不检索（给不需要它的调用方留的零扰动开关）', async () => {
    const { runTick } = await import('../src/tick.js');
    const w = baseWorld({ events: [{ id: 'ev_1', title: '事', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    let called = 0;
    const res = await runTick({
        transport: async () => ({ text: JSON.stringify(step7()) }),
        ssot: w, dialogue: '', extractCtx: {}, recall: false,
        recallStore: { search: async () => { called += 1; return []; } },
    });
    assert.equal(res.ok, true);
    assert.equal(called, 0, 'recall:false 时一次都不调检索器');
    assert.equal('recalled' in (res.ssot.meta || {}), false, '也不留痕');
});

// ★★W9i：**不许跨轮残留**（本棒自查抓出的真漏洞）
//   病灶：`injectWorldBookRecall` 在"检索器不可用"时**提前 return** ⇒ 跳过了清空那一步
//   ⇒ 上一轮检索到的书片段会**一直挂在账上**，往后每轮都当"本轮检索结果"注入给模型（过期内容冒充新检索）。
//   ★这正是我刚撤掉的那套设计（"跨轮存待办"）最容易犯的错——换成正路之后**同一类坑还得自己防**。
test('W9i：检索不可用 ⇒ 必须清掉上一轮的注入文本（不许过期书冒充本轮检索）', async () => {
    const { runTick } = await import('../src/tick.js');
    const w = baseWorld({ events: [{ id: 'ev_1', title: '事', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    w.meta.recalledText = '【世界书·按本回合上下文检索到的原文片段】\n〔1〕出自 旧书 #1\n这是上一轮检索到的旧内容。';
    let seenPackText = null;
    const res = await runTick({
        transport: async (prompt) => { seenPackText = String(prompt); return { text: JSON.stringify(step7()) }; },
        ssot: w, dialogue: '', extractCtx: {}, recallStore: null,   // 本轮没有检索器
    });
    assert.equal(res.ok, true);
    assert.equal(seenPackText.includes('这是上一轮检索到的旧内容'), false, '★上一轮的书不许出现在这一轮的包里');
    assert.equal(seenPackText.includes('世界书·按本回合上下文检索'), false, '整段都不该在');
});

test('W9j：★已拆——引擎不再写"这一轮检索了什么"那格读数（`meta.recalled` 不再产生）', async () => {
    const { runTick } = await import('../src/tick.js');
    const w = baseWorld({ events: [{ id: 'ev_1', title: '事', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    w.meta.recalledText = '旧内容甲';
    let seenPackText = null;
    const res = await runTick({
        transport: async (prompt) => { seenPackText = String(prompt); return { text: JSON.stringify(step7()) }; },
        ssot: w, dialogue: '', extractCtx: {},
        recallStore: { search: async () => [] },      // 检索器活着（但已经没人调它了）
    });
    assert.equal(res.ok, true);
    assert.equal(seenPackText.includes('旧内容甲'), false, '★旧内容不许顶上来');
    assert.equal('recalled' in (res.ssot.meta || {}), false, '★引擎不再写检索读数（机制已拆，自证面随之取消）');
});

// ============ W12 ★「往事标记」（leg35 实机自验抓出，用户令修） ============
//   病灶（真账 tick 59 + 真 embedding + 真模型 5 轮量出来的）：检索**真跑了**（6 段全过门槛），
//   但召回原文是**开局那几轮的会话总结**（自带 19021年05月05日 这类日期），而账上**一点时间信息都没有**
//   （meta 只有 tick）⇒ 模型没有任何机械手段知道那是 59 轮前的旧事。
//   原文台头只写一句「不是新发生的事」——那是**形容词**，读不出"多久以前"。
//   ⇒ 改成**机械标记**：把片段里真读出来的时间原样列出来 + 写明位于本回合位序之前；
//     并立一条红线：**没读出时间就不许编时间**（报位序，不报年份）。

// ★★★leg125：W12 / W12b / W12c（`timeMarksOf` · `recallTextOf` 的判据）已随 `src/recall.js` 删除。
//   ★但"往事标记"这条经验**没有丢**：它现在是**编年行上的 `elapsed` 一格**（leg115 起，
//     `src/tick.js` 盖、`src/ledger-recall.js` 取、注入与阅卷两处都看得到）——判据在
//     `test/ledger-recall.test.js`（L6/L18/L19）与 `test/render.test.js`。

test('W12d：★接线已拔——"往事标记"不再进提示词（它随检索注入那条线一起拆了）', async () => {
    const { runTick } = await import('../src/tick.js');
    const w = baseWorld({ events: [{ id: 'ev_1', title: '事', source: { type: 'state' }, position: '大营', ripples: [], closed: false }] });
    let seenPackText = null;
    const res = await runTick({
        transport: async (prompt) => { seenPackText = String(prompt); return { text: JSON.stringify(step7()) }; },
        ssot: w, dialogue: '', extractCtx: {},
        recallStore: { search: async () => ([{ text: '主线总结（1） 19021年05月05日,08:00-08:30 [青竹村土地庙] 黄坤蜷缩在供桌底。', source: '大荒z - 2026 #1', score: 0.9 }]) },
    });
    assert.equal(res.ok, true);
    assert.equal(seenPackText.includes('19021年05月05日,08:00-08:30'), false, '★检索回来的日期不许再进提示词');
    assert.equal(seenPackText.includes('世界书·按本回合上下文检索'), false, '★整段都不该在');
});
