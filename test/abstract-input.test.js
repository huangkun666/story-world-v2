import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeInitSource } from '../src/init-source.js';
import { entrySelectionId, normalizeAbstractSelection } from '../src/abstract-selection.js';
import { bookFingerprint } from '../src/fp-hash.js';
const input = await import('../src/abstract-input.js').catch(() => ({}));
const card = { name: '卡', description: '卡描述', scenario: '卡场景', personality: '卡性格', first_mes: '卡开场' };
const entries = [
    { uid: 1, _sw2Source: '甲书', comment: '甲', content: '甲住北城。' },
    { uid: 2, _sw2Source: '甲书', comment: '乙', content: '乙住南城。', disable: true },
    { uid: 3, _sw2Source: '甲书', comment: '空', content: '' },
    { uid: 4, _sw2Source: '甲书', comment: '[InitVar]技术', content: '<script>代码</script>' },
    { uid: 1, _sw2Source: '乙书', comment: '甲', content: '甲住北城。' },
];
test('来源清单与实际题头共用空 key 到 keys 的题名回退', () => {
    const raw = [
        { uid: 71, comment: '', name: '', key: [], keys: ['甲'], content: '甲住北城。' },
        { uid: 72, comment: '', name: '', key: ' ', keys: '乙', content: '乙住南城。' },
    ];
    const original = structuredClone(raw);
    const composed = composeInitSource({ worldInfoEntries: raw });
    assert.deepEqual(composed.sourceItems.map(s => s.title), ['甲', '乙']);
    assert.equal(composed.text, '【甲】甲住北城。\n【乙】乙住南城。');
    assert.deepEqual(raw, original);
});
test('恒注入声明可按 keys 回退题名读取禁用仓储副本', () => {
    const raw = [
        { uid: 81, comment: '取料壳', constant: true, content: "<% getwi(null,'甲') %>" },
        { uid: 82, comment: '', name: '', key: [], keys: ['甲'], disable: true, content: '甲的原始设定。' },
    ];
    const original = structuredClone(raw);
    const composed = composeInitSource({ worldInfoEntries: raw });
    assert.equal(composed.ok, true);
    assert.equal(composed.text, '【甲】甲的原始设定。');
    assert.equal(composed.sourceItems.find(s => s.id === entrySelectionId(raw[1])).title, '甲');
    assert.deepEqual(raw, original);
});
test('完整来源包含禁用、技术、空、跨来源相同正文及四项卡正文，且不改原件', () => {
    assert.equal(typeof input.collectAbstractSources, 'function');
    const original = structuredClone({ entries, card });
    const sources = input.collectAbstractSources({ worldInfoEntries: [...entries, entries[0]], character: card });
    assert.equal(sources.length, 9);
    assert.equal(new Set(sources.map(s => s.id)).size, 9);
    assert.equal(sources.find(s => s.id === entrySelectionId(entries[1])).disabled, true);
    assert.equal(sources.find(s => s.id === entrySelectionId(entries[2])).empty, true);
    assert.equal(sources.find(s => s.id === entrySelectionId(entries[3])).technical, true);
    assert.equal(sources.filter(s => s.kind === 'character-field').length, 4);
    assert.deepEqual({ entries, card }, original);
});
test('明确新自选覆盖禁用读取副本并排除未选卡正文', () => {
    const original = structuredClone(entries);
    const result = composeInitSource({ worldInfoEntries: entries, character: card, selection: { mode: 'custom', selectedIds: [entrySelectionId(entries[1])], reads: {} } });
    assert.ok(result.text?.includes(entries[1].content));
    assert.ok(!result.text.includes(entries[0].content));
    assert.ok(!result.text.includes(card.description));
    assert.equal(result.effectiveEntries.length, 1);
    assert.equal(result.effectiveEntries[0].disable, false);
    assert.deepEqual(entries, original);
});
test('原文全文和选段不会再次技术清理，选段按保存顺序读取', () => {
    assert.equal(typeof input.resolveAbstractSources, 'function');
    const entry = { uid: 10, comment: '[InitVar]原文', content: '先<script>资料</script>后' };
    const sources = input.collectAbstractSources({ worldInfoEntries: [entry] });
    const id = sources[0].id;
    const full = composeInitSource({ worldInfoEntries: [entry], selection: { mode: 'custom', selectedIds: [id], reads: { [id]: { mode: 'full' } } } });
    assert.ok(full.text.includes(entry.content));
    const segments = [{ start: 20, end: 21, text: '后' }, { start: 1, end: 20, text: '<script>资料</script>' }];
    const resolved = input.resolveAbstractSources({ sources, selection: { mode: 'custom', selectedIds: [id], reads: { [id]: { mode: 'segments', originalText: entry.content, segments } } } });
    assert.equal(resolved.effectiveEntries[0].content, '后\n<script>资料</script>');
});
test('全文原文核对与选段位置核对失败均不回退全文', () => {
    assert.equal(typeof input.resolveAbstractSources, 'function');
    const sources = input.collectAbstractSources({ worldInfoEntries: [entries[0]] });
    const id = sources[0].id;
    for (const read of [
        { mode: 'segments', originalText: '过期原文', segments: [{ start: 0, end: 1, text: '甲' }] },
        { mode: 'segments', originalText: entries[0].content, segments: [{ start: 0, end: 1, text: '乙' }] },
        { mode: 'segments', originalText: entries[0].content, segments: [] },
    ]) {
        const result = input.resolveAbstractSources({ sources, selection: { mode: 'custom', selectedIds: [id], reads: { [id]: read } } });
        assert.equal(result.effectiveEntries.length, 0);
        assert.equal(result.sourceItems[0].status, 'stale-segments');
    }
});
test('旧自选显式迁移保留四项卡正文，迁移后不自动选新增卡项', () => {
    assert.equal(typeof input.migrateAbstractSelection, 'function');
    const sources = input.collectAbstractSources({ worldInfoEntries: entries, character: card });
    const old = { mode: 'custom', selectedIds: [entrySelectionId(entries[1]), '失踪条目'] };
    const migrated = input.migrateAbstractSelection(old, sources);
    assert.equal(migrated.version, 2);
    assert.ok(migrated.selectedIds.includes('失踪条目'));
    assert.equal(migrated.selectedIds.length, 6);
    assert.deepEqual(input.migrateAbstractSelection(migrated, sources), migrated);
    assert.equal(composeInitSource({ character: card, selection: old }).pieceCount, 4);
    assert.equal(composeInitSource({ character: card, selection: { mode: 'custom', selectedIds: [], reads: {} } }).ok, false);
    assert.deepEqual(old.selectedIds, [entrySelectionId(entries[1]), '失踪条目']);
});
test('新读取配置通过设置归一化保留选段与版本', () => {
    const value = { version: 2, mode: 'custom', selectedIds: ['甲'], reads: { 甲: { mode: 'segments', originalText: '原文', segments: [{ start: 0, end: 1, text: '原' }] } } };
    assert.deepEqual(normalizeAbstractSelection(value), value);
});
test('旧设置遇未加载卡暂停迁移，完整加载后才生成持久化版本', () => {
    assert.equal(typeof input.migrateAbstractSelectionState, 'function');
    const selection = { mode: 'custom', selectedIds: ['失踪条目'] };
    const partial = input.collectAbstractSources({ character: { ...card, shallow: true } });
    const pending = input.migrateAbstractSelectionState({ selection, sources: partial });
    assert.equal(pending.complete, false);
    assert.equal(pending.pendingCharacter, true);
    assert.equal(pending.selection.version, undefined);
    const done = input.migrateAbstractSelectionState({ selection, sources: input.collectAbstractSources({ character: card }) });
    assert.equal(done.complete, true);
    assert.equal(done.migrated, true);
    assert.equal(done.selection.version, 2);
    assert.ok(done.selection.selectedIds.includes('失踪条目'));
});
test('默认声明读取保留，但自选不读未选依赖或未选题名', () => {
    const raw = [{ uid: 1, comment: '控制器', constant: true, content: '<% getwi(null,"旧史") %>' }, { uid: 2, comment: '旧史', disable: true, content: '旧史正文' }];
    const defaults = composeInitSource({ worldInfoEntries: raw });
    assert.ok(defaults.text.includes('旧史正文'));
    assert.equal(defaults.effectiveEntries.length, 1);
    const custom = composeInitSource({ worldInfoEntries: raw, selection: { mode: 'custom', selectedIds: [entrySelectionId(raw[0])], reads: {} } });
    assert.equal(custom.ok, false);
    assert.equal(custom.effectiveEntries.length, 0);
    assert.ok(custom.warnings.some(w => w.includes('旧史')));
});
test('卡预算和总预算共同约束下游实际条目，排除文本不能用于兜底', () => {
    const result = composeInitSource({ worldInfoEntries: entries.slice(0, 1), character: { ...card, description: '卡'.repeat(1300) }, budget: 50 });
    assert.equal(result.truncated, true);
    assert.equal(result.effectiveEntries.length, 1);
    assert.ok(result.effectiveEntries.every(e => result.text.includes(e.content)));
    const clipped = composeInitSource({ character: { name: '卡', description: '卡'.repeat(1300) } });
    assert.equal(Array.from(clipped.effectiveEntries[0].content).length, 1200);
});
test('相同正文跨来源各自遵守总预算，不因字符串相同把未使用副本带回', () => {
    const twins = [{ uid: 1, _sw2Source: '甲', comment: '条目', content: '同文' }, { uid: 1, _sw2Source: '乙', comment: '条目', content: '同文' }];
    const composed = composeInitSource({ worldInfoEntries: twins, budget: 6 });
    assert.equal(composed.effectiveEntries.length, 1);
    assert.equal(composed.sourceItems.find(s => s.source === '乙').status, 'budget-excluded');
    assert.deepEqual(composed.defaultSelectedIds, [entrySelectionId(twins[0])]);
});
test('默认进入自选只继承实际允许正文含合法声明，不自动启用技术和禁用项', () => {
    const raw = [{ uid: 1, comment: '控制器', constant: true, content: '<% getwi(null,"旧史") %>' }, { uid: 2, comment: '旧史', disable: true, content: '旧史正文' }, { uid: 3, comment: '禁用', disable: true, content: '未读正文' }];
    const result = composeInitSource({ worldInfoEntries: raw });
    assert.deepEqual(result.defaultSelectedIds, [entrySelectionId(raw[1])]);
});
test('全文及选段保留所选原文的首尾空白，不偷偷再次修剪', () => {
    const entry = { uid: 8, comment: '原文', content: '  原文\n' };
    const id = entrySelectionId(entry);
    for (const read of [{ mode: 'full' }, { mode: 'segments', originalText: entry.content, segments: [{ start: 0, end: entry.content.length, text: entry.content }] }]) {
        const result = composeInitSource({ worldInfoEntries: [entry], selection: { mode: 'custom', selectedIds: [id], reads: { [id]: read } } });
        assert.equal(result.effectiveEntries[0].content, entry.content);
        assert.equal(result.text, '【原文】' + entry.content);
    }
});

