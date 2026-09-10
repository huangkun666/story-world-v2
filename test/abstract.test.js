// story-world-v2/test/abstract.test.js
// K31/双流 UI：抽象管线执行器（细案 A-6/A-7）——指纹缓存零调用 / 书变重抽 / force 重抽 /
// 净化（形状合法为止、无数量约束取全、intensity 不许模型拍）/ 落账形状过 K24 schema。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { bookFingerprint, createCache } from '../src/fingerprint.js';
import { ENV_KEYS } from '../src/entropy.js';
import {
    buildAbstractPrompt,
    sanitizeCanon,
    assembleSetting,
    extractWorldSetting,
    applySettingToSsot,
    applyRosterAttrs,
    refineEntityAttrs,
    resetDynamicLayer,
    ENV_INIT_BASELINE,
    TENSION_INIT_BASELINE,
} from '../src/abstract.js';

const BOOK = '大荒世界：宗门林立。灵脉有主，煞气为祸。……力量分五等：凝煞、化神、元婴、金丹、炼气。';

const FULL_RAW = {
    powerScale: [
        { level: '凝煞', note: '宗师，镇一方煞气' },
        { level: '元婴', note: '大宗，可开宗立派' },
        { level: '炼气', note: '修士，江湖底子' },
    ],
    rules: ['灵脉契书为官府所辖', '煞气须以灵脉镇压'],
    society: '宗门林立，大荒无主',
    techOrMagic: '灵脉与煞气相生相克',
    historyNotes: ['太岁陨落北山', '洗煞阵立'],
    tension: { polarity: '宗门/朝廷', direction: '宗门压朝廷', intensity: 0.99 },
    env: { 民生度: 0.7, 动乱度: -0.2, 天时: 1.5, 张力推手: 0.44 },
};

const fakeExtract = (value) => async () => (typeof value === 'string' ? value : JSON.stringify(value));

function baseWorld() {
    return {
        version: 1,
        context: { world: '临渊城', tension: 0.6, positions: ['临渊城'] },
        entities: [{ id: 'e1', kind: 'faction', name: 'A', location: '临渊城', attrs: {} }],
        weights: {},
        agendas: [],
        events: [],
        chronicle: [],
        meta: { tick: 1 },
    };
}

test('K31 提示词：只提取不创作的铁律 + 五件套 + 无数量约束 + 原文分隔，均显式入 prompt', () => {
    const p = buildAbstractPrompt(BOOK);
    assert.match(p, /只提取/);
    assert.match(p, /不创作/);
    assert.match(p, /取全不取量/);
    assert.match(p, /powerScale/);
    assert.match(p, /historyNotes/);
    assert.match(p, /—— 设定原文如下 ——/);
    assert.ok(p.includes(BOOK));
    assert.equal(buildAbstractPrompt(BOOK), buildAbstractPrompt(BOOK)); // 确定性
});

test('K31 抽取全链：净化 + 落账 + 无数量约束取全 + env 钳制 + intensity 不许模型拍', async () => {
    let calls = 0;
    const r = await extractWorldSetting({
        sourceText: BOOK,
        extract: async () => { calls += 1; return JSON.stringify(FULL_RAW); },
        extractedAt: '2026-09-08T10:00:00Z',
        legacyTension: 0.6,
    });
    assert.equal(r.ok, true);
    assert.equal(r.cached, false);
    assert.equal(r.fingerprint, bookFingerprint(BOOK));
    const s = r.setting;
    assert.equal(s.frozen.fingerprint, bookFingerprint(BOOK));
    assert.equal(s.frozen.extractedAt, '2026-09-08T10:00:00Z');
    assert.equal(s.frozen.canon.powerScale.length, 3);          // 取全
    assert.equal(s.frozen.canon.rules.length, 2);
    assert.equal(s.frozen.canon.historyNotes.length, 2);
    // intensity：legacy 0.6 优先，模型 0.99 被丢弃
    assert.equal(s.dynamic.tension.intensity, 0.6);
    assert.equal(s.dynamic.tension.polarity, '宗门/朝廷');
    assert.equal(s.dynamic.tension.direction, '宗门压朝廷');
    // env：钳制 + 基线
    assert.equal(s.dynamic.env['民生度'], 0.7);
    assert.equal(s.dynamic.env['动乱度'], 0);
    assert.equal(s.dynamic.env['天时'], 1);
    assert.equal(s.dynamic.env['张力推手'], 0.44);
    assert.deepEqual(Object.keys(s.dynamic.env).sort(), [...ENV_KEYS].sort());
    assert.deepEqual(s.dynamic.derivedFrom, []);
    assert.equal(calls, 1);
});

