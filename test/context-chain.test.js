// story-world-v2/test/context-chain.test.js
// ★★★leg128（用户令「把整个链路打通，包含多因点」· 设计 `docs/spec-context-master.md`）：
//   **上下文那条链的端到端判据**——一条链走到底：
//     账 →（切树 · 立线）→ **线进包** → 模型**点名** → 下一轮递**那一条的经过**。
//   外加"多因点"那一格：模型写 `alsoCausedBy` ⇒ 落账并进 `links.up` ⇒ 切树时**认得出来**。
//   ★为什么这几条必须挨在一起测：这条链每一段单独绿、合起来断的例子，本仓有过不止一次
//     （"函数写好了、没人调"/"接线前后逐行相同、但没人调用它"——见 leg25f 那条病历）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEvolutionPack } from '../src/pack.js';
import { linesOf, lineIndexOf, sanitizeLineRequests, nodesOf, pickLinesToPrefetch, buildLineDetail } from '../src/lines.js';
import { runTick } from '../src/tick.js';

// 一份"账"：一棵 5 件、全收口的树（够 N=5 ⇒ 立得起一条线，其中 ev_4_1 是**多因点**）
//   ＋ 一棵 2 件的小树（丙级：不够格，不立线）。
const ev = (id, title, src, closed = true, up = []) => ({ id, title, source: src, closed, position: '中央', links: { up, down: [] } });
function world(over = {}) {
    return {
        entities: [{ id: 'e_a', kind: 'character', name: '甲', location: '中央' }],
        agendas: [], weights: {},
        context: { world: '测试界', positions: ['中央'], playerId: null },
        meta: { tick: 9 },
        chronicle: [], milestones: [],
        events: [
            ev('ev_1_1', '死煞杀局启动', { type: 'state' }),
            ev('ev_2_1', '粮道被截', { type: 'ripple', ref: 'ev_1_1' }, true, ['ev_1_1']),
            ev('ev_3_1', '内应叛变', { type: 'ripple', ref: 'ev_1_1' }, true, ['ev_1_1']),
            ev('ev_4_1', '商队覆灭', { type: 'ripple', ref: 'ev_2_1' }, true, ['ev_2_1', 'ev_3_1']),
            ev('ev_5_1', '残部西逃', { type: 'ripple', ref: 'ev_4_1' }, true, ['ev_4_1']),
            ev('ev_6_1', '山道塌方', { type: 'state' }),
            ev('ev_7_1', '商旅绕行', { type: 'ripple', ref: 'ev_6_1' }, true, ['ev_6_1']),
        ],
        ...over,
    };
}

test('★链①：故事线那一栏进包——一行一条、行首是根 id（点名的把手）、排在往事之前', () => {
    const p = buildEvolutionPack(world(), null).pack;
    assert.equal(Array.isArray(p.故事线), true, '有线就该挂这一栏');
    assert.equal(p.故事线.length, 1, '只有那棵 5 件全收口的树够格（2 件那棵是丙级）');
    assert.match(p.故事线[0], /^ev_1_1 死煞杀局启动 第1轮 → 5件 → 残部西逃 第5轮/);
    assert.match(p.故事线[0], /合流1/, '★多因点在行上如实可见');
    // ★先装地图、再装地皮：键序上它在往事之前（往事由末道额度守卫最后按最新装回来）
    const keys = Object.keys(p);
    if (keys.includes('纪事')) assert.ok(keys.indexOf('故事线') < keys.indexOf('纪事'), '地图在往事之前');
});

test('★链①b：没有线可立 ⇒ 那一栏根本不出现（空着就是空着；旧账逐字节不变）', () => {
    const p = buildEvolutionPack(world({ events: [] }), null).pack;
    assert.equal('故事线' in p, false);
});

