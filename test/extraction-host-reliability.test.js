import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hotAccountShape } from '../src/storage.js';
import { createActionRouter } from '../web/action-router.js';
import { diagnostics } from '../src/diagnostics.js';
import { seedRootsChunked } from '../src/seed-roots.js';
import { bookCheckResult } from '../web/book-rebaseline.js';
import { EXTRACTION_TIMEOUT_MS } from '../src/transport-http.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
export function world(name = '旧世界') {
    return { version: 1, context: { world: name, positions: [], setting: { frozen: { canon: {}, fingerprint: '' }, dynamic: { env: {} } } },
        meta: { tick: 0, simLog: [] }, entities: [], weights: {}, agendas: [], events: [], chronicle: [], milestones: [] };
}
export function context(chatId, original = world()) {
    const ctx = { chatId, characterId: 0, name1: '玩家', characters: [{ name: '测试卡', description: '测试世界。甲城存在。' }],
        chatMetadata: original ? { story_world_v2: hotAccountShape(original) } : {},
        extensionSettings: { story_world_v2: {} }, worldInfo: [{ uid: 1, comment: '总纲', content: '测试世界。甲城存在。' }],
        saveMetadataDebounced() {}, saveSettingsDebounced() {}, saveMetadata: async () => {}, saveChat: async () => { await new Promise(r => setTimeout(r, 15)); } };
    return ctx;
}
export function fakeIdb({ hold = true, holdTransaction = false } = {}) {
    let held = null, calls = 0, heldTx = null, transactions = 0, pending = 0, activity = 0;
    const complete = tx => { if (tx.finished) return; tx.finished = true; pending--; tx.oncomplete?.(); };
    const opened = req => { if (req.finished) return; req.finished = true; pending--; req.onsuccess?.(); };
    const db = { close() {}, transaction() {
        pending++; activity++;
        const tx = { objectStore: () => ({ getAll: () => ({ result: [] }), get: () => ({ result: null }), put: () => ({ result: null }), delete() {} }) };
        if (holdTransaction && transactions++ === 0) heldTx = tx;
        else setImmediate(() => complete(tx)); return tx;
    } };
    return { open() { pending++; activity++; const req = { result: db }; if (hold && calls++ === 0) held = req; else setImmediate(() => opened(req)); return req; },
        release() { if (held) opened(held); }, get held() { return Boolean(held); },
        releaseTransaction() { if (heldTx) complete(heldTx); }, get heldTransaction() { return Boolean(heldTx); },
        async idle() {
            let quiet = 0, previous = activity;
            for (let rounds = 0; quiet < 5 && rounds < 100; rounds++) {
                await turn(); quiet = pending === 0 && previous === activity ? quiet + 1 : 0; previous = activity;
            }
            assert.equal(pending, 0, 'fake IDB must finish background snapshot work before globals are removed');
        } };
}
export async function host(ctx, tag) {
    let current = ctx;
    const updates = [];
    const install = c => { c.updateChatMetadata = update => { updates.push({ chat: current.chatId, update }); Object.assign(current.chatMetadata, update); }; };
    install(ctx);
    globalThis.window = { SillyTavern: { getContext: () => current }, confirm: () => true };
    globalThis.indexedDB = fakeIdb();
    const mod = await import(`../web/index.js?host-reliability-${tag}`);
    globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
    return { mod, updates, switch(c) { install(c); current = c; }, async cleanup() {
        indexedDB.release(); indexedDB.releaseTransaction(); await indexedDB.idle();
        delete globalThis.window; delete globalThis.indexedDB; delete globalThis.document;
    } };
}

test('production loadWorld held at IDB open never writes A into B', async () => {
    const a = context('a', world('A')), b = context('b', world('B'));
    const h = await host(a, 'switch');
    try {
        const original = structuredClone(a.chatMetadata), bBefore = structuredClone(b.chatMetadata);
        const pending = h.mod.loadWorld(); await turn();
        assert.ok(indexedDB.held);
        assert.deepEqual(a.chatMetadata, original, 'pending load must not mutate referenced metadata');
        h.switch(b); indexedDB.release(); await pending;
        assert.deepEqual(b.chatMetadata, bBefore);
        assert.equal(h.updates.length, 0);
    } finally { await h.cleanup(); }
});

