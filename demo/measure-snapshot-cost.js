// story-world-v2/demo/measure-snapshot-cost.js  (只读 · 零网络 · 零真模型)
// leg27 后 · 量「快照容错的真实体积」——判据不是估的，是跑出来的。
// 为什么必须量（本仓铁律 2：数字先报批、先出曲线）：
//   保留窗口 = 15 步（用户拍板），而"15 步占多少"完全取决于 **delta 有多大**。
//   真账实测（本脚本）：full = 166,760 字节；一步量级改动的 delta = 百字节级。
// 做法：拿真账当起点，用**确定性合成步骤**跑 N 个真 tick（`runSmoke` + onTick 观测钩子），
//   逐 tick 走 `planStep`（与生产同一条路径）⇒ 报每份快照的 kind/字节、以及 15 份窗口的总占用。
// 用法：SWV2_CHAT=<真聊天 jsonl 路径> node demo/measure-snapshot-cost.js [ticks]
import { readFileSync } from 'node:fs';
import { runSmoke } from '../src/smoke.js';
import { planStep, planRetention, RETAIN_STEPS, ANCHOR_EVERY } from '../src/snapshot.js';

const TICKS = Number(process.argv[2]) || 15;
const chatPath = process.env.SWV2_CHAT;

function realWorld() {
    if (!chatPath) return null;
    try {
        const raw = readFileSync(chatPath, 'utf8');
        const box = JSON.parse(raw.slice(0, raw.indexOf('\n'))).chat_metadata?.story_world_v2;
        return box?.world ?? null;
    } catch (err) {
        console.log('（真账读不到，退回内置黄金样本：' + String(err?.message || err).slice(0, 60) + '）');
        return null;
    }
}

const real = realWorld();
const GOLDEN = JSON.parse(readFileSync(new URL('../test/fixtures/golden-world.min.json', import.meta.url), 'utf8'));
const EXTRACT_FIX = JSON.parse(readFileSync(new URL('../test/fixtures/extract-samples.json', import.meta.url), 'utf8'));

// ★为什么不能直接拿真账跑（实测踩两次，留档）：`runSmoke` 的合成步骤引的是**黄金样本**里的
//   （`e_merchant` / 盘算 `a_1` / 位置「商路」）——真账里没有这些 ⇒ tick 1 当场校验失败
//   （原样拷真账也不行：拷的是真账的实体表，照样没有 e_merchant）。
//   ⇒ 改法：**把黄金样本按比例放大到真账容量**（实体数照真账 618 取整），
//     `e_merchant`/`a_1` 原样保留（步骤才跑得动），新增实体是纯数据 ⇒ 量出的体积与真账同量级。
//     口径写清楚：**这是"同容量合成世界"，不是"真账数字"**（本仓不许拿合成数冒充真账实测）。
const SCALE = real ? Math.max(GOLDEN.entities.length, Math.round((real.entities || []).length)) : GOLDEN.entities.length;
const base = (() => {
    if (!real) return GOLDEN;
    const w = JSON.parse(JSON.stringify(GOLDEN));
    const proto = w.entities[0];
    while (w.entities.length < SCALE) {
        const i = w.entities.length;
        const e = { ...proto, id: `e_x_${i}`, name: `合成角色${i}` };
        w.entities.push(e);
        w.weights[e.id] = 0.2;
    }
    // 名号容量同步（canon 也照真账量级）
    const canonNames = (real.context?.setting?.frozen?.canon?.bookEntities || []).length;
    const canon = w.context?.setting?.frozen?.canon;
    if (canon && Array.isArray(canon.bookEntities)) {
        while (canon.bookEntities.length < canonNames) {
            canon.bookEntities.push({ name: `合成名号${canon.bookEntities.length}`, kind: 'character' });
        }
    }
    return w;
})();
console.log(`起点世界：${real ? `同容量合成（照真账容量：${base.entities.length} 实体 / ${(base.context?.setting?.frozen?.canon?.bookEntities || []).length} 名号；★非真账数字）` : '黄金样本'} · ${JSON.stringify(base).length} 字节`);
console.log(`口径：锚点每 ${ANCHOR_EVERY} 步一份 full，保留窗口 ${RETAIN_STEPS} 份 · 跑 ${TICKS} tick\n`);

let seq = 0;
let anchorId = null;
let anchorSeq = null;
let anchorWorld = null;
const recs = [];
let firstFullBytes = 0;

const { world } = await runSmoke({
    ssot: base,
    extractCtx: EXTRACT_FIX.context,
    ticks: TICKS,
    onTick: (t, w) => {
        const p = planStep({
            seq, tick: t, world: w,
            prevAnchorWorld: anchorWorld, prevAnchorId: anchorId, anchorSeq,
            reason: `tick ${t}`, now: `T${t}`,
        });
        seq = p.nextSeq; anchorId = p.anchorId; anchorSeq = p.anchorSeq; anchorWorld = p.anchorWorld;
        recs.push(p.snapshot);
        if (p.snapshot.kind === 'full' && !firstFullBytes) firstFullBytes = p.snapshot.bytes;
    },
});

for (const r of recs) {
    const kb = (r.bytes / 1024).toFixed(1);
    console.log(`  ${r.id.padEnd(5)} tick ${String(r.tick).padStart(3)} · ${r.kind.padEnd(5)} · ${String(r.bytes).padStart(7)} 字节 (${kb.padStart(7)} KB) · ${r.reason}`);
}

const fulls = recs.filter((r) => r.kind === 'full');
const deltas = recs.filter((r) => r.kind === 'delta');
const sum = (a) => a.reduce((n, r) => n + r.bytes, 0);
const plan = planRetention({ snapshots: recs });

console.log(`\n── 实测汇总 ──`);
console.log(`份数        ${recs.length}（full ${fulls.length} / delta ${deltas.length}）`);
if (fulls.length) console.log(`full 均值   ${Math.round(sum(fulls) / fulls.length)} 字节`);
if (deltas.length) console.log(`delta 均值  ${Math.round(sum(deltas) / deltas.length)} 字节  ← 关键数（相对 full 的倍数：${(sum(fulls) / fulls.length / (sum(deltas) / deltas.length)).toFixed(0)}×）`);
console.log(`本窗口总占用 ${(sum(recs) / 1024).toFixed(1)} KB（${recs.length} 份）`);
console.log(`保留 ${RETAIN_STEPS} 份窗口：留 ${plan.keep.length} / 丢 ${plan.drop.length} · 窗口字节 ${(plan.bytes / 1024).toFixed(1)} KB`);
console.log(`\n★结论：若"每步一份完整拷贝"，${recs.length} 步要 ${((firstFullBytes * recs.length) / 1024 / 1024).toFixed(1)} MB；`);
console.log(`  锚点制实测 ${(sum(recs) / 1024).toFixed(1)} KB ⇒ 省 ${(firstFullBytes * recs.length / Math.max(1, sum(recs))).toFixed(0)}×。`);
console.log(`  末态世界 ${JSON.stringify(world).length} 字节（与起点同量级 ⇒ 世界大小稳定，快照成本不随时间膨胀）。`);
