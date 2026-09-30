// story-world-v2/demo/measure-leg25g-p1-regex.js   （只读，只读书）
// leg25 g · P1 真缺陷量化：驻地正则 `(?:所在地|核心底蕴|驻地)` 会命中「所在地域」的**前缀**，
//   抽出 `域: 汜水关` 这类碎片 ⇒ 经 derivePositions 进位置集 = **幻影地名**（且违反"引擎不发明地名"）。
//   本脚本量三件事：
//     ① 八本书里「所在地域」这种**变体字段名**出现几次（决定这是不是普遍形态）；
//     ② 修正后的正则在每本书上抽出多少个地域串、其中有多少**不是地名**（含标点/冒号/过短）；
//     ③ 对照用户真账 canon 的位置集：现存位置集里有没有已经混进去的碎片。
// 跑法：node demo/measure-leg25g-p1-regex.js "<worlds 目录>"
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const OLD = /(?:所在地|核心底蕴|驻地)[:：]?\s*([^\n。；]{2,30})/;                 // 现行（修正前）
// 修正版 = **实际发出去的那条**（src/entity-lookup.js:586）：汉字边界 `(?![\u4e00-\u9fff])` + 扫全部命中。
//   一开始我写成"加一个「所在地域」变体"，其实边界那一条就把「所在地域」覆盖了（域 是汉字 ⇒ 前缀被否掉），
//   所以这里必须与实修一致，否则量的是没发出去的东西。
const NEW = /(?:所在地|核心底蕴|驻地)(?![\u4e00-\u9fff])[:：]?\s*([^\n。；]{2,30})/g;
const looksLikePlace = (s) => {
    const t = String(s).trim();
    if (t.length < 2) return false;
    if (/[:：]/.test(t)) return false;          // 带冒号 = 碎片（如 `域: 汜水关`）
    if (/^[^\u4e00-\u9fff]*$/.test(t)) return false;
    return true;
};

function loadEntries(file) {
    const b = JSON.parse(readFileSync(file, 'utf8'));
    const raw = b.entries;
    const list = Array.isArray(raw) ? raw : Object.values(raw || {});
    return list.filter((e) => e && typeof e === 'object').map((e) => ({
        comment: String(e.comment ?? e.name ?? '').trim(),
        content: String(e.content ?? ''),
        disable: e.disable === true || e.enabled === false,
    })).filter((e) => !e.disable);
}

console.log('leg25 g · P1 驻地正则缺陷量化（八本真实世界书）\n');
console.log(`${'书'.padEnd(34)}${'驻地段'.padStart(7)}${'含所在地域'.padStart(11)}${'现行抽出'.padStart(9)}${'修正抽出'.padStart(9)}${'修正后仍可疑'.padStart(13)}`);
console.log('-'.repeat(96));

let totalVariant = 0, totalOld = 0, totalNew = 0, totalSus = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let entries;
    try { entries = loadEntries(join(dir, f)); } catch { continue; }
    if (!entries.length) continue;
    let variant = 0, oldN = 0, newN = 0;
    const sus = [];
    for (const e of entries) {
        if (e.content.includes('所在地域')) variant += 1;
        const mo = OLD.exec(e.content);
        if (mo) {
            oldN += 1;
            if (!looksLikePlace(mo[1])) sus.push(`[${e.comment}] 现行→「${mo[1].trim().slice(0, 20)}」`);
        }
        const mn = [...e.content.matchAll(NEW)];
        if (mn.length) newN += 1;
    }
    totalVariant += variant; totalOld += oldN; totalNew += newN;
    // 修正后的可疑（同一个判据）
    let newSus = 0;
    for (const e of entries) {
        for (const mm of e.content.matchAll(NEW)) {
            if (!looksLikePlace(mm[1])) { newSus += 1; sus.push(`[${e.comment}] 修正→「${mm[1].trim().slice(0, 20)}」`); }
        }
    }
    totalSus += newSus;
    console.log(`${f.slice(0, 32).padEnd(34)}${String(oldN).padStart(7)}${String(variant).padStart(11)}${String(oldN).padStart(9)}${String(newN).padStart(9)}${String(newSus).padStart(13)}`);
    for (const s of sus.slice(0, 3)) console.log(`      ${s}`);
}
console.log('-'.repeat(96));
console.log(`合计：现行抽出 ${totalOld} 段 · 修正后 ${totalNew} 段 · 修正后仍可疑 ${totalSus} 段 · 含「所在地域」的条目 ${totalVariant}`);

// ③ 用户真账位置集里有没有碎片
if (process.env.SWV2_CHAT) {
    const raw = readFileSync(process.env.SWV2_CHAT, 'utf8');
    const world = JSON.parse(raw.slice(0, raw.indexOf('\n'))).chat_metadata.story_world_v2.world;
    const pos = world.context?.positions || [];
    const dirty = pos.filter((p) => !looksLikePlace(p) && p !== '未明');
    console.log(`\n③ 你账上位置集 ${pos.length} 项 · 被判为"碎片/非地名"的 = ${dirty.length}：${JSON.stringify(dirty)}`);
    console.log(`   （位置集来源是 canon 的 kind=location 条目 + 条目 location 串——若这里干净，说明碎片还没进过你的账）`);
}
