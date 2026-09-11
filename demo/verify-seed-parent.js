// story-world-v2/demo/verify-seed-parent.js
// 真书落地验证（只读）：拿**真账本的实体池** + **真卡的内置书条目**，跑真 `seedBookEntities`，
// 回答一个问题——**按新代码新建世界，会得到什么？**（归属/档位/规模各落多少、来源怎么分账、有没有假关系）
//
// 为什么必须跑这个而不只看单测：单测用的是我编的小夹具；这里用的是用户真书 233 条 + 真账 623 实体，
//   能暴露"夹具里看不出来的形态"（如「散修」「人族皇朝」这类会被结构推导误当势力的节点）。
// 用法：node demo/verify-seed-parent.js <聊天jsonl副本> <角色卡png>
import { readFileSync } from 'node:fs';
import { seedBookEntities } from '../src/abstract.js';
import { characterBookEntries } from '../web/index.js';

function head(file) {
    const raw = readFileSync(file, 'utf8');
    return JSON.parse(raw.slice(0, raw.indexOf('\n')));
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

const real = head(process.argv[2]).chat_metadata.story_world_v2.world;
const card = cardFromPng(process.argv[3]);
const book = characterBookEntries(card);
const canonNames = real.context?.setting?.frozen?.canon?.bookEntities || [];
const kindOf = new Map(canonNames.map((b) => [String(b.name), b.kind]));
// kind 归一（与真链路同口径）：精确名查不到时按"一个是另一个的子串"取最长者——
//   真链路上这一步是模型抽的 kind（模型看得懂「混乱之地·万妖盟」是势力条目）；
//   本脚本没有模型，用同一把尺模拟，免得把势力条目误判成 character 而得出假的漏挂数。
const kindOfName = (nm) => {
    const n = String(nm ?? '').trim();
    if (kindOf.has(n)) return kindOf.get(n);
    let best = null;
    for (const [k] of kindOf) if (k.length >= 2 && (n.includes(k) || k.includes(n)) && (!best || k.length > best.length)) best = k;
    return best ? kindOf.get(best) : 'character';
};
const contentOf = new Map(book.map((e) => [String(e.comment || '').trim(), String(e.content || '')]));
const keyOf = new Map(book.map((e) => [String(e.comment || '').trim(), e.key]));

// 模拟"新建世界"：空实体池 + 真位置集 + 真书条目（正文一并挂上）
const seen = new Set();
const bookEntities = [];
for (const e of book) {
    const nm = String(e.comment || '').trim();
    if (!nm || seen.has(nm)) continue;
    seen.add(nm);
    bookEntities.push({ name: nm, kind: kindOfName(nm), content: String(e.content || ''), key: e.key });
}
for (const b of canonNames) {
    const nm = String(b.name);
    if (seen.has(nm)) continue;
    seen.add(nm);
    bookEntities.push({ name: nm, kind: b.kind, content: contentOf.get(nm) || '', key: keyOf.get(nm) });
}

const world = {
    context: {
        tension: 0.5,
        positions: real.context?.positions || [],
        setting: { frozen: { canon: { bookEntities, powerScale: real.context?.setting?.frozen?.canon?.powerScale || [] } } },
    },
    entities: [],
    weights: {},
};
console.log(`名册条目 = ${bookEntities.length}（书条目 ${book.length} + canon 补齐）`);
const r = seedBookEntities(world);
const ents = world.entities || [];
const chars = ents.filter((e) => e.kind === 'character');
const facs = ents.filter((e) => e.kind === 'faction');

console.log('=== 入账结果（新世界会长成什么样）===');
console.log(`实体 ${ents.length}（角色 ${chars.length} / 势力 ${facs.length}）  seeded=${r.seeded}`);
console.log(`● 有 parent 的实体 = ${ents.filter((e) => e.parent).length}`);
console.log(`● 有「实力」原话的角色 = ${chars.filter((e) => e['实力']).length} / ${chars.length}`);
console.log(`● 有「规模」原话的势力 = ${facs.filter((e) => e['规模']).length} / ${facs.length}`);
console.log(`● fieldsAttached=${r.fieldsAttached ?? 0}  parentVerified=${r.parentVerified ?? 0}  parentDemoted=${r.parentDemoted ?? 0}`);
const bySource = {};
for (const e of ents) if (e.parent) bySource[e.parentSource || '?'] = (bySource[e.parentSource || '?'] || 0) + 1;
console.log(`● parent 来源分账：${JSON.stringify(bySource)}`);
const byEvidence = {};
for (const e of ents) if (e.parentSourceFrom) byEvidence[e.parentSourceFrom] = (byEvidence[e.parentSourceFrom] || 0) + 1;
console.log(`● 证据类型：${JSON.stringify(byEvidence)}`);

console.log('=== 抽查（真书形态：成员行 + 档位原话）===');
for (const nm of ['吞天妖王', '混元妖圣', '清玄真人', '玄一道祖', '虞昭华', '姜婆婆']) {
    const e = ents.find((x) => x.name === nm);
    if (!e) { console.log(`  ${nm}: 不入账`); continue; }
    console.log(`  ${nm}: 实力=${JSON.stringify(e['实力'] ?? null)}  parent=${JSON.stringify(e.parent ?? null)}（${e.parentSource ?? '-'}/${e.parentSourceFrom ?? '-'}）`);
}
console.log('=== 结构推导出来的归属：前 16 条（人可审，防张冠李戴）===');
const derived = ents.filter((e) => e.parent && e.parentSource === '结构推导');
for (const e of derived.slice(0, 16)) console.log(`  ${e.name} → ${e.parent}   [${e.parentSourceFrom}]`);
console.log(`  （共 ${derived.length} 条）`);
console.log('=== 被弃的归属（验伪不通过）前 6 条 ===');
for (const w of (r.warnings || []).filter((x) => /反驳|不在册|不是势力/.test(x)).slice(0, 6)) console.log(`  ${w}`);

// 契约校验（第二十五棒 e）：把所有入账实体逐个过 schema——新键没登记会被判「未知字段」（今天踩过）
{
    const { validate } = await import('../src/schema.js');
    const { ssotSchema } = await import('../src/schemas/ssot.schema.js');
    let bad = 0;
    const seenErr = new Set();
    for (const e of ents) {
        const v = validate(e, ssotSchema.props.entities.items);
        if (v.errors.length) { bad += 1; for (const x of v.errors.slice(0, 2)) seenErr.add(x); }
    }
    console.log(`=== 契约校验：不过 schema 的实体 = ${bad} / ${ents.length} ===`);
    for (const x of [...seenErr].slice(0, 6)) console.log(`  ${x}`);
}
