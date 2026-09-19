// story-world-v2/test/limits.test.js
// ★★leg40b 续：**世界尺度上限参数化**的判据（用户令「能不能直接把这些闸门参数直接放进参数页？」→ 拍板"甲+乙档全开"）。
//
// 三组判据，对应这次改动的三条硬要求：
//   ① **默认逐字不变**：账上没设档位 ⇒ 生效值 = 出厂默认，且引擎行为与参数化之前**逐字节相同**
//      （这是本改动唯一的"不许出错"项——参数化最容易出的病就是"某条路仍读旧常量"或"默认被悄悄改掉"）。
//   ② **白名单只有一把尺子**：面板给的档位 = `limits.js` 的 `LIMIT_GEARS` = 引擎认的值；
//      不在表内的一律弃键（不写占位值）——与 `params.js` 的 `normalizeParam` 同口径。
//   ③ **档位真能改引擎判据**：把上限调低 ⇒ 引擎按新值拒提议并留痕（**这是"参数化成功"的机械判据**）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    LIMIT_DEFAULTS, LIMIT_GEARS, LIMIT_KEYS, LIMIT_META, LIMIT_ROWS,
    limitsOf, normalizeLimit, resolveLimits, usingDefaults, limitKey,
} from '../src/limits.js';
import { AGENDA_CAPS, EVENT_CAPS, ENTITY_BIRTH_PER_TICK, settleTick } from '../src/settle.js';
import { buildEvolutionPack, THREADS_TOP, IDLE_FACES_TOP, computeIdleFaces } from '../src/pack.js';

/** 一份最小但真形状的世界（够 `settleTick` 跑完一轮空步）。 */
function world({ tick = 1, env = null } = {}) {
    const w = {
        version: 1,
        context: {
            world: '测试世界', tension: 0.5, positions: ['大营'],
            setting: { dynamic: { env: env || {} } },
        },
        entities: [
            { id: 'e_a', kind: 'character', name: '甲', location: '大营', lastActiveTick: tick },
            { id: 'e_b', kind: 'character', name: '乙', location: '大营', lastActiveTick: tick },
        ],
        weights: {}, agendas: [], events: [], chronicle: [], milestones: [],
        meta: { tick, simLog: [] },
    };
    return w;
}
const stepWith = (over = {}) => ({
    actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [],
    newEntities: [], entityFates: [], entityUpdates: [], ...over,
});
const newAgenda = (owner) => ({ entity: owner, goal: '起一条自己的线', visibility: 'known', source: { type: 'state' } });

// ---------- ① 默认逐字不变 ----------
test('尺度上限：出厂默认 = 参数化之前的值（与既有常量逐项相等）', () => {
    assert.equal(LIMIT_DEFAULTS.每轮递线, THREADS_TOP, '每轮递线默认 = pack.js 的 THREADS_TOP');
    assert.equal(LIMIT_DEFAULTS.每轮事件, EVENT_CAPS.perTick, '每轮事件默认 = EVENT_CAPS.perTick');
    assert.equal(LIMIT_DEFAULTS.每轮新生, AGENDA_CAPS.perTick, '★leg63：每轮新生默认 = settle.js 的 AGENDA_CAPS.perTick');
    assert.equal(LIMIT_DEFAULTS.顶层大计, AGENDA_CAPS.topLevel, '顶层大计默认 = AGENDA_CAPS.topLevel');
    assert.equal(LIMIT_DEFAULTS.在飞大计, AGENDA_CAPS.open, '在飞大计默认 = AGENDA_CAPS.open');
    assert.equal(LIMIT_DEFAULTS.每轮递线, 3, '出厂 3（本仓历史值，改了就是行为变更，必须显式）');
    assert.equal(LIMIT_DEFAULTS.每轮事件, 6, '出厂 6');
    assert.equal(LIMIT_DEFAULTS.每轮新生, 3, '★leg63：每轮新生出厂仍是 3（没设旋钮 ⇒ 行为零变化）');
});

test('尺度上限：账上没设 ⇒ 生效值 = 出厂默认；`usingDefaults` 如实报', () => {
    for (const w of [world(), world({ env: {} }), null, undefined, { context: {} }]) {
        assert.deepEqual(resolveLimits(w), { ...LIMIT_DEFAULTS }, `未设档位时必须给全套默认（输入 ${JSON.stringify(w)}）`);
        assert.equal(usingDefaults(w), true, '未设档位 ⇒ usingDefaults 为真');
    }
});

