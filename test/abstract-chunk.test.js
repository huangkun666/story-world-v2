// story-world-v2/test/abstract-chunk.test.js
// 第十八棒：大书分段多调用（v1 范本对齐——设定五件套=头 3 万单发；书名录=全条目分块多调用，
// 拆半自适应 + 失败降级 + 全书级出处校验）。小书（≤3 万）单发行为零变化（abstract.test 基线）。
// leg24 片1（停抄书）：关系轮/属性轮调用点已删——大书调用数 = 1 次五件套 + 每块 1 次；
// 并新增两条锁：①两轮 prompt 不许过问书里的上级/所在/属性 ②抄书流水线的函数与常量确实退场（删除位锁）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWorldSetting, CANON_SRC_CHAR, ROSTER_CHUNK_CHAR, ROSTER_CHUNK_DEPTH, chunkRows, buildAbstractPrompt, buildRosterPrompt } from '../src/abstract.js';

// 测试书：k0..k(n-1) 条目行（约 210 字符/条）；名号藏在条目深处（第 3 个词）
function makeBook(n) {
    const rows = [];
    for (let i = 0; i < n; i += 1) {
        rows.push(`【k${i}】名号${i} ` + '字'.repeat(200));
    }
    return rows.join('\n');
}

function parseNames(text) {
    const out = [];
    const re = /【k(\d+)】(\S+)/g;
    let m;
    while ((m = re.exec(text))) out.push({ name: `名号${m[1]}`, kind: 'character' });
    return out;
}

// 确定性 mock：从输入原文里提取名号回填 bookEntities（只提取不创作）；可注入"超过 X 字符即坏"模拟大块失败
function makeExtract({ maxOk = Infinity, calls = null } = {}) {
    const extract = async (prompt) => {
        if (calls) calls.push(prompt.length);
        const header = '———— 设定原文如下 ————';
        const src = prompt.includes(header) ? prompt.slice(prompt.indexOf(header) + header.length) : '';
        if (Array.from(src).length > maxOk) return '这不是 JSON';
        const bookEntities = parseNames(src);
        if (!bookEntities.length) bookEntities.push({ name: '书内无名的世界', kind: 'character' });
        return JSON.stringify({
            powerScale: [{ level: '顶层', note: '主宰一方。' }],
            rules: ['法则一（原文）'],
            society: '社会格局（原文）',
            techOrMagic: '力量体系（原文）',
            historyNotes: ['史略一（原文）'],
            bookEntities,
            tension: { polarity: '正邪', direction: '邪压正' },
            env: {},
        });
    };
    return extract;
}

const EMPTY_CACHE = () => ({ map: new Map(), get(k) { return this.map.get(k) ?? null; }, set(k, v) { this.map.set(k, v); } });

test('chunkRows：行级分块按累计字符，超长单行自成一块', () => {
    const rows = ['a'.repeat(10), 'b'.repeat(10), 'c'.repeat(30)];
    assert.deepEqual(chunkRows(rows, 25), ['a'.repeat(10) + '\n' + 'b'.repeat(10), 'c'.repeat(30)]);
    assert.deepEqual(chunkRows(rows, 100), [rows.join('\n')]);
});