// ============ 复查整改（Task 1 review · 重要项 1、2）：实际用料即唯一证据面 ============

const CONSTANT_CONTROLLERS = (names) => names.map((name, i) => ({ uid: 100 + i, _sw2Source: '甲书', comment: '控制器_' + name, constant: true, key: [name], content: '<% getwi(null,"人物资料") %>' }));
const GUARD_MATERIAL = { uid: 90, _sw2Source: '甲书', comment: '人物资料', content: '三位守将在边关驻防。' };

test('失效选段的控制器不得从原文补入题名，也不得把失效状态改写成生效题名', () => {
    const names = ['柳川', '岳林', '沈舟'];
    const controllers = CONSTANT_CONTROLLERS(names);
    const entries = [...controllers, GUARD_MATERIAL];
    const staleRead = Object.fromEntries(controllers.map(c => [entrySelectionId(c), { mode: 'segments', originalText: '过期原文', segments: [{ start: 0, end: 1, text: '过' }] }]));
    const result = composeInitSource({ worldInfoEntries: entries, selection: { version: 2, mode: 'custom', selectedIds: entries.map(entrySelectionId), reads: staleRead } });
    assert.equal(result.sourceItems.find(s => s.title === '人物资料').status, 'effective');
    for (const name of names) assert.ok(!String(result.text).includes(name), `失效选段的控制器题名不得补进实际正文：${name}`);
    assert.deepEqual(result.titleRoster, [], '失效选段的原文不得参与题名候选');
    assert.deepEqual(result.effectiveEntries.map(e => e._sw2SelectionId), [entrySelectionId(GUARD_MATERIAL)], '只有合法正文来源进入实际用料');
    for (const c of controllers) {
        const item = result.sourceItems.find(s => s.title === c.comment);
        assert.equal(item.segmentsValid, false);
        assert.equal(item.status, 'stale-segments', '失效状态不得被题名路径覆盖');
    }
});

