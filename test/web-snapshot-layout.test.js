// story-world-v2/test/web-snapshot-layout.test.js
// ★★★leg73（**丙-web · 快照那一格**）：`web/index.js` 的**快照容错子系统**搬进 `web/snapshot-store.js`
//   之后的**结构判据**。
//
// 这一棒做了什么（细案 §3.2「按语义边界切、一次切一族」的**第二格**，第一格是 leg72 的记忆族）：
//   `web/snapshot-store.js` ← `ensureSnapshotChain` / `snapshotStore` / `stripParamKeys` / `isParamOnlyChange` /
//   `requestSnapshot` / `snapshotList` / `restoreSnapshot` / `clearSnapshots` / `resetSnapshots` /
//   `refreshSnapshots` + **五个链状态** + `sw2SnapshotCache`（它原住在块尾**之外**）+ 依赖注入工厂。
//
// ★**为什么需要这一条判据**（不是为了好看的行数）：
//   ① 快照这一族**本来就是一个完整子系统**（自己的状态、自己的编排"何时拍/基准从哪来/失败怎么吞"、
//      自己的保留窗口），却住在 3500 行接线层的中间 ⇒ "快照怎么拍/怎么回"的每一处改动都要先穿过一片无关代码。
//   ② 更要紧的是**状态归属**：快照那六个模块级状态原来被接线层**直接读写**（复位路径 :897-898 两处 +
//      `renderCfg` 读清单面 :1736）⇒ 搬走时若把它劈成两半，就是本仓最贵的病——**两份真相**。
//   ③ 还有一条本棒当场量出来的**形态约束**（下面第 ④ 条咬它）：接线层那两个状态（`sw2LastWorld` /
//      `LISTED_VOLUMES`）声明在**更后面**、且会被反复重新赋值 ⇒ 只能注入**取数函数**，
//      注入值或写成箭头都会在初始化期炸（TDZ）。判据必须把这条口径钉住，否则下一棒"顺手改成箭头"就复发。
//
// ★判据形态纪律（照 `test/web-memory-layout.test.js` / `test/module-layout.test.js` 同一把尺）：
//   ① 判"某个东西在不在"一律跑在**剥注释后的源码**上（leg71 §4.1 的洞：留痕注释里就写着这些符号名）；
//   ② 每条判据都要能**当场红**（下面几条都带反向自证）；
//   ③ 不许用"我在某一本书里看到的词"当判据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

/**
 * 逐字符注释剥离器（跳过字符串/模板）。
 * ★本文件**必须有它**：本棒的留痕注释里就写着 `sw2SnapChain` / `sw2SnapshotCache` / `requestSnapshot` 这些词，
 *   裸正则扫全文会把注释当成"还在引用"⇒ 判据当场红在**自己的留档**上（假红）。
 *   （与 `test/web-memory-layout.test.js` 的 `stripComments` 同一把尺。）
 */
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

/** 从 `import { ... } from './x.js'` 里取出该文件**从某模块**取的那批符号。 */
function importedFrom(src, moduleRe) {
    const out = [];
    for (const m of src.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)'/g)) {
        if (!moduleRe.test(m[2])) continue;
        for (const raw of m[1].split(',')) {
            const n = raw.trim().split(/\s+as\s+/)[0].trim();
            if (n) out.push(n);
        }
    }
    return out;
}

/** 该文件里所有 `export ... from '...'`（= **re-export**，本仓明令不搞：它会让"它到底住哪"重新变模糊）。 */
function reExports(src) {
    return [...src.matchAll(/export\s*\{[^}]*\}\s*from\s*'([^']+)'/g)].map((m) => m[1]);
}

