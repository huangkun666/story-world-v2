// story-world-v2/test/lookup-batch.test.js
// leg25 d（细案 docs/spec-lookup-batch-refresh.md）：查书补全三件套的回归锁。
//   ①force 覆盖（清掉旧 bug 误标的假「书未明述」）②分批**按条目去重**（不是按实体个数——那是错的）
//   ③选人名单补已有原话、未查摆 —（不填占位值）④B6 行定位（定位不到退回整条）
//   ⑤★接线审计：面板产物里每个 data-action 都必须有真实处理器（防"按钮画了没人接"）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    pickOneForLookup, forcedFields, missingFields, planBatches, runBatchLookup, resolveBookSource,
    buildSelectPrompt, ENTITY_LOOKUP_MAX_ATTEMPTS, normalizeToPositionSet,
} from '../src/entity-lookup.js';
import { renderAll, renderEntitiesHtml } from '../src/render.js';
import { characterBookEntries, characterWorldNames, locateNameLine, locateNameSnippet, bookEntryText } from '../web/index.js';

const world = (over = {}) => ({
    version: 1,
    context: {
        world: '测试世界', tension: 0.5, positions: ['未明'], playerId: 'e_p1',
        setting: { frozen: { fingerprint: 'f', extractedAt: 't', canon: { bookEntities: [] } } },
    },
    entities: [
        { id: 'e_p1', kind: 'character', name: '你', location: '未明' },
        { id: 'e_a', kind: 'character', name: '玄一道祖', location: '未明' },
        { id: 'e_b', kind: 'character', name: '吞天妖王', location: '未明' },
    ],
    weights: {}, agendas: [], events: [], chronicle: [], milestones: [],
    meta: { tick: 3, simLog: [] },
    ...over,
});

// ---------- ① force 覆盖 ----------

test('leg25 d：force 能推倒「书未明述」重查（否则旧 bug 误标的假 absent 永远查不动）', () => {
    const w = world();
    // 模拟被旧 bug 误标的现场：两栏都写成 absent
    w.meta.entityFields = { e_a: { attempts: { 实力: { count: 1, state: 'absent' }, 位置: { count: 1, state: 'absent' } }, fields: {}, sources: [] } };
    const e = w.entities.find((x) => x.id === 'e_a');
    // 常规闸：absent 一律跳过（这是设计，不是 bug）
    assert.deepEqual(missingFields(e, w.meta), [], '常规口径下 absent 已定案 → 不查');
    // 覆盖闸：absent 必须能被重查
    assert.deepEqual(forcedFields(e, w.meta), ['实力', '位置'], '★force 必须能覆盖 absent');
    assert.deepEqual(pickOneForLookup(w, 'e_a', { forceFields: 'absent' }).missing, ['实力', '位置']);
    // 重试上限卡住的也要能覆盖
    const w2 = world();
    w2.meta.entityFields = { e_a: { attempts: { 实力: { count: ENTITY_LOOKUP_MAX_ATTEMPTS, state: 'pending' } }, fields: {}, sources: [] } };
    assert.deepEqual(forcedFields(w2.entities[1], w2.meta), ['实力'], '★卡在重试上限的也要能重查');
});

test('leg25 d：force 默认不动「已有值」的栏（除非显式 forceFields=all）', () => {
    const w = world();
    w.entities[1]['实力'] = 'T9渡劫巅峰';                       // 已有值
    w.meta.entityFields = { e_a: { attempts: { 位置: { count: 1, state: 'absent' } }, fields: {}, sources: [] } };
    const e = w.entities[1];
    assert.deepEqual(forcedFields(e, w.meta), ['位置'], '已有值那栏不动（只覆盖 absent）');
    assert.deepEqual(forcedFields(e, w.meta, undefined, { forceFields: 'all' }), ['实力', '位置'], 'forceFields=all 才连已有值一起重查');
});

// ---------- ② 分批：按条目去重（本细案最容易做错的地方） ----------

