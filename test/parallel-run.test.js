// story-world-v2/test/parallel-run.test.js
//
// ★★★leg144：**并发这一刀的判据**（用户令「**在保证抽象质量的情况下优化抽象的时间**」）。
//
// 本文件锁两件事，**缺一条这一笔就不成立**：
//   ① **机制**（`src/parallel-run.js`）：并发发出去、**按原下标收回来**；额度可当场调低而不丢活儿。
//   ② **质量**（`src/abstract.js` / `src/seed-roots.js`）：**并发 1 与并发 3 的产物逐字节相同**。
//      ★这一条是本笔的**承重判据**——没有它，"并发没改抽象质量"就只是我嘴上说的。
//
// ★为什么"按原下标收回"是质量而不是洁癖（写判据之前先想清咬哪一层）：
//   下游有两条**有次序**的定稿口径——
//     · `dedupeRoster`：「每组取**最先出现**的那个叫法当 `name`」；
//     · `mergeCanonChunks`：「**首块优先**」（张力与四个环境档位只看第一块）。
//   按完成次序收回，这两条会**悄悄换人**（判据只数得出"名字/档位变了"，指不出是谁换的）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runParallel } from '../src/parallel-run.js';
import { extractWorldSetting, SETTING_CHUNK_CHAR } from '../src/abstract.js';
import { seedRootsChunked } from '../src/seed-roots.js';

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝ ① 机制 ＝＝＝＝＝＝＝＝＝＝＝＝＝＝

test('★leg144·机制①：结果**按原下标**收回（谁先回来不影响次序）', async () => {
    // 完成次序 = 3,1,2,0（第 0 件最慢）⇒ 若按"谁先回来谁先 push"，得到的是 [3,1,2,0]
    const out = await runParallel([30, 5, 20, 1], 4, async (ms, i) => { await sleep(ms); return i; });
    assert.deepEqual(out, [0, 1, 2, 3],
        '★★结果必须与原数组**同序**（这一条就是"抽象质量没变"的地基：下游两条口径都吃次序）');
});

test('★leg144·机制②：真的并发了（同一时刻在飞的最大件数 = 额度）——否则本笔是空跑', async () => {
    let live = 0;
    let peak = 0;
    await runParallel([1, 1, 1, 1, 1, 1], 3, async () => {
        live += 1; peak = Math.max(peak, live);
        await sleep(10);
        live -= 1;
    });
    assert.equal(peak, 3, `★额度 3 ⇒ 峰值必须真到 3（实测 ${peak}；若是 1 说明根本没并发，本笔白做）`);
});

test('★leg144·机制③：额度**当场调低** ⇒ 多余的 lane 有序退场，且**一件活儿都不丢、不重**', async () => {
    // 这条锁的是"失败即退回串行"那条安全带：降级不许把已经取走的活儿丢掉，也不许把同一件发两遍。
    const items = [0, 1, 2, 3, 4, 5, 6, 7];
    const ran = [];
    let cap = 3;
    const out = await runParallel(items, () => cap, async (x) => {
        ran.push(x);
        if (ran.length === 1) cap = 1;     // 第一件回来就降级（模拟"网关推回 ⇒ 退回串行"）
        await sleep(5);
        return x * 10;
    });
    assert.deepEqual([...ran].sort((a, b) => a - b), items,
        `★每件活儿**恰好跑一次**（降级不许丢活儿、也不许重发；实际跑了 ${ran.length} 件：${ran}）`);
    assert.deepEqual(out, items.map((x) => x * 10), '★降级之后结果照样按原下标收回');
});

test('★leg144·机制④：额度是 0 / 负数 / NaN ⇒ **当 1**（绝不许算出"0 条 lane"）', async () => {
    // 0 条 lane = 一件活儿都不会被取走，而返回的却是一个"跑完了"的空数组 ⇒ **静默丢数据**（本仓最忌那种）。
    for (const bad of [0, -3, NaN, undefined, 'x']) {
        const seen = [];
        const out = await runParallel([1, 2, 3], bad, async (x) => { seen.push(x); return x; });
        assert.deepEqual(seen, [1, 2, 3], `★额度=${String(bad)} 时三件活儿必须都跑到（实际 ${seen.length} 件）`);
        assert.deepEqual(out, [1, 2, 3], `★额度=${String(bad)} 时结果照常按序收回`);
    }
});

test('★leg144·机制⑤：空清单 ⇒ 空结果、一条 lane 都不建（零调用）', async () => {
    let called = 0;
    const out = await runParallel([], 3, async () => { called += 1; });
    assert.deepEqual(out, []);
    assert.equal(called, 0, '★空清单不许产生任何一次调用');
});

