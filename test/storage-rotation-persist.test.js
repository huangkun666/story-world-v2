// story-world-v2/test/storage-rotation-persist.test.js
// 审计修复 E1/E2/E4 的编排执行序面（编排层，web/index.js 浏览器侧；本文件在 Node 侧如实重演
// 同一执行序——浏览器模块顶层零 DOM 但 loadWorld 内部要摸 document/ST ctx，无法在 Node 里整条
// 跑，所以这里用**同一批 src/storage.js 原函数**（planChronicleRotation / hotAccountShape /
// loadHotAccount / countLedgerEntries）+ 与 web/idb-backend.js 键构造同构的 mock 卷库 +
// 与 web/index.js 同形的热账读写注入面（fake chat ctx）把执行序跑一遍，断言落在可验证的事实上：
//   ①卷号延续（两卷不同键，第二卷不覆盖第一卷；跨「重新加载」接号；旧账兜底不回头）
//   ②卷库写失败 → 热账不剥段（编年完整没丢），且失败必须能被上报（编年长度可查=可判定）
//   ③名册入账变没变的判据 + 落盘路径（fake ctx 断言 updateChatMetadata / saveChat 真被调用）
//   ④web/index.js 可加载（模块顶层零 DOM 守卫不破，捕获语法/顶层雷）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    hotAccountShape, loadHotAccount, planChronicleRotation, countLedgerEntries,
} from '../src/storage.js';
import { seedBookEntities } from '../src/abstract.js';
import { seedAndBackfill } from '../web/index.js';

const LIMITS = { ticks: 5, bytes: 5 * 1024 * 1024 };

// 合成世界（**生产形状**：缺口 50 轮/行，12 行 → 编年跨度 550 轮）。
// 为什么这么造：生产阈值就是 500 轮（PROPOSED_LIMITS.ticks），而轮转的判据是**跨度**——
//   跨度≤500 的世界根本不该轮转（storage.js splitOffOldest 保底热账至少留一行）。
//   要把「连续两次轮转」真的跑出来，编年必须长到第一刀割完仍超阈值（缺口 20 → 割完剩 200
//   就不该再割了，那是引擎正确行为；缺口 50 → 割完剩 9 行跨度 400，仍然超阈值=该再割）。
function world({ ticks = 12, gap = 50 } = {}) {
    const chronicle = [];
    for (let t = 0; t < ticks; t += 1) chronicle.push({ id: `ch_${t}`, tick: t * gap, text: `第 ${t} 轮的大事`, eventRef: t % 2 === 0 ? `ev_${t}` : '' });
    return {
        version: 1,
        meta: { tick: (ticks - 1) * gap },
        context: {
            world: '测试州', tension: 0.5, positions: ['未明'],
            setting: { frozen: { canon: { bookEntities: [
                { name: '甲宗', kind: 'faction' },
                { name: '乙堂', kind: 'faction', parent: '甲宗' },
                { name: '丙', kind: 'character', parent: '乙堂' },
                { name: '丁', kind: 'character' },
            ] } } },
        },
        entities: [], weights: {}, agendas: [], events: [], chronicle, milestones: [],
    };
}

// mock 卷库：键构造与 web/idb-backend.js put 逐字同构（`${chatId}:${volume.id}`）
function keyedStore(ns = 'chat-1:') {
    const map = new Map();
    return {
        map,
        async list() { return [...map.values()].map((v) => ({ id: v.id, info: v.info })); },
        async put(v) { map.set(`${ns}${v.id}`, structuredClone(v)); },
        async get(id) { return map.has(`${ns}${id}`) ? structuredClone(map.get(`${ns}${id}`)) : null; },
    };
}

// fake chat ctx：与 web/index.js 的热账读写面同形（chatMetadata / updateChatMetadata / saveMetadataDebounced / saveChat）
function makeCtx(w0) {
    const calls = { update: 0, save: 0 };
    let chatMetadata = w0 ? { story_world_v2: hotAccountShape(w0) } : {};
    let saveChatImpl = async () => {};
    return {
        calls,
        get chatMetadata() { return chatMetadata; },
        updateChatMetadata(patch) { calls.update += 1; chatMetadata = { ...chatMetadata, ...patch }; },
        saveMetadataDebounced() {},
        async saveChat() { calls.save += 1; return saveChatImpl(); },
        failSaveChat(fn) { saveChatImpl = fn; },
        // 「重新加载」：从盘面形状读回世界（照 web/index.js 的 readHotMeta + loadHotAccount 双形）
        readWorld() { return loadHotAccount(chatMetadata.story_world_v2); },
    };
}

