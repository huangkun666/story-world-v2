import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallLedger, RECALL_MODES } from '../src/ledger-recall.js';
import { recallForPack } from '../src/embed-orchestration.js';
import { createInjector, INJECT_KEY_LEDGER, tagSpecText } from '../web/inject.js';
import { createEmbedRuntime } from '../web/embed-runtime.js';
import { makeVectorRecall } from '../web/settings-channels.js';
import { recallOf } from '../src/ledger-vector.js';

function fixture() {
    const events = [
        { id: 'ev_1_700', title: '甲方递交证明', source: { type: 'dialogue' } },
        { id: 'ev_2_1', title: '甲方获得新调查通知', source: { type: 'ripple', ref: 'ev_1_700' } },
    ];
    const rows = [
        { id: 'ch_1_dlg_1', tick: 1, text: '甲方递交证明', kind: 'state', eventRef: events[0].id },
        { id: 'ch_2_ev_1', tick: 2, text: events[1].title, eventRef: events[1].id },
        { id: 'ch_3_evs_ev_1_700', tick: 3, text: '甲方递交证明这一段收场了', chainRef: events[0].id },
        { id: 'unidentified', tick: 4, text: '甲方旧来源不明往事' },
        { id: 'present-state', tick: 5, text: '甲方当前身份是学生', producer: 'chat', recordType: 'state' },
    ];
    return { meta: { tick: 5 }, entities: [{ id: 'a', name: '甲方' }], events, chronicle: rows };
}

test('world consequence keeps its text while an explicit chat cause is referenced by ID in hot, cold and cached vector recall', async () => {
    for (const cold of [false, true]) {
        const world = fixture();
        const parent = world.events[0], effect = world.events[1];
        const row = world.chronicle.find(r => r.id === 'ch_2_ev_1');
        row.text = `事件「${effect.title}」——沿「${parent.title}」而来，事发 礼堂`;
        const original = JSON.stringify(world);
        const volumes = cold ? [{ rows: world.chronicle.splice(0, 2) }] : [];
        const raw = row.text;
        const recalled = recallLedger(world, { audience: 'chat', modes: [RECALL_MODES.RECENT], volumes, maxChars: null });
        const projected = recalled.items.find(r => r.id === row.id);
        assert.ok(projected.text.includes(effect.title));
        assert.ok(projected.text.includes(parent.id));
        assert.ok(!projected.text.includes(parent.title));
        assert.equal(row.text, raw, 'projection never edits the stored consequence');
        assert.equal(recallLedger(world, { modes: [RECALL_MODES.RECENT], volumes, maxChars: null }).items.find(r => r.id === row.id).text, raw);
        let output = '';
        const ctx = { chat: [{ is_user: true, mes: '甲方' }], setExtensionPrompt(key, text) { if (key === INJECT_KEY_LEDGER) output = text; } };
        const injector = createInjector({ getCtx: () => ctx, getWorld: () => world, isOn: () => true, vectorRecall: async () => ({ items: [{ ...row, line: raw }] }), retrievalParams: () => ({ maxChars: 5000 }) });
        await injector.prefetchVectors(); injector.apply();
        assert.match(output, /获得新调查通知/);
        assert.ok(!output.includes(parent.title));
        if (!cold) assert.equal(JSON.stringify(world), original);
    }
});

test('causal clause projection resolves archived chat parents and leaves unrelated quotations and world parents intact', async () => {
    const { filterChatRecords } = await import('../src/event-provenance.js');
    const world = fixture();
    const parent = world.events.shift(), effect = world.events[0];
    world.milestones = [{ rows: [parent] }];
    const linked = world.chronicle.find(r => r.id === 'ch_2_ev_1');
    linked.text = `事件「${effect.title}」——沿「${parent.title}」而来，保留后果`;
    const quoted = { id: 'unknown-literal', text: linked.text };
    const result = filterChatRecords(world, [linked, quoted]).items;
    assert.ok(result[0].text.includes(parent.id));
    assert.equal(result[1], quoted, 'matching prose without an event identity remains untouched');
    parent.source = { type: 'state' };
    assert.equal(filterChatRecords(world, [linked]).items[0], linked, 'world cause titles retain existing behavior');
});

