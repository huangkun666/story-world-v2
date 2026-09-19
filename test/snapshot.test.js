// story-world-v2/test/snapshot.test.js
// 第二十七棒后 · 快照容错（细案 docs/spec-snapshot-fault-tolerance.md）
// 用户拍板三问：①存 IndexedDB 独立库 ②保留 **15 步** ③只回世界账。
// 本文件锁**纯逻辑层**（`src/snapshot.js`）：diff / applyDelta / 锚点制 / 恢复 / 保留窗口。
// 判据纪律（本仓血的教训）：**按结构写、先证红**——"测试全绿 ≠ 对"。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// ★纪律（本次踩过）：测试文件里**不许用顶层 await**——本仓项目根没有 package.json，
//   Node 靠"语法检测"决定模块类型，而检测模式下顶层 await 会直接 `SyntaxError: Unexpected reserved word`
//   ⇒ 整个测试文件加载失败（表现为"1 test / 1 fail"，看不出真正原因）。静态 import 一律放顶部。
import { renderSnapshotsHtml, renderAll } from '../src/render.js';
import {
    diffWorld, applyDelta, makeSnapshot, planStep, restoreFrom, planRetention, describeSnapshots,
    ANCHOR_EVERY, RETAIN_STEPS, SNAPSHOT_FORMAT,
} from '../src/snapshot.js';
// ★★★leg72（丙-web）：记忆那一族（含"投递自证面"的状态与其读法）已搬进 `web/memory-store.js`
//   ⇒ 改从新家取。★状态 `sw2MemoryPush` 的**唯一家**也在那边（本文件只经它给的两个通道读/清）。
import { memoryStore, markMemoryPush, memoryPushLine, pushMemoryNow, readMemoryPush, clearMemoryPush } from '../web/memory-store.js';

// ★★★leg72：**"这个函数住哪个文件"变了** ⇒ 下面两条**读源码的结构锁**跟着搬家（不搞 re-export 骗锁）。
//   ★纪律：判据锚的是"**声明必须在模块顶层、块外调用得到**"这件事，不是"它必须住在 index.js 里"——
//     所以这里按**符号的实际新家**取源码，判据本身一个字没放松（`declOf` 与深度口径原样保留）。
// ★★★leg73（丙-web 第二格）：**快照族**（`ensureSnapshotChain` / `snapshotStore` / `requestSnapshot` /
//   `restoreSnapshot` / `clearSnapshots` / `resetSnapshots` / `refreshSnapshots` …）已整族搬进
//   `web/snapshot-store.js` ⇒ 同一个口径继续用：**按符号的新家取源码**，判据内容一个字不改。
const WEB_SRC = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
// 记忆那一族（leg72 起住 memory-store.js）· 快照那一族（leg73 起住 snapshot-store.js）· 其余仍在接线层 index.js。
const SRC_OF_FILE = {
    'web/memory-store.js': () => WEB_SRC('../web/memory-store.js'),
    'web/snapshot-store.js': () => WEB_SRC('../web/snapshot-store.js'),
    'web/hot-ledger.js': () => WEB_SRC('../web/hot-ledger.js'),   // ★leg78：热账族的新家
    'web/index.js': () => WEB_SRC('../web/index.js'),
};

// 逐字节比较（**判据必须是它**：快照的"对不对"只有一个含义——恢复出来的账与当时逐字节相等）
const sameBytes = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 夹具纪律（本次踩过）：世界状态一律用 **JSON 往返**克隆，与**真实数据同构**——
//   真账是从 `chat_metadata`（JSON）读出来的，**不可能有 `undefined` 自有键**；
//   而 `structuredClone` 会保留 `parent: undefined` 这类自有键，造出"对象里有、JSON 里没有"的假分歧。
const clone = (v) => JSON.parse(JSON.stringify(v));

// ★leg27 g 判据用：剥掉**注释**只留真代码（逐字符扫描，含字符串态，防被注释里的引号带跑）。
//   为什么必须有它：本仓禁止的写法**会在注释里被引用留档**，锁若不剥注释就会红在留档上（假红）——
//   第一版就红在我自己写的事故注释上，所以这一步连带它的自检一起写进判据。
function stripComments(src) {
    let out = '';
    let mode = '';           // '' | 'line' | 'block' | 'sq' | 'dq' | 'tpl'
    for (let i = 0; i < src.length; i += 1) {
        const c = src[i];
        const n = src[i + 1];
        if (mode === 'line') { if (c === '\n') { mode = ''; out += c; } continue; }
        if (mode === 'block') { if (c === '*' && n === '/') { mode = ''; i += 1; } continue; }
        if (mode === 'sq' || mode === 'dq' || mode === 'tpl') {
            out += c;
            if (c === '\\') { out += n ?? ''; i += 1; continue; }
            if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = '';
            continue;
        }
        if (c === '/' && n === '/') { mode = 'line'; i += 1; continue; }
        if (c === '/' && n === '*') { mode = 'block'; i += 1; continue; }
        if (c === "'") mode = 'sq'; else if (c === '"') mode = 'dq'; else if (c === '`') mode = 'tpl';
        out += c;
    }
    return out;
}

// 一个"像真账"的世界（形状照真账：entities/weights/agendas/events/chronicle/milestones/meta/context）
function makeWorld({ tick = 0, entities = 3 } = {}) {
    const ents = [];
    const weights = {};
    for (let i = 1; i <= entities; i += 1) {
        ents.push({ id: `e_bk_${i}`, name: `角色${i}`, kind: 'character', parent: i % 2 ? '势力甲' : undefined, 实力: 'T5筑基' });
        weights[`e_bk_${i}`] = 0.2 + i / 100;
    }
    return {
        version: 1,
        context: { world: '测试界', tension: 0.4, positions: ['未明', '边关'], setting: { frozen: { fingerprint: 'fnv1a_x', canon: { rules: ['法则一'], bookEntities: [{ name: '角色1', kind: 'character' }] } }, dynamic: { tension: { polarity: '未聚', direction: '', intensity: 0.5 }, env: {}, derivedFrom: [] } } },
        entities: ents, weights, agendas: [], events: [], chronicle: [], milestones: [],
        meta: { tick, simLog: [] },
    };
}

function stepWorld(w, n) {
    const next = clone(w);
    next.meta.tick = n;
    next.meta.simLog.push({ tick: n, silent: [], lifted: [] });
    next.chronicle.push({ tick: n, text: `第 ${n} 轮：边关有事`, eventRef: `ev_${n}_1` });
    next.events.push({ id: `ev_${n}_1`, title: `事件${n}`, bornTick: n, closed: false, source: { type: 'state' }, ripples: [] });
    next.entities[0]['实力'] = `T${5 + (n % 3)}筑基`;
    next.weights[next.entities[0].id] = 0.3 + n / 100;
    if (n % 4 === 0) next.entities.push({ id: `e_new_${n}`, name: `新人${n}`, kind: 'character' });
    if (n % 7 === 0) delete next.weights[next.entities[1].id];
    return next;
}

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// 一、diff ↔ applyDelta 往返（**核心契约**）

