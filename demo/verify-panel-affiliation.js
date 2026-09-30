// story-world-v2/demo/verify-panel-affiliation.js
// 只读：把真书种出来的世界送进真渲染器，数一遍面板上「隶属/规模/实力/（推）」到底画出来了没有。
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
const bookEntities = book.map((e) => ({ name: String(e.comment || '').trim(), kind: kindOfName(e.comment), content: String(e.content || ''), key: e.key })).filter((b) => b.name);
// ★真链路上，名册 = **模型抽的名号**（书正文里的角色名，如「吞天妖王」只出现在势力条目的成员行上，
//   自己**没有独立条目**）+ **书条目名**。本脚本没有模型，就用 canon 名册模拟"模型那一半"，
//   否则夹具里根本没有这些角色 ⇒ 关系自然挂不上（我第一版夹具就是这么得出假的 0 条的）。
{
    const seen = new Set(bookEntities.map((b) => b.name));
    for (const b of (canon.bookEntities || [])) {
        const nm = String(b.name);
        if (seen.has(nm)) continue;
        seen.add(nm);
        bookEntities.push({ name: nm, kind: b.kind, content: '', key: undefined });
    }
}
// 诊断：名册里到底有没有那条势力条目、kind 判成什么
{
    const t = bookEntities.find((b) => b.name === '混乱之地·万妖盟');
    console.log(`[诊断] 名册含「混乱之地·万妖盟」= ${JSON.stringify(t ? { kind: t.kind, len: t.content.length } : null)}`);
    const byKind = {};
    for (const b of bookEntities) byKind[b.kind] = (byKind[b.kind] || 0) + 1;
    console.log(`[诊断] 名册 kind 分布 = ${JSON.stringify(byKind)}（共 ${bookEntities.length}）`);
}
const world = { context: { tension: 0.5, positions: real.context.positions || [], setting: { frozen: { canon: { bookEntities, powerScale: canon.powerScale || [] } } } }, entities: [], weights: {} };
seedBookEntities(world);
console.log(`[诊断] seed 后 = ${(world.entities || []).length} 实体，有 parent = ${(world.entities || []).filter((e) => e.parent).length}，有规模 = ${(world.entities || []).filter((e) => e['规模']).length}`);
console.log(`[诊断] 吞天妖王在实体池 = ${(world.entities || []).some((e) => e.name === '吞天妖王')}`);
{
    const m = new Map();
    for (const b of bookEntities) {
        if (b.kind !== 'faction') continue;
        const nm = /^[-*·•\s]*([^\s(（:：、,]{2,20})\s*[（(]/gm;
        const set = new Set();
        for (const mm of String(b.content).matchAll(nm)) set.add(mm[1].trim());
        if (set.size) m.set(b.name, set);
    }
    console.log(`[诊断] 直连测：含成员行的势力条目 = ${m.size}；万妖盟条目成员 = ${JSON.stringify([...(m.get('混乱之地·万妖盟') || [])].slice(0, 6))}`);
    const inPool = [...(m.get('混乱之地·万妖盟') || [])].filter((n) => (world.entities || []).some((e) => e.name === n));
    console.log(`[诊断] 其中在实体池 = ${JSON.stringify(inPool)}`);
}
// 视图层需要的最小补齐（真链路由 refreshWorld 提供）
world.meta = { tick: 0, simLog: [] };
world.chronicle = []; world.events = []; world.agendas = []; world.context.playerId = world.entities[0]?.id;
const out = renderAll(world, { config: {}, oldVolumes: [], view: {} });
const html = typeof out === 'string' ? out : JSON.stringify(out);
const count = (re) => (html.match(re) || []).length;
const withParent = (world.entities || []).filter((e) => e.parent);
console.log(`[诊断] 渲染后 world.entities 有 parent 的 = ${withParent.length}；样例 = ${JSON.stringify(withParent.slice(0, 3).map((e) => [e.name, e.parent, e.parentSource]))}`);
console.log(`[诊断] renderAll 返回类型 = ${typeof out}，键 = ${out && typeof out === 'object' ? Object.keys(out).join(',') : '-'}`);
const entHtml = JSON.stringify(out?.entity || out?.entities || '');
console.log(`[诊断] entity 页签 HTML 长度 = ${entHtml.length}`);
console.log('=== 面板渲染实测（真书种世界 + 真渲染器）===');
console.log(`HTML 总长 = ${html.length}`);
console.log(`「隶属 X」出现 = ${count(/隶属 /g)} 次`);
console.log(`「上级 X」出现 = ${count(/上级 /g)} 次`);
console.log(`「（推）」标记 = ${count(/（推）/g)} 次`);
console.log(`「规模：」出现 = ${count(/规模：/g)} 次`);
console.log(`「麾下：」出现 = ${count(/麾下：/g)} 次`);
console.log(`「麾下实力：」出现 = ${count(/麾下实力：/g)} 次`);
console.log(`「归属空着」出现 = ${count(/归属空着/g)} 次`);
const sample = html.match(/<div class="sw2-eaffil">[^<]{0,40}<\/div>/g) || [];
console.log('--- 样例片段 ---');
for (const s of sample.slice(0, 10)) console.log(`  ${s}`);