test('production same-chat newer load defeats an older held load', async () => {
    const ctx = context('same', world('old')), h = await host(ctx, 'generation');
    try {
        const old = h.mod.loadWorld(); await turn();
        ctx.chatMetadata.story_world_v2 = hotAccountShape(world('new'));
        await h.mod.loadWorld();
        const before = structuredClone(ctx.chatMetadata); const count = h.updates.length;
        indexedDB.release(); await old;
        assert.deepEqual(ctx.chatMetadata, before);
        assert.equal(h.updates.length, count);
    } finally { await h.cleanup(); }
});

test('production loadWorld held at real IDB transaction completion also guards A to B switch', async () => {
    const a = context('tx-a', world('A')), b = context('tx-b', world('B')), h = await host(a, 'transaction');
    indexedDB = fakeIdb({ hold: false, holdTransaction: true });
    try {
        const original = structuredClone(a.chatMetadata), before = structuredClone(b.chatMetadata);
        const pending = h.mod.loadWorld(); while (!indexedDB.heldTransaction) await turn();
        assert.deepEqual(a.chatMetadata, original);
        h.switch(b); indexedDB.releaseTransaction(); await pending;
        assert.deepEqual(b.chatMetadata, before); assert.equal(h.updates.length, 0);
    } finally { await h.cleanup(); }
});

export function clickBus(bus, action) {
    let pending;
    const el = { attributes: [{ name: 'data-action', value: action }], classList: { contains: () => false },
        closest: s => s === '[data-action]' ? el : null, getAttribute: n => n === 'data-action' ? action : null };
    const router = createActionRouter({ win: { addEventListener() {} }, dispatch: a => { pending = bus[a]?.(); }, toggleInject() {} });
    router.handleClick({ target: el }); return pending;
}

const response = value => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(value) } }] }) });
function configure(ctx, fetchImpl) {
    ctx.extensionSettings.story_world_v2 = { baseUrl: 'https://fake.invalid', apiKey: 'fake', model: 'fake-host', extractChunkChars: 30000, extractConcurrency: 2, fetchImpl };
}

test('production init timeout uses extraction guidance in status and terminal diagnostics', async t => {
    const ctx = context('timeout-guidance'); let calls = 0, pending;
    configure(ctx, (_, options) => { calls++; return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))); });
    const h = await host(ctx, 'timeout-guidance'); indexedDB = fakeIdb({ hold: false });
    try {
        diagnostics.clear(); const before = structuredClone(ctx.chatMetadata);
        t.mock.timers.enable({ apis: ['setTimeout'] });
        pending = clickBus(window.__sw2Actions, 'init-world'); while (!calls) await turn();
        t.mock.timers.tick(EXTRACTION_TIMEOUT_MS); await pending;
        const status = diagnostics.snapshot({ module: '状态' }).find(row => row.message.startsWith('注意：抽取失败'));
        assert.ok(status); assert.doesNotMatch(status.message, /单轮超时|提高抽取超时/);
        assert.match(status.message, /调试台/); assert.match(status.message, /模型服务状态|更快.*模型|模型.*更快/);
        const terminal = diagnostics.snapshot({ module: '抽取任务' }).find(row => row.message === '抽取失败');
        assert.ok(terminal); assert.deepEqual(terminal.data.failure, { type: 'timeout', timeoutMs: EXTRACTION_TIMEOUT_MS });
        assert.doesNotMatch(terminal.data.errors.join('; '), /单轮超时|提高抽取超时/);
        assert.equal(calls, 1); assert.deepEqual(ctx.chatMetadata, before);
    } finally { clickBus(window.__sw2Actions, 'cancel-extraction'); t.mock.timers.reset(); await pending; await h.cleanup(); }
});