test('★快照往返锁：applyDelta(base, diff(base,next)) 与 next **逐字节相等**', () => {
    const base = makeWorld({ entities: 12 });
    let cur = base;
    for (let n = 1; n <= 20; n += 1) {
        const next = stepWorld(cur, n);
        const { delta, full } = diffWorld(cur, next);
        assert.equal(full, false, '正常一步改动不该退化成整份');
        const back = applyDelta(cur, delta);
        assert.ok(sameBytes(back, next), `★第 ${n} 步往返必须逐字节相等（delta 条目 ${Object.keys(delta.set).length + Object.keys(delta.del).length}）`);
        cur = next;
    }
});

test('★删除必须存旧值：只删字段/删权重/删实体，往返仍逐字节相等', () => {
    const base = makeWorld({ entities: 6 });
    const next = clone(base);
    delete next.entities[2]['实力'];                 // 删实体字段
    delete next.weights['e_bk_1'];                   // 删权重键
    next.entities.splice(4, 1);                      // 删数组元素（尾部）
    next.context.setting.frozen.canon.rules = [];    // 清空数组（产 del）
    const { delta } = diffWorld(base, next);
    assert.ok(Object.keys(delta.del).length >= 3, `删除被记进 del（实际 ${Object.keys(delta.del).length} 条）`);
    assert.ok(sameBytes(applyDelta(base, delta), next), '★含删除的往返必须逐字节相等（del 没存旧值就过不了这条）');
});

test('★确定性：同输入两次 diffWorld 逐字节一致（且不改写任何入参）', () => {
    const base = makeWorld({ entities: 8 });
    const next = stepWorld(base, 3);
    const baseSnap = JSON.stringify(base);
    const nextSnap = JSON.stringify(next);
    const a = diffWorld(base, next);
    const b = diffWorld(base, next);
    assert.equal(JSON.stringify(a.delta), JSON.stringify(b.delta), '两次 diff 逐字节一致');
    assert.equal(JSON.stringify(base), baseSnap, 'base 未被改写');
    assert.equal(JSON.stringify(next), nextSnap, 'next 未被改写');
    // applyDelta 也不许改入参
    const before = JSON.stringify(base);
    applyDelta(base, a.delta);
    assert.equal(JSON.stringify(base), before, 'applyDelta 不改写 base');
});

test('无改动 ⇒ 空 delta（不去写空快照的判据面）', () => {
    const w = makeWorld();
    const { delta, full } = diffWorld(w, w);
    assert.equal(full, false);
    assert.equal(Object.keys(delta.set).length, 0);
    assert.equal(Object.keys(delta.del).length, 0);
});

