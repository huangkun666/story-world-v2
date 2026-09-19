// story-world-v2/test/render.test.js
// K33/K34 双流 UI：渲染核心纯函数（HTML 面，细案 A-1/A-2/A-3/A-6）——逐字节确定性锁 +
// 玩家语言黑名单（直扫产物字符串）+ 八页签内容断言 + A-6 档案页逐字段一致 + 编码安全 + 空态防御。
//   ★leg40b：此处旧写"六页签"——leg26 加参数页、leg27 后加快照页之后就没再对齐过（八页签）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    renderAll, renderBoardHtml, renderChronicleHtml, renderArchiveHtml,
    renderEntitiesHtml, renderSettingHtml, renderSettingsHtml, renderVolumeReadHtml,
    renderChainViewHtml, renderInfoBandHtml, renderParamsHtml,
    // ★★leg94：编年视图默认态的**唯一真源** + 账目行里机器号换人话的两个口（判据直接喂它们验边界）
    CHRONICLE_DEFAULT_VIEW, chronicleEventNames, chronicleDisplayText,
    // ★leg56：分段档位条（纯展示函数——判据直接喂数字验边界，不必造世界）
    gearBarHtml,
    ENTS_PAGE_SIZE, ENTS_DEFAULT_VIEW, makeEntsView, entsSearchTextOf, selectEntityPage, entsHitCounts,
} from '../src/render.js';
// ★★★leg87：单轮超时/输出上限那条锁要**逐字比对出厂真源**（不许渲染层自己抄一份数）。
import { PROPOSED_CALL_LIMITS } from '../src/transport-http.js';
// ★★leg88 撤回留档：本文件里 leg87 那几条**关于"提取"**的断言已随 `web/dialogue.js` 整族撤回
//   （用户裁示："从你发的话里提取落子"不是他要的提取）。关于**A 删 / C 删 / 单轮上限改控件**那几条
//   一个字未动——那三件是用户明确批准的。
// ★★★leg85（丙案 · render.js 第一个切口）：**共用底**（`escapeHtml` / `BLACKLIST` / `PANEL_BUILD` …）
//   整族搬进 `src/render-base.js` ⇒ 本文件按"符号的实际新家"改指向（**不搞 re-export**，本仓明令）。
//   ★判据内容一个字没改：本文件对这一族咬的仍然是**内容与形状**（黑名单里真有那些词、构建号合
//     `/^leg\d+-/` 且不含禁词），与"它住在哪个文件"无关 ⇒ 换家不改判据，只换取样地址。
import { escapeHtml, BLACKLIST, PANEL_BUILD } from '../src/render-base.js';
import { AGENDA_CAPS } from '../src/settle.js';
import { LIMIT_DEFAULTS, LIMIT_GEARS, LIMIT_KEYS } from '../src/limits.js';
// ★leg52：面板的档位白名单＝参数表那两张表本身（从**真源**取，不抄字面量——否则面板造得出引擎不认的值）
// ★leg53：`PARAM_KEYS` 是**账本键表**、`PANEL_ENV_KEYS` 是**面板口径**——两件事分开，判据要同时看两边
import { PARAM_GEARS, PARAM_KEYS, PANEL_ENV_KEYS } from '../src/params.js';
// ★leg53：「哪几格是引擎每轮算的」必须来自**生产者**（面板不许自己另写一份名单）
import { ENGINE_DERIVED_ENV } from '../src/unrest.js';
// ★leg55·二：「乱象」说明里的窗口数必须与**机制**同源（面板不许替机制承诺一个没写死的数）
import { UNREST_WINDOW } from '../src/unrest.js';
import { TENSION_WINDOW } from '../src/setting.js';
// ★leg55：面板印的冷档阈值＝引擎轮转当缺省用的那份常量 ⇒ 判据从**真源**取，不抄字面量
import { PROPOSED_LIMITS } from '../src/storage.js';
import { expandChain } from '../src/chain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// leg26 c 对抗式锁（用户实拍截图逼出，两个错各自钉一条）：
//   ①**UI 重复**：参数页第一版把当前值渲染了两遍（`当前档位 未定` + 行尾又一个小「未定」chip），
//     信息面板那边同理（值 `未定` + 同义 chip「未定」）⇒ 用户截图一眼看出"未定未定"。
//     判据写成**结构性**的：任何参数行里，同一个词不许连出现两次。
//   ②**因变量不许有旋钮**：民生/乱象是结果，面板给它下拉 = 假装"拧一下结果就变了"（引擎既没那个函数、
//     也没那个资格）。判据：因变量那几行里**不许出现 <select>**，而自变量那几行**必须有**。
test('leg26 c：参数页——值不重复、因变量不给旋钮、自变量给旋钮（用户实拍截图逼出的两条锁）', () => {
    const w = world();
    const html = renderParamsHtml(w);
    // ① **同一个值在行内不许出现两次**（用户实拍「未定未定」的形态）。
    //    判据必须按**结构**写：字面连着（`未定未定`）不算——重复出现在两个标签之间。
    //    口径 = 把 `<select>` 整块剥掉后（下拉里的选项文本是控件本身，不算"呈现"），
    //    该值的出现次数必须恰好 = 1（那一行只该显示一次）。
    //    ★★leg99：这个助手已提到**模块级**（`leg52·E` 那条判据也要用它）——只留一份实现。
    const count = (hay, needle) => hay.split(needle).length - 1;
    const bare = structuredClone(w);
    bare.context.setting.dynamic.env = {};            // 全未定 —— 正是用户截图那个状态
    const bareHtml = withoutSelects(renderParamsHtml(bare));
    // ★★★leg99（用户令「当前是什么值就是下拉栏的值」）：口径**升级**——原来数的是"3 个格各画一次"，
    //   而撤掉自变量那两格之后，**「未定」只剩因变量那一格**（乱象；它没有控件、那格是它唯一的读数面）。
    //   ⇒ 断言改成：①`未定` **恰好 1 次**（= 乱象那格）②**两个自变量一个字都不许印**（它们的值只在下拉里）。
    //   ★这一改**不是放松**：把 `<select>` 剥掉之后再数，数出来的就是"**呈现层**印了几个未定"，
    //     而下面 ①b 那条按**每个键**咬住了"控件确实带着未定" ⇒ 两个方向都在。
    assert.equal(count(bareHtml, '未定'), 1,
        `★★leg99：撤掉自变量那两格后，「未定」只该剩因变量那一格（实际 ${count(bareHtml, '未定')} 次）`);
    // ①b ★反向（防"上面那条只是因为整页没渲染出来"）：两个自变量的**下拉自己**必须带着「未定」。
    //   ★两个坑都在这里踩过（都留档）：
    //     ①形状：空值那一项是 `<option value="">未定</option>`——**不带 `selected`**（本笔多写了四个字符、当场红）；
    //     ②**必须在剥过 `<select>` 之前的那份原文上验**——`bareHtml` 是 `withoutSelects(...)` 的产物，
    //       拿它去找 `option` 永远找不到（本笔第二版就是这么红的）。⇒ 用 `bareRaw`。
    const bareRaw = renderParamsHtml(bare);           // ★未剥 select 的原文（控件在这里）
    for (const key of ['天时', '张力推手']) {
        const seg = bareRaw.slice(bareRaw.indexOf(`data-param="${key}"`));
        assert.ok(seg.slice(0, 400).includes('<option value="">未定</option>'),
            `★前置：自变量「${key}」的下拉必须把「未定」列为可选项（否则上面那条是空绿）`);
    }

    // ② 因变量（乱象）只读：所在行不得有 <select>
    //    ★★leg53：`民生度` 已从面板撤下（用户令「拿掉」——它没有生产者，永远「未定」）
    //      ⇒ 这一段只剩 `动乱度` 一格要判；**民生那一格"不许出现"另有一条锁**（见 leg53 那组）。
    // ★leg40c 续：原判据按 `data-param="<键>"` 定位——那张**卡片壳**上现在**刻意不再挂 data-param**
    //   （壳上挂它，事件 target 落在壳里时 `closest` 会抓到壳这个 div、`.value` 读成 undefined
    //   ⇒ 提交"未定"、玩家点的档位被丢掉——正是用户那条「点了还是改不了值」）。
    // ★★leg52（**口径升级**·用户令「四键合并成一栏」）：四键从此**同住一张卡**（`sw2-atmo-card`）
    //   ⇒ 旧判据"往回取到卡片开头"失效（往回退会退到**同一个**卡头，两个自变量两个因变量都命中它）。
    //   ⇒ 定位改按**行**：每一行都有 `data-param-cell="<键>"`（leg46 续·五挂的那一格，**不是新加的钩子**）
    //     —— 用 `data-param-cell` 而非 `data-param`，是因为判据 ④ 明令 `data-param` 只许控件挂。
    //   ★判据的**实质一字未变**：因变量给不给旋钮、自变量给不给旋钮（"两行同卡"不影响这条区分）。
    //   ★定位口径（**前后踩过两次，写死防重犯**）：
    //     ① 不能用"往前找上一个 `<div class="sw2-row`"——自变量那一行**有两格**（`当前`/`设定为`）
    //        ⇒ 从第一格往前找会退到**上一个参数的行头**；
    //     ② 也不能用"先往前找 `data-param-cell=` 再回退到行头"——**同一个键的两格挂着同一个
    //        `data-param-cell="<键>"`** ⇒ 第一次命中在 767、往前一找命中 767 自己、回退到的是**天时那行**，
    //        于是"张力推手"被判成"没有 select"。
    //     ⇒ 定稿（**三次踩坑才收口，别改回去**）：
    //       ① 起点必须用 `lastIndexOf`，锚是**带键名的完整属性串** `data-param-cell="<键>"`
    //          —— 用 `indexOf('<div class="sw2-row', cell)`（**向后**找）会落到**下一个参数的行头**：
    //            实测「民生度」切出的是「乱象」那一行（假绿），而「动乱度」行头在 `cell` **之前**
    //            ⇒ 向后找不到 ⇒ 切出空串（假红）；
    //       ② 锚带键名，`lastIndexOf('data-param-cell=')` 那个更宽的锚才害人（同一键两格会自命中）；
    //       ③ 自变量那一行**跨两格**（`当前` + `设定为`），故整段找 select，不切到下一个行头。
    const atmoSeg = html.slice(html.indexOf('sw2-atmo-card'), html.indexOf('data-action="param-undo"'));
    assert.ok(atmoSeg.length > 0, '四键那一卡的片段应当取得到（锚：sw2-atmo-card → 撤销按钮）');
    for (const key of ['动乱度']) {
        // 因变量是**单行自足**的行（名称/值/依据三段同在一个 `sw2-row` 里）⇒ 取第一行
        const oneRow = paramRowSeg(atmoSeg, key, { firstRowOnly: true });
        assert.ok(oneRow, `因变量「${key}」应当有一行`);
        assert.ok(!oneRow.includes('<select'), `★因变量「${key}」被做成了旋钮（它只该呈现）`);
        assert.ok(oneRow.includes('因变量'), `因变量「${key}」要标明性质`);
    }
    // ③ 自变量（天时/外压）给旋钮
    //    ★leg52：同上改在**四键那一卡**的片段里定位（旧法"往回取到卡片开头"在四键同卡之后已无区分力）；
    //      "自变量"那个小标改由**卡头与卡内折叠**承担（同一张卡里 4 行，逐行标"自变量/因变量"
    //      是把同一件事说四遍）⇒ 断言改成"它必须真有一个带 `data-param` 的 `<select>`"。
    for (const key of ['天时', '张力推手']) {
        const row = paramRowSeg(atmoSeg, key);
        assert.ok(row, `自变量「${key}」应当有一行`);
        assert.ok(row.includes(`data-param="${key}"`) && row.includes('<select'),
            `自变量「${key}」必须有旋钮`);
    }
    // ③c ★★leg52（**真浏览器出图抓出来的回归**，锁死防重犯）：**每个自变量都得有名字**。
    //   病：并卡之前四键各占一张卡、参数名写在**卡头 `<h4>`** 里；并成一张卡之后卡头只剩「世界气氛与条件」，
    //   而那两行本身**从头到尾不提参数名** ⇒ 画面成了「当前 大灾 / 设定为 [大灾▾]」——
    //   **玩家分不清这一行是天时还是时局**。⇒ 补 `.sw2-row.sw2-param-name` 组标题行，并把这条锁上。
    //   ★为什么必须锁"文件名"而不是只锁"卡里有这四个字"：`PARAM_KEYS` 与 `LABELS.env` 到处都在，
    //     只有"**紧贴该键那一行的前面**出现它的显示名"才是"玩家真能读到标签"的证据。
    const DISPLAY = { 天时: '天时', 张力推手: '时局' };   // 面板一律走 LABELS.env，不印引擎键名
    for (const key of ['天时', '张力推手']) {
        // ★`withLabelRow`：组标题行在"当前"那一行**之前**，不带它这条锁就永远咬不到（假红）
        const row = paramRowSeg(atmoSeg, key, { withLabelRow: true });
        assert.ok(row.includes('sw2-param-name'),
            `★自变量「${DISPLAY[key]}」缺组标题行——并卡后玩家会读到"当前 大灾/设定为…"而不知道这是哪一格`);
        assert.ok(row.includes(`sw2-param-name"><b>${DISPLAY[key]}</b>`),
            `★组标题里必须写「${DISPLAY[key]}」（证明玩家真能读到标签，而不只是卡里出现过这几个字）`);
    }
    // ③d 反向：显示名不许漏成引擎键名（`LABELS.env` 是唯一口径）
    assert.ok(!html.includes('sw2-param-name"><b>张力推手</b>'),
        '★组标题不许直接印引擎键名「张力推手」（面板一律走 LABELS.env → 「时局」）');
    // ③b ★leg52：**几格同卡**（旧版是各自独立的卡）——并把"合并 ≠ 混为一谈"锁住。
    //   ★断言口径（**自己踩过一次**）：不许拿键名 `民生度/张力推手` 去找卡片正文——面板一律走
    //     `LABELS.env`（乱象/时局），`民生度` 只出现在**属性**里；要锁的是"卡里真把两种性质
    //     分开说清了"，所以直接锁**那句人话本身**（它同时是"玩家读得到"的证明）。
    //   ★★leg53：改成三格之后，那句人话从「民生 / 乱象 … 只读」变成「引擎每轮算的」+ 对乱象的说明。
    assert.equal((html.match(/sw2-atmo-card/g) || []).length, 1, '★这几格应合并成**一张**「世界气氛与条件」卡');
    assert.ok(html.includes('世界气氛与条件'), '合并后的卡要有名字');
    const atmoCardHtml = html.slice(html.indexOf('sw2-atmo-card'), html.indexOf('</details>', html.indexOf('sw2-atmo-card')));
    assert.ok(/天时 \/ 时局[\s\S]{0,120}你定的条件/.test(atmoCardHtml),
        '★卡内须写明"天时/时局 = 你定的条件"（合并 ≠ 混为一谈）');
    assert.ok(/乱象<\/b>是<b>引擎每轮算的/.test(atmoCardHtml),
        '★卡内须写明"乱象 = 引擎每轮算的"（leg53：它现在真有生产者了，说法必须跟着变）');
    assert.ok(!atmoCardHtml.includes('民生'),
        '★leg53：卡内不许再提民生（那一格已撤——没有生产者，永远「未定」）');
    // ④ ★leg40c 续：**控件之外的元素一律不许挂 `data-param`**
    //   （挂了就会在事件委托里"抢答"，把 undefined 当值提交——这条病刚在用户实机上出过一次）
    for (const m of html.matchAll(/<(\w+)([^>]*data-param="[^"]+"[^>]*)>/g)) {
        const tag = m[1].toUpperCase();
        assert.ok(tag === 'SELECT' || tag === 'BUTTON' || tag === 'INPUT',
            `★<${tag.toLowerCase()}> 上挂了 data-param（只有控件才许挂——否则事件委托会抓到它、读出 undefined）`);
    }

    // ④ 信息面板同款：未定值也**只许出现一次**（旧法 值「未定」+ 同义 chip「未定」= 两次）
    //   ★★leg53：面板格从 4 变 **3**（民生已撤）⇒ 这里同步从 4 改 3
    const band = withoutSelects(renderInfoBandHtml(bare));
    assert.equal(count(band, '未定'), 3, `★信息带未定值重复渲染（3 个格各一次，实际 ${count(band, '未定')} 次）`);
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// leg27 后：用户实机「参数的ui页太丑了，**说明文字太大**，**下拉表刚拉开没多久自己就关了**」
//   ①版式：病的准确名字是"**`.sw2-row` 全仓没有基础规则**"——`renderParamsHtml` 一直在吐
//     `<div class="sw2-row">`（标签/值/说明三段），却只有两个**局部**变体（cold-mgmt 与快照页）
//     ⇒ 参数页上那些行排成裸文本，说明文字还继承面板正文 14px。
//   ②下拉自己关：**这是个真 bug，不是观感**——`set-param` 处理完调 `refreshWorld()`，
//     而它把**每个**页签的 innerHTML 整体换掉 ⇒ 那个 `<select>`（连浏览器已展开的列表）被销毁重建。
//   判据（结构性，不写字面）：**生产代码里改参数后不许整页重绘**（只许 `refreshSections([...])`）。
test('★leg27 后：参数页版式——行有基础规则（flex 三栏）、说明文字比正文小、卡片有行距', () => {
    const css = readFileSync(path.join(ROOT, 'web', 'style.css'), 'utf8');
    // ① `.sw2-row` 必须有**基础规则**（不是只有局部变体）
    assert.match(css, /(^|\n)\.sw2-row\s*\{[^}]*display\s*:\s*flex/, '★`.sw2-row` 必须有基础 flex 规则（旧版只有局部变体 ⇒ 参数页裸文本）');
    // ② 说明文字（.sw2-row > em）必须有**自己的字号**，且小于面板正文（14px）
    const em = /\.sw2-row\s*>\s*em\s*\{([^}]*)\}/.exec(css);
    assert.ok(em, '★`.sw2-row > em` 必须有自己的字号规则（旧版没有任何声明 ⇒ 继承 14px 正文 ⇒「说明文字太大」）');
    const size = Number((/font-size\s*:\s*([\d.]+)px/.exec(em[1]) || [])[1]);
    assert.ok(size > 0 && size < 13, `★说明文字必须明显小于正文（实测 ${size}px，正文 14px）`);
    // ③ 下拉控件字号 ≤ 13px 且声明字体族（否则会掉回浏览器默认字体）
    const sel = /\.sw2-param-select\s*\{([^}]*)\}/.exec(css);
    assert.ok(sel, '下拉规则在位');
    assert.ok(Number((/font-size\s*:\s*([\d.]+)px/.exec(sel[1]) || [])[1]) <= 13, '下拉字号不许大过正文');
    assert.match(sel[1], /font-family/, '下拉要声明字体族（否则掉回浏览器默认字体，与面板不一致）');
});

// ★leg40c 续：这套判据原先用**固定字节切片**（`+ 2600` / `+ 3000`）取 `set-param` 那一段——
//   于是"改了文案/加了注释"就会把断言要看的行挤出窗口 ⇒ **判据假红**（实机踩过：leg40c 续加了
//   一段根因注释，两条旧锁当场红，而代码其实是对的）。⇒ 改成**结构切片**：从动作名切到下一个动作名。
//   判据要看的东西在函数里，不该受注释长短影响。
function setParamSrc(web) {
    // ★★★leg48 修（**判据自己的假红，留档**）：注释里也写着 `bus['set-param']` / `bus['param-undo']`
    //   ⇒ 用 `indexOf` 会切到**注释里那句**上，切出来的片段自然找不到代码里的东西（连红两条）。
    //   治法：先把注释**原地抹成空格**（长度不变 ⇒ 位置不变），再切。
    const code = web.split('\n').map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? ' '.repeat(l.length) : l)).join('\n');
    const start = code.indexOf("bus['set-param']");
    assert.ok(start > 0, '前置：源码里有 set-param 动作');
    // ★★★leg48：这一笔的**实体**（`sw2ApplyParam`）紧跟在 `bus['set-param']` 之后——
    //   "接线判据"必须把两者一起看：动作壳只管"忙闩"，真正的接线在实体里。
    const marker = code.indexOf('async function sw2ApplyParam(', start);
    const next = code.indexOf("bus['", start + 10);
    const end = Math.max(marker > start ? marker : start, next > start ? next : start);
    return code.slice(start, end);
}

