// story-world-v2/scripts/build-kb.mjs
// ★★★ 目的（用户 2026-09-24 的唯一任务，原话）：
//   「**让所有知识立即可查，更新知识方便，接手上手快，现在已经有骨架了**」
//
// 这个脚本干的事，一句话：**把散在仓里各处的知识，抽成一份可搜索的卡片清单**——
//   ① 每一张卡片都**指得出源文件与行号**（所以它不会替源文件撒谎）；
//   ② 索引**从真源现抽**（不是人手抄），所以"更新知识"= 改一次源文件、重跑一次；
//   ③ 产物里带一枚**代码指纹**：抽卡的代码一改、源文件一改，指纹就变
//      ⇒ 守门 R10 当场判红"索引过期了"，**不会有第二份悄悄过期的真相**（本仓 leg106 那条纪律的落点）。
//
// 产出（全部是生成物，**别手改**）：
//   · `docs/kb.json`          —— 机器可读：卡片 + 事实摘要 + 指纹（给 AI/脚本查）
//   · `docs/kb-search.html`   —— 人用：一个搜索框，浏览器直接打开就能搜（零依赖、离线可用）
//   · `docs/kb-index.md`      —— 人/AI 都能读的目录页（`STATE.md` §0.5 指向它）
//
// 口径（照本仓红线）：
//   · **只读**生产文档与源码，**只写**上面那三个文件；不碰工作区其它任何字节；
//   · 卡片**只抽"能在源文件里指到行"的东西**，不编、不总结成第二份真相；
//   · 中文一律经 Node 读写（铁律：别用 PowerShell 碰含中文的文件）。
//
// 用法：`node scripts/build-kb.mjs`（无参）· `--check`：只对指纹，不写文件（守门/交接收尾用）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_JSON = path.join(ROOT, 'docs/kb.json');
const OUT_HTML = path.join(ROOT, 'docs/kb-search.html');
const OUT_MD = path.join(ROOT, 'docs/kb-index.md');
const CHECK_ONLY = process.argv.includes('--check');

const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const lines = (rel) => read(rel).split('\n');

