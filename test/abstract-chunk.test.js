// story-world-v2/test/abstract-chunk.test.js
// 第十八棒：大书分段多调用（v1 范本对齐——设定五件套=头 3 万单发；书名录=全条目分块多调用，
// 拆半自适应 + 失败降级 + 全书级出处校验）。小书（≤3 万）单发行为零变化（abstract.test 基线）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWorldSetting, CANON_SRC_CHAR, ROSTER_CHUNK_CHAR, ROSTER_CHUNK_DEPTH, chunkRows, ATTRS_BATCH_MAX } from '../src/abstract.js';

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

test('大书分块多调用：调用 = 1 次五件套 + 每块 1 次 + 关系轮批量 + 属性轮批量，全量覆盖（尾部名号不丢）', async () => {
    const src = makeBook(2000); // ≈ 42 万字符（含尾部 字 填充）——超 3 万触发分块
    const lenA = Array.from(src).length;
    assert.ok(lenA > CANON_SRC_CHAR, '前置：确为大书');
    const calls = [];
    const r = await extractWorldSetting({ sourceText: src, extract: makeExtract({ calls }), cache: null });
    assert.equal(r.ok, true);
    // 1 次 canon（头 3 万）+ ceil(全量/块) 次名册块调用 + 关系轮批 + 属性轮批（leg21 拆轮 + K49 关系轮）
    assert.ok(calls.length >= 2, `应多次调用（实际 ${calls.length} 次）`);
    const expectChunks = Math.ceil(lenA / ROSTER_CHUNK_CHAR);
    const expectRelation = Math.ceil(2000 / ATTRS_BATCH_MAX);
    const expectAttrs = Math.ceil(2000 / ATTRS_BATCH_MAX);
    assert.equal(calls.length, 1 + expectChunks + expectRelation + expectAttrs, `1 次五件套 + ${expectChunks} 块 + ${expectRelation} 关系批 + ${expectAttrs} 属性批`);
    // 五件套来源 = 头 3 万单发：首个 prompt 的原文段 ≤ 3 万
    const names = r.setting.frozen.canon.bookEntities.map((b) => b.name);
    assert.ok(names.includes('名号1999'), '尾部条目名号全量覆盖（v1 教训：名字密集段不许头截断）');
    assert.equal(new Set(names).size, names.length, '合并去重');
    // 名号顺序 = 书序（k0 在前，k1999 在后）
    assert.equal(names[0], '名号0');
    assert.equal(names[names.length - 1], '名号1999');
    assert.ok(r.setting.frozen.canon.powerScale.length === 1, '五件套仍出自 canon 单发');
});

test('leg21/K49 名册轮 prompt 瘦身：块调用不再问五件套/张力/属性，且模板只剩 {name,kind}', async () => {
    const src = makeBook(200); // ≈ 4.2 万字符 → 大书路径（1 块 + 关系轮 + 属性轮）
    const rosterPrompts = [];
    const extract = async (prompt) => {
        if (prompt.includes('名册抽取器')) rosterPrompts.push(prompt);
        const header = '———— 设定原文如下 ————';
        const part = prompt.includes(header) ? prompt.slice(prompt.indexOf(header) + header.length) : '';
        return JSON.stringify({ bookEntities: parseNames(part) });
    };
    const r = await extractWorldSetting({ sourceText: src, extract, cache: null });
    assert.equal(r.ok, true);
    assert.ok(rosterPrompts.length >= 1, '名册轮确实发起块调用');
    const p = rosterPrompts[0];
    assert.match(p, /不要给它们标 faction/, '种族禁令名单式强化在位（人族/妖族/鬼族…不算势力）');
    // K49 再瘦身锁：模板逐键 = name+kind（隶属/所在/种族移到关系轮）
    const tpl = JSON.parse(p.match(/\{[\s\S]*?\n\}/)[0]);
    assert.deepEqual(Object.keys(tpl.bookEntities[0]), ['name', 'kind'], '名册轮模板只剩 name+kind（瘦身锁）');
    assert.ok(!/"parent"|"race"|"location"/.test(p), '隶属/种族/所在字段不入名册轮（K49 移出到关系轮）');
    assert.ok(!p.includes('powerScale'), '名册轮不再问力量谱系');
    assert.ok(!p.includes('situation'), '名册轮不再问世情句');
    assert.ok(!p.includes('intensity'), '名册轮不再问张力强度');
    assert.ok(!p.includes('依据'), '名册轮不再问属性依据（拆到属性轮）');
    assert.ok(!p.includes('hardPower'), '名册轮不再问四维数值');
});

test('leg21 属性轮：名册后独立批量抽属性 + 依据出处校验 + 合并', async () => {
    const src = makeBook(450); // ≈ 9.5 万字符 → 分块
    const attrCalls = [];
    const extract = async (prompt) => {
        if (prompt.includes('属性抽取器')) {
            attrCalls.push(prompt.length);
            const names = (prompt.split('———— 待抽取属性的名号 ————')[1] || '').split('、').map((s) => s.trim()).filter(Boolean);
            const bookEntities = names.map((name, i) => (i % 2 === 0
                ? { name, attrs: { hardPower: 0.6, office: 0.4, 依据: name } }    // 依据=名号本身 ∈ 原文
                : { name, attrs: { intel: 0.9, 依据: '根本不在书里的句子' } }));  // 依据不在原文 → 弃
            return JSON.stringify({ bookEntities });
        }
        const header = '———— 设定原文如下 ————';
        const part = prompt.includes(header) ? prompt.slice(prompt.indexOf(header) + header.length) : '';
        return JSON.stringify({ bookEntities: parseNames(part) });
    };
    const r = await extractWorldSetting({ sourceText: src, extract, cache: null });
    assert.equal(r.ok, true);
    assert.equal(attrCalls.length, Math.ceil(450 / ATTRS_BATCH_MAX), '属性轮按批上限分拆');
    const es = r.setting.frozen.canon.bookEntities;
    const even = es.find((b) => b.name === '名号0');
    assert.deepEqual(even.attrs, { hardPower: 0.6, office: 0.4 }, '依据在原文 → 属性合并');
    assert.equal(even.evidence, '名号0');
    const odd = es.find((b) => b.name === '名号1');
    assert.equal(odd.attrs, undefined, '依据不在原文 → 属性弃，名号保留');
    assert.ok(r.errors.some((e) => /属性出处校验/.test(e)), '弃置留痕');
});

test('leg21 所在出处校验：所在地不在原文 → 弃+警告；在原文 → 保留（seed 用之）', async () => {
    const rawBook = '大荒世界：宗门林立。昆仑道宫坐镇昆仑山。';
    const r = await extractWorldSetting({
        sourceText: rawBook,
        extract: async () => JSON.stringify({
            bookEntities: [
                { name: '昆仑道宫', kind: 'faction', location: '昆仑山' },
                { name: '万法阁', kind: 'faction', location: '灵脉山' },
            ],
            powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [], tension: {}, env: {},
        }),
        cache: null,
    });
    assert.equal(r.ok, true);
    const es = r.setting.frozen.canon.bookEntities;
    assert.equal(es.find((b) => b.name === '昆仑道宫').location, '昆仑山');
    assert.equal(es.find((b) => b.name === '万法阁').location, undefined, '所在不在原文 → 弃');
    assert.ok(r.errors.some((e) => /所在出处校验/.test(e)));
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