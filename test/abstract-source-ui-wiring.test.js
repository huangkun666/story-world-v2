// story-world-v2/test/abstract-source-ui-wiring.test.js
// 「抽象来源」页面与接线层（`web/panel-tools.js`）之间的**真实接线回归**。
//
// 这一份咬三件只有接线层才做得到的事（页面自己不许做）：
//   ① **一次性旧配置迁移**：只在"期望的卡已经加载完"且"这次异步读取仍是当前所有者"时才落盘
//      （Task 1 契约：`migrateAbstractSelectionState` 的 complete/migrated/pendingCharacter）；
//   ② **重读必须让下游取书缓存失效**：显式重读之后，页面新显示的原文与随后
//      `bookTextForRoots` / 补查 / 起根读到的必须是同一份（否则作者改书之后两边**静默分叉**）；
//   ③ 页面的写回仍旧走**现有插件设置接口**（`writeSetting('abstractSelections', …)`），
//      新写入一律带 `version:2` 与 `reads`。
//
// ★真跑：假 ctx 喂给生产 `collectWorldInfoEntries` / `collectAbstractSources` / `composeInitSource`，
//   不是"我以为的形状"。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPanelTools } from '../web/panel-tools.js';
import { bookTextForRoots, setCtxSource } from '../web/book-source.js';
import { makeDom } from './fixture-picker-dom.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (n = 6) => { for (let i = 0; i < n; i += 1) await tick(); };

const CARD = { name: '测试卡', description: '卡描述正文', scenario: '卡场景正文', personality: '卡性格正文', first_mes: '卡开场正文' };
const BOOK = '测试世界书';
const BOOK_ENTRIES = [
    { uid: 1, comment: '昆仑道宫', key: ['昆仑道宫'], content: '昆仑道宫立于西荒。' },
    { uid: 2, comment: '万法阁', key: ['万法阁'], content: '万法阁藏器三千。', disable: true },
];

/** 假 ST 上下文（只有取书与设置那几格是真的被生产函数读的）。 */
function makeCtx({ chatId = 'c1', character = CARD, catalog = BOOK_ENTRIES, cards = null } = {}) {
    const ctx = {
        chatId,
        characterId: 0,
        characters: cards ?? [{ ...character, world: BOOK }],    // 卡上挂着这本书 ⇒ 取书来源
        groups: [],
        chatMetadata: {},
        extensionSettings: { story_world_v2: { abstractSelections: {} } },
        worldInfo: null,
        loadWorldInfo: async (name) => (name === BOOK ? { entries: catalog } : null),
    };
    return ctx;
}

/** 装一个假窗口：必须有一枚 `[data-source-picker]` 容器（接线层按它决定要不要挂页面）。 */
function makeWin() {
    const { doc, win } = makeDom();
    const picker = doc.createElement('div');
    picker.setAttribute('data-source-picker', '');
    win.appendChild(picker);
    return { doc, win };
}

/** 装接线层（`writeSetting` 落到 settings 与 ctx 两处——与真接线同一形状）。 */
function wire(ctx, { settings = {} } = {}) {
    const writes = [];
    const panel = createPanelTools({
        getCtx: () => ctx,
        getWorld: () => ({ meta: { tick: 1 }, context: { setting: { dynamic: { env: {} } } } }),
        getSettings: () => settings,
        writeSetting: (key, value) => {
            writes.push([key, value]);
            settings[key] = value;
            if (key === 'abstractSelections') {
                ctx.extensionSettings.story_world_v2.abstractSelections = value;
            }
        },
        getRuntime: () => null,
        getInjector: () => null,
        build: 'task2-test',
    });
    return { panel, writes, settings };
}

const clickReload = async (win) => {
    const btn = win.querySelector('[data-source-action="reload"]');
    assert.ok(btn, '页面上必须有重读按钮');
    btn.dispatchEvent({ type: 'click', target: btn });
    await settle();
};

// ═══════════════ ① 一次性迁移：卡没加载完不许落盘 ═══════════════

