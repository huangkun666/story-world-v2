// story-world-v2/test/init-overwrite-guard.test.js
// ★leg40b（I-1）：**「开始新世界」覆盖现存世界的守门**——用户点单修的那一条。
//
// 病灶（体检 §3.2 I-1，判据见交接文档）：
//   `bus['init-world']` **一声不响就覆盖现存世界**——没有确认框、没有存在性检查，
//   而同一份文件里的「回到此步」**有**确认框（同一个代码库里两种标准）。
//   更贵的是**顺序**：抽取与起根都跑在 `writeHotMeta` 之前（起根真账实测 170–490 秒），
//   ⇒ 用户在**覆盖真正发生前一句提示都看不到**，只看见状态条慢慢跑了几分钟。
//
// 本文件为什么必须"真跑处理器"而不是读源码 grep：
//   这类病的形状就是"**函数在、但没问**"——grep `window.confirm` 在文件里出现多少次，
//   都不能证明**这一条路**问了。故：装假 ctx（含一份**真形状的热账**）→ 取真动作总线 →
//   调**真** `init-world` → 断言它（a）问了（b）取消后什么都没干（c）一次调用都没烧。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hotAccountShape } from '../src/storage.js';

// ---------- 最小 DOM 桩（照 test/init-source-wiring.test.js / lookup-batch.test.js 的既有形状）----------
// web/index.js 末尾的引导段会问 document.readyState 并往挂载点插模板——给足以跑完的空壳，
//   否则异步 boot 会在测试结束后抛 unhandledRejection（那边实测踩过）。
function stubEl() {
    return {
        id: '', className: '', innerHTML: '', textContent: '', dataset: {}, style: { setProperty() {}, add() {} },
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        children: [], firstChild: null, parentNode: null,
        insertAdjacentHTML() {}, appendChild() {}, removeChild() {}, remove() {}, setAttribute() {}, getAttribute: () => null,
        addEventListener() {}, removeEventListener() {}, querySelector: () => stubEl(), querySelectorAll: () => [],
        closest: () => null, focus() {}, click() {}, scrollTo() {},
    };
}

const HOT_KEY = 'story_world_v2';

/** 一份"看起来就是用户真账"的世界（形状取自真账：context.world / meta.tick / entities[]）。 */
function existingWorld({ name = '大荒z', tick = 7, entities = 123 } = {}) {
    return {
        version: 1,
        context: { world: name, tension: 0.5, positions: ['大虞'] },
        entities: Array.from({ length: entities }, (_, i) => ({ id: `e_${i}`, kind: 'character', name: `名号${i}` })),
        weights: {}, agendas: [], events: [], chronicle: [], milestones: [],
        meta: { tick, simLog: [] },
    };
}

/**
 * 装假环境。返回 { restore, calls }：
 *   · calls.confirm  = 每次 `window.confirm` 收到的**文案**（空的 = 一次都没问）
 *   · calls.writes   = 每次 `updateChatMetadata`（= 唯一落账口 `writeHotMeta`）的调用
 *   · calls.fetch    = 真发出去的模型调用次数（取消路径必须为 **0**）
 */
