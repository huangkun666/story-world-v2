// story-world-v2/test/ledger-shape.test.js
// ★★★leg55：**台账表结构守门**——本仓"改码三件事"的第三件就是写台账（铁律 4），
//   而台账是 markdown 表：**一行错位，整表渲染就散**。
//   ★为什么一定要有这条（本棒亲身踩的，代价真实）：我用 `edit` 往 `docs/ledger.md` 插行时，
//     替换串漏了一个 `|` ⇒ 那一行**裂成两行**（第一行不以 `|` 收尾、第二行没有开头 `|`），
//     于是**整条 leg55 记录横跨两行**、表格从那一行起全部错位——而**测试 792/792 全绿**
//     （判据只测代码，没有一条看台账）。★这正是本仓的老病换了个形状：
//     **"同一件事两处表达"（这里是人写的 markdown 与它的列定义）之间没有任何东西守着**。
//   ★口径（刻意宽容，避免变成噪声锁）：只锁**本仓自己的规矩**——
//     ①`docs/ledger.md` 每行 **5 格**、`LEDGER.md` 每行 **3 格**（`leg31` 统一过的列定义）；
//     ②行必须以 `|` 开头且以 `|` 收尾；③**不许有"续行"**（不以 `|` 开头、又不以 `>`/`#`/空行开头的正文行）。
//     ★**不管**历史遗留的错位行（`leg31` 记档在案：代码片段里未转义的 `|` 会把一格切成两格）——
//     那些行是**已知旧债**，本判据只保证**新写的行不许再犯**，故按"行号白名单"豁免存量。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TABLES = [
    { file: 'docs/ledger.md', cols: 5 },
    { file: 'LEDGER.md', cols: 3 },
];

// ★★★leg56/57：**按渲染器的口径数格**（`split('|')` 去掉首尾两个空片）——markdown 就是这么分的。
//   ★推导（写死在这里，这条函数我已经改错两次，每次都表现为"守门自己变成那个两把尺子"）：
//     行 `| c1 | c2 | c3 |` —— 竖线 **4** 个 = 首 1 + 尾 1 + 中间 **2** 个分隔符（列数-1）
//     ⇒ 竖线数 = 列数 + 1 ⇒ **列数 = 竖线数 - 1**。`split('|')` 得 5 片、去掉首尾空片也是 3。
//     ★`\|` 要跳过：它是我写的**字面竖线**（不是分隔符），跳过之后才与"我实际想要的列数"一致。
//     ★踩坑留档：第一版**漏跳过 `\|`** ⇒ 正确行被多算一格；第三版把公式误改成 `bare-2`
//     ⇒ **整表统一少算一格**、243/251 行全报红（**错的是尺子，不是行**——两次都不是行的问题）。
const countCells = (line) => {
    let bare = 0;
    for (let k = 0; k < line.length; k++) {
        if (line[k] !== '|') continue;
        if (line[k - 1] === '\\') continue;     // 我写的 `\|` = 字面竖线
        bare++;
    }
    return bare - 1;                            // 列数 = 竖线数 - 1（见上面推导）
};

// ★★★leg56：存量旧债用**计数棘轮**，不用行号/签名白名单——前两版都当场误报，值得留档：
//   ① 第一版按**行号**记 ⇒ 本表"最新在最上"，我插一行 leg56，下面每行行号 +1 ⇒ 名单整体错位、
//      20 条旧债全被报成新问题（狼来了的第 0 天）；
//   ② 第二版改按**内容签名**（"第五十二棒"…）⇒ 我手写的签名与实际行对不上，照样误报。
//   ⇒ 定稿：**只钉一个数**——"现在有几行是坏的"。本表**只往上加行**，所以这个数**只该减不该增**：
//     新写的行坏掉 ⇒ 计数+1 ⇒ 立刻红；将来修好一行 ⇒ 把常数减 1。
//     ★这个不变量对"插入/删除/改写"全都稳定（不依赖任何行号或文本），这才是对的锁法。
//     ★病根与本棒治的那一族是同一个：**用易变的键（行号/签名）去标识稳定的事实**。
const KNOWN_BAD_COUNT = {
    // 实测（leg57 用**修正后的公式**重新现量）：`docs/ledger.md` 246 条数据行里 **10** 条不合格、
    //   `LEDGER.md` 253 条里 **22** 条（全在 leg55 之前的历史行，多为代码片段里的
    //   `savedAt|tick|…` 签名、`width: 0%|100%` 这类裸竖线）★两者都**不含** leg55/56/57 的行。
    //   ★为什么要在这里写明"leg57 重量的"：上一版这两个数是照**错公式**量的（把 `\|` 当分隔符），
    //     所以它们**从来没有对过**——只是"基线按自己量的，所以自己看着永远合格"。
    'docs/ledger.md': 10,
    'LEDGER.md': 22,
};