test('接线①：卡还没加载完 ⇒ 旧配置**一个字节都不落盘**（保留旧形状等重读）', async () => {
    const shallow = { ...CARD, shallow: true, description: '', scenario: '', personality: '', first_mes: '' };
    const ctx = makeCtx({ character: shallow });
    ctx.extensionSettings.story_world_v2.abstractSelections.c1 = { mode: 'custom', selectedIds: ['测试世界书:1'] };
    const { panel, writes } = wire(ctx);
    const { doc, win } = makeWin();
    globalThis.document = doc;
    panel.bind(win);
    await settle();
    assert.deepEqual(settingsOf(writes), [], '★卡还在懒加载 ⇒ 不迁移、不落盘（凭 null 分不清"没卡"与"卡没来"）');
    assert.match(win.querySelector('[data-source-notices]').textContent, /还没加载完/,
        '★页面上如实说"角色卡还没加载完"（与"卡里没有"分形）');
    assert.deepEqual(ctx.extensionSettings.story_world_v2.abstractSelections.c1, { mode: 'custom', selectedIds: ['测试世界书:1'] },
        '★旧设置原样留着（没有 version 标记 = 迁移还没完成）');
});

test('接线②：卡加载完之后**恰好迁移一次**（带 version:2/reads 与新增卡正文），再重读不重复写', async () => {
    const ctx = makeCtx();
    ctx.extensionSettings.story_world_v2.abstractSelections.c1 = { mode: 'custom', selectedIds: ['测试世界书:1'] };
    const { panel, writes } = wire(ctx);
    const { doc, win } = makeWin();
    globalThis.document = doc;
    panel.bind(win);
    await settle();
    const saved = writes.filter(([key]) => key === 'abstractSelections');
    assert.equal(saved.length, 1, `★完成态只许迁移一次；实际写了 ${saved.length} 次`);
    const migrated = saved[0][1].c1;
    assert.equal(migrated.version, 2, '★迁移结果必须带 version:2（Task 1 用它区分新旧形状）');
    assert.equal(migrated.mode, 'custom');
    assert.ok(migrated.selectedIds.includes('测试世界书:1'), '★旧的世界书选择一个不丢');
    for (const field of ['description', 'scenario', 'personality', 'first_mes']) {
        assert.ok(migrated.selectedIds.includes(`character-fields:测试卡:${field}`),
            `★旧配置本来就会读到卡正文 ⇒ 迁移时按实际读取结果补上 ${field}`);
    }
    assert.deepEqual(migrated.reads, {}, '★新写入带 reads（空的也要有这一格）');
    await clickReload(win);
    assert.equal(writes.filter(([key]) => key === 'abstractSelections').length, 1, '★已经是新形状 ⇒ 再重读也不重复迁移');
});

// ═══════════════ ② 异步归属：旧请求不许落到新聊天上 ═══════════════

test('接线③：读取途中切了聊天 ⇒ 晚到的那一轮**一个字都不写**（旧所有者不许动新聊天）', async () => {
    const ctx = makeCtx();
    ctx.extensionSettings.story_world_v2.abstractSelections.c1 = { mode: 'custom', selectedIds: ['测试世界书:1'] };
    let release = null;
    const gate = new Promise((resolve) => { release = resolve; });
    let first = true;
    ctx.loadWorldInfo = async () => {
        if (first) { first = false; await gate; }        // 第一轮卡住
        return { entries: BOOK_ENTRIES };
    };
    const { panel, writes } = wire(ctx);
    const { doc, win } = makeWin();
    globalThis.document = doc;
    panel.bind(win);
    await tick();
    ctx.chatId = 'c2';                                   // ★读取还没回来，玩家已经换了聊天
    ctx.extensionSettings.story_world_v2.abstractSelections.c2 = { mode: 'default', selectedIds: [] };
    release();
    await settle();
    assert.deepEqual(writes.filter(([key]) => key === 'abstractSelections'), [],
        '★晚到的旧读取不许把迁移结果写进新聊天（也不许写回旧聊天 —— 这次读取已经作废）');
    assert.deepEqual(ctx.extensionSettings.story_world_v2.abstractSelections.c1, { mode: 'custom', selectedIds: ['测试世界书:1'] },
        '★旧聊天那格原样不动');
});