test('leg25 d：分批按**条目载荷去重**打包，不按实体个数（实测教训：按个数会严重高估调用次数）', async () => {
    const w = world();
    // 三个实体共享同一条 8000 字符的条目（正照：吞天妖王/混元妖圣同属《混乱之地·万妖盟》）
    const shared = { name: '混乱之地·万妖盟', text: 'x'.repeat(8000) };
    const bookText = async (e) => ({ ok: true, entries: [shared] });
    const r = await planBatches({ world: w, ids: ['e_p1', 'e_a', 'e_b'], bookText, budgetChar: 20000 });
    assert.equal(r.batches.length, 1, '★共享条目只算一次载荷 → 全部装进同一批（按实体个数会错分成 3 批）');
    assert.equal(r.totalEntries, 1, '★条目级去重：3 个实体只算 1 条条目');
    assert.equal(r.totalChars, 8000, '载荷 = 条目正文长度，不是 3 倍');
    // 换成互不共享的大条目 → 按预算拆批
    let n = 0;
    const uniq = async () => ({ ok: true, entries: [{ name: `条${n++}`, text: 'y'.repeat(15000) }] });
    const r2 = await planBatches({ world: w, ids: ['e_p1', 'e_a', 'e_b'], bookText: uniq, budgetChar: 20000 });
    assert.equal(r2.batches.length, 3, '互不共享且超预算 → 各占一批');
});

test('leg25 d：分批跳过无需要的实体（已有值/已定案不占批次）', async () => {
    const w = world();
    w.entities[1]['实力'] = 'T9'; w.entities[1]['位置'] = '昆仑山';
    w.meta.entityFields = { e_p1: { attempts: { 实力: { count: 1, state: 'absent' }, 位置: { count: 1, state: 'absent' } }, fields: {}, sources: [] } };
    const r = await planBatches({ world: w, ids: ['e_p1', 'e_a', 'e_b'], bookText: async () => ({ ok: true, entries: [] }) });
    const skippedIds = r.skipped.map((s) => s.id).sort();
    assert.deepEqual(skippedIds, ['e_a', 'e_p1'], 'e_a 两栏都有值、e_p1 两栏已定案 → 都不必查');
    assert.ok(r.batches[0].ids.includes('e_b'), '只有 e_b 真需要查');
});

test('leg25 d：批量查询走通一次并落账（runBatchLookup）', async () => {
    const w = world();
    const transport = async () => '{"玄一道祖":{"实力":"T9渡劫巅峰","位置":"昆仑山"}}';
    const bookText = async () => ({ ok: true, entries: [{ name: '昆仑道宫', text: '- 玄一道祖 (男, T9渡劫巅峰): 人族守护神，居昆仑山。' }] });
    const r = await runBatchLookup({ ssot: w, transport, bookText, ids: ['e_a'], tick: 5 });
    assert.equal(r.stats.ok, 2, '实力+位置都落账');
    assert.equal(r.ssot.entities.find((x) => x.id === 'e_a')['实力'], 'T9渡劫巅峰');
    assert.equal(r.ssot.meta.entityFields.e_a.attempts['实力'].state, 'ok');
});

test('leg25 d：批量里「书没读到」仍然不许写 absent（本轮修的那条红线在批量面同样成立）', async () => {
    const w = world();
    const transport = async () => '{}';
    const r = await runBatchLookup({ ssot: w, transport, bookText: async () => ({ ok: false }), ids: ['e_a'], tick: 5 });
    assert.ok(r.warning && r.warning.includes('取不到'), '读了但没读到 → 出警告');
    const rec = r.ssot.meta.entityFields.e_a;
    assert.ok(!JSON.stringify(rec).includes('absent'), '★批量面也不许写 absent（读不到 ≠ 书里没有）');
    assert.equal(rec.attempts['实力'].state, 'pending', '记 pending，下轮再试');
});

// ---------- ③ 选人可见（只摆已有原话，未查摆 — ） ----------

