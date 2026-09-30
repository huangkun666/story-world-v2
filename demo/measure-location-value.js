// story-world-v2/demo/measure-location-value.js  (只读：位置这个字段**现在到底有多大用**——用数据回答)
// 跑法：SWV2_CHAT="<jsonl 副本>" SWV2_BOOK="<世界书 json>" node demo/measure-location-value.js
// 说明：盘上那份是新世界（真位置 0），所以先用**真实生产路径**（结构推断）把位置补上再量——
//   量的对象是"位置这一栏在真书上最终长什么样"，不是"新世界刚建好时长什么样"。
import { readFileSync } from 'node:fs';

const world = JSON.parse(readFileSync(process.env.SWV2_CHAT, 'utf8').split('\n')[0]).chat_metadata.story_world_v2.world;
let positions = world.context?.positions || [];

if (process.env.SWV2_BOOK) {
    const { characterBookEntries, inheritLocations } = await import('../web/index.js');
    const b = JSON.parse(readFileSync(process.env.SWV2_BOOK, 'utf8'));
    const rawE = b.entries;
    const list = Array.isArray(rawE) ? rawE : Object.values(rawE || {});
    const entries = list.filter((e) => e && typeof e === 'object' && String(e.content ?? '').trim());
    const r = inheritLocations(world, { entries });
    world.entities = r.ssot.entities;
    console.log(`（复验用：结构推断补了 ${r.inherited} 个位置）\n`);
}

const ents = world.entities || [];
const events = world.events || [];

const real = (v) => typeof v === 'string' && v.trim() && v !== '未明';

console.log('=== ① 实体位置：散得开吗（散不开 = 没有区分度） ===');
const withLoc = ents.filter((e) => real(e.location));
console.log(`有真位置 ${withLoc.length} / ${ents.length}｜占位「未明」 ${ents.filter((e) => e.location === '未明').length}`);
const dist = {};
for (const e of withLoc) dist[e.location] = (dist[e.location] || 0) + 1;
const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1]);
console.log(`用到 ${sorted.length} 个不同地点（位置集共 ${positions.length} 项）`);
console.log('分布（前 12）：');
for (const [k, v] of sorted.slice(0, 12)) console.log(`   ${String(v).padStart(3)} × ${k}`);
const top3 = sorted.slice(0, 3).reduce((s, [, v]) => s + v, 0);
console.log(`★前 3 个地点就装下了 ${top3}/${withLoc.length} = ${(top3 / withLoc.length * 100).toFixed(0)}% 的有位置实体`);
const single = sorted.filter(([, v]) => v === 1).length;
console.log(`★只被 1 个实体占用的地点 = ${single} / ${sorted.length}（"一对一"= 没有共处关系可谈）`);

console.log('\n=== ② 事件位置：位置真的被用来定位事件了吗 ===');
console.log(`事件 ${events.length}｜已闭环 ${events.filter((e) => e.closed).length}`);
const evReal = events.filter((e) => real(e.position));
const evPlaceholder = events.filter((e) => e.position === '未明');
console.log(`有真位置 ${evReal.length}｜位置 = 占位「未明」 ${evPlaceholder.length}｜无 position 字段 ${events.filter((e) => e.position === undefined).length}`);
const evDist = {};
for (const e of evReal) evDist[e.position] = (evDist[e.position] || 0) + 1;
console.log(`事件用到 ${Object.keys(evDist).length} 个不同地点：${JSON.stringify(Object.entries(evDist).sort((a,b)=>b[1]-a[1]).slice(0,8))}`);

console.log('\n=== ③ 位置集本身的成分（供给面质量） ===');
console.log(`位置集 ${positions.length} 项；首项 = ${JSON.stringify(positions[0])}（兜底词）`);
// 位置集里两项互相包含的有多少（父子地名并存 = 归一化歧义的来源）
let nested = 0;
for (const a of positions) for (const b of positions) if (a !== b && a.includes(b)) nested += 1;
console.log(`★互为父子（一项包含另一项）的关系 = ${nested} 对 ⇒ 归一化必须做"取最长"（歧义是结构性的）`);

console.log('\n=== ④ 谁在读它（代码事实，供对照） ===');
console.log(`  进模型 prompt：pack.js 实体行带 location（有据/（推）标注）`);
console.log(`  进玩家观棋：streams.js「📍 各方位置」一行全量平铺`);
console.log(`  被校验：check-step.js 三处（∈ 位置集，不在集内**拒整步**）`);
console.log(`  ★被用于任何判断/推理：0 处（掩码已删）`);

console.log('\n=== ⑤ 没位置的那批是什么成分（决定"缺 390 个"到底要紧不要紧） ===');
const byKind = {};
for (const e of ents) {
    const k = `${e.kind}·${real(e.location) ? '有位置' : '无位置'}`;
    byKind[k] = (byKind[k] || 0) + 1;
}
console.log(JSON.stringify(byKind, null, 0));
const noLocChars = ents.filter((e) => !real(e.location) && e.kind === 'character');
console.log(`角色里没位置的 = ${noLocChars.length} / ${ents.filter((e) => e.kind === 'character').length}`);
// 这些角色是不是"书里没有组织条目收留他们"的人
const hasParent = noLocChars.filter((e) => e.parent).length;
console.log(`  其中**有归属**的 = ${hasParent}（有归属却推不出位置 ⇒ 其组织条目没写驻地）`);
console.log(`  其中**无归属**的 = ${noLocChars.length - hasParent}（孤儿，书里没说他属于谁 ⇒ 本就无处可推）`);

console.log('\n=== ⑥ 换个问法：位置能拿来干什么（可算量清单） ===');
// 同地/异地是唯一零歧义的关系；量"每轮镜头里有多少对实体同地"
const lensSize = Math.min(15, ents.length);
console.log(`  若按"同地"做任何机制：可用实体 ${withLoc.length}（${(withLoc.length / ents.length * 100).toFixed(0)}%），可分辨地点 ${sorted.length} 个`);
console.log(`  平均每个地点 ${(withLoc.length / Math.max(1, sorted.length)).toFixed(1)} 个实体（够不够支撑"同一地点内发生关系"？看这个数）`);
