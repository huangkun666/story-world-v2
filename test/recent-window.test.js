// story-world-v2/test/recent-window.test.js
// ★★★leg133「往事窗口」判据：**"最近 N 轮"第一次有了硬保证**。
//
// 这一批治的是什么病（用户 2026-09-25 当场点破的）：
//   「**如果不界定最近的范围，那检索也不好做**」
//   —— 在这一笔之前，"最近的事"那一栏（`纪事`）**没有任何时间模型**：它只是"链尾往回数、
//      装到装不下"（`ledger-recall.js` 的 `modeRecent` 头注写得明白："账只往后加 ⇒ 尾巴就是最近的"）。
//      实测：**同一份账只换预算**，那一栏装进去的行数是 **625 / 241 / 122 / 33 / 0**
//      ⇒ 窗口多大**不是设计出来的，是预算挤出来的**——预算一紧，模型连"刚刚发生了什么"都看不见。
//
// 用户拍板的口径（逐字）：「**我认为50轮，旋钮要，索引一定要保证相关度**」⇒ 三件事：
//   · **N = 50 轮**（出厂值，`RECENT_WINDOW_TURNS`）；
//   · **一个旋钮**（`往事轮数`，走 `resolveLimits` 分发，与 `包预算` 同一条路）；
//   · **相关度必须保证**：窗口外预取回来的行，**每一行都要点到账上真有的钥匙**。
//
// 这一批要钉死的六条：
//   · **W1 窗口内一定在**：预算紧到把整栏压扁，**最近 N 轮那一段仍然在**（这是"硬保证"的定义）；
//   · **W2 窗口优先、降级从旧端走**：连窗口都装不下时，丢的是**窗口最旧的那一端**，不是随便丢；
//   · **W3 余量给更旧的**：窗口装得下时，剩下的余量拿去补**窗口外**的更旧那一段（不是重复装窗口内的）；
//   · **W4 相关度保证**：预取回来的**每一行**都点到"这一轮正在动的东西"的钥匙；
//   · **W5 只取窗口外**：`相关往事` 里的行**一律比窗口下界更旧**（不跟 `纪事` 抢同一段）；
//   · **W6 旋钮真的管事**：账上设的 `往事轮数` 一改，窗口跟着动（且旧账没设时回出厂 50）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvolutionPack, windowFromTick, RECENT_WINDOW_TURNS } from '../src/pack.js';
import { RECENT_WINDOW_TURNS as LIMIT_DEFAULT_WINDOW } from '../src/limits.js';

/** 一行带真名的往事（名字必须是账上实体真名，`按真名取` 只认 ≥2 字的）。 */
const named = (t) => ({ tick: t, text: `事件「白小娥第${t}件旧事」——沿「更早那件」而来，事发 中央，牵动 白小娥` });
/** 一行与谁都不相干的杂事（它只能靠"窗口内"或"最新优先"进包）。 */
const filler = (t) => ({ tick: t, text: `事件「杂事第${t}件」——由世界处境而生，事发 中央，牵动 无名氏` });

/** 一条 1..rows 的编年，每 6 轮一件带真名的；账上现在是第 `rows` 轮。 */
function world(rows = 300, tickNow = null) {
    const chronicle = [];
    for (let t = 1; t <= rows; t += 1) chronicle.push(t % 6 === 0 ? named(t) : filler(t));
    return {
        entities: [{ id: 'e_a', kind: 'character', name: '白小娥', location: '中央' }],
        agendas: [], events: [], weights: {}, chronicle,
        context: { world: '测试界', positions: ['中央'] },
        meta: { tick: tickNow ?? rows },
    };
}
const build = (ssot, lim) => buildEvolutionPack(ssot, null, { picks: ['e_a'], ...(lim ? { lim } : {}) });
const ticksOf = (arr) => (Array.isArray(arr) ? arr.map((r) => Number(r.tick)) : []);

