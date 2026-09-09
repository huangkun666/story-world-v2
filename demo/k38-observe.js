// story-world-v2/demo/k38-observe.js
// K38 观测台 100t 实体池演练（敲定稿 I 条；编排层 demo 工具，铁律 9）：
//   合成探针跑 100 tick——实体生灭/属性提议（含越界钳制）/盘算大厦顶触发裁定拒签/依据册空转，
//   逐 tick 采样三读数 + 远期引用参考 + 实体池曲线；末段冷档轮转 → 轮转后坏账重扫仍须零（红线 2 代码化的观测面）。
// 用法：node demo/k38-observe.js [--world <fixture.json>] [--ticks 100]
// 依赖：现有引擎与观测台纯函数，零新机制、零新阈值生效（全部提案态，铁律 2）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTick } from '../src/tick.js';
import { rotateChronicle } from '../src/storage.js';
import {
    rejectionStats, scanDanglingRefs, residencyStats, probeStepAges, summarizeObservatory,
} from '../src/observatory.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argVal = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const worldArg = argVal('--world', 'test/fixtures/live-world.json');
const ticksN = Math.max(1, parseInt(argVal('--ticks', '100'), 10) || 100);

const worldPath = path.isAbsolute(worldArg) ? worldArg : path.join(ROOT, worldArg);
let world = JSON.parse(fs.readFileSync(worldPath, 'utf8'));

// ---------- 合成探针生成器（全部走合法通道；拒签只来自引擎裁决：大厦顶/入局钳制） ----------
// 每 tick：推进全部在飞盘算 + 提议 3 条新盘算（perTick 上限 2 → 恒产生 1 条裁定拒签读数）；
// 逢 3：落一条 plot 事件（下 tick 可作新实体 event 源）；逢 2：利用上 tick 事件提议 1 条入局
//（attrs 带越界值 → 钳制读数；faction/character 交替 → 缺省兜底读数）；逢 10：取消 3 条清场
//（防 in-flight 顶满 15 后所有盘算提议被拒——保持读数混合而不是恒拒）。
let lastEventRef = null;   // {id, tick}：上一批落账的事件（下一 tick 起才可作为入局源）

function makeStepGen() {
    return function stepGen(tick, w) {
        const positions = w.context?.positions || ['江州'];
        const ents = w.entities || [];
        const proposer = ents.find((e) => e.status !== 'dead')?.id || ents[0]?.id;
        const open = (w.agendas || []).filter((a) => !a.closed);
        const openN = open.length;

        const agendaAdvances = open.map((a) => ({
            agendaId: a.id,
            step: `第 ${tick} 轮推进（${a.stage}）`,
            stage: `推进 ${tick}`,
        }));

        const newEvents = [];
        if (tick % 3 === 0 && openN) {
            // 探针用 state 源（常驻保留——永不自动闭环，可长期作入局 event 源；plot 源会随盘算结算被源结清）
            newEvents.push({
                title: `探针处境 ${tick}`,
                source: { type: 'state' },
                position: positions[0],
                ripples: ents.filter((e) => e.status !== 'dead').slice(0, 1).map((e) => e.id),
            });
            lastEventRef = { id: `ev_${tick}_1`, tick };   // 引擎落账 id 契约：本 tick 第一批事件 ev_<tick>_1
        }

        const newEntities = [];
        if (tick % 2 === 0 && lastEventRef && lastEventRef.tick < tick && proposer) {
            const isFaction = tick % 4 === 0;
            newEntities.push({
                name: `旅人${tick}`,
                kind: isFaction ? 'faction' : 'character',
                location: positions[0],
                entity: proposer,
                attrs: isFaction ? { hardPower: 1.4, office: 0.2 } : { network: (tick % 10) / 10 },
                source: { type: 'event', ref: lastEventRef.id },
            });
            lastEventRef = null;   // 一次一用（源事件保持未决）
        }

        const newAgendas = proposer
            ? [1, 2, 3].map((n) => ({
                entity: proposer,
                goal: `探针盘算 ${tick}.${n}`,
                stage: '张望',
                visibility: n % 2 ? 'known' : 'concealed',
                maxSteps: 4,
                source: { type: 'state' },
                note: '冒烟探针',
            }))
            : [];

        const agendaCancels = (tick % 10 === 0 && openN > 5)
            ? open.slice(0, 3).map((a) => ({ agendaId: a.id, reason: '冒烟清场' }))
            : [];

        return {
            actions: [], newEvents, agendaAdvances, stateChanges: [],
            newAgendas, agendaCancels, newEntities, entityFates: [],
        };
    };
}

// ---------- 主循环：逐 tick 推演 + 读数采样 ----------
const stepGen = makeStepGen();
const curves = { entities: [], active: [], agendas: [], rejected300: [], farRate: [] };
const STATUS_MARK = { 25: '', 50: '', 75: '' };
let ok = true;
let errMsg = '';

for (let t = 1; t <= ticksN; t += 1) {
    const step = stepGen(t, world);
    const far = probeStepAges(step, world);
    const transport = async () => ({ text: JSON.stringify(step) });
    const r = await runTick({ transport, ssot: world, dialogue: '（继续）', extractCtx: {} });
    if (!r.ok) { ok = false; errMsg = r.error; break; }
    world = r.ssot;
    const ents = world.entities || [];
    curves.entities.push({ t, n: ents.length });
    curves.active.push({ t, n: ents.filter((e) => !e.status || e.status === 'active').length });
    curves.agendas.push({ t, n: (world.agendas || []).filter((a) => !a.closed).length });
    const sim = world.meta?.simLog || [];
    const last = sim[sim.length - 1];
    if (last) curves.rejected300.push({ t, p: last.proposals ?? 0, r: last.rejected ?? 0 });
    if (far.sampled) curves.farRate.push({ t, rate: far.farRate });
    process.stdout.write(STATUS_MARK[t] ?? `\r已推进 ${t}/${ticksN} · 实体 ${curves.entities.at(-1).n}`);
}
process.stdout.write('\n');

