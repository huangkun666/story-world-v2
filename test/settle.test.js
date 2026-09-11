// story-world-v2/test/settle.test.js
// S5 验收：结算管线按序（校验→裁定→挂链→一致性→重算→落账→编年→度量），纯函数性 + golden 世界。
//
// ===================== leg25 c 改写说明（用户令「删」四维浮点） =====================
// 兵力/权位/人脉/耳目（hardPower/office/network/intel）被整体删除——理由见 design-core-leg23 §4 第 1 条 +
//   §2.2 三条硬规矩：①手拍值比没有更坏（让"编的"看起来像"算的"）；②这几个概念没法精确表示（书里没刻度、
//   现实里也没有），压成 0–1 是拿精确外壳装模糊内容；③要有依据——没依据就空着。
// 正确表示法：书里的说法**照抄成文本**（实体 `实力` = 「T9渡劫巅峰」，据书；见 spec-entity-field-lookup），
//   引擎不换算、不进公式、不排序。
// 故本文件相应删除/改写了四块（**不是漏测**，是机制不存在了）：
//   ① 账本换血（首次正向提议记初值 / 负向无基线不收）——属性增量语义没了；
//   ② stateChanges 白名单（attr / actor）+ newEntities.attrs 白名单——契约层字段已删（改成"旧形状整步拒"，见下）；
//   ③ 属性编年（「X」兵力 0.4→0.5）+ 静默方自我增强被拒 + 薄裁定硬边界/空裁定——裁定器已不再裁属性；
//   ④ K9 影响通道（引擎独占写玩家）——它扣的就是那四维；`playerAffected` 记录结构保留（审计面），但无写入方。
// 迁移组（原"leg24 片4 迁移 / 第二十五棒修正"系列）**整体重写**为新语义：整键摘除 + 留档 + 幂等闸 `attrsRemovedAt`
//   （旧判词"逐维比旧默认值"连同其判据源一起不存在了）。
// =================================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settleTick, migrateLegacyAttrs, ATTRS_REMOVED_AT, LEGACY_ATTRS_PURGED } from '../src/settle.js';
import { checkWorldStep } from '../src/check-step.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/golden-world.min.json', import.meta.url), 'utf8'));

const validStep = () => ({
    actions: [{ entity: 'e_merchant', verb: '沿商路北上巡查', position: '商路' }],
    newEvents: [{ title: '守将允诺通关', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: ['e_merchant'] }],
    agendaAdvances: [{ agendaId: 'a_1', step: '守将首肯，车队放行', stage: '过边关' }],
    newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
});

// 空步（世界步七组：actions/newEvents/agendaAdvances/newAgendas/agendaCancels/newEntities/entityFates；
//   `stateChanges` 已从契约层删除，不再是其中一组）
const emptyStep = (more = {}) => ({
    actions: [], newEvents: [], agendaAdvances: [],
    newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    ...more,
});

// 一实体无盘算的孤岛世界（一致性检查用）；账上无数（四维已删）
const loneWorld = () => ({
    version: 1,
    context: { world: '孤岛', tension: 0.3, positions: ['孤岛'] },
    entities: [{ id: 'e_lone', kind: 'character', name: '独行客', location: '孤岛' }],
    weights: {},
    agendas: [],
    events: [{ id: 'ev_old', title: '旧事', source: { type: 'state' }, position: '孤岛', closed: true }],
    chronicle: [],
    meta: { tick: 3 },
});