test('★链②：点名取回——写行首那个根 id ⇒ 递那一条的经过（因果序 · 账上原文）', () => {
    const w = world();
    const root = linesOf(w).lines[0].根;
    w.meta = { ...w.meta, lineRequests: [root] };
    const p = buildEvolutionPack(w, null).pack;
    assert.match(p.线的经过[0], new RegExp(`^${root}：\\[1\\]死煞杀局启动 → \\[2\\]粮道被截`), '从根起、按因果序');
    assert.match(p.线的经过[0], /\[5\]残部西逃$/, '一直走到这条线的收口那件');
});

// ★★★leg151（**这条判据改了，是"按设计作废"不是回归**）：原来最后那一问是
//   「编的根 id ⇒ **一条都不给**（键不出现）」。leg151 把发起权收回引擎之后，**引擎自己会预取**
//   ⇒ 键本来就该出现（里面有引擎挑的线）。⇒ 断言收窄到**它真要钉的那件事**：
//   **账上没有的号，引擎绝不替它造一条出来**（原来那句"键不出现"是借了旧通道的形状才成立的）。
test('★★★leg151：模型写一个账上没有的号 ⇒ 引擎不许替它造（也不许把整栏弄没）', () => {
    const w2 = world({ meta: { tick: 9, lineRequests: ['ev_999_9'] } });
    const p2 = buildEvolutionPack(w2, null).pack;
    const rows = p2['线的经过'] || [];
    assert.equal(rows.some((r) => String(r).startsWith('ev_999_9')), false, '★编的号一条都不给（不许替它造）');
    for (const row of rows) {
        assert.equal(linesOf(w2, { top: Infinity }).lines.some((ln) => String(row).startsWith(`${ln.根}：`)), true,
            `★摆出去的每一条都必须是账上真立得出的线（实际「${row}」）`);
    }
});

test('★链②b：可点名的集合＝**这一轮真递出去的那一批**（没立线的点不到）', () => {
    const idx = lineIndexOf(linesOf(world()).lines);
    assert.deepEqual(sanitizeLineRequests(['ev_1_1'], idx), { ok: ['ev_1_1'], missed: [] });
    // 丙级那棵（2 件）根本没进那一栏 ⇒ 点它算"对不上"，如实落 missed
    assert.deepEqual(sanitizeLineRequests(['ev_6_1'], idx), { ok: [], missed: ['ev_6_1'] });
});

