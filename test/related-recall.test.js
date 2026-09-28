// story-world-v2/test/related-recall.test.js
// ★★★leg132「相关往事」判据：**引擎替模型翻旧账，本轮到位**。
//
// 这一批治的是什么病（一句话）：
//   `纪事`（往事）那一栏是**没有选择**的——它只认"最新"，装不下就从**最旧的**开始丢。
//   于是长跑里必然发生：一件四十轮前结下的事，从模型眼前永久消失，而它这一轮恰好要用。
//   实测（真模型长跑）：包一旦被裁，够不着的事件 0% → 4.2%（预算 12000）→ 17.1%（5000）→ **35%（3000）**；
//   真被裁过的那一跑终态，**123 件事里 61 件（49.6%）模型再也够不着**。
//
// 这一批要钉死的六条（每条都对应上一条实测）：
//   · **R1 本轮到位**：那一栏与 `纪事` **在同一份包里**——不靠"模型点名、下一轮给"。
//     ★那条老通道在结构上就不合格：模型一开口，这一轮的输出已经在生成中，它没法先问一句。
//   · **R2 相关性只用账上真有的字**：这一轮"正在动的东西"（上场实体的**真名** ＋ 未决事件标题
//     ＋ 在飞盘算的目标原话）拼成查询，命中理由**人看得出来**——不是黑箱。
//   · **R3 不重复占额度**：一份往事只出现在一栏里（按**行身份**排重），两栏加起来不漏。
//   · **R4 真的救回了"被丢的那一段"**：救回的行**比 `纪事` 里最旧的还旧**——否则它只是个摆设。
//   · **R5 有空才挂键**：没命中 ⇒ 键不出现（空着就是空着）。
//   · **R6 越紧越先牺牲"没选择"的那一条**：预算不够时先丢 `纪事`，保住"有选择"的这一栏；
//     真丢到它头上时，它那几行**退回 `纪事` 的候选池**（不凭空蒸发）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvolutionPack, RELATED_BUDGET_SHARE, windowFromTick, RECENT_WINDOW_TURNS } from '../src/pack.js';
import { linesOf, pickLinesForPack } from '../src/lines.js';

/** 一行带真名的旧事（名字必须是**账上实体真名**且 ≥2 字——`按真名取` 只认长度 ≥2 的）。 */
const named = (t) => ({ tick: t, text: `事件「白小娥第${t}件旧事」——沿「更早那件」而来，事发 中央，牵动 白小娥` });
/** 一行与谁都不相干的杂事（它只能靠"最新优先"进包）。 */
const filler = (t) => ({ tick: t, text: `事件「杂事第${t}件」——由世界处境而生，事发 中央，牵动 无名氏` });

/** 120 行编年：每 6 轮一件带真名的旧事，其余是杂事。tick 1..120，账上现在是第 120 轮。 */
function world(rows = 120, tickNow = 120) {
    const chronicle = [];
    for (let t = 1; t <= rows; t += 1) chronicle.push(t % 6 === 0 ? named(t) : filler(t));
    return {
        entities: [{ id: 'e_a', kind: 'character', name: '白小娥', location: '中央' }],
        agendas: [], events: [], weights: {}, chronicle,
        context: { world: '测试界', positions: ['中央'] },
        meta: { tick: tickNow },
    };
}
const build = (ssot, budget) => buildEvolutionPack(ssot, null, {
    picks: ['e_a'],
    ...(budget ? { lim: { 包预算: budget } } : {}),
});
const ticks = (arr) => (Array.isArray(arr) ? arr.map((r) => Number(r.tick)) : []);

// ── R1＋R2：那一栏真的挂在同一份包里，且每一行都真的和"这一轮在动的人"有关 ──────────
test('leg132·R1/R2：引擎在出包那一刻就把旧账翻出来（同一份包，不问模型）；命中的每一行都真的提到那个人', () => {
    const w = world();
    const p = build(w, 800);
    const pack = p.pack;
    assert.ok(Array.isArray(pack.相关往事), '★R1：那一栏必须**在包里**（本轮到位，不是下一轮）');
    assert.ok(pack.相关往事.length > 0, '有命中就该有内容');
    for (const r of pack.相关往事) {
        assert.match(r.text, /白小娥/, '★R2：相关性只认"账上真有这个名字"——命中理由人看得出来');
        assert.equal(typeof r.tick, 'number', '行形状与 `纪事` 同一把尺：{tick, text}');
    }
});

// ── R3＋R4：不重复，而且真的救回了"被最新优先丢掉的那一段" ────────────────────────
test('leg132·R3/R4：两栏不重复；救回的那几行**比 `纪事` 里最旧的还旧**（否则它只是个摆设）', () => {
    const p = build(world(), 800);
    const pack = p.pack;
    assert.ok(Array.isArray(pack.纪事) && pack.纪事.length, '这一跑的预算是紧的 ⇒ `纪事` 该被裁过');
    const inBoth = pack.相关往事.filter((r) => pack.纪事.includes(r));
    assert.equal(inBoth.length, 0, '★R3：一份往事只许出现在一栏里（两栏按**行身份**排重）');

    const oldestKept = Math.min(...ticks(pack.纪事));
    const oldestRescued = Math.min(...ticks(pack.相关往事));
    assert.ok(oldestRescued < oldestKept,
        `★R4：救回来的必须比"最新优先"留得住的那一段更旧（救回 ${oldestRescued} < 纪事最旧 ${oldestKept}）`);
});

