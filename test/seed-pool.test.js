// story-world-v2/test/seed-pool.test.js
// ★★leg61（用户令「做种的候选只有 60 个吗？但是我是把所有实体都放进上下文了啊」）：
//   起根候选池的**排序键**——引导要指向"书里真有事的人"，不是"账本里排前面的人"。
// 为什么值得单独一条锁：旧法按账本顺序取前 60（真账实测：三国 385 个合格候选里，出现 ≥10 次的
//   114 个**一个都没进名单**，进的是按 kind 排在前面的国号与氏族）。这份名单**不是硬闸**
//   （模型确实会用名单外的名字，实测大荒 4/13、三国 3/14 人次），所以它出问题不会报错——
//   只会让起根"挑的人不对"。**没有判据的病就是这种病。**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeedCandidatePool } from '../web/index.js';

const mkWorld = (entities, { events = [], playerId = null } = {}) => ({
    context: { playerId },
    entities,
    events,
});

test('★leg61 起根候选池：按"本书出现次数"降序（不再按账本顺序）', () => {
    const entities = [
        { id: 'e1', name: '大汉', status: 'active' },      // 账本里排第一，但书里只在题名出现
        { id: 'e2', name: '诸葛亮', status: 'active' },     // 书里戏最多
        { id: 'e3', name: '关羽', status: 'active' },
        { id: 'e4', name: '路人甲', status: 'active' },
    ];
    const src = '诸葛亮' + '。'.repeat(3) + '诸葛亮 诸葛亮 关羽 关羽 关羽 大汉';
    const pool = buildSeedCandidatePool(mkWorld(entities), src, 3);
    assert.deepEqual(pool, ['关羽', '诸葛亮', '大汉'], `按出现次数降序（实际 ${JSON.stringify(pool)}）`);
});

test('★leg61 起根候选池：未上过台 / 非玩家 / 名号形态三道闸', () => {
    const entities = [
        { id: 'e1', name: '已上台', status: 'active' },
        { id: 'e2', name: '玩家', status: 'active' },
        { id: 'e3', name: '<user>', status: 'active' },     // 占位符真的在原文里 ⇒ 必须靠形态闸挡
        { id: 'e4', name: '一', status: 'active' },         // 单字名：长度闸挡（真书里有合法的单字地名，故这条只是"不进候选池"）
        { id: 'e5', name: '正常角色', status: 'active' },
        { id: 'e6', name: '退休者', status: 'retired' },
    ];
    const world = mkWorld(entities, { events: [{ id: 'ev1', ripples: ['e1'] }], playerId: 'e2' });
    const src = '已上台 玩家 <user> 一 正常角色 退休者 ' + '正常角色'.repeat(5);
    const pool = buildSeedCandidatePool(world, src, 60);
    assert.deepEqual(pool, ['正常角色'], `只留"未上台 ∧ 非玩家 ∧ 2-12 字 ∧ 无占位符"（实际 ${JSON.stringify(pool)}）`);
});

test('★leg61 起根候选池：并列按名字排（确定性 · 同输入同输出）', () => {
    const entities = [{ id: 'a', name: '乙' + '乙' }, { id: 'b', name: '甲' + '甲' }, { id: 'c', name: '丙' + '丙' }];
    const src = '甲乙丙';   // 三个名字各出现 0 次（都不在 src 的连续子串里）
    const w = mkWorld(entities);
    const p1 = buildSeedCandidatePool(w, src, 60);
    const p2 = buildSeedCandidatePool(w, src, 60);
    assert.deepEqual(p1, p2, '同输入同输出（候选池必须是确定性的，否则起根结果不可复现）');
    assert.deepEqual(p1, ['丙丙', '乙乙', '甲甲'], '并列时按名字排（UTF-16 码点序 · 确定性兜底）');
});
