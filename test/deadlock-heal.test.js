// story-world-v2/test/deadlock-heal.test.js
// ★★leg40b 续·**世界永久停摆（死锁）修复**的判据。
//
// 病灶（交接 §4.2 抓到、本笔把机制追到源头）：`settleTick` 先校验后落账 ⇒ 本轮 `step.newEvents`
// 在校验那一刻**还不在** `ssot.events` 里 ⇒ 模型"同轮新建一件事 + 为它起一条盘算"**必然被判未知**
// ⇒ 整步被拒 ⇒ **tick 不推进** ⇒ 下一轮读回同一份账、递同一个包 ⇒ 它又引那个 id ⇒ **永久停摆**。
//
// 三组判据（对应三层修复）：
//   ① 甲：同轮引用**算存在**（世界账 ∪ 本轮新建；`entityFates` 仍只认世界账，那是刻意设的闸）
//   ② 丙-2：降级重试——丢掉写歪的那几条，这一轮**照常落账**
//   ③ 丙-3：世界安静一步——连丢都救不回来时，**tick 必须前进**（"卡轮"不再等于"永久停摆"）
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkWorldStep, newEventIdsOf } from '../src/check-step.js';
import { dropInvalidProposals } from '../src/sanitize-step.js';
import { settleWithHealing, emptyStep } from '../src/tick.js';
import { settleTick } from '../src/settle.js';

/** 一份"账上真有人有事"的小世界（与 check-step 的既有夹具同形：位置是自由文本、实体在册）。 */
function world({ tick = 3, positions = ['大营'], events = null } = {}) {
    return {
        version: 1,
        context: { world: '测试世界', tension: 0.5, positions },
        entities: [
            { id: 'e_a', kind: 'character', name: '甲', location: '大营', lastActiveTick: tick },
            { id: 'e_b', kind: 'character', name: '乙', location: '大营', lastActiveTick: tick },
            { id: 'e_c', kind: 'faction', name: '丙宗', location: '大营', lastActiveTick: tick },
        ],
        weights: {}, agendas: [],
        events: events || [{ id: 'ev_1', title: '一件旧事', source: { type: 'state' }, position: '大营', ripples: ['e_a'], links: { up: [], down: [] }, closed: false }],
        chronicle: [], milestones: [],
        meta: { tick, simLog: [] },
    };
}

const stepWith = (over = {}) => ({
    actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [],
    newEntities: [], entityFates: [], entityUpdates: [], ...over,
});

/**
 * 本轮新建的事件。★**不许写 `id`**：契约层 `newEvents.items` 是**封闭形状**（`additional:false`），
 *   引擎在落账时才发号（`ev_<下一轮>_<位次>`）——故此处的形状必须与模型能写出来的**一模一样**，
 *   否则判据就落在一条生产上不存在的路上（本笔第一版就给夹具塞了 `id`，当场被 schema 报"未知字段"）。
 *   ⇒ "同轮引用"由引擎**按位次**解析（见 `check-step.js` 的 `findEvent`）。
 */
const newEvent = (over = {}) => ({ title: '新事', source: { type: 'state' }, position: '大营', ripples: ['e_a'], ...over });
const newAgenda = (over = {}) => ({ entity: 'e_a', goal: '顺势起一条线', visibility: 'known', source: { type: 'event', ref: 'ev_4_1' }, ...over });

// ---------- ① 甲：同轮引用算存在 ----------
test('死锁甲：newAgendas 引**本轮新建**的事件 ⇒ 通过（且必须正是引擎将发的那个 id）', () => {
    const step = stepWith({
        newEvents: [newEvent()],
        newAgendas: [newAgenda()],      // ref = ev_4_1：本轮 tick 3 ⇒ 下一轮 4、第一件事件 ⇒ ev_4_1
    });
    const r = checkWorldStep(step, world({ tick: 3 }));
    assert.equal(r.ok, true, `同轮引用必须通过，实际：${r.errors.join('; ')}`);
    // ★反证：把 id 换成"引擎不会发的号"（模型猜错的典型）⇒ 仍然拒（这道闸没被整体拆掉）
    const wrong = stepWith({ newEvents: [newEvent()], newAgendas: [newAgenda({ source: { type: 'event', ref: 'ev_9_9' } })] });
    assert.equal(checkWorldStep(wrong, world({ tick: 3 })).ok, false, '猜错的 id 仍然要被拒（闸没有被拆掉）');
});