test('结算：基本 tick 全管线落账', () => {
    // 旧账残留样本（自带，不依赖夹具里是否还留着四维）：引擎对它是"不读不改"——
    //   删旧账是 migrateLegacyAttrs 的活（见下方迁移组），不是结算管线的活。
    const input = structuredClone(GOLDEN);
    input.entities[0].attrs = { hardPower: 0.5, office: 0.4, network: 0.6, intel: 0.4 };
    const before = JSON.stringify(input);
    const r = settleTick({ ssot: input, step: validStep(), moveFact: { verb: '收服', object: '龙蛋' } });
    assert.equal(r.ok, true, JSON.stringify(r.stage.warnings));
    const w = r.ssot;

    assert.equal(w.meta.tick, 1, 'tick 推进');
    assert.equal(w.events.length, 1, '事件挂链');
    assert.equal(w.events[0].id, 'ev_1_1');
    assert.deepEqual(w.events[0].links.up, [], 'plot 源无上游指针');
    assert.equal(w.events[0].position, '边关');

    assert.equal(w.agendas[0].progress, 2, '盘算推进');
    assert.equal(w.agendas[0].stage, '过边关');
    assert.equal(w.agendas[0].memory.done.length, 1, '推进留痕');

    // 分量重算（leg25 c 重基线）：基础分＝层基线常数（faction 0.85 / character 1；原 1.5 被 clamp01 吸平成了
    //   纸面常量，故改 0.85——见 weight.test）。e_merchant 是 faction ⇒ 0.85 × envFactor(0.5)=1 → 0.85；
    //   本轮活跃（idle=0）→ 静止因子 1（不衰减）。**整个式子不吃属性**。
    assert.equal(w.weights.e_merchant, 0.85, `分量＝层基线(势力 0.85)×静止因子，实际 ${w.weights.e_merchant}`);
    assert.deepEqual(w.entities[0].attrs, { hardPower: 0.5, office: 0.4, network: 0.6, intel: 0.4 }, '引擎不读不改旧账残留（一字不动）');

    assert.ok(w.chronicle.length >= 2, '编年：推进 + 事件各一条');
    const evEntry = w.chronicle.find((c) => c.id === 'ch_1_ev_1');
    assert.ok(evEntry.text.includes('事件「守将允诺通关」'), '编年可读');
    assert.ok(evEntry.text.includes('由盘算「打通边关商路」而生'), '编年带因果（写名不写代号）');

    assert.equal(w.meta.simLog.length, 1, '台账记账');
    assert.ok(w.meta.simLog[0].packTokens > 0 && w.meta.simLog[0].ssotBytes > 0, '四字段有值');
    assert.deepEqual(w.meta.simLog[0].warnings, []);

    assert.equal(input.meta.tick, 0, 'tick 不写回输入');
    assert.equal(JSON.stringify(input), before, '输入不被修改（纯函数，逐字节）');
    assert.equal(GOLDEN.meta.tick, 0, '夹具本体不被触碰');
    // schema 面（leg25 c）：**不能拿故意带旧账残留的世界去校验**——`entities.attrs` 已被契约层拒收
    //   （additional:false ⇒ 未知字段），本世界是照旧账形态手搭的，被拒是"如期"不是"结算写坏了"。
    //   故拆成两段锁：①干净世界（不带残留）结算后必须全量合法；②带残留的世界**必须**被拒
    //   （防字段无声复活），且过一遍迁移后重归合法（旧账清理归 migrateLegacyAttrs，见下方迁移组）。
    const vr = validate(structuredClone(GOLDEN), ssotSchema);
    assert.equal(vr.ok, true, `结算基准世界（无残留）过 schema: ${vr.errors.join('; ')}`);
    const vrRaw = validate(w, ssotSchema);
    assert.equal(vrRaw.ok, false, '带旧账残留的世界如期被拒（attrs 不再被接受）');
    assert.ok(vrRaw.errors.some((e) => e.includes('attrs') && e.includes('未知字段')), vrRaw.errors.join('; '));
    const vrMigrated = validate(migrateLegacyAttrs(w), ssotSchema);
    assert.equal(vrMigrated.ok, true, `迁移摘除残留后重归合法: ${vrMigrated.errors.join('; ')}`);
});

// ---------- leg25 c 契约面：属性通道整条删除（旧形状整步拒 = 硬删面，不是静默忽略） ----------

test('leg25 c 契约面：世界步带 `stateChanges` → 整步拒（世界如实不动、账本零污染）', () => {
    // 旧法：stateChanges 是"模型提议的属性增量"，还要过 attr 白名单/actor 在册/边界钳制。
    //   四维删除后契约层整条删除 ⇒ 旧形状（无论带不带 cause）一律判"未知字段"。
    //   口径为何是"拒整步"而不是"忽略该字段"：与其它语义校验同款——**不许静默吞掉模型提议**，
    //   免得"提议没生效"与"提议生效了但看不出"混为一谈（账本零污染 + 世界如实不动）。
    const bad = validStep();
    bad.stateChanges = [{ entity: 'e_merchant', attr: 'network', delta: 0.05, cause: 'a_1' }];
    const r = settleTick({ ssot: GOLDEN, step: bad });
    assert.equal(r.ok, false, '带已删字段的旧形状整步被拒');
    assert.equal(r.ssot, GOLDEN, '原世界对象原样返回（一个字节都没动）');
    assert.equal(GOLDEN.meta.tick, 0, 'tick 不推进');
    assert.ok(r.stage.warnings.some((x) => x.includes('stateChanges') && x.includes('未知字段')), r.stage.warnings.join('; '));
    assert.deepEqual(r.stage.chronicle, [], '被拒的步不落一条编年');
    // 对照：不带该字段的同一条提议照常通过（拒面不误伤其余六组）
    const ok = settleTick({ ssot: GOLDEN, step: validStep() });
    assert.equal(ok.ok, true, ok.stage.warnings.join('; '));
});

