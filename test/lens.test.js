// story-world-v2/test/lens.test.js
// K44（full-roster-lens-spec C2/C7/C8 拍板）：镜头选择器——全量棋盘有序入镜（保送+分量序、预算前缀）、
// 麾下成员打包（含分支成员）、P3 分量不泄漏、确定性锁。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvolutionPack, lensList, EVOLUTION_BUDGET_TOKENS } from '../src/pack.js';

function mkWorld({ entities = [], weights = {}, events = [], agendas = [], tick = 0, moveFact = null } = {}) {
    return {
        context: { world: '测试', tension: 0.5, positions: ['中央'] },
        entities,
        weights,
        agendas,
        events,
        meta: { tick },
        moveFact,
    };
}

const ent = (id, name, kind, extra = {}) => ({ id, kind, name, location: '中央', ...extra });

test('K44: 全量入镜——现规模（350 实体）全部进入且 ≤ 镜头预算', () => {
    const entities = Array.from({ length: 350 }, (_, i) => ent(`e_${i}`, `名号${i}`, i % 3 === 0 ? 'faction' : 'character'));
    const weights = Object.fromEntries(entities.map((e, i) => [e.id, (i % 100) / 100]));
    const w = mkWorld({ entities, weights });
    const lens = lensList(w);
    assert.equal(lens.length, 350);                       // 无截断
    const p = buildEvolutionPack(w, null);
    assert.ok(p.estTokens <= EVOLUTION_BUDGET_TOKENS, `est=${p.estTokens}`);
    assert.equal(p.pack.entities.length, 350);
});

test('K44: 保送优先——落子对象/未决波及/在飞属主/近 2 tick 活跃 置顶（即使低分量）', () => {
    const entities = [
        ent('e_hi', '高分量者', 'character', { attrs: { hardPower: 0.9, network: 0.5, intel: 0.5, office: 0.5 } }),
        ent('e_lo', '低分量者', 'character', { attrs: { hardPower: 0.05, network: 0.05, intel: 0.05, office: 0.05 } }),
        ent('e_wave', '被波及者', 'character', { attrs: { hardPower: 0.05, network: 0.05, intel: 0.05, office: 0.05 } }),
        ent('e_owner', '有盘算者', 'character', { attrs: { hardPower: 0.05, network: 0.05, intel: 0.05, office: 0.05 } }),
        ent('e_act', '近活跃者', 'character', { attrs: { hardPower: 0.05, network: 0.05, intel: 0.05, office: 0.05 }, lastActiveTick: 9 }),
        ent('e_old', '久未动者', 'character', { attrs: { hardPower: 0.9, network: 0.5, intel: 0.5, office: 0.5 }, lastActiveTick: 0 }),
    ];
    const w = mkWorld({
        entities,
        weights: { e_hi: 0.99, e_lo: 0.01, e_wave: 0.01, e_owner: 0.01, e_act: 0.01, e_old: 0.99 },
        events: [{ id: 'ev_1', title: '波及', ripples: ['e_wave'], closed: false }],
        agendas: [{ id: 'a_1', owner: 'e_owner', goal: '谋划', closed: false }],
        tick: 10,
        moveFact: { verb: '拜会', object: '低分量者' },
    });
    const lens = lensList(w, { moveFact: w.moveFact });
    const names = lens.map((x) => x.e.name);
    const boosted = ['低分量者', '被波及者', '有盘算者', '近活跃者'];
    assert.deepEqual([...names.slice(0, 4)].sort(), [...boosted].sort(), '前 4 位恰为保送四人（低分量也置顶）');
    assert.ok(boosted.every((n) => names.indexOf(n) < names.indexOf('高分量者')), '非保送的高分量者不得抢顶');
    assert.ok(names.indexOf('久未动者') > names.indexOf('高分量者'), '非保送段按分量降序');
});

test('K44: 分量降序（非保送段）与确定性逐字节', () => {
    const entities = [ent('e_a', '甲', 'character'), ent('e_b', '乙', 'character'), ent('e_c', '丙', 'character')];
    const weights = { e_a: 0.2, e_b: 0.8, e_c: 0.5 };
    const w = mkWorld({ entities, weights });
    const lens = lensList(w);
    assert.deepEqual(lens.map((x) => x.e.name), ['乙', '丙', '甲']);
    const p1 = buildEvolutionPack(w, null);
    const p2 = buildEvolutionPack(w, null);
    assert.equal(JSON.stringify(p1.pack), JSON.stringify(p2.pack));
});

test('K44: 镜头预算截断机制——小预算只留前缀（首名保底，空镜防御）', () => {
    const entities = Array.from({ length: 20 }, (_, i) => ent(`e_${i}`, `名${i}`, 'character'));
    const w = mkWorld({ entities, weights: Object.fromEntries(entities.map((e) => [e.id, 1])) });
    const lens = lensList(w, { lensMaxTokens: 5 });
    assert.ok(lens.length >= 1 && lens.length < 20);
    assert.equal(lens[0].e.name, '名0');
});

test('K44: 麾下成员打包——parent=势力名/分支名 双向归属，分量序 top8+等N人；无成员不带字段', () => {
    const members = Array.from({ length: 12 }, (_, i) => ent(`m_${i}`, `弟子${i}`, 'character', { parent: i % 2 === 0 ? '青龙会' : '盐帮' }));
    const entities = [
        ent('f_main', '青龙会', 'faction', { branches: ['盐帮', '漕帮'] }),
        ent('f_other', '白莲教', 'faction'),
        ...members,
    ];
    const weights = {};
    members.forEach((m, i) => { weights[m.id] = (12 - i) / 100; });
    weights.f_main = 0.9; weights.f_other = 0.9;
    const w = mkWorld({ entities, weights });
    const p = buildEvolutionPack(w, null);
    const row = p.pack.entities.find((x) => x.name === '青龙会');
    assert.ok(row.members, '青龙会应有麾下成员');
    assert.equal(row.members[0], '弟子0');                       // 分量最高者（弟子0=12/100 最高且 parent=青龙会）
    assert.equal(row.members.length, 9);                          // top8 + 「等N人」
    assert.equal(row.members[8], '等12人');
    assert.ok(row.branches.length === 2);
    assert.equal(p.pack.entities.find((x) => x.name === '白莲教').members, undefined);
});

test('K44: P3 保持——分量数字不随行泄漏（包文本零 weight 键）', () => {
    const entities = [ent('e_a', '甲', 'character')];
    const w = mkWorld({ entities, weights: { e_a: 0.9 } });
    const p = buildEvolutionPack(w, null);
    assert.ok(!JSON.stringify(p.pack).includes('weight'));
});