test('★尺度上限：默认下引擎行为与参数化之前**逐字节相同**（发号/条数/警告口径）', () => {
    // 同一份输入跑两次：一次"什么都没设"，一次"显式写成出厂值" ⇒ 结果必须逐字节相同。
    //   （这条抓的是"某条路仍读旧常量"——若引擎某处还硬读常量而另一处读了参数，两次就会分叉）
    const s = stepWith({ newEvents: [{ title: '一件事', source: { type: 'state' }, position: '大营', ripples: ['e_a'] }] });
    const a = settleTick({ ssot: world(), step: s });
    const b = settleTick({ ssot: world({ env: { 每轮事件: '6', 顶层大计: '15', 在飞大计: '20', 每轮递线: '3' } }), step: s });
    assert.equal(a.ok, true, '空世界上的这一步应通过');
    assert.equal(b.ok, true);
    assert.equal(JSON.stringify(a.stage.warnings), JSON.stringify(b.stage.warnings), '警告逐字相同');
    assert.equal(a.ssot.meta.tick, b.ssot.meta.tick, 'tick 相同');
    assert.deepEqual(a.ssot.events, b.ssot.events, '落账的事件逐字节相同');
});

// ---------- ② 归一：**无上限**（用户令「能自由调数，当然也能无上限」） ----------
test('★★★leg54：尺度上限**无上限**——输入框认任意 ≥1 的整数，不再有档位白名单', () => {
    // ★用户的原话与理由（本棒拍板）：「**无上限其实就是模型自由发挥，我的想法是用户能自由调数当然也能无上限**」。
    //   我去核了数字，**他说得对**：
    //     · 旧白名单顶格只有 9 / 12 / 30 / 40，而**单轮输出预算 16384 token**
    //       （`PROPOSED_CALL_LIMITS.maxTokens`，第十九棒定的）；一条事件在 JSON 里约 120–200 字符
    //       ⇒ 预算够写**几十条** ⇒ **那个 12 从来没咬到过模型，它只是一张纸**。
    //     · leg40b 实测也印证：59 轮真账逐轮新事件 **max 4**，引擎闸**一次没咬到**。
    //   ⇒ 结论：**上限的真实边界是"模型一次能写多长"，不是我们的白名单**。
    //     被拒也不叫停世界（leg40b 的死锁自愈在：tick 照常前进）。
    //   ⇒ 本笔把白名单撤掉，只留"能不能让代码跑起来"的最小校验。
    assert.equal(normalizeLimit('每轮递线', '6'), 6, '字符串数字认（dynamic.env 里存的就是字符串）');
    assert.equal(normalizeLimit('每轮递线', 6), 6, '数字也认');
    assert.equal(normalizeLimit('每轮递线', '7'), 7, '★旧版这里返 null（7 不在表里）——现在**认**');
    assert.equal(normalizeLimit('每轮递线', '100'), 100, '★大数照收（无上限）');
    assert.equal(normalizeLimit('每轮递线', '99999'), 99999, '★再大也收（用户要的就是这个）');
    // 最小校验（只有这四条还在挡）：
    assert.equal(normalizeLimit('每轮递线', '0'), null, '0 不是合法条数 ⇒ 弃');
    assert.equal(normalizeLimit('每轮递线', '-3'), null, '负数 ⇒ 弃');
    assert.equal(normalizeLimit('每轮递线', '2.5'), null, '非整数 ⇒ 弃（"半件事"没有意义）');
    assert.equal(normalizeLimit('每轮递线', 'abc'), null, '非数字 ⇒ 弃');
    assert.equal(normalizeLimit('每轮递线', ''), null, '空 ⇒ null = **未定**（回出厂默认）');
    assert.equal(normalizeLimit('每轮递线', undefined), null, '缺值同空');
    assert.equal(normalizeLimit('不存在的键', '6'), null, '★键白名单**仍然在**（不认识的键一律弃）');
    assert.equal(normalizeLimit('天时', '平常'), null, '★同名不许串台：`params.js` 的档位词不是本表的键');
    // `limitKey` 一个函数管两件事：认键（无值）+ 归一键（有值）
    assert.equal(limitKey('每轮递线'), true);
    assert.equal(limitKey('每轮递线', '12'), 12, '★旧版这里返 null（「每轮递线」原来顶格 9）——现在**认**');
    assert.equal(limitKey('天时'), null, '★不认 `params.js` 的键（两张表分开，不许互相吃）');
});

