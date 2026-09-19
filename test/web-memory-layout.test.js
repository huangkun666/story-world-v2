// story-world-v2/test/web-memory-layout.test.js
// ★★★leg72（**丙-web · 记忆那一格**）：`web/index.js` 的**记忆投递子系统**搬进 `web/memory-store.js`
//   之后的**结构判据**。
//
// 这一棒做了什么（细案 §3.2「`web/index.js` 按动作总线切，保留一个薄接线层」的那条口径的**第一格**）：
//   `web/memory-store.js` ← `SW2_RECORD_PREFIX` / `TABLE_ID_ALIAS` / `memoryStore` / `pushMemoryNow` /
//   `memoryStoreReport` / `memoryStoreCheckLine` / `markMemoryPush` / `memoryPushLine`
//   + 模块级状态 `sw2MemoryPush` + 随迁的 `EVENTS_TABLE_NAME` 与 `src/memory-bridge.js` 的 import。
//
// ★**为什么需要这一条判据**（不是为了好看的行数）：
//   ① 记忆这一族**本来就是一个完整子系统**（自己的状态、自己的注入形参、自己的自检面），
//      却住在 3700 行接线层的中间 ⇒ "记忆投递"的每一处改动都要先穿过一片参数/视图代码。
//   ② 更要紧的是**状态归属**：`sw2MemoryPush`（投递自证面）原来被接线层**直接读写**（4 处）。
//      搬走时若把它劈成两半（一半留在接线层、一半进新模块），就是本仓最贵的病——**两份真相**。
//      ⇒ 判据必须咬住"**这份状态只有一个家，且外面一律走受控通道**"。
//
// ★判据形态纪律（照 `test/module-layout.test.js` / `test/adopt-scale-draft.test.js` 同一把尺）：
//   ① 判"某个东西在不在"一律跑在**剥注释后的源码**上（leg71 §4.1 的洞：留痕注释里就写着这些符号名）；
//   ② 每条判据都要能**当场红**（下面几条都带反向自证）；
//   ③ 不许用"我在某一本书里看到的词"当判据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