test('leg25 d：选人名单补上账上已有的实力/位置原话；未查的摆 —（绝不填占位值）', () => {
    const w = world();
    w.entities[1]['实力'] = 'T9渡劫巅峰';
    w.entities[1]['位置'] = '昆仑山玉虚秘境';
    const p = buildSelectPrompt(w);
    assert.ok(p.includes('e_a\t玄一道祖\t角色\tT9渡劫巅峰\t昆仑山玉虚秘境'), '★有值的照抄原话摆出来');
    assert.ok(p.includes('e_b\t吞天妖王\t角色\t—\t—'), '★未查的摆 —，不写 0 / 未知 / 空');
    assert.ok(!/\t(0|未知|null|undefined)\t/.test(p), '不得出现占位值');
    assert.ok(p.includes('书里的原话'), '口径写清：这是原话不是分数');
    // 势力不显示实力（旧口径）
    const w2 = world();
    w2.entities = [{ id: 'e_f', kind: 'faction', name: '万妖盟', location: '南荒', 位置: '南荒', '实力': '三万铁骑' }];
    assert.ok(buildSelectPrompt(w2).includes('e_f\t万妖盟\t势力\t—\t南荒'), '势力行不显示实力（哪怕账上有值）');
});

// ---------- ④ B6 行定位 ----------

test('leg25 d（B6）：按名号定位到它自己那一行；定位不到退回整条', () => {
    const content = [
        '[势力: 万妖盟 (混乱绞肉机/妖修大本营)]',
        '势力所在地: 南荒部洲·十万大山。',
        '核心底蕴: 由不被各大纯血势力接纳的妖修组成。',
        '代表人物:',
        '- 混元妖圣 (男, T9渡劫初期): 精神图腾。',
        '- 吞天妖王 (男, T8大乘中期): 现任盟主(饕餮蛟龙混血)。极度残暴且野心勃勃。',
        '- 金刚猿王 (男, T6化神巅峰): 战王巨头。',
    ].join('\n');
    const line = locateNameLine(content, '吞天妖王');
    assert.ok(line && line.startsWith('- 吞天妖王 (男, T8大乘中期)'), `★定位到它自己那一行：${line}`);
    assert.ok(!line.includes('金刚猿王'), '★只给这一行，不带别人的资料（这正是把载荷降下来的关键）');
    assert.ok(line.includes('T8大乘中期'), '书里的原话在行内');
    // 冒号形也认
    assert.ok(locateNameLine('某甲：T5元婴期，山门执事。', '某甲'), '冒号形标签也认');
    // 定位不到 → null（调用方退回整条，零回归）
    assert.equal(locateNameLine(content, '不存在的人'), null, '定位不到返回 null');
    assert.equal(locateNameLine('', '吞天妖王'), null, '空正文安全');
    // 不许跳过中间文字抓别的括号（v1 同款纪律）
    assert.equal(locateNameLine('吞天妖王 与 金刚猿王 (男, T6化神巅峰) 交战。', '吞天妖王'), null,
        '★名字后不是紧跟括号/冒号 → 不许远距离抓（防抓错成别人）');
});

// ---------- ④b 取原文：定位失败时**不许**退回到被截断的整条（否则 1200 截断风险仍在） ----------

// ★测**真函数** `bookEntryText`（从 web/index.js 导出）。第一版我自带了一份镜像 helper，
//   变异测试把真实现弄坏它照样绿 ⇒ 等于没测。教训：测试不许自带被测逻辑的复制品。
const bookTextOf = (content, name = '吞天妖王', comment = '某条目') => async () => ({
    ok: true,
    entries: [{ name: comment, ...bookEntryText(content, name) }],
});

