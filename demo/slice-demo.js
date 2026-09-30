// story-world-v2/demo/slice-demo.js
// 纵向切片演示：一条真实对话（活档 l25 摘录）→ 第一条动态流条目。
// 运行：node demo/slice-demo.js （主调用用 canned 世界步，真 HTTP 接线见 src/transport-http.js）
import { readFileSync } from 'node:fs';
import { runTick } from '../src/tick.js';

const GOLDEN = JSON.parse(readFileSync(new URL('../test/fixtures/golden-world.min.json', import.meta.url), 'utf8'));
const EXTRACT_FIX = JSON.parse(readFileSync(new URL('../test/fixtures/extract-samples.json', import.meta.url), 'utf8'));

const cannedTransport = async () => ({
    text: JSON.stringify({
        actions: [{ entity: 'e_merchant', verb: '沿商路北上巡查', position: '商路' }],
        newEvents: [{ title: '守将允诺通关', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: ['e_merchant'] }],
        agendaAdvances: [{ agendaId: 'a_1', step: '守将首肯，车队放行', stage: '过边关' }],
        stateChanges: [{ entity: 'e_merchant', attr: 'network', delta: 0.05 }],
        newAgendas: [], agendaCancels: [],
    }),
});

const sample = EXTRACT_FIX.samples.find((x) => x.id === 'l25');
console.log(`> 玩家：${sample.dialogue}`);

const r = await runTick({ transport: cannedTransport, ssot: GOLDEN, dialogue: sample.dialogue, extractCtx: EXTRACT_FIX.context });

if (!r.ok) {
    console.error(`✗ tick 失败：${r.error}`);
    process.exit(1);
}

console.log('\n── RP 注入（下一轮送达）──');
console.log(r.streams.injection);
console.log('\n── 观棋窗口 · 动态流 ──');
for (const line of r.streams.observer) console.log(line);
console.log('\n（tick', r.ssot.meta.tick, '· 事件', r.ssot.events.length, '· 编年', r.ssot.chronicle.length, '· simLog', r.ssot.meta.simLog.length, '）');