import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderEntityWindowHtml, createEntityWindowHub } from '../web/entity-window.js';
import { renderEntitiesHtml } from '../src/render.js';
import { createHotLedgerHub } from '../web/hot-ledger.js';
import { hotAccountShape } from '../src/storage.js';

const fixture = () => ({ version: 1, context: { playerId: 'player' }, meta: { tick: 0 }, entities: [
    { id: 'player', name: '玩家', kind: 'character' }, { id: 'npc', name: '同伴', kind: 'character' },
    { id: 'faction', name: '组织', kind: 'faction' },
], agendas: [], events: [], chronicle: [], milestones: [], weights: {} });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function setup(overrides = {}) {
    const { createSimulationProtectionHub } = await import('../web/simulation-protection.js');
    const state = { world: fixture(), scope: 'chat-a', busy: false, saves: [], refreshes: [], statuses: [] };
    const hub = createSimulationProtectionHub({ getWorld: () => state.world, getScope: () => state.scope,
        isBusy: () => state.busy, saveWorld: async (world, guard) => { guard.assertCurrent(); state.saves.push(world); return world; },
        refresh: world => { state.refreshes.push(world); state.world = world; }, setStatus: text => state.statuses.push(text), ...overrides });
    return { hub, state };
}

test('simulation toggle saves a detached candidate, refreshes only after saving, and can unblock an NPC', async () => {
    const { hub, state } = await setup(); const before = structuredClone(state.world); const original = state.world;
    assert.equal((await hub.set('npc', true)).ok, true);
    assert.deepEqual(original, before); assert.equal(state.world.entities[1].simulationBlocked, true);
    assert.notEqual(state.saves[0].context, original.context);
    assert.equal((await hub.set('npc', false)).ok, true); assert.equal(state.world.entities[1].simulationBlocked, false);
    assert.equal(state.world.context.playerId, 'player');
});

test('player unblock, invalid entity and busy generation are rejected without a save', async () => {
    const { hub, state } = await setup();
    await assert.rejects(hub.set('player', false), /玩家/); await assert.rejects(hub.set('faction', true), /角色/);
    state.busy = true; await assert.rejects(hub.set('npc', true), /演算/); assert.equal(state.saves.length, 0);
});

test('pending save blocks repeated clicks and a failed save never publishes success', async () => {
    const gate = deferred(); const { hub, state } = await setup({ saveWorld: () => gate.promise });
    const pending = hub.set('npc', true); await assert.rejects(hub.set('npc', true), /保存/);
    assert.equal(state.world.entities[1].simulationBlocked, undefined); assert.equal(state.refreshes.length, 0);
    gate.reject(new Error('disk failed')); await assert.rejects(pending, /disk failed/);
    assert.equal(state.refreshes.length, 0); assert.ok(state.statuses.some(s => s.includes('disk failed')));
    assert.equal(state.statuses.some(s => s.includes('已禁止')), false);
});

test('late save from a switched chat or modified world cannot refresh or announce success', async () => {
    for (const mutate of [s => { s.scope = 'chat-b'; }, s => { s.world.meta.tick++; }, s => { s.world = { ...s.world, context: { playerId: 'npc' } }; }]) {
        const gate = deferred(); const { hub, state } = await setup({ saveWorld: () => gate.promise });
        const pending = hub.set('npc', true); mutate(state); gate.resolve({ ok: true });
        await assert.rejects(pending, /改变|切换/); assert.equal(state.refreshes.length, 0);
    }
});

test('guard catches switching scope before a transactional write and input mutation during save', async () => {
    let guard; const gate = deferred(); const { hub, state } = await setup({ saveWorld: (world, value) => { guard = value; return gate.promise; } });
    const pending = hub.set('npc', true); state.scope = 'chat-b'; assert.throws(() => guard.assertCurrent(), /切换/);
    gate.resolve(); await assert.rejects(pending, /切换/);
});