test('leg25 d：名号描述行在 1200 字符之后时，取原文必须仍能拿到它（否则又是假「书未明述」）', async () => {
    // 用户质疑（2026-09-11）：「你不是按行直接命中吗，那还有 1200 的风险吗」——**有**：
    //   locateNameLine 只认**行首**形态（`- 名号 (…)` / `名号：…`）。若正文把该名号写在段落里
    //   （非行首），定位失败 → 退回 `content.slice(0,1200)` → 描述行落在 1200 之后就被切掉
    //   → 模型在喂进去的原文里找不到它 → 记 absent → **假的「书未明述」**（与旧 bug 同款病）。
    const filler = Array.from({ length: 40 }, (_, i) => `设定条目第${i}行：`.padEnd(40, '畴')).join('\n');   // > 1200 字符
    const tail = '上古秘辛记载：吞天妖王于北荒现身，气息T8大乘中期，无人敢挡。';
    const content = `${filler}\n${tail}`;
    assert.ok(content.indexOf('吞天妖王') > 1200, '前置：该名号确实落在 1200 字符之后');
    // 行首形态定位不到（它不在行首）——这是本用例的前提
    assert.equal(locateNameLine(content, '吞天妖王'), null, '行首形态确实定位不到（段落里的提及）');
    // 取原文：必须仍把含该名号的片段喂出去
    const src = await resolveBookSource(bookTextOf(content), { name: '吞天妖王' });
    assert.ok(src.ok, '书读到了');
    const text = (src.entries[0] || {}).text || '';
    assert.ok(text.includes('吞天妖王'), `★必须命中该名号（否则模型看不到 → 记 absent → 假「书未明述」）：${text.slice(0, 80)}`);
    assert.ok(text.includes('T8大乘中期'), '描述原话在喂出的文本里');
});

test('leg25 d：段落形态提及 → 只喂那一段（不是整条，也不截断丢它）', async () => {
    const filler = Array.from({ length: 40 }, (_, i) => `设定条目第${i}行：`.padEnd(40, '畴')).join('\n');
    const content = `${filler}\n上古秘辛记载：吞天妖王于北荒现身，气息T8大乘中期，无人敢挡。\n另有一段无关记载：某甲某乙。`;
    const src = await resolveBookSource(bookTextOf(content), { name: '吞天妖王' });
    const text = (src.entries[0] || {}).text || '';
    assert.ok(text.length < content.length / 2, '只喂相关那一段，不是整条');
    assert.ok(!text.includes('某甲某乙'), '不带无关段落');
});

test('leg25 d：三档取文本的边界——都不许丢掉该名号，也不许多搬无关段落', () => {
    const name = '吞天妖王';
    // ①行首形态 → 只这一行
    const withLine = '代表人物:\n- 吞天妖王 (男, T8大乘中期): 现任盟主。\n- 金刚猿王 (男, T6化神巅峰): 战王。';
    const a = bookEntryText(withLine, name);
    assert.equal(a.located, 'line');
    assert.ok(a.text.startsWith('- 吞天妖王') && !a.text.includes('金刚猿王'), '行首形态：只给这一行');
    // ②段落形态（行首定位不到）→ 给含它的那一段，且不受 1200 限制
    const long = `${'填充'.repeat(900)}\n上古秘辛：吞天妖王于北荒现身，气息T8大乘中期。\n无关段落：某甲某乙。`;
    assert.ok(long.indexOf(name) > 1200, '前置：名号在 1200 之后');
    assert.equal(locateNameLine(long, name), null, '行首形态确实定位不到');
    const b = bookEntryText(long, name);
    assert.equal(b.located, 'snippet', '★落到段落兜底，而不是"退回截断整条"');
    assert.ok(b.text.includes(name) && b.text.includes('T8大乘中期'), '★名号与描述原话都在');
    // ③正文里根本没有 → 退回截断整条（此时丢它是对的：它确实没出现）
    const none = '甲'.repeat(5000);
    const c = bookEntryText(none, name);
    assert.equal(c.located, 'none');
    assert.equal(c.text.length, 1200, '退回时仍受截断防御约束');
});

