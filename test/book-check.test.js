// story-world-v2/test/book-check.test.js
//
// ★★★leg112（C1 换书检测）的判据。两半：
//   ① **纯函数**（`src/book-check.js`）：判断与措辞——`node --test` 直接真跑。
//   ② **接线**（`web/book-source.js` 的 `checkCurrentBook` + `web/book-rebaseline.js` 的那一族）：
//      注入 fake ST ctx 与 fake 依赖**真跑**，不是 grep 源码（本仓纪律：接线必须有测试，见 `STATE.md` §2.3 第 6 条）。
//
// ★为什么这半条判据非有不可（本笔实测的动机）：用户那份真账（2026-09-11 15:59 抽取）账上存着
//   `fnv1a_pi8kez_6gui`，而现在这本书重算出来是别的值（合订文本 337,266 字 → 268,542 字）——
//   也就是说"账本用的书 ≠ 现在挂的书"这件事**真实发生过**，而此前**没有任何地方会说**。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBookSource, bookChangedStatus, rebaselinedStatus, bookChangedBannerHtml, REBASELINE_ACTION, REBASELINE_LABEL } from '../src/book-check.js';
import { composeInitSource } from '../src/init-source.js';
import { bookFingerprint } from '../src/fp-hash.js';
import * as bookSource from '../web/book-source.js';
import { createBookRebaselineHub } from '../web/book-rebaseline.js';

// ─────────────────── ① 纯函数：判断 ───────────────────

test('leg112 ①-a：同一本书 ⇒ changed=false（不许把"没换"报成"换了"）', () => {
    const r = checkBookSource({ stored: 'fnv1a_abc_1', fresh: 'fnv1a_abc_1' });
    assert.deepEqual(r, { changed: false, stored: 'fnv1a_abc_1', fresh: 'fnv1a_abc_1' });
});

test('leg112 ①-b：换了一本书 ⇒ changed=true（两个指纹都交出来，面板要印给玩家看）', () => {
    const r = checkBookSource({ stored: 'fnv1a_old_1', fresh: 'fnv1a_new_2' });
    assert.equal(r.changed, true);
    assert.equal(r.stored, 'fnv1a_old_1');
    assert.equal(r.fresh, 'fnv1a_new_2');
});

test('★★leg112 ①-c：空着就是空着——任一侧没有指纹 / 这次没读到书 ⇒ 一律 null（什么都不说）', () => {
    // 老账没有指纹（leg26 之前建的档）
    assert.equal(checkBookSource({ stored: '', fresh: 'fnv1a_x_1' }), null, '★账上没有指纹 ⇒ 无从比对，不是"变了"');
    // 这次没合订出文本（书没挂载/读不到）
    assert.equal(checkBookSource({ stored: 'fnv1a_x_1', fresh: '' }), null, '★★绝不拿"读不到"当"书变了"（红线 2）');
    // 两侧都空
    assert.equal(checkBookSource({ stored: '', fresh: '' }), null);
    // 显式说"这次没读到书"（即使调用方传了 fresh 也不判断）
    assert.equal(checkBookSource({ stored: 'a', fresh: 'b', sourceOk: false }), null, '★sourceOk=false ⇒ 不判断');
    // 什么都不传
    assert.equal(checkBookSource(), null);
});

// ─────────────────── ② 纯函数：措辞（★玩家可见文案不许夹英文/引擎术语） ───────────────────

test('leg112 ②-a：两句话都必须说清"做了什么/没做什么"，且给得出下一步', () => {
    const changed = bookChangedStatus({ stored: 'fnv1a_old_1', fresh: 'fnv1a_new_2' });
    assert.ok(changed.includes('书换了'), '★第一句要直说"书换了"');
    assert.ok(changed.includes('fnv1a_old_1') && changed.includes('fnv1a_new_2'), '★两个指纹都要印出来（可对账）');
    assert.ok(changed.includes(REBASELINE_LABEL), '★必须告诉玩家那颗按钮叫什么（否则他不知道下一步按哪）');
    const done = rebaselinedStatus({ fresh: 'fnv1a_new_2' });
    assert.ok(done.includes('fnv1a_new_2'), '★定基之后要报新的指纹');
    assert.ok(done.includes('没重抽'), '★★必须写明**设定没有重抽**——否则玩家会以为设定已经跟着新书更新了（那是假的）');
});

