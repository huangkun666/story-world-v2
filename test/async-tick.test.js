// story-world-v2/test/async-tick.test.js
// K36 异步化与可靠性（编排层，验收 A-4/A-5）：串行防重入锁 / 失败世界不动+可重试 /
//   无世界零阻塞 / 成功链（tick→save→refresh）/ 异常兜底。全部 fake 注入，不联网。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTickQueue } from '../src/async-tick.js';

function deps(overrides = {}) {
    const d = {
        tick: async ({ world, dialogue }) => ({ ok: true, ssot: { ...world, meta: { tick: (world.meta?.tick ?? 0) + 1, lastDialogue: dialogue } } }),
        load: () => ({ meta: { tick: 3 }, entities: [], agendas: [] }),
        save: (ssot) => ssot,
        refresh: () => {},
        onStatus: () => {},
        ...overrides,
    };
    return d;
}

test('K36/A-4 成功链：advance → tick → save → refresh 全走通，返回新 tick', async () => {
    const calls = [];
    const d = deps({
        save: (ssot) => { calls.push('save'); return { ...ssot, saved: true }; },
        refresh: (hot) => { calls.push('refresh'); assert.equal(hot.saved, true); },
    });
    const q = createTickQueue(d);
    const r = await q.advance('本轮发言');
    assert.equal(r.ok, true);
    assert.equal(r.tick, 4);
    assert.deepEqual(calls, ['save', 'refresh']);
});

test('K36/A-4 无世界：零阻塞提示，不调 tick', async () => {
    const statuses = [];
    const d = deps({ load: () => null, onStatus: (m) => statuses.push(m) });
    const q = createTickQueue(d);
    const r = await q.advance();
    assert.deepEqual(r, { ok: false, skipped: 'no-world' });
    assert.match(statuses.join(''), /尚无世界.*导入恢复/); // 第十三棒：提示给双入口（导入恢复 / 开始新世界）
});

test('K36/A-5 防重入：演算中再点 → busy 拒；演算完放行（连点保护）', async () => {
    let release;
    const gate = new Promise((res) => { release = res; });
    let tickCount = 0;
    const d = deps({
        tick: async () => { tickCount += 1; await gate; return { ok: true, ssot: { meta: { tick: 5 } } }; },
    });
    const q = createTickQueue(d);
    const p1 = q.advance();
    await Promise.resolve(); // 让第一次进入 running
    const p2 = q.advance();  // 连点：应 busy
    const r2 = await p2;
    assert.equal(r2.ok, false);
    assert.equal(r2.skipped, 'busy');
    release();
    const r1 = await p1;
    assert.equal(r1.ok, true);
    assert.equal(tickCount, 1); // 只演算了一次
    const r3 = await q.advance(); // 完成后可再推
    assert.equal(r3.ok, true);
    assert.equal(tickCount, 2);
});

test('K36/A-5 失败降级：tick 失败 → 世界不动（save 不调）+ 可重试成功', async () => {
    let fail = true;
    const saved = [];
    const d = deps({
        tick: async () => (fail ? { ok: false, error: 'HTTP 500' } : { ok: true, ssot: { meta: { tick: 9 } } }),
        save: (ssot) => { saved.push(ssot); return ssot; },
    });
    const q = createTickQueue(d);
    const r = await q.advance();
    assert.equal(r.ok, false);
    assert.equal(r.error, 'HTTP 500');
    assert.equal(saved.length, 0); // 世界原样未动
    fail = false;
    const r2 = await q.advance(); // 重试路径
    assert.equal(r2.ok, true);
    assert.equal(saved.length, 1);
});

test('K36/A-5 超时/异常兜底：tick 抛错 → 捕获为失败，save 不调，可重试', async () => {
    let boom = true;
    const saved = [];
    const d = deps({
        tick: async () => { if (boom) throw new Error('主调用超时（提案）'); return { ok: true, ssot: { meta: { tick: 2 } } }; },
        save: (ssot) => { saved.push(ssot); return ssot; },
    });
    const q = createTickQueue(d);
    const r = await q.advance();
    assert.equal(r.ok, false);
    assert.match(r.error, /超时/);
    assert.equal(r.thrown, true);
    assert.equal(saved.length, 0);
    boom = false;
    assert.equal((await q.advance()).ok, true);
    assert.equal(saved.length, 1);
});

