import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmbedWiring, makeVectorRecall } from '../web/settings-channels.js';
import { createEmbedRuntime } from '../web/embed-runtime.js';
import { createInjector, INJECT_KEY_LEDGER } from '../web/inject.js';

const row = tick => ({ id: `r${tick}`, tick, text: `历史记录${tick}` });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const turn = () => new Promise(r => setTimeout(r, 0));

test('关闭零请求；开启补齐冷热积压；暂停几十轮后重开补遗漏并保留最近全文窗口', async () => {
    let disk = null, calls = 0, reads = 0;
    const cfg = { embedBaseUrl: 'https://fixture.invalid/v1', embedApiKey: 'fixture', embedModel: 'demo' };
    let world = { meta: { tick: 220 }, chronicle: Array.from({ length: 60 }, (_, i) => row(i + 61)).concat(row(200)) };
    const volumes = [{ rows: Array.from({ length: 60 }, (_, i) => row(i + 1)) }];
    const progress = { textContent: '' };
    const wiring = createEmbedWiring({ getWin: () => ({ querySelector: id => id === '#sw2_embed_progress' ? progress : null }), getSettings: () => cfg, getWorld: () => world, getVolumes: async () => volumes,
        indexStore: { load: async () => { reads++; return disk; }, save: async value => { disk = structuredClone(value); } },
        channelDeps: { fetchImpl: async (_, opts) => {
            calls++; const texts = JSON.parse(opts.body).input;
            return { ok: true, json: async () => ({ data: texts.map((_, index) => ({ index, embedding: [1, 0] })) }) };
        } } });
    await wiring.catchUp(); await wiring.embedRuntime.recallForTick({ ssot: world, queryText: '历史' });
    assert.equal(calls, 0); assert.equal(reads, 0);
    assert.equal(progress.textContent, '关键词检索');
    cfg.embedEnabled = true; await wiring.settingsChanged();
    assert.equal(disk.ids.length, 120); assert.equal(disk.completedThrough, 170);
    assert.match(progress.textContent, /连续完成至 170 轮/);
    assert.ok(!disk.ids.includes('r200'));
    cfg.embedEnabled = false; await wiring.settingsChanged(); const pausedCalls = calls;
    world = { ...world, meta: { tick: 300 }, chronicle: [...world.chronicle, row(181), row(260)] };
    await wiring.catchUp(); assert.equal(calls, pausedCalls);
    cfg.embedEnabled = true; await wiring.settingsChanged();
    assert.ok(disk.ids.includes('r181') && disk.ids.includes('r200'));
    assert.ok(!disk.ids.includes('r260')); assert.equal(disk.completedThrough, 250);
    const previousCalls = calls; cfg.embedBaseUrl = 'https://other-fixture.invalid/v1'; await wiring.settingsChanged();
    assert.ok(calls > previousCalls, '同名模型切换服务后不能复用不同向量空间');
    assert.equal(disk.provider, cfg.embedBaseUrl);
});

test('切聊天和关闭时，在途嵌入不写回旧结果；新聊天第一轮可正常补齐', async () => {
    const gate = deferred(); let scope = 'a', enabled = true, saves = [];
    const runtime = createEmbedRuntime({ getScope: () => scope, client: () => enabled ? { embed: async texts => { await gate.promise; return texts.map(() => [1, 0]); } } : null,
        signature: { model: 'demo', dims: 2 }, indexStore: { load: async () => null, save: async value => saves.push(value) } });
    const world = { meta: { tick: 100 }, chronicle: [row(1)] };
    const job = runtime.stepForTick({ world }); await turn(); scope = 'b'; enabled = false; gate.resolve();
    assert.equal((await job).skipped, 'cancelled'); assert.equal(saves.length, 0);
    enabled = true; const result = await runtime.stepForTick({ world });
    assert.equal(result.embedded, 1); assert.deepEqual(saves[0].ids, ['r1']);
});

test('恢复快照时，未完成的未来嵌入不能再次污染磁盘', async () => {
    const gate = deferred(); let disk = null;
    const runtime = createEmbedRuntime({ client: { embed: async texts => { await gate.promise; return texts.map(() => [1, 0]); } },
        signature: { model: 'demo', dims: 2 }, indexStore: { load: async () => disk, save: async value => { disk = structuredClone(value); } } });
    const job = runtime.stepForTick({ world: { meta: { tick: 150 }, chronicle: [row(90)] }, floor: 100 });
    await turn(); await runtime.restoreHistory({ meta: { tick: 20 }, chronicle: [row(1)] }); gate.resolve();
    assert.equal((await job).skipped, 'cancelled'); assert.deepEqual(disk.ids, []); assert.equal(disk.historyScope.restoredAt, 20);
});

test('同时召回和补齐只读一次，迟到的旧读取不能回退进度或重复付费', async () => {
    const gate = deferred(); let reads = 0, embeds = 0, disk = null;
    const runtime = createEmbedRuntime({ client: { embed: async texts => { embeds += texts.length; return texts.map(() => [1, 0]); } },
        signature: { model: 'demo', dims: 2 }, indexStore: { load: async () => { reads++; await gate.promise; return null; }, save: async value => { disk = structuredClone(value); } } });
    const world = { meta: { tick: 100 }, chronicle: [row(1)] };
    const jobs = [runtime.stepForTick({ world }), runtime.recallForTick({ ssot: world, queryText: '历史' })];
    await turn(); assert.equal(reads, 1); gate.resolve(); await Promise.all(jobs);
    const before = embeds; await runtime.stepForTick({ world });
    assert.equal(embeds, before); assert.equal(disk.completedThrough, 50);
});

test('生产召回结果对象真正进入聊天注入；关闭和迟到结果恢复完整关键词额度', async () => {
    let enabled = true, resolveRecall, output = '';
    const world = { meta: { tick: 100 }, entities: [{ id: 'e', name: '黄坤', kind: 'character' }], events: [],
        chronicle: Array.from({ length: 40 }, (_, i) => ({ id: `k${i}`, tick: i + 10, text: `黄坤第${i}次巡视城中，询问住民的生活与事务。` })) };
    const ctx = { chat: [{ is_user: false, mes: '黄坤巡视' }], setExtensionPrompt: (key, text) => { if (key === INJECT_KEY_LEDGER) output = text; } };
    const base = { getCtx: () => ctx, getWorld: () => world, isOn: key => key === 'injectLedgerRecall' };
    const keyword = createInjector(base); keyword.apply(); const fullKeywords = output;
    const recall = makeVectorRecall({ getCtx: () => ctx, getWorld: () => world, getRuntime: () => ({ recallForTick: () => new Promise(resolve => { resolveRecall = resolve; }) }), queryTextOf: () => '巡视' });
    const injector = createInjector({ ...base, vectorEnabled: () => enabled, vectorRecall: recall });
    injector.prefetchVectors(); resolveRecall({ items: [{ id: 'old', tick: 1, text: '唯一向量命中' }] }); await turn(); injector.apply();
    assert.ok(output.includes('唯一向量命中'));
    enabled = false; injector.clearVectors(); injector.apply(); assert.equal(output, fullKeywords);
    enabled = true; injector.prefetchVectors(); enabled = false; injector.clearVectors(); resolveRecall({ items: [{ tick: 2, text: '迟到的另一分支' }] });
    await turn(); injector.apply(); assert.equal(output, fullKeywords); assert.ok(!output.includes('迟到的另一分支'));
});
