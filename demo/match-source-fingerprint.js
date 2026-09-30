// story-world-v2/demo/match-source-fingerprint.js
// 第十九棒：取数铁证比对——把世界书（+可选角色卡件）按引擎真实算法（composeInitSource + bookFingerprint）
// 拼出合订文本并计算指纹，与导出世界的 setting.frozen.fingerprint 对账：
//   node demo/match-source-fingerprint.js [世界书json路径] [导出世界json路径] [角色卡png路径]
// 输出：条目数/总字符/各口径指纹（书纯拼 vs 书+卡四件套；浏览器合订缺省防御上限=500k）。
import { composeInitSource } from '../src/init-source.js';
import { bookFingerprint } from '../src/fingerprint.js';
import { readFileSync } from 'node:fs';

function pngCardJson(path) {
    const buf = readFileSync(path);
    const out = [];
    let off = 8;
    while (off + 8 <= buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
            const text = data.toString('utf8');
            const nul = text.indexOf('\0');
            const keyword = nul >= 0 ? text.slice(0, nul) : '';
            let payload = nul >= 0 ? text.slice(nul + 1) : '';
            if (type === 'iTXt') { // keyword\0 压缩标志(1) 压缩方法(1) 语言\0 译名\0 正文
                payload = payload.slice(2);
                const l = payload.indexOf('\0');
                if (l >= 0) { payload = payload.slice(l + 1); const t = payload.indexOf('\0'); if (t >= 0) payload = payload.slice(t + 1); }
            }
            const tryParse = (s) => { const t = s.trim(); if (t.startsWith('{') || t.startsWith('[')) { const j = JSON.parse(t); return j && typeof j === 'object' ? j : null; } return null; };
            let json = null;
            try { json = tryParse(payload); } catch (_) {}
            if (!json) { try { json = tryParse(Buffer.from(payload, 'base64').toString('utf8')); } catch (_) {} }
            if (json && (json.name !== undefined || json.description !== undefined || json.data !== undefined)) out.push({ keyword, json });
        }
        off += 8 + len + 4;
    }
    return out;
}

function piecesOf(card) {
    const p = {};
    for (const k of ['description', 'scenario', 'personality', 'first_mes']) {
        const v = card?.[k];
        if (typeof v === 'string' && v.trim()) p[k] = v;
    }
    return p;
}

const worldFile = process.argv[2] || 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/worlds/大荒-姬元真.json';
const exportFile = process.argv[3];
const cardFile = process.argv[4];

const raw = JSON.parse(readFileSync(worldFile, 'utf8'));
const entries = raw.entries;
const list = Array.isArray(entries) ? entries : Object.values(entries);
console.log('book entries =', list.length);

let card = null;
let cardBookList = null;
if (cardFile) {
    const chunks = pngCardJson(cardFile);
    card = chunks[0]?.json ?? null;
    if (card) {
        const book = card?.data?.character_book || card?.character_book;
        const bookEntries = book?.entries;
        cardBookList = bookEntries ? (Array.isArray(bookEntries) ? bookEntries : Object.values(bookEntries)) : null;
        console.log('card:', card.name, '| world =', card.world, '| pieces =', Object.entries(piecesOf(card)).map(([k, v]) => `${k}:${Array.from(v).length}`).join(' '), '| cardBook entries =', cardBookList?.length ?? 'none');
    } else console.log('card parse: no json found in chunks');
}

const variants = [
    { label: 'book-only', character: null, extra: [] },
    { label: 'book+pieces', character: card ? { name: card.name, ...piecesOf(card) } : null, extra: [] },
    { label: 'book+cardBook', character: card ? { name: card.name } : null, extra: cardBookList ?? [] },
    { label: 'book+cardBook+pieces', character: card ? { name: card.name, ...piecesOf(card) } : null, extra: cardBookList ?? [] },
];
for (const v of variants) {
    const res = composeInitSource({ character: v.character, worldInfoEntries: [...list, ...v.extra] }); // 缺省预算 500k（浏览器同款）
    console.log(`${v.label} @500k: ok = ${res.ok} | usedChars = ${res.usedChars} | truncated = ${res.truncated} | fp = ${res.ok ? bookFingerprint(res.text) : 'n/a'}`);
}

if (exportFile) {
    const out = JSON.parse(readFileSync(exportFile, 'utf8'));
    const w = out?.world ?? out;
    const fp = w?.context?.setting?.frozen?.fingerprint;
    const canon = w?.context?.setting?.frozen?.canon;
    console.log('export fingerprint =', fp);
    console.log('export canon =', canon ? { powerScale: canon.powerScale?.length, rules: canon.rules?.length, historyNotes: canon.historyNotes?.length, bookEntities: canon.bookEntities?.length, society: String(canon.society ?? '').slice(0, 40) } : null);
    console.log('export entities =', w?.entities?.length, '->', (w?.entities || []).slice(0, 12).map((e) => `${e.name}[${e.kind}]`).join(', '));
    for (const v of variants) {
        const res = composeInitSource({ character: v.character, worldInfoEntries: [...list, ...v.extra] });
        if (res.ok && fp === bookFingerprint(res.text)) console.log(`★ MATCH ${v.label}：导出世界确由 大荒-姬元真 ${v.label} 口径合订文本抽取`);
    }
}