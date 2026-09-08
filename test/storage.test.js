// story-world-v2/test/storage.test.js
// K35 存储层（编排层，验收 A-9）：冷档轮转（超阈值→前置段入卷）/ 断链防线（milestones/causality 留热态）/
// 阅卷还原 / 导出导入往返一致（SHA-256 验签）；热账形状与纯函数性。
// 测试用内存 mock（store 注入面），与浏览器 IndexedDB 适配同接口。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PROPOSED_LIMITS, hotAccountShape, loadHotAccount,
    rotateChronicle, volumeToChronicleRows,
    buildExportBundle, verifyImportBundle,
} from '../src/storage.js';

// 合成世界：编年行按 tick 升序（settle 产出约定），带里程碑（断链防线探针）
function world({ ticks = 8, milestone = true } = {}) {
    const chronicle = [];
    for (let t = 0; t < ticks; t += 1) {
        chronicle.push({ id: `ch_${t}`, tick: t, text: `第 ${t} 轮的大事`, eventRef: t % 2 === 0 ? `ev_${t}` : '' });
    }
    const w = {
        version: 1,
        meta: { tick: ticks - 1 },
        context: { world: '测试州', tension: 0.5, positions: ['x'] },
        entities: [], weights: {}, agendas: [], events: [{ id: 'ev_0' }, { id: 'ev_2' }],
        chronicle,
        milestones: milestone ? [{ id: 'm_4', span: [0, 4], counts: 5, titles: ['起事'], ids: ['ev_0', 'ev_2'] }] : [],
    };
    return w;
}

function memStore() {
    const map = new Map();
    return {
        async list() { return [...map.values()].map((v) => ({ id: v.id, info: v.info })); },
        async put(v) { map.set(v.id, structuredClone(v)); },
        async get(id) { return map.has(id) ? structuredClone(map.get(id)) : null; },
    };
}

test('K35/A-9 未超阈值：零轮转，世界原样返回（引用不变）', () => {
    const w = world({ ticks: 8 });
    const { hot, volume } = rotateChronicle(w, { limits: { ticks: 500, bytes: 5 * 1024 * 1024 } });
    assert.equal(volume, null);
    assert.equal(hot, w); // 原样
    assert.equal(hot.chronicle.length, 8);
});

test('K35/A-9 tick 超阈值：前置段入卷，热账保留新段（旧去新留）', () => {
    const w = world({ ticks: 12 });
    const { hot, volume } = rotateChronicle(w, { limits: { ticks: 5, bytes: 5 * 1024 * 1024 }, volumeSeq: 1, now: '2026-09-08' });
    assert.ok(volume, '应产生卷');
    assert.equal(volume.id, '卷1');
    assert.ok(volume.info.includes('第 0–5 轮'));
    assert.equal(volume.rows.length, 6); // tick 0..5 入卷，跨度 5
    assert.equal(hot.chronicle.length, 6);
    assert.deepEqual(hot.chronicle.map((r) => r.tick), [6, 7, 8, 9, 10, 11]); // 热账=新段
});

test('K35/A-9 字节超阈值：按字节驱动轮转（KB 级小阈值注入）', () => {
    const w = world({ ticks: 6 });
    const limit = JSON.stringify(w.chronicle.slice(0, 2)).length; // 热账只容前 2 行
    const { hot, volume } = rotateChronicle(w, { limits: { ticks: 500, bytes: limit }, volumeSeq: 2 });
    assert.ok(volume);
    assert.equal(volume.id, '卷2');
    assert.ok(hot.chronicle.length <= 2);
    assert.ok(volume.bytes > 0);
});

test('K35/A-9 断链防线：轮转只割账本冗余——milestones/events 引用原样留热态，卷行深拷贝无共享', () => {
    const w = world({ ticks: 12 });
    const milestonesBefore = w.milestones;
    const eventsBefore = w.events;
    const { hot, volume } = rotateChronicle(w, { limits: { ticks: 5, bytes: 5 * 1024 * 1024 } });
    assert.equal(hot.milestones, milestonesBefore); // 同一引用=指针未断
    assert.equal(hot.events, eventsBefore);
    assert.deepEqual(hot.milestones, [{ id: 'm_4', span: [0, 4], counts: 5, titles: ['起事'], ids: ['ev_0', 'ev_2'] }]);
    // 卷行与热账无共享（改卷不改热）
    volume.rows[0].text = '篡改';
    assert.notEqual(w.chronicle[0].text, '篡改');
    // 纯函数：入参世界未被改
    assert.equal(w.chronicle.length, 12);
});

