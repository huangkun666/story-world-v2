// story-world-v2/test/abstract-selection.test.js
// 自选抽象条目：纯选择模块（src/abstract-selection.js）＋ 来源页面控制器（web/abstract-selection.js）。
//
// 本文件咬的是**老契约**（这些一条都不许退化）：
//   ① 稳定来源 ID：来源名 + uid/id；缺 uid/id 用「标题 + 键」摘要（**不用数组下标**）；
//      同名不同来源必须是两个 ID；跨来源同 uid 不许撞。
//   ② 选择不变性：default 保留**原始条目对象**（逐字节零改动）；custom 只留选中项；都不改原件。
//   ③ default 与 custom 空选择**必须分形**（前者全留 / 后者全空）。
//   ④ HTML 全转义（题名/正文/来源名里塞标签都不许变成真 DOM）。
//   ⑤ 控制器：一次委托、懒加载去重 + 世代防护、搜索只隐藏不重建输入、批量只作用于可见结果、
//      "已不在书里"的存档 ID 每次都原样带过去、两个窗口各看各的书。
//
// ★★Task 2 口径变更（有据）：批准设计 §4.1/§4.2/§4.3 把来源页从"一个 `<details>` 列表"
//   改成**完整来源清单 + 右侧原文/选段工作区 + 页底实际读取预览**。因此：
//     · 渲染入参由裸条目 `entries` 改成 Task 1 的完整来源 `sources`（`collectAbstractSources`）
//       与生效项 `sourceItems`（`composeInitSource`）——页面**不许**再自己清理/取料（那就是第二把尺子）；
//     · 行上只剩"勾选 + 题名 + 状态 + 读法 + 查看正文"（"每行仅显示必要信息"，长文进右栏，页面更短）；
//     · 控制器的依赖由 `getEntries/getSelection` 换成 `getSnapshot`（来源 + 统一合订 + 迁移元数据）。
//   新行为的实际操作回归在 `test/abstract-source-page.test.js` 与 `abstract-source-ui-wiring.test.js`
//   （红→绿证据见 task-2 报告）；本文件继续守上面那五条老契约。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { entrySelectionId, selectAbstractEntries, normalizeAbstractSelection } from '../src/abstract-selection.js';
import { collectAbstractSources } from '../src/abstract-input.js';
import { composeInitSource } from '../src/init-source.js';
import { renderAbstractSelection, bindAbstractSelection } from '../web/abstract-selection.js';
import { checkboxValues, checkedValues, clickAction, fire, makeDom, typeSearch, visibleItems } from './fixture-picker-dom.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ═══════════════════════════ 夹具：条目 ═══════════════════════════

const ENTRY_A = { uid: 1, comment: '昆仑道宫', key: ['昆仑道宫'], content: '昆仑道宫立于西荒，掌教清玄真人。' };
const ENTRY_B = { uid: 2, comment: '万法阁', key: ['万法阁'], content: '万法阁藏器三千，阁主公输巧。' };
const ENTRY_C = { uid: 3, comment: '清玄真人', key: ['清玄真人'], content: '清玄真人坐镇玉虚秘境。' };
const ENTRIES = [ENTRY_A, ENTRY_B, ENTRY_C];

const idOf = (e) => entrySelectionId(e);
/** ID 里的来源名（`来源:号` / `来源:题名#摘要`）——渲染顺序 = 来源分组序。 */
const sourceInId = (id) => String(id).slice(0, String(id).indexOf(':'));
/** 与渲染侧**同一把尺**的比较器：缺省来源（world-info）排在最前，其余按中文排。 */
const byId = (a, b) => {
    const sa = sourceInId(a);
    const sb = sourceInId(b);
    if (sa === sb) return 0;
    if (sa === 'world-info') return -1;
    if (sb === 'world-info') return 1;
    return sa.localeCompare(sb, 'zh-Hans-CN');
};

/** 带来源名的条目副本（_sw2Source 由接线层在取书时写上；本模块只读）。 */
const withSource = (entry, source) => ({ ...entry, _sw2Source: source });

/** 一份**生产**快照（页面拿到的形状；`compose` 就是 `composeInitSource`）。 */
function snapshotFor(entries, selection = { mode: 'default' }, character = null) {
    const sources = collectAbstractSources({ worldInfoEntries: entries, character });
    return {
        sources,
        selection,
        compose: (sel) => composeInitSource({ character, worldInfoEntries: entries, selection: sel }),
    };
}

// ═══════════════════════════ ① 稳定来源 ID ═══════════════════════════

test('entrySelectionId①：同一条目算两次必须一模一样，且 ID 里带得出来源名与 uid', () => {
    const a = entrySelectionId(ENTRY_A);
    assert.equal(entrySelectionId(ENTRY_A), a, '★同一条目算两次必须逐字节相同（每次渲染都要能对上选中的那一条，抖一次就等于没记住）');
    assert.equal(a, entrySelectionId({ ...ENTRY_A }), '★同一份内容换一个对象壳也必须算出同一个 ID');
    assert.equal(a, 'world-info:1', '★有号条目的 ID = `来源:号`（缺省来源就是 world-info）');
    assert.equal(entrySelectionId(withSource(ENTRY_A, '大荒')), '大荒:1', '★来源名写在 ID 最前面（跨书同 uid 才分得开）');
    assert.notEqual(entrySelectionId(ENTRY_B), a, '两条不同条目不许算出同一个 ID');
});

