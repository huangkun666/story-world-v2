// story-world-v2/demo/measure-leg25g-p3-keyalias.js   （只读，只读副本）
// leg25 g · P3 改法代价测量：让「组织条目的 key 也能当别名」（= buildOrgRosterMap 已有口径，
//   seedBookEntities 那份漏了）**会影响多少条归属**。
// 必须量的原因（红线 3：改判据 = 改承重墙）：归属推断是承重逻辑，且 abstract.js 有实测告诫——
//   「把小节标题/泛称当节点会推出假关系」（原始罗列里就有「虞昭华→人族皇朝」）。
//   ⇒ 先出曲线：新增哪些关系、有没有明显是假的、会不会覆盖已有归属。
// 跑法：SWV2_CHAT="<jsonl 副本>" node demo/measure-leg25g-p3-keyalias.js
import { readFileSync } from 'node:fs';
import { MEMBER_LINE } from '../src/abstract.js';

const world = JSON.parse(readFileSync(process.env.SWV2_CHAT, 'utf8').slice(0, readFileSync(process.env.SWV2_CHAT, 'utf8').indexOf('\n'))).chat_metadata.story_world_v2.world;
const canon = world.context?.setting?.frozen?.canon || {};
const book = canon.bookEntities || [];
const ents = world.entities || [];
const byName = new Map(ents.map((e) => [e.name, e]));
const idx = new Map(book.map((b) => [b.name, b]));

// 与 seedBookEntities 同口径的 resolveCanonName
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

// 真书条目（成员行来源）
const bjPath = process.env.SWV2_BOOK;
const bj = JSON.parse(readFileSync(bjPath, 'utf8'));
const list = Array.isArray(bj.entries) ? bj.entries : Object.values(bj.entries || {});
const entries = list.filter((e) => e && typeof e === 'object').map((e) => ({
    comment: String(e.comment ?? e.name ?? '').trim(),
    content: String(e.content ?? ''),
    key: (Array.isArray(e.keys) ? e.keys : Array.isArray(e.key) ? e.key : [e.key]).map((k) => String(k ?? '').trim()).filter(Boolean),
    disable: e.disable === true || e.enabled === false,
})).filter((e) => !e.disable);

const orgOfCanon = (name) => idx.get(String(name ?? '').trim()) || null;

// ---- 现法：只用条目名（= seedBookEntities 现状）----
// ---- 新法：条目名 + key（key 必须 resolveCanonName 到一个 **canon 里 kind=faction** 的项，且不等于成员名）----
function buildRosters({ withKeys }) {
    const map = new Map();     // canon 势力名 → Set(成员名)
    const provenance = new Map();   // `成员→势力` → 依据
    for (const b of book) {
        const canonName = resolveCanonName(b.name);
        const canonItem = canonName ? idx.get(canonName) : null;
        const isFaction = canonItem ? canonItem.kind === 'faction' : b.kind === 'faction';
        if (!isFaction) continue;
        const content = entries.find((e) => e.comment === b.name)?.content || '';
        const set = new Set();
        for (const mm of content.matchAll(MEMBER_LINE)) set.add(mm[1].trim());
        if (!set.size) continue;
        const targets = new Set([canonName].filter(Boolean));
        if (withKeys) {
            const e = entries.find((x) => x.comment === b.name);
            for (const k of e?.key || []) {
                const kc = resolveCanonName(k);
                // 只认**canon 里确实是势力**的 key（泛称/标题/地名一律不认）
                if (kc && idx.get(kc)?.kind === 'faction' && kc !== b.name) targets.add(kc);
            }
        }
        for (const t of targets) {
            if (!map.has(t)) map.set(t, new Set());
            for (const x of set) { map.get(t).add(x); provenance.set(`${x}→${t}`, `条目[${b.name}]`); }
        }
    }
    return { map, provenance };
}

function derive({ withKeys }) {
    const { map, provenance } = buildRosters({ withKeys });
    const out = new Map();
    for (const [org, members] of map) {
        const orgItem = orgOfCanon(org);
        if (!orgItem || orgItem.kind !== 'faction') continue;
        for (const nm of members) {
            const ent = byName.get(nm);
            if (!ent || ent.kind !== 'character') continue;   // 只给在册角色挂
            if (out.has(nm)) continue;
            out.set(nm, { org, via: provenance.get(`${nm}→${org}`) });
        }
    }
    return out;
}

