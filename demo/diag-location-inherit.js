// story-world-v2/demo/diag-location-inherit.js  (只读：位置继承在真书上为什么推出 0)
// 跑法：SWV2_BOOK="<世界书 json 路径>" node demo/diag-location-inherit.js
import { readFileSync } from 'node:fs';
import { derivePositions } from '../web/index.js';
import { deriveLocationFromBook, normalizeToPositionSet } from '../src/entity-lookup.js';

const f = process.env.SWV2_BOOK;
if (!f) { console.error('需要 SWV2_BOOK=<世界书 json 路径>'); process.exit(2); }
const b = JSON.parse(readFileSync(f, 'utf8'));
const raw = b.entries;
const list = Array.isArray(raw) ? raw : Object.values(raw || {});
const entries = list.filter((e) => e && typeof e === 'object').map((e) => ({
    comment: String(e.comment ?? e.name ?? '').trim(),
    content: String(e.content ?? ''),
    key: (Array.isArray(e.keys) ? e.keys : Array.isArray(e.key) ? e.key : [e.key]).map((k) => String(k ?? '').trim()).filter(Boolean),
    disable: e.disable === true || e.enabled === false,
})).filter((e) => !e.disable);

console.log(`世界书条目 = ${entries.length}`);

// canon 形态（name/kind）——这里用 comment 近似，与 audit 脚本同口径
const setting = { frozen: { canon: { bookEntities: entries.map((e) => ({ name: e.comment, kind: 'character' })) } } };
const positions = derivePositions(setting);
console.log(`位置集 = ${positions.length} 项：${positions.slice(0, 12).join(' / ')} ...`);

// 造一个和真账同形的 world：实体名 = 条目 comment + 正文成员行里的名号
const MEMBER_LINE = /^[-*·•\s]*([^\s(（:：]{2,16})\s*[（(]/gm;
const names = new Set();
for (const e of entries) {
    if (e.comment) names.add(e.comment);
    for (const m of e.content.matchAll(MEMBER_LINE)) names.add(m[1].trim());
}
const ents = [...names].map((n, i) => ({ id: `e_${i}`, kind: 'character', name: n, location: '未明' }));
console.log(`候选实体（条目名 + 成员行名号）= ${ents.length}`);

const d = deriveLocationFromBook({ world: { context: { positions }, entities: ents, meta: {} }, entries });
console.log(`\n★ deriveLocationFromBook 推出 = ${d.stats.inherited}（skip 已有位置 ${d.stats.skipped}）`);
for (const a of d.stats.assigned.slice(0, 12)) console.log(`   ${a}`);

// 逐环节定位：有多少条能取到"集内地名"？多少条连 ACCEPT 都过不了？
let withLoc = 0, rejectedAccept = 0, none = 0;
const samples = [];
for (const e of entries) {
    const keys = Array.isArray(e.key) ? e.key : [e.key];
    const hits = [];
    for (const k of keys) {
        const s = String(k ?? '').trim();
        const n = normalizeToPositionSet(s, positions);
        if (n.value) {
            if (s.length > n.value.length) hits.push(`${s} → ${n.value}`);
            else { rejectedAccept += 1; if (samples.length < 8) samples.push(`[ACCEPT 拒] 来源「${s}」→「${n.value}」(等长=自指)`); }
        }
    }
    const m = /(?:所在地|核心底蕴|驻地)[:：]?\s*([^\n。；]{2,30})/.exec(String(e.content || ''));
    if (m) {
        const n = normalizeToPositionSet(m[1].trim(), positions);
        if (n.value && m[1].trim().length > n.value.length) hits.push(`正文「${m[1].trim()}」→ ${n.value}`);
    }
    if (hits.length) { withLoc += 1; if (samples.length < 8) samples.push(`[命中] ${e.comment || '(无 comment)'} : ${hits.join(', ')}`); }
    else none += 1;
}
console.log(`\n=== 逐环节定位 ===`);
console.log(`  条目里能取到"集内地名"且过 ACCEPT 闸的 = ${withLoc} / ${entries.length}`);
console.log(`  取不到任何集内地名的                        = ${none}`);
console.log(`  被 ACCEPT 闸（等长=自指）挡掉的 key 次数     = ${rejectedAccept}`);
for (const s of samples) console.log(`   ${s}`);
