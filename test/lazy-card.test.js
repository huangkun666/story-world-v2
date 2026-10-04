// story-world-v2/test/lazy-card.test.js
// ★★★leg154（**社区用户报的 bug** · 2026-09-30）：面板报「设定源不可用：角色卡四件套全空；世界信息/内置书为空」，
//   而用户的世界书好端端地挂在他那张卡上——**读不到 ≠ 书里没有**（本仓第一条承重墙）。
//
// 根因（在酒馆源码里查实的，不是猜的）：ST 有一个性能开关 `performance.lazyLoadCharacters`
//   （`src/endpoints/characters.js:35`）。打开之后，角色列表接口只交回**名册那一层**：
//   `{ shallow: true, name, avatar, tags, data: { name, creator, ... } }`——
//   ★**description / personality / scenario / first_mes 与"卡上挂的那本世界书"（`world` / `character_book`）
//     一个字都不在里面**。ST 自己就是靠 `shallow === true` 这个键决定"要不要再去取全卡"
//   （`unshallowCharacter` → `getOneCharacter` → `characters[index] = 全卡`，原地换掉那一格）。
//   ⇒ 本插件读卡时**从没问过这一句**：卡还在懒加载就把"四件套全空"报给用户，还顺手把卡上那本书也丢了。
//
// 本判据咬两件（都是**真跑接线层**，不是读源码文本）：
//   ① 卡是懒加载卡时，**必须先问 ST 要全卡**，要到之后四件套与世界书**都得回来**；
//   ② 要不到（老 ST / 取回失败）时：**不许抛**，且话要说得诚实——「还没加载完」不许写成「四件套全空」
//      （两种空必须分形：一种是我们没取到，一种是书里真没有）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bookSource from '../web/book-source.js';
import { composeInitSource } from '../src/init-source.js';

function stubEl() {
    const el = {
        id: '', className: '', innerHTML: '', textContent: '', dataset: {}, style: { setProperty() {}, add() {} },
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        children: [], firstChild: null, parentNode: null,
        insertAdjacentHTML() {}, appendChild() {}, removeChild() {}, remove() {}, setAttribute() {}, getAttribute: () => null,
        addEventListener() {}, removeEventListener() {}, querySelector: () => stubEl(), querySelectorAll: () => [],
        closest: () => null, focus() {}, click() {}, scrollTo() {},
    };
    return el;
}

function installCtx(ctx) {
    const savedW = globalThis.window;
    const savedD = globalThis.document;
    globalThis.window = { ...(globalThis.window || {}), addEventListener() {}, removeEventListener() {}, SillyTavern: { getContext: () => ctx } };
    globalThis.document = {
        readyState: 'complete', addEventListener() {}, removeEventListener() {},
        getElementById: () => stubEl(), querySelector: () => stubEl(), querySelectorAll: () => [],
        createElement: () => stubEl(), body: stubEl(), head: stubEl(),
    };
    return () => {
        if (savedW === undefined) delete globalThis.window; else globalThis.window = savedW;
        if (savedD === undefined) delete globalThis.document; else globalThis.document = savedD;
    };
}

const WORLD = '大荒-姬元真';
const BOOK = {
    name: WORLD,
    entries: [
        { keys: ['万妖盟'], comment: '混乱之地·万妖盟', content: '- 吞天妖王 (男, T8大乘中期): 盟主。' },
        { keys: ['世界总纲'], comment: '世界总设定', content: '大荒世界。' },
    ],
};

/**
 * ★逐字照 ST 的 `toShallow()` 造的懒加载卡（字段清单不许自己加东西——
 *   夹具的形状必须照生产那一份做，这条本仓付过账）。
 * @param {string} name 卡名
 * @param {string} avatar 头像文件名（ST 靠它找人）
 */
function shallowCard(name, avatar) {
    return {
        shallow: true, name, avatar, chat: 'x', fav: false,
        date_added: 0, create_date: '', date_last_chat: 0, chat_size: 0, data_size: 0, tags: [],
        data: {
            name, character_version: '', creator: '', creator_notes: '', tags: [],
            extensions: { fav: false },
        },
    };
}