// ---- 第三种建法：**成员行来自书条目，别名取自书条目自己的 key**（不动归一尺）----
//   为什么是这条：canon 条目**零正文**（实测 699 条只有 name+kind），正文只在书条目里；
//   而 canon 名 `大虞` 与书条目名 `人族皇朝` 之间**双向子串都不成立**（归一尺对这类根本无解）。
//   唯一的桥是书条目自己的 key 里写着 `大虞`。
function deriveViaEntryKeys() {
    const out = new Map();
    const provenance = new Map();
    for (const b of book) {
        const e = entries.find((x) => x.comment === b.name);
        if (!e) continue;
        MEMBER_LINE.lastIndex = 0;
        const members = [...e.content.matchAll(MEMBER_LINE)].map((m) => m[1].trim());
        if (!members.length) continue;
        // 该条目指向的 canon 势力 = {自己名归一} ∪ {key 里那些**canon 势力名**}
        const targets = new Set();
        const selfCanon = resolveCanonName(b.name);
        if (selfCanon && idx.get(selfCanon)?.kind === 'faction') targets.add(selfCanon);
        for (const k of e.key) {
            const kc = resolveCanonName(k);
            if (kc && idx.get(kc)?.kind === 'faction') targets.add(kc);
        }
        for (const t of targets) {
            for (const nm of members) {
                const ent = byName.get(nm);
                if (!ent || ent.kind !== 'character') continue;
                if (out.has(nm)) continue;
                out.set(nm, { org: t, via: `条目[${b.name}]` });
            }
        }
    }
    return { map: out, provenance };
}

const cur = derive({ withKeys: false });
const neu = derive({ withKeys: true });

// 现状账：真正写到账上的 parent（包含模型抽取那条路）
const onLedger = new Map(ents.filter((e) => e.parent).map((e) => [e.name, e.parent]));

console.log('leg25 g · P3 改法（组织条目 key 也当别名）代价测量\n');
console.log(`canon 势力条目 = ${book.filter((b) => b.kind === 'faction').length} · 账上 parent = ${onLedger.size} · 账上角色 = ${ents.filter((e) => e.kind === 'character').length}`);
console.log(`\n结构推导能挂上的角色数：`);
console.log(`  现法（只用条目名） = ${cur.size}`);
console.log(`  新法（条目名 + key） = ${neu.size}   ⇒ 新增 ${neu.size - cur.size} 条`);

const added = [...neu.entries()].filter(([nm]) => !cur.has(nm));
console.log(`\n★新增的 ${added.length} 条逐条（成员 → 势力，依据条目）：`);
for (const [nm, v] of added) {
    const already = onLedger.get(nm);
    const flag = already ? `⚠ 账上已有 parent=${already}（**不覆盖**，明述优先）` : '＋ 新挂上';
    console.log(`  ${nm} → ${v.org}   依据 ${v.via}   ${flag}`);
}

const wouldWrite = added.filter(([nm]) => !onLedger.get(nm));
console.log(`\n★★ 真正会**新增写入**账的 = ${wouldWrite.length} 条：${wouldWrite.map(([nm, v]) => `${nm}→${v.org}`).join('、') || '(无)'}`);
console.log(`   （其余 ${added.length - wouldWrite.length} 条账上已有归属 ⇒ 按"明述优先"不动）`);

// 假关系自查：成员名 == 势力名（自指）或势力名是泛称（长度 < 3）
const sus = wouldWrite.filter(([nm, v]) => nm === v.org || v.org.length < 3);
console.log(`\n可疑（自指 / 势力名过短） = ${sus.length} 条：${sus.map(([nm, v]) => `${nm}→${v.org}`).join('、') || '(无)'}`);

console.log(`\n★虞昭华 两侧对照：`);
console.log(`  现法 = ${cur.get('虞昭华') ? `${cur.get('虞昭华').org}（${cur.get('虞昭华').via}）` : '(挂不上)'}`);
console.log(`  新法 = ${neu.get('虞昭华') ? `${neu.get('虞昭华').org}（${neu.get('虞昭华').via}）` : '(挂不上)'}`);
console.log(`  账上现在 = ${onLedger.get('虞昭华') ?? '(无归属)'}`);