test('大书分块多调用：调用 = 1 次五件套 + 每块 1 次，全量覆盖（尾部名号不丢）', async () => {
    const src = makeBook(2000); // ≈ 42 万字符（含尾部 字 填充）——超 3 万触发分块
    const lenA = Array.from(src).length;
    assert.ok(lenA > CANON_SRC_CHAR, '前置：确为大书');
    const calls = [];
    const r = await extractWorldSetting({ sourceText: src, extract: makeExtract({ calls }), cache: null });
    assert.equal(r.ok, true);
    // 1 次 canon（头 3 万）+ ceil(全量/块) 次名册块调用（leg24 片1：关系轮/属性轮已删，不再有额外调用）
    assert.ok(calls.length >= 2, `应多次调用（实际 ${calls.length} 次）`);
    const expectChunks = Math.ceil(lenA / ROSTER_CHUNK_CHAR);
    assert.equal(calls.length, 1 + expectChunks, `1 次五件套 + ${expectChunks} 块（停抄书后无关系轮/属性轮）`);
    // 五件套来源 = 头 3 万单发：首个 prompt 的原文段 ≤ 3 万
    const names = r.setting.frozen.canon.bookEntities.map((b) => b.name);
    assert.ok(names.includes('名号1999'), '尾部条目名号全量覆盖（v1 教训：名字密集段不许头截断）');
    assert.equal(new Set(names).size, names.length, '合并去重');
    // 名号顺序 = 书序（k0 在前，k1999 在后）
    assert.equal(names[0], '名号0');
    assert.equal(names[names.length - 1], '名号1999');
    assert.ok(r.setting.frozen.canon.powerScale.length === 1, '五件套仍出自 canon 单发');
});

test('leg24 片1 停抄书：名册轮只问 {name,kind}，抽象轮也不过问书里的上级/所在/属性', async () => {
    const src = makeBook(200);
    const rosterPrompts = [];
    const canonPrompts = [];
    const extract = async (prompt) => {
        if (prompt.includes('名册抽取器')) rosterPrompts.push(prompt);
        else canonPrompts.push(prompt);
        const header = '———— 设定原文如下 ————';
        const part = prompt.includes(header) ? prompt.slice(prompt.indexOf(header) + header.length) : '';
        return JSON.stringify({ bookEntities: parseNames(part) });
    };
    const r = await extractWorldSetting({ sourceText: src, extract, cache: null });
    assert.equal(r.ok, true);
    assert.ok(rosterPrompts.length >= 1, '名册轮确实发起块调用');
    const p = rosterPrompts[0];
    assert.match(p, /不要给它们标 faction/, '种族禁令名单式强化在位（人族/妖族/鬼族…不算势力）');
    // 名册轮形状锁（第二十五棒 e 改判据）：v1 的「所属/实力」回归——模板 = 名号+类别 **+ fields 属性组**。
    //   旧锁的漏洞（如实记录）：它只 JSON.parse 模板里**第一个对象**，且只禁 `"parent"` 字面键
    //   ⇒ 新加的 `fields:{所属,实力}` 从缝里漏过，闸门形同没锁。现在按中文锚点切段整段解析、逐键锁死。
    const tplText = p.slice(p.indexOf('形状如下；可省字段不写 null）：') + '形状如下；可省字段不写 null）：'.length, p.indexOf('\n纪律：'));
    const tpl = JSON.parse(tplText);
    assert.deepEqual(Object.keys(tpl.bookEntities[0]), ['name', 'kind'], '第一形态：名号 + 类别');
    const charTpl = tpl.bookEntities.find((x) => x.kind === 'character');
    assert.deepEqual(Object.keys(charTpl.fields), ['所属', '身份', '定位', '实力'], '★角色属性组 = 所属/身份/定位/实力（v1 的 affiliation + power）');
    const facTpl = tpl.bookEntities.find((x) => x.kind === 'faction');
    assert.deepEqual(Object.keys(facTpl.fields), ['性质', '倾向', '规模'], '★势力属性组 = 性质/倾向/规模（规模≠角色档位）');
    assert.match(p, /所属（角色的所属势力）= 必抄项/, '★所属是必抄项，写明"不许推测、不许按常识分配"');
    assert.match(p, /实力（角色的档位）= 必抄项/, '★实力是必抄项（照抄原话、不套别书档位）');
    assert.match(p, /不许套用别的书的档位体系/, '挡"套档位"的那句纪律在位');
    // 仍然不问的东西：四维属性/种族/所在（停抄书口径不倒退——只有「所属/身份/定位/实力」这一组回归）
    assert.ok(!/hardPower|softPower|intel|"attrs"|"race"|"依据"|powerScale|situation|intensity/.test(p), '名册轮仍不问四维属性/种族/力量谱系/世情/张力');
    // leg24 片1 新增锁：抽象轮（五件套轮）同样不许问书里的上级/所在/属性
    assert.equal(canonPrompts.length, 1, '五件套 = 头 3 万单发一次');
    const cp = canonPrompts[0];
    assert.ok(!/"parent"|"race"|"attrs"|"依据"|hardPower|office|"intel"/.test(cp), '抽象轮不问上级/种族/四维属性（停抄书）');
    assert.match(cp, /powerScale/, '力量谱系仍要（它是"查数值时照表取"的原料，不是抄实体）');
    assert.match(cp, /"situation"/, '世情句仍要（当前天下大势一句）');
});

