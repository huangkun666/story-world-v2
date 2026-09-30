// story-world-v2/demo/measure-leg25h-entrymark.js   （只读，只读书）
// 「条目名」在书原文里有没有可依赖的形态？（= 正名裁决能不能不再靠块顺序）
//   抽象喂给模型的每一行就是 `【条目名】正文`（见 extractWorldSetting 的 rows 构造），
//   所以只要书条目名基本都出现在 `【…】` 里，就能用它判"哪个叫法是书里的条目名"。
// 量：八本书里 (a) `【…】` 标记个数 (b) 条目名能被 `【名】` 精确命中的比例 (c) 反例（有名字但没标记）
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
console.log('leg25 h · 「条目名」形态可靠性（八本真实世界书）\n');
console.log(`${'书'.padEnd(30)}${'条目'.padStart(6)}${'【】标记'.padStart(9)}${'精确命中'.padStart(9)}${'命中率'.padStart(8)}  反例样例`);
console.log('-'.repeat(104));

let allOk = true;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let entries;
    try {
        const b = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        const raw = b.entries;
        const list = Array.isArray(raw) ? raw : Object.values(raw || {});
        entries = list.filter((e) => e && typeof e === 'object' && e.disable !== true)
            .map((e) => ({ c: String(e.comment ?? e.name ?? '').trim(), content: String(e.content ?? '') }))
            .filter((e) => e.c && e.content);
    } catch { continue; }
    if (!entries.length) continue;

    // 生产同款的行形态：`【条目名】正文`
    const rows = entries.map((e) => `【${e.c}】${e.content}`);
    const src = rows.join('\n');
    const marks = (src.match(/【[^】]{1,60}】/g) || []).length;
    let hit = 0;
    const miss = [];
    for (const e of entries) {
        if (src.includes(`【${e.c}】`)) hit += 1;
        else if (miss.length < 3) miss.push(e.c);
    }
    const rate = `${(hit / entries.length * 100).toFixed(0)}%`;
    console.log(`${f.slice(0, 28).padEnd(30)}${String(entries.length).padStart(6)}${String(marks).padStart(9)}${String(hit).padStart(9)}${rate.padStart(8)}  ${miss.join('、')}`);
    if (hit / entries.length < 0.9) allOk = false;
}
console.log('-'.repeat(104));
console.log('★判读：命中率高 ⇒ 「名字出现在 `【名】` 里」可以当**书自己写的条目名**证据（形态判据，非词表）；');
console.log('  命中率低 ⇒ 这条判据不可靠，正名裁决只能退到"并列时保持书序"，缺口要如实留着。');
console.log(allOk ? '★结论：八本书都 ≥90% ⇒ 判据可用。' : '★结论：**有书明显低于 90%** ⇒ 判据不可全信（见上方反例）。');