// ── 契约清单：这一族**该住哪** ────────────────────────────────
// ★10 个函数（逐字节随块搬走的那一批）
const FAMILY_FN = [
    'ensureSnapshotChain', 'snapshotStore', 'stripParamKeys', 'isParamOnlyChange',
    'requestSnapshot', 'snapshotList', 'restoreSnapshot', 'clearSnapshots',
    'resetSnapshots', 'refreshSnapshots',
];
// ★六个模块级状态（原 index.js:926-929 / :982 / :1145）
const FAMILY_STATE = [
    'sw2SnapChain', 'sw2SnapQueue', 'sw2SnapLast', 'sw2SnapInited', 'sw2SnapLastWorldFp',
    'sw2SnapshotCache',
];
// ★新模块额外给出的两条**受控通道** + 一个依赖注入工厂
const CHANNELS = ['readSnapshotCache', 'resetDedupState', 'createSnapshotHub'];
// ★接线层要取回的：只有那个工厂（其余一律经 hub 的方法取用 ⇒ 这就是"依赖注入"的形状）
const BACK_TO_INDEX = ['createSnapshotHub'];

// ─────────────────── ① 搬家结果：符号只在**新家**定义，旧家不再定义 ───────────────────

test('★★leg73 丙-web①：快照那一族在 `web/snapshot-store.js` **定义**、在 `web/index.js` **不再定义**', () => {
    const store = stripComments(read('web/snapshot-store.js'));
    const index = stripComments(read('web/index.js'));

    for (const n of [...FAMILY_FN, ...CHANNELS]) {
        assert.match(store, new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${n}\\b`),
            `★\`${n}\` 必须在 \`web/snapshot-store.js\` 里导出`);
        assert.ok(!new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${n}\\b`).test(index),
            `★\`${n}\` **不许**还在 \`web/index.js\` 里定义（那就是两份复制品）`);
    }
    // ★状态也要一起搬（本仓 leg72 §4.1 的血教训：普查只数函数、漏了 `let/const` ⇒ 搬完当场 ReferenceError）
    for (const n of FAMILY_STATE) {
        assert.match(store, new RegExp(`^let\\s+${n}\\b`, 'm'),
            `★状态 \`${n}\` 必须在 \`web/snapshot-store.js\` 里定义（它随族一起搬）`);
        assert.ok(!new RegExp(`^let\\s+${n}\\b`, 'm').test(index),
            `★★状态 \`${n}\` **不许**还留在 \`web/index.js\` 里定义——状态劈成两半就是本仓最贵的病（两份真相）`);
    }
    // ★★本仓明令：**不搞 re-export**（leg71 立的规矩）——re-export 会让"它到底住哪"重新变模糊。
    assert.deepEqual(reExports(read('web/index.js')), [],
        '★`web/index.js` 不许 re-export（消费者该改指向就改指向）');
    assert.deepEqual(reExports(read('web/snapshot-store.js')), [],
        '★`web/snapshot-store.js` 不许 re-export');

    // 反向自证（本仓那条纪律）:**裸正则会被注释骗**——留痕注释里就写着这些符号名。
    const COMMENTED = '// export async function refreshSnapshots() {}';
    assert.ok(new RegExp('export\\s+(?:async\\s+)?function\\s+refreshSnapshots\\b').test(COMMENTED),
        '★反向自证（第 1 半）：**裸正则**确实会命中注释里的那行 —— 这就是为什么必须剥注释');
    assert.ok(!new RegExp('export\\s+(?:async\\s+)?function\\s+refreshSnapshots\\b').test(stripComments(COMMENTED)),
        '★反向自证（第 2 半）：剥注释之后不再命中（判据这才真的防得住）');
    assert.ok(stripComments(COMMENTED).trim() === '', '★剥离器自证：整行注释剥完什么都不剩');
    assert.ok(stripComments('const a = "// 不是注释";').includes('不是注释'),
        '★剥离器自证：字符串里的 `//` 不许被当注释剥掉');
    // ★第 3 半（本棒新增）：`let` 那条口径也要能认出注释里的假声明
    assert.ok(!new RegExp('^let\\s+sw2SnapChain\\b', 'm').test(stripComments('// let sw2SnapChain = {};')),
        '★反向自证：注释里的假 `let sw2SnapChain` 不许被当成真声明');
});