// ---------- 末段：冷档轮转 → 轮转后坏账重扫（红线 2 观测面） ----------
const rot = rotateChronicle(world, { limits: { ticks: 30, bytes: 100 * 1024 } });
const hotAfter = rot.volume ? rot.hot : world;
const danglingAfterRotate = scanDanglingRefs(hotAfter);

// ---------- 报告 ----------
const report = {
    world: world.context?.world || '(未名)',
    ticks: ok ? ticksN : `中止于 ${curves.entities.length}（${errMsg}）`,
    rejection: rejectionStats(world.meta?.simLog),
    dangling: scanDanglingRefs(world),
    residency: residencyStats(world),
    farReference: { lastSampled: curves.farRate.length, lastRate: curves.farRate.at(-1)?.rate ?? null },
    entityCurve: curves.entities,
    activeCurve: curves.active,
    agendaCurve: curves.agendas,
    rejectionSeries: curves.rejected300,
    final: {
        ssotBytes: JSON.stringify(world).length,
        chronicleRows: (world.chronicle || []).length,
        entities: (world.entities || []).length,
        milestones: (world.milestones || []).length,
        simLogRounds: (world.meta?.simLog || []).length,
    },
    coldChain: {
        rotated: Boolean(rot.volume),
        volumeRows: rot.volume?.rows?.length ?? 0,
        volumeId: rot.volume?.id ?? null,
        danglingAfterRotate: danglingAfterRotate.count,
    },
};

const jsonPath = path.join(ROOT, 'docs', 'reports', `k38-observatory-100t-2026-09-09.json`);
fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

// ---------- 人话版摘要（md，供报批） ----------
const pct = (n) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);
const lines = [
    `# K38 观测台 · 100t 合成绩效报告（${new Date().toISOString().slice(0, 10)} · 全数字提案态）`,
    '',
    `> 世界「${report.world}」from ${worldArg} · 合成探针 ${report.ticks} tick · 引擎现有规则零改动，读数全部来自 simLog/账本。`,
    '',
    '## 人话版',
    '这台机器连跑 100 轮被盯着看：坏账=0 是必须的；拒签率展示了引擎说"不"的密度；驻留看有没有人占座摸鱼。数字不是定案，是报批素材（铁律 2/8）。',
    '',
    '## 三读数（+参考）',
    `| 读数 | 值 | 健康线（提案） | 判读 |`,
    `|---|---|---|---|`,
    `| 坏账率 | ${report.dangling.count} 例（${report.dangling.dangling.length ? '明细见 json' : '零坏账 ✓'}） | 0 | ${report.dangling.count === 0 ? '账本全链可达' : '需查明细'} |`,
    `| 拒签率 | ${pct(report.rejection.rate)}（${report.rejection.rejected}/${report.rejection.proposals} 提议 · ${report.rejection.countedRounds} 轮计数） | 3~8%（真跑口径） | ${report.rejection.rate == null ? '分母不足' : report.rejection.rate > 0.2 ? '探针制造的大厦顶偏高（合成口径，非真跑）' : '合成探针正常范围'} |`,
    `| 席位居留 | 摸鱼(>30轮) ${report.residency.loungers.length} 人 · 活跃闲置中位 ${report.residency.activeIdle.p50 ?? '—'} 轮/最高 ${report.residency.activeIdle.max ?? '—'} 轮 | 15~25 轮换一茬 | ${report.residency.loungers.length ? '见 json 名单' : '无占座摸鱼'} |`,
    `| 远期引用（参考） | 末采样 ${report.farReference.lastRate == null ? '—' : pct(report.farReference.lastRate)} | >20 tick 记远 | 探针仅引近事 → ${report.farReference.lastRate == null ? '无样本' : '近事为主'} |`,
    '',
    '## 冷档链（红线 2 观测面）',
    `轮转${report.coldChain.rotated ? '触发' : '未触发（未超阈值）'}${report.coldChain.rotated ? `：卷「${report.coldChain.volumeId}」入卷 ${report.coldChain.volumeRows} 行` : ''}；轮转后坏账重扫 = **${report.coldChain.danglingAfterRotate} 例**（须为 0）。`,
    '',
    '## 实体池曲线（报批素材 · 明细见 json）',
    `终态实体 ${report.final.entities}（active ${report.residency.statusCount.active} / retired ${report.residency.statusCount.retired} / dead ${report.residency.statusCount.dead}）· 里程碑 ${report.final.milestones} · 编年 ${report.final.chronicleRows} 行 · SSOT ${(report.final.ssotBytes / 1024).toFixed(1)}KB · simLog ${report.final.simLogRounds} 轮。`,
    '',
    '## 报批请求（随 K38 数字组）',
    '拒签健康线 3~8%（真跑口径，合成探针不裁此线）· 驻留 15~25 轮 · 摸鱼判据 30 轮 · 远期引用 20 tick · 新实体缺省 0.15/0.25 · 入局钳制 [0,1] —— 全部提案态，待拍板。',
    '',
    `*demo/k38-observe.js 生成 · 原始数据 ${path.relative(ROOT, jsonPath)}*`,
];
fs.writeFileSync(
    path.join(ROOT, 'docs', 'reports', 'k38-observatory-100t-2026-09-09.md'),
    lines.join('\n'),
);

console.log(JSON.stringify(report, null, 2));
console.log(`✔ 报告：docs/reports/k38-observatory-100t-2026-09-09.{md,json}`);
console.log(ok ? '✔ 100t 跑通' : `✗ 中止：${errMsg}`);