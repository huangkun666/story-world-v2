import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeInitSource } from '../src/init-source.js';
import { entrySelectionId } from '../src/abstract-selection.js';
import { setAbstractSelectionSource, setCtxSource, currentBookFingerprint, resetBookCache, bookEntriesForInherit, bookTextForEntity, bookTextForRoots, collectWorldInfoEntries } from '../web/book-source.js';
import { bookFingerprint } from '../src/fp-hash.js';
const entries = [{ uid: 1, _sw2Source: '书', comment: '人物_甲', key: ['甲'], content: '甲在北城。' },
    { uid: 2, _sw2Source: '书', comment: '人物_乙', key: ['乙'], content: '乙在南城。' }];
test('实际合订和题名来源均不得使用未选条目', () => {
    const result = composeInitSource({ worldInfoEntries: entries, selection: { mode: 'custom', selectedIds: [entrySelectionId(entries[0])] } });
    assert.match(result.text, /甲在北城/); assert.ok(!result.text.includes('乙在南城'));
    assert.ok(!JSON.stringify(result.titleRoster || []).includes('乙'));
});

test('禁用原文全文由合订、补查、继承和起根实际共用，选择修改即时生效', async () => {
    const e = { uid: 10, comment: '[InitVar]甲', key: ['甲'], content: '甲<script>原文资料</script>乙', disable: true };
    const ctx = { chatId: 'full-read', character: { name: '卡', description: '未选卡正文' }, worldInfo: [e] };
    const id = entrySelectionId(e);
    let selection = { mode: 'custom', selectedIds: [id], reads: { [id]: { mode: 'full' } } };
    setCtxSource(() => ctx); setAbstractSelectionSource(() => selection); resetBookCache();
    try {
        const composed = composeInitSource({ worldInfoEntries: [e], character: ctx.character, selection });
        assert.deepEqual(await bookEntriesForInherit(), composed.effectiveEntries);
        const root = await bookTextForRoots(ctx);
        assert.equal(root.text, composed.text);
        assert.ok((await bookTextForEntity({ name: '甲' }, ctx)).entries[0].text.includes('<script>原文资料</script>'));
        assert.equal((await currentBookFingerprint(ctx)).fresh.length > 0, true);
        selection = { mode: 'custom', selectedIds: [], reads: {} };
        assert.equal((await bookEntriesForInherit()).length, 0);
        assert.equal((await bookTextForRoots(ctx)).text, '');
        assert.deepEqual(e, { uid: 10, comment: '[InitVar]甲', key: ['甲'], content: '甲<script>原文资料</script>乙', disable: true });
    } finally { setAbstractSelectionSource(() => ({ mode: 'default' })); resetBookCache(); }
});

test('选段外正文不进补查和起根，改未选文字只使选段失效且不回退', async () => {
    const e = { uid: 11, comment: '甲', key: ['甲'], content: '甲在北城。乙在南城。' };
    const id = entrySelectionId(e);
    const ctx = { chatId: 'segments-read', worldInfo: [e] };
    const selection = { mode: 'custom', selectedIds: [id], reads: { [id]: { mode: 'segments', originalText: e.content, segments: [{ start: 0, end: 6, text: '甲在北城。' }] } } };
    selection.reads[id].segments[0].end = '甲在北城。'.length;
    setAbstractSelectionSource(() => selection); resetBookCache();
    try {
        const root = await bookTextForRoots(ctx);
        assert.ok(root.text.includes('甲在北城'));
        assert.ok(!root.text.includes('乙在南城'));
        assert.ok(!(await bookTextForEntity({ name: '甲' }, ctx)).entries[0].text.includes('乙'));
        e.content += '变动'; resetBookCache();
        assert.equal((await bookTextForRoots(ctx)).text, '');
    } finally { setAbstractSelectionSource(() => ({ mode: 'default' })); resetBookCache(); }
});

