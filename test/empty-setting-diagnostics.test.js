import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRosterPrompt, buildSettingOnlyPrompt, extractWorldSetting } from '../src/abstract.js';
import { freezeAllowedSources } from '../src/abstract-evidence.js';
import * as diag from '../web/diagnostic-transport.js';
import { diagnostics } from '../src/diagnostics.js';
import { createCache, bookFingerprint } from '../src/fp-hash.js';

const small = '诸国林立。法术依靠灵气。甲是宗主。';
const large = `${small}\n${'普通资料。\n'.repeat(6500)}`;
const sources = text => [{ sourceId: 'world', title: '世界', text }];
const template = prompt => {
    const start = prompt.indexOf('{\n');
    return JSON.parse(prompt.slice(start, prompt.indexOf('\n纪律：', start)).trim());
};
const run = (text, response, options = {}) => extractWorldSetting({
    sourceText: text, allowedSources: sources(text), evidencePolicy: 'strict',
    extract: async () => JSON.stringify(response), ...options,
});

test('严格模板为每项全局设定示范出处，旧模板仍是字符串', () => {
    const frozen = freezeAllowedSources(sources(small));
    for (const build of [buildRosterPrompt, buildSettingOnlyPrompt]) {
        const obj = template(build(small, [], { sources: frozen }));
        for (const key of ['rules', 'historyNotes']) assert.ok(obj[key][0].ev, key);
        for (const key of ['society', 'techOrMagic', 'situation']) assert.ok(obj[key].ev, key);
        assert.ok(obj.刻度[0].ev);
        assert.ok(obj.刻度[0].子表[0].ev);
        assert.ok(obj.tension.polarity.ev);
        assert.ok(obj.env.民生度.ev);
        assert.equal(typeof template(build(small)).society, 'string');
    }
});

for (const [size, text] of [['小书', small], ['大书', large]]) {
    test(`${size}：无出处的设定照收并按成功写缓存，出处对不上只记 unverified（★leg197：出处不再丢，照收）`, async () => {
        let writes = 0;
        const r = await run(text, { society: '诸国林立。' }, {
            skipRoster: true, force: true, cache: { set() { writes++; } },
        });
        // ★leg197：出处核不过**不再丢**这条设定 ⇒ 抽取按成功返回、世界照旧被这次结果替换。
        assert.equal(r.ok, true);
        assert.equal(r.setting.frozen.canon.society, '诸国林立。');
        // ★leg197：收下了就照旧写缓存（旧法因"全被拒收"而一个字都不写）。
        assert.equal(writes, 1);
        assert.ok(r.settingReport.returned.society > 0);
        // ★leg197：`kept` 现在如实记 1（旧法记 0：模型交了、却被出处闸拦在门外）。
        assert.equal(r.settingReport.kept.society, 1);
        // ★leg197：出处核不过**不再丢项**，但"哪一项的原话对不上"照旧进拒因摘要（只是不再拒收）。
        assert.ok(r.settingReport.reasons.some(x => /出处|ev|引用/.test(x.reason)));
        assert.ok(r.evidence.summary.unverified > 0);
        assert.equal(r.evidence.summary.dropped, 0);
    });
    test(`${size}：只返回空对象的重抽也应失败`, async () => {
        const r = await run(text, {}, { skipRoster: true, force: true });
        assert.equal(r.ok, false);
        assert.equal(r.settingReport.returned.total, 0);
    });
    test(`${size}：仅有社会格局且出处有效时仍能成功`, async () => {
        const r = await run(text, { society: { 文: '诸国林立。', ev: { s: 'S1', q: '诸国林立。' } } }, { skipRoster: true, force: true });
        assert.equal(r.ok, true, r.errors?.join(';'));
        assert.equal(r.setting.frozen.canon.society, '诸国林立。');
        assert.ok(r.settingReport.returned.society > 0);
        assert.equal(r.settingReport.kept.society, 1);
        assert.equal('settingReport' in r.setting.frozen, false);
    });
}