test('★leg144·机制⑥：一件活儿抛错 ⇒ 照常上抛（不许吞掉）', async () => {
    await assert.rejects(
        () => runParallel([1, 2, 3], 2, async (x) => { if (x === 2) throw new Error('这一件炸了'); return x; }),
        /这一件炸了/,
        '★worker 的异常必须上抛给调用方（吞掉 = 把失败伪装成成功）',
    );
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝ ② 质量（承重判据） ＝＝＝＝＝＝＝＝＝＝＝＝＝＝

// 测试书：k0..k(n-1) 条目行（约 210 字符/条）⇒ 400 条约 8.4 万字符 ⇒ 3 块（`SETTING_CHUNK_CHAR`=3 万）
function makeBook(n) {
    const rows = [];
    for (let i = 0; i < n; i += 1) rows.push(`【k${i}】名号${i} ` + '字'.repeat(200));
    return rows.join('\n');
}

/**
 * 确定性 mock：**每一块交的东西都不一样**，且**块 0 故意最慢**。
 *   ★为什么"块 0 最慢"是这条判据的关键：并发 3 时它会**最后**回来。
 *     若实现按完成次序累加，第一个进 `rawCanons` 的就不是块 0 ⇒ 张力/环境当场换成别人的值 ⇒ 红。
 *   ★为什么张力/环境能当"次序探针"：`mergeCanonChunks` 的定稿口径是**首块优先**（见本文件头注）。
 */
function makeOrderProbeExtract({ slowMs = 80, fastMs = 5, log = null } = {}) {
    return async (prompt) => {
        const header = '———— 设定原文如下 ————';
        const src = prompt.includes(header) ? prompt.slice(prompt.indexOf(header) + header.length) : '';
        const m = /【k(\d+)】/.exec(src);
        const tag = m ? Number(m[1]) : -1;
        if (log) log.push(tag);
        await sleep(tag === 0 ? slowMs : fastMs);      // ★块 0 最慢
        const bookEntities = [];
        const re = /【k(\d+)】(\S+)/g;
        let mm;
        while ((mm = re.exec(src))) bookEntities.push({ name: `名号${mm[1]}`, kind: 'character' });
        return JSON.stringify({
            bookEntities,
            entities: [],
            // 次序探针：值随块变（块 0 ⇒ 正邪k0 / 崩溃）
            tension: { polarity: `正邪k${tag}`, direction: '邪压正' },
            env: { 民生度: tag % 2 === 0 ? '崩溃' : '富足' },
        });
    };
}

test('★★★leg144·质量锁：**并发 1 与并发 3 的产物逐字节相同**（本笔的承重判据）', async () => {
    const src = makeBook(400);
    assert.ok(Array.from(src).length > SETTING_CHUNK_CHAR * 2, '前置：确为"多块"的大书（否则这条锁是空跑）');

    const calls1 = [];
    // ★`extractedAt` 钉死：它是**抽取时刻的戳**（两次跑必然不同），不钉的话这条锁比的是时钟不是产物。
    const r1 = await extractWorldSetting({ sourceText: src, extract: makeOrderProbeExtract({ log: calls1 }), cache: null, concurrency: 1, extractedAt: 'T' });
    const calls3 = [];
    const r3 = await extractWorldSetting({ sourceText: src, extract: makeOrderProbeExtract({ log: calls3 }), cache: null, concurrency: 3, extractedAt: 'T' });

    assert.equal(r1.ok, true, '前置：串行那一跑是成的');
    assert.equal(r3.ok, true, '并发那一跑也必须是成的');
    // ① 产物逐字节相同（★这条是本笔存在的理由）
    assert.deepEqual(r3.setting, r1.setting,
        '★★★并发 3 的设定必须与并发 1 **逐字节相同**（同块、同提示词、同合并、同出处闸——只有排不排队变了）');
    // ② 失败留痕的**次序**也相同（errors 是按块序拼的；按完成次序拼会在这里露馅）
    assert.deepEqual(r3.errors, r1.errors, '★errors 的次序也必须与串行一致（它是按块序拼的）');
    // ③ 调用次数一次不差（并发不许丢活儿、也不许重发）
    assert.equal(r3.timing.calls, r1.timing.calls, `★调用数必须相同（串行 ${r1.timing.calls} / 并发 ${r3.timing.calls}）`);
    assert.equal(calls3.length, calls1.length, '★真正发出去的调用数也必须相同');
    // ④ 反向自证：**次序探针真的在咬** —— 张力/环境取自**块 0**（块 0 在并发下是最慢的那一块）
    assert.equal(r1.setting.dynamic.tension.polarity, '正邪k0', '前置：串行时张力确实取自块 0（首块优先）');
    assert.equal(r3.setting.dynamic.tension.polarity, '正邪k0',
        '★★次序探针：并发下张力**仍然**取自块 0——若按完成次序累加，这里会变成后面某一块的值（这就是本条要咬的那一层）');
    assert.equal(r3.setting.dynamic.env['民生度'], '崩溃', '★环境档位同理（首块优先）');
});

test('★leg144：`concurrency` 缺省 = 1 ⇒ 老调用方（判据/demo）行为逐字不变', async () => {
    const src = makeBook(400);
    const a = await extractWorldSetting({ sourceText: src, extract: makeOrderProbeExtract(), cache: null, extractedAt: 'T' });
    const b = await extractWorldSetting({ sourceText: src, extract: makeOrderProbeExtract(), cache: null, concurrency: 1, extractedAt: 'T' });
    assert.deepEqual(a.setting, b.setting, '★不传 `concurrency` 与传 1 必须完全一样（缺省是 1，不是"看情况"）');
});

test('★leg144·进度计时：并发下每段的 `ms` 必须是**这一段自己的**（不许串味）', async () => {
    // 病（本笔并发化当场会咬到）：旧法用一个共享的 `last` 记"这一刻"，`finish` 拿它算耗时——
    //   并发时**后发的那一段会把先发那一段的起点覆盖掉** ⇒ 报出来的 `ms` 是别人的时间。
    //   ★这条判据要咬住它，夹具必须满足两件事（**第一版没满足，当场是假绿，如实留档**）：
    //     ① 块数**多于**额度（≥5 块 / 3 路）——否则没有哪条 lane 会在慢块还在跑时**再取一件新的**
    //        （"再取一件"那一刻才会改写共享的 `last`；第一版只有 3 块 3 路，谁都不用再取 ⇒ 假绿）；
    //     ② 让**第 0 块**明显慢（600ms vs 150ms）——它是被串味的受害者。
    //   ★为什么阈值只写单边（`>=`）：机器忙只会让 `ms` **变大**，绝不会变小
    //     ⇒ 这条断言对"跑得慢的机器"免疫，只对"计时串味"变红。
    const src = makeBook(800);          // ≈16.8 万字符 ⇒ 6 块（> 3 路，满足条件①）
    const extract = async (prompt) => {
        const header = '———— 设定原文如下 ————';
        const s = prompt.includes(header) ? prompt.slice(prompt.indexOf(header) + header.length) : '';
        const first = Number(/【k(\d+)】/.exec(s)?.[1] ?? -1);
        await sleep(first === 0 ? 600 : 150);            // 条件②：第 0 块最慢
        const bookEntities = [];
        const re = /【k(\d+)】(\S+)/g;
        let mm;
        while ((mm = re.exec(s))) bookEntities.push({ name: `名号${mm[1]}`, kind: 'character' });
        return JSON.stringify({ bookEntities, entities: [], tension: { polarity: `正邪k${first}`, direction: '邪压正' }, env: {} });
    };
    const r = await extractWorldSetting({ sourceText: src, extract, cache: null, concurrency: 3, extractedAt: 'T' });
    assert.equal(r.ok, true, '前置：这一跑是成的');
    const slowest = r.timing.steps.filter((e) => e.phase === 'finish').reduce((a, b) => ((b.ms || 0) > (a.ms || 0) ? b : a));
    assert.ok((slowest.ms || 0) >= 500,
        `★★最慢那一段的耗时必须接近它**自己**的 600ms（实测 ${slowest.ms}ms）——`
        + '若明显偏小，说明计时被别段的 `start` 覆盖了（共享 `last` 那个病）');
});

test('★★leg144·质量锁（起根）：**并发 1 与并发 3 起出来的根逐字节相同**', async () => {    const mkWorld = () => ({ meta: { tick: 0 }, entities: [{ id: 'e1', name: '青丘' }], events: [] });
    // 三块，且**三块都报同一个标题** —— 跨块去重是**有次序**的判据（"先见到的那块算数"），
    //   ⇒ 它必须仍在收口按块序做（放进并发里跑就是看谁先回来）。
    const chunkOf = (n) => `【块${n}】` + '甲'.repeat(40) + `第${n}段的原话在这里`;
    const chunks = [chunkOf(1), chunkOf(2), chunkOf(3)];
    const mkExtract = (slowFirst = false) => async (prompt) => {
        const n = /【块(\d+)】/.exec(prompt)?.[1] ?? '0';
        await sleep(slowFirst && n === '1' ? 60 : 5);        // ★第一块最慢（并发下最后回来）
        return { roots: [{ title: '同一件事', parties: ['青丘'], quote: `第${n}段的原话在这里` }] };
    };
    const r1 = await seedRootsChunked({ ssot: mkWorld(), chunks, extract: mkExtract(false), fingerprint: 'fp1', at: 't', maxPerChunk: 4, concurrency: 1 });
    const w3 = mkWorld();
    const r3 = await seedRootsChunked({ ssot: w3, chunks, extract: mkExtract(true), fingerprint: 'fp1', at: 't', maxPerChunk: 4, concurrency: 3 });
    assert.equal(r1.ok, true, '前置：串行那一跑是成的');
    assert.equal(r1.seeded, 1, '前置：三条同标题的根**跨块去重成 1 条**（这就是那条有次序的判据）');
    assert.equal(r3.seeded, r1.seeded, '★★并发下的落账数与串行相同（跨块去重仍在收口按块序做）');
    assert.deepEqual(r3.ids, r1.ids, '★落账的 id 也相同（哪一块的根被留下，取决于块序，不取决于谁先回来）');
    // ★★★这一条才是"次序"本身：留下的是**第一块**那条根（"先见到的那块算数"）。
    //   若去重挪进并发里跑（按完成次序），留下的是**最先回来**那块 ⇒ 第一块最慢时就是别人。
    assert.equal(w3.events[0]?.seedFrom?.quote, '第1段的原话在这里',
        '★★留下的是**块序第一**那条（不是"最先回来的"那条）——这就是"跨块去重仍有次序"那句断言要咬的层');
    assert.deepEqual(r3.chunks, r1.chunks, '★逐块的留痕（含 `got`）也逐字节相同');
    assert.deepEqual(r3.warnings, r1.warnings, '★警告的次序也相同');
});

// ★★★leg144 **补**（用户真机控制台抓出来的**我自己那一处漏**）：**起根这一遍也要那条降级安全带**。
//   现场逐字：`[story-world-v2] 抽取调用失败（输入 31631 字符 · 已花 0.8s） HTTP 429`，
//   栈 = `seed-roots.js:331 ← runLane @ parallel-run.js:78` ⇒ 429 落在**起根**这一遍，
//   而本笔第一版**只给 `extractWorldSetting` 装了降级** ⇒ 网关一限流就**连着几块一起丢**（他丢了 4 块）。
//
//   ★夹具怎么让这条判据**真的能咬**（这是本条的要点，别改成"随便一个失败"）：
//     假抽取**只要发现自己"在飞的过程中身边还有别人"，就回 429**——这正是限流的形状（并发越多越挨打）。
//     · **有安全带**：第一波 3 块全 429 ⇒ 当场退回 1 路 ⇒ **后面那些块一个人跑 ⇒ 成**；
//     · **没安全带**：3 路一直并发 ⇒ 每一块"身边都有别人" ⇒ **全丢**。
//     ⇒ 断言"后面真有块跑成了"，就是断言那条安全带真的在。
//   ★★**第一版这条判据是假绿（如实留档）**：我原来只在**调用入口**看"身边有没有人"——
//     而 lane 不是同时起步的（A 取 0、B 取 1、C 取 2 是三个连续的微任务）⇒ **入口那一眼总有一个人看到 live==1**
//     ⇒ 没装安全带也照样有块能成 ⇒ 判据全绿。**定稿：入口与出口各看一眼**（一个调用只要在**它的生命周期里**
//     见过并发，就算挨了限流）。改完先证红：把 `degraded = true` 拿掉 ⇒ 当场红（成功 0 块）。
test('★★★leg144·安全带（起根）：网关一限流（429）⇒ 剩下的退回串行，**后面的块还能成**', async () => {
    const mkWorld = () => ({ meta: { tick: 0 }, entities: [{ id: 'e1', name: '青丘' }], events: [] });
    const chunks = Array.from({ length: 6 }, (_, i) => `【块${i + 1}】` + '甲'.repeat(40) + `第${i + 1}段的原话在这里`);
    let live = 0;
    const extract = async (prompt) => {
        live += 1;
        const entered = live;        // ★入口那一眼
        await sleep(20);
        const left = live;           // ★出口那一眼
        live -= 1;
        if (entered > 1 || left > 1) throw new Error('HTTP 429');   // 生命周期里见过并发 ⇒ 网关推回
        const n = /【块(\d+)】/.exec(prompt)?.[1] ?? '1';
        return { roots: [{ title: `第${n}件事`, parties: ['青丘'], quote: `第${n}段的原话在这里` }] };
    };
    const r = await seedRootsChunked({
        ssot: mkWorld(), chunks, extract, fingerprint: 'fp429', at: 't', maxPerChunk: 4, concurrency: 3,
    });
    const okCount = r.chunks.filter((c) => c.ok).length;
    const failCount = r.chunks.filter((c) => !c.ok).length;
    assert.ok(failCount >= 1, `前置：第一波确实挨了 429（实际失败 ${failCount} 块）`);
    assert.ok(okCount >= 1,
        `★★★降级之后**后面的块真的跑成了**（成功 ${okCount} / 失败 ${failCount}）——`
        + '没有那条安全带时这里会是 0（3 路一直并发 ⇒ 每一块"身边都有别人" ⇒ 全丢）');
    assert.ok(r.seeded >= 1, '★落账的根数也 ≥1（不只"调用成了"，而是真的种进去了）');
});
