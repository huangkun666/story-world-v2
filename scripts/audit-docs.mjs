// story-world-v2 / scripts/audit-docs.mjs
//
// ★★leg106：**文档守门**——把"文档纪律"也变成判据（本仓既有风格：「判据必须打产品真入口」）。
//
// 为什么需要它（三条都是 leg106 实测出来的**已经发生**的失效，不是假想）：
//   ① **入口页膨胀**：`docs/START-HERE.md` 自订 ≈5 KB 上限（`docs/dev-process.md:47,55`），
//      实测 **291,822 字节 = 超标 58 倍**，而该文件最后一行还在写"这份文件要保持短"。
//   ② **索引漂移**：`LEDGER.md`（索引）最新一行 = leg98，`docs/ledger.md`（全文）已到 leg105
//      ⇒ **缺 7 棒**；而 `LEDGER.md:7` 那条维护纪律写的是"全文加一行 + 本索引加一行"——连续七棒没执行，没人发现。
//   ③ **读数多副本**：同一个"判据总数"在活文档里有 **6 个并行当前值**（1096 / 1092 / 1085 / 1078 / 1066 / 1008），
//      **没有任何机制区分"历史读数"与"当前值"**。同一文件内还会自己打自己
//      （`START-HERE.md:5` 纠正 3097→3099，而 `:9` 仍写 3097）——**纠正以"新写一条"的形式存在，错值原地不动**。
//
// 治法（照 leg106 定下的纪律）：**当前值只许有一个家（`STATE.md` §1）；历史文件只标注不修改。**
//   ⇒ 这个脚本就是那个"家"的守门人，外加**唯一生成物** `docs/index.json` 的生成器
//     （机器可读索引，让"哪个 leg 覆盖主题 X"变成一次 grep，而不是读 922 KB 全文台账）。
//
// 跑法（在插件目录内）：`node scripts/audit-docs.mjs`
//   · 默认：生成/覆盖 `docs/index.json` 并自检
//   · `--check`：只核对，**不写文件**（交接收尾时用；`docs/index.json` 过期即红）
//   · `--json`：把结果以 JSON 打到 stdout（给别的脚本吃）
//   ★★leg108：本脚本现在**会现跑一次 `node --test`**（约 3 秒）——为的是给"判据总数"补上那条
//     **现读真值**的腿（此前它比的是 STATE.md ↔ README.md 两个文档：**两处一起错就一起绿**）。
//   ★★leg108 另加一条 R7：**入口不许再长**——"自称先读我、却不指向 STATE.md"的文档数钉在 83 份
//     （计数棘轮：涨了就红）。存量是历史交接，**原地不动**（本仓纪律：过去只标注、不修正）。
//
// ★纪律：本脚本**只读生产源码与文档**，只写 `docs/index.json` 这一个文件；不碰工作区其它任何字节。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MONO = path.resolve(ROOT, '..');            // 仓库根（monorepo：子树名 story-world-v2）
const SUBTREE = path.basename(ROOT);              // = 'story-world-v2'，用来取 git 历史

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const AS_JSON = args.includes('--json');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const one = (text, re) => { const m = re.exec(text); return m ? m[1] : null; };
const clean = (s) => String(s ?? '').replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
const stripTags = (s) => String(s ?? '').replace(/\*\*/g, '').replace(/`/g, '').trim();

// ── ① 生产真源读数（★现读源码，不写死） ─────────────────────────────
const src = {
    manifest: JSON.parse(read('manifest.json')),
    renderBase: read('src/render-base.js'),
    webIndex: read('web/index.js'),
    prompts: read('src/prompts.js'),
    readme: read('README.md'),
};

// ★★leg124：**"远端已经发布到哪一版"这个读数，本脚本不知道也不该假装知道**。
//   病（leg124 实测）：`release.publishedBuild` 这一格**读的是源码的 `PANEL_BUILD`**（leg107 的设计）
//     ——于是它写的**永远是本地号**（今天 `leg123-tag-granularity`），而**真发布在远端是 `leg105-deadpager`**
//     （`STATE.md` §1 那行才是人核过的真值）⇒ 一个**无网络**的生成物却挂着一个**远端口径的名字**，
//     读着像"已经发布到 leg123"。这与 leg106 那条"写死就是第二份真相"是同一个形状，只是换了方向：
//     前者是**旧的死值**、这次是**名不副实的活值**。
//   ★口径（照本仓"事实优先、宁缺勿造"）：**本脚本只写它真知道的两件事**——
//     ① 源码现在是什么号（`current.panelBuild`，现读）；
//     ② 人上次核过的发布点（本常量 + git 里读得到的发布子树哈希）。
//     远端真值一律由 `node scripts/verify-release.mjs` 出手（会联网）；本文件**不猜**。
const PUBLISHED_BUILD = 'leg105-deadpager';      // ★人核过的"当前发布点"；改它 = 一次发布（STATE.md §1 与 §5.1）
const PUBLISHED_COMMIT_REF = '7f3a7df';          // ★同一发布点的**代码提交**（STATE.md §1 "发布仓 main" 那行）
// ★★（发布阻塞勘正 · 2026-09-28）：这一格**必须与 REF 一样是常数**，不许现读 git。
//   病（实测）：`published.date` 原先写的是 `gitLine('log -1 --format=%cs ' + REF)`——那是"问本机"，
//     而发布流程把子树导成**独立根树**（`git read-tree`，导出件**不在任何 git 仓库里**）
//     ⇒ 导出件里它只能返回 `null`，盘上却是字符串 ⇒ 守门那条**逐字节比对恒红**、推送被拦下
//     （实测原文：`release.published.commit: 类型不同 ｜ release.published.date: 类型不同`）。
//   ★口径回到本脚本 leg106 自己那条："一切'问本机'的结果不进这个文件"。
//     日期与哈希一样是**人核过的事实**：值仍照 `git log -1 --format=%cs <REF>` 取，取完写死在这里。
const PUBLISHED_COMMIT_DATE = '2026-09-22';
// ★守门用的禁词（见 R8）：这几个名字在生成物里**一律不许再出现**——它们分不清"本地号"与"已发布号"。
const FORBIDDEN_RELEASE_KEYS = ['publishedBuild', 'publishedTag', 'publishedTagCommit'];
const entriesDeep = (o, path = '', acc = []) => {
    if (!o || typeof o !== 'object') return acc;
    for (const [k, v] of Object.entries(o)) {
        acc.push([path ? `${path}.${k}` : k, v]);
        entriesDeep(v, path ? `${path}.${k}` : k, acc);
    }
    return acc;
};

const panelBuild = one(src.renderBase, /export const PANEL_BUILD = '([^']+)'/);
const cssVersion = one(src.webIndex, /const CSS_VERSION = '([^']+)'/);
const mainPromptV = one(src.prompts, /export const MAIN_PROMPT_V = '([^']+)'/);
const panelVersion = one(src.webIndex, /const VERSION = '([^']+)'/);
const webIndexLines = src.webIndex.split('\n').length;
const readmeTests = (src.readme.match(/本版：(\d+)\s*\/\s*(\d+)/) || []).slice(1, 3);
const readmeSmoke = one(src.readme, /终态\s*([\d,]+)\s*字节/);

// ★★leg108：**判据总数也要现读真值**（本脚本此前唯一没有"现读"的那一格）。
//   病（leg108 实测）：R2 里 `tests` 这一格比的是 **STATE.md ↔ README.md**（两个文档互相对），
//   判据总数**从来没有实测来源** ⇒ leg107 新增 11 条判据之后 STATE 与 README 都还写 `1096/1096`、
//   而实测是 **1107/1107** —— **守门照样 PASS**。这与 leg107 §3 修掉的 `publishedBuild` 写死
//   是**同一个形状**：读数缺一条"现读真值"的腿。
//   口径：跑一次 `node --test`（本插件零依赖，约 3 秒），读它的汇总行（`ℹ pass N` / `ℹ fail N`）。
//   ★拿不到读数 ⇒ **红**并如实写原因 —— 不许降级成"未知也算过"（静默的绿比红坏得多，本仓的常客）。
const measureTests = () => {
    const parse = (out) => {
        const pass = one(out, /^ℹ pass (\d+)$/m);
        const fail = one(out, /^ℹ fail (\d+)$/m);
        return pass === null ? null : { pass: Number(pass), fail: fail === null ? null : Number(fail) };
    };
    try {
        return parse(execFileSync(process.execPath, ['--test'], { cwd: ROOT, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 }));
    } catch (err) {
        // ★判据红时 `node --test` 以非零码退出 ⇒ 汇总行在 `err.stdout` 里（别把它读成"跑不起来"）
        return parse(String(err?.stdout || '')) || { error: String(err?.message || err).split('\n')[0] };
    }
};
const measured = measureTests();

// ── ② STATE.md §1 表里的读数（与上面的真源逐个对） ──────────────────
const stateText = exists('STATE.md') ? read('STATE.md') : '';
const stateBytes = stateText ? Buffer.byteLength(stateText) : 0;
// ★口径（这里第一版就栽过，留档）：**一格 = 两枚 `|` 之间的内容**。
//   `split('|')` 之后：`[0]` 是行首那个空片、`[1]` 是**标签格**、`[2]` 才是**值格**。
//   第一版写 `m[1]` ⇒ 取到的是标签本身（"判据"），于是"判据数"被读成 `1`，还误报了一条红。
//   ★这与 leg55/57 台账守门那条踩坑同源：**尺子错的时候，看起来永远像行错**。
const cell = (label) => {
    for (const line of stateText.split('\n')) {
        if (!line.startsWith('| ' + label + ' |')) continue;
        const cols = line.split('|').map((s) => s.trim());
        if (/^-+$/.test(cols[1] || '')) continue;   // 表头分隔行：`| 读数 | 当前值 | 怎么复量 |` 下面那行 `|---|---|---|`
        return clean(cols[2] ?? '');
    }
    return null;
};
const state = {
    tests: cell('判据'),
    smoke: cell('冒烟'),
    panelBuild: cell('`PANEL_BUILD`'),
    cssVersion: cell('`CSS_VERSION`'),
    mainPromptV: cell('`MAIN_PROMPT_V`'),
    webIndexLines: cell('`web/index.js` 行数'),
};
// ★口径（这里连栽两次，全留档）：`one()` 返回的是**第一个捕获段**，不是整个匹配
//   ⇒ 拿它去取 "1096 / 1096" 只会得到 "1096"，于是下面 `stateTests[1]` 是 undefined、
//     打印出来像 `STATE 1`。**两次都不是行错，是尺子错**（与 leg55/57 台账守门同一条教训）。
const stateTests = String(state.tests).match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
// 单元格里常带解释（"3099 / 3100（硬锁 <3100，test/…:339）"）⇒ 比数时**只取第一个数**。
const firstNum = (s) => { const m = /(\d[\d,]*)/.exec(String(s ?? '')); return m ? m[1].replace(/,/g, '') : null; };

// ── ③ 全文台账：leg 行索引（一行 = 一次变更：日期 | 谁 | 一句话） ────
const LEDGER_FULL = 'docs/ledger.md';
const ledgerLines = exists(LEDGER_FULL) ? read(LEDGER_FULL).split('\n') : [];
const legRows = [];
for (const line of ledgerLines) {
    if (!line.startsWith('| 20')) continue;
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length < 5) continue;
    const date = parts[1];
    const who = parts[2];
    const legM = /leg(\d+)/.exec(who);
    const title = clean(parts[3]).slice(0, 160);
    legRows.push({
        leg: legM ? Number(legM[1]) : null,
        date,
        who: clean(who).slice(0, 120),
        title,
        line: ledgerLines.indexOf(line) + 1,
        bytes: Buffer.byteLength(line),
    });
}
const legsWithNumber = legRows.filter((r) => r.leg !== null);
const latestLeg = legsWithNumber.reduce((a, b) => (a === null || b.leg > a.leg ? b : a), null);

// ── ④ 交接文档：根目录（活）+ handoffs/（归档） ─────────────────────
const listDir = (d, filter) => (exists(d) ? fs.readdirSync(path.join(ROOT, d)).filter(filter).sort() : []);
const handoffRoot = listDir('docs', (f) => /^session-handoff-.*\.md$/.test(f));
const handoffArchive = listDir('docs/handoffs', (f) => /^session-handoff-.*\.md$/.test(f));
const dupHandoffs = handoffRoot.filter((f) => handoffArchive.includes(f));
const newestHandoff = handoffRoot.length ? handoffRoot[handoffRoot.length - 1] : null;
const handoffLegOf = (f) => { const m = /leg(\d+)/.exec(f); return m ? Number(m[1]) : null; };
const newestHandoffLeg = newestHandoff ? handoffLegOf(newestHandoff) : null;

// ── ⑤ 体积清点 ────────────────────────────────────────────────────
// ★★leg106（第三次被 --dry-run 咬出来，此处连栽三轮，全留档）：
//   病一：**自指计数**——`docs/` 的体积里包含着**本脚本自己要写的那个文件**（`docs/index.json`）
//     ⇒ 一写就变、变了又"过期"、再写又变 ⇒ **永远不收敛**（实测：连跑两次哈希都不同）。
//     第一版治法（`总大小 − 生成物字节数`）也错：**生成物自己会变长** ⇒ 减数与被减数同时在动。
//     ⇒ 定稿：**遍历时直接排除生成物**（`skip` 集合），另排除调试用的 `.bak`。
//   病二：**换行进了读数**——判据锁着这两个数，而它们会随"工作区是 CRLF 还是 LF"变化
//     （实测：`leg105` 交接文档本机 CRLF 12532B，git 里 LF 12387B，正好差 145 = 它的 CRLF 条数）
//     ⇒ 导出件（LF）与本机（CRLF）读数不同，守门**永远红**。
//     ⇒ 定稿：**按 LF 归一**口径清点（读进来减掉 CRLF 的字节），谁检出都一样；
//       它本来就是用来量"文档增长"的尺子，不该把"结账机怎么结账"算进去。
//   ★三轮都栽在同一件事上：**先量出"差多少"，再动手**（本棒 §5 那条纪律的现场重演）。
const walk = (dir, skip = new Set(), acc = { files: 0, bytes: 0 }) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        if (skip.has(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, skip, acc);
        else {
            const buf = fs.readFileSync(p);
            const crlf = (buf.toString('utf8').match(/\r\n/g) || []).length;   // 二进制/图片里没有 \r\n 组合，安全
            acc.files += 1;
            acc.bytes += buf.length - crlf;
        }
    }
    return acc;
};
const docsSize = exists('docs')
    ? walk(path.join(ROOT, 'docs'), new Set(['index.json', 'index.json.bak']))
    : { files: 0, bytes: 0 };
// ★★leg106（被 --dry-run 当场咬出来的一处）：**本脚本会随发布件一起出门**（`scripts/` 进发布树），
//   而导出件**不在任何 git 仓库里**（它是 `read-tree` 出来的独立根树）⇒ `git ls-files` 会抛
//   `fatal: not a git repository`。第一版把它 catch 成 `-1` 直接进了 index.json，
//   结果**导出件的守门判红、把推送拦下了**（好事：闸真的会咬）。
//   ⇒ 定稿：**先探测在不在仓库里**；在仓库里（monorepo 子树）才去问 git，不在就当"未知"如实写，不猜。
const IN_REPO = fs.existsSync(path.join(MONO, '.git'));
// ★leg124 原话（**已被本笔推翻，留档而不是抹掉**）："`release.published.commit` 要从 git 读，
//   而导出件没有 git。它是**纯本地事实的复制**（与发布件里那一格相同的值），**不是**"问本机"的东西，
//   所以不违反下面 §⑥ 那条纪律。"
// ★★2026-09-28 实测勘正：**它确实违反了。** 那两格是"结账机读不读得到 git"的函数，而 §⑥（leg106）
//   要的是"写进盘的那一份与跑在哪台机、哪个目录无关"。导出件读成 `null`、盘上是字符串 ⇒ 逐字节比对
//   恒红、推送被自己的守门拦下。⇒ 那两格改成常数（见文件顶部 `PUBLISHED_COMMIT_DATE` 的留档），
//   下面这个只服务它们俩的 `gitLine()` 随之删除（`tracked` 另有用途，留着）。
const tracked = (rel) => {
    if (!IN_REPO) return null;                 // 导出件：无 git ⇒ 如实报"未知"
    try {
        const out = execFileSync('git', ['ls-files', '--', `${SUBTREE}/${rel}`], { cwd: MONO, encoding: 'utf8' });
        return out.trim() ? out.trim().split('\n').length : 0;
    } catch { return null; }
};

// ── ⑥ 组装 index.json（唯一生成物） ────────────────────────────────
// ★★leg106（第二次被 --dry-run 咬出来）：**写进盘的那一份必须与"跑在哪台机、哪个目录"无关**。
//   第一版把 `repo.pluginDir`（本机绝对路径）与 `snapshotTracking.trackedFiles`（要问 git）也写了进去 ⇒
//   导出件（`%TEMP%\sw2-release\out`，且不在任何 git 仓库里）生成出来的那一份**永远与仓里那份不等**
//   ⇒ 导出件的守门恒红、把推送拦下。**发布件里出现开发机路径本身就是缺陷**（隐私 + 不可复现）。
//   ⇒ 定稿：**落盘的对象只含与环境无关的事实**；一切"问本机"的结果（git 跟踪数、绝对路径、生成时间）
//      **不进这个文件**，只在 stdout 上如实报告。
const index = {
    note: '★本文件由 node scripts/audit-docs.mjs 生成，不要手改。当前值的唯一出处是 STATE.md §1。',
    schema: 1,
    repo: src.manifest.id,                            // ★用 ST 扩展 id，不用目录名（目录名一改文件就"过期"）
    manifest: { id: src.manifest.id, displayName: src.manifest.display_name, version: src.manifest.version, panelVersion },
    current: {
        tests: stateTests ? `${stateTests[1]}/${stateTests[2]}` : null,
        smokeBytes: readmeSmoke ? Number(readmeSmoke.replace(/,/g, '')) : null,
        panelBuild, cssVersion, mainPromptV, webIndexLines,
        webIndexLineLock: 3100,
    },
    docs: {
        stateBytes,
        startHereBytes: exists('docs/START-HERE.md') ? Buffer.byteLength(read('docs/START-HERE.md')) : null,
        frozenIndexBytes: exists('LEDGER.md') ? Buffer.byteLength(read('LEDGER.md')) : null,
        ledgerFullBytes: exists(LEDGER_FULL) ? Buffer.byteLength(read(LEDGER_FULL)) : null,
        docsFiles: docsSize.files,
        docsBytesLf: docsSize.bytes,
        docsCountNote: '★不含生成物 docs/index.json 自己（自指计数会让文件永不收敛——见 §⑤ 留档）；'
            + '★字节按 **LF 归一**数（读进来减掉 CRLF 的字节）：判据锁着它，而检出状态（CRLF/LF）因机而异，'
            + '不该把"结账机怎么结账"算进文档体积（实测差异：leg105 交接 CRLF 12532B vs LF 12387B，正好差它的 145 个 CRLF）。',
        handoffsRoot: handoffRoot.length,
        handoffsArchive: handoffArchive.length,
        latestLedgerLeg: latestLeg ? latestLeg.leg : null,
        latestHandoffLeg: newestHandoffLeg,
    },
    release: {
        repo: 'huangkun666/story-world-v2',
        // ★★leg107：这里原先**写死** `'leg103-switchglow'`（leg106 留下的），于是每次重生成都把这个
        //   旧值重新印一遍 —— 它**永远不会自己跟上**，而守门 R1–R6 里没有一条核 release 块 ⇒
        //   陈旧值一路绿灯、还随发布件出了门（远端那份 `docs/index.json` 里就带着它）。
        //   这正是 leg106 自己那句"写死就是第二份真相"的现场重演，只是漏在了守门的生成物里。
        //   ⇒ 定稿：**现读源码的 `PANEL_BUILD`**（发布树里它与本地逐字节同源，`verify-release.mjs` 的
        //     「面板构建号一致」+「逐字节：src/render-base.js」两条判据锁着这个前提）。
        //   ★★leg124 勘正（**名字**这一层）：上一条治的是"值陈旧"，**没治"名不副实"**——
        //     现读源码拿到的是**本地号**，却被印在 `publishedBuild` 这个**远端口径的名字**下
        //     ⇒ 读着像"远端已经发布到 leg123"，而真发布是 `leg105-deadpager`（差 18 个版本）。
        //     ⇒ 定稿：**拆成两格**——`sourceBuild`（本地产物，现读）与 `published`（人核过的发布点，
        //       见本脚本顶部 `PUBLISHED_BUILD`），并由守门 R8 钉住禁词不再回来。
        sourceBuild: panelBuild,
        // ★`published` 这一格**只能是人核过的**（git 里读不到远端 tag；本文件不联网 ⇒ 不猜）。
        //   `commit` / `date` 是**发布子树那次提交**，`tag` / `release` 是人记的，须与远端核对
        //   ⇒ 真值一律用 `node scripts/verify-release.mjs`。
        // ★★（发布阻塞勘正 · 2026-09-28）：这四格**一律用常数**。`commit` / `date` 从前那两次
        //   `gitLine()` 现读是 leg124 加进来的，它当场违反了 leg106 那条纪律（留档见文件顶部
        //   `PUBLISHED_COMMIT_DATE` 与 `gitLine` 删除处）——导出件没有 git ⇒ 读成 `null` ⇒ 与盘上不等
        //   ⇒ 推送被自己的守门拦下。★**值一个字节没变**：`PUBLISHED_COMMIT_REF` 就是那个提交哈希本身。
        published: {
            build: PUBLISHED_BUILD,
            tag: 'v1.0.0-preview.1',
            tagCommit: '1a54424',
            commit: PUBLISHED_COMMIT_REF,
            commitRef: PUBLISHED_COMMIT_REF,
            date: PUBLISHED_COMMIT_DATE,
        },
        note: '★**"已发布到哪一版"这个读数只有 `STATE.md` §1 是人核过的真值**（本文件没有网络，'
            + '也不知道远端现在是什么）。这里两格分得很清：`sourceBuild` = 源码现在的号（现读，随改随变）；'
            + '`published` = 人上次核过的发布点（常数，改它 = 一次发布）。远端真值一律用 '
            + 'node scripts/verify-release.mjs 核。',
    },
    legs: legsWithNumber.sort((a, b) => b.leg - a.leg),
};

// ── ⑦ 守门（红 = 必须修；黄 = 只提示） ─────────────────────────────
const reds = [];
const yellows = [];
const passes = [];
const T = (label, ok, detail = '') => (ok ? passes.push(`${label}${detail ? ' · ' + detail : ''}`) : reds.push(`${label}${detail ? ' · ' + detail : ''}`));
const W = (label, ok, detail = '') => { if (!ok) yellows.push(`${label}${detail ? ' · ' + detail : ''}`); };

// R1 STATE.md 存在且够短，且不含按棒存档段（它是"当前值"，不是"流水账"）
T('STATE.md 存在', stateBytes > 0);
T('STATE.md ≤ 20 KB', stateBytes > 0 && stateBytes <= 20480, `${stateBytes} 字节`);
// ★R9 配套：**快顶格就提前报黄**——别等它红了才想起来该把旧的搬进 `docs/done-archive.md`
//   （本文件是这个仓唯一"有硬顶"的那一份，顶格是常态而不是意外；黄一条比红一条便宜得多）。
W('STATE.md 余量还够（≥ 5%）', stateBytes > 0 && stateBytes <= 19456,
    `现 ${stateBytes} / 20480 字节（余 ${20480 - stateBytes}）⇒ 顶格前把 §4 里更早的一条搬进 docs/done-archive.md`);
T('STATE.md 不含按棒存档段', !/^> 🛑 20/m.test(stateText) && !/·\s*两笔\s*·/.test(stateText));

// R2 STATE.md §1 与生产真源逐项相同（★这是"消灭读数多副本"的那一刀）
T('STATE 判据 = README 判据', !!stateTests && !!readmeTests.length && stateTests[1] === readmeTests[0] && stateTests[2] === readmeTests[1],
    `STATE ${stateTests && stateTests[0]} · README ${readmeTests.join('/')}`);
// ★★leg108：这一格才是"消灭读数多副本"真正缺的那条腿 —— **两处都写对**才算过
//   （此前只要"两处相同"就过 ⇒ 两处一起漂也绿，leg107 那 11 条判据就是这么漏掉的）。
T('★判据数 = 实测（现跑 node --test）', !!measured.pass && !!stateTests && !!readmeTests.length
    && String(measured.pass) === String(stateTests[1]).replace(/,/g, '') && String(measured.pass) === readmeTests[0],
    measured.pass ? `实测 ${measured.pass} · STATE ${stateTests && stateTests[0]} · README ${readmeTests.join('/')}`
        : `★实测拿不到读数：${measured.error || '未知原因'}（不许当"未知也算过"）`);
T('★判据真的全绿（fail 0）', measured.fail === 0,
    measured.pass ? `实测 pass ${measured.pass} · fail ${measured.fail}` : `★未实测：${measured.error || '未知原因'}`);
T('STATE 冒烟 = README 冒烟', state.smoke !== null && readmeSmoke !== null && clean(state.smoke).includes(readmeSmoke.replace(/,/g, '')),
    `STATE ${state.smoke} · README ${readmeSmoke}`);
T('STATE 构建号 = 源码', state.panelBuild === panelBuild, `STATE ${state.panelBuild} · 源码 ${panelBuild}`);
T('STATE CSS 号 = 源码', state.cssVersion === cssVersion, `STATE ${state.cssVersion} · 源码 ${cssVersion}`);
T('STATE 提示词号 = 源码', state.mainPromptV === mainPromptV, `STATE ${state.mainPromptV} · 源码 ${mainPromptV}`);
T('STATE 行数 = 实测', firstNum(state.webIndexLines) === String(webIndexLines), `STATE ${state.webIndexLines} · 实测 ${webIndexLines}`);

// R3 index.json 不能过期（--check 下：内容不等即红）
//   ★比的是**与环境无关的那一份**（落盘对象本身就没有本机路径/时间 ⇒ 导出件里也能逐字节相等）。
//   ★★leg106：报红时**必须说清差在哪**——本棒在这一条上盲修了三轮（"不等"两个字没有任何信息量）。
//     ⇒ 定稿：逐字段 diff 出**前 5 处**不一致（含路径与两侧的值），并且**把卷宗摘要打出来**
//       （legs 条数 / 各段字节）——**判据报红要能自己指路**，这条与"用户的一张截图 > 十条推演"同源。
const INDEX_PATH = path.join(ROOT, 'docs/index.json');
const indexJsonText = JSON.stringify(index, null, 2) + '\n';
if (CHECK_ONLY) {
    const onDisk = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, 'utf8') : '';
    let diffNote = '（缺）';
    if (onDisk) {
        const a = JSON.parse(onDisk);
        const b = JSON.parse(indexJsonText);
        const diffs = [];
        const cmp = (x, y, p) => {
            if (diffs.length >= 5) return;
            if (typeof x !== typeof y) { diffs.push(`${p}: 类型不同`); return; }
            if (x && y && typeof x === 'object') {
                for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) cmp(x[k], y[k], `${p}.${k}`);
                return;
            }
            if (x !== y) diffs.push(`${p}: 盘上 ${JSON.stringify(x)} ≠ 本算 ${JSON.stringify(y)}`);
        };
        cmp(a, b, '');
        const brief = (o) => Object.entries(o).map(([k, v]) => `${k}=${v && typeof v === 'object' ? (Array.isArray(v) ? `[${v.length}]` : '{…}') : JSON.stringify(v)}`).join(' ');
        diffNote = diffs.length
            ? `（盘上 ${onDisk.length}B / 本算 ${indexJsonText.length}B；${diffs.join(' ｜ ')}）`
            : `（逐字段相同但字节不同 ⇒ 多半是换行/BOM；盘上 ${onDisk.length}B / 本算 ${indexJsonText.length}B）`;
        diffNote += ` ｜ 摘要：${brief({ legs: a.legs, docs: a.docs })} → 本算 ${brief({ legs: b.legs, docs: b.docs })}`;
    }
    T('docs/index.json 未过期', !!onDisk && onDisk === indexJsonText, diffNote);
}

// R8 ★★leg124：**生成物不许声称"远端已经发布到哪一版"**（它没有网络，替它说话的必须是那个常数）。
//   病：`release.publishedBuild` 读的是**本地** `PANEL_BUILD` ⇒ 生成物把"本地号"讲成了"已发布号"，
//     而真正的发布点在人核过的 `STATE.md` §1 里（今天两者差 18 个版本）。
//   ★先证红（本仓规矩）：leg124 动这一格时**故意先把旧键名留着跑了一次** —— 下面这两条当场报红，
//     证明守门咬得住自己，然后才把键名改成真话（`sourceBuild` / `published`）。
const releaseKeys = entriesDeep(index.release).map(([p]) => p.split('.').pop());
const badReleaseKey = releaseKeys.find((k) => FORBIDDEN_RELEASE_KEYS.includes(k));
T('★release 块不含"把本地号说成已发布号"的键名', !badReleaseKey,
    badReleaseKey ? `发现 \`${badReleaseKey}\` —— 它就是"读源码的本地号却挂着远端口径的名字"：`
        + `改成 sourceBuild（本地产物）＋ published（人核过的发布点），见本脚本顶部 PUBLISHED_BUILD 的留档`
        : `禁词 ${FORBIDDEN_RELEASE_KEYS.join(' / ')} 均不在`);
