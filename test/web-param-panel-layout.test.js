// story-world-v2/test/web-param-panel-layout.test.js
// ★★★leg82（审查棒）：**`web/param-panel.js`（参数族新家 · 497 行）到底能不能用**——
//   这一条判据不是"搬家的结构判据"（那是 leg81 装置的事），而是一条**独立验证**：
//   拿假的 `freshCtx` / `sw2ExtensionSettings` / `sw2LocalStore` / `getLastWorld` + 假 `document`
//   把工厂**真跑起来**，然后逐条咬下面五件必须成立的事：
//
//   ① **能真跑**：`createParamApi(...)` 建得起来，受控口**逐个存在且是函数**（清单见受控口常量）。
//   ② **注入的是函数不是值**（本仓铁律）：`getLastWorld` 只收函数、对非函数入参 `throw TypeError`、
//      且**每次调用现取**（改一下假函数的返回值，`setLastWorld`/`lastWorld()` 要跟着变）。
//   ③ **状态只有一个家**：在**剥注释后的** `web/index.js` 源码里，`sw2HubLastWorld` /
//      `sw2CellWriteLog` / `sw2ParamBusy` / `paramHub` 的**定义**不许再出现（注释里可以留档）。
//   ④ **`reset()` 真的清四样**：hub 的撤销栈 · 写格留痕 · 忙闩 · "最近世界"。
//   ⑤ **一条行为判据**：`sw2SetParamCell(key)` 的规矩是"**格子的字只看同一行那个控件自己的值**"——
//      控件 `'12'` ⇒ 格写 `'12'`；**控件一个字节都不许动**；**找不到控件时什么都不做**（不自己编值）。
//      并且**必须带 DOM 守卫**：模块顶层不许碰 `window`/`document`（`node --test` 要能直接 import）。
//
// ★★本仓纪律（照同族 leg78/79/80 那几把尺子，别改回去）：
//   ① 判"某个东西在不在"一律跑在**剥注释后的源码**上（leg71 §4.1 的洞：留痕注释里就写着这些符号名）；
//   ② 每条判据都要能**当场红**，关键几条自带**反向自证**（故意喂错形状，断言它必须拒绝）；
//   ③ 不许用"我在某个文件里看到的词"当判据——每条断言都要能解释"它在防什么"。
//
// ★★★本棒（审查棒）的读数先说在前面，免得读者以为我在挑刺：
//   工厂**建得起来**、hub 四类口**能真跑**（`set`/`undo`/`reset` 这条主路是好的）、
//   忙闩那个 `Map` 的**身份与复位是对的**。真正坏的是下面五处，全部有判据咬（名字里带 ★BUG☆）：
//     ① 模块顶层零 DOM **做到了**，但受控口里**四个函数都引用了一个**本该注入、实际没注入**的
//        `WINDOW_ID` ⇒ DOM 那一族（`sw2SetParamCell` / `sw2SetParamControl` / `sw2SyncParamCells` /
//        `sw2CollectLiveParamValues`）**在浏览器里 100% 静默失效**（找不到面板节点就当成"页面没开"）。
//     ② `getLastWorld` **只被校验、从头到尾没被调用过一次** ⇒ 那条"迟到注入"的 TDZ 铁律是**空的**，
//        而同一批函数里还留着 3 处对**没声明的** `sw2LastWorld` 的引用。
//     ③ 自证面 `gatherParamEvidence` / `paramEvidenceText` 引用了没声明的 `PANEL_BUILD` ⇒ **必抛**。
//     ④ `sw2WriteHotMetaEnsuringParams` 引用了**没 import 的** `writeHotMeta` ⇒ 一调就 `ReferenceError`，
//        而调用方是"快照恢复 / 导入 / 清演化层"这些**参数镜像必须补齐**的路径。
//     ⑤ `sw2UndoParam` 里 `refreshSections(...)` 没声明（被 try 吞掉 ⇒ 撤销后画面不重画）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createParamApi } from '../web/param-panel.js';
import { createHotLedgerHub } from '../web/hot-ledger.js';

const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