test('完整取书保留跨来源相同正文与卡内空正文，缓存切聊天不串书', async () => {
    const character = { name: '卡', character_book: { entries: [{ id: 1, name: '空条目', content: '' }] } };
    const ctx = { chatId: 'first', character, chatMetadata: { world_info: ['书甲', '书乙', '失败书'] }, loadWorldInfo: async name => name === '失败书' ? null : { entries: [{ uid: 1, comment: '甲', content: '甲住北城。' }] } };
    const got = await collectWorldInfoEntries(ctx, character);
    assert.equal(got.entries.length, 3);
    assert.ok(got.worldSources.some(s => s.name === '失败书' && !s.ok));
    setAbstractSelectionSource(() => ({ mode: 'default' })); resetBookCache();
    try {
        assert.ok((await bookTextForRoots(ctx)).text.includes('甲住北城'));
        assert.ok((await bookTextForRoots({ chatId: 'second', worldInfo: [{ comment: '丙', content: '丙住东城。' }] })).text.includes('丙住东城'));
    } finally { resetBookCache(); }
});
test('重置或切聊天时未完成的旧取书不覆盖新缓存', async () => {
    let release;
    const delayed = new Promise(resolve => { release = resolve; });
    const ctx = { chatId: 'before', chatMetadata: { world_info: '旧书' }, loadWorldInfo: () => delayed };
    setAbstractSelectionSource(() => ({ mode: 'default' })); resetBookCache();
    const old = bookTextForRoots(ctx);
    await new Promise(resolve => setImmediate(resolve));
    resetBookCache();
    ctx.chatId = 'after'; ctx.chatMetadata.world_info = '新书';
    ctx.loadWorldInfo = async () => ({ entries: [{ uid: 1, comment: '新', content: '新书正文' }] });
    assert.ok((await bookTextForRoots(ctx)).text.includes('新书正文'));
    release({ entries: [{ uid: 1, comment: '旧', content: '旧书正文' }] });
    assert.equal((await old).text, '');
    assert.ok((await bookTextForRoots(ctx)).text.includes('新书正文'));
    resetBookCache();
});
test('酒馆每次返回新上下文外壳时，同一聊天仍缓存书且切卡自动失效', async () => {
    let calls = 0;
    const character = { name: '卡甲', world: '书甲' };
    const loadWorldInfo = async name => { calls += 1; return { entries: [{ uid: 1, comment: name, content: name + '正文' }] }; };
    const fresh = () => ({ chatId: 'same-chat', characterId: 0, character, loadWorldInfo });
    resetBookCache();
    assert.ok((await bookTextForRoots(fresh())).text.includes('书甲正文'));
    await bookTextForRoots(fresh());
    assert.equal(calls, 1);
    character.world = '书乙';
    assert.ok((await bookTextForRoots(fresh())).text.includes('书乙正文'));
    assert.equal(calls, 2);
    resetBookCache();
});
test('指纹取书请求在切聊天后不交出旧书指纹', async () => {
    let release;
    const ctx = { chatId: 'fp-before', chatMetadata: { world_info: '旧书' }, loadWorldInfo: () => new Promise(resolve => { release = resolve; }) };
    const pending = currentBookFingerprint(ctx);
    await new Promise(resolve => setImmediate(resolve));
    ctx.chatId = 'fp-after';
    release({ entries: [{ uid: 1, comment: '旧', content: '旧书正文' }] });
    assert.equal((await pending).fresh, '');
});
test('卡内同时有 key 和 keys 的旧格式，在收集与合订两条路使用同一身份', async () => {
    const character = { name: '双键卡', character_book: { entries: [{ name: '无号条目', key: ['旧键'], keys: ['卡键'], content: '卡正文' }] } };
    const collected = await collectWorldInfoEntries({ worldInfo: [] }, character);
    const result = composeInitSource({ character, worldInfoEntries: collected.entries });
    assert.equal(result.effectiveEntries.length, 1);
    assert.equal(result.sourceItems.filter(s => s.kind === 'world-entry').length, 1);
});
test('角色内置书不能绕过自选空集合', () => {
    const character = { name: '角色', character_book: { entries: [{ id: 2, name: '隐形人物', content: '隐形人物在城里' }] } };
    const result = composeInitSource({ character, selection: { mode: 'custom', selectedIds: [] } });
    assert.ok(!String(result.text).includes('隐形人物'));
});

test('旧宿主合订口也列出卡内置书，缺 UID 的条目换序后选择身份稳定', async () => {
    const character = { name: '卡', character_book: { entries: [{ name: '内置条目', keys: ['内置'], content: '内置人物住在北城。' }, { name: '另一条', content: '另一人在南城。' }] } };
    const before = (await collectWorldInfoEntries({ worldInfo: entries }, character)).entries;
    const id = entrySelectionId(before.find(e => e.comment === '内置条目'));
    character.character_book.entries.reverse();
    const after = (await collectWorldInfoEntries({ worldInfo: entries }, character)).entries;
    assert.equal(after.length, 4); assert.equal(entrySelectionId(after.find(e => e.comment === '内置条目')), id);
    const source = composeInitSource({ character, worldInfoEntries: after, selection: { mode: 'custom', selectedIds: [id] } });
    assert.ok(source.text.includes('内置人物')); assert.ok(!source.text.includes('另一人在南城'));
});

