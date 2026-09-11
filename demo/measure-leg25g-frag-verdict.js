// story-world-v2/demo/measure-leg25g-frag-verdict.js   （只读，只读用户真书）
// 细案取证第一步：14 组"碎块"逐组定性。三类判据**全部取自书自己**（无词表）：
//   A「别名」：某个书条目的 key 里**同时**列出了这一组里的多个名字 ⇒ 书自己说"这些是同一个"
//   B「上下级」：两个名字**各有自己的条目**，且其一条目正文里出现"隶属/下属/所属/受…管辖"这类**关系词**指向另一个
//   C「无据」：以上都无 ⇒ **不许合**（宁缺勿造：空壳难看，但合错是造假事实）
import { readFileSync } from 'node:fs';

const raw = readFileSync(process.env.SWV2_CHAT, 'utf8');
const world = JSON.parse(raw.slice(0, raw.indexOf('\n'))).chat_metadata.story_world_v2.world;
const book = world.context?.setting?.frozen?.canon?.bookEntities || [];
const ents = world.entities || [];

const bj = JSON.parse(readFileSync(process.env.SWV2_BOOK, 'utf8'));
const list = Array.isArray(bj.entries) ? bj.entries : Object.values(bj.entries || {});
const entries = list.filter((e) => e && typeof e === 'object').map((e) => ({
    comment: String(e.comment ?? e.name ?? '').trim(),
    content: String(e.content ?? ''),
    key: (Array.isArray(e.keys) ? e.keys : Array.isArray(e.key) ? e.key : [e.key]).map((k) => String(k ?? '').trim()).filter(Boolean),
    disable: e.disable === true || e.enabled === false,
})).filter((e) => !e.disable);
const entryByName = new Map(entries.map((e) => [e.comment, e]));

const crewOf = (nm) => ents.filter((e) => e.parent === nm).length;
const factions = book.filter((b) => b.kind === 'faction');

// 找"包含对"：碎片名是另一个名字的真子串
const pairs = [];
const facNames = factions.map((b) => b.name);
for (const frag of facNames) {
    if (frag.length < 2) continue;
    const containers = facNames.filter((m) => m !== frag && m.includes(frag));
    if (!containers.length) continue;
    pairs.push({ frag, containers });
}

console.log('leg25 g · 碎块定性（判据取自书自身）\n');
console.log(`canon faction ${factions.length} · 账上麾下为空的 ${factions.filter((b) => crewOf(b.name) === 0).length}\n`);

const tally = { A: 0, B: 0, C: 0 };
const rows = [];
for (const p of pairs) {
    // A：某个条目 key 里同时含 frag 与某 container
    let aliasVia = null;
    for (const e of entries) {
        if (e.key.includes(p.frag) && p.containers.some((c) => e.key.includes(c))) { aliasVia = e.comment; break; }
    }
    // B：frag 或 container 有自己的条目，且正文里有关系词把两者连起来
    let relVia = null;
    if (!aliasVia) {
        for (const nm of [p.frag, ...p.containers]) {
            const own = entryByName.get(nm);
            if (!own) continue;
            const other = nm === p.frag ? p.containers[0] : p.frag;
            const re = new RegExp(`(?:隶属|下属|所属|受[^\\n]{0,6}管辖|归[^\\n]{0,4}管|分属|统辖|节制)[^\\n]{0,20}${other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
            if (re.test(own.content)) { relVia = `${nm} 条目正文提到「${other}」`; break; }
        }
    }
    const verdict = aliasVia ? 'A·别名（可合）' : (relVia ? 'B·上下级（该挂链，不该合并成员）' : 'C·无据（不许合）');
    if (aliasVia) tally.A += 1; else if (relVia) tally.B += 1; else tally.C += 1;
    rows.push({ ...p, verdict, aliasVia, relVia, crew: [p.frag, ...p.containers].map((n) => crewOf(n)) });
}

for (const r of rows.sort((a, b) => (a.verdict > b.verdict ? 1 : -1))) {
    const names = [r.frag, ...r.containers].map((n, i) => `${n}(${r.crew[i]}人)`).join(' / ');
    console.log(`[${r.verdict}] ${names}`);
    if (r.aliasVia) console.log(`     依据：条目[${r.aliasVia}] 的 key 同时列出这些名字`);
    if (r.relVia) console.log(`     依据：${r.relVia}`);
}
console.log(`\n★合计：A 可合 ${tally.A} 组 · B 上下级 ${tally.B} 组 · C 无据不许合 ${tally.C} 组`);

// 影响面：A 类合并能救活多少"本该有成员"的空壳
const aFrag = rows.filter((r) => r.verdict.startsWith('A'));
let rescued = 0;
for (const r of aFrag) {
    for (let i = 1; i < r.crew.length; i += 1) if (r.crew[i] === 0) rescued += 1;
}
console.log(`\n★影响面：A 类合并会让 ${aFrag.length} 组里的 ${rescued} 个空壳节点消失（其成员归到真正有人那个名字下）`);
console.log(`  账上"有麾下"的势力现为 ${factions.filter((b) => crewOf(b.name) > 0).length} / ${factions.length}`);