for (const [action, phase] of [['init-world', 'after'], ['init-world', 'during'], ['init-world', 'cancel'], ['reextract-setting', 'after']]) {
    test(`old production load cannot overwrite extraction save (${action}, ${phase})`, async () => {
        const ctx = context(`load-save-${action}-${phase}`, world('原世界')); let releaseSave, pending;
        const original = structuredClone(ctx.chatMetadata);
        configure(ctx, async () => response({ society: '新城邦', bookEntities: [], roots: [] }));
        ctx.saveChat = async () => { if (phase !== 'after' && !releaseSave) await new Promise(r => { releaseSave = r; }); await new Promise(r => setTimeout(r, 15)); };
        const h = await host(ctx, `load-save-${action}-${phase}`);
        try {
            const old = h.mod.loadWorld(); while (!indexedDB.held) await turn();
            pending = clickBus(window.__sw2Actions, action);
            if (phase === 'after') await pending;
            else while (!releaseSave) await turn();
            const candidate = structuredClone(ctx.chatMetadata), updates = h.updates.length;
            assert.equal(candidate.story_world_v2.world.context.setting.frozen.canon.society, '新城邦');
            indexedDB.release();
            assert.equal((await old)?.cancelled, true, 'extraction save must invalidate the captured old load generation');
            assert.deepEqual(ctx.chatMetadata, candidate); assert.equal(h.updates.length, updates, 'old load must not write after the extraction save boundary');
            if (phase === 'cancel') clickBus(window.__sw2Actions, 'cancel-extraction');
            releaseSave?.(); await pending;
            if (phase === 'cancel') assert.deepEqual(ctx.chatMetadata.story_world_v2, original.story_world_v2);
            else assert.deepEqual(ctx.chatMetadata, candidate);
        } finally { indexedDB.release(); releaseSave?.(); await pending; await h.cleanup(); }
    });
}

for (const cancel of [false, true]) {
    test(`init publishes the current book check only after successful save (${cancel ? 'cancelled save' : 'commit'})`, async () => {
        const oldWorld = world(); oldWorld.context.setting.frozen.fingerprint = 'old-book-fingerprint';
        const ctx = context(`book-save-${cancel}`, oldWorld); let releaseSave, pending, calls = 0;
        configure(ctx, async () => { calls++; return response({ society: '城邦', bookEntities: [], roots: [] }); });
        const h = await host(ctx, `book-save-${cancel}`); indexedDB = fakeIdb({ hold: false });
        try {
            await h.mod.loadWorld(); const prior = bookCheckResult(), before = structuredClone(ctx.chatMetadata);
            assert.equal(prior?.changed, true);
            let saves = 0;
            ctx.saveChat = async () => { if (++saves === 1) await new Promise(r => { releaseSave = r; }); await new Promise(r => setTimeout(r, 15)); };
            pending = clickBus(window.__sw2Actions, 'init-world'); while (!releaseSave) await turn();
            assert.equal(bookCheckResult(), prior, 'read-only candidate check must not change the current hub during save');
            if (cancel) clickBus(window.__sw2Actions, 'cancel-extraction');
            releaseSave(); await pending;
            if (cancel) {
                assert.equal(bookCheckResult(), prior); assert.deepEqual(ctx.chatMetadata.story_world_v2, before.story_world_v2);
            } else {
                const current = bookCheckResult(); assert.notEqual(current, prior); assert.equal(current?.changed, false);
                assert.equal(current.stored, ctx.chatMetadata.story_world_v2.world.context.setting.frozen.fingerprint);
                assert.equal(current.fresh, current.stored);
            }
            assert.equal(calls, 2, 'world-book checking must not add model calls');
        } finally { releaseSave?.(); await pending; await h.cleanup(); }
    });
}