// ── W1：窗口内那一段是**硬保证**（预算再紧也在） ────────────────────────────────
test('leg133·W1：预算紧到把整栏压扁，"最近 N 轮"那一段仍然在（窗口是硬保证，不是尽力而为）', () => {
    const w = world(300);                                  // 账上 300 轮，窗口下界 = 300-50+1 = 251
    const floor = windowFromTick(300, RECENT_WINDOW_TURNS);
    assert.equal(floor, 251, '★前提：50 轮窗口 ⇒ 下界 251（含本轮往前数 50 轮）');

    // ★先自证"这一跑真的裁到了那一栏"（否则下面的断言是空转）
    const tight = build(w, { 包预算: 3000, 往事轮数: RECENT_WINDOW_TURNS });
    const keptTight = ticksOf(tight.pack.纪事);
    assert.ok(keptTight.length > 0, '前提：紧预算下那一栏没被整栏拿掉（真走到了"留一部分"那一支）');
    assert.ok(keptTight.length < 250, `前提：真的被裁到很短（留了 ${keptTight.length} 行）`);

    // ★本条要钉的：**窗口内一条不许少**
    const windowRows = keptTight.filter((t) => t >= floor);
    const expectWindow = ticksOf(build(w, { 包预算: 1000000000, 往事轮数: RECENT_WINDOW_TURNS }).pack.纪事)
        .filter((t) => t >= floor);
    assert.deepEqual(windowRows, expectWindow,
        `★窗口内那 ${expectWindow.length} 行必须**一条不少**地留在包里（实测留了 ${windowRows.length} 行）`);
});

// ── W2：连窗口都装不下时，从**窗口最旧的那一端**降级（方向可预期） ────────────────
test('leg133·W2：预算紧到连窗口都装不下 ⇒ 丢的是窗口**最旧**的那一端，最新那条一定在', () => {
    const w = world(300);
    const { pack } = build(w, { 包预算: 200, 往事轮数: RECENT_WINDOW_TURNS });   // 极紧：连 50 轮都放不下
    const kept = ticksOf(pack.纪事);
    assert.ok(kept.length > 0, '★再紧也不许把"刚刚发生的事"整栏丢掉（至少留最新那一条）');
    assert.equal(kept[kept.length - 1], 300, '★最新那一条（本轮）必须在');
    // 留下的必须是**连续的最新尾巴**（不是"谁先来谁留下"）
    const span = kept[kept.length - 1] - kept[0] + 1;
    assert.equal(span, kept.length, `★留下的是连续的最新尾巴（留了 ${kept.length} 行，跨 ${span} 轮）`);
});

// ── W3：窗口是**硬边界**——预算宽裕也**不许**把更旧的往事塞回那一栏 ────────────────
test('leg133·W3：预算宽裕 ⇒ 那一栏仍是"最近 N 轮"，不拿余量去补更旧的（窗口是硬边界，不是软偏好）', () => {
    // ★口径（本笔定案，与第一版相反）：`纪事` **只装窗口内**，预算多出来**也不往回伸**。
    //   为什么（三条）：
    //     ① 若余量能把窗口撑大 ⇒ **"最近 N 轮"就随预算浮动**，又回到本笔要治的那个病
    //        （"窗口多大由预算挤出来"——实测旧行为是 625/241/122/33/0 行）；
    //     ② 窗口外的往事**另有通道**（`相关往事` 按相关度补，见 W4/W5），两条路各管一段；
    //     ③ 余量该留给别的栏（名册、在办的事、关系），而不是把"最近"这个概念撑歪。
    const w = world(300);                                   // 账上 300 轮，窗口 50 ⇒ 下界 251
    const floor = windowFromTick(300, RECENT_WINDOW_TURNS);
    const { pack } = build(w, { 包预算: 1000000000, 往事轮数: RECENT_WINDOW_TURNS });   // 大到不裁
    const kept = ticksOf(pack.纪事);
    assert.equal(kept.filter((t) => t < floor).length, 0,
        `★预算再宽，窗口外的一条都不许进来（窗口下界 ${floor}）`);
    assert.ok(kept.length > 0, '窗口内那一段在');
    assert.equal(kept[kept.length - 1], 300, '最新那一条在（那一栏仍读到本轮）');
    // ★余量去了哪里：窗口外的旧账走**另一栏**（按相关度取），不靠撑大 `纪事`
    const rel = Array.isArray(pack.相关往事) ? pack.相关往事 : [];
    assert.ok(rel.length > 0, '★窗口外的旧账由 `相关往事` 补（不是塞回 `纪事`）');
    assert.ok(rel.every((r) => Number(r.tick) < floor), '★而它取回来的**全在窗口外**（两栏不重叠）');
});

