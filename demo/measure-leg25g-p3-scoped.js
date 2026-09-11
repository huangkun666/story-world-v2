// story-world-v2/demo/measure-leg25g-p3-scoped.js   （只读，只读副本）
// leg25 g · P3 收窄版测量：**只从 canon 的势力条目出发**给它找别名书条目。
//   （上一版扩到"任意 key 命中任意势力名" ⇒ 多书实测炸了：三国 735 条假关系、大荒 10087 条、自指 225。
//     见 measure-leg25g-p3-genericity.js。收窄后重出曲线。）
// 机制：对每个 canon 势力条目 b：
//     候选书条目 = { e : e.comment === b.name } ∪ { e : e.key.includes(b.name) }
//     仅当候选条目**正文里扫得出成员行**时才认；成员只认**canon 在册角色**；已有 parent 不覆盖。
// 判据：①自指必须 0；②真正新写入的逐条人看；③其它书要么不生效、要么不炸。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MEMBER_LINE } from '../src/abstract.js';

const chatPath = process.env.SWV2_CHAT;
const dir = process.argv[2];
if (!chatPath || !dir) { console.error('需要 SWV2_CHAT 与 "<worlds 目录>"'); process.exit(2); }

const raw = readFileSync(chatPath, 'utf8');
const world = JSON.parse(raw.slice(0, raw.indexOf('\n'))).chat_metadata.story_world_v2.world;
const canonBook = world.context?.setting?.frozen?.canon?.bookEntities || [];
const ents = world.entities || [];
const byName = new Map(ents.map((e) => [e.name, e]));
const onLedger = new Map(ents.filter((e) => e.parent).map((e) => [e.name, e.parent]));

function loadEntries(file) {
    const b = JSON.parse(readFileSync(file, 'utf8'));
    const raw2 = b.entries;
    const list = Array.isArray(raw2) ? raw2 : Object.values(raw2 || {});
    return list.filter((e) => e && typeof e === 'object').map((e) => ({
        comment: String(e.comment ?? e.name ?? '').trim(),
        content: String(e.content ?? ''),
        key: (Array.isArray(e.keys) ? e.keys : Array.isArray(e.key) ? e.key : [e.key]).map((k) => String(k ?? '').trim()).filter(Boolean),
        disable: e.disable === true || e.enabled === false,
    })).filter((e) => !e.disable);
}

// 生产口径的归一尺（原样复刻 seedBookEntities 那份）
const idx = new Map(canonBook.map((b) => [b.name, b]));
const canonNames = [...idx.keys()];
const resolveCanonName = (entryName) => {
    const n = String(entryName ?? '').trim();
    if (!n) return null;
    if (idx.has(n)) return n;
    let best = null;
    for (const c of canonNames) {
        if (c.length < 2) continue;
        if (!(n.includes(c) || c.includes(n))) continue;
        if (!best || c.length > best.length || (c.length === best.length && idx.get(best)?.kind !== 'faction' && idx.get(c)?.kind === 'faction')) best = c;
    }
    return best;
};

function run(entries, label, { minRows = 2 } = {}) {
    const out = [];
    let selfRef = 0, noRoster = 0, expandedByKey = 0, rejectedThin = 0;
    for (const b of canonBook) {
        if (b.kind !== 'faction') continue;
        // 候选书条目：同名 ∪ key 命中
        const byNameHit = entries.filter((e) => e.comment === b.name);
        const byKeyHit = entries.filter((e) => e.comment !== b.name && e.key.includes(b.name));
        const cands = [...byNameHit, ...byKeyHit];
        if (byKeyHit.length) expandedByKey += 1;
        const members = new Set();
        let got = 0;
        for (const e of cands) {
            MEMBER_LINE.lastIndex = 0;
            const ms = [...e.content.matchAll(MEMBER_LINE)].map((m) => m[1].trim());
            // ★闸（§1 同一形态判据）：**这个名字下至少要有 minRows 条成员行**，才是"花名册条目"；
            //   只有 0/1 条的多半是"提到它的设定段落"，拿它当名册就是张冠李戴。
            if (ms.length < minRows) { if (ms.length) rejectedThin += 1; continue; }
            got += 1;
            for (const m of ms) members.add(m);
        }
        if (!got) { noRoster += 1; continue; }
        for (const nm of members) {
            const ent = byName.get(nm);
            if (!ent || ent.kind !== 'character') continue;   // 只给在册角色挂
            if (nm === b.name) { selfRef += 1; continue; }    // 自指 = 假关系，直接拒
            if (out.some((o) => o.nm === nm)) continue;       // 一人一归属（先到先得，同现状）
            out.push({ nm, org: b.name, from: cands.map((c) => c.comment).join('|') });
        }
    }
    console.log(`\n=== ${label} ===`);
    console.log(`  canon 势力条目 = ${canonBook.filter((b) => b.kind === 'faction').length}`
        + ` · 靠 key 别名**额外**找到成员行的势力 = ${expandedByKey}`
        + ` · 完全没成员行的势力 = ${noRoster}`
        + ` · 因成员行不足 ${minRows} 条被拒的候选 = ${rejectedThin}`);
    console.log(`  能挂上的角色 = ${out.length} · 自指（已拒）= ${selfRef}`);
    return out;
}