T('★已发布号 = 独立常数（不是现读源码的构建号）', index.release.published?.build === PUBLISHED_BUILD,
    `published.build ${index.release.published?.build ?? '（缺这一格）'} · 常数 ${PUBLISHED_BUILD}`
    + ` · 源码 ${panelBuild}${panelBuild === PUBLISHED_BUILD ? '（两者相同：本地这一版就是发布的那一版）' : '（不同：本地有未发布的版本）'}`);

// R9 ★★★（2026-09-24 立）：**"活儿在哪"那一格必须在，而且只许有一份**。
//   病（用户连着打断四次的那件事）：**说清"哪儿没闭环"的东西一直躺着，可没有一处告诉接手的人"现在做哪一件"**
//     ⇒ 接手的人把清单背得出来，却**必须回头问用户一遍**才能开工；而"大活"这两个字全仓只有 4 处提到、
//     且全都是在**指路**（没有一处写出它是什么）⇒ 照字面搜，永远搜不到。
//   治法：`STATE.md` 的 **§0.5** 是"用户最后一道令"唯一的家 ＋ 批次表是"还剩哪些活"唯一的家，
//     两边都**带日期、带指针**，且都在文件里**看得见**（这就是本守门要咬的东西）。
//   ★它咬的是**结构**（在不在、带没带日期、指针通不通），**不是"人有没有读懂"**——后者只能由人保证。
const stateSec05 = (() => {
    const i = stateText.indexOf('## 0.5');
    const j = stateText.indexOf('## 1. ★★');
    return i >= 0 && j > i ? stateText.slice(i, j) : '';
})();
T('★STATE.md 有"活儿在哪"那一格（§0.5）', !!stateSec05, stateSec05 ? `${stateSec05.length} 字` : '（缺 —— 接手的人又会不知道现在做什么）');
T('★那一格带日期（不许是无日期的旧令）', /用户最后一道令[\s\S]{0,200}?\d{4}-\d{2}-\d{2}/.test(stateSec05),
    /用户最后一道令[\s\S]{0,200}?\d{4}-\d{2}-\d{2}/.test(stateSec05) ? '带' : '没带（旧令会冒充新令）');
