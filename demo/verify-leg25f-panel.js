// story-world-v2/demo/verify-leg25f-panel.js
// leg25 f 复验（只读）：用**真卡 + 真书 + 真账**走一遍修好后的生产链，把下游真实产物数出来。
//   链：卡内置书（真 ST 形状）→ bookEntriesForInherit 同口径取条目 → inheritLocations（loadWorld 那一刀）
//       → refreshWorld 的渲染入口 renderAll → 数面板上到底画出了什么。
// 跑法：node demo/verify-leg25f-panel.js "<chat jsonl 副本>" "<角色卡 png>"
// 纪律：只读副本；不打印任何密钥；数真产物不数断言。
import { readFileSync } from 'node:fs';
import { characterBookEntries, inheritLocations } from '../web/index.js';
import { renderAll } from '../src/render.js';
import { PANEL_BUILD } from '../src/render-base.js';   // ★leg85：共用底搬进 render-base.js

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

const chatPath = process.argv[2];
const pngPath = process.argv[3];
const world = JSON.parse(readFileSync(chatPath, 'utf8').split('\n')[0]).chat_metadata.story_world_v2.world;
const card = cardFromPng(pngPath);

// 真 ST 形状的条目（web 侧 collectWorldInfoEntries 走的就是 characterBookEntries 这一路）
const entries = characterBookEntries(card);
console.log('=== 取书（生产同口径） ===');
console.log(`卡内置书条目 = ${entries.length}（带 comment/content/key 三件套）`);
console.log(`样例键形状：${JSON.stringify(entries[0]?.key)}（数组）｜comment=${JSON.stringify(entries[0]?.comment)}`);

console.log('\n=== loadWorld 那一刀：inheritLocations ===');
const before = world.entities.filter((e) => e.location && e.location !== '未明').length;
const r = inheritLocations(world, { entries });
const after = r.ssot.entities.filter((e) => e.location && e.location !== '未明').length;
console.log(`真位置 ${before} → ${after}（推断 ${r.inherited}）｜占位「未明」 ${r.ssot.entities.filter((e) => e.location === '未明').length}`);
const again = inheritLocations(r.ssot, { entries });
console.log(`幂等自证：再跑一次 = ${again.inherited}（应 0）`);

// 视图层最小补齐（真链路由 refreshWorld 提供）
const w = again.ssot;
w.meta = w.meta || { tick: 0, simLog: [] };
w.chronicle = w.chronicle || []; w.events = w.events || []; w.agendas = w.agendas || [];
w.milestones = w.milestones || [];
w.context.playerId = w.context.playerId || w.entities[0]?.id;

const out = renderAll(w, { config: { lookupTask: null }, oldVolumes: [], view: {} });
const entHtml = typeof out?.entities === 'string' ? out.entities : JSON.stringify(out?.entities ?? '');
const count = (re) => (entHtml.match(re) || []).length;

console.log(`\n=== 面板真实产物（renderAll → 实体页）===`);
console.log(`构建号在位 = ${entHtml.includes(PANEL_BUILD)}（${PANEL_BUILD}）｜HTML 长度 = ${entHtml.length}`);
console.log(`位置列有真地名（sw2-locval） = ${count(/class="sw2-locval"/g)}`);
console.log(`「（推）」标记              = ${count(/（推）/g)}`);
console.log(`位置列空态 chip（未载类）   = ${count(/sw2-c-loc"[^>]*>\s*<span class="sw2-eattr nodata"/g)}`);
console.log(`关系行「规模」 = ${count(/<i>规模<\/i>/g)}｜「隶属」= ${count(/<i>隶属<\/i>/g)}｜「上级」= ${count(/<i>上级<\/i>/g)}｜「麾下」= ${count(/<i>麾下<\/i>/g)}｜「麾下实力」= ${count(/<i>麾下实力<\/i>/g)}`);
console.log(`旧类名残留（sw2-eaffil / sw2-eloc / sw2-eagenda）= ${count(/sw2-eaffil|sw2-eloc|sw2-eagenda/g)}（应 0）`);
console.log(`占位词被当成"值"渲染（sw2-relval>未明）= ${count(/sw2-relval">未明</g)}（应 0）`);

console.log('\n--- 抽样：有真位置的角色行（前 3 条）---');
const rows = entHtml.split('<div class="sw2-entity-row').slice(1);
let shown = 0;
for (const row of rows) {
    if (!row.includes('sw2-locval') || shown >= 3) continue;
    const name = /sw2-ename">([^<]+)</.exec(row)?.[1];
    const loc = /sw2-locval">([^<]+)</.exec(row)?.[1];
    const rels = [...row.matchAll(/<i>([^<]{1,6})<\/i>\s*<span class="sw2-relval">([^<]{0,40})<\/span>/g)].map((m) => `${m[1]}=${m[2]}`);
    const deriv = row.includes('（推）') ? '（推）' : '';
    console.log(`  ${name} @ ${loc}${deriv}  ${rels.length ? '｜' + rels.join(' ') : ''}`);
    shown += 1;
}

console.log('\n--- 抽样：最有内容的势力行（麾下最长的那条）---');
let best = null;
for (const row of rows) {
    const crew = /<i>麾下<\/i>([^<]*)/.exec(row);
    if (crew && (!best || crew[1].length > best.len)) best = { row, len: crew[1].length };
}
if (best) {
    const name = /sw2-ename">([^<]+)</.exec(best.row)?.[1];
    const scale = /<i>规模<\/i>\s*<span class="sw2-relval">([^<]*)</.exec(best.row)?.[1];
    const loc = /sw2-locval">([^<]+)</.exec(best.row)?.[1] || '（未载）';
    const crew = /<i>麾下<\/i>([^<]*)/.exec(best.row)?.[1] || '';
    console.log(`  ${name} @ ${loc} 规模=${scale}`);
    console.log(`  麾下（${crew.split('、').length} 人，前 8）：${crew.split('、').slice(0, 8).join('、')}`);
} else {
    console.log('  （没有画出麾下的势力行）');
}
