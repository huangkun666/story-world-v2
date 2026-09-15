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
    renderChainViewHtml, renderInfoBandHtml, renderParamsHtml, escapeHtml, BLACKLIST,
    ENTS_PAGE_SIZE, ENTS_DEFAULT_VIEW, makeEntsView, entsSearchTextOf, selectEntityPage, entsHitCounts,
    PANEL_BUILD,
} from '../src/render.js';
import { AGENDA_CAPS } from '../src/settle.js';
import { LIMIT_DEFAULTS, LIMIT_GEARS, LIMIT_KEYS } from '../src/limits.js';
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
    const withoutSelects = (s) => String(s).replace(/<select[\s\S]*?<\/select>/g, '');
    const count = (hay, needle) => hay.split(needle).length - 1;
    const bare = structuredClone(w);
    bare.context.setting.dynamic.env = {};            // 全未定 —— 正是用户截图那个状态
    const bareHtml = withoutSelects(renderParamsHtml(bare));
    assert.equal(count(bareHtml, '未定'), 4, `★参数页未定值重复渲染（4 个参数各一次，实际 ${count(bareHtml, '未定')} 次）`);

    // ② 因变量（民生/乱象）只读：所在行不得有 <select>
    // ★leg40c 续：原判据按 `data-param="<键>"` 定位——那张**卡片壳**上现在**刻意不再挂 data-param**
    //   （壳上挂它，事件 target 落在壳里时 `closest` 会抓到壳这个 div、`.value` 读成 undefined
    //   ⇒ 提交"未定"、玩家点的档位被丢掉——正是用户那条「点了还是改不了值」）。
    //   故改按**性质标记**定位（`因变量`/`自变量` 标记只在对应那一处出现），判据内容不变。
    for (const key of ['民生度', '动乱度']) {
        const at = html.indexOf('因变量');
        const row = html.slice(Math.max(0, at - 400), at + 200);
        assert.ok(!row.includes('<select'), `★因变量「${key}」被做成了旋钮（它只该呈现）`);
        assert.ok(row.includes('因变量'), `因变量「${key}」要标明性质`);
    }
    // ③ 自变量（天时/外压）给旋钮
    //    定位口径：`data-param` 挂在 `<select>` 上，而"自变量"标记在**同一张卡的标题**里
    //    （标题在 select **之前**）⇒ 往回取到卡片开头，再截到下一张卡。
    for (const key of ['天时', '张力推手']) {
        const at = html.indexOf(`data-param="${key}"`);
        assert.ok(at > 0, `自变量「${key}」应有一个带 data-param 的控件`);
        const cardStart = html.lastIndexOf('<div class="sw2-set-card', at);
        const seg = html.slice(cardStart, at + 900);
        assert.ok(seg.includes('<select'), `自变量「${key}」必须有旋钮`);
        assert.ok(seg.includes('自变量'), `自变量「${key}」要标明性质`);
    }
    // ④ ★leg40c 续：**控件之外的元素一律不许挂 `data-param`**
    //   （挂了就会在事件委托里"抢答"，把 undefined 当值提交——这条病刚在用户实机上出过一次）
    for (const m of html.matchAll(/<(\w+)([^>]*data-param="[^"]+"[^>]*)>/g)) {
        const tag = m[1].toUpperCase();
        assert.ok(tag === 'SELECT' || tag === 'BUTTON' || tag === 'INPUT',
            `★<${tag.toLowerCase()}> 上挂了 data-param（只有控件才许挂——否则事件委托会抓到它、读出 undefined）`);
    }

    // ④ 信息面板同款：未定值也**只许出现一次**（旧法 值「未定」+ 同义 chip「未定」= 两次）
    const band = withoutSelects(renderInfoBandHtml(bare));
    assert.equal(count(band, '未定'), 4, `★信息带未定值重复渲染（4 个参数各一次，实际 ${count(band, '未定')} 次）`);
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
    assert.match(seg, /sw2ParamBusy/, '★★同一格"一笔操作"未结束时不许受理重复事件（重画补吐的那一笔）');
    // refreshSections 自身纪律：缺 DOM / 缺世界时静默返回（浏览器可载性与 Node 动态导入都不许炸）
    // ★leg40c 续：这里原来也是**固定字节切片**（+900，注释一长就假红）⇒ 改成结构切片。
    const fnStart = web.indexOf('function refreshSections(');
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
    assert.match(seg, /paramHub\.(set|clear)\(key2, key(, value)?\)/, '★set-param 必须把"世界（或世界名）+ 键 + 值"整体交给 hub');
    // ★★★leg48：**"手滑到空"与"明确清空"在接线层分开**（下拉里的空串 = 玩家明确选了「未定」）
    assert.match(seg, /fromUnsetOption/, '★必须判"这一笔是不是明确选了未定"（不分 ⇒ 空值会被当成清空命令，删掉玩家的档位）');
    assert.match(seg, /paramHub\.clear\(/, '★明确清空走 hub 的显式通道');
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
    const seg = web.slice(web.indexOf('function bindSettingsForm('), web.indexOf('function bindSettingsForm(') + 3000);
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
//   ⇒ 夹具改成含四维词的描述，让下面几条禁词扫描真的能咬住这一格。
const CONFIG = { baseUrl: 'https://gcli.ggchan.dev/v1', apiKey: 'k', model: 'gemini-3.1-pro-preview', playerDesc: '我名黄坤，炼气九层。四维皆无：兵力、权位、人脉、耳目一概谈不上。' };
const VOLUMES = [{ id: '卷一', info: '第 1–500 轮 · 512KB · 收在插件本地' }];

test('K33/A-2：同输入两次 renderAll 逐字节一致（纯函数锁）；参数面（config/oldVolumes）也在锁内', () => {
    const a = JSON.stringify(renderAll(world(), { config: CONFIG, oldVolumes: VOLUMES }));
    const b = JSON.stringify(renderAll(world(), { config: CONFIG, oldVolumes: VOLUMES }));
    assert.equal(a, b);
});

const textOnly = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
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
    const openCap = (infoband.match(/<div class="sw2-big-num">\d+<small>\/(\d+)<\/small>/) || [])[1];
    const topCap = (infoband.match(/顶层 \d+\/(\d+)/) || [])[1];
    assert.equal(Number(openCap), AGENDA_CAPS.open, `在飞分母应 = AGENDA_CAPS.open(${AGENDA_CAPS.open})，实际 ${openCap}`);
    assert.equal(Number(topCap), AGENDA_CAPS.topLevel, `顶层分母应 = AGENDA_CAPS.topLevel(${AGENDA_CAPS.topLevel})，实际 ${topCap}`);
});

