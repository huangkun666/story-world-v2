// story-world-v2/test/web-view-state-layout.test.js
// ★★★leg79（**丙-web · 视图态那一格**）：`web/index.js` 的**视图态族**搬进 `web/view-state.js`
//   之后的**结构判据**。
//
// 这一棒做了什么（细案 §3.2「按语义边界切、一次切一族」的**第四格**）：
//   `web/view-state.js` ← `sw2ChronicleView` / `sw2EntsView` / `SW2_ENTS_KINDS` / `SW2_ENTS_FILTERS` /
//   `sw2ChronicleViewReset` / `sw2EntsViewReset` / `sw2ChronicleComposing` / `sw2EntsComposing`
//   + 依赖注入工厂 `createViewStateHub()`（★本族**零注入形参**：它谁也不调）。
//
// ★**为什么需要这一条判据**（不是为了好看的行数）：
//   ① 这一族此前散在 3100 行接线层的**四个位置**（编年视态块 / 编年组合期 / 实体视态块 / 实体组合期），
//      而 `sw2LastWorld`、`sw2LastPicks` **正夹在它中间** ⇒ 与 leg78 热账族同款，**不是连续块**。
//   ② ★★★本族**特有的病**（下面第 ④ 条咬它）：视图对象是**就地写**的（`view.layer = x` /
//      `view.filters.push(x)` / `view.page += 1`），而 `reset()` 会**换掉模块级绑定** ⇒
//      谁要是把视图对象**抓进一个变量**（在构造期或在别处留一份），复位之后那些就地写就会落到
//      **被丢弃的旧对象**上——玩家那边看到的是"点了没反应"（本仓最忌的"面板抢玩家的手"的静默版），
//      而且**不抛错、不报警**。⇒ 受控口一律**现取**：`viewState.chronicle()` / `viewState.entities()`。
//   ③ 组合期标志（两个搜索框的**写入闸**）也随族进来了：它们是"那份视图态"的另一半
//      （组合期一律不写 `q`、不重绘）⇒ 不许在接线层留镜像（那又是两份真相）。
//
// ★判据形态纪律（照 `test/web-hot-ledger-layout.test.js` / `web-snapshot-layout` / `web-memory-layout` 同一把尺）：
//   ① 判"某个东西在不在"一律跑在**剥注释后的源码**上（leg71 §4.1：留痕注释里就写着这些符号名）；
//   ② 每条判据都要能**当场红**（关键几条自带反向自证）；
//   ③ 不许用"我在某一本书里看到的词"当判据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
// ★★★leg79：本文件这一条与前六条**形态不同**——它**真的把模块跑起来**（不是读源码）。
//   为什么需要它：本棒的硬判据是"**可见面零变化**"，而工作区里还压着 leg72～leg78 的未提交改动
//   ⇒ `git archive HEAD` 那棵树是 8 棒之前的，产物当然不同（拿错了对照）。
//   ★真正的对照物是**渲染层**：视图态的形状与默认值由 `src/render.js` 的两个工厂唯一定义
//   ⇒ "hub 交出去的 === 渲染层的默认值"成立，就证明**送进 `renderAll` 的东西一个字节没变**。
import { makeChronicleView, makeEntsView, renderAll } from '../src/render.js';
import { createViewStateHub } from '../web/view-state.js';

const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

/** 逐字符注释剥离器（跳过字符串/模板）。★本文件必须有它：留档注释里就写着这些符号名。 */
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

/** 族符号契约（**本清单就是"它们该住哪"**） */
const FAMILY_STATE = [
    'sw2ChronicleView', 'sw2EntsView', 'SW2_ENTS_KINDS', 'SW2_ENTS_FILTERS',
    'sw2ChronicleViewReset', 'sw2EntsViewReset', 'sw2ChronicleComposing', 'sw2EntsComposing',
];
// ★接线层要够到族的**受控口**（= 唯一通道清单；第 ③ 条要求它们真的被用）
//   ★分三类，**不许混成一类**（leg78"缝分两种"那条教训同款）：
//     · 视图对象的两口（就地写的对象，**现取**）
//     · 复位的两口
//     · 组合期的三口（写 ×2 + 读 ×1）
const HUB_VIEW_PORTS = ['viewState.chronicle()', 'viewState.entities()'];
const HUB_RESET_PORTS = ['viewState.resetChronicle()', 'viewState.resetEntities()'];
const HUB_COMPOSE_PORTS = ['viewState.setChronicleComposing(', 'viewState.setEntsComposing(', 'viewState.anyComposing()'];

