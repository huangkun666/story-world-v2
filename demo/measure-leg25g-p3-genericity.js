// story-world-v2/demo/measure-leg25g-p3-genericity.js   （只读，只读书）
// leg25 g · P3 泛用性复核（ANCHOR §2 第 3 条：改判据前必须多书出数，单本不算证据）。
// 问：让「书条目的 key 里出现的 canon 势力名」也当别名（**只看 key，不看条目名**），
//     在八本真实世界书上会不会**造出假关系**？
// 判据（不共线：缺形态只许"不生效"）：
//   ① 自指（成员名 == 势力名）一律算假；
//   ② 势力名过短（<3 字）逐条人看——本仓有实测告诫「泛称当节点会推出假关系」；
//   ③ 覆盖率：这条机制在几本书上**能生效**（有 key∩canon势力 的证据面）。
// 跑法：node demo/measure-leg25g-p3-genericity.js "<worlds 目录>"
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const MEMBER_LINE = /^[-*·•\s]*([^\s(（:：、,]{2,20})\s*[（(]/gm;

function loadEntries(file) {
    const b = JSON.parse(readFileSync(file, 'utf8'));
    const raw = b.entries;
    const list = Array.isArray(raw) ? raw : Object.values(raw || {});
    return list.filter((e) => e && typeof e === 'object').map((e) => ({
        comment: String(e.comment ?? e.name ?? '').trim(),
        content: String(e.content ?? ''),
        key: (Array.isArray(e.keys) ? e.keys : Array.isArray(e.key) ? e.key : [e.key]).map((k) => String(k ?? '').trim()).filter(Boolean),
        disable: e.disable === true || e.enabled === false,
    })).filter((e) => !e.disable);
}

// 这本书的"名册" = 书里所有条目名 + 成员行名号（近似 canon，用于判自指与"在册"）
console.log('leg25 g · P3 泛用性：key 反查别名在多书上的表现（零 token、纯结构）\n');
console.log(`${'书'.padEnd(34)}${'条目'.padStart(6)}${'成员行'.padStart(8)}${'key证据'.padStart(9)}${'可挂上'.padStart(8)}${'自指'.padStart(6)}  结论`);
console.log('-'.repeat(96));

let anyFalse = false;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let entries;
    try { entries = loadEntries(join(dir, f)); } catch { continue; }
    if (!entries.length) continue;

    // "名册" = 条目名 ∪ 成员行名号（这本书自己的名号面）
    const rosterNames = new Set();
    for (const e of entries) {
        if (e.comment) rosterNames.add(e.comment);
        for (const m of e.content.matchAll(MEMBER_LINE)) rosterNames.add(m[1].trim());
    }
    // "疑似势力名" = 条目名 ∪ 它自己的 key（本仓口径：key 是别名面）
    const orgNames = new Set();
    for (const e of entries) { if (e.comment) orgNames.add(e.comment); for (const k of e.key) orgNames.add(k); }

    let memberRows = 0;
    for (const e of entries) memberRows += [...e.content.matchAll(MEMBER_LINE)].length;

    // key 证据：某书条目的 key 里出现另一个"势力名"
    let keyEvidence = 0;
    const attached = [];
    const selfRef = [];
    for (const e of entries) {
        MEMBER_LINE.lastIndex = 0;
        const members = [...e.content.matchAll(MEMBER_LINE)].map((m) => m[1].trim());
        if (!members.length) continue;
        for (const k of e.key) {
            if (!orgNames.has(k) || k.length < 2) continue;
            if (k === e.comment) continue;              // 自己 key 里的自己名 = 不是别名证据
            keyEvidence += 1;
            for (const nm of members) {
                if (!rosterNames.has(nm)) continue;
                if (nm === k) { selfRef.push(`${nm}→${k}`); anyFalse = true; continue; }
                attached.push({ nm, org: k, from: e.comment });
            }
        }
    }
    const uniq = new Map(attached.map((a) => [`${a.nm}→${a.org}`, a]));
    const short = [...uniq.values()].filter((a) => a.org.length < 3);
    const verdict = keyEvidence === 0
        ? '不生效（无 key 证据面）'
        : `${uniq.size} 条关系${selfRef.length ? ` / ★自指 ${selfRef.length}` : ''}${short.length ? ` / 短名 ${short.length}` : ''}`;
    console.log(`${f.slice(0, 32).padEnd(34)}${String(entries.length).padStart(6)}${String(memberRows).padStart(8)}${String(keyEvidence).padStart(9)}${String(uniq.size).padStart(8)}${String(selfRef.length).padStart(6)}  ${verdict}`);
    if (keyEvidence && uniq.size) {
        const sample = [...uniq.values()].slice(0, 6).map((a) => `${a.nm}→${a.org}（来自[${a.from}]）`);
        console.log(`     样例：${sample.join('；')}`);
    }
}

console.log('\n★不共线判据：无 key 证据面的书必须「不生效」（0 条），而不是"给错结果"。');
console.log(anyFalse ? '★发现自指假关系（见上）' : '★未发现自指假关系。');