test('来源选择同时约束查书和继承，指纹仅随有效输入改变', async () => {
    const ctx = { chatId: 'selection-fixture', worldInfo: structuredClone(entries), characters: [] };
    let selection = { mode: 'custom', selectedIds: [entrySelectionId(entries[0])] };
    setCtxSource(() => ctx); setAbstractSelectionSource(() => selection); resetBookCache();
    try {
        assert.equal((await bookEntriesForInherit()).length, 1);
        assert.equal((await bookTextForEntity({ name: '乙' }, ctx)).entries.length, 0);
        const before = (await currentBookFingerprint(ctx)).fresh;
        ctx.worldInfo[1].content = '未选择的乙改动正文';
        assert.equal((await currentBookFingerprint(ctx)).fresh, before);
        ctx.worldInfo[0].content = '甲移居新城';
        assert.notEqual((await currentBookFingerprint(ctx)).fresh, before);
        selection = { mode: 'custom', selectedIds: [] }; resetBookCache();
        assert.equal((await bookEntriesForInherit()).length, 0);
    } finally { setAbstractSelectionSource(() => ({ mode: 'default' })); resetBookCache(); }
});

// ============ 复查整改（Task 1 review · 重要项 3、4）：未读全 ≠ 书里没有 · live 归属 ============

/**
 * ★★（Task1 末次复查 · Minor）：**预期中的"未读全"诊断要收走并断言**（`book-check.test.js` 同款治法）。
 *   `console.warn` 是给人看的诊断，不是失败；但它混在通过输出里会让"全绿"看起来像有毛病。
 *   收走 ≠ 吞掉：**条数与理由都要断言**（多一句少一句当场失败并报出原文），
 *   `finally` 一定还原——**断言失败时警告照旧可见**，意外多出来的警告也留在输出里。
 */
async function captureWarnings(fn) {
    const saved = console.warn;
    const lines = [];
    console.warn = (...args) => { lines.push(args.map(x => String(x)).join(' ')); };
    try { return { result: await fn(), lines }; } finally { console.warn = saved; }
}

test('部分取书失败不得当成成功空书，失败的挂载来源必须重试', async () => {
    const calls = { 成功书: 0, 失败书: 0 };
    const ctx = {
        chatId: 'partial-read',
        chatMetadata: { world_info: ['成功书', '失败书'] },
        loadWorldInfo: async (name) => {
            calls[name] += 1;
            return name === '成功书' ? { entries: [] } : null;   // 一本真读到（书里就是空的），一本次次读不到
        },
    };
    resetBookCache();
    try {
        const first = await captureWarnings(() => bookTextForEntity({ name: '甲' }, ctx));
        assert.equal(first.result.ok, false, '有一本挂载书没读到 ⇒ 不许报"书里没有该名号"');
        assert.equal(first.lines.length, 1, `★这一跑只该说一句"没读全"的诊断，实收：${JSON.stringify(first.lines)}`);
        assert.ok(first.lines[0].includes('没读全'), `★诊断要说清理由（未读全 ≠ 书里没有），实为：${first.lines[0]}`);
        const second = await captureWarnings(() => bookTextForEntity({ name: '甲' }, ctx));
        assert.equal(second.result.ok, false);
        assert.equal(second.lines.length, 1, `★重试那一跑同样只该有一句诊断，实收：${JSON.stringify(second.lines)}`);
        assert.ok(second.lines[0].includes('没读全'), `★诊断理由要一致，实为：${second.lines[0]}`);
        assert.equal(calls.失败书, 2, '读不到的来源必须重试，不得被当成成功空书缓存');
        assert.equal(calls.成功书, 2, '来源未读全 ⇒ 整份结果不缓存（下轮重取）');
    } finally { resetBookCache(); }
});

test('读到的空书仍是书里没有，与未读全分形', async () => {
    const ctx = { chatId: 'read-empty', chatMetadata: { world_info: '成功书' }, loadWorldInfo: async () => ({ entries: [] }) };
    resetBookCache();
    try {
        const r = await bookTextForEntity({ name: '甲' }, ctx);
        assert.equal(r.ok, true, '书真读到了（只是没有该名号）⇒ 仍是确定"书里没有"，不许与读不到同形');
        assert.deepEqual(r.entries, []);
    } finally { resetBookCache(); }
});