// ═══════════════ ③ 重读 → 下游取书缓存/世代失效 ═══════════════

test('接线④：点重读必须先让下游取书失效——页面新显示的原文与随后起根/补查读到的是同一份', async () => {
    const catalog = BOOK_ENTRIES.map((e) => ({ ...e }));
    const ctx = makeCtx({ catalog });
    ctx.characters[0] = { ...CARD, world: BOOK };        // 卡上挂着这本书（取书来源）
    let reads = 0;
    ctx.loadWorldInfo = async (name) => { reads += 1; return name === BOOK ? { entries: catalog } : null; };
    setCtxSource(() => ctx);
    const { panel } = wire(ctx);
    const { doc, win } = makeWin();
    globalThis.document = doc;
    panel.bind(win);
    await settle();

    // 正向对照：缓存命中时下游**不重读**
    const first = await bookTextForRoots(ctx);
    assert.ok(first.text.includes('昆仑道宫立于西荒。'), '★起根读到这本书');
    const cached = reads;
    await bookTextForRoots(ctx);
    assert.equal(reads, cached, '★同一份来源第二次读走缓存（否则这条判据证明不了"重读真的失效了"）');

    // 作者改了书；页面重读 ⇒ 缓存/世代必须失效
    catalog[0].content = '昆仑道宫改了之后的正文。';
    await clickReload(win);
    const beforeRoots = reads;
    const after = await bookTextForRoots(ctx);
    assert.equal(reads, beforeRoots + 1, '★重读之后下游必须重新取书（用既有 resetBookCache 失效口，不在 UI 里另存一份缓存）');
    assert.ok(after.text.includes('昆仑道宫改了之后的正文。'), '★起根读到的是改过之后的那份');
    assert.equal(after.text.includes('立于西荒'), false, '★旧正文不许再露面（两边静默分叉正是这条要治的病）');
    const uiText = win.querySelector('[data-source-effective-text]').textContent;
    assert.ok(uiText.includes('昆仑道宫改了之后的正文。'), '★页面显示的原文与下游读到的是同一份');
});

// ═══════════════ ④ 页面写回走现有设置接口 ═══════════════

test('接线⑤：页面改选之后写回的仍是现有设置接口，并带 version:2/reads；同聊天第二次打开不重写', async () => {
    const ctx = makeCtx();
    const { panel, writes } = wire(ctx);
    const { doc, win } = makeWin();
    globalThis.document = doc;
    panel.bind(win);
    await settle();
    assert.deepEqual(settingsOf(writes), [],
        '★这一格聊天本来没有设置 ⇒ 打开面板不许凭空写一份（默认语义与新形状逐字相同）');
    const box = win.querySelectorAll('[data-source-entry]')
        .find((b) => b.value === '测试世界书:2');
    assert.ok(box, '★禁用条目也在页面上');
    box.checked = true;
    box.dispatchEvent({ type: 'change', target: box });
    await settle();
    const saved = writes.filter(([key]) => key === 'abstractSelections');
    assert.equal(saved.length, 1, '★一次真实改动写一次');
    const picked = saved[0][1].c1;
    assert.equal(picked.version, 2);
    assert.equal(picked.mode, 'custom');
    assert.ok(picked.selectedIds.includes('测试世界书:2'), '★明确勾选的禁用条目写进自选');
    assert.ok(Object.hasOwn(picked, 'reads'), '★新设置必须带 reads 这一格');
    // 同一个窗口再 sync 一次：状态已加载 ⇒ 不重取、不重写
    panel.bind(win);
    await settle();
    assert.equal(writes.filter(([key]) => key === 'abstractSelections').length, 1, '★重开面板不许改一次设置（默认与查看都必须是无副作用的）');
});

