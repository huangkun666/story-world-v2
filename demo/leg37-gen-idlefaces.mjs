// story-world-v2/demo/leg37-gen-idlefaces.mjs
// leg37 对跑用的变体生成器（**全部落在系统 TEMP，仓库一个字节不动**）：
//   · pack.top12.js = src/pack.js 原样（基线，IDLE_FACES_TOP = 12）
//   · pack.top40.js = 只改 `IDLE_FACES_TOP` 一个数字（12 → 40），其余逐字节相同
//   · loader.mjs    = 把 `src/pack.js` 的导入重定向到上面两档之一（按 SW2_IDLE_TOP 选）
// 用法：node demo/leg37-gen-idlefaces.mjs   →  stdout 打印 SW2_TMP=<dir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = join(tmpdir(), `sw2-leg37-${Date.now()}`);
mkdirSync(OUT, { recursive: true });

// ★leg134 勘正：`IDLE_FACES_TOP` 的家从 `src/pack.js` 搬到了 `src/limits.js`
//   （leg114 起"同一个数两个家"逐个合并——`包预算`/`往事轮数` 先行，这一格是最后一批）
//   ⇒ 锚点与重定向目标一并改指 `limits.js`。
let limits = readFileSync(new URL('../src/limits.js', import.meta.url), 'utf8');
const ANCHOR = 'export const IDLE_FACES_TOP = 12;';
if (!limits.includes(ANCHOR)) {
    console.error('✗ 接线点没找到（limits.js 的形状变了）——拒绝生成');
    process.exit(2);
}
const TOP40 = limits.replace(ANCHOR, 'export const IDLE_FACES_TOP = 40;');
writeFileSync(join(OUT, 'limits.top12.js'), limits, 'utf8');
writeFileSync(join(OUT, 'limits.top40.js'), TOP40, 'utf8');

const loader = `// leg37 loader（TEMP）——把 src/limits.js 重定向到本目录的副本
//   ★leg134：IDLE_FACES_TOP 的家从 src/pack.js 搬到了 src/limits.js ⇒ 重定向目标同批改指 limits.js。
// ★坑（本棒实测踩到）：副本落在 TEMP，它自己的相对导入（./gate.js 等）会被解析成 TEMP 下的文件 ⇒ 找不到。
//   解法：凡"从本目录里的文件发出的相对导入"一律指回 src/ 原目录（副本只做了改常量这一件事，其余必须同源）。
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const TOP = process.env.SW2_IDLE_TOP === '40' ? 'top40' : 'top12';
const LIMITS = fileURLToPath(new URL(\`./limits.\${TOP}.js\`, import.meta.url));
const SELF = fileURLToPath(new URL('./', import.meta.url));
const SRC = 'F:/deepseek/plugins/story-world-v2/src/';
registerHooks({
    resolve(spec, ctx, next) {
        let s = spec;
        const from = ctx && ctx.parentURL ? ctx.parentURL : '';
        // 副本发出的相对导入 ⇒ 指回 src/
        if (s.startsWith('./') && from.startsWith('file:') && fileURLToPath(from).startsWith(SELF)) {
            s = new URL(spec, \`file://\${SRC}\`).href;
        }
        const r = next(s, ctx);
        if (r && typeof r.url === 'string' && r.url.endsWith('/src/limits.js')) return { ...r, url: new URL(\`file://\${LIMITS}\`).href, shortCircuit: true };
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
console.log(`SW2_TMP=${OUT}`);