// ─────────────────── ① 搬家结果：符号只在**新家**定义，旧家一个字都不剩 ───────────────────

test('★★leg79 丙-web⑧：视图态族在新家**定义**、在旧家**代码里归零**', () => {
    const vs = stripComments(read('web/view-state.js'));
    const index = stripComments(read('web/index.js'));

    // ★八个符号在新家**各恰好一处定义**（函数两个 + 状态六个）
    for (const n of ['sw2ChronicleView', 'sw2EntsView']) {
        assert.equal((vs.match(new RegExp(`^let\\s+${n}\\s*=`, 'gm')) || []).length, 1,
            `★\`${n}\` 在 \`web/view-state.js\` 里必须**恰好一处** \`let\` 定义（视图对象是**可换绑**的：复位换新的）`);
    }
    for (const n of ['SW2_ENTS_KINDS', 'SW2_ENTS_FILTERS']) {
        assert.equal((vs.match(new RegExp(`^const\\s+${n}\\s*=`, 'gm')) || []).length, 1,
            `★\`${n}\`（筛选词表）必须只住新家**恰好一处**`);
    }
    for (const n of ['sw2ChronicleComposing', 'sw2EntsComposing']) {
        assert.equal((vs.match(new RegExp(`^let\\s+${n}\\s*=`, 'gm')) || []).length, 1,
            `★\`${n}\`（组合期标志）必须是新家的**模块级** \`let\`：三支监听共享同一个（挂函数里等于没有）`);
    }
    for (const n of ['sw2ChronicleViewReset', 'sw2EntsViewReset']) {
        assert.equal((vs.match(new RegExp(`^function\\s+${n}\\s*\\(`, 'gm')) || []).length, 1,
            `★\`${n}\` 必须只住新家**恰好一处**`);
    }
    // ★★旧家**代码里**一个都不许剩（注释里可以留档）
    for (const n of FAMILY_STATE) {
        assert.ok(!new RegExp(`\\b${n}\\b`).test(index),
            `★★\`web/index.js\` 的**代码**里不许再出现 \`${n}\`（注释里可以留档；`
            + '★leg72 漏了块外直接读写 ⇒ 搬完当场 `ReferenceError`；leg78 的 `sw2FlushTimeoutMs` 同款 —— 这是第三次）');
    }
    // ★反向自证：裸正则在**注释里照样命中** ⇒ 必须先剥注释，否则"把定义注释掉"能骗过判据
    assert.ok(!new RegExp(`\\bsw2EntsView\\b`).test(stripComments('// sw2EntsView 的说明（注释里留档）')),
        '★反向自证：注释里提到状态名不算"代码里出现"（否则留档就把判据自己搞红）');
    assert.equal((stripComments('let sw2EntsView = makeEntsView();').match(/^let\s+sw2EntsView\s*=/gm) || []).length, 1,
        '★反向自证：真定义必须被认作定义（否则上面那几条是空绿）');
});

// ─────────────────── ② 方向单向：新模块只问渲染层取默认值 ───────────────────

