// story-world-v2/test/abstract-source-editor.test.js
// 「抽象来源」正文编辑的**纯逻辑**判据（`web/abstract-source-editor.js`）。
//
// 这一族为什么必须单独成模块、单独判：
//   ① **坐标是安全边界**：页面把原文放进只读 `<textarea>` 让用户划选，而 textarea 的
//      `selectionStart/End` 数的是**换行归一之后**的 UTF-16 位置（CRLF ⇒ LF），
//      保存的 `start/end` 却必须是**原始正文**的 UTF-16 位置（Task 1 的选段核对就是按它切的）。
//      映射错一格 = 用户保存的选段与他看见的文字差一个字（而且**静默**：核对只比对原文 slice）。
//      ★emoji 是另一半：UTF-16 里它是两个码元 ⇒ 用"码点下标"实现必错一格。
//   ② **批量只作用于当前筛选范围**：这是产品口径（隐藏的选择保持原值），
//      算错一次就是"玩家看不见的副作用"。纯函数 + 判据才咬得住它。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    applyBatchEdit, collectSegments, describeSource, displayOffsetToRawOffset, mergeSegments, normalizeNewlines,
    rawRangeToSegment, savedSegments, segmentsText, selectionBaseIds,
} from '../web/abstract-source-editor.js';

// ═══════════════════════ ① 换行归一与坐标映射（CRLF + emoji） ═══════════════════════

test('normalizeNewlines：CRLF 与孤立 CR 都归成 LF（textarea 的 value 就是这个形状）', () => {
    assert.equal(normalizeNewlines('甲\r\n乙'), '甲\n乙', '★CRLF ⇒ LF');
    assert.equal(normalizeNewlines('甲\r乙'), '甲\n乙', '★孤立 CR 也归成 LF（老 Mac 换行不许留成"看不见的字符"）');
    assert.equal(normalizeNewlines('甲\n乙'), '甲\n乙', '★本来就是 LF ⇒ 逐字节不变');
    assert.equal(normalizeNewlines(null), '', '★null 不许抛');
});

test('displayOffsetToRawOffset：CRLF 折叠处、emoji 代理对、行首行尾都要落在**原始 UTF-16** 位置上', () => {
    // 原文索引：甲0 😀1,2 \r3 \n4 乙5 \n6 丙7（长度 8）
    // 显示索引：甲0 😀1,2 \n3 乙4 \n5 丙6（长度 7）
    const raw = '甲😀\r\n乙\n丙';
    const display = normalizeNewlines(raw);
    assert.equal(display, '甲😀\n乙\n丙');
    assert.equal(displayOffsetToRawOffset(raw, 0), 0, '★行首');
    assert.equal(displayOffsetToRawOffset(raw, 4), 5, '★CRLF 之后那个字（显示 4 ⇒ 原文 5：折掉了一个 \\n）');
    assert.equal(displayOffsetToRawOffset(raw, 3), 3, '★CRLF 那个换行自己的起点');
    assert.equal(displayOffsetToRawOffset(raw, 5), 6, '★第二个换行（LF，1:1）');
    assert.equal(displayOffsetToRawOffset(raw, 7), 8, '★末尾（显示长度 ⇒ 原文长度）');
    assert.equal(displayOffsetToRawOffset(raw, 99), 8, '★越界的偏移夹到末尾（不许返回 NaN）');
    // ★emoji：显示 [1,3) 就是那一个表情（两个 UTF-16 码元）——用码点下标实现会在这里差一格
    const emoji = rawRangeToSegment(raw, 1, 3);
    assert.equal(emoji.text, '😀', '★emoji 选段的 text 就是它本身');
    assert.equal(emoji.start, 1);
    assert.equal(emoji.end, 3, '★end 是 UTF-16 的 3（不是码点的 2）');
    assert.equal(raw.slice(emoji.start, emoji.end), '😀', '★Task 1 的核对口径：raw.slice(start,end) === text');
});

