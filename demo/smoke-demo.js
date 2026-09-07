// story-world-v2/demo/smoke-demo.js
// 冒烟演示：50 tick 曲线 + GC 数字实证 + 结论。运行：node demo/smoke-demo.js
import { readFileSync } from 'node:fs';
import { runSmoke, assertSmoke } from '../src/smoke.js';

const GOLDEN = JSON.parse(readFileSync(new URL('../test/fixtures/golden-world.min.json', import.meta.url), 'utf8'));
const EXTRACT_FIX = JSON.parse(readFileSync(new URL('../test/fixtures/extract-samples.json', import.meta.url), 'utf8'));

const { world, metrics } = await runSmoke({ ssot: GOLDEN, extractCtx: EXTRACT_FIX.context });
const check = assertSmoke({ world, metrics });

console.log('── 合成冒烟 50 tick · 曲线 ──');
for (const p of metrics.bytes) console.log(`${String(p.tick).padStart(3)} tick → ${p.bytes} 字节`);
console.log('── 实测 ──');
console.log(`输入峰值      ${metrics.maxPackTokens} tokens（预算提案 4000）`);
console.log(`在飞盘算峰    ${metrics.peakOpenAgendas}（≤15 提案）`);
console.log(`新生盘算      ${metrics.newbornsTotal}/tick（≤2 提案；切片无创建路径）`);
console.log(`a_1 满步结算  tick ${metrics.closedAtTick}（1/4 → 4/4，强制结算生效）`);
console.log(`警告总数      ${metrics.warningsTotal}`);
console.log(`终态 SSOT     ${JSON.stringify(world).length} 字节（编年 ${world.chronicle.length} · simLog ${world.meta.simLog.length}）`);
console.log(`── 结论：${check.ok ? 'PASS —— 全部断言通过' : 'FAIL —— ' + check.errors.join('; ')} ──`);