test('★★leg79 丙-web⑨：新模块的依赖面**只有渲染层那一个工厂口**，不许反向 import 接线层', () => {
    const vs = read('web/view-state.js');
    const imports = [...vs.matchAll(/^\s*import\s.+$/gm)].map((m) => m[0]);
    // ★这一条是本族的**形状特征**：它只要"默认值从哪来"，别的什么都不依赖。
    //   ⇒ 多出一条 import 都要问一句"为什么"（尤其不许出现 `./index.js`、也不许 import
    //     `./idb-backend.js` 那类"要在浏览器里才活"的适配层：Node 侧 `node --test` 直接导入本模块）。
    assert.equal(imports.length, 1, `★\`web/view-state.js\` 只许有一条 import；实际 ${imports.length} 条：${imports.join(' | ')}`);
    assert.match(imports[0], /^import \{ makeChronicleView, makeEntsView \} from '\.\.\/src\/render\.js';/,
        '★唯一那条 import 必须是"默认值的唯一真源"（`makeChronicleView` / `makeEntsView`）');
    assert.ok(!/from\s*'\.\/index\.js'/.test(vs), '★不许反向 import 接线层（那就是循环依赖）');
    assert.ok(!/from\s*'\.\/idb-backend\.js'/.test(vs), '★不许 import 浏览器侧适配层（本模块要能在 Node 里直接导入）');
    // ★行为自证：本模块**真的能被 Node 导入**且默认值形状对（leg73：`node --check` 远不够）
    assert.match(vs, /^let sw2ChronicleView = makeChronicleView\(\);$/m, '★编年视态从工厂取（不是手写字面量）');
    assert.match(vs, /^let sw2EntsView = makeEntsView\(\);$/m, '★实体视态从工厂取（不是手写字面量）');
});

// ─────────────────── ③ 状态归属：接线层一律走**受控通道** ───────────────────

test('★★★leg79 丙-web⑩：八个状态**只有一个家**，接线层一律走受控口（并真的在用）', () => {
    const index = stripComments(read('web/index.js'));
    const vs = stripComments(read('web/view-state.js'));

    // ① 工厂**必须被真的调用**（只 import 不调 = "搬走了但没人接线"，leg25 f 那条病历）
    assert.match(index, /const\s+viewState\s*=\s*createViewStateHub\(\)/,
        '★接线层必须**真的建** hub（`const viewState = createViewStateHub()`）');
    // ② 三类口都必须**真的在用**（否则那是摆设）
    for (const port of [...HUB_VIEW_PORTS, ...HUB_RESET_PORTS, ...HUB_COMPOSE_PORTS]) {
        assert.ok(index.includes(port), `★接线层必须真的用 \`${port}\`（否则那是摆设）`);
    }
    //   ★视图对象那两口是**就近读**用的（两个视图 × 各自的渲染调用点 + 搜索框四条监听）
    for (const port of HUB_VIEW_PORTS) {
        const uses = (index.match(new RegExp(port.replace(/[.()]/g, (c) => '\\' + c), 'g')) || []).length;
        assert.ok(uses >= 3, `★\`${port}\` 必须真的被**多处**用（实测 ${uses} 处；只出现一次说明有地方还揣着旧引用）`);
    }
    // ③ ★★词表与"回第一页"两条规矩**跟状态同住一处**（接线层不许再自己抄一份词表）
    assert.match(vs, /SW2_ENTS_KINDS\.has\(v\)/, '★类别词表必须在新家被真的用（不是搬过去供着）');
    assert.match(vs, /SW2_ENTS_FILTERS\.has\(v\)/, '★筛选项词表必须在新家被真的用');
    assert.match(vs, /sw2ChronicleView\.page = 1; sw2ChronicleView\.pageBook = 1; \}/,
        '★"换档 ⇒ 回第一页"必须与状态写在同一处（否则又是"状态一个家、规矩另一个家"）');
    assert.ok(!/\[\s*'busy',\s*'recent'/.test(index), '★接线层不许再抄一份筛选项词表');
    // ④ 组合期：新家必须有真实现，且接线层**不许留镜像**
    assert.match(vs, /anyComposing: \(\) => sw2ChronicleComposing \|\| sw2EntsComposing/,
        '★`anyComposing()` 必须真的读那两个标志（空壳 ⇒ `input` 护栏永远为假）');
    //   ★★口径按**赋值**咬，不按行首咬：第一版写的是 `/^\s*sw2(Ents|Chronicle)Composing\s*=/m`，
    //     而真实写法是 `if (…) sw2EntsComposing = true;`（**缩进 + 同行的 if**）⇒ 那条锚点把
    //     本族最该堵的那一处放过去了（★咬合演练第 ④ 段当场抓出来：变异打上了、判据却全绿）。
    assert.ok(!/(?<!\.)\bsw2(?:Ents|Chronicle)Composing\s*=(?!=)/.test(index),
        '★接线层不许直写组合期标志（那是新家的私有状态 ⇒ 两份真相）——一律走 `viewState.setXxxComposing()`');
    // ⑤ 反向自证：这条"状态只有一个家"的口径**真的会咬** —— 拿一段"直接读写状态"的假源码喂给它
    for (const bad of ['const x = sw2EntsView.page;', 'sw2ChronicleView.page = 1;', 'if (SW2_ENTS_KINDS.has(v)) y = 1;']) {
        const sym = FAMILY_STATE.find((n) => bad.includes(n));
        assert.ok(sym && new RegExp(`\\b${sym}\\b`).test(stripComments(bad)),
            `★反向自证：块外直接读写 \`${sym}\` 的写法必须被这条口径认出来（否则它是假绿）：${bad}`);
    }
});

