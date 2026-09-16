// story-world-v2/test/scales-concept-table.test.js
// ★★leg62（用户令「粒度不要太细了，换成概念表怎么样」）：**刻度 · 概念表**全链路判据。
//
// 这一棒治的病（用户截图 · 实教账实测）：`powerScale` 与 `dims` 把
// "强度刻度 / 制度规则 / 基础属性 / 合成分 / 公式"平铺进同一个框 —— 面板「力量谱系（5 档）」
// 把 `S~E级`（一把尺）与 `A班~D班`（**班级分配制度**）摆在一起。
//
// ★本文件的判据形态纪律（照 leg61 §4.1 的血教训）：
//   **不许出现"我在某一本书里看到的词或数字"当判据**。所以下面所有夹具都是**自造记号**
//   （`甲级/乙级/丙级`、`X1/X2`、`Σ` …），不抄三国/大荒/实教的任何档位名——
//   这样"换一套记号照样成立"这条锁才算真的锁住了。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    sanitizeScales, scalesToFlat, scalesFromFlat, resolveScales, parseScaleTier,
    buildScalePrompt, SCALE_SHAPE_OBJ, sanitizeCanon, mergeCanonChunks,
} from '../src/abstract.js';
import { renderSettingHtml } from '../src/render.js';

// 最小世界夹具（够 `renderSettingHtml` 走完设定页；形状照 live-world 精简）
const world = () => ({
    version: 1,
    context: {
        world: '测试世界', tension: 0.5, positions: ['临渊城'],
        setting: {
            frozen: {
                fingerprint: 'fnv1a_test', extractedAt: '2026-09-18T00:00:00Z',
                canon: { powerScale: [], dims: [], rules: [], society: '', techOrMagic: '', historyNotes: [], situation: '' },
                compile: null,
            },
            dynamic: { tension: { polarity: '甲/乙', direction: '甲压乙', intensity: 0.5 }, env: {}, derivedFrom: [] },
        },
    },
    entities: [], weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0 },
});

// ───────────────────────── ① 净化层：紧凑串 / 出处闸 / 同名合表 / 子表 / 维度 ─────────────────────────
test('★leg62 净化：紧凑档位串 `档|注` 解回 {档,注}（用户令「紧凑序列化」）', () => {
    assert.deepEqual(parseScaleTier('甲级|最高一档'), { 档: '甲级', 注: '最高一档' });
    assert.deepEqual(parseScaleTier('甲级'), { 档: '甲级', 注: '' }, '没有分隔符 ⇒ 只有档位名，注留空');
    assert.deepEqual(parseScaleTier('甲级|上|下'), { 档: '甲级', 注: '上|下' }, '★只在第一个分隔符处切（注里自带竖线不许被切坏）');
    assert.deepEqual(parseScaleTier('甲级｜全角分隔'), { 档: '甲级', 注: '全角分隔' }, '全角竖线也吃（模型偶尔吐全角）');
    assert.equal(parseScaleTier('   '), null, '空串丢');
    assert.equal(parseScaleTier('|只有注'), null, '档位名空 ⇒ 丢（不许造一条没名字的档位）');
    // 标准形状（对象项）也吃——两种形状都能进，模型按哪种交都不会静默消失
    assert.deepEqual(parseScaleTier({ 档: '甲级', 注: '最高一档' }), { 档: '甲级', 注: '最高一档' });
});

test('★leg62 净化：档位名过**出处闸**（原文找不到即丢并留痕）；**表名不过**（允许描述性标题）', () => {
    const src = '甲级 最强。乙级 次强。';
    const errors = [];
    const out = sanitizeScales([
        // 表名 `自造概念表名` **不在**原文里 ⇒ 仍要收下（它就是"这把尺叫什么"，可以是描述性标题）
        { 名: '自造概念表名', 用途: '分级', 档位: ['甲级|最强', '乙级|次强', '丙级|编的（原文没有）'] },
    ], { sourceText: src }, errors);
    assert.equal(out.length, 1, '表名是描述性标题 ⇒ 收下');
    assert.deepEqual(out[0].档位.map((x) => x.档), ['甲级', '乙级'], '★原文里查得到的档位留下、编的丢掉');
    assert.ok(errors.some((e) => /丙级/.test(e) && /原文查不到/.test(e)), '★丢掉的不许静默（留痕）');
});