test('整表重建型改动 ⇒ 建议退回落 full（delta 不许比 full 还大）', () => {
    const base = makeWorld({ entities: 3 });
    const next = makeWorld({ entities: 3 });
    for (let i = 0; i < 500; i += 1) next.entities.push({ id: `e_x_${i}`, name: `异${i}`, kind: 'character', 实力: `T${i}层` });
    const r = diffWorld(base, next);
    assert.equal(r.full, false, '500 条新增还不该溢出上限');
    const huge = makeWorld({ entities: 3 });
    for (let i = 0; i < 5000; i += 1) huge.entities.push({ id: `z_${i}`, name: `巨${i}`, kind: 'character' });
    const r2 = diffWorld(base, huge);
    assert.equal(r2.full, true, '★超过条目上限 ⇒ 退回整份（否则 delta 会比 full 更贵）');
    assert.ok(r2.reason.includes('上限'), '退回原因如实带出');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// 二、锚点制（每 ANCHOR_EVERY 步一份 full）

test('★锚点制：首份 full、每 5 步一份 full、其余 delta（且 delta 都指向窗口内的锚）', () => {
    assert.equal(ANCHOR_EVERY, 5, '锚点间隔提案值 5');
    let seq = 0;
    let anchorId = null;
    let anchorSeq = null;
    let anchorWorld = null;
    const recs = [];
    let world = makeWorld({ tick: 0 });
    for (let n = 1; n <= 12; n += 1) {
        const next = stepWorld(world, n * 3);       // 每步真走 3 轮（像真账：一步演化会推进多轮）
        const p = planStep({ seq, tick: n * 3, world: next, prevAnchorWorld: anchorWorld, prevAnchorId: anchorId, anchorSeq: anchorSeq, reason: `tick ${n * 3}`, now: 'T' });
        seq = p.nextSeq; anchorId = p.anchorId; anchorSeq = p.anchorSeq; anchorWorld = p.anchorWorld;
        recs.push(p.snapshot);
        world = next;
    }
    const fulls = recs.filter((r) => r.kind === 'full').map((r) => r.id);
    const deltas = recs.filter((r) => r.kind === 'delta').map((r) => r.id);
    assert.equal(recs[0].kind, 'full', '首份必须 full（链的根）');
    assert.deepEqual(fulls, ['s1', 's6', 's11'], `锚点应是 s1/s6/s11（实际 ${fulls.join('/')}）`);
    assert.equal(deltas.length, 9, `其余 9 份是 delta（实际 ${deltas.length}）`);
    // 每一份 delta 的锚点都必须真的在窗口里
    for (const r of recs.filter((x) => x.kind === 'delta')) {
        assert.ok(recs.some((x) => x.id === r.anchorId && x.kind === 'full'), `${r.id} 的锚 ${r.anchorId} 必须在窗口内`);
    }
    // 体积：锚 = full 字节，delta 远小于 full
    //   ★判据要用**真账规模**量（小夹具上量不出来：世界才 800 字节时，几条稳定字段名的 delta 就占满比例）。
    //   真账实测：full = 166,760 字节；一步量级改动 delta = 143 字节（1167×）。
    let bigCur = makeWorld({ entities: 400 });
    let maxDelta = 0;
    let fullBytes = 0;
    for (let n = 1; n <= ANCHOR_EVERY; n += 1) {
        const nx = stepWorld(bigCur, n);
        if (n === 1) fullBytes = JSON.stringify(nx).length;
        const d = diffWorld(bigCur, nx).delta;
        maxDelta = Math.max(maxDelta, JSON.stringify(d).length);
        bigCur = nx;
    }
    assert.ok(fullBytes > 20000, `前置：夹具要够像真账（实际 full ${fullBytes} 字节）`);
    assert.ok(maxDelta * 10 < fullBytes, `★delta 必须远小于 full（delta 最大 ${maxDelta} vs full ${fullBytes}）`);
});

test('刷新后失基准 ⇒ 退回落 full（不许拿"猜的基准"做 delta）', () => {
    const world = makeWorld({ tick: 7 });
    const p = planStep({ seq: 9, tick: 7, world, prevAnchorWorld: null, prevAnchorId: 's1', anchorSeq: 1, reason: '刷新后首次' });
    assert.equal(p.snapshot.kind, 'full', '★没有锚点世界就必须落 full');
    assert.ok(p.snapshot.reason.includes('首份'), '原因如实标注');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// 三、恢复（**不许"大概恢复"**）

function buildChain(steps = 12) {
    let seq = 0, anchorId = null, anchorSeq = null, anchorWorld = null;
    const recs = [];
    let world = makeWorld({ tick: 0 });
    for (let n = 1; n <= steps; n += 1) {
        const next = stepWorld(world, n * 3);         // 每步 3 轮
        const p = planStep({ seq, tick: n * 3, world: next, prevAnchorWorld: anchorWorld, prevAnchorId: anchorId, anchorSeq: anchorSeq, reason: `tick ${n * 3}`, now: 'T' });
        seq = p.nextSeq; anchorId = p.anchorId; anchorSeq = p.anchorSeq; anchorWorld = p.anchorWorld;
        recs.push(p.snapshot);
        world = next;
    }
    return { recs, finalWorld: world };
}

test('★恢复：窗口内**每一份**都能恢复到当时的世界（逐字节相等）', () => {
    const { recs, finalWorld } = buildChain(12);
    // 重建每一步的"当时世界"（用同一条确定性链）
    let world = makeWorld({ tick: 0 });
    const expect = new Map();
    for (let n = 1; n <= 12; n += 1) { world = stepWorld(world, n * 3); expect.set(`s${n}`, world); }
    assert.ok(sameBytes(expect.get('s12'), finalWorld), '夹具自检：末态一致');
    // 前置断言：链里必须**真的**有 delta 份（否则这条锁只验了 full，等于没验——本次 bug 正是只有 delta 错）
    assert.ok(recs.some((r) => r.kind === 'delta'), '前置：链里必须有 delta 份');
    assert.ok(recs.some((r) => r.kind === 'full'), '前置：链里必须有 full 份');
    for (const rec of recs) {
        const r = restoreFrom({ snapshots: recs, targetId: rec.id });
        assert.ok(r.ok, `${rec.id} 应可恢复（实际 ${r.error}）`);
        assert.ok(sameBytes(r.world, expect.get(rec.id)), `★${rec.id}（${rec.kind}）恢复出的世界必须与当时逐字节相等`);
    }
});

test('★锚点被淘汰 ⇒ 明确拒绝（绝不部分应用、世界不动）', () => {
    const { recs } = buildChain(12);
    const pruned = recs.filter((r) => r.id !== 's6');      // 抽掉一个 full 锚点（s7..s10 的锚）
    const r = restoreFrom({ snapshots: pruned, targetId: 's7' });
    assert.equal(r.ok, false, '★锚点不在窗口 ⇒ 必须拒绝');
    assert.match(r.error, /锚点|不可恢复/, `原因必须说清（实际：${r.error}）`);
    assert.equal(r.world, undefined, '★拒绝时**不给半成品世界**（不许"大概恢复"）');
});

test('目标不存在 ⇒ 明确拒绝', () => {
    const { recs } = buildChain(3);
    const r = restoreFrom({ snapshots: recs, targetId: 's99' });
    assert.equal(r.ok, false);
    assert.match(r.error, /不存在/);
});

test('★链不自洽（delta 指向非 full 的锚）⇒ 拒绝并如实报原因', () => {
    const { recs } = buildChain(6);
    // s6 是锚点（full）；把 s3（delta）的锚改指到 s2 这个**也是 delta** 的份上
    const broken = recs.map((r) => (r.id === 's3' ? { ...r, anchorId: 's2' } : r));
    assert.equal(broken.find((r) => r.id === 's2').kind, 'delta', '前置：s2 确实是 delta（否则这条锁验不到东西）');
    const r = restoreFrom({ snapshots: broken, targetId: 's3' });
    assert.equal(r.ok, false, '★锚点不是 full ⇒ 必须拒绝（不许拿 delta 当基准硬算）');
    assert.match(r.error, /不自洽/, '形状不对时不许硬套');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// 四、保留窗口（用户拍板 15 步）

test('★保留窗口 = 15 份，且**窗口内每一份仍可恢复**（锚点制 ⇒ 结构上不可能留断链）', () => {
    assert.equal(RETAIN_STEPS, 15, '用户拍板 15 步');
    const { recs } = buildChain(40);
    const plan = planRetention({ snapshots: recs });
    assert.equal(plan.keep.length, 15, `保留 15 份（实际 ${plan.keep.length}）`);
    assert.equal(plan.drop.length, 25, '其余淘汰');
    assert.deepEqual(plan.keep, recs.slice(25).map((r) => r.id), '保留的是**最新** 15 份');
    // ★关键：剪完之后，留下的每一份都还能恢复
    const kept = recs.filter((r) => plan.keep.includes(r.id));
    for (const rec of kept) {
        const r = restoreFrom({ snapshots: kept, targetId: rec.id });
        assert.ok(r.ok, `★剪枝后 ${rec.id} 仍须可恢复（实际 ${r.error}）——锚点制就是为这条存在的`);
    }
});

test('★剪枝不许留断链：锚点被丢时其名下 delta 一并丢', () => {
    // 造一个"锚点刚好落在窗口边界外"的情形：s11 是 full，保留集从 s12 起 ⇒ s12..s15 的锚 s11 不在
    const { recs } = buildChain(20);
    const plan = planRetention({ snapshots: recs, retain: 8 });   // s13..s20 应保留；s13 的锚是 s11（被淘汰）
    const kept = recs.filter((r) => plan.keep.includes(r.id));
    const keptIds = new Set(kept.map((r) => r.id));
    for (const r of kept) {
        if (r.kind !== 'delta') continue;
        assert.ok(keptIds.has(r.anchorId), `★保留集里不许有"锚点已丢"的 delta（${r.id} 锚 ${r.anchorId}）`);
    }
    // 且留下的都得能恢复
    for (const rec of kept) {
        assert.ok(restoreFrom({ snapshots: kept, targetId: rec.id }).ok, `${rec.id} 剪枝后应可恢复`);
    }
});

test('keepId：正在恢复/刚恢复的那一份永不被剪（防"恢复完发现回不去了"）', () => {
    const { recs } = buildChain(30);
    const plan = planRetention({ snapshots: recs, retain: 5, keepId: 's3' });
    assert.ok(plan.keep.includes('s3'), '★keepId 必须留下');
});

test('空集/畸形输入零抛（防御）', () => {
    assert.deepEqual(planRetention({ snapshots: [] }).drop, []);
    assert.deepEqual(planRetention({}).keep, []);
    assert.ok(describeSnapshots([]).includes('0 份'));
    assert.equal(restoreFrom({}).ok, false);
    assert.equal(restoreFrom({ snapshots: [null, 1, 'x'], targetId: 's1' }).ok, false);
});

test('describeSnapshots：事实拼句（份数/轮次跨度/体积/最新时刻）', () => {
    const { recs } = buildChain(6);
    const s = describeSnapshots(recs);
    assert.match(s, /快照 6 份/);
    assert.match(s, /覆盖第 3–18 轮/);   // buildChain 每步 3 轮：6 步 = tick 3..18
    assert.match(s, /KB|MB/);
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// 五、格式与越界

test('makeSnapshot 形状纪律：kind 校验 + delta 必须带 anchorId + format/version 在位', () => {
    assert.throws(() => makeSnapshot({ world: {}, id: 's1', kind: 'weird' }), /kind/);
    assert.throws(() => makeSnapshot({ world: {}, id: 's1', kind: 'delta' }), /anchorId/);
    assert.throws(() => makeSnapshot({ world: {}, id: '', kind: 'full' }), /id/);
    const rec = makeSnapshot({ world: makeWorld(), id: 's1', tick: 3, kind: 'full', reason: 'x' });
    assert.equal(rec.format, SNAPSHOT_FORMAT);
    assert.equal(rec.version, 1);
    assert.equal(rec.tick, 3);
    assert.ok(rec.bytes > 0, '体积自报（保留窗口与面板要用）');
});

test('路径含 `/` 的键：整棵替换（不许产出无法表示的路径）', () => {
    const base = { a: { 'x/y': 1, b: 2 } };
    const next = { a: { 'x/y': 9, b: 2 } };
    const { delta } = diffWorld(base, next);
    assert.ok(!Object.keys(delta.set).some((k) => k.includes('x/y')), '★不许把含 / 的键拼进路径');
    assert.ok(sameBytes(applyDelta(base, delta), next), '整棵替换也要往返相等');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// 六、接线锁（本仓常客："机制建好了、接线从没生效、测试全绿"——leg25 f 吃过这个亏）

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// ★leg27 d：**块作用域事故**（用户实机「落账失败：pushMemoryNow is not defined（世界已演算未保存，可重试）」）
//   病：`memoryStore` / `pushMemoryNow` 原本写在 `if (typeof window !== 'undefined') { … }` 的**块内部**，
//       而它们在**块外**被调用——`setupAsyncTicks` 的 `save` 回调（tick 落账）在块**之前**。
//       函数声明只在**它所在的块**里可见 ⇒ **每轮自动推进都抛 ReferenceError ⇒ 世界没落盘**。
//   为什么漏了：那两处调用点在**同一个块内**（点击处理器），点了不炸；**只有自动流程那条路每轮都炸**。
//   判据（结构性的，且**防复发**）：凡"由自动流程调用"的函数，声明必须在**模块顶层**（那行不许有缩进）。
test('★leg27 d：自动流程调用的函数必须在**模块顶层**（缩进即块内 ⇒ 那次"落账失败"的病根）', () => {
    // ★★★leg72：这几个符号如今**分居两个文件** ⇒ 逐个按"它的新家"取源码。
    //   ★判据的**内容**没变（仍是"声明行的花括号深度必须是 0"），变的只是"去哪读"。
    const src = SRC_OF_FILE['web/index.js']();
    const lines = src.split(/\r?\n/);
    // 判据用**花括号深度**（逐字符扫描），**不许用行首缩进**——
    //   我第一版就是拿 `trimStart()` 判的，而它对"未闭合的模板字符串行"也会给出 0 ⇒ **给了假绿**，
    //   于是 `pushMemoryNow` 仍留在块内、用户在实机第二次撞上「落账失败」。这条锁因此重写。
    // 这些都会被**自动流程**调用（tick 落账 / 快照队列 / 世界加载），一律必须在顶层（depth === 0）
    // ★判据要**抗前缀变化**：原来写死 `'function memoryStore('`，而 leg27 g 把它提成
    //   `export function memoryStore(YM = …)`（为可注入真测）⇒ 锁当场红在"找不到函数"上。
    //   现在按**声明行**匹配（允许 `export `/`async ` 前缀），判据跟形状走、不跟字面前缀走。
    // ★★★leg72：**按"符号的新家"逐个取源码**（记忆那两族已搬去 `web/memory-store.js`）。
    //   ★判据口径一个字没放松：仍然是"声明行的花括号深度必须 = 0"（块内声明 ⇒ 块外调用不到 ⇒ 落账失败）。
    //   ★反向锁（下面那条）也照旧，只换取值来源。
    const whereOf = {
        memoryStore: 'web/memory-store.js',
        pushMemoryNow: 'web/memory-store.js',
        // ★leg73：快照那三个已搬进 snapshot-store.js（判据口径不变：声明行花括号深度 = 0）
        snapshotStore: 'web/snapshot-store.js',
        requestSnapshot: 'web/snapshot-store.js',
        refreshSnapshots: 'web/snapshot-store.js',
        advanceTick: 'web/index.js',
    };
    const srcOf = new Map();                                   // 文件 → 它的源码（同一个文件只读一次）
    const declOfIn = (name) => {
        const rel = whereOf[name];
        if (!srcOf.has(rel)) { const s = SRC_OF_FILE[rel](); srcOf.set(rel, s); }
        const ls = srcOf.get(rel).split(/\r?\n/);
        const marker = `function ${name}(`;
        let depth = 0;
        for (let i = 0; i < ls.length; i += 1) {
            const before = depth;
            const t = ls[i].trim();
            if (t.includes(marker) && /^(export\s+)?(async\s+)?function\s/.test(t)) return { line: i + 1, depth: before, head: t, rel };
            for (const ch of ls[i]) { if (ch === '{') depth += 1; else if (ch === '}') depth -= 1; }
        }
        return null;
    };
    for (const name of ['memoryStore', 'pushMemoryNow', 'snapshotStore', 'requestSnapshot', 'refreshSnapshots', 'advanceTick']) {
        const d = declOfIn(name);
        assert.ok(d, `前置：在 ${whereOf[name]} 里找得到 function ${name}(（L 位置与 head 见下）`);
        assert.equal(d.depth, 0, `★${name}（${d.rel} L${d.line}：${d.head}）的花括号深度 = ${d.depth} ⇒ 它在某个块内，块外调用不到（正是「落账失败：pushMemoryNow is not defined」）`);
    }
    // 反向锁：tick 落账那条路真的会调记忆投递（开关开着时）
    const saveSeg = src.slice(src.indexOf('save: async (ssot)'), src.indexOf('refresh:', src.indexOf('save: async (ssot)')));
    assert.match(saveSeg, /pushMemoryNow\(rot\.hot\)/, '★tick 落账这条路必须调 pushMemoryNow（leg26 的记忆投递接线）');
    // 自检：本判据必须能**认出块内**的声明（否则它又是一条假绿）——直接拿同一 declOf 扫一段假源
    const fakeLines = 'if (x) {\n  function pushMemoryNow(world) {\n  }\n}\n'.split('\n');
    const depthIn = (ls, name) => {
        let depth = 0;
        for (const l of ls) {
            const before = depth;
            const t = l.trim();
            if (t.includes(`function ${name}(`) && /^(export\s+)?(async\s+)?function\s/.test(t)) return before;
            for (const c of l) { if (c === '{') depth += 1; else if (c === '}') depth -= 1; }
        }
        return null;
    };
    assert.equal(depthIn(fakeLines, 'pushMemoryNow'), 1, '★判据自检：块内的声明必须被认成 depth=1（否则这条锁是假绿）');
    assert.equal(depthIn(['export function memoryStore(YM = window) {'], 'memoryStore'), 0, '★判据自检：带 export 前缀的顶层声明必须被认成 depth=0（抗前缀变化）');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// ★leg27 g（用户实机「**记忆插件也没有记录事件，还把插件原来的角色档案清空了**」）：
//   病 = `memoryStore().readState()` 原来调的是 **`Storage.loadState?.(null, null)`**——第二参**显式传 `null`**。
//   插件签名 `loadState(fallbackState, sessionId = getCurrentSessionId())`：**ES 形参默认值只在 `undefined` 时生效**，
//   传 null ⇒ sessionId=null ⇒ `getStorageKeys(null)` 空 ⇒ 插件开头 `if (!keys.length) return normalizeState(null, fallbackState)`
//   拿 null 兜底返回**非对象** ⇒ 我方 `typeof s === 'object'` 不成立 ⇒ 退回 `blank()`（自带表全空）⇒
//   `writeRecords` 再 `saveState(..., { force: true })`（**force 跳过插件全部保护闸**）把空态写回 ⇒
//   **用户自己填的「角色档案」被逐条抹掉**（物品追踪/世界设定没填过，所以看着"还在"）。
//   判据两层：①结构层——那一行不许出现 `loadState(...null...)`（防复发，`.?.(` → `(` 归一后判）；
//   ②行为层——用**会话感知的 fake 插件**真跑一次投递，档案记录条数必须**逐条保住**。
//   ★自检：同一 fake 必须能把"用 null 占位"的写法**认成坏的**（否则这条锁又是一条假绿）。
function makeFakeYuzukiMemory() {
    const KEY = 'yzm_memory_chat_state:char:4:chat1';
    const stored = {
        tables: [
            { id: 'plot_summary', name: '剧情摘要', icon: 'timeline', columns: ['#主线', '#支线'], hidden: false },
            { id: 'character_profile', name: '角色档案', icon: 'person', columns: ['角色名', '身份'], hidden: false },
        ],
        activeTableId: 'character_profile',
        activeRecordIds: {},
        records: {
            plot_summary: [{ id: 'ps_1', values: { 主线: '已有主线' } }],
            character_profile: [{ id: 'cp_1', values: { 角色名: '白小娥', 身份: '药童' } }],
        },
    };
    const written = { state: null };
    return {
        written,
        YM: {
            // 插件自带的默认态（有档案那张表，但**没有记录**——正是"读不到时该用的兜底"）
            VariableInjector: { createDefaultState: () => ({ tables: [], activeTableId: '', activeRecordIds: {}, records: {} }) },
            Storage: {
                loadState: (fallbackState, sessionId) => {
                    // 插件真语义：`sessionId = getCurrentSessionId()`（只在 undefined 时生效）+ 无键早退
                    const sid = sessionId === undefined ? 'char:4:chat1' : sessionId;
                    if (!sid) return fallbackState ?? null;   // ← keys.length === 0 的那条早退
                    return stored;
                },
                saveState: (state) => { written.state = state; return true; },
            },
        },
        stored,
    };
}

test('★leg27 g：记忆投递不许用 `null` 占位 sessionId（那会把用户档案清空）——且档案必须逐条保住', () => {
    // ★★★leg72：`readState` 这一族已搬进 `web/memory-store.js` ⇒ **结构锁跟着读新家**。
    //   ★判据本身一个字没放松（仍是"`loadState` 的**第 2 个位置实参**不许是 `null`"）——
    //     变的只是"去哪读源码"。这正是本仓那条纪律：判据锚**语义**，不锚"它必须住在某个文件里"。
    const src = SRC_OF_FILE['web/memory-store.js']();
    // ① 结构层：**先剥注释再扫**（本仓禁止的写法会在注释里被引用＝留档，那是合法的；
    //    锁只能盯**真代码**——第一版没剥注释，红在了我自己的留档注释上，这条自检因此写进判据）。
    const code = stripComments(src);
    // 判据要精确到**第 2 个位置参数**（sessionId）——不是"这行里不许出现 null"：
    //   `loadState(fallback ?? null)` 是合法的（单个实参），`loadState(null, null)` 才是病。
    const splitArgs = (s) => {
        const out = []; let cur = ''; let d = 0;
        for (const c of s) {
            if ('([{'.includes(c)) d += 1;
            if (')]}'.includes(c)) d -= 1;
            if (c === ',' && d === 0) { out.push(cur); cur = ''; continue; }
            cur += c;
        }
        if (cur.trim()) out.push(cur);
        return out.map((x) => x.trim());
    };
    const calls = [...code.matchAll(/Storage\.loadState[\s\S]{0,6}?\(([\s\S]{0,120}?)\)/g)]
        .map((m) => splitArgs(m[1]).filter(Boolean));
    assert.ok(calls.length >= 1, '前置：找得到 readState 里的 loadState 调用');
    for (const args of calls) {
        assert.notEqual(args.length >= 2 ? args[1] : '', 'null',
            `★Storage.loadState(${args.join(', ')}) 的 sessionId 实参是 null ⇒ 插件默认值失效 ⇒ 读回非对象 ⇒ force 覆盖写空态（清空用户档案）`);
    }
    // 自检：剥注释这一步必须真有效（否则注释里的旧写法会永远把这条锁顶红＝假红）
    assert.equal([...stripComments('/* Storage.loadState(null, null) */ const x = 1;').matchAll(/Storage\.loadState/g)].length, 0,
        '★判据自检：块注释里的写法必须被剥掉');
    assert.equal([...stripComments('// Storage.loadState(null, null)\nconst x = 1;').matchAll(/Storage\.loadState/g)].length, 0,
        '★判据自检：行注释里的写法必须被剥掉');
    assert.equal([...stripComments("Storage.loadState(fallback)").matchAll(/Storage\.loadState/g)].length, 1,
        '★判据自检：真代码不许被误剥');
    // ② 行为层：真跑一次投递，档案与它表记录必须原样还在
    const { YM, written, stored } = makeFakeYuzukiMemory();
    const store = memoryStore(YM);
    assert.ok(store, '前置：fake 插件可被 memoryStore 接受');
    const before = stored.records.character_profile.length;
    store.writeRecords({
        世界状态: [{ id: 'sw2_state', hidden: false, values: { 设定名: '大荒', 类型: '第 7 轮' } }],
        世界大事: [],
    }, { tables: [
        { id: 'world_setting', name: '世界状态', icon: 'world', columns: ['设定名', '类型', '详细说明', '影响范围'], hidden: false },
        { id: 'item_tracking', name: '世界大事', icon: 'item', columns: ['物品名称', '物品描述', '物品位置', '轮次'], hidden: false },
    ], now: 1 });
    assert.ok(written.state, '前置：saveState 真被调到');
    assert.equal(written.state.records.character_profile.length, before,
        `★投递后「角色档案」条数 ${written.state.records.character_profile.length} ≠ 投递前 ${before} —— 用户档案被投递覆盖了`);
    assert.equal(written.state.records.plot_summary.length, 1, '★自带表 plot_summary 的记录也必须原样保留');
    assert.ok(written.state.tables.some((t) => t.id === 'character_profile'), '★档案**表定义**不许被抹掉');
    // ★leg29（用户拍板「对齐插件内置表形状」）：我方表用**插件内置 id**（否则详情视图是空 div），name 留人话表名
    assert.ok(written.state.tables.some((t) => t.id === 'world_setting' && t.name === '世界状态'), '我方表要并进去（插件 id + 人话名）');
    assert.equal(written.state.records.world_setting.length, 1, '我方记录要落上（落在插件 id 那张表里）');
    // ③ 自检：把 loadState 换成"null 占位的后果"（返回非对象 ⇒ 我方退回 blank()），同一判据必须**认得出档案丢了**
    const bad = makeFakeYuzukiMemory();
    bad.YM.Storage.loadState = (fallbackState, sessionId) => (void fallbackState, void sessionId, null);
    const storeBad = memoryStore(bad.YM);
    storeBad.writeRecords({ 世界状态: [{ id: 'sw2_state', hidden: false, values: { 设定名: '大荒', 类型: '第 7 轮' } }] }, { tables: [], now: 1 });
    const badProfile = bad.written.state?.records?.character_profile;
    assert.ok(!Array.isArray(badProfile) || badProfile.length === 0,
        '★判据自检：非对象返回 ⇒ 档案必须被认成丢了（本判据要能认出坏的形状，否则它是假绿）');
    assert.equal(badProfile, undefined,
        '★判据自检：退回 blank() 时**连表带记录一起没**（正是用户看到的"档案被清空"的形状）');
});

// ★leg27 h：记忆投递的**自证面**（用户两次靠肉眼发现"插件里什么都没有" ⇒ 这功能此前没有任何可查的痕迹）。
//   判据只认一件事：**报出来的必须是本次事实**；失败必须说得出口，没投过必须**不出声**（不许假绿）。
test('★leg27 h：记忆投递自证面——没投过不出声；成功报本次轮次；失败报原因', () => {
    // ① 未投过 ⇒ 一个字都不许报（否则界面会显示"已投"，正是最坏的那种假绿）
    assert.equal(memoryPushLine(), '', '★没投过时**不许**报任何"已投"——宁可什么都不显示');
    // ② 成功：轮次与条数照实报
    const ok = markMemoryPush({ ok: true, tick: '第 9 轮', counts: { 世界大事: 5, 史卷纪要: 0 } }, 9);
    assert.equal(ok.ok, true);
    const line = memoryPushLine();
    assert.ok(line.includes('第 9 轮'), `自证行要带轮次，实际：${line}`);
    assert.ok(line.includes('大事 5 条'), `自证行要带大事条数，实际：${line}`);
    // ③ 失败：必须把原因说出来（用户就是靠这句话才能定位）
    markMemoryPush({ ok: false, reason: '插件未加载（柚月の记忆）' });
    assert.ok(memoryPushLine().includes('插件未加载'), '失败要报原因，不许只说"失败"');
    assert.ok(memoryPushLine().includes('⚠'), '失败要有可辨识的标记');
});

// ★leg27 i（用户实机第二次报真相：「**上次投递失败：MEMORY_TABLE_MILESTONES is not defined**」）：
//   病 = `web/index.js` 的成功日志那一行用了 `MEMORY_TABLE_MILESTONES`，而 import 只写了两个常量
//   ⇒ 投递**其实算完了、也写出去了**，只在**打日志**这一步抛 ReferenceError，
//   而调用点写着 `.catch(() => {})` ⇒ **错误被吞得一点痕迹都没有**，插件里自然什么都没有。
//   ★为什么上一条锁没抓到它（这一棒最该记住的一条）：那条锁**只调 `markMemoryPush`**（喂现成结果），
//   而**没有真跑 `pushMemoryNow`** —— "只调标记函数 ≠ 真跑那条路"。判据必须走**真函数**。
//   本判据：装上假 `window.YuzukiMemory`，真调 `pushMemoryNow`，并让**成功日志**也跑一遍
//   （console.info 会在这条路径上被调用；若那行引用了没导入的标识符，就会在这里抛出来）。
test('★leg27 i：pushMemoryNow 必须**真跑得通**（成功日志那一行的引用错误曾被 .catch(()=>{}) 吞掉）', async () => {
    const world = {
        version: 1, context: { world: '大荒', positions: ['临渊城'], setting: { dynamic: { env: {} } } },
        entities: [{ id: 'e1', kind: 'faction', name: '大虞', location: '临渊城' }], weights: {}, agendas: [
            { id: 'a_12_1', owner: 'e1', goal: '夺大盘谷阵眼', stage: '集兵', visibility: 'known', maxSteps: 4, progress: 1, memory: { promises: [], done: [], blocked: [], turnsAlive: 1 } },
        ], events: [], chronicle: [], milestones: [], meta: { tick: 12, simLog: [] },
    };
    const written = [];
    const fakeYM = {
        VariableInjector: { createDefaultState: () => ({ tables: [], activeTableId: '', activeRecordIds: {}, records: {} }) },
        Storage: {
            loadState: () => ({ tables: [], activeTableId: '', activeRecordIds: {}, records: {} }),
            saveState: (state) => { written.push(state); return true; },
        },
    };
    const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
    const prevWindow = globalThis.window;
    globalThis.window = { YuzukiMemory: fakeYM };
    // 日志也是被测路径的一部分：它必须能跑（真实事故就发生在这一行）。这里只记录，不静音。
    const logs = [];
    const realInfo = console.info; const realWarn = console.warn;
    console.info = (...a) => logs.push(['info', ...a]);
    console.warn = (...a) => logs.push(['warn', ...a]);
    try {
        const r = await pushMemoryNow(world);
        assert.equal(r.ok, true, `★pushMemoryNow 必须成功（失败原因：${r.reason || '—'}）——「每轮投递没跑成」的真凶就在这里`);
        assert.ok(written.length >= 1, '必须真的调到插件的 saveState（否则等于没投）');
        const warned = logs.filter(([k]) => k === 'warn');
        assert.equal(warned.length, 0, `★成功路径不许有警告（事故形态：日志行抛错被吞）——实际：${JSON.stringify(warned)}`);
        assert.ok(logs.some(([k, ...a]) => k === 'info' && JSON.stringify(a).includes('第 12 轮')),
            `★成功日志必须真打得出来（引用错误就藏在这里）——实际日志：${JSON.stringify(logs)}`);
    } finally {
        console.info = realInfo; console.warn = realWarn;
        if (hadWindow) globalThis.window = prevWindow; else delete globalThis.window;
    }
    // 失败面：store 缺插件 ⇒ 如实报原因（且不许抛）
    const before = globalThis.window;
    globalThis.window = {};
    try {
        const r2 = await pushMemoryNow(world);
        assert.equal(r2.ok, false);
        assert.match(String(r2.reason), /插件未加载/, '插件不在时要如实说"插件未加载"');
    } finally {
        if (before === undefined) delete globalThis.window; else globalThis.window = before;
    }
});


// ★leg27 e（用户实拍：s1 时间最新、s12 最旧，**id 与时间完全对不上**）：
//   病 = **`seq` 只活在内存里，刷新即归零，而 IDB 里的旧快照还在**。IDB 键是 `${chatId}:${id}`
//   ⇒ 刷新后新链又从 s1 开始 ⇒ **新快照按 id 覆盖旧快照**，多条链交织、重复份永远清不掉。
//   判据：链必须**加载时与盘对齐**（取盘上最大序号续号），且"重置"必须把对齐标记一起清掉。
test('★leg27 e：快照链必须与盘对齐（刷新不许把 seq 归零 ⇒ 不许覆盖旧快照）', () => {
    // ★leg73：这一族已整族搬进 `web/snapshot-store.js` ⇒ 取样改指新家（判据内容一个字没改）
    const web = SRC_OF_FILE['web/snapshot-store.js']();
    const bodyOf = (marker) => {
        const a = web.indexOf(marker);
        if (a < 0) return '';
        const nexts = ['\nasync function ', '\nfunction ', '\nexport async function ', '\nexport function ']
            .map((nm) => web.indexOf(nm, a + marker.length)).filter((i) => i > 0);
        return web.slice(a, nexts.length ? Math.min(...nexts) : undefined);
    };
    const ensure = bodyOf('async function ensureSnapshotChain(');
    assert.ok(ensure.length > 100, '前置：`ensureSnapshotChain` 必须在（链对齐的收口）');
    // ★leg73：签名由 `snapshotStore()` 变成 `snapshotStore(freshCtx)`（它现在只接注入来的 freshCtx）
    //   ⇒ 判据锚**语义**（"必须真的读盘 list()"），不锚那个实参名——否则每次改注入形态都要改锁。
    assert.match(ensure, /snapshotStore\([^)]*\)\.list\(\)/, '★必须真的读盘（盘上有什么，链就从哪接着长）');
    // 判据用**纯字符串包含**（不用正则字面量——本次就因为转义踩了一次"整文件语法错"）
    assert.ok(ensure.includes('/^s(' + String.fromCharCode(92) + 'd+)$/'), '★必须按 `s<数字>` 精确解析序号（旧法 `replace(/^s/,\'\')` 会静默降级成 0）');
    assert.match(ensure, /maxSeq/, '★取盘上最大序号续号（不是从 0 重来）');
    // 三个入口都必须先对齐：拍快照 / 读清单 / （重置时清标记）
    assert.match(bodyOf('function requestSnapshot('), /await ensureSnapshotChain\(\)/, '★拍快照前必须对齐（否则覆盖旧的）');
    assert.match(bodyOf('async function refreshSnapshots('), /await ensureSnapshotChain\(\)/, '★读清单前必须对齐');
    const clear = bodyOf('export async function clearSnapshots(');
    assert.match(clear, /sw2SnapInited = null/, '★清空必须把"已对齐"标记一起清（否则新链又从头覆盖）');
    assert.match(clear, /sw2SnapLast = \[\]/, '清空必须把去重指纹一起清');
    // 重置 = 清空 + 立刻重拍链头（否则用户清完看不到任何东西，以为没生效）
    const reset = bodyOf('export async function resetSnapshots(');
    assert.match(reset, /await clearSnapshots\(\)/, '重置必须先清空');
    assert.match(reset, /requestSnapshot\(current/, '★重置后必须立刻给当前世界拍一份链头');
});

// ★★★leg72b（**真缺陷，本棒修掉的**）：恢复快照那条通道的落盘**曾被换成存根**。
//   病：`restoreSnapshot()` 里写的是 `const flushed = { ok: true };`（leg67–71 期间的未提交改动），
//   而 `bus['snapshot-restore']` 印的是 `r.flushed ? ' · 已落盘' : ' · ⚠ 落盘失败'`
//   ⇒ ①**一次 `flushHotMeta()` 都没调**；②那半句**恒真**（对象真值恒为真）⇒ 面板**报了一个不再为真的数**。
//   ★为什么原来没有锁咬住它：`test/adopt-scale-draft.test.js` 里有一条 leg70 立的**锚点唯一性**判据，
//   它顺手记了一句"不带注释的 `const flushed = await flushHotMeta();` 在全仓共 6 处"——
//   ★那是**观察值、不是设计不变量**（探针实测 7 处），所以存根把它变成 5 处时**一条锁都没红**。
//   ⇒ 本判据锚**语义**（"恢复这条通道必须真的落盘、且结果如实流到面板"），不锚计数。
test('★★leg72b：恢复快照必须**真的落盘**、且面板读的是**真状态**（防"存根恒真"回潮）', () => {
    // ★leg73：`restoreSnapshot` 随快照族搬进 `web/snapshot-store.js`（判据内容一个字没改）；
    //   面板侧那句（`r.flushed?.ok`）仍在接线层的 `bus['snapshot-restore']` 里 ⇒ 两处各按新家取。
    const web = SRC_OF_FILE['web/index.js']();                       // 面板侧（动作总线）
    const snapMod = SRC_OF_FILE['web/snapshot-store.js']();          // 恢复通道的实现体
    const bodyOfIn = (src, marker, nextMarkers) => {
        const a = src.indexOf(marker);
        if (a < 0) return '';
        let b = -1;
        for (const nm of nextMarkers) {
            const i = src.indexOf(nm, a + marker.length);
            if (i > 0 && (b < 0 || i < b)) b = i;
        }
        return src.slice(a, b > 0 ? b : undefined);
    };
    const body = bodyOfIn(snapMod, 'export async function restoreSnapshot(', ['\nexport async function clearSnapshots(']);
    assert.ok(body.length > 200, '前置：取得到 restoreSnapshot 的函数体（新家 web/snapshot-store.js）');

    // ① 真落盘（leg20 语义：关键路径**落盘后**才报成功）——★这一条就是那条存根的反面
    assert.match(body, /const flushed = await flushHotMeta\(\);/,
        '★恢复通道必须**真的** `await flushHotMeta()`（写成 `{ ok: true }` 存根 ⇒ 一次落盘都没调，却报"已落盘"）');
    // ★★"不许是字面量"这一条**必须剥掉注释再判**：本判据上面的说明注释里**逐字写着那个存根**
    //   ⇒ 裸正则当场红在我自己的留档上（本仓 leg71 §4.1 那个洞的**第三次**复发，如实留档）。
    //   口径：只剥**整行注释**（够用且不会误伤含引号的真代码行）。
    const codeOnly = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const stripSelfRef = (t) => t.replace(/const flushed = \{ ok: true \};/g, '');   // 去掉"反面样例"那个字面量引用
    assert.ok(!/const flushed = \{/.test(codeOnly(stripSelfRef(body))),
        '★★落盘结果**不许是字面量**（存根 `{ ok: true }` 会让下游恒判成功——本棒修掉的正是它）');
    assert.ok(/const flushed = \{/.test(body),
        '★剥离器自证：本判据的注释里**确实**写着那个存根（所以上面那条才必须剥注释再判）');
    // ② 结果必须**流出去**（算了不用 = 还是个摆设）
    assert.match(body, /return \{[^}]*\bflushed\b/, '★`flushed` 必须随返回值交给调用方（否则面板无从如实报）');

    // ③ 面板侧读的必须是**真状态**：`flushHotMeta` 返回三态对象 ⇒ 要读 `.ok`，不是判对象真值
    //    （写 `r.flushed ?` 是判对象真值=恒真 ⇒ 真失败也印"已落盘"）
    assert.match(web, /r\.flushed\?\.ok \? ' · 已落盘' : ' · ⚠ 落盘失败（见控制台）'/,
        '★★`snapshot-restore` 必须按 `flushed.ok` 分叉（原来写 `r.flushed ?` ⇒ 恒真、失败也报已落盘）');

    // ④ 反向自证：这条判据咬的是**形状**，拿两个假函数体验一遍，必须"好的过、坏的不过"
    const GOOD = 'const flushed = await flushHotMeta();\nsw2LastWorld = x;\nreturn { ok: true, tick: t, plan: p, flushed };';
    const BAD = 'const flushed = { ok: true };\nsw2LastWorld = x;\nreturn { ok: true, tick: t, plan: p, flushed };';
    assert.match(GOOD, /const flushed = await flushHotMeta\(\);/, '★反向自证：真落盘那种写法必须被认成合格');
    assert.ok(!/const flushed = \{/.test(GOOD), '★反向自证：真落盘不许被误判成存根');
    assert.match(BAD, /const flushed = \{/, '★反向自证：**存根必须被认出来**（否则这条锁是假绿）');
});

test('★leg27 后：生产接线——快照钩子真的挂在唯一落账收口 writeHotMeta 上', () => {
    // ★leg73：本判据横跨**两个文件** ⇒ 各按"符号的新家"取：
    //   · `writeHotMeta`（落账收口）★**leg78 起搬进 `web/hot-ledger.js`**（热账族整族搬走）；
    //   · `requestSnapshot` / `restoreSnapshot` 的实现体在 `web/snapshot-store.js`（leg73 搬的）。
    const hotMod = SRC_OF_FILE['web/hot-ledger.js']();
    const snapMod = SRC_OF_FILE['web/snapshot-store.js']();
    // 取样按**函数边界**（用下一个顶层声明当下界），不用魔数窗口——本次吃过"窗口太短 ⇒ 断言假红"
    const bodyOfIn = (src, marker, nextMarkers) => {
        const a = src.indexOf(marker);
        if (a < 0) return '';
        let b = -1;
        for (const nm of nextMarkers) {
            const i = src.indexOf(nm, a + marker.length);
            if (i > 0 && (b < 0 || i < b)) b = i;
        }
        return src.slice(a, b > 0 ? b : undefined);
    };
    // ★leg78：`writeHotMeta` 现在**不带 `function` 前缀**（它是 `export function`）
    const fn = bodyOfIn(hotMod, 'export function writeHotMeta(meta)', ['\nexport function ', '\nfunction ', '\nconst ', '\nlet ']);
    assert.ok(fn.length > 100, '前置：在热账新家找得到 writeHotMeta 函数体');
    // ★leg73：调用点改成走 hub（`snapHub.requestSnapshot(…)`）——判据锚**"这一处必须真的调它"**，
    //   所以形态都接受：裸名（旧）· `snapHub.` 成员（leg73）· `getSnapHub().` 取值函数（★leg78：
    //   快照 hub 由接线层**在热账之后**才建 ⇒ 只能注入取值函数，见 `web/hot-ledger.js` 文件头"两处迟到"）。
    //   ★不许放宽成"只要提到 requestSnapshot"——必须带左括号（= 真调用），否则一句注释就能骗过它。
    assert.match(fn, /(?:^|[^\w$.])(?:getSnapHub\(\)\.|snapHub\.)?requestSnapshot\s*\(/,
        '★writeHotMeta 必须**真的调** requestSnapshot（裸名 / `snapHub.` / `getSnapHub().`）——否则"每步生成快照"根本没接线');
    // ★自证：必须走**受控通道**（不是裸名，也不是直接抓死那个 hub 对象）——防"判据放宽之后旧形态悄悄回潮"
    assert.match(fn, /getSnapHub\(\)\.requestSnapshot\s*\(/,
        '★leg78 起落账钩子必须走 `getSnapHub().requestSnapshot(`（快照 hub 是迟到注入的取值函数）');
    const req = bodyOfIn(snapMod, 'export function requestSnapshot(', ['\nasync function ', '\nfunction ', '\nexport async function ']);
    assert.ok(req.length > 100, '前置：在新家取得到 requestSnapshot 的函数体');
    assert.match(req, /catch\s*\(/, '★requestSnapshot 必须自带 try/catch（快照失败绝不许影响世界推进）');
    // ★leg27 d：内容闸必须在（"落账"不等于"世界动了"）
    assert.match(req, /sw2SnapLast/, '★必须有"内容没变就不拍"的闸（用户实拍「怎么一下子多了这么多，落账太细了还是 tick 吧」）');
    assert.match(req, /if \(sw2SnapLast\.includes\(fp\)\) return;/, '★逐字节相同 ⇒ 直接不拍');
    const restore = bodyOfIn(snapMod, 'export async function restoreSnapshot(', ['\nexport async function ', '\nfunction ']);
    assert.match(restore, /requestSnapshot\(current/, '★恢复前必须先给当前状态拍一份');
    assert.match(restore, /if \(!r\.ok\) return \{ ok: false/, '★链不可恢复时明确拒绝（不许"大概恢复"）');
    // ★leg78：`SECTIONS`（八个页签）是**接线层**的东西，与热账族无关 ⇒ 这里按名字取接线层源码
    assert.match(SRC_OF_FILE['web/index.js'](), /'snapshots'/, 'SECTIONS 必须含 snapshots');
    const tpl = readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
    assert.match(tpl, /id="sw2_view_snapshots"/, '★模板必须有快照页容器（缺它 ⇒ 渲染产物无处可填）');
    assert.equal(typeof renderSnapshotsHtml, 'function', '渲染面 renderSnapshotsHtml 必须在');
    const out = renderAll({ meta: { tick: 1 }, entities: [], weights: {}, chronicle: [], context: {} }, { config: { snapshots: { list: [{ id: 's1', tick: 1, kind: 'full', bytes: 100, reason: '落账', at: 'T' }], text: '快照 1 份' } } });
    assert.ok(String(out.snapshots).includes('s1'), '渲染产物必须真的画出快照行');
});
