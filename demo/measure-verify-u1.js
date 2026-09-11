// story-world-v2/demo/measure-verify-u1.js  (只读：逐栏核对「占位值闸死」这个判断本身是否成立)
import { readFileSync } from 'node:fs';
import { missingFields, ENTITY_LOOKUP_FIELDS, deriveLocationFromBook } from '../src/entity-lookup.js';
import { derivePositions } from '../web/index.js';

const p = process.env.SWV2_CHAT;
const raw = readFileSync(p, 'utf8');
const box = JSON.parse(raw.slice(0, raw.indexOf('\n'))).chat_metadata.story_world_v2;
const w = box.world || {};
const ents = w.entities || [];
const meta = w.meta || {};
const positions = w.context?.positions || [];

const has = (e, k) => typeof e[k] === 'string' && e[k].trim().length > 0;

console.log('=== 逐栏真相（563 实体） ===');
console.log(`实体 ${ents.length}  位置集 ${positions.length}`);
console.log(`  实体有中文字键 "位置" 的 = ${ents.filter((e) => has(e, '位置')).length}   ← ENTITY_LOOKUP_FIELDS 里的「位置」查的是这个键`);
console.log(`  实体有 "location"(英文) 的 = ${ents.filter((e) => has(e, 'location')).length}`);
console.log(`  实体有中文字键 "实力" 的 = ${ents.filter((e) => has(e, '实力')).length}`);
console.log(`  实体有 fieldSource 的     = ${ents.filter((e) => e.fieldSource).length}`);

console.log('\n=== 关键：missingFields 认为每栏「缺不缺」 ===');
const cnt = { 实力: 0, 位置: 0 };
for (const e of ents) {
    for (const f of missingFields(e, meta, ENTITY_LOOKUP_FIELDS)) cnt[f] += 1;
}
console.log(`  missingFields 说缺「实力」= ${cnt['实力']} / ${ents.length}`);
console.log(`  missingFields 说缺「位置」= ${cnt['位置']} / ${ents.length}   ← 交接说这条应该≈0（"永远进不了待查名单"）`);

console.log('\n=== 结论核对 ===');
console.log(`  交接 U1 的说法：「位置永远进不了待查名单」`);
console.log(cnt['位置'] === 0
    ? '  ⇒ 对：位置确实被闸死了'
    : `  ⇒ **不成立**：位置栏本来就被排进去了（${cnt['位置']} 个），闸死的是别的环节`);

console.log('\n=== 那真正被占位值闸死的是什么？逐条追 applyLookup 的覆盖规则 ===');
// applyLookup 里：if (typeof next[f] === 'string' && next[f].trim()) → 已有值就不写
const byId = new Map(ents.map((e) => [e.id, e]));
let blockedByPlaceholder = 0;
for (const e of ents) {
    if (e.location === '未明') blockedByPlaceholder += 1;
}
console.log(`  location === '未明' 的实体 = ${blockedByPlaceholder}（若查书路把'未明'当"已有值"，这些就全写不进去）`);
console.log(`  ——需要看 applyLookup 的写入条件才能定论（见下）`);

console.log('\n=== 位置继承若真跑一次，能救回多少（真书 + 真账） ===');
const bf = process.env.SWV2_BOOK;
if (bf) {
    const b = JSON.parse(readFileSync(bf, 'utf8'));
    const rawE = b.entries;
    const list = Array.isArray(rawE) ? rawE : Object.values(rawE || {});
    const entries = list.filter((e) => e && typeof e === 'object').map((e) => ({
        comment: String(e.comment ?? e.name ?? '').trim(),
        content: String(e.content ?? ''),
        key: (Array.isArray(e.keys) ? e.keys : Array.isArray(e.key) ? e.key : [e.key]).map((k) => String(k ?? '').trim()).filter(Boolean),
        disable: e.disable === true || e.enabled === false,
    })).filter((e) => !e.disable);
    const d = deriveLocationFromBook({ world: w, entries });
    console.log(`  ★ 真账上真跑 = 推出 ${d.stats.inherited} 个位置（skip ${d.stats.skipped}）`);
    console.log(`    样例：${d.stats.assigned.slice(0, 8).join(' | ')}`);
    const sample = d.ssot.entities.filter((e) => e.location !== '未明').slice(0, 5);
    for (const e of sample) console.log(`    ${e.name} → ${e.location}`);
} else {
    console.log('  （需要 SWV2_BOOK 才能跑）');
}
