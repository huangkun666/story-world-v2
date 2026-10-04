// story-world-v2/test/embed-client.test.js
// ★★★leg152：**嵌入通道**（细案 `docs/spec-memory-engine.md` §5 那一层的取数口）。
//
// ★这一族钉三件事（每一件都有血证在别处发生过）：
//   ① **一批几行是通道参数，不是设计常量** ⇒ 出 batch 相关错误就**当场减半重试**（并把真用得上的行数报出去）；
//   ② **顺序不许乱**：向量与文本必须**按位对应**（错位一条，整套检索都在骗人）；
//   ③ **错误要分得开**：超时/限流（可重试）与"这行太长/模型号写错"（重试无用）不是一回事——
//      本仓为"把超时当瞬时错反复重试"付过账（`transport-http.js` 头注：最坏 31 次调用 × 120 秒）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
// ★★★leg172：「手动量容量」那条（E7 ＋ `probeEmbedChannelCapacity`）已按用户令整条撤掉。
import { createEmbedClient, probeEmbedChannel, EMBED_BATCH_FALLBACKS, PROBE_TEXT } from '../src/embed-client.js';

/** 假 fetch：按调用次数给不同结果（零网络）。 */
function fakeFetch(script) {
    const calls = [];
    const fn = async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push({ url, body, headers: init.headers });
        const step = script[Math.min(calls.length - 1, script.length - 1)];
        if (step.throw) throw step.throw;
        return {
            ok: step.status ? step.status < 400 : true,
            status: step.status ?? 200,
            text: async () => String(step.bodyText ?? ''),
            json: async () => ({ data: (body.input || []).slice(0, step.dropVecs ? Math.max(0, body.input.length - step.dropVecs) : undefined).map((_, i) => ({ embedding: step.vecFor ? step.vecFor(i) : [i + 1, 0] })) }),
        };
    };
    fn.calls = calls;
    return fn;
}

test('E1：一次调用拿到**按位对应**的向量；行数与文本数不一致 ⇒ 当场拒绝（不许错位）', async () => {
    const f = fakeFetch([{ vecFor: (i) => [i + 1, 1] }]);
    const c = createEmbedClient({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: f });
    const vs = await c.embed(['甲', '乙', '丙']);
    assert.equal(vs.length, 3);
    assert.deepEqual(vs[0], [1, 1]);
    assert.deepEqual(vs[2], [3, 1]);
    // 服务端少给一条 ⇒ 必须拒绝（错位比缺一条更坏）
    const bad = fakeFetch([{ dropVecs: 1 }]);
    const c2 = createEmbedClient({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: bad });
    const short = await c2.embed(['甲', '乙', '丙']);
    assert.equal(short, null, '★条数对不上 ⇒ null（空着就是空着），不许拿前两条冒充');
});

test('E2：★批量出错 ⇒ **行数减半当场重试**（通道上限是参数，不是常量）', async () => {
    // 第一次（20 行）报 400（这通道装不下这么多行）⇒ 客户端该减半再试，并记住能用的行数
    let sawSizes = [];
    const f = async (url, init) => {
        const body = JSON.parse(init.body);
        sawSizes.push(body.input.length);
        if (body.input.length > 8) return { ok: false, status: 400, text: async () => 'batch size exceed', json: async () => ({}) };
        return { ok: true, status: 200, text: async () => '', json: async () => ({ data: body.input.map((_, i) => ({ embedding: [i, 1] })) }) };
    };
    const c = createEmbedClient({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: f, batchSize: 20 });
    const texts = Array.from({ length: 20 }, (_, i) => `第${i}件`);
    const vs = await c.embed(texts);
    assert.equal(vs.length, 20, '20 条最终都要拿到向量（分两批）');
    assert.ok(sawSizes[0] === 20, `第一次该按 20 发：${sawSizes.join(',')}`);
    assert.ok(sawSizes.includes(5), `★减半的链条要走过 10、5（实到：${sawSizes.join(',')}）——EMBED_BATCH_FALLBACKS=${EMBED_BATCH_FALLBACKS.join('>')}`);
    assert.equal(c.batchSize(), 5, '★学到能用的行数之后要记住它（别每次都白撞一次）');
});

