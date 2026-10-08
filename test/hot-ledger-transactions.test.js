import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHotLedgerHub } from '../web/hot-ledger.js';

function makeCtx(chatId) {
    return { chatId, chatMetadata: {}, updateChatMetadata(update) { Object.assign(this.chatMetadata, update); },
        saveMetadataDebounced() {}, saveChat: async () => { await new Promise(r => setTimeout(r, 15)); } };
}

test('host flush cannot reassert a previous chat world into a switched chat', async () => {
    const a = makeCtx('a'), b = makeCtx('b');
    let ctx = a, release;
    const pending = new Promise(resolve => { release = resolve; });
    a.saveChat = async () => { await pending; await new Promise(r => setTimeout(r, 15)); };
    const hub = createHotLedgerHub({ freshCtx: () => ctx, hotMetaKey: 'hot', getSnapHub: () => ({ requestSnapshot() {} }) });
    hub.resetHotLedgerState();
    hub.writeHotMeta({ savedAt: 'a', world: { meta: { tick: 1 } } });
    const flush = hub.flushHotMeta();
    ctx = b; release();
    const result = await flush;
    assert.equal(result.ok, false);
    assert.equal(b.chatMetadata.hot, undefined);
});

test('a queued flush from the old chat cannot save or reassert into the new chat', async () => {
    const previous = globalThis.window; globalThis.window = { __TAURITAVERN__: true };
    try {
        const a = makeCtx('a'), b = makeCtx('b'); let ctx = a, release, newChatSaves = 0;
        const pending = new Promise(resolve => { release = resolve; });
        a.saveMetadata = async () => pending;
        b.saveMetadata = async () => { newChatSaves++; };
        const hub = createHotLedgerHub({ freshCtx: () => ctx, hotMetaKey: 'hot', getSnapHub: () => ({ requestSnapshot() {} }) });
        hub.resetHotLedgerState();
        hub.writeHotMeta({ savedAt: 'a', world: { meta: { tick: 1 } } });
        const run = hub.flushHotMeta();
        assert.equal((await hub.flushHotMeta()).queued, true);
        ctx = b; release(); await run;
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(b.chatMetadata.hot, undefined);
        assert.equal(newChatSaves, 0);
    } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test('failed transactional save restores original in-memory hot metadata and schedules no snapshot', async () => {
    const ctx = makeCtx('st');
    const original = { savedAt: 'original', world: { meta: { tick: 2 }, events: [{ id: 'original' }] }, nextVolume: 7 };
    ctx.chatMetadata.hot = original;
    let snapshots = 0;
    const hub = createHotLedgerHub({ freshCtx: () => ctx, hotMetaKey: 'hot', getSnapHub: () => ({ requestSnapshot() { snapshots++; } }) });
    hub.resetHotLedgerState();
    ctx.saveChat = async () => { throw new Error('official ST simulated transport failure'); };
    const candidate = { savedAt: 'next', world: { meta: { tick: 3, chatConsumption: [{ messageId: 'new' }] }, events: [{ id: 'failed' }] } };
    await assert.rejects(hub.commitHotMeta(candidate), /transport failure/);
    assert.equal(ctx.chatMetadata.hot, original);
    assert.equal(hub.hotMetaUnflushed(), false);
    assert.equal(snapshots, 0);
});

test('official ST adapter saves explicit chat name and commits world plus consumption together', async () => {
    const ctx = makeCtx('official-st-chat');
    const hub = createHotLedgerHub({ freshCtx: () => ctx, hotMetaKey: 'hot', getSnapHub: () => ({ requestSnapshot() {} }) });
    hub.resetHotLedgerState();
    const seen = [];
    ctx.saveChat = async options => { seen.push({ options, hot: structuredClone(ctx.chatMetadata.hot) }); await new Promise(r => setTimeout(r, 15)); };
    const candidate = { savedAt: 'next', world: { meta: { tick: 1, chatConsumption: [{ messageId: 'same-transaction' }] } } };
    assert.equal(await hub.commitHotMeta(candidate), candidate.world);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].options, { chatName: 'official-st-chat' });
    assert.deepEqual(seen[0].hot, candidate);
});

