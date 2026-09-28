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
import { linesOf, lineIndexOf, sanitizeLineRequests, nodesOf } from '../src/lines.js';
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

test('★链②：点名取回——写行首那个根 id ⇒ 下一轮递那一条的经过（因果序 · 账上原文）', () => {
    const w = world();
    const root = linesOf(w).lines[0].根;
    w.meta = { ...w.meta, lineRequests: [root] };
    const p = buildEvolutionPack(w, null).pack;
    assert.equal(Array.isArray(p.线的经过), true, '点名了就该有这一栏');
    assert.match(p.线的经过[0], new RegExp(`^${root}：\\[1\\]死煞杀局启动 → \\[2\\]粮道被截`), '从根起、按因果序');
    assert.match(p.线的经过[0], /\[5\]残部西逃$/, '一直走到这条线的收口那件');
    // ★编的根 id ⇒ 一条都不给（引擎**不许替它造一条线出来**）
    const w2 = world({ meta: { tick: 9, lineRequests: ['ev_999_9'] } });
    assert.equal('线的经过' in buildEvolutionPack(w2, null).pack, false);
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

// ★★★本次修（真模型 60 轮长跑实跑抓出来的病）：**点名只递那一轮，"不写这一格"就得算"这一轮不要"**。
// 病灶：老写法只在模型**写了** `lookupLines` 时才动 `meta.lineRequests` ⇒ 不写 ⇒ **旧值留着** ⇒
//   那条线的经过**每轮重复递下去**（实测：点名 2 次、递出 4 次），而代码注释还写着"天然一次性"。
// ★这条判据必须**端到端**（两轮）：只在 `checkWorldStep` 那一层看，看不出"下一轮包里还在不在"。
test('★链④（本次修）：点名只递那一轮——递完那一轮就该消失（不写那一格 = 这一轮不要）', async () => {
    const w = world();
    const root = linesOf(w).lines[0].根;
    const empty = { actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] };
    const feed = (ssot, step) => runTick({ transport: async () => ({ text: JSON.stringify(step) }), ssot, dialogue: '（继续）' });

    // 第 1 轮：模型点名要这一条线的经过
    const r1 = await feed(w, { ...empty, lookupLines: [root] });
    assert.equal(r1.ok, true, r1.error || '');
    assert.deepEqual(r1.ssot.meta.lineRequests, [root], '点过名 ⇒ 记在账上');

    // 第 2 轮：**这一轮就是"递"的那一轮**（包在点名之前就装好了，所以下一轮才给）——必须给
    const r2 = await feed(r1.ssot, empty);
    assert.equal(r2.ok, true, r2.error || '');
    assert.equal('线的经过' in r2.pack.pack, true, '★点了名 ⇒ 下一轮真把那条线的经过递进去');
    assert.match(String(r2.pack.pack['线的经过'][0]), new RegExp(`^${root}：`), '递的正是点名那一条');
    assert.deepEqual(r2.ssot.meta.lineRequests, [], '★这一轮没写那一格 ⇒ 立刻清空（"天然一次性"现在才是真的）');

    // 第 3 轮：**递过就该没了**——修之前它会一直递下去（实测：点名 2 次、递出 4 次）
    const r3 = await feed(r2.ssot, empty);
    assert.equal(r3.ok, true, r3.error || '');
    assert.equal('线的经过' in r3.pack.pack, false, '★只递那一轮：第三轮必须消失（修之前它每轮都在）');

    // ★反证（旧账纪律 K6）：**从没点过名的世界，一个字节都不许碰**
    const r4 = await feed(world(), empty);
    assert.equal('lineRequests' in r4.ssot.meta, false, '没点过名 ⇒ 连那个键都不许出现（旧账零扰动）');
});
