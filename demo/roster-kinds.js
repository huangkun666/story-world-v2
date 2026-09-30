// story-world-v2/demo/roster-kinds.js
// 第十九棒：书名录形态分析——kind 分布、势力名全单、角色抽样、疑似父子势力（名称含 归属词 模式），
// 供「全量棋盘 + 势力抽象」细案的数据依据（铁律 8）。用法：node demo/roster-kinds.js <导出世界json>
import { readFileSync } from 'node:fs';

const f = process.argv[2];
const o = JSON.parse(readFileSync(f, 'utf8'));
const w = o?.world ?? o;
const be = w?.context?.setting?.frozen?.canon?.bookEntities || [];
const by = {};
for (const b of be) by[b.kind] = (by[b.kind] || 0) + 1;
console.log('bookEntities total =', be.length, '| kinds =', JSON.stringify(by));

const factions = be.filter((b) => b.kind === 'faction');
console.log('--- factions 全部 (' + factions.length + ') ---');
console.log(factions.map((b) => b.name).join(', '));

const chars = be.filter((b) => b.kind === 'character');
console.log('--- characters 抽样 (' + chars.length + ' 条) ---');
console.log(chars.slice(0, 40).map((b) => b.name).join(', '));

// 疑似父子势力的浅层信号：父词（宗/门/派/盟/殿/宫/阁/族/国/教/府/帮/会/朝/山）结尾 vs 出现该词根的更短名
const suffixRe = /(宗|门|派|盟|殿|宫|阁|族|国|教|府|帮|会|朝|山|谷|岛|墟|洲)$/;
const fam = {};
for (const x of factions) { const m = x.name.match(suffixRe); if (m) { (fam[m[1]] = fam[m[1]] || []).push(x.name); } }
console.log('--- 按后缀归类的势力 (可能的父子候选锚) ---');
for (const [suf, names] of Object.entries(fam)) if (names.length > 1) console.log(`[${suf}] ${names.join(', ')}`);