test('第十三棒回归：save 异步（Promise）→ refresh 收到解析后的真世界，不是 Promise', async () => {
    const seen = [];
    const d = deps({
        save: async (ssot) => { await Promise.resolve(); return { ...ssot, saved: true }; },
        refresh: (hot) => { seen.push(Boolean(hot && hot.saved)); },
    });
    const q = createTickQueue(d);
    const r = await q.advance();
    assert.equal(r.ok, true);
    assert.deepEqual(seen, [true]); // 若拿到 Promise：hot.saved === undefined → [false]
});

test('第十三棒回归：save 抛错 → 落账失败回执（世界已演算未保存），refresh 不调，可重试', async () => {
    let boom = true;
    const refreshCalls = [];
    const d = deps({
        save: async () => { if (boom) throw new Error('IDB 写入失败'); return { meta: { tick: 7 } }; },
        refresh: () => { refreshCalls.push(1); },
    });
    const q = createTickQueue(d);
    const r = await q.advance();
    assert.equal(r.ok, false);
    assert.match(r.error, /IDB 写入失败/);
    assert.equal(r.save, true);
    assert.equal(refreshCalls.length, 0);
    boom = false;
    assert.equal((await q.advance()).ok, true);
    assert.equal(refreshCalls.length, 1);
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// ★★★leg152：`afterTick`（给"加速层"留的旁路）——三条纪律逐条钉住
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
test('leg152 旁路：世界成功收尾**之后**才调，且拿得到刚写下去的那份世界与这一轮正文', async () => {
    const seen = [];
    const d = deps({
        save: (ssot) => ({ ...ssot, saved: true }),
        refresh: () => seen.push('refresh'),
        afterTick: ({ hot, world, dialogue }) => seen.push({ saved: hot?.saved === true, tick: world?.meta?.tick, dialogue }),
    });
    const q = createTickQueue(d);
    const r = await q.advance('我去落霞谷');
    assert.equal(r.ok, true);
    assert.deepEqual(seen[0], 'refresh', '★refresh 必须排在旁路之前（玩家先看到新世界）');
    assert.deepEqual(seen[1], { saved: true, tick: 4, dialogue: '我去落霞谷' }, `旁路该拿到真世界与正文：${JSON.stringify(seen[1])}`);
});

test('leg152 旁路：**同步抛错** ⇒ 只报一句、绝不改回执（世界优先）', async () => {
    const statuses = [];
    const d = deps({ onStatus: (m) => statuses.push(String(m)), afterTick: () => { throw new Error('向量层炸了'); } });
    const q = createTickQueue(d);
    const r = await q.advance('x');
    assert.equal(r.ok, true, '★旁路炸了不许把这一轮回执改成失败');
    assert.equal(r.tick, 4);
    assert.match(statuses.join(''), /旁路.*向量层炸了/, `要出声（不许静默）：${statuses.join(' | ')}`);
});

test('leg152 旁路：**异步 reject** ⇒ 也不许冒泡成未捕获异常（同样只报一句）', async () => {
    const statuses = [];
    const d = deps({ onStatus: (m) => statuses.push(String(m)), afterTick: async () => { throw new Error('补嵌失败'); } });
    const q = createTickQueue(d);
    const r = await q.advance('x');
    assert.equal(r.ok, true);
    await new Promise((res) => setTimeout(res, 5));       // 等那个被吞掉的 promise 走完
    assert.match(statuses.join(''), /旁路.*补嵌失败/);
});

test('leg152 旁路：不 await 它 ⇒ **不让玩家多等**（慢旁路不许拖住回执）', async () => {
    let done = false;
    const d = deps({ afterTick: () => new Promise((res) => setTimeout(() => { done = true; res(); }, 50)) });
    const q = createTickQueue(d);
    const t0 = Date.now();
    const r = await q.advance('x');
    const dt = Date.now() - t0;
    assert.equal(r.ok, true);
    assert.ok(dt < 40, `★回执不该等旁路（实测 ${dt}ms）`);
    assert.equal(done, false, '旁路还在跑——这正是"不挡"的意思');
});