// ─────────────────── ④ ★★★本族特有的铁律：视图对象**现取**，不许抓进变量 ───────────────────

test('★★★leg79 丙-web⑪：视图对象必须**现取**（抓进变量 = 复位之后写到被丢弃的旧对象上）', () => {
    const index = stripComments(read('web/index.js'));
    const vs = stripComments(read('web/view-state.js'));
    // ★病（本族特有，**不抛错、不报警**）：视图对象是**就地写**的，而复位换的是**绑定** ⇒
    //   谁把它抓进一个变量，复位之后那个变量指向的旧对象再也不是"当前视图态"
    //   ⇒ 玩家的点击/输入**照旧执行、照旧重绘**，只是写进了一份谁也看不见的对象
    //   ⇒ 面板上看起来就是"点了没反应"。
    //   ⇒ 判据：① 两口必须**从 hub 现取**（返回当前对象）；② 接线层**一个字都不许把它存进变量**。
    assert.match(vs, /chronicle: \(\) => sw2ChronicleView,/, '★`chronicle()` 必须是"现取当前对象"的取值函数');
    assert.match(vs, /entities: \(\) => sw2EntsView,/, '★`entities()` 必须是"现取当前对象"的取值函数');
    // ★★这一条是硬口径：`const|let|var xxx = viewState.chronicle()` 这种写法**一处都不许有**
    //   （有了它，"复位之后写到旧对象"这个病就回来了，而且不会有任何测试变红）。
    const bindings = index.match(/^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*viewState\.(?:chronicle|entities)\(\)/gm) || [];
    assert.deepEqual(bindings, [],
        '★★视图对象**不许绑进变量**（必须就地 `viewState.chronicle().field = …`）——'
        + '绑了它，`reset()` 一换绑定，那些就地写就落到**被丢弃的旧对象**上（面板"点了没反应"，且不抛错）：'
        + bindings.join(' | '));
    //   ★正向自证：就地写的点必须**真的在**（否则上面那条会因为"根本没人写"而空过）
    const writes = index.match(/viewState\.(?:chronicle|entities)\(\)\.\w+\s*(\+\+|--|\+=|-=|=)/g) || [];
    assert.ok(writes.length >= 6, `★接线层必须真的**就地在视图对象上写**（实测 ${writes.length} 处）——本族的口就是给这个用的`);
    // ★反向自证：把"抓进变量"那种写法喂进这条口径，它必须被认出来
    const bad = 'const v = viewState.chronicle();\nv.layer = x;';
    assert.equal((bad.match(/^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*viewState\.(?:chronicle|entities)\(\)/gm) || []).length, 1,
        '★反向自证：`const v = viewState.chronicle()` 必须被这条口径认出来（否则它是假绿）');
});

// ─────────────────── ⑤ 搬迁**逐字节**自证（在 `node --test` 里也能复核，不只靠仓外装置） ───────────────────