// ═══════════════ ⑤ 同聊天内的来源归属：换卡/换挂载/换书/迟到事件都不许串 ═══════════════
//
// 设计 §4.1「切换角色或聊天、点击重读时重新收集」与 §5.2「切换聊天、角色或书源时废弃过期的
// 读取结果」：**同一场聊天**里换卡、换挂载书（或换掉宿主的 legacy 世界书）同样是"换了书源"，
// 而 `chatId` 一个字都没变 —— 只比聊天号的老护栏在这三种转移上全是瞎的（本文件咬的就是它们）。
//
// ★这里用的是**共享来源身份**那一口（`captureSourceOwner`/`sourceOwnerSuperseded`），
//   它与取书缓存同一把尺；页面接线里不许再拼第二份"什么算同一份来源"。

const CARD_B = { name: '测试卡乙', avatar: 'b.png', description: '乙卡描述正文', scenario: '乙卡场景正文', personality: '乙卡性格正文', first_mes: '乙卡开场正文' };
const BOOK_B = '另一本书';
const BOOKS = { [BOOK]: BOOK_ENTRIES, [BOOK_B]: [{ uid: 1, comment: '新书条目', content: '新书正文。' }] };

/** 两张卡 + 两本书：同聊天里换卡（characterId 变）与换挂载（world 变）都咬得住。 */
function makeTwoCardCtx() {
    const ctx = makeCtx({ cards: [{ ...CARD, avatar: 'a.png', world: BOOK }, { ...CARD_B, world: BOOK }] });
    ctx.loadWorldInfo = async (name) => (BOOKS[name] ? { entries: BOOKS[name] } : null);
    return ctx;
}

const idsOf = (win) => win.querySelectorAll('[data-source-entry]').map((b) => b.value);
const hasChecked = (win, id) => (win.querySelectorAll('[data-source-entry]').find((b) => b.value === id)?.checked === true);

test('接线⑥：读取途中**同一场聊天**里换了卡 ⇒ 晚到的那一轮作废：不迁移、页面不摆旧卡', async () => {
    const ctx = makeTwoCardCtx();
    ctx.extensionSettings.story_world_v2.abstractSelections.c1 = { mode: 'custom', selectedIds: ['测试世界书:1'] };   // 旧形状 ⇒ 有迁移候选
    let release = null;
    const gate = new Promise((resolve) => { release = resolve; });
    let first = true;
    ctx.loadWorldInfo = async (name) => {
        if (first) { first = false; await gate; }
        return BOOKS[name] ? { entries: BOOKS[name] } : null;
    };
    const { panel, writes } = wire(ctx);
    const { doc, win } = makeWin();
    globalThis.document = doc;
    panel.bind(win);
    await tick();
    ctx.characterId = 1;                                 // ★读取还在飞，同一场聊天里已经换成卡乙
    release();
    await settle();
    assert.deepEqual(settingsOf(writes), [],
        '★★晚到的旧卡读取一个字都不许写（写了就是把卡甲的 description 迁移进"现在是卡乙"的这一格）');
    assert.deepEqual(ctx.extensionSettings.story_world_v2.abstractSelections.c1, { mode: 'custom', selectedIds: ['测试世界书:1'] },
        '★旧形状原样留着，等下一次现取再定');
    assert.equal(idsOf(win).includes('character-fields:a.png:description'), false, '★卡甲的正文来源不许摆在页面上');
    // 真接线在换卡/重开面板时还会再 bind 一次 ⇒ 那时页面必须现取到**现在的**卡乙
    panel.bind(win);
    await settle();
    assert.ok(idsOf(win).includes('character-fields:b.png:description'), `★重绑之后显示现在的卡乙；实际 ${JSON.stringify(idsOf(win))}`);
    assert.equal(idsOf(win).includes('character-fields:a.png:description'), false, '★卡甲的来源一条都不留');
});