/** 逐字符注释剥离器（跳过字符串/模板）。★必须有它：留痕注释里就写着这一族的符号名。 */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const c2 = src[i + 1];
        if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
        if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
        if (c === '"' || c === "'" || c === '`') {
            const q = c; out += c; i++;
            while (i < n) {
                if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
                out += src[i];
                if (src[i] === q) { i++; break; }
                i++;
            }
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

/**
 * ★ 把一个源码里的标识符按**花括号嵌套深度**分类：`depth === 0` 的就是**模块顶层**的。
 * 为什么不用正则（本棒当场比过）：`^(?:const|let)\\s+sw2ParamBusy\\b/m` 这种"找定义"的正则
 * **认不出**"这个绑定到底住在工厂里面还是外面"——而本棒要咬的那条（③）**咬的正是这件事**：
 * 一个本该住在模块顶层、却被写进工厂体里的状态，正则只会说"有这一行"，人就以为它对了。
 * ⇒ 口径：只有 `depth === 0` 的声明才算"模块顶层的家"；`depth > 0` 的一律算"局部（住在函数里）"。
 * ★它只服务本文件的判据（够用即止）：不解析正则字面量，但被扫描的源码里没有裸正则字面量。
 */
function tokenize(src) {
    const stripped = stripComments(src);
    const tokens = [];
    let depth = 0;
    let i = 0;
    const n = stripped.length;
    while (i < n) {
        const c = stripped[i];
        if (c === '"' || c === "'" || c === '`') {
            const q = c;
            i++;
            while (i < n) {
                if (stripped[i] === '\\') { i += 2; continue; }
                if (stripped[i] === q) { i++; break; }
                i++;
            }
            continue;
        }
        if (c === '{') { depth++; i++; continue; }
        if (c === '}') { depth--; i++; continue; }
        if (/[A-Za-z_$]/.test(c)) {
            let j = i;
            while (j < n && /[\w$]/.test(stripped[j])) j++;
            tokens.push({ name: stripped.slice(i, j), depth });
            i = j;
            continue;
        }
        i++;
    }
    return tokens;
}

/** 「模块顶层的家」＝ 该名字的**声明**出现在 `depth === 0`。 */
function topLevelDecls(src) {
    const t = tokenize(src);
    const out = new Set();
    for (let k = 0; k < t.length; k++) {
        if (t[k].depth !== 0) continue;
        if (!['const', 'let', 'var', 'function', 'class'].includes(t[k].name)) continue;
        const nx = t[k + 1];
        if (nx && nx.depth === 0) out.add(nx.name);
    }
    return out;
}

/** 「在代码里被引用」＝ 名字出现在**任意深度**（不含注释/字符串）。 */
const referenced = (src, name) => tokenize(src).some((t) => t.name === name);

/** 受控口清单（**契约**；逐条都要存在且是函数）。★这份清单就是"接线层能经什么够到本族"。 */
const API_SURFACE = [
    'displayEnv', 'currentWorldName', 'commit', 'flushPending', 'set', 'clear', 'playerInputs',
    'lastWorld', 'setLastWorld',
    'gatherParamEvidence', 'paramEvidenceText', 'sw2ParamUndoState', 'sw2ParamDiag', 'sw2UndoParam',
    'sw2WriteHotMetaEnsuringParams', 'playerIsTouchingParams', 'sw2CollectLiveParamValues',
    'sw2SetParamCell', 'sw2SetParamControl', 'sw2SyncParamSwitch', 'sw2SyncParamCells', 'paramBusy', 'reset',
];

/** ★受控口里**不该**碰到某种 DOM 的那些（DOM 守卫判据用）。 */
const THROWS_IS_WINDOW_ID = [
    'sw2SetParamCell', 'sw2SetParamControl', 'sw2SyncParamSwitch', 'sw2SyncParamCells', 'sw2CollectLiveParamValues',
];

// ─────────────────────────── 测试台：假依赖（含 hot-ledger 的注入） ───────────────────────────

// ★为什么这里要建 hot-ledger hub（这不是"给被测模块打补丁"，而是**把真机次序照搬过来**）：
//   `web/index.js` 里的建法就是 `hotHub = createHotLedgerHub({...})` **先于** `createParamApi({...})`
//   （leg78 的次序，热账是 leaf）。`param-panel.js` 的 `sw2UndoParam` 会调 `readHotMeta()`，
//   而那个函数要 hot-ledger 自己的 `freshCtx` ⇒ 不接这一步，`readHotMeta()` 会抛
//   `TypeError: freshCtx is not a function`——那是**测试台没搭全**，不是被测模块的缺陷。
//   ⇒ 接了它，`undo` 那条主路才是"真跑"（也能证明被测模块的 hub 口是好的）。
let chatMeta = null;
const makeCtx = () => ({
    get chat_metadata() { return chatMeta; },
    set chat_metadata(v) { chatMeta = v; },
    saveSettingsDebounced() {},
});
createHotLedgerHub({ freshCtx: makeCtx, hotMetaKey: 'sw2_hot', getSnapHub: () => null });

/** 假 localStorage（同步、可读回——hub 的"写后回读核对"靠它才算真跑）。 */
function makeFakeStore() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: (k) => { m.delete(k); },
    };
}

/** 计数 + 可变的假 `getLastWorld`（判据②的"现取"靠它取证）。 */
let lastWorldCalls = 0;
let fakeLastWorld = null;

const api = createParamApi({
    freshCtx: makeCtx,
    sw2ExtensionSettings: () => ({}),
    sw2LocalStore: makeFakeStore,
    getLastWorld: () => { lastWorldCalls += 1; return fakeLastWorld; },
});

/** 建一个"够用就好"的假世界（hub 认的是 `context.setting.dynamic` 这三层）。 */
const makeWorld = (name = '大荒z') => ({ context: { world: name, setting: { dynamic: { env: {} } } } });

/** ★leg103：总闸那个开关的键（与 `web/index.js:586` 的 `AUTO_ADVANCE_KEY` 同一把尺）。 */
const AUTO_ADVANCE = 'autoAdvance';

/**
 * ★假 DOM：提供 `getElementById`（返回假窗口）、`querySelector`（返回假控件）、
 *   `querySelectorAll`（返回假格数组）。**只做这一件事**——不模拟事件、不模拟 classList 逻辑。
 * ★本函数是判据⑤的"能当场红"自证之一：它证明**测试台本身是好的**（喂给一段"正确的实现"必须绿）。
 */
function makeFakeDom({ controlValue = '12', withControl = true } = {}) {
    const writes = [];
    const ctl = {
        tagName: 'SELECT',
        value: controlValue,
        classList: { contains: () => false },
        getAttribute: (a) => (a === 'data-param' ? '每轮递线' : null),
        setAttribute: () => { throw new Error('★控件不许被写属性'); },
    };
    Object.defineProperty(ctl, 'innerHTML', {
        set: () => { throw new Error('★控件不许被 innerHTML 重写'); },
        get: () => '',
    });
    const cell = {
        _t: '未定',
        get textContent() { return this._t; },
        set textContent(v) { this._t = String(v); writes.push(v); },
        getAttribute: (a) => (a === 'data-param-cell' ? '每轮递线' : null),
        setAttribute: () => { throw new Error('★格不许被写属性'); },
    };
    const win = {
        id: 'sw2_view_params',
        querySelector: (sel) => (withControl && sel.includes('set-param') ? ctl : null),
        // ★★`withControl:false` 时**两个集合都必须空**（本棒当场踩到并留档）：
        //   假 DOM 第一版这里无条件返回 `[ctl]`，于是 `sw2ParamControlOf` 走到了"一排开关按钮"那一支
        //   （`querySelectorAll` 拿到一枚假控件 ⇒ 返回它）⇒ "找不到控件"那条判据**假绿**。
        //   真机里"这个键没有控件"就是**根本没有节点**：`getElementById` 找不到面板就早退（更常见），
        //   或者找到了面板但两个集合都空。⇒ 假 DOM 必须让"没有控件"真的是**空**。
        querySelectorAll: (sel) => {
            if (!withControl) return [];
            return sel.includes('data-param-cell') ? [cell] : [ctl];
        },
    };
    const doc = {
        // ★"没有控件"两支：① 面板节点都没有（`getElementById` 返回 null——真机上"切到别的页"就是这个）
        //   ② 面板在、但这一格没有控件（集合皆空）。下面③取①，它同时验证了"提前退让"这条早退。
        getElementById: (id) => (withControl ? { ...win, id } : null),
    };
    return { doc, ctl, cell, writes, win };
}

