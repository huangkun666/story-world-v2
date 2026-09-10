// story-world-v2/test/settle.test.js
// S5 验收：结算管线按序（校验→裁定→挂链→一致性→重算→落账→编年→度量），纯函数性 + golden 世界。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settleTick, INBORN_ATTR_KEYS, migrateLegacyAttrs } from '../src/settle.js';
import { checkWorldStep } from '../src/check-step.js';
import { computeWeight } from '../src/weight.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/golden-world.min.json', import.meta.url), 'utf8'));

const validStep = () => ({
    actions: [{ entity: 'e_merchant', verb: '沿商路北上巡查', position: '商路' }],
    newEvents: [{ title: '守将允诺通关', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: ['e_merchant'] }],
    agendaAdvances: [{ agendaId: 'a_1', step: '守将首肯，车队放行', stage: '过边关' }],
    stateChanges: [{ entity: 'e_merchant', attr: 'network', delta: 0.05, cause: 'a_1' }],
    newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
});

// 一实体无盘算的孤岛世界（一致性检查用）
const loneWorld = () => ({
    version: 1,
    context: { world: '孤岛', tension: 0.3, positions: ['孤岛'] },
    entities: [{ id: 'e_lone', kind: 'character', name: '独行客', location: '孤岛', attrs: { network: 0.2 } }],
    weights: {},
    agendas: [],
    events: [{ id: 'ev_old', title: '旧事', source: { type: 'state' }, position: '孤岛', closed: true }],
    chronicle: [],
    meta: { tick: 3 },
});

test('结算：基本 tick 全管线落账', () => {
    const before = JSON.stringify(GOLDEN);
    const r = settleTick({ ssot: GOLDEN, step: validStep(), moveFact: { verb: '收服', object: '龙蛋' } });
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

    // 锚点更新（K2 重算切真公式）：重算在 stateChanges 落账后（network 0.6→0.65）→ base 0.47 × 1.5 = 0.705
    assert.ok(Math.abs(w.weights.e_merchant - 0.705) < 1e-9, `分量真公式值，实际 ${w.weights.e_merchant}`);
    assert.equal(w.entities[0].attrs.network, 0.65, '状态变更落账');

    assert.ok(w.chronicle.length >= 2, '编年：推进 + 事件各一条');
    const evEntry = w.chronicle.find((c) => c.id === 'ch_1_ev_1');
    assert.ok(evEntry.text.includes('事件「守将允诺通关」'), '编年可读');
    assert.ok(evEntry.text.includes('由盘算「打通边关商路」而生'), '编年带因果（写名不写代号）');

    assert.equal(w.meta.simLog.length, 1, '台账记账');
    assert.ok(w.meta.simLog[0].packTokens > 0 && w.meta.simLog[0].ssotBytes > 0, '四字段有值');
    assert.deepEqual(w.meta.simLog[0].warnings, []);

    assert.equal(GOLDEN.meta.tick, 0, '输入不被修改（纯函数）');
    assert.equal(JSON.stringify(GOLDEN), before);
    const vr = validate(w, ssotSchema);
    assert.equal(vr.ok, true, `结算后世界仍过 schema: ${vr.errors.join('; ')}`);
});

test('leg24 片2 账本换血：账面没有的那一维——首次正向提议记为初值（不从 0 起算），负向提议不收', () => {
    const mk = (attrs) => ({
        version: 1,
        context: { world: '孤岛', tension: 0.5, positions: ['孤岛'] },
        entities: [{ id: 'e_lone', kind: 'character', name: '独行客', location: '孤岛', attrs }],
        weights: {},
        agendas: [],
        events: [{ id: 'ev_1', title: '旧事', source: { type: 'state' }, position: '孤岛', closed: false }],
        chronicle: [],
        meta: { tick: 0 },
    });
    const stepOf = (attr, delta) => ({
        actions: [], newEvents: [], agendaAdvances: [],
        stateChanges: [{ entity: 'e_lone', attr, delta, cause: 'ev_1' }],
        newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    });
    // ① 账面空着（leg24 片2：名册/入局都不再预填）→ 分量取中立 floor
    const w = mk({});
    assert.equal(computeWeight(w.entities[0].attrs, 'character', 0.5), 0.5, '账面无数 → 中立 floor 0.5');
    // ② 首次正向提议 = 该维初值（旧法 ?? 0 起算会得到同样的数，但语义是"从 0 加"；且必留痕）
    const r1 = settleTick({ ssot: w, step: stepOf('hardPower', 0.4) });
    assert.equal(r1.ok, true, r1.stage.warnings.join('; '));
    assert.equal(r1.ssot.entities[0].attrs.hardPower, 0.4, '首次正向提议记为初值');
    assert.ok(r1.stage.warnings.some((x) => x.includes('记为该维初值')), '初值留痕（每条变更留痕）');
    // ③ 同维第二次 → 正常增量语义
    const r2 = settleTick({ ssot: r1.ssot, step: stepOf('hardPower', 0.1) });
    assert.equal(r2.ssot.entities[0].attrs.hardPower, 0.5, '第二次走增量（0.4+0.1）');
    // ④ 无基线时的负向提议 → 不收（不得凭空造出"0"这个事实），但留痕
    const r3 = settleTick({ ssot: r1.ssot, step: stepOf('office', -0.3) });
    assert.equal(r3.ok, true);
    assert.equal(r3.ssot.entities[0].attrs.office, undefined, '负向提议无基线可减 → 不落账（旧法会钳成 0）');
    assert.ok(r3.stage.warnings.some((x) => x.includes('负向提议') && x.includes('无基线可减')), '不收也留痕');
    // ④' leg24 片4：不收的提议**不产生编年行**（编年只记真发生的事）
    assert.ok(!r3.stage.chronicle.some((c) => c.id.includes('_attr_')), `无基线负向提议不写编年：${JSON.stringify(r3.stage.chronicle)}`);
    // ⑤ 有基线后照样能削弱（先正向、再负向）
    const r4 = settleTick({ ssot: r3.ssot, step: stepOf('office', 0.3) });
    const r5 = settleTick({ ssot: r4.ssot, step: stepOf('office', -0.1) });
    assert.ok(Math.abs(r5.ssot.entities[0].attrs.office - 0.2) < 1e-9, '有基线 → 负向照常生效');
    assert.equal(validate(r5.ssot, ssotSchema).ok, true);
});

