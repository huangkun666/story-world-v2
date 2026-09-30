// story-world-v2/test/web-hot-ledger-layout.test.js
// ★★★leg78（**丙-web · 热账那一格**）：`web/index.js` 的**热账（hot-meta）读写落盘子系统**
//   搬进 `web/hot-ledger.js` 之后的**结构判据**。
//
// 这一棒做了什么（细案 §3.2「按语义边界切、一次切一族」的**第三格**）：
//   `web/hot-ledger.js` ← `readHotMeta` / `writeHotMeta` / `flushHotMeta` / `hotMetaSignatureOf` /
//   `hotMetaFingerprint` / `reassertWrittenMetaIfClobbered` / `sw2CallSaveChat` / `sw2ExplicitChatName` /
//   `sw2SetFlushTimeout` / `flushTimeoutMs` + **7 个热账状态** + `SW2_FLUSH_TIMEOUT_MS` / `SW2_FLUSH_TRIES` /
//   `SW2_SAVE_MIN_MS` / `SW2_FLUSH_BACKOFF_MS` + 依赖注入工厂 + 热账那半的复位 `resetHotLedgerState`。
//
// ★**为什么需要这一条判据**（不是为了好看的行数）：
//   ① 热账这一族此前**散在 3100+ 行接线层的六段里**（★与 leg72 记忆族、leg73 快照族**都不同**——
//      那两族是连续块），而且**参数块正夹在它中间** ⇒ "账本怎么写下去 / 怎么落盘 / 被覆盖了怎么办"
//      每一处改动都要先穿过一片无关代码。
//   ② 更要紧的是**状态归属**：热账那 7 个模块级状态原来被接线层**直接读写**
//      （`flushOutcomeText` 读 `sw2FlushTimeoutMs`、复位路径写 8 行…）⇒ 搬走时若劈成两半，
//      就是本仓最贵的病——**两份真相**。★本棒**当场踩到过一次**：`flushOutcomeText` 里那句
//      `Math.round(sw2FlushTimeoutMs / 1000)` 就是"跨块读私有状态"，漏了它搬完当场 `ReferenceError`
//      ⇒ 定稿给它开了受控口 `hotHub.flushTimeoutMs()`（下面第 ③ 条咬它）。
//   ③ 还有一条**时序约束**（下面第 ④ 条咬它）：`writeHotMeta` 末尾要调 `snapHub.requestSnapshot(...)`，
//      而快照 hub 由接线层**在热账之后**才建（leg73 的次序）⇒ 只能注入**取值函数**；
//      ★本棒第一版把这个调用记成"热账 hub 自己的口"（`getHotHub().requestSnapshot`）⇒ 实机当场
//      `TypeError: getHotHub(...).requestSnapshot is not a function`（判据/测试当场红）。
//
// ★判据形态纪律（照 `test/web-snapshot-layout.test.js` / `test/web-memory-layout.test.js` 同一把尺）：
//   ① 判"某个东西在不在"一律跑在**剥注释后的源码**上（leg71 §4.1 的洞：留痕注释里就写着这些符号名）；
//   ② 每条判据都要能**当场红**（几条关键的都带反向自证）；
//   ③ 不许用"我在某一本书里看到的词"当判据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

/** 逐字符注释剥离器（跳过字符串/模板）。★本文件必须有它：留痕注释里就写着这些符号名（同族两棒同款）。 */
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

