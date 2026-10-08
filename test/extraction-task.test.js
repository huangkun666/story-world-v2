import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExtractionTaskHub } from '../web/extraction-task.js';
import { extractionProgressHandler } from '../web/extraction-progress.js';
import { extractWorldSetting } from '../src/abstract.js';
import { createCache } from '../src/fp-hash.js';
import { diagnostics } from '../src/diagnostics.js';

test('task staged cache preserves strict source, size and extraction timestamp metadata for actual reuse', async () => {
    const cache = createCache(); let world = null, calls = 0, first;
    const hub = createExtractionTaskHub({ cache, getScope: () => 'a', getWorld: () => world, setStatus() {} });
    const options = { sourceText: '原文', chunkChars: 5, allowedSources: [{ sourceId: 'one', text: '原文' }], evidencePolicy: 'strict',
        extract: async () => { calls++; return '{"society":"城邦"}'; }, extractedAt: 'preserved-time' };
    await hub.run('init-world', '初始化', async task => {
        first = await extractWorldSetting({ ...options, cache: task.cache });
        assert.equal(cache.size(), 0, 'main success alone must not publish staged cache');
        task.result = first; await task.commit({ meta: {} }, async candidate => { world = candidate; });
    });
    const next = await extractWorldSetting({ ...options, cache });
    assert.equal(next.cached, true); assert.equal(calls, 1);
    assert.equal(next.setting.frozen.extractedAt, 'preserved-time');
    assert.equal(next.settingReport.cached, true);
});

test('cancellation button disabled and aria-disabled agree during task, rerender, cancellation and retry', async () => {
    const button = () => ({ disabled: true, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
    let b = button(), release;
    const hub = createExtractionTaskHub({ getScope: () => 'a', getWorld: () => null, setStatus() {}, getRoot: () => ({ querySelectorAll: () => [b] }) });
    const pending = hub.run('init-world', '初始化', task => task.wait(new Promise(r => { release = r; })));
    assert.equal(b.disabled, false); assert.equal(b.attrs['aria-disabled'], 'false');
    b = button(); hub.syncButtons(); assert.equal(b.attrs['aria-disabled'], 'false');
    hub.cancel(); await pending;
    assert.equal(b.disabled, true); assert.equal(b.attrs['aria-disabled'], 'true');
    await hub.run('init-world', '初始化', async () => { assert.equal(b.disabled, false); });
    assert.equal(b.disabled, true); release();
});

test('task throw clears timer and busy latch and finish includes error and overlong warning', async () => {
    let timerCount = 0;
    const hub = createExtractionTaskHub({ getScope: () => 'a', getWorld: () => null, setStatus() {} });
    diagnostics.clear();
    await hub.run('init-world', '初始化', async task => {
        task.extract({ model: 'fake', transport: async () => '' }, { text: 'source' }, { chunkChars: 2, concurrency: 1 });
        task.result = { errors: ['超长原文行（完整保留）'] };
        task.progress = extractionProgressHandler([], { setTimer: () => { timerCount++; return 1; }, clearTimer: () => { timerCount--; } });
        task.progress.onEvent({ phase: 'start', step: 'canon', chars: 6 });
        throw new Error('fake build failure');
    });
    assert.equal(timerCount, 0); assert.equal(hub.busy(), false);
    const row = diagnostics.snapshot({ module: '抽取任务' }).find(r => r.message === '抽取失败');
    assert.ok(row.data.errors.includes('fake build failure')); assert.ok(row.data.warnings[0].includes('超长原文行'));
    let retried = false; await hub.run('init-world', '初始化', async () => { retried = true; }); assert.equal(retried, true);
});

test('successful commit closes cancellation before post-commit UI work', async () => {
    let world = null, observedDisabled, observedAborted;
    const button = { disabled: true, setAttribute() {} }, lines = [];
    const hub = createExtractionTaskHub({ getScope: () => 'a', getWorld: () => world, setStatus: text => lines.push(text), getRoot: () => ({ querySelectorAll: () => [button] }) });
    await hub.run('init-world', '初始化', async task => {
        await task.commit({ meta: {} }, async candidate => { world = candidate; });
        observedDisabled = button.disabled;
        hub.cancel(); observedAborted = task.signal.aborted;
    });
    assert.equal(observedDisabled, true, 'acknowledged commit closes the cancel window');
    assert.equal(observedAborted, false);
    assert.ok(!lines.some(line => line.includes('世界与抽取缓存未动')));
});

test('configured task preparation throw emits terminal finish with useful error and model settings', async () => {
    diagnostics.clear();
    const hub = createExtractionTaskHub({ getScope: () => 'a', getWorld: () => null, setStatus() {} });
    await hub.run('init-world', '初始化', async task => {
        task.configure({ model: 'fake-preparation', transport: async () => '' }, { chunkChars: 123, concurrency: 3 });
        throw new Error('source preparation failed');
    });
    const terminal = diagnostics.snapshot({ module: '抽取任务' }).find(row => row.message === '抽取失败');
    assert.ok(terminal); assert.equal(terminal.data.model, 'fake-preparation');
    assert.equal(terminal.data.chunkChars, 123); assert.equal(terminal.data.sourceChars, null);
    assert.ok(terminal.data.errors.includes('source preparation failed'));
});

test('cancelled final save reports rollback failure instead of promising unchanged persisted world', async () => {
    const lines = [], hub = createExtractionTaskHub({ getScope: () => 'a', getWorld: () => null, setStatus: text => lines.push(text) });
    await hub.run('init-world', '初始化', async task => {
        await task.commit({ meta: {} }, async () => { hub.cancel(); throw new Error('原账回存未确认：fake disk failure'); });
    });
    assert.ok(lines.some(line => line.includes('回存未确认')));
    assert.ok(!lines.some(line => line.includes('世界与抽取缓存未动')));
    assert.equal(hub.busy(), false);
});

test('post-commit render throw reports already saved world and finishes successfully with refresh warning', async () => {
    let world = null; const lines = [];
    diagnostics.clear();
    const hub = createExtractionTaskHub({ getScope: () => 'a', getWorld: () => world, setStatus: text => lines.push(text) });
    await hub.run('init-world', '初始化', async task => {
        task.extract({ model: 'fake-render', transport: async () => '' }, { text: 'source' }, { chunkChars: 3, concurrency: 1 });
        await task.commit({ meta: {} }, async candidate => { world = candidate; });
        throw new Error('fake render failure');
    });
    assert.ok(lines.some(line => line.includes('世界已保存') && line.includes('fake render failure')));
    assert.ok(!lines.some(line => line.includes('世界未动')));
    const terminal = diagnostics.snapshot({ module: '抽取任务' }).find(row => row.message === '抽取完成');
    assert.ok(terminal?.data.warnings.some(warning => warning.includes('界面刷新失败')));
});