test('rawRangeToSegment：选段核对口径恒成立；零长度不给段（"至少一段且各段非空"）', () => {
    // raw='前😀\r\n后'：前0 😀1,2 \r3 \n4 后5；display='前😀\n后'：前0 😀1,2 \n3 后4
    const raw = '前😀\r\n后';
    const seg = rawRangeToSegment(raw, 1, 5);
    assert.equal(seg.text, raw.slice(seg.start, seg.end), '★★保存的 text 必须逐字等于原文 slice（否则 Task 1 整条判失效）');
    assert.equal(seg.text, '😀\r\n后', '★选段不许把换行折叠后的形态写回去（原文是 CRLF）');
    assert.deepEqual([seg.start, seg.end], [1, 6]);
    assert.equal(rawRangeToSegment(raw, 2, 2), null, '★零长度 ⇒ 不给段（"至少一段且各段非空"）');
    const reversed = rawRangeToSegment(raw, 5, 1);
    assert.equal(reversed.text, '😀\r\n后', '★反着拖的坐标先归一（起点≤终点），结果与正着拖一致');
    assert.deepEqual([reversed.start, reversed.end], [seg.start, seg.end]);
    assert.equal(rawRangeToSegment(raw, 3, 1).text, '😀', '★反向的短区间同理');
});

test('collectSegments：按原文位置排序、去重、丢掉空区间；**不 trim**（用户选的首尾空白照留）', () => {
    // raw='甲\r\n乙 丙'：甲0 \r1 \n2 乙3 ' '4 丙5；display='甲\n乙 丙'：甲0 \n1 乙2 ' '3 丙4
    const raw = '甲\r\n乙 丙';
    const ranges = [
        { start: 4, end: 5 },     // 显示 '丙' ⇒ 原文 5..6
        { start: 2, end: 3 },     // 显示 '乙' ⇒ 原文 3..4（CRLF 折叠 ⇒ 右移一格）
        { start: 4, end: 5 },     // 重复
        { start: 2, end: 2 },     // 空
        { start: 3, end: 4 },     // 显示那个空格 ⇒ 原文 4..5：非空 ⇒ 留（"保留选中文本的首尾空白"）
    ];
    const segs = collectSegments(raw, ranges);
    assert.deepEqual(segs.map((s) => s.text), ['乙', ' ', '丙'], `★按原文位置排序且去重；实际 ${JSON.stringify(segs)}`);
    for (const s of segs) assert.equal(raw.slice(s.start, s.end), s.text, '★每一段都过 raw.slice 核对');
});

test('mergeSegments：**已保存的原始坐标**再添一段时不许被当显示坐标二次映射（真 bug 的回归）', () => {
    // raw='甲😀\r\n乙段\n丙尾'：甲0 😀1,2 \r3 \n4 乙5 段6 \n7 丙8 尾9；display='甲😀\n乙段\n丙尾'
    const raw = '甲😀\r\n乙段\n丙尾';
    const saved = [{ start: 1, end: 3, text: '😀' }];                 // 原始坐标
    const incoming = rawRangeToSegment(raw, 7, 9);                    // 显示 [7,9) ⇒ 原文 [8,10) = '丙尾'
    assert.deepEqual(incoming, { start: 8, end: 10, text: '丙尾' });
    const merged = mergeSegments(saved, incoming);
    assert.deepEqual(merged.map((s) => s.text), ['😀', '丙尾'],
        '★★已保存的坐标是原文坐标：再喂一次显示映射会把"丙尾"错成"尾"（判据当场咬到过）');
    assert.deepEqual(merged.map((s) => [s.start, s.end]), [[1, 3], [8, 10]]);
    for (const s of merged) assert.equal(raw.slice(s.start, s.end), s.text, '★合并之后每一段照旧过原文核对');
    assert.deepEqual(mergeSegments(saved, incoming).length, 2, '★重复添加同一段不产生第二份');
    assert.deepEqual(mergeSegments([{ start: 5, end: 5, text: '' }], null), [], '★空区间不进表');
});