// ─────────────────── ① 能真跑：受控口逐个存在且是函数 ───────────────────

test('★leg82 ①：`createParamApi(...)` 能真跑，受控口**逐个存在且是函数**', () => {
    assert.equal(typeof api, 'object', '★受控口必须是一个对象');
    for (const k of API_SURFACE) {
        assert.ok(k in api, `★受控口缺了 \`${k}\`（接线层就够不到本族这一格）`);
        assert.equal(typeof api[k], 'function', `★受控口 \`${k}\` 必须是函数（受控口＝具名方法，不是值）`);
    }
    // ★反向自证：这份清单真的会咬 —— 拿一个"少一格"的假口喂给它，必须被认出来
    const fake = { ...api };
    delete fake.reset;
    assert.ok(!API_SURFACE.every((k) => k in fake && typeof fake[k] === 'function'),
        '★反向自证：缺了一格的受控口必须被上面那条口径认出来（否则它是假绿）');
    // ★hub 的四类口必须真的接在 hub 上（空壳 ⇒ 接线层调它就是"点了没反应"）
    const w = makeWorld();
    const before = api.displayEnv(w);
    const r = api.set(w, '每轮递线', '6');
    assert.equal(r.ok, true, `★主路必须真能写（实测 ok=${r.ok} / ${r.humanLine}）`);
    assert.equal(r.stored, 'local', '★假存储是可写可回读的 ⇒ 落点必须是主路');
    assert.equal(api.displayEnv(w)['每轮递线'], '6', '★写完之后 `displayEnv` 必须读到 6（真源优先）');
    assert.ok(before['每轮递线'] != null, '★出厂默认那一格必须存在（面板画得出厂值）');
});

// ─────────────────── ② 注入的是**函数**不是值 ───────────────────

test('★★★leg82 ②-a：`getLastWorld` 传成**值**必须当场 `TypeError`（四条入参逐个反向自证）', () => {
    const good = { freshCtx: () => null, sw2ExtensionSettings: () => null, sw2LocalStore: () => null, getLastWorld: () => null };
    // 负控：四条都是函数 ⇒ 不许抛
    assert.doesNotThrow(() => createParamApi(good), '★四条都是函数时不许抛（否则判据自己假绿）');
    // 四条入参逐个换成"值"，必须各自 throw TypeError
    for (const key of ['freshCtx', 'sw2ExtensionSettings', 'sw2LocalStore', 'getLastWorld']) {
        for (const bad of [{}, 'function', 42, null, undefined, []]) {
            assert.throws(() => createParamApi({ ...good, [key]: bad }), TypeError,
                `★\`${key}\` 收到 ${JSON.stringify(bad)}（是值不是函数）时必须 throw TypeError`
                + '——本仓铁律：注入的是**函数**，写成值就会在建模块那一刻冻住（TDZ/过期）');
        }
    }
    // ★反向自证：连"整份 deps 都不给"也必须拒绝，而不是建出一个半死的口
    assert.throws(() => createParamApi(), TypeError, '★`createParamApi()` 什么都不给时必须 throw');
    // ★★测试台卫生（本棒当场踩到、留档）：`createParamApi` 是**模块级单例装配**——上面那次
    //   `createParamApi(good)` 会把本模块的四样依赖**重新绑成 no-op** ⇒ 后面每条测试都会读到
    //   "这个环境没有可用的本地存储"（那是**我自己的负控**污染出来的，不是被测模块的缺陷）。
    //   ⇒ 负控跑完必须把**真测试台**重新装回去，否则下面的判据测的是我自己的脏状态。
    createParamApi({
        freshCtx: makeCtx,
        sw2ExtensionSettings: () => ({}),
        sw2LocalStore: makeFakeStore,
        getLastWorld: () => { lastWorldCalls += 1; return fakeLastWorld; },
    });
    api.reset();
    fakeLastWorld = null;
    lastWorldCalls = 0;
});

test('★★★leg82 ②-b：`getLastWorld` 必须**每次调用现取**，且 `setLastWorld`/`lastWorld()` 跟着变', () => {
    // ① 迟到的值：改了假函数的返回值，`lastWorld()` 必须跟着变
    const A = makeWorld('大荒A');
    const B = makeWorld('大荒B');
    fakeLastWorld = A;
    assert.equal(api.lastWorld()?.context?.world, '大荒A',
        '★`fakeLastWorld` 改了之后 `lastWorld()` 必须跟着变（否则就是"构造时冻住"那个坑）');
    fakeLastWorld = B;
    assert.equal(api.lastWorld()?.context?.world, '大荒B',
        '★再改一次还必须跟着变（证明它是**现取**，不是缓存）');
    // ② `setLastWorld` 必须真的改写那一格
    const C = makeWorld('大荒C');
    api.setLastWorld(C);
    assert.equal(api.lastWorld()?.context?.world, '大荒C', '★`setLastWorld(C)` 之后 `lastWorld()` 必须是 C');
    api.setLastWorld(null);
    assert.equal(api.lastWorld(), null, '★`setLastWorld(null)` 必须能被读回来（复位路径要用它）');
    // ★★★③ 本棒要咬的那一条：`getLastWorld` 是**注入进来的**，就必须**真的被调用**。
    //   防的是（本仓 leg72 那条 TDZ 铁律的同族病）："注入了、校验了、然后一次都不用" ——
    //   那条铁律就成了空话，而模块里却留着对**没声明的** `sw2LastWorld` 的引用。
    const w = makeWorld('大荒z');
    api.setLastWorld(null);
    const before = lastWorldCalls;
    fakeLastWorld = w;
    api.sw2SetParamCell('每轮递线');
    api.sw2SetParamControl('每轮递线');
    api.sw2SyncParamCells();
    api.lastWorld();
    assert.ok(lastWorldCalls > before,
        `★\`getLastWorld\` 从建模块到现在**一次都没被调用过**（实测 ${lastWorldCalls} 次）——`
        + '注入的是一个**取值函数**，就必须在"要读那一格时现取"；'
        + '注入了却从不调用 ⇒ 那条"迟到注入"铁律是空的，而代码里还留着 3 处对 `sw2LastWorld` 的引用');
});

