// story-world-v2/test/seed-full.test.js
// K43（full-roster-lens-spec C1/C7/C8 拍板）：全量棋盘入账 + 势力净化折叠 + 初始权重预填。
// 判据 A-1/A-2 的测试面：无席位截断 / location 不入池 / parent 折叠进 branches（链顶解析）/
// 弃关系防御（缺失/环/目标非势力）/ character parent 解析 / 幂等重跑 / 权重全覆盖与公式一致。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedBookEntities } from '../src/abstract.js';
import { computeWeight } from '../src/weight.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

function mkWorld(bookEntities, { tension = 0.5, entities = [], weights = {} } = {}) {
    return {
        context: { tension, positions: ['中央'], setting: { frozen: { canon: { bookEntities } } } },
        entities: [...entities],
        weights: { ...weights },
    };
}

test('K43: 全量入账无席位截断——角色+独立势力全部入账，location 不入池', () => {
    const book = [
        { name: '人族', kind: 'faction' }, { name: '妖族', kind: 'faction' },
        { name: '中天神洲', kind: 'location' }, { name: '十万大山', kind: 'location' },
        { name: '虞昭华', kind: 'character' }, { name: '秦红袖', kind: 'character' },
        { name: '龙素心', kind: 'character' },
    ];
    const w = mkWorld(book);
    const r = seedBookEntities(w);
    assert.equal(r.seeded, 5);                       // 2 势力 + 3 角色
    assert.equal(r.skippedLocation, 2);
    assert.equal(r.folded, 0);
    assert.equal(r.warnings.length, 0);
    assert.equal(w.entities.length, 5);
    assert.ok(!w.entities.some((e) => e.name === '中天神洲' || e.name === '十万大山'));
    assert.deepEqual(w.entities.map((e) => e.kind).sort(), ['character', 'character', 'character', 'faction', 'faction']);
});

test('K43: 子势力折叠——parent 名号不独立入账，归并进链顶实体 branches', () => {
    const book = [
        { name: '妖族', kind: 'faction' },
        { name: '万妖盟', kind: 'faction', parent: '妖族' },
        { name: '妖师宫', kind: 'faction', parent: '万妖盟' },   // 深链：解析到顶=妖族
        { name: '青丘国', kind: 'faction', parent: '妖族' },
    ];
    const w = mkWorld(book);
    const r = seedBookEntities(w);
    assert.equal(r.seeded, 1);                        // 只有链顶 妖族 独立入账
    assert.equal(r.folded, 3);
    const top = w.entities.find((e) => e.name === '妖族');
    assert.ok(top);
    assert.deepEqual([...top.branches].sort(), ['万妖盟', '妖师宫', '青丘国'].sort());   // 子名号全部平铺挂账
    assert.equal(w.entities.length, 1);
});

test('K43: 折叠防御——parent 缺失/自指/成环/目标非势力 → 弃关系+警告，名号仍独立入账', () => {
    const book = [
        { name: '大虞', kind: 'faction' },
        { name: '孤军', kind: 'faction', parent: '不存在的上级' },   // 缺失
        { name: '自指宗', kind: 'faction', parent: '自指宗' },       // 自指
        { name: '甲盟', kind: 'faction', parent: '乙盟' },           // 环（互为父）
        { name: '乙盟', kind: 'faction', parent: '甲盟' },
        { name: '挂名帮', kind: 'faction', parent: '虞昭华' },       // 目标非势力（是角色）
    ];
    const w = mkWorld(book);
    const r = seedBookEntities(w);
    assert.equal(r.folded, 0);
    // 6 个势力全部独立入账（5 个防御弃关系 + 大虞），警告 5 条
    assert.equal(w.entities.length, 6);
    assert.equal(r.warnings.length, 5);
    for (const e of w.entities) assert.equal(e.branches, undefined);
});

test('K43: 角色 parent 解析——合法所属写实体.parent；非法弃关系+警告，角色照常入账', () => {
    const book = [
        { name: '万法阁', kind: 'faction' },
        { name: '清玄真人', kind: 'character', parent: '万法阁' },
        { name: '散修甲', kind: 'character', parent: '不存在的门派' },
    ];
    const w = mkWorld(book);
    const r = seedBookEntities(w);
    assert.equal(w.entities.length, 3);
    const cleric = w.entities.find((e) => e.name === '清玄真人');
    assert.equal(cleric.parent, '万法阁');
    assert.equal(w.entities.find((e) => e.name === '散修甲').parent, undefined);
    assert.equal(r.warnings.length, 1);
});