test('★leg27 后：改参数**不许整页重绘**（用户实拍「下拉表刚拉开没多久自己就关了」的真因）', () => {
    const web = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    const seg = setParamSrc(web);
    assert.ok(seg.length > 200, '前置：找得到 set-param 动作');
    assert.ok(!/refreshWorld\(/.test(seg), '★set-param 里不许出现 refreshWorld()——它会重建每个页签的 DOM，把正在展开的 <select> 一起销毁（下拉"自己关"的真因）');
    assert.match(seg, /refreshSections\(\[/, '★必须走 refreshSections([...]) 局部重绘（只碰受影响页签）');
    // ★★★leg48 改口径（**用户实机抓到的"第二笔把 9 覆盖回 3"**）：参数页**整块重画**就是那两个真凶之一
    //   ——重画把玩家手底下的 `<select>` 销毁重建 ⇒ 浏览器对新节点补吐一笔带**旧值**的事件
    //   ⇒ 同一格一次点击进两笔、第二笔把玩家的选择覆盖掉。故：**只许重画观棋页**（它没有可交互控件），
    //   参数控件只按真源就地回写（`sw2SetParamControl`）+ 就地改格（`sw2SyncParamCells`）。
    assert.match(seg, /refreshSections\(\['board'\]\)/, '★只许重画观棋页（参数页重画 = 控件被销毁重建 = 第二笔事件的来源）');
    assert.ok(!/refreshSections\(\[[^\]]*'params'/.test(seg), '★★参数页**不许**被整块重画（这一条是"点一次写两次"的根治）');
    assert.match(seg, /sw2SetParamControl\(key\)/, '★控件按真源就地回写（不重建节点）');
    // ★★★leg82：忙闩已随参数族搬进 `web/param-panel.js`，接线层的形状从裸名 `sw2ParamBusy`
    //   改成**受控口** `paramApi.paramBusy()`（交出的是那颗 Map 本体）⇒ 判据跟着符号走。
    //   ★口径**不放宽**：仍锁"`set-param` 这条路上必须有忙闩"（缺它 = 重画补吐的那一笔会被受理）。
    assert.match(seg, /paramBusy\(\)/, '★★同一格"一笔操作"未结束时不许受理重复事件（重画补吐的那一笔）');
    // refreshSections 自身纪律：缺 DOM / 缺世界时静默返回（浏览器可载性与 Node 动态导入都不许炸）
    // ★leg40c 续：这里原来也是**固定字节切片**（+900，注释一长就假红）⇒ 改成结构切片。
    // ★★★leg82：锚点从 `'function refreshSections('` 改成**带行首的** `'\nfunction refreshSections('`
    //   —— 因为 leg82 之后文件里**先**出现了对它的**引用**（`createParamApi({ ..., refreshSections, })`
    //   那一行），裸 `indexOf` 于是命中**引用**而不是**定义** ⇒ 切出来的是别人家的函数体
    //   （实测：切片里连 DOM 守卫都没有 ⇒ 当场红）。行首锚只认定义那一行。
    const fnStart = web.indexOf('\nfunction refreshSections(');
    assert.ok(fnStart > 0, '★锚点必须找得到 `function refreshSections(` 的**定义**（找不到 ⇒ 下面两条测的是空切片）');
    const fnEnd = web.indexOf('\nfunction ', fnStart + 10);
    const fn = web.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 4000);
    assert.match(fn, /typeof document === 'undefined'/, 'refreshSections 必须有 DOM 守卫');
    assert.match(fn, /catch\s*\(/, 'refreshSections 必须吞错（局部重绘失败不该打断落账）');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// leg27 c：用户实机两句「**读秒没变**」「**段也不变**」——两条都要有锁。
// 病的准确名字（我上一版的实现缺陷，如实留档）：
//   进度指示器是**纯事件驱动**的——只在某一段开始/结束时才写状态栏。而一段网络调用是**分钟级**
//   （真账实测单块 59k 字符输入 + ≤16,384 tokens 输出）⇒ 两次事件之间：**秒数不动**（因为"已完成段之和"
//   里没有正在跑的那一段），**段号也不动**（因为下一段的 start 要等这一段 return）。
//   ⇒ 用户看到的"不动的 1/5"与"卡死了"完全同形。治法：①**1 秒心跳**按真实已花时间重写状态栏
//   ②每 30 秒打一行"仍在跑"（让"它活着"有据可查）。
// 判据：注入假计时器**真跑**——心跳必须真的起来、每次都喂**真实已花时间**、stop() 必须真的停。
test('★leg27 c：进度心跳——1 秒一跳喂真实已花时间；stop() 真的停；心跳抛错不许影响抽取', async () => {
    const { extractionProgressHandler } = await import('../web/index.js?progress');
    let clock = 1_000_000;
    const now = () => clock;
    const fakeTimers = [];
    const cleared = [];
    const setTimer = (fn, ms) => { const t = { fn, ms, unref() {} }; fakeTimers.push(t); return t; };
    const clearTimer = (t) => { cleared.push(t); };
    const texts = [];
    const logs = [];
    const events = [];            // ★与真实用法同构：外层累积事件数组，handler 读它算"当前段/已成功段数"
    const h = extractionProgressHandler(events, {
        setText: (t) => texts.push(t), now, setTimer, clearTimer,
        log: (m) => logs.push(String(m)), heartbeatMs: 30000,
    });
    const emit = (ev) => { events.push(ev); h.onEvent(ev); };   // 真实路径：先入账再上报

    // ① 第一段开始 ⇒ 心跳立刻起来（且**立刻出声一次**，不必等 1 秒）
    emit({ step: 'canon', phase: 'start', index: 1, count: 1, chars: 30000 });
    assert.equal(fakeTimers.length, 1, '★第一段开始就必须起心跳（纯事件驱动正是"读秒没变"的病根）');
    assert.equal(fakeTimers[0].ms, 1000, '心跳间隔 = 1 秒');
    assert.equal(texts.length, 1, '开始那一刻就要出声（别让用户干等 1 秒才见字）');
    assert.match(texts[0], /已花 0 秒/, '初始读秒 0 秒');

    // ② 走到 65 秒（这一段还没返回）⇒ 心跳把**真实已花**写出来（旧法这里恒为"已完成段之和 = 0 秒"）
    clock += 65_000;
    fakeTimers[0].fn();
    assert.match(texts[texts.length - 1], /已花 1 分 05 秒/, '★心跳必须喂"真实已花时间"（不是"已完成段之和"）');
    assert.ok(logs.some((m) => m.includes('抽取仍在跑')), '★超过 30 秒必须打一行"仍在跑"（证明"它活着"而非"卡死"）');

    // ③ 第二段开始 ⇒ 不重复起心跳（一个流程一条心跳）；段号随之更新
    emit({ step: 'chunk', phase: 'start', index: 2, count: 5, chars: 60000 });
    assert.equal(fakeTimers.length, 1, '★只许有一条心跳（重复起会攒计时器）');
    assert.match(texts[texts.length - 1], /名册第 2\/5 块/, '段号随事件更新');

    // ④ stop() 必须真的清掉计时器
    h.stop();
    assert.equal(cleared.length, 1, '★stop() 必须真的 clearInterval（否则流程结束后心跳还在改状态栏）');
    assert.equal(h._state().running, false, '停后状态为未运行');
    h.stop();
    assert.equal(cleared.length, 1, '重复 stop 幂等');

    // ⑤ 心跳/上报自身抛错**不许影响抽取**（观测面不能成为故障点）
    const h2 = extractionProgressHandler([], {
        setText: () => { throw new Error('状态栏炸了'); }, now, setTimer, clearTimer, log: () => { throw new Error('控制台炸了'); },
    });
    assert.doesNotThrow(() => h2.onEvent({ step: 'canon', phase: 'start', index: 1, count: 1, chars: 1 }), '★setText 抛错不许冒泡');
    assert.doesNotThrow(() => fakeTimers[fakeTimers.length - 1].fn(), '★心跳 tick 抛错不许冒泡');
    h2.stop();
});

test('★★leg46（口径升级）：set-param 只做接线——三态规则与写入全在 `param-hub`（一处实现、一处判据）', () => {
    // ★本用例的口径沿革（三代，都记着，免得下一任照旧写法再锁一遍实现细节）：
    //   leg40c：锁"无变化时若还有没落盘的写就补落一次盘"（真源住世界账时逼出来的）；
    //   leg41：锁"按字符串比 + 闸在受控编辑之前 + 空值不当删除命令"——但它锁的是**本文件里的实现**；
    //   leg46（重构后）：那三条的**判定**已经搬进 `src/param-hub.js`（一处实现）⇒ 本文件只该锁
    //     "接线有没有把话带到"。★漏掉这一格的代价（本仓最贵的一课）：同一语义在两处各判一遍，
    //     改动时两处一起漂——判据全绿而实机全败。
    const web = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    const seg = setParamSrc(web);
    assert.ok(seg.length > 200, '前置：找得到 set-param 动作');
    // ① 判定与写入都交给 hub（唯一写入口）
    //   ★★★leg48 升级：接线层交给 hub 的**不再是"世界对象"**，而是"世界（或世界名）+ 键 + 值"——
    //     因为"世界对象拿不到"曾经等于"一个字都不写"（用户报了十二轮的那条症状）。
    //   ★★★leg82：写入口现在藏在**受控口**后面（`paramApi.set/clear`，真定义在 `web/param-panel.js`
    //     的 hub 装配那一格）⇒ 锚点跟着符号走。口径**不放宽**：仍锁"**世界（或世界名）+ 键 + 值**
    //     一起交给 hub"这个**形状**（不是"文件里出现过 paramApi.set"那种松口径）。
    assert.match(seg, /paramApi\.(set|clear)\(key2, key(, value)?\)/, '★set-param 必须把"世界（或世界名）+ 键 + 值"整体交给 hub');
    // ★★★leg48：**"手滑到空"与"明确清空"在接线层分开**（下拉里的空串 = 玩家明确选了「未定」）
    assert.match(seg, /fromUnsetOption/, '★必须判"这一笔是不是明确选了未定"（不分 ⇒ 空值会被当成清空命令，删掉玩家的档位）');
    assert.match(seg, /paramApi\.clear\(/, '★明确清空走 hub 的显式通道');
    // ★★★leg48：**世界对象拿不到时要出声**（旧版这条路上一个字都不说 ⇒ 十二轮不可见）
    assert.match(seg, /拿不到世界对象/, '★拿不到世界对象必须留痕（不许沉默）');
    // ★★★leg48：一笔结束之后**控件按真源对齐**（"手滑到空"不许留在屏幕上冒充一次改动）
    assert.match(seg, /sw2SetParamControl\(key\)/, '★控件必须按真源对齐（否则控件空着、格写「未定」、刷新回默认）');
    // ② 状态条 = hub 的原话（接线层不许另写一套"说得比做的好听"的口径）
    assert.match(seg, /setStatus\(`\$\{r\.humanLine\}/, '★状态条照抄 hub 的 humanLine（真实口径只有一处）');
    assert.match(seg, /r\.kind === 'noop-empty'/, '★"本来就是未定"那一下要如实出声（滚轮病灶）');
    assert.match(seg, /r\.kind === 'unchanged'/, '★"值没变"也要出声（"点了没反应"是原始抱怨）');
    // ③ 镜像那份要落进聊天账（引擎读的是世界账里的镜像）
    assert.match(seg, /r\.changed && r\.mirror\?\.world/, '★真值变了才落账（无变化不许白写一次世界）');
    assert.match(seg, /writeHotMeta\(hotAccountShape\(r\.mirror\.world\)\)/, '★镜像是接线层落账的，hub 不碰聊天账');
    // ④ 三态规则的**实现**不许再回到本文件里（判据在 param-hub.test.js ⑧ 逐条锁行为）
    assert.ok(!/normalizeStoreValue\(/.test(seg), '★归一（合法/清空/非法三态）只许在 hub 里做');
    // ★"碰存储"的判据要判**写**，不是判"出现过 localStorage 这个词"——
    //   `set-param` 里那句是**读**（`loadHotAccount(readHotMeta())` 取当下的世界），不是写。
    //   （判据自己踩过：第一版写 `/localStorage/` ⇒ 假红。本仓的老毛病：词面代替语义。）
    assert.ok(!/(localStorage|extensionSettings)\s*\.\s*setItem|setItem\s*\(/.test(seg), '★本文件不许直接写真源（写入口只许一个）');
});

test('★leg27 c：滚轮不许改档位（`<select>` 滚过就改值是老坑，正是"打开就弹"的来路之一）', () => {
    const web = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    // ★★leg87 勘正：这里原先是 `先读 3000 字符`的**写死窗口**，而 leg87 在 `onField` 里加了
    //   数字设置那一格（超时/输出上限的校验与如实出声）⇒ 函数体变长、`addEventListener('wheel'`
    //   被挤出窗口 ⇒ **假红**（拦轮那三行一个字都没动，见下面那条反向自证）。
    //   ⇒ 口径改成"切到函数体真正结束"（与 `retired-controls.test.js` 那条 `lookupOneEntity`
    //     的切法同一形状：**锚在内容上，不锚字符数**——写死长度就是一种"锚在行号上"）。
    const from = web.indexOf('function bindSettingsForm(');
    const nextFn = web.indexOf('\nfunction ', from + 10);
    const seg = web.slice(from, nextFn > 0 ? nextFn : undefined);
    assert.ok(seg.length > 500, '★前置：切到了真的函数体（切空了下面几条就是空绿）');
    assert.match(seg, /addEventListener\('wheel'/, '★必须挂 wheel 拦截');
    assert.match(seg, /preventDefault\(\)/, '★必须真的 preventDefault（否则等于没拦）');
    assert.match(seg, /passive:\s*false/, '★必须 passive:false（被动监听里 preventDefault 无效）');
    assert.match(seg, /tagName === 'SELECT'/, '只拦下拉，别把面板滚动一起拦掉');
    // 键盘/点击不受影响（那才是"玩家的手"）：不许拦 keydown/click
    assert.ok(!/addEventListener\('(keydown|click)',[\s\S]{0,120}preventDefault/.test(seg), '★不许顺手拦掉键盘/点击（键盘改档是正当操作）');
});

// leg25 f：实体页的 markup 是**模板字符串折行拼出来的**，标签之间可能有换行/缩进 ⇒
//   断言如果直接写死相邻标签，会因为源码折行的位置变化而假红（实测踩过两次）。
//   这个助手把"空白"折成"可有可无"：`has(html, '>实力<b>未查</b>')` 能命中 `>\n  <b>未查</b>`。
const has = (html, snippet) => new RegExp(
    snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'),
).test(html);

// 产物计数小工具（Task 5 评审修正 #5 起：分组真数要逐组核，见"组头带真数"那条）
function count(s, needle) { return s.split(needle).length - 1; }
// 从实体页产物里切出**列表体**（分组时切到第一段 `</div></details>` 为止——这样"未知 grp 与 none 同形"
// 这条断言比的是同一段东西：两者都不含 `</div></details>` ⇒ 整段原样比较）。
function bodyOf(html) {
    let b = html.slice(html.indexOf('<div class="sw2-entity-list">'));
    const end = b.indexOf('</div></details>');
    return end === -1 ? b : b.slice(0, end);
}

function world() {
    const w = JSON.parse(readFileSync(path.join(ROOT, 'test', 'fixtures', 'live-world.json'), 'utf8'));
    w.context.playerId = 'e_player';
    // leg25 c：实体不再带 `attrs`（四维浮点已删，ssot.schema 的 additional:false 也不再接受该键）。
    w.entities.push({ id: 'e_player', kind: 'character', name: '黄坤', location: '黄府' });
    w.context.setting = {
        frozen: {
            fingerprint: 'fnv1a_9f31x_12044',
            extractedAt: '2026-09-08T10:00:00Z',
            canon: {
                powerScale: [{ level: '炼气', note: '修士，江湖底子（原文）' }, { level: '元婴', note: '大宗，可开宗立派（原文）' }],
                rules: ['煞气须以灵脉镇压', '契书为王'],
                society: '官军辖江州，坊市共治',
                techOrMagic: '灵脉与煞气相生相克',
                historyNotes: ['太岁陨落北山', '洗煞阵立'],
            },
        },
        dynamic: {
            tension: { polarity: '大虞/万法阁', direction: '大虞偏将压万法阁', intensity: 0.72 },
            env: { 民生度: '艰难', 动乱度: '动荡', 天时: '大灾', 张力推手: '紧绷' },
            derivedFrom: ['浪尖:a_xie@31', '浪尖:a_dayu@44'],
        },
    };
    w.weights.e_player = 0.18;
    w.meta = { tick: 47 };
    w.milestones = [{ id: 'm_30', span: [0, 30], counts: 8, titles: ['发兵催战', '民生凋敝'], ids: ['ev_0', 'ev_15_1'] }];
    w.entities.find((e) => e.id === 'e_player').lastActiveTick = 45;
    w.chronicle.push(
        { id: 'ch_44_1', tick: 44, text: '大虞偏将派帐下偏校赴黄府，递交灵脉地契的割约。', eventRef: 'ev_44_1' },
        { id: 'ch_46_1', tick: 46, text: '薛铁衣杀局推进：大军压至大盘谷口。', eventRef: '' },
        { id: 'ch_47_1', tick: 47, text: '劳役征发——大虞偏将征调坊市丁壮。', eventRef: 'ev_pump_47_1' },
    );
    return w;
}

// ★leg40b（体检）：夹具的 `playerDesc` 原来是「我名黄坤，炼气九层。」——**它让一条锁失效了**：
//   `settings` 那一格会把 `playerDesc` 原样渲染进设置页，而"玩家可见文本零禁词"的全量扫描
//   扫的正是这份夹具 ⇒ **玩家真写一段描述时会被带出来的词，夹具里一个都没有**。
//   实测抓到的病灶：设置页那句「世界从中摘你的底子（**兵力/权位/人脉/耳目**）」——
//   那四个概念在 leg25 c 已按用户令整条删除，却因为夹具描述不含这四个词而**年年绿灯**。
// ★★leg87（用户令「A 删了」）：`playerDesc` **已随那张「你的开档描述」卡一起撤**（写进 `meta.playerDesc`
//   全仓零处读；四维解析那一族 leg25 c 已整条删除）⇒ 夹具里那个键**删掉**，并改由
//   `test/retired-controls.test.js` 的登记表做**双面锁**（产物面 + 源码串面），比散在这几条里更结实。
//   ★下面那条 leg40b 的四维锁**一个字节都没放松**：它扫的是"设置页自己的文案"，夹具描述撤了之后
//     判据从"界面文案 vs 夹具描述"改成"界面文案零四维"，见该条的新注（原锁的意图：界面不许承诺四维）。
const CONFIG = { baseUrl: 'https://gcli.ggchan.dev/v1', apiKey: 'k', model: 'gemini-3.1-pro-preview' };
const VOLUMES = [{ id: '卷一', info: '第 1–500 轮 · 512KB · 收在插件本地' }];

test('K33/A-2：同输入两次 renderAll 逐字节一致（纯函数锁）；参数面（config/oldVolumes）也在锁内', () => {
    const a = JSON.stringify(renderAll(world(), { config: CONFIG, oldVolumes: VOLUMES }));
    const b = JSON.stringify(renderAll(world(), { config: CONFIG, oldVolumes: VOLUMES }));
    assert.equal(a, b);
});

const textOnly = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
// ★★leg99：**剥掉下拉**（`<select>…</select>` 整块）——下拉里的选项文本**是控件本身**、不算"呈现"。
//   原来是 `leg26 c` 里的局部助手；`leg52·E` 那条判据也要用它（"上限那行不许再印一遍那个数"）
//   ⇒ 提到模块级，**只留一份实现**（本仓"同一口径不许两处实现"）。
const withoutSelects = (s) => String(s).replace(/<select[\s\S]*?<\/select>/g, '');
// ★★leg52：**参数行的定位助手**（三条锁共用一份实现 —— 本仓"同一口径不许两处实现"）。
//   三处踩坑换来的口径，写死在这里，别在调用点各写一遍：
//     ① 锚必须是**带键名的完整属性串** `data-param-cell="<键>"`（宽锚 `data-param-cell=` 会自命中）；
//     ② 行头必须用 `lastIndexOf`（向后 `indexOf` 会落到**下一个参数的行头**：
//        「民生度」会切出「乱象」那一行 = 假绿，而「动乱度」的行头在锚之前 ⇒ 切出空串 = 假红）；
//     ③ 自变量那一行**跨两格**（`当前` + `设定为`，两格都挂同一个键）⇒ 不可切到"下一个行头"，
//        只有因变量那种**单行自足**的行才可以切。
//   ★leg52 续：`withLabelRow` —— 自变量的**组标题行**（`.sw2-param-name`）在"当前"那一行**之前**，
//     默认切法切不到它。要判"玩家能不能读到标签"就必须把边界**再往前挪一行**
//     （照本仓"判据要咬玩家真能看到的东西"的口径）。
// ★★★leg99（用户令「没必要每个参数还要显示当前是什么，当前是什么值就是下拉栏的值」）：
//   **有控件的那几行不再印值格**（`data-param-cell`）⇒ 那个锚对它们**不存在了**。
//   ⇒ 这里加一条**受控的退路**：值格找不到时，改锚**控件自己**（`data-param="<键>"`）。
//   ★为什么退路是受控的：①先试值格（因变量只有它）②再试控件（自变量/尺度上限）③都没有 ⇒ 返回空串
//     ——**不猜、不退回"随便找一个行头"**（那正是本助手前三次踩坑的错法）。
//   ★口径一字未变：它要切的仍是"**这个键那一行**"，只是锚从"值的家"换成"控件的家"。
export const paramRowSeg = (htmlSrc, key, { firstRowOnly = false, withLabelRow = false } = {}) => {
    const src = String(htmlSrc);
    // ① 值的家（因变量行；leg99 之后自变量/上限行没有它了）
    let cell = src.indexOf(`data-param-cell="${key}"`);
    // ② 控件的家（自变量/上限行都挂在控件上——`data-param` 只许控件挂，见判据 ④）
    if (cell < 0) cell = src.indexOf(`data-action="set-param" data-param="${key}"`);
    if (cell < 0) return '';
    let start = src.lastIndexOf('<div class="sw2-row', cell);
    if (start < 0) return '';
    if (withLabelRow) {
        const before = src.lastIndexOf('<div class="sw2-row', start - 1);
        if (before >= 0 && src.slice(before, start).includes('sw2-param-name')) start = before;
    }
    const rest = src.slice(start);
    if (!firstRowOnly) return rest;
    const next = rest.indexOf('<div class="sw2-row', 1);
    return next < 0 ? rest : rest.slice(0, next);
};
function deepStrings(o, acc = []) {
    if (typeof o === 'string') acc.push(o);
    else if (Array.isArray(o)) for (const v of o) deepStrings(v, acc);
    else if (o && typeof o === 'object') for (const k of Object.keys(o)) deepStrings(o[k], acc);
    return acc;
}

test('K33/A-3：六页签玩家可见文本零引擎术语（黑名单；标签/属性/字段名/悬停 title 不属玩家视线）', () => {
    const all = renderAll(world(), { config: CONFIG, oldVolumes: VOLUMES });
    const text = deepStrings(all).map(textOnly).join('\n');
    for (const term of BLACKLIST) {
        assert.ok(!text.includes(term), `玩家可见文本含禁词「${term}」`);
    }
    assert.ok(text.includes('盘算')); // 玩家通词放行（共识样例 v3）
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// ★leg32（用户实机「盘算并没有变多甚至一点变化都没有」追出来的真缺陷）：
//   世界变宽那次把 `AGENDA_CAPS.topLevel` 5 → 10，**面板上的分母却是写死的 `/5`**——
//   于是"世界真的变宽了"与"面板还写着 5"同时成立，玩家**无法从面板判断任何变宽实验是否奏效**。
//   这不是观感问题，是**同一个数字有了两个真源**（引擎一份、面板一份），而面板那份永远不会自己更新。
//   判据写成**关系式**（不钉字面）：面板上的分母必须 = 引擎真源的值，引擎改到哪它就跟到哪。
test('★leg32：面板分母不再写死——/15 与顶层 /N 都读引擎真源（防"改了引擎面板不变"）', () => {
    const { infoband } = renderBoardHtml(world());
    // ★leg98：这一格的**标签**从 `div` 改成了 `span`（它现在住在读数区的一行里，与左边的小标签同一行）
    //   ⇒ 判据按**关系式**取数（本条的口径本来就是"分母必须 = 引擎真源"，与标签名无关）⇒ 放宽到不挑标签。
    const openCap = (infoband.match(/<[a-z]+ class="sw2-big-num">\d+<small>\/(\d+)<\/small>/) || [])[1];
    const topCap = (infoband.match(/顶层 \d+\/(\d+)/) || [])[1];
    assert.equal(Number(openCap), AGENDA_CAPS.open, `在飞分母应 = AGENDA_CAPS.open(${AGENDA_CAPS.open})，实际 ${openCap}`);
    assert.equal(Number(topCap), AGENDA_CAPS.topLevel, `顶层分母应 = AGENDA_CAPS.topLevel(${AGENDA_CAPS.topLevel})，实际 ${topCap}`);
});

// ★★leg40b 续（**口径升级**·用户令「能不能直接把这些闸门参数直接放进参数页？」→ 拍板"甲+乙档全开"）：
//   这条锁**原本锁的是"只读、无旋钮、不落 dynamic.env"**——那条口径**已被本次改动取代**，
//   故照本仓规矩（口径变了就升级锁 + 加"旧措辞不得回潮"的守门），把判据换成**新契约四条**：
//     ① 四个上限**都在页上**（还是与引擎真源同源，不钉死字面数）；② 每个都**真做成可调控件**；
//     ③ 控件上的值**逐项来自引擎真源**（面板造不出引擎不认的东西——UI 与判据同源）；
//     ④ **`pack`/`sweep` 那两个"引擎自己的账"**（每轮新生盘算、入局新人）**仍然只读**（不许顺手全开）。
// ★★★leg54 再升级（用户令「**把调数字的框直接变成输入框或者无上限**」→ 拍板「真无上限」）：
//     ②③ 的**形状换了**——从"档位下拉 + 选项逐项等于白名单"改成"**数字输入框 + 任意 ≥1 的整数**"。
//     判据的**实质保住**：这些数仍然是**可调**的、仍然**与引擎真源同源**、仍然**每个键恰一个框**
//     （个数不再写死字面量，而是 `LIMIT_KEYS.length`——★leg63 从四个变五个时，正是这条判据
//      在**计数**上先红、另外两条在"只读清单"上先红，三条一起把改动面圈了出来）。
//     ★旧口径里"面板不许造出引擎不认的值"这一条**随白名单一起作废**（引擎现在什么都认）——
//       取而代之的新守门是"**控件是数字输入框且带 min=1**"（读不懂的值仍然进不去）。
test('★leg40b 续 + leg54 + leg63：参数页把世界尺度做成**七个可调输入框**（旧"档位下拉"口径已升级）', () => {
    const html = renderParamsHtml(world());
    const seg = html.slice(html.indexOf('sw2-cap-card'));
    assert.ok(seg, '参数页应有世界尺度块（sw2-cap-card）');
    // ① 五个上限都在（键名 = limits.js 的真源，不是抄来的字面）
    for (const k of LIMIT_KEYS) {
        assert.ok(seg.includes(`data-param="${k}"`), `上限「${k}」应做成可写参数`);
        assert.ok(seg.includes(String(LIMIT_DEFAULTS[k])), `上限「${k}」的当前值 ${LIMIT_DEFAULTS[k]} 应上板`);
    }
    // ② 每个都是**数字输入框**（不是只读文本，也不再是下拉）
    const inputs = seg.match(/<input[^>]*type="number"[^>]*data-action="set-param"[^>]*>/g) || [];
    assert.equal(inputs.length, LIMIT_KEYS.length, `应有 ${LIMIT_KEYS.length} 个上限输入框，实际 ${inputs.length}`);
    assert.ok(!/<select[^>]*data-action="set-param"[^>]*>/.test(seg), '★上限那一栏不许再有下拉（无上限装不进选项表）');
    for (const tag of inputs) {
        assert.match(tag, /min="1"/, '★必须有 min="1"（代码跑得起来的最小校验：条数不能是 0）');
        assert.match(tag, /step="1"/, '★必须 step="1"（整数：半件事没有意义）');
    }
    // ③ 控件上的值 = 引擎真源那份（面板画的就是引擎读的）
    for (const k of LIMIT_KEYS) {
        const i = seg.indexOf(`data-param="${k}"`);
        const tag = seg.slice(seg.lastIndexOf('<input', i), seg.indexOf('>', i));
        assert.match(tag, new RegExp(`value="${LIMIT_DEFAULTS[k]}"`), `「${k}」的控件值应 = 出厂默认`);
        assert.ok(seg.slice(i).includes(String(LIMIT_DEFAULTS[k])), `「${k}」的当前值应上板`);
    }
    // ④ ★★★leg63：**「每轮新生」「每轮入局」「待启用名单」都给了旋钮**——
    //   用户报「我参数都这样了」（新生那道闸读常量）与「我要把另外两个参数也设置成可调」。
    //   本条判据**反向锁**：三个都必须在（画了框 + 与引擎真源同源）。
    for (const k of ['每轮新生', '每轮入局', '待启用名单']) {
        assert.ok(seg.includes(`data-param="${k}"`), `★leg63：「${k}」必须做成可写参数（不再是只读的固定闸）`);
    }
    // ★这一栏现在**七个框全是可调的** ⇒ 原来那折"还有两个数不给拧"整段撤掉（留着会说反话）
    assert.ok(!seg.includes('不给拧'), '★没有任何"不给拧"的数了（七个框全可调）');
});

test('★★★leg54：**"无上限"必须写在脸上 + 后果如实说**（填大了会以什么形式表现出来）', () => {
    // ★这条判据的**存在理由**：无上限是用户要的，而它有一个不直观的后果——
    //   **填得很大不会凭空多出事情**（一轮里发生几件，是模型自己决定的；它一次回复能写多长才是真天花板）。
    //   不把这句话写在页上，玩家会以为"填 100 却只长了 3 件"＝插件坏了。
    const html = renderParamsHtml(world(), { config: {} });
    const cap = html.slice(html.indexOf('sw2-cap-card'));
    assert.ok(cap.includes('没有上限'), '★"没有上限"必须写在页上（用户要的就是它）');
    // ★leg63 换措辞：这一条仍然守"后果如实说"，但措辞改成人话（原句"不会凭空多出事情/模型自己决定"
    //   在 leg63 重写这一折时被合并成下面这两句——判据跟着**实质**走，不跟着旧字面走）。
    assert.match(cap, /不是<\/b>"填多少就长多少"/, '★必须说清"填大不会凭空多出事情"（换措辞后仍守这一条）');
    assert.match(cap, /模型一轮只写得出那么多/, '★必须点名真正的天花板在哪（模型一次能写多长）');
    assert.match(cap, /本轮裁定/, '★必须告诉玩家"被拒时去哪看"（否则那是一次静默的失败）');
    // ★★leg63 新增面：用户当场问「这个会相互掩盖是什么意思」⇒ 页上必须把这个词讲成人话
    assert.match(cap, /这就是"互相掩盖"/, '★"互相掩盖"必须在页上被解释（用户问过）');
    assert.match(cap, /依次<\/b>判的/, '★解释要给机理：三道是依次判的');
    assert.match(cap, /一起抬/, '★解释要给出行动：哪两个框要一起抬');
    // ★★leg63（格式纪律，被自己的判据抓过三次）：`LIMIT_META.hint` 是**纯文本**、经 escapeHtml 上板
    //   ⇒ 里面不许有 `<b>`（会印成字面的 &lt;b&gt;）、也不许有 markdown `**`（会印出星号）。
    //   这里把"折起来的那一栏"扫一遍——那是 hint 唯一上板的地方。
    const hintFold = cap.slice(cap.indexOf('每个上限各是什么意思'));
    assert.ok(!hintFold.includes('&lt;b&gt;'), '★hint 里不许有 <b>（经 escapeHtml 会印成字面标签）');
    assert.ok(!hintFold.includes('**'), '★hint 里不许有 markdown 星号');
    // ★★leg63：这一卡的文案是**手写 HTML 字符串**，而本仓为"markdown 星号写进 HTML"栽过两次
    //   （leg60 一次、leg63 这一次——`**不是产量旋钮**` 与 `**依次**判的` 都是我当场写错、被这条抓住的）。
    //   全页扫一遍：`capCard` 里只有注释会出现 `**`，而**注释不进产物** ⇒ 产物里一个都不该有。
    assert.ok(!cap.includes('**'), '★世界尺度那一卡的产物不许含 markdown 星号（面板是 HTML）');
    // 用户问过"四个框"，现在必须是七个——文案里的数要跟着键表走，不许留旧字面
    assert.match(cap, /七个框都能/, '★"七个框"（leg63 起全部转正）');
    // ★"常用"那串是**建议值**（`LIMIT_GEARS` 降级后的用途），不是白名单——它得在页上
    assert.match(cap, /常用：/, '★建议值仍要给（玩家不知道该填几）');
    for (const g of LIMIT_GEARS['每轮递线']) assert.ok(cap.includes(String(g)), `建议值 ${g} 应在页上`);
});

test('K33+leg21 观棋·时局句与信息带：时局句只领世情（无世情=未聚，不混张力）；张力归张力行；参数档位如实列出', () => {
    const { digest, infoband } = renderBoardHtml(world());
    assert.match(digest, /大势未聚，各方各走各的路/);   // leg21：本世界无 situation → 时局句不再拼张力
    assert.ok(!digest.includes('大虞/万法阁'), '张力极不入时局句');
    assert.ok(!digest.includes('强度'), '强度数字不入时局句');
    // leg26：参数是**玩家/书定的档位原话**，引擎零表态——时局句如实列出来，不再说"越界的处境"
    // ★★leg53（口径升级）：面板格从四变三（民生撤下）⇒ 时局句里也不再报民生。
    //   ★注意 `（另 N 项未定）` 那一截：剩下 3 格里天时/时局定了、乱象定了 ⇒ 0 项未定，故不出现。
    assert.match(digest, /参数：乱象动荡、天时大灾、时局紧绷。/);
    assert.ok(!digest.includes('民生'), '★leg53：时局句里也不许再报民生（那一格已撤）');
    assert.match(digest, /各方正谋划 3 件事，其中 1 件在暗处。/);
    assert.ok(!/sw2-env-name">民生</.test(infoband), '★leg53：信息带里也不许再有「民生」那一格');
    assert.match(infoband, /sw2-env-name">乱象</);
    assert.match(infoband, /sw2-env-val">动荡</, '档位原话上板（不是 0.44 这种数）');
    assert.ok(!/sw2-danger/.test(infoband), 'leg26 撤销「危险带」判态——档位没有好坏，引擎不评价');
    assert.match(infoband, /大虞\/万法阁/);                       // 张力极在张力行（三件套不丢）
    // leg25 b（A1b）：张力行由「强度百分比」改说「近 N 轮事件数」（那个 % 实测只反映事件密度）
    assert.match(infoband, /近10轮事件 0 件/);                    // 本夹具 events 为空 → 0 件
    assert.ok(!infoband.includes('>72<'), '推导出的强度数字不再上面板');
    assert.match(infoband, /逼黄坤入洗煞之局（第32轮）/);         // 浪尖 → 盘算目标（id 不透传）
    assert.match(infoband, new RegExp(`<[a-z]+ class="sw2-big-num">3<small>/${AGENDA_CAPS.open}</small>`));
});

test('leg20 世情句领大势：situation 进时局句**与说书那四层顶上那一格**（原文措辞；拼装增量保留）', () => {
    // ★★leg98 改口径（用户令「**里面有两个大势卡片留一个就好了**」）：**带里的「大势」格撤下**——
    //   它与说书四层顶上那格是**同一句话**（`canon.situation` 原文照印）。
    //   照 leg97 裁 `digest` 的同一条口径：**同一件事不说两遍，留"书的原文"那一份**。
    //   ⇒ 这条旧断言 `infoband.match(/大虞兵压江州…/)` 指的是**已经撤掉的那一格**；
    //     现在钉的是同一条事实的**新家**（四层顶上），并**反过来**钉住"带里不许再印它"。
    const w = world();
    w.context.setting.frozen.canon.situation = '大虞兵压江州，坊市暗流涌动';
    const { digest, infoband } = renderBoardHtml(w);
    const { panorama } = renderAll(w, { config: {} });
    assert.match(digest, /大虞兵压江州，坊市暗流涌动/);
    assert.match(panorama, /大虞兵压江州，坊市暗流涌动/, '★大势句的新家＝说书四层顶上那一格（原文照印）');
    assert.ok(!infoband.includes('大虞兵压江州'), '★带里不许再印一次（同一句话不说两遍）');
    assert.match(infoband, /大虞\/万法阁/);   // 张力极性仍在（三件套不丢）
    const bare = { version: 1, context: { world: 'x', tension: 0.5, positions: ['x'] }, entities: [], weights: {}, agendas: [], events: [], chronicle: [], meta: { tick: 0 } };
    assert.match(renderBoardHtml(bare).digest, /大势未聚/);   // 无世情无极性 → 原回退语义不变
    // ★缺世情时，四层顶上那格要**如实标注**（不许编一句大势）——leg97 就定的口径，这里顺带咬住。
    //   ★★前置条件（本棒当场踩到的）：`renderPanoramaHtml` 在**一件事都没有**时走**空态**
    //     （"还没长出可讲的事"）⇒ 根本走不到四层那儿。所以这里必须**先给一件真事**，
    //     否则这条断言是**空绿**（实测：不给事 ⇒ 断言红，因为空态里当然没有那句话）。
    const wBare = { ...bare, events: [{ id: 'ev_1_1', title: '某处生变', source: { type: 'state' }, position: 'x', ripples: [], links: {}, closed: false }] };
    assert.match(renderAll(wBare, { config: {} }).panorama, /这本账没留大势句/, '★缺大势句要如实标注（不许编一句）');
});

test('K33 观棋·无设定池回退：大势未聚 + 无盘算空态', () => {
    const bare = { version: 1, context: { world: 'x', tension: 0.5, positions: ['x'] }, entities: [], weights: {}, agendas: [], events: [], chronicle: [], meta: { tick: 0 } };
    const html = renderBoardHtml(bare);
    assert.match(html.digest, /大势未聚/);
    assert.match(html.digest, /没有在办的谋划/);
    assert.match(html.agendaStrip, /sw2-agenda-empty/);
});

test('K33 观棋·动态流：倒序 + 最新徽 + 引擎 id 只进 title 悬停 + 归档提示条', () => {
    const feed = renderBoardHtml(world()).feed;
    assert.ok(feed.indexOf('第47轮') < feed.indexOf('第44轮'));   // 最新在上
    assert.match(feed, /sw2-now">最新</);
    assert.match(feed, /title="ev_pump_47_1"/);                   // id 悬停
    assert.equal(feed.split('ev_pump_47_1').length - 1, 1);       // 且只出现这一次（仅悬停，不在可见文本）
    assert.match(feed, /已收进大事纪「发兵催战、民生凋敝」/);
    assert.match(feed, /data-view="archive"/);
});

test('K33/leg24 片5 观棋·各归何处速览：事实标记（在办/据）取代影响力分数条 / 暗徽 / 你的棋子 / 已灭实体过滤', () => {
    const w = world();
    w.weights.e_xie = 0.87975;   // 账上仍留着旧的分量缓存——界面**不许再显示它**（那个数引擎已不消费）
    const side = renderBoardHtml(w).side;
    // ★leg25 f 版式重做：侧栏由"一实体一卡"改为**按处聚合**（位置当分组键），名号改为组内 chip。
    assert.match(side, /sw2-locchip[^>]*>薛铁衣</, '名号仍在速览里（改由地点组内的 chip 呈现）');
    assert.ok(!side.includes('sw2-wval'), '片5：影响力分数条已撤（分数不参与决策，不摆给玩家看）');
    assert.ok(!side.includes('sw2-weight-row'), '整行影响力组件下架');
    // leg25 c：原「有据 n/4 / 数值无据」徽章随四维删除——"有几维有据"这个说法已失去所指。
    //   注：旧版这一行靠 sw2-ev-mark，本轮聚合式改版后该组件不再出现在侧栏（在办改为 chip 上的忙态）。
    assert.ok(!/有据\s*\d\s*\/\s*4/.test(side) && !side.includes('数值无据'),
        'leg25 c：「有据 n/4 / 数值无据」不再出现（四维不存在，无从谈"几维有据"）');
    // ★本次变更核心意图锁：旧的四维属性名不得以任何形式出现在玩家视线面
    for (const term of ['兵力', '权位', '人脉', '耳目']) {
        assert.ok(!side.includes(term), `位置速览页不得再出现旧属性名「${term}」`);
    }
    assert.match(side, /sw2-locchip-me/, '玩家棋子在自己的地点组里被标出（sw2-locchip-me）');
    w.entities.push({ id: 'e_dead', kind: 'faction', name: '覆灭阁', location: 'x', status: 'dead' });
    assert.ok(!renderBoardHtml(w).side.includes('覆灭阁'), '已灭实体不进速览（沿用旧口径）');
});

test('leg25 f：各归何处速览——**按处聚合**且「位置未载」单列一筐（未载 ≠ 在别处）', () => {
    // 用户 2026-09-11 定案的交互口径：位置是**呈现**，不是筛选；聚合不许把未载的挤掉。
    const w = world();
    w.entities.forEach((e, i) => { e.location = i % 2 === 0 ? '江州' : '未明'; });
    const side = renderBoardHtml(w).side;
    assert.match(side, /sw2-locgroup-name">江州</, '有处可循的按地点成组');
    assert.match(side, /江州<[\s\S]{0,120}?sw2-locgroup-n">\d+ 人</, '组头给人数（一眼看出聚落规模）');
    assert.match(side, /sw2-locgroup-unknown/, '★「位置未载」单列一筐（不被聚合挤掉）');
    assert.match(side, /位置未载[\s\S]{0,200}?书里没写/, '★并如实说明"书里没写"（未载 ≠ 在别处）');
    // 未载那批的名号必须真的在里面（不是只画个筐）
    const unknownBlock = side.split('sw2-locgroup-unknown')[1] || '';
    assert.ok(unknownBlock.includes('覆灭阁') || unknownBlock.includes('黄坤') || /\d+ 人/.test(unknownBlock),
        '未载筐里有真内容');
    assert.ok(!side.includes('<div class="sw2-entity'), '★旧的"一实体一卡"形态已撤（563 张卡 → 按处聚合）');
});

test('leg25 g：位置展示收成**一个入口「地图」**——默认收起、内容仍在、一屏只占一行', () => {
    // 用户 2026-09-11 实机复验后拍板：「有是有但是太拥挤了，收缩到一个入口内，就叫地图吧，
    //   这就是个暂时的展示功能」。上一棒已把 563 张卡压成 21 组，但整片铺开仍占满视线。
    // 这条锁三件事：①入口存在且叫「地图」；②**默认是收起的**；③折叠≠删除（内容与口径文案都还在）。
    const w = world();
    w.entities.forEach((e, i) => { e.location = i % 2 === 0 ? '江州' : '未明'; });
    const side = renderBoardHtml(w).side;
    assert.match(side, /<details class="sw2-map-details">/, '★位置展示收进 details（原生折叠，不新增 JS 状态）');
    assert.equal((side.match(/sw2-map-details/g) || []).length, 1, '★只有一个入口（不许一实体/一地点一个入口）');
    assert.match(side, /sw2-map-title">地图</, '★入口就叫「地图」（用户原话）');
    // ② 默认收起：开口标签上不许有 open 属性
    const openTag = (side.match(/<details class="sw2-map-details"[^>]*>/) || [''])[0];
    assert.ok(openTag && !/\bopen\b/.test(openTag), '★默认收起（没点开时不铺满侧栏）');
    // 开口摘要一行报数：不点开也知道有多少处 / 多少人 / 多少未载
    assert.match(side, /sw2-map-brief">[\s\S]{0,60}?人有处可循/, '开口摘要给"有处可循"人数');
    assert.match(side, /sw2-map-brief">[\s\S]{0,80}?未载 \d+ 人/, '开口摘要给"未载"人数');
    // ③ 折叠≠删除：地点组、未载筐、以及「未载 ≠ 在别处」的口径文案都得还在 details 里
    const inner = side.split('<details class="sw2-map-details">')[1] || '';
    assert.match(inner, /sw2-locgroup-name">江州</, '地点组仍在 details 内（没被删掉）');
    assert.match(inner, /sw2-locgroup-unknown/, '未载筐仍在 details 内');
    assert.match(inner, /位置未载[\s\S]{0,200}?书里没写/, '★「未载 ≠ 在别处」的口径文案随内容一起保留');
    assert.match(inner, /<\/details>/, 'details 正确闭合');
});

test('K34 编年页：全量条目 + 旧卷卷行（数据入面）；★leg94：里程碑插行已撤', () => {
    const html = renderChronicleHtml(world(), { oldVolumes: VOLUMES });
    assert.match(html, /劳役征发——大虞偏将征调坊市丁壮。/);
    // ★leg94（用户令：「这个文字出现在编年页签里了」/「这是大事纪旧卷的东西」）：
    //   里程碑插行（sw2-ch-roll =「第 1–N 轮已收进大事纪「…」」）**已从编年页撤掉**——
    //   那一纪的标题长在大事纪页的里程碑卡上（见下一条），此处不再重印。
    //   正向判据 = 两条**都在**（"撤"不等于把这段渲染换了个地方印）；反向判据 = 类名与文案零残留。
    assert.match(html, /sw2-ch-tools/, '编年工具条在位');
    assert.match(html, /sw2-ch-layer/, '两层照旧画出来');
    assert.ok(!html.includes('sw2-ch-roll'), '★里程碑插行不许回潮（编年页）');
    assert.ok(!html.includes('已收进大事纪'), '★「已收进大事纪」这段话不再出现在编年页');
    assert.match(html, /sw2-vol">卷一/);
    assert.match(html, /data-action="read-volume"/);
    assert.ok(html.indexOf('ch_47_1') === -1);                    // 编年 id 不裸出
});

test('K34 大事纪·旧卷页：里程碑卡（span/标题/ids 展开） + 卷列表 + 无卷提示', () => {
    const html = renderArchiveHtml(world(), { oldVolumes: VOLUMES });
    assert.match(html, /sw2-milestone-id">m_30</);
    assert.match(html, /第 1–30 轮 · 8 件事/);
    assert.match(html, /展开这一纪的条目/);
    assert.ok(html.includes('data-action="open-chain" data-chain="ev_0"'), '大事纪条目行链按钮（C-1 第二入口）');
    assert.ok(html.includes('data-action="open-chain" data-chain="ev_15_1"'), '大事纪条目行链按钮（C-1 第二入口）');
    // ★★★leg94 改判据（用户实机截图取证：「大事纪更是灾难」）：
    //   原来这条咬的是「**管理区 ids 仍裸显**」——那个口径正是病：玩家看到的是 `ev_0 链 · ev_15_1 链`。
    //   ⇒ 新口径是**分层**：id **只许活在该活的三个地方**（`data-chain` 属性 / `title` 悬停 / 对不上标题时的兜底），
    //     **可见文本里必须换成那一件事的名字**（`m.ids` 与 `m.titles` 同位配对，真账实测一一对应）。
    const rawText = (v) => String(v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    const vis = rawText(html);
    assert.ok(html.includes('data-chain="ev_0"') && html.includes('title="ev_0"'), '★机器号仍进属性与悬停（A-3 豁免口不变）');
    assert.ok(!/\bev_15_1\b/.test(vis) && !/\bev_0\b/.test(vis), '★可见文本里不许再裸出机器号');
    assert.match(vis, /发兵催战/, '★展开的条目要印那一件事的名字（夹具 m_30.titles 首条）');
    assert.match(vis, /民生凋敝/, '★第二条名字也要在');
    assert.match(html, /sw2-vol">卷一/);
    const empty = renderArchiveHtml(world(), {});
    assert.match(empty, /尚未入卷/);
});

test('★★★leg94 · 大事纪三处实机病：`[object Object]` / 裸机器号 / 计数口径', () => {
    // 病（用户截图 · A 局真账）：`m_20 第 1–20 轮 · [object Object] 件事`——`counts` 是 `{events:N}` 对象，
    //   插值当场 toString；同文件链视图那两处写的是 `.counts.events`（口径就在隔壁，只是这一格漏了）。
    //   ⇒ 判据两条一起咬：**没那串字** + **数对不对**（只咬前者会空绿：把数删了也能过）。
    const html = renderArchiveHtml(world(), {});
    assert.ok(!html.includes('[object Object]'), '★大事纪不许再印 [object Object]');
    assert.match(html, /第 1–30 轮 · 8 件事/, '★计数取 counts.events（夹具 counts=8 这个数）');
    // 老账兜底：counts 直接是数字、或整个缺格 —— 都不许炸、不许印 0 件事（退回 ids 条数）
    const w2 = world();
    w2.milestones = [{ id: 'm_30', span: { from: 1, to: 30 }, counts: 8, titles: ['发兵催战'], ids: ['ev_0'] }];
    assert.match(renderArchiveHtml(w2, {}), /· 8 件事/, 'counts 是数字的老账照旧');
    const w3 = world();
    w3.milestones = [{ id: 'm_30', span: { from: 1, to: 30 }, titles: ['发兵催战'], ids: ['ev_0', 'ev_15_1'] }];
    assert.match(renderArchiveHtml(w3, {}), /· 2 件事/, 'counts 缺格 ⇒ 退回 ids 条数（不印 0）');
    // ids 比 titles 多的那几条：**如实兜底**（印号 + 一句"另有 N 条无名"），不编标题
    const w4 = world();
    w4.milestones = [{ id: 'm_30', span: { from: 1, to: 30 }, counts: { events: 3 }, titles: ['发兵催战'], ids: ['ev_0', 'ev_15_1', 'ev_20_1'] }];
    const h4 = renderArchiveHtml(w4, {});
    assert.match(h4, /另有 2 条账上没留标题/, '对不上的条目要如实说明（不假装有名字）');
    assert.ok(h4.includes('>ev_15_1<'), '没名字的那几条照旧用自己的号认');
});

test('★★★leg94 · 全站扫描：任何一页都不许印 `[object Object]`（守门 · 防同类病再犯）', () => {
    // 为什么扫**全部面**而不是只扫大事纪：这一族的病根是"**把对象当字符串插值**"，
    //   它可以在任何一个页面、任何一次改动里复发（`board` 那次就曾经靠一条硬编码注释挡过一回）。
    const out = renderAll(world(), { config: CONFIG, oldVolumes: VOLUMES });
    const bad = [];
    const walk = (v, path) => {
        if (typeof v === 'string') { if (v.includes('[object Object]')) bad.push(path); return; }
        if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
        if (v && typeof v === 'object') return Object.entries(v).forEach(([k, x]) => walk(x, `${path}.${k}`));
    };
    walk(out, 'renderAll');
    assert.deepEqual(bad, [], `★这些面里印了 [object Object]：${bad.join('、')}`);
    // 反向自证：扫描器真的能抓到（不然"零命中"可能只是没扫到东西）
    const probe = { a: { b: ['ok', 'x[object Object]y'] } };
    const hit = [];
    const walk2 = (v, path) => {
        if (typeof v === 'string') { if (v.includes('[object Object]')) hit.push(path); return; }
        if (Array.isArray(v)) return v.forEach((x, i) => walk2(x, `${path}[${i}]`));
        if (v && typeof v === 'object') return Object.entries(v).forEach(([k, x]) => walk2(x, `${path}.${k}`));
    };
    walk2(probe, 'probe');
    assert.deepEqual(hit, ['probe.a.b[1]'], '★扫描器对已知坏串必须报出来');
});

test('★★★leg94 · 编年账目行：**文本里内嵌的机器号，渲染时换成人话**（账上原文一个字不动）', () => {
    // 病（用户截图 · 真账原文）：`因事而生：天璇圣地 由「ev_11_1」生「活捉药尘子炼化神丹药力」`——
    //   引擎在"新盘算的出生行"上写的是号（那一行没有 `eventRef`，号只活在文本里），玩家看到的就是一串码。
    //   ★夹具事实（先查再说）：`live-world.json` 的热事件只有一个 `ev_0 = 薛铁衣发兵催战`；
    //     归档那一路用里程碑的 `ids/titles`（`ev_15_1 → 民生凋敝`）。
    const w = world();
    w.chronicle = [
        { id: 'ch_2_4', tick: 2, text: '因事而生：黄坤 由「ev_0」生「逼黄坤入洗煞之局」', kind: 'scheme' },
        { id: 'ch_2_5', tick: 2, text: '因事而生：某人 由「ev_99_9」生「一件没有来路的事」', kind: 'scheme' },
    ];
    const html = String(renderChronicleHtml(w, { view: { ...CHRONICLE_DEFAULT_VIEW, range: 'all' } }));
    const vis = html.replace(/<[^>]*>/g, ' ');
    assert.ok(vis.includes('薛铁衣发兵催战'), '★认得出的号要换成人话（那一件事的名字）');
    assert.ok(!/\bev_0\b/.test(vis), '★换过之后不许再露那个号');
    assert.ok(vis.includes('ev_99_9'), '★认不出的号**原样留着**（不猜、不编）');
    assert.ok(html.includes('因事而生：黄坤'), '行原文照旧（只换"印出来的那一格"，不改句子结构）');
    // 账上原文一个字不动：`text` 还是原来那句
    assert.equal(w.chronicle[0].text, '因事而生：黄坤 由「ev_0」生「逼黄坤入洗煞之局」');
    // 归档事件的号也要认得出（真账实测：`ev_24_1`/`ev_39_1` 早已归档，热表里没有它们）
    const w2 = world();
    w2.chronicle = [{ id: 'ch_25_1', tick: 25, text: '接着「ev_15_1」往下长', kind: 'ripple' }];
    const vis2 = String(renderChronicleHtml(w2, { view: { ...CHRONICLE_DEFAULT_VIEW, range: 'all' } })).replace(/<[^>]*>/g, ' ');
    assert.ok(vis2.includes('民生凋敝'), `★归档里的号（milestones.ids↔titles）也要查得到：${vis2.slice(0, 200)}`);
    assert.ok(!/\bev_15_1\b/.test(vis2), '★归档那一路换过之后同样不许露号');
    // 查表本身：热事件优先，归档补位
    const names = chronicleEventNames(world());
    assert.equal(names.get('ev_0'), '薛铁衣发兵催战');
    assert.equal(names.get('ev_15_1'), '民生凋敝', '归档补位');
    assert.equal(chronicleDisplayText('没有号的句子', names), '没有号的句子', '没有号就原样返回');
    assert.equal(chronicleDisplayText('', names), '', '空串进空串出');
});

test('K34 角色与势力页：全量表（三列：名号/归属与来历/在办；状态徽；位置与活跃已退场）', () => {
    const w = world();
    const html = renderEntitiesHtml(w);
    assert.match(html, /全部角色与势力（全册 4 · 本轮镜头 4）/);
    // leg25 c（本次变更核心意图）：四维属性 chip（兵力/权位/人脉/耳目）**整段删除**——
    //   那些数没法精确表示、手拍值让"编的"像"算的"。属性区现在只有两样**据书/据账**的东西：
    //   ① 实力 = 书里明述的原话（文本，角色才有）；② 位置的查书标记。
    for (const term of ['兵力', '权位', '人脉', '耳目', 'hardPower', 'office', 'network', 'intel']) {
        assert.ok(!html.includes(term), `实体页不得再出现旧属性名/键「${term}」（四维已删）`);
    }
    assert.ok(!html.includes('ATTR_HINTS') && !html.includes('sw2-eattr" title="兵力'),
        '旧的属性释义悬停（ATTR_HINTS）不得回潮');
    assert.match(html, /sw2-ename">黄坤<small>角色/);
    // leg49（细案 J11 + J6）：名号格只剩「名 + 类别 + 状态徽」——玩家标记与最近活跃列**一起退场**
    assert.ok(!html.includes('你的棋子'), '★「你的棋子」标记退场（细案 J11：玩家那一行靠归属与在办自证）');
    assert.ok(!html.includes('最近活跃'), '★最近活跃不占版面（细案 J6：只进排序与筛选）');
    // ★leg49：旧断言锁的是「安静标签 + 轮次」两行（`sw2-quiet-note">最近活跃</span><br>第45轮`）——
    //   那是**最近活跃列**（真账 96% 是破折号）。细案定稿：该列退场，判据换成"不占版面"。
    w.entities.push({ id: 'e_dead', kind: 'faction', name: '覆灭阁', location: 'x', status: 'dead' });
    const html2 = renderEntitiesHtml(w);
    assert.match(html2, /覆灭阁/);
    assert.match(html2, /sw2-visible v-hidden">已灭</);
    // K37 席位语义：在席计数只算 active + 退休/已灭标注
    w.entities.push({ id: 'e_ret', kind: 'character', name: '归隐客', location: 'x', status: 'retired' });
    const html3 = renderEntitiesHtml(w);
    // ★leg49：新头部不再单列"另 N 位退休/已灭"——状态徽就在行内（口径：**同一事实不说两遍**）
    assert.match(html3, /全部角色与势力（全册 6 · 本轮镜头 4）/, '全册与镜头计数仍在（含退休/已灭的 2 位）');
    assert.ok(!html3.includes('另 2 位退休/已灭'), '★旧头部那句已撤（同一事实不说两遍）');
});

test('leg25 c/leg49：属性区无障碍双通道——有值走原话 + 悬停释义；待查行留「查」钮（三态注脚由 Task 3 收进工具条）', () => {
    const w = world();
    const html = renderEntitiesHtml(w);
    // ① 有值态（实力=书里原话）：两条通道都要有（鼠标悬停 + 读屏 sr 文本）
    const withPower = { ...w, entities: [...w.entities, { id: 'e_pw', kind: 'character', name: '玄一道祖', location: '未明', '实力': 'T9渡劫巅峰' }] };
    const withPowerHtml = renderEntitiesHtml(withPower);
    assert.ok(withPowerHtml.includes('title="实力：书里明述的原话（角色字段；势力不写实力）"'),
        '悬停释义在位（鼠标通道）');
    // ★leg49（细案三列版式）：属性行不再是「标签 + 值」竖排，实力原话落进**归属与来历**那一串；
    //   **无障碍双通道保持**——sr 释义仍与实值同处一个容器（先释义、后原话）。
    assert.ok(withPowerHtml.includes('<span class="sw2-visually-hidden">实力：书里明述的原话。</span><span class="sw2-relone-pow" title="实力：书里明述的原话（角色字段；势力不写实力）">T9渡劫巅峰</span>'),
        '视障通道在位：sr 文本先释义、后原话（读屏用户拿得到同一信息）');
    // ② 未查态（没轮到查它）：细案口径——**行内只留查询钮**，查询钮才是"这一行还没定案"的外显；
    //   三态释义收进工具条（Task 3 的 `sw2-ents-asks`）。
    // ★评审修正 #4：这条原先连悬停文案**整句**一起锁死（90 字），而它的意图只是"**钮在不在**"。
    //   ⇒ 改锁 `data-action` + `data-entity`（文案逐字由下面 `leg25 d 回归` 那条**截断专条**整句锁，只此一处）。
    assert.ok(html.includes('<button class="sw2-chainbtn" data-action="lookup-entity" data-entity="e_player"'),
        '★未定案（none）的角色行给出「查」钮');
    // ★评审修正 #2：**`pending` 态原先没有任何判据**（上面那条只查了 none 的 e_player）——
    //   而本任务的硬口径是"**未定案的行都得看得见**"（看不见 = 玩家以为没这功能）。
    //   夹具形状照本文件下方「细案 spec-entity-field-lookup/leg49」那条：`e_c2` = 查过书、这轮模型没抽出来。
    const pendingW = {
        ...w,
        entities: [...w.entities, { id: 'e_c2', kind: 'character', name: '无名客', location: '未明' }],
        meta: { ...w.meta, entityFields: { e_c2: { attempts: { 实力: { count: 1, state: 'pending' } }, fields: {}, sources: ['昆仑道宫'] } } },
    };
    const pendingRow = renderEntitiesHtml(pendingW).split('<div class="sw2-entity-row').find((seg) => seg.includes('无名客'));
    assert.ok(pendingRow && pendingRow.includes('data-action="lookup-entity"') && pendingRow.includes('data-entity="e_c2"'),
        `★pending 态（查过书但这轮没抽出来）的行也必须看得见「查」钮，实际：${String(pendingRow).slice(0, 200)}`);
    // ★leg49：位置列退场（细案 J1）——位置改由搜索承担，不再占格子
    assert.ok(!html.includes('sw2-c-loc'), '★位置列已退场（细案 J1）——位置改由搜索承担');
    // 势力行不摆实力栏（用户拍板）：势力行内不得出现实力原话
    const factionRow = html.split('<div class="sw2-entity-row').find((seg) => seg.includes('薛铁衣'));
    assert.ok(factionRow && !factionRow.includes('sw2-relone-pow'), '势力行内不得渲染实力原话');
    // 注脚行：★leg49 现状（Task 3 已把它从页底整行收进工具条的可展开「？」里，文本照旧**连续出现**
    //   ⇒ 这条 `includes` 判据照旧咬得住；页底只剩那句指向批量入口的指路话）。
    assert.ok(html.includes('账上只记查到的与玩出来的东西'), '注脚行在位（说清"有值/未加载到/书未明述"三态）');
});

// ★★leg40b（体检 · A1）：**一条永不会兑现的承诺**——位置查书这条腿在 leg25 f 就被摘掉了
//   （`src/entity-lookup.js` 的 `ENTITY_LOOKUP_FIELDS = ['实力']`），而关系区那枚位置 chip 的悬停
//   仍写着「轮到时会按需去世界书取原话」。真账实测 405 行挂着它，而 `meta.entityFields` 里
//   `位置:*` **一条都没有** ⇒ 那是一条玩家会读到、系统永远不会做的事。
//   判据分两面：①旧承诺**不得回潮**；②新的「未载」必须如实说清来路（不许换成另一句含糊话）。
test('★leg40b/leg49：位置不承诺查书、**也不再占版面**（旧「轮到时会按需去世界书取原话」不得回潮）', () => {
    const w = world();
    w.entities.forEach((e) => { e.location = '未明'; });
    const html = renderEntitiesHtml(w);
    assert.ok(!html.includes('位置：还没轮到查它'), '★关系区不再摆「位置：未查」的查书标记（位置不查书）');
    assert.ok(!/title="位置：[^"]*取原话/.test(html), '★位置那一栏不得承诺"会去世界书取原话"（那个功能已不存在）');
    assert.ok(!html.includes('位置：还没轮到查它'), '旧措辞不得回潮（第 1 条判据的口语版）');
    // ★leg49（细案 J1/J2）：位置整列退场 ⇒ 那枚「未载」chip 与它的"来路"悬停也一并不在版面上了
    //   （"未载"的解释已收进 `entsSearchTextOf` 的搜索面：不占列 ≠ 查不到）。判据锁反面。
    assert.ok(!html.includes('sw2-c-loc') && !html.includes('sw2-locval'), '★位置不占列（细案 J1）');
    assert.ok(!html.includes('未载'), '★「未载」这类空态词不进版面（细案：空态一律不占版面）');
    // 实力那一栏**照旧**承诺查书（它是真的会查，只是承诺改由「查」钮的悬停承担）——别把两栏一起收掉。
    //   ★评审修正 #4：这里原先也锁整句悬停文案；本条意图是"承诺还在" ⇒ 改锁**按钮本身**
    //   （文案逐字由 `leg25 d 回归` 的截断专条整句锁，不在这里重复锁）。
    assert.ok(html.includes('data-action="lookup-entity"'), '实力栏的查书承诺必须留着（那才是真会发生的）');
    // ★评审修正 #1：页底原写着「每行的**查**=只补没定的栏，**重查**=连「书未明述」也推倒重查」——
    //   而本任务只产出**一枚**「查」钮（`data-force="absent"` 全仓不再渲染）⇒ 那是在承诺一个**不存在的钮**
    //   （正是 leg40b 这条用例治的那类病）。判据两面：①行内不许再承诺「重查」；
    //   ②全册范围的"连书未明述也推倒重查"**仍在**，但它落在**批量入口**上，页底必须说对。
    const askLine = html.slice(html.indexOf('每行的<b>查</b>'));
    assert.ok(askLine.length > 0, '页底查书说明在位（前一条已锁三态词）');
    const askFirstSentence = askLine.slice(0, askLine.indexOf('。') + 1);
    assert.ok(!askFirstSentence.includes('重查'),
        `★页底不许再承诺行内「重查」钮（本任务只产出单个「查」钮），实际：${askFirstSentence}`);
    // ★★★leg76：全册批量补全那枚钮**已撤**（用户令「这个按钮根本用不了，要么就改成重抽名册，要么就删了」）
    //   ⇒ 这一条从"指路到那枚钮"翻成"**不许再指路**"——面板不许承诺一个不存在的入口（leg40b 治过的病）。
    assert.ok(!askLine.includes('补全全册实力'),
        '★页底不许再提那枚已撤的批量钮（改口：如实说"不再自动重查"）');
    assert.ok(askLine.includes('不再自动重查'),
        '★并如实说清现状：已定案的栏不再自动重查（不指路到一个不存在的地方）');
});

test('leg25 d 回归：属性区 title 属性不得被内层裸双引号截断（悬停文案要完整）', () => {
    // 子代理报回、实测确认的 A9：`lookupChip` 的未查态 title 里写了裸双引号（`"未加载到"`），
    //   `escapeHtml` **不转义半角引号** ⇒ 属性值就地截断：悬停只显示前半句，残余文字还漏成游离文本。
    //   旧用例只断言 `title="实力：还没轮到查它` 这个**前缀**，所以正好绕过它——这里按机械口径锁死：
    //   凡是进 title 的文案一律不许带裸 `"`（要引号用「」）。
    const w = world();
    const html = renderEntitiesHtml(w);
    // ★leg49：查书 chip 已收成「查」钮 ⇒ 前缀换成它，**机械扫描（①②）照旧全跑**：
    //   三列版式里进 title 的文案更多（（推）的来路、查钮的口径），这条锁更要留着。
    assert.ok(html.includes('title="只补还没定案的栏（已查到的原话不动；查过之后这里会写「未加载到」或「书未明述」）"'), '前缀仍在（原用例不回归：换到「查」钮上）');
    // ① 逐个 title 属性取值，凡值里再出现 `"` 即为被截断
    const titles = [...html.matchAll(/title="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(titles.length > 0, '这份产物里本来就该有 title（悬停释义通道）');
    const broken = titles.filter((t) => t.includes('"'));
    assert.deepEqual(broken, [], `title 属性值内出现裸双引号（属性被截断）：${JSON.stringify(broken)}`);
    // ② 查书口径那句整句释义**整句在位**（本笔落点从 chip 挪到「查」钮的悬停；截断 bug 会让后半句掉出属性）
    assert.ok(titles.some((t) => t.includes('查过之后这里会写「未加载到」或「书未明述」')),
        `★整句悬停文案在位（截断 bug 会让后半句掉出 title），实际：${JSON.stringify(titles)}`);
    // leg25 f 追加：新增的注释 title 也在上面 ① 的机械扫描里（new 文案同样不许带裸引号）
    assert.ok(!/title="[^"]*"[^<>]*"\s*>/.test(html), '不得出现"属性提前闭合 + 游离文字"的残迹');
});

test('细案 spec-entity-field-lookup/leg49：实力原话入「归属与来历」；势力不显示实力栏；待查行留钮不留 chip', () => {
    const w = world();
    const faction = w.entities[0];                              // fixture 里三条都是势力
    // 加一个**角色**（实力是角色字段；势力不写实力——用户拍板）
    w.entities.push({ id: 'e_c1', kind: 'character', name: '玄一道祖', location: '未明', parent: faction.name, '实力': 'T9渡劫巅峰' });
    w.entities.push({ id: 'e_c2', kind: 'character', name: '无名客', location: '未明' });
    faction['实力'] = '三万铁骑';                                 // 势力即便账上有值也不该渲染实力栏
    w.meta.entityFields = {
        e_c2: { attempts: { 实力: { count: 1, state: 'pending' } }, fields: {}, sources: ['昆仑道宫'] },
        e_wanfa: { attempts: { 位置: { count: 1, state: 'absent' } }, fields: {}, sources: [] },
    };
    const html = renderEntitiesHtml(w);
    // ★leg49（三列版式）：实力原话落进「归属与来历」串（旧版是关系区的「标签 + 值」竖排一行）
    assert.ok(html.includes('<span class="sw2-visually-hidden">实力：书里明述的原话。</span><span class="sw2-relone-pow" title="实力：书里明述的原话（角色字段；势力不写实力）">T9渡劫巅峰</span>'),
        '①有值 → 显示原文原话（文本类型，不做任何加工）');
    assert.ok(!html.includes('三万铁骑'), '②势力不显示实力栏（哪怕账上有值也不渲染——用户拍板）');
    // ③④ 查书态：细案口径 = **查书三态说明**（细案 §3.2 注脚 + Task 3 的「？」）＋**待查行给「查」钮**；
    //   行内不再逐行印「未加载到/书未明述」chip（旧版每行两枚 ⇒ 真账 626 枚按钮的那条病）。
    assert.ok(html.includes('账上只记查到的与玩出来的东西'), '③查书三态说明在位（有值/未加载到/书未明述 各有其话）');
    assert.ok(html.includes('>未加载到</b>') && html.includes('>书未明述</b>'), '④三态的词都在说明里（面板上确实说清这三句）');
    // 势力行不摆实力原话：本夹具里**唯一**有 e_wanfa 的位置态，它不得渲染出实力
    const wanfaRow = html.split('<div class="sw2-entity-row').find((seg) => seg.includes('万法阁'));
    assert.ok(wanfaRow && !wanfaRow.includes('sw2-relone-pow'), '势力行内不出现实力原话（连接都不能有）');
    // ★第二十五棒修正（用户实拍"根本看不到属性"）：没定案的那一行必须显形，否则用户以为没这功能
    const w2 = world();
    w2.entities.push({ id: 'e_c3', kind: 'character', name: '从没查过的人', location: '未明' });
    const html2 = renderEntitiesHtml(w2);
    // ★leg49：外显形态由「未查」chip 收成一枚「查」钮（只补没定案的栏；悬停说清口径）
    assert.ok(html2.includes('data-entity="e_c3"') && html2.includes('>查</button>'), '★没查过 → 该行给「查」钮');
    //   ★评审修正 #4：原锁整句悬停（90 字）⇒ 改锁**短前缀**（本条意图是"钮的悬停还在"，逐字由 leg25 d 整句锁）。
    assert.ok(html2.includes('title="只补还没定案的栏'), '★钮的悬停说清"只补没定案的栏"（旧 chip 的口径照旧在位）');
    // ★leg49（J11 的另一半）：**已定案的行不留查询钮、不留 chip**——真账 621 行里只有 ~12 行待查
    w2.meta.entityFields = { e_c3: { attempts: { 实力: { count: 1, state: 'absent' } }, fields: {}, sources: [] } };
    const html3 = renderEntitiesHtml(w2);
    assert.ok(!html3.includes('data-entity="e_c3"'), '★已定案（absent）的行不留查询钮（真账 626 枚按钮的病根）');
    // ★同一事实不说两遍：这一行**行内**不逐行印查书 chip（三态的词只住在页底那句说明里）
    const row3 = html3.split('<div class="sw2-entity-row').find((seg) => seg.includes('从没查过的人'));
    assert.ok(row3 && !/sw2-eattr|sw2-quiet-note|[（(]推[）)]/.test(row3),
        `★已定案的行不逐行印查书 chip / 来源标记（同一事实不说两遍），实际：${String(row3).slice(0, 200)}`);
    assert.ok(!html2.includes('title="位置：还没轮到查它'), '★位置不再有查书标记（那条腿已摘）');
    assert.ok(html2.includes('账上只记查到的与玩出来的东西'), '注脚把查书三态讲清');
});

test('细案 spec-entity-field-lookup/leg49：势力的实力由麾下成员派生显示（不替它算总档）', () => {
    const w = world();
    const faction = w.entities.find((e) => e.kind === 'faction');
    const member = { id: 'e_m1', kind: 'character', name: '玄一道祖', location: '未明', parent: faction.name, '实力': 'T9渡劫巅峰' };
    w.entities.push(member);
    const html = renderEntitiesHtml(w);
    // ★leg49（三列版式）：麾下名单与「麾下实力」并入「归属与来历」串（旧版是两行 `<i>标签</i>值`）
    assert.ok(html.includes('麾下实力 玄一道祖（T9渡劫巅峰）'), '势力行显示麾下各成员的档位原话（派生，不落势力字段）');
    // 势力自己那格不得出现实力原话：把该势力的行切出来单独看
    const row = html.split(`<div class="sw2-entity-row`).find((seg) => seg.includes(faction.name));
    assert.ok(row && !row.includes('sw2-relone-pow'), `势力行内不得渲染实力原话：${String(row).slice(0, 80)}`);
});

test('leg25 c：「没查到就空着」要看得见（不填默认值冒充客观）；环境键书没给就标「书未明述」', () => {
    // leg25 c 改写（原「leg24 片5：账面无数与位置未明都要看得见」）：
    //   原用例断言的是"四维无数 → 明说『数值无据』"与"整排属性空着 → 一句人话解释『四维无数（等模型提议或查书）』"。
    //   那两个说法的**所指**（四维浮点）已经不存在 ⇒ 断言换成现在真实存在的对应物：
    //   ①属性区不是数值而是**查书标记**，空态文案是「实力/位置未查（轮到时会按需去世界书取原话）」；
    //   ②同样一条硬规矩仍在被锁：**不许拿 0.15/0.25/0.5 这类默认值冒充数据**（design-core-leg23 §2.2 硬规矩一）。
    const w = world();
    w.entities.forEach((e) => { e.location = '未明'; });
    const html = renderEntitiesHtml(w);
    // 第二十五棒修正（用户实拍："第一个未明是位置未明，后面还有一个位置未明是不是多了"）：
    //   位置列已经说明"没载到"，标记区不再重复打「位置未明」徽章；位置列本身写「未载」。
    // leg25 f：位置列那格改虚线 chip（同一句话，但不再与名号抢注意力）。
    // ★leg49（细案 J1/J2）：位置列连同它的「未载」chip 一起退场——
    //   "没查到就空着"的新形态是**整个格子留白**（空态不占版面），不是印一个词。
    assert.ok(!html.includes('sw2-c-loc') && !html.includes('sw2-locval'), '★位置不占列（细案 J1）');
    assert.ok(!html.includes('未载'), '★位置没载到 → 空态**不占版面**（旧「未载」chip 随列退场）');
    assert.ok(!html.includes('位置未明'), '★撤销重复的「位置未明」徽章（同一事实不再说两遍）');
    assert.ok(!html.includes('数值无据'), 'leg25 c：四维不存在 → "数值无据"这个说法不再出现');
    // leg25 f：属性空态曾改成**逐栏三态标记**；leg49 再收一格——**待查行只留「查」钮**
    //   （钮就是"这一行还没定案"的外显；三态的话收进工具条说明，不再逐行印 chip）。
    assert.ok(html.includes('<button class="sw2-chainbtn" data-action="lookup-entity" data-entity="e_player"'),
        '实力空态 → 行内给「查」钮（不是空白、不是假数）');
    // ★leg40b（体检 · A1）：位置那一栏**不再有查书标记**——位置查书这条腿在 leg25 f 已摘掉，
    //   它的查书标记在真账里恒为 none ⇒ 旧断言「位置空态 → 行内标『未查』」锁的是一条**永不兑现的承诺**。
    //   现在锁反面：不摆那枚 chip（位置已不占版面，见上两条）。
    assert.ok(!html.includes('title="位置：还没轮到查它'), '★位置不摆查书标记（位置不查书，别把死承诺锁回来）');
    assert.ok(!html.includes('实力/位置未查（轮到时会按需去世界书取原话）'), '旧的一整句占位文案已撤（改逐栏标记）');
    assert.ok(!/0\.15|0\.25/.test(html), '不出现任何默认值冒充的数据');
    // 参数档位（leg26）：没定的显示「未定」——不填占位档、不冒充"书里给过值"
    const bare = structuredClone(w);
    bare.context.setting.dynamic.env = {};             // 玩家没定、书里也没给（新世界常态）
    const band = renderInfoBandHtml(bare);
    assert.match(band, /未定/);
    assert.match(band, /sw2-nodata/, '未定档走无据样式（虚线/灰）');
    assert.ok(!/0\.50/.test(band), '不再出现"四键 0.50"这种看起来像原值的数');
    // 定了档的那几项照常显示**原话**（本夹具四键都已定）
    const band2 = renderInfoBandHtml(w);
    assert.match(band2, /动荡/);
    assert.ok(!/未定/.test(band2), '四档都已定 → 不显示未定');
    // 分数（影响力条）在实体页彻底消失
    assert.ok(!html.includes('sw2-wval') && !html.includes('sw2-eweight'), '片5：分量条不再渲染');
});

// ★leg60（交接第 2/3 件）：设定页必须**真的画出**新编译出来的两样东西——刻度 与 编译完整性。
//   ⚠为什么单独立一条：我第一版只加了渲染代码、没加判据 ⇒ **那条分支一次都没被跑到**（全绿）。
//     这是本仓反复登记的那类洞（"机制对了、线没接上"）——所以这里**真渲染一次**并逐字断言。
//   ★★leg62 换口径（用户令「换成概念表」）：旧断言读的是两栏「维度与刻度（N 项）」+「力量谱系（N 档）」；
//     现在是一栏「刻度（一概念一表 · N 张）」+ 每概念一张卡《表名》。下面按新口径重写。
test('★leg60 + leg62 设定页：刻度按概念分栏 + 编译完整性读数（真渲染一次，不许是空绿）', () => {
    const w = world();
    w.context.setting.frozen.canon.dims = [{ name: '勇武', range: '-100~100' }, { name: '韬略', range: '-100~100' }, { name: '气度' }];
    w.context.setting.frozen.compile = {
        entries: 827, enabled: 264, disabled: 563,
        declared: 554, picked: 188, skipped: 366, skippedChars: 523337,
        declaredDropped: 0, titleNames: 189, settingTitles: 12, settingCompiled: 9,
        missedTitles: ['演义模糊地带处理准则'],
    };
    const html = renderSettingHtml(w);
    // ① ★leg62：刻度那一栏 = 一概念一表（表名成卡；不再把两张表平铺成两栏）
    //   ★★leg63 改口径：这一栏**按原文条目分节**（节数写进表头），且**进包读数如实**。
    //     旧断言锁的是 `刻度（一概念一表 · 2 张）`——那张老形状正是"66 张表平铺成一堵墙"的那一版。
    assert.match(html, /刻度（一概念一表 · 2 张）/, '★概念表栏在位（一概念一张卡）');
    // 老账（夹具没有 `源`）⇒ 全部落进「未标条目」一节，**零迁移**（不猜、不重抽）
    assert.match(html, /<summary><b>未标条目<\/b>/, '★老账没有 `源` ⇒ 归入「未标条目」一节（零迁移，不假装分对了）');
    assert.match(html, /其中 <b>2<\/b> 张表 \/ <b>2<\/b> 档 \/ <b>3<\/b> 维每轮进模型的包当锚/, '★进包读数如实（读真源 buildScaleAnchor，不另算一份）');
    assert.match(html, /《无记号档位》/, '★档位那半自成一表（这册的档位名都无数记号 ⇒ 合一张）');
    assert.match(html, /《维度》/, '★维度那半自成一表（回指不到档位名的维度合一张）');
    assert.ok(!html.includes('力量谱系'), '★旧栏名退场（它正是"制度与刻度挤一个框"的那个框）');
    assert.ok(!html.includes('维度与刻度（'), '★旧栏名退场（维度不再与档位平铺成一栏）');
    assert.match(html, /勇武<\/b><span>-100~100/, '维度名与范围逐字取自原文');
    assert.match(html, /（原文未给范围）/, '只有维度名、原文没给范围时如实写"未给"，不编一个范围');
    assert.match(html, /炼气<\/b><span>修士，江湖底子（原文）/, '档位名与标定逐字取自原文');
    // ★★HTML 里不许漏 markdown 星号（本仓 leg60 为这条栽过：`**` 直接写进了 HTML）
    assert.ok(!html.includes('**'), '★渲染产物不许含 markdown 星号（面板是 HTML，不是 markdown）');
    assert.match(html, /编译完整性/, '★编译完整性读数在位');
    assert.match(html, /作者点名 554 条 ⇒ 本次进料 188 条/, '读数逐项如实');
    assert.match(html, /未编译 366 条（523337 字，题名仍进名册）/, '未编译的那一批**如实报**（不许静默）');
    assert.match(html, /题名面贡献名号 189 条（零调用）/, '题名面的贡献也报出来');
    assert.match(html, /设定类条目覆盖 9\/12/, '设定类条目覆盖率如实');
    assert.match(html, /演义模糊地带处理准则/, '未编译的设定类条目**点名列出**（"哪个体系没抽出来"要一眼看到）');
    // 禁词扫描**只扫文本**（`textOnly` 剥标签）——否则会咬到 CSS 类名（如 `sw2-hist-tick` 里的 `tick`）。
    //   ★这一段必须在这里扫：全局那条 BLACKLIST 判据用的是**没有 dims/compile 的夹具**，
    //     它扫不到本棒新加的两段文案 ⇒ 不在这里扫，新文案就是禁词的无人区。
    for (const term of BLACKLIST) assert.ok(!textOnly(html).includes(term), `含禁词「${term}」（leg60/leg62 新文案）`);
    // 顶到体积上限时要显形（三国实测会咬到 50 万上限）
    const over = world();
    over.context.setting.frozen.compile = { entries: 827, enabled: 264, disabled: 563, declared: 554, picked: 180, declaredDropped: 8 };
    assert.match(renderSettingHtml(over), /⚠顶到体积上限，声明面有 8 条未进料/, '截断不许静默');
    // 没有读数（旧账）⇒ 那一栏不出现（旧世界零扰动）
    const bare = world();
    assert.ok(!renderSettingHtml(bare).includes('编译完整性'), '旧账没有 compile 读数 ⇒ 不画那一栏');
});

// ★★leg62：**实教那张图的根治**——"衡量强弱的尺"与"决定资源怎么分的制度"必须分在不同的卡里。
//   用户截图原文：`力量谱系（5 档）` 把 `S~E级` 与 `A班~D班` 摆在一起（后者是**班级分配制度**）。
test('★leg62 设定页：制度与刻度分表（用户截图那个混排的根治）', () => {
    const w = world();
    // 新账形状：模型直接交概念表（`刻度`）⇒ 面板按它分栏
    w.context.setting.frozen.canon.刻度 = [
        { 名: '班级分配制度', 用途: '资源分配', 档位: [{ 档: 'A班', 注: '精英最高资源保障' }, { 档: 'D班', 注: '底层资源最少多隐藏实力' }] },
        { 名: 'S~E级', 用途: '分级（决定班级分配）', 档位: [{ 档: 'S~E级' }], 维度: [{ 名: '学力', 范围: 'S~E级' }, { 名: '智力', 范围: 'S~E级' }] },
    ];
    const html = renderSettingHtml(w);
    assert.match(html, /刻度（一概念一表 · 2 张）/, '两张概念表');
    // ★★leg63 换壳：表名从 `<h4>` 挪进 `<summary>`（表与档位都折起来了——66 张表平铺正是用户点的那一堵墙）。
    //   锁的是"名字 + 档数 + 用途"三样都还在，只是换了位置；口径没变。
    assert.match(html, /<summary><b>《班级分配制度》<\/b><span class="sw2-hint"> · 2 档<\/span><span class="sw2-hint"> · 资源分配<\/span><\/summary>/, '★制度自成一表，且**用途如实照抄**（资源分配）');
    assert.match(html, /《S~E级》<\/b><span class="sw2-hint"> · 1 档 · 2 维<\/span><span class="sw2-hint"> · 分级（决定班级分配）<\/span>/, '★那把尺自成一表（用途照抄原文）');
    assert.match(html, /学力<\/b><span>S~E级/, '★挂在尺底下的维度跟着它同表（不是平铺去别的栏）');
    // ★反面：`A班` 与 `S~E级` 不许出现在同一张卡里（卡片以 `<details class="sw2-fold">` 切分）
    const cards = html.split('<details class="sw2-fold"').filter((x) => x.includes('<summary><b>《'));
    const mixed = cards.filter((c) => c.includes('A班') && c.includes('学力'));
    assert.equal(mixed.length, 0, '★没有任何一张表同时装着"制度档位"与"尺的维度"（混排已根治）');
});

test('K34/A-6 设定档案页：展示与 setting.frozen 逐字段一致（指纹/时间/五件套原文全量），重抽按钮在位', () => {
    const html = renderSettingHtml(world());
    assert.match(html, /书指纹 fnv1a_9f31x_12044/);
    assert.match(html, /抽取于 2026-09-08T10:00:00Z/);
    assert.match(html, /刻度（一概念一表 · 1 张）/, '★leg62：刻度按概念分栏（旧栏「力量谱系」已退场）');
    assert.match(html, /《无记号档位》/, '★这册的档位名无数记号 ⇒ 合一张表（老账没有分组信息）');
    assert.match(html, /炼气<\/b><span>修士，江湖底子（原文）/);
    assert.match(html, /元婴<\/b><span>大宗，可开宗立派（原文）/);
    assert.match(html, /煞气须以灵脉镇压/);
    assert.match(html, /官军辖江州，坊市共治/);
    assert.match(html, /灵脉与煞气相生相克/);
    assert.match(html, /太岁陨落北山/);
    assert.match(html, /已冻结/);
    assert.match(html, /data-action="clear-evolution"/);
    // ★★leg52（BLACKLIST 漏网 + 同一概念同一说法）：旧文案是 `浪尖（派生源）：…`——
    //   **「派生源」是引擎术语**，而它**不在 `BLACKLIST` 数组里**（只有英文 derivedFrom），
    //   所以"玩家可见文本零禁词"那几条全局扫描扫了十几棒都没咬住它。
    //   ①措辞改成玩家话，与观棋信息带那一栏**同一口径**；②数组补上 `派生源`（见文件末尾 leg52 新锁）。
    assert.match(html, /浪尖 · 刚收尾的大动作：/);
    assert.ok(!html.includes('派生源'), '★设定页不许再出现「派生源」（引擎术语，本棒补进黑名单并改口径）');
    // 未抽取态
    const bare = { version: 1, context: { world: 'x', tension: 0.5, positions: ['x'] }, entities: [], weights: {}, agendas: [], events: [], chronicle: [], meta: { tick: 0 } };
    const bareHtml = renderSettingHtml(bare);
    assert.match(bareHtml, /尚未抽取/);
    assert.match(bareHtml, /sw2-sv-chip stale/);
});

test('K34 设置页：模型通道/操作按钮/旧卷管理，表单值来自 config', () => {
    const html = renderSettingsHtml(world(), { config: CONFIG });
    assert.match(html, /来源：角色卡 \+ 世界信息（自动合订）/);
    // ★★★leg87（用户令「A 删了」）：`<textarea id="sw2_player_desc">` 那条断言**按设计作废**——
    //   整张「你的开档描述」卡已撤（那段字写进 `meta.playerDesc` 后全仓零处读）。
    //   ★口径升级（不是删锁）：从"那个框在原位"改成"**那张卡与那个 id 都不许回来**"。
    assert.ok(!html.includes('sw2_player_desc'), '★开档描述那个 textarea 已撤，不许回潮');
    assert.ok(!html.includes('你的开档描述'), '★那张卡整张已撤（它承诺的"落成棋子自己的处境"没有消费者）');
    assert.match(html, /id="sw2_base" value="https:\/\/gcli\.ggchan\.dev\/v1"/);
    assert.match(html, /id="sw2_key" value="••••••••••••••••••••"/);
    assert.match(html, /id="sw2_model" value="gemini-3\.1-pro-preview"/);
    assert.match(html, /data-action="init-world"/);
    assert.match(html, /data-action="advance-world"/);
    assert.match(html, /自动入卷阈值/);
    // ★leg55：这一格的值必须**来自 config 现读**（撤掉曾经那个 `?? '500'` 死兜底）。
    //   ★口径（第一版写成 `/777 轮 或 9MB/` 被自己判红逼出来的）：`9MB` 是 `19MB` 的子串
    //     ⇒ 子串式断言分不清"真读了 9"还是"读了 19"。故用 `>` 闭合取值并**逐字比对整个 `<b>` 文本**。
    const thrText = (cfg) => {
        const m = /<b class="sw2-thr">([^<]*)<\/b>/.exec(renderSettingsHtml(world(), { config: cfg }));
        assert.ok(m, '前置：找得到自动入卷阈值那个 <b>');
        return m[1];
    };
    //   夹具给一组**不等于出厂值**的数 ⇒ 印出它们才证明"真在读 config"。
    assert.equal(thrText({ ...CONFIG, limitsTicks: 777, limitsBytesMB: 9 }), '777 轮 或 9MB',
        '★自动入卷阈值必须现读 config（写死 500/5 就印不出 777/9）');
    //   缺值时印的仍是出厂数字（`render()` 被夹具/直调时真源不在手上，属**诚实兜底**而非静默）——
    //   但"生产上必须注入"由下面 leg55 那条接线判据锁死。
    assert.equal(thrText(CONFIG), '500 轮 或 5MB', '缺 config 时兜底印出厂数字（这条分支不再是"永远走的那条"）');
    assert.match(html, /data-action="export-world"/);
    assert.match(html, /data-action="import-world"/);
    // ★leg40b（体检 · A3/D1）：`data-action="player-desc"` 是历史残留——这个 textarea 由
    //   `bindSettingsForm` 按 id 绑 input/change 写入，**不经动作总线**。留着它只会让点击时
    //   走 `dispatchAction` 的兜底分支、在状态条闪一句"接线随后续步骤"。判据：不许回潮。
    assert.ok(!html.includes('data-action="player-desc"'), '★textarea 不许挂 data-action（它不经动作总线）');
    // ★leg40b（体检 · D1）：推进按钮的名字必须与状态栏/参数页同一口径
    assert.ok(html.includes('▶ 推进一轮'), '推进按钮叫「推进一轮」（与状态栏、与参数页同一口径）');
    assert.ok(!html.includes('手动推进一步'), '旧名「手动推进一步」不得回潮（状态栏从来不叫这个）');
});

// ★★leg40b（体检 · C4）：**四维残文**——设置页那句「世界从中摘你的底子（兵力/权位/人脉/耳目）」
//   承诺的是 leg25 c 已按用户令整条删除的四个概念。当年它躲过禁词锁整整十五棒，原因是**夹具的问题**：
//   旧夹具的 `playerDesc` 是「我名黄坤，炼气九层。」——不含那四个词。
// ★★★leg87 口径升级（用户令「A 删了」）：玩家描述那个框**整张卡已撤** ⇒ "夹具描述必须含四维词"
//   这条反向自证**失去对象**（没有回显就无所谓"真写一段描述时会带出什么"）。
//   ⇒ 本锁改成锁**更宽也更准**的一件事：**整个面板产物**（八页签，不只是设置页）里不许出现四维词。
//     它比原来更宽：当年只扫设置页，而现在夹具世界的实体/编年/设定文本都可能带出这些词
//     （那条正是 leg40b 的原始教训："扫描面也是覆盖面"）。★不是放宽——是换一个不会空绿的对象。
test('★leg40b→leg87：整个面板产物零四维残文（四维已整条删除，八个页签一并扫）', () => {
    const TERMS = ['兵力', '权位', '人脉', '耳目'];
    const w = world();
    // ★反向自证（防"扫的是空气"）：夹具**故意**放一个带四维词的实体名进去 ⇒ 若扫描面漏了这一段，
    //   本用例的前置断言会红，而不是静默通过。这一步替代了原来那条"夹具 playerDesc 必须含四维词"。
    w.entities.push({ id: 'e_probe', kind: 'character', name: '兵力探针', location: '未明' });
    const all = renderAll(w, { config: CONFIG, oldVolumes: VOLUMES });
    const scanned = deepStrings(all).map(textOnly).join('\n');
    assert.ok(scanned.includes('兵力探针'), '★前置：扫描面真的覆盖到了实体名那一族（否则本锁是空绿）');
    // ① 界面自己的工作文案零四维：把那枚探针摘掉再扫（探针是"账上的内容"，不是"界面说的话"）
    const clean = renderAll(world(), { config: CONFIG, oldVolumes: VOLUMES });
    const visible = deepStrings(clean).map(textOnly).join('\n');
    assert.ok(visible.length > 3000, `★前置：产物必须有内容（实测 ${visible.length} 字符）`);
    for (const term of TERMS) {
        assert.ok(!visible.includes(term), `面板正文不得出现「${term}」（四维已整条删除，leg25 c）`);
    }
});

// ★★★leg87（用户令「这个也有问题，改也改不了是死的不会根据模型变化」）：**单轮超时/输出上限从"读数"变控件**。
//   这条锁守三件事（每一件都是旧形态真缺的）：
//     ① **不许再是 readonly**（旧的那一格 leg15 起写着"只读展示态"，一路挂到 leg86 才被人眼抓出来）；
//     ② **值必须现读 config**（换模型/换网关要能改；旧形态印的是编译期常量 ⇒ 永远一动不动）；
//     ③ **写通道必须真的存在**（`data-settings` 声明 + 数字校验入口 `sw2NormalizeNumericSetting`），
//        否则又是一枚"画出来点不动"的控件——正是用户这次抱怨的那类东西。
test('★★★leg87：单轮超时/输出上限是**可填控件**（不是只读常量），且值现读 config', () => {
    const html = renderSettingsHtml(world(), { config: CONFIG });
    assert.match(html, /id="sw2_call_timeout"[^>]*data-settings="callTimeoutSec"/, '★超时那一格必须可写（data-settings 声明写通道）');
    assert.match(html, /id="sw2_call_tokens"[^>]*data-settings="callMaxTokens"/, '★输出上限那一格同上');
    assert.ok(!/id="sw2_call_(timeout|tokens)"[^>]*readonly/.test(html), '★不许再挂 readonly（"改也改不了"就是它）');
    assert.ok(!html.includes('id="sw2_limits"'), '★旧的只读展示框 `sw2_limits` 已撤，不许回潮');
    // ② 现读 config：给一组**不等于出厂值**的数 ⇒ 印出它们才证明"真的在读"
    const custom = renderSettingsHtml(world(), { config: { ...CONFIG, callTimeoutSec: 300, callMaxTokens: 32768 } });
    assert.match(custom, /id="sw2_call_timeout"[^>]*value="300"/, '★填过的超时必须印出来（写死 120 就印不出 300）');
    assert.match(custom, /id="sw2_call_tokens"[^>]*value="32768"/, '★填过的输出上限必须印出来');
    // ③ 缺 config 时印**出厂真源**（不是渲染层自己抄的数）
    const dflt = renderSettingsHtml(world(), { config: {} });
    assert.match(dflt, new RegExp(`id="sw2_call_tokens"[^>]*value="${PROPOSED_CALL_LIMITS.maxTokens}"`),
        '★没填过时必须印 `PROPOSED_CALL_LIMITS`（出厂真源，与引擎真正吃的那个数同源）');
    assert.match(dflt, new RegExp(`id="sw2_call_timeout"[^>]*value="${Math.round(PROPOSED_CALL_LIMITS.timeoutMs / 1000)}"`));
});

test('K35/A-9 设置页：旧卷清单（卷号/信息/阅卷动作）入面；无卷时"尚未入卷"', () => {
    const html = renderSettingsHtml(world(), { config: CONFIG, oldVolumes: VOLUMES });
    assert.match(html, /入卷清单/);
    assert.match(html, /sw2-vol">卷一/);
    assert.match(html, /data-action="read-volume"/);
    const empty = renderSettingsHtml(world(), { config: CONFIG, oldVolumes: [] });
    assert.match(empty, /尚未入卷/);
});

test('K35/A-9 阅卷视图：卷段行还原（编年行形状→HTML，引擎 id 只进悬停；空卷防御）', () => {
    const rows = [
        { tick: 3, text: '天时骤变', eventRef: 'ev_3' },
        { tick: 4, text: '坊市斗殴', eventRef: '' },
    ];
    const html = renderVolumeReadHtml('卷一', rows);
    assert.match(html, /data-volume="卷一"/);
    assert.match(html, /sw2-ch-round">3</);
    assert.match(html, /天时骤变/);
    assert.match(html, /title="ev_3"/);
    const text = String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    assert.ok(!text.includes('ev_3')); // id 只在悬停，不进可见文本
    const empty = renderVolumeReadHtml('卷二', []);
    assert.match(empty, /（空卷）/);
});

test('K33 编码安全：实体名/编年文本/表单值含 <script> 全转义', () => {
    const w = world();
    w.entities.find((e) => e.id === 'e_xie').name = '<script>alert(1)</script>';
    const side = renderBoardHtml(w).side;
    assert.ok(!side.includes('<script>'));
    const cfg = { ...CONFIG, baseUrl: '<img src=x onerror=alert(1)>' };
    const setHtml = renderSettingsHtml(w, { config: cfg });
    assert.ok(!setHtml.includes('<img src=x onerror=alert(1)>'));          // 原串不残存
    assert.ok(setHtml.includes('&lt;img src=x onerror=alert(1)&gt;'));      // 转义后落地
    assert.equal(escapeHtml('a&b<c>"d\''), 'a&amp;b&lt;c&gt;&quot;d&#39;');
});

test('K34 防御：全空世界六页签不炸（空态合法）', () => {
    const bare = { version: 1, context: { world: 'x', tension: 0.5, positions: ['x'] }, entities: [], weights: {}, agendas: [], events: [], chronicle: [], meta: { tick: 0 } };
    const all = renderAll(bare);
    assert.ok(all.setting.includes('尚未抽取'));
    assert.ok(all.entities.includes('（全册 0 · 本轮镜头 0）'));
    assert.ok(all.board.agendaStrip.includes('sw2-agenda-empty'));
    assert.ok(all.archive.includes('尚未入卷'));
});

test('K46+leg21 观棋·张力与浪尖各归各格；★★leg98 信息带改**两栏**（世情 3 键 ＋ 三行读数），带里的「大势」格撤下', () => {
    const mk = () => ({
        version: 1, context: {
            world: 'x', tension: 0.5, positions: ['x'],
            setting: { dynamic: { tension: { polarity: '正邪相争', direction: '魔涨道消', intensity: 0.82 }, env: { 民生度: '艰难', 动乱度: '动荡', 天时: '大灾', 张力推手: '紧绷' }, derivedFrom: ['浪尖:a_1@3'] } },
        },
        entities: [{ id: 'e_a', kind: 'faction', name: '甲宗', location: 'x' }], weights: { e_a: 0.9 },
        agendas: [{ id: 'a_1', owner: 'e_a', goal: '血洗洛城', stage: '用兵', visibility: 'known', maxSteps: 3, progress: 2, closed: true, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } }],
        // ★leg98：**必须给一件真事** —— `renderPanoramaHtml` 在"一件事都没有"时走**空态**
        //   （"还没长出可讲的事"）⇒ 整块四层（含顶上那格「大势」）根本不渲染，
        //   下面那条"整页大势只许出现一次"就会**空绿**（实测 0 次 ⇒ 当场红）。
        //   ★这正是本仓那条纪律：**先让前置条件成立，再断言**（否则测的是空态、不是要测的东西）。
        events: [{ id: 'ev_1_1', title: '甲宗异动', source: { type: 'state' }, position: 'x', ripples: ['e_a'], links: {}, closed: false }],
        chronicle: [], milestones: [], meta: { tick: 3, simLog: [] },
    });
    const { infoband, digest } = renderBoardHtml(mk());
    // ★★★leg98 改口径（用户令「**里面有两个大势卡片留一个就好了**，世情 · 3 键，还有浪尖，张力，盘算数量
    //   你看看怎么集合起来好看」，并在三套候选里选了**乙**）：
    //   ① **带里的「大势」格撤下** —— 它与四层顶上那格是**同一句话**（`canon.situation` 原文照印）；
    //      照 leg97 裁 `digest` 的同一条口径：**同一件事不说两遍，留"书的原文"那一份**。
    //      ⇒ 旧断言 `infoband.includes('sw2-band-label">大势</div>')` 与那两条"趋势段切片"的断言
    //        **按新口径重写**（不是删掉了事）：现在钉的是"**带里一次大势都不印**"，
    //        而"只有一处"这个语义挪到**整页**去核（见下面那条 `说书` 的联动核验）。
    //   ② 五格平铺 → **两栏**：左＝世情 3 键（竖排）· 右＝三行读数（盘算 / 张力 / 浪尖）。
    //      理由：这四样的**排版类型本来就不同**（刻度行 / 一句话 / 条目 / 一个数），
    //      塞进同一条边等宽排开就是"高的顶天花板、矮的留一片空"（用户原话「极为难看」）。
    assert.ok(infoband.includes('sw2-band-read'), '★读数区（右栏）在位');
    assert.ok(infoband.includes('世情 · 3 键'), '世情那三格仍在带里（左栏 · 三格是参数页那三格）');
    assert.ok(!infoband.includes('sw2-band-label">大势</div>'), '★带里不许再有「大势」格（它与四层顶上那格是同一句话）');
    assert.ok(!infoband.includes('sw2-trend'), '★旧那条大势行（`.sw2-trend`）随撤格退场（不许留成零生产点的死类）');
    const bandOnly = infoband.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    assert.ok(!bandOnly.includes('大势未聚'), '★带里不再印"大势未聚"那种兜底句（大势那一格已经不在了）');
    // ② 三行读数各自在位，且**行首小标签**是"这一行是什么"的唯一线索
    //   ★写法注意：标签里可能带后缀（「浪尖 · 刚收尾的大动作」）⇒ 用正则，别拿 `>浪尖<` 这种紧凑字面量
    //     （那是本仓"判据被自己写死"的老坑：内容没变、只因多了几个字就假红）。
    for (const key of ['盘算', '张力', '浪尖']) {
        assert.match(infoband, new RegExp(`<span class="sw2-readkey">${key}`), `★读数区要有「${key}」那一行的小标签`);
    }
    // ★★leg52（用户令「**大势就放大势，浪尖就放浪尖**」）：浪尖从大势行**撤走**，只留独立那一行。
    //   旧断言是 `infoband.includes('浪尖：血洗洛城')`（浪尖入大势句）——那条**正是要治的病**：
    //   同一屏里 `derivedFrom` 画了两遍（大势行末尾 slice(0,2) + 独立栏 map 全部），
    //   信息带可见字符只有 280，两处合计约占**四分之一**。
    //   ⇒ 定稿判据（照 R2「同一事实不许说两遍」写成**可机械核**的形状）：
    //     ① 浪尖的事实**出现**（在它自己那一行里，目标名不露 id）；
    //     ② 整个信息带里「浪尖」这个词**恰好一次**（不是 0 次，也不是 2 次）。
    assert.ok(infoband.includes('浪尖 · 刚收尾的大动作'), '★浪尖留在它自己那一行（标签在位）');
    assert.ok(infoband.includes('血洗洛城'), '浪尖的事实照旧上板（目标名不露 id）');
    const tideLabelCount = (infoband.match(/浪尖/g) || []).length;
    assert.equal(tideLabelCount, 1, `★同一屏里「浪尖」只许出现一次（实测 ${tideLabelCount} 次）`);
    // leg25 b（A1b）：张力行不再写「烈度带词 + 百分比」——那个 % 实测只反映事件密度（rival 腿恒为满值），
    //   带词会暗示"引擎判断了天下张力"。改为直说可验证的事实：近 N 轮事件几件。
    assert.ok(!infoband.includes('烈度'), '张力行不再用「烈度」带词（它暗示引擎判断了张力）');
    // ★leg98：夹具现在有**一件**真事（为了上面的"大势只许一处"能真渲染出四层）⇒ 这个数从 0 变 1。
    //   口径没变，仍然是"直说可验证的事实"。
    assert.ok(infoband.includes('近10轮事件 1 件'), '张力行改说可验证事实：近 N 轮事件数（本夹具 1 件）');
    assert.ok(!infoband.includes('>82<'), '推导出的百分比不再上面板（它只反映事件密度）');
    assert.ok(infoband.includes('魔涨道消（原文方向）'), '方向在张力行（原文措辞）');
    assert.ok(infoband.includes('正邪相争'), '张力极在张力行');
    // ★★leg98：**"两个大势卡片留一个"** 那条口径的**可机械核**形状。
    //   ★第一版我写的是"整页「大势」这个词只许出现一次"—— **当场红，实测 3 次，而三次都是对的**
    //     （本棒留档：这是"尺子错"，不是产品错）：
    //       ① 四层顶上那格的标签「大势 · 书里写定的局面（原文措辞）」；
    //       ② 缺世情时的如实标注里那个词（"这本账没留**大势**句"）；
    //       ③ 那句释义「**大势**是书里写定的**何故**」。
    //     ⇒ **用户说的是"两个大势卡片留一个"，数的是"卡片"，不是"字"**。
    //       卡片 = 顶上那一格；释义与缺省标注是说明文，不是卡片。
    //   ★定稿：钉**那一格**在整页恰好一处（用它的**精确标签**，不是词频），且带里那格确实没了。
    const { panorama } = renderAll(mk(), { config: {} });
    const headCount = (panorama.match(/大势 · 书里写定的局面/g) || []).length;
    assert.equal(headCount, 1, `★★「大势」那**一格**在整页只许一处（实测 ${headCount} 处）——带里那格与四层顶上那格是同一句话`);
    assert.ok(!infoband.includes('大势 · 书里写定的局面'), '★带里不许再有那一格（它的家在四层顶上）');
    assert.ok(!infoband.includes('sw2-band-label">大势'), '★带里连那个小标签都不许留');
    // ★另一半：**有**世情时，那句话本身在整页也只许出现一次（这才是"同一句话不说两遍"的字面口径）
    const w2 = mk();
    w2.context.setting.frozen = { canon: { situation: '甲宗兵压江州' } };
    const p2 = renderAll(w2, { config: {} }).panorama;
    const b2 = renderBoardHtml(w2).infoband;
    const sitCount = (`${p2}${b2}`.match(/甲宗兵压江州/g) || []).length;
    assert.equal(sitCount, 1, `★★那句原文在整页只许出现一次（实测 ${sitCount} 次）：它住四层顶上那一格`);
    assert.match(p2, /甲宗兵压江州/, '★它确实在四层顶上那格（不是被整句撤掉了）');
    assert.match(digest, /参数：乱象动荡、天时大灾、时局紧绷。/, 'leg26+leg53：参数档位在时局句副句如实列出（三格，民生已撤）');
});

test('★细案实体页：三列版式（旧六格版式已按细案重做）', () => {
    // 旧版（leg25 f）把这一页做成**六格一义**（名号/位置/归属·来历/在办/最近/查）；leg49 细案定稿**三格**：
    //   位置列 23.5% 有值、活跃列 3.9% 有值（真账 621 实体实测）⇒ 恒空的列占版面的 2/5，是把信号淹在噪声里。
    // 本用例锁"新版式"的结构判据（不锁措辞，锁结构 + 空态口径）：
    const w = {
        version: 1, context: { world: 'x', tension: 0.5, positions: ['x'], playerId: 'e_p' },
        entities: [
            { id: 'e_p', kind: 'character', name: '你', location: 'x' },
            { id: 'e_f', kind: 'faction', name: '昆仑道宫', location: '未明', '规模': '正道仙门魁首', branches: ['盐帮'] },
            { id: 'e_c', kind: 'character', name: '玄一道祖', location: '未明', parent: '昆仑道宫', '实力': 'T9渡劫巅峰' },
        ],
        weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0 },
    };
    const html = renderEntitiesHtml(w);
    // ★leg49（细案定稿三格）：名号 / 归属与来历 / 在办的事——旧六格（名号/位置/归属·来历/在办/最近/查）已重做
    for (const cls of ['sw2-c-name', 'sw2-relone', 'sw2-agcell']) {
        assert.ok(html.includes(`class="sw2-cell ${cls}"`), `格子 ${cls} 在位`);
    }
    assert.ok(!html.includes('sw2-c-loc'), '★位置列退场');
    // ② 空态**不占版面**（旧版是虚线 chip「未载」+ 一整列 76% 都印它）⇒ 空态一律留白
    assert.ok(!html.includes('未载'), '★「未载」不进版面（细案：空态一律不占版面）');
    // ③ 归属与来历是**一格一串**（同源的事用 ` · ` 连起来），不再是竖排标签行
    assert.ok(html.includes('sw2-relone'), '归属与来历有独立容器');
    assert.ok(html.includes('正道仙门魁首'), '规模原话入面（在归属与来历格里）');
    assert.ok(html.includes('盐帮'), '分支入面');
    assert.ok(html.includes('昆仑道宫') && html.includes('T9渡劫巅峰'), '归属与实力原话同串入面');
    // ④ 空态不占版面：没有来历的角色那一格**留白**（不再印「未载归属」这类词）
    assert.ok(!html.includes('未载归属') && !html.includes('sw2-orphan'), '★空态词不进版面（细案：一律留白）');
    // ★终审 M7 顺带：这条原先锚在 `<span class="sw2-relval">未明</span>` 上——而 `.sw2-relval` 是本笔删掉的
    //   **零生产者死规则**（旧六列版式的"关系值"）⇒ 那条断言当时已经变成**恒真**（那个串永远不可能出现）。
    //   ⇒ 改锚到**真产物**：**列表体**里不许出现占位词「未明」（谁把位置列搬回来必红）。
    //   ★范围与例外（都是实测逼出来的）：整页扫不行——工具条那句三态释义与**行内「查」钮的悬停**里都写着
    //     「书未明述」（"书里确实没写"的既有术语，不是占位词）。故：切**列表体** + 只把「书未明述」这一处
    //     合法术语抹掉（抹掉的是**另一个词**，不是把要审的占位词从扫描里抠出去）。
    const body = bodyOf(html);
    assert.ok(body.includes('昆仑道宫'), '前置对照：列表体真的切出来了（否则下面那条是空串上的恒真断言）');
    assert.equal(w.entities.filter((e) => e.location === '未明').length, 2, '前置：夹具里真有两行 `location: "未明"`（否则这条锁是空的）');
    assert.ok(!body.replace(/书未明述/g, '').includes('未明'), '★占位词「未明」绝不作为"值"渲染出来（列表体里零出现）');
});

test('K46 实体页·全册/镜头徽/分支/隶属/麾下（C7/C8 渲染面）', () => {
    const w = {
        version: 1, context: { world: 'x', tension: 0.5, positions: ['x'] },
        entities: [
            { id: 'e_f', kind: 'faction', name: '青龙会', location: 'x', branches: ['盐帮', '漕帮'] },
            { id: 'e_c1', kind: 'character', name: '弟子甲', location: 'x', parent: '盐帮' },
            { id: 'e_c2', kind: 'character', name: '弟子乙', location: 'x', parent: '青龙会' },
        ],
        weights: { e_f: 0.9, e_c1: 0.5, e_c2: 0.4 },
        agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0, simLog: [] },
    };
    const html = renderEntitiesHtml(w);
    assert.ok(html.includes('全部角色与势力（全册 3 · 本轮镜头 3）'), '全册/镜头计数');
    assert.ok(html.includes('在场'), '镜头徽');
    assert.ok(html.includes('<span class="sw2-relone-branch">分支 盐帮、漕帮</span>'), '分支表展示（并入归属与来历串）');
    assert.ok(html.includes('<span class="sw2-relone-who">盐帮</span>') && html.includes('<span class="sw2-relone-who">青龙会</span>'), '角色隶属展示');
    // leg25 b（A1）：麾下成员序由「分量序」改**名号序**（确定性；片3「引擎不拿数值排序」的最后一处）。
    //   注意名号序是 **Unicode 码点序**（不是拼音序）：乙 U+4E59 < 甲 U+7532，故乙在前。
    // ★leg49（三列版式）：麾下名单并入「归属与来历」串（前缀 `麾下 `，旧版是 `<i>麾下</i>` 那一行）
    assert.ok(html.includes('麾下 弟子乙、弟子甲'), '麾下成员派生（含分支成员，按名号序）');
    const text = html.replace(/<[^>]*>/g, '');
    for (const term of BLACKLIST) assert.ok(!text.includes(term), `实体页含禁词「${term}」`);
});

test('第十三棒锁：事件源措辞零代号——把用户实机样例（ripple 行）锁进 A-3 全局扫描', () => {
    const w = world();
    w.events.push({ id: 'ev_3_1', title: '官军出城引发恐慌', source: { type: 'ripple', ref: 'ev_0' }, position: '江州', ripples: ['e_dayu'] });
    w.chronicle.push({ id: 'ch_3_1', tick: 3, text: '事件「官军出城引发恐慌」——沿「薛铁衣发兵催战」而来，事发 江州，牵动 大虞偏将', eventRef: 'ev_3_1' });
    const all = renderAll(w, { config: CONFIG, oldVolumes: VOLUMES });
    // 玩家视线面：编年/动态流/位置速览（大事纪·旧卷的 ids 展开=管理细节豁免，K34 拍板口径）
    const text = [all.chronicle, all.board.feed, all.board.side].map(textOnly).join('\n');
    assert.ok(text.includes('沿「薛铁衣发兵催战」而来'));
    assert.ok(text.includes('牵动 大虞偏将'));
    assert.ok(!/ev_[a-z0-9_]+/.test(text), '玩家可见文本零事件代号（A-3）');
});

// ============ K41/链视图细案：编年五筛（A-16）+ 链视图渲染（A-15 渲染面） ============

function filterWorld() {
    const w = world();
    w.chronicle = [
        { id: 'ch_1_1', tick: 1, text: '盘算「买粮」推进：开仓放粮', kind: 'scheme' },
        { id: 'ch_1_2', tick: 1, text: '事件「边关扣货」——由盘算「买粮」而生，事发 边关', kind: 'major', eventRef: 'ev_1_1' },
        { id: 'ch_1_3', tick: 2, text: '事件「粮道拥堵」——沿「边关扣货」而来，事发 商路', kind: 'ripple', eventRef: 'ev_2_1' },
        { id: 'ch_1_4', tick: 3, text: '旧账：早先的某一行（无章）' },
    ];
    w.milestones = [{ id: 'm_30', span: [0, 30], counts: 8, titles: ['发兵催战'], ids: ['ev_0'] }];
    return w;
}

test('leg24 片1：抄书入口在界面下掉（补抽两枚 + 重抽一枚）+ 设定页清除演化层仍在', () => {
    const w = world();
    w.context.setting.frozen.canon.bookEntities = [
        { name: '薛铁衣', kind: 'character' },
        { name: '大虞偏将', kind: 'character' },
    ];
    const html = renderEntitiesHtml(w);
    assert.ok(!html.includes('data-action="refine-pending"'), '头部批量补抽按钮已下掉');
    assert.ok(!html.includes('data-action="refine-entity"'), '行内补抽按钮已下掉');
    assert.ok(!html.includes('补抽'), '「补抽」字样零残留（书随时可查，不需要按需抄）');
    const set = renderSettingHtml(w);
    assert.ok(set.includes('data-action="clear-evolution"'), '设定页清除演化层按钮仍在（它管引擎自己的演化层，不是抄书）');
    assert.ok(!set.includes('data-action="force-abstract"'), '「重新抽取设定」按钮已下掉（书变自动发现）');
    const settings = renderSettingsHtml(w, { config: CONFIG });
    assert.ok(!settings.includes('data-action="force-abstract"'), '设置页重抽按钮同批下掉');
    // A-3：新文案零禁词（全局视面扫描）
    const all = renderAll(w, { config: CONFIG, oldVolumes: VOLUMES });
    const text = deepStrings(all).map(textOnly).join('\n');
    for (const term of BLACKLIST) assert.ok(!text.includes(term), `含禁词「${term}」`);
});

test('细案 spec-chronicle-page-ia（leg50）：五筛退场——旧口径按设计作废，且不许回潮', () => {
    // ★这一条**替换**了 K41/A-16② 的五筛判据（旧口径）——理由（细案 §3.5，用户拍板 A+B）：
    //   五筛（谋划/大事/牵动/暗处/时局）只是 `kind` 枚举的中文直译，玩家读不出"牵动"与"暗处"的界线；
    //   真账 360 行里玩家真正会问的是"哪句是发生的事、哪句是账"。
    //   ★**账上 `kind` 一个字不动**（链视图/大事纪照旧按它工作）——作废的只是"玩家可见的那一维"。
    //   ★按本仓纪律：旧判据按设计升级并写明理由（不是"测试挂了"），并**加一条"不许回潮"的守门**。
    const all = renderChronicleHtml(filterWorld());
    assert.match(all, /sw2-ch-tools/, '新工具条在位');
    assert.ok(!all.includes('sw2-ch-filter'), '★旧五筛容器 sw2-ch-filter 不许回潮');
    assert.ok(!all.includes('set-filter') && !all.includes('data-filter'), '★旧五筛动作/chip 不许回潮');
    // 玩家可见的类别词只剩这两个（细案 §3.1）：事件 / 账目子类
    assert.match(all, /class="sw2-ch-badge ev">事件</);
    assert.match(all, /class="sw2-ch-badge bk">/);
    // 行仍然全在（"不藏"这条口径一个字没改）：真事件 + 账目都画出来了
    //   ★`filterWorld()` 的夹具是 `kind` 章 + 纯正文，**没有** `事件「X」——` 那种生产者措辞
    //     ⇒ 按兜底规则它们全是账目（这正是"宁可少上一个故事，不许把账当故事印"）。
    //     真事件那一支的形状由 `test/chronicle-page.test.js` 的生产者全集判据咬。
    assert.ok(all.includes('开仓放粮') && all.includes('粮道拥堵') && all.includes('旧账：早先的某一行'),
        '一行都没丢（分层只换"上桌方式"，不换"有没有"）');
    // ★leg94：A-16④（里程碑插行恒显示）**按用户令作废**——见下一条独立判据（含"不许回潮"守门）。
    //   里程碑数据本身零改动：档案页里程碑卡那条判据照旧咬它。
});

test('★leg94：里程碑插行撤出**编年页**（用户令「这个文字出现在编年页签里了」）；数据与档案页不动', () => {
    // 病（用户 2026-09-20 实机看编年页签）：编年页底部重印了 4 行
    //   「⚑ 第 1–10/20/30/40 轮已收进大事纪「…」」——那是**大事纪（旧卷）**的东西。
    // 病灶（源码可证）：`renderChronicleHtml` 把 `world.milestones` 逐纪画一枚 `sw2-ch-roll`；
    //   而同一句话在大事纪页**已经**长在里程碑卡上（`sw2-milestone` = id + span + 标题 + 展开 + 链）
    //   ⇒ 编年页那份是**同一事实的第二块屏**（本仓纪律：一份真源、不重印）。
    // 撤法：删的只是"这一段渲染"，**世界账一个字不动**（milestones 仍是引擎结构摘要，链/记忆桥照读）。
    const w = filterWorld();
    const chron = renderChronicleHtml(w);
    assert.ok(!chron.includes('sw2-ch-roll'), '★编年页不许再有里程碑插行（类名零残留）');
    assert.ok(!chron.includes('已收进大事纪'), '★那句话本身也不许出现（连"换个类名偷偷印"都堵）');
    assert.ok(!chron.includes('发兵催战'), '★里程碑标题不进编年页（它归大事纪页）');
    // 反面：编年的行照旧全在（撤的是插行，不是内容）
    assert.ok(chron.includes('开仓放粮') && chron.includes('旧账：早先的某一行'), '编年行一行未丢');
    // 反面：数据与档案页**一个字没动**——同一份 world 进档案页，4 张里程碑卡照旧（该有的还在，才有得撤）
    const arch = renderArchiveHtml(w, { oldVolumes: VOLUMES });
    assert.equal((arch.match(/class="sw2-milestone"/g) || []).length, 1, '档案页里程碑卡还在（fixture 只有一纪）');
    assert.match(arch, /发兵催战/, '里程碑标题在它该在的页上照旧可见');
    // 反面：观棋页那条**归档提示条**（带「去翻旧账 →」入口）不许被一起误删——它是"从别页指路"。
    assert.match(renderBoardHtml(world()).feed, /已收进大事纪「发兵催战、民生凋敝」/, '观棋页归档提示条照旧');
});

test('K41/A-15 入口：事件行「链」按钮（data-action + data-chain + id 悬停）；非事件行无按钮', () => {
    const html = renderChronicleHtml(filterWorld());
    assert.ok(html.includes('class="sw2-chainbtn" data-action="open-chain" data-chain="ev_1_1"'), '链按钮带 data-action=open-chain 与 data-chain');
    assert.ok(html.includes('title="ev_1_1"'), '悬停 id 在位');
    assert.ok(!html.includes('data-chain="ch_1_1"') && !html.includes('data-chain="ch_1_2"'), '非事件行无链入口');
    // 闭环/涟漪平息行（chainRef 第十五棒补）：同款按钮；eventRef 优先于 chainRef
    const w2 = filterWorld();
    w2.chronicle.push({ id: 'ch_2_1', tick: 4, text: '事件「旧事」涟漪平息（链源已了结）', kind: 'ripple', chainRef: 'ev_9_9' });
    w2.chronicle.push({ id: 'ch_2_2', tick: 5, text: '兼有双引用行', kind: 'major', eventRef: 'ev_1_1', chainRef: 'ev_9_9' });
    const html2 = renderChronicleHtml(w2);
    assert.ok(html2.includes('data-action="open-chain" data-chain="ev_9_9"'), 'chainRef 行挂链（闭环/涟漪平息入口）');
    assert.ok(html2.includes('data-action="open-chain" data-chain="ev_1_1"'), 'eventRef 优先于 chainRef');
    assert.ok(!html2.includes('data-chain="ch_2_2"'), '行自身 id 不挂链');
});

test('第十五棒：历史闭环行（无 chainRef/eventRef）按行 id 解析挂链——旧账不篡改、纯渲染派生', () => {
    const w = filterWorld();
    w.chronicle.push(
        { id: 'ch_6_evc_ev_6_1', tick: 6, text: '事件「旧事」闭环（源盘算已结算）', kind: 'major' },
        { id: 'ch_7_evc2_ev_7_3', tick: 7, text: '事件「旧事」涟漪平息（链源已了结）', kind: 'ripple' },
        { id: 'ch_8_ag_8_1', tick: 8, text: '盘算行（不匹配 evc 模式）', kind: 'scheme' },
        { id: 'ch_9_evc_9_1', tick: 9, text: '残缺 id 形态（无 ev_ 事件段）', kind: 'major' },
    );
    const html = renderChronicleHtml(w);
    assert.ok(html.includes('data-action="open-chain" data-chain="ev_6_1"'), '历史闭环行解析挂链');
    assert.ok(html.includes('data-action="open-chain" data-chain="ev_7_3"'), '历史涟漪平息行解析挂链');
    assert.ok(html.includes('title="ev_6_1"'), '解析 id 只进悬停');
    assert.ok(!html.includes('data-chain="ch_8_ag_8_1"') && !html.includes('data-chain="ch_9_evc_9_1"'), '非 evc 模式不误挂');
    const text = String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    assert.ok(!/ev_[a-z0-9_]+/.test(text), '解析 id 不进可见文本（A-3）');
});

function chainWorld() {
    return {
        version: 1,
        context: { world: '江州', tension: 0.5, positions: ['江州'] },
        entities: [
            { id: 'e_gov', kind: 'faction', name: '江州官府', location: '江州' },
            { id: 'e_du', kind: 'character', name: '大虞偏将', location: '江州' },
        ],
        weights: {},
        agendas: [
            { id: 'a_1', owner: 'e_gov', goal: '筹备江州防务', stage: '征集', visibility: 'known', maxSteps: 5, progress: 2, memory: { promises: [], done: ['t1: 征调商行出力'], blocked: ['t2: 放弃（粮道已绝）'], turnsAlive: 2 } },
            { id: 'a_2', owner: 'e_du', goal: '打通边关商路', stage: '通商', visibility: 'concealed', maxSteps: 4, progress: 3, parentId: 'a_1', memory: { promises: [], done: ['t3: 守将首肯，车队放行'], blocked: [], turnsAlive: 3 } },
        ],
        events: [
            { id: 'ev_1_1', title: '官军出城引发恐慌', source: { type: 'plot', ref: 'a_2' }, position: '江州', ripples: [], links: { up: [], down: [] }, closed: false },
            { id: 'ev_2_1', title: '边关商路重开', source: { type: 'ripple', ref: 'ev_1_1' }, position: '江州', ripples: [], links: { up: ['ev_1_1'], down: [] }, closed: false },
            { id: 'ev_3_1', title: '江州粮价上涨', source: { type: 'ripple', ref: 'ev_2_1' }, position: '江州', ripples: [], links: { up: ['ev_2_1'], down: [] }, closed: true },
        ],
        chronicle: [],
        milestones: [],
        meta: { tick: 6 },
    };
}

test('K41/A-15 链视图渲染：珠链结构 + 事实措辞面 + 暗徽/结局徽 + 防御态', () => {
    const w = chainWorld();
    const chain = expandChain(w, 'ev_2_1');
    const html = renderChainViewHtml(chain, { world: w, volumes: [{ id: '卷A', info: '', fromTick: 1, toTick: 40 }] });
    assert.ok(html.includes('sw2_chain_view'));
    assert.match(html, /事件「边关商路重开」的来去/);
    assert.match(html, /沿「官军出城引发恐慌」而来/);            // root 源自（最近上游）
    assert.match(html, /由盘算「打通边关商路」而生/);            // 上游事件的来路（弧线）
    assert.match(html, /打通边关商路/);
    assert.match(html, /v-hidden">暗</);                          // 暗徽（concealed 弧线）
    assert.match(html, /在办/);
    assert.match(html, /委派自上/);
    assert.match(html, /最近一步：t3: 守将首肯，车队放行/);
    assert.match(html, /牵动 · 下沿/);
    assert.match(html, /江州粮价上涨/);
    assert.ok(!html.includes('data-action="read-volume"'), '热世界链无阅卷按钮（无纪）');
    // 防御态
    assert.match(renderChainViewHtml(null, { world: w }), /已无从检索/);
});

test('★★★leg93c：事件链**不再插进编年页**——改走浮层（用户令「点击后直接弹出一个小窗口」）', () => {
    // 病（用户原话）：「**事件链条点击后不要放在编年页了，直接弹出一个小窗口，
    //   要不然我在大事纪页签点击还得回到编年页**」。
    // 根因（源码可证）：旧 `bus['open-chain']` 把渲染好的链视图
    //   `insertAdjacentHTML('afterbegin')` 到**写死的 `#sw2_view_chronicle`** ⇒
    //   「链」按钮在**两处**（编年页 + 大事纪·旧卷页，C-1 两个入口），从大事纪点，
    //   内容却进了**另一个页签** ⇒ 玩家看到"点了没反应"，得自己切回编年页。
    // ★为什么必须锁**接线层**（照本仓 leg55 那条先例）：渲染器（`renderChainViewHtml`）一直是好的——
    //   出错的是"**把渲染结果塞到哪儿**"，而那句话只活在 `web/index.js` 的动作总线里。
    const src = readFileSync(new URL('../web/index.js', import.meta.url), 'utf8');
    const at = src.indexOf("bus['open-chain']");
    assert.ok(at > 0, '动作总线里必须有 open-chain');
    const body = src.slice(at, at + 4200);
    // ① 正面：交给浮层（容器 id 一处定义、由常量引用）
    assert.ok(body.includes('CHAIN_MASK_ID'),
        '★链视图必须进浮层（`CHAIN_MASK_ID`）——不许再往页签里插');
    assert.ok(/document\.body\.appendChild\(mask\)/.test(body),
        '★浮层挂在 `document.body` 上（**不在面板窗口里** ⇒ 面板关着也能看）');
    // ② 反面：**绝不许**再往编年页那个容器里插
    assert.ok(!body.includes('sw2_view_chronicle'),
        '★★链视图不许再插进 `#sw2_view_chronicle`（这就是用户报的那个病：在大事纪点、内容跑到编年页）');
    assert.ok(!/insertAdjacentHTML/.test(body),
        '★★尤其不许 `insertAdjacentHTML` 到某个页签容器里');
    // ③ 三条关闭路径都要在（否则弹出来关不掉 = 另一种"点了没反应"）
    assert.ok(/function closeChainPopup/.test(src), '收口函数必须在（按钮/点背景/ESC 三条路共用它）');
    assert.ok(body.includes("bus['chain-close']") || src.slice(at).includes("bus['chain-close']"),
        '「收起」按钮要走同一条收口');
    // ④ ★浮层自己的按钮委托（**这条最容易被漏**）：面板的动作总线 `bindActions` 挂在
    //    `#story_world2_window` 上，而浮层挂在 `document.body` ⇒ 浮层里自带的
    //    「收起」(`chain-close`) 与「阅卷」(`.sw2-goto`) **走不到那条总线**，会点了没反应。
    assert.ok(/const goto = t\?\.closest\?\.\('\.sw2-goto'\)/.test(body) || body.includes(".closest?.('.sw2-goto')"),
        '★浮层必须自己接住 `.sw2-goto`（阅卷 ⇒ 先收浮层再切页签，否则浮层挡住玩家要看的东西）');
    assert.ok(body.includes('closeChainPopup();') && body.includes('CHAIN_MASK_ID'),
        '★浮层内的点击与收口必须接上');
    // ⑤ ESC 用**捕获阶段 + stopPropagation**：面板自己有一条"ESC 关整个窗口"，
    //    不拦的话按一次 ESC 会**把面板一起关掉**（用户要的是关这个小窗）
    assert.ok(/addEventListener\('keydown', onEsc, true\)/.test(src),
        '★ESC 必须在捕获阶段挂（且 `stopPropagation`）——不许连面板一起关');
});

test('K41/A-15 里程碑穿透渲染：纪珠 + 聚合 parents + 卷区间装配阅卷 + 下沿余尾', () => {
    const w = chainWorld();
    w.events = w.events.filter((e) => e.id !== 'ev_1_1');         // 上游归档入纪
    w.milestones = [{ id: 'm_30', span: { from: 1, to: 30 }, counts: { events: 7 }, titles: ['穷山的来客'], ids: ['ev_1_1'], links: { up: [], down: ['ev_2_1'] } }];
    const chain = expandChain(w, 'ev_2_1');
    const vols = [
        { id: '卷一', info: '', fromTick: 1, toTick: 30 },
        { id: '卷二', info: '', fromTick: 31, toTick: 60 },
    ];
    const html = renderChainViewHtml(chain, { world: w, volumes: vols });
    assert.match(html, /大事纪/);
    assert.match(html, /第 1–30 轮 · 7 件事/);
    assert.match(html, /穷山的来客/);
    assert.match(html, /纪之源头已不可查/);
    assert.ok(html.includes('data-vol="卷一"'), 'span 区间命中的卷装配阅卷');
    assert.ok(!html.includes('data-vol="卷二"'), '区间外的卷不装配');
    assert.match(html, /另有后续在旧卷/, '下沿余尾收敛珠');
});

test('K41/A-3：链视图可见文本零禁词零代号（管理豁免区剥除外；热链与跨纪链双扫）', () => {
    const scan = (html) => {
        const stripped = String(html).replace(/<details[\s\S]*?<\/details>/g, '');
        const text = stripped.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
        for (const term of BLACKLIST) assert.ok(!text.includes(term), `链视图含禁词「${term}」`);
        assert.ok(!/ev_[a-z0-9_]+/.test(text), '链视图可见文本零事件代号');
        assert.ok(!/a_\d+/.test(text), '盘算代号不裸出（只进悬停/管理区）');
    };
    scan(renderChainViewHtml(expandChain(chainWorld(), 'ev_2_1'), { world: chainWorld() }));
    const w = chainWorld();
    w.events = w.events.filter((e) => e.id !== 'ev_1_1');
    w.milestones = [{ id: 'm_30', span: { from: 1, to: 30 }, counts: { events: 7 }, titles: ['穷山的来客'], ids: ['ev_1_1'], links: { up: [], down: ['ev_2_1'] } }];
    scan(renderChainViewHtml(expandChain(w, 'ev_2_1'), { world: w }));
});

// ============ 细案 spec-entities-page-ia：实体页数据选择层（纯函数） ============
test('细案实体页：选行 = 搜索 ∪ 类别 ∪ 筛选，且搜索**覆盖位置**（位置不占列 ≠ 查不到）', () => {
    const w = {
        version: 1, context: { world: 'x', playerId: 'e_p' }, entities: [
            { id: 'e_a', kind: 'character', name: '玄一道祖', location: '西极昆仑山', parent: '昆仑道宫', '实力': 'T9渡劫巅峰' },
            { id: 'e_b', kind: 'faction', name: '万法阁', location: '东海浮空岛', '规模': '极富', '性质': '修真百艺总坛' },
            { id: 'e_c', kind: 'character', name: '无名散人', location: '未明' },
        ],
        weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 5 },
    };
    const base = { ...ENTS_DEFAULT_VIEW };
    assert.equal(selectEntityPage(w, base).hit, 3, '不筛 = 全量');
    // ★位置不在版面上，但必须在搜索面里
    assert.equal(selectEntityPage(w, { ...base, q: '东海浮空岛' }).hit, 1, '★搜位置命中（位置不占列 ≠ 查不到）');
    assert.equal(selectEntityPage(w, { ...base, q: '昆仑道宫' }).hit, 1, '搜归属命中');
    assert.equal(selectEntityPage(w, { ...base, q: 'T9渡劫' }).hit, 1, '搜实力原话命中');
    assert.equal(selectEntityPage(w, { ...base, q: '修真百艺' }).hit, 1, '搜性质原话命中');
    assert.equal(selectEntityPage(w, { ...base, kind: 'faction' }).hit, 1, '类别筛');
    assert.equal(selectEntityPage(w, { ...base, filters: ['orphan'] }).hit, 2, '无归属筛（万法阁 + 无名散人）');
    assert.equal(selectEntityPage(w, { ...base, filters: ['named'] }).hit, 1, '有归属筛');
    assert.equal(selectEntityPage(w, { ...base, q: '不存在的词' }).hit, 0, '搜不到 = 0（不是全量）');
});

test('细案实体页：排序三档（在办优先 / 最近活跃优先 / 按名号）', () => {
    const w = {
        version: 1, context: { world: 'x' }, entities: [
            { id: 'e_1', kind: 'character', name: '丙', lastActiveTick: 3 },
            { id: 'e_2', kind: 'character', name: '甲', lastActiveTick: 9 },
            { id: 'e_3', kind: 'character', name: '乙' },
        ],
        weights: {}, agendas: [{ id: 'a_1', owner: 'e_3', goal: '在办', closed: false, progress: 1, maxSteps: 3 }],
        events: [], chronicle: [], milestones: [], meta: { tick: 9 },
    };
    const base = { ...ENTS_DEFAULT_VIEW };
    assert.deepEqual(selectEntityPage(w, { ...base, sort: 'active' }).rows.map((e) => e.name), ['乙', '甲', '丙'], '在办优先，其余按最近活跃');
    assert.deepEqual(selectEntityPage(w, { ...base, sort: 'recent' }).rows.map((e) => e.name), ['甲', '丙', '乙'], '最近活跃优先');
    // ★环境偏离（leg49 T1，已在 task-1-report.md 记录）：任务书原断言为 ['丙','乙','甲']（拼音序），
    //   但本机 Node v24.19.0 / ICU 78.3 **不含拼音排序数据**——`new Intl.Collator('zh-u-co-pinyin')`
    //   的 resolvedOptions().collation === 'default'，`localeCompare(..., 'zh')` 落到部首/笔画回退序
    //   （乙**排最后**，不是拼音的 yǐ 排第二）。实测 ['丙','甲','乙'] 才是本环境真实序；
    //   实现侧一行未改（仍是 localeCompare(name, 'zh')）。
    assert.deepEqual(selectEntityPage(w, { ...base, sort: 'name' }).rows.map((e) => e.name), ['丙', '甲', '乙'], '按名号（本机 ICU 真实序，非拼音序）');
});

test('细案实体页：分页 —— 一屏 60 行、页码越界夹紧、from/to 如实', () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ id: `e_${i}`, kind: 'character', name: `名${String(i).padStart(3, '0')}` }));
    const w = { version: 1, context: { world: 'x' }, entities: many, weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 1 } };
    const base = { ...ENTS_DEFAULT_VIEW };
    const p1 = selectEntityPage(w, base);
    assert.equal(p1.pages, 3, '130 条 / 60 = 3 页');
    assert.equal(p1.rows.length, 60, '★首屏只渲染 60 行（判据 J10）');
    assert.equal(p1.from, 1); assert.equal(p1.to, 60);
    const p2 = selectEntityPage(w, { ...base, page: 2 });
    assert.equal(p2.page, 2); assert.equal(p2.from, 61); assert.equal(p2.to, 120);
    const p3 = selectEntityPage(w, { ...base, page: 3 });
    assert.equal(p3.rows.length, 10); assert.equal(p3.to, 130);
    assert.equal(selectEntityPage(w, { ...base, page: 99 }).page, 3, '★页码越界夹到最后一页（不是空页）');
    assert.equal(selectEntityPage(w, { ...base, page: 0 }).page, 1, '★页码 0/负数夹到第一页');
    assert.equal(selectEntityPage(w, { ...base, q: '名00' }).rows.length, 10, '筛完再分页（命中 10）');
});

test('细案实体页：命中计数七格（chip 上的数不许写死）', () => {
    const w = {
        version: 1, context: { world: 'x' }, entities: [
            { id: 'e_1', kind: 'faction', name: '有家的', parent: '上级' },
            { id: 'e_2', kind: 'character', name: '孤身的' },
            { id: 'e_3', kind: 'character', name: '最近动过的', lastActiveTick: 7 },
        ],
        weights: {}, agendas: [{ id: 'a_1', owner: 'e_2', goal: 'g', closed: false }], events: [], chronicle: [], milestones: [], meta: { tick: 7 },
    };
    assert.deepEqual(entsHitCounts(w), { all: 3, faction: 1, character: 2, busy: 1, recent: 1, named: 1, orphan: 2 });
});

// ============ 细案 spec-entities-page-ia：三列版式（位置列/活跃列退场） ============
test('★细案实体页 J1/J2：位置列与活跃列**不得出现**；位置在渲染结果里零出现（列已撤）', () => {
    const w = world();
    const html = renderEntitiesHtml(w);
    // 本仓已有先例（`:87` 那条 leg27 版式锁）在用例内自读样式表：样式与版式必须对得上，读的是**真文件**
    const css = readFileSync(path.join(ROOT, 'web', 'style.css'), 'utf8');
    for (const cls of ['sw2-c-loc', 'sw2-c-active', 'sw2-c-act']) {
        assert.ok(!html.includes(cls), `★格子 ${cls} 必须退场（细案 J1）`);
    }
    assert.ok(!html.includes('最近活跃'), '★「最近活跃」不进版面（细案 J6：只进排序与筛选）');
    assert.ok(!html.includes('sw2-locval'), '★位置值不占列');
    // ★但位置必须在**搜索面**里（J2 的另一半：不占列 ≠ 查不到）
    const hit = selectEntityPage(w, { ...ENTS_DEFAULT_VIEW, q: '黄府' });
    assert.ok(hit.hit >= 1, '★搜位置仍能命中（w.context.playerId 那位在「黄府」）');
    // ★Task 5 评审·第二轮 #1（同一份"版式与样式必须对得上"的纪律，这里把它钉成断言）：
    //   样式表里 `.sw2-entity-row` 只许**声明一次**——评审第一轮"就地删掉旧六列那条、在下面另写一条新的"
    //   ⇒ 同一选择器两处声明（上一条静默被盖），且唯一解释六列版式的散文指向了不存在的位置。
    //   下面这条咬三件事：① 恰好一条裸声明；② 它落的版位在 `.sw2-relone`（那一格）**之前**；
    //   ③ 三列栅格真的写在它身上（不是被换回六列）。
    const rowDecls = [...css.matchAll(/(^|\n)\.sw2-entity-row(\s*\{)/g)];
    assert.equal(rowDecls.length, 1, `★\`.sw2-entity-row\` 只许声明一次（实际 ${rowDecls.length} 处：重复声明=一条静默盖另一条）`);
    const rowAt = rowDecls[0].index;
    // ★终审 M4：加锚点——`\.sw2-relone` 后面**必须直接是 `{`**（原写法 `\.sw2-relone\s*\{` 留了 `\s*` 这个口子）。
    //   ★诚实边界：评审说"它也会匹配 `.sw2-relone-crew{`"——**实测不成立**（`-crew` 卡在类名与 `{` 之间，
    //     `\s*\{` 匹配不上；`css.search` 实测两种写法命中同一处、恰一处）。仍按 M4 收紧并补一条"只许一条裸声明"的
    //     结构断言：判据不该依赖"兄弟规则恰好排在它后面"这种排序巧合。
    const reloneDecls = [...css.matchAll(/(^|\n)\.sw2-relone\{/g)];
    assert.equal(reloneDecls.length, 1, `★\`.sw2-relone\` 基规则只许一条裸声明（实际 ${reloneDecls.length} 处）`);
    const reloneAt = reloneDecls[0].index;
    assert.ok(reloneAt > rowAt, '★行规则的版位须在它自己的版式散文之后、关系格之前（「搬到原位」而非"别处再写一条"）');
    const rowBody = /(^|\n)\.sw2-entity-row\s*\{([^}]*)\}/.exec(css)[2];
    assert.match(rowBody, /grid-template-columns\s*:\s*212px/, '★三列栅格必须写在唯一那条声明上（第一列 212px）');
    //   ④ 行内的热行标记（`.sw2-hot`）也不许两处声明；它的 `background` 是"就地交代"的（见该处注释）
    assert.equal(count(css, '.sw2-entity-row.sw2-hot{'), 1, '★`.sw2-hot` 的行规则同样只许一条');
    //   ⑤ ★终审 M8：原先是 `assert.match(css, /覆盖空气/)`——**锁的是一句注释文案**（不是行为/结构）：
    //      它咬不住任何东西（把注释改成同义的另一句话就红，而真正的约定"基规则不设 background、淡底写在
    //      `.sw2-hot` 自己那条上"改坏了它照样绿）⇒ 换成**结构锁**（那两件事各自可验、都是产物事实）：
    assert.ok(!/background/.test(rowBody), '★基规则不设 `background`（⇒ `.sw2-hot` 那条淡底不是"压着谁"，是它自己那一支的取值）');
    assert.match(css, /(^|\n)\.sw2-entity-row\.sw2-hot\{[^}]*background/, '★热行的淡底只许写在 `.sw2-hot` 自己那条上（唯一落点）');
    //   ⑥ 评审第二轮 #3：`.sw2-relone-crew`（由 `src/render.js` 产出的最长那串）必须有规则——不能再"只有生产者没有声明"
    assert.match(css, /(^|\n)\.sw2-relone-crew\s*\{[^}]*color/, '★`.sw2-relone-crew` 必须有自带颜色的规则（`-who`/`-pow`/`-dim` 同级）');
    //   "真有生产者"这条得自己造：`world()` 那份夹具里**没有一个角色的 `parent` 指向一家势力**
    //   （`membersOf` 只认 `parent ∈ {势力名, 其分支}`），照它写就是**锁空气**——门不许是假的。
    const wf = world();
    const fac = wf.entities.find((e) => e.kind === 'faction');
    assert.ok(fac, '前置：夹具里得有势力（否则麾下名单无从产出）');
    wf.entities.push({ id: 'e_crew1', kind: 'character', name: '麾下一', parent: fac.name });
    assert.ok(renderEntitiesHtml(wf).includes('sw2-relone-crew'), '★麾下名单确实由 `src/render.js` 产出（上面那条样式锁不是空的）');
    assert.ok(!html.includes('sw2-relone-crew'), '对照：本夹具（无 parent 指向势力）里没有这一串');
    //   ⑦ 评审第二轮 #5：`.sw2-entity-row.sw2-player` 零生产者 ⇒ 死 CSS 已删（画册旧类 `.sw2-entity.sw2-player` 是另一支，留着）
    assert.ok(!css.includes('.sw2-entity-row.sw2-player'), '★实体行的玩家底纹是死 CSS（J11 撤了标记）⇒ 不许留在样式表里');
    assert.ok(css.includes('.sw2-entity.sw2-player'), '对照：画册那支 `.sw2-entity.sw2-player` 仍在（删的是行那支）');
});

test('★细案实体页 J3：无在办时**不输出**占位句（空态不占版面）', () => {
    const w = world();
    w.agendas = [];
    const html = renderEntitiesHtml(w);
    assert.ok(!html.includes('眼下没有在办的盘算'), '★旧占位句不得回潮（真账 ~600 行挂着它）');
    assert.ok(!html.includes('你的每一步从对话里来'), '★★玩家那句占位也退场（细案 J11：玩家标记不许搬回来）');
});

test('★细案实体页 J6/J7：规模只许出现一次；归属与来历是一格一串', () => {
    const w = {
        version: 1, context: { world: 'x' }, entities: [
            { id: 'e_f', kind: 'faction', name: '慈航医堡', location: '未明', '规模': '长城上唯一的医修结社', '性质': '游走于死亡边缘的提灯人', '倾向': '不修杀伐' },
        ],
        weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 1 },
    };
    const html = renderEntitiesHtml(w);
    assert.equal((html.match(/长城上唯一的医修结社/g) || []).length, 1, '★★规模只许出现一次（自证：我在 demo 里先犯过这个错）');
    assert.ok(html.includes('sw2-relone'), '归属与来历有独立容器');
    assert.ok(html.includes('游走于死亡边缘的提灯人'), '性质原话入面');
    assert.ok(!html.includes('未载'), '★「未载」这类空态词不进版面');
});

test('★细案实体页 J11：行内不出现玩家标记与占位', () => {
    const w = world();
    const html = renderEntitiesHtml(w);
    assert.ok(!html.includes('sw2-player'), '★玩家底纹不进新行（细案 J11）');
    assert.ok(!html.includes('你的棋子'), '★「你的棋子」标记退场；玩家靠归属与在办自证');
});

// ============ 细案 spec-entities-page-ia：工具条（J5：必须存在搜索与分页控件） ============
test('★细案实体页 J5：搜索控件与分页控件**必须存在**（旧版各 0 个）', () => {
    const w = world();
    const html = renderEntitiesHtml(w);
    assert.ok(html.includes('id="sw2_ents_q"'), '★搜索框在位（旧版：0 个）');
    assert.match(html, /<input[^>]*type="search"/, '搜索框是真 input[type=search]');
    // ★终审 M12：`enterkeyhint="search"` 与既有 `aria-label` 同批的无障碍细节——
    //   手机/平板的软键盘据此把回车键显示成「搜索」（不是「换行」）。判据锁在**真产物**上。
    assert.match(html, /<input[^>]*enterkeyhint="search"/, '★搜索框必须带 enterkeyhint="search"（软键盘显示「搜索」）');
    assert.ok(html.includes('data-action="ents-page"'), '★分页控件在位');
    assert.ok(html.includes('data-action="ents-filter"'), '筛选 chip 在位');
    assert.ok(html.includes('data-action="ents-sort"'), '排序控件在位');
    // ★分组控件**已在本任务点亮**（用户拍板：从 Task 3 移到 Task 5，与分组渲染同批——
    //   中途不许交付死控件）；这里只锁"控件在位"，分组**结构**由下面那条专门用例承担。
    assert.ok(html.includes('data-action="ents-group"'), '★分组控件在位（Task 5 与分组渲染同批点亮）');
    // 计数不许写死：chip 上的数来自 entsHitCounts
    const c = entsHitCounts(w);
    assert.ok(html.includes(`>${c.all}<`), `「全部」格印真数 ${c.all}`);
    // ★Task 5 评审·第二轮 #6：chip 是**真 `<button>`**，选中态原先**只有 `.on` 类**（纯视觉）⇒
    //   读屏用户听不出自己选了哪档。`aria-pressed` 是"可切换钮"的标准说法，与搜索框那条 `aria-label`
    //   属同一契约。断言按**产物形状**咬（不靠类名自证）：默认视图下「全部」是按下态、其余类别是未按下态。
    assert.ok(html.includes('aria-pressed="true"'), '★至少有一枚 chip 印出按下态（默认：类别「全部」）');
    assert.ok(html.includes('aria-pressed="false"'), '★未按下的 chip 也**显式**印 false（不留"未设态"）');
    const allChip = /<button class="sw2-chip on[^"]*" aria-pressed="true" data-action="ents-filter" data-value="all"/.exec(html);
    assert.ok(allChip, '★默认选中那枚（类别「全部」）必须是 `on` 类 + `aria-pressed="true"` **同时**在位（两处说法一致）');
    // 换一档：选中的那枚换成势力，且真数照旧跟着走
    const fac = renderEntitiesHtml(w, { view: { kind: 'faction' } });
    assert.ok(fac.includes('aria-pressed="true" data-action="ents-filter" data-value="faction"'), '★换档后按下态跟着换（势力）');
    assert.ok(fac.includes('aria-pressed="false" data-action="ents-filter" data-value="all"'), '★旧选中档退回 false（不是留 true 或干脆不印）');
    // 三类钮（筛选/排序/分组）是同一个 `chip()` 产的 ⇒ 逐类各咬一枚，防"只给筛选钮加"
    for (const [act, val] of [['ents-sort', 'active'], ['ents-group', 'none']]) {
        assert.ok(html.includes(`aria-pressed="true" data-action="${act}" data-value="${val}"`), `★${act} 的 chip 也有按下态（同一契约）`);
    }
});

test('★工具条排布（乙 · 分组块）：控件按「一伙的」分组，每组自带标签，块间一条竖线', () => {
    // 起因（用户实拍截图 + 一句「这个角色和势力这个位置比较乱」）：原工具条把 **21 个控件平铺**在两个 flex 行里、
    //   靠 `flex-wrap` 自然折行 ⇒ 实测折成 **9 个视觉行**（工具条高 154px），而且
    //   ①「分组」这个标签与它管的 4 枚钮被折到**不同行**（读不出谁管谁）；
    //   ② 那段查书三态长提示直接印在第二行里，**独吃两行**。
    // 定稿（用户拍板「就乙吧」）：**六块**——搜索 / 类别 / 筛选 / 排序 / 分组 / 计数，每块自带标签、
    //   块与块之间一条竖线；长提示收进「？」。**控件一个不增不减**（J5 那几条继续咬）。
    const w = world();
    const html = renderEntitiesHtml(w);
    // ① 六块之分：搜索块 + 五个带标签的块
    assert.ok(html.includes('class="sw2-ents-g sw2-ents-g-q"'), '搜索独占一块（它是唯一该伸缩的）');
    for (const label of ['类别', '筛选', '排序', '分组', '计数']) {
        assert.ok(html.includes(`<span class="sw2-ents-gl">${label}</span>`), `★「${label}」块自带标签（标签与它管的钮不许分离）`);
    }
    // ② 五个标签块是**块的直接子**（不是散在行里的行内文字）
    assert.equal((html.match(/class="sw2-ents-g"/g) || []).length, 5, '除搜索块外恰有五块（类别/筛选/排序/分组/计数）');
    // ③ 搜索框所在的块里**只有**搜索框（不许再往里塞 chip ——那正是原来"折成 9 行"的来路）
    const qBlock = /<div class="sw2-ents-g sw2-ents-g-q">([\s\S]*?)<\/div>/.exec(html);
    assert.ok(qBlock, '搜索块可切出');
    assert.ok(!qBlock[1].includes('sw2-chip'), '★搜索块里不许混入 chip（分组边界的判据）');
    // ④ 每块内的 chip 都属于该块的 action（组合正确，不是把钮挪错块）
    const gBlock = /<div class="sw2-ents-g"><span class="sw2-ents-gl">分组<\/span>([\s\S]*?)<\/div>/.exec(html);
    assert.ok(gBlock && gBlock[1].includes('data-action="ents-group"'), '★「分组」块里装的是分组钮');
    assert.ok(gBlock && !gBlock[1].includes('data-action="ents-sort"'), '★「分组」块里不许混进排序钮');
    const sBlock = /<div class="sw2-ents-g"><span class="sw2-ents-gl">排序<\/span>([\s\S]*?)<\/div>/.exec(html);
    assert.ok(sBlock && sBlock[1].includes('data-action="ents-sort"'), '★「排序」块里装的是排序钮');
    assert.ok(sBlock && !sBlock[1].includes('data-action="ents-group"'), '★「排序」块里不许混进分组钮');
    // ⑤ 长提示收进可展开的「？」（不再独占版面）
    assert.ok(html.includes('sw2-ents-asks'), '长提示走可展开容器');
    // ⑥ 外观契约（与实物同款）：块的换行单位 + 块间竖线 + 标签样式。
    //   ★判据要咬在**真正承担这件事的那条规则**上：允许换行的是**块容器** `.sw2-ents-tools-row`
    //     （外层 `.sw2-ents-tools` 是纵向 column，不承担换行）；块**自身**必须 `flex-wrap:nowrap`
    //     ——这一条才是"窄屏时整块下去、不把块内的钮打散"的保证（也就是"乱"的病根所在）。
    const css = readFileSync(path.join(ROOT, 'web', 'style.css'), 'utf8');
    assert.match(css, /\.sw2-ents-tools-row\s*\{[^}]*flex-wrap\s*:\s*wrap/, '★块容器允许换行（窄屏时整块折下去）');
    assert.match(css, /\.sw2-ents-g\s*\{[^}]*flex-wrap\s*:\s*nowrap/, '★块自身不许拆行（块内的钮永远待在一起）');
    assert.match(css, /\.sw2-ents-g\s*\{[^}]*border-left/, '★块与块之间有一条竖线（视觉上读得出"这几枚是一伙的"）');
    assert.match(css, /\.sw2-ents-gl\s*\{/, '块标签有自己的样式（不是裸文字）');
});

test('★细案实体页：三态说明按细案改挂工具条（不许在改版里丢掉）', () => {
    const w = world();
    // ★★★leg76：原先这里锁的是「⬇ 补全全册实力」那枚钮——**它已被用户拍板撤除**
    //   （令：「这个按钮根本用不了，要么就改成重抽名册，要么就删了」；依据见 `test/lookup-batch.test.js` 那条）。
    //   ⇒ 本条翻成**反向锁**：那枚钮与它的进度态都不许回潮。
    const html = renderEntitiesHtml(w);
    assert.ok(!html.includes('data-action="lookup-batch-all"'), '★已撤的批量钮不许回潮');
    const running = renderEntitiesHtml(w, { config: { lookupTask: { cursor: 4, total: 623, success: 3, pending: 1, absent: 0, failed: 0 } } });
    assert.ok(!running.includes('■ 停止补全'), '★旧的批量进度态也不许回潮（渲染层不再读 lookupTask）');
    // ② 查书三态说明（render.test.js:547/620 锁它，原在页底整行）⇒ 收进可展开的「？」
    assert.ok(html.includes('sw2-ents-asks'), '三态说明改成可展开容器');
    assert.ok(html.includes('账上只记查到的与玩出来的东西'), '★说明文本必须**连续出现**（既有用例用 includes 锁它）');
});

test('★细案实体页：命中计数与页码如实印出（不是估计值）', () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ id: `e_${i}`, kind: 'character', name: `名${String(i).padStart(3, '0')}` }));
    const w = { version: 1, context: { world: 'x' }, entities: many, weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 1 } };
    const html = renderEntitiesHtml(w);
    assert.ok(html.includes('命中 <b>130</b>'), '命中数如实');
    assert.ok(html.includes('显示第 1–60 条'), '区间如实');
    assert.ok(html.includes('第 1 / 3 页'), '页码如实');
    // 筛选态下计数跟着变
    const html2 = renderEntitiesHtml(w, { view: { q: '名00' } });
    assert.ok(html2.includes('命中 <b>10</b>'), '筛完计数跟着变');
    // ★终审 M11：单页时那两枚翻页钮**仍在位、但都 `disabled`**（如实处置 = 保留 + 明说"现在没有可翻的页"）。
    //   不隐藏的理由：细案 J5 要的是"控件**必须存在**"（旧版 0 个正是"621 行全摊平"的病根），
    //   而控件随命中数忽隐忽现，玩家只会以为"这功能没了"。`disabled` 本身就是诚实的说法。
    const onePage = renderEntitiesHtml(world());
    assert.match(onePage, /data-action="ents-page" data-value="prev" disabled/, '★单页时「上一页」在位且 disabled');
    assert.match(onePage, /data-action="ents-page" data-value="next" disabled/, '★单页时「下一页」在位且 disabled');
    assert.ok(!onePage.includes('第 1 / 1 页'), '单页时不印"第 1 / 1 页"（没页可翻就不摆页码）');
});