test('explicit failed or queued saves are not treated as completed', async () => {
    for (const result of [{ ok: false, reason: 'timeout' }, { ok: true, queued: true }]) {
        const { hub, state } = await setup({ saveWorld: async () => result });
        await assert.rejects(hub.set('npc', true), /保存/); assert.equal(state.refreshes.length, 0);
    }
});

test('detail and roster badges describe permanent protection only, player cannot unblock, faction has no toggle', () => {
    const world = fixture(); world.entities[1].simulationBlocked = true;
    assert.match(renderEntityWindowHtml(world, 'npc'), /role="switch"[^>]*aria-checked="true"[^>]*data-simulation-blocked="false"/);
    assert.equal((renderEntityWindowHtml(world, 'npc').match(/>禁止模拟</g) || []).length, 1, '头部只保留一处开关文字');
    assert.match(renderEntityWindowHtml(world, 'player'), /玩家角色始终受保护/);
    assert.doesNotMatch(renderEntityWindowHtml(world, 'player'), /data-simulation-blocked="false"/);
    assert.doesNotMatch(renderEntityWindowHtml(world, 'faction'), /data-simulation-toggle/);
    assert.equal((renderEntitiesHtml(world).match(/sw2-simulation-badge/g) || []).length, 2);
    world.entities[1].simulationBlocked = false; world.meta.turnProtection = { tick: 1, actedIds: ['npc'] };
    assert.match(renderEntityWindowHtml(world, 'npc'), /data-simulation-blocked="true"[^>]*>禁止模拟/);
    assert.equal((renderEntitiesHtml(world).match(/sw2-simulation-badge/g) || []).length, 1);
    assert.match(renderEntityWindowHtml(world, 'npc'), /role="switch"[^>]*aria-checked="false"/);
    assert.doesNotMatch(renderEntityWindowHtml(world, 'npc'), /禁止模拟后，不会替此角色/);
    const detail=renderEntityWindowHtml(world, 'npc');
    assert.ok(detail.indexOf('data-simulation-toggle') > detail.indexOf('sw2-ew-sub'), '开关放入角色资料行');
});

function fakeDoc() {
    const doc = { body: { children: [], appendChild(el) { this.children.push(el); } }, createElement() { return {
        children: [], listeners: {}, appendChild(el) { this.children.push(el); }, addEventListener(type, fn) { this.listeners[type] = fn; },
        querySelector() { return null; }, remove() { doc.body.children = doc.body.children.filter(el => el !== this); },
    }; }, getElementById(id) { return this.body.children.find(el => el.id === id); }, addEventListener() {}, removeEventListener() {} };
    return doc;
}

test('real detail click handler awaits injected callback, disables pending button, and refreshes on success', async () => {
    const doc = fakeDoc(), gate = deferred(), world = fixture(), calls = [];
    const hub = createEntityWindowHub({ doc, getWorld: () => world, setSimulationBlocked: async (...args) => { calls.push(args); await gate.promise; world.entities[1].simulationBlocked = true; } });
    hub.open('npc'); const mask = doc.getElementById('sw2_entity_window'), box = mask.children[0];
    const button = { disabled: false, getAttribute: name => ({ 'data-simulation-toggle': 'npc', 'data-simulation-blocked': 'true' })[name] };
    const pending = box.listeners.click({ target: { closest: selector => selector === '[data-simulation-toggle]' ? button : null }, preventDefault() {} });
    assert.deepEqual(calls, [['npc', true, { scopeKey: JSON.stringify(''), worldVersion: JSON.stringify(world) }]]);
    assert.equal(button.disabled, true); assert.equal(doc.body.children[0], mask);
    gate.resolve(); await pending; assert.equal(doc.body.children.length, 1);
    assert.match(doc.body.children[0].children[0].innerHTML, /aria-checked="true"/);
});

