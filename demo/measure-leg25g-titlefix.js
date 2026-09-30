// story-world-v2/demo/measure-leg25g-titlefix.js   （只读，只读用户真书 + 副本）
// 细案取证：花名册成员名与账上名号精确匹配不上时，用「取 `·` 之后最后一段」再试一次，影响面多大？
//   依据（本仓已有先例，不是新发明的规则）：`混乱之地·万妖盟`→`万妖盟`（bookNameAlias）、
//   `南荒部洲·十万大山`→`十万大山`（normalizeToPositionSet）——`·` 是书里的**层级分隔符**。
//   纪律：只在**精确匹配失败**时兜底；候选必须**唯一**（歧义就不挂）；只填空位（已有归属不覆盖）。
import { readFileSync } from 'node:fs';

const raw = readFileSync(process.env.SWV2_CHAT, 'utf8');
const world = JSON.parse(raw.slice(0, raw.indexOf('\n'))).chat_metadata.story_world_v2.world;
const book = world.context?.setting?.frozen?.canon?.bookEntities || [];
const ents = world.entities || [];
const byName = new Map(ents.map((e) => [e.name, e]));
const onLedger = new Map(ents.filter((e) => e.parent).map((e) => [e.name, e.parent]));

const bj = JSON.parse(readFileSync(process.env.SWV2_BOOK, 'utf8'));
const list = Array.isArray(bj.entries) ? bj.entries : Object.values(bj.entries || {});
const entries = list.filter((e) => e && typeof e === 'object').map((e) => ({
    comment: String(e.comment ?? e.name ?? '').trim(),
    content: String(e.content ?? ''),
    key: (Array.isArray(e.keys) ? e.keys : Array.isArray(e.key) ? e.key : [e.key]).map((k) => String(k ?? '').trim()).filter(Boolean),
    disable: e.disable === true || e.enabled === false,
})).filter((e) => !e.disable);
const MEMBER_LINE = /^[-*·•\s]*([^\s(（:：、,]{2,20})\s*[（(]/gm;

// 兜底解析：精确 → 取 `·` 后最后一段（唯一命中才算）
function resolveMember(nm) {
    if (byName.has(nm)) return { name: nm, how: 'exact' };
    const parts = nm.split(/[·・•]/).map((s) => s.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 1; i -= 1) {
        const cand = parts.slice(i).join('');
        const hits = [...byName.keys()].filter((L) => L === cand || L.endsWith(cand));
        if (hits.length === 1) return { name: hits[0], how: `取末段(${cand})` };
        if (hits.length > 1) return { name: null, how: `歧义(${cand}:${hits.length})` };
    }
    return { name: null, how: 'none' };
}

const empty = book.filter((b) => b.kind === 'faction' && !ents.some((e) => e.parent === b.name));
const newWrites = [];
const rescued = new Set();
let ambiguous = 0, stillNothing = 0;
for (const b of empty) {
    const nm = b.name;
    const cands = entries.filter((e) => e.comment === nm || e.key.includes(nm));
    const members = new Set();
    for (const e of cands) { MEMBER_LINE.lastIndex = 0; for (const m of e.content.matchAll(MEMBER_LINE)) members.add(m[1].trim()); }
    for (const m of members) {
        if (m === nm) continue;
        const r = resolveMember(m);
        if (!r.name) { if (r.how.startsWith('歧义')) ambiguous += 1; continue; }
        const ent = byName.get(r.name);
        if (!ent || ent.kind !== 'character') continue;
        rescued.add(nm);
        if (!onLedger.has(r.name) && !newWrites.some((w) => w.name === r.name)) {
            newWrites.push({ name: r.name, org: nm, how: r.how, from: m });
        }
    }
}

console.log('leg25 g · 「头衔式成员名」兜底改法的影响面\n');
console.log(`空壳势力 ${empty.length} 个中被救活的 = ${rescued.size}：${JSON.stringify([...rescued].slice(0, 20))}`);
console.log(`歧义跳过（同名候选 >1，不挂）= ${ambiguous} 条`);
console.log(`\n★真正会新写入的归属 = ${newWrites.length} 条：`);
for (const w of newWrites) console.log(`    ${w.name} → ${w.org}   （书里写作「${w.from}」，走 ${w.how}）`);
const selfRef = newWrites.filter((w) => w.name === w.org);
console.log(`\n自指 = ${selfRef.length}｜账上已有归属被覆盖 = 0（本改法只填空位）`);