test('★细案实体页：工具栏与列表头**零引擎术语**（构建号也在玩家视线内）', () => {
    const html = renderEntitiesHtml(world());
    const text = String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    // ★Task 5 评审修正 #1：这里原先把「构建号自己那一个 token」从扫描里**抠掉**（`构建 <token>` → `构建号`），
    //   理由是细案把它钉成 `leg49-entities-three-cols`（含 `entities`）与 leg31 立的"构建号也不许带引擎术语"
    //   这条锁对撞。用户拍板**改名**（`PANEL_BUILD` → `leg49-three-column-roster`）⇒ 冲突消失
    //   ⇒ 抠洞撤销，**禁词扫描恢复全量**（构建号自己也必须过扫描——改完它本来就过得去）。
    //   反向锁照旧在下面（构建号必须在玩家视线内），两条一起把"改名过锁"与"不许藏起来"都钉死。
    for (const bad of ['agenda', 'tick', 'ssot', 'schema', 'entity', 'ENTITIES']) {
        assert.ok(!text.toLowerCase().includes(bad.toLowerCase()), `工具栏不得出现引擎术语「${bad}」`);
    }
    // 构建号本身照旧在玩家视线内（细案要求"版位升降位"，这一条把"不许为了过禁词把它藏起来"钉死）
    assert.ok(text.includes(`构建 ${PANEL_BUILD}`), '★构建号必须在玩家视线内（表头）——不许为了过禁词而藏它');
});

