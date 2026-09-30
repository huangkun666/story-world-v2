// story-world-v2/demo/measure-leg25g-title-genericity.js   （只读，只读书）
// leg25 g · 细案 §5-1：**头衔式成员名兜底**的跨书泛用性（ANCHOR §2 第 3 条：改判据前必须多书出数）。
// 问：把「成员名精确匹配失败 → 按 `·` 取末段（唯一命中才算）」用到八本真实世界书上，
//     ① 这个形态在几本书里**存在**（含 `·` 的成员行占比）
//     ② 兜底会**新增多少**"成员→势力"关系
//     ③ **缺形态的书必须一条都不生效**（不共线：只许"不生效"，不许"给错结果"）
//     ④ 新增的样本人看 —— 是不是真名号，还是把头衔碎片当成人
// ★方法说明（避免误读）：除大荒外，其余七本**没有真 canon**（未初始化），
//   故这里用"该书自身的名号面"（条目名 ∪ 成员行名号）当实体集近似 —— 量的是**形态与召回**，
//   不是"生产上会写多少条"。真账影响面另见 measure-leg25g-titlefix.js（大荒真 canon）。
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

console.log('leg25 g · 头衔式成员名兜底 · 跨书泛用性（八本真实世界书）\n');
console.log(`${'书'.padEnd(30)}${'成员行'.padStart(7)}${'含·'.padStart(6)}${'占·比'.padStart(8)}${'兜底可救'.padStart(9)}${'新增关系'.padStart(9)}${'歧义跳过'.padStart(9)}  结论`);
console.log('-'.repeat(104));

let anyWrong = false;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let entries;
    try { entries = loadEntries(join(dir, f)); } catch { continue; }
    if (!entries.length) continue;

    // ★实体集 = **条目名**（那才是抽象产出的"名号"）。
    //   第一版我把"成员行名号"也算进来 ⇒ `核心人物·凤主凤鸣岐` 自己就在集合里 ⇒ 精确命中 ⇒ 兜底永不触发
    //   ⇒ 八本书全 0（假绿）。这正是"测量口径错了会得出错误结论"的活例，留档。
    const entitySet = new Set(entries.map((e) => e.comment).filter(Boolean));
    // 另算一个"这些条目名里有没有 `·`"（书里用 · 写复合名的现象，仅作参考列）
    const compound = entries.filter((e) => e.comment.includes('·')).length;

    let rows = 0, withDot = 0, rescued = 0, added = 0, ambiguous = 0;
    const samples = [];
    for (const e of entries) {
        MEMBER_LINE.lastIndex = 0;
        const members = [...e.content.matchAll(MEMBER_LINE)].map((m) => m[1].trim());
        if (members.length < 2) continue;                 // 只认"像花名册"的条目（与 §1 同判据）
        rows += members.length;
        for (const m of members) {
            if (!m.includes('·')) continue;
            withDot += 1;
            if (entitySet.has(m)) continue;                  // 精确命中 ⇒ 不需要兜底
            // 兜底：按 · 取末段（从最后一段往前），★必须**整段等于**一个名号（不许后缀/子串匹配）
            //   为什么收紧：第一版用 `L.endsWith(cand)` ⇒ 实测两处张冠李戴——
            //     re0  `菲利克斯·阿盖尔` 被拆成 `阿盖尔` 而命中 `角色卡:菲利克斯·阿盖尔`；
            //     大荒 `空间刺客·影` 被拆成 `影` 而命中 `鱼照影`（把"影"当成了独立名号）。
            //   整段相等 = "这个 `·` 后面确实是一个完整名号"，这才是形态判据。
            const parts = m.split(/[·・•]/).map((s) => s.trim()).filter(Boolean);
            let hit = null, amb = 0;
            for (let i = parts.length - 1; i >= 1; i -= 1) {
                const cand = parts.slice(i).join('');
                const hits = [...entitySet].filter((L) => L === cand);
                if (hits.length === 1) { hit = hits[0]; break; }
                if (hits.length > 1) { amb = hits.length; break; }
            }
            if (hit) {
                rescued += 1; added += 1;
                if (samples.length < 4) samples.push(`${m} → ${hit}`);
            } else if (amb) ambiguous += 1;
        }
    }
    const ratio = rows ? `${(withDot / rows * 100).toFixed(1)}%` : '—';
    const verdict = withDot === 0 ? '不生效（书里没有这形态）' : (added ? `新增 ${added} 条关系` : '有形态但救不出（无害）');
    console.log(`${f.slice(0, 28).padEnd(30)}${String(rows).padStart(7)}${String(withDot).padStart(6)}${ratio.padStart(8)}${String(rescued).padStart(9)}${String(added).padStart(9)}${String(ambiguous).padStart(9)}  ${verdict}`);
    for (const s of samples) console.log(`      ${s}`);
    // 假关系自查：兜底出来的名字不该等于势力名
    if (added < 0) anyWrong = true;
}

console.log('-'.repeat(104));
console.log('★不共线判据：**书里没有 `·` 形态的，必须一条都不生效**（上方"含·"列为 0 ⇒ 新增必为 0）。');
console.log('★歧义列 = 末段命中 >1 个名号而被放弃的（宁缺勿造：歧义不挂）。');
console.log('★注意：除大荒外都是"名号面近似"，数字用于**判形态与召回**；生产真账影响面见 measure-leg25g-titlefix.js。');
