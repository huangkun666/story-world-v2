// story-world-v2 / scripts/publish-release.mjs
//
// ★★leg106：**发布流程第一次收进仓**（此前它只活在 `F:/deepseek/tmp/prototypes/leg1xx-push-release.mjs`，
//   是 132 个一次性脚本里的一员：不进 git、不受保护、每棒重写一遍、改错过三次幂等守卫）。
//
// 流程（leg103 §8 跑通两遍，本脚本照抄那套，一个字没改口径）：
//   「**导出独立根树 → 仓外独立跑判据与冒烟 → 推发布仓 → 远端逐字节核验**」
//   ★**全程不碰工作区**——那个目录同时是用户的**真机安装位**（junction）。手法照 leg100：
//     `read-tree` / `write-tree` / `commit-tree` + 临时 index。
//
// 为什么必须"导出独立根树"：本仓是 **monorepo**（`F:\deepseek\plugins`），
//   而 ST 的更新按钮是在**插件目录里 `git pull` 它自己的 origin** ⇒
//   发布仓的**树根**必须是插件根（`manifest.json` 在最外层），否则 ST 连扩展都认不出。
//
// 前置：
//   · 工作区干净（导出=已提交状态，逐字节可复现）
//   · 本机有 `%USERPROFILE%\.git-credentials`（token 在里面，**不打印、不进日志**）
// 跑法：
//   node scripts/publish-release.mjs              # 真推
//   node scripts/publish-release.mjs --dry-run    # 只导出 + 仓外跑判据，不推（推荐先跑这个）
//
// ★纪律：每一步**先核对现状、条件不成立就停下报因**，不硬来；**幂等守卫比"本笔真正改掉的那一处"**。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MONO = path.resolve(ROOT, '..');
const SUBTREE = path.basename(ROOT);
const REPO = 'huangkun666/story-world-v2';
const DRY = process.argv.includes('--dry-run');

const WORK = path.join(os.tmpdir(), 'sw2-release');
const IDX = path.join(WORK, '.tmp-index');
const OUT = path.join(WORK, 'out');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const log = (s) => console.log(s);
const wash = (s) => String(s).replace(/https:\/\/[^@\s]*@/g, 'https://***@');
const die = (why) => { log(`   ✘ ${why} ⇒ 停下`); process.exit(2); };

