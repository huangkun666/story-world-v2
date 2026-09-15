// story-world-v2/demo/summarize-leg40-arms.js
// leg40 · 汇总器（**纯只读、零调用**）：把 5 个已跑过的臂 + 本棒 2 个新臂摆在**同一张表**上，
//   并把"包内那一场的分量（占比）"与"与危机无关的新线占比"求相关——这是本棒要回答的那一格。
//
// 口径声明（重要）：
//   · "与危机无关的新线"沿用 **leg39 measure-leg36 的 CRISIS_RE**（死煞|幽冥|大荒|劫气|杀劫|浊流|煞|镇魔|超度|南疆|北山）
//     ——与历次读数**同一把尺子**，否则新旧不可比。★但本装置同时**如实标注它的已知偏差**：
//     `大荒` 既是地名也是那场灾难的名字 ⇒ 一条"在大荒但与此事无关"的新线会被算成危机（假阳性）。
//     故本表另列**去掉地名后的窄口径**（把 `大荒|南疆|北山` 从词表里去掉）作为下界/上界对照。
//   · "包内那一场的分量"只有本棒两个新臂有（旧臂的 JSON 没存快照/构成）⇒ 相关性只用新臂 + 旧臂的
//     "危机型新线占比"这两类读数并排看，**不当因果结论**。
//
// 用法：node demo/summarize-leg40-arms.js [--out F:/deepseek/tmp/leg40-summary.json]
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const OUT = argVal('--out', '');
const line = (s) => console.log(s);
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : 'n/a');

const CRISIS_RE = /死煞|幽冥|大荒|劫气|杀劫|浊流|煞|镇魔|超度|南疆|北山/;   // leg39 原尺子（可比性优先）
const CRISIS_NARROW = /死煞|幽冥|劫气|杀劫|浊流|镇魔|超度/;                   // 去掉地名与单字"煞"（保守口径）

const RUNS = [
    ['leg39 base（旧口径提示词）', 'F:/deepseek/tmp/leg39-base.json'],
    ['leg39 newprompt 首次', 'F:/deepseek/tmp/leg39-newprompt.json'],
    ['leg39 np-r1', 'F:/deepseek/tmp/leg39-np-r1.json'],
    ['leg39 np-r2', 'F:/deepseek/tmp/leg39-np-r2.json'],
    ['leg39 np-r3', 'F:/deepseek/tmp/leg39-np-r3.json'],
    ['★leg40 base（本棒 · 同起点现状）', 'F:/deepseek/tmp/leg40-base.json'],
    ['★leg40 trim（只削未决事件池那一栏）', 'F:/deepseek/tmp/leg40-trim.json'],
];

const rows = [];
for (const [name, path] of RUNS) {
    let j;
    try { j = JSON.parse(readFileSync(path, 'utf8')); } catch { rows.push({ name, path, missing: true }); continue; }
    const ok = (j.perTick || []).filter((p) => p.ok);
    const lines_ = ok.flatMap((p) => (p.newLines || p.newAgendaDetail || []).map((x) => (x.crisis !== undefined ? x : { goal: x.goal, type: x.type, crisis: CRISIS_RE.test(String(x.goal)) })));
    const evs = ok.flatMap((p) => (p.newEvents || p.newEventDetail || []).map((x) => (x.crisis !== undefined ? x : { title: x.title, crisis: CRISIS_RE.test(String(x.title)) })));
    const packTokens = ok.map((p) => p.pack?.estTokens).filter((x) => typeof x === 'number');
    rows.push({
        name, path, model: j.model, ticks: j.ticks, okTicks: ok.length, rejected: (j.perTick || []).length - ok.length,
        newLines: lines_.length,
        unrelatedWide: lines_.filter((x) => !CRISIS_RE.test(String(x.goal))).length,
        unrelatedNarrow: lines_.filter((x) => !CRISIS_NARROW.test(String(x.goal))).length,
        anchored: lines_.filter((x) => x.type === 'event' || x.type === 'parent').length,
        newEvents: evs.length,
        evUnrelatedWide: evs.filter((x) => !CRISIS_RE.test(String(x.title))).length,
        packTokensAvg: packTokens.length ? Math.round(packTokens.reduce((a, b) => a + b, 0) / packTokens.length) : null,
        crisisShareInPack: ok.map((p) => p.pack?.shareEv).filter((x) => typeof x === 'number').length
            ? +(ok.map((p) => p.pack.shareEv).filter((x) => typeof x === 'number').reduce((a, b) => a + b, 0) / ok.filter((p) => typeof p.pack?.shareEv === 'number').length).toFixed(4) : null,
        crisisRootInPack: ok.map((p) => p.pack?.evCrisisInPack).filter((x) => typeof x === 'number'),
        poolInPack: ok.map((p) => p.pack?.evInPack).filter((x) => typeof x === 'number'),
        warnSum: ok.reduce((n, p) => n + (p.warnings || 0), 0),
    });
}

