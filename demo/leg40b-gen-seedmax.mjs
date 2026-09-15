// story-world-v2/demo/leg40b-gen-seedmax.mjs
// leg40b · "最大化开闸"变体族（**全部落在系统 TEMP，仓库一个字节不动**）。
//
// 起因（用户令「我想直接试试最大化开闸」）：初始化做种实测只出 6 条，而书里够格的有一二十条量级
//   （机械扫描：实体行含"进度形态"的 49 条，且分布在全 9 块——块1:10 · 块8:10 · 块9:3…）。
//   三道自设的天花板叠在一起：
//     ① `SEED_ROOTS_TOP = 6`（全局收几条）　② `maxPerChunk`（每块配额，块数一多退化成 2）　
//     ③ 提示词「宁可少给（4 条扎实的，胜过 8 条含糊的）」——**主动劝它少给**
//   而"百花齐放"还有第三道闸：`THREADS_TOP = 3`（每轮只递 3 条）· `AGENDA_CAPS.perTick = 3`（每轮只许新生 3 件）。
//
// 三个臂（同一本书、同起点世界、承重墙零改动）：
//   · `base` —— 现状：三道闸全按生产值。
//   · `gate` —— **只开数值闸**：种子上限不设实际约束（①②）+ 每块不限 + 跨块去重关掉。
//               提示词**一字不改**（与 base 逐字相同）⇒ 这一臂量的是"**闸**"的贡献。
//   · `max`  —— **闸 + 话术**：在 `gate` 之上再撤掉提示词那句"宁可少给"，
//               并把 `THREADS_TOP` / `AGENDA_CAPS.perTick` 抬到不咬 ⇒ 这一臂量的是"**闸 + 话术 + 调度**"的全开。
//   ★为什么拆成 gate / max 两臂：否则"多出来的根"到底来自**闸**还是来自**那句话**，读不出来（一把尺子一条结论）。
//
// 实现（与 leg36–leg40 同一套：TEMP 副本 + registerHooks 重定向；相对导入用 pathToFileURL 指回 src/）：
//   · seed-roots.js 副本 —— 三处闸受 `globalThis.__SW2_SEED_UNCAP__` 控制（不开则与原文**逐字同行为**）
//   · prompts.js   副本 —— `max` 臂撤掉"宁可少给"那句
//   · settle.js    副本 —— `max` 臂把 `AGENDA_CAPS` 抬到不咬
//   ★补一个上一棒缺的读数：`chunkLog`（逐块 字符/返回/留下/去重丢）由运行器落盘——
//     生产里它算出来了却被覆盖（`meta.seedRoots` 只存 chunks/dropped/ids），所以"闸咬没咬到"从来没有据。
//
// 用法：
//   node demo/leg40b-gen-seedmax.mjs                    → 打印 SW2_TMP=<目录>
//   SW2_SEEDMAX_ARM=base node demo/run-leg40b-seedmax.mjs <SW2_TMP> --ticks 1 --out F:/deepseek/tmp/leg40b-base.json
//   SW2_SEEDMAX_ARM=gate node demo/run-leg40b-seedmax.mjs <SW2_TMP> --ticks 1 --out F:/deepseek/tmp/leg40b-gate.json
//   SW2_SEEDMAX_ARM=max  node demo/run-leg40b-seedmax.mjs <SW2_TMP> --ticks 1 --out F:/deepseek/tmp/leg40b-max.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = join(tmpdir(), `sw2-leg40b-seedmax-${Date.now()}`);
mkdirSync(OUT, { recursive: true });

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const seedSrc = read('../src/seed-roots.js');
const promptSrc = read('../src/prompts.js');
const settleSrc = read('../src/settle.js');

const need = (ok, what) => { if (!ok) { console.error(`✗ ${what}——拒绝生成（接线点变了，先读真源）`); process.exit(2); } };

