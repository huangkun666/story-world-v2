import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readEmbedConfig, embedEnabled } from '../src/embed-client.js';
import { createEmbedChannelHub } from '../web/embed-channel.js';

const configured = { embedBaseUrl: 'https://test.invalid/v1', embedApiKey: 'fixture', embedModel: 'demo' };
test('填齐配置不自动启用；只有明确开启才启用', () => {
    assert.equal(embedEnabled(readEmbedConfig(configured)), false);
    assert.equal(embedEnabled(readEmbedConfig({ ...configured, embedEnabled: true })), true);
    assert.equal(embedEnabled(readEmbedConfig({ ...configured, embedEnabled: false })), false);
});
test('关闭时自动补嵌和召回都不调用服务，显式测试连接仍可用', async () => {
    let requests = 0, probes = 0;
    const hub = createEmbedChannelHub({ getSettings: () => configured,
        stepEmbedFor: () => { requests++; }, recallFor: () => { requests++; },
        probeChannel: async () => { probes++; return { ok: true, dims: 2 }; } });
    await hub.stepForTick({ world: {} }); await hub.recallForTick({});
    assert.equal(requests, 0);
    assert.equal((await hub.probe()).ok, true); assert.equal(probes, 1);
});
