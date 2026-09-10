// story-world-v2/test/player-inject.test.js
// K28/设定大势层（细案 §3.4 v1.1 → A-7；2026-09-08 T7 拍板）：玩家开档描述段 → 一次小调用解析 →
// 有依据字段=解析值（[0,1] 钳制）、**无依据/失败/空描述=什么都不写（空着就是空着）**、手填优先、
// 无玩家零扰动（P-E）、确定性幂等、描述截断。
//
// leg24 检察官审计处置（F 组）：**定案默认值（0.25/0.05/0.3/0.4）整条作废**——旧法把解析不出的维度
// 填成引擎编的数，看起来却像客观数据（违反 design-core §2.4 硬规矩一）。本文件相应重基线：
// 「缺字段 → 走默认」的断言全部改成「缺字段 → 账上没有这个键」。
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
            frozen: { fingerprint: 'f1', extractedAt: 't', canon: { powerScale: [], rules: [], society: '', techOrMagic: [], historyNotes: [] } },
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

test('leg24：默认值表已作废（空对象）——不得再往里加默认值', () => {
    assert.deepEqual(PLAYER_INJECT_DEFAULTS, {}, '默认值表必须是空的（空着就是空着）');
});

test('K28/A-7 v1.1（leg24 重基线）：解析值落账——有依据字段=解析值，**缺字段不落键**', () => {
    const out = injectPlayerAttrs(world(), {
        playerDesc: '我是万法阁首徒，筑基巅峰，谍报世家出身',
        parse: parseOf({ hardPower: 0.8, office: 0.55, intel: 0.35 }),
    });
    const p = attrsOf(out);
    assert.equal(p.hardPower, 0.8);
    assert.equal(p.office, 0.55);
    assert.equal(p.intel, 0.35);
    assert.equal('network' in p, false, '解析没给出的维度：账上没有这个键（旧法填 0.3）');
    assert.deepEqual(JSON.parse(JSON.stringify(out)).meta.playerParse.injected, ['hardPower', 'intel', 'office'], '溯源账只记真落账的键');
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
    assert.equal(p.network, 0, '解析给出 0 是**有据的零**，照样落账（区别于"没数据"）');
});

test('leg24（重基线）：无依据字段不输出 → 全部空着（旧法落 0.25/0.05/0.3/0.4）', () => {
    const out = injectPlayerAttrs(world(), { playerDesc: '就是个普通散修', parse: parseOf({}) });
    assert.deepEqual(attrsOf(out), {}, '一个数都不许编');
    assert.equal(out.meta.playerParse, undefined, '没有落账键 → 不写溯源账');
});

test('leg24（重基线）：失败降级——parse 抛错/返回非法 → 世界原样不动，零阻塞', () => {
    const w1 = world();
    const o1 = injectPlayerAttrs(w1, { playerDesc: '……', parse: () => { throw new Error('boom'); } });
    assert.deepEqual(attrsOf(o1), {}, '抛错 → 什么都不写');
    const w2 = world();
    const o2 = injectPlayerAttrs(w2, { playerDesc: '……', parse: () => '垃圾字符串' });
    assert.deepEqual(attrsOf(o2), {}, '非对象输出 → 什么都不写');
    // 非数值项也要挡住（旧法只认键，会把字符串塞进 numRecord）
    const w3 = world();
    const o3 = injectPlayerAttrs(w3, { playerDesc: 'x', parse: () => ({ hardPower: '很高', intel: 0.4 }) });
    assert.deepEqual(attrsOf(o3), { intel: 0.4 }, '非有限数值的字段不落账，合法字段照落');
});

test('K28/A-7 v1.1：空描述 → 不调用 parse，且什么都不写', () => {
    let calls = 0;
    const out = injectPlayerAttrs(world(), { playerDesc: '   ', parse: () => { calls++; return { hardPower: 0.9 }; } });
    assert.equal(calls, 0, '空描述不发起解析调用');
    assert.deepEqual(attrsOf(out), {});
});

test('K28/A-7 v1.1：手填优先——已有 attrs 一律不动（解析不覆盖）；缺键照常注入', () => {
    const w = world();
    w.entities[0].attrs = { hardPower: 0.9 };
    const out = injectPlayerAttrs(w, { playerDesc: '至尊强者', parse: parseOf({ hardPower: 0.8, office: 0.4 }) });
    const p = attrsOf(out);
    assert.equal(p.hardPower, 0.9, '手填值不被覆盖');
    assert.equal(p.office, 0.4, '缺键照常注入');
    assert.equal('intel' in p, false, '解析没给 intel → 不落键（旧法填默认）');
    assert.equal('network' in p, false);
});

test('K28/A-7 v1.1：无玩家世界零扰动（P-E）；设定池未就绪不动；无解析器不写任何键', () => {
    const noPlayer = world();
    delete noPlayer.context.playerId;
    assert.equal(injectPlayerAttrs(noPlayer, { playerDesc: 'x', parse: parseOf({}) }), noPlayer, '无玩家原样返回');

    const noCanon = world();
    delete noCanon.context.setting.frozen.canon;
    assert.equal(injectPlayerAttrs(noCanon, { playerDesc: 'x', parse: parseOf({}) }), noCanon, '设定池未就绪原样返回');

    const w3 = world();
    const o3 = injectPlayerAttrs(w3, { playerDesc: 'x' });   // 不传 parse：不发起解析
    assert.deepEqual(attrsOf(o3), {}, '无解析器 → 什么都不写（不编数）');
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

test('leg24 新增：force 重解析只覆盖溯源账里的键；解析不出新依据 → 旧值保留、不降级成空', () => {
    const first = injectPlayerAttrs(world(), { playerDesc: '我是筑基修士', parse: parseOf({ hardPower: 0.4, intel: 0.6 }) });
    const second = injectPlayerAttrs(first, { playerDesc: '重修之后', parse: parseOf({ hardPower: 0.7 }), overwrite: true });
    const p = attrsOf(second);
    assert.equal(p.hardPower, 0.7, '溯源账内的键被新依据覆盖');
    assert.equal(p.intel, 0.6, '本次无新依据 → 旧解析值保留（不降级、也不清空）');
});