// ─────────────────── ③ 状态只有一个家 ───────────────────

test('★★★leg82 ③：四个状态的**定义**不许再出现在接线层（判据跑在**剥注释后**的源码上）', () => {
    const rawIndex = read('web/index.js');
    const index = stripComments(rawIndex);
    // ★为什么必须剥注释：本仓的留痕注释里**就写着这些符号名**（"paramHub 现在是 hub 口"这类），
    //   不剥注释的判据会被自己的留档搞红 —— 这一步本身也要反向自证（见下面）。
    const definitions = [
        /^(?:export\s+)?(?:let|const|var)\s+sw2HubLastWorld\b/m,
        /^(?:export\s+)?(?:let|const|var)\s+sw2CellWriteLog\b/m,
        /^(?:export\s+)?(?:let|const|var)\s+sw2ParamBusy\b/m,
        /^(?:export\s+)?(?:let|const|var)\s+paramHub\b/m,
    ];
    for (const [n, re] of [['sw2HubLastWorld', definitions[0]], ['sw2CellWriteLog', definitions[1]],
        ['sw2ParamBusy', definitions[2]], ['paramHub', definitions[3]]]) {
        // ① 正向：接线层的**代码**里不许再有这个定义（状态劈两半＝本仓最贵的病）
        assert.ok(!re.test(index),
            `★★\`web/index.js\` 的**代码**里不许再定义 \`${n}\`（注释里可以留档）——`
            + '它就是"本族的状态只有一个家"那条；定义还在旧家 ⇒ 两份真相，迟早分叉');
        // ② ★反向自证：这条正则**真的认得出"定义"**（拿合成源码喂它，必须命中）
        //    ★★★leg85 改形态（本仓 leg83 §5 #3 点名的自相矛盾，本棒收口）：
        //      原来这一条写的是"`${n}` 的**定义**必须真的还在**原始**源码里"——
        //      可正向那条要求的是"**代码**里不许再有这个定义"，而本仓允许把原声明**归档进块注释**
        //      ⇒ 状态一旦真的搬走，**两半不可能同时成立**（第一版就是靠"原声明留在注释里"
        //      才勉强过的：正向剥注释说没有、反向不剥注释说有，**同一件事用两把尺子**）。
        //      ⇒ 照 `web-memory-layout.test.js:107-112` 那把尺改成**合成字符串自证**：
        //        反向该证的是"**这条正则能认出定义**"，而不是"目标文件里必须还留着定义"。
        //        ★这一改把口径**改严了**：原来那条只证明"我搜的文件里有这行字"，
        //          现在证明的是"这条正则在**真定义**上会红、在**注释里的假定义**上不会红"。
        const SYNTH = `let ${n} = 1;`;                       // 合成：一个**真**定义
        const COMMENTED_SYNTH = `// let ${n} = 1;`;           // 合成：一个**注释里**的假定义
        assert.ok(re.test(SYNTH),
            `★反向自证：合成源码 \`${SYNTH}\` 必须被这条口径认成"定义"（否则上面那条是假绿）`);
        assert.ok(!re.test(stripComments(COMMENTED_SYNTH)),
            `★反向自证：注释里的假定义 \`${COMMENTED_SYNTH}\` **不许**被认成定义`
            + '（否则"把状态注释掉"就能骗过上面那条）');
        // ③ ★事实留档（不是判据，是"这条锁测的不是空气"的地址）：符号名与它的归档声明
        //    确实在本文件里（本棒实读：`sw2HubLastWorld` 在注释里、`paramHub` 等三格见 ③ 的 grep）。
        assert.ok(new RegExp(`\\b${n}\\b`).test(rawIndex),
            `★前提：原始 \`web/index.js\` 里必须能搜到 \`${n}\`（搜不到 ⇒ 上面两条在测空气）`);
    }
    // ★③ 两条方向性判据：新家必须有真东西；接线层必须**真的**建它（`import` 了不调 = leg25f 病历）
    const panel = read('web/param-panel.js');
    assert.ok(panel.split('\n').length > 400,
        `★\`web/param-panel.js\` 必须真的装着那一族（实测 ${panel.split('\n').length} 行）`);
    assert.match(index, /createParamApi\s*\(/,
        '★接线层必须**真的调** `createParamApi({...})`（只 import 不调 = "搬走了但没人接线"）');
    // ★④ 反向自证（本仓 leg71 §4.1 的洞）：被注释掉的"定义"**不许**被认作定义
    assert.ok(!definitions[2].test(stripComments('// let sw2ParamBusy = new Map();')),
        '★反向自证：被注释掉的"定义"必须不被认作定义（否则"把状态注释掉"就能骗过判据）');
    assert.ok(!referenced('// 说明：sw2CellWriteLog 住在 param-panel.js', 'sw2CellWriteLog'),
        '★反向自证：注释里提到状态名不算"代码里引用"（否则留档就把判据自己搞红）');
});

// ─────────────────── ④ `reset()` 真的清四样 ───────────────────

test('★★leg82 ④：`reset()` 真的清**四样**——撤销栈 · 写格留痕 · 忙闩 · 最近世界', () => {
    const w = makeWorld();
    // ── 造成"脏"：写一笔（撤销栈 + 写格留痕 + 最近世界）＋ 忙闩手工置一格 ──
    const r = api.set(w, '每轮递线', '6');
    assert.equal(r.ok, true, '★测试前置：这一笔必须写成功（hub 的事务是真跑的）');
    api.setLastWorld(w);
    // ① 撤销栈脏了
    assert.equal(api.sw2ParamUndoState().canUndo, true, '★测试前置：撤销栈必须真的进了 1 步');
    assert.ok(api.sw2ParamUndoState().count >= 1, '★测试前置：撤销步数必须 ≥1');
    // ② 忙闩脏了（★它必须与模块内部**同一颗 Map**：交副本＝把状态劈两半）
    const busy = api.paramBusy();
    assert.ok(busy instanceof Map, `★\`paramBusy()\` 必须交出那个 \`Map\` **本体**；实测 ${Object.prototype.toString.call(busy)}`);
    busy.set('每轮递线', true);
    assert.equal(api.paramBusy().get('每轮递线'), true, '★`paramBusy()` 每次必须交出**同一颗** Map（交副本 ⇒ 忙闩形同虚设）');
    // ③ 写格留痕脏了 —— ★用"受控口"取证（不偷看内部变量：那正是本仓禁的"跨块读私有状态"）
    const dom = makeFakeDom({ controlValue: '12' });
    globalThis.document = dom.doc;
    let wrote = false;
    try { wrote = api.sw2SetParamCell('每轮递线'); } finally { delete globalThis.document; }
    assert.equal(wrote, true,
        '★★`sw2SetParamCell` 必须真的把格写成控件的值（实测返回 false）——'
        + '这是"写格留痕"这条判据取证的前提；它若假，留痕那条就是在测空气');
    const dirty = api.gatherParamEvidence();
    assert.ok(dirty['写格次数'] >= 1,
        `★★写格留痕必须是脏的（实测 写格次数=${dirty['写格次数']}）——`
        + '证据链：`gatherParamEvidence` 读的 `sw2CellWriteLog` 与"一次成功写格"产出的留痕**不是同一份**'
        + '（前者是模块顶层那个数组，后者被 `reset()` 清的是另一个东西）');
    // ── 复位 ──
    api.reset();
    // ④ 四样逐条回干净（★漏了留痕与忙闩 ⇒ 会串到下一条用例 / 下一个世界，那正是它存在的理由）
    assert.equal(api.sw2ParamUndoState().canUndo, false, '★`reset()` 之后撤销栈必须空（hub 的撤销栈没清）');
    assert.equal(api.sw2ParamUndoState().count, 0, '★`reset()` 之后撤销步数必须是 0');
    assert.equal(api.paramBusy().size, 0, '★`reset()` 之后忙闩必须空（漏了它 ⇒ 下一格被永久挡住）');
    assert.equal(api.lastWorld(), null, '★`reset()` 之后"最近世界"必须是 null');
    assert.equal(api.gatherParamEvidence()['写格次数'], 0, '★`reset()` 之后写格留痕必须是 0');
    // ★反向自证：`reset()` 不是"把对象整个换掉"糊过去的 —— 那个 Map 必须还是**同一颗**
    assert.equal(api.paramBusy(), busy, '★`reset()` 必须是"清空那一颗 Map"，不是"换一颗新的"');
});

// ─────────────────── ⑤ 行为判据：格只看控件 ───────────────────

test('★★★leg82 ⑤-a：DOM 守卫——模块顶层零 `window`/`document`，且受控口必须**真的够到面板**', () => {
    const panel = read('web/param-panel.js');
    // ① 正向：这个模块必须能在 `node --test` 里直接 import（本文件顶部那一行就是证据）
    assert.equal(typeof createParamApi, 'function', '★`node --test` 必须能直接 import 本模块（顶层零 DOM）');
    // ★口径说明（别把它写宽）：顶层**允许**出现 `typeof document === 'undefined'` 这种**读**——
    //   那不是"碰 DOM"，而正是那条守卫本身。要咬的是"在函数体之外**取用**它"。
    const bare = stripComments(panel).split(/\r?\n/)
        .filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l))
        .filter((l) => !/typeof\s+(?:document|window)\s*===/.test(l))
        .filter((l) => /\b(?:document|window)\s*\./.test(l) || /\bgetElementById\s*\(/.test(l));
    const topLevel = bare.filter((l) => /^(?:const|let|var|export\s+(?:const|let|var))/.test(l));
    assert.deepEqual(topLevel, [],
        `★模块顶层不许**取用** \`document\`/\`window\`（实测 ${topLevel.length} 行：${topLevel.join(' | ')}）`);
    // ★② 本棒要咬的那一条：DOM 取用必须带**守卫**，而且守卫用的窗口 id 必须**真有一个出处**。
    //   为什么（这是"能真跑"与"浏览器里真能用"之间的距离）：函数体里那句
    //     `const win = document.getElementById(WINDOW_ID);`
    //   在 Node 里被 `typeof document === 'undefined'` 挡住（所以判据①绿），
    //   可**在浏览器里** `WINDOW_ID` 若没被注入 ⇒ `ReferenceError` ⇒ 被同一个 catch 吞掉
    //   ⇒ 四个 DOM 函数**全部静默失效**（面板"点了没反应、格永远不更新"，且控制台只有一行 warn）。
    const bound = topLevelDecls(panel);
    assert.ok(bound.has('WINDOW_ID'),
        `★★受控口里 ${THROWS_IS_WINDOW_ID.length} 个函数都取 \`document.getElementById(WINDOW_ID)\`，`
        + `可 \`WINDOW_ID\` **在 \`web/param-panel.js\` 里没有任何绑定**（顶层绑定表：${[...bound].join(' / ')}）`
        + ' ⇒ 浏览器里当场 `ReferenceError: WINDOW_ID is not defined`，被 catch 吞掉 ⇒ 面板那一族静默失效');
    // ★③ 反向自证：这条"顶层绑定表"真的认得出"住在工厂**里面**"的绑定
    assert.ok(!topLevelDecls('export function f() { let X = new Map(); return X; }').has('X'),
        '★反向自证：写在函数体（`depth>0`）里的绑定**不许**被算作"模块顶层的家"——'
        + '否则"状态只有一个家"那条就抓不到"本该在顶层、却被写进工厂体里"的那个形状');
    assert.ok(topLevelDecls('let X = new Map();').has('X'),
        '★反向自证：真正的模块顶层绑定必须被认出来（否则上面那条是假绿）');
});