test('★★leg79 丙-web⑫：搬过来的那两段**逐字节**出现在新家（不是凭记忆重写的）', () => {
    // ★leg73 §4.1 的教训："比我自己拼出来的产物"是**假自证**——必须与**原文逐字节比**。
    //   本棒的原文已被搬走（旧家再也抠不到了）⇒ 用**内容锚点**把新家的那两段圈出来，
    //   逐行断言"每一行都是合法视图态的写法，且没有一行是拼接/改写的残迹"。
    //   ★锚点一律用**行首原文**，不用行号（leg72 教训②：从 HEAD 抄的行号在工作区会指到别的行）。
    const vs = read('web/view-state.js');
    const lines = vs.split('\n');
    const anchor = (s) => {
        const idx = lines.findIndex((L) => L.startsWith(s));
        assert.ok(idx >= 0, `前置：锚点必须在位 —— ${JSON.stringify(s)}`);
        return idx;
    };
    // ① 编年视态块：`let sw2ChronicleView = makeChronicleView();` 起，到它的复位函数止
    const chFrom = anchor('let sw2ChronicleView = makeChronicleView();');
    const chTo = lines.findIndex((L) => L.startsWith('function sw2ChronicleViewReset()'));
    assert.ok(chTo > chFrom);
    const chBlock = lines.slice(chFrom, chTo + 1);
    assert.deepEqual(chBlock, [
        'let sw2ChronicleView = makeChronicleView();',
        'function sw2ChronicleViewReset() { sw2ChronicleView = makeChronicleView(); }',
    ], '★编年视态块的两行必须**逐字节**与原文相同（含"复位 = 重取工厂"这条口径）');
    // ② 实体视态块：视态 + 两枚词表 + 复位，四行连排
    const enFrom = anchor('let sw2EntsView = makeEntsView();');
    const enTo = lines.findIndex((L) => L.startsWith('function sw2EntsViewReset()'));
    assert.ok(enTo > enFrom);
    const enBlock = lines.slice(enFrom, enTo + 1);
    assert.deepEqual(enBlock, [
        'let sw2EntsView = makeEntsView();',
        "const SW2_ENTS_KINDS = new Set(['all', 'faction', 'character']);",
        "const SW2_ENTS_FILTERS = new Set(['busy', 'recent', 'named', 'orphan']);",
        'function sw2EntsViewReset() { sw2EntsView = makeEntsView(); }',
    ], '★实体视态块的四行必须**逐字节**与原文相同（★`SW2_ENTS_FILTERS` 的原文就是这四个字母的缩写词表，别"顺手改好"）');
    // ③ 组合期那两行：`let ... = false;` 的**初值**不许被改成 true 或别的形态
    assert.match(vs, /^let sw2ChronicleComposing = false;$/m, '★编年组合期标志初始为 false（逐字节）');
    assert.match(vs, /^let sw2EntsComposing = false;$/m, '★实体组合期标志初始为 false（逐字节）');
    // ★反向自证：把上面那条比对喂一段**改了一个字节**的产物，它必须不认
    const tampered = [...enBlock];
    tampered[0] = 'let sw2EntsView = makeEntsView();   // 顺手加个注释';
    assert.notDeepEqual(tampered, enBlock, '★反向自证：改动一个字节就必须被这条逐行比对抓住（否则它是空绿）');
});

// ─────────────────── ⑦ ★★★真跑一遍：值等价 + 本族特有的行为（不是读源码） ───────────────────