test('★leg62 净化：**同名表跨项合并**（同一把尺分几处写，不许拆成两张）', () => {
    const src = '甲级 一。乙级 二。丙级 三。';
    const out = sanitizeScales([
        { 名: '同一把尺', 用途: '分级', 档位: ['甲级|一'] },
        { 名: '同一把尺', 档位: ['乙级|二', '丙级|三'] },   // 第二项没写用途
    ], { sourceText: src }, []);
    assert.equal(out.length, 1, '同名 ⇒ 一张表（不是两张）');
    assert.deepEqual(out[0].档位.map((x) => x.档), ['甲级', '乙级', '丙级'], '档位并集、保持先后');
    assert.equal(out[0].用途, '分级', '用途取先有值的那一项（不合成、不拼接）');
});

test('★leg62 净化：缺「名」的表整张弃（留痕）· 空表弃 · 子表与维度都收', () => {
    const src = 'X1 一。X2 二。初 三。属性甲 是。';
    const errors = [];
    const out = sanitizeScales([
        { 用途: '没有表名', 档位: ['X1|一'] },                        // 缺名 ⇒ 弃
        { 名: '甲表', 档位: [] },                                      // 空表 ⇒ 弃
        {
            名: '乙表', 用途: '分级',
            档位: ['X1|一', 'X2|二'],
            子表: [{ 名: '细分', 档位: ['初|三'] }],
            维度: [{ 名: '属性甲', 范围: 'X1' }],
        },
    ], { sourceText: src }, errors);
    assert.deepEqual(out.map((t) => t.名), ['乙表'], '缺名的弃、空表的弃');
    assert.ok(errors.some((e) => /缺 名/.test(e)), '缺名要留痕');
    assert.deepEqual(out[0].子表[0].档位.map((x) => x.档), ['初'], '★子表收下（用户拍「当子表」）');
    assert.deepEqual(out[0].维度.map((d) => d.名), ['属性甲'], '维度收下');
});

// ───────────────────────── ② 派生：概念表 ↔ 旧两列（一处生产、两处消费） ─────────────────────────
test('★leg62 scalesToFlat：概念表 → 旧两列（下游读的就是这两列，不许出现第二份真相）', () => {
    const flat = scalesToFlat([
        { 名: '甲表', 档位: [{ 档: 'X1', 注: '一' }, { 档: 'X2', 注: '二' }], 维度: [{ 名: '属性甲', 范围: 'X1' }] },
        { 名: '乙表', 档位: [{ 档: 'Y1', 注: '三' }], 子表: [{ 名: '细分', 档位: [{ 档: '细1', 注: '细' }] }] },
    ]);
    assert.deepEqual(flat.powerScale.map((x) => x.level), ['X1', 'X2', 'Y1', '细1'], '★子表的档位也进旧列（否则下游看不到它们）');
    assert.deepEqual(flat.dims, [{ name: '属性甲', range: 'X1' }], '维度照样派生');
    // 同名档位只出一条（跨表去重，防同一档在旧列里存两份）
    const dup = scalesToFlat([{ 名: 'A', 档位: [{ 档: 'X1', 注: '一' }] }, { 名: 'B', 档位: [{ 档: 'X1', 注: '又说一遍' }] }]);
    assert.equal(dup.powerScale.length, 1, '同名档位只保留第一条');
    // 注缺省时用档位名兜底（旧契约要求 note 必填非空）
    const noNote = scalesToFlat([{ 名: 'A', 档位: [{ 档: 'X1' }] }]);
    assert.equal(noNote.powerScale[0].note, 'X1', 'note 缺省 ⇒ 用档位名兜底（旧契约 note 必填非空）');
});