test('leg24 片1：抄书流水线的函数与常量整条退场（删除位锁——防无声复活）', async () => {
    const mod = await import('../src/abstract.js');
    for (const gone of ['buildAttrsPrompt', 'buildRelationPrompt', 'runAttrsRound', 'runRelationRound',
        'validateRosterDetails', 'applyRosterAttrs', 'refineEntityAttrs',
        'ATTRS_BATCH_MAX', 'ROUND_BATCH_CHAR']) {
        assert.equal(mod[gone], undefined, `${gone} 应已删除（停抄书）`);
    }
    for (const kept of ['buildAbstractPrompt', 'buildRosterPrompt', 'extractWorldSetting', 'seedBookEntities',
        'scanBookDeclarations', 'applyDeclaredToRoster', 'resetDynamicLayer']) {
        assert.equal(typeof mod[kept], 'function', `${kept} 仍在（片1 不动它）`);
    }
    // 两条 prompt 的正面口径锁（与上一条测试的"不许问"互补：该问的一个不能少）
    assert.match(buildAbstractPrompt('书文'), /"bookEntities"/, '名号+类别仍抽（账本主键）');
    assert.match(buildRosterPrompt('书文', [{ name: '界渊长城' }]), /界渊长城/, '照书办召回清单仍在');
});

test('小书（≤ 3 万）单发：仅 1 次调用（既有行为零变化）', async () => {
    const src = makeBook(100); // ≈ 2.1 万字符
    const calls = [];
    const r = await extractWorldSetting({ sourceText: src, extract: makeExtract({ calls }), cache: null });
    assert.equal(r.ok, true);
    assert.equal(calls.length, 1);
    assert.ok(r.setting.frozen.canon.bookEntities.some((b) => b.name === '名号99'));
});

test('块失败自适应拆半：大块坏（>50k）→ 对半拆到底仍全量（v1 tryChunk 同款）', async () => {
    const src = makeBook(3000); // ≈ 63 万字符 → 首层 ~11 块，多数 >50k 会触发拆半
    const r = await extractWorldSetting({ sourceText: src, extract: makeExtract({ maxOk: 50000 }), cache: null });
    assert.equal(r.ok, true, '拆半后整体成功');
    const names = r.setting.frozen.canon.bookEntities.map((b) => b.name);
    assert.ok(names.includes('名号2999'), '尾部名号在拆半后仍全量覆盖');
    assert.ok(names.length > 2000, `合并几乎无损（实际 ${names.length} 个名号）`);
});

test('单块彻底失败：降级不阻塞其余块，ok 仍 true 且 errors 带警告', async () => {
    const src = makeBook(2000);
    let calls = 0;
    const extract = async (prompt) => {
        calls += 1;
        const header = '———— 设定原文如下 ————';
        const part = prompt.slice(prompt.indexOf(header) + header.length);
        // 第 2 块（第一次块调用=第 2 次总调用）恒坏：只给首块 10 条以内的输入放行
        if (Array.from(part).length > 200 && calls >= 3 && ROSTER_CHUNK_DEPTH > 0) return '坏块'; // 第 3 次起（第 2 块起）全坏
        return JSON.stringify({ bookEntities: parseNames(part), powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [], tension: {}, env: {} });
    };
    const r = await extractWorldSetting({ sourceText: src, extract, cache: null });
    assert.equal(r.ok, true, '首块成功即可 ok（书名录部分成功不阻塞）');
    assert.ok(r.errors.length >= 1, '降级警告在 errors 中如实可见');
    assert.ok(r.setting.frozen.canon.bookEntities.length > 0);
});

