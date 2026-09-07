// story-world-v2/demo/convert-snapshots.js
// K23 转制器（因果链细案 §3.6 → A-6）：snapshots/*.jsonl → test/fixtures/snapshots/<world>-<ts>.json
// （快照 fixture：引擎对历史真模型输出跑回归，锁言行）。机制部署；产出即再生成。
// 契约补差注明：K13 前快照（player-11-31/live-11-47/bystander-12-18）step 无 newAgendas —— 补 []（那时代无提议通道）；
// K18 前快照 step 无 agendaCancels —— 补 []（那时代无取消通道）。语义如实，形状补全。
// era 元数据：'pre-weight-fix'（live-11-47/bystander-12-18——K7 真跑后夹具种子 weights 修补前的快照，
// 门控审计（gate.silent/lifted）依赖当时的夹具状态，现夹具已变 → gate 锁言不可复现，降级仅锁 warnings）；
// 'post'（其余——修补后夹具，gate 可锁）。
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { extractMove } from '../src/extract.js';

const WORLD_META = {
    live: { world: 'live-world.json', ctx: 'live-ctx.json' },
    player: { world: 'player-world.json', ctx: 'live-ctx.json' },
    bystander: { world: 'bystander-world.json', ctx: 'bystander-ctx.json' },
};
const PRE_WEIGHT_FIX = ['live-2026-09-07T11-47-47-354Z', 'bystander-2026-09-07T12-18-14-302Z'];

const outDir = new URL('../test/fixtures/snapshots/', import.meta.url);
mkdirSync(outDir, { recursive: true });

let converted = 0;
for (const file of readdirSync(new URL('../snapshots/', import.meta.url)).filter((f) => f.endsWith('.jsonl'))) {
    const worldName = file.split('-')[0];
    const meta = WORLD_META[worldName];
    const ctx = JSON.parse(readFileSync(new URL(`../test/fixtures/${meta.ctx}`, import.meta.url), 'utf8'));
    const lines = readFileSync(new URL(`../snapshots/${file}`, import.meta.url), 'utf8').trim().split('\n');
    const steps = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        const rec = JSON.parse(line);
        if (!rec.step) {   // 该 tick 主调用解析失败（快照仅记录错误）——重放跳过，仅锁存在
            steps.push({ tick: rec.tick, step: null, moveFact: null, expect: { warnings: rec.warnings, gate: null, player: null } });
            continue;
        }
        rec.step.newAgendas = rec.step.newAgendas ?? [];
        rec.step.agendaCancels = rec.step.agendaCancels ?? [];
        const move = extractMove(rec.dialogue || '', ctx);
        steps.push({
            tick: rec.tick,
            step: rec.step,
            moveFact: move.verb ? move : null,
            expect: { warnings: rec.warnings, gate: rec.gate, player: rec.player },
        });
    }
    const fixture = { name: file.replace(/\.jsonl$/, ''), sourceWorld: meta.world, meta: { era: PRE_WEIGHT_FIX.includes(file.replace(/\.jsonl$/, '')) ? 'pre-weight-fix' : 'post' }, steps };
    writeFileSync(new URL(`${fixture.name}.json`, outDir), JSON.stringify(fixture, null, 1), 'utf8');
    converted += 1;
    console.log(`${file} → ${fixture.name}.json（${steps.length} tick）`);
}
console.log(`共转制 ${converted} 份快照 fixture。`);