test('entrySelectionId②：来源名从 _sw2Source 来，缺省是 world-info；同名条目分属两本书必须是两个 ID', () => {
    const card = entrySelectionId(withSource(ENTRY_A, 'character-book'));
    const world = entrySelectionId(withSource(ENTRY_A, 'world-info'));
    assert.equal(card === world, false, '★同一份条目挂在"卡内置书"与"世界信息"两条来源上，必须是两个 ID（否则勾了一条会连坐另一条）');
    assert.notEqual(entrySelectionId({ ...ENTRY_A, _sw2Source: '大荒' }), entrySelectionId({ ...ENTRY_A, _sw2Source: '三国' }),
        '★两本不同的书各有一条同名条目 ⇒ 两个 ID');
    assert.equal(entrySelectionId(ENTRY_A), entrySelectionId({ ...ENTRY_A, _sw2Source: '   ' }),
        '★空白来源名按缺省 world-info 算（不许因为多了个空格就变成另一条）');
    assert.equal(entrySelectionId(withSource(ENTRY_A, '大荒')), entrySelectionId(withSource(ENTRY_A, '大荒')),
        '★同一来源同一 uid：稳定');
});

test('entrySelectionId③：跨来源同 uid ⇒ 两个 ID（uid 只在来源内唯一）', () => {
    const inCard = withSource({ uid: 7, comment: '甲' }, 'character-book');
    const inWorld = withSource({ uid: 7, comment: '甲' }, 'world-info');
    assert.notEqual(entrySelectionId(inCard), entrySelectionId(inWorld), '★uid 是书内的号，跨书会重用 ⇒ 来源名必须参与');
});