//   ★★R9 后来收窄过一次（本笔实测）：**原来要求 `STATE.md` §0.5 上写的"没做 N · 做了一半 M"与批次表逐字相同**
//     ——那条规矩**逼着人把数字抄两处**，而"还剩哪些"其实横跨两份文件（批次表 ＋ `STATE.md` §3），
//     抄出来的数字**当场自相矛盾**（本笔第一版就是这样）。⇒ 改成咬**指针**：指向在不在、指向的那份在不在、
//     批次表有没有三态状态栏。**判据要咬"有没有两处真相"，不是逼人造出第二处。**
const planPath = 'docs/session-handoff-2026-09-22-leg109b-defects.md';
const planText = exists(planPath) ? read(planPath) : '';
T('★那一格指向的批次表存在', !!planText, exists(planPath) ? planPath : `缺 ${planPath}`);
const planRows = planText.split('\n').filter((l) => /^\|\s*\*\*第 \d 批\*\*/.test(l) || /^\|\s*\*\*随时\*\*/.test(l));
const planTodo = planRows.filter((l) => l.includes('⬜')).length;
const planHalf = planRows.filter((l) => l.includes('△')).length;
const planDone = planRows.filter((l) => l.includes('✔')).length;
T('★批次表在（且带三态状态栏）', planRows.length >= 7 && planTodo + planHalf + planDone > 0,
    `${planRows.length} 行 · 已办结 ${planDone} · 做了一半 ${planHalf} · 没做 ${planTodo}`);