test('自选下的合法自动控制器题名例外仍然参与题名候选', () => {
    const names = ['柳川', '岳林', '沈舟'];
    const controllers = CONSTANT_CONTROLLERS(names);
    const entries = [...controllers, GUARD_MATERIAL];
    const autoRead = Object.fromEntries(controllers.map(c => [entrySelectionId(c), { mode: 'auto' }]));
    const result = composeInitSource({ worldInfoEntries: entries, selection: { version: 2, mode: 'custom', selectedIds: entries.map(entrySelectionId), reads: autoRead } });
    assert.deepEqual(result.titleRoster.map(d => d.name), names, '自动读法 + 清理后仅技术内容的壳，题名例外照旧生效');
    for (const c of controllers) {
        const item = result.sourceItems.find(s => s.title === c.comment);
        assert.equal(item.segmentsValid, undefined);
        assert.equal(item.status, 'effective-title', '仅题名候选身份生效（不把控制器脚本带回正文）');
    }
    assert.ok(result.text.includes('三位守将在边关驻防'), '合法正文照旧进实际正文');
});

test('预算外来源的 key 不得给题名自证，也不得改变指纹', () => {
    const people = ['柳川', '岳林', '沈舟'].map((name, i) => ({ uid: i + 1, _sw2Source: '甲书', comment: '人物_' + name, key: [], content: '驻防' }));
    const beyond = { uid: 9, _sw2Source: '甲书', comment: '预算外', key: ['柳川', '岳林', '沈舟'], content: '字'.repeat(150) };
    const a = composeInitSource({ worldInfoEntries: [...people, beyond], budget: 50 });
    const b = composeInitSource({ worldInfoEntries: [...people, { ...beyond, key: [] }], budget: 50 });
    assert.equal(a.sourceItems.find(s => s.title === '预算外').status, 'budget-excluded');
    assert.equal(a.text, b.text);
    assert.deepEqual(a.titleRoster, b.titleRoster, '只改预算外条目的 key，名册不许变');
    assert.deepEqual(a.titleRoster, [], '预算外的 key 不能给题名自证');
    assert.equal(bookFingerprint(a.text, a.titleRoster), bookFingerprint(b.text, b.titleRoster), '同一份实际用料 ⇒ 同一个书指纹');
});

