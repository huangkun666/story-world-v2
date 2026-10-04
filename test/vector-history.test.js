import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmbedRuntime } from '../web/embed-runtime.js';
const row = (tick, text = `历史${tick}`) => ({ id: `c${tick}`, tick, text });
function setup() {
    let disk = null, fail = false;
    const store = { load: async () => disk, save: async v => { if (fail) throw Error('disk'); disk = structuredClone(v); } };
    const rt = createEmbedRuntime({ indexStore: store, signature: { model: 'demo', dims: 2 }, client: { embed: async texts => texts.map(() => [1, 0]) } });
    return { rt, store, disk: () => disk, fail: v => { fail = v; } };
}
test('补齐最早缺口，连续完成指针不能越过未完成条目', async () => {
    const { rt, disk } = setup();
    const world = { meta: { tick: 120 }, chronicle: [row(30), row(31), row(70), row(71)] };
    await rt.stepForTick({ world, floor: 71, maxItemsPerTurn: 1 });
    assert.deepEqual(disk().tickByIndex, [30]);
    assert.equal(disk().completedThrough, 30);
    await rt.stepForTick({ world, floor: 71, maxItemsPerTurn: 10 });
    assert.deepEqual(disk().tickByIndex, [30, 31, 70]);
    assert.equal(disk().completedThrough, 70);
});
test('失败落盘不会把进度算成完成，下一次继续补齐', async () => {
    const { rt, disk, fail } = setup(); const world = { meta: { tick: 60 }, chronicle: [row(1)] };
    fail(true); await rt.stepForTick({ world, floor: 10 }); assert.equal(disk(), null);
    fail(false); await rt.stepForTick({ world, floor: 10 }); assert.equal(disk().completedThrough, 9);
});
test('恢复旧快照后未来、同ID异文与未证实旧卷均不能作为候选', async () => {
    const { rt } = setup(); const world = { meta: { tick: 100 }, chronicle: [row(1, '旧分支'), row(80)] };
    await rt.stepForTick({ world, floor: 90 });
    const old = { meta: { tick: 20 }, chronicle: [row(1, '新分支')] };
    await rt.restoreHistory(old, null);
    const result = await rt.recallForTick({ ssot: old, floor: 21, queryText: '查询', volumes: [{ rows: [row(2, '未证实旧卷'), row(80)] }] });
    assert.ok(!result || result.items.length === 0);
    await rt.stepForTick({ world: old, floor: 21, volumes: [{ rows: [row(2)] }] });
    const got = await rt.recallForTick({ ssot: old, floor: 21, queryText: '查询', volumes: [{ rows: [row(2)] }] });
    assert.deepEqual(got.items.map(x => x.text), ['新分支']);
});
test('快照已记录的旧卷可以复用，恢复时仍排除未来', async () => {
    const { rt } = setup(); const world = { meta: { tick: 20 }, chronicle: [row(10)] }, vols = [{ rows: [row(1)] }];
    await rt.stepForTick({ world, floor: 11, volumes: vols });
    const history = await rt.captureHistory(world, vols);
    await rt.restoreHistory(world, history);
    const result = await rt.recallForTick({ ssot: world, floor: 21, queryText: '查询', volumes: [{ rows: [row(1), row(80)] }] });
    assert.deepEqual(result.items.map(x => x.tick), [10, 1]);
});