test('死锁甲：newEntities 也能"因本轮新建的事"入局（ripple 那件同样算）', () => {
    const step = stepWith({
        newEvents: [newEvent({ source: { type: 'ripple', ref: 'ev_1' } })],
        newEntities: [{ name: '路人甲', location: '大营', entity: 'e_b', source: { type: 'event', ref: 'ev_4_1' } }],
    });
    const r = checkWorldStep(step, world({ tick: 3 }));
    assert.equal(r.ok, true, `新人因"正在发生的这件事"入场应通过，实际：${r.errors.join('; ')}`);
});

// ---------- ①b ★机制闸：净化路径的"按位次解析"（不依赖模型抄没抄 id）----------
test('死锁甲：★净化路径即使模型**没写事件 id**，同轮引用也能被按位次认出来（否则会误丢合法盘算）', () => {
    const w = world({ tick: 3 });
    const step = stepWith({
        // 第一条合法、第二条缺 position（会被丢）⇒ 位次会变 ⇒ 正是"净化路径要按引擎的号解析"的场景
        newEvents: [
            { title: '第一件', source: { type: 'state' }, position: '大营', ripples: ['e_a'] },   // 无 id
            { title: '缺位置', source: { type: 'state' }, ripples: ['e_b'] },                      // 无 position ⇒ 丢
        ],
        // 模型按"它以为的下一轮号"引第一件：tick 3 ⇒ ev_4_1
        newAgendas: [newAgenda({ source: { type: 'event', ref: 'ev_4_1' } })],
    });
    const clean = dropInvalidProposals(step, w);
    assert.deepEqual(clean.dropped.map((d) => d.family), ['newEvents'], '只该丢那条缺位置的事件');
    assert.equal(clean.step.newAgendas.length, 1, '★引第一件事的盘算**不许被误丢**（第一版就栽在这里）');
    assert.equal(checkWorldStep(clean.step, w).ok, true, '净化后必须过校验');
});

test('死锁甲：同轮事件**恒为未决态**（已闭环判据仍有效）——世界账里那件已闭环的旧事件照样拒', () => {
    const w = world({ tick: 3 });
    w.events = [{ id: 'ev_done', title: '旧事', source: { type: 'state' }, position: '大营', ripples: [], links: { up: [], down: [] }, closed: true }];
    const r = checkWorldStep(stepWith({ newAgendas: [newAgenda({ source: { type: 'event', ref: 'ev_done' } })] }), w);
    assert.equal(r.ok, false, '已闭环事件不可作盘算之源（闸仍在）');
});

test('死锁甲：★entityFates **刻意不享用**同轮事件（覆灭要尘埃落定，只认已落账的事）', () => {
    const step = stepWith({
        newEvents: [newEvent()],
        entityFates: [{ entity: 'e_b', verdict: 'dead', source: { type: 'event', ref: 'ev_4_1' }, reason: '顺手灭了' }],
    });
    const r = checkWorldStep(step, world({ tick: 3 }));
    assert.equal(r.ok, false, '★同轮新建的**未决**事件不许当覆灭之据（这条闸是刻意设的，见 check-step 该段注释）');
    assert.ok(r.errors.some((e) => e.includes('entityFates[0].source')), `错误要指到那一格：${r.errors.join('; ')}`);
});

test('死锁甲：落账后盘算的来路**真的指到那件同轮新建的事件**（端到端，不是只在校验层成立）', () => {
    const w = world({ tick: 3 });
    const step = stepWith({ newEvents: [newEvent()], newAgendas: [newAgenda()] });
    const ids = newEventIdsOf(step, w.meta.tick + 1);
    const r = settleTick({ ssot: w, step });
    assert.equal(r.ok, true, (r.stage?.warnings || []).join('; '));
    const born = (r.ssot.agendas || []).find((a) => a.source?.type === 'event');
    assert.ok(born, '盘算出生了');
    assert.equal(born.source.ref, ids[0], '盘算的 source.ref 必须等于引擎真发的那个事件 id');
    assert.ok((r.ssot.events || []).some((e) => e.id === born.source.ref && e.closed === false), '那件事真在账上、且未决');
});