test('★链③：多因点——模型写 alsoCausedBy ⇒ 落账并进 links.up ⇒ 切树时认得出来', async () => {
    const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/golden-world.min.json', import.meta.url), 'utf8'));
    const w = structuredClone(GOLDEN);
    const step = {
        actions: [],
        newEvents: [
            { title: '万法阁拍板动手', source: { type: 'plot', ref: 'a_1' }, position: '临渊城' },
            // ★这一件是**多因**：主因是那条在办的事（盘算 a_1），**另外**因为本轮第一件。
            //   模型写不出本轮的号（引擎还没发）⇒ 照 `ref-rules.js` 那条**位次**老路认。
            { title: '三路齐发', source: { type: 'plot', ref: 'a_1' }, position: '临渊城', alsoCausedBy: ['ev_9_1'] },
        ],
        agendaAdvances: [{ agendaId: 'a_1', step: '部署已定', stage: '动手' }],
        newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = await runTick({ transport: async () => ({ text: JSON.stringify(step) }), ssot: w, dialogue: '（继续）' });
    assert.equal(r.ok, true, `多因那一格不该把整步写坏：${r.error || ''}`);
    const first = r.ssot.events.find((e) => e.title === '万法阁拍板动手');
    const second = r.ssot.events.find((e) => e.title === '三路齐发');
    assert.ok(first && second, '两件都落账了');
    assert.deepEqual(second.links.up, [first.id],
        '★多因并进合流表，且**位次**认成了本轮第一件（账上不许留悬空号）');
    // 切树时它是**多因点**（主因是盘算 a_1 ⇒ 单独算一条因，合流表里再有一条 ⇒ ≥2）
    assert.equal(nodesOf(r.ssot).get(second.id).causes, 2, '多因点：记下来的因 ≥ 2 条');
    // ★而它的**来路仍然单亲**（划分不破）——这正是"两个指针分工"要保住的那件事
    assert.equal(second.source.type, 'plot', '来路照旧是一条（source 永远单亲）');
});

test('★链③b：对不上的因**丢掉它、不丢整步**，账上也不留悬空指针', async () => {
    const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/golden-world.min.json', import.meta.url), 'utf8'));
    const w = structuredClone(GOLDEN);
    const step = {
        actions: [],
        newEvents: [
            { title: '孤零零的一件', source: { type: 'plot', ref: 'a_1' }, position: '临渊城', alsoCausedBy: ['ev_77_77'] },
        ],
        agendaAdvances: [{ agendaId: 'a_1', step: '推进一步', stage: '推进' }],
        newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = await runTick({ transport: async () => ({ text: JSON.stringify(step) }), ssot: w, dialogue: '（继续）' });
    assert.equal(r.ok, true, '一条写歪的因不该陪葬整轮');
    const landed = r.ssot.events.find((e) => e.title === '孤零零的一件');
    assert.deepEqual(landed.links.up, [], '对不上的因被丢掉（不写悬空指针——账房不许留指不着的东西）');
});

// ★★★leg151（**改口径，不是放宽**）：这一条原来是"链④：点名只递那一轮"——
//   它锁的是**旧通道**（模型点名 → 下一轮给）。leg151 把发起权收回引擎之后，那一整条已被取代
//   （用户逐字判死：「**下一轮才给查询结果就是垃圾**」）⇒ 旧断言**按设计作废**（留档在 `docs/spec-memory-engine.md` §1）。
// ★**但那条修治过的真病不许复发**：旧写法「只在模型**写了**那一格时才动账 ⇒ 不写 ⇒ 旧值留着 ⇒
//   **那条线的经过每轮重复递下去**（实测：点名 2 次、递出 4 次）」。⇒ 换成预取之后，
//   **"不重复"这件事必须由判据继续钉着**，而它只有**真的跑两轮**才量得到（只在出包那一层看不出）。
// ★★为什么夹具是**五**条线：预取的上界是 `LINES_PREFETCH_TOP`（3）。
//   用两条线量不到"让位"——第一条就把两条都递了（**本笔第一版就栽在这里**：判据的前提写窄了）。
//   ⇒ 五条线才同时量得到两件事：**上界真的封住第一轮** · **递过的第二轮真的让位**。
const fiveLinesWorld = () => {
    const nodes = [];
    for (let i = 1; i <= 5; i += 1) {
        nodes.push(ev(`ev_${i}_1`, `乱起之${i}`, { type: 'state' }));
        nodes.push(ev(`ev_${i}_2`, `波及之${i}`, { type: 'ripple', ref: `ev_${i}_1` }));
        nodes.push(ev(`ev_${i}_3`, `反侧之${i}`, { type: 'ripple', ref: `ev_${i}_1` }));
        nodes.push(ev(`ev_${i}_4`, `崩坏之${i}`, { type: 'ripple', ref: `ev_${i}_2` }));
        nodes.push(ev(`ev_${i}_5`, `收束之${i}`, { type: 'ripple', ref: `ev_${i}_4` }));
    }
    return {
        entities: [{ id: 'e_a', kind: 'character', name: '甲', location: '中央' }],
        agendas: [], weights: {},
        context: { world: '测试界', positions: ['中央'], playerId: null },
        meta: { tick: 9 }, chronicle: [], milestones: [],
        events: nodes,
    };
};

test('★★★leg151：预取是**每轮的快照**，不许"递过就一直递"（旧病不许复发，两轮才量得到）', async () => {
    const w = fiveLinesWorld();
    const roots = linesOf(w, { top: Infinity }).lines.map((ln) => String(ln.根));
    assert.equal(roots.length, 5, `前置：要五条线才量得到"上界 ＋ 让位"（实际 ${roots.length}：${roots.join('/')}）`);
    const empty = { actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] };
    const feed = (ssot, step) => runTick({ transport: async () => ({ text: JSON.stringify(step) }), ssot, dialogue: '（继续）' });
    const rootOf = (row) => String(row).split('：')[0];

    const r1 = await feed(w, empty);
    assert.equal(r1.ok, true, r1.error || '');
    const line1 = r1.pack.pack['线的经过'];
    assert.equal(Array.isArray(line1), true, '第一轮就该递（当轮到位）');
    assert.equal(line1.length, 3, `★上界封住一轮：五条线里这一轮只递 3 条（实际 ${line1.length}）`);
    const delivered1 = line1.map(rootOf);
    for (const id of delivered1) assert.equal(roots.includes(id), true, `递的必须是账上真算得出的线的根（实际「${id}」）`);
    assert.equal(new Set(delivered1).size, delivered1.length, '同一轮里不许把同一条线递两遍');

    // ★第 2 轮：**同一份账** —— 递过的那三条必须让位，剩下的两条该轮到
    const r2 = await feed(r1.ssot, empty);
    assert.equal(r2.ok, true, r2.error || '');
    const line2 = r2.pack.pack['线的经过'];
    assert.equal(Array.isArray(line2), true, '★还有线没递过 ⇒ 这一轮该轮到它们（不许"递过就不再给"）');
    const delivered2 = line2.map(rootOf);
    assert.equal(delivered2.length, 2, `★剩两条正好递完（实际 ${delivered2.length}）`);
    for (const id of delivered2) {
        assert.equal(delivered1.includes(id), false, `★旧病反证：递过的「${id}」不许第二轮接着递（修之前实测"点名 2 次、递出 4 次"）`);
        assert.equal(roots.includes(id), true, `第二轮递的也必须是真线的根（实际「${id}」）`);
    }

    // ★第 3 轮：五条都递过了 ⇒ **一条都不该再递**（键不出现）
    const r3 = await feed(r2.ssot, empty);
    assert.equal(r3.ok, true, r3.error || '');
    assert.equal('线的经过' in r3.pack.pack, false, '★全递过 ⇒ 这一轮没有可预取的 ⇒ 那一栏根本不出现');
});

test('★★★leg151：没有线的世界零扰动——跑两轮也不许长出任何新键（旧账逐字节不变）', async () => {
    const empty = { actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] };
    const feed = (ssot, step) => runTick({ transport: async () => ({ text: JSON.stringify(step) }), ssot, dialogue: '（继续）' });
    const r1 = await feed(world({ events: [] }), empty);
    assert.equal(r1.ok, true, r1.error || '');
    assert.equal('linesShown' in r1.ssot.meta, false, '★取不到料 ⇒ 连"递过"都不许记（零扰动）');
    assert.equal('lineRequests' in r1.ssot.meta, false, '旧键也不许冒出来');
    const r2 = await feed(r1.ssot, empty);
    assert.equal('linesShown' in r2.ssot.meta, false, '跑两轮也一样（不许"第一轮没写、第二轮补上"）');
});