/** 族符号契约（**本清单就是"它们该住哪"**）——函数与状态分开列，因为两族的家不同 */
const FAMILY_FN = [
    'readHotMeta', 'writeHotMeta', 'flushHotMeta', 'hotMetaSignatureOf', 'hotMetaFingerprint',
    'sw2ExplicitChatName', 'flushTimeoutMs', 'resetHotLedgerState', 'createHotLedgerHub',
];
// ★族**内部**的：搬过来了、但**不导出**（外面没有消费者）⇒ 判据只要求"新家有、旧家无"
const FAMILY_FN_INTERNAL = ['reassertWrittenMetaIfClobbered', 'sw2CallSaveChat'];
// ★★**转发口**（第三类，别与前两类混）：定义**只在**新家，但接线层保留一个**同名的转发函数**——
//   理由是它是**判据钩子**（`sw2SetFlushTimeout` 供 `node --test` 把超时压到几十毫秒），
//   名字与文件路径一改，两个测试文件都要动；保留转发 ⇒ **测试零改动**。
//   ⇒ 判据对它们的口径是：**新家有真定义 + 接线层的那个体必须是"只转发"**（下面第 ③ 条咬"只转发"）。
const FAMILY_FN_FORWARDER = ['sw2SetFlushTimeout'];
const FAMILY_STATE = [
    'sw2HotMetaFlushing', 'sw2HotMetaLastCallAt', 'sw2HotMetaLastWriteAt',
    'sw2HotMetaPendingWriteAt', 'sw2HotMetaLastFlushOkAt', 'sw2HotMetaFlushedCurrent',
    'sw2FlushChain', 'sw2FlushChainBusy', 'sw2FlushTimeoutMs',
    'sw2HotMetaWrittenFp', 'sw2HotMetaWrittenMeta',
];
// ★接线层要够到族的口（= 受控通道清单；下面第 ③ 条要求它真的被用）
//   ★前三个是**解构**取的（`const { readHotMeta, … } = hotHub;` ⇒ 调用点是裸名），
//     其余是**成员**调用。两种都是受控通道，判据按各自形态分开表达（★不许混成一类：
//     本仓 leg78 的"缝分两种"那条教训同款）。
const HUB_DESTRUCTURED = ['readHotMeta', 'writeHotMeta', 'flushHotMeta'];
const HUB_MEMBER_USE = [
    'hotHub.resetHotLedgerState', 'hotHub.sw2SetFlushTimeout', 'hotHub.flushTimeoutMs',
];

// ─────────────────── ① 搬家结果：符号只在**新家**定义，旧家不再定义 ───────────────────

test('★★leg78 丙-web③：热账族在新家**定义**、在旧家**不再定义**（防"搬了但旧家还留一份"）', () => {
    const hot = stripComments(read('web/hot-ledger.js'));
    const index = stripComments(read('web/index.js'));

    for (const n of FAMILY_FN) {
        assert.match(hot, new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${n}\\b`),
            `★\`${n}\` 必须在 \`web/hot-ledger.js\` 里导出`);
        assert.ok(!new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${n}\\b`, 'm').test(index),
            `★\`${n}\` **不许**还在 \`web/index.js\` 里定义（那就是两份复制品）`);
    }
    // ★族**内部**那两个：搬来了、不导出（外面零消费者）
    for (const n of FAMILY_FN_INTERNAL) {
        assert.match(hot, new RegExp(`(?:async\\s+)?function\\s+${n}\\b`),
            `★\`${n}\` 必须**搬进** \`web/hot-ledger.js\`（族内部用，不导出）`);
        assert.ok(!new RegExp(`(?:async\\s+)?function\\s+${n}\\b`).test(index),
            `★\`${n}\` **不许**还在 \`web/index.js\` 里定义（那就是两份复制品）`);
    }
    // ★转发口：新家有**真定义**；接线层那个**只许转发**（不许自己再实现一遍）
    for (const n of FAMILY_FN_FORWARDER) {
        assert.match(hot, new RegExp(`export\\s+function\\s+${n}\\b`),
            `★\`${n}\` 的真定义必须在新家`);
        assert.match(index, new RegExp(`export\\s+function\\s+${n}\\([^)]*\\)\\s*\\{\\s*return\\s+hotHub\\.${n}\\(`),
            `★接线层的 \`${n}\` 必须是**只转发**（\`return hotHub.${n}(…)\`）——`
            + '自己再写一遍实现 = 热账的复位/超时就有两个家（本仓最贵的病）');
    }
    // ★状态：新家**恰好一处** `let` 定义；旧家**一个字都不许有**
    for (const n of FAMILY_STATE) {
        assert.equal((hot.match(new RegExp(`^let\\s+${n}\\b`, 'gm')) || []).length, 1,
            `★\`${n}\` 在 \`web/hot-ledger.js\` 里必须**恰好一处**定义`);
        assert.ok(!new RegExp(`\\b${n}\\b`).test(index),
            `★★\`web/index.js\` 的**代码**里不许再出现 \`${n}\`（注释里可以留档；`
            + '★leg72 就是漏看了块外的直接读写 ⇒ 搬完当场 `ReferenceError`；本棒的 `sw2FlushTimeoutMs` 同款）');
    }
    // ★反向自证：裸正则在**注释里照样命中** ⇒ 必须先剥注释，否则"把 export 注释掉"能骗过判据
    const COMMENTED = '// export function readHotMeta() { return null; }';
    assert.ok(!new RegExp(`export\\s+(?:async\\s+)?function\\s+readHotMeta\\b`).test(stripComments(COMMENTED)),
        '★反向自证：被注释掉的"定义"必须不被认作定义（否则上面那几条是假绿）');
    assert.ok(!new RegExp(`\\bsw2FlushChain\\b`).test(stripComments('// sw2FlushChain 的说明（注释里留档）')),
        '★反向自证：注释里提到状态名不算"代码里出现"（否则留档就把判据自己搞红）');
});