test('全部失败（五件套坏 + 各块坏）：ok=false 世界不动', async () => {
    const src = makeBook(2000);
    const r = await extractWorldSetting({ sourceText: src, extract: makeExtract({ maxOk: 0 }), cache: null });
    assert.equal(r.ok, false);
    assert.ok(r.errors.length >= 1);
});

test('全书级出处校验：原文没出现的名号弃（纯编造才丢，v1 同款）', async () => {
    const src = makeBook(500); // ≈ 10.5 万字符 → 分块
    const extract = async (prompt) => {
        const header = '———— 设定原文如下 ————';
        const part = prompt.slice(prompt.indexOf(header) + header.length);
        const bookEntities = parseNames(part);
        bookEntities.push({ name: '凭空出现的尊者', kind: 'character' }); // 编造
        return JSON.stringify({ bookEntities, powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [], tension: {}, env: {} });
    };
    const r = await extractWorldSetting({ sourceText: src, extract, cache: null });
    assert.equal(r.ok, true);
    const names = r.setting.frozen.canon.bookEntities.map((b) => b.name);
    assert.ok(!names.includes('凭空出现的尊者'), '编造名号被弃');
    assert.ok(r.errors.some((e) => e.includes('出处校验')), '弃置留痕');
});

test('大书缓存命中：零调用（同一本书只抽一次，v1 拍板语义）', async () => {
    const src = makeBook(2000);
    const cache = EMPTY_CACHE();
    const calls = [];
    const first = await extractWorldSetting({ sourceText: src, extract: makeExtract({ calls }), cache });
    assert.equal(first.ok, true);
    const callsAfterFirst = calls.length;
    assert.ok(callsAfterFirst > 1);
    const second = await extractWorldSetting({ sourceText: src, extract: makeExtract({ calls }), cache });
    assert.equal(second.ok, true);
    assert.equal(second.cached, true);
    assert.equal(calls.length, callsAfterFirst, '命中后零新增调用');
});

test('空输出自动重试一次：首调空、二调成功 → ok（v1 瞬时网关空回复教训）', async () => {
    const src = makeBook(50); // 小书单发路径
    let calls = 0;
    const extract = async () => {
        calls += 1;
        if (calls === 1) return '';
        return JSON.stringify({ bookEntities: parseNames(src), powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [], tension: {}, env: {} });
    };
    const r = await extractWorldSetting({ sourceText: src, extract, cache: null });
    assert.equal(r.ok, true);
    assert.equal(calls, 2, '空响应后自动重试一次');
    assert.ok(r.setting.frozen.canon.bookEntities.length > 0);
});

test('两次皆空 → ok=false 且 errors 注明已重试', async () => {
    const r = await extractWorldSetting({ sourceText: makeBook(50), extract: async () => '', cache: null });
    assert.equal(r.ok, false);
    assert.ok(r.errors[0].includes('已重试'), '失败说明带重试语义');
});

test('分块抽取确定性：同输入同 mock 两次产物逐字节一致', async () => {
    const src = makeBook(600); // ≈ 12.6 万字符
    const input = { sourceText: src, extract: makeExtract(), cache: null, extractedAt: '2026-09-09T00:00:00.000Z' };
    const a = await extractWorldSetting(input);
    const b = await extractWorldSetting(input);
    assert.deepEqual(a.setting, b.setting);
    assert.deepEqual(a.errors, b.errors);
});