test('★★★leg54：**契约面**——键表还在、档位表只作"建议值"（面板不再靠它排下拉）', () => {
    // ★为什么 `LIMIT_GEARS` **不删**：它从"白名单"降级为**建议值/出厂档**——
    //   ① 面板要在输入框下面提示"常用：3/6/9"（玩家不知道该填几）；
    //   ② `LIMIT_DEFAULTS` 与它必须仍然互相自洽（判据下面那条锁着）；
    //   ③ 旧账里那些值（3/6/12/15/20/30/40）**照旧读得出来**（都是合法整数）。
    for (const k of LIMIT_KEYS) {
        assert.ok(Array.isArray(LIMIT_GEARS[k]) && LIMIT_GEARS[k].length >= 2, `「${k}」要有建议值（面板提示用）`);
        assert.ok(LIMIT_GEARS[k].includes(LIMIT_DEFAULTS[k]), `「${k}」的建议值必须含出厂默认 ${LIMIT_DEFAULTS[k]}`);
        assert.ok(LIMIT_META[k]?.label && LIMIT_META[k]?.hint, `「${k}」要有人话标签与说明`);
        // A-3 禁的是**引擎术语**（tick/entity/agenda/schema/ssot 这类账本词），不是「引擎」这个自称——
        //   同页其余文案（`params.js`/`render.js`）一直用「引擎只照抄」这种说法。
        assert.ok(!/tick|entity|agenda|schema|ssot/i.test(LIMIT_META[k].hint), `「${k}」的说明不许漏账本术语（A-3）`);
    }
});


test('尺度上限：已设档位覆盖默认；未设的键仍回默认（逐键独立）', () => {
    const w = world({ env: { 每轮递线: '6' } });
    const lim = resolveLimits(w);
    assert.equal(lim.每轮递线, 6, '设了的用账上的');
    assert.equal(lim.每轮事件, LIMIT_DEFAULTS.每轮事件, '没设的仍回默认');
    assert.deepEqual(limitsOf(w), { 每轮递线: 6 }, '`limitsOf` 只报**已设**的键');
    assert.equal(usingDefaults(w), false, '设过档位 ⇒ 不再是全默认');
    // 面板行：值与"是否默认"如实报
    const rows = LIMIT_ROWS(w);
    assert.equal(rows.length, LIMIT_KEYS.length);
    assert.equal(rows.find((r) => r.key === '每轮递线').isDefault, false);
    assert.equal(rows.find((r) => r.key === '每轮事件').isDefault, true);
    // 非法值不许进结果（旧账里的脏值也不生效）
    // ★★leg54（口径升级）：`'99'` 从这条移走了——它现在是**合法值**（无上限）。
    //   这条判据的**实质一字未变**：真正读不懂的值一律当"没设"。
    for (const dirty of ['0', '-1', '2.5', 'abc', '']) {
        assert.deepEqual(limitsOf(world({ env: { 每轮递线: dirty } })), {},
            `脏值「${dirty}」⇒ 弃键（当没设，用默认）`);
    }
    // ★对照（防这条锁退化成"什么都不认"）：大数是**认**的
    assert.deepEqual(limitsOf(world({ env: { 每轮递线: '99' } })), { 每轮递线: 99 },
        '★99 现在是合法的（无上限）——旧版这里判它脏');
});