for (const switchChat of [false, true]) {
    test(`candidate book read can be cancelled without publishing late state (${switchChat ? 'chat switch' : 'cancel and retry'})`, async () => {
        const oldWorld = world(); oldWorld.context.setting.frozen.fingerprint = 'old-book-fingerprint';
        const ctx = context(`book-read-${switchChat}`, oldWorld); let holdCheck = false, releaseRead, pending, settled = false, calls = 0;
        delete ctx.worldInfo; ctx.characters[0].data = { extensions: { world: 'fake-book' } };
        const entries = [{ uid: 1, comment: '总纲', content: '测试世界。甲城存在。' }];
        ctx.loadWorldInfo = async () => holdCheck ? new Promise(r => { releaseRead = r; }) : { entries };
        configure(ctx, async () => { if (++calls === 2) holdCheck = true; return response({ society: '城邦', bookEntities: [], roots: [] }); });
        const h = await host(ctx, `book-read-${switchChat}`); indexedDB = fakeIdb({ hold: false });
        try {
            await h.mod.loadWorld(); const prior = bookCheckResult(), before = structuredClone(ctx.chatMetadata);
            assert.equal(prior?.changed, true);
            pending = clickBus(window.__sw2Actions, 'init-world').then(() => { settled = true; });
            for (let i = 0; !releaseRead && !settled && i < 100; i++) await new Promise(r => setTimeout(r, 5));
            assert.ok(releaseRead, 'init must await a read-only production book check before saving its candidate');
            assert.equal(bookCheckResult(), prior); assert.deepEqual(ctx.chatMetadata, before);
            if (switchChat) {
                const b = context('book-read-new-chat', world('B')); h.switch(b); await h.mod.loadWorld(); await pending;
                const current = bookCheckResult(), saved = structuredClone(b.chatMetadata), count = h.updates.length;
                releaseRead({ entries }); await turn(); await turn();
                assert.equal(bookCheckResult(), current); assert.deepEqual(b.chatMetadata, saved); assert.equal(h.updates.length, count);
            } else {
                clickBus(window.__sw2Actions, 'cancel-extraction'); await pending;
                assert.equal(bookCheckResult(), prior); assert.deepEqual(ctx.chatMetadata, before);
                holdCheck = false; await clickBus(window.__sw2Actions, 'init-world');
                const current = bookCheckResult(), saved = structuredClone(ctx.chatMetadata);
                assert.equal(current?.changed, false); assert.equal(calls, 4, 'cancelled preparation must discard staged cache for immediate retry');
                releaseRead({ entries }); await turn(); await turn();
                assert.equal(bookCheckResult(), current); assert.deepEqual(ctx.chatMetadata, saved);
            }
        } finally { releaseRead?.({ entries }); await pending; await h.cleanup(); }
    });
}

test('failed candidate save preserves prior book check and same-source retry publishes the new check', async () => {
    const oldWorld = world(); oldWorld.context.setting.frozen.fingerprint = 'old-book-fingerprint';
    const ctx = context('book-save-failure', oldWorld); let calls = 0;
    configure(ctx, async () => { calls++; return response({ society: '城邦', bookEntities: [], roots: [] }); });
    const h = await host(ctx, 'book-save-failure'); indexedDB = fakeIdb({ hold: false });
    try {
        await h.mod.loadWorld(); const prior = bookCheckResult(), before = structuredClone(ctx.chatMetadata);
        assert.equal(prior?.changed, true);
        const save = ctx.saveChat; ctx.saveChat = async () => { throw new Error('fake candidate save failed'); };
        await clickBus(window.__sw2Actions, 'init-world');
        assert.equal(bookCheckResult(), prior); assert.deepEqual(ctx.chatMetadata.story_world_v2, before.story_world_v2);
        ctx.saveChat = save; await clickBus(window.__sw2Actions, 'init-world');
        assert.equal(bookCheckResult()?.changed, false); assert.equal(calls, 4, 'failed save must not commit staged extraction cache');
    } finally { await h.cleanup(); }
});