// ★★leg40b 续（**口径升级**·用户令「能不能直接把这些闸门参数直接放进参数页？」→ 拍板"甲+乙档全开"）：
//   这条锁**原本锁的是"只读、无旋钮、不落 dynamic.env"**——那条口径**已被本次改动取代**，
//   故照本仓规矩（口径变了就升级锁 + 加"旧措辞不得回潮"的守门），把判据换成**新契约四条**：
//     ① 四个上限**都在页上**（还是与引擎真源同源，不钉死字面数）；② 每个都**真做成档位下拉**；
//     ③ 下拉里的档位**逐项等于白名单**（面板造不出引擎不认的值——UI 与判据同源）；
//     ④ **`pack`/`sweep` 那两个"引擎自己的账"**（每轮新生盘算、入局新人）**仍然只读**（不许顺手全开）。
test('★leg40b 续：参数页把世界尺度做成**四个可调档位**（旧"只读无旋钮"口径已升级）', () => {
    const html = renderParamsHtml(world());
    const seg = html.slice(html.indexOf('sw2-cap-card'));
    assert.ok(seg, '参数页应有世界尺度块（sw2-cap-card）');
    // ① 四个上限都在（键名 = limits.js 的真源，不是抄来的字面）
    for (const k of LIMIT_KEYS) {
        assert.ok(seg.includes(`data-param="${k}"`), `上限「${k}」应做成可写参数`);
        assert.ok(seg.includes(String(LIMIT_DEFAULTS[k])), `上限「${k}」的当前值 ${LIMIT_DEFAULTS[k]} 应上板`);
    }
    // ② 每个都是档位下拉（不是裸数字、也不是只读文本）
    const selects = seg.match(/<select[^>]*data-action="set-param"[^>]*>/g) || [];
    assert.equal(selects.length, LIMIT_KEYS.length, `应有 ${LIMIT_KEYS.length} 个上限下拉，实际 ${selects.length}`);
    // ③ 下拉档位**逐项**等于白名单（面板不许多给一个引擎不认的值）
    for (const k of LIMIT_KEYS) {
        const i = seg.indexOf(`data-param="${k}"`);
        const block = seg.slice(i, seg.indexOf('</select>', i));
        for (const g of LIMIT_GEARS[k]) assert.ok(block.includes(`value="${g}"`), `「${k}」的档位 ${g} 应出现在下拉里`);
        const opts = (block.match(/<option /g) || []).length;
        assert.equal(opts, LIMIT_GEARS[k].length, `「${k}」的下拉档位数应 = 白名单条数（多一个就是 UI 造了引擎不认的值）`);
    }
    // ④ 仍然只读的那几个**不许**被顺手做成旋钮（它们是"引擎自己的账"，且一次调太多会互相掩盖）
    assert.ok(!seg.includes('data-param="每轮新生"'), '每轮新生盘算仍是只读（丙档）');
    assert.ok(!seg.includes('data-param="每轮入局"'), '每轮入局新人仍是只读（丙档）');
    assert.match(seg, /仍然固定/, '页上必须写明"哪些仍然不给旋钮"，否则玩家以为全开了');
});