test('official TT adapter uses metadata save for stable host IDs, full message save for new extra IDs', async () => {
    const previous = globalThis.window;
    globalThis.window = { __TAURITAVERN__: true };
    try {
        const ctx = makeCtx('official-tt');
        let metadataCalls = 0, messageCalls = 0;
        ctx.saveMetadata = async () => { metadataCalls++; };
        ctx.saveChat = async () => { messageCalls++; };
        const hub = createHotLedgerHub({ freshCtx: () => ctx, hotMetaKey: 'hot', getSnapHub: () => ({ requestSnapshot() {} }) });
        hub.resetHotLedgerState();
        const shape = tick => ({ savedAt: `s${tick}`, world: { meta: { tick } } });
        await hub.commitHotMeta(shape(1));
        assert.equal(metadataCalls, 1);
        assert.equal(messageCalls, 0);
        await hub.commitHotMeta(shape(2), { saveMessages: true });
        assert.equal(metadataCalls, 1);
        assert.equal(messageCalls, 1);
        ctx.saveMetadata = async () => { metadataCalls++; throw new Error('TT IPC failed'); };
        const before = ctx.chatMetadata.hot;
        await assert.rejects(hub.commitHotMeta(shape(3)), /TT IPC failed/);
        assert.equal(metadataCalls, 2, 'TT loud save errors are not retried');
        assert.equal(ctx.chatMetadata.hot, before);
    } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test('stale pre-step commit checks world and scope before touching metadata', async () => {
    const ctx = makeCtx('chat');
    const original = { savedAt: 'old', world: { meta: { tick: 4 } } };
    ctx.chatMetadata.hot = original;
    const hub = createHotLedgerHub({ freshCtx: () => ctx, hotMetaKey: 'hot', getSnapHub: () => ({ requestSnapshot() {} }) });
    hub.resetHotLedgerState();
    await assert.rejects(hub.commitHotMeta({ world: { meta: { tick: 5 } } }, { guard: { assertCurrent() { throw new Error('stale world'); } } }), /stale world/);
    assert.equal(ctx.chatMetadata.hot, original);
});

test('critical world commit awaits an earlier host flush before publishing its candidate', async () => {
    const ctx = makeCtx('same-chat');
    let release, calls = 0;
    const pending = new Promise(resolve => { release = resolve; });
    ctx.saveChat = async () => { calls++; if (calls === 1) await pending; await new Promise(r => setTimeout(r, 15)); };
    const hub = createHotLedgerHub({ freshCtx: () => ctx, hotMetaKey: 'hot', getSnapHub: () => ({ requestSnapshot() {} }) });
    hub.resetHotLedgerState();
    const before = { savedAt: 'old', world: { meta: { tick: 1 } } }, candidate = { savedAt: 'new', world: { meta: { tick: 2 } } };
    hub.writeHotMeta(before);
    const previous = hub.flushHotMeta();
    const next = hub.commitHotMeta(candidate);
    assert.equal(ctx.chatMetadata.hot, before, 'a queued critical commit must keep the old world in memory until its turn');
    release();
    assert.equal((await previous).ok, true);
    assert.equal(await next, candidate.world);
    assert.equal(ctx.chatMetadata.hot, candidate);
});

test('message version changed during host save rejects consumption and compensates the saved candidate', async () => {
    const ctx = makeCtx('same-chat');
    const before = { savedAt: 'old', world: { meta: { tick: 2 }, events: [] } };
    ctx.chatMetadata.hot = before;
    let release, changed = false, snapshots = 0, persisted = null, calls = 0;
    const pending = new Promise(resolve => { release = resolve; });
    ctx.saveChat = async () => {
        const captured = structuredClone(ctx.chatMetadata.hot);
        if (++calls === 1) await pending;
        await new Promise(resolve => setTimeout(resolve, 15));
        persisted = captured;
    };
    const guard = { assertCurrent() {}, checkScope() {}, validateInput() { if (changed) throw new Error('message version changed'); } };
    const hub = createHotLedgerHub({ freshCtx: () => ctx, hotMetaKey: 'hot', getSnapHub: () => ({ requestSnapshot() { snapshots++; } }) });
    hub.resetHotLedgerState();
    const candidate = { savedAt: 'new', world: { meta: { tick: 3, chatConsumption: [{ messageId: 'old-version' }] }, events: [{ id: 'candidate' }] } };
    const save = hub.commitHotMeta(candidate, { guard });
    changed = true; release();
    await assert.rejects(save, /message version changed/);
    assert.equal(ctx.chatMetadata.hot, before);
    assert.deepEqual(persisted, before, 'the host must not keep a consumed candidate after rejecting its input version');
    assert.equal(snapshots, 0);
});

test('cancelled fresh-chat final save compensates persisted candidate to no world', async () => {
    const ctx = makeCtx('fresh');
    let release, aborted = false, persisted, calls = 0;
    const pending = new Promise(resolve => { release = resolve; });
    ctx.saveChat = async () => {
        const captured = structuredClone(ctx.chatMetadata);
        if (++calls === 1) await pending;
        await new Promise(resolve => setTimeout(resolve, 15)); persisted = captured;
    };
    const hub = createHotLedgerHub({ freshCtx: () => ctx, hotMetaKey: 'hot', getSnapHub: () => ({ requestSnapshot() {} }) });
    hub.resetHotLedgerState();
    const guard = { assertCurrent() {}, checkScope() { if (aborted) throw new Error('cancelled'); } };
    const save = hub.commitHotMeta({ savedAt: 'new', world: { meta: { tick: 0 } } }, { guard });
    aborted = true; release();
    await assert.rejects(save, /cancelled/);
    assert.equal(ctx.chatMetadata.hot ?? null, null);
    assert.equal(persisted.hot ?? null, null, 'host disk cannot retain the fresh candidate');
    assert.equal(calls, 2);
});