// ---------- leg24 片4：stateChanges 白名单（attr 只能四维）+ 编年留痕（每条变更留痕） ----------

// 空步（只放本组要用的组；其余组给齐 required）
const emptyStep = (more = {}) => ({
    actions: [], newEvents: [], agendaAdvances: [], stateChanges: [],
    newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    ...more,
});
const stateStep = (changes) => emptyStep({ stateChanges: changes });

test('leg24 片4：stateChanges[].attr 白名单——四维之外的键拒整步（账本污染面），世界如实不动', () => {
    const bad = validStep();
    bad.stateChanges = [{ entity: 'e_merchant', attr: '气运', delta: 0.4, cause: 'a_1' }];
    const r = settleTick({ ssot: GOLDEN, step: bad });
    assert.equal(r.ok, false, '白名单外 attr：整步被拒（与其它语义校验同口径）');
    assert.equal(r.ssot, GOLDEN, '原世界对象原样返回（账上没有「气运」这个键）');
    assert.equal(GOLDEN.meta.tick, 0, 'tick 不推进');
    assert.equal(GOLDEN.entities[0].attrs['气运'], undefined, '账本零污染');
    assert.ok(r.stage.warnings.some((x) => x.includes('$.stateChanges[0].attr:') && x.includes('四维属性白名单')), r.stage.warnings.join('; '));
    // 四维照常放行（拒面不误伤）
    for (const attr of INBORN_ATTR_KEYS) {
        const ok = checkWorldStep(stateStep([{ entity: 'e_merchant', attr, delta: 0.01, cause: 'a_1' }]), GOLDEN);
        assert.equal(ok.ok, true, `${attr} 应放行：${ok.errors.join('; ')}`);
    }
});

test('leg24 片4：stateChanges[].actor 白名单面——未知 actor 拒整步（缺省仍合法=被作用方自身）', () => {
    // 未知 actor（拼错/编造）：此前完全不校验 → "静默方自我增强被拒"被判成"他人施加"合法落账
    const r = checkWorldStep(stateStep([{ entity: 'e_merchant', attr: 'network', delta: 0.1, actor: 'e_ghost', cause: 'a_1' }]), GOLDEN);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((x) => x.startsWith('$.stateChanges[0].actor:') && x.includes('未知实体')), r.errors.join('; '));
    // 缺省 actor 合法（=被作用方自身，静默语义不变）
    const r2 = checkWorldStep(stateStep([{ entity: 'e_merchant', attr: 'network', delta: 0.1, cause: 'a_1' }]), GOLDEN);
    assert.equal(r2.ok, true, r2.errors.join('; '));
    // 在册 actor 合法（他人施加通道不被误伤）
    const r3 = checkWorldStep(stateStep([{ entity: 'e_merchant', attr: 'network', delta: 0.1, actor: 'e_merchant', cause: 'a_1' }]), GOLDEN);
    assert.equal(r3.ok, true, r3.errors.join('; '));
    // 端到端闸门（旧法的洞）：若校验层不拦，settle 的 selfSilent（!c.actor && …）会把"未知 actor"当他人施加——
    // 静默方自我增强就合法落账了。现在整步被拒，账本上一个字都不动。
    const silentActor = loneWorld();
    const untouched = loneWorld();   // 独立参照：确认"世界如实不动"不是自证
    silentActor.entities[0].attrs = { network: 0.2 };
    const end = settleTick({ ssot: silentActor, step: stateStep([{ entity: 'e_lone', attr: 'network', delta: 0.5, actor: 'e_ghost', cause: 'ev_old' }]) });
    assert.equal(end.ok, false, '未知 actor → 整步拒（不给"假他人"留落账面）');
    assert.equal(end.ssot, silentActor, '世界如实不动（原对象返回）');
    assert.equal(silentActor.entities[0].attrs.network, 0.2, '静默方数值未被绕道改写');
    assert.equal(untouched.entities[0].attrs.network, 0.2, '独立参照世界零扰动（纯函数）');
});

test('leg24 片4：newEntities[].attrs 键白名单——白名单外的键拒（同上账本污染面）', () => {
    const w = loneWorld();
    w.events = [{ id: 'ev_1', title: '旧事', source: { type: 'state' }, position: '孤岛', ripples: [], closed: false }];
    const ne = (attrs) => emptyStep({ newEntities: [{ name: '新客', kind: 'character', location: '孤岛', attrs, source: { type: 'event', ref: 'ev_1' } }] });
    const bad = checkWorldStep(ne({ 气运: 0.4 }), w);
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((x) => x.includes('$.newEntities[0].attrs.气运:') && x.includes('四维属性白名单')), bad.errors.join('; '));
    const badMix = checkWorldStep(ne({ network: 0.4, 气运: 0.2 }), w);
    assert.equal(badMix.ok, false, '混着合法键也不放行（整步拒）');
    const ok = checkWorldStep(ne({ network: 0.4, intel: 0.2 }), w);
    assert.equal(ok.ok, true, ok.errors.join('; '));
});

