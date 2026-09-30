// story-world-v2/demo/measure-leg25g-notinledger.js   （只读，只读用户真书 + 副本）
// 51 个「书里有花名册、但花名册里的人不在册」——再拆一层：
//   ① 那些名字**变体后**能不能对上在册实体（复合名 vs 短名：`圣祖·帝释天` vs `帝释天`）⇒ 是"名字形态"问题
//   ② 完全对不上 ⇒ 抽象真的没抽出这些角色（或那些行根本不是名号）
import { readFileSync } from 'node:fs';

const raw = readFileSync(process.env.SWV2_CHAT, 'utf8');
const world = JSON.parse(raw.slice(0, raw.indexOf('\n'))).chat_metadata.story_world_v2.world;
const book = world.context?.setting?.frozen?.canon?.bookEntities || [];
const ents = world.entities || [];
const crewOf = (nm) => ents.filter((e) => e.parent === nm).length;
const ledgerNames = ents.filter((e) => e.kind === 'character').map((e) => e.name);

const bj = JSON.parse(readFileSync(process.env.SWV2_BOOK, 'utf8'));
const list = Array.isArray(bj.entries) ? bj.entries : Object.values(bj.entries || {});
const entries = list.filter((e) => e && typeof e === 'object').map((e) => ({
    comment: String(e.comment ?? e.name ?? '').trim(),
    content: String(e.content ?? ''),
    key: (Array.isArray(e.keys) ? e.keys : Array.isArray(e.key) ? e.key : [e.key]).map((k) => String(k ?? '').trim()).filter(Boolean),
    disable: e.disable === true || e.enabled === false,
})).filter((e) => !e.disable);
const MEMBER_LINE = /^[-*·•\s]*([^\s(（:：、,]{2,20})\s*[（(]/gm;

const empty = book.filter((b) => b.kind === 'faction' && crewOf(b.name) === 0);
let variantHit = 0, noHit = 0;
const samples = { variant: [], none: [] };
for (const b of empty) {
    const nm = b.name;
    const cands = entries.filter((e) => e.comment === nm || e.key.includes(nm));
    const members = new Set();
    for (const e of cands) { MEMBER_LINE.lastIndex = 0; for (const m of e.content.matchAll(MEMBER_LINE)) members.add(m[1].trim()); }
    if (!members.size) continue;
    const inLedger = [...members].filter((m) => ledgerNames.includes(m));
    if (inLedger.length) continue;               // 归第 3 类
    // 变体匹配：成员名与某个在册角色互为子串（取最长）
    const variants = [];
    for (const m of members) {
        const hit = ledgerNames.filter((L) => L.includes(m) || m.includes(L)).sort((a, b) => b.length - a.length)[0];
        if (hit) variants.push(`${m}≈${hit}`);
    }
    if (variants.length) {
        variantHit += 1;
        if (samples.variant.length < 10) samples.variant.push(`${nm}：${variants.slice(0, 5).join('、')}`);
    } else {
        noHit += 1;
        if (samples.none.length < 10) samples.none.push(`${nm}：书里列了 ${members.size} 行，例如 ${[...members].slice(0, 4).join('、')}`);
    }
}
console.log('leg25 g · 「花名册里的人不在册」再拆一层\n');
console.log(`★变体后能对上在册角色（= 名字形态问题）= ${variantHit} 个势力`);
for (const s of samples.variant) console.log(`    ${s}`);
console.log(`\n★怎么都对不上（= 抽象确实没抽这些角色，或那些行不是名号）= ${noHit} 个势力`);
for (const s of samples.none) console.log(`    ${s}`);
console.log(`\n（在册角色 ${ledgerNames.length} 个；canon 角色条目 ${book.filter((b) => b.kind === 'character').length} 个）`);
