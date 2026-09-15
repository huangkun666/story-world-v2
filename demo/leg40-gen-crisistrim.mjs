// story-world-v2/demo/leg40-gen-crisistrim.mjs
// leg40 对跑用的变体（**全部落在系统 TEMP，仓库一个字节不动**——与 leg36/37/38/39 同一套做法）：
//   · pack.base.js  = src/pack.js 原样
//   · pack.trim.js  = **只包一层** `buildEvolutionPack`：把"那一场（起点未决事件池最大连通分量）"
//                     在 `pendingEvents` 这一栏里按"出生轮最老优先"留 N 条，其余整条不进包，
//                     并在包上留 `crisisPoolTrim` 痕迹（不静默丢料）。
//   · loader.mjs    = 把 `src/pack.js` 重定向到副本 + 用 `globalThis.__SW2_CRISIS_KEEP__` 传参。
//
// ★为什么走 TEMP 副本而不是改仓库：`runTick` **没有 pack 注入点**（`src/tick.js:61` 直调
//   `buildEvolutionPack(world, move.verb ? move : null, { picks })`），而 leg39 §8.2 立的规矩是
//   **变体一律走模块副本 + loader 重定向、承重墙零改动**。本文件照那条路走：`pack.js` 的
//   `buildEvolutionPack` 是**唯一出口**（`tick.js` 只从它取包）⇒ 在模块层包一层，等价于换掉那一行，
//   而 `src/` 逐字节未动。
//
// ★包一层会不会漏掉别的调用方：真引擎这条路上 `tick.js` 是唯一调用 `buildEvolutionPack` 的地方
//   （`web/index.js` 的预览路也调它，但那条路不在本装置里跑）⇒ 削的正是"递给模型的包"。
//
// 用法：node demo/leg40-gen-crisistrim.mjs   → 打印 SW2_TMP=<临时目录>
//   ★Windows 上跑变体时，`--import` 的路径必须是 **file:/// 三斜杠 URL**（不是 `C:\…`、也不是 `C:/…`）：
//     反斜杠/正斜杠的盘符路径会被 Node 当 URL 解析 ⇒ `ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'c:'`
//     （leg39 的生成器用的是 `F:/…`，在这台机子的 TEMP 盘符路径上**不成立**——本棒实测踩到，留档）。
//   ⇒ 推荐直接跑 `node demo/run-leg40-variant.mjs <SW2_TMP> <臂> …`（它自己转 URL + UTF-8 落盘）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = join(tmpdir(), `sw2-leg40-${Date.now()}`);
mkdirSync(OUT, { recursive: true });

const src = readFileSync(new URL('../src/pack.js', import.meta.url), 'utf8');

// 接线点：`buildEvolutionPack` 的函数体开头（用它自己那一行做锚，形状变了就拒绝生成）
const ANCHOR = `export function buildEvolutionPack(ssot, moveFact, { picks = null } = {}) {`;
if (!src.includes(ANCHOR)) { console.error('✗ 接线点没找到（pack.js 形状变了）——拒绝生成'); process.exit(2); }

// 包装：**只在** `globalThis.__SW2_CRISIS_KEEP__` 是数字时动手（未设旗 ⇒ 与原文逐字节同行为）
// ★写成"单引号字符串数组"而不是模板字符串：包装体里要**原样**出现 `${...}`/反引号这类字符，
//   模板字符串会把它们当场求值（本生成器第一版就踩了——占位符被求值 ⇒ 自证判据判红、拒绝生成）。
const WRAPPER = [
    '// ★leg40 变体（TEMP 副本）：只削"那一场"在未决事件池那一栏里的条数（最老优先保留）',
    'function __sw2BornTick__(id) { return Number(String(id).split(\'_\')[1]) || 0; }',
    'function __sw2CrisisRoot__(events) {',
    '    const open = (events || []).filter((e) => !e.closed);',
    '    const ids = new Set(open.map((e) => e.id));',
    '    const adj = new Map(open.map((e) => [e.id, new Set()]));',
    '    const link = (a, b) => { if (adj.has(a) && adj.has(b) && a !== b) { adj.get(a).add(b); adj.get(b).add(a); } };',
    '    for (const e of open) { const r = e.source && e.source.ref; if (r && ids.has(r)) link(e.id, r); }',
    '    for (let i = 0; i < open.length; i += 1) for (let j = i + 1; j < open.length; j += 1) {',
    '        const a = open[i].ripples || []; const b = open[j].ripples || [];',
    '        if (a.length && b.length && a.some((x) => b.includes(x))) link(open[i].id, open[j].id);',
    '    }',
    '    const seen = new Set(); const comps = [];',
    '    for (const e of open) {',
    '        if (seen.has(e.id)) continue;',
    '        const st = [e.id]; const c = []; seen.add(e.id);',
    '        while (st.length) { const x = st.pop(); c.push(x); for (const y of adj.get(x)) if (!seen.has(y)) { seen.add(y); st.push(y); } }',
    '        comps.push(c);',
    '    }',
    '    comps.sort((a, b) => b.length - a.length);',
    '    return new Set(comps[0] || []);',
    '}',
    'export function buildEvolutionPack(ssot, moveFact, opts) {',
    '    const real = __SW2_REAL__(ssot, moveFact, opts);',
    '    const keep = globalThis.__SW2_CRISIS_KEEP__;',
    '    if (typeof keep !== \'number\') return real;',
    '    const root = __sw2CrisisRoot__(ssot && ssot.events);',
    '    const inPack = real.pack.pendingEvents || [];',
    '    const crisis = inPack.filter((e) => root.has(e.id)).sort((a, b) => __sw2BornTick__(a.id) - __sw2BornTick__(b.id));',
    '    const drop = new Set(crisis.slice(keep).map((e) => e.id));',
    '    if (!drop.size) return real;',
    '    const kept = inPack.filter((e) => !drop.has(e.id));',
    '    const pack = { ...real.pack, pendingEvents: kept, crisisPoolTrim: { keptCrisis: Math.min(keep, crisis.length), droppedCrisis: drop.size, note: \'leg40 出数用：只削这一栏，账本未改\' } };',
    '    const text = packTextOf(pack);   // 与原文**同一个序列化口径**（packTextOf 就在本模块里）',
    '    return { pack, text, estTokens: Math.ceil(text.length / 3) };',
    '}',
    '',
].join('\n');