test('★★★leg82 ⑤-b：★BUG☆ 控件是 `12` ⇒ 格必须写 `12`；控件一个字节都不许动；找不到控件就什么都不做', () => {
    // ── ① 控件 `'12'` ⇒ 格写 `'12'`；且**控件一个字节都不许动** ──
    const dom = makeFakeDom({ controlValue: '12' });
    const before = { value: dom.ctl.value, tag: dom.ctl.tagName };
    globalThis.document = dom.doc;
    let ret = null;
    try { ret = api.sw2SetParamCell('每轮递线'); } finally { delete globalThis.document; }
    assert.equal(ret, true, '★受控口必须如实返回"我写了格"（实测 false ⇒ 它连面板都没够到）');
    assert.equal(dom.cell._t, '12',
        `★★★规矩：**格子的字只看同一行那个控件自己的值** —— 控件是 '12'，格就必须写 '12'（实测 ${JSON.stringify(dom.cell._t)}）`);
    assert.equal(dom.ctl.value, before.value, '★控件是玩家的手，判据要求**一个字节都不许动**');
    assert.equal(dom.ctl.tagName, before.tag, '★不许改控件的类型（那是"重画控件"的另一种写法）');
    // ── ② 控件空值 ⇒ 格写「未定」（同一条规矩的另一半，防"空着就是空着"被写成空串） ──
    const dom2 = makeFakeDom({ controlValue: '' });
    globalThis.document = dom2.doc;
    let ret2 = null;
    try { ret2 = api.sw2SetParamCell('每轮递线'); } finally { delete globalThis.document; }
    assert.equal(ret2, true, '★控件是空值也必须写格（写「未定」，不是什么都不做）');
    assert.equal(dom2.cell._t, '未定', `★\`<select value="">\` ⇒ 格写「未定」（实测 ${JSON.stringify(dom2.cell._t)}）`);
    // ── ③ 找不到控件 ⇒ **什么都不做**（绝不自己编一个值出来） ──
    //    ★两支都试：③a 面板节点都没有（`getElementById` → null，真机"切到别的页"）；③b 面板在但没有控件。
    const dom3 = makeFakeDom({ withControl: false });
    globalThis.document = dom3.doc;
    let ret3 = null;
    try { ret3 = api.sw2SetParamCell('每轮递线'); } finally { delete globalThis.document; }
    assert.equal(ret3, false, '★找不到控件必须如实返回 false（退让，让渲染层画）');
    assert.equal(dom3.cell._t, '未定',
        '★★★找不到控件时**一个字节都不许动**那个格 —— 绝不许自己猜一个值出来（本模块头部纪律①/④）');
    assert.deepEqual(dom3.writes, [], '★连"把格写成它原来的值"都不算合格：写入应为 0 次');
    // ③b ★这一支是"面板在、可这一格没有控件"（第三.一版假 DOM 在这里假绿过，见 `makeFakeDom` 里那段留档）
    const dom3b = makeFakeDom({ withControl: false });
    dom3b.win.querySelector = () => null;
    dom3b.win.querySelectorAll = () => [];
    globalThis.document = { getElementById: () => dom3b.win };
    let ret3b = null;
    try { ret3b = api.sw2SetParamCell('每轮递线'); } finally { delete globalThis.document; }
    assert.equal(ret3b, false, '★面板在、但这一格没有控件 ⇒ 必须返回 false（不许退回"最后一枚按钮"那一支）');
    assert.deepEqual(dom3b.writes, [], '★面板在但没有控件时，格也不许被写一个字');
    // ── ④ ★反向自证：测试台本身必须是真的能咬的 —— 喂一段"正确的实现"必须绿 ──
    //    （否则③那几条"没写"可能只是因为我的假 DOM 把写入吞了 ⇒ 假绿）
    const dom4 = makeFakeDom({ controlValue: '12' });
    const good = (doc, key) => {
        const win = doc.getElementById('sw2_view_params');
        if (!win) return false;
        const ctl = win.querySelector(`[data-action="set-param"][data-param="${key}"]`);
        if (!ctl) return false;
        const text = String(ctl.value ?? '').trim() || '未定';
        for (const el of win.querySelectorAll('[data-param-cell]')) {
            if (el.getAttribute('data-param-cell') !== key) continue;
            if (el.textContent !== text) el.textContent = text;
        }
        return true;
    };
    assert.equal(good(dom4.doc, '每轮递线'), true, '★反向自证：一个**正确实现**必须在这套假 DOM 上跑通');
    assert.equal(dom4.cell._t, '12', '★反向自证：正确实现必须把格写成 12（证明假 DOM 真的会记写入）');
});