// ★自证：为什么新法也是 0 —— 逐步定位断点（别拿"复刻跑出 0"当结论）
console.log(`\n=== 断点自证（为什么 key 别名没生效）===`);
const namesWithRoster = book.filter((b) => {
    const c = entries.find((e) => e.comment === b.name)?.content || '';
    MEMBER_LINE.lastIndex = 0;
    return [...c.matchAll(MEMBER_LINE)].length > 0;
});
console.log(`  真书条目里，名字能与 canon 条目名**精确对上**的 = ${entries.filter((e) => idx.has(e.comment)).length}/${entries.length}`);
console.log(`  canon 势力条目中，能在真书里**精确找到同名条目**的 = ${namesWithRoster.length}/${book.filter((b) => b.kind === 'faction').length}`);
console.log(`  真书里含「虞昭华」的条目名 = ${JSON.stringify(entries.filter((e) => e.content.includes('虞昭华') || e.key.includes('虞昭华')).map((e) => e.comment))}`);
console.log(`  这些条目名在 canon 里吗？ ${JSON.stringify(entries.filter((e) => e.content.includes('虞昭华')).map((e) => [e.comment, idx.has(e.comment)]))}`);
console.log(`  canon 里 kind=faction 且名字含「虞」的 = ${JSON.stringify(book.filter((b) => b.kind === 'faction' && b.name.includes('虞')).map((b) => b.name))}`);
console.log(`  canon 里 kind 分布 = ${JSON.stringify(book.reduce((a, b) => (a[b.kind] = (a[b.kind] || 0) + 1, a), {}))}`);
// canon 条目名 vs 真书条目名的交集
const canonFactionNames = new Set(book.filter((b) => b.kind === 'faction').map((b) => b.name));
const entryNames = entries.map((e) => e.comment);
const inter = entryNames.filter((n) => canonFactionNames.has(n));
console.log(`  「真书条目名 ∩ canon 势力名」= ${inter.length} 个；样例 ${JSON.stringify(inter.slice(0, 12))}`);

// ---- 第三种建法实测 ----
const viaKeys = deriveViaEntryKeys().map;
console.log(`\n=== 第三种建法：成员行来自书条目 + 别名取自书条目 key ===`);
console.log(`  能挂上的角色 = ${viaKeys.size}（现法 ${cur.size}）⇒ 新增 ${viaKeys.size - cur.size} 条`);
const added3 = [...viaKeys.entries()].filter(([nm]) => !cur.has(nm));
for (const [nm, v] of added3) {
    const already = onLedger.get(nm);
    console.log(`    ${nm} → ${v.org}   依据 ${v.via}   ${already ? `⚠账上已有=${already}（不覆盖）` : '＋会新写入'}`);
}
const write3 = added3.filter(([nm]) => !onLedger.get(nm));
console.log(`  ★★ 真正会新写入 = ${write3.length} 条：${write3.map(([nm, v]) => `${nm}→${v.org}`).join('、') || '(无)'}`);
const sus3 = write3.filter(([nm, v]) => nm === v.org || v.org.length < 3);
console.log(`  可疑（自指/名过短）= ${sus3.length} 条：${sus3.map(([nm, v]) => `${nm}→${v.org}`).join('、') || '(无)'}`);

// 与"模型抽取"那条路是否冲突：新写入的这些角色，书上它们的条目里有没有显式写所属
console.log(`\n=== 冲突自查：会新写入的角色，书里有没有**显式**写所属（若有，说明该由那条路管）===`);
for (const [nm] of write3.slice(0, 20)) {
    const own = entries.find((e) => e.comment === nm);
    const line = own ? /(?:所属势力|所属|隶属|从属|势力)\s*[:：=]/.exec(own.content) : null;
    console.log(`  ${nm}: 自己有书条目=${own ? '是' : '否'}${line ? ` ★有显式所属行：${own.content.slice(Math.max(0, line.index - 10), line.index + 60).replace(/\n/g, ' ')}` : ''}`);
}