test('detail click displays save errors and preserves the current detail without reopening it', async () => {
    const doc = fakeDoc(), messages = []; const hub = createEntityWindowHub({ doc, getWorld: fixture, setStatus: s => messages.push(s), setSimulationBlocked: async () => { throw new Error('disk failed'); } });
    hub.open('npc'); const mask = doc.getElementById('sw2_entity_window'), box = mask.children[0];
    const status = { textContent: '' }; box.querySelector = selector => selector === '[data-simulation-status]' ? status : null;
    const button = { disabled: false, getAttribute: name => ({ 'data-simulation-toggle': 'npc', 'data-simulation-blocked': 'true' })[name] };
    await box.listeners.click({ target: { closest: selector => selector === '[data-simulation-toggle]' ? button : null }, preventDefault() {} });
    assert.equal(button.disabled, false); assert.equal(doc.body.children[0], mask); assert.ok(messages.some(s => s.includes('disk failed')));
    assert.match(status.textContent, /disk failed/, 'error must be visible within the detail above the panel');
});

test('delayed keyboard save restores blurred focus without stealing a new focus target', async () => {
    for (const moved of [false, true]) for (const failed of [false, true]) {
        const doc=fakeDoc(),gate=deferred();let focused=0;
        const next={focus(){focused++;doc.activeElement=next;}};
        const create=doc.createElement;
        doc.createElement=()=>{const el=create();el.querySelector=selector=>selector==='[data-simulation-toggle]'?next:null;return el;};
        const hub=createEntityWindowHub({doc,getWorld:fixture,setSimulationBlocked:()=>gate.promise});
        hub.open('npc');const box=doc.getElementById('sw2_entity_window').children[0];
        const toggle={disabled:false,focus(){focused++;doc.activeElement=toggle;},getAttribute:key=>({'data-simulation-toggle':'npc','data-simulation-blocked':'true'})[key]};
        doc.activeElement=toggle;
        const pending=box.listeners.click({target:{closest:()=>toggle},preventDefault(){}});
        doc.activeElement=moved?{name:'another control'}:doc.body;
        failed?gate.reject(new Error('save failed')):gate.resolve();await pending;
        assert.equal(focused,moved?0:1);
    }
});