test('预算外来源的题名不得补足体例频次', () => {
    const kept = [
        { uid: 1, _sw2Source: '甲书', comment: '人物_柳川', key: ['柳川'], content: '驻防' },
        { uid: 2, _sw2Source: '甲书', comment: '人物_岳林', key: ['岳林'], content: '驻防' },
    ];
    const beyond = { uid: 9, _sw2Source: '甲书', comment: '人物_沈舟', key: ['沈舟'], content: '字'.repeat(150) };
    const a = composeInitSource({ worldInfoEntries: [...kept, beyond], budget: 50 });
    const b = composeInitSource({ worldInfoEntries: [...kept, { ...beyond, comment: '预算外' }], budget: 50 });
    assert.equal(a.sourceItems.find(s => s.title === '人物_沈舟').status, 'budget-excluded');
    assert.equal(a.text, b.text);
    assert.deepEqual(a.titleRoster, b.titleRoster, '只改预算外条目的题名，名册不许变');
    assert.deepEqual(a.titleRoster, [], '预算外的题名不能把两条正文补成"体例"');
    assert.equal(bookFingerprint(a.text, a.titleRoster), bookFingerprint(b.text, b.titleRoster), '同一份实际用料 ⇒ 同一个书指纹');
});

// ★★（Task 1 二次复查 · Important 1 边界）：**预算外的自动控制器也不许给题名自证**。
//   病灶：控制器题名例外把「合法选中 + auto + 清理后仅技术内容」的原件直接并进名册证据面，
//   而预算切点之后才判它是否真进本次用料 ⇒ 一条**被预算挤掉的**控制器照样能用它的 key
//   （以及它的题名频次）证明另一条候选名号，同一份实际正文就能算出两个名册与两个指纹。
//   口径：题名候选的 key 与体例频次只许来自**最终用料里的来源身份**——所谓"最终用料来源"＝
//   ① 进了本次正文的来源；② 其题名行本身进了本次正文的合法自动控制器例外（它的 key 随它一起生效）。
//   被预算挤掉的来源（不管是普通条目还是控制器）一个字都不许贡献。
//   ★定稿补的一刀（本仓实测抓到的反例）：光"第二遍重派生名册"还不够——**正文里的题名行**是第一遍
//     就写进 `parts` 的，而第一遍的候选集仍吃"基础预算内的来源 + 全部题名例外"：
//       · 一条被挤掉的控制器改个 key ⇒ 第一遍候选集换了人 ⇒ 正文里换成了另一条题名行（两个指纹）；
//       · 一条只靠被挤掉的 key 撑着的题名行 ⇒ 正文里有它、名册里没有它（**孤儿题名行**）。
//     ⇒ 生产里改成**只剔不补的不动点**：证据面 → 名册 → 剔掉"名册里没有"的题名行 → 证据面缩小 → 再算。
//     判据（本文件锁的就是它）：① 正文一字不差 ⇒ 名册与指纹必须一字不差；② 正文里每一条题名行
//     都必须在名册里有对应的候选（不许有孤儿行）；③ 合法正向面（题名行真的进了用料 + 同族成立）不许治坏。
const CONTROLLER_BUDGET_RAW = [
    { uid: 1, _sw2Source: '甲书', comment: '控制器_柳川', key: [], content: '驻防' },
    { uid: 2, _sw2Source: '甲书', comment: '控制器_岳林', key: ['岳林', '柳川'], constant: true, content: '<% getwi(null,"人物资料") %>' },
    { uid: 3, _sw2Source: '甲书', comment: '控制器_沈舟', key: ['沈舟'], constant: true, content: '<% getwi(null,"人物资料") %>' },
    { uid: 4, _sw2Source: '甲书', comment: '人物资料', content: '驻防' },
];
const TECHNICAL_CONTROLLERS = [
    { uid: 1, _sw2Source: '甲书', comment: '控制器_柳川', key: ['柳川'], constant: true, content: '<% getwi(null,"人物资料") %>' },
    { uid: 2, _sw2Source: '甲书', comment: '控制器_岳林', key: ['岳林'], constant: true, content: '<% getwi(null,"人物资料") %>' },
    { uid: 3, _sw2Source: '甲书', comment: '控制器_沈舟', key: ['沈舟'], constant: true, content: '<% getwi(null,"人物资料") %>' },
    { uid: 4, _sw2Source: '甲书', comment: '人物资料', content: '驻防' },
];
const pickControllers = (raw, budget) => composeInitSource({
    worldInfoEntries: raw,
    selection: { version: 2, mode: 'custom', selectedIds: raw.map(entrySelectionId), reads: {} },
    budget,
});
/** 正文里的题名行必须在名册里有对应候选（孤儿行 = 只靠预算外证据撑起来的题名行）。 */
const orphanTitleLines = (result) => result.effectiveEntries.filter(e => e._sw2TitleOnly === true
    && !result.titleRoster.some(d => d.from === e.comment && d.name === e.content));

