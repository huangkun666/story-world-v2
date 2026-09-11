// story-world-v2/demo/diag-leg25g-p2p3.js   （只读，只读副本）
// leg25 g · P2 + P3 取证（真账 + 真书）：
//   P2：9 条 `parentSource === undefined` 到底是哪些、它们的 parent 是什么 kind —— 验「子势力→皇帝角色」这条叙述
//   P3：`虞昭华` 为什么没挂上 `大虞`（用户 2026-09-11 定论：虞昭华是大虞的）
// 跑法：SWV2_CHAT="<chat jsonl 副本>" SWV2_BOOK="<世界书 json>" node demo/diag-leg25g-p2p3.js
import { readFileSync } from 'node:fs';
import { seedBookEntities, scanBookDeclarations } from '../src/abstract.js';

const chat = process.env.SWV2_CHAT;
const bookF = process.env.SWV2_BOOK;
if (!chat || !bookF) { console.error('需要 SWV2_CHAT 与 SWV2_BOOK'); process.exit(2); }

const raw = readFileSync(chat, 'utf8');
const world = JSON.parse(raw.slice(0, raw.indexOf('\n'))).chat_metadata.story_world_v2.world;
const canon = world.context?.setting?.frozen?.canon || {};
const book = canon.bookEntities || [];
const ents = world.entities || [];
const byName = new Map(ents.map((e) => [e.name, e]));
const canonIdx = new Map(book.map((b) => [b.name, b]));

console.log('='.repeat(78));
console.log('P2 · 9 条 parentSource === undefined');
console.log('='.repeat(78));
const noSrc = ents.filter((e) => e.parent && !e.parentSource);
console.log(`账上 parent 总数 = ${ents.filter((e) => e.parent).length}；缺来源 = ${noSrc.length}`);
console.log('\n逐条（含 parent 在 canon 里的 kind、自己在 canon 里的 kind）：');
for (const e of noSrc) {
    const pCanon = canonIdx.get(e.parent);
    const selfCanon = canonIdx.get(e.name);
    console.log(`  ${e.name}（self=${e.kind}${selfCanon ? `/canon:${selfCanon.kind}` : '/不在canon'}）`
        + ` → ${e.parent}（parent=${byName.get(e.parent)?.kind ?? '(不在账上)'}${pCanon ? `/canon:${pCanon.kind}` : '/不在canon'}）`);
}
console.log('\n★叙述核对（交接说「全是子势力→皇帝角色」）：');
const kinds = {};
for (const e of noSrc) {
    const k = byName.get(e.parent)?.kind ?? 'not-in-ledger';
    kinds[k] = (kinds[k] || 0) + 1;
}
console.log(`  parent 的 kind 分布 = ${JSON.stringify(kinds)}`);
const selfKinds = {};
for (const e of noSrc) selfKinds[e.kind] = (selfKinds[e.kind] || 0) + 1;
console.log(`  自己的 kind 分布 = ${JSON.stringify(selfKinds)}`);

console.log('\n' + '='.repeat(78));
console.log('P3 · 虞昭华 → 大虞 为什么没接上');
console.log('='.repeat(78));
const yzh = byName.get('虞昭华');
console.log(`账上 虞昭华 = ${yzh ? JSON.stringify({ id: yzh.id, kind: yzh.kind, parent: yzh.parent ?? null, parentSource: yzh.parentSource ?? null }) : '(不在册)'}`);
console.log(`\ncanon 里相关名号：`);
for (const nm of ['虞昭华', '大虞', '人族皇朝']) {
    const hits = book.filter((b) => String(b.name).includes(nm));
    console.log(`  「${nm}」→ ${hits.length ? hits.map((b) => `${b.name}(kind=${b.kind}${b.parent ? `,parent=${b.parent}` : ''})`).join(' / ') : '★不在 canon'}`);
}

const bj = JSON.parse(readFileSync(bookF, 'utf8'));
const rawE = bj.entries;
const list = Array.isArray(rawE) ? rawE : Object.values(rawE || {});
const entries = list.filter((e) => e && typeof e === 'object').map((e) => ({
    comment: String(e.comment ?? e.name ?? '').trim(),
    content: String(e.content ?? ''),
    key: (Array.isArray(e.keys) ? e.keys : Array.isArray(e.key) ? e.key : [e.key]).map((k) => String(k ?? '').trim()).filter(Boolean),
    disable: e.disable === true || e.enabled === false,
})).filter((e) => !e.disable);

console.log(`\n书里「虞昭华」出现在哪：`);
let found = false;
for (const e of entries) {
    const at = e.content.indexOf('虞昭华');
    const keyHit = e.key.some((k) => k.includes('虞昭华'));
    if (at < 0 && !keyHit) continue;
    found = true;
    console.log(`  条目[${e.comment}] key=${JSON.stringify(e.key)}${keyHit ? ' ★key命中' : ''}`);
    if (at >= 0) {
        const s = e.content.lastIndexOf('\n', at) + 1;
        const t = e.content.indexOf('\n', at);
        console.log(`     行 = ${e.content.slice(s, t < 0 ? at + 120 : t).trim().slice(0, 180)}`);
    }
}
if (!found) console.log('  ★书里没有任何条目提到「虞昭华」');

for (const nm of ['人族皇朝', '大虞']) {
    const e = entries.find((x) => x.comment === nm);
    if (!e) { console.log(`\n条目[${nm}]：书里没有同名字条目`); continue; }
    console.log(`\n条目[${nm}] key=${JSON.stringify(e.key)}`);
    console.log(`  正文前 300 字 = ${e.content.slice(0, 300).replace(/\n/g, ' ⏎ ')}`);
    console.log(`  含「虞昭华」？ ${e.content.includes('虞昭华') ? '★是' : '否'}`);
}

console.log(`\ncanon.sourceText 长度 = ${String(canon.sourceText || '').length}`);
const declares = scanBookDeclarations(String(canon.sourceText || '')).declares || [];
console.log(`书标签声明 = ${declares.length} 条；涉及「虞」的：`);
for (const d of declares.filter((d) => String(d.name).includes('虞') || String(d.parent || '').includes('虞'))) console.log(`  ${JSON.stringify(d)}`);

console.log(`\n★生产链复跑（把虞昭华从账上摘掉，看这一跑会不会挂上）：`);
const hot = JSON.parse(JSON.stringify(world));
hot.entities = ents.filter((e) => e.name !== '虞昭华');
const res = seedBookEntities(hot, { entries });
const after = (hot.entities || []).find((e) => e.name === '虞昭华');
console.log(`  seed = ${JSON.stringify({ seeded: res.seeded, folded: res.folded, skippedLocation: res.skippedLocation })}`);
console.log(`  复跑后 虞昭华 = ${after ? JSON.stringify({ parent: after.parent ?? null, parentSource: after.parentSource ?? null }) : '(仍未入册)'}`);
const rel = (res.warnings || []).filter((w) => /虞|人族皇朝|大虞/.test(w));
console.log(`  相关警告 = ${rel.length ? JSON.stringify(rel) : '(无)'}`);