test('production detail saves through the guarded hot ledger, and index stays within its limit', () => {
    const source = readFileSync(new URL('../web/index.js', import.meta.url), 'utf8');
    assert.match(source, /createSimulationProtectionHub\(/); assert.match(source, /saveWorld:.*hotHub\.commitHotMeta\(/);
    assert.match(source, /setSimulationBlocked:.*simulationProtection\.set/); assert.match(source, /isBusy:.*sw2TickQueue\?\.busy/);
    assert.match(source, /setSimulationBlocked: \(id, blocked, expected\) => simulationProtection\.set\(id, blocked, expected\)/);
    assert.match(source, /const entityWindow = createEntityWindowHub\(\{\s+getWorld:[^\n]+\s+getScope: \(\) => chatScope\(freshCtx\(\)\)/);
    assert.match(source, /async function advanceTick\([^\n]+\) \{\s+if \(simulationProtection\.busy\)/);
    assert.ok(source.split('\n').length < 3100);
});

async function clickOldDetailAfterReplacement(change) {
    const { hub: protection, state } = await setup();
    state.world.entities[1].name = 'Alice';
    const doc = fakeDoc(), messages = [];
    const details = createEntityWindowHub({ doc, getWorld: () => state.world, getScope: () => state.scope,
        setSimulationBlocked: (...args) => protection.set(...args), setStatus: message => messages.push(message) });
    details.open('npc');
    const mask = doc.getElementById('sw2_entity_window'), box = mask.children[0], status = { textContent: '' };
    box.querySelector = selector => selector === '[data-simulation-status]' ? status : null;
    change(state);
    const before = structuredClone(state.world);
    const button = { disabled: false, getAttribute: name => ({ 'data-simulation-toggle': 'npc', 'data-simulation-blocked': 'true' })[name] };
    await box.listeners.click({ target: { closest: selector => selector === '[data-simulation-toggle]' ? button : null }, preventDefault() {} });
    assert.deepEqual(state.world, before, 'old Alice button cannot protect Bob with the same ID');
    assert.equal(state.saves.length, 0); assert.equal(state.refreshes.length, 0);
    assert.equal(doc.body.children[0], mask); assert.match(box.innerHTML, /Alice/);
    assert.match(status.textContent, /切换|改变/); assert.equal(button.disabled, false);
    assert.ok(messages.some(message => /切换|改变/.test(message)));
}

test('old detail rejects a click after changing chats even when the new world is byte-identical', async () => {
    await clickOldDetailAfterReplacement(state => { state.scope = 'chat-b'; state.world = structuredClone(state.world); });
});

test('old detail cannot modify a replacement character with the same ID in another chat', async () => {
    await clickOldDetailAfterReplacement(state => { state.scope = 'chat-b'; state.world = fixture(); state.world.entities[1].name = 'Bob'; });
});

test('old detail cannot modify a same-scope replacement world or an in-place edited world', async () => {
    for (const mutate of [state => { state.world = fixture(); state.world.entities[1].name = 'Bob'; }, state => { state.world.entities[1].name = 'Bob'; }]) {
        await clickOldDetailAfterReplacement(mutate);
    }
});

test('controller checks the rendered scope and world before invoking any save', async () => {
    const { hub, state } = await setup();
    const expected = { scopeKey: JSON.stringify(state.scope), worldVersion: JSON.stringify(state.world) };
    state.world.entities[1].name = 'Bob'; await assert.rejects(hub.set('npc', true, expected), /改变/);
    expected.worldVersion = JSON.stringify(state.world); state.scope = 'chat-b';
    await assert.rejects(hub.set('npc', true, expected), /切换/);
    assert.equal(state.saves.length, 0); assert.equal(state.refreshes.length, 0);
});

test('a delayed lookup cannot write over a newly saved protection flag or a switched chat', async () => {
    const { createWorldWriteGuard } = await import('../web/world-write-guard.js');
    for (const mode of ['toggle', 'switch']) {
        const { hub, state } = await setup(); const lookupInput = state.world, gate = deferred();
        const guard = createWorldWriteGuard({ world: lookupInput, getWorld: () => state.world, getScope: () => state.scope });
        let lookupWrites = 0;
        const pendingLookup = (async () => {
            const candidate = await gate.promise; guard.prepare(candidate);
            guard.assertCurrent(); lookupWrites++; state.world = candidate;
        })();
        if (mode === 'toggle') await hub.set('npc', true); else { state.scope = 'chat-b'; state.world = fixture(); }
        const before = structuredClone(state.world);
        gate.resolve({ ...structuredClone(lookupInput), entities: lookupInput.entities.map(entity => ({ ...entity, 实力: '书中原话' })) });
        await assert.rejects(pendingLookup, /切换|改变/);
        assert.equal(lookupWrites, 0); assert.deepEqual(state.world, before);
    }
});

test('lookup write guard accepts its own staged candidate and rejects changes during actual host save', async () => {
    const { createWorldWriteGuard } = await import('../web/world-write-guard.js');
    const previousWindow = globalThis.window; globalThis.window = { __TAURITAVERN__: true };
    try {
        for (const mode of ['success', 'changed']) {
            const before = hotAccountShape(fixture()); const gate = deferred(); let persisted, calls = 0;
            const ctx = { chatId: 'a', chatMetadata: { hot: before }, updateChatMetadata(update) { Object.assign(this.chatMetadata, update); },
                async saveMetadata() { const captured = structuredClone(this.chatMetadata.hot); if (++calls === 1) await gate.promise; persisted = captured; } };
            ctx.saveChat = ctx.saveMetadata;
            const hot = createHotLedgerHub({ freshCtx: () => ctx, hotMetaKey: 'hot', getSnapHub: () => ({ requestSnapshot() {} }) }); hot.resetHotLedgerState();
            const guard = createWorldWriteGuard({ world: before.world, getWorld: () => hot.readHotMeta().world, getScope: () => ctx.chatId });
            const candidate = structuredClone(before.world); candidate.entities[1].实力 = '书中原话'; guard.prepare(candidate);
            const pending = hot.commitHotMeta(hotAccountShape(candidate), { guard });
            if (mode === 'changed') before.world.entities[1].simulationBlocked = true;
            gate.resolve();
            if (mode === 'success') { assert.equal(await pending, candidate); assert.deepEqual(persisted.world, candidate); }
            else { await assert.rejects(pending, /改变/); assert.equal(ctx.chatMetadata.hot, before); assert.deepEqual(persisted, before); }
        }
    } finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
});

test('production lookup captures a guard before its asynchronous query and commits through it', () => {
    const source = readFileSync(new URL('../web/index.js', import.meta.url), 'utf8');
    const lookup = source.slice(source.indexOf('export async function lookupOneEntity('), source.indexOf('// ---------- K36：每轮演化'));
    assert.ok(lookup.indexOf('createWorldWriteGuard(') >= 0 && lookup.indexOf('createWorldWriteGuard(') < lookup.indexOf('await runBatchLookup('));
    assert.match(lookup, /guard\.prepare\(res\.ssot\)/);
    assert.match(lookup, /await hotHub\.commitHotMeta\(hotAccountShape\(res\.ssot\), \{ guard \}\)/);
    assert.doesNotMatch(lookup, /writeHotMeta\(hotAccountShape\(res\.ssot\)/);
});

test('toggle uses the actual hot-ledger transaction for successful save, failure, chat switch and rollback', async () => {
    const previousWindow = globalThis.window; globalThis.window = { __TAURITAVERN__: true };
    try {
        for (const mode of ['success', 'failure', 'switch', 'changed-original']) {
            const before = hotAccountShape(fixture()), other = hotAccountShape(fixture());
            const originalCtx = { chatId: 'a', chatMetadata: { hot: before }, updateChatMetadata(update) { Object.assign(this.chatMetadata, update); } };
            const nextCtx = { chatId: 'b', chatMetadata: { hot: other } };
            let currentCtx = originalCtx, persisted, calls = 0, snapshots = 0;
            const gate = deferred();
            originalCtx.saveMetadata = async () => {
                const captured = structuredClone(originalCtx.chatMetadata.hot);
                if (++calls === 1) await gate.promise;
                if (mode === 'failure') throw new Error('disk failed');
                persisted = captured;
            };
            originalCtx.saveChat = originalCtx.saveMetadata;
            const hot = createHotLedgerHub({ freshCtx: () => currentCtx, hotMetaKey: 'hot', getSnapHub: () => ({ requestSnapshot() { snapshots++; } }) });
            hot.resetHotLedgerState();
            const { hub, state } = await setup({ getWorld: () => hot.readHotMeta().world, getScope: () => currentCtx.chatId,
                saveWorld: (candidate, guard) => hot.commitHotMeta(hotAccountShape(candidate), { guard }) });
            const pending = hub.set('npc', true);
            assert.equal(state.refreshes.length, 0);
            if (mode === 'switch') currentCtx = nextCtx;
            if (mode === 'changed-original') before.world.meta.tick++;
            gate.resolve();
            if (mode === 'success') {
                assert.equal((await pending).ok, true); assert.equal(persisted.world.entities[1].simulationBlocked, true);
                assert.equal(state.refreshes.length, 1); assert.equal(snapshots, 1);
            } else {
                await assert.rejects(pending, /disk failed|切换|改变/);
                assert.equal(originalCtx.chatMetadata.hot, before); assert.equal(nextCtx.chatMetadata.hot, other);
                assert.equal(state.refreshes.length, 0); assert.equal(snapshots, 0);
                if (mode === 'changed-original') assert.deepEqual(persisted, before, 'acknowledged candidate is compensated on disk');
            }
        }
    } finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
});