/** 全卡（懒加载取回之后 ST 换进数组的那一份）：四件套齐 + 卡上挂着世界书 */
function fullCard(name, avatar) {
    return {
        name, avatar,
        description: '一个修真世界。',
        personality: '冷峻。',
        scenario: '北荒大雪。',
        first_mes: '你醒了。',
        world: WORLD,
        data: { name, extensions: { world: WORLD } },
    };
}

/**
 * ST 那口「取全卡」的真实行为：`unshallowCharacter(id)` → `getOneCharacter(avatar)`
 *   → **按头像找到那一格、原地换掉**。夹具照做，不多不少。
 */
function stUnshallow(characters, full, calls) {
    return async (id) => {
        calls.push(String(id));
        const idx = characters.findIndex((c) => c?.avatar === 'a.png');
        if (idx !== -1) characters[idx] = full;
    };
}

function fakeCtx(characters, extra = {}) {
    return {
        characterId: 0,
        characters,
        groups: [],
        groupId: null,
        extensionSettings: { world_info: { globalSelect: [] } },
        chatMetadata: {},
        loadWorldInfo: async (name) => (name === WORLD ? BOOK : null),
        renderExtensionTemplateAsync: async () => '<div id="sw2_window"></div>',
        eventSource: { on() {}, off() {}, once() {} },
        eventTypes: {},
        saveMetadata: async () => {},
        saveChat: async () => {},
        updateChatMetadata: () => {},
        saveMetadataDebounced: () => {},
        ...extra,
    };
}

// ─────────────────── ① 本命：懒加载卡必须先去要全卡 ───────────────────

test('★★★leg154·①：卡是懒加载卡 ⇒ 先问 ST 要全卡，四件套与会话里的世界书都要回来', async () => {
    const calls = [];
    const characters = [shallowCard('大荒z', 'a.png')];
    const ctx = fakeCtx(characters, { unshallowCharacter: stUnshallow(characters, fullCard('大荒z', 'a.png'), calls) });
    const restore = installCtx(ctx);
    try {
        const mod = await import('../web/index.js?lazycard1');
        const src = await mod.autoComposeSource();
        assert.deepEqual(calls, ['0'], '★必须问过 ST 一次「取全卡」（不问 ⇒ 卡还是名册那一层，下面两条必然红）');
        assert.equal(src.ok, true, `★取源必须成功（卡取回全卡后四件套齐）；实际 reason：${src.reason || '（无）'}`);
        assert.ok(String(src.text).includes('修真世界'), '★合订源里必须真有卡件的正文（四件套取回来了）');
        assert.ok(Array.isArray(src.worldInfoEntries) && src.worldInfoEntries.length >= 2,
            `★★卡上挂的那本世界书必须取到（实际 ${Array.isArray(src.worldInfoEntries) ? src.worldInfoEntries.length : '（不是数组）'} 条）`);
        const names = (src.worldInfoEntries || []).map((e) => String(e?.comment ?? ''));
        assert.ok(names.includes('混乱之地·万妖盟'), `★条目名应可读（实际 ${names.join('、')}）`);
    } finally {
        restore();
    }
});

// ─────────────────── ② 反证：要不到全卡时，话要说得诚实 ───────────────────

test('★★leg154·②：要不到全卡（老 ST / 取回失败）⇒ 不许抛，且不许把"没取到"说成"卡里没有"', async () => {
    const characters = [shallowCard('大荒z', 'a.png')];      // ★ctx 上**没有** unshallowCharacter（老 ST / 残缺上下文）
    const restore = installCtx(fakeCtx(characters));
    try {
        const mod = await import('../web/index.js?lazycard2');
        const src = await mod.autoComposeSource();           // ★不许抛
        assert.equal(typeof src, 'object');
        assert.equal(src.ok, false, '取不到料 ⇒ 如实报失败（ok 位不许谎报）');
        assert.ok(src.reason, '失败必须给出 reason');
        assert.ok(!src.reason.includes('四件套全空'),
            `★★★不许把"卡还没加载完"说成"卡里没有"——两种空必须分形；实际 reason：${src.reason}`);
        assert.ok(src.reason.includes('还没加载完'), `★要说出真的原因；实际 reason：${src.reason}`);
    } finally {
        restore();
    }
});

