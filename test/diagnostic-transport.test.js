import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWorldSetting } from '../src/abstract.js';
import { createHttpTransport } from '../src/transport-http.js';
import { createCache } from '../src/fp-hash.js';
import { diagnostics } from '../src/diagnostics.js';
import { diagExtract } from '../web/diagnostic-transport.js';

const good = JSON.stringify({ society: 'city', bookEntities: [] });

for (const extraction of [true, false]) {
    test(`timeout diagnostics give effective guidance (${extraction ? 'extraction' : 'ordinary call'})`, async () => {
        diagnostics.clear(); let calls = 0;
        const transport = createHttpTransport({ baseUrl: 'https://fake.invalid', apiKey: 'fake', model: 'fake', ...(extraction ? { extraction: true } : {}), timeoutMs: 5,
            fetchImpl: (_, options) => { calls++; return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))); } });
        const extract = diagExtract({ model: 'fake', transport }, { task: 'timeout-fixture' }); let error;
        try { await extract('fixture'); } catch (e) { error = e; }
        assert.ok(error); assert.equal(error.sw2Timeout, true); assert.equal(error.name, 'Sw2TimeoutError');
        assert.deepEqual(error.sw2CallFailure, { type: 'timeout', timeoutMs: 5 });
        extract.finish({ ok: false, errors: [error.message], callFailure: error.sw2CallFailure });
        const failure = diagnostics.snapshot({ module: '抽取任务' }).find(row => row.message === '抽取失败');
        assert.ok(failure); assert.deepEqual(failure.data.failure, { type: 'timeout', timeoutMs: 5 });
        const text = failure.data.errors.join('; ');
        assert.match(text, /模型超时（5ms）/); assert.equal(calls, 1);
        if (extraction) {
            assert.doesNotMatch(text, /单轮超时|提高抽取超时/);
            assert.match(text, /模型服务状态|更快.*模型|模型.*更快/);
        } else assert.match(text, /可在参数页把「单轮超时」调大/);
    });
}

test('pre-aborted diagnostic invocation cannot decrement another in-flight call', async () => {
    const c = new AbortController(), releases = [];
    const extract = diagExtract({ model: 'fake', transport: () => new Promise(resolve => releases.push(resolve)) }, { signal: c.signal });
    const first = extract('first'), second = extract('second');
    c.abort();
    await assert.rejects(extract('not entered'), error => error.sw2Cancelled === true);
    assert.equal(extract.stats().calls, 2);
    assert.equal(extract.stats().activeConcurrency, 2);
    assert.equal(extract.stats().peakConcurrency, 2);
    releases.forEach(resolve => resolve(good));
    const settled = await Promise.allSettled([first, second]);
    assert.ok(settled.every(result => result.status === 'rejected' && result.reason.sw2Cancelled));
    assert.equal(extract.stats().activeConcurrency, 0);
});

test('core and diagnostic calls match when first concurrent transport synchronously aborts', async () => {
    const controller = new AbortController(), cache = createCache();
    let calls = 0;
    const extract = diagExtract({ model: 'fake', transport: () => {
        calls++;
        controller.abort();
        return new Promise(() => {}); // Sender ignores cancellation; core must still finish.
    } }, { signal: controller.signal, concurrency: 2 });
    const result = await extractWorldSetting({ sourceText: 'aaa\nbbb', chunkChars: 3,
        concurrency: 2, skipRoster: true, cache, signal: controller.signal, extract });
    assert.equal(result.ok, false);
    assert.equal(result.cancelled, true);
    assert.equal(calls, 1);
    assert.equal(extract.stats().calls, calls);
    assert.equal(result.timing.calls, calls);
    assert.equal(result.timing.peakConcurrency, 1);
    assert.equal(cache.size(), 0);
    const next = diagExtract({ model: 'fake', transport: () => good });
    const fresh = await extractWorldSetting({ sourceText: 'aaa', skipRoster: true, cache, extract: next });
    assert.equal(fresh.ok, true);
    assert.equal(next.stats().calls, 1);
    assert.equal(fresh.timing.calls, 1);
});

test('diagnostics report truncation metadata and preserve redaction without logging success', async () => {
    diagnostics.clear();
    const transport = createHttpTransport({ baseUrl: 'https://fake.invalid', apiKey: 'fake', model: 'fake',
        fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'length',
            message: { content: good } }] }) }) });
    const extract = diagExtract({ model: 'apiKey=fixture-secret', transport });
    await assert.rejects(extract('fixture'), err => err.sw2CallFailure.type === 'truncation');
    const rows = diagnostics.snapshot();
    const failure = rows.find(row => row.level === 'error' && /截断/.test(row.message));
    assert.ok(failure, 'human-readable truncation failure is recorded');
    assert.deepEqual(failure.data.failure, { type: 'truncation', finishReason: 'length' });
    assert.equal(failure.data.type, 'Sw2TruncationError');
    assert.ok(!rows.some(row => row.message === '调用完成'));
    assert.ok(!JSON.stringify(rows).includes('fixture-secret'));
    assert.equal(extract.stats().calls, 1);
});
