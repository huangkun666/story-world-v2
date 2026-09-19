// story-world-v2/test/world-replace-layout.test.js
// ★★★leg103（A3）：**「覆盖现存世界」这一族的判据**（用户令"我捋一遍"捋出来的两条真缺陷）。
//
// 这一族治的是什么（两条，都是玩家真会踩的）：
//   ① **导入不确认**：`bus['import-world']` 原来选错文件就 `writeHotMeta` + `loadWorld`，
//      一声不响换掉当前世界 —— 而隔壁「✨ 开始新世界」**有**确认框（同一份代码里两种标准）；
//   ② ★**一句假承诺**：初始化那份文案写着「换掉前会自动给当前状态拍一份快照（换错了可以再退回来）」，
//      而 `requestSnapshot` 唯一的调用点是 `writeHotMeta` 末尾（`web/hot-ledger.js:129`），
//      初始化是**先抽取、后 writeHotMeta** ⇒ 拍到的是**刚抽出来的新世界**。
//      也就是说：**唯一那条"换错了能回来"的退路，其实不存在**。
//
// ★它为什么能躲过判据（这一条比缺陷本身值钱）：
//   `test/init-overwrite-guard.test.js` 只断言**文案里有没有那句承诺**，
//   从不断言**承诺的行为真的发生了** —— "判据在、判的却是文案不是行为"，
//   本仓"空绿"家族的又一员。⇒ 本文件第 ③ 条就是补这一刀：**承诺与行为同锁**。
//
// 判据形态纪律（照 `test/web-memory-layout.test.js` / `test/web-snapshot-layout.test.js` 同一把尺）：
//   · 一律跑在**剥注释后的源码**上（注释里可以留档——本仓的留档风格就是大量写"旧的病是什么"，
//     裸正则会被自己的留档骗红，leg71 立的规矩）；
//   · 每条判据都带**前置自证**（防"切空了/扫空气"式的空绿，leg100 §8.5 那一族）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

/** 剥注释（与 `web-memory-layout.test.js` 同一把尺：块注释 + 整行注释；字符串里的 `//` 不许被剥）。 */
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split('\n')
        .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
        .join('\n');
}

/** 取某个 `export function X(` 的函数体（锚在签名上，不锚行号——leg27 那条"写死窗口 ⇒ 假红"的教训）。 */
function bodyOfIn(src, sig, stops = ['\nexport function ', '\nexport async function ', '\nfunction ']) {
    const at = src.indexOf(sig);
    if (at < 0) return '';
    let end = src.length;
    for (const s of stops) {
        const i = src.indexOf(s, at + sig.length);
        if (i > 0 && i < end) end = i;
    }
    return src.slice(at, end);
}

const INDEX = read('web/index.js');
const INDEX_CODE = stripComments(INDEX);

// ---------- ① 新家在盘上，且真的装着那一族 ----------
test('★leg103·WR①：`web/world-replace.js` 在盘上，且那一族**只住新家**（接线层不许再定义，也不许 re-export）', () => {
    assert.ok(existsSync(new URL('web/world-replace.js', ROOT)), '★新模块必须在盘上（不许"搬走了"却没有新家）');
    const wr = read('web/world-replace.js');
    const wrCode = stripComments(wr);
    for (const n of ['worldToBeReplaced', 'initWorldOverwriteNotice', 'importOverwriteNotice']) {
        assert.match(wrCode, new RegExp(`export\\s+function\\s+${n}\\b`), `★\`${n}\` 必须在 \`web/world-replace.js\` 里导出`);
        // 旧家**代码里**不许再定义（注释里可以留档——本仓留档风格就是这样）
        assert.ok(!new RegExp(`export\\s+function\\s+${n}\\b`).test(INDEX_CODE),
            `★\`${n}\` **不许**还在 \`web/index.js\` 里定义（那就是两份复制品）`);
    }
    // ★本仓明令（leg71）：**不搞 re-export**——re-export 会让"它到底住哪"重新变模糊。
    assert.ok(!/^\s*export\s*\{[^}]*\}\s*from\s/m.test(INDEX_CODE), '★`web/index.js` 不许 re-export（消费者该改指向就改指向）');
    // ★新家必须**零 import**（叶子：纯文案 + 纯归一，Node 侧可直接导入）
    const imports = [...wrCode.matchAll(/^\s*import\s.+$/gm)].map((m) => m[0]);
    assert.equal(imports.length, 0, `★\`web/world-replace.js\` 必须是零 import 的真叶子；实际 ${imports.length} 条：${imports.join(' | ')}`);
    // 接线层只许 import 它（拿名字用），且必须真在用
    assert.match(INDEX_CODE, /import\s*\{[^}]*worldToBeReplaced[^}]*\}\s*from\s*'\.\/world-replace\.js'/,
        '★接线层必须从新家 import 那一族（消费者改指向新家）');
    // ★前置自证：这条判据不是空转——剥注释器必须真的能剥掉
    assert.ok(!stripComments('// export function worldToBeReplaced() {}').includes('export function worldToBeReplaced'),
        '★反向自证：剥注释之后注释里的定义不再命中（否则"把定义注释掉"能骗过上面那条）');
});