test('leg112 ②-b：横幅只在"真换了"时出；且指纹一律转义（不许把引擎产物直接拼进 HTML）', () => {
    assert.equal(bookChangedBannerHtml(null), '', '★无从判断 ⇒ 一个字都不画');
    assert.equal(bookChangedBannerHtml({ changed: false }), '', '★没换 ⇒ 一个字都不画');
    const html = bookChangedBannerHtml({ changed: true, stored: 'A', fresh: 'B' });
    assert.ok(html.includes(`data-action="${REBASELINE_ACTION}"`), '★按钮必须挂 data-action（否则点了没反应——leg25f 那条病历）');
    assert.ok(html.includes(REBASELINE_LABEL), '★按钮上要印人话');
    // ★转义自证：喂一个带标签的指纹进去，必须被转义（防"引擎产物直接进 HTML"）
    const evil = bookChangedBannerHtml({ changed: true, stored: '<img src=x onerror=1>', fresh: 'B' }, (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])));
    assert.ok(!evil.includes('<img'), '★★指纹必须转义后再上屏');
});

// ─────────────────── ③ 接线：checkCurrentBook 真跑（注入 fake ST ctx） ───────────────────

// fake ST ctx：卡内置书（`character_book`）——与 `test/web-book-source-layout.test.js` 同一形状
// ★★（dsh 有界跟进 · Task 1 复查遗留项 1）：卡上点名挂了世界书（`data.extensions.world = '大荒'`），
//   ⇒ 夹具**必须同时给出那本书的取书口**（`loadWorldInfo`）。此前这一格没有取书口 = "挂载了但没读到"，
//   在本笔之前它被当成"读到了一份少一点的书"照样算指纹（正是遗留项 1 那个假警报）；
//   修好之后那一态如实算"未读全 ⇒ 不判断"⇒ 这三条会红——**红的是夹具的口径，不是断言**。
//   ⇒ 照 `test/web-book-source-layout.test.js` ⑥ 同一条治法给夹具补上"真读得到"的来源
//   （读到零条也算读到了）；**断言一字未改**。"挂载了没读到"这一态由 ③′ 的三条回归单独钉住。
function fakeCtx(entries) {
    const cardBook = { entries };
    const character = { name: '大荒z', data: { extensions: { world: '大荒' }, character_book: cardBook }, character_book: cardBook };
    return { character, characters: [character], characterId: 0, extensionSettings: {}, chatMetadata: {},
        loadWorldInfo: async (name) => (name === '大荒' ? { entries: [] } : null) };
}
const BOOK = [
    { key: '昆仑道宫', comment: '昆仑道宫', content: '- 清玄真人 (男, T7合体中期): 掌教。' },
    { key: '万法阁', comment: '万法阁', content: '- 公输巧 (男, T4金丹后期): 阁主。' },
];

test('★★leg112 ③-a：账上指纹 = 现在这本书 ⇒ changed=false（接线真跑，不是 grep）', async () => {
    const ctx = fakeCtx(BOOK);
    const { entries } = await bookSource.collectWorldInfoEntries(ctx, ctx.character);
    const fpNow = bookFingerprint(composeInitSource({ character: ctx.character, worldInfoEntries: entries }).text);
    const world = { context: { setting: { frozen: { fingerprint: fpNow } } } };
    const r = await bookSource.checkCurrentBook(world, { ctx });
    assert.equal(r?.changed, false, `★同一本书必须判"没换"（算出来 ${fpNow}）`);
});

test('★★leg112 ③-b：账上指纹是另一本 ⇒ changed=true，且两侧指纹都如实交出来', async () => {
    const ctx = fakeCtx(BOOK);
    const world = { context: { setting: { frozen: { fingerprint: 'fnv1a_别的书_1' } } } };
    const r = await bookSource.checkCurrentBook(world, { ctx });
    assert.equal(r?.changed, true, '★换了书必须判"换了"');
    assert.equal(r.stored, 'fnv1a_别的书_1');
    assert.ok(r.fresh.startsWith('fnv1a_'), '★现算的指纹要交出来');
});