for (const cancel of [false, true]) {
    test(`real init inherits source locations before final save (${cancel ? 'cancel and rollback' : 'successful commit'})`, async () => {
        const original = world('原世界'), ctx = context(`location-${cancel}`, original);
        const before = structuredClone(ctx.chatMetadata); let calls = 0, releaseSave, pending, disk;
        ctx.worldInfo = [{ uid: 1, comment: '甲盟', content: '甲盟是势力。\n驻地: 东域甲城。' }];
        configure(ctx, async () => {
            calls++;
            // The selected source was captured before extraction; later source edits must not replace it.
            ctx.worldInfo = [{ uid: 2, comment: '甲盟', content: '甲盟是势力。\n驻地: 西域乙城。' }];
            return response({ society: '城邦', bookEntities: [{ name: '甲城', kind: 'location' }, { name: '甲盟', kind: 'faction' }], roots: [] });
        });
        let saves = 0;
        ctx.saveChat = async () => {
            const captured = structuredClone(ctx.chatMetadata);
            if (++saves === 1) await new Promise(resolve => { releaseSave = resolve; });
            await new Promise(resolve => setTimeout(resolve, 15)); disk = captured;
        };
        const h = await host(ctx, `location-${cancel}`); indexedDB = fakeIdb({ hold: false });
        try {
            pending = clickBus(window.__sw2Actions, 'init-world'); while (!releaseSave) await turn();
            const candidate = ctx.chatMetadata.story_world_v2.world;
            assert.ok(candidate.context.positions.includes('甲城'));
            assert.equal(candidate.entities.find(e => e.name === '甲盟')?.location, '甲城', 'first saved candidate must inherit the captured book location');
            assert.deepEqual(original, before.story_world_v2.world, 'preparing candidate must not mutate the prior world');
            if (cancel) clickBus(window.__sw2Actions, 'cancel-extraction');
            releaseSave(); await pending;
            if (cancel) {
                assert.deepEqual(ctx.chatMetadata.story_world_v2, before.story_world_v2);
                assert.deepEqual(disk.story_world_v2, before.story_world_v2);
            } else {
                assert.equal(disk.story_world_v2.world.entities.find(e => e.name === '甲盟')?.location, '甲城');
                assert.equal(saves, 1, 'location inheritance must be included in the final save without a post-commit load');
            }
            assert.equal(calls, 2, 'location inheritance must not send an extra model request');
        } finally { releaseSave?.(); await pending; await h.cleanup(); }
    });
}

test('real bus cancel held HTTP, reject parallel abstraction, then immediately retry with fresh controller', async () => {
    const ctx = context('cancel'); let release, calls = 0;
    configure(ctx, async () => { calls++; if (calls === 1) return new Promise(r => { release = r; }); return response({ society: '城邦', bookEntities: [] }); });
    const h = await host(ctx, 'cancel-retry'); indexedDB = fakeIdb({ hold: false });
    try {
        diagnostics.clear(); const before = structuredClone(ctx.chatMetadata);
        const pending = clickBus(window.__sw2Actions, 'reextract-setting');
        while (!release) await turn();
        await clickBus(window.__sw2Actions, 'extract-scales');
        assert.equal(calls, 1, 'three abstraction entries share one busy latch');
        assert.equal(typeof window.__sw2Actions['cancel-extraction'], 'function');
        clickBus(window.__sw2Actions, 'cancel-extraction'); await pending;
        assert.deepEqual(ctx.chatMetadata, before);
        await clickBus(window.__sw2Actions, 'reextract-setting');
        assert.equal(calls, 2); assert.equal(ctx.chatMetadata.story_world_v2.world.context.setting.frozen.canon.society, '城邦');
        const committed = structuredClone(ctx.chatMetadata);
        release(response({ society: '迟到旧结果', bookEntities: [] })); await turn();
        assert.deepEqual(ctx.chatMetadata, committed);
        const terminals = diagnostics.snapshot({ module: '抽取任务' }).filter(r => /抽取已中止|抽取完成/.test(r.message));
        assert.equal(terminals.length, 2);
    } finally { release?.(response({})); await h.cleanup(); }
});