// web/index.js ensureChronicleRotated 的执行序（同一批 storage 原函数的同序调用）：
//   读计数 → 读卷库清单（未轮转也写回热账）→ 规划 → 必须先 put 成功才允许用**剥段后的 applied**覆盖热账。
//   E2 语义（planChronicleRotation）：plan.hot = 未剥段原世界（写失败时的安全态）；plan.applied = 剥段后。
async function ensureRotated(ctx, store, world_) {
    const nextVolume = ctx.chatMetadata?.story_world_v2?.nextVolume;
    let volumes;
    try {
        volumes = await store.list();
    } catch (err) {
        return { ok: false, hot: world_, error: `卷库不可读：${err?.message || err}` };
    }
    const plan = planChronicleRotation({ world: world_, nextVolume, volumes });
    if (!plan.mustRotate) {
        ctx.updateChatMetadata({ story_world_v2: hotAccountShape(world_) });
        return { ok: true, hot: world_, volume: null };
    }
    try {
        await store.put(plan.volume);
    } catch (err) {
        return { ok: false, hot: world_, error: `卷「${plan.volume.id}」入卷失败：${err?.message || err}` };
    }
    ctx.updateChatMetadata({ story_world_v2: hotAccountShape(plan.applied) });
    return { ok: true, hot: plan.applied, volume: plan.volume };
}

// web/index.js loadWorld 的名册入账段（E4）：只在账本真变了时写回 + flushHotMeta（saveChat）落盘
async function seedAndPersist(ctx, hot) {
    const before = countLedgerEntries(hot);
    const seed = seedBookEntities(hot);
    const seededDelta = countLedgerEntries(hot) - before;
    let flushed = false;
    if (seed.seeded > 0 || seededDelta > 0) {
        ctx.updateChatMetadata({ story_world_v2: hotAccountShape(hot) });
        flushed = await ctx.saveChat().then(() => true, () => false);
    }
    return { seed, seededDelta, flushed };
}

// 「又跑了一段」：给已剥段的热账补新编年（每行间隔 50 轮）——轮转是"跨度超阈值"驱动的，
// 一段编年割完就达标了，不会自己再割一次；要跑出第二次轮转必须真有新内容长出来。
function grow(hot, count, startId) {
    const last = hot.chronicle.length ? hot.chronicle[hot.chronicle.length - 1].tick : 0;
    const extra = [];
    for (let i = 1; i <= count; i += 1) extra.push({ id: `ch_${startId + i}`, tick: last + i * 50, text: `第 ${startId + i} 轮的大事` });
    return { ...hot, chronicle: [...hot.chronicle, ...extra], meta: { ...hot.meta, tick: last + count * 50 } };
}

test('E1 生产链：连续两次轮转 → 卷1/卷2 两个不同键写入，第二卷不覆盖第一卷', async () => {
    const ctx = makeCtx(world());
    const store = keyedStore('chat-1:');

    // 第一次载入：热账无 nextVolume（旧账形态）→ 卷1
    const w1 = ctx.readWorld();
    const r1 = await ensureRotated(ctx, store, w1);
    assert.equal(r1.ok, true);
    assert.equal(r1.volume.id, '卷1');
    assert.equal(ctx.chatMetadata.story_world_v2.nextVolume, 2, '卷号计数落进热账形状（跨刷新延续的载体）');

    // 中间真的又跑了一段：热账补 2 行（跨度再超阈值）
    const w2 = grow(ctx.readWorld(), 2, 12);
    ctx.updateChatMetadata({ story_world_v2: hotAccountShape(w2) });
    const w2reload = ctx.readWorld();
    assert.equal(w2reload.nextVolume, 2, '重新加载读回计数');
    const r2 = await ensureRotated(ctx, store, w2reload);
    assert.equal(r2.ok, true);
    assert.equal(r2.volume.id, '卷2');

    assert.deepEqual([...store.map.keys()], ['chat-1:卷1', 'chat-1:卷2'], '两次轮转写两个不同键（旧实现两次都写 chat-1:卷1=覆盖）');
    assert.equal(store.map.size, 2, '两卷都在盘上');
    // 搬家不是删除：卷1 + 卷2 + 热账 = 起始 12 行 + 新增 2 行
    assert.equal((await store.get('卷1')).rows.length + (await store.get('卷2')).rows.length + r2.hot.chronicle.length, 14);
});

