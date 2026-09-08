// story-world-v2/demo/status.js
// 一键状态总览（第三棒）：聚合文档语义状态 + 代码侧活事实。
// 分工：语义状态（拍板/验收/挂起）永远在文档（ANCHOR/dev-process/台账）；本脚本零增量维护，
//       只聚合——阶段（ANCHOR 状态行）、健康度（现跑 node --test）、模块×测试覆盖（文件与用例计数）、
//       最近变更（台账末行）、队列摘要（dev-process §6 主队列表）。
// 运行：node demo/status.js
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split(/\r?\n/);
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const cell = (line, i) => (line.split('|')[i] ?? '').trim();

// 模块 → 覆盖其行为的测试文件（静态映射；新增/变更时随台账行顺带维护）
const TEST_MAP = {
    'schema.js': ['schema.test.js'],
    'schemas/ssot.schema.js': ['schema.test.js', 'setting.test.js', 'golden-slice.test.js', 'live-world.test.js', 'bystander-world.test.js'],
    'schemas/world-step.schema.js': ['schema.test.js'],
    'extract.js': ['extract.test.js'],
    'fingerprint.js': ['fingerprint.test.js'],
    'player-inject.js': ['player-inject.test.js'],
    'pack.js': ['worldstep.test.js', 'smoke.test.js', 'birth.test.js'],
    'prompts.js': ['worldstep.test.js', 'streams.test.js'],
    'check-step.js': ['worldstep.test.js', 'birth.test.js', 'setting-guard.test.js'],
    'worldstep.js': ['worldstep.test.js'],
    'setting.js': ['setting-guard.test.js'],
    'entropy.js': ['entropy.test.js'],
    'settle.js': ['settle.test.js', 'golden-slice.test.js', 'gate.test.js', 'cause.test.js', 'decay.test.js', 'weight-smoke.test.js', 'birth.test.js', 'verdict.test.js', 'event-close.test.js', 'archive.test.js', 'shade.test.js', 'cancel.test.js', 'snapshot-replay.test.js', 'entropy.test.js'],
    'streams.js': ['streams.test.js', 'shade.test.js'],
    'tick.js': ['streams.test.js', 'smoke.test.js', 'live-world.test.js', 'bystander-world.test.js'],
    'transport-http.js': ['transport-http.test.js'],
    'st-preset.js': [],
    'smoke.js': ['smoke.test.js', 'weight-smoke.test.js', 'tree-smoke.test.js'],
    'weight.js': ['weight.test.js', 'decay.test.js', 'weight-smoke.test.js'],
    'gate.js': ['gate.test.js', 'weight-smoke.test.js', 'birth.test.js'],
};

// ---------- 健康度：现跑全量测试 ----------
const t = spawnSync(process.execPath, ['--test'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
const tOut = (t.stdout || '') + (t.stderr || '');
const sum = (re) => Number((tOut.match(re) || [])[1] ?? 0);
const testsN = sum(/ℹ tests (\d+)/);
const passN = sum(/ℹ pass (\d+)/);
const failN = sum(/ℹ fail (\d+)/);
const healthy = t.status === 0 && failN === 0;

// ---------- 阶段：ANCHOR 状态行 ----------
const anchorStatus = read('ANCHOR.md').find((l) => l.startsWith('> 状态：')) ?? '';

// ---------- 模块清单 ----------
const modules = readdirSync(join(ROOT, 'src')).filter((f) => f.endsWith('.js')).sort();
const ledgerLines = read('docs/ledger.md');
const lastLedgerHit = (mod) => {
    for (let i = ledgerLines.length - 1; i >= 0; i--) if (ledgerLines[i].includes(`src/${mod}`)) return i;
    return null;
};
const testCaseCount = (file) => {
    const p = join(ROOT, 'test', file);
    return existsSync(p) ? (read(`test/${file}`).join('\n').match(/test\(/g) || []).length : -1;
};

// ---------- 队列摘要（dev-process §6 主队列表） ----------
const dp = read('docs/dev-process.md');
const qStart = dp.findIndex((l) => l.includes('当前队列快照'));
const qEnd = dp.findIndex((l) => l.includes('钻层盘点'));
const queueRows = dp.slice(qStart + 1, qEnd).filter((l) => l.trim().startsWith('|'));
const queue = queueRows
    .map((l) => ({ name: cell(l, 1), status: cell(l, 2), trigger: clip(cell(l, 3), 56) }))
    .filter((q) => q.name && q.name !== '未决点' && !q.name.includes('---'));
const nextItem = queue.find((q) => /待|挂起/.test(q.status)) ?? queue[0];

// ---------- 最近变更 ----------
const recent = ledgerLines.filter((l) => l.trim().startsWith('|')).slice(-6).map((l) => ({
    date: cell(l, 1), step: cell(l, 2), summary: clip(cell(l, 3), 92), test: cell(l, 4),
}));

// ---------- 输出 ----------
console.log('════ story-world v2 · 状态总览 ════════════════════════════════');
console.log(`\n【阶段】${clip(anchorStatus.replace('> 状态：', ''), 260)}`);
console.log(`\n【健康度】node --test → ${healthy ? '✔' : '✖'} ${testsN} 测试 · pass ${passN} · fail ${failN}${failN ? '（详见上方失败输出）' : ''}`);

console.log(`\n【模块】${modules.length} 个（状态与契约见 dev-process §9）`);
for (const m of modules) {
    const tests = TEST_MAP[m] ?? [];
    const cov = tests.length
        ? tests.map((f) => `${f}[${testCaseCount(f)}]`).join(' ')
        : '—（经 demo/ 工具覆盖）';
    const hit = lastLedgerHit(m);
    const lr = hit ? `台账L${hit + 1}` : '—';
    console.log(`  ${m.padEnd(28)} ${clip(cov, 76).padEnd(78)} ${lr}`);
}

console.log('\n【最近变更】（台账末 6 行）');
for (const r of recent) console.log(`  ${r.date} ${r.step}${r.summary ? ` · ${r.summary}` : ''}${r.test ? ` [${r.test}]` : ''}`);

console.log(`\n【队列】${queue.length} 条主未决（dev-process §6）`);
for (const q of queue) console.log(`  ${clip(q.name, 34).padEnd(36)} ${clip(q.status, 22).padEnd(24)} 触发：${q.trigger}`);

console.log(`\n【下一步】${nextItem ? `${nextItem.name}（${nextItem.status}）` : '看 §6 队列'}`);
console.log('【命令】node --test · node demo/smoke-demo.js · node demo/diag-transport.js · node demo/capture-demo.js（真跑）');
console.log('══════════════════════════════════════════════════════════════');
process.exit(healthy ? 0 : 1);