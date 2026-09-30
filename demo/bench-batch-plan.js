// story-world-v2/demo/bench-batch-plan.js
// 只读基准：批量补全为什么"进度像卡住"——量化每 tick 的规划开销与被调次数。
// 用真账（聊天 jsonl 副本）的 623 实体 + 真卡内置书 233 条，走**真函数** characterBookEntries / bookEntryText / planBatches。
// 用法：node demo/bench-batch-plan.js <聊天jsonl副本> <角色卡png路径>
import { readFileSync } from 'node:fs';
import { characterBookEntries, bookEntryText } from '../web/index.js';
import { planBatches } from '../src/entity-lookup.js';

function readWorld(file) {
    const raw = readFileSync(file, 'utf8');
    const h = JSON.parse(raw.slice(0, raw.indexOf('\n')));
    return h.chat_metadata.story_world_v2.world;
}
function cardFromPng(file) {
    const buf = readFileSync(file);
    let off = 8, card = null;
    while (off + 12 <= buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('latin1', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (type === 'tEXt') {
            const z = data.indexOf(0);
            if (data.toString('latin1', 0, z) === 'chara') card = JSON.parse(Buffer.from(data.subarray(z + 1).toString('latin1'), 'base64').toString('utf8'));
        }
        off += 12 + len;
        if (type === 'IEND') break;
    }
    return card;
}

const world = readWorld(process.argv[2]);
const book = characterBookEntries(cardFromPng(process.argv[3]));

// 与 web/index.js:706 bookTextForEntity 同款（读一次缓存书 + 命中 + 三档取文本），额外只做计数
let calls = 0, entryIterations = 0, snippetScans = 0;
async function bookTextForEntity(entity) {
    calls += 1;
    const name = String(entity?.name || '').trim();
    if (!name) return { ok: true, entries: [] };
    const hit = book.filter((e) => {
        entryIterations += 1;
        const comment = String(e?.comment || '').trim();
        const keys = Array.isArray(e?.key) ? e.key : [e?.key];
        return comment === name || comment.includes(name) || keys.map((k) => String(k ?? '').trim()).includes(name);
    });
    return {
        ok: true,
        entries: hit.slice(0, 4).map((e) => {
            const picked = bookEntryText(e?.content, name);
            if (picked.located === 'snippet') snippetScans += 1;
            return { name: String(e?.comment || name).trim(), text: picked.text, located: picked.located };
        }).filter((x) => x.text),
    };
}

const allIds = (world.entities || []).filter((e) => e.status !== 'dead' && e.status !== 'retired').map((e) => e.id);
console.log(`entities=${world.entities.length}  batch roster=${allIds.length}  book entries=${book.length}`);

// 一次完整规划（= 每 tick 干的事）
const t0 = Date.now();
const r1 = await planBatches({ world, ids: allIds, forceFields: 'absent', bookText: bookTextForEntity });
const t1 = Date.now();
console.log(`--- plan #1 (first tick) ---`);
console.log(`  batches=${r1.batches.length}  totalEntries=${r1.totalEntries}  totalChars=${r1.totalChars}  skipped=${r1.skipped.length}`);
console.log(`  wall=${t1 - t0} ms   bookTextForEntity calls=${calls}   book-entry iterations=${entryIterations}   snippetScans=${snippetScans}`);
if (r1.batches.length) {
    console.log(`  batch sizes (ids): ${r1.batches.map((b) => b.ids.length).join(', ')}`);
    console.log(`  batch chars: ${r1.batches.map((b) => b.chars).join(', ')}`);
}
{
    const byReason = {};
    for (const s of r1.skipped) byReason[s.reason] = (byReason[s.reason] || 0) + 1;
    console.log(`  skipped by reason: ${JSON.stringify(byReason)}`);
    const sampleIds = new Set(r1.batches.flatMap((b) => b.ids));
    const notChosen = allIds.filter((x) => !sampleIds.has(x));
    console.log(`  NOT chosen (${notChosen.length}) sample: ${notChosen.slice(0, 8).join(', ')}`);
    const e0 = (world.entities || []).find((e) => e.id === notChosen[0]);
    const rec = world.meta?.entityFields?.[notChosen[0]];
    console.log(`  why: ${notChosen[0]} = ${JSON.stringify(e0?.name)} kind=${e0?.kind} rec=${JSON.stringify(rec ?? null)}`);
    console.log(`  rosterIndex/name resolve check: entity has name? ${Boolean(e0?.name)} status=${JSON.stringify(e0?.status ?? null)}`);
}

// 模拟"每 tick 重新规划一次"（cursor 推进后剩余集变小的连锁成本）
for (const label of ['#2 (after 1 batch done)', '#3 (after 2 batches done)']) {
    const skip = r1.batches.length ? r1.batches[0].ids.length : 0;
    const rest = allIds.slice(skip * (label === '#2 (after 1 batch done)' ? 1 : 2));
    calls = 0; entryIterations = 0; snippetScans = 0;
    const a = Date.now();
    const r = await planBatches({ world, ids: rest, forceFields: 'absent', bookText: bookTextForEntity });
    const b = Date.now();
    console.log(`--- plan ${label} --- ids=${rest.length} batches=${r.batches.length} wall=${b - a} ms calls=${calls} iterations=${entryIterations}`);
}

console.log('NOTE: planning runs on the MAIN THREAD before every LLM call => tab jank + cursor only moves after a full tick.');