test('savedSegments / segmentsText / selectionBaseIds：从选择记录里读、按保存顺序连接、缺省不猜', () => {
    const raw = '甲\n乙\n丙';
    const selection = {
        version: 2, mode: 'custom', selectedIds: ['a'],
        reads: { a: { mode: 'segments', originalText: raw, segments: [{ start: 2, end: 5, text: '乙\n丙' }] } },
    };
    assert.deepEqual(savedSegments(selection, 'a').map((s) => s.text), ['乙\n丙']);
    assert.deepEqual(savedSegments(selection, 'b'), [], '★没记录的来源 ⇒ 空（不猜）');
    assert.equal(segmentsText([{ start: 0, end: 1, text: '甲' }, { start: 2, end: 3, text: '乙' }]), '甲\n乙', '★多段以换行连接（与 Task 1 解析口径同一把尺）');
    assert.deepEqual(selectionBaseIds({ mode: 'custom', selectedIds: ['a', 'x'] }, ['d'], ['gone']), ['a', 'x'], '★自选档：基线就是已存的选择（含已消失项）');
    assert.deepEqual(selectionBaseIds({ mode: 'default' }, ['d1', 'd2'], ['gone']), ['d1', 'd2', 'gone'],
        '★默认档：基线 = 默认生效集 + 已消失的存档 ID（首次改动依此转成自选）');
});

// ═══════════════════════ ② 批量选择只作用于当前范围 ═══════════════════════

const ROWS = [
    { id: 'vis-enabled', disabled: false, technical: false, empty: false },
    { id: 'vis-disabled', disabled: true, technical: false, empty: false },
    { id: 'vis-technical', disabled: false, technical: true, empty: false },
    { id: 'vis-empty', disabled: false, technical: false, empty: true },
];

test('applyBatchEdit：全选/取消/反选**只动交进来的那些行**，基线原样保留（含已消失 ID）', () => {
    const selection = { version: 2, mode: 'custom', selectedIds: ['kept', '大荒:已删条目'], reads: { kept: { mode: 'full' } } };
    const all = applyBatchEdit({ selection, defaultSelectedIds: [], rows: ROWS, kind: 'all' });
    assert.deepEqual(all.selectedIds, ['kept', '大荒:已删条目', 'vis-enabled', 'vis-disabled', 'vis-technical', 'vis-empty'],
        '★全选 = 原有基线 + 可见行的 ID（顺序稳定）');
    assert.equal(all.mode, 'custom', '★一次批量就是一次真实改动 ⇒ 落到自选档');
    assert.deepEqual(all.reads, { kept: { mode: 'full' } }, '★读取方式（含选段）一个字不许丢');

    const none = applyBatchEdit({ selection: all, defaultSelectedIds: [], rows: [ROWS[0]], kind: 'none' });
    assert.deepEqual(none.selectedIds, ['kept', '大荒:已删条目', 'vis-disabled', 'vis-technical', 'vis-empty'],
        '★取消只取消交进来的那一行（藏起来的行不在 rows 里 = 一个字都不动）');

    const invert = applyBatchEdit({ selection: { version: 2, mode: 'custom', selectedIds: ['vis-enabled'] }, defaultSelectedIds: [], rows: ROWS, kind: 'invert' });
    assert.deepEqual(invert.selectedIds.slice().sort(), ['vis-disabled', 'vis-empty', 'vis-technical'],
        '★反选：勾着的去掉、没勾的加上');
});