test('K31 无 legacy tension：强度初值 = 基线 0.5（引擎算的前置，模型拍不了）', async () => {
    const r = await extractWorldSetting({ sourceText: BOOK, extract: fakeExtract(FULL_RAW), legacyTension: undefined });
    assert.equal(r.setting.dynamic.tension.intensity, TENSION_INIT_BASELINE);
});

test('K31 env 缺省/非法键：一律落基线；表外键不入 env', async () => {
    const r = await extractWorldSetting({
        sourceText: BOOK,
        extract: fakeExtract({ rules: ['只有一条法则'], env: { 民生度: 0.5, '异想天开键': 0.9 } }),
    });
    assert.equal(r.setting.dynamic.env['民生度'], 0.5);
    assert.equal(r.setting.dynamic.env['动乱度'], ENV_INIT_BASELINE);
    assert.equal(r.setting.dynamic.env['天时'], ENV_INIT_BASELINE);
    assert.equal(r.setting.dynamic.env['张力推手'], ENV_INIT_BASELINE);
    assert.ok(!('异想天开键' in r.setting.dynamic.env)); // 键表白名单（定案 #3）
});

test('K31 指纹命中零调用：同文本二次抽取不发调用，命中值深拷贝互不污染', async () => {
    const cache = createCache();
    let calls = 0;
    const extract = async () => { calls += 1; return JSON.stringify(FULL_RAW); };
    const first = await extractWorldSetting({ sourceText: BOOK, extract, cache, extractedAt: 't1' });
    assert.equal(first.cached, false);
    const second = await extractWorldSetting({ sourceText: BOOK, extract, cache, extractedAt: 't2' });
    assert.equal(second.cached, true);
    assert.equal(second.setting.frozen.extractedAt, 't1'); // 命中返回原抽取时间
    assert.equal(calls, 1);
    second.setting.frozen.canon.rules.push('污染');
    const third = await extractWorldSetting({ sourceText: BOOK, extract, cache });
    assert.equal(third.setting.frozen.canon.rules.length, 2); // 缓存本体未被污染
});

test('K31 书变自动失效：文本一变指纹即变 → 重新抽取', async () => {
    const cache = createCache();
    let calls = 0;
    const extract = async () => { calls += 1; return JSON.stringify(FULL_RAW); };
    await extractWorldSetting({ sourceText: BOOK, extract, cache });
    await extractWorldSetting({ sourceText: BOOK + '（书有新条目）', extract, cache });
    assert.equal(calls, 2);
});

test('K31 force 重抽：同文本跳过命中强制抽取，缓存旧条目被覆盖（旧产物作废）', async () => {
    const cache = createCache();
    let calls = 0;
    const extract = async () => { calls += 1; return JSON.stringify(FULL_RAW); };
    await extractWorldSetting({ sourceText: BOOK, extract, cache, extractedAt: 't-old' });
    const forced = await extractWorldSetting({ sourceText: BOOK, extract, cache, force: true, extractedAt: 't-new' });
    assert.equal(forced.cached, false);
    assert.equal(calls, 2);
    assert.equal(forced.setting.frozen.extractedAt, 't-new');
    const again = await extractWorldSetting({ sourceText: BOOK, extract: () => { calls += 1; return ''; }, cache });
    assert.equal(again.cached, true);
    assert.equal(again.setting.frozen.extractedAt, 't-new'); // 新产物在缓存
    assert.equal(cache.size(), 1);
});

test('K31 失败软着陆：调用抛错 / 空输出 / 非法 JSON / 非对象 / 无 extract → ok:false 带 errors', async () => {
    const boom = await extractWorldSetting({ sourceText: BOOK, extract: async () => { throw new Error('网络断了'); } });
    assert.equal(boom.ok, false);
    assert.match(boom.errors[0], /抽取调用失败/);

    const empty = await extractWorldSetting({ sourceText: BOOK, extract: async () => '' });
    assert.equal(empty.ok, false);

    const badJson = await extractWorldSetting({ sourceText: BOOK, extract: async () => '{oops' });
    assert.equal(badJson.ok, false);
    assert.match(badJson.errors[0], /非法 JSON/);

    const nonObj = await extractWorldSetting({ sourceText: BOOK, extract: async () => '[1,2]' });
    assert.equal(nonObj.ok, false);

    const noFn = await extractWorldSetting({ sourceText: BOOK, cache: createCache() });
    assert.equal(noFn.ok, false);
    assert.match(noFn.errors[0], /抽取调用/);
});