test('leg25 d：★测试不许自带被测逻辑（本棒踩过：镜像 helper 让变异测试失去意义）', async () => {
    // 这一条是纪律锁：`bookEntryText` 必须是**从 web/index.js 导出的真函数**，测试直接调它。
    //   第一版我自带了一份镜像 helper，把真实现弄坏它照样绿 ⇒ 等于没测。
    const mod = await import('../web/index.js');
    assert.equal(typeof mod.bookEntryText, 'function', '真实现必须可被测试直接调用（导出）');
    // 真函数必须真的走三档（行首 / 段落 / 兜底），任何一档被摘掉都会在上一条用例里变红
    const src = String(mod.bookEntryText);
    assert.ok(src.includes('locateNameLine') && src.includes('locateNameSnippet'), '两档定位都在真函数体内');
});

// ---------- ⑥ C1：查书的「位置」并入 location（用户拍板「合并吧」） ----------

test('leg25 d（C1）：位置原话归一化到位置集——**取更长者**，集外/歧义不写', () => {
    // 夹具 = 用户真实位置集的前若干项（实测 60 项，父子地名同时存在）
    const POS = ['未明', '九宸玄陆', '十万大山', '四海八荒', '中天神洲', '中州', '西极贺洲',
        '西极昆仑山', '玉虚秘境', '东胜沧洲', '北俱荒洲', '不周山', '南荒部洲', '天机小世界'];
    // ① 原话就是集内一项
    assert.deepEqual(normalizeToPositionSet('中州', POS), { value: '中州', how: 'exact', candidates: ['中州'] });
    // ② 复合写法 → 命中多项时**取最长**（"位置集里最具体的那个地名"）
    const a = normalizeToPositionSet('中天神洲·中州', POS);
    assert.equal(a.value, '中天神洲', `★取最长：${JSON.stringify(a)}`);
    assert.equal(a.how, 'longest');
    const b = normalizeToPositionSet('南荒部洲·十万大山', POS);
    assert.equal(b.value, '十万大山', '★取最长（"十万大山"4字 与 "南荒部洲"4字 并列时按集序，前者先）');
    const c = normalizeToPositionSet('东胜沧洲·青丘狐山秘境', POS);
    assert.equal(c.value, '东胜沧洲', '只命中一项时用它');
    // ③ 集外 → 不写
    const d = normalizeToPositionSet('虚空夹缝·无间棋局', POS);
    assert.equal(d.value, null, '★集外地名不写进 location（引擎不发明地名）');
    assert.equal(d.how, 'none');
    // ⑤ '未明' 是兜底词，**不参与包含匹配**（否则任何含"未明"的串都会命中它）
    assert.equal(normalizeToPositionSet('未明之地', POS).value, null, '兜底词不参与 contains');
    // ⑥ 空值安全
    assert.equal(normalizeToPositionSet('', POS).value, null);
    assert.equal(normalizeToPositionSet('中州', []).value, null);
});

test('leg25 d（C1）：location 只写位置集原有项（唯一断言：不发明地名）', () => {
    const w = world();
    w.context.positions = ['未明', '南荒部洲', '十万大山'];
    const transport = async () => '{"玄一道祖":{"实力":"T8大乘中期","位置":"南荒部洲·十万大山"}}';
    const bookText = async () => ({ ok: true, entries: [{ name: '混乱之地·万妖盟', text: '- 玄一道祖 (男, T8大乘中期): 盟主。所在地: 南荒部洲·十万大山' }] });
    return import('../src/entity-lookup.js').then(async ({ runBatchLookup }) => {
        const r = await runBatchLookup({ ssot: w, transport, bookText, ids: ['e_a'], tick: 7 });
        const e = r.ssot.entities.find((x) => x.id === 'e_a');
        assert.equal(e['位置'], '南荒部洲·十万大山', '原话照抄留档');
        assert.equal(e.location, '十万大山', 'location = 集内更长的那一项');
        assert.ok(w.context.positions.includes(e.location), '★写进去的必须是位置集原有项');
        assert.equal(r.ssot.meta.entityFields.e_a.fields['位置'].位置归一, 'longest');
    });
});