// ============ 细案 spec-entities-page-ia：分组落地 + 版位升位（Task 5/5） ============
test('★细案实体页：分组——按归属/位置/类别切成可展开的组，组头带真数', () => {
    const w = world();
    // ★分组控件**在本任务**落地（用户拍板：从 Task 3 移到这里，与分组渲染同批——中途不许有死控件）
    const plain = renderEntitiesHtml(w);
    assert.ok(plain.includes('data-action="ents-group"'), '★分组钮在位（本任务才加）');
    // ★夹具补几行带归属的：真账那份 fixture 只有 3 家势力 + 玩家，**全都没有 parent**
    //   ⇒ 按归属分组只会得到「（无归属）」一组，"逐组真数/求和"根本咬不住。
    const w2 = world();
    w2.entities.push(
        { id: 'e_t1', kind: 'character', name: '组员一', parent: '上级甲' },
        { id: 'e_t2', kind: 'character', name: '组员二', parent: '上级甲' },
        { id: 'e_t3', kind: 'character', name: '组员三', parent: '上级乙' },
        { id: 'e_t4', kind: 'character', name: '组员四', parent: '上级乙' },
    );
    const html = renderEntitiesHtml(w2, { view: { grp: 'parent' } });
    assert.ok(html.includes('sw2-ents-grp-block'), '分组容器在位');
    // ★Task 5 评审修正 #3：原先这条断言写的是 `html.includes('<summary')`——**恒真**（假绿）：
    //   工具条那个「？」提示本身就是 `<details class="sw2-ents-asks"><summary …>`（`src/render.js:747`），
    //   所以连 `grp:'none'` 的产物也能过它，对"组头是不是可展开结构"零信号。
    //   ⇒ 改成锁**真实结构**（组头那一段原文，含 `open` 与紧邻的 summary）。
    assert.ok(html.includes('<details class="sw2-ents-grp-block" open><summary>'), '组头是 details/summary 结构');
    assert.ok(!renderEntitiesHtml(w2, { view: { grp: 'none' } }).includes('sw2-ents-grp-block'), '对照：不分组时没有这个结构');
    // ★Task 5 评审修正 #5：原文只锁"容器在不在"，标题写着"组头带真数"却一个数都没验。补两条真数断言。
    //   结构（**实测产物**，非照描述猜）：`<details class="sw2-ents-grp-block" open><summary>`
    //   `<span class="sw2-ents-grp-t">组名</span><span class="sw2-ents-grp-c">本页 N 位</span></summary>`
    //   `<div class="sw2-entity-list">…行…</div></details>`
    const marks = [...html.matchAll(/<details class="sw2-ents-grp-block"/g)].map((m) => m.index);
    assert.ok(marks.length >= 2, `本用例的夹具下该有多组（否则"逐组真数"咬不住），实得 ${marks.length}`);
    let grouped = 0;
    marks.forEach((start, i) => {
        const seg = html.slice(start, i + 1 < marks.length ? marks[i + 1] : html.length);
        const m = /<span class="sw2-ents-grp-c">本页 (\d+) 位<\/span>/.exec(seg);
        assert.ok(m, '每个组头的计数必须写成「本页 N 位」（评审 #2：不许与同屏的「全册 N」读混）');
        const rows = count(seg, '<div class="sw2-entity-row');
        assert.equal(Number(m[1]), rows, '★组头的数必须等于该组内真实行数');
        grouped += rows;
    });
    // ② 各组行数之和 = 本页行数（本页行数从同一份渲染的**不分组**产物里数出来，不另写一份口径）
    const plainRows = count(bodyOf(renderEntitiesHtml(w2)), '<div class="sw2-entity-row');
    assert.ok(plainRows > 0, '不分组产物里必须真有行（否则这条和稀泥）');
    assert.equal(grouped, plainRows, '★各组行数之和 = 本页行数（分组不吞行、不重复计）');
    assert.equal(count(html, '<div class="sw2-entity-list">'), marks.length, '每组恰好一个列表容器');
    const none = renderEntitiesHtml(w2, { view: { grp: 'none' } });
    assert.ok(!none.includes('sw2-ents-grp-block'), '不分组时不出现分组容器');
    // ★Task 5 评审修正 #6：未知 `view.grp` 原先在下标取 `keyOf` 时会抛 TypeError ⇒ 退化成**不分组**。
    const bogus = renderEntitiesHtml(w2, { view: { grp: 'nope' } });
    assert.ok(!bogus.includes('sw2-ents-grp-block'), '★未知分组口径退化成不分组（不抛）');
    assert.equal(bodyOf(bogus), bodyOf(none), '★未知值与 `none` 的列表体逐字节同形');
    // ★缺 `kind` 的实体 → 组头是兜底组名，不许把字面 `undefined` 印给玩家
    //   （这里**自造最小世界**而不是取 `world()`：那份夹具的实体形状受 `selectEntityPage` 归一化影响，
    //    自造的三行才能把"有一个缺 kind"钉成断言的前提——不靠猜）
    const w3 = {
        version: 1, context: { world: 'x' }, entities: [
            { id: 'e_a', kind: 'character', name: '甲角色' },
            { id: 'e_b', kind: 'faction', name: '乙势力' },
            { id: 'e_c', name: '丙缺类别' },
        ],
        weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 1 },
    };
    const byKind = renderEntitiesHtml(w3, { view: { grp: 'kind' } });
    assert.equal(count(byKind, 'class="sw2-ents-grp-block"'), 3, '对照：`grp:kind` 真的按类别切出了三组');
    assert.ok(!byKind.includes('>undefined<'), '★缺 kind ⇒ 组头不得印字面 undefined');
    assert.ok(byKind.includes('<span class="sw2-ents-grp-t">（类别未载）</span>'), '缺 kind ⇒ 兜底组名在位');
    // ⚠反向实验留档（评审修正 #5 的诚实边界）：`keyOf` 之外那层 `|| '（未分组）'` 兜底**当前咬不住**——
    //   三个 keyer 自己都会回字符串（`e.parent || '（无归属）'` 之类）⇒ 删掉那一层，产物逐字节不变
    //   （实测：`undefined` 永不落进组名）。故**不为它编一条断言**充数；它留着是防御性的，
    //   真正的锁是上面这两条（它们咬得住"keyer 的兜底被删"）。
});