test('接线⑦：同一聊天的**挂载书**换了 ⇒ 重绑必须重读（页面不许还摆着旧书）', async () => {
    const ctx = makeTwoCardCtx();
    const { panel } = wire(ctx);
    const { doc, win } = makeWin();
    globalThis.document = doc;
    panel.bind(win);
    await settle();
    assert.ok(idsOf(win).includes('测试世界书:1'), '★先读到卡甲挂的那本书');
    ctx.characters[0].world = BOOK_B;                    // ★同一场聊天、同一张卡：只换了挂载的书
    panel.bind(win);
    await settle();
    assert.ok(idsOf(win).includes(`${BOOK_B}:1`), `★重绑之后显示新挂载那本书；实际 ${JSON.stringify(idsOf(win))}`);
    assert.equal(idsOf(win).includes('测试世界书:1'), false, '★旧书的条目不许留在页面上');
});

test('接线⑧：legacy 世界书（ctx.worldInfo）换了内容 ⇒ 重绑重读，页面显示新正文', async () => {
    const ctx = makeTwoCardCtx();
    ctx.characters = [];                                 // 来源只有宿主那份 legacy 世界书
    ctx.characterId = null;
    ctx.worldInfo = [{ uid: 1, comment: '旧条', content: '旧正文。' }];
    const { panel } = wire(ctx);
    const { doc, win } = makeWin();
    globalThis.document = doc;
    panel.bind(win);
    await settle();
    assert.ok(win.querySelector('[data-source-effective-text]').textContent.includes('旧正文。'), '★先读到旧书');
    ctx.worldInfo = [{ uid: 1, comment: '新条', content: '新正文。' }];   // ★同一场聊天、同一个条目号：只换了正文
    panel.bind(win);
    await settle();
    const row = win.querySelectorAll('[data-source-item]')[0];
    assert.equal(row.getAttribute('data-source-title'), '新条', '★重绑之后条目名是新书那份');
    const text = win.querySelector('[data-source-effective-text]').textContent;
    assert.ok(text.includes('新正文。'), '★最终预览是新书正文');
    assert.equal(text.includes('旧正文。'), false, '★旧书正文一个字都不许留下');
});

test('接线⑨：切了聊天之后、重绑之前的**旧事件** ⇒ 不写设置、不假装成功，页面重装当前聊天', async () => {
    const ctx = makeCtx();
    ctx.extensionSettings.story_world_v2.abstractSelections.c1 = { version: 2, mode: 'custom', selectedIds: ['测试世界书:1'], reads: {} };
    ctx.extensionSettings.story_world_v2.abstractSelections.c2 = { version: 2, mode: 'custom', selectedIds: ['测试世界书:2'], reads: {} };
    const { panel, writes } = wire(ctx);
    const { doc, win } = makeWin();
    globalThis.document = doc;
    panel.bind(win);
    await settle();
    assert.equal(hasChecked(win, '测试世界书:1'), true, '★c1 里这条是勾上的');
    ctx.chatId = 'c2';                                   // ★旧事件到来之前，玩家已经换了聊天（页面还没重绑）
    const box = win.querySelectorAll('[data-source-entry]').find((b) => b.value === '测试世界书:1');
    box.checked = false;
    box.dispatchEvent({ type: 'change', target: box });
    await settle();
    assert.deepEqual(settingsOf(writes), [], '★★旧所有者的事件一个字都不许写（不许先改了页面再说成功）');
    assert.deepEqual(ctx.extensionSettings.story_world_v2.abstractSelections.c2.selectedIds, ['测试世界书:2'], '★★c2 的选择原样保住');
    assert.deepEqual(ctx.extensionSettings.story_world_v2.abstractSelections.c1.selectedIds, ['测试世界书:1'], '★c1 也没被动过');
    assert.equal(hasChecked(win, '测试世界书:2'), true, '★页面重新装载当前聊天：c2 勾的那条勾着');
    assert.equal(hasChecked(win, '测试世界书:1'), false, '★c1 那条没勾（不许停在旧页面上假装成功）');
});