// ---------- ⑤ ★接线审计：画了按钮就必须有人接 ----------
test('leg25 d：面板产物里每个 data-action 都必须有真实处理器（防"按钮画了没人接"）', async () => {
    // 这一条治的是本棒反复踩的那类病：接线断了而测试全绿（异步 bookText / 卡挂世界指针都是这么漏的）。
    const savedW = globalThis.window;
    const savedD = globalThis.document;
    // 最小 DOM 桩：web/index.js 末尾的引导段会问 document.readyState / 加监听——
    //   给个"已就绪"的空壳即可（getCtx 拿不到 ctx 就不进 initPanel，零真 DOM 需求）。
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    globalThis.document = { readyState: 'complete', addEventListener() {}, getElementById: () => null };
    try {
        // ?wiretest：破模块缓存。web/index.js 的动作注册在 `if (typeof window !== 'undefined')` 里，
        //   别的用例可能已在无 window 下导入过它 ⇒ 不破缓存会拿到没注册动作的那份（本用例自己踩过）。
        await import('../web/index.js?wiretest');
        await import('../src/render.js');
        const handlers = new Set(Object.keys(globalThis.window.__sw2Actions || {}));
        assert.ok(handlers.size > 0, '动作总线已注册');
        const w = world();
        w.entities[1]['实力'] = 'T9';           // 触发"重查"按钮出现
        const html = JSON.stringify([
            renderAll(w, { config: { lookupTask: null } }),
            renderEntitiesHtml(w, { config: { lookupTask: { cursor: 3, total: 10, success: 2, pending: 1, absent: 0, failed: 0 } } }),
        ]);
        const actions = [...new Set([...html.matchAll(/data-action=\\?"([a-z0-9-]+)\\?"/g)].map((m) => m[1]))];
        assert.ok(actions.length > 0, '产物里确有 data-action');
        // 两类合法的"不由总线处理"的动作（白名单必须带出处，不许随手加）：
        //   · advance-world：dispatchAction 里特判走 tick 队列（web/index.js:207）
        //   · player-desc  ：**不是按钮而是 textarea**，由 bindSettingsForm 按 id（sw2_player_desc）
        //                    绑 input/change 写入（web/index.js:597-612）——它身上的 data-action 是
        //                    历史残留（无害：点一下只会在状态条闪一句占位提示）。登记为待清小项。
        const NON_BUS = new Set(['advance-world', 'player-desc']);
        const dangling = actions.filter((a) => !handlers.has(a) && !NON_BUS.has(a));
        assert.deepEqual(dangling, [], `★这些动作画了按钮但没有处理器：${dangling.join('、')}`);
        assert.ok(actions.includes('lookup-entity'), '行内「查」在产物里');
        assert.ok(actions.includes('lookup-batch-all'), '批量入口在产物里');
        assert.ok(handlers.has('lookup-entity') && handlers.has('lookup-batch-all'), '★本棒新加的两个入口真的有处理器');
    } finally {
        if (savedW === undefined) delete globalThis.window; else globalThis.window = savedW;
        if (savedD === undefined) delete globalThis.document; else globalThis.document = savedD;
    }
});

test('leg25 d：批量进度与按钮随 config 进面板（渲染层不持任务状态）', () => {
    const w = world();
    const idle = renderEntitiesHtml(w, { config: { lookupTask: null } });
    assert.ok(idle.includes('⬇ 补全全册实力/位置'), '未在跑 → 显示启动按钮');
    assert.ok(idle.includes('data-action="lookup-batch-all"'));
    const running = renderEntitiesHtml(w, { config: { lookupTask: { cursor: 4, total: 623, success: 3, pending: 1, absent: 0, failed: 0 } } });
    assert.ok(running.includes('■ 停止补全 4/623'), '在跑 → 显示停止 + 进度');
    assert.ok(running.includes('补全中 4/623'), '进度行在位');
});