// ★★★leg151（用户令：一整套体系的第一步「引擎预取」）：**料在当轮到位，不问模型**。
//   口径（`docs/spec-memory-engine.md` §4／§8）：
//     · 取回的发起权归引擎，依据是"这一轮正在动的东西"（账上的事实，引擎比模型知道得准）；
//     · ★**递过的线要记得**（`meta.linesShown`）——正在走的线会连着很多轮都在动，
//       不记的话它每轮都占满，别人的线永远轮不到；
//     · ★**取料那一步与"点名"那条路共用同一个函数**（各写一份必然漂移，而漂移了没有任何判据会红）。
// ★★夹具的口径（本笔写第一版时**自己假红了一次**，留档免得下一任重踩）：
//   `pickLinesForPack` 只挑"**在动**"的线（线里含没收口的事／来路指向它／波及了在动的人）。
//   上面那份 `world()` 的事**全是收口的** ⇒ 那条线**不在动** ⇒ 预取一条都不取。
//   ⇒ 预取那三条判据**必须自带一棵"还在动"的树**，否则量的是夹具、不是行为。
const worldWithOpenLine = (over = {}) => {
    const w = world();
    w.events = w.events.map((e) => (e.id === 'ev_1_1' ? { ...e, closed: false } : e));  // 根没收口 ⇒ 这条线在动
    return { ...w, ...over };
};