test('K31 净化逐项取好弃坏：坏项弃置记 errors，好项全保留（净化到形状合法为止）', () => {
    const cleaned = sanitizeCanon({
        powerScale: [{ level: '筑基', note: 'x' }, null, { level: '', note: 'y' }, { note: '缺 level' }],
        rules: ['好法则', null, '  '],
        society: 42,
        historyNotes: ['史一', ''],
        tension: { polarity: 'A/B', intensity: 0.8 },
    });
    assert.equal(cleaned.ok, true);
    assert.equal(cleaned.canon.powerScale.length, 1);
    assert.equal(cleaned.canon.rules.length, 1);
    assert.equal(cleaned.canon.society, '');
    assert.equal(cleaned.canon.historyNotes.length, 1);
    assert.ok(cleaned.errors.length >= 5);
    assert.equal(cleaned.tension.intensity, undefined); // 模型侧 intensity 不在净化结果里
});

test('K31 落账形状过 K24 schema：applySettingToSsot 后世界全量合法；空 canon 亦合法', async () => {
    const r = await extractWorldSetting({ sourceText: BOOK, extract: fakeExtract(FULL_RAW), legacyTension: 0.6 });
    const doc = applySettingToSsot(baseWorld(), r.setting);
    const checked = validate(doc, ssotSchema);
    assert.equal(checked.ok, true, checked.errors.join('; '));

    const emptyDoc = applySettingToSsot(baseWorld(), assembleSetting({
        canon: { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [] },
        tension: { polarity: '', direction: '' },
        env: {},
        fingerprint: 'fnv1a_x_1',
        extractedAt: 't',
        legacyTension: undefined,
    }));
    const checked2 = validate(emptyDoc, ssotSchema);
    assert.equal(checked2.ok, true, checked2.errors.join('; '));
    assert.equal(emptyDoc.context.setting.dynamic.tension.polarity, '未聚'); // 引擎状态词兜底（非模型创作）
});

test('leg20 世情路径：situation 净化与落账（原文措辞；非法置空）', async () => {
    const r = await extractWorldSetting({
        sourceText: BOOK,
        extract: fakeExtract({ ...FULL_RAW, situation: '宗门压朝廷，煞祸渐起' }),
    });
    assert.equal(r.setting.frozen.canon.situation, '宗门压朝廷，煞祸渐起');
    const bad = sanitizeCanon({ situation: 42 });
    assert.equal(bad.canon.situation, '');
    assert.ok(bad.errors.some((e) => /situation/.test(e)));
    const none = sanitizeCanon({});
    assert.equal(none.canon.situation, '', '缺省=空串合法');
});

test('leg20 属性出处校验：依据不在原文 → 属性弃+警告；依据在原文 → attrs+evidence 落账', async () => {
    const rawBook = '万法阁：灵脉霸主，掌大荒灵脉。白小娥：炼气三层。';
    const withAttrs = {
        ...FULL_RAW,
        bookEntities: [
            { name: '万法阁', kind: 'faction', attrs: { hardPower: 0.9, office: 0.8, 依据: '灵脉霸主' } },
            { name: '白小娥', kind: 'character', attrs: { hardPower: 0.3, 依据: '无此书证' } },
            { name: '无据客', kind: 'character', attrs: { intel: 0.6 } },
        ],
    };
    const r = await extractWorldSetting({ sourceText: rawBook, extract: fakeExtract(withAttrs) });
    assert.equal(r.ok, true);
    const es = r.setting.frozen.canon.bookEntities;
    const wf = es.find((b) => b.name === '万法阁');
    assert.deepEqual(wf.attrs, { hardPower: 0.9, office: 0.8 });
    assert.equal(wf.evidence, '灵脉霸主');
    const xie = es.find((b) => b.name === '白小娥');
    assert.equal(xie.attrs, undefined, '依据不在原文 → 属性弃，名号保留');
    assert.equal(xie.evidence, undefined);
    const noEv = es.find((b) => b.name === '无据客');
    assert.equal(noEv.attrs, undefined, '无依据 → 属性弃（净化层）');
    assert.ok(r.errors.some((e) => /属性出处校验/.test(e)));
});

