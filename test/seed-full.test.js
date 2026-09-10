// story-world-v2/test/seed-full.test.js
// K43（full-roster-lens-spec C1/C7/C8 拍板）：全量棋盘入账 + 势力净化折叠 + 初始权重预填。
// 判据 A-1/A-2 的测试面：无席位截断 / location 不入池 / parent 折叠进 branches（链顶解析）/
// 弃关系防御（缺失/环/目标非势力）/ character parent 解析 / 幂等重跑 / 权重全覆盖与公式一致。
// leg25 c 追加（用户令「删」四维浮点）：本文件同时是"入账**不预填任何数值**"的锁面——账上连 `attrs` 键
//   都不许有（旧法按 kind 预填四维默认值 0.15/0.25），名册里的内容也不许流进实体；形状必须过 schema。
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
        // leg25 c：实体账上已无 `attrs`（四维浮点整条删除），公式也不再吃属性 ⇒ 直接传空对象同值；
        //   本条的意图（预填分量与 computeWeight 同口径、吃 context.tension）一字不改。
        assert.equal(w.weights[e.id], computeWeight({}, e.kind, 0.7));
        // 张力 0.7 真的进了式子：envFactor = 1 + 0.2×(0.7−0.5) = 1.04 ⇒ 势力 0.85×1.04 = 0.884；
        //   人物 1.0×1.04 = 1.04 → 被 clamp01 截平回 1（人物层基础分贴着上界，见 weight.test 登记）。
        const expect = e.kind === 'faction' ? 0.85 * 1.04 : 1;
        assert.ok(Math.abs(w.weights[e.id] - expect) < 1e-9, `${e.kind} 预填吃张力（期望 ${expect}，实际 ${w.weights[e.id]}）`);
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
    // leg25 c：既有实体夹具也不带 `attrs`（账上不该有那个键——引擎既不读也不写）
    const w2 = mkWorld(book, { entities: [{ id: 'e_old', kind: 'character', name: '白小娥', location: '中央', status: 'retired', lastActiveTick: 0 }] });
    const r3 = seedBookEntities(w2);
    assert.equal(r3.seeded, 1);
    assert.equal(w2.entities.length, 2);
});

test('K43: 空书名录与 shape 防御', () => {
    const w = mkWorld([]);
    const r = seedBookEntities(w);
    assert.deepEqual(r, { seeded: 0, folded: 0, skippedLocation: 0, warnings: [] });
    assert.equal(w.entities.length, 0);

    const w2 = mkWorld([{ name: '老角色', kind: 'character' }], { entities: [{ id: 'e_1', kind: 'character', name: '老角色', location: '中央' }] });
    const r2 = seedBookEntities(w2);
    assert.equal(r2.seeded, 0);
    assert.equal(w2.entities.length, 1);
    assert.equal(w2.weights['e_1'], computeWeight({}, 'character', 0.5));   // 既有实体也完成预填
});

test('leg25 c：入账**不预填任何数值**（空着就是空着）——账面没有四维键，分数只有层基线；形状过 schema', () => {
    const book = [
        // 名册条目只留身份（name/kind/parent/location）——`attrs`/`evidence` 已从 canon.bookEntities 形状里
        //   整条删除（schema additional:false ⇒ 带它们的名册条目当场校验不过），故夹具不再摆这两个键。
        //   `race` 仍是形状内的合法可选键：本条的意图是"名册里的东西**不自动流进实体**"，故留着当探针用。
        { name: '万法阁', kind: 'faction', race: '人族' },
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
    // leg25 c：不是"填空对象"，是**根本没有这个键**（旧法：势力预填 0.25 四键 / 人物预填 0.15 四键）
    assert.equal('attrs' in f, false, '势力账面上连 attrs 键都不该有（空格不是 0.25）');
    assert.deepEqual(Object.keys(f).sort(), ['id', 'kind', 'location', 'name'], `入账形状只剩身份+位置（实际 ${JSON.stringify(f)}）`);
    const c = w.entities.find((e) => e.name === '白小娥');
    assert.equal('attrs' in c, false, '角色账面同样没有该键');
    assert.equal(Object.keys(c).some((k) => /hardPower|office|network|intel|兵力|权位|人脉|耳目/.test(k)), false, '四维一个都不许有（含改名的）');
    // 分数只剩层基线一个输入：人物 1.0（0.85 是势力层，见 weight.test 重基线）——
    //   旧法此处是"中立 floor 0.5 / 势力 0.75"，那是属性缺键取中立的产物，已随公式删除。
    assert.ok(Math.abs(w.weights[c.id] - 1.0) < 1e-9, `人物基础分=层基线 1.0（实际 ${w.weights[c.id]}）`);
    assert.ok(Math.abs(w.weights[f.id] - 0.85) < 1e-9, `势力基础分=层基线 0.85（实际 ${w.weights[f.id]}）`);
    const checked = validate(w, ssotSchema);
    assert.equal(checked.ok, true, checked.errors.join('; '));
});