// ─────────────────── ⑥ 自由变量：受控口引用的名字必须**真的有个出处** ───────────────────

test('★★★leg82 ⑥：★BUG☆ 受控口引用的外部名字必须**有出处**（否则一调就 `ReferenceError`）', () => {
    const panel = read('web/param-panel.js');
    const bound = topLevelDecls(panel);
    // 已 import 进来的名字也算"有出处"
    for (const m of panel.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
        for (const part of m[1].split(',')) {
            const n = part.trim().split(/\s+as\s+/).pop().trim();
            if (n) bound.add(n);
        }
    }
    for (const m of panel.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) bound.add(m[1]);

    // ★这三组是**真缺陷**（本棒实测：调用它们必抛），逐组给出"它在哪条路上、抛什么"：
    const BUGS = [
        { names: ['WINDOW_ID'], where: '四个 DOM 受控口（sw2SetParamCell / sw2SetParamControl / sw2SyncParamCells / sw2CollectLiveParamValues）', why: '面板整族 DOM 镜像在浏览器里静默失效' },
        { names: ['PANEL_BUILD'], where: '自证面 gatherParamEvidence / paramEvidenceText', why: '一键自检必抛 ⇒ 用户拿不到读数（而它存在的理由就是"用户不开控制台"）' },
        { names: ['writeHotMeta'], where: 'sw2WriteHotMetaEnsuringParams（快照恢复 / 导入 / 清演化层那条路）', why: '一调就 ReferenceError ⇒ 参数镜像补不上，引擎按旧档跑' },
        { names: ['refreshSections'], where: 'sw2UndoParam 撤销之后的"让面板重画"', why: '被 try 吞掉 ⇒ 撤销成功但画面不更新' },
        { names: ['sw2LastWorld'], where: 'sw2CollectLiveParamValues / sw2SetParamControl', why: '本该走注入的 getLastWorld()，实际引用了一个没声明的名字' },
    ];
    for (const bug of BUGS) {
        for (const n of bug.names) {
            assert.ok(referenced(panel, n), `★判据前提：\`${n}\` 必须真的被引用（否则这条在测空气）`);
            assert.ok(bound.has(n),
                `★★★\`${n}\` 在 \`web/param-panel.js\` 里被**引用**、却**没有任何绑定**：`
                + `\n     · 位置：${bug.where}`
                + `\n     · 后果：${bug.why}`
                + `\n     · 顶层绑定表里没有它、也没有 import 它 ⇒ 一调就 \`ReferenceError: ${n} is not defined\``);
        }
    }
    // ★反向自证：这条口径对"真的有出处的名字"必须放行（否则它会把整个模块判死）
    for (const ok of ['readHotMeta', 'hotAccountShape', 'loadHotAccount', 'createParamHub', 'freshCtx', 'paramHub']) {
        assert.ok(bound.has(ok), `★负控：\`${ok}\` 是有出处的（import / 顶层 let）⇒ 上面那条不许把它也咬掉`);
    }
});