line('═══ leg40 · 各臂横向对照（同一把尺子：leg39 的 CRISIS_RE）═══');
line('臂 · 成功轮/总轮 · 新线 · ★无关新线(宽口径) · 无关(去地名窄口径) · 有锚新线 · 新事件(无关) · 包token · ★包内那一场占比 · 池内条数 · 警告');
for (const r of rows) {
    if (r.missing) { line(`${r.name.padEnd(34)} —— 读不到（${r.path}）`); continue; }
    line(`${r.name.padEnd(34)} · ${String(r.okTicks).padStart(2)}/${String(r.ticks).padStart(2)} · ${String(r.newLines).padStart(2)} · ★${String(r.unrelatedWide).padStart(2)} (${pct(r.unrelatedWide, r.newLines).padStart(6)}) · ${String(r.unrelatedNarrow).padStart(2)} (${pct(r.unrelatedNarrow, r.newLines).padStart(6)}) · ${String(r.anchored).padStart(2)} · ${String(r.newEvents).padStart(2)}(${String(r.evUnrelatedWide).padStart(2)}) · ${String(r.packTokensAvg ?? '-').padStart(6)} · ${r.crisisShareInPack === null ? '   n/a' : pct(r.crisisShareInPack, 1).padStart(6)} · ${r.crisisRootInPack.length ? `${r.crisisRootInPack.join('/')}（池 ${r.poolInPack.join('/')}）` : 'n/a'} · ${r.warnSum}`);
}

const withShare = rows.filter((r) => !r.missing && r.crisisShareInPack !== null);
line('');
line('★相关性（只用同时有"包内占比"与"无关新线占比"的臂；n 很小，只作方向参考）：');
if (withShare.length >= 2) {
    for (const r of withShare) line(`   ${r.name}：包内那一场 ${pct(r.crisisShareInPack, 1)} → 无关新线 ${pct(r.unrelatedWide, r.newLines)}（${r.unrelatedWide}/${r.newLines}）`);
    const xs = withShare.map((r) => r.crisisShareInPack);
    const ys = withShare.map((r) => (r.newLines ? r.unrelatedWide / r.newLines : 0));
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const cov = xs.reduce((n, x, i) => n + (x - mx) * (ys[i] - my), 0) / xs.length;
    const sx = Math.sqrt(xs.reduce((n, x) => n + (x - mx) ** 2, 0) / xs.length);
    const sy = Math.sqrt(ys.reduce((n, y) => n + (y - my) ** 2, 0) / ys.length);
    line(`   Pearson r = ${sx && sy ? (cov / (sx * sy)).toFixed(3) : 'n/a'}（n=${withShare.length}——★n 这么小，r 只是方向，不是结论）`);
} else line('   （新臂还没跑完）');

line('');
line('★历次读数复核（本装置独立重算 leg39 交接 §6.1 的数字，确认口径一致）：');
for (const r of rows.filter((x) => !x.missing && x.name.startsWith('leg39'))) {
    line(`   ${r.name}：新线 ${r.newLines} · 无关 ${r.unrelatedWide}（${pct(r.unrelatedWide, r.newLines)}）· 有锚 ${r.anchored}（${pct(r.anchored, r.newLines)}）`);
}

if (OUT) { writeFileSync(OUT, JSON.stringify({ rows }, null, 2)); line(`\n已留档：${OUT}`); }
