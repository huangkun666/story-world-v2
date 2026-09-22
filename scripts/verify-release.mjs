// story-world-v2 / scripts/verify-release.mjs
//
// ★★leg106：**远端只读终检**（从发布仓 API 逐项核回，**不信本地**）。
//   为什么单独一个脚本：leg103 的推送脚本在最后一行有个变量顺序 bug（`rBt` 在声明前被引用）崩了，
//   而**推送本身已经成功**；重推要先过幂等守卫（树相同 ⇒ 跳过）⇒ **终检单列出来更干净**。
//
// 跑法：node scripts/verify-release.mjs
// 退出码：0 = 全绿；1 = 有 ✘（会逐条打出来）
//
// ★纪律：本脚本**只读**，不改本地、不改远端；token 只在本进程环境里用，**不打印**。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MONO = path.resolve(ROOT, '..');
const SUBTREE = path.basename(ROOT);
const REPO = 'huangkun666/story-world-v2';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const cred = fs.readFileSync(path.join(os.homedir(), '.git-credentials'), 'utf8').trim().split(/\r?\n/).filter(Boolean)[0];
const token = (/^https?:\/\/[^:]+:([^@]*)@/.exec(cred) || [])[1];
if (!token) { console.log('✘ 从 .git-credentials 里解析不出 token ⇒ 停下'); process.exit(2); }

const api = async (p) => {
    const r = await fetch('https://api.github.com' + p, {
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'sw2-verify' },
    });
    return { status: r.status, body: await r.json().catch(() => null) };
};
const contentOf = async (p, ref = 'main') => {
    const r = await api(`/repos/${REPO}/contents/${p}?ref=${ref}`);
    if (r.status !== 200 || !r.body?.content) return { sha: null, text: null, size: null };
    return { sha: r.body.sha, text: Buffer.from(r.body.content, 'base64').toString('utf8'), size: r.body.size };
};
const localBlob = (p) => execFileSync('git', ['rev-parse', `HEAD:${SUBTREE}/${p}`], { cwd: MONO, encoding: 'utf8' }).trim();

const head = (await api(`/repos/${REPO}/commits/main`)).body;
console.log(`发布仓 ${REPO}`);
console.log(`main = ${String(head?.sha).slice(0, 7)} · ${String(head?.commit?.message).split('\n')[0].slice(0, 70)}`);
console.log(`本地 monorepo 子树 = ${execFileSync('git', ['rev-parse', `HEAD:${SUBTREE}`], { cwd: MONO, encoding: 'utf8' }).trim().slice(0, 7)}`);

let ok = 0, bad = 0;
const check = (label, cond, extra = '') => {
    if (cond) { ok += 1; console.log(`  ✔ ${label}${extra ? ' · ' + extra : ''}`); }
    else { bad += 1; console.log(`  ✘ ${label}${extra ? ' · ' + extra : ''}`); }
};

// ① 版本三处一致：manifest.json = web/index.js 的 VERSION = 判据锁着的那一处
const rManifest = await contentOf('manifest.json');
let manifestOk = false, manifestVersion = null;
try { const m = JSON.parse(rManifest.text); manifestVersion = m.version; manifestOk = true; } catch { /* 保持 false */ }
check('远端 manifest.json 可解析', manifestOk, manifestVersion || '');
const rIndex = await contentOf('web/index.js');
const remoteVersion = (rIndex.text?.match(/const VERSION = '([^']+)'/) || [])[1];
check('远端版本号 = manifest', !!manifestVersion && manifestVersion === remoteVersion, `manifest ${manifestVersion} · web ${remoteVersion}`);

// ② 构建号：本地 vs 远端（逐字节由下面的 blob 哈希兜）
const localBuild = (/export const PANEL_BUILD = '([^']+)'/.exec(read('src/render-base.js')) || [])[1];
const rBase = await contentOf('src/render-base.js');
const remoteBuild = (rBase.text?.match(/export const PANEL_BUILD = '([^']+)'/) || [])[1];
check('面板构建号一致', localBuild === remoteBuild, `本地 ${localBuild} · 远端 ${remoteBuild}`);

// ③ README 读数：远端必须与本地逐字相同（"社区看的那份就是我测过的那份"）
const rReadme = await contentOf('README.md');
const num = (t) => (t?.match(/本版：(\d+)\s*\/\s*(\d+)/) || [])[0];
check('README 判据读数一致', num(rReadme.text) === num(read('README.md')), `远端 ${num(rReadme.text)} · 本地 ${num(read('README.md'))}`);
check('README 是新人自述口径', !!rReadme.text?.includes('第一次写酒馆插件'));

// ④ 本棒的骨架必须在远端（发布件里必须有 STATE/索引/脚本，否则下一任在发布仓里找不到入口）
for (const f of ['STATE.md', 'docs/index.json', 'scripts/audit-docs.mjs', 'scripts/publish-release.mjs', 'scripts/verify-release.mjs']) {
    const r = await contentOf(f);
    check(`新基建在远端：${f}`, r.sha !== null, r.size ? `${r.size} 字节` : '（缺）');
}
// ★发布树里**不许**有真跑快照与 package.json（零依赖 + 不带作者对局）
const rSnap = await api(`/repos/${REPO}/contents/snapshots?ref=main`);
check('发布树里没有 snapshots/', rSnap.status === 404, `HTTP ${rSnap.status}`);
const rPkg = await api(`/repos/${REPO}/contents/package.json?ref=main`);
check('发布树里没有 package.json（零依赖）', rPkg.status === 404, `HTTP ${rPkg.status}`);

// ⑤ 逐字节：本地 git blob vs 远端 blob
for (const f of ['README.md', 'manifest.json', 'settings.html', 'STATE.md', 'web/index.js', 'web/style.css', 'src/render-base.js', 'docs/index.json']) {
    const r = await contentOf(f);
    check(`逐字节：${f}`, r.sha === localBlob(f), `${localBlob(f).slice(0, 10)} vs ${String(r.sha).slice(0, 10)}`);
}

// ⑥ tag / release：本脚本不改，只报现状（语义要用户裁定）
const tags = (await api(`/repos/${REPO}/tags`)).body || [];
const rels = (await api(`/repos/${REPO}/releases`)).body || [];
console.log(`  ℹ tags：${tags.map((t) => `${t.name}→${t.commit.sha.slice(0, 7)}`).join(' ') || '（无）'}`);
console.log(`  ℹ releases：${rels.map((r) => `${r.tag_name}${r.prerelease ? '(预览)' : ''}`).join(' ') || '（无）'}`);
console.log(`  ℹ ★tag 语义未定 ⇒ 若 tag 落后于 main，**点 release 下载的人拿到的是旧面板**（见 STATE.md §3-A）`);

console.log(`\n远端核验 ${ok + bad} 项：${ok} ✔ · ${bad} ✘`);
process.exit(bad === 0 ? 0 : 1);