test('角色卡正文还没加载时不得把查无此人判定成书里没有', async () => {
    const character = { name: '浅卡', shallow: true, data: {} };
    const ctx = { chatId: 'shallow-card', characters: [character], characterId: 0, chatMetadata: { world_info: '书' },
        loadWorldInfo: async () => ({ entries: [{ uid: 1, comment: '甲', content: '甲住北城。' }] }) };
    resetBookCache();
    try {
        const missing = await captureWarnings(() => bookTextForEntity({ name: '乙' }, ctx));
        assert.equal(missing.result.ok, false, '卡四件套还没到手 ⇒ 查无此人不等于书里没有');
        assert.equal(missing.lines.length, 1, `★查无此人这一跑只该说一句"没读全"的诊断，实收：${JSON.stringify(missing.lines)}`);
        assert.ok(missing.lines[0].includes('没读全'), `★诊断要说清理由，实为：${missing.lines[0]}`);
        const hit = await captureWarnings(() => bookTextForEntity({ name: '甲' }, ctx));
        assert.equal(hit.result.ok, true, '命中的名号照旧交出原文');
        assert.ok(hit.result.entries[0].text.includes('甲住北城'));
        assert.deepEqual(hit.lines, [], '命中这一跑不该有警告输出（未读全的警告只属于"查无此人"那一态）');
    } finally { resetBookCache(); }
});

test('一本书都没读到（世界书没挂载）时如实警告且不写痕迹', async () => {
    const ctx = { chatId: 'nothing-mounted' };
    resetBookCache();
    try {
        const missing = await captureWarnings(() => bookTextForEntity({ name: '甲' }, ctx));
        assert.equal(missing.result.ok, false, '一本书都没读到 ⇒ 不许报"书里没有该名号"');
        assert.equal(missing.lines.length, 1, `★这一跑只该说一句"没读到"的诊断，实收：${JSON.stringify(missing.lines)}`);
        assert.ok(missing.lines[0].includes('一本书都没读到'), `★诊断要说清理由（读不到 ≠ 书里没有），实为：${missing.lines[0]}`);
    } finally { resetBookCache(); }
});

test('live 上下文换成新对象后，未完成的旧请求不得交出旧书（继承）', async () => {
    let release;
    const pendingLoad = new Promise((resolve) => { release = resolve; });
    const oldCtx = { chatId: 'live-before', chatMetadata: { world_info: '旧书' }, loadWorldInfo: () => pendingLoad };
    let live = oldCtx;
    setCtxSource(() => live);
    resetBookCache();
    try {
        const pending = bookEntriesForInherit();
        await new Promise(resolve => setImmediate(resolve));
        live = { chatId: 'live-after', chatMetadata: { world_info: '新书' }, loadWorldInfo: async () => ({ entries: [{ uid: 1, comment: '新', content: '新书正文' }] }) };
        release({ entries: [{ uid: 1, comment: '旧', content: '旧书正文' }] });
        assert.deepEqual(await pending, [], '当前会话已换 ⇒ 旧书正文不许当"当前会话的书"交出去');
        assert.ok((await bookTextForRoots(live)).text.includes('新书正文'), '新上下文照旧读得到新书');
    } finally { setCtxSource(() => null); resetBookCache(); }
});

test('live 上下文换成新对象后，未完成的旧指纹请求交不出旧书指纹', async () => {
    let release;
    const oldCtx = { chatId: 'fp-live-before', chatMetadata: { world_info: '旧书' }, loadWorldInfo: () => new Promise(resolve => { release = resolve; }) };
    let live = oldCtx;
    setCtxSource(() => live);
    resetBookCache();
    try {
        const pending = currentBookFingerprint(oldCtx);
        await new Promise(resolve => setImmediate(resolve));
        live = { chatId: 'fp-live-after', chatMetadata: { world_info: '新书' }, loadWorldInfo: async () => ({ entries: [{ uid: 1, comment: '新', content: '新书正文' }] }) };
        release({ entries: [{ uid: 1, comment: '旧', content: '旧书正文' }] });
        assert.equal((await pending).fresh, '', '取证时已换会话 ⇒ 不交指纹（宁可不判断，也不拿旧书冒充现书）');
    } finally { setCtxSource(() => null); resetBookCache(); }
});

test('同一聊天换新 ctx 外壳不算换书，缓存照旧复用', async () => {
    let calls = 0;
    const character = { name: '卡甲', world: '书甲' };
    const loadWorldInfo = async name => { calls += 1; return { entries: [{ uid: 1, comment: name, content: name + '正文' }] }; };
    let live = { chatId: 'shell-live', characterId: 0, character, loadWorldInfo };
    setCtxSource(() => live);
    resetBookCache();
    try {
        assert.ok((await bookTextForRoots(live)).text.includes('书甲正文'));
        live = { chatId: 'shell-live', characterId: 0, character, loadWorldInfo };   // 新外壳、同一聊天与同一本书
        assert.ok((await bookTextForRoots(live)).text.includes('书甲正文'));
        assert.equal(calls, 1, '同一本书不算换书 ⇒ 缓存照旧复用');
    } finally { setCtxSource(() => null); resetBookCache(); }
});

