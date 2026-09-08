// story-world-v2/test/transport-http.test.js
// HTTP 传输单测（注入假 fetch，不联网）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpTransport, createEnvTransport } from '../src/transport-http.js';

test('HTTP 传输：请求形状正确（URL/鉴权/payload）且透传内容', async () => {
    let captured;
    const fakeFetch = async (url, opts) => {
        captured = { url, opts };
        return { ok: true, json: async () => ({ choices: [{ message: { content: '{"a":1}' } }] }) };
    };
    const transport = createHttpTransport({ baseUrl: 'https://api.test/v1', apiKey: 'k-secret', model: 'm-9', fetchImpl: fakeFetch });
    const text = await transport('请你输出 JSON');
    assert.equal(text, '{"a":1}');
    assert.ok(captured.url.endsWith('/chat/completions'));
    assert.equal(captured.opts.headers.Authorization, 'Bearer k-secret');
    const body = JSON.parse(captured.opts.body);
    assert.equal(body.model, 'm-9');
    assert.equal(body.messages[0].content, '请你输出 JSON');
    assert.deepEqual(body.response_format, { type: 'json_object' });
});

test('HTTP 传输：非 2xx 抛错（带状态码与响应体）；无 choices 返回空串', async () => {
    const fail = async () => ({ ok: false, status: 429, text: async () => '{"error":"限流"}', json: async () => ({}) });
    const t1 = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: fail });
    await assert.rejects(() => t1('x'), (err) => err.message === 'HTTP 429' && err.status === 429 && err.bodySnippet.includes('限流'));

    const empty = async () => ({ ok: true, text: async () => '{}', json: async () => ({}) });
    const t2 = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: empty });
    assert.equal(await t2('x'), '');
});

test('HTTP 传输：base 归一化（无 /v1 自动补；有则保留）', async () => {
    const ok = async () => ({ ok: true, text: async () => '', json: async () => ({ choices: [{ message: { content: 'x' } }] }) });
    let url1, url2;
    await createHttpTransport({ baseUrl: 'https://gw.example', apiKey: 'k', model: 'm', fetchImpl: async (u) => { url1 = u; return ok(); } })('p');
    await createHttpTransport({ baseUrl: 'https://gw.example/v1', apiKey: 'k', model: 'm', fetchImpl: async (u) => { url2 = u; return ok(); } })('p');
    assert.ok(url1.endsWith('/v1/chat/completions'), url1);
    assert.ok(url2.endsWith('/v1/chat/completions'), url2);
});

test('K36/A-5 超时防线：超时（AbortController）→ 竞态中止并抛错；正常路径零误伤', async () => {
    // 永不 resolve 的假 fetch：只有信号中止才能让它结束
    const hang = (url, opts) => new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => reject(opts.signal.reason || new Error('aborted')));
    });
    const t = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: hang, timeoutMs: 30 });
    await assert.rejects(() => t('x'), /超时/);

    // 正常路径：未超时完整返回
    const ok = async () => ({ ok: true, text: async () => '', json: async () => ({ choices: [{ message: { content: '{"a":1}' } }] }) });
    const t2 = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: ok, timeoutMs: 1000 });
    assert.equal(await t2('x'), '{"a":1}');
});

test('K36/A-5 max_tokens 上限：默认带提案值 4096；显式传参可覆盖/关闭', async () => {
    let bodies = [];
    const capture = async (url, opts) => { bodies.push(JSON.parse(opts.body)); return { ok: true, text: async () => '', json: async () => ({ choices: [{ message: { content: 'x' } }] }) }; };
    const t1 = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: capture });
    await t1('p');
    assert.equal(bodies[0].max_tokens, 4096); // 提案默认
    const t2 = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: capture, maxTokens: 2048 });
    await t2('p');
    assert.equal(bodies[1].max_tokens, 2048);
    const t3 = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: capture, maxTokens: 0 });
    await t3('p');
    assert.equal(bodies[2].max_tokens, undefined); // 0=不写
});

test('HTTP 传输：env 齐备时可用，缺配置返回 null', () => {
    const full = createEnvTransport({ ST_OPENAI_BASE: 'https://x/v1', ST_OPENAI_KEY: 'k', ST_WORLD_MODEL: 'm' });
    assert.equal(typeof full, 'function');
    assert.equal(createEnvTransport({}), null);
});