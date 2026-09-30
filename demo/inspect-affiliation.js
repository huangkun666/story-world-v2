// story-world-v2/demo/inspect-affiliation.js
// 只读核验：势力↔角色 的关联账到底填没填（parent / branches / organs / 派生成员反查）。
// 两侧都查：
//   ① 账本侧：entities[].parent 覆盖率、branches/organs 有无、用 pack 的 membersOf 真函数做反查；
//   ② 来源侧（书）：书名录里的 parent 是**抽出来的**还是**结构里能推**的
//      —— 组织条目正文的成员行（`- 名号 (…)`）就是"这个角色属于该组织"的书面依据。
// 用法：node demo/inspect-affiliation.js <聊天jsonl副本> [角色卡png]
import { readFileSync } from 'node:fs';
import { membersOf } from '../src/pack.js';
import { characterBookEntries } from '../web/index.js';

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
const MEMBER_LINE = /^[-*·•\s]*([^\s(（:：]{2,16})\s*[（(]/gm;

const world = readWorld(process.argv[2]);
const ents = world.entities || [];
const chars = ents.filter((e) => e.kind === 'character');
const facs = ents.filter((e) => e.kind === 'faction');
const withParent = ents.filter((e) => e.parent);
const chWithParent = chars.filter((e) => e.parent);
const facWithBranches = facs.filter((e) => (e.branches || []).length);
const facWithOrgans = facs.filter((e) => (e.organs || []).length);

console.log('=== A. 账本侧（entities） ===');
console.log(`entities=${ents.length}  character=${chars.length}  faction=${facs.length}`);
console.log(`有 parent 的实体 = ${withParent.length}  （其中 character=${chWithParent.length}）`);
console.log(`有 branches 的势力 = ${facWithBranches.length}   有 organs 的势力 = ${facWithOrgans.length}`);
console.log(`parent 值样例 = ${JSON.stringify([...new Set(withParent.map((e) => e.parent))].slice(0, 8))}`);

// 派生反查（pack.js 真函数）：势力 → 麾下成员
let derived = 0;
const perFac = [];
for (const f of facs) {
    const m = membersOf(world, f) || [];
    if (m.length) { derived += 1; perFac.push(`${f.name}:${m.length}`); }
}
console.log(`用 pack.membersOf 能反查出成员的势力 = ${derived} / ${facs.length}`);
if (perFac.length) console.log(`  样例：${perFac.slice(0, 10).join('  ')}`);

console.log('=== B. 来源侧（书里能不能推） ===');
if (process.argv[3]) {
    const book = characterBookEntries(cardFromPng(process.argv[3]));
    // 书里"明述 parent"的形态：条目名里的「A的B」/ 标签，以及组织条目正文的成员行
    let orgEntries = 0, memberLines = 0, parsed = [];
    for (const e of book) {
        const content = String(e.content || '');
        MEMBER_LINE.lastIndex = 0;
        const names = [...content.matchAll(MEMBER_LINE)].map((m) => m[1]).filter((n) => n && n.length >= 2 && n.length <= 16);
        if (names.length >= 2) { orgEntries += 1; memberLines += names.length; parsed.push({ org: String(e.comment || ''), names }); }
    }
    console.log(`书的条目 = ${book.length}`);
    console.log(`含「成员行」的组织条目（≥2 个成员名）= ${orgEntries}   共解析出成员名 ${memberLines} 个`);
    for (const p of parsed.slice(0, 4)) console.log(`   【${p.org}】成员 ${p.names.length} 人：${p.names.slice(0, 6).join('、')}${p.names.length > 6 ? ' …' : ''}`);
    // 这些成员名在册吗？在册的话就能白捡 parent
    const roster = new Set(ents.map((e) => e.name));
    const matched = new Map();
    for (const p of parsed) for (const n of p.names) if (roster.has(n)) matched.set(n, p.org);
    console.log(`成员名中**在册**的 = ${matched.size}  ⇒ 这些人本可以白捡到 parent（零 token 结构推导）`);
    console.log(`  样例：${[...matched].slice(0, 8).map(([n, o]) => `${n}→${o}`).join('  ')}`);
    const already = [...matched.keys()].filter((n) => ents.find((e) => e.name === n)?.parent).length;
    console.log(`  其中账上**已经有** parent 的 = ${already}  ⇒ 缺口 = ${matched.size - already}`);
}