test('★★leg82 ⑦：★BUG☆ 自证面 `gatherParamEvidence()` 必须能真调（它是"用户不开控制台"的唯一读数）', () => {
    let ev = null;
    let err = null;
    try { ev = api.gatherParamEvidence(); } catch (e) { err = e; }
    assert.equal(err, null,
        `★★★\`gatherParamEvidence()\` 一调就抛：\`${err && err.constructor.name}: ${err && err.message}\` ——`
        + '它读的三个读数（主路键名/原文 · 世界名/桶键 · 真源与镜像一致性）**一个都拿不到**；'
        + '而这个函数存在的理由就是"用户不开控制台粘代码"（本仓 leg46 那段最贵的教训）');
    assert.equal(typeof ev, 'object', '★自证面必须返回一个读数对象');
    assert.ok('主路键名' in ev, '★自证面必须带上「主路键名」这一格');
    assert.ok('世界名' in ev, '★自证面必须带上「世界名」这一格');
    // ★它必须**只读**：调一次自证面不许把参数改掉
    const w = makeWorld();
    api.set(w, '每轮递线', '6');
    try { api.gatherParamEvidence(); } catch (_) { /* 本棒已知它会抛；"只读"这条另行取证 */ }
    assert.equal(api.displayEnv(w)['每轮递线'], '6', '★自证面**只读**：调它不许把玩家选的值改掉');
});

test('★★leg82 ⑧：★BUG☆ `sw2WriteHotMetaEnsuringParams` 必须能真调（快照恢复/导入那条路）', () => {
    const w = makeWorld();
    let err = null;
    let out;
    try { out = api.sw2WriteHotMetaEnsuringParams({ world: w }); } catch (e) { err = e; }
    assert.equal(err, null,
        `★★★\`sw2WriteHotMetaEnsuringParams({world})\` 一调就抛：\`${err && err.constructor.name}: ${err && err.message}\` ——`
        + '它引用了 `writeHotMeta`（`web/hot-ledger.js` 有导出，本文件只 import 了 `readHotMeta`）'
        + ' ⇒ 这条"账本被整份换掉之前先把真源镜像补上"的路**整个不可用**：'
        + '快照恢复 / 导入 / 清演化层之后，引擎（`limits.js` 的闸 / `pack.js` 进包）会按**旧档**跑');
    assert.ok(out === undefined || typeof out === 'object', '★返回面必须是 `undefined` 或对象（不许是别的形状）');
});

test('★★leg82 ⑨：`sw2UndoParam` 的撤销主路必须真能走通（且撤销之后画面要被叫去重画）', () => {
    const w = makeWorld();
    api.set(w, '每轮递线', '6');
    api.setLastWorld(w);
    assert.equal(api.sw2ParamUndoState().canUndo, true, '★测试前置：撤销栈必须进了 1 步');
    let r = null;
    let err = null;
    try { r = api.sw2UndoParam(); } catch (e) { err = e; }
    assert.equal(err, null, `★\`sw2UndoParam()\` 不许抛：\`${err && err.message}\``);
    assert.equal(r.ok, true, `★撤销必须成功（实测 ${JSON.stringify(r)}）`);
    assert.equal(api.sw2ParamUndoState().canUndo, false, '★撤销成功之后那一步必须出栈');
    // ★撤销之后必须让面板重画 —— 接线层那个组合器（`refreshSections`）在**本模块里没有声明**
    //   ⇒ 被 `try {} catch {}` 吞掉。这条判据咬的是"它是不是真的被叫到了"（吞掉的失败不算成功）。
    //   ★反向自证：真把它接上的写法（同一个调用点传进一个函数）必须让这条口径变绿。
    const panel = read('web/param-panel.js');
    const bound = topLevelDecls(panel);
    for (const m of panel.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
        for (const part of m[1].split(',')) {
            const n = part.trim().split(/\s+as\s+/).pop().trim();
            if (n) bound.add(n);
        }
    }
    assert.ok(bound.has('refreshSections'),
        '★★`sw2UndoParam` 撤销成功后要 `refreshSections([\'params\', \'board\'])` 让面板重画，'
        + '而 `refreshSections` 在本模块里没有任何绑定 ⇒ 那句被 try 吞掉 ⇒ '
        + '玩家看到"按了撤销、参数退回去了、可画面还是旧值"（正是本族 leg48 那条"格与控件分叉"的同族观感）');
});

// ─────────────────── ⑩ ★★★leg103：开关那一排按钮的高亮（用户实机「这两个按钮又切换不了了」） ───────────────────

/**
 * ★假 DOM：**开关那一排**（两枚 `<button>`，`data-value` = 1 / 0）。
 *   ★它必须比 ① 那个台子更严：**一旦被写属性、被派发事件、被改文字，就当场抛**——
 *   因为本笔的口径是"只改高亮那一件事"，其余一律不许碰（派发事件会把刚写成的值覆盖回去 = leg48 那个坑）。
 */
