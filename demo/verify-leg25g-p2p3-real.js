// story-world-v2/demo/verify-leg25g-p2p3-real.js   （只读，只读副本）
// leg25 g · P2/P3 真账复验：走**生产同一个 seedAndBackfill + inheritLocations**，数改动后的真实产物。
//   P2：9 条 `parentSource === undefined` 应为 0（且凡有 parent 必有来源）
//   P3：虞昭华/秦红袖/沈天君 → 大虞；瑶池圣地 5 人 → 瑶池圣地
// 跑法：node demo/verify-leg25g-p2p3-real.js "<chat jsonl 副本>" "<角色卡 png>"
import { readFileSync } from 'node:fs';
import { characterBookEntries, inheritLocations, seedAndBackfill } from '../web/index.js';

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

const account = JSON.parse(readFileSync(process.argv[2], 'utf8').split('\n')[0]).chat_metadata.story_world_v2.world;
const entries = characterBookEntries(cardFromPng(process.argv[3]));

// 生产链：seedAndBackfill（loadWorld 那一刀）+ inheritLocations
const hot = JSON.parse(JSON.stringify(account));
const before = {
    parent: hot.entities.filter((e) => e.parent).length,
    noSrc: hot.entities.filter((e) => e.parent && !e.parentSource).length,
};
const { seed } = seedAndBackfill(hot, { entries });
const loc = inheritLocations(hot, { entries });
const w = loc.ssot;

const after = {
    parent: w.entities.filter((e) => e.parent).length,
    noSrc: w.entities.filter((e) => e.parent && !e.parentSource).length,
};

console.log('leg25 g · P2/P3 真账复验（生产同一链）\n');
console.log(`入册：seeded=${seed.seeded} folded=${seed.folded} 警告=${(seed.warnings || []).length}`);
console.log(`\nP2 · 归属来源：`);
console.log(`  改动前（你机器上那份账）：有 parent ${before.parent} · ★缺来源 ${before.noSrc}`);
console.log(`  走完生产链后：            有 parent ${after.parent} · ★缺来源 ${after.noSrc}`);
console.log(`  ${after.noSrc === 0 ? '✓ 缺来源已清零' : '✗ 仍有缺来源'}`);
const srcTally = {};
for (const e of w.entities) if (e.parent) srcTally[e.parentSource || '★undefined'] = (srcTally[e.parentSource || '★undefined'] || 0) + 1;
console.log(`  来源分账 = ${JSON.stringify(srcTally)}`);

console.log(`\nP3 · 虞昭华 等 8 条：`);
const want = ['虞昭华', '秦红袖', '沈天君', '瑶池圣母', '灭情师太', '蟠桃树灵·夭夭', '青鸟', '叶清璇'];
let ok = 0;
for (const nm of want) {
    const e = w.entities.find((x) => x.name === nm);
    const expect = ['虞昭华', '秦红袖', '沈天君'].includes(nm) ? '大虞' : '瑶池圣地';
    const got = e?.parent ?? null;
    const pass = got === expect;
    if (pass) ok += 1;
    console.log(`  ${pass ? '✓' : '✗'} ${nm} → ${got ?? '(无)'}（应 ${expect}）${e?.parentSource ? ` [${e.parentSource}/${e.parentSourceFrom}]` : ''}`);
}
console.log(`  ${ok}/${want.length} 符合预期`);

console.log(`\n大虞 / 瑶池圣地 麾下反查：`);
for (const org of ['大虞', '瑶池圣地']) {
    const crew = w.entities.filter((e) => e.parent === org).map((e) => e.name);
    console.log(`  ${org}：${crew.length} 人 ${JSON.stringify(crew.slice(0, 10))}`);
}

console.log(`\n幂等自证（再跑一遍生产链，应无新增写入）：`);
const hot2 = JSON.parse(JSON.stringify(w));
const r2 = seedAndBackfill(hot2, { entries });
console.log(`  seeded=${r2.seed.seeded}（应 0）· 有 parent ${hot2.entities.filter((e) => e.parent).length}（应仍为 ${after.parent}）`);