test('死锁甲：★★复现 wide 臂那次真实停摆——模型写 `ev_5_3`（它以为第 5 轮），而引擎记第 6 轮', () => {
    // 这一格是交接 §4.2 抓到的现场：同轮内引用 ⇒ 整步被拒 ⇒ tick 不前进 ⇒ 永久停摆。
    const w = world({ tick: 5 });
    const step = stepWith({
        newEvents: [
            { title: '血战之后', source: { type: 'state' }, position: '大营', ripples: ['e_a'] },
            { title: '余波扩散', source: { type: 'ripple', ref: 'ev_1' }, position: '大营', ripples: ['e_b'] },
            { title: '第三方闻讯', source: { type: 'state' }, position: '大营', ripples: ['e_a'] },
        ],
        newAgendas: [newAgenda({ goal: '借着这场血战起一条新线', source: { type: 'event', ref: 'ev_5_3' } })],   // ← 猜错的号
    });
    const r = settleWithHealing({ ssot: w, step });
    assert.equal(r.ok, true, '★不许再停摆');
    assert.equal(r.healed.used, false, '连降级都不需要（甲就治住了）：世界照模型写的那一轮落账');
    assert.equal(r.ssot.meta.tick, 6, '★★tick 前进了（停摆治好的机械判据）');
    const born = (r.ssot.agendas || [])[0];
    assert.ok(born, '那条盘算真落账了（这才是"同轮引用被认可"）');
    // ★★收尾那一格：认下来的引用必须**被改写成引擎真发的号**，否则账上留一条悬空来路
    const ev = (r.ssot.events || []).find((e) => e.id === born.source.ref);
    assert.ok(ev, `来路必须指得着（ref=${born.source.ref}）——悬空引用是账房的失职`);
    assert.equal(ev.title, '第三方闻讯', '★而且必须指向**位次对应的那一件**（第 3 件），不是随手一件');
    assert.ok(!(r.ssot.events || []).some((e) => e.source?.type === 'ripple' && !(r.ssot.events || []).some((x) => x.id === e.source.ref)), '整条事件链零悬空');
});

// ---------- ② 丙-2：降级重试 ----------
test('死锁丙-2：newEvents 缺 position（只有模型能补）⇒ 丢掉那一条，这一轮**照常落账**', () => {
    const w = world({ tick: 3 });
    const good = newEvent({ title: '写得对的事' });
    const bad = { title: '缺位置的事', source: { type: 'state' }, ripples: ['e_b'] };   // 无 position
    const step = stepWith({
        newEvents: [good, bad],
        newAgendas: [newAgenda()],
    });
    assert.equal(checkWorldStep(step, w).ok, false, '先证红：原样过不了校验（这就是停摆的入口）');
    const r = settleWithHealing({ ssot: w, step });
    assert.equal(r.ok, true, `必须自愈成功，实际：${(r.stage?.warnings || []).join('; ')}`);
    assert.equal(r.healed.used, true, '走了自愈路径');
    assert.equal(r.healed.fallback, false, '停在"降级重试"这一层（没到世界安静一步）');
    assert.equal(r.ssot.meta.tick, 4, '★tick 前进了（停摆治好的机械判据）');
    const titles = r.ssot.events.filter((e) => (e.id || '').startsWith('ev_4_')).map((e) => e.title);
    assert.ok(titles.includes('写得对的事'), `对的那条照常落账（实际 ${titles.join('/')}）`);
    assert.ok(!titles.includes('缺位置的事'), '写歪的那条没落账');
    assert.ok((r.stage.warnings || []).some((x) => x.startsWith('提议丢弃') && x.includes('缺位置的事')), '★丢了谁、为什么，必须留痕（不是静默丢）');
});