test('K43: 初始分量预填——weights 全覆盖且与 computeWeight 同口径（context.tension）', () => {
    const book = [
        { name: '万法阁', kind: 'faction' },
        { name: '虞昭华', kind: 'character' },
    ];
    const w = mkWorld(book, { tension: 0.7 });
    seedBookEntities(w);
    assert.equal(Object.keys(w.weights).length, 2);
    for (const e of w.entities) {
        assert.equal(w.weights[e.id], computeWeight(e.attrs, e.kind, 0.7));
    }
});

test('K43: 幂等重跑与已有实体——重跑零新增；同名（含 retired）不重建；branches 合并去重', () => {
    const book = [
        { name: '青龙会', kind: 'faction' },
        { name: '盐帮', kind: 'faction', parent: '青龙会' },
        { name: '白小娥', kind: 'character' },
    ];
    const w = mkWorld(book);
    seedBookEntities(w);
    const first = {
        entities: w.entities.length,
        branches: w.entities.find((e) => e.name === '青龙会').branches.length,
        weights: Object.keys(w.weights).length,
    };
    const r2 = seedBookEntities(w);
    assert.equal(r2.seeded, 0);
    assert.equal(w.entities.length, first.entities);
    assert.equal(w.entities.find((e) => e.name === '青龙会').branches.length, first.branches);
    assert.equal(Object.keys(w.weights).length, first.weights);

    // 已 retired 的同名不重建（青龙会 入账 + 盐帮 折叠；白小娥 已在册跳过）
    const w2 = mkWorld(book, { entities: [{ id: 'e_old', kind: 'character', name: '白小娥', location: '中央', attrs: {}, status: 'retired', lastActiveTick: 0 }] });
    const r3 = seedBookEntities(w2);
    assert.equal(r3.seeded, 1);
    assert.equal(w2.entities.length, 2);
});

test('K43: 空书名录与 shape 防御', () => {
    const w = mkWorld([]);
    const r = seedBookEntities(w);
    assert.deepEqual(r, { seeded: 0, folded: 0, skippedLocation: 0, warnings: [] });
    assert.equal(w.entities.length, 0);

    const w2 = mkWorld([{ name: '老角色', kind: 'character' }], { entities: [{ id: 'e_1', kind: 'character', name: '老角色', location: '中央', attrs: {} }] });
    const r2 = seedBookEntities(w2);
    assert.equal(r2.seeded, 0);
    assert.equal(w2.entities.length, 1);
    assert.equal(w2.weights['e_1'], computeWeight({}, 'character', 0.5));   // 既有实体也完成预填
});

test('leg20 seed 吃抽象属性/种族：attrs 合并缺键兜底、race 随实体、权重差异化、形状过 schema', () => {
    const book = [
        { name: '万法阁', kind: 'faction', race: '人族', attrs: { hardPower: 0.9, office: 0.8 }, evidence: '灵脉霸主' },
        { name: '白小娥', kind: 'character' },
    ];
    const w = {
        version: 1,
        context: { world: '大荒', tension: 0.5, positions: ['中央'], setting: { frozen: { fingerprint: 'f', extractedAt: 't', canon: { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [], situation: '', bookEntities: book } }, dynamic: { tension: { polarity: '正邪', direction: '', intensity: 0.5 }, env: {} } } },
        entities: [],
        weights: {},
        agendas: [],
        events: [],
        chronicle: [],
        milestones: [],
        meta: { tick: 0, simLog: [] },
    };
    const r = seedBookEntities(w);
    assert.equal(r.seeded, 2);
    const f = w.entities.find((e) => e.name === '万法阁');
    assert.equal(f.race, '人族');
    assert.deepEqual(f.attrs, { hardPower: 0.9, office: 0.8, network: 0.25, intel: 0.25 }, '抽象属性合并，缺键按 faction 兜底');
    const c = w.entities.find((e) => e.name === '白小娥');
    assert.deepEqual(c.attrs, { hardPower: 0.15, office: 0.15, network: 0.15, intel: 0.15 }, '无属性名号按 kind 兜底');
    assert.ok(w.weights[f.id] !== w.weights[c.id], '差异化属性 → 差异化权重（镜头排序有意义）');
    const checked = validate(w, ssotSchema);
    assert.equal(checked.ok, true, checked.errors.join('; '));
});