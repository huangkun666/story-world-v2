// story-world-v2/demo/leg39-gen-alienquote.mjs
// leg39 对跑用的变体（**全部落在系统 TEMP，仓库一个字节不动**）：
//   · recall.base.js   = src/recall.js 原样
//   · recall.alien.js  = **只在 `collectRecallQuery` 里插一段**：把"从没进过账的书里人"的一小撮名字
//                        放进检索 query ⇒ 检索回来的注入面里会带上**他们自己的世界书条目**
//                        （leg34 那条"只给名字不给事"失败的正是这一点：名字没有料，模型接不上）
//   · loader.mjs       = 把 `src/recall.js` 重定向到副本（按 SW2_ALIEN 选）
//
// ★这一臂测的是"新主线"（用户口径原话：「多条线，每个主线都有自己的轴」「新线就是新的主线」）：
//   新主线需要**它自己的地点、它自己的一批人、它自己的事**。而那场大乱**永久占着池子**
//   （state 源事件永不自动闭环 ⇒ 31 条死煞事件 59 轮一直在），模型眼前只有那件事的料。
//   ⇒ 本臂给模型"另一件事的料"：每轮挑 8 个**从没进过账**的实体（确定性轮转），
//     把他们的名字并进检索 query ⇒ 检索会把他们各自的世界书条目一并取回来注入。
//   ★零编造：名字取自账上真有的实体，条目取自世界书原文。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = join(tmpdir(), `sw2-leg39-${Date.now()}`);
mkdirSync(OUT, { recursive: true });

let src = readFileSync(new URL('../src/recall.js', import.meta.url), 'utf8');

// 接线点：picks 循环之后、未决事件之前（插在这里 ⇒ 被 1200 字截断时**保得住**）
const ANCHOR = `    for (const id of picks || []) push(nameOf(id));
    const open = (ssot?.events || []).filter((e) => !e.closed);`;
if (!src.includes(ANCHOR)) { console.error('✗ 接线点没找到（recall.js 形状变了）——拒绝生成'); process.exit(2); }

const INSERT = `    for (const id of picks || []) push(nameOf(id));
    // ★leg39 变体（alien 臂）：把"从没进过账的书里人"的一小撮名字并进 query
    //   ⇒ 检索会把**他们自己的世界书条目**取回来 = 给模型"另一件事的料"
    if (globalThis.__SW2_ALIEN_QUERY__) {
        const namedNow = new Set();
        for (const ev of ssot?.events || []) if (!ev.closed) for (const r of ev.ripples || []) namedNow.add(r);
        const actedNow = new Set((ssot?.entities || []).filter((e) => typeof e.lastActiveTick === 'number').map((e) => e.id));
        const alien = (ssot?.entities || []).filter((e) => (e.status || 'active') === 'active'
            && !namedNow.has(e.id) && !actedNow.has(e.id) && e.id !== ssot?.context?.playerId
            && typeof e.name === 'string' && e.name.length >= 2);
        const tickNow = ssot?.meta?.tick ?? 0;
        const OFF = 8;
        for (let k = 0; k < Math.min(OFF, alien.length); k += 1) push(alien[(tickNow * OFF + k) % alien.length].name);
    }
    const open = (ssot?.events || []).filter((e) => !e.closed);`;
const alien = src.replace(ANCHOR, INSERT);
writeFileSync(join(OUT, 'recall.base.js'), src, 'utf8');
writeFileSync(join(OUT, 'recall.alien.js'), alien, 'utf8');

// loader：重定向 recall.js，并把"是不是 alien 臂"通过 globalThis 告诉副本
//   （副本 import 在主模块之前执行 ⇒ 必须在 loader 的 load 钩子里注入那面旗）
const loader = `// leg39 loader（TEMP）——重定向 src/recall.js + 注入 alien 旗
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ARM = process.env.SW2_ALIEN === '1' ? 'alien' : 'base';
const TARGET = fileURLToPath(new URL(\`./recall.\${ARM}.js\`, import.meta.url));
const SELF = fileURLToPath(new URL('./', import.meta.url));
const SRC = 'F:/deepseek/plugins/story-world-v2/src/';
const FLAG = ARM === 'alien' ? 'globalThis.__SW2_ALIEN_QUERY__ = true;\\n' : '';
registerHooks({
    resolve(spec, ctx, next) {
        let s = spec;
        const from = ctx && ctx.parentURL ? ctx.parentURL : '';
        if (s.startsWith('./') && from.startsWith('file:') && fileURLToPath(from).startsWith(SELF)) s = new URL(spec, \`file://\${SRC}\`).href;
        const r = next(s, ctx);
        if (r && typeof r.url === 'string' && r.url.endsWith('/src/recall.js')) return { ...r, url: new URL(\`file://\${TARGET}\`).href, shortCircuit: true };
        return r;
    },
    load(url, ctx, next) {
        if (url.startsWith('file:') && fileURLToPath(url).startsWith(SELF) && url.endsWith('.js')) {
            const body = readFileSync(fileURLToPath(url), 'utf8');
            const isTarget = fileURLToPath(url) === TARGET;
            return { format: 'module', source: (isTarget ? FLAG : '') + body, shortCircuit: true };
        }
        return next(url, ctx);
    },
});
`;
writeFileSync(join(OUT, 'loader.mjs'), loader, 'utf8');

console.log(`SW2_TMP=${OUT}`);
console.log(`原 ${src.length} 字符 → alien ${alien.length}（+${alien.length - src.length}）`);
console.log(`  alien 含接线: ${alien.includes('__SW2_ALIEN_QUERY__')}（原文含 = ${src.includes('__SW2_ALIEN_QUERY__')}）`);