test('E3：★网络错/限流 ⇒ 抛（可重试）；"这行太长"这类 ⇒ 抛但**不带可重试标记**（重试没用）', async () => {
    const netErr = fakeFetch([{ throw: new Error('ECONNRESET') }]);
    const c1 = createEmbedClient({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: netErr });
    await assert.rejects(() => c1.embed(['甲']), /ECONNRESET/);
    const tooLong = fakeFetch([{ status: 400, bodyText: 'input too long' }]);
    const c2 = createEmbedClient({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: tooLong });
    await assert.rejects(() => c2.embed(['甲']), (err) => err.retryable === false, '★内容错不许标成可重试（否则会白重试到天荒地老）');
});

test('E4：空输入 ⇒ 零调用（不许为一个空批发一次请求）', async () => {
    const f = fakeFetch([{}]);
    const c = createEmbedClient({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: f });
    assert.deepEqual(await c.embed([]), []);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(await c.embed(null), []);
    assert.equal(f.calls.length, 0);
});

test('E5：请求体形状（模型号/输入/维度**只在给了才带**）+ 键不从 URL 走', async () => {
    const f = fakeFetch([{}]);
    const c = createEmbedClient({ baseUrl: 'https://x/v1/', apiKey: 'k', model: 'qwen-x', fetchImpl: f, dimensions: 1024, encodingFormat: 'float' });
    await c.embed(['甲']);
    const call = f.calls[0];
    assert.equal(call.url, 'https://x/v1/embeddings', '★地址要拼对（末尾斜杠不许拼成 //）');
    assert.equal(call.body.model, 'qwen-x');
    assert.deepEqual(call.body.input, ['甲']);
    assert.equal(call.body.dimensions, 1024);
    assert.equal(call.body.encoding_format, 'float');
    assert.match(String(call.headers.Authorization), /^Bearer /, '键走头');
    // 不给维度就不带那一格（不同模型支持的范围不一样，别替它决定）
    const f2 = fakeFetch([{}]);
    const c2 = createEmbedClient({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'qwen-x', fetchImpl: f2 });
    await c2.embed(['甲']);
    assert.ok(!('dimensions' in f2.calls[0].body), '★没给维度就不许带那一格');
});

test('E6：★体检一次问清"通不通 · 多少维"；失败**不抛**、给一句人话', async () => {
    const f = async (url, init) => {
        const body = JSON.parse(init.body);
        return { ok: true, status: 200, text: async () => '', json: async () => ({ data: body.input.map(() => ({ embedding: [1, 2, 3, 4] })) }) };
    };
    const ok = await probeEmbedChannel({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: f });
    assert.equal(ok.ok, true);
    assert.equal(ok.dims, 4, '★维度要当场量出来（它决定"用多大的向量"）');
    assert.equal(ok.rowsTried, 1, '★体检只发一行——所以它**学不到"一批几行"**（那是下一个函数的事）');
    assert.ok(ok.ms >= 0);
    // 不通：不抛，给人话 + 可重试标记
    const bad = async () => ({ ok: false, status: 401, text: async () => 'invalid api key', json: async () => ({}) });
    const no = await probeEmbedChannel({ baseUrl: 'https://x/v1', apiKey: '', model: 'm', fetchImpl: bad });
    assert.equal(no.ok, false);
    assert.match(no.error, /401/);
    assert.equal(no.retryable, false, '★401 不是"可重试"（重试一万次也还是错的）');
    // ★探针只发固定那一句，绝不把账上的内容送出去
    assert.match(PROBE_TEXT, /通道/);
});

// ★★★leg172（用户令「**把这个量一批几行的按钮去掉吧，我用过这么多记忆插件没见过要用户来量一批几行的**」）：
//   **E7「手动量容量」整条已删**（连同 `probeEmbedChannelCapacity` 函数、设置页那枚按钮与接线）——
//   它不是"少一个入口"，而是**那个数本来就不该由玩家来量**：E2 咬着的那条**自动减半**在生产路径上
//   已经把"一批能装几行"学到了（撞到批量过大 ⇒ 减半再试 ⇒ 记住 `batchSize()`）。
//   ⇒ 本文件保留 E1–E6（含 E2 那条自动缩批），只删这一条"手动量"的判据。
