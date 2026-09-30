// story-world-v2/test/init-source-wiring.test.js
// 第二十五棒 e（四）：**初始化取源的真实接线测**——治的是一类反复出现的病：
//   「变量名写错/接线断了，测试全绿，实机一点就炸」。本轮实例：`res.worldInfoEntries = entries;`
//   ——`entries` 在该作用域根本不存在（真名是解构出来的 `worldInfoEntries`）⇒ 实机点「开始新世界」
//   报 `⚠ 初始化失败：entries is not defined`，而 467 条测试一条都没红。
// 治法：把 autoComposeSource 导出（可注入 fake ST ctx），在这里**真跑**它，断言它交出的形状。
import { test } from 'node:test';
import assert from 'node:assert/strict';

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
    // web/index.js 顶层引导段会问 document 并往挂载点插模板——给足以跑完的空壳，
    //   否则异步 boot 会在测试结束后抛 unhandledRejection（本轮实测踩到）。
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

function fakeCtx({ book, worldInfo } = {}) {
    return {
        characterId: 0,
        characters: [{
            name: '大荒z',
            description: '一个修真世界。',
            data: { extensions: { world: '大荒-姬元真' }, character_book: book },
            character_book: book,
        }],
        extensionSettings: { world_info: { globalSelect: [] } },
        chatMetadata: {},
        loadWorldInfo: async (name) => (worldInfo && worldInfo[name]) || null,
        loadWorldBook: async () => null,
        // 引导段（boot → initPanel）会摸这些——给最小空壳，否则导入模块就炸（本测试本来就是要抓这种雷）
        renderExtensionTemplateAsync: async () => '<div id="sw2_window"></div>',
        eventSource: { on() {}, off() {}, once() {} },
        eventTypes: {},
        saveMetadata: async () => {},
        saveChat: async () => {},
        updateChatMetadata: () => {},
        saveMetadataDebounced: () => {},
    };
}

test('leg25 e：autoComposeSource 真跑——must 交出 worldInfoEntries（真书条目用于零 token 兜底）', async () => {
    const book = {
        name: '大荒-姬元真',
        entries: [
            { keys: ['万妖盟'], comment: '混乱之地·万妖盟', content: '- 吞天妖王 (男, T8大乘中期): 盟主。' },
            { keys: ['世界总纲'], comment: '世界总设定', content: '大荒世界。' },
        ],
    };
    const restore = installCtx(fakeCtx({ book }));
    try {
        const mod = await import('../web/index.js?initsrc');
        const src = await mod.autoComposeSource();
        assert.equal(typeof src, 'object');
        assert.equal(src.ok, true, `取源应成功：${src.reason || ''}`);
        // ★本命断言：这一行就是实机报错的那一处（曾被写成不存在的 `entries`）
        assert.ok(Array.isArray(src.worldInfoEntries), 'worldInfoEntries 必须是数组（初始化把真书正文交给名册落账）');
        assert.ok(src.worldInfoEntries.length >= 2, `条目应带出来（实际 ${src.worldInfoEntries.length}）`);
        const names = src.worldInfoEntries.map((e) => String(e?.comment ?? e?.name ?? ''));
        assert.ok(names.includes('混乱之地·万妖盟'), `条目名应可读（实际 ${names.join('、')}）`);
        const entry = src.worldInfoEntries.find((e) => String(e.comment) === '混乱之地·万妖盟');
        assert.match(String(entry.content), /吞天妖王/, '条目**正文**必须带出来（零 token 兜底全靠它）');
        assert.equal(typeof src.text, 'string');
        assert.ok(src.text.length > 0, '合订源文本非空');
    } finally {
        restore();
    }
});

test('leg25 e：autoComposeSource 失败路径也要交出形状（不抛、不谎报 ok）', async () => {
    const restore = installCtx(fakeCtx({ book: null }));   // 无书、无卡描述字段
    try {
        const mod = await import('../web/index.js?initsrc2');
        const src = await mod.autoComposeSource();
        assert.equal(typeof src, 'object');
        assert.ok('ok' in src, '必须带回 ok 位（调用方据此上状态条）');
        if (!src.ok) assert.ok(src.reason, '失败必须给出 reason');
    } finally {
        restore();
    }
});