test('★★leg112 ③-c：书真的改了（同一条目正文变了）⇒ changed=true（这才是它要治的那件事）', async () => {
    const ctx = fakeCtx(BOOK);
    const fpOld = bookFingerprint(composeInitSource({ character: ctx.character, worldInfoEntries: BOOK }).text);
    const ctx2 = fakeCtx([BOOK[0], { ...BOOK[1], content: '- 公输巧 (男, T9渡劫巅峰): 阁主，已飞升。' }]);
    const world = { context: { setting: { frozen: { fingerprint: fpOld } } } };
    const r = await bookSource.checkCurrentBook(world, { ctx: ctx2 });
    assert.equal(r?.changed, true, '★书里改了一句 ⇒ 指纹必须变（否则这条检测形同虚设）');
});

test('leg112 ③-d：账上没有指纹（老账）/ 一本书都没挂 ⇒ null，且绝不抛', async () => {
    // 老账：frozen 里没有 fingerprint
    assert.equal(await bookSource.checkCurrentBook({ context: { setting: { frozen: {} } } }, { ctx: fakeCtx(BOOK) }), null);
    // 书没挂载：卡上没有内置书、也没有世界书名 ⇒ 合订不出文本 ⇒ fresh 为空 ⇒ 不判断
    const noBook = { character: { name: '无书卡', data: {} }, characters: [{ name: '无书卡', data: {} }], characterId: 0, extensionSettings: {}, chatMetadata: {} };
    const r = await bookSource.checkCurrentBook({ context: { setting: { frozen: { fingerprint: 'fnv1a_x_1' } } } }, { ctx: noBook });
    assert.equal(r, null, '★★书没读到 ⇒ 一句话都不说（绝不拿"读不到"当"书变了"）');
    // ctx 为 null（没有 ST 上下文）⇒ 同样不抛
    assert.equal(await bookSource.checkCurrentBook({ context: { setting: { frozen: { fingerprint: 'x' } } } }, { ctx: null }), null);
});

// ─────────── ③′ 接线：**未读全 ⇒ 不判断**（Task 1 复查遗留项 1 · dsh 有界跟进） ───────────
//
// ★病（基线）：`currentBookFingerprint` 只看"合订出没出文本"，**不看** `collectWorldInfoEntries(...).incomplete`
//   ⇒ 某本挂载书这次读不到时，它拿**部分文本**算出一个"新指纹"，与账上（完整时算的）一比就报"书换了"——
//   书一个字没改，只是这次没读全。这与本文件顶上那条红线同源：**绝不拿"读不到"当"书变了"**
//   （`src/book-check.js` 口径②；`web/book-source.js` 三态纪律）。卡还在懒加载（浅卡）同理：
//   **卡四件套也是这份指纹源的一部分**，没到手就不许拿剩下的部分文本下判断。
//
// ★夹具纪律（与 ③ 的 `fakeCtx` 同一形状）：卡点名挂了世界书 ⇒ 夹具必须让那本书**真读得到**
//   （"点名了书却没有取书口" = 挂载了但没读到，正是下面 1-b 要治的那一态）。

const CARD_ENTRY = { key: '昆仑道宫', comment: '昆仑道宫', content: '- 清玄真人 (男, T7合体中期): 掌教。' };
const MOUNTED_ENTRY = { key: '万法阁', comment: '万法阁', content: '- 公输巧 (男, T4金丹后期): 阁主。' };

/** 完整可读的夹具：卡内置书 + 卡上点名挂的世界书（`failMounted` ⇒ 那本挂载书这次读不到）。 */
function mountedCtx({ failMounted = false } = {}) {
    const cardBook = { entries: [CARD_ENTRY] };
    const character = { name: '大荒z', avatar: 'a.png', data: { extensions: { world: '大荒' }, character_book: cardBook }, character_book: cardBook };
    return {
        character, characters: [character], characterId: 0, extensionSettings: {}, chatMetadata: {},
        loadWorldInfo: async (name) => (name === '大荒' ? (failMounted ? null : { entries: [MOUNTED_ENTRY] }) : null),
    };
}