// ============ 二次复查（Task 1 re-review · Important 2 边界）：legacy 来源版本 ============
//
// 病灶：live 归属只看 `bookContextIdentity`（聊天/角色/挂载设置），**不含宿主的 `ctx.worldInfo` 数组**
//   ⇒ 同一场对话里换掉那份 legacy 世界书（新数组、新正文）时，异步边界上的归属校验照样通过，
//   未完成的旧请求就把旧书交出去（继承交回旧正文；缓存也按旧 owner 命中）。它**不是**切聊天，
//   所以 `CHAT_CHANGED → loadWorld → resetBookCache` 那条路不会响。
// 口径：除语义归属外，还要**快照并校验 legacy 来源的引用与版本**——引用 = `ctx.worldInfo` 数组本体；
//   版本 = 逐格 uid + **正文的 32 位 FNV-1a** + 题名 + 触发词 + 禁用位（正文是**内容哈希**：
//   同长度换书、原地改正文都看得见）。缓存命中、异步返回两道边界都验；live 与显式外部 ctx
//   两条路都验**自己那份**来源（外部快照绝不许被现取 live 的书判掉）。
// 正向面：同一场对话**共享同一个数组**的新 ctx 外壳必须照旧读得到；显式传进来的外部 ctx 契约不变。
// ★夹具纪律（上一版这三条踩过，别再踩）：
//   ① legacy 数组走的是**同步收料路**（`collectWorldInfoEntries` 见数组就返回，压根不问 `loadWorldInfo`）
//      ⇒ 真 race 在 `await ensureCharacterLoaded` 的续体上——**必须在第一次 await 之前换掉来源**；
//      先 `await setImmediate` 只会让旧读取整份跑完（那不是"竞态红灯"，是夹具没打在竞态上）。
//   ② 也不许拿 `loadWorldInfo` 的调用计数当 legacy 路的缓存证据（那条路口本来就不经过它）；
//      计数证据留在**非 legacy** 的"新外壳复用缓存"用例里，legacy 路只认"交出来的正文对不对"。
//   ③ "正向"要对准**可观察行为**：共享数组 ⇒ 照旧读得到且内容正确；换了数组 ⇒ 交出的必须是新内容、不许漏旧料。

test('同一聊天换掉 legacy 世界书数组后，未完成的旧继承请求不得交出旧材料', async () => {
    const oldCtx = { chatId: 'same', worldInfo: [{ uid: 1, comment: '旧', content: '旧书正文' }] };
    let live = oldCtx;
    setCtxSource(() => live);
    resetBookCache();
    try {
        const pending = bookEntriesForInherit();
        // ★必须在第一次 await 之前换（见上面夹具纪律①）：真 race 在 `await ensureCharacterLoaded` 的续体上，
        //   而 legacy 收料是同步的——先 await 一次 setImmediate，旧读取早就整份跑完了。
        live = { chatId: 'same', worldInfo: [{ uid: 2, comment: '新', content: '新书正文' }] };   // 同一聊天、换掉那份 legacy 数组
        assert.deepEqual(await pending, [], '同一会话的 legacy 来源已换 ⇒ 旧材料不许当"当前会话的书"交出去');
        const fresh = await bookEntriesForInherit();
        assert.ok(fresh.some(e => String(e.content).includes('新书正文')), '新来源照旧读得到新书');
        assert.ok(!fresh.some(e => String(e.content).includes('旧书正文')), '旧书正文一个字都不许留在当前用料理');
    } finally { setCtxSource(() => null); resetBookCache(); }
});

test('legacy 数组在原地被改（同引用）时，未完成的旧读取不得把旧材料交出去', async () => {
    const oldCtx = { chatId: 'in-place', worldInfo: [{ uid: 1, comment: '旧', content: '旧书正文' }] };
    let live = oldCtx;
    setCtxSource(() => live);
    resetBookCache();
    try {
        const pending = bookEntriesForInherit();
        oldCtx.worldInfo[0].content = '当场改过的正文';       // 同引用、当场改 ⇒ 版本（内容哈希）必须看得见
        oldCtx.worldInfo.push({ uid: 2, comment: '补', content: '新补的正文' });
        assert.deepEqual(await pending, [], '同引用的 legacy 数组当场变了 ⇒ 这份旧读取作废');
        const fresh = await bookEntriesForInherit();
        assert.ok(fresh.some(e => String(e.content).includes('当场改过的正文')), '改过的数组照旧读得到最新材料');
        assert.ok(!fresh.some(e => String(e.content).includes('旧书正文')), '旧读取不许把旧正文当最新材料交出去');
    } finally { setCtxSource(() => null); resetBookCache(); }
});