test('real init bus cancels root stage without committing main cache, then same-source retry runs main again', async () => {
    const ctx = context('roots'); let release, calls = 0;
    configure(ctx, async () => { calls++; if (calls === 2) return new Promise(r => { release = r; }); return response({ society: '城邦', bookEntities: [], roots: [] }); });
    const h = await host(ctx, 'root-cache'); indexedDB = fakeIdb({ hold: false });
    try {
        const before = structuredClone(ctx.chatMetadata);
        const pending = clickBus(window.__sw2Actions, 'init-world'); while (!release) await turn();
        assert.equal(typeof window.__sw2Actions['cancel-extraction'], 'function');
        clickBus(window.__sw2Actions, 'cancel-extraction'); await pending;
        assert.deepEqual(ctx.chatMetadata, before);
        await clickBus(window.__sw2Actions, 'init-world');
        assert.equal(calls, 4, 'cancelled whole init must discard staged main cache');
        release(response({ roots: [] })); await turn();
        assert.equal(ctx.chatMetadata.story_world_v2.world.context.world, '测试卡');
    } finally { release?.(response({})); await h.cleanup(); }
});

test('real init HTTP failure releases latch for same-source retry and records refusal', async () => {
    const ctx = context('failure'); let calls = 0;
    configure(ctx, async () => ++calls === 1 ? { ok: false, status: 401, text: async () => 'fake refusal' } : response({ society: '城邦', bookEntities: [], roots: [] }));
    const h = await host(ctx, 'failure-retry'); indexedDB = fakeIdb({ hold: false });
    try {
        diagnostics.clear(); const before = structuredClone(ctx.chatMetadata);
        await clickBus(window.__sw2Actions, 'init-world'); assert.deepEqual(ctx.chatMetadata, before);
        const failed = diagnostics.snapshot({ module: '抽取任务' }).find(r => r.message === '抽取失败');
        assert.ok(failed); assert.equal(failed.data.failure.status, 401);
        await clickBus(window.__sw2Actions, 'init-world'); assert.equal(calls, 3);
    } finally { await h.cleanup(); }
});

test('root queue stops before attempting another call after abort', async () => {
    const c = new AbortController(); let calls = 0;
    await assert.rejects(seedRootsChunked({ ssot: world(), chunks: ['a', 'b', 'c'], signal: c.signal, concurrency: 1,
        extract: async () => { calls++; c.abort(); return '{"roots":[]}'; } }), e => e.sw2Cancelled === true);
    assert.equal(calls, 1);
});

test('root request refusal stops queued calls while content-only errors retain optional fallback', async () => {
    let calls = 0;
    await assert.rejects(seedRootsChunked({ ssot: world(), chunks: ['a', 'b', 'c'], concurrency: 1,
        extract: async () => { calls++; throw Object.assign(new Error('HTTP 401'), { sw2CallFailure: { type: 'http', status: 401 } }); } }), e => e.sw2Stopped === true);
    assert.equal(calls, 1);
    const content = await seedRootsChunked({ ssot: world(), chunks: ['a', 'b'], concurrency: 1, extract: async () => 'bad JSON' });
    assert.equal(content.ok, false); assert.equal(content.chunks.length, 2);
});

test('real init root HTTP refusal does not save candidate or main cache and can retry', async () => {
    const ctx = context('root-failure'); let calls = 0;
    configure(ctx, async () => ++calls === 2 ? { ok: false, status: 403, text: async () => 'root refused' } : response({ society: '城邦', bookEntities: [], roots: [] }));
    const h = await host(ctx, 'root-failure'); indexedDB = fakeIdb({ hold: false });
    try {
        diagnostics.clear(); const before = structuredClone(ctx.chatMetadata);
        await clickBus(window.__sw2Actions, 'init-world'); assert.deepEqual(ctx.chatMetadata, before);
        const failed = diagnostics.snapshot({ module: '抽取任务' }).find(r => r.message === '抽取失败');
        assert.equal(failed?.data.failure.status, 403);
        await clickBus(window.__sw2Actions, 'init-world'); assert.equal(calls, 4);
    } finally { await h.cleanup(); }
});

