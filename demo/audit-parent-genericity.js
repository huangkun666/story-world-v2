// story-world-v2/demo/audit-parent-genericity.js
// 只读泛用性审计：**"势力↔角色"这条关系，在不同形态的世界书里各自靠什么依据可取？**
// 为什么必须先做这个：候选方案（成员行 / key 列表 / 层级标题 / 显式字段 / 模型抽）各有形态假设，
//   只有拿多本不同形态的书量过，才知道哪个是"结构性依据"、哪个是"大荒专有写法"。
//
// 度量的五种依据（同一批实体名，看它在书里以什么形式归属某组织）：
//   A 结构：名号作为**组织条目标题的一部分**（`《昆仑道宫》…` / `<势力_万妖盟>` 等）
//   B 成员行：名号出现在组织条目**正文**里，且紧邻括号/冒号/顿号等"条目点"形态
//   C key 列表：名号 ∈ 组织条目的 `key`/`keys` 数组（书作者手动维护的成员名单）
//   D 层级：名号出现在**标题行**（`#`/`==`/`【】`/`##`）之后某个组织标题的**下辖段落**里
//   E 显式：条目里有 `所属/上级/隶属/势力:` 这类**显式键值**
// 用法：node demo/audit-parent-genericity.js <worlds目录> [名号清单json]
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f));

// 名号来源：账本实体名（第三参）；缺省用"书内所有括号形态词"自证（只作形态统计）
function loadEntries(file) {
    const b = JSON.parse(readFileSync(file, 'utf8'));
    const raw = b.entries;
    const list = Array.isArray(raw) ? raw : Object.values(raw || {});
    return list.filter((e) => e && typeof e === 'object').map((e) => ({
        comment: String(e.comment ?? e.name ?? '').trim(),
        content: String(e.content ?? ''),
        keys: (Array.isArray(e.keys) ? e.keys : Array.isArray(e.key) ? e.key : [e.key]).map((k) => String(k ?? '').trim()).filter(Boolean),
        disabled: e.disable === true || e.enabled === false,
    }));
}

const TITLEISH = /^[#=【<〔（(]|^[#]{1,6}\s/;
const HEADING = /^\s*(?:#{1,6}\s+|={2,}|【[^】]{1,20}】\s*$|<[^>]{1,24}>)/;
const EXPLICIT = /(所属势力|所属|上级|隶属|从属|势力|阵营|归属)\s*[:：]\s*([^\n，。；;]{1,24})/g;
const PAREN_POINT = /(?:^|[\s、，,；;（(【\[])([^\s，。；;、：:（）()【】\[\]]{2,16})\s*[（(：:]/gm;

for (const file of files) {
    let list;
    try { list = loadEntries(file); } catch (e) { console.log(`[SKIP] ${file}: ${e.message}`); continue; }
    if (!list.length) { console.log(`[EMPTY] ${file}`); continue; }
    const chars = list.reduce((s, e) => s + e.content.length, 0);
    const enabled = list.filter((e) => !e.disabled);

    // 组织条目的判据（宽松：标题像组织名，或 key 里含多个名号，或正文有多个括号点）
    let keyRich = 0, parenRich = 0, titleRich = 0, explicitCount = 0, headingCount = 0;
    const exampleKeyRich = [], exampleExplicit = [], exampleHeading = [];
    for (const e of enabled) {
        if (e.keys.length >= 3) { keyRich += 1; if (exampleKeyRich.length < 2) exampleKeyRich.push(`${e.comment}(${e.keys.length})`); }
        const parens = [...e.content.matchAll(PAREN_POINT)].length;
        if (parens >= 2) parenRich += 1;
        if (TITLEISH.test(e.comment)) titleRich += 1;
        EXPLICIT.lastIndex = 0;
        const ex = [...e.content.matchAll(EXPLICIT)];
        explicitCount += ex.length;
        if (ex.length && exampleExplicit.length < 3) exampleExplicit.push(`${e.comment}: ${ex[0][1]}=${ex[0][2]}`);
        HEADING.lastIndex = 0;
        if (HEADING.test(e.content.trim().split('\n')[0] || '')) { headingCount += 1; if (exampleHeading.length < 2) exampleHeading.push(`${e.comment} → ${(e.content.trim().split('\n')[0] || '').slice(0, 30)}`); }
    }
    console.log(`\n=== ${file.split(/[\\/]/).pop()} ===`);
    console.log(`条目 ${list.length}（禁用 ${list.length - enabled.length}）｜正文 ${chars} 字符｜平均 ${Math.round(chars / Math.max(1, list.length))} 字/条`);
    console.log(`  B 成员行形态（正文 ≥2 处「名号( / 名号: 」）= ${parenRich} 条`);
    console.log(`  C key 名单（≥3 个 key）= ${keyRich} 条   样例：${exampleKeyRich.join(' | ') || '—'}`);
    console.log(`  A 标题即组织名（comment 以 #/【/< 开头）= ${titleRich} 条`);
    console.log(`  D 正文首行是标题形态 = ${headingCount} 条   样例：${exampleHeading.join(' | ') || '—'}`);
    console.log(`  E 显式所属键值 = ${explicitCount} 处   样例：${exampleExplicit.join(' | ') || '—'}`);
}
console.log('\n判据：A/B/D 是**形态**（换书不换代码）；E 依赖书的字段写法；C 依赖书作者手工维护成员名单。');