test('初始化：名册成功、全局设定出处核不过 ⇒ 照收并如实记 unverified（★leg197：出处不再丢，照收）', async () => {
    const r = await run(small, {
        bookEntities: [{ name: '甲', kind: 'character', ev: { s: 'S1', q: '甲是宗主。' } }],
        society: '诸国林立。',
    });
    // ★leg197：名册成功 + 设定出处核不过 ⇒ 不再整单失败（旧法 ok=false、kept.total=0）。
    assert.equal(r.ok, true);
    assert.equal(r.settingReport.kept.total, 1);
    assert.equal(r.settingReport.kept.society, 1);
    // ★leg197：名册成功不再"掩盖"任何东西——设定照收，而"出处对不上"照旧可查（证据摘要的 unverified）。
    assert.ok(r.evidence.summary.unverified > 0);
});

test('名册资料未交全局设定时仍可初始化，调试台无需详细数据即可看见原因', async () => {
    const r = await run(small, { bookEntities: [{ name: '甲', kind: 'character', ev: { s: 'S1', q: '甲是宗主。' } }] });
    assert.equal(r.ok, true);
    assert.equal(r.settingReport.returned.total, 0);
    assert.equal(typeof diag.diagSettingOutcome, 'function');
    diagnostics.clear();
    diag.setDiagnosticDetails(() => false);
    for (let i = 0; i < 250; i++) diag.diagEvidence({ class: 'field', action: 'drop', why: '属性不在出处' });
    diag.diagSettingOutcome(r);
    const rows = diagnostics.snapshot({ module: '设定抽取' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].level, 'warn');
    assert.match(rows[0].message, /模型未返回/);
    assert.equal(rows[0].data.kept.total, 0);
    assert.equal(rows[0].data.response, undefined);
});

test('刻度表的档位不再过出处闸：照收且不再产生拒因（★leg197：出处不再丢，照收）', async () => {
    const r = await run(small, { 刻度: [{ 名: '修为', 档位: ['筑基'] }] }, { skipRoster: true });
    // ★leg197：档位/注/维度那一层的出处闸**整层删了** ⇒ 这张表照收（旧法整张表被拒、ok=false）。
    assert.equal(r.ok, true);
    assert.equal(r.setting.frozen.canon.powerScale[0].level, '筑基');
    assert.equal(r.settingReport.kept.刻度, 1);
    // ★leg197：刻度面现在连 `unverified` 都不再产生（那一面已不再跑 verifyQuote）⇒ 拒因恒空。
    assert.equal(r.settingReport.reasons.length, 0);
    assert.equal(r.evidence.summary.unverified, 0);
});

test('空设定缓存不能用于只重抽，必须重新调用并保留有效结果', async () => {
    const cache = createCache();
    const evidence = [];
    cache.set(bookFingerprint(small), { canon: { bookEntities: [{ name: '甲' }] }, tension: {}, env: {} }, 'now', {
        evidencePolicy: 'strict', sourceDigest: freezeAllowedSources(sources(small)).digest,
    });
    let calls = 0;
    const r = await run(small, {}, { cache, skipRoster: true, onEvidence: rec => evidence.push(rec), extract: async () => {
        calls++;
        return JSON.stringify({ society: { 文: '诸国林立。', ev: { s: 'S1', q: '诸国林立。' } } });
    } });
    assert.equal(r.ok, true);
    assert.equal(r.cached, false);
    assert.equal(calls, 1);
    assert.equal(r.setting.frozen.canon.society, '诸国林立。');
    assert.equal(evidence.some(rec => /digest.*不同/.test(rec.why)), false, '空缓存不能误报来源发生变化');
});

test('有效设定缓存的摘要明确缓存命中，不假报本次模型返回', async () => {
    const cache = createCache();
    await run(small, { society: { 文: '诸国林立。', ev: { s: 'S1', q: '诸国林立。' } } }, { cache });
    const r = await run(small, {}, { cache, skipRoster: true, extract: async () => { throw Error('不应调用'); } });
    assert.equal(r.ok, true);
    assert.equal(r.cached, true);
    assert.equal(r.settingReport.returned, null);
    assert.equal(r.settingReport.kept.society, 1);
});

test('小书只重抽也使用设定提示词，跳过名册与属性', async () => {
    let prompt;
    await run(small, {}, { skipRoster: true, extract: async p => { prompt = p; return '{}'; } });
    assert.match(prompt, /本遍只抽"设定"/);
    assert.equal('bookEntities' in template(prompt), false);
});