test('leg24 片4：属性实际生效变更写编年（含初值落账那一支）——实体名/维度/前后值/依据齐', () => {
    const mk = (attrs) => ({
        version: 1,
        context: { world: '孤岛', tension: 0.5, positions: ['孤岛'] },
        entities: [{ id: 'e_lone', kind: 'character', name: '独行客', location: '孤岛', attrs }],
        weights: {},
        agendas: [],
        events: [{ id: 'ev_1', title: '旧事', source: { type: 'state' }, position: '孤岛', closed: false }],
        chronicle: [],
        meta: { tick: 0 },
    });
    // ① 有基线：0.4 → 0.5（增量支；取 0.4+0.1 避浮点尾数，好读）
    const r1 = settleTick({ ssot: mk({ network: 0.4 }), step: stateStep([{ entity: 'e_lone', attr: 'network', delta: 0.1, cause: 'ev_1' }]) });
    assert.equal(r1.ok, true, r1.stage.warnings.join('; '));
    assert.equal(r1.ssot.entities[0].attrs.network, 0.5, '增量照旧（未因留痕改动算术）');
    const rows = r1.stage.chronicle.filter((c) => c.id.startsWith('ch_1_attr_'));
    assert.equal(rows.length, 1, `一次 stateChanges = 一行（不刷屏）：${JSON.stringify(r1.stage.chronicle)}`);
    assert.equal(rows[0].kind, 'state', 'kind=state（处境驱动的世界变化章）');
    assert.equal(rows[0].tick, 1);
    assert.ok(rows[0].text.includes('「独行客」'), `含实体名：${rows[0].text}`);
    assert.ok(rows[0].text.includes('人脉'), `维度写中文名不写代号：${rows[0].text}`);
    assert.ok(rows[0].text.includes('0.4→0.5'), `含前后值：${rows[0].text}`);
    assert.ok(rows[0].text.includes('（因事件「旧事」）'), `含依据（cause 渲染成名）：${rows[0].text}`);
    assert.ok(!/\bnetwork\b/.test(rows[0].text), '属性代号不入玩家视线');
    assert.ok(r1.ssot.chronicle.some((c) => c.id === rows[0].id), '编年落账进世界');
    assert.equal(validate(r1.ssot, ssotSchema).ok, true);
    // ② 账上无数：首次正向提议记为初值——初值那一支同样留痕
    const r2 = settleTick({ ssot: mk({}), step: stateStep([{ entity: 'e_lone', attr: 'hardPower', delta: 0.4, cause: 'ev_1' }]) });
    const ini = r2.stage.chronicle.filter((c) => c.id.startsWith('ch_1_attr_'));
    assert.equal(ini.length, 1, '初值落账也留痕');
    assert.ok(ini[0].text.includes('兵力') && ini[0].text.includes('账上无数') && ini[0].text.includes('0.4'), `初值行含维度/前后值：${ini[0].text}`);
    // ③ 钳到同值（delta 0）不算变更 → 不写编年
    const r3 = settleTick({ ssot: mk({ network: 0.5 }), step: stateStep([{ entity: 'e_lone', attr: 'network', delta: 0, cause: 'ev_1' }]) });
    assert.equal(r3.ok, true);
    assert.equal(r3.stage.chronicle.filter((c) => c.id.startsWith('ch_1_attr_')).length, 0, '值没变 → 不算变更、不写编年');
    // ④ 同一实体同 tick 两条变更 → 两行且 id 唯一
    const r4 = settleTick({ ssot: mk({ network: 0.2, intel: 0.2 }), step: stateStep([
        { entity: 'e_lone', attr: 'network', delta: 0.1, cause: 'ev_1' },
        { entity: 'e_lone', attr: 'intel', delta: 0.1, cause: 'ev_1' },
    ]) });
    const ids = r4.stage.chronicle.filter((c) => c.id.startsWith('ch_1_attr_')).map((c) => c.id);
    assert.equal(ids.length, 2);
    assert.equal(new Set(ids).size, 2, `id 唯一：${ids.join(', ')}`);
    // ⑤ 玩家侧不写编年（引擎独占写玩家走 simLog.playerAffected，另一条留痕通道）
    const pw = {
        version: 1,
        context: { world: '孤岛', tension: 0.5, positions: ['孤岛'], playerId: 'e_player' },
        entities: [
            { id: 'e_other', kind: 'character', name: '他人', location: '孤岛', attrs: { network: 0.5 } },
            { id: 'e_player', kind: 'character', name: '黄坤', location: '孤岛', attrs: { hardPower: 0.5, network: 0.5 } },
        ],
        weights: {},
        agendas: [],
        events: [{ id: 'ev_1', title: '旧事', source: { type: 'state' }, position: '孤岛', closed: false }],
        chronicle: [],
        meta: { tick: 0 },
    };
    const r5 = settleTick({ ssot: pw, step: emptyStep({
        stateChanges: [{ entity: 'e_other', attr: 'network', delta: 0.1, cause: 'ev_1' }],   // 非玩家：写编年
        actions: [{ entity: 'e_other', verb: '打压', target: 'e_player', position: '孤岛' }],   // 玩家被 targeting：走引擎独占写玩家通道
    }) });
    assert.equal(r5.ok, true, r5.stage.warnings.join('; '));
    const attrRows = r5.stage.chronicle.filter((c) => c.id.includes('_attr_'));
    assert.equal(attrRows.length, 1, `只有非玩家那一笔进编年：${JSON.stringify(attrRows)}`);
    assert.ok(attrRows[0].text.includes('「他人」'), '编年行主体是非玩家实体');
    assert.ok(Math.abs(r5.ssot.entities.find((e) => e.id === 'e_player').attrs.hardPower - 0.45) < 1e-12, '玩家数值照常落账（另一条通道）');
    assert.equal(r5.ssot.entities.find((e) => e.id === 'e_player').attrs.network, 0.5, '玩家 network 未被动（无玩家编年行）');
    assert.equal(r5.ssot.meta.simLog[0].playerAffected[0].attr, 'hardPower', '玩家留痕在 simLog.playerAffected（红线 1 的审计面）');
});