// ---------- ① seed-roots.js 副本：三处闸受全局开关控制 ----------
let seedCopy = seedSrc
  // (a) 每块配额：`max`/`gate` 两臂都写 null ⇒ 不限
  .replace(
      "    const chunks = chunkBookText(src, chunkChars);\n    const r = await seedRootsChunked({\n        ssot: hotWorld, chunks, extract, candidates: pool, fingerprint: fp, at: new Date().toISOString(),\n        maxPerChunk: Math.max(1, Math.ceil(SEED_ROOTS_MAX / Math.max(1, Math.min(chunks.length, 4)))),\n        onProgress,\n    });",
      "    const chunks = chunkBookText(src, chunkChars);\n    const r = await seedRootsChunked({\n        ssot: hotWorld, chunks, extract, candidates: pool, fingerprint: fp, at: new Date().toISOString(),\n        // ★leg40b 变体：开闸时**不限每块**（原式 = MAX/min(块数,4)，块一多就退化成 2 条/块）\n        maxPerChunk: globalThis.__SW2_SEED_UNCAP__ ? null : Math.max(1, Math.ceil(SEED_ROOTS_MAX / Math.max(1, Math.min(chunks.length, 4)))),\n        dedupeAcrossChunks: globalThis.__SW2_SEED_UNCAP__ ? false : true,\n        onProgress,\n    });",
  )
  // (b) 净化时的条数闸：0 = 不限
  .replace(
      "        if (roots.length >= Math.min(max, SEED_ROOTS_MAX)) break;",
      "        if (globalThis.__SW2_SEED_UNCAP__ ? false : (roots.length >= Math.min(max, SEED_ROOTS_MAX))) break;   // ★leg40b 变体：开闸时不设条数闸",
  )
  // (c) 落账时的条数闸：0 = 不限
  .replace(
      "    const applied = applySeedRoots(ssot, collected.slice(0, SEED_ROOTS_MAX), { fingerprint, at, tick: ssot.meta?.tick });",
      "    const applied = applySeedRoots(ssot, globalThis.__SW2_SEED_UNCAP__ ? collected : collected.slice(0, SEED_ROOTS_MAX), { fingerprint, at, tick: ssot.meta?.tick });   // ★leg40b 变体：开闸时全收",
  )
  // (d) `sanitizeSeedRoots` 加"不限"通道（`maxPerChunk: null` 不走缺省值 ⇒ 这里显式认）
  .replace(
      "export function sanitizeSeedRoots(raw, { max = SEED_ROOTS_MAX } = {}) {\n",
      "export function sanitizeSeedRoots(raw, { max = SEED_ROOTS_MAX } = {}) {\n    if (globalThis.__SW2_SEED_UNCAP__ && (max == null || Number.isFinite(max))) max = Number.POSITIVE_INFINITY;   // ★leg40b 变体：null/数字都当不限\n",
  )
  // (e) 跨块去重：从"函数体里无条件做"改成**形参开关**（原来被去重的**不留痕** ⇒ 看不见丢了多少）
  .replace(
      "    maxPerChunk = Math.ceil(SEED_ROOTS_MAX / 2), onProgress = null, mergeExisting = true,\n} = {}) {",
      "    maxPerChunk = Math.ceil(SEED_ROOTS_MAX / 2), onProgress = null, mergeExisting = true, dedupeAcrossChunks = true,\n} = {}) {",
  )
  .replace(
      "            roots = clean.roots.filter((r) => !seenTitles.has(r.title));",
      "            roots = dedupeAcrossChunks ? clean.roots.filter((r) => !seenTitles.has(r.title)) : clean.roots;   // ★leg40b 变体：关掉跨块去重时**如实全收**（要看重复率）\n            if (!dedupeAcrossChunks) for (const r of clean.roots) seenTitles.add(r.title);",
  );

// (f) ★`max` 臂撤掉"宁可少给"那句劝退——★它在**起根提示词**里（`buildSeedRootsPrompt`），
//   不在 prompts.js（我第一版接错了文件，被下面的 need() 当场拦下——这就是"先证红"的用处）。
const FEWER = "'宁可少给（4 条扎实的，胜过 8 条含糊的）。',";
need(seedSrc.includes(FEWER), 'seed-roots.js 的"宁可少给"那句没找到');
seedCopy = seedCopy.replace(
  FEWER,
  "'★**尽量多给**：只要书里写着、且满足上面四条判据的，**一条都不要漏**——这一趟就是要把书里「正在发生的事」尽量多地搬上账本（条数上限由引擎管，你只管如实挑、不要自己收着）。',",
);
need(seedCopy.includes('__SW2_SEED_UNCAP__') && seedCopy.includes('dedupeAcrossChunks ?') && seedCopy.includes('尽量多给'), 'seed-roots 副本形状不对');

