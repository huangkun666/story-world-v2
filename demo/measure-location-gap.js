// story-world-v2/demo/measure-location-gap.js  (只读：U1/U2 的真账代价——占位值「未明」闸死了什么)
// 跑法：SWV2_CHAT="<jsonl 路径>" node demo/measure-location-gap.js
// 纪律：只读副本、不改账、不打印任何密钥。
import { readFileSync } from 'node:fs';
import { missingFields, ENTITY_LOOKUP_FIELDS } from '../src/entity-lookup.js';

const PLACEHOLDER = '未明';

const p = process.env.SWV2_CHAT;
if (!p) { console.error('需要 SWV2_CHAT=<jsonl 路径>'); process.exit(2); }
const raw = readFileSync(p, 'utf8');
const box = JSON.parse(raw.slice(0, raw.indexOf('\n'))).chat_metadata.story_world_v2;
const w = box.world || {};
const ents = w.entities || [];
const meta = w.meta || {};
const positions = w.context?.positions || [];

console.log('=== 账本规模 ===');
console.log(`实体 ${ents.length}（角色 ${ents.filter((e) => e.kind === 'character').length} / 势力 ${ents.filter((e) => e.kind === 'faction').length}）`);
console.log(`位置集 ${positions.length} 项，首项 = ${JSON.stringify(positions[0] ?? null)}`);

console.log('\n=== U2：`location` 这一栏的真实成分 ===');
const noField = ents.filter((e) => e.location === undefined || e.location === null).length;
const emptyStr = ents.filter((e) => typeof e.location === 'string' && !e.location.trim()).length;
const placeholder = ents.filter((e) => e.location === PLACEHOLDER).length;
const named = ents.filter((e) => typeof e.location === 'string' && e.location.trim() && e.location !== PLACEHOLDER).length;
console.log(`  真位置（书里给过）      = ${named}`);
console.log(`  占位值「未明」           = ${placeholder}   ← 引擎自己写进去的，不是书说的`);
console.log(`  字段缺失(undefined/null) = ${noField}`);
console.log(`  空串                     = ${emptyStr}`);

console.log('\n=== U1：`missingFields` 现在到底还要不要查「位置」 ===');
const needLoc = [];
for (const e of ents) {
    const mf = missingFields(e, meta, ENTITY_LOOKUP_FIELDS);
    if (mf.includes('位置')) needLoc.push(e);
}
console.log(`  ENTITY_LOOKUP_FIELDS = ${JSON.stringify(ENTITY_LOOKUP_FIELDS)}`);
console.log(`  会被排进「查位置」的实体 = ${needLoc.length} / ${ents.length}   ← 这就是空转的证据`);

console.log('\n=== 反事实：若占位值不再算「有值」，待查规模会变成多少 ===');
const fake = ents.map((e) => (e.location === PLACEHOLDER ? { ...e, location: undefined } : e));
const needLoc2 = fake.filter((e) => missingFields(e, meta, ENTITY_LOOKUP_FIELDS).includes('位置'));
console.log(`  会被排进「查位置」的实体 = ${needLoc2.length}`);
const namedWithoutLookup = needLoc2.filter((e) => e.location !== PLACEHOLDER).length;
console.log(`    （其中本来就有真位置的 = ${namedWithoutLookup}，占位值那批 = ${needLoc2.length - namedWithoutLookup}）`);

console.log('\n=== 档位那栏（对照组：U1 只影响「位置」，还是连「实力」一起？） ===');
const needPower = ents.filter((e) => missingFields(e, meta, ENTITY_LOOKUP_FIELDS).includes('实力') && e.kind === 'character');
console.log(`  角色里会被排进「查实力」的 = ${needPower.length} / ${ents.filter((e) => e.kind === 'character').length}`);

console.log('\n=== 单实体抽看（前 5 个角色） ===');
for (const e of ents.filter((x) => x.kind === 'character').slice(0, 5)) {
    const mf = missingFields(e, meta, ENTITY_LOOKUP_FIELDS);
    const st = meta.entityFields?.[e.id]?.attempts || {};
    console.log(`  ${e.name}: missingFields=${JSON.stringify(mf)} 实力=${JSON.stringify(e['实力'] ?? null)} location=${JSON.stringify(e.location)} attempts=${JSON.stringify(Object.keys(st))}`);
}
