// story-world-v2/demo/audit-leg25h-adversarial.js   （只读，不写任何文件）
// 对抗式自查：不验"我以为它对的地方"，专挑**会让用户看见错误的地方**问：
//   Q1 别名真能跨块合上吗（碎片化到底治没治好）
//   Q2 会不会**合错**（把不相关的势力并成一个 或 把不该并的并掉）
//   Q3 会不会**丢东西**（叫法/字段/k parent 丢了）
//   Q4 会不会**改变已有行为**（不传别名时，结果跟改之前一样吗）
//   Q5 边界：空名/空别名/别名指向自己/别名里写着另一个真实体名/超长别名表
// 每一项都打印实际结果，不看断言通过率——看输出本身对不对。
import { dedupeRoster } from '../src/abstract.js';

let bad = 0;
const check = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) bad += 1;
    console.log(`  ${ok ? '✓' : '✗ 不对'} ${label}`);
    if (!ok) { console.log(`        实际 = ${JSON.stringify(got)}`); console.log(`        期望 = ${JSON.stringify(want)}`); }
};
const names = (out) => out.map((m) => [m.name, ...(m.aliases || [])]);

console.log('=== Q1 碎片化治没治好：别名跨块合得上吗 ===');
check('同一实体两个叫法分在两块 → 合一条',
    names(dedupeRoster([{ name: '人族皇朝', kind: 'faction', aliases: ['大虞'] }, { name: '大虞', kind: 'faction' }])),
    [['人族皇朝', '大虞']]);
check('三个叫法分在三块 → 合一条（不是两条）',
    dedupeRoster([{ name: 'A', aliases: ['B'] }, { name: 'B', aliases: ['C'] }, { name: 'C' }]).length, 1);
check('先出现的碎片、后出现的正名 → 仍合一条',
    dedupeRoster([{ name: '大虞', kind: 'faction' }, { name: '人族皇朝', kind: 'faction', aliases: ['大虞'] }]).length, 1);

console.log('\n=== Q2 会不会合错（这条比 Q1 更要命）===');
check('不相关的三家绝不许合',
    dedupeRoster([{ name: '万法阁', kind: 'faction' }, { name: '无间魔宗', kind: 'faction' }, { name: '无间血海', kind: 'faction' }]).length, 3);
check('名字互为子串但不共享别名 → 不许合（昆仑 vs 昆仑道宫）',
    dedupeRoster([{ name: '昆仑', kind: 'faction' }, { name: '昆仑道宫', kind: 'faction' }]).length, 2);
check('同名不同 kind 只留一条（账上主键是 name）',
    dedupeRoster([{ name: '甲', kind: 'faction' }, { name: '甲', kind: 'character' }]).length, 1);
check('别名写着自己 → 不许无限自吞、不许丢条目',
    dedupeRoster([{ name: '甲', kind: 'faction', aliases: ['甲', '乙'] }, { name: '乙', kind: 'faction' }]).length, 1);

console.log('\n=== Q3 会不会丢东西 ===');
check('叫法一个不丢',
    names(dedupeRoster([{ name: '甲', aliases: ['乙'] }, { name: '乙', aliases: ['丙'] }, { name: '丙' }]))[0].slice().sort(),
    ['丙', '乙', '甲'].sort());
check('字段不丢（后一条补前一条的空）',
    dedupeRoster([{ name: '甲', kind: 'faction' }, { name: '甲', parent: '乙', location: '许昌', fields: { 规模: 'x' } }])[0],
    { name: '甲', kind: 'faction', parent: '乙', location: '许昌', fields: { 规模: 'x' } });
check('已有字段不许被覆盖（明述优先）',
    dedupeRoster([{ name: '甲', parent: '原上级' }, { name: '甲', parent: '新上级' }])[0].parent, '原上级');

console.log('\n=== Q4 会不会改变已有行为（旧账/旧数据零扰动）===');
check('不带别名、无重名 → 原样返回（逐条逐一相等）',
    names(dedupeRoster([{ name: '甲', kind: 'faction' }, { name: '乙', kind: 'character' }])),
    [['甲'], ['乙']]);
check('不带别名、有重名 → 跟改之前一样只留一条',
    dedupeRoster([{ name: '甲' }, { name: '甲' }]).length, 1);
check('顺序保持（200 条同形，首位/末位不变）',
    (() => { const o = dedupeRoster(Array.from({ length: 200 }, (_, i) => ({ name: `N${i}` }))); return [o[0].name, o[199].name]; })(),
    ['N0', 'N199']);

console.log('\n=== Q5 边界 ===');
check('空数组', dedupeRoster([]), []);
check('null/undefined 混入不炸', dedupeRoster([null, undefined, { name: '甲' }]).length, 1);
check('空名丢弃', dedupeRoster([{ name: '' }, { name: '   ' }]).length, 0);
check('别名是空串/非字符串 → 忽略不炸', dedupeRoster([{ name: '甲', aliases: ['', null, 123] }])[0].aliases, undefined);
check('别名里写着另一个真实体名 → 不把它吞成别名（防自造重复）',
    names(dedupeRoster([{ name: '甲', aliases: ['乙'] }, { name: '乙', kind: 'faction' }])).length, 1);
check('超长别名表（200 个）不炸', dedupeRoster([{ name: '甲', aliases: Array.from({ length: 200 }, (_, i) => `别名${i}`) }]).length, 1);
check('参数被省略', dedupeRoster().length, 0);

console.log(`\n${bad === 0 ? '★ 全部通过' : `★ 有 ${bad} 项不对（见上）`}`);
process.exit(bad === 0 ? 0 : 1);