test('接线⑩：懒加载卡**浅→全**是合法的加载推进——迁移照常落盘、卡四项按全卡补齐', async () => {
    const shallow = { name: '测试卡', avatar: 'a.png', shallow: true, description: '', scenario: '', personality: '', first_mes: '' };
    const ctx = makeCtx({ character: shallow });
    ctx.extensionSettings.story_world_v2.abstractSelections.c1 = { mode: 'custom', selectedIds: ['测试世界书:1'] };
    ctx.unshallowCharacter = async () => { ctx.characters[0] = { ...CARD, avatar: 'a.png', world: BOOK }; };   // ST 是原地换掉那一格
    const { panel, writes } = wire(ctx);
    const { doc, win } = makeWin();
    globalThis.document = doc;
    panel.bind(win);
    await settle();
    const saved = settingsOf(writes);
    assert.equal(saved.length, 1, '★浅→全是我们自己要去的那一次加载 ⇒ 迁移照常发生（恰好一次）');
    const migrated = saved[0][1].c1;
    assert.equal(migrated.version, 2);
    assert.ok(migrated.selectedIds.includes('character-fields:a.png:description'), '★全卡的卡正文按实际读取补进自选');
    assert.ok(migrated.selectedIds.includes('测试世界书:1'), '★旧世界书选择一个不丢');
    assert.ok(idsOf(win).includes('character-fields:a.png:description'), '★页面显示的是全卡的来源');
});

test('接线⑪：同聊天里换了卡（已经装好一份快照之后）⇒ 重绑必须重读', async () => {
    const ctx = makeTwoCardCtx();
    const { panel } = wire(ctx);
    const { doc, win } = makeWin();
    globalThis.document = doc;
    panel.bind(win);
    await settle();
    assert.ok(idsOf(win).includes('character-fields:a.png:description'), '★先显示卡甲');
    ctx.characterId = 1;                                 // ★同一场聊天里换成卡乙
    panel.bind(win);
    await settle();
    assert.ok(idsOf(win).includes('character-fields:b.png:description'), `★重绑之后显示卡乙；实际 ${JSON.stringify(idsOf(win))}`);
    assert.equal(idsOf(win).includes('character-fields:a.png:description'), false, '★卡甲的来源不许留下');
});

test('接线⑫：读取途中**换了挂载书**（聊天与卡槽都没变）⇒ 旧读取作废，页面不许摆旧书', async () => {
    const ctx = makeTwoCardCtx();
    let release = null;
    const gate = new Promise((resolve) => { release = resolve; });
    let first = true;
    ctx.loadWorldInfo = async (name) => {
        if (first) { first = false; await gate; }
        return BOOKS[name] ? { entries: BOOKS[name] } : null;
    };
    const { panel } = wire(ctx);
    const { doc, win } = makeWin();
    globalThis.document = doc;
    panel.bind(win);
    await tick();
    ctx.characters[0].world = BOOK_B;                    // ★同一场聊天、同一张卡：读取还在飞，挂载换了
    release();
    await settle();
    assert.equal(idsOf(win).includes('测试世界书:1'), false, '★★晚到的旧挂载读取不许摆出来（聊天号没变也照样作废）');
    panel.bind(win);
    await settle();
    assert.ok(idsOf(win).includes(`${BOOK_B}:1`), '★重绑之后页面现取到新挂载那本书');
});

test('接线⑬：legacy 世界书（ctx.worldInfo）在页面装好之后换了内容 ⇒ 旧事件不写、页面重装新书', async () => {
    const ctx = makeTwoCardCtx();
    ctx.characters = [];                                 // 来源只有宿主那份 legacy 世界书
    ctx.characterId = null;
    ctx.worldInfo = [{ uid: 1, comment: '旧条', content: '旧正文。' }];
    ctx.extensionSettings.story_world_v2.abstractSelections.c1 = { version: 2, mode: 'custom', selectedIds: ['world-info:1'], reads: {} };
    const { panel, writes } = wire(ctx);
    const { doc, win } = makeWin();
    globalThis.document = doc;
    panel.bind(win);
    await settle();
    assert.equal(hasChecked(win, 'world-info:1'), true, '★先显示的是一份装了旧书的快照');
    ctx.worldInfo = [{ uid: 1, comment: '新条', content: '新正文。' }];   // ★同一场聊天：宿主原地换了那份 legacy 书
    const box = win.querySelectorAll('[data-source-entry]').find((b) => b.value === 'world-info:1');
    box.checked = false;
    box.dispatchEvent({ type: 'change', target: box });
    await settle();
    assert.deepEqual(settingsOf(writes), [],
        '★★这份快照抓的是旧书 ⇒ 事件作废，一个字都不许写（`bookContextIdentity` 看不见 legacy 书，这不是聊天号能覆盖的）');
    assert.deepEqual(ctx.extensionSettings.story_world_v2.abstractSelections.c1.selectedIds, ['world-info:1'], '★设置原样不动');
    assert.ok(win.querySelector('[data-source-effective-text]').textContent.includes('新正文。'), '★页面重新装载之后显示的是新书');
    assert.equal(win.querySelector('[data-source-effective-text]').textContent.includes('旧正文。'), false, '★旧书正文一个字都不留');
});