/**
 * 逐字符注释剥离器（跳过字符串/模板）。
 * ★本文件**必须有它**：本棒的留痕注释里就写着 `sw2MemoryPush` / `EVENTS_TABLE_NAME` 这些词，
 *   裸正则扫全文会把注释当成"还在引用"⇒ 判据当场红在**自己的留档**上（假红）。
 *   （与 `test/module-layout.test.js` 的 `stripComments` 同一把尺。）
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
const MOVED = [
    'SW2_RECORD_PREFIX', 'TABLE_ID_ALIAS', 'memoryStore', 'pushMemoryNow',
    'memoryStoreReport', 'memoryStoreCheckLine', 'markMemoryPush', 'memoryPushLine',
];
// ★新模块额外给出去的两条**受控通道**（接线层要用，见下"状态只有一个家"那条）
const CHANNELS = ['readMemoryPush', 'clearMemoryPush'];
// ★接线层要取回的：投递 / 自检一行 / 标记 / 显示行 + 两条通道
//   （`SW2_RECORD_PREFIX` / `TABLE_ID_ALIAS` / `memoryStore` / `memoryStoreReport` 接线层一个都不用 ⇒ 不取）
const BACK_TO_INDEX = ['pushMemoryNow', 'memoryStoreCheckLine', 'markMemoryPush', 'memoryPushLine', ...CHANNELS];

// ─────────────────── ① 搬家结果：符号只在**新家**定义，旧家不再定义 ───────────────────

test('★★leg72 丙-web①：记忆那一族在 `web/memory-store.js` **定义**、在 `web/index.js` **不再定义**', () => {
    const store = stripComments(read('web/memory-store.js'));
    const index = stripComments(read('web/index.js'));

    for (const n of [...MOVED, ...CHANNELS]) {
        assert.match(store, new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${n}\\b`),
            `★\`${n}\` 必须在 \`web/memory-store.js\` 里导出`);
        assert.ok(!new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${n}\\b`).test(index),
            `★\`${n}\` **不许**还在 \`web/index.js\` 里定义（那就是两份复制品）`);
    }
    // ★★本仓明令：**不搞 re-export**（leg71 立的规矩）——re-export 会让"它到底住哪"重新变模糊，
    //   而本棒的整个意义就是让归属变清楚。⇒ 两个文件都不许出现 `export { … } from '…'`。
    assert.deepEqual(reExports(read('web/index.js')), [],
        '★`web/index.js` 不许 re-export（消费者该改指向就改指向）');
    assert.deepEqual(reExports(read('web/memory-store.js')), [],
        '★`web/memory-store.js` 不许 re-export');

    // 反向自证（本仓 leg71 那条纪律）:**裸正则会被注释骗**——留痕注释里就写着这些符号名。
    const COMMENTED = '// export function memoryPushLine() {}';
    assert.ok(new RegExp('export\\s+(?:async\\s+)?function\\s+memoryPushLine\\b').test(COMMENTED),
        '★反向自证（第 1 半）：**裸正则**确实会命中注释里的那行 —— 这就是为什么必须剥注释');
    assert.ok(!new RegExp('export\\s+(?:async\\s+)?function\\s+memoryPushLine\\b').test(stripComments(COMMENTED)),
        '★反向自证（第 2 半）：剥注释之后不再命中（判据这才真的防得住）');
    assert.ok(stripComments(COMMENTED).trim() === '', '★剥离器自证：整行注释剥完什么都不剩');
    assert.ok(stripComments('const a = "// 不是注释";').includes('不是注释'),
        '★剥离器自证：字符串里的 `//` 不许被当注释剥掉');
});

test('★leg72 丙-web②：`web/index.js` 把**它还要用的**那批 import 回来（集合不多不少）', () => {
    const index = read('web/index.js');
    const got = importedFrom(index, /memory-store\.js$/);
    for (const n of BACK_TO_INDEX) {
        assert.ok(got.includes(n), `★\`web/index.js\` 必须从新模块 import \`${n}\``);
    }
    assert.deepEqual(got.slice().sort(), BACK_TO_INDEX.slice().sort(),
        '★取回集合 = 契约清单（不多不少）：多一个就是"顺手把别的东西也拖回来了"');
    // ★接线层从此**不再** import `src/memory-bridge.js`（那一族唯一的消费者是搬走的块）
    assert.ok(!/from\s*'\.\.\/src\/memory-bridge\.js'/.test(index),
        '★`web/index.js` 不该再 import `src/memory-bridge.js`（块外零消费者）');
});

// ─────────────────── ② ★★状态归属（本棒最该记住的一条） ───────────────────

test('★★★leg72 丙-web③：`sw2MemoryPush` **只有一个家**，接线层一律走受控通道', () => {
    const indexCode = stripComments(read('web/index.js'));
    const storeCode = stripComments(read('web/memory-store.js'));

    // ① 状态**只在**新模块里定义，且**恰好一处**（防"劈成两半"）
    assert.equal((storeCode.match(/^let\s+sw2MemoryPush\b/gm) || []).length, 1,
        '★`sw2MemoryPush` 在 `web/memory-store.js` 里必须**恰好一处**定义');
    assert.ok(!/\bsw2MemoryPush\b/.test(indexCode),
        '★★`web/index.js` 的**代码**里不许再出现 `sw2MemoryPush`（注释里可以留档；'
        + '★本棒 v1 就是漏看了块外的 4 处直接读写 ⇒ 当场 `ReferenceError: sw2MemoryPush is not defined`）');

    // ② 接线层里那 4 处引用**都改走了**受控通道（这是"状态只有一个家"的**可观察形状**）
    //    · `renderCfg` 注入自证面 → `readMemoryPush()`
    //    · 插件主开关"关掉即归零"两处 → `clearMemoryPush()`
    assert.match(indexCode, /memoryPush:\s*readMemoryPush\(\)/,
        '★`renderCfg` 必须走 `readMemoryPush()` 读那份自证面');
    assert.equal((indexCode.match(/clearMemoryPush\(\)/g) || []).length, 2,
        '★插件主开关的两处"归零"必须走 `clearMemoryPush()`（实为 2 处）');

    // ③ 反向自证：这条判据真的会咬 —— 拿一段"直接读写状态"的假源码喂给它，必须被认出来
    const FAKE_BAD = 'const x = sw2MemoryPush;\nif (!on) sw2MemoryPush = null;';
    assert.ok(/\bsw2MemoryPush\b/.test(stripComments(FAKE_BAD)),
        '★反向自证：块外直接读写的写法必须被这条口径认出来（否则它是假绿）');
});

// ─────────────────── ③ 方向单向 + 事件常量随迁 ───────────────────

test('★★leg72 丙-web④：新模块**不许反向 import** 接线层（单向 ⇒ 不可能成环）', () => {
    const store = read('web/memory-store.js');
    const back = [...store.matchAll(/from\s*'([^']*)'/g)].map((m) => m[1]);
    assert.ok(!back.some((p) => /index\.js$/.test(p)),
        '★`web/memory-store.js` 反向 import 了接线层 —— 那就是循环依赖');
    // ★它的依赖只有一条：`../src/memory-bridge.js`（引擎常量）。多一条都要问一句"为什么"。
    assert.deepEqual(back.slice().sort(), ['../src/memory-bridge.js'],
        '★新模块的 import 只许有 `../src/memory-bridge.js` 一条（叶子形态：只向下取引擎常量）');
    // ★`EVENTS_TABLE_NAME` 必须随块走（它原来**定义在块外、引用在块内** ⇒ 不搬就断线）
    assert.match(stripComments(store), /const\s+EVENTS_TABLE_NAME\s*=/,
        '★`EVENTS_TABLE_NAME` 必须随块搬来（它是块内唯一消费者）');
    assert.ok(!/\bEVENTS_TABLE_NAME\b/.test(stripComments(read('web/index.js'))),
        '★`web/index.js` 的代码里不该再有 `EVENTS_TABLE_NAME`');
});

// ─────────────────── ④ 接线层薄了（"搬走"必须真的发生） ───────────────────

test('★leg72 丙-web⑤：接线层**真的变薄**了（新模块存在、且旧家里那些族的实现体不在了）', () => {
    assert.ok(existsSync(new URL('../web/memory-store.js', import.meta.url)), '★新模块必须在盘上');
    const index = read('web/index.js');
    const store = read('web/memory-store.js');
    // 判"实现体在不在"用几个**只可能出现在实现里**的记号（不是符号名——符号名会出现在 import 行）
    for (const impl of ['Storage.loadState?.(fallback)', 'saveOrigin', 'VariableInjector?.createDefaultState?.(']) {
        assert.ok(!index.includes(impl), `★\`${impl}\` 是实现体记号，不该还留在接线层（说明没搬干净或留了副本）`);
        assert.ok(store.includes(impl), `★\`${impl}\` 必须在新模块里（否则是"搬丢了"）`);
    }
    // 规模判据（软性、只做兜底）：接线层必须真的短了 —— 搬走 271 行，留痕 ~9 行 ⇒ 至少少 200 行
    const indexLines = index.split('\n').length;
    assert.ok(indexLines < 3600, `★接线层行数 ${indexLines} —— 搬迁后应显著小于 3600（搬走 271 行、留痕 9 行）`);
});
