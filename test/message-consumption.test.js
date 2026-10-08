import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTickQueue } from '../src/async-tick.js';
import { sw2LatestMessageText } from '../web/index.js';
import { createMessageConsumptionHub, recordConsumption, messageReference, historyConflicts, previewConsumptionRecovery, MESSAGE_ID_KEY } from '../web/message-consumption.js';
import { runTick } from '../src/tick.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

function lifecycle() {
    let world = { meta: { tick: 0 }, events: [] };
    const ctx = { chatId: 'official-st-chat', characterId: 1, chat: [] };
    const dialogues = [];
    const saveModes = [];
    let fail = false;
    const queue = createTickQueue({ load: () => world, getScope: () => ctx.chatId, beforeCommit: recordConsumption,
        tick: async ({ world: current, dialogue }) => {
            dialogues.push(dialogue);
            const next = structuredClone(current); next.meta.tick++;
            if (dialogue) next.events.push({ id: `e-${next.meta.tick}`, source: { type: 'dialogue' } });
            return { ok: true, ssot: next, dialogueStats: { changedFields: dialogue ? [{ entityId: 'p', field: 'identity' }] : [] } };
        }, save: (next, _transaction, options) => { if (fail) throw new Error('host save failure'); saveModes.push(options.saveMessages); world = next; return next; } });
    const makeHub = () => createMessageConsumptionHub({ getCtx: () => ctx, getWorld: () => world, getQueue: () => queue });
    return { ctx, dialogues, saveModes, queue, makeHub, world: () => world, setFail(value) { fail = value; }, restore(value) { world = value; } };
}

test('manual world-only advance after refresh does not consume the selected assistant twice', async () => {
    const env = lifecycle(); const hub = env.makeHub();
    env.ctx.chat.push({ mes: 'result', is_user: false, swipe_id: 0 });
    assert.equal((await hub.advance()).ok, true);
    const messageId = env.ctx.chat[0].extra[MESSAGE_ID_KEY];
    const restored = JSON.parse(JSON.stringify(env.world()));
    env.restore(restored); env.ctx.chat = JSON.parse(JSON.stringify(env.ctx.chat));
    const refreshed = env.makeHub();
    assert.equal(refreshed.advance().skipped, 'same-message');
    assert.equal((await refreshed.advance({ manual: true })).ok, true);
    assert.deepEqual(env.dialogues, ['result', '']);
    assert.deepEqual(env.saveModes, [true, false], 'generated extra ID is saved with messages once; later world-only turns use metadata');
    assert.equal(env.world().events.length, 1);
    assert.equal(env.ctx.chat[0].extra[MESSAGE_ID_KEY], messageId);
    assert.deepEqual(env.world().meta.chatConsumption[0].eventIds, ['e-1']);
    assert.deepEqual(env.world().meta.chatConsumption[0].changedFields, [{ entityId: 'p', field: 'identity' }]);
});

test('snapshot recovery preview copies inputs and marks deleted or edited originals unavailable', async () => {
    const env = lifecycle(), hub = env.makeHub();
    env.ctx.chat.push({ mes: 'original', is_user: false, swipe_id: 0, swipes: ['original', 'replacement'] });
    await hub.advance();
    env.ctx.chat[0].swipe_id = 1; env.ctx.chat[0].mes = 'replacement';
    const preview = previewConsumptionRecovery(env.ctx, env.world());
    assert.equal(preview.restoreBeforeTick, 1);
    assert.equal(preview.replay[0].originalDialogue, 'original');
    preview.replay[0].record.eventIds.push('copy-only');
    assert.deepEqual(env.world().meta.chatConsumption[0].eventIds, ['e-1']);
    env.ctx.chat = [];
    assert.equal(previewConsumptionRecovery(env.ctx, env.world()).replay[0].missingOriginal, true);
});

test('identical prose in distinct official ST/TT messages is consumed independently', async () => {
    const env = lifecycle(), hub = env.makeHub();
    env.ctx.chat.push({ mes: 'same result', is_user: false, swipe_id: 0, extra: {} });
    assert.equal((await hub.advance()).ok, true);
    env.ctx.chat.push({ mes: 'same result', is_user: false, swipe_id: 0, extra: {} });
    assert.equal((await hub.advance()).ok, true);
    assert.equal(env.world().events.length, 2);
    assert.notEqual(env.world().meta.chatConsumption[0].messageId, env.world().meta.chatConsumption[1].messageId);
});

test('failed save consumes nothing; retry persists one result and one consumption record', async () => {
    const env = lifecycle(), hub = env.makeHub();
    env.ctx.chat.push({ mes: 'new result', message_id: 'host-stable-id', is_user: false });
    env.setFail(true);
    assert.equal((await hub.advance()).ok, false);
    assert.equal(env.world().meta.chatConsumption, undefined);
    assert.equal(env.world().events.length, 0);
    env.setFail(false);
    assert.equal((await hub.advance()).ok, true);
    assert.equal(env.world().events.length, 1);
    assert.equal(env.world().meta.chatConsumption.length, 1);
    assert.equal(hub.advance().skipped, 'same-message');
});