/** 同一场对话的两种读卡态：全卡（四件套齐）与 ST 的浅卡（`toShallow()`：四件套与卡上世界名都不在）。 */
function cardCtx({ shallow = false } = {}) {
    const character = shallow
        ? { shallow: true, name: '大荒z', avatar: 'a.png', data: {} }
        : { name: '大荒z', avatar: 'a.png', description: '一个修真世界。', data: {} };
    return {
        characterId: 0, characters: [character], extensionSettings: {}, chatMetadata: { world_info: '大荒' },
        loadWorldInfo: async (name) => (name === '大荒' ? { entries: [MOUNTED_ENTRY] } : null),
    };
}

/**
 * ★★（Task 1 二次复查 · Minor）：**预期中的诊断警告要收走并断言**——"未读全就不判断"这条是
 *   `currentBookFingerprint` / `bookTextForEntity` 的**有意**行为（`console.warn` 是给人看的诊断），
 *   但它混在通过输出里会让"全绿"看起来像有毛病。收走 ≠ 吞掉：
 *   **条数必须与预期一致**（多了少了都当场断言失败，并把收到的原文一起报出来），
 *   断言失败本身照旧可见；`finally` 一定还原，意外多出来的警告照样留在输出里。
 */
async function captureWarnings(fn) {
    const saved = console.warn;
    const lines = [];
    console.warn = (...args) => { lines.push(args.map(x => String(x)).join(' ')); };
    try { return { result: await fn(), lines }; } finally { console.warn = saved; }
}
const NO_WARN = (lines, what) => assert.deepEqual(lines, [], `${what}：这一段不该有警告输出`);

test('★遗留项1-a：完整读到的书 ⇒ 照旧判"没换"（正向对照：治未读全不许把这条治坏）', async () => {
    const stored = (await bookSource.currentBookFingerprint(mountedCtx())).fresh;
    assert.ok(stored.startsWith('fnv1a_'), `★夹具必须真合订出文本（否则下面几条是空绿），实际 ${stored}`);
    const r = await bookSource.checkCurrentBook({ context: { setting: { frozen: { fingerprint: stored } } } }, { ctx: mountedCtx() });
    assert.equal(r?.changed, false, '★读全了 ⇒ 同一本书照旧判"没换"');
});

test('★★遗留项1-b：一本挂载书读不到（只剩部分文本）⇒ 绝不报"书换了"，一句话都不说', async () => {
    const stored = (await bookSource.currentBookFingerprint(mountedCtx())).fresh;
    assert.ok(stored.startsWith('fnv1a_'), '★账上来路必须是"完整时"算的指纹');
    const partialCtx = mountedCtx({ failMounted: true });
    const partial = await captureWarnings(() => bookSource.currentBookFingerprint(partialCtx));
    assert.equal(partial.result.fresh, '', '★★未读全 ⇒ 指纹必须是空的（宁可不判断，也不拿部分文本算一个"新指纹"）');
    assert.equal(partial.lines.length, 1, `★这一跑只该说一句"没读全"的诊断，实收：${JSON.stringify(partial.lines)}`);
    assert.ok(partial.lines[0].includes('没读全'), `★诊断要说清理由（未读全 ≠ 书换了），实为：${partial.lines[0]}`);
    const late = await captureWarnings(() => bookSource.checkCurrentBook({ context: { setting: { frozen: { fingerprint: stored } } } },
        { ctx: mountedCtx({ failMounted: true }) }));
    assert.equal(late.result, null, '★★书一个字没改（只是这次没读全）⇒ 一句话都不许说（绝不拿"读不到"当"书变了"）');
    assert.equal(late.lines.length, 1, `★同样只该有一句诊断，实收：${JSON.stringify(late.lines)}`);
    assert.ok(late.lines[0].includes('没读全'), `★诊断理由要一致，实为：${late.lines[0]}`);
    // ★反证：这份"部分文本"确实会算出**另一个指纹**（否则上面两条是空绿——病根本没被复现）
    const got = await bookSource.collectWorldInfoEntries(partialCtx, partialCtx.character);
    assert.equal(got.incomplete, true, '★夹具必须真是"挂载了但没读到"（不是"书里没有"）');
    const text = composeInitSource({ character: partialCtx.character, worldInfoEntries: got.entries, worldSources: got.worldSources }).text;
    assert.notEqual(bookFingerprint(text), stored, '★★部分文本算出来确实是另一个指纹——不修就会报假警报');
});