test('预算外自动控制器的 key 不得给题名自证，同一份正文只许一个名册与指纹', () => {
    const a = pickControllers(CONTROLLER_BUDGET_RAW, 18);
    const b = pickControllers(CONTROLLER_BUDGET_RAW.map(e => e.uid === 2 ? { ...e, key: ['岳林'] } : e), 18);
    // 实际正文一字不差：两条预算外的控制器（岳林/沈舟）只有 key 不同
    assert.equal(a.text, '【控制器_柳川】驻防\n【人物资料】驻防');
    assert.equal(a.text, b.text);
    assert.equal(a.sourceItems.find(s => s.title === '控制器_岳林').status, 'budget-excluded');
    assert.equal(a.sourceItems.find(s => s.title === '控制器_沈舟').status, 'budget-excluded');
    // 柳川 这个名字在本次用料里没有任何来源给它自证（它自己那条的 key 是空的）⇒ 名册必须是空的
    assert.deepEqual(a.titleRoster, [], '预算外控制器的 key 不能给题名自证');
    assert.deepEqual(b.titleRoster, [], '改掉预算外控制器的 key 不许改变名册');
    assert.equal(bookFingerprint(a.text, a.titleRoster), bookFingerprint(b.text, b.titleRoster), '同一份实际用料 ⇒ 同一个书指纹');
    assert.deepEqual(orphanTitleLines(a), [], '正文里不许有只靠预算外证据撑着的题名行');
});