for (const cold of [false, true]) {
    for (const mode of [RECALL_MODES.RECENT, RECALL_MODES.BY_NAMES, RECALL_MODES.BY_KEYWORD]) {
        test(`chat ${mode} filters results and maintenance before limits (${cold ? 'cold' : 'hot'})`, () => {
            const world = fixture();
            const volumes = cold ? [{ rows: world.chronicle.splice(0, 3) }] : [];
            const result = recallLedger(world, { audience: 'chat', modes: [mode], text: '甲方', volumes, maxChars: null });
            assert.deepEqual(result.items.map(x => x.id).sort(), ['ch_2_ev_1', 'present-state', 'unidentified']);
            assert.equal(result.provenance.unknownSources, 1);
            assert.equal(result.provenance.filtered.length, 2);
            assert.equal(recallLedger(world, { modes: [mode], text: '甲方', volumes, maxChars: null }).items.length, 5);
        });
    }
}

test('vector chat recall refills top N after source filtering and body lookup', async () => {
    const world = fixture();
    const rows = world.chronicle;
    const store = { ids: rows.map(x => x.id), tickByIndex: rows.map(x => x.tick), vecs: [[1,0], [0.8,0.2], [1,0], [0.7,0.3], [0.6,0.4]] };
    const result = recallForPack(world, store, { audience: 'chat', qVector: [1,0], floor: 6, top: 2, rows });
    assert.deepEqual(result.items.map(x => x.id), ['ch_2_ev_1', 'unidentified']);
    assert.equal(result.report.provenance.filtered.length, 2);
    assert.equal(recallForPack(world, store, { qVector: [1,0], floor: 6, top: 2, rows }).items.length, 2);
    let disk;
    const runtime = createEmbedRuntime({ indexStore: { load: async () => disk, save: async x => { disk = x; } }, client: { embed: async texts => texts.map(() => [1,0]) }, signature: { model: 'test', dims: 2 } });
    await runtime.stepForTick({ world, floor: 6, maxItemsPerTurn: 10 });
    const recall = makeVectorRecall({ getCtx: () => ({}), getWorld: () => world, getRuntime: () => runtime, queryTextOf: () => '甲方', params: { top: 3 } });
    assert.deepEqual((await recall()).items.map(x => x.id).sort(), ['ch_2_ev_1', 'present-state', 'unidentified']);
});

test('final injection rejects cached chat vector results and preserves changed state', async () => {
    const world = fixture();
    world.entities[0].身份 = '学生';
    world.meta.entityFields = { a: { fields: { 身份: { value: '学生', prev: '访客', cause: 'ev_1_700', tick: 1, source: '变更' } } } };
    let output = '';
    const ctx = { chat: [{ is_user: true, mes: '甲方' }], setExtensionPrompt: (key, text) => { if (key === INJECT_KEY_LEDGER) output = text; } };
    const injector = createInjector({ getCtx: () => ctx, getWorld: () => world, isOn: () => true, vectorRecall: async () => ({ items: world.chronicle }), retrievalParams: () => ({ maxChars: 5000 }) });
    await injector.prefetchVectors();
    injector.apply();
    assert.doesNotMatch(output, /递交证明/);
    assert.match(output, /获得新调查通知/);
    assert.match(output, /甲方的〈身份〉：访客 → 学生/);
    const facts = injector._facts().recall;
    assert.ok(facts.provenance.selectedIds.includes('ch_2_ev_1'));
    assert.equal(facts.provenance.unknownSources, 1);
});

test('direct vector recall filters before top N without deleting indexed chat records', () => {
    const world = fixture();
    const store = { items: world.chronicle, vectors: new Map(world.chronicle.map(row => [row.id, [1,0]])) };
    const options = { qVector: [1,0], floor: 6, top: 4 };
    assert.equal(recallOf(world, store, { ...options, audience: 'chat' }).length, 3);
    assert.equal(recallOf(world, store, options).length, 4);
    assert.equal(store.items.length, 5);
});