test('接线⑭：legacy 世界书**原地改**了正文（引用没变）⇒ 也算换来源：旧事件作废、页面重装', async () => {
    const ctx = makeTwoCardCtx();
    ctx.characters = [];
    ctx.characterId = null;
    const legacy = [{ uid: 1, comment: '同条', content: '旧正文。' }];
    ctx.worldInfo = legacy;
    ctx.extensionSettings.story_world_v2.abstractSelections.c1 = { version: 2, mode: 'custom', selectedIds: ['world-info:1'], reads: {} };
    const { panel, writes } = wire(ctx);
    const { doc, win } = makeWin();
    globalThis.document = doc;
    panel.bind(win);
    await settle();
    legacy[0].content = '改后正文。';                     // ★同一个数组、原地改一格
    const box = win.querySelectorAll('[data-source-entry]').find((b) => b.value === 'world-info:1');
    box.checked = false;
    box.dispatchEvent({ type: 'change', target: box });
    await settle();
    assert.deepEqual(settingsOf(writes), [], '★★原地改也算换了来源（Task 1 的逐格版本口径），事件作废');
    assert.ok(win.querySelector('[data-source-effective-text]').textContent.includes('改后正文。'), '★页面重装之后读到的是改后的书');
});

test('接线⑮：legacy 世界书换了个**同内容的数组壳**（宿主现取上下文的常态）⇒ 不算换来源，点击照常落盘', async () => {
    // ★这一条与前一条是一对：**内容**才是"是不是同一本书"的判据。若把"新数组壳"也判作换书，
    //   宿主每轮 getContext() 交新壳的实现上，页面会**点一次丢一次**（过期 ⇒ 重装 ⇒ 用户的动作没了）。
    const ctx = makeTwoCardCtx();
    ctx.characters = [];
    ctx.characterId = null;
    ctx.worldInfo = [{ uid: 1, comment: '同条', content: '同正文。' }];
    ctx.extensionSettings.story_world_v2.abstractSelections.c1 = { version: 2, mode: 'custom', selectedIds: ['world-info:1'], reads: {} };
    const { panel, writes } = wire(ctx);
    const { doc, win } = makeWin();
    globalThis.document = doc;
    panel.bind(win);
    await settle();
    ctx.worldInfo = [{ uid: 1, comment: '同条', content: '同正文。' }];   // ★新壳、一个字没变
    const box = win.querySelectorAll('[data-source-entry]').find((b) => b.value === 'world-info:1');
    box.checked = false;
    box.dispatchEvent({ type: 'change', target: box });
    await settle();
    const saved = settingsOf(writes);
    assert.equal(saved.length, 1, '★同内容的书不算换来源：真实改动照常写回（页面不许点一次丢一次）');
    assert.deepEqual(saved[0][1].c1.selectedIds, [], '★写回落在这一格，取消勾选真的生效');
    assert.equal(hasChecked(win, 'world-info:1'), false, '★页面所见即所选');
});

/** 设置写回里"真落盘"的那几次（本文件只关心 abstractSelections）。 */
function settingsOf(writes) {
    return writes.filter(([key]) => key === 'abstractSelections');
}

