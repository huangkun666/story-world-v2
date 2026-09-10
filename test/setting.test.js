// story-world-v2/test/setting.test.js
// K24/设定大势层：context.setting 可选形状 + 旧形状兼容（细案 A-1；契约层）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

const baseWorld = () => ({
    version: 1,
    context: { world: '临渊城', tension: 0.5, positions: ['临渊城'] },
    // leg25 c：实体夹具不再带 `attrs`（四维浮点已整条删除；schema additional:false ⇒ 带它就是"未知字段"拒）。
    //   本文件测的全是 `setting` 层形状，实体只需最小合法形状充当载体，与属性无关。
    entities: [{ id: 'e1', kind: 'faction', name: 'A', location: '临渊城' }],
    weights: {},
    agendas: [],
    events: [],
    chronicle: [],
    meta: { tick: 1 },
});

test('K24/A-1：旧世界兼容——仅 tension 数字、无 setting 合法（缺省形状兼容断言）', () => {
    const r = validate(baseWorld(), ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
});

test('K24/A-1：setting 全形状合法（frozen 五件套 + dynamic 张力三件 + env + derivedFrom）', () => {
    const doc = baseWorld();
    doc.context.setting = {
        frozen: {
            fingerprint: 'fnv1a-abc123',
            extractedAt: '2026-09-07T12:00:00Z',
            canon: {
                powerScale: [{ level: '筑基', note: '凡俗之上' }, { level: '元婴', note: '一方之尊' }],
                rules: ['灵脉有主'],
                society: '宗门林立，大荒无主',
                techOrMagic: '灵气修行体系',
                historyNotes: ['上古一战，灵脉断流'],
            },
        },
        dynamic: {
            tension: { polarity: '宗门/朝廷', direction: '宗门压朝廷', intensity: 0.6 },
            env: { '民生度': 0.7, '动乱度': 0.2, '天时': 0.5 },
            derivedFrom: ['book#3', 'ev_1_2'],
        },
    };
    const r = validate(doc, ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
});

test('K24/A-1：setting 内 frozen/dynamic 各自缺省合法；dynamic 缺 tension 被拒', () => {
    const onlyFrozen = baseWorld();
    onlyFrozen.context.setting = {
        frozen: { fingerprint: 'f1', extractedAt: 't', canon: { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [] } },
    };
    assert.equal(validate(onlyFrozen, ssotSchema).ok, true);

    const onlyDynamic = baseWorld();
    onlyDynamic.context.setting = { dynamic: { tension: { polarity: 'P', intensity: 0.2 } } };   // direction 可省 = 僵持
    assert.equal(validate(onlyDynamic, ssotSchema).ok, true);

    const noTension = baseWorld();
    noTension.context.setting = { dynamic: { env: { '民生度': 1 } } };
    const r = validate(noTension, ssotSchema);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.includes('$.context.setting.dynamic.tension: 必填缺失')), r.errors.join('; '));
});

test('K24/A-1：intensity 越界与类型被拒（引擎计算域 0..1）', () => {
    const over = baseWorld();
    over.context.setting = { dynamic: { tension: { polarity: 'P', intensity: 1.2 } } };
    assert.ok(!validate(over, ssotSchema).ok, 'intensity > 1 应拒');

    const under = baseWorld();
    under.context.setting = { dynamic: { tension: { polarity: 'P', intensity: -0.1 } } };
    assert.ok(!validate(under, ssotSchema).ok, 'intensity < 0 应拒');

    const nonNum = baseWorld();
    nonNum.context.setting = { dynamic: { tension: { polarity: 'P', intensity: '高' } } };
    assert.ok(!validate(nonNum, ssotSchema).ok, 'intensity 非数字应拒');
});

test('K24：setting 形状严格——未知字段拒、frozen 缺 fingerprint 拒', () => {
    const stray = baseWorld();
    stray.context.setting = { dynamic: { tension: { polarity: 'P', intensity: 0.5 }, rogue: true } };
    const r1 = validate(stray, ssotSchema);
    assert.ok(!r1.ok);
    assert.ok(r1.errors.some(e => e.includes('$.context.setting.dynamic.rogue: 未知字段')), r1.errors.join('; '));

    const noFp = baseWorld();
    noFp.context.setting = { frozen: { extractedAt: 't', canon: { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [] } } };
    const r2 = validate(noFp, ssotSchema);
    assert.ok(!r2.ok);
    assert.ok(r2.errors.some(e => e.includes('$.context.setting.frozen.fingerprint: 必填缺失')), r2.errors.join('; '));
});

test('K24：canon 五件套形状——powerScale 项缺 note 拒；空五件合法（无数量约束口径）', () => {
    const badItem = baseWorld();
    badItem.context.setting = { frozen: { fingerprint: 'f', extractedAt: 't', canon: { powerScale: [{ level: '筑基' }], rules: [], society: '', techOrMagic: '', historyNotes: [] } } };
    const r1 = validate(badItem, ssotSchema);
    assert.ok(!r1.ok);
    assert.ok(r1.errors.some(e => e.includes('$.context.setting.frozen.canon.powerScale[0].note: 必填缺失')), r1.errors.join('; '));

    const emptyCanon = baseWorld();
    emptyCanon.context.setting = { frozen: { fingerprint: 'f', extractedAt: 't', canon: { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [] } } };
    assert.equal(validate(emptyCanon, ssotSchema).ok, true);
});

test('K24：env 键值必须为数字（越阈值语义域）', () => {
    const doc = baseWorld();
    doc.context.setting = { dynamic: { tension: { polarity: 'P', intensity: 0.5 }, env: { '天时': '雨' } } };
    const r = validate(doc, ssotSchema);
    assert.ok(!r.ok);
    assert.ok(r.errors.some(e => e.includes('期望数字')), r.errors.join('; '));
});