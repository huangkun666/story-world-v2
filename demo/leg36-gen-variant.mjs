// story-world-v2/demo/leg36-gen-variant.mjs
// 生成 leg36 对跑要用的两件东西（全部落在**系统 TEMP**，仓库一个字节不动）：
//   ① gate.js 的门控副本（两档：base = 原样；narrow = spotlight 另给「上场权」）
//   ② 一个 loader（`--import` 用）——把 `src/gate.js` 的导入重定向到副本
// 用法：node demo/leg36-gen-variant.mjs
//   输出目录打在 stdout 第一行，形如 SW2_TMP=<路径>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = join(tmpdir(), `sw2-leg36-${Date.now()}`);
mkdirSync(OUT, { recursive: true });

const SRC_GATE = new URL('../src/gate.js', import.meta.url);
let gate = readFileSync(SRC_GATE, 'utf8');

// 变体接线点：`liftedSet` 与 `spotlightSet` 都已就绪的那一行
const ANCHOR = '    const active = (id) => !silentSet.has(id) || liftedSet.has(id);';
if (!gate.includes(ANCHOR)) {
    console.error('✗ 变体接线点没找到（gate.js 的形状变了）——拒绝生成，避免量到假东西');
    process.exit(2);
}
// narrow：名单上的人**与"被点名者"同权**（上场权）。★只改这一行，别处一个字节不动。
const NARROW = gate.replace(
    ANCHOR,
    '    const active = (id) => !silentSet.has(id) || liftedSet.has(id) || spotlightSet.has(id);   // ★leg36 narrow',
);
writeFileSync(join(OUT, 'gate.base.js'), gate, 'utf8');
writeFileSync(join(OUT, 'gate.narrow.js'), NARROW, 'utf8');

// loader：resolve hook 把 gate.js 指到副本；load hook 原样读文件
const loader = `// leg36 loader（TEMP）——把 src/gate.js 重定向到本目录的副本
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const VARIANT = process.env.SW2_VARIANT === 'narrow' ? 'narrow' : 'base';
const GATE = fileURLToPath(new URL(\`./gate.\${VARIANT}.js\`, import.meta.url));
registerHooks({
    resolve(spec, ctx, next) {
        const r = next(spec, ctx);
        if (r && typeof r.url === 'string' && r.url.endsWith('/src/gate.js')) return { ...r, url: new URL(\`file://\${GATE}\`).href, shortCircuit: true };
        return r;
    },
    load(url, ctx, next) {
        if (url.startsWith('file:') && url.includes('sw2-leg36') && url.endsWith('.js')) {
            return { format: 'module', source: readFileSync(fileURLToPath(url), 'utf8'), shortCircuit: true };
        }
        return next(url, ctx);
    },
});
`;
writeFileSync(join(OUT, 'loader.mjs'), loader, 'utf8');

console.log(`SW2_TMP=${OUT}`);