test('leg20 种族标签出处校验 + attrs 净化形状（钳制/非对象/缺依据）', async () => {
    // 出处（书级）：种族名必须在原文出现；种族名号不被强制清出（提示词约束为主，引擎只守诚实底线）
    const rawBook = '妖族占据北荒。万法阁是人族宗门。';
    const r = await extractWorldSetting({
        sourceText: rawBook,
        extract: fakeExtract({
            ...FULL_RAW,
            bookEntities: [
                { name: '万法阁', kind: 'faction', race: '人族', attrs: { hardPower: 0.7, 依据: '人族宗门' } },
                { name: '北荒妖庭', kind: 'faction', race: '不存在之族' },
            ],
        }),
    });
    const es = r.setting.frozen.canon.bookEntities;
    assert.equal(es.find((b) => b.name === '万法阁').race, '人族');
    assert.equal(es.find((b) => b.name === '北荒妖庭').race, undefined, '种族名不在原文 → 标签弃');
    assert.ok(r.errors.some((e) => /种族出处校验/.test(e)));

    // 形状：非法 attrs 弃好取坏
    const c = sanitizeCanon({
        bookEntities: [
            { name: '甲', kind: 'faction', attrs: '高' },
            { name: '乙', kind: 'faction', attrs: { hardPower: 5, intel: 0.3, 依据: '原文' } },
            { name: '丙', kind: 'faction', attrs: { hardPower: 0.5, 依据: '原文' }, race: '人族' },
        ],
    });
    assert.equal(c.canon.bookEntities.find((b) => b.name === '甲').attrs, undefined, 'attrs 非对象 → 弃');
    const yi = c.canon.bookEntities.find((b) => b.name === '乙');
    assert.equal(yi.attrs.hardPower, 1, '超界钳制到 1');
    assert.equal(yi.attrs.intel, 0.3);
    assert.equal(yi.attrs.office, undefined, '未提议键不进 attrs（seed 兜底）');
    assert.equal(yi.evidence, '原文');
    const bing = c.canon.bookEntities.find((b) => b.name === '丙');
    assert.deepEqual(bing.attrs, { hardPower: 0.5 });
    assert.equal(bing.race, '人族');
});

// ============ leg21 增量抽象（docs/incremental-refine-spec.md） ============

test('leg21 applyRosterAttrs：默认值占位可被有据值覆盖，非默认不回改；race 补缺；分量重算；幂等', () => {
    const mk = () => ({
        context: { tension: 0.6, positions: ['x'], setting: { frozen: { canon: { bookEntities: [
            { name: '白小娥', kind: 'character', attrs: { hardPower: 0.4 }, evidence: '原句' },
            { name: '万法阁', kind: 'faction', attrs: { hardPower: 0.9, office: 0.5 }, evidence: '原句', race: '人族' },
        ] } } } },
        entities: [
            { id: 'e1', kind: 'character', name: '白小娥', location: 'x', attrs: { hardPower: 0.15, office: 0.15, network: 0.15, intel: 0.15 } },
            { id: 'e2', kind: 'faction', name: '万法阁', location: 'x', attrs: { hardPower: 0.8, office: 0.25, network: 0.25, intel: 0.25 } },
        ],
        weights: {},
    });
    const ssot = mk();
    const r = applyRosterAttrs(ssot);
    assert.equal(r.updated, 2);
    const xiao = ssot.entities.find((e) => e.id === 'e1');
    assert.equal(xiao.attrs.hardPower, 0.4, '默认值占位（0.15）被有据值覆盖');
    assert.equal(xiao.attrs.office, 0.15, 'roster 无 office → 保持默认');
    const wf = ssot.entities.find((e) => e.id === 'e2');
    assert.equal(wf.attrs.hardPower, 0.8, '非默认值（0.8）不回改');
    assert.equal(wf.attrs.office, 0.5, '默认值占位（0.25）被有据值覆盖');
    assert.equal(wf.race, '人族', 'race 补缺');
    assert.ok(ssot.weights.e1 > 0 && ssot.weights.e2 > 0, '分量重算在位');
    assert.equal(applyRosterAttrs(ssot).updated, 0, '幂等：再跑零更新');
});