test('死锁丙-2：一条事件被丢 ⇒ 引它的盘算也留不住（连锁），但不影响同轮其它提议', () => {
    const w = world({ tick: 3 });
    const step = stepWith({
        newEvents: [{ title: '缺位置', source: { type: 'state' }, ripples: ['e_a'] }],   // 会被丢
        newAgendas: [newAgenda({ source: { type: 'event', ref: 'ev_4_1' } })],            // 引的就是它 ⇒ 连锁丢
        actions: [{ entity: 'e_b', verb: '观望', position: '大营' }],                      // 与它无关 ⇒ 该活下来
    });
    const r = settleWithHealing({ ssot: w, step });
    assert.equal(r.ok, true, (r.stage?.warnings || []).join('; '));
    assert.equal(r.ssot.meta.tick, 4);
    assert.equal((r.ssot.agendas || []).length, 0, '引用了被丢事件的盘算不该落账（否则第二轮仍不合法）');
    assert.ok((r.ssot.events || []).filter((e) => String(e.id).startsWith('ev_4_')).length === 0, '被丢的事件没落账');
    const droppedFamilies = r.healed.dropped.map((d) => d.family);
    assert.ok(droppedFamilies.includes('newEvents'), '事件被丢');
    assert.ok(droppedFamilies.includes('newAgendas'), '盘算被连锁丢');
});

test('死锁丙-2：净化后仍过不了校验的（涉及面超限这类丢不干净的）⇒ 落到世界安静一步，tick 仍然前进', () => {
    const w = world({ tick: 3 });
    // 造一条"净化器治不了"的：newAgendas 缺 visibility / goal（schema 必填，净化器只做减法、不给它编内容）
    const step = stepWith({ newAgendas: [{ entity: 'e_a', source: { type: 'state' } }] });
    assert.equal(checkWorldStep(step, w).ok, false);
    const clean = dropInvalidProposals(step, w);
    assert.equal(checkWorldStep(clean.step, w).ok, true,
        '★这一格其实能被净化救回来（缺目标 ⇒ 丢掉那条盘算）——这条锁住"净化确实管用"');
    const r = settleWithHealing({ ssot: w, step });
    assert.equal(r.ok, true, (r.stage?.warnings || []).join('; '));
    assert.equal(r.ssot.meta.tick, 4, 'tick 前进');
    assert.equal((r.ssot.agendas || []).length, 0, '那条残缺的盘算没落账');
});

test('死锁丙-2：净化的覆盖面——schema 硬约束的字段也要能丢（`maxSteps` 越界 / `visibility` 枚举外）', () => {
    const w = world({ tick: 3 });
    // ★这一格是本笔**自己用例抓出来的缺口**：第一版净化器只核"存不存在"，于是 `maxSteps: 99` 被
    //   **原样递给引擎**、再由 schema 判死整步 ⇒ 净化器白净化（降级重试等于没降）。
    //   夹具让议程有合法的同轮事件源（否则它会因"引不存在的事件"被丢掉，测不到本条）。
    const step = stepWith({
        newEvents: [newEvent()],
        newAgendas: [
            newAgenda({ maxSteps: 99 }),                                  // 越界 ⇒ 丢
            newAgenda({ visibility: 'secret' }),                          // 枚举外 ⇒ 丢
            newAgenda({ goal: '这条是好的' }),                             // 好 ⇒ 留
        ],
    });
    assert.equal(checkWorldStep(step, w).ok, false, '先证红：原样不合法');
    const { step: clean, dropped } = dropInvalidProposals(step, w);
    assert.equal(checkWorldStep(clean, w).ok, true, '净化后必须合法（这才是"净化管用"）');
    assert.equal(clean.newAgendas.length, 1, '只留下那条好的');
    assert.equal(clean.newAgendas[0].goal, '这条是好的');
    const reasons = dropped.map((d) => d.reason).join(' | ');
    assert.match(reasons, /maxSteps 越界/, '越界的理由要留在痕里');
    assert.match(reasons, /visibility/, '枚举外的理由要留在痕里');
});

