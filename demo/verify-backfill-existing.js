// story-world-v2/demo/verify-backfill-existing.js
// 存量补齐**实测**（只读输入，不改聊天文件）：
//   拿真账本（现有 623 实体 + 世界进度） + 真书条目，跑 `seedBookEntities(ssot, { entries })`——
//   零 token（不调模型）——回答三个问题：
//     ①能补多少（归属/实力/规模）；②除"补空栏"外有没有动别的东西（幂等自证）；③世界进度有没有被动。
// 用法：node demo/verify-backfill-existing.js <聊天jsonl副本> <角色卡png>
import { readFileSync } from 'node:fs';
import { seedBookEntities } from '../src/abstract.js';
import { characterBookEntries } from '../web/index.js';

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

const real = JSON.parse(readFileSync(process.argv[2], 'utf8').split('\n')[0]).chat_metadata.story_world_v2.world;
const book = characterBookEntries(cardFromPng(process.argv[3]));

// 深拷贝现有世界（模拟补齐操作；不碰盘上文件、不碰原件）
const world = JSON.parse(JSON.stringify(real));
const before = {
    entities: world.entities.length,
    tick: world.meta?.tick,
    events: (world.events || []).length,
    agendas: (world.agendas || []).length,
    chronicle: (world.chronicle || []).length,
    simLog: (world.meta?.simLog || []).length,
    entityFields: Object.keys(world.meta?.entityFields || {}).length,
    weights: Object.keys(world.weights || {}).length,
    parent: world.entities.filter((e) => e.parent).length,
    实力: world.entities.filter((e) => e['实力']).length,
    规模: world.entities.filter((e) => e['规模']).length,
    locationNamed: world.entities.filter((e) => e.location && e.location !== '未明').length,
};
const frozenBefore = JSON.stringify(world.context?.setting?.frozen || null);

const r = seedBookEntities(world, { entries: book });

const after = {
    entities: world.entities.length,
    tick: world.meta?.tick,
    events: (world.events || []).length,
    agendas: (world.agendas || []).length,
    chronicle: (world.chronicle || []).length,
    simLog: (world.meta?.simLog || []).length,
    entityFields: Object.keys(world.meta?.entityFields || {}).length,
    weights: Object.keys(world.weights || {}).length,
    parent: world.entities.filter((e) => e.parent).length,
    实力: world.entities.filter((e) => e['实力']).length,
    规模: world.entities.filter((e) => e['规模']).length,
    locationNamed: world.entities.filter((e) => e.location && e.location !== '未明').length,
};

console.log('=== 存量补齐实测（零 token，真账 623 实体 + 真书 233 条）===');
console.log(`seed 返回：seeded=${r.seeded}（应为 0——不新建实体）folded=${r.folded} fieldsAttached=${r.fieldsAttached ?? 0} parentVerified=${r.parentVerified ?? 0} parentDemoted=${r.parentDemoted ?? 0}`);
console.log('--- 补齐前后对照 ---');
for (const k of Object.keys(before)) {
    const b = before[k], a = after[k];
    const flag = b === a ? '不变' : `★ ${b} → ${a}`;
    console.log(`  ${k.padEnd(14)} ${String(b).padStart(6)}  ${flag}`);
}
console.log(`  设定面(frozen) ${frozenBefore === JSON.stringify(world.context?.setting?.frozen || null) ? '逐字节不变 ✓' : '★ 被改了！'}`);

// 幂等自证：再跑一次，应当零变化
const snapshot = JSON.stringify(world.entities);
const r2 = seedBookEntities(world, { entries: book });
console.log(`--- 幂等自证（连跑第二次）--- seeded=${r2.seeded} fieldsAttached=${r2.fieldsAttached ?? 0} parentVerified=${r2.parentVerified ?? 0}；实体逐字节${snapshot === JSON.stringify(world.entities) ? '不变 ✓' : '★ 变了！'}`);

console.log('=== 补齐明细抽查 ===');
for (const nm of ['吞天妖王', '混元妖圣', '清玄真人', '玄一道祖', '虞昭华', '姜婆婆', '散修', '昆仑道宫', '混乱之地·万妖盟']) {
    const e = world.entities.find((x) => x.name === nm);
    if (!e) { console.log(`  ${nm}: 不在册`); continue; }
    console.log(`  ${nm}: 实力=${JSON.stringify(e['实力'] ?? null)} 规模=${JSON.stringify(e['规模'] ?? null)} parent=${JSON.stringify(e.parent ?? null)}（${e.parentSource ?? '-'}）`);
}
const bySource = {};
for (const e of world.entities) if (e.parent) bySource[e.parentSource || '?'] = (bySource[e.parentSource || '?'] || 0) + 1;
console.log(`  归属来源分账：${JSON.stringify(bySource)}`);