test('entrySelectionId④：缺 uid/id 时用标题与 key 的稳定摘要，**不许**用数组下标', () => {
    // 两本来源不同的书里各有一条没有 uid 的同名条目
    const noUidCard = { comment: '无号条目', key: ['无号条目'], content: '甲' };
    const noUidWorld = { comment: '无号条目', key: ['无号条目'], content: '乙' };
    const idCard = entrySelectionId(withSource(noUidCard, 'character-book'));
    const idWorld = entrySelectionId(withSource(noUidWorld, 'world-info'));
    assert.notEqual(idCard, idWorld, '★缺 uid 的两条同名条目，来源不同 ⇒ 两个 ID');

    // ★核心判据：把条目放到数组的**另一个位置**，ID 必须不变（用了下标就会变 ⇒ 勾选会串到别人身上）
    const a1 = entrySelectionId(withSource(noUidCard, 'character-book'));
    const a2 = entrySelectionId(withSource(noUidCard, 'character-book'));
    assert.equal(a1, a2, '★同一条目：ID 与它在数组里的位置无关（用下标就当场翻车）');
    const reordered = [noUidWorld, noUidCard].map((e, i) => withSource(e, i === 0 ? 'world-info' : 'character-book'));
    assert.equal(entrySelectionId(reordered[1]), idCard, '★把数组顺序倒过来，同一条目的 ID 一个字都不许变');

    // 选中的那一条的 ID 只由来源与题名/键决定（数组下标不参与）
    assert.match(idCard, /^character-book:无号条目#/, '★无号条目的 ID 形状 = `来源:题名#摘要`（题名看得见、摘要把同名的分开）');
    assert.equal(entrySelectionId(withSource({ ...noUidCard, content: '改写过的正文' }, 'character-book')), idCard,
        '★正文被作者改写不改变条目的身份（否则玩家上次的勾选全失效）');
    // 题名不同 ⇒ ID 必须不同（否则两条无号条目会撞成一个）
    assert.notEqual(entrySelectionId(withSource({ comment: '另一条', key: ['另一条'] }, 'character-book')), idCard,
        '★题名/键不同 ⇒ 两条不同条目必须是两个 ID');
    // 键**换一个排列**也算同一条（摘要前先排序去重）
    assert.equal(entrySelectionId(withSource({ comment: '无号条目', key: ['b', 'a', 'b', 'a'] }, 'character-book')),
        entrySelectionId(withSource({ comment: '无号条目', key: ['a', 'b'] }, 'character-book')),
        '★键的排列与重复不影响身份（作者调一下顺序就把玩家的勾选洗掉，是荒唐的）');
    // id 字段也算号（ST 卡内置书条目常用 id）
    assert.equal(entrySelectionId(withSource({ id: 5, comment: '有号' }, 'character-book')),
        entrySelectionId(withSource({ uid: 5, comment: '有号' }, 'character-book')),
        '★`id` 与 `uid` 同一件事（ST 两种形状都要认）');
    assert.match(entrySelectionId(null), /^world-info:#/, '★喂 null 不许抛（调用方会拿空条目来问），且照旧给出一个稳定来源的 ID');
});

// ═══════════════════════════ ②③ 选择语义与不变性 ═══════════════════════════

test('selectAbstractEntries①：default **保留所有原始条目**，且原件逐字节零改动、数组是新的一份', () => {
    const before = JSON.stringify(ENTRIES);
    const kept = selectAbstractEntries(ENTRIES, { mode: 'default', selectedIds: [] });
    assert.equal(kept.length, 3, '★default 保留所有原始条目（存量世界照旧，行为与选择功能上线前逐字相同）');
    for (let i = 0; i < ENTRIES.length; i += 1) {
        assert.equal(kept[i], ENTRIES[i], '★必须交出**同一份**条目对象（下游读到的还是那本书，不许半路换壳）');
    }
    assert.notEqual(kept, ENTRIES, '★交出来的是新数组（调用方排序/过滤不许动到原件）');
    assert.equal(JSON.stringify(ENTRIES), before, '★原件逐字节零改动');
});

test('selectAbstractEntries②：custom **只留 selectedIds**；default 与 custom-空 必须分形', () => {
    const picked = selectAbstractEntries(ENTRIES, { mode: 'custom', selectedIds: [idOf(ENTRY_B)] });
    assert.equal(picked.length, 1, '★custom 只留选中的那条');
    assert.equal(picked[0], ENTRY_B, '★交出来的仍是原件本身（正文一个字不改）');
    // ★本仓最贵的那类病：把"玩家一条都没选"当成"照旧全用"
    assert.deepEqual(selectAbstractEntries(ENTRIES, { mode: 'custom', selectedIds: [] }), [],
        '★★custom 空选择 ⇒ **一条都不留**（与 default "全留"必须分形；混同它就是把用户的排除动作静悄悄取消掉）');
    assert.equal(selectAbstractEntries(ENTRIES, { mode: 'default', selectedIds: [] }).length, 3,
        '★default 空选择 ⇒ 全留（两种"空"是两件事）');
    assert.equal(selectAbstractEntries(ENTRIES, { mode: 'custom', selectedIds: [idOf(ENTRY_A), idOf(ENTRY_C)] }).length, 2);
    assert.deepEqual(selectAbstractEntries(ENTRIES, { mode: 'custom', selectedIds: ['查无此条'] }), [],
        '★选中记录里已经消失的 ID ⇒ 什么都不留（**绝不**回退成全用）');
    assert.deepEqual(selectAbstractEntries(undefined, { mode: 'custom', selectedIds: [] }), [], '★空条目表不抛');
});

test('selectAbstractEntries③：按来源隔离——勾了世界书那一条，卡内置书那条同 uid 的不受牵连', () => {
    const list = [withSource(ENTRY_A, 'world-info'), withSource(ENTRY_A, 'character-book')];
    const onlyCard = selectAbstractEntries(list, { mode: 'custom', selectedIds: [entrySelectionId(list[1])] });
    assert.equal(onlyCard.length, 1, '★只留被勾的那一条');
    assert.equal(onlyCard[0]._sw2Source, 'character-book', '★被勾的正是卡内置书那一条（跨来源同 uid 不许连坐）');
});

test('normalizeAbstractSelection：只认 default/custom 两档，selectedIds 去重成字符串数组', () => {
    assert.deepEqual(normalizeAbstractSelection(undefined), { mode: 'default', selectedIds: [] }, '★缺省 = default（存量世界的旧配置行为不变）');
    assert.deepEqual(normalizeAbstractSelection(null), { mode: 'default', selectedIds: [] }, '★null 不许抛');
    assert.deepEqual(normalizeAbstractSelection({ mode: 'custom', selectedIds: ['b', 'a', 'b'] }),
        { mode: 'custom', selectedIds: ['b', 'a'] }, '★去重且保持原顺序（勾选顺序就是用户看到的顺序）');
    assert.deepEqual(normalizeAbstractSelection({ mode: '乱写', selectedIds: ['a'] }),
        { mode: 'default', selectedIds: [] }, '★非法模式一律退回 default，别猜用户想要什么');
    assert.deepEqual(normalizeAbstractSelection({ mode: 'custom', selectedIds: 'a' }),
        { mode: 'custom', selectedIds: [] }, '★selectedIds 不是数组 ⇒ 空（绝不把字符串拆成字符）');
    assert.deepEqual(normalizeAbstractSelection({ mode: 'custom', selectedIds: [1, '  2  ', 1, '', null, undefined, '  '] }),
        { mode: 'custom', selectedIds: ['1', '2'] }, '★数字与空白都要归一（前后空格会让"同一条"变成两条）');
    // ★不可变：不许改调用方交进来的那份设置
    const input = { mode: 'custom', selectedIds: ['a'] };
    const frozen = Object.freeze({ ...input, selectedIds: Object.freeze(['a']) });
    assert.doesNotThrow(() => normalizeAbstractSelection(frozen), '★只读入参（设置对象可能是冻结的）');
    normalizeAbstractSelection(input);
    assert.deepEqual(input, { mode: 'custom', selectedIds: ['a'] }, '★绝不改调用方那份设置');
});

// ═══════════════════════════ ④ 渲染：分组 / 转义 / 计数 ═══════════════════════════

test('renderAbstractSelection①：按 _sw2Source 分组，控件齐备且在 [data-source-picker] 容器里', () => {
    const list = [withSource(ENTRY_A, '大荒'), withSource(ENTRY_B, 'character-book'), withSource(ENTRY_C, '大荒')];
    const sources = collectAbstractSources({ worldInfoEntries: list });
    const html = renderAbstractSelection({
        sources,
        selection: { version: 2, mode: 'custom', selectedIds: [entrySelectionId(list[2])], reads: {} },
    });
    assert.match(html, /data-source-picker/, '★整个选择器住在 [data-source-picker] 容器里（接线层按它填容器）');
    for (const hook of ['data-source-search', 'data-source-mode', 'data-source-filter', 'data-source-action="all"',
        'data-source-action="none"', 'data-source-action="invert"', 'data-source-action="reload"',
        'data-source-action="exclude-disabled"', 'data-source-action="exclude-technical"', 'data-source-action="exclude-empty"']) {
        assert.ok(html.includes(hook), `★控件必须在位：${hook}`);
    }
    assert.match(html, /<option value="default"[^>]*>/, '★模式选择必须有 default 一档');
    assert.match(html, /<option value="custom"[^>]*>/, '★模式选择必须有 custom 一档');
    assert.match(html, /<option value="custom"[^>]*selected/, '★当前档位如实回显（交进来的就是 custom）');
    // 分组：两个来源两块
    const groups = [...html.matchAll(/data-source-group="([^"]*)"/g)].map((m) => m[1]);
    assert.equal(groups.length, 2, `★按来源分组（两本书两块）；实际 ${JSON.stringify(groups)}`);
    assert.ok(groups.includes('大荒') && groups.includes('character-book'), '★块上写着来源名，玩家分得清哪条来自哪本书');
    // 复选框 value = 条目 ID
    const values = checkboxValues(html);
    assert.equal(values.length, 3, '★每条一个复选框');
    assert.deepEqual(values, sources.map((s) => s.id).slice().sort(byId),
        '★复选框 value 就是条目 ID（与选择模块同一把尺）');
    // 选中态：custom 下只有勾了的那条是 checked
    assert.deepEqual(checkedValues(html), [entrySelectionId(list[2])], '★custom 下只有选中的那条是勾上的');
});

test('renderAbstractSelection②：列表**只放必要信息**（长文进右栏，绝不常驻长页），右栏只为"正在看的那条"出材料', () => {
    const sources = collectAbstractSources({ worldInfoEntries: ENTRIES });
    const html = renderAbstractSelection({ sources, selection: { mode: 'default' } });
    assert.equal((html.match(/data-source-item/g) || []).length, 3, '★三条各一行');
    for (const source of sources) {
        assert.ok(html.includes(source.rawText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')),
            '★原文只以**搜索属性**的形式随行（按内容搜得到）');
    }
    assert.equal(html.includes('<pre data-source-preview>'), false, '★没有"正在看的那条"时不许画正文预览（长文不在列表里）');
    assert.match(html, /data-source-pane-empty/, '★右栏空态要有一句话告诉玩家怎么用');
    // 指定 focusedId ⇒ 右栏出只读原文 + 读法 + 选段工具
    const focused = renderAbstractSelection({ sources, selection: { mode: 'default' }, focusedId: sources[1].id });
    assert.match(focused, /data-source-original/, '★右栏要有只读原文（划选材料）');
    assert.match(focused, /data-source-read="auto"/, '★三条读法：自动清理');
    assert.match(focused, /data-source-read="full"/, '★原文全文');
    assert.match(focused, /data-source-read="segments"/, '★原文选段');
    assert.match(focused, /data-source-action="add-segment"/, '★把选中文字加为选段');
    assert.match(focused, /data-source-action="use-full"/, '★恢复全文');
    assert.ok(focused.includes(ENTRIES[1].content), '★右栏里的原文逐字在位（用户划的就是它）');
    assert.match(focused, /readonly/, '★原文只读（它是编辑材料，不是可写回的正文）');
});

test('renderAbstractSelection③：技术清理与排除依据**在展开区里**说得清；生效预览用生产计算结果', () => {
    const dirty = withSource({
        uid: 41, comment: '设定附件', key: ['设定附件'],
        content: '<script>alert(1)</script>正文一段。\n<% 这段不进抽象 %>还有一段。',
    }, 'character-book');
    const sources = collectAbstractSources({ worldInfoEntries: [dirty] });
    const composed = composeInitSource({ worldInfoEntries: [dirty], selection: { mode: 'default' } });
    const html = renderAbstractSelection({
        sources, sourceItems: composed.sourceItems, selection: { mode: 'default' }, preview: composed,
    });
    assert.ok(html.includes('正文一段。'), '★清理之后的正文必须在（预览的就是它）');
    assert.equal(composed.text.includes('alert(1)'), false, '★生产口径：技术区块不进实际读取文本');
    assert.equal(composed.text.includes('这段不进抽象'), false, '★EJS 原文同理不进');
    assert.ok(html.includes(composed.text), '★★最终预览那一格就是生产 composeInitSource 的 text（页面不另算一份）');
    assert.match(html, /已清理/, '★清理记录要如实列出（玩家得知道这条被剪过什么）');
    assert.match(html, /EJS 技术区块/, '★EJS 那条记录也要在');
    assert.match(html, /character-book/, '★来源名要露出来（分组标题里）');
    assert.match(html, /data-source-effective-text/, '★页底要有"实际读取内容"那一格（展开区）');
});

test('renderAbstractSelection④：HTML 全部转义——条目名/正文/来源名里塞标签都不许变成真 DOM', () => {
    const evil = [
        withSource({ uid: 900, comment: '<img src=x onerror=alert(1)>', key: ['k'], content: '正文 <b>不该是粗体</b> 与 < 号。' }, '<svg onload=alert(2)>'),
        withSource({ uid: 901, comment: '正常条目', key: ['k2'], content: '安全' }, '大荒'),
    ];
    const sources = collectAbstractSources({ worldInfoEntries: evil });
    const html = renderAbstractSelection({ sources, selection: { mode: 'default' }, focusedId: sources[0].id });
    assert.ok(!html.includes('<img src=x'), '★条目名里的标签必须被转义成文本');
    assert.ok(!html.includes('<svg onload'), '★来源名里的标签必须被转义');
    assert.ok(!html.includes('<b>不该是粗体</b>'), '★正文里的标签必须被转义');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), '★转义之后照样看得见（是文本，不是被吞掉）');
    assert.ok(html.includes('&lt;svg onload=alert(2)&gt;'), '★来源名同理：看得见、不是标签');
    // 属性面：ID 塞进去必须落在引号里且不越界
    const quote = withSource({ uid: 'a"b<c>', comment: '带引号的号' }, 'x"y');
    const h2 = renderAbstractSelection({ sources: collectAbstractSources({ worldInfoEntries: [quote] }), selection: { mode: 'default' } });
    assert.ok(!/data-source-entry="[^"]*"[^>]*onerror/.test(h2), '★value 属性里的引号不许把属性切断（切断就是注入口）');
    assert.ok(h2.includes('&quot;'), '★双引号在属性里必须转义');
});

test('renderAbstractSelection⑤：默认/自选两档如实回显；**已消失**的存档 ID 有数量提示；新条目默认不勾', () => {
    const list = [withSource(ENTRY_A, '大荒'), withSource(ENTRY_B, '大荒'), withSource(ENTRY_C, '三国')];
    const sources = collectAbstractSources({ worldInfoEntries: list });
    const a = sources.find((s) => s.id === idOf(withSource(ENTRY_A, '大荒'))).id;
    const c = sources.find((s) => s.id === idOf(withSource(ENTRY_C, '三国'))).id;
    const goneId = '大荒:查无此条';
    const html = renderAbstractSelection({
        sources, selection: { version: 2, mode: 'custom', selectedIds: [a, goneId], reads: {} },
    });
    assert.match(html, /3 条来源/, '★要显示来源条数');
    assert.match(html, /自选 2 条/, '★自选档要报"记录里有几条"');
    assert.match(html, /1 条已不在书中/, '★识别保存的选中里有 1 条已经不在了，并把数量说出来');
    assert.deepEqual(checkedValues(html), [a], '★只勾选择记录里那一条；新条目（三国那条）默认不勾');
    // 默认档：勾选态由 `defaultSelectedIds` 说了算（它是 compose 的读数，页面不许自己猜）
    const plain = renderAbstractSelection({ sources, selection: { mode: 'default' }, defaultSelectedIds: [c] });
    assert.deepEqual(checkedValues(plain), [c], '★默认档勾的就是本次默认真正会读的那些（由 defaultSelectedIds 给出）');
    assert.ok(!/已不在/.test(plain), '★default 档不提自选的事（不制造噪音）');
});

test('renderAbstractSelection⑥：加载中也要能画（loading 标记 + 如实说没读到）；空书照旧有状态那一格', () => {
    const html = renderAbstractSelection({ sources: [], selection: { mode: 'default' }, loading: true });
    assert.match(html, /data-source-picker/, '★加载中容器照样在（否则接线层找不到挂载点）');
    assert.match(html, /data-source-status/, '★要有一格状态文字');
    assert.match(html, /读取中/, '★如实说"读取中"（不许静默空着让玩家以为书里没有）');
    const empty = renderAbstractSelection({ sources: [], selection: { mode: 'default' } });
    assert.match(empty, /data-source-status/, '★空书也要有状态那一格');
    assert.match(empty, /没有读到任何来源/, '★空书要直说，不留白');
});

// ═══════════════════════════ ⑤ 控制器：委托 / 世代 / 搜索 / 重读 ═══════════════════════════

test('bindAbstractSelection①：**一次委托**（click/input/change 各一条）＋ 首次 sync 懒加载（render 出来的只是空壳）', async () => {
    const { doc, win } = makeDom();
    globalThis.document = doc;
    try {
        let reads = 0;
        const api = bindAbstractSelection(win, {
            getSnapshot: async () => { reads += 1; return snapshotFor(ENTRIES); },
            writeSelection: () => {},
        });
        assert.equal(typeof api.sync, 'function', '★要交出 sync');
        assert.equal(typeof api.reload, 'function', '★要交出 reload');
        assert.equal(reads, 0, '★懒加载：**没人 sync 之前**一条都不读（建控制器不等于查书）');
        // 容器空着 ⇒ 控制器自己补一个空壳（接线层可以在拿到数据前就挂上监听）
        const first = api.sync();
        assert.ok(win.querySelector('[data-source-picker]'), '★没有容器时 sync 要自己补一个（接线层不必先手写一份 HTML 常量）');
        await first;
        assert.equal(reads, 1, '★首次 sync 才去现取来源');
        assert.equal(win.querySelectorAll('[data-source-entry]').length, 3, '★取回来要真的填进容器');
        // ★委托只挂一次
        const count = (t) => (doc._listeners.get(win) || []).filter((l) => l[0] === t).length;
        assert.equal(count('click'), 1, '★click 委托只许挂一条（挂多条 = 一次点击写多次设置）');
        assert.equal(count('input'), 1, '★input 委托只许挂一条');
        assert.equal(count('change'), 1, '★change 委托只许挂一条');
        // 再绑一次同一个窗口 ⇒ 复用，不许挂第二份
        const again = bindAbstractSelection(win, { getSnapshot: async () => null, writeSelection: () => {} });
        assert.equal(count('click'), 1, '★同一个窗口绑两次只许有一份监听');
        assert.equal(again.sync, api.sync, '★同一个窗口交出的是同一份控制器');
    } finally { delete globalThis.document; }
});

test('bindAbstractSelection②：加载中 Promise 去重（在飞不再发）＋ 世代防护（旧/作废的一轮一个字都不许碰）', async () => {
    const { doc, win } = makeDom();
    globalThis.document = doc;
    try {
        const gate = {};
        const writes = [];
        let calls = 0;
        const api = bindAbstractSelection(win, {
            getSnapshot: () => { calls += 1; return new Promise((r) => { gate[calls] = r; }); },
            writeSelection: (s) => { writes.push(s); },
        });
        const p1 = api.sync();
        const p2 = api.sync();
        const p3 = api.sync();
        assert.equal(calls, 1, '★同一刻三次 sync 只许真取一次（在飞去重；否则一开面板连查三遍书）');
        gate[1](snapshotFor([ENTRY_A]));
        await Promise.all([p1, p2, p3]);
        assert.equal(win.querySelectorAll('[data-source-entry]').length, 1, '★回来之后填进容器');
        const r1 = api.reload();
        const r2 = api.reload();
        assert.equal(calls, 3, '★两次 reload 各现取一轮');
        // ★新一轮先回来 ⇒ 生效；旧一轮后回来 ⇒ 一个字都不许碰上
        gate[3](snapshotFor([ENTRY_A]));
        await r2;
        assert.equal(win.querySelectorAll('[data-source-entry]').length, 1, '★新一轮的结果生效');
        gate[2](snapshotFor([ENTRY_B, ENTRY_C]));
        await r1;
        assert.equal(win.querySelectorAll('[data-source-entry]').length, 1, '★★晚回来的旧一轮不许覆盖新一轮');
        // ★接线层判"这一轮作废"（切了聊天/来源）⇒ 返回 null：不崩、不写设置、不画旧数据
        const stale = api.reload();
        assert.equal(calls, 4);
        gate[4](null);
        await stale;
        assert.deepEqual(writes, [], '★作废快照不许写任何设置（读取路径本来就不写）');
        assert.equal(win.querySelectorAll('[data-source-entry]').length, 0, '★作废的一轮不画任何东西（重读先清空、等新数据）');
        const next = api.reload();
        gate[5](snapshotFor([ENTRY_A]));
        await next;
        assert.equal(win.querySelectorAll('[data-source-entry]').length, 1, '★作废之后控制器照常可用');
    } finally { delete globalThis.document; }
});

test('bindAbstractSelection③：搜索**只隐藏**非命中列表项 —— 搜索框不被重建、输入与勾选都不丢', async () => {
    const { doc, win } = makeDom();
    globalThis.document = doc;
    try {
        const api = bindAbstractSelection(win, {
            getSnapshot: async () => snapshotFor([withSource(ENTRY_A, '大荒'), withSource(ENTRY_B, '大荒'), withSource(ENTRY_C, '三国')]),
            writeSelection: () => {},
        });
        await api.sync();
        await tick();
        const boxes = win.querySelectorAll('[data-source-entry]');
        const box = win.querySelector('[data-source-search]');
        // 先勾一条，搜索之后这个勾必须还在（重建输入就会丢）
        boxes[0].checked = true;
        typeSearch(win, '万法');
        assert.equal(win.querySelector('[data-source-search]'), box, '★搜索框**不许被重建**（重建就丢焦点、丢输入）');
        assert.equal(box.value, '万法', '★搜索框里的字还在');
        assert.equal(win.querySelectorAll('[data-source-entry]').length, 3, '★列表项也不许重建（只切可见性）');
        const visible = visibleItems(win);
        assert.equal(visible.length, 1, '★只剩命中的那一条可见');
        assert.equal(visible[0].getAttribute('data-source-title'), '万法阁', '★命中的正是它（按条目名搜）');
        assert.equal(win.querySelectorAll('[data-source-entry]')[0].checked, true, '★搜索不许动勾选状态');
        // 搜正文也能命中
        typeSearch(win, '玉虚秘境');
        assert.deepEqual(visibleItems(win).map((i) => i.getAttribute('data-source-title')), ['清玄真人'], '★按正文搜也要命中（玩家记得的是内容不是名字）');
        // 搜不到 ⇒ 列表项全藏
        typeSearch(win, '整本书都没有的词');
        assert.equal(visibleItems(win).length, 0, '★搜不到就一条都不显示');
        // 清空 ⇒ 全回来
        typeSearch(win, '');
        assert.equal(visibleItems(win).length, 3, '★清空搜索恢复全部');
        // 来源筛选同样只切可见性
        const filter = win.querySelector('[data-source-filter]');
        filter.value = '三国';
        fire(filter, 'change');
        assert.equal(visibleItems(win).length, 1, '★筛选之后只剩那一组');
        assert.equal(visibleItems(win)[0].getAttribute('data-source-title'), '清玄真人');
    } finally { delete globalThis.document; }
});

test('bindAbstractSelection④：模式切换与勾选都写回**归一化**的选择（新写入一律带 version:2 与 reads）', async () => {
    const { doc, win } = makeDom();
    globalThis.document = doc;
    try {
        const writes = [];
        const api = bindAbstractSelection(win, {
            getSnapshot: async () => snapshotFor(ENTRIES),
            writeSelection: (s) => { writes.push(s); },
        });
        await api.sync();
        await tick();
        // ★每一次交互之后列表会重画（勾选态要所见即所选）⇒ 元素引用必须**现取**
        const boxAt = (i) => win.querySelectorAll('[data-source-entry]')[i];
        // 切到 custom ⇒ 写一份 custom（基线 = 本次默认生效集，见页面判据）
        const mode = win.querySelector('[data-source-mode]');
        mode.value = 'custom';
        fire(mode, 'change');
        const picked = writes[writes.length - 1];
        assert.equal(picked.version, 2, '★新写入必须带 version:2');
        assert.equal(picked.mode, 'custom');
        assert.deepEqual(picked.selectedIds.slice().sort(), [idOf(ENTRY_A), idOf(ENTRY_B), idOf(ENTRY_C)].sort(),
            '★默认生效集里那三条作为基线带上（首次改动以 defaultSelectedIds 为基线）');
        // 勾一条 ⇒ 写回 custom [该条 ID]
        const third = boxAt(2);
        third.checked = true;
        fire(third, 'change');
        const after = writes[writes.length - 1];
        assert.ok(after.selectedIds.includes(third.value), '★勾选写回的就是它自己的 ID');
        assert.equal(after.mode, 'custom');
        // 取消勾选 ⇒ 从记录里去掉
        const again = win.querySelectorAll('[data-source-entry]')[2];
        assert.equal(again.checked, true, '★重画之后那条照旧是勾上的（所见即所选）');
        again.checked = false;
        fire(again, 'change');
        assert.equal(writes[writes.length - 1].selectedIds.includes(third.value), false, '★取消勾选要真去掉（不是留着"以后可能用"）');
        // 一条钩子都没注入（老调用方 / 书还没读到）⇒ 照样不许抛
        const { win: bare } = makeDom();
        const api2 = bindAbstractSelection(bare, {});
        await assert.doesNotReject(() => api2.sync(), '★没注入取数/写回的钩子时，sync 不许抛');
    } finally { delete globalThis.document; }
});

test('bindAbstractSelection⑤：全选/清空/反选**只作用于当前可见的搜索结果**', async () => {
    const { doc, win } = makeDom();
    globalThis.document = doc;
    try {
        const writes = [];
        const api = bindAbstractSelection(win, {
            getSnapshot: async () => snapshotFor([withSource(ENTRY_A, '大荒'), withSource(ENTRY_B, '大荒'), withSource(ENTRY_C, '三国')],
                { version: 2, mode: 'custom', selectedIds: [], reads: {} }),
            writeSelection: (s) => { writes.push(s); },
        });
        await api.sync();
        await tick();
        // 搜索"昆仑" ⇒ 三条里只有一条命中
        typeSearch(win, '昆仑');
        clickAction(win, 'all');
        assert.deepEqual(writes[writes.length - 1].selectedIds, [idOf(withSource(ENTRY_A, '大荒'))],
            '★全选只勾**当前可见**的那一条（把藏起来的也勾上 = 玩家看不见的副作用）');
        // 反选：可见那条取消，藏起来的不动
        clickAction(win, 'invert');
        assert.deepEqual(writes[writes.length - 1].selectedIds, [], '★反选：可见那条从"勾"变"不勾"');
        typeSearch(win, '');
        clickAction(win, 'all');
        assert.equal(writes[writes.length - 1].selectedIds.length, 3, '★没有搜索时全选 = 全勾');
        clickAction(win, 'none');
        assert.deepEqual(writes[writes.length - 1].selectedIds, [], '★取消结果要一条不剩（当前范围 = 全部）');
    } finally { delete globalThis.document; }
});

test('bindAbstractSelection⑥：写回时带上**已经不在书里**的消失 ID', async () => {
    const { doc, win } = makeDom();
    globalThis.document = doc;
    try {
        const writes = [];
        const api = bindAbstractSelection(win, {
            getSnapshot: async () => snapshotFor([withSource(ENTRY_A, '大荒')],
                { version: 2, mode: 'custom', selectedIds: ['大荒:早就删掉的条目'], reads: {} }),
            writeSelection: (s) => { writes.push(s); },
        });
        await api.sync();
        await tick();
        assert.equal(win.querySelectorAll('[data-source-entry]')[0].checked, false, '★新条目（书里有、选择记录里没有）默认不勾');
        const box = win.querySelectorAll('[data-source-entry]')[0];
        box.checked = true;
        fire(box, 'change');
        assert.deepEqual(writes[writes.length - 1].selectedIds,
            ['大荒:早就删掉的条目', idOf(withSource(ENTRY_A, '大荒'))],
            '★写回必须**带上**那条已经消失的 ID（悄悄抹掉 = 作者把条目改回来时用户的勾选已经没了）');
        const status = win.querySelector('[data-source-status]');
        assert.match(status.textContent, /已不在/, '★界面上要如实提示（那一行状态文字里）');
    } finally { delete globalThis.document; }
});

test('bindAbstractSelection⑦：reload 现取重填、先走失效口；容器由它填', async () => {
    const { doc, win } = makeDom();
    globalThis.document = doc;
    try {
        let list = [withSource(ENTRY_A, '大荒')];
        const reloads = [];
        const api = bindAbstractSelection(win, {
            getSnapshot: async () => snapshotFor(list),
            writeSelection: () => {},
            reloadSources: () => { reloads.push(1); },
        });
        await api.sync();
        assert.equal(win.querySelectorAll('[data-source-entry]').length, 1);
        list = [withSource(ENTRY_A, '大荒'), withSource(ENTRY_B, '大荒'), withSource(ENTRY_C, '三国')];
        clickAction(win, 'reload');
        await tick();
        await tick();
        assert.equal(win.querySelectorAll('[data-source-entry]').length, 3, '★点重读要现取重填（作者刚改了书）');
        assert.equal(win.querySelectorAll('[data-source-group]').length, 2, '★重填之后分组也跟着变');
        assert.equal(reloads.length, 1, '★重读必须先走接线层的失效口（下游取书缓存不许留着旧书）');
        // 控制器自己兜底造容器：那个壳里也必须带 [data-source-picker]
        const { doc: doc2, win: win2 } = makeDom();
        globalThis.document = doc2;
        const api2 = bindAbstractSelection(win2, { getSnapshot: async () => snapshotFor([]), writeSelection: () => {} });
        await api2.sync();
        assert.ok(win2.querySelector('[data-source-picker]'), '★控制器填的就是 [data-source-picker] 那个容器');
    } finally { delete globalThis.document; }
});

test('bindAbstractSelection⑧：控制器状态不落全局（同一个模块能同时带两个窗口，互不串味）', async () => {
    const { doc, win } = makeDom();
    globalThis.document = doc;
    try {
        const a = bindAbstractSelection(win, {
            getSnapshot: async () => snapshotFor([withSource(ENTRY_A, '大荒')]),
            writeSelection: () => {},
        });
        await a.sync();
        const one = win.querySelector('[data-source-entry]').value;
        const other = makeDom();
        const b = bindAbstractSelection(other.win, {
            getSnapshot: async () => snapshotFor([withSource(ENTRY_B, '三国')]),
            writeSelection: () => {},
        });
        await b.sync();
        assert.equal(win.querySelector('[data-source-entry]').value, one, '★第二个窗口的加载不许动第一个窗口的列表');
        assert.equal(other.win.querySelectorAll('[data-source-entry]').length, 1);
        assert.notEqual(other.win.querySelector('[data-source-entry]').value, one, '★两个窗口各看各的书');
    } finally { delete globalThis.document; }
});
