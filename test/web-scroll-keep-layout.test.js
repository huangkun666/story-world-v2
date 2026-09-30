// story-world-v2/test/web-scroll-keep-layout.test.js
// ★★★leg104（C2）：**「重绘时别把滚动位置弄丢」这一族的判据**。
//
// 病（体验，不是崩溃；面板体检里"每次都会硌到"的那一条）：
//   观棋页是**两栏各自滚动**（`.sw2-merged-main` / `.sw2-merged-side`），面板本身还有一条**页面级滚动**
//   （`.sw2-view.sw2-active{overflow:auto}`，leg101 落的）。而 `refreshWorld`（每轮推进 / 载入 / 回快照）
//   与 `refreshSections`（局部重绘）都是 `el.innerHTML = …` **整块换掉** ⇒ 容器是**新造的**、`scrollTop` 归零
//   ⇒ 玩家正滚到"面 / 线"中段看事件，一轮结束画面**跳回该栏顶部**。原有那条"押后"机制只护
//   **手正按在控件上**（`paramApi.playerIsTouchingParams()`），**不护滚动**。
//
// ★★判据必须打**产品真入口**（leg103 §6.1 那条纪律：第一版只调自己新写的函数 ⇒ 把产品里那一支整个拆掉、
//   判据照旧全绿）。产品那条路是**接线层在两端调这两个函数**，所以本文件两面都锁：
//   ① 单测这两个函数本身（喂假元素，真跑）；② 锁接线层**真的**在两端调它、且**取在写之前、放在写之后**。
//
// 形态纪律（照 `world-replace-layout.test.js` / `web-memory-layout.test.js` 同一把尺）：
//   一律跑在**剥注释后的源码**上（注释里可以留档）；每条带前置自证或反向自证（防空绿）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { SCROLL_SLOTS, captureScrollPositions, restoreScrollPositions } from '../web/scroll-keep.js';

const ROOT = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

/** 剥注释（与 `world-replace-layout.test.js` 同一把尺：块注释 + 整行注释；字符串里的 `//` 不许被剥）。 */
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split('\n')
        .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
        .join('\n');
}

/** 取某个函数的体（锚在签名上，**不锚行号**——leg27 那条"写死窗口 ⇒ 假红"的教训）。 */
function bodyOfIn(src, sig, stops = ['\nfunction ', '\nexport function ', '\n// ----------']) {
    const at = src.indexOf(sig);
    if (at < 0) return '';
    let end = src.length;
    for (const s of stops) {
        const i = src.indexOf(s, at + sig.length);
        if (i > 0 && i < end) end = i;
    }
    return src.slice(at, end);
}

const INDEX_CODE = stripComments(read('web/index.js'));

// ---------- ① 新家在盘上，且那一族只住新家 ----------
test('★leg104·SC①：`web/scroll-keep.js` 在盘上（零 import 的真叶子），接线层只 import、不定义、不 re-export', () => {
    assert.ok(existsSync(new URL('web/scroll-keep.js', ROOT)), '★新模块必须在盘上（不许"搬走了"却没有新家）');
    const skCode = stripComments(read('web/scroll-keep.js'));
    for (const n of ['captureScrollPositions', 'restoreScrollPositions']) {
        assert.match(skCode, new RegExp(`export\\s+function\\s+${n}\\b`), `★\`${n}\` 必须在 \`web/scroll-keep.js\` 里导出`);
        assert.ok(!new RegExp(`export\\s+function\\s+${n}\\b`).test(INDEX_CODE),
            `★\`${n}\` **不许**还在 \`web/index.js\` 里定义（那就是两份复制品）`);
    }
    // ★零 import（叶子）：本族谁也不依赖 ⇒ `node --test` 可直接导入
    const imports = [...skCode.matchAll(/^\s*import\s.+$/gm)].map((m) => m[0]);
    assert.equal(imports.length, 0, `★\`web/scroll-keep.js\` 必须是零 import 的真叶子；实际 ${imports.length} 条：${imports.join(' | ')}`);
    // ★不搞 re-export（leg71 立的规矩）
    assert.ok(!/^\s*export\s*\{[^}]*\}\s*from\s/m.test(INDEX_CODE), '★`web/index.js` 不许 re-export');
    assert.match(INDEX_CODE, /import\s*\{[^}]*captureScrollPositions[^}]*\}\s*from\s*'\.\/scroll-keep\.js'/,
        '★接线层必须从新家 import 那一族');
    // ★三格滚动面的名字**必须是真的**（不是想出来的）：并页那两栏由 `page-compose.js` 产出
    assert.deepEqual(SCROLL_SLOTS, ['page', 'sw2-merged-main', 'sw2-merged-side'], '★三格：页 ＋ 并页两栏（口径一处定义）');
    const compose = read('web/page-compose.js');
    for (const cls of ['sw2-merged-main', 'sw2-merged-side']) {
        assert.ok(compose.includes(cls), `★\`${cls}\` 必须真的由 \`page-compose.js\` 产出（否则本族在扫空气）`);
    }
    // ★前置自证：剥注释器真的能剥（否则"把定义注释掉"能骗过上面那条）
    assert.ok(!stripComments('// export function captureScrollPositions() {}').includes('export function captureScrollPositions'),
        '★反向自证：剥注释之后注释里的定义不再命中');
});

