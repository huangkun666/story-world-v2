import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallLedger, RECALL_MODES } from '../src/ledger-recall.js';
import { createInjector, INJECT_KEY_LEDGER } from '../web/inject.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function ledger(chronicle = [], entities = []) {
    return { meta: { tick: 100 }, chronicle, entities, events: [], agendas: [], milestones: [] };
}
function harness({ text = '商队', world = ledger(), enabled = true, recallOn = true } = {}) {
    const hooks = new Map(), jobs = [], writes = [];
    const state = { world, enabled, recallOn, output: '' };
    const ctx = {
        chatId: 'chat-a', characterId: 1, groupId: null,
        chat: [{ is_user: true, mes: text }],
        eventTypes: { MESSAGE_SENT: 'sent' },
        eventSource: { on: (event, fn) => hooks.set(event, fn) },
        setExtensionPrompt: (key, value) => {
            if (key === INJECT_KEY_LEDGER) { state.output = value; writes.push(value); }
        },
    };
    const injector = createInjector({
        getCtx: () => ctx, getWorld: () => state.world,
        isOn: key => state.recallOn && key === 'injectLedgerRecall',
        vectorEnabled: () => state.enabled,
        vectorRecall: () => {
            const job = deferred(); jobs.push({ ...job, query: ctx.chat.at(-1)?.mes }); return job.promise;
        },
    });
    return { ctx, injector, jobs, state, writes, send(text) {
        ctx.chat = [{ is_user: true, mes: text }]; hooks.get('sent')();
    } };
}

test('关键词命中数在条数和字符预算之前生效，旧的多词记录保留', () => {
    const world = ledger([{ id: 'old', tick: 1, text: 'alpha beta gamma' }, { id: 'new', tick: 99, text: 'alpha' }]);
    const before = JSON.stringify(world);
    for (const budget of [{ limit: 1, maxChars: null }, { maxChars: 16 }]) {
        const got = recallLedger(world, { modes: [RECALL_MODES.BY_KEYWORD], text: 'alpha beta gamma', ...budget });
        assert.deepEqual(got.items.map(row => row.id), ['old']);
    }
    assert.equal(JSON.stringify(world), before);
});

test('关键词同分按新旧；最近和名称模式单独使用仍保持新优先', () => {
    const world = ledger([{ id: 'old', tick: 1, text: '黄坤 alpha' }, { id: 'new', tick: 99, text: '黄坤 alpha' }], [{ id: 'e', name: '黄坤' }]);
    for (const mode of [RECALL_MODES.BY_KEYWORD, RECALL_MODES.BY_NAMES, RECALL_MODES.RECENT]) {
        assert.deepEqual(recallLedger(world, { modes: [mode], text: '黄坤 alpha', limit: 1 }).items.map(row => row.id), ['new']);
    }
});

test('冷卷的多词命中与热账使用同一排序', () => {
    const world = ledger([{ id: 'new', tick: 99, text: 'alpha' }]);
    const volumes = [{ fromTick: 1, rows: [{ id: 'cold', tick: 1, text: 'alpha beta gamma' }] }];
    const before = JSON.stringify({ world, volumes });
    const got = recallLedger(world, { modes: [RECALL_MODES.BY_KEYWORD], text: 'alpha beta gamma', maxChars: 16, volumes });
    assert.deepEqual(got.items.map(row => row.id), ['cold']);
    assert.equal(JSON.stringify({ world, volumes }), before);
});

for (const named of [false, true]) {
    test(`聊天预算优先保留旧的多词记录${named ? '，即使它先被名称模式认领' : ''}`, () => {
        const name = named ? '黄坤 ' : '';
        const strong = { id: 'strong', tick: 1, text: `${name}alpha beta gamma 旧事关键经过` };
        const recent = Array.from({ length: 80 }, (_, i) => ({ id: `recent-${i}`, tick: i + 10, text: `${name}alpha 第${i}次的新事经过，只有一个匹配词` }));
        const world = ledger([strong, ...recent], named ? [{ id: 'e', name: '黄坤' }] : []);
        const h = harness({ text: `${name}alpha beta gamma`, world, enabled: false });
        h.injector.apply();
        assert.ok(h.state.output.includes('旧事关键经过'), '旧记录必须先于新的一词记录占到有限额度');
        assert.ok(!h.state.output.includes('第0次的新事经过'), '额度真实截断，不能把所有候选都装进去');
    });
}

test('发送新问题立即撤掉旧向量，后台结果完成后重设真实注入口', async () => {
    const h = harness();
    h.injector.prefetchVectors(); h.jobs[0].resolve({ items: [{ id: 'caravan', tick: 1, text: '商队旧事' }] });
    await turn(); h.injector.apply(); assert.ok(h.state.output.includes('商队旧事'));
    h.send('退婚');
    assert.ok(!h.state.output.includes('商队旧事'), '新查询等待期间不能用旧结果');
    assert.equal(h.jobs.length, 2); assert.equal(h.jobs[1].query, '退婚');
    h.jobs[1].resolve([{ id: 'marriage', tick: 2, text: '婚约解除的旧事' }]); await turn();
    assert.ok(h.state.output.includes('婚约解除的旧事'), '完成时自动重设，不能再等下一次手动 apply');
});

