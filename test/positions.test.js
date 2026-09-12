// story-world-v2/test/positions.test.js
// leg25 检察官审计处置（D 组）：位置集从书里现成的地名建——回归锁。
// 审计发现（旧法）：`context.positions` 建账写死 ['未明']、建账后全仓无写入点 →
//   实体位置全落「未明」、位置校验退化为单值比较、"移动"在结构上不可能。
// 来源不用新机制：canon.bookEntities 的 kind='location' 条目 + 各条目明述的 location 串。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { seedBookEntities } from '../src/abstract.js';
import { derivePositions, POSITIONS_CAP } from '../web/index.js';

const settingOf = (book) => ({ frozen: { fingerprint: 'f', extractedAt: 't', canon: { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [], bookEntities: book } } });

test('D-1 位置集来源：书里的地名条目 + 各条目明述的所在，兜底词永远在集内且排第一', () => {
    const pos = derivePositions(settingOf([
        { name: '大虞', kind: 'faction', location: '中天神洲·中州' },
        { name: '中天神洲', kind: 'location' },
        { name: '瑶池', kind: 'location' },
        { name: '蟠桃园', kind: 'location', location: '瑶池' },
        { name: '人族', kind: 'faction' },              // 没写所在 → 不贡献位置（也不该编）
    ]));
    assert.equal(pos[0], '未明', '兜底词恒在集内且第一（名册没带所在地的实体落在它上面=诚实）');
    assert.deepEqual(pos, ['未明', '中天神洲·中州', '中天神洲', '瑶池'], '书序；明述的所在优先于该条目自身名字');
    assert.equal(new Set(pos).size, pos.length, '不重复');
});

test('D-2 不发明地名：书里没有的一律不进集；空书/缺 setting → 只剩兜底词（旧账零扰动）', () => {
    assert.deepEqual(derivePositions(settingOf([])), ['未明']);
    assert.deepEqual(derivePositions(undefined), ['未明']);
    assert.deepEqual(derivePositions({ frozen: { canon: {} } }), ['未明']);
    assert.deepEqual(derivePositions({}), ['未明']);
});

// ★leg33c：这一格反转了。旧口径＝位置集按书序**截到 POSITIONS_CAP=60**；现在**不截断**。
//   依据（真账实测）：canon 有 **134** 个地点条目，被截掉 75 个真地名（`太清境`/`万魔殿`/`落英谷`…），
//   而模型写这些名字时**反被位置闸拒整步**。参照表实测极轻（134 项 ≈ 600 字符 ≈ 180 est）且不参与裁剪。
//   ★同时锁住"cap 形参还活着"（显式传有限值仍能截断——旧调用点不至于炸）。
test('D-3 已作废（leg33c）：位置集**不再截断**——书里多少地点就收多少；显式 cap 仍可截', () => {
    const book = Array.from({ length: 200 }, (_, i) => ({ name: `地${i}`, kind: 'location' }));
    const pos = derivePositions(settingOf(book));
    assert.equal(pos.length, 201, '200 个地点 + 兜底词「未明」全收（★不再按书序截断）');
    assert.equal(pos[0], '未明');
    assert.equal(pos[1], '地0');
    assert.equal(pos[200], '地199', '★最后一个地点必须还在——旧法会把它切掉');
    // 显式传有限 cap：仍按书序截断（兼容旧调用点/自设上限的用法）
    const capped = derivePositions(settingOf(book), { cap: 10 });
    assert.equal(capped.length, 10, '显式 cap=10 ⇒ 截到 10 项');
    assert.equal(capped[0], '未明');
});

test('D-4 落地效力：位置集建好后，实体真的分散到书里说的地方（不再全员「未明」）', () => {
    const book = [
        { name: '大虞', kind: 'faction', location: '中天神洲·中州' },
        { name: '万法阁', kind: 'faction', location: '昆仑山' },
        { name: '中天神洲', kind: 'location' },
        { name: '昆仑山', kind: 'location' },
        { name: '无据客', kind: 'character' },            // 书里没写所在
    ];
    const setting = settingOf(book);
    const world = {
        version: 1,
        context: { world: '大荒', tension: 0.5, positions: derivePositions(setting), setting },
        entities: [], weights: {}, agendas: [], events: [], chronicle: [], milestones: [],
        meta: { tick: 0, simLog: [] },
    };
    seedBookEntities(world);
    const loc = (n) => world.entities.find((e) => e.name === n)?.location;
    assert.equal(loc('大虞'), '中天神洲·中州', '书里写了所在 → 落那个地方');
    assert.equal(loc('万法阁'), '昆仑山');
    assert.equal(loc('无据客'), '未明', '书里没写 → 落兜底词（不编）');
    assert.equal(world.entities.filter((e) => e.location !== '未明').length >= 2, true, '位置真的分散了');
    const v = validate(world, ssotSchema);
    assert.equal(v.ok, true, v.errors.join('; '));
});

test('D-5 守闸：名册所在不在位置集内时落兜底词（否则实体位置会违反位置校验、整步被拒）', () => {
    // 构造"书里有 location 串、但位置集没把它收进去"的极端（cap 截断 / 手工账）：
    const setting = settingOf([{ name: '远方来客', kind: 'character', location: '书里没收录的地方' }]);
    const world = {
        version: 1,
        context: { world: '大荒', tension: 0.5, positions: ['未明'], setting },   // 位置集不含那个地名
        entities: [], weights: {}, agendas: [], events: [], chronicle: [], milestones: [],
        meta: { tick: 0, simLog: [] },
    };
    seedBookEntities(world);
    assert.equal(world.entities[0].location, '未明', '集外所在不落账 → 落兜底词（守住"实体位置 ∈ 位置集"）');
    const v = validate(world, ssotSchema);
    assert.equal(v.ok, true, v.errors.join('; '));
});