for (const existing of [true, false]) {
    test(`real init cancellation during final save awaits rollback before retry (${existing ? 'existing' : 'fresh'} world)`, async () => {
        const ctx = context(`save-${existing}`, existing ? world() : null);
        let calls = 0, saves = 0, releaseSave, releaseRollback, disk;
        configure(ctx, async () => { calls++; return response({ society: '城邦', bookEntities: [], roots: [] }); });
        ctx.saveChat = async () => {
            const captured = structuredClone(ctx.chatMetadata);
            if (++saves === 1) await new Promise(r => { releaseSave = r; });
            else if (saves === 2) await new Promise(r => { releaseRollback = r; });
            await new Promise(r => setTimeout(r, 15)); disk = captured;
        };
        const h = await host(ctx, `save-${existing}`); indexedDB = fakeIdb({ hold: false });
        try {
            const before = structuredClone(ctx.chatMetadata);
            let settled = false;
            const pending = clickBus(window.__sw2Actions, 'init-world').then(() => { settled = true; });
            while (!releaseSave) await turn();
            clickBus(window.__sw2Actions, 'cancel-extraction'); releaseSave();
            while (!releaseRollback) await turn();
            await clickBus(window.__sw2Actions, 'extract-scales');
            assert.equal(calls, 2, 'rollback still owns the shared busy latch'); assert.equal(settled, false);
            releaseRollback(); await pending;
            assert.deepEqual(ctx.chatMetadata.story_world_v2 ?? null, before.story_world_v2 ?? null);
            assert.deepEqual(disk.story_world_v2 ?? null, before.story_world_v2 ?? null);
            await clickBus(window.__sw2Actions, 'init-world'); assert.equal(calls, 4, 'cancelled save discarded staged cache and released both busy latches');
        } finally { releaseSave?.(); releaseRollback?.(); await h.cleanup(); }
    });
}

test('real init cancellation while source load ignores abort releases latch and discards late continuation', async () => {
    const ctx = context('source'); let release, calls = 0;
    configure(ctx, async () => { calls++; return response({ society: '城邦', bookEntities: [], roots: [] }); });
    delete ctx.worldInfo; ctx.characters[0].data = { extensions: { world: 'fake-book' } };
    ctx.loadWorldInfo = () => new Promise(r => { release = r; });
    const h = await host(ctx, 'source-abort'); indexedDB = fakeIdb({ hold: false });
    try {
        const before = structuredClone(ctx.chatMetadata), pending = clickBus(window.__sw2Actions, 'init-world');
        while (!release) await turn();
        clickBus(window.__sw2Actions, 'cancel-extraction'); await pending;
        assert.equal(calls, 0); assert.deepEqual(ctx.chatMetadata, before);
        ctx.worldInfo = [{ uid: 1, comment: '总纲', content: '测试世界。' }];
        await clickBus(window.__sw2Actions, 'init-world'); assert.equal(calls, 2);
        const after = structuredClone(ctx.chatMetadata);
        release({ entries: [{ uid: 7, content: '旧准备结果' }] }); await turn();
        assert.deepEqual(ctx.chatMetadata, after); assert.equal(calls, 2);
    } finally { release?.({ entries: [] }); await h.cleanup(); }
});

test('real init chat switch during held source load releases task and never overwrites B', async () => {
    const a = context('source-a'), b = context('source-b', world('B')); let release, calls = 0;
    configure(a, async () => { calls++; return response({ society: '城邦', bookEntities: [] }); });
    delete a.worldInfo; a.characters[0].data = { extensions: { world: 'fake-book' } };
    a.loadWorldInfo = () => new Promise(r => { release = r; });
    const h = await host(a, 'source-chat'); indexedDB = fakeIdb({ hold: false });
    try {
        const pending = clickBus(window.__sw2Actions, 'init-world'); while (!release) await turn();
        h.switch(b); await h.mod.loadWorld(); await pending;
        const before = structuredClone(b.chatMetadata), count = h.updates.length;
        release({ entries: [{ uid: 1, content: '旧准备结果' }] }); await turn();
        assert.deepEqual(b.chatMetadata, before); assert.equal(h.updates.length, count); assert.equal(calls, 0);
    } finally { release?.({ entries: [] }); await h.cleanup(); }
});