test('★细案编年页（leg50）：版位升位且不含引擎术语（构建号在玩家视线内）', () => {
    // ★leg50 换档（细案 spec-chronicle-page-ia）：玩家可见面真变了 ⇒ 构建号升位。
    //   ★起名先过禁词扫描——`leg50-layered-chronicle-tools` / `leg50-chronicle-layers` 都被扫出 `chronicle`
    //     （leg49 §4① 的同一颗雷，那条踩过两次）⇒ 定稿 `leg50-story-and-ledger`。
    // ★★leg52 换档（本棒）：参数页版式 + 观棋信息带**真的变了**（四键并卡 / 推进卡撤走 / 撤销卡上移 /
    //   长说明折进 `<details>` / 浪尖去重 / 设定页与信息带改读真源）⇒ 构建号跟着升位。
    //   ★同一条起名纪律：`leg52-params-and-tide` 里零引擎术语（下面那个循环就是扫描器）。
    // ★★★leg53 换档：**乱象有了生产者**（引擎每轮算）+ 民生撤下 + 依据那一格改口径 ⇒ 玩家可见面真变了。
    // ★★★leg54 换档：世界尺度四个框改成**数字输入框、无上限**（+ 设置页那行过期预算已修）⇒ 又变了。
    // ★★★leg60 换档：设定页新增「维度与刻度」与「编译完整性」两栏 ⇒ 又变了。
    // ★★★leg64 换档（三次）：①「法则」一栏按类别分段 + 如实报进包条数；②刻度栏补**目录**
    //   （"其余 N 张没进包、表名仍每轮进包"）；③补**模型点名的表**（按需查表）⇒ 玩家可见面真变了。
    //   ★起名纪律又咬了一次：第一版 `leg64-rule-kinds` 含禁词 `kind`（就在下面这个循环里）⇒ 改
    //     `leg64-rule-classes`，刻度目录落地后再升 `leg64-scale-catalog`。这条雷 leg50/52 各踩过一次。
    // ★★★leg66 换档：**观棋页「⚖ 本轮裁定 N 条」那条的文案改了**——原一句"不在账或已了结"是
    //   一句话两义（真账 tick 7 实测：因明明在账上、也明明是本轮的由头，却被那句领去查"抄错号"）；
    //   现在分开报"账上根本没这个号"/"在本批次开始前就已了结（第 N 轮）"，且**同一批次内被本轮
    //   自己关掉的因照旧认**（治法见 `settle.js` 的 `captureOpenCauseState`）。
    //   ★起名纪律照旧：`leg66-cause-at-batch-entry` 不含下面扫描器里任何一个禁词，形状合 `/^leg\d+-/`。
    //   ★★★leg66 再升一格（用户实机第二条裁定）：`newAgendas` 引**已了结**事件的报错补上了
    //   「拾遗（closedRoots）→ newEvents + ripple → 再用那件新事件当源」那条出路
    //   （旧文案只说"引未决事件 / 改成 state"，等于把模型合法的心愿说成不可能）。
    //   ★起名纪律照旧：`leg66-closed-root-path` 不含下面扫描器里任何一个禁词，形状合 `/^leg\d+-/`。
    // ★★★leg67 升位（甲案 · 引用完整性收成单一主人）：**报错文案变了**（不是版式变了）——
    //   `ref-rules.js` 的判据表给每条"不合法"都补上了**出路**（leg64/leg66 两次实机教训的直接产物：
    //   报错不给路 ⇒ 模型反复换号重试 ⇒ 每试一次白烧一轮）。三条新句子确实会印在那条裁定栏里：
    //   entity 源引已灭者 / dialogueFact 命中不了 / dialogueFact 指向账上已有的人。
    //   ★起名纪律照旧：`leg67-ref-single-owner` 不含下面扫描器里任何一个禁词（`ref`/`single`/`owner`
    //     都是安全词），形状合 `/^leg\d+-/`。
    //   ★★leg67 甲-余 再升一格（同一棒第二笔）：收尾甲案时又补了**一族**出路文案——
    //     "号指向账上不存在的东西"那 9 个引用点（未知实体/未知提议者/未知盘算/已结算盘算不可取消）
    //     现在都告诉模型"照抄输入里的 id / 先用 newEntities 让他入局"。同一条纪律（报错必须给出路）。
    //   ★★★leg68 升位（乙-1 · 细案 §3.1 的轻案）：**这一次与前两棒不同，必须如实说清**——
    //     leg66（闭环出路）与 leg67（判据收口）升位，理由都是"**玩家/模型看得见的文案真的变了**"；
    //     本棒的升位理由**不是文案变了**，而是"**面板背后那套代码换了**"：
    //     `settleTick` 的 139 行顺序过程上方现在写着一张 `SETTLE_ORDER` 顺序表 + `test/settle-order.test.js`
    //     把"表序 = 代码序"锁住（细案 §1.2：顺序承担语义，而那条不变量原先没有主人）。
    //     ★自证：本棒**没有**任何渲染文案改动 —— 冒烟 8231 字节逐字节未变、`SETTLE_ORDER` 只在引擎侧。
    //     升位的作用是**让实机位能自证跑的是哪一版**（页脚构建号是用户唯一的验收判据）：
    //     不升位 ⇒ 改完仍然是 `leg67-ref-residual` ⇒ 用户无法从界面区分"跑到了没有"。
    //     ⚠别把它读成"乙-1 改了玩家可见面"——**没有**（这条注与 leg66/67 那两条的理由不同）。
    //   ★起名纪律照旧：`leg68-settle-order-table` 不含下面扫描器里任何一个禁词，形状合 `/^leg\d+-/`。
    //   ★★★leg69 升位（A1 · 进包块级截断留痕）：**理由与 leg68 又不同**——
    //     leg68 是"面板背后代码换了、玩家可见面没动"；本棒**动了模型看得见的东西**：
    //     `buildEvolutionPack` 在块级预算真切掉东西时，会往 `setting` 多挂一个 `刻度裁掉` 读数键。
    //     ★玩家可见面**没动**（面板那句读数与原先逐字相同，只是改读同一个 `fit`；冒烟与行为哈希逐字节不变自证）。
    //     ⇒ 照 leg66/67 的"模型可见面变了就升位"纪律，本棒够升位。
    //   ★起名纪律照旧：`leg69-pack-fit-trace` 不含下面扫描器里任何一个禁词，形状合 `/^leg\d+-/`。
    //   ★★★leg70 升位（A6 · 「只抽刻度」抽完能存）：**理由回到 leg62/63 那条老纪律**——
    //     玩家可见面**真的变了**（不是 leg68 的"背后代码换了"、也不是 leg69 的"模型可见面变了"）：
    //     ① 草稿栏多一枚「采用这份草稿（只换刻度）」按钮；
    //     ② 草稿栏多两段如实说明（"只换刻度那三格"·"单次调用 ⇒ 与多块重抽不会逐字相同"·"旧的先打控制台再覆盖"）；
    //     ③ 草稿栏报"账上现在是几张三档 ⇒ 采用后变成几张三档"；
    //     ④ 入口那行措辞「只瞄一眼书里的"尺子"」→「瞄一眼书里的"尺子"（可再采用）」。
    //     ★为什么措辞那一处也必须动：本棒之前"只瞄一眼"是**字面为真**的（那条路确实不入账），
    //       现在草稿栏多了一枚真会写账的按钮 ⇒ 留着旧话就是本仓最忌讳的"面板印一句不再为真的话"。
    //   ★起名纪律照旧：`leg70-adopt-scale-draft` 不含下面扫描器里任何一个禁词，形状合 `/^leg\d+-/`。
    //   ★★★leg72b 升位（恢复快照那条通道的**落盘存根** · 真缺陷修）：**理由回到 leg62/63 那条老纪律**——
    //     玩家可见面**真的变了**：`bus['snapshot-restore']` 那条状态条原先印
    //     `${r.flushed ? ' · 已落盘' : ' · ⚠ 落盘失败（见控制台）'}`，而 `flushed` 是三态**对象**
    //     ⇒ 判对象真值**恒真**（真失败也印「已落盘」）；更坏的是取值那行**被换成了存根**
    //     `const flushed = { ok: true };` ⇒ `restoreSnapshot` **一次 `flushHotMeta()` 都没调**。
    //     修完这条状态条**才第一次说真话** ⇒ 升位让用户能从页脚认出"跑到修好的这版没有"。
    //     ★与 leg71/leg72 的"不升位"不矛盾：那两棒是**纯结构搬迁、可见面逐字节没变**。
    //   ★起名纪律照旧：`leg72-restore-flush-honest` 不含下面扫描器里任何一个禁词，形状合 `/^leg\d+-/`。
    //     ★本棒第一版起名带 `b`（`leg72b-…`）⇒ 被下面那条**形状锁当场红**（数字后必须紧接连字符）——
    //       如实留档：形状锁咬住了我自己的起名。
    //   ★★★leg74 升位（「文风禁令」连账本一起清掉 · 用户令「我不是说不要文风禁令了吗？」）：
    //     **理由仍是 leg62/63 那条老纪律**——玩家可见面**真的变了**：
    //     ① 设定页法则栏那段说明过去写「书里写下的规则条条都在这里，**一条不删**」+
    //        「**文风禁令**、变量指令与格言留在本页给作者看」⇒ **这两句现在是假的**（那一类已不进账）；
    //     ② 会少掉「文风禁令（N 条）」整段（用户实拍的三条：`必须放在 <content> 标签内` /
    //        `角色对话：（角色名）` / `旁白：直接写普通段落`）。
    //     ⇒ 本仓最忌"面板印一个不再为真的数/话" ⇒ 升位，让用户能从页脚认出"跑到清干净的那版没有"。
    //   ★起名纪律照旧：`leg74-style-rules-purged` 不含下面扫描器里任何一个禁词，形状合 `/^leg\d+-/`。
    //   ★★★leg75 升位（丢弃集从一类推广到三类 · 用户令「把这些全给我删干净了」＋重抽后的面板实拍）：
    //     **理由仍是同一条老纪律**——玩家可见面**又真的变了**：
    //     ① 用户重抽后那一屏上还列着「其他（2 条）」是**安装/配置说明**
    //        （`数据库配置：安装：下载最新版本数据库…` · `表格模板导入：配置方法：状态栏倒数第三个按钮`）
    //        ⇒ 拍板连 `变量指令`/`其他` 一起清；面板会**再少掉两段**；
    //     ② 那段说明里 leg74 写的「其余三类…不在此列」口径要改成**三类都不在账本里**（否则又是一句不再为真的话）。
    //     ⇒ 升位，让用户能从页脚认出"跑到三类都清干净的那版没有"。
    //   ★起名纪律照旧：`leg75-ledger-world-only` 不含下面扫描器里任何一个禁词，形状合 `/^leg\d+-/`。
    //     ★本棒第一版起名 `leg75-three-junk-classes-purged` ⇒ **含禁词 `kind`**（`classes` 里的子串）
    //       ⇒ 被下面那条扫描器当场红。如实留档：扫描器又咬住了我自己的起名（照 leg72b 的先例记一笔）。
    //   ★★★leg76 升位（撤掉「⬇ 补全全册实力」· 用户令「这个按钮根本用不了，要么就改成重抽名册，要么就删了」）：
    //     **理由仍是同一条老纪律**——玩家可见面**又真的变了**：角色与势力页工具栏**少了一枚钮**，
    //     页底那句指路文案也从"入口是那枚钮"改成了"不再自动重查"（不然面板就在承诺一个不存在的入口）。
    //     ⇒ 升位，让用户能从页脚认出"跑到撤了那枚钮的这版没有"。
    //   ★起名纪律照旧：`leg76-roster-batch-pull` 不含下面扫描器里任何一个禁词，形状合 `/^leg\d+-/`。
    //     ★本棒第一版起名 `leg76-entities-batch-removed` ⇒ 含 `entities`，被那条**"工具栏零引擎术语"**
    //       的扫描器当场红（构建号也画在玩家视线内）⇒ 改成 `roster`/`pull` 这套人话。**第二次**被起名扫描器咬住。
    //   ★★★leg87 升位（用户令「A 删了 C 也删了」+「这个也有问题，改也改不了是死的」）：
    //     理由仍是同一条老纪律——**玩家可见面又真的变了**：设置页**少了一整张卡**（「你的开档描述」）、
    //     那格只读的「单轮演算上限」变成**两个可填输入框**（超时 / 输出上限），世界设定卡那句
    //     「抽取只拿三样…实力不抄」也改成了实抽的六类。⇒ 升位，让用户能从页脚认出跑的是哪一版。
    //   ★★★leg89 升位（用户令「注入提示词让聊天llm生产带标签的内容然后插件提取」+「标签点了名的角色
    //     插件不得出手，告诉插件llm就好了」+「应该还有流逝的时间」→「累加吧」+「角色的行动全都注入」）：
    //     理由仍是同一条老纪律——**玩家可见面又真的变了**：设置页**多了一张「与聊天模型的接线」卡**
    //     （三个开关 + 一个可填数字框 + 每轮注入读数），而且这是**插件第一次会动玩家的对话**
    //     （发消息前往上下文里塞格式指令与名号表）⇒ 升位，让用户能从页脚认出跑的是哪一版。
    //   ★起名纪律照旧：`leg89-tag-extract` 不含下面扫描器里任何一个禁词，形状合 `/^leg\d+-/`。
    //   ★★★leg90 升位（用户实机第二次骂 · ③段注入正文改人话 + 世界模型写标题自带对象）：
    //     理由与 leg69 同族——**动的是"模型看得见的东西"**，而玩家可见面**没动**：
    //     ① `src/tick.js` 的 ③段不再拼整条编年（那里面混着引擎记账行），改用事件本体重述成人话；
    //     ② `src/prompts.js` 新增第 8b 条（事件标题自带对象）+ `MAIN_PROMPT_V` → `v2-agenda-t1-21`。
    //     ⇒ 按 leg29 立的纪律（模型可见面变了就升位）**必须升**：不升位，用户从页脚分辨不出跑的是哪一版。
    //   ★起名纪律又过了一遍扫描器：`leg90-tide-plain` 不含下面任何一个禁词，形状合 `/^leg\d+-/`。
    //   ★★★leg90 再升一格（同一天第二刀 · 用户真机取证之后）：
    //     用户按我给的命令读出 `sw2_tags | position=1 depth=1 role=0 | 475字 | 锚点=true`
    //     ⇒ **注入真到了聊天模型，模型就是不写标签** ⇒ 病在措辞软（原文「**请**用标签标出」+
    //     「不要为了标签改变你的文风」）。把那段规范改成**硬要求**（必须 + 不写的后果 + 写完自检 +
    //     合格判据，475 → 878 字）⇒ 又动了**模型看到的东西** ⇒ 再升一格。
    //   ★起名纪律照旧：`leg90-tags-mandatory` 不含下面任何一个禁词，形状合 `/^leg\d+-/`。
    //   ★★★leg90c 再升一格（**真因修** · 用户：「上下文我好像都没看见注入」）：
    //     那一句点破了病根——注入位置用了 `IN_CHAT`(=1)，而 ST 的 chat completion 组装
    //     （`public/scripts/openai.js:1345`）只认 `BEFORE_PROMPT`/`IN_PROMPT`，其余一律 `continue` 丢掉
    //     ⇒ 那两段**从来没进过发给模型的 prompt**（只躺在 ST 的字典里，所以读数"看着注入了 475 字"）。
    //     位置改成 `IN_PROMPT`(0) ⇒ 又动了**模型看到的东西**（这次是"从看不到变成看得到"）⇒ 升位。
    //   ★起名纪律照旧：`leg90c-inject-position` 不含下面任何一个禁词，形状合 `/^leg\d+-/`。
    //   ★但**本条起名被另一条判据咬了一次**（留档）：`test/param-hub.test.js:414` 与本文 1912 行
    //     都要求构建号合 `/^leg\d+-/`——**`\d+` 是纯数字** ⇒ `leg90c-…`/`leg90b-…` 都不合格
    //     （`leg40b` 能过是因为 `leg`+`40`+`b-…`，`\d+` 只吃 `40`）⇒ 定稿 **`leg91-inject-position`**。
    //   ★★★leg92 再升一格（真缺陷修）：重设注入从"装配那一刻"挪进 `refreshWorld`（世界进内存之后）——
    //     原来那次 `apply()` 跑在世界载入**之前** ⇒ 两段都空、`clear()` 还把 key 删掉；而用户总闸关着
    //     ⇒ 世界永远不推 ⇒ 队列的 `refresh` 永远不跑 ⇒ **再也没有第二次机会**（实机症状：开关是 1、
    //     构建号是新的、`sw2_` 一个都没有）。
    //   ★★★leg93 再升一格（用户裁示「就甲吧」）：**注入给聊天模型的那段规范原文改了**——
    //     标签从此必须包在一个 ` ```tags ` 块里（提取器只扫块里，块外一律当正文）。
    //     为什么算"模型看到的东西变了"：规范原文就是模型读的那一段（`web/inject.js` 的 `tagSpecText()`）。
    //     ★`CSS_VERSION`（`web/index.js`）**本笔不动**——升位纪律要的是"玩家可见的版面/样式变了才升"，
    //       本笔那一格正文是**发给聊天模型的**，面板上原来的样式规则一条没改。
    //     ★`leg93` 这个号已被"交接落盘"那一笔占了 ⇒ 本笔记作 **`leg93b`**（补笔先例）。
    //   ★★★leg94 再升一格（**玩家可见版面变了** · 用户令「这个文字出现在编年页签里了」）：
    //     编年页不再印里程碑插行（`sw2-ch-roll`）⇒ 版面真变了 ⇒ 按纪律升。
    //     ★`CSS_VERSION`（`web/index.js`）**本笔不动**：样式表零改动（删的是一条**无生产点**的死规则，
    //       不是"换了样式" ⇒ 浏览器缓存没有旧件可吃，升了反而是假信号）。
    //     ★起名避禁词：本想说 `…-chronicle-roll-off`，`chronicle` 正在下面那张禁词表里 ⇒ 定稿
    //       **`leg94-oldvol-clean`**（"旧卷那一段清干净了"）。
    //   ★★★leg94 同一天再升一格（`leg94-oldvol-clean` → **`leg94-storyview`**）：用户实机截图又取回三条证
    //     ——大事纪里程碑卡印着 `[object Object]`、展开条目全是 `ev_11_2 链`、编年账目行里嵌着 `ev_4_6`，
    //     并要求"把因果讲成人话" ⇒ 本笔修那三处 + 新增「说书」页签（`src/panorama.js`）。
    //     ★这次 `CSS_VERSION`（`web/index.js`）**必须同批升**（`20260921-leg94-storyview`）：
    //       说书视图一整族 `.sw2-pan-*` 是新增样式，与"删一条死规则"那次的情形**正相反**。
    //   ★★★leg95 再升一格（`leg94-storyview` → **`leg95-linesettles`**）：用户指认说书页那格判词在骗人
    //     （「**链头没法完结但是为什么每个事件都写个还开着，这些事件都是已经完成了呀，这不是误导人吗？**」）
    //     ⇒ 点层判词由"借引擎的账目状态"改成**三种状态分开说**：已收场（模型判的）/ 已了结（引擎机械扫的）/
    //       没人再提了（还开着但再没新事从它长出来）。**玩家可见面真的变了 ⇒ 按纪律升。**
    //     ★`CSS_VERSION` **本笔也升**（`20260922-leg95-linesettles`）：新增了一条规则 `.sw2-pan-idle`
    //       （点层第三种状态的颜色，与"还开着"必须长得不一样）。
    //     ★起名避禁词：`settle`/`closed`/`pending` 这些都在下面那张禁词表里（`line`/`s` 亦须自查）⇒
    //       定稿 **`leg95-linesettles`**（"一条线怎么收场"，两个词都不在禁词表内）。
    //   ★★★leg95b 再升一格（`leg95-linesettles` → **`leg95-points`**）：用户实机截图驳回第一刀——
    //     「**开没开着不应该挂在事件上**」（第一刀只改了判词，状态却仍挂在每一件事上）。
    //     定稿：**点层一个字都不印状态**，状态只在线头那枚徽上说一次（还在往下长／挂着没了结／已收场）。
    //     ⇒ 玩家可见文本又变了 ⇒ 按纪律再升。★`CSS_VERSION` 同批 → `20260922-leg95-points`。
    //     ★起名避禁词：`event` 在禁词表里（"点层"直译会撞）⇒ 定稿 **`leg95-points`**。
    //   ★★★leg95c 再升一格（`leg95-points` → **`leg95-states`**）：用户第三次指认
    //     「**这个 7 还是事件的数量啊**」——线头那枚徽写成 `还在往下长 · 7 件没了结`，
    //     把**事件计数**缝回了一枚"说线的状态"的徽里（而同一行左边已印着「第 0–12 轮 · 8 件事」）。
    //     定稿：**徽只许说状态、一个数都不带**。⇒ 可见文本又变 ⇒ 按纪律再升。
    //     ★`CSS_VERSION` 同批 → `20260922-leg95-states`。★起名避禁词：`state` 不在表内（`points` 那次避的是 `event`）。
    //   ★★★leg96 再升一格（`leg95-states` → **`leg96-badgegrow`**，接手棒）：线头那枚徽的判据用错了信号——
    //     「还在往下长」原先量的是"**最近有没有事落在这条线上**"（`最晚一件事的轮次 > tick − 窗口`），
    //     而它该问的是"**最近几轮还有没有新事从这条线长出来**"（结构口径，与引擎 `hasPendingDownstream` 同族）。
    //     真账取证（装置 `F:/deepseek/tmp/leg96-badge-verify.mjs` 旧法 vs `-after.mjs` 真模块复验）：
    //     还没收场的线里 **8 条被判反**（A 局 3 · B 局 5）——`血屠魔君现身南疆掀起杀戮`／
    //     `菩提禅院钟声震荡大荒`／`天庭仙将玄鹤空降长城`／`敖天玄率领龙族精锐封锁东海海域` 这些
    //     **一个下游都没有**的线，只因"刚落账一件事"就印成"还在往下长"。
    //     ⇒ 玩家看到的那一态真的变了 ⇒ 按纪律再升。
    //     ★`CSS_VERSION` **本笔不升**（仍是 `20260922-leg95-states`）：**没有动任何样式规则**——
    //       三态的颜色/边框早就在（`.sw2-pan-badge` 的 `.live/.stale/.done`），本笔只是判得更准。
    //       ★与 leg94 那次"只删一条死规则 ⇒ 不升"是**同一条纪律**：**动没动样式，才是升不升 CSS 号的判据**。
    //   ★★★leg95d 再升一格（`leg96-badgegrow` → **`leg95d-oneline`**）：用户另一路指认
    //     「**没讲完的事又是啥，这也不对吧**」——线里那一整块**删除**（它既不是计数也不是过程，
    //     是把账目状态换个说法再列一遍；且"没讲完"是引擎行话，而列出的那几件**全都发生过了**）；
    //     顺带撤掉统计行那格「N 件悬着 · N 件了结」，并把统计行与两个区块标题**统一成徽那套词**
    //     （原来同一页三种说法：统计行「13 条还开着」／区块「还开着的线」／徽「还在往下长」）。
    //     ⇒ 可见文本又变 ⇒ 按纪律再升。★起名 `leg95d-oneline`（全页一套词）。
    //     ★`CSS_VERSION` **本笔不升**：零样式改动（同 leg96 与 leg94 那次"只删一条死规则"的纪律）。
    //   ★★★leg97 再升一格（`leg95d-oneline` → **`leg97-places-org`**）：「面」四层落地
    //     （用户口径「**以人物为切口感觉就不像面了**」⇒ 面是**空间上的一个地方**）——
    //     说书页从"按线的状态分三段"换成"**大势 → 此刻 → 面 → 线 → 点**"，末尾加一条自证闸。
    //     ⇒ 玩家可见版面与文案都真的变了 ⇒ 按纪律升。
    //     ★`CSS_VERSION` **同批升**（`20260922-leg95-states` → **`20260922-leg97-places`**）：
    //       新增了「面」那一族规则（`.sw2-pan-face` / `-fh` / `-brg` / `-dashi` / `-other` / `-selfcheck`）。
    //     ★起名避禁词：`leg97-places-org` 不含下面任何一个禁词。
    //   ★★★leg98 再升一格（`leg97-places-org` → **`leg98-bridgeclean`**）：用户把两张面卡片并排一看，
    //     问「**你发现什么问题了吗**」⇒ 三处**印在面上的字**失真（取证与判据见 `panorama.test.js`：
    //     ⑬/⑱ 的桥自指两半、⑫ 的面头那半）：
    //       ① `大虞` 那张卡的"与别处相连"里印着 `大虞 → 大虞皇陵`（桥自己就是本面 ⇒ 整行不该印）；
    //       ② 那一行的标签「与别处相连：」读起来像"这一处连着哪几处"（箭头左边其实是**人**）；
    //       ③ 面头「N 条线在这里交会」把**落脚/路过**糊成一个数（两张卡因此几乎一模一样）。
    //     ⇒ 可见文本又变 ⇒ 按纪律再升。
    //     ★`CSS_VERSION` **那一笔不升**：零样式改动 —— 改的全是文本与"印哪几行"（`web/style.css` 没动）。
    //   ★★★leg98 补（同批第二笔 · 用户令「**是改这一栏的颜色**不是标题文字」——指着**线头那一栏**）：
    //     那一栏原来 `background:transparent` ⇒ **透出的就是面卡底**（实测两边亮度差 **0**），
    //     整条栏只靠一条 2px 竖线划分，而竖线对面卡底只有 **1.21:1** ⇒ 栏目与面卡糊成一片。
    //     ⇒ 给那一栏**自己的底**（`#282f3c` · 对面卡 1.14:1）＋ 竖线提亮 `#3a4356`（live 那条改实色琥珀）。
    //     ★**这一笔真动了样式** ⇒ `CSS_VERSION` **同批升**（`20260922-leg98-rowbg`）；
    //       `PANEL_BUILD` 跟着再升一格（页面可见变化）。
    //   ★★★leg98 补二（同批第三笔 · 用户令「**里面有两个大势卡片留一个就好了**，世情 · 3 键，还有浪尖，
    //     张力，盘算数量你看看怎么集合起来好看」——三套候选里选了**乙**）：
    //     信息带**五格平铺 → 两栏**（左＝世情 3 键竖排 · 右＝三行读数）＋ **撤掉带里的「大势」格**
    //     ⇒ 版面与文案又变 ⇒ 再升一格；★新增三条规则 + `.sw2-tides` 改横排 ⇒ `CSS_VERSION` 同批升。
    //   ★★★leg98 补四（同批第四笔 · 用户令「**你总得把这个放在上面吧？而且我要往下翻很久才能看到这些**」）：
    //     **信息带升成页头**（它原来排在页尾，而正文可见 10150 字、它只有 94 字）＋ 这一页**改两栏**
    //     ⇒ 版面又变 ⇒ 再升一格；★新增 `.sw2-merged-grid/-main/-side` ⇒ `CSS_VERSION` 同批升。
    // ★★★leg100（用户令「**那行你改一下**」——指收场被拒时那句出路）：**收场被拒的出路话术改成"指对栏"**
    //   （`src/ref-rules.js` 的 `'eventClosures.event'` 那一格，**只动文案**）：旧话术只指 `pendingEvents`
    //   那一栏，而用户实机那两个被拒的号（`ev_6_4`/`ev_7_2`）**是从 `recentClosedEvents` 抄的**
    //   （真机取证：装置 `F:/deepseek/tmp/prototypes/leg100-closure-leak.mjs`：那两个号**不在** 72 条
    //    `pendingEvents` 里，**却在**那份尾巴 8 条里、且恰好是**头两条**）⇒ 模型照旧话去错的那一栏找、
    //   找不到 ⇒ 换号重试；而收场是**整步拒** ⇒ 每试一次白烧一轮。新话术把两栏的键名都点出来。
    //   ⇒ **那句话是拒收时印给模型与用户看的原文**（同 leg64/leg66/leg67 那条：报错给了新出路就该升位）
    //   ⇒ 升一格 ⇒ 定稿 **`leg100-closureexit`**。
    //   ★`CSS_VERSION` **不升**（`web/style.css` 零改动）——判据仍是那一条：**动没动样式**。
    //   ★起名避禁词：`closure`/`exit` 都不在下面那张禁词表里（★`event` 在表里，见 leg95 那次改名）。
    // ★★★leg100 同棒第二笔（用户令「**可以按甲吧**」——甲案：让"归档"与"候选"在给模型的资料里分得开）：
    //   `pack.js` 的归档那一栏盖 `closed: true`（**裁剪时也跟着留**）+ `prompts.js` 第 15 条补指路
    //   （同步 `MAIN_PROMPT_V` → `v2-agenda-t1-23`）。★这一笔改的是**给模型看的资料**，而那句话
    //   （收场被拒的报错）也会跟着多一层说明 ⇒ 可见面又变 ⇒ **同批再升一格** ⇒ **`leg100-archivemark`**。
    //   ★`CSS_VERSION` **不升**（样式零改动）——判据还是那一条：**动没动样式**。
    // ★★★leg101 `fitwindow`（用户令「**没事不急你直接改吧**」，起因是他贴实机截图并说
    //   「**窗口太小了，最重要的说书都没位置了**」）：**修面板把内容裁掉那个版面病**——三处全在
    //   `web/style.css`：①外壳改定高 flex 列并撤掉它自己的 `overflow:auto`（治"内外两条滚动条打架"）
    //   ②`.sw2-view.sw2-active` 吃余高并把滚动**按页**给出 ③`.sw2-merged-grid` 的
    //   `height:calc(88vh - 190px)` **改 `100%`**（那个 190px 是估的、且漏算了状态条与页签行 ⇒
    //   grid 比外壳真剩下的高度更高，正是打架的机理）。★**没有浏览器就量不出真值**（leg89 §5.5）
    //   ⇒ 不调常数、改结构，让高度由 flex 分配、**页签多一行少一行都不再算错**。
    //   ⇒ 玩家可见版面**真变了** ⇒ 再升一格 ⇒ **`leg101-fitwindow`**。
    //   ★`CSS_VERSION` **同批升**（本笔**真动了样式**——与 leg100 那两笔"零改动 ⇒ 不升"正相反，
    //     判据是同一条：**动没动样式**）。
    //   ★起名避禁词：`fit`/`window` 都不在下面那张表里。
    assert.equal(PANEL_BUILD, 'leg101-fitwindow');
    for (const bad of ['agenda', 'tick', 'ssot', 'schema', 'chronicle', 'entity', 'kind']) {
        assert.ok(!PANEL_BUILD.includes(bad), `构建号不得含「${bad}」`);
    }
    // ★★★leg99 再升一格（`leg98-pagecols` → **`leg99-seedborn`**）：**两把"事件出生轮"尺子合成一把**——
    //   `ev_seed_N` 里的 `N` 是**播种时的枚举号**（`src/seed-roots.js:149`），不是轮次；
    //   引擎那口按"取首个数字段"读成了第 `N` 轮 ⇒ 种子被算进"近 10 轮"窗口。
    //   ★玩家看得见的那一笔（真机账 大荒z · 第 12 轮）：信息带张力那行 **83 → 76**
    //     （装置 `F:/deepseek/tmp/prototypes/leg99-born-impact.mjs`；两个读数实测不受影响：
    //      张力 freq 腿两口径都早饱和在 1.000、乱象档位把种子剔掉照旧「大乱」）。
    //   ⇒ 面板上印出来的那个数真的变了 ⇒ 按纪律升位。★**那一笔 `CSS_VERSION` 不升**（样式零改动）。
    // ★★★leg99 同批第二笔（用户令「**动态流可以不要了**，其他就按那个模板做，但要注意**两列都能独自滑动**」）：
    //   **动态流撤出并页那一页** ＋ **两栏各自独立滑动**（容器定高、两栏 `overflow-y`、撤掉右栏 sticky）
    //   ⇒ 玩家可见的**版面真的变了** ⇒ 同批再升一格 ⇒ 定稿 **`leg99-pageflow`**。
    //   ★★**这一笔与上一笔正相反**：上一笔只动文本 ⇒ CSS 号不升；这一笔真动了 `web/style.css` ⇒ CSS 号**同批升**。
    //     两笔的判据是同一条（**动没动样式**）——这条纪律同时管"该升"与"不该升"，这正是它的价值。
    //   ★起名避禁词：`seed`/`born`/`flow` 都不在下面那张禁词表里。
    // ★★★leg99 同批第三笔（用户令「**没必要每个参数还要显示当前是什么，当前是什么值就是下拉栏的值**」）：
    //   参数页**撤掉重复印的当前值**（自变量那行整行撤 + 7 个上限撤掉旁边那枚琥珀数字；
    //   ★因变量「乱象」那一格留着——它没有控件）⇒ 可见文本变了 ⇒ 同批再升一格 ⇒ 定稿 **`leg99-paramquiet`**。
    //   ★`CSS_VERSION` **不升**（`web/style.css` 零改动：`.sw2-row` 的 `em` 是 `flex:1`，撤格后自然补位）
    //     ——与同批第二笔（动了样式 ⇒ 升）**又一次正相反**，判据是同一条：**动没动样式**。
    // ★★★leg98 补的锁（**反向自证当场咬出来的缺口**）：`CSS_VERSION` 在这条之前**没有任何断言**——
    //   全仓只有注释提到它（grep 实测）⇒ 我把 `web/index.js` 那个号**改回旧值**跑，判据**全绿**。
    //   ⇒ 那个"浏览器吃旧样式表"的病，判据是**防不住**的（只能靠人记得改）。现在把它钉住：
    //   ★口径：`CSS_VERSION` 与 `PANEL_BUILD` **同批升**的场合由人决定（判据管不了"该不该升"），
    //     但**"升成了哪个号"必须与构建号对得上**——这就是能机械核的那一半。
    const web = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    const cssVer = (/const CSS_VERSION = '([^']+)'/.exec(web) || [])[1];
    assert.ok(cssVer, '★`web/index.js` 里必须有一处 `CSS_VERSION`（它是"别让玩家吃旧样式表"的唯一开关）');
    assert.equal(cssVer, '20260922-leg101-fitwindow',
        `★CSS 号必须与构建号同批（leg101 本笔**真动了样式**：外壳定高 flex ＋ 当前页吃余高 ＋ grid 高度改 100%）；现为「${cssVer}」`);
    assert.match(cssVer, /^20\d{6}-leg\d+[a-z]?-[\w-]+$/, '形状：`2026MMDD-legNN…-名字`（升位链条要能一眼看出来）');
    // ★★★leg99 收窄（原来这条是 `cssVer.includes(PANEL_BUILD)`）：**改管"leg 号必须同批或落后一笔"**。
    //   ★为什么非改不可：leg99 的**第一笔**只升面板号、不升 CSS 号（文本变了、样式没变），
    //     两个号第一次停在不同的 leg 上 ⇒ 旧写法（"CSS 号要含着构建号全串"）**当场红**。
    //   ★口径一个字没放宽：它要守的是"**两个号同批**"，而"同批"本来就只由 **leg 号**表达；
    //     `rowbg`/`pagecols`/`seedborn`/`pageflow` 那截名字说的是"这一笔干了什么"，两个号各说各的**才是对的**。
    //   ★它**比旧写法更紧**：不许差两笔以上（差两笔正是"浏览器吃旧样式表"那个病的形状）。
    const cssLeg = (/leg(\d+[a-z]?)-/.exec(cssVer) || [])[1];
    const buildLeg = (/leg(\d+[a-z]?)-/.exec(PANEL_BUILD) || [])[1];
    assert.ok(cssLeg && buildLeg, '★两个号都要带得出 leg 号（否则下面这条是空绿）');
    assert.match(cssLeg, /\d+/, '前置：CSS 号里那个 leg 号必须是**数字开头**的（防空绿：`leg-` 也能被上面的正则吃下）');
    assert.equal(buildLeg, '101', '前置：本笔的构建号就是 leg101（锁自己也要能被反向自证咬住；★本条随升位同批改值——leg100 时它是 `100`。它咬的**不是"号该不该升"**，而是"下面那条比较**真的在比哪两个数**"）');
    // ★口径：**CSS 号的 leg 号只许是"本笔"或"上一笔"**——"同批"只允许差一笔（本笔只升面板号时它落后一格）。
    //   ★不许写成"只要都是 leg 就行"：那样 leg40 的 CSS 号配 leg99 的构建号也会绿，锁就白设了。
    const cssNum = Number((/^(\d+)/.exec(cssLeg) || [])[1]);
    const buildNum = Number((/^(\d+)/.exec(buildLeg) || [])[1]);
    assert.ok(buildNum - cssNum === 1 || buildNum === cssNum,
        `★CSS 号的 leg 号（${cssLeg}）必须与构建号（${buildLeg}）**同批或恰好落后一笔**——`
        + '差两笔以上说明某一个号忘了升（"浏览器吃旧样式表"那个病正是这么来的）');
    //   ★★★leg93b：形状判据**放宽一格**（同 leg50 那次放宽的理由）——原来是 `/^leg\d+-/`，
    //     它把"补笔"钉死了：`leg93b-…` **不匹配**（`\d+` 吃完 `93` 就要求 `-`，撞上 `b` 就红）。
    //     而本仓**本来就在用补笔写法**（`leg40b` 能过纯属侥幸：它 = `leg`+`40`+`b-`，`\d+` 只吃了 `40`；
    //     `leg90b`/`leg90c` 当年是**被这条判据咬红之后改的名**——那是判据错，不是名字错）。
    //     ⇒ 补上**可选的一个小写字母**。它要守的没变：**这是一串构建号、升位链条一眼看得出来**。
    assert.match(PANEL_BUILD, /^leg\d+[a-z]?-/, '形状：legNN-… 或 legNNb-…（升位链条要能一眼看出来）');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// 终审（全分支评审 2 Critical + 3 Important + 12 Minor）修正：逐条落成判据
//   ★本段一律**追加在文件末尾**：上面 §11.3 引用的那些 `test(...)` 行号不因本笔漂移
//     （细案 §11.3 的表按"截至某笔"标了行号，追加在末尾是最不容易让它失准的加法）。
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════

test('★★终审 C2：搜「未明」必须 0 命中（占位词不是内容，别让 475 行的占位词变成"线索"）', () => {
    // 判据出处：细案 Task 1 评审定夺③ + 计划 `:167`——「`entsSearchTextOf` 不再收「未明」」
    //   （原话：占位词不是内容，否则搜「未明」会命中 475 人）。实现当时**没跟上**，判据也没咬住。
    // ★为什么这条要在乎：位置列已撤（J1）⇒ 玩家再没有"这一格印的只是占位词"的唯一线索；
    //   而真账 475/621 实体的 `location === '未明'` ⇒ 搜「未明」会端出 475 个"位置未知"的人。
    const w = {
        version: 1, context: { world: 'x' }, entities: [
            { id: 'e_a', kind: 'character', name: '常驻修士', location: '未明' },
            { id: 'e_b', kind: 'character', name: '昆仑道祖', location: '西极昆仑山' },
        ],
        weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 1 },
    };
    assert.equal(selectEntityPage(w, { ...ENTS_DEFAULT_VIEW, q: '未明' }).hit, 0,
        '★占位词「未明」不许进搜索面（修正前真账实测 475/621；这条断言在修正前是红的）');
    // 对照（防"一刀把 location 从搜索面砍掉"这种过度修正）：真地名照旧查得到（细案 §3.3 是硬口径）
    assert.equal(selectEntityPage(w, { ...ENTS_DEFAULT_VIEW, q: '西极昆仑山' }).hit, 1,
        '对照：真地名照旧查得到——撤的只是占位词，不是把 location 整个撤出搜索面');
    assert.equal(entsSearchTextOf(w.entities[0]).includes('未明'), false,
        '★搜索面**本身**里就不该有这个词（不是靠命中侧再过滤一遍——那会变成第二份口径）');
    assert.ok(entsSearchTextOf(w.entities[1]).includes('西极昆仑山'), '对照：真地名仍在搜索面里');
});