test('leg25 c 契约面：newEntities 带 `attrs` → 整步拒；不带的照常入局且**不落任何数值**', () => {
    const w = loneWorld();
    w.events = [{ id: 'ev_1', title: '旧事', source: { type: 'state' }, position: '孤岛', ripples: [], closed: false }];
    const ne = (extra) => emptyStep({ newEntities: [{ name: '新客', kind: 'character', location: '孤岛', source: { type: 'event', ref: 'ev_1' }, ...extra }] });
    // ① 旧形状（带 attrs）：契约层整条删除 ⇒ 未知字段拒
    const bad = checkWorldStep(ne({ attrs: { network: 0.4 } }), w);
    assert.equal(bad.ok, false, '入局带数值提议 → 整步拒（四维不存在了）');
    assert.ok(bad.errors.some((x) => x.includes('attrs') && x.includes('未知字段')), bad.errors.join('; '));
    // ② 合法形状：照常入局
    const okStep = ne({});
    assert.equal(checkWorldStep(okStep, w).ok, true, '不带数值的入局提议照常通过');
    const r = settleTick({ ssot: w, step: okStep });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const born = r.ssot.entities.find((e) => e.name === '新客');
    assert.ok(born, '入局落账');
    assert.equal(born.attrs, undefined, '★入局不再落任何数值（"空着就是空着"；书里的说法走 `实力` 文本态）');
    const vr = validate(r.ssot, ssotSchema);
    assert.equal(vr.ok, true, vr.errors.join('; '));
});

// ---------- leg25 c：旧账里那批"引擎编的假数"一次性清理（migrateLegacyAttrs 新语义） ----------
// 历史留档（防重走）：leg24 片4 起这里有一条"逐维判旧默认值"的迁移（判"这个数是不是引擎编的"），
//   第二十五棒实机修正把它从"整行全等"改成"逐维"（旧法漏清 500 维的机理：混合行让整行判词恒假）。
//   **leg25 c 起这条判词连同它的判据源一起删除**——要判的对象整体不存在了（四维被用户令删除）。
//   判据塌成一行：这个维度还存不存在。见 src/settle.js migrateLegacyAttrs。

// 旧账夹具：三实体各持旧代码预填的四维（character 全 0.15 / faction 全 0.25）+ 一个"有据真数"实体
const legacyWorld = () => ({
    version: 1,
    context: { world: '旧账世界', tension: 0.5, positions: ['未明'] },
    entities: [
        { id: 'e_bk_1', kind: 'character', name: '白小娥', location: '未明', attrs: { hardPower: 0.15, office: 0.15, network: 0.15, intel: 0.15 } },
        { id: 'e_bk_2', kind: 'faction', name: '万法阁', location: '未明', attrs: { hardPower: 0.25, office: 0.5, network: 0.25, intel: 0.25 } },
        { id: 'e_1_1', kind: 'character', name: '真数者', location: '未明', attrs: { hardPower: 0.6, office: 0.4, network: 0.3, intel: 0.2 } },
    ],
    weights: {},
    agendas: [],
    events: [],
    chronicle: [],
    meta: { tick: 7 },
});

