// story-world-v2/test/location-inherit-wiring.test.js
// 第二十五棒 f：**位置继承的接线真测**——治的还是那类病：「接线断了而测试全绿」。
// 本轮实例（全在 `web/index.js` 编排层，`src/` 一行没错）：
//   ① `lookupOneEntity`（面板行内「查」/「重查」）调 `bookEntriesCached()`——**该函数从未定义**，
//      点一下当场 `ReferenceError`；
//   ② `runBatchChunk`（批量补全）与 `advanceTick` 的 preStep（每轮前置步）**没传 `bookEntries`**
//      ⇒ `runBatchLookup` 里 `bookEntries == null` ⇒ 位置继承跑 0 次；
//   ③ 全量测试**零条**把 `bookEntries` 喂给这两个收口 ⇒ `deriveLocationFromBook` 在生产上一次没跑过。
// 用户真账实测（563 实体）：`location` 真值 **0**、占位值「未明」**563**——面板整列「未载」。
// 治法（与 `autoComposeSource` 同）：把取书口提成**导出函数**，注入 fake ST ctx **真跑**它，
//   并把「真条目 → 结构推断 → 落账」这条链在 Node 里整条跑通。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deriveLocationFromBook, runBatchLookup, ENTITY_LOOKUP_FIELDS } from '../src/entity-lookup.js';

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

// 真书形态（与用户盘上那条「所在地」写法一致）：条目名 + 键数组 + 正文成员行 + 明述驻地。
// ★夹具纪律（本轮实测踩到，别重踩）：`deriveLocationFromBook` 的 ACCEPT 闸要求
//   **来源串明显比命中的地名更长**（`s.length > loc.length`）——这是防"曹操→曹操"自指假位置的闸。
//   所以「所在地」必须写成**含修饰的真实形态**（这里的「（天阶护山大阵）」与用户书里的
//   「居西极贺洲西极昆仑山玉虚秘境, 天阶护山大阵」同性质）；写成与地名等长会被闸拒 ⇒ 夹具假红。
const BOOK_ENTRIES = [
    {
        keys: ['昆仑道宫'],
        comment: '昆仑道宫',
        content: '[势力: 昆仑道宫 (正道仙门魁首)]\n所在地: 西极贺洲西极昆仑山玉虚秘境（天阶护山大阵）\n'
            + '- 清玄真人 (男, T7合体中期): 掌教。\n- 玄一道祖 (男, T9渡劫巅峰): 人族守护神。',
    },
    {
        keys: ['万法阁'],
        comment: '万法阁',
        content: '[势力: 万法阁 (修真百艺总坛)]\n所在地: 东胜沧洲东海浮空岛（百艺浮城）\n'
            + '- 公输巧 (男, T4金丹后期): 阁主。',
    },
];

function fakeCtx({ book } = {}) {
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
        loadWorldInfo: async () => null,
        loadWorldBook: async () => null,
        renderExtensionTemplateAsync: async () => '<div id="sw2_window"></div>',
        eventSource: { on() {}, off() {}, once() {} },
        eventTypes: {},
        saveMetadata: async () => {},
        saveChat: async () => {},
        updateChatMetadata: () => {},
        saveMetadataDebounced: async () => {},
    };
}

const cardBook = () => ({ name: '大荒-姬元真', entries: BOOK_ENTRIES });

// 真账同形的世界：位置集 + 待推断位置的实体（全落占位词）
function worldWithPlaceholder() {
    return {
        context: {
            world: '大荒', tension: 0.5,
            positions: ['未明', '西极贺洲西极昆仑山玉虚秘境', '东胜沧洲东海浮空岛', '九宸玄陆'],
            playerId: 'e_p1',
            setting: {
                frozen: {
                    // 势力身份也在 canon 里（真账同样两处都有）——结构推断按"组织 → 成员"走，身份要对得上
                    canon: {
                        bookEntities: [
                            { name: '昆仑道宫', kind: 'faction' },
                            { name: '万法阁', kind: 'faction' },
                        ],
                    },
                },
            },
        },
        entities: [
            { id: 'e_p1', kind: 'character', name: '你', location: '未明' },
            { id: 'e_f1', kind: 'faction', name: '昆仑道宫', location: '未明' },
            { id: 'e_c1', kind: 'character', name: '玄一道祖', location: '未明' },
            { id: 'e_c2', kind: 'character', name: '清玄真人', location: '未明' },
            { id: 'e_f2', kind: 'faction', name: '万法阁', location: '未明' },
            { id: 'e_c3', kind: 'character', name: '公输巧', location: '未明' },
        ],
        meta: {},
        agendas: [], events: [], chronicle: [], weights: {},
    };
}