test('同一查询发送和反复准备复用进行中及已完成结果', async () => {
    const h = harness(); h.send('商队');
    assert.equal(h.jobs.length, 1);
    h.send('商队'); h.injector.prefetchVectors(); assert.equal(h.jobs.length, 1);
    h.jobs[0].resolve([{ tick: 1, text: '只查询一次的旧事' }]); await turn();
    h.send('商队'); assert.equal(h.jobs.length, 1); assert.ok(h.state.output.includes('只查询一次的旧事'));
});

test('旧查询迟到不能覆盖已经完成的新查询', async () => {
    const h = harness(); h.send('商队'); h.send('退婚');
    assert.equal(h.jobs.length, 2);
    h.jobs[1].resolve([{ tick: 2, text: '当前婚约旧事' }]); await turn();
    const current = h.state.output;
    h.jobs[0].resolve([{ tick: 1, text: '迟到商队旧事' }]); await turn();
    assert.equal(h.state.output, current); assert.ok(!h.state.output.includes('迟到商队旧事'));
});

test('没有发送事件时，使用缓存前仍核对完整查询', async () => {
    const h = harness(); h.injector.prefetchVectors(); h.jobs[0].resolve([{ tick: 1, text: '旧商队向量' }]);
    await turn(); h.injector.apply();
    h.ctx.chat = [{ is_user: true, mes: '退婚' }]; h.injector.apply();
    assert.ok(!h.state.output.includes('旧商队向量'));
});

test('上一段正文变化也使向量失效，不能只比较玩家一句话', async () => {
    const h = harness({ text: '继续' });
    h.ctx.chat.unshift({ is_user: false, mes: '上一场商队经过' });
    h.injector.prefetchVectors(); h.jobs[0].resolve([{ tick: 1, text: '商队向量旧事' }]); await turn();
    h.ctx.chat[0].mes = '上一场婚约经过'; h.injector.apply();
    assert.ok(!h.state.output.includes('商队向量旧事'));
});

for (const change of ['chat', 'character', 'group', 'world', 'rollback']) {
    test(`向量完成与使用均隔离身份变化：${change}`, async () => {
        for (const settled of [false, true]) {
            const h = harness(); h.injector.prefetchVectors();
            if (settled) { h.jobs[0].resolve([{ tick: 1, text: '另一个现场的旧事' }]); await turn(); }
            if (change === 'chat') h.ctx.chatId = 'chat-b';
            if (change === 'character') h.ctx.characterId = 2;
            if (change === 'group') h.ctx.groupId = 'group-b';
            if (change === 'world') h.state.world = ledger();
            if (change === 'rollback') h.state.world.meta.tick = 50;
            if (!settled) { h.jobs[0].resolve([{ tick: 1, text: '另一个现场的旧事' }]); await turn(); }
            h.injector.apply(); assert.ok(!h.state.output.includes('另一个现场的旧事'));
        }
    });
}

test('新查询失败恢复当前字面检索的全部额度，旧结果不复活', async () => {
    const world = ledger(Array.from({ length: 80 }, (_, i) => ({ id: `r${i}`, tick: i + 10, text: `beta 新话题经过第${i}件，字面检索的已有正文。` })));
    const h = harness({ text: 'alpha', world });
    h.injector.prefetchVectors(); h.jobs[0].resolve([{ tick: 1, text: '上一话题向量' }]); await turn();
    h.send('beta'); assert.equal(h.jobs.length, 2);
    h.jobs[1].reject(new Error('合成查询失败')); await turn();
    const failed = h.state.output;
    const literal = harness({ text: 'beta', world, enabled: false }); literal.injector.apply();
    assert.equal(failed, literal.state.output); assert.ok(!failed.includes('上一话题向量'));
});

test('空查询不发请求，关闭向量或召回时也不发请求', () => {
    for (const opts of [{ text: '' }, { enabled: false }, { recallOn: false }]) {
        const h = harness(opts); h.injector.prefetchVectors(); h.send(opts.text ?? '商队');
        assert.equal(h.jobs.length, 0);
    }
});

test('关闭和清空会废弃在途结果，不自动重新注入', async () => {
    for (const kind of ['vector', 'recall', 'clear']) {
        const h = harness(); h.injector.prefetchVectors();
        if (kind === 'vector') h.state.enabled = false;
        if (kind === 'recall') h.state.recallOn = false;
        if (kind === 'clear') h.injector.clear();
        const count = h.writes.length;
        h.jobs[0].resolve([{ tick: 1, text: '关闭后迟到的内容' }]); await turn();
        assert.equal(h.writes.length, count); assert.ok(!h.state.output.includes('关闭后迟到的内容'));
    }
});

