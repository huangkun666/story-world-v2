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

const panelBuild = one(src.renderBase, /export const PANEL_BUILD = '([^']+)'/);
const cssVersion = one(src.webIndex, /const CSS_VERSION = '([^']+)'/);
const mainPromptV = one(src.prompts, /export const MAIN_PROMPT_V = '([^']+)'/);
const panelVersion = one(src.webIndex, /const VERSION = '([^']+)'/);
const webIndexLines = src.webIndex.split('\n').length;
const readmeTests = (src.readme.match(/本版：(\d+)\s*\/\s*(\d+)/) || []).slice(1, 3);
const readmeSmoke = one(src.readme, /终态\s*([\d,]+)\s*字节/);

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
        publishedBuild: 'leg103-switchglow',
        publishedTag: 'v1.0.0-preview.1',
        publishedTagCommit: '1a54424',
        note: '发布面读数在 leg106 之前靠人记；远端真值用 node scripts/verify-release.mjs 核。',
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
T('STATE.md 不含按棒存档段', !/^> 🛑 20/m.test(stateText) && !/·\s*两笔\s*·/.test(stateText));

// R2 STATE.md §1 与生产真源逐项相同（★这是"消灭读数多副本"的那一刀）
T('STATE 判据 = README 判据', !!stateTests && !!readmeTests.length && stateTests[1] === readmeTests[0] && stateTests[2] === readmeTests[1],
    `STATE ${stateTests && stateTests[0]} · README ${readmeTests.join('/')}`);
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
    console.log(`  交接：docs/ ${handoffRoot.length} 份（最新 ${newestHandoff}）· docs/handoffs/ ${handoffArchive.length} 份`);
    // ★只报告、不落盘：这两项"问本机"（git / 绝对路径）⇒ 写进 index.json 会让发布件不可复现（见 §⑥ 的留档）。
    console.log(`  ★本机专有（不进 index.json）：在 git 仓库里 = ${IN_REPO} · snapshots 被跟踪 = ${IN_REPO ? tracked('snapshots') : '（无 git，不猜）'}`);
    for (const p of passes) console.log(`  ✔ ${p}`);
    for (const y of yellows) console.log(`  ⚠ ${y}`);
    for (const r of reds) console.log(`  ✘ ${r}`);
    console.log(`\n守门结果：${reds.length === 0 ? 'PASS' : `FAIL（${reds.length} 条红）`} · 黄 ${yellows.length} 条`);
}
process.exit(reds.length === 0 ? 0 : 1);