// ---------- ② 行为：取 / 放（喂假元素，真跑产品那两个入口）----------
test('★leg104·SC②：取得到、放得回；★缺席值不是 0（读不到的那一格不许被写成 0）', () => {
    // ★每格返回**同一个节点对象**（写进去的值下次读得到——假页面最容易犯的错就是每次新建）
    const page = (tops) => {
        const nodes = {
            '.sw2-merged-main': tops.main === undefined ? null : { scrollTop: tops.main },
            '.sw2-merged-side': tops.side === undefined ? null : { scrollTop: tops.side },
        };
        return { scrollTop: tops.page, querySelector: (sel) => nodes[sel] || null, nodes };
    };

    // ① 取：三格各归各的；★右栏这次**取不到**（不在并页那一版上）⇒ 如实记 null
    const snap = captureScrollPositions(page({ page: 120, main: 40 }));
    assert.deepEqual(snap, { page: 120, 'sw2-merged-main': 40, 'sw2-merged-side': null },
        '★取快照的形状：三格都在，取不到的记 null');

    // ② 重绘（新容器、scrollTop 全 0）⇒ 放回去：只回写**取到值**的那两格
    const after = page({ page: 0, main: 0, side: 7 });
    assert.equal(restoreScrollPositions(after, snap), 2, '★回写了两格（页 ＋ 左栏）');
    assert.equal(after.scrollTop, 120, '★页面级滚动回到原处');
    assert.equal(after.querySelector('.sw2-merged-main').scrollTop, 40, '★左栏回到原处');
    assert.equal(after.querySelector('.sw2-merged-side').scrollTop, 7,
        '★★缺席值不是 0：取不到的那一格**一个字都不许动**（写 0 = 用"0"冒充"读不到"）');

    // ③ 读出来的不是有限数 ⇒ 也记 null（缺席的另一种形状）
    const weird = { scrollTop: undefined, querySelector: () => ({ scrollTop: NaN }) };
    assert.deepEqual(captureScrollPositions(weird), { page: null, 'sw2-merged-main': null, 'sw2-merged-side': null },
        '★★`undefined` / `NaN` 都不是位置 ⇒ 记 null（绝不当成 0）');
    assert.equal(restoreScrollPositions(page({ page: 3, main: 3 }), captureScrollPositions(weird)), 0,
        '★全是 null 的快照 ⇒ 一格都不写（如实返回 0）');

    // ④ 元素不可用 / 快照为空 ⇒ 不猜、不抛
    assert.equal(captureScrollPositions(null), null, '★没有元素 ⇒ 返回 null（"这一次不问"）');
    assert.equal(captureScrollPositions({}), null, '★没有 `querySelector` ⇒ 同上（不猜它是不是元素）');
    assert.equal(restoreScrollPositions(null, snap), 0, '★没有元素 ⇒ 0（不抛）');
    assert.equal(restoreScrollPositions(page({ page: 0 }), null), 0, '★没有快照 ⇒ 0');

    // ⑤ 重绘之后**两栏不在了**（切回非并页）⇒ 只写页那一格，绝不抛
    const plain = page({ page: 9 });
    assert.equal(restoreScrollPositions(plain, snap), 1, '★两栏不在 ⇒ 只有页那一格可写（如实 1，不是 0 也不是 2）');
    assert.equal(plain.scrollTop, 120, '★页那一格照旧回写');
});

// ---------- ③ ★接线层两端真的接了（取在写之前、放在写之后）----------
test('★leg104·SC③：两个重绘通道都"先取后放"——★取在 `innerHTML` 写之前、放在写之后（锚在签名上，不锚行号）', () => {
    const sites = [
        { name: 'refreshWorld（每轮推进 / 载入 / 回快照）', sig: 'export function refreshWorld(world,', stops: ['\nexport function ', '\nfunction ', '\n// ----------'] },
        { name: 'refreshSections（局部重绘）', sig: 'function refreshSections(names) {', stops: ['\nexport function ', '\nfunction ', '\n// ----------'] },
    ];
    for (const site of sites) {
        const body = bodyOfIn(INDEX_CODE, site.sig, site.stops);
        assert.ok(body.length > 500, `前置：切到了 ${site.name} 的真函数体（否则下面全是空绿）`);
        const iCap = body.indexOf('captureScrollPositions(el)');
        const iWrite = body.indexOf('el.innerHTML =');
        const iRes = body.indexOf('restoreScrollPositions(el, keep)');
        assert.ok(iCap > 0, `★${site.name}：必须**真的调** \`captureScrollPositions(el)\`（重绘前取）`);
        assert.ok(iRes > 0, `★${site.name}：必须**真的调** \`restoreScrollPositions(el, keep)\`（重绘后放）`);
        assert.ok(iCap < iWrite, `★★${site.name}：取必须**在写之前**（写在取之前 = 取到的是新页面的 0）`);
        assert.ok(iWrite < iRes, `★★${site.name}：放必须**在写之后**（放在写之前 = 什么都没做，本笔就是白干）`);
    }
    // ★两个通道都要接（少一个 ⇒ 有一条路还在弄丢位置）
    assert.equal((INDEX_CODE.match(/captureScrollPositions\(/g) || []).length, 2, '★取：两处（两个重绘通道各一处）');
    assert.equal((INDEX_CODE.match(/restoreScrollPositions\(/g) || []).length, 2, '★放：两处（同上）');
    // ★反向自证：把产品里那一支拆掉 ⇒ 上面那条"放必须在写之后"就立不住
    const broken = INDEX_CODE.replace(/restoreScrollPositions\(el, keep\);/g, '');
    assert.notEqual(broken, INDEX_CODE, '前置：确实拆掉了调用点（否则这条自证是空转）');
    assert.ok(broken.indexOf('restoreScrollPositions(el, keep)') < 0,
        '★反向自证：拆掉之后"放在写之后"找不到对象 ⇒ 本条判据会当场红（说明它咬的是产品那条路，不是我写的新函数）');
});