test('leg25 c 迁移：attrs 整键摘除 + 留档 + 一次性闸（不判"数是不是编的"，只判"维度还存不存在"）', () => {
    const input = legacyWorld();
    const before = JSON.stringify(input);
    const out = migrateLegacyAttrs(input);
    assert.equal(JSON.stringify(input), before, '输入不被修改（纯函数）');
    assert.notEqual(out, input, '有摘除 → 返回新世界（不可变风格）');
    // 判据极简：四维不存在了，账上就不该有它——**不分**是不是旧默认值、也**不分**书里有没有据
    for (const id of ['e_bk_1', 'e_bk_2', 'e_1_1']) {
        assert.equal(out.entities.find((e) => e.id === id).attrs, undefined, `${id}：attrs 整键摘除`);
    }
    assert.equal('attrs' in out.entities[0], false, '是"摘键"不是"置空对象"（键本身不许留）');
    // 留档：那些数曾经摆在面板上冒充客观（"兵力 0.15"），删掉时不许无声消失
    assert.deepEqual(out.meta[LEGACY_ATTRS_PURGED], {
        e_bk_1: { hardPower: 0.15, office: 0.15, network: 0.15, intel: 0.15 },
        e_bk_2: { hardPower: 0.25, office: 0.5, network: 0.25, intel: 0.25 },
        e_1_1: { hardPower: 0.6, office: 0.4, network: 0.3, intel: 0.2 },
    }, '被摘掉的值逐键留档（含"有据的真数"——本迁移不判真伪，一律摘）');
    assert.equal(out.meta[ATTRS_REMOVED_AT], 7, '幂等闸 = 当时 tick');
    assert.equal(out.meta.tick, 7, 'tick 不动');
});

test('leg25 c 迁移：无可摘即一字不改（原对象返回、不打闸；空 attrs 对象不算"有旧账"）', () => {
    // ① 全新世界（账上根本没有 attrs）
    const clean = loneWorld();
    assert.equal(migrateLegacyAttrs(clean), clean, '无可摘 → 原对象返回（逐字节一致）');
    assert.equal(clean.meta[ATTRS_REMOVED_AT], undefined, '无摘除即不打闸（旧账零扰动）');
    // ② 空 attrs 对象：现状按"没内容"处理——不摘键、不打闸。
    //    ⚠️ 现状锁 + 登记：空 `{}` 既不是"有旧账"，也不该在账上长留；是否连空对象一起摘，
    //       属"四维删除"的收尾待拍板项（本棒只改 test/，未擅自替源码定案）。
    const emptyAttrs = loneWorld();
    emptyAttrs.entities[0].attrs = {};
    const out = migrateLegacyAttrs(emptyAttrs);
    assert.equal(out, emptyAttrs, '空 attrs：不改一字');
    assert.deepEqual(out.entities[0].attrs, {}, '空对象原样留着（现状）');
    assert.equal(out.meta[ATTRS_REMOVED_AT], undefined, '空对象不构成"摘除发生"');
    // ③ 防御：非对象入参原样返回，不抛
    assert.equal(migrateLegacyAttrs(null), null);
    assert.equal(migrateLegacyAttrs(undefined), undefined);
});

test('leg25 c 迁移：留档并入既有 legacyAttrsPurged（历史留档不被覆盖）', () => {
    const w = legacyWorld();
    w.meta[LEGACY_ATTRS_PURGED] = { e_bk_9: { intel: 0.01 } };
    const out = migrateLegacyAttrs(w);
    assert.deepEqual(out.meta[LEGACY_ATTRS_PURGED].e_bk_9, { intel: 0.01 }, '既有留档保留原样');
    assert.deepEqual(Object.keys(out.meta[LEGACY_ATTRS_PURGED]).sort(), ['e_1_1', 'e_bk_1', 'e_bk_2', 'e_bk_9'], '本次留档并入');
});

test('leg25 c 迁移：幂等——闸在则绝不重扫（连跑三次同对象/同字节）', () => {
    const once = migrateLegacyAttrs(legacyWorld());
    const twice = migrateLegacyAttrs(once);
    assert.equal(twice, once, '第二次原对象返回（没东西可摘即不改一字）');
    assert.equal(JSON.stringify(migrateLegacyAttrs(twice)), JSON.stringify(once), '连跑三次逐字节一致');
    // ★leg25 f 语义修正：`attrsRemovedAt` **不再是"提前退出"的理由**（这一点当年是故意锁死的）。
    //   为什么改：提前退出会让"只残留 hurtWindow（或又被写回 attrs）的账"带着死字段过 schema——
    //   `ssot.schema` 的 `additional:false` 会直接拒，而那正是台账里"attrs 只删了一半"那个老洞的同款。
    //   现口径：闸只是"attrs 那一轮迁过"的**留痕**，摘除**无条件、幂等**；闸值写成"既有值优先、不覆盖"。
    const stale = legacyWorld();
    stale.meta[ATTRS_REMOVED_AT] = 2;
    const out = migrateLegacyAttrs(stale);
    assert.equal(out.entities.every((e) => e.attrs === undefined), true,
        '★闸在位也照摘：死字段不许因为"迁移过了"而留在账上（那会让 schema 拒整份文档）');
    assert.equal(out.meta[ATTRS_REMOVED_AT], 2, '闸值保留既有值（不覆盖，溯源不失真）');
    // 干净账（无 attrs 无 hurtWindow）连跑：原对象返回，逐字节不变
    const clean = { meta: { tick: 3 }, entities: [{ id: 'e_a', kind: 'character', name: '甲', location: 'x' }] };
    assert.equal(migrateLegacyAttrs(clean), clean, '无可摘 → 原对象（不空写）');
});