function installEnv({ world, confirmAnswer = false } = {}) {
    const saved = {
        window: globalThis.window,
        document: globalThis.document,
        fetch: globalThis.fetch,
    };
    const calls = { confirm: [], writes: [], fetch: 0 };

    globalThis.window = {
        addEventListener() {}, removeEventListener() {},
        confirm: (msg) => { calls.confirm.push(String(msg)); return confirmAnswer; },
        SillyTavern: { getContext: () => ctx },
    };
    globalThis.document = {
        readyState: 'complete', addEventListener() {}, removeEventListener() {},
        getElementById: () => null, querySelector: () => stubEl(), querySelectorAll: () => [],
        createElement: () => stubEl(), body: stubEl(), head: stubEl(),
    };
    // 任何真模型调用都记一笔（取消路径跑不到这里 ⇒ 计数必须保持 0）
    globalThis.fetch = async () => { calls.fetch += 1; throw new Error('本用例不该发模型调用'); };

    const ctx = {
        characterId: 0,
        characters: [],
        name1: '黄坤',
        extensionSettings: {},
        // ★真形状的热账：`loadHotAccount` 认 format+version，所以必须走 hotAccountShape 造
        chatMetadata: world ? { [HOT_KEY]: hotAccountShape(world) } : {},
        updateChatMetadata: (patch) => { calls.writes.push(patch); Object.assign(ctx.chatMetadata, patch); },
        saveMetadata: async () => {}, saveChat: async () => {},
        saveMetadataDebounced: () => {},
        loadWorldInfo: async () => null, loadWorldBook: async () => null,
        renderExtensionTemplateAsync: async () => '<div id="sw2_window"></div>',
        eventSource: { on() {}, off() {}, once() {} }, eventTypes: {},
    };

    return {
        ctx,
        calls,
        restore() {
            if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window;
            if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
            if (saved.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = saved.fetch;
        },
    };
}

/** 取**真**动作总线（唯一入口 `window.__sw2Actions`，与玩家点按钮同一条路）。 */
async function realBus(tag) {
    await import(`../web/index.js?${tag}`);   // 破模块缓存：动作注册在 `if (typeof window !== 'undefined')` 里
    const bus = globalThis.window.__sw2Actions;
    assert.ok(bus && typeof bus['init-world'] === 'function', 'init-world 必须真在动作总线上（画了按钮就得有处理器）');
    return bus;
}

// ---------- ① 守门真在：现存世界 ⇒ 必问 ----------
test('leg40b·I-1：现存世界时 init-world 必须先问一句（真调处理器，不是 grep 源码）', async () => {
    const env = installEnv({ world: existingWorld(), confirmAnswer: false });
    try {
        const bus = await realBus('guard1');
        await bus['init-world']();
        assert.equal(env.calls.confirm.length, 1, '★有现存世界 ⇒ 必须**恰好问一次**（不问 = 病还在）');
        const msg = env.calls.confirm[0];
        assert.match(msg, /大荒z/, '被换掉的世界名必须印出来（否则用户不知道自己会丢哪个）');
        assert.match(msg, /7 轮/, '推进到第几轮必须印出来');
        assert.match(msg, /123 条名号/, '账上有多少条名号必须印出来');
        assert.match(msg, /快照/, '必须告知"换掉前会自动拍一份快照"（用户唯一能退回来的路）');
    } finally { env.restore(); }
});

// ---------- ② ★取消 = 什么都不干，且一次调用都不烧（顺序判据）----------
test('leg40b·I-1：取消后（a）盘上一字未写（b）一次模型调用都没发', async () => {
    const env = installEnv({ world: existingWorld(), confirmAnswer: false });
    try {
        const before = JSON.stringify(env.ctx.chatMetadata);
        const bus = await realBus('guard2');
        await bus['init-world']();
        assert.equal(env.calls.fetch, 0, '★★取消路径**一次模型调用都不许发**——闸必须在抽取/起根**之前**（这是本条的骨）');
        assert.deepEqual(env.calls.writes, [], '取消后不许落账（`writeHotMeta` 一次都不许调）');
        assert.equal(JSON.stringify(env.ctx.chatMetadata), before, '世界账必须逐字节原样');
    } finally { env.restore(); }
});

// ---------- ③ 确认后**继续往下走**（不是"问了就把人卡死"）----------
test('leg40b·I-1：点确定 ⇒ 放行继续（未配模型通道时如实报错，绝不静默）', async () => {
    const env = installEnv({ world: existingWorld(), confirmAnswer: true });
    try {
        const bus = await realBus('guard3');
        // 状态条是玩家视线面（`setStatus` 写进 DOM）——桩 DOM 里读不回来，故从**行为**核"放行了"：
        //   放行的证据 = 它走过了守门、进到后面那一步（未配通道 ⇒ 在 `resolveBrowserTransport` 处如实返回）。
        //   而"没静默"由 `modelSettings()` 无配置这条既有路径保证（状态条那句「⚠ 模型通道未配置」）。
        await bus['init-world']();
        assert.equal(env.calls.confirm.length, 1, '仍然问了一次');
        assert.deepEqual(env.calls.writes, [], '走到"通道未配置"就返回 ⇒ 不许写账（没东西可写）');
        assert.equal(env.calls.fetch, 0, '未配通道 ⇒ 也不该发调用');
        assert.ok(env.ctx.chatMetadata[HOT_KEY], '世界仍在原位（守门放行 ≠ 已经换掉了）');
    } finally { env.restore(); }
});

// ---------- ④ 没有世界 ⇒ 不多问一句（别让"开新世界"平白多一次点击）----------
test('leg40b·I-1：平时没有世界时不问（守门只在"真有东西可丢"时出声）', async () => {
    const env = installEnv({ world: null, confirmAnswer: false });
    try {
        const bus = await realBus('guard4');
        await bus['init-world']();
        assert.equal(env.calls.confirm.length, 0, '没有现存世界 ⇒ 一次都不该问');
    } finally { env.restore(); }
});

// ---------- ⑤ 事实面与文案：可被逐条核（tick 0 的世界也算"有东西可丢"）----------
test('leg40b·I-1：世界事实面归一 + 文案口径（tick 0 也算有世界；无世界给空串）', async () => {
    const mod = await import('../web/index.js?guard5');
    const { worldToBeReplaced, initWorldOverwriteNotice } = mod;

    assert.equal(worldToBeReplaced(null), null, '没有世界 ⇒ null（调用方据此决定"不问"）');
    assert.equal(worldToBeReplaced(undefined), null);
    assert.equal(initWorldOverwriteNotice(null), '', '没有世界 ⇒ 空文案');

    const fresh = worldToBeReplaced(existingWorld({ tick: 0, entities: 0 }));
    assert.ok(fresh, '★tick 0 / 0 名号的世界**也是用户的账** ⇒ 照样算"有东西可丢"（不按进程分层）');
    assert.equal(fresh.tick, 0);

    const w = worldToBeReplaced(existingWorld({ name: '', tick: 3, entities: 5 }));
    assert.equal(w.name, '未名世界', '名字空着 ⇒ 如实写"未名世界"（不编一个名字）');
    assert.equal(w.entities, 5);

    // 缺字段不许抛（老账/半截账也得问得出来）
    assert.equal(worldToBeReplaced({ meta: {} }).tick, null);
    assert.equal(worldToBeReplaced({ meta: { tick: 'x' } }).tick, null, 'tick 不是数 ⇒ null，不硬转');
    assert.equal(worldToBeReplaced({}).entities, 0);

    // 文案里不许出现引擎词（A-3：玩家可见文本零引擎术语）
    const notice = initWorldOverwriteNotice(worldToBeReplaced(existingWorld()));
    assert.ok(!/tick|entity|agenda|ssot|schema/i.test(notice), '★文案里不许漏引擎词（A-3）');
    assert.match(notice, /取消/, '必须写清"取消会怎样"（用户才不会怕）');

    // ★入参契约（本棒踩过的一格）：文案只吃**归一后的 brief**。传世界本体进来 ⇒ 名字读不出 ⇒ 空串。
    //   这不是"兼容性缺失"，是**故意的**：同一个形状两种身份正是本仓要治的病（一字段一义）。
    assert.equal(initWorldOverwriteNotice(existingWorld()), '', '★传世界本体（未归一）必须给空串，不许猜');
});