test('全部控制器都是纯技术壳时，预算外的 key 不得改变正文题名行，也不许留孤儿行', () => {
    // 反例夹具（本仓实测抓到）：三条纯技术壳控制器的同族题名行一起争预算——只改**预算外**那条的 key，
    // 旧法就会在正文里换出另一条题名行（`【控制器_岳林】岳林` ↔ `【控制器_柳川】柳川`），两个指纹。
    for (const budget of [12, 18, 22, 26, 30, 34, 38]) {
        const a = pickControllers(TECHNICAL_CONTROLLERS, budget);                                     // 岳林 key=['岳林']
        const b = pickControllers(TECHNICAL_CONTROLLERS.map(e => e.uid === 2 ? { ...e, key: ['岳林', '柳川'] } : e), budget);
        assert.deepEqual(orphanTitleLines(a), [], `budget=${budget}：正文题名行必须都有名册候选`);
        assert.deepEqual(orphanTitleLines(b), [], `budget=${budget}：正文题名行必须都有名册候选`);
        if (a.text !== b.text) continue;      // 正文不同 = 用料不同（下面另有专项：改的必须是预算外来源）
        assert.deepEqual(a.titleRoster, b.titleRoster, `budget=${budget}：正文一样 ⇒ 名册必须一样`);
        assert.equal(bookFingerprint(a.text, a.titleRoster), bookFingerprint(b.text, b.titleRoster), `budget=${budget}：正文一样 ⇒ 指纹必须一样`);
    }
    // 逐字锁住最窄的那一格：18 字只装得下 人物资料 正文一条 ⇒ 三条控制器的题名行一条都不许留
    const a = pickControllers(TECHNICAL_CONTROLLERS, 18);
    const b = pickControllers(TECHNICAL_CONTROLLERS.map(e => e.uid === 2 ? { ...e, key: ['岳林', '柳川'] } : e), 18);
    assert.equal(a.text, '【人物资料】驻防', '同族题名行的证据面已被预算挤空 ⇒ 正文里一条题名行都不留（宁短不假）');
    assert.equal(a.text, b.text, '只改预算外控制器的 key ⇒ 正文一个字都不许变');
    assert.equal(bookFingerprint(a.text, a.titleRoster), bookFingerprint(b.text, b.titleRoster));
    for (const s of a.sourceItems) if (s.title.startsWith('控制器_')) assert.notEqual(s.status, 'effective-title', '被剔掉的题名行不许报成生效题名');
});