const workText = exists('docs/work-current.md') ? read('docs/work-current.md') : '';
T('★"活儿在哪"那一格与"当前活儿"那份文件**互相指得到**',
    stateSec05.includes('work-current') && workText.includes('批次表') && workText.includes('用户最后一道令'),
    stateSec05.includes('work-current') ? '两边都有指针' : 'STATE 那边缺 work-current 指针');
//   ★**只管最近的交接**：`STATE.md` §0.5 那一格是 2026-09-24 才立的，老交接（leg106 之前那批）
//     当时无从指向它——"不修正过去、只标注过去"是本仓既有纪律（`START-HERE`/`LEDGER` 就是那么办的）。
const HANDOFF_ENTRY_SINCE = 106;
const recentHandoffs = handoffRoot.filter((f) => (handoffLegOf(f) ?? 0) >= HANDOFF_ENTRY_SINCE);
T('★最近每一份交接都指向那一个入口（§0.5）',
    recentHandoffs.length > 0 && recentHandoffs.every((f) => read(`docs/${f}`).includes('STATE.md')),
    recentHandoffs.filter((f) => !read(`docs/${f}`).includes('STATE.md')).slice(0, 3).join(' · ')
    || `leg${HANDOFF_ENTRY_SINCE} 起 ${recentHandoffs.length} 份全部指向`);