// ── R3（另一面）：两栏**分工不重叠**——窗口内的归 `纪事`，窗口外的按相关度进这一栏 ──────────
// ★★★leg133 改口径（**这是设计变更，不是把判据放松**，留档免得下一任误读）：
//   原口径是"预算宽裕时两栏加起来一行不漏（搬家不许变成丢料）"——那是在**没有窗口**的年代写的：
//   那时 `纪事` 只受预算约束 ⇒ 预算够就全在，两栏加起来自然等于全量。
//   ★本笔立了窗口（用户拍板「我认为50轮」）⇒ **口径变成**：`纪事` **只装窗口内**，
//   窗口外那一段**只有"相关"的才进包**（用户同一条令：「索引一定要保证相关度」）。
//   ⇒ 于是"两栏加起来 = 全量"**不再成立，也不该成立**：窗口外那些与当下无关的旧行**就是要让它走**
//     （否则"最近 N 轮"又变成随预算浮动的软偏好，见 `test/recent-window.test.js` 的 W3/W7）。
//   新口径钉三件：**① 窗口内一行不少；② 两栏不重叠；③ 这一栏的每一行都真的相关。**
test('leg133·R3（改口径）：窗口内一行不少 · 两栏不重叠 · 这一栏每一行都相关', () => {
    const w = world();
    const tickNow = 120;
    const floor = windowFromTick(tickNow, RECENT_WINDOW_TURNS);
    const p = build(w, null);                  // 出厂预算 30000：窗口那一段全装得下
    const pack = p.pack;
    const inChron = ticks(pack.纪事);
    const inRel = ticks(pack.相关往事);

    // ① 窗口内一行不少（120 行里，第 floor..120 轮那一段必须全在 `纪事` 里）
    const expectWindow = w.chronicle.map((r) => r.tick).filter((t) => t >= floor);
    assert.deepEqual(inChron.filter((t) => t >= floor), expectWindow,
        `★窗口内那 ${expectWindow.length} 行必须一条不少（实测 ${inChron.filter((t) => t >= floor).length} 行）`);

    // ② 两栏不重叠（按行身份）
    const inBoth = (pack.相关往事 || []).filter((r) => (pack.纪事 || []).includes(r));
    assert.equal(inBoth.length, 0, '★一份往事只许出现在一栏里');

    // ③ 这一栏的每一行都在窗口外、且都相关（提到账上真名）
    for (const r of pack.相关往事 || []) {
        assert.ok(Number(r.tick) < floor, `★这一栏只装窗口外（tick=${r.tick}，下界=${floor}）`);
        assert.match(r.text, /白小娥/, '★相关度：每一行都要点到账上真有的钥匙');
    }
});

// ── R5：没命中 ⇒ 键不出现（空着就是空着；旧世界逐字节回到今天） ─────────────────────
test('leg132·R5：没有可问的东西 ⇒ 键不出现（不挂空栏、不抛错）', () => {
    const w = world();
    w.entities = [];                            // 账上没有真名可取 ⇒ 查询为空
    const p = buildEvolutionPack(w, null, { picks: null, lim: { 包预算: 800 } });
    assert.equal('相关往事' in p.pack, false, '★R5：取不到 ⇒ 键不挂（空着就是空着）');
});

// ── R6：越紧，越先牺牲"没有选择"的那一条 ────────────────────────────────────────
test('leg132·R6：预算紧到"往事"先被拿掉时，新栏照旧活着（裁剪序把"有选择"的那一条排在后面）', () => {
    const p = build(world(), 800);
    const trimmed = Array.isArray(p.pack.trimmed) ? p.pack.trimmed : [];
    assert.ok(trimmed.some((s) => String(s).startsWith('纪事')), '★"往事"那一栏被裁过（预算真的紧到那一步）');
    assert.ok(Array.isArray(p.pack.相关往事), '★而"有选择"的那一栏活下来了——这是"最大化阻止失忆"在裁剪序上的落地');
});

// ── 口径常量本身也要被钉住（免得有人"顺手"把它拧成 0 或 1） ────────────────────────
// ★本笔删掉"最小年龄"那一格（`RELATED_MIN_AGE`，连同 import）：它**已被窗口判据整段吃掉**——
//   这一栏现在只认 `t < floor`（`floor = windowFromTick(tickNow, 往事轮数)`）：
//   往事轮数 50 ⇒ 最旧可到 50 轮前、30 ⇒ 30 轮前；只有把「往事轮数」填到 ≤11 才会轮到"最小年龄"咬人，
//   而出厂档位是 30/50 ⇒ 留着它就是**同一条口径的第二把尺子**（永不生效的那种）。
//   ★窗口那条口径不是没人管：下面 leg133 的 R3 用例逐行锁着"这一栏只装窗口外"。
test('leg132：这一栏的尺度是"尺"不是"闸"——份额在 (0,1) 之间', () => {
    assert.ok(RELATED_BUDGET_SHARE > 0 && RELATED_BUDGET_SHARE < 1, '份额必须在开区间里');
});

