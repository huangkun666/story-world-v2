// story-world-v2/test/player-inject.test.js
// K28/设定大势层（细案 §3.4 v1.1 → A-7；2026-09-08 T7 拍板）：玩家开档描述段 → 一次小调用解析 →
// 有依据字段=解析值（[0,1] 钳制）、无依据/失败/空描述=已定案默认（#6-9）、手填优先、
// 无玩家零扰动（P-E）、确定性幂等、描述截断。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectPlayerAttrs, PLAYER_INJECT_DEFAULTS, PLAYER_DESC_LIMIT } from '../src/player-inject.js';

const world = (over = {}) => ({
    version: 1,
    context: {
        world: '临渊城',
        tension: 0.5,
        positions: ['临渊城'],
        playerId: 'e_p',
        setting: {
            frozen: { fingerprint: 'f1', extractedAt: 't', canon: { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [] } },
            dynamic: { tension: { polarity: '宗门/朝廷', intensity: 0.5 } },
        },
    },
    entities: [
        { id: 'e_p', kind: 'character', name: '黄坤', location: '临渊城', attrs: {} },
        { id: 'e1', kind: 'faction', name: '大虞', location: '临渊城', attrs: {} },
    ],
    weights: {},
    agendas: [],
    events: [],
    chronicle: [],
    meta: { tick: 0 },
    ...over,
});

const parseOf = (obj) => () => obj;   // 确定性 fake 解析器
const attrsOf = (w) => w.entities.find((e) => e.id === 'e_p').attrs;
const snapshot = (attrs) => ({ hardPower: attrs.hardPower, office: attrs.office, network: attrs.network, intel: attrs.intel });

test('K28/A-7 v1.1：解析值落账——有依据字段=解析值，缺字段走定案默认', () => {
    const out = injectPlayerAttrs(world(), {
        playerDesc: '我是万法阁首徒，筑基巅峰，谍报世家出身',
        parse: parseOf({ hardPower: 0.8, office: 0.55, intel: 0.35 }),
    });
    const p = attrsOf(out);
    assert.equal(p.hardPower, 0.8);
    assert.equal(p.office, 0.55);
    assert.equal(p.intel, 0.35);
    assert.equal(p.network, PLAYER_INJECT_DEFAULTS.network, '缺字段走默认');
    assert.equal(attrsOf(world()).hardPower, undefined, '原世界不可变');
});

test('K28/A-7 v1.1：钳制——解析值越界 [0,1] 被钳（1.5→1、-0.2→0）', () => {
    const out = injectPlayerAttrs(world(), {
        playerDesc: '强到没边，也弱到没边',
        parse: parseOf({ hardPower: 1.5, office: -0.2, intel: 0.999, network: 0 }),
    });
    const p = attrsOf(out);
    assert.equal(p.hardPower, 1);
    assert.equal(p.office, 0);
    assert.equal(p.intel, 0.999);
    assert.equal(p.network, 0);
});

test('K28/A-7 v1.1：无依据字段不输出——缺省走定案默认（0.25/0.05/0.3/0.4）', () => {
    const out = injectPlayerAttrs(world(), { playerDesc: '就是个普通散修', parse: parseOf({}) });
    assert.deepEqual(snapshot(attrsOf(out)), PLAYER_INJECT_DEFAULTS);
});

test('K28/A-7 v1.1：失败降级——parse 抛错/返回非法 → 全部落定案默认，零阻塞', () => {
    const o1 = injectPlayerAttrs(world(), { playerDesc: '……', parse: () => { throw new Error('boom'); } });
    assert.deepEqual(snapshot(attrsOf(o1)), PLAYER_INJECT_DEFAULTS, '抛错按失败处理');
    const o2 = injectPlayerAttrs(world(), { playerDesc: '……', parse: () => '垃圾字符串' });
    assert.deepEqual(snapshot(attrsOf(o2)), PLAYER_INJECT_DEFAULTS, '非对象输出按失败处理');
});

test('K28/A-7 v1.1：空描述 → 不调用 parse，全部落定案默认', () => {
    let calls = 0;
    const out = injectPlayerAttrs(world(), { playerDesc: '   ', parse: () => { calls++; return { hardPower: 0.9 }; } });
    assert.equal(calls, 0, '空描述不发起解析调用');
    assert.deepEqual(snapshot(attrsOf(out)), PLAYER_INJECT_DEFAULTS);
});

test('K28/A-7 v1.1：手填优先——已有 attrs 一律不动（解析不覆盖）', () => {
    const w = world();
    w.entities[0].attrs = { hardPower: 0.9 };
    const out = injectPlayerAttrs(w, { playerDesc: '至尊强者', parse: parseOf({ hardPower: 0.8, office: 0.4 }) });
    const p = attrsOf(out);
    assert.equal(p.hardPower, 0.9, '手填值不被覆盖');
    assert.equal(p.office, 0.4, '缺键照常注入');
    assert.equal(p.intel, PLAYER_INJECT_DEFAULTS.intel);
    assert.equal(p.network, PLAYER_INJECT_DEFAULTS.network);
});

test('K28/A-7 v1.1：无玩家世界零扰动（P-E）；设定池未就绪不动；无解析器不调用直接默认', () => {
    const noPlayer = world();
    delete noPlayer.context.playerId;
    assert.equal(injectPlayerAttrs(noPlayer, { playerDesc: 'x', parse: parseOf({}) }), noPlayer, '无玩家原样返回');

    const noCanon = world();
    delete noCanon.context.setting.frozen.canon;
    assert.equal(injectPlayerAttrs(noCanon, { playerDesc: 'x', parse: parseOf({}) }), noCanon, '设定池未就绪原样返回');

    let calls = 0;
    const w3 = world();
    const o3 = injectPlayerAttrs(w3, { playerDesc: 'x' });   // 不传 parse：不发起解析
    assert.equal(calls, 0, '无解析器不调用');
    assert.deepEqual(snapshot(attrsOf(o3)), PLAYER_INJECT_DEFAULTS, '直接落定案默认');
});

test('K28/A-7 v1.1：确定性 + 幂等——同输入两次注入逐字节一致，二注入无二次变化；描述超限截断', () => {
    const w = world();
    const opts = {
        playerDesc: '一'.repeat(PLAYER_DESC_LIMIT + 100) + '筑基巅峰',
        parse: (d) => ({ hardPower: d.length <= PLAYER_DESC_LIMIT ? 0.6 : 0.9 }),
    };
    const a = injectPlayerAttrs(w, opts);
    const b = injectPlayerAttrs(structuredClone(w), opts);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(attrsOf(a).hardPower, 0.6, '描述被截断到上限再传入解析器');
    const again = injectPlayerAttrs(a, opts);
    assert.equal(JSON.stringify(a), JSON.stringify(again), '幂等（已注入值被视为手填）');
});