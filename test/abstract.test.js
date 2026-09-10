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
    resetDynamicLayer,
    ENV_INIT_BASELINE,
    TENSION_INIT_BASELINE,
} from '../src/abstract.js';
// leg24 片1（停抄书）：applyRosterAttrs / refineEntityAttrs 随抄书流水线删除，不再导入——
// 其退场有专门的"删除位锁"测试（test/abstract-chunk.test.js）+ 本文件末尾的名册形状锁。

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

test('leg24 片1 停抄书：抽取输出只留 name/kind/parent——attrs/race/location/evidence 一律不入册', async () => {
    const rawBook = '万法阁：灵脉霸主，掌大荒灵脉。白小娥：炼气三层。';
    const withExtras = {
        ...FULL_RAW,
        bookEntities: [
            { name: '万法阁', kind: 'faction', parent: '大虞', attrs: { hardPower: 0.9, office: 0.8, 依据: '灵脉霸主' }, race: '人族', location: '昆仑山' },
            { name: '白小娥', kind: 'character', attrs: { hardPower: 0.3, 依据: '炼气三层' } },
            { name: '无据客', kind: 'character', attrs: { intel: 0.6 } },
        ],
    };
    const r = await extractWorldSetting({ sourceText: rawBook, extract: fakeExtract(withExtras) });
    assert.equal(r.ok, true);
    const es = r.setting.frozen.canon.bookEntities;
    for (const name of ['万法阁', '白小娥', '无据客']) {
        const item = es.find((b) => b.name === name);
        assert.ok(item, `${name} 名号仍入册（身份是主键，不随停抄书而丢）`);
        assert.equal(item.attrs, undefined, `${name}: 不再抄书里的四维属性`);
        assert.equal(item.race, undefined, `${name}: 不再抄种族标签`);
        assert.equal(item.location, undefined, `${name}: 不再抄所在（位置改为用到时查书）`);
        assert.equal(item.evidence, undefined, `${name}: 不再留属性原文依据`);
    }
    assert.equal(es.find((b) => b.name === '万法阁').parent, '大虞', 'parent 字段在形状上留着（照书办要照抄书标签里的上级）');
    // 净化层同口径：不问也不存（旧世界的这些字段仍合法，只是引擎不再生产/不读）
    const c = sanitizeCanon({ bookEntities: [{ name: '甲', kind: 'faction', attrs: { hardPower: 5 }, race: '人族', location: '某洲' }] });
    assert.deepEqual(c.canon.bookEntities[0], { name: '甲', kind: 'faction' }, '净化为 name/kind 两种键（无可选字段）');
});

test('leg24 片1 停抄书：不再产生属性/种族/所在三类出处校验警告（那些字段已经不抽了）', async () => {
    const r = await extractWorldSetting({
        sourceText: '妖族占据北荒。万法阁是人族宗门。',
        extract: fakeExtract({
            ...FULL_RAW,
            bookEntities: [{ name: '万法阁', kind: 'faction', attrs: { hardPower: 0.7, 依据: '人族宗门' }, race: '不存在之族' }],
        }),
    });
    assert.equal(r.ok, true);
    assert.ok(!r.errors.some((e) => /出处校验/.test(e)), `不应再出现属性/种族/所在出处校验警告：${r.errors.join('; ')}`);
    assert.deepEqual(Object.keys(r.setting.frozen.canon.bookEntities[0]).sort(), ['kind', 'name'], '名册条目只有身份两项');
});

// ============ leg24 片1 收尾：名册形状锁（旧世界兼容 + 新抽取口径） ============

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