test('部分设定有据、其余出处核不过时全部照收，unverified 记进证据摘要（★leg197：出处不再丢，照收）', async () => {
    const r = await run(small, {
        society: { 文: '诸国林立。', ev: { s: 'S1', q: '诸国林立。' } },
        techOrMagic: '法术依靠灵气。',
    }, { skipRoster: true });
    assert.equal(r.ok, true);
    // ★leg197：没有出处的 techOrMagic 也照收（旧法留空）。
    assert.equal(r.setting.frozen.canon.techOrMagic, '法术依靠灵气。');
    assert.equal(r.settingReport.returned.techOrMagic, 1);
    // ★leg197：两条都收下了（旧法 techOrMagic 记 0），"出处对不上"照旧进拒因摘要（只是不再拒收）。
    assert.equal(r.settingReport.kept.techOrMagic, 1);
    assert.ok(r.settingReport.reasons.length > 0);
    // ★leg197：核过的那条记 keep、核不过的那条记 unverified——两条都在诊断里，都不再被丢。
    assert.equal(r.evidence.summary.kept, 1);
    assert.equal(r.evidence.summary.unverified, 1);
    diagnostics.clear();
    diag.diagSettingOutcome(r);
    const [row] = diagnostics.snapshot({ module: '设定抽取' });
    assert.equal(row.level, 'warn');
    assert.match(row.message, /部分设定/);
});

test('大书初始化：全局设定出处核不过也照收，不被名册成功掩盖也不再失败（★leg197：出处不再丢，照收）', async () => {
    const r = await run(large, { bookEntities: [{ name: '甲', kind: 'character', ev: { s: 'S1', q: '甲是宗主。' } }], society: '诸国林立。' });
    // ★leg197：名册成功 + 设定出处核不过 ⇒ 照收（旧法整单 ok=false，设定一个字节都不进账）。
    assert.equal(r.ok, true);
    assert.ok(r.settingReport.returned.society > 0);
    assert.equal(r.settingReport.kept.society, 1);
    // ★leg197：出处核不过只记账不拦人 ⇒ 拒因摘要里照旧看得见这条，但世界账里已经有了值。
    assert.ok(r.settingReport.reasons.some(x => /出处|ev|引用/.test(x.reason)));
    assert.ok(r.evidence.summary.unverified > 0);
});

test('旧的无核验调用仍可保留有效设定，但空的只重抽也拒绝替换', async () => {
    const good = await extractWorldSetting({ sourceText: small, skipRoster: true, extract: async () => '{"society":"诸国林立。"}' });
    assert.equal(good.ok, true);
    const bad = await extractWorldSetting({ sourceText: small, skipRoster: true, extract: async () => '{}' });
    assert.equal(bad.ok, false);
});

test('旧的设定正文键仍计入返回数量，且照收不再触发空设定保护（★leg197：出处不再丢，照收）', async () => {
    for (const key of ['原文', 'note', 'level', '档', 'rule', '法则']) {
        const r = await run(small, {
            society: { [key]: '诸国林立。' },
            bookEntities: [{ name: '甲', kind: 'character', ev: { s: 'S1', q: '甲是宗主。' } }],
        });
        // ★leg197：旧的正文键照旧被认成"模型交了设定"（returned=1），而它现在**照收** ⇒ 空设定保护不再触发。
        assert.equal(r.ok, true, key);
        assert.equal(r.settingReport.returned.society, 1, key);
        assert.equal(r.settingReport.kept.society, 1, key);
        assert.ok(r.evidence.summary.unverified > 0, key);
    }
});

test('非法环境档位的形状拒因不能从摘要中漏掉', async () => {
    const r = await run(small, { env: { 民生度: '无法判断' } }, { skipRoster: true });
    assert.equal(r.ok, false);
    assert.ok(r.settingReport.reasons.some(x => /env\.民生度/.test(x.reason)));
});

test('刻度派生的旧列表另列读数，总数不与原始刻度重复计算', async () => {
    const r = await run('修为分筑基。', { 刻度: [{ 名: '修为', 档位: ['筑基'], ev: { s: 'S1', q: '修为分筑基。' } }] }, { skipRoster: true });
    assert.equal(r.ok, true);
    assert.equal(r.settingReport.returned.total, 1);
    assert.equal(r.settingReport.kept.total, 1);
    assert.equal(r.settingReport.kept.powerScale, 1);
    assert.deepEqual(r.settingReport.derivedViews, ['powerScale', 'dims']);
});
