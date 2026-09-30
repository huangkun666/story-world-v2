// story-world-v2/test/settle-order.test.js
// ★★★leg68（乙-1 · 细案 `docs/plan-structure-optimization.md` §3.1 的"轻案"）：
//   **把"顺序承担语义"这件事显式化**——`settleTick` 的顺序表 + 锁住"表里的顺序 = 代码里的调用顺序"。
//
// 这一棒治的病（细案 §1.2，本棒实读复核）：
//   `settleTick`（`src/settle.js:894→1033`）是一条 **139 行就地改 `world`** 的顺序过程，
//   **步骤先后本身在承担语义**，而"为什么必须在这个位置"原先只散在沿途注释里。
//   真账证据（leg66 W2f）：`applyEntityUpdates` 里那句复核**注释自称"防御"**，实际是**承重的**——
//   契约层说"因必须还没了结"，而"真正生效的位置"由它排在 `closeEvents` **之后**这件事决定
//   ⇒ 曾把一条**刚放行的合法变更**吞掉（真账 `meta.entityFields['e_bk_297']` 零留痕）。
//   ⇒ 判据：**凡是"顺序承担语义"的地方，必须有一个地方把那个顺序写下来并锁住。**
//
// ★本文件的锁形（三条，缺一不可）：
//   ① **表序 ⊆ 源码序**（子序列口径）：允许往管线里**插**新步，但**改序 / 删步 / 换函数**当场红
//      —— 这是这条锁的**唯一目的**；"表里没有的调用"照样是管线的一部分（表只回答"为什么在这个位置"）。
//   ② **无陈旧条目**：表里每个 `call` 必须真的出现在 `settleTick` 函数体里 ——
//      防"函数被改名/搬走、而表里留一条僵尸"让锁变成假绿。
//   ③ **`args` 有效性 + 前缀相等**：`args` 必须**恰好等于**那次调用实参头部（字面量或标识符，不嵌套）
//      —— 防"表里的名字在别处也出现"时锁**对错地方**（`closeEvents` 在 `:995` 调用、在 `:991` 注释里被提到；
//      `normalizeSameStepEventRefs` 真的**调用了两次**，两次位置**都承担语义**，故是两行）。
//      ★这一条是锁的**软肋**：`args` 写错 ⇒ 锁去匹配别的地方。故 `args` 一空即红，且锁不住就报错、不静默跳过。
//
// ★本文件的判据形态纪律（照 leg61/leg64/leg67 的同一把尺）：**不抄任何真账原话**——
//   下面用到的 `gstep` / `closedIds` / `tick` / `warnings` 全是**参数名**，与"哪本书"无关。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SETTLE_ORDER, SETTLE_STAGES } from '../src/settle.js';

const ROOT = new URL('..', import.meta.url);

// ───────── 源码抽取（一次，供三条锁共用） ─────────
const SOURCE = readFileSync(new URL('src/settle.js', ROOT), 'utf8');
const LINES = SOURCE.split('\n');

/** 抽出 `settleTick` 的函数体（按花括号深度找配对的收尾 `}`）。找不到 ⇒ 直接抛，不静默返回空。 */
function bodyOf(name) {
    const head = LINES.findIndex((l) => l.startsWith(`export function ${name}(`));
    if (head < 0) throw new Error(`锁失效：src/settle.js 里找不到 export function ${name}( —— 函数被改名或搬走了？`);
    let depth = 0;
    let started = false;
    for (let i = head; i < LINES.length; i += 1) {
        for (const ch of LINES[i]) {
            if (ch === '{') { depth += 1; started = true; }
            else if (ch === '}') depth -= 1;
        }
        if (started && depth === 0) return LINES.slice(head, i + 1).join('\n');
    }
    throw new Error(`锁失效：${name} 的函数体花括号不配对 —— 抽取失败，不许当"通过"。`);
}

/** 行内的**真调用**：`名字(`，排除注释里的提及、以及 if/for/return 这类关键字。
 *  ★leg84（乙-2）修一处**既有缺陷**：正则里的 `export\s+` 分支会把
 *    `export function foo(a, b) {` **整行当成一次调用 `foo(a, b)`**。
 *    它一直没发作，是因为被抽的 `settleTick` 是文件里唯一不带 `export` 的函数；
 *    乙-2 之后阶段函数**带 `export`** ⇒ 立刻在 SITES 里插进一串假条目（本棒当场踩到）。 */
