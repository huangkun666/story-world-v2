// story-world-v2/demo/diag-location-inherit2.js  (只读：用**真账 canon** 复现位置继承为什么推出 0)
// 跑法：SWV2_CHAT="<jsonl 副本>" SWV2_BOOK="<世界书 json>" node demo/diag-location-inherit2.js
import { readFileSync } from 'node:fs';
import { derivePositions } from '../web/index.js';
import { deriveLocationFromBook, normalizeToPositionSet } from '../src/entity-lookup.js';

const chat = process.env.SWV2_CHAT;
const bookF = process.env.SWV2_BOOK;
if (!chat || !bookF) { console.error('需要 SWV2_CHAT 与 SWV2_BOOK'); process.exit(2); }

const raw = readFileSync(chat, 'utf8');
const box = JSON.parse(raw.slice(0, raw.indexOf('\n'))).chat_metadata.story_world_v2;
const world = box.world || {};
const canon = world.context?.setting?.frozen?.canon || {};
const bookEntities = canon.bookEntities || [];
const positions = world.context?.positions || [];
const ents = world.entities || [];

console.log('=== 真账 canon ===');
console.log(`bookEntities = ${bookEntities.length}`);
const kinds = {};
for (const b of bookEntities) kinds[b.kind || '(无 kind)'] = (kinds[b.kind || '(无 kind)'] || 0) + 1;
console.log(`kind 分布 = ${JSON.stringify(kinds)}`);
console.log(`带 location 字段的条目 = ${bookEntities.filter((b) => b.location).length}`);
console.log(`位置集 = ${positions.length} 项`);

console.log('\n=== 复算 derivePositions（真 canon） ===');
const re = derivePositions({ frozen: { canon: { bookEntities } } });
console.log(`重算 = ${re.length} 项；与账上一致？ ${JSON.stringify(re) === JSON.stringify(positions)}`);

console.log('\n=== ST 原始书条目（deriveLocationFromBook 的 entries 面） ===');
const b = JSON.parse(readFileSync(bookF, 'utf8'));
const rawE = b.entries;
const list = Array.isArray(rawE) ? rawE : Object.values(rawE || {});
const entries = list.filter((e) => e && typeof e === 'object').map((e) => ({
    comment: String(e.comment ?? e.name ?? '').trim(),
    content: String(e.content ?? ''),
    key: (Array.isArray(e.keys) ? e.keys : Array.isArray(e.key) ? e.key : [e.key]).map((k) => String(k ?? '').trim()).filter(Boolean),
    disable: e.disable === true || e.enabled === false,
})).filter((e) => !e.disable);
console.log(`条目 = ${entries.length}`);

console.log('\n=== 真跑 deriveLocationFromBook（真实体 + 真 ST 条目） ===');
const d = deriveLocationFromBook({ world, entities: null, entries });
console.log(`★ 推出 = ${d.stats.inherited}（skip ${d.stats.skipped}）`);
for (const a of d.stats.assigned.slice(0, 15)) console.log(`   ${a}`);

console.log('\n=== 逐环节定位（为什么是 0） ===');
let stepKey = 0, stepContent = 0, stepAccept = 0, stepNoPos = 0;
const samples = [];
for (const e of entries) {
    const keys = Array.isArray(e.key) ? e.key : [e.key];
    for (const k of keys) {
        const s = String(k ?? '').trim();
        if (!s) continue;
        const n = normalizeToPositionSet(s, positions);
        if (!n.value) { stepNoPos += 1; continue; }
        if (s.length > n.value.length) { stepKey += 1; if (samples.length < 10) samples.push(`[key 命中] 「${s}」→ ${n.value}`); }
        else { stepAccept += 1; if (samples.length < 10) samples.push(`[ACCEPT 拒·等长自指] 「${s}」→ ${n.value}`); }
    }
    const m = /(?:所在地|核心底蕴|驻地)[:：]?\s*([^\n。；]{2,30})/.exec(String(e.content || ''));
    if (m) {
        const n = normalizeToPositionSet(m[1].trim(), positions);
        if (n.value && m[1].trim().length > n.value.length) { stepContent += 1; if (samples.length < 10) samples.push(`[正文命中] ${e.comment}: 「${m[1].trim()}」→ ${n.value}`); }
    }
}
console.log(`  key 命中且过闸 = ${stepKey}`);
console.log(`  正文(所在地/核心底蕴/驻地) 命中且过闸 = ${stepContent}`);
console.log(`  被 ACCEPT 闸（等长=自指）拒掉 = ${stepAccept}`);
console.log(`  key 完全 normalize 不到 = ${stepNoPos}`);
for (const s of samples) console.log(`   ${s}`);

console.log('\n=== 真账实体里的「名字」能不能被条目正文成员行认出来 ===');
const MEMBER_LINE = /^[-*·•\s]*([^\s(（:：]{2,16})\s*[（(]/gm;
const memberNames = new Set();
const commentNames = new Set();
for (const e of entries) {
    if (e.comment) commentNames.add(e.comment);
    for (const m of e.content.matchAll(MEMBER_LINE)) memberNames.add(m[1].trim());
}
const hitMember = ents.filter((x) => memberNames.has(x.name)).length;
const hitComment = ents.filter((x) => commentNames.has(x.name)).length;
console.log(`  实体 ${ents.length}：命中条目 comment = ${hitComment}；命中正文成员行名号 = ${hitMember}`);