test('E2 卷库写失败：failure 被上报 + 热账未剥段（编年仍完整，没有「内存改了盘上没写」）', async () => {
    const ctx = makeCtx(world());
    const store = keyedStore('chat-2:');
    store.put = async () => { throw new Error('IDB 写入失败'); };

    const w = ctx.readWorld();
    const before = ctx.calls.update;
    const r = await ensureRotated(ctx, store, w);

    assert.equal(r.ok, false, '失败必须显式回执（旧实现 catch 掉异常返回原世界，调用方当成功继续报「已同步」）');
    assert.match(r.error, /入卷失败.*IDB 写入失败/, '失败原因带上卷号与底层错误（状态条可读）');
    // 「未剥段」的严格口径：此刻若真按计划剥了段，编年只剩 applied.chronicle.length 行
    //（本 fixture：12 行 → 割 1 行入卷 / 剥段后 11 行）——断言现在是**完整 12 行**，
    // 即那段编年没被剥掉、也就没被丢。
    const planned = planChronicleRotation({ world: w, nextVolume: 1, volumes: [] });
    assert.ok(planned.mustRotate && planned.volume.rows.length === 1, '前置段确实该入卷（1 行）');
    assert.equal(planned.hot.chronicle.length, 12, 'E2 语义：plan.hot = 未剥段原世界（安全态）');
    assert.equal(planned.applied.chronicle.length, 11, 'E2 语义：plan.applied = 剥段后的世界（仅在 put 成功后提交）');
    assert.equal(r.hot.chronicle.length, 12, '热账未剥段：编年完整保留（不是剥剩的 11 行）');
    assert.notEqual(r.hot.chronicle.length, planned.applied.chronicle.length, '与剥段后的热账不同=确实没剥');
    assert.equal(ctx.readWorld().chronicle.length, 12, '盘上热账同样完整（未被剥段覆盖=那段编年不会永久消失）');
    assert.equal(ctx.calls.update, before, '失败路径零热账写（不做半截写）');
    assert.equal(store.map.size, 0, '卷库没有半截卷');
});

test('E2 卷库不可读：同样如实上报、不剥段', async () => {
    const ctx = makeCtx(world());
    const store = keyedStore('chat-3:');
    store.list = async () => { throw new Error('IndexedDB 不可用'); };
    const plan = planChronicleRotation({ world: ctx.readWorld(), nextVolume: 1, volumes: [] });
    const r = await ensureRotated(ctx, store, ctx.readWorld());
    assert.equal(r.ok, false);
    assert.match(r.error, /卷库不可读/);
    assert.equal(r.hot.chronicle.length, 12);
    assert.notEqual(r.hot.chronicle.length, plan.applied.chronicle.length);
});

test('E4 名册入账：账本真变了 → 写回热账并落盘（fake ctx 断言 updateChatMetadata / saveChat 被调用）', async () => {
    const ctx = makeCtx(world());
    const hot = ctx.readWorld();
    const r = await seedAndPersist(ctx, hot);

    assert.equal(r.seed.seeded, 3, '名册入账：甲宗 + 丙 + 丁（乙堂折叠进甲宗麾下，不建实体）');
    assert.equal(r.seededDelta, 6, '账本计数增量 = 实体 +3 与权重 +3');
    assert.equal(hot.entities.length, 3);
    assert.equal(Object.keys(hot.weights).length, 3);
    assert.equal(ctx.calls.update, 1, 'updateChatMetadata 被调用（名册入账写回热账内存）');
    assert.equal(ctx.calls.save, 1, 'saveChat 被调用=真落盘（旧实现只 push 内存，纯观察不推进的聊天永远落不了盘）');
    assert.equal(ctx.readWorld().entities.length, 3, '盘上热账含名册实体（导出也随之不再少账）');
});