test('vector no-body hits refill while top zero stays empty', () => {
    const world = fixture();
    const store = { ids: ['missing-body', 'ch_2_ev_1'], tickByIndex: [4,2], vecs: [[1,0],[0.9,0.1]] };
    const options = { audience: 'chat', qVector: [1,0], floor: 6, top: 1 };
    assert.deepEqual(recallForPack(world, store, options).items.map(x => x.id), ['ch_2_ev_1']);
    assert.equal(recallForPack(world, store, { ...options, top: 0 }).items.length, 0);
});

test('provenance follows archived event references, never titles or world causal sources', async () => {
    const { classifyRecord, chatRecallDecision, filterChatRecords } = await import('../src/event-provenance.js');
    const world = { events: [], milestones: [{ rows: [{ id: 'old-chat', source: { type: 'dialogue' } }] }] };
    assert.deepEqual(classifyRecord(world, { eventRef: 'old-chat', kind: 'state' }), { producer: 'chat', recordType: 'result' });
    assert.equal(chatRecallDecision(world, { eventRef: 'old-chat' }).include, false);
    assert.equal(classifyRecord(world, { title: 'old-chat', source: { type: 'ripple', ref: 'old-chat' } }).producer, 'world');
    assert.equal(classifyRecord(world, { title: '聊天登记的普通问候' }).producer, 'unknown');
    assert.deepEqual(classifyRecord(world, { id: 'ch_1_dlg_1', producer: 'world', recordType: 'state' }), { producer: 'world', recordType: 'state' });
    assert.equal(chatRecallDecision(world, { id: 'ch_2_adv_ag_1', chainRef: 'old-chat' }).reason, 'maintenance');
    const result = filterChatRecords(world, [{ id: 'legacy', text: '未知来源' }, { id: 'ch_1_dlg_1', text: '登记行' }]);
    assert.equal(result.report.unknownSources, 1);
    assert.deepEqual(result.items.map(x => x.id), ['legacy']);
});

test('chat tag instructions expose v4 result linkage and action protection', () => {
    const spec = tagSpecText();
    assert.match(spec, /【协议】4/);
    assert.match(spec, /【事件】E1｜/);
    assert.match(spec, /可选第四格为账上既有因果事件/);
    assert.match(spec, /第四格/);
    assert.match(spec, /行动.*当轮/);
});

test('ledger vector mode resolves cold bodies and filters before top N', () => {
    const world = fixture();
    const volumes = [{ rows: world.chronicle.splice(0, 3) }];
    const store = { ids: volumes[0].rows.map(x => x.id), tickByIndex: [1,2,3], vecs: [[1,0],[0.8,0.2],[1,0]] };
    const result = recallLedger(world, { audience: 'chat', modes: [RECALL_MODES.BY_VECTOR], qVector: [1,0], vectorStore: store, floor: 6, top: 1, maxChars: null, volumes });
    assert.deepEqual(result.items.map(x => x.id), ['ch_2_ev_1']);
    assert.equal(result.provenance.filtered.length, 2);
});

test('chat filtering precedes both item limits and character budget', () => {
    const world = fixture();
    world.chronicle = [world.chronicle[1], { ...world.chronicle[0], tick: 5, text: '甲方'.repeat(100) }];
    const result = recallLedger(world, { audience: 'chat', modes: [RECALL_MODES.RECENT], maxChars: 20, limit: 1 });
    assert.deepEqual(result.items.map(x => x.id), ['ch_2_ev_1']);
});

test('entropy lifecycle closure is maintenance while actual calm state is retained', async () => {
    const { filterChatRecords } = await import('../src/event-provenance.js');
    const rows = [
        { id: 'ch_30_pumpC_ev_pump_20_1', text: '天下已不安静（新的事件上桌，安稳期结束）' },
        { id: 'ch_20_pump_ev_pump_20_1', text: '天下安稳：已 20 轮无新事上桌' },
    ];
    const result = filterChatRecords({}, rows);
    assert.deepEqual(result.items.map(x => x.id), ['ch_20_pump_ev_pump_20_1']);
    assert.equal(result.report.unknownSources, 0);
});