test('★★★leg151 预取：引擎自己把"这一轮在动的线"的经过摆进包——当轮到位，不问模型', () => {
    const w = worldWithOpenLine();
    const root = linesOf(w).lines[0].根;
    const p = buildEvolutionPack(w, null).pack;
    assert.equal(Array.isArray(p.线的经过), true, '★引擎自己挑、自己取 ⇒ 不需要模型先点名');
    assert.match(p.线的经过[0], new RegExp(`^${root}：`), '取的是引擎挑出来的那条线');
    assert.match(p.线的经过[0], /\[1\]死煞杀局启动/, '从根起、按因果序（账上原文，一个字不改）');
});

test('★★★leg151 预取：递过的线不重复递——让位给别的在动的线（记得住，不霸占）', () => {
    const w = worldWithOpenLine();
    const root = linesOf(w).lines[0].根;
    // ★口径：本函数**只回答"这一轮挑中什么"**；累计与去重由调用方按"实际进包的结果"做
    //   （它若自作主张返回"累计后的记性"，就会在"挑中了、但没取到料"时留下**假记性**——本笔第一版的血证）。
    const first = pickLinesToPrefetch(w, []);
    assert.deepEqual(first, [root], '第一次：把在动的线挑出来');
    const second = pickLinesToPrefetch(w, first);
    assert.deepEqual(second, [], '★同一条线不霸占：递过一回就该让位（记性照用，但不再挑它）');
    // ★口径（本笔写反过一次，留档）：候选池＝**地图那一栏那批线**（`pickLinesForPack`），
    //   而那个函数做的是"**在动的排前面**"，**不是"只挑在动的"** ⇒
    //   已经收口的线**只要还没递过就仍可预取**（这也是对的：老线也需要"想得起来"）。
    //   ★"不霸占"靠的是记性（上面那条），不是靠把老线挡在门外。
    //   下面这条反证钉的是**另一件事**：无线可立的世界，预取必须一条都不取。
    assert.deepEqual(pickLinesToPrefetch(world({ events: [] }), []), [], '无线可立 ⇒ 预取一条都不取');
});

test('★★★leg151：两个入口（引擎预取 / 点名）产出**逐字相同**的档——绝不许各写一份', () => {
    const w = worldWithOpenLine();
    const root = linesOf(w).lines[0].根;
    // ① 引擎那条路：直接取料
    const byEngine = buildLineDetail(w, root);
    // ② 同一条线走"进包"那条路：包里那一行是 `根id：` 接上同一段文字
    const w2 = worldWithOpenLine();
    w2.meta = { ...w2.meta, lineRequests: [root] };
    const viaPack = buildEvolutionPack(w2, null).pack['线的经过'][0];
    assert.equal(viaPack, `${root}：${byEngine}`, '★两个入口必须逐字相同（漂移了没有任何判据会红，所以这条钉死它）');
});

test('★★★leg151：无线可取的世界零扰动——不写任何新键、包里不挂空栏（旧账逐字节不变）', () => {
    const w = world({ events: [] });
    const p = buildEvolutionPack(w, null).pack;
    assert.equal('故事线' in p, false, '没线可立 ⇒ 那一栏根本不出现');
    assert.equal('线的经过' in p, false, '★取不到料 ⇒ 那一栏也不出现（空着就是空着）');
    assert.equal('linesShown' in (w.meta || {}), false, '★零扰动：取不到料就不许往账上写"递过"');
});