test('热缓存下 legacy 数组原地被改 ⇒ 缓存必须失效并交出最新材料', async () => {
    const worldInfo = [{ uid: 1, comment: '甲', content: '甲住北城。' }];
    let live = { chatId: 'warm-in-place', worldInfo };
    setCtxSource(() => live);
    resetBookCache();
    try {
        assert.ok((await bookTextForRoots(live)).text.includes('甲住北城'), '先热一份缓存');
        worldInfo[0].content = '甲住南城。';                  // 同引用、原地改 ⇒ 版本变（不是换数组）
        worldInfo.push({ uid: 2, comment: '乙', content: '乙住东城。' });
        const after = await bookTextForRoots(live);
        assert.ok(after.text.includes('甲住南城'), '原地改过的正文必须重新取（缓存不许拿旧版本糊弄）');
        assert.ok(!after.text.includes('甲住北城'), '旧正文一个字都不许留在当前物料里');
        assert.equal(after.entries, 2, '补进去的条目也要看见（缓存按整份来源版本失效）');
    } finally { setCtxSource(() => null); resetBookCache(); }
});

test('同一聊天共享同一个 legacy 数组的新外壳照旧读得到；换了数组读到的是新内容（正向对照）', async () => {
    let calls = 0;
    const worldInfo = [{ uid: 1, comment: '甲', content: '甲住北城。' }];
    const make = (source = worldInfo) => ({ chatId: 'legacy-shell', characterId: 0, worldInfo: source,
        loadWorldInfo: async () => { calls += 1; return { entries: [] }; } });
    let live = make();
    setCtxSource(() => live);
    resetBookCache();
    try {
        assert.ok((await bookTextForRoots(live)).text.includes('甲住北城'));
        live = make();                                    // 新外壳、同一个 legacy 数组、同一场对话
        assert.ok((await bookTextForRoots(live)).text.includes('甲住北城'), '共享同一份 legacy 来源 ⇒ 照旧读得到（换外壳不是换书）');
        assert.equal(calls, 0, 'legacy 数组在时这条路口**本来就不问 loadWorldInfo** ⇒ 这个计数不能当"缓存命中"的证据（见上面夹具纪律②）');
        live = make([{ uid: 1, comment: '甲', content: '甲住南城。' }]);   // 另一个数组、另一份正文 ⇒ 换来源
        const changed = await bookTextForRoots(live);
        assert.ok(changed.text.includes('甲住南城'), '换了数组 ⇒ 必须交出**新来源的当前正文**');
        assert.ok(!changed.text.includes('甲住北城'), '旧来源的正文一个字都不许留下');
    } finally { setCtxSource(() => null); resetBookCache(); }
});

test('显式传进来的外部 ctx 与 live 同会话但拿的是另一份 legacy 来源 ⇒ 不许被 live 判掉', async () => {
    const liveCtx = { chatId: 'shared-chat', worldInfo: [{ uid: 9, comment: 'live', content: 'live书正文' }] };
    setCtxSource(() => liveCtx);
    resetBookCache();
    try {
        const external = { chatId: 'shared-chat', worldInfo: [{ uid: 1, comment: '外部', content: '外部书正文' }] };
        const got = await bookTextForRoots(external);
        assert.ok(got.text.includes('外部书正文'), '外部快照读的是它自己那份来源 ⇒ 不许被现取 live 的书判作废（外部/离线契约）');
        assert.ok(!got.text.includes('live书正文'), 'live 的材料一个字都不许混进外部快照的读取结果');
    } finally { setCtxSource(() => null); resetBookCache(); }
});

test('显式传进来的外部 ctx（不是 live）读取途中自己换了 legacy 来源 ⇒ 这份读取作废', async () => {
    setCtxSource(() => null);                            // 没有 live（离线调用 / Node 直测）
    resetBookCache();
    try {
        const external = { chatId: 'external-only', worldInfo: [{ uid: 1, comment: '旧', content: '旧书正文' }] };
        const pending = bookTextForRoots(external);
        external.worldInfo = [{ uid: 2, comment: '新', content: '外部新正文' }];   // 读取途中它自己换了来源
        const got = await pending;
        assert.equal(got.text, '', '外部 ctx 自己的来源在读取途中换了 ⇒ 这份读取作废（宁可不给，不交来源不明的书）');
        const after = await bookTextForRoots(external);
        assert.ok(after.text.includes('外部新正文'), '换过来源之后照旧读得到它自己的当前正文');
        assert.ok(!after.text.includes('旧书正文'), '旧来源的正文一个字都不许留下');
    } finally { resetBookCache(); }
});