test('applyBatchEdit：取消禁用/技术/空正文**只按各自的判据**动可见行', () => {
    const base = { version: 2, mode: 'custom', selectedIds: ROWS.map((r) => r.id), reads: {} };
    assert.deepEqual(applyBatchEdit({ selection: base, rows: ROWS, kind: 'exclude-disabled' }).selectedIds,
        ['vis-enabled', 'vis-technical', 'vis-empty'], '★取消勾选禁用项只去禁用那条');
    assert.deepEqual(applyBatchEdit({ selection: base, rows: ROWS, kind: 'exclude-technical' }).selectedIds,
        ['vis-enabled', 'vis-disabled', 'vis-empty'], '★取消技术条目只去技术那条');
    assert.deepEqual(applyBatchEdit({ selection: base, rows: ROWS, kind: 'exclude-empty' }).selectedIds,
        ['vis-enabled', 'vis-disabled', 'vis-technical'], '★取消空正文只去空正文那条');
    // ★核心口径：rows 是**当前筛选范围**；范围外那条禁用项（藏起来的）勾选保持原值
    const hidden = applyBatchEdit({ selection: base, rows: [ROWS[0], ROWS[2], ROWS[3]], kind: 'exclude-disabled' });
    assert.ok(hidden.selectedIds.includes('vis-disabled'), '★★藏起来的禁用项仍是勾上的（批量只作用于当前结果）');
    assert.equal(hidden.selectedIds.includes('vis-enabled'), true, '★可见的启用项不受牵连');
});

test('applyBatchEdit：默认档首次改动**以 defaultSelectedIds 为基线**（不是"全勾"，也不是空）', () => {
    const next = applyBatchEdit({
        selection: { mode: 'default', selectedIds: [] },
        defaultSelectedIds: ['d1', 'd2', 'd3'],
        vanishedIds: ['大荒:早就删掉的'],
        rows: [{ id: 'd2', disabled: true }],
        kind: 'exclude-disabled',
    });
    assert.equal(next.mode, 'custom');
    assert.deepEqual(next.selectedIds, ['d1', 'd2', 'd3', '大荒:早就删掉的'].filter((id) => id !== 'd2'),
        '★默认档转自选：先取默认生效集，再按本次动作去掉禁用那条；消失的存档 ID 一并带上');
    const untouched = applyBatchEdit({
        selection: { mode: 'default', selectedIds: [] }, defaultSelectedIds: ['d1'], rows: [], kind: 'none',
    });
    assert.deepEqual(untouched.selectedIds, ['d1'], '★空范围取消 = 不动默认生效集（但仍是一次显式改档）');
});

// ═══════════════════════ ③ 状态中文（失败/未加载/真空必须分形） ═══════════════════════

test('describeSource：生效/选段失效/技术/空正文/未加载/预算外各有各的话，且带得出标记', () => {
    const src = (over = {}) => ({ id: 'x', title: '条目', source: '大荒', disabled: false, technical: false, empty: false, loaded: true, ...over });
    const item = (over = {}) => ({ id: 'x', status: 'effective', reason: '默认读取', effectiveChars: 12, ...over });

    const ok = describeSource(item(), src());
    assert.equal(ok.state, 'effective');
    assert.equal(ok.effective, true);
    assert.match(ok.label, /生效/);
    assert.ok(ok.label.includes('12'), '★生效状态要报字数');

    const stale = describeSource(item({ status: 'stale-segments', effectiveChars: 0, reason: '' }), src());
    assert.equal(stale.effective, false);
    assert.match(stale.label, /选段/, '★选段失效必须说出来（不许静默不生效）');
    assert.match(stale.reason, /重新选择/, '★缺省说明也要说清"要重选"，且不许自动挪位');

    const tech = describeSource(item({ status: 'technical' }), src({ technical: true }));
    assert.match(tech.label, /技术|清理/);
    assert.ok(tech.flags.includes('技术条目'), '★技术条目的标记要带出去（玩家才知道为什么它默认不进）');

    const empty = describeSource(item({ status: 'empty' }), src({ empty: true }));
    assert.match(empty.label, /空/, '★真正空正文');

    const unloaded = describeSource(item({ status: 'unloaded' }), src({ loaded: false }));
    assert.match(unloaded.label, /没加载|未加载/, '★卡还没加载完 —— 与"卡里没有"分形');

    const budget = describeSource(item({ status: 'budget-excluded' }), src());
    assert.match(budget.label, /上限/, '★预算排除要如实说');

    const disabled = describeSource(item({ status: 'excluded', reason: '默认排除禁用条目' }), src({ disabled: true }));
    assert.ok(disabled.flags.includes('禁用'));
    assert.equal(disabled.effective, false);
    assert.match(disabled.reason, /禁用/);
});