test('★★leg154·③（反证的反证）：真·空卡的旧话一个字没丢——四件套确实全空时照旧那么说', async () => {
    // 这张卡**不是**懒加载卡（没有 shallow 键）：它就是一张四件套真为空的卡。
    //   ⇒ 旧消息必须原样留着（否则②就变成"把消息删掉"而不是"把两种空分开"）。
    const empty = { name: '空卡', avatar: 'b.png', data: {}, character_book: null };
    const res = composeInitSource({ character: empty, worldInfoEntries: [] });
    assert.equal(res.ok, false);
    assert.ok(res.reason.includes('角色卡四件套全空'), `★真·空卡仍须报「四件套全空」；实际 reason：${res.reason}`);
    // 而懒加载卡**同一种空**，说的是另一句话
    const lazy = composeInitSource({ character: shallowCard('大荒z', 'a.png'), worldInfoEntries: [] });
    assert.equal(lazy.ok, false);
    assert.ok(lazy.reason.includes('还没加载完'), `★懒加载卡要说"还没加载完"；实际 reason：${lazy.reason}`);
    assert.notEqual(lazy.reason, res.reason, '★两种空不许同一个说法（分形是本仓承重墙）');
});

// ─────────────────── ④ 取书缓存：读不到不许被缓存住 ───────────────────

test('★★leg154·④：一次"读不到"不许把整局锁死（缓存只缓存真读到的那份）', async () => {
    bookSource.resetBookCache();
    const noBook = { name: '大荒z', avatar: 'a.png', data: {} }; // 真正没有任何允许正文；卡描述也已成为可读来源。
    const first = await bookSource.bookTextForEntity({ name: '万妖盟' }, fakeCtx([noBook]));
    assert.equal(first.ok, false, '★一本都没读到 ⇒ ok 为假（"读不到"这一态）');
    // ★不调 resetBookCache：卡上刚挂上书（等价于"ST 那边把书挂上了 / 懒加载卡取回了全卡"）
    const withBook = { ...noBook, world: WORLD };
    const second = await bookSource.bookTextForEntity({ name: '万妖盟' }, fakeCtx([withBook]));
    assert.equal(second.ok, true,
        '★★★上一次"读不到"不许被缓存住——本文件顶上那条三态纪律写着"读不到 ⇒ 下轮再试"，'
        + '而旧实现把空结果也缓存了 ⇒ 那个"下轮"永远吃同一份空结果（纪律与实现对不上，静默、不报错）');
    assert.ok(second.entries.length >= 1, '★挂上书之后必须真取到条目');

    // ★反向自证：**读到**的那份必须照旧缓存（判据不许变成"把缓存整个删掉"）
    //   ★只数"真取那本书"的次数：`extensionSettings.world_info` 的键里还有 `globalSelect` 这类设置项，
    //     它们也会走一次 loadWorldInfo（那不是取书）——夹具必须分清，否则这条判据量的是噪声。
    bookSource.resetBookCache();
    let hits = 0;
    const ctx = fakeCtx([withBook], { loadWorldInfo: async (name) => { if (name === WORLD) hits += 1; return name === WORLD ? BOOK : null; } });
    await bookSource.bookTextForEntity({ name: '万妖盟' }, ctx);
    await bookSource.bookTextForEntity({ name: '万妖盟' }, ctx);
    assert.equal(hits, 1, `★读到之后必须缓存（同一会话只取一次书）；实际取了 ${hits} 次`);
    bookSource.resetBookCache();
});

// ─────────────────── ⑤ 群聊里的成员卡同一条路 ───────────────────

test('★leg154·⑤：群聊成员卡也是懒加载卡时，走同一口（ST 的 unshallowGroupMembers 就是这么干的）', async () => {
    const calls = [];
    const characters = [shallowCard('甲', 'a.png')];
    const groups = [{ id: 'g1', members: ['a.png'] }];
    const ctx = fakeCtx(characters, {
        groups, groupId: 'g1',
        unshallowCharacter: stUnshallow(characters, fullCard('甲', 'a.png'), calls),
    });
    const got = await bookSource.ensureCharacterLoaded(ctx);
    assert.deepEqual(calls, ['0'], '★群聊里也必须去要全卡（按头像定位到那一格，与 ST 自家那口同一把尺）');
    assert.equal(got.shallow, undefined, '★交出来的必须是全卡（还带 shallow 键 ⇒ 没取回来）');
    assert.equal(got.description, '一个修真世界。');
});