test('浏览器形态：没有 process 全局时，取书与归属校验照旧跑（web 模块不许碰 Node 全局）', async () => {
    // ★收尾补的一刀：本文件此前留过 `process.env.SW2_DEBUG_BOOK` 的临时调试行——而这是**浏览器**模块
    //   （`process` 在浏览器里是 undefined ⇒ 那两行当场抛 ReferenceError）。这条判据把"没有 process"
    //   这一态真跑一遍：入口快照、异步归属校验、缓存命中三道全走，抛一下就红。
    setCtxSource(() => null);
    resetBookCache();
    const ctx = { chatId: 'no-process', worldInfo: [{ uid: 1, comment: '甲', content: '甲住北城。' }] };
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'process');
    try {
        globalThis.process = undefined;                 // 浏览器里没有这个全局
        const pending = bookTextForRoots(ctx);
        ctx.worldInfo = [{ uid: 2, comment: '乙', content: '乙住东城。' }];   // 顺带走一遍归属校验（作废 + 重读）
        assert.equal((await pending).text, '', '没有任何 process 全局时照旧算得出"来源换了 ⇒ 这份作废"');
        assert.ok((await bookTextForRoots(ctx)).text.includes('乙住东城'), '没有任何 process 全局时照旧读得到当前正文');
        assert.ok((await bookTextForRoots({ chatId: 'no-process-2', worldInfo: ctx.worldInfo })).text.includes('乙住东城'),
            '没有 process 全局时缓存命中那条路也照旧跑');
    } finally {
        if (desc) Object.defineProperty(globalThis, 'process', desc); else delete globalThis.process;
        setCtxSource(() => null); resetBookCache();
    }
});

// ============ Task1 末次复查 · Important 2：legacy 版本 = 全部读取/身份字段的独立快照 ============
//
// 病灶：`legacyBookVersion` 此前只盖 uid/id、正文哈希、comment/name、key、禁用位——**漏了 `constant`**，
//   且把成对的回退字段**合并**（uid??id、comment??name、key??keys、disable/enabled 压成一位）。
//   ⇒ 同引用原地改这些格（尤其 `constant: false → true` 这种**同长度布尔**）版本读数一个字不变，
//   热缓存、继承、起根与换书指纹继续吃旧书（与"现算合订"当场不一致）。
// 口径：逐字段独立快照（uid、id、comment、name、key、keys、content、constant、disable、enabled、_sw2Source），
//   以规范 JSON 表示——不合并回退字段、不拿分隔符拼串、不扫无关的整对象元数据（宿主元数据可能有环）。
// 正向面照旧：换数组、原地改正文、换挂载来源、外部快照 / readLive 那几条路一个字不改。

/** 热一份 legacy 缓存 → 原地改一格 → 再读（同一会话；跑完还原注入与缓存）。 */
async function readAfterInPlaceChange(chatId, worldInfo, mutate) {
    const live = { chatId, worldInfo };
    setCtxSource(() => live);
    setAbstractSelectionSource(() => ({ mode: 'default' }));
    resetBookCache();
    try {
        const before = await bookTextForRoots(live);
        mutate();
        const after = await bookTextForRoots(live);
        return { before, after };
    } finally { setCtxSource(() => null); setAbstractSelectionSource(() => ({ mode: 'default' })); resetBookCache(); }
}