test('empty chat, user and system last messages advance manually with empty dialogue', async () => {
    for (const message of [null, { mes: 'user tags', is_user: true }, { mes: 'system tags', is_system: true }]) {
        const env = lifecycle(), hub = env.makeHub();
        if (message) env.ctx.chat.push(message);
        assert.equal(hub.advance().skipped, 'no-assistant-message');
        assert.equal((await hub.advance({ manual: true })).ok, true);
        assert.deepEqual(env.dialogues, ['']);
        assert.equal(env.world().meta.chatConsumption, undefined);
    }
});

test('edits, deletions and swipe changes of consumed messages require snapshot recovery', async () => {
    for (const change of [ctx => { ctx.chat[0].mes = 'edit'; }, ctx => { ctx.chat.splice(0, 1); }, ctx => { ctx.chat[0].swipe_id = 1; }]) {
        const env = lifecycle(), hub = env.makeHub();
        env.ctx.chat.push({ mes: 'original result', is_user: false, swipe_id: 0 });
        assert.equal((await hub.advance()).ok, true);
        change(env.ctx);
        const result = hub.advance({ manual: true });
        assert.equal(result.skipped, 'history-conflict');
        assert.match(result.error, /快照.*重算/);
        assert.equal(env.world().events.length, 1);
        assert.equal(env.world().meta.tick, 1);
        assert.equal(historyConflicts(env.ctx, env.world()).length, 1);
        env.restore({ meta: { tick: 0 }, events: [] });
        assert.equal((await hub.advance({ manual: true })).ok, true);
    }
});

test('native message identity retains selected swipe and content version, independent of position', () => {
    const ctx = { chatId: 'tt', chat: [] }, message = { id: 'stable-host-id', mes: 'same', swipe_id: 2, swipes: ['a', 'b', 'same'] };
    const ref = messageReference(ctx, message, { create: true });
    assert.equal(ref.messageId, 'host:stable-host-id');
    assert.equal(ref.version, '2');
    assert.equal(message.extra, undefined);
    assert.deepEqual(messageReference(ctx, message), ref);
    message.mes = 'edited';
    assert.notEqual(messageReference(ctx, message).fingerprint, ref.fingerprint);
    ctx.chat.unshift({ mes: 'unrelated' });
    assert.equal(messageReference(ctx, message).messageId, ref.messageId);
});

test('deleting an earlier unconsumed user message never shifts a saved assistant identity', async () => {
    const env = lifecycle(), hub = env.makeHub();
    env.ctx.chat.push({ mes: 'player message', is_user: true }, { mes: 'assistant result', is_user: false });
    await hub.advance();
    env.ctx.chat.splice(0, 1);
    assert.equal(hub.advance().skipped, 'same-message');
    assert.equal(historyConflicts(env.ctx, env.world()).length, 0);
    assert.equal(env.world().events.length, 1);
});

test('editing an unconsumed assistant while the model runs discards its pending version', async () => {
    const ctx = { chatId: 'a', chat: [{ mes: 'initial', is_user: false }] };
    let world = { meta: { tick: 0 }, events: [] }, release, writes = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const queue = createTickQueue({ load: () => world, getScope: () => ctx.chatId, beforeCommit: recordConsumption,
        tick: async () => { await pending; return { ok: true, ssot: { meta: { tick: 1 }, events: [] } }; },
        save: next => { world = next; writes++; } });
    const hub = createMessageConsumptionHub({ getCtx: () => ctx, getWorld: () => world, getQueue: () => queue });
    const run = hub.advance();
    ctx.chat[0].mes = 'edited before commit'; release();
    assert.equal((await run).ok, false);
    assert.equal(writes, 0);
    assert.equal(world.meta.chatConsumption, undefined);
});

test('explicit invalidation rejects switching away and back or restoring an identical snapshot', async () => {
    let release, writes = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const world = { meta: { tick: 1 }, events: [] };
    const queue = createTickQueue({ load: () => world,
        tick: async () => { await pending; return { ok: true, ssot: { ...world, meta: { tick: 2 } } }; },
        save: () => { writes++; } });
    const run = queue.advance(); queue.invalidate(); release();
    assert.equal((await run).ok, false);
    assert.equal(writes, 0);
});

test('a transient host scope-read failure releases the queue for retry', async () => {
    let unavailable = true;
    const world = { meta: { tick: 1 } };
    const queue = createTickQueue({ load: () => world,
        getScope: () => { if (unavailable) throw new Error('host scope not ready'); return 'chat'; },
        tick: async () => ({ ok: true, ssot: { meta: { tick: 2 } } }), save: next => next });
    assert.equal((await queue.advance().catch(error => ({ ok: false, error: error.message }))).ok, false);
    unavailable = false;
    assert.equal((await queue.advance()).ok, true);
});