test('★★终审 I1：chip 计数两个口径（全册 / 当前结果）——一份真源、两把尺子', () => {
    const w = {
        version: 1, context: { world: 'x' }, entities: [
            { id: 'e_1', kind: 'faction', name: '万法阁', location: '东海浮空岛' },
            { id: 'e_2', kind: 'character', name: '天工真人', location: '东海浮空岛', parent: '万法阁', lastActiveTick: 3 },
            { id: 'e_3', kind: 'character', name: '无名散人' },
        ],
        weights: {}, agendas: [{ id: 'a_1', owner: 'e_2', goal: 'g', closed: false }],
        events: [], chronicle: [], milestones: [], meta: { tick: 3 },
    };
    // ① 缺省 = 全册（既有调用点零扰动：`entsHitCounts(w)` 仍是老口径）
    const all = entsHitCounts(w);
    assert.deepEqual(all, { all: 3, faction: 1, character: 2, busy: 1, recent: 1, named: 1, orphan: 2 });
    assert.deepEqual(entsHitCounts(w, ENTS_DEFAULT_VIEW, 'all'), all, '★显式「全册」与缺省必须同一口径');
    assert.equal(ENTS_DEFAULT_VIEW.scope, 'all', '★默认口径 = 全册（不改既有观感）');
    // ②「当前结果」口径：每枚钮显示"在当前条件下点它会得到多少"——
    //    类别钮 = 把类别那一维换成它的值（其余当前条件不动）；筛选钮 = 在当前条件上加上这一条。
    const view = { ...ENTS_DEFAULT_VIEW, q: '东海浮空岛' };
    const hit = entsHitCounts(w, view, 'hit');
    assert.deepEqual(hit, { all: 2, faction: 1, character: 1, busy: 1, recent: 1, named: 1, orphan: 1 },
        '★「当前结果」口径的数（q 收窄到 2 之后各钮各是多少）');
    // ★"不许另写第二份计数逻辑"的行为锁：逐格与 `selectEntityPage` 的真值对齐（分歧必红）
    assert.equal(hit.all, selectEntityPage(w, { ...view, kind: 'all' }).hit, '全部 = 不换类别');
    assert.equal(hit.faction, selectEntityPage(w, { ...view, kind: 'faction' }).hit);
    assert.equal(hit.character, selectEntityPage(w, { ...view, kind: 'character' }).hit);
    assert.equal(hit.busy, selectEntityPage(w, { ...view, filters: ['busy'] }).hit);
    assert.equal(hit.recent, selectEntityPage(w, { ...view, filters: ['recent'] }).hit);
    assert.equal(hit.named, selectEntityPage(w, { ...view, filters: ['named'] }).hit);
    assert.equal(hit.orphan, selectEntityPage(w, { ...view, filters: ['orphan'] }).hit);
    // ★两个口径必须**真的不同**（否则上面那些断言是恒真的：两把尺子量出同一个数）
    assert.notDeepEqual(hit, all, '★筛选态下两个口径必须量出不同的数（否则这条判据咬不住任何东西）');
    // ③ 结构锁：计数只有一条筛选管线（`selectEntityPage` / `entsHitCounts` 共用 `entsRows`）
    const src = readFileSync(path.join(ROOT, 'src', 'render.js'), 'utf8');
    const fn = src.slice(src.indexOf('export function entsHitCounts('), src.indexOf('export function selectEntityPage('));
    assert.ok(fn.length > 100, '前置：找得到 `entsHitCounts` 的实现段');
    assert.match(fn, /entsRows\(/, '★「当前结果」口径必须复用 `selectEntityPage` 那条筛选管线（不许另写第二份计数实现）');
    // ④ 产物：两态钮在位，标签**如实**写当前口径（不是"全册/当前结果"两个词并排糊在一起）
    const asHit = renderEntitiesHtml(w, { view: { ...view, scope: 'hit' } });
    const asAll = renderEntitiesHtml(w, { view: { ...view, scope: 'all' } });
    assert.match(asHit, /data-action="ents-scope"/, '计数口径钮在位');
    assert.ok(asHit.includes('计数：当前结果'), '★当前口径一旦是「当前结果」，钮上就如实写它');
    assert.ok(asAll.includes('计数：全册') && !asAll.includes('计数：当前结果'), '★另一态如实写「全册」');
    assert.match(asHit, /data-action="ents-scope" data-value="all"/, '点它 = 切到另一个口径（`data-value` 是"点下去会变成什么"）');
    assert.match(asAll, /data-action="ents-scope" data-value="hit"/);
    // ⑤ 口径钮给的是**同一枚数**的两种读法：`全册` 那一态下 chip 上的数仍是老口径的真数
    assert.ok(asAll.includes(`>${all.all}<`), '「全部」格在全册口径下印全册真数');
    // ⑥ ★产物侧"口径真的传下去了"锁（**反向实验逼出来的**：把 `entsHitCounts(world, v, v.scope)` 改回
    //    `entsHitCounts(world)`，上面那几条照样绿 ⇒ 等于没锁）。两个口径下**同一枚钮的数必须不同**，
    //    而这两个数各自都是真值（命中 2 / 全册 3）⇒ 口径有没有从工具条传到计数处，这一条钉死。
    assert.match(asHit, /data-value="all">全部<span class="sw2-chip-n">2<\/span>/,
        '★「当前结果」口径下「全部」那枚印命中数（2）——不是全册的 3');
    assert.match(asAll, /data-value="all">全部<span class="sw2-chip-n">3<\/span>/,
        '★「全册」口径下同一枚印全册数（3）');
    assert.match(asHit, /data-value="orphan">无归属的<span class="sw2-chip-n">1<\/span>/,
        '★筛选钮也跟着口径走（当前结果里无归属的只有 1）');
    assert.match(asAll, /data-value="orphan">无归属的<span class="sw2-chip-n">2<\/span>/,
        '★全册口径下同一枚是 2');
});

test('★★终审 C1：中文输入法组合期不许抢 DOM（源码护栏 + 自带反向自证）', () => {
    // 病：搜索框的 input 处理**每次按键**都 `refreshSections(['entities'])`，而它会换掉搜索框的 DOM
    //   ⇒ **IME 组合中途被重置**（玩家打「东海浮空岛」打不出来）——正好打在用户验收第③步上。
    // ★★为什么这条**锁源码**而不锁行为（三句，都不许省）：
    //   ① IME 组合序列在 Node 里造不出来——`compositionstart/update/end` 是浏览器**输入法栈**派发的真事件，
    //      不是 `dispatchEvent` 能"模拟输入"出来的东西；本用例若自造假事件，验的恰好是假事件的时序假设
    //      （用假设证假设 = 本仓最贵的"假绿"）。
    //   ② 这段护栏的可观察效果是"**不**发生一次重绘"，而重绘要真 DOM **且**真世界对象
    //      （`refreshSections` 先取 `sw2LastWorld`、再取 `#sw2_view_entities` 节点，两者都拿不到就直接 return）
    //      ⇒ Node 侧的行为差异**不可观测**，锁行为只会得到一条永远为真的断言。
    //   ③ 本仓对这类接线判据的既有做法就是读真源码（`lookup-batch.test.js:441` 那组"画了按钮就必须有人接"、
    //      `render.test.js:122` 那条"set-param 不许整页重绘"同款）。
    //   ⇒ 为了**不是恒真断言**，本用例自带一次**反向自证**：把护栏那一行删掉，同一个判据必须变假。
    const web = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    const seg = inputHandlerSrc(web);
    assert.ok(seg.length > 100, '前置：找得到搜索框那条 input 处理（结构切片，不靠固定字节数）');
    assert.equal(hasCompositionGuard(seg, { cond: 'anyComposing', state: 'viewState.entities().q', redraw: "refreshSections(['entities'])" }), true,
        '★input 处理必须先判组合期（`e.isComposing || viewState.anyComposing()`）并早退，**且在改状态与重绘之前**');
    const stripped = seg.replace(/[^\n]*isComposing[^\n]*\n/g, '');
    assert.notEqual(stripped, seg, '前置：反向自证真的删掉了东西（否则下面那条等于没测）');
    assert.equal(hasCompositionGuard(stripped), false,
        '★反向自证：把护栏那一行删掉，同一条判据必须变假——证明它不是恒真的假绿');
    // 组合起止的接线：走**事件委托**（与既有 click / input 委托并列，不是给节点挂监听——重绘会换掉节点）
    //   ★leg50：委托面从**一个**搜索框扩到**两个**（编年页新加 `#sw2_ch_q`，同一副药）——
    //     所以这两条断言改按"两个框都在委托面里"咬，而不是只认实体页那一个。
    assert.match(web, /addEventListener\('compositionstart',[\s\S]{0,400}?closest\?\.\('#sw2_ents_q'\)/,
        '★`compositionstart` 委托到实体页搜索框（只认它，别把整面板的输入都拦下）');
    assert.match(web, /addEventListener\('compositionstart',[\s\S]{0,400}?closest\?\.\('#sw2_ch_q'\)/,
        '★leg50：`compositionstart` 也要委托到编年页搜索框（两个框同一副药）');
    assert.match(web, /addEventListener\('compositionend',[\s\S]{0,1400}?refreshSections\(\['entities'\]\)/,
        '★`compositionend` 必须把整串落账**并补一次重绘**（组合期一次都没重绘）');
    assert.match(web, /addEventListener\('compositionend',[\s\S]{0,900}?refreshSections\(\['chronicle'\]\)/,
        '★leg50：编年页那支同理（`compositionend` 落账 + 补一次重绘）');
    // ★★★leg79（丙-web 第四格）：**组合态标志随视图态族搬进 `web/view-state.js`** 了。
    //   原来的两条断言（`/^let sw2EntsComposing = false;$/m` 钉在 `web/index.js` 上）**跟着符号改指新家**——
    //   ★它们要说的那条口径**一个字没变**：标志必须是**模块级** `let`（三支监听共享同一个），
    //     挂在函数里等于没有；变的只是"哪一个文件是它的家"（与 leg78 改指 `hot-ledger.js` 同款处置）。
    const viewStateSrc = readFileSync(path.join(ROOT, 'web', 'view-state.js'), 'utf8');
    assert.match(viewStateSrc, /^let sw2EntsComposing = false;$/m,
        '★组合态标志是**新家**的模块级 `let`（不是函数内临时变量：三支监听要共享它）');
    assert.match(viewStateSrc, /^let sw2ChronicleComposing = false;$/m,
        '★leg50：编年页的组合态标志同样是新家的模块级 `let`');
    //   ★而且接线层**不许自己再存一份镜像**（`sw2EntsComposing = true` 那种直写 = 两份真相）；
    //     够到它一律走受控口：写 `setXxxComposing()`、读 `anyComposing()`。
    assert.ok(!/^\s*sw2(Ents|Chronicle)Composing\s*=/m.test(web),
        '★接线层不许直写组合态标志（那是新家的私有状态）——一律走 `viewState.setXxxComposing()`');
    assert.match(web, /viewState\.setEntsComposing\(true\)/, '★`compositionstart` 必须真的经 `viewState.setEntsComposing(true)` 置位');
    assert.match(web, /viewState\.setChronicleComposing\(false\)/, '★`compositionend`（编年那支）必须真的经 `viewState.setChronicleComposing(false)` 清位');

    // ★★leg50 追加：编年页搜索框的 input 处理**也要**有组合期早退——
    //   病与药与实体页逐字同款（同一屏里两个搜索框，只护一个等于没护）。
    //   ★反向自证同上：把编年页那半句护栏删掉，`hasCompositionGuard` 必须变假。
    //   ★leg79：两个标志合并成 `viewState.anyComposing()` 一口现读（不许抓进本文件的变量——
    //     与"取视图对象"同一条道理）⇒ 词表跟着换，**顺序那条口径不放宽**。
    const hasChronicleGuard = (s) => hasCompositionGuard(s, {
        cond: 'anyComposing', state: 'viewState.chronicle().q', redraw: "refreshSections(['chronicle'])",
    });
    const chSeg = inputHandlerSrc(web, '#sw2_ch_q');
    assert.ok(chSeg.length > 80, '前置：找得到编年页搜索框那条 input 处理');
    assert.equal(hasChronicleGuard(chSeg), true, '★编年页 input 处理同样必须先判组合期并早退');
    const chStripped = chSeg.replace(/anyComposing\(\)/g, '');
    assert.notEqual(chStripped, chSeg, '前置：反向自证真的删掉了东西');
    assert.equal(hasChronicleGuard(chStripped), false,
        '★反向自证：把编年页那半句护栏删掉，同一条判据必须变假（否则它就是恒真的假绿）');
});

function inputHandlerSrc(web, selector = '#sw2_ents_q') {
    // ★按**内容**挑，不按"第一次出现"挑：本文件另有一处 `win.addEventListener('input', onField)`（设置表单），
    //   取第一处会切到别人身上（本用例自己踩过：切到设置表单那段 ⇒ 判据假红）。
    //   ★leg50：选择器改成参数（实体页 `#sw2_ents_q` / 编年页 `#sw2_ch_q`）——
    //     两个搜索框各有一条 input 处理，按固定选择器挑只能看到一个（"只护一个等于没护"）。
    const marker = "addEventListener('input'";
    let from = 0;
    while (from < web.length) {
        const start = web.indexOf(marker, from);
        if (start < 0) return '';
        const braceStart = web.indexOf('{', start);
        let depth = 0;
        let seg = '';
        for (let i = braceStart; i < web.length; i += 1) {
            if (web[i] === '{') depth += 1;
            else if (web[i] === '}') {
                depth -= 1;
                if (depth === 0) { seg = web.slice(start, i + 1); break; }
            }
        }
        if (seg.includes(selector)) return seg;   // 认准那一个搜索框的分支
        from = start + marker.length;
    }
    return '';
}

function hasCompositionGuard(seg, vocab = {}) {
    // 判据 = ① 有一条以 `isComposing` **与**读标志的那一口为条件的早退；② 它排在改状态与重绘之前
    //   ★leg79：两个标志合并成 `viewState.anyComposing()`（并且视图对象改成 `const xv = viewState.xxx()`
    //     现取）⇒ 三个词表都参数化。★**顺序那条口径一个字没放宽**（它才是这条判据的命门：
    //     组合期若先写状态/先重绘，组合已经被打断了，早退也没用了）。
    //   ★★踩坑留档（本棒第二处"判据自己写窄了"，比 leg71 §4.1 那次更隐蔽）：
    //     原来那条条件正则 `if\s*\(([^)]*)\)` 是**配对不上就跨语句乱配**的——它遇到
    //     `if (e.isComposing || viewState.anyComposing())` 时在内层 `(` 上截断、配上**后面另一条语句**的 `)`
    //     ⇒ 抓到的"条件"根本不是这一条 ⇒ 判据**假红**（不是被注释骗，是它自己把条件切短了）。
    //   ⇒ 定稿换成**真正配对括号**的扫描器（遇到 `(` 一律嵌套计数），条件取到与 `if (`
    //     **同一个层级**的那个 `)`——这才是"这条 if 的条件"的定义。
    const { cond = 'anyComposing', state = 'ev.q', redraw = "refreshSections(['entities'])" } = vocab;
    const re = /if\s*\(/g;
    let m;
    while ((m = re.exec(seg))) {
        const open = m.index + m[0].length - 1;   // 那个 `(` 的位置
        let depth = 0;
        let close = -1;
        for (let i = open; i < seg.length; i += 1) {
            if (seg[i] === '(') depth += 1;
            else if (seg[i] === ')') { depth -= 1; if (depth === 0) { close = i; break; } }
        }
        if (close < 0) continue;
        const c = seg.slice(open + 1, close);
        if (!c.includes('isComposing') || !c.includes(cond + '(')) continue;
        //   ★这一条 if 之后必须紧跟 return（否则"判了却继续往下走"= 护栏形同虚设）
        if (!/^\s*\{?\s*return\b/.test(seg.slice(close + 1, close + 40))) continue;
        const stateAt = seg.indexOf(state);
        const redrawAt = seg.indexOf(redraw);
        return stateAt > m.index && redrawAt > m.index;
    }
    return false;
}

test('★终审 M10：视图态默认值**只有一份真源**（`ENTS_DEFAULT_VIEW` + `makeEntsView()`）', () => {
    // 病：`src/render.js` 的 `ENTS_DEFAULT_VIEW` 与视图态持有者各写一份字面量，
    //   靠人同步 ⇒ 本笔加 `scope` 字段时正是两处都要改（下一任漏一处就分叉）。
    // ★leg79（丙-web 第四格）：视图态族搬进 `web/view-state.js` ⇒ 这条锁**跟着符号改指新家**，
    //   并且**掰成两半**（两件事本来就不在一个文件里了）：
    //     ① 持有者（新家）**从渲染层取**默认值——不许自己再写一份；
    //     ② 接线层**不再**经手视图态字面量，也**不再**自己 import 那两个工厂（它够不到那份状态）。
    const web = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    const vs = readFileSync(path.join(ROOT, 'web', 'view-state.js'), 'utf8');
    // 计数前先按本仓既有做法**把注释行抹成空白**（`:110` 同款）：说明文字里也会写到这个函数名
    const blank = (s) => s.split('\n').map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? ' '.repeat(l.length) : l)).join('\n');
    const vsCode = blank(vs);
    assert.match(vsCode, /import[^;]*makeEntsView[^;]*from '\.\.\/src\/render\.js'/,
        '★视图态的新家从渲染层导入默认值（不许自己再写一份）');
    assert.equal((vsCode.match(/makeEntsView\(\)/g) || []).length, 2,
        '★初始值与关面板复位两处都用同一个工厂（不是两处字面量）');
    assert.ok(!/let sw2EntsView = \{/.test(vs) && !/sw2EntsView = \{ q:/.test(vs),
        '★新家里不许有第二份视图态字面量');
    // ② 接线层：不许再写一份字面量，也不许再自己 import 那两个工厂（否则又是"两个地方都能造它"）
    const code = blank(web);
    assert.ok(!/let sw2EntsView = \{/.test(web) && !/sw2EntsView = \{ q:/.test(web) && !/let sw2ChronicleView = \{/.test(web),
        '★接线层里不许再有第二份视图态字面量');
    assert.ok(!/import[^;]*makeEntsView[^;]*from/.test(code) && !/import[^;]*makeChronicleView[^;]*from/.test(code),
        '★接线层不许再 import 那两个工厂（默认值的取用点只有新家一处）');
    assert.match(code, /import \{ createViewStateHub \} from '\.\/view-state\.js'/,
        '★接线层必须从新家取 hub（它够到视图态的唯一通道）');
    // 行为锁：工厂与默认值同形，且 `filters` 是**新数组**（就地 push 不许污染默认值）
    const v = makeEntsView();
    assert.deepEqual(v, ENTS_DEFAULT_VIEW, '工厂产出的形状 = 默认值');
    assert.notEqual(v.filters, ENTS_DEFAULT_VIEW.filters, '★`filters` 必须是拷贝：接线层是**就地 push**，共用一个数组会把默认值改脏');
    v.filters.push('busy');
    assert.deepEqual(ENTS_DEFAULT_VIEW.filters, [], '★改一份不许动到默认值');
    assert.deepEqual(makeEntsView().filters, [], '★复位重取也必须是干净的');
    assert.equal(v.scope, 'all', '默认口径随工厂一起出去');
});

test('★终审 M6：工具条那几个类——生产者与声明对齐（补声明，不删生产者）', () => {
    // 病：本轮刚立"生产者与声明对齐"的规矩（同一批还删了同级死规则），而这三个类**有生产者零声明**。
    // ★选"补声明"而不是"删生产者"的理由（与 `.sw2-relone-crew` 同一先例）：它们各自承担一个**落点语义**——
    //   `-batch-note` 是工具条里那句整句**指路**（同一行还有一段"在跑进度"，两者同为 `.sw2-hint`，靠它分得开）；
    //   `-asks` / `-asks-body` 是「？」那枚可展开的**三态释义**容器与其正文。
    //   ★审计顺带发现漏了一条：`.sw2-ents-asks` 自己（工具条同批）也零声明 ⇒ 一起补（同一把尺子）。
    const css = readFileSync(path.join(ROOT, 'web', 'style.css'), 'utf8');
    const html = renderEntitiesHtml(world());
    for (const cls of ['sw2-ents-batch-note', 'sw2-ents-asks', 'sw2-ents-asks-body']) {
        assert.ok(html.includes(cls), `前置：${cls} 真有生产者（否则这条锁是空的）`);
        assert.match(css, new RegExp(`(^|\\n)\\.${cls}(?![\\w-])[^{\\n]*\\{`), `★${cls} 必须有自带声明`);
    }
});

// ═══════════════════════════════════════════════════════════════════════════════════
// ★★★ leg52（用户令「参数页 + 观棋页的待改项」+ 两条追加裁示）：本棒的六条新锁。
//   口径来源：`docs/session-handoff-2026-09-17-leg51.md` §2/§3/§4（Task 1/3/4）+ 用户当场拍板：
//     · 「保留天时/时局的下拉，只折叠说明文字并合并成一栏」
//     · 「大势就放大势，浪尖就放浪尖」
//     · 范围 = Task 1 + 说明文折叠 + 两把尺子对齐 + 派生源漏网
//   一律**追加在文件末尾**（照本文件既有纪律：上面的行号不因本笔漂移）。
// ═══════════════════════════════════════════════════════════════════════════════════

test('★★leg52·A：**参数页撤「推进」卡**（它是动作不是输入）——但入口一个都不许丢', () => {
    // 病（leg51 §2.1）：`data-action="advance-world"` 在设置页也有一枚 ⇒ 参数页那枚是**重复入口**；
    //   而 leg40b 当年把它挪过来的理由「这一页就是你对世界的输入」是错的——**推进一轮不写任何档位**。
    //   用户令「推进和撤销不应该放到参数页吧」⇒ 拍板「推进撤、撤销留并上移」。
    const w = world();
    const params = renderParamsHtml(w, { config: {} });
    const settings = renderSettingsHtml(w, { config: CONFIG });
    assert.ok(!params.includes('data-action="advance-world"'), '★参数页不许再画「推进一轮」');
    assert.ok(!params.includes('▶ 推进一轮'), '★参数页连那句话也不许留');
    assert.ok(settings.includes('data-action="advance-world"'), '★★入口必须仍在设置页（撤一处 ≠ 撤入口）');
    assert.ok(settings.includes('推进一轮'), '★设置页那枚的名字与状态栏提示同一口径');
    // ★旧版那条判据的**实质**要保住：面板说"要推请按「推进一轮」"时，那枚按钮必须真的存在。
    assert.ok(params.includes('「推进一轮」'), '关着总闸时那句指路仍要在（它在总闸卡的后果句里）');
});

test('★★leg52·B：**参数页撤「推进」卡 ≠ 删处理器**（接线那头一个字不许动）', () => {
    // ★这是本棒最容易做错的一格：`test/lookup-batch.test.js` 与 `test/param-hub.test.js` 都有一条
    //   "画了按钮就必须有人接"的全产物扫描，而 `advance-world` 是那张白名单里**唯一**的例外
    //   （它走 `dispatchAction` 的 tick 队列特判，不走动作总线）。撤了页面上的按钮之后，
    //   很容易顺手把 `web/index.js` 那个特判也删掉——**那会把设置页那枚变成死按钮**。
    //   ⇒ 判据直接读源码，锁住"特判还在"（这是**唯一**能锁它的地方：动作总线上根本没有这个键）。
    const web = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    assert.match(web, /action === 'advance-world'/, '★dispatchAction 里那个特判必须还在（否则设置页那枚变死按钮）');
    // ★★★leg88 撤回留档：这条判据在 leg87 里一度改成"必须**带着对话**调 advance"
    //   （`sw2TickQueue.advance(sw2PlayerUtteranceNow())`）——那笔改动服务的是"从你发的话里提取落子"，
    //   而**用户裁示那不是他要的提取**（他要的是"注入提示词 → 聊天模型产出带标签正文 → 插件从正文正则提取"）
    //   ⇒ 那一族连同这条断言一起撤回，恢复零参口径。★leg88 当时写明："它接进来的那天，这里仍然要跟着改一次"。
    // ★★★leg89：那天到了。新形状 = 手动路走 `sw2AdvanceOnce()`（与自动路**共用同一把尺子**）：
    //   · 递进去的是**最后一条正文**（标签长在里面）；
    //   · ★而且"同一段正文只推一次"——总闸开着时自动路已经推过这一条，手动再点一次
    //     会把**同一批标签提两遍**（世界可能把它当两轮用）。这条规矩是本笔新加的，所以要**真锁**：
    //     不只锁"名字还在"，还锁"它真的调了 tick 队列 + 真的拿了正文 + 真的有那条守卫"。
    assert.match(web, /sw2AdvanceOnce\(\)/, '★特判必须真的调推进入口（不只是判了个名字）');
    const onceAt = web.indexOf('export function sw2AdvanceOnce');
    assert.ok(onceAt > 0, '★`sw2AdvanceOnce` 必须存在（自动路与手动路共用它）');
    const onceBody = web.slice(onceAt, onceAt + 1800);
    assert.match(onceBody, /sw2TickQueue\.advance\(mes\)/, '★它必须**带着正文**调 tick 队列（否则标签永远提不到）');
    assert.match(onceBody, /sw2LatestMessageText\(freshCtx\(\)\)/, '★正文必须**现取**（抓死会读到上一个聊天的最后一条）');
    assert.match(onceBody, /skipped: 'same-message'/, '★必须有"同一段正文只推一次"的守卫（重复提取是本笔带出来的新风险）');
    assert.match(web, /advance: \(\) => sw2AdvanceOnce\(\)/, '★自动路也必须走同一个入口（两把尺子 = 迟早分叉）');
});

test('★★leg52·C：几格合并成一栏 —— **能力零损失**（天时/时局照旧能设、乱象照旧只读）', () => {
    // ★这是本棒对用户"有损决定先问"那条纪律的兑现：leg51 原案是"删下拉、降级成只读氛围标签"，
    //   而用户裁示**保住下拉**。⇒ 判据要把"保住了什么"逐项点名，防下一棒又顺手降级。
    // ★★leg53（口径升级·用户令「民生那一格拿掉」）：这一栏从四格变 **三格**，
    //   故下面 ③ 只剩 `动乱度`；**"民生不许出现在面板上"另有一条正向锁**（`leg53·F`）。
    const w = world();
    const html = renderParamsHtml(w, { config: {} });
    // ① 合并：这几格同住一卡（数卡不数行——合并的是"卡"，不是"格"）
    assert.equal((html.match(/sw2-atmo-card/g) || []).length, 1, '这几格一张卡');
    // ② **天时/时局仍是下拉**（每键一枚 `data-param` 的 select，且档位 = 白名单逐项）
    for (const key of ['天时', '张力推手']) {
        const anchor = `data-param="${key}"`;
        const at = html.indexOf(anchor);
        assert.ok(at > 0, `★「${key}」必须仍是可写参数（下拉）——删下拉＝玩家从此设不了它`);
        const block = html.slice(html.lastIndexOf('<select', at), html.indexOf('</select>', at));
        for (const g of PARAM_GEARS[key]) assert.ok(block.includes(`value="${g}"`), `「${key}」档位 ${g} 应在下拉里`);
    }
    // ③ **乱象仍是只读行**（不许顺手给它旋钮——那是 leg26 立的红线）
    const depRow = paramRowSeg(html, '动乱度', { firstRowOnly: true });
    assert.ok(depRow.includes('因变量') && !depRow.includes('<select'), '「动乱度」必须仍是只读呈现');
    // ④ 可写集合**不多不少**：参数页上带 `data-param` 的 = 两个自变量 + 两个开关 + 四个上限
    const writable = new Set([...html.matchAll(/data-param="([^"]+)"/g)].map((m) => m[1]));
    for (const k of ['天时', '张力推手', 'autoAdvance', 'memoryEnabled', ...LIMIT_KEYS]) {
        assert.ok(writable.has(k), `可写参数「${k}」不许在改版中丢掉`);
    }
    assert.ok(!writable.has('动乱度'), '★因变量不许混进可写集合（PARAM_NATURE 红线）');
    assert.ok(!writable.has('民生度'), '★leg53：民生那一格已撤，更不许以任何形式变成可写');
});

test('★★leg52·D：长说明折叠 —— **首句留在外面**、**后果句绝不折**、折叠壳看得见', () => {
    // 病（leg51 §1）：说明文占参数页可见字符 **56.6%**（668/1180）；用户令「折叠」。
    // ★三条口径（leg51 §4 Task 3 + §5 教训）：
    //   ① **首句必须留在外面**（首句就是结论——leg51 自己的演示第一版把整段藏进去，玩家看不到结论）；
    //   ② **后果话不折**（总闸那句"现在：插件静默…"是玩家最需要的一句）；
    //   ③ 折叠壳**默认收起**，但"还有说明"这件事必须**看得见**（`<summary>` 不是隐形触发区）。
    const off = world({ env: { autoAdvance: '0' } });
    const html = renderParamsHtml(off, { config: {} });
    // ① 有折叠壳，且默认是收起的（`<details>` 不写 `open`）
    const folds = [...html.matchAll(/<details class="sw2-fold">([\s\S]*?)<\/details>/g)];
    assert.ok(folds.length >= 2, `参数页应有若干折叠说明（实测 ${folds.length} 个）`);
    assert.ok(!/<details class="sw2-fold" open/.test(html), '★折叠默认收起（要玩家自己展开）');
    // ② 每个折叠壳都有**看得见的**招牌
    for (const f of folds) assert.match(f[1], /<summary>[^<]+<\/summary>/, '★每个 `<details>` 都要有非空 `<summary>`');
    // ③ 结论留外：卡片首句与开关后果句都在**折叠之外**
    const outsideFolds = html.replace(/<details class="sw2-fold">[\s\S]*?<\/details>/g, '');
    assert.ok(outsideFolds.includes('这一栏是<b>世界的样子</b>，不是世界的开关。'),
        '★首句（结论）必须留在折叠外面');
    assert.ok(outsideFolds.includes('插件静默'), '★★后果句（关掉总闸会怎样）绝不许折进去');
    assert.ok(outsideFolds.includes('构建 <b>'), '★构建号不折（折起来＝排障时等于没有）');
    // ④ 折进去的确实是"长说明"，不是把该留的也折了
    assert.ok(!outsideFolds.includes('这四格分别是什么'), '折叠的招牌自己不该出现在外面');
});

test('★★leg52·E：**"一个数两把尺子"收口** —— 参数页 / 设定页 / 观棋信息带读**同一本源**', () => {
    // ★★真账现场读数（本棒实测出来的**这条交接没看见的**真缺陷）：
    //   真源 `extension_settings.story_world_v2_params` = { 天时:'大灾', 每轮递线:'9', … }
    //   镜像 `dynamic.env`                                = { 动乱度:'动荡', autoAdvance:'0', … }（**没有天时**）
    //   ⇒ 同一时刻：参数页画「天时 大灾」（读真源）· 设定页画「天时 未定」· 信息带画「天时 未定」（读镜像）。
    //   `param-hub.js` 的口径是「**"这一格该显示什么值"只在 `displayEnv` 一处裁决**」，
    //   而 leg48 只治好了**参数页**这一个面 ⇒ 本棒把另两个面拉齐。
    const base = world();
    const mirrorOnly = structuredClone(base);
    // ★哨兵值的选法（**这条锁的全部技术含量**，第一版错了三回，逐条留档）：
    //   ① 夹具的 `env` 里本来就有 `天时:'大灾'` ⇒ 必须**先摘掉**，否则"读真源"与"读账"结果一样，
    //      这条锁会**两边都绿**；
    //   ② `大灾` 不能直接当哨兵：它出现在「世界尺度」的**档位说明文**里（面板正常就会画出来）；
    //   ③ **任何档位词都不能当"天时"的哨兵**——`<option>` 里的档位文本也是渲染产物
    //      （实测 `风调雨顺` 在基线上就命中，因为它是天时下拉的第四个选项）。
    //   ⇒ 定稿：哨兵只从**四个尺度上限的数字**里取（数字档位里"没被选中的那一档"面板不画成文本）
    //     —— `每轮递线 = 9`：出厂默认是 3，`9` 只在真源里出现。
    delete mirrorOnly.context.setting.dynamic.env['天时'];
    mirrorOnly.context.setting.dynamic.env['动乱度'] = '动荡';
    const SENTINEL_LIMIT = '9';                    // 每轮递线：出厂默认 3 ⇒ `9` 只在真源里
    const limitCell = (html) => {
        const at = html.indexOf('data-param-cell="每轮递线"');
        return at < 0 ? '' : html.slice(at, html.indexOf('</b>', at));
    };
    assert.ok(!limitCell(renderParamsHtml(mirrorOnly, { config: {} })).includes(`>${SENTINEL_LIMIT}<`),
        '前置：上限哨兵 `9` 不是基线值（否则这条锁两边都绿）');
    const srcEnv = { 天时: '大灾', 每轮递线: SENTINEL_LIMIT };
    const cfg = { paramEnv: srcEnv };

    const p = renderParamsHtml(mirrorOnly, { config: cfg });
    const s = renderSettingHtml(mirrorOnly, { config: cfg });
    const band = renderInfoBandHtml(mirrorOnly, { config: cfg });
    for (const [name, html] of [['参数页', p], ['设定页', s], ['观棋信息带', band]]) {
        assert.ok(html.includes('大灾'), `★★${name} 必须读真源（真源里天时=大灾，镜像里根本没有天时）`);
    }
    // ★★★leg99（用户令「当前是什么值就是下拉栏的值」）：上限那一行**不再印值格** ⇒ 改咬**控件自己带着的值**。
    //   ★这条判据的**实质一字未变**（"四个上限也必须读真源"）：旧版咬的是"值格里的字 = 哨兵"，
    //     现在咬"输入框的 value 属性 = 哨兵"——**更直接**（那正是玩家眼睛看到、也正是会被提交上去的那个数）。
    //   ★为什么敢换锚：值格与控件本来就同源（`sw2SetParamCell` 只读控件），
    //     撤掉格之后**控件成了唯一的真相面** ⇒ 咬控件比咬格更贴近事实。
    const limitValOf = (html) => {
        const at = html.indexOf('data-param="每轮递线"');
        return at < 0 ? '' : (/value="([^"]*)"/.exec(html.slice(at, at + 200)) || [])[1] || '';
    };
    assert.equal(limitValOf(p), SENTINEL_LIMIT,
        '★★参数页的四个上限也必须读真源（旧版这一栏单独漏掉过，判据在 leg41 抓红过一次）');
    assert.notEqual(limitValOf(renderParamsHtml(mirrorOnly, { config: {} })), SENTINEL_LIMIT,
        '前置/反向：不给真源时那个框里就不该是哨兵（否则上面那条两边都绿）');
    // ★★★leg99（同一条用户令）：**上限那一行也不许再印一遍那个数**——旁边就是输入框，
    //   同一个数并排出现两次＝同一件事两处表达。
    //   ★这条是**反向自证咬出来才补的**：本条第一版只钉了"框里带着值"，
    //     于是"把那枚琥珀色数字加回去"那个变异体**一路全绿**（实测：89/89 通过、fail 0）。
    //   ★量法：这一行里**可见文本**（剥掉 `<select>` 与属性）**一次都不许**出现那个数——
    //     数只许住在输入框的 `value` 属性里（属性不算可见文本，正是"控件自己带着值"的形状）。
    for (const key of ['每轮递线', '每轮事件', '顶层大计', '在飞大计']) {
        const row = paramRowSeg(p, key, { firstRowOnly: true });
        assert.ok(row, `前置：上限「${key}」那一行应当切得到`);
        const val = (/value="([^"]*)"/.exec(row) || [])[1] || '';
        assert.ok(val, `前置：上限「${key}」的输入框应当带着值`);
        // ★必须把「常用：…」那一段排除掉：那是**建议档**（`r.options`），
        //   与当前值**无关**，只是恰好可能同字 —— 本笔第一版没排除它 ⇒ 因为
        //   `SENTINEL_LIMIT = '9'` 正好在「常用：3 / 6 / 9」里而**假红**（尺子错，不是产品错）。
        const visibleText = textOnly(withoutSelects(row)).replace(/常用：[^ ]*(?: [^ ]+)*/g, ' ');
        assert.ok(!new RegExp(`(^|[^\\d])${val}([^\\d]|$)`).test(visibleText),
            `★★leg99：上限「${key}」那一行把值「${val}」又印了一遍可见文本（它只该住在输入框里）：${visibleText}`);
    }
    // 反向：**不给** paramEnv 时三个面一律退回读账（口径与 leg41 之前一致，行为不许变）。
    //   ★口径（第三版才定稿）：**不能用"某个档位词一次都不出现"当判据**——
    //     参数页的天时下拉把 **`大灾` 当 `<option>` 画出来了**（档位清单一律上板），
    //     所以"未给真源时 textOnly 里没有大灾"这条**永远不成立**（我自己写了三版才看穿）。
    //   ⇒ 改成**增量判据**：给了真源 ⇒ 该值多出现**恰好一次**（那一格）；不给 ⇒ 一次都不多。
    //     这个形状同时锁住了"真源确实被采纳"与"只被采纳一次"（不是把值又重复画一遍）。
    // ★★★leg99（同一条用户令）——**这条判据的量法必须换，而口径一字未变**：
    //   自变量那一格撤掉之后，"真源被采纳"的证据**搬进了下拉的 `selected` 属性**，
    //   而 `textOnly` 会**把属性整段剥掉** ⇒ 增量恒为 0（实测：1 − 1 = 0，当场红）。
    //   ★这不是判据"放松"：它原来要证的是"**这个值被画出来了、且只画一处**"，
    //     现在那个"一处"就是**控件自己带着的那个值** ⇒ 直接读控件：
    //     `天时` 读下拉的 selected、`每轮递线` 读输入框的 value（上面 `cellText` 已经是这条口径）。
    //   ★而**"只画一处"这半条没有丢**：`cellText` 读的是"控件里那一个值"，
    //     配合下面"因变量只读、自变量不许再多印一格"的锁，正好把那半条钉在结构上。
    const countIn = (html, needle) => (textOnly(html).match(new RegExp(needle, 'g')) || []).length;
    // ★★★leg99（用户令「当前是什么值就是下拉栏的值」）：有控件的那几行**不再印值格** ⇒
    //   这个助手升级成"**这个键当前显示的值在哪**"：①先找值格（因变量的家）②再找控件自己的值
    //   （`<select>` 看 `selected` 那一项、`<input>` 看 `value`）——★两边读的都是"玩家眼睛看到的那个值"，
    //   口径与原来**一字未变**（原来咬"这一格采纳了没有"，现在咬"这个键显示的采纳了没有"）。
    //   ★它必须在**使用点之前**声明（`const` 有 TDZ——本笔第一版放在后面，当场 ReferenceError）。
    const cellText = (html, key) => {
        const at = html.indexOf(`data-param-cell="${key}"`);
        if (at >= 0) {
            const gt = html.indexOf('>', at);
            return html.slice(gt + 1, html.indexOf('</b>', gt));
        }
        const attr = html.indexOf(`data-action="set-param" data-param="${key}"`);
        if (attr < 0) return '';
        // ★下拉：看 `selected` 那一项；★输入框：**只在那个 `<input …>` 标签里**找 `value`
        //   （不加这个边界会先撞上选项里的 `value=""`，读到「未定」——本笔当场踩过）。
        const tagStart = html.lastIndexOf('<', attr);
        const tag = html.slice(tagStart, html.indexOf('>', attr) + 1);
        if (/^<input/i.test(tag)) return (/value="([^"]*)"/.exec(tag) || [])[1] || '';
        const selected = /<option value="([^"]*)" selected>/.exec(html.slice(attr, attr + 900));
        return selected ? selected[1] : '';
    };
    const p0 = renderParamsHtml(mirrorOnly, { config: {} });
    const s0 = renderSettingHtml(mirrorOnly, { config: {} });
    const b0 = renderInfoBandHtml(mirrorOnly, { config: {} });
    // ① 参数页：真源被采纳 ⇒ **控件带着它**；不给真源 ⇒ 控件不带着它
    assert.equal(cellText(p, '天时'), '大灾',
        '★参数页：给了真源 ⇒ 天时那个下拉必须选中「大灾」（镜像里没有它）');
    assert.notEqual(cellText(p0, '天时'), '大灾',
        '★前置/反向：不给真源时那个下拉就不该选中「大灾」（否则上面那条两边都绿）');
    assert.equal(countIn(p, '大灾') - countIn(p0, '大灾'), 0,
        '★★leg99：参数页**别处**不许再多画一遍「大灾」（值只住在控件里——旧版那一格已经撤掉）');
    // ② 设定页 / 信息带：那两页仍然是**文本呈现**（没有控件）⇒ 增量判据原样保留
    assert.equal(countIn(s, '大灾') - countIn(s0, '大灾'), 1,
        '★设定页：同上（旧版这一页读镜像 ⇒ 增量恒为 0，正是本棒要治的病）');
    assert.equal(countIn(band, '大灾') - countIn(b0, '大灾'), 1,
        '★观棋信息带：同上');
    assert.equal(countIn(s0, '大灾'), 0, '设定页没给真源时不该凭空画出一个天时');
    assert.equal(countIn(b0, '大灾'), 0, '信息带没给真源时不该凭空画出一个天时');
    // ★**因变量不许被真源覆盖**（`param-store.js` 明写"真源永不管辖因变量"）：
    //   真源里塞一个 `动乱度` ⇒ 三个面都**不许**采纳它，仍照账呈现。
    //   ★口径（第二版才定稿）：**不许按"字面量在不在"判**——档位词会作为 `<option>` 被画出来
    //     （`大乱` 就在动乱度下拉的选项里），第一版那条字面判据**结构性假红**。
    //     要判的是"**这一格采纳了没有**"，所以按格判。
    //   ★★leg53：`民生度` 已从面板撤下 ⇒ 这里只剩 `动乱度` 一格可判（"民生不许上板"由 `leg53·F` 正向锁）。
    const sneaky = { 动乱度: '大乱', 天时: '平常' };
    assert.equal(cellText(renderParamsHtml(mirrorOnly, { config: { paramEnv: sneaky } }), '动乱度'), '动荡',
        '★★参数页：真源里的**因变量**不许覆盖账上的值（动乱度仍应是账上的「动荡」）');
    assert.equal(cellText(renderParamsHtml(mirrorOnly, { config: { paramEnv: sneaky } }), '天时'), '平常',
        '★对照组：真源里的**自变量**必须照采（否则上面那条可能只是因为"整体没生效"而假绿）');
    // 三个面必须**同源同值**：同一份输入下，"天时"那一格在三个面里画的是同一个词
    assert.ok(textOnly(s).includes('大灾') && textOnly(band).includes('大灾'),
        '★设定页与信息带同源同值（本棒要治的正是"同一时刻画三个值"）');
    // `renderAll` 是接线层真正调的那一扇门 —— 它必须把 `config` 继续透传下去
    const all = renderAll(mirrorOnly, { config: cfg });
    assert.ok(all.setting.includes('大灾'), '★★renderAll 必须把 paramEnv 透传给设定页（leg52 前它没传）');
    assert.ok(all.board.infoband.includes('大灾'), '★★renderAll 必须把 paramEnv 透传给信息带');
});

test('★★leg52·G：**接线面**——每一次 `renderAll` 都必须带上 `renderCfg()`（真源才不会半路丢掉）', () => {
    // 为什么必须锁这一层（本棒的"应用层"判据，与 E 那条"渲染层"判据配对）：
    //   E 证明"给了 `paramEnv` 三个面就同源"；但**给不给**由 `web/index.js` 决定——
    //   只要有一处 `renderAll(world, {...})` 忘了 `config: renderCfg()`，那一处就会静默退回读镜像，
    //   于是"设定页/信息带偶发画旧值"会以**间歇**的形状回来（最难查的那一类）。
    //   `renderCfg()` 是**唯一**的配置路（leg27 后它撤掉了 `config` 形参，只留这一条），
    //   而它自己**总是**注入 `displayEnv(w)`（leg82 起经受控口 `paramApi.displayEnv(w)`）⇒ 判据只需保证两件事：
    //     ① `renderCfg` 里 `paramEnv` 仍然来自 `displayEnv`（不是另写一处"没有就是空"）；
    //     ② 全仓每一处 `renderAll(` 的 `config` 都**溯源到 `renderCfg()`**。
    //   ★口径（第一版太死，自证抓红留档）：不许把 `config:` 写成**字面** `renderCfg()`——`set-param`
    //     那一处走的是 `const cfgForRender = renderCfg(live.env ? { paramEnv: live.env } : {})`，
    //     它是**更紧**的一条路（刚写完的真源当场进渲染），字面判据会把它误判成漏传。
    //     ⇒ 判据改成"**同文件里那一行的 config 变量是从 renderCfg 来的**"（向前找 400 字内的赋值）。
    const web = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    const cfgAt = web.indexOf('function renderCfg(');
    assert.ok(cfgAt > 0, '前置：找得到 renderCfg');
    const cfgSeg = web.slice(cfgAt, web.indexOf('\n}', cfgAt));
    assert.match(cfgSeg, /paramEnv:\s*paramApi\.displayEnv\(/,
        '★`paramEnv` 必须来自 `displayEnv`（值的裁决只许一处——leg41 的"下拉全空白"就是这么来的）');
    // ② 每一处 renderAll 的 config 都要溯源到 renderCfg
    const calls = [...web.matchAll(/renderAll\(/g)];
    assert.ok(calls.length >= 2, `前置：接线层有多处 renderAll（实测 ${calls.length} 处）`);
    for (const m of calls) {
        const line = web.slice(0, m.index).split('\n').length;
        const seg = web.slice(m.index, m.index + 400);
        const direct = /config:\s*renderCfg\(/.test(seg);
        // `config: <某个变量>` ⇒ 往前找那个变量的赋值是不是 renderCfg(...)
        const named = /config:\s*([A-Za-z_$][\w$]*)/.exec(seg);
        let viaVar = false;
        if (named) {
            const before = web.slice(0, m.index);
            viaVar = new RegExp(`(const|let|var)\\s+${named[1]}\\s*=\\s*renderCfg\\(`).test(before);
            // 也认形参（例如 `renderAll(world, { config })`，config 由上层转手）
            if (!viaVar) viaVar = new RegExp(`[{,]\\s*config\\s*[,}]|\\bconfig\\s*[,)]`).test(seg);
        }
        assert.ok(direct || viaVar,
            `★web/index.js 第 ${line} 行的 renderAll 没把 config 溯源到 renderCfg() ⇒ 那一路会退回读镜像`);
    }
});

test('★★leg55：面板上的数字必须**现算**——「自动入卷阈值」真源接线（leg54 §6.4 的第一次系统落地）', () => {
    // 病灶（leg40b 体检**已登记未治**，本棒结掉）：`render.js` 那一行写着
    //   `${cfg.limitsTicks ?? '500'} 轮 或 ${cfg.limitsBytesMB ?? '5'}MB`，
    //   而 `web/index.js` 的 `renderCfg()` **从不注入这两个键** ⇒ 生产上恒 `undefined`、
    //   兜底字面量恒生效：**"从 config 现读"是一句谎话**，印出来的其实是渲染层自己抄的一份数。
    //   ★它为什么能活这么久：值与真源一致 ⇒ **看着永远是对的**，只有真源一改才会变成谎话
    //     ——与 leg54 那个「4096」同一种病（那行过期了好几棒，还差点让我用错数劝住用户）。
    // ⇒ 判据两半，缺一不可（只锁渲染层那一半＝空绿，正如它过去的状态）：
    //   ① 渲染层那条路要**真的读 cfg**（上面 K34 那条用 777/9 锁了）；
    //   ② 接线层要**真的注入**（本条的正文）——否则"给了就画对"跟"根本没给"是两回事。
    const web = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    const cfgAt = web.indexOf('function renderCfg(');
    assert.ok(cfgAt > 0, '前置：找得到 renderCfg');
    const cfgSeg = web.slice(cfgAt, web.indexOf('\n}', cfgAt));
    // 这两个键必须由 `PROPOSED_LIMITS`（**真源**）现算，不许写字面量数字
    assert.match(cfgSeg, /limitsTicks:\s*PROPOSED_LIMITS\.ticks/,
        '★`limitsTicks` 必须从 `PROPOSED_LIMITS.ticks` 现读（写死 500 ⇒ 真源一改面板就说谎）');
    assert.match(cfgSeg, /limitsBytesMB:\s*PROPOSED_LIMITS\.bytes\s*\/\s*1024\s*\/\s*1024/,
        '★`limitsBytesMB` 必须从 `PROPOSED_LIMITS.bytes` 现算 MB（字节→MB 的换算只许住这一处）');
    // 反向守门：`renderCfg()` 里不许再出现裸的阈值字面量（防"接上真源"与"写死"两条路并存）
    assert.doesNotMatch(cfgSeg, /limitsTicks:\s*\d/, '★不许退回写死（`limitsTicks: 500`）');
    // ③ 另一头钉住真源本身：面板印的数就是引擎轮转**当缺省**用的那份常量
    //    （`planChronicleRotation` 不传 `limits` 时走 `PROPOSED_LIMITS` ⇒ 显示与行为同一个数）
    assert.equal(PROPOSED_LIMITS.ticks, 500, '★出厂冷档 tick 阈值＝500（K38 报批项 #1，改这里要连带改面板）');
    assert.equal(PROPOSED_LIMITS.bytes, 5 * 1024 * 1024, '★出厂冷档字节阈值＝5MB（同上）');
    // ④ 渲染层源码里不许留下那对**旧兜底写法**（`?? '500'` / `?? '5'`）——它正是死路的化石
    //   ★口径（第一版被自己判红、当场改）：整份源码直扫会**咬到解释这条病的注释本身**
    //     （leg55 的留档注释里逐字引了旧写法）⇒ 先剥掉行注释再断言。留着"照抄一遍旧写法当反例"
    //     的自由，同时保证**代码**里再也搜不到它（本仓的留档惯例要求注释能引用病句）。
    const renderSrc = readFileSync(path.join(ROOT, 'src', 'render.js'), 'utf8');
    const renderCode = renderSrc.split('\n')
        .map((l) => l.replace(/\/\/.*$/, ''))   // 行注释剥掉（本文件无块注释）
        .join('\n');
    assert.ok(!/\?\?\s*'500'/.test(renderCode) && !/\?\?\s*'5'/.test(renderCode),
        '★旧的 `?? \'500\'` / `?? \'5\'` 死兜底不得回潮（它让"读 config"那半边永远不生效）');
});

test('★★leg55·二：设定页「乱象」说明里的窗口数必须**现读 `TENSION_WINDOW`**（同类第二处）', () => {
    // 病（与上一条同一个形状，只是换了个面）：那句说明原写死「看近 **10** 轮里"出事"铺到了几个地点」，
    //   而**机制本身**在 `src/unrest.js`：「乱象档位 = 近 `TENSION_WINDOW` 轮里…」（`UNREST_WINDOW = TENSION_WINDOW`）
    //   ⇒ 面板**替机制承诺了一个它没写死的数**：`TENSION_WINDOW` 一改，说明变谎话而**代码照旧对**
    //   ——leg54 那个 4096 的同一种病（UI 比代码先过期）。
    //   ★同文件里 `TENSION_WINDOW` 已被现读三处（张力行两处 + 设定页一处）⇒ 本处只是**漏网的那一处**，
    //     而"漏一处"正是它当年没被现读覆盖的原因 ⇒ 判据必须**按机制口径**锁，不能只锁"某一行有字"。
    //   ★口径修正（第一版写 `renderSettingsHtml` 被自己判红逼出来）：这句说明住在**参数页**
    //     `renderParamsHtml`（「世界气氛与条件」卡），不在设定页 —— 两张卡容易混，故写明。
    const html = renderParamsHtml(world(), { config: CONFIG });
    assert.ok(html.includes(`看近 ${TENSION_WINDOW} 轮里`),
        `★乱象说明里的窗口数必须来自 TENSION_WINDOW（现值 ${TENSION_WINDOW}）`);
    // 反向自证：把常量当成"会被改的数"，断言这句**不是**写死的 10 ——
    //   若将来 TENSION_WINDOW 被报批改成别的值，上面那条会跟着走，而写死的 10 不会。
    if (TENSION_WINDOW !== 10) {
        assert.ok(!html.includes('看近 10 轮里'), '★窗口数已改，说明句不许还印旧数（写死的化石）');
    }
    // 机制侧的锚：面板那句话描述的窗口，必须就是 `unrest.js` 真正在用的那个
    assert.equal(UNREST_WINDOW, TENSION_WINDOW,
        '★乱象窗口必须与张力窗口同源（`unrest.js` 明写"不另立窗口数"）');
});

test('★★leg52·F：BLACKLIST 漏网「派生源」—— 注释里禁的字面量，数组里必须真有', () => {
    // 病：`render.js:8` 的文件头注释从 leg26 起就写着"禁：…**派生源**…"，
    //   而 `BLACKLIST` 数组里**只有英文 `derivedFrom`** ⇒ 设定页那句「浪尖（派生源）」印了十几棒
    //   都没被咬住——因为判据只扫渲染产物，**数组里没有的字面量＝不存在**（守门是空绿）。
    assert.ok(BLACKLIST.includes('派生源'), '★声明里禁的词，数组里必须真有（否则那条守门是空绿）');
    const full = renderAll(world(), { config: CONFIG, oldVolumes: VOLUMES });
    const text = deepStrings(full).map(textOnly).join('\n');
    for (const term of BLACKLIST) assert.ok(!text.includes(term), `★含禁词「${term}」`);
    // ★反向自证（防这条锁退化成空绿）：夹具里**真的**有浪尖数据，改了措辞才有东西可扫
    assert.ok(full.setting.includes('浪尖'), '前置：设定页真有浪尖那一栏（否则上面那条扫的是空气）');
    assert.ok(!full.setting.includes('派生源'), '★设定页措辞已改成玩家话');
});

// ═══════════════════════════════════════════════════════════════════════════════════
// ★★★ leg53（用户指认「**民生和乱象没人消费啊也没人生产**」）：本棒的锁。
//   取证（全仓 grep 的机械结论，见 `src/unrest.js` 头部）：写点只有「初始化抽书」一处，
//   读点里**引擎一条判据都不读**；`param-hub.js:520` 那句"世界的因变量归世界自己每轮写"
//   在此之前**是假的**（全仓无此代码）⇒ 本棒把「乱象」那句话变成真的，并把「民生」从面板撤下。
// ═══════════════════════════════════════════════════════════════════════════════════

test('★★leg56·一：分段档位条 —— 点亮格数＝该档位在**它自己那张表**里的序位（不是两态装饰）', () => {
    // 用户令：「根据挡位渲染不同长度的进度条」+「中间太空旷了」。
    // ★这条锁的**唯一理由**是把"新条 ≠ leg40b 撤掉的那条"钉死（否则下一任会以"两态恒真"为由再撤一次）：
    //   撤掉的那条：`width: 0% | 100%` 两态 ⇒ 只有"有值/没值"两种长相，信息量 0。
    //   现在这条：点亮格数 = `PARAM_GEARS[key].indexOf(value) + 1` ⇒ 真值不同则**长度不同**。
    // 本夹具三格正好是三种不同序位（乱象 动荡=3/4 · 天时 大灾=1/4 · 时局 紧绷=4/4）——这是它能当判据的前提。
    const html = renderInfoBandHtml(world());
    const grab = (name) => {
        const m = new RegExp(`sw2-env-name">${name}</span><span class="sw2-gearbar([^"]*)"[^>]*>((?:<i[^>]*></i>)*)`).exec(html);
        assert.ok(m, `前置：${name} 那一行要画得出档位条`);
        return { unset: m[1].includes('unset'), lit: (m[2].match(/class="on"/g) || []).length, total: (m[2].match(/<i/g) || []).length };
    };
    const luan = grab('乱象'); const tian = grab('天时'); const shi = grab('时局');
    assert.equal(luan.total, 4, '档位表是 4 档 ⇒ 轨道 4 格');
    assert.equal(luan.lit, 3, '乱象=动荡 ⇒ 表里第 3 位 ⇒ 点亮 3 格');
    assert.equal(tian.lit, 1, '★天时=大灾 ⇒ 表里第 1 位（**第 1 档也是 1 格，不是 0 格**——0 格是"未定"的意思）');
    assert.equal(shi.lit, 4, '时局=紧绷 ⇒ 第 4 位 ⇒ 满格');
    // ★核心断言：三格必须画出**不止一种长度**——这一条才是"它不是恒真装饰"的机械证据
    assert.ok(new Set([luan.lit, tian.lit, shi.lit]).size >= 2,
        '★★三格真值不同 ⇒ 点亮格数**必须不同**（若恒等，那就退化成 leg40b 撤掉的"两态恒真"装饰）');
    // ★不写数字、不写百分数（leg26 红线："档位是人话原话，不是数"）——玩家读到的只有原话
    assert.ok(!/%/.test(html) && !/sw2-gearbar[^>]*>\s*\d/.test(html), '★条上不许印百分数/数字');
});

test('★★leg56·二：未定 ⇒ **空轨道**（保留「未定」文字，不点亮、不消失）', () => {
    const bare = structuredClone(world());
    bare.context.setting.dynamic.env = {};
    const html = renderInfoBandHtml(bare);
    for (const name of ['乱象', '天时', '时局']) {
        const m = new RegExp(`sw2-env-name">${name}</span><span class="sw2-gearbar([^"]*)"[^>]*>((?:<i[^>]*></i>)*)`).exec(html);
        assert.ok(m, `${name} 未定时**轨道仍在**（不是整条消失——那会让那几行重新变空旷）`);
        assert.ok(m[1].includes('unset'), `${name} 未定 ⇒ 走空轨道样式`);
        assert.equal((m[2].match(/class="on"/g) || []).length, 0, `${name} 未定 ⇒ **一格都不点亮**（不猜、不填假档）`);
        assert.equal((m[2].match(/<i/g) || []).length, 4, `${name} 未定 ⇒ 轨道仍是 4 格（形状不变，只不点亮）`);
    }
    assert.match(html, /未定/, '★文字照旧写「未定」（条是视觉冗余，不许取代原话）');
});

test('★★leg56·三：异体词（旧账里有、档位表里没有）⇒ 不点亮，**不许当第一档**', () => {
    // 病理性输入：`PARAM_GEARS` 里没有这个词（换过表 / 旧账残留）⇒ `indexOf` 返 -1。
    //   ★若拿 -1 直接画，`i < -1` 一格不亮（对），但若写成"没找到就当第一档"就会**凭空点亮一格**——
    //     那是面板替世界编了一个档位。这条把两种写法的区别钉死。
    assert.equal((gearBarHtml(0, 4, false).match(/class="on"/g) || []).length, 0,
        '★序位 0（词不在表里）⇒ 一格都不点亮');
    assert.equal((gearBarHtml(0, 4, false).match(/<i/g) || []).length, 4, '轨道格数不随序位变');
    // 边界：越界一律钳住（表变短、旧账序位偏大 ⇒ 不许画出第 5 格）
    assert.equal((gearBarHtml(9, 4, false).match(/class="on"/g) || []).length, 4, '★越界钳到满格，不画第 5 格');
    assert.equal((gearBarHtml(-3, 4, false).match(/class="on"/g) || []).length, 0, '负数钳到 0');
    // 真正的路径：★口径修正（第一版断言写错、被自己判红逼出来）——
    //   账上放一个**不在档位表里**的词时，它**根本到不了渲染层**：`resolveEnv` 会走 `normalizeParam`
    //   把它归一掉，于是面板画「未定」（与"引擎不认的词不许冒充档位"同一条口径）⇒ 那才是对的。
    //   ⇒ 所以这条要断的是"**归一后落到未定**"，而不是"原话照旧印出来"（我第一版把两者搞混了）。
    //   `gearBarHtml(0,…)` 那三条边界锁的是**函数本身**（万一将来有别的调用方直接喂序位）。
    const odd = structuredClone(world());
    odd.context.setting.dynamic.env = { ...odd.context.setting.dynamic.env, 天时: '书上原话·非本表词' };
    const html = renderInfoBandHtml(odd);
    const oddRe = new RegExp('sw2-env-name">天时</span><span class="sw2-gearbar([^"]*)"[^>]*>((?:<i[^>]*></i>)*)</span><span class="sw2-env-val">([^<]*)');
    const m = oddRe.exec(html);
    assert.ok(m, '前置：天时那一行取得到');
    assert.equal((m[2].match(/class="on"/g) || []).length, 0, '★不在表里的词 ⇒ 一格都不点亮（不冒充某一档）');
    assert.equal(m[3], '未定',
        '★不认的词被归一成「未定」（它到不了渲染层：`resolveEnv`→`normalizeParam`）——'
        + '面板不许替世界认一个引擎不认的档位；★同时**轨道仍在**（未定 ≠ 整条消失）');
    assert.ok(m[1].includes('unset'), '且走未定的空轨道样式');
});

test('★★leg56·四：「盘算」栏的上限必须读**真源**（不再印编译期常量 `AGENDA_CAPS`）', () => {
    // 病（用户实机截图）：参数页四框写着 10/12/30/40，同一屏旁边的「盘算」栏却印 `9/20 · 顶层 9/15`
    //   —— 因为那一栏读 `AGENDA_CAPS`（`limits.js` 的出厂常量，**永不随档位变**），而参数页读真源。
    //   ★★不只是观感：**引擎读的是 `resolveLimits(world)`** ⇒ 真跑用 10/12/30/40，**错的是面板**。
    const live = { 在飞大计: 88, 顶层大计: 77 };
    const html = renderInfoBandHtml(world(), { config: { paramEnv: live } });
    assert.match(html, /顶层 \d+\/77/, '★顶层上限必须跟着真源走（77）');
    assert.match(html, /<small>\/88<\/small>/, '★在飞上限必须跟着真源走（88）');
    // 反向自证：不传真源 ⇒ 退回出厂默认（20/15）——证明上面那条**真的是被 config 改动的**
    const noCfg = renderInfoBandHtml(world());
    assert.match(noCfg, /顶层 \d+\/15/, '不传真源 ⇒ 退回出厂默认 15（与 `LIMIT_DEFAULTS` 同源）');
    assert.match(noCfg, /<small>\/20<\/small>/, '不传真源 ⇒ 退回出厂默认 20');
    // ★并且它必须与参数页**读同一份**：同一个 config 喂两张面，分母不许分叉
    const paramsHtml = renderParamsHtml(world(), { config: { paramEnv: live } });
    assert.ok(paramsHtml.includes('77') && paramsHtml.includes('88'),
        '★同一份真源喂参数页 ⇒ 那张面也必须画 77/88（同一把尺子，不许一面读真源一面读常量）');
    // 非法值不许炸、也不许写进分母：退回默认（照本仓"失败零阻塞"）
    const bad = renderInfoBandHtml(world(), { config: { paramEnv: { 顶层大计: 'abc', 在飞大计: -5 } } });
    assert.match(bad, /顶层 \d+\/15/, '★非法真源值 ⇒ 退回默认，不许把 abc 印进分母');
});

test('★★leg56·五：「世情 · N 键」的 N 必须**现算**（不许再写死「四键」）', () => {
    // 病：`render.js` 里写死「世情 · 四键」，而 leg53 已把民生撤下 ⇒ 实际只有 3 格
    //   ⇒ 玩家看到「四键」下面却只有三行（用户实机截图：「还是四键」）。
    //   ★与 leg54 那个 4096、leg55 那个 500/5MB **同一种病**：面板上的数字脱离了它的数据。
    const html = renderInfoBandHtml(world());
    assert.match(html, new RegExp(`世情 · ${PANEL_ENV_KEYS.length} 键`), '★键数由 PANEL_ENV_KEYS 现算');
    assert.ok(!html.includes('四键'), '★「四键」这个写死的字面量不得回潮');
    // 反向自证：真值是 3（不是 4）——否则这条锁在"恰好等于 4"时是空绿
    assert.equal(PANEL_ENV_KEYS.length, 3, '前置：面板真画 3 格（民生已撤）⇒ 写死「四键」是错的');
});

test('★★★leg53·F：**民生那一格从玩家可见面彻底撤下**（用户令「拿掉」），且**旧账兼容不被破坏**', () => {
    // 病的形状（本棒取证）：`民生度` 被定义成"因变量"、面板因此不给旋钮（leg26 红线），
    //   而它**唯一的来源是初始化抽一次书**（提示词里还写着「原文能判才填」）⇒ 真账上**键根本不存在**
    //   ⇒ 那一格**永远是「未定」**。用户令「拿掉」。
    // ★为什么**不能**直接从 `PARAM_KEYS` 里删掉：那是**账本键表**（`setting-guard.test.js:93` 锁着
    //   "键表沿用（账本已有先例）"），删了会让旧账里可能存在的 `民生度` 变成"认不出的键"，
    //   被 `param-store.normalizeStore` 当垃圾**静默丢弃**（本仓最忌的"悄悄吃掉账上的键"）。
    //   ⇒ 分开：**键表不动**（旧账兼容）、**面板不画**（用户裁示）。
    assert.ok(PARAM_KEYS.includes('民生度'), '★账本键表**仍**认它（旧账兼容——不许顺手从 PARAM_KEYS 里删）');
    assert.ok(!PANEL_ENV_KEYS.includes('民生度'), '★但面板口径里没有它（`PANEL_ENV_KEYS` 才是"画什么"）');
    assert.deepEqual([...PANEL_ENV_KEYS], ['动乱度', '天时', '张力推手'], '面板上剩三格，顺序照旧');

    // 扫**参数面**：一个字节都不许再出现「民生」
    //   ★口径（第一版写错，自证抓红留档）：**不许扫"全部产物"**——`民生` 是普通汉语词，
    //     它会出现在**剧情内容**里（本夹具的里程碑标题「发兵催战、**民生**凋敝」就是模型写的正文，
    //     跟参数格毫无关系）⇒ 扫全产物是**结构性假红**。
    //     要判的是"**参数口径**里还有没有它"，所以只扫**吃参数的那四个面**。
    const w = world();
    const full = renderAll(w, { config: CONFIG, oldVolumes: VOLUMES });
    const surfaces = {
        参数页: renderParamsHtml(w, { config: CONFIG }),
        设定页: renderSettingHtml(w, { config: CONFIG }),
        信息带: renderInfoBandHtml(w, { config: CONFIG }),
        时局句: full.board.digest,
    };
    for (const [name, html] of Object.entries(surfaces)) {
        assert.ok(!html.includes('民生'), `★leg53：${name} 里不许再出现「民生」（参数口径只有三格）`);
    }
    // ★反向自证（三条，防这套锁退化成空绿）：
    assert.equal(w.context.setting.dynamic.env['民生度'], '艰难', '前置①：夹具账上真有民生度（否则上面扫的是空气）');
    assert.equal(PANEL_ENV_KEYS.length, 3, '前置②：面板口径确实只有三格');
    //   前置③：上面那四个面**本来就画参数**——拿一个"该出现的"词对照，证明扫描面不是空的
    for (const [name, html] of Object.entries(surfaces)) {
        assert.ok(html.includes('乱象') || html.includes('动乱度'), `前置③：${name} 确实画了参数（否则"没民生"毫无意义）`);
    }
    // ★**剧情里的「民生」不受影响**（这是有意的：那个词是模型的正文，不是我们的参数格）
    //   ★leg94 改判据：原来这条拿 `full.chronicle` 里那句里程碑标题（「发兵催战、民生凋敝」）当证据，
    //     而里程碑插行 leg94 已撤出编年页 ⇒ 那条断言**不是坏了、是所指没了**（结构性连带，非回归）。
    //     改判**账上那份**：`民生度` 照旧躺在参数面里（`PARAM_KEYS` + `setting.dynamic.env` 都认它），
    //     撤的只是"某一页不再画它"——**账与面分开**这条口径一个字不动。
    //     （"模型写的正文字里有「民生」"这件事的证据仍在：观棋页归档提示条那条判据印着「民生凋敝」。）
    assert.ok(PARAM_KEYS.includes('民生度') && w.context.setting.dynamic.env['民生度'] === '艰难',
        '★撤的只是"某一页不再画它"：账上那个键与它的值照旧在（账 ≠ 面）');
});

test('★★leg53·G：**乱象那一格的"依据"必须说实话**——它是引擎每轮算的，不是书里原话', () => {
    // 病（本棒取证）：那一格的「依据」原来写死 `书里原话`——而真账里那个 `动荡` 确实来自抽书，
    //   可**引擎从不算它** ⇒ 一句"书里原话"就把"这一格没有生产者"这件事盖住了（用户正是这么发现的）。
    // ⇒ leg53 之后：乱象有生产者了（`src/unrest.js`），那一格必须如实写「引擎每轮算的」。
    const w = world();                                   // 夹具 env 带 动乱度:'动荡' + 天时/张力推手
    const html = renderParamsHtml(w, { config: CONFIG });
    const atmo = html.slice(html.indexOf('sw2-atmo-card'), html.indexOf('data-action="param-undo"'));
    const depRow = paramRowSeg(atmo, '动乱度', { firstRowOnly: true });
    assert.ok(depRow.includes('引擎每轮算的'), '★乱象那一格必须写明"引擎每轮算的"（它现在真有生产者）');
    assert.ok(!depRow.includes('书里原话'), '★不许再糊成"书里原话"（那是治这条病的反面）');
    // 两个自变量仍是"你定的条件"这一支（口径不许被顺手改掉）
    for (const key of ['天时', '张力推手']) {
        const row = paramRowSeg(atmo, key, { withLabelRow: true });
        assert.ok(row.includes('引擎只照抄'), `★自变量「${key}」仍须标明"引擎只照抄"`);
    }
    // ★口径来源必须**一处**：那份"谁是谁算的"的名单住在生产者那边，渲染层只 import
    assert.deepEqual([...ENGINE_DERIVED_ENV], ['动乱度'],
        '★"引擎每轮算的"那份名单必须来自 `unrest.js`（面板不许自己另写一份名单）');
});