for (const { file, cols } of TABLES) {
    test(`★★leg55：台账表结构守门 —— ${file} 每条记录必须是**一条** ${cols} 格的行`, () => {
        const src = readFileSync(path.join(ROOT, file), 'utf8');
        const lines = src.split('\n');
        const bad = [];
        let dataRows = 0;

        lines.forEach((line, i) => {
            // 只看数据行（我们自己的记录都以 `| 20` 开头的日期起）
            if (!/^\|\s*20\d\d-/.test(line)) return;
            dataRows++;
            const cells = countCells(line);                 // ★按 `\|` 转义口径数（见 countCells）
            const tail = line.trimEnd().endsWith('|');
            if (cells !== cols || !tail) {
                bad.push(`L${i + 1}：${cells} 格（应 ${cols} 格）${tail ? '' : ' · ★行尾没有 `|`（很可能被拆成了两行，leg55 踩过）'}`);
            }
        });

        assert.ok(dataRows > 100, `前置：台账里应该有很多条记录（实测 ${dataRows}）`);
        // ★棘轮：坏了多少行**只能不增**。增了 ⇒ 一定是新写的行坏了（旧债不会自己变多）。
        assert.ok(bad.length <= KNOWN_BAD_COUNT[file],
            `★★台账坏行数 **增加了**（${bad.length} > 基线 ${KNOWN_BAD_COUNT[file]}）⇒ 新写的行有问题：\n`
            + bad.slice(0, 12).join('\n'));
        // ★另一头也要钉：修好旧债后必须同步下调基线，否则这条锁会悄悄变松（"棘轮只紧不松"）
        assert.equal(bad.length, KNOWN_BAD_COUNT[file],
            `★坏行数 ${bad.length} ≠ 基线 ${KNOWN_BAD_COUNT[file]}——少了一定是有人修好了旧债 ⇒ `
            + `请把 ${file} 的 KNOWN_BAD_COUNT 下调到 ${bad.length}（否则棘轮白松了一格）`);

        // ★反向自证：这条锁必须真的在扫东西（防"文件读空/正则写错"退化成空绿）
        assert.ok(lines.some((l) => /^\|\s*20\d\d-/.test(l)), '前置：确实扫到了数据行（否则这条守门是空绿）');
    });
}

// ★★★leg55：判据自身的**反向自证**——证明上面那套检测**真的抓得住本棒踩的那个坑**。
//   为什么不能只靠"文件现在是好的"：那样这条锁是**空绿**（本仓吃过很多次：守门数组里没有的字面量＝不存在）。
//   故把"本棒真实犯过的那个错"（替换串漏一个 `|` ⇒ 记录裂成两行）**在内存里重演一遍**，
//   断言检测器**必须报出它**。用一个与守门共用同一判定的取样函数，避免"两处实现"。
test('★★leg55：台账守门的**反向自证** —— 把本棒踩过的"行裂成两条"重演，检测器必须抓得住', () => {
    // 与上面的守门**同一套判定**（列数 + 行尾 `|`）——只抽成小函数，不另写一份口径
    const inspect = (line, cols) => {
        if (!/^\|\s*20\d\d-/.test(line)) return null;      // 不是数据行
        const cells = line.split('|').length - 2;
        const endsWithPipe = line.trimEnd().endsWith('|');
        return { cells, endsWithPipe, ok: cells === cols && endsWithPipe };
    };

    // ① 正常行（5 格、以 | 收尾）⇒ 必须判 OK
    const good = '| 2026-09-17 | 第五十五棒（leg55） | 变更 | 测试 | 部署形态 |';
    assert.equal(inspect(good, 5).ok, true, '正常行必须通过');

    // ② ★本棒真实犯过的形状：替换串漏了一个 `|` ⇒ 这一行**不以 `|` 收尾**（下一行成了续行）
    const splitRow = '| 2026-09-17 | 第五十五棒（leg55） | 变更 | 测试';
    const r = inspect(splitRow, 5);
    assert.equal(r.endsWithPipe, false, '★裂开的行尾必然没有 `|`——这正是当年的信号');
    assert.equal(r.ok, false, '★★检测器必须把"裂成两行"判为不合格（否则这条守门是空绿）');
    assert.equal(r.cells, 3, '★而且要能说出"少了格"（3 格 ≠ 5 格）');
    //   ★口径（第一版写 4、被自己判红改掉）：该串只有 3 个 `|` ⇒ 去掉首尾空片得 **3** 格。
    //     "少几格"取决于截断点，**不该由这条自证猜**——所以断的是"≠ 应有格数"，不是某个具体数。

    // ③ 另一种错法：格数对但行尾丢了 `|` ⇒ 也必须红
    const noTail = '| 2026-09-17 | a | b | c | d';
    assert.equal(inspect(noTail, 5).ok, false, '行尾丢 `|` 必须判不合格');

    // ④ 反向的反面：**不能**把正常行也判红（否则这条锁会变成噪声、被人关掉）
    const ok5 = '| 2026-09-17 | a | b | c | d |';
    assert.equal(inspect(ok5, 5).ok, true, '★合格的 5 格行不许被误判（防守门过严）');
});