// R10 ★★★（2026-09-24 立）：**知识索引必须与源文件同步**（用户唯一那道令：
//   「让所有知识立即可查，更新知识方便，接手上手快」）。
//   病：知识散在 200 多份文档里，**每一份都可能过期**，而"哪一份是现状"从来没写下来过
//     ⇒ 接手的人只能一份份读，读完还是不敢确定。
//   治法：`scripts/build-kb.mjs` 把知识抽成卡片（**每张都指得出源文件:行号**），产 `docs/kb.json` /
//     `docs/kb-search.html` / `docs/kb-index.md`，并带一枚指纹（源文件内容 ＋ 抽卡代码，两样一起哈希）。
//   ★本条咬的正是那枚指纹：**源文件改过而索引没重生成 ⇒ 红**。这就是"更新知识方便"的兜底——
//     不会有第二份悄悄过期的真相（与 leg106 那条"写死就是第二份真相"同源）。
let kbStamp = null;
let kbNote = '（缺 docs/kb.json：跑 node scripts/build-kb.mjs 生成）';
let kbCheck = { status: 0, stdout: '' };
try {
    const out = execFileSync(process.execPath, ['scripts/build-kb.mjs', '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    kbCheck = { status: 0, stdout: out };
} catch (err) {
    kbCheck = { status: err?.status ?? 1, stdout: String(err?.stdout || '') };   // 退出码非零 ⇒ 过期（脚本自会说明）
}
kbStamp = one(kbCheck.stdout, /现算 ([0-9a-f]+-[0-9a-f]+)/);
const kbCards = one(kbCheck.stdout, /卡 (\d+) 张/);
kbNote = kbCheck.stdout.trim().split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3).join(' ｜ ');
T('★知识索引与源文件同步（改了源文件就重生成）', kbCheck.status === 0 && !!kbStamp,
    kbStamp ? `${kbStamp} · 卡 ${kbCards} 张 ｜ ${kbNote}` : `没有可用的指纹 ｜ ${kbNote}`);
T('★"活儿在哪"那一格指向知识索引与"当前活儿"文件',
    stateSec05.includes('work-current') && (stateSec05.includes('kb-index') || stateSec05.includes('知识索引')),
    stateSec05.includes('work-current') ? '带 work-current' : '缺 work-current 指针');
T('★当前活儿那份文件在（唯一一份）', exists('docs/work-current.md'), exists('docs/work-current.md') ? 'docs/work-current.md' : '缺 docs/work-current.md');
// ★R10 配套（2026-09-24，**同一天我自己踩了两次**）：**生成出来的那份搜索页，脚本必须能编译**。
//   病：`build-kb.mjs` 是用**模板字符串**拼 HTML 的，而页面里那段 JS 本身就可能带反引号
//     ⇒ 一个没转义的反引号会**提前闭合外层模板**（构建期报语法错），或者**悄悄产出一个语法坏掉的页面**
//     （构建成功、守门全绿、浏览器一打开就是白屏）。这正是本仓 leg123 §5 记过的那条坑的"生成物"版本。
//   ★治法：**把生成物里的脚本真编译一次**（`new Function`）——不执行、只编译，炸了就红。
const htmlPath = 'docs/kb-search.html';
let pageJsOk = true;
let pageJsNote = '（缺生成物：跑 node scripts/build-kb.mjs）';
if (exists(htmlPath)) {
    const htmlText = read(htmlPath);
    const segs = [...htmlText.matchAll(/<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    pageJsOk = segs.length > 0;
    try { for (const s of segs) new Function(s); } catch (err) { pageJsOk = false; pageJsNote = `脚本编译不过：${err.message}`; }
    if (pageJsOk) pageJsNote = `页面脚本 ${segs.length} 段可编译`;
    else if (segs.length === 0) pageJsNote = '页面里找不到脚本段';
}
T('★生成的知识搜索页，脚本能编译（防"白屏但守门全绿"）', pageJsOk, pageJsNote);

// R4 交接链：最新交接的 leg 不许落后台账最新 leg 太多
W('最新交接 leg ≥ 台账最新 leg − 1', newestHandoffLeg !== null && latestLeg !== null && newestHandoffLeg >= latestLeg.leg - 1,
    `交接 leg${newestHandoffLeg} · 台账 leg${latestLeg && latestLeg.leg}`);
W('两处交接目录无同名', dupHandoffs.length === 0, dupHandoffs.join(', '));

// R5 台账行长度（LEDGER.md 是索引，一行就该是一行）
const ledgerIndexLines = exists('LEDGER.md') ? read('LEDGER.md').split('\n') : [];
const longIdx = ledgerIndexLines.filter((l) => l.startsWith('| 20') && l.length > 200).length;
W('LEDGER.md 每行 ≤ 200 字符', longIdx === 0, `${longIdx} 行超长（它是索引，不是第二份台账）`);

// R6 历史文件带墓碑（被点名要求"接手先读"的化石，必须自己说清自己是化石）
const tomb = (p, needle) => exists(p) && read(p).slice(0, 1200).includes(needle);
W('docs/START-HERE.md 有墓碑', tomb('docs/START-HERE.md', '已冻结'));
W('LEDGER.md 有墓碑', tomb('LEDGER.md', '已冻结'));
W('ANCHOR.md 有墓碑', tomb('ANCHOR.md', '已冻结'));

// R7 ★★leg108：**入口不许再长**（治"一堆文档都自称'先读我'"）
//   病（leg108 实测）：`docs/` 里有 90 处出现「接手第一件事 / 接手先读」这类话，其中多数还指向
//   **已冻结**的 `START-HERE.md`——而它那一行「下一动作」停在 leg59（落后 48 棒）⇒ 一个陌生读者
//   随便点开一份交接，就有很大概率被指到 48 棒前的地方；正确的那扇门（`STATE.md`）只在 3 处被点名。
//   ★治法照本仓两条既有纪律：**不修正过去、只标注过去**（历史文件原地不动，本检查一个字都不改它们）
//     ＋ **计数棘轮**（先例：`test/ledger-shape.test.js` 那条——只钉"现在有几份"，新写的多一份就红）。
//   ★排除两类：①台账（`docs/ledger.md` / `LEDGER.md`）——它们**引用历史原话**，不是入口；
//     ②`STATE.md`——它自己就是那个唯一入口。
const ENTRY_CLAIM = /接手第一件事|接手先读|接手前必读|先读这份|接手第一入口/;
const ENTRY_POINTER = /STATE\.md|已冻结|唯一活入口|唯一入口/;
const listMd = (dir, acc = []) => {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return acc;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) listMd(rel, acc);
        else if (/\.md$/.test(e.name)) acc.push(rel);
    }
    return acc;
};
const ENTRY_SKIP = new Set(['STATE.md', 'docs/ledger.md', 'LEDGER.md']);
const competing = listMd('docs').concat(exists('ANCHOR.md') ? ['ANCHOR.md'] : [])
    .filter((p) => !ENTRY_SKIP.has(p))
    .filter((p) => { const t = read(p); return ENTRY_CLAIM.test(t) && !ENTRY_POINTER.test(t); });
// ★棘轮基线：leg108 现量的存量 **83 份**（全是历史交接/细案，**原地不动**）。只许减不许增——
//   新写的一份若自称"先读我"却不说清"看 STATE.md"，这份数就会涨 ⇒ 当场红
//   （照 `test/ledger-shape.test.js` 那条先例：只钉"现在有几份"，不钉行号/签名）。
//   ★两头都钉：**涨 = 红**（新写的犯规）· **降 = 黄**（有人给化石补了指向语 ⇒ 请把基线下调，
//     否则棘轮白松一格）。
const ENTRY_BASELINE = 83;
T('★没有新增的"先读我"入口（计数棘轮）', competing.length <= ENTRY_BASELINE,
    `${competing.length} 份 / 基线 ${ENTRY_BASELINE}`
    + (competing.length > ENTRY_BASELINE ? ` · 新增：${competing.slice(0, 5).join(' · ')}` : ''));
W('棘轮没白松（存量降了就把基线下调）', competing.length === ENTRY_BASELINE,
    `${competing.length} 份 ≠ 基线 ${ENTRY_BASELINE} ⇒ 把 ENTRY_BASELINE 改成 ${competing.length}`);
T('★最新交接指向唯一入口', !!newestHandoff && ENTRY_POINTER.test(read(`docs/${newestHandoff}`)),
    `最新交接 ${newestHandoff}`);

// ── ⑧ 落地 ────────────────────────────────────────────────────────
if (!CHECK_ONLY) fs.writeFileSync(INDEX_PATH, indexJsonText, 'utf8');

const summary = {
    ok: reds.length === 0,
    reds, yellows, passes,
    counts: {
        handoffsRoot: handoffRoot.length, handoffsArchive: handoffArchive.length,
        ledgerRows: legRows.length, latestLeg: latestLeg ? latestLeg.leg : null,
        docsFiles: docsSize.files,
    },
};

if (AS_JSON) {
    console.log(JSON.stringify(summary, null, 2));
} else {
    console.log(`story-world-v2 · 文档守门（${CHECK_ONLY ? '--check 只核对' : '并生成 docs/index.json'}）`);
    console.log(`  真源：PANEL_BUILD ${panelBuild} · CSS ${cssVersion} · 提示词 ${mainPromptV} · web/index.js ${webIndexLines} 行`);
    console.log(`  STATE.md ${stateBytes} 字节 · docs/ ${docsSize.files} 文件 · 台账 ${legRows.length} 行（最新 leg${latestLeg ? latestLeg.leg : '?'}）`);
    console.log(`  ★判据（现跑 node --test）：${measured.pass === undefined || measured.pass === null ? `拿不到读数（${measured.error || '未知原因'}）` : `${measured.pass}/${measured.pass} · fail ${measured.fail}`}`);
    console.log(`  交接：docs/ ${handoffRoot.length} 份（最新 ${newestHandoff}）· docs/handoffs/ ${handoffArchive.length} 份`);
    // ★只报告、不落盘：这两项"问本机"（git / 绝对路径）⇒ 写进 index.json 会让发布件不可复现（见 §⑥ 的留档）。
    console.log(`  ★本机专有（不进 index.json）：在 git 仓库里 = ${IN_REPO} · snapshots 被跟踪 = ${IN_REPO ? tracked('snapshots') : '（无 git，不猜）'}`);
    for (const p of passes) console.log(`  ✔ ${p}`);
    for (const y of yellows) console.log(`  ⚠ ${y}`);
    for (const r of reds) console.log(`  ✘ ${r}`);
    console.log(`\n守门结果：${reds.length === 0 ? 'PASS' : `FAIL（${reds.length} 条红）`} · 黄 ${yellows.length} 条`);
}
process.exit(reds.length === 0 ? 0 : 1);