test('K35/A-9 阅卷还原：volumeToChronicleRows 与原行逐条一致（tick/text/eventRef）', () => {
    const w = world({ ticks: 12 });
    const { volume } = rotateChronicle(w, { limits: { ticks: 5, bytes: 5 * 1024 * 1024 } });
    const rows = volumeToChronicleRows(volume);
    assert.equal(rows.length, volume.rows.length);
    assert.deepEqual(rows[0], { tick: 0, text: '第 0 轮的大事', eventRef: 'ev_0' });
    assert.deepEqual(rows[5], { tick: 5, text: '第 5 轮的大事', eventRef: '' });
    assert.equal(volumeToChronicleRows(null).length, 0);
});

test('K35/A-9 空编年：零轮转不炸', () => {
    const bare = world({ ticks: 0 });
    const { hot, volume } = rotateChronicle(bare, { limits: { ticks: 1, bytes: 1 } });
    assert.equal(volume, null);
    assert.equal(hot, bare);
});

test('K35/A-9 导出导入往返一致：世界与卷逐字段一致（深等），摘要匹配', async () => {
    const w = world({ ticks: 12 });
    const { hot, volume } = rotateChronicle(w, { limits: { ticks: 5, bytes: 5 * 1024 * 1024 } });
    const { json, digest } = await buildExportBundle(hot, [volume], { chatId: 'chat-1', exportedAt: '2026-09-08T00:00:00Z' });
    assert.equal(digest.length, 64);
    const parsed = JSON.parse(json);
    assert.equal(parsed.format, 'story-world-v2-export');
    assert.equal(parsed.chatId, 'chat-1');
    assert.equal(parsed.volumes.length, 1);
    const res = await verifyImportBundle(json);
    assert.equal(res.ok, true);
    assert.deepEqual(res.world, hot);
    assert.deepEqual(res.volumes, [volume]);
});

test('K35/A-9 验签防线：正文被篡改 → 拒收（摘要不符）', async () => {
    const w = world({ ticks: 12 });
    const { hot, volume } = rotateChronicle(w, { limits: { ticks: 5, bytes: 5 * 1024 * 1024 } });
    const { json } = await buildExportBundle(hot, [volume]);
    const tampered = JSON.parse(json);
    tampered.world.chronicle[0].text = '偷梁换柱';
    const res = await verifyImportBundle(JSON.stringify(tampered));
    assert.equal(res.ok, false);
    assert.match(res.error, /摘要不符/);
});

test('K35/A-9 形状防线：非 JSON / 格式错 / 缺字段均拒收', async () => {
    assert.equal((await verifyImportBundle('not json')).ok, false);
    assert.equal((await verifyImportBundle('{}')).ok, false);
    assert.equal((await verifyImportBundle(JSON.stringify({ format: 'other', version: 1, world: {}, volumes: [] }))).ok, false);
    const { json } = await buildExportBundle(world({ ticks: 3 }), []);
    const parsed = JSON.parse(json);
    delete parsed.world;
    const res = await verifyImportBundle(JSON.stringify({ ...parsed, digest: (await buildExportBundle(world({ ticks: 3 }), [])).digest }));
    assert.equal(res.ok, false);
    assert.match(res.error, /缺少世界数据/);
});

test('K35 热账：hotAccountShape/loadHotAccount 往返一致；坏形状 → null', () => {
    const w = world({ ticks: 3 });
    const meta = hotAccountShape(w);
    assert.equal(meta.format, 'story-world-v2-hot');
    assert.deepEqual(loadHotAccount(meta), w);
    assert.equal(loadHotAccount(null), null);
    assert.equal(loadHotAccount({ format: 'x', version: 1, world: {} }), null);
    assert.equal(loadHotAccount({ format: 'story-world-v2-hot', version: 1 }), null);
});

test('K35 store 注入面：内存 mock 与阅卷/清单契约一致（浏览器 IndexedDB 适配同接口）', async () => {
    const store = memStore();
    assert.deepEqual(await store.list(), []);
    const w = world({ ticks: 12 });
    const { volume } = rotateChronicle(w, { limits: { ticks: 5, bytes: 5 * 1024 * 1024 } });
    await store.put(volume);
    const list = await store.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, '卷1');
    assert.ok(list[0].info.length > 0);
    const got = await store.get('卷1');
    assert.deepEqual(got, volume);
    assert.equal(await store.get('不存在'), null);
});