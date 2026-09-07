// story-world-v2/demo/bystander-demo.js
// 旁观者演示：玩家不在任何盘算的交叉点上——三方互斗，玩家只过自己的小日子。
// 验证目标：世界在没有"围绕玩家"的压力下也自己转；动态流连续多回合不见玩家。
// 运行：node demo/bystander-demo.js（传输走酒馆预设，同 live-demo）
import { readFileSync } from 'node:fs';
import { runTick } from '../src/tick.js';
import { resolveWorldTransport } from '../src/st-preset.js';

const WORLD = JSON.parse(readFileSync(new URL('../test/fixtures/bystander-world.json', import.meta.url), 'utf8'));
const CTX = JSON.parse(readFileSync(new URL('../test/fixtures/bystander-ctx.json', import.meta.url), 'utf8'));

const TURNS = [
    '我去看看坊市西门的动静',
    '掌柜，这筐药材值几何？',
    '回铺子，我要开始修炼了',
    '（继续）',
    '此地太吵，我们离开这里',
    '我谋划把这间铺子买下来',
    '掌柜，带路吧',
    '（静一静，想想心事）',
];

const resolved = resolveWorldTransport();
if (!resolved) {
    console.error('未找到模型配置（env 或酒馆预设）。请先跑 node demo/diag-transport.js 排查。');
    process.exit(1);
}
console.log(`传输源：${resolved.source === 'st-preset' ? `酒馆预设「${resolved.presetName}」` : '环境变量'} · 模型 ${resolved.model}`);

let world = structuredClone(WORLD);
let warningsTotal = 0;
const allObserver = [];

for (const [i, dialogue] of TURNS.entries()) {
    const r = await runTick({ transport: resolved.transport, ssot: world, dialogue, extractCtx: CTX });
    if (!r.ok) {
        console.log(`\n═══ tick ${i + 1} ✗ ${r.error}`);
        continue;
    }
    world = r.ssot;
    warningsTotal += r.stage.warnings.length;
    console.log(`\n═══ tick ${i + 1} · 玩家：${dialogue} ═══`);
    console.log(r.streams.injection ?? '（此回合无注入内容）');
    for (const line of r.streams.observer) console.log(line);
    if (r.stage.warnings.length) console.log(`⚠ 引擎：${r.stage.warnings.join(' | ')}`);
    allObserver.push({ tick: r.ssot.meta.tick, lines: r.streams.observer });
}

console.log('\n══════ 终局 · 编年总览 ══════');
for (const c of world.chronicle) console.log(`[t${c.tick}] ${c.text}`);

console.log('\n══════ 旁观指数 ══════');
// 玩家痕迹启发式：名字 黄坤 / 泛指 那名散修·坊市·货郎·少年（泛指有噪声，仅参考）
const PLAYER_HINTS = /黄坤|那名散修|坊市散修|少年|货郎/;
const tickPresent = allObserver.map((o) => o.lines.some((l) => PLAYER_HINTS.test(l)) ? 1 : 0);
const maxAbsent = tickPresent.reduce((acc, p) => (p === 0 ? acc + 1 : 0), 0); // 简化：末尾连缺（从头累计不含间断）
let best = 0, cur = 0;
for (const p of tickPresent) { cur = p === 0 ? cur + 1 : 0; best = Math.max(best, cur); }
console.log(`各回合玩家痕迹(1=出现)：${tickPresent.join(',')}`);
console.log(`最长连续无玩家回合：${best} / ${allObserver.length}`);
console.log(`编年总数 ${world.chronicle.length} · 事件链 ${world.events.length} · 引擎警告 ${warningsTotal} 条`);
console.log('（注：可见性掩码仍为常量占位——"感知半径/信息过滤"要等分量引擎阶段，本演示只验证世界不围绕玩家规划）');