test('leg21 refineEntityAttrs 单实体补抽：行邻域定位 → 小调用 → 出处校验 → 名册+实体合并；无谓据弃置', async () => {
    const src = '【甲】白小娥：炼气三层，一身轻功。\n【乙】无关路过的行：路人甲，路人乙。\n【丙】万法阁：灵脉霸主，掌大荒灵脉。';
    const calls = [];
    const ssot = () => ({
        context: { tension: 0.6, positions: ['x'], setting: { frozen: { canon: { bookEntities: [{ name: '白小娥', kind: 'character' }] } } } },
        entities: [{ id: 'e1', kind: 'character', name: '白小娥', location: 'x', attrs: { hardPower: 0.15, office: 0.15, network: 0.15, intel: 0.15 } }],
        weights: {},
    });
    const r = await refineEntityAttrs(ssot(), {
        name: '白小娥', src,
        extract: async (prompt) => { calls.push(prompt); return JSON.stringify({ bookEntities: [{ name: '白小娥', attrs: { hardPower: 0.3, intel: 0.6, 依据: '炼气三层' } }] }); },
    });
    assert.equal(r.ok, true);
    assert.equal(r.updated, 2, '名册 1 + 实体 1');
    assert.ok(calls[0].includes('炼气三层'), '上下文=名号所在行邻域');
    assert.ok(!calls[0].includes('万法阁'), '上下文不含无关条目行');
    const s1 = ssot();
    await refineEntityAttrs(s1, { name: '白小娥', src, extract: async () => JSON.stringify({ bookEntities: [{ name: '白小娥', attrs: { hardPower: 0.3, intel: 0.6, 依据: '炼气三层' } }] }) });
    assert.deepEqual(s1.context.setting.frozen.canon.bookEntities[0].attrs, { hardPower: 0.3, intel: 0.6 });
    assert.equal(s1.context.setting.frozen.canon.bookEntities[0].evidence, '炼气三层');
    assert.equal(s1.entities[0].attrs.hardPower, 0.3, '实体默认占位被覆盖');
    // 依据不在原文 → 弃 + 警告，账不动
    const s2 = ssot();
    const r2 = await refineEntityAttrs(s2, { name: '白小娥', src, extract: async () => JSON.stringify({ bookEntities: [{ name: '白小娥', attrs: { hardPower: 0.9, 依据: '四处编造' } }] }) });
    assert.equal(r2.ok, true);
    assert.equal(r2.updated, 0, '出处校验不过 → 不合并');
    assert.ok(r2.warnings.some((w) => /出处校验/.test(w)), '弃置留痕');
    assert.equal(s2.context.setting.frozen.canon.bookEntities[0].attrs, undefined);
    // 全失败（空输出重试两次）→ ok:false
    const s3 = ssot();
    const r3 = await refineEntityAttrs(s3, { name: '白小娥', src, extract: async () => '' });
    assert.equal(r3.ok, false);
    assert.match(r3.errors[0], /已重试一次/);
});

test('leg21 resetDynamicLayer：强度/env 回基线、derivedFrom 清空、极性方向保留、frozen 不动', () => {
    const setting = {
        frozen: { fingerprint: 'f', extractedAt: 't', canon: {} },
        dynamic: { tension: { polarity: '正邪', direction: '邪压正', intensity: 0.82 }, env: { 民生度: 0.2, 动乱度: 0.9, 天时: 0.1, 张力推手: 0.7 }, derivedFrom: ['浪尖:a_1@3'] },
    };
    const next = resetDynamicLayer(setting);
    assert.equal(next.frozen, setting.frozen, 'frozen 引用不动');
    assert.equal(next.dynamic.tension.polarity, '正邪');
    assert.equal(next.dynamic.tension.direction, '邪压正');
    assert.equal(next.dynamic.tension.intensity, TENSION_INIT_BASELINE);
    assert.deepEqual(next.dynamic.env, { 民生度: ENV_INIT_BASELINE, 动乱度: ENV_INIT_BASELINE, 天时: ENV_INIT_BASELINE, 张力推手: ENV_INIT_BASELINE });
    assert.deepEqual(next.dynamic.derivedFrom, []);
    assert.equal(next.dynamic.tension.intensity, 0.5, '基线=0.5');
});