// 迁移后世界过 SSOT schema：**已解阻塞**（2026-09-11 后续棒）——`ssot.schema.js` 的 meta 已补声明
//   `attrsRemovedAt`（连同旧键 `legacyAttrsMigratedAt` 一并保留，防打破旧账），故原先的 skip 撤掉、真跑。
test('leg25 c 迁移：迁移后世界过 SSOT schema（meta.attrsRemovedAt 已补声明）', () => {
    const out = migrateLegacyAttrs(legacyWorld());
    assert.equal(out.meta[ATTRS_REMOVED_AT], 7, '先确认迁移真的落了闸（不然这条会退化成"什么都没发生也过"）');
    assert.equal(out.meta[LEGACY_ATTRS_PURGED] !== undefined, true, '留档键也在账上（一并过形状）');
    const vr = validate(out, ssotSchema);
    assert.equal(vr.ok, true, vr.errors.join('; '));
});

// ---------- 管线其余面（与属性无关，逐条保留） ----------

test('结算：校验不过 → 世界如实不动', () => {
    const bad = validStep();
    bad.actions[0].entity = 'e_ghost';
    const r = settleTick({ ssot: GOLDEN, step: bad });
    assert.equal(r.ok, false);
    assert.equal(r.ssot, GOLDEN, '原世界对象原样返回');
    assert.equal(GOLDEN.meta.tick, 0);
    assert.ok(r.stage.warnings.some((x) => x.includes('未知实体')));
});

test('结算：盘算满步强制结算（终结产果）', () => {
    const step = validStep();
    step.agendaAdvances = [1, 2, 3].map((n) => ({ agendaId: 'a_1', step: `推进 ${n}`, stage: `阶段${n}` }));
    const r = settleTick({ ssot: GOLDEN, step });
    assert.equal(r.ok, true);
    const a = r.ssot.agendas[0];
    assert.equal(a.progress, 4, 'maxSteps 达到');
    assert.equal(a.closed, true, '满步置关闭');
    assert.ok(r.ssot.chronicle.some((c) => c.id === 'ch_1_fin_a_1'), '终结产果入编年');
});

test('结算：行动↔盘算一致性烟雾报警（无在飞盘算仍行动）', () => {
    const step = emptyStep({ actions: [{ entity: 'e_lone', verb: '动手', position: '孤岛' }] });
    const r = settleTick({ ssot: loneWorld(), step });
    assert.equal(r.ok, true);
    assert.ok(r.stage.warnings.some((x) => x.includes('行动↔盘算不一致')), r.stage.warnings.join('; '));
});

