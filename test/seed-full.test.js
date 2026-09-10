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

function mkWorld(bookEntities, { tension = 0.5, entities = [], weights = {}, positions = ['中央'] } = {}) {
    return {
        context: { tension, positions, setting: { frozen: { canon: { bookEntities } } } },
        entities: [...entities],
        weights: { ...weights },
    };
}

test('leg21: 名册所在优先入账——书内明述的 location 随实体，无则落位置集首个/中立兜底', () => {
    const book = [
        { name: '昆仑道宫', kind: 'faction', location: '昆仑山' },
        { name: '散修甲', kind: 'character' },
    ];
    // leg25 D 组：名册所在必须 ∈ 位置集，否则落兜底词——所以夹具的位置集要含那个地名
    //（真实链路上位置集由 web 侧 derivePositions 按同一本书的地名建好，不会误杀）。
    const w = mkWorld(book, { positions: ['中央', '昆仑山'] });
    const r = seedBookEntities(w);
    assert.equal(r.seeded, 2);
    assert.equal(w.entities.find((e) => e.name === '昆仑道宫').location, '昆仑山', '名册所在优先');
    assert.equal(w.entities.find((e) => e.name === '散修甲').location, '中央', '无所在 → 位置集首个（测试夹具自设）');
    const w2 = mkWorld(book, { positions: ['中央', '昆仑山'] });
    w2.context.positions = [];
    const r2 = seedBookEntities(w2);
    assert.equal(r2.seeded, 2);
    assert.equal(w2.entities.find((e) => e.name === '散修甲').location, '未明', '无位置集 → 中立词「未明」');
});

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

test('leg24 片1/片2：名册里的旧 attrs/race 字段不采信，且**不预填任何数值**（空着就是空着）；形状过 schema', () => {
    const book = [
        // 旧世界可能还留着这些字段（leg20/leg21 抽的）——引擎已不读；入账也不预填
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
    assert.equal(f.race, undefined, 'race 不再从名册带进实体');
    assert.deepEqual(f.attrs, {}, '势力账面不预填数值（旧法填 0.25 四键；书里抄来的 0.9/0.8 也不采信）');
    const c = w.entities.find((e) => e.name === '白小娥');
    assert.deepEqual(c.attrs, {}, '角色账面同样空着');
    // 同属"账面无数" → 分数只剩两点差异：kind 的中立 floor（character 0.5 / faction 0.75 × 层基线）
    assert.ok(Math.abs(w.weights[c.id] - 0.5) < 1e-9, `人物中立 floor=0.5（实际 ${w.weights[c.id]}）`);
    assert.ok(Math.abs(w.weights[f.id] - 0.75) < 1e-9, `势力中立 floor=0.75（层基线 1.5；实际 ${w.weights[f.id]}）`);
    const checked = validate(w, ssotSchema);
    assert.equal(checked.ok, true, checked.errors.join('; '));
});