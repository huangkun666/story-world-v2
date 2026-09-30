// story-world-v2/demo/measure-reextract-gain.js
// 只读：量「重抽能多拿到什么」——现有账（老代码建）vs 重抽后的账（新代码建）逐项对照。
// 口径：现有账 = 真聊天账本；重抽后的账 = 用真书 + canon 名册(模拟模型那半边)跑新 seed 得到的池。
//   两者都是**同一份真书、同一批真名号**，差别只在新代码会多抽/多推什么。
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

// ① 现有账（老代码建的）
const cur = real.entities || [];
const curChars = cur.filter((e) => e.kind === 'character');
const curFacs = cur.filter((e) => e.kind === 'faction');
console.log('=== 现有账（leg24 后的老代码建的）===');
console.log(`实体 ${cur.length}（角色 ${curChars.length} / 势力 ${curFacs.length}）`);
console.log(`有 parent = ${cur.filter((e) => e.parent).length}｜有实力 = ${cur.filter((e) => e['实力']).length}｜有规模 = ${cur.filter((e) => e['规模']).length}`);

// ② 重抽后的账（新代码 + 真书 + canon 名册）
const canon = real.context.setting.frozen.canon.bookEntities || [];
const kindOf = new Map(canon.map((b) => [String(b.name), b.kind]));
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
for (const b of canon) {
    const nm = String(b.name);
    if (seen.has(nm)) continue;
    seen.add(nm);
    roster.push({ name: nm, kind: b.kind, content: '' });
}
const next = { context: { tension: 0.5, positions: real.context.positions || [], setting: { frozen: { canon: { bookEntities: roster, powerScale: real.context.setting.frozen.canon.powerScale || [] } } } }, entities: [], weights: {} };
seedBookEntities(next, { entries: book });
const nx = next.entities || [];
console.log('\n=== 重抽后的账（新代码；名册=真书条目+canon）===');
console.log(`实体 ${nx.length}（角色 ${nx.filter((e) => e.kind === 'character').length} / 势力 ${nx.filter((e) => e.kind === 'faction').length}）`);
console.log(`有 parent = ${nx.filter((e) => e.parent).length}｜有实力 = ${nx.filter((e) => e['实力']).length}｜有规模 = ${nx.filter((e) => e['规模']).length}`);

// ③ 差额：重抽能多拿到什么
const curNames = new Set(cur.map((e) => e.name));
const nxNames = new Set(nx.map((e) => e.name));
const added = [...nxNames].filter((n) => !curNames.has(n));
const lost = [...curNames].filter((n) => !nxNames.has(n));
console.log('\n=== 差额 ===');
console.log(`重抽会**新增**的名号 = ${added.length}  样例：${added.slice(0, 12).join('、')}`);
console.log(`重抽会**丢掉**的名号 = ${lost.length}  样例：${lost.slice(0, 12).join('、')}`);
console.log(`\n（注：实际重抽时模型抽出的名号是"当年那批 + 新 prompt 多抽的"，本脚本用 canon 模拟"当年那批"，`);
console.log(`  所以 added 只是**上限估计**——真实值取决于模型这次抽出多少。）`);