// ── 卡片 ────────────────────────────────────────────────────────────
// 一张卡片 = 一件"能立刻查到"的知识：它是什么、在哪（文件:行）、怎么找它（关键词）。
const cards = [];
// ★可搜索的字从哪来（这是"立即可查"的命门）：一张卡只有一句摘要 ⇒ 搜"世界步契约"这种**多字词**永远空手。
//   ⇒ 给**每一张**卡自动带上**它那一份文件的章节名**（`##` 标题就是人自己写的最好的一份关键词表），
//     再带上文件名与路径。代价是索引大一点（几十 KB），换来的是"按记得的词就能找到"。
const headingsCache = new Map();
function headingsOf(rel) {
    if (headingsCache.has(rel)) return headingsCache.get(rel);
    // ★只对**文件**读：有几张卡的 `src` 是**目录**（`test/`、`docs/handoffs/` 这类指针卡）——
    //   对着目录 readFileSync 会当场 EISDIR（本笔实测抓到的），所以先 stat 一次再读。
    const abs = path.join(ROOT, rel);
    const isFile = exists(rel) && fs.statSync(abs).isFile();
    const out = isFile
        ? lines(rel)
            .filter((l) => /^#{1,3}\s/.test(l))
            .map((l) => l.replace(/^#{1,3}\s*/, '').replace(/[*`★→]/g, '').trim())
            .filter((s) => s && s.length <= 40)
        : [];
    headingsCache.set(rel, out);
    return out;
}
// 给一张卡补"可搜的面"：文件名 ＋ 路径各段 ＋ 它那份文件的章节名（去重、限量，别把卡撑爆）
function withHeadings(card) {
    if (!card || !card.src) return card;
    const dirs = card.src.split('/');
    const keys = [...new Set([...(card.keys || []), ...dirs, ...headingsOf(card.src)])];
    return { ...card, keys: keys.slice(0, 120) };
}
const push = (o) => { if (o && o.id && o.title && o.src) cards.push(withHeadings(o)); };

// ① 入口与规矩：`STATE.md` 的分段（§1 当前值 / §2 红线 / §3 活清单 / §5 现场与发布）
if (exists('STATE.md')) {
    const ls = lines('STATE.md');
    let sec = null;
    ls.forEach((l, i) => {
        const m = /^##\s+(.+)$/.exec(l);
        if (m) {
            if (sec) sec.end = i;                       // 上一段到此为止
            sec = { title: m[1].replace(/[*★]/g, '').trim(), start: i + 1, end: ls.length };
            const body = ls.slice(sec.start, sec.start + 6).join('\n');
            push({
                id: `state#${sec.title.slice(0, 6)}`,
                title: `STATE.md · ${sec.title}`,
                kind: '入口/规矩',
                src: 'STATE.md',
                line: sec.start,
                where: body.split('\n').find((x) => x.trim() && !x.startsWith('#'))?.slice(0, 120) || '',
                keys: ['STATE', '入口', '接手', sec.title.slice(0, 12)],
            });
        }
    });
}

// ② 活儿：用户最后一道令 ＋ 最近几道令 ＋ 还剩哪些（`docs/work-current.md`：唯一一份）
if (exists('docs/work-current.md')) {
    const ls = lines('docs/work-current.md');
    const i = ls.findIndex((l) => l.includes('用户最后一道令'));
    const cmd = ls.slice(i, i + 12).find((l) => /^>\s*\*\*\d{4}-\d{2}-\d{2}/.test(l.trim())) || '';
    push({
        id: 'work#current', title: '现在做什么（用户最后一道令 · 逐字）', kind: '活儿',
        src: 'docs/work-current.md', line: Math.max(1, i + 1),
        where: cmd.replace(/^>\s*/, '').slice(0, 200),
        keys: ['现在做什么', '当前活儿', '最后一道令', '待办', '大活'],
    });
    const j = ls.findIndex((l) => l.includes('最近几道令'));
    push({
        id: 'work#history', title: '最近几道令（倒序 · 一行一道 ＋ 落点）', kind: '活儿',
        src: 'docs/work-current.md', line: Math.max(1, j + 1),
        where: ls.slice(j, j + 7).filter((l) => /^[0-9]\.|^\d\./.test(l.trim())).map((l) => l.replace(/[*「」]/g, '').trim()).join(' ／ ').slice(0, 220),
        keys: ['最近几道令', '历史命令', '从前要什么'],
    });
    push({
        id: 'work#rest', title: '还剩哪些活儿（批次表指针 ＋ 怎么用）', kind: '活儿',
        src: 'docs/work-current.md', line: 1,
        where: (ls.find((l) => l.includes('唯一一份批次表')) || '').replace(/[*★]/g, '').slice(0, 160),
        keys: ['还剩哪些', '没做', '做了一半', '批次', '清单'],
    });
}

// ③ 活儿总表：`leg109b` 那张批次表（全仓唯一一份，逐批一张卡）
const PLAN = 'docs/session-handoff-2026-09-22-leg109b-defects.md';
if (exists(PLAN)) {
    lines(PLAN).forEach((l, i) => {
        const m = /^\|\s*\*\*(第 \d 批|随时)\*\*\s*\|\s*(.+?)\s*\|/.exec(l);
        if (!m) return;
        const st = l.includes('✔') ? '已办结' : (l.includes('△') ? '做了一半' : '没做');
        push({
            id: `plan#${m[1]}`, title: `批次 ${m[1]} · ${st}`,
            kind: '活儿', src: PLAN, line: i + 1,
            where: m[2].replace(/[*～~]/g, '').slice(0, 160),
            keys: ['批次', m[1], st, '没做', '做了一半', '已办结'],
        });
    });
    // 四个待拍板项也各一张（它们是"顺序定不死"的原因）
    lines(PLAN).forEach((l, i) => {
        const m = /^\|\s*\*\*(\d)\*\*\s*\|\s*\*\*(.+?)\*\*\s*\|/.exec(l);
        if (!m) return;
        push({
            id: `ask#${m[1]}`, title: `待拍板 ${m[1]} · ${m[2].replace(/[*]/g, '')}`,
            kind: '待拍板', src: PLAN, line: i + 1, where: '',
            keys: ['待拍板', '要定什么', m[2].slice(0, 20)],
        });
    });
}

// ④ 缺口的十七条（A1–E3）：一条一张 —— ★只在 **§2「我另补的 13 条」那一节里**抽
//   （同一份文件后面还有几张编号重复的表：§4 的四个待拍板项、§5 的落点表 ⇒ 不划范围就会抽重）
if (exists(PLAN)) {
    const ls = lines(PLAN);
    const s = ls.findIndex((l) => /^##\s*2\./.test(l));
    const e = ls.findIndex((l, i) => i > s && /^##\s/.test(l));
    for (let i = s; i >= 0 && i < (e < 0 ? ls.length : e); i += 1) {
        const m = /^\|\s*\*\*([A-E]\d)\*\*\s*\|\s*(.+?)\s*\|/.exec(ls[i]);
        if (!m) continue;
        push({
            id: `gap#${m[1]}`, title: `缺口 ${m[1]}`,
            kind: '缺口', src: PLAN, line: i + 1,
            where: m[2].replace(/[*`]/g, '').slice(0, 200),
            keys: ['缺口', m[1]],
        });
    }
}

// ⑤ 交接与细案：每份一张（leg 号 / 日期 / 标题 / 它是什么），关键词自动带上细案号与标题词
const listMd = (dir) => (exists(dir) ? fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.md')) : []);
const firstHeading = (rel) => {
    const l = lines(rel).find((x) => x.startsWith('# '));
    return l ? l.replace(/^#\s+/, '').replace(/[*★]/g, '').trim() : rel;
};
for (const f of listMd('docs')) {
    const rel = `docs/${f}`;
    if (/^session-handoff-/.test(f)) {
        const leg = (/leg(\d+)/.exec(f) || [])[1] || '';
        const date = (/session-handoff-(\d{4}-\d{2}-\d{2})/.exec(f) || [])[1] || '';
        // ★交接那份的摘要给"它有哪些节"（章节名就是人写的最好的关键词表）——
        //   比只写第一行标题有用得多：搜"踩的坑""别做的事"能直接命中相应的交接。
        const hs = headingsOf(rel).filter((s) => s.length <= 24).slice(0, 8).join(' ／ ');
        push({
            id: `handoff#${leg || f}`, title: `交接 leg${leg}（${date}）`,
            kind: '交接', src: rel, line: 1,
            where: (hs || firstHeading(rel)).slice(0, 200),
            keys: ['交接', `leg${leg}`, date, '做了什么', 'history'],
        });
    } else if (/^spec-/.test(f)) {
        push({
            id: `spec#${f.replace(/^spec-|\.md$/g, '')}`, title: `细案 ${f.replace(/^spec-|\.md$/g, '')}`,
            kind: '细案', src: rel, line: 1, where: firstHeading(rel).slice(0, 200),
            keys: ['细案', '设计', 'spec', f.replace(/^spec-|\.md$/g, '')],
        });
    }
}
// 细案目录（kb 之外的）：`docs/superpowers/specs/*` 与 `docs/handoffs/*` 只列指针，不逐张抽
for (const dir of ['docs/superpowers/specs', 'docs/handoffs']) {
    const n = listMd(dir).length;
    if (!n) continue;
    push({
        id: `dir#${dir}`, title: `${dir}/（${n} 份旧档）`, kind: '索引', src: dir, line: 1,
        where: '旧档目录（历史，不是现状）；逐份细节在那里，现状一律看 STATE.md §1',
        keys: ['旧档', '归档', '历史', dir],
    });
}

// ⑥ 机制知识：`kb/` 九页（骨架是用户搭的，这里只做**指针卡**，不搬内容）
const KB_PAGES = ['00-index', '01-overview', '02-architecture', '03-ledger-ssot', '04-source-map',
    '05-web-panel', '06-parameters', '07-decisions', '08-testing-tooling', '09-glossary'];
for (const p of KB_PAGES) {
    const rel = `kb/${p}.md`;
    if (!exists(rel)) continue;
    push({
        id: `kb#${p}`, title: `知识库 ${p} · ${firstHeading(rel).replace(/^\d+\s*·\s*/, '').slice(0, 60)}`,
        kind: '知识库', src: rel, line: 1,
        where: '（★快照：冲突时以代码为准；当前值只看 STATE.md §1）',
        keys: ['知识库', 'kb', p],
    });
}
if (exists('kb/kb-index.json')) {
    push({
        id: 'kb#machine', title: '知识库机器可读索引（kb-index.json）', kind: '知识库',
        src: 'kb/kb-index.json', line: 1,
        where: '文件 / 符号 / 术语 / 决策 / 红线 / 流水线阶段（★快照，会过期）',
        keys: ['知识库', '索引', '术语', '符号'],
    });
}

// ⑦ 当前值：从 STATE §1 那张表**逐行**抽（每格一张卡，指得到那一行）
if (exists('STATE.md')) {
    const ls = lines('STATE.md');
    const start = ls.findIndex((l) => l.startsWith('| 读数 |'));
    if (start >= 0) {
        for (let i = start + 2; i < ls.length && ls[i].startsWith('|'); i += 1) {
            const cells = ls[i].split('|').map((s) => s.trim());
            if (cells.length < 4) continue;
            const name = cells[1].replace(/[*`]/g, '');
            if (!name) continue;
            push({
                id: `value#${name.slice(0, 8)}`, title: `当前值 · ${name}`,
                kind: '当前值', src: 'STATE.md', line: i + 1,
                where: `${cells[2].slice(0, 120)} ｜ 复量：${cells[3].slice(0, 80)}`,
                keys: ['当前值', '读数', '判据', '构建号', '行数', name.slice(0, 10)],
            });
        }
    }
}

// ⑧ 跑法：三行命令（判据/冒烟/守门）—— 新人第一件要会的事
push({
    id: 'how#verify', title: '怎么验证（三条命令，都在插件目录内跑）', kind: '怎么跑',
    src: 'STATE.md', line: lines('STATE.md').findIndex((l) => l.includes('node --test')) + 1 || 1,
    where: 'node --test（全量判据，无参）· node demo/smoke-demo.js（50 轮冒烟）· node scripts/audit-docs.mjs（文档守门）',
    keys: ['怎么跑', '验证', '测试', '命令', 'node --test', '冒烟'],
});
push({
    id: 'how#release', title: '怎么发布（导出独立根树 → 仓外跑判据冒烟 → 推 → 远端逐字节核）', kind: '怎么跑',
    src: 'scripts/publish-release.mjs', line: 1,
    where: 'node scripts/publish-release.mjs（推）· node scripts/verify-release.mjs（远端只读终检）',
    keys: ['怎么发布', '发布', 'release', 'tag', '推送'],
});

// ⑨ 代码地图：`src/` 与 `web/` 逐文件（读每个文件的头注第一句，**不编**）
const jsFiles = (dir) => (exists(dir) ? fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.js')) : []);
for (const [dir, kind] of [['src', '代码地图'], ['web', '代码地图']]) {
    for (const f of jsFiles(dir)) {
        const ls = lines(`${dir}/${f}`);
        const head = ls.slice(0, 6).map((s) => s.trim())
            .filter((s) => s.startsWith('//') && !/^\/\/\s*$/.test(s))
            .map((s) => s.replace(/^\/\/\s*/, ''))[0] || '';
        push({
            id: `file#${dir}/${f}`, title: `${dir}/${f}`,
            kind, src: `${dir}/${f}`, line: 1,
            where: head.replace(/[*★]/g, '').slice(0, 140),
            keys: ['文件', '代码', dir, f.replace(/\.js$/, '')],
        });
    }
}
// 测试文件：只给一族一张（避免 105 张噪音），但**逐个文件名进关键词**（搜得到）
if (exists('test')) {
    const ts = fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.test.js'));
    push({
        id: 'test#all', title: `判据在哪（test/ 共 ${ts.length} 个 *.test.js）`, kind: '代码地图',
        src: 'test', line: 1,
        where: '全量跑 node --test（无参，必须在插件目录内）；按子系统分组见 kb/08-testing-tooling.md',
        keys: ['测试', '判据', 'test', ...ts.map((f) => f.replace(/\.test\.js$/, ''))],
    });
}

// ── 事实摘要（给"接手上手快"用：一眼看清这仓是什么、多大、最近干了什么）───
const countDirs = (dir, ext) => (exists(dir) ? fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(ext)).length : 0);
const lastCommits = (() => {
    try {
        return execFileSync('git', ['log', '--oneline', '-12'], { cwd: path.join(ROOT, '..'), encoding: 'utf8' })
            .trim().split('\n');
    } catch { return []; }                                  // 导出件没有 git ⇒ 如实留空，不猜
})();
const kv = (rel, re) => {
    const t = exists(rel) ? read(rel) : '';
    const m = re.exec(t);
    return m ? m[1] : null;
};
const facts = {
    what: '跑在 SillyTavern 里的"活世界引擎"：世界书只读 · 引擎记账（账房＋史官） · LLM 只提议与执笔',
    panelBuild: kv('src/render-base.js', /export const PANEL_BUILD = '([^']+)'/),
    mainPromptV: kv('src/prompts.js', /export const MAIN_PROMPT_V = '([^']+)'/),
    cssVersion: kv('web/index.js', /const CSS_VERSION = '([^']+)'/),
    version: kv('web/index.js', /const VERSION = '([^']+)'/),
    srcModules: countDirs('src', '.js'),
    webModules: countDirs('web', '.js'),
    tests: countDirs('test', '.test.js'),
    demos: countDirs('demo', '.js'),
    docs: countDirs('docs', '.md'),
    latestHandoff: (exists('docs') ? fs.readdirSync(path.join(ROOT, 'docs'))
        .filter((f) => /^session-handoff-/.test(f)).sort().pop() : null),
    lastCommits,
};

// ── 指纹：抽卡代码本身 ＋ 每一份被抽的源文件的内容 ─────────────────────
// ★为什么要两样：只哈希内容 ⇒ 我改了抽卡逻辑（比如少抽一类卡）而源文件没动，指纹不变 ⇒ 索引悄悄失真；
//   只哈希代码 ⇒ 源文件改了它也不知道。两个一起哈希，才是"索引真的跟得上"。
function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i += 1) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}
const SELF = 'scripts/build-kb.mjs';
const sources = [...new Set(cards.map((c) => c.src))]
    .filter((s) => exists(s) && fs.statSync(path.join(ROOT, s)).isFile())
    .sort();
// ★★（发布阻塞勘正 · 2026-09-28）：**哈希基只取"进得了发布树"的源文件**。
//   病（实测，发布流程自 leg122 起就是断的，直到本笔才发现）：`kb/` 被仓库根 `.gitignore`
//     挡在版本管理外（用户 2026-09-24 令「kb 不要进 git」），而 `publish-release.mjs` 是用
//     `git read-tree` 把子树导成**独立根树**的 ⇒ `kb/` **不进去**；可这里的指纹却是按
//     "盘上有哪些卡片源文件"算的 ⇒ 同一条提交，工作区算出 `d033988e-…`、导出件算出 `0a62e514-…`
//     （差 11 份 = `kb/` 十页 ＋ `kb-index.json`，数目逐一对得上）⇒ 导出件的守门 R10 **恒红**、推送被拦。
//   ★治法：把不随发布件走的路径从哈希基里剔出去，两处算出来才是同一个指纹。
//     ★卡片本身**照旧**：`kb/` 在就出指针卡、不在就跳过（导出件里本来就不该有指向不存在文件的卡——
//       那正是"指针卡"这个设计的原意，见 ⑥ 那段）。
//   ★新增"不进 git 的目录"时，**必须往 `NON_SHIPPED` 里加一行**（两处名单要以 `.gitignore` 为准对齐）。
const NON_SHIPPED = ['kb/'];
const hashed = sources.filter((s) => !NON_SHIPPED.some((p) => s.startsWith(p)));
const sourceHash = fnv1a(hashed.map((s) => `${s}:${fnv1a(read(s))}`).join('|'));
const codeHash = fnv1a(read(SELF));
const fingerprint = `${sourceHash}-${codeHash}`;

// ── 组装 ────────────────────────────────────────────────────────────
const built = {
    version: 1,
    generatedNote: '★生成物，**别手改**：改源文件或改抽卡代码之后跑 `node scripts/build-kb.mjs`；'
        + '守门 R10 会对指纹，过期即红。',
    fingerprint,
    codeFingerprint: codeHash,
    sourceFingerprint: sourceHash,
    sources,
    facts,
    counts: {
        cards: cards.length,
        byKind: cards.reduce((a, c) => { a[c.kind] = (a[c.kind] || 0) + 1; return a; }, {}),
    },
    cards,
};

const dataJson = JSON.stringify(built, null, 2) + '\n';

// 人读的目录页
const byKind = built.counts.byKind;
const md = [
    '# 知识索引（生成物 · 别手改）',
    '',
    `> 由 \`node scripts/build-kb.mjs\` 从仓里**现抽**：**${cards.length} 张卡**，每一张都指得出**源文件与行号**。`,
    `> 指纹 \`${fingerprint}\`（源文件 ${sourceHash} · 抽卡代码 ${codeHash}）——**对不上就是索引过期**（守门 R10）。`,
    '',
    '**怎么用**：想查什么就搜关键词（`${cards.length}` 张卡全在下面，按类分组）——',
    '机器可读的那份在 `docs/kb.json`，带搜索框的那份在 `docs/kb-search.html`（浏览器直接打开）。',
    '',
    '## 一眼看清这仓',
    '',
    `| 事实 | 值 |`,
    `|---|---|`,
    `| 它是什么 | ${facts.what} |`,
    `| 构建号 | \`${facts.panelBuild}\` |`,
    `| 提示词号 | \`${facts.mainPromptV}\` |`,
    `| 版本 | \`${facts.version}\`（ST 扩展） |`,
    `| 规模 | src **${facts.srcModules}** · web **${facts.webModules}** · 判据 **${facts.tests}** · 探针 **${facts.demos}** · 文档 **${facts.docs}** |`,
    `| 最新交接 | \`${facts.latestHandoff}\` |`,
    '',
    '## 卡片（按类分组）',
    '',
];
for (const kind of Object.keys(byKind)) {
    md.push(`### ${kind}（${byKind[kind]}）`, '');
    md.push('| 卡片 | 在哪 | 是什么 |', '|---|---|---|');
    for (const c of cards.filter((x) => x.kind === kind)) {
        md.push(`| ${c.title} | \`${c.src}:${c.line}\` | ${String(c.where || '').replace(/\|/g, '／').slice(0, 110)} |`);
    }
    md.push('');
}
if (facts.lastCommits.length) {
    md.push('## 最近提交（接手时判"现在到哪一棒了"）', '');
    for (const c of facts.lastCommits) md.push(`- \`${c}\``);
    md.push('');
}
const mdOut = md.join('\n') + '\n';

// 人用的搜索页（零依赖、离线可用：数据直接嵌在页面里）
const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>story-world v2 · 知识索引（可搜）</title>
<style>
 body{font:14px/1.7 system-ui,"Microsoft YaHei",sans-serif;margin:0;background:#16181d;color:#e6e6e6}
 header{padding:14px 18px;background:#1e2127;border-bottom:1px solid #2c313a;position:sticky;top:0}
 h1{font-size:16px;margin:0 0 8px}
 input{width:100%;max-width:520px;padding:9px 12px;font-size:14px;border-radius:8px;border:1px solid #3a4150;background:#11131a;color:#e6e6e6}
 .meta{color:#8b93a3;font-size:12px;margin-top:6px}
 main{padding:14px 18px 60px}
 .card{border:1px solid #2c313a;border-radius:10px;padding:10px 12px;margin:0 0 10px;background:#1b1e25}
 .card h3{margin:0 0 4px;font-size:14px}
 .src{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:#7fb3ff}
 .where{color:#b9c0cd;margin-top:4px;font-size:13px}
 .kind{float:right;color:#8b93a3;font-size:12px}
 mark{background:#ffd76a;color:#111}
</style></head><body>
<header>
 <h1>story-world v2 · 知识索引（生成物 · 别手改）</h1>
 <input id="q" placeholder="搜：判据怎么跑 / 世界步契约 / 批次 / 待拍板 / 某个文件名 / 某个黑话…" autofocus>
 <div class="meta" id="meta"></div>
</header>
<main id="out"></main>
<script id="kb" type="application/json">${JSON.stringify(built)}</script>
<script>
const KB = JSON.parse(document.getElementById('kb').textContent);
const q = document.getElementById('q'), out = document.getElementById('out'), meta = document.getElementById('meta');
meta.textContent = '共 ' + KB.cards.length + ' 张卡 · 指纹 ' + KB.fingerprint + ' · 源文件 ' + KB.sources.length + ' 份（改完源文件跑 node scripts/build-kb.mjs 重新生成）';
function esc(s){return String(s||'').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function hi(s, frags){
  let t = esc(s);
  for (const f of frags) {
    if (!f || f.length < 2) continue;
    try { t = t.replace(new RegExp(f.replace(/[.*+?^\\\${}()|[\\]\\\\]/g, '\\\\$&'), 'gi'), m => '<mark>' + m + '</mark>'); } catch (e) {}
  }
  return t;
}
// ★匹配口径（本笔实测改了两版，两版都栽在"中文长句"上）：
//   第一版"按空白切词、要求全中" ⇒ "世界步契约""判据怎么跑"这种**最自然的问法 0 命中**（中文没空格可切）；
//   第二版"2~3 字片段按比例" ⇒ 查询越长片段越多、比例被稀释 ⇒ 还是 0 命中。
//   ⇒ 定稿：**最长命中片段 ＋ 命中片段数**（人的直觉：你要找的东西里，有一段越长越像就是它），
//     并按"结果会不会太宽"**逐级抬高门槛**（2 字 → 3 字 → 4 字）：搜得笼统就只给最像的，
//     搜得具体就给全 —— 免得满屏命中把"其实只有一条"的东西淹掉。
//   ★再滤掉一张**很小的虚词表**：中文 2 字档上，"的/是/活儿/怎么"这类片段几乎命中所有卡
//     （实测："还没做的活儿" 24 条噪音 ⇒ 加上这张表之后落到个位数）。
const STOP_FRAGS = new Set(['的活', '活儿', '怎么', '什么', '哪些', '这个', '那个', '一个', '我们', '你们',
    '没有', '不是', '就是', '还是', '可以', '需要', '现在', '已经', '因为', '所以', '如果', '但是']);
function fragsOf(s){
  const t = String(s || '').toLowerCase();
  const out = [];
  for (let n = 2; n <= 4; n += 1) for (let i = 0; i + n <= t.length; i += 1) {
        const f = t.slice(i, i + n);
        if (!STOP_FRAGS.has(f)) out.push(f);
    }
  return out;
}
function render(){
  const raw = q.value.trim();
  const whole = raw.toLowerCase();
  let list = KB.cards, got = 0;
  if (whole) {
    const frags = fragsOf(raw);
    const hayOf = (c) => c._hay || (c._hay = (c.title + ' ' + c.kind + ' ' + (c.where || '') + ' ' + c.src
        + ' ' + (c.keys || []).join(' ')).toLowerCase());
    const exact = KB.cards.filter((c) => hayOf(c).includes(whole));
    if (exact.length) { list = exact; got = exact.length; }
    else {
      for (const floor of [2, 3, 4]) {
        const hits = [];
        for (const c of KB.cards) {
          const hay = hayOf(c), title = c.title.toLowerCase(), keys = (c.keys || []).join(' ').toLowerCase();
          let n = 0, longest = 0;
          for (const f of frags) if (f.length >= floor && hay.includes(f)) { n += 1; if (f.length > longest) longest = f.length; }
          if (longest < floor) continue;
          let bonus = 0;
          // ★命中在"摘要那一行"比命中在"章节名/关键词表"里更说明问题
          //   （章节名是每张卡都带一份的通用词表，光靠它匹配会把所有同类卡都拉进来）。
          const where = (c.where || '').toLowerCase();
          for (const f of frags) {
            if (f.length < floor) continue;
            if (title.includes(f)) bonus += 3;
            else if (where.includes(f)) bonus += 2;
            else if (keys.includes(f)) bonus += 1;
          }
          hits.push({ c, s: longest * 10 + n + bonus });
        }
        hits.sort((a, b) => b.s - a.s || (a.c.src < b.c.src ? -1 : 1));
        list = hits.map((x) => x.c);
        got = list.length;
        if (list.length <= 40) break;       // 够具体了，就停在这一档
      }
    }
  } else { got = KB.cards.length; }
  const terms = raw ? [raw, ...raw.split(/\\s+/).filter(Boolean)] : [];
  const SHOWN = 40;
  out.innerHTML = list.length ? list.slice(0, SHOWN).map(c =>
    '<div class="card"><span class="kind">' + esc(c.kind) + '</span><h3>' + hi(c.title, terms) + '</h3>'
    + '<div class="src">' + hi(c.src + ':' + c.line, terms) + '</div>'
    + (c.where ? '<div class="where">' + hi(c.where, terms) + '</div>' : '') + '</div>'
  ).join('') : '<div class="card">没搜到。换个词试试（也可以直接看 docs/kb-index.md 的全量清单）。</div>';
  meta.textContent = '共 ' + KB.cards.length + ' 张卡 · 命中 ' + got
    + (got > SHOWN ? '（只列最像的 ' + SHOWN + ' 张——把词写具体一点）' : '') + ' · 指纹 ' + KB.fingerprint;
}
q.addEventListener('input', render);
render();
</script></body></html>
`;

if (CHECK_ONLY) {
    const onDisk = exists('docs/kb.json') ? read('docs/kb.json') : '';
    let got = null;
    try { got = JSON.parse(onDisk).fingerprint; } catch { /* 缺或坏 */ }
    const ok = got === fingerprint;
    console.log(`知识索引：${ok ? '✔ 与源文件同步' : '✘ 过期（或不在了）'}`);
    console.log(`  盘上指纹 ${got || '（缺）'} · 现算 ${fingerprint}（源 ${sourceHash} · 代码 ${codeHash}）`);
    console.log(`  卡 ${cards.length} 张 · 源文件 ${sources.length} 份`);
    if (!ok) console.log('  ⇒ 跑 `node scripts/build-kb.mjs` 重新生成（不要手改生成物）。');
    process.exit(ok ? 0 : 1);
}

fs.writeFileSync(OUT_JSON, dataJson, 'utf8');
fs.writeFileSync(OUT_HTML, html, 'utf8');
fs.writeFileSync(OUT_MD, mdOut, 'utf8');
console.log('知识索引已生成：');
console.log(`  docs/kb.json        ${Buffer.byteLength(dataJson)} 字节 · ${cards.length} 张卡 · 源文件 ${sources.length} 份`);
console.log(`  docs/kb-search.html ${Buffer.byteLength(html)} 字节（浏览器直接打开就能搜）`);
console.log(`  docs/kb-index.md    ${Buffer.byteLength(mdOut)} 字节`);
console.log(`  指纹 ${fingerprint}（源 ${sourceHash} · 代码 ${codeHash}）`);
console.log(`  分类：${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