// ---------- ② settle.js 副本：`max` 臂把 AGENDA_CAPS 抬到不咬 ----------
const capAnchor = /export const AGENDA_CAPS = \{([^}]*)\};/;
const m = capAnchor.exec(settleSrc);
need(m, 'settle.js 的 AGENDA_CAPS 接线点没找到');
const settleCopy = settleSrc.replace(
  capAnchor,
  `const __AGENDA_CAPS_BASE = {${m[1]}};
export const AGENDA_CAPS = globalThis.__SW2_AGENDA_UNCAPPED__
    ? { ...__AGENDA_CAPS_BASE, topLevel: 999, open: 999, perTick: 99 }   // ★leg40b 变体：调度闸全开
    : __AGENDA_CAPS_BASE;`,
);
need(settleCopy.includes('__SW2_AGENDA_UNCAPPED__'), 'settle 副本形状不对');

// ---------- ④ pack.js 副本：`wide` 族把**递送端**也打开 ----------
// ★病灶（上一轮实测）：种子闸开到头（65 条），可 `THREADS_TOP = 3` 每轮只递 3 条 ⇒
//   线头只涨不消（12→13 / 71→72 / 64→65，三臂都是 +1/轮）。所以"放开限制"必须连递送端一起放。
const packSrc = read('../src/pack.js');
need(packSrc.includes('        .slice(0, THREADS_TOP)\n        .map(({ _src, _fresh, ...keep }) => keep);'), 'pack.js 的线捆 slice 接线点没找到');
need(packSrc.includes('        .slice(0, CLOSED_ROOTS_TOP)'), 'pack.js 的拾遗 slice 接线点没找到');
const packCopy = packSrc
  // 线捆：开闸时"有几条线头就递几条"
  .replace(
      '        .slice(0, THREADS_TOP)\n        .map(({ _src, _fresh, ...keep }) => keep);',
      '        .slice(0, globalThis.__SW2_THREADS_ALL__ ? heads.length : THREADS_TOP)   // ★leg40b 变体：wide 族把线捆全递\n        .map(({ _src, _fresh, ...keep }) => keep);',
  )
  // 拾遗：同开
  .replace(
      '        .slice(0, CLOSED_ROOTS_TOP)',
      '        .slice(0, globalThis.__SW2_THREADS_ALL__ ? all.length : CLOSED_ROOTS_TOP)   // ★leg40b 变体：wide 族全递',
  );
need(packCopy.includes('__SW2_THREADS_ALL__'), 'pack 副本形状不对');

// ---------- ⑤ settle.js 副本（续）：`wide` 族把事件闸也打开 ----------
//   `EVENT_CAPS = { perTick: 6 }` 是**字面量且非全局**，不补这一刀，一次写 20 件事件会被砍到 6。
need(settleCopy.includes('export const EVENT_CAPS = { perTick: 6 };'), 'settle.js 的 EVENT_CAPS 接线点没找到');
const settleCopy2 = settleCopy.replace(
  'export const EVENT_CAPS = { perTick: 6 };',
  'export const EVENT_CAPS = globalThis.__SW2_EVENTS_UNCAPPED__ ? { perTick: 999 } : { perTick: 6 };   // ★leg40b 变体：wide 族把事件洪峰闸打开',
);

writeFileSync(join(OUT, 'seed-roots.base.js'), seedSrc, 'utf8');
writeFileSync(join(OUT, 'seed-roots.uncap.js'), seedCopy, 'utf8');
writeFileSync(join(OUT, 'prompts.base.js'), promptSrc, 'utf8');
writeFileSync(join(OUT, 'settle.base.js'), settleSrc, 'utf8');
writeFileSync(join(OUT, 'settle.uncap.js'), settleCopy2, 'utf8');
writeFileSync(join(OUT, 'pack.base.js'), packSrc, 'utf8');
writeFileSync(join(OUT, 'pack.wide.js'), packCopy, 'utf8');