test('successful init caches strict main extraction; cancelled cached-root run preserves that prior cache', async () => {
    const ctx = context('cache-root'); let calls = 0, release;
    configure(ctx, async () => { calls++; if (calls === 3) return new Promise(r => { release = r; }); return response({ society: '城邦', bookEntities: [], roots: [] }); });
    const h = await host(ctx, 'cache-root'); indexedDB = fakeIdb({ hold: false });
    try {
        await clickBus(window.__sw2Actions, 'init-world'); assert.equal(calls, 2);
        const pending = clickBus(window.__sw2Actions, 'init-world'); while (!release) await turn();
        clickBus(window.__sw2Actions, 'cancel-extraction'); await pending;
        diagnostics.clear();
        await clickBus(window.__sw2Actions, 'init-world'); assert.equal(calls, 4, 'each subsequent cached-main init sends only one root request');
        const terminal = diagnostics.snapshot({ module: '抽取任务' }).find(r => r.message === '抽取完成');
        assert.equal(terminal.data.calls, 1); assert.equal(terminal.data.timing.peakConcurrency, 1); assert.ok(terminal.data.timing.ms > 0);
    } finally { release?.(response({ roots: [] })); await turn(); await h.cleanup(); }
});

test('real reextract uses selected chunk size and exposes complete overlong-row warnings in task diagnostics', async () => {
    const ctx = context('chunks'), prompts = [];
    configure(ctx, async (_, options) => {
        prompts.push(JSON.parse(options.body).messages.map(m => m.content).join('\n'));
        await new Promise(r => setTimeout(r, 2)); return response({ society: '城邦', bookEntities: [] });
    });
    ctx.extensionSettings.story_world_v2.extractChunkChars = 5;
    const h = await host(ctx, 'selected-chunks'); indexedDB = fakeIdb({ hold: false });
    try {
        diagnostics.clear(); await clickBus(window.__sw2Actions, 'reextract-setting');
        const terminal = diagnostics.snapshot({ module: '抽取任务' }).find(r => r.message === '抽取完成');
        assert.ok(terminal); assert.equal(terminal.data.chunkChars, 5); assert.equal(terminal.data.concurrency, 2);
        assert.equal(terminal.data.timing.chunkChars, 5); assert.equal(terminal.data.calls, prompts.length);
        assert.ok(prompts.length > 1); assert.ok(prompts.some(p => p.includes('测试世界。甲城存在。')));
        assert.ok(terminal.data.warnings.some(warning => warning.includes('超长原文行')));
    } finally { await h.cleanup(); }
});

test('one init keeps selected chunk size and concurrency through roots when settings change mid-task', async () => {
    const ctx = context('configuration'); let calls = 0;
    configure(ctx, async () => {
        if (++calls === 1) { ctx.extensionSettings.story_world_v2.extractChunkChars = 5; ctx.extensionSettings.story_world_v2.extractConcurrency = 1; }
        return response({ society: '城邦', bookEntities: [], roots: [] });
    });
    const h = await host(ctx, 'captured-configuration'); indexedDB = fakeIdb({ hold: false });
    try {
        diagnostics.clear(); await clickBus(window.__sw2Actions, 'init-world');
        assert.equal(calls, 2, 'root stage must use the same selected 30000-char configuration as main extraction');
        const terminal = diagnostics.snapshot({ module: '抽取任务' }).find(r => r.message === '抽取完成');
        assert.equal(terminal.data.chunkChars, 30000); assert.equal(terminal.data.concurrency, 2);
    } finally { await h.cleanup(); }
});

test('real reextract prepares an independent candidate while final save is pending', async () => {
    const original = world(), ctx = context('clone', original); let release;
    configure(ctx, async () => response({ society: '城邦', bookEntities: [] }));
    ctx.saveChat = async () => { await new Promise(resolve => { release = resolve; }); await new Promise(resolve => setTimeout(resolve, 15)); };
    const h = await host(ctx, 'clone'); indexedDB = fakeIdb({ hold: false });
    let pending;
    try {
        pending = clickBus(window.__sw2Actions, 'reextract-setting'); while (!release) await turn();
        const candidate = ctx.chatMetadata.story_world_v2.world;
        assert.notEqual(candidate.entities, original.entities); assert.notEqual(candidate.meta, original.meta);
        release(); await pending;
    } finally { release?.(); await pending; await h.cleanup(); }
});