test('懒加载期间另换上下文挂载：同头像浅→全不能替外部换书放行旧卡快照', async () => {
    const ctx = makeCtx({ character: { name: CARD.name, avatar: 'a.png', shallow: true } });
    ctx.extensionSettings.story_world_v2.abstractSelections.c1 = { mode: 'custom', selectedIds: ['测试世界书:1'] };
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    ctx.unshallowCharacter = async () => { await gate; ctx.characters[0] = { ...CARD, avatar: 'a.png', world: BOOK }; };
    let live = ctx;
    const writes = [];
    const panel = createPanelTools({ getCtx: () => live, getWorld: () => null,
        getSettings: () => live.extensionSettings.story_world_v2,
        writeSetting: (key, value) => { writes.push([key, value]); live.extensionSettings.story_world_v2[key] = value; },
        getRuntime: () => null, getInjector: () => null });
    const { doc, win } = makeWin();
    globalThis.document = doc;
    panel.bind(win);
    await tick();
    live = { ...ctx, characters: [{ ...CARD, avatar: 'a.png', world: '新挂载书' }], chatMetadata: { world_info: '新挂载书' } };
    release();
    await settle();
    assert.deepEqual(writes, [], '卡加载与外部挂载同时变化时，旧读取不得迁移当前设置');
    assert.equal(win.querySelectorAll('[data-source-entry]').length, 0, '不得交出旧上下文卡和当前上下文挂载混合的来源');
});

test('同卡加载后宿主交新上下文：合订必须取当前全卡及其挂载，不能使用旧壳返回的卡', async () => {
    const ctx = makeCtx({ character: { name: CARD.name, avatar: 'a.png', shallow: true } });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    ctx.unshallowCharacter = async () => { await gate; ctx.characters[0] = { ...CARD, avatar: 'a.png', world: BOOK }; };
    let live = ctx;
    ctx.loadWorldInfo = async name => ({ entries: name === BOOK ? BOOK_ENTRIES : [{ uid: 99, comment: '当前书', content: '当前挂载正文' }] });
    const panel = createPanelTools({ getCtx: () => live, getWorld: () => null,
        getSettings: () => live.extensionSettings.story_world_v2, writeSetting: () => assert.fail('默认查看不写配置'),
        getRuntime: () => null, getInjector: () => null });
    const { doc, win } = makeWin();
    globalThis.document = doc;
    panel.bind(win);
    await tick();
    live = { ...ctx, characters: [{ ...CARD, avatar: 'a.png', world: '当前挂载书', description: '当前全卡正文' }] };
    release();
    await settle();
    const ids = win.querySelectorAll('[data-source-entry]').map(box => box.value);
    assert.ok(ids.includes('当前挂载书:99'), '读取当前上下文全卡的挂载书');
    assert.equal(ids.includes('测试世界书:1'), false, '旧壳的全卡不能混入当前来源');
    assert.match(win.querySelector('[data-source-effective-text]').textContent, /当前全卡正文/);
});

test('来源尚在首次读取：批量和模式操作不能把未加载误当空自选写入', async () => {
    const ctx = makeCtx();
    const saved = { version: 2, mode: 'custom', selectedIds: ['测试世界书:2'], reads: {} };
    ctx.extensionSettings.story_world_v2.abstractSelections.c1 = saved;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    ctx.loadWorldInfo = async () => { await gate; return { entries: BOOK_ENTRIES }; };
    const { panel, writes } = wire(ctx);
    const { doc, win } = makeWin();
    globalThis.document = doc;
    panel.bind(win);
    await tick();
    const all = win.querySelector('[data-source-action="all"]');
    all.dispatchEvent({ type: 'click', target: all });
    const mode = win.querySelector('[data-source-mode]');
    mode.value = 'custom';
    mode.dispatchEvent({ type: 'change', target: mode });
    assert.deepEqual(settingsOf(writes), [], '来源未加载时不许用空清单覆盖已存选择');
    release();
    await settle();
    assert.deepEqual(ctx.extensionSettings.story_world_v2.abstractSelections.c1, saved);
    assert.equal(win.querySelectorAll('[data-source-entry]').find(box => box.value === '测试世界书:2').checked, true);
});