test('★★遗留项1-c：卡还没加载完（浅卡）⇒ 也不许报"书换了"（卡四件套也是指纹源的一部分）', async () => {
    const stored = (await bookSource.currentBookFingerprint(cardCtx())).fresh;
    assert.ok(stored.startsWith('fnv1a_'), '★账上来路必须是"全卡时"算的指纹');
    const shallowCtx = cardCtx({ shallow: true });
    const shallow = await captureWarnings(() => bookSource.currentBookFingerprint(shallowCtx));
    assert.equal(shallow.result.fresh, '', '★★卡四件套还没到手 ⇒ 同样不许拿剩下的部分文本算指纹');
    assert.equal(shallow.lines.length, 1, `★这一跑只该说一句"没读全"的诊断，实收：${JSON.stringify(shallow.lines)}`);
    assert.ok(shallow.lines[0].includes('没读全'), `★诊断要说清理由，实为：${shallow.lines[0]}`);
    const late = await captureWarnings(() => bookSource.checkCurrentBook({ context: { setting: { frozen: { fingerprint: stored } } } }, { ctx: cardCtx({ shallow: true }) }));
    assert.equal(late.result, null, '★★卡还在懒加载 ⇒ 一句话都不许说');
    assert.equal(late.lines.length, 1, `★同样只该有一句诊断，实收：${JSON.stringify(late.lines)}`);
    assert.ok(late.lines[0].includes('没读全'), `★诊断理由要一致，实为：${late.lines[0]}`);
    // ★反证：这一态**不是**"取书失败"（挂载书真读到了、有料），而是"卡件没到手"——必须由浅卡这一关单独拦住
    const got = await bookSource.collectWorldInfoEntries(shallowCtx, shallowCtx.characters[0]);
    assert.equal(got.incomplete, false, '★这一次不是"挂载书没读到"（那条路由 1-b 拦）——所以必须有第二关');
    const text = composeInitSource({ character: shallowCtx.characters[0], worldInfoEntries: got.entries, worldSources: got.worldSources }).text;
    assert.ok(text, '★浅卡这次是有料的（世界书读得到）——只是卡四件套没到手');
    assert.notEqual(bookFingerprint(text), stored, '★★不把浅卡当"未读全" ⇒ 这份部分文本就会报假警报');
});

test('★遗留项1-d：读全的这次一句话都不说（正向对照：收警告不许把正常路径也收掉）', async () => {
    const clean = await captureWarnings(() => bookSource.currentBookFingerprint(mountedCtx()));
    assert.ok(clean.result.fresh.startsWith('fnv1a_'), '★读全了 ⇒ 照旧算出指纹');
    NO_WARN(clean.lines, '完整读到');
    const shallowFree = await captureWarnings(() => bookSource.currentBookFingerprint(cardCtx()));
    assert.ok(shallowFree.result.fresh.startsWith('fnv1a_'));
    NO_WARN(shallowFree.lines, '全卡');
});

// ─────────────────── ④ 接线：那一族（hub）真跑（注入假依赖） ───────────────────

