// story-world-v2/test/fixture-param.mjs
// ★★leg46：**参数判据的公共夹具**（`param-hub.test.js` 与 `set-param-persist.test.js` 共用一份）。
// 为什么提出来：真源读写现在是**注入**的（`src/param-hub.js` 不直连 window/localStorage），
// 于是"假浏览器 + 假 ST"这一套必须**只有一处定义**——两处各写一份，迟早分叉
// （本仓最贵的一课：同一语义两处实现 ⇒ 先假绿、后假红，最后没人知道该信哪个）。
//
// 三条纪律（都是判据自己踩出来的，留档）：
//   ① `localStorage` 必须**跨"刷新"共享、用例之间清空**——否则"持久化"这条判据自己就测不了；
//   ② 每次 `sw2ResetFlushState()` 之后要**重新 import**（模块级状态）；
//   ③ **不许在 `set-param` 之前把 world 引用抓进闭包**：镜像那一步会换掉整个 world 对象
//      ⇒ 抓旧引用会读到过期环境，判据会"以为没生效"（leg41 假红过一次）。

/** 与真 ST 同形的假 `localStorage`（跨调用共享；`clear()` 模拟"新开一个浏览器"）。 */
export function makeLocalStorage(seed = null) {
    const m = new Map();
    if (seed) for (const [k, v] of Object.entries(seed)) m.set(k, String(v));
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        clear: () => m.clear(),
        key: (i) => [...m.keys()][i] ?? null,
        get length() { return m.size; },
    };
}

/** 装好假 DOM/window（**必须在 import web/index.js 之前**调用：它按 `typeof window` 决定接不接总线）。 */
export function installFakeDom() {
    const status = { textContent: '' };
    globalThis.window = {
        addEventListener: () => {}, removeEventListener: () => {}, SillyTavern: null,
        localStorage: makeLocalStorage(),
    };
    globalThis.document = {
        getElementById: (id) => (id === 'sw2_status_text' ? status : null),
        querySelector: () => null, querySelectorAll: () => [],
        createElement: () => ({ style: {}, dataset: {}, addEventListener: () => {}, appendChild: () => {} }),
        addEventListener: () => {}, head: { appendChild: () => {} }, body: { insertAdjacentHTML: () => {} },
        readyState: 'complete',
    };
    return { status };
}

/** 一个世界（形状与真账同：`context.setting.dynamic.env` 就是引擎读的那一格）。 */
export function makeWorld(worldName = '大荒z', env = {}) {
    return {
        version: 1,
        context: {
            world: worldName, tension: 0.5, positions: [],
            setting: { dynamic: { tension: { polarity: '正邪', direction: '', intensity: 0.5 }, env: { ...env } } },
        },
        entities: [{ id: 'e1', kind: 'character', name: '甲' }],
        weights: {}, agendas: [], events: [], chronicle: [], milestones: [],
        meta: { tick: 3, simLog: [{}] },
    };
}

/**
 * 假 ST 上下文 + 三处读数。`worldName` 就是桶键的来源（**一个世界名，两处引用同一份**）。
 */
export function makeSt({ worldName = '大荒z', env = {} } = {}) {
    const world = makeWorld(worldName, env);
    const chatMetadata = {
        story_world_v2: { format: 'story-world-v2-hot', version: 1, savedAt: 't0', nextVolume: 1, world },
    };
    const extensionSettings = {};
    const calls = { saveChat: 0, saveSettings: 0, updateChatMetadata: 0 };
    const ctx = {
        chatMetadata,
        extensionSettings,
        chatId: `${worldName}1`,
        updateChatMetadata(patch) { calls.updateChatMetadata += 1; Object.assign(chatMetadata, patch); },
        saveMetadataDebounced: () => {},
        saveChat: async () => { calls.saveChat += 1; },
        saveSettingsDebounced: () => { calls.saveSettings += 1; },
        renderExtensionTemplateAsync: async () => '',
    };
    globalThis.window.SillyTavern = { getContext: () => ctx };
    const key = 'sw2_params_v1';
    return {
        ctx, world, chatMetadata, extensionSettings, calls,
        /** ★**当下的**世界（每次现取，与真 ST 的 `loadHotAccount(chatHotMeta())` 同口径）。
         *  ★判据一律用它，不许用 `st.world`：`apply()` 之后账上那份已经换成了新对象，
         *  抓旧引用会读到过期环境（leg41 为这件事假红过一次，这里用 API 把它堵死）。 */
        liveWorld: () => chatMetadata.story_world_v2.world,
        /** ★把 hub 返回的那份世界**落进聊天账**（生产里这一句在接线层：`writeHotMeta`）。
         *  判据必须显式做这一步——hub 自己**不就地改** chat_metadata（那是接线层的活），
         *  忘了它就会"以为镜像没写"（本仓假红的头号来源）。 */
        apply: (w) => {
            if (!w) return w;
            chatMetadata.story_world_v2 = { ...chatMetadata.story_world_v2, world: w };
            return w;
        },
        /** 真源（主路）里这个世界的那一桶 —— "玩家选了什么"的唯一答案 */
        store: () => ({ ...((JSON.parse(globalThis.window.localStorage.getItem(key) || '{}').worlds || {})[worldName] || {}) }),
        /** 真源原始桶（看分桶形状 / 有没有把别的世界写脏） */
        rawStore: () => JSON.parse(globalThis.window.localStorage.getItem(key) || 'null'),
        /** 插件配置区那份（备份；**成败不许决定玩家的值在不在**） */
        settingsMirror: () => ({ ...((extensionSettings['story_world_v2_params']?.worlds || {})[worldName] || {}) }),
        /** 世界账里的镜像（**引擎读的就是这里**） */
        mirror: () => ({ ...(chatMetadata.story_world_v2.world.context.setting.dynamic.env || {}) }),
        /** 换一个世界名（模拟"两个世界/换聊天"） */
        switchWorld: (name, e = {}) => {
            const w = makeWorld(name, e);
            chatMetadata.story_world_v2 = { ...chatMetadata.story_world_v2, world: w };
            return w;
        },
        /** 模拟"刷新页面"：世界账照旧，但世界本体换一份新的（真 ST 会从盘上重读） */
        simulateReload: () => {
            const fresh = JSON.parse(JSON.stringify(chatMetadata.story_world_v2.world));
            chatMetadata.story_world_v2 = { ...chatMetadata.story_world_v2, savedAt: 'reload', world: fresh };
            return fresh;
        },
    };
}

/** 新建一个干净的 hub（判据直接用真模块，不经面板）。 */
export async function makeHub(extra = {}) {
    const { createParamHub } = await import('../src/param-hub.js');
    return createParamHub({
        storage: () => globalThis.window.localStorage,
        settings: () => globalThis.window.SillyTavern.getContext().extensionSettings,
        saveSettings: () => { globalThis.window.SillyTavern.getContext().saveSettingsDebounced(); },
        ...extra,
    });
}