console.log('leg25 g · P3 收窄版：canon 势力 → (同名 ∪ key 命中) 书条目 → 成员行\n');

// ① 大荒（用户真账 + 用户真书）
const dh = loadEntries(join(dir, '大荒-姬元真.json'));
const outDh = run(dh, '大荒-姬元真.json（用户真账 canon）');
const nowOn = outDh.filter((o) => !onLedger.get(o.nm));
console.log(`  ★真正会新写入 = ${nowOn.length} 条：`);
for (const o of nowOn) console.log(`      ${o.nm} → ${o.org}   （成员行来自 [${o.from}]）`);
const badDh = nowOn.filter((o) => o.nm === o.org || o.org.length < 2);
console.log(`  自指/异常 = ${badDh.length}`);

// ② 别名多找了谁：列出"靠 key 才拿到成员行"的势力
console.log(`\n  --- 靠 key 别名才拿到成员行的势力（这就是本次改动的全部影响面）---`);
for (const b of canonBook) {
    if (b.kind !== 'faction') continue;
    const named = dh.filter((e) => e.comment === b.name);
    const keyed = dh.filter((e) => e.comment !== b.name && e.key.includes(b.name));
    if (!keyed.length) continue;
    const namedHas = named.some((e) => [...e.content.matchAll(MEMBER_LINE)].length > 0);
    const keyedHas = keyed.filter((e) => { MEMBER_LINE.lastIndex = 0; return [...e.content.matchAll(MEMBER_LINE)].length > 0; });
    if (!keyedHas.length) continue;
    console.log(`  ${b.name}：${namedHas ? '本来就有成员行' : '★本无成员行'} ⇒ 靠 ${keyedHas.map((e) => `[${e.comment}]`).join('、')} 补上`);
}

// ③ 其它书：同一机制会不会炸（用"该书自身的条目名集合"当 canon 近似）
console.log(`\n${'='.repeat(78)}\n③ 其它书（canon 用"该书自己的势力样条目"近似，只看会不会炸）\n`);
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    if (f === '大荒-姬元真.json') continue;
    const entries = loadEntries(join(dir, f));
    if (!entries.length) continue;
    // 近似 canon：条目名 + 其 key（当作该书的组织名面）
    const fakeCanon = [];
    for (const e of entries) { if (e.comment) fakeCanon.push({ name: e.comment, kind: 'faction' }); }
    const rosterFake = new Set();
    for (const e of entries) { if (e.comment) rosterFake.add(e.comment); for (const m of e.content.matchAll(MEMBER_LINE)) rosterFake.add(m[1].trim()); }
    let rel = 0, selfRef = 0, keyExpanded = 0, sample = [];
    for (const b of fakeCanon) {
        const named = entries.filter((e) => e.comment === b.name);
        const keyed = entries.filter((e) => e.comment !== b.name && e.key.includes(b.name));
        if (keyed.length) keyExpanded += 1;
        const members = new Set();
        for (const e of [...named, ...keyed]) { MEMBER_LINE.lastIndex = 0; for (const m of e.content.matchAll(MEMBER_LINE)) members.add(m[1].trim()); }
        for (const nm of members) {
            if (!rosterFake.has(nm)) continue;
            if (nm === b.name) { selfRef += 1; continue; }
            rel += 1;
            if (sample.length < 4) sample.push(`${nm}→${b.name}`);
        }
    }
    console.log(`${f.slice(0, 30).padEnd(32)} 条目 ${String(entries.length).padStart(4)} · 靠 key 扩面的势力 ${String(keyExpanded).padStart(3)} · 关系 ${String(rel).padStart(5)} · 自指 ${String(selfRef).padStart(4)}`);
    if (sample.length) console.log(`     样例：${sample.join('；')}`);
}