// ── W4＋W5：预取回来的行——**每一行都相关**，且**一律在窗口外** ────────────────────
test('leg133·W4/W5：`相关往事` 每一行都点到"正在动的人"的钥匙，且一律比窗口下界更旧', () => {
    const w = world(300);
    const floor = windowFromTick(300, RECENT_WINDOW_TURNS);
    const { pack } = build(w, { 包预算: 6000, 往事轮数: RECENT_WINDOW_TURNS });
    const rel = Array.isArray(pack.相关往事) ? pack.相关往事 : [];
    assert.ok(rel.length > 0, '前提：这一跑真的取回了窗口外的旧账（否则下面两条是空转）');
    for (const r of rel) {
        assert.match(r.text, /白小娥/, '★W4：相关度保证——每一行都必须点到账上真有的钥匙（"白小娥"）');
        assert.ok(Number(r.tick) < floor,
            `★W5：只取窗口外（这一行 tick=${r.tick}，窗口下界=${floor}）——窗口内的归 \`纪事\`，不重复占额度`);
    }
    // ★两栏不许重复（同一份往事只出现在一栏里）
    const inBoth = rel.filter((r) => (pack.纪事 || []).includes(r));
    assert.equal(inBoth.length, 0, '★一份往事只许出现在一栏里（两栏按行身份排重）');
});

// ── W6：旋钮真的管事（账上设的优先、没设回出厂 50） ────────────────────────────
test('leg133·W6：账上设的「往事轮数」真的改窗口；没设过 ⇒ 回出厂 50（旧账零扰动）', () => {
    assert.equal(RECENT_WINDOW_TURNS, 50, '★出厂值 = 用户拍板的 50 轮');
    assert.equal(LIMIT_DEFAULT_WINDOW, 50, '★旋钮出厂值与 `pack.js` 那一个**同源**（不许两处各写一个数）');

    const w = world(300);
    // ★预算取 4000：实测这一档**真裁在中间**（`纪事` 只留得下 160 行左右，而账上有 300 行）——
    //   取更宽的预算（8000/12000）时**整栏都装得下**，窗口那段逻辑根本不会被走到（判据会空转，等于没测）。
    const B = { 包预算: 4000 };
    const rowsOf = (turns) => ticksOf(build(w, { ...B, 往事轮数: turns }).pack.纪事);

    // ① 窗口调宽 ⇒ 窗口下界前移 ⇒ 窗口内那一段整段进来（包里最旧那一端明显往前伸）
    const w20 = rowsOf(20);    // 下界 281
    const w100 = rowsOf(100);  // 下界 201
    assert.equal(w20.filter((t) => t >= 281).length, 20, '★窗口 20 ⇒ 那 20 行**一条不少**');
    assert.equal(w100.filter((t) => t >= 201).length, 100, '★窗口 100 ⇒ 那 100 行**一条不少**');
    assert.ok(Math.min(...w100) <= Math.min(...w20), '★窗口调宽 ⇒ 覆盖的往事只多不少（下界前移）');

    // ② 窗口**大过预算装得下的量**时：降级从窗口最旧那一端走，且如实留痕
    const w200 = build(w, { ...B, 往事轮数: 200 }).pack;   // 下界 101，但这一档只装得下约 177 行
    const kept200 = ticksOf(w200.纪事);
    const inWin200 = kept200.filter((t) => t >= 101).length;
    assert.ok(inWin200 < 200 && inWin200 > 0,
        `★连窗口都装不下 ⇒ 留一部分（窗口内留了 ${inWin200}/200），不是整栏丢掉`);
    assert.equal(kept200[kept200.length - 1], 300, '★最新那一条一定在（降级从旧端走）');
    assert.ok((w200.trimmed || []).some((s) => String(s).startsWith('纪事.留')),
        '★被裁就如实留痕（痕与事实同数）');

    // ③ 没设过 ⇒ 与"显式设成 50"逐字节相同（旧账零扰动）
    const noLim = build(w, null);
    const explicit = build(w, { 往事轮数: 50 });
    assert.deepEqual(ticksOf(noLim.pack.纪事), ticksOf(explicit.pack.纪事),
        '★没设过这一格 ⇒ 行为等于出厂 50（旧账逐字节回到今天）');
});