/** 造一个"只记账、不碰真世界"的假依赖包（本仓纪律：接线判据要真跑收口函数）。 */
function fakeDeps({ stored = 'fnv1a_old_1', fresh = 'fnv1a_new_2' } = {}) {
    const log = { status: [], wrote: null, flushed: 0, refreshed: [], sections: [] };
    let world = { version: 1, context: { world: '大荒', setting: { frozen: { fingerprint: stored, extractedAt: 't', canon: {} } } }, entities: [], meta: { tick: 3 } };
    const deps = {
        checkCurrentBook: async () => (stored && fresh ? { changed: stored !== fresh, stored, fresh } : null),
        currentBookFingerprint: async () => ({ fresh, usedChars: 123, entries: 2 }),
        getCtx: () => ({}),
        hot: {
            readHotMeta: () => ({ world }),
            loadHotAccount: (m) => m.world,
            writeHotMeta: (m) => { log.wrote = m; },
            hotAccountShape: (w) => ({ world: w }),
            flushHotMeta: async () => { log.flushed += 1; return { ok: true }; },
        },
        ui: {
            refreshWorld: (w) => log.refreshed.push(w),
            refreshSections: (n) => log.sections.push(n),
            setStatus: (t) => log.status.push(t),
        },
    };
    return { deps, log, worldOf: () => world };
}

test('★★leg112 ④-a：载入期发现换了书 ⇒ **状态条收到那一句**（接线真跑）', async () => {
    const { deps, log } = fakeDeps({ stored: 'fnv1a_old_1', fresh: 'fnv1a_new_2' });
    const hub = createBookRebaselineHub(deps);
    const r = await hub.runLoadCheck({ context: { setting: { frozen: { fingerprint: 'fnv1a_old_1' } } } });
    assert.equal(r.changed, true);
    assert.equal(log.status.length, 1, '★必须说一句（玩家此前完全不知道这件事）');
    assert.ok(log.status[0].includes('书换了'), `★说的必须是那句话，实为：${log.status[0]}`);
    assert.deepEqual(hub.result(), r, '★读数要能被面板取到（否则那一行与按钮画不出来）');
});

test('★★leg112 ④-b：同一本书 ⇒ **一个字都不说**（不许每次载入都刷屏）', async () => {
    const { deps, log } = fakeDeps({ stored: 'same', fresh: 'same' });
    const hub = createBookRebaselineHub(deps);
    await hub.runLoadCheck({});
    assert.deepEqual(log.status, [], '★没换书就不出声');
    assert.equal(hub.result().changed, false);
});

test('leg112 ④-c：检测自己抛错 ⇒ 载入照常（降级成 null，绝不阻塞）', async () => {
    const { deps, log } = fakeDeps();
    deps.checkCurrentBook = async () => { throw new Error('取书炸了'); };
    const hub = createBookRebaselineHub(deps);
    const r = await hub.runLoadCheck({});
    assert.equal(r, null, '★失败降级成 null');
    assert.deepEqual(log.status, [], '★失败不出声（不谎报"书换了"）');
});

test('★★leg112 ④-d：「就按现在这本算」**只改指纹那一格**（设定正文/名册/事件/轮次一个字不动）', async () => {
    const { deps, log } = fakeDeps({ stored: 'fnv1a_old_1', fresh: 'fnv1a_new_2' });
    const hub = createBookRebaselineHub(deps);
    await hub.runLoadCheck({});
    log.status.length = 0;
    await hub.handler();
    const w = log.wrote.world;
    assert.equal(w.context.setting.frozen.fingerprint, 'fnv1a_new_2', '★指纹必须换成现在这本书的');
    assert.equal(w.context.setting.frozen.extractedAt, 't', '★"抽取于"那个时刻**不许动**（本次没重抽）');
    assert.deepEqual(w.context.setting.frozen.canon, {}, '★设定正文一个字不动');
    assert.equal(w.context.world, '大荒', '★世界名不动');
    assert.equal(w.meta.tick, 3, '★轮次不动');
    assert.equal(log.flushed, 1, '★必须显式落盘（不落盘 ⇒ 刷新就回滚、下次又报"书换了"）');
    assert.deepEqual(log.sections, [['setting']], '★要重画设定页（那一行与按钮得消失）');
    assert.equal(hub.result().changed, false, '★定基之后读数要变"没换"（否则按钮一直挂着）');
    assert.ok(log.status.at(-1).includes('没重抽'), '★定基那句话要写明"设定没重抽"');
});

