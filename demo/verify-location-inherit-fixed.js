// story-world-v2/demo/verify-location-inherit-fixed.js  (只读副本：修好后的接线在**真账真书**上跑一遍)
// 跑法：SWV2_CHAT="<jsonl 副本>" SWV2_BOOK="<世界书 json>" node demo/verify-location-inherit-fixed.js
// 模拟的就是修好后的生产路径：bookEntriesForInherit → runBatchLookup(bookEntries) → deriveLocationFromBook。
import { readFileSync } from 'node:fs';
import { runBatchLookup, ENTITY_LOOKUP_FIELDS } from '../src/entity-lookup.js';

const raw = readFileSync(process.env.SWV2_CHAT, 'utf8');
const box = JSON.parse(raw.slice(0, raw.indexOf('\n'))).chat_metadata.story_world_v2;
const w = box.world;

// 真书 → 收集成 ST 原始条目形态（与 web 侧 collectWorldInfoEntries 同形状）
const b = JSON.parse(readFileSync(process.env.SWV2_BOOK, 'utf8'));
const rawE = b.entries;
const list = Array.isArray(rawE) ? rawE : Object.values(rawE || {});
const entries = list.filter((e) => e && typeof e === 'object' && String(e.content ?? '').trim());

const before = w.entities.filter((e) => e.location && e.location !== '未明').length;
console.log(`跑之前：真位置 ${before} / ${w.entities.length}（占位值「未明」${w.entities.filter((e) => e.location === '未明').length}）`);

// 修好后的生产接线：条目 + 可达 transport（模型面给空对象 ⇒ 只验证零 token 的结构推断那条）
const res = await runBatchLookup({
    ssot: w,
    transport: async () => '{}',
    bookText: async () => ({ ok: true, entries: [] }),
    ids: ['e_bk_1'],
    fields: ENTITY_LOOKUP_FIELDS,
    tick: w?.meta?.tick ?? 0,
    bookEntries: entries,
});

const after = res.ssot.entities.filter((e) => e.location && e.location !== '未明').length;
console.log(`跑之后：真位置 ${after} / ${res.ssot.entities.length}`);
console.log(`★ locationInherited（收口回报的推断数）= ${res.locationInherited}`);
const pushed = res.ssot.entities.filter((e) => res.ssot.meta?.entityFields?.[e.id]?.位置来源 === '结构推导');
console.log(`账上标「结构推导」的 = ${pushed.length}`);

console.log('\n样例（前 12 个推出来的）：');
for (const e of pushed.slice(0, 12)) {
    console.log(`  ${e.name} → ${e.location}   （推自：${res.ssot.meta.entityFields[e.id].位置来源自}）`);
}

// 幂等自证：再跑一次，推断数应为 0（已有位置不动）
const res2 = await runBatchLookup({
    ssot: res.ssot, transport: async () => '{}', bookText: async () => ({ ok: true, entries: [] }),
    ids: ['e_bk_1'], fields: ENTITY_LOOKUP_FIELDS, tick: w?.meta?.tick ?? 0, bookEntries: entries,
});
console.log(`\n幂等自证：第二次跑 locationInherited = ${res2.locationInherited}（应为 0）`);