// ── W7：★窗口是**装载范围**，不只是"裁剪偏好"（真模型 60 轮当场抓出来的那条） ──────
test('leg133·W7：预算宽裕到根本不会裁 ⇒ 那一栏仍然只有窗口内那一段（窗口不是"裁剪偏好"）', () => {
    // ★★★这一条是本笔**真模型 60 轮**抓出来的病（留档，免得下一任重踩）：
    //   第一版只让 `trimPack` 的额度守卫"优先保窗口"，而那条守卫**只在 `pack.纪事 === undefined`
    //   时才跑**（它管的是"整栏被固定序丢掉之后装回多少"）——出包侧早已把整栏挂上了
    //   ⇒ 那条分支**一次都没进** ⇒ 实测末轮 `纪事` **684 行**（窗口只有 50 轮 ≈ 540 行）。
    //   病根：把"窗口"当成了**裁剪偏好**（预算紧时才起作用），而它其实是**装载范围**（任何时候都管）。
    const w = world(300);                                   // 账上 300 轮，窗口 50 ⇒ 下界 251
    const floor = windowFromTick(300, RECENT_WINDOW_TURNS);
    const { pack } = build(w, { 包预算: 1000000000, 往事轮数: RECENT_WINDOW_TURNS });   // 大到不裁
    assert.equal(pack.trimmed, undefined, '★前提：这一跑**根本没裁**（所以"窗口"只可能来自装载那一步）');
    const kept = ticksOf(pack.纪事);
    const older = kept.filter((t) => t < floor);
    assert.equal(older.length, 0,
        `★窗口外的往事**一条都不许进那一栏**（实测进了 ${older.length} 行；窗口下界 ${floor}）`);
    assert.ok(kept.length > 0 && kept.every((t) => t >= floor), '★留下的全部在窗口内');
});

// ── 窗口下界那个函数本身（边界：含本轮、非有限输入回出厂） ──────────────────────
test('leg133：`windowFromTick` 的边界——含本轮往前数 N 轮；坏输入回出厂值（不发明轮次）', () => {
    assert.equal(windowFromTick(100, 50), 51, '100 轮 · 窗口 50 ⇒ 下界 51（含 51..100 共 50 轮）');
    assert.equal(windowFromTick(100, 1), 100, '窗口 1 轮 ⇒ 只有本轮');
    assert.equal(windowFromTick(0, 50), -49, '第 0 轮的世界照算（不特殊照顾）');
    assert.equal(windowFromTick(100, 0), 51, '★窗口 0/负数 ⇒ 回出厂 50（不许把窗口拧成"全空"）');
    assert.equal(windowFromTick(100, 'x'), 51, '★非数字 ⇒ 回出厂 50');
    assert.equal(windowFromTick(NaN, 50), -49, '★账上没有 tick ⇒ 按 0 算（不抛、不发明）');
});
