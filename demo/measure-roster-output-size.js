// story-world-v2/demo/measure-roster-output-size.js
// 只读：量「名册轮的输出体量」——判断初始化/重抽会不会撞输出上限（EXTRACTION_MAX_TOKENS=16384）。
// 为什么必须量：第二十五棒 e 给名册轮加了 fields{所属/身份/定位/实力}，输出会比旧口径（只 name+kind）大几倍；
//   而分块只按**输入字符**切（ROSTER_CHUNK_CHAR=60000）——输入没超、输出先爆 = JSON 被截断 ⇒ 整块作废。
// 做法：拿真书的条目名当名号池，按新 prompt 的字段形状**模拟模型输出**，逐块估字符与 token。
import { readFileSync } from 'node:fs';
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
const book = characterBookEntries(cardFromPng(process.argv[2]));
const real = JSON.parse(readFileSync(process.argv[3], 'utf8').split('\n')[0]).chat_metadata.story_world_v2.world;
const canon = real.context.setting.frozen.canon.bookEntities || [];

// 名号池 = 真账 canon 名册（模型当年抽出来的那批）+ 书条目名（去重）
const names = new Map();
for (const b of canon) names.set(String(b.name), b.kind);
for (const e of book) { const nm = String(e.comment || '').trim(); if (nm && !names.has(nm)) names.set(nm, 'character'); }

const MEMBER = /^[-*·•\s]*([^\s(（:：、,]{2,20})\s*[（(]\s*(男|女|雄|雌|公|母)?\s*[,，、]?\s*([^)）]{0,24})[)）]/gm;

// 逐条模拟"模型照新 prompt 会输出什么"（取值都来自真书，绝不编）
const rows = [];
for (const [nm, kind] of names) {
    const entry = book.find((e) => String(e.comment || '').trim() === nm);
    const fields = {};
    if (kind === 'faction') {
        const m = /\[\s*势力\s*[:：][^\]（(\n]{0,40}?[（(]([^）)]{2,40})[）)]/.exec(String(entry?.content || ''));
        if (m) fields['规模'] = m[1];
        fields['性质'] = '';
        fields['倾向'] = '';
    } else {
        // 成员行里的所属与档位
        let affil = '', power = '';
        for (const e of book) {
            MEMBER.lastIndex = 0;
            for (const mm of String(e.content || '').matchAll(MEMBER)) {
                if (mm[1].trim() === nm) { affil = String(e.comment || '').trim(); power = (mm[3] || '').trim(); }
            }
            if (affil) break;
        }
        if (affil) fields['所属'] = affil;
        if (power) fields['实力'] = power;
        fields['身份'] = '';
        fields['定位'] = '';
    }
    for (const k of Object.keys(fields)) if (!fields[k]) delete fields[k];
    rows.push({ name: nm, kind, fields });
}

// 按新 prompt 的 JSON 形状序列化（紧凑度与模型输出近似）
const nonEmptyFields = rows.reduce((s, r) => s + Object.keys(r.fields).length, 0);
const compact = JSON.stringify({ bookEntities: rows });
const pretty = JSON.stringify({ bookEntities: rows }, null, 2);
console.log(`名号池 = ${rows.length}（canon ${canon.length} + 书条目 ${book.length}，去重后）`);
console.log(`其中带非空 fields 的条目 = ${rows.filter((r) => Object.keys(r.fields).length).length}，非空字段总数 = ${nonEmptyFields}`);
console.log(`--- 输出体量估算 ---`);
console.log(`紧凑 JSON = ${compact.length} 字符`);
console.log(`美化 JSON（= prompt 里给模型的形状） = ${pretty.length} 字符`);
const tok = (n) => Math.round(n / 1.6);   // 中文 JSON 粗估 1 token ≈ 1.6 字符（保守偏高）
console.log(`≈ token：紧凑 ${tok(compact.length)} / 美化 ${tok(pretty.length)}   （输出上限 EXTRACTION_MAX_TOKENS=16384）`);
console.log(`--- 逐块（按 ROSTER_CHUNK_CHAR=60000 输入切块）---`);
let acc = 0, chunk = 0;
const perChunk = [];
for (const e of book) {
    const len = String(e.content || '').length + String(e.comment || '').length + 20;
    if (acc + len > 60000 && acc > 0) { perChunk.push(chunk); chunk = 0; acc = 0; }
    acc += len; chunk += 1;
}
if (chunk) perChunk.push(chunk);
console.log(`输入分块 = ${perChunk.length} 块，各块书条目数 = ${JSON.stringify(perChunk)}`);
const perBlockOut = rows.length / perChunk.length;
console.log(`若名号在各块均匀分布：每块约 ${perBlockOut.toFixed(0)} 个名号 ⇒ 每块输出约 ${tok(compact.length / perChunk.length)} token（上限 16384）`);
console.log('判读：每块输出远超上限 ⇒ JSON 会被截断 ⇒ 该块作废（sanitize 收不到 bookEntities）');
