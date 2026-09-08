// story-world-v2/demo/export-world.js
// 演示桥（第十三棒，用户拍板 2026-09-08）：把本机现成的世界导出为 K35 备份包（story-world-v2-export.json），
// 供 ST 面板「设置 → 旧卷与存储管理 → 导入」装进热账——面板立刻六页签全亮，四线冒烟可跑。
// 用法：node demo/export-world.js [--world <文件>] [--ticks N] [--out <输出名>]
//   --world 接受两种输入：
//     · fixture JSON（test/fixtures/*.json，如 live-world.json）
//     · 真跑快照 JSONL（snapshots/*.jsonl，取末行 record.world = 终态；K23 升级后快照带 world 全链）
//   缺省 = test/fixtures/live-world.json（K7 真模型活世界：薛铁衣暗盘算 + 大虞偏将 + 万法阁）
//   --ticks N（缺省 6）：导出前用中立演化生成器推演 N tick（推进在飞盘算 + 周期 plot 事件，
//     零新机制、确定性；旧快照无 world 时用这个模式补出多轮内容）。--ticks 0 = 原样导出。
// 自检：导出 → verifyImportBundle 回读验签，不过关不落盘（铁律 4 口径：能跑才算数）。
// 分层：编排层 demo 工具（铁律 9），仅用 K35 存储纯函数 + K36 起已有的 runTick 编排，零引擎改动。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExportBundle, verifyImportBundle } from '../src/storage.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { runTick } from '../src/tick.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argVal = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const worldArg = argVal('--world', 'test/fixtures/live-world.json');
const ticksN = Math.max(0, parseInt(argVal('--ticks', '6'), 10) || 0);
const outName = argVal('--out', 'story-world-v2-export.json');

const worldPath = path.isAbsolute(worldArg) ? worldArg : path.join(ROOT, worldArg);
if (!fs.existsSync(worldPath)) {
    console.error(`✗ 找不到世界文件：${worldPath}`);
    process.exit(1);
}

let world;
const raw = fs.readFileSync(worldPath, 'utf8');
if (worldPath.endsWith('.jsonl')) {
    // 真跑快照：取最后一个带 record.world 的行（终态世界；早期无 world 行自动跳过）
    let found = null;
    for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
            const rec = JSON.parse(line);
            if (rec?.record?.world && typeof rec.record.world === 'object') found = rec.record.world;
        } catch (_) { /* 行级容错：坏行跳过 */ }
    }
    world = found;
    if (!world) {
        console.error(`✗ 快照 ${worldPath} 没有任何带 record.world 的行（旧快照无 world 链，换 --world 指定 fixture JSON + --ticks 演化）`);
        process.exit(1);
    }
} else {
    try {
        world = JSON.parse(raw);
    } catch (e) {
        console.error('✗ 文件不是合法 JSON：', e.message);
        process.exit(1);
    }
}

// ---------- 中立演化生成器（--ticks）：推进每个在飞盘算一步；每 2 tick 挂一条 plot 源事件 ----------
// 只碰两类提案（agendaAdvances + plot 事件），不发 actions/stateChanges/newAgendas——
// 语义简单、不撞门控/不抵拒面，确定性由引擎纯函数保证（同输入同输出）。
let genCounter = 0;
function evolveStep(ssot) {
    genCounter += 1;
    const open = (ssot.agendas || []).filter((a) => !a.closed);
    const target = open.length ? open[genCounter % open.length] : null;
    const advances = open.map((a) => ({
        agendaId: a.id,
        step: `第 ${genCounter} 轮推进（${a.stage}）`,
        stage: `推进 ${genCounter}`,
    }));
    const newEvents = (genCounter % 2 === 0 && target)
        ? [{
            title: `盘算落子：${target.goal}`,
            source: { type: 'plot', ref: target.id },
            position: (ssot.context?.positions || ['江州'])[0],
            ripples: (ssot.entities || []).filter((e) => e.id !== target.owner).slice(0, 1).map((e) => e.id),
        }]
        : [];
    return { actions: [], newEvents, agendaAdvances: advances, stateChanges: [], newAgendas: [], agendaCancels: [] };
}

async function evolve(world, n) {
    let w = structuredClone(world);
    for (let t = 1; t <= n; t += 1) {
        const step = evolveStep(w);
        const transport = async () => ({ text: JSON.stringify(step) });
        const r = await runTick({ transport, ssot: w, dialogue: '（继续）', extractCtx: {} });
        if (!r.ok) {
            console.error(`✗ 合成演化 tick ${t} 失败：${r.error}`);
            process.exit(1);
        }
        w = r.ssot;
    }
    return w;
}

if (ticksN > 0) world = await evolve(world, ticksN);

const errs = validate(world, ssotSchema);
if (errs && errs.length) {
    console.error(`✗ 世界不过 SSOT 形状（${errs.length} 项），前 5 项：`);
    for (const e of errs.slice(0, 5)) console.error('  -', e);
    process.exit(1);
}

const { json, digest } = await buildExportBundle(world, [], {
    chatId: 'demo-bridge',
    exportedAt: new Date().toISOString(),
});
const check = await verifyImportBundle(json);
if (!check.ok) {
    console.error(`✗ 自检（回读验签）失败：${check.error}`);
    process.exit(1);
}

const outPath = path.join(ROOT, outName);
fs.writeFileSync(outPath, json);

const ctxName = world.context?.world || '(无世界名)';
console.log(`✔ 导出完成：${outPath}`);
console.log(`  世界「${ctxName}」· ${(world.entities || []).length} 实体 · ${(world.agendas || []).length} 盘算（在飞 ${(world.agendas || []).filter((a) => !a.closed).length}）· ${(world.events || []).length} 事件 · 编年 ${(world.chronicle || []).length} 行 · tick ${world.meta?.tick ?? 0}${ticksN > 0 ? `（演化 +${ticksN}）` : ''}`);
console.log(`  体积 ${Buffer.byteLength(json)}B · 摘要 ${digest.slice(0, 16)}… · 自检（SHA-256 回读）通过`);
console.log(`下一步：ST 扩展菜单 → 观棋窗口 → 「设置」页签 → 旧卷与存储管理 →「导入」选择这个文件`);