// ---- 第四种建法（★正解候选）：**反查** —— canon 势力 → 所有"key 提到它"的书条目 → 那些条目的成员行 ----
//   为什么必须反查：canon 里 `大虞` 的正文无、与它同名的书条目也无；
//   而含成员行的书条目叫 `人族皇朝`，它 **key 里写着 `大虞`**。顺着 key 反查才接得上。
function deriveViaReverseKey() {
    const out = new Map();
    // 书条目 → key 里能归一到的 canon 势力名
    const byCanon = new Map();     // canon 势力名 → [{entry, members}]
    for (const b of book) {
        const e = entries.find((x) => x.comment === b.name);
        if (!e) continue;
        MEMBER_LINE.lastIndex = 0;
        const members = [...e.content.matchAll(MEMBER_LINE)].map((m) => m[1].trim());
        if (!members.length) continue;
        const targets = new Set();
        const selfCanon = resolveCanonName(b.name);
        if (selfCanon && idx.get(selfCanon)?.kind === 'faction') targets.add(selfCanon);
        for (const k of e.key) {
            const kc = resolveCanonName(k);
            if (kc && idx.get(kc)?.kind === 'faction') targets.add(kc);
        }
        for (const t of targets) {
            if (!byCanon.has(t)) byCanon.set(t, []);
            byCanon.get(t).push({ entry: b.name, members });
        }
    }
    for (const [org, buckets] of byCanon) {
        for (const { entry, members } of buckets) {
            for (const nm of members) {
                const ent = byName.get(nm);
                if (!ent || ent.kind !== 'character') continue;
                if (out.has(nm)) continue;
                out.set(nm, { org, via: `条目[${entry}] key含${org}` });
            }
        }
    }
    return out;
}
const rev = deriveViaReverseKey();
console.log(`\n=== 第四种：反查法（canon 势力 ← key 提到它的书条目）===`);
console.log(`  能挂上的角色 = ${rev.size}（现法 ${cur.size}）⇒ 新增 ${rev.size - cur.size} 条`);
const added4 = [...rev.entries()].filter(([nm]) => !cur.has(nm));
for (const [nm, v] of added4) {
    const already = onLedger.get(nm);
    console.log(`    ${nm} → ${v.org}   依据 ${v.via}   ${already ? `⚠账上已有=${already}（不覆盖）` : '＋会新写入'}`);
}
const write4 = added4.filter(([nm]) => !onLedger.get(nm));
console.log(`  ★★ 真正会新写入 = ${write4.length} 条：${write4.map(([nm, v]) => `${nm}→${v.org}`).join('、') || '(无)'}`);
const sus4 = write4.filter(([nm, v]) => nm === v.org || v.org.length < 3);
console.log(`  可疑（自指/名过短）= ${sus4.length} 条：${sus4.map(([nm, v]) => `${nm}→${v.org}`).join('、') || '(无)'}`);
console.log(`\n★虞昭华（第四种）= ${rev.get('虞昭华') ? `${rev.get('虞昭华').org}  ← ${rev.get('虞昭华').via}` : '(仍挂不上)'}`);

// ---- 第五种（★正解）：**key 反查，不看条目名** ----
//   为什么前四种都差这一条：它们都从 canon 条目名出发去找"同名书条目"，
//   而 `大虞` 与 `人族皇朝` 之间**名字毫无关系**，只有书条目自己的 key 里写着 `大虞`。
//   所以必须先建「key → canon 势力」的索引，再用**成员行所属书条目**去查这个索引。
function buildKeyAliasIndex() {
    const m = new Map();      // key 串 → canon 势力名
    for (const b of book) {
        if (b.kind !== 'faction') continue;
        for (const e of entries) {
            if (!e.key.includes(b.name)) continue;
            m.set(`${e.comment}::${b.name}`, b.name);   // 书条目 × key = 一条别名证据
        }
    }
    return m;
}
const keyAlias = buildKeyAliasIndex();
const viaKeyOnly = new Map();
for (const e of entries) {
    MEMBER_LINE.lastIndex = 0;
    const members = [...e.content.matchAll(MEMBER_LINE)].map((x) => x[1].trim());
    if (!members.length) continue;
    // 该条目指向的 canon 势力：其 key 里出现的 canon 势力名
    const targets = new Set(book.filter((b) => b.kind === 'faction' && e.key.includes(b.name)).map((b) => b.name));
    for (const t of targets) {
        for (const nm of members) {
            const ent = byName.get(nm);
            if (!ent || ent.kind !== 'character') continue;
            if (viaKeyOnly.has(nm)) continue;
            viaKeyOnly.set(nm, { org: t, via: `条目[${e.comment}] key含${t}` });
        }
    }
}
console.log(`\n=== 第五种：key 反查（不看条目名）===`);
console.log(`  别名证据（书条目×key）= ${keyAlias.size} 条`);
console.log(`  能挂上的角色 = ${viaKeyOnly.size}（现法 ${cur.size}）⇒ 新增 ${viaKeyOnly.size - cur.size} 条`);
const added5 = [...viaKeyOnly.entries()].filter(([nm]) => !cur.has(nm));
for (const [nm, v] of added5) {
    const already = onLedger.get(nm);
    console.log(`    ${nm} → ${v.org}   依据 ${v.via}   ${already ? `⚠账上已有=${already}（不覆盖）` : '＋会新写入'}`);
}
const write5 = added5.filter(([nm]) => !onLedger.get(nm));
console.log(`  ★★ 真正会新写入 = ${write5.length} 条：${write5.map(([nm, v]) => `${nm}→${v.org}`).join('、') || '(无)'}`);
const sus5 = write5.filter(([nm, v]) => nm === v.org || v.org.length < 3);
console.log(`  可疑（自指/名过短）= ${sus5.length} 条：${sus5.map(([nm, v]) => `${nm}→${v.org}`).join('、') || '(无)'}`);
console.log(`\n★★★虞昭华（第五种）= ${viaKeyOnly.get('虞昭华') ? `${viaKeyOnly.get('虞昭华').org}  ← ${viaKeyOnly.get('虞昭华').via}` : '(仍挂不上)'}`);
