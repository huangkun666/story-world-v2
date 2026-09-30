// story-world-v2/demo/measure-leg25g-emptyfrag.js   （只读，只读用户真书 + 副本）
// 关键一问：108 个空壳势力，是"书里本来就没写成员"（诚实空着），
//   还是"书里写了成员但没挂上"（真缺陷）？—— 逐条拿书里的花名册条目对。
import { readFileSync } from 'node:fs';

const raw = readFileSync(process.env.SWV2_CHAT, 'utf8');
const world = JSON.parse(raw.slice(0, raw.indexOf('\n'))).chat_metadata.story_world_v2.world;
const book = world.context?.setting?.frozen?.canon?.bookEntities || [];
const ents = world.entities || [];
const crewOf = (nm) => ents.filter((e) => e.parent === nm).length;

const bj = JSON.parse(readFileSync(process.env.SWV2_BOOK, 'utf8'));
const list = Array.isArray(bj.entries) ? bj.entries : Object.values(bj.entries || {});
const entries = list.filter((e) => e && typeof e === 'object').map((e) => ({
    comment: String(e.comment ?? e.name ?? '').trim(),
    content: String(e.content ?? ''),
    key: (Array.isArray(e.keys) ? e.keys : Array.isArray(e.key) ? e.key : [e.key]).map((k) => String(k ?? '').trim()).filter(Boolean),
    disable: e.disable === true || e.enabled === false,
})).filter((e) => !e.disable);
const MEMBER_LINE = /^[-*·•\s]*([^\s(（:：、,]{2,20})\s*[（(]/gm;
const names = new Set(ents.map((e) => e.name));

const empty = book.filter((b) => b.kind === 'faction' && crewOf(b.name) === 0);
console.log(`leg25 g · 空壳势力归因（canon faction ${book.filter((b) => b.kind === 'faction').length} · 空壳 ${empty.length}）\n`);

const buckets = { 书里没花名册: [], 花名册里的人不在册: [], 花名册有在册角色但没挂上: [] };
for (const b of empty) {
    const nm = b.name;
    // 该势力名下能在书里找到什么：同名条目 ∪ key 命中该名的条目
    const cands = entries.filter((e) => e.comment === nm || e.key.includes(nm));
    const withRows = cands.filter((e) => { MEMBER_LINE.lastIndex = 0; return [...e.content.matchAll(MEMBER_LINE)].length >= 2; });
    const members = new Set();
    for (const e of withRows) { MEMBER_LINE.lastIndex = 0; for (const m of e.content.matchAll(MEMBER_LINE)) members.add(m[1].trim()); }
    const inLedger = [...members].filter((m) => names.has(m));
    if (!members.size) buckets.书里没花名册.push(nm);
    else if (!inLedger.length) buckets.花名册里的人不在册.push(`${nm}（花了 ${members.size} 行，0 个在册）`);
    else buckets.花名册有在册角色但没挂上.push(`${nm}（在册角色 ${inLedger.length}：${inLedger.slice(0, 6).join('、')}）`);
}

for (const [k, v] of Object.entries(buckets)) {
    console.log(`【${k}】${v.length} 个`);
    for (const x of v.slice(0, 14)) console.log(`    ${x}`);
    if (v.length > 14) console.log(`    …另有 ${v.length - 14} 个`);
    console.log('');
}
console.log('★判读：');
console.log(`  「书里没花名册」= 诚实空着（不是缺陷）`);
console.log(`  「花名册里的人不在册」= 抽象漏抽了那些角色（或那些行不是名号）`);
console.log(`  「有在册角色但没挂上」= ★真缺陷（书里写了成员，账上却空）`);