// ★★★（Task1 末次复查 · Important 1）：**没有进入最终用料的自动技术控制器不许借 key**。
//   病灶：`keyOnlyExceptions` 那一档把"没有题名行的纯声明壳"的 key 并进名册自证 ⇒ 同一份实际用料
//   （同一个 `text`、同一份 `effectiveEntries`）里，只改一条**根本没进正文**的壳的 key，就能让
//   titleRoster 与书指纹跟着变。作者的 key 自证必须来自**最终用料里真读到的**来源：
//     ① 进了正文的来源；② 其题名行本身进了正文的合法自动控制器例外（题名副本 + key 一起生效）。
//   壳没有进正文（没有题名行、也没有正文副本）⇒ 它的 key 一个字都不许算。
//   ★口径依据（用户已批准）：最终用料即唯一证据面；丢失"未经证实的元数据猜测"是正确的。
test('未进入最终用料的取料壳 key 不得给题名自证，只改它的 key 不许改名册与指纹', () => {
    const people = ['柳川', '岳林', '沈舟'].map((name, i) => ({ uid: i + 1, _sw2Source: '甲书', comment: '人物_' + name, key: [], content: '驻防' }));
    const shell = { uid: 4, _sw2Source: '甲书', comment: '取料壳', constant: true, key: ['柳川', '岳林', '沈舟'], content: "<% getwi(null,'人物_柳川') %>" };
    const pick = (key) => composeInitSource({ worldInfoEntries: [...people, { ...shell, key }],
        selection: { version: 2, mode: 'custom', selectedIds: [...people, shell].map(entrySelectionId), reads: {} }, budget: 30 });
    const a = pick(['柳川', '岳林', '沈舟']);      // 壳的 key 写着三个名字
    const b = pick([]);                            // 只把壳的 key 改成空
    for (const r of [a, b]) {
        const item = r.sourceItems.find(s => s.title === '取料壳');
        assert.equal(item.status, 'technical', '壳清理后没有世界正文 ⇒ 技术态');
        assert.equal(item.readMode, 'auto', '自动读法（题名例外的判据之一）');
        assert.ok(!r.effectiveEntries.some(e => e.comment === '取料壳'), '壳没有题名行也没有正文副本 ⇒ 不许进实际用料');
    }
    assert.equal(a.text, b.text, '只改壳的 key ⇒ 实际正文一个字都不许变');
    assert.deepEqual(a.effectiveEntries.map(e => e.comment), b.effectiveEntries.map(e => e.comment), '实际生效条目一字不差');
    assert.equal(a.text, '【人物_柳川】驻防\n【人物_岳林】驻防\n【人物_沈舟】驻防');
    assert.deepEqual(a.titleRoster, [], '壳没进最终用料 ⇒ 它的 key 不能给题名自证');
    assert.deepEqual(b.titleRoster, [], '只改壳的 key 不许改变名册');
    assert.equal(bookFingerprint(a.text, a.titleRoster), bookFingerprint(b.text, b.titleRoster), '同一份实际用料 ⇒ 同一个书指纹');
});

test('进入正文的合法自动控制器题名的 key 仍是本次用料的证据（正向对照）', () => {
    const raw = [
        { uid: 1, _sw2Source: '甲书', comment: '控制器_柳川', key: ['柳川'], constant: true, content: '<% getwi(null,"人物资料") %>' },
        { uid: 2, _sw2Source: '甲书', comment: '控制器_岳林', key: ['岳林'], constant: true, content: '<% getwi(null,"人物资料") %>' },
        { uid: 3, _sw2Source: '甲书', comment: '控制器_沈舟', key: ['沈舟'], constant: true, content: '<% getwi(null,"人物资料") %>' },
        { uid: 4, _sw2Source: '甲书', comment: '人物资料', key: ['资料'], content: '驻防' },
        { uid: 5, _sw2Source: '甲书', comment: '人物_柳川癸', key: ['柳川癸'], content: '驻防' },
    ];
    const result = pickControllers(raw, 60);
    assert.equal(result.text, '【人物资料】驻防\n【人物_柳川癸】驻防\n【控制器_柳川】柳川\n【控制器_岳林】岳林\n【控制器_沈舟】沈舟',
        '控制器那条题名行真的进了用料 ⇒ 它带的自证 key 算数，同族候选照旧进正文');
    assert.deepEqual(result.titleRoster.map(d => d.name), ['柳川', '岳林', '沈舟'], '控制器那条题名行真的进了正文 ⇒ 它带的自证 key 算数');
    assert.equal(result.sourceItems.find(s => s.title === '控制器_柳川').status, 'effective-title');
    assert.ok(result.effectiveEntries.some(e => e._sw2TitleOnly === true && e.comment === '控制器_柳川'));
    assert.ok(result.effectiveEntries.every(e => String(e.content) !== '<% getwi(null,"人物资料") %>'), '题名例外只带作者自证的名字，不把控制器脚本带进正文');
    assert.deepEqual(orphanTitleLines(result), [], '生效的题名行条条有名册候选');
});
