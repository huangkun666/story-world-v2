// story-world-v2/demo/diag-leg25g-chunks.js   （只读）
// 三个「大虞」是不是落在**同一块**里？—— 决定"块间合并"要不要现在动。
import { readFileSync } from 'node:fs';
import { chunkRows, ROSTER_CHUNK_CHAR } from '../src/abstract.js';

const b = JSON.parse(readFileSync(process.env.SWV2_BOOK, 'utf8'));
const es = Object.values(b.entries || {});
const rows = es.filter((e) => e && e.disable !== true).map((e) => {
    const key = String(e.comment || (Array.isArray(e.key) ? e.key[0] : e.key) || '');
    const c = String(e.content || '').trim();
    return c ? `【${key}】${c}` : null;
}).filter(Boolean);

const chunks = chunkRows(rows, ROSTER_CHUNK_CHAR);      // 每块是一个**字符串**（行已 join）
const linesOf = (c) => c.split('\n');
console.log(`行 ${rows.length} · 块 ${chunks.length} · 上限 ${ROSTER_CHUNK_CHAR} 字符/块`);
console.log(`每块字符 = ${JSON.stringify(chunks.map((c) => Array.from(c).length))}\n`);

const where = (nm) => {
    const hit = [];
    chunks.forEach((c, i) => { if (linesOf(c).some((r) => r.startsWith(`【${nm}】`))) hit.push(i + 1); });
    return hit;
};
console.log('=== 关键条目落在第几块 ===');
for (const nm of ['人族皇朝', '大虞', '大虞皇朝', '昆仑道宫', '瑶池', '隐世圣地·瑶池', '忘忧凡川', '落雪寒洲', '承天神朝', '太昊仙洲']) {
    const w = where(nm);
    console.log(`  【${nm}】→ ${w.length ? `第 ${w.join('、')} 块` : '★书里没有同名字条目'}`);
}

// 关键问题：含「大虞」字样的**块**
console.log('\n=== 含「大虞」字样的块分布 ===');
chunks.forEach((c, i) => {
    const n = linesOf(c).filter((r) => r.includes('大虞')).length;
    if (n) console.log(`  第 ${i + 1} 块：${n} 行提到「大虞」`);
});