test('leg24 片4：静默方自我增强被拒 → 不写编年行（编年只记真发生的事）', () => {
    // 两实体世界：e_head 是实体序首个（top-1 保送，永不静默）；e_quiet 无在飞盘算 + 从没出过手 + 无人点名 = 静默
    const w = {
        version: 1,
        context: { world: '孤岛', tension: 0.5, positions: ['孤岛'] },
        entities: [
            { id: 'e_head', kind: 'character', name: '当家人', location: '孤岛', attrs: { network: 0.5 } },
            { id: 'e_quiet', kind: 'character', name: '静默客', location: '孤岛', attrs: { network: 0.2 } },
        ],
        weights: {},
        agendas: [],
        events: [{ id: 'ev_1', title: '旧事', source: { type: 'state' }, position: '孤岛', closed: false }],
        chronicle: [],
        meta: { tick: 0 },
    };
    const r = settleTick({ ssot: w, step: stateStep([{ entity: 'e_quiet', attr: 'network', delta: 0.5, cause: 'ev_1' }]) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.equal(r.ssot.entities.find((e) => e.id === 'e_quiet').attrs.network, 0.2, '静默自我增强 = 被拒（值没动）');
    assert.ok(r.stage.warnings.some((x) => x.includes('静默方自我增强被拒')));
    assert.equal(r.stage.chronicle.filter((c) => c.id.includes('_attr_')).length, 0, '被拒的提议不产生编年行');
});

// ---------- leg24 片4：旧账里那批"引擎编的假数"一次性清理（migrateLegacyAttrs） ----------

// 旧账夹具：三实体各持旧代码预填的四维（character 全 0.15 / faction 全 0.25）+ 一个合法有据实体
const legacyWorld = (bookEntities = []) => ({
    version: 1,
    context: {
        world: '旧账世界', tension: 0.5, positions: ['未明'],
        setting: { frozen: { fingerprint: 'f1', extractedAt: 't', canon: { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [], bookEntities } } },
    },
    entities: [
        { id: 'e_bk_1', kind: 'character', name: '白小娥', location: '未明', attrs: { hardPower: 0.15, office: 0.15, network: 0.15, intel: 0.15 } },
        { id: 'e_bk_2', kind: 'faction', name: '万法阁', location: '未明', attrs: { hardPower: 0.25, office: 0.25, network: 0.25, intel: 0.25 } },
        { id: 'e_1_1', kind: 'character', name: '真数者', location: '未明', attrs: { hardPower: 0.6, office: 0.4, network: 0.3, intel: 0.2 } },
    ],
    weights: {},
    agendas: [],
    events: [],
    chronicle: [],
    meta: { tick: 7 },
});

test('leg24 片4 迁移（逐维口径）：旧默认值逐维清 + 被删值留档 + 一次性标记', () => {
    const before = JSON.stringify(legacyWorld());
    const out = migrateLegacyAttrs(legacyWorld());
    assert.equal(JSON.stringify(legacyWorld()), before, '输入不被修改（纯函数）');
    assert.equal(out.entities.find((e) => e.id === 'e_bk_1').attrs, undefined, 'character 全 0.15 → 四维逐个清空（账面回到"空着就是空着"）');
    assert.equal(out.entities.find((e) => e.id === 'e_bk_2').attrs, undefined, 'faction 全 0.25 → 四维逐个清空');
    assert.deepEqual(out.entities.find((e) => e.id === 'e_1_1').attrs, { hardPower: 0.6, office: 0.4, network: 0.3, intel: 0.2 }, '不是旧默认值的真数一字不动');
    assert.deepEqual(out.meta.legacyAttrsPurged, {
        e_bk_1: { hardPower: 0.15, office: 0.15, network: 0.15, intel: 0.15 },
        e_bk_2: { hardPower: 0.25, office: 0.25, network: 0.25, intel: 0.25 },
    }, '被删的值不许无声消失（逐键留档）');
    assert.equal(out.meta.legacyAttrsMigratedAt, 7, '一次性标记 = 当时 tick');
    assert.notEqual(out, legacyWorld(), '不可变：返回新世界');
    assert.equal(validate(out, ssotSchema).ok, true, `迁移后世界仍过 schema（attrs 仍是可选 numRecord）: ${JSON.stringify(out.meta)}`);
    // 边角不误伤：缺一维 / 多一维 → 只对本类默认值那一维动手，其余不碰
    const partial = legacyWorld();
    partial.entities[0].attrs = { hardPower: 0.15, office: 0.15, network: 0.15 };
    assert.equal(migrateLegacyAttrs(partial).entities[0].attrs, undefined, '缺一维也照清（逐维判不再要求"整行全等"）');
    const extra = legacyWorld();
    extra.entities[0].attrs = { hardPower: 0.15, office: 0.15, network: 0.15, intel: 0.15, 旧注: 1 };
    const outExtra = migrateLegacyAttrs(extra);
    assert.deepEqual(outExtra.entities[0].attrs, { 旧注: 1 }, '四维全中 → 只删四维，非四维键不碰（不在本迁移的面）');
    const off = legacyWorld();
    off.entities[0].attrs.intel = 0.16;
    assert.deepEqual(migrateLegacyAttrs(off).entities[0].attrs, { intel: 0.16 }, '不等旧默认值的那一维保留');
});

// ★ 第二十五棒实机修正的回归锁：旧法的病根是**混合行**（一维真值 + 几维引擎默认）
//   形如用户旧账里的 阐教 {hardPower .25, office .5, network .25, intel .25}——
//   整行判词恒假 → 一格不清。实测量级：283 行带四维 / 1132 维里 500 维是旧默认值，旧法漏清 500 维。
test('第二十五棒修正：混合行（一维有据 + 数维旧默认）逐维清，真值那维留着', () => {
    const w = legacyWorld([{ name: '万法阁', kind: 'faction', attrs: { office: 0.5 }, evidence: '书中明述其势压一洲' }]);
    w.entities[1].attrs = { hardPower: 0.25, office: 0.5, network: 0.25, intel: 0.25 };
    const out = migrateLegacyAttrs(w);
    assert.deepEqual(out.entities[1].attrs, { office: 0.5 }, '书里明写的 office 留着，其余三维（= 旧默认值 0.25）清掉');
    assert.deepEqual(out.meta.legacyAttrsPurged.e_bk_2, { hardPower: 0.25, network: 0.25, intel: 0.25 }, '删掉的三维逐键留档');
    assert.equal(out.entities[1].attrs.office, 0.5, '真值不动');
});

test('第二十五棒修正：整条 evidence 串不再给其他维当挡箭牌（旧法漏清 500 维的机理）', () => {
    // 书里只有 office 有数 + 整条 evidence；旧法见 evidence 即整行放过 → 三维默认值留下
    const w = legacyWorld([{ name: '万法阁', kind: 'faction', attrs: { office: 0.5 }, evidence: '书中明述其势压一洲' }]);
    w.entities[1].attrs = { hardPower: 0.25, office: 0.5, network: 0.25, intel: 0.25 };
    const out = migrateLegacyAttrs(w);
    assert.equal(Object.keys(out.entities[1].attrs).length, 1, '只有书里明写的那一维活下来');
    // 对照：书里**明写了数值**的那一维，哪怕等于旧默认值也保留（有据就是有据）
    const w2 = legacyWorld([{ name: '万法阁', kind: 'faction', attrs: { hardPower: 0.25 }, evidence: '书中明述其势压一洲' }]);
    w2.entities[1].attrs = { hardPower: 0.25, office: 0.25, network: 0.25, intel: 0.25 };
    const out2 = migrateLegacyAttrs(w2);
    assert.deepEqual(out2.entities[1].attrs, { hardPower: 0.25 }, '书里明写 hardPower 0.25 → 那一维保留（真值恰好等于旧默认值也不许删）');
    assert.deepEqual(out2.meta.legacyAttrsPurged.e_bk_2, { office: 0.25, network: 0.25, intel: 0.25 }, '其余三维照清');
});

test('第二十五棒修正：编年里有过属性变更的实体 → 该行的默认值不删（真跑出来的数不许当假数）', () => {
    const w = legacyWorld();
    w.chronicle = [{ id: 'ch_3_attr_e_bk_2_1', tick: 3, kind: 'state', text: '「万法阁」兵力 账上无数→0.25（因盘算「坐大」）' }];
    const out = migrateLegacyAttrs(w);
    assert.deepEqual(out.entities[1].attrs, { hardPower: 0.25, office: 0.25, network: 0.25, intel: 0.25 }, '编年点了名 → 整行豁免（宁可漏清，不可错清）');
    assert.equal(out.entities[0].attrs, undefined, '没被编年点名的照清');
    assert.deepEqual(Object.keys(out.meta.legacyAttrsPurged), ['e_bk_1'], '留档只记真删掉的');
    // 判据对齐的是**名字**（编年渲染写名不写代号）——代号在文本里不构成豁免
    const w2 = legacyWorld();
    w2.chronicle = [{ id: 'x', tick: 3, kind: 'state', text: '「e_bk_2」兵力 账上无数→0.25' }];
    const out2 = migrateLegacyAttrs(w2);
    assert.equal(out2.entities[1].attrs, undefined, '文本里是代号（不是「」包的名号）→ 不豁免');
});

test('第二十五棒修正：书里没有的名册实体（中途新生）同样受逐维清理', () => {
    const w = legacyWorld();   // bookEntities 为空 = 书里一条都没有
    w.entities.push({ id: 'e_9_1', kind: 'character', name: '对话里冒出来的人', location: '未明', attrs: { hardPower: 0.15, office: 0.15, network: 0.15, intel: 0.15 } });
    const out = migrateLegacyAttrs(w);
    assert.equal(out.entities.find((e) => e.id === 'e_9_1').attrs, undefined, '书里无据 → 四维按旧默认值判清');
});

test('第二十五棒修正：一维真值 + 一维同维默认 → 只删默认那一维（粒度是"维"不是"行"）', () => {
    const w = legacyWorld([{ name: '万法阁', kind: 'faction', attrs: { hardPower: 0.8, office: 0.5 }, evidence: '书中明述' }]);
    w.entities[1].attrs = { hardPower: 0.85, office: 0.5, network: 0.25, intel: 0.25 };
    const out = migrateLegacyAttrs(w);
    assert.deepEqual(out.entities[1].attrs, { hardPower: 0.85, office: 0.5 }, '真值两维保留（哪怕与书值不同——模型改过的真数不动）');
    assert.deepEqual(out.meta.legacyAttrsPurged.e_bk_2, { network: 0.25, intel: 0.25 }, '只删两维默认值');
});

test('第二十五棒修正：逐维清理后仍过 schema + 幂等 + 标记语义不变', () => {
    const w = legacyWorld([{ name: '万法阁', kind: 'faction', attrs: { office: 0.5 } }]);
    w.entities[1].attrs = { hardPower: 0.25, office: 0.5, network: 0.25, intel: 0.25 };
    const once = migrateLegacyAttrs(w);
    assert.equal(validate(once, ssotSchema).ok, true, '逐维清理后世界仍过 schema');
    const twice = migrateLegacyAttrs(once);
    assert.equal(twice, once, '第二次原对象返回（标记为闸）');
    assert.equal(migrateLegacyAttrs(twice), twice, '连跑三次同对象');
    assert.equal(JSON.stringify(migrateLegacyAttrs(once)), JSON.stringify(once), '逐字节一致');
    // 旧版本已迁过的账（标记在）→ 绝不重扫：即便行里还留着混合行的默认值
    const migrated = legacyWorld();
    migrated.meta.legacyAttrsMigratedAt = 2;
    migrated.entities[1].attrs = { hardPower: 0.25, office: 0.5, network: 0.25, intel: 0.25 };
    const out = migrateLegacyAttrs(migrated);
    assert.equal(out, migrated, '旧版本迁过的账原样返回（幂等闸语义不变——已经清过的世界不会重复动）');
});

test('leg24 片4 迁移：书里有据的值不被动（旧口径回归：整行有据 → 一个字不动）', () => {
    // 旧测试的语义在新口径下**仍然成立**的原因：这两条书条目的 attrs 缺省 → 逐维判"书里没写这一维"
    //   会把四维都判为默认值……但那两条实体的 kind 是 character/faction 且四维全默认——所以这里改成
    //   显式锁"书里明写那一维"的保留，避免用"整条有据"这种已被证伪的宽判据。
    const w = legacyWorld([
        { name: '白小娥', kind: 'character', attrs: { hardPower: 0.15, office: 0.15, network: 0.15, intel: 0.15 }, evidence: '书中明述其根骨' },
        { name: '万法阁', kind: 'faction', attrs: { hardPower: 0.25, office: 0.25, network: 0.25, intel: 0.25 }, evidence: '书中明述其势压一洲' },
    ]);
    const out = migrateLegacyAttrs(w);
    assert.deepEqual(out.entities.find((e) => e.id === 'e_bk_1').attrs, { hardPower: 0.15, office: 0.15, network: 0.15, intel: 0.15 }, '书里四维都明写 → 一字不动');
    assert.deepEqual(out.entities.find((e) => e.id === 'e_bk_2').attrs, { hardPower: 0.25, office: 0.25, network: 0.25, intel: 0.25 }, '书里四维都明写 → 一字不动');
    assert.equal(out, w, '无可清 → 原对象原样返回（不写无谓的一次性标记）');
    assert.equal(out.meta.legacyAttrsMigratedAt, undefined, '无清理发生即不打标记（旧账零扰动）');
});

test('leg24 片4 迁移：幂等——连跑两次逐字节一致，且不覆盖已有留档', () => {
    const once = migrateLegacyAttrs(legacyWorld());
    const twice = migrateLegacyAttrs(once);
    assert.equal(twice, once, '第二次原对象返回（标记为闸，绝不重扫）');
    assert.equal(JSON.stringify(twice), JSON.stringify(once), '逐字节一致');
    const three = migrateLegacyAttrs(twice);
    assert.equal(JSON.stringify(three), JSON.stringify(once), '连跑三次同字节');
    // 已有留档不被新一次覆盖（人工/旧版本留档保护）
    const w = legacyWorld();
    w.meta.legacyAttrsPurged = { e_bk_9: { intel: 0.01 } };
    const out = migrateLegacyAttrs(w);
    assert.equal(out.meta.legacyAttrsPurged.e_bk_9.intel, 0.01, '既有留档保留');
    assert.equal(out.meta.legacyAttrsPurged.e_bk_1.hardPower, 0.15, '本次留档并入');
});

test('结算：校验不过 → 世界如实不动', () => {
    const bad = validStep();
    bad.actions[0].entity = 'e_ghost';
    const r = settleTick({ ssot: GOLDEN, step: bad });
    assert.equal(r.ok, false);
    assert.equal(r.ssot, GOLDEN, '原世界对象原样返回');
    assert.equal(GOLDEN.meta.tick, 0);
    assert.ok(r.stage.warnings.some((x) => x.includes('未知实体')));
});

test('结算：薄裁定硬边界（属性越界钳制 + 警告）', () => {    const step = validStep();
    step.stateChanges = [{ entity: 'e_merchant', attr: 'network', delta: 10, cause: 'a_1' }];
    const r = settleTick({ ssot: GOLDEN, step });
    assert.equal(r.ok, true);
    assert.equal(r.ssot.entities[0].attrs.network, 1.0, '钳到上界');
    assert.ok(r.stage.warnings.some((x) => x.includes('属性硬边界')));
});

// 第二十五棒实机修正（用户问「属性硬边界（e_bk_1.hardPower 0→0，申请 -0.2）这是什么」）：
//   **空裁定**（值已在下界/上界，再提就越界 → 钳到同值）不许冒充"裁了个边界"——
//   实测用户当前世界 6 条边界裁定里 4 条是空裁定，而每轮警告总共才 1-2 条 ⇒ 噪声占一半。
test('第二十五棒修正：值已在边界、提议越界 → 记"越界提议被忽略"，不记"属性硬边界"、不写编年', () => {
    const w = structuredClone(GOLDEN);
    w.entities[0].attrs = { hardPower: 0 };                    // 已经在
    const step = validStep();
    step.stateChanges = [{ entity: w.entities[0].id, attr: 'hardPower', delta: -0.2, actor: w.entities[0].id }];
    const r = settleTick({ ssot: w, step });
    assert.equal(r.ok, true);
    assert.equal(r.ssot.entities[0].attrs.hardPower, 0, '账上仍是 0（一格没变）');
    assert.ok(r.stage.warnings.some((x) => x.includes('越界提议被忽略')), `该记"越界提议被忽略"：${r.stage.warnings.join(' | ')}`);
    assert.ok(!r.stage.warnings.some((x) => x.includes('属性硬边界')), '★不再报"0→0"的空裁定');
    assert.ok(!r.ssot.chronicle.some((c) => /兵力/.test(c.text)), '值没变 → 不写编年（两处口径一致）');
    // 对照：值真的会被钳住时，边界裁定照旧（真裁定的信息量必须保住）
    const w2 = structuredClone(GOLDEN);
    w2.entities[0].attrs = { hardPower: 0.1 };
    const step2 = validStep();
    step2.stateChanges = [{ entity: w2.entities[0].id, attr: 'hardPower', delta: -0.5, actor: w2.entities[0].id }];
    const r2 = settleTick({ ssot: w2, step: step2 });
    assert.equal(r2.ssot.entities[0].attrs.hardPower, 0, '钳到下界');
    assert.ok(r2.stage.warnings.some((x) => x.includes('属性硬边界')), '真被钳住 → 仍报边界裁定');
    assert.ok(r2.ssot.chronicle.some((c) => /兵力 0\.1→0/.test(c.text)), '真变更 → 编年照写');
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

test('第二十五棒修正（对照面）：玩家被点名但影响被吃住 → 措辞改、记录照写（K9 审计面不缩水）', () => {
    const PLAYER_IMPACT = { targeted: 0.05 };
    const w = structuredClone(GOLDEN);
    w.context.playerId = w.entities[0].id;
    w.entities[0].attrs = { hardPower: 0 };                       // 玩家已在兵力下界
    const step = validStep();
    step.actions = [{ entity: w.entities[0].id === 'e_xie' ? 'e_dayu' : 'e_xie', verb: '猛攻', target: w.context.playerId, position: '边关' }];
    step.stateChanges = [];
    step.newEvents = [];
    step.agendaAdvances = [];
    const r = settleTick({ ssot: w, step });
    if (!r.ok) return;                                            // 校验/门控拒了就跳过（本用例只关心影响通道措辞与留痕）
    const sim = r.ssot.meta.simLog[r.ssot.meta.simLog.length - 1];
    const hitRows = (sim?.playerAffected || []).filter((x) => x.attr === 'hardPower' && x.source);
    assert.ok(hitRows.length >= 1, `"世界伸手碰了玩家"必须留痕（哪怕 delta=0）：${JSON.stringify(sim?.playerAffected)}`);
    assert.ok(hitRows.every((x) => Number.isFinite(x.delta)), 'delta 是数字（吃住时=0）');
    assert.ok(!r.stage.warnings.some((x) => /属性硬边界（.*0→0/.test(x)), '★不再报"0→0"的空裁定（措辞已改）');
    void PLAYER_IMPACT;
});

test('结算：行动↔盘算一致性烟雾报警（无在飞盘算仍行动）', () => {
    const step = {
        actions: [{ entity: 'e_lone', verb: '动手', position: '孤岛' }],
        newEvents: [],
        agendaAdvances: [],
        stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = settleTick({ ssot: loneWorld(), step });
    assert.equal(r.ok, true);
    assert.ok(r.stage.warnings.some((x) => x.includes('行动↔盘算不一致')), r.stage.warnings.join('; '));
});

test('结算：ripple 事件上游指针挂链', () => {
    const world = loneWorld();
    const step = {
        actions: [],
        newEvents: [{ title: '旧事发酵', source: { type: 'ripple', ref: 'ev_old' }, position: '孤岛', ripples: ['e_lone'] }],
        agendaAdvances: [],
        stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = settleTick({ ssot: world, step });
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

const PW = JSON.parse(readFileSync(new URL('./fixtures/player-world.json', import.meta.url), 'utf8'));

const pwWorld = (weights) => {
    const w = structuredClone(PW);
    Object.assign(w.weights, weights);
    return w;
};
const targetStep = (target) => ({
    actions: [{ entity: 'e_xie', verb: '发兵', target, position: '大盘谷' }],
    newEvents: [], agendaAdvances: [], stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
});

test('K9（片3 改写）：玩家被 targeting → 影响通道按**固定系数**落账 + simLog 审计（不再按分量比折减）', () => {
    const r = settleTick({ ssot: pwWorld({ e_xie: 0.9, e_player: 0.2397 }), step: targetStep('e_player') });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const hp = r.ssot.entities.find((e) => e.id === 'e_player').attrs.hardPower;
    assert.ok(Math.abs(hp - 0.2) < 1e-12, `0.25 − 0.05 = 0.20，实际 ${hp}`);
    const pa = r.ssot.meta.simLog[0].playerAffected;
    assert.equal(pa.length, 1);
    assert.equal(pa[0].tick, 1);
    assert.equal(pa[0].source, 'e_xie');
    assert.equal(pa[0].attr, 'hardPower');
    assert.ok(Math.abs(pa[0].delta - -0.05) < 1e-9, `delta 容差，实际 ${pa[0].delta}`);
    assert.equal(pa[0].ratio, undefined, 'ratio 字段随分量退场（审计不再记那个数）');
});

test('K9（片3 改写）：源的分量高低不再改变影响幅度——弱源打强玩家也照章扣', () => {
    const weak = settleTick({ ssot: pwWorld({ e_xie: 0.1, e_player: 0.8 }), step: targetStep('e_player') });
    assert.equal(weak.ok, true, weak.stage.warnings.join('; '));
    const hp = weak.ssot.entities.find((e) => e.id === 'e_player').attrs.hardPower;
    assert.ok(Math.abs(hp - 0.2) < 1e-12, `旧法 0.25 − 0.05×(0.1/0.8) = 0.24375；现法固定系数 → 0.20，实际 ${hp}`);
});

test('K9：事件波及玩家（plot 源）→ 各 attrs 受影响 + 审计四笔', () => {
    const step = {
        actions: [],
        newEvents: [{ title: '围剿黄府', source: { type: 'plot', ref: 'a_xie' }, position: '黄府', ripples: ['e_player'] }],
        agendaAdvances: [], stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = settleTick({ ssot: pwWorld({ e_xie: 0.9, e_player: 0.2397 }), step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const p = r.ssot.entities.find((e) => e.id === 'e_player');
    assert.ok(Math.abs(p.attrs.hardPower - 0.23) < 1e-12, 'hardPower −0.02');
    assert.ok(Math.abs(p.attrs.office - 0.03) < 1e-12, 'office −0.02');
    assert.ok(Math.abs(p.attrs.network - 0.28) < 1e-12, 'network −0.02');
    assert.ok(Math.abs(p.attrs.intel - 0.38) < 1e-12, 'intel −0.02');
    const pa = r.ssot.meta.simLog[0].playerAffected;
    assert.equal(pa.length, 4);
    assert.ok(pa.every((x) => Math.abs(x.delta - -0.02) < 1e-9), JSON.stringify(pa));
});

test('K9：state 源波及 → 世界大势常量（source=world）', () => {
    const step = {
        actions: [],
        newEvents: [{ title: '天雷动', source: { type: 'state' }, position: '黄府', ripples: ['e_player'] }],
        agendaAdvances: [], stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = settleTick({ ssot: pwWorld({ e_player: 0.2397 }), step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const hp = r.ssot.entities.find((e) => e.id === 'e_player').attrs.hardPower;
    assert.ok(Math.abs(hp - 0.23) < 1e-12, '世界大势 → −0.02');
    assert.equal(r.ssot.meta.simLog[0].playerAffected[0].source, 'world');
});

test('K9：ripple 波及沿链上溯到 plot 属主（来源归属不变）', () => {
    const w = pwWorld({ e_xie: 0.9, e_player: 0.2397 });
    w.events.push({ id: 'ev_up', title: '兵变', source: { type: 'plot', ref: 'a_xie' }, position: '大盘谷', ripples: [], links: { up: [], down: [] }, closed: false });
    const step = {
        actions: [],
        newEvents: [{ title: '兵变波及黄府', source: { type: 'ripple', ref: 'ev_up' }, position: '黄府', ripples: ['e_player'] }],
        agendaAdvances: [], stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = settleTick({ ssot: w, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const hp = r.ssot.entities.find((e) => e.id === 'e_player').attrs.hardPower;
    assert.ok(Math.abs(hp - 0.23) < 1e-12, '上溯到 e_xie → 扣 0.02');
    assert.equal(r.ssot.meta.simLog[0].playerAffected[0].source, 'e_xie');
});

test('K9（片3 改写）：分量归零的玩家照常被点名影响（"零分量无所见/不受影响"的对偶已随分数退场）', () => {
    const r = settleTick({ ssot: pwWorld({ e_xie: 0.9, e_player: 0 }), step: targetStep('e_player') });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.ok(Math.abs(r.ssot.entities.find((e) => e.id === 'e_player').attrs.hardPower - 0.2) < 1e-12, '照章扣 0.05');
    assert.equal(r.ssot.meta.simLog[0].playerAffected.length, 1, '审计照记');
});

test('K9：影响通道后世界过 SSOT schema（playerAffected 审计合法）', () => {
    const r = settleTick({ ssot: pwWorld({ e_xie: 0.9, e_player: 0.2397 }), step: targetStep('e_player') });
    const vr = validate(r.ssot, ssotSchema);
    assert.equal(vr.ok, true, vr.errors.join('; '));
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
    const world = loneWorld();
    const step = {
        actions: [],
        newEvents: [{ title: '旧事发酵', source: { type: 'ripple', ref: 'ev_old' }, position: '孤岛', ripples: ['e_lone'] }],
        agendaAdvances: [],
        stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = settleTick({ ssot: world, step });
    assert.equal(r.ok, true);
    const ev = r.stage.chronicle.find((c) => c.id === 'ch_4_ev_1');
    assert.equal(ev.kind, 'ripple', 'ripple 事件行=牵动');
});

test('K39/编年 kind 章：concealed 盘算侧行=暗处（终结/取消按行主盘算 visibility 定暗）', () => {
    const w = {
        version: 1,
        context: { world: '夜城', tension: 0.5, positions: ['夜城'] },
        entities: [{ id: 'e_d', kind: 'character', name: '暗子', location: '夜城', attrs: { hardPower: 0.7, network: 0.5 } }],
        weights: { e_d: 0.5 },   // 预热分量（K7 夹具教训：t1 门控跑在真分量重算前，种子权重防误判静默）
        agendas: [{ id: 'a_d', owner: 'e_d', goal: '暗线行动', stage: '谋划', visibility: 'concealed', maxSteps: 2, progress: 0, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } }],
        events: [],
        chronicle: [],
        meta: { tick: 0 },
    };
    // 满步终结（concealed 终结上桌 → kind=shade）
    const step1 = { actions: [], newEvents: [], agendaAdvances: [{ agendaId: 'a_d', step: '推进' }, { agendaId: 'a_d', step: '推进' }], stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] };
    const r1 = settleTick({ ssot: w, step: step1 });
    assert.equal(r1.ok, true);
    assert.equal(r1.ssot.agendas[0].closed, true, '暗盘算满步关闭');
    const fin = r1.stage.chronicle.find((c) => c.id === 'ch_1_fin_a_d');
    assert.equal(fin.kind, 'shade', '暗盘算终结行=暗处');
    // 取消（concealed → shade）
    const w2 = structuredClone(w);
    const step2 = { actions: [], newEvents: [], agendaAdvances: [], stateChanges: [], newAgendas: [], agendaCancels: [{ agendaId: 'a_d', reason: '收线' }], newEntities: [], entityFates: [] };
    const r2 = settleTick({ ssot: w2, step: step2 });
    assert.equal(r2.ok, true);
    const can = r2.stage.chronicle.find((c) => c.id === 'ch_1_can_a_d');
    assert.equal(can.kind, 'shade', '暗盘算取消行=暗处');
});