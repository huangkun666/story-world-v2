// story-world-v2/demo/measure-parent-derivation.js
// 只读核验：**零 token 结构推导**势力↔角色关联的真实覆盖率。
// 口径（严）：
//   ① 来源必须是**势力条目**（书的 comment 命中 canon.bookEntities 里 kind=faction 的名号）；
//      非势力条目（世界总设定/功法/购买力…）一律不参与——上一版松口径在这里出过假数 189。
//   ② 成员行必须符合大荒形态：`- 名号 (男, T8大乘中期): …`（名号 + 括号 + 性 + 档位）。
//   ③ 名号必须在册（账本 entities）才算"能填"。
// 输出：能填多少 / 与账面现状的差 / 逐条样例（可审计）。
// 用法：node demo/measure-parent-derivation.js <聊天jsonl副本> <角色卡png>
import { readFileSync } from 'node:fs';
import { characterBookEntries } from '../web/index.js';

function head(file) {
    const raw = readFileSync(file, 'utf8');
    return JSON.parse(raw.slice(0, raw.indexOf('\n')));
}
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

const world = head(process.argv[2]).chat_metadata.story_world_v2.world;
const canon = world.context?.setting?.frozen?.canon || {};
const book = characterBookEntries(cardFromPng(process.argv[3]));
const ents = world.entities || [];
const byName = new Map(ents.map((e) => [e.name, e]));

// 势力名集合（书里明述 kind=faction 的名号）——推导只认这些条目
const factionNames = new Set((canon.bookEntities || []).filter((b) => b.kind === 'faction').map((b) => String(b.name)));
const factionNameList = [...factionNames].sort((a, b) => b.length - a.length);   // 长名优先（防子串误命中）
const kindOfComment = (comment) => {
    const c = String(comment || '').trim();
    if (factionNames.has(c)) return 'faction';
    for (const f of factionNameList) if (c.includes(f)) return 'faction';   // 「混乱之地·万妖盟」含「万妖盟」
    return 'other';
};

const STRICT = /^[-*·•\s]*([^\s(（:：、,]{2,16})\s*[（(]\s*(男|女|雄|雌|公|母)\s*[,，、]\s*([^)）]{1,24})[)）]\s*[：:]/gm;

const derived = new Map();     // 角色名 → { org, tier }
const perOrg = [];
let scannedEntries = 0, scannedRows = 0;
for (const e of book) {
    const comment = String(e.comment || '').trim();
    if (kindOfComment(comment) !== 'faction') continue;
    scannedEntries += 1;
    const content = String(e.content || '');
    STRICT.lastIndex = 0;
    const rows = [...content.matchAll(STRICT)];
    scannedRows += rows.length;
    const hitRows = [];
    for (const m of rows) {
        const nm = m[1].trim();
        if (!byName.has(nm)) continue;                    // 不在册 → 不计（能填才算）
        hitRows.push(nm);
        if (!derived.has(nm)) derived.set(nm, { org: comment, tier: m[3].trim() });
    }
    if (hitRows.length) perOrg.push({ org: comment, total: rows.length, inRoster: hitRows.length });
}

console.log('=== 口径确认 ===');
console.log(`书名录 kind=faction 名号 = ${factionNames.size}   账本 entities = ${ents.length}`);
console.log(`判定为**势力条目**的书条目 = ${scannedEntries}   其中严口径成员行 = ${scannedRows} 行`);
console.log(`=== 结果 ===`);
console.log(`可零 token 推出的在册角色 = ${derived.size} 人`);
const already = [...derived.keys()].filter((n) => byName.get(n)?.parent).length;
console.log(`  其中账面已有 parent = ${already}   ⇒ 本次能新增 = ${derived.size - already}`);
const chars = ents.filter((e) => e.kind === 'character');
console.log(`  覆盖率 = ${derived.size} / ${chars.length} 角色 = ${(derived.size / chars.length * 100).toFixed(1)}%`);
console.log(`涉及势力条目 = ${perOrg.length} 个`);
console.log('=== 逐条样例（可审计：角色 → 势力 / 档位） ===');
let n = 0;
for (const [nm, d] of derived) { console.log(`  ${nm} → ${d.org}  [${d.tier}]`); if (++n >= 12) break; }
console.log('=== 每个势力能挂上几人（前 10） ===');
for (const p of perOrg.sort((a, b) => b.inRoster - a.inRoster).slice(0, 10)) console.log(`  ${p.org}: 成员行 ${p.total} 行，在册 ${p.inRoster} 人`);