// ---------- ⑤ loader：按臂重定向三个模块 ----------
const SRC_DIR = new URL('../src/', import.meta.url).href;
const loader = `// leg40b 最大化开闸 loader（TEMP）——重定向 src/seed-roots.js · src/prompts.js · src/settle.js
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ARM = process.env.SW2_SEEDMAX_ARM || 'base';          // base | gate | max | wide | wideN
const UNC = ARM !== 'base';                                 // 开数值闸（种子不设上限）
const MORE = ARM === 'max' || ARM === 'wide';               // 再加 话术 + 调度闸
const WIDE = ARM === 'wide' || ARM === 'wideN';             // 再把 递送端（线捆/拾遗）+ 事件闸 打开
const SELF = fileURLToPath(new URL('./', import.meta.url));
const SRC = ${JSON.stringify(SRC_DIR)};
const T = (f) => fileURLToPath(new URL(f, import.meta.url));
const MAP = [
    ['/src/seed-roots.js', T(UNC ? './seed-roots.uncap.js' : './seed-roots.base.js')],
    ['/src/prompts.js',    T('./prompts.base.js')],
    ['/src/settle.js',     T(MORE ? './settle.uncap.js' : './settle.base.js')],
    ['/src/pack.js',       T(WIDE ? './pack.wide.js' : './pack.base.js')],
];
globalThis.__SW2_SEEDMAX_ARM__ = ARM;
globalThis.__SW2_SEED_UNCAP__ = UNC;
globalThis.__SW2_AGENDA_UNCAPPED__ = MORE;
globalThis.__SW2_THREADS_ALL__ = WIDE;
globalThis.__SW2_EVENTS_UNCAPPED__ = WIDE;
registerHooks({
    resolve(spec, ctx, next) {
        let s = spec;
        const from = ctx && ctx.parentURL ? ctx.parentURL : '';
        // TEMP 副本里的相对导入一律指回 src/（防"副本导入副本"递归）。
        // ★SRC 已经是 file:/// 开头的**完整 URL**，所以直接拿它当 base ——
        //   第一版写成 new URL(spec, pathToFileURL(SRC)) ⇒ 产出 file:/F:/…（双斜杠那种坑的镜像），
        //   报 ERR_MODULE_NOT_FOUND: file:///F:/…/file:/F:/…/src/position.js。干跑当场抓出。
        //   ⚠这段注释里**不许出现反引号**——它整段活在外层模板字符串里（本仓老坑）。
        if (s.startsWith('./') && from.startsWith('file:') && fileURLToPath(from).startsWith(SELF)) s = new URL(spec, SRC).href;
        const r = next(s, ctx);
        if (!r || typeof r.url !== 'string') return r;
        for (const [suffix, target] of MAP) if (r.url.endsWith(suffix)) return { ...r, url: pathToFileURL(target).href, shortCircuit: true };
        return r;
    },
});
`;
writeFileSync(join(OUT, 'loader.mjs'), loader, 'utf8');

console.log(`SW2_TMP=${OUT}`);
console.log(`seed-roots 副本 ${seedSrc.length} → ${seedCopy.length}（+${seedCopy.length - seedSrc.length}）· settle 副本 ${settleSrc.length} → ${settleCopy.length}`);
console.log(`  自证：闸开关=${seedCopy.includes('__SW2_SEED_UNCAP__')} · 跨块去重开关=${seedCopy.includes('dedupeAcrossChunks ?')} · 劝退句已撤=${seedCopy.includes('尽量多给')} · 调度闸=${settleCopy2.includes('__SW2_AGENDA_UNCAPPED__')} · 事件闸=${settleCopy2.includes('__SW2_EVENTS_UNCAPPED__')} · 递送端=${packCopy.includes('__SW2_THREADS_ALL__')}`);