test('★leg73 丙-web②：`web/index.js` 只取回那个工厂（依赖注入的形状：集合不多不少）', () => {
    const index = read('web/index.js');
    const got = importedFrom(index, /snapshot-store\.js$/);
    for (const n of BACK_TO_INDEX) {
        assert.ok(got.includes(n), `★\`web/index.js\` 必须从新模块 import \`${n}\``);
    }
    assert.deepEqual(got.slice().sort(), BACK_TO_INDEX.slice().sort(),
        '★取回集合 = 契约清单（**不多不少**）：只取工厂，其余一律经 hub 的方法取用'
        + '（多一个就是"顺手把别的东西也拖回来了"，那会让"谁拥有这块逻辑"重新变模糊）');
    // ★接线层从此**不再** import `src/snapshot.js`（那一族唯一的消费者是搬走的块）
    assert.ok(!/from\s*'\.\.\/src\/snapshot\.js'/.test(index),
        '★`web/index.js` 不该再 import `src/snapshot.js`（块外零消费者：纯逻辑全在搬走的块里用）');
    // ★工厂**必须被真的调用**（只 import 不调 = "搬走了但没人接线"，leg25 f 那条病历）
    assert.match(stripComments(index), /const\s+snapHub\s*=\s*createSnapshotHub\(\{/,
        '★接线层必须**真的建** hub（`const snapHub = createSnapshotHub({…})`）——否则快照整条路没人接');
    // ★接线层必须真的**用**它。
    //   ★★leg78：清单从 4 条收到 **3 条** —— 原先还有 `snapHub.requestSnapshot(`，而那个调用点住在
    //     `writeHotMeta` 里，leg78 把热账族整族搬进 `web/hot-ledger.js` ⇒ 它**跟着搬走了**。
    //     ⇒ 本条口径改成"**两条都查**"：接线层查剩下这三条，落账钩子那条查**热账新家**
    //       （★不放宽成 `snapshot-store.js` 里出现过就算 —— 那样"钩子有没有真挂上"就没人看了）。
    for (const use of ['snapHub.refreshSnapshots()', 'snapHub.readSnapshotCache()', 'snapHub.resetDedupState()']) {
        assert.ok(stripComments(index).includes(use), `★接线层必须真的用 \`${use}\`（否则那是摆设）`);
    }
    // ★leg78：落账唯一收口 `writeHotMeta` 现在住热账新家，它必须真的经取值函数调快照 hub
    //   （★形态是 `getSnapHub().requestSnapshot(`：快照 hub 比热账 hub **后建** ⇒ 只能迟到注入）
    assert.ok(stripComments(read('web/hot-ledger.js')).includes('getSnapHub().requestSnapshot('),
        '★落账收口必须真的调 `getSnapHub().requestSnapshot(`（快照钩子唯一挂点；搬走后不许变成摆设）');
});

// ─────────────────── ② ★★状态归属（本棒最该记住的一条） ───────────────────

test('★★★leg73 丙-web③：快照那六个状态**只有一个家**，接线层一律走受控通道', () => {
    const indexCode = stripComments(read('web/index.js'));
    const storeCode = stripComments(read('web/snapshot-store.js'));

    // ① 六个状态**只在**新模块里定义，且各自**恰好一处**（防"劈成两半"）
    for (const n of FAMILY_STATE) {
        assert.equal((storeCode.match(new RegExp(`^let\\s+${n}\\b`, 'gm')) || []).length, 1,
            `★\`${n}\` 在 \`web/snapshot-store.js\` 里必须**恰好一处**定义`);
        assert.ok(!new RegExp(`\\b${n}\\b`).test(indexCode),
            `★★\`web/index.js\` 的**代码**里不许再出现 \`${n}\`（注释里可以留档；`
            + '★leg72 就是漏看了块外的直接读写 ⇒ 搬完当场 `ReferenceError`）');
    }

    // ② 块外那三处引用**都改走了**受控通道（这是"状态只有一个家"的**可观察形状**）
    //    · `renderCfg` 读清单面 → `readSnapshotCache()`
    //    · `sw2ResetFlushState`（落盘簿记复位）清那两个闸 → `resetDedupState()`
    assert.match(indexCode, /snapshots:\s*snapHub\.readSnapshotCache\(\)/,
        '★`renderCfg` 必须走 `readSnapshotCache()` 读那份清单面（原来直接读 `sw2SnapshotCache`）');
    assert.match(indexCode, /snapHub\.resetDedupState\(\)/,
        '★落盘簿记复位必须走 `resetDedupState()`（原来直接写 `sw2SnapLast` / `sw2SnapLastWorldFp` 两行）');
    // ★通道**必须真的读写到那份状态**（不是空壳）
    assert.match(storeCode, /function\s+readSnapshotCache\(\)\s*\{\s*return\s+sw2SnapshotCache;/,
        '★`readSnapshotCache()` 必须真的返回那份状态（空壳 = 面板永远读到 null）');
    assert.match(storeCode, /function\s+resetDedupState\(\)\s*\{\s*sw2SnapLast\s*=\s*\[\];\s*sw2SnapLastWorldFp\s*=\s*null;\s*\}/,
        '★`resetDedupState()` 必须真的清掉两个闸（内容闸指纹 + 参数闸基准）——少一个都会让下一条用例判不出来');

    // ③ 反向自证：这条判据真的会咬 —— 拿一段"直接读写状态"的假源码喂给它，必须被认出来
    for (const bad of ['const x = sw2SnapChain;', 'sw2SnapLast = [];', 'renderCfg({ snapshots: sw2SnapshotCache })']) {
        const sym = FAMILY_STATE.find((n) => bad.includes(n));
        assert.ok(new RegExp(`\\b${sym}\\b`).test(stripComments(bad)),
            `★反向自证：块外直接读写 \`${sym}\` 的写法必须被这条口径认出来（否则它是假绿）：${bad}`);
    }
});

// ─────────────────── ③ 方向单向 + ★★TDZ 铁律 ───────────────────

test('★★leg73 丙-web④：新模块**不许反向 import** 接线层；且两个"迟到状态"只能走取数函数', () => {
    const store = read('web/snapshot-store.js');
    const back = [...store.matchAll(/from\s*'([^']*)'/g)].map((m) => m[1]);
    assert.ok(!back.some((p) => /index\.js$/.test(p)),
        '★`web/snapshot-store.js` 反向 import 了接线层 —— 那就是循环依赖');
    // ★它的依赖只有这五条：纯逻辑 / 参数键判定 / 引擎派生常量 / **旧账清理** / 存储适配。
    //   多一条都要问一句"为什么"。
    //   ★★★leg85 新增第五条 `../src/settle.js`：`restoreSnapshot` 写回前要跑**同一个**
    //     `migrateStyleRulesFromCanon`（leg74 §3-A 立、连续七棒登记的待办，本棒收口）。
    //     ★加这一条的**口径没有放宽**：它仍是"向下取纯逻辑"（`src/settle.js` 是叶子侧的模块），
    //       不是"反向 import 接线层"；而且与第 4 条同族（`params.js` 也是引擎常量）。
    assert.deepEqual(back.slice().sort(), [
        '../src/params.js', '../src/param-store.js', '../src/settle.js', '../src/snapshot.js', './idb-backend.js',
    ].sort(), '★新模块的 import 只许有这五条（叶子形态：只向下取纯逻辑与存储适配）');
    // ★块内**不许**再出现块外那几个符号的裸引用（它们现在只能经注入形参/取数函数拿到）
    const storeCode = stripComments(store);
    for (const outer of ['sw2LastWorld', 'LISTED_VOLUMES']) {
        assert.ok(!new RegExp(`(?<![\\w$.])${outer}(?![\\w$])`).test(storeCode),
            `★\`${outer}\` 是**接线层的**状态 ⇒ 新模块里不许出现裸引用（只能经 \`access*()\` 取数函数）`);
    }
    // ★★★leg85：注入形参清单加了 `hotAccountShape`——它是**本棒咬出来的真缺陷**的修法：
    //   以前那句 `hotAccountShape(r.world)` 是**裸引用**、而本文件里从来没有它（也没 import）
    //   ⇒ 恢复快照整条路一调就 `ReferenceError`，被 catch 吞成一行"恢复失败"（`hotAccountShape is not defined`）。
    for (const dep of ['freshCtx', 'setStatus', 'refreshWorld', 'loadHotAccount', 'readHotMeta',
        'sw2WriteHotMetaEnsuringParams', 'flushHotMeta', 'hotAccountShape']) {
        assert.ok(new RegExp(`let\\s+${dep}\\s*=\\s*null;`).test(storeCode),
            `★注入形参 \`${dep}\` 必须在模块作用域声明（\`let ${dep} = null;\`）——`
            + '它是"外面怎么够到接线层"的唯一入口');
        assert.ok(new RegExp(`\\b${dep}\\b`).test(storeCode), `★注入形参 \`${dep}\` 必须真的被用到`);
    }
    // ★★leg85：**必填的四样必须当场校验**（fail fast）——理由是上面那个真缺陷的形状：
    //   漏注入时**不报错、不报警**，只在玩家真去恢复那一刻炸，然后被 catch 吞掉。
    //   ⇒ 判据咬"那句校验必须在**赋形参之前**"（放在之后再校验，坏值已经被赋上去了）。
    assert.match(storeCode, /for \(const key of \['freshCtx', 'loadHotAccount', 'readHotMeta', 'hotAccountShape'\]\)/,
        '★`createSnapshotHub` 必须对必填四样逐个校验函数形态（缺依赖不许等到玩家点下去才炸）');
    assert.ok(storeCode.indexOf("typeof deps[key] !== 'function'") < storeCode.indexOf('freshCtx = deps.freshCtx;'),
        '★★校验必须在**赋形参之前**（放在之后 = 坏值已经赋进模块作用域了，那是"校验了个寂寞"）');

    // ★★★TDZ 铁律（本棒最该钉住的一条形态约束）：两个"迟到状态"必须走**取数函数**
    for (const [accessor, assigner] of [['accessLastWorld', 'assignLastWorld'], [null, null]]) {
        if (!accessor) continue;
        assert.match(storeCode, new RegExp(`let\\s+${accessor}\\s*=\\s*null;`), `★取数函数 \`${accessor}\` 必须在模块作用域`);
    }
    assert.match(storeCode, /let\s+assignLastWorld\s*=\s*null;/, '★写入口 `assignLastWorld` 必须在模块作用域');
    assert.match(storeCode, /let\s+accessListedVolumes\s*=\s*null;/, '★取数函数 `accessListedVolumes` 必须在模块作用域');
    // ★接线层侧：三个取数口必须是**函数声明**（提升 + 调用时才求值）——写成箭头就会在建 hub 那一刻求值 ⇒ TDZ 炸
    const indexCode = stripComments(read('web/index.js'));
    for (const fn of ['getLastWorld', 'setLastWorld', 'getListedVolumes']) {
        assert.match(indexCode, new RegExp(`^function\\s+${fn}\\s*\\(`, 'm'),
            `★接线层必须用**函数声明** \`function ${fn}() {…}\`（提升 + 调用时才求值）`);
        assert.ok(!new RegExp(`(?:const|let)\\s+${fn}\\s*=\\s*\\(?\\s*\\)?\\s*=>`).test(indexCode),
            `★★\`${fn}\` **不许**写成箭头函数——箭头在**建 hub 那一刻**就求值，`
            + '而 `sw2LastWorld` / `LISTED_VOLUMES` 声明在更后面 ⇒ 初始化期当场 `ReferenceError`（leg72 §3-A 量出来的坑）');
    }
    // ★反向自证：这条"箭头会炸"的口径真的能认出箭头形态
    assert.ok(/(?:const|let)\s+getLastWorld\s*=\s*\(\s*\)\s*=>/.test('const getLastWorld = () => sw2LastWorld;'),
        '★反向自证：箭头形态必须被这条口径认出来（否则它防不住下一棒"顺手改成箭头"）');
    // ★顺序自证：import 必须在 hub 构造**之前**（`import` 也吃 TDZ）
    const pImport = indexCode.split('\n').findIndex((L) => /from\s*'\.\/snapshot-store\.js'/.test(L));
    const pHub = indexCode.split('\n').findIndex((L) => /const\s+snapHub\s*=\s*createSnapshotHub\(/.test(L));
    assert.ok(pImport >= 0 && pHub >= 0 && pImport < pHub,
        `★import（L${pImport + 1}）必须在建 hub（L${pHub + 1}）之前 —— 否则同样是 ReferenceError`);
});

// ─────────────────── ④ 接线层薄了（"搬走"必须真的发生） ───────────────────

test('★leg73 丙-web⑤：接线层**真的变薄**了（新模块存在、旧家里那些族的实现体不在了）', () => {
    assert.ok(existsSync(new URL('../web/snapshot-store.js', import.meta.url)), '★新模块必须在盘上');
    const index = read('web/index.js');
    const store = read('web/snapshot-store.js');
    // 判"实现体在不在"用几个**只可能出现在这一族实现里**的记号。
    // ★本棒踩过的坑（如实留档）：第一版把 `const flushed = await flushHotMeta();` 也当成记号，
    //   结果当场红 —— 因为那是**通用写法**（接线层另有 6 条落盘通道都用它：名册入账/采用草稿/导入/…）。
    //   ⇒ 纪律：**"搬走了"的记号必须只属于这一族**，否则判据会咬在与本棒无关的邻居身上（假红）。
    for (const impl of [
        '快照链已对齐：盘上',                       // ensureSnapshotChain 的日志
        '快照链对齐失败（本次按新链处理）',           // 同上（catch 分支）
        'planRetention({ snapshots: metas })',      // 保留窗口那一处
        '只有参数档位变了（世界本体逐字节没变）',      // 参数闸的日志（leg41/leg53）
        '快照不可读：',                             // snapshotList 的兜底文案
        '快照失败（不影响世界推进）',                 // requestSnapshot 的零阻塞兜底
    ]) {
        assert.ok(!index.includes(impl), `★\`${impl.slice(0, 24)}\` 是实现体记号，不该还留在接线层（没搬干净或留了副本）`);
        assert.ok(store.includes(impl), `★\`${impl.slice(0, 24)}\` 必须在新模块里（否则是"搬丢了"）`);
    }
    // ★`restoreSnapshot` 那一处显式落盘（leg72b 立的）现在**只该在新家**：
    //   `const flushed = await flushHotMeta();` 是通用写法 ⇒ 不能按"接线层里有没有"判，
    //   只能按**这一族特有的上下文**判：恢复通道落在新模块，且接线层那条 `snapHub` 归零/读表都在。
    assert.ok(store.includes('const flushed = await flushHotMeta();'),
        '★恢复通道的显式落盘（leg72b）必须随 `restoreSnapshot` 一起搬进新模块');
    assert.ok(!/export async function restoreSnapshot/.test(index),
        '★`restoreSnapshot` 不许还留在接线层');
    // 规模判据（软性、只做兜底）：接线层必须真的短了 —— 搬走 196 行、留痕 ~18 行 ⇒ 至少少 150 行
    const indexLines = index.split('\n').length;
    assert.ok(indexLines < 3400, `★接线层行数 ${indexLines} —— 搬迁后应显著小于 3400（搬走 196 行、留痕约 18 行）`);
    assert.ok(store.split('\n').length > 200, `★新模块行数 ${store.split('\n').length} —— 它得真的把那一族装下`);
    // ★不变量：搬走的是**一整族**而不是半族 —— 快照那条链的五个状态必须都在新家（少一个就是断线）
    const storeCode = stripComments(store);
    for (const n of ['sw2SnapChain', 'sw2SnapQueue', 'sw2SnapLast', 'sw2SnapInited', 'sw2SnapLastWorldFp']) {
        assert.match(storeCode, new RegExp(`^let\\s+${n}\\b`, 'm'), `★链状态 \`${n}\` 必须在新家（它是这一族的骨架）`);
    }
});