// ─────────────────── ② 方向单向：新模块是**叶子中的叶子**（零 import） ───────────────────

test('★★leg78 丙-web④：新模块**零 import**（叶子），且不许反向 import 接线层', () => {
    const hot = read('web/hot-ledger.js');
    const imports = [...hot.matchAll(/^\s*import\s.+$/gm)].map((m) => m[0]);
    // ★这一条是本族的**形状特征**：热账谁也不依赖（连 `src/` 都不 import）——
    //   它要的 `freshCtx` / `HOT_META_KEY` / 快照 hub 全是**注入**进来的。
    //   ⇒ 多出一条 import 都要问一句"为什么"（尤其不许出现 `./index.js`）。
    assert.deepEqual(imports, [], `★\`web/hot-ledger.js\` 必须是零 import 的叶子；实际 ${imports.length} 条：${imports.join(' | ')}`);
    assert.ok(!/from\s*'\.\/index\.js'/.test(hot), '★不许反向 import 接线层（那就是循环依赖）');
    assert.ok(!/from\s*'\.\.\/src\//.test(hot), '★连 `src/` 都不该 import（族内零外部逻辑依赖）');
});

// ─────────────────── ③ 状态归属：接线层一律走**受控通道** ───────────────────

test('★★★leg78 丙-web⑤：热账那 11 个状态**只有一个家**，接线层一律走受控通道', () => {
    const index = stripComments(read('web/index.js'));
    const hot = stripComments(read('web/hot-ledger.js'));

    // ① 工厂**必须被真的调用**（只 import 不调 = "搬走了但没人接线"，leg25 f 那条病历）
    assert.match(index, /const\s+hotHub\s*=\s*createHotLedgerHub\(\{/,
        '★接线层必须**真的建** hub（`const hotHub = createHotLedgerHub({…})`）');
    // ② 接线层必须真的**取/用**这些口（否则那是摆设）
    //   ★三个是解构取（调用点是裸名，全文件 27/15/10 处），其余是成员调用——两种形态都要真的在
    assert.match(index, /const\s*\{\s*readHotMeta,\s*writeHotMeta,\s*flushHotMeta\s*\}\s*=\s*hotHub;/,
        '★接线层必须从 hub **解构**取回读/写/落盘三个口');
    for (const n of HUB_DESTRUCTURED) {
        const uses = (index.match(new RegExp(`(?<![.\\w$])${n}\\(`, 'g')) || []).length;
        assert.ok(uses >= 2, `★接线层必须真的**调** \`${n}()\`（实测 ${uses} 处调用；只取不用 = 摆设）`);
    }
    for (const use of HUB_MEMBER_USE) {
        assert.ok(index.includes(use), `★接线层必须真的用 \`${use}\`（否则那是摆设）`);
    }
    // ③ ★★本棒当场踩到的那一格：超时档**只许经受控口读**
    //    病：`flushOutcomeText` 原先直接读热账的私有 `sw2FlushTimeoutMs`（跨块读状态）⇒
    //    搬完当场 `ReferenceError`（判据红）。⇒ 定稿读 `hotHub.flushTimeoutMs()`。
    assert.match(index, /hotHub\.flushTimeoutMs\(\)/, '★超时档必须走 `hotHub.flushTimeoutMs()` 读');
    assert.match(hot, /export function flushTimeoutMs\(\)\s*\{\s*return sw2FlushTimeoutMs;/,
        '★`flushTimeoutMs()` 必须真的返回那份状态（空壳 ⇒ 状态条那句"超过 N 秒"永远印 0）');
    // ④ 复位：热账那 8 行搬走了，接线层的组合器必须**真的调**新模块的复位口
    assert.match(index, /hotHub\.resetHotLedgerState\(\)/,
        '★落盘簿记复位必须走 `hotHub.resetHotLedgerState()`（原来直接写那 8 行）');
    assert.match(hot, /export function resetHotLedgerState\(\)\s*\{[\s\S]*?sw2FlushChain = Promise\.resolve\(\);/,
        '★`resetHotLedgerState()` 必须真的清掉那 8 行（少一个都会让下一条用例串味）');
    // ⑤ 反向自证：这条"状态只有一个家"的口径**真的会咬** —— 拿一段"直接读写状态"的假源码喂给它
    for (const bad of ['const x = sw2HotMetaFlushing;', 'sw2FlushChain = Promise.resolve();', 'flushOutcomeText({ x: sw2FlushTimeoutMs })']) {
        const sym = FAMILY_STATE.find((n) => bad.includes(n));
        assert.ok(sym && new RegExp(`\\b${sym}\\b`).test(stripComments(bad)),
            `★反向自证：块外直接读写 \`${sym}\` 的写法必须被这条口径认出来（否则它是假绿）：${bad}`);
    }
});

// ─────────────────── ④ ★★时序铁律：快照 hub 只能**迟到注入** ───────────────────

test('★★★leg78 丙-web⑥：`getSnapHub` 必须是**取值函数**（快照 hub 比热账 hub 后建）', () => {
    const index = stripComments(read('web/index.js'));
    const hot = stripComments(read('web/hot-ledger.js'));
    // ★为什么：`writeHotMeta` 末尾要调 `snapHub.requestSnapshot(...)`，而快照 hub 由接线层
    //   **在热账之后**才建（leg73 的次序：它要的 `readHotMeta`/`flushHotMeta` 现在住热账模块）
    //   ⇒ 构造时抓死会拿到 undefined，调用点当场 `TypeError`（本棒第一版就是这么坏的）。
    assert.match(index, /getSnapHub:\s*\(\)\s*=>\s*snapHub/,
        '★接线层必须以**箭头取值函数**注入 `getSnapHub`（写成现成对象 ⇒ 构造时求值 ⇒ undefined）');
    assert.match(hot, /getSnapHub\(\)\.requestSnapshot\s*\(/,
        '★新模块必须经 `getSnapHub()` 调 `requestSnapshot`（不是构造时抓死那个 hub）');
    // ★顺序自证：热账 hub 必须在快照 hub **之前**建（否则"迟到注入"这个理由不成立）
    const iHot = index.indexOf('const hotHub = createHotLedgerHub(');
    const iSnap = index.indexOf('const snapHub = createSnapshotHub(');
    assert.ok(iHot > 0 && iSnap > 0 && iHot < iSnap,
        `★热账 hub 必须先于快照 hub 建（实测 hotHub@${iHot} / snapHub@${iSnap}）——`
        + '这正是"快照只能迟到注入"的原因；若次序变了，本条与依赖方向都要重新论证');
});

// ─────────────────── ⑤ 接线层真的变薄（本棒的可观察效果） ───────────────────

test('★leg78 丙-web⑦：接线层真的变薄，且不再 import 那一族的外部依赖', () => {
    const index = read('web/index.js');
    const lines = index.split('\n').length;
    // ★本棒实测：3296 → 3108 行（把六段里的热账代码抽走；块内注释一并跟走）
    // ★leg80 复量：取书族又搬走一格 ⇒ 2861 行（★本棒**只动下界**：上界 3150 原样留着，
    //   它守的"接线层不许回涨"一个字没放宽；下界按新的实测值下移，口径仍是"它还是个接线层"）。
    // ★leg82 复量：参数族（最后一格）又搬走一格 ⇒ 2692 行（同一口径：**只动下界**，上界 3150 不动）。
    assert.ok(lines < 3150, `★\`web/index.js\` 应变薄（热账族搬走了）；实际 ${lines} 行`);
    assert.ok(lines > 2600, `★但它仍是接线层（别把不该搬的也搬了）；实际 ${lines} 行`);
    // ★新家必须**真的有内容**（防"建了个空文件充数"）
    const hotLines = read('web/hot-ledger.js').split('\n').length;
    assert.ok(hotLines > 250, `★\`web/hot-ledger.js\` 必须真的装着那一族；实际 ${hotLines} 行`);
    // ★工厂必须真的把三样依赖装进去（缺一样就是"搬了但没接线"）
    for (const dep of ['deps.freshCtx', 'deps.hotMetaKey', 'deps.getSnapHub']) {
        assert.ok(stripComments(read('web/hot-ledger.js')).includes(dep), `★工厂必须装上 \`${dep}\``);
    }
});
