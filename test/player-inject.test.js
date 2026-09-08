// story-world-v2/test/player-inject.test.js
// K28/设定大势层：玩家 attrs 自动注入（细案 §3.4 → A-7；P-B 触发闭合）——命中即用、不覆盖手填、
// 缺省回退定案值、无玩家世界零扰动、确定性幂等。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectPlayerAttrs, PLAYER_INJECT_DEFAULTS } from '../src/player-inject.js';

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

test('K28/A-7：命中即用——力量词/制度词/讯息词按表注入，network 走定案默认', () => {
    const w = world();
    w.context.setting.frozen.canon = {
        powerScale: [{ level: '帝者', note: '至尊无敌于世' }, { level: '筑基', note: '凡俗之上' }],
        rules: [],
        society: '朝廷统御，宗门林立',
        techOrMagic: '谍报术法盛行',
        historyNotes: [],
    };
    const out = injectPlayerAttrs(w);
    const p = out.entities.find((e) => e.id === 'e_p');
    assert.equal(p.attrs.hardPower, 0.8, '首档 note 命中"至尊"');
    assert.equal(p.attrs.office, 0.4, 'society 命中"朝"');
    assert.equal(p.attrs.intel, 0.5, 'techOrMagic 按表序首中"谍"');
    assert.equal(p.attrs.network, PLAYER_INJECT_DEFAULTS.network);
    assert.equal(w.entities.find((e) => e.id === 'e_p').attrs.hardPower, undefined, '原世界不可变');
});

test('K28/A-7：不覆盖手填——已有 attrs 一律不动，仅填充缺失键', () => {
    const w = world();
    w.entities[0].attrs = { hardPower: 0.9 };
    w.context.setting.frozen.canon = {
        powerScale: [{ level: '至尊', note: 'x' }],
        rules: [],
        society: '朝廷统御',
        techOrMagic: '谍报术法',
        historyNotes: [],
    };
    const out = injectPlayerAttrs(w);
    const p = out.entities.find((e) => e.id === 'e_p');
    assert.equal(p.attrs.hardPower, 0.9, '手填值不被覆盖');
    assert.equal(p.attrs.office, 0.4);
    assert.equal(p.attrs.intel, 0.5);
    assert.equal(p.attrs.network, PLAYER_INJECT_DEFAULTS.network);
});

test('K28/A-7：全未命中 → 定案默认值回退（0.25/0.05/0.3/0.4）', () => {
    const out = injectPlayerAttrs(world());
    const p = out.entities.find((e) => e.id === 'e_p');
    assert.deepEqual(p.attrs, PLAYER_INJECT_DEFAULTS);
});

test('K28/A-7：无玩家世界零扰动（P-E 旁观语义）；设定池未就绪不动', () => {
    const noPlayer = world();
    delete noPlayer.context.playerId;
    const o1 = injectPlayerAttrs(noPlayer);
    assert.equal(o1, noPlayer, '无玩家原样返回');

    const noCanon = world();
    delete noCanon.context.setting.frozen.canon;
    const o2 = injectPlayerAttrs(noCanon);
    assert.equal(o2, noCanon, '设定池未就绪原样返回');
});

test('K28/A-7：确定性 + 幂等——同一输入两次注入结果逐字节一致，二注入无二次变化', () => {
    const w = world();
    w.context.setting.frozen.canon = {
        powerScale: [{ level: '一方霸主', note: '握重兵' }],
        rules: [],
        society: '世家割据',
        techOrMagic: '炼气修法',
        historyNotes: [],
    };
    const a = injectPlayerAttrs(w);
    const b = injectPlayerAttrs(structuredClone(w));
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    const again = injectPlayerAttrs(a);
    assert.equal(JSON.stringify(a), JSON.stringify(again), '幂等（已注入值被视为手填）');
});