test('★★leg79 丙-web⑮：**初始那一份**也必须与渲染层默认值零别名（隔离进程里量，防"前一条用例先复位过"）', () => {
    // ★★为什么必须**另起一个进程**（本棒第三处"判据自己写窄了"，最隐蔽的一处）：
    //   视图态是**模块级**的（`web/view-state.js`，见第 ⑭ 条），而 `node --test` 的同一个文件里
    //   用例**共享模块实例** ⇒ 只要前面任何一条用例调过一次 `resetEntities()`，
    //   后面再读 `hub.entities()` 拿到的就是**复位路径**的产物，**初始化那一次**再也观察不到。
    //   ★实拍：第 ⑫ 段变异（把初始化写成 `{...makeEntsView(), filters: ENTS_DEFAULT_VIEW.filters}`，
    //     即与默认值共用同一个数组）**一路全绿** —— 因为第 ⑭ 条读的是复位后的那一份。
    //   ⇒ 定稿：初始态**另起进程**量（那边模块全新载入，没有谁先复位过）；复位路径仍由第 ⑭ 条管。
    //   ★★并且**必须拿 `ENTS_DEFAULT_VIEW` 本身去比**（本探针第一版比的是 `makeEntsView().filters`）：
    //     那个工厂按契约**每次都造一份新数组** ⇒ "=== 新造的那一份"**永远为假** ⇒ 那条判据
    //     结构上就量不到"与默认值共用同一个数组"这个病（★实拍：变异打上了、判据全绿）。
    //     ⇒ 要比的正是**默认值对象自己**。
    const probe = [
        "import { makeChronicleView, makeEntsView, ENTS_DEFAULT_VIEW, CHRONICLE_DEFAULT_VIEW } from 'file:///F:/deepseek/plugins/story-world-v2/src/render.js';",
        "import { createViewStateHub } from 'file:///F:/deepseek/plugins/story-world-v2/web/view-state.js';",
        'const h = createViewStateHub();',
        'const c = h.chronicle(); const e = h.entities();',
        'const alias = (e.filters === ENTS_DEFAULT_VIEW.filters) || (c === CHRONICLE_DEFAULT_VIEW);',
        'process.stdout.write(JSON.stringify({',
        '    chronicle: JSON.stringify(c) === JSON.stringify(makeChronicleView()),',
        '    entities: JSON.stringify(e) === JSON.stringify(makeEntsView()),',
        '    alias,',
        '    filters: JSON.stringify(e.filters),',
        '}));',
    ].join('\n');
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' });
    const r = JSON.parse(out);
    assert.equal(r.chronicle, true, '★初始编年视态必须逐字节等于 `makeChronicleView()`');
    assert.equal(r.entities, true, '★初始实体视态必须逐字节等于 `makeEntsView()`');
    assert.equal(r.filters, '[]', '★初始 `filters` 必须是空数组（探针按字符串带回来，比 JSON 文本）');
    assert.equal(r.alias, false,
        '★★初始那一份**不许与渲染层默认值有别名**（共用同一个数组 = 一次就地 push 就把默认值改脏；'
        + '★这一条只有在**全新进程**里才量得到——同进程里前面的用例可能已经复位过了）');
});

