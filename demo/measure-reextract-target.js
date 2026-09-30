// story-world-v2/demo/measure-reextract-target.js
// 只读：**重抽后能不能达到"v1 一样的效果"**——把重抽后的世界真渲染一遍，逐项对照指标 + 抽真实样本。
// 口径：重抽后的账 = 真书条目 + canon 名册（模拟"模型这次抽出的名册"）跑新 seed；
//   再走真渲染器，数面板上真画出多少「隶属/实力/规模/麾下」。
import { readFileSync } from 'node:fs';
import { seedBookEntities } from '../src/abstract.js';
import { renderAll } from '../src/render.js';
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
const canon = real.context.setting.frozen.canon;

const kindOf = new Map((canon.bookEntities || []).map((b) => [String(b.name), b.kind]));
const kindOfName = (nm) => {
    const n = String(nm ?? '').trim();
    if (kindOf.has(n)) return kindOf.get(n);
    let best = null;
    for (const [k] of kindOf) if (k.length >= 2 && (n.includes(k) || k.includes(n)) && (!best || k.length > best.length)) best = k;
    return best ? kindOf.get(best) : 'character';
};
const seen = new Set();
const roster = [];
for (const e of book) {
    const nm = String(e.comment || '').trim();
    if (!nm || seen.has(nm)) continue;
    seen.add(nm);
    roster.push({ name: nm, kind: kindOfName(nm), content: String(e.content || ''), key: e.key });
}
for (const b of canon.bookEntities || []) {
    const nm = String(b.name);
    if (seen.has(nm)) continue;
    seen.add(nm);
    roster.push({ name: nm, kind: b.kind, content: '' });
}
const world = {
    version: 1,
    context: { world: real.context.world, tension: 0.5, positions: real.context.positions || [], setting: { frozen: { canon: { ...canon, bookEntities: roster } } } },
    entities: [], weights: {}, agendas: [], events: [], chronicle: [], milestones: [],
    meta: { tick: 0, simLog: [] },
};
seedBookEntities(world, { entries: book });
world.context.playerId = world.entities[0]?.id;
const out = renderAll(world, { config: {}, oldVolumes: [], view: {} });
const html = typeof out === 'string' ? out : JSON.stringify(out);

const ents = world.entities;
const chars = ents.filter((e) => e.kind === 'character');
const facs = ents.filter((e) => e.kind === 'faction');
console.log('=== 重抽后的账（新代码口径）===');
console.log(`实体 ${ents.length}（角色 ${chars.length} / 势力 ${facs.length}）`);
const withParent = ents.filter((e) => e.parent).length;
const withPower = chars.filter((e) => e['实力']).length;
const withScale = facs.filter((e) => e['规模']).length;
const facsWithCrew = facs.filter((f) => ents.some((e) => e.kind === 'character' && e.parent && e.parent === f.name)).length;
console.log('--- 面板实测（真渲染器）---');
console.log(`「隶属」出现 ${(html.match(/隶属 /g) || []).length} 次  ← 对应 ${withParent} 个有归属的实体`);
// ★口径修正：实力栏有两种渲染——有值 (`实力<b>值</b>`) 与无据占位 (`实力<b>未查/未加载到/书未明述</b>`)，
//   只按 `实力<b>` 数会把占位也算成"有值"（我第一版就是这么数的，虚高）。这里把占位排除。
const powerValueChips = (html.match(/实力<b>(?!未查|未加载到|书未明述)/g) || []).length;
const powerPlaceholders = (html.match(/实力<b>(?:未查|未加载到|书未明述)/g) || []).length;
console.log(`「实力」有值 ${powerValueChips} 次（账面 ${withPower} 个角色有档位）｜无据占位 ${powerPlaceholders} 次（未查/未加载到/书未明述）`);
console.log(`「规模：」出现 ${(html.match(/规模：/g) || []).length} 次  ← 对应 ${withScale} 个有规模的势力`);
console.log(`「麾下：」出现 ${(html.match(/麾下：/g) || []).length} 次  ← ${facsWithCrew} 个势力能列出成员`);
console.log(`「麾下实力：」出现 ${(html.match(/麾下实力：/g) || []).length} 次  ← 势力实力（由成员派生，你拍板过的那条链）`);
console.log(`「归属空着」出现 ${(html.match(/归属空着/g) || []).length} 次  ← 仍然没有归属的实体`);
console.log(`「（推）」出现 ${(html.match(/（推）/g) || []).length} 次  ← 结构推导来的标注`);

console.log('\n--- 抽 12 个真实样本（看是不是"人话"，不是数字）---');
let n = 0;
for (const e of ents) {
    if (!e.parent && !e['实力'] && !e['规模']) continue;
    const bits = [
        e.parent ? `隶属 ${e.parent}${e.parentSource === '结构推导' ? '（推）' : ''}` : null,
        e['实力'] ? `实力 ${e['实力']}` : null,
        e['规模'] ? `规模 ${e['规模']}` : null,
    ].filter(Boolean);
    console.log(`  ${e.name} [${e.kind}]：${bits.join(' · ')}`);
    if (++n >= 12) break;
}