test('real tag extraction and settlement retry saves one result, consumption ID and changed field together', async () => {
    let world = { version: 1, context: { world: '测试', tension: 0.5, positions: ['未明'], playerId: 'p' },
        entities: [{ id: 'p', kind: 'character', name: '黄坤', location: '未明', status: 'active' }],
        weights: {}, agendas: [], events: [], milestones: [], chronicle: [], meta: { tick: 7, simLog: [], warnings: [], entityFields: {} } };
    const prose = '```tags\n【协议】3\n【事件】E1｜黄坤取得通行许可｜黄坤｜已完成\n【变化】黄坤｜身份｜许可持有者｜E1\n```';
    const ctx = { chatId: 'real-engine', chat: [{ mes: prose, is_user: false, swipe_id: 0 }] };
    const step = { actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] };
    let failSave = true;
    const queue = createTickQueue({ load: () => world, getScope: () => ctx.chatId, beforeCommit: recordConsumption,
        tick: ({ world: ssot, dialogue }) => runTick({ transport: async () => ({ text: JSON.stringify(step) }), ssot, dialogue, recall: false }),
        save: next => { if (failSave) throw new Error('simulated host failure'); world = structuredClone(next); return world; } });
    const hub = createMessageConsumptionHub({ getCtx: () => ctx, getWorld: () => world, getQueue: () => queue });
    const before = JSON.stringify(world);
    assert.equal((await hub.advance()).ok, false);
    assert.equal(JSON.stringify(world), before, 'failed real engine attempt cannot leak dialogue results into input world');
    failSave = false;
    assert.equal((await hub.advance()).ok, true);
    assert.equal(world.events.filter(e => e.source.type === 'dialogue').length, 1);
    assert.equal(world.meta.chatConsumption.length, 1);
    assert.equal(world.meta.chatConsumption[0].tick, 8);
    assert.deepEqual(world.meta.chatConsumption[0].eventIds, [world.events[0].id]);
    assert.deepEqual(world.meta.chatConsumption[0].changedFields, [{ entityId: 'p', field: '身份' }]);
    assert.equal(validate(world.meta.chatConsumption, ssotSchema.props.meta.props.chatConsumption).ok, true);
    if (world.meta.turnProtection) assert.equal(validate(world.meta.turnProtection, ssotSchema.props.meta.props.turnProtection).ok, true);
    assert.equal((await hub.advance({ manual: true })).ok, true);
    assert.equal(world.meta.tick, 9);
    assert.equal(world.events.filter(e => e.source.type === 'dialogue').length, 1);
    ctx.chat.push({ mes: prose, is_user: false, swipe_id: 0 });
    assert.equal((await hub.advance()).ok, true);
    assert.equal(world.events.filter(e => e.source.type === 'dialogue').length, 2);
    assert.equal(world.meta.chatConsumption.length, 2);
});

test('assistant selection never consumes a user or system tag block', () => {
    for (const flags of [{ is_user: true }, { is_system: true }, { role: 'user' }, { role: 'system' }]) {
        assert.equal(sw2LatestMessageText({ chat: [{ mes: '```tags\n【行动】甲｜移动\n```', ...flags }] }), '');
    }
});

test('a late model result cannot overwrite another chat', async () => {
    let scope = 'chat-a';
    let release;
    const wait = new Promise(resolve => { release = resolve; });
    let writes = 0;
    const world = { meta: { tick: 1 }, events: [] };
    const q = createTickQueue({ load: () => world, getScope: () => scope,
        tick: async () => { await wait; return { ok: true, ssot: { ...world, meta: { tick: 2 } } }; },
        save: () => { writes++; }, refresh: () => {} });
    const pending = q.advance('assistant');
    scope = 'chat-b'; release();
    const res = await pending;
    assert.equal(res.ok, false);
    assert.equal(writes, 0);
});

test('a late model result cannot overwrite a restored world at the same tick', async () => {
    let world = { meta: { tick: 1 }, events: [], entities: [{ id: 'a', position: 'old' }] };
    let release;
    const wait = new Promise(resolve => { release = resolve; });
    let writes = 0;
    const q = createTickQueue({ load: () => world,
        tick: async ({ world: before }) => { await wait; return { ok: true, ssot: { ...before, meta: { tick: 2 } } }; },
        save: () => { writes++; }, refresh: () => {} });
    const pending = q.advance();
    world = { ...world, entities: [{ id: 'a', position: 'snapshot' }] }; release();
    assert.equal((await pending).ok, false);
    assert.equal(writes, 0);
});
