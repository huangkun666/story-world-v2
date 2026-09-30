// story-world-v2/demo/measure-positions-origin.js  (只读：位置集这 60 项到底从书里哪来)
import { readFileSync } from 'node:fs';

const raw = readFileSync(process.env.SWV2_CHAT, 'utf8');
const box = JSON.parse(raw.slice(0, raw.indexOf('\n'))).chat_metadata.story_world_v2;
const w = box.world || {};
const book = w.context?.setting?.frozen?.canon?.bookEntities || [];
const positions = w.context?.positions || [];

const loc = book.filter((b) => b.kind === 'location');
console.log(`canon.bookEntities = ${book.length}；kind='location' = ${loc.length}`);
console.log(`位置集 = ${positions.length}（首位是兜底词「未明」⇒ 来自书的至多 ${positions.length - 1} 项）`);
console.log('\nkind=location 条目名（前 25）：');
loc.slice(0, 25).forEach((b, i) => console.log(`  ${i}: ${JSON.stringify(b.name)} (len=${b.name.length})`));

const set = new Set(positions);
const locNames = loc.map((b) => b.name);
const inSet = locNames.filter((n) => set.has(n));
console.log(`\nlocation 条目名 ∈ 位置集 的 = ${inSet.length} / ${locNames.length}`);

console.log('\n位置集里每一项的来源判定：');
for (const p of positions) {
    if (p === '未明') { console.log(`  ${JSON.stringify(p)} = 兜底词（derivePositions 的 fallback）`); continue; }
    const asLoc = locNames.includes(p);
    const asAny = book.find((b) => b.name === p);
    console.log(`  ${JSON.stringify(p)}  kind=location条目? ${asLoc ? '是' : '否'}  其他条目同名? ${asAny ? asAny.kind : '无'}`);
}