test('legacy 原地 constant:false→true（同引用同长度）⇒ 缓存/继承/起根/指纹与现算合订同步', async () => {
    const worldInfo = [
        { uid: 1, comment: '控制器', constant: false, content: "<% getwi(null,'旧史') %>" },
        { uid: 2, comment: '旧史', disable: true, content: '旧史正文。' },
        { uid: 3, comment: '世界正文', content: '世界正文。' },
    ];
    const live = { chatId: 'legacy-constant-in-place', worldInfo };
    setCtxSource(() => live); setAbstractSelectionSource(() => ({ mode: 'default' })); resetBookCache();
    try {
        const before = await bookTextForRoots(live);
        assert.ok(before.text.includes('世界正文'), '先热一份缓存');
        assert.ok(!before.text.includes('旧史正文'), 'constant:false ⇒ 非恒注入壳的单条声明本轮不读（夹具前提）');
        const inheritedBefore = await bookEntriesForInherit();
        assert.ok(!inheritedBefore.some(e => String(e.content).includes('旧史正文')), '继承面读到的同样是旧料');
        worldInfo[0].constant = true;                    // 同引用、同一格、同长度（false→true）
        assert.equal(worldInfo.length, 3, '只改布尔一格：数组长度与条目身份都不动');
        const expected = composeInitSource({ worldInfoEntries: structuredClone(worldInfo), selection: { mode: 'default' } });
        assert.ok(expected.text.includes('旧史正文'), '现算合订必须真读到恒注入壳声明的禁用仓料');
        const after = await bookTextForRoots(live);
        assert.equal(after.text, expected.text, '原地改 constant ⇒ 缓存必须失效，交出与现算字字相同的合订');
        assert.equal(after.entries, expected.effectiveEntries.length, '实际生效条目数与现算一致');
        const inherited = await bookEntriesForInherit();
        assert.deepEqual(inherited.map(e => String(e.content)), expected.effectiveEntries.map(e => String(e.content)), '继承面同一步换料');
        const fresh = (await currentBookFingerprint(live)).fresh;
        assert.equal(fresh, bookFingerprint(expected.text, expected.titleRoster), '指纹必须与现算同一把尺');
    } finally { setCtxSource(() => null); setAbstractSelectionSource(() => ({ mode: 'default' })); resetBookCache(); }
});

test('legacy 原地只改 keys 回退字段（key 为空数组）⇒ 版本必须看见并换掉热缓存', async () => {
    const worldInfo = [{ uid: 1, comment: '', name: '', key: [], keys: ['甲'], content: '守北城。' }];
    const { before, after } = await readAfterInPlaceChange('legacy-keys-fallback', worldInfo, () => { worldInfo[0].keys = ['乙']; });
    assert.ok(before.text.includes('【甲】'), 'key 空数组 ⇒ 题名回退到 keys[0]（实际解析路真的读这一格）');
    assert.ok(after.text.includes('【乙】'), '只改 keys 一格 ⇒ 缓存必须失效并交出新材料');
    assert.ok(!after.text.includes('【甲】'), '旧题名的材料一个字都不许留下');
});

test('legacy 原地只改 name 回退（comment 为空）⇒ 版本必须看见并换掉热缓存', async () => {
    const worldInfo = [{ uid: 1, comment: '', name: '甲', content: '守北城。' }];
    const { before, after } = await readAfterInPlaceChange('legacy-name-fallback', worldInfo, () => { worldInfo[0].name = '乙'; });
    assert.ok(before.text.includes('【甲】'), 'comment 为空 ⇒ 题名回退到 name（实际解析路真的读这一格）');
    assert.ok(after.text.includes('【乙】'), '只改 name 一格 ⇒ 缓存必须失效并交出新材料');
    assert.ok(!after.text.includes('【甲】'), '旧题名的材料一个字都不许留下');
});

test('legacy 原地把 disable 由 1 改成真布尔 true ⇒ 版本必须看见并换掉热缓存', async () => {
    // ★这是旧法布尔合并的盲格：`disable === true` 只认真布尔 ⇒ `disable: 1` 读作"启用"、
    //   `disable: true` 读作"禁用"（实际用料当场不同），而旧版本读数把两者压成同一格 '1'。
    const worldInfo = [{ uid: 1, comment: '甲', content: '甲住北城。', disable: 1 }];
    const { before, after } = await readAfterInPlaceChange('legacy-boolean-state', worldInfo, () => { worldInfo[0].disable = true; });
    assert.ok(before.text.includes('甲住北城'), 'disable:1 不是真布尔 ⇒ 这一格照旧当启用条目读');
    assert.equal(after.text, '', '改成真布尔 true ⇒ 默认排除禁用条目，缓存必须失效');
});

test('legacy 原地只改 _sw2Source ⇒ 版本必须看见（来源身份跟着换）', async () => {
    const worldInfo = [{ uid: 1, comment: '甲', content: '甲住北城。', _sw2Source: '甲书' }];
    const live = { chatId: 'legacy-source-field', worldInfo };
    setCtxSource(() => live); setAbstractSelectionSource(() => ({ mode: 'default' })); resetBookCache();
    try {
        assert.equal((await bookEntriesForInherit())[0]._sw2SelectionId, '甲书:1', '来源名进了条目的稳定身份（先热一份缓存）');
        worldInfo[0]._sw2Source = '乙书';
        assert.equal((await bookEntriesForInherit())[0]._sw2SelectionId, '乙书:1', '来源名是实际身份的一部分 ⇒ 版本必须看见并重取');
    } finally { setCtxSource(() => null); setAbstractSelectionSource(() => ({ mode: 'default' })); resetBookCache(); }
});