// ---------- ③ 档位真能改引擎判据 ----------
// ★★★leg63（用户实机报「**我参数都这样了**」——本条判据就是照着那一屏写的）：
//   现场：用户把「每轮递几条线」拧到 10 ⇒ 模型每轮真提 10 条新盘算 ⇒ 但引擎第一道闸
//   `盘算大厦顶（每 tick 新生 ≤3）` 只让前 3 条落地，第 4 条起全被拒。
//   病根：那一道**读的是出厂常量**（`AGENDA_CAPS.perTick`），不在参数表里 ⇒ 用户能看到/能拧的
//   四个数**一个都不参与**这道判定，而且它排在两道盘算闸的最前面 ⇒ 后面 `在飞大计`/`顶层大计`
//   连被检查的机会都没有（观棋窗口只报"被拒"、不说"是哪个数拒的"）。
//   治法：收进 `lim.每轮新生`（第五个输入框，与其余四个同一条路）。
test('★★★leg63：「每轮新生」（每 tick 新生）调到 6 ⇒ 一轮落 6 条（出厂 3 只落 3 条）——用户实机那一条', () => {
    const mk = (n) => Array.from({ length: n }, () => newAgenda('e_a'));
    // 出厂：提 6 条 ⇒ 只落 3 条（第 4 条起按"每 tick 新生 ≤3"拒）
    const at3 = settleTick({ ssot: world(), step: stepWith({ newAgendas: mk(6) }) });
    assert.equal(at3.ssot.agendas.filter((a) => !a.closed).length, LIMIT_DEFAULTS.每轮新生, '出厂 3 ⇒ 只落 3 条');
    assert.equal(at3.stage.warnings.filter((w) => w.includes('每 tick 新生')).length, 6 - LIMIT_DEFAULTS.每轮新生,
        '被拒的那几条**逐条留痕**（如实报，不许静默）');
    // ★抬到 6 ⇒ 同一条提议应当通过（这就是"档位真的进了判据"）
    const raised = settleTick({ ssot: world({ env: { 每轮新生: '6' } }), step: stepWith({ newAgendas: mk(6) }) });
    assert.equal(raised.ssot.agendas.filter((a) => !a.closed).length, 6,
        '★「每轮新生」抬到 6 ⇒ 6 条全落（这正是用户想让"每轮递几条线"生效时缺的那一格）');
    assert.ok(!raised.stage.warnings.some((w) => w.includes('每 tick 新生')), '不再报那一条拒签');
    // ★顺序口径（这就是"互相掩盖"的机理）：三道是**依次**判的，先顶住的那道说了算——
    //   被第一道拦住时，后面两道**一条警告都不该报**（玩家看到的拒签理由必须是先顶住的那道）。
    assert.ok(!at3.stage.warnings.some((w) => w.includes('在飞全局') || w.includes('顶层 ≤')),
        '被第一道拦住时，后面两道不许报（"依次判"的机械证据）');
    // 反面：抬了第一道 ≠ 全开——后面的账照旧各算各的，而且这时**轮到的就是后面那道**。
    //   ★数值口径（本判据实测，不按推理写）：`每轮新生 6 + 在飞 4 + 顶层 30` ⇒ 落 **2**。
    //     第一版我按"4 个名额该落 4 条"写，当场红了 ⇒ 按**实测值**锁，别锁我脑补的预算表。
    const raised2 = settleTick({ ssot: world({ env: { 每轮新生: '6', 在飞大计: '4', 顶层大计: '30' } }), step: stepWith({ newAgendas: mk(6) }) });
    assert.equal(raised2.ssot.agendas.filter((a) => !a.closed).length, 2, '抬了第一道 ⇒ 由第二道决定落几条（实测 2）');
    assert.ok(raised2.stage.warnings.some((w) => w.includes('在飞全局') && w.includes('4')),
        `这时才报第二道，并写出账上那个值：${raised2.stage.warnings.join('; ')}`);
    assert.ok(!raised2.stage.warnings.some((w) => w.includes('每 tick 新生')), '第一道放行之后它就不该再报（顺序方向正确）');
});