function makeFakeSwitchDom({ litValue = null } = {}) {
    const mk = (value, lit) => {
        const cls = new Set(lit ? ['sw2-btn', 'sw2-primary'] : ['sw2-btn']);
        return {
            tagName: 'BUTTON',
            getAttribute: (a) => (a === 'data-value' ? value : (a === 'data-param' ? AUTO_ADVANCE : null)),
            setAttribute: () => { throw new Error('★开关按钮不许被写属性'); },
            dispatchEvent: () => { throw new Error('★不许派发事件（自己吐事件会覆盖刚写成的值）'); },
            click: () => { throw new Error('★不许替玩家点击'); },
            classList: {
                contains: (c) => cls.has(c),
                add: (c) => { cls.add(c); return undefined; },
                remove: (c) => { cls.delete(c); return undefined; },
            },
            _lit: () => cls.has('sw2-primary'),
        };
    };
    const b1 = mk('1', litValue === '1');
    const b0 = mk('0', litValue === '0');
    const btns = [b1, b0];                       // ★顺序与渲染一致：先「开」后「关」（`render.js` 的 switchRow）
    Object.defineProperty(b1, 'textContent', { set: () => { throw new Error('★不许改按钮文字'); }, get: () => '开' });
    Object.defineProperty(b0, 'textContent', { set: () => { throw new Error('★不许改按钮文字'); }, get: () => '关' });
    // ★★假窗口必须同时提供两个口（这是**反向自证逼出来的**）：`sw2SetParamControl` 走
    //   `querySelector`（取一枚，真机上开关那一排它取到的是**第一枚 BUTTON**，正是病灶的形状），
    //   `sw2SyncParamSwitch` 走 `querySelectorAll`（取那一排）。
    //   ★第一版只给了 `querySelectorAll` ⇒ 判据只测到新函数、**没走产品真入口**，
    //     变异演练当场报"没咬住"（拆掉开关那一支，判据照旧全绿）⇒ 补上这两口才咬得住。
    const win = { querySelector: () => b1, querySelectorAll: () => btns };
    const doc = { getElementById: () => win };
    return { doc, win, b1, b0 };
}

test('★★★leg103·⑩：开关那一排按钮的**高亮**必须按真源对齐（只改高亮，不碰文字/不派发事件）', () => {
    // 病（用户实机截图 + 「这两个按钮又切换不了了」）：写盘成功、显示格也变了，
    //   **只有按钮的高亮没人管** —— 而"开/关"这个视觉信号只活在高亮（`.sw2-primary`）上。
    //   机理：写格那条路（`sw2ParamControlOf` / `sw2ControlText`）三态全认（SELECT/INPUT/BUTTON），
    //   而"对齐控件"这条（`sw2SetParamControl`）开局只认 SELECT/INPUT ⇒ 开关那一排**直接 return**。
    //   它一直没被发现，是因为改参数后面板**不再重画**（leg46 续·五 定稿）——
    //   原来靠重画"顺手画对"的那一下没了，而高亮恰恰是**唯一只由重画画出来的状态**。
    assert.equal(typeof api.sw2SyncParamSwitch, 'function', '★`sw2SyncParamSwitch` 必须由受控口交出来（判据要能单独调它）');

    const savedDoc = globalThis.document;
    const fake = makeFakeSwitchDom({ litValue: '0' });          // 起点：真源说关、高亮也在「关」⇒ 一致态
    globalThis.document = fake.doc;
    try {
        // ① 真源 = 开 ⇒ 「开」那枚必须亮、「关」那枚必须灭
        //   ★台子要照**真机次序**搭：hub 得先"见过"这个世界（真机上就是玩家在参数页动过这一格 ⇒
        //     接线层 `paramApi.set(...)`）。不这么做的话 `currentWorldName()` 是 null，
        //     面板按**出厂默认**作答（本仓那条"读的桶必须与写的桶同一个"的老病），
        //     测的就不是本笔要咬的那件事了 —— 这是**我搭台子踩的一脚**，如实留档。
        //   ★★入口必须是**产品真入口** `sw2SetParamControl`（接线层在一笔操作结束时调的就是它）：
        //     只调 `sw2SyncParamSwitch` 的话，把 `sw2SetParamControl` 里那一支整个拆掉判据照旧全绿
        //     —— 这是反向自证（`leg103-mutate-switch.mjs`）当场抓出来的，第一版判据就栽在这儿。
        const wOn = makeWorld('大荒z');
        api.set(wOn, AUTO_ADVANCE, '1');
        api.setLastWorld(wOn);
        const moved = api.sw2SetParamControl(AUTO_ADVANCE);
        assert.equal(moved, true, '★从"关"变"开"必须真的动了高亮（返回 true）');
        assert.equal(fake.b1._lit(), true, '★真源是"开" ⇒ 「开」那枚必须亮（它是玩家唯一能读到的状态信号）');
        assert.equal(fake.b0._lit(), false, '★「关」那枚必须灭（两枚同时亮 = 画面自相矛盾）');

        // ② 幂等：已经一致 ⇒ 一个字节都不动（返回 false，且不抛）
        assert.equal(api.sw2SetParamControl(AUTO_ADVANCE), false, '★已经一致 ⇒ 不许再动（幂等）');

        // ③ 真源 = 关 ⇒ 反过来（换一个世界，避免踩到上一个世界的真源）
        const wOff = makeWorld('大荒A');
        api.set(wOff, AUTO_ADVANCE, '0');
        api.setLastWorld(wOff);
        assert.equal(api.sw2SetParamControl(AUTO_ADVANCE), true, '★从"开"变"关"同样要动');
        assert.equal(fake.b0._lit(), true, '★真源是"关" ⇒ 「关」那枚必须亮');
        assert.equal(fake.b1._lit(), false, '★「开」那枚必须灭');

        // ④ ★★缺席键**不是"关"**：本仓口径是"空着就是空着" ⇒ 两枚都不许亮（`未定`）
        const wNone = makeWorld('大荒B');
        api.setLastWorld(wNone);                                 // 这个世界的真源里没有这个键
        api.sw2SetParamControl(AUTO_ADVANCE);
        assert.equal(fake.b1._lit() || fake.b0._lit(), false,
            '★★这一格没有值时两枚都不许亮 —— 把"空着"画成"关"就是替引擎下判断（本仓"空就是空"）');

        // ⑤ 这一格没有控件（真机上"这个键没画控件"就是**根本没有节点**）⇒ 如实返回 false，不猜
        //   ★台子上必须**两个口都是空**：`sw2SetParamControl` 先走 `querySelector`（空 ⇒ `el` 为 null），
        //     再落到开关那一支走 `querySelectorAll`（空 ⇒ 没有按钮）⇒ 两条路都得体退让。
        const emptyWin = { querySelector: () => null, querySelectorAll: () => [] };
        assert.equal(api.sw2SetParamControl('每轮递线', emptyWin), false,
            '★找不到控件/按钮 ⇒ 返回 false（宁可不动，也不许凭空造一个高亮出来）');
    } finally {
        if (savedDoc === undefined) delete globalThis.document; else globalThis.document = savedDoc;
    }
});
