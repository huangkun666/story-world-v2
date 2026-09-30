// story-world-v2/demo/run-leg40-variant.mjs
// leg40 · 变体臂的运行壳（**只为绕两个 Windows 坑**，不含任何实验逻辑）：
//   ① `--import` 的路径必须是 **file:/// 三斜杠 URL**：反斜杠/正斜杠盘符路径会被 Node 当 URL 解析
//      ⇒ `ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'c:'`（本棒实测；leg39 用的 `F:/…` 形状在 TEMP 上不成立）。
//   ② 子进程的输出**由 Node 自己落 UTF-8**（`writeFileSync`），不让 PowerShell 的 `>` 重定向碰它
//      —— 那条路写 UTF-16LE 带 BOM，`read` 工具会判 binary（leg39 §8.1 的铁律）。
//
// 用法：node demo/run-leg40-variant.mjs <SW2_TMP 目录> [measure 脚本的其余参数…] [--tee <日志路径>]
//   例：node demo/run-leg40-variant.mjs C:/Users/x/AppData/Local/Temp/sw2-leg40-123 --arm trim --keep 6 --ticks 8 --out F:/deepseek/tmp/leg40-trim.json --tee F:/deepseek/tmp/leg40-trim.log
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const tmp = argv.shift();
if (!tmp) { console.error('用法：node demo/run-leg40-variant.mjs <SW2_TMP 目录> [measure 参数…] [--tee <日志>]'); process.exit(2); }
const teeIdx = argv.indexOf('--tee');
const teePath = teeIdx >= 0 ? argv[teeIdx + 1] : '';
if (teeIdx >= 0) argv.splice(teeIdx, 2);

const loader = pathToFileURL(`${tmp.replace(/[\\/]+$/, '')}/loader.mjs`).href;
console.log(`[run-shell] loader = ${loader}`);
console.log(`[run-shell] argv   = ${JSON.stringify(argv)}`);
if (teePath) mkdirSync(dirname(teePath), { recursive: true });

// stdio: 'inherit' —— 沙箱下管道捕获会 EPERM；这里输出直通终端，需要留档就另加 --tee
const PROJECT = fileURLToPath(new URL('..', import.meta.url));   // ← 项目根（Windows 上用 fileURLToPath，别手工切 pathname）
const child = spawn(process.execPath, ['--import', loader, 'demo/measure-leg40-crisis-pool.js', ...argv],
    { stdio: teePath ? ['inherit', 'pipe', 'pipe'] : 'inherit', cwd: PROJECT });

if (teePath) {
    const out = createWriteStream(teePath, { encoding: 'utf8' });   // ★UTF-8（不是 PowerShell 的 UTF-16）
    child.stdout.on('data', (b) => { process.stdout.write(b); out.write(b); });
    child.stderr.on('data', (b) => { process.stderr.write(b); out.write(b); });
    child.on('close', () => { out.end(); console.log(`\n[run-shell] 日志（UTF-8）= ${teePath}`); });
}
child.on('close', (code) => { process.exitCode = code ?? 1; });