// ══════════════════════════════════════════════════════════════════════════════
// 全史索引：地图不许"只说得出来最近 500 轮"，而且**截了要说**
// ══════════════════════════════════════════════════════════════════════════════
// 病（实测）：`LINES_TOP = 40`，而每 500 轮立出 24.4～40.6 条线 ⇒ 一屏只装得下约 500 轮。
//   一万轮时账上 488～812 条线，模型只看得见 40 条（5%～8%），而它是**按收口轮次从新到旧**截的
//   ⇒ 第 3,000 轮立的那条线，**在模型眼里从来没有存在过**，而且它连"地图被截过"都不知道。

/** 造 `n` 族线（每族 5 件全收口，根是 `state` 源 ⇒ 立得起线）；第 1 族身上挂一个"在动的人"。 */
function manyLines(n) {
    const events = [];
    for (let i = 1; i <= n; i += 1) {
        for (let k = 0; k < 5; k += 1) {
            events.push({
                id: `ev_${i}_${k}`, title: `第${i}族第${k}件`, position: '中央',
                source: k === 0 ? { type: 'state' } : { type: 'ripple', ref: `ev_${i}_${k - 1}` },
                ripples: i === 1 && k === 2 ? ['e_x'] : [],           // ★只有第 1 族波及"在动的人"
                closed: true, links: { up: [], down: [] },
            });
        }
    }
    events.push({                                                  // 一件**没收口**的事 ⇒ 它波及的人"正在动"
        id: 'ev_999_1', title: '眼下还没了结的那件事', position: '中央',
        source: { type: 'state' }, ripples: ['e_x'], closed: false, links: { up: [], down: [] },
    });
    return {
        entities: [{ id: 'e_x', kind: 'character', name: '白小娥', location: '中央' }],
        agendas: [], events, weights: {}, chronicle: [],
        context: { world: '测试界', positions: ['中央'] }, meta: { tick: 999 },
    };
}

// ── I1：老而**相关**的线要进得来（这正是"最近 500 轮"之外那一大片） ────────────────
test('leg132·I1：全史索引——一条**很老但相关**的线能进前 40，而老的"只看收口轮次"进不来', () => {
    const w = manyLines(60);                                       // 账上 60 条线，一屏只装 40 条
    const byRecency = linesOf(w).lines.map((l) => l.根);            // 今天那把尺：收口轮次从新到旧
    assert.equal(byRecency.includes('ev_1_0'), false, '前提：按收口轮次截，第 1 族那条老线根本进不来');
    const picked = pickLinesForPack(w);
    assert.equal(picked.total, 60, '★`total` = 账上真有几条（这个数一直被算出来又被丢掉）');
    assert.equal(picked.lines.length, 40, '一屏还是 40 条（预算没变，变的是"挑哪 40 条"）');
    assert.equal(picked.lines[0].根, 'ev_1_0', '★相关的那条老线排在最前——它现在看得见了');
});

// ── I2：截了就要说（`total` 算得出来却没人用，是旧账） ──────────────────────────
test('leg132·I2：地图被截时**如实说出一共几条**（不许给一张残缺却不说破的地图）', () => {
    const p = buildEvolutionPack(manyLines(60), null, {});
    assert.ok(Array.isArray(p.pack.故事线), '地图在');
    assert.equal(typeof p.pack.故事线说明, 'string', '★装不下 ⇒ 必须挂"一共几条"那句');
    assert.match(p.pack.故事线说明, /一共 60 条/, '说的数必须是账上真数');
    assert.match(p.pack.故事线说明, /没摆出来的不是没有/, '★必须点破"看不见 ≠ 不存在"');
});

// ── I3：没有相关线时**逐字等于今天**（旧世界零漂移） ─────────────────────────────
test('leg132·I3：一条相关线都没有时，挑出来的顺序与今天**逐字相同**（零漂移）', () => {
    const w = manyLines(60);
    for (const e of w.events) if (e.id === 'ev_999_1') e.ripples = [];   // 撤掉"在动的人"
    const picked = pickLinesForPack(w).lines.map((l) => l.根);
    const today = linesOf(w).lines.map((l) => l.根);
    assert.deepEqual(picked, today, '★没有相关信号 ⇒ 退化成今天那一把尺（旧账一个字节不动）');
});

// ── I4：装得下全部时，不挂那句废话（"有才挂键"） ───────────────────────────────
test('leg132·I4：线没被截时不挂说明（不留空话，旧输出逐字节不变）', () => {
    const p = buildEvolutionPack(manyLines(3), null, {});
    assert.equal(p.pack.故事线.length, 3, '3 条线全装得下');
    assert.equal('故事线说明' in p.pack, false, '★没被截 ⇒ 不挂');
});