test('★leg62 scalesFromFlat（旧账零迁移）：档位按记号前缀归组、回指档位名的维度挂同一张表、游离维度合一张', () => {
    const tables = scalesFromFlat({
        powerScale: [
            { level: 'X1', note: '一' }, { level: 'X2', note: '二' }, { level: 'X3', note: '三' },
            { level: '甲等', note: '甲' }, { level: '乙等', note: '乙' },
        ],
        dims: [
            { name: '属性甲', range: 'X1' },   // ★回指档位名 X1 ⇒ 挂进 X 记号那张表
            { name: '游离甲', range: '0~9' },  // 回指不到 ⇒ 合进《维度》
            { name: '游离乙', range: '0~9' },
        ],
    });
    const names = tables.map((t) => t.名);
    assert.ok(names.includes('X1'), '★X1/X2/X3 同一记号 ⇒ 归成一张表（组名取该组第一条档位名）');
    assert.ok(names.includes('无记号档位'), '★甲等/乙等无数字记号 ⇒ 合进《无记号档位》一张表');
    assert.ok(names.includes('维度'), '★回指不到档位名的维度合进《维度》一张表（不是一张维度一张表）');
    const xTable = tables.find((t) => t.名 === 'X1');
    assert.deepEqual(xTable.档位.map((x) => x.档), ['X1', 'X2', 'X3']);
    assert.deepEqual(xTable.维度.map((d) => d.名), ['属性甲'], '★回指它的维度挂在同一张表里');
    assert.equal(tables.find((t) => t.名 === '维度').维度.length, 2, '两个游离维度合一张表');
});

test('★leg62 resolveScales：新账读 `刻度`、旧账纯函数推导（两条来源，优先级明确）', () => {
    const fresh = { 刻度: [{ 名: '新账表', 档位: [{ 档: 'X1' }] }], powerScale: [{ level: '旧列', note: '不该被读' }], dims: [] };
    assert.deepEqual(resolveScales(fresh).map((t) => t.名), ['新账表'], '★有 `刻度` ⇒ 以它为准（旧两列不参与）');
    const legacy = { powerScale: [{ level: 'X1', note: '一' }], dims: [{ name: '属性甲', range: 'X1' }] };
    assert.deepEqual(resolveScales(legacy).map((t) => t.名), ['X1'], '★无 `刻度` ⇒ 纯函数推导（零迁移）');
    assert.deepEqual(resolveScales(null), [], '空 canon ⇒ 空表（不发明）');
    assert.deepEqual(resolveScales({}), [], '空对象 ⇒ 空表');
});

test('★leg62 resolveScales 顺序：**带档位的表在前**、组内保持书序（进包顺次截断靠它）', () => {
    const tables = resolveScales({
        powerScale: [{ level: '游离先出现', note: '甲' }, { level: 'X1', note: '一' }],
        dims: [{ name: '游离甲', range: '0~9' }],   // 先出现的游离维度
    });
    // 游离维度那张表在 dims 里先出现，但**带档位的表必须排在它前面**（否则表数名额被它先占掉）
    assert.equal(tables[0].档位?.length > 0, true, '★第一张必须是带档位的表');
    assert.equal(tables.at(-1).名, '维度', '★只有维度的表排最后');
});