test('leg25 f：bookEntriesForInherit 真跑——必须交出**原始 ST 条目**（comment/content/key）', async () => {
    const restore = installCtx(fakeCtx({ book: cardBook() }));
    try {
        const mod = await import('../web/index.js?inherit1');
        assert.equal(typeof mod.bookEntriesForInherit, 'function', '取书口必须导出（可真测）');
        const entries = await mod.bookEntriesForInherit();
        assert.ok(Array.isArray(entries), '必须返回数组');
        assert.equal(entries.length, BOOK_ENTRIES.length, `条目数应一致（实际 ${entries.length}）`);
        const first = entries.find((e) => String(e?.comment) === '昆仑道宫');
        assert.ok(first, '★条目必须带 `comment`（=条目名，结构推断按它匹配实体）');
        assert.match(String(first.content), /所在地/, '★条目必须带 `content` 正文（驻地就在正文里）');
        assert.ok(Array.isArray(first.key), '★条目必须带 `key` 键数组（数组形态，不是逗号串）');
        assert.ok(first.key.includes('昆仑道宫'), '键内容照抄不加工');
    } finally {
        restore();
    }
});

test('leg25 f：取不到书 ⇒ 空数组（不猜位置、不报错——与查书路同纪律）', async () => {
    const restore = installCtx(fakeCtx({ book: null }));   // 书没挂载 + loadWorldInfo 恒 null
    try {
        const mod = await import('../web/index.js?inherit2');
        const entries = await mod.bookEntriesForInherit();
        assert.deepEqual(entries, [], '★读到 0 本书 ⇒ 不推断（空数组，绝不猜）');
    } finally {
        restore();
    }
});

test('leg25 f：真条目 → 结构推断 → 落账（0 个真位置的世界，位置真的散开了）', () => {
    const w = worldWithPlaceholder();
    const d = deriveLocationFromBook({ world: w, entries: BOOK_ENTRIES });
    assert.ok(d.stats.inherited >= 4, `★推断数应 ≥4（实际 ${d.stats.inherited}）`);
    const e = d.ssot.entities.find((x) => x.name === '玄一道祖');
    assert.equal(e.location, '西极贺洲西极昆仑山玉虚秘境', '★成员实体的位置由所属势力条目推出');
    assert.equal(d.ssot.meta.entityFields[e.id].位置来源, '结构推导', '★来源落账（与"书里原话"分开）');
    assert.equal(d.ssot.meta.entityFields[e.id].位置来源自, '昆仑道宫', '★记"从哪一条推出来的"（可审计）');
    // 幂等：已有位置的不动（可重入，面板反复点不会漂）
    const again = deriveLocationFromBook({ world: d.ssot, entries: BOOK_ENTRIES });
    assert.equal(again.stats.inherited, 0, '★第二次推断 0（已有位置不动）');
    assert.equal(again.ssot.entities.find((x) => x.name === '玄一道祖').location, '西极贺洲西极昆仑山玉虚秘境');
});

test('leg25 f：★同一批条目走 runBatchLookup 真收口——位置继承必须真生效（旧法这里恒 0）', async () => {
    const w = worldWithPlaceholder();
    const transport = async () => '{}';    // 模型面给空对象：查字段什么都没抽到，但结构推断是零 token、照跑
    const bookText = async () => ({ ok: true, entries: [{ name: '昆仑道宫', text: '所在地: 西极贺洲西极昆仑山玉虚秘境' }] });

    // ①不传 bookEntries（= 旧的生产接线）⇒ 推断跑 0 次、位置原地不动——这就是用户盘上「未载」的现场
    const off = await runBatchLookup({
        ssot: w, transport, bookText, ids: ['e_c1'], fields: ENTITY_LOOKUP_FIELDS, tick: 1,
    });
    assert.equal(off.locationInherited, 0, '不传条目 ⇒ 不推断（如实反映旧接线的行为）');
    assert.equal(off.ssot.entities.find((x) => x.name === '玄一道祖').location, '未明');

    // ②传上（= 修好后的生产接线）⇒ 推断真跑、位置落账
    const on = await runBatchLookup({
        ssot: w, transport, bookText, ids: ['e_c1'], fields: ENTITY_LOOKUP_FIELDS, tick: 1,
        bookEntries: BOOK_ENTRIES,
    });
    assert.ok(on.locationInherited >= 4, `★修好后必须真推断（实际 ${on.locationInherited}）`);
    const e = on.ssot.entities.find((x) => x.name === '玄一道祖');
    assert.equal(e.location, '西极贺洲西极昆仑山玉虚秘境', '★跑完整收口后位置真的落账了');
});