// ---------- ② 导入必问：闸在**任何改动之前** ----------
test('★leg103·WR②：导入恢复必须先问一句，且闸在 `writeHotMeta` **之前**（与初始化同一标准）', () => {
    const body = bodyOfIn(INDEX_CODE, "bus['import-world'] = async () => {", ["\n    bus['", '\n    // ----------']);
    assert.ok(body.length > 300, '前置：切到了 import-world 的真函数体（切空了下面几条就是空绿）');
    // ① 必须真问（带左括号 = 真调用；一句注释骗不过）
    assert.match(body, /window\.confirm\(\s*importOverwriteNotice\(/, '★导入必须弹确认（用 import 那一份文案），否则又是一声不响换世界');
    // ② 顺序：闸必须在**第一个破坏动作** `writeHotMeta` 之前（本仓"闸放最前"那条 leg40b 纪律的同款）
    const gateAt = body.indexOf('window.confirm(importOverwriteNotice(');
    const writeAt = body.indexOf('writeHotMeta(');
    assert.ok(writeAt > 0, '前置：这一条函数体里真有 `writeHotMeta`（没有它就没有"破坏动作"可比）');
    assert.ok(gateAt > 0 && gateAt < writeAt, '★★闸必须在 `writeHotMeta` **之前**（放在之后 = 已经覆盖完了才问，等于没问）');
    // ③ 取消路径必须**什么都不做**：闸与 `writeHotMeta` 之间只有 return，不许夹别的写动作
    const between = body.slice(gateAt, writeAt);
    assert.match(between, /return;/, '★取消路径必须 return（什么都不做）');
    assert.ok(!/loadWorld\(|volumeStore\(\)\.put|applySettingToSsot/.test(between),
        '★取消路径上不许先做了别的事（取消 = 一个字节不动、零调用）');
    // ④ 无 window.confirm（Node/vm）⇒ 放行，绝不卡死（与初始化同一条）
    //   ★形态取自真实的嵌套写法（`import-world` 的 change 回调里缩进更深）⇒ 空白不敏感
    assert.match(body, /typeof window\.confirm === 'function'[\s\S]{0,120}?:\s*true/,
        '★无 `window.confirm` 时必须放行（绝不因为"问不出来"把人卡死）');
});

// ---------- ③ ★★承诺与行为同锁：那句"会先拍一份快照"必须真发生 ----------
test('★★★leg103·WR③：初始化那句"先拍一份快照"的承诺，**行为必须真的发生**（这是本笔最该带走的一刀）', () => {
    // 病（见文件头 ②）：文案承诺了、行为没发生 ⇒ 用户唯一的退路是空的。
    //   旧判据只锁"文案里有没有这句" ⇒ 本仓"判据在、判的却是文案不是行为"的空绿家族又一员。
    const wrCode = stripComments(read('web/world-replace.js'));
    const indexCode = INDEX_CODE;
    // ① 文案这一侧：承诺必须在（它是玩家读到的"退路说明"）
    assert.match(wrCode, /换掉前自保/, '★初始化那份文案必须写明"会先拍一份（换掉前自保）"——玩家据此知道退路在哪');
    // ② 行为这一侧：接线层必须**真拍**，而且拍在**确认之后、writeHotMeta 之前**
    const body = bodyOfIn(indexCode, "bus['init-world'] = async () => {", ["\n    bus['", '\n    // ----------']);
    assert.ok(body.length > 800, '前置：切到了 init-world 的真函数体');
    assert.match(body, /(?:^|[^\w$.])snapHub\.requestSnapshot\s*\(/, '★★★必须**真的调** `snapHub.requestSnapshot(`——否则那句承诺就是空的');
    assert.match(body, /'换掉前自保'/, "★理由串必须是「换掉前自保」（快照页上玩家认得出它是哪一份）");
    const confirmAt = body.indexOf('window.confirm(initWorldOverwriteNotice(');
    const snapAt = body.indexOf('snapHub.requestSnapshot(');
    const writeAt = body.indexOf('writeHotMeta(');
    assert.ok(confirmAt > 0 && snapAt > confirmAt, '★★自保快照必须在**玩家点了确定之后**才拍（不能替他拍一堆没用的）');
    assert.ok(writeAt > snapAt, '★★自保快照必须在 `writeHotMeta` **之前**——在它之后拍到的是**新世界**（这正是原来的病）');
    // ③ 零阻塞：拍快照失败绝不许挡住初始化
    assert.match(body.slice(snapAt, snapAt + 400), /catch\s*\(/, '★拍快照必须自带兜底（快照失败不许挡住初始化——照 `requestSnapshot` 自己的纪律）');
    // ★前置自证：`world-replace.js` 里确实没有那句旧措辞的回潮（"自动给当前状态拍"）
    assert.ok(!wrCode.includes('换掉前会自动给当前状态拍'), '★旧那句**不附条件的**自动承诺不许回潮（它当时是假的，现在是"按确定之后才拍"）');
});

// ---------- ④ 两份文案不许"看起来一样、其实承诺不同" ----------
test('★leg103·WR④：初始化与导入两份文案，凡有一句承诺就必须两边都成立（导入那条照实说"不会先拍"）', async () => {
    const mod = await import('../web/world-replace.js');
    const { worldToBeReplaced, initWorldOverwriteNotice, importOverwriteNotice } = mod;
    const brief = worldToBeReplaced({ context: { world: '大荒z' }, meta: { tick: 7 }, entities: new Array(123).fill({}), savedAt: '2026-09-21T00:00:00Z' });
    assert.ok(brief && brief.name === '大荒z', '前置：brief 归一得出来（否则下面比的是两个空串）');
    const init = initWorldOverwriteNotice(brief);
    const imp = importOverwriteNotice(brief);
    for (const [label, s] of [['初始化', init], ['导入', imp]]) {
        assert.ok(s.includes('大荒z') && s.includes('7 轮') && s.includes('123 条名号'), `★${label}文案必须印出"换掉哪个世界 / 到第几轮 / 多少名号"`);
        assert.match(s, /取消/, `★${label}文案必须写清"取消会怎样"`);
        assert.ok(!/tick|entity|agenda|ssot|schema|引擎|落账|账本/i.test(s), `★${label}文案不许漏引擎词（A-3，含 leg103 新补的那批）`);
    }
    // ★★两者**必须不同**的那一处：导入不拍快照 ⇒ 不许照抄"会先拍一份"
    assert.ok(init.includes('换掉前自保'), '初始化：会先拍自保快照（行为已锁在 WR③）');
    assert.ok(!imp.includes('换掉前自保'), '★★导入那条**不许**承诺拍快照（它不拍）——两份文案"看起来一样、承诺不同"正是本仓要治的病');
    assert.match(imp, /不会.{0,6}替你先拍/, '★导入那条必须**照实说**"不会替你先拍"，并给出可执行的替代（先手动拍）');
    assert.match(imp, /拍一份快照/, '★并要告诉玩家怎么自己留退路');
    // 空输入 ⇒ 空串（调用方据此"不问"）
    assert.equal(importOverwriteNotice(null), '', '没有世界 ⇒ 空文案（不多问一句）');
    assert.equal(importOverwriteNotice({}), '', '没名字 ⇒ 空文案（不编一个名字来问）');
});
