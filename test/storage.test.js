// story-world-v2/test/storage.test.js
// K35 存储层（编排层，验收 A-9）：冷档轮转（超阈值→前置段入卷）/ 断链防线（milestones/causality 留热态）/
// 阅卷还原 / 导出导入往返一致（SHA-256 验签）；热账形状与纯函数性。
// 测试用内存 mock（store 注入面），与浏览器 IndexedDB 适配同接口。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PROPOSED_LIMITS, hotAccountShape, loadHotAccount,
    rotateChronicle, planChronicleRotation, countLedgerEntries, volumeToChronicleRows,
    buildExportBundle, verifyImportBundle,
} from '../src/storage.js';

// 合成世界：编年行按 tick 升序（settle 产出约定），带里程碑（断链防线探针）
// gap = 每行 tick 间隔（审计修复 E1 的测试补注：轮转判据是**跨度**且生产阈值 500 轮，
//   要真跑出「连续两次轮转」必须 gap×行数 远大于 500——gap 缺省 1 = 既有用例口径，零扰动）。
function world({ ticks = 8, milestone = true, gap = 1 } = {}) {
    const chronicle = [];
    for (let t = 0; t < ticks; t += 1) {
        chronicle.push({ id: `ch_${t}`, tick: t * gap, text: `第 ${t} 轮的大事`, eventRef: t % 2 === 0 ? `ev_${t}` : '' });
    }
    const w = {
        version: 1,
        meta: { tick: (ticks - 1) * gap },
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

// ============ 审计修复 E1（真缺陷·数据丢失）：冷档卷号必须延续，第二卷不许覆盖第一卷 ============
// 旧缺陷：volumeSeq 缺省恒 1（storage.js:60/79），生产唯一调用点 web/index.js 从不传 → 第二次轮转
// 写同一个 `chatId:卷1` 键覆盖前一卷，而热账前置段已被真的剥掉=那段编年永久消失。
// mock store 与 idb-backend 的键构造同构（key = `${ns}${volume.id}`）→ 键冲突可被断言抓到。
function keyedMemStore(ns) {
    const map = new Map();
    return {
        map,
        async list() { return [...map.values()].map((v) => ({ id: v.id, info: v.info })); },
        async put(v) { map.set(`${ns}${v.id}`, structuredClone(v)); },
        async get(id) { return map.has(`${ns}${id}`) ? structuredClone(map.get(`${ns}${id}`)) : null; },
    };
}

const ROT_LIMITS = { ticks: 5, bytes: 5 * 1024 * 1024 };

// 生产形状的编年世界：12 行 × 间隔 50 轮 = 跨度 550 轮 > 阈值 500 → 真的该轮转。
// 割法（storage.js splitOffOldest，生产缺省阈值）：割到「热账跨度 ≤ 500」为止——
//   去掉最旧的 1 行（tick 0）后，剩余 11 行跨度正好 500 = 达标 → 卷1 = 1 行，热账留 11 行。
//（为什么用 world({gap: 50}) 而不是小阈值注入：planChronicleRotation 走的是**生产缺省阈值**，
//  这正是 web/index.js 的调用形态——用生产数字验生产行为。）
function rotWorld() { return world({ ticks: 12, gap: 50 }); }

// 「又跑了一段」：给已剥过段的热账补上若干行新编年（每行间隔 50 轮），凑足下一次轮转
function grownWorld(hot, count, startId) {
    const extra = [];
    const lastTick = hot.chronicle.length ? hot.chronicle[hot.chronicle.length - 1].tick : 0;
    for (let i = 1; i <= count; i += 1) extra.push({ id: `ch_${startId + i}`, tick: lastTick + i * 50, text: `第 ${startId + i} 轮的大事` });
    return { ...hot, chronicle: [...hot.chronicle, ...extra] };
}

test('E1 卷号延续：同一 world 连续两次轮转 → 两个不同 id 的卷 + 卷库两次写入不同键（不覆盖）', async () => {
    const store = keyedMemStore('chat-1:');
    const w = rotWorld();

    // 第一次：热账（无计数=旧账形态）→ 卷1
    const p1 = planChronicleRotation({ world: w, nextVolume: undefined, volumes: await store.list() });
    assert.equal(p1.volume.id, '卷1');
    assert.equal(p1.volume.rows.length, 1, '割掉最旧 1 行（tick 0；去掉它后热账跨度正好 500=达标）');
    assert.equal(p1.hot.chronicle.length, 12, 'E2 执行序：plan.hot = **未剥段**原世界（写失败时的安全态）');
    assert.equal(p1.applied.chronicle.length, 11, '剥段后的世界在 applied——旧实现在这里就把这 1 行永久丢了');
    await store.put(p1.volume);
    const meta1 = hotAccountShape(p1.applied);
    assert.equal(meta1.nextVolume, 2, '热账记下下一卷号');

    // 第二次：热账续上新编年（模拟又跑了两轮）→ 又超阈值 → 卷2
    const grown = { ...grownWorld(p1.applied, 2, 12), nextVolume: meta1.nextVolume };
    const p2 = planChronicleRotation({ world: grown, nextVolume: meta1.nextVolume, volumes: await store.list() });
    assert.ok(p2.volume, '第二次也应产生卷（补两行后跨度 600 又超阈值 500）');
    assert.equal(p2.volume.id, '卷2');
    assert.equal(hotAccountShape(p2.applied).nextVolume, 3);
    await store.put(p2.volume);

    const keys = [...store.map.keys()];
    assert.deepEqual(keys, ['chat-1:卷1', 'chat-1:卷2'], '两次写入不同键（旧实现两次都是 chat-1:卷1）');
    assert.equal(store.map.size, 2, '两卷都在盘上=第一卷没被覆盖');
    assert.notDeepEqual((await store.get('卷1')).rows, (await store.get('卷2')).rows, '两卷内容互不相同');
    // 全部编年仍在（卷1 + 卷2 + 热账）——一段都没消失
    // 判据是**搬家不是删除**：轮转只把行从热账搬进卷，总行数必须等于「原始 + 新增」。
    // （原断言写 13 是算错了：12 行起始 + grownWorld 补 2 行 = 14；实测 1 + 2 + 11 = 14。）
    assert.equal((await store.get('卷1')).rows.length + (await store.get('卷2')).rows.length + p2.applied.chronicle.length, 14);
});

test('E1 跨「重新加载」延续：热账 → loadHotAccount 读回计数 → 再轮转接号（卷3），不回头覆盖', async () => {
    const store = keyedMemStore('chat-9:');
    const w = rotWorld();

    const p1 = planChronicleRotation({ world: w });
    await store.put(p1.volume);
    const grown1 = { ...grownWorld(p1.applied, 2, 12), nextVolume: 2 };
    const p2 = planChronicleRotation({ world: grown1, nextVolume: hotAccountShape(p1.applied).nextVolume, volumes: await store.list() });
    await store.put(p2.volume);
    assert.deepEqual([...store.map.keys()], ['chat-9:卷1', 'chat-9:卷2']);

    // 模拟页面刷新：盘上热账（chat metadata 形状）→ 读回世界
    const meta = hotAccountShape(grownWorld(p2.applied, 2, 14));
    const worldAfterReload = loadHotAccount(structuredClone(meta));
    assert.equal(worldAfterReload.nextVolume, 3, '计数随热账跨刷新延续（旧账零扰动：无该字段才是 1）');

    const p3 = planChronicleRotation({ world: worldAfterReload, nextVolume: worldAfterReload.nextVolume, volumes: await store.list() });
    assert.equal(p3.volume.id, '卷3');
    await store.put(p3.volume);
    assert.deepEqual([...store.map.keys()], ['chat-9:卷1', 'chat-9:卷2', 'chat-9:卷3']);
});

test('E1 旧账兜底：无 nextVolume 字段但盘上已有卷 → 用卷库清单校正，绝不回头覆盖（旧账零扰动）', async () => {
    const store = keyedMemStore('old:');
    const w = rotWorld();
    // 存量账：盘上已有 卷1、卷2、卷5（跳号）——旧实现卷号恒 1，下一次轮转会写回 卷1 覆盖
    const a = planChronicleRotation({ world: w });
    await store.put(a.volume);
    const b = planChronicleRotation({ world: grownWorld(a.applied, 2, 12), nextVolume: hotAccountShape(a.applied).nextVolume, volumes: await store.list() });
    assert.ok(b.volume, '第二卷该产生');
    await store.put(b.volume);
    await store.put({ ...b.volume, id: '卷5', info: '历史卷' });   // 卷号跳号
    assert.deepEqual([...store.map.keys()], ['old:卷1', 'old:卷2', 'old:卷5']);

    // 旧账热账（无 nextVolume）→ 读回 1；校正后接 卷4（清单 3 卷 → 3+1，卷号接着排，不回头）
    const oldMeta = { format: 'story-world-v2-hot', version: 1, savedAt: '2026-01-01T00:00:00.000Z', world: { ...grownWorld(b.applied, 2, 14), nextVolume: undefined } };
    assert.equal(loadHotAccount(oldMeta).nextVolume, undefined);
    const plan = planChronicleRotation({ world: loadHotAccount(oldMeta), nextVolume: undefined, volumes: await store.list() });
    assert.equal(plan.volumeSeq, 4, '清单 3 卷 → 4（卷号接着排，不回头）');
    assert.equal(plan.volume.id, '卷4');
    assert.equal((await store.get('卷1')).rows[0].text, '第 0 轮的大事', '第一卷原样未被覆盖');
});

test('E1 热账形状：nextVolume 随 hotAccountShape 落账并可读回；缺省/非法值 → 1（旧账零扰动）', () => {
    const w = world({ ticks: 3 });
    assert.equal(hotAccountShape(w).nextVolume, 1);                       // 世界无该字段 → 1
    assert.equal(hotAccountShape({ ...w, nextVolume: 7 }).nextVolume, 7);
    assert.equal(hotAccountShape({ ...w, nextVolume: 0 }).nextVolume, 1); // 非法 → 1
    assert.equal(hotAccountShape({ ...w, nextVolume: -3 }).nextVolume, 1);
    assert.equal(hotAccountShape({ ...w, nextVolume: 'x' }).nextVolume, 1);
    // 旧账（无该字段的 meta）仍可读回世界本身——读取面零扰动
    assert.equal(loadHotAccount({ format: 'story-world-v2-hot', version: 1, world: w }), w);
});

test('E1 未超阈值：不轮转、不占卷号（nextVolume 不动）', async () => {
    const w = { ...world({ ticks: 3 }), nextVolume: 4 };
    const plan = planChronicleRotation({ world: w, nextVolume: 4, volumes: [] });
    assert.equal(plan.mustRotate, false);
    assert.equal(plan.volume, null);
    assert.equal(plan.hot, w, '无轮转=世界原引用返回（零扰动）');
    assert.equal(plan.hot.nextVolume, 4);
});

// ============ 审计修复 E2（真缺陷·静默失败）：卷库写成功之前绝不返回剥了段的热账 ============
test('E2 执行序纪律：卷库 put 抛错 → 计划仍是未剥段的原世界（调用方据此上报失败、不许报成功）', async () => {
    const store = keyedMemStore('boom:');
    store.put = async () => { throw new Error('IDB 写入失败'); };
    const w = rotWorld();
    const plan = planChronicleRotation({ world: w, nextVolume: 1, volumes: [] });
    assert.equal(plan.mustRotate, true, '该轮转（编年跨度 550 轮 > 阈值 500）');
    assert.equal(plan.volume.id, '卷1');
    await assert.rejects(() => store.put(plan.volume), /IDB 写入失败/);
    // 关键：写入失败后，热账候选必须是**原世界**——前置段还在编年里（编年完整）
    assert.equal(plan.hot.chronicle.length, 12, '热账候选未剥段（须等 put 成功才允许用 plan.hot 覆盖热账）');
    assert.equal(plan.volume.rows.length, 1, '本该入卷的 1 行也还在热账里（不是被剥掉）');
    assert.equal(plan.hot.chronicle.length, plan.volume.rows.length + w.chronicle.length - 1, '热账=全部 12 行（未剥段）');
    assert.equal(w.chronicle.length, 12, '入参世界未被改（纯函数）');
});

// ============ 审计修复 E4（真缺陷·只入内存不入盘）：名册入账的「账本真变了」判据面 ============
test('E4 判据面：countLedgerEntries 只看实体/权重/编年——seedBookEntities 真的加了实体与权重就变大', () => {
    const w = world({ ticks: 3 });
    assert.equal(countLedgerEntries(w), w.chronicle.length, '空账：只有编年');
    const after = { ...w, entities: [{ id: 'e_bk_1', kind: 'faction', name: '甲' }], weights: { e_bk_1: 0.75 } };
    assert.equal(countLedgerEntries(after), w.chronicle.length + 2, '实体 +1、权重 +1 → 计数 +2');
    assert.equal(countLedgerEntries(null), 0);
    assert.equal(countLedgerEntries({}), 0);
});