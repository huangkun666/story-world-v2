// story-world-v2/demo/capture-demo.js
// K7 准备件（K12 升级）：真模型输出快照（未决点"模型输出快照 fixture"的落盘机制）。
// 用法：node demo/capture-demo.js [--world live|bystander|player] [--ticks 8] [--out snapshots]
// 每 tick：真调用原文 raw + 引擎侧解析出的世界步 step + 门控审计 + 玩家审计（K12：--world player 含 e_player attrs/分量/影响通道）→ 落盘 snapshots/<world>-<时间戳>.jsonl
// 落盘内容即可转制为"模型输出快照 fixture"：引擎对历史真实输出跑回归（锁言行，零成本）。
// 注意：本脚本需要真实模型配置（env 或酒馆预设，同 live-demo）；无配置时给出指引后退出，真跑由用户执行。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { runTick } from '../src/tick.js';
import { runMainCall } from '../src/worldstep.js';
import { extractMove } from '../src/extract.js';
import { buildEvolutionPack } from '../src/pack.js';
import { resolveWorldTransport } from '../src/st-preset.js';

const args = process.argv.slice(2);
const flag = (name, def) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const worldName = flag('world', 'live');
const ticks = Number(flag('ticks', '8'));
const outDir = flag('out', 'snapshots');
const isBystander = worldName === 'bystander';

const WORLD_FILE = worldName === 'player' ? 'player-world.json' : `${worldName}-world.json`;
const CTX_FILE = worldName === 'player' ? 'live-ctx.json' : `${worldName}-ctx.json`;
const WORLD = JSON.parse(readFileSync(new URL(`../test/fixtures/${WORLD_FILE}`, import.meta.url), 'utf8'));
const CTX = JSON.parse(readFileSync(new URL(`../test/fixtures/${CTX_FILE}`, import.meta.url), 'utf8'));
const TURNS = isBystander
    ? Array.from({ length: ticks }, () => '（旁观：我只看不动）')
    : ['我去大盘谷看看薛铁衣的动静', '我想问偏将大人，灵脉交割的章程', '薛铁衣，你究竟是什么来路',
       '万法阁的道友，带路吧', '我谋划拿下这条灵脉', '太岁残骨的事，我向万法阁询个价',
       '此地煞气太重，我们离开这里', '回黄府后，我要开始修炼了'].slice(0, ticks);

const resolved = resolveWorldTransport();
if (!resolved) {
    console.error('未找到任何模型配置：env 未设、酒馆预设也未读到（真跑需你提供环境，本步只备机制）。');
    console.error('  · env：ST_OPENAI_BASE / ST_OPENAI_KEY / ST_WORLD_MODEL');
    console.error('  · 或酒馆预设直读（ST_SETTINGS_PATH 可覆盖默认路径）。');
    process.exit(1);
}

let world = structuredClone(WORLD);
const rawLog = [];
const capTransport = async (prompt) => {
    const raw = await resolved.transport(prompt);
    rawLog.push(raw);
    return raw;
};
const lines = [];

for (const [i, dialogue] of TURNS.entries()) {
    const move = extractMove(dialogue || '', CTX);
    const record = { tick: i + 1, dialogue, raw: null, step: null, gate: null, warnings: [] };
    const r = await runTick({ transport: capTransport, ssot: world, dialogue, extractCtx: CTX });
    if (!r.ok) {
        record.warnings = [r.error];
        lines.push(JSON.stringify(record));
        console.log(`tick ${i + 1} ✗ ${r.error}`);
        continue;
    }
    // 用落盘原文本地重解析出世界步（不再调模型）：引擎对历史真实输出的可回归形状
    const pack = buildEvolutionPack(world, move.verb ? move : null);
    const parsed = await runMainCall({ transport: async () => ({ text: rawLog[rawLog.length - 1] }), ssot: world, pack });
    record.raw = rawLog[rawLog.length - 1];
    record.step = parsed.ok ? parsed.step : null;
    const sim = r.ssot.meta.simLog.at(-1);
    record.gate = { silent: sim?.silent, lifted: sim?.lifted };
    // K12：玩家世界快照含玩家分量/attrs/影响通道审计（真跑回填 V1/V2/V8 玩家侧对照的素材）
    record.player = r.ssot.context?.playerId ? {
        weight: r.ssot.weights?.[r.ssot.context.playerId] ?? null,
        attrs: r.ssot.entities.find((e) => e.id === r.ssot.context.playerId)?.attrs ?? null,
        affected: sim?.playerAffected ?? [],
    } : null;
    record.warnings = r.stage.warnings;
    lines.push(JSON.stringify(record));
    world = r.ssot;
    console.log(`tick ${i + 1} · ${dialogue} · 注入段 ${r.streams.injection?.length ?? 0} 字符 · 警告 ${r.stage.warnings.length}`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(outDir, { recursive: true });
const file = `${outDir}/${worldName}-${stamp}.jsonl`;
writeFileSync(file, lines.join('\n') + '\n', 'utf8');
console.log(`\n快照已落盘：${file}（${lines.length} tick）。此文件可转制为模型输出快照 fixture（见未决点队列）。`);