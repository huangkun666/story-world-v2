// story-world-v2/demo/measure-inherit-safety.js  (只读：位置继承推出来的值，真的 ∈ 位置集吗)
import { readFileSync } from 'node:fs';
import { deriveLocationFromBook } from '../src/entity-lookup.js';

const p = process.env.SWV2_CHAT;
const raw = readFileSync(p, 'utf8');
const box = JSON.parse(raw.slice(0, raw.indexOf('\n'))).chat_metadata.story_world_v2;
const w = box.world || {};
const positions = w.context?.positions || [];

console.log('=== 位置集全文（60 项） ===');
positions.forEach((x, i) => process.stdout.write(`${i}:${JSON.stringify(x)}  `));
console.log('\n');

// 真书条目
const b = JSON.parse(readFileSync(process.env.SWV2_BOOK, 'utf8'));
const rawE = b.entries;
const list = Array.isArray(rawE) ? rawE : Object.values(rawE || {});
const entries = list.filter((e) => e && typeof e === 'object').map((e) => ({
    comment: String(e.comment ?? e.name ?? '').trim(),
    content: String(e.content ?? ''),
    key: (Array.isArray(e.keys) ? e.keys : Array.isArray(e.key) ? e.key : [e.key]).map((k) => String(k ?? '').trim()).filter(Boolean),
    disable: e.disable === true || e.enabled === false,
})).filter((e) => !e.disable);

const d = deriveLocationFromBook({ world: w, entries });
console.log('=== 推出来的 173 个值：逐条检查 ∈ 位置集？ ===');
const set = new Set(positions);
const bad = [];
for (const a of d.stats.assigned) {
    const m = /→(.*)$/.exec(a);
    if (m && !set.has(m[1])) bad.push({ entity: a.split('→')[0], loc: m[1] });
}
console.log(`推入总数 = ${d.stats.assigned.length}；**不在位置集内的 = ${bad.length}**`);
for (const x of bad.slice(0, 15)) console.log(`   ✗ ${x.entity} → ${JSON.stringify(x.loc)}   长度=${x.loc.length}`);

console.log('\n=== 这些值超出多久（位置集最长项多长） ===');
const lens = positions.map((x) => x.length).sort((a, b) => b - a);
console.log(`位置集最长 = ${lens[0]}（${JSON.stringify(positions.find((x) => x.length === lens[0]))}）`);
if (bad.length) {
    const bl = bad.map((x) => x.loc.length).sort((a, b) => b - a);
    console.log(`推入值最长 = ${bl[0]}，最短 = ${bl[bl.length - 1]}`);
}