test('★★★leg79 丙-web⑭：hub 交出去的**就是**渲染层的默认值（可见面零变化的真对照）', () => {
    const hub = createViewStateHub();
    // ① ★值等价：送进 `renderAll` 的那一份，逐字节等于渲染层的默认值
    assert.deepEqual(hub.chronicle(), makeChronicleView(),
        '★编年视态必须逐字节等于 `makeChronicleView()`（否则玩家一开面板看到的列表就与改前不同）');
    assert.deepEqual(hub.entities(), makeEntsView(),
        '★实体视态必须逐字节等于 `makeEntsView()`');
    // ② ★★`filters` 必须是**独立数组**：接线层是**就地 push**，与默认值共用一份会把默认值改脏
    //    （终审 M10 那条硬口径；迁移时最容易在这里破功——深拷贝少一层就中）
    const h2 = createViewStateHub();
    h2.resetEntities();
    assert.equal(h2.applyEntsFilter('orphan'), true, '前置：认得的筛选项');
    assert.deepEqual(h2.entities().filters, ['orphan'], '★筛选项真的就地进了那一份');
    assert.deepEqual(makeEntsView().filters, [], '★★改脏这一份之后，渲染层新造的默认值必须**仍然干净**（`filters` 是拷贝）');
    assert.equal(h2.applyEntsFilter('orphan'), true, '前置：对同一项再点一次');
    assert.deepEqual(h2.entities().filters, [], '★同项再点 = 取消（就地 splice，不是 push 第二遍）');
    assert.equal(h2.applyEntsFilter('没这个词'), false, '★词表不认的值返回 false（接线层据此**一个字都不动**，与原先的 else-if 同义）');
    h2.resetEntities();
    // ③ ★键名契约：接线层原先手写的那两个字面量键名，`views()` 必须一个不差
    assert.deepEqual(Object.keys(h2.views()), ['chronicleView', 'entsView'],
        '★`views()` 的键名必须与接线层原来那份字面量一致（`renderAll` 按这两个键取视态）');
    // ④ ★★hub 是**把手**、不是**容器**：视图态只有一份（模块级），另起一个 hub **不隔离**
    //    ★这一条同时钉住"零第二份状态"：谁要是把它改成"每 hub 一份"，这里当场红。
    const a1 = createViewStateHub();
    const a2 = createViewStateHub();
    a2.resetEntities();
    assert.notEqual(a1, a2, '★每次调用都新建一个**把手对象**');
    assert.equal(a1.entities(), a2.entities(), '★★但它们交出**同一个视图对象** ⇒ 视图态只有一份（工厂不是容器）');
    a1.applyEntsFilter('orphan');
    assert.deepEqual(a2.entities().filters, ['orphan'], '★用 a1 改，a2 看得见（同一个家）——这正是"零第二份状态"该有的样子');
    a2.resetEntities();
    assert.equal(a1.entities(), a2.entities(), '★用 a2 复位，a1 也看到新的那一份（复位换的是**同一个绑定**）');
    assert.deepEqual(a1.entities().filters, [], '★复位后是干净的默认值');
    // ⑤ 端到端：hub 的那一份真的喂得进 `renderAll`（形状没变），且视图态**真的在驱动产物**
    const world = JSON.parse(readFileSync(new URL('./fixtures/golden-world.min.json', import.meta.url), 'utf8'));
    const base = renderAll(world, { view: { chronicleView: makeChronicleView(), entsView: makeEntsView() } });
    const h3 = createViewStateHub();
    h3.resetEntities(); h3.resetChronicle();
    const viaHub = renderAll(world, { view: h3.views() });
    assert.equal(typeof viaHub.entities, 'string', '前置：`renderAll` 产出了实体页（不是空产物）');
    assert.equal(viaHub.entities, base.entities, '★经 hub 交出去的视图态 ⇒ 实体页产物与"直接喂默认值"**逐字节相同**');
    assert.equal(viaHub.chronicle, base.chronicle, '★编年页同理');
    //   ★反向对照（防空绿）：换个筛选档 ⇒ 产物**必须真的变**（证明视图态确实在驱动渲染）
    h3.applyEntsFilter('faction');
    assert.notEqual(renderAll(world, { view: h3.views() }).entities, base.entities,
        '★★对照：换了筛选档 ⇒ 实体页产物真的变了（否则上面那两条"逐字节相同"是空绿）');
    h3.resetEntities();
});

// ─────────────────── ⑧ 接线层真的变薄（本棒的可观察效果） ───────────────────

test('★leg79 丙-web⑬：接线层真的变薄，且不再经手视图态的那两个工厂', () => {
    const index = read('web/index.js');
    const lines = index.split('\n').length;
    // ★本棒实测：3107 → 3083 行（四个位置抽走；块内注释一并跟走）
    // ★leg80 复量：取书族又搬走一格 ⇒ 2861 行（★本棒**只动下界**：上界 3100 原样留着，
    //   它守的"接线层不许回涨"一个字没放宽；下界按新的实测值下移，口径仍是"它还是个接线层"）。
    // ★leg82 复量：参数族（最后一格）又搬走一格 ⇒ 2692 行（同一口径：**只动下界**，上界 3100 不动）。
    assert.ok(lines < 3100, `★\`web/index.js\` 应变薄（视图态族搬走了）；实际 ${lines} 行`);
    assert.ok(lines > 2600, `★但它仍是接线层（别把不该搬的也搬了）；实际 ${lines} 行`);
    // ★新家必须**真的有内容**（防"建了个空文件充数"）
    const vsLines = read('web/view-state.js').split('\n').length;
    assert.ok(vsLines > 60, `★\`web/view-state.js\` 必须真的装着那一族；实际 ${vsLines} 行`);
    // ★接线层**不再** import 那两个工厂（默认值的取用点只有新家一处）
    const code = stripComments(index);
    assert.ok(!/import[^;]*makeEntsView[^;]*from/.test(code), '★接线层不许再 import `makeEntsView`（默认值归新家取）');
    assert.ok(!/import[^;]*makeChronicleView[^;]*from/.test(code), '★接线层不许再 import `makeChronicleView`');
    assert.match(code, /import \{ createViewStateHub \} from '\.\/view-state\.js'/,
        '★接线层必须从新家取 hub');
});