// ───────────────────────── ③ 契约接线：sanitizeCanon 与 mergeCanonChunks ─────────────────────────
test('★leg62 sanitizeCanon：交了 `刻度` ⇒ 以它为源、旧两列由它**派生**（一处生产两处消费）', () => {
    const src = 'X1 一。属性甲 是。';
    const r = sanitizeCanon({
        刻度: [{ 名: '甲表', 用途: '分级', 档位: ['X1|一'], 维度: [{ 名: '属性甲', 范围: 'X1' }] }],
        // 故意同时交旧两列（老提示词残留/模型手滑）：**不许**让它变成第二份真相
        powerScale: [{ level: '旧列档位', note: '旧列注' }],
        dims: [{ name: '旧列维度', range: '0~1' }],
    }, { sourceText: src });
    assert.equal(r.ok, true);
    assert.deepEqual(r.canon.刻度.map((t) => t.名), ['甲表'], '概念表收下');
    assert.deepEqual(r.canon.powerScale.map((x) => x.level), ['X1'], '★旧列由概念表派生（不是把模型交的旧列原样收下）');
    assert.deepEqual(r.canon.dims.map((d) => d.name), ['属性甲'], '★维度同理');
    assert.ok(r.present.includes('刻度'), 'present 登记"这一块真交了刻度"');
    // 没交 `刻度` 的老形状 ⇒ 旧两列照旧收（旧账/老提示词零扰动）
    const old = sanitizeCanon({ powerScale: [{ level: 'X1', note: '一' }], dims: [{ name: '属性甲', range: 'X1' }] }, { sourceText: src });
    assert.equal(old.canon.刻度, undefined, '没交 ⇒ `刻度` 键不出现（不是空数组）');
    assert.deepEqual(old.canon.powerScale.map((x) => x.level), ['X1'], '★老形状照旧收（向后兼容）');
});

test('★leg62 mergeCanonChunks：跨块同一把尺**合成一张表**（不许因为出处不同就拆成两张）', () => {
    const merged = mergeCanonChunks([
        { canon: { 刻度: [{ 名: '同一把尺', 用途: '分级', 档位: [{ 档: 'X1', 注: '一' }] }], powerScale: [], dims: [] } },
        { canon: { 刻度: [{ 名: '同一把尺', 档位: [{ 档: 'X2', 注: '二' }], 维度: [{ 名: '属性甲', 范围: 'X1' }] }], powerScale: [], dims: [] } },
    ]);
    assert.equal(merged.canon.刻度.length, 1, '★跨块同名 ⇒ 一张表（这正是"同一把尺散布在书里几处"的治法）');
    assert.deepEqual(merged.canon.刻度[0].档位.map((x) => x.档), ['X1', 'X2'], '档位并集');
    assert.equal(merged.canon.刻度[0].用途, '分级', '用途取先有值的那块');
    assert.deepEqual(merged.canon.刻度[0].维度.map((d) => d.名), ['属性甲'], '维度并集');
    // 旧列由概念表派生（与 sanitizeCanon 同一条口径）
    assert.deepEqual(merged.canon.powerScale.map((x) => x.level), ['X1', 'X2']);
    // 都没交刻度 ⇒ 旧路径逐字不变
    const legacy = mergeCanonChunks([{ canon: { powerScale: [{ level: 'X1', note: '一' }], dims: [] } }]);
    assert.equal(legacy.canon.刻度, undefined, '没交 ⇒ 键不出现');
    assert.deepEqual(legacy.canon.powerScale.map((x) => x.level), ['X1']);
});