const CALL = /^\s*(?:const\s+[\w$]+\s*=\s*|await\s+|return\s+|export\s+)?([A-Za-z_$][\w$]*)\s*\(/;
const NOT_A_CALL = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return',
    'Object', 'Array', 'String', 'Number', 'Math', 'JSON', 'Set', 'Map', 'require', 'new']);

/** 该行是不是**函数声明**（不是调用）——函数声明永远不算管线步骤。 */
const isDecl = (code) => /^\s*(?:export\s+)?(?:async\s+)?function\s/.test(code);

/** 该行这次调用的**实参头部**（只取字面量 / 标识符 / 成员访问，不嵌套括号 —— 简化到判据够用为止）。 */
function argsHeadOf(line) {
    const open = line.indexOf('(');
    if (open < 0) return null;
    let depth = 0;
    let end = -1;
    for (let i = open; i < line.length; i += 1) {
        if (line[i] === '(') depth += 1;
        else if (line[i] === ')') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) return null;                       // 跨行调用：本棒不解析（表里没有这种条目）
    const head = [];
    // 兜底表达式 `a || b` / `a ?? b` 与逗号一样当**分隔**：两侧各自记一个标识符
    // （`buildEvolutionPack(world, moveFact || null)` ⇒ `['world','moveFact','null']`）。
    // ★为什么不"整段跳过"：跳过会让这一格的 args 空掉 ⇒ 锁匹配不到那次调用、变成假红/假绿。
    const parts = line.slice(open + 1, end).split(/,|\|\||\?\?/);
    for (const raw of parts) {
        const tok = raw.trim();
        if (!tok) break;                            // 空实参 / 尾随逗号 ⇒ 到此为止
        if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(tok)) { head.push(tok); continue; }
        if (/^(['"`])[^'"`]*\1$/.test(tok)) { head.push(tok.slice(1, -1)); continue; }   // 字符串字面量取内容
        if (/^-?\d+(\.\d+)?$/.test(tok)) { head.push(tok); continue; }                    // 数字字面量
        break;                                      // 嵌套调用 / 其余表达式 ⇒ 停止累积（表里不登记这种）
    }
    return head;
}

/** 函数体里**按顺序**记下的每一次真调用：`{ call, args, line }`。
 *  ★leg84（乙-2）：现在改为按 `SETTLE_STAGES` 顺序**逐阶段**调用它（见下面的 `SITES`）——
 *    函数保留，是因为"怎么从一个函数体里抽出调用点"这件事**没有变**，变的只是扫描面有几个函数体。 */
function callSitesOf(name) {
    const body = bodyOf(name).split('\n');
    const sites = [];
    body.forEach((raw, i) => {
        const code = raw.replace(/\/\/.*$/, '');     // 去行尾注释，免得注释里的 `foo(` 被当调用
        if (isDecl(code)) return;                    // ★函数声明不是调用（见 CALL 上面的注释）
        const m = code.match(CALL);
        if (!m || NOT_A_CALL.has(m[1])) return;
        sites.push({ call: m[1], args: argsHeadOf(code), line: i + 1 });
    });
    return sites;
}

// ★★★leg84（乙-2）**抽取面升级**：`settleTick` 已从 139 行顺序过程收成**薄驱动**，
//   那 24 步住在 8 个**显式阶段**里 ⇒ 本源码序锁的**扫描面**从"`settleTick` 一个函数体"
//   改成"**按 `SETTLE_STAGES` 顺序拼接的 8 个阶段体**"。
//   ★这是**升级、不是放宽**：口径逐条不变（表序 ⊆ 源码序 / 无僵尸 / args 强锚），
//     而"阶段数组本身是不是真的驱动了这 8 个函数、顺序对不对"另由第 ⑥ 格单独咬。
//   ★为什么不是"把 8 个阶段扫全、不管顺序"：那样**阶段函数在文件里的排列**就不再被约束，
//     "源码序 = 执行序"这条**可读性**保证会悄悄失效（而它正是 leg68 那一棒要的东西）。
const SITES = (() => {
    const sites = [];
    for (const stage of SETTLE_STAGES) {
        // ★复用同一个抽取器（本仓"同一口径不许两处实现"）：只把 `line` 重编成"跨阶段的全局次序号"
        for (const s of callSitesOf(stage.name)) sites.push({ ...s, line: sites.length + 1 });
    }
    return sites;
})();

/** 把表里的一行钉到源码里**真的那一次**调用上：名字相同**且**实参头部逐项相等。 */
function pinIndex(sites, entry) {
    return sites.findIndex((s) => s.call === entry.call
        && Array.isArray(s.args)
        && s.args.length >= entry.args.length
        && entry.args.every((a, k) => s.args[k] === a));
}

// ═══════════════ ① 表序 ⊆ 源码序（子序列口径；改序/删步/换函数当场红） ═══════════════
test('settle-1：SETTLE_ORDER 的记录顺序 = settleTick 源码里的调用顺序（子序列：允许插入，不许重排）', () => {
    assert.ok(SETTLE_ORDER.length >= 20, `表太短（${SETTLE_ORDER.length} 条）—— 顺序表塌了？`);
    const pinned = [];
    for (const entry of SETTLE_ORDER) {
        const at = pinIndex(SITES, entry);
        assert.ok(at >= 0, `表里的步骤「${entry.call}(${entry.args.join(', ')})」在 settleTick 里找不到**这一次**调用`
            + ` —— 要么函数被改名/搬走，要么 args 写错了（锁会指向别处）。`);
        pinned.push({ entry, at });
    }
    for (let i = 1; i < pinned.length; i += 1) {
        const prev = pinned[i - 1];
        const cur = pinned[i];
        assert.ok(prev.at < cur.at,
            `★顺序被改了：「${prev.entry.call}」与「${cur.entry.call}」在源码里的先后与表不一致`
            + `（表说 ${prev.entry.call} 在前，代码里它在第 ${prev.at + 1} 次调用、`
            + `${cur.entry.call} 在第 ${cur.at + 1} 次）——`
            + ` 若这是有意的，先改 SETTLE_ORDER 的 why 并说明不变量，再改代码。`);
    }
});

// ═══════════════ ② 无陈旧条目（防"函数搬走了、表里留僵尸"让锁假绿） ═══════════════
test('settle-2：表里每个步骤都真的住在 settleTick 里（无僵尸条目）；且 args 键一条不落', () => {
    const names = new Set(SITES.map((s) => s.call));
    for (const entry of SETTLE_ORDER) {
        assert.ok(names.has(entry.call), `僵尸条目：「${entry.call}」已不在 settleTick 的调用里（被改名/搬走了？）`);
    }
    // 两张表都必须带 args —— 缺 args 的条目会让 ② 空匹配，是锁的软肋
    for (const e of SETTLE_ORDER) {
        assert.ok(Object.hasOwn(e, 'args') && Array.isArray(e.args),
            `「${e.call}」缺 args（或不是数组）—— 没有 args 就钉不住"那一次"调用。`);
    }
});

// ═══════════════ ③ args 是**强**锚（前缀相等）：防锁匹配到"别的地方" ═══════════════
test('settle-3：每个步骤的 args **恰好等于**那次调用实参的头部（是强锚，不是弱串）', () => {
    for (const entry of SETTLE_ORDER) {
        const at = pinIndex(SITES, entry);
        assert.ok(at >= 0, `「${entry.call}(${entry.args.join(', ')})」钉不住：实参头部对不上任何一次调用。`);
        const real = SITES[at].args;
        assert.ok(real.length === entry.args.length,
            `「${entry.call}」的 args 长度对不上：表里 ${entry.args.length} 项 ${JSON.stringify(entry.args)}、`
            + `代码里那次是 ${real.length} 项 ${JSON.stringify(real)} —— 表与代码必须逐项相等（前缀不算）。`);
    }
});

// ═══════════════ ④ 表的形状：可读、且"为什么"不空 ═══════════════
test('settle-4：SETTLE_ORDER 冻结、字段齐备，且 why 说得出"为什么在这个位置"', () => {
    assert.ok(Object.isFrozen(SETTLE_ORDER), 'SETTLE_ORDER 必须冻结 —— 顺序表是可被随手 push 的东西，冻上才算"写下来"了。');
    const seen = new Set();
    for (const e of SETTLE_ORDER) {
        assert.ok(typeof e.call === 'string' && /^[A-Za-z_$][\w$]*$/.test(e.call), `非法步骤名：${JSON.stringify(e.call)}`);
        assert.ok(Array.isArray(e.args), `「${e.call}」的 args 必须是数组`);
        for (const a of e.args) assert.ok(typeof a === 'string' && a.length > 0, `「${e.call}」的 args 里有空项`);
        assert.ok(typeof e.why === 'string' && e.why.trim().length >= 8,
            `「${e.call}」的 why 太短或缺失 —— 这张表的意义就是回答"为什么必须在这个位置"，`
            + ` 只写"它做了什么"等于没写（细案 §1.2 的病正是"顺序上的不变量没人守"）。`);
        const key = `${e.call}(${e.args.join(',')})`;
        assert.ok(!seen.has(key), `表里重复登记了同一次调用：${key}`);
        seen.add(key);
    }
});

// ═══════════════ ⑤ 不得把表整个绕过（白名单侧：表必须真的被 import 得出来） ═══════════════
test('settle-5：settle.js 导出 SETTLE_ORDER，且表里**恰好覆盖**承重的那几格', () => {
    // 这几格是"顺序承担语义"的**已知承重点**（细案 §1.2 + leg66 W2f 真账）——
    // 它们从表里消失 ⇒ 不是"简化"，是把不变量又埋回 139 行里去了。
    const must = ['applyAgendaCancels', 'applyAgendaAdvances', 'closeEvents', 'applyEntityFates',
        'applyEntityUpdates', 'captureOpenCauseState', 'updateUnrestGear'];
    const listed = SETTLE_ORDER.map((e) => e.call);
    for (const name of must) {
        assert.ok(listed.includes(name), `承重步骤「${name}」不在顺序表里 —— 细案 §1.2 的不变量必须有主人。`);
    }
    // ★承重顺序本身：取消 → 推进 → 闭环 → 灭 → 字段写回（表里必须按这个先后登记）
    const idx = (n) => listed.indexOf(n);
    const chain = ['applyAgendaCancels', 'applyAgendaAdvances', 'closeEvents', 'applyEntityFates', 'applyEntityUpdates'];
    for (let i = 1; i < chain.length; i += 1) {
        assert.ok(idx(chain[i - 1]) < idx(chain[i]),
            `承重顺序错了：${chain[i - 1]} 必须排在 ${chain[i]} 之前（细案 §1.2 / leg66 W2f）。`);
    }
});

// ═══════════════ ⑥ ★★★leg84（乙-2）：阶段数组必须真的驱动那 8 个阶段，且 `settleTick` 真的变薄 ═══════════════
// 这一格咬的是乙-2 的**结构本身**（细案 `docs/leg84-settle-stages-spec.md` §4 判据①⑤）：
//   ① 数组里的每个阶段都必须是**真函数**、且在 `src/settle.js` 里**真的定义**（防"数组里塞个名字"）
//   ② `settleTick` 必须**真的调用** `SETTLE_STAGES`（防"数组摆着好看、实际还是手写一遍"）
//   ③ `settleTick` 必须**真的变薄**（下界→上界都锁）：阶段化没落地时它仍是 140 行
test('★★★leg84（乙-2）：SETTLE_STAGES 真驱动全部阶段，且 settleTick 真的变薄（薄驱动）', () => {
    assert.ok(Array.isArray(SETTLE_STAGES) && SETTLE_STAGES.length >= 10,
        `阶段数组太短（${SETTLE_STAGES.length} 个）—— 乙-2 定稿是"10 个显式阶段"（其中 3 个是纯读/纯算的小阶段）。`);
    assert.ok(Object.isFrozen(SETTLE_STAGES), '★阶段数组必须冻结（它是**顺序**的单一驱动源，不许被随手改）');
    const names = SETTLE_STAGES.map((f) => f.name);
    for (const [i, stage] of SETTLE_STAGES.entries()) {
        assert.equal(typeof stage, 'function', `阶段 ${i} 不是函数：${names[i]}`);
        // 每个阶段都必须在源码里**真的定义**（防"数组里塞个别处来的函数/名字"）
        assert.ok(LINES.some((l) => l.startsWith(`export function ${stage.name}(`)),
            `阶段「${stage.name}」在 src/settle.js 里找不到 \`export function ${stage.name}(\` —— 阶段必须住在同一个文件里`);
    }
    assert.equal(new Set(names).size, names.length, `阶段名有重复：${names.join(' / ')}`);

    // ★★★**反向也必须锁**（leg84 咬合演练当场抓出的漏洞）：这一格第一版只验"数组里的每个阶段都有定义"，
    //   于是"**从数组里删掉一个阶段**"（定义还在、但不再被驱动）能整条溜过去 —— 而那正是最容易犯的错：
    //   阶段函数写好了忘了挂进数组 ⇒ **那一整段逻辑静默消失**（判据全绿，世界少跑一段）。
    //   口径：`src/settle.js` 里**每个 `export function` 且名字以阶段语义命名的**都必须在数组里被驱动。
    //   ★实现：取"本文件里所有被 `SETTLE_STAGES` 数组提到的名字" ∪ "数组实际项" 做双向相等检查。
    const driveNames = new Set(SETTLE_STAGES.map((f) => f.name));
    const declaredStages = [...SOURCE.matchAll(/^export function ([A-Za-z_$][\w$]*)\(/gm)]
        .map((m) => m[1])
        .filter((n) => /^(prepare|apply|capture|compute|gate|adjudicate|consistency|close|reactivate|record)[A-Z]/.test(n));
    assert.ok(declaredStages.length >= 8,
        `★按阶段命名法找到的导出函数太少（${declaredStages.length} 个）—— 命名法或抽取器失效了？`);
    const notDriven = declaredStages.filter((n) => !driveNames.has(n));
    assert.deepEqual(notDriven, [],
        `★这些阶段函数**定义了却没被 SETTLE_STAGES 驱动**：${notDriven.join('、')}`
        + ` —— 那一整段逻辑会**静默不跑**（判据全绿、世界少跑一段）。挂进数组、或删掉它。`);
    const notDeclared = [...driveNames].filter((n) => !declaredStages.includes(n));
    assert.deepEqual(notDeclared, [],
        `★数组里的这些阶段在源码里找不到定义：${notDeclared.join('、')}`);

    // ② `settleTick` 真的用它驱动（不是摆着）
    const driver = bodyOf('settleTick');
    assert.match(driver, /SETTLE_STAGES/,
        '★`settleTick` 必须真的遍历 SETTLE_STAGES —— 否则那张数组只是"摆着好看"，顺序又回到手写里去了');
    assert.match(driver, /SETTLE_STAGES\.slice\(1\)|for \(const stage of SETTLE_STAGES\)/,
        '★`settleTick` 必须按数组顺序调用阶段');

    // ③ 真的变薄（下界 = 薄驱动的上界；上界 = 原顺序过程 140 行的**一半**，防"改回厚函数"）
    const driverLines = driver.split('\n').length;
    assert.ok(driverLines < 70,
        `★settleTick 仍是 ${driverLines} 行 —— 乙-2 的口径是"薄驱动"（原文是 140 行的顺序过程）。`
        + ` 若确有必要写长，请先说明为什么不放回阶段里。`);
    assert.ok(driverLines >= 12, `★settleTick 只有 ${driverLines} 行 —— 太薄了，是不是把该做的都推给别人了？`);

    // ④ 每个阶段都必须"返回它收到的那个世界"（细案 §3 纪律③：早退不许从阶段里穿出去）
    //   ★口径（leg84 定稿）：**返回的是它自己的入参**（变量名随形参，不写死 `world`）——
    //     比写死 `world` **更严**：连"返回一个来路不明的对象"都会被咬住；
    //     同时允许阶段1 的合法例外（它把入参**克隆后**返回，见 `prepareSettle` 头注）。
    for (const stage of SETTLE_STAGES) {
        const body = bodyOf(stage.name);
        const sig = body.match(/^export function \w+\(([A-Za-z_$][\w$]*)/);
        assert.ok(sig, `阶段「${stage.name}」的签名抽不出来 —— 抽取器与代码形态不符`);
        const worldParam = sig[1];
        assert.match(body, new RegExp(`return ${worldParam};`),
            `阶段「${stage.name}」没有 \`return ${worldParam};\` —— 阶段必须一律"就地改、返回同一个世界"`
            + `（早退走 ctx.blocked，不许 return 别的东西）`);
    }
});
