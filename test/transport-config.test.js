// story-world-v2/test/transport-config.test.js
// K30：设置→传输配置解析（浏览器适配套）。不联网：注入假 fetch。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBrowserTransport } from '../src/transport-config.js';
import { createEnvTransport } from '../src/transport-http.js';

test('K30 设置链：设置齐备 → 传输可用（source=settings，base 归一化 +v1）', async () => {
    let captured;
    const r = resolveBrowserTransport({
        baseUrl: 'https://gw.example',
        apiKey: 'k-settings',
        model: 'm-9',
        fetchImpl: async (url, opts) => {
            captured = { url, opts };
            return { ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":1}' } }] }) };
        },
    });
    assert.equal(r.source, 'settings');
    assert.equal(r.baseUrl, 'https://gw.example');
    assert.equal(r.model, 'm-9');
    const text = await r.transport('请输出 JSON');
    assert.equal(text, '{"ok":1}');
    assert.ok(captured.url.endsWith('/v1/chat/completions'), captured.url);
    assert.equal(captured.opts.headers.Authorization, 'Bearer k-settings');
});

test('K30 设置链：缺任一字段 → null（不建传输、不抛）', () => {
    assert.equal(resolveBrowserTransport({}), null);
    assert.equal(resolveBrowserTransport({ baseUrl: 'https://x', apiKey: 'k' }), null);
    assert.equal(resolveBrowserTransport({ baseUrl: 'https://x', model: 'm' }), null);
    assert.equal(resolveBrowserTransport({ apiKey: 'k', model: 'm' }), null);
    assert.equal(resolveBrowserTransport(null), null);
    assert.equal(resolveBrowserTransport(undefined), null);
});

test('K30 浏览器安全守卫：createEnvTransport 无参调用不抛（浏览器无 process）', () => {
    assert.doesNotThrow(() => createEnvTransport());
    assert.equal(createEnvTransport({}), null);
});