test('E4 幂等：第二次 loadWorld 名册无新增 → 零写盘（不产生无谓写）', async () => {
    const ctx = makeCtx(world());
    const hot = ctx.readWorld();
    await seedAndPersist(ctx, hot);
    const updateBefore = ctx.calls.update;
    const saveBefore = ctx.calls.save;

    const r2 = await seedAndPersist(ctx, hot);   // 同一世界再走一次 loadWorld 的入账段
    assert.equal(r2.seed.seeded, 0, '名册幂等：无新实体');
    assert.equal(r2.seededDelta, 0, '账本计数未变');
    assert.equal(r2.flushed, false);
    assert.equal(ctx.calls.update, updateBefore, '没变就不写热账');
    assert.equal(ctx.calls.save, saveBefore, '没变就不落盘');
    assert.equal(ctx.readWorld().entities.length, 3, '盘上仍是 3 实体（未被空写扰动）');
});

test('E4 落盘失败如实可见：saveChat 抛错 → flushed=false（不谎报成功）', async () => {
    const ctx = makeCtx(world());
    ctx.failSaveChat(() => { throw new Error('saveChat 失败'); });
    const r = await seedAndPersist(ctx, ctx.readWorld());
    assert.equal(r.seed.seeded, 3);
    assert.equal(r.flushed, false, '落盘失败 → 确认位 false（web 侧据此上状态条/控制台）');
});

// ============ 第二十五棒 e：名册落账**可重入**（挂世界加载，补已建好的世界）============
// 病根：老世界的账是**当年那份代码**建的（leg24 后只搬 name/kind）⇒ 归属/档位/规模那块永远缺，
//   而账是持久化的、没有重入点 ⇒ 缺一辈子。治法：把这一步做成幂等可重入，挂在 worldLoad 上。
// 安全性质（本组三条锁）：只填空栏 + 不新建实体 + 不碰世界进度 + 幂等（第二次零变化）。
function oldWorld() {
    // 「老代码建的世界」：实体在册，但**没有任何 parent/实力/规模**（leg24 后的账就是这个形状）
    return {
        version: 1,
        meta: { tick: 42, simLog: [{ tick: 42, warnings: [] }] },
        context: {
            world: '测试州', tension: 0.5, positions: ['未明'],
            setting: { frozen: { canon: { bookEntities: [
                { name: '昆仑道宫', kind: 'faction' },
                { name: '清玄真人', kind: 'character' },
                { name: '散修甲', kind: 'character' },
                { name: '玄一道祖', kind: 'character' },
            ] } } },
        },
        entities: [
            { id: 'e_bk_1', kind: 'faction', name: '昆仑道宫', location: '未明' },
            { id: 'e_bk_2', kind: 'character', name: '清玄真人', location: '未明' },
            { id: 'e_bk_3', kind: 'character', name: '散修甲', location: '未明' },
            { id: 'e_bk_4', kind: 'character', name: '玄一道祖', location: '未明' },
        ],
        weights: { e_bk_1: 0.85, e_bk_2: 1, e_bk_3: 1, e_bk_4: 1 },
        agendas: [{ id: 'a_1' }], events: [{ id: 'ev_1' }], chronicle: [{ id: 'ch_1', tick: 42, text: '旧事' }], milestones: [],
    };
}
const BOOK_ENTRIES = [
    { comment: '昆仑道宫', content: '[势力: 昆仑道宫 (正道仙门魁首)]\n- 清玄真人 (男, T7合体中期): 掌教。\n- 玄一道祖 (男, T9渡劫巅峰): 人族守护神。', key: ['昆仑道宫'] },
];