test('向量命中的旧事也在字面候选中时，未选中的候选不能排除它', async () => {
    const old = { id: 'old-vector', tick: 1, text: '黄坤 alpha 只有向量选择的旧事' };
    const recent = Array.from({ length: 80 }, (_, i) => ({ id: `r${i}`, tick: i + 10, text: `黄坤 alpha 第${i}件新事经过，字面候选很多。` }));
    const h = harness({ text: '黄坤 alpha', world: ledger([old, ...recent], [{ id: 'e', name: '黄坤' }]) });
    h.injector.prefetchVectors(); h.jobs[0].resolve([{ ...old }]); await turn(); h.injector.apply();
    assert.equal(h.state.output.split(old.text).length - 1, 1, '向量旧事进入预算且不重复');
});

test('预算按命中数选择后，实际文本仍按已有轮次排版', () => {
    const rows = [{ id: 'new', tick: 99, text: 'alpha 较新记录' }, { id: 'old', tick: 1, text: 'alpha beta gamma 较旧记录' }];
    const h = harness({ text: 'alpha beta gamma', world: ledger(rows), enabled: false }); h.injector.apply();
    const text = h.state.output;
    assert.ok(text.indexOf('较旧记录') >= 0 && text.indexOf('较旧记录') < text.indexOf('较新记录'));
});

test('失败后重发同一问题可以重试，不把失败当成可复用结果', async () => {
    const h = harness(); h.send('商队'); h.jobs[0].reject(new Error('临时失败')); await turn();
    h.send('商队'); assert.equal(h.jobs.length, 2);
    h.jobs[1].resolve([{ tick: 1, text: '重试取回的商队旧事' }]); await turn();
    assert.ok(h.state.output.includes('重试取回的商队旧事'));
});

test('向量服务尚未就绪或同步失败后，同一查询仍能再次准备', async () => {
    for (const initial of ['missing', 'async-missing', 'throw']) {
        let ready = false, calls = 0, output = '';
        const world = ledger();
        const ctx = { chat: [{ is_user: true, mes: '商队' }], setExtensionPrompt: (key, value) => { if (key === INJECT_KEY_LEDGER) output = value; } };
        const injector = createInjector({ getCtx: () => ctx, getWorld: () => world, isOn: key => key === 'injectLedgerRecall', vectorRecall: () => {
            calls++;
            if (!ready) { if (initial === 'throw') throw new Error('尚未就绪'); return initial === 'async-missing' ? Promise.resolve(null) : null; }
            return Promise.resolve([{ tick: 1, text: '服务就绪后的商队旧事' }]);
        } });
        injector.prefetchVectors(); await turn(); ready = true; injector.prefetchVectors(); await turn();
        assert.equal(calls, 2); assert.ok(output.includes('服务就绪后的商队旧事'));
    }
});

test('与字面结果共用原行对象的向量重复项，不冒充向量实际选入条数', async () => {
    const old = { id: 'old', tick: 1, text: 'alpha beta gamma 旧事' };
    const h = harness({ text: 'alpha beta gamma', world: ledger([old, { id: 'new', tick: 99, text: 'alpha 新事' }]) });
    h.injector.prefetchVectors(); h.jobs[0].resolve([old]); await turn();
    assert.match(h.injector.apply().line, /字面 2 ＋ 向量 0/);
    assert.equal(h.state.output.split(old.text).length - 1, 1);
});

test('查询临时改变后恢复原文，被丢弃的已结束请求不能挡住重新准备', async () => {
    for (const fail of [false, true]) {
        const h = harness(); h.send('商队');
        h.ctx.chat[0].mes = '临时编辑为退婚';
        if (fail) h.jobs[0].reject(new Error('编辑期间失败'));
        else h.jobs[0].resolve([{ tick: 1, text: '编辑期间被丢弃的商队结果' }]);
        await turn(); h.ctx.chat[0].mes = '商队'; h.injector.prefetchVectors();
        assert.equal(h.jobs.length, 2);
        h.jobs[1].resolve([{ tick: 1, text: '重新获取的当前商队旧事' }]); await turn();
        assert.ok(h.state.output.includes('重新获取的当前商队旧事'));
    }
});

test('旧请求失配完成时，不能释放较新查询的进行中请求', async () => {
    for (const fail of [false, true]) {
        const h = harness(); h.send('商队'); h.send('退婚');
        if (fail) h.jobs[0].reject(new Error('旧商队请求失败'));
        else h.jobs[0].resolve([{ tick: 1, text: '旧商队结果' }]);
        await turn(); h.injector.prefetchVectors(); assert.equal(h.jobs.length, 2);
        h.jobs[1].resolve([{ tick: 2, text: '新婚约结果' }]); await turn();
        assert.ok(h.state.output.includes('新婚约结果'));
    }
});
