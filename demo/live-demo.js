// story-world-v2/demo/live-demo.js
// 活演示：真模型 + 三实体世界 + 8 回合连跑。
// 传输解析：先找 env（ST_OPENAI_*），没有就用酒馆预设直读（旧插件 llmPresets 活跃预设 = gemini 旗舰）。
// 运行：node demo/live-demo.js
import { readFileSync } from 'node:fs';
import { runTick } from '../src/tick.js';
import { resolveWorldTransport } from '../src/st-preset.js';

const WORLD = JSON.parse(readFileSync(new URL('../test/fixtures/live-world.json', import.meta.url), 'utf8'));
const CTX = JSON.parse(readFileSync(new URL('../test/fixtures/live-ctx.json', import.meta.url), 'utf8'));

const TURNS = [
    '我去大盘谷看看薛铁衣的动静',
    '我想问偏将大人，灵脉交割的章程',
    '薛铁衣，你究竟是什么来路',
    '万法阁的道友，带路吧',
    '我谋划拿下这条灵脉',
    '太岁残骨的事，我向万法阁询个价',
    '此地煞气太重，我们离开这里',
    '回黄府后，我要开始修炼了',
];

const resolved = resolveWorldTransport();
if (!resolved) {
    console.error('未找到任何模型配置：env 未设、酒馆预设也未读到。');
    console.error('  · 或设置环境变量：ST_OPENAI_BASE / ST_OPENAI_KEY / ST_WORLD_MODEL');
    console.error('  · 或用酒馆预设直读（默认路径 F:/jiuguanai/.../data/default-user/settings.json');
    console.error('    可用 ST_SETTINGS_PATH 指向其他位置）。');
    process.exit(1);
}
console.log(`传输源：${resolved.source === 'st-preset' ? `酒馆预设「${resolved.presetName}」` : '环境变量'} · 模型 ${resolved.model} · base ${resolved.baseUrl}`);

let world = structuredClone(WORLD);
let warningsTotal = 0;
const transport = resolved.transport;

for (const [i, dialogue] of TURNS.entries()) {
    const r = await runTick({ transport, ssot: world, dialogue, extractCtx: CTX });
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
}

console.log('\n══════ 终局 · 编年总览 ══════');
for (const c of world.chronicle) console.log(`[t${c.tick}] ${c.text}`);
console.log('\n盘算状态：');
for (const a of world.agendas) {
    console.log(`  ${a.goal} — ${a.progress}/${a.maxSteps}${a.closed ? '（已结算）' : ''}${a.visibility === 'concealed' ? '（暗）' : ''}`);
}
console.log(`\n事件链 ${world.events.length} 条 · 编年 ${world.chronicle.length} 条 · 引擎警告 ${warningsTotal} 条（烟雾报警，非故障）`);