// 把原文里那一行锚替换成"原文 + 包装"（导出名冲突：包装重名会炸 ⇒ 先把原函数改名再包）
const renamed = src.replace(ANCHOR, `function __sw2RealBuildEvolutionPack__(ssot, moveFact, { picks = null } = {}) {`);
const wrapper = WRAPPER.replace('__SW2_REAL__', '__sw2RealBuildEvolutionPack__');
const trim = `${renamed}\n${wrapper}`;
// 自证三件（形状变了就拒绝生成，别把一个坏副本跑出去）：
//   ① 原函数**已改名**（再也搜不到 `export function buildEvolutionPack(` 那一行原样）
//   ② 包装里调的正是**改名后的真函数**
//   ③ 包装**导出了**新名字（`export function buildEvolutionPack(ssot, moveFact, opts)`）
const okRename = !renamed.includes(ANCHOR) && renamed.includes('function __sw2RealBuildEvolutionPack__(');
const okCall = wrapper.includes('__sw2RealBuildEvolutionPack__(ssot, moveFact, opts)');
const okExport = trim.includes('export function buildEvolutionPack(ssot, moveFact, opts)');
if (!okRename || !okCall || !okExport) {
    console.error(`✗ 改写后形状不对（改名=${okRename} 调用=${okCall} 导出=${okExport}）——拒绝生成`); process.exit(2);
}
writeFileSync(join(OUT, 'pack.base.js'), src, 'utf8');
writeFileSync(join(OUT, 'pack.trim.js'), trim, 'utf8');

// loader：把 `src/pack.js` 重定向到副本（按 SW2_CRISIS_KEEP 是否有值选哪一份），
//   并把"副本发出的相对导入"指回 `src/`（leg39 §8.2 踩过的坑：副本在 TEMP 里解析 ./xxx.js 会找不到）。
const loader = `// leg40 loader（TEMP）——重定向 src/pack.js + 注入 keep 参数
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const KEEP = process.env.SW2_CRISIS_KEEP;
const USE = KEEP === undefined || KEEP === '' ? 'base' : 'trim';
const TARGET = fileURLToPath(new URL(\`./pack.\${USE}.js\`, import.meta.url));
const SELF = fileURLToPath(new URL('./', import.meta.url));
const SRC = 'F:/deepseek/plugins/story-world-v2/src/';
if (USE === 'trim') globalThis.__SW2_CRISIS_KEEP__ = Number(KEEP);
registerHooks({
    resolve(spec, ctx, next) {
        // ★leg39 的坑：副本在 TEMP 里发出的相对导入会解析成 TEMP 下的文件（找不到）⇒ 指回 src/。
        //   ★本版又踩一个**新**坑：用字符串拼 file:// 前缀在 Windows 上会造出 file://F:/… ——
        //   而 Node 只认三斜杠的 file:///F:/… ⇒ ERR_UNSUPPORTED_ESM_URL_SCHEME: 'f:'。
        //   正确做法 = pathToFileURL()（它自己会处理盘符与斜杠）。
        let s = spec;
        const from = ctx && ctx.parentURL ? ctx.parentURL : '';
        if (s.startsWith('./') && from.startsWith('file:') && fileURLToPath(from).startsWith(SELF)) s = new URL(spec, pathToFileURL(SRC)).href;
        const r = next(s, ctx);
        // ★spread 保留 next() 给的 shortCircuit/format 等字段（leg39 就是这么写的）
        if (r && typeof r.url === 'string' && r.url.endsWith('/src/pack.js')) return { ...r, url: pathToFileURL(TARGET).href, shortCircuit: true };
        return r;
    },
    load(url, ctx, next) {
        if (url.startsWith('file:') && fileURLToPath(url).startsWith(SELF) && url.endsWith('.js')) {
            const body = readFileSync(fileURLToPath(url), 'utf8');
            return { format: 'module', source: body, shortCircuit: true };
        }
        return next(url, ctx);
    },
});
`;
writeFileSync(join(OUT, 'loader.mjs'), loader, 'utf8');

console.log(`SW2_TMP=${OUT}`);
console.log(`原 ${src.length} 字符 → trim 副本 ${trim.length}（+${trim.length - src.length}）`);
console.log(`  原文件名改了：${trim.includes('function __sw2RealBuildEvolutionPack__')} · 新导出在场：${trim.includes('export function buildEvolutionPack(ssot, moveFact, opts)')}`);