test('结算：ripple 事件上游指针挂链', () => {
    const step = emptyStep({ newEvents: [{ title: '旧事发酵', source: { type: 'ripple', ref: 'ev_old' }, position: '孤岛', ripples: ['e_lone'] }] });
    const r = settleTick({ ssot: loneWorld(), step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.deepEqual(r.ssot.events.find((e) => e.id === 'ev_4_1').links.up, ['ev_old'], '因果指针入 links.up');
    assert.ok(r.ssot.chronicle.some((c) => c.text.includes('沿「旧事」而来')), '编年可见因果（上游事件写标题）');
    assert.ok(!r.ssot.chronicle.some((c) => /ev_[a-z0-9_]+/.test(c.text)), '事件代号绝不入编年文本（第十三棒：A-3 玩家视线）');
});

test('结算：已结算盘算的推进被拦截（满步重播 bug 回归）', () => {
    // 先跑到 closed
    const step1 = validStep();
    step1.agendaAdvances = [1, 2, 3].map((n) => ({ agendaId: 'a_1', step: `推进 ${n}` }));
    const w1 = settleTick({ ssot: GOLDEN, step: step1 }).ssot;
    assert.equal(w1.agendas[0].closed, true);

    // 已结算后再推进 → 警告 + 进度不动 + 不重唱"达成"
    const step2 = validStep();
    step2.agendaAdvances = [{ agendaId: 'a_1', step: '死人推进' }];
    const r = settleTick({ ssot: w1, step: step2 });
    assert.equal(r.ok, true);
    assert.equal(r.ssot.agendas[0].progress, 4, '进度不再增长');
    assert.ok(r.stage.warnings.some((x) => x.includes('盘算推进被拒')), r.stage.warnings.join('; '));
    const finCount = r.ssot.chronicle.filter((c) => c.id === 'ch_2_fin_a_1').length;
    assert.equal(finCount, 0, '不再重唱满步结算');
});

// ---------- 玩家档案 K9：影响通道（引擎独占写玩家，玩家档案细案 §3.3 → P-3） ----------
// leg25 c 改写：整条影响通道（被 targeting 扣 hardPower / 被事件波及扣各 attrs）**随属性一并删除**——
//   它扣的就是那四个数，而账上已经没有这些数了（没有可写的内容）。
//   红线 1（引擎独占写玩家）本身不变；`playerAffected` 记录**结构照旧留着**、照旧进 simLog（审计面不缩水），
//   只是当前没有任何引擎写入方。故原 K9 六则（固定系数 / 分量无关 / 四笔审计 / state 源 world / 链上溯 / 零分量）
//   收敛为两则：**玩家账一字不动** + **审计面无写入条目**。

const PW = JSON.parse(readFileSync(new URL('./fixtures/player-world.json', import.meta.url), 'utf8'));

// 玩家的旧账残留（自带样本）：四维正被清理，故不吊在夹具上——本组要证明的是
//   "引擎不再伸手改玩家账"，样本必须由本测试自己摆上去，否则断言会随夹具清理变成空断言。
const PLAYER_LEGACY_ATTRS = { hardPower: 0.25, office: 0.05, network: 0.3, intel: 0.4 };
const pwWorld = (weights) => {
    const w = structuredClone(PW);
    Object.assign(w.weights, weights);
    w.entities.find((e) => e.id === 'e_player').attrs = { ...PLAYER_LEGACY_ATTRS };
    return w;
};
const targetStep = (target) => emptyStep({
    actions: [{ entity: 'e_xie', verb: '发兵', target, position: '大盘谷' }],
});

test('K9（leg25 c 改写）：玩家被 targeting → 世界照常落账，但引擎不再伸手改玩家账（playerAffected 无条目）', () => {
    const r = settleTick({ ssot: pwWorld({ e_xie: 0.9, e_player: 0.2397 }), step: targetStep('e_player') });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const p = r.ssot.entities.find((e) => e.id === 'e_player');
    assert.deepEqual(p.attrs, PLAYER_LEGACY_ATTRS, '★玩家账一字不动（可写的内容没了：旧法此处 hardPower −0.05）');
    assert.equal(p.lastActiveTick, undefined, '被打的客体不算活跃（K3 口径不变）');
    const sim = r.ssot.meta.simLog[0];
    assert.equal(sim.playerAffected, undefined, 'playerAffected 无写入 ⇒ 按"只在有值时写"的旧账零扰动口径，该键不出现');
    assert.ok(Array.isArray(r.ssot.meta.simLog) && r.ssot.meta.simLog.length === 1, 'simLog 记账照旧（审计面不缩水）');
    // 门控面照旧：e_player 本无在办盘算/久未出手 → 结构上静默；被动作点名 → 解除静默（触发例外不受影响）
    assert.deepEqual(sim.silent, ['e_player'], '结构上静默');
    assert.deepEqual(sim.lifted, ['e_player'], '被动作点名 → 解除静默（触发例外照旧）');
    // schema 面（leg25 c）：不能拿**故意带着旧账残留**的这个世界去校验——entities 的 `attrs` 已被
    //   契约层拒收（additional:false ⇒ 未知字段），本组世界是照旧账形态手搭的，拒是"如期"而不是"引擎写坏了"。
    //   故这里锁两件：①原样的残留世界**必须**被拒（防字段无声复活）；②过一遍迁移（旧账清理是迁移的活，
    //   不是结算管线的活，见文件头）之后必须全量合法——即"残留只由迁移负责，迁移之后账是干净的"。
    const vrRaw = validate(r.ssot, ssotSchema);
    assert.equal(vrRaw.ok, false, '带旧账残留的世界如期被拒（attrs 不再被接受）');
    assert.ok(vrRaw.errors.some((e) => e.includes('attrs') && e.includes('未知字段')), vrRaw.errors.join('; '));
    const migrated = migrateLegacyAttrs(r.ssot);
    assert.equal(migrated.entities.find((e) => e.id === 'e_player').attrs, undefined, '迁移把残留摘掉');
    const vr = validate(migrated, ssotSchema);
    assert.equal(vr.ok, true, vr.errors.join('; '));
});

test('K9（leg25 c 改写）：被事件波及（plot / state / ripple 源）同样不动玩家账——来源解析不再有落账出口', () => {
    // 旧法：resolveEventSource 解析出来源分量比，再按系数扣玩家各维、写四笔 playerAffected。
    //   现在解析器还在（pack/镜头侧仍用），但**账本方向没有出口**——四维不存在，扣无可扣。
    const mk = (extraEvents = []) => {
        const w = pwWorld({ e_xie: 0.9, e_player: 0.2397 });
        w.events.push(...extraEvents);
        return w;
    };
    const cases = [
        ['plot 源', mk(), { title: '围剿黄府', source: { type: 'plot', ref: 'a_xie' }, position: '黄府', ripples: ['e_player'] }],
        ['state 源', mk(), { title: '天雷动', source: { type: 'state' }, position: '黄府', ripples: ['e_player'] }],
        ['ripple 源（沿链上溯）', mk([{ id: 'ev_up', title: '兵变', source: { type: 'plot', ref: 'a_xie' }, position: '大盘谷', ripples: [], links: { up: [], down: [] }, closed: false }]), { title: '兵变波及黄府', source: { type: 'ripple', ref: 'ev_up' }, position: '黄府', ripples: ['e_player'] }],
    ];
    for (const [label, w, ev] of cases) {
        const r = settleTick({ ssot: w, step: emptyStep({ newEvents: [ev] }) });
        assert.equal(r.ok, true, `${label}: ${r.stage.warnings.join('; ')}`);
        const p = r.ssot.entities.find((e) => e.id === 'e_player');
        assert.deepEqual(p.attrs, PLAYER_LEGACY_ATTRS, `${label}：玩家账一字不动（旧法此处四维各 −0.02）`);
        assert.equal(r.ssot.meta.simLog[0].playerAffected, undefined, `${label}：无影响通道条目`);
        assert.ok(r.ssot.events.some((e) => e.title === ev.title), `${label}：事件照常落账（波及名单保留）`);
    }
});

// ---------- 执行债（2026-09-07 顺手清）：events.closed 关闭路径——终结产果联闭 ----------

test('执行债：源盘算满步结算 → 其 plot 事件闭环 + 观棋留痕（不带 eventRef 不进注入）', () => {
    const w = structuredClone(GOLDEN);
    w.events = [{ id: 'ev_p', title: '边关风波', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: [], links: { up: [], down: [] }, closed: false }];
    const step = validStep();
    step.agendaAdvances = [1, 2, 3].map((n) => ({ agendaId: 'a_1', step: `推进 ${n}` }));
    const r = settleTick({ ssot: w, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.equal(r.ssot.events.find((e) => e.id === 'ev_p').closed, true, '旧事件终结产果联闭');
    assert.equal(r.ssot.events.find((e) => e.id === 'ev_1_1').closed, true, '同 tick 新事件同闭');
    const note = r.ssot.chronicle.find((c) => c.id === 'ch_1_evc_ev_p');
    assert.ok(note && !note.eventRef, '闭环留痕在观棋侧（不带 eventRef → 不进注入）');
    assert.equal(note.chainRef, 'ev_p', '闭环行带 chainRef 链目标（纯链入口数据，注入面不读；第十五棒补）');
    const vr = validate(r.ssot, ssotSchema);
    assert.equal(vr.ok, true, vr.errors.join('; '));
});

test('执行债：state 源事件不随盘算联闭（常驻事件语义保留，e_mid 症状另一面不动）', () => {
    const w = structuredClone(GOLDEN);
    w.events = [
        { id: 'ev_state', title: '常驻风波', source: { type: 'state' }, position: '边关', ripples: [], links: { up: [], down: [] }, closed: false },
        { id: 'ev_p', title: '边关风波', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: [], links: { up: [], down: [] }, closed: false },
    ];
    const step = validStep();
    step.agendaAdvances = [1, 2, 3].map((n) => ({ agendaId: 'a_1', step: `推进 ${n}` }));
    const r = settleTick({ ssot: w, step });
    assert.equal(r.ok, true);
    assert.equal(r.ssot.events.find((e) => e.id === 'ev_state').closed, false, 'state 事件不联闭');
    assert.equal(r.ssot.events.find((e) => e.id === 'ev_p').closed, true);
});

// ---------- K39/编年 kind 章（链视图细案 §3.1 → A-16①：五筛类型章；盘算侧按行主 visibility 定暗、事件侧按 source.type 定类） ----------

test('K39/编年 kind 章：settle 落账全行带 kind + plot 事件行=大事（A-16① 漏章锁）', () => {
    const r = settleTick({ ssot: GOLDEN, step: validStep() });
    assert.equal(r.ok, true);
    const KINDS = new Set(['scheme', 'major', 'ripple', 'shade', 'state']);
    assert.ok(r.stage.chronicle.length >= 2, '有落账行');
    assert.ok(r.stage.chronicle.every((c) => KINDS.has(c.kind)), `全行带 kind: ${JSON.stringify(r.stage.chronicle)}`);
    const adv = r.stage.chronicle.find((c) => c.id === 'ch_1_adv_a_1');
    assert.equal(adv.kind, 'scheme', '推进行=谋划');
    const ev = r.stage.chronicle.find((c) => c.id === 'ch_1_ev_1');
    assert.equal(ev.kind, 'major', 'plot 事件行=大事');
    assert.equal(ev.eventRef, 'ev_1_1', '事件行 eventRef 保持（闭环行不带 eventRef 的注入面语义不被扰动，K39 修正）');
});

test('K39/编年 kind 章：ripple 事件行=牵动（loneWorld 挂链）', () => {
    const step = emptyStep({ newEvents: [{ title: '旧事发酵', source: { type: 'ripple', ref: 'ev_old' }, position: '孤岛', ripples: ['e_lone'] }] });
    const r = settleTick({ ssot: loneWorld(), step });
    assert.equal(r.ok, true);
    const ev = r.stage.chronicle.find((c) => c.id === 'ch_4_ev_1');
    assert.equal(ev.kind, 'ripple', 'ripple 事件行=牵动');
});

test('K39/编年 kind 章：concealed 盘算侧行=暗处（终结/取消按行主盘算 visibility 定暗）', () => {
    const w = {
        version: 1,
        context: { world: '夜城', tension: 0.5, positions: ['夜城'] },
        entities: [{ id: 'e_d', kind: 'character', name: '暗子', location: '夜城' }],
        weights: { e_d: 0.5 },   // 预热分量（K7 夹具教训：t1 门控跑在真分量重算前，种子权重防误判静默）
        agendas: [{ id: 'a_d', owner: 'e_d', goal: '暗线行动', stage: '谋划', visibility: 'concealed', maxSteps: 2, progress: 0, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } }],
        events: [],
        chronicle: [],
        meta: { tick: 0 },
    };
    // 满步终结（concealed 终结上桌 → kind=shade）
    const step1 = emptyStep({ agendaAdvances: [{ agendaId: 'a_d', step: '推进' }, { agendaId: 'a_d', step: '推进' }] });
    const r1 = settleTick({ ssot: w, step: step1 });
    assert.equal(r1.ok, true);
    assert.equal(r1.ssot.agendas[0].closed, true, '暗盘算满步关闭');
    const fin = r1.stage.chronicle.find((c) => c.id === 'ch_1_fin_a_d');
    assert.equal(fin.kind, 'shade', '暗盘算终结行=暗处');
    // 取消（concealed → shade）
    const w2 = structuredClone(w);
    const step2 = emptyStep({ agendaCancels: [{ agendaId: 'a_d', reason: '收线' }] });
    const r2 = settleTick({ ssot: w2, step: step2 });
    assert.equal(r2.ok, true);
    const can = r2.stage.chronicle.find((c) => c.id === 'ch_1_can_a_d');
    assert.equal(can.kind, 'shade', '暗盘算取消行=暗处');
});