const git = (args, opts = {}) => execFileSync('git', args, { cwd: MONO, encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
const gitT = (args, opts = {}) => git(args, opts).trim();
const gitQ = (args, opts = {}) => { try { return { ok: true, out: gitT(args, opts) }; } catch (e) { return { ok: false, out: wash(String(e.stdout || '') + String(e.stderr || '')) }; } };

// ── 凭证（只在本进程环境里用；★永不进日志、不落盘） ──────────────────
const credFile = path.join(os.homedir(), '.git-credentials');
if (!fs.existsSync(credFile)) die(`读不到 ${credFile}（token 存放处）`);
const cred = fs.readFileSync(credFile, 'utf8').trim().split(/\r?\n/).filter(Boolean)[0];
const token = (/^https?:\/\/[^:]+:([^@]*)@/.exec(cred) || [])[1];
if (!token) die('从 .git-credentials 里解析不出 token');
const url = `https://x-access-token:${token}@github.com/${REPO}.git`;
// ★把 credential helper 清空：Git Credential Manager 会**抢答**并要求交互，
//   在非交互环境里表现为 `could not read Username for 'https://github.com'`（leg106 踩到并留档）。
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', GCM_INTERACTIVE: 'never' };
const gitAuth = (args) => gitQ(args, { env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] });

const api = async (p, method = 'GET', body = null) => {
    const r = await fetch('https://api.github.com' + p, {
        method,
        headers: {
            Authorization: `token ${token}`, Accept: 'application/vnd.github+json',
            'User-Agent': 'sw2-release', ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
};

// ── ① 前置核对 ────────────────────────────────────────────────────
log('① 前置核对');
const dirty = gitQ(['status', '--porcelain', '--', `${SUBTREE}/`]).out;
log(`   子树工作区：${dirty ? '✘ 有未提交改动\n' + dirty : '✔ 干净（导出 = 已提交状态，逐字节可复现）'}`);
if (dirty) die('工作区有未提交改动 ⇒ 先提交再发布');

const head = gitT(['rev-parse', 'HEAD']);
const subTree = gitT(['rev-parse', `HEAD:${SUBTREE}`]);
log(`   monorepo HEAD = ${head.slice(0, 7)} · 子树 = ${subTree.slice(0, 7)} · 分支 ${gitT(['rev-parse', '--abbrev-ref', 'HEAD'])}`);

const remote = (await api(`/repos/${REPO}/commits/main`)).body;
const remoteSha = String(remote?.sha || '');
log(`   发布仓 main 现在 = ${remoteSha.slice(0, 7)} · ${String(remote?.commit?.message).split('\n')[0].slice(0, 60)}`);
if (!remoteSha) die('取不到远端状态（网络？token？）');

// ★★幂等守卫：**必须比"本笔真正改掉的那一处"**（leg101/102/103 连栽三次都栽在这里：
//    守卫写死、或比一个本笔不会变的量 ⇒ **恒真跳过推送**，而人以为推成功了）。
//    ⇒ 定稿口径：比 **git 树对象**（tree id）——远端 main 的**根树** vs 本地子树的**树对象**，
//      这就是"这一份 vs 那一份"的逐字节身份。
//    ★第一版写成 `git cat-file -p <tree>` 去比**内容列表**（输出形如 `100644 blob …`）⇒ 与 tree id 永不相等，
//      守卫等于失效（`--dry-run` 当场暴露）。⇒ 改成直接取 **tree id** 比。
const remoteTree = String(remote?.commit?.tree?.sha || '');
log(`   树对象：本地子树 ${subTree.slice(0, 7)} · 远端根树 ${remoteTree.slice(0, 7)}`);
if (!remoteTree) die('取不到远端根树 tree id（API 形状变了？）');
if (remoteTree === subTree) die('远端根树与本地子树**逐字节相同** ⇒ 无需再推（幂等）');

const panelBuild = (read('src/render-base.js').match(/PANEL_BUILD = '([^']+)'/) || [])[1];
if (!panelBuild) die('本地读不到 PANEL_BUILD ⇒ 别推（先核对源码）');

// ── ② 导出独立根树 ────────────────────────────────────────────────
log('\n② 导出独立根树（git 底层 + 临时 index，不碰工作区）');
fs.mkdirSync(WORK, { recursive: true });
fs.rmSync(IDX, { force: true });
const env = { ...process.env, GIT_INDEX_FILE: IDX };
git(['read-tree', subTree], { env });
const rootTree = gitT(['write-tree'], { env });
log(`   根树 = ${rootTree.slice(0, 7)} ${rootTree === subTree ? '（= 子树，符合预期）' : '（⚠ 与子树不同，请核对）'}`);
fs.rmSync(IDX, { force: true });

// ── ③ 仓外独立跑判据与冒烟 ────────────────────────────────────────
log('\n③ 仓外独立跑（导出目录里跑判据 + 冒烟：★"社区装到的那份就是我测过的那份"）');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const co = gitQ(['--work-tree=' + OUT, 'checkout', rootTree, '--', '.'], { env: { ...process.env, GIT_INDEX_FILE: IDX } });
if (!co.ok) die('检出失败：' + co.out);
const outTop = fs.readdirSync(OUT);
log(`   检出 ${outTop.length} 个顶层项：${outTop.slice(0, 10).join(' ')}`);

// 形状闸：ST 认得出、且零依赖
for (const must of ['manifest.json', 'settings.html', 'web/index.js', 'web/style.css', 'src', 'test', 'demo', 'README.md', 'LICENSE']) {
    if (!fs.existsSync(path.join(OUT, must))) die(`导出件缺 ${must}（ST 装不起来 / 跑不了判据）`);
}
if (fs.existsSync(path.join(OUT, 'package.json'))) die('导出件里有 package.json（本插件应零依赖、无构建步骤）');
if (fs.existsSync(path.join(OUT, 'snapshots'))) die('导出件里有 snapshots/（真跑快照不该进发布树）');
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
log(`   manifest：id=${manifest.id} · version=${manifest.version} · js=${manifest.js} · css=${manifest.css} · auto_update=${manifest.auto_update}`);

// 读数自洽闸：README 写的判据数 **必须等于真跑出来的**
const readmeTests = (fs.readFileSync(path.join(OUT, 'README.md'), 'utf8').match(/本版：(\d+)\s*\/\s*(\d+)/) || []);
if (!readmeTests.length) die('导出件 README 里读不到测试读数（`本版：N / N`）');
const readmeSays = Number(readmeTests[1]);

let pass = '', fail = '';
try {
    const t = execFileSync('node', ['--test'], { cwd: OUT, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 900000 });
    pass = (t.match(/^\s*(?:ℹ|#)\s*pass (\d+)/m) || [])[1];
    fail = (t.match(/^\s*(?:ℹ|#)\s*fail (\d+)/m) || [])[1];
} catch (e) {
    const t = String(e.stdout || '') + String(e.stderr || '');
    pass = (t.match(/^\s*(?:ℹ|#)\s*pass (\d+)/m) || [])[1];
    fail = (t.match(/^\s*(?:ℹ|#)\s*fail (\d+)/m) || [])[1];
}
log(`   node --test：pass ${pass} · fail ${fail} · README 写的是 ${readmeSays}`);
if (fail !== '0') die(`判据有红（fail ${fail}）`);
if (Number(pass) !== readmeSays) die(`★README 写的 ${readmeSays} 与实际跑的 ${pass} **对不上** —— 这正是"帖子引的数进仓库对不上"那个病，先改 README 再推`);

const smoke = execFileSync('node', ['demo/smoke-demo.js'], { cwd: OUT, encoding: 'utf8', maxBuffer: 1 << 24 });
const smokeBytes = (smoke.match(/终态 SSOT\s+([\d,]+)\s*字节/) || [])[1];
log(`   冒烟：终态 SSOT ${smokeBytes || '（没读到）'} 字节 · ${/PASS/.test(smoke) ? 'PASS' : '✘ 不是 PASS'}`);
if (!/PASS/.test(smoke)) die('冒烟不是 PASS');
if (!smokeBytes) die('冒烟没打出终态字节数（口径变了 ⇒ 先核对 demo/smoke-demo.js）');

// 文档守门（★发布件里也跑一遍：读数写死在别处 = 第二份真相）
//   ★报错时**把红的那几条原样打出来**——只打一句"没过"等于让下一个人重跑一遍才知道差在哪
//     （leg106 在这一条上盲修三轮，教训留档）。
try {
    const audit = execFileSync('node', ['scripts/audit-docs.mjs', '--check'], { cwd: OUT, encoding: 'utf8', maxBuffer: 1 << 24 });
    log('   文档守门：' + (audit.match(/守门结果：([^\n]+)/) || [, '（没读到）'])[1]);
} catch (e) {
    const t = String(e.stdout || '') + String(e.stderr || '');
    const reds = t.split('\n').filter((l) => l.trim().startsWith('✘'));
    log('   文档守门 ✘ 未过的条目：');
    for (const r of reds) log('     ' + r.trim());
    die(`导出件的文档守门没过（${(t.match(/守门结果：([^\n]+)/) || [, '?'])[1]}）⇒ 在导出目录里跑 node scripts/audit-docs.mjs 看全量`);
}

if (DRY) {
    log(`\n★ --dry-run：导出件在 ${OUT}（判据与冒烟都过了），**没有推**。`);
    log(`   要去掉 --dry-run 才会造提交并推 main。`);
    process.exit(0);
}

// ── ④ 造提交（根树独立 + 父 = 远端 main） ─────────────────────────
log('\n④ 造提交（独立根树 + 父 = 远端 main）');
const monoDate = gitT(['log', '-1', '--format=%aI', 'HEAD']);
const headMsg = gitT(['log', '-1', '--format=%B', 'HEAD']);
const msg = [
    `${panelBuild}`,
    '',
    `本提交 = monorepo ${head.slice(0, 7)} 的 \`${SUBTREE}\` 子树导出（独立根树，逐字节同源）。`,
    '',
    headMsg.trim(),
    '',
    `判据 ${pass}/${pass} · 冒烟终态 SSOT ${smokeBytes} 字节 · PASS`,
    '（本提交由 scripts/publish-release.mjs 生成：仓外独立跑过判据与冒烟）',
].join('\n');
const commit = gitT(['commit-tree', rootTree, '-p', remoteSha], {
    input: msg,
    env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'huangkun', GIT_AUTHOR_EMAIL: 'huangkun666@users.noreply.github.com',
        GIT_COMMITTER_NAME: 'huangkun', GIT_COMMITTER_EMAIL: 'huangkun666@users.noreply.github.com',
        GIT_AUTHOR_DATE: monoDate, GIT_COMMITTER_DATE: monoDate,
    },
});
log(`   新提交 = ${commit.slice(0, 7)}（父 = ${remoteSha.slice(0, 7)}）· 构建号 ${panelBuild}`);

// ── ⑤ 推 ──────────────────────────────────────────────────────────
log('\n⑤ 推送发布仓 main（**不带 tag**——tag/release 的语义要用户裁定，见 STATE.md §3-A）');
// ★★leg106（实战）：本机到 github.com 的链路**时通时断**——实测同一分钟里
//   `ls-remote` 前两次 `Failed to connect / Recv failure: Connection was reset`、后两次成功；
//   而 `push` 头一次就是 reset。**网络抖动绝不能被读成"推送失败"**（人会以为是自己脚本写错了）。
//   ⇒ 定稿：**退避重试**（4 次，1.5s→3s→6s 递增），每次把原因原样报出来；全失败才停下。
//   ★判"成不成"只看最后一步的退出码，**不解析报错文本**（文本会被 git 版本改）。
let push = { ok: false, out: '' };
for (let attempt = 1; attempt <= 4; attempt++) {
    push = gitAuth(['push', url, `${commit}:refs/heads/main`]);
    if (push.ok) { log(`   ✔ 第 ${attempt} 次推送成功`); break; }
    const why = push.out.split('\n').filter((l) => /fatal|error|reset|refused|timed out/i.test(l))[0] || push.out.split('\n')[0] || '（无输出）';
    log(`   ✘ 第 ${attempt} 次未成：${why.trim()}`);
    if (attempt < 4) { const wait = 1500 * 2 ** (attempt - 1); log(`     ↻ ${wait / 1000}s 后重试（网络抖动，不代表脚本错）`); await new Promise((r) => setTimeout(r, wait)); }
}
if (!push.ok) {
    log('   ⚠ 四次都没成 ⇒ 分两种情形，别混：');
    log('     ① **网络问题**（本机到 github 的链路断）：提交与导出件都在，**改天或换个网络直接重跑本脚本**即可（幂等守卫会认出来）；');
    log('     ② **权限/仓库问题**：先 `git ls-remote https://github.com/' + REPO + '.git` 试读——读得通才谈写。');
    die('推送失败');
}

// ── ⑥ 远端核验（不信本地，从 API 读回来） ─────────────────────────
log('\n⑥ 远端核验（从 API 读回来对）');
const after = (await api(`/repos/${REPO}/commits/main`)).body;
log(`   main = ${String(after?.sha).slice(0, 7)} ${after?.sha === commit ? '✔ 正是这条' : '✘ 不是它'}`);
if (after?.sha !== commit) die('远端 main 不是刚推的那条 ⇒ 停');

const contentOf = async (p) => {
    const r = await api(`/repos/${REPO}/contents/${p}?ref=main`);
    if (r.status !== 200 || !r.body?.content) return { sha: null, text: null };
    return { sha: r.body.sha, text: Buffer.from(r.body.content, 'base64').toString('utf8') };
};
const localBlob = (p) => gitT(['rev-parse', `HEAD:${SUBTREE}/${p}`]);

let ok = 0, bad = 0;
const check = (label, cond, extra = '') => { if (cond) { ok++; log(`   ✔ ${label}${extra ? ' · ' + extra : ''}`); } else { bad++; log(`   ✘ ${label}${extra ? ' · ' + extra : ''}`); } };

const rBase = await contentOf('src/render-base.js');
check('远端构建号 = 本笔', (rBase.text?.match(/PANEL_BUILD = '([^']+)'/) || [])[1] === panelBuild, panelBuild);
const rReadme = await contentOf('README.md');
check('远端 README 读数 = 实测', (rReadme.text?.match(/本版：(\d+)\s*\/\s*(\d+)/) || [])[0] === `本版：${pass} / ${readmeSays}`, `本版：${pass} / ${readmeSays}`);
for (const f of ['README.md', 'manifest.json', 'web/index.js', 'web/style.css', 'src/render-base.js', 'settings.html']) {
    const r = await contentOf(f);
    check(`逐字节：${f}`, r.sha === localBlob(f), `${localBlob(f).slice(0, 10)} vs ${String(r.sha).slice(0, 10)}`);
}
const tags = (await api(`/repos/${REPO}/tags`)).body || [];
log(`   tags：${tags.map((t) => `${t.name}→${t.commit.sha.slice(0, 7)}`).join(' ') || '（无）'}（★本脚本不动 tag）`);

log(`\n发布完成：${commit.slice(0, 7)} · 核验 ${ok + bad} 项：${ok} ✔ · ${bad} ✘`);
log(`★别忘了：帖子/README 里若引了旧判据数，要跟着改（帖子已发布 ⇒ 只能用户自己改）；`);
log(`  另跑一次 node scripts/verify-release.mjs 做只读终检。`);
process.exit(bad === 0 ? 0 : 1);