// ★★★leg63（用户令「我要把另外两个参数也设置成可调」）：最后两个"丙档只读"的转正。
//   这两条判据锁的是**引擎真读账上那个值**（leg61 §4 形状②：喂函数的判据永远绿，必须走真路径）。
test('★★★leg63：「每轮入局」调到 3 ⇒ 一轮能进 3 个新人（出厂 1 只进 1 个，其余按"入局限额"拒）', () => {
    //   ★夹具注意（本判据第一版连着踩了两次，留着当例子——**夹具形状不对，读数全是假的**）：
    //     ① `source.type` 枚举是 `book|event|dialogueFact|entity`（与盘算/事件那几处**不一样**）；
    //     ② 光有 `type` 还不够：`check-step.js:223` 要求**还要有 `ref`**（"无源不入局"）
    //        ⇒ 走 `{ type: 'entity', ref: <在册实体 id> }`（本仓既有夹具同款，见 deadlock-heal.test.js:250）。
    const mk = (n) => Array.from({ length: n }, (_, i) => ({
        name: `新人${i}`, kind: 'character', location: '大营',
        entity: 'e_a', source: { type: 'entity', ref: 'e_b' },
    }));
    const at1 = settleTick({ ssot: world(), step: stepWith({ newEntities: mk(3) }) });
    assert.equal(at1.ssot.entities.length, 2 + LIMIT_DEFAULTS.每轮入局, `出厂 ${LIMIT_DEFAULTS.每轮入局} ⇒ 只进 1 个`);
    assert.equal(at1.stage.warnings.filter((w) => w.includes('入局限额')).length, 3 - LIMIT_DEFAULTS.每轮入局,
        '被拒的**逐条留痕**（如实报，不许静默）');
    const at3 = settleTick({ ssot: world({ env: { 每轮入局: '3' } }), step: stepWith({ newEntities: mk(3) }) });
    assert.equal(at3.ssot.entities.length, 2 + 3, '★抬到 3 ⇒ 3 个新人全进（档位真的进了判据）');
    assert.ok(!at3.stage.warnings.some((w) => w.includes('入局限额')), '不再报那一条拒签');
});