test('★★leg112 ④-e：取不到书 ⇒ **一个字节都不写**（绝不写一个空指纹进账）', async () => {
    const { deps, log } = fakeDeps({ stored: 'fnv1a_old_1', fresh: '' });
    deps.currentBookFingerprint = async () => ({ fresh: '', usedChars: 0, entries: 0 });
    const hub = createBookRebaselineHub(deps);
    await hub.handler();
    assert.equal(log.wrote, null, '★★没读到书 ⇒ 不写账（写空指纹会让下次抽取的缓存恒不命中，且账上"来路"变假）');
    assert.equal(log.flushed, 0, '★也不落盘');
    assert.ok(log.status.at(-1).includes('没读到书'), '★要如实说为什么没做');
});

test('leg112 ④-f：世界还没载入 ⇒ 如实报错、不写账、不抛（★含"半成品档"那一态）', async () => {
    const { deps: d2, log: l2 } = fakeDeps();
    // ★注意：要改的是**hub 真正读的那一份**（`deps.hot` 里的口）——改 `d2.readHotMeta` 是够不到的
    //   （hub 解构的是 `hot` 那一个对象；这正是本笔第一版判据自己踩的坑，留档防复发）。
    d2.hot.readHotMeta = () => null;
    const hub2 = createBookRebaselineHub(d2);
    await hub2.handler();
    assert.equal(l2.wrote, null, '★世界不在 ⇒ 不写账');
    assert.ok(l2.status.at(-1).includes('世界还没载入'), `实为：${l2.status.at(-1)}`);
    // ★第二态：world 在、但账里没有 setting 那一层（半成品档）⇒ 同样不写、如实说
    const { deps: d3, log: l3 } = fakeDeps();
    d3.hot.loadHotAccount = () => ({ version: 1, context: { world: '半成品' } });
    const hub3 = createBookRebaselineHub(d3);
    await hub3.handler();
    assert.equal(l3.wrote, null, '★★账里没有设定那一层 ⇒ 不许写（否则等于凭空造一格 frozen）');
    assert.ok(l3.status.at(-1).includes('没有设定那一层'), `实为：${l3.status.at(-1)}`);
});

// ─────────────────── ⑤ 接线层真的接上了（源码锁 + 反向自证） ───────────────────

test('★★leg112 ⑤：接线层必须真的注入了依赖、挂上了动作、并把读数交给渲染层', async () => {
    const { readFileSync } = await import('node:fs');
    const web = readFileSync(new URL('../web/index.js', import.meta.url), 'utf8');
    assert.match(web, /injectBookRebaseline\(\{/, '★注入口必须有人用（"建了注入口但没人用" = leg25f 那条病历）');
    assert.match(web, /await runBookLoadCheck\(world2\)/, '★载入期必须真的量一次');
    assert.match(web, /bus\[REBASELINE_ACTION\] = rebaselineHandler/, '★按钮的动作必须挂在总线上（否则点了没反应）');
    assert.match(web, /bookCheck: bookCheckResult\(\)/, '★渲染层必须拿到读数（否则那一行与按钮画不出来）');
    // ★顺序自证：量必须在 refreshWorld **之前**（否则"书换了"要等下一次重绘才出现）
    const at = web.indexOf('await runBookLoadCheck(world2)');
    const rw = web.indexOf('refreshWorld(world2, { oldVolumes: LISTED_VOLUMES })');
    assert.ok(at > 0 && rw > 0 && at < rw, '★★必须先量后画（本仓"接线晚一拍"的老病）');
});

test('★leg112 ⑤-b：渲染层真的把那一行贴进设定页（且只读 config，不自己算）', async () => {
    const { readFileSync } = await import('node:fs');
    const render = readFileSync(new URL('../src/render.js', import.meta.url), 'utf8');
    assert.match(render, /bookChangedBannerHtml\(config\.bookCheck, escapeHtml\)/, '★设定页要贴那一行（文案与标记由 src/book-check.js 一处说了算）');
});
