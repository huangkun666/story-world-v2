// story-world-v2/demo/leg38-gen-parentarm.mjs
// leg38 对跑用的变体生成器（**全部落在系统 TEMP，仓库一个字节不动**）：
//   · prompts.base.js   = src/prompts.js 原样
//   · prompts.parent.js = **只动两处引导**（第 9 条 + 第 12 条：教模型"有归属的线走 parent、顶层名额稀缺"）
//   · loader.mjs        = 把 `src/prompts.js` 的导入重定向到副本（按 SW2_PROMPTS 选）
//
// ★要改的病灶（leg38 实读真源 + 真账读数得出）：
//   第 7 条只把 `parent` **列为三型之一**，没有任何一处教它**什么时候该用**；
//   而第 9 条（要"并行"）与第 12 条（用 idleFaces 写各自的小事）**都只教 `state` 源**。
//   真账实测：累计 41 条线，**顶层 41 / 有父 0**；在飞 13 条里顶层 **13/15** ⇒ 只剩 2 个名额就**永久停生**。
//   （`settle.js:317`：`source.type !== 'parent' && topNow >= topLevel` ⇒ 拒——**有父的线不占这个名额**。）
//
// ★只改这两处，别的一个字节不动；生成后自证差异行数与差异内容。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = join(tmpdir(), `sw2-leg38-${Date.now()}`);
mkdirSync(OUT, { recursive: true });

let p = readFileSync(new URL('../src/prompts.js', import.meta.url), 'utf8');

// ── 改动①：第 9 条（"要并行"那段的收尾）——补一段"有归属的线怎么起"
const A1 = '     （不是让你把主线丢掉——主线照推；是**主线之外再长出一条**。）';
const B1 = `     （不是让你把主线丢掉——主线照推；是**主线之外再长出一条**。）
     · ★★**起新线有两条路，别都走"自己起头"那条**：
       **① source.type="state"（不带 ref）= 自己起头**。这是上面说的那种，很好，但它**占"顶层"名额**——
         顶层名额**是稀缺的、会满**（满了以后世界就不再长新线了）。
       **② source.type="parent" + ref=某条在飞盘算的 id = 挂在它底下**。这才是"一条线底下有自己的支线"的写法，
         **不占顶层名额**。凡是"**这件事是某人在办的那件事的一部分/延伸/后手**"——派出去的人、分头行动的一路、
         上游那件事引出的下游——就用这一型。谁办谁的（entity）照写，ref 指那条在飞盘算。
       **口径**：一轮里如果要开新线，**先想"它是不是挂在某件正在办的事底下"**；是，就走 parent。
       只有**真的不属于任何在办之事**的，才用 state 自己起头。`;

// ── 改动②：第 12 条（用 idleFaces 写小事那句）——别默认 state
//    ★锚点用单引号拼（生成器自身是模板字符串；"state" 在里面必须带引号，不能靠模板转义）
const A2 = '   · **写他们各自的小事**，不必与主线有关（他们本来就在过自己的日子）：起一条 newAgendas（source.type="state" 即可）。';
const B2 = [
    '   · **写他们各自的小事**，不必与主线有关（他们本来就在过自己的日子）：起一条 newAgendas。',
    '     ★**源别一律写 state**：如果这件小事**是某人正在办的那件事的一环**（他奉谁的命令、接着谁的动作往下做），',
    '     就用 source.type="parent" + ref=那条在飞盘算的 id（**不占顶层名额**）；只有**与所有在办之事都无关**才用 state。',
].join('\n');

let out = p;
for (const [a, b, tag] of [[A1, B1, '第9条'], [A2, B2, '第12条']]) {
    if (!out.includes(a)) { console.error(`✗ 接线点没找到：${tag}——拒绝生成`); process.exit(2); }
    out = out.replace(a, b);
}
writeFileSync(join(OUT, 'prompts.base.js'), p, 'utf8');
writeFileSync(join(OUT, 'prompts.parent.js'), out, 'utf8');

const loader = `// leg38 loader（TEMP）——把 src/prompts.js 重定向到副本
// ★同 leg37 的坑：副本在 TEMP，它的相对导入要指回 src/
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ARM = process.env.SW2_PROMPTS === 'parent' ? 'parent' : 'base';
const TARGET = fileURLToPath(new URL(\`./prompts.\${ARM}.js\`, import.meta.url));
const SELF = fileURLToPath(new URL('./', import.meta.url));
const SRC = 'F:/deepseek/plugins/story-world-v2/src/';
registerHooks({
    resolve(spec, ctx, next) {
        let s = spec;
        const from = ctx && ctx.parentURL ? ctx.parentURL : '';
        if (s.startsWith('./') && from.startsWith('file:') && fileURLToPath(from).startsWith(SELF)) s = new URL(spec, \`file://\${SRC}\`).href;
        const r = next(s, ctx);
        if (r && typeof r.url === 'string' && r.url.endsWith('/src/prompts.js')) return { ...r, url: new URL(\`file://\${TARGET}\`).href, shortCircuit: true };
        return r;
    },
    load(url, ctx, next) {
        if (url.startsWith('file:') && fileURLToPath(url).startsWith(SELF) && url.endsWith('.js')) {
            return { format: 'module', source: readFileSync(fileURLToPath(url), 'utf8'), shortCircuit: true };
        }
        return next(url, ctx);
    },
});
`;
writeFileSync(join(OUT, 'loader.mjs'), loader, 'utf8');

// ── 自证：差异只能出现在这两处
const a = p.split('\n'); const b = out.split('\n');
console.log(`SW2_TMP=${OUT}`);
console.log(`原 ${a.length} 行 → 变体 ${b.length} 行（+${b.length - a.length}）`);
const marks = ['source.type="parent"', '不占顶层名额', '先想"它是不是挂在某件正在办的事底下"'];
for (const m of marks) console.log(`  变体含「${m}」= ${out.includes(m)}（原文含 = ${p.includes(m)}）`);