test('leg25 f：★加载期收口 inheritLocations——打开面板即见效（不必等推一轮或点「查」）', async () => {
    const mod = await import('../web/index.js?inherit3');
    assert.equal(typeof mod.inheritLocations, 'function', '加载期收口必须导出（可真测）');
    const w = worldWithPlaceholder();
    const r = mod.inheritLocations(w, { entries: BOOK_ENTRIES });
    assert.ok(r.inherited >= 4, `★打开面板即推断（实际 ${r.inherited}）`);
    const e = r.ssot.entities.find((x) => x.name === '玄一道祖');
    assert.equal(e.location, '西极贺洲西极昆仑山玉虚秘境', '★成员位置落账');
    assert.equal(r.ssot.meta.entityFields[e.id].位置来源, '结构推导', '★来源标「结构推导」（不是书里对这个名号自己的明述）');
    // 取不到书 ⇒ 原样返回（不猜位置、不报错）
    const w2 = worldWithPlaceholder();
    const r2 = mod.inheritLocations(w2, { entries: [] });
    assert.equal(r2.inherited, 0);
    assert.equal(r2.ssot.entities.find((x) => x.name === '玄一道祖').location, '未明', '没书就不许猜（留占位）');
    // 幂等：已有真位置的不动
    const r3 = mod.inheritLocations(r.ssot, { entries: BOOK_ENTRIES });
    assert.equal(r3.inherited, 0, '★幂等：第二次 0（加载期反复跑安全）');
});

test('leg25 f：★loadWorld 加载链里必须有位置继承这一刀（防"接了但没挂上"）', async () => {
    const src = await readFile(new URL('../web/index.js', import.meta.url), 'utf8');
    assert.match(src, /const loc = inheritLocations\(hotWorld, \{ entries: bookEntriesForSeed \}\)/,
        '★loadWorld 里真的调了位置继承（与名册落账共用同一份条目）');
    assert.match(src, /loc\.inherited > 0/, '★推断出东西时要落盘（否则只在内存）');
    assert.match(src, /refreshWorld\(world2, \{ oldVolumes: LISTED_VOLUMES \}\)/,
        '★渲染的是**推断后**的世界（否则界面还是旧的）');
});

test('leg25 f：★三处生产调用点都必须把条目喂给收口（防再次断线）', async () => {
    const src = await readFile(new URL('../web/index.js', import.meta.url), 'utf8');
    // 三个入口各必须出现一次「bookEntries: await bookEntriesForInherit()」：
    //   ① lookupOneEntity（面板行内查/重查）② runBatchChunk（批量补全）③ advanceTick 的 preStep（每轮前置步）
    const wired = [...src.matchAll(/bookEntries:\s*await\s+bookEntriesForInherit\(\)/g)];
    assert.ok(wired.length >= 3, `★三处调用点都要传条目（实际 ${wired.length} 处）`);
    assert.match(src, /export async function bookEntriesForInherit\(\)/, '取书口本身仍在');
    // 反向锁：**不再调用那个从未定义的函数**。用码点拼出禁名，免得本断言把禁名自己写进仓库；
    //   比对前先剥掉注释——该名字**只许留在解释这段历史的注释里**，代码里出现就是再次断线。
    const banned = '\u0062\u006f\u006f\u006b\u0045\u006e\u0074\u0072\u0069\u0065\u0073\u0043\u0061\u0063\u0068\u0065\u0064';
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const calls = [...codeOnly.matchAll(new RegExp(`${banned}\\s*\\(`, 'g'))].length;
    assert.equal(calls, 0, `★代码里禁止再调用未定义的 ${banned}()（那一处是实机 ReferenceError 的根因）`);
    assert.match(src, new RegExp(banned), '（仅注释里留存该名字作历史说明）');
});
