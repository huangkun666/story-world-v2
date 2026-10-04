import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmbedRuntime } from '../web/embed-runtime.js';
import { makeVectorRecall } from '../web/settings-channels.js';

// 真装配回归：聊天要搜全账，不能把 floor: 0 错当成“关闭窗口”。
for (const archived of [false, true]) {
    test(`聊天向量召回覆盖已索引的全账（${archived ? '含归档卷' : '全部在热账'}）`, async () => {
        const rows = Array.from({ length: 6 }, (_, i) => ({
            id: `ch_${i + 1}_1`, tick: i + 1, text: `甲在第${i + 1}轮办事`, kind: 'state',
        }));
        const world = { meta: { tick: 6 }, chronicle: archived ? rows.slice(3) : rows };
        const volumes = archived ? [{ rows: rows.slice(0, 3) }] : [];
        let disk = null;
        const runtime = createEmbedRuntime({
            indexStore: { load: async () => disk, save: async (value) => { disk = value; } },
            client: { embed: async (texts) => texts.map(() => [1, 0]) },
            signature: { model: 'fixture', dims: 2 }, windowTurns: () => 3,
        });
        await runtime.stepForTick({ world, volumes, floor: 7, maxItemsPerTurn: 10 });
        assert.equal(disk.ids.length, 6, '前提：六条都已有向量');
        const recall = makeVectorRecall({
            getCtx: () => ({}), getWorld: () => world, getRuntime: () => runtime,
            getVolumes: () => volumes, queryTextOf: () => '甲办事', params: { top: 6 },
        });
        const result = await recall();
        assert.equal(result.report.candidates, 6, '聊天全账口不能套世界模型的近期窗口');
        assert.deepEqual(result.items.map((row) => row.tick).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
    });
}