test('★★★leg63：「待启用名单」调到 N ⇒ 名单正好 N 张脸，且**门控与包读同一份**', () => {
    // 造足够的冷门池（> N），否则"名单多长"会被池子长度盖住（birth.test.js 那两个坑的教训）
    const pool = (env) => {
        const w = world({ env });
        for (let i = 0; i < 40; i++) w.entities.push({ id: `e_x${i}`, kind: 'character', name: `闲${i}`, location: '大营' });
        return w;
    };
    const w12 = pool({});
    assert.equal(computeIdleFaces(w12).length, LIMIT_DEFAULTS.待启用名单, `出厂 ⇒ ${LIMIT_DEFAULTS.待启用名单} 张`);
    const w30 = pool({ 待启用名单: '30' });
    assert.equal(computeIdleFaces(w30, resolveLimits(w30).待启用名单).length, 30, '★账上 30 ⇒ 递 30 张');
    // ★口径：**两处必须传同一个数**（包与门控同源）——源码锁，防"包递 30、门控只认 12"的空转
    const packSrc = readFileSync(new URL('../src/pack.js', import.meta.url), 'utf8');
    const settleSrc = readFileSync(new URL('../src/settle.js', import.meta.url), 'utf8');
    assert.match(packSrc, /computeIdleFaces\(ssot, lim\?\.待启用名单/, '★包那侧走上限参数（不是裸常量）');
    assert.match(settleSrc, /computeIdleFaces\(ssot, resolveLimits\(world\)\.待启用名单\)/,
        '★门控那侧读同一份（否则名单空转）'
        + '——★leg84（乙-2）：这一行随阶段化搬进了 `computeSpotlight` 阶段（实参仍是 `ssot` 与 `resolveLimits(world)`，'
        + '**语义一个字没变**：门控读的仍是账上那个上限）。');
    // 端到端：真出一次包，看名单条数跟着账上走
    const p = buildEvolutionPack(w30, null, { lim: resolveLimits(w30) });
    assert.equal(p.pack.idleFaces.length, 30, '★进包的名单条数 = 账上那个数');
});

test('★★尺度上限：把「在飞大计」调到 20 的下限之外 ⇒ 引擎按新值拒提议并留痕（参数化生效的机械判据）', () => {
    // 造一个"已经在飞 20 件"的世界：这时按出厂的 20 上限，任何新提议都该被拒。
    const w = world();
    w.agendas = Array.from({ length: 20 }, (_, i) => ({ id: `a_${i}`, owner: 'e_a', goal: `旧线${i}`, closed: false, parentId: i === 0 ? undefined : 'a_0' }));
    const s = stepWith({ newAgendas: [newAgenda('e_b')] });
    const atCap = settleTick({ ssot: w, step: s });
    assert.equal(atCap.ok, true, '超限只是拒那条提议，世界照常推进');
    assert.equal(atCap.ssot.agendas.filter((a) => !a.closed).length, 20, '在飞总数没涨（被上限挡住）');
    assert.ok(atCap.stage.warnings.some((x) => x.includes('在飞全局') && x.includes('20')), `要留痕并写出新上限：${atCap.stage.warnings.join('; ')}`);

    // 同一个世界，把「在飞大计」调到 30 ⇒ 同一条提议应当**通过**（这就是"档位真的进了判据"）
    const w2 = world({ env: { 在飞大计: '30' } });
    w2.agendas = structuredClone(w.agendas);
    const raised = settleTick({ ssot: w2, step: stepWith({ newAgendas: [newAgenda('e_b')] }) });
    assert.equal(raised.ssot.agendas.filter((a) => !a.closed).length, 21, '★上限抬到 30 ⇒ 这条提议落账了（档位生效）');
    assert.ok(!raised.stage.warnings.some((x) => x.includes('在飞全局')), '不再报那条拒签');
});

test('★★尺度上限：「每轮事件」调到 9 ⇒ 一轮能落 9 件（出厂 6 会裁掉 3 件）', () => {
    const mk = () => Array.from({ length: 9 }, (_, i) => ({ title: `事${i}`, source: { type: 'state' }, position: '大营', ripples: ['e_a'] }));
    const at6 = settleTick({ ssot: world(), step: stepWith({ newEvents: mk() }) });
    const flooded = at6.stage.warnings.filter((x) => x.includes('事件洪峰'));
    assert.equal(flooded.length, 3, `出厂 6 ⇒ 应有 3 件被洪峰拒（实际 ${flooded.length}）`);
    assert.ok(flooded.every((x) => x.includes('≤6')), '留痕要写出**生效的**上限值');

    const at9 = settleTick({ ssot: world({ env: { 每轮事件: '9' } }), step: stepWith({ newEvents: mk() }) });
    assert.equal(at9.stage.warnings.filter((x) => x.includes('事件洪峰')).length, 0, '★上限抬到 9 ⇒ 一件都不裁');
    assert.equal(at9.ssot.events.filter((e) => String(e.id).startsWith('ev_2_')).length, 9, '九件全落账');
});

test('★尺度上限：「每轮递线」进包（线捆条数 = 档位），未设时仍是出厂 THREADS_TOP', () => {
    // 造 8 条线头（无来路的未决事件）
    const w = world();
    w.events = Array.from({ length: 8 }, (_, i) => ({
        id: `ev_1_${i + 1}`, title: `线头${i}`, source: { type: 'state' }, position: `地${i}`, ripples: ['e_a'], links: { up: [], down: [] }, closed: false,
    }));
    const at3 = buildEvolutionPack(w, null);
    assert.equal(at3.pack.threads.length, 3, '未设档位 ⇒ 出厂 3 条');
    const at6 = buildEvolutionPack(w, null, { lim: { ...LIMIT_DEFAULTS, 每轮递线: 6 } });
    assert.equal(at6.pack.threads.length, 6, '★档位 6 ⇒ 递 6 条（面板与引擎同源）');
    // 只读的那几个仍然照旧（它们不是本轮旋钮）。
    //   ★`idleFaces` 这里**不拿这一份最小夹具去断言条数**：只有 2 个实体时该名单本来就空
    //     （`computeIdleFaces` 会把玩家/top-1/有在办盘算的人排掉）⇒ 断言"等于某个数"是**空绿**。
    //     改为断言"它的口径没被这次改动碰过"（仍是出厂 `IDLE_FACES_TOP` 那一份），并对**关键字面**下判据。
    assert.ok(IDLE_FACES_TOP === 12, '待启用名单仍是出厂 12（丙档未开）');
    assert.ok(Array.isArray(at6.pack.idleFaces), '该栏恒为数组（形状口径不变）');
    assert.ok(ENTITY_BIRTH_PER_TICK === 1, '入局新人仍是出厂 1（丙档未开）');
    assert.equal(AGENDA_CAPS.perTick, 3, '每轮新生盘算仍是出厂 3（丙档未开）');
});