test('leg25 e：可重入补齐——已建好的世界加载时补上归属/档位/规模（零 token，不新建实体）', () => {
    const w = oldWorld();
    const r = seedAndBackfill(w, { entries: BOOK_ENTRIES });
    assert.equal(r.seed.seeded, 0, '★不新建实体（老账户一个都不加）');
    assert.equal(r.changed, true, '有补齐 ⇒ 需要落盘');
    assert.ok(r.backfilled >= 3, `补齐计数可见（实际 ${r.backfilled}）`);
    const qing = w.entities.find((e) => e.name === '清玄真人');
    assert.equal(qing.parent, '昆仑道宫', '★成员行反推出归属');
    assert.equal(qing['实力'], 'T7合体中期', '★紧贴名号的档位原话照抄');
    assert.equal(w.entities.find((e) => e.name === '昆仑道宫')['规模'], '正道仙门魁首', '★势力规模原话照抄');
    assert.equal(w.entities.find((e) => e.name === '散修甲').parent, undefined, '书里没有依据的：不许凭空挂（被反驳=refuted）');
    // 世界进度一个字节都不许动
    assert.equal(w.meta.tick, 42);
    assert.equal(w.chronicle.length, 1);
    assert.equal(w.agendas.length, 1);
    assert.equal(w.events.length, 1);
    assert.equal(Object.keys(w.weights).length, 4);
    assert.equal(w.entities.length, 4);
});

test('leg25 e：可重入幂等——第二次加载零变化（不产生无谓落盘）', () => {
    const w = oldWorld();
    seedAndBackfill(w, { entries: BOOK_ENTRIES });
    const snap = JSON.stringify(w);
    const r2 = seedAndBackfill(w, { entries: BOOK_ENTRIES });
    assert.equal(r2.changed, false, '★第二次 changed=false ⇒ loadWorld 不写盘');
    assert.equal(r2.backfilled, 0);
    assert.equal(r2.seed.seeded, 0);
    assert.equal(JSON.stringify(w), snap, '世界逐字节不变');
});

test('leg25 e：取不到正文 ⇒ 退回老行为（只搬名册字段，不误判、不报错）', () => {
    const w = oldWorld();
    const r = seedAndBackfill(w, { entries: [] });          // 书没读到
    assert.equal(r.seed.seeded, 0, '不新建实体');
    assert.equal(r.changed, false, '无书可读 ⇒ 零变化（不空写；下轮读到书再补）');
    assert.equal(w.entities.find((e) => e.name === '清玄真人').parent, undefined, '没有正文就不许猜归属');
});

test('web/index.js 接线回归锁：模块可加载（顶层零 DOM 守卫不破）+ 三处修复点仍在文件里', async () => {
    // ①真加载：web/index.js 的纪律是「模块顶层零 DOM」（node --test 可动态导入）——动态导入真跑一遍，
    //   比文本匹配强（语法/顶层雷/顶层 DOM 访问都会当场炸）。
    const mod = await import('../web/index.js');
    assert.equal(typeof mod.loadWorld, 'function');
    assert.equal(typeof mod.setupAsyncTicks, 'function');
    assert.equal(typeof mod.sw2Version(), 'string');

    // ②三处修复点的存在性（文本断言写得宽一点：这文件同时被别的工作流改，不锁死措辞）
    const src = await readFile(new URL('../web/index.js', import.meta.url), 'utf8');
    assert.match(src, /planChronicleRotation\(/, 'E1：上线走 planChronicleRotation（不再是裸 rotateChronicle 缺省卷号）');
    assert.doesNotMatch(src, /rotateChronicle\(world\)/, 'E1：旧缺陷调用形态（从不传卷号）已消失');
    assert.match(src, /nextVolume/, 'E1：热账卷号在接线里被读/写');
    assert.match(src, /if \(!rot(?:ation)?\.ok\) throw new Error\(rot(?:ation)?\.error\)/, 'E2：队列 save 面把轮转失败抛出去（不静默当成功）');
    assert.doesNotMatch(src, /catch \(_\) \{\s*return world;\s*\}/, 'E2：旧「吞异常返回原世界」实现已消失');
    assert.match(src, /seedBookEntities\(/, 'E4：名册入账仍在 loadWorld 入口');
    assert.match(src, /seedAndBackfill\(/, 'leg25 e：loadWorld 走可重入收口 seedAndBackfill（不是内联老逻辑）');
    assert.match(src, /worldBookCached\(\)/, 'leg25 e：可重入补齐要拿真书正文（零 token 兜底靠它）');
    assert.match(src, /seedBookEntities\(seed, \{ entries:/, 'leg25 e：初始化创建世界时也把真书正文交给名册落账');
    assert.match(src, /flushHotMeta\(\)/, 'E4：名册入账后有显式落盘路径');
});