test('死锁丙-3：最后一步（世界安静一步）本身必须走得通——空步合法、tick 前进、账上零提议', () => {
    // ★为什么 ③ 要存在：② 只对**提议**做减法，而"模型把某一组整个省掉"这类形状病一旦净化器救不回来，
    //   整步仍会被拒 ⇒ 若不兜底就还是停摆。③ 用空步照常推进一轮，把"卡轮"从"永久停摆"降级为"少一轮内容"。
    //   （真账与四臂实测里走到 ③ 的是 wide 臂第 5/6 轮那条"同轮引用"——现已由甲+② 治掉；
    //     ③ 是**剩下那部分**的保险，不追求被触发的次数，只追求"永远有路可走"。）
    const w = world({ tick: 3 });
    const r = settleTick({ ssot: w, step: emptyStep() });
    assert.equal(r.ok, true, `空步必须合法：${(r.stage?.warnings || []).join('; ')}`);
    assert.equal(r.ssot.meta.tick, 4, 'tick 前进');
    assert.equal((r.ssot.agendas || []).length, 0, '零提议落账');
    assert.equal((r.ssot.events || []).filter((e) => String(e.id).startsWith('ev_4_')).length, 0, '零新事件');
});

test('死锁丙-3：降级路径的回执必须进 stage.warnings（面板裁定条 + simLog 都读它，不许静默）', () => {
    const w = world({ tick: 3 });
    const step = stepWith({
        newEvents: [{ title: '缺位置', source: { type: 'state' }, ripples: ['e_a'] }],   // 会被丢
    });
    const r = settleWithHealing({ ssot: w, step });
    assert.equal(r.ok, true, (r.stage?.warnings || []).join('; '));
    const txt = (r.stage.warnings || []).join(' | ');
    assert.match(txt, /提议丢弃/, '★"丢了哪一条"要写在告警里（`提议丢弃:` 前缀 ⇒ 计入拒签分子）');
    assert.match(txt, /缺位置/, '要写清为什么丢');
    assert.ok(r.healed.errors.length > 0, '原始拒因也要留在 healed.errors 里（可查）');
});

// ---------- ③ 回归：修复不该顺手放开别的闸 ----------
test('死锁修复的边界：净化的每一步都不许"改写"模型的提议（只做减法）', () => {
    const w = world({ tick: 3 });
    const step = stepWith({
        newEvents: [newEvent({ title: '这事写得很好' }), { title: '缺位置', source: { type: 'state' }, ripples: ['e_b'] }],
        newEntities: [{ name: '新面孔', location: '大营', entity: 'e_a', source: { type: 'entity', ref: 'e_b' } }],
    });
    const { step: clean } = dropInvalidProposals(step, w);
    assert.equal(clean.newEvents.length, 1);
    assert.equal(clean.newEvents[0].title, '这事写得很好', '★留下的那一条必须**逐字**是模型写的（引擎不改写）');
    assert.equal(clean.newEntities[0].name, '新面孔', '合法的新实体不许被顺手丢掉');
    // 确定性：同输入两次 ⇒ 逐字节相同（同一轮重放必须同结果）
    const again = dropInvalidProposals(step, w);
    assert.equal(JSON.stringify(again.step), JSON.stringify(clean), '净化必须确定性（同输入 ⇒ 同输出）');
});

test('死锁修复的边界：selfHeal=false 时保持旧行为（校验拒绝 ⇒ 世界原样不动）', () => {
    const w = world({ tick: 3 });
    const step = stepWith({ newEvents: [{ title: '缺位置', source: { type: 'state' }, ripples: ['e_b'] }] });
    const r = settleWithHealing({ ssot: w, step, selfHeal: false });
    assert.equal(r.ok, false, '关掉自愈 ⇒ 退回"拒整步"的旧语义');
    assert.equal(r.ssot.meta.tick, 3, '世界原样不动');
});

test('死锁修复：空步是合法步（世界安静一步这条路本身必须走得通）', () => {
    const w = world({ tick: 3 });
    const r = settleTick({ ssot: w, step: emptyStep() });
    assert.equal(r.ok, true, `空步必须合法：${(r.stage?.warnings || []).join('; ')}`);
    assert.equal(r.ssot.meta.tick, 4);
});
