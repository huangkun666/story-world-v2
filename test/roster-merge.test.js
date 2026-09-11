// story-world-v2/test/roster-merge.test.js
// leg25 h：跨块别名合并（`dedupeRoster`）的**对抗式锁**。
// ★为什么单独一个文件、为什么这么写（这一段是本文件存在的理由）：
//   本轮的教训是"**测试全绿不等于对**"。我加过一套复杂的正名排序裁决，测试全绿，
//   但里面有个真 bug（`【名号10】` 里的"名号1"被判成截断），**只有既有的一条书序锁碰巧抓住**；
//   而我自以为的"修复"改了个不改变行为的量，**测试照样全绿**——是我另写复现脚本才发现的。
//   后来改用对抗式自查，又当场查出两个测试没抓到的真问题：
//     ①链式别名合不上（`A→B`、`B→C` 只合直连 ⇒ 留下 2 条，**目的本身没达成**）
//     ②别名表里的 `""`/`null`/`123` 会原样进账
//   ⇒ 所以这个文件不写"我以为它对的地方"，专问**"哪里会出错"**：
//     治好了没有 / 会不会合错 / 会不会丢东西 / 会不会改变旧行为 / 边界崩不崩。
//   （同一套自查也留在 `demo/audit-leg25h-adversarial.js`，可随时复跑看输出。）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeRoster } from '../src/abstract.js';

const names = (out) => out.map((m) => [m.name, ...(m.aliases || [])]);

test('roster合并·Q1：碎片化治好了没有（含**链式**别名，真模型实测那一幕）', () => {
    // 直连：两个叫法分在两块
    assert.deepEqual(names(dedupeRoster([{ name: '人族皇朝', kind: 'faction', aliases: ['大虞'] }, { name: '大虞', kind: 'faction' }])),
        [['人族皇朝', '大虞']], '两个叫法合一条');
    // ★链式（真模型输出就是这形态：`人族皇朝 ← [大虞、大虞皇朝]` 与 `大虞皇朝 ← [大虞]` 共享 `大虞`）
    const chain = dedupeRoster([
        { name: '人族皇朝', aliases: ['大虞', '大虞皇朝'] },
        { name: '大虞皇朝', aliases: ['大虞'] },
    ]);
    assert.equal(chain.length, 1, '★链式别名必须合**一条**（旧法只合直连 ⇒ 留 2 条）');
    assert.deepEqual([chain[0].name, ...chain[0].aliases].sort(), ['人族皇朝', '大虞', '大虞皇朝'].sort(), '三个叫法一个不丢');
    // 三跳链
    assert.equal(dedupeRoster([{ name: 'A', aliases: ['B'] }, { name: 'B', aliases: ['C'] }, { name: 'C' }]).length, 1, 'A→B→C 也是 1 条');
    // 顺序不影响条数
    assert.equal(dedupeRoster([{ name: '大虞' }, { name: '人族皇朝', aliases: ['大虞'] }]).length, 1, '碎片在前也合');
});

test('roster合并·Q2：会不会**合错**（比漏合更要命）', () => {
    assert.equal(dedupeRoster([{ name: '万法阁' }, { name: '无间魔宗' }, { name: '无间血海' }]).length, 3,
        '★不相关的势力绝不许合（名字像但不共享别名）');
    assert.equal(dedupeRoster([{ name: '昆仑' }, { name: '昆仑道宫' }]).length, 2,
        '★名字互为子串但没共享别名 ⇒ 不许合（判据是别名，不是字面像）');
    assert.equal(dedupeRoster([{ name: '甲', kind: 'faction' }, { name: '甲', kind: 'character' }]).length, 1,
        '同名只留一条（账本主键是 name）');
    assert.equal(dedupeRoster([{ name: '甲', aliases: ['甲', '乙'] }, { name: '乙' }]).length, 1,
        '别名写着自己时不许无限自吞，也不许丢条目');
});

test('roster合并·Q3：会不会丢东西（叫法 / 字段 / 已有值）', () => {
    const m = dedupeRoster([{ name: '甲', aliases: ['乙'] }, { name: '乙', aliases: ['丙'] }, { name: '丙' }]);
    assert.equal(m.length, 1);
    assert.deepEqual([m[0].name, ...m[0].aliases].sort(), ['丙', '乙', '甲'].sort(), '★叫法一个不丢');
    assert.deepEqual(
        dedupeRoster([{ name: '甲', kind: 'faction' }, { name: '甲', parent: '乙', location: '许昌', fields: { 规模: 'x' } }])[0],
        { name: '甲', kind: 'faction', parent: '乙', location: '许昌', fields: { 规模: 'x' } },
        '缺的字段由后一条补上');
    assert.equal(dedupeRoster([{ name: '甲', parent: '原上级' }, { name: '甲', parent: '新上级' }])[0].parent, '原上级',
        '★已有值绝不覆盖（明述优先）');
});

test('roster合并·Q4：会不会改变旧行为（无别名时零扰动）', () => {
    assert.deepEqual(names(dedupeRoster([{ name: '甲', kind: 'faction' }, { name: '乙', kind: 'character' }])),
        [['甲'], ['乙']], '无别名无重名 ⇒ 原样返回');
    assert.equal(dedupeRoster([{ name: '甲' }, { name: '甲' }]).length, 1, '无别名有重名 ⇒ 仍只留一条');
    const o = dedupeRoster(Array.from({ length: 200 }, (_, i) => ({ name: `N${i}` })));
    assert.deepEqual([o[0].name, o[199].name], ['N0', 'N199'], '★顺序保持书序（曾被我的排序裁决弄红过）');
});

test('roster合并·Q5：边界不许炸、脏数据不许进账', () => {
    assert.deepEqual(dedupeRoster([]), [], '空数组');
    assert.deepEqual(dedupeRoster(), [], '参数省略');
    assert.equal(dedupeRoster([null, undefined, { name: '甲' }]).length, 1, 'null/undefined 混入不炸');
    assert.equal(dedupeRoster([{ name: '' }, { name: '   ' }]).length, 0, '空名丢弃');
    assert.equal(dedupeRoster([{ name: '甲', aliases: ['', null, 123, '  '] }])[0].aliases, undefined,
        '★别名里的空串/null/数字一律不进来（对抗式自查抓到的第二条）');
    assert.equal(dedupeRoster([{ name: '甲', aliases: Array.from({ length: 200 }, (_, i) => `别名${i}`) }]).length, 1, '超长别名表不炸');
});