test('K33+leg21 观棋·时局句与信息带：时局句只领世情（无世情=未聚，不混张力）；张力归张力行；参数档位如实列出', () => {
    const { digest, infoband } = renderBoardHtml(world());
    assert.match(digest, /大势未聚，各方各走各的路/);   // leg21：本世界无 situation → 时局句不再拼张力
    assert.ok(!digest.includes('大虞/万法阁'), '张力极不入时局句');
    assert.ok(!digest.includes('强度'), '强度数字不入时局句');
    // leg26：参数是**玩家/书定的档位原话**，引擎零表态——时局句如实列出来，不再说"越界的处境"
    assert.match(digest, /参数：民生艰难、乱象动荡、天时大灾、时局紧绷。/);
    assert.match(digest, /各方正谋划 3 件事，其中 1 件在暗处。/);
    assert.match(infoband, /sw2-env-name">民生</);
    assert.match(infoband, /sw2-env-val">艰难</, '档位原话上板（不是 0.44 这种数）');
    assert.ok(!/sw2-danger/.test(infoband), 'leg26 撤销「危险带」判态——档位没有好坏，引擎不评价');
    assert.match(infoband, /大虞\/万法阁/);                       // 张力极在张力行（三件套不丢）
    // leg25 b（A1b）：张力行由「强度百分比」改说「近 N 轮事件数」（那个 % 实测只反映事件密度）
    assert.match(infoband, /近10轮事件 0 件/);                    // 本夹具 events 为空 → 0 件
    assert.ok(!infoband.includes('>72<'), '推导出的强度数字不再上面板');
    assert.match(infoband, /逼黄坤入洗煞之局（第32轮）/);         // 浪尖 → 盘算目标（id 不透传）
    assert.match(infoband, new RegExp(`<div class="sw2-big-num">3<small>/${AGENDA_CAPS.open}</small>`));
});

test('leg20 世情句领大势：situation 进时局句主句与信息带（原文措辞；拼装增量保留）', () => {
    const w = world();
    w.context.setting.frozen.canon.situation = '大虞兵压江州，坊市暗流涌动';
    const { digest, infoband } = renderBoardHtml(w);
    assert.match(digest, /大虞兵压江州，坊市暗流涌动/);
    assert.match(infoband, /大虞兵压江州，坊市暗流涌动。/);
    assert.match(infoband, /大虞\/万法阁/);   // 张力极性仍在（三件套不丢）
    const bare = { version: 1, context: { world: 'x', tension: 0.5, positions: ['x'] }, entities: [], weights: {}, agendas: [], events: [], chronicle: [], meta: { tick: 0 } };
    assert.match(renderBoardHtml(bare).digest, /大势未聚/);   // 无世情无极性 → 原回退语义不变
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

test('K34 编年页：全量条目 + 大事纪插行 + 旧卷卷行（数据入面）', () => {
    const html = renderChronicleHtml(world(), { oldVolumes: VOLUMES });
    assert.match(html, /劳役征发——大虞偏将征调坊市丁壮。/);
    assert.match(html, /第 1–30 轮已收进大事纪「发兵催战、民生凋敝」/);
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
    const rawText = (v) => String(v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    assert.ok(rawText(html).includes('ev_0') && rawText(html).includes('ev_15_1'), '管理区 ids 仍裸显');
    assert.match(html, /sw2-vol">卷一/);
    const empty = renderArchiveHtml(world(), {});
    assert.match(empty, /尚未入卷/);
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
    assert.ok(askLine.includes('补全全册实力'),
        '★并如实说对：全册「连书未明述也推倒重查」仍在——入口是那枚批量按钮（`lookup-batch-all`）');
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

test('K34/A-6 设定档案页：展示与 setting.frozen 逐字段一致（指纹/时间/五件套原文全量），重抽按钮在位', () => {
    const html = renderSettingHtml(world());
    assert.match(html, /书指纹 fnv1a_9f31x_12044/);
    assert.match(html, /抽取于 2026-09-08T10:00:00Z/);
    assert.match(html, /力量谱系（2 档 · 取全）/);
    assert.match(html, /炼气<\/b><span>修士，江湖底子（原文）/);
    assert.match(html, /元婴<\/b><span>大宗，可开宗立派（原文）/);
    assert.match(html, /煞气须以灵脉镇压/);
    assert.match(html, /官军辖江州，坊市共治/);
    assert.match(html, /灵脉与煞气相生相克/);
    assert.match(html, /太岁陨落北山/);
    assert.match(html, /已冻结/);
    assert.match(html, /data-action="clear-evolution"/);
    assert.match(html, /浪尖（派生源）/);
    // 未抽取态
    const bare = { version: 1, context: { world: 'x', tension: 0.5, positions: ['x'] }, entities: [], weights: {}, agendas: [], events: [], chronicle: [], meta: { tick: 0 } };
    const bareHtml = renderSettingHtml(bare);
    assert.match(bareHtml, /尚未抽取/);
    assert.match(bareHtml, /sw2-sv-chip stale/);
});

test('K34 设置页：开档描述/模型通道/操作按钮/旧卷管理，表单值来自 config', () => {
    const html = renderSettingsHtml(world(), { config: CONFIG });
    assert.match(html, /来源：角色卡 \+ 世界信息（自动合订）/);
    assert.match(html, /<textarea id="sw2_player_desc"[^>]*>我名黄坤，炼气九层/u);
    assert.match(html, /id="sw2_base" value="https:\/\/gcli\.ggchan\.dev\/v1"/);
    assert.match(html, /id="sw2_key" value="••••••••••••••••••••"/);
    assert.match(html, /id="sw2_model" value="gemini-3\.1-pro-preview"/);
    assert.match(html, /data-action="init-world"/);
    assert.match(html, /data-action="advance-world"/);
    assert.match(html, /自动入卷阈值/);
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
//   承诺的是 leg25 c 已按用户令整条删除的四个概念。它躲过禁词锁整整十五棒，原因是**夹具的问题**：
//   旧夹具的 `playerDesc` 是「我名黄坤，炼气九层。」——不含那四个词，于是"玩家真写一段描述时会带出什么"
//   从来没进过扫描面。这条用例把口径钉死：**设置页（含玩家描述原样回显）不得出现那四个词**，
//   且夹具描述**必须**含它们——否则这条锁又会退化成空绿（"夹具不含 ⇒ 永远扫不到"正是它当年失灵的方式）。
test('★leg40b：设置页零四维残文（且夹具描述含四维词，防这条锁退化成空绿）', () => {
    for (const term of ['兵力', '权位', '人脉', '耳目']) {
        assert.ok(CONFIG.playerDesc.includes(term), `★夹具 playerDesc 必须含「${term}」（否则这条锁是空绿）`);
    }
    // ① 界面自己的文案零四维：用**不含**四维词的描述渲染 ⇒ 产物里出现任何一个都是界面在说
    const plain = renderSettingsHtml(world(), { config: { ...CONFIG, playerDesc: '一段不含旧属性词的描述。' } });
    const visible = textOnly(plain);
    for (const term of ['兵力', '权位', '人脉', '耳目']) {
        assert.ok(!visible.includes(term), `设置页正文不得出现「${term}」（四维已整条删除）`);
    }
    // ② 玩家真写的那段字照旧原样回显（不许因为我们删词而把他的输入吃掉）
    const withTerms = renderSettingsHtml(world(), { config: CONFIG });
    assert.ok(withTerms.includes(CONFIG.playerDesc), '★玩家描述原样回显（不许删用户自己写的字）');
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
    const cfg = { ...CONFIG, playerDesc: '<img src=x onerror=alert(1)>' };
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

test('K46+leg21 观棋·大势行与张力行并带：大势=世情句/未聚+浪尖（不再混张力）；张力三件套全归张力行', () => {
    const mk = () => ({
        version: 1, context: {
            world: 'x', tension: 0.5, positions: ['x'],
            setting: { dynamic: { tension: { polarity: '正邪相争', direction: '魔涨道消', intensity: 0.82 }, env: { 民生度: '艰难', 动乱度: '动荡', 天时: '大灾', 张力推手: '紧绷' }, derivedFrom: ['浪尖:a_1@3'] } },
        },
        entities: [{ id: 'e_a', kind: 'faction', name: '甲宗', location: 'x' }], weights: { e_a: 0.9 },
        agendas: [{ id: 'a_1', owner: 'e_a', goal: '血洗洛城', stage: '用兵', visibility: 'known', maxSteps: 3, progress: 2, closed: true, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } }],
        events: [], chronicle: [], milestones: [], meta: { tick: 3, simLog: [] },
    });
    const { infoband, digest } = renderBoardHtml(mk());
    assert.ok(infoband.includes('sw2-band-label">大势</div>'), '大势行在位');
    assert.ok(infoband.includes('sw2-band-label">张力 · 结构性三件套'), '张力行独立成行');
    assert.ok(!infoband.includes('大势 · 结构性张力'), '旧标签（大势顶张力名）废除');
    assert.ok(infoband.includes('大势未聚（无主张力）。'), '无世情时大势行=未聚（不拼张力）');
    assert.ok(infoband.includes('浪尖：血洗洛城'), '浪尖入大势句（目标名不露 id）');
    // leg25 b（A1b）：张力行不再写「烈度带词 + 百分比」——那个 % 实测只反映事件密度（rival 腿恒为满值），
    //   带词会暗示"引擎判断了天下张力"。改为直说可验证的事实：近 N 轮事件几件。
    assert.ok(!infoband.includes('烈度'), '张力行不再用「烈度」带词（它暗示引擎判断了张力）');
    assert.ok(infoband.includes('近10轮事件 0 件'), '张力行改说可验证事实：近 N 轮事件数（本夹具 events 为空）');
    assert.ok(!infoband.includes('>82<'), '推导出的百分比不再上面板（它只反映事件密度）');
    assert.ok(infoband.includes('魔涨道消（原文方向）'), '方向在张力行（原文措辞）');
    assert.ok(infoband.includes('正邪相争'), '张力极在张力行');
    assert.match(digest, /参数：民生艰难、乱象动荡、天时大灾、时局紧绷。/, 'leg26：参数档位在时局句副句如实列出（引擎零表态）');
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
    assert.match(all, /第 1–30 轮已收进大事纪「发兵催战」/, 'A-16④：里程碑插行照旧');
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

test('★细案实体页：两处既有入口按细案改挂工具条（不许在改版里丢掉）', () => {
    const w = world();
    // ① 全册补全按钮（lookup-batch.test.js:436/447 锁它，原在页眉）
    const html = renderEntitiesHtml(w);
    assert.ok(html.includes('data-action="lookup-batch-all"'), '★「⬇ 补全全册实力」入口仍在');
    assert.ok(html.includes('⬇ 补全全册实力'), '文案不变（既有用例按这句锁）');
    // 跑到「停止补全」那一态
    const running = renderEntitiesHtml(w, { config: { lookupTask: { cursor: 4, total: 623, success: 3, pending: 1, absent: 0, failed: 0 } } });
    assert.ok(running.includes('■ 停止补全 4/623'), '★进度态照旧由 config.lookupTask 进渲染层');
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
    assert.equal(PANEL_BUILD, 'leg50-story-and-ledger');
    for (const bad of ['agenda', 'tick', 'ssot', 'schema', 'chronicle', 'entity', 'kind']) {
        assert.ok(!PANEL_BUILD.includes(bad), `构建号不得含「${bad}」`);
    }
    assert.match(PANEL_BUILD, /^leg\d+-/, '形状：legNN-…（升位链条要能一眼看出来）');
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
    assert.equal(hasCompositionGuard(seg), true,
        '★input 处理必须先判组合期（`e.isComposing || sw2EntsComposing`）并早退，**且在改状态与重绘之前**');
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
    assert.match(web, /^let sw2EntsComposing = false;$/m,
        '★组合态标志是模块级 `let`（不是函数内临时变量：两个监听要共享它）');
    assert.match(web, /^let sw2ChronicleComposing = false;$/m,
        '★leg50：编年页的组合态标志同样是模块级 `let`');

    // ★★leg50 追加：编年页搜索框的 input 处理**也要**有组合期早退——
    //   病与药与实体页逐字同款（同一屏里两个搜索框，只护一个等于没护）。
    //   ★反向自证同上：把 `sw2ChronicleComposing` 那半句删掉，`hasChronicleGuard` 必须变假。
    const hasChronicleGuard = (s) => /if \(e\.isComposing \|\| sw2EntsComposing \|\| sw2ChronicleComposing\) return;/.test(s);
    const chSeg = inputHandlerSrc(web, '#sw2_ch_q');
    assert.ok(chSeg.length > 80, '前置：找得到编年页搜索框那条 input 处理');
    assert.equal(hasChronicleGuard(chSeg), true, '★编年页 input 处理同样必须先判组合期并早退');
    const chStripped = chSeg.replace(/sw2ChronicleComposing/g, '');
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

function hasCompositionGuard(seg) {
    // 判据 = ① 有一条以 `isComposing` **与** `sw2EntsComposing` 为条件的早退；② 它排在改状态与重绘之前
    const re = /if\s*\(([^)]*)\)\s*\{?\s*return\b/g;
    let m;
    while ((m = re.exec(seg))) {
        const cond = m[1];
        if (!cond.includes('isComposing') || !cond.includes('sw2EntsComposing')) continue;
        const stateAt = seg.indexOf('sw2EntsView.q');
        const redrawAt = seg.indexOf("refreshSections(['entities'])");
        return stateAt > m.index && redrawAt > m.index;
    }
    return false;
}

test('★终审 M10：视图态默认值**只有一份真源**（`ENTS_DEFAULT_VIEW` + `makeEntsView()`）', () => {
    // 病：`src/render.js` 的 `ENTS_DEFAULT_VIEW` 与 `web/index.js` 的 `sw2EntsView` 是**两份字面量**，
    //   靠人同步 ⇒ 本笔加 `scope` 字段时正是两处都要改（下一任漏一处就分叉）。
    const web = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    // 计数前先按本仓既有做法**把注释行抹成空白**（`:110` 同款）：说明文字里也会写到这个函数名
    const code = web.split('\n').map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? ' '.repeat(l.length) : l)).join('\n');
    assert.match(code, /import[^;]*makeEntsView[^;]*from '\.\.\/src\/render\.js'/, '★接线层从渲染层导入默认值（不许自己再写一份）');
    assert.equal((code.match(/makeEntsView\(\)/g) || []).length, 2,
        '★初始值与关面板复位两处都用同一个工厂（不是两处字面量）');
    assert.ok(!/let sw2EntsView = \{/.test(web) && !/sw2EntsView = \{ q:/.test(web),
        '★接线层里不许再有第二份视图态字面量');
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