// ───────────────────────── ⑤ 新入口：直抽刻度的按钮与接线（防"按钮画了没人接"） ─────────────────────────
//   ★这一条是本仓最贵的那类洞的病历（leg25 f：机制建好了、接线从没生效、测试全绿）⇒ 必须锁**接线**，
//     不是锁"函数写好了"。三面各锁一条：按钮在位 / 处理器注册在总线 / 生产源码真的绑上了那两样。
test('★leg62 直抽刻度（用户令「独立抽取设定的入口」）：按钮在位 + 处理器注册在总线 + 生产源码接线在位', async () => {
    const savedW = globalThis.window;
    const savedD = globalThis.document;
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    globalThis.document = { readyState: 'complete', addEventListener() {}, getElementById: () => null };
    try {
        // `?wirescales`：破模块缓存（同 lookup-batch 那条的理由——动作注册在 `typeof window !== 'undefined'` 里，
        //   别的用例可能已在无 window 下导入过它）
        await import('../web/index.js?wirescales');
        const bus = globalThis.window.__sw2Actions || {};
        assert.equal(typeof bus['extract-scales'], 'function', '★直抽刻度的处理器注册在动作总线上（不是只画了个按钮）');
        assert.equal(typeof bus['clear-scale-draft'], 'function', '★清草稿那一栏也有处理器');
    } finally {
        globalThis.window = savedW;
        globalThis.document = savedD;
    }
    // 按钮在位（真渲染一次，逐字断言——不许是空绿）
    const w = world();
    const html = renderSettingHtml(w);
    assert.match(html, /data-action="extract-scales"/, '★「只抽刻度」按钮在设定页');
    assert.match(html, /只抽刻度/, '按钮文案是人话（零引擎术语）');
    // 草稿栏：放了草稿才画，且如实报"被出处闸丢掉的档位数"
    const withDraft = world();
    withDraft.context.__scaleDraft = {
        at: 'now', source: '测试书', secs: 12.3, calls: 1,
        scales: [{ 名: '甲表', 用途: '分级', 档位: [{ 档: 'X1', 注: '一' }], 维度: [{ 名: '属性甲', 范围: 'X1' }] }],
        dropped: 2, errors: ['刻度《甲表》档位「编的」原文查不到（已弃）'],
    };
    const dHtml = renderSettingHtml(withDraft);
    assert.match(dHtml, /直抽刻度 · 本次结果（未入账）/, '★草稿栏在位');
    assert.match(dHtml, /《甲表》<span class="sw2-hint"> · 分级<\/span>/, '草稿按概念表分栏');
    assert.match(dHtml, /<b>2<\/b> 条档位因"原文里找不到"被丢/, '★被出处闸丢掉的不许静默（如实报数）');
    assert.match(dHtml, /data-action="clear-scale-draft"/, '草稿栏带清除按钮');
    assert.ok(!dHtml.includes('**'), '★渲染产物不许含 markdown 星号（面板是 HTML）');
    assert.ok(!renderSettingHtml(world()).includes('直抽刻度 · 本次结果'), '没有草稿 ⇒ 不画那一栏（零扰动）');
});

test('★leg62 直抽通道的提示词在生产源码里真的被用上（防"函数写好了、没人调"）', () => {
    const web = readFileSync(new URL('../web/index.js', import.meta.url), 'utf8');
    assert.match(web, /buildScalePrompt\(/, '★web 接线真的调了 buildScalePrompt');
    assert.match(web, /sanitizeScales\(/, '★web 接线真的调了 sanitizeScales（档位出处闸在直抽通道里也生效）');
    assert.match(web, /__scaleDraft/, '★草稿落在会话态字段上（结果不入账）');
    // 直抽**一次调用**（不走名册遍/属性遍）——用户要的就是"快"
    assert.ok(!/extractWorldSetting\(/.test(web.slice(web.indexOf("bus['extract-scales']"), web.indexOf("bus['clear-scale-draft']"))),
        '★直抽通道不许顺手跑整条抽取管线（那就不是"快速看效果"了）');
});

test('★leg62 提示词：直抽通道的提示词带概念表形状，且与生产共用同一份形状定义', () => {
    const p = buildScalePrompt('【测试】X1 一。');
    assert.match(p, /一把尺 = 一张表/, '概念表定义在位');
    assert.match(p, /不同的概念\*\*必须分开成不同的表/, '★"制度与刻度必须分表"在位（用户截图那个混排的根治）');
    assert.match(p, /紧凑：不要缩进、不要换行/, '★紧凑口径在位（真机实测：原预算下就 finish_stop，输出短 44%）');
    assert.match(p, /设定原文如下/, '原文分隔线与生产同款');
    // ★形状**一处定义**：直抽提示词里的形状必须就是 SCALE_SHAPE_OBJ 那一个（各写一份 ⇒ 改一处忘一处）
    assert.ok(p.includes(JSON.stringify(SCALE_SHAPE_OBJ)), '★形状与 SCALE_SHAPE_OBJ 逐字一致（两处共用一份定义）');
});
